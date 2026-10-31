// The players' mission, published from the GM page (app/gm/mission-publish.js, VV6; design 5.1, 5.5c, 5.7). INVENTED venue: the section 5 fixture.
// The module is driven with fake timers and a fake server: the debounce, the screen that fails closed, Reveal and send, End the night, the
// overlay that only Next earns, and the Players view. The page wiring is tested in gm-page.test.mjs (section VV6) and the "never in the
// payload" lists in gm-nosecrets.test.mjs (section o).
//   node checks/runtime/gm-mission.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const req = createRequire(import.meta.url);
const B = req(path.join(ROOT, 'app', 'gm', 'ball.js'));
const MP = req(path.join(ROOT, 'app', 'gm', 'mission-publish.js'));
const GP = req(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'pelican-play-v2.json'), 'utf8'));
const ROOMS = FX.zones.flatMap((z) => z.rooms);
const clone = (v) => JSON.parse(JSON.stringify(v));
const playOf = (mut) => { const p = clone(FX); if (mut) mut(p); return B.checkPlay(p, ROOMS).play; };
const T = (hhmm) => B.minuteOf(hhmm, '21:00');
const PCS = [{ id: 'pc_a', name: 'Ana Quill', owner: 'u1' }, { id: 'pc_b', name: 'Bo Tarn', owner: 'u2' }];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

/* a night that touches every player-facing path: everyone told everything, every way heard, a key carried, the costume that is seen through */
const BUSY = () => ({
  v: 2, site: 'The Pelican Rooms', start: 0, t: T('23:30'),
  crew: { pc_a: { room: 'Showroom', disguise: 'cook', items: ['key'], busy: T('23:45'), noticed: true, blown: ['guest'] }, pc_b: { room: 'Cocktail lounge', disguise: 'guard' } },
  heard: { A: { pc_a: T('22:00') }, B: { pc_a: T('22:15'), pc_b: T('22:30') } },
  steps: { A: [true, false], B: [false, false] }, ways: { B: 'done' },
  told: { I1: 'crew', I2: ['pc_a'], I3: 'crew', I4: ['pc_b'] }, over: { od: { delay: 15 } }, open: ROOMS,
});

/* the rig: fake timers, a fake server, the module's controller */
function rig(o = {}) {
  const r = { sent: [], toasts: [], offers: [], overlays: [], revealed: [], timers: [], clock: 0, events: [], failWith: null, answer: o.confirm !== false };
  r.play = o.play || playOf();
  r.state = o.state || BUSY();
  r.clocks = o.clocks || [{ id: 'c1', name: 'Fuse', size: 6, filled: 2, hidden: false }];
  r.open = o.open || ROOMS;
  r.hidden = o.hidden || [];           // hidden NPC / clock names (the page's hiddenSecretNames)
  r.npcs = o.npcs || {};               // name -> id of a hidden NPC the page could reveal
  r.stored = o.stored || null;
  r.source = () => ({ play: r.play, state: r.state, clocks: r.clocks, pcs: PCS, open: r.open, deny: () => ({ names: r.hidden.slice(), secrets: Array.isArray(r.play.secret) ? r.play.secret : [] }) });
  r.ctl = MP.create({
    ball: B, source: () => (r.dead ? null : r.source()),
    send: async (m) => { if (r.failWith) throw r.failWith; r.sent.push(m === null ? null : clone(m)); r.stored = m === null ? null : clone(m); return true; },
    stored: () => r.stored, namesHit: GP.namesHit,
    hiddenNpc: (name) => { const k = Object.keys(r.npcs).find((n) => n.toLowerCase() === String(name).toLowerCase()); return k ? { id: r.npcs[k], name: k } : null; },
    reveal: async (npc) => { if (!r.answer) return false; r.revealed.push(npc); r.hidden = r.hidden.filter((n) => n.toLowerCase() !== npc.name.toLowerCase()); delete r.npcs[npc.name]; return true; },
    offer: (spec) => { r.offers.push(spec); }, toast: (m, bad) => r.toasts.push([m, !!bad]),
    overlay: async (ov) => { r.overlays.push(ov); return { ok: true }; },
    confirm: () => r.answer,
    delay: (fn, ms) => { const h = { fn, at: r.clock + ms }; r.timers.push(h); return h; },
    cancel: (h) => { const i = r.timers.indexOf(h); if (i >= 0) r.timers.splice(i, 1); },
    now: () => new Date(2026, 9, 29, 21, 5),
  });
  r.ctl.onPublished((e) => r.events.push(e));
  /* advance the fake clock, running the timers that come due, and let the promises they start settle */
  r.advance = async (ms) => {
    const end = r.clock + ms;
    for (;;) {
      const due = r.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      r.timers.splice(r.timers.indexOf(due), 1); r.clock = due.at; due.fn();
      for (let i = 0; i < 6; i++) await Promise.resolve();
    }
    r.clock = end; await sleep(0);
  };
  return r;
}
const MARK = /GM-ONLY/;

/* ---- build ---- */
await test('buildMission: playerView then missionFor at ball.t, seq set, the filed PCs with their owners, no GM-ONLY string anywhere', () => {
  const r = rig(), m = MP.buildMission(B, r.source(), 5), json = JSON.stringify(m);
  assert.ok(m && m.v === 1 && m.seq === 5 && m.t === T('23:30') && m.site === 'The Pelican Rooms');
  assert.deepEqual(Object.keys(m.cards), ['pc_a', 'pc_b']);
  assert.deepEqual([m.cards.pc_a.owner, m.cards.pc_b.owner, m.cards.pc_a.name], ['u1', 'u2', 'Ana Quill']);
  assert.equal(m.hud.time, '23:30');
  assert.ok(!MARK.test(json), 'no marker');
  assert.ok(json.includes('The Last Hand') && json.includes('A brass key') && json.includes('The speeches'), 'positive control: the player-safe words are in it');
  assert.ok(!json.includes('Odette Marsh') && !json.includes('Pip Quill'.replace('Pip Quill', 'GM-ONLY-PERSON-1')), 'the target\'s name is not in it');
  assert.equal(MP.buildMission(B, { ...r.source(), state: { ...r.state, t: undefined } }, 1), null, 'no time, no mission');
  assert.equal(MP.buildMission(B, { ...r.source(), play: { v: 1, clock: { start: '21:00', end: '02:00' } } }, 1), null, 'a v1 block builds none');
});

await test('buildMission: the time is ball.t whatever else the state carries (a peek key, a runT, a floor); the alarm comes from the table clock', () => {
  const r = rig(), a = MP.buildMission(B, r.source(), 1);
  r.state = { ...r.state, runT: 600, peek: 900, view: 'map', floor: 1 };
  const b = MP.buildMission(B, r.source(), 1);
  assert.deepEqual(a, b, 'a peek-like key changes nothing');
  assert.equal(b.t, T('23:30'));
  assert.deepEqual(a.hud.alarm, { name: 'Alarm', size: 6, filled: 2, text: 'Someone is looking' }, 'the visible clock: its fill, the pub line for that fill');
  r.clocks = [{ name: 'Fuse', size: 6, filled: 4, hidden: true }];
  assert.equal(MP.buildMission(B, r.source(), 1).hud.alarm, null, 'a hidden clock: no alarm on the players\' screens');
  r.clocks = [];
  assert.equal(MP.buildMission(B, r.source(), 1).hud.alarm, null, 'no such clock: none');
  r.clocks = [{ name: ' fuse ', size: 6, filled: 3, hidden: false }];
  assert.equal(MP.buildMission(B, r.source(), 1).hud.alarm.filled, 3, 'found by name, any case');
  assert.deepEqual(MP.alarmOf(r.play, [{ name: 'Fuse', filled: 2.9, hidden: true }]), { filled: 2, visible: false });
  assert.equal(MP.alarmOf(r.play, null), undefined);
  assert.equal(MP.alarmOf({ v: 2 }, r.clocks), undefined);
});

await test('buildMission: cards only for PCs in ball.crew; a card own room and a told window room are blanked while the room is shut, never refused, and shown when open', () => {
  const r = rig();
  r.state.crew = { pc_a: { room: 'Luxury penthouse', disguise: 'guest' } };                  // pc_b is filed but not on the job
  r.state.heard = { A: { pc_a: T('22:00') } }; r.state.told = { I1: 'crew', I2: 'crew' };
  const shut = ROOMS.filter((x) => x !== 'Luxury penthouse' && x !== 'Private card rooms');
  const m = MP.buildMission(B, { ...r.source(), open: shut }, 1);
  assert.deepEqual(Object.keys(m.cards), ['pc_a'], 'pc_b has no card');
  assert.equal(m.cards.pc_a.room, '', 'blanked');
  const win = m.cards.pc_a.leads[0].window;
  assert.ok(win.startsWith('23:30') && !win.includes('Private card rooms'), 'the window without its shut room: ' + win);
  assert.equal(MP.screenMission(m, { names: ['Luxury penthouse', 'Private card rooms'], secrets: [] }, GP.namesHit), null, 'so the screen has nothing to refuse');
  const o = MP.buildMission(B, { ...r.source(), open: ROOMS }, 1);
  assert.equal(o.cards.pc_a.room, 'Luxury penthouse', 'positive control: open, it is named');
  assert.ok(o.cards.pc_a.leads[0].window.endsWith('Private card rooms'));
});

/* ---- A1: the room notes' lines on a card (buildMission takes src.rooms; screenMission drops a denied one; publishMission says so) ---- */
const RNOTES = { Showroom: { costume: 'Evening dress, a borrowed pin', say: ['Chandeliers over the stage', 'A string quartet tunes up'], md: 'GM-ONLY-MD-1 prose' }, 'Luxury penthouse': { costume: 'A hotel robe', say: ['City lights below'] } };
await test('buildMission: src.rooms reaches playerView: a card carries its open room\'s costumeLine and here, blanked with the room when the room is shut; no md goes out', () => {
  const r = rig();                                                     // BUSY: pc_a in the Showroom, pc_b in the lounge (no note)
  const m = MP.buildMission(B, { ...r.source(), rooms: RNOTES }, 1), json = JSON.stringify(m);
  assert.equal(m.cards.pc_a.costumeLine, 'Evening dress, a borrowed pin'); assert.deepEqual(m.cards.pc_a.here, ['Chandeliers over the stage', 'A string quartet tunes up']);
  assert.deepEqual([m.cards.pc_b.costumeLine, m.cards.pc_b.here], [null, []], 'no note for the lounge');
  assert.ok(!json.includes('GM-ONLY-MD') && !json.includes('City lights below') && !MARK.test(json), 'no md, and no line of a room nobody stands in');
  const bare = MP.buildMission(B, r.source(), 1);
  assert.deepEqual([bare.cards.pc_a.costumeLine, bare.cards.pc_a.here], [null, []], 'no src.rooms: no lines');
  r.state.crew.pc_a.room = 'Luxury penthouse';
  const shut = MP.buildMission(B, { ...r.source(), rooms: RNOTES, open: ROOMS.filter((x) => x !== 'Luxury penthouse') }, 1);
  assert.deepEqual([shut.cards.pc_a.room, shut.cards.pc_a.costumeLine, shut.cards.pc_a.here], ['', null, []], 'a shut room takes its lines with it');
  assert.ok(!JSON.stringify(shut).includes('A hotel robe'));
  const open = MP.buildMission(B, { ...r.source(), rooms: RNOTES }, 1);
  assert.deepEqual([open.cards.pc_a.room, open.cards.pc_a.costumeLine, open.cards.pc_a.here], ['Luxury penthouse', 'A hotel robe', ['City lights below']], 'positive control: open, they are there');
});

await test('screenMission with a warnings array drops a denied costumeLine or here line (a hidden name or a secret word), reports { pc, field, name }, changes nothing else; every other field still fails closed; without the array a denied room line is a hit', () => {
  const r = rig(), hit = GP.namesHit, base = MP.buildMission(B, { ...r.source(), rooms: RNOTES }, 1);
  const deny = { names: ['Maren Holt'], secrets: ['GM-ONLY-SECRET-1'] };
  const w0 = []; assert.equal(MP.screenMission(clone(base), deny, hit, w0), null, 'control: the clean lines pass'); assert.deepEqual(w0, []);
  const m = clone(base);
  m.cards.pc_a.costumeLine = 'Dress like Maren Holt'; m.cards.pc_a.here = ['Chandeliers over the stage', 'A note: GM-ONLY-SECRET-1', 'Maren Holt waves'];
  m.cards.pc_b.costumeLine = 'GM-ONLY-SECRET-1 on a hanger'; m.cards.pc_b.here = ['Maren Holt is at the bar'];
  const want = clone(m), warnings = [];
  want.cards.pc_a.costumeLine = null; want.cards.pc_a.here = ['Chandeliers over the stage']; want.cards.pc_b.costumeLine = null; want.cards.pc_b.here = [];
  assert.equal(MP.screenMission(m, deny, hit, warnings), null, 'the denied room lines are dropped, the rest is clean');
  assert.deepEqual(warnings, [{ pc: 'pc_a', field: 'costumeLine', name: 'Maren Holt' }, { pc: 'pc_a', field: 'here', name: 'GM-ONLY-SECRET-1' }, { pc: 'pc_a', field: 'here', name: 'Maren Holt' },
    { pc: 'pc_b', field: 'costumeLine', name: 'GM-ONLY-SECRET-1' }, { pc: 'pc_b', field: 'here', name: 'Maren Holt' }]);
  assert.deepEqual(m, want, 'only those lines changed');
  /* every other field stays fail closed, even beside a dropped room line */
  const lead = clone(base), w2 = [];
  lead.cards.pc_a.costumeLine = 'Maren Holt'; lead.cards.pc_a.leads[0].line = 'Ask Maren Holt';
  assert.deepEqual(MP.screenMission(lead, deny, hit, w2), { name: 'Maren Holt', path: 'mission.cards.pc_a.leads.0.line', kind: 'name' });
  assert.deepEqual(w2, [{ pc: 'pc_a', field: 'costumeLine', name: 'Maren Holt' }]);
  const inBand = clone(base), w3 = []; inBand.hud.label = 'GM-ONLY-SECRET-1';
  assert.deepEqual(MP.screenMission(inBand, deny, hit, w3), { name: 'GM-ONLY-SECRET-1', path: 'mission.hud.label', kind: 'secret' }); assert.deepEqual(w3, []);
  /* without the array nothing is dropped: a denied room line is a hit like any other string */
  const noArr = clone(base); noArr.cards.pc_a.costumeLine = 'Dress like Maren Holt';
  assert.deepEqual(MP.screenMission(noArr, deny, hit), { name: 'Maren Holt', path: 'mission.cards.pc_a.costumeLine', kind: 'name' }); assert.equal(noArr.cards.pc_a.costumeLine, 'Dress like Maren Holt');
  const said = clone(base); said.cards.pc_b.here = ['GM-ONLY-SECRET-1 hums'];
  assert.deepEqual(MP.screenMission(said, deny, hit), { name: 'GM-ONLY-SECRET-1', path: 'mission.cards.pc_b.here.0', kind: 'secret' });
  assert.equal(MP.screenMission(clone(noArr), deny, hit, 'warnings').path, 'mission.cards.pc_a.costumeLine', 'a warnings that is not an array is none');
});

await test('publishMission: a room line naming a hidden name is dropped, not refused: the publish goes, the result carries warnings, a toast says so, and nothing denied is sent', async () => {
  const lines = { Showroom: { costume: 'Borrow Maren Holt\'s coat', say: ['Chandeliers over the stage', 'Maren Holt is by the bar'] } };
  const r = rig({ hidden: ['Maren Holt'] }), base = r.source;
  r.source = () => ({ ...base(), rooms: lines });
  const res = await r.ctl.publishNow();
  assert.equal(res.ok, true); assert.equal(r.sent.length, 1); assert.equal(r.offers.length, 0);
  assert.deepEqual(res.warnings, [{ pc: 'pc_a', field: 'costumeLine', name: 'Maren Holt' }, { pc: 'pc_a', field: 'here', name: 'Maren Holt' }]);
  assert.ok(r.toasts.some(([t, bad]) => t === 'Dropped a room line naming Maren Holt.' && bad), JSON.stringify(r.toasts));
  assert.ok(!JSON.stringify(r.sent[0]).includes('Maren Holt'), 'nothing denied is sent');
  assert.equal(r.sent[0].cards.pc_a.costumeLine, null); assert.deepEqual(r.sent[0].cards.pc_a.here, ['Chandeliers over the stage'], 'the clean line still goes');
  assert.deepEqual(r.events[0].warnings, res.warnings);
  /* the control: nothing denied, the lines go as written and there is no warning */
  const c = rig(), cbase = c.source; c.source = () => ({ ...cbase(), rooms: lines });
  const cr = await c.ctl.publishNow();
  assert.equal(cr.ok, true); assert.equal(cr.warnings, undefined); assert.equal(c.sent[0].cards.pc_a.costumeLine, 'Borrow Maren Holt\'s coat'); assert.equal(c.toasts.length, 0);
});

/* ---- screen ---- */
await test('screenMission: a hidden name, a secret word and a hidden room are each caught, with the path; clean text passes (a control beside each)', () => {
  const r = rig(), m = MP.buildMission(B, r.source(), 1), hit = GP.namesHit;
  const deny = { names: ['Maren Holt'], secrets: ['GM-ONLY-SECRET-1', 'Thank R.'] };
  assert.equal(MP.screenMission(m, deny, hit), null, 'control: the clean mission passes');
  const a = clone(m); a.hud.crew[0].costume = 'Maren Holt arrives';
  assert.deepEqual(MP.screenMission(a, deny, hit), { name: 'Maren Holt', path: 'mission.hud.crew.0.costume', kind: 'name' });
  const b = clone(m); b.cards.pc_a.know.push('they say: thank r.');
  assert.deepEqual(MP.screenMission(b, deny, hit), { name: 'Thank R.', path: 'mission.cards.pc_a.know.' + (b.cards.pc_a.know.length - 1), kind: 'secret' });
  const c = clone(m); c.cards['maren holt'] = c.cards.pc_b; delete c.cards.pc_b;
  assert.equal(MP.screenMission(c, deny, hit).name, 'Maren Holt', 'a card id is a string too');
  assert.equal(MP.screenMission(m, { names: ['Marens'], secrets: [] }, hit), null, 'whole words only: a longer word is not a hit');
  /* fails closed */
  assert.equal(MP.screenMission(Object.assign(clone(m), { extra: 'x' }), deny, hit).kind, 'shape', 'a key the mission does not have');
  assert.equal(MP.screenMission(null, deny, hit).kind, 'shape');
  assert.equal(MP.screenMission(m, deny, null).kind, 'shape', 'no test to run: refused');
  assert.equal(MP.screenMission(m, null, hit).kind, 'shape', 'no deny list: refused');
  assert.equal(MP.screenMission(m, deny, () => { throw new Error('boom'); }).kind, 'shape', 'a test that throws: refused');
  assert.deepEqual(MP.parseRefusal(Object.assign(new Error('mission names "Maren Holt" at mission.hud.crew.0.name, which the players must not see'), { status: 422 })), { name: 'Maren Holt', path: 'mission.hud.crew.0.name', kind: 'server' });
  assert.equal(MP.parseRefusal(Object.assign(new Error('mission names "X" at mission.t, which'), { status: 400 })), null);
  assert.equal(MP.parseRefusal(new Error('network')), null);
});

await test('screenMission fails closed on a deny list that is not two arrays, and on a mission without an object hud and an object of cards (empty arrays are fine)', () => {
  const r = rig(), m = MP.buildMission(B, r.source(), 1), hit = GP.namesHit;
  assert.equal(MP.screenMission(m, { names: [], secrets: [] }, hit), null, 'control: empty lists pass');
  for (const bad of [{ names: 'Maren Holt', secrets: [] }, { names: [], secrets: 'x' }, { names: [] }, { secrets: [] }, { names: null, secrets: [] }, { names: {}, secrets: [] }, []]) {
    assert.equal(MP.screenMission(m, bad, hit).kind, 'shape', JSON.stringify(bad));
  }
  for (const key of ['hud', 'cards']) {
    for (const v of [undefined, null, 'x', [], 5]) { const x = clone(m); if (v === undefined) delete x[key]; else x[key] = v; assert.equal(MP.screenMission(x, { names: [], secrets: [] }, hit).kind, 'shape', key + ' = ' + JSON.stringify(v)); }
  }
  assert.equal(MP.screenMission({ v: 1, hud: {}, cards: {} }, { names: [], secrets: [] }, hit), null, 'control: empty objects are objects');
});

await test('a deny list that throws sends nothing, says so, and is never an uncaught throw from the timer; the overlay is not laid either', async () => {
  const r = rig(); const real = r.source;
  r.source = () => ({ ...real(), deny: () => { throw new Error('boom'); } });
  r.ctl.changed(); await r.advance(800);
  assert.equal(r.sent.length, 0, 'nothing sent');
  assert.ok(r.toasts.some(([m, bad]) => bad && /hidden-name list could not be read/.test(m)), JSON.stringify(r.toasts));
  const res = await r.ctl.publishNow();
  assert.equal(res.ok, false); assert.equal(res.refused.kind, 'deny'); assert.equal(r.ctl.status().ok, false);
  assert.equal(r.events[0].ok, false); assert.ok(r.events[0].refused);
  await r.ctl.landed(T('21:45'), T('22:00'), 'next'); assert.equal(r.overlays.length, 0, 'no overlay without a deny list');
  r.source = real; r.ctl.changed(); await r.advance(800);
  assert.equal(r.sent.length, 1, 'positive control: with a readable list it goes');
});

await test('a closed room whose own name holds " · " is blanked whole from a told window (the time part never holds one); open, the whole name shows', () => {
  const NAME = 'A · B · Card';
  const r = rig(); r.play = playOf(); r.play.ways[0].window.room = NAME;
  r.state.crew = { pc_a: { room: 'Showroom', disguise: 'guest' } }; r.state.heard = { A: { pc_a: T('22:00') } }; r.state.told = { I1: 'crew', I2: 'crew' };
  const shut = MP.buildMission(B, { ...r.source(), open: ROOMS }, 1), win = shut.cards.pc_a.leads[0].window;
  assert.ok(win.startsWith('23:30') && !win.includes('·') && !win.includes('Card') && !win.includes('B'), 'blanked whole: ' + win);
  const open = MP.buildMission(B, { ...r.source(), open: ROOMS.concat([NAME]) }, 1);
  assert.ok(open.cards.pc_a.leads[0].window.endsWith(' · ' + NAME), 'positive control: open, the whole name: ' + open.cards.pc_a.leads[0].window);
  const part = MP.buildMission(B, { ...r.source(), open: ROOMS.concat(['B · Card']) }, 1);
  assert.ok(!part.cards.pc_a.leads[0].window.includes('Card'), 'a different open room named like the tail does not leak the closed one');
});

/* ---- debounce and what triggers it ---- */
await test('the debounce: five changes inside 800 ms make one PATCH, 800 ms after the last; nothing at 799; the next differing change makes the next', async () => {
  const r = rig();
  for (let i = 0; i < 5; i++) { r.ctl.changed(); await r.advance(100); }
  assert.equal(r.sent.length, 0, 'nothing yet: each change restarts the wait');
  await r.advance(699); assert.equal(r.sent.length, 0, '799 ms after the last change');
  await r.advance(1); assert.equal(r.sent.length, 1, '800 ms after the last');
  assert.equal(r.sent[0].seq, 1); assert.equal(MP.DEBOUNCE_MS, 800);
  r.state.t = T('23:45'); r.ctl.changed(); await r.advance(800);
  assert.equal(r.sent.length, 2); assert.equal(r.sent[1].seq, 2); assert.equal(r.sent[1].t, T('23:45'));
  assert.deepEqual(r.ctl.status(), { ok: true, time: '23:45', at: '21:05', seq: 2, text: 'Players: 23:45 ✓' });
  assert.deepEqual(r.events.map((e) => [e.ok, e.seq, e.time]), [[true, 1, '23:30'], [true, 2, '23:45']], 'onPublished: time and ok');
});

await test('a change that leaves the mission as it was sends nothing (a floor tab, a lens, a view, a pin): the wait runs and the PATCH does not', async () => {
  const r = rig();
  r.ctl.changed(); await r.advance(800); assert.equal(r.sent.length, 1);
  Object.assign(r.state, { floor: 1, lens: 'risky', view: 'map', pins: { c1: 'Showroom' }, dawn: { at: 'x' } });
  r.ctl.changed(); await r.advance(800);
  assert.equal(r.sent.length, 1, 'unchanged');
  assert.equal(r.ctl.status().seq, 1);
});

await test('every field the mission reads makes a PATCH: ball.t, crew, heard, steps, told, open, items, blown, busy and the alarm clock; a costume change alone does not (it is GM-side)', async () => {
  const cases = [
    ['ball.t', (r) => { r.state.t = T('22:45'); }],
    ['crew (a PC moves)', (r) => { r.state.crew.pc_b.room = 'Showroom'; }],
    ['heard', (r) => { r.state.heard.A.pc_b = T('22:40'); }],
    ['steps', (r) => { r.state.steps.A = [true, true]; }],
    ['told', (r) => { r.state.told.I2 = 'crew'; }],
    ['open', (r) => { r.open = ['Showroom', 'Cocktail lounge']; }],
    ['items', (r) => { r.state.crew.pc_b.items = ['key']; }],
    ['blown', (r) => { r.state.crew.pc_b.blown = ['guard']; r.state.crew.pc_b.disguise = 'guest'; r.state.crew.pc_b.room = 'Private card rooms'; }],
    ['busy', (r) => { r.state.crew.pc_a.busy = T('23:40'); }],
    ['the alarm clock', (r) => { r.clocks[0].filled = 5; }],
  ];
  for (const [name, mut] of cases) {
    const r = rig();
    r.ctl.changed(); await r.advance(800); assert.equal(r.sent.length, 1, name + ': the first');
    mut(r); r.ctl.changed(); await r.advance(800);
    assert.equal(r.sent.length, 2, name + ': a second PATCH');
    assert.notEqual(JSON.stringify({ ...r.sent[1], seq: 0 }), JSON.stringify({ ...r.sent[0], seq: 0 }), name + ': and it differs');
  }
  /* A1: a costume change alone moves nothing the players read (the costume mechanic is GM-side): no second PATCH */
  { const r = rig(); r.ctl.changed(); await r.advance(800); assert.equal(r.sent.length, 1, 'crew (a costume): the first');
    r.state.crew.pc_b.disguise = 'cook'; r.ctl.changed(); await r.advance(800); assert.equal(r.sent.length, 1, 'crew (a costume): no second PATCH'); }
  /* the table's clocks arriving (noteClocks) wait for the alarm clock, and only it */
  const r = rig();
  r.ctl.noteClocks();                                         // the baseline
  r.clocks = [{ name: 'Fuse', size: 6, filled: 2, hidden: false }, { name: 'Other', size: 4, filled: 1 }]; r.ctl.noteClocks(); await r.advance(900);
  assert.equal(r.sent.length, 0, 'another clock ticking publishes nothing');
  r.clocks[0].filled = 3; r.ctl.noteClocks(); await r.advance(800);
  assert.equal(r.sent.length, 1, 'the alarm clock\'s fill does');
  r.clocks[0].hidden = true; r.ctl.noteClocks(); await r.advance(800);
  assert.equal(r.sent.length, 2); assert.equal(r.sent[1].hud.alarm, null, 'hiding it takes the alarm off the players\' screens');
});

await test('it publishes only a v2 night: a v1 play block, a ball with no v:2 or no time, and no run at all send nothing', async () => {
  for (const mut of [(r) => { r.play = { v: 1, clock: { start: '21:00', end: '02:00' } }; }, (r) => { delete r.state.v; }, (r) => { delete r.state.t; }, (r) => { r.dead = true; }]) {
    const r = rig(); mut(r); r.ctl.changed(); await r.advance(2000);
    assert.equal(r.sent.length, 0);
  }
});

await test('seq goes up by one each publish and carries on from the stored mission after a reload; a failed or refused send does not use one', async () => {
  const r = rig({ stored: { v: 1, seq: 41, hud: null, cards: {} } });
  r.ctl.changed(); await r.advance(800); assert.equal(r.sent[0].seq, 42);
  r.failWith = Object.assign(new Error('offline'), { status: 503 });
  r.state.t = T('23:45'); r.ctl.changed(); await r.advance(800);
  assert.equal(r.sent.length, 1); assert.equal(r.ctl.status().seq, 42);
  assert.ok(r.toasts.some(([m, bad]) => bad && /not updated/.test(m)), 'a toast says so');
  assert.equal(r.events[r.events.length - 1].ok, false); assert.equal(r.ctl.status().text, 'Players: 23:30 ✗ not sent');
  r.failWith = null; r.ctl.changed(); await r.advance(800);
  assert.equal(r.sent[1].seq, 43, 'the retry takes the next number'); assert.equal(r.ctl.status().ok, true);
});

await test('a change made while a publish is in flight is not lost', async () => {
  let release;
  const q = rig(); const sent = []; let calls = 0;
  const ctl = MP.create({ ball: B, source: q.source, send: (m) => { calls++; return new Promise((res) => { release = () => { sent.push(clone(m)); res(true); }; }); }, stored: () => null, namesHit: GP.namesHit,
    delay: (fn, ms) => { const h = { fn, at: q.clock + ms }; q.timers.push(h); return h; }, cancel: (h) => { const i = q.timers.indexOf(h); if (i >= 0) q.timers.splice(i, 1); } });
  ctl.changed(); await q.advance(800); assert.equal(calls, 1);
  q.state.t = T('23:45'); ctl.changed(); await q.advance(800);       // fires while the first PATCH is still out
  assert.equal(calls, 1, 'one in flight at a time');
  release(); await sleep(5); await q.advance(800);
  assert.equal(calls, 2, 'and the change goes right after'); release(); await sleep(5);
  assert.deepEqual(sent.map((m) => m.t), [T('23:30'), T('23:45')]);
});

/* ---- the hidden-name refusal and Reveal and send ---- */
const withName = (r) => { r.play = playOf((p) => { p.intel[0].text = 'The programme: Maren Holt speaks at ten'; }); r.hidden = ['Maren Holt']; r.npcs = { 'Maren Holt': 'npc_maren' }; };

await test('the page\'s own screen: a hidden NPC named in the mission is not sent; a notice offers "Reveal <name> and send"; taking it reveals, then sends the mission with that name in it', async () => {
  const r = rig(); withName(r);
  r.ctl.changed(); await r.advance(800);
  assert.equal(r.sent.length, 0, 'fails closed: nothing went');
  assert.equal(r.offers.length, 1); assert.equal(r.offers[0].label, 'Reveal Maren Holt and send');
  assert.match(r.offers[0].text, /Maren Holt/); assert.equal(r.toasts.length, 0, 'the offer is the notice');
  assert.equal(r.events[0].ok, false); assert.equal(r.events[0].refused.name, 'Maren Holt'); assert.equal(r.ctl.status().ok, false);
  r.state.t = T('23:45'); r.ctl.changed(); await r.advance(800);
  assert.equal(r.sent.length, 0, 'still nothing, each change tries again'); assert.equal(r.offers.length, 2, 'and the notice is offered again (the page replaces it: one line, not a stack)');
  await r.offers[1].run(); await sleep(0);
  assert.deepEqual(r.revealed, [{ id: 'npc_maren', name: 'Maren Holt' }], 'the existing reveal ran');
  assert.equal(r.sent.length, 1, 'then it published again');
  assert.ok(JSON.stringify(r.sent[0]).includes('Maren Holt'), 'now the name may be in it');
  assert.equal(r.sent[0].t, T('23:45'), 'the current time');
  assert.equal(r.ctl.status().ok, true);
});

await test('declining the reveal sends nothing and changes nothing (a positive control: accepting does)', async () => {
  const r = rig({ confirm: false }); withName(r);
  r.ctl.changed(); await r.advance(800);
  const res = await r.offers[0].run();
  assert.equal(r.revealed.length, 0); assert.equal(r.sent.length, 0); assert.equal(res.ok, false);
});

await test('a secret word in the mission is refused with a toast naming the path, and never offers a reveal', async () => {
  const r = rig(); r.play = playOf((p) => { p.intel[0].text = 'Remember: GM-ONLY-SECRET-1'; });
  r.ctl.changed(); await r.advance(800);
  assert.equal(r.sent.length, 0); assert.equal(r.offers.length, 0);
  assert.ok(r.toasts.some(([m, bad]) => bad && /secret word/.test(m) && /mission\.cards\.pc_a\.know\.0/.test(m)), JSON.stringify(r.toasts));
});

await test('the server\'s 422 for a hidden name the page did not know (a clock) is a toast; for a hidden NPC it offers the reveal', async () => {
  const r = rig(); r.failWith = Object.assign(new Error('mission names "Maren Holt" at mission.hud.next.0.text, which the players must not see'), { status: 422 });
  r.npcs = { 'Maren Holt': 'npc_maren' };
  r.ctl.changed(); await r.advance(800);
  assert.equal(r.sent.length, 0); assert.equal(r.offers.length, 1); assert.equal(r.offers[0].label, 'Reveal Maren Holt and send');
  r.failWith = null; await r.offers[0].run(); await sleep(0);
  assert.equal(r.sent.length, 1, 'revealed, then sent');
  const c = rig(); c.failWith = Object.assign(new Error('mission names "Slow Fuse" at mission.hud.alarm.name, which the players must not see'), { status: 422 });
  c.ctl.changed(); await c.advance(800);
  assert.equal(c.offers.length, 0); assert.ok(c.toasts.some(([m, bad]) => bad && /Slow Fuse/.test(m)), 'a clock name: only a toast');
});

/* ---- End the night ---- */
await test('End the night asks first, then sends { mission: null }; the Players view empties; nothing more is published for that night; a new start brings it back', async () => {
  const r = rig({ confirm: false });
  r.ctl.changed(); await r.advance(800); assert.equal(r.sent.length, 1);
  r.answer = false;
  assert.equal((await r.ctl.endNight()).skipped, 'declined'); assert.equal(r.sent.length, 1, 'declined: nothing sent');
  r.answer = true;
  const res = await r.ctl.endNight();
  assert.equal(res.ended, true); assert.equal(r.sent.length, 2); assert.equal(r.sent[1], null, 'PATCH { mission: null }');
  assert.equal(r.ctl.last(), null); assert.equal(r.ctl.status().text, '');
  assert.equal(r.events[r.events.length - 1].ended, true);
  r.state.t = T('23:45'); r.ctl.changed(); await r.advance(1600);
  assert.equal(r.sent.length, 2, 'the ended night stays ended while the page keeps writing the ball');
  r.state.start = T('22:00'); r.ctl.changed(); await r.advance(800);
  assert.equal(r.sent.length, 3, 'a new start publishes again'); assert.ok(r.sent[2] && r.sent[2].seq > r.sent[0].seq, 'and the numbers carry on');
  /* a send that fails leaves the night as it was */
  const f = rig(); f.ctl.changed(); await f.advance(800); f.failWith = Object.assign(new Error('503'), { status: 503 });
  const bad = await f.ctl.endNight(); assert.equal(bad.ok, false); assert.ok(f.ctl.last(), 'still published'); assert.ok(f.toasts.some(([m]) => /Could not end the night/.test(m)));
});

await test('End the night while a publish is still out: when that publish lands late it does not bring the night back (last() stays empty)', async () => {
  const q = rig(); const waits = []; const sent = [];
  const ctl = MP.create({ ball: B, source: q.source, namesHit: GP.namesHit, stored: () => null, confirm: () => true,
    send: (m) => (m === null ? Promise.resolve(sent.push(null)) : new Promise((res) => waits.push(() => { sent.push(clone(m)); res(true); }))),
    delay: (fn, ms) => { const h = { fn, at: q.clock + ms }; q.timers.push(h); return h; }, cancel: (h) => { const i = q.timers.indexOf(h); if (i >= 0) q.timers.splice(i, 1); } });
  ctl.changed(); await q.advance(800); assert.equal(waits.length, 1, 'a publish is out');
  const end = await ctl.endNight(); assert.equal(end.ended, true);
  waits[0](); await sleep(5);
  assert.equal(ctl.last(), null, 'the late landing is ignored'); assert.equal(ctl.status().text, '');
});

/* ---- the overlay ---- */
await test('a public event\'s pub is laid over the iPad for 8 s when Next lands on it: not on Back, not on a jump that skips it, not for a hidden event, one at most', async () => {
  const r = rig();
  await r.ctl.landed(T('21:45'), T('22:00'), 'next');
  assert.deepEqual(r.overlays, [{ kind: 'text', text: 'The speeches', ms: 8000 }], 'Next lands on the speeches');
  await r.ctl.landed(T('22:00'), T('21:45'), 'back'); assert.equal(r.overlays.length, 1, 'Back: nothing');
  await r.ctl.landed(T('22:00'), T('21:45'), 'next'); assert.equal(r.overlays.length, 1, 'time did not go forward');
  await r.ctl.landed(T('21:45'), T('22:00'), 'peek'); await r.ctl.landed(T('21:45'), T('22:00'), undefined); assert.equal(r.overlays.length, 1, 'a peek is not a Next');
  await r.ctl.landed(T('22:00'), T('22:15'), 'next'); assert.equal(r.overlays.length, 1, 'already underway: not again');
  await r.ctl.landed(T('22:15'), T('22:30'), 'next'); assert.equal(r.overlays.length, 1, 'the beat after it: nothing');
  await r.ctl.landed(T('23:15'), T('23:30'), 'next'); assert.equal(r.overlays.length, 1, 'a hidden event (Odette at the cards) earns none');
  await r.ctl.landed(T('23:45'), T('00:00'), 'next'); assert.equal(r.overlays.length, 2); assert.equal(r.overlays[1].text, 'The fireworks');
  await r.ctl.landed(T('21:00'), T('00:10'), 'next'); assert.equal(r.overlays.length, 3, 'a long jump lands on whatever is on at the end');
  assert.equal(r.overlays[2].text, 'The fireworks');
  assert.equal(MP.OVERLAY_MS, 8000); assert.equal(MP.OVERLAY_MAX, 120);
});

await test('the overlay text is the pub, cut to 120 characters, and the gate\'s words: a hidden name or a secret in it sends none; two events at once send the earlier', async () => {
  const long = 'W'.repeat(60) + ' ' + 'x'.repeat(100);
  const a = rig({ play: playOf((p) => { p.events[0].pub = long; }) });
  await a.ctl.landed(T('21:45'), T('22:00'), 'next');
  assert.equal(a.overlays.length, 1); assert.ok(a.overlays[0].text.length <= 120 && a.overlays[0].text.startsWith('WWWW'), String(a.overlays[0].text.length));
  const b = rig({ hidden: ['Maren Holt'], play: playOf((p) => { p.events[0].pub = 'Maren Holt takes the stage'; }) });
  await b.ctl.landed(T('21:45'), T('22:00'), 'next'); assert.equal(b.overlays.length, 0, 'a hidden name: none');
  const c = rig({ play: playOf((p) => { p.events[0].pub = 'GM-ONLY-SECRET-1 on stage'; }) });
  await c.ctl.landed(T('21:45'), T('22:00'), 'next'); assert.equal(c.overlays.length, 0, 'a secret word: none');
  const d = rig({ play: playOf((p) => { p.events.push({ at: '22:05', id: 'zz', label: 'GM-ONLY-LABEL-9', room: 'Showroom', vis: 'public', pub: 'A second thing' }); }) });
  await d.ctl.landed(T('21:45'), T('22:07'), 'next');
  assert.deepEqual(d.overlays.map((o) => o.text), ['The speeches'], 'the earlier one');
  const e = rig({ play: playOf((p) => { p.events[0].pub = 'x'; p.events[0].vis = 'seen'; }) });
  await e.ctl.landed(T('21:45'), T('22:00'), 'next'); assert.equal(e.overlays.length, 0, 'a seen event is not public');
  assert.equal(MP.overlayFor(B, playOf(), 0, 15), null);
  const label = JSON.stringify(rig().overlays); assert.ok(!MARK.test(label));
});

/* ---- the Players view ---- */
function fakeDoc() {
  const mk = (tag) => ({ tagName: tag, className: '', children: [], attrs: {}, _t: '', setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); return c; },
    set textContent(v) { this._t = String(v); if (v === '') this.children = []; }, get textContent() { return this._t + this.children.map((c) => c.textContent).join(' '); }, ownerDocument: null });
  const doc = { createElement: (t) => { const n = mk(t); n.ownerDocument = doc; return n; } };
  const root = doc.createElement('div'); return { doc, root };
}
await test('the Players view is drawn from the last published mission, not the GM state: it shows what was sent while the state has moved on; text only', async () => {
  const r = rig({ play: playOf((p) => { p.events[0].pub = '<b>The speeches</b>'; }) });
  r.ctl.changed(); await r.advance(800);
  const sent = r.sent[0];
  r.state.t = T('22:10'); r.state.crew.pc_a.room = 'Luxury penthouse'; r.state.told = {};        // the GM state moves on, nothing published
  const { root } = fakeDoc();
  const model = MP.renderPlayersView(root, r.ctl.last());
  assert.deepEqual(r.ctl.last(), sent, 'the last published, not rebuilt');
  const text = root.textContent;
  assert.ok(text.includes('23:30') && text.includes('Ana Quill') && text.includes('Bo Tarn'), text.slice(0, 200));
  assert.ok(!text.includes('22:10'), 'not the GM state\'s time');
  assert.equal(MP.buildMission(B, r.source(), 9).hud.time, '22:10', 'positive control: the GM state really has moved on');
  assert.ok(!MARK.test(text));
  assert.deepEqual(model.cards.map((c) => c.id), ['pc_a', 'pc_b']);
  const flat = JSON.stringify(model);
  assert.deepEqual(model.band.crew, ['Ana Quill · Showroom', 'Bo Tarn · Cocktail lounge'], 'the crew lines: the name and the room (the costume is GM-side now)');
  assert.deepEqual(model.cards.map((c) => (c.sections.find((s) => s.title === 'Position') || { lines: [] }).lines), [['Showroom'], ['Cocktail lounge']], 'each card says where');
  model.cards.forEach((c) => c.sections.forEach((s) => assert.ok(!['Costume', 'Watch out', 'At home', 'Risky'].includes(s.title), c.id + ' has a ' + s.title + ' section')));
  assert.ok(flat.includes('Showroom'), 'the room');
  assert.equal(model.band.time, '23:30');
  assert.match(model.band.ways, /^Ways found: \d+ of 2$/);
  const none = fakeDoc(); assert.equal(MP.renderPlayersView(none.root, null), null); assert.match(none.root.textContent, /Nothing is published/);
  r.answer = true; await r.ctl.endNight();
  const after = fakeDoc(); MP.renderPlayersView(after.root, r.ctl.last()); assert.match(after.root.textContent, /Nothing is published/, 'after End the night the view is empty');
  assert.equal(MP.renderPlayersView(null, sent), null);
});

await test('before any publish, the Players view shows the mission the campaign document holds (a reload mid-night)', () => {
  const stored = { v: 1, seq: 9, site: 'x', t: 30, hud: { time: '21:30', label: '', now: [], next: [], night: null, alarm: null, crew: [], target: null, ways: { found: 0, total: 0 } }, cards: {} };
  const r = rig({ stored });
  assert.deepEqual(r.ctl.last(), stored);
  assert.equal(MP.playersModel(stored).seq, 9);
  assert.equal(MP.playersModel({ v: 1 }), null);
});

/* ---- Reset the night (VV12) ---- */
await test('resetNight sends { mission: null } with no confirm of its own, clears the ended marker, and the SAME start publishes again (endNight alone would not)', async () => {
  /* the difference: after endNight, the same start key stays off */
  const e = rig(); e.ctl.changed(); await e.advance(800); assert.equal(e.sent.length, 1);
  await e.ctl.endNight(); assert.notEqual(e.ctl._state().endedFor, null, 'endNight leaves the marker');
  e.state.t = T('23:45'); e.ctl.changed(); await e.advance(1600);
  assert.equal(e.sent.length, 2, 'endNight: the same start publishes nothing more (1 publish + 1 null)');
  /* resetNight: no confirm asked (the answer is no, and it still goes), marker cleared */
  const r = rig({ confirm: false }); r.answer = false;
  r.ctl.changed(); await r.advance(800); assert.equal(r.sent.length, 1);
  const res = await r.ctl.resetNight();
  assert.equal(res.ok, true); assert.equal(res.ended, true); assert.equal(r.sent.length, 2); assert.equal(r.sent[1], null, 'PATCH { mission: null }');
  assert.equal(r.ctl._state().endedFor, null, 'the ended-for-this-start marker is cleared');
  assert.equal(r.ctl.last(), null); assert.equal(r.ctl.status().text, '');
  r.state.t = T('23:45'); r.ctl.changed(); await r.advance(800);
  assert.equal(r.sent.length, 3, 'a publish for the SAME start key goes out after the reset');
  assert.ok(r.sent[2] && r.sent[2].hud && r.sent[2].hud.time === '23:45' && r.sent[2].seq > r.sent[0].seq, 'and it is the new time, numbered on');
});

await test('resetNight while a publish is still out: that publish does not land after the reset (gen bumped), and the marker is clear', async () => {
  const q = rig(); const waits = []; const sent = [];
  const ctl = MP.create({ ball: B, source: q.source, namesHit: GP.namesHit, stored: () => null, confirm: () => false,
    send: (m) => (m === null ? Promise.resolve(sent.push(null)) : new Promise((res) => waits.push(() => { sent.push(clone(m)); res(true); }))),
    delay: (fn, ms) => { const h = { fn, at: q.clock + ms }; q.timers.push(h); return h; }, cancel: (h) => { const i = q.timers.indexOf(h); if (i >= 0) q.timers.splice(i, 1); } });
  ctl.changed(); await q.advance(800); assert.equal(waits.length, 1, 'a publish is out');
  const res = await ctl.resetNight(); assert.equal(res.ended, true);
  waits[0](); await sleep(5);
  assert.equal(ctl.last(), null, 'the late landing is ignored: last() stays empty'); assert.equal(ctl.status().text, '');
  assert.equal(ctl._state().endedFor, null);
});

await test('resetNight with a failing send says so, still clears the marker, and leaves the mission as it was', async () => {
  const f = rig(); f.ctl.changed(); await f.advance(800); f.failWith = Object.assign(new Error('503'), { status: 503 });
  const bad = await f.ctl.resetNight();
  assert.equal(bad.ok, false); assert.ok(f.ctl.last(), 'still published'); assert.equal(f.ctl._state().endedFor, null);
  assert.ok(f.toasts.some(([m, b]) => b && /Could not clear the players/.test(m) && /End the night/.test(m)), JSON.stringify(f.toasts));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
