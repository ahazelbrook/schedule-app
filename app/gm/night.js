/* gm/night.js — the night contract (W0.4): which phase of the evening it is, its budget, start and end, the hard start and the curfew,
   the Aftermath's step and data, and a capped log of phase changes, stamps and cues. The GM state document holds it as `night`.
   Plain script, UMD: window.B68GmNight in the browser, module.exports under Node (it needs gm/prep.js beside it, for budget()).
   Nothing here touches the DOM, the network or the clock: the caller passes the time. GM side only: the players are never sent `night`,
   and the iPad is only ever given bandPhase(night), an id with no time in it.

   THE SHAPE (everything optional; clean() fills the defaults)
     night = { v: 1,
       phase:     "" | "pb" | "plan" | "score" | "after"       Personal Business, Planning, Score, Aftermath ("" before the first is entered)
       phases:    { <id>: { budget: minutes | null, start: ms | null, end: ms | null } }   all four ids, always
       startAt:   "HH:MM" | null      the hard start       curfewAt: "HH:MM" | null      the curfew       (wall-clock, the GM's own; clockMs() turns one into a time today)
       aftermath: { step: "" | text, data: { <key>: string | number | boolean } }   a flat bag, at most 24 keys, 200 characters a string
       log:       { <id>: { at: ms, k: "phase" | "stamp" | "cue", text, p?: phase id } }   a MAP, not an array: the server merges maps, so every
                  append is a small patch and two GM pages never overwrite each other. At most 500 entries; text at most 80 characters and 100 bytes; at, start and end are milliseconds.
     }
   Size: an entry is under 190 bytes, so a full log is under 95 KiB; with the capture lines at their 128 KiB cap that is under the state
   document's 240 KiB soft line (checks/runtime/gm-night.test.mjs holds it to that).

   PATCHES (every writer returns a state-document patch, `{ night: { ... } }`, or null when there is nothing to write; none writes on its own)
     enter(night, phase, nowMs, prep)   end the phase that is current, start this one, log it; prep (parsePrep's answer) seeds the budgets and times it has
     stamp(night, text, nowMs)          a table stamp into the log        cue(night, text, nowMs)   a cue into the log
     setAfter(night, step, data)         the Aftermath's step and data (data replaces: keys it no longer has are nulled)
     reset()                             { night: null }: the next night starts clean
   READERS
     clean(raw) -> night      bandPhase(night) -> id | ""      logList(night) -> entries, oldest first      clockMs(hhmm, nowMs) -> ms | null
   THE PREP NOTE
     parsePrep(note) -> { start: "HH:MM" | null, curfew: "HH:MM" | null, budgets: { pb, plan, score, after: minutes | null }, rows: [{ beat, phase, min }] }
       note is a pack prep note, { blocks: [{ k, src }] } (a string is read as one block). Only the note's own Markdown blocks are read (never a
       transcluded section). The numbers come from the run order, the table the beat bar already reads (a "#" first column and an About / Time /
       Budget / Length column): a row's minutes (prep.js budget(): the upper end of a range) go to the phase its row names, and rows that name the
       same phase add up. The phase is the first of these found in the row's cells, the Go to link included:
         after  aftermath | close | payout | wrap      pb  personal business | downtime      plan  planning | briefing | engagement      score  score | heist
       A row that names none is not counted. The two times are body lines of the note, outside code fences: `start: 19:30` and `curfew: 22:40`
       (a leading "- " or bold marks are fine). No lines, no times: a note without them gives nulls and changes nothing.
   create(host) -> controller. host: { doc() -> the GM state document, patch(p) -> bool, prep() -> note | null, now() -> ms, changed() }
     enter(phase) stamp(text) cue(text) setAfter(step, data) reset() phase() night() band() -> as above, written through host.patch */
(function (root, factory) {
  'use strict';
  var M = factory(typeof module === 'object' && module && module.exports ? require('./prep.js') : root.B68GmPrep);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmNight = M;
})(typeof self !== 'undefined' ? self : this, function (Prep) {
  'use strict';

  var PHASES = [{ id: 'pb', label: 'Personal Business' }, { id: 'plan', label: 'Planning' }, { id: 'score', label: 'Score' }, { id: 'after', label: 'Aftermath' }];
  var IDS = PHASES.map(function (p) { return p.id; });
  var KINDS = ['phase', 'stamp', 'cue'];
  var LIMITS = { log: 500, text: 80, textBytes: 100, step: 40, dataKeys: 24, dataStr: 200, keyLen: 40, minutes: 1440 };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function utf8(s) { var n = 0; for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? (i++, 4) : 3; } return n; }
  function cutBytes(v, n, b) { var s = cut(v, n); while (s.length && utf8(s) > b) s = s.slice(0, -1); return s.trim(); }
  function cut(v, n) { var s = str(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).trim() : s; }
  function isPhase(p) { return IDS.indexOf(p) >= 0; }
  function hhmm(v) { var m = /^(\d{1,2}):(\d{2})$/.exec(str(v).trim()); return m && +m[1] <= 23 && +m[2] <= 59 ? ('0' + m[1]).slice(-2) + ':' + m[2] : null; }
  function ms(v) { return typeof v === 'number' && isFinite(v) && v > 0 && v < 8.64e15 ? Math.round(v) : null; }
  function mins(v) { return typeof v === 'number' && isFinite(v) && v > 0 && v <= LIMITS.minutes ? Math.round(v) : null; }

  /* ---------- the prep note ---------- */
  var FENCE = /^ {0,3}(`{3,}|~{3,})/;
  var PHASE_WORDS = [['after', /aftermath|\bclose\b|payout|\bwrap/i], ['pb', /personal business|downtime/i], ['plan', /planning|briefing|engagement/i], ['score', /\bscore\b|\bheist\b/i]];
  var LINE_RE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?(start|curfew)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(\d{1,2}:\d{2})\s*(?:\*\*|__)?\s*$/i;
  function budgetOf(text) { return Prep && typeof Prep.budget === 'function' ? Prep.budget(text) : null; }
  function cells(line) {
    var s = line.replace(/\[\[[^\]]*\]\]/g, function (m) { return m.replace(/\|/g, '\u0001'); }).trim();
    s = s.replace(/^\|/, '').replace(/\|$/, '');
    return s.split('|').map(function (c) { return c.replace(/\u0001/g, '|').trim(); });
  }
  function phaseOf(text) { for (var i = 0; i < PHASE_WORDS.length; i++) if (PHASE_WORDS[i][1].test(text)) return PHASE_WORDS[i][0]; return null; }

  function parsePrep(note) {
    var blocks = typeof note === 'string' ? [{ k: 'md', src: note }] : isObj(note) && Array.isArray(note.blocks) ? note.blocks : [];
    var out = { start: null, curfew: null, budgets: { pb: null, plan: null, score: null, after: null }, rows: [] }, found = false;
    blocks.forEach(function (b) {
      if (!isObj(b) || b.k === 'embed') return;
      var fence = null, lines = str(b.src).replace(/\r\n?/g, '\n').split('\n'), head = null, sep = false;
      lines.forEach(function (ln) {
        var f = FENCE.exec(ln);
        if (fence) { if (f && f[1].charAt(0) === fence.charAt(0) && f[1].length >= fence.length) fence = null; head = null; return; }
        if (f) { fence = f[1]; head = null; return; }
        var t = LINE_RE.exec(ln);
        if (t) { var k = t[1].toLowerCase(), v = hhmm(t[2]); if (v && out[k] === null) out[k] = v; return; }
        if (!/^\s*\|/.test(ln)) { head = null; sep = false; if (out.rows.length) found = true; return; }
        var c = cells(ln);
        if (!head) {                                                        /* the header row of a table */
          var tc = c.findIndex(function (h) { return /^(about|time|budget|length)$/i.test(h); });
          head = { time: c.length > 1 && c[0] === '#' ? tc : -1 }; sep = false; return;
        }
        if (!sep) { sep = true; return; }                                   /* the |---|---| row */
        if (found || head.time < 1 || !/\S/.test(c[0]) || head.time >= c.length) return;
        var min = budgetOf(c[head.time]), ph = phaseOf(c.slice(1).join(' | '));
        out.rows.push({ beat: c.slice(1, head.time).join(' ').replace(/[*_`]/g, '').trim().slice(0, 120), phase: ph, min: min });
        if (ph && min) out.budgets[ph] = (out.budgets[ph] || 0) + min;
      });
      if (out.rows.length) found = true;                                    /* the first run order only */
    });
    IDS.forEach(function (id) { if (!mins(out.budgets[id])) out.budgets[id] = null; });
    return out;
  }

  /* ---------- the state ---------- */
  function cleanData(d) {
    var out = {}, n = 0;
    if (isObj(d)) Object.keys(d).forEach(function (k) {
      var key = cut(k, LIMITS.keyLen), v = d[k];
      if (!key || key === '__proto__' || n >= LIMITS.dataKeys || has(out, key)) return;
      if (typeof v === 'string') out[key] = cut(v, LIMITS.dataStr);
      else if (typeof v === 'number' && isFinite(v)) out[key] = v;
      else if (typeof v === 'boolean') out[key] = v;
      else return;
      n++;
    });
    return out;
  }
  function cleanEntry(e) {
    if (!isObj(e)) return null;
    var at = ms(e.at), k = KINDS.indexOf(e.k) >= 0 ? e.k : null, text = cutBytes(e.text, LIMITS.text, LIMITS.textBytes);
    if (!at || !k) return null;
    var o = { at: at, k: k, text: text };
    if (isPhase(e.p)) o.p = e.p;
    return o;
  }
  function byAt(a, b) { return a[1].at < b[1].at ? -1 : a[1].at > b[1].at ? 1 : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; }
  function sortedLog(raw) {
    var l = [];
    if (isObj(raw)) Object.keys(raw).forEach(function (id) { var e = cleanEntry(raw[id]); if (e && id !== '__proto__') l.push([id, e]); });
    return l.sort(byAt);
  }
  function clean(raw) {
    var r = isObj(raw) ? raw : {}, ph = isObj(r.phases) ? r.phases : {}, log = {};
    var phases = {};
    IDS.forEach(function (id) { var p = isObj(ph[id]) ? ph[id] : {}; phases[id] = { budget: mins(p.budget), start: ms(p.start), end: ms(p.end) }; });
    sortedLog(r.log).slice(-LIMITS.log).forEach(function (x) { log[x[0]] = x[1]; });
    var a = isObj(r.aftermath) ? r.aftermath : {};
    return { v: 1, phase: isPhase(r.phase) ? r.phase : '', phases: phases, startAt: hhmm(r.startAt), curfewAt: hhmm(r.curfewAt),
      aftermath: { step: cut(a.step, LIMITS.step), data: cleanData(a.data) }, log: log };
  }
  function logList(night) { return sortedLog(clean(night).log).map(function (x) { return x[1]; }); }
  function bandPhase(night) { var p = isObj(night) ? night.phase : ''; return isPhase(p) ? p : ''; }
  function clockMs(t, nowMs) {
    var v = hhmm(t), d = new Date(typeof nowMs === 'number' && isFinite(nowMs) ? nowMs : 0);
    if (!v || isNaN(d)) return null;
    d.setHours(+v.slice(0, 2), +v.slice(3), 0, 0);
    return d.getTime();
  }

  /* ---------- patches ---------- */
  var seq = 0;
  function newId(at) { seq = (seq + 1) % 1296; return 'n' + (at || 0).toString(36) + ('0' + seq.toString(36)).slice(-2) + Math.floor(Math.random() * 36).toString(36); }
  /* the log patch for one more entry: the entry under a new id, and the oldest nulled once the log is past its cap. It counts what is STORED
     (every key of night.log, a bad entry as the oldest of all), not clean()'s capped view, so two pages that appended at once and left more than
     500 behind are trimmed back by the next append. */
  function logAdd(night, entry, id) {
    var raw = isObj(night) && isObj(night.log) ? night.log : {}, add = {}, all = [];
    id = id || newId(entry.at);
    add[id] = entry;
    Object.keys(raw).forEach(function (k) { if (k === id) return; var e = cleanEntry(raw[k]); all.push([k, e || { at: 0 }]); });
    all.push([id, entry]);
    all.sort(byAt);
    for (var i = 0; i < all.length - LIMITS.log; i++) if (all[i][0] !== id) add[all[i][0]] = null;
    return add;
  }
  function entry(k, text, at, p) { var e = { at: at, k: k, text: cutBytes(text, LIMITS.text, LIMITS.textBytes) }; if (isPhase(p)) e.p = p; return e; }

  function enter(night, phase, nowMs, prep, id) {
    var n = clean(night), at = ms(nowMs);
    if (!isPhase(phase) || !at || n.phase === phase) return null;
    var phases = {};
    if (isPhase(n.phase)) phases[n.phase] = { end: at };
    phases[phase] = { start: at, end: null };
    var out = { phase: phase, phases: phases, log: logAdd(night, entry('phase', labelOf(phase), at, phase), id) };
    if (isObj(prep)) {                                                       /* the note's numbers, where it gave any and they differ */
      IDS.forEach(function (i) {
        var b = prep.budgets && mins(prep.budgets[i]);
        if (b && b !== n.phases[i].budget) phases[i] = Object.assign(phases[i] || {}, { budget: b });
      });
      if (hhmm(prep.start) && hhmm(prep.start) !== n.startAt) out.startAt = hhmm(prep.start);
      if (hhmm(prep.curfew) && hhmm(prep.curfew) !== n.curfewAt) out.curfewAt = hhmm(prep.curfew);
    }
    return { night: Object.assign({ v: 1 }, out) };
  }
  function labelOf(id) { return PHASES.filter(function (p) { return p.id === id; }).map(function (p) { return p.label; })[0] || id; }
  function note(k, night, text, nowMs, id) {
    var at = ms(nowMs), t = cutBytes(text, LIMITS.text, LIMITS.textBytes);
    if (!at || !t) return null;
    return { night: { v: 1, log: logAdd(night, entry(k, t, at, bandPhase(night)), id) } };
  }
  function stamp(night, text, nowMs, id) { return note('stamp', night, text, nowMs, id); }
  function cue(night, text, nowMs, id) { return note('cue', night, text, nowMs, id); }
  function setAfter(night, step, data) {
    var raw = isObj(night) && isObj(night.aftermath) && isObj(night.aftermath.data) ? night.aftermath.data : {}, d = cleanData(data), out = {};
    Object.keys(raw).forEach(function (k) { if (!has(d, k) && k !== '__proto__') out[k] = null; });       /* every stored key, not clean()'s view of them */
    Object.keys(d).forEach(function (k) { out[k] = d[k]; });
    return { night: { v: 1, aftermath: { step: cut(step, LIMITS.step), data: out } } };
  }
  function reset() { return { night: null }; }

  /* ---------- the controller one GM page holds ---------- */
  function create(host) {
    host = host || {};
    function night() { var d = typeof host.doc === 'function' ? host.doc() : null; return clean(isObj(d) ? d.night : null); }
    function nowMs() { return typeof host.now === 'function' ? host.now() : Date.now(); }
    function send(p) { if (!p) return false; var ok = typeof host.patch === 'function' && host.patch(p) !== false; if (ok && typeof host.changed === 'function') host.changed(); return ok; }
    return {
      night: night,
      phase: function () { return night().phase; },
      band: function () { return bandPhase(night()); },
      enter: function (phase) { var pn = typeof host.prep === 'function' ? host.prep() : null; return send(enter(night(), phase, nowMs(), pn ? parsePrep(pn) : null)); },
      stamp: function (text) { return send(stamp(night(), text, nowMs())); },
      cue: function (text) { return send(cue(night(), text, nowMs())); },
      setAfter: function (step, data) { return send(setAfter(night(), step, data)); },
      reset: function () { return send(reset()); }
    };
  }

  return { PHASES: PHASES, LIMITS: LIMITS, parsePrep: parsePrep, clean: clean, enter: enter, stamp: stamp, cue: cue, setAfter: setAfter, reset: reset,
    bandPhase: bandPhase, logList: logList, clockMs: clockMs, create: create };
});
