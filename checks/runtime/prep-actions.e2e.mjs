// Prep actions (PA) on the demo night (scripts/demo-night.mjs: the invented Pelican Rooms), the real GM page and the real display page:
//   off      the demo note has no action span: gm/prep-actions.js is never fetched, and the module's decorate leaves the note byte-for-byte as it was
//   chips    an invented section with each chip kind (a paragraph, a list item, a table's first cell, a callout): a handout chip reads as the handout's
//            title, a missing handout, an unknown verb and the crew sheet are muted with a reason; the table row stays one row tall
//   handout  a tap shows it on the shared screen (the display GET and the display DOM); a GM-ONLY- cue never reaches either
//   clock    a tap adds the table clock once, hidden: a second tap adds nothing; the display GET and a phone's GET never hold its name; Undo takes it off
//   rule     the pop-over opens on a tap and shuts by Esc, a tap outside and its ✕; a hover opens it; Open in Rules goes to the rules
//   PA2      a person's card in Prep has a ✕ in sight at its top right, 44 px or more, and it closes the card; the Run view's NPC card the same,
//            and a tap outside it closes it
// Invented fixtures only: two generated PNGs written into the git-ignored app/media/handouts/ for the run (removed after).
//   PW_MODULE=<playwright-core> [PW_CHANNEL=msedge] [PORT=12400] [SIZES=1366x768] [KIT_SHOTS=<dir>] node checks/runtime/prep-actions.e2e.mjs
//   WebKit as an iPad: PW_MODULE=app/checks/pw-webkit.js PW_CORE_DIR=<playwright-core> PW_DEVICE=ipad SIZES=1180x820,1024x768
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 12400);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test', P1 = 'player1@example.test';
const SHOTS = process.env.KIT_SHOTS || '';
const WK = /webkit/i.test(process.env.PW_MODULE || '');
const TAG = WK ? 'webkit' : 'edge';
const SIZES = (process.env.SIZES || '1366x768').split(',').map((s) => s.split('x').map(Number));
const PW = require(process.env.PW_MODULE || 'playwright-core'), { chromium } = PW;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 150) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j, text: t }; });

/* a flat generated PNG: bands of colour, no art */
function png(w, h, seed) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3, c = [[200, 180, 140], [120, 140, 170], [150, 170, 160]][(Math.floor(y / (h / 3)) + seed) % 3]; raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const MEDIA = path.join(ROOT, 'app', 'media', 'handouts');
const FILES = { plan: '7a1b2c3d4e5f6071.png', letter: '8b2c3d4e5f607182.png' };
const preExisting = existsSync(MEDIA) ? readdirSync(MEDIA) : [];
const cleanMedia = () => { for (const f of Object.values(FILES)) { try { rmSync(path.join(MEDIA, f), { force: true }); } catch (_) {} } if (!preExisting.length) { try { rmSync(MEDIA, { recursive: true, force: true }); } catch (_) {} } };
const HANDOUTS = { v: 1, rel: 'invented/handouts', items: [
  { id: 'pelican-floor-plan', title: 'The Pelican Rooms floor plan', file: FILES.plan, when: 'GM-ONLY-PA-CUE when they ask about the lift' },
  { id: 'mabels-letter', title: 'Mabel Quist’s letter', file: FILES.letter }
] };
const CLOCK = 'Lotte checks the list';
const SECTION = ['## Prep actions', '',
  'When they arrive, hand them `▶ handout: pelican floor plan` and start `▶ clock: ' + CLOCK + ' / 6 / 1`.', '',
  '- The letter: `>> handout: Mabels letter`', '- A missing one: `▶ handout: GM-ONLY-PA-MISSING`', '- `▶ dance: tonight`', '- `▶ crew sheet`', '',
  '| Handout | When |', '|---|---|', '| `▶ handout: pelican-floor-plan` | At the door |', '| The letter | Later |', '',
  '> [!tip] Rules to hand', '> Remind them about `▶ rule: Position and effect` and `▶ rule: GM-ONLY-PA-NORULE`.', ''].join('\n');
const LONG_CARD = '# Mabel Quist\n\n' + Array.from({ length: 14 }, (_, i) => '## Part ' + (i + 1) + '\n\nShe runs the house and keeps the marker close. ' + 'She watches the floor from the gallery. '.repeat(4)).join('\n\n') + '\n';

if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
mkdirSync(MEDIA, { recursive: true });
writeFileSync(path.join(MEDIA, FILES.plan), png(900, 600, 0)); writeFileSync(path.join(MEDIA, FILES.letter), png(600, 900, 1));
const demo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo-night.mjs'), '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, B68_ANTHROPIC_KEY: '', ANTHROPIC_API_KEY: '' }, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let demoOut = '';
demo.stdout.on('data', (d) => { demoOut += d; }); demo.stderr.on('data', (d) => { demoOut += d; });
function killDemo() { if (WIN) spawnSync('taskkill', ['/pid', String(demo.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-demo.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', () => { killDemo(); cleanMedia(); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
setTimeout(() => { console.log('FAIL timed out\n' + demoOut.slice(-1500)); process.exit(1); }, 600000);

const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
const errors = [];
let browser = null;
async function gmPage(w, h, place) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block' });
  await ctx.addInitScript(atPlace(place || 'before'));
  const p = await ctx.newPage(), seen = [];
  p.on('pageerror', (e) => errors.push('gm: ' + e.message));
  p.on('request', (r) => seen.push(r.url()));
  p.on('dialog', (d) => d.accept());
  await p.goto(BASE + '/#gm');
  await p.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
  await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000, state: 'attached' });
  return { p, ctx, seen };
}
async function openPrep(p) {
  await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await p.keyboard.press('r');
  await p.waitForSelector('#gm-prep .pp-doc', { timeout: 20000 });
}
const tapOn = async (p, sel) => { if (WK) await p.locator(sel).first().tap(); else await p.locator(sel).first().click(); };

try {
  const up = await until(() => /The demo night is up/.test(demoOut), 240000, 500);
  if (!up) throw new Error('the demo night did not start:\n' + demoOut.slice(-1500));
  browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const [W0, H0] = SIZES[0];

  /* ---- off: the demo note as it is ---- */
  {
    const { p, ctx, seen } = await gmPage(W0, H0);
    await openPrep(p);
    await sleep(800);
    const before = await p.$eval('#gm-prep .pp-doc', (e) => e.innerHTML);
    check(!seen.some((u) => /prep-actions/.test(u)), 'off: a note without an action span does not fetch the prep-actions bundle');
    check(await p.evaluate(() => !window.B68GmPrepActions), 'off: B68GmPrepActions is not on the page');
    await p.evaluate(() => window.B68Load.need('prep-actions'));
    const after = await p.evaluate(() => { const d = document.querySelector('#gm-prep .pp-doc'), c = d.cloneNode(true); window.B68GmPrepActions.decorate(c, { handouts: () => [], clocks: () => [] }); return { has: window.B68GmPrepActions.has(d), html: c.innerHTML, now: d.innerHTML }; });
    check(after.html === before && after.now === before && !after.has, 'off: with the module run over it, the note is byte-for-byte as before (' + before.length + ' characters)');
    await ctx.close();
  }

  /* ---- the fixture: the handouts part, the section with the chips, a long card for Mabel Quist ---- */
  const prep = (await api('GET', '/gm/pack?part=prep')).json, camp = (await api('GET', '/gm/pack?part=campaign')).json;
  const note = prep.body.notes[0];
  note.blocks.push({ k: 'md', from: note.rel || note.id, src: SECTION, tasks: [] });
  check((await api('POST', '/gm/pack', { part: 'prep', src: prep.src || {}, body: prep.body })).status === 200, 'the prep part with the action section');
  check((await api('POST', '/gm/pack', { part: 'handouts', src: { file: 'invented/handouts', blockSha: '1', exportedAt: new Date().toISOString() }, body: HANDOUTS })).status === 200, 'the handouts part');
  camp.body.cards = Object.assign({}, camp.body.cards || {}, { 'Mabel Quist': LONG_CARD });
  check((await api('POST', '/gm/pack', { part: 'campaign', src: camp.src || {}, body: camp.body })).status === 200, 'a long card for Mabel Quist');

  /* the iPad, signed in as the display */
  const dctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' });
  const dp = await dctx.newPage();
  dp.on('pageerror', (e) => errors.push('display: ' + e.message));
  await dp.goto(BASE + '/#display');
  await sleep(1500);

  for (let si = 0; si < SIZES.length; si++) {
    const [W, H] = SIZES[si], tag = TAG + '-' + W;
    const { p, ctx, seen } = await gmPage(W, H);
    await openPrep(p);
    await until(() => p.evaluate(() => document.querySelectorAll('#gm-prep .pa-chip').length >= 9), 15000);
    const chips = await p.$$eval('#gm-prep .pa-chip', (l) => l.map((b) => ({ t: (b.querySelector('.pa-mark').textContent + ' ' + b.querySelector('.pa-l').textContent).replace(/\s+/g, ' ').trim(), cls: b.className, title: b.title })));
    check(seen.some((u) => /gm\/prep-actions\.js/.test(u)), tag + ': a note with an action span fetches the bundle');
    check(chips.length === 9, tag + ': nine chips (' + chips.map((c) => c.t).join(' | ') + ')');
    const by = (re) => chips.filter((c) => re.test(c.t));
    check(by(/^▶ The Pelican Rooms floor plan$/).length === 2 && by(/^▶ Mabel Quist’s letter$/).length === 1, tag + ': handout chips read as the handout title (both lead-ins, id and title and prefix)');
    check(by(/GM-ONLY-PA-MISSING/).every((c) => /pa-muted/.test(c.cls) && /No handout/.test(c.title)) && by(/dance: tonight/).every((c) => /pa-muted/.test(c.cls)) && by(/crew sheet/).every((c) => /pa-muted/.test(c.cls) && /crew sheet/.test(c.title)), tag + ': a missing handout, an unknown verb and the crew sheet are muted, each with a reason');
    check(si === 0 ? by(new RegExp('^▶ Clock: ' + CLOCK + ' \\(6\\)$')).length === 1 : by(new RegExp('^● Clock: ' + CLOCK + ' 1/6$')).length === 1,
      tag + (si === 0 ? ': the clock chip reads Clock: name (6)' : ': the clock made on the first size: the chip reads Clock: name 1/6 on a fresh page'));
    check(by(/^▶ Position and effect$/).length === 1 && by(/Position and effect/)[0].cls.includes('pa-rule'), tag + ': the rule chip reads its term, in the rule style');
    check(await p.evaluate(() => !!document.querySelector('#gm-prep .rl-callout .pa-chip.pa-rule') && !!document.querySelector('#gm-prep li .pa-chip') && !!document.querySelector('#gm-prep td .pa-chip')), tag + ': chips in a callout, a list item and a table cell');
    const rows = await p.$$eval('#gm-prep table', (ts) => { const t = ts.find((x) => x.querySelector('.pa-chip')); return t ? [...t.querySelectorAll('tbody tr')].map((r) => Math.round(r.getBoundingClientRect().height)) : []; });
    check(rows.length === 2 && rows[0] <= rows[1] + 12, tag + ': the table row with a handout chip stays one row tall (' + rows.join(' vs ') + ' px)');
    await p.evaluate(() => { const c = document.querySelector('#gm-prep .pa-chip'); c.closest('p, li, td, .rl-callout').scrollIntoView({ block: 'center' }); });
    await sleep(300);
    await shot(p, 'prep-chips-' + tag);

    if (si === 0) {
      /* handout: on the shared screen */
      await tapOn(p, '#gm-prep p .pa-chip.pa-handout');
      const dg = await until(async () => { const r = await api('GET', '/gm/display', undefined, IPAD); return r.json && r.json.display && r.json.display.kind === 'handout' ? r.text : null; }, 10000);
      check(!!dg && dg.includes(FILES.plan), 'handout: a tap shows it on the shared screen (the display GET has the file)');
      check(!!(await until(() => dp.evaluate((f) => [...document.querySelectorAll('img')].some((i) => i.src.includes(f)), FILES.plan), 10000)), 'handout: the display DOM draws it');
      check(!/GM-ONLY/.test(dg || '') && !/GM-ONLY/.test(await dp.evaluate(() => document.body.innerHTML)), 'handout: no GM-ONLY- text in the display GET or DOM (the cue stays on the laptop)');

      /* clock: once, hidden */
      const clocksNamed = async (u) => { const r = await api('GET', '/campaign', undefined, u); return ((r.json && (r.json.doc || r.json).clocks) || []).filter((c) => c && c.name === CLOCK); };
      await tapOn(p, '#gm-prep .pa-chip.pa-clock');
      const made = await until(async () => { const l = await clocksNamed(GM); return l.length ? l : null; }, 10000);
      check(!!made && made.length === 1 && made[0].hidden === true && made[0].size === 6 && made[0].filled === 1, 'clock: a tap adds it once, hidden, 1/6 (' + JSON.stringify(made) + ')');
      check(!!(await until(() => p.evaluate((n) => [...document.querySelectorAll('#gm-prep .pa-chip.pa-clock')].some((b) => b.textContent.includes('Clock: ' + n + ' 1/6')), CLOCK), 8000)), 'clock: the chip now says where it stands (Clock: name 1/6)');
      await tapOn(p, '#gm-prep .pa-chip.pa-clock');
      await sleep(800);
      check((await clocksNamed(GM)).length === 1, 'clock: a second tap adds nothing');
      const dget = await api('GET', '/gm/display', undefined, IPAD);
      check(!dget.text.includes(CLOCK) && !(await dp.evaluate((n) => document.body.innerHTML.includes(n), CLOCK)), 'clock: hidden: not in the display GET or the display DOM');
      check((await clocksNamed(P1)).every((c) => c.hidden === true), 'clock: the table document a phone reads marks it hidden (as every hidden table clock is)');
      const undo = p.locator('.pa-toast button, .gm-ugtoast button, .ui-toast button').filter({ hasText: 'Undo' });
      if (await undo.count()) {
        await undo.first().click();
        check(!!(await until(async () => (await clocksNamed(GM)).length === 0, 8000)), 'clock: Undo takes it off the table');
        check(!!(await until(() => p.evaluate((n) => [...document.querySelectorAll('#gm-prep .pa-chip.pa-clock')].some((b) => b.textContent.includes('Clock: ' + n + ' (6)')), CLOCK), 8000)), 'clock: the chip offers the add again');
      } else check(false, 'clock: the add toasted with Undo');
      /* added again, then a player's phone: the table page shows the crew's clock, never the hidden one */
      await tapOn(p, '#gm-prep .pa-chip.pa-clock');
      check(!!(await until(async () => (await clocksNamed(GM)).length === 1, 8000)), 'clock: a tap after the Undo adds it again');
      const pc = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': P1 }, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const pp = await pc.newPage();
      await pp.goto(BASE + '/#t');
      const seenMarker = await until(() => pp.evaluate(() => !!document.querySelector('.tp-clock[data-id="c-marker"]')), 20000);
      const plIds = await pp.$$eval('.tp-clock', (ns) => ns.map((n) => n.dataset.id));
      check(!!seenMarker && !(await pp.evaluate((n) => document.body.innerHTML.includes(n), CLOCK)), 'clock: a phone\'s table page shows the crew\'s clock and not the hidden one (' + plIds.join() + ')');
      await pc.close();

      /* Send… beside a handout chip: only with phone.handouts on; it opens the handouts list's own Send to… row */
      check(!(await p.$('#gm-prep .pa-send')), 'send: with phone.handouts off there is no Send… beside a handout chip');
      const setting = async (on) => { await api('PATCH', '/gm/state', { features: { 'phone.handouts': on } }); await api('PATCH', '/campaign', { features: { 'phone.handouts': on } }); };
      await setting(true);
      await p.reload();
      await p.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
      await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000, state: 'attached' });
      await openPrep(p);
      check(!!(await until(() => p.evaluate(() => !!document.querySelector('#gm-prep p .pa-chip.pa-handout + .pa-send')), 15000)), 'send: with phone.handouts on, a Send… sits beside the handout chip');
      await tapOn(p, '#gm-prep p .pa-send');
      const row = await until(() => p.evaluate(() => { const b = document.querySelector('.pa-pop [data-gm="ho-send"][data-to="*"]'); return b ? [...document.querySelectorAll('.pa-pop [data-gm="ho-send"]')].map((x) => x.textContent.trim()).join(', ') : null; }), 10000);
      check(!!row, 'send: it opens the Send to… row (' + row + ')');
      await shot(p, 'prep-send-' + TAG + '-' + W0);
      if (row) {
        await tapOn(p, '.pa-pop [data-gm="ho-send"][data-to="*"]');
        const got = await until(async () => { const r = await api('GET', '/docs?kind=handout&limit=5', undefined, P1); return r.text.includes(FILES.plan) ? r.text : null; }, 10000);
        check(!!got && !/GM-ONLY/.test(got), 'send: Everyone puts it on a player\'s phone list (the docs row), with no cue');
        const dg2 = await api('GET', '/gm/display', undefined, IPAD);
        check(!/GM-ONLY/.test(dg2.text), 'send: the shared screen is sent nothing GM-only');
      }
      await setting(false);
    }

    /* rule: the pop-over, closed three ways */
    const popOpen = () => p.evaluate(() => { const e = document.querySelector('.pa-pop'); return !!e && e.getBoundingClientRect().height > 0; });
    const rule = '#gm-prep .pa-chip.pa-rule:not(.pa-muted)';
    await p.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'center' }), rule);
    await tapOn(p, rule);
    check(!!(await until(async () => popOpen() && p.evaluate(() => /Set the position/.test(document.querySelector('.pa-pop').textContent)), 8000)), tag + ': rule: a tap opens the pop-over with the rule');
    const pr = await p.evaluate(() => { const r = document.querySelector('.pa-pop').getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom, innerWidth, innerHeight]; });
    check(pr[0] >= 0 && pr[1] >= 0 && pr[2] <= pr[4] && pr[3] <= pr[5], tag + ': rule: the pop-over is inside the screen (' + pr.map(Math.round).join(',') + ')');
    await shot(p, 'prep-rule-pop-' + tag);
    if (!WK) { await p.keyboard.press('Escape'); check(!(await until(async () => !(await popOpen()), 3000).then((x) => !x)), tag + ': rule: Esc closes it'); }
    else check(true, tag + ': rule: Esc (a keyboard) is checked on Edge');
    await tapOn(p, rule); await until(popOpen, 5000);
    await tapOn(p, '#gm-prep .pp-rail');
    check(!!(await until(async () => !(await popOpen()), 3000)), tag + ': rule: a tap outside closes it');
    await tapOn(p, rule); await until(popOpen, 5000);
    const xs = await p.evaluate(() => { const r = document.querySelector('.pa-pop .pa-x').getBoundingClientRect(); return [r.width, r.height]; });
    await tapOn(p, '.pa-pop .pa-x');
    check(!!(await until(async () => !(await popOpen()), 3000)), tag + ': rule: its ✕ closes it (' + xs.map(Math.round).join('x') + ' px)');
    await tapOn(p, '#gm-prep .pa-chip.pa-rule:has-text("GM-ONLY-PA-NORULE")');
    check(!!(await until(() => p.evaluate(() => /No rule called/.test((document.querySelector('.pa-pop') || {}).textContent || '')), 8000)), tag + ': rule: an unknown term says "No rule called …"');
    await tapOn(p, '.pa-pop .pa-x');
    if (!WK) {
      await p.mouse.move(5, 5); await sleep(200);
      await p.hover(rule); await sleep(700);
      check(await popOpen(), tag + ': rule: a hover opens it');
      await tapOn(p, rule); await until(popOpen, 3000);
      await tapOn(p, '.pa-pop [data-pa-open]');
      check(!!(await until(() => p.evaluate(() => document.querySelector('#gm-root').getAttribute('data-panel') === 'rules'), 5000)), tag + ': rule: Open in Rules goes to the rules');
      await openPrep(p);
    }

    /* PA2: a person's card in Prep */
    await p.evaluate(() => { const a = [...document.querySelectorAll('#gm-prep a[href^="#pp:npc"]')][0]; a.scrollIntoView({ block: 'center' }); });
    await tapOn(p, '#gm-prep a[href^="#pp:npc"]');
    await p.waitForSelector('#gm-prep-peek:not([hidden]) .pp-peekx', { timeout: 8000 });
    await sleep(300);
    const px = await p.evaluate(() => { const r = document.querySelector('#gm-prep-peek .pp-peekx').getBoundingClientRect(), c = document.querySelector('#gm-prep-peek .pp-peekcard').getBoundingClientRect(); const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { w: r.width, h: r.height, top: r.top, bottom: r.bottom, right: r.right, cr: c.right, vh: innerHeight, vw: innerWidth, long: c.height, hit: !!(at && at.closest('.pp-peekx')) }; });
    check(px.hit && px.w >= 44 && px.h >= 44 && px.top >= 0 && px.bottom <= px.vh && px.right <= px.vw && px.cr - px.right < 12, tag + ': PA2: the card has a ✕ at its top right, in sight and not under the bars, ' + Math.round(px.w) + 'x' + Math.round(px.h) + ' px (card ' + Math.round(px.long) + ' px tall)');
    await shot(p, 'prep-peek-' + tag);
    await p.evaluate(() => { const b = document.querySelector('#gm-prep-peek .pp-cardbody'); if (b) b.scrollTop = b.scrollHeight; });
    await tapOn(p, '#gm-prep-peek .pp-peekx');
    check(!!(await until(() => p.evaluate(() => document.querySelector('#gm-prep-peek').hidden), 3000)), tag + ': PA2: the ✕ closes the card');

    /* PA2: the Run view's NPC card */
    await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await p.keyboard.press('g');
    const npcBtn = '#gm-runv [data-rv="npc"]';
    const gotRv = await until(() => p.evaluate((s) => !!document.querySelector(s), npcBtn), 15000);
    if (gotRv) {
      await tapOn(p, npcBtn);
      const pop = await until(() => p.evaluate(() => { const e = document.querySelector('.rv-npcpop [data-rv="npcx"]'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.width, r.height, r.top, r.bottom, innerHeight]; }), 8000);
      check(!!pop && pop[0] >= 44 && pop[1] >= 44 && pop[2] >= 0 && pop[3] <= pop[4], tag + ': PA2: the Run view NPC card has a ✕ in sight, ' + (pop ? Math.round(pop[0]) + 'x' + Math.round(pop[1]) : '?') + ' px');
      await shot(p, 'run-npc-' + tag);
      await tapOn(p, '.rv-npcpop [data-rv="npcx"]');
      check(!!(await until(() => p.evaluate(() => !document.querySelector('.rv-npcpop')), 3000)), tag + ': PA2: its ✕ closes it');
      await tapOn(p, npcBtn); await until(() => p.evaluate(() => !!document.querySelector('.rv-npcpop')), 5000);
      /* a point of the Run view the card does not cover (a floor label, a legend, the header's edge) */
      const pt = await p.evaluate(() => {
        const pop = document.querySelector('.rv-npcpop').getBoundingClientRect();
        for (const e of document.querySelectorAll('#gm-runv .rv-floor, #gm-runv .rv-cn, #gm-runv .rv-head, #gm-runv .rv-sh')) {
          const r = e.getBoundingClientRect(), x = r.left + 4, y = r.top + r.height / 2;
          if (r.width && (x < pop.left || x > pop.right || y < pop.top || y > pop.bottom) && document.elementFromPoint(x, y) && document.elementFromPoint(x, y).closest('#gm-runv')) return [x, y];
        }
        return null;
      });
      if (pt) { if (WK) await p.touchscreen.tap(pt[0], pt[1]); else await p.mouse.click(pt[0], pt[1]); }
      check(!!(await until(() => p.evaluate(() => !document.querySelector('.rv-npcpop')), 3000)), tag + ': PA2: a tap outside the Run view card closes it');
    } else check(false, tag + ': PA2: the Run view shows a person with a card');
    await ctx.close();
  }
  await dctx.close();
  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''));
  await browser.close(); browser = null;
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); if (browser) { try { await browser.close(); } catch (_) {} } }
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
