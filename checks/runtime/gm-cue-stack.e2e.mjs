// The cue stack (suite 4.1; app/gm/cue-stack.js, switch room.cues) on the real GM page, Worker and ambient document: a prep note's `## Cues` section through the real exporter, STANDBY in the
// bar, Space to GO, two GOs inside 500 ms firing once, Bypass, a by-hand cue, "Blade, go" typed in the Ask bar (a reveal), "Blade, go" with nothing in standby doing nothing, Esc to the
// safe scene inside a second (and an Esc the menu took not counting), Resume, and a stored false that changes nothing (N0: everything built is on). No model, $0; only the panel's tick/cards/ask are faked. Every name is invented;
// the one hidden NPC is a GM-ONLY- marker.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9040] node checks/runtime/gm-cue-stack.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildPrep } from '../../scripts/lib/prep-export.mjs';
import { basenames } from '../../scripts/lib/vault.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9040);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json');

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-cuestack-e2e-'));
// the prep part is built by the real exporter from an invented note in a temp vault: that is "the prep part carries them"
const vault = path.join(stateDir, 'vault'), G = 'Wiki/Games/Blades in the Dark/Campaigns/Group';
const w = (rel, text) => { const f = path.join(vault, ...rel.split('/')); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); };
w(G + '/Sessions/b68g-s09.md', ['---', 'session: 9', 'date: 01/02/2030', 'status: prep', 'gm_prep: true', '---', '', '# Session 9: prep', '',
  '## Run order', '', '| # | Beat | About |', '|---|---|---|', '| 1 | **Doors** | 5 min |', '',
  '## Cues', '', 'safe: testcard', '',
  '1. scene: duskwall', '2. show: title: The Pelican Rooms | A night out', '3. light: Lamps down, amber', '4. sound: Band strikes up', '5. reveal: GM-ONLY-Marcus Sills', '6. phase: plan', '7. practical: Three knocks at the door', '',
  '## Notes', '', 'Nothing else here.', ''].join('\n'));
const prep = buildPrep({ vault, repo: ROOT, exportedAt: new Date().toISOString(), basenames: basenames(vault) });
const PARTS = {
  console: con.parts.console, campaign: np.parts.campaign, npc: np.parts.npc,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
  prep
};

const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: 'ignore' });
function killServer() {
  if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} }
}
process.on('exit', () => { killServer(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j }; });
const SPEND = { tonight: 0.3, cap: 20, tier: 'all', tick: 0.02 };

try {
  const up = await until(async () => { try { return (await fetch(BASE + '/index.html')).status > 0; } catch (_) { return false; } }, 90000, 500);
  if (!up) throw new Error('the server did not start');
  check(!!prep && JSON.stringify(prep).includes('Pelican Rooms') && JSON.stringify(prep).includes('## Cues'), 'the exporter\'s prep part carries the Cues section');
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  await api('PUT', '/campaign', { v: 1, session: { number: 1, startedAt: new Date().toISOString(), endedAt: null }, crew: { name: 'The Lamplighters', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0,
    clocks: [], log: [] } });
  await api('PUT', '/npcs/npc_known', { name: 'Marta Quillfeather', role: 'invented', revealed: true, firstSeen: new Date().toISOString() });
  await api('PUT', '/npcs/npc_hidden', { name: 'GM-ONLY-Marcus Sills', role: 'invented', revealed: false });
  await api('PATCH', '/gm/stt', { want: 'on' });

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await c.route('**/api/gm/assist/tick', (route) => json(route, { cards: [], updates: [], flags: [], spend: SPEND, last: 9 }));
  await c.route('**/api/gm/assist/cards', (route) => route.request().method() === 'POST' ? json(route, { marked: 1 }) : json(route, { cards: [], updates: [], asks: [] }));
  await c.route('**/api/gm/assist/ask', (route) => json(route, { error: 'no model in this check' }, 500));
  const acts = [];
  const page = await c.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/gm\/assist\/act$/.test(r.url())) acts.push(JSON.parse(r.postData() || '{}')); });
  const reopen = async () => { await page.goto(BASE + '/#gm'); await page.reload(); await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 }); await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); };
  const ambient = async () => { const j = (await api('GET', '/gm/ambient')).json || {}; return j.doc || {}; };
  const ambientSeq = async () => ((await api('GET', '/gm/ambient')).json || {}).seq;
  const stateCues = async () => ((await api('GET', '/gm/state')).json.doc || {}).cues || {};
  const seqOf = async () => (await stateCues()).seq || [];
  const bar = () => page.$eval('#gm-cuebar', (e) => e.textContent).catch(() => '');
  const barState = () => page.$eval('#gm-cuebar', (e) => e.getAttribute('data-state')).catch(() => '');
  const waitSeq = (n, ms = 8000) => until(async () => (await seqOf()).length >= n, ms, 50);

  // ============ 1. nothing stored (N0: everything built is on): the bar is there, nothing has fired ============
  await reopen();
  check(!!(await until(() => page.$('#gm-cuebar .gm-cs-go'), 10000)), 'nothing stored: the bar draws with a GO button');
  check((await seqOf()).length === 0, 'and nothing has fired');

  // ============ 2. a stored true (what the Switchboard used to write) is the same: STANDBY ============
  await api('PATCH', '/gm/state', { features: { 'room.cues': true } });
  await reopen();
  check(!!(await until(() => page.$('#gm-cuebar .gm-cs-go'), 10000)), 'a stored true: the bar draws with a GO button');
  const b1 = await bar();
  check(/STANDBY/.test(b1) && /#1 SCENE/.test(b1) && /duskwall/.test(b1), 'STANDBY shows cue 1: ' + b1.replace(/\s+/g, ' ').slice(0, 100));
  check(/#2 SHOW/.test(b1) || /title: The Pelican Rooms/.test(b1), 'and what comes next');

  // ============ 3. Space fires; two GOs within 500 ms fire once ============
  await page.keyboard.press(' ');
  check(!!(await until(async () => { const a = await ambient(); return a.mode === 'pin' && a.scene === 'duskwall'; }, 6000, 50)), 'Space fires cue 1: the iPad pins the scene');
  check(!!(await waitSeq(1)), 'the position is saved in the state document: ' + JSON.stringify(await seqOf()));
  await sleep(700);
  await page.keyboard.press(' '); await page.keyboard.press(' ');                       // two GOs as close together as the keyboard can send them
  check(!!(await waitSeq(2)), 'two quick Spaces: cue 2 fires');
  await sleep(900);
  check((await seqOf()).length === 2, 'and only cue 2: ' + JSON.stringify(await seqOf()));
  const ov = (await ambient()).overlay || {};
  check(ov.kind === 'title' && ov.payload && ov.payload.text === 'The Pelican Rooms', 'cue 2 put the title beat on the iPad: ' + JSON.stringify(ov.payload));
  await sleep(700);
  check(/#3 LIGHT/.test(await bar()) && /by hand/.test(await bar()), 'the light cue is by hand');
  await page.keyboard.press(' ');
  check(!!(await waitSeq(3)), 'GO on a by-hand cue logs it and moves on');
  const a3 = await ambientSeq();
  await sleep(700);

  // ============ 4. Bypass ============
  check(/#4 SOUND/.test(await bar()), 'cue 4 is the sound');
  await page.click('#gm-cuebar [data-cs="bypass"]');
  check(!!(await waitSeq(4)) && (await seqOf())[3][1] === 'b', 'Bypass skips cue 4: ' + JSON.stringify((await seqOf())[3]));
  check(/#5 REVEAL/.test(await bar()), 'cue 5 is now in standby');
  await sleep(700);

  // ============ 5. "Blade, go" typed: fires the cue in standby and nothing else ============
  await page.keyboard.press('a');
  await page.waitForFunction(() => document.querySelector('#as-panel').getBoundingClientRect().left < innerWidth - 100, null, { timeout: 4000 });
  const type = async (text) => { await page.fill('#as-ask-q', text); await page.press('#as-ask-q', 'Enter'); };
  const hiddenBefore = (await api('GET', '/npcs')).json.docs.find((n) => n.doc.name === 'GM-ONLY-Marcus Sills');
  check(!!hiddenBefore && !hiddenBefore.doc.revealed, 'the NPC is hidden before the cue ' + JSON.stringify((await api('GET', '/npcs')).json).slice(0, 300));
  await type('Blade, go');
  check(!!(await waitSeq(5)), 'typed "Blade, go" fires cue 5');
  check(!!(await until(async () => ((await api('GET', '/npcs')).json.docs.find((n) => n.doc.name === 'GM-ONLY-Marcus Sills') || { doc: {} }).doc.revealed === true, 6000, 100)), 'and it revealed the NPC');
  check(acts.length === 1 && Array.isArray(acts[0].parsed) && acts[0].parsed.length === 1 && acts[0].parsed[0].verb === 'fire', 'the Worker was asked as a parsed cue: ' + JSON.stringify(acts[0] || {}).slice(0, 140));
  await sleep(2300);
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); await page.keyboard.press('a');
  await sleep(300);
  await page.keyboard.press(' ');                                                       // cue 6: the phase
  check(!!(await waitSeq(6)), 'Space fires cue 6 (the phase)');
  check(!!(await until(async () => JSON.stringify((await ambient()).layers || {}).includes('plan'), 6000, 100)), 'and the iPad band shows the phase');
  await sleep(700); await page.keyboard.press(' ');
  check(!!(await waitSeq(7)), 'cue 7 (a practical sound) by hand');
  check(/ALL DONE/.test(await bar()), 'the bar says ALL DONE');

  // ============ 6. "Blade, go" with nothing in standby does nothing ============
  const sBefore = await ambientSeq(), seqBefore = JSON.stringify(await seqOf());
  await page.keyboard.press('a');
  await page.waitForFunction(() => document.querySelector('#as-panel').getBoundingClientRect().left < innerWidth - 100, null, { timeout: 4000 });
  await type('Blade, go');
  await sleep(2500);
  check((await ambientSeq()) === sBefore && JSON.stringify(await seqOf()) === seqBefore, '"Blade, go" with nothing in standby changes nothing');
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); await page.keyboard.press('a');
  await sleep(300);

  // ============ 6b. the stamp's report card and the panic key share Esc: the card comes down first ============
  await api('PATCH', '/gm/state', { features: { 'spine.stamp': true, 'spine.sizer': true } });
  await reopen();
  await page.fill('#gm-c-threat', 'The guard turns');      /* N4: the Roll's line, position and effect, then Stamp it on the iPad */
  await page.click('#gm-pos [data-v="risky"]'); await page.click('#gm-eff [data-v="standard"]'); await page.click('#gm-stamp [data-gm="stamp"]');
  check(!!(await until(async () => ((await ambient()).overlay || {}).kind === 'report', 6000, 50)), 'a stamp report card is up');
  const sceneBefore = (await ambient()).scene;
  await page.waitForFunction(() => /On the iPad/.test((document.querySelector('#gm-stamp') || {}).textContent || ''), null, { timeout: 8000 });       // the page has seen its own card go up
  await page.keyboard.press('Escape');
  check(!!(await until(async () => !(await ambient()).overlay, 6000, 50)), 'Esc takes the report card down');
  await sleep(800);
  check((await barState()) !== 'panic' && (await ambient()).scene === sceneBefore, 'and it is not a panic: the scene is as it was');
  await api('PATCH', '/gm/state', { features: { 'spine.stamp': false, 'spine.sizer': false } });
  await reopen();

  // ============ 7. Esc: the safe scene inside a second, and Resume ============
  await page.click('#gm-cuebar [data-cs="reset"]');
  check(!!(await until(async () => (await seqOf()).length === 0, 6000, 50)), 'Start again clears the stack');
  await sleep(700); await page.keyboard.press(' ');
  await waitSeq(1); await sleep(700); await page.keyboard.press(' '); await waitSeq(2);
  await api('PUT', '/gm/display', { kind: 'dark', title: '', caption: '' });
  await api('PATCH', '/gm/ambient', { layer: { path: 'band.phase', value: 'plan' } });
  const pre = await ambient();
  check(pre.scene === 'duskwall' && pre.overlay && pre.overlay.kind === 'title' && JSON.stringify(pre.layers || {}).includes('plan'), 'before the panic: a scene, a beat, a layer, and lights out on the iPad');
  // an Esc that something else takes does not count: the menu
  await page.click('[data-gm="menu"]');
  const menuOpen = () => page.$eval('.gm-menu-list', (e) => !e.hasAttribute('hidden'));
  check(await menuOpen(), 'the menu is open');
  await page.keyboard.press('Escape'); await sleep(600);
  check(!(await menuOpen()) && (await barState()) !== 'panic' && ((await ambient()).scene === 'duskwall'), 'an Esc that closes the menu closes it and is not a panic');
  const t0 = Date.now();
  await page.keyboard.press('Escape');
  const settled = await until(async () => {
    const a = await ambient(), d = (await api('GET', '/gm/display')).json.display;
    return a.scene === 'testcard' && a.mode === 'pin' && !a.overlay && !JSON.stringify(a.layers || {}).includes('plan') && d.kind === 'blank';
  }, 3000, 20);
  const ms = Date.now() - t0;
  check(!!settled && ms < 1000, 'Esc: the safe scene, no beat, no layers, lights back, all within 1 second (' + ms + ' ms)');
  check((await barState()) === 'panic' && /WORK LIGHT UP/.test(await bar()), 'the bar is the red work-light banner');
  const seqNow = JSON.stringify(await seqOf());
  await sleep(700); await page.keyboard.press(' '); await sleep(700);
  check(JSON.stringify(await seqOf()) === seqNow && (await ambient()).scene === 'testcard', 'GO does nothing while the work light is up');
  if (process.env.CS_SHOT) await page.screenshot({ path: process.env.CS_SHOT });
  await page.evaluate(() => document.querySelector('#gm-cuebar [data-cs="resume"]').click());       // the menu list may still be drawn over the bar's right edge
  check(!!(await until(async () => (await ambient()).scene === 'duskwall', 6000, 100)) && (await barState()) !== 'panic', 'Resume puts the scene back');
  await sleep(700); await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); await page.keyboard.press(' ');
  check(!!(await waitSeq(3)), 'and GO works again');

  // ============ 8. a stored false (the old All off) changes nothing ============
  await api('PATCH', '/gm/state', { features: { 'room.cues': false } });
  await reopen(); await sleep(500);
  check(!!(await until(() => page.$('#gm-cuebar .gm-cs-go'), 10000)), 'a stored false changes nothing: the bar and its GO stay');
  check(errors.filter((e) => !/status of 500/.test(e)).length === 0, 'no console errors: ' + JSON.stringify(errors.slice(0, 3)));
  await c.close();
  await browser.close();
} catch (e) {
  console.log('FAIL ' + (e && e.stack || e)); failed++;
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
