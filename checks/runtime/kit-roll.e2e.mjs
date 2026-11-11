// kit-roll (KS06 of the kit and stage build): the Roll on the new desk (kit.desk on), on the real GM page, Worker and pack, in a real browser.
// The Fixer is answered by the browser's own route (an invented fit): no key, no model, no spend. The stamp, the report card and the keys are real.
//   1. the card, in order: Who chips, Position and Effect as two full-width segmented controls, If it goes wrong, STAMP (the Roll's one Primary) with a
//      quiet Fit beside it; every hook the old card had answers (data-gm who, stamp, stamp-down, stamp-clean, #gm-pos, #gm-eff, #gm-c-threat, #gm-fitnow)
//   2. They rolled: the four keys as rows, each with its outcome colour on the left edge AND its word
//   3. the walk: setting asks nothing; STAMP asks one fit; the Fixer's answer as rows with colour edges, bullets, the cost in its outcome colour, the dice
//      in one small mono line, the words as sent; it reads whole in the column at 1366x768; no extra request between the stamp and the card (the same
//      requests as with the kit off, plus nothing); key 3 marks the 1-3 (the hit line a Card over the result card); Esc and Take it down take it down;
//      Clean; the Fit button; keys 1, 2 and 4; Focus (F) shows the keys with their edges; Voice as a Card
//   4. the setting off mid-session (Settings): the old card is back without a reload, and a stamp then makes the same requests
// Every name is invented. SHOTS=<dir> writes the pictures (the Roll stamped with the Fixer's answer, and after a 1-3; Paper and Night; 1366x768, 1536x864).
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9404] [SHOTS=<dir>] node checks/runtime/kit-roll.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9404);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.SHOTS || '';
if (!process.env.PW_MODULE) { console.log('SKIP kit-roll: PW_MODULE is not set (it needs Playwright)'); process.exit(0); }
const { chromium } = require(process.env.PW_MODULE);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json');
const PARTS = {
  console: con.parts.console, campaign: np.parts.campaign, npc: np.parts.npc,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
};
const SPEND = { tonight: 0.3, cap: 20, tier: 'all', tick: 0.02 };
/* the Fixer's answer, in its 08/11 shape (invented); two outcomes say two sentences, so they are two bullets */
const OUT = {
  bargain: { lead: 'The dog wakes', say: 'Take the die, and the dog on the crate starts barking.' },
  four_five: { lead: 'Clear, ankle caught', say: 'You drop clear. The stack clips your ankle on the way.', size: 'harm 2' },
  one_three: { lead: 'The cars come down', say: 'The stack lands on you. The guard rolls clear.', size: 'harm 2' },
  six: { lead: 'Clean drop', say: 'You land soft, and the guard never looks up.' },
  crit: { lead: 'Clear, door sealed', say: 'You land clear and the wrecks block the door behind you.', size: '+1 effect' },
};
const FIT = (n) => ({ cards: [{ seat: 'fixer', at: new Date().toISOString(), text: 'r', read: n > 1 ? 'fit ' + n : 'Nell on the catwalk above the guard; risky, standard.', ...OUT }],
  flags: [], spend: SPEND, last: 9 });
const ROWS = [['deal', 'Bargain', 'rgb(201, 52, 140)'], ['mid', '4/5', 'rgb(224, 105, 30)'], ['low', '1–3', 'rgb(168, 33, 15)'], ['six', '6', 'rgb(110, 143, 106)'], ['crit', 'Crit', 'rgb(232, 195, 60)']];

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-kitroll-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.ANTHROPIC_API_KEY; delete env.B68_ANTHROPIC_KEY;      /* no model: the fit is answered by the browser's route */
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
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
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 480000);
const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const kit = (on) => api('PATCH', '/gm/state', { features: { 'kit.desk': on } });
const STAMP = '#gm-stamp [data-gm="stamp"]';

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src || {}, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  await api('PUT', '/campaign', { v: 1, session: { number: 1, startedAt: new Date().toISOString(), endedAt: null }, crew: { name: 'The Dovetail Crew', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] }, clocks: [], log: [] });
  check((await api('PATCH', '/gm/stt', { want: 'on' })).status === 200, 'listening is on');
  check((await kit(true)).status === 200, 'kit.desk is on');

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open({ w = 1366, h = 768, theme = '' } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block', colorScheme: theme === 'night' ? 'dark' : 'light' });
    await c.addInitScript(atPlace('score'));
    if (theme) await c.addInitScript({ content: 'try { localStorage.setItem("b68.theme", ' + JSON.stringify(theme === 'night' ? 'dark' : 'light') + '); } catch (e) {}' });
    const page = await c.newPage();
    const seen = { fits: [], reqs: [] };
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('request', (r) => { try { seen.reqs.push(r.method() + ' ' + new URL(r.url()).pathname); } catch (_) {} });
    const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    await page.route('**/api/gm/assist/tick', (route) => json(route, { cards: [], updates: [], flags: [], spend: SPEND, last: 9 }));
    await page.route('**/api/gm/assist/cards', (route) => route.request().method() === 'POST' ? json(route, { marked: 1 }) : json(route, { cards: [], updates: [], asks: [], spend: SPEND }));
    await page.route('**/api/gm/assist/fit', async (route) => { seen.fits.push(JSON.parse(route.request().postData() || '{}')); await sleep(500); return json(route, FIT(seen.fits.length)); });
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
    return { c, page, seen };
  }
  const kitCard = (p) => p.waitForFunction(() => { const r = document.querySelector('#gm-rl'); return r && r.getAttribute('data-kr') === '1' && document.querySelectorAll('#gm-buttons .kr-sit').length === 4; }, null, { timeout: 30000 });
  const blur = (p) => p.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  const rowsReady = (p, text) => until(async () => (await p.textContent('#gm-rack')).includes(text) && !!(await p.$('#gm-rack li.kr-fx')), 8000);
  const shot = async (p, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, name + '.png') }); } };

  /* ---- 1 + 2 + 3: the card and the walk (1366x768, Paper) ---- */
  {
    const { c, page: p, seen } = await open();
    await kitCard(p);
    check(await p.evaluate(() => /(^| )desk( |$)/.test(document.documentElement.getAttribute('data-kit') || '')), 'the desk is painted (data-kit~=desk) and the kit card is in (#gm-rl[data-kr])');
    check(await p.evaluate(() => document.querySelectorAll('#gm-rl').length === 1 && document.querySelectorAll('#gm-c-threat').length === 1 && document.querySelectorAll('#gm-buttons').length === 1), 'one of each id: the old card is out of the page');
    const hooks = await p.evaluate((l) => l.map((s) => s + ':' + !!document.querySelector(s)).join(' '),
      ['#gm-who [data-gm="who"]', '#gm-pos [data-gm="pos"]', '#gm-eff [data-gm="eff"]', '#gm-c-threat[data-ctl="threat"]', STAMP, '#gm-fitnow[data-gm="fitnow"]', '[data-gm="line-clear"]']);
    check(!/:false/.test(hooks), 'the hooks answer: ' + hooks);
    const lay = await p.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, w: b.width, h: b.height }; };
      const card = document.querySelector('#gm-rl'), cs = getComputedStyle(card), inner = card.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
      return { who: r('#gm-who-row'), pos: r('#gm-pos .ui-seg'), eff: r('#gm-eff .ui-seg'), line: r('#gm-c-threat'), stamp: r('#gm-stamp [data-gm="stamp"]'), fit: r('#gm-fitnow'), they: r('#gm-buttons'), inner,
        prim: [...document.querySelectorAll('#gm-rl .ui-btn--primary')].filter((b) => b.getBoundingClientRect().height > 0).length,
        fitQuiet: document.querySelector('#gm-fitnow').classList.contains('ui-btn--quiet') };
    });
    check(lay.who && lay.pos && lay.eff && lay.line && lay.stamp && lay.who.b <= lay.pos.t && lay.pos.b <= lay.eff.t && lay.eff.b <= lay.line.t && lay.line.b <= lay.stamp.t && lay.stamp.b <= lay.they.t,
      'in order: Who, Position, Effect, If it goes wrong, STAMP, They rolled');
    check(Math.abs(lay.pos.w - lay.inner) <= 2 && Math.abs(lay.eff.w - lay.inner) <= 2, 'Position and Effect are full width (' + Math.round(lay.pos.w) + ', ' + Math.round(lay.eff.w) + ' of ' + Math.round(lay.inner) + ')');
    check(lay.fit && lay.fit.h > 0 && lay.fitQuiet && lay.fit.l >= lay.stamp.r - 1 && Math.abs(lay.fit.t - lay.stamp.t) < 12, 'a quiet Fit beside STAMP');
    check(lay.prim === 1, 'STAMP is the Roll\'s one Primary (' + lay.prim + ')');
    const segs = await p.$$eval('#gm-pos [data-gm="pos"]', (l) => l.map((b) => b.textContent + ':' + b.getAttribute('role') + ':' + b.getAttribute('aria-checked')));
    check(segs.length === 3 && segs.filter((s) => /:radio:true$/.test(s)).length === 1, 'Position: three options, one checked (' + segs.join(' ') + ')');

    /* 2: They rolled */
    const sits = await p.$$eval('#gm-buttons .gm-btn', (l) => l.map((b) => ({ n: b.getAttribute('data-n'), gm: b.getAttribute('data-gm'), word: (b.querySelector('.ui-label') || b).textContent.trim(),
      edge: getComputedStyle(b).borderLeftColor, ew: parseFloat(getComputedStyle(b).borderLeftWidth), w: b.getBoundingClientRect().width, pw: b.parentElement.getBoundingClientRect().width })));
    check(sits.map((s) => s.n).join('') === '1234' && sits.every((s) => s.gm === 'situation'), 'They rolled: keys 1 to 4, data-gm="situation"');
    check(sits.every((s) => s.w >= s.pw - 1), 'each key is a full-width row');
    const want = { 1: 'rgb(201, 52, 140)', 2: 'rgb(224, 105, 30)', 3: 'rgb(168, 33, 15)' };
    check(sits.every((s) => s.ew >= 4 && s.word.length > 0) && [1, 2, 3].every((n) => sits[n - 1].edge === want[n]),
      'each row: its outcome colour on the left edge, and its word: ' + sits.map((s) => s.word + '=' + s.edge).join(' | '));

    /* 3: the walk */
    await p.fill('#gm-c-threat', 'Either you or the guard gets crushed');
    await p.click('#gm-pos [data-v="desperate"]'); await p.click('#gm-pos [data-v="risky"]');
    await p.click('#gm-eff [data-v="standard"]');
    const whoName = await p.$eval('#gm-who [data-gm="who"]', (b) => b.getAttribute('data-v'));
    await p.click('#gm-who [data-gm="who"]');
    check(await p.$eval('#gm-who [data-gm="who"]', (b) => b.getAttribute('aria-checked') === 'true' && b.getAttribute('aria-pressed') === 'true'), 'Who: one tap on a PC');
    await sleep(2200);
    check(seen.fits.length === 0, 'Position, effect, the line and Who ask nothing (' + seen.fits.length + ')');
    if (SHOTS) await shot(p, 'roll-set-paper-1366');

    const at0 = seen.reqs.length;
    await p.click(STAMP);
    check(!!(await until(async () => /Fitting…/.test(await p.textContent('#gm-rack')), 3000)), 'the Roll says Fitting… the moment the stamp is up');
    check(!!(await until(() => p.$('#gm-stamp .kr-up'), 3000)) && /On the iPad/.test(await p.textContent('#gm-stamp')), 'stamped: On the iPad');
    check(!!(await rowsReady(p, 'The cars come down')), 'one fit, and its lines show');
    const kitWin = seen.reqs.slice(at0);
    check(seen.fits.length === 1 && seen.fits[0].threat === 'Either you or the guard gets crushed' && seen.fits[0].position === 'risky' && seen.fits[0].pc === whoName, 'one fit, with the line, the position and Who');
    check(!kitWin.some((r) => /^GET \/(?!api\/)/.test(r)), 'no file fetched between the stamp and the card: ' + kitWin.join(', '));

    const fxr = await p.$$eval('#gm-rack li.gm-fx', (l) => l.map((li) => ({ cls: li.className, k: li.querySelector('.gm-fx-k').textContent, edge: getComputedStyle(li).borderLeftColor, ew: parseFloat(getComputedStyle(li).borderLeftWidth),
      lead: (li.querySelector('.gm-fx-lead') || {}).textContent || '', leadW: li.querySelector('.gm-fx-lead') ? +getComputedStyle(li.querySelector('.gm-fx-lead')).fontWeight : 0,
      pts: [...li.querySelectorAll('.kr-pts > li')].map((x) => { const y = x.cloneNode(true); y.querySelectorAll('.kr-cost').forEach((e) => e.remove()); return y.textContent.replace(/\s+/g, ' ').trim(); }),
      tail: (() => { const t = li.querySelector('.kr-tail'), k = li.querySelector('.kr-cost'); return t && k ? Math.abs(t.getBoundingClientRect().top - k.getBoundingClientRect().top) < 8 && getComputedStyle(t).whiteSpace === 'nowrap' : null; })(),
      cost: li.querySelector('.kr-cost') ? { t: li.querySelector('.kr-cost').textContent, bg: getComputedStyle(li.querySelector('.kr-cost')).backgroundColor } : null })));
    check(fxr.map((r) => r.k).join('|') === ROWS.map((r) => r[1]).join('|') && fxr.every((r, i) => r.cls.includes('gm-fx-' + ROWS[i][0])), 'five rows in the Fixer\'s order, with the old hooks: ' + fxr.map((r) => r.k).join('|'));
    check(fxr.every((r, i) => r.edge === ROWS[i][2] && r.ew >= 4), 'each outcome has its colour edge: ' + fxr.map((r) => r.edge).join(' '));
    const keys = ['bargain', 'four_five', 'one_three', 'six', 'crit'];
    check(fxr.every((r, i) => r.lead === OUT[keys[i]].lead && r.leadW >= 700 && r.pts.join(' ') === OUT[keys[i]].say), 'the words as sent, in order: the lead in bold, the say as bullets');
    check(fxr[1].pts.length === 2 && fxr[2].pts.length === 2, 'two sentences, two bullets (4/5 and 1–3)');
    check(fxr.filter((r) => r.cost).every((r) => r.tail === true), 'a cost rides with the last word of its point (never alone on a line)');
    check(fxr[2].cost && fxr[2].cost.t === 'harm 2' && fxr[2].cost.bg === ROWS[2][2] && fxr[1].cost.bg === ROWS[1][2] && fxr[4].cost.bg === ROWS[4][2] && !fxr[0].cost,
      'the cost carries its outcome colour: ' + fxr.map((r) => r.cost ? r.cost.t + '=' + r.cost.bg : '-').join(' '));
    const dice = await p.$eval('#gm-rack .kr-dice', (e) => ({ t: e.textContent, f: getComputedStyle(e).fontFamily, s: parseFloat(getComputedStyle(e).fontSize), h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight) }));
    check(/risky, standard/.test(dice.t) && /mono/i.test(dice.f) && dice.s <= 13 && dice.h <= dice.lh * 1.1 + 1, 'the dice in one small mono line: ' + dice.t + ' (' + dice.s + ' px)');
    check(/Either you or the guard gets crushed/.test(await p.textContent('#gm-rack .kr-for')), 'the line it was fitted for, under the dice');
    const small = await p.evaluate(() => [...document.querySelectorAll('#gm-rl *, #gm-rackf *, #gm-fxhit *')].filter((e) => e.getBoundingClientRect().height > 0 && e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
      .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 12).map((e) => e.className || e.tagName).slice(0, 5));
    check(small.length === 0, 'nothing in the Roll under 12 px' + (small.length ? ': ' + small.join(', ') : ''));
    /* reads top to bottom at 1366x768: the whole answer is in view in the column, above its sticky foot, with no scrolling by the GM */
    const inView = () => p.evaluate(() => { const col = document.querySelector('#gm-roll'), f = document.querySelector('#gm-rackf'), cr = col.getBoundingClientRect(), r = f.getBoundingClientRect(), last = col.lastElementChild;
      const vis = last && last !== f && getComputedStyle(last).position === 'sticky' ? Math.min(cr.bottom, last.getBoundingClientRect().top) : cr.bottom;
      return { h: Math.round(r.height), visH: Math.round(vis - cr.top), top: Math.round(r.top - cr.top), under: Math.round(vis - r.bottom), st: col.scrollTop }; });
    const fit = await until(async () => { const v = await inView(); return v.top >= 0 && v.under >= 0 ? v : null; }, 2000) || await inView();
    console.log('  the answer: ' + JSON.stringify(fit));
    check(fit.h <= fit.visH && fit.top >= 0 && fit.under >= 0, 'the Fixer\'s answer reads top to bottom in the column at 1366x768, no scrolling (' + fit.h + ' of ' + fit.visH + ' px)');
    const pinOk = (who) => p.evaluate((w) => { const pin = document.querySelector('#kr-pin'), col = document.querySelector('#gm-roll'); if (!pin || pin.hidden) return false; const r = pin.getBoundingClientRect(), c = col.getBoundingClientRect();
      return r.height > 0 && r.top >= c.top - 1 && r.bottom <= c.bottom && /On the iPad/.test(pin.textContent) && (!w || pin.textContent.includes(w)) && /risky, standard/.test(pin.textContent) && !!pin.querySelector('[data-gm="stamp-down"]'); }, who);
    check(await pinOk(await p.$eval('#gm-who [aria-checked="true"]', (b) => b.textContent).catch(() => '')), 'the stamp stays in sight: its pinned line (On the iPad, who, risky, standard, Take it down) is in view above the answer');
    if (SHOTS) await shot(p, 'roll-stamped-paper-1366');

    /* key 3: the 1–3 is marked */
    await blur(p);
    await p.keyboard.press('3');
    check(!!(await until(async () => p.$eval('#gm-fxhit', (e) => !e.hidden && !!e.querySelector('.kr-hitcard.ui-edge-out-low') && /The cars come down/.test(e.textContent)), 4000)), 'key 3: the 1–3 line heads the result card, as a Card with its edge');
    check(await p.$eval('#gm-rackf', (d) => !d.open) && /1–3 · The cars come down/.test(await p.textContent('#gm-rack-sum')), 'and Blade folds to its summary');
    check(await p.$eval('#gm-rack li.gm-fx-low', (e) => e.classList.contains('hit') && /Rolled/.test(e.textContent)), 'the 1–3 row says Rolled');
    check(await p.$$eval('#gm-who [data-gm="who"]', (l) => l.every((b) => b.getAttribute('aria-checked') === 'false')), 'the resolved roll clears Who');
    check(!!(await p.$(STAMP)) && !(await p.$('#gm-stamp .kr-up')), 'the stamp came down with the mark');
    if (SHOTS) await shot(p, 'roll-result-paper-1366');

    /* Esc takes it down */
    await p.fill('#gm-c-threat', 'The guard turns round');
    await p.click(STAMP);
    check(!!(await until(() => p.$('#gm-stamp .kr-up'), 3000)), 'stamped again');
    const lay2 = await p.evaluate(() => ({ prim: [...document.querySelectorAll('#gm-rl .ui-btn--primary')].filter((b) => b.getBoundingClientRect().height > 0).length,
      down: !!document.querySelector('#gm-stamp [data-gm="stamp-down"] [data-ui-key="Esc"]'), clean: !!document.querySelector('#gm-stamp [data-gm="stamp-clean"]') }));
    check(lay2.prim === 0 && lay2.down && lay2.clean, 'up: Take it down (Esc) and Clean, no Primary while nothing has changed');
    if (SHOTS) { await p.evaluate(() => { document.querySelector('#gm-roll').scrollTop = 0; }); await shot(p, 'roll-up-paper-1366'); }
    await p.fill('#gm-c-threat', 'The guard turns round fast');
    check(!!(await until(async () => /Changed since it went up/.test(await p.textContent('#gm-stamp')) && !!(await p.$('#gm-stamp .ui-btn--primary[data-gm="stamp"]')), 3000)), 'changed: Stamp again is the one Primary');
    await p.fill('#gm-c-threat', 'The guard turns round');
    await blur(p);
    await p.keyboard.press('Escape');
    check(!!(await until(async () => !!(await p.$(STAMP)) && !(await p.$('#gm-stamp .kr-up')), 3000)), 'Esc takes it down');
    await p.click(STAMP);
    await until(() => p.$('#gm-stamp .kr-up'), 3000);
    await p.click('#gm-stamp [data-gm="stamp-down"]');
    check(!!(await until(async () => !!(await p.$(STAMP)) && !(await p.$('#gm-stamp .kr-up')), 3000)), 'Take it down takes it down');
    /* Clean */
    await p.fill('#gm-c-threat', 'The lamp goes out');
    const nClean = seen.fits.length;
    await p.click(STAMP);
    check(!!(await until(async () => seen.fits.length === nClean + 1 && (await p.textContent('#gm-rack')).includes('fit ' + (nClean + 1)), 9000)), 'a stamp, fitted');
    await p.click('#gm-stamp [data-gm="stamp-clean"]');
    check(!!(await until(async () => /6 · Clean drop/.test(await p.textContent('#gm-rack-sum')), 4000)) && await p.$eval('#gm-fxhit', (e) => e.hidden), 'Clean marks the 6, with no headline');
    /* the Fit button */
    const nFit = seen.fits.length;
    await p.click('#gm-fitnow');
    check(!!(await until(() => seen.fits.length === nFit + 1, 6000)) && seen.fits[nFit].threat === undefined && !!seen.fits[nFit].draws, 'Fit: an unstamped fit with the console\'s draws');
    check(!!(await until(async () => /not stamped/.test(await p.textContent('#gm-rack .kr-for')), 4000)), 'and the Rack says it was not stamped');

    /* the column moves for a fit only when the GM is not in a field and has not scrolled since the fit was asked */
    const col = { top: () => p.evaluate(() => document.querySelector('#gm-roll').scrollTop), set: async (y) => { await p.evaluate((v) => { document.querySelector('#gm-roll').scrollTop = v; }, y); await sleep(250); } };
    const fitted = async (n) => !!(await until(async () => seen.fits.length === n && (await p.textContent('#gm-rack')).includes('fit ' + n), 9000));
    const whole = () => until(async () => { const v = await inView(); return v.top >= 0 && v.under >= 0 ? v : null; }, 2000);
    /* Enter in the line stamps; the focus stays in the line, so nothing moves until it leaves */
    await col.set(0);
    let n0 = seen.fits.length;
    await p.fill('#gm-c-threat', 'The rope snaps');
    await p.press('#gm-c-threat', 'Enter');
    check(await fitted(n0 + 1), 'Enter in the line stamps, and the fit lands');
    await sleep(500);
    check(await col.top() === 0 && await p.evaluate(() => document.activeElement && document.activeElement.id === 'gm-c-threat'), 'typing in the line: the column does not move under the GM');
    await blur(p);
    const ent = await whole();
    check(!!ent && await pinOk(''), 'the line left: the whole answer and the pinned stamp come into view' + (ent ? '' : ': ' + JSON.stringify(await inView())));
    await p.click('#kr-pin [data-gm="stamp-down"]');
    /* the GM scrolls after the stamp: that fit is left where the GM put it */
    await col.set(0);
    n0 = seen.fits.length;
    await p.fill('#gm-c-threat', 'The lamp swings');
    await p.click(STAMP);
    await until(async () => /Fitting…/.test(await p.textContent('#gm-rack')), 3000);
    await col.set(40);
    check(await fitted(n0 + 1), 'a stamp, then the GM scrolls, and the fit lands');
    await sleep(500);
    check(await col.top() === 40, 'scrolled by the GM since the stamp: the column stays put (' + await col.top() + ')');
    await p.click('#kr-pin [data-gm="stamp-down"]');
    check(!!(await until(async () => !!(await p.$(STAMP)) && await p.$eval('#kr-pin', (e) => e.hidden), 3000)), 'the pinned Take it down takes it down, and the pin goes');
    /* a Scene control holds the focus: nothing moves until the focus leaves the column's fields */
    await col.set(0);
    n0 = seen.fits.length;
    await p.fill('#gm-c-threat', 'The door bangs');
    await p.click(STAMP);
    await until(async () => /Fitting…/.test(await p.textContent('#gm-rack')), 3000);
    await p.evaluate(() => { document.querySelector('#gm-scene').click(); const s = document.querySelector('#gm-now-s'); s.focus({ preventScroll: true }); });
    check(await fitted(n0 + 1), 'a stamp, a Scene control focused, and the fit lands');
    await sleep(500);
    check(await col.top() === 0 && await p.evaluate(() => document.activeElement && document.activeElement.id === 'gm-now-s'), 'a field in the column has the focus: the column does not move');
    await blur(p);
    check(!!(await whole()), 'the field left: the whole answer comes into view');
    await p.evaluate(() => document.querySelector('#gm-scene').click());
    await p.click('#kr-pin [data-gm="stamp-down"]');
    /* keys 1, 2 and 4 */
    const cardText = () => p.textContent('#gm-card');
    for (const [k, title] of [['1', /Before the roll|Bargain/i], ['2', /4\/5/], ['4', /Someone/i]]) {
      await blur(p); await p.keyboard.press(k);
      check(!!(await until(async () => title.test(await cardText()), 4000)), 'key ' + k + ' draws its card');
    }
    /* Voice, in the Rack */
    await p.evaluate(() => window.B68GmPage._voice({ who: 'Mabel Quist', want: 'the ledger back', lines: ['Love, you want the book?', 'Then you owe me the door.'] }));
    check(!!(await until(() => p.$('#gm-rack .kr-voice.ui-card .kr-pts li'), 3000)) && /Mabel Quist/.test(await p.textContent('#gm-rack .kr-voice')), 'Voice: a Card, its lines as bullets');
    if (SHOTS) { await p.$eval('#gm-rackf', (d) => { d.open = true; d.scrollIntoView({ block: 'end' }); }); await sleep(200); await shot(p, 'roll-voice-paper-1366'); }
    /* Focus */
    await blur(p); await p.keyboard.press('f');
    const mini = await until(() => p.evaluate(() => { const m = document.querySelector('#gm-mini'), rl = document.querySelector('#gm-rl'); const bs = [...m.querySelectorAll('.kr-mini-b[data-gm="situation"]')];
      return m.getBoundingClientRect().height > 0 && rl.getBoundingClientRect().height === 0 && bs.length === 4 && bs.every((b) => b.getBoundingClientRect().height > 0 && parseFloat(getComputedStyle(b).borderLeftWidth) >= 4) ? bs.map((b) => b.textContent).join(' ') : ''; }), 3000);
    check(!!mini, 'Focus (F): the card folds away, the four keys show with their edges: ' + mini);
    if (SHOTS) await shot(p, 'roll-focus-paper-1366');
    const cut = await p.$$eval('#gm-mini .kr-mini-b .ui-label', (l) => l.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
    check(cut.length === 0, 'Focus: every word on the keys is whole' + (cut.length ? ': cut ' + cut.join(', ') : ''));
    await blur(p); await p.keyboard.press('f');
    check(!!(await until(() => p.evaluate(() => document.querySelector('#gm-rl').getBoundingClientRect().height > 0), 3000)), 'F again: the card is back');

    /* 4: the setting off mid-session, from Settings: the old card without a reload; a stamp then makes the same requests as the kit's did */
    await blur(p); await p.keyboard.press('i');
    await p.waitForSelector('#gm-ipad-settings [data-set="kit.desk"][data-v="0"]', { timeout: 5000 });
    await p.click('#gm-ipad-settings [data-set="kit.desk"][data-v="0"]');
    const back = await until(() => p.evaluate(() => !document.documentElement.getAttribute('data-kit') && !document.querySelector('#gm-rl').hasAttribute('data-kr') && document.querySelectorAll('#gm-buttons .gm-btn').length === 4 &&
      !document.querySelector('#gm-buttons .kr-sit') && [...document.querySelectorAll('#gm-buttons .gm-btn kbd')].map((k) => k.textContent).join('') === '1234'), 20000, 250);
    check(!!back, 'off mid-session: the old card is back, no reload');
    check(await p.evaluate(() => !document.querySelector('.kr-col, .kr-rackf, .kr-rackbox, .kr-fxhit, .kr-mini') && document.querySelectorAll('#gm-rl').length === 1), 'and the kr- classes are gone');
    await p.keyboard.press('Escape');
    await p.fill('#gm-c-threat', 'The bell rings twice');
    await sleep(800);
    const at1 = seen.reqs.length, nOff = seen.fits.length;
    await p.click(STAMP);
    check(!!(await until(async () => seen.fits.length === nOff + 1 && (await p.textContent('#gm-rack')).includes('fit ' + (nOff + 1)) && !!(await p.$('#gm-rack li.gm-fx:not(.kr-fx)')), 8000)), 'off: a stamp is fitted in the old rows');
    const offWin = seen.reqs.slice(at1);
    const extra = kitWin.filter((r) => !offWin.includes(r));
    check(extra.length === 0, 'no extra request between the stamp and the card with the kit on (kit: ' + kitWin.length + ', off: ' + offWin.length + (extra.length ? '; extra: ' + extra.join(', ') : '') + ')');
    await c.close();
    check((await kit(true)).status === 200, 'kit.desk on again');
  }

  /* ---- the pictures: Paper and Night, 1366x768 and 1536x864 ---- */
  if (SHOTS) {
    for (const [w, h] of [[1366, 768], [1536, 864]]) for (const theme of ['paper', 'night']) {
      if (w === 1366 && theme === 'paper') continue;
      const { c, page: p } = await open({ w, h, theme });
      await kitCard(p);
      await p.fill('#gm-c-threat', 'Either you or the guard gets crushed');
      await p.click('#gm-pos [data-v="risky"]');
      await p.click('#gm-who [data-gm="who"]');
      await p.click(STAMP);
      await rowsReady(p, 'The cars come down');
      await sleep(300);
      await shot(p, 'roll-stamped-' + theme + '-' + w);
      await blur(p); await p.keyboard.press('3');
      await until(async () => p.$eval('#gm-fxhit', (e) => !e.hidden), 4000);
      await sleep(300);
      await shot(p, 'roll-result-' + theme + '-' + w);
      await c.close();
    }
  }

  await browser.close();
  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
} catch (e) {
  console.log('FAIL ' + (e && e.stack || e));
  failed++;
}
clearTimeout(timeout);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
