/* display/face-motif.js — a person's motif: three to six seconds of notes made in the browser from the NPC's id and their faction's instrument (suite 3.4, switch face.badge).

   Window.B68FaceMotif, and module.exports under Node. No audio file, no model and no network: plan() is a pure function of (seed, faction slot) and synth() plays that plan with Web Audio.

   plan(seed, slot) -> { voice, root, total, notes: [{ t, d, f, g }] }     the same seed and slot always give the same plan; total (the notes) is 3.0 to 4.8 seconds and the last release adds at most one more, so it is heard for 3 to 6; the first and last note are the root.
   synth(ctx, plan, o) -> { stop(), endsAt }
       ctx: an AudioContext that is running (the caller checked)           o.level  the master level before the duck (default 0.2)
       o.ducked() -> bool   asked every 250 ms while it plays: while true the master is 12 dB down (the speech-safe mix, room.duck), and it comes back when false
       o.later(fn, ms) / o.cancel(handle)   timers (default setTimeout / clearTimeout; a test passes fakes)
   unlock(root) -> bool    make or resume the page's one AudioContext. Call it from a tap: iOS only starts audio inside one.
   play(plan, o) -> bool   false (and silent) when there is no running context: iOS parks it behind the ring/silent switch, after a call or a lock, and this file never fights that.

   THE iOS LIMIT, STATED PLAINLY. room-audio.js records that the iPad's ring/silent switch mutes an AudioContext and that a call parks it. So the motif is a best effort: it plays after the
   first tap where the switch is off silent and the context is running, and otherwise does nothing at all. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68FaceMotif = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var DUCK_GAIN = Math.pow(10, -12 / 20);          /* the same 12 dB as room-audio.js */
  var PENTA = [0, 3, 5, 7, 10, 12, 15];            /* a minor pentatonic, then up a step: seven degrees */
  var ROOTS = [0, 2, 4, 5, 7, 9];                  /* semitones above A, by faction slot 1-6 */
  var VOICES = ['plain', 'brass', 'organ', 'marimba', 'strings', 'bells', 'flute'];   /* by slot 0-6 */
  var OCTAVE = { plain: 220, brass: 110, organ: 110, marimba: 220, strings: 110, bells: 440, flute: 220 };

  function mulberry(a) {
    a = a >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function freq(base, semis) { return base * Math.pow(2, semis / 12); }

  function plan(seed, slot) {
    var s = slot >= 1 && slot <= 6 ? slot : 0, voice = VOICES[s], rnd = mulberry((seed >>> 0) ^ (s * 2654435761));
    var rootSemi = s ? ROOTS[s - 1] : 0, base = OCTAVE[voice], n = 5 + Math.floor(rnd() * 4);
    var total = 3.0 + rnd() * 1.8;                                      /* 3.0 to 4.8 s of notes, then a release of at most one second: heard for 3 to 6 s */
    var w = [], sum = 0, i;
    for (i = 0; i < n; i++) { var x = 0.6 + rnd() * 1.0; if (i === n - 1) x *= 1.6; w.push(x); sum += x; }
    var notes = [], t = 0, deg = 0;
    for (i = 0; i < n; i++) {
      var d = (w[i] / sum) * total;
      if (i > 0 && i < n - 1) { deg = Math.max(0, Math.min(PENTA.length - 1, deg + (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 2)))); }
      else deg = 0;
      notes.push({ t: round(t), d: round(d), f: round(freq(base, rootSemi + PENTA[deg])), g: round(i === n - 1 ? 0.9 : 0.6 + rnd() * 0.3) });
      t += d;
    }
    return { voice: voice, root: rootSemi, total: round(total), notes: notes };
  }
  function round(v) { return Math.round(v * 1000) / 1000; }

  /* one note of a voice: oscillators through an envelope into the master */
  function note(ctx, master, voice, nt, at) {
    var end = at + nt.d + 0.25, g = ctx.createGain(), peak = 0.35 * nt.g, a = 0.02, rel = 0.25, stack = [];
    function osc(type, f, level, detune) {
      var o = ctx.createOscillator(), l = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, at); if (detune) o.detune.setValueAtTime(detune, at);
      l.gain.setValueAtTime(level, at); o.connect(l); l.connect(g); o.start(at); o.stop(end + 0.05); stack.push(o);
    }
    if (voice === 'brass') { a = 0.04; osc('sawtooth', nt.f, 0.5); osc('sawtooth', nt.f * 2, 0.15); }
    else if (voice === 'organ') { a = 0.02; osc('sine', nt.f, 0.5); osc('square', nt.f * 2, 0.12); osc('sine', nt.f * 3, 0.1); }
    else if (voice === 'marimba') { a = 0.005; rel = 0.5; osc('sine', nt.f, 0.6); osc('sine', nt.f * 4, 0.15); }
    else if (voice === 'strings') { a = 0.22; rel = 0.5; osc('sawtooth', nt.f, 0.3, -7); osc('sawtooth', nt.f, 0.3, 7); }
    else if (voice === 'bells') { a = 0.004; rel = 1.0; osc('sine', nt.f, 0.5); osc('sine', nt.f * 2.76, 0.18); osc('sine', nt.f * 5.4, 0.08); }
    else if (voice === 'flute') { a = 0.07; osc('triangle', nt.f, 0.6); osc('sine', nt.f * 2, 0.1); }
    else osc('sine', nt.f, 0.6);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + a);
    g.gain.setValueAtTime(peak, Math.max(at + a, at + nt.d - 0.02));
    g.gain.linearRampToValueAtTime(0.0001, at + nt.d + rel);
    g.connect(master);
    return stack;
  }

  function synth(ctx, p, o) {
    o = o || {};
    var level = typeof o.level === 'number' ? o.level : 0.2, later = o.later || function (f, ms) { return setTimeout(f, ms); }, cancel = o.cancel || function (h) { clearTimeout(h); };
    var master = ctx.createGain(), start = ctx.currentTime + 0.06, stopped = false, timer = null, was = null;
    function ducked() { try { return typeof o.ducked === 'function' && o.ducked() === true; } catch (e) { return false; } }
    function setLevel(now) { var d = ducked(); if (d === was) return; was = d; master.gain.setTargetAtTime(level * (d ? DUCK_GAIN : 1), now, 0.05); }
    master.gain.setValueAtTime(level * (ducked() ? DUCK_GAIN : 1), ctx.currentTime); was = ducked();
    master.connect(ctx.destination);
    p.notes.forEach(function (nt) { note(ctx, master, p.voice, nt, start + nt.t); });
    var endsAt = start + p.total + 1.1;
    function tick() {
      if (stopped) return;
      setLevel(ctx.currentTime);
      if (ctx.currentTime >= endsAt) { stop(); return; }
      timer = later(tick, 250);
    }
    function stop() {
      if (stopped) return; stopped = true; if (timer !== null) cancel(timer);
      try { master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setTargetAtTime(0, ctx.currentTime, 0.03); } catch (e) { /* already gone */ }
      later(function () { try { master.disconnect(); } catch (e) { /* ok */ } }, 200);
    }
    timer = later(tick, 250);
    return { stop: stop, endsAt: endsAt };
  }

  var shared = null;
  function context() {
    if (shared) return shared;
    var AC = root && (root.AudioContext || root.webkitAudioContext);
    if (!AC) return null;
    try { shared = new AC(); } catch (e) { shared = null; }
    return shared;
  }
  function unlock() {
    var c = context(); if (!c) return false;
    try { if (c.state !== 'running' && typeof c.resume === 'function') { var r = c.resume(); if (r && r.then) r.then(null, function () { /* locked: the next tap tries again */ }); } } catch (e) { /* ok */ }
    return c.state === 'running';
  }
  function play(p, o) {
    var c = shared; if (!c || c.state !== 'running' || !p || !p.notes) return false;
    try { synth(c, p, o); return true; } catch (e) { return false; }
  }
  /* a test hands in a fake context */
  function setContext(c) { shared = c; }

  return { plan: plan, synth: synth, unlock: unlock, play: play, setContext: setContext, DUCK_GAIN: DUCK_GAIN, VOICES: VOICES };
});
