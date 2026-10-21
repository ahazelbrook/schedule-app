// The GM pack's `assist` part (scripts/lib/assist-export.mjs): the cached prefix for "Claude at the table". Generic fixtures only:
// every name and sentence here is invented. No network, no key.
//   node checks/runtime/gm-assist-pack.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { buildAssist, readConfig, estimateTokens, contextBlock, DEFAULT_RULES, DEFAULT_CAST, TOKEN_WARN } from '../../scripts/lib/assist-export.mjs';
import { cleanPart } from '../../functions/_lib/gm.js';
import { makeHandler } from '../../functions/api/gm/assist.js';
import { onRequest as packHandler } from '../../functions/api/gm/pack.js';
import { cleanLines, addLines } from '../../functions/_lib/stt.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-pack-'));
const put = (rel, text) => { const f = path.join(tmp, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const PREP = 'Notes/Next session.md';
put(DEFAULT_RULES, '---\ntitle: Rules\n---\r\n# Rules\r\nRoll the dice.\r\n');
put(DEFAULT_CAST, '# Cast\n- Pip: a baker\n');
put(PREP, '# Prep\nA door that sticks.\n');
const warnings = () => [];
const build = (o = {}) => { const w = warnings(); const part = buildAssist({ vault: tmp, exportedAt: '2030-01-01T00:00:00.000Z', warn: (m) => w.push(m), ...o }); return { part, w: w.filter((m) => !/How to play|player table|never-reveal|Must land/.test(m)) }; };  // the v2 blocks have their own tests (gm-assist-export.test.mjs)

await test('the prefix is the rules, the cast and the prep as <context name> blocks, in that order, line endings normalised', () => {
  const { part, w } = build({ prep: PREP });
  assert.deepEqual(w, []);
  const names = [...part.prefix.matchAll(/<context name="([^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(names, [path.basename(DEFAULT_RULES), path.basename(DEFAULT_CAST), 'Next session.md']);
  assert.ok(part.prefix.includes('Roll the dice.\n\n</context>'));
  assert.ok(!part.prefix.includes('\r'));
  assert.equal(part.prefix, [contextBlock(DEFAULT_RULES, fs.readFileSync(path.join(tmp, ...DEFAULT_RULES.split('/')), 'utf8').replace(/\r\n/g, '\n')),
    contextBlock(DEFAULT_CAST, '# Cast\n- Pip: a baker\n'), contextBlock('Next session.md', '# Prep\nA door that sticks.\n')].join('\n\n'));
  assert.deepEqual(Object.keys(part).sort(), ['prefix', 'src']);
  assert.equal(part.src.exportedAt, '2030-01-01T00:00:00.000Z');
  assert.equal(part.src.tokens, estimateTokens(part.prefix));
});

await test('the part passes the server\'s own cleanPart, and the same notes give the same blockSha', () => {
  const a = build({ prep: PREP }).part, b = build({ prep: PREP }).part;
  const c = cleanPart({ part: 'assist', src: a.src, body: { prefix: a.prefix } });
  assert.equal(c.part, 'assist');
  assert.equal(a.src.blockSha, b.src.blockSha);
  put(PREP, '# Prep\nA door that sticks.\nAnd a window.\n');
  assert.notEqual(build({ prep: PREP }).part.src.blockSha, a.src.blockSha, 'a changed note changes the sha');
  put(PREP, '# Prep\nA door that sticks.\n');
});

await test('no prep named: a warning, and the prefix is the rules and cast alone; a named prep that is missing throws', () => {
  const { part, w } = build();
  assert.equal(w.length, 1); assert.match(w[0], /no prep note named/);
  assert.ok(!part.prefix.includes('A door that sticks'));
  assert.throws(() => build({ prep: 'Notes/Missing.md' }), /does not exist/);
});

await test('a missing rules or cast note is a warning and is left out; nothing readable gives null', () => {
  const { part, w } = build({ prep: PREP, rules: 'Nope/rules.md' });
  assert.match(w.join('|'), /rules note Nope\/rules\.md is not in the vault/);
  assert.ok(!part.prefix.includes('Roll the dice'));
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-empty-'));
  const w2 = warnings();
  assert.equal(buildAssist({ vault: empty, exportedAt: 'x', warn: (m) => w2.push(m) }), null);
  fs.rmSync(empty, { recursive: true });
});

await test('a path that leaves the vault is refused', () => {
  assert.throws(() => build({ prep: '../outside.md' }), /outside the vault/);
  assert.throws(() => build({ prep: 'a/../../outside.md' }), /outside the vault/);
});

await test('the config file supplies the prep path; the flag wins over it; a bad config is an error', () => {
  const cfg = path.join(tmp, 'assist-config.json');
  fs.writeFileSync(cfg, JSON.stringify({ prep: PREP }));
  assert.deepEqual(readConfig(cfg), { prep: PREP });
  assert.deepEqual(readConfig(path.join(tmp, 'absent.json')), {});
  const viaConfig = build({ config: readConfig(cfg) });
  assert.deepEqual(viaConfig.w, []);
  assert.ok(viaConfig.part.prefix.includes('A door that sticks'));
  put('Notes/Other.md', '# Other\nElsewhere.\n');
  const viaFlag = build({ prep: 'Notes/Other.md', config: readConfig(cfg) });
  assert.ok(viaFlag.part.prefix.includes('Elsewhere.') && !viaFlag.part.prefix.includes('A door that sticks'));
  fs.writeFileSync(cfg, '{nope');
  assert.throws(() => readConfig(cfg), /not valid JSON/);
  fs.writeFileSync(cfg, JSON.stringify({ prep: 4 }));
  assert.throws(() => readConfig(cfg), /vault-relative path/);
  fs.writeFileSync(cfg, '[]');
  assert.throws(() => readConfig(cfg), /must be a JSON object/);
});

await test('a prefix over ~90k tokens (characters / 3.5) warns; one under it does not', () => {
  assert.equal(estimateTokens('x'.repeat(350)), 100);
  const big = 'word '.repeat(Math.ceil(TOKEN_WARN * 3.5 / 5) + 10);
  put('Notes/Big.md', big);
  const over = build({ prep: 'Notes/Big.md' });
  assert.ok(over.w.some((m) => /about \d+k tokens/.test(m)), over.w.join('|'));
  assert.deepEqual(build({ prep: PREP }).w, []);
});

// ---------- the endpoint reads the part ----------
const GM = { role: 'gm', id: 'gm@example.test' };
const t0 = Date.parse('2030-02-01T09:30:00.000Z');

await test('assist.js reads the small part (file id) and names that file in every seat call, never the prefix text', async () => {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  const { part } = build({ prep: PREP });
  const c = cleanPart({ part: 'assist', src: part.src, body: { file_id: 'file_011TESTinvented0000', hash: 'h' } });
  exec.db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', ?, 0, ?)").run(c.src, c.body);
  const seen = [];
  const client = { messages: { async create(req) {
    seen.push(req);
    const none = Object.fromEntries(['roll_talk', 'harm', 'npc_change', 'new_name', 'clue_mention', 'xp_trigger', 'scene_change', 'stall'].map((f) => [f, false]));
    return { content: [{ type: 'text', text: JSON.stringify(none) }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn' };
  } } };
  const handler = makeHandler({ clientFor: () => client, now: () => t0 });
  await addLines(db, 'c', cleanLines({ lines: [{ id: 'l1', at: new Date(t0 - 10000).toISOString(), session: '1', conn: 'x', speaker: 0, text: 'we look at the door' }] }));
  const res = await handler({ request: new Request('https://blades.example.test/api/gm/assist/tick', { method: 'POST', body: '{}' }), env: { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'k' }, data: { me: GM } });
  const out = JSON.parse(await res.text());
  assert.equal(out.warnings, undefined);
  assert.equal(seen.length, 2, 'the Tripwire, and the Showrunner (it wakes on every tick, once in ten minutes)');
  for (const req of seen) {
    assert.deepEqual(req.messages[0].content[0].source, { type: 'file', file_id: 'file_011TESTinvented0000' });
    assert.deepEqual(req.messages[0].content[0].cache_control, { type: 'ephemeral', ttl: '1h' });
    assert.ok(!JSON.stringify(req).includes('Roll the dice'));
  }
});

await test('POST /api/gm/pack refuses an assist part that carries prefix text (400), and stores the small form', async () => {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  const post = (b) => packHandler({ request: new Request('https://blades.example.test/api/gm/pack', { method: 'POST', body: JSON.stringify(b) }), env: { DB: db, CAMPAIGN: 'c' }, data: { me: GM } });
  await assert.rejects(post({ part: 'assist', src: {}, body: { prefix: 'invented text' } }), (e) => e.status === 400 && /gm:sync/.test(e.message) && !e.message.includes('invented'));
  assert.equal(exec.db.prepare("SELECT COUNT(*) AS n FROM gm_pack WHERE part = 'assist'").get().n, 0);
  const ok = await post({ part: 'assist', src: {}, body: { file_id: 'file_011TESTinvented0000', hash: 'h' } });
  assert.equal(ok.status, 200);
  await post({ part: 'console', src: {}, body: { prefix: 'other parts may use any key' } });
  await assert.rejects(post({ part: 'assist', src: {}, body: { prefix: 'again' } }), (e) => e.status === 400);
  assert.equal(JSON.parse(exec.db.prepare("SELECT body FROM gm_pack WHERE part = 'assist'").get().body).file_id, 'file_011TESTinvented0000', 'the good part is untouched');
});

// ---------- GM only ----------
await test('a player or the table display cannot read the assist part: /api/gm/pack is 403 before the database is touched', async () => {
  const touched = [];
  const env = { get DB() { touched.push('DB'); return undefined; }, CAMPAIGN: 'c' };
  for (const me of [{ role: 'player', id: 'p@example.test' }, { role: 'display', id: 'd@example.test' }, undefined]) {
    for (const [method, url] of [['GET', '/api/gm/pack?part=assist'], ['GET', '/api/gm/pack'], ['DELETE', '/api/gm/pack?part=assist'], ['POST', '/api/gm/pack']]) {
      let err = null;
      try { await packHandler({ request: new Request('https://blades.example.test' + url, { method, body: method === 'POST' ? '{}' : undefined }), env, data: { me } }); } catch (e) { err = e; }
      assert.ok(err && err.status === 403, method + ' ' + url + ' as ' + (me && me.role));
    }
  }
  assert.deepEqual(touched, []);
});

await test('the source: only the GM-only handlers read gm_pack, and the export that players could reach leaves it out', () => {
  const readers = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.js$/.test(e.name) && /FROM\s+gm_pack|INTO\s+gm_pack/i.test(fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, ''))) readers.push(path.relative(ROOT, f).split(path.sep).join('/')); } };
  walk(path.join(ROOT, 'functions'));
  walk(path.join(ROOT, 'worker'));
  assert.deepEqual(readers.sort(), ['functions/_lib/gm.js', 'functions/api/gm/assist.js', 'functions/api/gm/pack.js']);
  for (const f of readers.filter((r) => r.startsWith('functions/api/'))) assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /requireGm\(data\)/, f + ' must call requireGm');
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\nALL PASSED (${passed})`);
process.exit(failed ? 1 : 0);
