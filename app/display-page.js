/* The table display (#display): a full-screen page for an iPad lying in front of the players, signed in as the GM.
   It shows whatever the GM last pushed through GET /api/gm/display (GM.md): a player-safe map (svg), one NPC (npc), a line
   of text (text), a rules entry (rule), or nothing (blank). It never decides anything itself: it polls, sanitises and draws.
   The same poll carries what the transcriber (app/stt.js) needs, so the page makes one request where it made two; and a page that
   stays signed out for ten minutes reloads itself (Pure.createPoller, Pure.createReloader below).
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
    if (kind === 'handout') {
      /* one prop image from the static folder media/handouts/: the display carries the file name only (never the manifest) */
      if (!Pure.HANDOUT_FILE_RE.test(typeof d.file === 'string' ? d.file : '') || d.file.indexOf('..') >= 0) return { kind: 'blank' };
      return { kind: 'handout', title: title, file: d.file, src: Pure.HANDOUT_DIR + d.file, showTitle: d.showTitle === true && !!title };
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
  Pure.HANDOUT_DIR = 'media/handouts/';
  Pure.HANDOUT_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,78}\.(?:png|jpe?g|gif|webp|svg)$/i;
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
    return { dot: 'ok', text: !seq ? 'Waiting for the GM' : 'Updated ' + (at || 'just now') };
  };

  /* ---------- the poller ----------
     o = { fetch(seq, aseq, sseq) -> Promise, onData(display, seq, updatedAt), onAmbient(doc, aseq, updatedAt), onStt(part | null),
           onStatus({state, fails, error}), isHidden(), timers, now(), failLimit (3), timeoutMs (10000), and the beats of Pure.POLL:
           intervalMs, idleMs, idleAfterMs, slowMs, hiddenMs }
     One request in flight at a time; the next is scheduled only when the last has finished. States: connecting (nothing yet),
     live, retrying (1 to failLimit-1 failures in a row), offline (failLimit or more: polls every slowMs), denied (401/403, also
     slow). The first success after a failure goes back to the fast beat.
     The beat. Workers Free allows 100,000 requests a day for the whole site and an iPad stays on all night, so: intervalMs (4 s)
     while anything is moving; idleMs (15 s) once nothing has changed for idleAfterMs (2 hours: not the display, the ambient or the
     transcriber's part), until the next change brings the fast beat back; slowMs (10 s) while offline or denied, never faster than the
     beat before it; and hiddenMs (a minute) while the page is hidden, never faster than any of them. A hidden page keeps looking
     because the transcriber's part rides on this poll: the GM's Stop must reach a microphone left open in a background tab. Becoming
     visible, or the network coming back, polls at once (kick).
     Responses (GET /api/gm/display?seq=N&aseq=M&sseq=K): { seq, unchanged: true } (an older server, or `?seq` alone), the same with
     an ambient part { ambient: { seq, unchanged: true } } and a transcriber part { stt: { seq, unchanged: true } }, or { seq,
     display, updatedAt, ambient: { seq, unchanged: true } | { seq, doc, updatedAt }, stt: { seq, unchanged: true } | { seq, want,
     session } }. The display redraws only when its seq moved (an ambient-only change carries the display along, and it must not
     cross-fade the same spotlight again); the ambient part, when it holds a doc, goes to onAmbient first (so the first draw already
     has its plan), then the transcriber part to onStt, then (after onData) the answer's top-level `overlay` to onOverlay. A malformed ambient or transcriber part is ignored: it never stops the
     spotlight. onStt(part) gets { seq, want, session } when the part changed, and null once when an answer has no usable part
     (an older server: app/stt.js then asks for itself). */
  Pure.POLL = { intervalMs: 4000, idleMs: 15000, idleAfterMs: 2 * 3600 * 1000, slowMs: 10000, hiddenMs: 60000 };
  Pure.ambientPart = function (r) {
    var a = r && r.ambient;
    if (!isObj(a) || typeof a.seq !== 'number' || !isFinite(a.seq)) return null;
    if (a.unchanged === true) return { seq: a.seq, unchanged: true };
    return isObj(a.doc) ? { seq: a.seq, doc: a.doc, updatedAt: typeof a.updatedAt === 'string' ? a.updatedAt : null } : null;
  };
  /* the transcriber's part of an answer: { seq, unchanged: true } | { seq, want: 'on' | 'off', session } | null (absent or malformed) */
  Pure.sttPart = function (r) {
    var a = r && r.stt;
    if (!isObj(a) || typeof a.seq !== 'number' || !isFinite(a.seq)) return null;
    if (a.unchanged === true) return { seq: a.seq, unchanged: true };
    if (a.want !== 'on' && a.want !== 'off') return null;
    return { seq: a.seq, want: a.want, session: typeof a.session === 'string' ? a.session.slice(0, 12) : '' };
  };
  Pure.createPoller = function (o) {
    var T = o.timers || { setTimeout: function (f, ms) { return setTimeout(f, ms); }, clearTimeout: function (id) { clearTimeout(id); } };
    var B = Pure.POLL, fast = o.intervalMs || B.intervalMs, idleBeat = o.idleMs || B.idleMs, idleAfter = o.idleAfterMs || B.idleAfterMs,
        slow = o.slowMs || B.slowMs, hiddenBeat = o.hiddenMs || B.hiddenMs, limit = o.failLimit || 3, tmo = o.timeoutMs || 10000;
    var clock = o.now || function () { return Date.now(); };
    var seq = null, aseq = null, sseq = null, sttSeen = null, movedAt = null, fails = 0, timer = null, inflight = false, running = false, gen = 0, state = 'connecting', lastErr = null, again = false;
    function hidden() { return !!(o.isHidden && o.isHidden()); }
    function setState(s) {
      if (s === state) return;
      state = s;
      if (o.onStatus) { try { o.onStatus({ state: s, fails: fails, error: lastErr }); } catch (e) { /* the page must not stop the poller */ } }
    }
    /* movedAt: when the display, the ambient or the transcriber's part last changed (or the poller started) */
    function delay() {
      var d = movedAt !== null && clock() - movedAt >= idleAfter ? idleBeat : fast;
      if (fails >= limit || state === 'denied') d = Math.max(d, slow);
      return hidden() ? Math.max(d, hiddenBeat) : d;
    }
    function clearTimer() { if (timer !== null) { T.clearTimeout(timer); timer = null; } }
    function schedule() {
      clearTimer();
      if (!running) return;
      timer = T.setTimeout(tick, delay());
    }
    function tick() {
      timer = null;
      if (!running) return;
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
        var amb = err ? null : Pure.ambientPart(r), stt = err ? null : Pure.sttPart(r);
        if (err) {
          fails++; lastErr = err;
          var code = err.status;
          setState(code === 401 || code === 403 ? 'denied' : fails >= limit ? 'offline' : 'retrying');
        } else {
          fails = 0; lastErr = null;
          var moved = false;
          if (amb) {
            if (amb.seq !== aseq) moved = true;
            aseq = amb.seq;
            if (!amb.unchanged && o.onAmbient) { try { o.onAmbient(amb.doc, amb.seq, amb.updatedAt); } catch (e) { /* ditto */ } }
          }
          if (stt) {
            if (stt.seq !== sseq) moved = true;
            sseq = stt.seq; sttSeen = true;
            if (!stt.unchanged && o.onStt) { try { o.onStt({ seq: stt.seq, want: stt.want, session: stt.session }); } catch (e) { /* ditto */ } }
          } else if (sttSeen !== false) {
            sttSeen = false;
            if (o.onStt) { try { o.onStt(null); } catch (e) { /* ditto */ } }
          }
          if (r.unchanged !== true && r.seq !== seq) {
            moved = true;
            seq = r.seq;
            if (o.onData) { try { o.onData(r.display, r.seq, r.updatedAt || null); } catch (e) { /* ditto */ } }
          }
          /* the overlay rides on its own, small, on every answer (null when none), after the display part so the page already knows whether it is
             dark: onOverlay(overlay | null). An answer without the key (an older server) leaves the ambient doc's overlay to onAmbient. */
          if (o.onOverlay && Object.prototype.hasOwnProperty.call(r, 'overlay') && (r.overlay === null || isObj(r.overlay))) { try { o.onOverlay(r.overlay); } catch (e) { /* ditto */ } }
          if (moved) movedAt = clock();
          setState('live');
        }
        if (again) { again = false; clearTimer(); tick(); } else schedule();   /* a live-sync poke arrived while this was out: ask again now */
      }
      var p;
      try { p = Promise.resolve(o.fetch(seq, aseq, sseq)); } catch (e) { p = Promise.reject(e); }
      p.then(function (r) { finish(null, r); }, function (e) { finish(e || new Error('failed')); });
    }
    return {
      start: function () { if (running) return; running = true; gen++; fails = 0; movedAt = clock(); tick(); },
      stop: function () { running = false; gen++; inflight = false; again = false; clearTimer(); },
      /* a live-sync poke (design 2.5): look now, whatever the beat. The 4 s beat itself never changes. A look already out is followed by another. */
      poke: function () {
        if (!running || hidden()) return;
        if (inflight) { again = true; return; }
        clearTimer(); tick();
      },
      /* the page became hidden or visible, or the network came back: a hidden page waits out the hidden beat from now, a visible one polls at once */
      kick: function () {
        if (!running || inflight) return;
        if (hidden()) { schedule(); return; }
        clearTimer(); tick();
      },
      /* the network is back: forget the backoff */
      reset: function () { fails = 0; if (state === 'offline' || state === 'retrying') state = 'connecting'; },
      seq: function () { return seq; },
      aseq: function () { return aseq; },
      sseq: function () { return sseq; },
      state: function () { return state; },
      fails: function () { return fails; }
    };
  };

  /* ---------- the way out of "denied" ----------
     When the Access sign-in ends, the adapter (app/runtime/cf.js) refuses every call from then on, for good, and nothing on the
     page can bring it back: "Not signed in as the GM" stays up until someone reloads, and nobody touches an iPad on the table's
     stand for hours. So the page reloads itself after deniedMs (10 minutes) signed out: a reload asks Access again, which re-issues
     the sign-in while the single sign-on session is still good, and otherwise shows its sign-in page, which is what a person has to
     see. At most once per gapMs (30 minutes): the time of the last reload is kept in storage (last, remember), so a page that comes
     back still denied (a person has to sign in, or the email is not allowed) does not reload in a loop, it tries again later. With
     no storage to keep that time in, it never reloads: a stale word is better than a loop.
     o = { last() -> ms | null, remember(ms) -> true | false, reload(), timers, now(), deniedMs, gapMs }
     -> { state(name) (the poller's states, as they change), stop() } */
  Pure.RELOAD = { deniedMs: 10 * 60 * 1000, gapMs: 30 * 60 * 1000, key: 'b68.display.reload' };
  Pure.createReloader = function (o) {
    var T = o.timers || { setTimeout: function (f, ms) { return setTimeout(f, ms); }, clearTimeout: function (id) { clearTimeout(id); } };
    var R = Pure.RELOAD, deniedMs = o.deniedMs || R.deniedMs, gapMs = o.gapMs || R.gapMs, clock = o.now || function () { return Date.now(); };
    var since = null, timer = null, went = false, future = null;
    function clearTimer() { if (timer !== null) { T.clearTimeout(timer); timer = null; } }
    function arm(ms) { clearTimer(); timer = T.setTimeout(check, Math.max(1000, ms)); }
    function check() {
      timer = null;
      if (since === null || went) return;
      var now = clock(), last = o.last();
      if (last !== null && last > now) { if (future === null) future = now; last = future; }   /* a clock set back: count the half hour from when this was seen */
      else future = null;
      var wait = Math.max(since + deniedMs - now, last === null ? 0 : last + gapMs - now);
      if (wait > 0) { arm(wait); return; }
      if (!o.remember(now)) return;                               /* nowhere to note it: stay as it is, rather than risk a loop */
      went = true;
      o.reload();
    }
    return {
      state: function (name) {
        if (name === 'denied') { if (since === null) { since = clock(); arm(deniedMs); } }
        else if (since !== null) { since = null; clearTimer(); }
      },
      stop: function () { since = null; clearTimer(); }
    };
  };
  /* where the page keeps the time of its last reload (win is the window): localStorage and sessionStorage both, so that either one
     being blocked (private mode, a full quota) loses nothing, and the newer time counts. remember() says whether one of them took it. */
  Pure.reloadStore = function (win) {
    function each(fn) { ['localStorage', 'sessionStorage'].forEach(function (name) { try { fn(win[name]); } catch (e) { /* blocked: the other one */ } }); }
    return {
      last: function () {
        var best = null;
        each(function (st) { var n = Number(st.getItem(Pure.RELOAD.key)); if (isFinite(n) && n > 0 && (best === null || n > best)) best = n; });
        return best;
      },
      remember: function (ms) { var kept = false; each(function (st) { st.setItem(Pure.RELOAD.key, String(ms)); kept = true; }); return kept; }
    };
  };

  /* ---------- the ambient floor (GM.md, "Ambient scenes"; the plan: docs/history/AMBIENT-PLAN.md) ----------
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
    { id: 'vet', file: 'grunts-vet.html', label: "Grunt's" },
    { id: 'tram', file: 'night-tram.html', label: 'Night tram' },
    { id: 'lurker', file: 'lurker-press.html', label: 'The Lurker press room' },
    { id: 'cards', file: 'calling-cards.html', label: 'Calling cards' },
    { id: 'pells', file: 'pells-provisions.html', label: "Pell's Provisions" },
    { id: 'wanted', file: 'wanted-wall.html', label: 'Wanted wall', needs: 'crew' },
    { id: 'meeting', file: 'planning-meeting.html', label: 'The planning meeting' },
    { id: 'credits', file: 'opening-credits.html', label: 'Opening credits', pinOnly: true, music: true },
    { id: 'board', file: 'planning-board.html', label: 'Planning board', needs: 'score' },
    { id: 'exploded', file: 'score-exploded.html', label: 'Score site, exploded', needs: 'score' },
    { id: 'testcard', file: 'test-card.html', label: 'Please stand by', pinOnly: true }
  ];
  Pure.AMBIENT_DEFAULT_PLAYLIST = ['harvest', 'watch', 'duskwall', 'boneyard', 'undertow', 'vet', 'tram', 'lurker', 'cards', 'pells', 'wanted', 'meeting'];
  /* the theme a `music: true` scene may ask the display to play: an MP3 kept on the GM's PC and deployed from disk, never committed */
  Pure.AMBIENT_MUSIC = 'media/theme.mp3';
  /* the corner line that says where the theme is, for the table to read: one of the display's music states and its details */
  Pure.themeText = function (st) {
    st = st && typeof st === 'object' ? st : {};
    var t = Math.max(0, Math.floor(Number(st.t) || 0)), mmss = Math.floor(t / 60) + ':' + (t % 60 < 10 ? '0' : '') + (t % 60);
    switch (st.state) {
      case 'checking': return 'Theme: looking for the file…';
      case 'none': return 'Theme: no file on the server (app/' + Pure.AMBIENT_MUSIC + ')';
      case 'locked': return 'Theme: tap the screen for sound';
      case 'blocked': return 'Theme: the iPad would not play it · tap the screen';
      case 'playing': return 'Theme: playing · ' + mmss;
      case 'ended': return 'Theme: finished';
      case 'error': return 'Theme: the file would not play' + (st.reason ? ' (' + String(st.reason) + ')' : '');
      default: return '';
    }
  };
  /* a HEAD answer counts as the theme only when it is audio (an HTML 200 is a sign-in page or a fallback, not the file) */
  Pure.themeType = function (contentType) {
    var ct = String(contentType || '').toLowerCase().trim();
    return !ct || /^audio\//.test(ct) || /^application\/octet-stream/.test(ct);
  };
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
  /* the wire (GM.md, "The Screen"): short in-world bulletins the GM chose to show; the display lays them over whatever ambient scene is
     playing, one at a time, and never over a spotlight. cleanWire(v) -> [{ id, text }], at most 6, text at most 240 characters, one line. */
  Pure.WIRE_MAX = 240; Pure.WIRE_ITEMS = 6;
  Pure.cleanWire = function (v) {
    var out = [], seen = {};
    (Array.isArray(v) ? v : []).forEach(function (x) {
      if (!isObj(x) || typeof x.id !== 'string' || typeof x.text !== 'string' || out.length >= Pure.WIRE_ITEMS) return;
      var text = x.text.replace(/\s+/g, ' ').trim().slice(0, Pure.WIRE_MAX);
      if (text && !seen[x.id]) { seen[x.id] = 1; out.push({ id: x.id.slice(0, 40), text: text }); }
    });
    return out;
  };
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
      crew: crew, score: cleanScore(d.score), wire: Pure.cleanWire(d.wire)
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
  /* the four crew polaroids on the score scenes: cast id -> caption (the generator's constant; docs/history/AMBIENT-PLAN.md 4.3) */
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

  /* ---------- overlays (GM.md, "Overlays"): something laid over whatever is up, without replacing it ----------
     The ambient document's `overlay` ({ id, kind clock|npc|fx|text, ms, ... }) and `auto` (the AUTO chip). They are not part of the
     ambient plan: the page reads them from the document itself. The checks mirror the server's cleanOverlay (functions/_lib/gm.js),
     but an overlay that does not pass is simply not shown (nothing is clamped or repaired). It never carries model text or prep text. */
  Pure.OVERLAY = { id: 40, name: 60, text: 120, msMin: 1000, msMax: 180000, kinds: ['clock', 'npc', 'fx', 'text'], sizes: [4, 6, 8, 10, 12], fx: ['dawn'], npcId: /^[A-Za-z0-9_-]{1,80}$/ };
  function wholeIn(v, lo, hi) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= lo && v <= hi; }
  function oneLine(v) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''; }
  /* cleanOverlay(raw) -> the overlay with only its own fields, or null (absent, malformed, or out of bounds) */
  Pure.cleanOverlay = function (v) {
    var O = Pure.OVERLAY;
    if (!isObj(v)) return null;
    var id = typeof v.id === 'string' ? v.id.trim() : '';
    if (!id || id.length > O.id || O.kinds.indexOf(v.kind) < 0 || !wholeIn(v.ms, O.msMin, O.msMax)) return null;
    var out = { id: id, kind: v.kind, ms: v.ms };
    /* `age`: the SERVER's whole ms since it set the overlay (GET /api/gm/display adds it); absent or bad is left off (0), never the iPad's clock */
    if (wholeIn(v.age, 1, O.msMax)) out.age = v.age;
    /* `auto`: the autopilot sent it, so it is never drawn over lights out (a GM-pressed overlay, the dawn, carries no such mark) */
    if (v.auto === true) out.auto = true;
    if (v.kind === 'clock') {
      var name = oneLine(v.name);
      if (!name || name.length > O.name || O.sizes.indexOf(v.size) < 0 || !wholeIn(v.filled, 0, v.size)) return null;
      out.name = name; out.size = v.size; out.filled = v.filled;
    } else if (v.kind === 'npc') {
      if (typeof v.npcId !== 'string' || !O.npcId.test(v.npcId)) return null;
      out.npcId = v.npcId;
      /* `npc`: what the SERVER joined at read time while that NPC is revealed (GET /api/gm/display); only the fields a player may see */
      if (isObj(v.npc)) { var pn = Pure.playerNpc(v.npc); out.npc = { name: pn.name, alias: pn.alias, role: pn.role, faction: pn.faction, spec: pn.spec }; }
    } else if (v.kind === 'fx') {
      if (O.fx.indexOf(v.fx) < 0) return null;
      out.fx = v.fx;
    } else {
      var t = oneLine(v.text);
      if (!t || t.length > O.text) return null;
      out.text = t;
    }
    return out;
  };
  /* overlayStep(seenId, raw) -> { seen, action: 'show' | 'keep' | 'hide', overlay }. Each id shows once: the same id again keeps what is
     there (or nothing, once it has run out); a new id shows; null (or junk) hides and forgets the id, so the GM can show it afresh. */
  Pure.overlayStep = function (seenId, raw) {
    var o = Pure.cleanOverlay(raw);
    if (!o) return { seen: '', action: seenId ? 'hide' : 'keep', overlay: null };
    if (o.id === seenId) return { seen: seenId, action: 'keep', overlay: o };
    return { seen: o.id, action: 'show', overlay: o };
  };
  /* the clock face: one wedge per segment from 12 o'clock, clockwise, in a 100 x 100 box; the first `filled` are on */
  Pure.clockWedges = function (size, filled) {
    var out = [], r = 46, cx = 50, cy = 50;
    function pt(deg) { var a = (deg - 90) * Math.PI / 180; return (Math.round((cx + r * Math.cos(a)) * 100) / 100) + ' ' + (Math.round((cy + r * Math.sin(a)) * 100) / 100); }
    for (var i = 0; i < size; i++) {
      var a0 = 360 * i / size, a1 = 360 * (i + 1) / size;
      out.push({ i: i, on: i < filled, d: 'M' + cx + ' ' + cy + 'L' + pt(a0) + 'A' + r + ' ' + r + ' 0 0 1 ' + pt(a1) + 'Z' });
    }
    return out;
  };
  /* the dawn's three phases in ms, summing to the overlay's ms: a 2 s warm-to-white ramp, a white hold, a 2 s fade (a quarter of a very
     short run each). Under reduced motion it is white at once and straight back: no ramp, no fade. */
  Pure.dawnPhases = function (ms, reduce) {
    if (reduce) return { ramp: 0, hold: ms, fade: 0 };
    var edge = Math.min(2000, Math.floor(ms / 4));
    return { ramp: edge, hold: ms - 2 * edge, fade: edge };
  };
  /* dawnPlan(ms, age, reduce, reload) -> how a dawn that is `age` ms old (by the SERVER's clock) plays: { init: the data-phase to start in,
     ramp, fade: the ms for the css transitions, steps: [{ at: ms from now, phase }], end: ms from now }, or null at or past its ms.
     Every plan ends at ms - age, the server's end. Two cases:
       - a dawn this page watches arrive (reload false: the page was already running, and learns of it at its next poll, so age is the
         poll lag): the whole show, warm ramp and fade, with the white hold shortened by the lag, so a tap still warms up. When the ramp,
         a fade and some hold no longer fit, it falls through to the next case.
       - a dawn found on the page's first look (reload true: the page was just loaded): it carries on from where it has reached, never from
         the warm start again: inside the ramp it opens dark and runs only the rest of the ramp, in the hold it is white at once, in the
         fade only the rest of the fade. Age 0 is the whole dawn too. */
  Pure.dawnPlan = function (ms, age, reduce, reload) {
    var ph = Pure.dawnPhases(ms, reduce), e = Math.max(0, age || 0), left = ms - e;
    if (left <= 0) return null;
    if (!reload || e === 0) {
      if (!ph.ramp) return { init: 'hold', ramp: 0, fade: 0, steps: [], end: left };
      var hold = left - ph.ramp - ph.fade;
      if (hold >= 1) return { init: 'pre', ramp: ph.ramp, fade: ph.fade, steps: [{ at: 30, phase: 'ramp' }, { at: ph.ramp, phase: 'hold' }, { at: ph.ramp + hold, phase: 'fade' }], end: left };
    }
    var holdEnd = ph.ramp + ph.hold;
    if (!ph.ramp) return { init: 'hold', ramp: 0, fade: 0, steps: [], end: left };
    if (e < ph.ramp) { var r = ph.ramp - e; return { init: 'pre', ramp: r, fade: ph.fade, steps: [{ at: 30, phase: 'ramp' }, { at: Math.max(r, 60), phase: 'hold' }, { at: holdEnd - e, phase: 'fade' }], end: left }; }
    if (e < holdEnd) return { init: 'hold', ramp: 0, fade: ph.fade, steps: [{ at: holdEnd - e, phase: 'fade' }], end: left };
    return { init: 'fade', ramp: 0, fade: left, steps: [], end: left };
  };
  /* overlayCard(overlay) -> what a card draws, or null when there is nothing to draw. An npc card draws only what the SERVER joined to the
     overlay at read time (`o.npc`, present only while that NPC is revealed): name, alias, role and faction and the figure's spec, never the
     description, gmNotes or anything else. The page does not read the cast for it, so the table's display-only sign-in (which cannot) draws
     it too, and an overlay with no `npc` draws nothing at all. */
  Pure.overlayCard = function (o) {
    if (!o) return null;
    if (o.kind === 'clock') return { kind: 'clock', name: o.name, size: o.size, filled: o.filled, count: o.filled + ' / ' + o.size, wedges: Pure.clockWedges(o.size, o.filled) };
    if (o.kind === 'text') return { kind: 'text', text: o.text, size: Pure.textSize(o.text) };
    if (o.kind === 'fx') return { kind: 'fx', fx: o.fx };
    if (o.kind === 'npc') {
      if (!o.npc) return null;
      var n = Pure.playerNpc(o.npc);
      if (!n || !n.name) return null;
      return { kind: 'npc', name: n.name, alias: n.alias, sub: [n.role, n.faction].filter(Boolean).join(' · '), spec: n.spec };
    }
    return null;
  };

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
  /* a handout: the image fitted to the screen on black; a tap shows or hides the title caption; a missing file says so */
  function handoutStage(vm) {
    var e = el('div', 'dp-stage dp-handout'), img = el('img', 'dp-handout-img'), cap = el('p', 'dp-handout-cap', vm.title), off = null;
    img.alt = vm.title || 'Handout'; img.decoding = 'async'; img.draggable = false;
    cap.hidden = !vm.showTitle;
    img.onerror = function () { img.hidden = true; cap.hidden = false; cap.textContent = (vm.title ? vm.title + ': ' : '') + 'this handout is not on the server (app/media/handouts/' + vm.file + ').'; };
    img.src = vm.src;
    e.appendChild(img); e.appendChild(cap);
    off = on(e, 'click', function () { if (!img.hidden && vm.title) cap.hidden = !cap.hidden; });
    return { el: e, destroy: function () { if (off) off(); } };
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
      if (hooks && hooks.onTap) hooks.onTap();   /* a double tap resets the zoom (a single tap has no job since nothing overlays a map) */
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

  /* Does the svg name itself? A map-kit map or chase strip carries a <title> as its first child (and prints the place, the district
     and the surveyed bands in its own key), so the display adds no caption over it. Works on the sanitised root element. */
  Pure.svgOwnTitle = function (root) {
    if (!root || !root.childNodes) return '';
    for (var i = 0; i < root.childNodes.length; i++) {
      var c = root.childNodes[i];
      if (c && c.nodeType === 1 && localName(c) === 'title') return String(c.textContent || '').replace(/\s+/g, ' ').trim();
    }
    return '';
  };

  /* A map (or any svg): it fills the frame and nothing is drawn over it. When the svg names itself (Pure.svgOwnTitle) there is no
     caption; when it does not (the GM page's clocks picture), the title and caption sit in a bar under the frame, which is fitted to
     the space above the bar, so the drawing is never covered (GM.md, "The display"; checks/runtime/gm-maps.e2e.mjs). */
  function svgStage(vm) {
    var e = el('div', 'dp-stage dp-map'), frame = el('div', 'dp-map-frame');
    var res = Pure.sanitiseSvg(vm.svg, parserEnv());
    if (!res.ok) return noteStage(vm.title, 'This map could not be shown safely.');
    var svg = document.importNode(res.node, true);
    var own = Pure.svgOwnTitle(svg);
    svg.setAttribute('data-vb', [res.viewBox.x, res.viewBox.y, res.viewBox.w, res.viewBox.h].join(' '));   /* the drawing's own box (the zoom rewrites viewBox) */
    svg.setAttribute('focusable', 'false'); svg.setAttribute('role', 'img');
    if (vm.title) svg.setAttribute('aria-label', vm.title + (vm.caption ? ' · ' + vm.caption : ''));
    frame.appendChild(svg); e.appendChild(frame);
    var strip = null;
    if (!own && (vm.title || vm.caption)) {
      strip = el('div', 'dp-strip dp-capbar');
      if (vm.title) strip.appendChild(el('p', 'dp-strip-title', vm.title));
      if (vm.caption) strip.appendChild(el('p', 'dp-strip-cap', vm.caption));
      e.appendChild(strip);
      e.classList.add('dp-map-capped');
    }
    var zoom = null, ro = null;
    /* the frame ends where the caption bar starts (its height depends on the text and the screen) */
    function fitAboveBar() { if (strip) frame.style.bottom = Math.ceil(strip.getBoundingClientRect().height) + 'px'; }
    /* attachZoom needs the stage laid out, so it starts once the stage is attached */
    function ready() {
      if (zoom) return;
      fitAboveBar();
      if (strip && window.ResizeObserver) { ro = new ResizeObserver(function () { fitAboveBar(); }); ro.observe(strip); }
      zoom = attachZoom(frame, svg, res.viewBox, {});
    }
    return {
      el: e, attached: ready,
      destroy: function () { if (ro) ro.disconnect(); if (zoom) zoom.destroy(); }
    };
  }

  function buildStage(vm, seq, ctx) {
    try {
      if (vm.kind === 'svg') return svgStage(vm);
      if (vm.kind === 'text') return textStage(vm);
      if (vm.kind === 'dark') return darkStage(vm);
      if (vm.kind === 'rule') return ruleStage(vm);
      if (vm.kind === 'cards') return cardsStage(vm);
      if (vm.kind === 'handout') return handoutStage(vm);
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
      poll: { state: 'connecting' }, poller: null, reloader: null, wake: null, wakeWanted: true, enteredFs: false, dead: false
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
    /* the overlay layer sits over the stages (a spotlight included) and under the status and the buttons; the AUTO chip is its corner mark */
    var ovLayer = el('div', 'dp-overlay'); ovLayer.setAttribute('aria-hidden', 'true');
    var autoChip = el('div', 'dp-auto', 'AUTO'); autoChip.hidden = true; autoChip.setAttribute('aria-hidden', 'true');
    container.appendChild(layer); container.appendChild(stages); container.appendChild(ovLayer); container.appendChild(autoChip); container.appendChild(status); container.appendChild(chrome); container.appendChild(hint);

    function later(fn, ms) { var id = setTimeout(function () { var i = s.timers.indexOf(id); if (i >= 0) s.timers.splice(i, 1); if (!s.dead) fn(); }, ms); s.timers.push(id); return id; }
    function clearLater(id) { clearTimeout(id); var i = s.timers.indexOf(id); if (i >= 0) s.timers.splice(i, 1); }
    /* the ambient floor stays covered (nothing loads) until the first push arrives, and always when there is no poller */
    var amb = s.amb = createAmbient(s, layer, later, clearLater);

    /* The wire strip: one bulletin at a time over the ambient scenes (it lives in the ambient layer, under the stages, so a spotlight
       hides it). Shown for wireOnMs, then a gap of wireGapMs, round the list; nothing while a spotlight is up, the page is hidden or the
       ambient is off. ctx.ambientTiming = { wireOnMs, wireGapMs, wireFirstMs } overrides the pacing (tests). */
    var WT = { on: 14000, gap: 36000, first: 2500 };
    (function () {
      var o = isObj(ctx.ambientTiming) ? ctx.ambientTiming : timingHook();
      if (isObj(o)) { var a = Number(o.wireOnMs), b = Number(o.wireGapMs), c = Number(o.wireFirstMs); if (a > 0) WT.on = a; if (b > 0) WT.gap = b; if (c > 0) WT.first = c; }
    })();
    var wireEl = el('p', 'dp-wire'); wireEl.setAttribute('role', 'status'); layer.appendChild(wireEl);
    s.wire = { items: [], key: '', i: 0, t: null };
    function wireHide() { wireEl.classList.remove('dp-wire-on'); }
    function wireActive() { var st = amb.state(); return s.wire.items.length > 0 && !st.covered && st.mode !== 'off' && !document.hidden; }
    function wireCycle() {
      s.wire.t = null;
      if (!wireActive()) { wireHide(); return; }
      var it = s.wire.items[s.wire.i % s.wire.items.length]; s.wire.i++;
      wireEl.textContent = it.text; wireEl.classList.add('dp-wire-on');
      s.wire.t = later(function () { wireHide(); s.wire.t = later(wireCycle, WT.gap); }, WT.on);
    }
    function wireSync() {
      if (s.wire.t !== null) { clearLater(s.wire.t); s.wire.t = null; }
      wireHide();
      if (wireActive()) s.wire.t = later(wireCycle, WT.first);
    }
    s.offs.push(on(document, 'visibilitychange', wireSync));

    /* The overlay (Pure.OVERLAY, GM.md "Overlays"): a clock, an NPC, a line of text or the dawn laid over whatever is up. Each id shows
       once, for its ms from the moment this page first sees it; null or a new id takes it away. Cards take the right-hand 34% of the
       frame and the dawn the whole of it. Everything is drawn from the validated fields as text or as an svg built node by node. */
    s.ov = { seen: '', node: null, token: 0, timers: [], applied: false };
    function ovTimer(fn, ms) { var id = later(fn, ms); s.ov.timers.push(id); return id; }
    function ovRemove(now) {
      var node = s.ov.node; s.ov.token++; s.ov.node = null;
      s.ov.timers.forEach(clearLater); s.ov.timers = [];
      if (!node) return;
      if (now || reduced()) { if (node.parentNode) node.parentNode.removeChild(node); return; }
      node.classList.remove('dp-ov-in'); node.classList.add('dp-ov-out');
      later(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 450);
    }
    function svgEl(tag, attrs) {
      var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
      Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      return e;
    }
    function ovCardNode(card, o) {
      var e = el('div', 'dp-ov-card dp-ov-' + card.kind); e.setAttribute('data-ov-id', o.id);
      if (card.kind === 'clock') {
        var svg = svgEl('svg', { viewBox: '0 0 100 100', class: 'dp-ov-face' });
        card.wedges.forEach(function (w) { svg.appendChild(svgEl('path', { d: w.d, class: 'dp-ov-seg' + (w.on ? ' dp-ov-seg-on' : '') })); });
        e.appendChild(svg);
        e.appendChild(el('p', 'dp-ov-name', card.name));
        e.appendChild(el('p', 'dp-ov-count', card.count));
      } else if (card.kind === 'npc') {
        var pr = drawPortrait(card.spec, 'dp-ov-npc-' + o.id.replace(/[^A-Za-z0-9_-]/g, ''), ctx.figures);
        if (pr) { var holder = el('div', 'dp-ov-portrait'); holder.appendChild(document.importNode(pr.node, true)); e.appendChild(holder); }
        if (card.sub) e.appendChild(el('p', 'dp-kicker', card.sub));
        e.appendChild(el('p', 'dp-ov-name', card.name));
        if (card.alias) e.appendChild(el('p', 'dp-ov-alias', '“' + card.alias + '”'));
      } else {
        e.className += ' dp-t-' + card.size;
        e.appendChild(el('p', 'dp-ov-text', card.text));
      }
      return e;
    }
    function ovDawn(o) {
      var pl = Pure.dawnPlan(o.ms, o.age, reduced(), !s.ov.applied);
      if (!pl) return;
      var e = el('div', 'dp-ov-dawn'); e.setAttribute('data-ov-id', o.id);
      e.style.setProperty('--dp-dawn-ramp', pl.ramp + 'ms'); e.style.setProperty('--dp-dawn-fade', pl.fade + 'ms');
      e.appendChild(el('div', 'dp-ov-warm')); e.appendChild(el('div', 'dp-ov-glow'));
      e.setAttribute('data-phase', pl.init);
      ovLayer.appendChild(e); s.ov.node = e;
      pl.steps.forEach(function (st) { ovTimer(function () { e.setAttribute('data-phase', st.phase); }, st.at); });
      ovTimer(function () { ovRemove(true); }, pl.end);
    }
    function ovShow(o) {
      ovRemove(true);
      var my = s.ov.token;
      if (o.kind === 'fx') { ovDawn(o); return; }
      /* the card runs out at the server's end (ms less the age the server reports; a first sight is age 0), however long an NPC takes to load */
      var left = o.ms - (o.age || 0);
      if (left <= 0) return;
      ovTimer(function () { ovRemove(false); }, left);
      function put(card) {
        if (!card || s.dead || my !== s.ov.token) return;
        var node = ovCardNode(card, o);
        ovLayer.appendChild(node); s.ov.node = node; s.ov.sig = ovSig(o);
        later(function () { node.classList.add('dp-ov-in'); }, reduced() ? 0 : 30);
      }
      /* an npc card is drawn from what the server joined to the overlay (o.npc); the page reads nothing of the cast for it */
      put(Pure.overlayCard(o));
    }
    /* A clock card follows its clock: the server joins the clock's name, size and LIVE fill to the overlay on every answer, so when the same id
       arrives with another fill the card is redrawn in place (no new slide-in, the timers untouched). */
    function ovSig(o) { return o.kind === 'clock' ? [o.name, o.size, o.filled].join('|') : ''; }
    function ovRefresh(o) {
      if (!o || o.kind !== 'clock' || !s.ov.node || s.ov.sig === ovSig(o)) return;     /* no overlay (a 'keep' with nothing seen): nothing to refresh; this threw on the first ambient doc and skipped its setPlan */
      var card = Pure.overlayCard(o); if (!card) return;
      var old = s.ov.node, node = ovCardNode(card, o);
      node.classList.add('dp-ov-in');
      if (old.parentNode) old.parentNode.replaceChild(node, old);
      s.ov.node = node; s.ov.sig = ovSig(o);
    }
    /* Lights out (a spotlight of kind dark): nothing the autopilot sent is drawn over it, and neither is the AUTO chip. One that is up when the
       lights go out is taken off at once and its id stays seen, so it does not come back when the lights do (the server leaves it out of the answer
       while it is dark, and puts it back after). The ambient part of an answer is applied BEFORE its display part, so an autopilot overlay that
       arrives while this page still thinks it is dark is held until the display part says: drawn if the lights are back (this very answer),
       dropped if not. A GM-pressed overlay (the dawn) carries no `auto` mark and may be drawn over black. */
    s.dark = false; s.ov.auto = false; s.ov.chip = false; s.ov.held = null;
    function ovPaintChip() { autoChip.hidden = !(s.ov.chip && !s.dark); }
    function ovLightsOut(dark) {
      s.dark = !!dark;
      if (s.dark && s.ov.node && s.ov.auto) ovRemove(true);
      var h = s.ov.held; s.ov.held = null;
      if (h) { s.ov.seen = h.o.id; if (!s.dark && Date.now() - h.at < 8000) { ovShow(h.o); s.ov.auto = true; } }
      ovPaintChip();
    }
    /* The ambient part brings the AUTO flag (and, from an older server, the overlay); the overlay itself comes on every answer as its own small
       top-level field (onOverlay), applied after the display part. Once the field has been seen the ambient doc's copy is ignored. */
    function ovApply(doc) {
      var d = isObj(doc) ? doc : {};
      s.ov.chip = d.auto === true; ovPaintChip();
      if (!s.ov.field) ovStep(d.overlay);
    }
    function ovApplyField(overlay) { s.ov.field = true; ovStep(overlay); }
    function ovStep(raw) {
      var before = s.ov.seen, step = Pure.overlayStep(before, raw);
      s.ov.held = null;
      if (step.action === 'show' && step.overlay.auto && s.dark) {
        s.ov.held = { o: step.overlay, at: Date.now() };
        ovRemove(true); s.ov.auto = false;
      } else {
        s.ov.seen = step.action === 'hide' && s.dark ? before : step.seen;
        if (step.action === 'show') { ovShow(step.overlay); s.ov.auto = !!step.overlay.auto; }
        else if (step.action === 'hide') ovRemove(false);
        else ovRefresh(step.overlay);
      }
      s.ov.applied = true;   /* the first look is the page's reload: an overlay found then carries on; one that arrives later plays whole */
    }

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
      ovApply(doc);
      amb.setPlan(p);
      if (Pure.crewChanged(s.crew, p.crew)) Pure.ambientCrewScenes().forEach(function (id) { amb.post(id, Pure.crewMessage(p)); });
      s.crew = p.crew;
      var wk = JSON.stringify(p.wire);
      if (wk !== s.wire.key) { s.wire.key = wk; s.wire.items = p.wire; s.wire.i = 0; wireSync(); }
      else if (s.wire.items.length && s.wire.t === null && !wireEl.classList.contains('dp-wire-on')) wireSync();     /* the mode or the cover changed */
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

    /* ---------- the theme ----------
       A scene marked `music: true` in the registry (the opening credits) may ask for the theme, `Pure.AMBIENT_MUSIC` (an MP3 kept
       on the GM's PC and deployed from disk, never committed), with { type: 'b68:music', cmd: 'play' | 'fade', sec }. An iPad lets a
       page make sound only after a tap, so the first tap anywhere unlocks it; until then a chip asks for one. The scene is told
       where the music is ({ state: 'playing', t } once a second, or 'blocked', or 'none' when there is no file) and runs its clock
       from that. The music stops when its scene goes: another scene, a spotlight, lights out.
       The table can read what is going on: a one-line state in the corner (Pure.themeText) says "no file on the server", "tap the
       screen for sound", "playing · 0:42" or "would not play", so a silent iPad is never a mystery.
       iPad rules this follows: (1) the file is looked for first (a HEAD request), because iOS does not preload an <audio> and its
       play() refuses a missing file with the same kind of error as a locked one; (2) one <audio> element, created once in the page
       (never in the scene's frame) and played inside the tap's own call stack, which is what unlocks it: a play() made during a
       real gesture lifts iOS's restriction on that element for good, so the theme may start later without a tap; (3) only an event
       that is a gesture counts: a finger's pointerdown is not one on iOS (its pointerup, touchend and click are), and a muted
       play() succeeds there anyway, so where navigator.userActivation says the event is no gesture the tap is not spent on it;
       (4) no Web Audio: iOS mutes an AudioContext with the ring/silent switch and parks it 'interrupted' after a call or a lock,
       while a plain <audio> plays on; (5) iOS ignores audio.volume, so where the volume cannot move the fade is a stop at the end
       of the fade window. */
    var M = s.music = { audio: null, unlocked: false, pending: false, frame: null, tick: null, fade: null, watch: null, probe: null, file: null, http: 0, state: 'off', reason: '', hide: null };
    var chip = el('button', 'dp-btn dp-sound', 'Tap for sound'); chip.type = 'button'; chip.hidden = true;
    var themeLine = el('div', 'dp-theme'); themeLine.hidden = true; themeLine.setAttribute('role', 'status');
    container.appendChild(chip); container.appendChild(themeLine);
    function audioEl() {
      if (M.audio) return M.audio;
      var a = M.audio = new Audio(Pure.AMBIENT_MUSIC);
      a.preload = 'auto';
      a.addEventListener('ended', function () { if (M.state === 'playing') setTheme('ended'); });
      /* a file that fails after it started (the network, a bad MP3): say so instead of "playing" over silence */
      a.addEventListener('error', function () { if (M.state === 'playing') { stopTick(); playFailed({ name: '' }); } });
      return a;
    }
    /* is this event a user gesture? (navigator.userActivation: Safari 16.4+, Chrome; without it every event is tried) */
    function gesture() { var ua = typeof navigator !== 'undefined' && navigator.userActivation; return !ua || !!ua.isActive; }
    function tellMusic(msg) { var f = M.frame; if (f && f.contentWindow) { try { f.contentWindow.postMessage(msg, location.origin); } catch (e) { /* gone */ } } }
    function musicAlive() { var f = M.frame, st = amb.state(); return !!f && f.parentNode === layer && !st.covered && st.active === f.getAttribute('data-scene'); }
    function themeState() { return { state: M.state, http: M.http, reason: M.reason, t: M.audio ? M.audio.currentTime : 0 }; }
    function paintTheme() {
      var text = Pure.themeText(themeState());
      themeLine.textContent = text; themeLine.hidden = !text;
      themeLine.className = 'dp-theme' + (M.state === 'none' || M.state === 'error' || M.state === 'blocked' ? ' dp-theme-bad' : '');
      chip.hidden = !(M.state === 'locked' || M.state === 'blocked');
    }
    function setTheme(state, reason) {
      M.state = state; M.reason = reason || '';
      if (M.hide !== null) { clearLater(M.hide); M.hide = null; }
      if (state === 'ended') M.hide = later(function () { M.hide = null; if (M.state === 'ended') setTheme('off'); }, 8000);
      paintTheme();
    }
    function stopTick() { if (M.tick) { clearInterval(M.tick); M.tick = null; } if (M.fade) { clearInterval(M.fade); M.fade = null; } }
    /* is the file on the server? HEAD, same origin (the Access cookie rides along). null: could not ask (offline), so try anyway. */
    function probeTheme() {
      if (M.probe) return M.probe;
      var ask = typeof fetch === 'function' ? fetch(Pure.AMBIENT_MUSIC, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' }) : Promise.reject(new Error('no fetch'));
      M.probe = Promise.resolve(ask).then(function (r) {
        return { ok: !!(r && r.ok && Pure.themeType(r.headers && r.headers.get ? r.headers.get('Content-Type') : '')), http: r ? r.status : 0 };
      }, function () { return { ok: null, http: 0 }; }).then(function (v) {
        if (v.ok === null) M.probe = null;                      /* ask again next time */
        M.file = v.ok; M.http = v.http;
        return v;
      });
      return M.probe;
    }
    function playFailed(err) {
      var name = err && err.name || '';
      M.pending = false;
      if (name === 'NotAllowedError') { M.unlocked = false; setTheme('locked'); tellMusic({ type: 'b68:music', state: 'blocked' }); return; }
      /* the file is missing, is not audio, or would not load: a tap cannot help, say so */
      var code = M.audio && M.audio.error ? M.audio.error.code : 0;
      M.file = false;
      setTheme(M.http === 404 || (!M.http && code === 4) ? 'none' : 'error', name || (code ? 'media error ' + code : 'refused'));
      tellMusic({ type: 'b68:music', state: 'none' });
    }
    function unlockMusic() {
      if (M.unlocked || s.dead || M.file === false || !gesture()) return;     /* (no file on the server: nothing a tap could start) */
      var a = audioEl();
      /* the credits are waiting: start the theme in this tap, which is the unlock */
      if (M.frame && musicAlive() && M.file !== false) { startMusic(); return; }
      /* Nothing to play yet: play() inside this gesture (that call is what iOS remembers) and pause() at once, before a sample
         sounds. Not muted: a muted play() is allowed without any gesture, so its success would prove nothing; an unmuted one is
         refused at once (NotAllowedError) when the tap did not count, and is only interrupted (AbortError) when it did. */
      a.muted = false;
      var p; try { p = a.play(); } catch (e) { return; }
      try { a.pause(); } catch (e) { /* fine */ }
      M.unlocked = true; paintTheme();
      if (p && p.then) p.then(null, function (err) {
        /* refused: no gesture after all (a browser without navigator.userActivation, or a finger's pointerdown): the next event
           of this tap, or the next tap, tries again. Anything else (interrupted, no file): the tap did its part. */
        if (err && err.name === 'NotAllowedError') { M.unlocked = false; paintTheme(); }
      });
    }
    function startMusic() {
      var a = audioEl(), frame = M.frame;
      if (M.file === false) { setTheme(M.http === 404 || !M.http ? 'none' : 'error', M.http ? 'HTTP ' + M.http : ''); tellMusic({ type: 'b68:music', state: 'none' }); return; }
      if (M.pending) return;
      stopTick();
      try { a.muted = false; a.volume = 1; } catch (e) { /* iOS: the volume is the user's */ }
      try { a.currentTime = 0; } catch (e) { /* not loaded yet: it starts at 0 anyway */ }
      var go = function () {
        M.pending = false;
        if (s.dead || M.frame !== frame) { try { a.pause(); } catch (e) {} return; }
        M.unlocked = true;
        setTheme('playing');
        tellMusic({ type: 'b68:music', state: 'playing', t: a.currentTime });
        M.tick = setInterval(function () {
          if (!musicAlive()) { stopMusic(); return; }
          if (!a.paused) { tellMusic({ type: 'b68:music', state: 'playing', t: a.currentTime }); paintTheme(); }
        }, 1000);
      };
      M.pending = true;
      var p; try { p = a.play(); } catch (e) { playFailed(e); return; }
      if (p && p.then) p.then(go, playFailed); else go();
    }
    /* the fade: volume where it moves (a PC, Android); where it does not (iOS) the theme stops where the fade would have ended */
    function volumeMoves(a) {
      try { var v = a.volume, w = v > 0.5 ? v - 0.01 : v + 0.01; a.volume = w; var ok = Math.abs(a.volume - w) < 0.001; a.volume = v; return ok; } catch (e) { return false; }
    }
    function fadeMusic(sec) {
      var a = M.audio; if (!a || a.paused) return;
      var ms = Math.max(500, Math.min(30000, (Number(sec) || 4) * 1000));
      if (M.fade) { clearInterval(M.fade); M.fade = null; }
      if (volumeMoves(a)) {
        var t0 = Date.now(), v0 = a.volume;
        M.fade = setInterval(function () { var k = (Date.now() - t0) / ms; if (k >= 1 || a.paused) { clearInterval(M.fade); M.fade = null; return; } try { a.volume = Math.max(0, v0 * (1 - k)); } catch (e) {} }, 50);
      }
      later(function () { if (M.audio !== a) return; stopTick(); try { a.pause(); } catch (e) {} if (M.state === 'playing') setTheme('ended'); }, ms + 100);
    }
    function stopMusic() {
      stopTick();
      if (M.watch) { clearInterval(M.watch); M.watch = null; }
      if (M.audio) { try { M.audio.pause(); } catch (e) { /* fine */ } }
      M.frame = null; M.pending = false; setTheme('off');
    }
    /* the scene asked: look for the file first, then play, or ask for the tap. Whatever the theme's state (waiting for a tap, no
       file, playing, finished), it ends with its scene: another scene, a spotlight, lights out. */
    function askMusic(hit) {
      M.frame = hit;
      if (!M.watch) M.watch = setInterval(function () { if (M.frame && !musicAlive()) stopMusic(); }, 1000);
      setTheme('checking');
      probeTheme().then(function (v) {
        if (s.dead || M.frame !== hit) return;
        if (v.ok === false) { setTheme(v.http === 404 ? 'none' : 'error', v.http ? 'HTTP ' + v.http : 'not audio'); tellMusic({ type: 'b68:music', state: 'none' }); return; }
        if (M.unlocked) startMusic(); else { setTheme('locked'); tellMusic({ type: 'b68:music', state: 'blocked' }); }
      });
    }
    s.offs.push(on(window, 'message', function (ev) {
      if (s.dead || ev.origin !== location.origin || !ev.data || ev.data.type !== 'b68:music' || !ev.source) return;
      var frames = layer.querySelectorAll('iframe'), hit = null;
      for (var i = 0; i < frames.length; i++) {
        if (frames[i].contentWindow !== ev.source) continue;
        var sc = Pure.ambientScene(frames[i].getAttribute('data-scene'));
        if (sc && sc.music) hit = frames[i];
      }
      if (!hit) return;
      if (ev.data.cmd === 'play') askMusic(hit);
      else if (ev.data.cmd === 'fade' && M.frame === hit) fadeMusic(ev.data.sec);
    }));
    /* every kind of tap: iOS counts some of these as the gesture and not others (gesture() skips the rest), the first one is enough */
    ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'].forEach(function (type) { s.offs.push(on(document, type, unlockMusic)); });
    s.offs.push(function () { stopMusic(); });

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
      ovLightsOut(vm.kind === 'dark');                                          /* lights out: no autopilot overlay, no AUTO chip */
      wireSync();
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
      /* signed out for good (the adapter refuses every call once Access has ended the session): reload, once in a while (Pure.createReloader) */
      var reloads = Pure.reloadStore(window);
      s.reloader = Pure.createReloader({
        timers: { setTimeout: later, clearTimeout: clearLater },
        now: function () { return Date.now(); },
        last: reloads.last, remember: reloads.remember,
        reload: function () { try { window.location.reload(); } catch (e) { /* the page stays as it is */ } }
      });
      s.poller = Pure.createPoller({
        /* sseq rides as a third argument: the adapter (app/runtime/cf.js) forwards it as ?sseq= to make the unchanged answer
           the small one; an adapter that does not simply gets the transcriber part in full each time */
        fetch: function (seq, aseq, sseq) { return ctx.gm.display(seq === null ? undefined : seq, aseq === null ? undefined : aseq, sseq === null ? undefined : sseq); },
        isHidden: function () { return document.hidden; },
        onAmbient: function (doc) { applyAmbient(doc); },
        /* the transcriber's part of the answer goes to app/stt.js, which then makes no request of its own for it */
        onStt: function (part) { if (s.stt && typeof s.stt.feed === 'function') { try { s.stt.feed(part); } catch (e) { /* the page goes on */ } } },
        onData: function (display, seq, at) { s.seq = seq; s.updatedAt = at; paintStatus(); show(display, seq); },
        onOverlay: function (overlay) { ovApplyField(overlay); },
        onStatus: function (p) { s.poll = p; paintStatus(); s.reloader.state(p.state); }
      });
      s.poller.start();
      /* live sync: a poke for the display, the ambient or the transcriber makes the poll run now; the 4 s poll goes on unchanged */
      if (root.B68Live && typeof root.B68Live.on === 'function') { try { s.liveOff = root.B68Live.on(['display', 'ambient', 'stt'], function () { if (s.poller) s.poller.poke(); }); } catch (e) { s.liveOff = null; } }
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
    if (s.liveOff) { try { s.liveOff(); } catch (e) { /* ditto */ } s.liveOff = null; }
    if (s.poller) s.poller.stop();
    if (s.reloader) s.reloader.stop();
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
    state: function () { return S && S.amb ? S.amb.state() : null; },
    /* the theme, for the checks: unlocked, playing, the scene it plays for, the state line, and whether the tap chip shows */
    music: function () {
      var m = S && S.music; if (!m) return null;
      var line = S.container.querySelector('.dp-theme');
      return { unlocked: m.unlocked, playing: !!(m.audio && !m.audio.paused), scene: m.frame ? m.frame.getAttribute('data-scene') : null, failed: m.file === false,
        state: m.state, file: m.file, http: m.http, text: line && !line.hidden ? line.textContent : '', chip: !!S.container.querySelector('.dp-sound:not([hidden])') };
    }
  };
  var api = { mount: mount, unmount: unmount, ambient: ambient };
  if (typeof window !== 'undefined') window.B68DisplayPage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = { mount: mount, unmount: unmount, ambient: ambient, Pure: Pure };
})(typeof window !== 'undefined' ? window : globalThis);
