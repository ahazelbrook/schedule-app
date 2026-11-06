// A1 (switch ai.keyterms): the key terms the table iPad passes to the transcriber's stream. Unit tests on the terms list and the URL, and
// the token handler on an in-memory D1 with a faked Deepgram. NO live Deepgram call, ever. Invented names; every GM-only string is a GM-ONLY- marker.
//   node checks/runtime/gm-keyterms.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { buildKeyterms, keytermQuery, KEY_MAX, KEY_CHARS, KEY_ONE } from '../../functions/_lib/keyterms.js';
import { onRequest as tokenApi } from '../../functions/api/gm/stt-token.js';
import { patchState } from '../../functions/_lib/gm.js';
import { writeNpc } from '../../functions/_lib/npcs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ST = createRequire(import.meta.url)(path.join(ROOT, 'app', 'stt.js'));
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const CAMP = { pcs: [{ name: 'Rook Vance', alias: 'Rook' }, { name: 'Mina Ashe' }], standing: [{ faction: 'The Pelican Rooms Guild', status: 1 }, { faction: 'Lamp Street Crew' }], districts: ['Pelican Quay', { name: 'Lamp Street' }],
  npcs: [{ name: 'GM-ONLY-Hidden Pack Npc', faction: 'x' }] };

await test('terms: Blade first, then PCs, revealed cast, factions, districts; deduped; hidden pack NPCs never appear', () => {
  const t = buildKeyterms(CAMP, [{ name: 'Dot Marsh', alias: '' }, { name: 'rook' }]);
  assert.deepEqual(t, ['Blade', 'Rook Vance', 'Rook', 'Mina Ashe', 'Dot Marsh', 'The Pelican Rooms Guild', 'Lamp Street Crew', 'Pelican Quay', 'Lamp Street']);
  assert.ok(!t.join('|').includes('GM-ONLY'));
});
await test('terms: the caps hold (count, characters, one term), junk is skipped, nothing throws', () => {
  const many = []; for (let i = 0; i < 300; i++) many.push({ name: 'Person Number ' + i });
  const t = buildKeyterms({ pcs: many }, []);
  assert.ok(t.length <= KEY_MAX && t.join('').length <= KEY_CHARS, 'count ' + t.length);
  assert.ok(buildKeyterms({ pcs: [{ name: 'x'.repeat(KEY_ONE + 1) }, { name: 'a&b' }, { name: 5 }, null] }, null).length === 1);
  assert.deepEqual(buildKeyterms(null, undefined), ['Blade']);
  assert.equal(keytermQuery(['Mina Ashe', 'Dot']), 'keyterm=Mina%20Ashe&keyterm=Dot');
});
await test('iPad url: Blade is not repeated, terms are encoded, the caps hold, bad input is the plain URL', () => {
  const u = ST.urlFor(['Blade', 'Mina Ashe', 'mina ashe', 5, 'x'.repeat(40)]);
  assert.equal(u, ST.DG_URL + '&keyterm=Mina%20Ashe');
  assert.equal(ST.urlFor(null), ST.DG_URL); assert.equal(ST.urlFor([]), ST.DG_URL);
  const long = ST.urlFor(Array.from({ length: 200 }, (_, i) => 'Name ' + i));
  assert.ok((long.match(/keyterm=/g) || []).length <= KEY_MAX, 'count');
  assert.ok(decodeURIComponent(long.split('?')[1]).length < 1400);
});

const newDb = async () => asD1(await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') }));
const mkEnv = (db) => ({ DB: db, DEEPGRAM_API_KEY: 'k', __fetch: async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'jwt', expires_in: 30 }) }) });
const post = async (env, role) => { const r = await tokenApi({ request: new Request('http://x/api/gm/stt/token', { method: 'POST', body: '{}' }), env, data: { me: { role } } }); return r.json(); };
async function seed(db, on) {
  await db.prepare('INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind('default', 'campaign', 'v1', '{}', 1, JSON.stringify(CAMP)).run();
  const mk = (name, revealed) => (row, now) => ({ name, alias: '', revealed, gmNotes: 'GM-ONLY-notes', createdAt: now });
  await writeNpc(db, 'default', 'n_shown', mk('Dot Marsh', true));
  await writeNpc(db, 'default', 'n_hidden', mk('GM-ONLY-Hidden Row Npc', false));
  if (on !== undefined) await patchState(db, 'default', { features: { 'ai.keyterms': on } });
}
await test('token: the key terms come whatever is stored (N0: everything built is on): never set, or a stored false, still adds them (revealed NPCs only)', async () => {
  for (const on of [undefined, false]) {
    const db = await newDb(); await seed(db, on); const out = await post(mkEnv(db), 'display');
    assert.equal(out.token, 'jwt'); assert.equal(out.expiresIn, 30);
    assert.ok(Array.isArray(out.keyterms) && out.keyterms.includes('Blade') && out.keyterms.includes('Rook Vance'), String(on) + ': ' + JSON.stringify(out.keyterms));
    assert.ok(!JSON.stringify(out).includes('GM-ONLY'), 'a hidden NPC is never a key term');
  }
});
await test('token: switch on adds keyterms, revealed NPCs only; a hidden NPC (row or pack) is absent, for the iPad and the GM', async () => {
  const db = await newDb(); await seed(db, true);
  for (const role of ['display', 'gm']) {
    const out = await post(mkEnv(db), role);
    assert.deepEqual(out.keyterms, ['Blade', 'Rook Vance', 'Rook', 'Mina Ashe', 'Dot Marsh', 'The Pelican Rooms Guild', 'Lamp Street Crew', 'Pelican Quay', 'Lamp Street']);
    assert.ok(!JSON.stringify(out).includes('GM-ONLY'));
  }
});
await test('token: no pack and no cast still opens (just Blade); a read failure drops the terms, never the token', async () => {
  const db = await newDb(); await patchState(db, 'default', { features: { 'ai.keyterms': true } });
  assert.deepEqual((await post(mkEnv(db), 'display')).keyterms, ['Blade']);
  const bad = mkEnv(asD1(await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') })));
  const real = bad.DB.prepare.bind(bad.DB); bad.DB.prepare = (sql) => { if (/gm_pack/.test(sql)) throw new Error('boom'); return real(sql); };
  assert.equal((await post(bad, 'display')).token, 'jwt');
});
console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASSED (' + passed + ')'));
process.exit(failed ? 1 : 0);
