/* gm/security.js — the security level, and the site's ONE alarm readout (suite 2.4; the GM night rebuild, N3: the site).

   Plain script, UMD: window.B68GmSecurity in the browser, module.exports under Node. GM side only. The pure parts touch nothing; create(host) reaches the page
   only through the host it is given.

   THE CLOCK. The score's alarm is a clock of 4 to 6 LEVELS, each with an in-world name. The names come from a prep note line
       security: Quiet > Watchful > Alert > Hunting > Lockdown
   (separated by > , ; | or an arrow; 4 to 6 names, more are cut, fewer fall back to the defaults) or, with no such line, from DEFAULT_NAMES.
   On a v2 site the alarm already is a clock: the TABLE clock the play's alarm names (play.alarm.clock), the same one the site's header reads and Spotted ticks.
   The levels follow its segments: with S segments the clock is cut into n = S (clamped to 4..6) levels, and a level is reached only when the segment that
   completes it is filled, so a half-way tick never moves it. Without a site alarm clock the GM steps the level by hand (page-local, not saved).

   THE iPAD. Reaching a new level (full, never a partial) sets the iPad's band.security layer (0 to 4, level 0 clears it) and lays the level's NAME over the iPad
   for 3 seconds (the show contract's `spotted` beat). The first reading after a page load is silent. A site alarm clock the GM keeps HIDDEN from the players
   keeps the level off the iPad too (no tint, no name; a tint already up is taken down once): the GM screen still reads it. A hand-stepped level always shows.

   THE READOUT (the site's header): "Alarm ■■□□□□ Watchful 2/6", a button that opens a popover with what this beat of the alarm does, the level and the next,
   and, by hand, the steps. readoutHtml and popHtml draw both; the page and the Run view give the attribute their clicks go by.

   API
     DEFAULT_NAMES(n) -> [name]          namesFrom(markdown) -> [name] | null         fromPrep(prepPart) -> [name] | null
     levelCount(size) -> 4..6            levelIndex(filled, size, n) -> 0..n-1        tintFor(index, n) -> 0..4 | null
     plan(alarm, names, manual) -> { n, index, name, next, names, tint, source, site } | null       alarm: { size, filled } | null
     segs(view) -> { n, filled }         the readout's boxes: the clock's segments, or by hand one box a level above the first
     readoutHtml(view, opts, esc)        opts: { open, attr (the button's action attribute, default data-rv="alarm"), label }
     popHtml(view, opts, esc)            opts: { clock (its name), beat (what this beat does), missing (the play names a clock the table lacks), gm (add data-gm="site") }
     create(host) -> controller
       host: { feature(id) -> bool, alarm() -> { size, filled, visible } | null, names() -> [name] | null, key() -> string, layer(path, value) -> Promise,
               show(kind, payload, opts) -> Promise, toast, changed() }
       controller: tick() view() step(delta) reset() */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmSecurity = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SWITCH = 'map.security', SHOW_MS = 3000, NAME_MAX = 24, SEG_MAX = 12;
  var DEFAULTS = { 4: ['Quiet', 'Watchful', 'Alert', 'Lockdown'], 5: ['Quiet', 'Watchful', 'Alert', 'Hunting', 'Lockdown'], 6: ['Quiet', 'Watchful', 'Alert', 'Hunting', 'Sealed', 'Lockdown'] };
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function whole(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }
  function esc0(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

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
    var last = null, lastKey = '', manual = 0, tinted = false;
    function on() { return typeof host.feature === 'function' ? !!host.feature(SWITCH) : false; }
    function alarm() { var a = typeof host.alarm === 'function' ? host.alarm() : null; return isObj(a) ? a : null; }
    function current(a) { return plan(a, typeof host.names === 'function' ? host.names() : null, manual); }
    function changed() { if (typeof host.changed === 'function') host.changed(); }
    function key() { return typeof host.key === 'function' ? str(host.key()) : ''; }
    function layer(v) { tinted = v !== null && v !== undefined; return typeof host.layer === 'function' ? Promise.resolve(host.layer('band.security', v)).then(null, function () { return null; }) : Promise.resolve(null); }
    function tick() {
      if (!on()) return null;
      var a = alarm(), p = current(a), k = key(), quiet = p.site && a.visible === false;
      if (k !== lastKey) { last = null; lastKey = k; }
      /* a hidden site clock: nothing of it on the iPad (a tint already up comes down once); the GM screen still follows it */
      if (quiet) { if (tinted) layer(null); if (last !== p.index) { last = p.index; changed(); } return p; }
      if (last === null) { last = p.index; if (p.tint !== null || tinted) layer(p.tint); return p; }
      if (p.index === last) { if (!tinted && p.tint !== null) layer(p.tint); return p; }      /* the clock was shown again: the tint goes back up */
      var up = p.index > last; last = p.index;
      layer(p.tint);
      if (up && typeof host.show === 'function') host.show('spotted', { text: p.name }, { ms: SHOW_MS, key: 'b17sec-' + k + '-' + p.index });
      changed();
      return p;
    }
    function step(delta) {
      if (!on()) return false;
      var p = current(alarm()); if (p.site) return false;
      manual = Math.max(0, Math.min(p.n - 1, manual + (delta < 0 ? -1 : 1)));
      tick(); changed(); return true;
    }
    function view() {
      if (!on()) return null;
      var a = alarm(), p = current(a);
      var size = p.site ? Math.min(SEG_MAX, a.size) : 0, filled = p.site ? Math.max(0, Math.min(size, whole(a.filled) ? a.filled : 0)) : 0;
      return { name: p.name, next: p.next, index: p.index, n: p.n, site: p.site, source: p.source, size: size, filled: filled, quiet: !!(p.site && a.visible === false),
        line: 'Security: ' + p.name + ' (' + (p.index + 1) + ' of ' + p.n + ') · next level: ' + (p.next || 'none, this is the top') };
    }
    function reset() { last = null; lastKey = ''; manual = 0; tinted = false; }
    return { tick: tick, view: view, step: step, reset: reset, SHOW_MS: SHOW_MS };
  }

  /* the readout's boxes: a site clock's own segments; by hand, one box for each level above the first, so the lowest level is all empty */
  function segs(v) {
    if (!v) return { n: 0, filled: 0 };
    return v.site ? { n: v.size, filled: v.filled } : { n: Math.max(1, v.n - 1), filled: v.index };
  }
  function readoutHtml(v, o, esc) {
    esc = esc || esc0; o = o || {};
    if (!v) return '';
    var s = segs(v), boxes = '';
    for (var i = 0; i < s.n; i++) boxes += '<i' + (i < s.filled ? ' class="f"' : '') + '></i>';
    var count = v.site ? s.filled + '/' + s.n : (v.index + 1) + ' of ' + v.n;
    var title = (v.site ? (o.clock || 'The alarm clock') + ' ' + s.filled + ' of ' + s.n + ' · ' : 'Set by hand · ') + 'Security: ' + v.name + (v.next ? ' · next level: ' + v.next : ' · the top level') + (v.quiet ? ' · hidden: the iPad does not show it' : '');
    return '<button type="button" class="rv-alarm' + (v.quiet ? ' quiet' : '') + (v.site ? '' : ' hand') + '" ' + (o.attr || 'data-rv="alarm"') + ' aria-haspopup="dialog" aria-expanded="' + !!o.open + '" title="' + esc(title) + '">' +
      '<span class="rv-alabel">' + esc(o.label || 'Alarm') + '</span><span class="rv-segs" aria-hidden="true">' + boxes + '</span><b class="rv-alevel">' + esc(v.name) + '</b><span class="rv-sr"> ' + esc(count) + '</span></button>';
  }
  function popHtml(v, o, esc) {
    esc = esc || esc0; o = o || {};
    if (!v) return '';
    var gm = o.gm ? ' data-gm="site"' : '', h = '<div class="rv-pop rv-alarmpop" role="dialog" aria-label="The alarm">';
    if (v.site) h += '<p class="rv-alarmtext">' + (v.filled > 0 ? '<b>' + esc(o.clock || 'The alarm') + ' ' + v.filled + ':</b> ' + esc(o.beat || '(nothing written for this beat)') : esc(o.clock || 'The alarm') + ' has not started.') + '</p>';
    h += '<p class="rv-secline">Security <b>' + esc(v.name) + '</b> <span class="rv-dim">' + (v.index + 1) + ' of ' + v.n + ' · next level: ' + esc(v.next || 'none, this is the top') + '</span></p>';
    if (v.site) h += '<p class="rv-dim">' + (v.quiet ? 'The clock is hidden from the players, so the iPad shows no security level.' : 'Each level reached shows on the iPad: its name for 3 seconds, then the band.') + ' Spotted ticks the clock.</p>';
    else h += '<p class="rv-secstep"><button type="button" class="rv-btn sm"' + gm + ' data-site="sec-down" aria-label="Security down one level"' + (v.index > 0 ? '' : ' disabled') + '>−</button>' +
      '<button type="button" class="rv-btn sm"' + gm + ' data-site="sec-up" aria-label="Security up one level"' + (v.index + 1 < v.n ? '' : ' disabled') + '>+</button> <span class="rv-dim">' +
      (o.missing ? 'No table clock is called ' + esc(o.missing) + ': step the level by hand.' : 'No site alarm clock: step the level by hand.') + '</span></p>';
    return h + '</div>';
  }

  return { SWITCH: SWITCH, DEFAULT_NAMES: DEFAULT_NAMES, namesFrom: namesFrom, fromPrep: fromPrep, levelCount: levelCount, levelIndex: levelIndex, tintFor: tintFor, plan: plan, create: create,
    segs: segs, readoutHtml: readoutHtml, popHtml: popHtml };
});
