/* gm/tools.js — the GM page's tool registry (suite ticket W0.5; the night rebuild: N1b took the phase filter out). No switch of its own.

   Every pane of the GM page is a built-in here, { id, label, key, builtin: true }: the panes the places show and hide (gm/places.js holds the one
   table of views: which place lays out which pane or tool, and the keys). A later tool registers itself here; one with mount(box, host) is a
   view the places can open in any place (as an extra view of the place the GM is in), and Find lists it. gm/tool-registry.js (N2) adds the 18
   tools that used to open from the Menu to THIS object, so get(id) answers for those too: keep this object the one window.B68GmTools, never
   replace it.

   Gone: the phase filter (the places lay out each phase's tools, so nothing hides a tab and there are no tabs to hide), its "All tools", and the
   Workshop flag (the Workshop drawer went in N0). Nothing here touches the DOM; nothing here depends on the night.

   Window.B68GmTools, and module.exports under Node. No dependencies.

   API
     register(def)     -> the stored tool. def: { id, label, key?, mount?(box, host), words? }   (an older def's phases or workshop are ignored)
     unregister(id)    -> true when it was there (built-ins stay)
     get(id) list()    a tool by id (null when there is none) / every tool, the built-ins first
     extras()          registered (not built-in) tools with a mount: views the places can open
     table()           -> [{ id, label, key }] for the report and the tests
     reset()           -> drop the registered tools (tests) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmTools = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }

  /* the built-ins: the page's panes (and the console, the left column the places call the Roll), with the labels and keys the places give them */
  var BUILTIN = [
    { id: 'console', label: 'The Roll', key: '' },
    { id: 'prep', label: 'Prep', key: 'R' },
    { id: 'rules', label: 'Rules', key: 'T' },
    { id: 'location', label: 'Location roller', key: 'B' },
    { id: 'scenes', label: 'Street', key: 'S' },
    { id: 'score', label: 'Score generator', key: 'J' },
    { id: 'chase', label: 'Chase', key: 'C' },
    { id: 'npc', label: 'Cast', key: 'N' },
    { id: 'downtime', label: 'Downtime', key: 'D' },
    { id: 'cards', label: 'Opportunities', key: 'O' },
    { id: 'ipad', label: 'iPad', key: 'I' },
    { id: 'run', label: 'The site', key: 'G' }
  ];

  var tools = [];
  function build(def, builtin) {
    if (!isObj(def)) throw new Error('a tool is an object');
    var id = str(def.id);
    if (!ID_RE.test(id)) throw new Error('tool id must be lowercase letters, digits and dashes: ' + id);
    var label = str(def.label).trim();
    if (!label) throw new Error('tool ' + id + ' needs a label');
    var t = { id: id, label: label, key: str(def.key).toUpperCase().slice(0, 1), builtin: !!builtin };
    if (typeof def.mount === 'function') t.mount = def.mount;
    if (str(def.words).trim()) t.words = str(def.words).trim();
    return t;
  }
  function seed() { tools = BUILTIN.map(function (d) { return build(d, true); }); }
  seed();

  function get(id) { for (var i = 0; i < tools.length; i++) if (tools[i].id === id) return tools[i]; return null; }
  function register(def) {
    var t = build(def, false), old = get(t.id);
    if (old && old.builtin) throw new Error('tool ' + t.id + ' is built in');
    if (old) tools[tools.indexOf(old)] = t; else tools.push(t);
    return t;
  }
  function unregister(id) {
    var t = get(id);
    if (!t || t.builtin) return false;
    tools.splice(tools.indexOf(t), 1);
    return true;
  }
  function list() { return tools.slice(); }
  function extras() { return tools.filter(function (t) { return !t.builtin && typeof t.mount === 'function'; }); }
  function table() { return tools.map(function (t) { return { id: t.id, label: t.label, key: t.key }; }); }
  function reset() { seed(); }

  return { register: register, unregister: unregister, get: get, list: list, extras: extras, table: table, reset: reset };
});
