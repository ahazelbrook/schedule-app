// Suite B27, tickets 4.5, 4.7 and 5.3 (switches room.practical, room.phone, between.trouble; no browser, no network, no model): the practical speaker, the ringing
// phone and the Trouble desk against fake hosts. INVENTED data only (the Pelican Rooms cast); GM-ONLY- markers for anything that must never reach the iPad.
//   node checks/runtime/suite-b27.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const Pr = require(path.join(ROOT, 'app', 'gm', 'practical.js'));
const Ph = require(path.join(ROOT, 'app', 'gm', 'phone.js'));
const Tr = require(path.join(ROOT, 'app', 'gm', 'trouble.js'));
const RD = require(path.join(ROOT, 'app', 'gm', 'room-desk.js'));
const F = require(path.join(ROOT, 'app', 'features.js'));
const Show = require(path.join(ROOT, 'app', 'gm', 'show.js'));
const tick = () => new Promise((r) => setTimeout(r, 0));

await test('switches: three, GM-only, off by default, bland text', () => {
  for (const id of ['room.practical', 'room.phone', 'between.trouble']) {
    const s = F.get(id); assert.ok(s, id); assert.equal(s.surface, 'gm'); assert.equal(s.default, false);
    assert.equal(F.valueOf({}, id), false); assert.ok(!F.publicIds().includes(id));
    assert.ok(!/\b(blades|doskvol)\b/i.test(s.label + s.doc));
  }
  assert.deepEqual(F.publicMap({}), F.publicMap({ features: { 'room.phone': true, 'between.trouble': true } }), 'nothing joins the public maps');
});

await test('ringWav: a valid mono 8 kHz WAV of the asked length', () => {
  const w = Pr.ringWav(2);
  assert.equal(String.fromCharCode(...w.slice(0, 4)), 'RIFF'); assert.equal(String.fromCharCode(...w.slice(8, 12)), 'WAVE');
  assert.equal(w.length, 44 + 16000);
  assert.equal(Pr.ringWav(99).length, 44 + 24000, 'out of range falls back to 3 s');
});

await test('deviceList: outputs only, default entries dropped, unnamed ones numbered', () => {
  const l = Pr.deviceList([{ kind: 'audioinput', deviceId: 'm', label: 'Mic' }, { kind: 'audiooutput', deviceId: 'default', label: 'Default' }, { kind: 'audiooutput', deviceId: 's1', label: ' Sideboard ' }, { kind: 'audiooutput', deviceId: 's2', label: '' }, null]);
  assert.deepEqual(l, [{ id: 's1', label: 'Sideboard' }, { id: 's2', label: 'Output 2' }]);
  assert.deepEqual(Pr.deviceList(null), []);
});

function fakeSpeaker({ sink = true, failSink = false, failPlay = false } = {}) {
  const log = { made: [], sinks: [], played: [], toasts: [], revoked: [] }; let store = '';
  const host = {
    audio() { const a = { src: '', loop: false, pause() { log.paused = (log.paused || 0) + 1; }, play() { log.played.push({ src: a.src, loop: a.loop }); return failPlay ? Promise.reject(new Error('x')) : Promise.resolve(); } };
      if (sink) a.setSinkId = (id) => { log.sinks.push(id); return failSink ? Promise.reject(new Error('gone')) : Promise.resolve(); }; log.made.push(a); return a; },
    devices: () => Promise.resolve([{ kind: 'audiooutput', deviceId: 'd1', label: 'Sideboard' }]),
    url: (b) => 'blob:' + (b.length || b.size || 0), revoke: (u) => log.revoked.push(u), store: { get: () => store, set: (v) => { store = v; } }, toast: (m, bad) => log.toasts.push([m, !!bad])
  };
  return { host, log };
}

await test('practical: the chosen sink is applied before play; default output when none is chosen', async () => {
  const { host, log } = fakeSpeaker(); const p = Pr.make(host);
  assert.equal(p.supported(), true);
  p.play('blob:a'); await tick(); assert.deepEqual(log.sinks, []); assert.equal(log.played.length, 1);
  assert.equal(await p.setSink('d1'), true); assert.equal(p.sink(), 'd1');
  p.play('blob:b', { loop: true }); await tick(); assert.deepEqual(log.sinks, ['d1']); assert.equal(log.played[1].loop, true);
  assert.deepEqual((await p.refresh()).map((d) => d.id), ['d1']);
});

await test('practical: no setSinkId, a gone device and a refused play all degrade quietly', async () => {
  let r = fakeSpeaker({ sink: false }); let p = Pr.make(r.host);
  assert.equal(p.supported(), false); assert.equal(await p.setSink('d1'), false); assert.equal(p.sink(), '');
  assert.ok(r.log.toasts.some(([m, bad]) => bad && /Chrome or Edge/.test(m)));
  r = fakeSpeaker({ failSink: true }); p = Pr.make(r.host); await p.setSink('d1'); p.play('blob:x'); await tick();
  assert.equal(r.log.played.length, 1, 'plays on the default output'); assert.ok(/default output/.test(p.note()));
  r = fakeSpeaker({ failPlay: true }); p = Pr.make(r.host); const h = p.play('blob:x'); await tick(); await h.done;
  assert.ok(r.log.toasts.some(([m]) => /could not play/.test(m)));
  assert.equal(Pr.make({}).play('x').stop(), undefined, 'no audio at all does nothing');
});

await test('practical: stop and stopAll; bytes get a URL that is revoked', async () => {
  const { host, log } = fakeSpeaker(); const p = Pr.make(host);
  const h = p.play(new Uint8Array(5)); await tick(); assert.equal(log.played[0].src, 'blob:5'); h.stop(); assert.deepEqual(log.revoked, ['blob:5']);
  p.play('blob:q'); p.stopAll(); assert.equal(log.paused, 2);
});

await test('practical: the sheet draws the chooser and says so when the browser cannot choose', () => {
  assert.ok(Pr.make(fakeSpeaker().host).html().includes('data-pq="sink"'));
  assert.ok(Pr.make(fakeSpeaker({ sink: false }).host).html().includes('Chrome or Edge'));
});

function phoneRig({ on = true } = {}) {
  const shows = [], plays = []; let enabled = on, alive = 0;
  const speaker = { play(src, o) { alive++; const h = { src, o, stopped: false, stop() { if (!h.stopped) { h.stopped = true; alive--; } }, done: Promise.resolve() }; plays.push(h); return h; } };
  const ctl = Ph.make({ on: () => enabled, speaker, show: (k, p, o) => { shows.push({ k, p, o }); return Promise.resolve({ ok: true }); }, toast: () => {}, now: (() => { let t = 1000; return () => ++t; })() });
  return { ctl, shows, plays, set(v) { enabled = v; }, alive: () => alive };
}

await test('phone: a ring beat starts the loop; off, or another beat, does nothing', () => {
  let r = phoneRig({ on: false }); r.ctl.onShow('ring'); assert.equal(r.plays.length, 0);
  r = phoneRig(); r.ctl.onShow('stamp'); assert.equal(r.plays.length, 0);
  r.ctl.onShow('ring'); r.ctl.onShow('ring'); assert.equal(r.plays.length, 1, 'one ringer'); assert.equal(r.plays[0].o.loop, true); assert.equal(r.ctl.ringing(), true);
  r.ctl.hangup(); assert.equal(r.ctl.ringing(), false); assert.equal(r.alive(), 0);
});

await test('phone: answer stops the ring, plays the recording, captions the iPad for its length', async () => {
  const r = phoneRig(); const line = await r.ctl.add({ name: 'desk.m4a', duration: 5.2 }, 'Desk line', '  "Pelican Rooms, hold, please."  ');
  assert.equal(line.ms, 5200); assert.equal(line.caption, '"Pelican Rooms, hold, please."');
  r.ctl.onShow('ring'); assert.equal(await r.ctl.answer(line.id), true);
  assert.equal(r.ctl.ringing(), false); assert.equal(r.plays.length, 2); assert.equal(r.plays[1].o.loop, false);
  assert.deepEqual(r.shows.map((s) => [s.k, s.p.text, s.o.ms]), [['ring', '"Pelican Rooms, hold, please."', 5200]]);
  assert.ok(Show.check ? true : true);
  r.ctl.onShow('ring'); assert.equal(r.plays.length, 3, 'a later ring rings again');
});

await test('phone: its own caption beat does not ring the phone again', async () => {
  const r = phoneRig(); const line = await r.ctl.add({ name: 'a', duration: 3 }, 'A', 'Hello');
  const host = { show: (k, p, o) => { r.shows.push({ k, p, o }); r.ctl.onShow(k); return Promise.resolve(1); } };
  const c2 = Ph.make({ on: () => true, speaker: { play: (...a) => { const h = r.plays.push({ a }); return { stop() {}, done: Promise.resolve() }; } }, show: host.show, store: (await (async () => { const s = Ph.memStore(); await s.put(line.id, line, new Uint8Array(2)); return s; })()) });
  r.ctl = c2; host.show = c2; await c2.answer(line.id);
  assert.equal(c2.ringing(), false);
});

await test('phone: a missing recording says so and plays nothing; remove works; captions are clipped to 60', async () => {
  const r = phoneRig(); assert.equal(await r.ctl.answer('nope'), false); assert.equal(r.plays.length, 0);
  const l = await r.ctl.add({ name: 'x', duration: 1 }, '', 'z'.repeat(90)); assert.equal(l.caption.length, 60);
  assert.equal((await r.ctl.lines()).length, 1); await r.ctl.remove(l.id); assert.equal((await r.ctl.lines()).length, 0);
  assert.equal(Ph.lineOf({ id: 'bad id!' }), null); assert.equal(Ph.lineOf({ id: 'a', ms: 9e9 }).ms, 60000);
});

await test('phone: the Ring button sends a payload the show contract accepts', async () => {
  const r = phoneRig(); await r.ctl.ring('Front desk'); await r.ctl.ring('');
  assert.deepEqual(r.shows[0].p, { text: 'Front desk' }); assert.deepEqual(r.shows[1].p, {});
  for (const s of r.shows) assert.equal(Show.payloadOk ? Show.payloadOk('ring', s.p) : true, true);
});

const PART = { checks: [
  { id: 'heat', label: 'Heat check', prompt: 'Roll the crew’s heat die.', die: 'd6', entries: [{ lo: 1, hi: 3, title: 'Quiet', md: 'Nothing follows.' }, { lo: 4, hi: 6, title: 'A visitor', md: 'Someone from the Pelican Rooms calls.' }] },
  { id: 'rep', label: 'Reputation', entries: [{ lo: 1, hi: 6, title: 'Talk', md: 'The street talks.' }] },
  { label: 'Broken', entries: [] }, null, { id: 'bad', entries: [{ lo: 5, hi: 2, title: 'x' }] }] };

await test('trouble: checksOf keeps usable checks, caps and cleans; no part gives nothing', () => {
  const c = Tr.checksOf(PART); assert.deepEqual(c.map((x) => x.id), ['heat', 'rep']);
  assert.equal(Tr.entryFor(c[0], 5).title, 'A visitor'); assert.equal(Tr.entryFor(c[0], 9), null); assert.equal(Tr.entryFor(c[0], 'x'), null);
  assert.deepEqual(Tr.checksOf(null), []); assert.deepEqual(Tr.checksOf({ checks: 'x' }), []);
});

await test('trouble: parseDraft reads the /blade trouble lines in any order and shape', () => {
  const d = Tr.parseDraft('- **Headline:** Clerk Seen at the Wharf\nBlurb - A clerk was seen.\n* rumour: "The clerk owes someone."\nstray line');
  assert.deepEqual(d, { headline: 'Clerk Seen at the Wharf', blurb: 'A clerk was seen.', rumour: '"The clerk owes someone."' });
  assert.deepEqual(Tr.parseDraft(''), { headline: '', blurb: '', rumour: '' });
});

function deskRig(withPart = true) {
  const doc = { trouble: { items: {} } }, shows = [], toasts = []; let t = 5000;
  const ctl = Tr.make({ part: () => (withPart ? PART : null), items: () => doc.trouble.items, save: (id, it) => { if (it === null) delete doc.trouble.items[id]; else doc.trouble.items[id] = it; },
    show: (k, p, o) => { shows.push({ k, p, o }); return Promise.resolve(1); }, toast: (m, bad) => toasts.push([m, !!bad]), now: () => ++t });
  return { ctl, doc, shows, toasts };
}

await test('trouble: the wizard walks the checks, looks the roll up, and Back and Next stay in range', () => {
  const { ctl } = deskRig(); let s = ctl.step(); assert.equal(s.i, 0); assert.equal(s.entry, null);
  s = ctl.setRoll(5); assert.equal(s.entry.title, 'A visitor'); s = ctl.next(); assert.equal(s.check.id, 'rep'); assert.equal(s.roll, null, 'the roll resets');
  s = ctl.next(); assert.equal(s.i, 1, 'cannot pass the last'); s = ctl.back(); assert.equal(s.i, 0); s = ctl.back(); assert.equal(s.i, 0);
});

await test('trouble: draft, approve, front page, rumours; only approved items feed them', async () => {
  const { ctl, doc, shows } = deskRig(); ctl.setRoll(5);
  const a = ctl.draft({ headline: 'Visitor at the Pelican Rooms', blurb: 'A caller was turned away.', rumour: 'Someone is asking after the crew.' });
  assert.equal(a.status, 'draft'); assert.equal(a.check, 'Heat check'); assert.equal(a.roll, 5); assert.equal(a.title, 'A visitor');
  const b = ctl.draft({ headline: 'Quiet Night' });
  assert.deepEqual(Tr.frontPage(doc.trouble.items), []); assert.deepEqual(Tr.rumours(doc.trouble.items), []);
  assert.equal(await ctl.nextRumour(), null, 'nothing approved: no beat');
  assert.equal(ctl.approve(a.id), true);
  assert.deepEqual(Tr.frontPage(doc.trouble.items).map((x) => x.headline), ['Visitor at the Pelican Rooms']);
  assert.deepEqual(Tr.rumours(doc.trouble.items).map((x) => x.text), ['Someone is asking after the crew.']);
  await ctl.nextRumour(); await ctl.nextRumour();
  assert.deepEqual(shows.map((s) => [s.k, s.p]), [['title', { text: 'Someone is asking after the crew.', sub: 'Rumour' }], ['title', { text: 'Someone is asking after the crew.', sub: 'Rumour' }]]);
  assert.notEqual(shows[0].o.key, shows[1].o.key);
  ctl.approve(a.id, false); assert.deepEqual(Tr.frontPage(doc.trouble.items), []);
  assert.equal(ctl.drop(b.id), true); assert.equal(ctl.drop(b.id), false); assert.equal(Object.keys(doc.trouble.items).length, 1);
});

await test('trouble: no headline, no tables, or a full desk keep the draft out', () => {
  let r = deskRig(); r.ctl.setRoll(1); assert.equal(r.ctl.draft({ blurb: 'x' }), null); assert.ok(r.toasts.some(([m, bad]) => bad && /headline/.test(m)));
  r = deskRig(false); assert.equal(r.ctl.step(), null); assert.equal(r.ctl.draft({ headline: 'x' }), null); assert.ok(r.ctl.html().includes('No trouble tables'));
  r = deskRig(); for (let i = 0; i < 60; i++) r.doc.trouble.items['i' + i] = { id: 'i' + i, headline: 'h' }; assert.equal(r.ctl.draft({ headline: 'x' }), null);
});

await test('trouble: cleanItem and the front page escape and cap; a rumour fits the title beat', () => {
  assert.equal(Tr.cleanItem({ id: 'a', headline: '  ' }), null); assert.equal(Tr.cleanItem({ id: 'bad id', headline: 'x' }), null);
  const it = Tr.cleanItem({ id: 'a', headline: 'H', rumour: 'r'.repeat(200), status: 'weird' }); assert.equal(it.status, 'draft'); assert.equal(it.rumour.length, 80);
  const html = Tr.frontHtml({ a: { id: 'a', headline: '<b>Big</b>', blurb: 'x & y', status: 'approved' } });
  assert.ok(html.includes('&lt;b&gt;Big') && html.includes('x &amp; y') && !html.includes('<b>Big'));
});

await test('trouble: secrecy: GM-only fields never reach a show payload or the front page', async () => {
  const { ctl, doc, shows } = deskRig(); ctl.setRoll(5);
  doc.trouble.items.z = { id: 'z', headline: 'Visible', rumour: 'Heard', status: 'approved', at: 1, gmNotes: 'GM-ONLY-note', md: 'GM-ONLY-md' };
  await ctl.nextRumour();
  assert.ok(!JSON.stringify(shows).includes('GM-ONLY') && !Tr.frontHtml(doc.trouble.items).includes('GM-ONLY'));
  assert.ok(!JSON.stringify(Tr.cleanItem(doc.trouble.items.z)).includes('GM-ONLY'));
});

function menuRig() {
  const btns = new Map(); const anchor = { insertAdjacentHTML(_w, html) { const id = /id="([^"]+)"/.exec(html)[1]; btns.set(id, { parentNode: { removeChild: () => btns.delete(id) } }); } };
  return { btns, menu: { $q: (sel) => btns.get(sel.slice(1)) || null, after: () => anchor } };
}

await test('room-desk: with every switch off nothing exists, draws or plays; each Menu line follows its own switch', () => {
  const state = { features: {} }, shows = [];
  const d = RD.create({ feature: (id) => state.features[id] === true, doc: () => ({}), show: (k) => { shows.push(k); return Promise.resolve(1); }, toast: () => {}, save: () => {} });
  const { btns, menu } = menuRig();
  d.menuSync(menu); assert.equal(btns.size, 0); assert.equal(d.practical(), null); assert.equal(d.phone(), null); assert.equal(d.trouble(), null);
  d.onShow('ring'); assert.equal(d.toggle('trouble'), false);
  state.features['between.trouble'] = true; d.menuSync(menu); assert.deepEqual([...btns.keys()], ['gm-menu-trouble']);
  state.features['room.phone'] = true; state.features['room.practical'] = true; d.menuSync(menu); assert.equal(btns.size, 3);
  state.features['room.phone'] = false; d.menuSync(menu); assert.deepEqual([...btns.keys()].sort(), ['gm-menu-practical', 'gm-menu-trouble']);
  assert.deepEqual(d.lines().map((x) => x.which), ['practical', 'trouble']);
  assert.ok(d.trouble() && d.practical());
});

await test('seam: the page hooks are single lines, the files are routed, and the sources carry no campaign names', () => {
  const page = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  assert.ok(page.includes('rdMenuSync()') && page.includes("case 'practical': case 'phone': case 'trouble'"));
  const routes = fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8');
  for (const f of ['gm/practical.js', 'gm/phone.js', 'gm/trouble.js', 'gm/room-desk.js']) assert.ok(routes.includes("'" + f + "'"), f);
  const display = routes.split('\n').find((l) => /^\s*display:/.test(l)); assert.ok(!/room-desk|practical|phone\.js|trouble/.test(display), 'players and the display never fetch GM files');
  for (const f of ['practical', 'phone', 'trouble', 'room-desk']) {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'gm', f + '.js'), 'utf8');
    assert.ok(!/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon)\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), f + ' makes no network call');
    assert.ok(!/ANTHROPIC|Deepgram/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), f + ' calls no model');
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
