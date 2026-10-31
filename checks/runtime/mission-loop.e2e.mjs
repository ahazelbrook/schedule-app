// The whole mission loop in one rehearsal (VV10, design 6.3): the GM page (1536x864), the table display (1180x820) and two phones (390x844, one player each)
// against a real local Worker (wrangler dev, DEV_USER) on PORT (default 8920), with the INVENTED Pelican Rooms (fixtures/gm/pelican-play-v2.json).
// The GM drives the Run view; the display shows the band; each phone has its Mission card open (it opens by itself). Four Next presses, with the other things a night does between them:
//   - Next: the band's time, NOW and NEXT change within one poll, and each open card redraws (latency printed against the gate's 3 s)
//   - each player sees only their own card (their name, never the other's, in the card or anywhere in the page)
//   - auto-heard: a lead in reach lands on one phone and not the other with no tap; the room panel's un-hear toggle takes it back and the next step does not re-hear it
//   - Tell the crew: the intel is on the band (ways found) and on both cards
//   - a hidden NPC's name is refused (nothing reaches the band or the phones), and Reveal and send then works
//   - End the night clears the band and both cards
// Un-hear and Tell the crew are the Run view's own buttons (the room panel and the Intel fold).
//   PW_MODULE=<playwright install> PW_CHANNEL=msedge node checks/runtime/mission-loop.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8920);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test', P1 = 'p1@example.test', P2 = 'p2@example.test';
const GATE_MS = 3000;
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const BALL = require(path.join(ROOT, 'app', 'gm', 'ball.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const conFix = JSON.parse(readFileSync(path.join(FIX, 'console-pack.json'), 'utf8'));
const locFix = JSON.parse(readFileSync(path.join(FIX, 'location-pack.json'), 'utf8'));
const V2 = JSON.parse(readFileSync(path.join(FIX, 'pelican-play-v2.json'), 'utf8'));
const NOW = new Date().toISOString();
const NAME2 = 'The Pelican Rooms';
const BANDS = ['public', 'public', 'working', 'working', 'controlled', 'secure'];
const ROOMS = V2.zones.flatMap((z) => z.rooms).map((name, i) => ({ name, band: BANDS[i], detail: 'A room.', ...(i === 5 ? { isTarget: true } : {}) }));
const c2 = BALL.checkPlay(V2, ROOMS.map((r) => r.name));
if (c2.warnings.length) { console.log('FAIL the fixture play has warnings: ' + c2.warnings.join(' | ')); process.exit(1); }
const PARTS = {
  console: conFix.parts.console, campaign: { ...conFix.parts.campaign, src: { ...conFix.parts.campaign.src, exportedAt: NOW } },
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: NOW }, T: locFix.T, extra: locFix.extra,
    authored: { v: 1, sites: { [NAME2]: { name: NAME2, rel: 'x', map: { view: 'iso', theme: 'rulebook' }, patch: { district: 'Nowhere Ward', rooms: ROOMS }, play: c2.play } }, bind: {} } },
};
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect x="10" y="10" width="380" height="280" fill="#223" stroke="#eee" stroke-width="4"/><rect x="40" y="40" width="140" height="100" fill="#456"/></svg>';

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-loop-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use: stop what is on it, or set PORT'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'DISPLAY_EMAILS:' + IPAD], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
function killServer() { if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', () => { killServer(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failed++; }
async function until(fn, ms, step = 50) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 420000);
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const ball = async () => (await api('GET', '/gm/state')).json.doc.ball;
const mission = async () => (await api('GET', '/campaign')).json.doc.mission;
const hhmm = (min) => { const m = (21 * 60 + min) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

/* Arm a page to stamp (Date.now) the first moment `body(arg)` is true; read it with stamp(). All pages share this machine's clock. */
const arm = (page, body, arg) => page.evaluate(([b, a]) => {
  if (window.__armObs) { window.__armObs.disconnect(); clearInterval(window.__armTick); }
  window.__hit = null;
  const f = new Function('a', 'return (' + b + ')');
  const chk = () => { if (window.__hit === null) { try { if (f(a)) window.__hit = Date.now(); } catch (e) { /* not drawn yet */ } } };
  window.__armObs = new MutationObserver(chk); window.__armObs.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  window.__armTick = setInterval(chk, 15);
}, [body, arg]);
const stamp = (page, ms = 12000) => until(() => page.evaluate(() => window.__hit), ms, 15);

const lat = { band: [], phone1: [], phone2: [] };
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2)) : NaN; };

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src || {}, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  const put = await api('PUT', '/campaign', {
    v: 1, session: { number: 1, startedAt: NOW, endedAt: null },
    crew: { name: 'The Lamplighters', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] },
    clocks: [{ id: 'c_fuse', name: 'Fuse', size: 6, filled: 2, kind: 'danger', hidden: true }], log: [] });
  check(put.status === 200, 'the table holds a hidden Fuse clock');
  check((await api('PATCH', '/gm/state', { cards: { location: { hid: 'h_loop', auth: NAME2, label: NAME2 + ' · Nowhere Ward', at: NOW } }, loc: { map: { view: 'iso', theme: 'rulebook', layer: 'gm', reveal: { public: true, working: false, controlled: false, secure: false } } } })).status === 200, 'the Location card is the v2 site');

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [], asked = [];
  async function openPage(user, w, h, url, opts = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width: w, height: h }, serviceWorkers: 'block', ...(opts.touch ? { isMobile: true, hasTouch: true } : {}) });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(user + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push(user + ' pageerror: ' + e.message));
    page.on('dialog', (d) => { asked.push(d.message()); return d.accept(); });
    await page.goto(BASE + url);
    return { c, page };
  }

  /* the GM's laptop opens first, so characters can be filed by the page's own figure kit */
  const G = await openPage(GM, 1536, 864, '/#gm');
  await G.page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
  await G.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  const spec = await G.page.evaluate(() => window.B68.BASE_FIGURE);
  const pcDoc = (name) => ({ v: 2, name, alias: '', code: '', playbook: 'hound', playbookName: 'Hound', spec, sheet: { name }, play: { vice: '', purveyor: '', contacts: [], clocks: [] } });
  const A = { id: 'loop-pc1', name: 'Cass Fenn', owner: P1 }, B = { id: 'loop-pc2', name: 'Dov Ketch', owner: P2 };
  for (const p of [A, B]) check((await api('PUT', '/characters/' + p.id, pcDoc(p.name), p.owner)).status === 200, 'an invented PC is filed by their player: ' + p.name);
  /* the GM page reads the characters at load: reload so it holds both */
  await G.page.reload();
  await G.page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
  await G.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  await G.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await G.page.keyboard.press('g');
  await G.page.waitForSelector('.rv-head', { timeout: 15000 });
  await G.page.evaluate(() => { window.__t0 = 0; document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('[data-rv="next"]')) window.__t0 = Date.now(); }, true); });

  /* the display: an iPad sign-in with a map on it (the band draws beside a map) */
  check((await api('PUT', '/gm/display', { kind: 'svg', title: NAME2, caption: 'Ground floor', svg: SVG })).status === 200, 'the GM puts the map on the iPad');
  const D = await openPage(IPAD, 1180, 820, '/');
  await D.page.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 15000 });
  /* a second, larger display only to read "Ways found", which the band cuts at 1180x820 */
  const D2 = await openPage(IPAD, 1920, 1080, '/');
  await D2.page.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 15000 });

  /* the night: start, place the crew */
  await G.page.click('[data-rv="start"][data-key="4/5"]');
  check(!!(await until(async () => (await ball()) && (await ball()).start === 45, 8000)), 'Start the night (4/5): ball.start = 45');
  /* the big clock is off the iPad unless the GM turned it on (ball.showTime; the menu toggle is the GM page's): this rehearsal times the band by its clock, so turn it on before the crew is placed (the page adopts the server's ball on its next write) */
  { const b0 = await ball(); await api('PATCH', '/gm/state', { ball: Object.assign({}, b0, { showTime: true }) }); }
  await G.page.click('.rv-tray .rv-pc[data-id="' + A.id + '"]'); await G.page.click('.rv-card[data-room="Showroom"]');
  await until(async () => ((await ball()).crew || {})[A.id], 8000);
  await G.page.click('.rv-tray .rv-pc[data-id="' + B.id + '"]'); await G.page.click('.rv-card[data-room="Cocktail lounge"]');
  await until(async () => ((await ball()).crew || {})[B.id], 8000);
  check(!!(await until(async () => { const m = await mission(); return m && Object.keys(m.cards).length === 2 ? m : null; }, 10000)), 'both PCs on the job: two cards published');

  /* the phones: each player on their own sheet, the Mission card open */
  const P = {};
  for (const [k, p] of [['a', A], ['b', B]]) {
    P[k] = await openPage(p.owner, 390, 844, '/#c/' + p.id, { touch: true });
    await P[k].page.waitForSelector('#dossier .ds-bar', { timeout: 30000 });
    await P[k].page.waitForSelector('.ds-missionbtn', { timeout: 15000 });
    await P[k].page.waitForSelector('.ds-mv', { timeout: 15000 });   // the card opens by itself: it is new to this phone (no tap)
  }
  const cardText = (pg) => pg.evaluate(() => { const v = document.querySelector('.ds-mv'); return v ? v.innerText : ''; });
  const pageHas = (pg, s) => pg.evaluate((x) => document.documentElement.outerHTML.includes(x), s);
  const bandText = () => D.page.evaluate(() => { const b = document.querySelector('.dp-band'); return b && !b.hidden ? b.innerText : ''; });
  check(!!(await until(async () => /21:45/.test(await bandText()), 15000)), 'the iPad shows the band at 21:45');

  /* ---- a beat: Next, and how long the band and each card take ---- */
  async function beat(n) {
    const t = (await ball()).t, want = hhmm(t + 15);
    const b0a = await cardText(P.a.page), b0b = await cardText(P.b.page);
    await arm(D.page, "(document.querySelector('.dp-b-clock')||{}).textContent === a", want);
    await arm(P.a.page, "((document.querySelector('.ds-mv')||{}).innerText||'') !== a", b0a);
    await arm(P.b.page, "((document.querySelector('.ds-mv')||{}).innerText||'') !== a", b0b);
    await G.page.evaluate(() => { window.__t0 = 0; });
    await G.page.click('[data-rv="next"]');
    const t0 = await G.page.evaluate(() => window.__t0);
    const [h, ha, hb] = await Promise.all([stamp(D.page), stamp(P.a.page), stamp(P.b.page)]);
    const ms = [h, ha, hb].map((x) => (x ? x - t0 : null));
    check(!!t0 && ms.every((x) => x !== null && x >= 0), 'beat ' + n + ': Next to ' + want + ': the band and both cards changed (band ' + ms[0] + ' ms, card A ' + ms[1] + ' ms, card B ' + ms[2] + ' ms)');
    if (ms[0] !== null) lat.band.push(ms[0]); if (ms[1] !== null) lat.phone1.push(ms[1]); if (ms[2] !== null) lat.phone2.push(ms[2]);
    check(ms.every((x) => x !== null && x < GATE_MS), 'beat ' + n + ': inside the gate\'s 3 s');
    check((await bandText()).includes(want) && (await mission()).hud.time === want, 'beat ' + n + ': the band says ' + want + ' and so does the stored mission');
  }
  const ownCardsOnly = async (n) => {
    const ta = await cardText(P.a.page), tb = await cardText(P.b.page);
    check(/cass fenn/i.test(ta) && !/dov/i.test(ta) && /dov ketch/i.test(tb) && !/cass/i.test(tb), 'beat ' + n + ': each card names its own PC only ' + JSON.stringify([ta.slice(0, 60), tb.slice(0, 60)]));
    /* each PC's own strings (name, room) from the stored mission's card; a positive control finds them on their own page */
    const m = await mission(), hudText = JSON.stringify(m.hud), own = (p) => [p.name, m.cards[p.id].room].filter((s) => s && (s === p.name || !hudText.includes(s)));   /* a room the shared band names is not only this card's */
    const oA = own(A), oB = own(B);
    const ctl = [];
    for (const s of oA) ctl.push(await pageHas(P.a.page, s));
    for (const s of oB) ctl.push(await pageHas(P.b.page, s));
    const leak = [];
    for (const s of oB) if (await pageHas(P.a.page, s)) leak.push('A has ' + s);
    for (const s of oA) if (await pageHas(P.b.page, s)) leak.push('B has ' + s);
    check(ctl.every(Boolean), 'beat ' + n + ': positive control, each phone\'s page holds its own strings ' + JSON.stringify([oA, oB]));
    check(leak.length === 0, 'beat ' + n + ': neither phone\'s page holds a string only the other PC\'s card has (' + (leak.join(', ') || 'none') + ')');
  };
  const intelFold = async () => { if (!(await G.page.$eval('.rv-intel', (e) => e.open))) await G.page.click('.rv-sec[data-sec="intel"] summary'); };
  const tellCrew = async (id) => { await intelFold(); await G.page.click('.rv-intel1[data-intel="' + id + '"] [data-vv="tellcrew"]'); };
  /* the "Ways found: n of m" line, read from the big display (the 1180x820 band cuts it to fit) */
  const waysOf = async () => { const m = (await D2.page.evaluate(() => { const b = document.querySelector('.dp-band'); return b && !b.hidden ? b.innerText : ''; })).match(/Ways found: (\d+) of (\d+)/); return m ? m[0] : null; };

  /* beat 1: Next, and each player sees only their card */
  await beat(1);
  await ownCardsOnly(1);

  /* beat 2: Next, then Tell the crew: the intel is on the band (ways found) and on both cards */
  await beat(2);
  const bandWays0 = await bandText();
  check(!/card tables/.test(bandWays0), 'before: the band does not mention the card tables');
  await arm(D.page, "/card tables/.test((document.querySelector('.dp-band')||{}).innerText||'')", null);
  const tT = Date.now();
  await tellCrew('I2');
  check(!!(await until(async () => ((await ball()).told || {}).I2 === 'crew', 8000)), 'Tell the crew (the Intel fold): ball.told.I2 = crew');
  const sT = await stamp(D.page);
  check(!!sT, 'Tell the crew: the band names the event the intel reveals (' + (sT ? sT - tT : '-') + ' ms after the write) ' + (sT ? '' : JSON.stringify(await bandText())));
  const kA = await until(async () => /Odette plays cards/.test(await cardText(P.a.page)), 8000), kB = await until(async () => /Odette plays cards/.test(await cardText(P.b.page)), 8000);
  check(kA && kB, 'and the intel text is on both cards');

  /* beat 3: Next, and the lead in reach is heard automatically (autoHear): a lead on the PC's phone and not the other, no tap */
  const leadsA0 = await P.a.page.$$eval('.ds-mv-lead', (l) => l.length), leadsB0 = await P.b.page.$$eval('.ds-mv-lead', (l) => l.length);
  await beat(3);
  check(!!(await until(async () => { const b = await ball(); return b.heard && b.heard.A && typeof b.heard.A[B.id] === 'number' && !(b.heard.A[A.id]); }, 8000)), 'auto-heard: ball.heard.A holds the second PC (stood where the lead is said) and not the first, with no tap');
  await sleep(1500);
  const leadsA1 = await P.a.page.$$eval('.ds-mv-lead', (l) => l.length), leadsB1 = await P.b.page.$$eval('.ds-mv-lead', (l) => l.length);
  const ta = await cardText(P.a.page), tb = await cardText(P.b.page);
  check(leadsB1 === 1 && leadsA1 === 0 && tb.includes('The Last Hand') && !ta.includes('The Last Hand'), 'auto-heard: the lead is on one phone and not the other (leads ' + leadsA0 + '->' + leadsA1 + ' and ' + leadsB0 + '->' + leadsB1 + ')');
  check(await pageHas(P.b.page, 'The Last Hand') && await pageHas(P.b.page, 'She never leaves a table') && !(await pageHas(P.a.page, 'The Last Hand')) && !(await pageHas(P.a.page, 'She never leaves a table')), 'and the lead (name and line) is in the hearer\'s page DOM and nowhere in the other phone\'s page');
  const w1 = await until(async () => ((await waysOf()) === 'Ways found: 1 of 2' ? 'Ways found: 1 of 2' : null), 8000);
  check(!!w1, 'the big display\'s band says exactly "Ways found: 1 of 2" with no tap (matched ' + JSON.stringify(await waysOf()) + ')');

  /* the room panel's toggle takes it back: count down, ball.unheard set, and the next step does not re-hear it */
  await G.page.click('.rv-card[data-room="Cocktail lounge"] .rv-cn');
  await G.page.click('.rv-rm [data-rv="unhear"][data-way="A"][data-pc="' + B.id + '"]');
  check(!!(await until(async () => { const b = await ball(); return !(b.heard && b.heard.A && b.heard.A[B.id]) && b.unheard && b.unheard.A && b.unheard.A[B.id]; }, 8000)), 'un-hear (the room panel): ball.heard.A drops the second PC and ball.unheard.A marks the pair');
  check(!!(await until(async () => (await waysOf()) === 'Ways found: 0 of 2', 8000)), 'un-hear: the band says "Ways found: 0 of 2" (matched ' + JSON.stringify(await waysOf()) + ')');

  /* beat 4: Next, then a hidden NPC whose name is on the band is refused, and Reveal and send works */
  await beat(4);
  { const b4 = await ball(); check(!(b4.heard && b4.heard.A && b4.heard.A[B.id]) && !!(b4.unheard && b4.unheard.A && b4.unheard.A[B.id]), 'after the next step the un-heard lead stays un-heard (ball.unheard blocks re-hearing)'); }
  check((await waysOf()) === 'Ways found: 0 of 2', 'and the band still says "Ways found: 0 of 2" (matched ' + JSON.stringify(await waysOf()) + ')');
  const npc = { name: 'Odette', alias: '', role: 'Guest', faction: '', description: '', gmNotes: 'GM-ONLY-LOOP', revealed: false, spec };
  check((await api('PUT', '/npcs/npc_loop_hid', npc)).status === 200, 'a hidden NPC named Odette is filed');
  const seqBefore = (await mission()).seq, bandBefore = await bandText();
  await tellCrew('I3');                                   // a change that republishes while the name is on the band
  const offer = await until(() => G.page.$('#gm-offer [data-gm="offer-go"]'), 8000);
  check(!!offer, 'Not sent to the players: the page offers "Reveal Odette and send"');
  if (offer) check(/Odette/.test(await G.page.$eval('#gm-offer', (e) => e.textContent)) && /still hidden/.test(await G.page.$eval('#gm-offer', (e) => e.textContent)), 'and says who is still hidden');
  await sleep(1500);
  const mAfter = await mission();
  check(mAfter.seq === seqBefore && !JSON.stringify(mAfter).includes('trapdoor'), 'the refused mission reached nobody: same seq, the campaign document unchanged (seq ' + mAfter.seq + ')');
  check((await bandText()) === bandBefore, 'and the band is unchanged');
  check(!/trapdoor/.test(await cardText(P.a.page)) && !/trapdoor/.test(await cardText(P.b.page)), 'and neither phone has the new intel');
  await G.page.click('#gm-offer [data-gm="offer-go"]');
  check(asked.some((q) => /hidden from the players/.test(q)), 'Reveal asked first');
  check((await api('GET', '/npcs/npc_loop_hid')).json.doc.revealed === true, 'the NPC is revealed in the cast');
  check(!!(await until(async () => /trapdoor/.test(await cardText(P.a.page)) && /trapdoor/.test(await cardText(P.b.page)), 8000)), 'and both phones now hold the new intel');
  check((await mission()).seq > seqBefore, 'the stored mission moved on');
  await ownCardsOnly(4);
  await G.page.screenshot({ path: path.join(ROOT, 'gm-private', 'loop-gm.png') }).catch(() => {});

  /* ---- End the night ---- */
  await G.page.click('[data-rv="menu"]');
  await G.page.click('[data-rv="menuitem"]:has-text("End the night")');   // the menu now also holds "Show the time", so pick by label
  check(!!(await until(async () => !(await mission()), 10000)), 'End the night: the mission is gone from the campaign document');
  check(!!(await until(async () => (await bandText()) === '', 12000)), 'the band is gone from the iPad');
  check(!!(await until(async () => (await P.a.page.$$('.ds-missionbtn')).length === 0 && (await P.a.page.$$('.ds-mv')).length === 0, 8000)), 'the first phone\'s card is closed and its button gone');
  check(!!(await until(async () => (await P.b.page.$$('.ds-missionbtn')).length === 0 && (await P.b.page.$$('.ds-mv')).length === 0, 8000)), 'and the second phone\'s');

  const line = (k) => k + ': median ' + median(lat[k]) + ' ms, max ' + Math.max(...lat[k]) + ' ms (' + lat[k].join(', ') + ')';
  console.log('\nLATENCY, Next on the GM page to the surface changing, over ' + lat.band.length + ' beats (the gate is ' + GATE_MS + ' ms)');
  console.log('  ' + line('band') + '\n  ' + line('phone1') + '\n  ' + line('phone2'));

  check(!errors.length, 'no page errors: ' + errors.slice(0, 3).join(' | '));
  await browser.close();
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
clearTimeout(timeout);
console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASSED'));
process.exit(failed ? 1 : 0);
