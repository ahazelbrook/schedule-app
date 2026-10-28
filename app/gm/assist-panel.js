/* B68GmAssist — "Claude at the table", the GM page's Blade side panel (build plan Phase 1; functions/api/gm/assist.js is the server side).
   Closed, it is a 44 px tab on the right edge between the top bar and the capture bar: the table agent's portrait, the count of unread
   cards and up to five coloured pips (one per unread card, by kind, newest on top); a card that arrives pops a banner beside it for 12 s.
   Open, it is a panel 400 px wide (at least 360, at most 33vw) that slides in over the page (a transform, 180 ms; none under
   prefers-reduced-motion). At >= 1600 px Pin docks it as a fourth .gm-main column (body.as-dock). Under 600 px it is not drawn.
   Top to bottom: the header (the state as a dot and a word, the spend with a five-cell meter, the three seats' health dots, Pin, close),
   Now (the newest unread card, open, for 1.5 s once the panel is open), the Ask bar, the feed (filter chips with counts, then the cards
   newest first, each folded to one 44 px line; an "Earlier tonight" divider after 30 minutes) and the Tools drawer at the foot (Fit it,
   the Screen, the Ledger's updates). A card has a kind (rule, say, idea, done, warn, note) with a colour, a glyph and a word.
   Keys: A toggles (the page), Esc closes (not while typing), J / K move between the feed's cards, Enter folds or unfolds the focused
   card, U undoes the newest done card (ctl.undoNewest(), a no-op until C2). J, K and U count only with the focus inside the panel.
   Plain script, UMD: window.B68GmAssist in the browser, module.exports under Node.

   GM only, by construction: gm-page.js creates it once the GM's page is ready and destroys it on close, so the player and display
   pages never see it. It calls exactly these on window.claude.gm: stt() (is Listening on), assistTick(), assistFit(), and
   assistCards() / assistMark() (tonight's cards back from the server's log, and the marks seen / dismissed / kept), plus the Screen's
   calls (below) and assistAsk() (Ask Blade).
   Nothing is stored in the browser (no state document, no display, no localStorage): the cards live in this object, and the server's
   assist log is the memory, so a reload restores the chat, the unread count and what was dismissed. The page's own capture bar is
   the only other thing it writes to: "Note it" on a Ledger update, and "Keep" (a star) on a card, each file a Moment there.
   A Ref rule slip is "important": it shows that it is in the log, and "saved to history" once gm:after has put it in the session note.

   API
     B68GmAssist.create({ gm, doc?, win?, onNote?(text) -> bool, avatar?, interval?, bannerMs? })
         gm        window.claude.gm (stt, assistTick, assistFit)
         draws     (position) -> { low, mid } | null: the console's own pre-rolled 1-3 and 4-5 draws for that position; the Fixer
                   fits them (the server refuses a fit without them)
         onStage   () -> the name of the NPC on stage ('' when none): sent with each tick, and Voice only runs when it is there
         onVoice   (voice | null): Voice's lines from a tick ({ who, want, lines, at }); null clears them (Listening off, the cap)
         onStall   (stall | null): Stall's offer from a tick ({ kind, offer, why, at }); null clears it (Listening off, the cap)
         onMeanwhile (cutaway | null): Meanwhile's faction cutaway from a tick ({ faction, cutaway, clock, ticks, why, at }); null clears it (Listening off, the cap)
         onHandout (handout): a handout the Mystery keeper suggests, from a tick ({ id, why, at }); the page offers it in the Rack
         dots      () -> 0-4 | null: the Dots chip's value; the "Fit it" form sends it as `dots` when set
         onNote    the page's capture: "Note it" on a Ledger update and "Keep" on a card file their text as a Moment (the update
                   itself changes no state)
     ctl.open() / close() / toggle()      the panel
     ctl.pin() / isPinned()               dock it as a column (>= 1600 px only; a no-op below) / is it docked now
     ctl.undoNewest() -> Promise<null>    U: undo the newest done card (nothing to undo until C2)
     ctl.relayout()                       measure the top bar and the capture bar again (the page calls it after it redraws its layout)
         mock      true shows a few clearly labelled example cards (no Keep, no Got it) while there are no real ones: for looking at the shell only
     ctl.poll()      one polling decision now: Listening on, page visible, not paused -> one tick (resolves when done)
     ctl.fit(position, effect) -> Promise     the Fixer for a position (the "Fit it" form), with the draws from o.draws
     ctl.another({ npc, shown }) -> Promise<{ voice } | { error } | null>   one more Voice line (POST /gm/assist/another); null when the box cannot
     ctl.canAnother() as canFit(), and the runtime offers assistAnother
     ctl.canFit()    false on a phone, with the cap reached, or when the box is not set up: no fit call is made
     ctl.autoFit({ position, effect?, draws }, onStart?) -> Promise<{ card } | { error } | null>
                     the console's own fit, asked when the GM sets the Position. Makes NO call (resolves null) when the box cannot
                     fit, or when Listening is off (asked of the server just before, so a stale page is not fooled)
     ctl.ready       a promise: tonight's cards have been restored (or could not be)
     ctl.rolled()    the GM tapped a console result or filed a roll: one tick with rolled: true in 40 s (one pending; a newer call restarts the 40 s)
     ctl.resume()    clear a pause (cap reached / busy) and poll again
     ctl.state()     a copy of what the box holds (for checks)
     ctl.destroy()   timers, listeners and the element go
   Polling: about once a minute, only while Listening is on and the page is visible; the `after` cursor is the `last` of the answer
   before. A 429 (busy, or the night's cap) or a spend tier of "off" stops the polling and says so until the GM taps Check again.
   The Screen (GM-initiated; GM.md, "The Screen"): four buttons in the box make an item for the GM to preview in the page's Rack, and nothing
   reaches the iPad until the GM taps Show there. Draw them (portrait seat; a typed name is optional), Make the prop (prop seat; a one-line
   ask is optional), Wire (wire seat) and Case board (code only, from the Mystery keeper's latest known and theories). Every item goes through
   the gatekeeper automatically; the page enables Show when the verdict is back, and asks the GM to confirm when it is a block or was not
   checked (the gatekeeper fails closed). The box itself writes nothing to the display, the cast or the ambient document: it hands the item to
   o.onScreen(item) and the page does the rest.
         screen    { vocab: () -> text, cleanSpec: (spec, name) -> { ok, spec, notes, warnings } }: the figure kit's side, from the page
         onScreen  (item): an item changed. item = { id, kind: portrait|prop|wire|board, status: checking|ready, at, ... , gate }; sent once
                   when made (status checking) and again when the gatekeeper has answered (status ready, gate = { verdict, unknown,
                   checked, reasons, revealed, rule, cites_bad })
     ctl.screenMake(kind, { name?, ask? }) -> Promise<{ item } | { error }>    the pipeline for one button
     ctl.canScreen(kind) -> bool     false on a phone, with the cap reached, or when the ladder has dropped that seat (Wire at 60% of the
                                     cap, Portrait and Prop at 85%; the Case board always)
   A Ref card with a page cite is spot-checked in the background through the gatekeeper; a bad cite gets a small "cite?" flag (it never blocks).
   Ask Blade (GM.md, "Ask Blade"): a question field at the top of the box. The GM types a question or a request, presses Ask (Enter sends,
   Shift+Enter is a new line) and the answer appears under the field: plain text for the GM's eyes only, so nothing is handed to the page
   but "Keep", which files "Blade, ask (HH:MM): question -> answer" through o.onNote. One question at a time; a failed one keeps its words in
   the field. The last ten answers come back from the server's log after a reload (assistCards().asks); "×" dismisses one for good.
     ctl.ask(q) -> Promise<{ answer } | { error } | null>   POST /gm/assist/ask { q }; null when the box cannot ask or is already asking
     ctl.canAsk() -> bool     false on a phone, with the cap reached or the box not set up, from 85% of the cap (tier core), or when the runtime
                              has no assistAsk
   _pure: errKind, errLine, fitLines, tierLabel, spendLine, absorb, restore, restoreAsks, momentText, askMoment, askAllowed, askErr, hhmm, clip,
   gateText, citesOf, gateLine, screenAllowed. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmAssist = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var P = {};
  var BANNER_MS = 12000, POLL_MS = 60000, ROLLED_MS = 40000, ROLLED_RETRY_MS = 3000, ROLLED_TRIES = 20, MAX_CARDS = 40, MAX_UPDATES = 30, NPC_MAX = 80;
  var POSITIONS = ['controlled', 'risky', 'desperate'];
  var SEAT = { ref: 'Rule slip', clerk: 'Clerk', fixer: 'Fixer', ledger: 'Ledger', mystery: 'Mystery', showrunner: 'Pacing' };
  var TIER = { all: 'Full', reduced: 'Reduced', core: 'Core only', off: 'Off: cap reached' };
  /* the glance grammar (design 3.2): every card has a kind, and a kind has a colour (CSS: --k-*), a glyph and a word, so colour is never alone */
  var KINDS = ['rule', 'say', 'idea', 'done', 'warn', 'note'];
  var KIND = { rule: { glyph: '⚙', word: 'Rule' }, say: { glyph: '▶', word: 'Say' }, idea: { glyph: '✦', word: 'Idea' }, done: { glyph: '✓', word: 'Done' }, warn: { glyph: '⚠', word: 'Stop' }, note: { glyph: '·', word: 'Note' } };
  var SEAT_KIND = { ref: 'rule', fixer: 'say', mystery: 'idea', showrunner: 'idea', clerk: 'note', ledger: 'note' };
  var FILTERS = ['all'].concat(KINDS.filter(function (k) { return k !== 'warn'; }));   /* All, Rule, Say, Idea, Done, Note: a warn is rare and always shows under All */
  var PIPS_MAX = 5, EARLIER_MS = 30 * 60 * 1000, FOLD_CHARS = 140, NOW_MS = 1500;
  var PIN_MIN = 1600;

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

  /* a seat's card -> its kind (anything unknown is a note) */
  function kindOf(seat) { return SEAT_KIND[str(seat)] || 'note'; }
  P.kindOf = kindOf; P.KIND = KIND; P.FILTERS = FILTERS;
  /* the feed's chip counts: { all, rule, say, idea, done, warn, note } */
  function countsOf(cards) {
    var n = { all: 0 }; KINDS.forEach(function (k) { n[k] = 0; });
    (Array.isArray(cards) ? cards : []).forEach(function (c) { n.all++; n[kindOf(c && c.seat)]++; });
    return n;
  }
  P.countsOf = countsOf;
  /* the cards a filter shows, newest first (All shows every kind, a warn among them) */
  function feedOf(cards, filter) {
    return (Array.isArray(cards) ? cards : []).filter(function (c) { return !filter || filter === 'all' || kindOf(c && c.seat) === filter; }).slice().reverse();
  }
  P.feedOf = feedOf;
  /* the tab's pips: the kinds of the unread cards, newest first, at most five */
  function pipsOf(cards) {
    return (Array.isArray(cards) ? cards : []).filter(function (c) { return !c.seen; }).reverse().slice(0, PIPS_MAX).map(function (c) { return kindOf(c.seat); });
  }
  P.pipsOf = pipsOf;
  /* the header's state, as a word: Listening, Paused (not listening, or busy), Off (the cap), Not set up */
  function stateOf(st) {
    st = isObj(st) ? st : {};
    if (st.paused === 'setup' || (st.setup && st.paused !== 'cap')) return { key: 'setup', word: 'Not set up' };
    if (st.paused === 'cap' || (isObj(st.spend) && st.spend.tier === 'off')) return { key: 'off', word: 'Off' };
    if (st.paused === 'busy' || st.listening === false) return { key: 'paused', word: 'Paused' };
    if (st.listening === true) return { key: 'on', word: 'Listening' };
    return { key: 'wait', word: 'Waiting' };
  }
  P.stateOf = stateOf;
  /* the spend meter: five cells, filled in fifths of the cap; the colour steps at 60% and 85% */
  function meterOf(sp) {
    if (!isObj(sp) || typeof sp.tonight !== 'number' || typeof sp.cap !== 'number' || sp.cap <= 0) return { cells: 0, tone: 'ok', frac: 0 };
    var f = Math.max(0, Math.min(1, sp.tonight / sp.cap));
    return { cells: f > 0 ? Math.max(1, Math.round(f * 5)) : 0, tone: f >= 0.85 ? 'warn' : f >= 0.6 ? 'mid' : 'ok', frac: f };
  }
  P.meterOf = meterOf;
  /* a card's folded line: one line of its text, cut with an ellipsis */
  function headline(text) { return clip(text, FOLD_CHARS); }
  P.headline = headline;

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
      var card = { id: id, seat: str(c.seat), at: str(c.at) || nowIso, text: str(c.text).trim(), detail: isObj(c.detail) ? { said_at: str(c.detail.said_at), rule: clip(c.detail.rule, 220) } : null, seen: false, kept: false, filed: false, important: str(c.seat) === 'ref' };
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

  /* tonight's cards and updates from the server's log (GET /gm/assist/cards) into the box, after a reload. Cards already here are
     left alone (the id is the same three values the tick answer carries). Restored cards keep the server's read / kept / filed
     marks, so the unread count survives a reload; none of them pops a banner. Returns how many cards were added. */
  function restore(st, res) {
    var r = isObj(res) ? res : {}, n = 0;
    (Array.isArray(r.cards) ? r.cards : []).forEach(function (c) {
      if (!isObj(c) || !str(c.text).trim() || c.dismissed) return;
      var id = str(c.seat) + '|' + str(c.at) + '|' + str(c.text);
      if (st.cards.some(function (x) { return x.id === id; })) return;
      st.cards.push({ id: id, seat: str(c.seat), at: str(c.at), text: str(c.text).trim(), detail: isObj(c.detail) ? { said_at: str(c.detail.said_at), rule: clip(c.detail.rule, 220) } : null,
        seen: !!c.seen, kept: !!c.kept, filed: !!c.filed, important: str(c.seat) === 'ref' });
      n++;
    });
    st.cards.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
    (Array.isArray(r.updates) ? r.updates : []).forEach(function (u) {
      if (!isObj(u) || !str(u.text).trim()) return;
      var id = 'u|' + str(u.at) + '|' + str(u.key) + '|' + str(u.text);
      if (st.updates.some(function (x) { return x.id === id; })) return;
      st.updates.push({ id: id, at: str(u.at), key: str(u.key), text: clip(u.text, 240) });
    });
    if (st.cards.length > MAX_CARDS) st.cards = st.cards.slice(-MAX_CARDS);
    if (st.updates.length > MAX_UPDATES) st.updates = st.updates.slice(-MAX_UPDATES);
    restoreAsks(st, r);
    return n;
  }
  P.restore = restore;

  /* the line "Keep" files as a Moment: who, when, what was said and the rule */
  function momentText(c) {
    var d = c && c.detail, bits = [];
    if (d && d.said_at) bits.push('said ' + d.said_at);
    if (d && d.rule) bits.push(d.rule);
    return 'Blade, ' + (SEAT[c.seat] || c.seat).toLowerCase() + ' (' + hhmm(c.at) + '): ' + str(c.text).trim() + (bits.length ? ' [' + bits.join('; ') + ']' : '');
  }
  P.momentText = momentText;

  /* ---------- Ask Blade's plain helpers ---------- */
  var ASK_MAX = 600, MAX_ASKS = 10, NOTE_MAX = 500;      /* the question; answers kept in the box; what the capture bar takes (LIMITS.captureText) */
  /* the ladder as the box knows it from the spend tier (the server enforces it anyway): Ask Blade stops at 85% of the cap (tier core), like Portrait and Prop */
  function askAllowed(tier) { return tier !== 'core' && tier !== 'off'; }
  P.askAllowed = askAllowed;
  /* the line "Keep" files as a Moment for an answer: when, the question, the answer; clipped to what the capture bar takes */
  function askMoment(a) { return clip('Blade, ask (' + hhmm(a.at) + '): ' + str(a.q).trim() + ' -> ' + str(a.text).trim(), NOTE_MAX); }
  P.askMoment = askMoment;
  /* a failed ask as the sentence under the field: the server's own message is never shown */
  function askErr(e) {
    var s = e && e.status, m = str(e && e.message);
    if (s === 429) return /cap/i.test(m) ? 'Cap reached for tonight: Ask Blade is off.' : /busy/i.test(m) ? 'Blade is busy: try again in a moment.' : 'The budget has dropped Ask Blade for tonight.';
    var k = errKind(e);
    return k === 'net' ? 'Could not reach the server. Your question is still here.' : k === 'setup' ? errLine('setup') : 'Blade had nothing to say to that just now. Try again.';
  }
  P.askErr = askErr;
  /* the answers the server holds for tonight (GET /gm/assist/cards -> asks) into the box: [{ id, at, q, text, kept }], oldest first, at most ten;
     one already here (same at + question) is left alone. Returns how many were added. */
  function restoreAsks(st, res) {
    var r = isObj(res) ? res : {}, n = 0;
    if (!Array.isArray(st.asks)) st.asks = [];
    (Array.isArray(r.asks) ? r.asks : []).forEach(function (a) {
      if (!isObj(a) || !str(a.text).trim() || !str(a.q).trim() || a.dismissed) return;
      var id = 'a|' + str(a.at) + '|' + str(a.q);
      if (st.asks.some(function (x) { return x.id === id; })) return;
      st.asks.push({ id: id, at: str(a.at), q: str(a.q), text: str(a.text).trim(), kept: !!a.kept }); n++;
    });
    st.asks.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
    if (st.asks.length > MAX_ASKS) st.asks = st.asks.slice(-MAX_ASKS);
    return n;
  }
  P.restoreAsks = restoreAsks;

  /* ---------- the Screen's plain helpers ---------- */
  var SCREEN_KINDS = ['portrait', 'prop', 'wire', 'board'];
  var SCREEN_LABEL = { portrait: 'Portrait', prop: 'Prop', wire: 'Wire', board: 'Case board' };
  var ITEM_MAX = 1500, CITES_MAX = 8;
  /* the ladder as the box knows it from the spend tier (the server enforces it anyway): Wire stops at 60% of the cap (tier reduced), Portrait
     and Prop at 85% (tier core), nothing but the code-only Case board at the cap; the Board needs no model, so it always runs */
  function screenAllowed(kind, tier) {
    if (kind === 'board') return true;
    if (tier === 'off') return false;
    if (tier === 'core') return false;
    if (tier === 'reduced') return kind !== 'wire';
    return SCREEN_KINDS.indexOf(kind) >= 0;
  }
  P.screenAllowed = screenAllowed;
  /* the text the gatekeeper reads for an item (at most ITEM_MAX characters) */
  function gateText(item) {
    var i = isObj(item) ? item : {}, t;
    if (i.kind === 'portrait') t = 'Portrait of ' + str(i.name).trim() + '. ' + str(i.description).trim();
    else if (i.kind === 'prop') t = (str(i.title).trim() ? str(i.title).trim() + '\n' : '') + str(i.text).trim();
    else if (i.kind === 'board') t = (str(i.title).trim() ? str(i.title).trim() + '\n' : '') + str(i.text).trim();
    else t = str(i.text).trim();
    return t.length > ITEM_MAX ? t.slice(0, ITEM_MAX) : t;
  }
  P.gateText = gateText;
  /* the page cites in a text ("p.274", "pp. 12-13", "page 9"), in order, without repeats (the server's extractCites, kept in step) */
  function citesOf(text) {
    var seen = {}, out = [], re = /\b(?:pp?\.|pages?)\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?/gi, m;
    while ((m = re.exec(str(text)))) { var c = m[0].replace(/\s+/g, ' ').trim(), k = c.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(c); } }
    return out.slice(0, CITES_MAX);
  }
  P.citesOf = citesOf;
  /* the gatekeeper's answer (or the lack of one) as the item's gate: fails closed, so anything but a clean pass is not a pass */
  function gateOf(res) {
    var r = isObj(res) ? res : null;
    if (!r || (r.verdict !== 'pass' && r.verdict !== 'block')) return { verdict: 'block', unknown: true, checked: false, reasons: ['Not checked.'], revealed: [], rule: [], cites_bad: [] };
    function list(v) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === 'string' && x.trim(); }).slice(0, 10).map(function (x) { return clip(x, 300); }) : []; }
    var unknown = !!r.unknown;
    return { verdict: r.verdict, unknown: unknown, checked: !unknown, reasons: list(r.reasons), revealed: list(r.revealed), rule: list(r.rule), cites_bad: list(r.cites_bad) };
  }
  P.gateOf = gateOf;
  /* one line for the badge */
  function gateLine(g) {
    if (!isObj(g)) return 'Checking…';
    if (!g.checked) return 'Not checked';
    return g.verdict === 'pass' ? 'Checked: clear' : 'Blocked';
  }
  P.gateLine = gateLine;

  function markOf(it) { var m = { at: it.at, text: it.text }; if (it.key !== undefined) m.key = it.key; return m; }

  function create(o) {
    o = o || {};
    var gm = o.gm, doc = o.doc || (W && W.document), win = o.win || W;
    var st = { open: false, cards: [], updates: [], asks: [], after: null, spend: null, paused: '', error: '', setup: false, listening: null, checkedAt: '', busy: false,
      fit: { busy: false, error: '', card: null }, screen: { busy: {}, error: '' }, ask: { busy: false, error: '' },
      pinned: false, filter: 'all', unfolded: {}, nowId: '', since: '', chipSig: '' };
    var host = null, timer = null, bannerT = null, nowT = null, rolledT = null, gone = false, bannerCard = null;
    var avatar = o.avatar || 'gm/blade.svg';
    var bannerMs = o.bannerMs || BANNER_MS;
    var setI = o.setInterval || (win && win.setInterval && win.setInterval.bind(win)), clrI = o.clearInterval || (win && win.clearInterval && win.clearInterval.bind(win));
    var setT = o.setTimeout || (win && win.setTimeout && win.setTimeout.bind(win)), clrT = o.clearTimeout || (win && win.clearTimeout && win.clearTimeout.bind(win));

    function isPhone() { try { return !!(win && win.matchMedia && win.matchMedia('(max-width: 599px)').matches); } catch (e) { return false; } }
    function hidden() { return !!(doc && doc.hidden); }
    function unread() { return st.cards.filter(function (c) { return !c.seen; }).length; }
    function q(sel) { return host ? host.querySelector(sel) : null; }
    /* a mark goes to the server's log in the background; a failure is silent (the box still works, it just forgets on reload) */
    function mark(op, items) {
      if (!items.length || !gm || typeof gm.assistMark !== 'function') return;
      Promise.resolve().then(function () { return gm.assistMark({ op: op, items: items.map(markOf) }); }).then(null, function () {});
    }
    function markSeen() { var u = st.cards.filter(function (c) { return !c.seen; }); u.forEach(function (c) { c.seen = true; }); mark('seen', u); }
    function load() {
      if (!gm || typeof gm.assistCards !== 'function') return Promise.resolve();
      return Promise.resolve().then(function () { return gm.assistCards(); }).then(function (res) {
        if (gone) return;
        restore(st, res); render();
      }, function () { /* the log could not be read: the box starts empty, as it did before */ });
    }

    /* ---------- drawing ---------- */
    function dockable() { try { return !!(win && win.matchMedia && win.matchMedia('(min-width: ' + PIN_MIN + 'px)').matches); } catch (e) { return false; } }
    function docked() { return st.open && st.pinned && dockable() && !isPhone(); }
    function bodyClass(c, on) { var b = doc && doc.body; if (b && b.classList && typeof b.classList.toggle === 'function') { try { b.classList.toggle(c, !!on); } catch (e) {} } }
    function applyState() {
      if (!host) return;
      var d = docked();
      host.setAttribute('data-state', d ? 'pinned' : st.open ? 'open' : 'closed');
      bodyClass('as-tab', true); bodyClass('as-dock', d);
      var pin = q('#as-pin');
      if (pin) { pin.setAttribute('aria-pressed', String(!!st.pinned)); pin.hidden = !dockable(); pin.title = st.pinned ? 'Unpin: Blade slides over the page again' : 'Pin: dock Blade as a column beside the page'; }
    }
    /* the bar's bottom and the capture bar's top, as custom properties on the host: the tab and the panel sit between them whatever their height */
    var lay = { bar: null, foot: null, ro: null, raf: false };
    function relayout() {
      if (!host || gone) return;
      var top = 0, bot = 0, bar = null, foot = null;
      try {
        bar = doc.querySelector ? doc.querySelector('.gm-bar') : null; foot = doc.querySelector ? doc.querySelector('#gm-foot') : null;
        if (bar && bar.getBoundingClientRect) top = Math.max(0, Math.round(bar.getBoundingClientRect().bottom));
        var vh = (win && win.innerHeight) || 0;
        if (foot && foot.getBoundingClientRect && vh) { var r = foot.getBoundingClientRect(); if (r.height > 0 && r.top < vh && r.bottom > 0) bot = Math.max(0, Math.round(vh - r.top)); }
      } catch (e) {}
      if (host.style && typeof host.style.setProperty === 'function') { host.style.setProperty('--as-top', top + 'px'); host.style.setProperty('--as-bot', bot + 'px'); }
      var RO = win && win.ResizeObserver;
      if (RO && (bar !== lay.bar || foot !== lay.foot)) {
        try { if (!lay.ro) lay.ro = new RO(function () { relayout(); }); lay.ro.disconnect(); if (bar) lay.ro.observe(bar); if (foot) lay.ro.observe(foot); } catch (e) {}
        lay.bar = bar; lay.foot = foot;
      }
    }
    function onResize() { applyState(); relayout(); render(); }
    function onScroll() {
      if (lay.raf || !win || !win.requestAnimationFrame) return;
      lay.raf = true; win.requestAnimationFrame(function () { lay.raf = false; relayout(); });
    }
    function build() {
      if (!doc || !doc.body) return;
      host = doc.createElement('div');
      host.className = 'gm-assist'; host.setAttribute('data-assist', ''); host.setAttribute('data-state', 'closed');
      var HEALTH = [['T', 'Tripwire'], ['R', 'Ref'], ['V', 'Voice']];
      host.innerHTML =
        '<div class="as-banner" id="as-banner" hidden><button type="button" class="as-banner-b" data-as="banner"></button></div>' +
        '<aside class="as-panel" id="as-panel" aria-label="Blade, the table agent" hidden>' +
          '<header class="as-head"><div class="as-head-1"><img class="as-av" src="' + esc(avatar) + '" alt="" width="32" height="32">' +
            '<div class="as-who"><b tabindex="-1" id="as-name">Blade</b><span class="as-state" id="as-state" data-state="wait"><i class="as-dot" aria-hidden="true"></i><span id="as-state-word">Waiting</span></span></div>' +
            '<button type="button" class="as-pin" id="as-pin" data-as="pin" aria-pressed="false" hidden>Pin</button>' +
            '<button type="button" class="as-x" data-as="close" aria-label="Close Blade (A)"><span aria-hidden="true">×</span></button></div>' +
            '<div class="as-head-2"><span class="as-tier" id="as-tier" hidden></span><span class="as-meter" id="as-meter" aria-hidden="true"></span>' +
              '<span class="as-health" id="as-health" role="group" aria-label="Seat health">' + HEALTH.map(function (h) {
                return '<span class="as-hd" data-seat="' + h[1].toLowerCase() + '" data-health="unknown" title="' + h[1] + ': no reading yet"><b>' + h[0] + '</b><i aria-hidden="true"></i></span>'; }).join('') + '</span></div></header>' +
          '<p class="as-status" id="as-status" role="status"></p>' +
          '<section class="as-now" id="as-nowz" aria-label="Now"><p class="as-zlab">Now</p><div id="as-now" aria-live="polite"></div></section>' +
          '<div class="as-body">' +
            '<form class="as-ask" id="as-ask" data-as-form="ask" aria-label="Ask Blade"><p class="as-lab as-sr">Ask Blade: for your eyes only</p>' +
              '<div class="as-ask-row"><div class="as-ask-in"><textarea id="as-ask-q" maxlength="' + ASK_MAX + '" rows="2" placeholder="Ask Blade: a ruling, three ideas, a read-aloud…" autocomplete="off" aria-label="Ask Blade"></textarea></div>' +
              '<button type="submit" class="as-go" id="as-ask-go">Ask</button></div>' +
              '<div class="as-prog" id="as-prog" hidden></div>' +
              '<p class="as-status" id="as-ask-status" role="status" aria-live="polite"></p></form>' +
            '<div class="as-feed" id="as-feed">' +
              '<ul class="as-asks" id="as-asks" aria-label="Answers from Blade" aria-live="polite"></ul>' +
              '<div class="as-chips" id="as-chips" role="group" aria-label="Show cards of one kind"></div>' +
              '<ol class="as-list" id="as-list" aria-label="Cards" aria-live="polite"></ol></div>' +
            '<details class="as-tools" id="as-tools"><summary><span class="as-zlab">Tools</span><small>Fit it · Screen · Ledger</small><span class="as-tools-n" id="as-tools-n" hidden></span></summary><div class="as-tools-body">' +
              '<div id="as-updates"></div>' +
              '<form class="as-fit" id="as-fit" data-as-form="fit"><p class="as-lab">Fit it: for the roll about to be made</p>' +
                '<div class="as-pos" role="radiogroup" aria-label="Position">' + POSITIONS.map(function (p, i) {
                  return '<label><input type="radio" name="as-pos" value="' + p + '"' + (i === 1 ? ' checked' : '') + '><span>' + p + '</span></label>'; }).join('') + '</div>' +
                '<input type="text" id="as-eff" maxlength="200" placeholder="Effect (optional)" autocomplete="off" aria-label="Effect (optional)">' +
                '<button type="submit" class="as-go" id="as-go">Fit it</button></form>' +
              '<div id="as-fitout" aria-live="polite"></div>' +
              '<section class="as-screen" id="as-screen" aria-label="Screen"><p class="as-lab">Screen: nothing shows on the iPad until you tap Show in the Rack</p>' +
                '<div class="as-sc-row"><input type="text" id="as-sc-name" maxlength="80" placeholder="NPC name (optional)" autocomplete="off" aria-label="NPC name (optional)">' +
                  '<button type="button" class="as-go" data-as="sc-portrait" id="as-sc-portrait">Draw them</button></div>' +
                '<div class="as-sc-row"><input type="text" id="as-sc-ask" maxlength="200" placeholder="One-line ask (optional)" autocomplete="off" aria-label="Prop ask (optional)">' +
                  '<button type="button" class="as-go" data-as="sc-prop" id="as-sc-prop">Make the prop</button></div>' +
                '<div class="as-sc-row"><button type="button" class="as-go" data-as="sc-wire" id="as-sc-wire">Wire</button><button type="button" class="as-go" data-as="sc-board" id="as-sc-board">Case board</button></div>' +
                '<p class="as-status" id="as-sc-status" role="status" aria-live="polite"></p></section>' +
            '</div></details>' +
          '</div></aside>' +
        '<button type="button" class="as-launch" id="as-launch" data-as="toggle" aria-expanded="false" aria-controls="as-panel" title="Blade (A)">' +
          '<img class="as-tab-av" src="' + esc(avatar) + '" alt="" width="32" height="32"><span class="as-count" id="as-count" hidden></span><span class="as-pips" id="as-pips" aria-hidden="true"></span><span class="as-tab-word" aria-hidden="true">Blade · A</span></button>';
      /* beside the page, inside the site's .wrap when there is one: .wrap is a stacking context, so a host on <body> would sit above the top bar's
         Menu and Find, which drop into the panel's place. A page without .wrap (a test's fake document) gets it on <body>. */
      (doc.querySelector && doc.querySelector('.wrap') || doc.body).appendChild(host);
      host.addEventListener('click', onClick);
      host.addEventListener('submit', onSubmit);
      host.addEventListener('keydown', onKey);
      if (win && typeof win.addEventListener === 'function') { win.addEventListener('resize', onResize); win.addEventListener('scroll', onScroll, { passive: true }); }
      render(); relayout();
    }
    function render() {
      if (!host) return;
      var n = unread(), cnt = q('#as-count'), lb = q('#as-launch');
      cnt.textContent = n > 9 ? '9+' : String(n); cnt.hidden = n === 0;
      lb.setAttribute('aria-label', 'Blade' + (n ? ', ' + n + ' new' : '') + ' (A)');
      lb.setAttribute('aria-expanded', String(st.open));
      var pp = q('#as-pips'); if (pp) pp.innerHTML = pipsOf(st.cards).map(function (k) { return '<i class="as-pip" data-kind="' + k + '" title="' + esc(KIND[k].word) + '"></i>'; }).join('');
      q('#as-panel').hidden = !st.open;
      applyState();
      var tier = q('#as-tier');
      var tl = st.spend ? tierLabel(st.spend.tier) : '';
      tier.hidden = !tl; tier.textContent = tl ? tl + (spendLine(st.spend) ? ' · ' + spendLine(st.spend) : '') : '';
      tier.setAttribute('data-tier', st.spend ? st.spend.tier : '');
      renderHead(); renderStatus(); renderNow(); renderAsk(); renderChips(); renderList(); renderUpdates(); renderFit(); renderScreen();
    }
    function renderHead() {
      var s = stateOf({ paused: st.paused, setup: st.setup, spend: st.spend, listening: st.listening }), el = q('#as-state'), w = q('#as-state-word');
      if (el) el.setAttribute('data-state', s.key);
      if (w) w.textContent = s.word;
      var m = q('#as-meter');
      if (m) {
        var mo = meterOf(st.spend);
        m.setAttribute('data-tone', mo.tone);
        m.innerHTML = [0, 1, 2, 3, 4].map(function (i) { return '<i' + (i < mo.cells ? ' class="on"' : '') + '></i>'; }).join('');
      }
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
    /* ---- the card: one component (folded to a line, or open); the Now zone shows the same card, open ---- */
    var MOCKS = [
      { id: 'mock-rule', seat: 'ref', text: 'Example rule slip: a placeholder that shows how a rule card looks.', cite: 'p.0' },
      { id: 'mock-idea', seat: 'mystery', text: 'Example idea: a placeholder suggestion in the idea colour.' },
      { id: 'mock-done', seat: 'ledger', kind: 'done', text: 'Example done: a placeholder for something Blade did, with Undo.' }
    ];
    function cardKind(c) { return c.kind || kindOf(c.seat); }
    function cardHtml(c, now) {
      var k = cardKind(c), kd = KIND[k], open = now || !!st.unfolded[c.id], d = c.detail;
      var cite = d && (d.rule || d.said_at) ? '<p class="as-cite">' + (d.rule ? esc(d.rule) : '') + (d.rule && d.said_at ? ' · ' : '') + (d.said_at ? 'said ' + esc(d.said_at) : '') + '</p>' : c.cite ? '<p class="as-cite">' + esc(c.cite) + '</p>' : '';
      var keep = c.mock ? '' : c.kept ? '<span class="as-kept" title="Kept: filed as a Moment">★ Kept</span>'
        : typeof o.onNote === 'function' ? '<button type="button" class="as-star" data-as="keep" data-id="' + esc(c.id) + '" aria-label="Keep this card: file it as a Moment">☆ Keep</button>' : '';
      var flag = c.citeBad && c.citeBad.length ? '<span class="as-citeflag" title="The gatekeeper could not match this page cite to the rule: ' + esc(c.citeBad.join('; ')) + '">cite?</span>' : '';
      var saved = c.important ? '<p class="as-saved">' + (c.filed ? 'Saved to campaign history' : 'In tonight’s log; gm:after files it to history') + '</p>' : '';
      var ack = c.mock ? '' : '<button type="button" class="as-ack" data-as="ack" data-id="' + esc(c.id) + '" aria-label="Dismiss this card">Got it</button>';
      var inner = '<span class="as-kind"><span class="as-glyph" aria-hidden="true">' + kd.glyph + '</span><b>' + esc(kd.word) + '</b></span><span class="as-text">' + esc(c.text) + '</span>' + (c.mock ? '<span class="as-eg">example</span>' : '<time>' + esc(hhmm(c.at)) + '</time>');
      var head = now ? '<div class="as-fold">' + inner + '</div>'
        : '<button type="button" class="as-fold" data-as="fold" data-id="' + esc(c.id) + '" aria-expanded="' + open + '">' + inner + '</button>';
      var tag = now ? 'div' : 'li';
      return '<' + tag + ' class="as-card' + (now ? ' as-now-card' : '') + '" data-seat="' + esc(c.seat) + '" data-kind="' + k + '" data-open="' + (open ? 1 : 0) + '"' + (c.mock ? ' data-mock' : '') + '>' + head +
        '<div class="as-more"><p class="as-seatname">' + esc(SEAT[c.seat] || c.seat) + '</p>' + cite + saved + '<div class="as-acts">' + flag + keep + ack + '</div></div></' + tag + '>';
    }
    function cardById(id) { for (var i = 0; i < st.cards.length; i++) if (st.cards[i].id === id) return st.cards[i]; return null; }
    function quietLine() { return st.listening === true && st.since ? 'Quiet. Listening since ' + st.since + '.' : 'Quiet.'; }
    function renderNow() {
      var el = q('#as-now'); if (!el) return;
      var c = st.nowId ? cardById(st.nowId) : null;
      if (c) el.innerHTML = cardHtml(c, true);
      else if (o.mock) el.innerHTML = cardHtml(Object.assign({ at: '' }, MOCKS[0], { mock: true }), true);
      else el.innerHTML = '<p class="as-quiet">' + esc(quietLine()) + '</p>';
    }
    function foldedFocusId() {
      var ae = doc && doc.activeElement;
      return ae && ae.getAttribute && ae.getAttribute('data-as') === 'fold' && (!ae.closest || ae.closest('#as-list')) ? ae.getAttribute('data-id') : '';
    }
    function foldBtns() { return host && host.querySelectorAll ? Array.prototype.slice.call(host.querySelectorAll('#as-list [data-as="fold"]')) : []; }
    function refocus(id) {
      if (!id) return;
      var b = foldBtns().filter(function (x) { return x.getAttribute('data-id') === id; })[0];
      if (b) { try { b.focus({ preventScroll: true }); } catch (e) {} }
    }
    function renderChips() {
      var el = q('#as-chips'); if (!el) return;
      var n = countsOf(st.cards), sig = st.filter + '|' + FILTERS.map(function (f) { return n[f]; }).join(',');
      if (st.chipSig === sig) return;
      st.chipSig = sig;
      el.innerHTML = FILTERS.map(function (f) {
        return '<button type="button" class="as-chip" data-as="chip" data-k="' + f + '" data-kind="' + f + '" aria-pressed="' + (st.filter === f) + '">' + (f === 'all' ? 'All' : KIND[f].word) + ' <span class="as-chip-n">' + n[f] + '</span></button>';
      }).join('');
    }
    function renderList() {
      var el = q('#as-list'); if (!el) return;
      var fid = foldedFocusId();                  /* focus goes back only if it was on a card line when the list was rewritten: a tick never takes it from a field */
      var items = feedOf(st.cards, st.filter), h = '';
      if (!st.cards.length) h = o.mock ? MOCKS.map(function (m) { return cardHtml(Object.assign({ at: '' }, m, { mock: true }), false); }).join('') : '<li class="as-empty">Nothing yet. Blade speaks up only when there is something worth the table’s time.</li>';
      else if (!items.length) h = '<li class="as-empty">No ' + esc(KIND[st.filter] ? KIND[st.filter].word.toLowerCase() : '') + ' cards tonight.</li>';
      else {
        var cut = Date.now() - EARLIER_MS, shown = false;
        items.forEach(function (c, i) {
          var t = Date.parse(c.at);
          if (!shown && i > 0 && t && t < cut) { shown = true; h += '<li class="as-earlier" role="separator">Earlier tonight</li>'; }
          h += cardHtml(c, false);
        });
      }
      el.innerHTML = h;
      if (fid) refocus(fid);
    }
    function renderUpdates() {
      var el = q('#as-updates'), tn = q('#as-tools-n'); if (!el) return;
      if (tn) { tn.hidden = !st.updates.length; tn.textContent = st.updates.length ? st.updates.length + ' ledger' : ''; }
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

    /* ---------- Ask Blade ---------- */
    function canAsk() {
      if (gone || isPhone() || st.paused === 'setup' || st.paused === 'cap' || !gm || typeof gm.assistAsk !== 'function') return false;
      return askAllowed(tierNow());
    }
    function renderAsk() {
      var sec = q('#as-ask'), go = q('#as-ask-go'), list = q('#as-asks'); if (!sec || !go || !list) return;
      sec.hidden = !gm || typeof gm.assistAsk !== 'function';      /* an older runtime without the call: the field is not offered */
      var can = canAsk(), busy = st.ask.busy, hint = !can && !askAllowed(tierNow()) ? 'Dropped by the budget for tonight.' : '';
      go.disabled = busy || !can; go.textContent = busy ? 'Thinking…' : 'Ask';
      var pr = q('#as-prog'); if (pr) pr.hidden = !busy;
      go.title = can ? 'Ask Blade (Enter)' : hint || 'Not available now';
      var m = q('#as-ask-status'), msg = st.ask.error || hint; if (m) { m.textContent = msg; m.hidden = !msg; m.classList.toggle('bad', !!st.ask.error); }
      list.innerHTML = st.asks.slice().reverse().map(function (a) {
        var keep = a.kept ? '<span class="as-kept" title="Kept: filed as a Moment">★ Kept</span>'
          : typeof o.onNote === 'function' ? '<button type="button" class="as-star" data-as="ask-keep" data-id="' + esc(a.id) + '" aria-label="Keep this answer: file it as a Moment">☆ Keep</button>' : '';
        return '<li class="as-answer"><div class="as-meta"><p class="as-askq">' + esc(a.q) + '</p><time>' + esc(hhmm(a.at)) + '</time></div><p class="as-text">' + esc(a.text) + '</p>' +
          '<div class="as-acts">' + keep + '<button type="button" class="as-ack" data-as="ask-x" data-id="' + esc(a.id) + '" aria-label="Dismiss this answer"><span aria-hidden="true">×</span></button></div></li>';
      }).join('');
    }
    /* the GM's question -> Blade's answer, one at a time. Resolves { answer }, { error: kind } or null (cannot ask, nothing typed, already asking).
       The words stay in the field when it fails, and are cleared when it works. */
    function ask(text) {
      var qq = str(text).replace(/\s+/g, ' ').trim().slice(0, ASK_MAX);
      if (!qq || st.ask.busy || !canAsk()) return Promise.resolve(null);
      st.ask.busy = true; st.ask.error = ''; render();
      return Promise.resolve().then(function () { return gm.assistAsk({ q: qq }); }).then(function (res) {
        if (gone) return null;
        if (isObj(res) && isObj(res.spend)) absorb(st, { spend: res.spend, warnings: [] }, '');
        var a = isObj(res) && isObj(res.answer) && str(res.answer.text).trim() ? res.answer : null;
        if (!a) {
          st.ask.error = isObj(res) && Array.isArray(res.warnings) && res.warnings.length ? 'Blade has no briefing loaded: push the GM pack with the assist part.' : 'Blade had nothing to say to that just now. Try again.';
          return { error: 'none' };
        }
        var at = str(a.at) || new Date().toISOString(), item = { id: 'a|' + at + '|' + (str(a.q) || qq), at: at, q: str(a.q) || qq, text: str(a.text).trim(), kept: false };
        if (!st.asks.some(function (x) { return x.id === item.id; })) st.asks.push(item);
        if (st.asks.length > MAX_ASKS) st.asks = st.asks.slice(-MAX_ASKS);
        var ta = q('#as-ask-q'); if (ta && str(ta.value).replace(/\s+/g, ' ').trim() === qq) ta.value = '';
        return { answer: item };
      }, function (e) {
        if (gone) return null;
        if (e && e.status === 429 && /cap/i.test(str(e.message))) st.paused = 'cap';
        st.ask.error = askErr(e);
        return { error: errKind(e) };
      }).then(function (r) { st.ask.busy = false; render(); return r; });
    }
    function submitAsk() { var t = q('#as-ask-q'); if (t) ask(t.value); }

    /* ---------- the Screen ---------- */
    var SC_TITLE = { portrait: 'Draw the NPC you just described', prop: 'Make a document for the moment', wire: 'One in-world bulletin for the iPad', board: 'What the players have said aloud, as a board' };
    var SC_CALL = { portrait: 'assistPortrait', prop: 'assistProp', wire: 'assistWire', board: 'assistBoard' };
    var SC_NAME = { portrait: 'Draw them', prop: 'Make the prop', wire: 'Wire', board: 'Case board' };
    function tierNow() { return st.spend ? st.spend.tier : ''; }
    function anyModelBusy() { return ['portrait', 'prop', 'wire'].some(function (k) { return st.screen.busy[k]; }); }
    function canScreen(kind) {
      if (gone || isPhone() || st.paused === 'setup' || !gm) return false;
      if (st.paused === 'cap' && kind !== 'board') return false;       /* the Case board is code: it still builds at the cap (its check then says "not checked") */
      if (!SC_CALL[kind] || typeof gm[SC_CALL[kind]] !== 'function') return false;
      return screenAllowed(kind, tierNow());
    }
    function renderScreen() {
      var box = q('#as-screen'); if (!box) return;
      SCREEN_KINDS.forEach(function (k) {
        var b = q('#as-sc-' + k); if (!b) return;
        var can = canScreen(k), busy = !!st.screen.busy[k];
        b.disabled = busy || !can || (k !== 'board' && anyModelBusy());
        b.textContent = busy ? (k === 'board' ? 'Building…' : 'Making…') : SC_NAME[k];
        b.title = !can ? (screenAllowed(k, tierNow()) ? 'Not available now' : 'Dropped by the budget for tonight') : SC_TITLE[k];
      });
      var m = q('#as-sc-status'); if (m) { m.textContent = st.screen.error; m.classList.toggle('bad', !!st.screen.error); }
    }
    function scErr(e) {
      var s = e && e.status, m = str(e && e.message);
      if (s === 429) return /cap/i.test(m) ? 'Cap reached for tonight: the Screen is off.' : /busy/i.test(m) ? 'Blade is busy: try again in a moment.' : 'The budget has dropped that for tonight.';
      return errKind(e) === 'net' ? 'Could not reach the server.' : errKind(e) === 'setup' ? errLine('setup') : 'Blade could not make that just now. Try again.';
    }
    var scSeq = 0;
    function emit(item) { if (typeof o.onScreen === 'function') { try { o.onScreen(JSON.parse(JSON.stringify(item))); } catch (e) {} } }
    /* the gatekeeper on one item; one retry when it is busy (a Ref cite check may hold it). Never rejects: no answer is a gate that fails closed. */
    function gateItem(item, tries) {
      var req = { kind: item.kind, text: gateText(item), cites: [] };
      return Promise.resolve().then(function () { return typeof gm.assistGate === 'function' ? gm.assistGate(req) : null; }).then(function (res) {
        if (isObj(res) && isObj(res.spend)) { absorb(st, { spend: res.spend, warnings: [] }, ''); render(); }
        return gateOf(res);
      }, function (e) {
        if (e && e.status === 429 && /busy/i.test(str(e.message)) && !(tries > 0) && setT) return new Promise(function (ok) { setT(function () { ok(gateItem(item, 1)); }, 1500); });
        return gateOf(null);
      });
    }
    function screenMake(kind, opts) {
      opts = opts || {};
      if (SCREEN_KINDS.indexOf(kind) < 0 || st.screen.busy[kind] || !canScreen(kind) || (kind !== 'board' && anyModelBusy())) return Promise.resolve(null);
      st.screen.busy[kind] = true; st.screen.error = ''; render();
      var req = {};
      if (kind === 'portrait') {
        var vocab = o.screen && typeof o.screen.vocab === 'function' ? str(o.screen.vocab()) : '';
        if (!vocab) { st.screen.busy[kind] = false; st.screen.error = 'The figure kit is not loaded on this page.'; render(); return Promise.resolve({ error: 'kit' }); }
        req.vocab = vocab;
        var nm = str(opts.name).replace(/\s+/g, ' ').trim().slice(0, NPC_MAX); if (nm) req.name = nm;
      } else if (kind === 'prop') {
        var ask = str(opts.ask).replace(/\s+/g, ' ').trim().slice(0, 200); if (ask) req.ask = ask;
      }
      return Promise.resolve().then(function () { return gm[SC_CALL[kind]](req); }).then(function (res) {
        if (gone) return null;
        if (isObj(res) && isObj(res.spend)) absorb(st, { spend: res.spend, warnings: [] }, '');
        var it = res && isObj(res.item) ? res.item : null;
        if (!it) { st.screen.error = kind === 'board' ? 'Nothing on the board yet: the Mystery keeper has not reported anything the players know.' : 'Blade had nothing usable just now. Try again.'; return { error: 'none' }; }
        var item = Object.assign({}, it, { id: 'sc' + (++scSeq) + '-' + Date.now().toString(36), kind: kind, status: 'checking', gate: null, at: str(it.at) || new Date().toISOString() });
        if (kind === 'portrait') {
          var cs = o.screen && typeof o.screen.cleanSpec === 'function' ? o.screen.cleanSpec(it.spec, str(it.name)) : null;
          if (!cs || !cs.ok) { st.screen.error = 'The drawing did not pass the figure kit' + (cs && cs.warnings && cs.warnings.length ? ' (' + clip(cs.warnings[0], 80) + ')' : '') + '. Try again.'; return { error: 'kit' }; }
          item.spec = cs.spec; item.notes = Array.isArray(cs.notes) ? cs.notes.slice(0, 6) : [];
        }
        emit(item);
        return gateItem(item).then(function (g) {
          if (gone) return null;
          item.gate = g; item.status = 'ready'; emit(item);
          return { item: item };
        });
      }, function (e) {
        if (gone) return null;
        if (e && e.status === 429 && /cap/i.test(str(e.message))) st.paused = 'cap';
        st.screen.error = scErr(e);
        return { error: errKind(e) };
      }).then(function (r) { st.screen.busy[kind] = false; render(); return r; });
    }
    /* a Ref card with a page cite is spot-checked in the background; a cite the gatekeeper cannot match gets a small flag (never a block) */
    function citeCheck(card) {
      if (!card || card.seat !== 'ref' || !gm || typeof gm.assistGate !== 'function' || tierNow() === 'off' || gone) return;
      var rule = card.detail && card.detail.rule ? str(card.detail.rule) : '', cites = citesOf(rule + ' ' + card.text);
      if (!cites.length) return;
      var text = clip(card.text + (rule ? '\nRule: ' + rule : ''), ITEM_MAX - 10);
      Promise.resolve().then(function () { return gm.assistGate({ kind: 'card', text: text, cites: cites }); }).then(function (res) {
        if (gone || !isObj(res)) return;
        if (isObj(res.spend)) absorb(st, { spend: res.spend, warnings: [] }, '');
        var bad = !res.unknown && Array.isArray(res.cites_bad) ? res.cites_bad.filter(function (x) { return typeof x === 'string' && x.trim(); }).slice(0, 4).map(function (x) { return clip(x, 60); }) : [];
        if (bad.length) card.citeBad = bad;
        render();
      }, function () { /* no check, no flag: the card stands as it was */ });
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
    /* Now: the newest unread card, shown open for 1.5 s once the panel is open (or until a newer one arrives), then it is only in the feed */
    function setNow(id) {
      if (nowT && clrT) clrT(nowT);
      nowT = null;
      st.nowId = id || '';
      if (id && setT) nowT = setT(function () { nowT = null; st.nowId = ''; if (host) renderNow(); }, NOW_MS);
    }
    function open() {
      if (gone) return;
      st.open = true; hideBanner();
      var un = st.cards.filter(function (c) { return !c.seen; });
      setNow(un.length ? un[un.length - 1].id : '');
      markSeen();
      render(); relayout();
      var nm = q('#as-name'); if (nm) { try { nm.focus(); } catch (e) {} }
    }
    function close() {
      if (!st.open) return;
      var had = host && doc && host.contains(doc.activeElement);
      st.open = false; setNow(''); render(); relayout();
      if (had) { var lb = q('#as-launch'); if (lb) { try { lb.focus(); } catch (e) {} } }
    }
    function togglePin() {
      if (!dockable() || isPhone()) return;
      st.pinned = !st.pinned;
      if (st.pinned && !st.open) { open(); return; }
      render(); relayout();
    }
    /* U: undo the newest green (done) card. The co-GM's done cards arrive with C2; until then there is nothing to undo, and this does nothing. */
    function undoNewest() { return Promise.resolve(null); }
    function toggle() { if (st.open) close(); else open(); }

    /* ---------- polling ---------- */
    function active() { return !gone && !isPhone() && !hidden(); }
    function tickOnce(rolledTick) {
      if (st.busy || gone) return Promise.resolve();
      st.busy = true;
      var npc = onStageName();
      return Promise.resolve().then(function () { return rolledTick === true ? gm.assistTick(st.after, npc, true) : npc ? gm.assistTick(st.after, npc) : gm.assistTick(st.after); }).then(function (res) {
        if (gone) return;
        if (isObj(res) && isObj(res.voice)) sendVoice(res.voice); else if (!npc) sendVoice(null);   /* nobody on stage: nothing from Voice shows */
        if (isObj(res) && isObj(res.stall) && str(res.stall.offer).trim()) sendStall(res.stall);
        if (isObj(res) && isObj(res.meanwhile) && str(res.meanwhile.cutaway).trim()) sendMeanwhile(res.meanwhile);
        if (isObj(res) && isObj(res.handout) && str(res.handout.id).trim() && typeof o.onHandout === 'function') { try { o.onHandout({ id: str(res.handout.id).trim(), why: str(res.handout.why), at: str(res.handout.at) }); } catch (e) {} }
        var fresh = absorb(st, res, new Date().toISOString());
        fresh.forEach(citeCheck);
        st.error = ''; st.checkedAt = hhmm(new Date().toISOString());
        if (st.open) { if (fresh.length) setNow(fresh[fresh.length - 1].id); markSeen(); }
        else if (fresh.length) showBanner(fresh[fresh.length - 1]);
        if (st.spend && st.spend.tier === 'off') { st.paused = 'cap'; sendNone(); }
      }, function (e) {
        if (gone) return;
        var k = errKind(e);
        if (k === 'cap' || k === 'busy') { st.paused = k; if (k === 'cap') sendNone(); }
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
        if (on && !st.since) st.since = hhmm(new Date().toISOString());
        if (!on) { sendNone(); render(); return; }   /* Listening off: Voice shows nothing */
        return tickOnce();
      }, function () { /* Listening could not be read: say nothing, try next minute */ });
    }
    function resume() { st.paused = ''; st.error = ''; render(); return poll(); }
    /* A result tapped or a roll filed on the page: 40 s later, one tick marked rolled, so Ref looks at the roll just made. One is pending at a time; a newer
       result restarts the 40 s. It goes through poll's gates (visible, not a phone, not paused, Listening on); a tick still in flight when it falls due
       makes it wait a few seconds, never drop. The regular minute is restarted afterwards, so the next ordinary tick is not squeezed up against it. */
    function rolled() {
      if (gone || !setT) return;
      if (rolledT && clrT) clrT(rolledT);
      rolledT = setT(function () { fireRolled(0); }, o.rolledMs || ROLLED_MS);
    }
    function fireRolled(tries) {
      rolledT = null;
      if (gone || !active() || st.paused) return Promise.resolve();
      if (st.busy) { if (tries < ROLLED_TRIES) rolledT = setT(function () { fireRolled(tries + 1); }, ROLLED_RETRY_MS); return Promise.resolve(); }
      return Promise.resolve().then(function () { return gm.stt(); }).then(function (r) {
        var d = r && isObj(r.doc) ? r.doc : null;
        if (!(d && d.want === 'on')) return;
        return tickOnce(true).then(function () { if (!gone && timer && clrI && setI && !o.noTimer) { clrI(timer); timer = setI(poll, o.interval || POLL_MS); } });
      }, function () { /* Listening could not be read: the next ordinary minute carries on */ });
    }

    /* ---------- Voice (the NPC on stage; its lines go to the page's Rack, not to this box) ---------- */
    function onStageName() { try { return typeof o.onStage === 'function' ? str(o.onStage()).replace(/\s+/g, ' ').trim().slice(0, NPC_MAX) : ''; } catch (e) { return ''; } }
    function sendVoice(v) { if (typeof o.onVoice === 'function') { try { o.onVoice(v); } catch (e) {} } }
    function sendNone() { sendVoice(null); sendStall(null); sendMeanwhile(null); }   /* Listening off, the cap: nothing from Voice, Stall or Meanwhile shows */
    function sendMeanwhile(v) { if (typeof o.onMeanwhile === 'function') { try { o.onMeanwhile(v); } catch (e) {} } }
    function sendStall(v) { if (typeof o.onStall === 'function') { try { o.onStall(v); } catch (e) {} } }
    /* the Another button needs what the Fixer's does: a box that is set up, not capped, not a phone */
    function canAnother() { return canFit() && !!gm && typeof gm.assistAnother === 'function'; }
    function another(req) {
      var npc = str(req && req.npc).replace(/\s+/g, ' ').trim(), shown = (req && Array.isArray(req.shown) ? req.shown : []).map(function (x) { return str(x).replace(/\s+/g, ' ').trim(); }).filter(Boolean).slice(-6);
      if (!npc || !shown.length || !canAnother()) return Promise.resolve(null);
      return Promise.resolve().then(function () { return gm.assistAnother({ npc: npc, shown: shown }); }).then(function (res) {
        if (gone) return null;
        if (isObj(res) && isObj(res.spend)) { absorb(st, { spend: res.spend, warnings: [] }, ''); render(); }
        var v = res && isObj(res.voice) && Array.isArray(res.voice.lines) && res.voice.lines.length ? res.voice : null;
        return v ? { voice: v } : { error: 'none' };
      }, function (e) {
        if (gone) return null;
        var k = errKind(e);
        if (k === 'cap') { st.paused = 'cap'; sendNone(); render(); }
        return { error: k };
      });
    }

    /* ---------- the Fixer ---------- */
    function fit(position, effect) {
      position = str(position).replace(/\s+/g, ' ').trim(); effect = str(effect).replace(/\s+/g, ' ').trim();
      if (!position || st.fit.busy) return Promise.resolve();
      st.fit.busy = true; st.fit.error = ''; renderFit();
      var req = { position: position }; if (effect) req.effect = effect;
      var dr = typeof o.draws === 'function' ? o.draws(position) : null; if (isObj(dr)) req.draws = dr;
      var dt = typeof o.dots === 'function' ? o.dots() : null; if (Number.isInteger(dt) && dt >= 0 && dt <= 4) req.dots = dt;
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

    /* the console's own fit: no UI of its own here (the page draws the Rack); this only decides whether to call, and folds the spend in */
    function canFit() { return !gone && !isPhone() && st.paused !== 'cap' && st.paused !== 'setup' && !(st.spend && st.spend.tier === 'off'); }
    function autoFit(req, onStart) {
      if (!canFit() || !gm || typeof gm.assistFit !== 'function' || typeof gm.stt !== 'function' || !isObj(req) || !isObj(req.draws)) return Promise.resolve(null);
      return Promise.resolve().then(function () { return gm.stt(); }).then(function (r) {
        var on = !!(r && isObj(r.doc) && r.doc.want === 'on');
        st.listening = on;
        if (!on || gone) { render(); return null; }
        if (typeof onStart === 'function') onStart();
        return Promise.resolve().then(function () { return gm.assistFit(req); }).then(function (res) {
          if (gone) return null;
          if (isObj(res) && isObj(res.spend)) { absorb(st, { spend: res.spend, warnings: [] }, ''); render(); }
          var c = res && Array.isArray(res.cards) ? res.cards[0] : null;
          return c && isObj(c) && fitLines(c).length ? { card: c } : { error: 'none' };
        }, function (e) {
          var k = errKind(e);
          if (k === 'cap') { st.paused = 'cap'; render(); }
          return { error: k };
        });
      }, function () { return null; });
    }

    /* ---------- events ---------- */
    function remove(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) { list.splice(i, 1); return true; } return false; }
    function onClick(ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-as]') : null; if (!b || !host.contains(b)) return;
      var a = b.getAttribute('data-as'), id = b.getAttribute('data-id');
      if (a === 'toggle') toggle();
      else if (a === 'close') close();
      else if (a === 'banner') open();
      else if (a === 'pin') togglePin();
      else if (a === 'fold') { st.unfolded[id] = !st.unfolded[id]; renderList(); refocus(id); }
      else if (a === 'chip') { st.filter = FILTERS.indexOf(b.getAttribute('data-k')) >= 0 ? b.getAttribute('data-k') : 'all'; render(); var cb = q('.as-chip[data-k="' + st.filter + '"]'); if (cb && cb.focus) { try { cb.focus(); } catch (e) {} } }
      else if (a === 'ack') { var k = st.cards.filter(function (x) { return x.id === id; })[0]; if (k) mark('dismiss', [k]); remove(st.cards, id); delete st.unfolded[id]; if (st.nowId === id) setNow(''); render(); }
      else if (a === 'keep') { var kc = st.cards.filter(function (x) { return x.id === id; })[0]; if (kc && !kc.kept && typeof o.onNote === 'function' && o.onNote(momentText(kc))) { kc.kept = true; mark('keep', [kc]); render(); } }
      else if (a === 'done') { var d = st.updates.filter(function (x) { return x.id === id; })[0]; if (d) mark('dismiss', [d]); remove(st.updates, id); render(); }
      else if (a === 'note') { var u = st.updates.filter(function (x) { return x.id === id; })[0]; if (u && typeof o.onNote === 'function' && o.onNote(u.text)) { mark('dismiss', [u]); remove(st.updates, id); render(); } }
      else if (a === 'ask-keep') { var ak = st.asks.filter(function (x) { return x.id === id; })[0]; if (ak && !ak.kept && typeof o.onNote === 'function' && o.onNote(askMoment(ak))) { ak.kept = true; mark('keep', [{ at: ak.at, text: ak.q }]); render(); } }
      else if (a === 'ask-x') { var ax = st.asks.filter(function (x) { return x.id === id; })[0]; if (ax) mark('dismiss', [{ at: ax.at, text: ax.q }]); remove(st.asks, id); render(); }
      else if (a === 'resume') resume();
      else if (a.indexOf('sc-') === 0) screenMake(a.slice(3), { name: (q('#as-sc-name') || {}).value, ask: (q('#as-sc-ask') || {}).value });
      else if (a === 'fitclear') { st.fit.card = null; st.fit.error = ''; renderFit(); }
    }
    function onSubmit(ev) {
      var form = ev.target && ev.target.getAttribute ? ev.target.getAttribute('data-as-form') : null;
      if (form === 'ask') { ev.preventDefault(); submitAsk(); return; }
      if (form !== 'fit') return;
      ev.preventDefault();
      var r = host.querySelector('input[name="as-pos"]:checked'), e = q('#as-eff');
      fit(r ? r.value : 'risky', e ? e.value : '');
    }
    function onKey(ev) {
      var t = ev.target, n = t && t.tagName ? t.tagName.toLowerCase() : '';
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && n === 'textarea' && t.id === 'as-ask-q') { ev.preventDefault(); submitAsk(); return; }   /* Enter asks, Shift+Enter is a new line */
      /* J / K move between the feed's cards and U undoes the newest done card, only with the focus in the panel and not in a field;
         Enter folds or unfolds because a card's line is a button */
      if (st.open && !ev.ctrlKey && !ev.metaKey && !ev.altKey && n !== 'input' && n !== 'textarea' && n !== 'select') {
        var kl = str(ev.key).toLowerCase();
        if (kl === 'j' || kl === 'k') { ev.preventDefault(); moveFocus(kl === 'j' ? 1 : -1); return; }
        if (kl === 'u') { ev.preventDefault(); undoNewest(); return; }
      }
      if (ev.key !== 'Escape' || !st.open) return;
      if (n === 'input' || n === 'textarea' || n === 'select') return;   /* the page blurs the field first; the next Escape closes the box */
      ev.preventDefault(); close();
    }
    function moveFocus(d) {
      var b = foldBtns(); if (!b.length) return;
      var i = b.indexOf(doc && doc.activeElement), ni = i < 0 ? (d > 0 ? 0 : b.length - 1) : Math.max(0, Math.min(b.length - 1, i + d));
      try { b[ni].focus(); } catch (e) {}
      try { if (b[ni].scrollIntoView) b[ni].scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }
    function onVis() { if (doc && !doc.hidden) poll(); }

    build();
    var ready = load();
    if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', onVis);
    if (setI && !o.noTimer) timer = setI(poll, o.interval || POLL_MS);
    if (!o.noTimer) setTimeout(function () { poll(); }, 1500);

    return {
      ready: ready, open: open, close: close, toggle: toggle, isOpen: function () { return st.open; }, pin: togglePin, isPinned: function () { return docked(); }, undoNewest: undoNewest, relayout: relayout, poll: poll, rolled: rolled, resume: resume, fit: fit, canFit: canFit, autoFit: autoFit, canAnother: canAnother, another: another, canScreen: canScreen, screenMake: screenMake, ask: ask, canAsk: canAsk,
      state: function () { return JSON.parse(JSON.stringify({ open: st.open, cards: st.cards, updates: st.updates, asks: st.asks, ask: st.ask, after: st.after, spend: st.spend, paused: st.paused, error: st.error, listening: st.listening, unread: unread(), fit: st.fit, screen: st.screen, banner: bannerCard ? bannerCard.text : '' })); },
      el: function () { return host; },
      destroy: function () {
        gone = true;
        if (timer && clrI) clrI(timer);
        if (bannerT && clrT) clrT(bannerT);
        if (nowT && clrT) clrT(nowT);
        if (rolledT && clrT) clrT(rolledT);
        if (lay.ro) { try { lay.ro.disconnect(); } catch (e) {} }
        if (win && typeof win.removeEventListener === 'function') { win.removeEventListener('resize', onResize); win.removeEventListener('scroll', onScroll); }
        bodyClass('as-tab', false); bodyClass('as-dock', false);
        if (doc && doc.removeEventListener) doc.removeEventListener('visibilitychange', onVis);
        if (host && host.parentNode) host.parentNode.removeChild(host);
        host = null;
      }
    };
  }

  return { create: create, POSITIONS: POSITIONS, KINDS: KINDS, _pure: P };
});
