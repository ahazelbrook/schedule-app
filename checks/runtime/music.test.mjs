// The Music desk (M1; app/gm/music.js): every rule of Auto with a fake clock, the dwell times, the fallback, the shuffle bag, the store on memStore,
// the player on fake <audio> elements (never starts by itself, crossfades, PANIC and the credits fade it, Stop), and the `music:` cue lines.
//   node checks/runtime/music.test.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const M = require('../../app/gm/music.js');
const CS = require('../../app/gm/cue-stack.js');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS ' + name); passed++; } catch (e) { console.log('FAIL ' + name + ': ' + (e && e.stack || e)); failed++; }
}
const S = 1000, MIN = 60000;

await test('moodWord: the three moods, Auto and Stop, in the words a note or a voice uses', () => {
  assert.equal(M.moodWord('Action'), 'action');
  assert.equal(M.moodWord(' tension '), 'tension');
  assert.equal(M.moodWord('hanging around'), 'calm');
  assert.equal(M.moodWord('Hanging Around.'), 'calm');
  assert.equal(M.moodWord('calm'), 'calm');
  assert.equal(M.moodWord('auto'), 'auto');
  assert.equal(M.moodWord('off'), 'off');
  assert.equal(M.moodWord('stop'), 'off');
  assert.equal(M.moodWord('loud'), '');
  assert.equal(M.moodWord(null), '');
});

await test('moodOf: the Score is Tension; any other phase, or none, is Hanging around', () => {
  assert.equal(M.moodOf({ phase: 'score' }, null, 0).mood, 'tension');
  for (const p of ['before', 'opening', 'pb', 'plan', 'after', '', undefined]) assert.equal(M.moodOf({ phase: p }, null, 0).mood, 'calm', String(p));
});

await test('moodOf: Action only in the Score: the alarm at its top two levels, a chase, Spotted ticking the alarm, a Desperate 1–3', () => {
  const al = (index, n, filled) => ({ index, n, filled });
  /* the alarm's top two levels (5 levels: 3 and 4); level 2 is not */
  assert.equal(M.moodOf({ phase: 'score', alarm: al(3, 5, 7) }, null, 0).mood, 'action');
  assert.equal(M.moodOf({ phase: 'score', alarm: al(4, 5, 9) }, null, 0).mood, 'action');
  assert.equal(M.moodOf({ phase: 'score', alarm: al(2, 5, 5) }, null, 0).mood, 'tension');
  assert.equal(M.moodOf({ phase: 'score', alarm: al(2, 4, 5) }, null, 0).mood, 'action', '4 levels: the top two are 2 and 3');
  /* outside the Score none of them is Action */
  assert.equal(M.moodOf({ phase: 'plan', alarm: al(4, 5, 9), chase: true }, null, 0).mood, 'calm');
  /* a chase */
  const c = M.moodOf({ phase: 'score', chase: true }, null, 0);
  assert.equal(c.mood, 'action'); assert.equal(c.why, 'chase');
  /* Spotted: the alarm gains a tick (the first reading is never a tick) */
  let r = M.moodOf({ phase: 'score', alarm: al(0, 5, 1) }, null, 0);
  assert.equal(r.mood, 'tension');
  r = M.moodOf({ phase: 'score', alarm: al(0, 5, 2) }, r.memory, 5 * S);
  assert.equal(r.mood, 'action'); assert.equal(r.why, 'spotted');
  /* a Desperate 1–3: the page's count goes up */
  r = M.moodOf({ phase: 'score', desperate: 0 }, null, 0);
  assert.equal(r.mood, 'tension');
  r = M.moodOf({ phase: 'score', desperate: 1 }, r.memory, 2 * S);
  assert.equal(r.mood, 'action'); assert.equal(r.why, 'desperate');
  /* ticks counted while not in the Score do not fire on entering it */
  r = M.moodOf({ phase: 'plan', alarm: al(0, 5, 1), desperate: 2 }, null, 0);
  r = M.moodOf({ phase: 'plan', alarm: al(0, 5, 2), desperate: 3 }, r.memory, S);
  r = M.moodOf({ phase: 'score', alarm: al(0, 5, 2), desperate: 3 }, r.memory, 2 * S);
  assert.equal(r.mood, 'tension');
});

await test('moodOf: Action holds 90 s after the last trigger, then back to Tension', () => {
  let r = M.moodOf({ phase: 'score', desperate: 0 }, null, 0);
  r = M.moodOf({ phase: 'score', desperate: 1 }, r.memory, 10 * S);
  assert.equal(r.mood, 'action');
  r = M.moodOf({ phase: 'score', desperate: 1 }, r.memory, 99 * S);
  assert.equal(r.mood, 'action'); assert.equal(r.why, 'hold');
  /* a second trigger restarts the 90 s */
  r = M.moodOf({ phase: 'score', desperate: 2 }, r.memory, 60 * S);
  r = M.moodOf({ phase: 'score', desperate: 2 }, r.memory, 149 * S);
  assert.equal(r.mood, 'action');
  r = M.moodOf({ phase: 'score', desperate: 2 }, r.memory, 151 * S);
  assert.equal(r.mood, 'tension');
  /* a chase holds Action while it runs, and 90 s after it ends */
  r = M.moodOf({ phase: 'score', chase: true }, null, 0);
  r = M.moodOf({ phase: 'score', chase: true }, r.memory, 300 * S);
  assert.equal(r.mood, 'action');
  r = M.moodOf({ phase: 'score', chase: false }, r.memory, 389 * S);
  assert.equal(r.mood, 'action');
  r = M.moodOf({ phase: 'score', chase: false }, r.memory, 391 * S);
  assert.equal(r.mood, 'tension');
});

await test('moodOf: stepping up is at once; stepping down waits until 60 s after the last cut', () => {
  let r = M.moodOf({ phase: 'plan' }, null, 0);
  assert.equal(r.mood, 'calm');
  r = M.moodOf({ phase: 'score' }, r.memory, 10 * S);           /* up: at once */
  assert.equal(r.mood, 'tension'); assert.ok(r.changed);
  r = M.moodOf({ phase: 'after' }, r.memory, 30 * S);           /* down, 20 s after the cut: waits */
  assert.equal(r.mood, 'tension'); assert.equal(r.want, 'calm'); assert.equal(r.why, 'dwell'); assert.ok(!r.changed);
  r = M.moodOf({ phase: 'after' }, r.memory, 69 * S);
  assert.equal(r.mood, 'tension');
  r = M.moodOf({ phase: 'after' }, r.memory, 70 * S);           /* 60 s after the cut */
  assert.equal(r.mood, 'calm'); assert.ok(r.changed);
  /* Action's end is a step down too: a chase that starts and ends at once still plays Action for 90 s (more than 60 s), then Tension */
  r = M.moodOf({ phase: 'score' }, null, 0);
  r = M.moodOf({ phase: 'score', chase: true }, r.memory, 100 * S);
  assert.equal(r.mood, 'action');
  r = M.moodOf({ phase: 'score', chase: false }, r.memory, 191 * S);
  assert.equal(r.mood, 'tension');
  /* no flapping: Action -> Tension at 191 s, a new trigger at 200 s steps up at once, and the next step down still waits 60 s after THAT cut */
  r = M.moodOf({ phase: 'score', chase: true }, r.memory, 200 * S);
  assert.equal(r.mood, 'action');
  r = M.moodOf({ phase: 'after', chase: false }, r.memory, 230 * S);
  assert.equal(r.mood, 'action', 'the Aftermath 30 s after the cut waits');
  r = M.moodOf({ phase: 'after' }, r.memory, 260 * S);
  assert.equal(r.mood, 'calm');
});

await test('moodOf: a manual mood holds until Auto; Auto takes over at once with the mood the night has reached; off is silence', () => {
  let r = M.moodOf({ phase: 'plan', manual: 'action' }, null, 0);
  assert.equal(r.mood, 'action'); assert.ok(r.manual); assert.equal(r.auto, 'calm');
  r = M.moodOf({ phase: 'score', manual: 'action' }, r.memory, 5 * S);
  assert.equal(r.mood, 'action'); assert.equal(r.auto, 'tension');
  r = M.moodOf({ phase: 'score', manual: '' }, r.memory, 6 * S);
  assert.equal(r.mood, 'tension'); assert.ok(!r.manual);
  r = M.moodOf({ phase: 'score', manual: 'off' }, r.memory, 7 * S);
  assert.equal(r.mood, '');
  r = M.moodOf({ phase: 'score', manual: 'auto' }, r.memory, 8 * S);
  assert.equal(r.mood, 'tension');
});

await test('pick: an empty playlist falls back (action > tension > calm); nothing at all is silence', () => {
  assert.equal(M.pick('action', { calm: 1, tension: 1, action: 1 }), 'action');
  assert.equal(M.pick('action', { calm: 1, tension: 1, action: 0 }), 'tension');
  assert.equal(M.pick('action', { calm: 1 }), 'calm');
  assert.equal(M.pick('tension', { calm: 2 }), 'calm');
  assert.equal(M.pick('tension', { action: 2 }), 'action');
  assert.equal(M.pick('calm', { tension: 2, action: 1 }), 'tension');
  assert.equal(M.pick('calm', {}), '');
  assert.equal(M.pick('', { calm: 1 }), '');
});

await test('bagNext: every track once before any repeats, and never the same track twice running', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  let seed = 7; const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  let bag = [], last = '', seen = [], prev = '';
  for (let round = 0; round < 40; round++) {
    const r = M.bagNext(bag, ids, last, rand); bag = r.bag;
    assert.notEqual(r.id, prev, 'never twice running (round ' + round + ')');
    seen.push(r.id); prev = r.id; last = r.id;
    if (seen.length === ids.length) { assert.deepEqual([...seen].sort(), ids, 'each round plays every track once'); seen = []; }
  }
  /* one track: it repeats (there is nothing else); none: nothing */
  assert.equal(M.bagNext([], ['x'], 'x').id, 'x');
  assert.equal(M.bagNext([], [], '').id, '');
  /* a bag holding only the last track refills rather than repeat it */
  for (let i = 0; i < 20; i++) assert.notEqual(M.bagNext(['a'], ['a', 'b'], 'a', Math.random).id, 'a');
  /* a removed track leaves the bag */
  assert.equal(M.bagNext(['gone', 'b'], ['b', 'c'], '').id, 'b');
});

await test('prefsOf / trackOf / summary / durText / isAudio / toneWav', () => {
  assert.deepEqual(M.prefsOf(null), { sink: '', vol: 60, auto: true, mood: 'calm' });
  assert.deepEqual(M.prefsOf({ sink: 'bt-1', vol: 140, auto: false, mood: 'action' }), { sink: 'bt-1', vol: 100, auto: false, mood: 'action' });
  assert.equal(M.prefsOf({ mood: 'auto' }).mood, 'calm');
  assert.equal(M.trackOf({ id: 'bad id!', list: 'calm' }), null);
  assert.equal(M.trackOf({ id: 'a1', list: 'loud' }), null);
  assert.deepEqual(M.trackOf({ id: 'a1', list: 'tension', name: '  Slow   burn ', ms: 61234.4, size: 1000 }), { id: 'a1', list: 'tension', name: 'Slow burn', ms: 61234, size: 1000, at: 0, bad: false });
  const ts = [{ list: 'calm', ms: 3 * MIN }, { list: 'calm', ms: 4.4 * MIN }, { list: 'action', ms: 20000 }];
  assert.equal(M.summary(ts, 'calm').text, '2 tracks · 7 min');
  assert.equal(M.summary(ts, 'action').text, '1 track · 1 min');
  assert.equal(M.summary(ts, 'tension').text, '0 tracks · 0 min');
  assert.equal(M.durText(185000), '3:05');
  assert.ok(M.isAudio({ name: 'a.mp3', type: '' }) && M.isAudio({ name: 'x', type: 'audio/flac' }) && M.isAudio({ name: 'b.M4A' }));
  assert.ok(!M.isAudio({ name: 'notes.txt', type: 'text/plain' }));
  const w = M.toneWav(2);
  assert.equal(String.fromCharCode(...w.slice(0, 4)), 'RIFF'); assert.equal(w.length, 44 + 16000);
});

await test('memStore: put, list, get and delete', async () => {
  const st = M.memStore();
  await st.put('a', { id: 'a', list: 'calm' }, 'BLOB');
  assert.deepEqual(await st.list(), [{ id: 'a', list: 'calm' }]);
  assert.equal((await st.get('a')).blob, 'BLOB');
  await st.del('a');
  assert.deepEqual(await st.list(), []);
  assert.equal(await st.get('a'), null);
});

/* ---------- the controller on fake <audio> elements and a fake clock ---------- */
function rig(o = {}) {
  const els = [], loops = new Map(); let clock = 0, nid = 0, saved = o.prefs || null, said = [];
  const inputs = { phase: 'before', ...(o.inputs || {}) };
  const host = {
    audio() {
      const ls = {};
      const a = { src: '', volume: 1, paused: true, sink: null, currentTime: 0, duration: NaN,
        play() { a.paused = false; return Promise.resolve(); }, pause() { a.paused = true; },
        addEventListener(t, fn) { (ls[t] = ls[t] || []).push(fn); }, fire(t) { (ls[t] || []).forEach((f) => f()); },
        setSinkId(id) { a.sink = id; return Promise.resolve(); }, removeAttribute(k) { if (k === 'src') a.src = ''; } };
      els.push(a); return a;
    },
    url: (b) => 'blob:' + String(b), revoke() {}, devices: () => Promise.resolve([{ kind: 'audiooutput', deviceId: 'default', label: 'Default' }, { kind: 'audiooutput', deviceId: 'bt', label: 'Speaker' }]),
    prefs: { get: () => saved, set: (v) => { saved = v; } }, store: o.store || M.memStore(), inputs: () => inputs,
    toast: (m, bad) => said.push([m, !!bad]), confirm: () => o.confirm !== false, now: () => clock,
    every: (fn, ms) => { const id = ++nid; loops.set(id, fn); return id; }, stop: (id) => loops.delete(id), later: () => 0,
    duration: () => Promise.resolve(4 * MIN)
  };
  const ctl = M.make(host);
  const flush = () => new Promise((r) => setTimeout(r, 0));
  /* run the fade loop for ms of fake time */
  const run = async (ms) => { for (let t = 0; t < ms; t += 50) { clock += 50; ctl._step(); } await flush(); };
  return { ctl, host, els, inputs, said, flush, run, saved: () => saved, tick: async () => { ctl.tick(); await flush(); await flush(); }, at: (t) => { clock = t; } };
}
const file = (name, type = 'audio/wav') => ({ name, type, size: 1234 });
const live = (r) => r.els.filter((a) => !a.paused && a.src);

await test('the player never starts by itself: after load it waits, paused; the first Play is a tap', async () => {
  const r = rig({ prefs: { sink: 'bt', vol: 50, auto: true, mood: 'calm' } });
  await r.ctl.add([file('one.wav'), file('two.wav')], 'calm');
  await r.ctl.load(); await r.tick();
  assert.equal(r.ctl.state().playing, false); assert.equal(live(r).length, 0);
  assert.equal(r.ctl.state().total, 2);
  r.ctl.play(); await r.flush(); await r.flush();
  assert.equal(r.ctl.state().playing, true);
  assert.equal(live(r).length, 1, 'one deck plays');
  assert.equal(live(r)[0].sink, 'bt', 'on the chosen output');
  await r.run(1600);
  assert.ok(Math.abs(live(r)[0].volume - 0.5) < 0.01, 'faded in to the master volume: ' + live(r)[0].volume);
  /* reload: a new controller over the same store and prefs waits again */
  const r2 = rig({ store: r.host.store, prefs: r.saved() });
  await r2.ctl.load(); await r2.tick();
  assert.equal(r2.ctl.state().playing, false); assert.equal(r2.ctl.state().total, 2); assert.equal(live(r2).length, 0);
});

await test('the player: a phase change crossfades to Tension; a manual mood holds; Auto takes back over; Stop fades out', async () => {
  const r = rig();
  await r.ctl.add([file('c1.wav'), file('c2.wav')], 'calm');
  await r.ctl.add([file('t1.wav')], 'tension');
  await r.ctl.add([file('a1.wav')], 'action');
  await r.ctl.load();
  r.ctl.play(); await r.flush(); await r.flush(); await r.run(2000);
  assert.equal(r.ctl.state().list, 'calm');
  r.inputs.phase = 'score'; await r.tick();
  assert.equal(r.ctl.state().list, 'tension');
  assert.equal(r.ctl.state().track, 't1');
  assert.equal(live(r).length, 2, 'both decks play during the 4 s crossfade');
  await r.run(4100);
  assert.equal(live(r).length, 1, 'the old deck stops once faded');
  /* a manual mood */
  r.ctl.setMode('action'); await r.flush(); await r.flush();
  assert.equal(r.ctl.state().list, 'action'); assert.equal(r.ctl.state().mode, 'action');
  assert.deepEqual(r.saved(), { sink: '', vol: 60, auto: false, mood: 'action' });
  r.inputs.phase = 'plan'; await r.tick();
  assert.equal(r.ctl.state().list, 'action', 'a manual mood holds through a phase change');
  r.ctl.setMode('auto'); await r.flush(); await r.flush();
  assert.equal(r.ctl.state().mode, 'auto');
  /* the auto mood: the score's Tension (the step down to calm at plan waits 60 s after the last cut) */
  assert.equal(r.ctl.state().list, 'tension');
  await r.run(4100);
  r.ctl.stop(); await r.run(1600);
  assert.equal(r.ctl.state().playing, false); assert.equal(r.ctl.state().mode, 'off');
  assert.equal(live(r).length, 0, 'Stop fades to silence');
});

await test('the player: an empty playlist falls back; nothing at all says where to add tracks', async () => {
  const r = rig({ inputs: { phase: 'score', chase: true } });
  await r.ctl.add([file('t1.wav')], 'tension');
  await r.ctl.load(); r.ctl.play(); await r.flush(); await r.flush();
  assert.equal(r.ctl.state().mood, 'action'); assert.equal(r.ctl.state().list, 'tension');
  const e = rig(); await e.ctl.load();
  assert.equal(e.ctl.play(), false);
  assert.match(e.ctl.state().err, /Before > The room > Music/);
});

await test('the player: PANIC fades it to silence in 1 s and Resume brings it back; the Opening credits fade it down too', async () => {
  const r = rig();
  await r.ctl.add([file('c1.wav')], 'calm');
  await r.ctl.load(); r.ctl.play(); await r.flush(); await r.flush(); await r.run(1600);
  const a = live(r)[0]; assert.ok(a.volume > 0.5);
  r.inputs.panic = true; await r.tick(); await r.run(1000);
  assert.equal(a.volume, 0, 'silent 1 s after PANIC'); assert.ok(r.ctl.state().ducked);
  assert.ok(!a.paused, 'it keeps its place under the work light');
  r.inputs.panic = false; await r.tick(); await r.run(2100);
  assert.ok(Math.abs(a.volume - 0.6) < 0.01, 'Resume brings it back: ' + a.volume);
  r.inputs.credits = true; await r.tick(); await r.run(2100);
  assert.equal(a.volume, 0, 'down under the credits');
  r.inputs.credits = false; await r.tick(); await r.run(2100);
  assert.ok(a.volume > 0.5);
});

await test('IP5.1 creditsWatch: the duck lasts while the credits RUN (90 s, credits.js T.end), not while they stay pinned', () => {
  assert.equal(M.CREDITS_RUN_MS, 90 * S, 'the scene’s own length');
  const run = readFileSync(new URL('../../tools/ambient/scenes/credits.js', import.meta.url), 'utf8').match(/\bend:\s*(\d+(?:\.\d+)?)\s*\}/);
  assert.ok(run && Number(run[1]) * S === M.CREDITS_RUN_MS, 'CREDITS_RUN_MS equals credits.js T.end (' + (run && run[1]) + ' s)');
  const w = M.creditsWatch(), T0 = 1_000_000;
  w.see(false, T0, true);
  assert.equal(w.duck(T0), false, 'nothing pinned: no duck');
  w.see(true, T0 + 5 * S, false);      /* the pin arrives while the page watches: the run starts now */
  assert.equal(w.duck(T0 + 5 * S), true); assert.equal(w.duck(T0 + 94 * S), true, '89 s in: still down'); assert.equal(w.left(T0 + 35 * S), 60 * S, '60 s left');
  assert.equal(w.duck(T0 + 95 * S), false, 'the run is over: the gate opens though the pin stays');
  w.see(true, T0 + 10 * MIN, false); assert.equal(w.duck(T0 + 10 * MIN), false, 'pinned for 10 minutes: still open');
  w.see(false, T0 + 11 * MIN, false); w.see(true, T0 + 12 * MIN, false);
  assert.equal(w.duck(T0 + 12 * MIN + 30 * S), true, 'pinned again (a replay): down again');
  w.over(); assert.equal(w.duck(T0 + 12 * MIN + 31 * S), false, 'the GM’s "the credits are over": open at once');
  w.see(true, T0 + 12 * MIN + 32 * S, false); assert.equal(w.duck(T0 + 12 * MIN + 32 * S), false, 'and stays open while the same pin holds');
  /* a reload with the credits already pinned: the first read never ducks (the document cannot say when they were pinned) */
  const r1 = M.creditsWatch(); r1.see(true, T0, true);
  assert.equal(r1.duck(T0), false, 'pinned before the page loaded: the music plays'); assert.equal(r1.left(T0), 0);
  r1.see(true, T0 + 5 * S, false); assert.equal(r1.duck(T0 + 5 * S), false, 'and keeps playing while that pin holds');
  r1.see(false, T0 + 60 * S, false); r1.see(true, T0 + 70 * S, false);
  assert.equal(r1.duck(T0 + 71 * S), true, 'a pin this page then sees arrive ducks');
});

await test('IP5.1 the player: pinned credits for 10 minutes: down for the run, then back by itself; Bring the music back; a replay ducks again', async () => {
  const w = M.creditsWatch(); let pinned = false, done = 0;
  const r = rig();
  r.host.inputs = () => { w.see(pinned, r.host.now(), false); return { ...r.inputs, credits: w.duck(r.host.now()) }; };
  r.host.creditsDone = () => { done++; w.over(); };
  await r.ctl.add([file('c1.wav')], 'calm');
  await r.ctl.load(); r.ctl.play(); await r.flush(); await r.flush(); await r.run(1600);
  const a = live(r)[0]; assert.ok(a.volume > 0.5);
  pinned = true; await r.tick(); await r.run(2100);
  assert.equal(a.volume, 0, 'down under the credits'); assert.equal(r.ctl.state().duck, 'credits', 'the state says why');
  await r.run(85 * S); await r.tick(); await r.run(500);
  assert.equal(a.volume, 0, 'still down 88 s in');
  await r.run(3 * S); await r.tick(); await r.run(2100);
  assert.ok(Math.abs(a.volume - 0.6) < 0.01, 'back by itself after the run, with the scene still pinned: ' + a.volume);
  assert.equal(r.ctl.state().duck, ''); assert.equal(r.ctl.state().playing, true); assert.equal(r.ctl.state().list, 'calm', 'the mood plays');
  for (let i = 0; i < 10; i++) { await r.run(50 * S); await r.tick(); }
  assert.ok(a.volume > 0.5, 'still up 10 minutes later, still pinned');
  assert.equal(r.ctl.creditsBack(), false, 'Bring the music back does nothing when nothing is ducked');
  /* a replay: pinned again */
  pinned = false; await r.tick(); pinned = true; await r.tick(); await r.run(2100);
  assert.equal(a.volume, 0, 'a replay ducks again');
  assert.equal(r.ctl.creditsBack(), true); await r.run(2100);
  assert.equal(done, 1, 'through the host, so the page knows'); assert.ok(a.volume > 0.5, 'Bring the music back: up at once');
  await r.tick(); await r.run(500); assert.ok(a.volume > 0.5, 'and it stays up while the same pin holds');
  /* PANIC is not the credits: Bring the music back leaves the work light alone */
  r.inputs.panic = true; await r.tick(); await r.run(1000);
  assert.equal(r.ctl.state().duck, 'panic'); assert.equal(r.ctl.creditsBack(), false); assert.equal(a.volume, 0);
  r.inputs.panic = false; await r.tick(); await r.run(2100);
  /* a host with no creditsDone: the controller holds it itself until the credits flag drops */
  const q = rig({ inputs: { credits: true } });
  await q.ctl.add([file('c1.wav')], 'calm');
  await q.ctl.load(); q.ctl.play(); await q.flush(); await q.flush(); await q.run(2100);
  const b = live(q)[0]; assert.equal(b.volume, 0);
  assert.equal(q.ctl.creditsBack(), true); await q.run(2100); assert.ok(b.volume > 0.5);
  await q.tick(); await q.run(500); assert.ok(b.volume > 0.5, 'held');
  q.inputs.credits = false; await q.tick(); q.inputs.credits = true; await q.tick(); await q.run(2100);
  assert.equal(b.volume, 0, 'the next run ducks again');
});

await test('the player: a track that ends goes to the next in the same mood; Next track; pause keeps the place', async () => {
  const r = rig();
  await r.ctl.add([file('c1.wav'), file('c2.wav'), file('c3.wav')], 'calm');
  await r.ctl.load(); r.ctl.play(); await r.flush(); await r.flush(); await r.run(1600);
  const first = r.ctl.state().trackId, a = live(r)[0];
  a.fire('ended'); await r.flush(); await r.flush();
  assert.notEqual(r.ctl.state().trackId, first); assert.equal(r.ctl.state().list, 'calm');
  const second = r.ctl.state().trackId;
  r.ctl.next(); await r.flush(); await r.flush();
  assert.notEqual(r.ctl.state().trackId, second);
  await r.run(2100);
  const b = live(r)[0];
  r.ctl.toggle(); await r.run(500);      /* the popover's ▶/❚❚ */
  assert.ok(b.paused && b.src, 'paused, the track still loaded'); assert.equal(r.ctl.state().playing, false);
  r.ctl.toggle(); await r.flush(); await r.run(1600);
  assert.ok(!b.paused && b.volume > 0.5, 'the same element plays on'); assert.equal(r.ctl.state().playing, true);
  assert.equal(typeof r.ctl.toggleSheet, 'function', 'the sheet has its own toggle (it must never shadow ▶/❚❚)');
});

await test('the library: add (audio only), remove, clear asks first; the volume and the output are remembered', async () => {
  const r = rig({ confirm: false });
  const n = await r.ctl.add([file('x.mp3', 'audio/mpeg'), file('notes.txt', 'text/plain')], 'tension');
  assert.equal(n, 1); assert.ok(r.said.some(([m, bad]) => bad && /not added/.test(m)));
  const t = r.ctl.tracks()[0]; assert.equal(t.name, 'x'); assert.equal(t.ms, 4 * MIN); assert.equal(t.list, 'tension');
  assert.equal(await r.ctl.clear('tension'), false, 'a No keeps them');
  assert.equal(r.ctl.tracks().length, 1);
  await r.ctl.remove(t.id); assert.equal(r.ctl.tracks().length, 0);
  assert.deepEqual(await r.host.store.list(), []);
  r.ctl.setVol(35); await r.ctl.setSink('bt');
  assert.equal(r.saved().vol, 35); assert.equal(r.saved().sink, 'bt');
  const outs = await r.ctl.refresh(); assert.deepEqual(outs, [{ id: 'bt', label: 'Speaker' }]);
});

await test('folders: a folder name picks its playlist, loosely; hidden files are dropped; the order is the path order', () => {
  assert.equal(M.folderMood('Hanging around'), 'calm'); assert.equal(M.folderMood('01 - Lounging'), 'calm'); assert.equal(M.folderMood('calm'), 'calm');
  assert.equal(M.folderMood('Tension'), 'tension'); assert.equal(M.folderMood('tense_stuff'), 'tension');
  assert.equal(M.folderMood('Blades 68 - Action'), 'action'); assert.equal(M.folderMood('Chase'), 'action');
  assert.equal(M.folderMood('Music'), ''); assert.equal(M.folderMood('Exchange'), ''); assert.equal(M.folderMood('Attention'), '');
  const f = (p, type = 'audio/mpeg', size = 1000) => ({ name: p.split('/').pop(), webkitRelativePath: p, type, size });
  const got = M.folderFiles([f('B/10 x.mp3'), f('B/.DS_Store', ''), f('B/._2 y.mp3'), f('B/2 y.mp3'), f('B/.hidden/z.mp3')]).map((x) => x.webkitRelativePath);
  assert.deepEqual(got, ['B/2 y.mp3', 'B/10 x.mp3']);
  const g = M.byFolder([f('Music/Hanging around/a.mp3'), f('Music/Tension/b.mp3'), f('Music/Tension/sub/c.mp3'), f('Music/Action/d.mp3'), f('Music/loose.mp3'),
    { name: 'e.mp3', b68Path: 'Tension/e.mp3', type: 'audio/mpeg', size: 9 }, f('Action/cover.jpg', 'image/jpeg')]);
  assert.deepEqual([g.calm.length, g.tension.length, g.action.length, g.none.length], [1, 3, 2, 1]);
  assert.equal(M.byFolder([f('Tension/x.mp3')]).tension.length, 1, 'the picked folder itself can name the playlist');
});

await test('the library: a folder adds its audio only, a second add of the same folder skips what is there, and all three fill from one folder', async () => {
  const r = rig();
  const f = (p, type = 'audio/mpeg', size = 1000) => ({ name: p.split('/').pop(), webkitRelativePath: p, type, size });
  const n = await r.ctl.add([f('T/one.mp3'), f('T/two.mp3'), f('T/cover.jpg', 'image/jpeg'), f('T/._one.mp3')], 'tension', { folder: true });
  assert.equal(n, 2);
  assert.ok(r.said.some(([m, bad]) => !bad && /2 tracks added to Tension/.test(m) && /1 file is not audio/.test(m)), JSON.stringify(r.said));
  assert.equal(await r.ctl.add([f('T/one.mp3'), f('T/two.mp3'), f('T/three.mp3')], 'tension', { folder: true }), 1, 'only the new one');
  assert.ok(r.said.some(([m]) => /2 were already there/.test(m)));
  assert.equal(await r.ctl.add([f('T/one.mp3')], 'calm', { folder: true }), 1, 'the same file may sit in another playlist');
  assert.equal(await r.ctl.add([f('E/notes.txt', 'text/plain')], 'calm', { folder: true }), 0);
  assert.ok(r.said.some(([m, bad]) => bad && /No audio files in that folder/.test(m)));
  const all = await r.ctl.addAll([f('M/Hanging around/h1.mp3'), f('M/Tension/t9.mp3'), f('M/Action/a1.mp3'), f('M/Action/a2.mp3'), f('M/stray.mp3')]);
  assert.equal(all, 4);
  const c = (l) => r.ctl.tracks().filter((t) => t.list === l).length;
  assert.deepEqual([c('calm'), c('tension'), c('action')], [2, 4, 2]);
  assert.ok(r.said.some(([m]) => /Added: Hanging around 1, Tension 1, Action 2/.test(m)), JSON.stringify(r.said.slice(-3)));
  assert.ok(r.said.some(([m, bad]) => bad && /1 track was left out/.test(m)));
  assert.equal(await r.ctl.addAll([f('M/Other/x.mp3')]), 0);
  assert.ok(r.said.some(([m, bad]) => bad && /No audio in a folder named/.test(m)));
  assert.equal(await r.ctl.addAll([f('M/Hanging around/h1.mp3')]), 0, 'adding the same folder again adds nothing');
});

await test('folders: the parent folder picked on one playlist fills all three; exact names beat loose ones; .m3u is not a track; overlapping adds do not duplicate; one toast says it all', async () => {
  const f = (p, type = 'audio/mpeg', size = 1000) => ({ name: p.split('/').pop(), webkitRelativePath: p, type, size });
  const r = rig();
  assert.equal(await r.ctl.add([f('B/Hanging around/h.mp3'), f('B/Tension/t.mp3'), f('B/list.m3u', 'audio/x-mpegurl')], 'calm', { folder: true }), 2);
  const c = (l) => r.ctl.tracks().filter((t) => t.list === l).length;
  assert.deepEqual([c('calm'), c('tension')], [1, 1], 'each to its own, not all into Hanging around');
  assert.equal(await r.ctl.add([f('T/a.mp3'), f('T/b.m3u', 'audio/x-mpegurl')], 'action', { folder: true }), 1, 'a playlist file is not a track');
  const o = rig();
  assert.equal(await o.ctl.add([f('OST/CD1/01.mp3'), f('OST/CD1/02.mp3'), f('OST/Ambient Works/a.mp3'), f('OST/Fight Scene/b.mp3')], 'tension', { folder: true }), 4);
  assert.equal(o.ctl.tracks().filter((t) => t.list === 'tension').length, 4, 'an album with loosely named subfolders stays in the playlist chosen');
  const g = M.byFolder([f('M/Tension/Lounge Lizards OST/x.mp3'), f('M/Hanging around/Chase the Sun/y.mp3'), f('Action scores/z.mp3'), f('M/Suspense/s.mp3')]);
  assert.deepEqual([g.calm.length, g.tension.length, g.action.length, g.none.length], [1, 2, 0, 1]);
  const q = rig();
  const [n1, n2] = await Promise.all([q.ctl.add([f('T/a.mp3'), f('T/b.mp3')], 'tension', { folder: true }), q.ctl.add([f('T/a.mp3'), f('T/b.mp3')], 'tension', { folder: true })]);
  assert.equal(n1 + n2, 2); assert.equal(q.ctl.tracks().length, 2, 'two at once still adds each file once');
  const s = rig();
  await s.ctl.addAll([f('M/Action/a.mp3'), f('M/stray.mp3')]);
  const last = s.said[s.said.length - 1];
  assert.ok(last[1] && /1 track added to Action/.test(last[0]) && /1 track was left out/.test(last[0]), 'the last toast carries both, in red: ' + JSON.stringify(last));
});

await test('cue lines: music: action | tension | calm | hanging around | auto | off, and a bad word is skipped', () => {
  const p = CS.parse('## Cues\n\n1. music: action\n2. music: Hanging around\n3. music: calm\n4. music: auto\n5. music: off\n6. music: tension\n7. music: louder\n');
  assert.deepEqual(p.cues.map((c) => [c.n, c.kind, c.arg, c.text]), [[1, 'music', 'action', 'Action'], [2, 'music', 'calm', 'Hanging around'], [3, 'music', 'calm', 'Hanging around'],
    [4, 'music', 'auto', 'Auto'], [5, 'music', 'off', 'Off'], [6, 'music', 'tension', 'Tension']]);
  assert.deepEqual(p.skipped, ['7. music: louder']);
  assert.ok(CS.KINDS.includes('music'));
});

await test('cue GO: a music cue calls the host with the mood and fails softly without one', async () => {
  const note = { id: 'n1', blocks: [{ k: 'md', src: '## Cues\n\n1. music: action\n2. music: off\n' }] };
  let doc = {}; const heard = [];
  const mk = (music) => CS.create({ feature: () => true, note: () => note, doc: () => doc, patch: (p) => { doc = { ...doc, ...p }; return true; }, now: () => Date.now(), toast() {}, log() {},
    scene: () => Promise.resolve(true), show: () => Promise.resolve({}), reveal: () => Promise.resolve({ ok: true }), phase: () => Promise.resolve(true), ambient: () => null,
    panic: () => Promise.resolve(), resume: () => Promise.resolve(), cueSlot: () => null, music, setTimeout: (f) => f() });
  const cs = mk((w) => { heard.push(w); return Promise.resolve(true); });
  const r = await cs.go('button');
  assert.ok(r.ok, JSON.stringify(r)); assert.deepEqual(heard, ['action']);
  doc = {};
  const none = mk(undefined);
  const r2 = await none.go('button');
  assert.equal(r2.ok, false);
});

await test('the iPad view’s Music setting says it is the iPad’s own sound and points to the laptop’s playlists', () => {
  const src = readFileSync(new URL('../../app/gm/settings.js', import.meta.url), 'utf8');
  const line = src.split(/\r?\n/).filter((l) => l.includes("key: 'room.music'"))[0] || '';
  assert.match(line, /The iPad’s own sound/); assert.match(line, /Before > The room > Music/);
});

console.log((failed ? failed + ' FAILED' : 'ALL PASSED') + ' (' + passed + ' passed)');
process.exit(failed ? 1 : 0);
