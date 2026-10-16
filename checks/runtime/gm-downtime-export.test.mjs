// Unit test for scripts/lib/downtime-export.mjs: the GM pack's `downtime` part (the Morning After's Benefits and Mishaps)
// from a vault note with `gm_downtime: true`. The note here is invented (no book text, no zine text): the real one lives
// only in the vault.
//   node checks/runtime/gm-downtime-export.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { buildDowntime, parseMorning } from '../../scripts/lib/downtime-export.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const D = require(path.join(ROOT, 'app', 'gm', 'downtime.js'));
const T = require(path.join(ROOT, 'app', 'downtime-tables.js')).T;

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

const NOTE = [
  '---', 'wiki: guide', 'gm_downtime: true', 'tags:', '  - x', '---', '', '# An invented house rule', '',
  '## How it runs', '', '**01–50 · Not an entry.** It is outside the two tables. *"No."* **No.**', '',
  '```js', '## Benefits', '### 01–50 · Not a band inside a fence', '**01–50 · Not an entry.** x', '```', '',
  '## Benefits', '', 'Roll high.', '',
  '### 01–50 · Small', '', '*A band note in italics.*', '',
  '**01–20 · The biscuit.** A baker at {place} hands you a biscuit. *"Mind the crumbs."* **A biscuit.**',
  '**Play it:** who baked it, and for whom?', '',
  '**21–50 · The [[Some Page|word]].** A neighbour stops you. *"I heard a thing."* **One answer.**', '',
  '### 51–00 · Big', '',
  '**51–00 · The medal.** A clerk pins a medal on you. *"For services."* **Standing.**',
  '**Play it:** what services?', '',
  '## Mishaps', '',
  '### 01–00 · All of them', '',
  '**01–60 · The song.** A busker sings about you. *"Here they are!"* **Brag: +2 Heat.**',
  '**Play it:** take a bow?', '',
  '**61–00 · The door.** {Host} shuts the door. *"Not tonight."* **Tapped.**', '',
  '## What came from where', '', '**01–02 · Not an entry either.** x', ''
].join('\n');

function vaultWith(files) {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-dt-export-'));
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(v, ...rel.split('/'));
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  return v;
}
const G = 'Wiki/Games/Blades in the Dark';

await test('parseMorning(): the "## Benefits" and "## Mishaps" entries, band by band, in order; fences, notes and other sections are left out', () => {
  const m = parseMorning(NOTE);
  assert.deepEqual(m.benefit, [
    { lo: 1, hi: 20, band: '01–50 · Small', title: 'The biscuit', md: 'A baker at {place} hands you a biscuit. *"Mind the crumbs."* **A biscuit.**', play: 'who baked it, and for whom?', cost: '' },
    { lo: 21, hi: 50, band: '01–50 · Small', title: 'The word', md: 'A neighbour stops you. *"I heard a thing."* **One answer.**', play: '', cost: '' },
    { lo: 51, hi: 100, band: '51–00 · Big', title: 'The medal', md: 'A clerk pins a medal on you. *"For services."* **Standing.**', play: 'what services?', cost: '' }
  ]);
  assert.deepEqual(m.mishap.map((e) => [e.lo, e.hi, e.title, e.cost, e.play]), [[1, 60, 'The song', 'brag', 'take a bow?'], [61, 100, 'The door', 'tapped', '']]);
  assert.deepEqual(parseMorning('# Nothing here\n\n## Other\n\n### 01–20 · X\n\n**01–20 · No.** x\n'), { benefit: [], mishap: [] });
  assert.deepEqual(parseMorning('## Benefits\n\n**01–20 · No band yet.** x\n').benefit, [], 'an entry before any band is not read');
  const crlf = parseMorning(NOTE.replace(/\n/g, '\r\n').replace(/\r\n/g, '\n'));
  assert.equal(crlf.benefit.length, 3);
});

await test('buildDowntime(): the flagged note becomes { src, v: 2, rel, T: { benefit, mishap } }; the module deals from it', () => {
  const warns = [];
  const v = vaultWith({ [G + '/House rules/rule.md']: NOTE, [G + '/Other/plain.md']: '---\ngm_downtime: false\n---\n## Benefits\n### 01–00 · Y\n**01–00 · Z.** z\n' });
  const part = buildDowntime({ vault: v, exportedAt: '2026-10-17T00:00:00.000Z', warn: (w) => warns.push(w) });
  assert.equal(part.rel, G + '/House rules/rule.md');
  assert.deepEqual(Object.keys(part).sort(), ['T', 'rel', 'src', 'v']);
  assert.equal(part.v, 2); assert.equal(part.src.file, part.rel); assert.match(part.src.blockSha, /^[0-9a-f]{64}$/);
  assert.deepEqual([part.T.benefit.length, part.T.mishap.length], [3, 2]);
  assert.deepEqual(warns, [], 'a table that runs 1 to 100 with no gap is not reported');
  assert.deepEqual(D.check(T, part.T), [], 'the part lays over the built-in tables without a gap');
  const dt = D.create({ T, pack: part.T });
  const r = dt.roll({ act: 'indulge', vice: 'Faith', purveyor: 'Aldo, the Sanctorium', d100: '30' }, { seed: 2, mem: {} });
  assert.deepEqual(r.morning.cards.map((c) => c.title), ['The word', 'The biscuit'], 'the d100 lands on its entry, the second card from its band');
  assert.ok(!/[{}]/.test(r.morning.cards[1].md) && /the Sanctorium/.test(r.morning.cards[1].md), 'slots filled: ' + r.morning.cards[1].md);
  const o = dt.roll({ act: 'indulge', vice: 'Faith', purveyor: 'Aldo, the Sanctorium', res: 'over', d100: '00' }, { seed: 2, mem: {} });
  assert.deepEqual([o.morning.cards[0].title, o.morning.cards[0].cost.id, o.morning.cards[1].cost.id], ['The door', 'tapped', 'brag']);
  const again = buildDowntime({ vault: v, exportedAt: 'later', warn: () => {} });
  assert.equal(again.src.blockSha, part.src.blockSha, 'the same tables, the same hash (gm:pack keeps the old exportedAt)');
});

await test('buildDowntime(): a gap, an overlap or a missing table is reported, never fatal', () => {
  const warns = [];
  const holey = NOTE.replace('**21–50 · The [[Some Page|word]].**', '**25–55 · The [[Some Page|word]].**').replace('**61–00 · The door.** {Host} shuts the door. *"Not tonight."* **Tapped.**', '');
  const part = buildDowntime({ vault: vaultWith({ [G + '/r.md']: holey }), exportedAt: 'x', warn: (w) => warns.push(w) });
  assert.ok(part && part.T.benefit.length === 3 && part.T.mishap.length === 1, 'the part is still built');
  assert.ok(warns.some((w) => /the Benefits skip 21–24/.test(w) && /overlap at 51/.test(w) && /the Mishaps stop at 60/.test(w)), String(warns));
  const w2 = [];
  buildDowntime({ vault: vaultWith({ [G + '/r.md']: NOTE.slice(0, NOTE.indexOf('## Mishaps')) }), exportedAt: 'x', warn: (w) => w2.push(w) });
  assert.ok(w2.some((w) => /no Mishaps/.test(w)), String(w2));
});

await test('buildDowntime(): no flagged note, or a flagged note with no entries, is no part', () => {
  assert.equal(buildDowntime({ vault: vaultWith({ [G + '/a.md']: '# A\n' }), exportedAt: 'x' }), null);
  const warns = [];
  assert.equal(buildDowntime({ vault: vaultWith({ [G + '/a.md']: '---\ngm_downtime: true\n---\n# A\n\n## The Good Morning\n\n### 1 · X\n\n| **11** | old |\n' }), exportedAt: 'x', warn: (w) => warns.push(w) }), null);
  assert.ok(warns.some((w) => /no "## Benefits" or "## Mishaps" entries/.test(w)), String(warns));
  assert.equal(buildDowntime({ vault: vaultWith({ [G + '/_archive/a.md']: NOTE }), exportedAt: 'x' }), null, 'a folder starting with _ is not read');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
