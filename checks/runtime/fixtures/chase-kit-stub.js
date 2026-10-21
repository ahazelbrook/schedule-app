/* A tiny stand-in for map kit 0.6's chase strip (B68Map.chaseNew / chaseTick / chase / chaseOptions), written from the spec, for the
   checks only (never shipped: checks/ is not in app/). It installs itself only on a kit that has no `chase` of its own, so once the
   real 0.6 kit is vendored the checks run against it unchanged.
   Node: require(this)(B68Map) adds the four functions and returns the kit. Browser: appended to maps/map-kit.js by the e2e check
   (a route), it installs onto window.B68Map.
   The stand-in keeps the spec's secrecy on its player copy (no roll lines unless rolls: true, no gm notes, no hidden clock), so the
   page's own gate is tested on top of a kit that behaves. */
(function (root, factory) {
  var install = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = install;
  else if (root && root.B68Map && typeof root.B68Map.chase !== 'function') install(root.B68Map);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function f1(v) { return String(Math.round(v * 10) / 10); }
  var LAYOUT = { ipad: [1366, 1024], screen: [1920, 1080], phone: [390, 1400], print: [3508, 2480] };
  var GROUND = { corridor: '#8a7f6c', lane: '#6f6656', deck: '#9a948a', open: '#a39a86', hub: '#857a66', covered: '#7d7568', deadend: '#5f574a', waterside: '#4f6670', bridge: '#5a6d78' };
  return function install(K) {
    if (!K || typeof K.chase === 'function') return K;
    K.chaseOptions = function () {
      return { tokens: ['autopod', 'autocycle', 'suv', 'garbage-truck', 'ambulance', 'watch-car', 'barge', 'canoe', 'walker'], states: ['airborne', 'wrecked', 'burning', 'down', 'rammed', 'two-wheels', 'spin', 'chasing', 'half'],
        fx: ['muzzle', 'impact', 'flame-wall', 'nos'], levels: ['above', 'street', 'below'], grounds: Object.keys(GROUND), layouts: Object.keys(LAYOUT) };
    };
    K.chaseNew = function (a) {
      a = a || {};
      var seed = (Math.floor(+a.seed) >>> 0) || 1;
      var c = { schema: 'b68-chase/1', id: 'chase-' + seed.toString(36), name: String(a.name || 'Chase'), district: String(a.district || ''), seed: seed, time: a.time === 'Night' ? 'Night' : 'Bluetime',
        street: clone(a.street || { ground: 'corridor', props: [], nearby: [] }), cast: clone(a.cast || []), clocks: clone(a.clocks || []), panels: [] };
      if (a.weather) c.weather = String(a.weather);
      return c;
    };
    K.chaseTick = function (chase, t) {
      var c = clone(chase), k = c.clocks.filter(function (x) { return x.id === t.clock; })[0];
      if (!k) throw new Error('no clock ' + t.clock);
      var used = c.panels.reduce(function (n, p) { return n + (p.clock === k.id ? p.ticks : 0); }, 0), n = Math.max(0, Math.min(+t.ticks || 1, k.size - used));
      var p = { clock: k.id, ticks: n, level: t.level || 'street', caption: String(t.caption || '') };
      if (t.time) p.time = t.time;
      if (t.roll) p.roll = String(t.roll);
      if (t.between && t.between.length) p.between = t.between.slice();
      p.show = t.show ? clone(t.show) : c.cast.slice(0, 2).map(function (x, i) { return { id: x.id, x: i ? 0.3 : 0.7 }; });
      if (t.fx) p.fx = t.fx.slice();
      c.panels.push(p);
      return c;
    };
    K.chase = function (chase, o) {
      o = o || {};
      var player = o.layer === 'player', rolls = !player || o.rolls === true, wh = LAYOUT[o.layout] || LAYOUT.ipad, W0 = wh[0], H0 = wh[1];
      var clocks = chase.clocks.filter(function (k) { return !(player && k.hidden); });
      var slots = [];
      chase.clocks.filter(function (k) { return k.strip; }).forEach(function (k) {
        var used = 0;
        chase.panels.forEach(function (p, i) { if (p.clock === k.id) { slots.push({ p: p, i: i, w: p.ticks, k: k }); used += p.ticks; } });
        if (!(player && k.hidden)) for (var s = used; s < k.size; s++) slots.push({ empty: s + 1, w: 1, k: k });
      });
      var cols = o.layout === 'phone' ? 1 : 5, sw = (W0 - 40) / cols, sh = Math.min(sw * 0.8, 260), x = 20, y = 150, out = '';
      out += '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W0 + ' ' + H0 + '" width="' + W0 + '" height="' + H0 + '"><rect width="' + W0 + '" height="' + H0 + '" fill="#f1e9d8"/>';
      out += '<text x="20" y="40" font-family="Archivo Compressed, sans-serif" font-size="32" fill="#1b1712">' + esc(chase.name) + '</text>';
      clocks.forEach(function (k, i) {
        var size = k.size, filled = k.strip ? chase.panels.reduce(function (n, p) { return n + (p.clock === k.id ? p.ticks : 0); }, 0) : (+k.filled || 0), cx = 60 + i * 220, cy = 95, r = 26;
        for (var s = 0; s < size; s++) {
          var a0 = s / size * 2 * Math.PI - Math.PI / 2, a1 = (s + 1) / size * 2 * Math.PI - Math.PI / 2;
          out += '<path d="M' + f1(cx) + ' ' + f1(cy) + 'L' + f1(cx + r * Math.cos(a0)) + ' ' + f1(cy + r * Math.sin(a0)) + 'A' + r + ' ' + r + ' 0 0 1 ' + f1(cx + r * Math.cos(a1)) + ' ' + f1(cy + r * Math.sin(a1)) + 'Z" fill="' + (s < filled ? (k.side === 'crew' ? '#c0392b' : '#2c3e50') : '#fff') + '" stroke="#1b1712" stroke-width="2"/>';
        }
        out += '<text x="' + (cx + 34) + '" y="' + (cy + 6) + '" font-family="Archivo Condensed, sans-serif" font-size="18" fill="#1b1712">' + esc(k.name) + (k.hidden ? ' (hidden)' : '') + '</text>';
      });
      slots.forEach(function (s) {
        var w = sw * s.w - 8;
        if (x + w > W0 - 10) { x = 20; y += sh + 70; }
        if (s.empty) out += '<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + f1(w) + '" height="' + f1(sh) + '" fill="none" stroke="#7a705f" stroke-width="2" stroke-dasharray="8 6"/><text x="' + f1(x + w / 2) + '" y="' + f1(y + sh / 2) + '" text-anchor="middle" font-family="Space Mono, monospace" font-size="24" fill="#7a705f">' + s.empty + '</text>';
        else {
          var p = s.p, night = (p.time || chase.time) === 'Night', lv = p.level === 'above' ? 0.2 : p.level === 'below' ? 0.8 : 0.55;
          out += '<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + f1(w) + '" height="' + f1(sh) + '" fill="' + (night ? '#1f2a3a' : '#9fc1d6') + '" stroke="#1b1712" stroke-width="4"/>';
          out += '<rect x="' + f1(x) + '" y="' + f1(y + sh * lv) + '" width="' + f1(w) + '" height="' + f1(sh * 0.12) + '" fill="' + (GROUND[chase.street.ground] || '#8a7f6c') + '"/>';
          (p.show || []).forEach(function (t) { out += '<circle cx="' + f1(x + w * t.x) + '" cy="' + f1(y + sh * lv - 10) + '" r="12" fill="' + (t.id === 'crew' ? '#c0392b' : '#2c3e50') + '"/>'; });
          (p.between || []).forEach(function (b, j) { out += '<text x="' + f1(x + 4) + '" y="' + f1(y - 6 - j * 16) + '" font-family="Space Mono, monospace" font-size="13" fill="#5a5144">' + (j + 1) + '. ' + esc(b) + '</text>'; });
          out += '<text x="' + f1(x) + '" y="' + f1(y + sh + 24) + '" font-family="Archivo Condensed, sans-serif" font-size="20" fill="#1b1712">' + esc(p.caption) + '</text>';
          if (rolls && p.roll) out += '<text x="' + f1(x) + '" y="' + f1(y + sh + 44) + '" font-family="Space Mono, monospace" font-size="14" fill="#5a5144">' + esc(p.roll) + '</text>';
          if (!player && p.gm) out += '<text x="' + f1(x) + '" y="' + f1(y + sh + 60) + '" font-family="Space Mono, monospace" font-size="14" fill="#a33">' + esc(p.gm) + '</text>';
        }
        x += sw * s.w;
      });
      out += '</svg>';
      return { svg: out, width: W0, height: H0, warnings: [], slots: slots.reduce(function (n, s) { return n + s.w; }, 0), drawn: chase.panels.length, viewBox: '0 0 ' + W0 + ' ' + H0 };
    };
    return K;
  };
});
