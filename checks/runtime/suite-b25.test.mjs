// Suite B25, tickets 3.2, 3.3 and 3.4 (switches face.expressions, face.formats, face.badge; no browser, no network): the look's names and notes (display/face-look.js), the kit's five
// expressions and the signature poses on three invented specs, the Worker's door for a look (cleanOverlay, joinOverlayNpc), the iPad's face renderer on a small DOM, the motif (plan and
// synth on a fake audio context), and the GM's stage-bar controller. INVENTED data only (the Pelican Rooms cast); GM-ONLY- markers for anything that must never reach the display.
//   node checks/runtime/suite-b25.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MiniEl } from './minidom.mjs';
import { cleanOverlay } from '../../functions/_lib/gm.js';
import { joinOverlayNpc } from '../../functions/_lib/npcs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const require = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
globalThis.self = globalThis;

const F = require(path.join(APP, 'features.js'));
const FL = require(path.join(APP, 'display', 'face-look.js'));
const Motif = require(path.join(APP, 'display', 'face-motif.js'));
const K = require(path.join(APP, 'figures', 'figure-kit.js'));
globalThis.B68FaceLook = FL;
const FR = require(path.join(APP, 'display', 'face-render.js'));
const FM = require(path.join(APP, 'display', 'face-formats.js'));
const BD = require(path.join(APP, 'display', 'face-badge.js'));
const GL = require(path.join(APP, 'gm', 'face-looks.js'));
const Spot = require(path.join(APP, 'gm', 'spotlight.js'));

/* three invented figures (the Pelican Rooms cast) */
const SPECS = [
  { id: 'pr-mabel', seed: 11, figure: 'fem', age: 'adult', face: { brows: 'arched' } },
  { id: 'pr-dov', seed: 42, figure: 'masc', build: 'average', age: 'adult', hair: { style: 'short', color: '#3a2a1c' } },
  { id: 'pr-ada', seed: 77, figure: 'masc', age: 'old', face: {} }
];
const doc = () => { const d = { createElement: (t) => { const e = new MiniEl(t); e.ownerDocument = d; e.style = {}; return e; }, createElementNS: (n, t) => d.createElement(t) }; return d; };
const all = (n, f, acc = []) => { if (f(n)) acc.push(n); (n.children || []).forEach((c) => all(c, f, acc)); return acc; };
const hasClass = (n, c) => String(n.className || '').split(/\s+/).includes(c);

await test('registry: the three switches are default off, in the figures stage, on the iPad; their lines are plain GM-side text', () => {
  for (const id of ['face.expressions', 'face.formats', 'face.badge']) {
    const s = F.get(id); assert.ok(s, id); assert.equal(s.default, false); assert.equal(s.stage, 'face'); assert.equal(s.surface, 'display');
    assert.ok(s.label && s.doc.length > 40, id);
  }
  assert.equal(F.get('face.formats').saturday, 'off'); assert.equal(F.get('face.expressions').saturday, 'try'); assert.equal(F.get('face.badge').saturday, 'try');
});

await test('look: clean keeps names from the fixed lists and nothing else; junk is dropped; an empty look is nothing', () => {
  assert.deepEqual(FL.clean({ expr: 'afraid', pose: 'lapel', fmt: 'passport', re: true, text: 'GM-ONLY-x', extra: 1 }), { expr: 'afraid', pose: 'lapel', fmt: 'passport', re: true });
  assert.deepEqual(FL.clean({ expr: 'smirk' }), { expr: 'smirk' });
  assert.equal(FL.clean({ expr: 'bogus', pose: 'dance', fmt: 'x', re: 1 }), null);
  assert.equal(FL.clean(null), null); assert.equal(FL.clean([]), null); assert.equal(FL.clean('afraid'), null);
  assert.equal(FL.FMTS.length, 5); assert.ok(['neutral', 'pleased', 'hostile', 'afraid'].every((e) => FL.EXPRS.includes(e)));
});

await test('look: the notes lines are read by name, in bullets and bold, never inside a code fence; an unknown word is no tell', () => {
  const n = FL.parseNotes('Plays dumb.\n- **Tell:** Smirk — touches his cuff\nSignature: lapel\n> Relation: Resident\n');
  assert.deepEqual(n, { tell: 'smirk', signature: 'lapel', fmt: 'licence' });
  assert.deepEqual(FL.parseNotes('```\nTell: smirk\n```\nTell: grumpy\nSignature: dance\nRelation: nobody'), { tell: '', signature: '', fmt: '' });
  assert.equal(FL.parseNotes('Relation: staff').fmt, 'badge'); assert.equal(FL.parseNotes('Relation: suspect').fmt, 'mugshot'); assert.equal(FL.parseNotes('Relation: socialite').fmt, 'society');
  assert.equal(FL.parseNotes('Relation: visitor').fmt, 'passport'); assert.equal(FL.parseNotes('Relation: mugshot').fmt, 'mugshot', 'a format name is taken as it is');
  assert.deepEqual(FL.parseNotes(undefined), { tell: '', signature: '', fmt: '' });
});

await test('kit: all five expressions (neutral, pleased, hostile, afraid, a tell) render with no warnings on three invented specs, and each differs from neutral', () => {
  assert.equal(FR.ensureAfraid(K), true); assert.equal(FR.ensureAfraid(K), true, 'registering twice is harmless');
  for (const sp of SPECS) {
    const base = K.portrait(FL.specWith(sp, { expr: 'neutral' }), { lod: 'mid' }); assert.deepEqual(base.warnings, [], sp.id + ' neutral');
    for (const e of ['pleased', 'hostile', 'afraid', 'smirk']) {
      const r = K.portrait(FL.specWith(sp, { expr: e }), { lod: 'mid' });
      assert.deepEqual(r.warnings, [], sp.id + ' ' + e); assert.notEqual(r.svg, base.svg, sp.id + ' ' + e + ' is a different face');
    }
    for (const e of FL.TELLS) assert.deepEqual(K.portrait(FL.specWith(sp, { expr: e }), { lod: 'lo' }).warnings, [], sp.id + ' tell ' + e);
  }
});

await test('kit: the signature poses draw with no warnings on all three specs, and the pose changes the figure', () => {
  for (const sp of SPECS) {
    const base = K.render(sp, { height: 900 });
    for (const p of FL.POSES) { const r = K.render(FL.poseSpec(sp, p), { height: 900 }); assert.deepEqual(r.warnings, [], sp.id + ' ' + p); }
    assert.notEqual(K.render(FL.poseSpec(sp, 'lapel'), { height: 900 }).svg, base.svg);
  }
});

await test('kit: a spec with no expression named renders byte for byte as before (the afraid part changes no other face); specWith hands the same object back', () => {
  const fresh = require(path.join(APP, 'figures', 'figure-kit.js'));
  for (const sp of SPECS) {
    assert.equal(FL.specWith(sp, {}), sp); assert.equal(FL.specWith(sp, null), sp); assert.equal(FL.specWith(sp, { expr: 'nonsense' }), sp);
    assert.equal(FL.poseSpec(sp, 'dance'), sp);
    assert.equal(K.portrait(sp, { lod: 'mid' }).svg, fresh.portrait(sp, { lod: 'mid' }).svg);
    for (const e of ['smile', 'scowl', 'smirk', 'neutral']) { const s2 = { ...sp, face: { ...(sp.face || {}), expression: e } }; assert.equal(K.portrait(s2, { lod: 'mid' }).svg, K.portrait(s2, { lod: 'mid' }).svg); }
  }
  assert.equal(FL.specWith({ id: 'x', face: { eyes: 'almond' } }, { expr: 'hostile' }).face.eyes, 'almond', 'the rest of the face is kept');
  assert.equal(SPECS[0].face.expression, undefined, 'the stored spec is not changed');
});

await test('server: an npc overlay may carry a look of names, nothing else; a junk look is dropped, a look that is not an object is refused; other kinds carry none', () => {
  const base = { id: 'b17sl-1', kind: 'npc', ms: 180000, npcId: 'npc_pr_mabel' };
  assert.deepEqual(cleanOverlay({ ...base, look: { expr: 'afraid', fmt: 'badge', text: 'GM-ONLY-leak', junk: 1 } }).look, { expr: 'afraid', fmt: 'badge' });
  assert.ok(!('look' in cleanOverlay({ ...base, look: { expr: 'bogus' } })), 'a look with no valid name is left off');
  assert.ok(!('look' in cleanOverlay(base)), 'no look, no key: the overlay is exactly as it was');
  assert.throws(() => cleanOverlay({ ...base, look: 'afraid' }), /look must be an object/);
  assert.ok(!('look' in cleanOverlay({ id: 't', kind: 'text', ms: 5000, text: 'A line.', look: { expr: 'afraid' } })));
});

await test('server: the display GET joins the look through named keys again, still one read, never the notes; a hidden NPC drops the whole overlay', async () => {
  const row = (d) => ({ id: 'npc_pr_mabel', campaign: 'camp', deleted: 0, doc: JSON.stringify(d) });
  const dbOf = (r) => { const db = { reads: 0, prepare() { return { bind: () => ({ first: async () => { db.reads++; return r; } }) }; } }; return db; };
  const live = { name: 'Mabel Quist', alias: 'Mab', role: 'Fixer', faction: 'The Kestrel Club', revealed: true, gmNotes: 'GM-ONLY-NOTES Tell: smirk', spec: SPECS[0] };
  const ov = { id: 'o1', kind: 'npc', ms: 20000, npcId: 'npc_pr_mabel', at: '2026-11-04T00:00:00.000Z', look: { expr: 'afraid', pose: 'lapel', text: 'GM-ONLY-x' } };
  const db = dbOf(row(live));
  const r = await joinOverlayNpc(db, 'camp', { seq: 1, doc: { mode: 'auto', overlay: ov }, updatedAt: 'x' });
  assert.deepEqual(r.amb.doc.overlay.look, { expr: 'afraid', pose: 'lapel' }); assert.equal(db.reads, 1, 'no new read');
  assert.ok(!/GM-ONLY/.test(JSON.stringify(r.amb)), 'no notes and no stray text');
  const none = await joinOverlayNpc(dbOf(row(live)), 'camp', { seq: 1, doc: { overlay: { ...ov, look: undefined } }, updatedAt: 'x' });
  assert.ok(!('look' in none.amb.doc.overlay), 'no look stays no key');
  const hid = await joinOverlayNpc(dbOf(row({ ...live, revealed: false })), 'camp', { seq: 1, doc: { overlay: ov }, updatedAt: 'x' });
  assert.equal(hid.dropped, true); assert.ok(!('overlay' in hid.amb.doc), 'a hidden NPC never reaches the display, look or not');
});

/* the renderer on a small DOM */
const npcOv = (look, extra) => ({ id: 'b17sl-aaa', kind: 'npc', npcId: 'npc_pr_dov', npc: { faction: 'The Tidewater Watch', role: 'Desk sergeant' }, look, ...extra });
function card(d) {
  const e = d.createElement('div'); e.className = 'dp-ov-card dp-ov-npc';
  const h = d.createElement('div'); h.className = 'dp-ov-portrait'; h.appendChild(d.createElement('svg')); e.appendChild(h);
  const k = d.createElement('p'); k.className = 'dp-kicker'; k.textContent = 'Desk sergeant · The Tidewater Watch'; e.appendChild(k);
  const n = d.createElement('p'); n.className = 'dp-ov-name'; n.textContent = 'Dov Kessler'; e.appendChild(n);
  return e;
}
const baseCard = { kind: 'npc', name: 'Dov Kessler', alias: '', sub: 'Desk sergeant · The Tidewater Watch', spec: SPECS[1] };
function envOf(d, features, extra) {
  const log = { later: [], drawn: [], motif: [] };
  return Object.assign({ document: d, K, features, reduced: false,
    later: (fn, ms) => { log.later.push({ fn, ms }); return log.later.length; }, ducked: () => false,
    portrait: (spec, id) => { log.drawn.push(spec.face && spec.face.expression); const s = d.createElement('svg'); s.className = 'drawn'; return s; },
    figure: (spec, id) => { log.drawn.push('figure:' + (spec.pose && spec.pose.arms && spec.pose.arms.R)); return d.createElement('svg'); },
    motif: { plan: Motif.plan, play: (p, o) => { log.motif.push(p); return true; } }, log }, extra);
}

await test('render: with all three switches off, or no look, nothing is touched and apply says so', () => {
  const d = doc(), e = card(d), before = JSON.stringify([e.className, e.children.map((c) => c.className)]);
  const env = envOf(d, {});
  assert.equal(FR.apply(e, baseCard, npcOv({ expr: 'afraid', fmt: 'badge', pose: 'lapel' }), env), false);
  assert.equal(JSON.stringify([e.className, e.children.map((c) => c.className)]), before); assert.equal(env.log.drawn.length, 0); assert.equal(env.log.motif.length, 0);
  assert.equal(FR.apply(e, baseCard, npcOv(null), envOf(d, { 'face.expressions': true, 'face.formats': true })), false, 'switches on but nothing asked: still the plain card');
  assert.equal(FR.active(env), false);
});

await test('render: an expression redraws the portrait with that face and no more; a switch that is off ignores its own names', () => {
  const d = doc(), e = card(d), env = envOf(d, { 'face.expressions': true });
  assert.equal(FR.apply(e, baseCard, npcOv({ expr: 'hostile', fmt: 'badge' }), env), true);
  assert.deepEqual(env.log.drawn, ['scowl']); assert.equal(e.children.some((c) => /dp-fl/.test(c.className)), false, 'the format switch is off: no frame');
  const d2 = doc(), e2 = card(d2), env2 = envOf(d2, { 'face.formats': true });
  assert.equal(FR.apply(e2, baseCard, npcOv({ expr: 'hostile', fmt: 'badge' }), env2), true); assert.deepEqual(env2.log.drawn, [], 'the expression switch is off: the face is as served');
  assert.ok(e2.children.some((c) => hasClass(c, 'dp-fl-badge')));
});

await test('render: each of the five formats frames the same face, with the faction colour, and the card keeps its own portrait holder inside the frame', () => {
  for (const fmt of FL.FMTS) {
    const d = doc(), e = card(d), env = envOf(d, { 'face.formats': true });
    assert.equal(FR.apply(e, baseCard, npcOv({ fmt }), env), true, fmt);
    const fr = e.children.find((c) => hasClass(c, 'dp-fl-' + fmt)); assert.ok(fr, fmt + ' frame');
    assert.ok(hasClass(fr, 'dp-fl-c' + FL.slotOf('The Tidewater Watch')), 'the faction slot colour');
    assert.ok(all(fr, (n) => hasClass(n, 'dp-ov-portrait')).length === 1, 'the drawn face sits inside the frame');
    assert.ok(all(fr, (n) => n.tagName === 'FILTER').length === 1, 'a duotone filter of its own');
    assert.ok(hasClass(e, 'dp-fl-framed'));
    assert.equal(e.children.filter((c) => hasClass(c, 'dp-ov-portrait')).length, 0, 'the holder moved into the frame, not copied');
    assert.ok(/Dov Kessler/i.test(fr.textContent) || fmt === 'badge' || fmt === 'society' || fmt === 'passport' || fmt === 'mugshot', fmt);
  }
  const d = doc(), e = card(d); FR.apply(e, baseCard, npcOv({ fmt: 'passport' }), envOf(d, { 'face.formats': true }));
  assert.ok(/P<DOV<KESSLER/.test(e.textContent), 'the passport machine line is made from the name');
});

await test('render: the badge is a stable number and glyph, the faction style classes, and the same for the same person every time', () => {
  const run = () => { const d = doc(), e = card(d); FR.apply(e, baseCard, npcOv(null), envOf(d, { 'face.badge': true })); return e; };
  const a = run(), b = run(), no = /No\. \d{3}/.exec(a.textContent);
  assert.ok(no, a.textContent); assert.equal(no[0], FL.numberOf('npc_pr_dov')); assert.equal(no[0], /No\. \d{3}/.exec(b.textContent)[0]);
  assert.notEqual(FL.numberOf('npc_pr_dov'), FL.numberOf('npc_pr_ada'), 'a different person, a different number');
  const slot = FL.slotOf('The Tidewater Watch'); assert.ok(slot >= 1 && slot <= 6);
  assert.ok(hasClass(a, 'dp-fl-st-' + slot) && hasClass(a, 'dp-fl-tx-' + BD.STYLES[slot].texture) && hasClass(a, 'dp-fl-ty-' + BD.STYLES[slot].face));
  assert.equal(all(a, (n) => hasClass(n, 'dp-fl-glyph')).length, 1);
  assert.equal(FL.slotOf('the  tidewater   WATCH'), slot, 'the slot ignores case and spacing'); assert.equal(FL.slotOf(''), 0);
  const d = doc(), e = card(d), c2 = { ...baseCard }; FR.apply(e, c2, { ...npcOv(null), npc: { faction: '', role: '' } }, envOf(d, { 'face.badge': true }));
  assert.ok(/No\. \d{3}/.test(e.textContent) && !hasClass(e, 'dp-fl-styled'), 'a person with no faction has a number and no style');
});

await test('render: the signature pose plays once for 3.2 seconds then goes; a renewed hold keeps the expression, drops the pose and does not replay the motif', () => {
  const d = doc(), e = card(d), env = envOf(d, { 'face.expressions': true, 'face.badge': true });
  assert.equal(FR.apply(e, baseCard, npcOv({ expr: 'afraid', pose: 'lapel' }), env), true);
  assert.equal(all(e, (n) => hasClass(n, 'dp-fl-pose')).length, 1, 'the pose layer is up'); assert.ok(env.log.drawn.includes('figure:lapel'));
  const t = env.log.later.find((x) => x.ms === FR.POSE_MS); assert.ok(t); t.fn(); assert.equal(all(e, (n) => hasClass(n, 'dp-fl-pose')).length, 0, 'and it is gone');
  assert.equal(env.log.motif.length, 1, 'the motif played once on first sight');
  const d2 = doc(), e2 = card(d2), env2 = envOf(d2, { 'face.expressions': true, 'face.badge': true });
  FR.apply(e2, baseCard, npcOv({ expr: 'afraid', pose: 'lapel', re: true }), env2);
  assert.equal(all(e2, (n) => hasClass(n, 'dp-fl-pose')).length, 0); assert.equal(env2.log.motif.length, 0); assert.ok(env2.log.drawn.includes('scowl') === false && env2.log.drawn[0] === 'afraid');
});

await test('render: a portrait the page cannot draw leaves the plain portrait; a thrown draw is swallowed', () => {
  const d = doc(), e = card(d), env = envOf(d, { 'face.expressions': true }, { portrait: () => { throw new Error('x'); } });
  assert.equal(FR.apply(e, baseCard, npcOv({ expr: 'sad' }), env), false);
  assert.equal(all(e, (n) => n.className === 'dp-ov-portrait')[0].children.length, 1, 'the original drawing is still there');
});

await test('motif: the plan is the same for the same seed, 3 to 6 seconds all told, starts and ends on the root, and each faction slot has its own instrument', () => {
  const seen = new Set();
  for (let seed = 1; seed < 400; seed += 7) for (let slot = 0; slot <= 6; slot++) {
    const p = Motif.plan(FL.hash('motif:' + seed), slot), again = Motif.plan(FL.hash('motif:' + seed), slot);
    assert.deepEqual(p, again);
    const last = p.notes[p.notes.length - 1], tail = p.voice === 'bells' ? 1 : 0.5, heard = last.t + last.d + tail;
    assert.ok(p.total >= 3 && p.total <= 4.81, 'notes ' + p.total); assert.ok(heard >= 3 && heard <= 6, 'heard ' + heard);
    assert.ok(p.notes.length >= 5 && p.notes.length <= 8); assert.equal(p.notes[0].f, last.f, 'a motif resolves on its root');
    for (let i = 1; i < p.notes.length; i++) assert.ok(Math.abs(p.notes[i].t - (p.notes[i - 1].t + p.notes[i - 1].d)) < 0.01, 'notes follow one another');
    seen.add(p.voice);
  }
  assert.equal(seen.size, 7); assert.notDeepEqual(Motif.plan(1, 2).notes, Motif.plan(2, 2).notes);
  assert.equal(JSON.stringify(Motif.plan(5, 3)).length < 2000, true, 'a plan is small data: no audio file');
});

await test('motif: synth schedules every note on a fake context, ducks 12 dB while the duck is up and lets go after, and stops itself', () => {
  const calls = [];
  const param = (n) => ({ setValueAtTime: (v, t) => calls.push([n, 'set', v]), linearRampToValueAtTime: () => {}, setTargetAtTime: (v) => calls.push([n, 'target', v]), cancelScheduledValues: () => {} });
  let now = 10, oscs = 0, gains = [];
  const ctx = { get currentTime() { return now; }, destination: {}, createGain: () => { const g = { gain: param('g' + gains.length), connect() {}, disconnect() {} }; gains.push(g); return g; },
    createOscillator: () => { oscs++; return { type: '', frequency: param('f'), detune: param('d'), connect() {}, start() {}, stop() {} }; } };
  let duck = true, timers = [];
  const o = { level: 0.2, ducked: () => duck, later: (fn, ms) => { timers.push(fn); return timers.length; }, cancel() {} };
  const p = Motif.plan(99, 3), h = Motif.synth(ctx, p, o);
  assert.ok(oscs >= p.notes.length, 'at least one oscillator for each note: ' + oscs);
  const first = calls.find((c) => c[0] === 'g0' && c[1] === 'set'); assert.ok(Math.abs(first[2] - 0.2 * Motif.DUCK_GAIN) < 1e-9, 'the master starts 12 dB down');
  assert.ok(Math.abs(Motif.DUCK_GAIN - 0.251) < 0.001);
  duck = false; now = 11; timers.shift()();
  assert.ok(calls.some((c) => c[0] === 'g0' && c[1] === 'target' && Math.abs(c[2] - 0.2) < 1e-9), 'the level comes back when the duck lets go');
  now = h.endsAt + 1; let guard = 0; while (timers.length && guard++ < 5) timers.shift()();
  assert.ok(calls.some((c) => c[0] === 'g0' && c[1] === 'target' && c[2] === 0), 'and it fades out at the end');
});

await test('motif: play is silent and false where there is no running context (the iPad parks it behind the ring switch)', () => {
  Motif.setContext(null); assert.equal(Motif.play(Motif.plan(1, 1), {}), false);
  Motif.setContext({ state: 'suspended' }); assert.equal(Motif.play(Motif.plan(1, 1), {}), false);
  Motif.setContext({ state: 'running', currentTime: 0, destination: {}, createGain: () => { throw new Error('no audio'); } }); assert.equal(Motif.play(Motif.plan(1, 1), {}), false, 'a context that throws is swallowed');
  let resumed = 0; Motif.setContext({ state: 'suspended', resume: () => { resumed++; return Promise.resolve(); } }); assert.equal(Motif.unlock(), false); assert.equal(resumed, 1, 'a tap asks it to resume');
  Motif.setContext(null);
});

/* the GM's side */
function spotHost(on, notes, log) {
  return { feature: (id) => on.includes(id), npcs: () => [{ id: 'npc_pr_dov', name: 'Dov Kessler', alias: '', revealed: true }], notes: (id) => notes[id] || '',
    hold: function (id, ms, look) { log.holds.push({ args: arguments.length, id, look }); return Promise.resolve({ ok: true }); }, clear: () => Promise.resolve(),
    overlayId: () => 'b17sl-1', confirm: () => true, reveal: () => Promise.resolve(), toast: (m, bad) => log.toasts.push(m), changed() {}, roomKey: () => '', roomMd: () => '',
    setTimeout: (fn, ms) => { log.timers.push(fn); return log.timers.length; }, clearTimeout() {} };
}
const NOTES = { npc_pr_dov: 'Plays dumb.\nTell: smirk — touches his cuff\nSignature: lapel\nRelation: staff' };

await test('GM: with every face switch off the held overlay is sent exactly as before (no look, no third argument)', async () => {
  const log = { holds: [], toasts: [], timers: [] }, c = Spot.create(spotHost(['face.spotlight'], NOTES, log));
  await c.spotlight('npc_pr_dov'); assert.equal(log.holds.length, 1); assert.equal(log.holds[0].args, 2, 'hold(id, ms) only'); assert.equal(c.view().faces, null);
  assert.equal(await c.express('afraid'), false); assert.equal(await c.signature(), false); assert.equal(log.holds.length, 1);
  await log.timers.shift()(); assert.equal(log.holds[1].args, 2, 'the renewal is as before too');
});

await test('GM: five expression buttons on the spotlight bar; each lays the held person again with that look; the tell comes from the notes', async () => {
  const log = { holds: [], toasts: [], timers: [] }, c = Spot.create(spotHost(['face.spotlight', 'face.expressions', 'face.formats'], NOTES, log));
  await c.spotlight('npc_pr_dov'); assert.deepEqual(log.holds[0].look, { fmt: 'badge' }, 'the format from the Relation line, no expression yet');
  const v = c.view(); assert.ok(v.faces && v.faces.on); const html = Spot.html(v);
  assert.deepEqual([...html.matchAll(/data-b17="expr" data-expr="(\w+)"/g)].map((m) => m[1]), ['neutral', 'pleased', 'hostile', 'afraid', 'tell']);
  assert.ok(/data-b17="sig"/.test(html) && !/data-b17="sig" disabled/.test(html), 'Signature is on: the notes name one');
  for (const [name, want] of [['neutral', 'neutral'], ['pleased', 'pleased'], ['hostile', 'hostile'], ['afraid', 'afraid'], ['tell', 'smirk']]) {
    assert.equal(await c.express(name), true, name); assert.equal(log.holds[log.holds.length - 1].look.expr, want, name); assert.equal(log.holds[log.holds.length - 1].look.re, true, name + ': a change of face is not a new spotlight (no motif replay)'); assert.equal(log.holds[log.holds.length - 1].look.fmt, 'badge', 'the format stays');
  }
  /* the signature goes in one overlay only, and the renewal after it drops it but keeps the expression and says it is a renewal */
  await c.signature(); assert.equal(log.holds[log.holds.length - 1].look.pose, 'lapel'); assert.ok(!log.holds[log.holds.length - 1].look.re, 'the signature is not marked a renewal, so its pose plays'); assert.equal(log.holds[log.holds.length - 1].look.expr, 'smirk');
  await log.timers[log.timers.length - 1](); const re = log.holds[log.holds.length - 1].look;
  assert.deepEqual(re, { fmt: 'badge', expr: 'smirk', re: true });
  await c.narrator(); assert.equal(c.view().faces, null);
});

await test('GM: a person with no tell or signature line gets a disabled button and a toast saying where to write it; no hidden-NPC shortcut: the server still decides', async () => {
  const log = { holds: [], toasts: [], timers: [] }, c = Spot.create(spotHost(['face.spotlight', 'face.expressions'], { npc_pr_dov: 'Plays dumb.' }, log));
  await c.spotlight('npc_pr_dov'); const html = Spot.html(c.view());
  assert.ok(/data-expr="tell" disabled/.test(html) && /data-b17="sig" disabled/.test(html));
  const n = log.holds.length; assert.equal(await c.express('tell'), false); assert.equal(await c.signature(), false); assert.equal(log.holds.length, n); assert.ok(log.toasts.some((t) => /Tell: smirk/.test(t)) && log.toasts.some((t) => /Signature: lapel/.test(t)));
  assert.equal(log.holds[0].args, 2, 'with no format asked for and no expression yet the overlay is the plain one');
});

await test('GM: a badge-only table sends a renewal flagged as one, so the motif is not replayed', async () => {
  const log = { holds: [], toasts: [], timers: [] }, c = Spot.create(spotHost(['face.spotlight', 'face.badge'], NOTES, log));
  await c.spotlight('npc_pr_dov'); assert.equal(log.holds[0].args, 2); await log.timers.shift()(); assert.deepEqual(log.holds[1].look, { re: true });
});

await test('GM: the controller\'s notes are read for names only: the look it sends has no free text', async () => {
  const log = { holds: [], toasts: [], timers: [] }, c = Spot.create(spotHost(['face.spotlight', 'face.expressions', 'face.formats'], { npc_pr_dov: 'GM-ONLY-SECRET plan\nTell: smirk GM-ONLY-quote\nRelation: staff' }, log));
  await c.spotlight('npc_pr_dov'); await c.express('tell');
  assert.ok(!/GM-ONLY/.test(JSON.stringify(log.holds)), 'only names go out');
});

await test('files: bundled where they belong (the iPad and the GM page, never a phone), in order, and registered for the look book; new files hold no campaign name', () => {
  const B = (() => { const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(APP, 'routes.js'), 'utf8'), ctx, { filename: 'routes.js' }); return ctx.window.B68Load ? ctx.window.B68Load.BUNDLES : ctx.window.BUNDLES; })();
  for (const f of ['display/face-look.js', 'display/face-motif.js', 'display/face-formats.js', 'display/face-badge.js', 'display/face-render.js']) { assert.ok(B.display.includes(f), f); assert.ok(B.display.indexOf(f) < B.display.indexOf('display-page.js'), f + ' before the page'); }
  for (const f of ['display/face-look.js', 'display/face-formats.js', 'display/face-badge.js']) assert.ok(B.display.indexOf(f) < B.display.indexOf('display/face-render.js'), f + ' before the renderer');
  assert.ok(B.gm.includes('display/face-look.js') && B.gm.includes('gm/face-looks.js')); assert.ok(B.gm.indexOf('gm/face-looks.js') < B.gm.indexOf('gm/spotlight.js'));
  for (const name of ['core', 'table', 'print', 'crews', 'figures', 'commend', 'debrief', 'quiet', 'board', 'claims']) for (const f of ['display/face-look.js', 'display/face-motif.js', 'display/face-formats.js', 'display/face-badge.js', 'display/face-render.js', 'gm/face-looks.js']) assert.ok(!(B[name] || []).includes(f), name + ' has no ' + f);
  const sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8'); assert.ok(/bundleFiles/.test(sw), 'sw.js builds its list from the bundles');
  assert.ok(fs.readFileSync(path.join(APP, 'display', 'face-cards.css'), 'utf8').includes('dp-fl-pose'));
  for (const f of ['display/face-look.js', 'display/face-motif.js', 'display/face-render.js', 'gm/face-looks.js']) assert.ok(!/api\.anthropic|ANTHROPIC|fetch\(|XMLHttpRequest/.test(fs.readFileSync(path.join(APP, f), 'utf8')), f + ' makes no call');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
