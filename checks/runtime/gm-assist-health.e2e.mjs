// P5: the Claude box's header on the real GM page, in a real browser, against a local wrangler dev. The tick answer is the browser's own route (invented
// health, cards and spend): no key, no model, no spend. Checks the seat-health dots (state, shape, text), the reaped note, the spend meter's steps, the live regions,
// focus back on the tab, the grown Ask field not covering the chips, and the contrast of every header token pair in the light theme, the dark theme and the OS dark preference.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=8872] node checks/runtime/gm-assist-health.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8872);
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

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-assist-health-e2e-'));
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
  const iso = () => new Date().toISOString();
  const H = (o) => ({ skipped: [], reaped: [], ran: [], ...o });
  const SPEND = { tonight: 1, cap: 20, tier: 'all', tick: 0.02 };
  async function open({ width = 1280, height = 800, colorScheme } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width, height }, serviceWorkers: 'block', colorScheme: colorScheme || 'light' });
    const page = await c.newPage();
    // Date.now() can be pushed forward from the test, so a green dot can grey with no tick to do it
    await page.addInitScript(() => { const real = Date.now.bind(Date); window.__skew = 0; Date.now = () => real() + window.__skew; });
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    const seen = { ticks: 0, reply: null };
    await page.route('**/api/gm/assist/tick', (route) => {
      seen.ticks++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(seen.reply) });
    });
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
    return { c, page, seen };
  }
  // one more tick, on demand: the box polls when the page becomes visible again
  async function tickWith(G, reply) {
    const n = G.seen.ticks; G.seen.reply = reply;
    await G.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    return until(async () => G.seen.ticks > n, 10000).then(async (ok) => { await sleep(250); return ok; });
  }
  const attr = (p, sel, a) => p.$eval(sel, (e, a) => e.getAttribute(a), a);
  const dots = (p) => p.$$eval('.as-hd', (l) => Object.fromEntries(l.map((e) => [e.getAttribute('data-seat'), e.getAttribute('data-health')])));

  // ---- the first answer: the Tripwire and Ref ran, Voice was skipped as still running ----
  const G = await open();
  const p = G.page;
  let n = 0;
  G.seen.reply = { cards: [], updates: [], flags: [], spend: { ...SPEND, tonight: 13 }, last: 1, health: H({ ran: ['tripwire', 'ref'], skipped: [{ seat: 'voice', why: 'in-flight' }] }) };
  check(await p.waitForSelector('.gm-assist .as-launch', { timeout: 15000 }).then(() => true, () => false), 'the launcher is on the GM page');
  check(await until(async () => G.seen.ticks >= 1, 15000), 'the first tick ran (mocked answer)');
  await sleep(300);
  await p.keyboard.press('a');
  check(await p.$eval('#as-panel', (e) => !e.hidden), 'key A opens the box');
  let d = await dots(p);
  check(d.tripwire === 'ok' && d.ref === 'ok' && d.voice === 'asleep', 'one tick: Tripwire and Ref green, Voice grey (one in-flight skip is not amber): ' + JSON.stringify(d));
  const hdText = await p.$$eval('.as-hd', (l) => l.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  check(/Tripwire: ran in the last 10 minutes/.test(hdText[0]) && /Ref: ran in the last 10 minutes/.test(hdText[1]) && /Voice: asleep/.test(hdText[2]), 'each dot has its meaning as text a screen reader reads: ' + JSON.stringify(hdText));
  check(await p.$eval('#as-health', (e) => e.getAttribute('role') === 'group' && /health/i.test(e.getAttribute('aria-label'))), 'the dots sit in a labelled group');
  check(await p.$eval('.as-hd[data-seat="voice"] i', (e) => e.getAttribute('aria-hidden') === 'true') && await p.$eval('.as-hd[data-seat="voice"] b', (e) => e.getAttribute('aria-hidden') === 'true'), 'the drawn dot and its letter are hidden from a screen reader (the text speaks)');

  // shape differs by state, as well as colour
  const shape = (seat) => p.$eval('.as-hd[data-seat="' + seat + '"] i', (e) => { const s = getComputedStyle(e); return { bg: s.backgroundColor, radius: s.borderTopLeftRadius, bstyle: s.borderTopStyle, tf: s.transform }; });
  const sOk = await shape('ref'), sAsleep = await shape('voice');
  check(sOk.bg !== 'rgba(0, 0, 0, 0)' && sAsleep.bg === 'rgba(0, 0, 0, 0)', 'ok is a filled disc, asleep an empty ring (not colour alone)');

  // ---- the second answer: Voice skipped as in-flight again -> amber, with a different shape ----
  await tickWith(G, { cards: [], updates: [], flags: [], spend: { ...SPEND, tonight: 13 }, last: 2, health: H({ ran: ['tripwire'], skipped: [{ seat: 'voice', why: 'in-flight' }] }) });
  d = await dots(p);
  check(d.voice === 'stuck' && d.ref === 'ok' && d.tripwire === 'ok', 'two in-flight skips in a row: Voice amber, the others unchanged: ' + JSON.stringify(d));
  const sStuck = await shape('voice');
  check(sStuck.tf !== 'none' && sStuck.radius === '0px' && sOk.radius !== '0px', 'amber is a diamond, green a round disc');
  check(/Voice: stuck/.test(await p.$eval('.as-hd[data-seat="voice"]', (e) => e.textContent)) && /stuck/.test(await attr(p, '.as-hd[data-seat="voice"]', 'title')), 'and its text and tooltip say stuck');
  check(await p.$eval('#as-reaped', (e) => e.hidden), 'no reaped note yet');

  // ---- reaped: one quiet line, the amber clears ----
  await tickWith(G, { cards: [], updates: [], flags: [], spend: { ...SPEND, tonight: 13 }, last: 3, health: H({ reaped: ['voice'], ran: ['tripwire'] }) });
  const note = await p.$eval('#as-reaped', (e) => ({ hidden: e.hidden, text: e.textContent, role: e.getAttribute('role') }));
  check(!note.hidden && /freed a stuck seat \(Voice\)/.test(note.text) && note.role === 'status', 'reaped shows one status line: ' + note.text);
  check((await dots(p)).voice === 'asleep', 'and Voice is no longer amber');
  await tickWith(G, { cards: [], updates: [], flags: [], spend: { ...SPEND, tonight: 13 }, last: 4, health: H({ ran: ['tripwire'] }) });
  check(await p.$eval('#as-reaped', (e) => e.hidden), 'the note goes on the next tick that reports none');

  // ---- time alone greys a dot: 11 minutes on, with only a health-less answer ----
  await p.evaluate(() => { window.__skew = 11 * 60 * 1000; });
  await tickWith(G, { cards: [], updates: [], flags: [], spend: { ...SPEND, tonight: 13 }, last: 5 });
  d = await dots(p);
  check(d.ref === 'asleep' && d.tripwire === 'asleep', 'Ref and the Tripwire, last run 11 minutes ago, are grey: ' + JSON.stringify(d));
  await p.evaluate(() => { window.__skew = 0; });

  // ---- the spend meter ----
  const meter = () => p.$eval('#as-meter', (e) => ({ tone: e.getAttribute('data-tone'), on: e.querySelectorAll('i.on').length, label: e.getAttribute('aria-label'), role: e.getAttribute('role') }));
  let m = await meter();
  check(m.tone === 'mid' && m.on === 3 && m.role === 'img' && /65%/.test(m.label), 'meter at 65%: three cells, mustard step, said in words: ' + JSON.stringify(m));
  await tickWith(G, { cards: [], updates: [], flags: [], spend: { ...SPEND, tonight: 18 }, last: 6 });
  m = await meter();
  check(m.tone === 'warn' && m.on === 5 && /nearly used up/.test(m.label), 'meter at 90%: the red step: ' + JSON.stringify(m));
  await tickWith(G, { cards: [], updates: [], flags: [], spend: { ...SPEND, tonight: 3 }, last: 7 });
  m = await meter();
  check(m.tone === 'ok' && m.on === 1, 'meter at 15%: one green cell: ' + JSON.stringify(m));
  check(/Full · \$3\.00 of \$20/.test(await p.$eval('#as-tier', (e) => e.textContent)), 'the spend line is still written beside it');

  // ---- live regions ----
  const live = await p.evaluate(() => ({
    list: document.querySelector('#as-list').getAttribute('aria-live'), now: document.querySelector('#as-now').getAttribute('aria-live'),
    alert: document.querySelector('#as-alert').getAttribute('aria-live'), alertOutside: !document.querySelector('#as-panel').contains(document.querySelector('#as-alert')),
  }));
  check(live.list === 'polite' && live.now === 'polite', 'the feed and Now are polite live regions');
  check(live.alert === 'assertive' && live.alertOutside, 'the warn region is assertive, and outside the panel (a closed panel is hidden)');
  await p.keyboard.press('Escape');
  check(await p.$eval('#as-panel', (e) => e.hidden), 'Escape closes the box');
  check(await p.evaluate(() => document.activeElement && document.activeElement.id) === 'as-launch', 'focus returns to the tab on Escape');
  await tickWith(G, { cards: [{ seat: 'ref', kind: 'rule', at: iso(), text: 'Invented rule slip: a quiet one.' }], updates: [], flags: [], spend: SPEND, last: 8 });
  check((await p.$eval('#as-alert', (e) => e.textContent)) === '', 'a rule card does not use the assertive region');
  await tickWith(G, { cards: [{ seat: 'ref', kind: 'warn', at: new Date(Date.now() + 2000).toISOString(), text: 'Invented warning: the long clock is nearly full.' }], updates: [], flags: [], spend: SPEND, last: 9 });
  check(/^Warning: .*long clock is nearly full/.test(await p.$eval('#as-alert', (e) => e.textContent)), 'a warn arriving while the panel is closed is spoken');
  // a reload must not re-announce (restore never touches the alert)
  // ---- focus returns to the tab on every close path ----
  await p.click('#as-launch');
  check(await p.$eval('#as-panel', (e) => !e.hidden) && await p.evaluate(() => document.activeElement.id) === 'as-name', 'the launcher opens the box and focus goes in');
  await p.click('.as-x');
  check(await p.$eval('#as-panel', (e) => e.hidden) && await p.evaluate(() => document.activeElement.id) === 'as-launch', 'the close button returns focus to the tab');
  await p.keyboard.press('a');
  check(await p.$eval('#as-panel', (e) => !e.hidden), 'A opens');
  await p.keyboard.press('a');
  check(await p.$eval('#as-panel', (e) => e.hidden) && await p.evaluate(() => document.activeElement.id) === 'as-launch', 'A closes it and focus is on the tab');
  await p.keyboard.press('a');

  // ---- the grown Ask field does not cover the chips ----
  await p.click('#as-ask-q');
  await sleep(300);
  const cover = await p.evaluate(() => {
    const chip = document.querySelector('#as-chips .as-chip'); if (!chip) return { none: true };
    const r = chip.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, top = document.elementFromPoint(x, y);
    return { none: false, ok: top === chip || chip.contains(top), top: top && (top.id || top.className || top.tagName), taH: document.querySelector('#as-ask-q').getBoundingClientRect().height };
  });
  check(!cover.none && cover.ok && cover.taH > 60, 'with the Ask field focused (' + Math.round(cover.taH || 0) + ' px) the chips row is still on top of nothing: ' + JSON.stringify(cover));
  await p.click('#as-chips .as-chip[data-k="rule"]');
  check(await attr(p, '#as-chips .as-chip[data-k="rule"]', 'aria-pressed') === 'true', 'and a chip tapped while the field was focused applies its filter');
  check(await p.$eval('#as-panel > .as-body', (e) => { const c = getComputedStyle(e); return c.display === 'flex' && c.borderTopWidth === '0px'; }), 'the panel body is a plain flex column (the card .as-body rule had been reaching it, stretching the Ask bar)');
  // blur collapses the field's room again: 500 ms after the focus leaves, the chip is back where it rests
  // the chip's place below the Ask field (the panel may scroll a focused field into view, so a page coordinate would move for that reason alone)
  const chipTop = () => p.evaluate(() => Math.round(document.querySelector('#as-chips .as-chip[data-k="rule"]').getBoundingClientRect().top - document.querySelector('#as-ask-q').parentElement.getBoundingClientRect().top));
  await p.click('#as-name'); await sleep(500);
  const rest = await chipTop();                    // the resting place: no focus in the field
  await p.click('#as-ask-q'); await sleep(100);
  const grown = await chipTop();
  check(grown - rest >= 30, 'focused, the field pushes the chip down (' + rest + ' -> ' + grown + ')');
  await p.click('#as-name');                       // focus moves off the field
  check(await p.evaluate(() => document.activeElement.id) !== 'as-ask-q', 'the Ask field has lost focus');
  await sleep(500);
  check(await chipTop() === rest, 'the chip is back at its resting place 500 ms after blur (' + await chipTop() + ' vs ' + rest + ')');
  await p.click('#as-ask-q'); await sleep(100);
  check(await chipTop() === grown, 'focusing again pushes it down to the same place');
  await p.click('#as-name'); await sleep(500);
  check(await chipTop() === rest, 'and back to rest again (not a one-off)');
  await p.keyboard.press('Escape');

  // ---- contrast: every token pair the header uses, in both themes and the OS dark preference ----
  async function contrast(page, label) {
    const out = await page.evaluate(() => {
      const parse = (s) => { const m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
      const lum = (c) => { const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const effBg = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0.99) return c; } return parse(getComputedStyle(document.body).backgroundColor); };
      const res = [];
      const panel = document.querySelector('#as-panel');
      // non-text: the shape's edge or fill against what is behind it, 3:1
      ['unknown', 'ok', 'asleep', 'stuck'].forEach((st) => { const hd = document.querySelector('.as-hd[data-seat="ref"]'); hd.setAttribute('data-health', st); const i = hd.querySelector('i'), s = getComputedStyle(i);
        const bg = effBg(i.parentElement); const best = Math.max(...[s.borderTopColor, s.backgroundColor].map(parse).filter((c) => c && c.a > 0.5).map((c) => ratio(c, bg))); res.push(['dot ' + st, best, 3]); });
      ['ok', 'mid', 'warn'].forEach((tone) => { const mt = document.querySelector('#as-meter'); mt.setAttribute('data-tone', tone);
        mt.innerHTML = '<i class="on"></i><i></i>'; const bg = effBg(mt.parentElement);
        const on = getComputedStyle(mt.children[0]), off = getComputedStyle(mt.children[1]);
        res.push(['meter ' + tone + ' filled cell', Math.max(...[on.borderTopColor, on.backgroundColor].map(parse).filter((c) => c && c.a > 0.5).map((c) => ratio(c, bg))), 3]);
        res.push(['meter empty cell', Math.max(...[off.borderTopColor].map(parse).map((c) => ratio(c, bg))), 3]); });
      // text, 4.5:1
      const text = (name, el) => { const s = getComputedStyle(el); res.push([name, ratio(parse(s.color), effBg(el)), 4.5]); };
      const st = document.querySelector('#as-state');
      ['on', 'paused', 'off', 'setup', 'wait'].forEach((k) => { st.setAttribute('data-state', k); text('state word ' + k, st); });
      text('seat letter', document.querySelector('.as-hd b'));
      const tier = document.querySelector('#as-tier'); tier.hidden = false; tier.textContent = 'Full · $1 of $20';
      ['all', 'reduced', 'core', 'off'].forEach((k) => { tier.setAttribute('data-tier', k); text('tier line ' + k, tier); });
      const nt = document.querySelector('#as-reaped'); nt.hidden = false; nt.textContent = 'Blade freed a stuck seat (Ref). It is working again.'; text('reaped note', nt);
      // the card kinds (outside the header, measured here so the pairs are on record): the kind badge's text on its colour is a 4.5:1 pair and is held to it;
      // the card's left bar and the closed tab's pips are redundant (the card has a --rule outline and the badge says the kind; a pip has a --rule edge), so their
      // 3:1 is reported and not held
      const list = document.querySelector('#as-list'), info = [];
      ['rule', 'say', 'idea', 'done', 'warn', 'note'].forEach((k) => {
        const li = document.createElement('li'); li.className = 'as-card'; li.setAttribute('data-kind', k); li.innerHTML = '<span class="as-kind"><b>x</b></span>'; list.appendChild(li);
        const b = li.querySelector('.as-kind'), bs = getComputedStyle(b), bg = effBg(li), bar = parse(getComputedStyle(li).borderLeftColor);
        res.push(['kind badge text ' + k, ratio(parse(bs.color), parse(bs.backgroundColor)), 4.5]);
        info.push(k + ' bar ' + (Math.round(ratio(bar, bg) * 100) / 100));
        list.removeChild(li);
      });
      window.__barInfo = info.join(', ');
      return res.map(([n, r, need]) => ({ n, r: Math.round(r * 100) / 100, need }));
    });
    const bad = out.filter((x) => x.r < x.need);
    console.log('INFO ' + label + ' card bars vs card (3:1 not held): ' + await page.evaluate(() => window.__barInfo));
    check(bad.length === 0 && out.length >= 26, label + ': ' + out.length + ' pairs, all at or over their ratio' + (bad.length ? ' (FAIL: ' + bad.map((x) => x.n + ' ' + x.r + '<' + x.need).join('; ') + ')' : ' (lowest ' + Math.min(...out.map((x) => x.r)) + ')'));
  }
  await p.keyboard.press('a');
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  await contrast(p, 'light theme');
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  await contrast(p, 'dark theme');
  await p.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  await p.emulateMedia({ colorScheme: 'dark' });
  check(await p.evaluate(() => getComputedStyle(document.querySelector('#as-panel')).backgroundColor) === 'rgb(42, 37, 33)', 'the OS dark preference with no theme attribute really gives the dark card (the test is measuring dark)');
  await contrast(p, 'OS dark preference');
  await p.emulateMedia({ colorScheme: 'light' });
  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await G.c.close();
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
