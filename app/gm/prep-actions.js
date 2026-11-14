/* gm/prep-actions.js — buttons inside the prep note (the players' screen build, PA). In the prep-actions bundle: gm-page.js fetches it only when a
   rendered note holds an action span, so a note without one draws, asks for and stores exactly what it did.

   THE GRAMMAR. An action span is an inline code span whose whole text starts with "▶ " (U+25B6, an optional U+FE0F, then a space) or ">> ",
   then "verb: argument". The verb is case-folded:
     ▶ handout: <name>              shows that handout on the shared screen (the page's showHandout, as the iPad panel's Show on iPad). <name> is
                                    the handout's id (its vault file stem), or its title, folded for case, spaces and punctuation; a unique prefix
                                    also matches. With phone.handouts on, a small "Send…" beside it opens the handouts list's own Send to… row.
     ▶ clock: <name> / <size> / <n> a table clock, hidden from the players, through the page's addClock (as Downtime and the co-GM add one). Size 4,
                                    6, 8 or 12 (default 4); n ticks to start (default 0). Fields are split at " / " (whitespace both sides): never a
                                    pipe, which would split a table cell. A clock of that name already on the table: the chip says where it
                                    stands and a tap only says so again. An add toasts with Undo (taken back only while it is as it was left).
     ▶ rule: <term>                 a pop-over at the chip with the best rule: the GM screen's section of that title, else the rules this device
                                    holds (B68Rules, the T tab's and Find's search). Hover (a mouse, 350 ms) or a tap opens it; Esc (B68GmEsc),
                                    a tap outside and its own ✕ close it. Open in Rules goes to the T tab.
     ▶ crew sheet                   not built (the shared screen has no crew-sheet kind): a muted chip that says so.
   Anything else (an unknown verb, a handout not in the pack, a clock size not allowed) is a muted chip showing the span's text, its title saying why.
   Nothing new is stored; nothing goes to the server but what the page's own functions send.

   PURE (Node tests)
     parse(text) -> null | { kind: 'handout'|'clock'|'rule'|'crew'|'unknown', verb, arg, text, clock?: { name, size, ticks } | { bad } }
     fold(s)                         lower case, accents and punctuation and spaces dropped: the name match's key
     matchHandout(list, name) -> { hit } | { many: [x] } | { none: true }     id first, then title; exact, then a unique prefix
     strip(md) -> md without its action spans (text and all): for any string that leaves the GM page (room-notes.js, stamp.js carry the same line)
     findRule(term, sections, hits) -> { src: 'screen', id, title, md } | { src: 'rules', id } | null     (hits: the rules module's best few)
     excerpt(md, M, n) -> plain text, about n characters, cut at a word
   DOM
     has(el) -> bool                 a code span in el is an action span (the page asks before it fetches this bundle)
     decorate(el, host)              every action span in el becomes a chip; chips already made are brought up to date
     refresh(el, host)               the chips' labels again (the clocks changed)
     tap(btn, host)                  a chip's click (data-gm="pa"), from the page's one click handler
     close()                         the pop-over shuts
   host: { handouts() -> [x], show(id) -> Promise, sendHtml(x) -> html | '', clocks() -> [clock], addClock(c) -> Promise, clockOps(ops) -> Promise,
           canClock() -> bool, toast(msg, bad), undoToast(text, undo) -> truthy when shown, screen() -> [section], rules() -> B68Rules | null,
           md() -> B68Markdown, openRule(r), esc() -> B68GmEsc | null }
   ES5, window.B68GmPrepActions in the browser, module.exports under Node. Every string from the note goes in as text or escaped. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmPrepActions = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var LEAD = /^\s*(?:▶️?|>>)[  ]+(\S[\s\S]*)$/;
  var SIZES = [4, 6, 8, 12], EXCERPT = 600, HOVER_MS = 350;
  /* an action span inside Markdown source: a run of backticks, the lead-in, anything, the same run (strip) */
  var SPAN_MD = /(`+)[  ]?(?:▶️?|>>)[  ][\s\S]*?\1/g;

  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fold(s) {
    var t = str(s);
    try { t = t.normalize('NFKD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* no normalize: as written */ }
    return t.toLowerCase().replace(/[^a-z0-9]+/g, '');
  }
  function words(s) { return str(s).replace(/\s+/g, ' ').trim(); }

  /* ---------- pure ---------- */
  function parseClock(arg) {
    var p = str(arg).split(/\s+\/\s+/).map(words), name = p[0] || '';
    if (!name) return { bad: 'The clock has no name.' };
    if (p.length > 3) return { bad: 'A clock takes a name, a size and a starting count: no more.' };
    var size = p.length > 1 ? (/^\d+$/.test(p[1]) ? +p[1] : NaN) : 4;
    if (SIZES.indexOf(size) < 0) return { bad: 'The size must be 4, 6, 8 or 12.' };
    var ticks = p.length > 2 ? (/^\d+$/.test(p[2]) ? +p[2] : NaN) : 0;
    if (!(ticks >= 0 && ticks <= size)) return { bad: 'The starting count must be a number from 0 to ' + size + '.' };
    return { name: name.slice(0, 60), size: size, ticks: ticks };
  }
  function parse(text) {
    var m = LEAD.exec(str(text)); if (!m) return null;
    var rest = words(m[1]), v = /^([A-Za-z][A-Za-z ]*?)\s*:\s*([\s\S]*)$/.exec(rest);
    var verb = (v ? v[1] : rest).toLowerCase().replace(/\s+/g, ' '), arg = v ? words(v[2]) : '';
    var out = { kind: 'unknown', verb: verb, arg: arg, text: rest };
    if (verb === 'handout' && arg) out.kind = 'handout';
    else if (verb === 'clock' && arg) { out.kind = 'clock'; out.clock = parseClock(arg); }
    else if (verb === 'rule' && arg) out.kind = 'rule';
    else if (!v && verb === 'crew sheet') out.kind = 'crew';
    return out;
  }
  function matchHandout(list, name) {
    var f = fold(name), l = (Array.isArray(list) ? list : []).filter(isObj);
    if (!f) return { none: true };
    var tiers = [
      function (x) { return fold(x.id) === f; }, function (x) { return fold(x.title) === f; },
      function (x) { return fold(x.id).indexOf(f) === 0 || fold(x.title).indexOf(f) === 0; }
    ];
    for (var i = 0; i < tiers.length; i++) {
      var hit = l.filter(tiers[i]);
      if (hit.length === 1) return { hit: hit[0] };
      if (hit.length > 1) return { many: hit };
    }
    return { none: true };
  }
  function strip(md) { return str(md).replace(SPAN_MD, ''); }
  /* the GM screen's section of that title first (the T tab's own text), then the rules: a title the term folds to, else the best hit */
  function findRule(term, sections, hits) {
    var f = fold(term); if (!f) return null;
    var secs = (Array.isArray(sections) ? sections : []).filter(function (s) { return isObj(s) && s.id && s.md; });
    var s = secs.filter(function (x) { return fold(x.title) === f; })[0];
    if (s) return { src: 'screen', id: str(s.id), title: str(s.title), md: str(s.md) };
    var h = (Array.isArray(hits) ? hits : []).filter(function (x) { return isObj(x) && x.id; });
    var e = h.filter(function (x) { return fold(x.title) === f; })[0] || h[0];
    if (e) return { src: 'rules', id: str(e.id) };
    s = secs.filter(function (x) { return fold(x.title).indexOf(f) >= 0; })[0];
    return s ? { src: 'screen', id: str(s.id), title: str(s.title), md: str(s.md) } : null;
  }
  function excerpt(md, Md, n) {
    n = n || EXCERPT;
    var t = Md && typeof Md.plain === 'function' ? str(Md.plain(str(md))) : str(md).replace(/[#*_`>\[\]]+/g, ' ');
    t = words(t);
    if (t.length <= n) return t;
    var cut = t.slice(0, n), sp = cut.lastIndexOf(' ');
    return (sp > n * 0.7 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '') + '…';
  }

  /* ---------- DOM ---------- */
  function textOf(el) { return el ? str(el.textContent) : ''; }
  function codes(el) { return el && el.querySelectorAll ? [].filter.call(el.querySelectorAll('code'), function (c) { return !(c.closest && c.closest('pre')); }) : []; }
  function has(el) { return codes(el).some(function (c) { return !!parse(textOf(c)); }); }

  function clockOf(host, name) {
    var f = fold(name), l = [];
    try { l = host && typeof host.clocks === 'function' ? host.clocks() : []; } catch (e) { l = []; }
    return (Array.isArray(l) ? l : []).filter(function (c) { return isObj(c) && fold(c.name) === f; })[0] || null;
  }
  var made = {};      /* fold(name) -> the clock this page just added, until the table's copy arrives (the chip reads as made at once) */
  function clockNow(host, name) {
    var c = clockOf(host, name), k = fold(name);
    if (c) { delete made[k]; return c; }
    return made[k] || null;
  }
  function handoutsOf(host) { try { var l = host && typeof host.handouts === 'function' ? host.handouts() : []; return Array.isArray(l) ? l : []; } catch (e) { return []; } }

  /* a chip's look from its span: { label, muted, why, mark, extra } */
  function look(p, host) {
    if (p.kind === 'handout') {
      var r = matchHandout(handoutsOf(host), p.arg);
      if (r.hit) return { label: str(r.hit.title) || p.arg, why: 'Show on iPad: ' + str(r.hit.title), x: r.hit };
      if (r.many) return { label: p.text, muted: true, why: 'More than one handout matches “' + p.arg + '”: ' + r.many.map(function (x) { return x.title; }).join(', ') };
      return { label: p.text, muted: true, why: 'No handout in the pack matches “' + p.arg + '”' };
    }
    if (p.kind === 'clock') {
      var k = p.clock;
      if (k.bad) return { label: p.text, muted: true, why: k.bad };
      var c = clockNow(host, k.name);
      if (c) return { label: 'Clock: ' + str(c.name) + ' ' + (Math.floor(+c.filled) || 0) + '/' + (+c.size || k.size), done: true, why: 'On the table already' + (c.hidden ? ', hidden from the players' : '') };
      return { label: 'Clock: ' + k.name + ' (' + k.size + ')', why: 'Add a table clock, hidden from the players: ' + k.name + ', ' + k.size + ' segments' + (k.ticks ? ', ' + k.ticks + ' ticked' : '') };
    }
    if (p.kind === 'rule') return { label: p.arg, rule: true, why: 'The rule: ' + p.arg };
    if (p.kind === 'crew') return { label: p.text, muted: true, why: 'Not built yet: the shared screen has no way to show the crew sheet' };
    return { label: p.text, muted: true, why: 'Not an action this page knows: ' + (p.verb || p.text) };
  }

  function paint(btn, host) {
    var p = parse(btn.getAttribute('data-pa')); if (!p) return;
    var L = look(p, host), doc = btn.ownerDocument, cls = 'pa-chip pa-' + p.kind + (L.muted ? ' pa-muted' : '') + (L.rule ? ' pa-rule' : '') + (L.done ? ' pa-done' : '');
    var sig = cls + '|' + L.label + '|' + L.why;
    if (btn.__paSig !== sig || !btn.firstChild) {      /* the page redraws often: the chip is rewritten only when it changed */
      btn.__paSig = sig; btn.className = cls;
      btn.title = L.why; btn.setAttribute('aria-disabled', String(!!L.muted));
      while (btn.firstChild) btn.removeChild(btn.firstChild);
      var mk = doc.createElement('span'); mk.className = 'pa-mark'; mk.setAttribute('aria-hidden', 'true'); mk.textContent = L.done ? '●' : '▶';
      var lb = doc.createElement('span'); lb.className = 'pa-l'; lb.textContent = L.label;
      btn.appendChild(mk); btn.appendChild(lb);
    }
    /* Send… beside a handout chip, while phone.handouts is on (the host gives its row only then) */
    var nx = btn.nextSibling, send = nx && nx.getAttribute && nx.getAttribute('data-pa-send') !== null ? nx : null;
    var want = p.kind === 'handout' && L.x && host && typeof host.sendHtml === 'function' && !!host.sendHtml(L.x);
    if (want && !send) {
      send = doc.createElement('button'); send.type = 'button'; send.className = 'pa-send'; send.setAttribute('data-gm', 'pa'); send.setAttribute('data-pa-send', '');
      send.textContent = 'Send…'; btn.parentNode.insertBefore(send, btn.nextSibling);
    }
    if (send && !want) { send.parentNode.removeChild(send); send = null; }
    if (send) { send.setAttribute('data-pa', btn.getAttribute('data-pa')); send.title = 'Send ' + str(L.x.title) + ' to a player’s phone'; send.setAttribute('aria-label', send.title); }
  }

  function decorate(el, host) {
    if (!el || !el.querySelectorAll) return;
    codes(el).forEach(function (c) {
      var t = textOf(c), p = parse(t); if (!p || !c.parentNode) return;
      var b = c.ownerDocument.createElement('button');
      b.type = 'button'; b.setAttribute('data-gm', 'pa'); b.setAttribute('data-pa', t);
      c.parentNode.replaceChild(b, c);
      if (p.kind === 'rule') hoverable(b, host);
    });
    refresh(el, host);
    if (rulesSeen(el)) warmRules(el, host);
  }
  function refresh(el, host) {
    if (!el || !el.querySelectorAll) return;
    [].forEach.call(el.querySelectorAll('button.pa-chip, button[data-pa]:not([data-pa-send])'), function (b) { paint(b, host); });
    [].forEach.call(el.querySelectorAll('button.pa-rule'), function (b) { ruleMute(b, host); });
  }

  /* ---------- the rules: what this device holds, read once (no download from a hover); a term with no rule mutes its chip ---------- */
  var warm = null;
  function rulesSeen(el) { return !!el.querySelector('button.pa-rule'); }
  function rulesOf(host) { try { var R = host && typeof host.rules === 'function' ? host.rules() : null; return R && typeof R.hits === 'function' && typeof R.entry === 'function' ? R : null; } catch (e) { return null; } }
  function screenOf(host) { try { var s = host && typeof host.screen === 'function' ? host.screen() : []; return Array.isArray(s) ? s : []; } catch (e) { return []; } }
  function hitsOf(R, term) { if (!R) return []; try { var r = R.hits(term, 5); return r && Array.isArray(r.hits) ? r.hits : []; } catch (e) { return []; } }
  function warmRules(el, host) {
    var R = rulesOf(host);
    if (!warm) warm = R && typeof R.load === 'function' ? Promise.resolve().then(function () { return R.load(true); }).then(function () { return true; }, function () { return true; }) : Promise.resolve(true);
    warm.then(function () { [].forEach.call(el.querySelectorAll('button.pa-rule'), function (b) { b.__paWarm = true; ruleMute(b, host); }); });
  }
  function ruleMute(b, host) {
    if (!b.__paWarm) return;
    var p = parse(b.getAttribute('data-pa')); if (!p) return;
    var hit = findRule(p.arg, screenOf(host), hitsOf(rulesOf(host), p.arg));
    b.classList.toggle('pa-muted', !hit);
    b.title = hit ? 'The rule: ' + p.arg : 'No rule called “' + p.arg + '” in the rules this device holds';
  }

  /* ---------- the pop-over: one at a time, at its chip ---------- */
  var pop = null, popFor = null, popPinned = false, unEsc = null, outside = null, hoverT = null, leaveT = null;
  function close() {
    if (hoverT) { clearTimeout(hoverT); hoverT = null; }
    if (leaveT) { clearTimeout(leaveT); leaveT = null; }
    if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
    if (popFor) popFor.setAttribute('aria-expanded', 'false');
    if (outside && popFor) { try { popFor.ownerDocument.removeEventListener('pointerdown', outside, true); } catch (e) {} }
    if (unEsc) { try { unEsc(); } catch (e) {} }
    pop = null; popFor = null; popPinned = false; unEsc = null; outside = null;
    return true;
  }
  function isOpen() { return !!(pop && pop.parentNode && popFor && popFor.isConnected !== false); }
  function place() {
    if (!pop || !popFor) return;
    var d = popFor.ownerDocument, w = d.defaultView || W, r = popFor.getBoundingClientRect(), vw = w.innerWidth || 1024, vh = w.innerHeight || 768;
    var pw = Math.min(380, vw - 16), ph = pop.offsetHeight || 200;
    pop.style.width = pw + 'px';
    pop.style.left = Math.max(8, Math.min(r.left, vw - pw - 8)) + 'px';
    var below = r.bottom + 6, above = r.top - 6 - ph;
    pop.style.top = (below + ph <= vh - 8 || above < 8 ? Math.max(8, Math.min(below, vh - ph - 8)) : above) + 'px';
  }
  function openPop(btn, host, pinned, fill) {
    if (popFor === btn && isOpen()) { if (pinned) popPinned = true; return; }
    close();
    var d = btn.ownerDocument, box = btn.closest('#gm-page') || d.body;
    pop = d.createElement('div'); pop.className = 'pa-pop'; pop.setAttribute('role', 'dialog');
    popFor = btn; popPinned = !!pinned; btn.setAttribute('aria-expanded', 'true');
    var head = d.createElement('div'); head.className = 'pa-pophead';
    var h = d.createElement('b'); h.className = 'pa-popt'; head.appendChild(h);
    var x = d.createElement('button'); x.type = 'button'; x.className = 'pa-x'; x.setAttribute('data-gm', 'pa'); x.setAttribute('data-pa-x', ''); x.setAttribute('aria-label', 'Close'); x.textContent = '✕';
    head.appendChild(x); pop.appendChild(head);
    var body = d.createElement('div'); body.className = 'pa-popb'; pop.appendChild(body);
    box.appendChild(pop);
    fill(h, body, d);
    pop.setAttribute('aria-label', h.textContent || 'Prep action');
    place();
    var E = host && typeof host.esc === 'function' ? host.esc() : null;
    if (E && typeof E.register === 'function') unEsc = E.register('pa.pop', { priority: 70, isOpen: isOpen, close: close });
    outside = function (ev) { var t = ev.target; if (pop && (pop.contains(t) || btn.contains(t))) return; close(); };
    d.addEventListener('pointerdown', outside, true);
    pop.addEventListener('pointerenter', function () { if (leaveT) { clearTimeout(leaveT); leaveT = null; } });
    pop.addEventListener('pointerleave', function (ev) { if (ev.pointerType === 'mouse' && !popPinned) leaveSoon(); });
  }
  function leaveSoon() { if (leaveT) clearTimeout(leaveT); leaveT = setTimeout(function () { leaveT = null; if (!popPinned) close(); }, 300); }

  function fillRule(btn, host) {
    var p = parse(btn.getAttribute('data-pa')), term = p ? p.arg : '';
    return function (h, body, d) {
      h.textContent = term;
      var msg = d.createElement('p'); msg.className = 'pa-dim'; msg.setAttribute('role', 'status'); msg.textContent = 'Loading…'; body.appendChild(msg);
      var R = rulesOf(host), mine = pop, Md = host && typeof host.md === 'function' ? host.md() : null;
      Promise.resolve().then(function () { return R && typeof R.load === 'function' ? R.load() : null; }).then(null, function () { return null; }).then(function () {
        if (pop !== mine) return;
        var hit = findRule(term, screenOf(host), hitsOf(R, term)), e = null;
        if (hit && hit.src === 'rules') { try { e = R.entry(hit.id); } catch (x) { e = null; } if (e) { hit.title = str(e.title); hit.md = str(e.md); hit.caption = str(e.caption); } else hit = null; }
        body.removeChild(msg);
        if (!hit) {
          var no = d.createElement('p'); no.className = 'pa-dim'; no.textContent = 'No rule called “' + term + '”' + (R ? '.' : ': the rules are not available here.'); body.appendChild(no);
          btn.classList.add('pa-muted'); place(); return;
        }
        h.textContent = hit.title || term; btn.classList.remove('pa-muted'); btn.title = 'The rule: ' + term;
        if (hit.caption) { var cap = d.createElement('p'); cap.className = 'pa-cap'; cap.textContent = hit.caption; body.appendChild(cap); }
        var tx = d.createElement('p'); tx.className = 'pa-text'; tx.textContent = excerpt(hit.md, Md) || '—'; body.appendChild(tx);
        var acts = d.createElement('p'); acts.className = 'pa-acts';
        var go = d.createElement('button'); go.type = 'button'; go.className = 'btn sm'; go.setAttribute('data-gm', 'pa'); go.setAttribute('data-pa-open', '');
        go.textContent = 'Open in Rules'; go.__paRule = { src: hit.src, id: hit.id, q: term };
        acts.appendChild(go); body.appendChild(acts);
        place();
      });
    };
  }
  function fillSend(x, host) {
    return function (h, body) {
      h.textContent = 'Send ' + str(x.title);
      var html = host && typeof host.sendHtml === 'function' ? str(host.sendHtml(x)) : '';
      body.innerHTML = html || '<p class="pa-dim">Sending to phones is off.</p>';      /* the handouts list's own escaped row (gm/handout-send.js html) */
    };
  }
  function hoverable(b, host) {
    b.addEventListener('pointerenter', function (ev) {
      if (ev.pointerType !== 'mouse') return;
      if (leaveT && popFor === b) { clearTimeout(leaveT); leaveT = null; return; }
      if (hoverT) clearTimeout(hoverT);
      hoverT = setTimeout(function () { hoverT = null; if (b.isConnected !== false) openPop(b, host, false, fillRule(b, host)); }, HOVER_MS);
    });
    b.addEventListener('pointerleave', function (ev) {
      if (ev.pointerType !== 'mouse') return;
      if (hoverT) { clearTimeout(hoverT); hoverT = null; }
      if (popFor === b && !popPinned) leaveSoon();
    });
  }

  /* ---------- taps ---------- */
  var busy = {};
  function tap(btn, host) {
    if (!btn || !btn.getAttribute) return;
    if (btn.hasAttribute('data-pa-x')) { close(); return; }
    if (btn.hasAttribute('data-pa-open')) { var r = btn.__paRule; close(); if (r && host && typeof host.openRule === 'function') host.openRule(r); return; }
    var p = parse(btn.getAttribute('data-pa')); if (!p) return;
    if (btn.hasAttribute('data-pa-send')) {
      var m = matchHandout(handoutsOf(host), p.arg);
      if (popFor === btn && isOpen()) { close(); return; }
      if (m.hit) openPop(btn, host, true, fillSend(m.hit, host));
      return;
    }
    if (p.kind === 'rule') {
      if (popFor === btn && isOpen()) { if (popPinned) close(); else popPinned = true; return; }
      openPop(btn, host, true, fillRule(btn, host)); return;
    }
    var L = look(p, host);
    if (L.muted) { host.toast(L.why + '.', true); return; }
    if (p.kind === 'handout') {
      if (busy['h|' + L.x.id]) return;
      busy['h|' + L.x.id] = true;
      Promise.resolve().then(function () { return host.show(L.x.id); }).then(function () { delete busy['h|' + L.x.id]; }, function () { delete busy['h|' + L.x.id]; });
      return;
    }
    if (p.kind === 'clock') addClock(btn, p.clock, host);
  }
  function addClock(btn, k, host) {
    var key = 'c|' + fold(k.name), c = clockNow(host, k.name);
    if (c) { host.toast('Clock: ' + str(c.name) + ' stands at ' + (Math.floor(+c.filled) || 0) + '/' + (+c.size || k.size) + (c.hidden ? ', hidden from the players' : '') + '. Nothing added.'); return; }
    if (busy[key]) return;
    if (!host.canClock()) { host.toast('The table is not available here: start the clock on the table page.', true); return; }
    var clock = { id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: k.name, size: k.size, filled: k.ticks, kind: 'danger', hidden: true };
    busy[key] = true; btn.setAttribute('aria-busy', 'true');
    Promise.resolve().then(function () { return host.addClock(clock); }).then(function (r) {
      delete busy[key]; btn.removeAttribute('aria-busy');
      if (r === false) throw new Error('The clock was not added.');
      made[fold(k.name)] = { id: clock.id, name: clock.name, size: clock.size, filled: clock.filled, hidden: true };
      paintAll(btn, host);
      var text = 'Clock added, hidden from the players: ' + k.name + ' ' + k.ticks + '/' + k.size + '.';
      var undo = function () { return undoClock(clock, host).then(function (msg) { paintAll(btn, host); return msg; }); };
      if (!(typeof host.undoToast === 'function' && host.undoToast(text, undo))) ownToast(btn.ownerDocument, text, undo);
    }).then(null, function (e) {
      delete busy[key]; btn.removeAttribute('aria-busy');
      host.toast('Could not add the clock: ' + (e && e.message || e), true);
    });
  }
  function paintAll(btn, host) { var d = btn.ownerDocument; [].forEach.call(d.querySelectorAll('button.pa-chip'), function (b) { paint(b, host); }); }
  /* Undo: only while the clock is as it was left (the co-GM's rule); a clock the table changed since stays */
  function undoClock(clock, host) {
    var live = clockOf(host, clock.name), mine = live && live.id === clock.id ? live : null;
    if (live && !mine) return Promise.resolve('Not undone: another clock of that name is on the table.');
    if (mine && ((Math.floor(+mine.filled) || 0) !== clock.filled || +mine.size !== clock.size || mine.hidden !== true)) return Promise.resolve('Not undone: the clock has changed since. Change it on the table page.');
    return Promise.resolve().then(function () { return host.clockOps([{ remove: clock.id }]); }).then(function () { delete made[fold(clock.name)]; return 'Undone: the clock is off the table.'; });
  }
  /* a toast with Undo when the page's own (the cue grammar's) is not there */
  var tEl = null, tT = null;
  function ownToast(d, text, undo) {
    if (!d || !d.body) return;
    if (tEl && tEl.parentNode) tEl.parentNode.removeChild(tEl);
    if (tT) clearTimeout(tT);
    var el = tEl = d.createElement('div'); el.className = 'pa-toast'; el.setAttribute('role', 'status');
    var t = d.createElement('span'); t.textContent = text; el.appendChild(t);
    var b = d.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.textContent = 'Undo'; el.appendChild(b);
    var gone = function (ms) { tT = setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); if (tEl === el) tEl = null; }, ms); };
    b.addEventListener('click', function () {
      if (tT) clearTimeout(tT); b.disabled = true;
      Promise.resolve().then(undo).then(function (m) { t.textContent = typeof m === 'string' ? m : 'Undone.'; if (b.parentNode) b.parentNode.removeChild(b); gone(2500); },
        function (e) { t.textContent = 'Could not undo that: ' + (e && e.message || e); if (b.parentNode) b.parentNode.removeChild(b); gone(4000); });
    });
    (d.getElementById('gm-page') || d.body).appendChild(el);
    gone(6000);
  }

  return { SIZES: SIZES, parse: parse, parseClock: parseClock, fold: fold, matchHandout: matchHandout, strip: strip, findRule: findRule, excerpt: excerpt,
    has: has, decorate: decorate, refresh: refresh, tap: tap, close: close, isOpen: isOpen, _esc: esc };
});
