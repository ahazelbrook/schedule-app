// kit-pitch (KS19 of the kit and stage build): Blade's pitch cards (blade.pitches on), on the real GM page, Worker and pack, in a real browser.
// The tick is answered by the browser's own route with invented pitch sets (KS18's reply shape): no key, no model, no spend.
//   1. the old desk (kit.desk off): one fake reply -> one set of three cards in today's idea-card look, under one head with the time; the Rack shows the newest
//   2. Keep and X: X takes one pitch; the second request carries the first set's lines in `seen`; Keep holds a pitch (aria-pressed)
//   3. Pitch now: the head's Pitch button, busy while it waits; two fast presses make one request; Shift+A asks too (and says when nothing fits)
//   4. a pitch never acts: nothing but the tick is written while pitches come and go, and no pitch line or GM-ONLY- marker is in the display's or the GM state
//   5. the new desk (kit.desk on): the kit card (the kind as a word and an edge, 14 px line, 12 px why-now), Delete dismisses a pitch, and the fade
//      (Playwright's clock): past 90 s in view the unkept pitches go and a kept one stays
//   6. off: turned off mid-session the sets, the Pitch button and the Rack's pitch go; a fresh load sends today's tick body and Shift+A is A
// Every name is invented. SHOTS=<dir> writes the pictures (Paper and Night; 1366x768 and 1536x864; the old desk too).
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9416] [SHOTS=<dir>] node checks/runtime/kit-pitch.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9416);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.SHOTS || '';
if (!process.env.PW_MODULE) { console.log('SKIP kit-pitch: PW_MODULE is not set (it needs Playwright)'); process.exit(0); }
const { chromium } = require(process.env.PW_MODULE);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json');
const NOW = new Date().toISOString();
const PARTS = {
  console: con.parts.console, campaign: np.parts.campaign, npc: np.parts.npc,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: NOW }, T: loc.T, extra: loc.extra },
};

/* three invented pitch sets, in KS18's reply shape (pitch: { at, wake, items: [{ kind, line, why_now, uses }] }) */
const at = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const SET1 = { at: at(1), wake: 'scene', items: [
  { kind: 'direction', line: 'Cut to the cloakroom: Mabel Quist is already counting the takings, and the key is on her ring.', why_now: 'The crew just left the bar talking about the key.', uses: 'Mabel Quist' },
  { kind: 'complication', line: 'A second band arrives early and wants the stage the crew is hiding behind.', why_now: 'Nell said the stage is their only cover.', uses: 'The Pelican Rooms' },
  { kind: 'npc_move', line: 'Dov Kessler sends a drink over with a folded note under the glass.', why_now: 'Ray is still sitting alone at the bar.', uses: 'GM-ONLY-Dov-in-the-cellar' }] };
const SET2 = { at: at(0), wake: 'stall', items: [
  { kind: 'clue', line: 'The torn ticket stub matches the date written in the cellar ledger.', why_now: 'The table has circled the ledger for ten minutes.', uses: '' },
  { kind: 'cutaway', line: 'Across town, Lotte Brand pays off the night watch in cash.', why_now: 'Nobody has looked at the street since the score began.', uses: 'Lotte Brand' }] };
const SET3 = { at: at(0), wake: 'asked', items: [
  { kind: 'complication', line: 'The house lights come up for a raffle: every head in the room turns.', why_now: 'You asked for pressure on the stage.', uses: 'The Pelican Rooms' }] };
const LINES = [SET1, SET2, SET3].flatMap((s) => s.items.map((x) => x.line));
const SPEND = { tonight: 1.42, cap: 30, tier: 'all' };

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-kitpitch-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.ANTHROPIC_API_KEY; delete env.B68_ANTHROPIC_KEY;      /* no model: every assist call is answered by the browser's route */
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
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 540000);
const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const feat = (o) => api('PATCH', '/gm/state', { features: o });

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src || {}, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  check((await api('PATCH', '/gm/stt', { want: 'off' })).status === 200, 'listening off: the panel\'s own minute makes no tick, so every tick here is the check\'s');

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  /* a GM page; the tick route answers from two queues: q for ordinary ticks, nowQ (after nowDelay ms) for pitchNow */
  async function open({ w = 1366, h = 768, theme = '', clock = false, pitchesOn = true } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block', colorScheme: theme === 'night' ? 'dark' : 'light' });
    await c.addInitScript(atPlace('score'));
    if (theme) await c.addInitScript({ content: 'try { localStorage.setItem("b68.theme", ' + JSON.stringify(theme === 'night' ? 'dark' : 'light') + '); } catch (e) {}' });
    const page = await c.newPage();
    if (clock) await page.clock.install();
    const seen = { ticks: [], q: [], nowQ: [], nowDelay: 0, writes: [] };
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('request', (r) => { if (r.method() !== 'GET' && /\/api\//.test(r.url())) seen.writes.push({ m: r.method(), u: new URL(r.url()).pathname, b: r.postData() || '' }); });
    const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    await page.route('**/api/gm/assist/tick', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}'); seen.ticks.push(body);
      let pitch = null;
      if (body.pitchNow) { if (seen.nowDelay) await sleep(seen.nowDelay); pitch = seen.nowQ.shift() || null; } else pitch = seen.q.shift() || null;
      const res = { cards: [], updates: [], flags: [], spend: SPEND, last: (Number(body.after) || 0) + 1 };
      if (pitch && body.pitch === true) res.pitch = pitch;
      return json(route, res);
    });
    await page.route('**/api/gm/assist/cards', (route) => json(route, route.request().method() === 'POST' ? { marked: 1 } : { cards: [], updates: [], asks: [], spend: SPEND }));
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
    await page.waitForFunction(() => window.B68GmAssist && window.B68GmAssist.live().length === 1, null, { timeout: 30000 });
    if (pitchesOn) await page.waitForFunction(() => window.B68KitBlade && window.B68Pitches && window.B68Pitches.on() && document.querySelector('.as-head-1 [data-kbl="pitch"]'), null, { timeout: 30000 });
    await page.waitForTimeout(400);
    return { c, page, seen };
  }
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
  const openPanel = async (p) => {
    if (await p.evaluate(() => document.querySelector('.gm-assist').getAttribute('data-state') !== 'closed')) return;
    await p.keyboard.press('a');
    await p.waitForFunction(() => { const r = document.querySelector('#as-panel').getBoundingClientRect(); return document.querySelector('.gm-assist').getAttribute('data-state') !== 'closed' && r.right <= innerWidth + 1 && r.left < innerWidth - 100; }, null, { timeout: 4000 });
    await p.waitForTimeout(250);
  };
  /* one fake tick, as the panel's minute does it (window.claude.gm.assistTick: B68Pitches has routed it while pitches are on) */
  const tick = async (p, seen, set) => { if (set) seen.q.push(set); const n = seen.ticks.length; await p.evaluate(() => window.claude.gm.assistTick(null)); await until(() => seen.ticks.length > n, 5000); };
  const sets = (p) => p.$$eval('#as-list .kp-set', (l) => l.map((s) => ({ id: s.getAttribute('data-id'), head: s.querySelector('.kp-sethead').textContent,
    cards: [...s.querySelectorAll('.kp-card')].map((c) => { const k = c.querySelector('[data-kbl="pkeep"]'); return { kp: c.getAttribute('data-kp'), kind: c.getAttribute('data-pkind'), word: c.querySelector('.kp-kind b').textContent,
      line: c.querySelector('.kp-text').textContent, why: (c.querySelector('.kp-why') || {}).textContent || '', kept: k ? k.getAttribute('aria-pressed') : '' }; }) })));
  const rackLine = (p) => p.evaluate(() => { const f = document.querySelector('#gm-rackf'), l = document.querySelector('#kp-rack .kp-rack-line'); return f && !f.hidden && l ? l.textContent : ''; });
  const WORDS = { direction: 'Direction', complication: 'Complication', clue: 'Clue', npc_move: 'NPC move', cutaway: 'Cutaway' };
  const nows = (seen) => seen.ticks.filter((t) => t.pitchNow).length;

  /* ---- 1 to 4: the old desk ---- */
  check((await feat({ 'blade.pitches': true, 'kit.desk': false })).status === 200, 'blade.pitches on, kit.desk off');
  {
    const { c, page: p, seen } = await open();
    check(await p.evaluate(() => !document.documentElement.getAttribute('data-kit') && [...document.querySelectorAll('link[rel=stylesheet], style[data-href]')].every((l) => !/desk-blade/.test(l.getAttribute('href') || l.getAttribute('data-href') || ''))),
      'the old desk: no kit attribute, desk-blade.css not fetched');
    check((await p.$eval('.as-head-1 [data-kbl="pitch"]', (b) => b.textContent)) === 'Pitch', 'a Pitch button at the head of the panel');
    await p.waitForTimeout(2500);
    const w0 = seen.writes.length;      /* the page's own writes as it settles (the band's phase layer, the polaroids it holds) come before any pitch */
    await tick(p, seen, SET1);
    const t1 = seen.ticks[seen.ticks.length - 1];
    check(t1.pitch === true && !('seen' in t1), 'the tick says pitch: true (nothing seen yet): ' + JSON.stringify(t1));
    await p.waitForFunction(() => document.querySelectorAll('#as-list .kp-set .kp-card').length === 3, null, { timeout: 5000 });
    await openPanel(p);
    let s = await sets(p);
    check(s.length === 1 && s[0].cards.length === 3, 'one fake reply: one set of three cards on the old desk');
    check(s[0].cards.every((x, i) => x.word === WORDS[SET1.items[i].kind] && x.line === SET1.items[i].line && x.why === SET1.items[i].why_now), 'each: its kind as a word, the line, the why-now: ' + s[0].cards.map((x) => x.word).join(', '));
    check(/^Pitches · \d\d:\d\d · the scene changed$/.test(s[0].head), 'one head with the time: ' + s[0].head);
    const look = await p.$eval('#as-list .kp-set .kp-card', (x) => ({ cls: x.className, kind: x.getAttribute('data-kind'), edge: getComputedStyle(x).borderLeftWidth, whyFs: parseFloat(getComputedStyle(x.querySelector('.kp-why')).fontSize) }));
    check(/\bas-card\b/.test(look.cls) && look.kind === 'idea' && look.edge === '8px' && look.whyFs === 12, 'today\'s idea card: the old as-card look (8 px idea edge), the why-now at 12 px: ' + JSON.stringify(look));
    check(await p.evaluate(() => { const st = window.B68GmAssist.live()[0].ctl.state(); return st.cards.length === 1 && st.cards[0].seat === 'pitch' && st.cards[0].kind === 'idea'; }), 'the set is one card in the panel (seat pitch, kind idea): one pip, under the Idea filter');
    check((await rackLine(p)) === SET1.items[0].line, 'the Rack shows the newest pitch');
    await p.mouse.move(5, 5);
    if (SHOTS) await p.waitForTimeout(1800);      /* the Now zone gives the set back to the feed after 1.5 s */
    await shot(p, 'olddesk-paper-1366');

    /* X: one pitch goes; Keep holds one */
    await p.click('#as-list .kp-set .kp-card[data-kp="1"] [data-kbl="px"]');
    await until(async () => (await sets(p))[0].cards.length === 2, 3000);
    s = await sets(p);
    check(s[0].cards.length === 2 && !s[0].cards.some((x) => x.kp === '1'), 'X dismisses its pitch; the others stay');
    await p.click('#as-list .kp-set .kp-card[data-kp="0"] [data-kbl="pkeep"]');
    await until(async () => (await sets(p))[0].cards[0].kept === 'true', 3000);
    check((await sets(p))[0].cards[0].kept === 'true' && (await p.$eval('#as-list .kp-card[data-kp="0"] [data-kbl="pkeep"]', (b) => b.textContent)) === 'Kept', 'Keep holds it (pressed, "Kept")');

    /* the second request carries the first set's lines in seen */
    await tick(p, seen, SET2);
    const t2 = seen.ticks[seen.ticks.length - 1];
    check(Array.isArray(t2.seen) && SET1.items.every((x) => t2.seen.includes(x.line)), 'the second fake request carries the first set\'s lines in seen: ' + JSON.stringify(t2.seen));
    await p.waitForFunction(() => document.querySelectorAll('#as-list .kp-set').length === 2, null, { timeout: 5000 });
    s = await sets(p);
    check(s[0].cards.length === 2 && s[0].cards[0].line === SET2.items[0].line && /the table stalled/.test(s[0].head), 'the newer set is first in the feed, with its own head');
    check((await rackLine(p)) === SET2.items[0].line, 'the Rack moves on to the newest');

    /* Pitch now: busy while it waits, two fast presses make one request */
    seen.nowDelay = 1500; seen.nowQ.push(SET3);
    const before = nows(seen);
    await p.click('.as-head-1 [data-kbl="pitch"]');
    await p.click('.as-head-1 [data-kbl="pitch"]');
    await sleep(300);
    const busy = await p.$eval('.as-head-1 [data-kbl="pitch"]', (b) => ({ t: b.textContent, busy: b.getAttribute('aria-busy') }));
    check(busy.t === 'Pitching…' && busy.busy === 'true', 'busy while it waits: ' + JSON.stringify(busy));
    check(/pitching/i.test(await p.$eval('#kp-rack', (x) => x.textContent).catch(() => '')), 'the Rack says Blade is pitching');
    await p.waitForFunction(() => document.querySelectorAll('#as-list .kp-set').length === 3, null, { timeout: 8000 });
    check(nows(seen) - before === 1, 'two fast presses make one request: ' + (nows(seen) - before));
    const tn = seen.ticks.filter((t) => t.pitchNow).pop();
    check(tn.pitch === true && Array.isArray(tn.seen) && tn.seen.includes(SET2.items[1].line), 'Pitch now sends pitch, pitchNow and seen');
    check(await p.$eval('.as-head-1 [data-kbl="pitch"]', (b) => b.textContent === 'Pitch' && !b.hasAttribute('aria-busy')), 'not busy once it has answered');
    s = await sets(p);
    check(s[0].cards.length === 1 && /^Pitch · \d\d:\d\d · you asked$/.test(s[0].head), 'the asked-for set arrives: ' + s[0].head);
    seen.nowDelay = 0;

    /* Shift+A: Pitch now from the keyboard (the open panel stays open); nothing to pitch says so */
    const b2 = nows(seen);
    await p.focus('#as-name');
    await p.keyboard.press('Shift+A');
    await until(() => nows(seen) > b2, 4000);
    check(nows(seen) === b2 + 1, 'Shift+A asks for pitches');
    check(!!(await p.waitForFunction(() => { const n = document.querySelector('.kp-note'); return n && !n.hidden && /Nothing new/.test(n.textContent); }, null, { timeout: 4000 }).catch(() => null)), 'an answer with no pitch says so under the head');
    check(await p.evaluate(() => document.querySelector('.gm-assist').getAttribute('data-state') !== 'closed'), 'Shift+A does not close the panel');
    await p.keyboard.press('a');
    await p.waitForFunction(() => document.querySelector('.gm-assist').getAttribute('data-state') === 'closed', null, { timeout: 3000 });
    const b3 = nows(seen);
    await p.keyboard.press('Shift+A');
    await until(() => nows(seen) > b3, 4000);
    check(nows(seen) === b3 + 1 && await p.evaluate(() => document.querySelector('.gm-assist').getAttribute('data-state') === 'closed'), 'with the panel shut, Shift+A asks and leaves it shut');
    await openPanel(p);
    const t0 = Date.now(); await p.keyboard.press('Escape');
    check(!!(await p.waitForFunction(() => document.querySelector('.gm-assist').getAttribute('data-state') === 'closed', null, { timeout: 1500 }).catch(() => null)), 'Esc still closes the panel at once (' + (Date.now() - t0) + ' ms)');

    /* a pitch never acts */
    const all = seen.writes.filter((x) => x.u !== '/api/gm/assist/tick'), other = seen.writes.slice(w0).filter((x) => x.u !== '/api/gm/assist/tick');
    check(!all.some((x) => LINES.some((l) => x.b.includes(l)) || x.b.includes('GM-ONLY-')), 'no write carries a pitch line or the GM-ONLY- marker: ' + JSON.stringify(all.map((x) => x.m + ' ' + x.u)));
    check(other.length === 0, 'while pitches came, were kept, dismissed and asked for, nothing but the tick was written (nothing to the iPad)' + (other.length ? ': ' + JSON.stringify(other) : ''));
    const disp = JSON.stringify((await api('GET', '/gm/display')).json || {}), gst = JSON.stringify((await api('GET', '/gm/state')).json || {});
    check(!LINES.some((l) => disp.includes(l) || gst.includes(l)) && !disp.includes('GM-ONLY-') && !gst.includes('GM-ONLY-'), 'no pitch line or GM-ONLY- marker in the display\'s document or the GM state');

    /* off mid-session, from Settings: the sets, the button and the Rack's pitch go, without a reload */
    await p.keyboard.press('i');
    await p.waitForSelector('#gm-ipad-settings [data-set="blade.pitches"][data-v="0"]', { timeout: 5000 });
    await p.click('#gm-ipad-settings [data-set="blade.pitches"][data-v="0"]');
    check(!!(await until(async () => { const d = (await api('GET', '/gm/state')).json; return d && d.doc && d.doc.features && d.doc.features['blade.pitches'] === false; }, 5000)), 'blade.pitches turned off in Settings');
    const gone = await until(() => p.evaluate(() => !window.B68Pitches.on() && !document.querySelector('.kp-set, [data-kbl="pitch"], #kp-rack') && window.B68GmAssist.live()[0].ctl.state().cards.length === 0), 15000, 250);
    check(!!gone, 'off mid-session: the sets, the Pitch button and the Rack\'s pitch go');
    const n0 = seen.ticks.length; await p.evaluate(() => window.claude.gm.assistTick(null)); await until(() => seen.ticks.length > n0, 3000);
    const t3 = seen.ticks[seen.ticks.length - 1];
    check(!('pitch' in t3) && !('seen' in t3), 'and the tick is today\'s again: ' + JSON.stringify(t3));
    await c.close();
  }

  /* ---- 5: the new desk, with the fade on Playwright's clock ---- */
  check((await feat({ 'blade.pitches': true, 'kit.desk': true })).status === 200, 'blade.pitches and kit.desk on');
  {
    const { c, page: p, seen } = await open({ clock: true });
    check(await p.evaluate(() => /(^| )desk( |$)/.test(document.documentElement.getAttribute('data-kit') || '')), 'the desk is painted');
    await tick(p, seen, SET1);
    await p.waitForFunction(() => document.querySelectorAll('#as-list .kp-set .kp-card').length === 3, null, { timeout: 5000 });
    await openPanel(p);
    const m = await p.$$eval('#as-list .kp-card', (l) => l.map((x) => ({ ui: x.classList.contains('ui-card'), edge: getComputedStyle(x).borderLeftColor + ' ' + getComputedStyle(x).borderLeftStyle,
      word: x.querySelector('.kp-kind b').textContent, wordFs: parseFloat(getComputedStyle(x.querySelector('.kp-kind b')).fontSize), lineFs: parseFloat(getComputedStyle(x.querySelector('.kp-text')).fontSize),
      whyFs: parseFloat(getComputedStyle(x.querySelector('.kp-why')).fontSize), h: x.getBoundingClientRect().height })));
    check(m.length === 3 && m.every((x) => x.ui), 'the new desk: three kit cards');
    check(new Set(m.map((x) => x.edge)).size === 3, 'each kind its own edge: ' + m.map((x) => x.edge).join(' | '));
    check(m.every((x) => x.lineFs === 14 && x.whyFs === 12 && x.wordFs === 12), 'the line at 14 px, the word and the why-now at 12 px');
    check(m.every((x) => x.h <= 84), 'compact: ' + m.map((x) => Math.round(x.h)).join(', ') + ' px');
    const small = await p.evaluate(() => {
      let min = 99, where = '';
      for (const e of document.querySelectorAll('#as-panel *')) {
        if (![...e.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim())) continue;
        const r = e.getBoundingClientRect(), s = getComputedStyle(e); if (!r.width || s.visibility === 'hidden' || e.closest('.as-sr,[hidden]')) continue;
        const f = parseFloat(s.fontSize); if (f < min) { min = f; where = String(e.className || e.tagName); }
      }
      return { min, where };
    });
    check(small.min >= 12, 'nothing in the panel under 12 px (smallest ' + small.min + ' px: ' + small.where + ')');
    /* Enter on a pitch opens its set: what it leans on shows */
    await p.focus('#as-list .kp-card[data-kp="0"] .kp-fold');
    await p.keyboard.press('Enter');
    check(!!(await p.waitForFunction(() => { const s = document.querySelector('#as-list .kp-set'); return s && s.getAttribute('data-open') === '1' && s.querySelector('.kp-uses'); }, null, { timeout: 3000 }).catch(() => null)), 'Enter opens the set: what each pitch leans on');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelector('#as-list .kp-set').getAttribute('data-open') === '0', null, { timeout: 3000 });
    /* Delete on a focused pitch is its X */
    await p.focus('#as-list .kp-card[data-kp="2"] .kp-fold');
    await p.keyboard.press('Delete');
    await until(async () => { const x = await sets(p); return x[0] && x[0].cards.length === 2; }, 3000);
    check((await sets(p))[0].cards.map((x) => x.kp).join() === '0,1', 'Delete dismisses the focused pitch');
    check(await p.evaluate(() => !!document.activeElement && document.activeElement.getAttribute('data-kp') === '1'), 'the focus moves to the next pitch');
    await p.click('#as-list .kp-card[data-kp="0"] [data-kbl="pkeep"]');
    await tick(p, seen, SET2);
    await p.waitForFunction(() => document.querySelectorAll('#as-list .kp-set').length === 2, null, { timeout: 5000 });
    check((await rackLine(p)) === SET2.items[0].line, 'the Rack shows the newest pitch on the new desk');
    await p.mouse.move(5, 5);
    await p.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
    await p.clock.fastForward(84000);
    check(!!(await p.waitForFunction(() => document.querySelectorAll('#as-list .kp-set[data-kbl-fading]').length === 2, null, { timeout: 4000 }).catch(() => null)), 'near 90 s both sets dim');
    await p.clock.fastForward(8000);
    await until(async () => (await sets(p)).length === 1 && (await sets(p))[0].cards.length === 1, 4000);
    const left = await sets(p);
    check(left.length === 1 && left[0].cards.length === 1 && left[0].cards[0].line === SET1.items[0].line, 'past 90 s the unkept pitches have gone; the kept one stays: ' + JSON.stringify(left.map((x) => x.cards.map((y) => y.line.slice(0, 20)))));
    check((await rackLine(p)) === SET1.items[0].line, 'the Rack falls back to the newest pitch still there');
    await c.close();
  }

  /* ---- the pictures: the new desk in Paper and Night, 1366x768 and 1536x864; the old desk at Night ---- */
  if (SHOTS) {
    for (const [w, h] of [[1366, 768], [1536, 864]]) for (const theme of ['paper', 'night']) {
      const { c, page: p, seen } = await open({ w, h, theme });
      await tick(p, seen, SET1); await tick(p, seen, SET2);
      await p.waitForFunction(() => document.querySelectorAll('#as-list .kp-set').length === 2, null, { timeout: 5000 });
      await openPanel(p);
      await p.mouse.move(5, 5);
      await shot(p, 'desk-' + theme + '-' + w);
      check(true, theme + ' ' + w + 'x' + h + ' pictured');
      await c.close();
    }
    check((await feat({ 'kit.desk': false })).status === 200, 'kit.desk off for the old desk at Night');
    { const { c, page: p, seen } = await open({ theme: 'night' }); await tick(p, seen, SET1); await p.waitForSelector('#as-list .kp-set', { state: 'attached' }); await openPanel(p); await p.mouse.move(5, 5); await p.waitForTimeout(1800); await shot(p, 'olddesk-night-1366'); await c.close(); }
  }

  /* ---- 6: off on a fresh load: nothing of the pitches, the tick is today's, Shift+A is A ---- */
  check((await feat({ 'blade.pitches': false, 'kit.desk': false })).status === 200, 'both off');
  {
    const { c, page: p, seen } = await open({ pitchesOn: false });
    check(await p.evaluate(() => !window.B68KitBlade && !window.B68Pitches && !document.querySelector('.kp-set, [data-kbl], #kp-rack')), 'off: no pitch file, no pitch markup');
    const n0 = seen.ticks.length; seen.q.push(SET1); await p.evaluate(() => window.claude.gm.assistTick(null)); await until(() => seen.ticks.length > n0, 3000);
    const t4 = seen.ticks[seen.ticks.length - 1];
    check(!('pitch' in t4) && !('pitchNow' in t4) && !('seen' in t4), 'off: today\'s tick body');
    await p.keyboard.press('Shift+A');
    check(!!(await p.waitForFunction(() => document.querySelector('.gm-assist').getAttribute('data-state') !== 'closed', null, { timeout: 3000 }).catch(() => null)), 'off: Shift+A opens the panel, as A does');
    await c.close();
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
