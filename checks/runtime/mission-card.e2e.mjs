// The phones' mission card end to end (VV7, design 5.4): the sheet's Mission button and full-screen card, boot.js (api.mission), the adapter (cf.js)
// and a real local Worker (wrangler dev, DEV_USER) on PORT (default 9020). Phones are 390 x 844, touch. The missions are built by VV1's engine
// (app/gm/ball.js: checkPlay, playerView, missionFor) from fixtures/gm/pelican-play-v2.json (the invented Pelican Rooms) and PATCHed as the GM through
// the real /api/campaign, so the phones read what cleanMission stores (a PATCH replaces the mission whole, with seq >= 1).
// Checks:
//   - two players, one PC each: each sees only their own card, though the document holds both (proved by reading the document in the page)
//   - the button sits in the sticky bar after Table, with a dot until opened; a change to the card arrives within one poll (and by poke, with the poll a minute away)
//   - a change to another PC's card lights nothing; a publish that only moves countdowns (inMin, hud) lights nothing; an open card makes no request of its own
//   - the card: name and costume, a 28 px status coloured by pos with the room, the warning band, zones, leads (open first, done struck, next step only),
//     items, paths, know, NOW from the hud and NEXT from the card; 16 px prose; everything is text; no live region, no animation
//   - one owner with two PCs gets a switcher; mission null removes the button and closes an open card
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] PORT=9020 node checks/runtime/mission-card.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9020);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', P1 = 'p1@example.test', P2 = 'p2@example.test', P3 = 'p3@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = process.env.SHOTS || path.join(ROOT, 'gm-private', 'vv7-shots');
mkdirSync(SHOTS, { recursive: true });

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-vv7-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use: stop what is on it, or set PORT'); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM],
{ cwd: ROOT, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, detached: true, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
function killServer(sig = 'SIGTERM') { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(-server.pid, sig); } catch (_) {} }
process.on('exit', () => { killServer('SIGKILL'); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 300000);
const api = (method, p, user, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const patch = (body) => api('PATCH', '/campaign', GM, body).then((r) => { if (r.status !== 200) throw new Error('campaign PATCH ' + r.status + ' ' + JSON.stringify(r.json)); return r.json; });

// ---- the missions, built by VV1's engine from the invented Pelican Rooms ----
const B = require(path.join(ROOT, 'app', 'gm', 'ball.js'));
const ROOMS = ['Showroom', 'Cocktail lounge', 'Underground counting room', 'Security control room', 'Private card rooms', 'Luxury penthouse'];
const PLAY = JSON.parse(readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'pelican-play-v2.json'), 'utf8'));
PLAY.ways[0].pubName = '<b id="pwn">The Last Hand</b>';      // markup in a player-safe name: the card must show it as text
const CHECKED = B.checkPlay(PLAY, ROOMS);
const T = (hhmm) => B.minuteOf(hhmm, '21:00');
const IDA = 'char_vv7a', IDB = 'char_vv7b', IDC = 'char_vv7c', IDD = 'char_vv7d';
const PCS = [{ id: IDA, name: 'Mara', owner: P1 }, { id: IDB, name: 'Odo', owner: P2 }, { id: IDC, name: 'Ines', owner: P3 }, { id: IDD, name: 'Quill', owner: P3 }];
const baseState = () => ({
  crew: { [IDA]: { room: 'Security control room', disguise: 'guard', items: ['key'] }, [IDB]: { room: 'Showroom', disguise: 'cook', busy: T('23:30') }, [IDC]: { room: 'Showroom', disguise: 'guest' }, [IDD]: { room: 'Cocktail lounge', disguise: 'cook' } },
  heard: { A: { [IDA]: T('22:30') }, B: { [IDA]: T('21:45') } }, steps: { A: [false, false], B: [true, true] }, ways: { B: 'done' },
  told: { I1: 'crew', I2: [IDA], I3: [IDA], I4: [IDB] },
});
const state = (f) => { const s = baseState(); if (f) f(s); return s; };
const aDesperate = (s) => Object.assign(s.crew[IDA], { room: 'Underground counting room', disguise: 'guest' });
const bMoves = (s) => Object.assign(s.crew[IDB], { room: 'Cocktail lounge' });
const S0 = state();
const S1 = state((s) => { aDesperate(s); });                                   // A: desperate
const S2 = state((s) => { aDesperate(s); bMoves(s); });                        // B moves
const S4 = state((s) => { aDesperate(s); bMoves(s); s.told.I4 = [IDB, IDA]; }); // A learns I4
const S5 = state((s) => { Object.assign(s.crew[IDA], { room: 'Private card rooms', disguise: 'guard' }); bMoves(s); s.told.I4 = [IDB, IDA]; });   // A: risky
let seq = 0;
const build = (st, hhmm, pcs = PCS) => { const v = B.playerView(CHECKED.play, st, ROOMS); const m = B.missionFor(v, st, T(hhmm), pcs); m.seq = ++seq; return m; };
const publish = (st, hhmm, pcs) => { const m = build(st, hhmm, pcs); return patch({ mission: m }).then(() => m); };
const flat = (s) => s.replace(/\s+/g, ' ');

try {
  check(CHECKED.warnings.length === 0 && CHECKED.play && CHECKED.play.v === 2, 'the Pelican fixture checks clean as a v2 play block: ' + JSON.stringify(CHECKED.warnings));
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 90000, 300);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  for (const [id, user, name] of [[IDA, P1, 'Mara'], [IDB, P2, 'Odo'], [IDC, P3, 'Ines'], [IDD, P3, 'Quill']]) {
    const made = await api('PUT', '/characters/' + id, user, { name, playbook: 'hound', spec: { name, playbook: 'hound' }, sheet: { name }, play: {} });
    check(made.status === 200, 'a player files ' + name + ': ' + made.status);
  }
  await api('PUT', '/campaign', GM, { v: 1, session: { number: 1, startedAt: new Date().toISOString(), endedAt: null }, crew: {}, clocks: [], log: [] });

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(user, id, pollMs = 300) {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.addInitScript((ms) => { window.__B68_POLL_MS = ms; }, pollMs);
    const page = await ctx.newPage();
    const reqs = [];
    page.on('request', (r) => { if (/\/api\//.test(r.url())) reqs.push(r.method() + ' ' + new URL(r.url()).pathname); });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(user + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push(user + ' pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/#c/' + id);
    await page.waitForSelector('#dossier .ds-bar', { timeout: 30000 });
    return { page, ctx, reqs };
  }
  const btn = (pg) => pg.$$eval('.ds-missionbtn', (n) => n.map((b) => ({ text: b.textContent.trim(), dot: b.querySelectorAll('.ds-tdot').length, label: b.getAttribute('aria-label') })));
  const dot = async (pg) => { const b = await btn(pg); return b.length ? b[0].dot : -1; };
  const card = (pg) => pg.evaluate(() => {
    const v = document.querySelector('.ds-mv'); if (!v) return null;
    const txt = (s) => { const n = v.querySelector(s); return n ? n.textContent : ''; };
    const lead = Array.from(v.querySelectorAll('.ds-mv-lead')).map((l) => ({ text: l.textContent, done: l.classList.contains('done'), deco: getComputedStyle(l.querySelector('p')).textDecorationLine }));
    return { text: v.innerText, html: v.innerHTML, name: txt('.ds-mv-name'), room: txt('.ds-mv-room'), word: txt('.ds-mv-word'), warn: txt('.ds-mv-warn'), lead, pwn: v.querySelectorAll('#pwn, img, script, iframe, [onerror]').length, live: v.querySelectorAll('[aria-live]').length, sw: Array.from(v.querySelectorAll('.ds-mv-pc')).map((b) => b.textContent) };
  });
  const bg = (pg) => pg.$eval('.ds-mv-status', (e) => getComputedStyle(e).backgroundColor);

  // ---- no mission yet: no button ----
  const a = await open(P1, IDA), b = await open(P2, IDB);
  check((await btn(a.page)).length === 0 && (await btn(b.page)).length === 0, 'no mission in the document: no Mission button on either phone');

  // ---- the GM publishes (VV1's missionFor, through cleanMission): each owner gets a button with a dot ----
  const M0 = await publish(S0, '23:15');
  const CA = M0.cards[IDA], CB = M0.cards[IDB];
  check(CA.pos === 'controlled' && CB.pos === 'risky' && !!CA.warn && !!CA.leads.length && !!CA.paths.length && !!CA.know.length && !!CA.next.length && !!CB.busy, 'the engine gives the scenes the test needs: ' + JSON.stringify([CA.pos, CB.pos, CA.warn && CA.warn.who, CA.leads.length, CA.paths.length, CA.know.length, CB.busy]));
  const doc = await a.page.evaluate(async () => { const r = await fetch('/api/campaign'); return r.json(); });
  check(!!(doc.doc.mission && doc.doc.mission.cards[IDA] && doc.doc.mission.cards[IDB] && doc.doc.mission.seq === 1), 'the campaign document the phone receives holds both cards, as cleanMission stored them (so the filter is what is under test)');
  check(doc.doc.mission.cards[IDA].owner === P1 && doc.doc.mission.cards[IDB].owner === P2, 'each card names its owner');
  check(!!(await until(async () => (await dot(a.page)) === 1 && (await dot(b.page)) === 1, 8000, 100)), 'the Mission button appears on both phones, each with a dot');
  const order = await a.page.$eval('.ds-nav', (n) => Array.from(n.children).map((c) => c.textContent.trim()).filter((t) => /^(← Back|Table|Mission)/.test(t)).map((t) => t.split(' ')[t.startsWith('←') ? 1 : 0]));
  const barBtn = await a.page.$eval('.ds-bar .ds-nav .ds-missionbtn', (el) => { const r = el.getBoundingClientRect(); return { h: Math.round(r.height), right: Math.round(r.right), vw: innerWidth, sticky: getComputedStyle(el.closest('.ds-bar')).position }; });
  check(barBtn.right <= barBtn.vw && barBtn.vw === 390 && barBtn.h >= 36 && barBtn.sticky === 'sticky', 'the button is in the sticky bar, a phone-sized target, inside 390 px: ' + JSON.stringify(barBtn));
  check(order.join() === 'Back,Table,Mission', 'it sits beside Table (after Back): ' + order.join());
  check(await a.page.evaluate(() => document.documentElement.scrollWidth <= 390), 'no horizontal overflow on the sheet with the button in the bar');
  await a.page.screenshot({ path: path.join(SHOTS, 'vv7-sheet-bar-dot.png') });

  // ---- opening: only their own card ----
  await a.page.click('.ds-missionbtn');
  check(!!(await until(async () => (await card(a.page)) !== null, 4000, 50)), 'tapping Mission opens the card');
  let c = await card(a.page);
  check(c.name === 'Mara · Guard' && c.room === CA.room && c.word === 'Controlled', 'name and costume, the room and the pos word: ' + JSON.stringify([c.name, c.room, c.word]));
  check(!c.text.includes('Odo') && !c.text.includes('The rival moves') && !c.html.includes('Odo'), 'the card holds nothing of the other player\'s card');
  check(!(await a.page.evaluate(() => document.documentElement.outerHTML.includes('The rival moves') || document.documentElement.outerHTML.includes('Odo') || document.documentElement.outerHTML.includes('A shot in the card rooms'))), 'nothing of the other card is anywhere in the page\'s DOM');
  check(c.warn.includes(CA.warn.who) && c.warn.includes(CA.warn.look) && c.warn.includes('Sees through: ' + CA.warn.sees) && /Wren Tully is here/.test(c.warn), 'the warning band: who, look, what they see through: ' + c.warn);
  check(/Controlled in The floor, Back of house\./.test(c.text) && /Risky in The card rooms, The loft\. Anywhere else is desperate\./.test(c.text), 'the zone lists');
  check(c.lead.length === 2 && !c.lead[0].done && c.lead[1].done, 'leads: the open one first, the done one last: ' + JSON.stringify(c.lead.map((l) => [l.done, l.text.slice(0, 20)])));
  const L0 = CA.leads[0], L1 = CA.leads[1];
  check(!!(L0.next && L0.heard && L0.window) && c.lead[0].text.includes('<b id="pwn">The Last Hand</b>') && c.lead[0].text.includes(L0.line) && c.lead[0].text.includes('Heard ' + L0.heard) && c.lead[0].text.includes(L0.window) && c.lead[0].text.includes('Next: ' + L0.next), 'a lead: name, line, when and where heard, window, next step only: ' + JSON.stringify(c.lead[0].text));
  check(c.lead[1].deco === 'line-through' && c.lead[1].text.includes(L1.name) && !/Next:/.test(c.lead[1].text), 'the done lead is struck through and offers no next step');
  check(/A brass key/.test(c.text) && c.text.includes(CA.paths[0].text + ' · until ' + CA.paths[0].until) && CA.know.every((k) => c.text.includes(k)), 'items, paths (with until) and what she knows');
  const f = flat(c.text), nows = M0.hud.now, nexts = CA.next;
  check(nexts.length >= 1 && nexts.every((n) => f.includes('NEXT ' + n.text)) && (f.match(/NEXT /g) || []).length === nexts.length && nows.every((n) => f.includes('NOW ' + n.text)), 'NOW from the hud (' + nows.length + '), NEXT from the card (' + nexts.length + '): ' + JSON.stringify((f.match(/NEXT.*$/) || [''])[0]));
  check(c.pwn === 0 && (await a.page.evaluate(() => !window.__pwn)), 'markup in a name is shown as text, never run');
  check(c.live === 0, 'no live region: nothing announces itself');
  const type = await a.page.evaluate(() => {
    const px = (s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize);
    const prose = Array.from(document.querySelectorAll('.ds-mv-p')).map((p) => parseFloat(getComputedStyle(p).fontSize));
    const anim = Array.from(document.querySelectorAll('.ds-mv, .ds-mv *')).filter((e) => { const s = getComputedStyle(e); return s.animationName !== 'none' || parseFloat(s.transitionDuration) > 0; }).length;
    const v = document.querySelector('.ds-mv').getBoundingClientRect();
    return { word: px('.ds-mv-word'), minProse: Math.min(...prose), anim, w: v.width, h: v.height, pos: getComputedStyle(document.querySelector('.ds-mv')).position };
  });
  check(type.word === 28 && type.minProse >= 16, 'type: status 28 px, prose >= 16 px: ' + JSON.stringify([type.word, type.minProse]));
  check(type.anim === 0 && type.w === 390 && type.h === 844 && type.pos === 'fixed', 'full screen and no animation or transition: ' + JSON.stringify(type));
  check((await bg(a.page)) === 'rgb(31, 107, 52)', 'controlled is green');
  check((await dot(a.page)) === 0, 'the dot goes once she has opened it');
  await a.page.screenshot({ path: path.join(SHOTS, 'vv7-card-controlled.png') });
  await a.page.evaluate(() => { document.querySelector('.ds-mv-body').scrollTop = 99999; });
  await a.page.screenshot({ path: path.join(SHOTS, 'vv7-card-controlled-scrolled.png') });
  await a.page.evaluate(() => { document.querySelector('.ds-mv-body').scrollTop = 0; });

  // ---- the other player's phone: their own card only ----
  await b.page.click('.ds-missionbtn');
  await until(async () => (await card(b.page)) !== null, 4000, 50);
  const cb = await card(b.page);
  check(cb.name === 'Odo · Cook' && cb.word === 'Risky' && CB.know.length > 0 && CB.know.every((k) => cb.text.includes(k)) && !/Mara|brass key|Wren Tully/.test(cb.text), 'the second player sees only Odo\'s card: ' + JSON.stringify([cb.name, cb.word]));
  check(cb.warn === '' && cb.text.toLowerCase().includes('busy until ' + CB.busy), 'no warning band when warn is null; busy is shown: ' + CB.busy);
  check(!(await b.page.evaluate(() => document.documentElement.outerHTML.includes('Wren Tully') || document.documentElement.outerHTML.includes('Mara') || document.documentElement.outerHTML.includes('Odette plays cards'))), 'nothing of the first card is in the second page\'s DOM');
  check((await bg(b.page)) === 'rgb(242, 178, 51)', 'risky is amber');
  await b.page.screenshot({ path: path.join(SHOTS, 'vv7-card-risky.png') });
  await b.page.click('.ds-mv-x');

  // ---- idle: an open card makes no request of its own ----
  const idle0 = a.reqs.length; await sleep(1800);
  const idle = a.reqs.slice(idle0), kinds = [...new Set(idle)];
  check(kinds.every((r) => /^GET \/api\/(characters|campaign|npcs|me)$/.test(r)), 'idle with the card open: only the page\'s own poll (' + idle.length + ' requests: ' + kinds.join(', ') + ')');
  check(!idle.some((r) => /\/gm\/|mission|display/i.test(r)), 'and nothing that reads the GM state');

  // ---- live: a change to her card arrives within a poll, in place ----
  const t0 = Date.now();
  await publish(S1, '23:15');
  const moved = await until(async () => { const x = await card(a.page); return x && x.word === 'Desperate'; }, 6000, 50);
  const dt = Date.now() - t0;
  check(!!moved && dt < 2500, 'a change to her card redraws the open card within about a poll (' + dt + ' ms)');
  c = await card(a.page);
  check(c.warn === '' && c.room === 'Underground counting room' && (await bg(a.page)) === 'rgb(168, 32, 26)', 'warn cleared, the room follows, desperate is red');
  await a.page.screenshot({ path: path.join(SHOTS, 'vv7-card-desperate.png') });
  await a.page.click('.ds-mv-x');
  check(await a.page.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('ds-missionbtn')), 'closing returns focus to the Mission button');
  check((await dot(a.page)) === 0, 'a change seen while it was open leaves no dot behind');

  // ---- dots: only her own card's stable fields light it ----
  const M2 = await publish(S2, '23:15');
  await sleep(1500);
  check(JSON.stringify(M2.cards[IDA]) === JSON.stringify(build(S1, '23:15').cards[IDA]), 'the second publish changes the other card, not hers');
  check((await dot(a.page)) === 0, 'a change to the other player\'s card lights nothing on her phone');
  check((await dot(b.page)) === 1, 'but it lights theirs');
  const M3 = await publish(S2, '23:20');
  await sleep(1500);
  const strip = (x) => JSON.stringify(Object.assign({}, x, { next: x.next.map((n) => Object.assign({}, n, { inMin: 0 })) }));
  check(JSON.stringify(M3.cards[IDA].next.map((n) => n.inMin)) !== JSON.stringify(M2.cards[IDA].next.map((n) => n.inMin)) && strip(M3.cards[IDA]) === strip(M2.cards[IDA]) && M3.hud.time !== M2.hud.time, 'the third publish only moves the time: her countdowns (inMin) and the hud change, nothing else of her card');
  check((await dot(a.page)) === 0, 'a publish that only moves countdowns lights nothing');
  const M4 = await publish(S4, '23:20');
  check(!!(await until(async () => (await dot(a.page)) === 1, 6000, 100)), 'a change to her own card lights the dot');
  check((await btn(a.page))[0].label === 'Mission card, changed', 'and the button says so to a screen reader');
  await a.page.click('.ds-missionbtn');
  await until(async () => (await card(a.page)) !== null, 4000, 50);
  c = await card(a.page);
  check(M4.cards[IDA].know.length === CA.know.length + 1 && M4.cards[IDA].know.every((k) => c.text.includes(k)) && (await dot(a.page)) === 0, 'opening shows what she learned and clears the dot');
  await a.page.keyboard.press('Escape');
  check((await card(a.page)) === null, 'Esc closes the card');

  // ---- the poke: a phone polling once a minute still hears the campaign document within about 2 s ----
  const q = await open(P1, IDA, 60000);
  check(!!(await until(() => q.page.evaluate(() => !!window.B68Live && window.B68Live.state().open), 15000, 100)), 'the live socket of the phone is open');
  await until(async () => (await btn(q.page)).length === 1, 6000, 100);
  await q.page.click('.ds-missionbtn'); await until(async () => (await card(q.page)) !== null, 4000, 50);
  const t1 = Date.now();
  const M5 = await publish(S5, '23:20');
  const poked = await until(async () => { const x = await card(q.page); return x && x.word === 'Risky' && x.room === 'Private card rooms'; }, 5000, 50);
  check(M5.cards[IDA].pos === 'risky' && !!poked && Date.now() - t1 < 3000, 'with the poll a minute away, the poke redraws the card (' + (Date.now() - t1) + ' ms)');
  check(await q.page.evaluate(() => window.B68Live.state().pokes.indexOf('campaign') >= 0), 'and the socket did hear a campaign poke');
  await q.ctx.close();

  // ---- mission null: the button goes, an open card closes ----
  await a.page.click('.ds-missionbtn'); await until(async () => (await card(a.page)) !== null, 4000, 50);
  await patch({ mission: null });
  check(!!(await until(async () => (await card(a.page)) === null && (await btn(a.page)).length === 0, 6000, 100)), 'mission null: the open card closes and the button goes');
  check(!!(await until(async () => (await btn(b.page)).length === 0, 4000, 100)), 'and the other phone loses its button too');

  // ---- a mission with no card for her PC: no button ----
  await publish(S5, '23:20', PCS);
  await until(async () => (await btn(a.page)).length === 1, 6000, 100);
  await publish(S5, '23:20', PCS.filter((p) => p.id !== IDA));
  check(!!(await until(async () => (await btn(a.page)).length === 0, 6000, 100)), 'a mission with no card for her PC: no button');
  check((await btn(b.page)).length === 1, 'while the player who still has a card keeps theirs');

  // ---- a card that names another owner is never shown, whoever the roster says ----
  const odd = build(S5, '23:20'); odd.cards[IDA].owner = P2;
  await patch({ mission: odd });
  await sleep(1500);
  check((await btn(a.page)).length === 0, 'a card whose owner is someone else is not shown to the roster\'s owner');

  // ---- one owner, two PCs: a switcher ----
  await publish(S5, '23:20', PCS);
  const d = await open(P3, IDC);
  check(!!(await until(async () => (await btn(d.page)).length === 1, 8000, 100)), 'two PCs, one owner: one Mission button');
  await d.page.click('.ds-missionbtn'); await until(async () => (await card(d.page)) !== null, 4000, 50);
  c = await card(d.page);
  check(c.sw.length === 2 && c.sw.some((s) => /Ines/.test(s)) && c.sw.some((s) => /Quill/.test(s)), 'the switcher offers both: ' + JSON.stringify(c.sw));
  check(c.name === 'Ines · Guest', 'it opens on this sheet\'s character: ' + c.name);
  check(!(await d.page.evaluate(() => document.documentElement.outerHTML.includes('Odo') || document.documentElement.outerHTML.includes('Mara'))), 'and never holds another owner\'s card (Mara, Odo)');
  const pill = await d.page.$$eval('.ds-mv-pc', (bs) => bs.map((x) => { const s = getComputedStyle(x); return { sel: x.getAttribute('aria-pressed'), color: s.color, bg: s.backgroundColor, weight: s.fontWeight }; }));
  const lum = (rgb) => { const v = rgb.match(/\d+/g).slice(0, 3).map((n) => { n = n / 255; return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (p, under) => { const l1 = lum(p.color), l2 = lum(under || p.bg); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const on = pill.find((p) => p.sel === 'true'), off = pill.find((p) => p.sel === 'false');
  check(ratio(on) >= 4.5 && ratio(off, 'rgb(11, 10, 9)') >= 4.5 && Number(on.weight) > Number(off.weight), 'the switcher pills read at 4.5:1 or better in both states, and the selected one is also bolder: ' + JSON.stringify([ratio(on).toFixed(1), ratio(off, 'rgb(11, 10, 9)').toFixed(1), on.weight, off.weight]));
  check(await d.page.$eval('.ds-status', (s) => getComputedStyle(s).display === 'none'), 'the sheet bar\'s status text is hidden where it would be a clipped sliver');
  await d.page.screenshot({ path: path.join(SHOTS, 'vv7-card-switcher.png') });
  await d.page.click('.ds-mv-pc[data-pc="' + IDD + '"]');
  c = await card(d.page);
  check(c.name === 'Quill · Cook' && c.room === 'Cocktail lounge', 'tapping the other switches the card: ' + c.name);
  check(JSON.stringify(await d.page.$$eval('.ds-mv-pc', (bs) => bs.map((x) => [x.dataset.pc, x.getAttribute('aria-pressed')]).sort())) === JSON.stringify([[IDC, 'false'], [IDD, 'true']]), 'and aria-pressed follows');
  await d.ctx.close();

  await a.ctx.close(); await b.ctx.close();
  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
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
