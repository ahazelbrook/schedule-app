// Unit test for scripts/lib/downtime-export.mjs: the GM pack's `downtime` part (the Good Mornings) from a vault note with
// `gm_downtime: true`. The note here is invented (no book text, no zine text): the real one lives only in the vault.
//   node checks/runtime/gm-downtime-export.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { buildDowntime, parseGood } from '../../scripts/lib/downtime-export.mjs';

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
  '## The Good Morning', '', 'Roll 2d6.', '',
  '### 1 · Friends', '', '| d66 | |', '|---|---|', '| **11** | A friend at {place}. |', '| **12** | {Host} remembers you, and a pipe \\| stays a pipe. |', '',
  '```js', '### 2 · Not a heading inside a fence', '| **21** | not a row |', '```', '',
  '### 2 · Things', '', '| d66 | |', '|---|---|', '| **21** | A **parcel**, and [[Some Page|a link]] as its text. |', '| **22** | |', '',
  '## The Bad Morning', '', '### Brag', '', '*+2 Heat.*', '', '| d6 | What happened |', '|---|---|', '| **1** | Not a Good Morning. |', ''
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

await test('parseGood(): the "## The Good Morning" tables, kind by kind, in order; fences, empty rows and other sections are left out', () => {
  assert.deepEqual(parseGood(NOTE), [
    { kind: 'Friends', lines: ['A friend at {place}.', '{Host} remembers you, and a pipe | stays a pipe.'] },
    { kind: 'Things', lines: ['A **parcel**, and a link as its text.'] }
  ]);
  assert.deepEqual(parseGood('# Nothing here\n\n## Other\n\n### 1 · X\n\n| **11** | no |\n'), []);
});

await test('buildDowntime(): the flagged note becomes { src, v, rel, T: { good } }; the module draws from it', () => {
  const warns = [];
  const v = vaultWith({ [G + '/House rules/rule.md']: NOTE, [G + '/Other/plain.md']: '---\ngm_downtime: false\n---\n## The Good Morning\n### 1 · Y\n| **11** | z |\n' });
  const part = buildDowntime({ vault: v, exportedAt: '2026-10-17T00:00:00.000Z', warn: (w) => warns.push(w) });
  assert.equal(part.rel, G + '/House rules/rule.md');
  assert.deepEqual(Object.keys(part).sort(), ['T', 'rel', 'src', 'v']);
  assert.equal(part.v, 1); assert.equal(part.src.file, part.rel); assert.match(part.src.blockSha, /^[0-9a-f]{64}$/);
  assert.equal(part.T.good.length, 2);
  assert.ok(warns.some((w) => /2 kinds and 3 lines/.test(w)), 'a table that is not 6 by 6 is reported: ' + warns);
  assert.deepEqual(D.check(T, part.T), [], 'the part lays over the built-in tables without a gap');
  const r = D.create({ T, pack: part.T }).roll({ act: 'indulge', vice: 'Faith', purveyor: 'Aldo, the Sanctorium', vres: 'crit' }, { seed: 2, mem: {} });
  const goods = r.lines.filter((l) => /^good/.test(l.id));
  assert.equal(goods.length, 2);
  for (const g of goods) assert.ok(/^\*\*Good Morning\.\*\* /.test(g.md) && !/[{}]/.test(g.md) && / · the Morning After$/.test(g.small), JSON.stringify(g));
  const again = buildDowntime({ vault: v, exportedAt: 'later', warn: () => {} });
  assert.equal(again.src.blockSha, part.src.blockSha, 'the same tables, the same hash (gm:pack keeps the old exportedAt)');
});

await test('buildDowntime(): no flagged note, or a flagged note with no tables, is no part', () => {
  assert.equal(buildDowntime({ vault: vaultWith({ [G + '/a.md']: '# A\n' }), exportedAt: 'x' }), null);
  const warns = [];
  assert.equal(buildDowntime({ vault: vaultWith({ [G + '/a.md']: '---\ngm_downtime: true\n---\n# A\n' }), exportedAt: 'x', warn: (w) => warns.push(w) }), null);
  assert.ok(warns.some((w) => /no "## The Good Morning" tables/.test(w)), String(warns));
  assert.equal(buildDowntime({ vault: vaultWith({ [G + '/_archive/a.md']: NOTE }), exportedAt: 'x' }), null, 'a folder starting with _ is not read');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
