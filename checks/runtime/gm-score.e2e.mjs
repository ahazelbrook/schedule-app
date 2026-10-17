// The Score generator (J) on the real GM page, in a real browser, against a local wrangler dev:
// the tab, key and phone segment, a roll, the stored state (replay info only: no card text), reload (the same card), Earlier,
// a ↻ on one row (only that row moves, and it survives a reload), the cloud's fold, the pickers, To Cards (the Cards panel; nothing
// goes to the iPad), Start the clock (one hidden danger clock on the table, once), Roll the site, A face, A job for them on an
// NPC card, and a phone layout (the bar in two rows, every control 44 px, nothing wider than the screen).
// Invented fixtures only (checks/runtime/fixtures/gm/).
//   PW_MODULE=<path to playwright> node checks/runtime/gm-score.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8859);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.GM_SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json'), sf = fx('score-pack.json');
const FAC = sf.parts.score.T.faction.map((f) => f[0]);
const PARTS = {
  console: con.parts.console, npc: np.parts.npc, score: sf.parts.score,
  campaign: Object.assign({}, np.parts.campaign, { crew: sf.parts.campaign.crew, standing: sf.parts.campaign.standing }),
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-score-e2e-'));
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
const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j }; });
const gmState = async () => (await api('GET', '/gm/state')).json.doc;

try {
  const up = await until(async () => { try { return (await fetch(BASE + '/index.html')).status > 0; } catch (_) { return false; } }, 90000, 500);
  if (!up) throw new Error('the server did not start');
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  await api('PATCH', '/campaign', { session: { number: 4 }, crew: { type: 'Stagehands', tier: 2 } });        /* the table's own crew: it wins over the pack's sheet (Tunnellers, Tier I) */

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(hash, { width = 1280, height = 900, mobile = false } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width, height }, serviceWorkers: 'block', isMobile: mobile, hasTouch: mobile });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(BASE + '/' + hash);
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
    return { c, page };
  }
  const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
  /* the core grid of the card as { label: text } (the ↻ buttons left out) */
  const rowsOf = (page) => page.$eval('#gm-score dl.gm-sc-grid', (dl) => {
    const o = {}, dd = dl.querySelectorAll('dd');
    dl.querySelectorAll('dt').forEach((d, i) => { o[d.textContent] = dd[i].textContent.replace(/\s+/g, ' ').replace(/↻/g, '').trim(); });
    return o;
  });
  const cardText = (page) => text(page, '#gm-score .gm-sccard');
  const panelOf = (page) => page.$eval('#gm-root', (r) => r.getAttribute('data-panel'));
  const reopen = async (page) => { await page.reload(); await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 }); await page.keyboard.press('j'); await page.waitForSelector('#gm-score .gm-sccard', { timeout: 15000 }); };
  const changed = (page, sel, was) => page.waitForFunction(([s, w]) => { const e = document.querySelector(s); return e && e.textContent.replace(/\s+/g, ' ').trim() !== w; }, [sel, was], { timeout: 15000 });

  const G = await open('#gm');
  const p = G.page;
  await sleep(1500);
  /* what is on the iPad (its sequence number and what it shows) as the page left it on opening: the Score panel must not touch it.
     (The ambient part of that document is not compared: the page's heat and wanted sync writes it after any table save.) */
  const onIpad = async () => { const d = (await api('GET', '/gm/display')).json; return JSON.stringify([d.seq, d.display]); };
  const display0 = await onIpad();
  check((await p.$$eval('.gm-tab', (t) => t.map((x) => x.getAttribute('data-panel')).join()))  === 'prep,rules,location,scenes,score,npc,downtime,cards,ipad', 'the side tabs: Prep, Screen, Location, Street, Score, NPC, Downtime, Cards, iPad');
  check(await p.$eval('.gm-tab[data-panel="score"]', (t) => /^Score\s*J$/.test(t.textContent.trim()) && !!t.querySelector('kbd')), 'the Score tab shows its key, J');
  await p.keyboard.press('j');
  check(await panelOf(p) === 'score' && await p.$eval('#gm-score', (e) => !e.closest('[hidden]') && !e.hidden), 'key J opens the Score panel');
  await p.keyboard.press('e');
  check(await panelOf(p) === 'score', 'E opens nothing (Engage is gone)');
  check(await p.$('#gm-score .gm-sccard') === null && /Nothing here goes to the iPad/.test(await text(p, '#gm-score .gm-empty')), 'before the first roll there is a note and no card');
  check((await p.$$eval('#gm-score select', (s) => s.map((x) => x.getAttribute('data-scui')))).join() === 'client,target,job,district,crew,tier', 'six pickers: Who\'s asking, Target, Job, Where, Crew, Tier');
  const groups0 = (await p.$$eval('#gm-sc-client optgroup', (g) => g.map((x) => x.getAttribute('label')))).join();
  check(/(^|,)Campaign NPCs,Factions,Kinds$/.test(groups0), 'Who\'s asking: the campaign\'s NPCs, factions and kinds of client (' + groups0 + ')');
  const crew0 = [await p.$eval('#gm-sc-crew option', (o) => o.textContent), await p.$eval('#gm-sc-tier option', (o) => o.textContent)].join(' / ');
  check(crew0 === 'Stagehands (the crew) / Tier II (the crew)', 'the crew and Tier are the table\'s own, not the pack sheet\'s (' + crew0 + ')');

  await p.click('[data-gm="scoreroll"]');
  check(await p.waitForSelector('#gm-score .gm-sccard', { timeout: 15000 }).then(() => true, () => false), 'Roll a score draws a card');
  const first = await cardText(p), rows1 = await rowsOf(p);
  check(Object.keys(rows1).join() === "Who's asking,The job,Target,Where,Why now,Twist,Ways in,Pays" && Object.values(rows1).every((v) => v.length > 3), 'the card has its eight rows, each with text');
  check((await p.$$('#gm-score .gm-sccard .gm-chip')).length === 4 && await p.$('#gm-score .gm-sc-want .gm-bump[data-row="lead"]') !== null, 'four chips, and the pitch with its own ↻');
  check(await p.$eval('#gm-score details.gm-sc-cloud', (d) => !d.open && d.querySelector('summary').textContent === 'The cloud'), 'The cloud is folded');
  check((await p.$$eval('#gm-score .gm-sccard .gm-card-acts button', (b) => b.map((x) => x.textContent))).join() === 'To Cards,Roll the site,A face,Start the clock,Pin,Copy', 'the actions: To Cards, Roll the site, A face, Start the clock, Pin, Copy');
  check((await p.$$('#gm-score .gm-earlier [data-gm="replay"]')).length === 1, 'Earlier holds the roll');
  await sleep(1200);
  let st = await gmState();
  const c1 = st.cards.score;
  check(!!c1 && Number.isInteger(c1.seed) && typeof c1.mem === 'string' && !!c1.hid && !('bump' in c1) && c1.ui && c1.ui.crew === 'Stagehands' && c1.ui.tier === 2 && Object.keys(st.hist.score).length === 1 && st.mem && st.mem.score && Object.keys(st.mem.score).length > 5,
    'server: the card (seed, choices as resolved, memory before the roll), one history entry and the repeat guard are stored ' + JSON.stringify({ keys: Object.keys(c1 || {}), ui: c1 && c1.ui, hist: Object.keys(st.hist.score || {}).length, mem: Object.keys((st.mem && st.mem.score) || {}).length }));
  const frag = rows1.Twist.slice(0, 24);
  check(frag.length > 10 && !JSON.stringify(st).includes(frag), 'server: no card text in the stored state (seed, choices and memory only)');
  await shot(p, 'score-desktop');

  // a second roll, then reload: the same card; Earlier brings back the first
  await p.click('[data-gm="scoreroll"]');
  await changed(p, '#gm-score .gm-sccard', first);
  const second = await cardText(p);
  await sleep(1200);
  await reopen(p);
  check(await cardText(p) === second, 'reload: the same card');
  await p.click('#gm-score [data-gm="replay"]:not([aria-current])');
  await p.waitForFunction((t) => { const c = document.querySelector('#gm-score .gm-sccard'); return c && c.textContent.replace(/\s+/g, ' ').trim() === t; }, first, { timeout: 15000 }).catch(() => {});
  check(await cardText(p) === first, 'Earlier: the first card is back, card for card');

  // ↻ on a row: that row only, same seed, same Earlier entry; it survives a reload
  await sleep(1200);                                      /* the Earlier click reaches the server */
  const was = await rowsOf(p), seed = (await gmState()).cards.score.seed;
  await p.click('#gm-score .gm-bump[data-row="why"]');
  await p.waitForFunction((w) => { const dl = document.querySelector('#gm-score dl.gm-sc-grid'); const dt = [].find.call(dl.querySelectorAll('dt'), (d) => d.textContent === 'Why now'); return dt && dt.nextElementSibling.textContent.replace(/\s+/g, ' ').replace(/↻/g, '').trim() !== w; }, was['Why now'], { timeout: 15000 });
  const now = await rowsOf(p);
  check(Object.keys(was).every((k) => k === 'Why now' ? now[k] !== was[k] : now[k] === was[k]), 'a ↻ on Why now moves that row and no other: ' + was['Why now'].slice(0, 30) + ' -> ' + now['Why now'].slice(0, 30));
  await sleep(1200);
  st = await gmState();
  const c2 = st.cards.score;
  check(c2.seed === seed && c2.bump && c2.bump.why >= 1 && Object.keys(c2.bump).length === 1 && Object.keys(st.hist.score).length === 2 && st.hist.score[c2.hid] && st.hist.score[c2.hid].bump && st.hist.score[c2.hid].bump.why === c2.bump.why,
    'server: the same seed, a bump for that one section, the Earlier entry has it too, no new entry ' + JSON.stringify({ same: c2.seed === seed, bump: c2.bump, hist: Object.keys(st.hist.score).length, hb: st.hist.score[c2.hid] && st.hist.score[c2.hid].bump }));
  const bumped = await cardText(p);
  await reopen(p);
  check(await cardText(p) === bumped, 'reload: the rerolled card comes back as it was');

  // the cloud stays as the GM left it, through a ↻ and a reload
  await p.click('#gm-score details.gm-sc-cloud > summary');
  check(await p.$eval('#gm-score details.gm-sc-cloud', (d) => d.open), 'The cloud opens');
  await p.click('#gm-score .gm-bump[data-row="twist"]');
  await p.waitForFunction(() => document.querySelector('#gm-score .gm-sccard'), null, { timeout: 5000 });
  check(await p.$eval('#gm-score details.gm-sc-cloud', (d) => d.open), 'a ↻ leaves the cloud open');
  await sleep(600);
  await reopen(p);
  check(await p.$eval('#gm-score details.gm-sc-cloud', (d) => d.open) && /By the book/.test(await text(p, '#gm-score details.gm-sc-cloud')), 'reload: the cloud is still open, with its rows');
  await p.click('#gm-score details.gm-sc-cloud > summary');

  // the pickers shape the next roll and are kept
  const target = 'fac:' + FAC[3];
  await p.selectOption('#gm-sc-target', target);
  await p.selectOption('#gm-sc-job', 'Lift');
  const before = await cardText(p);
  await sleep(300);
  check(await cardText(p) === before, 'a picker changes the next roll, not the card on screen');
  await p.click('[data-gm="scoreroll"]');
  await changed(p, '#gm-score .gm-sccard', before);
  const rows3 = await rowsOf(p);
  check(/^Lift/.test(rows3['The job']) && rows3.Target.indexOf(FAC[3]) === 0, 'a roll with the target and the job chosen: ' + rows3['The job'].slice(0, 20) + ' / ' + rows3.Target.slice(0, 30));
  await sleep(1200);
  st = await gmState();
  check(st.sc && st.sc.ui && st.sc.ui.target === target && st.sc.ui.job === 'Lift' && st.cards.score.ui.target === target && st.cards.score.ui.job === 'Lift', 'server: the pickers are kept, and the card records its choices');
  await reopen(p);
  check(await p.$eval('#gm-sc-target', (s) => s.value) === target && await p.$eval('#gm-sc-job', (s) => s.value) === 'Lift', 'reload: the pickers are as they were');

  // To Cards: the opportunity goes on the Cards panel; nothing goes to the iPad from here
  await p.click('#gm-score [data-gm="scorecards"]');
  const opps = await until(async () => { const d = await gmState(); return d.opps && d.opps.list && Object.keys(d.opps.list).length === 1 ? d.opps.list : null; }, 8000);
  const opp = opps && Object.values(opps)[0];
  check(!!opp && typeof opp.target === 'string' && opp.target.length > 2 && typeof opp.type === 'string' && opp.type.length > 2 && typeof opp.note === 'string', 'To Cards: one opportunity is stored (' + (opp ? opp.type + ' · ' + opp.target : 'none') + ')');
  await p.keyboard.press('o');
  check(await panelOf(p) === 'cards' && await p.$eval('#gm-cards .oc-in[data-f="target"]', (i, t) => i.value === t, opp && opp.target), 'and it is on the Cards panel, target and all');
  const display1 = await onIpad();
  check(display1 === display0, 'the iPad has been sent nothing by the Score panel' + (display1 === display0 ? '' : ' ' + display0.slice(0, 150) + ' -> ' + display1.slice(0, 150)));

  // Start the clock: one hidden danger clock on the table, once
  await p.keyboard.press('j');
  await p.click('#gm-score [data-gm="scoreclock"]');
  const clocks = await until(async () => { const d = (await api('GET', '/campaign')).json.doc; return (d.clocks || []).length ? d.clocks : null; }, 8000);
  const ck = clocks && clocks[0];
  check(!!ck && clocks.length === 1 && ck.hidden === true && ck.kind === 'danger' && ck.filled === 0 && /^c_/.test(ck.id) && ck.name.length > 2, 'Start the clock: one hidden danger clock on the table: ' + (ck && ck.name));
  check(await p.waitForFunction(() => { const b = document.querySelector('#gm-score [data-gm="scoreclock"]'); return b && b.disabled && /^Clock started: /.test(b.textContent); }, null, { timeout: 8000 }).then(() => true, () => false), 'the button is done for this card');
  await sleep(1200);
  st = await gmState();
  check(st.cards.score.started && st.cards.score.started[ck.name] === ck.id, 'server: the card keeps the clock\'s id by name');
  await reopen(p);
  check(await p.$eval('#gm-score [data-gm="scoreclock"]', (b) => b.disabled && /^Clock started: /.test(b.textContent)), 'reload: the button is still done');

  // Roll the site and A face
  await p.click('#gm-score [data-gm="scoresite"]');
  check(await panelOf(p) === 'location' && await p.waitForSelector('#gm-loc .gm-loccard', { timeout: 15000 }).then(() => true, () => false), 'Roll the site: the Location tab opens with a card');
  await p.keyboard.press('j');
  check(await p.$('#gm-score [data-gm="scoreface"]') !== null, 'A face is offered (the client is not an NPC)');
  await p.click('#gm-score [data-gm="scoreface"]');
  check(await panelOf(p) === 'npc' && await p.waitForFunction(() => /For a face|NPC tables hold neither/.test(document.getElementById('toastMsg').textContent), null, { timeout: 8000 }).then(() => true, () => false), 'A face: the NPC tab opens and a toast says what it set');

  // A job for them, on an NPC card
  await p.click('[data-gm="npcroll"]');
  await p.waitForSelector('#gm-npc .gm-npccard', { timeout: 15000 });
  const npcName = (await text(p, '#gm-npc .gm-npccard h3')).split(' — ')[0];
  await p.click('#gm-npc .gm-npccard [data-gm="npcjob"]');
  check(await panelOf(p) === 'score' && await p.waitForSelector('#gm-score .gm-sccard', { timeout: 15000 }).then(() => true, () => false), 'A job for them: the Score tab opens and rolls');
  const rows4 = await rowsOf(p);
  check(rows4["Who's asking"].indexOf(npcName) === 0 && (await p.$eval('#gm-sc-client', (s) => s.value)).indexOf('npc:roll-') === 0, 'with ' + npcName + ' asking');
  check((await p.$$eval('#gm-sc-client optgroup', (g) => g.map((x) => x.getAttribute('label')))).includes('Last NPC roll') && await p.$('#gm-score [data-gm="scoreface"]') === null, 'the last NPC roll is in the picker; A face is not offered when an NPC asks');
  const display2 = await onIpad();
  check(display2 === display0, 'still nothing sent to the iPad' + (display2 === display0 ? '' : ' ' + display0.slice(0, 150) + ' -> ' + display2.slice(0, 150)));
  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await G.c.close();

  // a phone: the bar in two rows, nothing wider than the screen, every control 44 px or more, the label over its row
  await api('PATCH', '/gm/state', { sc: { ui: { client: null, who: null, target: null, job: null } } });          /* every row free to roll again */
  const M = await open('#gm', { width: 390, height: 844, mobile: true });
  const mp = M.page;
  const segs = await mp.$$eval('.gm-segbar .chip', (c) => c.map((x) => { const r = x.getBoundingClientRect(); return { seg: x.getAttribute('data-seg'), top: Math.round(r.top), right: Math.round(r.right) }; }));
  const perRow = segs.reduce((m, s) => { m[s.top] = (m[s.top] || 0) + 1; return m; }, {});
  check(segs.map((s) => s.seg).join() === 'console,prep,location,scenes,score,npc,downtime,cards,rules,ipad,state' && JSON.stringify(Object.values(perRow)) === '[6,5]' && segs.every((s) => s.right <= 390), 'phone: eleven segments in two rows (six, then five), Score after Street ' + JSON.stringify(perRow));
  await mp.click('.gm-segbar [data-seg="score"]');
  await mp.waitForSelector('#gm-score [data-gm="scoreroll"]', { state: 'visible', timeout: 5000 });
  await mp.click('[data-gm="scoreroll"]');
  await mp.waitForSelector('#gm-score .gm-sccard', { timeout: 15000 });
  const lay = await mp.evaluate(() => {
    const vw = window.innerWidth, wide = [], small = [];
    for (const el of document.querySelectorAll('#gm-page *')) { const r = el.getBoundingClientRect(); if (r.width && r.height && r.right > vw + 1) { let clipped = false; for (let q = el.parentElement; q && q !== document.body; q = q.parentElement) if (getComputedStyle(q).overflowX !== 'visible') { clipped = true; break; } if (!clipped && getComputedStyle(el).position !== 'fixed') wide.push(el.tagName + '.' + (el.className || '')); } }
    for (const el of document.querySelectorAll('#gm-page button, #gm-page select, #gm-page summary')) { const r = el.getBoundingClientRect(); if (r.width && r.height && (r.height < 43.5 || (el.classList.contains('gm-bump') && r.width < 43.5))) small.push((el.getAttribute('data-gm') || el.id || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); }
    const dl = document.querySelector('#gm-score dl.gm-sc-grid'), dt = dl.querySelector('dt'), dd = dl.querySelector('dd');
    return { vw, sw: document.documentElement.scrollWidth, wide: wide.slice(0, 5), small: small.slice(0, 6), bumps: document.querySelectorAll('#gm-score .gm-bump').length, over: dt.getBoundingClientRect().bottom <= dd.getBoundingClientRect().top + 1 };
  });
  check(lay.sw <= lay.vw + 1 && !lay.wide.length, 'phone: nothing wider than the screen (' + JSON.stringify({ sw: lay.sw, vw: lay.vw, wide: lay.wide }) + ')');
  check(!lay.small.length && lay.bumps >= 6, 'phone: every visible control, the ' + lay.bumps + ' ↻ buttons included, is 44 px or bigger' + (lay.small.length ? ' (' + lay.small.join(', ') + ')' : ''));
  check(lay.over, 'phone: a row\'s label sits over its text');
  const wasM = await rowsOf(mp);
  await mp.tap('#gm-score .gm-bump[data-row="why"]');
  await mp.waitForFunction((w) => { const dl = document.querySelector('#gm-score dl.gm-sc-grid'); const dt = [].find.call(dl.querySelectorAll('dt'), (d) => d.textContent === 'Why now'); return dt && dt.nextElementSibling.textContent.replace(/\s+/g, ' ').replace(/↻/g, '').trim() !== w; }, wasM['Why now'], { timeout: 15000 });
  check(true, 'phone: a tap on a ↻ rolls that row again');
  await shot(mp, 'score-phone');
  check(errors.length === 0, 'no page errors on the phone' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
killServer();
process.exit(failed ? 1 : 0);
