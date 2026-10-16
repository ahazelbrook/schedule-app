// Schedule end-to-end against a real local server (wrangler dev on PORT, default 8791): the GM seeds two dates
// through the API, a player answers in the grid, the GM confirms a date in the page, the player RSVPs on the card,
// and the server holds each change (the player's writes pass the API's own-keys rule). No console errors.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node checks/runtime/schedule.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
const WIN = process.platform === 'win32';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'), PORT = Number(process.env.PORT || 8791), BASE = 'http://127.0.0.1:' + PORT;
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-int-'));
const server = spawn(path.join(ROOT, 'node_modules', '.bin', 'wrangler'), ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false', '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:gm@example.test', '--var', 'GM_EMAILS:gm@example.test'], { cwd: ROOT, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, detached: !WIN, shell: WIN, stdio: 'ignore' });
process.on('exit', () => { try { WIN ? spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }) : process.kill(-server.pid, 'SIGKILL'); } catch (_) {} try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
let fails = 0; const check = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const api = (method, p, user, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE + '/index.html'); if (r.ok) break; } catch (_) {} await sleep(300); }
const at1 = new Date(Date.now() + 5 * 864e5).toISOString(), at2 = new Date(Date.now() + 12 * 864e5).toISOString();
let r = await api('PATCH', '/campaign', 'gm@example.test', { schedule: { options: { o_a: { at: at1, minutes: 240, note: '' }, o_b: { at: at2, minutes: 240, note: '' } } } });
check(r.status === 200, 'GM seeds two options via API');
const b = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
async function page(user) {
  const ctx = await b.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width: 390, height: 900 } });
  const p = await ctx.newPage(); const errs = []; p.on('dialog', (d) => d.accept());
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE + '/#t'); await p.waitForSelector('.sc-cell[data-act="sched.cycle"]', { timeout: 20000 });
  return { p, errs };
}
const P1 = await page('p1@example.test');
await P1.p.click('.sc-cell[data-act="sched.cycle"][data-o="o_a"]');
await sleep(2500);
r = await api('GET', '/campaign', 'gm@example.test');
check(r.json.doc.schedule.avail?.['p1@example.test']?.o_a === 'yes', 'player answer lands on server: ' + JSON.stringify(r.json.doc.schedule.avail));
check(!(await P1.p.textContent('#table-page')).includes('Could not save'), 'no save error on player page');
const GM = await page('gm@example.test');
await GM.p.click('[data-act="sched.confirm"][data-o="o_a"]').catch(async () => { await GM.p.click('[data-act="sched.confirm"]'); });
await sleep(2500);
r = await api('GET', '/campaign', 'gm@example.test');
check(r.json.doc.schedule.next && r.json.doc.schedule.next.at === at1, 'GM confirm sets next: ' + JSON.stringify(r.json.doc.schedule.next));
await P1.p.waitForSelector('[data-nx="in"]:not([disabled])', { timeout: 15000, state: 'attached' }).catch(() => {});
const tog = await P1.p.$('[data-nx="toggle"]'); if (tog && (await tog.getAttribute('aria-expanded')) === 'false') await tog.click();
await P1.p.click('[data-nx="in"]');
await sleep(2500);
r = await api('GET', '/campaign', 'gm@example.test');
check(r.json.doc.schedule.rsvp?.['p1@example.test']?.v === 'in', 'player RSVP lands: ' + JSON.stringify(r.json.doc.schedule.rsvp));
check(r.json.doc.log.some((e) => /Next session/.test(e.text)), 'log line written');
await sleep(5000);
check((await GM.p.textContent('#nextSession')).match(/1 in/i), 'GM card sees the RSVP after polling: ' + (await GM.p.textContent('#nextSession')).replace(/\s+/g, ' ').slice(0, 160));
// the board: p1 answered and owns no character, so a chip under the line-up
check(/p1|Someone/i.test((await GM.p.textContent('.tp-schedbox .sc-luchips').catch(() => '')) || ''), 'GM box: answerer without a character as a chip');
// tonight: the GM moves next to within the hour, p1 is in, the GM starts the session in the page -> attendance on the server
const soon = new Date(Date.now() + 30 * 60000).toISOString();
r = await api('PATCH', '/campaign', 'gm@example.test', { schedule: { next: { at: soon, minutes: 240, place: '', note: '', confirmedAt: new Date().toISOString() } } });
check(r.status === 200, 'GM moves next to tonight via API');
r = await api('PATCH', '/campaign', 'p1@example.test', { schedule: { rsvp: { 'p1@example.test': { at: soon, v: 'in' } } } });
check(r.status === 200, 'p1 is in for tonight');
r = await api('PATCH', '/campaign', 'p1@example.test', { schedule: { attendance: { 1: { 'p1@example.test': true } } } });
check(r.status === 403, 'player writing attendance -> 403');
await GM.p.reload(); await GM.p.waitForSelector('[data-act="sessstart"]', { timeout: 20000 }); await sleep(1500);
await GM.p.click('[data-act="sessstart"]');
await sleep(2500);
r = await api('GET', '/campaign', 'gm@example.test');
check(r.json.doc.session.number === 1 && !r.json.doc.schedule.next && r.json.doc.schedule.attendance?.['1']?.['p1@example.test'] === true, 'session start records attendance on the server: ' + JSON.stringify({ n: r.json.doc.session.number, next: r.json.doc.schedule.next, att: r.json.doc.schedule.attendance }));
check(!P1.errs.length && !GM.errs.length, 'no console errors ' + JSON.stringify(P1.errs.concat(GM.errs)));
await b.close(); console.log(fails ? 'FAILED ' + fails : 'ALL PASS'); process.exit(fails ? 1 : 0);
