// Unit test for the strict cue grammar (suite A2, app/gm/cue-grammar.js, switch ai.grammar): this week's verbs through the real cue.js and cue-verbs.js, every action they
// return through the Worker's own validateActions, the verbs carried out against a fake host, the five-second toast with Undo, and the switch off (the cue is main's).
// Invented names only; every GM-only string is a GM-ONLY- marker. No network, no model.
//   node checks/runtime/gm-cue-grammar.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const Cue = require(path.join(ROOT, 'app', 'cue.js'));
const V = require(path.join(ROOT, 'app', 'cue-verbs.js'));
const G = require(path.join(ROOT, 'app', 'gm', 'cue-grammar.js'));
const hands = await import(pathToFileURL(path.join(ROOT, 'functions', '_lib', 'assist', 'hands.js')).href);

let failed = 0, passed = 0;
async function test(name, fn) {
  V.reset();
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } finally { V.reset(); }
}
const LIVE = { clocks: [{ id: 'c1', name: 'The Fuse', size: 6, filled: 1, hidden: false }], pcs: [], rooms: [] };

/* a fake DOM just big enough for the toast */
function fakeDoc() {
  const mk = () => { const e = { children: [], attrs: {}, className: '', textContent: '', listeners: {}, disabled: false, parentNode: null,
    appendChild(c) { c.parentNode = e; e.children.push(c); return c; }, removeChild(c) { e.children = e.children.filter((x) => x !== c); c.parentNode = null; },
    setAttribute(k, v) { e.attrs[k] = v; }, addEventListener(t, fn) { e.listeners[t] = fn; }, click() { return e.listeners.click && e.listeners.click(); } }; return e; };
  const body = mk();
  return { body, createElement: mk, toasts: () => body.children.filter((c) => c.className === 'gm-ugtoast') };
}
function makeHost(over = {}) {
  const log = { layers: [], shows: [], revealed: [], toasts: [], entered: [], stamps: [], timers: [], cleared: 0 };
  const flags = Object.assign({ 'ai.grammar': true }, over.on || {});
  const layers = {};
  const npcs = over.npcs || [{ id: 'n-mabel', name: 'Mabel Quist', revealed: true }, { id: 'n-dov', name: 'Dov Ashgrove', revealed: true }, { id: 'n-hid', name: 'GM-ONLY-NPC-1', alias: 'GM-ONLY-ALIAS-1', revealed: false }];
  let phase = over.phase === undefined ? 'plan' : over.phase, overlay = '';
  const doc = fakeDoc();
  const host = {
    feature: (id) => !!flags[id], cueVerbs: () => V, doc: () => doc, toast: (m, bad) => log.toasts.push([m, !!bad]),
    stamp: () => (over.noStamp ? null : { stampNow: async (p, e, t) => { log.stamps.push([p, e, t]); return true; }, esc: async () => { log.cleared++; return true; } }),
    night: () => (over.noNight ? null : { phase: () => phase, enter: (p) => { log.entered.push(p); phase = p; return true; } }),
    layer: async (p, v) => { log.layers.push([p, v]); layers[p] = v; return over.refuseLayer ? null : {}; }, layerValue: (p) => layers[p] || null,
    npcs: () => npcs, reveal: async (id, yes) => { log.revealed.push([id, yes]); npcs.forEach((n) => { if (n.id === id) n.revealed = yes; }); },
    show: async (kind, payload, o) => { log.shows.push([kind, payload, o.key]); overlay = 'id:' + o.key; return over.refuseShow ? null : {}; }, keyFor: (k) => 'id:' + k, overlayId: () => overlay,
    clearOverlay: async () => { log.cleared++; overlay = ''; return {}; },
    setTimeout: (fn, ms) => { log.timers.push({ fn, ms }); return log.timers.length; }, clearTimeout: () => {}
  };
  return { host, log, doc, flags, layers };
}
const parse = (t) => Cue.parse(t, LIVE);
const act = (t) => { const r = parse(t); assert.equal(r.refused, null, t); assert.equal(r.missing, null, t); assert.equal(r.actions.length, 1, t); return r.actions[0]; };

await test('with the switch off the registry answers as if empty: main\'s cue, word for word (reveal still refuses as show, risky is no cue)', () => {
  const m = makeHost({ on: { 'ai.grammar': false } }); const c = G.create(m.host); c.register();
  assert.deepEqual(V.words(), [], 'no word is heard'); assert.equal(V.verbFor('stamp'), null); assert.equal(V.has('go'), false);
  assert.equal(Cue.find('Blade, risky, standard', LIVE), null); assert.equal(Cue.find('Blade, go to planning', LIVE), null);
  assert.equal(parse('Blade, reveal Mabel Quist').refused, 'show'); assert.equal(parse('Blade, name Mabel').actions[0].type, 'capture');
  assert.equal(parse('Blade, tick the fuse').actions[0].type, 'clock_tick');
  m.flags['ai.grammar'] = true; assert.equal(Cue.find('Blade, risky, standard', LIVE).verb, 'stamp', 'and live: flipping the switch needs no reload');
  m.flags['ai.grammar'] = false; assert.equal(Cue.find('Blade, risky, standard', LIVE), null);
});

await test('stamp: "Blade, risky, standard" and the long forms give a position, an effect and an optional consequence; both are required', () => {
  const c = G.create(makeHost().host); c.register();
  assert.deepEqual(act('Blade, risky, standard'), { type: 'cue_do', verb: 'stamp', position: 'risky', effect: 'standard', quote: 'Blade, risky, standard' });
  const a = act('Blade, stamp risky and standard, the guard turns round.');
  assert.deepEqual([a.position, a.effect, a.text], ['risky', 'standard', 'the guard turns round']);
  const b = act('Okay Blade, desperate, limited, and the lights fail');
  assert.deepEqual([b.position, b.effect, b.text], ['desperate', 'limited', 'the lights fail']);
  assert.equal(act('Blade, controlled great').text, undefined);
  assert.equal(act('Blade, stamp great position controlled with the consequence a shot rings out').text, 'a shot rings out');
  for (const t of ['Blade, controlled', 'Blade, stamp', 'Blade, stamp risky', 'Blade, risky business', 'Blade, stamp standard']) { const r = parse(t); assert.equal(r.refused, 'unparsed', t); assert.deepEqual(r.actions, [], t); }
  assert.equal(act('Blade, risky standard ' + 'x'.repeat(300)).text.length, 100, 'capped at the report card\'s line');
});

await test('go, flashback, back, introduce, spotlight, reveal: each is one cue_do action, nothing else', () => {
  const c = G.create(makeHost().host); c.register();
  assert.deepEqual([act('Blade, go to planning').phase, act('Blade, go to the score').phase, act('Blade, go aftermath').phase, act('Blade, go to personal business please').phase], ['plan', 'score', 'after', 'pb']);
  assert.equal(act('Blade, flashback').verb, 'flashback'); assert.equal(act('Blade, back').verb, 'back'); assert.equal(act('Blade, back please').verb, 'back');
  assert.equal(parse('Blade, back on').refused, 'unparsed', '"back on" is owned by A6, not a cue verb here');
  assert.equal(Cue.find('Blade, off the record', LIVE), null, 'A6 owns it: no cue verb');
  assert.deepEqual(act('Blade, introduce Mabel Quist and Dov Ashgrove').names, ['Mabel Quist', 'Dov Ashgrove']);
  assert.deepEqual(act('Blade, introduce the Mabel, Dov, Lotte').names, ['Mabel', 'Dov', 'Lotte']);
  assert.deepEqual(act('Blade, spotlight Dov Ashgrove.').names, ['Dov Ashgrove']);
  assert.deepEqual(act('Blade, reveal Mabel Quist').names, ['Mabel Quist']);
  for (const w of ['stamp', 'reveal', 'go', 'flashback', 'back', 'introduce', 'spotlight']) assert.ok(V.has(w), w);
  for (const v of V.list()) assert.deepEqual(v.actionTypes, ['cue_do']);
});

await test('what it cannot parse is refused as unparsed with no action: the page says "didn\'t catch that" and does nothing', async () => {
  const m = makeHost(); const c = G.create(m.host); c.register();
  for (const t of ['Blade, go to the Showroom', 'Blade, go', 'Blade, back to the alley', 'Blade, back on the roof', 'Blade, introduce', 'Blade, spotlight', 'Blade, flashback to the harbour']) {
    const r = parse(t); assert.equal(r.refused, 'unparsed', t); assert.deepEqual(r.actions, [], t);
  }
  c.didntCatch(); assert.deepEqual(m.log.toasts, [['Didn’t catch that.', false]]);
  const off = makeHost({ on: { 'ai.grammar': false } }); G.create(off.host).didntCatch(); assert.deepEqual(off.log.toasts, [], 'switch off: no new message');
});

await test('main\'s own verbs are untouched with the grammar on: tick, make, note, undo, show and sheet refusals, and CUE-P\'s loose forms still act only when complete', () => {
  const c = G.create(makeHost().host); c.register();
  assert.equal(parse('Blade, tick the fuse twice').actions[0].by, 2);
  assert.equal(parse('Blade, make a six clock called Escape').actions[0].type, 'clock_add');
  assert.equal(parse('Blade, note the cook saw it').actions[0].type, 'capture');
  assert.equal(parse('Blade, undo').actions[0].type, 'undo');
  assert.equal(parse('Blade, show the map').refused, 'show'); assert.equal(parse('Blade, stress two').refused, 'sheet');
  assert.equal(Cue.find('Blade created the plan for tonight', LIVE), null, 'a loose past form is still talk unless it parses to something');
  assert.equal(Cue.find('Blade made it out of the alley', LIVE), null);
});

await test('every action a verb returns passes validateActions as a parsed cue; a window of talk and the model may not send one; bad fields are dropped', () => {
  const c = G.create(makeHost().host); c.register();
  const lines = [{ id: 'l1', kind: 'line', text: 'something said first' }];
  const state = hands.cleanState({ clocks: [], npcs: [], pcs: [] });
  const sayings = ['Blade, risky, standard, the guard turns', 'Blade, go to planning', 'Blade, flashback', 'Blade, back', 'Blade, introduce Mabel and Dov', 'Blade, spotlight Dov', 'Blade, reveal Mabel'];
  for (const t of sayings) {
    const a = act(t), ln = [{ id: 'l2', kind: 'line', text: t }];
    const v = hands.validateActions([a], { state, lines: ln, cue: { parsed: true, cueLineId: 'l2' } });
    assert.equal(v.dropped.length, 0, t + ' ' + JSON.stringify(v.dropped)); assert.equal(v.actions.length, 1, t); assert.equal(v.actions[0].type, 'cue_do'); assert.equal(v.actions[0].mode, 'act');
    assert.equal(v.actions[0].verb, a.verb);
    assert.equal(hands.validateActions([a], { state, lines: ln, cue: { parsed: false, cueLineId: 'l2' } }).actions.length, 0, 'the model path may not');
    assert.equal(hands.validateActions([a], { state, lines: ln }).actions.length, 0, 'a window of talk may not');
  }
  const q = 'Blade, risky, standard', ln = [{ id: 'l2', kind: 'line', text: q }];
  const bad = (o) => hands.validateActions([{ type: 'cue_do', quote: q, ...o }], { state, lines: ln, cue: { parsed: true, cueLineId: 'l2' } });
  assert.deepEqual(bad({ verb: 'stamp', position: 'unclear', effect: 'standard' }).dropped.map((d) => d.why), ['bad stamp']);
  assert.deepEqual(bad({ verb: 'stamp', position: 'risky' }).dropped.map((d) => d.why), ['bad stamp']);
  assert.deepEqual(bad({ verb: 'go', phase: 'nope' }).dropped.map((d) => d.why), ['bad phase']);
  assert.deepEqual(bad({ verb: 'reveal', names: [] }).dropped, [], 'a bare reveal is kept: it sends the staged rooms (suite 2.3)');
  assert.deepEqual(bad({ verb: 'spotlight', names: ['A', 'B'] }).dropped.map((d) => d.why), ['no name']);
  assert.deepEqual(bad({ verb: 'teleport' }).dropped.map((d) => d.why), ['unknown verb']);
  assert.equal(bad({ verb: 'introduce', names: Array.from({ length: 9 }, (_, i) => 'N' + i) }).actions[0].names.length, 6);
  assert.deepEqual(Object.keys(bad({ verb: 'stamp', position: 'risky', effect: 'standard', text: 'x', junk: 1 }).actions[0]).sort(), ['at', 'confidence', 'effect', 'key', 'mode', 'position', 'quote', 'text', 'type', 'verb'], 'no other keys');
});

await test('stamp carries out through the stamp controller; Undo takes the card down', async () => {
  const m = makeHost(); const c = G.create(m.host);
  const r = await c.run({ type: 'cue_do', verb: 'stamp', position: 'risky', effect: 'standard', text: 'the guard turns' });
  assert.equal(r.ok, true); assert.deepEqual(m.log.stamps, [['risky', 'standard', 'the guard turns']]);
  const t = m.doc.toasts(); assert.equal(t.length, 1); t[0].children[1].click(); await new Promise((r2) => setImmediate(r2));
  assert.equal(m.log.cleared, 1);
  assert.equal((await G.create(makeHost({ noStamp: true }).host).run({ type: 'cue_do', verb: 'stamp', position: 'risky', effect: 'standard' })).ok, false);
});

await test('go enters the phase on the night and the band, and Undo goes back to the phase it left', async () => {
  const m = makeHost({ phase: 'plan' }); const c = G.create(m.host);
  const r = await c.run({ type: 'cue_do', verb: 'go', phase: 'score' });
  assert.equal(r.ok, true); assert.deepEqual(m.log.entered, ['score']); assert.deepEqual(m.log.layers, [['band.phase', 'score']]);
  m.doc.toasts()[0].children[1].click(); await new Promise((r2) => setImmediate(r2));
  assert.deepEqual(m.log.entered, ['score', 'plan']); assert.deepEqual(m.log.layers[1], ['band.phase', 'plan']);
  assert.equal((await c.run({ type: 'cue_do', verb: 'go', phase: 'plan' })).ok, false, 'already there after the undo: said, nothing sent');
  assert.equal(Cue.find('Blade, off', LIVE), null, 'a bare off is no cue; only the phrase is');
  assert.equal((await G.create(makeHost({ noNight: true }).host).run({ type: 'cue_do', verb: 'go', phase: 'plan' })).ok, false);
});

await test('flashback sets the scene filter and back clears it, each with an Undo that puts it back; back with no flashback up says so', async () => {
  const m = makeHost(); const c = G.create(m.host);
  assert.equal((await c.run({ type: 'cue_do', verb: 'back' })).ok, false); assert.deepEqual(m.log.layers, []);
  assert.equal((await c.run({ type: 'cue_do', verb: 'flashback' })).ok, true); assert.deepEqual(m.log.layers[0], ['scene.filter', 'flashback']);
  assert.equal((await c.run({ type: 'cue_do', verb: 'back' })).ok, true); assert.deepEqual(m.log.layers[1], ['scene.filter', null]);
  m.doc.toasts()[0].children[1].click(); await new Promise((r2) => setImmediate(r2));
  assert.deepEqual(m.log.layers[2], ['scene.filter', 'flashback'], 'undo of back puts the flashback back');
  assert.equal((await G.create(makeHost({ refuseLayer: true }).host).run({ type: 'cue_do', verb: 'flashback' })).ok, false, 'a refused layer is no cue done');
});

await test('SECRECY: introduce and spotlight refuse a hidden NPC by name or alias before anything is sent; reveal is the only way, and it undoes', async () => {
  const m = makeHost(); const c = G.create(m.host);
  for (const [verb, names] of [['spotlight', ['GM-ONLY-NPC-1']], ['introduce', ['Mabel Quist', 'GM-ONLY-ALIAS-1']]]) {
    const r = await c.run({ type: 'cue_do', verb, names }); assert.equal(r.ok, false, verb);
  }
  assert.deepEqual(m.log.shows, [], 'nothing reached the iPad');
  assert.ok(m.log.toasts.every((t) => t[1] === true), 'the refusals are errors');
  const rv = c.run({ type: 'cue_do', verb: 'reveal', names: ['GM-ONLY-NPC-1'] }); await new Promise((r2) => setImmediate(r2)); m.doc.toasts()[0].children[1].click();
  assert.equal((await rv).ok, true); assert.deepEqual(m.log.revealed, [['n-hid', true]]);
  assert.equal((await c.run({ type: 'cue_do', verb: 'spotlight', names: ['GM-ONLY-NPC-1'] })).ok, true, 'revealed now, so it may be spotlit');
  assert.deepEqual(m.log.shows[0].slice(0, 2), ['spotlight', { npcId: 'n-hid' }]);
});

await test('spotlight and introduce put the show beat up for revealed NPCs by id (never a name); an unknown or ambiguous name is said, not guessed; Undo takes the beat down only if it is still up', async () => {
  const m = makeHost(); const c = G.create(m.host);
  assert.equal((await c.run({ type: 'cue_do', verb: 'introduce', names: ['Mabel', 'Dov Ashgrove'] })).ok, true);
  assert.deepEqual(m.log.shows[0].slice(0, 2), ['rolodex', { npcIds: ['n-mabel', 'n-dov'] }]);
  m.doc.toasts()[0].children[1].click(); await new Promise((r2) => setImmediate(r2)); assert.equal(m.log.cleared, 1);
  assert.equal((await c.run({ type: 'cue_do', verb: 'spotlight', names: ['Nobody Here'] })).ok, false);
  const amb = makeHost({ npcs: [{ id: 'a', name: 'Rook Mabel', revealed: true }, { id: 'b', name: 'Mabel Quist', revealed: true }] });
  assert.equal((await G.create(amb.host).run({ type: 'cue_do', verb: 'spotlight', names: ['Mabel'] })).ok, false, 'two Mabels: not guessed');
  const gone = makeHost(); const c2 = G.create(gone.host);
  await c2.run({ type: 'cue_do', verb: 'spotlight', names: ['Dov'] }); gone.host.overlayId = () => 'someone-elses'; gone.doc.toasts()[0].children[1].click(); await new Promise((r2) => setImmediate(r2));
  assert.equal(gone.log.cleared, 0, 'the overlay is no longer ours');
});

await test('the toast: shown for five seconds with an Undo button; Undo runs once and says Undone; a new toast replaces the last; with the switch off nothing is drawn', async () => {
  const m = makeHost(); const c = G.create(m.host);
  let n = 0; c.undoToast('Did a thing.', () => { n++; });
  const first = m.doc.toasts(); assert.equal(first.length, 1); assert.equal(first[0].children[0].textContent, 'Did a thing.');
  assert.equal(m.log.timers[m.log.timers.length - 1].ms, 5000);
  c.undoToast('Did another.', () => { n += 10; }); assert.equal(m.doc.toasts().length, 1, 'one at a time'); assert.equal(m.doc.toasts()[0].children[0].textContent, 'Did another.');
  m.log.timers[m.log.timers.length - 1].fn(); assert.equal(m.doc.toasts().length, 0, 'gone after five seconds');
  c.undoToast('A third.', () => { n += 100; }); const el = m.doc.toasts()[0]; el.children[1].click(); await new Promise((r) => setImmediate(r));
  assert.equal(n, 100); assert.equal(el.children[0].textContent, 'Undone.');
  const off = makeHost({ on: { 'ai.grammar': false } }); G.create(off.host).undoToast('Hidden.', () => {}); assert.equal(off.doc.toasts().length, 0);
  assert.equal((await G.create(off.host).run({ type: 'cue_do', verb: 'flashback' })).ok, false, 'a cue_do arriving with the switch off does nothing');
  assert.deepEqual(off.log.layers, []);
});

await test('reveal ASKS the GM first: nothing fires until Reveal is pressed; Cancel, a timeout and a newer toast all mean no; the 5 second Undo follows the confirm', async () => {
  const nextTick = () => new Promise((r) => setImmediate(r));
  const m = makeHost(); const c = G.create(m.host);
  let settled = false; const p = c.run({ type: 'cue_do', verb: 'reveal', names: ['GM-ONLY-NPC-1'] }).then((r) => { settled = true; return r; });
  await nextTick();
  assert.equal(m.doc.toasts().length, 1); assert.equal(m.doc.toasts()[0].children[0].textContent, 'Reveal GM-ONLY-NPC-1 to the iPad?');
  assert.deepEqual(m.log.revealed, [], 'asked, not yet fired'); assert.equal(settled, false, 'still waiting on the GM');
  m.doc.toasts()[0].children[1].click(); const r = await p;
  assert.equal(r.ok, true); assert.deepEqual(m.log.revealed, [['n-hid', true]]);
  const u = m.doc.toasts()[0]; assert.equal(u.children[0].textContent, 'Revealed GM-ONLY-NPC-1.'); assert.equal(u.children[1].attrs['data-ug'], 'undo', 'the Undo toast follows the confirm');
  assert.equal(m.log.timers[m.log.timers.length - 1].ms, 5000, 'the Undo is the five-second one');
  u.children[1].click(); await nextTick(); assert.deepEqual(m.log.revealed, [['n-hid', true], ['n-hid', false]], 'Undo still works');
  /* Cancel */
  const c2 = makeHost(); const g2 = G.create(c2.host); const p2 = g2.run({ type: 'cue_do', verb: 'reveal', names: ['GM-ONLY-NPC-1'] }); await nextTick();
  c2.doc.toasts()[0].children[2].click(); assert.equal((await p2).ok, false); assert.deepEqual(c2.log.revealed, []); assert.equal(c2.doc.toasts().length, 0);
  /* a timeout */
  const c3 = makeHost(); const g3 = G.create(c3.host); const p3 = g3.run({ type: 'cue_do', verb: 'reveal', names: ['GM-ONLY-NPC-1'] }); await nextTick();
  const tm = c3.log.timers[c3.log.timers.length - 1]; assert.equal(tm.ms, 15000); tm.fn(); assert.equal((await p3).ok, false); assert.deepEqual(c3.log.revealed, []);
  /* a newer toast */
  const c4 = makeHost(); const g4 = G.create(c4.host); const p4 = g4.run({ type: 'cue_do', verb: 'reveal', names: ['GM-ONLY-NPC-1'] }); await nextTick();
  g4.undoToast('Something else.', () => {}); assert.equal((await p4).ok, false); assert.deepEqual(c4.log.revealed, []);
  /* no screen to ask on: no reveal (secrecy fails closed) */
  const c5 = makeHost(); c5.host.doc = () => null; assert.equal((await G.create(c5.host).run({ type: 'cue_do', verb: 'reveal', names: ['GM-ONLY-NPC-1'] })).ok, false); assert.deepEqual(c5.log.revealed, []);
  /* switch off: nothing asked, nothing fired */
  const c6 = makeHost({ on: { 'ai.grammar': false } }); assert.equal((await G.create(c6.host).run({ type: 'cue_do', verb: 'reveal', names: ['GM-ONLY-NPC-1'] })).ok, false); assert.equal(c6.doc.toasts().length, 0);
});

await test('a PLAYER key-turn on a phone does not ask the GM: it shows at once, with no confirm toast and no reveal', async () => {
  const K = require(path.join(ROOT, 'app', 'gm', 'keyturn.js')); K.reset();
  const m = makeHost(); const shown = [];
  const out = K.sync({ pcs: () => [{ id: 'pc-1', name: 'Nell Arbuthnot', keyTurn: { seq: 1, name: 'Hearth', word: 'warm', dir: 'up', at: new Date().toISOString() } }],
    show: async (k, p, o) => { shown.push([k, o.key]); return {}; }, toast: () => {}, now: () => Date.now() });
  await new Promise((r) => setImmediate(r));
  assert.equal(out.length, 1); assert.deepEqual(shown, [['keyturn', 'pc-1-1']], 'fired at once'); assert.equal(m.doc.toasts().length, 0, 'no confirm'); assert.deepEqual(m.log.revealed, []);
  K.reset();
});

await test('another bundle owning a word does not stop the rest: a clash skips only that verb', () => {
  V.register({ id: 'other', words: ['spotlight'], actionTypes: ['capture'], parse: () => ({ refused: 'nochange' }) });
  const c = G.create(makeHost().host); const got = c.register();
  assert.ok(!got.includes('spotlight') && got.includes('stamp') && got.includes('go'), got.join(','));
});

await test('IP3b (stage.players): "reveal <name>" brings the person on after the reveal\'s own write; ONE toast; Undo takes them down and un-reveals only if this cue revealed them; not shown says why; setting off (no host.introduce answer): as before', async () => {
  const order = [];
  const mk = (answer) => { const m = makeHost(); const rev = m.host.reveal; m.host.reveal = async (id, yes) => { order.push(['reveal', id, yes]); return rev(id, yes); };
    m.host.introduce = (id) => { order.push(['introduce', id]); return answer === null ? null : Promise.resolve(answer); }; return m; };
  const tick = async () => { for (let i = 0; i < 4; i++) await new Promise((r2) => setImmediate(r2)); };
  /* hidden: asked first, revealed, then brought on */
  let downs = 0; order.length = 0;
  const m1 = mk({ ok: true, shown: { seq: 4, undo: () => { downs++; return null; } } }); const c1 = G.create(m1.host);
  const r1 = c1.run({ type: 'cue_do', verb: 'reveal', names: ['GM-ONLY-NPC-1'] }); await tick();
  assert.equal(order.length, 0, 'nothing before the GM says yes'); m1.doc.toasts()[0].children[1].click();
  assert.equal((await r1).ok, true); assert.deepEqual(order, [['reveal', 'n-hid', true], ['introduce', 'n-hid']], 'the reveal is written first, then the introduction');
  const t1 = m1.doc.toasts(); assert.equal(t1.length, 1, 'one toast'); assert.match(t1[0].children[0].textContent, /^Revealed GM-ONLY-NPC-1\./);
  t1[0].children[1].click(); await tick();
  assert.equal(downs, 1, 'Undo takes them off the iPad'); assert.deepEqual(m1.log.revealed.slice(-1), [['n-hid', false]], 'and un-reveals them (this cue revealed them)');
  /* already revealed: no question, introduced; Undo only takes them down */
  downs = 0; order.length = 0;
  const m2 = mk({ ok: true, shown: { seq: 5, undo: () => { downs++; return null; } } }); const c2 = G.create(m2.host);
  assert.equal((await c2.run({ type: 'cue_do', verb: 'reveal', names: ['Mabel Quist'] })).ok, true); assert.deepEqual(order, [['introduce', 'n-mabel']]);
  const t2 = m2.doc.toasts(); assert.equal(t2.length, 1); assert.match(t2[0].children[0].textContent, /^Introducing Mabel Quist\./);
  t2[0].children[1].click(); await tick();
  assert.equal(downs, 1); assert.equal(m2.log.revealed.length, 0, 'never un-reveals someone it did not reveal');
  /* not shown: the reveal stands, ONE line says why */
  const m3 = mk({ ok: true, warn: true, notShown: 'the iPad is on Blank', say: 'GM-ONLY-NPC-1 is revealed but not shown on the iPad: the iPad is on Blank.' }); const c3 = G.create(m3.host);
  const r3 = c3.run({ type: 'cue_do', verb: 'reveal', names: ['GM-ONLY-NPC-1'] }); await tick(); m3.doc.toasts()[0].children[1].click(); await r3;
  assert.deepEqual(m3.log.revealed, [['n-hid', true]], 'the reveal stands'); const t3 = m3.doc.toasts();
  assert.equal(t3.length, 1); assert.match(t3[0].children[0].textContent, /revealed but not shown on the iPad: the iPad is on Blank/);
  /* setting off: host.introduce answers null, exactly as before */
  const m4 = mk(null); const c4 = G.create(m4.host);
  assert.equal((await c4.run({ type: 'cue_do', verb: 'reveal', names: ['Mabel Quist'] })).ok, false, 'already revealed: refused as before');
  const r4 = c4.run({ type: 'cue_do', verb: 'reveal', names: ['GM-ONLY-NPC-1'] }); await tick(); m4.doc.toasts().slice(-1)[0].children[1].click();
  assert.equal((await r4).ok, true); assert.match(m4.doc.toasts().slice(-1)[0].children[0].textContent, /^Revealed GM-ONLY-NPC-1\.$/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
