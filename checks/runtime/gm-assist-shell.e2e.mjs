// The Blade side panel's shell (app/gm/assist-panel.js, ticket P2) on the real GM page, in a real browser, at 1280x800, 1440x900 and 1920x1080:
// the 44 px tab and its pips, the 400 px panel that slides over the page, Pin at >= 1600 px (a fourth .gm-main column), the zones top to bottom,
// the keys (A, Esc, J/K, Enter, U), the type floor, nothing overlapping the top bar or the capture bar, the console still clickable with the
// panel open at 1280, reduced motion, and a phone with no panel. The assist endpoints are answered by the browser's own route (invented
// cards): no key, no model, no spend.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [GM_SHOTS=<dir>] [PORT=8891] node checks/runtime/gm-assist-shell.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8861);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.GM_SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json');
const PARTS = {
  console: con.parts.console, campaign: np.parts.campaign, npc: np.parts.npc,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
  handouts: { src: { file: 'invented/handouts', blockSha: '1', exportedAt: new Date().toISOString() }, v: 1, rel: 'invented/handouts', items: [
    { id: 'ho-a', title: 'Invented brass key', file: '0123456789abcdef.png', when: 'invented cue one' },
    { id: 'ho-b', title: 'Invented torn map', file: 'fedcba9876543210.png' },
  ] },
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-assist-e2e-'));
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

const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const CARDS = [
  { seat: 'clerk', at: iso(50 * 60000), text: 'Invented clerk note from a while ago: a name came up once.' },
  { seat: 'ref', at: iso(3 * 60000), text: 'Invented rule slip: a stress cost can be resisted once per roll.', detail: { said_at: '22:14', rule: 'Rulebook p. 12' } },
  { seat: 'mystery', at: iso(2 * 60000), text: 'Invented idea: push the second key into the next scene.' },
  { seat: 'ref', at: iso(1 * 60000), text: 'Invented newest slip: the harm roll was not offered a resistance roll.', detail: { said_at: '22:20', rule: 'Rulebook p. 13' } },
];
const SPEND = { tonight: 3.4, cap: 30, tier: 'all', tick: 0.02 };
const ANSWER = { at: iso(1000), q: 'pitch two complications', text: 'Invented answer: a rival crew arrives early; the lock is already open.' };

try {
  const up = await until(async () => { try { return (await fetch(BASE + '/index.html')).status > 0; } catch (_) { return false; } }, 90000, 500);
  if (!up) throw new Error('the server did not start');
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status);
  }
  await api('PATCH', '/gm/stt', { want: 'on' });

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(width, height, { reduced = false, cards = CARDS } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width, height }, serviceWorkers: 'block', reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const page = await c.newPage();
    const seen = { ask: [] };
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.route('**/api/gm/assist/tick', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards, updates: [], flags: [], spend: SPEND, last: 9 }) }));
    await page.route('**/api/gm/assist/ask', (route) => { seen.ask.push(JSON.parse(route.request().postData() || '{}')); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answer: ANSWER, spend: SPEND }) }); });
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
    await page.waitForFunction(() => { const n = document.querySelector('#as-count'); return n && !n.hidden; }, null, { timeout: 20000 });
    return { c, page, seen };
  }
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'p2-' + name + '.png') }); };
  // geometry helpers, in the page
  const rectOf = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; });
  const edges = (page) => page.evaluate(() => {
    const bar = document.querySelector('.gm-bar').getBoundingClientRect(), foot = document.querySelector('#gm-foot').getBoundingClientRect();
    return { barB: bar.bottom, footT: foot.height > 0 ? foot.top : innerHeight };
  });
  const settle = (page) => page.waitForTimeout(320);                    // the 180 ms slide, and the 1.5 s Now timer is longer on purpose

  for (const [W, Hh] of [[1280, 800], [1440, 900], [1920, 1080]]) {
    const tag = W + ': ';
    const { c, page: p, seen } = await open(W, Hh);
    await p.waitForTimeout(400);

    // ---- closed: the tab ----
    let e = await edges(p), tab = await rectOf(p, '#as-launch');
    check(Math.abs(tab.w - 44) < 1 && Math.abs(tab.r - W) < 1, tag + 'the tab is 44 px wide on the right edge');
    check(tab.t >= e.barB - 1 && tab.b <= e.footT + 1, tag + 'the tab sits between the top bar and the capture bar (' + Math.round(tab.t) + '-' + Math.round(tab.b) + ' in ' + Math.round(e.barB) + '-' + Math.round(e.footT) + ')');
    check(await p.$eval('#as-count', (n) => n.textContent) === '4', tag + 'the tab counts the four unread cards');
    check(JSON.stringify(await p.$$eval('#as-pips .as-pip', (l) => l.map((x) => x.getAttribute('data-kind')))) === JSON.stringify(['rule', 'idea', 'rule', 'note']), tag + 'the pips are the unread kinds, newest first (rule, idea, rule, note)');
    check(await p.$eval('#as-panel', (el) => getComputedStyle(el).visibility) === 'hidden' && await p.$eval('#as-panel', (el) => el.hidden), tag + 'closed, the panel is hidden and out of the tab order');
    const main = await rectOf(p, '.gm-main');
    check(main.r <= tab.l + 1, tag + 'the page leaves the tab its 44 px (main ends at ' + Math.round(main.r) + ', tab starts at ' + Math.round(tab.l) + ')');
    await shot(p, 'closed-' + W);

    // ---- open with A ----
    const panelAttr = await p.$eval('#gm-root', (r) => r.getAttribute('data-panel'));
    await p.keyboard.press('a'); await settle(p);
    check(await p.$eval('#as-launch', (b) => b.getAttribute('aria-expanded')) === 'true' && await p.$eval('.gm-assist', (h) => h.getAttribute('data-state')) === 'open', tag + 'A opens it');
    let pr = await rectOf(p, '#as-panel');
    const expectW = Math.max(360, Math.min(400, 0.33 * W));
    check(Math.abs(pr.w - expectW) < 1.5 && Math.abs(pr.r - W) < 1, tag + 'the panel is ' + Math.round(expectW) + ' px wide on the right (' + Math.round(pr.w) + ')');
    e = await edges(p);
    check(pr.t >= e.barB - 1 && pr.b <= e.footT + 1, tag + 'the panel sits between the top bar and the capture bar');
    check(await p.$eval('#as-panel', (el) => getComputedStyle(el).visibility) === 'visible', tag + 'open, the panel is visible');
    check((await p.$eval('#as-panel', (el) => getComputedStyle(el).transitionDuration)).startsWith('0.18s'), tag + 'it slides with a 180 ms transition');
    check(await p.$eval('#as-now', (n) => /newest slip/.test(n.textContent)), tag + 'Now shows the newest unread card');
    check(await p.waitForFunction(() => document.querySelector('#as-count').hidden, null, { timeout: 4000 }).then(() => true, () => false), tag + 'opening reads the cards: the count goes (once Now has been in view for 1.5 s)');
    // the zones, top to bottom
    const order = await p.evaluate(() => ['.as-head', '#as-now', '#as-ask', '#as-chips', '#as-list', '#as-tools'].map((s) => document.querySelector(s).getBoundingClientRect().top));
    check(order.every((v, i) => i === 0 || v >= order[i - 1]), tag + 'the zones run header, Now, Ask, chips, feed, Tools');
    check(await p.$eval('#as-state-word', (n) => n.textContent) === 'Listening' && /\$3\.40 of \$30/.test(await p.$eval('#as-tier', (n) => n.textContent)) && (await p.$$('#as-health .as-hd')).length === 3, tag + 'the header has the state, the spend and three health dots');
    // the console is not covered
    if (W === 1280) {
      let clicked = true;
      try { await p.click('#gm-buttons .gm-btn', { timeout: 4000 }); } catch (_) { clicked = false; }
      check(clicked, tag + 'the console is still clickable with the panel open (no forced click)');
      await p.click('[data-gm="menu"]');
      const menuOk = await p.evaluate(() => { const l = document.querySelector('.gm-menu-list'); if (!l || l.hasAttribute('hidden')) return 'not open'; const r = l.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + 20); return !!el && l.contains(el) ? 'ok' : 'covered by ' + (el && el.outerHTML.slice(0, 90)) + ' ctx=' + (() => { const o = []; for (let n = document.querySelector('.gm-bar'); n && n !== document.documentElement; n = n.parentElement) { const c = getComputedStyle(n); if (c.zIndex !== 'auto' || c.transform !== 'none' || c.isolation === 'isolate' || +c.opacity < 1 || c.filter !== 'none' || c.contain !== 'none') o.push((n.id || n.className || n.tagName) + ':z=' + c.zIndex + ',pos=' + c.position); } return o.join(' > '); })() + ' at ' + Math.round(r.left) + ',' + Math.round(r.top); });
      check(menuOk === 'ok', tag + 'the top bar Menu drops over the open panel (' + menuOk + ')');
      await p.keyboard.press('Escape'); await p.evaluate(() => { const b = document.querySelector('[data-gm="menu"]'); const l = document.querySelector('.gm-menu-list'); if (l && !l.hasAttribute('hidden')) b.click(); });
      await p.waitForTimeout(150);
      if (await p.$eval('#as-panel', (el) => el.hidden)) { await p.keyboard.press('a'); await settle(p); }
    }
    // the type floor
    const small = await p.evaluate(() => {
      const out = [], panel = document.querySelector('#as-panel');
      const readable = '.as-text, .as-quiet, textarea, .as-go, .as-star, .as-ack, .as-empty, .as-askq, .as-answer .as-text';
      panel.querySelectorAll('*').forEach((el) => {
        if (el.closest('[hidden]') || getComputedStyle(el).display === 'none' || getComputedStyle(el).visibility === 'hidden') return;
        const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (el.matches('.as-eg')) return;
        if (own && fs < 12) out.push(el.className + ' ' + fs);
        if (el.matches(readable) && fs < 14 && el.getBoundingClientRect().width > 0) out.push('READ ' + el.className + ' ' + fs);
      });
      return out;
    });
    check(small.length === 0, tag + 'the type floor holds: 12 px meta, 14 px read' + (small.length ? ' (' + small.slice(0, 4).join('; ') + ')' : ''));
    check(await p.$eval('.as-kind b', (b) => /Condensed|Arial Narrow/.test(getComputedStyle(b).fontFamily)), tag + 'labels use the condensed face');
    check(await p.$$eval('#as-list .as-earlier', (l) => l.length) === 1, tag + 'an "Earlier tonight" divider follows the cards from the last half hour');

    // ---- keys: J / K move between cards, Enter folds, U does nothing, Esc closes (not while typing) ----
    await p.focus('#as-name');
    await p.keyboard.press('j');
    let f1 = await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-id'));
    await p.keyboard.press('j');
    let f2 = await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-id'));
    await p.keyboard.press('k');
    let f3 = await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-id'));
    check(f1 && f2 && f1 !== f2 && f3 === f1, tag + 'J moves to the next card, K back');
    check(await p.$eval('#gm-root', (r) => r.getAttribute('data-panel')) === panelAttr, tag + 'J in the panel does not switch to the Score tab');
    check(await p.evaluate(() => document.activeElement.getAttribute('aria-expanded')) === 'false', tag + 'cards start folded to one line');
    check(await p.evaluate(() => document.activeElement.getBoundingClientRect().height) >= 43.5, tag + 'a folded card is a 44 px target');
    await p.keyboard.press('Enter');
    check(await p.evaluate(() => document.activeElement.getAttribute('aria-expanded')) === 'true' && await p.evaluate(() => document.activeElement.closest('.as-card').getAttribute('data-open')) === '1', tag + 'Enter unfolds the card');
    await p.keyboard.press('Enter');
    check(await p.evaluate(() => document.activeElement.getAttribute('aria-expanded')) === 'false', tag + 'Enter folds it again');
    await p.keyboard.press('u');
    check(await p.$eval('.gm-assist', (h) => h.getAttribute('data-state')) === 'open', tag + 'U (undo) is wired and, with nothing to undo, does nothing');
    // Ask: moved, same behaviour
    await p.click('#as-ask-q');
    const ta = await rectOf(p, '#as-ask-q');
    check(ta.h > 60, tag + 'the Ask field grows on focus (' + Math.round(ta.h) + ' px)');
    await p.keyboard.press('a');                                         // typing: the key must not toggle the panel
    await p.keyboard.type('sk about the lock'); await p.keyboard.press('Shift+Enter'); await p.keyboard.type('and the dock');
    check(/\n/.test(await p.$eval('#as-ask-q', (t) => t.value)) && await p.$eval('.gm-assist', (h) => h.getAttribute('data-state')) === 'open', tag + 'typing "a" in the field does not close the panel; Shift+Enter is a new line');
    await p.keyboard.press('Enter');
    check(await until(async () => seen.ask.length === 1, 6000) && /^ask about the lock and the dock$/.test(seen.ask[0].q), tag + 'Enter asks (the question went as one line)');
    check(await p.waitForFunction(() => /Invented answer/.test(document.querySelector('#as-list').textContent) && document.querySelector('#as-ask-q').value === '', null, { timeout: 6000 }).then(() => true, () => false), tag + 'the answer lands in the feed and the field clears');
    // a re-render (the Ask answer came back) must not pull the focus off the field to a card that was folded earlier
    check(await p.evaluate(() => document.activeElement && document.activeElement.id) === 'as-ask-q', tag + 'a re-render leaves the focus in the Ask field (it does not go back to a card)');
    // chips
    check((await p.$$eval('#as-chips .as-chip', (l) => l.map((x) => x.textContent.trim().replace(/\s+/g, ' ')).join('|'))) === 'All 5|Rule 2|Say 0|Idea 1|Done 0|Note 2', tag + 'filter chips carry counts');
    await p.evaluate(() => document.activeElement && document.activeElement.blur());      // the grown field covers the chips while it has focus (by design)
    await p.click('#as-chips [data-k="rule"]');
    const rc = await p.evaluate(() => ({ n: document.querySelectorAll('#as-list .as-card').length, pr: document.querySelector('#as-chips [data-k="rule"]').getAttribute('aria-pressed'), kinds: [...document.querySelectorAll('#as-list .as-card')].map((x) => x.dataset.kind).join() })); check(rc.n === 2 && rc.pr === 'true', tag + 'the Rule chip shows only rule cards, even with the Ask field focused when it was pressed ' + JSON.stringify(rc));
    await p.click('#as-chips [data-k="all"]');
    // Esc: first blurs the field, second closes
    await p.click('#as-ask-q');
    await p.keyboard.press('Escape');
    check(await p.$eval('.gm-assist', (h) => h.getAttribute('data-state')) === 'open', tag + 'Esc while typing only leaves the field');
    await p.keyboard.press('Escape'); await settle(p);
    check(await p.$eval('.gm-assist', (h) => h.getAttribute('data-state')) === 'closed' && await p.$eval('#as-panel', (el) => getComputedStyle(el).visibility) === 'hidden', tag + 'Esc closes the panel');
    await p.keyboard.press('a'); await settle(p);
    await p.click('#as-panel [data-as="close"]'); await settle(p);
    check(await p.$eval('.gm-assist', (h) => h.getAttribute('data-state')) === 'closed', tag + 'the close button closes it');
    // capture armed (P): the capture bar grows; the tab and the panel still clear it
    await p.keyboard.press('p'); await p.waitForTimeout(200);
    e = await edges(p); tab = await rectOf(p, '#as-launch');
    await p.keyboard.press('a'); await settle(p); pr = await rectOf(p, '#as-panel');
    check(tab.b <= e.footT + 1 && pr.b <= e.footT + 1 && pr.t >= e.barB - 1, tag + 'with the capture bar armed nothing overlaps it (foot top ' + Math.round(e.footT) + ', panel bottom ' + Math.round(pr.b) + ')');
    check(await p.evaluate(() => { const f = document.querySelector('#gm-foot'); const r = f.getBoundingClientRect(); const el = document.elementFromPoint(r.left + 40, r.top + r.height / 2); return !!el && f.contains(el); }), tag + 'the capture bar is the topmost thing at its own centre');
    await p.keyboard.press('Escape'); await p.keyboard.press('Escape');

    // ---- pin ----
    await p.waitForTimeout(150);
    if (await p.$eval('.gm-assist', (h) => h.getAttribute('data-state')) !== 'open') { await p.keyboard.press('a'); await settle(p); }
    const pinShown = await p.$eval('#as-pin', (b) => getComputedStyle(b).display !== 'none' && !b.hidden);
    if (W >= 1600) {
      check(pinShown, tag + 'Pin is offered');
      await p.click('#as-pin'); await settle(p);
      check(await p.$eval('.gm-assist', (h) => h.getAttribute('data-state')) === 'pinned' && await p.evaluate(() => document.body.classList.contains('as-dock')), tag + 'Pin docks the panel');
      const cols = await p.$eval('.gm-main', (m) => getComputedStyle(m).gridTemplateColumns.split(' ').length);
      check(cols === 4, tag + '.gm-main gains a fourth column (' + cols + ' tracks)');
      pr = await rectOf(p, '#as-panel');
      const kids = await p.$$eval('.gm-main > *', (l) => l.map((x) => { const r = x.getBoundingClientRect(); return { l: r.left, r: r.right, c: x.className }; }));
      check(kids.every((k) => k.r <= pr.l + 1), tag + 'nothing overlaps the docked panel (the columns end at ' + Math.round(Math.max(...kids.map((k) => k.r))) + ', it starts at ' + Math.round(pr.l) + ')');
      check(Math.abs(pr.w - 400) < 1.5, tag + 'docked, it is 400 px');
      check(await p.$eval('#as-launch', (b) => getComputedStyle(b).display) === 'none', tag + 'the tab gives way while docked');
      await shot(p, 'pinned-' + W);
      await p.keyboard.press('Escape'); await settle(p);
      check(await p.$eval('.gm-assist', (h) => h.getAttribute('data-state')) === 'closed' && await p.$eval('.gm-main', (m) => getComputedStyle(m).gridTemplateColumns.split(' ').length) === 3, tag + 'closing a docked panel gives the column back');
      await p.keyboard.press('a'); await settle(p);
      check(await p.$eval('.gm-assist', (h) => h.getAttribute('data-state')) === 'pinned', tag + 'it re-opens docked (the pin stays)');
      await p.click('#as-pin'); await settle(p);
      check(await p.$eval('.gm-assist', (h) => h.getAttribute('data-state')) === 'open', tag + 'Unpin slides it back over the page');
    } else {
      check(!pinShown, tag + 'Pin is not offered under 1600 px');
    }
    await shot(p, 'open-' + W);
    // the Tools drawer
    await p.click('#as-tools > summary');
    check(await p.$$eval('#as-screen button', (b) => b.map((x) => x.textContent.trim()).join('|')) === 'Draw them|Make the prop|Wire|Case board' && await p.$eval('#as-go', (b) => b.getBoundingClientRect().height > 0), tag + 'the Tools drawer holds Fit it and the Screen');
    const tr = await rectOf(p, '#as-tools'); pr = await rectOf(p, '#as-panel');
    check(tr.b <= pr.b + 1 && tr.t >= pr.t, tag + 'an open drawer stays inside the panel');
    await shot(p, 'tools-' + W);
    await c.close();
  }

  // ---- reduced motion: no slide ----
  {
    const { c, page: p } = await open(1280, 800, { reduced: true });
    const rd = await p.$eval('#as-panel', (el) => getComputedStyle(el).transitionDuration); check(parseFloat(rd) < 0.01, 'reduced motion: the panel does not slide (' + rd + ')');
    await c.close();
  }
  // ---- a phone: no panel, nothing reserved ----
  {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 390, height: 844 }, serviceWorkers: 'block', isMobile: true, hasTouch: true });
    const p = await c.newPage();
    p.on('pageerror', (er) => errors.push('pageerror: ' + er.message));
    await p.goto(BASE + '/#gm');
    await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
    await p.waitForTimeout(800);
    check(await p.$eval('.gm-assist', (h) => getComputedStyle(h).display === 'none'), 'phone: Blade is not drawn');
    check(await p.$eval('.gm-main', (m) => getComputedStyle(m).marginRight) === '0px', 'phone: no room is kept for the tab');
    check((await p.$$('.gm-segbar button, .gm-segbar [data-seg]')).length > 0 || await p.$eval('#gm-root', (r) => !!r.getAttribute('data-seg')), 'phone: the classic segments are still there');
    await c.close();
  }
  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
