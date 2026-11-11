// kit-blade (KS07 of the kit and stage build): the Blade panel on the new desk (kit.desk on), on the real GM page, Worker and pack, in a real browser.
// The assist endpoints are answered by the browser's own route (invented cards): no key, no model, no spend.
//   1. where it lives: closed, nothing of Blade's is over the page (the right-edge tab is hidden, the 44 px it kept are given back); A opens it
//   2. compact cards: six fixture cards at 1366x768, four or more fully in view; two lines at 14 px; the kind as a colour edge and a word; Enter opens one in place
//   3. dismissing: the X, Delete and Backspace (each sends the panel's own dismiss mark); an idea fades after 90 s in view (Playwright's clock), while a card
//      with Undo, one with an action, a pinned idea and the idea under the pointer stay; nothing is marked for a fade; Clear all leaves what has something to press
//   4. put away: the Screen section and the Now zone are hidden, Ask is at the foot, Find still reaches the Screen (the GM screen, in Rules)
//   5. the setting off: turned off mid-session the old panel is back without a reload; on a fresh load nothing of the kit is there
// Every name is invented. SHOTS=<dir> writes the pictures (closed, six cards, a card open; Paper and Night; 1366x768 and 1536x864).
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9405] [SHOTS=<dir>] [KIT_BLADE_ONLY=main|fade] node checks/runtime/kit-blade.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9405);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.KIT_BLADE_ONLY || '';      /* main | fade: one part only, while working on it */
if (!process.env.PW_MODULE) { console.log('SKIP kit-blade: PW_MODULE is not set (it needs Playwright)'); process.exit(0); }
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
  screen: { src: { file: 'fixture/screen', blockSha: 's1', exportedAt: NOW }, v: 1, title: 'The GM screen (fixture)', rel: 'fixture/screen.md', intro: '',
    sections: [{ id: 'position-and-effect', title: 'Position and effect', md: 'Set the position before the dice: controlled, risky or desperate. Set the effect: limited, standard or great.' },
      { id: 'resistance', title: 'Resistance', md: 'Roll the attribute; take six minus the highest die in stress.' }] },
};

/* six cards, as the server's log gives them back after a load (GET /gm/assist/cards); long headlines, as Blade writes them */
const at = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const SIX = [
  { seat: 'ref', kind: 'rule', at: at(2), seen: false, text: 'Resistance: Nell can resist the harm from the bouncer, but the stress is six minus her highest die, and she has only two boxes left.',
    bullets: ['Roll Prowess for the shove.', 'Six minus the highest die in stress.'], cite: 'p.0', detail: { said_at: '21:40', rule: 'Fixture rulebook p.0' } },
  { seat: 'fixer', kind: 'say', at: at(4), seen: false, text: 'Mabel Quist leans over the rail: the ledger never left the counting room, and she wants a favour before she says where.',
    say: 'Love, you want the book? Then you owe me the door.' },
  { seat: 'mystery', kind: 'idea', at: at(6), seen: true, text: 'Ada Vell has seen the torn page before: tie her to the croupier who left in a hurry last week.' },
  { seat: 'showrunner', kind: 'idea', at: at(8), seen: true, text: 'Pacing: the table has planned for twenty minutes. Cut to the Pelican Rooms with the doors already open.' },
  { seat: 'clerk', kind: 'note', at: at(10), seen: true, text: 'New name: Lotte Brand came up twice tonight, both times by the cloakroom. Filed as a loose end.' },
  { seat: 'ledger', kind: 'note', at: at(12), seen: true, text: 'Ray Okonjo took two stress on the stairs and one level of harm, Bruised hand. Apply it on his sheet.' },
];
const SPEND = { tonight: 1.42, cap: 20, tier: 'all' };

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-kitblade-e2e-'));
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
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 480000);
const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const kit = (on) => api('PATCH', '/gm/state', { features: { 'kit.desk': on } });
const dismissals = (seen) => seen.marks.filter((mk) => mk.op === 'dismiss');

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src || {}, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  check((await api('PATCH', '/gm/stt', { want: 'on' })).status === 200, 'listening is on');
  check((await kit(true)).status === 200, 'kit.desk is on');

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open({ w = 1366, h = 768, theme = '', clock = false, cards = SIX, wantKit = true } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block', colorScheme: theme === 'night' ? 'dark' : 'light' });
    await c.addInitScript(atPlace('score'));
    if (theme) await c.addInitScript({ content: 'try { localStorage.setItem("b68.theme", ' + JSON.stringify(theme === 'night' ? 'dark' : 'light') + '); } catch (e) {}' });
    const page = await c.newPage();
    if (clock) await page.clock.install();
    const seen = { marks: [], ticks: 0 };
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    await page.route('**/api/gm/assist/tick', (route) => { seen.ticks++; return json(route, { cards: [], updates: [], flags: [], spend: SPEND, last: 10 + seen.ticks }); });
    await page.route('**/api/gm/assist/cards', (route) => {
      if (route.request().method() === 'POST') { seen.marks.push(JSON.parse(route.request().postData() || '{}')); return json(route, { marked: 1 }); }
      return json(route, { cards: cards, updates: [], asks: [], spend: SPEND });
    });
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
    if (wantKit) await page.waitForFunction((n) => document.querySelectorAll('#as-list .kbl-card').length === n, cards.length, { timeout: 30000 });
    else await page.waitForFunction((n) => document.querySelectorAll('#as-list .as-card').length === n, cards.length, { timeout: 30000 });
    await page.waitForTimeout(400);
    return { c, page, seen };
  }
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
  const openPanel = async (p) => {
    await p.keyboard.press('a');
    await p.waitForFunction(() => { const r = document.querySelector('#as-panel').getBoundingClientRect(); return document.querySelector('.gm-assist').getAttribute('data-state') !== 'closed' && r.right <= innerWidth + 1 && r.left < innerWidth - 100; }, null, { timeout: 4000 });
    await p.waitForTimeout(250);
  };
  const ids = (p) => p.$$eval('#as-list .as-card', (l) => l.map((x) => x.getAttribute('data-id')));
  const shown = (p, sel) => p.$eval(sel, (e) => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && e.getBoundingClientRect().width > 0; }).catch(() => false);
  /* the cards wholly inside the feed's visible box */
  const inView = (p) => p.$$eval('#as-list .kbl-card', (l) => {
    const f = document.querySelector('#as-feed').getBoundingClientRect();
    return l.filter((c) => { const r = c.getBoundingClientRect(); return r.height > 0 && r.top >= f.top - 0.5 && r.bottom <= f.bottom + 0.5; }).length;
  });

  /* ---- 1 + 2 + 4: where it lives, the compact cards, put away (1366x768, Paper) ---- */
  if (!ONLY || ONLY === 'main') {
    const { c, page: p, seen } = await open();
    check(await p.evaluate(() => /(^| )desk( |$)/.test(document.documentElement.getAttribute('data-kit') || '')), 'the desk is painted (data-kit~=desk)');
    check(!(await shown(p, '#as-launch')) && !!(await p.$('#as-launch')), 'closed: the right-edge tab is hidden, and still in the page for its hooks');
    check(await p.evaluate(() => !document.body.classList.contains('as-tab')), 'the 44 px kept for the tab are given back (no body.as-tab)');
    const over = await p.evaluate(() => {
      const hits = [];
      for (const y of [120, 250, 400, 550, 700]) for (const x of [innerWidth - 4, innerWidth - 30, innerWidth - 120]) { const e = document.elementFromPoint(x, y); if (e && e.closest('.gm-assist')) hits.push(x + ',' + y); }
      return hits;
    });
    check(over.length === 0, 'nothing of Blade floats over the page with the panel closed' + (over.length ? ': ' + over.join(' ') : ''));
    await shot(p, 'closed-paper-1366');

    await openPanel(p);
    const n = await inView(p);
    check(n >= 4, 'six cards at 1366x768: ' + n + ' fully in view (four or more)');
    const m = await p.$$eval('#as-list .kbl-card', (l) => l.map((c) => {
      const t = c.querySelector('.kbl-text'), line = c.querySelector('.kbl-line'), s = getComputedStyle(t);
      return { h: c.getBoundingClientRect().height, fs: parseFloat(s.fontSize), lines: Math.round(line.getBoundingClientRect().height / parseFloat(getComputedStyle(line).lineHeight)),
        edge: getComputedStyle(c).borderLeftWidth, word: c.querySelector('.as-kind b').textContent, kind: c.getAttribute('data-kind'), x: !!c.querySelector('.kbl-x[data-as="ack"]') };
    }));
    check(m.every((x) => x.fs === 14), 'the headline reads at 14 px: ' + m.map((x) => x.fs).join(','));
    check(m.every((x) => x.lines <= 2), 'folded, two lines at most: ' + m.map((x) => x.lines).join(','));
    check(m.every((x) => x.h <= 64), 'a folded card is compact: ' + m.map((x) => Math.round(x.h)).join(','));
    check(m.every((x) => x.edge === '4px' && x.word), 'the kind is a colour edge and one word: ' + m.map((x) => x.kind + ':' + x.word).join(' '));
    check(m.every((x) => x.x), 'every card has an X');
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
    check(!(await shown(p, '#as-nowz')), 'the Now zone is put away (the newest card is first in the feed)');
    const fe = await p.$eval('#as-feed', (e) => e.getBoundingClientRect().top), ak = await p.$eval('#as-ask', (e) => e.getBoundingClientRect().top), tl = await p.$eval('#as-tools', (e) => e.getBoundingClientRect().top);
    check(ak > fe && ak > tl, 'Ask is at the foot, under the feed and the Tools drawer');
    await shot(p, 'six-paper-1366');

    /* Enter opens a card in place; Enter again folds it */
    await p.keyboard.press('j');
    const first = await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-id'));
    check(!!first && await p.evaluate(() => document.activeElement.matches('#as-list .kbl-fold[data-as="fold"]')), 'J moves to the first card, as before');
    await p.keyboard.press('Enter');
    await p.waitForFunction((id) => [...document.querySelectorAll('#as-list .as-card')].some((x) => x.getAttribute('data-id') === id && x.getAttribute('data-open') === '1'), first, { timeout: 3000 });
    const openCard = await p.$eval('#as-list .kbl-card[data-open="1"]', (x) => ({ more: getComputedStyle(x.querySelector('.kbl-more')).display !== 'none',
      fs: Math.max(...[...x.querySelectorAll('.kbl-more *')].filter((e) => [...e.childNodes].some((t) => t.nodeType === 3 && t.textContent.trim())).map((e) => parseFloat(getComputedStyle(e).fontSize))) }));
    check(openCard.more && openCard.fs <= 14, 'Enter opens it in place, everything at 14 px or less (largest ' + openCard.fs + ')');
    await shot(p, 'open-paper-1366');
    await p.keyboard.press('Enter');
    check(!!(await p.waitForFunction(() => !document.querySelector('#as-list .kbl-card[data-open="1"]'), null, { timeout: 3000 }).catch(() => null)), 'Enter again folds it');

    /* the Tools drawer: Fit it and the Ledger, no Screen */
    await p.click('#as-tools summary');
    check(await shown(p, '#as-fit') && !(await shown(p, '#as-screen')), 'the Tools drawer keeps Fit it; the Screen section is put away');
    check((await p.textContent('#as-tools summary small')) === 'Fit it · Ledger', 'the drawer says what is in it');
    await p.click('#as-tools summary');

    /* dismiss by X */
    const target = (await ids(p))[1];
    const tCard = SIX.find((x) => target.endsWith('|' + x.text));
    await p.click('#as-list .kbl-card:nth-child(2) .kbl-x');
    await until(async () => (await ids(p)).length === 5, 3000);
    check(!(await ids(p)).includes(target), 'the X dismisses its card');
    await until(async () => dismissals(seen).length >= 1, 3000);
    check(dismissals(seen).some((mk) => mk.items.length === 1 && mk.items[0].text === (tCard && tCard.text)), 'and sends the panel\'s own dismiss mark');

    /* dismiss by key: Delete, then Backspace; focus moves on to the next card */
    await p.click('#as-list .kbl-card:nth-child(1) .kbl-fold');      /* opens it; the focus is on the card */
    const d1 = await p.evaluate(() => document.activeElement.getAttribute('data-id'));
    await p.keyboard.press('Delete');
    await until(async () => (await ids(p)).length === 4, 3000);
    check(!!d1 && !(await ids(p)).includes(d1), 'Delete dismisses the focused card');
    const d2 = await p.evaluate(() => document.activeElement && document.activeElement.closest('#as-list') ? document.activeElement.getAttribute('data-id') : '');
    check(!!d2 && d2 !== d1, 'the focus moves to the next card');
    await p.keyboard.press('Backspace');
    await until(async () => (await ids(p)).length === 3, 3000);
    check(!(await ids(p)).includes(d2), 'Backspace dismisses it too');
    await until(async () => dismissals(seen).length >= 3, 3000);
    check(dismissals(seen).length === 3, 'one dismiss mark each: ' + dismissals(seen).length);
    await p.focus('#as-ask-q'); await p.keyboard.type('ab'); await p.keyboard.press('Backspace');
    check((await ids(p)).length === 3 && (await p.inputValue('#as-ask-q')) === 'a', 'Backspace in the Ask box only edits the text');
    await p.fill('#as-ask-q', '');

    /* Find still reaches the Screen (the GM screen, in Rules) */
    await p.keyboard.press('Escape'); await p.keyboard.press('Escape');
    await p.keyboard.press('Control+k');
    await p.waitForSelector('#gm-find:not([hidden])', { timeout: 3000 });
    await p.fill('#gm-find-q', 'resistance');
    await p.waitForFunction(() => [...document.querySelectorAll('#gm-find-list .gm-find-kind')].some((k) => k.textContent === 'Screen'), null, { timeout: 3000 });
    const i = await p.$$eval('#gm-find-list .gm-find-hit', (l) => l.findIndex((b) => b.querySelector('.gm-find-kind').textContent === 'Screen'));
    await p.click('#gm-find-list .gm-find-hit >> nth=' + i);
    check(!!(await p.waitForFunction(() => { const s = document.querySelector('#gm-rules [data-gs="resistance"]'); return s && s.getBoundingClientRect().height > 0; }, null, { timeout: 4000 }).catch(() => null)),
      'Find still reaches the Screen: the Rules tab opens at Resistance');

    /* the setting off mid-session, from Settings (the iPad view, I): the old panel without a reload */
    await p.keyboard.press('Escape');
    await p.keyboard.press('i');
    await p.waitForSelector('#gm-ipad-settings [data-set="kit.desk"][data-v="0"]', { timeout: 5000 });
    await p.click('#gm-ipad-settings [data-set="kit.desk"][data-v="0"]');
    check(!!(await until(async () => { const d = (await api('GET', '/gm/state')).json; return d && d.doc && d.doc.features && d.doc.features['kit.desk'] === false; }, 5000)), 'kit.desk turned off in Settings');
    const back = await until(() => p.evaluate(() => !document.documentElement.getAttribute('data-kit') && document.querySelectorAll('#as-list .kbl-card').length === 0 && document.querySelectorAll('#as-list .as-card').length === 3), 30000, 250);
    check(!!back, 'off mid-session: the old cards come back, no reload');
    check(await shown(p, '#as-launch') && await p.evaluate(() => document.body.classList.contains('as-tab')), 'the tab and its 44 px come back');
    check(await p.evaluate(() => !document.querySelector('#as-feed .kbl-clear') && !document.querySelector('.gm-assist [data-kbl], .kbl-feed, .kbl-ask') && !document.querySelector('#as-screen').hidden && !document.querySelector('#as-nowz').hidden),
      'the Screen and Now are back, Clear all and the kit classes are gone');
    await c.close();
    check((await kit(true)).status === 200, 'kit.desk on again');
  }

  /* ---- 3: the fade and Clear all, on Playwright's clock ---- */
  if (!ONLY || ONLY === 'fade') {
    /* Listening off for this part: the minute's status line would otherwise change height and move the cards under a resting pointer */
    check((await api('PATCH', '/gm/stt', { want: 'off' })).status === 200, 'listening off while the clock runs');
    const { c, page: p, seen } = await open({ clock: true });
    await p.evaluate(() => {
      const ctl = window.B68GmAssist.live()[0].ctl;
      window.__undone = 0;
      ctl.addCard({ id: 't-undo', kind: 'done', headline: 'Ticked the fixture Alarm clock to 3.', undo: () => { window.__undone++; } });
      ctl.addCard({ id: 't-act', kind: 'idea', headline: 'An offer with something to press.', actions: [{ id: 'go', label: 'Do it', run: () => {} }] });
      ctl.addCard({ id: 't-pin', kind: 'idea', headline: 'An idea the GM pins.' });
      ctl.addCard({ id: 't-idea', kind: 'idea', headline: 'An idea nobody touches.' });
      ctl.addCard({ id: 't-hold', kind: 'idea', headline: 'An idea the GM points at.' });
    });
    /* a rule that arrives with the panel shut goes to the toast stack when the kit has one (B68Ui.toast: KS03), with Open; here a stand-in records it */
    await p.evaluate(() => {
      window.__toasts = []; window.__hadToast = window.B68Ui.toast;
      window.B68Ui.toast = (o) => { window.__toasts.push(o); return { id: 'x', dismiss() {} }; };
      window.B68GmAssist.live()[0].ctl.addCard({ id: 't-rule', kind: 'rule', headline: 'A rule slip that arrives with the panel shut.' });
    });
    const toast = await p.evaluate(() => ({ n: window.__toasts.length, t: window.__toasts[0] && window.__toasts[0].text, tone: window.__toasts[0] && window.__toasts[0].tone, open: window.__toasts[0] && window.__toasts[0].undo && window.__toasts[0].undo.label, strip: !document.querySelector('#as-banner').hidden }));
    check(toast.n === 1 && /Rule: A rule slip/.test(toast.t) && toast.tone === 'info' && toast.open === 'Open' && !toast.strip, 'a rule arriving with the panel shut is a toast with Open, not the strip: ' + JSON.stringify(toast));
    await p.evaluate(() => { window.__toasts[0].undo.fn(); window.B68Ui.toast = window.__hadToast; });
    await p.waitForFunction(() => document.querySelector('.gm-assist').getAttribute('data-state') === 'open', null, { timeout: 3000 });
    check(true, 'its Open opens the panel');
    await p.waitForTimeout(250);
    await p.waitForFunction(() => document.querySelectorAll('#as-list .kbl-card').length === 12, null, { timeout: 3000 });
    check(await p.$$eval('#as-list .kbl-card[data-id="t-undo"] .kbl-pin, #as-list .kbl-card[data-id="t-act"] .kbl-pin', (l) => l.length === 0) && !!(await p.$('#as-list .kbl-card[data-id="t-pin"] .kbl-pin')),
      'a Pin on the ideas that can fade, none on cards with something to press');
    await p.click('#as-list .kbl-card[data-id="t-pin"] .kbl-pin');
    check((await p.getAttribute('#as-list .kbl-card[data-id="t-pin"] .kbl-pin', 'aria-pressed')) === 'true', 'pinned');
    const held = 't-hold';      /* the newest card, first in the feed: nothing above it moves while the pointer rests on it */
    await p.hover('#as-list .kbl-card[data-id="' + held + '"] .kbl-text');
    const hs = await p.evaluate(() => window.B68KitBlade.views()[0]._state().held);
    const before = dismissals(seen).length;
    await p.clock.fastForward(83000);
    await p.waitForFunction(() => { const x = document.querySelector('#as-list .kbl-card[data-id="t-idea"]'); return x && x.hasAttribute('data-kbl-fading'); }, null, { timeout: 4000 }).catch(() => null);
    check(await p.$eval('#as-list .kbl-card[data-id="t-idea"]', (x) => x.hasAttribute('data-kbl-fading')).catch(() => false), 'near 90 s the untouched idea dims');
    check(!(await p.$eval('#as-list .kbl-card[data-id="' + held + '"]', (x) => x.hasAttribute('data-kbl-fading'))), 'the idea under the pointer does not (held: ' + JSON.stringify(hs) + ' -> ' +
      JSON.stringify(await p.evaluate(() => window.B68KitBlade.views()[0]._state().held)) + ')');
    await p.clock.fastForward(9000);
    await until(async () => !(await ids(p)).includes('t-idea'), 4000);
    const left = await ids(p);
    check(!left.includes('t-idea') && !left.some((x) => x.startsWith('showrunner|') || x.startsWith('mystery|')), 'past 90 s the ideas nobody held have faded');
    check(left.includes('t-undo'), 'the card with Undo outlives the fade');
    check(left.includes('t-act') && left.includes('t-pin') && left.includes(held), 'so do the idea with an action, the pinned idea and the idea under the pointer');
    check(left.some((x) => x.startsWith('ref|')) && left.some((x) => x.startsWith('clerk|')), 'other kinds never fade');
    check(dismissals(seen).length === before, 'a fade sends no mark: a reload brings the card back');

    /* Clear all: everything shown with nothing to press, not pinned, not kept */
    await p.mouse.move(5, 5);
    const d0 = dismissals(seen).length;
    await p.click('#as-feed .kbl-clear');
    await until(async () => (await ids(p)).length === 3, 3000);
    const rest = await ids(p);
    check(rest.length === 3 && ['t-undo', 't-act', 't-pin'].every((x) => rest.includes(x)), 'Clear all leaves the Undo card, the card with an action and the pinned idea: ' + rest.join(', '));
    await until(async () => dismissals(seen).length > d0, 3000);
    const cm = dismissals(seen).slice(d0);
    check(cm.length === 1 && cm[0].items.length === 4, 'one dismiss mark for the four logged cards left: ' + JSON.stringify(cm.map((x) => x.items.length)));
    check(!(await shown(p, '#as-feed .kbl-clear')), 'with nothing left to clear, Clear all hides');
    await p.click('#as-list .kbl-card[data-id="t-undo"] .kbl-fold');
    await p.click('#as-list .kbl-card[data-id="t-undo"] [data-as="undo"]');
    check(!!(await until(() => p.evaluate(() => window.__undone === 1), 3000)), 'its Undo still works');
    await c.close();
    check((await api('PATCH', '/gm/stt', { want: 'on' })).status === 200, 'listening on again');
  }

  /* ---- the pictures: Paper and Night, 1366x768 and 1536x864 ---- */
  if (SHOTS && !ONLY) {
    for (const [w, h] of [[1366, 768], [1536, 864]]) for (const theme of ['paper', 'night']) {
      if (w === 1366 && theme === 'paper') continue;
      const { c, page: p } = await open({ w, h, theme });
      await shot(p, 'closed-' + theme + '-' + w);
      await openPanel(p);
      const n = await inView(p);
      await shot(p, 'six-' + theme + '-' + w);
      await p.click('#as-list .kbl-card:nth-child(1) .kbl-fold'); await p.waitForTimeout(200); await shot(p, 'open-' + theme + '-' + w);
      check(n >= 4, theme + ' ' + w + 'x' + h + ': ' + n + ' cards in view; pictured');
      await c.close();
    }
  }

  /* ---- 5: a fresh load with the setting off: nothing of the kit ---- */
  if (!ONLY) {
    check((await kit(false)).status === 200, 'kit.desk off');
    const { c, page: p } = await open({ wantKit: false });
    check(await p.evaluate(() => !document.documentElement.getAttribute('data-kit') && !window.B68KitBlade && !document.querySelector('[data-kbl], .kbl-card, .kbl-clear')), 'off: no kit attribute, no kit file, no kit markup');
    check(await shown(p, '#as-launch') && await p.evaluate(() => document.body.classList.contains('as-tab')), 'off: the right-edge tab, as before');
    check(await p.evaluate(() => [...document.querySelectorAll('link[rel=stylesheet], style[data-href]')].every((l) => !/desk-blade/.test(l.getAttribute('href') || l.getAttribute('data-href') || ''))), 'off: desk-blade.css is not fetched');
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
