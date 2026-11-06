/* gm/music.js — the Music desk: the GM laptop's three playlists that Blade cuts between (M1).

   The room's music plays from the GM LAPTOP to a speaker chosen here (the Bluetooth speaker), never from the iPad (it cannot set a volume, needs a tap,
   and its Bluetooth is busy with the mic). Three playlists: Hanging around (calm), Tension and Action. The tracks are the GM's own files, chosen with
   a picker or dropped on a playlist, and kept in IndexedDB `b68-gm-music` on THIS laptop only: never uploaded, never in the pack, never precached,
   never in git. The choices (the output, the volume, Auto or a held mood) are in localStorage `b68.gm.music` = { sink, vol, auto, mood }. Nothing
   here is stored on the server, so no stored document changes shape.

   It NEVER starts by itself: the first Play is a GM tap (▶, a mood, Auto, or GO on a `music:` cue). After a reload it waits, paused, for a tap.

   Window.B68GmMusic, and module.exports under Node (checks/runtime/music.test.mjs).

   PURE
     MOODS ['calm', 'tension', 'action']        LABEL { calm: 'Hanging around', tension: 'Tension', action: 'Action' }
     moodWord(s) -> 'calm' | 'tension' | 'action' | 'auto' | 'off' | ''      ('hanging around', 'hanging', 'calm' are calm; 'stop' is off)
     moodOf(inputs, memory, now) -> { mood, auto, want, changed, why, manual, memory }    EVERY RULE OF AUTO, with a fake clock in the tests:
       inputs: { phase, alarm: { index, n, filled } | null, chase: bool, desperate: count of Desperate 1–3 marked, manual: a mood word | '' }
       - the Score is Tension; any other phase, or none, is Hanging around (calm)
       - Action, in the Score only, while the site's alarm is at its top two levels or a chase runs, and when the alarm gains a tick (Spotted) or a
         Desperate 1–3 is marked; it holds 90 s after the last of these, then back to Tension
       - stepping up is at once; stepping down waits until 60 s after the last cut
       - a manual mood ('calm' | 'tension' | 'action' | 'off') holds until Auto: the automatic mood is still followed underneath, so Auto takes over at once
     pick(mood, counts) -> the playlist that plays for a mood: itself, else the fallback (action > tension > calm; tension > calm > action; calm > tension > action), else ''
     bagNext(bag, ids, last, rand?) -> { id, bag }    a shuffle bag: no repeat until every track has played, never the same track twice running
     prefsOf(raw) -> { sink, vol (0..100, default 60), auto (default true), mood }       trackOf(meta) -> a clean track | null
     summary(tracks, list) -> { n, ms, text: 'n tracks · m min' }       durText(ms) -> 'm:ss'       isAudio(file) -> bool
     toneWav(secs) -> Uint8Array    a soft chord (the Test with no tracks yet; the tests' tracks)
   memStore() / idbStore(win) -> { list(), get(id), put(id, meta, blob), del(id) }   (all promises; idbStore over database b68-gm-music, or null)
   make(host) -> ctl
     host: { audio() -> an <audio>-like, url(blob), revoke(url), devices() -> Promise<[MediaDeviceInfo-like]>, prefs: { get(), set(v) }, store,
             inputs() -> moodOf's inputs plus { panic: bool, credits: bool }, toast(msg, bad?), confirm(msg) -> bool, now(), root() -> #gm-root,
             storage: navigator.storage-like | null, duration(blob) -> Promise<ms>, every(fn, ms) -> id, stop(id), document }
     ctl.load() -> Promise          ctl.tick()  (the page calls it each second; also every(…) when given)
     ctl.play() ctl.pause() ctl.toggle() ctl.next() ctl.setMode('auto' | mood | 'off') ctl.stop() ctl.setVol(0..100) ctl.cue(word) -> bool
     ctl.add(files, list) -> Promise<n>   ctl.remove(id)   ctl.clear(list)   ctl.tracks() -> [track]   ctl.state() -> { mode, mood, playing, ... }
     ctl.open() ctl.toggleSheet() ctl.render(box)  the Music tool (the library, the output, the storage)
     ctl.mountPill(slot) ctl.paintPill() ctl.popOpen() ctl.closePop()   the band's pill and its popover (B68GmEsc, priority 70)
     ctl.destroy() */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68GmMusic = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var MOODS = ['calm', 'tension', 'action'];
  var LABEL = { calm: 'Hanging around', tension: 'Tension', action: 'Action' };
  var RANK = { calm: 0, tension: 1, action: 2 };
  var FALL = { action: ['action', 'tension', 'calm'], tension: ['tension', 'calm', 'action'], calm: ['calm', 'tension', 'action'] };
  var HOLD_MS = 90000, DWELL_MS = 60000, TRACK_FADE = 2000, CUT_FADE = 4000, PANIC_FADE = 1000, CREDITS_FADE = 2000, START_FADE = 1500, STOP_FADE = 1500,
    PAUSE_FADE = 400, TEST_MS = 3000, STEP_MS = 50;
  var KEY = 'b68.gm.music', DB = 'b68-gm-music', MAX_TRACKS = 300, NAME_MAX = 120;
  var ACCEPT = 'audio/*,.mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.flac';
  var EXT_RE = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------- the pure rules ---------- */
  function moodWord(s) {
    var t = str(s).toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    if (t === 'action') return 'action';
    if (t === 'tension' || t === 'tense') return 'tension';
    if (t === 'calm' || t === 'hanging around' || t === 'hanging' || t === 'hang around') return 'calm';
    if (t === 'auto' || t === 'automatic') return 'auto';
    if (t === 'off' || t === 'stop' || t === 'silence') return 'off';
    return '';
  }
  function cleanMem(m) {
    m = isObj(m) ? m : {};
    return { mood: has(RANK, m.mood) ? m.mood : '', cutAt: num(m.cutAt), trigAt: num(m.trigAt), filled: num(m.filled), desp: num(m.desp), why: str(m.why) };
  }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  var WHY = { score: 'the Score', phase: 'not the Score', alarm: 'the alarm is high', chase: 'a chase is running', spotted: 'Spotted ticked the alarm',
    desperate: 'a Desperate 1–3', hold: 'holding Action for 90 s', dwell: 'waiting 60 s since the last cut' };
  function moodOf(inp, mem, now) {
    inp = isObj(inp) ? inp : {};
    var m = cleanMem(mem), t = num(now) || 0, score = inp.phase === 'score', why = '';
    var al = isObj(inp.alarm) ? inp.alarm : null, filled = al ? num(al.filled) : null, desp = num(inp.desperate);
    if (score) {
      if (filled !== null && m.filled !== null && filled > m.filled) { m.trigAt = t; why = 'spotted'; }
      if (desp !== null && m.desp !== null && desp > m.desp) { m.trigAt = t; why = why || 'desperate'; }
      if (al && num(al.n) > 0 && num(al.index) !== null && al.index >= al.n - 2) { m.trigAt = t; why = why || 'alarm'; }
      if (inp.chase) { m.trigAt = t; why = why || 'chase'; }
    } else m.trigAt = null;
    m.filled = filled; m.desp = desp;
    var act = score && m.trigAt !== null && t - m.trigAt < HOLD_MS;
    var want = !score ? 'calm' : act ? 'action' : 'tension';
    if (act && !why) why = 'hold';
    if (!why) why = score ? 'score' : 'phase';
    var cur = m.mood, changed = false;
    if (!cur) { m.mood = want; m.cutAt = t; changed = true; }
    else if (want !== cur) {
      if (RANK[want] > RANK[cur] || m.cutAt === null || t - m.cutAt >= DWELL_MS) { m.mood = want; m.cutAt = t; changed = true; }
      else why = 'dwell';
    }
    m.why = why;
    var man = moodWord(inp.manual), held = !!man && man !== 'auto';
    return { mood: held ? (man === 'off' ? '' : man) : m.mood, auto: m.mood, want: want, changed: changed, why: why, manual: held, memory: m };
  }
  function pick(mood, counts) {
    var chain = FALL[mood] || [], c = isObj(counts) ? counts : {};
    for (var i = 0; i < chain.length; i++) if (num(c[chain[i]]) > 0) return chain[i];
    return '';
  }
  function shuffle(a, rand) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(clamp(rand(), 0, 0.999999) * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x; }
    return a;
  }
  function bagNext(bag, ids, last, rand) {
    var r = typeof rand === 'function' ? rand : Math.random, all = [], seen = {};
    (Array.isArray(ids) ? ids : []).forEach(function (id) { id = str(id); if (id && !seen[id]) { seen[id] = 1; all.push(id); } });
    if (!all.length) return { id: '', bag: [] };
    var b = (Array.isArray(bag) ? bag : []).filter(function (id) { return seen[id]; });
    if (!b.length || (all.length > 1 && b.every(function (id) { return id === last; }))) b = shuffle(all, r);
    var k = 0;
    if (all.length > 1) { while (k < b.length && b[k] === last) k++; if (k >= b.length) k = 0; }
    var id = b[k]; b.splice(k, 1);
    return { id: id, bag: b };
  }
  function prefsOf(raw) {
    var p = isObj(raw) ? raw : {};
    var vol = num(p.vol), mood = moodWord(p.mood);
    return { sink: str(p.sink).slice(0, 200), vol: vol === null ? 60 : Math.round(clamp(vol, 0, 100)), auto: p.auto !== false,
      mood: mood && mood !== 'auto' ? mood : 'calm' };
  }
  function trackOf(m) {
    if (!isObj(m) || !/^[A-Za-z0-9_-]{1,40}$/.test(str(m.id)) || !has(RANK, m.list)) return null;
    var ms = num(m.ms), size = num(m.size);
    return { id: m.id, list: m.list, name: str(m.name).replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || 'Track', ms: ms !== null && ms > 0 ? Math.round(ms) : 0,
      size: size !== null && size > 0 ? Math.round(size) : 0, at: num(m.at) || 0, bad: m.bad === true };
  }
  function durText(ms) { var s = Math.max(0, Math.round((num(ms) || 0) / 1000)); return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }
  function summary(tracks, list) {
    var ts = (Array.isArray(tracks) ? tracks : []).filter(function (t) { return t && t.list === list; }), ms = 0;
    ts.forEach(function (t) { ms += num(t.ms) || 0; });
    var min = ms > 0 ? Math.max(1, Math.round(ms / 60000)) : 0;
    return { n: ts.length, ms: ms, text: ts.length + (ts.length === 1 ? ' track' : ' tracks') + ' · ' + min + ' min' };
  }
  function isAudio(f) { return !!f && (/^audio\//i.test(str(f.type)) || EXT_RE.test(str(f.name))); }
  function bytesText(n) { n = num(n) || 0; return n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? Math.round(n / 1e6) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : n + ' B'; }

  /* a soft A-major chord with a slow swell, 8 kHz mono 8-bit PCM: the Test before any track is in, and the tests' tracks (no audio file in the repo) */
  function toneWav(secs) {
    var rate = 8000, n = Math.max(1, Math.round(rate * (secs > 0 && secs <= 600 ? secs : 3))), out = new Uint8Array(44 + n), dv = new DataView(out.buffer);
    for (var i = 0; i < n; i++) {
      var t = i / rate, env = Math.min(1, t / 0.3, (n / rate - t) / 0.3) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.25 * t));
      var v = (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.18 * t) + Math.sin(2 * Math.PI * 329.63 * t)) / 3;
      out[44 + i] = clamp(Math.round(128 + 70 * env * v), 0, 255);
    }
    function s4(o, s) { for (var k = 0; k < 4; k++) out[o + k] = s.charCodeAt(k); }
    s4(0, 'RIFF'); dv.setUint32(4, 36 + n, true); s4(8, 'WAVE'); s4(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); s4(36, 'data'); dv.setUint32(40, n, true);
    return out;
  }

  /* ---------- the store: the tracks, on this laptop only ---------- */
  function memStore() {
    var m = {};
    return {
      list: function () { return Promise.resolve(Object.keys(m).map(function (k) { return m[k].meta; })); },
      get: function (id) { return Promise.resolve(m[id] || null); },
      put: function (id, meta, blob) { m[id] = { meta: meta, blob: blob }; return Promise.resolve(true); },
      del: function (id) { delete m[id]; return Promise.resolve(true); }
    };
  }
  function idbStore(win) {
    var idb = win && win.indexedDB; if (!idb) return null;
    var dbp = null;
    function db() {
      if (!dbp) dbp = new Promise(function (res, rej) {
        var rq = idb.open(DB, 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('tracks'); };
        rq.onsuccess = function () { res(rq.result); }; rq.onerror = function () { dbp = null; rej(rq.error); };
      });
      return dbp;
    }
    function tx(mode, fn) { return db().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction('tracks', mode), rq = fn(t.objectStore('tracks')); t.oncomplete = function () { res(rq && rq.result); }; t.onerror = function () { rej(t.error); }; t.onabort = function () { rej(t.error); }; }); }); }
    return {
      list: function () { return tx('readonly', function (s) { return s.getAll(); }).then(function (a) { return (a || []).map(function (r) { return r && r.meta; }); }); },
      get: function (id) { return tx('readonly', function (s) { return s.get(id); }).then(function (r) { return r || null; }); },
      put: function (id, meta, blob) { return tx('readwrite', function (s) { return s.put({ meta: meta, blob: blob }, id); }).then(function () { return true; }); },
      del: function (id) { return tx('readwrite', function (s) { return s.delete(id); }).then(function () { return true; }); }
    };
  }
  function deviceList(raw) {
    var P = W && W.B68GmPractical; if (P && typeof P.deviceList === 'function') return P.deviceList(raw);
    var out = [], n = 0;
    (Array.isArray(raw) ? raw : []).forEach(function (d) {
      if (!isObj(d) || d.kind !== 'audiooutput' || !str(d.deviceId) || d.deviceId === 'default' || d.deviceId === 'communications') return;
      n++; out.push({ id: str(d.deviceId), label: str(d.label).trim().slice(0, 80) || 'Output ' + n });
    });
    return out;
  }

  /* ---------- the controller ---------- */
  function make(host) {
    var h = host || {}, ctl = {}, store = h.store || memStore();
    var prefs = prefsOf(h.prefs && typeof h.prefs.get === 'function' ? h.prefs.get() : null);
    var mode = prefs.auto ? 'auto' : prefs.mood;
    var tracks = [], loaded = false, mem = null, res = null, gateTo = 1, gate = 1, gateRate = 0, playing = false, tapped = false;
    var decks = [deckOf(), deckOf()], cur = 0, bags = { calm: [], tension: [], action: [] }, last = '', list = '', err = '', note = '', outs = [], persisted = null, used = null;
    var loop = null, ticker = null, popOpen = false, slot = null, escOff = null, docOff = null, box = null, alive = true, tester = null, seq = 0, persistAsked = false;

    function now() { return typeof h.now === 'function' ? h.now() : Date.now(); }
    function say(m, bad) { if (typeof h.toast === 'function') h.toast(m, bad); }
    function save() { if (h.prefs && typeof h.prefs.set === 'function') h.prefs.set({ sink: prefs.sink, vol: prefs.vol, auto: mode === 'auto', mood: mode === 'auto' ? prefs.mood : mode }); }
    function deckOf() { return { el: null, url: '', id: '', list: '', level: 0, to: 0, rate: 0, drop: false, holdAt: false, advanced: false }; }
    function counts() { var c = { calm: 0, tension: 0, action: 0 }; tracks.forEach(function (t) { if (!t.bad) c[t.list]++; }); return c; }
    function inputs() { var i = typeof h.inputs === 'function' ? h.inputs() : null; return isObj(i) ? i : {}; }
    function decide() {
      var i = inputs();
      res = moodOf(Object.assign({}, i, { manual: mode === 'auto' ? '' : mode }), mem, now());
      mem = res.memory;
      gateTo = i.panic || i.credits ? 0 : 1;
      var fade = i.panic ? PANIC_FADE : CREDITS_FADE;
      if (gate !== gateTo) { gateRate = 1 / fade; run(); }
      return res;
    }

    /* ---- the decks: two <audio> elements, both on the chosen output, crossfaded by a 50 ms loop ---- */
    function elOf(d) {
      if (d.el) return d.el;
      var a = typeof h.audio === 'function' ? h.audio() : null; if (!a) return null;
      d.el = a; a.preload = 'auto';
      if (typeof a.addEventListener === 'function') {
        a.addEventListener('ended', function () { if (decks[cur] === d && playing && !d.drop) advance(300); });
        a.addEventListener('timeupdate', function () {
          var dur = num(a.duration), t = num(a.currentTime);
          if (decks[cur] !== d || !playing || d.drop || d.advanced || dur === null || t === null || dur < 3 * TRACK_FADE / 1000) return;
          if (dur - t <= TRACK_FADE / 1000) { d.advanced = true; advance(TRACK_FADE); }
        });
        a.addEventListener('error', function () { if (decks[cur] === d && d.id && !d.drop) { markBad(d.id); advance(300); } });
      }
      route(a);
      return a;
    }
    function route(a) {
      if (!a || typeof a.setSinkId !== 'function') return Promise.resolve(false);
      return Promise.resolve().then(function () { return a.setSinkId(prefs.sink || ''); }).then(function () { return true; }, function () {
        if (prefs.sink) { note = 'The chosen speaker is not available: the music plays on this laptop’s default output.'; paintAll(); }
        return false;
      });
    }
    function curve(l) { return Math.sin(clamp(l, 0, 1) * Math.PI / 2); }
    function apply(d) { if (d.el) { try { d.el.volume = clamp(curve(d.level) * gate * prefs.vol / 100, 0, 1); } catch (e) { /* a fake element */ } } }
    function release(d) {
      if (d.el) { try { d.el.pause(); } catch (e) {} try { d.el.removeAttribute ? d.el.removeAttribute('src') : (d.el.src = ''); } catch (e) {} }
      if (d.url && typeof h.revoke === 'function') h.revoke(d.url);
      d.url = ''; d.id = ''; d.list = ''; d.level = 0; d.to = 0; d.drop = false; d.holdAt = false; d.advanced = false;
    }
    function step() {
      var dt = STEP_MS, busy = false;
      if (gate !== gateTo) { gate = gate < gateTo ? Math.min(gateTo, gate + gateRate * dt) : Math.max(gateTo, gate - gateRate * dt); busy = busy || gate !== gateTo; }
      decks.forEach(function (d) {
        if (d.level !== d.to) { d.level = d.level < d.to ? Math.min(d.to, d.level + d.rate * dt) : Math.max(d.to, d.level - d.rate * dt); }
        if (d.level !== d.to) busy = true;
        else if (d.to === 0 && d.el) {
          if (d.drop) release(d);
          else if (d.holdAt && d.el && !d.el.paused) { try { d.el.pause(); } catch (e) {} }
        }
        apply(d);
      });
      if (!busy) halt();
    }
    function run() {
      if (loop !== null) return;
      if (typeof h.every === 'function') loop = h.every(step, STEP_MS);
      else if (W && typeof W.setInterval === 'function') loop = W.setInterval(step, STEP_MS);
      else { loop = -1; step(); loop = null; }
    }
    function halt() { if (loop === null || loop === -1) return; if (typeof h.stop === 'function') h.stop(loop); else if (W && typeof W.clearInterval === 'function') W.clearInterval(loop); loop = null; }
    function fadeTo(d, to, ms) { d.to = to; d.rate = 1 / Math.max(STEP_MS, ms || STEP_MS); run(); }
    function markBad(id) { tracks.forEach(function (t) { if (t.id === id) t.bad = true; }); }
    function idsOf(l) { return tracks.filter(function (t) { return t.list === l && !t.bad; }).map(function (t) { return t.id; }); }

    /* start a track of playlist l on the idle deck, fading in over ms, while the other deck fades out over the same time */
    function start(l, ms) {
      var nx = bagNext(bags[l], idsOf(l), last), id = nx.id; bags[l] = nx.bag;
      if (!id) return Promise.resolve(false);
      var my = ++seq, ni = 1 - cur, d = decks[ni], old = decks[cur];
      return Promise.resolve(store.get(id)).then(function (rec) {
        if (my !== seq || !alive) return false;
        if (!rec || !rec.blob) { markBad(id); return start(l, ms); }
        release(d);
        var a = elOf(d); if (!a) return false;
        d.url = typeof h.url === 'function' ? h.url(rec.blob) : ''; d.id = id; d.list = l; d.level = 0; d.drop = false; d.holdAt = false; d.advanced = false;
        a.src = d.url; apply(d);
        cur = ni; last = id; list = l; err = '';
        if (old.el && old.id) { old.drop = true; fadeTo(old, 0, ms); }
        fadeTo(d, 1, ms);
        return Promise.resolve().then(function () { return route(a); }).then(function () { return playing && my === seq ? a.play() : null; }).then(function () { paintAll(); return true; }, function () {
          if (my !== seq) return false;
          playing = false; err = 'The browser wants a tap first: press ▶ on the music.'; paintAll(); return false;
        });
      });
    }
    function advance(ms) { if (playing && list) start(list, ms); }
    /* where the music should be: the mood's playlist (or its fallback) while playing, nothing otherwise */
    function retarget(ms) {
      var want = playing && res && res.mood ? pick(res.mood, counts()) : '';
      var d = decks[cur];
      if (!want) { if (d.id && !d.drop) { if (!playing) { d.holdAt = true; fadeTo(d, 0, ms || PAUSE_FADE); } else { d.drop = true; fadeTo(d, 0, ms || STOP_FADE); list = ''; } } paintAll(); return; }
      if (d.id && !d.drop && d.list === want) {
        if (d.holdAt || (d.el && d.el.paused)) { d.holdAt = false; fadeTo(d, 1, START_FADE); var p = d.el.play(); if (p && typeof p.catch === 'function') p.catch(function () { playing = false; err = 'The browser wants a tap first: press ▶ on the music.'; paintAll(); }); }
        list = want; paintAll(); return;
      }
      start(want, ms || (d.id && !d.drop ? CUT_FADE : START_FADE));
    }

    ctl.load = function () {
      return Promise.resolve(store.list()).then(function (a) {
        tracks = (a || []).map(trackOf).filter(Boolean).sort(function (x, y) { return x.at - y.at || (x.id < y.id ? -1 : 1); });
        loaded = true; decide(); paintAll(); estimate(); return tracks.length;
      }, function () { loaded = true; err = 'The music library could not be read on this browser.'; paintAll(); return 0; });
    };
    ctl.tick = function () {
      if (!alive) return;
      var before = res ? res.mood : null, r = decide();
      if (playing && (r.mood !== before)) retarget(r.mood && before ? CUT_FADE : STOP_FADE);
      paintPill();
    };
    ctl.play = function () {
      tapped = true;
      if (mode === 'off') { mode = 'auto'; save(); }
      if (!tracks.length) { err = 'No tracks yet: add some in Before > The room > Music.'; paintAll(); return false; }
      playing = true; err = ''; decide(); retarget(START_FADE); return true;
    };
    ctl.pause = function () { playing = false; var d = decks[cur]; if (d.id && !d.drop) { d.holdAt = true; fadeTo(d, 0, PAUSE_FADE); } paintAll(); return true; };
    ctl.toggle = function () { return playing ? ctl.pause() : ctl.play(); };
    ctl.next = function () { if (!playing) return ctl.play(); if (list) start(list, TRACK_FADE); return true; };
    ctl.stop = function () { return ctl.setMode('off'); };
    ctl.setMode = function (m) {
      var w = moodWord(m); if (!w) return false;
      mode = w; if (w !== 'auto' && w !== 'off') prefs.mood = w; save();
      if (w === 'off') { playing = false; var d = decks[cur]; if (d.id) { d.drop = true; fadeTo(d, 0, STOP_FADE); } list = ''; decide(); paintAll(); return true; }
      decide();
      if (!playing) return ctl.play();
      retarget(CUT_FADE); paintAll(); return true;
    };
    /* a `music:` cue (GO) or the voice verb: the same as tapping the mood */
    ctl.cue = function (word) { var w = moodWord(word); if (!w) return false; ctl.setMode(w); return true; };
    ctl.setVol = function (v) { var n = num(+v); if (n === null) return false; prefs.vol = Math.round(clamp(n, 0, 100)); save(); decks.forEach(apply); paintPill(); return true; };
    ctl.setSink = function (id) {
      prefs.sink = str(id); note = ''; save();
      return Promise.all(decks.map(function (d) { return d.el ? route(d.el) : Promise.resolve(true); })).then(function () { paintAll(); return true; });
    };
    ctl.refresh = function () {
      if (typeof h.devices !== 'function') { outs = []; return Promise.resolve(outs); }
      return Promise.resolve().then(function () { return h.devices(); }).then(function (raw) { outs = deviceList(raw); return outs; }, function () { outs = []; return outs; });
    };
    ctl.test = function () {
      if (tester) { try { tester.pause(); } catch (e) {} }
      var a = typeof h.audio === 'function' ? h.audio() : null; if (!a) return Promise.resolve(false);
      tester = a;
      var t = tracks.filter(function (x) { return !x.bad; })[0];
      return Promise.resolve(t ? store.get(t.id) : null).then(function (rec) {
        var blob = rec && rec.blob ? rec.blob : null, url = typeof h.url === 'function' ? h.url(blob || toneWav(3)) : '';
        a.src = url; try { a.volume = clamp(prefs.vol / 100, 0, 1); } catch (e) {}
        return route(a).then(function () { return a.play(); }).then(function () {
          var stop = function () { try { a.pause(); } catch (e) {} if (typeof h.revoke === 'function') h.revoke(url); if (tester === a) tester = null; };
          if (typeof h.later === 'function') h.later(stop, TEST_MS); else if (W && typeof W.setTimeout === 'function') W.setTimeout(stop, TEST_MS);
          return true;
        }, function () { say('The test could not play (the browser may need a tap first).', true); return false; });
      });
    };

    /* ---- the library ---- */
    function persist() {
      var st = h.storage; if (persistAsked || !st) return; persistAsked = true;
      if (typeof st.persist === 'function') Promise.resolve().then(function () { return st.persist(); }).then(function (ok) { persisted = !!ok; paintLib(); }, function () {});
    }
    function estimate() {
      var st = h.storage; if (!st) return;
      if (typeof st.persisted === 'function') Promise.resolve().then(function () { return st.persisted(); }).then(function (ok) { persisted = !!ok; paintLib(); }, function () {});
      if (typeof st.estimate === 'function') Promise.resolve().then(function () { return st.estimate(); }).then(function (e) { used = e && num(e.usage) !== null ? e.usage : null; paintLib(); }, function () {});
    }
    function durOf(file) {
      if (typeof h.duration === 'function') return Promise.resolve().then(function () { return h.duration(file); }).then(function (ms) { return num(ms) || 0; }, function () { return 0; });
      return Promise.resolve(0);
    }
    ctl.tracks = function () { return tracks.slice(); };
    ctl.add = function (files, l) {
      if (!has(RANK, l)) return Promise.resolve(0);
      var fs = Array.prototype.slice.call(files || []).filter(isAudio), n = 0, skipped = (files ? files.length : 0) - fs.length;
      persist();
      return fs.reduce(function (p, f) {
        return p.then(function () {
          if (tracks.length >= MAX_TRACKS) { skipped++; return null; }
          return durOf(f).then(function (ms) {
            var id = 't' + now().toString(36) + (++seq).toString(36) + Math.floor(Math.random() * 1e4).toString(36);
            var meta = trackOf({ id: id, list: l, name: str(f.name).replace(/\.[^.]+$/, ''), ms: ms, size: f.size, at: now() + n });
            return Promise.resolve(store.put(id, meta, f)).then(function () { tracks.push(meta); n++; }, function () { skipped++; });
          });
        });
      }, Promise.resolve()).then(function () {
        if (skipped) say(skipped + (skipped === 1 ? ' file was' : ' files were') + ' not added (not audio, or the browser refused to keep it).', true);
        if (n) say(n + (n === 1 ? ' track' : ' tracks') + ' added to ' + LABEL[l] + '. They stay on this laptop.');
        estimate(); paintAll();
        if (n && playing) retarget();
        return n;
      });
    };
    ctl.remove = function (id) {
      id = str(id);
      return Promise.resolve(store.del(id)).then(function () {
        tracks = tracks.filter(function (t) { return t.id !== id; });
        var d = decks[cur]; if (d.id === id && playing) advance(TRACK_FADE);
        estimate(); paintAll(); return true;
      });
    };
    ctl.clear = function (l) {
      if (!has(RANK, l)) return Promise.resolve(false);
      var ids = tracks.filter(function (t) { return t.list === l; }).map(function (t) { return t.id; });
      if (!ids.length) return Promise.resolve(false);
      if (typeof h.confirm === 'function' && !h.confirm('Remove all ' + ids.length + ' tracks from ' + LABEL[l] + ' on this laptop? The files on disk are not touched.')) return Promise.resolve(false);
      return Promise.all(ids.map(function (id) { return store.del(id); })).then(function () {
        tracks = tracks.filter(function (t) { return t.list !== l; });
        if (list === l && playing) retarget(CUT_FADE);
        estimate(); paintAll(); return true;
      });
    };
    ctl.state = function () {
      var d = decks[cur], t = d.id ? tracks.filter(function (x) { return x.id === d.id; })[0] : null;
      return { mode: mode, mood: res ? res.mood : '', auto: res ? res.auto : '', why: res ? res.why : '', playing: playing, tapped: tapped, list: list, track: t ? t.name : '',
        trackId: d.id, vol: prefs.vol, sink: prefs.sink, gate: gate, ducked: gateTo < 1, counts: counts(), total: tracks.length, loaded: loaded, err: err };
    };

    /* ---- the Music tool (Before > The room, and Find) ---- */
    function libHtml() {
      var st = ctl.state(), c = counts();
      var head = '<p class="gm-dim gm-mu-about">Three playlists on this laptop. On <b>Auto</b> Blade cuts between them: Hanging around outside the Score, Tension in it, ' +
        'Action when the alarm is near the top, a chase runs, Spotted ticks it or a Desperate 1–3 lands. The files stay in this browser and are never uploaded.</p>';
      var lists = MOODS.map(function (l) {
        var ts = tracks.filter(function (t) { return t.list === l; }), sm = summary(tracks, l), on = st.playing && st.list === l;
        var fb = !c[l] && pick(l, c) ? '<p class="gm-dim gm-mu-fb">Empty: ' + esc(LABEL[l]) + ' plays ' + esc(LABEL[pick(l, c)]) + ' instead.</p>' : '';
        return '<section class="gm-mu-list" data-mu-list="' + l + '"' + (on ? ' data-on="true"' : '') + ' aria-label="' + esc(LABEL[l]) + '">' +
          '<header class="gm-mu-lh"><b>' + esc(LABEL[l]) + '</b><span class="gm-mu-sum" data-mu-sum="' + l + '">' + esc(sm.text) + '</span>' + (on ? '<span class="gm-mu-on">● Playing</span>' : '') + '</header>' +
          (ts.length ? '<ol class="gm-mu-tracks">' + ts.map(function (t) {
            var playingNow = on && st.trackId === t.id;
            return '<li' + (playingNow ? ' data-now="true"' : '') + (t.bad ? ' data-bad="true"' : '') + '><span class="gm-mu-tn" title="' + esc(t.name) + '">' + (playingNow ? '♪ ' : '') + esc(t.name) + '</span>' +
              '<span class="gm-mu-td">' + (t.bad ? 'cannot play' : t.ms ? durText(t.ms) : '') + '</span>' +
              '<button type="button" class="gm-mu-x" data-mu-del="' + esc(t.id) + '" aria-label="Remove ' + esc(t.name) + '" title="Remove from this laptop">×</button></li>';
          }).join('') + '</ol>' : '<p class="gm-empty gm-mu-empty">No tracks yet. Add some, or drop audio files here.</p>') + fb +
          '<div class="gm-mu-acts"><label class="btn sm primary gm-mu-add">Add tracks<input type="file" multiple accept="' + ACCEPT + '" data-mu-file="' + l + '" hidden></label>' +
          (ts.length ? '<button type="button" class="btn sm" data-mu-clear="' + l + '">Clear</button>' : '') + '</div></section>';
      }).join('');
      var cur0 = prefs.sink, known = outs.some(function (d) { return d.id === cur0; });
      var out = '<div class="gm-mu-out"><label>Output <select data-mu="sink"><option value="">This laptop’s default output</option>' +
        outs.map(function (d) { return '<option value="' + esc(d.id) + '"' + (d.id === cur0 ? ' selected' : '') + '>' + esc(d.label) + '</option>'; }).join('') +
        (cur0 && !known ? '<option value="' + esc(cur0) + '" selected>The speaker chosen before</option>' : '') + '</select></label>' +
        '<span class="gm-mu-acts"><button type="button" class="btn sm" data-mu="refresh">Find speakers</button>' +
        '<button type="button" class="btn sm primary" data-mu="test" title="Plays 3 s on this output">Test</button></span></div>';
      var sup = decks[0].el || (typeof h.audio === 'function' ? true : false);
      var store0 = '<p class="gm-dim gm-mu-store" data-mu-store>' + (used !== null ? 'Stored in this browser: ' + bytesText(used) + '. ' : '') +
        (persisted === true ? 'The browser keeps them (persistent storage is on).' : persisted === false ? 'The browser may clear them if the disk runs short: keep the originals.' : '') + '</p>';
      return '<div class="gm-mu">' + head + '<div class="gm-mu-lists">' + lists + '</div>' + out + (note ? '<p class="gm-dim" role="status">' + esc(note) + '</p>' : '') + (sup ? '' : '') + store0 + '</div>';
    }
    function paintLib() { if (box && box.isConnected !== false) { box.innerHTML = libHtml(); } }
    function wireLib(sh) {
      if (!sh || sh.__mu) return; sh.__mu = true;
      sh.addEventListener('click', function (ev) {
        var t = ev.target && ev.target.closest ? ev.target.closest('[data-mu],[data-mu-del],[data-mu-clear]') : null; if (!t || t.tagName === 'SELECT') return;
        if (t.hasAttribute('data-mu-del')) ctl.remove(t.getAttribute('data-mu-del'));
        else if (t.hasAttribute('data-mu-clear')) ctl.clear(t.getAttribute('data-mu-clear'));
        else if (t.getAttribute('data-mu') === 'test') ctl.test();
        else if (t.getAttribute('data-mu') === 'refresh') ctl.refresh().then(paintLib);
      });
      sh.addEventListener('change', function (ev) {
        var t = ev.target; if (!t || !t.getAttribute) return;
        if (t.getAttribute('data-mu') === 'sink') { ctl.setSink(t.value); return; }
        var l = t.getAttribute('data-mu-file'); if (!l || !t.files || !t.files.length) return;
        var fs = Array.prototype.slice.call(t.files); t.value = '';
        ctl.add(fs, l);
      });
      sh.addEventListener('dragover', function (ev) { var s = ev.target && ev.target.closest ? ev.target.closest('[data-mu-list]') : null; if (!s) return; ev.preventDefault(); s.setAttribute('data-drop', 'true'); });
      sh.addEventListener('dragleave', function (ev) { var s = ev.target && ev.target.closest ? ev.target.closest('[data-mu-list]') : null; if (s) s.removeAttribute('data-drop'); });
      sh.addEventListener('drop', function (ev) {
        var s = ev.target && ev.target.closest ? ev.target.closest('[data-mu-list]') : null; if (!s) return;
        ev.preventDefault(); s.removeAttribute('data-drop');
        var fs = ev.dataTransfer && ev.dataTransfer.files ? Array.prototype.slice.call(ev.dataTransfer.files) : [];
        if (fs.length) ctl.add(fs, s.getAttribute('data-mu-list'));
      });
    }
    ctl.render = function (b) {
      if (!b) return;
      box = b; paintLib(); wireLib(b.parentNode || b);
      if (!outs.length) ctl.refresh().then(function () { if (box === b) paintLib(); });
    };
    function sheet() { var Wk = W && W.B68GmWorkshop, r = typeof h.root === 'function' ? h.root() : null; return Wk && r ? Wk.sheet(r, 'music', 'Music') : null; }
    ctl.open = function () { var s = sheet(); if (!s) return false; ctl.render(s.body); s.open(); estimate(); return true; };
    ctl.toggleSheet = function () { var s = sheet(); if (s && s.isOpen()) { s.close(); return false; } return ctl.open(); };

    /* ---- the band's pill and its popover ---- */
    function pillText() {
      var st = ctl.state(), m = st.mode === 'off' ? '' : st.mood;
      return { mood: !st.total ? 'Music' : st.mode === 'off' ? 'Off' : (LABEL[m] || 'Off'), auto: st.mode === 'auto', state: st.playing ? 'play' : 'pause' };
    }
    function pillTitle() {
      var st = ctl.state();
      if (!st.total) return 'Music: no tracks yet. Add them in Before > The room > Music.';
      var s = 'Music: ' + (st.mode === 'off' ? 'stopped' : (LABEL[st.mood] || 'off') + (st.mode === 'auto' ? ' (Auto: ' + (WHY[st.why] || '') + ')' : ' (held until Auto)')) +
        (st.playing ? ', playing' + (st.track ? ': ' + st.track : '') : st.tapped ? ', paused' : ', waiting for a tap on ▶') + (st.ducked ? '; faded for the work light or the credits' : '');
      return s;
    }
    function segHtml() {
      var st = ctl.state();
      return '<div class="gm-mu-seg" role="group" aria-label="Mood">' + MOODS.map(function (m) {
        return '<button type="button" data-mu-mode="' + m + '" aria-pressed="' + (st.mode === m) + '"' + (st.mode === 'auto' && st.auto === m && st.mode !== 'off' ? ' data-auto="true"' : '') + '>' + esc(LABEL[m]) + '</button>';
      }).join('') + '<button type="button" data-mu-mode="auto" aria-pressed="' + (st.mode === 'auto') + '" title="Blade cuts between the three by the night">Auto</button>' +
        '<button type="button" data-mu-mode="off" aria-pressed="' + (st.mode === 'off') + '" title="Fade the music out">Stop</button></div>';
    }
    function popHtml() {
      var st = ctl.state();
      var now0 = st.playing && st.track ? '<b>Now playing</b> ' + esc(st.track) + ' <span class="gm-cs-dim">· ' + esc(LABEL[st.list] || '') + (st.list && st.mood && st.list !== st.mood ? ' (for ' + esc(LABEL[st.mood]) + ': its playlist is empty)' : '') + '</span>'
        : !st.total ? 'No tracks yet. Add them in <b>Before › The room › Music</b>.' : st.mode === 'off' ? 'Stopped.' : st.tapped ? 'Paused.' : 'Waiting for a tap on ▶ (the browser plays nothing until you press it).';
      var why = st.mode === 'auto' ? '<span class="gm-cs-dim">Auto: ' + esc(WHY[st.why] || LABEL[st.auto] || '') + '</span>' : st.mode !== 'off' ? '<span class="gm-cs-dim">Held on ' + esc(LABEL[st.mode] || '') + ' until Auto</span>' : '';
      return '<div class="gm-cs-popacts"><button type="button" class="btn sm primary gm-mu-pp" data-mu-act="toggle"' + (st.total ? '' : ' disabled') + '>' + (st.playing ? '❚❚ Pause' : '▶ Play') + '</button>' +
        '<button type="button" class="btn sm" data-mu-act="next"' + (st.total && st.playing ? '' : ' disabled') + '>Next track</button>' + why + '</div>' + segHtml() +
        '<label class="gm-mu-vol">Volume <input type="range" min="0" max="100" step="5" value="' + st.vol + '" data-mu-vol aria-label="Music volume"> <span data-mu-voln>' + st.vol + '</span></label>' +
        '<p class="gm-mu-np" data-mu-np>' + now0 + '</p>' + (st.err ? '<p class="gm-mu-err" role="status">' + esc(st.err) + '</p>' : '') + (st.ducked ? '<p class="gm-cs-dim">Faded down: the work light or the Opening credits are up.</p>' : '') +
        '<div class="gm-cs-popacts"><button type="button" class="btn sm" data-mu-act="library">Library…</button></div>';
    }
    function paintPill() {
      if (!slot) return;
      var b = slot.querySelector('[data-mu-pill]'), p = slot.querySelector('.gm-mu-pop'); if (!b) return;
      var t = pillText(), sig = JSON.stringify([t, pillTitle()]);
      if (b.__sig !== sig) {
        b.__sig = sig;
        b.innerHTML = '<span class="gm-mu-note" aria-hidden="true">♪</span><span class="gm-pill-t">' + esc(t.mood) + '</span>' + (t.auto ? '<i class="gm-mu-a" title="Auto">A</i>' : '') +
          '<span class="gm-mu-st" aria-label="' + (t.state === 'play' ? 'playing' : 'paused') + '">' + (t.state === 'play' ? '▶' : '❚❚') + '</span>';
        b.title = pillTitle();
      }
      var st = ctl.state();
      b.setAttribute('data-state', t.state); b.setAttribute('data-mood', st.mode === 'off' ? 'off' : st.mood || 'off'); b.setAttribute('data-mode', st.mode); b.setAttribute('data-list', st.playing ? st.list : '');
      b.setAttribute('data-gate', st.gate < 0.02 ? 'down' : st.gate > 0.98 ? 'up' : 'fading');
      b.setAttribute('aria-expanded', popOpen ? 'true' : 'false');
      if (p) { if (popOpen) { var hh = popHtml(); if (p.__h !== hh) { var vf = p.querySelector('[data-mu-vol]'), dragging = vf && h.document && h.document.activeElement === vf; if (!dragging) { p.innerHTML = hh; p.__h = hh; } } } p.hidden = !popOpen; }
    }
    function paintAll() { paintPill(); if (box) paintLib(); }
    ctl.paintPill = paintPill;
    ctl.popOpen = function () { popOpen = true; paintPill(); return true; };
    ctl.closePop = function () { popOpen = false; paintPill(); };
    ctl.isPopOpen = function () { return popOpen; };
    ctl.mountPill = function (el) {
      if (!el || !alive) return;
      slot = el;
      el.innerHTML = '<button type="button" class="gm-pill gm-mu-pill" data-mu-pill aria-haspopup="dialog" aria-expanded="false"></button><div class="gm-mu-pop gm-cs-pop" role="dialog" aria-label="Music" hidden></div>';
      el.addEventListener('click', function (ev) {
        var t = ev.target && ev.target.closest ? ev.target.closest('[data-mu-pill],[data-mu-act],[data-mu-mode]') : null; if (!t) return;
        if (t.hasAttribute('data-mu-pill')) { popOpen = !popOpen; paintPill(); return; }
        var a = t.getAttribute('data-mu-act'), m = t.getAttribute('data-mu-mode');
        if (m) ctl.setMode(m);
        else if (a === 'toggle') ctl.toggle();
        else if (a === 'next') ctl.next();
        else if (a === 'library') { popOpen = false; paintPill(); if (typeof h.openLibrary === 'function') h.openLibrary(); else ctl.open(); }
        paintPill();
      });
      el.addEventListener('input', function (ev) {
        var t = ev.target; if (!t || !t.hasAttribute || !t.hasAttribute('data-mu-vol')) return;
        ctl.setVol(t.value); var n = el.querySelector('[data-mu-voln]'); if (n) n.textContent = String(prefs.vol);
      });
      var E = W && W.B68GmEsc;
      if (E && typeof E.register === 'function' && !escOff) escOff = E.register('band.music', { priority: 70, isOpen: function () { return alive && popOpen; }, close: function () { ctl.closePop(); } });
      var doc = h.document || (W && W.document);
      if (doc && !docOff && typeof doc.addEventListener === 'function') {
        var down = function (ev) { if (popOpen && slot && !(ev.target && slot.contains(ev.target))) ctl.closePop(); };
        doc.addEventListener('pointerdown', down, true);
        docOff = function () { doc.removeEventListener('pointerdown', down, true); };
      }
      paintPill();
    };
    ctl.unmountPill = function () { if (escOff) { try { escOff(); } catch (e) {} escOff = null; } if (docOff) { try { docOff(); } catch (e) {} docOff = null; } slot = null; popOpen = false; };

    ctl.start = function () {
      if (ticker !== null) return;
      if (typeof h.every === 'function') ticker = h.every(ctl.tick, 1000);
      else if (W && typeof W.setInterval === 'function') ticker = W.setInterval(ctl.tick, 1000);
    };
    ctl.destroy = function () {
      alive = false; ctl.unmountPill(); halt();
      if (ticker !== null) { if (typeof h.stop === 'function') h.stop(ticker); else if (W && typeof W.clearInterval === 'function') W.clearInterval(ticker); ticker = null; }
      decks.forEach(release); if (tester) { try { tester.pause(); } catch (e) {} }
    };
    ctl._step = step;      /* the tests drive the fade loop with a fake clock */
    decide();
    return ctl;
  }

  /* the browser's own parts, for the page to hand in */
  function browserHost(extra) {
    var w = W || {}, nav = w.navigator;
    return Object.assign({
      audio: function () { return typeof w.Audio === 'function' ? new w.Audio() : null; },
      devices: function () { return nav && nav.mediaDevices && nav.mediaDevices.enumerateDevices ? nav.mediaDevices.enumerateDevices() : Promise.resolve([]); },
      url: function (b) { return w.URL.createObjectURL(b instanceof w.Blob ? b : new w.Blob([b], { type: 'audio/wav' })); },
      revoke: function (u) { try { w.URL.revokeObjectURL(u); } catch (e) {} },
      prefs: { get: function () { try { return JSON.parse(w.localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }, set: function (v) { try { w.localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} } },
      store: idbStore(w) || memStore(),
      storage: nav && nav.storage ? nav.storage : null,
      confirm: function (m) { return typeof w.confirm === 'function' ? w.confirm(m) : true; },
      /* a track's length, from its own metadata (5 s at most; 0 when the browser cannot tell) */
      duration: function (blob) {
        return new Promise(function (res) {
          var a = typeof w.Audio === 'function' ? new w.Audio() : null; if (!a) { res(0); return; }
          var u = w.URL.createObjectURL(blob), done = false;
          function fin(ms) { if (done) return; done = true; try { w.URL.revokeObjectURL(u); } catch (e) {} a.removeAttribute('src'); res(ms); }
          a.preload = 'metadata';
          a.addEventListener('loadedmetadata', function () { fin(isFinite(a.duration) ? a.duration * 1000 : 0); });
          a.addEventListener('error', function () { fin(0); });
          w.setTimeout(function () { fin(0); }, 5000);
          a.src = u;
        });
      },
      document: w.document
    }, extra || {});
  }

  return { MOODS: MOODS, LABEL: LABEL, FALL: FALL, HOLD_MS: HOLD_MS, DWELL_MS: DWELL_MS, TRACK_FADE: TRACK_FADE, CUT_FADE: CUT_FADE, PANIC_FADE: PANIC_FADE, KEY: KEY, DB: DB, ACCEPT: ACCEPT,
    moodWord: moodWord, moodOf: moodOf, pick: pick, bagNext: bagNext, prefsOf: prefsOf, trackOf: trackOf, summary: summary, durText: durText, isAudio: isAudio, toneWav: toneWav,
    memStore: memStore, idbStore: idbStore, deviceList: deviceList, make: make, browserHost: browserHost };
});
