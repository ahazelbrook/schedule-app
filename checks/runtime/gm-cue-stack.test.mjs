// Unit test for the cue stack (suite 4.1, app/gm/cue-stack.js, switch room.cues): the `## Cues` format, STANDBY and GO against a fake host, the one 500 ms lock, Bypass and Back,
// the panic key and its Resume, the keys, "Blade, go" through the real cue.js and cue-verbs.js and the Worker's validateActions, and the switch off (nothing is built, nothing is heard).
// Invented names only (the Pelican Rooms); every GM-only string is a GM-ONLY- marker. No network, no model, no browser.
//   node checks/runtime/gm-cue-stack.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const Cue = require(path.join(ROOT, 'app', 'cue.js'));
const V = require(path.join(ROOT, 'app', 'cue-verbs.js'));
const CS = require(path.join(ROOT, 'app', 'gm', 'cue-stack.js'));
const G = require(path.join(ROOT, 'app', 'gm', 'cue-grammar.js'));
const F = require(path.join(ROOT, 'app', 'features.js'));
const hands = await import(pathToFileURL(path.join(ROOT, 'functions', '_lib', 'assist', 'hands.js')).href);

let failed = 0, passed = 0;
async function test(name, fn) {
  V.reset();
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } finally { V.reset(); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const NOTE_SRC = [
  '# Pelican Rooms night', '', '## Run order', '| # | About | Time |', '|---|---|---|', '| 1 | Doors | 5 min |', '',
  '## Cues', 'safe: testcard',
  '1. scene: harvest',
  '2. show: title: The Pelican Rooms | A night out',
  '3. sound: Band strikes up',
  '4. reveal: Ada Quill',
  '5. phase: score',
  '6. light: Lamps down, amber',
  '7. practical: Three knocks at the door',
  'a line that is not a cue',
  '```', '8. scene: inside-a-fence', '```',
  '', '## After', '9. light: not in the Cues section'
].join('\n');
const NOTE = { id: 'n-pelican', title: 'Pelican Rooms night', blocks: [{ k: 'md', src: NOTE_SRC }, { k: 'embed', from: 'Elsewhere.md', src: '## Cues\n1. scene: GM-ONLY-EMBED' }] };

/* a fake page: a state document the host patches (deep merge, null deletes, arrays replace), a log of every effect, a clock the test moves, and a small fake DOM */
function merge(doc, p) { const out = JSON.parse(JSON.stringify(doc || {})); for (const k of Object.keys(p)) { const v = p[k]; if (v === null || v === undefined) delete out[k]; else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = merge(out[k] && typeof out[k] === 'object' ? out[k] : {}, v); else out[k] = JSON.parse(JSON.stringify(v)); } return out; }
function fakeEl(doc, tag) {
  const e = { tagName: tag.toUpperCase(), ownerDocument: doc, attrs: {}, className: '', id: '', innerHTML: '', parentNode: null, children: [], listeners: {},
    setAttribute(k, v) { e.attrs[k] = v; }, getAttribute(k) { return e.attrs[k] === undefined ? null : e.attrs[k]; }, addEventListener(t, fn) { e.listeners[t] = fn; },
    insertBefore(n, ref) { n.parentNode = e; const i = ref ? e.children.indexOf(ref) : -1; if (i < 0) e.children.push(n); else e.children.splice(i, 0, n); return n; },
    removeChild(n) { e.children = e.children.filter((x) => x !== n); n.parentNode = null; return n; },
    querySelector() { return null; }, get firstChild() { return e.children[0] || null; } };
  return e;
}
function makeHost(over = {}) {
  const log = { scenes: [], shows: [], revealed: [], phases: [], panics: [], resumes: [], toasts: [], cues: [], patches: 0 };
  const flags = Object.assign({ 'room.cues': true, 'ai.grammar': false }, over.on || {});
  const clock = { t: 1_000_000 };
  const state = { doc: {} };
  const doc = { listeners: {}, dialog: false, addEventListener(t, fn) { doc.listeners[t] = fn; }, removeEventListener(t) { delete doc.listeners[t]; }, querySelector(sel) { return /dialog/.test(sel) && doc.dialog ? {} : null; } };
  const root = fakeEl(doc, 'div'); doc.createElement = (tag) => fakeEl(doc, tag);
  const npcs = [{ name: 'Ada Quill', revealed: false }];
  const host = {
    feature: () => !!flags['room.cues'], note: () => (over.noNote ? null : (over.note || NOTE)), doc: () => state.doc,
    patch: (p) => { log.patches++; state.doc = merge(state.doc, p); return true; }, now: () => clock.t, toast: (m, bad) => log.toasts.push([m, !!bad]), root: () => root,
    log: (t) => log.cues.push(t),
    scene: async (id) => { log.scenes.push(id); return !over.failScene; },
    show: async (kind, payload, o) => { log.shows.push([kind, payload, o.key]); return over.failShow ? null : {}; },
    reveal: async (name) => { log.revealed.push(name); return npcs.some((n) => n.name === name) ? { ok: true } : { ok: false, say: 'No NPC called ' + name + '.' }; },
    phase: async (p) => { log.phases.push(p); return true; },
    ambient: () => ({ mode: 'pin', scene: 'harvest' }),
    panic: async (safe) => { log.panics.push(safe); if (over.panicMs) await sleep(over.panicMs); return true; },
    resume: async (prior) => { log.resumes.push(prior); return {}; },
    cueVerbs: () => V, grammar: () => G, grammarOn: () => !!flags['ai.grammar']
  };
  return { host, log, flags, clock, state, doc, root };
}
const advance = (m, ms = 600) => { m.clock.t += ms; };
const state = (m) => CS.cleanState(m.state.doc.cues, 'n-pelican');

await test('the Cues section: numbered lines in order; the safe scene; show payloads; fenced, transcluded and later-section lines ignored; a line that is no cue is listed, not guessed', () => {
  const p = CS.parse(NOTE);
  assert.deepEqual(p.cues.map((c) => c.n + ':' + c.kind), ['1:scene', '2:show', '3:sound', '4:reveal', '5:phase', '6:light', '7:practical']);
  assert.equal(p.safe, 'testcard');
  assert.deepEqual(p.cues[1].show, { kind: 'title', payload: { text: 'The Pelican Rooms', sub: 'A night out' } });
  assert.equal(p.cues[4].arg, 'score'); assert.equal(p.cues[0].arg, 'harvest');
  assert.deepEqual(p.skipped, ['a line that is not a cue']);
  assert.equal(CS.parse('# Nothing\n\n1. scene: harvest').cues.length, 0, 'a numbered line outside a Cues section is not a cue');
  assert.equal(CS.parse('## Cues\n1. scene: a\n1. scene: b\n2. nonsense: x\n3. show: unknownkind: x\n4. phase: nowhere').cues.length, 1, 'a repeated number, an unknown kind, a bad show and a bad phase are skipped');
  assert.equal(CS.parse(NOTE_SRC.replace('safe: testcard', '')).safe, 'testcard', 'the default safe scene is the test card');
  assert.equal(CS.parse('## Cues\nsafe: Harvest\n1) light: x').safe, 'harvest'); assert.equal(CS.parse('## Cues\n1) light: x').cues[0].n, 1, '1) is a number too');
  assert.deepEqual(CS.parse(null).cues, []); assert.deepEqual(CS.parse({}).cues, []);
});

await test('the switch is registered, GM-only, default off; and with it off nothing is built: no bar, no keys, GO and Esc do nothing, the spoken verb is not heard', async () => {
  const s = F.get('room.cues'); assert.ok(s); assert.equal(s.surface, 'gm'); assert.equal(s.default, false); assert.equal(s.stage, 'room');
  assert.ok(!/[A-Z][a-z]+ [A-Z][a-z]+ (night|ball)/.test(s.doc), 'bland text');
  const m = makeHost({ on: { 'room.cues': false } }); const c = CS.create(m.host); c.register(); c.bind(m.doc); c.paint();
  assert.equal(m.root.children.length, 0, 'no bar'); assert.equal(V.phraseAt(['go']), null); assert.equal(V.has('cuego'), false);
  assert.equal((await c.go('key')).reason, 'off'); assert.equal((await c.panic('key')).reason, 'off'); assert.equal(c.bypass().reason, 'off');
  m.doc.listeners.keydown({ key: ' ', target: { tagName: 'BODY' }, preventDefault() { assert.fail('Space is the page\'s own'); } });
  m.doc.listeners.keydown({ key: 'Escape', target: { tagName: 'BODY' } });
  assert.deepEqual(m.log.scenes.concat(m.log.panics), []); assert.equal(m.log.patches, 0, 'nothing written');
  assert.equal(Cue.find('Blade, go', { clocks: [], pcs: [], rooms: [] }), null, 'and "Blade, go" is not a cue');
});

await test('STANDBY is the first cue not done; GO fires it through the host and the position is kept in the state document (a new controller on the same document picks it up)', async () => {
  const m = makeHost(); const c = CS.create(m.host); c.paint();
  assert.equal(c.view().standby.n, 1); assert.match(m.root.children[0].innerHTML, /STANDBY/); assert.match(m.root.children[0].innerHTML, /#1 SCENE/);
  assert.equal((await c.go('key')).n, 1); assert.deepEqual(m.log.scenes, ['harvest']);
  assert.deepEqual(m.state.doc.cues.seq, [[1, 'f']]); assert.equal(c.view().standby.n, 2);
  advance(m); assert.equal((await c.go('button')).n, 2);
  assert.deepEqual(m.log.shows, [['title', { text: 'The Pelican Rooms', sub: 'A night out' }, 'cue-n-pelican-2']], 'a show is keyed by its cue, so a second GM page shows it once');
  const c2 = CS.create(m.host); assert.equal(c2.view().standby.n, 3, 'a reload or a second page keeps the place');
  advance(m); assert.equal((await c.go('key')).kind, 'sound');
  advance(m); await c.go('key'); advance(m); await c.go('key'); assert.deepEqual(m.log.revealed, ['Ada Quill']); assert.deepEqual(m.log.phases, ['score']);
  advance(m); await c.go('key'); advance(m); await c.go('key');
  assert.equal(c.view().standby, null); assert.match(m.root.children[0].innerHTML, /ALL DONE/);
  advance(m); assert.equal((await c.go('key')).reason, 'none', 'nothing left: nothing happens');
  assert.ok(m.log.cues.some((t) => /^Cue 1 scene: harvest/.test(t)), 'each fired cue is in the night log');
});

await test('a different note starts a clean stack', async () => {
  const m = makeHost(); const c = CS.create(m.host); await c.go('key');
  m.host.note = () => ({ id: 'n-other', blocks: [{ k: 'md', src: '## Cues\n1. light: Lamps up' }] });
  assert.equal(c.view().standby.n, 1); assert.equal(c.view().standby.kind, 'light');
});

await test('two GOs within 500 ms fire once, whichever way each arrives; the lock opens after 500 ms; a GO is never queued', async () => {
  const m = makeHost(); const c = CS.create(m.host);
  const a = c.go('key'), b = c.go('button'), d = c.run({ type: 'cue_do', verb: 'fire' });
  const r = await Promise.all([a, b, d]);
  assert.deepEqual(r.map((x) => x.ok), [true, false, false]); assert.deepEqual(m.log.scenes, ['harvest'], 'fired once');
  m.clock.t += 499; assert.equal((await c.go('key')).reason, 'lock', '499 ms is still inside the lock');
  m.clock.t += 2; assert.equal((await c.go('key')).ok, true, '501 ms on, the next cue fires');
  assert.equal(c.view().standby.n, 3, 'two cues done, not three');
  m.clock.t += 600; const bp = c.bypass(); assert.equal(bp.ok, true); assert.equal(c.bypass().reason, 'lock', 'Bypass shares the lock: a double tap skips one cue');
});

await test('a cue that fails to fire stays in standby and says so (a refused iPad write, a name that is not in the cast)', async () => {
  const m = makeHost({ failScene: true }); const c = CS.create(m.host);
  assert.equal((await c.go('key')).reason, 'failed'); assert.equal(c.view().standby.n, 1); assert.ok(m.log.toasts.some(([t, bad]) => bad && /Cue 1/.test(t)));
  const m2 = makeHost({ note: { id: 'x', blocks: [{ k: 'md', src: '## Cues\n1. reveal: GM-ONLY-NOBODY' }] } }); const c2 = CS.create(m2.host);
  assert.equal((await c2.go('key')).ok, false); assert.ok(m2.log.toasts.some(([t]) => /No NPC called/.test(t))); assert.equal(c2.view().standby.n, 1);
});

await test('Bypass skips the cue in standby without firing it; Back puts the last one in standby again and undoes nothing; Start again clears the stack', async () => {
  const m = makeHost(); const c = CS.create(m.host);
  assert.equal(c.bypass().n, 1); assert.deepEqual(m.log.scenes, [], 'bypassed, not fired'); assert.equal(c.view().standby.n, 2);
  advance(m); assert.equal(c.back().n, 1); assert.equal(c.view().standby.n, 1);
  advance(m); await c.go('key'); assert.deepEqual(m.log.scenes, ['harvest']);
  assert.equal(c.reset().ok, true); assert.equal(c.view().standby.n, 1); assert.deepEqual(m.state.doc.cues.seq, []);
  const h = c.view(); assert.ok(h.total === 7);
});

await test('light, sound and practical cues are by hand: GO logs them and moves on, nothing is sent to the iPad', async () => {
  const m = makeHost({ note: { id: 'h', blocks: [{ k: 'md', src: '## Cues\n1. light: Lamps down\n2. sound: Rain\n3. practical: Knock' }] } }); const c = CS.create(m.host); c.paint();
  assert.match(m.root.children[0].innerHTML, /by hand/);
  for (let i = 0; i < 3; i++) { advance(m); assert.equal((await c.go('key')).ok, true); }
  assert.deepEqual([m.log.scenes, m.log.shows, m.log.panics], [[], [], []]); assert.equal(c.view().standby, null);
});

await test('PANIC: the bar goes red at once, every iPad write goes out in parallel and settles inside a second, GO is refused until Resume, and Resume puts the scene back', async () => {
  const m = makeHost({ panicMs: 250 }); const c = CS.create(m.host); c.paint();
  const t0 = Date.now(), p = c.panic('key');
  assert.equal(m.root.children[0].getAttribute('data-state'), 'panic', 'red before anything has come back'); assert.match(m.root.children[0].innerHTML, /WORK LIGHT UP/);
  const r = await p; assert.ok(Date.now() - t0 < 1000, 'within 1 second: ' + (Date.now() - t0)); assert.equal(r.ok, true);
  assert.deepEqual(m.log.panics, ['testcard']); assert.ok(m.state.doc.cues.panic > 0); assert.deepEqual(m.state.doc.cues.prior, { mode: 'pin', scene: 'harvest' });
  advance(m, 1000); assert.equal((await c.go('key')).reason, 'panic'); assert.deepEqual(m.log.scenes, [], 'no cue fires in a panic');
  await c.panic('key'); assert.deepEqual(m.state.doc.cues.prior, { mode: 'pin', scene: 'harvest' }, 'a second Esc keeps the first prior scene');
  assert.equal(m.log.panics.length, 2, 'and sends the clear again');
  const res = await c.resume(); assert.equal(res.ok, true); assert.deepEqual(m.log.resumes, [{ mode: 'pin', scene: 'harvest' }]);
  assert.equal(m.state.doc.cues.panic, undefined); assert.equal(c.view().panic, 0);
  advance(m); assert.equal((await c.go('key')).ok, true, 'GO works again');
});

await test('PANIC is not rate-limited and works mid-fire; a safe: line in the note picks the scene; a panic with no cues in the note still works', async () => {
  const m = makeHost({ note: { id: 's', blocks: [{ k: 'md', src: '## Cues\nsafe: lounge\n1. light: x' }] } }); const c = CS.create(m.host);
  await c.go('key'); const r = await c.panic('key'); assert.equal(r.ok, true); assert.deepEqual(m.log.panics, ['lounge']);
  const e = makeHost({ noNote: true }); const ce = CS.create(e.host); const re = await ce.panic('key'); assert.equal(re.ok, true); assert.deepEqual(e.log.panics, ['testcard']);
  const bad = makeHost(); bad.host.panic = async () => { throw new Error('offline'); }; const cb = CS.create(bad.host); const rb = await cb.panic('key');
  assert.equal(rb.ok, false); assert.ok(bad.log.toasts.some(([t, b]) => b && /could not be reached/.test(t)));
});

await test('the keys: Space (page focus) and PageDown (the page-turner) are GO; Esc is panic only when nothing else took it; typing, a dialog, repeat and other controls are left alone', async () => {
  const m = makeHost(); const c = CS.create(m.host); c.bind(m.doc); const key = m.doc.listeners.keydown;
  const press = (ev) => { const o = { prevented: false, key: ev.key, target: ev.target || { tagName: 'BODY' }, repeat: !!ev.repeat, defaultPrevented: !!ev.defaultPrevented, preventDefault() { o.prevented = true; } }; key(o); return o; };
  press({ key: ' ' }); await sleep(5); assert.deepEqual(m.log.scenes, ['harvest'], 'Space on the page fires the cue'); assert.equal(press({ key: ' ' }).prevented, true, 'and the page does not scroll');
  advance(m); press({ key: ' ', repeat: true }); await sleep(5); assert.equal(m.log.shows.length, 0, 'a held key does not repeat the GO');
  advance(m); press({ key: ' ', target: { tagName: 'BUTTON', closest: () => null } }); await sleep(5); assert.equal(m.log.shows.length, 0, 'Space on another button is that button\'s press');
  press({ key: ' ', target: { tagName: 'INPUT' } }); press({ key: 'Escape', target: { tagName: 'TEXTAREA' } }); await sleep(5); assert.equal(m.log.shows.length + m.log.panics.length, 0, 'typing is left alone');
  press({ key: 'PageDown', target: { tagName: 'BUTTON', closest: () => null } }); await sleep(5); assert.equal(m.log.shows.length, 1, 'PageDown fires from anywhere');
  m.doc.dialog = true; advance(m); press({ key: ' ' }); press({ key: 'Escape' }); await sleep(5); assert.equal(m.log.panics.length, 0, 'an open dialog keeps its own Esc'); m.doc.dialog = false;
  press({ key: 'Escape', defaultPrevented: true }); await sleep(5); assert.equal(m.log.panics.length, 0, 'an Esc the menu, Find or the Blade panel took is not a panic');
  press({ key: 'Escape' }); await sleep(5); assert.deepEqual(m.log.panics, ['testcard'], 'a bare Esc is');
  m.flags.held = true; m.host.escHeld = () => !!m.flags.held; press({ key: 'Escape' }); await sleep(5); assert.equal(m.log.panics.length, 1, 'the Esc that takes the stamp report card down is not a panic'); m.flags.held = false; press({ key: 'Escape' }); await sleep(5); assert.equal(m.log.panics.length, 2, 'and the next one is');
  const e = makeHost({ noNote: true }); const ce = CS.create(e.host); ce.bind(e.doc); e.doc.listeners.keydown({ key: ' ', target: { tagName: 'BODY' }, preventDefault() { assert.fail('no cues: Space is the page\'s'); } });
  c.destroy(); assert.equal(m.doc.listeners.keydown, undefined, 'destroy unbinds');
});

await test('"Blade, go": the real cue.js hears it only while the switch is on; a bare go becomes cue_do fire, which the Worker takes as a parsed cue and never from the model; go with a phase is A2\'s, while ai.grammar is on', async () => {
  const LIVE = { clocks: [], pcs: [], rooms: [] };
  const m = makeHost({ on: { 'ai.grammar': true } }); const c = CS.create(m.host); const g = G.create(Object.assign({}, m.host, { feature: (id) => id === 'ai.grammar' })); g.register(); c.register();
  const r = Cue.parse('Blade, go', LIVE); assert.equal(r.refused, null); assert.deepEqual(r.actions[0], { type: 'cue_do', verb: 'fire', quote: 'Blade, go' });
  assert.equal(Cue.parse('Blade, go now please', LIVE).actions[0].verb, 'fire');
  const ph = Cue.parse('Blade, go to planning', LIVE); assert.equal(ph.actions[0].verb, 'go'); assert.equal(ph.actions[0].phase, 'plan');
  assert.equal(Cue.parse('Blade, go to the Showroom', LIVE).refused, 'unparsed');
  const state = hands.cleanState({ clocks: [], npcs: [], pcs: [] }), ln = [{ id: 'l2', kind: 'line', text: 'Blade, go' }];
  const ok = hands.validateActions([r.actions[0]], { state, lines: ln, cue: { parsed: true, cueLineId: 'l2' } });
  assert.equal(ok.dropped.length, 0); assert.equal(ok.actions[0].verb, 'fire'); assert.equal(ok.actions[0].type, 'cue_do');
  assert.equal(hands.validateActions([r.actions[0]], { state, lines: ln, cue: { parsed: false, cueLineId: 'l2' } }).actions.length, 0, 'the model path may not fire a cue');
  assert.equal(hands.validateActions([r.actions[0]], { state, lines: ln }).actions.length, 0, 'a window of talk may not');
  assert.equal(hands.validateActions([{ type: 'cue_do', verb: 'fire', quote: 'Blade, go', cue: 7, extra: 1 }], { state, lines: ln, cue: { parsed: true, cueLineId: 'l2' } }).actions[0].cue, undefined, 'no cue number rides along: only the one in standby fires');
  m.flags['room.cues'] = false; assert.equal(Cue.find('Blade, go', LIVE) && Cue.find('Blade, go', LIVE).verb, 'go', 'cue stack off: "go" is A2\'s own word again (needs a phase)'); assert.equal(Cue.parse('Blade, go', LIVE).refused, 'unparsed');
  m.flags['room.cues'] = true; m.flags['ai.grammar'] = false; assert.equal(Cue.parse('Blade, go to planning', LIVE).refused, 'unparsed', 'ai.grammar off: only the bare go is heard');
});

await test('"Blade, go" with nothing in standby does nothing: no effect, no position written, the page says so', async () => {
  const m = makeHost({ note: { id: 'e', blocks: [{ k: 'md', src: '# no cues here' }] } }); const c = CS.create(m.host);
  const w0 = m.log.patches; const r = await c.run({ type: 'cue_do', verb: 'fire' });
  assert.equal(r.ok, false); assert.equal(r.reason, 'none'); assert.equal(m.log.patches, w0); assert.deepEqual([m.log.scenes, m.log.shows, m.log.phases, m.log.revealed, m.log.panics], [[], [], [], [], []]);
  assert.ok(m.log.toasts.some(([t]) => /Nothing in standby/.test(t)));
  const done = makeHost(); const cd = CS.create(done.host); done.state.doc = { cues: { note: 'n-pelican', seq: [[1, 'f'], [2, 'f'], [3, 'b'], [4, 'b'], [5, 'b'], [6, 'b'], [7, 'b']] } };
  assert.equal((await cd.run({ type: 'cue_do', verb: 'fire' })).reason, 'none'); assert.deepEqual(done.log.scenes, []);
  assert.equal((await cd.run({ type: 'cue_do', verb: 'go', phase: 'plan' })).ok, false, 'run() takes only fire');
});

await test('the files: the module is in the GM bundle and in no other, the verb is in the Worker\'s list, and no campaign name is in the new code', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8');
  const gm = /gm: \[([^\]]*)\]/.exec(routes)[1], display = /display: \[([^\]]*)\]/.exec(routes)[1];
  assert.ok(gm.includes("'gm/cue-stack.js'")); assert.ok(!display.includes('cue-stack'));
  assert.ok(hands.CUE_DO_VERBS.includes('fire')); assert.ok(!hands.CUE_TYPES.includes('fire'));
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm', 'cue-stack.js'), 'utf8');
  assert.ok(!/ANTHROPIC|api\.anthropic|fetch\(/.test(src), 'no model, no network of its own');
});

await test('the page\'s name lookup for a reveal cue (csNpc, run from gm-page.js itself) resolves names with an s and a space, and refuses an unknown or ambiguous one', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  const a = src.indexOf('function csNpc(name) {'), b = src.indexOf('function csMount()');
  assert.ok(a > 0 && b > a, 'csNpc is where the test expects it');
  const body = src.slice(a, b);
  assert.ok(body.includes('/\\s+/g') && !body.includes('/s+/g'), 'the whitespace regex keeps its backslash');
  const S = { npcs: { n1: { name: 'Marcus Sills', revealed: false }, n2: { name: 'Ada Quill', alias: 'The Quill' }, n3: { name: 'Dov Sills' }, n4: { name: 'Gone Sills', tags: ['undone'] } } };
  const csNpc = new Function('S', 'isObj', 'str', body + '; return csNpc;')(S, (v) => !!v && typeof v === 'object' && !Array.isArray(v), (v) => (typeof v === 'string' ? v : v == null ? '' : String(v)));
  assert.equal(csNpc('Marcus Sills').id, 'n1'); assert.equal(csNpc('  marcus   SILLS ').id, 'n1', 'case and runs of spaces do not matter');
  assert.equal(csNpc('The Quill').id, 'n2', 'an alias'); assert.equal(csNpc('Marcus').id, 'n1', 'a first name that is unique');
  assert.equal(csNpc('Sills'), null, 'two Sills (the undone one does not count) is ambiguous: no guess'); assert.equal(csNpc('Nobody Here'), null);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
