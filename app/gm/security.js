/* gm/security.js — the security level (suite 2.4, switch map.security).

   Plain script, UMD: window.B68GmSecurity in the browser, module.exports under Node. GM side only. The pure parts touch nothing; create(host) reaches the page
   only through the host it is given.

   THE CLOCK. The score's alarm is a clock of 4 to 6 LEVELS, each with an in-world name. The names come from a prep note line
       security: Quiet > Watchful > Alert > Hunting > Lockdown
   (separated by > , ; | or an arrow; 4 to 6 names, more are cut, fewer fall back to the defaults) or, with no such line, from DEFAULT_NAMES.
   On a v2 site the alarm already is a clock (play.alarm, the run's state alarm.filled); the levels follow its segments: with S segments the clock is
   cut into n = S (clamped to 4..6) levels, and a level is reached only when the segment that completes it is filled, so a half-way tick never moves it.
   Without a site alarm the GM steps the level by hand (page-local, not saved).

   THE MAP. Reaching a new level (full, never a partial) sets the iPad's band.security layer (0 to 4, level 0 clears it) and lays the level's NAME over the iPad for
   3 seconds (the show contract's `spotted` beat). The first reading after a page load is silent. The GM screen shows "next level: ...", never the iPad.

   API
     DEFAULT_NAMES(n) -> [name]          namesFrom(markdown) -> [name] | null         fromPrep(prepPart) -> [name] | null
     levelCount(size) -> 4..6            levelIndex(filled, size, n) -> 0..n-1        tintFor(index, n) -> 0..4 | null
     plan(alarm, names, manual) -> { n, index, name, next, names, tint, source } | null       alarm: { size, filled } | null
     create(host) -> controller
       host: { feature(id) -> bool, alarm() -> { size, filled } | null, names() -> [name] | null, key() -> string, layer(path, value) -> Promise, show(kind, payload, opts) -> Promise, toast, changed() }
       controller: tick() view() step(delta) reset() */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmSecurity = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SWITCH = 'map.security', SHOW_MS = 3000, NAME_MAX = 24;
  var DEFAULTS = { 4: ['Quiet', 'Watchful', 'Alert', 'Lockdown'], 5: ['Quiet', 'Watchful', 'Alert', 'Hunting', 'Lockdown'], 6: ['Quiet', 'Watchful', 'Alert', 'Hunting', 'Sealed', 'Lockdown'] };
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function whole(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

  function levelCount(size) { return whole(size) ? Math.max(4, Math.min(6, size)) : 5; }
  function DEFAULT_NAMES(n) { return (DEFAULTS[levelCount(n)] || DEFAULTS[5]).slice(); }
  function plainName(s) {
    return str(s).replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2').replace(/!?\[\[([^\]]*)\]\]/g, '$1').replace(/[*_`~=]+/g, '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
  }
  /* the first "security:" line (outside code fences) of some Markdown -> 4 to 6 names, or null */
  function namesFrom(md) {
    var fence = null, lines = str(md).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i], f = /^ {0,3}(`{3,}|~{3,})/.exec(l);
      if (f) { if (!fence) fence = f[1].charAt(0); else if (f[1].charAt(0) === fence) fence = null; continue; }
      if (fence) continue;
      var m = /^\s*(?:>\s*)*(?:[-*+]\s+)?(?:\*\*|__)?security(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(.+)$/i.exec(l);
      if (!m) continue;
      var names = m[1].split(/\s*(?:›|→|->|>|\||,|;)\s*/).map(plainName).filter(Boolean);
      var seen = {}; names = names.filter(function (n) { var k = n.toLowerCase(); if (seen[k]) return false; seen[k] = 1; return true; });
      return names.length >= 4 ? names.slice(0, 6) : null;
    }
    return null;
  }
  function fromPrep(prepPart) {
    var notes = isObj(prepPart) && Array.isArray(prepPart.notes) ? prepPart.notes : [];
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i]; if (!isObj(n)) continue;
      var md = (Array.isArray(n.blocks) ? n.blocks : []).map(function (b) { return isObj(b) ? str(b.src) : ''; }).join('\n');
      var got = namesFrom(md); if (got) return got;
    }
    return null;
  }
  /* the level a clock of `size` segments, `filled` of them full, is at, among n levels: whole segments only */
  function levelIndex(filled, size, n) {
    if (!whole(filled) || filled <= 0 || !whole(size) || size <= 0) return 0;
    if (filled >= size) return n - 1;
    return Math.min(n - 1, Math.floor(filled * (n - 1) / size));
  }
  function tintFor(index, n) { return index > 0 && n > 1 ? Math.max(1, Math.min(4, Math.round(index * 4 / (n - 1)))) : null; }
  function plan(alarm, names, manual) {
    var size = isObj(alarm) && whole(alarm.size) && alarm.size > 0 ? alarm.size : 0, n = size ? levelCount(size) : (Array.isArray(names) && names.length >= 4 ? Math.min(6, names.length) : 5);
    var list = Array.isArray(names) && names.length >= 4 ? names.slice(0, 6) : DEFAULT_NAMES(n);
    var source = Array.isArray(names) && names.length >= 4 ? 'prep' : 'default';
    n = list.length;
    var index = size ? levelIndex(alarm.filled, size, n) : Math.max(0, Math.min(n - 1, whole(manual) ? manual : 0));
    return { n: n, index: index, name: list[index], next: index + 1 < n ? list[index + 1] : '', names: list, tint: tintFor(index, n), source: source, site: !!size };
  }

  function create(host) {
    host = host || {};
    var last = null, lastKey = '', manual = 0;
    function on() { return typeof host.feature === 'function' ? !!host.feature(SWITCH) : false; }
    function current() {
      return plan(typeof host.alarm === 'function' ? host.alarm() : null, typeof host.names === 'function' ? host.names() : null, manual);
    }
    function changed() { if (typeof host.changed === 'function') host.changed(); }
    function key() { return typeof host.key === 'function' ? str(host.key()) : ''; }
    function layer(v) { return typeof host.layer === 'function' ? Promise.resolve(host.layer('band.security', v)).then(null, function () { return null; }) : Promise.resolve(null); }
    function tick() {
      if (!on()) return null;
      var p = current(), k = key();
      if (k !== lastKey) { last = null; lastKey = k; }
      if (last === null) { last = p.index; if (p.tint !== null) layer(p.tint); return p; }
      if (p.index === last) return p;
      var up = p.index > last; last = p.index;
      layer(p.tint);
      if (up && typeof host.show === 'function') host.show('spotted', { text: p.name }, { ms: SHOW_MS, key: 'b17sec-' + k + '-' + p.index });
      changed();
      return p;
    }
    function step(delta) {
      if (!on()) return false;
      var p = current(); if (p.site) return false;
      manual = Math.max(0, Math.min(p.n - 1, manual + (delta < 0 ? -1 : 1)));
      tick(); changed(); return true;
    }
    function view() {
      if (!on()) return null;
      var p = current();
      return { name: p.name, next: p.next, index: p.index, n: p.n, site: p.site, source: p.source, line: 'Security: ' + p.name + ' (' + (p.index + 1) + ' of ' + p.n + ') · next level: ' + (p.next || 'none, this is the top') };
    }
    function reset() { last = null; lastKey = ''; manual = 0; }
    return { tick: tick, view: view, step: step, reset: reset, SHOW_MS: SHOW_MS };
  }

  function html(v, esc) {
    esc = esc || function (s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    if (!v) return '';
    return '<div class="gm-sec-line"><span class="gm-lab">Security</span> <b>' + esc(v.name) + '</b> <span class="gm-dim">' + (v.index + 1) + ' of ' + v.n + ' · next level: ' + esc(v.next || 'none, this is the top') + '</span>' +
      (v.site ? '' : ' <button type="button" class="btn sm" data-b17="sec-down" aria-label="Security down one level">−</button> <button type="button" class="btn sm" data-b17="sec-up" aria-label="Security up one level">+</button>') + '</div>';
  }

  return { SWITCH: SWITCH, DEFAULT_NAMES: DEFAULT_NAMES, namesFrom: namesFrom, fromPrep: fromPrep, levelCount: levelCount, levelIndex: levelIndex, tintFor: tintFor, plan: plan, create: create, html: html };
});
