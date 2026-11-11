/* B68Show: the GM's side of the show contract (suite W0.3). Three commands, all through the GM page's own ambient writer (so the gate and the
   hidden-name scan run), and each one idempotent:
     show(kind, payload, { ms, key, auto }) -> Promise     lay a brief beat over the iPad (stamp, spotted, keyturn, rolodex, title, wanted, ring, spotlight)
     layer(path, value) -> Promise                          set one lasting layer (band.phase ... data.previously); value null clears that layer
     clear({ layers: false }) -> Promise                    take the beat off, and (unless layers is false) every layer
   IDEMPOTENCE. A command that comes from something with an id of its own (a cue, a beat of the run sheet) passes it as `key`: the overlay id is a
   hash of the key, so two GM pages that fire the same command send the SAME id, and the server shows it once (the write carries
   `ifNotOverlay`: it lands only while that id is not already running). A layer set to what it already is writes nothing. With no key the id is
   fresh (a random page prefix and a counter), so a button pressed twice shows twice.
   `send` is the page's patchAmbient(patch) -> Promise<answer | null>. Pure parts (check, idFor) are also on the module for node tests.
   The server is the authority: it rebuilds every payload from named keys, drops hidden NPCs and refuses text that names one. This file only
   refuses what the server would refuse, so a bad command fails before it is sent. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68Show = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  var ID = /^[A-Za-z0-9_-]{1,80}$/;
  /* kind -> { ms: default, keys: { name: [type, max|list, required] } }: mirrors functions/_lib/show.js SHOW_KINDS */
  var KINDS = {
    stamp: { ms: 4000, keys: { word: ['s', 24, 1], tone: ['e', ['ink', 'orange', 'blue', 'red']] } },
    spotted: { ms: 4000, keys: { text: ['s', 60], level: ['i', [1, 3]] } },
    keyturn: { ms: 6000, keys: { label: ['s', 60, 1], pc: ['s', 60], to: ['s', 60], crit: ['b'] } },
    title: { ms: 6000, keys: { text: ['s', 80, 1], sub: ['s', 120] } },
    wanted: { ms: 7000, keys: { level: ['i', [0, 4], 1], heat: ['i', [0, 9]], siren: ['b'] } },
    report: { ms: 180000, keys: { position: ['e', ['controlled', 'risky', 'desperate'], 1], effect: ['e', ['limited', 'standard', 'great'], 1], text: ['s', 100] } },
    ring: { ms: 5000, keys: { text: ['s', 60] } },
    rolodex: { ms: 10000, keys: { npcIds: ['l', 12, 1] } },
    spotlight: { ms: 8000, keys: { npcId: ['d', 0, 1] } },
    /* suite 1.6 (functions/_lib/show-aftermath.js): the Aftermath's steps, and the end credits (joined to revealed NPCs) */
    aftermath: { ms: 60000, keys: { step: ['e', ['payout', 'tithe', 'heat', 'status', 'harm', 'unwind', 'xp'], 1], n: ['i', [1, 8]], stacks: ['i', [0, 99]], tithe: ['i', [0, 99]], kept: ['i', [0, 99]],
      exposure: ['i', [0, 6]], mods: ['i', [-6, 6]], heat: ['i', [0, 9]], after: ['i', [0, 9]], siren: ['b'], wanted: ['i', [0, 4]], lines: ['a', 6, 0, 80], who: ['s', 60], line: ['s', 120], secs: ['i', [10, 180]] } },
    credits: { ms: 60000, keys: { npcIds: ['l', 30, 1] } },
    /* suite 5.1 (functions/_lib/show-board.js): the opportunity board, parallel lists of plain strings */
    board: { ms: 180000, keys: { cards: ['a', 12, 1, 120], who: ['a', 12, 1, 40], kinds: ['a', 12, 1, 9], carried: ['a', 12, 1, 1], pick: ['i', [0, 11]] } },
    /* suite 3.8 and 5.4 (functions/_lib/show-castphoto.js): the cast photo (the unmet are silhouette heights) and the lair (the crew's base, as layer strings) */
    castphoto: { ms: 180000, keys: { npcIds: ['l', 30], sil: ['a', 30, 0, 3], title: ['s', 60] } },
    lair: { ms: 180000, keys: { name: ['s', 60, 1], front: ['e', ['canal', 'street']], layers: ['a', 24, 1, 60] } },
    /* suite 2.10 (functions/_lib/show-title.js): the score title card; floors are "x,y,w,d" strings, the building's outside from the ground up */
    scoretitle: { ms: 6000, keys: { text: ['s', 80, 1], sub: ['s', 120], floors: ['a', 6, 0, 15] } }
  };
  /* layer path -> checker(value) -> true when the server would take it */
  var LAYERS = {
    'band.phase': function (v) { return ['pb', 'plan', 'score', 'after'].indexOf(v) >= 0; },
    'band.security': function (v) { return whole(v, 0, 4); },
    'band.faces': function (v) { return Array.isArray(v) && v.length >= 1 && v.length <= 3 && v.every(function (f) { return isObj(f) && ((typeof f.npcId === 'string' && ID.test(f.npcId)) || (typeof f.pcId === 'string' && ID.test(f.pcId) && pcFaceOk(f))); }) && v.filter(function (f) { return f.acting === true; }).length <= 1; },
    'band.onair': function (v) { return v === true; },
    'scene.filter': function (v) { return v === 'flashback'; },
    'scene.layout': function (v) { return v === 'montage'; },
    'scene.mode': function (v) { return v === 'start' || v === 'aftermath'; },
    'data.countdown': function (v) { return isObj(v) && whole(v.to, 1, 8.64e15) && (v.label === undefined || (typeof v.label === 'string' && v.label.trim().length <= 40)); },
    'data.credits': function (v) { return idList(v, 30); },
    'data.previously': function (v) { return idList(v, 12); },
    'data.montage': function (v) { return isObj(v) && Object.keys(v).length === 1 && Array.isArray(v.panels) && v.panels.length >= 2 && v.panels.length <= 4 && v.panels.every(montagePanelOk); }      /* suite 2.8 (functions/_lib/show-montage.js) */
  };
  /* a PC face's optional status (suite 3.7): name (40), stress 0-9, harm as up to four levels 1-4, locks 0-6; acting (KS14.2) a boolean */
  function pcFaceOk(f) {
    return (f.name === undefined || (typeof f.name === 'string' && f.name.trim().length > 0 && f.name.replace(/\s+/g, ' ').trim().length <= 40)) &&
      (f.stress === undefined || whole(f.stress, 0, 9)) && (f.locks === undefined || whole(f.locks, 0, 6)) &&
      (f.harm === undefined || (Array.isArray(f.harm) && f.harm.length <= 4 && f.harm.every(function (h) { return whole(h, 1, 4); }))) &&
      (f.acting === undefined || f.acting === null || typeof f.acting === 'boolean');      /* KS14.2: true on at most one face (the list check) */
  }
  /* a montage panel: a pcId, and optionally name (40), room (60), line (100) as text and done as a boolean */
  function montagePanelOk(p) {
    if (!isObj(p) || typeof p.pcId !== 'string' || !ID.test(p.pcId)) return false;
    if (Object.keys(p).some(function (k) { return ['pcId', 'name', 'room', 'line', 'done'].indexOf(k) < 0; })) return false;
    if (p.done !== undefined && typeof p.done !== 'boolean') return false;
    return [['name', 40], ['room', 60], ['line', 100]].every(function (f) { var v = p[f[0]]; return v === undefined || (typeof v === 'string' && v.replace(/[ \t\r\n]+/g, ' ').trim().length <= f[1]); });
  }
  var MS_MIN = 1000, MS_MAX = 180000;
  function whole(v, lo, hi) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= lo && v <= hi; }
  function idList(v, max) { return Array.isArray(v) && v.length >= 1 && v.length <= max && v.every(function (x) { return typeof x === 'string' && ID.test(x); }); }
  function has(kind) { return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(KINDS, kind); }

  /* check(kind, payload) -> true when the payload has only the kind's keys, in bounds */
  function payloadOk(kind, p) {
    if (!has(kind) || !isObj(p)) return false;
    var spec = KINDS[kind].keys;
    if (Object.keys(p).some(function (k) { return !Object.prototype.hasOwnProperty.call(spec, k); })) return false;
    return Object.keys(spec).every(function (k) {
      var d = spec[k], v = p[k];
      if (v === undefined || v === null) return !d[2];
      if (d[0] === 's') return typeof v === 'string' && v.trim().length > 0 && v.replace(/\s+/g, ' ').trim().length <= d[1];
      if (d[0] === 'e') return d[1].indexOf(v) >= 0;
      if (d[0] === 'i') return whole(v, d[1][0], d[1][1]);
      if (d[0] === 'b') return typeof v === 'boolean';
      if (d[0] === 'd') return typeof v === 'string' && ID.test(v);
      if (d[0] === 'l') return idList(v, d[1]);
      if (d[0] === 'a') return Array.isArray(v) && v.length >= 1 && v.length <= d[1] && v.every(function (x) { return typeof x === 'string' && x.trim().length > 0 && x.replace(/[ \t\r\n]+/g, ' ').trim().length <= d[3]; });
      return false;
    });
  }
  /* the overlay the server takes for a beat, or null */
  function overlayFor(kind, payload, opts) {
    var o = isObj(opts) ? opts : {};
    if (!has(kind) || !payloadOk(kind, payload)) return null;
    var ms = o.ms === undefined ? KINDS[kind].ms : o.ms;
    if (!whole(ms, MS_MIN, MS_MAX)) return null;
    var out = { id: o.id, kind: kind, ms: ms, payload: payload };
    if (o.auto === true) out.auto = true;
    return out;
  }
  /* the words of a beat or a layer value that a reader will see: for the hidden-name scan */
  function texts(kind, payload, path, value) {
    var out = [];
    function add(o) { if (isObj(o)) Object.keys(o).forEach(function (k) { if (typeof o[k] === 'string') out.push(o[k]); else if (Array.isArray(o[k])) o[k].forEach(function (x) { if (typeof x === 'string') out.push(x); }); }); }   /* a list of lines is words too */
    if (has(kind) && payload) add(payload);
    if (path && isObj(value)) add(value);
    return out;
  }

  /* a stable opaque id from a key: two 32-bit FNV-1a hashes (different seeds) in base 36, never built from what the key names */
  function fnv(s, seed) { var h = seed >>> 0; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
  function idFor(key) { var s = String(key); return 'k' + fnv(s, 2166136261).toString(36) + fnv(s, 0x9e3779b9).toString(36); }

  var PREFIX = 's' + Math.random().toString(36).slice(2, 7) + '-', counter = 0;

  function make(o) {
    var send = o && typeof o.send === 'function' ? o.send : null, toast = o && typeof o.toast === 'function' ? o.toast : function () {};
    function refuse(msg) { toast(msg, true); return Promise.resolve(null); }
    return {
      show: function (kind, payload, opts) {
        if (!send) return Promise.resolve(null);
        var key = opts && opts.key !== undefined && opts.key !== null ? String(opts.key) : null;
        var id = key !== null ? idFor(key) : PREFIX + (++counter);
        var ov = overlayFor(kind, payload, { ms: opts && opts.ms, auto: opts && opts.auto, id: id });
        if (!ov) return refuse('That is not a show the iPad can put up.');
        var patch = { overlay: ov };
        if (key !== null) patch.ifNotOverlay = id;
        return send(patch);
      },
      layer: function (path, value) {
        if (!send) return Promise.resolve(null);
        if (!Object.prototype.hasOwnProperty.call(LAYERS, path)) return refuse('That is not a layer the iPad has.');
        if (value !== null && !LAYERS[path](value)) return refuse('That is not a value the ' + path + ' layer can hold.');
        return send({ layer: { path: path, value: value } });
      },
      clear: function (opts) {
        if (!send) return Promise.resolve(null);
        var p = { overlay: null };
        if (!opts || opts.layers !== false) p.layers = null;
        return send(p);
      }
    };
  }
  return { make: make, has: has, ids: function () { return Object.keys(KINDS); }, payloadOk: payloadOk, overlayFor: overlayFor, texts: texts, idFor: idFor, layerOk: function (path, v) { return Object.prototype.hasOwnProperty.call(LAYERS, path) && (v === null || LAYERS[path](v)); }, LAYER_PATHS: Object.keys(LAYERS), KINDS: KINDS };
});
