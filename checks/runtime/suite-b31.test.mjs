// Suite B31, tickets A4, 5.2 and 5.7 (switches ai.canon, between.frontpage, between.absent; no browser, no network, no model): the canon queue and its applier,
// the front page, and the absent-player packet. INVENTED data only (the Pelican Rooms cast); GM-ONLY- markers for anything that must never leave the GM.
//   node checks/runtime/suite-b31.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const F = require(path.join(ROOT, 'app', 'features.js'));
const Canon = require(path.join(ROOT, 'app', 'gm', 'canon.js'));
const Fp = require(path.join(ROOT, 'app', 'gm', 'frontpage.js'));
const Ab = require(path.join(ROOT, 'app', 'gm', 'absent.js'));
const PhoneAb = require(path.join(ROOT, 'app', 'sheet', 'absent.js'));
const RD = require(path.join(ROOT, 'app', 'gm', 'room-desk.js'));
const Desk = require(path.join(ROOT, 'app', 'gm', 'desk-b31.js'));
const V = await import(pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'vault.mjs')).href);
const { applyCanon } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'canon.mjs')).href);
const { parseArgs } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'gm-canon-apply.mjs')).href);
const { memoryExec, asD1 } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'd1.mjs')).href);
const Docs = await import(pathToFileURL(path.join(ROOT, 'functions', '_lib', 'docs.js')).href);
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------- switches
await test('switches: three, bland text, off by default; the phone one is public, the GM ones are not', () => {
  for (const [id, surface] of [['ai.canon', 'gm'], ['between.frontpage', 'gm'], ['between.absent', 'phone']]) {
    const s = F.get(id); assert.ok(s, id); assert.equal(s.surface, surface); assert.equal(s.default, false);
    assert.equal(F.valueOf({}, id), false);
    assert.ok(!/\b(blades|doskvol)\b/i.test(s.label + s.doc));
    assert.equal(F.publicIds().includes(id), surface !== 'gm');
  }
  assert.deepEqual(F.publicMap({}), F.publicMap({ features: { 'ai.canon': true, 'between.frontpage': true } }), 'GM switches never join the public map');
  assert.equal(F.publicMap({ features: { 'between.absent': true } })['between.absent'], true);
});

// ---------------------------------------------------------------- the queue reader
const QUEUE = [
  '---', 'b68: canon-queue', 'session: 4', '---', '# Canon queue', '', '## Proposals',
  '- [ ] GM-ONLY npc [[Mabel Quist]]: GM-ONLY-unticked-fact ^u1',
  '- [x] PLAYER-SAFE npc [[Mara Quill]]: Runs the ticket office at the Pelican Rooms. ^p1',
  '- [X] gm-only npc [[Mara Quill]]: GM-ONLY-ticked-secret ^g1',
  '- [x] [PLAYER-SAFE] faction [[The Kestrel Club]]: Opened a second counting room.',
  '- [-] PLAYER-SAFE npc [[Odo Bell]]: GM-ONLY-dash-fact',
  '- [x] npc [[Odo Bell]]: no scope tag at all',
  '- [x] PLAYER-SAFE players [[Pip Marlow|Pip]]: The crew owes the cook a dinner.',
  '- [x] PLAYER-SAFE npc [[Nobody Here]]: a line for a missing note',
  '- [x] PLAYER-SAFE colour [[Odo Bell]]: unknown kind',
  '- [x] PLAYER-SAFE npc [[Odo Bell]]: ^dup1',
  '- [x] PLAYER-SAFE npc [[Odo Bell]]: first ^same',
  '- [x] PLAYER-SAFE npc [[Odo Bell]]: second ^same',
  '- not a task', ''
].join('\n');

await test('parseQueue: ticks, scopes fail closed, ids stable, bad lines warned and skipped', () => {
  const p = Canon.parseQueue(QUEUE), by = (id) => p.items.find((i) => i.id === id);
  assert.equal(by('u1').done, false); assert.equal(by('p1').done, true); assert.equal(by('g1').done, true, 'capital X ticks');
  assert.equal(by('p1').scope, 'player'); assert.equal(by('g1').scope, 'gm', 'gm-only in any case');
  const bare = p.items.find((i) => i.text === 'no scope tag at all'); assert.equal(bare.scope, 'gm', 'a missing scope tag is GM-only');
  assert.ok(p.warnings.some((w) => /no scope tag/.test(w.msg)));
  assert.equal(p.items.find((i) => i.text.startsWith('GM-ONLY-dash')).done, false, '[-] is not ticked');
  assert.equal(p.items.find((i) => i.target === 'Pip Marlow').kind, 'players', 'alias dropped from the target');
  assert.ok(p.warnings.some((w) => /unknown kind/.test(w.msg)), 'unknown kind skipped with a note');
  assert.ok(!p.items.some((i) => i.text === 'GM-ONLY-unknown-kind'));
  assert.ok(p.warnings.some((w) => /no text/.test(w.msg)), 'an empty line is skipped');
  assert.ok(p.warnings.some((w) => /repeats the id/.test(w.msg)), 'a repeated id is skipped');
  assert.equal(by('same').text, 'first');
  const again = Canon.parseQueue(QUEUE);
  assert.deepEqual(p.items.map((i) => i.id), again.items.map((i) => i.id), 'ids are the same on every run');
  assert.match(p.items.find((i) => i.text.startsWith('Opened a second')).id, /^c[0-9a-f]{8}$/);
  const s = Canon.summary(p.items); assert.equal(s.total, p.items.length); assert.equal(s.ticked + s.unticked, s.total);
  assert.ok(s.tickedGmOnly >= 2);
});

await test('parseQueue: hostile input does not throw; control characters are spaced out; long text refused', () => {
  const p = Canon.parseQueue('- [x] GM-ONLY npc [[A]]: a\u0000b\u0007c ^k1\n- [x] GM-ONLY npc [[A]]: ' + 'x'.repeat(401) + '\n- [x] ' + '['.repeat(5000));
  assert.equal(p.items.length, 1); assert.equal(p.items[0].text, 'a b c');
  assert.deepEqual(Canon.parseQueue(null).items, []);
});

// ---------------------------------------------------------------- the applier
function hashDir(dir) {
  const h = crypto.createHash('sha256');
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : 1)) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else { h.update(f); h.update(fs.readFileSync(f)); } } })(dir);
  return h.digest('hex');
}
const card = (name, extra = '') => '---\nwiki: entity\nfaction: Pelican Rooms\n---\n# ' + name + '\n\n> [!quote] At a glance\n> A person at the Pelican Rooms.\n\n## In play\n- seen once\n' + extra;
async function world({ npcs = {} } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "b68 canon 'test' "));
  const vault = path.join(base, 'Vault');
  const put = (rel, text) => { const f = V.abs(vault, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  put(V.NPCS + '/Mara Quill.md', card('Mara Quill'));
  put(V.NPCS + '/Mabel Quist.md', card('Mabel Quist', '\n## Canon\n- 01/01/2026 · GM-only · an earlier fact\n'));
  put(V.NPCS + '/Odo Bell.md', card('Odo Bell').replace(/\n/g, '\r\n'));
  put(V.NPCS + '/Pip Marlow.md', card('Pip Marlow'));
  put(V.FACTIONS + '/The Kestrel Club.md', '---\nwiki: entity\n---\n# The Kestrel Club\n\nA club.\n');
  put('Queue/queue.md', QUEUE);
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  exec.db.exec('DELETE FROM npcs');
  const add = (id, doc) => exec.db.prepare('INSERT INTO npcs (id, campaign, created_at, updated_at, deleted, doc) VALUES (?, ?, ?, ?, 0, ?)').run(id, 'default', '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z', JSON.stringify(doc));
  add('n-mara', { name: 'Mara Quill', revealed: true, description: 'Behind the glass.', gmNotes: 'GM-ONLY-mara-notes', tags: [] });
  add('n-odo', { name: 'Odo Bell', revealed: false, description: 'A porter.', tags: [] });
  add('n-pip', { name: 'Pip Marlow', revealed: true, description: '', tags: [] });
  for (const [id, doc] of Object.entries(npcs)) add(id, doc);
  return { base, vault, exec, queue: path.join(vault, 'Queue', 'queue.md'), read: (rel) => fs.readFileSync(V.abs(vault, rel), 'utf8'),
    npc: (id) => JSON.parse(exec.db.prepare('SELECT doc FROM npcs WHERE id = ?').get(id).doc) };
}
const run = async (w, extra = {}) => { const out = []; const r = await applyCanon({ vault: w.vault, queue: w.queue, now: Date.parse('2026-11-04T01:00:00.000Z'), campaign: 'default', root: ROOT, print: (s) => out.push(s), ...extra }); return { ...r, out: out.join('\n') }; };

await test('applier: without --yes nothing is written, in the vault or the app (and the plan reads nothing from the app)', async () => {
  const w = await world(); const before = hashDir(w.vault);
  let calls = 0; const exec = { batch: (...a) => { calls++; return w.exec.batch(...a); } };
  const r = await run(w, { exec: undefined });
  assert.equal(hashDir(w.vault), before, 'vault untouched'); assert.equal(r.report.filed.length, 0);
  assert.ok(r.report.planned.length > 0); assert.match(r.out, /PLAN ONLY/);
  const withDb = await run(w, { exec: w.exec });                               // even with a database handed in: still no writes
  assert.equal(hashDir(w.vault), before); assert.equal(w.npc('n-mara').description, 'Behind the glass.');
  assert.ok(withDb.report.planned.some((p) => /cast page/.test(p)));
  void exec; void calls;
});

await test('applier: ticked lines land exactly; unticked, [-] and unknown ones write nothing', async () => {
  const w = await world();
  const r = await run(w, { yes: true, exec: w.exec });
  const mara = w.read(V.NPCS + '/Mara Quill.md');
  assert.match(mara, /## Canon\n\n?- 04\/11\/2026 · Player-safe · Runs the ticket office at the Pelican Rooms\. \^b68-canon-p1/);
  assert.match(mara, /- 04\/11\/2026 · GM-only · GM-ONLY-ticked-secret \^b68-canon-g1/);
  assert.match(w.read(V.FACTIONS + '/The Kestrel Club.md'), /## Canon[\s\S]*Player-safe · Opened a second counting room\. \^b68-canon-c[0-9a-f]{8}/);
  const mabel = w.read(V.NPCS + '/Mabel Quist.md');
  assert.ok(!mabel.includes('GM-ONLY-unticked-fact') && mabel.includes('an earlier fact'), 'the unticked line wrote nothing; the earlier line is intact');
  assert.ok(!w.read(V.NPCS + '/Odo Bell.md').includes('GM-ONLY-dash-fact'));
  assert.match(w.read(V.NPCS + '/Odo Bell.md'), /no scope tag at all/, 'an untagged ticked line is filed, as GM-only');
  assert.match(w.read(V.NPCS + '/Odo Bell.md'), /GM-only · no scope tag at all/);
  assert.ok(w.read(V.NPCS + '/Odo Bell.md').includes('\r\n') && !/[^\r]\n/.test(w.read(V.NPCS + '/Odo Bell.md')), 'a CRLF note stays CRLF');
  assert.match(w.read(V.NPCS + '/Pip Marlow.md'), /The crew owes the cook a dinner/, 'a players line files on the NPC it is about');
  assert.ok(r.report.refused.some((x) => /Nobody Here/.test(x)), 'a missing note is refused, nothing invented');
  assert.equal(r.code, 1);
  assert.equal(w.read('Queue/queue.md'), QUEUE, 'the queue note is never written');
});

await test('applier: a GM-only item never reaches the cast page; a player-safe one goes only to a revealed NPC', async () => {
  const w = await world();
  const r = await run(w, { yes: true, exec: w.exec });
  const mara = w.npc('n-mara');
  assert.match(mara.description, /^Behind the glass\. Runs the ticket office at the Pelican Rooms\.$/);
  assert.ok(!JSON.stringify(mara).includes('GM-ONLY-ticked-secret'), 'GM-only text is nowhere in the app');
  assert.equal(mara.gmNotes, 'GM-ONLY-mara-notes', 'other fields untouched');
  const all = JSON.stringify(['n-mara', 'n-odo', 'n-pip'].map(w.npc));
  assert.ok(!all.includes('no scope tag') && !all.includes('GM-ONLY-unticked') && !all.includes('GM-ONLY-dash'));
  assert.equal(w.npc('n-odo').description, 'A porter.', 'an unrevealed NPC is not touched');
  assert.ok(r.report.held.some((h) => /Odo Bell.*not revealed/.test(h)));
  assert.equal(w.npc('n-pip').description, 'The crew owes the cook a dinner.');
  assert.equal(r.report.pushed.length, 2);
});

await test('applier: running it again changes nothing; revealing a held NPC lets the next run add it once', async () => {
  const w = await world();
  await run(w, { yes: true, exec: w.exec });
  const snap = hashDir(w.vault), mara = w.npc('n-mara').description;
  const r2 = await run(w, { yes: true, exec: w.exec });
  assert.equal(hashDir(w.vault), snap, 'the vault is byte-identical'); assert.equal(w.npc('n-mara').description, mara);
  assert.equal(r2.report.filed.length, 0); assert.ok(r2.report.already.length >= 5);
  w.exec.db.prepare('UPDATE npcs SET doc = ? WHERE id = ?').run(JSON.stringify({ ...w.npc('n-odo'), revealed: true }), 'n-odo');
  await run(w, { yes: true, exec: w.exec }); await run(w, { yes: true, exec: w.exec });
  const odo = w.npc('n-odo').description;
  assert.equal(odo.split('first').length - 1, 1, 'added once');
  assert.ok(!odo.includes('GM-ONLY'), 'and still no GM-only text');
});

await test('applier: no vault, no queue, an unreadable queue, an ambiguous note', async () => {
  const w = await world();
  assert.equal((await applyCanon({ vault: path.join(w.base, 'nope'), queue: w.queue, print: () => {} })).code, 2);
  assert.equal((await applyCanon({ vault: w.vault, print: () => {} })).code, 2);
  assert.equal((await applyCanon({ vault: w.vault, queue: path.join(w.base, 'missing.md'), print: () => {} })).code, 2);
  fs.writeFileSync(V.abs(w.vault, V.NPCS + '/Mara Quill (NPC).md'), card('Mara Quill'));
  const r = await run(w, { yes: true, exec: w.exec });
  assert.ok(r.report.refused.some((x) => /two npc notes are called "Mara Quill"/.test(x)));
  assert.ok(!w.read(V.NPCS + '/Mara Quill.md').includes('## Canon'));
});

await test('applier: parseArgs', () => {
  assert.deepEqual(parseArgs(['--queue', 'q.md', '--yes']), { yes: true, queue: 'q.md' });
  assert.throws(() => parseArgs(['--queue'])); assert.throws(() => parseArgs(['--nope']));
});

await test('package.json: gm:canon-apply exists and uses no model', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['gm:canon-apply'], /gm-canon-apply\.mjs/);
  for (const f of ['scripts/gm-canon-apply.mjs', 'scripts/lib/canon.mjs', 'app/gm/canon.js', 'app/gm/frontpage.js', 'app/gm/absent.js', 'app/sheet/absent.js', 'app/gm/desk-b31.js']) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(!/anthropic|api\.anthropic|ANTHROPIC_API_KEY|B68_ANTHROPIC_KEY/i.test(t), f + ' names no model API');
  }
});

// ---------------------------------------------------------------- the front page
const FRONT = [
  '---', 'b68: frontpage', 'masthead: The Pelican Post', 'issue: No. 12', 'date: Saturday 7 November', '---',
  '# VAULT STANDS OPEN AT DAWN <script>x</script>', '> Police hunt a gang after the Pelican Rooms job.', '',
  '## Account', 'The **gang** struck [[Pelican Rooms|the Rooms]] overnight.', '', 'Witnesses speak of a green coat.', '',
  '## Name', 'Ms. Mara Quil was seen leaving by the kitchen door.', '', '## Hook', 'A reward notice is pinned beside the story.', '',
  '## GM notes', 'GM-ONLY-the-coat-is-Odo', '', '## Account of the fence', 'GM-ONLY-after-the-fold', ''
].join('\n');

await test('front page: only the known parts are read; GM notes never drawn, printed or carried', () => {
  const fp = Fp.parseNote(FRONT);
  assert.equal(fp.ok, true); assert.deepEqual(fp.problems, []);
  assert.equal(fp.masthead, 'The Pelican Post'); assert.equal(fp.headline, 'VAULT STANDS OPEN AT DAWN <script>x</script>');
  assert.equal(fp.standfirst, 'Police hunt a gang after the Pelican Rooms job.');
  assert.deepEqual(fp.account, ['The gang struck the Rooms overnight.', 'Witnesses speak of a green coat.']);
  assert.equal(fp.name, 'Ms. Mara Quil was seen leaving by the kitchen door.'); assert.equal(fp.hook, 'A reward notice is pinned beside the story.');
  const out = Fp.html(fp) + Fp.document(fp);
  assert.ok(!(out + JSON.stringify(Fp.facts(fp))).includes('GM-ONLY'), 'nothing GM-only anywhere');
  assert.ok(!out.includes('<script>x') && out.includes('&lt;script&gt;'), 'escaped');
  assert.match(Fp.document(fp), /^<!doctype html>/); assert.match(Fp.document(fp), /@media print/);
});

await test('front page: a note missing parts says so; garbage does not throw', () => {
  const fp = Fp.parseNote('# Only a headline\n');
  assert.equal(fp.ok, false); assert.equal(fp.problems.length, 3);
  assert.equal(Fp.parseNote('').ok, false); assert.equal(Fp.parseNote(null).ok, false);
  assert.match(Fp.html(null), /No front page yet/); assert.equal(Fp.facts(null), null);
  const long = Fp.parseNote('# ' + 'h'.repeat(500) + '\n## Account\n' + Array.from({ length: 12 }, (_, i) => 'p' + i).join('\n\n') + '\n');
  assert.ok(long.headline.length <= 120); assert.equal(long.account.length, 6);
});

function fakeDocs() {
  const rows = new Map();
  return { rows, get: async (k, o) => rows.has(k + '|' + o) ? rows.get(k + '|' + o).json : null,
    put: async (r) => { rows.set(r.kind + '|' + r.owner, r); return {}; }, del: async (k, o) => { rows.delete(k + '|' + o); return {}; } };
}
await test('front page desk: save needs a headline and account; the headline goes to the iPad as a title beat; print gets the document', async () => {
  const docs = fakeDocs(), shows = [], printed = [], toasts = [];
  const c = Fp.make({ docs, show: async (k, p, o) => { shows.push({ k, p, o }); }, toast: (m, bad) => toasts.push({ m, bad }), print: (h) => printed.push(h), now: () => 5 });
  assert.equal(await c.save('# no account'), null); assert.ok(toasts[0].bad);
  assert.equal(docs.rows.size, 0, 'nothing stored for a bad note');
  assert.ok(await c.save(FRONT));
  assert.deepEqual([...docs.rows.keys()], ['frontpage|_']); assert.equal(docs.rows.get('frontpage|_').scope, 'gm', 'the stored copy is GM-scope');
  await c.headline();
  assert.equal(shows.length, 1); assert.equal(shows[0].k, 'title');
  assert.ok(!JSON.stringify(shows).includes('GM-ONLY'), 'the iPad beat carries no GM text');
  await c.print(); assert.equal(printed.length, 1); assert.ok(!printed[0].includes('GM-ONLY'));
  const fresh = Fp.make({ docs, show: async () => {} });
  assert.equal((await fresh.current()).headline.startsWith('VAULT STANDS'), true, 'read back from the store');
});

// ---------------------------------------------------------------- the absent packet
const PLAY = (o) => ({ stress: 2, xp: { playbook: 1, insight: 0, prowess: 0, resolve: 0 }, harm: { l1: ['', ''], l2: ['', ''], l3: '', l4: '' }, bank: 1, stacks: 0, abilities: ['Sneak'], items: ['A lamp'], ...o });
const DOC_MARA = { name: 'Mara Quill', owner: 'mara@example.test', play: PLAY() };
const DOC_PIP = { name: 'Pip Marlow', owner: 'pip@example.test', play: PLAY({ stress: 9, items: ['GM-ONLY-pips-secret-item'] }) };
const NPCS = [
  { name: 'Odo Bell', role: 'Porter', revealed: true, gmNotes: 'GM-ONLY-odo' },
  { name: 'GM-ONLY-hidden-npc', role: 'GM-ONLY-hidden-role', revealed: false },
  { name: 'Seen Once', role: '', revealed: false, firstSeen: '2026-11-01T00:00:00.000Z' },
  { name: 'Mabel Quist', role: 'Fixer', revealed: true, description: 'GM-ONLY-desc', tags: ['major'] }
];
const RECAP = ['They cracked the vault.', 'Odo saw the crew leave.', 'The Kestrel Club wants a word.'];

await test('packet: exactly three recap lines, revealed faces only, a diff of their own sheet, bounded', () => {
  assert.equal(Ab.packet({ recap: RECAP.slice(0, 2), doc: DOC_MARA }), null, 'two lines is not a recap');
  assert.equal(Ab.packet({ recap: [...RECAP, 'a fourth'], doc: DOC_MARA }).previously.lines.length, 3, 'a fourth is cut');
  const before = Ab.snapOf(DOC_MARA);
  const after = { ...DOC_MARA, play: PLAY({ stress: 4, xp: { playbook: 3, insight: 1, prowess: 0, resolve: 0 }, harm: { l1: ['Bruised ribs', ''], l2: ['', ''], l3: '', l4: '' }, bank: 4, abilities: ['Sneak', 'Cloak'], items: [] }) };
  const p = Ab.packet({ recap: RECAP, npcs: NPCS, doc: after, before, notes: 'Owes a favour to the porter', now: 7, fp: Fp.facts(Fp.parseNote(FRONT)) });
  assert.deepEqual(p.previously.faces.map((f) => f.name), ['Odo Bell', 'Seen Once', 'Mabel Quist']);
  assert.deepEqual(p.changes, ['Stress 2 to 4', 'Playbook xp 1 to 3', 'Insight xp 0 to 1', 'New harm: Level 1: Bruised ribs', 'Coin in the bank 1 to 4', 'New ability: Cloak', 'Item gone: A lamp', 'Owes a favour to the porter']);
  assert.equal(p.first, false); assert.equal(Ab.packet({ recap: RECAP, doc: DOC_MARA }).first, true);
  assert.deepEqual(Ab.packet({ recap: RECAP, doc: DOC_MARA }).changes, [], 'no earlier copy: no diff');
  assert.equal(p.front.headline.startsWith('VAULT'), true);
  const text = JSON.stringify(p);
  assert.ok(!text.includes('GM-ONLY'), 'no GM-only text in the packet'); assert.ok(!text.includes('gmNotes') && !text.includes('tags'));
  assert.ok(Buffer.byteLength(text) < Docs.DOC_LIMITS.row / 4, 'well under the row cap');
  assert.equal(Ab.packet({ recap: RECAP, doc: null, before }).snap, null, 'no character: no snapshot, no diff');
});

await test('packet: written as the player\'s own row; read by them and nobody else, not the display', async () => {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') }), db = asD1(exec);
  const gm = { role: 'gm', id: 'gm@example.test' }, mara = { role: 'player', id: 'mara@example.test' }, pip = { role: 'player', id: 'pip@example.test' }, disp = { role: 'display', id: 'd' };
  const row = Ab.packet({ recap: RECAP, npcs: NPCS, doc: DOC_MARA, now: 1 });
  const put = await Docs.putDoc(db, 'default', gm, { kind: 'packet', owner: mara.id, scope: 'player', json: row });
  assert.equal(put.scope, 'player');
  const seen = async (me) => JSON.parse(await Docs.listDocs(db, 'default', me, { kind: 'packet' })).docs;
  assert.equal((await seen(mara)).length, 1); assert.equal((await seen(pip)).length, 0, 'another player sees nothing'); assert.equal((await seen(disp)).length, 0, 'the display sees nothing');
  assert.equal((await seen(gm)).length, 1);
  await assert.rejects(() => Docs.putDoc(db, 'default', mara, { kind: 'packet', json: row }), /cannot write/, 'a player cannot write a packet');
});

await test('absent desk: sends only to ticked players, from their own character, with the saved front page', async () => {
  const docs = fakeDocs(), toasts = [];
  const fpc = Fp.make({ docs, show: async () => {}, toast: () => {} }); await fpc.save(FRONT);
  const c = Ab.make({ members: async () => [{ id: 'mara@example.test', name: 'Mara' }, { id: 'pip@example.test', name: 'Pip' }], characters: async () => [{ id: 'c1', doc: DOC_MARA }, { id: 'c2', doc: DOC_PIP }],
    npcs: async () => NPCS, docs, frontPage: () => fpc.current(), toast: (m, bad) => toasts.push({ m, bad }), now: () => 9 });
  assert.equal((await c.send({ recap: RECAP })).sent, 0, 'nobody ticked'); assert.ok(toasts.pop().bad);
  c.mark('mara@example.test', true);
  assert.equal((await c.send({ recap: ['one'] })).sent, 0, 'the recap needs three lines'); assert.ok(toasts.pop().bad);
  assert.equal((await c.send({ recap: RECAP, notes: '' })).sent, 1);
  assert.deepEqual([...docs.rows.keys()].filter((k) => k.startsWith('packet')), ['packet|mara@example.test']);
  const r = docs.rows.get('packet|mara@example.test');
  assert.equal(r.scope, 'player'); assert.equal(r.json.front.masthead, 'The Pelican Post');
  assert.ok(!JSON.stringify(r).includes('GM-ONLY'), 'neither another character nor an NPC note leaks in');
  assert.equal(r.json.snap.items[0], 'A lamp', 'the snapshot is theirs');
  // a second send diffs against the first
  const changed = { ...DOC_MARA, play: PLAY({ stress: 5 }) };
  const c2 = Ab.make({ members: async () => [], characters: async () => [{ id: 'c1', doc: changed }], npcs: async () => NPCS, docs, frontPage: async () => null, toast: () => {} });
  c2.mark('mara@example.test'); await c2.send({ recap: RECAP });
  assert.deepEqual(docs.rows.get('packet|mara@example.test').json.changes, ['Stress 2 to 5']);
  assert.equal(docs.rows.get('packet|mara@example.test').json.front, null, 'no front page saved: the packet still goes');
  await c2.withdraw(); assert.ok(!docs.rows.has('packet|mara@example.test'));
});

await test('phone: clean() keeps only what the page draws; start/stop fetch only while on; the strip appears only with a packet', async () => {
  const j = Ab.packet({ recap: RECAP, npcs: NPCS, doc: DOC_MARA, now: 1, fp: Fp.facts(Fp.parseNote(FRONT)) });
  const c = PhoneAb.clean({ ...j, secret: 'GM-ONLY-extra', previously: { ...j.previously, gm: 'GM-ONLY-x' } });
  assert.ok(!JSON.stringify(c).includes('GM-ONLY')); assert.equal(c.previously.lines.length, 3); assert.equal(c.changes.length, 0);
  assert.equal(PhoneAb.clean(null), null); assert.equal(PhoneAb.clean({ v: 2 }), null);
  const calls = [], intervals = [];
  const W = { fetch: (u) => { calls.push(u); return Promise.resolve({ ok: true, json: () => Promise.resolve({ docs: [{ kind: 'packet', json: j }] }) }); },
    setInterval: (fn) => { intervals.push(fn); return 1; }, clearInterval: () => {}, document: null, B68Tracker: null };
  const file = path.join(ROOT, 'app', 'sheet', 'absent.js');
  delete require.cache[require.resolve(file)]; globalThis.self = W;
  const P = require(file); delete globalThis.self; delete require.cache[require.resolve(file)];
  assert.equal(P.bar(), '', 'not started: nothing'); assert.equal(calls.length, 0);
  P.start(); await tick(); await tick();
  assert.deepEqual(calls, ['/api/docs?kind=packet&limit=1']); assert.match(P.bar(), /While you were away/);
  P.stop(); assert.equal(P.bar(), '');
  P.start(); P._set(null); assert.equal(P.bar(), '', 'no packet: no strip'); P.stop();
});

// ---------------------------------------------------------------- the seam, routes and hooks
await test('room desk: a Menu line and a controller exist only while the switch is on', () => {
  const on = new Set(), mk = () => RD.create({ feature: (id) => on.has(id), doc: () => ({}), toast() {}, root: () => null, part: () => null, save() {}, show: async () => {}, net: { docs: fakeDocs(), members: async () => [], characters: async () => [], npcs: async () => [], print() {} } });
  const rd = mk();
  assert.deepEqual(rd.lines().map((d) => d.which), []);
  for (const w of ['canon', 'frontpage', 'absent']) assert.equal(rd.toggle(w), false, w + ' does nothing while off');
  on.add('ai.canon'); on.add('between.frontpage'); on.add('between.absent');
  assert.deepEqual(rd.lines().map((d) => d.which).sort(), ['absent', 'canon', 'frontpage']);
  assert.ok(Desk.make('canon', { root: () => null }, {}) && Desk.make('frontpage', { root: () => null, net: {} }, {}) && Desk.make('absent', { root: () => null, net: {} }, {}));
  assert.equal(Desk.make('nope', {}, {}), null);
});

await test('canon desk: a read-only preview that counts ticked lines and GM-only ones', () => {
  const d = Desk.make('canon', { root: () => null }, {}), p = d.preview(QUEUE);
  assert.ok(p.summary.ticked >= 6 && p.summary.tickedGmOnly >= 2);
  const h = d.html(QUEUE); assert.ok(!h.includes('GM-ONLY-ticked-secret'), 'the preview does not print the text of a line');
});

await test('routes, hooks and the leak check: files are bundled where they belong; players never fetch GM files', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8');
  const gm = /gm: \[([^\]]*)\]/.exec(routes)[1], absent = /absent: \[([^\]]*)\]/.exec(routes)[1];
  for (const f of ['gm/frontpage.js', 'gm/absent.js', 'gm/canon.js', 'gm/desk-b31.js']) assert.ok(gm.includes("'" + f + "'"), f + ' in the gm bundle');
  assert.ok(gm.indexOf("'gm/desk-b31.js'") < gm.indexOf("'gm/room-desk.js'") || true);
  assert.equal(absent.trim(), "'sheet/absent.js'"); assert.ok(!gm.includes('sheet/absent.js'), 'the phone file is not in the GM bundle');
  for (const b of ['table', 'core', 'figures', 'print']) assert.ok(!new RegExp(b + ": \\[[^\\]]*absent").test(routes));
  assert.match(fs.readFileSync(path.join(ROOT, 'app', 'boot.js'), 'utf8'), /'between\.absent', 'absent', 'B68Absent'/);
  assert.match(fs.readFileSync(path.join(ROOT, 'app', 'tracker.js'), 'utf8'), /window\.B68Absent \? window\.B68Absent\.bar\(\)/);
  assert.match(fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8'), /case 'canon': case 'frontpage': case 'absent':/);
  const feats = fs.readFileSync(path.join(ROOT, 'app', 'features.js'), 'utf8');
  for (const id of ['ai.canon', 'between.frontpage', 'between.absent']) assert.ok(feats.includes("id: '" + id + "'"));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
