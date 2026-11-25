// phone-glance (the glance sheet on phones, phone.glance; RK31 of the room key build, RK32 adds the full sheet's steps), end to end against a real
// local Worker (wrangler dev) on PORT (default 9509; the inspector on PORT + 20000), with invented fixtures only: the Dovetail Crew (Nell Arbuthnot,
// Ray Okonjo, Tam Petrakis) and, for the playbooks' own tracks, Mabel Quist (a Hull), Dov Kessler (a Vampire), Ada Vell (a Time Traveler) and
// Lotte Brand (a Ghost/Echo), all player1's; a GM-ONLY- hidden NPC. Ability, frame and glitch names come from content.js at run time.
//   files    glance.css: every rule under #dossier (and the Night lines), no important flag, no layer, nothing outside the phone's media query
//            shows it; glance.js: no request, no document listener; tracker.js meets it in one line, and the four-screen sheet's line waits on it
//   off      phone.glance off: no glance file fetched, no .gl, no mark; today's long page
//   fit      on, from the GM's side, the sheet open: at 390 x 664 and 375 x 553 the four blocks (Stress, Harm, the twelve actions, the abilities)
//            show with no scroll, the fit steps (c1, c2) and "+n more" as needed; six abilities; Large text scrolls
//   play     a stress box, Push in the roll strip, a resist die, the harm editor (Done is one change), the strip's "Harm 2": each shows the Undo bar
//            and Undo puts it back (also on the server); Recent changes keeps 20; a full track offers the keys, a deadlock resets Stress to 0
//            with Undo, and the deadlock stays
//   events   the commendations take the foot with their countdown and open End of session; a key that can turn; the rest wait in Table
//   tracks   Drain 10 and Damage (Hull), Stress 12 and Dayfire (Vampire), Instability 9, canisters and glitches (Time Traveler), Irregularities (Ghost)
//   full     Full sheet: today's sheet with a bar back; RK32's page through B68SheetPage.open (a stand-in here), and the fallback without it
//   page     RK32's page itself, on the INVENTED blank sheet (checks/runtime/fixtures/sheets/blank-sheet.mjs, served as the Hound's media/sheets/ files by a
//            route): fetched only when Full sheet opens; the mark layer is page.js's own marks() of the server's play; + to 400% re-lays the box (no
//            transform, the viewport untouched), a double tap, ctrl+wheel, a two-pointer pinch and Safari's gesture events; each region's editor (a bottom
//            sheet) and a change through it with Undo; a count that disagrees draws nothing there and shows the note; no sheet falls back, once; over
//            760 px the page is the main view with a side panel; held sideways it is a side panel too
//   secret   no GM-ONLY- text in a response or the DOM; the phone's requests with the glance on are the ones it makes off, and the glance's files
//   kit      with kit.phone on too, the four-screen sheet is not drawn; the glance off brings it back; off: today's page again
// SHOTS=<dir> saves the pictures (390 x 664 and 375 x 553, Paper and Night).
//   PW_MODULE=<path to playwright-core> [PW_CHANNEL=msedge] [PORT=9509] [SHOTS=<dir>] node checks/runtime/phone-glance.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { blankSheet } from './fixtures/sheets/blank-sheet.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9509);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', P1 = 'player1@example.test';
const SHOTS = process.env.SHOTS || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }

/* ---------- no browser: the files' own rules ---------- */
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const TRACKER = read('app/tracker.js'), JS = read('app/sheet/glance.js'), CSS = read('app/sheet/glance.css');
{
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
  const sels = (rules.match(/[^{}]+\{/g) || []).map((s) => s.slice(0, -1).trim()).filter(Boolean);
  const out = []; for (const s of sels) for (const one of s.split(',')) { const o = one.trim(); if (!/^#dossier\b/.test(o) && !/^:root(\[data-theme="dark"\]|:not\(\[data-theme="light"\]\)) #dossier > \.gl$/.test(o)) out.push(o); }
  check(sels.length > 60 && !out.length, 'glance.css: every rule under #dossier (' + sels.length + ')' + (out.length ? ': ' + out.slice(0, 3) : ''));
  check(!/!\s*important/i.test(CSS) && !/@layer/.test(CSS) && !/[\u0080-\u009f]/.test(CSS + JS), 'glance.css: no important flag, no layer; no character in U+0080 to U+009F');
  const head = CSS.replace(/\/\*[\s\S]*?\*\//g, '').split('@media')[0];
  check(/@media screen and \(max-width: 760px\)/.test(CSS) && /#dossier \.gl \{ display: none; \}/.test(head) && !/data-gl-off/.test(head), 'off the phone (a desk, print) the glance shows nothing and hides nothing');
  const code = JS.replace(/\/\*[\s\S]*?\*\//g, '');
  check(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/.test(code) && !/document\.addEventListener|\bW\.document\.addEventListener/.test(code), 'glance.js: no request, no document listener');
  const seams = TRACKER.split('\n').filter((l) => /B68SheetGlance/.test(l));
  check(seams.length === 1 && /var gl = !cur\.ui\.static && !!window\.B68SheetGlance/.test(seams[0]) && TRACKER.split('\n').filter((l) => /B68SheetTabs/.test(l)).every((l) => /if \(!gl && window\.B68SheetTabs/.test(l)),
    'tracker.js meets it in one line, and the four-screen sheet\'s line waits on it');
  check(/B68SheetPage\.open\(box, character\(\), \{ main: !!main/.test(JS) && /fallback: function/.test(JS) && /B68SheetPage\.update\(character\(\)\)/.test(JS), 'Full sheet opens RK32\'s page through B68SheetPage.open(container, character, opts); fallback() and update(character) are there');
}

/* ---------- the browser run ---------- */
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-phone-glance-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.ANTHROPIC_API_KEY; delete env.B68_ANTHROPIC_KEY;
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
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 900000);

const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const must = async (p, what) => { const r = await p; if (r.status !== 200) throw new Error(what + ' -> ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 200)); return r; };
const feature = (o) => must(api('PATCH', '/campaign', { features: o }), 'features ' + JSON.stringify(o));
const server1 = async (id) => { const r = await api('GET', '/characters/' + id, null, P1); return r.json && (r.json.play || (r.json.doc && r.json.doc.play)) || null; };

/* the invented characters: names from the fixtures; abilities, frame features, glitches and irregularities from content.js */
const CT = (() => { const sb = {}; sb.window = sb; sb.self = sb; vm.runInNewContext(read('app/content.js'), sb, { filename: 'app/content.js' }); return sb.B68Content; })();
const abs = (id, n) => CT.byId[id].abilities.slice(0, n).map((a) => a[0]);
const pc = (id, name, playbook, play) => ({ id, doc: { name, playbook, spec: { name, playbook }, sheet: { name, alias: '', look: 'Long coat' }, play: Object.assign({ crew: 'The Dovetail Crew', keys: [], log: [] }, play) } });
const KEYS = (hits) => [{ name: 'KEY-1', down: 'Takes the long way', up: 'Never lets go', hits }, { name: 'KEY-2', down: 'Trusts the wrong voice', up: 'Hears the lie first', hits: 1 }];
const PCS = [
  pc('pc-nell', 'Nell Arbuthnot', 'hound', { stress: 6, dots: { Hunt: 2, Study: 1, Survey: 1, Finesse: 1, Prowl: 1, Skirmish: 2, Command: 1, Consort: 2, Sway: 1 }, abilities: abs('hound', 3),
    harm: { l1: ['Winded', ''], l2: ['Cracked ribs', ''], l3: '', l4: '' }, keys: KEYS(2) }),
  pc('pc-ray', 'Ray Okonjo', 'intellectual', { stress: 2, dots: { Study: 3, Tinker: 2, Survey: 1, Consort: 1 }, abilities: abs('intellectual', 6), harm: { l1: ['', ''], l2: ['', ''], l3: '', l4: '' }, keys: KEYS(0) }),
  pc('pc-tam', 'Tam Petrakis', 'hound', { stress: 9, dots: { Hunt: 1, Skirmish: 2, Prowl: 1 }, abilities: abs('hound', 2), harm: { l1: ['Winded', ''], l2: ['Cracked ribs', ''], l3: '', l4: 'Shot through the lung' }, keys: KEYS(1) }),
  pc('pc-mabel', 'Mabel Quist', 'hull', { stress: 4, dots: { Wreck: 2, Skirmish: 1 }, abilities: ['Automaton'].concat(abs('hull', 1)), frame: CT.byId.hull.frame.slice(0, 2).map((f) => f[0]), harm: { l1: ['Dented plate', ''], l2: ['', ''], l3: '', l4: '' } }),
  pc('pc-dov', 'Dov Kessler', 'vampire', { stress: 7, dots: { Sway: 2, Consort: 1, Prowl: 1 }, abilities: abs('vampire', 2), strictures: ['Dayfire'],
    keys: [{ name: 'KEY-1', down: 'Takes the long way', up: 'Never lets go', hits: 0, deadlock: 'down' }] }),
  pc('pc-ada', 'Ada Vell', 'timetraveler', { stress: 5, alluvium: 3, dots: { Study: 2, Attune: 1 }, abilities: abs('timetraveler', 2),
    keys: [{ name: 'KEY-1', down: 'Takes the long way', up: 'Never lets go', hits: 1, glitch: CT.byId.timetraveler.glitches[0] }, { name: 'KEY-2', down: 'Trusts the wrong voice', up: 'Hears the lie first', hits: 0 }] }),
  pc('pc-lotte', 'Lotte Brand', 'ghost', { stress: 3, dots: { Attune: 2, Prowl: 1 }, abilities: abs('ghost', 2), keys: [{ name: 'KEY-1', down: 'Takes the long way', up: 'Never lets go', hits: 0, glitch: CT.byId.ghost.deadlocks[0] }] })
];

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const errors = [];
async function open(id, o = {}) {
  const w = o.w || 390, h = o.h || 664;
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': P1 }, viewport: { width: w, height: h }, isMobile: o.mobile !== false, hasTouch: o.mobile !== false, serviceWorkers: 'block', colorScheme: o.night ? 'dark' : 'light', reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { window.__B68_POLL_MS = 500; window.__B68_HEALTHY_POLL_MS = 500; });
  /* RK32: media/sheets/ answered from the invented blank sheet (o.sheets: { map } another map, { none: true } nothing published) */
  if (o.sheets) await ctx.route('**/media/sheets/**', (r) => { const u = new URL(r.request().url()).pathname, b = blankSheet(CT, 'hound');
    if (!o.sheets.none && u.endsWith('/hound.map.json')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o.sheets.map || b.map) });
    if (!o.sheets.none && u.endsWith('/hound.svg')) return r.fulfill({ status: 200, contentType: 'image/svg+xml', body: b.svg });
    return r.fulfill({ status: 404, contentType: 'text/plain', body: 'none' }); });
  const page = await ctx.newPage();
  const seen = { req: [], bodies: [] };
  page.on('request', (r) => seen.req.push(r.url()));
  page.on('response', async (r) => { if (r.url().indexOf('/api/') > 0) { try { seen.bodies.push({ u: r.url(), b: await r.text() }); } catch (_) {} } });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|Content Security Policy/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE + '/#c/' + id);
  await page.waitForSelector('#dossier .ds-bar', { timeout: 30000, state: 'attached' });
  return { ctx, page, seen };
}
const glanceUp = (pg, ms = 20000) => until(() => pg.evaluate(() => { const s = document.querySelector('#dossier .gl-screen'); return !!s && getComputedStyle(s).display === 'flex' && document.getElementById('dossier').getAttribute('data-gl') === 'glance' && !!document.querySelector('#dossier .gl').getAttribute('data-step'); }), ms, 100);
const shot = async (pg, name) => { if (SHOTS) { await sleep(250); await pg.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
/* the four blocks: each one's box, whether it is inside the screen above the foot, and whether the body scrolls */
const blocks = (pg) => pg.evaluate(() => {
  const n = document.querySelector('#dossier .gl'), b = n.querySelector('.gl-body'), foot = n.querySelector('.gl-p-foot').getBoundingClientRect();
  const box = (s) => { const e = n.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { t: Math.round(r.top), b: Math.round(r.bottom), in: r.top >= 0 && r.bottom <= foot.top + 0.5 && r.height > 10 }; };
  const chips = Array.from(n.querySelectorAll('.gl-chip')).filter((c) => !c.hidden && c.getClientRects().length).map((c) => c.textContent);
  return { step: n.getAttribute('data-step'), over: b.scrollHeight > b.clientHeight + 1, sh: b.scrollHeight, ch: b.clientHeight, stress: box('.gl-stress'), harm: box('.gl-harm'), acts: box('.gl-acts'), abs: box('.gl-abs'),
    foot: Math.round(foot.top), chips, sw: document.documentElement.scrollWidth, iw: innerWidth, docScroll: Math.max(0, document.documentElement.scrollHeight - innerHeight) };
});
const allIn = (b) => ['stress', 'harm', 'acts', 'abs'].every((k) => b[k] && b[k].in);
const stressOf = (pg) => pg.evaluate(() => document.querySelectorAll('#dossier .gl-sbox.gl-on').length);
const bar = (pg) => pg.evaluate(() => { const u = document.querySelector('#dossier .gl-undo'); return u && !u.hidden ? { label: u.querySelector('.gl-u-l').textContent, secs: u.querySelector('.gl-u-s').textContent, undo: !u.querySelector('.gl-u-go').hidden } : null; });
const undoBar = async (pg) => { await pg.click('#dossier .gl-undo .gl-u-go'); await sleep(400); };
const serverStress = async (id, want) => until(async () => { const p = await server1(id); return p && p.stress === want ? p : null; }, 8000, 200);

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  const started = new Date(Date.now() - 3600000).toISOString();
  await must(api('PUT', '/campaign', { v: 1, session: { number: 3, startedAt: started, endedAt: null }, crew: { name: 'The Dovetail Crew', playbook: 'shadows', claims: {}, factions: [], cohorts: [] }, clocks: [], log: [] }), 'the table');
  await must(api('PUT', '/npcs/npc_rk31_clerk', { name: 'GM-ONLY-Night Clerk', alias: '', role: 'Clerk', faction: '', description: 'GM-ONLY-desc', gmNotes: 'GM-ONLY-notes', revealed: false, firstSeen: null, spec: {} }), 'a hidden NPC');
  await feature({ 'spine.keyturn': true, 'spine.aftermath': true, 'between.quiet': true });
  for (const p of PCS) await must(api('PUT', '/characters/' + p.id, Object.assign({}, p.doc, { play: Object.assign({ session: 3 }, p.doc.play) }), P1), p.doc.name);

  /* ---------- off: today ---------- */
  const A = await open('pc-nell'), a = A.page;
  await sleep(1500);
  const off = await a.evaluate(() => ({ gl: !!document.querySelector('#dossier .gl'), marks: document.querySelectorAll('[data-gl-off]').length, attr: document.getElementById('dossier').getAttribute('data-gl'), mod: typeof window.B68SheetGlance, bar: getComputedStyle(document.querySelector('#dossier .ds-bar')).display !== 'none' }));
  check(!off.gl && off.marks === 0 && off.attr === null && off.mod === 'undefined' && off.bar, 'off: no glance, no mark, the module not loaded, today\'s sheet: ' + JSON.stringify(off));
  const glFiles = A.seen.req.filter((u) => /\/sheet\/(glance|page)\./.test(u));
  check(!glFiles.length, 'off: no glance or page file fetched' + (glFiles.length ? ': ' + glFiles : ''));
  const offApi = new Set(A.seen.req.filter((u) => u.indexOf('/api/') > 0).map((u) => new URL(u).pathname));

  /* ---------- on, from the GM's side, with the sheet open ---------- */
  await feature({ 'phone.glance': true });
  check(!!(await glanceUp(a)), 'on: the open sheet becomes the glance screen without a reload');
  let bl = await blocks(a);
  check(allIn(bl) && !bl.over && bl.sw <= 390 && bl.docScroll < 2, '390 x 664: the four blocks show with no scroll (step ' + bl.step + '): ' + JSON.stringify(bl));
  check(bl.chips.length === 3 && !bl.chips.some((c) => /more/.test(c)), '390 x 664: her three abilities as chips: ' + bl.chips.join(' | '));
  const top = await a.evaluate(() => { const t = document.querySelector('#dossier .gl-top'); return { who: t.querySelector('.gl-who').textContent, table: !!t.querySelector('[data-gl="table"]'), quiet: !!t.querySelector('[data-act="quiet"]'), more: !!t.querySelector('[data-gl="more"]') }; });
  check(/Nell Arbuthnot/.test(top.who) && /Hound · The Dovetail Crew/.test(top.who) && top.table && top.quiet && top.more, 'the top bar: the name and "Hound · crew", Table, Quiet, ⋯: ' + JSON.stringify(top));
  const harmLine = await a.evaluate(() => document.querySelector('#dossier .gl-harm .gl-cost').textContent);
  check(harmLine === 'Effect may drop · 3d complications after', 'Harm says what it costs: ' + harmLine);
  const acts = await a.evaluate(() => Array.from(document.querySelectorAll('#dossier .gl-attr')).map((g) => g.querySelector('.gl-attrh').textContent + ':' + Array.from(g.querySelectorAll('.gl-act')).map((x) => x.textContent + x.querySelectorAll('.gl-dot.gl-on').length).join(',')));
  check(acts.join(' ') === 'Insight3d:Hunt2,Study1,Survey1,Tinker0 Prowess3d:Finesse1,Prowl1,Skirmish2,Wreck0 Resolve3d:Attune0,Command1,Consort2,Sway1', 'all twelve actions in three columns, each attribute with its resist dice: ' + acts.join(' '));
  check((await stressOf(a)) === 6 && (await a.evaluate(() => document.querySelectorAll('#dossier .gl-sbox').length)) === 9, 'Stress: 6 of 9 boxes');
  const hidden = await a.evaluate(() => Array.from(document.querySelectorAll('#dossier section.ds-box')).filter((b) => b.getClientRects().length).length);
  check(hidden === 0, 'today\'s boxes are hidden under the glance (' + hidden + ' showing)');
  await shot(a, 'glance-390x664-paper');

  /* ---------- play: a stress box, with Undo ---------- */
  await a.click('#dossier .gl-sbox[data-n="7"]'); await sleep(300);
  let u = await bar(a);
  check((await stressOf(a)) === 7 && u && u.label === 'Stress 6 → 7' && u.undo && /^[1-6] s$/.test(u.secs), 'a box tap: Stress 7, and the Undo bar with its seconds: ' + JSON.stringify(u));
  check(!!(await serverStress('pc-nell', 7)), 'saved: the server has Stress 7');
  await shot(a, 'undo-390x664-paper');
  await undoBar(a);
  check((await stressOf(a)) === 6 && !!(await serverStress('pc-nell', 6)), 'Undo: Stress 6 again, on the server too');
  await sleep(6500);
  check(!(await bar(a)), 'the bar goes after 6 s');

  /* the roll strip: Push marks 2, with Undo */
  await a.click('#dossier .gl-act[data-a="Skirmish"]');
  const strip = await until(() => a.evaluate(() => { const r = document.querySelector('#dossier .ds-roll.ds-mark'); if (!r) return null; const b = r.getBoundingClientRect(); const e = document.elementFromPoint(innerWidth / 2, innerHeight - 40); return { fixed: getComputedStyle(r).position === 'fixed', over: !!(e && e.closest('.ds-roll')), title: r.querySelector('.ds-roll-t').textContent }; }), 4000);
  check(!!strip && strip.fixed && strip.over && /Skirmish/.test(strip.title), 'an action opens today\'s roll strip over the glance: ' + JSON.stringify(strip));
  await shot(a, 'roll-390x664-paper');
  await a.click('#dossier .ds-mark [data-act="markopt"][data-k="push"]'); await sleep(300);
  u = await bar(a);
  check((await stressOf(a)) === 8 && u && u.label === 'Stress 6 → 8', 'Push marks 2 Stress, with Undo: ' + JSON.stringify(u));
  await undoBar(a);
  check((await stressOf(a)) === 6 && !(await a.$('#dossier .ds-roll')), 'Undo: Stress 6, and the strip closes (its Push would be stale)');

  /* the resist helper: an attribute, the highest die */
  await a.click('#dossier .gl-attrh[data-attr="Prowess"]');
  await until(() => a.evaluate(() => !!document.querySelector('#dossier .ds-mark .ds-rhelp')), 4000);
  await shot(a, 'resist-390x664-paper');
  await a.click('#dossier .ds-mark [data-act="markrdie"][data-v="4"]'); await sleep(300);
  u = await bar(a);
  check((await stressOf(a)) === 8 && u && u.label === 'Stress 6 → 8', 'an attribute opens the resist helper; the highest die 4 costs 2, with Undo: ' + JSON.stringify(u));
  await undoBar(a);
  check((await stressOf(a)) === 6, 'Undo: Stress 6');

  /* the harm editor: Done is one change */
  await a.click('#dossier .gl-harm');
  await until(() => a.evaluate(() => !!document.querySelector('#dossier .gl-sheet [data-glh="l3"]')), 3000);
  await shot(a, 'harm-390x664-paper');
  await a.fill('#dossier .gl-sheet [data-glh="l3"]', 'Broken arm');
  await a.click('#dossier .gl-sheet [data-gl="harmdone"]'); await sleep(400);
  const h2 = await a.evaluate(() => ({ cost: document.querySelector('#dossier .gl-harm .gl-cost').textContent, sheet: !!document.querySelector('#dossier .gl-sheet') }));
  u = await bar(a);
  check(!h2.sheet && h2.cost === 'Effect may drop · 6d complications after' && u && u.label === 'Harm updated', 'the harm editor: Done writes it as one change; the cost line follows: ' + JSON.stringify([h2, u]));
  check(!!(await until(async () => { const p = await server1('pc-nell'); return p && p.harm && p.harm.l3 === 'Broken arm'; }, 8000, 200)), 'saved: the server has the level 3 harm');
  await undoBar(a);
  check((await a.evaluate(() => document.querySelector('#dossier .gl-harm .gl-cost').textContent)) === 'Effect may drop · 3d complications after', 'Undo: the harm is as it was');
  /* the strip's "Harm 2": the editor opens at the first empty level 2 line */
  await a.click('#dossier .gl-act[data-a="Hunt"]');
  await until(() => a.evaluate(() => !!document.querySelector('#dossier .ds-mark')), 4000);
  await a.click('#dossier .ds-mark [data-act="markharm"][data-l="2"]'); await sleep(300);
  const mh = await a.evaluate(() => ({ sheet: !!document.querySelector('#dossier .gl-sheet'), focus: document.activeElement && document.activeElement.getAttribute('data-glh'), strip: !!document.querySelector('#dossier .ds-roll') }));
  check(mh.sheet && mh.focus === 'l2.1' && !mh.strip, 'the strip\'s "Harm 2" opens the harm editor at the empty level 2 line: ' + JSON.stringify(mh));
  await a.click('#dossier .gl-sheet [data-gl="close"]');

  /* Recent changes keeps 20 */
  for (let i = 0; i < 24; i++) { await a.click('#dossier .gl-sbox[data-n="' + (i % 2 ? 6 : 5) + '"]'); await sleep(80); }
  await sleep(300);
  await a.click('#dossier .gl-top [data-gl="more"]'); await sleep(200);
  await a.click('#dossier .gl-sheet [data-gl="recent"]'); await sleep(300);
  const recent = await a.evaluate(() => ({ n: document.querySelectorAll('#dossier .gl-sheet .gl-li').length, undo: document.querySelectorAll('#dossier .gl-sheet [data-gl="undo"]').length, first: (document.querySelector('#dossier .gl-sheet .gl-li b') || {}).textContent }));
  check(recent.n === 20 && recent.undo === 1 && recent.first === 'Stress 5 → 6', '⋯ › Recent changes keeps the last 20, the newest first with Undo: ' + JSON.stringify(recent));
  await a.click('#dossier .gl-sheet [data-gl="undo"]'); await sleep(300);
  check((await stressOf(a)) === 5, 'Undo from Recent changes: Stress 5');
  await a.click('#dossier .gl-sheet [data-gl="close"]');
  await a.click('#dossier .gl-sbox[data-n="6"]'); await sleep(200);

  /* the table, with its badge; Full sheet and back */
  await a.click('#dossier .gl-top [data-gl="table"]'); await sleep(300);
  const tb = await a.evaluate(() => ({ title: document.querySelector('#dossier .gl-sheet h3').textContent, line: (document.querySelector('#dossier .gl-sheet .gl-faint') || {}).textContent }));
  check(tb.title === 'Table' && /session 3 · in play/.test(tb.line || ''), 'Table opens with where the table is: ' + JSON.stringify(tb));
  await a.click('#dossier .gl-sheet [data-gl="close"]');
  await a.click('#dossier .gl-foot [data-gl="full"]'); await sleep(400);
  const full = await a.evaluate(() => ({ v: document.getElementById('dossier').getAttribute('data-gl'), boxes: Array.from(document.querySelectorAll('#dossier section.ds-box')).filter((b) => b.getClientRects().length).length, back: getComputedStyle(document.querySelector('#dossier .gl-backbar')).display, glance: getComputedStyle(document.querySelector('#dossier .gl-screen')).display }));
  check(full.v === 'sheet' && full.boxes >= 14 && full.back === 'flex' && full.glance === 'none', 'Full sheet (no page yet): today\'s sheet, with the bar back to the glance: ' + JSON.stringify(full));
  await shot(a, 'full-390x664-paper');
  await a.reload(); await a.waitForSelector('#dossier .ds-bar', { timeout: 30000, state: 'attached' });
  check(!!(await glanceUp(a)), 'a reload after Full sheet reopens on the glance: the view is never kept');
  /* RK32's page, through its own call (a stand-in for B68SheetPage here): the character's live getters, update() after each redraw, fallback() */
  await a.evaluate(() => { window.__upd = 0; window.B68SheetPage = { open: function (box, ch, o) { window.__pg = { box: !!box && box.classList.contains('gl-page'), name: ch && ch.doc && ch.doc.name, stress: ch && ch.play && ch.play.stress, main: o.main, fns: ['close', 'fallback', 'play', 'record', 'commit', 'act'].filter((k) => typeof o[k] === 'function').length }; window.__o = o; window.__ch = ch; box.textContent = 'STAND-IN PAGE'; return true; },
    update: function (ch) { window.__upd++; window.__updStress = ch.play.stress; } }; });
  await a.click('#dossier .gl-foot [data-gl="full"]'); await sleep(300);
  const pg = await a.evaluate(() => ({ v: document.getElementById('dossier').getAttribute('data-gl'), seen: getComputedStyle(document.querySelector('#dossier .gl-page')).display, call: window.__pg }));
  check(pg.v === 'page' && pg.seen === 'block' && pg.call && pg.call.box && pg.call.name === 'Nell Arbuthnot' && pg.call.stress === 6 && pg.call.main === false && pg.call.fns === 6, 'Full sheet opens RK32\'s page with (container, character, opts): ' + JSON.stringify(pg));
  await a.evaluate(() => window.__o.act('stress', { n: '8' })); await sleep(400);
  const up = await a.evaluate(() => ({ upd: window.__upd, seen: window.__updStress, live: window.__ch.play.stress, fn: window.__o.play().stress }));
  check(up.upd > 0 && up.seen === 8 && up.live === 8 && up.fn === 8, 'the page hears the redraw (update(character)) and reads the live play: ' + JSON.stringify(up));
  { const g = await api('GET', '/characters/pc-nell', null, P1), d = g.json.doc; d.play.stress = 5; await must(api('PUT', '/characters/pc-nell', d, P1), 'a change from elsewhere'); }
  const swapped = await until(() => a.evaluate(() => window.__ch.play.stress === 5 && window.__o.play() === window.__ch.play && window.__updStress === 5), 15000, 200);
  check(!!swapped, 'a change from elsewhere (the sheet swaps its play object): character.play is the new object, and update() carried it');
  await a.evaluate(() => window.__o.act('stress', { n: '6' })); await sleep(300);
  await a.evaluate(() => window.__o.close()); await sleep(200);
  check(!!(await glanceUp(a, 3000)), 'the page\'s close() comes back to the glance');
  await a.click('#dossier .gl-foot [data-gl="full"]'); await sleep(300);
  await a.evaluate(() => window.__o.fallback()); await sleep(300);
  check((await a.evaluate(() => document.getElementById('dossier').getAttribute('data-gl'))) === 'sheet', 'a page that learns late it has no sheet calls fallback(): today\'s sheet');
  await a.click('#dossier .gl-backbar [data-gl="glance"]'); await glanceUp(a, 3000);
  await a.evaluate(() => { window.B68SheetPage = { open: function () { return false; } }; });
  await a.click('#dossier .gl-foot [data-gl="full"]'); await sleep(300);
  check((await a.evaluate(() => document.getElementById('dossier').getAttribute('data-gl'))) === 'sheet', 'a page that cannot draw (no sheet, no map) falls back to today\'s sheet');
  await a.click('#dossier .gl-backbar [data-gl="glance"]'); await glanceUp(a, 3000);
  await a.evaluate(() => { delete window.B68SheetPage; });

  /* ---------- events: the commendations take the foot ---------- */
  await must(api('PUT', '/docs', { kind: 'commend', owner: '_', scope: 'public', json: { v: 1, secs: 90, until: Date.now() + 90000 } }), 'commend');
  const ev = await until(() => a.evaluate(() => { const e = document.querySelector('#dossier .gl-foot .gl-event'); return e ? { text: e.querySelector('.gl-ev-w').textContent, clock: (e.querySelector('[data-ends]') || {}).textContent, act: e.getAttribute('data-act'), full: !!document.querySelector('#dossier .gl-foot [data-gl="full"]') } : null; }), 20000, 200);
  check(!!ev && /Commendations are open/.test(ev.text) && /Mark your xp/.test(ev.text) && /\d:\d\d/.test(ev.clock || '') && ev.act === 'endopen' && !ev.full, 'the commendations replace Full sheet in the foot, with their countdown: ' + JSON.stringify(ev));
  bl = await blocks(a);
  check(allIn(bl) && !bl.over, 'the strip takes the foot\'s own room: the four blocks still show (step ' + bl.step + ')' + (allIn(bl) && !bl.over ? '' : ': ' + JSON.stringify(bl)));
  await shot(a, 'commend-390x664-paper');
  await a.click('#dossier .gl-foot .gl-event'); await sleep(400);
  const endp = await a.evaluate(() => { const r = document.querySelector('#dossier .ds-roll.ds-endp'); return r ? { fixed: getComputedStyle(r).position === 'fixed', shown: r.getClientRects().length > 0 } : null; });
  check(!!endp && endp.fixed && endp.shown, 'a tap opens End of session over the glance: ' + JSON.stringify(endp));
  await a.click('#dossier .ds-endp [data-act="panelclose"]').catch(() => {});
  await must(api('DELETE', '/docs?kind=commend&owner=_'), 'commend down');
  check(!!(await until(() => a.evaluate(() => !!document.querySelector('#dossier .gl-foot [data-gl="full"]')), 30000, 300)), 'the window closes: Full sheet is back');

  /* a full track: the keys; a deadlock resets Stress to 0, with Undo, and the deadlock stays */
  await a.click('#dossier .gl-sbox[data-n="9"]'); await sleep(300);
  const fullBar = await a.evaluate(() => { const b = document.querySelector('#dossier .gl-stress.gl-full .gl-fullbar'); return b ? b.textContent : null; });
  check(/Stress full/.test(fullBar || '') && /Deadlock a key/.test(fullBar || ''), 'a full track turns red and offers the keys: ' + fullBar);
  await shot(a, 'stress-full-390x664-paper');
  await a.click('#dossier .gl-fullbar'); await sleep(300);
  await shot(a, 'keys-390x664-paper');
  await a.click('#dossier .gl-sheet [data-gl="deadlock"][data-i="0"][data-dir="down"]'); await sleep(500);
  u = await bar(a);
  const dl = await a.evaluate(() => ({ stress: document.querySelectorAll('#dossier .gl-sbox.gl-on').length, bursts: document.querySelectorAll('#dossier .gl-dl .gl-burst.gl-on').length, struck: document.querySelectorAll('#dossier .gl-sheet .gl-key.gl-struck').length }));
  check(dl.stress === 0 && dl.struck === 1 && u && u.label === 'Deadlocked KEY-1: Stress 9 → 0' && u.undo, 'a deadlock from the keys sheet resets Stress to 0, with Undo: ' + JSON.stringify([dl, u]));
  await shot(a, 'deadlock-390x664-paper');
  await undoBar(a);
  const srv = await until(async () => { const p = await server1('pc-nell'); return p && p.stress === 9 ? p : null; }, 8000, 200);
  check(!!srv && srv.keys[0].deadlock === 'down' && (await stressOf(a)) === 9, 'Undo puts Stress back to 9; the deadlock stays (the GM\'s to undo): ' + JSON.stringify(srv && srv.keys[0]));
  await a.click('#dossier .gl-sheet [data-gl="close"]').catch(() => {});
  await a.click('#dossier .gl-sbox[data-n="6"]'); await sleep(200);

  /* the secrets and the requests */
  const dom = await a.evaluate(() => document.documentElement.outerHTML);
  const leak = A.seen.bodies.filter((x) => /GM-ONLY-/.test(x.b)).map((x) => x.u);
  check(!/GM-ONLY-/.test(dom) && !leak.length, 'secret: no GM-ONLY- text in a response or the DOM' + (leak.length ? ': ' + leak : ''));
  const onApi = new Set(A.seen.req.filter((u) => u.indexOf('/api/') > 0).map((u) => new URL(u).pathname));
  const newApi = [...onApi].filter((p) => !offApi.has(p) && !/^\/api\/(docs|characters|campaign|table|me)/.test(p));
  check(!newApi.length, 'the glance makes no request of its own' + (newApi.length ? ': ' + newApi : ''));
  await A.ctx.close();

  /* ---------- fit at both sizes, in Paper and Night; six abilities; Mortal; Large text ---------- */
  for (const [w, h] of [[390, 664], [375, 553]]) for (const night of [false, true]) {
    const tag = w + 'x' + h + (night ? '-night' : '-paper');
    for (const id of ['pc-nell', 'pc-ray', 'pc-tam']) {
      const P = await open(id, { w, h, night }); await glanceUp(P.page);
      const b = await blocks(P.page);
      const want = id === 'pc-ray' ? 6 : id === 'pc-tam' ? 2 : 3;
      const more = b.chips.filter((c) => /^\+\d+ more$/.test(c));
      const shownAb = b.chips.length - more.length + (more.length ? +more[0].match(/\d+/)[0] : 0);
      if (id === 'pc-nell' && !night) check(b.step === (w === 390 ? '1' : '3'), tag + ': Nell settles where the design does (390 x 664: c1, her three chips on two rows; 375 x 553: c2 and one chip row): step ' + b.step);
      check(allIn(b) && !b.over && b.sw <= w && shownAb === want, tag + ' ' + id + ': the four blocks with no scroll (step ' + b.step + '), ' + (b.chips.length - more.length) + ' chips' + (more.length ? ' + "' + more[0] + '"' : '') + ' of ' + want + (allIn(b) && !b.over ? '' : ': ' + JSON.stringify(b)));
      if (id === 'pc-tam') {
        const m = await P.page.evaluate(() => ({ cost: document.querySelector('#dossier .gl-harm .gl-cost').textContent, kind: document.querySelector('#dossier .gl-harm .gl-cost').classList.contains('gl-k-mortal') }));
        check(m.kind && m.cost === 'Mortal: you die without help, fast', tag + ': Mortal harm says so in alarm red: ' + m.cost);
      }
      await shot(P.page, 'glance-' + tag + '-' + id.slice(3));
      await P.ctx.close();
    }
    if (w === 375 && !night) {
      const P = await open('pc-ray', { w, h }); await glanceUp(P.page);
      await P.page.click('#dossier .gl-chip.gl-plus'); await sleep(300);
      const n = await P.page.evaluate(() => document.querySelectorAll('#dossier .gl-sheet .gl-abt').length);
      check(n === 6, '"+n more" opens all six abilities with their text (' + n + ')');
      await shot(P.page, 'abilities-' + tag);
      await P.page.click('#dossier .gl-sheet [data-gl="close"]');
      await P.page.click('#dossier .gl-chip[data-i="0"]'); await sleep(300);
      const t = await P.page.evaluate(() => (document.querySelector('#dossier .gl-sheet .gl-abtext') || {}).textContent || '');
      check(t.length > 20, 'a chip shows the ability\'s text from the sheet\'s data (' + t.length + ' characters)');
      await shot(P.page, 'ability-' + tag);
      await P.ctx.close();
    }
  }
  /* a phone held sideways (under 760 px): the last step still overflows, so the body scrolls and everything can be reached */
  for (const [w, h] of [[667, 375], [760, 360]]) {
    const P = await open('pc-ray', { w, h }); await glanceUp(P.page);
    const s = await P.page.evaluate(async () => {
      const n = document.querySelector('#dossier .gl'), b = n.querySelector('.gl-body');
      const out = { scroll: n.classList.contains('gl-scroll'), oy: getComputedStyle(b).overflowY, step: n.getAttribute('data-step') };
      b.scrollTop = b.scrollHeight; await new Promise((r) => setTimeout(r, 150));
      const br = b.getBoundingClientRect(), seen = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= br.top - 1 && r.bottom <= br.bottom + 1; };
      out.sway = seen(n.querySelector('.gl-act[data-a="Sway"]')); out.chips = Array.from(n.querySelectorAll('.gl-chip')).filter((c) => !c.hidden).every(seen);
      return out;
    });
    check(s.scroll && s.oy === 'auto' && s.sway && s.chips, w + ' x ' + h + ' (sideways): the body scrolls, and the last action and every chip can be reached: ' + JSON.stringify(s));
    await shot(P.page, 'sideways-' + w + 'x' + h + '-paper');
    await P.ctx.close();
  }
  /* the fit stays settled: after a resize and a tap, with the commendations' countdown ticking in the foot (it once redrew the foot every second
     and the fit flip-flopped), nothing changes the fit for 3 s. The refit window itself is guarded in sheet-glance.test.mjs */
  {
    const P = await open('pc-nell', { w: 390, h: 664 }); await glanceUp(P.page);
    await must(api('PUT', '/docs', { kind: 'commend', owner: '_', scope: 'public', json: { v: 1, secs: 90, until: Date.now() + 90000 } }), 'commend');
    await until(() => P.page.evaluate(() => !!document.querySelector('#dossier .gl-foot .gl-event [data-ends]')), 20000, 200);
    await P.page.evaluate(() => { window.__fits = 0; new MutationObserver((m) => { window.__fits += m.length; }).observe(document.querySelector('#dossier .gl'), { attributes: true, attributeFilter: ['class', 'data-step'] }); });
    await P.page.setViewportSize({ width: 375, height: 553 }); await sleep(400);
    await P.page.click('#dossier .gl-sbox[data-n="5"]'); await sleep(1500);
    const settle = await P.page.evaluate(() => window.__fits);
    /* the sheet redraws as the phone polls: four times a second here, for 3 s */
    await P.page.evaluate(() => { window.__fits = 0; window.__rf = setInterval(() => window.B68Tracker.refresh(), 250); }); await sleep(3000);
    await P.page.evaluate(() => clearInterval(window.__rf));
    const idle = await P.page.evaluate(() => ({ n: window.__fits, step: document.querySelector('#dossier .gl').getAttribute('data-step') }));
    const clock = await P.page.evaluate(() => (document.querySelector('#dossier .gl-foot [data-ends]') || {}).textContent || '');
    check(idle.n === 0 && /\d:\d\d/.test(clock), 'with the countdown ticking (' + clock + ') and the sheet redrawn four times a second, after a resize and a tap: no fit change for 3 s (' + settle + ' while it settled): ' + JSON.stringify(idle));
    await must(api('DELETE', '/docs?kind=commend&owner=_'), 'commend down');
    await P.ctx.close();
  }
  /* Large text: one step up, two columns, the screen may scroll; kept on this phone */
  {
    const P = await open('pc-ray', { w: 390, h: 664 }); await glanceUp(P.page);
    await P.page.click('#dossier .gl-top [data-gl="more"]'); await sleep(200);
    await P.page.click('#dossier .gl-sheet [data-gl="text"][data-v="large"]'); await sleep(300);
    await P.page.click('#dossier .gl-sheet [data-gl="close"]'); await sleep(200);
    const lg = await P.page.evaluate(() => { const n = document.querySelector('#dossier .gl'); const b = n.querySelector('.gl-body'); return { lg: n.classList.contains('gl-lg'), cols: getComputedStyle(n.querySelector('.gl-cols')).gridTemplateColumns.split(' ').length, scroll: getComputedStyle(b).overflowY, font: parseFloat(getComputedStyle(n.querySelector('.gl-act b')).fontSize), chips: n.querySelectorAll('.gl-chip:not([hidden]):not(.gl-plus)').length }; });
    check(lg.lg && lg.cols === 2 && lg.scroll === 'auto' && lg.font >= 19 && lg.chips === 6, 'Large text: 19 px, the actions in two columns, every chip, and the screen scrolls: ' + JSON.stringify(lg));
    await shot(P.page, 'large-390x664-paper');
    await P.page.reload(); await P.page.waitForSelector('#dossier .ds-bar', { state: 'attached' }); await glanceUp(P.page);
    check(await P.page.evaluate(() => document.querySelector('#dossier .gl').classList.contains('gl-lg')), 'Large text is kept on this phone over a reload');
    await P.page.evaluate(() => localStorage.removeItem('b68.glance.text'));
    await P.ctx.close();
  }

  /* ---------- the playbooks' own tracks ---------- */
  const tracks = { 'pc-mabel': { n: 10, name: 'Drain', harm: 'Damage' }, 'pc-dov': { n: 12, name: 'Stress', harm: 'Harm' }, 'pc-ada': { n: 9, name: 'Instability', harm: 'Harm' }, 'pc-lotte': { n: 10, name: 'Drain', harm: 'Harm' } };
  for (const id of Object.keys(tracks)) {
    const P = await open(id, { w: 390, h: 664 }); await glanceUp(P.page);
    const t = await P.page.evaluate(() => { const n = document.querySelector('#dossier .gl'); return { boxes: n.querySelectorAll('.gl-sbox').length, name: n.querySelector('.gl-stress .gl-lab').textContent, harm: n.querySelector('.gl-harm .gl-lab').textContent, side: (n.querySelector('.gl-dl') || {}).textContent, can: (n.querySelector('.gl-can') || {}).textContent || '', chips: Array.from(n.querySelectorAll('.gl-chip:not(.gl-plus)')).map((c) => c.textContent + (c.classList.contains('gl-k-pin') ? '*' : c.classList.contains('gl-k-frame') ? '#' : '')) }; });
    const b = await blocks(P.page), w = tracks[id];
    let extra = true, what = '';
    if (id === 'pc-mabel') { extra = t.chips.filter((c) => /#$/.test(c)).length === 2 && /Deadlocks/.test(t.side); what = 'two frame features as chips'; }
    if (id === 'pc-dov') { extra = t.chips.includes('Dayfire*') && t.side.indexOf('Deadlocks') === 0; what = 'Dayfire pinned after the abilities'; }
    if (id === 'pc-ada') { extra = t.side === 'Glitches1/4' && /Canisters\s*3/.test(t.can); what = 'Glitches 1/4 and Canisters 3'; }
    if (id === 'pc-lotte') { extra = t.side === 'Irregularities1'; what = 'Irregularities 1'; }
    check(t.boxes === w.n && t.name === w.name && t.harm === w.harm && extra && allIn(b) && !b.over, id.slice(3) + ': ' + w.name + ' ' + w.n + ', ' + w.harm + ', ' + what + ': ' + JSON.stringify(t));
    await shot(P.page, 'track-' + id.slice(3) + '-390x664-paper');
    await P.ctx.close();
  }

  /* ---------- RK32: the full sheet, the official page filled in (the invented blank sheet, served as the Hound's) ---------- */
  {
    const PG = require(path.join(ROOT, 'app/sheet/page.js')).Pure, BLANK = blankSheet(CT, 'hound');
    const sheetReqs = (S) => S.seen.req.filter((u) => /\/media\/sheets\//.test(u)).map((u) => new URL(u).pathname);
    const gl = (pg) => pg.evaluate(() => document.getElementById('dossier').getAttribute('data-gl'));
    /* Full sheet: the foot's button, or ⋯ › Full sheet while an event holds the foot */
    const toFull = async (pg) => {
      if (await pg.$('#dossier .gl-foot [data-gl="full"]')) await pg.click('#dossier .gl-foot [data-gl="full"]');
      else { await pg.click('#dossier .gl-top [data-gl="more"]'); await pg.click('#dossier .gl-sheet [data-gl="full"]'); }
    };
    const ready = (pg) => until(() => pg.evaluate(() => !!document.querySelector('#dossier .sp.sp-ready')), 10000, 100);
    const pens = (pg) => pg.evaluate(() => document.querySelectorAll('#dossier .sp-marks .sp-pen').length);
    const tags = (h) => ['polygon', 'circle', 'rect', 'path', 'line', 'text'].map((t) => (h.match(new RegExp('<' + t + '\\b', 'g')) || []).length).join('/');
    const markHtml = (pg) => pg.evaluate(() => document.querySelector('#dossier .sp-marks').innerHTML);
    const panel = (pg, r) => until(() => pg.evaluate((r) => { const p = document.querySelector('#dossier .sp-panel[data-region="' + r + '"]'); if (!p) return null; const b = p.getBoundingClientRect(); return { t: p.querySelector('h3').textContent, l: Math.round(b.left), r: Math.round(b.right), top: Math.round(b.top), b: Math.round(b.bottom), note: !!p.querySelector('.sp-note') }; }, r), 3000, 100);
    const region = async (pg, r) => { await pg.locator('#dossier .sp-hit[data-region="' + r + '"]').first().tap(); return panel(pg, r); };
    const closeEd = (pg) => pg.click('#dossier .sp-panel [data-sp="close"]');

    const S = await open('pc-nell', { w: 390, h: 664, sheets: {} }), pg = S.page; await glanceUp(pg);
    check(!sheetReqs(S).length, 'the page: nothing of the sheet is fetched before Full sheet opens');
    await toFull(pg); await ready(pg);
    const st = await pg.evaluate(() => ({ v: document.getElementById('dossier').getAttribute('data-gl'), s: window.B68SheetPage.state(), seen: getComputedStyle(document.querySelector('#dossier .gl-page')).display }));
    check(st.v === 'page' && st.s && st.s.ready && st.seen === 'block' && sheetReqs(S).join() === '/media/sheets/hound.map.json,/media/sheets/hound.svg', 'Full sheet opens the page: the map, then the page, fetched now: ' + JSON.stringify([st, sheetReqs(S)]));
    /* the marks are page.js's own marks() of what the server holds */
    const doc0 = (await api('GET', '/characters/pc-nell', null, P1)).json.doc;
    const want = PG.marks(BLANK.map, { play: doc0.play, pb: CT.byId.hound, doc: doc0 }, null, CT);
    let html = await markHtml(pg);
    check(tags(html) === tags(want) && (await pens(pg)) >= doc0.play.stress && !/sp-unmapped/.test(html) && /Nell Arbuthnot/.test(html), 'the mark layer is the character drawn through the map (' + tags(html) + ', want ' + tags(want) + ')');
    await shot(pg, 'page-390x664-first-paper');

    /* zoom: + to 400% re-lays the box (the vector page with it), never a transform; the page's viewport is untouched */
    const zoom = () => pg.evaluate(() => { const b = document.querySelector('#dossier .sp-box'), i = document.querySelector('#dossier .sp-img'), v = document.querySelector('#dossier .sp-view'), m = document.querySelector('meta[name="viewport"]');
      return { z: window.B68SheetPage.state().z, pct: document.querySelector('#dossier .sp-pct').textContent, bw: Math.round(b.getBoundingClientRect().width), iw: Math.round(i.getBoundingClientRect().width), vw: v.clientWidth, tf: getComputedStyle(b).transform + '|' + getComputedStyle(i).transform, vp: m ? m.content : '', vs: window.visualViewport ? visualViewport.scale : 1, inDis: document.querySelector('#dossier .sp [data-sp="in"]').disabled, outDis: document.querySelector('#dossier .sp [data-sp="out"]').disabled }; });
    const zf = await zoom(), vh = await pg.evaluate(() => document.querySelector('#dossier .sp-view').clientHeight);
    check(zf.z > 1.4 && zf.pct === Math.round(zf.z * 100) + '%' && !zf.outDis && Math.abs(zf.bw * 595.28 / 841.89 - (vh - 16)) <= 16, 'a phone held upright opens at the page\'s height (' + zf.pct + ', the view ' + vh + ' px tall), not a strip too small to read: ' + JSON.stringify(zf));
    for (let i = 0; i < 6 && !(await zoom()).outDis; i++) { await pg.click('#dossier .sp [data-sp="out"]'); await sleep(100); }
    const z0 = await zoom();
    check(z0.z === 1 && z0.pct === '100%' && z0.outDis && Math.abs(z0.bw - (z0.vw - 16)) <= 1, '− goes back to fit width (100%; − is off): ' + JSON.stringify(z0));
    await shot(pg, 'page-390x664-fit-paper');
    for (let i = 0; i < 3; i++) { await pg.click('#dossier .sp [data-sp="in"]'); await sleep(120); }
    await shot(pg, 'page-390x664-250-paper');
    for (let i = 0; i < 2; i++) { await pg.click('#dossier .sp [data-sp="in"]'); await sleep(120); }
    let z = await zoom();
    check(z.z === 4 && z.pct === '400%' && z.inDis && Math.abs(z.bw - (z.vw - 16) * 4) <= 2 && Math.abs(z.iw - z.bw) <= 1 && z.tf === 'none|none' && z.vp === z0.vp && z.vs === 1,
      '+ to 400%: the box re-laid at four times its fit width, the page with it, no transform, the viewport untouched: ' + JSON.stringify(z));
    await shot(pg, 'page-390x664-400-paper');
    for (let i = 0; i < 5; i++) { await pg.click('#dossier .sp [data-sp="out"]'); await sleep(80); }
    check((await zoom()).z === 1, '− back to fit');
    /* a double tap: 250%, and again: fit; neither opens an editor */
    const box = await pg.locator('#dossier .sp-box').boundingBox(), cx = box.x + box.width * .45, cy = box.y + box.height * .9;
    await pg.touchscreen.tap(cx, cy); await sleep(60); await pg.touchscreen.tap(cx, cy); await sleep(500);
    const dt1 = await pg.evaluate(() => ({ z: window.B68SheetPage.state().z, ed: !!document.querySelector('#dossier .sp-panel') }));
    await pg.touchscreen.tap(195, 400); await sleep(60); await pg.touchscreen.tap(195, 400); await sleep(500);
    const dt2 = await pg.evaluate(() => ({ z: window.B68SheetPage.state().z, ed: !!document.querySelector('#dossier .sp-panel') }));
    check(dt1.z === 2.5 && dt2.z === 1 && !dt1.ed && !dt2.ed, 'a double tap goes to 250% and back to fit, and opens no editor: ' + JSON.stringify([dt1, dt2]));
    /* ctrl+wheel, a two-pointer pinch, Safari's gesture events (the browser is told no: the sheet zooms, never the page) */
    const zw = await pg.evaluate(async () => {
      const v = document.querySelector('#dossier .sp-view'), r = v.getBoundingClientRect(), S = window.B68SheetPage, frames = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const w = new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, clientX: r.left + 100, clientY: r.top + 100, bubbles: true, cancelable: true }); v.dispatchEvent(w);
      const wheel = S.state().z;
      const y = r.top + 150, ev = (t, id, x) => v.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch', isPrimary: id === 1 }));
      ev('pointerdown', 1, r.left + 150); ev('pointerdown', 2, r.left + 200); ev('pointermove', 2, r.left + 225); ev('pointermove', 2, r.left + 250); await frames();
      ev('pointerup', 2, r.left + 250); ev('pointerup', 1, r.left + 150);
      const pinch = S.state().z;
      const g1 = new Event('gesturestart', { bubbles: true, cancelable: true }); g1.scale = 1; v.dispatchEvent(g1);
      const g2 = new Event('gesturechange', { bubbles: true, cancelable: true }); g2.scale = 1.5; v.dispatchEvent(g2); await frames();
      const g3 = new Event('gestureend', { bubbles: true, cancelable: true }); v.dispatchEvent(g3);
      return { wheel, wheelNo: w.defaultPrevented, pinch, gesture: S.state().z, gestureNo: g1.defaultPrevented && g2.defaultPrevented, ed: !!document.querySelector('#dossier .sp-panel') };
    });
    check(Math.abs(zw.wheel - 1.12) < .01 && zw.wheelNo && Math.abs(zw.pinch - zw.wheel * 2) < .02 && Math.abs(zw.gesture - Math.min(4, zw.pinch * 1.5)) < .02 && zw.gestureNo && !zw.ed,
      'ctrl+wheel, a two-finger pinch (twice the spread: twice the size) and Safari\'s gesture events all zoom the sheet: ' + JSON.stringify(zw));
    for (let i = 0; i < 6 && (await zoom()).z > 1; i++) { await pg.click('#dossier .sp [data-sp="out"]'); await sleep(80); }

    /* every region opens its editor as a bottom sheet */
    const regions = ['about', 'stress', 'keys', 'harm', 'cohort', 'abilities', 'friends', 'xp', 'stacks', 'actions', 'items'], seenEd = [];
    for (const r of regions) {
      const p = await region(pg, r);
      if (p && p.l === 0 && p.r === 390 && p.b >= 660 && p.t) seenEd.push(r); else console.log('  editor ' + r + ': ' + JSON.stringify(p));
      if (r === 'stress') await shot(pg, 'editor-stress-390x664-paper');
      if (p) await closeEd(pg); await sleep(150);
    }
    check(seenEd.length === regions.length, 'a tap on each part of the page opens its editor, a bottom sheet on a phone (' + seenEd.length + ' of ' + regions.length + ')');
    /* a change through an editor: the sheet's own handler, the mark layer redrawn, the Undo bar, Undo (also on the server) */
    const s0 = (await server1('pc-nell')).stress, sTo = s0 === 3 ? 4 : 3, pens0 = await pens(pg);
    await region(pg, 'stress'); await pg.click('#dossier .sp-panel [data-act="stress"][data-n="' + sTo + '"]'); await sleep(400);
    let u = await bar(pg);
    const lifted = await pg.evaluate(() => { const b = document.querySelector('#dossier .gl-undo').getBoundingClientRect(), p = document.querySelector('#dossier .sp-panel').getBoundingClientRect(); return { bar: Math.round(b.bottom), panel: Math.round(p.top) }; });
    check(lifted.bar <= lifted.panel, 'the Undo bar sits above an open editor, never over its controls: ' + JSON.stringify(lifted));
    check(u && u.label === 'Stress ' + s0 + ' → ' + sTo && u.undo && (await pens(pg)) === pens0 + sTo - s0 && !!(await serverStress('pc-nell', sTo)), 'stress from its editor: the marks follow, the Undo bar says ' + JSON.stringify(u));
    await shot(pg, 'editor-stress-change-390x664-paper');
    await undoBar(pg);
    check(!!(await serverStress('pc-nell', s0)) && (await pens(pg)) === pens0, 'Undo puts the stress (and its marks) back');
    await closeEd(pg).catch(() => {});
    await region(pg, 'harm'); await pg.fill('#dossier .sp-panel [data-sp-h="l3"]', 'Burned hand'); await pg.click('#dossier .sp-panel [data-sp="harmdone"]'); await sleep(400);
    u = await bar(pg); html = await markHtml(pg);
    const h1 = await until(async () => { const p = await server1('pc-nell'); return p && p.harm && p.harm.l3 === 'Burned hand' ? p : null; }, 8000, 200);
    check(u && u.label === 'Harm updated' && />Burned hand</.test(html) && !!h1, 'the harm editor: Done is one change, written on the page and saved, with Undo: ' + JSON.stringify(u));
    await undoBar(pg);
    check(!!(await until(async () => { const p = await server1('pc-nell'); return p && p.harm && !p.harm.l3 ? p : null; }, 8000, 200)) && !/>Burned hand</.test(await markHtml(pg)), 'Undo takes the harm back off');
    const changes = [['stacks', '[data-act="stacks"][data-n="2"]', /Stacks changed/], ['items', '[data-act="item"][data-n="Binoculars"]', /Load changed/], ['keys', '[data-act="keyhit"][data-i="1"][data-n="2"]', /KEY-2 1 → 2 hits/], ['cohort', '[data-act="coharm"][data-v="weak"]', /changed/]];
    for (const [r, sel, re] of changes) {
      await region(pg, r); const before = await markHtml(pg);
      await pg.click('#dossier .sp-panel ' + sel); await sleep(400);
      u = await bar(pg); const after = await markHtml(pg);
      check(u && re.test(u.label) && u.undo && after !== before, r + ': a change through its editor redraws the marks, with Undo (' + (u && u.label) + ')');
      await undoBar(pg); await closeEd(pg).catch(() => {});
      check((await markHtml(pg)) === before, r + ': Undo puts the marks back');
    }
    await region(pg, 'about'); await pg.fill('#dossier .sp-panel input[data-path="crew"]', 'The Dovetail Crew (Pelican)'); await pg.keyboard.press('Tab'); await sleep(400);
    u = await bar(pg);
    check(u && u.label === 'Crew changed' && u.undo && /The Dovetail Crew \(Pelican\)/.test(await markHtml(pg)), 'a typed field (the crew): the sheet writes it, the page records it for Undo: ' + JSON.stringify(u));
    await undoBar(pg); await closeEd(pg).catch(() => {});
    /* a deadlock from the page's keys editor is the glance's: confirmed, struck for good, Stress to 0 with one Undo (design §6); Undo keeps the deadlock */
    if (!((await server1('pc-nell')).stress > 0)) { await region(pg, 'stress'); await pg.click('#dossier .sp-panel [data-act="stress"][data-n="5"]'); await sleep(400); await closeEd(pg).catch(() => {}); }
    const sd = (await server1('pc-nell')).stress;
    await region(pg, 'keys'); await pg.click('#dossier .sp-panel [data-gl="deadlock"][data-i="1"][data-dir="down"]'); await sleep(500);
    u = await bar(pg);
    const dz = await until(async () => { const p = await server1('pc-nell'); return p && p.stress === 0 && p.keys[1].deadlock === 'down' ? p : null; }, 8000, 200);
    check(!!dz && u && u.label === 'Deadlocked KEY-2: Stress ' + sd + ' → 0' && u.undo && (await stressOf(pg)) === 0, 'a deadlock from the page\'s keys editor resets Stress to 0, with Undo: ' + JSON.stringify(u));
    await shot(pg, 'deadlock-from-page-390x664-paper');
    await undoBar(pg);
    const du = await until(async () => { const p = await server1('pc-nell'); return p && p.stress === sd ? p : null; }, 8000, 200);
    check(!!du && du.keys[1].deadlock === 'down', 'Undo puts Stress back to ' + sd + '; the deadlock stays (the GM\'s to undo): ' + JSON.stringify(du && du.keys[1]));
    await closeEd(pg).catch(() => {});
    await region(pg, 'actions'); await pg.click('#dossier .sp-panel [data-act="rollopen"][data-a="Hunt"]'); await sleep(500);
    const roll = await pg.evaluate(() => { const r = document.querySelector('#dossier .ds-roll'); return { ed: !!document.querySelector('#dossier .sp-panel'), roll: !!r && r.getClientRects().length > 0 && getComputedStyle(r).position === 'fixed' }; });
    check(!roll.ed && roll.roll, 'actions: a tap on an action opens today\'s roll strip over the page: ' + JSON.stringify(roll));
    await pg.click('#dossier .ds-roll [data-act="markopt"][data-k="push"]'); await sleep(400);
    const lr = await pg.evaluate(() => { const b = document.querySelector('#dossier .gl-undo'), r = document.querySelector('#dossier .ds-roll'); return b && !b.hidden ? { bar: Math.round(b.getBoundingClientRect().bottom), roll: Math.round(r.getBoundingClientRect().top) } : null; });
    check(!!lr && lr.bar <= lr.roll, 'Push in the roll strip over the page: the Undo bar sits above the strip: ' + JSON.stringify(lr));
    await shot(pg, 'roll-from-page-390x664-paper');
    await undoBar(pg);
    await pg.click('#dossier .ds-roll [data-act="panelclose"]').catch(() => {}); await sleep(200);
    await pg.click('#dossier .sp [data-sp="back"]'); await sleep(300);
    check(!!(await glanceUp(pg, 3000)), '‹ comes back to the glance screen');
    await toFull(pg); await ready(pg);
    check(sheetReqs(S).length === 2, 'opened again: the sheet is cached (still two requests)');
    await S.ctx.close();

    /* a map whose count disagrees: nothing drawn there, the note on the page and in the editor */
    const B = await open('pc-nell', { w: 390, h: 664, sheets: { map: blankSheet(CT, 'hound', { stress: 8 }).map } }), bp = B.page; await glanceUp(bp); await toFull(bp); await ready(bp);
    const mm = await bp.evaluate(() => { const w = document.querySelector('#dossier .sp-warn'); return { notes: Array.from(document.querySelectorAll('#dossier .sp-unmapped text')).map((t) => t.textContent), warn: w && !w.hidden && w.getClientRects().length ? w.textContent : null, px: w ? parseFloat(getComputedStyle(w).fontSize) : 0 }; });
    const doc1 = (await api('GET', '/characters/pc-nell', null, P1)).json.doc, want8 = PG.marks(blankSheet(CT, 'hound', { stress: 8 }).map, { play: doc1.play, pb: CT.byId.hound, doc: doc1 }, null, CT);
    const p8 = await region(bp, 'stress');
    check(mm.warn === '1 part of this sheet isn\u2019t mapped: use the glance screen for it' && mm.px >= 15, 'the page says so in words under its bar, readable at 390 x 664: ' + mm.warn);
    check(mm.notes.length === 1 && mm.notes[0] === PG.NOTE && (await pens(bp)) === (want8.match(/class="sp-pen"/g) || []).length && p8 && p8.note,
      '8 stress boxes on the map for a 9-box track: no stress mark, the note on the page and in the editor: ' + JSON.stringify(mm));
    await closeEd(bp);
    await shot(bp, 'mismatch-390x664-paper');
    await B.ctx.close();

    /* nothing published: the classic sheet, and the next Full sheet goes there at once */
    const N = await open('pc-nell', { w: 390, h: 664, sheets: { none: true } }), np = N.page; await glanceUp(np); await toFull(np);
    const fb = await until(() => gl(np).then((v) => v === 'sheet'), 5000, 100);
    await np.click('#dossier .gl-backbar [data-gl="glance"]'); await glanceUp(np, 3000); await toFull(np); await sleep(300);
    check(!!fb && (await gl(np)) === 'sheet' && sheetReqs(N).length === 1, 'no sheet published: Full sheet falls back to today\'s sheet, and once known, with no second request: ' + sheetReqs(N));
    await N.ctx.close();

    /* held sideways: the page with a side panel (the glance is still a tap away) */
    const L = await open('pc-nell', { w: 664, h: 390, sheets: {} }), lp = L.page; await glanceUp(lp); await toFull(lp); await ready(lp);
    const lw = await lp.evaluate(() => window.B68SheetPage.state());
    await shot(lp, 'page-664x390-paper');
    const lpn = await region(lp, 'stacks');
    check(lw.wide && lpn && lpn.r === 664 && lpn.l > 200 && lpn.top >= 50, 'held sideways (664 x 390): the page, and its editors as a side panel: ' + JSON.stringify([lw, lpn]));
    await shot(lp, 'editor-664x390-paper');
    await L.ctx.close();
    { const LN = await open('pc-nell', { w: 664, h: 390, night: true, sheets: {} }); await glanceUp(LN.page); await toFull(LN.page); await ready(LN.page); await shot(LN.page, 'page-664x390-night'); await region(LN.page, 'harm'); await shot(LN.page, 'editor-664x390-night'); await LN.ctx.close(); }

    /* over 760 px (a tablet, a laptop): the page is the main view, with a thin bar, side panels and the Undo bar; print stays today's sheet */
    for (const night of [false, true]) {
      const W = await open('pc-nell', { w: 1024, h: 768, mobile: false, night, sheets: {} }), wp = W.page; await ready(wp);
      const wi = await wp.evaluate(() => { const vis = (e) => !!e && e.getClientRects().length > 0; return { v: document.getElementById('dossier').getAttribute('data-gl'), s: window.B68SheetPage.state(), boxes: Array.from(document.querySelectorAll('#dossier section.ds-box:not(.ds-now)')).filter(vis).length,
        back: vis(document.querySelector('#dossier .sp-back')), quiet: !!document.querySelector('#dossier .ds-quietbtn') === vis(document.querySelector('#dossier .sp-bar [data-act="quiet"]')), w: Math.round(document.querySelector('#dossier .sp-box').getBoundingClientRect().width) }; });
      await shot(wp, 'page-1024x768-' + (night ? 'night' : 'paper'));
      if (night) { await wp.locator('#dossier .sp-hit[data-region="keys"]').first().click(); await panel(wp, 'keys'); await shot(wp, 'editor-1024x768-night'); }
      if (!night) {
        check(wi.v === 'page' && wi.s.wide && wi.boxes === 0 && !wi.back && wi.quiet && wi.w > 900, '1024 x 768: the filled-in page is the main view over today\'s sheet (no back to a glance that is not drawn here): ' + JSON.stringify(wi));
        await wp.locator('#dossier .sp-hit[data-region="stress"]').first().click(); const wpn = await panel(wp, 'stress');
        await wp.click('#dossier .sp-panel [data-act="stress"][data-n="2"]'); await sleep(400);
        const wu = await wp.evaluate(() => { const u = document.querySelector('#dossier .gl-undo'); return u && !u.hidden ? { label: u.querySelector('.gl-u-l').textContent, d: getComputedStyle(u).display } : null; });
        check(wpn && wpn.r === 1024 && wpn.l >= 600 && wpn.top >= 50 && wu && wu.d === 'flex' && /^Stress \d+ → 2$/.test(wu.label), '1024: an editor is a side panel, and a change shows the Undo bar: ' + JSON.stringify([wpn, wu]));
        await shot(wp, 'editor-1024x768-paper');
        await wp.click('#dossier .gl-undo .gl-u-go'); await sleep(300);
        await wp.emulateMedia({ media: 'print' });
        const pr = await wp.evaluate(() => ({ boxes: Array.from(document.querySelectorAll('#dossier section.ds-box')).filter((b) => b.getClientRects().length).length, sp: getComputedStyle(document.querySelector('#dossier .gl')).display }));
        check(pr.boxes >= 14 && pr.sp === 'none', 'print with the page up: today\'s sheet: ' + JSON.stringify(pr));
      }
      await W.ctx.close();
    }
    { const P = await open('pc-nell', { w: 390, h: 664, night: true, sheets: {} }); await glanceUp(P.page); await toFull(P.page); await ready(P.page); await shot(P.page, 'page-390x664-first-night'); await P.page.click('#dossier .sp [data-sp="in"]'); await sleep(200); await shot(P.page, 'page-390x664-250-night'); await region(P.page, 'keys'); await shot(P.page, 'editor-keys-390x664-night'); await P.ctx.close(); }
  }

  /* ---------- the four-screen sheet stays undrawn; off again ---------- */
  const K = await open('pc-nell', { w: 390, h: 664 }), k = K.page; await glanceUp(k);
  await feature({ 'kit.phone': true });
  await sleep(4000);
  const kit = await k.evaluate(() => ({ bar: !!document.querySelector('#dossier .ks17-bar'), marks: document.querySelectorAll('[data-ks17]').length, gl: document.getElementById('dossier').getAttribute('data-gl') }));
  check(!kit.bar && kit.marks === 0 && kit.gl === 'glance', 'kit.phone on too: the four-screen sheet is not drawn: ' + JSON.stringify(kit));
  await feature({ 'phone.glance': false });
  check(!!(await until(() => k.evaluate(() => !!document.querySelector('#dossier .ks17-bar') && !document.querySelector('#dossier .gl') && !document.querySelector('[data-gl-off]') && document.getElementById('dossier').getAttribute('data-gl') === null), 20000, 200)),
    'the glance off: its node and marks go at once, and the four-screen sheet comes back');
  await feature({ 'kit.phone': false });
  check(!!(await until(() => k.evaluate(() => !document.querySelector('#dossier .ks17-bar') && Array.from(document.querySelectorAll('#dossier section.ds-box')).filter((b) => b.getClientRects().length).length >= 14), 20000, 200)), 'both off: today\'s long page');
  await K.ctx.close();

  /* ---------- wide: a desk's width and print are today's sheet ---------- */
  await feature({ 'phone.glance': true });
  const D = await open('pc-nell', { w: 1024, h: 768, mobile: false, sheets: { none: true } }), d = D.page;
  /* RK32: over 760 px the page opens as the main view; with no sheet published it falls back to today's sheet: wait for that */
  await until(() => d.evaluate(() => !!document.querySelector('#dossier .gl') && document.getElementById('dossier').getAttribute('data-gl') === 'sheet'), 15000);
  const wide = await d.evaluate(() => ({ gl: getComputedStyle(document.querySelector('#dossier .gl')).display, boxes: Array.from(document.querySelectorAll('#dossier section.ds-box')).filter((b) => b.getClientRects().length).length }));
  check(wide.gl === 'none' && wide.boxes >= 14, '1024 px: the glance shows nothing and hides nothing: ' + JSON.stringify(wide));
  await d.emulateMedia({ media: 'print' });
  const pr = await d.evaluate(() => ({ gl: getComputedStyle(document.querySelector('#dossier .gl')).display, boxes: Array.from(document.querySelectorAll('#dossier section.ds-box')).filter((b) => b.getClientRects().length).length }));
  check(pr.gl === 'none' && pr.boxes >= 14, 'print: today\'s sheet: ' + JSON.stringify(pr));
  await D.ctx.close();

  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
} catch (e) {
  console.log('FAIL ' + (e && e.stack || e));
  failed++;
}
clearTimeout(timeout);
await browser.close();
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
