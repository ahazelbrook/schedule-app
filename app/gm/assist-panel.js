/* B68GmAssist — "Claude at the table", the GM page's chat box (build plan Phase 1; functions/api/gm/assist.js is the server side).
   A round launcher fixed to the bottom right with the table agent's portrait and a count of unread cards; a card that arrives pops
   a banner beside it for 12 s. Open, it is a small chat: the cards as bubbles (rule slips, clerk notes), the Ledger's updates, and
   "Fit it" for the Fixer. Plain script, UMD: window.B68GmAssist in the browser, module.exports under Node.

   GM only, by construction: gm-page.js creates it once the GM's page is ready and destroys it on close, so the player and display
   pages never see it. It calls exactly three things on window.claude.gm: stt() (is Listening on), assistTick() and assistFit().
   Nothing it receives is stored anywhere (no state document, no display, no localStorage): the cards live in this object until
   the page closes. The page's own capture bar is the only thing it can write to, and only when the GM taps "Note it".

   API
     B68GmAssist.create({ gm, doc?, win?, onNote?(text) -> bool, avatar?, interval?, bannerMs? })
         gm        window.claude.gm (stt, assistTick, assistFit)
         onNote    the page's capture: "Note it" on a Ledger update files its text as a Moment (the update itself changes no state)
     ctl.open() / close() / toggle()      the box
     ctl.poll()      one polling decision now: Listening on, page visible, not paused -> one tick (resolves when done)
     ctl.fit(position, effect) -> Promise     the Fixer for a position
     ctl.resume()    clear a pause (cap reached / busy) and poll again
     ctl.state()     a copy of what the box holds (for checks)
     ctl.destroy()   timers, listeners and the element go
   Polling: about once a minute, only while Listening is on and the page is visible; the `after` cursor is the `last` of the answer
   before. A 429 (busy, or the night's cap) or a spend tier of "off" stops the polling and says so until the GM taps Check again.
   _pure: errKind, errLine, fitLines, tierLabel, spendLine, absorb, hhmm, clip. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmAssist = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var P = {};
  var BANNER_MS = 12000, POLL_MS = 60000, MAX_CARDS = 40, MAX_UPDATES = 30;
  var POSITIONS = ['controlled', 'risky', 'desperate'];
  var SEAT = { ref: 'Rule slip', clerk: 'Clerk', fixer: 'Fixer', ledger: 'Ledger' };
  var TIER = { all: 'Full', reduced: 'Reduced', core: 'Core only', off: 'Off: cap reached' };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clip(s, n) { s = str(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function hhmm(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    function p(n) { return n < 10 ? '0' + n : String(n); }
    return p(d.getHours()) + ':' + p(d.getMinutes());
  }
  P.clip = clip; P.hhmm = hhmm;

  /* a failed call -> a kind the box can word: cap and busy (429, which stop the polling), setup (503: no key on the server),
     net (the server could not be reached), bad (400), other. The server's own message is never shown. */
  function errKind(e) {
    var s = e && e.status, m = str(e && e.message);
    if (s === 429) return /cap/i.test(m) ? 'cap' : 'busy';
    if (s === 503) return 'setup';
    if (s === 400) return 'bad';
    if (e && (e.network || e.timeout)) return 'net';
    return 'other';
  }
  var ERR_LINE = {
    cap: 'Cap reached for tonight. Blade is off; the console works as it does without it.',
    busy: 'Blade is busy. Paused: tap Check again when you want it back.',
    setup: 'Blade is not set up on the server yet (no key).',
    net: 'Could not reach the server. Trying again in a minute.',
    bad: 'That was not accepted: check the position and effect.',
    other: 'Blade could not answer just now. Trying again in a minute.'
  };
  function errLine(kind) { return ERR_LINE[kind] || ERR_LINE.other; }
  P.errKind = errKind; P.errLine = errLine;

  function tierLabel(t) { return TIER[t] || ''; }
  function spendLine(sp) {
    if (!isObj(sp) || typeof sp.tonight !== 'number') return '';
    return '$' + sp.tonight.toFixed(2) + (typeof sp.cap === 'number' ? ' of $' + sp.cap.toFixed(0) : '');
  }
  P.tierLabel = tierLabel; P.spendLine = spendLine;

  /* the Fixer's answer as the five lines the GM reads aloud, in the order the dice are read */
  function fitLines(card) {
    var c = isObj(card) ? card : {};
    return [['1–3', 'one_three'], ['4–5', 'four_five'], ['6', 'six'], ['Crit', 'crit'], ['Bargain', 'bargain']].map(function (r) { return { label: r[0], text: str(c[r[1]]).trim() }; }).filter(function (l) { return l.text; });
  }
  P.fitLines = fitLines;

  /* fold a tick answer into the box's state (mutates `st`); returns the cards that are new */
  function absorb(st, res, nowIso) {
    var r = isObj(res) ? res : {}, fresh = [];
    if (typeof r.last === 'number' && r.last >= 0) st.after = r.last;
    (Array.isArray(r.cards) ? r.cards : []).forEach(function (c) {
      if (!isObj(c) || !str(c.text).trim()) return;
      var id = str(c.seat) + '|' + str(c.at) + '|' + str(c.text);
      if (st.cards.some(function (x) { return x.id === id; })) return;
      var card = { id: id, seat: str(c.seat), at: str(c.at) || nowIso, text: str(c.text).trim(), detail: isObj(c.detail) ? { said_at: str(c.detail.said_at), rule: clip(c.detail.rule, 220) } : null, seen: false };
      st.cards.push(card); fresh.push(card);
    });
    (Array.isArray(r.updates) ? r.updates : []).forEach(function (u) {
      if (!isObj(u) || !str(u.text).trim()) return;
      var id = 'u|' + str(u.at) + '|' + str(u.key) + '|' + str(u.text);
      if (st.updates.some(function (x) { return x.id === id; })) return;
      st.updates.push({ id: id, at: str(u.at) || nowIso, key: str(u.key), text: clip(u.text, 240) });
    });
    if (st.cards.length > MAX_CARDS) st.cards = st.cards.slice(-MAX_CARDS);
    if (st.updates.length > MAX_UPDATES) st.updates = st.updates.slice(-MAX_UPDATES);
    if (isObj(r.spend)) st.spend = { tonight: +r.spend.tonight || 0, cap: typeof r.spend.cap === 'number' ? r.spend.cap : null, tier: str(r.spend.tier) };
    st.setup = Array.isArray(r.warnings) && r.warnings.length > 0;
    return fresh;
  }
  P.absorb = absorb;

  function create(o) {
    o = o || {};
    var gm = o.gm, doc = o.doc || (W && W.document), win = o.win || W;
    var st = { open: false, cards: [], updates: [], after: null, spend: null, paused: '', error: '', setup: false, listening: null, checkedAt: '', busy: false,
      fit: { busy: false, error: '', card: null } };
    var host = null, timer = null, bannerT = null, gone = false, bannerCard = null;
    var avatar = o.avatar || 'gm/blade.svg';
    var bannerMs = o.bannerMs || BANNER_MS;
    var setI = o.setInterval || (win && win.setInterval && win.setInterval.bind(win)), clrI = o.clearInterval || (win && win.clearInterval && win.clearInterval.bind(win));
    var setT = o.setTimeout || (win && win.setTimeout && win.setTimeout.bind(win)), clrT = o.clearTimeout || (win && win.clearTimeout && win.clearTimeout.bind(win));

    function isPhone() { try { return !!(win && win.matchMedia && win.matchMedia('(max-width: 599px)').matches); } catch (e) { return false; } }
    function hidden() { return !!(doc && doc.hidden); }
    function unread() { return st.cards.filter(function (c) { return !c.seen; }).length; }
    function q(sel) { return host ? host.querySelector(sel) : null; }

    /* ---------- drawing ---------- */
    function build() {
      if (!doc || !doc.body) return;
      host = doc.createElement('div');
      host.className = 'gm-assist'; host.setAttribute('data-assist', '');
      host.innerHTML =
        '<div class="as-banner" id="as-banner" hidden><button type="button" class="as-banner-b" data-as="banner"></button></div>' +
        '<section class="as-panel" id="as-panel" role="dialog" aria-label="Blade, the table agent" hidden>' +
          '<header class="as-head"><img class="as-av" src="' + esc(avatar) + '" alt="" width="40" height="40">' +
            '<div class="as-who"><b tabindex="-1" id="as-name">Blade</b><small>at the table</small></div>' +
            '<span class="as-tier" id="as-tier" hidden></span>' +
            '<button type="button" class="as-x" data-as="close" aria-label="Close Blade"><span aria-hidden="true">×</span></button></header>' +
          '<p class="as-status" id="as-status" role="status"></p>' +
          '<div class="as-body">' +
            '<ol class="as-list" id="as-list" aria-label="Cards" aria-live="polite"></ol>' +
            '<div id="as-updates"></div>' +
            '<form class="as-fit" id="as-fit" data-as-form="fit"><p class="as-lab">Fit it: for the roll about to be made</p>' +
              '<div class="as-pos" role="radiogroup" aria-label="Position">' + POSITIONS.map(function (p, i) {
                return '<label><input type="radio" name="as-pos" value="' + p + '"' + (i === 1 ? ' checked' : '') + '><span>' + p + '</span></label>'; }).join('') + '</div>' +
              '<input type="text" id="as-eff" maxlength="200" placeholder="Effect (optional)" autocomplete="off" aria-label="Effect (optional)">' +
              '<button type="submit" class="as-go" id="as-go">Fit it</button></form>' +
            '<div id="as-fitout" aria-live="polite"></div>' +
          '</div></section>' +
        '<button type="button" class="as-launch" id="as-launch" data-as="toggle" aria-expanded="false" aria-controls="as-panel" title="Blade (A)">' +
          '<img src="' + esc(avatar) + '" alt=""><span class="as-count" id="as-count" hidden></span></button>';
      doc.body.appendChild(host);
      host.addEventListener('click', onClick);
      host.addEventListener('submit', onSubmit);
      host.addEventListener('keydown', onKey);
      render();
    }
    function render() {
      if (!host) return;
      var n = unread(), cnt = q('#as-count'), lb = q('#as-launch');
      cnt.textContent = n > 9 ? '9+' : String(n); cnt.hidden = n === 0;
      lb.setAttribute('aria-label', 'Blade' + (n ? ', ' + n + ' new' : ''));
      lb.setAttribute('aria-expanded', String(st.open));
      q('#as-panel').hidden = !st.open;
      var tier = q('#as-tier');
      var tl = st.spend ? tierLabel(st.spend.tier) : '';
      tier.hidden = !tl; tier.textContent = tl ? tl + (spendLine(st.spend) ? ' · ' + spendLine(st.spend) : '') : '';
      tier.setAttribute('data-tier', st.spend ? st.spend.tier : '');
      renderStatus(); renderList(); renderUpdates(); renderFit();
    }
    function renderStatus() {
      var el = q('#as-status'); if (!el) return;
      var t = '', again = false;
      if (st.paused) { t = errLine(st.paused); again = true; }
      else if (st.error) t = st.error;
      else if (st.setup) t = 'Listening, but Blade has no briefing loaded: push the GM pack with the assist part.';
      else if (st.listening === false) t = 'Waiting: Listening is off, so Blade is not checking.';
      else if (st.listening === true && st.checkedAt) t = 'Listening. Last checked ' + st.checkedAt + ', next in about a minute.';
      else t = 'Starts checking once Listening is on.';
      el.innerHTML = esc(t) + (again ? ' <button type="button" class="as-link" data-as="resume">Check again</button>' : '');
      el.classList.toggle('bad', !!(st.paused || st.error));
    }
    function renderList() {
      var el = q('#as-list'); if (!el) return;
      if (!st.cards.length) { el.innerHTML = '<li class="as-empty">Nothing yet. Blade speaks up only when there is something worth the table’s time.</li>'; return; }
      el.innerHTML = st.cards.slice().reverse().map(function (c) {
        var d = c.detail, cite = d && (d.rule || d.said_at) ? '<p class="as-cite">' + (d.rule ? esc(d.rule) : '') + (d.rule && d.said_at ? ' · ' : '') + (d.said_at ? 'said ' + esc(d.said_at) : '') + '</p>' : '';
        return '<li class="as-card" data-seat="' + esc(c.seat) + '"><div class="as-meta"><b>' + esc(SEAT[c.seat] || c.seat) + '</b><time>' + esc(hhmm(c.at)) + '</time>' +
          '<button type="button" class="as-ack" data-as="ack" data-id="' + esc(c.id) + '" aria-label="Dismiss this card">Got it</button></div><p class="as-text">' + esc(c.text) + '</p>' + cite + '</li>';
      }).join('');
    }
    function renderUpdates() {
      var el = q('#as-updates'); if (!el) return;
      if (!st.updates.length) { el.innerHTML = ''; return; }
      /* no stress / harm / xp state exists to write to on this page, so an update is read-only: Done dismisses it, and Note it files
         its text in the capture bar (when the page gave us one) */
      el.innerHTML = '<p class="as-lab">Ledger: for you to apply</p><ul class="as-ups">' + st.updates.slice().reverse().map(function (u) {
        return '<li class="as-up"><span class="as-uptext">' + (u.key ? '<small>' + esc(u.key) + '</small> ' : '') + esc(u.text) + '</span><span class="as-upbtns">' +
          (typeof o.onNote === 'function' ? '<button type="button" data-as="note" data-id="' + esc(u.id) + '">Note it</button>' : '') +
          '<button type="button" data-as="done" data-id="' + esc(u.id) + '">Done</button></span></li>';
      }).join('') + '</ul>';
    }
    function renderFit() {
      var go = q('#as-go'), out = q('#as-fitout'); if (!go || !out) return;
      go.disabled = st.fit.busy; go.textContent = st.fit.busy ? 'Fitting…' : 'Fit it';
      var h = '';
      if (st.fit.error) h += '<p class="as-status bad" role="alert">' + esc(st.fit.error) + '</p>';
      var c = st.fit.card;
      if (c) {
        h += '<div class="as-fitcard"><p class="as-fitread">' + esc(c.read) + '</p><ol class="as-lines">' + fitLines(c).map(function (l) {
          return '<li><b>' + esc(l.label) + '</b><span>' + esc(l.text) + '</span></li>'; }).join('') + '</ol>' +
          '<button type="button" class="as-link" data-as="fitclear">Clear</button></div>';
      }
      out.innerHTML = h;
    }

    /* ---------- the banner ---------- */
    function showBanner(card) {
      if (!host || st.open || isPhone()) return;
      var b = q('#as-banner'), bb = q('.as-banner-b'); if (!b) return;
      bannerCard = card;
      bb.innerHTML = '<b>' + esc(SEAT[card.seat] || card.seat) + '</b> ' + esc(clip(card.text, 140));
      b.hidden = false;
      if (bannerT && clrT) clrT(bannerT);
      if (setT) bannerT = setT(hideBanner, bannerMs);
    }
    function hideBanner() { var b = q('#as-banner'); if (b) b.hidden = true; bannerT = null; bannerCard = null; }

    /* ---------- the box ---------- */
    function open() {
      if (gone) return;
      st.open = true; hideBanner();
      st.cards.forEach(function (c) { c.seen = true; });
      render();
      var nm = q('#as-name'); if (nm) { try { nm.focus(); } catch (e) {} }
    }
    function close() {
      if (!st.open) return;
      var had = host && doc && host.contains(doc.activeElement);
      st.open = false; render();
      if (had) { var lb = q('#as-launch'); if (lb) { try { lb.focus(); } catch (e) {} } }
    }
    function toggle() { if (st.open) close(); else open(); }

    /* ---------- polling ---------- */
    function active() { return !gone && !isPhone() && !hidden(); }
    function tickOnce() {
      if (st.busy || gone) return Promise.resolve();
      st.busy = true;
      return Promise.resolve().then(function () { return gm.assistTick(st.after); }).then(function (res) {
        if (gone) return;
        var fresh = absorb(st, res, new Date().toISOString());
        st.error = ''; st.checkedAt = hhmm(new Date().toISOString());
        if (st.open) st.cards.forEach(function (c) { c.seen = true; });
        else if (fresh.length) showBanner(fresh[fresh.length - 1]);
        if (st.spend && st.spend.tier === 'off') st.paused = 'cap';
      }, function (e) {
        if (gone) return;
        var k = errKind(e);
        if (k === 'cap' || k === 'busy') st.paused = k;
        else if (k === 'setup') { st.paused = 'setup'; }
        else st.error = errLine(k);
      }).then(function () { st.busy = false; render(); });
    }
    /* one decision: not while paused, hidden or on a phone; only while Listening is on (asked of the server, so a stale page is not fooled) */
    function poll() {
      if (!active() || st.paused || st.busy) return Promise.resolve();
      return Promise.resolve().then(function () { return gm.stt(); }).then(function (r) {
        var d = r && isObj(r.doc) ? r.doc : null, on = !!(d && d.want === 'on');
        st.listening = on;
        if (!on) { render(); return; }
        return tickOnce();
      }, function () { /* Listening could not be read: say nothing, try next minute */ });
    }
    function resume() { st.paused = ''; st.error = ''; render(); return poll(); }

    /* ---------- the Fixer ---------- */
    function fit(position, effect) {
      position = str(position).replace(/\s+/g, ' ').trim(); effect = str(effect).replace(/\s+/g, ' ').trim();
      if (!position || st.fit.busy) return Promise.resolve();
      st.fit.busy = true; st.fit.error = ''; renderFit();
      var req = { position: position }; if (effect) req.effect = effect;
      return Promise.resolve().then(function () { return gm.assistFit(req); }).then(function (res) {
        if (gone) return;
        var c = res && Array.isArray(res.cards) ? res.cards[0] : null;
        if (isObj(res) && isObj(res.spend)) absorb(st, { spend: res.spend, warnings: [] }, '');
        if (c && isObj(c) && fitLines(c).length) st.fit.card = c; else st.fit.error = 'Blade had nothing to fit just now. Try again.';
      }, function (e) {
        if (gone) return;
        var k = errKind(e);
        st.fit.error = k === 'cap' ? 'Cap reached for tonight: the Fixer is off.' : k === 'busy' ? 'The Fixer is busy: try again in a moment.' : errLine(k);
        if (k === 'cap') st.paused = 'cap';
      }).then(function () { st.fit.busy = false; render(); });
    }

    /* ---------- events ---------- */
    function remove(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) { list.splice(i, 1); return true; } return false; }
    function onClick(ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-as]') : null; if (!b || !host.contains(b)) return;
      var a = b.getAttribute('data-as'), id = b.getAttribute('data-id');
      if (a === 'toggle') toggle();
      else if (a === 'close') close();
      else if (a === 'banner') open();
      else if (a === 'ack') { remove(st.cards, id); render(); }
      else if (a === 'done') { remove(st.updates, id); render(); }
      else if (a === 'note') { var u = st.updates.filter(function (x) { return x.id === id; })[0]; if (u && typeof o.onNote === 'function' && o.onNote(u.text)) { remove(st.updates, id); render(); } }
      else if (a === 'resume') resume();
      else if (a === 'fitclear') { st.fit.card = null; st.fit.error = ''; renderFit(); }
    }
    function onSubmit(ev) {
      if (!ev.target || ev.target.getAttribute('data-as-form') !== 'fit') return;
      ev.preventDefault();
      var r = host.querySelector('input[name="as-pos"]:checked'), e = q('#as-eff');
      fit(r ? r.value : 'risky', e ? e.value : '');
    }
    function onKey(ev) {
      if (ev.key !== 'Escape' || !st.open) return;
      var t = ev.target, n = t && t.tagName ? t.tagName.toLowerCase() : '';
      if (n === 'input' || n === 'textarea' || n === 'select') return;   /* the page blurs the field first; the next Escape closes the box */
      ev.preventDefault(); close();
    }
    function onVis() { if (doc && !doc.hidden) poll(); }

    build();
    if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', onVis);
    if (setI && !o.noTimer) timer = setI(poll, o.interval || POLL_MS);
    if (!o.noTimer) setTimeout(function () { poll(); }, 1500);

    return {
      open: open, close: close, toggle: toggle, isOpen: function () { return st.open; }, poll: poll, resume: resume, fit: fit,
      state: function () { return JSON.parse(JSON.stringify({ open: st.open, cards: st.cards, updates: st.updates, after: st.after, spend: st.spend, paused: st.paused, error: st.error, listening: st.listening, unread: unread(), fit: st.fit, banner: bannerCard ? bannerCard.text : '' })); },
      el: function () { return host; },
      destroy: function () {
        gone = true;
        if (timer && clrI) clrI(timer);
        if (bannerT && clrT) clrT(bannerT);
        if (doc && doc.removeEventListener) doc.removeEventListener('visibilitychange', onVis);
        if (host && host.parentNode) host.parentNode.removeChild(host);
        host = null;
      }
    };
  }

  return { create: create, POSITIONS: POSITIONS, _pure: P };
});
