// The cast end to end against a real local Worker (wrangler dev, DEV_USER) on PORT (default 8842), with the migrations applied so the
// seven seeded NPCs are there: the GM opens the cast and sees all seven, edits one, makes one and deletes it, puts Grunt on stage; a
// player in another browser context sees the Grunt banner and Grunt in the cast, and nobody else (and no gmNotes anywhere in the page);
// hiding the banner, a changed stage bringing it back, hiding an NPC that is on stage, "Clear stage"; and the phone layout at 360 px.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node checks/runtime/cast.e2e.mjs      (or: npm run check:cast)
// CAST_SHOTS=<dir> also saves a screenshot of each view there.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8842);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', PLAYER = 'p1@example.test';
const SHOTS = process.env.CAST_SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- our own server, on a database the migrations were applied to ---------- */
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-cast-check-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use: stop what is on it, or set PORT'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: process.platform === 'win32', });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM], { cwd: ROOT, env, detached: true, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
function killServer(sig = 'SIGTERM') { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(-server.pid, sig); } catch (_) {} }
process.on('exit', () => { killServer('SIGKILL'); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 240000);
const api = (method, p, user, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

/* anything wider than the screen (fixed elements and scrollers aside) */
function layout() {
  const de = document.documentElement, vw = window.innerWidth, wide = [];
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.right <= vw + 1) continue;
    let clipped = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (getComputedStyle(p).overflowX !== 'visible') { clipped = true; break; } }
    if (!clipped && getComputedStyle(el).position !== 'fixed') wide.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/)[0] : '')) + ' ' + Math.round(r.right));
  }
  const b = document.getElementById('stageBanner'), br = b && !b.hidden ? b.getBoundingClientRect() : null;
  return { vw, scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, wide: wide.slice(0, 8), banner: br ? { left: Math.round(br.left), right: Math.round(br.right), bottom: Math.round(br.bottom), height: Math.round(br.height) } : null };
}

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 90000, 300);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(user, hash, { width = 1280, height = 900, mobile = false, scheme } = {}) {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width, height }, serviceWorkers: 'block', isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, colorScheme: scheme });
    await ctx.addInitScript(() => { window.__B68_POLL_MS = 700; });   // the page polls every 4 s; the checks do not wait for that
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(user + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push(user + ' pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/' + hash);
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 20000 });
    return { ctx, page };
  }
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); };
  const names = (page) => page.$$eval('#cast-page .cp-card .cp-name a', (as) => as.map((a) => a.textContent.trim()));
  const waitCards = (page, n, ms = 20000) => page.waitForFunction((n) => document.querySelectorAll('#cast-page .cp-card').length === n, n, { timeout: ms }).then(() => true, () => false);
  const waitFigs = (page) => page.waitForFunction(() => { const h = [...document.querySelectorAll('#cast-page [data-fig], #stageBanner [data-fig]')]; return h.length > 0 && h.every((x) => x.querySelector('svg')); }, null, { timeout: 20000 }).then(() => true, () => false);

  /* ---- a player, before anything is revealed ---- */
  const P = await open(PLAYER, '#cast');
  check(await P.page.waitForSelector('#cast-page .cp-empty', { timeout: 20000 }).then(() => true, () => false), 'player: with nothing revealed the cast says nobody has been introduced');
  check((await names(P.page)).length === 0 && !(await P.page.$('#stageBanner:not([hidden])')), 'player: no cards, no banner');

  /* ---- the GM opens the cast and sees all seven ---- */
  const G = await open(GM, '#cast');
  check(await waitCards(G.page, 7), 'GM: the cast shows the seven seeded NPCs');
  const gmNames = await names(G.page);
  check(['Brackley', 'Grunt', 'Karla', 'Major Fellows', 'Mira', 'Skinner', 'Zam'].every((n) => gmNames.includes(n)), 'GM: names ' + gmNames.join(', '));
  check(await waitFigs(G.page), 'GM: every card has its portrait');
  const badges = await G.page.$$eval('#cast-page .cp-badge', (bs) => bs.map((b) => b.textContent));
  check(badges.length === 7 && badges.every((b) => b === 'Hidden'), 'GM: each card says Hidden: ' + badges.join(','));
  const mira = await G.page.textContent('#cast-page .cp-card[data-id="npc_mira"]');
  check(/The Undertow/.test(mira) && /deep end/.test(mira), 'GM: Mira shows her faction and description');
  check((await G.page.$$('#cast-page .cp-card [data-cp="stage"]')).length === 7 && (await G.page.$$('#cast-page a[href$="/edit"]')).length === 7, 'GM: every card has On stage and Edit');
  await shot(G.page, '01-gm-cast');
  // the entry points: Home and the table page
  await G.page.click('#homeBtn');
  await G.page.waitForSelector('#homeMain [data-hm="cast"]', { timeout: 15000 });
  await G.page.click('#homeMain [data-hm="cast"]');
  check(await waitCards(G.page, 7) && /#cast$/.test(G.page.url()), 'Home: "The cast" opens the cast (#cast)');
  await G.page.click('#tableBtn');
  await G.page.waitForSelector('#table-page [data-act="cast"]', { timeout: 15000 });
  await G.page.click('#table-page [data-act="cast"]');
  check(await waitCards(G.page, 7) && /#cast$/.test(G.page.url()), 'the table page: "The cast" opens the cast');
  await G.page.goBack(); await G.page.waitForSelector('#table-page [data-act="cast"]');
  check(await G.page.$eval('#cast-page', (c) => c.hidden), 'Back leaves the cast for the table');
  await G.page.goForward(); await waitCards(G.page, 7);

  /* ---- the GM edits one ---- */
  await G.page.click('#cast-page a[href="#cast/npc_zam/edit"]');
  await G.page.waitForSelector('#cp-form [data-f="name"]');
  check((await G.page.inputValue('#cp-form [data-f="name"]')) === 'Zam' && /rolled four times/.test(await G.page.inputValue('#cp-form [data-f="description"]')), 'editor: opens on Zam with the description');
  check(await G.page.waitForSelector('#cp-prev-mug svg', { timeout: 10000 }).then(() => true, () => false) && !!(await G.page.$('#cp-prev-fig svg')), 'editor: a live portrait and figure preview');
  const opts = await G.page.$$eval('#cp-form select[data-p="face.expression"] option', (os) => os.map((o) => o.value));
  const kitOpts = await G.page.evaluate(() => { const e = window.B68Figure.options().expression; return Array.isArray(e) ? e : Object.keys(e); });
  check(kitOpts.every((o) => opts.includes(o)) && opts.length === kitOpts.length + 1, 'editor: the dropdowns come from K.options() (' + kitOpts.length + ' expressions)');
  const mugBefore = await G.page.innerHTML('#cp-prev-mug');
  await G.page.fill('#cp-form [data-f="role"]', 'Street kid');
  await G.page.fill('#cp-form [data-f="alias"]', 'Zammo');
  await G.page.fill('#cp-form [data-f="gmNotes"]', 'SECRET: owes the Undertow');
  await G.page.fill('#cp-form [data-f="tags"]', 'keys, cars');
  await G.page.selectOption('#cp-form select[data-p="face.expression"]', 'scowl');
  await G.page.selectOption('#cp-form select[data-p="hair.style"]', 'bowl-bob');
  await G.page.selectOption('#cp-form select[data-t="face.eyewear"]', 'round-wire');
  await G.page.check('#cp-form [data-prop="cigarette"]');
  check(await until(async () => (await G.page.innerHTML('#cp-prev-mug')) !== mugBefore, 5000), 'editor: the preview redraws when a dropdown changes');
  const specText = await G.page.inputValue('#cp-spec');
  check(/"scowl"/.test(specText) && /bowl-bob/.test(specText) && /round-wire/.test(specText) && /cigarette/.test(specText), 'editor: the spec JSON follows the dropdowns');
  await G.page.evaluate(() => window.scrollTo(0, 0)); await shot(G.page, '02-gm-editor');
  // paste a spec
  const pasted = JSON.parse(specText); pasted.heightIn = 60; pasted.age = 15;
  await G.page.fill('#cp-spec', JSON.stringify(pasted));
  await G.page.click('[data-cp="usespec"]');
  check((await G.page.inputValue('#cp-form input[data-p="heightIn"]')) === '60', 'editor: a pasted spec is taken (height 60)');
  // start from an archetype
  await G.page.selectOption('#cp-arch', 'urchin');
  check(/"heightIn": 56/.test(await G.page.inputValue('#cp-spec')), 'editor: Start from an archetype loads it');
  await G.page.fill('#cp-spec', JSON.stringify(pasted)); await G.page.click('[data-cp="usespec"]');
  await G.page.click('[data-cp="save"]');
  await G.page.waitForSelector('#cast-page .cp-detail', { timeout: 15000 });
  check(/Street kid/.test(await G.page.textContent('#cast-page .cp-kick')) && /Zammo/.test(await G.page.textContent('#cast-page .cp-alias')), 'GM: the detail view shows the edit');
  check(await waitFigs(G.page), 'GM: the detail view draws the large figure');
  let r = await api('GET', '/npcs/npc_zam', GM);
  check(r.json.doc.role === 'Street kid' && r.json.doc.alias === 'Zammo' && r.json.doc.spec.face.expression === 'scowl' && r.json.doc.spec.heightIn === 60 && r.json.doc.tags.join() === 'keys,cars' && r.json.doc.gmNotes.startsWith('SECRET'), 'server: the edit is stored: ' + JSON.stringify(r.json.doc).slice(0, 160));
  check(/GM notes/.test(await G.page.textContent('#cast-page .cp-gmnotes')), 'GM: the detail view shows the GM notes');
  // a new NPC from an archetype, then delete it (with the confirm)
  await G.page.goto(BASE + '/#cast/new'); await G.page.waitForSelector('#cp-form [data-f="name"]');
  await G.page.fill('#cp-form [data-f="name"]', 'Temp Tilly'); await G.page.selectOption('#cp-arch', 'fence');
  await G.page.click('[data-cp="save"]');
  await G.page.waitForSelector('#cast-page .cp-detail', { timeout: 15000 });
  r = await api('GET', '/npcs', GM);
  const tilly = r.json.docs.find((d) => d.doc.name === 'Temp Tilly');
  check(!!tilly && tilly.doc.revealed === false && tilly.doc.spec.outfit && tilly.doc.spec.name === 'Temp Tilly', 'GM: a new NPC from the "fence" archetype is stored hidden');
  await G.page.click('#cast-page a[href$="/edit"]'); await G.page.waitForSelector('[data-cp="delete"]');
  await G.page.click('[data-cp="delete"]');
  await G.page.waitForSelector('#cast-page .cp-grid', { timeout: 15000 });
  check(await waitCards(G.page, 7) && (await api('GET', '/npcs/' + tilly.id, GM)).status === 404, 'GM: Delete (after the confirm) removes the NPC');

  /* ---- the GM puts Grunt on stage ---- */
  await api('PATCH', '/npcs/npc_grunt', GM, { gmNotes: 'SECRET: he bites back' });
  await G.page.waitForSelector('#cast-page .cp-card[data-id="npc_grunt"] [data-cp="stage"]');
  await G.page.click('#cast-page .cp-card[data-id="npc_grunt"] [data-cp="stage"]');
  check(await until(async () => { const c = (await api('GET', '/campaign', GM)).json.doc; return c.scene && c.scene.npcs && c.scene.npcs.npc_grunt === true; }, 10000), 'server: campaign.scene.npcs.npc_grunt is true');
  r = await api('GET', '/npcs/npc_grunt', GM);
  check(r.json.doc.revealed === true && /^\d{4}-/.test(r.json.doc.firstSeen || ''), 'server: putting Grunt on stage revealed him and set firstSeen (' + r.json.doc.firstSeen + ')');
  check(await G.page.waitForSelector('#stageBanner:not([hidden]) .cp-st-name', { timeout: 10000 }).then(() => true, () => false) && /Grunt/.test(await G.page.textContent('#stageBanner')), 'GM: the banner shows Grunt');
  check(!!(await G.page.$('#stageBanner [data-cp="clear"]')), 'GM: the banner has Clear stage');
  await shot(G.page, '03-gm-stage');

  /* ---- the player: the banner, the cast, and nothing hidden ---- */
  check(await P.page.waitForSelector('#stageBanner:not([hidden]) .cp-st-name', { timeout: 20000 }).then(() => true, () => false), 'player: the banner appears within a poll or two');
  const bannerText = await P.page.textContent('#stageBanner');
  check(/Grunt/.test(bannerText) && /rubber apron, sleeves rolled to the elbow/.test(bannerText), 'player: the banner shows Grunt\'s name and description');
  check(await waitFigs(P.page) && !!(await P.page.$('#stageBanner .cp-st-pic svg')), 'player: the banner has the portrait');
  check(!(await P.page.$('#stageBanner [data-cp="clear"]')) && !!(await P.page.$('#stageBanner [data-cp="dismiss"]')), 'player: Hide, but no Clear stage');
  check(await waitCards(P.page, 1), 'player: the cast now holds one card');
  check((await names(P.page)).join() === 'Grunt', 'player: it is Grunt: ' + (await names(P.page)).join());
  const html = await P.page.content();
  check(!/SECRET/.test(html) && !/Mira|Brackley|Skinner|Karla|Fellows|Zam\b/.test(await P.page.textContent('body')), 'player: no gmNotes and no other NPC anywhere in the page');
  check(!(await P.page.$('#cast-page [data-cp="stage"], #cast-page [data-cp="reveal"], #cast-page a[href$="/edit"], #cast-page a[href="#cast/new"]')), 'player: no GM controls');
  check(!(await P.page.$('#cast-page .cp-badge')), 'player: no hidden/revealed badges');
  await shot(P.page, '04-player-cast');
  await P.page.click('#cast-page .cp-card[data-id="npc_grunt"] .cp-name a');
  await P.page.waitForSelector('#cast-page .cp-detail');
  check(/rubber apron/.test(await P.page.textContent('#cast-page .cp-ddesc')) && await waitFigs(P.page), 'player: the detail view has the large figure and the description');
  check(!(await P.page.$('#cast-page .cp-gmnotes')) && !/SECRET/.test(await P.page.content()), 'player: the detail view has no GM notes');
  await shot(P.page, '05-player-detail');
  await P.page.goto(BASE + '/#cast/npc_mira'); await P.page.waitForSelector('#cast-page .cp-note', { timeout: 15000 });
  check(/not in the cast/.test(await P.page.textContent('#cast-page')), 'player: a hidden NPC reads like a missing one');
  const forbidden = await Promise.all([api('PUT', '/npcs/npc_mira', PLAYER, { name: 'x' }), api('PATCH', '/npcs/npc_grunt', PLAYER, { revealed: false }), api('DELETE', '/npcs/npc_grunt', PLAYER), api('PATCH', '/campaign', PLAYER, { scene: { npcs: { npc_mira: true }, at: 'x' } })]);
  check(forbidden.every((x) => x.status === 403), 'player: every write is 403 (' + forbidden.map((x) => x.status).join(',') + ')');

  /* ---- hide the banner; a changed stage brings it back ---- */
  await P.page.goto(BASE + '/#cast'); await P.page.waitForSelector('#stageBanner:not([hidden])');
  await P.page.click('#stageBanner [data-cp="dismiss"]');
  check(await P.page.$eval('#stageBanner', (b) => b.hidden), 'player: Hide hides the banner');
  check(/On stage\s*Grunt/.test((await P.page.textContent('#cast-page .cp-onstage').catch(() => '')) || '') && !!(await P.page.$('#cast-page [data-cp="show"]')), 'player: after Hide the cast page still says who is on stage, with a way to show the banner');
  await P.page.reload(); await P.page.waitForFunction(() => window.B68Runtime && window.B68Runtime.me); await sleep(2500);
  check(await P.page.$eval('#stageBanner', (b) => b.hidden), 'player: it stays hidden after a reload while the stage is the same');
  await G.page.goto(BASE + '/#cast'); await waitCards(G.page, 7);
  await G.page.click('#cast-page .cp-card[data-id="npc_mira"] [data-cp="stage"]');
  check(await P.page.waitForSelector('#stageBanner:not([hidden])', { timeout: 20000 }).then(() => true, () => false), 'player: a changed stage brings the banner back');
  check((await P.page.$$('#stageBanner .cp-st-npc')).length === 2 && /Mira/.test(await P.page.textContent('#stageBanner')), 'player: now Grunt and Mira are on stage');
  check(await waitCards(P.page, 2), 'player: Mira (revealed with the stage) joined the cast; the other five are still hidden');

  /* ---- hiding an NPC who is on stage takes them off for everyone ---- */
  await G.page.click('#cast-page .cp-card[data-id="npc_mira"] [data-cp="reveal"]');
  check(await until(async () => (await P.page.$$('#stageBanner .cp-st-npc')).length === 1 && (await names(P.page)).join() === 'Grunt', 20000), 'player: Mira hidden again leaves the banner and the cast');
  const sc = (await api('GET', '/campaign', GM)).json.doc.scene;
  check(sc.npcs.npc_mira === false && sc.npcs.npc_grunt === true, 'server: she is off the stage too: ' + JSON.stringify(sc.npcs));

  /* ---- clear stage ---- */
  await G.page.click('#stageBanner [data-cp="clear"]');
  check(await P.page.waitForSelector('#stageBanner', { state: 'hidden', timeout: 20000 }).then(() => true, () => false), 'player: Clear stage takes the banner away');
  check(await G.page.waitForSelector('#stageBanner', { state: 'hidden', timeout: 10000 }).then(() => true, () => false), 'GM: and the GM\'s own');
  const sc2 = (await api('GET', '/campaign', GM)).json.doc.scene;
  check(Object.values(sc2.npcs).every((v) => v === false), 'server: nobody is on stage: ' + JSON.stringify(sc2.npcs));
  check((await names(P.page)).join() === 'Grunt', 'player: Grunt is still in the cast (revealed stays revealed)');
  await G.page.goto(BASE + '/#cast'); await waitCards(G.page, 7);
  check((await G.page.$$('#cast-page .cp-card.staged')).length === 0 && !(await G.page.$('#cast-page [data-cp="clear"]')), 'GM: no card is on stage and Clear stage is gone');

  /* ---- an NPC deleted while on stage leaves the banner ---- */
  await G.page.click('#cast-page .cp-card[data-id="npc_zam"] [data-cp="stage"]');
  check(await G.page.waitForSelector('#stageBanner:not([hidden])', { timeout: 10000 }).then(() => true, () => false), 'GM: Zam on stage');
  check(await P.page.waitForSelector('#stageBanner:not([hidden]) .cp-st-npc', { timeout: 20000 }).then(() => true, () => false), 'player: sees Zam on stage');
  await api('DELETE', '/npcs/npc_zam', GM);
  check(await P.page.waitForSelector('#stageBanner', { state: 'hidden', timeout: 20000 }).then(() => true, () => false), 'player: an NPC that no longer exists does not show on stage');
  await api('PATCH', '/campaign', GM, { scene: { npcs: { npc_zam: false }, at: new Date().toISOString() } });
  await P.ctx.close();

  /* ---- the phone: 360 px wide, no horizontal scroll ---- */
  await api('PATCH', '/npcs/npc_brackley', GM, { revealed: true });
  await api('PATCH', '/campaign', GM, { scene: { npcs: { npc_grunt: true, npc_brackley: true }, at: new Date().toISOString() } });
  const M = await open(PLAYER, '#cast', { width: 360, height: 740, mobile: true });
  await waitCards(M.page, 2); await M.page.waitForSelector('#stageBanner:not([hidden]) .cp-st-npc', { timeout: 20000 }); await waitFigs(M.page); await sleep(500);
  for (const [name, hash] of [['phone cast grid (with the banner)', '#cast'], ['phone detail', '#cast/npc_grunt'], ['phone home', '']]) {
    await M.page.goto(BASE + '/' + hash); await M.page.waitForFunction(() => window.B68Runtime && window.B68Runtime.me); await sleep(1500); await waitFigs(M.page);
    const l = await M.page.evaluate(layout);
    check(l.vw === 360 && l.scrollWidth <= l.clientWidth, name + ': no horizontal scroll (scrollWidth ' + l.scrollWidth + ', clientWidth ' + l.clientWidth + ')' + (l.wide.length ? ' wide: ' + l.wide.join(', ') : ''));
    if (l.banner) check(l.banner.left >= 0 && l.banner.right <= 360 && l.banner.height <= 740 * 0.6, name + ': the banner fits the screen ' + JSON.stringify(l.banner));
    if (hash === '#cast/npc_grunt') check(await M.page.evaluate(() => { const t = document.querySelector('#cast-page .cp-text'), f = document.querySelector('#cast-page .cp-fig-big'); return !!(t && f) && t.getBoundingClientRect().top < f.getBoundingClientRect().top && f.getBoundingClientRect().height <= innerHeight * 0.6; }), name + ': the name and description come before a smaller figure');
    await shot(M.page, '06-phone-' + name.replace(/[^a-z]+/g, '-'));
  }
  await M.page.goto(BASE + '/#cast'); await waitCards(M.page, 2);
  const cols = await M.page.$eval('#cast-page .cp-grid', (g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
  check(cols === 2, 'phone: the grid is two columns (' + cols + ')');
  await M.ctx.close();
  const MG = await open(GM, '#cast/npc_grunt/edit', { width: 360, height: 740, mobile: true });
  await MG.page.waitForSelector('#cp-form [data-f="name"]'); await sleep(800);
  const lg = await MG.page.evaluate(layout);
  check(lg.scrollWidth <= lg.clientWidth, 'phone: the GM editor has no horizontal scroll (scrollWidth ' + lg.scrollWidth + ', clientWidth ' + lg.clientWidth + ')' + (lg.wide.length ? ' wide: ' + lg.wide.join(', ') : ''));
  await shot(MG.page, '07-phone-editor');
  await MG.page.goto(BASE + '/#cast'); await waitCards(MG.page, 6); await sleep(500);
  const lg2 = await MG.page.evaluate(layout);
  check(lg2.scrollWidth <= lg2.clientWidth, 'phone: the GM grid has no horizontal scroll (' + lg2.scrollWidth + ' / ' + lg2.clientWidth + ')' + (lg2.wide.length ? ' wide: ' + lg2.wide.join(', ') : ''));
  await shot(MG.page, '08-phone-gm-grid');
  await MG.ctx.close();

  /* ---- Night ---- */
  const D = await open(GM, '#cast', { scheme: 'dark' });
  await waitCards(D.page, 6); await waitFigs(D.page); await sleep(400);
  await shot(D.page, '09-dark-gm-cast');
  await D.ctx.close();

  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await G.ctx.close();
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
} finally {
  clearTimeout(timeout);
  killServer('SIGTERM');
  const t0 = Date.now(); while (server.exitCode === null && server.signalCode === null && Date.now() - t0 < 5000) await sleep(100);
  killServer('SIGKILL');
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
