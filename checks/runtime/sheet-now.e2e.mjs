// The phone's Now card, Quiet button and Between sessions fold (the night rebuild, N6; design 7) in a real browser against a local Worker (wrangler dev,
// DEV_USER, X-Dev-User per context) on PORT (default 9170). A player's phone is 390 x 844, touch; a second pass at 375 x 667. INVENTED data only.
//   1. Nothing due: no card and no gap; the fold says "1 inside" (the board) and is closed; Quiet is in the sticky bar (44 px), Print is in "…".
//   2. Quiet: the button opens the four (X-card, pause, spotlight me, a secret note); the note box is 16 px; a note reaches the store as the player's own
//      quiet row; Esc closes; a long press on the header still opens it, and lifting the finger (mouse and touch) leaves it open.
//   3. Commendations: the Now card while the row stands, a countdown written in place; it opens the End of session panel.
//   4. Several due at once: commendations first, "+4 more" lists the rest in order; taking the row down moves the Debrief up.
//   5. The packet (Read it -> the fold, kept over a reload), the Debrief (a reply -> the fold), the key (turned from the card), the mission card.
//   6. The board from the fold (16 px field); a read-only frame and the GM see none of it; claims and the key cabinet still render.
//   PW_MODULE=<playwright> PW_CHANNEL=msedge PORT=9170 node checks/runtime/sheet-now.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9170);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', P1 = 'player1@example.test', ID = 'char_now1';
const SHOTS = process.env.NOW_SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-now-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.ANTHROPIC_API_KEY;
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use: stop what is on it, or set PORT'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
function killServer() { if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', () => { killServer(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 600000);
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const must = async (p, what) => { const r = await p; if (r.status !== 200) throw new Error(what + ' -> ' + r.status + ' ' + JSON.stringify(r.json)); return r; };
const charDoc = (j) => (!j || typeof j !== 'object') ? null : (j.doc && typeof j.doc === 'object') ? j.doc : j;

const D = require(path.join(ROOT, 'app', 'gm', 'debrief.js'));
const B = require(path.join(ROOT, 'app', 'gm', 'ball.js'));
const ROOMS = ['Showroom', 'Cocktail lounge', 'Underground counting room', 'Security control room', 'Private card rooms', 'Luxury penthouse'];
const CHECKED = B.checkPlay(JSON.parse(readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'pelican-play-v2.json'), 'utf8')), ROOMS);
let seq = 0;
function mission(room) {
  const st = { crew: { [ID]: { room, disguise: 'guest' } }, heard: {}, steps: {}, ways: {}, told: {} };
  const v = B.playerView(CHECKED.play, st, ROOMS, { rooms: {} });
  const m = B.missionFor(v, st, B.minuteOf('22:15', '21:00'), [{ id: ID, name: 'Nell Arbuthnot', owner: P1 }]); m.seq = ++seq; return m;
}
const PLAY = (hits) => ({ stress: 4, keys: [{ name: 'KEY-1', down: 'Walk away', up: 'Burn it down', hits }, { name: 'KEY-2', down: 'Cut them off', up: 'Bring them in', hits: 1 }] });
const PACKET = () => ({ v: 1, at: Date.now(), front: { masthead: 'The Pelican Post', issue: 'No. 12', date: 'Thursday', headline: 'Lights out at the Pelican Rooms', standfirst: 'A power cut and a missing ledger.', account: ['The lights went out at a quarter past eleven.'], name: '', hook: '' },
  previously: { faces: [{ name: 'Mabel Quist', role: 'Fixer' }], lines: ['The crew took the job from Mabel.', 'Ray talked his way past the door.', 'Tam found the second set of books.'] }, changes: ['Stress 2 to 5'] });

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  await must(api('PUT', '/campaign', { v: 1, session: { number: 3, startedAt: new Date().toISOString(), endedAt: null }, crew: { name: 'The Dovetail Crew', playbook: 'shadows', claims: { informants: true }, factions: [], cohorts: [] }, clocks: [], log: [] }), 'the table');
  /* the phone switches on (before the night rebuild every feature is on, a stored switch is how; after it this changes nothing) */
  await must(api('PATCH', '/campaign', { features: { 'spine.keyturn': true, 'between.keys': true, 'spine.aftermath': true, 'spine.debrief': true, 'between.quiet': true, 'between.board': true, 'between.claims': true, 'between.absent': true } }), 'the phone switches');
  await must(api('PUT', '/characters/' + ID, { name: 'Nell Arbuthnot', playbook: 'hound', spec: { name: 'Nell Arbuthnot', playbook: 'hound' }, sheet: { name: 'Nell Arbuthnot' }, play: PLAY(2) }, P1), 'Nell');

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(user, route, { w = 390, h = 844, mobile = true } = {}) {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    /* both polls fast: with the live socket healthy the page polls every 15 s (runtime/cf.js), so a missed poke would leave a step waiting a poll */
    await ctx.addInitScript(() => { window.__B68_POLL_MS = 500; window.__B68_HEALTHY_POLL_MS = 500; });
    const page = await ctx.newPage();
    /* WebKit reports the Worker's report-only Content Security Policy header as console errors: those notes are about the headers, not the page */
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|Content Security Policy/.test(m.text())) errors.push(user + ' ' + route + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push(user + ' ' + route + ' pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/' + route);
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    return { ctx, page };
  }
  const shot = async (pg, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await pg.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
  const started = (pg) => until(() => pg.evaluate(() => ['B68Commend', 'B68Debrief', 'B68Absent', 'B68Board', 'B68Quiet'].every((k) => window[k] && window[k].state().started)), 20000, 100);
  const nowOf = (pg) => pg.evaluate(() => {
    const c = document.querySelector('#dossier .ds-now');
    if (!c) return null;
    const more = c.querySelector('.ds-now-more');
    const r = c.querySelector('.ds-band .ds-band-r');   /* textContent, not innerText: the band is set in capitals by CSS */
    return { items: Array.from(c.querySelectorAll('.ds-now-item')).map((e) => e.dataset.now), band: c.querySelector('.ds-band .ds-bt').textContent, of: r ? r.textContent : '', more: more ? { text: more.querySelector('span').textContent, exp: more.getAttribute('aria-expanded') } : null };
  });
  const foldOf = (pg) => pg.evaluate(() => {
    const f = document.querySelector('#dossier .ds-betweenbox'); if (!f) return null;
    const t = f.querySelector('.ds-between-t');
    return { n: (f.querySelector('.ds-between-n') || {}).textContent, exp: t.getAttribute('aria-expanded'), items: Array.from(f.querySelectorAll('.ds-now-item')).map((e) => e.dataset.now), last: !f.nextElementSibling, h: Math.round(t.getBoundingClientRect().height) };
  });
  const quietOpen = (pg) => pg.evaluate(() => !!document.querySelector('.ds-quiet-dlg'));
  /* a new mission card opens by itself, as it always has: wait for it, then close it until it stays closed (a second arrival of the same card can
     open it again straight after the ×) */
  const closeCard = async (pg) => {
    await pg.waitForSelector('.ds-mv', { timeout: 10000 }).catch(() => null);
    for (let i = 0; i < 8; i++) {
      if (await pg.$('.ds-mv')) { await pg.click('.ds-mv-x').catch(() => {}); await sleep(300); continue; }
      await sleep(500);
      if (!(await pg.$('.ds-mv'))) return true;
    }
    return !(await pg.$('.ds-mv'));
  };

  /* ---------- 1. nothing due ---------- */
  const A = await open(P1, '#c/' + ID), a = A.page;
  await a.waitForSelector('#dossier .ds-bar', { timeout: 30000 });
  check(!!(await started(a)), 'the phone modules are started (the switches are on)');
  await sleep(800);
  check((await nowOf(a)) === null, 'nothing due: no Now card');
  const gap = await a.evaluate(() => { const ab = document.querySelector('#dossier .ds-about-t'), next = document.querySelector('#dossier .ds-tablebar') || document.querySelector('#dossier .ds-grid'); return Math.round(next.getBoundingClientRect().top - ab.getBoundingClientRect().bottom); });
  check(gap >= 12 && gap <= 16, 'and no gap: the table bar sits where it always did under About (' + gap + ' px)');
  let f = await foldOf(a);
  check(!!f && f.n === '1 inside' && f.exp === 'false' && f.items.length === 0 && f.last, 'the Between fold is the sheet\'s last box, closed, "1 inside" (the board): ' + JSON.stringify(f));
  check(f && f.h >= 44, 'its toggle is 44 px to tap (' + (f && f.h) + ')');
  const bar = await a.evaluate(() => {
    const q = document.querySelector('#dossier .ds-bar .ds-quietbtn'), r = q && q.getBoundingClientRect(), pr = document.querySelector('#dossier .ds-nav > [data-act="print"]');
    return { q: !!q, h: r ? Math.round(r.height) : 0, right: r ? Math.round(r.right) : 0, label: q ? q.textContent : '', sticky: q ? getComputedStyle(q.closest('.ds-bar')).position : '', printShown: !!(pr && pr.offsetParent), status: (document.querySelector('#dossier .ds-status') || {}).offsetWidth || 0, sw: document.documentElement.scrollWidth };
  });
  check(bar.q && bar.label === 'Quiet' && bar.h >= 44 && bar.right <= 390 && bar.sticky === 'sticky', 'Quiet is in the sticky bar, 44 px or taller, inside the screen: ' + JSON.stringify(bar));
  check(!bar.printShown && bar.status > 30 && bar.sw <= 390, 'on a phone Print leaves the bar, so the save status has room and nothing overflows: ' + JSON.stringify(bar));
  await a.click('#dossier .ds-morebtn');
  check(!!(await a.$('#dossier .ds-menu [data-act="print"]:visible')), 'Print is a line of "…"');
  await a.click('#dossier .ds-morebtn');
  await shot(a, 'nothing-due');

  /* ---------- 2. Quiet ---------- */
  await a.click('#dossier .ds-quietbtn');
  check(!!(await until(() => quietOpen(a), 3000)), 'Quiet opens the quiet line');
  const menu = await a.evaluate(() => { const d = document.querySelector('.ds-quiet-dlg'); return { opts: Array.from(d.querySelectorAll('.ds-quiet-opts button')).map((b) => b.textContent), cancel: !!Array.from(d.querySelectorAll('button')).find((b) => b.textContent === 'Cancel'), focus: document.activeElement && document.activeElement.textContent, modal: d.getAttribute('aria-modal'), hs: Array.from(d.querySelectorAll('button')).filter((b) => !b.hidden).map((b) => Math.round(b.getBoundingClientRect().height)) }; });
  check(JSON.stringify(menu.opts) === JSON.stringify(['X-card', 'Pause', 'Spotlight me', 'Secret note']) && menu.cancel && menu.modal === 'true', 'the same four as the long press, and Cancel: ' + JSON.stringify(menu.opts));
  check(menu.focus === 'X-card' && menu.hs.every((x) => x >= 44), 'focus moves into it, and every button is 44 px or taller: ' + JSON.stringify(menu.hs));
  await a.click('.ds-quiet-dlg button:has-text("Secret note")');
  const fs = await a.$eval('.ds-quiet-note', (t) => ({ px: parseFloat(getComputedStyle(t).fontSize), shown: !t.hidden, focus: document.activeElement === t }));
  check(fs.shown && fs.px >= 16 && fs.focus, 'the secret note box is 16 px (iPhone Safari does not zoom) and takes focus: ' + JSON.stringify(fs));
  await shot(a, 'quiet-note');
  await a.fill('.ds-quiet-note', 'Can we skip the dentist scene');
  await a.click('.ds-quiet-dlg button:has-text("Send the note")');
  check(!!(await until(() => a.evaluate(() => /Sent quietly/.test((document.querySelector('.ds-quiet-dlg .ds-dlg-msg') || {}).textContent || '')), 4000)), 'it says "Sent quietly."');
  check(!!(await until(async () => !(await quietOpen(a)), 4000)), 'and closes by itself');
  const qrow = await api('GET', '/docs?kind=quiet&owner=' + encodeURIComponent(P1));
  const qi = qrow.json && qrow.json.docs && qrow.json.docs[0] && qrow.json.docs[0].json.items;
  check(Array.isArray(qi) && qi.some((x) => x.k === 'note' && x.text === 'Can we skip the dentist scene') && qrow.json.docs[0].scope === 'player', 'the GM reads it: the player\'s own quiet row, scope player');
  check(await a.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('ds-quietbtn')), 'focus is back on Quiet');
  await a.click('#dossier .ds-quietbtn'); await until(() => quietOpen(a), 3000);
  await a.keyboard.press('Escape');
  check(!(await quietOpen(a)), 'Esc closes it');
  /* the long press still works, with a mouse and with a finger; lifting does not close it */
  const nm = await a.$eval('#dossier .ds-name', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
  await a.mouse.move(nm.x, nm.y); await a.mouse.down(); await sleep(800);
  check(await quietOpen(a), 'a long press (800 ms) on the header opens it');
  await a.mouse.up(); await sleep(500);
  check(await quietOpen(a), 'lifting the button leaves it open');
  await a.click('.ds-quiet-dlg button:has-text("Cancel")');
  /* a finger: raw touch events through the DevTools protocol (Chromium; the WebKit pass has no such session, and says so) */
  const cdp = await A.ctx.newCDPSession(a).catch(() => null);
  if (cdp) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: nm.x, y: nm.y }] }); await sleep(800);
    check(await quietOpen(a), 'a long press with a finger opens it');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await sleep(600);
    check(await quietOpen(a), 'and lifting the finger leaves it open (the lift-off neither closes it nor taps what is under it)');
    check((await api('GET', '/docs?kind=quiet&owner=' + encodeURIComponent(P1))).json.docs[0].json.items.length === qi.length, 'nothing was sent by the lift-off');
    await shot(a, 'quiet-menu');
    await a.click('.ds-quiet-dlg button:has-text("Cancel")');
  } else console.log('SKIP the finger long press: this engine has no DevTools touch input (the mouse long press above is the same code path)');

  /* ---------- 3. the commendations ---------- */
  await must(api('PUT', '/docs', { kind: 'commend', owner: '_', scope: 'public', json: { v: 1, secs: 90, until: Date.now() + 90000 } }), 'commend');
  check(!!(await until(async () => { const n = await nowOf(a); return n && n.items[0] === 'commend'; }, 15000)), 'step 7: the Now card has the commendations (within a poll or a poke)');
  let n = await nowOf(a);
  check(n.band === 'Now · the Aftermath' && n.of === '' && n.more === null && n.items.length === 1, 'one card, no "+n more": ' + JSON.stringify(n));
  const t1 = await a.$eval('.ds-now [data-ends]', (e) => { window.__nowLeft = e; return e.textContent; });
  await sleep(1300);
  const t2 = await a.evaluate(() => ({ same: document.querySelector('.ds-now [data-ends]') === window.__nowLeft, text: window.__nowLeft.textContent }));
  check(/^Closes in (1:[0-3]|0:[0-5])\d$/.test(t1) && t2.same && t2.text !== t1 && /^Closes in \d:\d\d$/.test(t2.text), 'the countdown is written in place, not redrawn: ' + t1 + ' -> ' + t2.text);
  await shot(a, 'now-commend');
  await a.click('.ds-now .ds-commend [data-act="endopen"]');
  check(!!(await until(() => a.evaluate(() => !!document.querySelector('#dossier .ds-endp')), 4000)), 'Open the xp triggers opens the sheet\'s own End of session panel');
  await a.click('#dossier .ds-endp [data-act="panelclose"]');

  /* ---------- 4. several due at once ---------- */
  await must(api('PUT', '/characters/' + ID, { name: 'Nell Arbuthnot', playbook: 'hound', spec: { name: 'Nell Arbuthnot', playbook: 'hound' }, sheet: { name: 'Nell Arbuthnot' }, play: PLAY(3) }, P1), 'three hits');
  const night = Date.now() - 30 * 3600 * 1000;
  await must(api('PUT', '/docs', { kind: 'debrief', owner: P1, scope: 'player', json: D.buildRow({ steps: ['unwind', 'xp', 'credits'], nightAt: night, sentAt: night }) }), 'debrief');
  await must(api('PUT', '/docs', { kind: 'packet', owner: P1, scope: 'player', json: PACKET() }), 'packet');
  await must(api('PATCH', '/campaign', { mission: mission('Cocktail lounge') }), 'mission');
  check(!!(await until(async () => { const x = await nowOf(a); return x && x.more && /^\+4 more/.test(x.more.text); }, 20000)), 'five due at once');
  check(await closeCard(a), 'the new mission card opened by itself, as it always has, and closes');
  n = await nowOf(a);
  check(JSON.stringify(n.items) === '["commend"]' && n.more && n.more.text === '+4 more: Debrief · your packet · a key to turn · Mission' && n.more.exp === 'false', 'the commendations first, the rest behind "+4 more", by name and in order: ' + JSON.stringify(n));
  await shot(a, 'now-two-due');
  await a.click('.ds-now-more');
  n = await nowOf(a);
  check(JSON.stringify(n.items) === '["commend","debrief","absent","keys","mission"]' && n.more.exp === 'true' && n.more.text === 'Show less', '+4 more opens the rest, in order: ' + JSON.stringify(n.items));
  check(await a.evaluate(() => document.activeElement && document.activeElement.classList.contains('ds-now-more')), 'and keeps focus on its toggle');
  await shot(a, 'now-more-open');
  await a.click('.ds-now-more');
  check(JSON.stringify((await nowOf(a)).items) === '["commend"]', 'Show less folds them again');
  await must(api('DELETE', '/docs?kind=commend&owner=_'), 'commend down');
  check(!!(await until(async () => { const x = await nowOf(a); return x && x.items[0] === 'debrief' && x.band === 'Now · the morning after'; }, 25000)), 'the GM moves on: the Debrief is the card now');

  /* ---------- 5. the packet, the Debrief, the key, the mission ---------- */
  await a.click('.ds-now-more');
  await a.click('.ds-now .ds-absent [data-b68="absent-open"]');
  check(!!(await until(() => a.evaluate(() => !!document.querySelector('.ds-absent-dlg')), 4000)), 'Read it opens the packet');
  check(await a.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('ds-absent-card')), 'focus moves to the top of the page, so it reads from the start');
  await a.keyboard.press('Escape');
  check(!(await a.$('.ds-absent-dlg')), 'Esc closes it');
  n = await nowOf(a); f = await foldOf(a);
  check(!n.items.includes('absent') && f.n === '2 inside', 'opened, the packet leaves the Now card for the fold: ' + JSON.stringify([n.items, f.n]));
  await a.click('.ds-now .ds-debrief [data-b68="debrief-open"]');
  await a.waitForSelector('.ds-debrief-dlg', { timeout: 4000 });
  check(await a.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('ds-debrief-card')), 'the Debrief takes focus at its top, not on its pick (no picker pops up on an iPhone)');
  const px = await a.$$eval('.ds-debrief-dlg input[type="text"], .ds-debrief-dlg select', (l) => l.map((e) => parseFloat(getComputedStyle(e).fontSize)));
  check(px.length >= 4 && px.every((x) => x >= 16), 'every Debrief field is 16 px: ' + JSON.stringify(px));
  await a.fill('.ds-debrief-dlg input[placeholder^="What are you doing"]', 'Back to the gym');
  await a.click('.ds-debrief-dlg button:has-text("Send")');
  check(!!(await until(async () => { const r = await api('GET', '/docs?kind=debrief&owner=' + encodeURIComponent(P1)); return r.json.docs[0] && r.json.docs[0].json.reply; }, 6000)), 'the reply is in the player\'s own Debrief row');
  check(!!(await until(async () => { const x = await nowOf(a); const y = await foldOf(a); return x && !x.items.includes('debrief') && y.n === '3 inside'; }, 6000)), 'answered, the Debrief leaves the Now card for the fold');
  n = await nowOf(a);
  check(n.items[0] === 'keys', 'the key is the card now: ' + JSON.stringify(n.items));
  await a.click('.ds-now .ds-keyturn [data-act="kturn"][data-dir="down"]');
  const turned = await until(async () => { const d = charDoc((await api('GET', '/characters/' + ID)).json); return d && d.play && d.play.keys[0].deadlock === 'down' ? d : null; }, 8000);
  check(!!turned && turned.play.stress === 0 && !!turned.play.autoCrit, 'turning it from the card deadlocks the key, clears Stress and owes a critical');
  check(!!(await until(async () => { const x = await nowOf(a); return x && x.items[0] === 'mission' && x.band === 'Now · the score'; }, 6000)), 'the mission card is what is left');
  check((await a.$eval('.ds-now .ds-now-line', (e) => e.textContent)) === 'You are in Cocktail lounge.', 'it says where she is');
  await a.click('.ds-now [data-act="missionscreen"]');
  check(!!(await until(() => a.evaluate(() => !!document.querySelector('.ds-mv')), 4000)), 'and opens the mission card');
  await a.click('.ds-mv-x');
  check(!!(await a.$('#dossier .ds-keybox .ds-kcard')), 'the key cabinet is still in the Keys box');
  await a.reload(); await a.waitForSelector('#dossier .ds-bar', { timeout: 30000 }); await started(a); await sleep(1500);
  if (await a.$('.ds-mv')) await a.click('.ds-mv-x');
  f = await foldOf(a); n = await nowOf(a);
  check(f && f.n === '3 inside' && n && !n.items.includes('absent'), 'after a reload the opened packet stays in the fold: ' + JSON.stringify([f && f.n, n && n.items]));

  /* ---------- 6. the fold, the board, and who sees none of it ---------- */
  await a.click('.ds-between-t');
  f = await foldOf(a);
  check(f.exp === 'true' && JSON.stringify(f.items) === '["board","absent","debrief"]', 'the fold opens: the board, then the packet, then the Debrief: ' + JSON.stringify(f.items));
  await a.evaluate(() => { const b = document.querySelector('.ds-betweenbox'); const r = b.getBoundingClientRect(); window.scrollBy(0, r.bottom - innerHeight + 16); });
  await shot(a, 'between-open');
  await a.click('.ds-betweenbox [data-b68="board-open"]');
  await a.waitForSelector('.ds-board-dlg', { timeout: 4000 });
  check((await a.$eval('.ds-board-dlg input[type="text"]', (e) => parseFloat(getComputedStyle(e).fontSize))) >= 16, 'the board\'s field is 16 px');
  check(await a.evaluate(() => !!document.activeElement && document.activeElement.classList.contains('ds-board-card')), 'focus moves to the form\'s top, never a field (on an iPhone a focused select opens its picker)');
  await a.fill('.ds-board-dlg input[type="text"]', 'A fixer wants a ledger fetched');
  await a.click('.ds-board-dlg button:has-text("Post it")');
  check(!!(await until(async () => { const r = await api('GET', '/docs?kind=opportunity&owner=' + encodeURIComponent(P1)); return r.json.docs[0] && r.json.docs[0].json.items.length === 1; }, 6000)), 'a post is the player\'s own opportunity row');
  await a.click('.ds-board-dlg button:has-text("Close")');
  check(/^1 posted/.test(await a.$eval('.ds-betweenbox .ds-board .ds-now-line', (e) => e.textContent)), 'the fold\'s line counts it');
  check(await a.evaluate(() => document.documentElement.scrollWidth <= 390), 'no horizontal overflow at 390');

  const R = await open(GM, '?ro=1#c/' + ID);
  await R.page.waitForSelector('#dossier .ds-head', { timeout: 30000 }); await sleep(2500);
  const ro = await R.page.evaluate(() => ({ ro: document.getElementById('dossier').classList.contains('ds-ro'), now: !!document.querySelector('#dossier .ds-now'), fold: !!document.querySelector('#dossier .ds-betweenbox'), quiet: !!document.querySelector('#dossier .ds-quietbtn'), print: !!(document.querySelector('#dossier .ds-nav > [data-act="print"]') || {}).offsetParent }));
  check(ro.ro && !ro.now && !ro.fold && !ro.quiet && ro.print, 'a read-only frame (the GM\'s drawer): the sheet, its Print, and no Now card, fold or Quiet: ' + JSON.stringify(ro));
  const rn = await R.page.$eval('#dossier .ds-name', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
  await R.page.mouse.move(rn.x, rn.y); await R.page.mouse.down(); await sleep(800); await R.page.mouse.up();
  check(!(await quietOpen(R.page)), 'and a long press on its header opens nothing');
  await R.ctx.close();
  const G = await open(GM, '#c/' + ID);
  await G.page.waitForSelector('#dossier .ds-head', { timeout: 30000 }); await sleep(2500);
  check(await G.page.evaluate(() => !document.querySelector('#dossier .ds-now') && !document.querySelector('#dossier .ds-betweenbox') && !document.querySelector('#dossier .ds-quietbtn')), 'the GM opening a sheet sees none of the player\'s own prompts');
  const gn = await G.page.$eval('#dossier .ds-name', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2 }; });
  await G.page.mouse.move(gn.x, gn.y); await G.page.mouse.down(); await sleep(800); await G.page.mouse.up();
  check(!(await quietOpen(G.page)), 'and a long press opens no quiet line for the GM');
  await G.ctx.close();
  await a.goto(BASE + '/#t');
  check(!!(await until(() => a.evaluate(() => !!document.querySelector('.b68-ct')), 15000)), 'claims stay on the crew sheet (the claim track)');

  /* ---------- the small phone ---------- */
  const S = await open(P1, '#c/' + ID, { w: 375, h: 667 });
  await S.page.waitForSelector('#dossier .ds-bar', { timeout: 30000 }); await started(S.page);
  await must(api('PUT', '/docs', { kind: 'commend', owner: '_', scope: 'public', json: { v: 1, secs: 90, until: Date.now() + 90000 } }), 'commend again');
  await must(api('PATCH', '/campaign', { mission: mission('Showroom') }), 'mission again');
  check(!!(await until(async () => { const x = await nowOf(S.page); return x && x.items[0] === 'commend' && x.more && /Mission/.test(x.more.text); }, 15000)), 'at 375 px: the commendations, with the mission behind "+n more"');
  check(await closeCard(S.page), 'the mission card that opened by itself is closed, and stays closed');
  await S.page.click('.ds-now-more');
  const small = await S.page.evaluate(() => {
    const kids = Array.from(document.querySelectorAll('#dossier .ds-nav > *')).filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { t: (e.textContent || '').trim().slice(0, 8), l: Math.round(r.left), r: Math.round(r.right), top: Math.round(r.top + r.height / 2) }; });
    const byLeft = kids.slice().sort((x, y) => x.l - y.l), q = byLeft[byLeft.length - 1], before = byLeft[byLeft.length - 2];
    return { sw: document.documentElement.scrollWidth, tops: new Set(kids.map((k) => k.top)).size, free: q && before ? q.l - before.r : 0, kids: kids.map((k) => k.t + '@' + k.l + '-' + k.r + '/' + k.top).join(' '), now: Array.from(document.querySelectorAll('.ds-now .ds-now-item')).map((e) => e.dataset.now) };
  });
  check(small.sw <= 375 && small.tops === 1 && small.free >= 8, 'at 375 px with Mission and Quiet in the bar: one row with room to spare, nothing overflows: ' + JSON.stringify(small));
  await shot(S.page, 'small-phone');
  await S.ctx.close();

  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e) + '\n' + serverLog.slice(-1500));
} finally {
  clearTimeout(timeout);
  killServer();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
