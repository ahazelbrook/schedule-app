// The cast (CAST.md) against a local `wrangler dev`: the seeded NPCs, who sees what, who may write, validation, the export,
// the scene rule on the campaign, and the cheap change stamp the adapter polls.
//
//   node checks/api/npcs.mjs            (or: npm run check:api)
//
// Applies migrations/ to a throwaway local D1 first (so the seed rows are the ones a deploy would get), then starts the
// Worker on PORT (default 8841) with DEV_USER set. Prints PASS/FAIL per step, exits non-zero on any failure.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8841);
const GM = 'gm@example.test';
const PLAYER = 'player@example.test';
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');
const stateDir = mkdtempSync(join(tmpdir(), 'b68-npcs-check-'));
const persist = join(stateDir, 'state');
let server = null, passes = 0, failures = 0;

const K = require(join(ROOT, 'app', 'figures', 'figure-kit.js'));
const SEED = require(join(ROOT, 'app', 'figures', 'npcs.js'));

// The seven descriptions, word for word (the GM wrote them; the migration must not change them).
const DESCRIPTIONS = {
  npc_brackley: "Big walrus moustache, an army coat with the patches cut off, and a barge that smells of the city's rubbish. Writes everything down in duplicate.",
  npc_grunt: 'A man in a rubber apron, sleeves rolled to the elbow. His forearms are a map of old bites.',
  npc_karla: 'Cardigan, reading glasses pushed up into her hair, a biro behind one ear. Her desk is buried in folders, every stack squared off. She looks delighted to see you, Booker, and a little underslept.',
  npc_fellows: "An officer in a uniform pressed sharp enough to cut, every button done up, with a closed folder in front of him and a fountain pen beside it. He stands when you come in, and waits until you've sat.",
  npc_mira: "Runs the Undertow, a club in a drained swimming baths, the tiles sweating, the band playing down in the deep end. Mira's behind the bar at the shallow end, in a dress cut for business, keys at her belt. She saw you before you saw her.",
  npc_skinner: "Under the skull, on a crate, sits a slight man in a fisherman's jumper with a knife across his knees. It's black, and it doesn't shine.",
  npc_zam: "A kid in a man's jacket with the sleeves rolled four times, sitting on the bonnet of a car that isn't his. Odd shoes. A bunch of other people's keys clipped to his belt.",
};

function stop() {
  if (server) { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(-server.pid, 'SIGKILL'); } catch (_) {} server = null; }
  try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {}
}
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, { user, body, raw } = {}) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let payload;
  if (raw !== undefined) { payload = raw; h['Content-Type'] = 'application/json'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch('http://127.0.0.1:' + PORT + path, { method, headers: h, body: payload });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, json, text };
}
async function step(name, fn) {
  try { await fn(); passes++; console.log('PASS ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
function status(r, s) { expect(r.status === s, 'expected ' + s + ', got ' + r.status + ' ' + r.text.slice(0, 300)); }
const as = (user) => ({ user });

async function main() {
  // a server already on the port would answer for us (and without our code): refuse to start
  const busy = await fetch('http://127.0.0.1:' + PORT + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
  if (busy) throw new Error('port ' + PORT + ' is already in use: stop what is on it, or set PORT');
  // the migrations, applied the way a deploy applies them
  const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist], { cwd: ROOT, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, encoding: 'utf8', shell: process.platform === 'win32' });
  if (mig.status !== 0) throw new Error('migrations failed:\n' + mig.stdout + mig.stderr);
  server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
    '--persist-to', persist, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM], { cwd: ROOT, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, detached: true, stdio: 'ignore', shell: process.platform === 'win32' });
  for (let i = 0; i < 180; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/index.html', { signal: AbortSignal.timeout(2000) }); if (r.status > 0) break; } catch (_) {} await sleep(500); }

  await step('seed: the migration made the seven NPCs, hidden, with the descriptions word for word', async () => {
    const r = await call('GET', '/api/npcs', as(GM)); status(r, 200);
    const byId = Object.fromEntries(r.json.docs.map((d) => [d.id, d.doc]));
    expect(Object.keys(byId).sort().join() === Object.keys(DESCRIPTIONS).sort().join(), 'ids ' + Object.keys(byId));
    for (const [id, text] of Object.entries(DESCRIPTIONS)) {
      expect(byId[id].description === text, id + ' description differs: ' + byId[id].description);
      expect(byId[id].revealed === false && byId[id].firstSeen === null, id + ' starts hidden');
      expect(Array.isArray(byId[id].tags) && typeof byId[id].gmNotes === 'string' && typeof byId[id].alias === 'string', id + ' fields');
    }
    expect(byId.npc_mira.faction === 'The Undertow', 'Mira is of the Undertow: ' + byId.npc_mira.faction);
    expect(byId.npc_brackley.name === 'Brackley' && byId.npc_fellows.name === 'Major Fellows', 'names');
  });

  await step('seed: every spec draws with no warnings, and app/figures/npcs.js holds the same documents', async () => {
    const r = await call('GET', '/api/npcs', as(GM));
    for (const { id, doc } of r.json.docs) {
      const a = K.render(JSON.parse(JSON.stringify(doc.spec)), { height: 300 }), b = K.portrait(JSON.parse(JSON.stringify(doc.spec)));
      expect(!a.warnings.length && !b.warnings.length, id + ' warnings: ' + JSON.stringify(a.warnings.concat(b.warnings)));
      const s = SEED.find((x) => x.id === id);
      expect(s && JSON.stringify(s.doc) === JSON.stringify(doc), id + ' differs from app/figures/npcs.js');
    }
    expect(SEED.length === r.json.docs.length, 'seed file count');
  });

  await step('a player is sent no NPC while none is revealed (list and one), and the GM is sent all', async () => {
    let r = await call('GET', '/api/npcs', as(PLAYER)); status(r, 200);
    expect(r.json.docs.length === 0, 'player docs ' + r.text.slice(0, 200));
    expect(!/Grunt|Mira|Brackley|description/.test(r.text), 'hidden data in the player response');
    r = await call('GET', '/api/npcs/npc_grunt', as(PLAYER)); status(r, 404);
    r = await call('GET', '/api/npcs/npc_grunt', as(GM)); status(r, 200);
    expect(r.json.doc.name === 'Grunt', 'GM reads it');
    r = await call('GET', '/api/npcs/nope', as(GM)); status(r, 404);
  });

  await step('revealing one NPC: the player gets only it, without gmNotes; the GM keeps the notes', async () => {
    let r = await call('PATCH', '/api/npcs/npc_grunt', { user: GM, body: { revealed: true, firstSeen: '2026-11-21T09:00:00.000Z', gmNotes: 'SECRET: he bites back' } }); status(r, 200);
    expect(r.json.doc.revealed === true && r.json.doc.gmNotes.startsWith('SECRET'), 'GM copy ' + JSON.stringify(r.json.doc).slice(0, 200));
    r = await call('GET', '/api/npcs', as(PLAYER)); status(r, 200);
    expect(r.json.docs.length === 1 && r.json.docs[0].id === 'npc_grunt', 'only Grunt: ' + r.json.docs.map((d) => d.id));
    expect(!('gmNotes' in r.json.docs[0].doc) && !/SECRET/.test(r.text), 'no gmNotes in ' + r.text.slice(0, 300));
    expect(r.json.docs[0].doc.description === DESCRIPTIONS.npc_grunt && r.json.docs[0].doc.spec.id === 'grunt', 'description and spec are sent');
    r = await call('GET', '/api/npcs/npc_grunt', as(PLAYER)); status(r, 200);
    expect(!('gmNotes' in r.json.doc) && !/SECRET/.test(r.text), 'one: no gmNotes');
    r = await call('GET', '/api/npcs/npc_mira', as(PLAYER)); status(r, 404);
    r = await call('GET', '/api/npcs', as(GM));
    expect(r.json.docs.length === 7 && r.json.docs.find((d) => d.id === 'npc_grunt').doc.gmNotes.startsWith('SECRET'), 'GM still sees everything');
  });

  await step('hiding it again takes it away from the player at once', async () => {
    let r = await call('PATCH', '/api/npcs/npc_grunt', { user: GM, body: { revealed: false } }); status(r, 200);
    r = await call('GET', '/api/npcs', as(PLAYER)); expect(r.json.docs.length === 0, 'player docs ' + r.text);
    r = await call('GET', '/api/npcs/npc_grunt', as(PLAYER)); status(r, 404);
  });

  await step('every write is 403 for a player, and changes nothing', async () => {
    const docsOf = async () => JSON.stringify((await call('GET', '/api/npcs', as(GM))).json.docs);
    const before = await docsOf();
    const doc = { name: 'Intruder', description: 'x', spec: {}, revealed: true };
    for (const [m, p, body] of [['POST', '/api/npcs', doc], ['PUT', '/api/npcs/npc_zam', doc], ['PUT', '/api/npcs/npc_new', doc], ['PATCH', '/api/npcs/npc_zam', { revealed: true }], ['DELETE', '/api/npcs/npc_zam', undefined]]) {
      const r = await call(m, p, { user: PLAYER, body });
      expect(r.status === 403 && /GM/.test(r.json.error), m + ' ' + p + ' -> ' + r.status + ' ' + r.text.slice(0, 120));
    }
    expect((await docsOf()) === before, 'the cast changed');
    expect((await call('PUT', '/api/npcs/npc_zam', { user: PLAYER, raw: '[1' })).status === 403, 'a player is refused before the body is read');
  });

  let made;
  await step('GM CRUD: POST, GET, PUT, PATCH, DELETE, and a deleted id can be created again', async () => {
    const base = { name: 'Dot', alias: 'The Clerk', role: 'Clerk', faction: 'Records', description: 'Stamps things.', spec: { id: 'dot', heightIn: 64 }, revealed: false, firstSeen: null, tags: ['paper'], gmNotes: 'owes Karla' };
    let r = await call('POST', '/api/npcs', { user: GM, body: base }); status(r, 200);
    made = r.json.id; expect(/^npc_[A-Za-z0-9]+$/.test(made), 'id ' + made);
    expect(r.json.doc.name === 'Dot' && r.json.doc.createdAt && r.json.doc.updatedAt, 'doc ' + JSON.stringify(r.json.doc));
    const createdAt = r.json.doc.createdAt;
    r = await call('GET', '/api/npcs/' + made, as(GM)); status(r, 200); expect(r.json.doc.tags[0] === 'paper', 'read back');
    r = await call('PUT', '/api/npcs/' + made, { user: GM, body: { ...base, name: 'Dorothy', description: 'Stamps everything.' } }); status(r, 200);
    expect(r.json.doc.name === 'Dorothy' && r.json.doc.createdAt === createdAt && r.json.doc.updatedAt > createdAt, 'replace keeps createdAt: ' + JSON.stringify(r.json.doc));
    r = await call('PATCH', '/api/npcs/' + made, { user: GM, body: { role: 'Chief clerk', tags: ['paper', 'stamp'] } }); status(r, 200);
    expect(r.json.doc.role === 'Chief clerk' && r.json.doc.name === 'Dorothy' && r.json.doc.tags.length === 2, 'merge ' + JSON.stringify(r.json.doc));
    r = await call('PUT', '/api/npcs/npc_brand_new', { user: GM, body: { name: 'Fixed id' } }); status(r, 200);
    expect(r.json.doc.spec && r.json.doc.revealed === false && r.json.doc.tags.length === 0, 'missing fields are filled in');
    r = await call('DELETE', '/api/npcs/' + made, as(GM)); status(r, 200);
    status(await call('GET', '/api/npcs/' + made, as(GM)), 404);
    status(await call('DELETE', '/api/npcs/' + made, as(GM)), 404);
    status(await call('PATCH', '/api/npcs/' + made, { user: GM, body: { role: 'x' } }), 404);
    expect(!(await call('GET', '/api/npcs', as(GM))).json.docs.some((d) => d.id === made), 'listed after delete');
    status(await call('PUT', '/api/npcs/' + made, { user: GM, body: { name: 'Back again' } }), 200);
    status(await call('DELETE', '/api/npcs/' + made, as(GM)), 200);
    status(await call('DELETE', '/api/npcs/npc_brand_new', as(GM)), 200);
  });

  await step('validation: the shape and size of a doc', async () => {
    const bad = async (body, code, why) => { const r = await call('POST', '/api/npcs', { user: GM, body }); expect(r.status === code, why + ': expected ' + code + ', got ' + r.status + ' ' + r.text.slice(0, 160)); };
    await bad({}, 400, 'no name'); await bad({ name: '   ' }, 400, 'blank name'); await bad({ name: 5 }, 400, 'name type');
    await bad({ name: 'x'.repeat(81) }, 400, 'name too long'); await bad({ name: 'x', description: 'y'.repeat(2001) }, 400, 'description too long');
    await bad({ name: 'x', gmNotes: 'y'.repeat(8001) }, 400, 'gmNotes too long'); await bad({ name: 'x', nonsense: 1 }, 400, 'unknown field');
    await bad({ name: 'x', spec: [1] }, 400, 'spec array'); await bad({ name: 'x', spec: 'a' }, 400, 'spec string');
    await bad({ name: 'x', spec: { blob: 'z'.repeat(40 * 1024) } }, 413, 'spec too big');
    await bad({ name: 'x', revealed: 'yes' }, 400, 'revealed'); await bad({ name: 'x', tags: 'a' }, 400, 'tags type');
    await bad({ name: 'x', tags: [1] }, 400, 'tag type'); await bad({ name: 'x', tags: Array(21).fill('a') }, 400, 'too many tags');
    await bad({ name: 'x', firstSeen: 'yesterday' }, 400, 'firstSeen'); await bad({ name: 'x', firstSeen: 7 }, 400, 'firstSeen type');
    let r = await call('POST', '/api/npcs', { user: GM, raw: '[1]' }); status(r, 400);
    r = await call('POST', '/api/npcs', { user: GM, raw: 'nope' }); status(r, 400);
    r = await call('PUT', '/api/npcs/bad%20id', { user: GM, body: { name: 'x' } }); status(r, 400);
    r = await call('PUT', '/api/npcs/' + 'a'.repeat(81), { user: GM, body: { name: 'x' } }); status(r, 400);
    r = await call('PATCH', '/api/npcs/npc_zam', { user: GM, body: { revealed: 'no' } }); status(r, 400);
    r = await call('PATCH', '/api/npcs/npc_zam', { user: GM, body: { name: '' } }); status(r, 400);
    r = await call('POST', '/api/npcs', { user: GM, body: { name: 'x', blob: 'z'.repeat(300 * 1024) } }); status(r, 413);
    status(await call('GET', '/api/npcs/npc_zam', as(GM)), 200);
    expect((await call('GET', '/api/npcs', as(GM))).json.docs.length === 7, 'nothing was stored by a refused write');
    status(await call('DELETE', '/api/npcs', as(GM)), 405); status(await call('POST', '/api/npcs/npc_zam', { user: GM, body: {} }), 405);
  });

  await step('the adapter stamp: /api/characters carries npcsUpdatedAt, which moves with every NPC write and only then', async () => {
    let r = await call('GET', '/api/characters', as(PLAYER)); status(r, 200);
    const t0 = r.json.npcsUpdatedAt; expect(typeof t0 === 'string' && !Number.isNaN(Date.parse(t0)), 'stamp ' + t0);
    r = await call('GET', '/api/characters?since=' + encodeURIComponent(new Date().toISOString()), as(PLAYER));
    expect(r.json.npcsUpdatedAt === t0, 'unchanged without a write: ' + r.json.npcsUpdatedAt + ' vs ' + t0);
    expect((await call('GET', '/api/npcs', as(PLAYER))).json.npcsUpdatedAt === t0, '/api/npcs reports the same stamp');
    status(await call('PATCH', '/api/npcs/npc_zam', { user: GM, body: { tags: ['kid'] } }), 200);
    const t1 = (await call('GET', '/api/characters', as(PLAYER))).json.npcsUpdatedAt;
    expect(t1 > t0, 'moved: ' + t0 + ' -> ' + t1);
    status(await call('PATCH', '/api/npcs/npc_zam', { user: GM, body: { tags: [] } }), 200);
  });

  await step('the export (GM only) carries every NPC, hidden ones and gmNotes included', async () => {
    status(await call('GET', '/api/export', as(PLAYER)), 403);
    const r = await call('GET', '/api/export', as(GM)); status(r, 200);
    expect(Array.isArray(r.json.npcs) && r.json.npcs.length === 7, 'npcs ' + (r.json.npcs || []).length);
    const g = r.json.npcs.find((x) => x.id === 'npc_grunt');
    expect(g && g.doc.revealed === false && g.doc.gmNotes.startsWith('SECRET') && g.updatedAt, 'hidden NPC and notes: ' + JSON.stringify(g).slice(0, 160));
    expect(Array.isArray(r.json.characters) && r.json.members && r.json.campaign, 'the rest of the export is still there');
  });

  await step('campaign.scene: the GM sets and clears it, a player cannot change it, and everyone can read it', async () => {
    const at = new Date().toISOString();
    let r = await call('PATCH', '/api/campaign', { user: GM, body: { scene: { npcs: { npc_grunt: true }, at } } }); status(r, 200);
    expect(r.json.doc.scene.npcs.npc_grunt === true && r.json.doc.scene.at === at, 'scene ' + JSON.stringify(r.json.doc.scene));
    const stored = (await call('GET', '/api/campaign', as(GM))).json;
    for (const body of [
      { scene: { npcs: { npc_mira: true }, at } },
      { scene: { npcs: { npc_grunt: false } } },
      { scene: { npcs: { npc_grunt: null } } },
      { scene: { at: 'x' } },
      { scene: { npcs: {}, at: null } },
      { scene: { extra: 1 } },
      { scene: { npcs: { npc_mira: true } }, crew: { notes: 'a player may write this part' } },
      { scene: null },
    ]) {
      const r2 = await call('PATCH', '/api/campaign', { user: PLAYER, body });
      expect(r2.status === 403 || (body.scene === null && r2.status === 400), JSON.stringify(body) + ' -> ' + r2.status + ' ' + r2.text.slice(0, 120));
    }
    r = await call('PUT', '/api/campaign', { user: PLAYER, body: { ...stored.doc, scene: { npcs: { npc_mira: true }, at } } }); status(r, 403);
    const after = (await call('GET', '/api/campaign', as(PLAYER))).json;
    expect(after.updatedAt === stored.updatedAt && JSON.stringify(after.doc.scene) === JSON.stringify(stored.doc.scene), 'the scene or the document changed');
    expect(after.doc.scene.npcs.npc_grunt === true, 'a player reads the scene');
    r = await call('PATCH', '/api/campaign', { user: PLAYER, body: { crew: { notes: 'the table notes' } } }); status(r, 200);
    expect(r.json.doc.scene.npcs.npc_grunt === true, 'a player write elsewhere leaves the scene alone');
    r = await call('PATCH', '/api/campaign', { user: GM, body: { scene: { npcs: { npc_grunt: false, npc_mira: true }, at: new Date().toISOString() } } }); status(r, 200);
    expect(r.json.doc.scene.npcs.npc_grunt === false && r.json.doc.scene.npcs.npc_mira === true, 'GM changes who is on stage');
    r = await call('PATCH', '/api/campaign', { user: GM, body: { scene: { npcs: { npc_mira: null } } } }); status(r, 200);
    expect(!('npc_mira' in r.json.doc.scene.npcs), 'null removes an entry');
  });

  await step('campaign.scene: the shape is checked (400)', async () => {
    for (const scene of ['x', [], 5, { npcs: 'a' }, { npcs: [1] }, { npcs: { npc_a: 1 } }, { npcs: { 'bad id': true } }, { at: 5 }, { at: 'x'.repeat(41) }]) {
      const r = await call('PATCH', '/api/campaign', { user: GM, body: { scene } });
      expect(r.status === 400, JSON.stringify(scene) + ' -> ' + r.status + ' ' + r.text.slice(0, 120));
    }
    const many = {}; for (let i = 0; i < 101; i++) many['npc_' + i] = true;
    status(await call('PATCH', '/api/campaign', { user: GM, body: { scene: { npcs: many } } }), 400);
  });
}

try {
  await main();
} catch (e) {
  failures++;
  console.log('FAIL setup\n     ' + (e && e.message || e));
}
console.log('\n' + passes + ' passed, ' + failures + ' failed');
stop();
process.exit(failures ? 1 : 0);
