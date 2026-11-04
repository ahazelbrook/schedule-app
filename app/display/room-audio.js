/* display/room-audio.js — the room's sound on the table display: the speech-safe duck (suite 4.4, switch room.duck) and the heat-state music engine (suite 4.3, switch room.music).

   Window.B68RoomAudio, and module.exports under Node. Pure engine plus a thin page hook. Nothing here touches the network, a key or a service: the page hands it
   one HTMLAudioElement (the display's existing theme element, already unlocked by the tap) through the host below, and every rule is testable with a fake host.

   THE iOS LIMIT, STATED PLAINLY. iOS Safari ignores audio.volume, and this app uses no Web Audio on the iPad on purpose (the ring/silent switch mutes an AudioContext and a call
   parks it). So the duck and the flashback muffle only work where the element's volume moves (a PC, Android, the look book). Where it does not, host.setGain returns false, the engine
   reports limited: true, and it does NOT pretend: the music keeps its level and the GM sees "volume locked" in the Preflight text. Nothing is faked with a pause (a pause would
   drop the track). The remedy on the real iPad is the setup note: the speaker points away from the puck, so the room, not the mix, keeps speech clear.

   4.4 THE DUCK. A heard "Blade" (a bare wake word counts: the engine does not wait for the command) lowers the music by 12 dB for 6 seconds; another "Blade" inside the window
   extends it. 12 dB is a gain of about 0.251. The words come from the transcriber's merger (app/stt.js makeMerger, 4th argument), in simulation from a test.
   4.3 THE MUSIC. Five states: ambient, tension, alert, evasion, resolved. stateOf() picks one from the security level (the iPad's band.security, 0 to 4), the crew's heat (0 to 9)
   and wanted (0 to 4), the phase (band.phase 'after' is resolved) and the filter (a flashback muffles). A change lands on the next bar of the current track, using the manifest's
   tempo; a track with no tempo changes at once. The manifest ships with today's single track, one layer per state; stems come later. THE THRESHOLDS ARE A FIRST GUESS FOR ALEX TO TUNE.
   [TODO: Alex sources licensed music stems, not AI-made (D4); the manifest then names one file per state with its bpm.]

   API
     DUCK_DB DUCK_MS MUFFLE STATES DEFAULT_MANIFEST
     gainOf(db) -> linear gain          hearsWake(text) -> bool          stateOf({ security, heat, wanted, phase, filter }) -> state id
     nextBar(nowMs, startMs, { bpm, beatsPerBar }) -> ms of the next bar line at or after now, or null with no tempo
     create(host, opts) -> ctl { hear(text), update(inputs), tick(), report(), destroy() }
       host: { now(), on(id) -> bool, setGain(g) -> bool (false: the volume cannot move), play(state, track, fresh) -> Promise|void, stop(), busy() -> bool (the scene's own music is playing),
               ready() -> bool (the element is unlocked and the file exists) }
       opts: { manifest } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68RoomAudio = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var DUCK_DB = -12, DUCK_MS = 6000, MUFFLE = 0.35;
  var STATES = ['ambient', 'tension', 'alert', 'evasion', 'resolved'];
  /* today's one track, one layer per state; levels differ so the states can be told apart now. bpm null: no tempo known, so a change lands at once. */
  var DEFAULT_MANIFEST = {
    ambient: { src: 'media/theme.mp3', bpm: null, beatsPerBar: 4, level: 0.5 },
    tension: { src: 'media/theme.mp3', bpm: null, beatsPerBar: 4, level: 0.65 },
    alert: { src: 'media/theme.mp3', bpm: null, beatsPerBar: 4, level: 0.8 },
    evasion: { src: 'media/theme.mp3', bpm: null, beatsPerBar: 4, level: 1 },
    resolved: { src: 'media/theme.mp3', bpm: null, beatsPerBar: 4, level: 0.4 }
  };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function gainOf(db) { return Math.pow(10, num(db, 0) / 20); }

  /* "Blade" as a word on its own ("Blade, ..." "hey blade"), not "blades" or "bladerunner" */
  function hearsWake(text) { return typeof text === 'string' && /(^|[^A-Za-z0-9])blade($|[^A-Za-z0-9])/i.test(text); }

  /* the state for what the table says. security: the band.security layer or null; heat 0-9 and wanted 0-4 from the crew; phase 'after' is the Aftermath. */
  function stateOf(i) {
    var o = isObj(i) ? i : {}, sec = typeof o.security === 'number' && isFinite(o.security) ? o.security : null, heat = num(o.heat, 0), wanted = num(o.wanted, 0);
    if (o.phase === 'after') return 'resolved';
    if (sec !== null && sec >= 4) return 'evasion';
    if (wanted >= 3 || heat >= 7 || (sec !== null && sec >= 2)) return 'alert';
    if (wanted >= 1 || heat >= 3 || (sec !== null && sec >= 1)) return 'tension';
    return 'ambient';
  }

  /* the next bar line of a track that began at startMs; null when the track has no tempo */
  function nextBar(nowMs, startMs, t) {
    var bpm = isObj(t) ? num(t.bpm, 0) : 0, per = isObj(t) ? num(t.beatsPerBar, 4) : 4;
    if (!(bpm > 0) || !(per > 0) || !isFinite(nowMs) || !isFinite(startMs)) return null;
    var bar = (60000 / bpm) * per, n = Math.ceil((nowMs - startMs) / bar - 1e-9);
    return startMs + Math.max(0, n) * bar;
  }

  function create(host, opts) {
    var h = host || {}, manifest = isObj(opts && opts.manifest) ? opts.manifest : DEFAULT_MANIFEST;
    var s = { duckUntil: 0, muffled: false, state: null, want: null, landAt: null, startedAt: 0, src: '', limited: false, level: 1, inputs: {} };
    function now() { return typeof h.now === 'function' ? h.now() : Date.now(); }
    function on(id) { return typeof h.on === 'function' && h.on(id) === true; }
    function track(st) { var t = manifest[st]; return isObj(t) && typeof t.src === 'string' && t.src ? t : null; }

    /* the one place the level is worked out: the state's level, times the duck, times the muffle */
    function mix() {
      var t = s.duckUntil > now(), g = (s.state && track(s.state) ? num(track(s.state).level, 1) : 1) * (t && on('room.duck') ? gainOf(DUCK_DB) : 1) * (s.muffled ? MUFFLE : 1);
      s.level = g;
      var moved = typeof h.setGain === 'function' ? h.setGain(Math.max(0, Math.min(1, g))) : false;
      s.limited = moved === false && (g < 1 || t || s.muffled);
      return moved;
    }
    function land(st) {
      var t = track(st); if (!t) return;
      var fresh = t.src !== s.src;
      s.state = st; s.want = null; s.landAt = null;
      if (fresh) { s.src = t.src; s.startedAt = now(); }
      if (typeof h.play === 'function') h.play(st, t, fresh);
      mix();
    }
    function musicOn() { return on('room.music') && !(typeof h.busy === 'function' && h.busy()) && !(typeof h.ready === 'function' && !h.ready()); }

    var ctl = {
      /* 4.4: the words the transcriber heard */
      hear: function (text) {
        if (!on('room.duck') || !hearsWake(text)) return false;
        s.duckUntil = now() + DUCK_MS;
        mix();
        return true;
      },
      /* 4.3: what the table says now (called on every layers apply and every crew change) */
      update: function (inputs) {
        s.inputs = isObj(inputs) ? inputs : {};
        s.muffled = on('room.music') && s.inputs.filter === 'flashback';
        if (!musicOn()) { if (s.state && !on('room.music')) { s.state = null; s.want = null; s.landAt = null; s.src = ''; if (typeof h.stop === 'function') h.stop(); } mix(); return s.state; }
        var st = stateOf(s.inputs);
        if (st === s.state) { s.want = null; s.landAt = null; mix(); return s.state; }
        if (st === s.want) { mix(); return s.state; }
        s.want = st;
        var t = s.state ? track(s.state) : null, at = t ? nextBar(now(), s.startedAt, t) : null;
        if (!s.state || at === null || at <= now()) land(st); else s.landAt = at;       /* the first state starts at once; a change waits for the bar */
        mix();
        return s.state;
      },
      /* once a second: a pending change lands on its bar; the duck lets go */
      tick: function () {
        if (s.want && s.landAt !== null && now() >= s.landAt) land(s.want);
        else mix();
      },
      report: function () { return { state: s.state, want: s.want, landAt: s.landAt, ducked: s.duckUntil > now() && on('room.duck'), muffled: s.muffled, level: s.level, limited: s.limited }; },
      destroy: function () { s.state = null; s.want = null; s.landAt = null; s.duckUntil = 0; s.muffled = false; if (typeof h.setGain === 'function') h.setGain(1); }
    };
    return ctl;
  }

  return { create: create, gainOf: gainOf, hearsWake: hearsWake, stateOf: stateOf, nextBar: nextBar, DUCK_DB: DUCK_DB, DUCK_MS: DUCK_MS, MUFFLE: MUFFLE, STATES: STATES, DEFAULT_MANIFEST: DEFAULT_MANIFEST };
});
