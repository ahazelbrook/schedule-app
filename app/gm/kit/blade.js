/* gm/kit/blade.js: the Blade panel on the new desk (kit.desk, KS07 of the kit and stage build) and, below, the pitch seat (blade.pitches, KS18; KS19's cards).
   The file is in two bundles, kit-desk and blade-pitches, so it may be here while the desk is off: B68KitBlade then does nothing at all. Loaded twice, it
   starts once. It defines B68KitBlade when it loads and reads other modules only when it is called (the kit's load-order rule).

   B68KitBlade: Alex, 07/11: "the text is too big so could only see one card... Easier to dismiss cards." With the desk on (B68Kit.on('desk')) and the UI
   kit here (B68Ui), every live Blade panel (app/gm/assist-panel.js: B68GmAssist.live(), or the panel hands itself to attach() when the kit came first)
   gets a view through its bridge (bridge.use(view)); the desk going off takes it back (bridge.use(null)) and undoes everything the view changed. The panel's
   own handlers stay: a kit card keeps every hook the old card had (as-card, data-id / seat / kind / open, .as-fold[data-as=fold], .as-kind, .as-text, time,
   .as-more, .as-acts and data-as on every action), so Enter, J, K, U, Esc, More, Keep, Undo and Got it run the old code.
     Where it lives  the right-edge tab (#as-launch) is hidden (it stays in the page, with its count and pips, for the band and the checks); body.as-tab is not
                     set (the panel's own seam), so the 44 px kept for the tab go back to the page. Key A (and the band's Blade button) opens the panel, docked
                     right as now. The Now zone (the newest card again, open) is hidden: the card is first in the feed.
     Compact cards   a Card (B68Ui) with the kind as its colour edge and one word: rule rules-blue, warn (Stop) alarm, done ok, idea caution, say accent,
                     note ink. Folded: the word and the headline, two lines at 14 px, and the time; a click or Enter opens the whole card in place, at 14 px.
     Dismissing      an X on every card (data-as="ack": the panel's own Got it); Delete or Backspace on a focused card presses it and focus moves to the next;
                     a quiet "Clear all" by the filter chips dismisses the cards shown that have nothing to press and are not pinned or kept (one mark per 50).
                     An idea card fades after FADE_MS (90 s) in view (the panel open, the page visible, the card in the list), dimming for the last WARN_MS:
                     it leaves this page only (no mark is sent, so a reload brings it back). It never fades while pinned (its Pin), kept, open, under the
                     pointer or holding the focus, when it is an Ask answer, or when it has something to press (Undo, an action, a chip).
     Put away        the Screen section (#as-screen) is hidden: the Tools drawer is Fit it and the Ledger. The Ask box goes to the foot (feed, Tools, Ask), its
                     placeholder cut to one line. A rule or Stop card that arrives with the panel shut goes to the toast stack when the UI kit has one (B68Ui.toast, KS03), with Open;
                     until then the old strip.
   API (window.B68KitBlade; module.exports under Node, which also carries KS18's B68Pitches)
     attach(bridge)          a panel's bridge (assist-panel.js calls it at create when this file is already here)
     sync()                  every panel follows the desk now (B68Kit.onChange calls it)
     on() -> bool            the desk is on and the kit is here
     pure: EDGE, FADE_MS, WARN_MS, pressable(card, canUndo), fadeStep(ms, dt, held) -> { ms, phase: 'ok' | 'fading' | 'gone' } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root && root.document && !root.B68KitBlade) { root.B68KitBlade = M; M.start(); }
})(typeof window !== 'undefined' ? window : null, function (W) {
  'use strict';

  var FADE_MS = 90000, WARN_MS = 8000, HOLD_MS = 10000, TICK_MS = 1000;
  var EDGE = { rule: 'rules', warn: 'alarm', done: 'ok', idea: 'caution', say: 'accent', note: 'ink' };
  var ASK_PH = 'Ask Blade: a ruling, an idea…';      /* the old one runs to a second line the 44 px field cannot show */
  var TONE = { ok: 'ok', bad: 'caution', unk: 'caution', wait: 'plain' };
  var DISMISS_WORDS = /^(got it|dismiss|clear|hide)\b/i;      /* a page card's Got-it label that only says "dismiss": the X says it already */
  var bridges = [], views = [], listening = false;

  function str(v) { return v == null ? '' : String(v); }
  function clip(s, n) { s = str(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  /* a card with something to press never fades and is never cleared: Undo, an action, a chip */
  function pressable(c, canUndo) { return !!(canUndo || (c && Array.isArray(c.actions) && c.actions.length) || (c && Array.isArray(c.chips) && c.chips.length)); }
  /* the fade clock of one card: held (under the pointer, focused) stops it, at least HOLD_MS before the dim, so a card let go of stays a little longer */
  function fadeStep(ms, dt, held) {
    var m = held ? Math.min(ms, FADE_MS - WARN_MS - HOLD_MS) : ms + Math.max(0, dt || 0);
    return { ms: m, phase: m >= FADE_MS ? 'gone' : m >= FADE_MS - WARN_MS ? 'fading' : 'ok' };
  }

  function on() { var K = W && W.B68Kit, U = W && W.B68Ui; return !!(K && typeof K.on === 'function' && K.on('desk') && U && typeof U.node === 'function'); }

  /* ---------- one panel's view ---------- */
  function makeView(b) {
    var doc = b.doc, h = b.h, st = b.st, U = W.B68Ui;
    var pinned = {}, fade = {}, ticker = null, last = 0, saved = { small: null, ph: null }, els = { clear: null }, wired = null, dead = false;
    function host() { return b.host(); }
    function q(sel) { var x = host(); return x ? x.querySelector(sel) : null; }
    function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; }
    function btn(o) { return U.node('button', o, doc); }
    function chip(o) { return U.node('chip', o, doc); }
    function canFade(c) {
      return !!c && h.cardKind(c) === 'idea' && !c.mock && c.src !== 'ask' && !c.kept && !pinned[c.id] && !h.isOpen(c, false) && !pressable(c, h.canUndo(c));
    }
    function fadeKind(c) { return !!c && h.cardKind(c) === 'idea' && !c.mock && c.src !== 'ask' && !pressable(c, h.canUndo(c)); }      /* gets a Pin */
    function clearable(c) { return !!c && !c.mock && !c.kept && !pinned[c.id] && !pressable(c, h.canUndo(c)); }

    /* ---- the card ---- */
    function card(c, now) {
      var k = h.cardKind(c), kd = h.KIND[k] || h.KIND.note, open = h.isOpen(c, now), data = { id: c.id, seat: c.seat, kind: k, open: open ? '1' : '0' };
      if (c.mock) data.mock = true;
      var root = U.node('card', { tag: now ? 'div' : 'li', edge: EDGE[k] || 'ink', cls: ['as-card', 'kbl-card'].concat(now ? ['as-now-card'] : []), data: data }, doc);
      var head = el('div', 'kbl-head');
      var fold = now ? el('div', 'as-fold kbl-fold') : btn({ label: '', rank: 'quiet', cls: ['as-fold', 'kbl-fold'], data: { as: 'fold', id: c.id }, attrs: { 'aria-expanded': String(open) } });
      var line = el('span', 'kbl-line'), kind = el('span', 'as-kind kbl-kind'), gl = el('span', 'as-glyph', kd.glyph);
      gl.setAttribute('aria-hidden', 'true'); kind.appendChild(gl); kind.appendChild(el('b', null, kd.word));
      var tx = el('span', 'as-text kbl-text'); h.appendInline(doc, tx, c.headline);
      line.appendChild(kind); line.appendChild(doc.createTextNode(' ')); line.appendChild(tx);
      fold.appendChild(line);
      fold.appendChild(c.mock ? el('span', 'as-eg kbl-time', 'example') : el('time', 'kbl-time', h.hhmm(c.at)));
      head.appendChild(fold);
      if (!now) {
        var side = el('span', 'kbl-side');
        if (fadeKind(c) && !c.kept) side.appendChild(btn({ label: pinned[c.id] ? 'Pinned' : 'Pin', rank: 'quiet', cls: 'kbl-pin', pressed: !!pinned[c.id], data: { kbl: 'pin', id: c.id },
          title: 'Pin it: it stays. An idea fades after 90 seconds in view.' }));
        if (!c.mock) side.appendChild(btn({ label: '×', rank: 'quiet', cls: ['as-ack', 'kbl-x'], data: { as: 'ack', id: c.id }, title: (c.ackLabel && !DISMISS_WORDS.test(c.ackLabel) ? c.ackLabel : 'Dismiss') + ' (Delete)',
          attrs: { 'aria-label': 'Dismiss: ' + clip(c.headline, 60) } }));
        if (side.firstChild) head.appendChild(side);
      }
      root.appendChild(head);
      root.appendChild(body(c, k, open));
      if (fade[c.id] && fade[c.id].phase === 'fading') root.setAttribute('data-kbl-fading', '');
      return root;
    }
    function band(cls, label, text) {
      var d = el('div', cls); d.appendChild(el('b', 'as-band kbl-band', label));
      h.appendInline(doc, d.appendChild(el('p', 'as-band-text kbl-band-text')), text);
      return d;
    }
    function body(c, k, open) {
      var more = el('div', 'as-more kbl-more');
      if (c.src === 'ask' && c.q) more.appendChild(el('p', 'as-askq kbl-meta', 'You asked: ' + c.q));
      if (c.bullets.length) { var ul = el('ul', 'as-bullets kbl-bullets'); c.bullets.forEach(function (x) { h.appendInline(doc, ul.appendChild(el('li')), x); }); more.appendChild(ul); }
      if (typeof h.figFns[c.id] === 'function' && c.figKey) {
        var fig = null; try { fig = h.figFns[c.id](); } catch (e) { fig = null; }
        if (fig && fig.nodeType === 1) more.appendChild(fig);
      }
      if (c.body) {
        var bd = el('div', 'as-body kbl-boxed'); if (c.bodyLabel) bd.appendChild(el('b', 'as-band kbl-band', c.bodyLabel));
        bd.appendChild(el('pre', 'as-body-text kbl-pre', c.body)); more.appendChild(bd);
      }
      if (c.say) more.appendChild(band('as-say kbl-say', 'SAY', c.say));
      if (c.secret) more.appendChild(band('as-secret kbl-secret', 'GM ONLY', c.secret));
      var chips = el('div', 'as-chiprow kbl-chips');
      if (h.SEAT[c.seat]) chips.appendChild(chip({ label: h.SEAT[c.seat], cls: 'as-seatname' }));
      (c.chips || []).forEach(function (x) { chips.appendChild(chip({ label: x.text, tone: TONE[x.tone] || 'plain', cls: ['as-chip2'].concat(x.tone ? ['as-tone-' + x.tone] : []) })); });
      if (c.cite) chips.appendChild(chip({ label: c.cite, tone: 'rules', cls: 'as-cite' }));
      if (c.check) chips.appendChild(chip({ label: h.CHECK_WORD[c.check] || 'Check', tone: 'rules', cls: 'as-check' }));
      if (c.citeBad && c.citeBad.length) chips.appendChild(chip({ label: 'cite?', tone: 'caution', cls: 'as-citeflag', title: 'The gatekeeper could not match this page cite to the rule: ' + c.citeBad.join('; ') }));
      if (chips.firstChild) more.appendChild(chips);
      if (c.important) more.appendChild(el('p', 'as-saved kbl-meta', c.filed ? 'Saved to campaign history' : 'In tonight’s log; gm:after files it to history'));
      if (c.more && st.moreOpen[c.id]) {
        var det = el('div', 'as-detail kbl-detail'), html = h.moreHtml(c);
        if (html !== null) det.innerHTML = html;      /* as the old card: B68Markdown.render escapes all raw HTML */
        else { det.textContent = c.more; det.className = 'as-detail as-detail-plain kbl-detail kbl-plain'; }
        more.appendChild(det);
      }
      var acts = el('div', 'as-acts kbl-acts');
      (c.actions || []).forEach(function (a) {
        acts.appendChild(btn({ label: a.label, rank: a.primary ? 'standard' : 'quiet', cls: ['as-act'].concat(a.primary ? ['as-act-primary'] : []), data: { as: 'act', id: c.id, act: a.id }, title: a.title || '', disabled: !!a.disabled }));
      });
      var mo = !!st.moreOpen[c.id];
      if (c.more) acts.appendChild(btn({ label: mo ? 'Less' : 'More', rank: 'quiet', cls: 'as-moreb', data: { as: 'more', id: c.id }, attrs: { 'aria-expanded': String(mo), 'aria-label': mo ? 'Hide the detail' : 'Show the detail' } }));
      if (h.canKeep(c)) acts.appendChild(c.kept ? el('span', 'as-kept kbl-meta', '★ Kept') : btn({ label: 'Keep', rank: 'quiet', cls: 'as-star', data: { as: 'keep', id: c.id }, attrs: { 'aria-label': 'Keep this card: file it as a Moment' } }));
      if (k === 'done' && c.undone) acts.appendChild(el('span', 'as-kept kbl-meta', 'Undone'));
      else if (h.canUndo(c)) acts.appendChild(btn({ label: 'Undo', rank: 'standard', cls: 'as-undo', key: 'U', data: { as: 'undo', id: c.id }, attrs: { 'aria-label': 'Undo this (U)' } }));
      if (!c.mock && c.ackLabel && !DISMISS_WORDS.test(c.ackLabel)) acts.appendChild(btn({ label: c.ackLabel, rank: 'quiet', cls: 'as-ack', data: { as: 'ack', id: c.id } }));
      if (acts.firstChild) more.appendChild(acts);
      return more;
    }

    /* ---- the panel around the cards ---- */
    function listed() {
      var l = q('#as-list'), out = {};
      if (l) Array.prototype.forEach.call(l.children, function (li) { var id = li.getAttribute && li.getAttribute('data-id'); if (id) out[id] = li; });
      return out;
    }
    function clearIds() { return h.feedOf(st.cards, st.filter).filter(clearable).map(function (c) { return c.id; }); }
    function paint() {
      var x = host(); if (!x || dead) return;
      [['#as-launch'], ['#as-nowz'], ['#as-screen']].forEach(function (s) { var e = q(s[0]); if (e && !e.hidden) e.hidden = true; });
      var ta = q('#as-ask-q'); if (ta) { if (saved.ph === null) saved.ph = ta.getAttribute('placeholder'); if (ta.getAttribute('placeholder') !== ASK_PH) ta.setAttribute('placeholder', ASK_PH); }
      var sm = q('.as-tools summary small'); if (sm) { if (saved.small === null) saved.small = sm.textContent; if (sm.textContent !== 'Fit it · Ledger') sm.textContent = 'Fit it · Ledger'; }
      [['.as-body', 'kbl-body'], ['#as-feed', 'kbl-feed'], ['#as-list', 'kbl-list'], ['#as-ask', 'kbl-ask'], ['#as-tools', 'kbl-tools']].forEach(function (p) { var e = q(p[0]); if (e && !e.classList.contains(p[1])) e.classList.add(p[1]); });
      var feed = q('#as-feed'), chipsEl = q('#as-chips');
      if (feed && (!els.clear || els.clear.parentNode !== feed)) {
        els.clear = btn({ label: 'Clear all', rank: 'quiet', cls: 'kbl-clear', data: { kbl: 'clear' }, title: 'Dismiss the cards shown here. Pinned and kept cards, and any with something to press, stay.' });
        feed.insertBefore(els.clear, chipsEl ? chipsEl.nextSibling : feed.firstChild);
      }
      if (els.clear) { var none = !clearIds().length; if (els.clear.hidden !== none) els.clear.hidden = none; }
      wire(x);
      var li = listed();
      Object.keys(fade).forEach(function (id) { var n = li[id]; if (n && fade[id].phase === 'fading' && !n.hasAttribute('data-kbl-fading')) n.setAttribute('data-kbl-fading', ''); });
      clock();
    }
    function unpaint() {
      var x = host(); if (!x) return;
      ['#as-launch', '#as-nowz', '#as-screen'].forEach(function (s) { var e = q(s); if (e) e.hidden = false; });
      var ta = q('#as-ask-q'); if (ta && saved.ph !== null) ta.setAttribute('placeholder', saved.ph);
      var sm = q('.as-tools summary small'); if (sm && saved.small !== null) sm.textContent = saved.small;
      [['.as-body', 'kbl-body'], ['#as-feed', 'kbl-feed'], ['#as-list', 'kbl-list'], ['#as-ask', 'kbl-ask'], ['#as-tools', 'kbl-tools']].forEach(function (p) { var e = q(p[0]); if (e) e.classList.remove(p[1]); });
      if (els.clear && els.clear.parentNode) els.clear.parentNode.removeChild(els.clear);
      els.clear = null;
    }

    /* ---- the keys, the clicks and what the pointer holds ---- */
    function cardOf(t) { var li = t && t.closest ? t.closest('.kbl-card[data-id]') : null; var l = q('#as-list'); return li && l && li.parentNode === l ? li : null; }
    function onKey(ev) {
      if ((ev.key !== 'Delete' && ev.key !== 'Backspace') || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) return;
      var t = ev.target, n = t && t.tagName ? t.tagName.toLowerCase() : '';
      if (n === 'input' || n === 'textarea' || n === 'select' || (t && t.isContentEditable)) return;
      var li = cardOf(t), x = li && li.querySelector('.kbl-x'); if (!x) return;
      ev.preventDefault();
      var sib = li.nextElementSibling; while (sib && !sib.getAttribute('data-id')) sib = sib.nextElementSibling;
      if (!sib) { sib = li.previousElementSibling; while (sib && !sib.getAttribute('data-id')) sib = sib.previousElementSibling; }
      var next = sib ? sib.getAttribute('data-id') : '';
      x.click();
      focusCard(next);
    }
    function focusCard(id) {
      var l = q('#as-list'); if (!l) return;
      var f = Array.prototype.filter.call(l.querySelectorAll('[data-as="fold"]'), function (e) { return e.getAttribute('data-id') === id; })[0];
      if (!f) { var nm = q('#as-name'); f = nm; }
      if (f) { try { f.focus({ preventScroll: false }); } catch (e) {} }
    }
    function onClick(ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-kbl]') : null; if (!t || dead) return;
      var a = t.getAttribute('data-kbl'), id = t.getAttribute('data-id');
      if (a === 'pin' && id) {
        if (pinned[id]) delete pinned[id]; else { pinned[id] = true; delete fade[id]; }
        t.setAttribute('aria-pressed', String(!!pinned[id])); t.textContent = pinned[id] ? 'Pinned' : 'Pin';
        var li = cardOf(t); if (li) li.removeAttribute('data-kbl-fading');
        clock();
      } else if (a === 'clear') {
        var ids = clearIds(); ids.forEach(function (i) { delete fade[i]; });
        b.dismiss(ids);
      }
    }
    /* held: the pointer is on it, or the focus is in it, read from the browser at each tick (the CSS brings a dimming card back at once) */
    function isHeld(li) {
      try { return !!li && (li.matches(':hover') || li.contains(doc.activeElement)); } catch (e) { return false; }
    }
    function wire(x) {
      if (wired === x) return;
      unwire();
      x.addEventListener('keydown', onKey); x.addEventListener('click', onClick);
      wired = x;
    }
    function unwire() {
      var x = wired; wired = null; if (!x) return;
      x.removeEventListener('keydown', onKey); x.removeEventListener('click', onClick);
    }

    /* ---- the fade: one clock while the panel is open and an idea can fade; time counts only while the page is visible ---- */
    function clock() {
      var want = !dead && st.open && st.cards.some(canFade);
      if (want && !ticker && h.setI) { last = Date.now(); ticker = h.setI(tick, TICK_MS); }
      else if (!want && ticker) { if (h.clrI) h.clrI(ticker); ticker = null; last = 0; }
    }
    function tick() {
      if (dead) return;
      var t = Date.now(), dt = last && !(doc && doc.hidden) ? t - last : 0; last = doc && doc.hidden ? 0 : t;
      var li = listed(), gone = [];
      st.cards.forEach(function (c) {
        if (!canFade(c)) { delete fade[c.id]; return; }
        if (!li[c.id]) return;                      /* not in the list (another filter): not in view */
        var f = fade[c.id] = fadeStep(fade[c.id] ? fade[c.id].ms : 0, st.open ? dt : 0, isHeld(li[c.id]));
        if (f.phase === 'gone') gone.push(c.id);
        else if (f.phase === 'fading') { if (!li[c.id].hasAttribute('data-kbl-fading')) li[c.id].setAttribute('data-kbl-fading', ''); }
        else li[c.id].removeAttribute('data-kbl-fading');
      });
      gone.forEach(function (id) { delete fade[id]; if (b.ctl && typeof b.ctl.removeCard === 'function') b.ctl.removeCard(id); });
      clock();
    }

    /* ---- the strip, as a toast (KS03's stack) when the kit has one ---- */
    function banner(c) {
      var T = W.B68Ui && W.B68Ui.toast; if (typeof T !== 'function' || dead) return false;
      var k = h.cardKind(c), kd = h.KIND[k] || h.KIND.note;
      try {
        T({ text: 'Blade · ' + kd.word + ': ' + clip(c.headline, 120), tone: k === 'warn' ? 'error' : 'info', key: 'blade-strip', duration: 8000,
          undo: { label: 'Open', fn: function () { if (b.ctl && typeof b.ctl.open === 'function') b.ctl.open(); } } });
        return true;
      } catch (e) { return false; }
    }

    function destroy() {
      if (dead) return;
      if (ticker && h.clrI) h.clrI(ticker);
      ticker = null; unwire(); unpaint(); dead = true;
      var i = views.indexOf(view); if (i >= 0) views.splice(i, 1);
    }
    var view = { bridge: b, card: card, paint: paint, banner: banner, destroy: destroy,
      _state: function () { return { pinned: Object.keys(pinned), fade: JSON.parse(JSON.stringify(fade)), ticking: !!ticker, held: Object.keys(listed()).filter(function (id) { return isHeld(listed()[id]); }) }; } };
    return view;
  }

  function viewOf(b) { for (var i = 0; i < views.length; i++) if (views[i].bridge === b) return views[i]; var v = makeView(b); views.push(v); return v; }
  function sync() {
    bridges = bridges.filter(function (b) { return b && typeof b.host === 'function' && b.host(); });
    var want = on();
    bridges.forEach(function (b) { try { b.use(want ? viewOf(b) : null); } catch (e) { if (W && W.console) W.console.error(e); } });
  }
  function attach(b) {
    if (!b || typeof b.use !== 'function' || bridges.indexOf(b) >= 0) return;
    bridges.push(b); sync();
  }
  function start() {
    var A = W && W.B68GmAssist; if (A && typeof A.live === 'function') A.live().forEach(attach);
    if (!listening && W.B68Kit && typeof W.B68Kit.onChange === 'function') { listening = true; W.B68Kit.onChange(function (ev) { if (ev && ev.name === 'desk') sync(); }); }
    sync();
  }

  return { attach: attach, sync: sync, on: on, start: start, views: function () { return views.slice(); },
    EDGE: EDGE, FADE_MS: FADE_MS, WARN_MS: WARN_MS, pressable: pressable, fadeStep: fadeStep };
});

/* B68Pitches: KS18 begin */
/* Owned by KS18; KS07 and KS19 leave this block alone.
   The request side of Blade's pitches (setting blade.pitches). The Worker reads no settings, so while the setting is on the page says so on
   every tick: set(gm, true) routes the panel's gm.assistTick through gm.assistPitchTick({ pitch: true, seen }), and set(gm, false) puts
   the original back at once (a flip off needs no reload). Nothing here draws: the cards are KS19's, through onReply.
     set(gm, on)      hook or unhook (idempotent; a different gm object moves the hook)       on() -> boolean
     now()            Pitch now: { pitch, pitchNow, seen } at once; one request at a time (a second press while one waits gets the same
                      promise); rejects when the setting is off. A 429 (busy, or the cap reached) rejects with the Worker's error.
     remember(lines)  lines shown or dismissed (each answer's lines are remembered on arrival); the newest SEEN_MAX go back as `seen`
     seen()           a copy of that list           onReply(fn) -> unsubscribe: fn(answer) for every answer that carries `pitch`
   A pitch never acts: nothing here reaches the iPad or a phone. ES5; window.B68Pitches in the page, module.exports.B68Pitches under Node. */
(function (root) {
  'use strict';
  var SEEN_MAX = 12;
  function make() {
    var hooked = null, orig = null, wrapped = null, pending = null, seenList = [], subs = [];
    function remember(lines) {
      (lines || []).forEach(function (l) {
        var t = typeof l === 'string' ? l.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
        if (!t) return;
        var i = seenList.indexOf(t); if (i >= 0) seenList.splice(i, 1);
        seenList.push(t);
      });
      if (seenList.length > SEEN_MAX) seenList = seenList.slice(-SEEN_MAX);
    }
    function emit(res) {
      if (!res || !res.pitch || !res.pitch.items) return res;
      remember(res.pitch.items.map(function (p) { return p && p.line; }));
      subs.slice().forEach(function (fn) { try { fn(res); } catch (e) { if (root && root.console) root.console.error(e); } });
      return res;
    }
    function unhook() {
      if (hooked && hooked.assistTick === wrapped) hooked.assistTick = orig;
      hooked = null; orig = null; wrapped = null;
    }
    function set(gm, on) {
      if (!on || !gm || typeof gm.assistPitchTick !== 'function' || typeof gm.assistTick !== 'function') { unhook(); return false; }
      if (hooked === gm && gm.assistTick === wrapped) return true;
      unhook();
      var g = gm;
      hooked = g; orig = g.assistTick;
      wrapped = function (after, npc, rolled) { return g.assistPitchTick({ pitch: true, seen: seenList.slice() }, after, npc, rolled).then(emit); };
      g.assistTick = wrapped;
      return true;
    }
    function now() {
      if (!hooked) return Promise.reject(new Error('pitches are off'));
      if (pending) return pending;
      var g = hooked;
      pending = Promise.resolve().then(function () { return g.assistPitchTick({ pitch: true, pitchNow: true, seen: seenList.slice() }); }).then(emit);
      var clear = function () { pending = null; };
      pending.then(clear, clear);
      return pending;
    }
    return {
      set: set, now: now, remember: remember,
      on: function () { return !!hooked; },
      seen: function () { return seenList.slice(); },
      onReply: function (fn) { if (typeof fn !== 'function') return function () {}; subs.push(fn); return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; },
    };
  }
  var P = make();
  P.make = make;
  if (root && !root.B68Pitches) root.B68Pitches = P;
  if (typeof module === 'object' && module && module.exports) module.exports.B68Pitches = P;
})(typeof window !== 'undefined' ? window : null);
/* B68Pitches: KS18 end */
