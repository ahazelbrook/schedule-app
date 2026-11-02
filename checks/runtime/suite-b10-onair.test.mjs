// Suite B10, ticket A6 (ON AIR and "Blade, off the record", switch ai.onair; no browser, no network): the command words, the pause on a fake clock, the lamp, the GM page's mirror,
// stt.js's use of it (a fake mic and socket), and the Worker's status.pausedUntil. INVENTED data only; GM-ONLY- markers for anything that must never appear.
//   node checks/runtime/suite-b10-onair.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MiniEl } from './minidom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const require = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* a document the UMD files can draw into */
function fakeDoc() {
  const d = { hidden: false, listeners: {}, createElement: (t) => { const e = new MiniEl(t); e.ownerDocument = d; e.style = {}; e.addEventListener = (t, fn) => { (e.listeners = e.listeners || {})[t] = [fn]; }; return e; }, createElementNS: (ns, t) => d.createElement(t),
    addEventListener(t, f) { (d.listeners[t] = d.listeners[t] || []).push(f); }, removeEventListener() {} };
  return d;
}
globalThis.self = globalThis;
globalThis.location = { origin: 'http://x.test' };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};

const Air = require(path.join(APP, 'display', 'onair.js'));
const GAir = require(path.join(APP, 'gm', 'onair.js'));
const F = require(path.join(APP, 'features.js'));

/* ================= A6 ON AIR and off the record ================= */
await test('detect: the command words, mishearings pause but only the real wake word resumes', () => {
  assert.equal(Air.detect('Blade, off the record.'), 'off'); assert.equal(Air.detect('okay blades go off the record please'), 'off');
  assert.equal(Air.detect('Blade, back on'), 'on'); assert.equal(Air.detect('Blade, back on the record'), 'on');
  assert.equal(Air.detect('Blaid off the record'), 'off');
  assert.equal(Air.detect('the played back on the record'), null, 'a mishearing never turns the record back on');
  assert.equal(Air.detect('we are off the record on this one'), null, 'needs the wake word');
  assert.equal(Air.detect('blade off the record then blade back on'), 'on', 'the last thing said wins');
});

await test('off the record: lines dropped for 5 minutes, countdown, resumes by itself at 5:00 or on "back on"', () => {
  let t = 1_000;
  const air = Air.make({ now: () => t });
  assert.deepEqual(air.filter('we sat down'), { drop: false, changed: false });
  assert.equal(air.filter('Blade, off the record').drop, true); assert.equal(air.paused(), true);
  assert.equal(air.until(), 1_000 + 300_000); assert.equal(air.remaining(), 300_000);
  t += 120_000; assert.equal(air.filter('GM-ONLY-secret chatter').drop, true, 'kept out while paused'); assert.equal(air.remaining(), 180_000);
  t = 1_000 + 299_999; assert.equal(air.filter('still private').drop, true);
  t = 1_000 + 300_000; assert.deepEqual(air.filter('and we are back'), { drop: false, changed: true }); assert.equal(air.paused(), false);
  air.filter('Blade, off the record'); t += 1000;
  const r = air.filter('Blade, back on'); assert.equal(r.drop, true, 'the command itself is not kept'); assert.equal(air.paused(), false); assert.equal(air.until(), 0);
  assert.equal(air.filter('ordinary talk').drop, false);
  assert.equal(Air.clock(272_000), '4:32');
});

await test('the lamp: ON AIR while the mic is live, OFF THE RECORD with a countdown while paused, gone when the mic is not', () => {
  let t = 0; const doc = fakeDoc(), box = new MiniEl('div'); box.ownerDocument = doc;
  const air = Air.make({ now: () => t });
  air.paint(box, false); assert.equal(box.children.length, 0);
  air.paint(box, true); assert.equal(box.textContent, 'On air'); assert.equal(box.children[0].getAttribute('data-state'), 'on');
  air.filter('Blade, off the record'); t += 28_000; air.paint(box, true);
  assert.equal(box.textContent, 'Off the record 4:32'); assert.equal(box.children[0].getAttribute('data-state'), 'off'); assert.equal(box.children.length, 1);
  air.paint(box, false); assert.equal(box.children.length, 0);
});

await test('the GM page mirrors it: ON AIR only while the report is fresh; the countdown comes from status.pausedUntil', () => {
  const now = Date.parse('2026-11-07T20:00:00.000Z');
  const doc = (o) => ({ want: 'on', status: { state: 'listening', at: new Date(now - 5000).toISOString(), lines: 3, error: '', ...o } });
  assert.deepEqual(GAir.state(doc({ pausedUntil: 0 }), now), { live: true, paused: false, remaining: 0 });
  assert.equal(GAir.word(GAir.state(doc({}), now)), 'ON AIR');
  assert.equal(GAir.word(GAir.state(doc({ pausedUntil: now + 272_000 }), now)), 'Off the record 4:32');
  assert.equal(GAir.word(GAir.state(doc({ pausedUntil: now - 1 }), now)), 'ON AIR', 'a past pause is over');
  assert.equal(GAir.word(GAir.state({ ...doc({}), want: 'off' }, now)), '');
  assert.equal(GAir.word(GAir.state(doc({ at: new Date(now - 60_000).toISOString() }), now)), '', 'a stale report claims nothing');
  assert.equal(GAir.word(GAir.state(doc({ state: 'error' }), now)), '');
  assert.match(GAir.chip(doc({}), now), /ON AIR/); assert.equal(GAir.chip(doc({ state: 'idle' }), now), '');
  assert.match(GAir.suffix(doc({ pausedUntil: now + 60_000 }), now), /Off the record 1:00/);
  const nodes = { '#gm-onair': { textContent: 'x' }, '#gm-bar-air': { textContent: 'y' } };
  const running = GAir.tick({ querySelector: (s) => nodes[s] }, doc({ pausedUntil: now + 3000 }), now);
  assert.equal(running, true); assert.equal(nodes['#gm-onair'].textContent, 'Off the record 0:03');
  assert.equal(GAir.tick({ querySelector: (s) => nodes[s] }, doc({ pausedUntil: 0 }), now), false); assert.equal(nodes['#gm-bar-air'].textContent, 'ON AIR');
});

await test('stt.js: with the switch off nothing differs; on, the command line and everything while paused never reach the transcript, and the report carries pausedUntil', async () => {
  const doc = fakeDoc();
  globalThis.document = doc; Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getAudioTracks: () => [{ addEventListener() {}, readyState: 'live', stop() {} }], getTracks: () => [] }) } } });
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.AudioContext = class { constructor() { this.sampleRate = 16000; this.destination = {}; } createMediaStreamSource() { return { connect() {}, disconnect() {} }; } createScriptProcessor() { return { connect() {}, disconnect() {} }; } resume() { return Promise.resolve(); } close() {} };
  let ws = null;
  globalThis.WebSocket = class { constructor() { ws = this; this.readyState = 1; setTimeout(() => this.onopen && this.onopen(), 0); } send() {} close() {} };
  const Cue = require(path.join(APP, 'cue.js'));
  globalThis.B68Cue = Cue;
  const Stt = require(path.join(APP, 'stt.js'));
  async function run(airOn) {
    const posted = [], reports = [], air = Air.make({ now: () => Date.now() });
    const gm = { stt: async () => ({ doc: { want: 'on', session: '' } }), sttToken: async () => ({ token: 't' }), patchStt: async (p) => { reports.push(p); return {}; }, addTranscript: async (lines) => { lines.forEach((l) => posted.push(l.text)); return {}; } };
    const box = new MiniEl('div'); box.ownerDocument = doc;
    const c = Stt.attach(box, { gm, air: airOn ? () => air : null });
    c.feed({ want: 'on', session: '' });
    for (let i = 0; i < 20 && !ws; i++) await new Promise((r) => setTimeout(r, 20));
    return { c, posted, reports, box, air, say: (text, start) => ws.onmessage({ data: JSON.stringify({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: text, words: text.split(' ').map((w, i) => ({ word: w, start: start + i * 0.3, end: start + i * 0.3 + 0.2, speaker: 0 })) }] } }) }) };
  }
  for (const airOn of [false, true]) {
    ws = null;
    const r = await run(airOn);
    /* start the mic the way a tap does: the tap button's listener */
    const tapBtn = r.box.children[0];
    tapBtn.listeners.click.forEach((fn) => fn({ stopPropagation() {} }));      /* the tap that opens the mic */
    for (let i = 0; i < 40 && !ws; i++) await new Promise((x) => setTimeout(x, 20));
    if (!ws) { r.c.destroy(); throw new Error('the fake mic did not start; the tap handler was not reachable (' + (airOn ? 'on' : 'off') + ')'); }
    await new Promise((x) => setTimeout(x, 30));
    r.say('we sat down at the table', 0); r.say('Blade off the record', 20); r.say('GM-ONLY secret talk while paused', 40); r.say('Blade back on', 60); r.say('and then we carried on', 80);
    r.c.destroy(); await new Promise((x) => setTimeout(x, 50));
    const said = r.posted.join(' | ');
    if (!airOn) { assert.match(said, /Blade off the record/); assert.match(said, /GM-ONLY secret talk/); assert.ok(r.reports.every((p) => !('pausedUntil' in p.status)), 'the report is as it was'); }
    else {
      assert.match(said, /we sat down/); assert.match(said, /carried on/);
      assert.doesNotMatch(said, /off the record|GM-ONLY|back on/i, 'the command and what was said while paused never reached the transcript');
      assert.ok(r.reports.some((p) => 'pausedUntil' in p.status && p.status.pausedUntil > 0), 'a report carried the pause');
    }
  }
});


/* ================= the switch, the wiring, the leaks ================= */
await test('ai.onair is a display switch, default off, Saturday on; the code asks for that id', () => {
  const s = F.get('ai.onair'); assert.ok(s); assert.equal(s.default, false); assert.equal(s.surface, 'display'); assert.equal(s.saturday, 'on'); assert.ok(s.label && s.doc);
  const src = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
  assert.match(src('display-page.js'), /swOn\('ai\.onair'\)/); assert.match(src('gm-page.js'), /valueOf\(S\.doc, 'ai\.onair'\)/);
});
await test('the A6 files are in the right bundles and exist; no campaign names in them', () => {
  const routes = fs.readFileSync(path.join(APP, 'routes.js'), 'utf8');
  const bundle = (n) => (new RegExp('\\b' + n + ': \\[([^\\]]*)\\]').exec(routes) || [])[1] || '';
  for (const f of ['display/onair.js', 'display/onair.css']) { assert.ok(bundle('display').includes("'" + f + "'"), f); assert.ok(!bundle('gm').includes("'" + f + "'"), f + ' not for the GM'); assert.ok(fs.existsSync(path.join(APP, f)), f); }
  assert.ok(bundle('gm').includes("'gm/onair.js'")); assert.ok(!bundle('display').includes("'gm/onair.js'")); assert.ok(fs.existsSync(path.join(APP, 'gm', 'onair.js')));
  for (const f of ['display/onair.js', 'display/onair.css', 'gm/onair.js']) assert.doesNotMatch(fs.readFileSync(path.join(APP, f), 'utf8'), /GM-ONLY|Pelican/, f);
});
await test('the Worker accepts status.pausedUntil only as 0 or a whole number of ms, and only when sent', async () => {
  const { cleanSttPatch, sttSignal } = await import('file:///' + path.join(ROOT, 'functions', '_lib', 'stt.js').replace(/\\/g, '/'));
  const ok = cleanSttPatch({ status: { state: 'listening', lines: 2, pausedUntil: 1234567 } }, 'display');
  assert.equal(ok.status.pausedUntil, 1234567);
  assert.equal('pausedUntil' in cleanSttPatch({ status: { state: 'listening', lines: 2 } }, 'display').status, false, 'absent stays absent');
  for (const bad of [-1, 1.5, '5', null, 9e15]) assert.throws(() => cleanSttPatch({ status: { state: 'listening', pausedUntil: bad } }, 'display'), /pausedUntil/);
  assert.notEqual(sttSignal({ status: { state: 'listening', pausedUntil: 5 } }), sttSignal({ status: { state: 'listening', pausedUntil: 0 } }), 'a GM page hears of a pause');
  assert.equal(sttSignal({ status: { state: 'listening', lines: 1 } }), JSON.stringify([undefined, undefined, undefined, 'listening', 1, undefined]), 'the old signal is unchanged');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
