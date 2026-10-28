/* B68GmAssist — "Claude at the table", the GM page's Blade side panel (build plan Phase 1; functions/api/gm/assist.js is the server side).
   Closed, it is a 44 px tab on the right edge between the top bar and the capture bar: the table agent's portrait, the count of unread
   cards and up to five coloured pips (one per unread card, by kind, newest on top); a rule or warn card that arrives slides a one-line strip out of the tab for 8 s (every other kind only adds a pip).
   Open, it is a panel 400 px wide (at least 360, at most 33vw) that slides in over the page (a transform, 180 ms; none under
   prefers-reduced-motion). At >= 1600 px Pin docks it as a fourth .gm-main column (body.as-dock). Under 600 px it is not drawn.
   Top to bottom: the header (the state as a dot and a word, the spend with a five-cell meter, the three seats' health dots, Pin, close),
   Now (the newest unread card, open, for 1.5 s once the panel is open), the Ask bar, the feed (filter chips with counts, then the cards
   newest first, each folded to one 44 px line; an "Earlier tonight" divider after 30 minutes) and the Tools drawer at the foot (Fit it,
   the Screen, the Ledger's updates). A card has a kind (rule, say, idea, done, warn, note) with a colour, a glyph and a word.
   Keys: A toggles (the page), Esc closes (not while typing), J / K move between the feed's cards, Enter folds or unfolds the focused
   card, U undoes the newest done card that has an undo (ctl.undoNewest()). J, K and U count only with the focus inside the panel.
   The card (P3, design 3.5-3.8): one renderer for every kind. Folded it is one 44 px line (colour bar, glyph, word, headline, time); unfolded it is the
   headline, up to 5 bullets, SAY, GM ONLY, the cite and check chips and the actions (Keep, Got it, Undo on a done card, More). Headline, bullets, SAY and
   GM ONLY are text with **bold** and *italic* as the only marks, built as DOM nodes (textContent); `more` goes through B68Markdown.render with headings
   stripped, the one place HTML is set. A card is never taller than the panel; More scrolls inside it. Rendering is keyed: only a card that changed is
   rebuilt, and the Markdown is rendered once per text. Ask Blade's answers are cards too (src ask). Cards made on the page come from ctl.addCard.
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
         markdown  { render(src, opts) -> html }: default window.B68Markdown (app/markdown.js); without it `more` shows as plain text
         onNote    the page's capture: "Note it" on a Ledger update and "Keep" on a card file their text as a Moment (the update
                   itself changes no state)
     ctl.open() / close() / toggle()      the panel
     ctl.pin() / isPinned()               dock it as a column (>= 1600 px only; a no-op below) / is it docked now
     ctl.undoNewest() -> Promise<{ id } | { error } | null>   U: undo the newest done card that has an undo function (null when none)
     ctl.addCard({ id?, kind, headline, bullets?, say?, secret?, more?, cite?, check?, seat?, undo? }) -> id    a card made on this page (co-GM, autopilot, warnings);
                                         never sent to the server, gone on reload; undo is a function the card's Undo button calls
     ctl.removeCard(id) -> bool           take a page card down (no mark, onAck not called)
     A page card may also carry (P4): body (plain text, pre-wrapped), bodyLabel, chips [{ text, tone: ok|bad|unk|wait }], actions [{ id, label, primary?, disabled?, title?, run }]
                                         (run is the page's own function; the panel sends nothing anywhere), ackLabel + onAck (the Got-it button's label and the page's work after it),
                                         figure (a factory returning a node, with figKey to say when it changed) and open (start unfolded)
     ctl.updateCard(id, patch) -> bool    change a card's kind, headline, bullets, say, secret, more, cite or check (and undone / undo)
     ctl.relayout()                       measure the top bar and the capture bar again (the page calls it after it redraws its layout)
     ctl.cogmSwitch({ onChange(on) }) -> { set(on, note), isOn(), box() -> { key, listening, tier }, destroy() } | null    the co-GM switch in the header (C2): off when made, no memory;
                                         the page decides what a tap means and calls set(); box() says whether the box is on (key 'on' = Listening)
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
   Shift+Enter is a new line) and the answer lands in the feed as a card (open, at the top; not in Now, which would drop it after 1.5 s) for the GM's
   eyes only, so nothing is handed to the page but "Keep", which files "Blade, ask (HH:MM): question -> answer" through o.onNote. One question at a
   time; a failed one keeps its words in the field. The last ten answers come back from the server's log after a reload (assistCards().asks);
   "Got it" dismisses one for good.
     ctl.ask(q) -> Promise<{ answer } | { error } | null>   POST /gm/assist/ask { q }; null when the box cannot ask or is already asking
     ctl.canAsk() -> bool     false on a phone, with the cap reached or the box not set up, from 85% of the cap (tier core), or when the runtime
                              has no assistAsk
   _pure: errKind, errLine, mkCard, inlineNodes, appendInline, stripHeadings, cardKind, fitLines, tierLabel, spendLine, absorb, restore, restoreAsks, momentText, askMoment, askAllowed, askErr, hhmm, clip,
   gateText, citesOf, gateLine, screenAllowed. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmAssist = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var P = {};
  var BANNER_MS = 8000, POLL_MS = 60000, ROLLED_MS = 40000, ROLLED_RETRY_MS = 3000, ROLLED_TRIES = 20, MAX_CARDS = 60, MAX_UPDATES = 30, NPC_MAX = 80;
  var POSITIONS = ['controlled', 'risky', 'desperate'];
  var SEAT = { ref: 'Rule slip', clerk: 'Clerk', fixer: 'Fixer', ledger: 'Ledger', mystery: 'Mystery', showrunner: 'Pacing', stall: 'Stall', meanwhile: 'Meanwhile', handout: 'Handout', screen: 'Screen', cogm: 'Co-GM' };
  var TIER = { all: 'Full', reduced: 'Reduced', core: 'Core only', off: 'Off: cap reached' };
  /* the glance grammar (design 3.2): every card has a kind, and a kind has a colour (CSS: --k-*), a glyph and a word, so colour is never alone */
  var KINDS = ['rule', 'say', 'idea', 'done', 'warn', 'note'];
  var KIND = { rule: { glyph: '⚙', word: 'Rule' }, say: { glyph: '▶', word: 'Say' }, idea: { glyph: '✦', word: 'Idea' }, done: { glyph: '✓', word: 'Done' }, warn: { glyph: '⚠', word: 'Stop' }, note: { glyph: '·', word: 'Note' } };
  var SEAT_KIND = { ref: 'rule', fixer: 'say', mystery: 'idea', showrunner: 'idea', clerk: 'note', ledger: 'note' };
  var FILTERS = ['all'].concat(KINDS.filter(function (k) { return k !== 'warn'; }));   /* All, Rule, Say, Idea, Done, Note: a warn is rare and always shows under All */
  var PIPS_MAX = 5, EARLIER_MS = 30 * 60 * 1000, FOLD_CHARS = 140, NOW_MS = 1500;
  var BULLETS_MAX = 5, BULLET_CHARS = 160, SAY_MAX = 1500, SECRET_MAX = 1000, MORE_MAX = 4000, CITE_MAX = 40, BODY_MAX = 2400, ACTIONS_MAX = 8, CHIPS_MAX = 4;
  var TONES = ['ok', 'bad', 'unk', 'wait'];
  var STRIP_KINDS = ['rule', 'warn'];      /* the only kinds that slide a strip out of the closed tab; every other kind is a pip */
  var ASK_KIND = { rule: 'rule', say: 'say', idea: 'idea', npc: 'say', recap: 'note', other: 'note' };      /* Ask Blade's own kinds -> the six */
  var CHECK_WORD = { order: 'Order', resist: 'Resist', harm: 'Harm', cost: 'Cost', house: 'House rule', other: 'Check' };
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
  /* a card's kind: its own when it is one of the six (a Stall card's complication / clue is not), else its seat's */
  function cardKind(c) { return c && KINDS.indexOf(c.kind) >= 0 ? c.kind : kindOf(c && c.seat); }
  P.kindOf = kindOf; P.cardKind = cardKind; P.KIND = KIND; P.FILTERS = FILTERS;
  /* the feed's chip counts: { all, rule, say, idea, done, warn, note } */
  function countsOf(cards) {
    var n = { all: 0 }; KINDS.forEach(function (k) { n[k] = 0; });
    (Array.isArray(cards) ? cards : []).forEach(function (c) { n.all++; n[cardKind(c)]++; });
    return n;
  }
  P.countsOf = countsOf;
  /* the cards a filter shows, newest first (All shows every kind, a warn among them) */
  function feedOf(cards, filter) {
    return (Array.isArray(cards) ? cards : []).filter(function (c) { return !filter || filter === 'all' || cardKind(c) === filter; }).slice().reverse();
  }
  P.feedOf = feedOf;
  /* the tab's pips: the kinds of the unread cards, newest first, at most five */
  function pipsOf(cards) {
    return (Array.isArray(cards) ? cards : []).filter(function (c) { return !c.seen; }).reverse().slice(0, PIPS_MAX).map(function (c) { return cardKind(c); });
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

  /* ---------- seat health (design 2.1 and 3.4): the dots for the Tripwire, Ref and Voice ----------
     Fed by the tick answer's `health: { skipped: [{ seat, why }], reaped: [seat], ran: [seat] }`. Three states, each with its own shape and word as well as a colour:
       ok     ran within the last 10 minutes (`ran` names the seats whose call came back with an answer)
       stuck  skipped as in-flight on 2 health-bearing answers in a row (any answer without that resets it; a reaped lease clears it)
       asleep anything else: not woken, on cooldown, held by the budget ladder. A seat that was not woken is not a fault.
       unknown  no tick has answered yet.
     healthStep is pure (a new state out, the old one untouched); healthView is evaluated at render time with the clock handed in. */
  var HEALTH_SEATS = ['tripwire', 'ref', 'voice'], HEALTH_FRESH_MS = 10 * 60 * 1000, HEALTH_STUCK_TICKS = 2;
  var HEALTH_NAME = { tripwire: 'Tripwire', ref: 'Ref', voice: 'Voice' };
  var HEALTH_WORD = { ok: 'ran in the last 10 minutes', asleep: 'asleep: not woken lately', stuck: 'stuck: skipped as still running on two ticks', unknown: 'no reading yet' };
  function healthNew() {
    var seats = {}; HEALTH_SEATS.forEach(function (k) { seats[k] = { at: 0, streak: 0 }; });
    return { seen: false, seats: seats, reaped: [] };
  }
  function healthStep(prev, health, nowMs) {
    var p = isObj(prev) && isObj(prev.seats) ? prev : healthNew();
    if (!isObj(health)) return p;                                  /* an answer without health (ask, fit, an error) says nothing about the seats */
    var skipped = Array.isArray(health.skipped) ? health.skipped : [], ran = Array.isArray(health.ran) ? health.ran : [], reaped = Array.isArray(health.reaped) ? health.reaped : [];
    var seats = {};
    HEALTH_SEATS.forEach(function (k) {
      var was = isObj(p.seats[k]) ? p.seats[k] : { at: 0, streak: 0 }, at = was.at, streak = 0;
      if (ran.indexOf(k) >= 0 && isFinite(nowMs)) at = nowMs;
      if (skipped.some(function (x) { return isObj(x) && x.seat === k && x.why === 'in-flight'; })) streak = was.streak + 1;
      if (reaped.indexOf(k) >= 0) streak = 0;                      /* the lease lapsed and was swept: the seat is free again */
      seats[k] = { at: at, streak: streak };
    });
    return { seen: true, seats: seats, reaped: reaped.filter(function (x) { return typeof x === 'string' && x; }).slice(0, 6) };
  }
  function healthView(h, nowMs) {
    var p = isObj(h) && isObj(h.seats) ? h : healthNew();
    return HEALTH_SEATS.map(function (k) {
      var e = isObj(p.seats[k]) ? p.seats[k] : { at: 0, streak: 0 }, state;
      if (!p.seen) state = 'unknown';
      else if (e.streak >= HEALTH_STUCK_TICKS) state = 'stuck';
      else if (e.at && isFinite(nowMs) && nowMs - e.at <= HEALTH_FRESH_MS) state = 'ok';
      else state = 'asleep';
      return { seat: k, state: state, word: HEALTH_WORD[state] };
    });
  }
  /* the one quiet line for a lease the server had to reap: '' when nothing was */
  function reapedLine(h) {
    var r = isObj(h) && Array.isArray(h.reaped) ? h.reaped : [];
    if (!r.length) return '';
    return 'Blade freed a stuck seat (' + r.map(function (k) { return str(HEALTH_NAME[k] || k); }).join(', ') + '). It is working again.';
  }
  P.healthNew = healthNew; P.healthStep = healthStep; P.healthView = healthView; P.reapedLine = reapedLine; P.HEALTH_FRESH_MS = HEALTH_FRESH_MS;
  /* a card's folded line: one line of its text, cut with an ellipsis */
  function headline(text) { return clip(text, FOLD_CHARS); }
  P.headline = headline;

  /* the Fixer's answer as the five lines the GM reads aloud, in the order the dice are read */
  function fitLines(card) {
    var c = isObj(card) ? card : {};
    return [['1–3', 'one_three'], ['4–5', 'four_five'], ['6', 'six'], ['Crit', 'crit'], ['Bargain', 'bargain']].map(function (r) { return { label: r[0], text: str(c[r[1]]).trim() }; }).filter(function (l) { return l.text; });
  }
  P.fitLines = fitLines;

  /* ---------- a card, as the panel holds it (design 3.6) ----------
     { id, src, seat, kind, at, text, headline, bullets[], say, secret, more, cite, check, detail, seen, kept, filed, important }
     src: 'tick' (a card the server logged: it also marks seen / dismissed / kept), 'ask' (an Ask Blade answer: marked by its question) or
     'page' (made on this page by addCard: the server knows nothing of it). `text` is the server's own text and is never overwritten: the marks
     match on it. Everything the renderer shows comes from the glance fields; a card from before them is built from text and detail. */
  function lines(v, max, n) {
    return (Array.isArray(v) ? v : []).map(function (b) { return clip(b, max); }).filter(Boolean).slice(0, n);
  }
  function block(v, max) { var s = str(v).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s; }
  /* what only a card made on this page can carry (P4): a plain-text body, chips, action buttons, a label for the Got-it button and a figure key. Data only:
     the functions behind the actions, the Got-it button and the figure live in maps inside the panel, never on the card (state() copies cards). */
  function pageFields(card, raw) {
    card.body = block(raw.body, BODY_MAX); card.bodyLabel = clip(raw.bodyLabel, 24);
    card.chips = (Array.isArray(raw.chips) ? raw.chips : []).filter(isObj).map(function (x) { return { text: clip(x.text, 40), tone: TONES.indexOf(x.tone) >= 0 ? x.tone : '' }; }).filter(function (x) { return x.text; }).slice(0, CHIPS_MAX);
    card.actions = (Array.isArray(raw.actions) ? raw.actions : []).filter(isObj).map(function (x) {
      return { id: clip(x.id, 24), label: clip(x.label, 40), title: clip(x.title, 120), primary: !!x.primary, disabled: !!x.disabled };
    }).filter(function (x) { return x.id && x.label; }).slice(0, ACTIONS_MAX);
    card.ackLabel = clip(raw.ackLabel, 24); card.figKey = clip(raw.figKey, 120); card.open = !!raw.open;
  }
  function mkCard(raw, src, o2) {
    o2 = o2 || {};
    var text = str(raw.text).trim(), detail = isObj(raw.detail) ? { said_at: str(raw.detail.said_at), rule: clip(raw.detail.rule, 220) } : null;
    var headline = clip(raw.headline, FOLD_CHARS) || clip(text, FOLD_CHARS), bullets = lines(raw.bullets, BULLET_CHARS, BULLETS_MAX), more = block(raw.more, MORE_MAX);
    if (!bullets.length && detail && (detail.said_at || detail.rule)) bullets = lines([detail.said_at ? 'Said at ' + detail.said_at : '', detail.rule], BULLET_CHARS, BULLETS_MAX);   /* a card from before the glance fields */
    /* the headline was cut: the whole text is not lost, it goes under More */
    if (!more && text && !bullets.length && text.replace(/\s+/g, ' ') !== headline) more = block(text, MORE_MAX);
    else if (!more && text && /…$/.test(headline) && text.length > headline.length) more = block(text, MORE_MAX);
    var kind = src === 'ask' ? (ASK_KIND[raw.kind] || 'note') : KINDS.indexOf(raw.kind) >= 0 ? raw.kind : kindOf(raw.seat);
    var seat = str(raw.seat) || (src === 'ask' ? 'ask' : 'page');
    var card = { id: o2.id, src: src, seat: seat, kind: kind, at: str(raw.at) || o2.nowIso || '', text: text || headline, headline: headline, bullets: bullets,
      say: block(raw.say, SAY_MAX), secret: block(raw.secret, SECRET_MAX), more: more, cite: clip(raw.cite, CITE_MAX), check: CHECK_WORD[raw.check] ? str(raw.check) : '',
      detail: detail, seen: !!o2.seen, kept: !!o2.kept, filed: !!o2.filed, important: seat === 'ref' };
    if (src === 'ask') card.q = str(raw.q);
    if (src === 'page') pageFields(card, raw);
    return card;
  }
  function cardId(c) { return str(c.seat) + '|' + str(c.at) + '|' + str(c.text); }
  P.mkCard = mkCard;

  /* the headline, bullets, SAY and GM ONLY are text with **bold** and *italic* as the only marks. They are built as nodes (strong, em, text
     nodes): nothing here is ever parsed as HTML. An unmatched * stays a *. */
  var INLINE_RE = /\*\*([^*\n](?:[^\n]*?[^*\n])?)\*\*|\*([^*\s](?:[^*\n]*?[^*\s])?)\*/g;
  function inlineNodes(doc, text) {
    var s = str(text), out = [], last = 0, m;
    INLINE_RE.lastIndex = 0;
    while ((m = INLINE_RE.exec(s))) {
      if (m.index > last) out.push(doc.createTextNode(s.slice(last, m.index)));
      var e = doc.createElement(m[1] !== undefined ? 'strong' : 'em'); e.textContent = m[1] !== undefined ? m[1] : m[2]; out.push(e);
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push(doc.createTextNode(s.slice(last)));
    return out;
  }
  function appendInline(doc, parent, text) { inlineNodes(doc, text).forEach(function (n) { parent.appendChild(n); }); return parent; }
  P.inlineNodes = inlineNodes; P.appendInline = appendInline;

  /* `more` is Markdown without headings: a heading line becomes a bold line (outside a code fence), then B68Markdown.render does the rest */
  function stripHeadings(src) {
    var fence = '';
    return str(src).replace(/\r\n?/g, '\n').split('\n').map(function (l) {
      var f = /^\s{0,3}(```|~~~)/.exec(l);
      if (f) { fence = !fence ? f[1] : fence === f[1] ? '' : fence; return l; }
      if (fence) return l;
      var h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(l);
      return h ? (h[1] && h[1].indexOf('*') < 0 ? '**' + h[1] + '**' : h[1]) : l;
    }).join('\n');
  }
  P.stripHeadings = stripHeadings;

  /* fold a tick answer into the box's state (mutates `st`); returns the cards that are new */
  function absorb(st, res, nowIso) {
    var r = isObj(res) ? res : {}, fresh = [];
    if (typeof r.last === 'number' && r.last >= 0) st.after = r.last;
    (Array.isArray(r.cards) ? r.cards : []).forEach(function (c) {
      if (!isObj(c) || !str(c.text).trim()) return;
      var id = cardId({ seat: c.seat, at: str(c.at) || nowIso, text: str(c.text).trim() });
      if (st.cards.some(function (x) { return x.id === id; })) return;
      var card = mkCard(c, 'tick', { id: id, nowIso: nowIso });
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
    if (isObj(r.health)) { var tms = Date.parse(nowIso); st.health = healthStep(st.health, r.health, isFinite(tms) ? tms : Date.now()); }
    return fresh;
  }
  P.absorb = absorb;

  /* tonight's cards and updates from the server's log (GET /gm/assist/cards) into the box, after a reload. Cards already here are
     left alone (the id is the same three values the tick answer carries). Restored cards keep the server's read / kept / filed
     marks, so the unread count survives a reload; none of them pops a strip. Ask Blade's answers come back as cards too. Returns how many cards were added. */
  function restore(st, res) {
    var r = isObj(res) ? res : {}, n = 0;
    (Array.isArray(r.cards) ? r.cards : []).forEach(function (c) {
      if (!isObj(c) || !str(c.text).trim() || c.dismissed) return;
      var id = cardId({ seat: c.seat, at: str(c.at), text: str(c.text).trim() });
      if (st.cards.some(function (x) { return x.id === id; })) return;
      st.cards.push(mkCard(c, 'tick', { id: id, seen: !!c.seen, kept: !!c.kept, filed: !!c.filed }));
      n++;
    });
    restoreAsks(st, r);
    st.cards.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
    (Array.isArray(r.updates) ? r.updates : []).forEach(function (u) {
      if (!isObj(u) || !str(u.text).trim()) return;
      var id = 'u|' + str(u.at) + '|' + str(u.key) + '|' + str(u.text);
      if (st.updates.some(function (x) { return x.id === id; })) return;
      st.updates.push({ id: id, at: str(u.at), key: str(u.key), text: clip(u.text, 240) });
    });
    if (st.cards.length > MAX_CARDS) st.cards = st.cards.slice(-MAX_CARDS);
    if (st.updates.length > MAX_UPDATES) st.updates = st.updates.slice(-MAX_UPDATES);
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
  /* the answers the server holds for tonight (GET /gm/assist/cards -> asks) into the box as cards (src 'ask', id a|at|question, seen: the GM
     asked for them, and the server never records a read for one), oldest first, at most ten; one already here is left alone. Returns how many were added. */
  function askCardId(at, q) { return 'a|' + str(at) + '|' + str(q); }
  function trimAsks(st) {
    var asks = st.cards.filter(function (c) { return c.src === 'ask'; });
    if (asks.length > MAX_ASKS) { var drop = asks.slice(0, asks.length - MAX_ASKS); st.cards = st.cards.filter(function (c) { return drop.indexOf(c) < 0; }); }
  }
  function restoreAsks(st, res) {
    var r = isObj(res) ? res : {}, n = 0;
    (Array.isArray(r.asks) ? r.asks : []).forEach(function (a) {
      if (!isObj(a) || !str(a.text).trim() || !str(a.q).trim() || a.dismissed) return;
      var id = askCardId(a.at, a.q);
      if (st.cards.some(function (x) { return x.id === id; })) return;
      st.cards.push(mkCard(a, 'ask', { id: id, seen: true, kept: !!a.kept })); n++;
    });
    st.cards.sort(function (x, y) { return x.at < y.at ? -1 : x.at > y.at ? 1 : 0; });
    trimAsks(st);
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

  /* a mark names the log row by (at, text), as the server logged it; an Ask Blade answer is matched by its question; a card made on this page is not in the log */
  function markOf(it) { var m = { at: it.at, text: it.src === 'ask' ? it.q : it.text }; if (it.key !== undefined) m.key = it.key; return m; }

  function create(o) {
    o = o || {};
    var gm = o.gm, doc = o.doc || (W && W.document), win = o.win || W;
    var st = { open: false, cards: [], updates: [], after: null, spend: null, paused: '', error: '', setup: false, listening: null, checkedAt: '', busy: false,
      fit: { busy: false, error: '', card: null }, screen: { busy: {}, error: '' }, ask: { busy: false, error: '' },
      pinned: false, filter: 'all', unfolded: {}, moreOpen: {}, nowId: '', since: '', chipSig: '' };
    var scrollFeedTop = false, host = null, timer = null, bannerT = null, nowT = null, rolledT = null, gone = false, bannerCard = null;
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
      items = items.filter(function (it) { return it.src !== 'page' && !(it.src === 'ask' && op === 'seen'); });
      if (!items.length || !gm || typeof gm.assistMark !== 'function') return;
      Promise.resolve().then(function () { return gm.assistMark({ op: op, items: items.map(markOf) }); }).then(null, function () {});
    }
    /* one request for any number of cards: a seen mark is a batch, as it was before cards had a Now */
    function markSeenMany(list) { var u = list.filter(function (c, i) { return c && !c.seen && list.indexOf(c) === i; }); u.forEach(function (c) { c.seen = true; }); if (u.length) mark('seen', u); }
    function markSeenOne(c) { markSeenMany([c]); }
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
        '<div class="as-sr" id="as-alert" aria-live="assertive" aria-atomic="true"></div>' +
        '<aside class="as-panel" id="as-panel" aria-label="Blade, the table agent" hidden>' +
          '<header class="as-head"><div class="as-head-1"><img class="as-av" src="' + esc(avatar) + '" alt="" width="32" height="32">' +
            '<div class="as-who"><b tabindex="-1" id="as-name">Blade</b><span class="as-state" id="as-state" data-state="wait"><i class="as-dot" aria-hidden="true"></i><span id="as-state-word">Waiting</span></span></div>' +
            '<button type="button" class="as-pin" id="as-pin" data-as="pin" aria-pressed="false" hidden>Pin</button>' +
            '<button type="button" class="as-x" data-as="close" aria-label="Close Blade (A)"><span aria-hidden="true">×</span></button></div>' +
            '<div class="as-head-2"><span class="as-tier" id="as-tier" hidden></span><span class="as-meter" id="as-meter" role="img" aria-label="Spend: no reading yet" data-tone="ok"></span>' +
              '<span class="as-health" id="as-health" role="group" aria-label="Seat health">' + HEALTH.map(function (h) {
                return '<span class="as-hd" id="as-hd-' + h[1].toLowerCase() + '" data-seat="' + h[1].toLowerCase() + '" data-health="unknown" title="' + h[1] + ': ' + HEALTH_WORD.unknown + '"><b aria-hidden="true">' + h[0] + '</b><i aria-hidden="true"></i><span class="as-sr">' + h[1] + ': ' + HEALTH_WORD.unknown + '</span></span>'; }).join('') + '</span></div>' +
            '<p class="as-note" id="as-reaped" role="status" hidden></p></header>' +
          '<p class="as-status" id="as-status" role="status"></p>' +
          '<section class="as-now" id="as-nowz" aria-label="Now"><p class="as-zlab">Now</p><div id="as-now" aria-live="polite"></div></section>' +
          '<div class="as-body">' +
            '<form class="as-ask" id="as-ask" data-as-form="ask" aria-label="Ask Blade"><p class="as-lab as-sr">Ask Blade: for your eyes only</p>' +
              '<div class="as-ask-row"><div class="as-ask-in"><textarea id="as-ask-q" maxlength="' + ASK_MAX + '" rows="2" placeholder="Ask Blade: a ruling, three ideas, a read-aloud…" autocomplete="off" aria-label="Ask Blade"></textarea></div>' +
              '<button type="submit" class="as-go" id="as-ask-go">Ask</button></div>' +
              '<div class="as-prog" id="as-prog" hidden></div>' +
              '<p class="as-status" id="as-ask-status" role="status" aria-live="polite"></p></form>' +
            '<div class="as-feed" id="as-feed">' +
              '<div class="as-chips" id="as-chips" role="group" aria-label="Show cards of one kind"></div>' +
              '<ol class="as-list" id="as-list" aria-label="Cards" aria-live="polite" aria-relevant="additions"></ol></div>' +
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
      var pp = q('#as-pips'), pk = pipsOf(st.cards), psig = pk.join(',');
      if (pp && cache.pipSig !== psig) {
        cache.pipSig = psig; while (pp.firstChild) pp.removeChild(pp.firstChild);
        pk.forEach(function (k) { var i = doc.createElement('i'); i.className = 'as-pip'; i.setAttribute('data-kind', k); i.setAttribute('title', KIND[k].word); pp.appendChild(i); });
      }
      q('#as-panel').hidden = !st.open;
      applyState();
      var tier = q('#as-tier');
      var tl = st.spend ? tierLabel(st.spend.tier) : '';
      tier.hidden = !tl; tier.textContent = tl ? tl + (spendLine(st.spend) ? ' · ' + spendLine(st.spend) : '') : '';
      tier.setAttribute('data-tier', st.spend ? st.spend.tier : '');
      renderHead(); renderStatus(); renderNow(); renderAsk(); renderChips(); renderList(); renderUpdates(); renderFit(); renderScreen();
      if (scrollFeedTop) { scrollFeedTop = false; var fe = q('#as-feed'); if (fe) fe.scrollTop = 0; }
    }
    function nowMs() { return typeof o.nowMs === 'function' ? +o.nowMs() : Date.now(); }
    function renderHead() {
      var s = stateOf({ paused: st.paused, setup: st.setup, spend: st.spend, listening: st.listening }), el = q('#as-state'), w = q('#as-state-word');
      if (el) el.setAttribute('data-state', s.key);
      if (w) w.textContent = s.word;
      var m = q('#as-meter');
      if (m) {
        var mo = meterOf(st.spend);
        m.setAttribute('data-tone', mo.tone);
        m.innerHTML = [0, 1, 2, 3, 4].map(function (i) { return '<i' + (i < mo.cells ? ' class="on"' : '') + '></i>'; }).join('');
        m.setAttribute('data-cells', String(mo.cells));
        m.setAttribute('aria-label', st.spend && st.spend.cap > 0 ? 'Spend: ' + Math.round(mo.frac * 100) + '% of tonight’s cap' + (mo.tone === 'warn' ? ', nearly used up' : mo.tone === 'mid' ? ', past 60%' : '') : 'Spend: no reading yet');
      }
      healthView(st.health, nowMs()).forEach(function (d) {
        var hd = q('#as-hd-' + d.seat); if (!hd) return;
        var label = (HEALTH_NAME[d.seat] || d.seat) + ': ' + d.word;
        hd.setAttribute('data-health', d.state); hd.setAttribute('title', label);
        var sr = hd.querySelector ? hd.querySelector('.as-sr') : null; if (sr && sr.textContent !== label) sr.textContent = label;
      });
      var rl = q('#as-reaped'), rt = reapedLine(st.health);
      if (rl) { rl.hidden = !rt; rl.textContent = rt; }
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
    /* ---- the card: one component for every kind (design 3.5). Built as DOM nodes with textContent; the only HTML is B68Markdown.render for
       `more`. Folded it is one 44 px line; unfolded it is the headline, up to five bullets, SAY, GM ONLY, the cite and check chips and the actions.
       Rendering is keyed: a card's node is rebuilt only when what it shows has changed, and `more` is rendered to HTML once per text. ---- */
    var MOCKS = [
      { id: 'mock-rule', seat: 'ref', headline: 'Example rule slip: a placeholder that shows how a rule card looks.', bullets: ['A placeholder bullet.', 'Another, to show the list.'], cite: 'p.0' },
      { id: 'mock-idea', seat: 'mystery', headline: 'Example idea: a placeholder suggestion in the idea colour.', say: 'A placeholder line to read aloud.' },
      { id: 'mock-done', seat: 'ledger', kind: 'done', headline: 'Example done: a placeholder for something Blade did, with Undo.' }
    ];
    var cache = { nodes: {}, more: {}, nowKey: '', nowEl: null, pipSig: null, builds: 0, moreRenders: 0 };      /* render caches live here, never on the cards (state() copies the cards) */
    var undoFns = {}, actFns = {}, ackFns = {}, figFns = {};      /* page-made cards: the functions behind Undo, the action buttons, Got it and the figure */
    function mockCards() { return MOCKS.map(function (m) { var c = mkCard(Object.assign({ at: '' }, m), 'page', { id: m.id, seen: true }); c.mock = true; return c; }); }
    function cardKind2(c) { return cardKind(c); }
    function E(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; }
    function B(cls, label, attrs) {
      var b = E('button', cls, label); b.setAttribute('type', 'button');
      Object.keys(attrs || {}).forEach(function (k) { b.setAttribute(k, attrs[k]); });
      return b;
    }
    function clear(e) { while (e.firstChild) e.removeChild(e.firstChild); }
    function canUndo(c) { return cardKind2(c) === 'done' && !c.undone && typeof undoFns[c.id] === 'function'; }
    function canKeep(c) { return !c.mock && typeof o.onNote === 'function'; }
    function isOpen(c, now) { return now || !!st.unfolded[c.id]; }
    /* what a card shows, as one string: when it changes, its node is rebuilt, and only then */
    function sigOf(c, now) {
      return JSON.stringify([cardKind2(c), c.headline, c.bullets, c.say, c.secret, c.more, c.cite, c.check, c.kept, c.filed, c.important, c.citeBad || null, !!c.undone,
        canUndo(c), c.body || '', c.bodyLabel || '', c.chips || null, c.actions || null, c.ackLabel || '', c.figKey || '', canKeep(c), isOpen(c, now), !!st.moreOpen[c.id], c.at, !!c.mock, c.src, c.q || '', SEAT[c.seat] || c.seat]);
    }
    function moreHtml(c) {
      var ent = cache.more[c.id];
      if (ent && ent.src === c.more) return ent.html;
      var md = o.markdown || (W && W.B68Markdown), html = null;
      if (md && typeof md.render === 'function') { try { html = md.render(stripHeadings(c.more), { headingOffset: 1 }); } catch (e) { html = null; } }
      cache.moreRenders++;
      cache.more[c.id] = { src: c.more, html: html };
      return html;
    }
    function buildCard(c, now) {
      cache.builds++;
      var k = cardKind2(c), kd = KIND[k], open = isOpen(c, now);
      var root = E(now ? 'div' : 'li', 'as-card' + (now ? ' as-now-card' : ''));
      root.setAttribute('data-id', c.id); root.setAttribute('data-seat', c.seat); root.setAttribute('data-kind', k); root.setAttribute('data-open', open ? '1' : '0');
      if (c.mock) root.setAttribute('data-mock', '');
      var head = now ? E('div', 'as-fold') : B('as-fold', null, { 'data-as': 'fold', 'data-id': c.id, 'aria-expanded': String(open) });
      var kind = E('span', 'as-kind'), gl = E('span', 'as-glyph', kd.glyph); gl.setAttribute('aria-hidden', 'true');
      kind.appendChild(gl); kind.appendChild(E('b', null, kd.word));
      var tx = E('span', 'as-text'); appendInline(doc, tx, c.headline);
      head.appendChild(kind); head.appendChild(tx);
      head.appendChild(c.mock ? E('span', 'as-eg', 'example') : E('time', null, hhmm(c.at)));
      root.appendChild(head);

      var more = E('div', 'as-more');
      if (c.src === 'ask' && c.q) more.appendChild(E('p', 'as-askq', 'You asked: ' + c.q));
      if (c.bullets.length) {
        var ul = E('ul', 'as-bullets');
        c.bullets.forEach(function (b) { appendInline(doc, ul.appendChild(E('li')), b); });
        more.appendChild(ul);
      }
      if (typeof figFns[c.id] === 'function' && c.figKey) {
        var fig = null; try { fig = figFns[c.id](); } catch (e) { fig = null; }
        if (fig && fig.nodeType === 1) more.appendChild(fig);      /* the page builds it (the figure kit's own drawing); the panel only places it */
      }
      if (c.body) {
        var bd = E('div', 'as-body'); if (c.bodyLabel) bd.appendChild(E('b', 'as-band', c.bodyLabel)); bd.appendChild(E('pre', 'as-body-text', c.body));
        more.appendChild(bd);
      }
      if (c.say) {
        var say = E('div', 'as-say'); say.appendChild(E('b', 'as-band', 'SAY')); appendInline(doc, say.appendChild(E('p', 'as-band-text')), c.say);
        more.appendChild(say);
      }
      if (c.secret) {
        var sec = E('div', 'as-secret'); sec.appendChild(E('b', 'as-band', 'GM ONLY')); appendInline(doc, sec.appendChild(E('p', 'as-band-text')), c.secret);
        more.appendChild(sec);
      }
      var chips = E('div', 'as-chiprow');
      if (SEAT[c.seat]) chips.appendChild(E('span', 'as-seatname', SEAT[c.seat]));
      (c.chips || []).forEach(function (x) { chips.appendChild(E('span', 'as-chip2' + (x.tone ? ' as-tone-' + x.tone : ''), x.text)); });
      if (c.cite) chips.appendChild(E('span', 'as-cite', c.cite));
      if (c.check) chips.appendChild(E('span', 'as-check', CHECK_WORD[c.check] || 'Check'));
      if (c.citeBad && c.citeBad.length) {
        var fl = E('span', 'as-citeflag', 'cite?'); fl.setAttribute('title', 'The gatekeeper could not match this page cite to the rule: ' + c.citeBad.join('; ')); chips.appendChild(fl);
      }
      if (chips.firstChild) more.appendChild(chips);
      if (c.important) more.appendChild(E('p', 'as-saved', c.filed ? 'Saved to campaign history' : 'In tonight’s log; gm:after files it to history'));
      if (c.more && st.moreOpen[c.id]) {
        var det = E('div', 'as-detail'), html = moreHtml(c);
        if (html !== null) det.innerHTML = html;      /* the one place HTML is set: B68Markdown.render escapes all raw HTML, links are http(s) or relative only */
        else { det.textContent = c.more; det.className = 'as-detail as-detail-plain'; }
        more.appendChild(det);
      }
      var acts = E('div', 'as-acts');
      (c.actions || []).forEach(function (a) {
        var ab = B('as-act' + (a.primary ? ' as-act-primary' : ''), a.label, { 'data-as': 'act', 'data-id': c.id, 'data-act': a.id });
        if (a.title) ab.setAttribute('title', a.title);
        if (a.disabled) ab.disabled = true;
        acts.appendChild(ab);
      });
      if (c.more) acts.appendChild(B('as-moreb', st.moreOpen[c.id] ? 'Less ▴' : 'More ▾', { 'data-as': 'more', 'data-id': c.id, 'aria-expanded': String(!!st.moreOpen[c.id]), 'aria-label': st.moreOpen[c.id] ? 'Hide the detail' : 'Show the detail' }));
      if (canKeep(c)) acts.appendChild(c.kept ? E('span', 'as-kept', '★ Kept') : B('as-star', '☆ Keep', { 'data-as': 'keep', 'data-id': c.id, 'aria-label': 'Keep this card: file it as a Moment' }));
      if (k === 'done' && c.undone) acts.appendChild(E('span', 'as-kept', 'Undone'));
      else if (canUndo(c)) acts.appendChild(B('as-undo', 'Undo', { 'data-as': 'undo', 'data-id': c.id, 'aria-label': 'Undo this (U)' }));
      if (!c.mock) acts.appendChild(B('as-ack', c.ackLabel || 'Got it ×', { 'data-as': 'ack', 'data-id': c.id, 'aria-label': 'Dismiss this card' }));
      more.appendChild(acts);
      root.appendChild(more);
      return root;
    }
    function cardById(id) { for (var i = 0; i < st.cards.length; i++) if (st.cards[i].id === id) return st.cards[i]; return null; }
    function quietLine() { return st.listening === true && st.since ? 'Quiet. Listening since ' + st.since + '.' : 'Quiet.'; }
    function renderNow() {
      var el = q('#as-now'); if (!el) return;
      var c = st.nowId ? cardById(st.nowId) : null, key, make;
      if (c) { key = 'c|' + c.id + '|' + sigOf(c, true); make = function () { return buildCard(c, true); }; }
      else if (o.mock) { var m = mockCards()[0]; key = 'm|' + sigOf(m, true); make = function () { return buildCard(m, true); }; }
      else { key = 'q|' + quietLine(); make = function () { return E('p', 'as-quiet', quietLine()); }; }
      if (cache.nowKey === key && cache.nowEl && cache.nowEl.parentNode === el) return;
      clear(el); cache.nowEl = make(); cache.nowKey = key; el.appendChild(cache.nowEl);
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
      clear(el);
      FILTERS.forEach(function (f) {
        var b = B('as-chip', f === 'all' ? 'All ' : KIND[f].word + ' ', { 'data-as': 'chip', 'data-k': f, 'data-kind': f, 'aria-pressed': String(st.filter === f) });
        b.appendChild(E('span', 'as-chip-n', String(n[f]))); el.appendChild(b);
      });
    }
    function fixed(key, make) { return (cache.nodes[key] || (cache.nodes[key] = { el: make() })).el; }      /* a node that never changes (the empty line, the divider) is made once */
    function renderList() {
      var el = q('#as-list'); if (!el) return;
      var fid = foldedFocusId();                  /* focus goes back only if it was on a card line when the list was rewritten: a tick never takes it from a field */
      var desired = [];
      if (!st.cards.length) {
        if (o.mock) mockCards().forEach(function (c) { var key = 'mock|' + c.id; if (!cache.nodes[key]) cache.nodes[key] = { el: buildCard(c, false), sig: '' }; desired.push(cache.nodes[key].el); });
        else desired.push(fixed('~empty', function () { return E('li', 'as-empty', 'Nothing yet. Blade speaks up only when there is something worth the table’s time.'); }));
      } else {
        var items = feedOf(st.cards, st.filter);
        if (!items.length) {
          var word = KIND[st.filter] ? KIND[st.filter].word.toLowerCase() : '';
          desired.push(E('li', 'as-empty', 'No ' + word + ' cards tonight.'));
        } else {
          var cut = Date.now() - EARLIER_MS, shown = false;
          items.forEach(function (c, i) {
            var t = Date.parse(c.at);
            if (!shown && i > 0 && t && t < cut) {
              shown = true;
              desired.push(fixed('~earlier', function () { var d = E('li', 'as-earlier', 'Earlier tonight'); d.setAttribute('role', 'separator'); return d; }));
            }
            var sig = sigOf(c, false), ent = cache.nodes[c.id];
            if (!ent || ent.sig !== sig) {
              var fresh = buildCard(c, false);
              if (ent && ent.el.parentNode === el) el.replaceChild(fresh, ent.el);
              ent = cache.nodes[c.id] = { el: fresh, sig: sig };
            }
            desired.push(ent.el);
          });
        }
      }
      /* settle the list on the wanted nodes in order, moving or removing only what differs */
      var cur = el.firstChild;
      desired.forEach(function (n) { if (n === cur) cur = cur.nextSibling; else el.insertBefore(n, cur); });
      while (cur) { var nx = cur.nextSibling; el.removeChild(cur); cur = nx; }
      /* forget the nodes and the rendered Markdown of cards that are gone */
      var live = {}; st.cards.forEach(function (c) { live[c.id] = 1; });
      Object.keys(cache.nodes).forEach(function (k) { if (k.charAt(0) !== '~' && k.indexOf('mock|') !== 0 && !live[k]) delete cache.nodes[k]; });
      Object.keys(cache.more).forEach(function (k) { if (!live[k]) delete cache.more[k]; });
      [undoFns, actFns, ackFns, figFns].forEach(function (m) { Object.keys(m).forEach(function (k) { if (!live[k]) delete m[k]; }); });
      if (fid) refocus(fid);
    }
    function renderUpdates() {
      var el = q('#as-updates'), tn = q('#as-tools-n'); if (!el) return;
      if (tn) { tn.hidden = !st.updates.length; tn.textContent = st.updates.length ? st.updates.length + ' ledger' : ''; }
      clear(el);
      if (!st.updates.length) return;
      /* no stress / harm / xp state exists to write to on this page, so an update is read-only: Done dismisses it, and Note it files
         its text in the capture bar (when the page gave us one) */
      el.appendChild(E('p', 'as-lab', 'Ledger: for you to apply'));
      var ul = E('ul', 'as-ups');
      st.updates.slice().reverse().forEach(function (u) {
        var li = E('li', 'as-up'), tx = E('span', 'as-uptext');
        if (u.key) { tx.appendChild(E('small', null, u.key)); tx.appendChild(doc.createTextNode(' ')); }
        tx.appendChild(doc.createTextNode(u.text));
        var bt = E('span', 'as-upbtns');
        if (typeof o.onNote === 'function') bt.appendChild(B(null, 'Note it', { 'data-as': 'note', 'data-id': u.id }));
        bt.appendChild(B(null, 'Done', { 'data-as': 'done', 'data-id': u.id }));
        li.appendChild(tx); li.appendChild(bt); ul.appendChild(li);
      });
      el.appendChild(ul);
    }
    function renderFit() {
      var go = q('#as-go'), out = q('#as-fitout'); if (!go || !out) return;
      go.disabled = st.fit.busy; go.textContent = st.fit.busy ? 'Fitting…' : 'Fit it';
      clear(out);
      if (st.fit.error) { var er = E('p', 'as-status bad', st.fit.error); er.setAttribute('role', 'alert'); out.appendChild(er); }
      var c = st.fit.card;
      if (c) {
        var box = E('div', 'as-fitcard'); box.appendChild(E('p', 'as-fitread', str(c.read)));
        var ol = E('ol', 'as-lines');
        fitLines(c).forEach(function (l) { var li = E('li'); li.appendChild(E('b', null, l.label)); li.appendChild(E('span', null, l.text)); ol.appendChild(li); });
        box.appendChild(ol); box.appendChild(B('as-link', 'Clear', { 'data-as': 'fitclear' }));
        out.appendChild(box);
      }
    }

    /* ---------- Ask Blade ---------- */
    function canAsk() {
      if (gone || isPhone() || st.paused === 'setup' || st.paused === 'cap' || !gm || typeof gm.assistAsk !== 'function') return false;
      return askAllowed(tierNow());
    }
    function renderAsk() {
      var sec = q('#as-ask'), go = q('#as-ask-go'); if (!sec || !go) return;
      sec.hidden = !gm || typeof gm.assistAsk !== 'function';      /* an older runtime without the call: the field is not offered */
      var can = canAsk(), busy = st.ask.busy, hint = !can && !askAllowed(tierNow()) ? 'Dropped by the budget for tonight.' : '';
      go.disabled = busy || !can; go.textContent = busy ? 'Thinking…' : 'Ask';
      var pr = q('#as-prog'); if (pr) pr.hidden = !busy;
      go.title = can ? 'Ask Blade (Enter)' : hint || 'Not available now';
      var m = q('#as-ask-status'), msg = st.ask.error || hint; if (m) { m.textContent = msg; m.hidden = !msg; m.classList.toggle('bad', !!st.ask.error); }
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
        /* the answer is a card in the feed, open (it was asked for, so it is not gated and not unread); it is not put in Now, which would drop it after 1.5 s */
        var at = str(a.at) || new Date().toISOString(), item = mkCard(Object.assign({}, a, { at: at, q: str(a.q) || qq }), 'ask', { id: askCardId(at, str(a.q) || qq), seen: true });
        if (!cardById(item.id)) { st.cards.push(item); st.unfolded[item.id] = true; trimAsks(st); if (st.filter !== 'all' && st.filter !== item.kind) st.filter = 'all'; scrollFeedTop = true; }
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
    /* the strip: only a rule or a warn card slides a one-line strip out of the closed tab (8 s). It shows the kind's word and the headline, as text:
       never the bullets, SAY or GM ONLY. Every other kind only adds a pip. */
    function showBanner(card) {
      if (!host || st.open || isPhone() || STRIP_KINDS.indexOf(cardKind2(card)) < 0) return;
      var b = q('#as-banner'), bb = q('.as-banner-b'); if (!b || !bb) return;
      bannerCard = card;
      var k = cardKind2(card);
      clear(bb); bb.setAttribute('data-kind', k);
      bb.appendChild(E('b', 'as-banner-k', KIND[k].glyph + ' ' + KIND[k].word));
      bb.appendChild(doc.createTextNode(' ' + clip(card.headline, 120)));
      b.hidden = false;
      if (bannerT && clrT) clrT(bannerT);
      if (setT) bannerT = setT(hideBanner, bannerMs);
    }
    function hideBanner() { var b = q('#as-banner'); if (b) b.hidden = true; bannerT = null; bannerCard = null; }

    /* ---------- the box ---------- */
    /* Now: the newest unread card, shown open. It leaves Now (and is marked seen) after 1.5 s with the panel open, or at once when a newer card
       takes its place. Closing the panel first leaves it unread, so it is Now again next time. */
    function setNow(id, alsoSeen) {
      if (nowT && clrT) clrT(nowT);
      nowT = null;
      var prev = st.nowId && st.nowId !== id ? cardById(st.nowId) : null;
      markSeenMany((alsoSeen || []).concat(prev ? [prev] : []));      /* the cards that are in the feed, and the one Now has just given up */
      st.nowId = id || '';
      if (id && setT) nowT = setT(function () {
        nowT = null; var c = cardById(st.nowId); st.nowId = ''; markSeenOne(c); if (host) render();
      }, NOW_MS);
    }
    function dropNow() { if (nowT && clrT) clrT(nowT); nowT = null; st.nowId = ''; }
    function open() {
      if (gone) return;
      st.open = true; hideBanner();
      var un = st.cards.filter(function (c) { return !c.seen; });
      /* the older unread cards are in the feed, in view (one mark); the newest one is Now and is marked when it has been there 1.5 s */
      setNow(un.length ? un[un.length - 1].id : '', un.slice(0, -1));
      render(); relayout();
      var nm = q('#as-name'); if (nm) { try { nm.focus(); } catch (e) {} }
    }
    function close() {
      if (!st.open) return;
      var had = host && doc && host.contains(doc.activeElement);
      st.open = false; dropNow(); render(); relayout();
      if (had) { var lb = q('#as-launch'); if (lb) { try { lb.focus(); } catch (e) {} } }
    }
    /* a warn that has just arrived is spoken at once (an assertive live region outside the panel: a closed panel is visibility:hidden, and that is when a warn matters) */
    function alertWarn(fresh) {
      var al = q('#as-alert'); if (!al) return;
      var w = fresh.filter(function (c) { return cardKind2(c) === 'warn'; });
      if (!w.length) return;
      if (st.open && active()) return;       /* the open, visible panel shows it in Now and the feed: speaking it a third time is noise */
      al.textContent = '';
      al.textContent = 'Warning: ' + w.map(function (c) { return c.headline; }).join('. ');
    }
    /* cards that have just arrived (a tick, or the page): open, the newest takes Now; closed, a rule or warn pops the strip and the rest are pips */
    function arrived(fresh) {
      if (!fresh.length) return;
      alertWarn(fresh);
      if (st.open) setNow(fresh[fresh.length - 1].id, fresh.slice(0, -1));
      else {
        var strip = fresh.filter(function (c) { return STRIP_KINDS.indexOf(cardKind2(c)) >= 0; });
        if (strip.length) showBanner(strip[strip.length - 1]);
      }
    }
    /* U: undo the newest done card that can be undone. Resolves { id } when it was, { error } when the undo failed, null when there is nothing to undo. */
    function undoCard(c) {
      if (!c || !canUndo(c)) return Promise.resolve(null);
      var fn = undoFns[c.id];
      return Promise.resolve().then(fn).then(function () { c.undone = true; if (host) render(); return { id: c.id }; }, function () { return { error: 'undo' }; });
    }
    function undoNewest() {
      for (var i = st.cards.length - 1; i >= 0; i--) if (canUndo(st.cards[i])) return undoCard(st.cards[i]);
      return Promise.resolve(null);
    }
    /* cards made on this page (the co-GM, autopilot, warnings): addCard({ id?, kind, headline, bullets?, say?, secret?, more?, cite?, check?, seat?, at?, undo? }) -> id | ''.
       They are not in the server's log: no mark is sent, and a reload forgets them. undo is a function the Undo button calls. */
    var pageSeq = 0;
    /* the functions behind a page card's buttons: actions[i].run, onAck (the Got-it button's own work, run after the card is gone) and figure (a factory for a node) */
    function setFns(id, raw) {
      if (Array.isArray(raw.actions)) { var m = {}; raw.actions.forEach(function (a) { if (isObj(a) && typeof a.run === 'function') m[clip(a.id, 24)] = a.run; }); actFns[id] = m; }
      if (raw.onAck !== undefined) { if (typeof raw.onAck === 'function') ackFns[id] = raw.onAck; else delete ackFns[id]; }
      if (raw.figure !== undefined) { if (typeof raw.figure === 'function') figFns[id] = raw.figure; else delete figFns[id]; }
    }
    /* a card made on this page, gone: no mark is sent and onAck is not called (the page took it down itself) */
    function removeCard(id) {
      var c = cardById(id); if (!c) return false;
      remove(st.cards, id); delete st.unfolded[id]; delete st.moreOpen[id]; if (st.nowId === id) setNow('');
      if (host) render();
      return true;
    }
    function addCard(raw) {
      if (gone || !isObj(raw)) return '';
      var id = str(raw.id).replace(/\s+/g, ' ').trim().slice(0, 80);
      if (!str(raw.headline).trim() && !str(raw.text).trim()) return '';
      var nowIso = new Date().toISOString();
      var card = mkCard(Object.assign({}, raw, { text: str(raw.headline).trim() || str(raw.text) }), 'page', { id: id || 'p|' + (++pageSeq) + '|' + Date.now(), nowIso: nowIso });
      var old = cardById(card.id);
      if (old) { card.seen = old.seen; card.kept = old.kept; st.cards[st.cards.indexOf(old)] = card; }
      else st.cards.push(card);
      if (typeof raw.undo === 'function') undoFns[card.id] = raw.undo;
      setFns(card.id, raw);
      if (card.open) st.unfolded[card.id] = true;
      if (st.cards.length > MAX_CARDS) st.cards = st.cards.slice(-MAX_CARDS);
      if (!old) arrived([card]);
      if (host) render();
      return card.id;
    }
    var PATCH_KEYS = ['kind', 'headline', 'bullets', 'say', 'secret', 'more', 'cite', 'check', 'body', 'bodyLabel', 'chips', 'actions', 'ackLabel', 'figKey'];
    function updateCard(id, patch) {
      var c = cardById(id); if (!c || !isObj(patch)) return false;
      var raw = {}; PATCH_KEYS.forEach(function (k) { raw[k] = patch[k] !== undefined ? patch[k] : c[k]; });
      raw.text = c.src === 'page' ? raw.headline : c.text; raw.seat = c.seat; raw.at = c.at; raw.q = c.q; raw.detail = c.detail;
      var n = mkCard(raw, c.src, { id: c.id });
      PATCH_KEYS.forEach(function (k) { c[k] = n[k]; });
      if (c.src === 'page') c.text = n.text;
      if (patch.undone !== undefined) c.undone = !!patch.undone;
      if (typeof patch.undo === 'function') undoFns[c.id] = patch.undo;
      setFns(c.id, patch);
      if (host) render();
      return true;
    }
    function togglePin() {
      if (!dockable() || isPhone()) return;
      st.pinned = !st.pinned;
      if (st.pinned && !st.open) { open(); return; }
      render(); relayout();
    }
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
        arrived(fresh);
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
      if (active() && st.paused && host) render();           /* paused (the cap, busy, setup) makes no call, but the header's clock still moves: a green dot greys at 10 minutes */
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
      else if (a === 'more') { st.moreOpen[id] = !st.moreOpen[id]; render(); }
      else if (a === 'undo') { undoCard(cardById(id)); }
      else if (a === 'act') { var af = (actFns[id] || {})[b.getAttribute('data-act')]; if (typeof af === 'function') { try { Promise.resolve(af()).then(null, function () {}); } catch (e) {} } }
      else if (a === 'chip') { st.filter = FILTERS.indexOf(b.getAttribute('data-k')) >= 0 ? b.getAttribute('data-k') : 'all'; render(); var cb = q('.as-chip[data-k="' + st.filter + '"]'); if (cb && cb.focus) { try { cb.focus(); } catch (e) {} } }
      else if (a === 'ack') { var k = cardById(id), ackFn = ackFns[id]; if (k) mark('dismiss', [k]); remove(st.cards, id); delete st.unfolded[id]; delete st.moreOpen[id]; if (st.nowId === id) setNow(''); render(); if (k && k.src === 'page' && typeof ackFn === 'function') { try { ackFn(); } catch (e) {} } }
      else if (a === 'keep') { var kc = cardById(id); if (kc && !kc.kept && typeof o.onNote === 'function' && o.onNote(kc.src === 'ask' ? askMoment(kc) : momentText(kc))) { kc.kept = true; mark('keep', [kc]); render(); } }
      else if (a === 'done') { var d = st.updates.filter(function (x) { return x.id === id; })[0]; if (d) mark('dismiss', [d]); remove(st.updates, id); render(); }
      else if (a === 'note') { var u = st.updates.filter(function (x) { return x.id === id; })[0]; if (u && typeof o.onNote === 'function' && o.onNote(u.text)) { mark('dismiss', [u]); remove(st.updates, id); render(); } }
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

    /* The co-GM switch (C2; app/gm/cogm.js and gm-page.js mountCogm do the work). A button in the header, between the name and Pin, made when the page asks for it: a page
       without a co-GM has no switch. It is OFF when it is made and the panel keeps no memory of it (nothing is stored in the browser), so every load starts off. The page
       decides what a tap means (it checks that Listening is on before it says yes) and calls set() with the answer. box() tells the page whether the box is on: the
       header state (Listening, Paused, Off, Not set up, Waiting) and the last Listening answer, so the page can switch itself off when the box goes off. */
    var cogmSw = null;
    function cogmSwitch(opts) {
      if (gone || !host || !isObj(opts) || typeof opts.onChange !== 'function') return null;
      if (cogmSw) cogmSw.destroy();
      var pin = q('#as-pin'), row = pin && pin.parentNode; if (!row) return null;
      var btn = B('as-cogm', null, { id: 'as-cogm', 'aria-pressed': 'false' }), on = false;
      function paint(note) {
        btn.textContent = 'Co-GM ' + (on ? 'on' : 'off');
        btn.setAttribute('aria-pressed', String(on));
        btn.setAttribute('title', note || (on ? 'Blade acts on what you say aloud: it makes clocks, ticks them and files names, each with Undo' : 'Off. Turn it on to let Blade act on what you say aloud (Listening must be on)'));
      }
      btn.addEventListener('click', function () { opts.onChange(!on); });
      row.insertBefore(btn, pin); paint();
      cogmSw = {
        set: function (v, note) { on = !!v; paint(note); },
        isOn: function () { return on; },
        box: function () { var s = stateOf({ paused: st.paused, setup: st.setup, spend: st.spend, listening: st.listening }); return { key: s.key, listening: st.listening, tier: st.spend ? st.spend.tier : '' }; },
        destroy: function () { if (btn.parentNode) btn.parentNode.removeChild(btn); cogmSw = null; }
      };
      return cogmSw;
    }

    build();
    var ready = load();
    if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', onVis);
    if (setI && !o.noTimer) timer = setI(poll, o.interval || POLL_MS);
    if (!o.noTimer) setTimeout(function () { poll(); }, 1500);

    return {
      ready: ready, open: open, close: close, toggle: toggle, isOpen: function () { return st.open; }, pin: togglePin, isPinned: function () { return docked(); }, undoNewest: undoNewest, addCard: addCard, updateCard: updateCard, removeCard: removeCard, relayout: relayout, poll: poll, rolled: rolled, resume: resume, fit: fit, canFit: canFit, autoFit: autoFit, canAnother: canAnother, another: another, canScreen: canScreen, screenMake: screenMake, ask: ask, canAsk: canAsk,
      state: function () { return JSON.parse(JSON.stringify({ open: st.open, cards: st.cards, updates: st.updates, asks: st.cards.filter(function (c) { return c.src === 'ask'; }), ask: st.ask, nowId: st.nowId, renders: { cards: cache.builds, more: cache.moreRenders }, after: st.after, spend: st.spend, paused: st.paused, error: st.error, listening: st.listening, unread: unread(), fit: st.fit, screen: st.screen, banner: bannerCard ? bannerCard.headline : '' })); },
      el: function () { return host; },
      cogmSwitch: cogmSwitch,
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
