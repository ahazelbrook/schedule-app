/* B68GmCogm — the co-GM's page side (design 5.2 and 5.5; functions/_lib/assist/hands.js is the server side). Pure code: no DOM, no clock of its own, no network.
   The page (gm-page.js, mountCogm) feeds it transcript lines and the table's live state and does every write; this module decides WHAT to ask and WHAT to write.

   Hearing it (5.2): a cheap pattern pre-filter over each new transcript line, a window of the matching line plus two either side (or about 30 s), a read
   cursor that moves as lines are read and a "handled" cursor that moves only when the server has answered (a 429, a timeout or a 5xx leaves the window to be sent again).
   Trusting it: the answer's action keys are the server's (hands.js actionKey) and are used exactly as given, never worked out again here. The set of keys
   seen tonight is what makes a window that is sent twice apply once. An 'offer' key is in the set too, so a dismissed offer does not come back.
   Doing it (5.5): planApply turns an action into a write (clock_add, clock_tick, npc_add, capture), an offer (yellow card, Do it) or a drop, checking the
   action against the LIVE table at apply time; planUndo is a compare-and-swap: it only puts things back if the object is still as this module left it.
   Secrecy: a clock the co-GM makes is hidden from the players, an NPC is revealed:false, and nothing here touches a player's sheet or the display.

   API (every function is also on B68GmCogm._pure)
     match(text) -> [intent]            'clock' | 'tick' | 'name' | 'pool' | 'bargain'; [] for chatter
     newState() / start(st, last)       the state; start at the newest seq so old talk is never replayed
     ingest(st, lines, last, now)       add transcript rows (marks are skipped), note matches; moves the READ cursor to `last`
     nextWindow(st, now) -> { from, to, seqs } | null    the oldest match that has settled (two lines after it, or TIMING.settle ms); null before notBefore
     windowSent(st, win, now) / windowFailed(st, win, now, busy) -> 'retry' | 'dropped'    the HANDLED cursor moves only on windowSent
     seen(st, key) / mark(st, key, how)   the keys of tonight
     buildState(live, onStage) -> the state body POST /assist/act takes, trimmed so the server cannot 400 it
     planApply(action, live, ctx, opts) -> { op: 'do' | 'offer' | 'drop', ... }
     planUndo(rec, live, force) -> { ok: true, write? } | { ok: false, why, ... }
     headline / heard                   the card's words (model text goes in as text, with * made harmless)

   The cue lane (C4d; design "the cue and the phones" 1.3 to 1.5). A line holding "Blade, ..." is found by B68Cue.find as it is ingested (pass `live` as ingest's 5th
   argument) and kept OUT of the uncued windows. cueNext(st, now, live) -> the next job, or null while there is nothing to do or the call has to wait:
     { kind: 'post' | 'stale' | 'card', cue, from, to, cueLineId, parsed (the actions, or null for the model path), res (B68Cue.parse's answer), quote, joined }
   It parses at once against `live`. A cut-off or incomplete command (missing more, name, text, amount or size, or a bare "Blade") waits for ONE more line (TIMING.cueWait),
   joins it whatever its speaker label (B68Cue.joinLines) and parses again. Still cut off after that -> the model path (parsed: null) for 'more'; a card for the rest.
   missing which / clock and every refusal are a card with no call. Cue lines skip the settling and the 8 s gap; at most one cue call every TIMING.cueGap. A cue older
   than TIMING.cueStale (a hidden page coming back) is kind 'stale': a yellow card that acts only when tapped. The page never makes a key: the Worker does. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmCogm = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var P = {};
  /* the page reads these when it runs, so a check can make them short */
  var TIMING = P.TIMING = { poll: 2000, gap: 8000, settle: 6000, span: 30000, giveUpAfter: 3, cueWait: 6000, cueGap: 2000, cueStale: 60000, cueAnswer: 10000, sttEvery: 15 };
  /* B68Cue (app/cue.js): the browser has it from the bundle (cue.js is listed before this file); Node requires it. Looked up when used, so a missing one only switches the lane off. */
  function cueMod() {
    if (typeof root !== 'undefined' && root && root.B68Cue) return root.B68Cue;
    try { return typeof require === 'function' ? require('../cue.js') : null; } catch (e) { return null; }
  }
  var BUF_MAX = 80, WIN_LINES = 30, WIN_SEQS = 200, SIDE = 2;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  /* what two names are compared as: lowercase, accents and punctuation gone (hands.js normalise, the same rule) */
  function norm(s) { return str(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
  P.norm = norm;
  /* model text goes into a card headline, and a headline reads *bold* and **italic**: an asterisk in a name is made a different character */
  function plain(s, n) { return str(s).replace(/\s+/g, ' ').trim().replace(/\*/g, '∗').slice(0, n || 200); }
  P.plain = plain;

  /* ---------- 1. hearing it: the pre-filter (design 5.2) ----------
     Case-insensitive, and loose about what a speech-to-text engine hears ("tic that", "sick segment", "to" for two). It is allowed to over-match: the seat
     decides, and a miss costs more than a call. The one case-sensitive pattern is a capitalised word after "tick". */
  var NUM = '(?:\\d{1,2}|one|won|two|to|too|three|four|for|five|six|sick|seven|eight|ate|nine|ten|eleven|twelve)';
  var PATTERNS = P.PATTERNS = [
    { intent: 'clock', re: new RegExp('\\b' + NUM + '[\\s-]*(?:segments?|ticks?|parts?|pieces?|slices?)\\b', 'i') },
    { intent: 'clock', re: /\bclocks?\b/i },
    { intent: 'tick', re: /\b(?:tick|ticks|ticked|ticking|tic|tik)\s+(?:that|it|the|this|one|two|three|once|twice|them|off|up)\b/i },
    { intent: 'tick', re: /\b[Tt]ick(?:s|ed)?\s+[A-Z]/ },
    { intent: 'tick', re: /\b(?:mark|marks|marked|marking)\s+(?:one|two|three|four|1|2|3|the|it|that|this|a\s+(?:tick|segment))\b/i },
    { intent: 'tick', re: /\b(?:fill|fills|filled)\s+(?:up\s+)?(?:one|two|three|in|it|that|this|a|another)\b/i },
    { intent: 'tick', re: /\b(?:advance|advances|advanced)\s+(?:that|the|it)\b/i },
    { intent: 'name', re: /\b(?:his|her|their|its)\s+name(?:'s|’s|s|\s+is|\s+was)\b/i },
    { intent: 'name', re: /\b(?:he|she|they|it)(?:'s|’s|s|\s+is)\s+(?:called|named|known\s+as)\b/i },
    { intent: 'name', re: /\b(?:called|named|goes\s+by|name(?:'s|’s|\s+is))\s+[A-Z]/i },       /* case-insensitive: a transcript can be all lowercase, so any word after "called" matches (the seat decides) */
    { intent: 'pool', re: new RegExp('\\b(?:level|lvl|lv)\\s*' + NUM + '\\s+harm\\b', 'i') },
    { intent: 'pool', re: new RegExp('\\b(?:take|takes|taking|took|mark|marks|marked|suffer|suffers|gain|gains|gets?|adds?)\\s+' + NUM + '\\s+(?:stress|harm|heat|coin|xp|trauma|rep)\\b', 'i') },
    { intent: 'pool', re: new RegExp('\\b(?:plus\\s+)?' + NUM + '\\s+(?:(?:more|extra|points?\\s+of|levels?(?:\\s+of)?)\\s+)?(?:stress|heat)\\b', 'i') },
    { intent: 'pool', re: new RegExp('\\bplus\\s+' + NUM + '\\s+(?:(?:more|extra)\\s+)?(?:harm|coin)\\b', 'i') },
    { intent: 'bargain', re: /\bdevil'?s?\s+bargain/i },
    { intent: 'bargain', re: /\bflash[\s-]?backs?\b/i }
  ];
  function match(text) {
    var s = str(text), out = [];
    if (!s) return out;
    PATTERNS.forEach(function (p) { if (out.indexOf(p.intent) < 0 && p.re.test(s)) out.push(p.intent); });
    return out;
  }
  P.match = match;

  /* ---------- 2. the window, the cursors, the keys ---------- */
  function newState() { return { buf: [], pending: [], readAfter: 0, handled: 0, notBefore: 0, keys: {}, tries: {}, cues: [], cueNotBefore: 0 }; }
  P.newState = newState;
  /* start at the newest seq: the talk before co-GM was switched on is not replayed */
  function start(st, last) { var n = Math.max(0, Math.floor(+last) || 0); st.readAfter = n; st.handled = n; st.buf = []; st.pending = []; st.cues = []; st.cueNotBefore = 0; return st; }
  P.start = start;
  /* the uncued switch came on: what was said while it was off is not sent */
  function catchUp(st) { st.handled = st.readAfter; st.pending = []; return st; }
  P.catchUp = catchUp;

  /* rows from GET /gm/transcript?after=: lines are kept (marks are not talk), a line that matches is noted as pending; the read cursor follows `last`
     and the highest seq seen, so the next read asks for what came after. */
  function ingest(st, rows, last, now, live) {
    var top = st.readAfter, Cue = isObj(live) ? cueMod() : null;
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
      if (!isObj(r) || !Number.isInteger(r.seq)) return;
      if (r.seq > top) top = r.seq;
      if (r.kind !== 'line' || r.seq <= st.readAfter || !str(r.text).trim()) return;
      if (st.buf.length && st.buf[st.buf.length - 1].seq >= r.seq) return;
      st.buf.push({ seq: r.seq, id: str(r.id), at: str(r.at), text: str(r.text), speaker: typeof r.speaker === 'number' ? r.speaker : null });
      if (Cue && Cue.find(str(r.text), live)) { st.cues.push({ seq: r.seq, id: str(r.id), at: str(r.at), text: str(r.text), seenAt: now }); return; }      /* a cue is the cue lane's, never an uncued window's */
      if (r.seq > st.handled) { var m = match(r.text); if (m.length) st.pending.push({ seq: r.seq, intents: m, seenAt: now }); }
    });
    /* `last` is the newest seq the server holds. It is used only when this read came back empty: a full page (the server gives at most 500) must be read on, not skipped past */
    if (Number.isInteger(last) && last > top && !(Array.isArray(rows) && rows.length)) top = last;
    st.readAfter = top;
    if (st.buf.length > BUF_MAX) st.buf = st.buf.slice(st.buf.length - BUF_MAX);
    var lo = st.buf.length ? st.buf[0].seq : Infinity;
    st.pending = st.pending.filter(function (p) { return p.seq > st.handled && p.seq >= lo; });
    return st;
  }
  P.ingest = ingest;

  function indexOfSeq(buf, seq) { for (var i = 0; i < buf.length; i++) if (buf[i].seq === seq) return i; return -1; }
  /* the matching line plus two either side, widened to about 30 s of talk, at most 30 lines and 200 seqs (the Worker's limits are 40 lines and 200) */
  function windowAt(buf, idx) {
    var lo = Math.max(0, idx - SIDE), hi = Math.min(buf.length - 1, idx + SIDE), t = Date.parse(buf[idx].at), half = TIMING.span / 2;
    if (isFinite(t)) {
      while (lo > 0 && isFinite(Date.parse(buf[lo - 1].at)) && t - Date.parse(buf[lo - 1].at) <= half) lo--;
      while (hi < buf.length - 1 && isFinite(Date.parse(buf[hi + 1].at)) && Date.parse(buf[hi + 1].at) - t <= half) hi++;
    }
    while (hi - lo + 1 > WIN_LINES || buf[hi].seq - buf[lo].seq > WIN_SEQS) { if (idx - lo > hi - idx) lo++; else hi--; }
    return { lo: lo, hi: hi };
  }
  /* the oldest pending match that has settled: two lines after it, or TIMING.settle ms since it was noticed. null while the gap since the last call is not over. */
  function nextWindow(st, now) {
    if (now < st.notBefore) return null;
    for (var i = 0; i < st.pending.length; i++) {
      var p = st.pending[i], idx = indexOfSeq(st.buf, p.seq);
      if (idx < 0) continue;
      if (st.buf.length - 1 - idx < SIDE && now - p.seenAt < TIMING.settle) return null;       /* the oldest is not ready: the later ones wait behind it */
      var w = windowAt(st.buf, idx), from = st.buf[w.lo].seq, to = st.buf[w.hi].seq;
      return { from: from, to: to, seqs: st.pending.filter(function (q) { return q.seq >= from && q.seq <= to; }).map(function (q) { return q.seq; }) };
    }
    return null;
  }
  P.nextWindow = nextWindow;
  function winId(w) { return w.from + '-' + w.to; }
  /* the Worker answered (200): the handled cursor moves, and the next call waits TIMING.gap */
  function windowSent(st, w, now) {
    if (w.to > st.handled) st.handled = w.to;
    st.pending = st.pending.filter(function (p) { return p.seq > w.to; });
    delete st.tries[winId(w)];
    st.notBefore = now + TIMING.gap;
  }
  P.windowSent = windowSent;
  /* it did not get through. The cursor does NOT move: a busy answer (429) retries after the gap, any other failure retries too but is given up on after
     TIMING.giveUpAfter tries so one bad window cannot hold the line for the night. -> 'retry' | 'dropped' */
  function windowFailed(st, w, now, busy) {
    var id = winId(w), n = busy ? 0 : (st.tries[id] || 0) + 1;
    st.notBefore = now + TIMING.gap;
    if (!busy) st.tries[id] = n;
    if (!busy && n >= TIMING.giveUpAfter) { windowSent(st, w, now); return 'dropped'; }
    return 'retry';
  }
  P.windowFailed = windowFailed;

  /* ---------- 2b. the cue lane (C4d) ---------- */
  var WAITS = { more: 1, name: 1, text: 1, amount: 1, size: 1 };       /* what one more line can fix; 'which' and 'clock' it cannot */
  function lineAfter(st, seq) { for (var i = 0; i < st.buf.length; i++) if (st.buf[i].seq > seq) return st.buf[i]; return null; }
  function cueAge(c, now) { var t = Date.parse(c.at); return now - (isFinite(t) ? t : c.seenAt); }
  function cueNext(st, now, live) {
    var Cue = cueMod();
    if (!Cue || !st.cues.length) return null;
    var c = st.cues[0], text = c.text, to = c.seq, joined = false, res = Cue.parse(text, live), waiting = res.pending || (res.missing && WAITS[res.missing]);
    if (waiting) {
      var nx = lineAfter(st, c.seq);
      if (nx && !Cue.find(nx.text, live)) { text = Cue.joinLines(c.text, nx.text); to = nx.seq; joined = true; res = Cue.parse(text, live); }
      else if (!nx && now - c.seenAt < TIMING.cueWait) return null;                    /* the next line may still be on its way: longer than the iPad's tail */
    }
    var job = { kind: 'card', cue: c, from: c.seq, to: to, cueLineId: c.id, parsed: null, res: res, quote: res.quote, joined: joined };
    if (res.refused) { st.cues.shift(); return job; }
    if (res.pending) { st.cues.shift(); job.res = Object.assign({}, res, { refused: 'unparsed' }); return job; }
    if (res.missing && res.missing !== 'more') { st.cues.shift(); return job; }
    if (!res.missing && !res.actions.length) { st.cues.shift(); job.res = Object.assign({}, res, { refused: 'unparsed' }); return job; }
    if (res.missing === 'more') job.parsed = null; else job.parsed = res.actions;
    job.kind = cueAge(c, now) > TIMING.cueStale ? 'stale' : 'post';
    if (job.kind === 'post') { if (now < st.cueNotBefore) return null; st.cueNotBefore = now + TIMING.cueGap; }
    st.cues.shift();
    return job;
  }
  P.cueNext = cueNext;

  function seen(st, key) { return typeof key === 'string' && Object.prototype.hasOwnProperty.call(st.keys, key); }
  function mark(st, key, how) { if (typeof key === 'string' && key) st.keys[key] = how || 'applied'; }
  P.seen = seen; P.mark = mark;

  /* ---------- 3. the state the Worker is sent (hands.js cleanState): trimmed so that one odd item cannot make the whole call a 400 ---------- */
  var STATE_BYTES = 8 * 1024, CLOCKS_MAX = 40, NPCS_MAX = 100, PCS_MAX = 12;
  function clipName(s) { return str(s).replace(/\s+/g, ' ').trim().slice(0, 80); }
  function utf8(s) { var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? (i++, 4) : 3; } return n; }
  function buildState(live, onStage) {
    live = isObj(live) ? live : {};
    var clocks = (Array.isArray(live.clocks) ? live.clocks : []).filter(function (c) { return isObj(c) && str(c.id) && str(c.id).length <= 64 && clipName(c.name); }).slice(0, CLOCKS_MAX).map(function (c) {
      var size = Math.max(1, Math.min(12, Math.floor(+c.size) || 4)), filled = Math.max(0, Math.min(size, Math.floor(+c.filled) || 0));
      return { id: str(c.id), name: clipName(c.name), size: size, filled: filled, hidden: c.hidden === true };
    });
    /* an NPC the co-GM made and the GM then undid is not "known": the name can be added again */
    var npcs = (Array.isArray(live.npcs) ? live.npcs : []).filter(function (n) { return isObj(n) && clipName(n.name) && !(Array.isArray(n.tags) && n.tags.indexOf('undone') >= 0); })
      .slice(0, NPCS_MAX).map(function (n) { return { id: str(n.id).slice(0, 64) || 'npc', name: clipName(n.name) }; });
    var pcs = (Array.isArray(live.pcs) ? live.pcs : []).filter(function (n) { return isObj(n) && clipName(n.name); }).slice(0, PCS_MAX).map(function (n) { return { id: str(n.id).slice(0, 64) || 'pc', name: clipName(n.name) }; });
    var out = { clocks: clocks, npcs: npcs, pcs: pcs, onStage: clipName(onStage) };
    while (utf8(JSON.stringify(out)) > STATE_BYTES && (out.npcs.length || out.clocks.length)) { if (out.npcs.length > 10) out.npcs.length = Math.max(10, out.npcs.length - 10); else if (out.clocks.length > 10) out.clocks.length -= 5; else if (out.npcs.length) out.npcs.pop(); else out.clocks.pop(); }
    return out;
  }
  P.buildState = buildState;

  /* ---------- 4. doing it (design 5.5): the apply planner ----------
     action: one of the answer's actions, as given. live: { clocks: [{ id, name, size, filled, hidden }], mineClocks: [name] (clocks this page just made, which the
     table's snapshot may not show yet), npcs: [{ id, name, tags }], pcs: [{ name }], ipadClocks: bool (the iPad is following the table's clocks) }.
     ctx: { id } a new id the page made for a new clock or NPC. opts.confirmed: the GM tapped Do it, so the judgement calls (a clock with the same name, a
     changed fill, the iPad following) are theirs; the checks that protect other things (a clock that is gone, a name already in the cast) still stand.
     -> { op: 'drop', why } | { op: 'offer', why, ...the 'do' plan } | { op: 'do', type, ... }. */
  var BUCKET = { name: 'n', loose_end: 'x', moment: 'm' };
  function clockByName(live, name) {
    var n = norm(name), hit = null;
    (live.clocks || []).forEach(function (c) { if (!hit && norm(c.name) === n) hit = c; });
    return hit;
  }
  function planApply(action, live, ctx, opts) {
    live = isObj(live) ? live : {}; ctx = ctx || {}; opts = opts || {};
    var confirmed = opts.confirmed === true, plan, why = '';
    if (!isObj(action)) return { op: 'drop', why: 'not an action' };
    if (action.mode === 'seen') return { op: 'drop', why: 'seen' };      // the server has handed this key to another page or an earlier window (C4c): never write it twice
    if (action.type === 'undo' || action.type === 'rename') return { op: 'page', type: action.type };      // a cue's own: the page carries them out, there is nothing to write from a plan
    if (action.type === 'clock_add') {
      var name = clipName(action.name);
      if (!name || !ctx.id) return { op: 'drop', why: 'no name' };
      if (!confirmed && (clockByName(live, name) || (live.mineClocks || []).some(function (m) { return norm(m) === norm(name); }))) why = 'A clock called “' + name + '” is already on the table';
      var fill = Math.max(0, Math.min(Math.floor(+action.size) || 0, Math.floor(+action.filled) || 0));      /* "and mark two" (a cue's clock_add carries filled) */
      plan = { op: 'do', type: 'clock_add', id: ctx.id, clock: { id: ctx.id, name: name, size: action.size, filled: fill, kind: 'danger', hidden: true } };
    } else if (action.type === 'clock_tick') {
      var c = (live.clocks || []).filter(function (x) { return x.id === action.clock_id; })[0];
      if (!c) return { op: 'drop', why: 'that clock is gone' };
      var size = Math.max(1, Math.floor(+c.size) || 1), cur = Math.max(0, Math.min(size, Math.floor(+c.filled) || 0));
      var to = confirmed || cur !== action.from_filled ? cur + Math.trunc(+action.by || 0) : action.to_filled;
      to = Math.max(0, Math.min(size, to));
      if (to === cur) return { op: 'drop', why: 'no change' };
      plan = { op: 'do', type: 'clock_tick', id: c.id, name: c.name, from: cur, to: to, size: size };
      if (!confirmed && cur !== action.from_filled) why = 'The clock has moved since it was heard: it is at ' + cur + '/' + size;
      else if (!confirmed && !c.hidden && live.ipadClocks === true) why = 'The iPad is following the clocks, and this clock is not hidden';
    } else if (action.type === 'npc_add') {
      var nm = clipName(action.name);
      if (!nm || !ctx.id) return { op: 'drop', why: 'no name' };
      var known = (live.npcs || []).concat(live.pcs || []).some(function (n) { return isObj(n) && norm(n.name) === norm(nm) && !(Array.isArray(n.tags) && n.tags.indexOf('undone') >= 0); });
      if (known) return { op: 'drop', why: 'already known', name: nm };
      plan = { op: 'do', type: 'npc_add', id: ctx.id, name: nm, rolled: action.nameRolled === true,
        doc: { name: nm, alias: '', role: str(action.role).slice(0, 80), faction: '', description: str(action.look).slice(0, 2000), spec: {}, revealed: false, firstSeen: null, tags: ['cogm'],
          gmNotes: ('Heard' + (action.at ? ' at ' + action.at : '') + ': “' + str(action.quote).replace(/\s+/g, ' ').trim() + '” (co-GM)').slice(0, 600) } };
    } else if (action.type === 'capture') {
      var b = BUCKET[action.bucket], text = str(action.text).replace(/\s+/g, ' ').trim().slice(0, 500);
      if (!b || !text) return { op: 'drop', why: 'no text' };
      plan = { op: 'do', type: 'capture', bucket: b, text: text };
    } else if (action.type === 'roll_log') {
      var parts = [action.who, action.action].map(function (x) { return str(x).replace(/\s+/g, ' ').trim(); }).filter(Boolean);
      var extra = [action.position, action.effect, action.result].filter(function (x) { return x && x !== 'unclear'; });
      if (parts.length < 2) return { op: 'drop', why: 'no roll' };
      plan = { op: 'do', type: 'capture', bucket: 'r', text: (parts.join(' · ') + (extra.length ? ' · ' + extra.join(' / ') : '')).slice(0, 500), roll: true };
      if (!confirmed) why = 'A roll is filed on your say-so';
    } else return { op: 'drop', why: 'unknown type' };
    if (plan.op === 'do' && !confirmed && !why && action.mode === 'offer') why = 'Not sure enough to act without you';
    if (why) { plan.op = 'offer'; plan.why = why; }
    return plan;
  }
  P.planApply = planApply;

  /* ---------- 5. undo: a compare-and-swap ----------
     rec is what apply left: { type, id, snap, from, to, text }. live is read fresh: { clock: {..}|null, npc: {..}|null, capture: text|null }. The write is made only
     if the object is still as it was left; otherwise { ok: false, why: 'changed', now, was } so the page can ask. force writes anyway. A thing already gone is
     done: { ok: true, noop: 'gone' }. */
  function undoClockAdd(rec, live, force) {
    var c = live.clock;
    if (!c) return { ok: true, noop: 'gone' };
    var s = rec.snap, same = c.name === s.name && c.size === s.size && (+c.filled || 0) === s.filled && (c.hidden === true) === s.hidden;
    if (same || force) return { ok: true, write: { remove: rec.id } };
    return { ok: false, why: 'changed', now: c.name + ' ' + (+c.filled || 0) + '/' + c.size + (c.hidden ? ' (hidden)' : ''), was: s.name + ' ' + s.filled + '/' + s.size + (s.hidden ? ' (hidden)' : '') };
  }
  function undoClockTick(rec, live, force) {
    var c = live.clock;
    if (!c) return { ok: true, noop: 'gone' };
    var cur = Math.max(0, Math.min(Math.floor(+c.size) || 12, Math.floor(+c.filled) || 0));
    if (cur === rec.to || force) return { ok: true, write: { id: rec.id, filled: rec.from } };
    return { ok: false, why: 'changed', now: cur + '/' + c.size, was: rec.to + '/' + c.size, back: rec.from };
  }
  function undoNpc(rec, live, force) {
    var n = live.npc;
    if (!n) return { ok: true, noop: 'gone' };
    var tags = Array.isArray(n.tags) ? n.tags.slice() : [];
    if (tags.indexOf('undone') >= 0) return { ok: true, noop: 'gone' };
    var same = n.revealed !== true && n.name === rec.snap.name && str(n.description) === rec.snap.description && str(n.role) === rec.snap.role;
    if (!same && !force) return { ok: false, why: 'changed', now: n.revealed === true ? 'revealed to the players' : 'edited', was: 'hidden, as made' };
    tags.push('undone');
    return { ok: true, write: { revealed: false, tags: tags } };
  }
  function undoCapture(rec, live, force) {
    if (live.capture === null || live.capture === undefined) return { ok: true, noop: 'gone' };
    if (live.capture === rec.text || force) return { ok: true, write: { remove: rec.id } };
    return { ok: false, why: 'changed', now: live.capture, was: rec.text };
  }
  function planUndo(rec, live, force) {
    live = isObj(live) ? live : {};
    if (!isObj(rec)) return { ok: true, noop: 'gone' };
    if (rec.type === 'clock_add') return undoClockAdd(rec, live, force === true);
    if (rec.type === 'clock_tick') return undoClockTick(rec, live, force === true);
    if (rec.type === 'npc_add') return undoNpc(rec, live, force === true);
    if (rec.type === 'capture') return undoCapture(rec, live, force === true);
    return { ok: true, noop: 'gone' };
  }
  P.planUndo = planUndo;
  /* the GM renamed or hid the clock from the card: that is not "changed since", it is the card's own edit, so the snapshot follows it */
  function noteEdit(rec, fields) { if (isObj(rec) && isObj(rec.snap)) Object.keys(fields).forEach(function (k) { rec.snap[k] = fields[k]; }); return rec; }
  P.noteEdit = noteEdit;
  /* what an applied plan leaves for undo */
  function recordOf(plan) {
    if (plan.type === 'clock_add') return { type: 'clock_add', id: plan.id, snap: { name: plan.clock.name, size: plan.clock.size, filled: plan.clock.filled || 0, hidden: true } };
    if (plan.type === 'clock_tick') return { type: 'clock_tick', id: plan.id, from: plan.from, to: plan.to };
    if (plan.type === 'npc_add') return { type: 'npc_add', id: plan.id, snap: { name: plan.doc.name, description: plan.doc.description, role: plan.doc.role } };
    return { type: 'capture', id: '', text: plan.text };
  }
  P.recordOf = recordOf;

  /* ---------- 6. the words on the cards (model text is data: the page sets it with textContent, and an asterisk is made harmless here) ---------- */
  function headline(plan, done) {
    var t = plan.type;
    if (t === 'clock_add') return (done ? 'Clock made (hidden): ' : 'Make a clock: ') + plain(plan.clock.name, 80) + ' (' + plan.clock.size + ')' + (plan.clock.filled > 0 ? ', ' + plan.clock.filled + ' marked' : '');
    if (t === 'clock_tick') return (done ? 'Ticked: ' : 'Tick: ') + plain(plan.name, 80) + ' ' + plan.from + '→' + plan.to + '/' + plan.size;
    if (t === 'npc_add') return (done ? 'New NPC (hidden): ' : 'Add an NPC: ') + plain(plan.name, 80) + (plan.rolled ? ' (name rolled)' : '');
    if (plan.roll) return (done ? 'Roll filed: ' : 'File this roll: ') + plain(plan.text, 100);
    return (done ? 'Filed: ' : 'File this: ') + plain(plan.text, 100);
  }
  P.headline = headline;
  function heard(action) {
    var q = str(action.quote).replace(/\s+/g, ' ').trim();
    return 'Heard' + (action.at ? ' at ' + action.at : '') + ': “' + q + '”';
  }
  P.heard = heard;

  var api = { match: match, newState: newState, start: start, catchUp: catchUp, ingest: ingest, cueNext: cueNext, nextWindow: nextWindow, windowSent: windowSent, windowFailed: windowFailed, seen: seen, mark: mark,
    buildState: buildState, planApply: planApply, planUndo: planUndo, noteEdit: noteEdit, recordOf: recordOf, headline: headline, heard: heard, plain: plain, norm: norm,
    TIMING: TIMING, PATTERNS: PATTERNS, _pure: P };
  return api;
});
