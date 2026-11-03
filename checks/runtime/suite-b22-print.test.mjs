// Suite B22, tickets 3.6 and 2.11 (switches print.cards and print.blueprint; no browser, no network): the cards, the tent standee and the blueprint page, and the
// controller against a fake host. INVENTED data only (the Pelican Rooms cast); GM-ONLY- markers for anything that must never be printed.
//   node checks/runtime/suite-b22-print.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const Print = require(path.join(ROOT, 'app', 'gm', 'print.js'));
const F = require(path.join(ROOT, 'app', 'features.js'));

const NPCS = {
  a: { name: 'Mara Quill', alias: 'The Clerk', role: 'Registrar', faction: 'Pelican Rooms', revealed: true, tags: ['major'], gmNotes: 'GM-ONLY-note-a', description: 'GM-ONLY-desc-a' },
  b: { name: 'Odo <Bell>', alias: '', role: 'Porter', faction: '', revealed: true, tags: [], gmNotes: 'GM-ONLY-note-b' },
  c: { name: 'Hidden Person', alias: 'GM-ONLY-alias', role: 'Spy', revealed: false, tags: ['major'] },
  d: { name: '  ', revealed: true },
  e: { name: 'Pip Marlow', role: 'Cook', revealed: true, tags: ['Major '] }
};

await test('switches: both ship GM-only, off by default, with bland text', () => {
  for (const id of ['print.cards', 'print.blueprint']) {
    const s = F.get(id); assert.ok(s, id); assert.equal(s.surface, 'gm'); assert.equal(s.default, false);
    assert.equal(F.valueOf({}, id), false);
  }
  assert.ok(!F.publicIds().includes('print.cards'));
});

await test('cardsOf: revealed and named only, name order, major by tag, no GM fields', () => {
  const c = Print.cardsOf(NPCS);
  assert.deepEqual(c.map((x) => x.id), ['a', 'b', 'e']);
  assert.deepEqual(c.map((x) => x.major), [true, false, true]);
  assert.ok(!JSON.stringify(c).includes('GM-ONLY'));
  assert.deepEqual(Print.majorsOf(NPCS).map((x) => x.id), ['a', 'e']);
  assert.deepEqual(Print.cardsOf(null), []);
});

await test('cardsHtml: ten to an A4 sheet, 85 x 55 mm, escaped, nothing hidden', () => {
  const many = Array.from({ length: 23 }, (_, i) => ({ id: 'n' + i, name: 'Name ' + i, alias: '', role: 'Role', faction: '' }));
  const h = Print.cardsHtml(many);
  assert.equal((h.match(/class="sheet"/g) || []).length, 3);
  assert.equal((h.match(/class="card"/g) || []).length, 23);
  assert.ok(h.includes('size:A4 portrait') && h.includes('width:85mm;height:55mm') && h.includes('grid-template-rows:repeat(5,55mm)'));
  const one = Print.cardsHtml(Print.cardsOf(NPCS));
  assert.ok(one.includes('Odo &lt;Bell&gt;') && !one.includes('<Bell>'));
  assert.ok(!one.includes('GM-ONLY') && !one.includes('Hidden Person'));
});

await test('standeeHtml: cover on the front; silhouette back by default, the typed true identity otherwise', () => {
  const card = Print.majorsOf(NPCS)[0];
  const sil = Print.standeeHtml(card, '');
  assert.ok(sil.includes('Mara Quill') && sil.includes('<svg') && !sil.includes('Behind the face'));
  const tru = Print.standeeHtml(card, 'Inspector <Vane>');
  assert.ok(tru.includes('Inspector &lt;Vane&gt;') && tru.includes('Behind the face') && !tru.includes('<svg'));
  assert.ok(!sil.includes('GM-ONLY') && !tru.includes('GM-ONLY'));
});

await test('blueprintHtml: A3 and A4 landscape, title block and pencil margin', () => {
  const d = { title: 'The Pelican Rooms', caption: 'public, work', svg: '<svg id="plan"></svg>' };
  const a3 = Print.blueprintHtml(d, 'A3'), a4 = Print.blueprintHtml(d, 'A4'), odd = Print.blueprintHtml(d, 'B5');
  assert.ok(a3.includes('size:A3 landscape') && a3.includes('width:420mm'));
  assert.ok(a4.includes('size:A4 landscape') && a4.includes('width:297mm') && odd.includes('size:A4 landscape'));
  assert.ok(a4.includes('<svg id="plan">') && a4.includes('Grease pencil') && a4.includes('The Pelican Rooms') && a4.includes('Known to the crew'));
});

await test('controller: prints through the host, refuses safely, never prints a hidden NPC', () => {
  const out = [], said = [];
  let bp = { title: 'T', caption: 'c', svg: '<svg></svg>' };
  const ctl = Print.make({ npcs: () => NPCS, print: (h) => { out.push(h); return true; }, toast: (m, bad) => said.push([m, bad]), blueprint: () => { if (bp instanceof Error) throw bp; return bp; } });
  assert.equal(ctl.printCards(), true);
  assert.equal(ctl.printStandee('a', ''), true);
  assert.equal(ctl.printStandee('b', ''), false, 'not major');
  assert.equal(ctl.printStandee('c', ''), false, 'hidden');
  assert.equal(ctl.printBlueprint('A3'), true);
  bp = new Error('This view would name a hidden room'); assert.equal(ctl.printBlueprint('A4'), false);
  bp = null; assert.equal(ctl.printBlueprint('A4'), false);
  assert.equal(out.length, 3); assert.equal(said.length, 4);
  assert.ok(out.every((h) => !h.includes('GM-ONLY') && !h.includes('Hidden Person')));
  assert.equal(Print.make({ npcs: () => ({}), print: () => true, toast: () => {} }).printCards(), false);
});

await test('wiring: routes bundle, Menu hook, and the page hook goes through the player door', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8');
  assert.ok(routes.includes("'gm/print.js', 'gm-page.js'"));
  assert.ok(!/display:\s*\[[^\]]*gm\/print\.js/.test(routes), 'players and the display never fetch it');
  const g = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  assert.ok(g.includes("case 'print':") && g.includes('prMenuSync()') && /theme: 'casefile'[^}]*\}\), W\.B68Map/.test(g) && g.includes("layer: 'player', view: 'plan'"));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
