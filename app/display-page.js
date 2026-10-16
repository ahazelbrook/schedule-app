/* The table display (#display): a full-screen page for an iPad lying in front of the players, signed in as the GM.
   It shows whatever the GM last pushed through GET /api/gm/display (GM.md): a player-safe map (svg), one NPC (npc), a line
   of text (text), a rules entry (rule), or nothing (blank). It never decides anything itself: it polls, sanitises and draws.
   Interface: window.B68DisplayPage = { mount(container, ctx), unmount() }
   with ctx = { gm: window.claude.gm, db: window.claude.use('db'), figures: window.B68Figure, cast: window.B68Cast, isGM }, plus the
   optional ambient inputs ctx.ambientDoc, ctx.ambientTiming, ctx.onAmbientLoad (see the ambient controller below).
   When nothing is spotlit (blank) it plays an ambient scene underneath (app/ambient/*.html in a sandboxed same-origin iframe).
   The pure parts (SVG sanitiser, poll/backoff state machine, zoom maths, display -> view model) sit in `Pure`, which Node
   requires for checks/runtime/display.test.mjs. No external requests; every string from the server goes in with textContent
   (the SVG is parsed, stripped of anything active and imported as nodes, never set as HTML; a rules entry is markdown.js's
   escaped HTML, parsed inert in a <template> and cut down by Pure.cleanRuleTree before it is imported). Nothing here throws when the
   kit, the db or the wake lock is missing. */
(function (root) {
  'use strict';

  /* =====================================================================================================================
     Pure parts (no DOM except the parser handed in)
     ===================================================================================================================== */
  var Pure = {};

  Pure.LIMITS = { svgChars: 700000, text: 2000, rule: 40000 };

  /* ---------- the SVG sanitiser ---------- */
  var BAD_ELEMENTS = {
    script: 1, foreignobject: 1, iframe: 1, object: 1, embed: 1, audio: 1, video: 1, canvas: 1, link: 1, meta: 1, base: 1,
    form: 1, input: 1, button: 1, textarea: 1, select: 1, frame: 1, frameset: 1, applet: 1, portal: 1, handler: 1, listener: 1,
    a: 1                        /* a link on the players' screen could navigate the GM's signed-in iPad */
  };
  var ANIMATES = { animate: 1, set: 1, animatemotion: 1, animatetransform: 1 };

  function localName(node) {
    var n = String(node.localName || node.tagName || node.nodeName || '');
    var i = n.lastIndexOf(':');
    return (i >= 0 ? n.slice(i + 1) : n).toLowerCase();
  }
  /* The same rules as the server's checkSvg (functions/_lib/gm.js): an href or src is a #fragment, or a raster data: image
     (png, jpeg, gif, webp) on an <image> or <feImage> only; url() is a #fragment only; no image-set() or src() functions,
     no backslash in an attribute or CSS value, no xml:base, no <a>. */
  var RASTER = /^data:image\/(?:png|jpe?g|gif|webp)[;,]/i;
  function trimRef(v) { return String(v == null ? '' : v).replace(/^[\s\u0000-\u001f]+|[\s\u0000-\u001f]+$/g, ''); }
  /* a reference is safe when it stays inside the document (#fragment), or is a raster image on an image element */
  function safeRef(v, el) {
    var t = trimRef(v);
    if (t.charAt(0) === '#') return true;
    return (el === 'image' || el === 'feimage') && RASTER.test(t);
  }
  Pure.safeRef = safeRef;
  var CSS_FN = /image-set\s*\(|(?:^|[^-\w])src\s*\(/i;
  /* every url(...) in a CSS value or an attribute must point inside the document; an @import never is */
  function urlsSafe(v) {
    var re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi, m;
    while ((m = re.exec(v))) {
      var u = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
      if (trimRef(u).charAt(0) !== '#') return false;
    }
    return true;
  }
  function unsafeCss(css) {
    var s = String(css == null ? '' : css);
    if (/@import/i.test(s) || /expression\s*\(/i.test(s) || /-moz-binding|behaviou?r\s*:/i.test(s)) return true;
    if (CSS_FN.test(s)) return true;
    if (s.indexOf('\\') >= 0) return true;                 /* CSS escapes can spell url( and javascript: in ways a scan misses */
    return !urlsSafe(s);
  }
  Pure.unsafeCss = unsafeCss;
  function squash(v) { return String(v == null ? '' : v).replace(/[\s\u0000-\u001f]+/g, ''); }

  /* true when the attribute has to go */
  function badAttr(name, value, el) {
    var n = String(name).toLowerCase(), local = n.indexOf(':') >= 0 ? n.slice(n.lastIndexOf(':') + 1) : n;
    if (n.indexOf('on') === 0 || local.indexOf('on') === 0) return true;
    if (String(value).indexOf('\\') >= 0) return true;     /* escapes can spell what a scan looks for */
    if (local === 'href' || local === 'src' || local === 'srcset' || local === 'formaction' || local === 'action' || local === 'poster' || local === 'background') {
      return local === 'href' || local === 'src' ? !safeRef(value, el) : true;
    }
    if (CSS_FN.test(value)) return true;
    if (n === 'xml:base' || local === 'base') return true;
    var sq = squash(value);
    if (/javascript:|vbscript:|livescript:|data:text\/html|data:application/i.test(sq)) return true;
    if (local === 'style') return unsafeCss(value);
    if (/url\(/i.test(value) && !urlsSafe(value)) return true;
    return false;
  }

  function childList(node) {
    var out = [], c = node.childNodes || node.children || [];
    for (var i = 0; i < c.length; i++) out.push(c[i]);
    return out;
  }
  function attrList(el) {
    var out = [], a = el.attributes || [];
    for (var i = 0; i < a.length; i++) out.push({ name: a[i].name, value: a[i].value });
    return out;
  }
  function detach(node) { if (node.parentNode) node.parentNode.removeChild(node); }

  /* Strip everything active from a parsed SVG element, in place. Returns the number of things it removed. */
  Pure.cleanElement = function (rootEl) {
    var removed = 0, stack = [rootEl];
    while (stack.length) {
      var el = stack.pop();
      var kids = childList(el);
      for (var k = 0; k < kids.length; k++) {
        var c = kids[k];
        if (c.nodeType === 1) {
          var ln = localName(c), drop = false;
          if (BAD_ELEMENTS[ln]) drop = true;
          else if (ln === 'style') drop = unsafeCss(c.textContent);
          else if (ANIMATES[ln]) {
            var an = c.getAttribute && c.getAttribute('attributeName');
            drop = ln === 'set' || ln === 'animate' ? /href|src|^on/i.test(an || '') || !an : false;
            if (!drop) {
              var vals = [c.getAttribute('to'), c.getAttribute('values'), c.getAttribute('from'), c.getAttribute('by')].join(' ');
              drop = /javascript:|vbscript:|url\(/i.test(squash(vals)) && !urlsSafe(vals);
            }
          }
          if (drop) { detach(c); removed++; continue; }
          stack.push(c);
        } else if (c.nodeType === 8 || c.nodeType === 7 || c.nodeType === 4) {
          /* comments, processing instructions, CDATA: the sanitised tree has no use for them (style text sits in a text node) */
          if (c.nodeType !== 4) { detach(c); removed++; }
        }
      }
      var attrs = attrList(el);
      for (var a = 0; a < attrs.length; a++) {
        if (badAttr(attrs[a].name, attrs[a].value, localName(el))) { el.removeAttribute(attrs[a].name); removed++; }
      }
    }
    return removed;
  };

  function parseNum(v) { var n = parseFloat(v); return isFinite(n) ? n : NaN; }
  /* the viewBox of the root, or one made from its width and height; null when it has neither */
  Pure.viewBoxOf = function (svg) {
    var p = String(svg.getAttribute('viewBox') || '').split(/[\s,]+/).filter(Boolean).map(parseNum);
    if (p.length === 4 && p.every(isFinite) && p[2] > 0 && p[3] > 0) return { x: p[0], y: p[1], w: p[2], h: p[3] };
    var w = parseNum(svg.getAttribute('width')), h = parseNum(svg.getAttribute('height'));
    if (w > 0 && h > 0 && !/%/.test(svg.getAttribute('width') + svg.getAttribute('height'))) return { x: 0, y: 0, w: w, h: h };
    return null;
  };

  /* sanitiseSvg(text, { DOMParser, XMLSerializer? }) -> { ok: true, node, markup, viewBox } | { ok: false, reason }
     `node` is the cleaned root element of the parsed document (import it with document.importNode). `markup` is its
     serialisation, for tests and for anyone who needs a string. Fails closed: anything odd is a rejection, not a repair. */
  Pure.sanitiseSvg = function (text, env) {
    if (typeof text !== 'string') return { ok: false, reason: 'not text' };
    var t = text.replace(/^[\s﻿]+/, '');
    if (t.length > (env && env.maxChars || Pure.LIMITS.svgChars)) return { ok: false, reason: 'too large' };
    if (!/^<svg[\s>/]/i.test(t) && !/^<\?xml[\s\S]*?\?>\s*<svg[\s>/]/i.test(t)) return { ok: false, reason: 'does not start with <svg' };
    if (/<!\s*(DOCTYPE|ENTITY)/i.test(t)) return { ok: false, reason: 'has a DOCTYPE or ENTITY' };
    if (/javascript:|vbscript:/i.test(squash(t))) return { ok: false, reason: 'has a script URL' };
    /* an XML parser makes an SVG element only when the namespace is declared; a map that forgot it would draw as nothing */
    if (!/^(?:<\?xml[\s\S]*?\?>\s*)?<svg[^>]*\sxmlns\s*=/i.test(t)) t = t.replace(/<svg(?=[\s>/])/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    if (/\sxlink:[a-z]+\s*=/i.test(t) && !/xmlns:xlink\s*=/i.test(t)) t = t.replace(/<svg(?=[\s>/])/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    var Parser = env && env.DOMParser;
    if (!Parser) return { ok: false, reason: 'no parser' };
    var doc;
    try { doc = new Parser().parseFromString(t, 'image/svg+xml'); } catch (e) { return { ok: false, reason: 'parse error' }; }
    if (!doc || !doc.documentElement) return { ok: false, reason: 'parse error' };
    var rootEl = doc.documentElement;
    if (localName(rootEl) === 'parsererror' || (doc.getElementsByTagName && doc.getElementsByTagName('parsererror').length)) return { ok: false, reason: 'parse error' };
    if (localName(rootEl) !== 'svg') return { ok: false, reason: 'root is not svg' };
    Pure.cleanElement(rootEl);
    var vb = Pure.viewBoxOf(rootEl);
    if (!vb) return { ok: false, reason: 'no viewBox' };
    rootEl.setAttribute('viewBox', [vb.x, vb.y, vb.w, vb.h].join(' '));
    rootEl.removeAttribute('width'); rootEl.removeAttribute('height');
    rootEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    var markup = '';
    try { markup = env.XMLSerializer ? new env.XMLSerializer().serializeToString(rootEl) : ''; } catch (e) { markup = ''; }
    return { ok: true, node: rootEl, markup: markup, viewBox: vb };
  };

  /* ---------- zoom maths: viewBox windows over a fit view ----------
     V = the SVG's own viewBox {x,y,w,h}; size = the frame in pixels {w,h}; st = { s, cx, cy }: s the zoom (1 = fit),
     (cx,cy) the user-space point at the centre of the frame. The viewBox is rewritten to the frame's aspect ratio, so a
     zoomed map stays sharp (vector, not a scaled bitmap). */
  var MAXZOOM = 8;
  function fitK(V, size) { return Math.min(size.w / V.w, size.h / V.h); }
  Pure.MAXZOOM = MAXZOOM;
  Pure.clampView = function (V, size, st) {
    var s = Math.min(MAXZOOM, Math.max(1, isFinite(st.s) ? st.s : 1)), k = fitK(V, size) * s;
    var hw = size.w / (2 * k), hh = size.h / (2 * k);
    var cx = V.w <= 2 * hw ? V.x + V.w / 2 : Math.min(V.x + V.w - hw, Math.max(V.x + hw, st.cx));
    var cy = V.h <= 2 * hh ? V.y + V.h / 2 : Math.min(V.y + V.h - hh, Math.max(V.y + hh, st.cy));
    return { s: s, cx: cx, cy: cy };
  };
  Pure.viewWindow = function (V, size, st) {
    var c = Pure.clampView(V, size, st), k = fitK(V, size) * c.s, w = size.w / k, h = size.h / k;
    return { x: c.cx - w / 2, y: c.cy - h / 2, w: w, h: h };
  };
  /* start = { s, cx, cy, d, px, py } when the fingers went down (d the finger distance, 1 for one finger; px, py the
     midpoint in pixels from the frame centre); now = { d, px, py }. The map point that was under the start midpoint stays
     under the current one. */
  Pure.pinchView = function (V, size, start, now) {
    var k0 = fitK(V, size), ks = k0 * start.s;
    var ux = start.cx + start.px / ks, uy = start.cy + start.py / ks;
    var s = Math.min(MAXZOOM, Math.max(1, start.s * (start.d > 0 ? now.d / start.d : 1)));
    var k = k0 * s;
    return Pure.clampView(V, size, { s: s, cx: ux - now.px / k, cy: uy - now.py / k });
  };

  /* ---------- display -> what the page draws ---------- */
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || Pure.LIMITS.text) : ''; }
  Pure.str = str;
  /* The fields of an NPC a player may see (CAST.md): the cast page shows name, alias, role, faction and description, and the
     figure's spec. Nothing else is copied, so gmNotes, tags, revealed and any future field cannot reach the screen. */
  Pure.playerNpc = function (doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
    return {
      name: str(doc.name, 200), alias: str(doc.alias, 200), role: str(doc.role, 200), faction: str(doc.faction, 200),
      description: str(doc.description), spec: doc.spec && typeof doc.spec === 'object' && !Array.isArray(doc.spec) ? doc.spec : null
    };
  };
  /* npcDoc: undefined (not looked up), null (not found) or the doc as the cast holds it. Unknown kinds draw as blank. */
  Pure.viewModel = function (display, npcDoc) {
    var d = display && typeof display === 'object' && !Array.isArray(display) ? display : {};
    var title = str(d.title), kind = d.kind;
    if (kind === 'svg' && typeof d.svg === 'string' && d.svg) return { kind: 'svg', title: title, caption: str(d.caption), svg: d.svg };
    if (kind === 'text') return { kind: 'text', title: title, text: str(d.text), size: Pure.textSize(str(d.text)) };
    if (kind === 'dark') return { kind: 'dark', title: title, caption: str(d.caption) };      /* lights out: true black, covers the ambient */
    if (kind === 'rule') { var md = str(d.md, Pure.LIMITS.rule); return { kind: 'rule', title: title, caption: str(d.caption), md: md, size: Pure.ruleSize(md) }; }
    if (kind === 'cards' && Array.isArray(d.cards) && d.cards.length) {
      var cards = d.cards.slice(0, 8).map(function (c) { var o = {}; Pure.CARD_FIELDS.forEach(function (f) { o[f] = str(c && c[f], 120); }); return o; });
      var iv = Math.floor(+d.interval); iv = iv >= 0 && iv <= 120 ? iv : 0;
      return { kind: 'cards', title: title, cards: cards, mode: d.mode === 'spread' ? 'spread' : 'carousel', interval: iv, start: Math.max(0, Math.min(cards.length - 1, Math.floor(+d.start) || 0)) };
    }
    if (kind === 'npc') {
      var n = Pure.playerNpc(npcDoc);
      var vm = { kind: 'npc', npcId: typeof d.npcId === 'string' ? d.npcId : '', title: title, found: !!n };
      if (n) {
        vm.name = n.name || title; vm.alias = n.alias; vm.sub = [n.role, n.faction].filter(Boolean).join(' · ');
        vm.description = n.description; vm.spec = n.spec;
      }
      return vm;
    }
    return { kind: 'blank' };
  };
  /* the opportunity card's lines (the planning meeting): field and label, as the book's index card prints them */
  Pure.CARD_FIELDS = ['from', 'client', 'target', 'type', 'note', 'payout'];
  Pure.CARD_ROWS = [['from', 'From'], ['client', 'Client'], ['target', 'Target'], ['type', 'Type'], ['note', ''], ['payout', 'Payout']];
  /* the next card of a carousel: wraps both ways */
  Pure.cardStep = function (i, n, d) { return n ? ((i + d) % n + n) % n : 0; };
  /* a size class for a block of text, from how much of it there is */
  Pure.textSize = function (text) {
    var n = String(text || '').length;
    return n <= 90 ? 'xl' : n <= 260 ? 'l' : n <= 700 ? 'm' : 's';
  };
  /* a size class for a rules entry: a short one reads from across the table, a long one scrolls */
  Pure.ruleSize = function (md) {
    var n = String(md || '').length;
    return n <= 700 ? 'l' : n <= 2500 ? 'm' : 's';
  };

  /* ---------- a rules entry: what markdown.js made, cut down to plain text structure ----------
     markdown.js escapes every piece of source text, so its HTML is already safe; this is the second lock. Only the tags below
     stay. A link becomes its words (a tap must never navigate the GM's signed-in iPad). The compiler's [TODO] notes, anchors
     and page chips go. Attributes go, except a plain class, an <ol>'s start and a callout's type; folded callouts open. */
  var RULE_TAGS = {
    p: 1, h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1, ul: 1, ol: 1, li: 1, strong: 1, em: 1, del: 1, mark: 1, code: 1, pre: 1,
    blockquote: 1, table: 1, thead: 1, tbody: 1, tr: 1, th: 1, td: 1, br: 1, hr: 1, div: 1, span: 1, details: 1, summary: 1
  };
  var RULE_GONE = /(?:^|\s)(?:rl-todo|rl-anchor|rl-src)(?:\s|$)/;
  function cleanRuleKids(node) {
    var removed = 0, kids = childList(node);
    for (var k = 0; k < kids.length; k++) {
      var c = kids[k];
      if (c.nodeType === 3) continue;
      if (c.nodeType !== 1) { detach(c); removed++; continue; }
      var ln = localName(c), cls = String(c.getAttribute && c.getAttribute('class') || '');
      if (ln === 'a' && !RULE_GONE.test(cls)) {                  /* a link: keep its words, lose the link */
        removed += cleanRuleKids(c) + 1;
        while (c.firstChild) node.insertBefore(c.firstChild, c);
        detach(c);
        continue;
      }
      if (!RULE_TAGS[ln] || RULE_GONE.test(cls)) { detach(c); removed++; continue; }
      var attrs = attrList(c);
      for (var a = 0; a < attrs.length; a++) {
        var n = String(attrs[a].name).toLowerCase(), v = String(attrs[a].value);
        var keep = (n === 'class' && /^[a-z0-9 _-]{0,80}$/i.test(v)) || (n === 'start' && ln === 'ol' && /^\d{1,6}$/.test(v)) ||
          (n === 'data-callout' && /^[a-z0-9_-]{1,40}$/i.test(v)) || (n === 'open' && ln === 'details');
        if (!keep) { c.removeAttribute(attrs[a].name); removed++; }
      }
      if (ln === 'details') c.setAttribute('open', '');
      removed += cleanRuleKids(c);
    }
    return removed;
  }
  /* cleanRuleTree(node): strip a parsed rules entry in place (a <template>'s content, or any element); returns how much went */
  Pure.cleanRuleTree = function (node) { return node ? cleanRuleKids(node) : 0; };

  Pure.formatTime = function (iso) {
    var d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return p(d.getHours()) + ':' + p(d.getMinutes());
  };
  /* the corner status: { dot: ok | warn | bad | idle, text } */
  Pure.statusView = function (poll, seq, updatedAt) {
    var at = Pure.formatTime(updatedAt), st = poll && poll.state || 'connecting';
    if (st === 'connecting') return { dot: 'idle', text: 'Connecting…' };
    if (st === 'denied') return { dot: 'bad', text: 'Not signed in as the GM' };
    if (st === 'retrying') return { dot: 'warn', text: 'Connection trouble, retrying' + (at ? ' · last update ' + at : '') };
    if (st === 'offline') return { dot: 'bad', text: 'Offline, retrying' + (at ? ' · last update ' + at : '') };
    if (st === 'paused') return { dot: 'idle', text: 'Paused' };
    return { dot: 'ok', text: !seq ? 'Waiting for the GM' : 'Updated ' + (at || 'just now') };
  };

  /* ---------- the poller ----------
     o = { fetch(seq, aseq) -> Promise, onData(display, seq, updatedAt), onAmbient(doc, aseq, updatedAt), onStatus({state, fails,
           error}), isHidden(), timers, intervalMs (2000), slowMs (10000), failLimit (3), timeoutMs (10000) }
     One request in flight at a time; the next is scheduled only when the last has finished. States: connecting (nothing yet),
     live, retrying (1 to failLimit-1 failures in a row), offline (failLimit or more: polls every slowMs), denied (401/403, also
     slow), paused (page hidden: nothing scheduled). The first success after a failure goes back to the fast interval.
     Responses (GET /api/gm/display?seq=N&aseq=M): { seq, unchanged: true } (an older server, or `?seq` alone), the same with an
     ambient part { ambient: { seq, unchanged: true } }, or { seq, display, updatedAt, ambient: { seq, unchanged: true } | { seq,
     doc, updatedAt } }. The display redraws only when its seq moved (an ambient-only change carries the display along, and it
     must not cross-fade the same spotlight again); the ambient part, when it holds a doc, goes to onAmbient first (so the
     first draw already has its plan). A malformed ambient part is ignored: it never stops the spotlight. */
  Pure.ambientPart = function (r) {
    var a = r && r.ambient;
    if (!isObj(a) || typeof a.seq !== 'number' || !isFinite(a.seq)) return null;
    if (a.unchanged === true) return { seq: a.seq, unchanged: true };
    return isObj(a.doc) ? { seq: a.seq, doc: a.doc, updatedAt: typeof a.updatedAt === 'string' ? a.updatedAt : null } : null;
  };
  Pure.createPoller = function (o) {
    var T = o.timers || { setTimeout: function (f, ms) { return setTimeout(f, ms); }, clearTimeout: function (id) { clearTimeout(id); } };
    var fast = o.intervalMs || 2000, slow = o.slowMs || 10000, limit = o.failLimit || 3, tmo = o.timeoutMs || 10000;
    var seq = null, aseq = null, fails = 0, timer = null, inflight = false, running = false, gen = 0, state = 'connecting', lastErr = null;
    function hidden() { return !!(o.isHidden && o.isHidden()); }
    function setState(s) {
      if (s === state) return;
      state = s;
      if (o.onStatus) { try { o.onStatus({ state: s, fails: fails, error: lastErr }); } catch (e) { /* the page must not stop the poller */ } }
    }
    function delay() { return fails >= limit || state === 'denied' ? slow : fast; }
    function clearTimer() { if (timer !== null) { T.clearTimeout(timer); timer = null; } }
    function schedule() {
      clearTimer();
      if (!running) return;
      if (hidden()) { setState('paused'); return; }
      timer = T.setTimeout(tick, delay());
    }
    function tick() {
      timer = null;
      if (!running) return;
      if (hidden()) { setState('paused'); return; }
      if (inflight) return;
      inflight = true;
      var myGen = gen, done = false, guard = T.setTimeout(function () { finish(new Error('timeout')); }, tmo);
      function finish(err, r) {
        if (done) return;
        done = true; T.clearTimeout(guard);
        if (myGen !== gen) return;               /* stopped (or restarted) while this was out */
        inflight = false;
        if (!running) return;
        if (!err && !(r && typeof r === 'object' && typeof r.seq === 'number' && (r.unchanged === true || (r.display && typeof r.display === 'object')))) err = new Error('bad response');
        var amb = err ? null : Pure.ambientPart(r);
        if (err) {
          fails++; lastErr = err;
          var code = err.status;
          setState(code === 401 || code === 403 ? 'denied' : fails >= limit ? 'offline' : 'retrying');
        } else {
          fails = 0; lastErr = null;
          if (amb) {
            aseq = amb.seq;
            if (!amb.unchanged && o.onAmbient) { try { o.onAmbient(amb.doc, amb.seq, amb.updatedAt); } catch (e) { /* ditto */ } }
          }
          if (r.unchanged !== true && r.seq !== seq) {
            seq = r.seq;
            if (o.onData) { try { o.onData(r.display, r.seq, r.updatedAt || null); } catch (e) { /* ditto */ } }
          }
          setState('live');
        }
        schedule();
      }
      var p;
      try { p = Promise.resolve(o.fetch(seq, aseq)); } catch (e) { p = Promise.reject(e); }
      p.then(function (r) { finish(null, r); }, function (e) { finish(e || new Error('failed')); });
    }
    return {
      start: function () { if (running) return; running = true; gen++; fails = 0; tick(); },
      stop: function () { running = false; gen++; inflight = false; clearTimer(); },
      /* the page became hidden or visible, or the network came back: pause, or poll at once */
      kick: function () {
        if (!running) return;
        if (hidden()) { clearTimer(); setState('paused'); return; }
        if (inflight) return;
        clearTimer(); tick();
      },
      /* the network is back: forget the backoff */
      reset: function () { fails = 0; if (state === 'offline' || state === 'retrying') state = 'connecting'; },
      seq: function () { return seq; },
      aseq: function () { return aseq; },
      state: function () { return state; },
      fails: function () { return fails; }
    };
  };

  /* ---------- the ambient floor (AMBIENT-PLAN.md) ----------
     When no spotlight is up the display plays a self-contained scene full screen and rotates it. The registry below is the only
     source of a scene's URL (`ambient/<file>`, relative to the app root): nothing from the server ever becomes a URL. `needs`
     says what a scene waits for ('score' gates it; 'crew' is advisory, the watch feed has its own defaults); `pinOnly` keeps a
     scene out of the rotation (the test card). */
  Pure.AMBIENT_SCENES = [
    { id: 'harvest', file: 'second-harvest.html', label: 'The lair' },
    { id: 'watch', file: 'watch-feed.html', label: 'City Watch feed', needs: 'crew' },
    { id: 'duskwall', file: 'duskwall-after-dark.html', label: 'The city after dark' },
    { id: 'boneyard', file: 'boneyard-dawn.html', label: 'The Boneyard at dawn' },
    { id: 'undertow', file: 'undertow.html', label: 'The Undertow' },
    { id: 'bluetime', file: 'bluetime.html', label: 'Bluetime' },
    { id: 'vet', file: 'grunts-vet.html', label: "Grunt's" },
    { id: 'tram', file: 'night-tram.html', label: 'Night tram' },
    { id: 'lurker', file: 'lurker-press.html', label: 'The Lurker press room' },
    { id: 'cards', file: 'calling-cards.html', label: 'Calling cards' },
    { id: 'pells', file: 'pells-provisions.html', label: "Pell's Provisions" },
    { id: 'wanted', file: 'wanted-wall.html', label: 'Wanted wall', needs: 'crew' },
    { id: 'board', file: 'planning-board.html', label: 'Planning board', needs: 'score' },
    { id: 'exploded', file: 'score-exploded.html', label: 'Score site, exploded', needs: 'score' },
    { id: 'testcard', file: 'test-card.html', label: 'Please stand by', pinOnly: true }
  ];
  Pure.AMBIENT_DEFAULT_PLAYLIST = ['harvest', 'watch', 'duskwall', 'boneyard', 'undertow', 'bluetime', 'vet', 'tram', 'lurker', 'cards', 'pells', 'wanted'];
  /* the scenes told the crew's heat and wanted (b68:crew): the watch feed and the wanted wall */
  Pure.ambientCrewScenes = function () { return Pure.AMBIENT_SCENES.filter(function (s) { return s.needs === 'crew'; }).map(function (s) { return s.id; }); };
  Pure.AMBIENT_DEFAULT_MIN = 7;

  Pure.ambientScene = function (id) {
    for (var i = 0; i < Pure.AMBIENT_SCENES.length; i++) if (Pure.AMBIENT_SCENES[i].id === id) return Pure.AMBIENT_SCENES[i];
    return null;
  };
  /* the iframe URL for a scene id, or '' for an unknown id. The watch feed polls /api/campaign unless told not to; the display
     sign-in may not call it, so it is always loaded with ?api=off. */
  Pure.ambientUrl = function (id) {
    var sc = Pure.ambientScene(id);
    /* no `.html`: the asset server answers /ambient/x.html with a 307 to /ambient/x, and the service worker will not cache a
       redirected response, so a scene would never be available offline */
    return sc ? 'ambient/' + sc.file.replace(/\.html$/, '') + (sc.id === 'watch' ? '?api=off' : '') : '';
  };
  /* a scene is playable when it exists and, if it needs a score, the plan has one */
  Pure.ambientAvailable = function (plan, id) {
    var sc = Pure.ambientScene(id);
    if (!sc) return false;
    if (sc.needs === 'score') return !!(plan && plan.score);
    return true;
  };
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function clampInt(v, lo, hi, dflt) {
    var n = Math.round(Number(v));
    return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  }
  function cleanScore(v) {
    if (!isObj(v)) return null;
    var svg = function (x) { return typeof x === 'string' && x.length <= Pure.LIMITS.svgChars ? x : ''; };
    return {
      name: str(v.name, 200), district: str(v.district, 200), target: str(v.target, 200),
      reveal: Array.isArray(v.reveal) ? v.reveal.filter(function (b) { return typeof b === 'string'; }).slice(0, 8).map(function (b) { return str(b, 40); }) : [],
      board: svg(v.board), iso: svg(v.iso), view: v.view === 'rings' ? 'rings' : 'plan', at: str(v.at, 40)
    };
  }
  /* ambientPlan(doc) -> the normalised plan: { mode: auto | pin | off, scene, playlist: [ids], intervalMin: 3..30, skip: int,
     crew: { heat, wanted } | null, score: null | { name, district, target, reveal, board, iso, view, at } }.
     `doc` is the ambient document the server delivers (null, undefined or {} before there is one). Unknown ids go; the test card
     never joins the rotation; a pin on a scene that cannot play (unknown, or a score scene with no score) falls back to auto.
     It reads its own output, so ambientPlan(ambientPlan(d)) equals ambientPlan(d). */
  Pure.ambientPlan = function (doc) {
    var d = isObj(doc) ? doc : {};
    var mode = d.mode === 'pin' || d.mode === 'off' ? d.mode : 'auto';
    var seen = {}, list = [];
    (Array.isArray(d.playlist) ? d.playlist : []).forEach(function (id) {
      var sc = typeof id === 'string' ? Pure.ambientScene(id) : null;
      if (sc && !sc.pinOnly && !seen[sc.id]) { seen[sc.id] = 1; list.push(sc.id); }
    });
    var crew = null;
    if (isObj(d.crew) && (isFinite(Number(d.crew.heat)) || isFinite(Number(d.crew.wanted)))) {
      crew = { heat: clampInt(d.crew.heat, 0, 9, 0), wanted: clampInt(d.crew.wanted, 0, 4, 0) };
    }
    var skip = Math.floor(Number(d.skip));
    var plan = {
      mode: mode, scene: typeof d.scene === 'string' && Pure.ambientScene(d.scene) ? d.scene : null,
      playlist: list.length ? list : Pure.AMBIENT_DEFAULT_PLAYLIST.slice(),
      intervalMin: clampInt(d.intervalMin, 3, 30, Pure.AMBIENT_DEFAULT_MIN), skip: isFinite(skip) && skip > 0 ? skip : 0,
      crew: crew, score: cleanScore(d.score)
    };
    if (plan.mode === 'pin' && !(plan.scene && Pure.ambientAvailable(plan, plan.scene))) { plan.mode = 'auto'; plan.scene = null; }
    return plan;
  };
  /* the playlist as it can play now: score scenes drop out while there is no score (the test card is never in a playlist) */
  Pure.ambientRotation = function (plan) {
    var p = plan && Array.isArray(plan.playlist) ? plan : Pure.ambientPlan(plan);
    return p.playlist.filter(function (id) { var sc = Pure.ambientScene(id); return sc && !sc.pinOnly && Pure.ambientAvailable(p, id); });
  };
  /* nextScene(plan, currentId, exclude?) -> the id after currentId in the rotation (wrapping), or the first when currentId is
     not in it; null when nothing can play. `exclude` is a list of ids to pass over (the benched ones). May return currentId
     itself when it is the only scene left. */
  Pure.nextScene = function (plan, currentId, exclude) {
    var rot = Pure.ambientRotation(plan), bad = exclude || [], n = rot.length;
    if (!n) return null;
    var at = rot.indexOf(currentId);
    for (var i = 1; i <= n; i++) {
      var id = rot[(at + i + n) % n];                  /* at = -1 starts at rot[0] */
      if (bad.indexOf(id) < 0) return id;
    }
    return null;
  };

  /* ---------- what the scenes are told ----------
     crewMessage(plan) -> { type: 'b68:crew', heat, wanted } for the watch feed, or null while the plan holds no crew.
     crewChanged(prev, next) -> true when `next` (a plan's crew, or null) should be posted: it exists and differs from what the
     scene was last told (`prev`, or null when it was told nothing). The page posts when this says so, and again whenever the
     watch scene finishes loading (a freshly loaded scene knows nothing). */
  Pure.crewMessage = function (plan) {
    var c = plan && isObj(plan.crew) ? plan.crew : null;
    return c ? { type: 'b68:crew', heat: clampInt(c.heat, 0, 9, 0), wanted: clampInt(c.wanted, 0, 4, 0) } : null;
  };
  Pure.crewChanged = function (prev, next) {
    if (!isObj(next)) return false;
    return !isObj(prev) || prev.heat !== next.heat || prev.wanted !== next.wanted;
  };
  /* the four crew polaroids on the score scenes: cast id -> caption (the generator's constant; AMBIENT-PLAN.md 4.3) */
  Pure.POLAROIDS = [{ id: 'booker', cap: 'Babel' }, { id: 'alfie', cap: 'Ashtray & Buck' }, { id: 'stacey', cap: 'Stacey' }, { id: 'loader', cap: '99.47' }];
  /* scoreMessage(score, polaroids, env) -> the message a score scene is sent in reply to its b68:ready, or null with no score.
     `board` and `iso` are the score's svgs run through the sanitiser again here (normal cap) and sent as its markup, '' when one
     will not clean; `polaroids` are [{ svg, cap }] already cleaned by the caller (the figure kit's output, big cap). Nothing but
     these fields is copied. */
  Pure.scoreMessage = function (score, polaroids, env) {
    if (!isObj(score)) return null;
    function markup(svg) { var r = Pure.sanitiseSvg(svg, { DOMParser: env && env.DOMParser, XMLSerializer: env && env.XMLSerializer }); return r.ok ? r.markup : ''; }
    return {
      type: 'b68:score', name: str(score.name, 200), district: str(score.district, 200), target: str(score.target, 200),
      view: score.view === 'rings' ? 'rings' : 'plan', board: markup(score.board), iso: markup(score.iso),
      polaroids: (Array.isArray(polaroids) ? polaroids : []).filter(function (p) { return isObj(p) && typeof p.svg === 'string' && p.svg; })
        .slice(0, 4).map(function (p) { return { svg: p.svg, cap: str(p.cap, 80) }; })
    };
  };
  /* a score scene's id (board, exploded) -> true: the scenes that wait for a score */
  Pure.isScoreScene = function (id) { var sc = Pure.ambientScene(id); return !!(sc && sc.needs === 'score'); };

  /* =====================================================================================================================
     Browser part
     ===================================================================================================================== */
  var S = null;           /* the mounted session, or null */

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null && text !== '') e.textContent = text;
    return e;
  }
  function on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    return function () { target.removeEventListener(type, fn, opts); };
  }
  function reduced() { try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; } }
  /* `big`: the figure kit's own output, which can run past a pushed map's cap */
  function parserEnv(big) { return { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer, maxChars: big ? 3000000 : 0 }; }

  /* ---------- stages: one per push, cross-faded ---------- */
  function blankStage() {
    var e = el('div', 'dp-stage dp-blank'), m = el('div', 'dp-mark');
    m.setAttribute('aria-hidden', 'true'); e.appendChild(m);
    return { el: e, destroy: function () {} };
  }
  /* lights out: an opaque black stage over everything, the ambient included; no text, no mark */
  function darkStage(vm) {
    var e = el('div', 'dp-stage dp-dark');
    if (vm.title) e.setAttribute('aria-label', vm.title);
    return { el: e, destroy: function () {} };
  }
  function textStage(vm) {
    var e = el('div', 'dp-stage dp-text dp-t-' + vm.size), box = el('div', 'dp-text-box');
    if (vm.title) box.appendChild(el('p', 'dp-kicker', vm.title));
    box.appendChild(el('p', 'dp-text-body', vm.text));
    e.appendChild(box);
    return { el: e, destroy: function () {} };
  }
  /* a rules entry: rendered by markdown.js, parsed inert in a <template>, cleaned, then imported; a column that scrolls */
  function ruleStage(vm) {
    var e = el('div', 'dp-stage dp-rule dp-r-' + vm.size), scroll = el('div', 'dp-rule-scroll'), box = el('article', 'dp-rule-box');
    if (vm.caption) box.appendChild(el('p', 'dp-kicker', vm.caption));
    if (vm.title) box.appendChild(el('h1', 'dp-rule-title', vm.title));
    var body = el('div', 'dp-rule-body'), M = root.B68Markdown, html = '';
    try { html = M && typeof M.render === 'function' ? M.render(vm.md, { headingOffset: 1 }) : ''; } catch (x) { html = ''; }
    var tpl = html ? document.createElement('template') : null;
    if (tpl && 'content' in tpl) {
      tpl.innerHTML = html;
      Pure.cleanRuleTree(tpl.content);
      body.appendChild(document.importNode(tpl.content, true));
    } else body.appendChild(el('p', 'dp-rule-plain', M && typeof M.plain === 'function' ? M.plain(vm.md) : vm.md));
    box.appendChild(body); scroll.appendChild(box); e.appendChild(scroll);
    return { el: e, destroy: function () {} };
  }
  /* the planning meeting's opportunity cards: one large at a time (tap the right side for the next, the left for the one
     before; it turns by itself when the GM set an interval), or all of them spread on the table */
  function oppCard(c, i) {
    var card = el('div', 'oc-card'), head = el('div', 'oc-row oc-head');
    head.appendChild(el('span', 'oc-lab')); head.appendChild(el('span', 'oc-colon')); head.appendChild(el('span', 'oc-val oc-title', 'Opportunity'));
    card.appendChild(head);
    Pure.CARD_ROWS.forEach(function (r) {
      var row = el('div', 'oc-row');
      row.appendChild(el('span', 'oc-lab', r[1])); row.appendChild(el('span', 'oc-colon', ':')); row.appendChild(el('span', 'oc-val', c[r[0]]));
      card.appendChild(row);
    });
    card.setAttribute('data-i', String(i));
    return card;
  }
  function cardsStage(vm) {
    var e = el('div', 'dp-stage dp-cards dp-cards-' + vm.mode), n = vm.cards.length, cur = vm.start, timer = null, offs = [];
    if (vm.title) e.appendChild(el('p', 'dp-kicker dp-cards-kicker', vm.title));
    var track = el('div', 'oc-track'), cards = vm.cards.map(function (c, i) { var k = oppCard(c, i); track.appendChild(k); return k; });
    e.appendChild(track);
    if (vm.mode === 'spread') return { el: e, destroy: function () {} };
    var dots = el('div', 'oc-dots');
    var dotEls = vm.cards.map(function () { var d = el('span', 'oc-dot'); dots.appendChild(d); return d; });
    if (n > 1) e.appendChild(dots);
    function show() {
      cards.forEach(function (k, i) {
        var off = Pure.cardStep(i, n, -cur), pos = off === 0 ? 'cur' : off === 1 ? 'next' : off === n - 1 ? 'prev' : 'away';
        k.className = 'oc-card oc-' + (n === 1 ? 'cur' : pos);
      });
      dotEls.forEach(function (d, i) { d.classList.toggle('on', i === cur); });
    }
    function go(d) { cur = Pure.cardStep(cur, n, d); show(); arm(); }
    function arm() {
      clearTimeout(timer);
      if (vm.interval > 0 && n > 1 && !reduced()) timer = setTimeout(function () { if (!document.hidden) go(1); else arm(); }, vm.interval * 1000);
    }
    offs.push(on(e, 'click', function (ev) {
      if (n < 2) return;
      var r = e.getBoundingClientRect();
      go(ev.clientX - r.left < r.width / 3 ? -1 : 1);
    }));
    offs.push(on(document, 'keydown', function (ev) { if (ev.key === 'ArrowRight' || ev.key === ' ') go(1); else if (ev.key === 'ArrowLeft') go(-1); }));
    show(); arm();
    return { el: e, destroy: function () { clearTimeout(timer); offs.forEach(function (f) { f(); }); } };
  }
  function noteStage(title, msg) {
    var e = el('div', 'dp-stage dp-text dp-t-l'), box = el('div', 'dp-text-box');
    if (title) box.appendChild(el('p', 'dp-kicker', title));
    box.appendChild(el('p', 'dp-muted', msg));
    e.appendChild(box);
    return { el: e, destroy: function () {} };
  }

  /* the NPC: a figure at true proportion beside the player-facing text */
  function drawFigure(spec, uid, K) {
    if (!K || !spec) return null;
    var out = null, tries = [function (s) { return K.render(s, { height: 900 }); }, function (s) { return K.portrait(s, { lod: 'mid' }); }];
    for (var i = 0; i < tries.length && !out; i++) {
      try {
        var s = JSON.parse(JSON.stringify(spec)); s.id = uid;
        var r = tries[i](s);
        var res = Pure.sanitiseSvg(r && r.svg, parserEnv(true));
        if (res.ok) out = res;
      } catch (e) { out = null; }
    }
    return out;
  }
  /* a head-and-shoulders portrait from the figure kit, cleaned like any figure (the big cap); null when it will not draw */
  function drawPortrait(spec, uid, K) {
    if (!K || typeof K.portrait !== 'function' || !spec) return null;
    try {
      var s = JSON.parse(JSON.stringify(spec)); s.id = uid;
      var r = K.portrait(s, { lod: 'mid' }), res = Pure.sanitiseSvg(r && r.svg, parserEnv(true));
      return res.ok ? res : null;
    } catch (e) { return null; }
  }
  function npcStage(vm, seq, ctx) {
    var e = el('div', 'dp-stage dp-npc' + (vm.found ? '' : ' dp-npc-missing'));
    if (!vm.found) {
      var box = el('div', 'dp-npc-txt');
      box.appendChild(el('h1', 'dp-npc-name', vm.title || 'Unknown'));
      box.appendChild(el('p', 'dp-muted', 'Not found'));
      e.appendChild(box);
      return { el: e, destroy: function () {} };
    }
    var fig = drawFigure(vm.spec, 'dp-npc-' + seq, ctx.figures);
    if (fig) {
      var holder = el('div', 'dp-npc-fig'); holder.setAttribute('aria-hidden', 'true');
      holder.appendChild(document.importNode(fig.node, true));
      e.appendChild(holder);
    } else e.classList.add('dp-npc-nofig');
    var txt = el('div', 'dp-npc-txt');
    if (vm.sub) txt.appendChild(el('p', 'dp-kicker', vm.sub));
    txt.appendChild(el('h1', 'dp-npc-name', vm.name));
    if (vm.alias) txt.appendChild(el('p', 'dp-npc-alias', '“' + vm.alias + '”'));
    if (vm.description) txt.appendChild(el('p', 'dp-npc-desc', vm.description));
    e.appendChild(txt);
    return { el: e, destroy: function () {} };
  }

  /* the map: sanitised, inline, fitted, with pinch / two-finger pan / double-tap and a title strip that fades */
  function attachZoom(frame, svg, V, hooks) {
    var st = { s: 1, cx: V.x + V.w / 2, cy: V.y + V.h / 2 }, size = { w: 1, h: 1 };
    var pts = {}, gesture = null, tap = null, lastTap = { t: 0, x: 0, y: 0 }, offs = [];
    function measure() { var r = frame.getBoundingClientRect(); size = { w: Math.max(1, r.width), h: Math.max(1, r.height) }; return r; }
    function apply() {
      st = Pure.clampView(V, size, st);
      var w = Pure.viewWindow(V, size, st);
      svg.setAttribute('viewBox', [w.x, w.y, w.w, w.h].map(function (n) { return Math.round(n * 1000) / 1000; }).join(' '));
      frame.classList.toggle('dp-zoomed', st.s > 1.001);
    }
    function reset() { st = { s: 1, cx: V.x + V.w / 2, cy: V.y + V.h / 2 }; apply(); }
    function ids() { return Object.keys(pts); }
    function centre(r) {
      var a = ids().map(function (k) { return pts[k]; }), n = a.length, x = 0, y = 0;
      a.forEach(function (p) { x += p.x; y += p.y; });
      return { px: x / n - r.left - r.width / 2, py: y / n - r.top - r.height / 2 };
    }
    function spread() {
      var a = ids().map(function (k) { return pts[k]; });
      return a.length < 2 ? 1 : Math.max(1, Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y));
    }
    function begin() {
      if (!ids().length) { gesture = null; return; }
      var r = measure(), c = centre(r);
      gesture = { s: st.s, cx: st.cx, cy: st.cy, d: spread(), px: c.px, py: c.py };
    }
    function move() {
      if (!gesture) return;
      var r = frame.getBoundingClientRect(), c = centre(r);
      st = Pure.pinchView(V, size, gesture, { d: spread(), px: c.px, py: c.py });
      apply();
    }
    offs.push(on(frame, 'pointerdown', function (ev) {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      try { frame.setPointerCapture(ev.pointerId); } catch (e) {}
      pts[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
      if (ids().length === 1) tap = { t: Date.now(), x: ev.clientX, y: ev.clientY, moved: false, multi: false };
      else if (tap) tap.multi = true;
      begin();
    }));
    offs.push(on(frame, 'pointermove', function (ev) {
      var p = pts[ev.pointerId]; if (!p) return;
      p.x = ev.clientX; p.y = ev.clientY;
      if (tap && Math.hypot(ev.clientX - tap.x, ev.clientY - tap.y) > 8) tap.moved = true;
      move();
    }));
    function up(ev) {
      if (!pts[ev.pointerId]) return;
      delete pts[ev.pointerId];
      try { frame.releasePointerCapture(ev.pointerId); } catch (e) {}
      if (ids().length) { begin(); return; }
      gesture = null;
      var t = tap; tap = null;
      if (!t || ev.type === 'pointercancel' || t.moved || t.multi || Date.now() - t.t > 450) return;
      var now = Date.now(), dbl = now - lastTap.t < 340 && Math.hypot(t.x - lastTap.x, t.y - lastTap.y) < 40;
      lastTap = dbl ? { t: 0, x: 0, y: 0 } : { t: now, x: t.x, y: t.y };
      hooks.onTap();                            /* a double tap toggles twice, so the strip ends where it began */
      if (dbl) reset();
    }
    offs.push(on(frame, 'pointerup', up), on(frame, 'pointercancel', up));
    offs.push(on(frame, 'wheel', function (ev) {
      ev.preventDefault();
      var r = measure(), px = ev.clientX - r.left - r.width / 2, py = ev.clientY - r.top - r.height / 2;
      var f = Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0018));
      st = Pure.pinchView(V, size, { s: st.s, cx: st.cx, cy: st.cy, d: 1, px: px, py: py }, { d: f, px: px, py: py });
      apply();
    }, { passive: false }));
    offs.push(on(frame, 'dblclick', function (ev) { ev.preventDefault(); }));
    var ro = null;
    if (window.ResizeObserver) { ro = new ResizeObserver(function () { measure(); apply(); }); ro.observe(frame); }
    offs.push(on(window, 'resize', function () { measure(); apply(); }));
    measure(); apply();
    return { reset: reset, refit: function () { measure(); apply(); }, destroy: function () { offs.forEach(function (f) { f(); }); if (ro) ro.disconnect(); } };
  }

  function svgStage(vm) {
    var e = el('div', 'dp-stage dp-map'), frame = el('div', 'dp-map-frame');
    var res = Pure.sanitiseSvg(vm.svg, parserEnv());
    if (!res.ok) return noteStage(vm.title, 'This map could not be shown safely.');
    var svg = document.importNode(res.node, true);
    svg.setAttribute('focusable', 'false'); svg.setAttribute('role', 'img');
    if (vm.title) svg.setAttribute('aria-label', vm.title);
    frame.appendChild(svg); e.appendChild(frame);
    var strip = null, hideTimer = null, shown = false;
    if (vm.title || vm.caption) {
      strip = el('div', 'dp-strip');
      if (vm.title) strip.appendChild(el('p', 'dp-strip-title', vm.title));
      if (vm.caption) strip.appendChild(el('p', 'dp-strip-cap', vm.caption));
      e.appendChild(strip);
    }
    function show(on_) {
      shown = on_;
      if (strip) strip.classList.toggle('dp-show', on_);
      clearTimeout(hideTimer);
      if (on_) hideTimer = setTimeout(function () { shown = false; if (strip) strip.classList.remove('dp-show'); }, 6000);
    }
    var zoom = null;
    /* the strip shows at first, then fades; attachZoom needs the stage laid out, so it starts once the stage is attached */
    function ready() {
      if (zoom) return;
      zoom = attachZoom(frame, svg, res.viewBox, { onTap: function () { show(!shown); } });
      show(true);
    }
    return {
      el: e, attached: ready,
      destroy: function () { clearTimeout(hideTimer); if (zoom) zoom.destroy(); }
    };
  }

  function buildStage(vm, seq, ctx) {
    try {
      if (vm.kind === 'svg') return svgStage(vm);
      if (vm.kind === 'text') return textStage(vm);
      if (vm.kind === 'dark') return darkStage(vm);
      if (vm.kind === 'rule') return ruleStage(vm);
      if (vm.kind === 'cards') return cardsStage(vm);
      if (vm.kind === 'npc') return npcStage(vm, seq, ctx);
    } catch (e) { return noteStage(vm.title, 'This could not be shown.'); }
    return blankStage();
  }

  /* ---------- the NPC lookup: the app's cast, `npcs`, one doc ---------- */
  function loadNpc(ctx, id) {
    return new Promise(function (resolve) {
      try {
        if (!ctx.db || !id) { resolve(null); return; }
        var ref = ctx.db.collection('npcs').doc(id);
        Promise.resolve(ref.get()).then(function (snap) {
          var ex = snap && (typeof snap.exists === 'function' ? snap.exists() : snap.exists);
          var d = snap && typeof snap.data === 'function' ? snap.data() : null;
          resolve(ex === false || !d ? null : d);
        }, function () { resolve(null); });
      } catch (e) { resolve(null); }
    });
  }

  /* ---------- the ambient controller ----------
     One per session, in a `.dp-ambient` layer UNDER `.dp-stages`. Two iframe slots: `active` (on screen) and `incoming`
     (loading); a new scene fades in only on its `load` event, then the old one fades out and goes. The rotation timer runs in
     auto mode only, and not while the page is hidden. A spotlight (anything but blank) covers the ambient: the rotation stops,
     and after graceMs the iframes are removed (a hidden iframe gets no visibilitychange and would keep animating all night);
     blank uncovers it: if the iframe is still there the spotlight just fades off it, otherwise the scene reloads and fades in.
     A scene with no `load` inside watchdogMs is removed and benched for benchMs, and the next one is tried.
     Timings: defaults below; ctx.ambientTiming = { intervalMs, graceMs, watchdogMs, benchMs } overrides them (tests). On a
     loopback host only, localStorage['b68.display.ambientTiming'] (the same JSON) does the same, for the e2e run.
     Public methods (also on B68DisplayPage.ambient while mounted, for the poller and the GM-driven phases):
       setPlan(docOrPlan)  re-plan; a raised `skip` advances to the next scene at once (auto mode)
       cover() / uncover() a spotlight went up / the spotlight cleared
       post(id, message)   postMessage to that scene's frame (targetOrigin = this origin) when loaded; returns true if sent
       state()             { mode, cur, active, incoming, covered, benched: [ids] } for tests and debugging
     ctx.onAmbientLoad(id, frame), if given, runs after each scene loads (the session's own hook, s.onLoad, runs first: it posts the
     crew's heat to the watch feed). */
  function timingHook() {
    try {
      var h = location.hostname;
      if (h !== '127.0.0.1' && h !== 'localhost') return null;
      return JSON.parse(localStorage.getItem('b68.display.ambientTiming') || 'null');
    } catch (e) { return null; }
  }
  function makeFrame(id) {
    var f = document.createElement('iframe');
    f.className = 'dp-amb-frame';
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    f.setAttribute('allow', 'screen-wake-lock');
    f.setAttribute('aria-hidden', 'true');
    f.setAttribute('tabindex', '-1');
    f.setAttribute('referrerpolicy', 'same-origin');
    f.setAttribute('data-scene', id);
    f.setAttribute('src', Pure.ambientUrl(id));
    return f;
  }
  function createAmbient(s, layer, later, clearLater) {
    var ctx = s.ctx, container = s.container;
    var T = { intervalMs: 0, graceMs: 30000, watchdogMs: 20000, benchMs: 600000, fadeMs: 1300 };
    var over = isObj(ctx.ambientTiming) ? ctx.ambientTiming : timingHook();
    if (isObj(over)) {
      ['intervalMs', 'watchdogMs', 'benchMs'].forEach(function (k) { var n = Number(over[k]); if (isFinite(n) && n > 0) T[k] = n; });
      var g = Number(over.graceMs); if (isFinite(g) && g >= 0) T.graceMs = g;
    }
    var A = {
      plan: Pure.ambientPlan(ctx.ambientDoc), lastSkip: 0, covered: true,          /* covered until the first push says blank */
      cur: null, active: null, incoming: null, fading: [], bench: {}, rot: null, grace: null, retry: null, dead: false
    };
    A.lastSkip = A.plan.skip;

    function benched(id) { return !!A.bench[id] && A.bench[id] > Date.now(); }
    function benchList() { var out = []; for (var k in A.bench) if (Object.prototype.hasOwnProperty.call(A.bench, k) && benched(k)) out.push(k); return out; }
    function intervalMs() { return T.intervalMs || A.plan.intervalMin * 60000; }

    /* the scene that should be up: the pin, or the current one while it is still in the rotation, or the next playable */
    function pickTarget() {
      var p = A.plan;
      if (p.mode === 'off') return null;
      var bad = benchList();
      if (p.mode === 'pin') return p.scene && bad.indexOf(p.scene) < 0 ? p.scene : Pure.nextScene(p, p.scene, bad);
      if (A.cur && Pure.ambientRotation(p).indexOf(A.cur) >= 0 && bad.indexOf(A.cur) < 0) return A.cur;
      return Pure.nextScene(p, A.cur, bad);
    }
    /* the subtle mark shows only when there is no ambient to look at */
    function paintMark() { container.classList.toggle('dp-amb-on', !A.dead && A.plan.mode !== 'off' && !!(A.active || pickTarget())); }

    function stopRot() { if (A.rot !== null) { clearLater(A.rot); A.rot = null; } }
    function armRot() {
      stopRot();
      if (A.dead || A.covered || document.hidden || A.plan.mode !== 'auto' || Pure.ambientRotation(A.plan).length < 2) return;
      A.rot = later(function () { A.rot = null; advance(); }, intervalMs());
    }
    function advance() {
      if (A.dead || A.covered || A.plan.mode !== 'auto') return;
      var next = Pure.nextScene(A.plan, A.cur, benchList());
      if (next && next !== A.cur) load(next); else armRot();
    }

    function drop(slot) {
      if (!slot || slot.dead) return;
      slot.dead = true;
      if (slot.wd !== null) clearLater(slot.wd);
      if (slot.off) slot.off();
      if (slot.frame.parentNode) slot.frame.parentNode.removeChild(slot.frame);
      var i = A.fading.indexOf(slot); if (i >= 0) A.fading.splice(i, 1);
    }
    function removeAll() {
      var all = [A.active, A.incoming].concat(A.fading);
      A.active = null; A.incoming = null;
      all.forEach(drop);
      paintMark();
    }
    function retire(slot) {
      slot.frame.classList.remove('dp-amb-in');
      A.fading.push(slot);
      later(function () { drop(slot); }, reduced() ? 60 : T.fadeMs);
    }

    function load(id) {
      A.cur = id;
      if (A.incoming) { if (A.incoming.id === id) return; drop(A.incoming); A.incoming = null; }
      if (A.active && A.active.id === id) { armRot(); return; }
      var f = makeFrame(id), slot = { id: id, frame: f, loaded: false, dead: false, wd: null, off: null };
      slot.off = on(f, 'load', function () { onLoad(slot); });
      slot.wd = later(function () { slot.wd = null; onWatchdog(slot); }, T.watchdogMs);
      A.incoming = slot;
      layer.appendChild(f);
    }
    function onLoad(slot) {
      if (slot.dead || A.dead || slot.loaded) return;
      if (slot.wd !== null) { clearLater(slot.wd); slot.wd = null; }
      slot.loaded = true;
      var old = A.active;
      A.active = slot; if (A.incoming === slot) A.incoming = null;
      paintMark();
      later(function () { if (!slot.dead) slot.frame.classList.add('dp-amb-in'); }, reduced() ? 0 : 30);
      if (old) retire(old);
      if (typeof s.onLoad === 'function') { try { s.onLoad(slot.id, slot.frame); } catch (e) { /* a hook must not stop the floor */ } }
      if (typeof ctx.onAmbientLoad === 'function') { try { ctx.onAmbientLoad(slot.id, slot.frame); } catch (e) { /* a hook must not stop the floor */ } }
      armRot();
    }
    function onWatchdog(slot) {
      if (slot.dead || A.dead || slot.loaded) return;
      A.bench[slot.id] = Date.now() + T.benchMs;
      if (A.incoming === slot) A.incoming = null;
      drop(slot);
      if (A.retry !== null) clearLater(A.retry);
      A.retry = later(function () { A.retry = null; ensure(); }, T.benchMs + 50);   /* when the bench lapses, look again */
      ensure();
    }

    /* make the layer match the plan: after a re-plan, an uncover, a failed load */
    function ensure() {
      if (A.dead) return;
      if (A.plan.mode === 'off') { stopRot(); removeAll(); return; }
      paintMark();
      if (A.covered) return;
      var t = pickTarget();
      if (!t) { stopRot(); return; }
      if (A.active && A.active.id === t && !A.incoming) { A.cur = t; armRot(); return; }
      if (A.incoming && A.incoming.id === t) { A.cur = t; return; }
      load(t);
    }

    var api = {
      setPlan: function (raw) {
        if (A.dead) return;
        var p = Pure.ambientPlan(raw), up = p.skip > A.lastSkip;
        A.lastSkip = p.skip; A.plan = p;
        if (up && p.mode === 'auto') {
          var next = Pure.nextScene(p, A.cur, benchList());
          if (next && next !== A.cur) A.cur = next;        /* ensure() loads it now, or uncover() does when the spotlight clears */
        }
        ensure();
      },
      cover: function () {
        if (A.dead) return;
        A.covered = true; stopRot();
        if (A.grace === null) A.grace = later(function () { A.grace = null; removeAll(); }, T.graceMs);
      },
      uncover: function () {
        if (A.dead) return;
        A.covered = false;
        if (A.grace !== null) { clearLater(A.grace); A.grace = null; }
        ensure();
      },
      post: function (id, message) {
        var slot = A.active;
        if (A.dead || !slot || slot.dead || !slot.loaded || slot.id !== id) return false;
        try { slot.frame.contentWindow.postMessage(message, location.origin); return true; } catch (e) { return false; }
      },
      state: function () {
        return { mode: A.plan.mode, cur: A.cur, active: A.active ? A.active.id : null, incoming: A.incoming ? A.incoming.id : null, covered: A.covered, benched: benchList() };
      },
      destroy: function () {
        A.dead = true; stopRot();
        [A.active, A.incoming].concat(A.fading).forEach(drop);
        A.active = null; A.incoming = null; A.fading = [];
        container.classList.remove('dp-amb-on');
      }
    };
    s.offs.push(on(document, 'visibilitychange', function () { if (document.hidden) stopRot(); else armRot(); }));
    return api;
  }

  /* ---------- the session ---------- */
  function mount(container, ctx) {
    if (S) unmount();
    ctx = ctx || {};
    var s = S = {
      container: container, ctx: ctx, offs: [], timers: [], stages: [], current: null, token: 0, seq: 0, updatedAt: null,
      poll: { state: 'connecting' }, poller: null, wake: null, wakeWanted: true, enteredFs: false, dead: false
    };
    container.classList.add('dp-root');
    container.innerHTML = '';
    document.documentElement.classList.add('dp-active');
    var stages = el('div', 'dp-stages');
    var status = el('div', 'dp-status'), dot = el('span', 'dp-dot'), stext = el('span', 'dp-status-text');
    dot.setAttribute('aria-hidden', 'true'); status.setAttribute('role', 'status'); status.appendChild(dot); status.appendChild(stext);
    var chrome = el('div', 'dp-chrome');
    var fsBtn = el('button', 'dp-btn dp-fs', 'Full screen'); fsBtn.type = 'button';
    chrome.appendChild(fsBtn);
    var hint = el('div', 'dp-hint'); hint.hidden = true;
    var hintText = el('p', 'dp-hint-text', 'For true full screen on an iPad: tap Share, then Add to Home Screen, and open it from the Home Screen.');
    var hintBtn = el('button', 'dp-btn', 'Got it'); hintBtn.type = 'button';
    hint.appendChild(hintText); hint.appendChild(hintBtn);
    /* No way back to the GM page from here, hidden or not: the iPad lies in front of the players, signed in as the GM.
       The GM leaves the display from the GM's own device (or closes the Home Screen app). */
    var layer = el('div', 'dp-ambient'); layer.setAttribute('aria-hidden', 'true');           /* the ambient floor, under the stages */
    container.appendChild(layer); container.appendChild(stages); container.appendChild(status); container.appendChild(chrome); container.appendChild(hint);

    function later(fn, ms) { var id = setTimeout(function () { var i = s.timers.indexOf(id); if (i >= 0) s.timers.splice(i, 1); if (!s.dead) fn(); }, ms); s.timers.push(id); return id; }
    function clearLater(id) { clearTimeout(id); var i = s.timers.indexOf(id); if (i >= 0) s.timers.splice(i, 1); }
    /* the ambient floor stays covered (nothing loads) until the first push arrives, and always when there is no poller */
    var amb = s.amb = createAmbient(s, layer, later, clearLater);

    /* What the scenes are told. s.crew = the crew the plan last held (null: none yet); s.score = the ambient doc's score
       (normalised), the source of every b68:score. The watch feed learns the crew when it loads and again on each change; a score
       scene asks (b68:ready) and is answered, and is sent the new score when it changes. */
    s.crew = null; s.score = null; s.scoreMsg = null; s.scoreKey = ''; s.polaroids = null; s.plan = Pure.ambientPlan(ctx.ambientDoc);
    s.onLoad = function (id) {
      if (Pure.ambientCrewScenes().indexOf(id) < 0) return;
      var m = Pure.crewMessage(s.plan);
      if (m) amb.post(id, m);
    };
    function polaroids() {
      if (s.polaroids) return s.polaroids;
      var out = [], K = ctx.figures, C = ctx.cast;
      if (K && C && Array.isArray(C.pcs)) {
        Pure.POLAROIDS.forEach(function (p) {
          var pc = null; C.pcs.forEach(function (x) { if (x && x.id === p.id) pc = x; });
          var r = pc ? drawPortrait(pc, 'dp-pol-' + p.id, K) : null;
          if (r && r.markup) out.push({ svg: r.markup, cap: p.cap });
        });
      }
      return (s.polaroids = out);
    }
    function sendScore(win) {
      if (!s.score || !win) return;
      if (!s.scoreMsg) s.scoreMsg = Pure.scoreMessage(s.score, polaroids(), parserEnv(false));
      try { win.postMessage(s.scoreMsg, location.origin); } catch (e) { /* the frame went away */ }
    }
    /* the ambient doc arrived (or changed): re-plan, tell the watch feed a changed crew, hand a changed score to the live score scenes */
    function applyAmbient(doc) {
      var p = s.plan = Pure.ambientPlan(doc);
      amb.setPlan(p);
      if (Pure.crewChanged(s.crew, p.crew)) Pure.ambientCrewScenes().forEach(function (id) { amb.post(id, Pure.crewMessage(p)); });
      s.crew = p.crew;
      var key = p.score ? [p.score.at, p.score.name, p.score.district, p.score.target, p.score.view, p.score.board.length, p.score.iso.length].join('|') : '';
      if (key !== s.scoreKey) {
        s.scoreKey = key; s.score = p.score; s.scoreMsg = null;
        if (p.score) [].forEach.call(layer.querySelectorAll('iframe'), function (f) { if (Pure.isScoreScene(f.getAttribute('data-scene'))) sendScore(f.contentWindow); });
      }
    }
    /* A score scene says it is ready (it posts to its parent once its script has run): answer THAT frame, and only a frame of
       ours that is a score scene, from this origin. The reply goes to the frame's window itself: the load event may not have fired. */
    s.offs.push(on(window, 'message', function (ev) {
      if (s.dead || ev.origin !== location.origin || !ev.data || ev.data.type !== 'b68:ready' || !ev.source) return;
      var frames = layer.querySelectorAll('iframe'), hit = null;
      for (var i = 0; i < frames.length; i++) if (frames[i].contentWindow === ev.source && Pure.isScoreScene(frames[i].getAttribute('data-scene'))) hit = frames[i];
      if (hit) sendScore(hit.contentWindow);
    }));

    /* status */
    function paintStatus() {
      var v = Pure.statusView(s.poll, s.seq, s.updatedAt);
      dot.className = 'dp-dot dp-dot-' + v.dot; stext.textContent = v.text;
    }

    /* swap in a new stage with a cross-fade */
    function swap(stage) {
      var old = s.current;
      s.current = stage;
      stages.appendChild(stage.el);
      s.stages.push(stage);
      if (stage.attached) later(function () { stage.attached(); }, 0);
      var fast = reduced();
      later(function () { stage.el.classList.add('dp-in'); }, fast ? 0 : 30);
      if (old) {
        old.el.classList.remove('dp-in'); old.el.classList.add('dp-out');
        var gone = function () {
          var i = s.stages.indexOf(old); if (i >= 0) s.stages.splice(i, 1);
          try { old.destroy(); } catch (e) {}
          if (old.el.parentNode) old.el.parentNode.removeChild(old.el);
        };
        if (fast) gone(); else later(gone, 750);
      }
    }
    function show(display, seq) {
      var my = ++s.token, vm = Pure.viewModel(display);
      if (vm.kind === 'blank') amb.uncover(); else amb.cover();                 /* a spotlight covers the ambient; blank lets it through */
      if (vm.kind === 'npc') {
        loadNpc(ctx, vm.npcId).then(function (doc) {
          if (s.dead || my !== s.token) return;                       /* a newer push arrived while the cast was loading */
          swap(buildStage(Pure.viewModel(display, doc), seq, ctx));
        });
        return;
      }
      swap(buildStage(vm, seq, ctx));
    }

    /* first stage: blank, so the page is never empty */
    swap(blankStage());
    paintStatus();

    if (!ctx.gm || typeof ctx.gm.display !== 'function') {
      swap(noteStage('', 'The table display is available on the hosted app.'));
      stext.textContent = 'No connection to the GM tools'; dot.className = 'dp-dot dp-dot-bad';
    } else if (ctx.isGM === false) {
      swap(noteStage('', 'The table display runs on the GM’s sign-in.'));
      stext.textContent = 'Not signed in as the GM'; dot.className = 'dp-dot dp-dot-bad';
    } else {
      s.poller = Pure.createPoller({
        fetch: function (seq, aseq) { return ctx.gm.display(seq === null ? undefined : seq, aseq === null ? undefined : aseq); },
        isHidden: function () { return document.hidden; },
        onAmbient: function (doc) { applyAmbient(doc); },
        onData: function (display, seq, at) { s.seq = seq; s.updatedAt = at; paintStatus(); show(display, seq); },
        onStatus: function (p) { s.poll = p; paintStatus(); }
      });
      s.poller.start();
      /* the transcriber (app/stt.js): idle until the GM presses Start listening, then one tap here opens the mic */
      if (root.B68Stt && typeof root.B68Stt.attach === 'function') { try { s.stt = root.B68Stt.attach(container, { gm: ctx.gm }); } catch (e) { s.stt = null; } }
    }

    /* visibility: pause polling while hidden, poll at once on return, and take the wake lock back */
    function acquireWake() {
      if (s.dead || !s.wakeWanted || document.hidden || s.wake || !navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') return;
      var p; try { p = navigator.wakeLock.request('screen'); } catch (e) { return; }
      Promise.resolve(p).then(function (lock) {
        if (s.dead) { try { lock.release(); } catch (e) {} return; }
        s.wake = lock;
        try { lock.addEventListener('release', function () { if (s.wake === lock) s.wake = null; }); } catch (e) {}
      }, function () { /* denied (low battery, not allowed): the page works without it */ });
    }
    s.offs.push(on(document, 'visibilitychange', function () {
      if (s.poller) s.poller.kick();
      if (!document.hidden) { acquireWake(); paintStatus(); }
    }));
    s.offs.push(on(window, 'online', function () { if (s.poller) { s.poller.reset(); s.poller.kick(); } }));
    acquireWake();
    /* the first tap or touch is also the user gesture the wake lock sometimes wants */
    s.offs.push(on(container, 'pointerdown', acquireWake, { passive: true }));

    /* full screen */
    var fsEl = container, canFs = !!(fsEl.requestFullscreen || fsEl.webkitRequestFullscreen);
    function inFs() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
    function paintFs() { fsBtn.textContent = inFs() ? 'Exit full screen' : 'Full screen'; }
    fsBtn.hidden = !canFs;
    s.offs.push(on(fsBtn, 'click', function () {
      try {
        if (inFs()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); }
        else {
          var p = (fsEl.requestFullscreen || fsEl.webkitRequestFullscreen).call(fsEl);
          s.enteredFs = true;
          if (p && p.catch) p.catch(function () {});
        }
      } catch (e) {}
    }));
    s.offs.push(on(document, 'fullscreenchange', paintFs), on(document, 'webkitfullscreenchange', paintFs));
    paintFs();

    /* the Add to Home Screen hint, once */
    var HINT = 'b68.display.hint';
    function standalone() {
      try { return navigator.standalone === true || (window.matchMedia && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches)); } catch (e) { return false; }
    }
    function hintSeen() { try { return localStorage.getItem(HINT) === '1'; } catch (e) { return false; } }
    if (!standalone() && !hintSeen()) hint.hidden = false;
    s.offs.push(on(hintBtn, 'click', function () { hint.hidden = true; try { localStorage.setItem(HINT, '1'); } catch (e) {} }));

    /* the buttons fade out when nobody is touching the screen, and come back on a touch */
    var idleTimer = null;
    function wakeUi() {
      container.classList.add('dp-ui');
      if (idleTimer !== null) clearLater(idleTimer);
      idleTimer = later(function () { container.classList.remove('dp-ui'); idleTimer = null; }, 7000);
    }
    s.offs.push(on(container, 'pointerdown', wakeUi, { passive: true }), on(container, 'pointermove', function (ev) { if (ev.pointerType === 'mouse') wakeUi(); }, { passive: true }));
    wakeUi();
  }

  function unmount() {
    var s = S; if (!s) return;
    S = null; s.dead = true; s.token++;
    if (s.poller) s.poller.stop();
    if (s.stt) { try { s.stt.destroy(); } catch (e) {} s.stt = null; }
    if (s.amb) { try { s.amb.destroy(); } catch (e) {} s.amb = null; }
    s.timers.forEach(function (id) { clearTimeout(id); }); s.timers = [];
    s.offs.forEach(function (f) { try { f(); } catch (e) {} }); s.offs = [];
    s.stages.forEach(function (st) { try { st.destroy(); } catch (e) {} }); s.stages = [];
    if (s.wake) { try { s.wake.release(); } catch (e) {} s.wake = null; }
    try { if ((document.fullscreenElement || document.webkitFullscreenElement) && s.enteredFs) (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {}
    document.documentElement.classList.remove('dp-active');
    s.container.classList.remove('dp-root', 'dp-ui');
    s.container.innerHTML = '';
  }

  /* the controller of the mounted session, for the poller and the GM-driven phases; every call is a no-op when nothing is mounted */
  var ambient = {
    setPlan: function (doc) { if (S && S.amb) S.amb.setPlan(doc); },
    cover: function () { if (S && S.amb) S.amb.cover(); },
    uncover: function () { if (S && S.amb) S.amb.uncover(); },
    post: function (id, message) { return !!(S && S.amb && S.amb.post(id, message)); },
    state: function () { return S && S.amb ? S.amb.state() : null; }
  };
  var api = { mount: mount, unmount: unmount, ambient: ambient };
  if (typeof window !== 'undefined') window.B68DisplayPage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = { mount: mount, unmount: unmount, ambient: ambient, Pure: Pure };
})(typeof window !== 'undefined' ? window : globalThis);
