// The assist prep guard (design 2.5): the pick by date, the push refusal, and gm:preflight. Generic fixtures only: every name,
// place and sentence here is invented. No network, no key, no real vault.
//   node checks/runtime/gm-assist-prep.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { newReport } from '../../scripts/lib/report.mjs';
import { pushPack } from '../../scripts/lib/sync-pack.mjs';
import { buildAssist } from '../../scripts/lib/assist-export.mjs';
import { dateKey, resolvePrep, prepProblem } from '../../scripts/lib/assist-prep.mjs';
import { readState, STATE_NAME } from '../../scripts/lib/assist-file.mjs';
import { preflight, neverEntries, parseArgs } from '../../scripts/gm-preflight.mjs';
import { parseArgs as syncArgs } from '../../scripts/gm-sync.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
import { fileURLToPath } from 'node:url';
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const BASE = 'Wiki/Games/Blades in the Dark';
const mkvault = () => fs.mkdtempSync(path.join(os.tmpdir(), 'assist-prep-'));
const put = (v, rel, text) => { const f = path.join(v, ...rel.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const sess = (v, camp, name, fm, body = '# Night\n') => put(v, `${BASE}/Campaigns/${camp}/Sessions/${name}.md`, `---\n${fm}\n---\n${body}`);
const rel = (camp, name) => `${BASE}/Campaigns/${camp}/Sessions/${name}.md`;
const TODAY = dateKey('28/10/2026');

function mockClient() {
  const c = { uploads: [], deletes: [], n: 0, files: {
    async upload(p) { c.uploads.push(await p.file.text()); return { id: 'file_mock' + (++c.n) + 'AAAA' }; },
    async delete(id) { c.deletes.push(id); return {}; },
  } };
  return c;
}

// ---------- dates and the pick ----------
await test('dateKey reads DD/MM/YYYY (never as a US date) and ISO; rubbish is null', () => {
  assert.equal(dateKey('07/11/2026'), 20261107);
  assert.equal(dateKey('7/1/2027'), 20270107);
  assert.equal(dateKey('2026-11-07'), 20261107);
  assert.equal(dateKey('"07/11/2026"'), 20261107);
  assert.equal(dateKey('31/02/2026'), null);
  assert.equal(dateKey('soon'), null);
  assert.equal(dateKey(''), null);
});

await test('pick: the SOONEST gm_prep note dated on or after today (tonight), not a later one and not a past one', () => {
  const v = mkvault();
  sess(v, 'Group', 'night-a', 'date: 17/10/2026\ngm_prep: true');
  sess(v, 'Group', 'night-b', 'date: 28/10/2026\ngm_prep: true');
  sess(v, 'Group', 'night-c', 'date: 07/11/2026\ngm_prep: true');
  const r = resolvePrep({ vault: v, today: TODAY });
  assert.equal(r.rel, rel('Group', 'night-b'), 'the soonest on or after today, today included');
  assert.equal(r.how, 'date');
  assert.equal(r.ahead, 2);
  assert.equal(resolvePrep({ vault: v, today: dateKey('08/11/2026') }).rel, rel('Group', 'night-c'), 'all past: the newest');
  assert.equal(resolvePrep({ vault: v, today: dateKey('08/11/2026') }).how, 'past');
  assert.equal(resolvePrep({ vault: v, today: dateKey('29/10/2026') }).rel, rel('Group', 'night-c'));
});

await test('pick: today counts as on or after; notes without gm_prep, without a date or off the Sessions folders are ignored', () => {
  const v = mkvault();
  sess(v, 'Group', 'tonight', 'date: 28/10/2026\ngm_prep: true');
  sess(v, 'Group', 'later-unprepped', 'date: 14/11/2026\ngm_prep: false');
  sess(v, 'Group', 'later-no-flag', 'date: 14/11/2026');
  sess(v, 'Group', 'undated', 'gm_prep: true');
  sess(v, 'Group', 'bad-date', 'date: someday\ngm_prep: true');
  put(v, `${BASE}/Campaigns/Group/Elsewhere/stray.md`, '---\ndate: 20/11/2026\ngm_prep: true\n---\n');
  const r = resolvePrep({ vault: v, today: TODAY });
  assert.equal(r.rel, rel('Group', 'tonight'));
  assert.deepEqual(r.skipped.sort(), [rel('Group', 'bad-date'), rel('Group', 'undated')]);
});

await test('pick: looks in every campaign folder, and the first of equal dates is stable', () => {
  const v = mkvault();
  sess(v, 'Group', 'g1', 'date: 02/11/2026\ngm_prep: true');
  sess(v, 'Solo', 's1', 'date: 01/11/2026\ngm_prep: true');
  assert.equal(resolvePrep({ vault: v, today: TODAY }).rel, rel('Solo', 's1'));
});

await test('pick: --assist-prep or "prep" in the config wins and is not a pick; no candidates is null', () => {
  const v = mkvault();
  assert.equal(resolvePrep({ vault: v, today: TODAY }), null);
  sess(v, 'Group', 'g1', 'date: 01/11/2026\ngm_prep: true');
  assert.deepEqual(resolvePrep({ vault: v, assistPrep: 'X/named.md', today: TODAY }), { rel: 'X/named.md', how: 'cli', date: '', skipped: [] });
  assert.equal(resolvePrep({ vault: v, config: { prep: 'X/cfg.md' }, today: TODAY }).rel, 'X/cfg.md');
  assert.equal(resolvePrep({ vault: v, config: { prep: 'X/cfg.md' }, today: TODAY }).how, 'config');
  // a config prep that is a known prep note carries its date, so the push guard can check it
  const known = resolvePrep({ vault: v, config: { prep: rel('Group', 'g1') }, today: TODAY });
  assert.deepEqual([known.how, known.date], ['config', '01/11/2026']);
  assert.equal(resolvePrep({ vault: v, assistPrep: rel('Group', 'g1'), config: { prep: 'X/cfg.md' }, today: TODAY }).how, 'cli', 'the command line beats the config');
});

// ---------- the build records what the guard reads ----------
function fixtureVault({ must = true, ticked = false } = {}) {
  const v = mkvault();
  const mustBlock = must ? `## Must land\n- [${ticked ? 'x' : ' '}] The lamplighter owes a debt to the ferryman\n  - and nobody has said so aloud\n- [ ] The brass key is a fake\n\n` : '';
  sess(v, 'Group', 'night-x', 'date: 07/11/2026\ngm_prep: true', `# Night X\n${mustBlock}## Scenes\nA quiet pier.\n`);
  put(v, `${BASE}/NPCs/Marn.md`, '# Marn\n\n> [!example] How to play\n> - **Verb** *fuss*\n\n## Secrets\nMarn sold the ledger.\n');
  return v;
}
const buildPart = (v, prep) => buildAssist({ vault: v, exportedAt: '2030-01-01T00:00:00.000Z', warn: () => {}, prep });

await test('buildAssist records src.prep and the Must land counts', () => {
  const v = fixtureVault({ ticked: true });
  const p = buildPart(v, rel('Group', 'night-x'));
  assert.equal(p.src.prep, rel('Group', 'night-x'));
  assert.equal(p.src.mustLand, 1);
  assert.equal(p.src.mustLandLanded, 1);
  assert.equal(prepProblem(p.src), '');
});

await test('buildAssist with no prep named records no src.prep, and the guard names the fix', () => {
  const v = fixtureVault();
  const p = buildPart(v, undefined);
  assert.equal(p.src.prep, undefined);
  assert.match(prepProblem(p.src), /no prep note[\s\S]*--assist-prep[\s\S]*--allow-no-prep/);
});

await test('prepProblem: prep with no Must land section, or none unlanded, is a problem; an old pack without stats too', () => {
  const none = buildPart(fixtureVault({ must: false }), rel('Group', 'night-x'));
  assert.equal(none.src.mustLand, 0);
  assert.match(prepProblem(none.src), /no unlanded "Must land" entries[\s\S]*--allow-no-prep/);
  assert.match(prepProblem({ file: 'a + b', tokens: 5 }), /no prep note/);
  assert.match(prepProblem({ prep: 'a/b.md' }), /no unlanded/);
  assert.equal(prepProblem({ prep: 'a/b.md', mustLand: 3 }), '');
});

// ---------- the refusal, through the real pushPack with a fake Files client ----------
async function pushSetup(src, extraParts = {}) {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  const priv = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-prep-priv-'));
  const file = path.join(priv, 'b68-gm-pack.json');
  fs.writeFileSync(file, JSON.stringify({ format: 1, parts: { assist: { src: { exportedAt: 'x', tokens: 5, ...src }, prefix: 'INVENTED PREFIX', extra: { ref: 'e' } }, ...extraParts } }));
  const client = mockClient();
  const go = async (o = {}) => { const report = newReport(); await pushPack({ exec, db, campaign: 'c', report, ledger: { pack: {} }, privateDir: priv, now: Date.now(), yes: true, assistClient: client, ...o }); return report; };
  return { exec, priv, client, go, stateFile: path.join(priv, STATE_NAME) };
}
const inD1 = (exec, part) => exec.db.prepare("SELECT version FROM gm_pack WHERE campaign='c' AND part=?").get(part);

await test('push: an assist part with no prep is refused before any upload, with the reason; the other parts still go', async () => {
  const s = await pushSetup({}, { notes: { src: { x: 1 }, items: ['a'] } });
  const rep = await s.go();
  const r = rep.refused.find((x) => x.target === 'pack:assist');
  assert.ok(r, 'refused');
  assert.match(r.why, /no prep note/); assert.match(r.why, /--allow-no-prep/);
  assert.equal(s.client.uploads.length, 0, 'nothing uploaded to Anthropic');
  assert.equal(readState(s.stateFile), null, 'no upload state written');
  assert.equal(inD1(s.exec, 'assist'), undefined, 'not in D1');
  assert.ok(inD1(s.exec, 'notes'), 'the other part was pushed');
});

await test('push: prep with no Must land entries is refused too', async () => {
  const s = await pushSetup({ prep: 'a/b.md', mustLand: 0, mustLandLanded: 2 });
  const rep = await s.go();
  assert.match(rep.refused[0].why, /2 already ticked/);
  assert.equal(s.client.uploads.length, 0); assert.equal(inD1(s.exec, 'assist'), undefined);
});

await test('push: a plan (no --yes) and a dry run refuse as well, and upload nothing', async () => {
  const s = await pushSetup({});
  assert.equal((await s.go({ yes: false })).refused.length, 1);
  assert.equal((await s.go({ dryRun: true })).refused.length, 1);
  assert.equal(s.client.uploads.length, 0);
});

await test('push: --allow-no-prep lets a no-prep part through (it uploads and lands in D1)', async () => {
  const s = await pushSetup({});
  const rep = await s.go({ allowNoPrep: true });
  assert.equal(rep.refused.length, 0);
  assert.equal(s.client.uploads.length, 1);
  assert.ok(inD1(s.exec, 'assist'));
});

await test('push: a part with prep and Must land entries goes through without the flag', async () => {
  const s = await pushSetup({ prep: 'a/b.md', mustLand: 5, mustLandLanded: 0 });
  const rep = await s.go();
  assert.equal(rep.refused.length, 0);
  assert.equal(s.client.uploads.length, 1);
  assert.ok(inD1(s.exec, 'assist'));
});

await test('push: a prep named in the config and dated before today is refused; from the command line it is allowed; today or later is allowed; --allow-no-prep overrides', async () => {
  const today = dateKey('08/11/2026');
  const base = { prep: 'a/b.md', mustLand: 3, prepDate: dateKey('07/11/2026') };
  const s = await pushSetup({ ...base, prepBy: 'config' });
  const rep = await s.go({ today });
  assert.match(rep.refused[0].why, /named in assist-config\.json and is dated before today/);
  assert.match(rep.refused[0].why, /remove the key to pick by date/); assert.match(rep.refused[0].why, /--assist-prep/); assert.match(rep.refused[0].why, /--allow-no-prep/);
  assert.equal(s.client.uploads.length, 0); assert.equal(inD1(s.exec, 'assist'), undefined);
  const cli = await pushSetup({ ...base, prepBy: 'cli' });
  assert.equal((await cli.go({ today })).refused.length, 0, 'a prep passed on the command line is exempt');
  const onTheDay = await pushSetup({ ...base, prepBy: 'config' });
  assert.equal((await onTheDay.go({ today: dateKey('07/11/2026') })).refused.length, 0, 'dated today');
  const future = await pushSetup({ ...base, prepBy: 'config', prepDate: dateKey('09/11/2026') });
  assert.equal((await future.go({ today })).refused.length, 0, 'dated later');
  const over = await pushSetup({ ...base, prepBy: 'config' });
  assert.equal((await over.go({ today, allowNoPrep: true })).refused.length, 0);
  assert.equal(prepProblem({ ...base, prepBy: 'config' }, today).includes('assist-config.json'), true);
});

await test('push: a prep picked BY DATE that is dated before today is refused; the same note named explicitly is allowed; --allow-no-prep overrides', async () => {
  const today = dateKey('08/11/2026');
  const stale = { prep: 'a/b.md', mustLand: 3, prepBy: 'past', prepDate: dateKey('07/11/2026') };
  const s = await pushSetup(stale);
  const rep = await s.go({ today });
  assert.match(rep.refused[0].why, /picked by date and is dated before today/);
  assert.match(rep.refused[0].why, /--assist-prep/); assert.match(rep.refused[0].why, /--allow-no-prep/);
  assert.equal(s.client.uploads.length, 0); assert.equal(inD1(s.exec, 'assist'), undefined);
  // a pack built when it was still ahead goes stale on the day after, even though it says "date"
  const s1 = await pushSetup({ ...stale, prepBy: 'date' });
  assert.equal((await s1.go({ today })).refused.length, 1);
  assert.equal((await s1.go({ today: dateKey('07/11/2026') })).refused.length, 0, 'on the night itself it is fine');
  // named on purpose: never refused on date
  const s2 = await pushSetup({ ...stale, prepBy: 'named' });
  assert.equal((await s2.go({ today })).refused.length, 0);
  assert.ok(inD1(s2.exec, 'assist'));
  // the override
  const s3 = await pushSetup(stale);
  assert.equal((await s3.go({ today, allowNoPrep: true })).refused.length, 0);
  assert.ok(inD1(s3.exec, 'assist'));
});

await test('preflight shows the same verdict for a stale pick-by-date, and none for a named prep', async () => {
  const v = fixtureVault();
  const mk = async (prepBy) => { const { priv } = await packFor(v, { prep: rel('Group', 'night-x') }); const f = path.join(priv, 'b68-gm-pack.json'), pk = JSON.parse(fs.readFileSync(f, 'utf8')); pk.parts.assist.src.prepBy = prepBy; pk.parts.assist.src.prepDate = dateKey('07/11/2026'); fs.writeFileSync(f, JSON.stringify(pk)); return priv; };
  let priv = await mk('date');
  let r = await preflight({ vault: v, privateDir: priv, root: priv, today: '08/11/2026' });
  assert.match(r.lines.join('\n'), /PUSH GUARD:\s+a push would be REFUSED: the prep note night-x\.md was picked by date/); assert.equal(r.code, 1);
  r = await preflight({ vault: v, privateDir: priv, root: priv, today: '07/11/2026' });
  assert.equal(r.code, 0);
  priv = await mk('named');
  r = await preflight({ vault: v, privateDir: priv, root: priv, today: '08/11/2026' });
  assert.equal(r.code, 0);
});

await test('gm-sync: --allow-no-prep is parsed, off by default', () => {
  assert.equal(syncArgs(['push']).allowNoPrep, false);
  assert.equal(syncArgs(['push', '--allow-no-prep']).allowNoPrep, true);
});

// ---------- preflight ----------
async function packFor(v, { prep, handouts } = {}) {
  const part = buildPart(v, prep);
  const priv = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-prep-pf-'));
  const parts = { assist: { ...part, extra: { ref: 'e' } } };
  if (handouts) parts.handouts = { items: handouts };
  fs.writeFileSync(path.join(priv, 'b68-gm-pack.json'), JSON.stringify({ format: 1, parts }));
  return { priv, part };
}
const text = (r) => r.lines.join('\n');

await test('preflight: prep note, Must land, never-reveal entries, cued handouts, tokens and the missing state', async () => {
  const v = fixtureVault();
  sess(v, 'Group', 'night-old', 'date: 17/10/2026\ngm_prep: true');
  const { priv, part } = await packFor(v, { prep: rel('Group', 'night-x'), handouts: [{ id: 'h1', title: 'A map', file: 'a.png', when: 'when they reach the pier' }, { id: 'h2', title: 'Plain', file: 'b.png' }] });
  const r = await preflight({ vault: v, privateDir: priv, root: priv, today: '28/10/2026', now: Date.now() });
  const t = text(r);
  assert.match(t, /prep note:\s+Wiki\/Games\/Blades in the Dark\/Campaigns\/Group\/Sessions\/night-x\.md/);
  assert.match(t, /prep date:\s+07\/11\/2026\n/);
  assert.match(t, /must land:\s+2 unlanded, 0 ticked/);
  assert.match(t, /never-reveal: 1 NPC note\(s\), 2 unlanded clue\(s\)/);
  assert.match(t, /npc\s+Marn/);
  assert.match(t, /clue\s+The lamplighter owes a debt/);
  assert.match(t, /handouts:\s+2 in the pack, 1 with a cue/);
  assert.match(t, /h1 \| when they reach the pier/);
  assert.match(t, new RegExp('about ' + part.src.tokens + ' tokens'));
  assert.match(t, /no upload state[\s\S]*next push uploads/);
  assert.match(t, /push guard:\s+ok/);
  assert.doesNotMatch(t, /NOTE: the vault now picks/);
  assert.equal(r.code, 0);
});

await test('preflight: a pack built with no prep says NONE and that a push would be refused (exit 1); a stale pick is flagged', async () => {
  const v = fixtureVault();
  const { priv } = await packFor(v, {});
  const r = await preflight({ vault: v, privateDir: priv, root: priv, today: '28/10/2026' });
  const t = text(r);
  assert.match(t, /prep note:\s+NONE/);
  assert.match(t, /PUSH GUARD:\s+a push would be REFUSED/);
  assert.match(t, /NOTE: the vault now picks Wiki\/Games\/Blades in the Dark\/Campaigns\/Group\/Sessions\/night-x\.md \(date\)/);
  assert.equal(r.code, 1);
});

await test('preflight: a prep note dated before today is flagged', async () => {
  const v = fixtureVault();
  const { priv } = await packFor(v, { prep: rel('Group', 'night-x') });
  const r = await preflight({ vault: v, privateDir: priv, root: priv, today: '08/11/2026' });
  assert.match(text(r), /prep date:\s+07\/11\/2026\s+BEFORE TODAY/);
});

await test('preflight --remote: differs before a push, matches after one, differs again once the prefix changes; the only SQL is a SELECT', async () => {
  const v = fixtureVault();
  const { priv, part } = await packFor(v, { prep: rel('Group', 'night-x') });
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const seen = [];
  const spy = { batch: async (sql) => { seen.push(sql); return exec.batch(sql); } };
  const pf = (o = {}) => preflight({ vault: v, privateDir: priv, root: priv, remote: true, campaign: 'c', exec: spy, today: '28/10/2026', ...o });

  let t = text(await pf());
  assert.match(t, /live \(D1\):\s+0 part\(s\); assist not there/);
  assert.match(t, /next push uploads a new file/);

  const client = mockClient();
  const rep = newReport();
  await pushPack({ exec, db: asD1(exec), campaign: 'c', report: rep, ledger: { pack: {} }, privateDir: priv, now: Date.now(), yes: true, assistClient: client });
  assert.equal(rep.refused.length, 0); assert.equal(client.uploads.length, 1);
  seen.length = 0;
  t = text(await pf());
  assert.match(t, /live \(D1\):\s+1 part\(s\); assist v[0-9a-f]{12}/);
  assert.match(t, /MATCHES the live assist part/);
  assert.match(t, /reuses the file/);
  assert.match(t, /has no timestamp: its modified time is used/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], "SELECT part, version, CASE WHEN part = 'assist' THEN json_extract(body, '$.extra') END AS extra FROM gm_pack WHERE campaign = 'c'");

  // the prefix changes: the next push would upload, so the versions differ
  const f = path.join(priv, 'b68-gm-pack.json'), pk = JSON.parse(fs.readFileSync(f, 'utf8'));
  pk.parts.assist.prefix += '\nmore';
  fs.writeFileSync(f, JSON.stringify(pk));
  t = text(await pf());
  assert.match(t, /prefix has changed since that upload/);
  assert.match(t, /version will differ/);

});

await test('preflight: the extra seats are listed by chars and note, never by text; none is said plainly', async () => {
  const v = fixtureVault();
  put(v, 'Notes/Checklist.md', '---\ntitle: t\n---\nInvented rule one.\nInvented rule two.\n');
  const part = buildAssist({ vault: v, exportedAt: '2030-01-01T00:00:00.000Z', warn: () => {}, prep: rel('Group', 'night-x'), extra: { ref: 'Notes/Checklist.md' } });
  const priv = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-prep-pfx-'));
  fs.writeFileSync(path.join(priv, 'b68-gm-pack.json'), JSON.stringify({ format: 1, parts: { assist: part } }));
  const t = text(await preflight({ vault: v, privateDir: priv, root: priv, today: '28/10/2026' }));
  assert.match(t, /assist extra: ref \(\d+ chars, Notes\/Checklist\.md\)/);
  assert.ok(!t.includes('Invented rule'), 'the text is not printed');
  assert.match(t, new RegExp('ref \\(' + part.extra.ref.length + ' chars'));
  const { priv: priv2 } = await packFor(v, { prep: rel('Group', 'night-x') });
  const pk = JSON.parse(fs.readFileSync(path.join(priv2, 'b68-gm-pack.json'), 'utf8')); delete pk.parts.assist.extra;
  fs.writeFileSync(path.join(priv2, 'b68-gm-pack.json'), JSON.stringify(pk));
  assert.match(text(await preflight({ vault: v, privateDir: priv2, root: priv2, today: '28/10/2026' })), /assist extra: none/);
});

await test('preflight --remote: the live extra seats match, differ, or are missing against the pack\'s', async () => {
  const v = fixtureVault();
  // vault note -> buildAssist -> pack file -> pushPack -> D1: the whole path the ticket is about, with an invented note
  put(v, 'Notes/Checklist.md', '---\ntitle: t\n---\nInvented rule one.\nInvented rule two.\n');
  const built = buildAssist({ vault: v, exportedAt: '2030-01-01T00:00:00.000Z', warn: () => {}, prep: rel('Group', 'night-x'), extra: { ref: 'Notes/Checklist.md' } });
  const priv = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-prep-pfr-'));
  fs.writeFileSync(path.join(priv, 'b68-gm-pack.json'), JSON.stringify({ format: 1, parts: { assist: built } }));
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const pf = () => preflight({ vault: v, privateDir: priv, root: priv, remote: true, campaign: 'c', exec, today: '28/10/2026' }).then(text);
  assert.match(await pf(), /live extra ref: no live assist part/);
  const client = mockClient();
  const rep = newReport();
  await pushPack({ exec, db: asD1(exec), campaign: 'c', report: rep, ledger: { pack: {} }, privateDir: priv, now: Date.now(), yes: true, assistClient: client });
  assert.equal(rep.refused.length, 0, 'a part with src.extra is accepted by the push');
  const live = JSON.parse(exec.db.prepare("SELECT body FROM gm_pack WHERE campaign='c' AND part='assist'").get().body);
  assert.equal(live.extra.ref, 'Invented rule one.\nInvented rule two.', 'D1 holds the note body');
  assert.ok(!('prefix' in live), 'and the prefix went to the Files API, not to D1');
  assert.match(await pf(), /live extra ref: MATCHES the pack/);
  const f = path.join(priv, 'b68-gm-pack.json'), pk = JSON.parse(fs.readFileSync(f, 'utf8'));
  pk.parts.assist.extra.ref = 'changed';
  fs.writeFileSync(f, JSON.stringify(pk));
  assert.match(await pf(), /live extra ref: DIFFERS from the pack/);
  pk.parts.assist.extra = { checker: 'x' }; pk.parts.assist.src.extra = {}; fs.writeFileSync(f, JSON.stringify(pk));
  const t = await pf();
  assert.match(t, /live extra ref: in the live part but not in the pack/);
  assert.match(t, /live extra checker: NOT in the live part/);
  delete pk.parts.assist.extra; fs.writeFileSync(f, JSON.stringify(pk));
  assert.match(await pf(), /live extra ref: in the live part but not in the pack/);
});

await test('preflight: a config with an unknown extra seat is reported, not swallowed', async () => {
  const v = fixtureVault();
  const { priv } = await packFor(v, { prep: rel('Group', 'night-x') });
  fs.writeFileSync(path.join(priv, 'assist-config.json'), JSON.stringify({ extra: { nobody: 'Notes/x.md' } }));
  assert.match(text(await preflight({ vault: v, privateDir: priv, root: priv, today: '28/10/2026' })), /CONFIG: assist config: extra\.nobody is not a seat/);
});

await test('preflight --remote: a D1 failure is reported and exits 2, never thrown', async () => {
  const v = fixtureVault();
  const { priv } = await packFor(v, { prep: rel('Group', 'night-x') });
  const broken = { batch: async () => { const e = new Error('offline'); e.kind = 'offline'; throw e; } };
  const r = await preflight({ vault: v, privateDir: priv, root: priv, remote: true, exec: broken, today: '28/10/2026' });
  assert.match(text(r), /could not read: offline/);
  assert.equal(r.code, 2);
});

await test('preflight: no pack file, or a pack with no assist part, stops with a clear line', async () => {
  const priv = fs.mkdtempSync(path.join(os.tmpdir(), 'assist-prep-none-'));
  assert.equal((await preflight({ privateDir: priv, root: priv })).code, 2);
  fs.writeFileSync(path.join(priv, 'b68-gm-pack.json'), JSON.stringify({ format: 1, parts: {} }));
  const r = await preflight({ privateDir: priv, root: priv });
  assert.match(text(r), /no assist part/); assert.equal(r.code, 1);
});

await test('neverEntries and parseArgs', () => {
  assert.equal(neverEntries('nothing here').found, false);
  assert.deepEqual(parseArgs(['--remote', '--today', '07/11/2026']), { remote: true, today: '07/11/2026' });
  assert.throws(() => parseArgs(['--today', 'x']), /DD\/MM\/YYYY/);
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
});

await test('the guard source never reads or sets ANTHROPIC_API_KEY, and preflight writes nothing but SELECTs', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/gm-preflight.mjs'), 'utf8');
  assert.ok(!/ANTHROPIC_API_KEY/.test(src));
  assert.ok(!/writeFileSync|files\.upload|INSERT|UPDATE|DELETE/.test(src.replace(/\/\/.*$/gm, '')));
});

console.log('\n' + (failed ? failed + ' FAILED, ' + passed + ' passed' : 'ALL PASSED (' + passed + ')'));
process.exit(failed ? 1 : 0);
