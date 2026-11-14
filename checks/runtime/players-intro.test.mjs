// players-intro (IP3 of the players' screen build, setting stage.players): the NPC introduction's pure parts and its server contract. No browser.
//   the iPad's half (app/display/players/intro.js Pure): the shared clock, when a card plays, the colours, the drawing, the name's size
//   the GM's half (app/gm/players-intro.js): the push it makes, the look from the notes, the hidden NPC's question, the tray's words
//   the server (functions/_lib/gm.js cleanDisplay, functions/_lib/npcs.js joinDisplayNpc, through the real display handler on an in-memory D1):
//   intro and look are kept on an npc display only, cleaned; a revealed NPC is joined; an NPC hidden again since loses both and is never named
//   the files: no markup sink, no request, no hand-built button, no important flag, no native confirm; every stylesheet rule is .pi- markup
//   node checks/runtime/players-intro.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { onRequest as displayHandler } from '../../functions/api/gm/display.js';
import { cleanDisplay } from '../../functions/_lib/gm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const req = createRequire(import.meta.url);
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8');

const FL = req(path.join(APP, 'display', 'face-look.js'));
globalThis.B68FaceLook = FL;
const I = req(path.join(APP, 'display', 'players', 'intro.js'));
const G = req(path.join(APP, 'gm', 'players-intro.js'));
const Tray = req(path.join(APP, 'gm', 'ipad-tray.js'));
const P = I.Pure;

/* ---------- the iPad's half ---------- */
await test('one clock: the position is the server time less the push time and the lead, from the display\'s updatedAt and the page\'s skew', () => {
  const at = '2030-01-04T20:10:00.000Z', z = Date.parse(at);
  assert.equal(P.position(at, z + P.LEAD_MS, 0), 0, 'zero at the push plus the lead');
  assert.equal(P.position(at, z, 0), -P.LEAD_MS, 'during the lead: negative');
  assert.equal(P.position(at, z + 3000, 0), 3000 - P.LEAD_MS);
  assert.equal(P.position(at, z + 1000, 2000), 3000 - P.LEAD_MS, 'a page whose clock is 2 s slow is corrected by its skew (server less page)');
  assert.equal(P.position(at, z + 4000, -2000), 2000 - P.LEAD_MS, 'and one 2 s fast');
  assert.equal(P.position('', z, 0), null); assert.equal(P.position('not a time', z, 0), null); assert.equal(P.position(undefined, z, 0), null);
  assert.equal(P.position(at, z + P.LEAD_MS, undefined), 0, 'no skew known: the page\'s own clock');
});
await test('when a card plays: the setting on, an npc display marked intro (only true), and the server\'s join of a revealed NPC with a name', () => {
  const d = { kind: 'npc', npcId: 'n-mabel', intro: true, npc: { name: 'Mabel Quist' } };
  assert.equal(P.wants(d, true), true);
  assert.equal(P.wants(d, false), false, 'setting off: never');
  assert.equal(P.wants({ ...d, intro: 'yes' }, true), false, 'only the literal true');
  assert.equal(P.wants({ ...d, intro: undefined }, true), false, 'Show on iPad: no card');
  assert.equal(P.wants({ ...d, npc: undefined }, true), false, 'a hidden NPC (the server joins nothing): no card');
  assert.equal(P.wants({ ...d, npc: { name: '  ' } }, true), false, 'no name: no card');
  assert.equal(P.wants({ ...d, kind: 'svg' }, true), false);
  assert.equal(P.wants(null, true), false);
});
await test('once: a card starts while there is still a card to see (5 s; 3 s held still); past that, the stage alone', () => {
  assert.equal(P.startable(-800, false), true, 'in the lead');
  assert.equal(P.startable(0, false), true);
  assert.equal(P.startable(4999, false), true, 'a reload in the hold resumes');
  assert.equal(P.startable(5000, false), false, 'a late joiner: the stage only');
  assert.equal(P.startable(60000, false), false, 'a reload a minute later: the stage only');
  assert.equal(P.startable(2999, true), true); assert.equal(P.startable(3000, true), false, 'held still: 3 s');
  assert.equal(P.startable(null, false), false); assert.equal(P.startable(NaN, false), false);
  assert.ok(P.T.enter === 0 && P.T.freeze === 700 && P.T.kicker >= 900 && P.T.alias <= 1400 && P.T.out === 5500 && P.T.end === 6200, 'the brief\'s timeline');
  assert.ok(P.LATE_MS <= P.T.out, 'never a card that starts inside its own hand-over');
});
await test('the colours: the faction\'s slot (the same as the face looks and the stage stripe), else the signal orange; the name\'s ink reads on the field', () => {
  const none = P.palette('', FL);
  assert.deepEqual([none.field, none.ink, none.back, none.slot], ['#e0691e', '#14110e', '#fbf8f1', 0], 'no faction: signal orange, ink name, paper offset');
  const names = ['The Kestrel Club', 'The Tidewater Watch', 'The Pelican Rooms', 'Dock Union', 'The Quiet Hands', 'Harbour Board', 'The Glasshouse', 'Saint Vell Society'];
  const seen = {};
  for (const f of names) {
    const p = P.palette(f, FL), slot = FL.slotOf(f), c = FL.colours(slot);
    assert.equal(p.slot, slot); assert.equal(p.field, c[0], f + ': the faction fill');
    assert.equal(p.ink, c[1].toLowerCase() === '#14110e' ? '#14110e' : '#fbf8f1', f + ': the slot\'s ink');
    assert.notEqual(p.ink, p.back, f + ': the offset copy is the other colour');
    seen[p.ink] = true;
  }
  assert.ok(seen['#14110e'] && seen['#fbf8f1'], 'both kinds of slot are covered by the names above');
  assert.equal(P.palette('the kestrel club', FL).field, P.palette('The Kestrel Club', FL).field, 'one colour per faction, any case');
  assert.equal(P.palette('The Kestrel Club', null).field, '#e0691e', 'without the face looks: orange');
});
await test('the drawing: the Tell expression and the Signature pose from the look (names on the lists only); no spec, no figure', () => {
  const spec = { figure: 'fem', heightIn: 66, face: { expression: 'neutral' } };
  const s = P.specFor(spec, { expr: 'smirk', pose: 'lapel' }, FL);
  assert.equal(s.face.expression, 'smirk'); assert.equal(s.pose.arms.R, 'lapel');
  assert.equal(spec.face.expression, 'neutral', 'the served spec is not changed');
  const c = P.specFor(spec, { pose: 'cross' }, FL); assert.equal(c.pose.arms.R, 'cross'); assert.equal(c.pose.arms.L, 'cross', 'folded arms both sides');
  assert.equal(P.specFor(spec, { expr: 'GM-ONLY-x', pose: '<script>' }, FL), spec, 'junk names: the spec as served');
  assert.equal(P.specFor(spec, null, FL), spec);
  assert.equal(P.specFor(null, { expr: 'smirk' }, FL), null);
  assert.equal(P.kicker('The house', 'The Pelican Rooms'), 'The house · The Pelican Rooms');
  assert.equal(P.kicker('', 'The Pelican Rooms'), 'The Pelican Rooms'); assert.equal(P.kicker('', ''), '');
  assert.equal(P.initial('mabel Quist'), 'M'); assert.equal(P.initial('“Ox” Brand'), 'O'); assert.equal(P.initial(''), '?');
});
await test('the name\'s size: 14vh on one line when it fits, else the largest size on two lines, else smaller; never under the floor', () => {
  /* a fake page: a name of n characters at s vh is n * 0.42 * s wide (in vh); the box is W vh wide */
  const page = (chars, words, W) => (vh, wrap) => {
    const wide = chars * 0.42 * vh, longest = Math.max(...words) * 0.42 * vh;
    if (!wrap) return { fits: wide <= W, lines: 1 };
    let lines = 1, line = 0;
    for (const w of words) { const ww = w * 0.42 * vh; if (line && line + 0.2 * vh + ww > W) { lines++; line = ww; } else line += (line ? 0.2 * vh : 0) + ww; }
    return { fits: longest <= W, lines };
  };
  assert.deepEqual(P.fit(page(11, [5, 5], 86), { max: 14, min: 6 }), { size: 14, lines: 1 }, 'a short name: 14vh, one line');
  const two = P.fit(page(25, [12, 12], 86), { max: 14, min: 6 });
  assert.equal(two.size, 14); assert.equal(two.lines, 2, 'two long words: two lines at 14vh');
  const one = P.fit(page(14, [14], 60), { max: 14, min: 6 });
  assert.equal(one.lines, 1); assert.ok(one.size < 14 && one.size * 14 * 0.42 <= 60, 'one long word shrinks until it fits: ' + one.size);
  assert.deepEqual(P.fit(() => ({ fits: false, lines: 9 }), { max: 14, min: 6 }), { size: 6, lines: 2 }, 'nothing fits: the floor');
});
await test('item 5, the pose at the hand-over: the stage under the card starts its Signature pose 100 ms before the hand-over (the still card: before its cut), from the card\'s mount', () => {
  assert.equal(P.poseAt(-800, false), P.T.out - 100 + 800, 'mounted in the lead');
  assert.equal(P.poseAt(2000, false), P.T.out - 100 - 2000, 'a reload two seconds in');
  assert.equal(P.poseAt(0, true), P.STILL_MS - 100, 'the still card');
  assert.equal(P.poseAt(9999, false), 0, 'never under 0');
  assert.ok(P.T.out - P.POSE_LEAD + 3200 - P.T.end >= 2000, 'the pose holds a good while after the card ends (POSE_MS 3.2 s)');
  assert.equal(typeof I.poseAt, 'function'); assert.equal(I.poseAt(12345), 0, 'no card for that seq: 0 (the stage poses at once, as Show on iPad)');
  assert.match(read('display-page.js'), /applyStage\(st\.el, \{ look: vm\.look, spec: vm\.spec, npcId: vm\.npcId, seq: seq \}, figEnv, \{ poseAt: root\.B68PlayersIntro && typeof root\.B68PlayersIntro\.poseAt === 'function' \? root\.B68PlayersIntro\.poseAt\(seq\) : 0 \}\)/, 'the npc stage passes it');
});
await test('the card on a stub page: only the served player fields as text, the hidden NPC never drawn, any other push cuts it at once', () => {
  const made = [];
  class N {
    constructor(t) { this.tagName = t.toUpperCase(); this.children = []; this.parentNode = null; this.attrs = {}; this.className = ''; this.textContent = ''; this.style = { setProperty() {} };
      this.classList = { _s: new Set(), add: (c) => this.classList._s.add(c), remove: (c) => this.classList._s.delete(c), contains: (c) => this.classList._s.has(c) }; made.push(this); }
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c; }
    setAttribute(k, v) { this.attrs[k] = String(v); } getAttribute(k) { return this.attrs[k]; } removeAttribute(k) { delete this.attrs[k]; }
    querySelectorAll() { return []; } getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; }
  }
  const doc = { createElement: (t) => new N(t) };
  const box = new N('div');
  const all = (n, out = []) => { for (const c of n.children) { out.push(c); all(c, out); } return out; };
  const texts = () => all(box).map((n) => n.textContent).filter(Boolean).join(' | ');
  const timers = [];
  const at = new Date(Date.now() - P.LEAD_MS).toISOString();
  let on = true;
  const C = I.attach(box, { document: doc, on: () => on, still: () => false, skew: () => 0, at: () => at, later: (f, ms) => { timers.push([f, ms]); return timers.length; }, clearLater() {}, figure: () => null });
  const D = { kind: 'npc', npcId: 'n-mabel', title: 'Mabel Quist', intro: true, look: { expr: 'smirk' }, npc: { name: 'Mabel Quist', alias: 'Mab', role: 'Fixer', faction: 'The Kestrel Club', description: 'Not on the card.', spec: {} } };
  C.next(D, 7);
  assert.ok(C.state() && C.state().seq === 7, 'a card is up');
  const t = texts();
  assert.ok(t.includes('Mabel Quist') && t.includes('“Mab”') && t.includes('Fixer | The Kestrel Club') && t.includes('M'), 'name, alias, the kicker as two tapes (role, then faction), the monogram: ' + t);
  assert.ok(!t.includes('Not on the card'), 'never the description');
  C.next(D, 7); assert.equal(C.state().seq, 7, 'the same push drawn again: the card runs on');
  C.next({ kind: 'blank' }, 8);
  assert.equal(C.state(), null, 'Take it down / Clear / Blank / PANIC (a new seq): gone at once'); assert.equal(box.children.length, 0, 'nothing left in the DOM');
  C.next({ ...D, npc: undefined, title: 'GM-ONLY-NPC-1' }, 9);
  assert.equal(C.state(), null, 'a hidden NPC: no card'); assert.ok(!texts().includes('GM-ONLY'), 'and its title never drawn');
  on = false; C.next(D, 10); assert.equal(C.state(), null, 'setting off: no card'); on = true;
  C.next(D, 11); assert.ok(C.state()); C.destroy(); assert.equal(C.state(), null); assert.equal(box.children.length, 0, 'destroy takes it down');
});

/* ---------- the GM's half ---------- */
await test('the GM\'s push: Show on iPad\'s display with intro true and the look from the Tell and Signature lines (names only, never the notes)', async () => {
  const notes = 'GM-ONLY-NOTE owes the house\nTell: smirk — touches her cuff\nSignature: lapel\nRelation: society\n';
  assert.deepEqual(G.look(notes), { expr: 'smirk', pose: 'lapel', tell: true });
  assert.equal(G.look('nothing here'), null); assert.equal(G.look(''), null);
  assert.deepEqual(G.look('Tell: flat\nSignature: lean'), null, 'words not on the lists: no look');
  const b = G.body('n-mabel', { name: 'Mabel Quist', gmNotes: notes });
  assert.deepEqual(b, { kind: 'npc', npcId: 'n-mabel', title: 'Mabel Quist', intro: true, look: { expr: 'smirk', pose: 'lapel', tell: true } });
  assert.ok(!JSON.stringify(b).includes('GM-ONLY'), 'the notes never ride');
  assert.deepEqual(G.body('n-dov', { name: 'Dov Kessler' }), { kind: 'npc', npcId: 'n-dov', title: 'Dov Kessler', intro: true }, 'no lines: no look');
});
await test('the GM\'s Introduce: a revealed NPC is pushed at once; a hidden one is asked "Reveal and show?" first and revealed only on a yes; a failure says so', async () => {
  G._reset();
  const log = [];
  const mk = (d, o = {}) => ({ npc: () => d, ask: (m, go) => { log.push(['ask', m]); if (o.yes) go(); }, reveal: (id) => { log.push(['reveal', id]); d.revealed = true; return Promise.resolve(); },
    push: (x) => { log.push(['push', x]); return o.fail ? Promise.reject(o.fail) : Promise.resolve({ seq: 4 }); }, toast: (m, bad) => log.push(['toast', m, !!bad]), errText: (e) => e.message, tray: () => log.push(['tray']), later: () => 0 });
  const r = await G.introduce('n-mabel', mk({ name: 'Mabel Quist', revealed: true }));
  assert.deepEqual(r, { seq: 4 }, 'the push answer (the cue says "Introducing ..." on it)');
  assert.deepEqual(log.map((x) => x[0]), ['push', 'tray', 'toast']);
  assert.equal(log[0][1].intro, true); assert.equal(log[2][1], 'Introducing Mabel Quist.');
  log.length = 0;
  const hid = { name: 'GM-ONLY-NPC-1', revealed: false };
  await G.introduce('n-hid', mk(hid));
  assert.deepEqual(log, [['ask', 'Reveal and show? GM-ONLY-NPC-1 is hidden from the players. This reveals them to everyone and shows them on the iPad.']], 'the same words as Show on iPad; a no sends nothing');
  log.length = 0;
  await G.introduce('n-hid', mk(hid, { yes: true }));
  await new Promise((res) => setTimeout(res, 0));
  assert.deepEqual(log.map((x) => x[0]), ['ask', 'reveal', 'push', 'tray', 'toast'], 'yes: revealed first, then pushed');
  log.length = 0;
  await G.introduce('n-dov', mk({ name: 'Dov Kessler', revealed: true }, { fail: new Error('offline') }));
  assert.deepEqual(log, [['push', log[0][1]], ['toast', 'Could not introduce Dov Kessler on the iPad: offline', true]]);
  log.length = 0;
  const sup = new Error('newer'); sup.superseded = true;
  await G.introduce('n-dov', mk({ name: 'Dov Kessler', revealed: true }, { fail: sup }));
  assert.equal(log.filter((x) => x[0] === 'toast').length, 0, 'a push replaced by a newer one says nothing');
});
await test('the cue "Blade, introduce X": ONE toast (the cue\'s own, with Undo), and its Undo is Take it down for that NPC', async () => {
  G._reset();
  const log = [];
  const host = { npc: () => ({ name: 'Mabel Quist', revealed: true }), ask() {}, reveal: () => Promise.resolve(), push: () => Promise.resolve({ seq: 9 }), toast: (m) => log.push(['toast', m]),
    tray() {}, later() {}, takeDown: (t) => { log.push(['down', t]); return Promise.resolve(true); } };
  const r = await G.introduce('n-mabel', host, { quiet: true });
  assert.equal(r.seq, 9); assert.equal(typeof r.undo, 'function');
  assert.equal(log.filter((x) => x[0] === 'toast').length, 0, 'quiet: no toast of its own');
  await r.undo(); assert.deepEqual(log, [['down', 'Mabel Quist']], 'Undo takes her down (the page checks she is still what is up)');
  assert.match(read('gm/cue-grammar.js'), /typeof res\.undo === 'function' \? res\.undo : function \(\) \{ return clearIfMine\(key\); \}/, 'the cue uses the host\'s undo when it gives one');
  assert.match(read('gm-page.js'), /W\.B68GmIntro\.introduce\(payload\.npcIds\[0\], introHost\(\), \{ quiet: true \}\)/, 'the cue host asks for the quiet introduce');
});
await test('a reveal cue (item 6, opts.cue): silent, never asks, never pushes a hidden person; when the card cannot go up (Blank, hard start, frozen, a failed push) it answers why, and says nothing itself', async () => {
  G._reset();
  const mk = (d, o = {}) => { const log = []; return { log, host: { npc: () => d, ask: () => log.push('ask'), reveal: () => { log.push('reveal'); return Promise.resolve(); },
    push: (x) => { log.push(['push', x.npcId, x.intro]); return o.fail ? Promise.reject(o.fail) : Promise.resolve({ seq: 7 }); }, toast: (m) => log.push(['toast', m]), errText: (e) => e.message,
    tray() {}, later() {}, takeDown: () => log.push('down'), blocked: () => o.blocked || '' } }; };
  const a = mk({ name: 'Ada Vell', revealed: true }); const r1 = await G.introduce('n-ada', a.host, { cue: true });
  assert.deepEqual(a.log, [['push', 'n-ada', true]], 'one push, no toast, no question'); assert.equal(r1.seq, 7); assert.equal(typeof r1.undo, 'function');
  const h = mk({ name: 'GM-ONLY-NPC-1', revealed: false }); const r2 = await G.introduce('n-hid', h.host, { cue: true });
  assert.deepEqual(h.log, [], 'a hidden person: nothing sent, nothing asked (the reveal\'s own write comes first)'); assert.ok(r2.notShown);
  for (const why of ['the iPad is on Blank', 'the hard start is running', 'the iPad is frozen']) {
    const b = mk({ name: 'Ada Vell', revealed: true }, { blocked: why }); const r = await G.introduce('n-ada', b.host, { cue: true });
    assert.deepEqual(b.log, [], why + ': no push, no toast'); assert.equal(r.notShown, why);
  }
  const f = mk({ name: 'Ada Vell', revealed: true }, { fail: new Error('offline') }); const r3 = await G.introduce('n-ada', f.host, { cue: true });
  assert.equal(r3.notShown, 'offline'); assert.equal(f.log.filter((x) => x[0] === 'toast').length, 0, 'the caller says the one line');
  assert.match(read('gm-page.js'), /if \(x\.d\.revealed === true\) return introOn\(\) \? revealShown\(x\) : Promise\.resolve\(\{ ok: true \}\);/, 'the cue stack: already revealed, brought on (setting on); off, as before');
  assert.match(read('gm-page.js'), /me\.npcs\[x\.id\]\.revealed = true; return introOn\(\) \? revealShown\(x\) : \{ ok: true \};/, 'the cue stack: after its own reveal write, brought on (setting on); off, as before');
  assert.match(read('gm/cue-stack.js'), /say\(r\.say \? r\.say : MANUAL\[c\.kind\]/, 'a fired cue may say its own one line');
});
await test('the Run view people rows: with the setting on, Introduce is enabled for a hidden person (it asks) and says what it does; off, as before', () => {
  const Sp = req(path.join(APP, 'gm', 'spotlight.js'));
  const rows = [{ id: 'n-mabel', name: 'Mabel Quist', revealed: true }, { id: 'n-hid', name: 'GM-ONLY-NPC-1', revealed: false }];
  const btn = (html, id) => (html.match(new RegExp('<button[^>]*data-site="intro" data-id="' + id + '"[^>]*>')) || [''])[0];
  const on = Sp.rowsHtml(rows, null, { room: 'Bar', introduce: true, players: true });
  assert.ok(!/disabled/.test(btn(on, 'n-hid')) && /asks to reveal/.test(btn(on, 'n-hid')), 'on, hidden: enabled, and it says it asks: ' + btn(on, 'n-hid'));
  assert.ok(/whole-screen title card/.test(btn(on, 'n-mabel')) && !/lower third/.test(on), 'on: no stale lower-third words');
  const off = Sp.rowsHtml(rows, null, { room: 'Bar', introduce: true });
  assert.ok(/disabled/.test(btn(off, 'n-hid')) && /lower third/.test(btn(off, 'n-mabel')), 'off: as before');
});
await test('the tray: "Introducing <name>" while the card plays, then the ordinary line', async () => {
  G._reset();
  const host = { npc: () => ({ name: 'Mabel Quist', alias: 'Mab', revealed: true }), ask() {}, reveal: () => Promise.resolve(), push: () => Promise.resolve({ seq: 1 }), toast() {}, tray() {}, later() {} };
  await G.introduce('n-mabel', host);
  const now = Date.now(), shown = { kind: 'npc', title: 'Mabel Quist' };
  assert.equal(G.live(shown, now), 'Mabel Quist'); assert.equal(G.live({ kind: 'npc', title: 'Mab' }, now), 'Mab', 'a known-as NPC titled by the alias');
  assert.equal(G.live(shown, now + G.CARD_MS + 1), '', 'after the card');
  assert.equal(G.live({ kind: 'npc', title: 'Dov Kessler' }, now), '', 'another NPC pushed since');
  assert.equal(G.live({ kind: 'blank', title: '' }, now), '', 'taken down');
  const items = Tray.liveItems({ shown, doc: null, now, intro: G.live(shown, now) });
  assert.equal(items[0].text, 'Introducing Mabel Quist'); assert.equal(items[0].up, true);
  assert.equal(Tray.liveItems({ shown, doc: null, now })[0].text, 'Mabel Quist (NPC)', 'no intro: the line as before');
});

/* ---------- the server ---------- */
await test('cleanDisplay: intro (only true) and look (cleaned names) are kept on an npc display and on nothing else; junk is dropped, never a 400', () => {
  assert.deepEqual(cleanDisplay({ kind: 'npc', npcId: 'n-mabel', title: 'Mabel Quist', intro: true, look: { expr: 'smirk', pose: 'lapel', junk: 1 } }),
    { kind: 'npc', title: 'Mabel Quist', caption: '', npcId: 'n-mabel', intro: true, look: { expr: 'smirk', pose: 'lapel' } });
  assert.deepEqual(cleanDisplay({ kind: 'npc', npcId: 'n-mabel', intro: 'yes', look: { expr: 'GM-ONLY-1' } }), { kind: 'npc', title: '', caption: '', npcId: 'n-mabel' }, 'junk dropped');
  assert.deepEqual(cleanDisplay({ kind: 'npc', npcId: 'n-mabel', look: 'smirk' }), { kind: 'npc', title: '', caption: '', npcId: 'n-mabel' }, 'a look that is not an object: dropped');
  assert.deepEqual(cleanDisplay({ kind: 'npc', npcId: 'n-mabel' }), { kind: 'npc', title: '', caption: '', npcId: 'n-mabel' }, 'Show on iPad: as before');
  assert.deepEqual(cleanDisplay({ kind: 'blank', intro: true, look: { expr: 'smirk' } }), { kind: 'blank', title: '', caption: '' }, 'not on any other kind');
});
const GMU = { me: { role: 'gm', email: 'gm@example.test' } }, DISPLAY = { me: { role: 'display', email: 'table@example.test' } };
async function freshDb() { const raw = asD1(await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') })); return { prepare: (q) => raw.prepare(q), batch: (l) => raw.batch(l), raw }; }
const call = async (db, method, url, body, who = GMU) => {
  try { return await displayHandler({ request: new Request('http://x.test' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env: { DB: db }, data: who, waitUntil() {} }); }
  catch (e) { if (e && Number.isInteger(e.status)) return new Response(JSON.stringify({ error: e.message }), { status: e.status }); throw e; }
};
const stamp = new Date().toISOString();
async function addNpc(db, id, d) { await db.raw.prepare('INSERT INTO npcs (id, campaign, created_at, updated_at, deleted, doc) VALUES (?1, ?2, ?3, ?3, 0, ?4)').bind(id, 'default', stamp, JSON.stringify(d)).run(); }
await test('the display GET (the iPad\'s sign-in): an introduced, revealed NPC comes with intro, look, updatedAt and the joined player view; hidden again, neither intro nor look nor any name of theirs', async () => {
  const db = await freshDb();
  await addNpc(db, 'n-mabel', { name: 'Mabel Quist', alias: 'Mab', role: 'Fixer', faction: 'The Kestrel Club', description: 'Counts twice.', gmNotes: 'GM-ONLY-NOTES Tell: smirk', revealed: true, spec: { figure: 'fem', heightIn: 66 } });
  const put = await call(db, 'PUT', '/api/gm/display', { kind: 'npc', npcId: 'n-mabel', title: 'Mabel Quist', intro: true, look: { expr: 'smirk', pose: 'lapel' } });
  assert.equal(put.status, 200);
  const pj = await put.json(); assert.ok(typeof pj.updatedAt === 'string' && isFinite(Date.parse(pj.updatedAt)), 'the push answer carries the server time');
  const g = await (await call(db, 'GET', '/api/gm/display?seq=-1&aseq=-1&sseq=-1&hseq=-1', undefined, DISPLAY)).json();
  assert.equal(g.display.intro, true); assert.deepEqual(g.display.look, { expr: 'smirk', pose: 'lapel' });
  assert.equal(g.updatedAt, pj.updatedAt, 'the same server value reaches every screen');
  assert.equal(typeof g.now, 'number', 'the GET carries the server clock (the page\'s skew)');
  assert.deepEqual(Object.keys(g.display.npc).sort(), ['alias', 'description', 'faction', 'name', 'role', 'spec']);
  assert.ok(!JSON.stringify(g).includes('GM-ONLY'), 'never the notes');
  /* the GM hides her again with the card still stored */
  await db.raw.prepare('UPDATE npcs SET doc = ?2 WHERE id = ?1').bind('n-mabel', JSON.stringify({ name: 'GM-ONLY-NPC-1', alias: 'GM-ONLY-ALIAS', revealed: false, gmNotes: 'GM-ONLY-NOTES' })).run();
  await call(db, 'PUT', '/api/gm/display', { kind: 'npc', npcId: 'n-mabel', title: '', intro: true, look: { expr: 'smirk' } });
  const h = await (await call(db, 'GET', '/api/gm/display?seq=-1&aseq=-1&sseq=-1&hseq=-1', undefined, DISPLAY)).json();
  assert.ok(!('npc' in h.display) && !('look' in h.display) && !('intro' in h.display), 'hidden: no join, no look, no card: ' + JSON.stringify(h.display));
  assert.ok(!JSON.stringify(h).includes('GM-ONLY'), 'and no name of theirs');
});

/* ---------- the files ---------- */
await test('the files: no markup sink, no request, no hand-built button, no important flag, no native confirm, no stray characters; every rule is .pi- markup', () => {
  for (const f of ['display/players/intro.js', 'gm/players-intro.js']) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment/.test(code), f + ': a markup sink');
    assert.ok(!/fetch\(|XMLHttpRequest|\.src\s*=|sendBeacon|WebSocket/.test(code), f + ': a request');
    assert.ok(!/<button|confirm\(|prompt\(/.test(code), f + ': a hand-built button or a native dialog');
  }
  const css = read('display/players/intro.css');
  assert.ok(!/!\s*important/i.test(css) && !/style=/.test(css));
  for (const f of ['display/players/intro.css', 'display/players/intro.js', 'gm/players-intro.js']) assert.ok(![...read(f)].some((c) => c.codePointAt(0) >= 0x80 && c.codePointAt(0) <= 0x9f), f + ': a character in U+0080 to U+009F');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '').replace(/@media[^{]+\{/g, '');
  const sels = (rules.match(/[^{}]+\{/g) || []).map((s) => s.slice(0, -1).trim()).filter(Boolean);
  assert.ok(sels.length > 20, 'the sheet has its rules: ' + sels.length);
  for (const s of sels) for (const one of s.split(',')) assert.ok(/^\.pi-/.test(one.trim()), 'a rule that is not .pi- markup: ' + one.trim());
  const R = req(path.join(APP, 'routes.js'));
  const B = (R && R.BUNDLES) || (globalThis.B68Load && globalThis.B68Load.BUNDLES);
  assert.ok(B && Array.isArray(B.display), 'the bundles');
  {
    assert.ok(B.display.includes('display/players/intro.js') && B.display.includes('display/players/intro.css') && B.display.indexOf('display/players/intro.js') < B.display.indexOf('display-page.js'), 'in the display bundle');
    assert.ok(B.gm.includes('gm/players-intro.js') && B.gm.indexOf('gm/players-intro.js') < B.gm.indexOf('gm-page.js'), 'in the gm bundle');
    for (const [n, files] of Object.entries(B)) if (n !== 'display' && n !== 'gm') assert.ok(!files.some((f) => /players[-/]intro/.test(f)), n + ' does not load it');
  }
  assert.match(read('display-page.js'), /if \(s\.intro\) s\.intro\.next\(display, seq\);/, 'the display page hands every push to it');
  assert.match(read('display-page.js'), /on: function \(\) \{ return swOn\('stage\.players'\); \}/, 'behind the setting');
  assert.match(read('display-page.js'), /still: function \(\) \{ return reduced\(\); \}/, 'only the device\'s reduced motion makes the card still: Hold scenes still holds the ambient scenes, not a sent event (overseer ruling)');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
