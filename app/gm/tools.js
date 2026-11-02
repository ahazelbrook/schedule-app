/* gm/tools.js — the GM page's tool registry and phase filter (suite ticket W0.5, no switch of its own).

   Every tab and panel of the GM page is a tool: { id, label, key, phases, workshop }. The registry says which phase of the night each belongs to, so the
   phase rail (spine.rail, a later ticket) can show only that phase's tools. Nothing here touches the DOM; gm-page.js asks, and draws.

   Window.B68GmTools, and module.exports under Node. No dependencies.

   The phases (the Run Sheet's four, in order), with the ids gm/night.js stores in the night's `phase` (W0.4): pb (Personal Business), plan (Planning), score, after (Aftermath).

   The filter is OFF until something calls setFilter({ on: true, phase }). While it is off every tool that is not behind the Workshop is visible, which is
   today's page. { all: true } ("All tools" on the rail) is the same as off. The tab the GM is looking at is always kept (visible(id, { current: id })),
   so changing phase never takes the floor from under them.

   API
     PHASES                    [{ id, label }]   ALL: every phase id
     register(def)             -> the stored tool. def: { id, label, phases, workshop?, key?, mount?(box, host)?, seg? }
                               phases: an array of phase ids, or 'all'. workshop: true puts the tool behind Menu -> Workshop (not on the tab bar).
                               mount(box, host) draws a tool that has no built-in panel (a later ticket's tool): the page gives it a tab and a pane.
     unregister(id)            -> true when it was there (built-ins stay)
     get(id) list() tabs() workshop() extras()
     phasesOf(id)              -> [phase id]
     inPhase(id, phase)        -> bool
     setFilter(f)              f: { on?, phase?, all? } merged into the filter; -> the filter. Fires onChange when something moved.
     filter()                  -> { on, phase, all } (a copy)        onChange(fn) -> off()
     visible(id, o)            -> bool: false for a workshop tool; true while the filter is off or all; else the tool belongs to the phase. o.current: a tool id always shown
     table()                   -> [{ id, label, key, phases: [labels], workshop }] for the report and the tests
     reset()                   -> drop registered tools and put the filter back off (tests) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmTools = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PHASES = [
    { id: 'pb', label: 'Personal Business' },
    { id: 'plan', label: 'Planning' },
    { id: 'score', label: 'Score' },
    { id: 'after', label: 'Aftermath' }
  ];
  var ALL = PHASES.map(function (p) { return p.id; });
  var ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function phasesFrom(p) {
    if (p === 'all' || p === undefined) return ALL.slice();
    if (!Array.isArray(p)) throw new Error('phases must be an array of phase ids, or "all"');
    var out = [];
    p.forEach(function (x) {
      if (ALL.indexOf(x) < 0) throw new Error('unknown phase: ' + str(x));
      if (out.indexOf(x) < 0) out.push(x);
    });
    if (!out.length) throw new Error('phases is empty: a tool belongs to at least one phase');
    return out;
  }

  /* The built-ins: today's tabs, in the order of the side panel, then Console (a segment of the phone layout) and the Run tab (it exists only while a v2 night is open).
     The phase tags are the table in the W0.5 report:
       prep, rules (GM screen), npc, ipad, console   every phase
       location                                       plan, score       (draw the site; use it at the table)
       scenes (Street)                                score
       score (J)                                      plan              (the score planner)
       chase                                          score
       downtime                                       pb, after
       cards (O)                                      plan              (one card per pitch at the planning meeting)
       run (G)                                        score */
  var BUILTIN = [
    { id: 'console', label: 'Console', key: '', phases: 'all' },
    { id: 'prep', label: 'Prep', key: 'R', phases: 'all' },
    { id: 'rules', label: 'GM screen', key: 'T', phases: 'all' },
    { id: 'location', label: 'Location', key: 'B', phases: ['plan', 'score'] },
    { id: 'scenes', label: 'Street', key: 'S', phases: ['score'] },
    { id: 'score', label: 'Score', key: 'J', phases: ['plan'] },
    { id: 'chase', label: 'Chase', key: 'C', phases: ['score'] },
    { id: 'npc', label: 'NPC', key: 'N', phases: 'all' },
    { id: 'downtime', label: 'Downtime', key: 'D', phases: ['pb', 'after'] },
    { id: 'cards', label: 'Cards', key: 'O', phases: ['plan'] },
    { id: 'ipad', label: 'iPad', key: 'I', phases: 'all' },
    { id: 'run', label: 'Run', key: 'G', phases: ['score'] }
  ];

  var tools = [], filt = { on: false, phase: '', all: false }, listeners = [];
  function build(def, builtin) {
    if (!isObj(def)) throw new Error('a tool is an object');
    var id = str(def.id);
    if (!ID_RE.test(id)) throw new Error('tool id must be lowercase letters, digits and dashes: ' + id);
    var label = str(def.label).trim();
    if (!label) throw new Error('tool ' + id + ' needs a label');
    var t = { id: id, label: label, key: str(def.key).toUpperCase().slice(0, 1), phases: phasesFrom(def.phases), workshop: def.workshop === true, builtin: !!builtin };
    if (typeof def.mount === 'function') t.mount = def.mount;
    return t;
  }
  function seed() { tools = BUILTIN.map(function (d) { return build(d, true); }); }
  seed();

  function get(id) { for (var i = 0; i < tools.length; i++) if (tools[i].id === id) return tools[i]; return null; }
  function register(def) {
    var t = build(def, false), old = get(t.id);
    if (old && old.builtin) throw new Error('tool ' + t.id + ' is built in');
    if (old) tools[tools.indexOf(old)] = t; else tools.push(t);
    fire();
    return t;
  }
  function unregister(id) {
    var t = get(id);
    if (!t || t.builtin) return false;
    tools.splice(tools.indexOf(t), 1);
    fire();
    return true;
  }
  function list() { return tools.slice(); }
  /* the tools on the tab bar: not behind the Workshop */
  function tabs() { return tools.filter(function (t) { return !t.workshop; }); }
  function workshop() { return tools.filter(function (t) { return t.workshop; }); }
  /* registered (not built-in) tools with a mount: the page gives each a tab and a pane */
  function extras() { return tools.filter(function (t) { return !t.builtin && !t.workshop && typeof t.mount === 'function'; }); }
  function phasesOf(id) { var t = get(id); return t ? t.phases.slice() : []; }
  function inPhase(id, phase) { var t = get(id); return !!t && t.phases.indexOf(phase) >= 0; }

  function fire() { listeners.slice().forEach(function (fn) { try { fn(filter()); } catch (e) { if (root && root.console) root.console.error(e); } }); }
  function filter() { return { on: filt.on, phase: filt.phase, all: filt.all }; }
  function setFilter(f) {
    f = isObj(f) ? f : {};
    var next = { on: 'on' in f ? f.on === true : filt.on, phase: 'phase' in f ? (ALL.indexOf(f.phase) >= 0 ? f.phase : '') : filt.phase, all: 'all' in f ? f.all === true : filt.all };
    if (next.on === filt.on && next.phase === filt.phase && next.all === filt.all) return filter();
    filt = next;
    fire();
    return filter();
  }
  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }
  function visible(id, o) {
    var t = get(id);
    if (!t || t.workshop) return false;
    if (!filt.on || filt.all || !filt.phase) return true;
    if (o && o.current === id) return true;
    return t.phases.indexOf(filt.phase) >= 0;
  }
  function table() {
    var label = {}; PHASES.forEach(function (p) { label[p.id] = p.label; });
    return tools.map(function (t) {
      return { id: t.id, label: t.label, key: t.key, phases: t.phases.length === ALL.length ? ['every phase'] : t.phases.map(function (p) { return label[p]; }), workshop: t.workshop };
    });
  }
  function reset() { seed(); filt = { on: false, phase: '', all: false }; listeners = []; }

  return { PHASES: PHASES, ALL: ALL, register: register, unregister: unregister, get: get, list: list, tabs: tabs, workshop: workshop, extras: extras,
    phasesOf: phasesOf, inPhase: inPhase, setFilter: setFilter, filter: filter, onChange: onChange, visible: visible, table: table, reset: reset };
});
