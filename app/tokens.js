/* B68Tokens: the design tokens of app/tokens.css as data, for new work that draws in script (suite F6). The values are the same as the
   stylesheet's, and checks/runtime/show-contract.test.mjs fails if the two drift. `css()` renders the :root block from these values.
   B68Tokens.color['rules-blue'] is --b68-rules-blue; B68Tokens.type.label is --b68-t-label; B68Tokens.faction(n) is the nth slot (1-6). */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68Tokens = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var color = {
    'paper': '#f2ede1', 'paper-light': '#fbf8f1', 'paper-dark': '#dcd4c2',
    'ink': '#14110e', 'ink-soft': '#55504a', 'ink-faint': '#8e8880',
    'orange': '#e0691e', 'orange-deep': '#b8481a', 'rules-blue': '#26418f', 'rules-blue-lit': '#3f62c4',
    'alarm': '#a8210f', 'alarm-lit': '#e03a20', 'mustard': '#e8c33c',
    'faction-1': '#e0691e', 'faction-1-ink': '#14110e', 'faction-2': '#3f62c4', 'faction-2-ink': '#fbf8f1',
    'faction-3': '#6e8f6a', 'faction-3-ink': '#14110e', 'faction-4': '#c9348c', 'faction-4-ink': '#fbf8f1',
    'faction-5': '#6e8a8c', 'faction-5-ink': '#14110e', 'faction-6': '#e8c33c', 'faction-6-ink': '#14110e'
  };
  var type = { 'label': '3.4vmin', 'body': '4.4vmin', 'lead': '6vmin', 'title': '9vmin', 'display': '13vmin', 'stamp': '20vmin' };
  function faction(n) {
    var i = Math.floor(Number(n));
    if (!(i >= 1 && i <= 6)) return null;
    return { fill: color['faction-' + i], ink: color['faction-' + i + '-ink'] };
  }
  /* every custom property with a literal value, as { '--b68-paper': '#f2ede1', ... } (the font stacks are the stylesheet's alone) */
  function vars() {
    var out = {};
    Object.keys(color).forEach(function (k) { out['--b68-' + k] = color[k]; });
    Object.keys(type).forEach(function (k) { out['--b68-t-' + k] = type[k]; });
    return out;
  }
  function css() {
    var v = vars();
    return ':root {\n' + Object.keys(v).map(function (k) { return '  ' + k + ': ' + v[k] + ';'; }).join('\n') + '\n}\n';
  }
  return { color: color, type: type, faction: faction, vars: vars, css: css };
});
