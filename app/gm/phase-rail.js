/* gm/phase-rail.js — the night's phases in minutes (suite ticket 1.1): the arithmetic behind the band's place chips (gm/band.js).

   Personal Business, Planning, Score and Aftermath: each phase's time against its budget (amber from 80%, red once over), and whether it is done,
   now or next. The chips themselves, and the tap that moves the night, are the band's; this file draws nothing. (The rail it was named after, a
   row of chips under the old top bar with an "All tools" filter, went with the night rebuild: the band holds the places now.)

   Window.B68GmPhaseRail, and module.exports under Node. The montage's "over budget" reads model() too.

   PURE
     PHASES   [{ id, label }] in night order
     model(night, nowMs) -> { phase, items: [{ id, label, state: 'done' | 'now' | 'next', mins, budget, tone: '' | 'amber' | 'red', text }] }
         mins: minutes in the phase (so far, or in total once it is done); budget: minutes or null; text: "12 / 30 min" for the phase in play
     toneOf(mins, budget) -> '' | 'amber' | 'red'          amber at 80% of the budget, red when over it */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmPhaseRail = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PHASES = [{ id: 'pb', label: 'Personal Business' }, { id: 'plan', label: 'Planning' }, { id: 'score', label: 'Score' }, { id: 'after', label: 'Aftermath' }];
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  function toneOf(mins, budget) {
    if (!(budget > 0) || mins === null) return '';
    if (mins > budget) return 'red';
    return mins >= budget * 0.8 ? 'amber' : '';
  }
  function model(night, nowMs) {
    var n = isObj(night) ? night : {}, ph = isObj(n.phases) ? n.phases : {}, cur = PHASES.some(function (p) { return p.id === n.phase; }) ? n.phase : '';
    var seen = false;
    var items = PHASES.map(function (p) {
      var d = isObj(ph[p.id]) ? ph[p.id] : {}, start = num(d.start), end = num(d.end), budget = num(d.budget) > 0 ? d.budget : null, state, mins = null;
      if (p.id === cur) { state = 'now'; seen = true; if (start !== null && nowMs >= start) mins = Math.floor((nowMs - start) / 60000); }
      else if (start !== null && end !== null && !seen && cur) { state = 'done'; mins = Math.max(0, Math.floor((end - start) / 60000)); }
      else state = 'next';
      var tone = state === 'now' ? toneOf(mins, budget) : '';
      var text = mins === null ? (budget ? budget + ' min' : '') : mins + (budget && state === 'now' ? ' / ' + budget : '') + ' min';
      return { id: p.id, label: p.label, state: state, mins: mins, budget: budget, tone: tone, text: text };
    });
    return { phase: cur, items: items };
  }

  return { PHASES: PHASES, model: model, toneOf: toneOf };
});
