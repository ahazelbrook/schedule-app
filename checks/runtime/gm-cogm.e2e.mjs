// The co-GM on the real GM page, in a real browser (ticket C2; app/gm/cogm.js, gm-page.js mountCogm, the switch in the Blade panel's header). The table, the cast, the capture bar,
// the display and the ambient document are the REAL local Worker; the two things the browser answers itself are the transcript feed (GET /api/gm/transcript, a fake feed the
// test types into) and POST /api/gm/assist/act (a fake: no key, no model, no spend). Every name and sentence is invented.
//   shown: a clock appears and Undo removes it; a window sent twice does not apply twice; a 429 does not advance the cursor and the same window goes again; an offer card's
//   "Do it"; Undo is a compare-and-swap (a changed clock is refused and asks first); a new NPC is hidden (revealed: false), a player cannot read it, model text stays text,
//   and Reveal and show asks first and goes through the display's push; the switch is off by default, refuses without Listening and switches itself off when Listening goes;
//   no request writes a player's sheet, and the display and the ambient document are written only by the one Reveal and show.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=8878] node checks/runtime/gm-cogm.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8878);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', PLAYER = 'player@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json');
const PARTS = {
  console: con.parts.console, campaign: np.parts.campaign, npc: np.parts.npc,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-cogm-e2e-'));
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
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j }; });
const clocksNow = async () => ((await api('GET', '/campaign')).json.doc.clocks || []);
const SPEND = { tonight: 0.3, cap: 20, tier: 'all', tick: 0.02 };
const npcs = async (user = GM) => ((await api('GET', '/npcs', null, user)).json.docs || []);
const npcNamed = async (name) => (await npcs()).find((n) => n.doc.name === name) || null;
const XSS = '<img src=x onerror="window.__pwn=1">';

// the fake transcript feed and the fake /act, shared by the page's routes
const feed = { lines: [], last: 0 };
function say(...texts) { for (const text of texts) { feed.last++; feed.lines.push({ seq: feed.last, id: 'l' + feed.last, session: '1', at: new Date().toISOString(), conn: 'c', speaker: 0, kind: 'line', text }); } }
const seen = { act: [], replies: [], dialogs: [], accept: false, promptText: '', requests: [] };
const act = (a) => Object.assign({ mode: 'act', confidence: 0.9, at: '22:41' }, a);
const reply = (actions, dropped = []) => seen.replies.push({ status: 200, body: { actions, dropped, spend: SPEND } });

try {
  const up = await until(async () => { try { return (await fetch(BASE + '/index.html')).status > 0; } catch (_) { return false; } }, 90000, 500);
  if (!up) throw new Error('the server did not start');
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status);
  }
  await api('PUT', '/campaign', { v: 1, session: { number: 1, startedAt: new Date().toISOString(), endedAt: null }, crew: { name: 'The Lamplighters', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] },
    clocks: [{ id: 'c_seed', name: 'Seed Clock Invented', size: 6, filled: 2, kind: 'danger', hidden: false }], log: [] });
  await api('PUT', '/npcs/npc_known', { name: 'Marta Quillfeather', role: 'invented', revealed: true, firstSeen: new Date().toISOString() });
  await api('PATCH', '/gm/stt', { want: 'on' });

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await c.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  // The page's own heat/wanted sync PATCHes the ambient document with { crew: { heat, wanted } } about two seconds after the table loads, whatever the GM does (makeCrewSync in
  // gm-page.js; the Blade panel's e2e ignores exactly this shape too). It is not the co-GM, so it is left out of the ledger; any other ambient write still counts.
  const crewSyncOnly = (rq) => {
    if (rq.method() !== 'PATCH' || !/\/api\/gm\/ambient$/.test(rq.url())) return false;
    let b = null; try { b = JSON.parse(rq.postData() || 'null'); } catch (_) { return false; }
    return !!b && typeof b === 'object' && Object.keys(b).join() === 'crew' && !!b.crew && Object.keys(b.crew).every((k) => (k === 'heat' || k === 'wanted') && typeof b.crew[k] === 'number');
  };
  page.on('request', (r) => { if (r.url().startsWith(BASE + '/api/') && !crewSyncOnly(r)) seen.requests.push(r.method() + ' ' + r.url().slice(BASE.length)); });
  page.on('dialog', (d) => { seen.dialogs.push(d.type() + ': ' + d.message()); if (d.type() === 'prompt') return d.accept(seen.promptText); return seen.accept ? d.accept() : d.dismiss(); });
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/api/gm/assist/tick', (route) => json(route, { cards: [], updates: [], flags: [], spend: SPEND, last: 9 }));
  await page.route('**/api/gm/assist/cards', (route) => route.request().method() === 'POST' ? json(route, { marked: 1 }) : json(route, { cards: [], updates: [], asks: [] }));
  await page.route('**/api/gm/transcript**', (route) => {
    const u = new URL(route.request().url());
    if (route.request().method() !== 'GET') return json(route, { error: 'no' }, 405);
    const tail = Number(u.searchParams.get('tail') || 0), after = Number(u.searchParams.get('after') || 0);
    return json(route, { lines: tail ? feed.lines.slice(-tail) : feed.lines.filter((l) => l.seq > after).slice(0, 500), last: feed.last });
  });
  await page.route('**/api/gm/assist/act', (route) => {
    seen.act.push({ body: JSON.parse(route.request().postData() || '{}'), at: Date.now() });
    const r = seen.replies.shift() || { status: 200, body: { actions: [], dropped: [], spend: SPEND } };
    return json(route, r.body, r.status);
  });
  say('we are in the cellar', 'tick that', 'and the lamp is low');          // before co-GM is on: never replayed
  await page.goto(BASE + '/#gm');
  await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
  await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  await page.keyboard.press('a');
  await page.waitForFunction(() => document.querySelector('#as-panel').getBoundingClientRect().left < innerWidth - 100, null, { timeout: 4000 });
  await page.evaluate(() => { const T = window.B68GmCogm.TIMING; T.poll = 250; T.gap = 700; T.settle = 700; });      // the timing is the module's own knob; the checks run it fast
  const sw = '#as-cogm';
  const cogmCards = () => page.$$eval('#as-list .as-card[data-id^="cogm|"]', (l) => l.map((x) => ({ id: x.getAttribute('data-id'), kind: x.getAttribute('data-kind'), text: x.querySelector('.as-text').textContent, html: x.innerHTML })));
  const card = (i) => cogmCards().then((l) => l[i]);
  const firstCard = (key) => '#as-list .as-card[data-id="cogm|' + key + '"]';
  const unfold = async (key) => { const s = firstCard(key); if ((await page.$eval(s, (e) => e.getAttribute('data-open'))) !== '1') await page.click(s + ' .as-fold'); return s; };
  const toastText = () => page.$$eval('.toast, #toast, [role="status"]', (l) => l.map((x) => x.textContent).join(' | '));

  // ============ the switch: in the header, off by default, refuses without Listening ============
  check(await page.$eval(sw, (b) => b.getAttribute('aria-pressed') === 'false' && /off/i.test(b.textContent)), 'the Co-GM switch is in the panel header and is OFF by default');
  check(await page.$eval(sw, (b) => !!b.closest('.as-head')), 'it sits in the header (.as-head)');
  await api('PATCH', '/gm/stt', { want: 'off' });
  await page.click(sw);
  await sleep(600);
  check(await page.$eval(sw, (b) => b.getAttribute('aria-pressed') === 'false'), 'with Listening off, a tap leaves it off');
  check(/Listening/.test(await toastText()), 'and says why');
  await api('PATCH', '/gm/stt', { want: 'on' });
  await page.click(sw);
  check(await until(() => page.$eval(sw, (b) => b.getAttribute('aria-pressed') === 'true'), 5000), 'with Listening on, a tap turns it on');
  await sleep(1500);
  check(seen.act.length === 0, 'the talk before it was switched on ("tick that") is never replayed: no /act call');

  // ============ a clock appears, and Undo removes it ============
  const K1 = 'clock_add:drains-below-invented:aa000001';
  reply([act({ type: 'clock_add', key: K1, name: 'Drains Below Invented', size: 6, hidden: false, quote: "that's going to be a six-segment clock, call it Drains Below Invented" })]);
  say("right, that's going to be a six-segment clock, call it Drains Below Invented", 'the water is rising', 'everyone ok with that');
  check(await until(() => seen.act.length >= 1, 8000), 'a match sends one /act call');
  const b1 = seen.act[0].body;
  check(b1.from === 4 && b1.to === 6 || (b1.from <= 4 && b1.to >= 4 && b1.to - b1.from <= 6), 'the window holds the matching line (seqs ' + b1.from + '-' + b1.to + ')');
  check(Array.isArray(b1.state.clocks) && b1.state.clocks.some((k) => k.id === 'c_seed' && k.size === 6 && k.filled === 2 && k.hidden === false) && b1.state.npcs.some((n) => n.name === 'Marta Quillfeather') && 'onStage' in b1.state && !('health' in b1.state), 'the state carries the live clocks and the cast');
  check(await until(async () => (await clocksNow()).some((k) => k.name === 'Drains Below Invented'), 8000), 'the clock is on the real table');
  const made = (await clocksNow()).find((k) => k.name === 'Drains Below Invented');
  check(made && made.size === 6 && made.filled === 0 && made.hidden === true && made.kind === 'danger', 'it is a hidden, empty, six-segment danger clock (hidden from the players even though the model said hidden: false)');
  const gc = await until(async () => (await card(0)), 4000);
  check(gc && gc.id === 'cogm|' + K1 && gc.kind === 'done' && gc.text === 'Clock made (hidden): Drains Below Invented (6)', 'a green card: ' + (gc && gc.text));
  const s1 = await unfold(K1);
  check(JSON.stringify(await page.$$eval(s1 + ' .as-acts button', (l) => l.map((b) => b.textContent.trim()))) === JSON.stringify(['Show players', 'Rename', '☆ Keep', 'Undo', 'Got it ×']), 'the card has Show players, Rename and Undo');
  check(/Heard at 22:41: .that's going to be a six-segment clock/.test(await page.$eval(s1 + ' .as-body, ' + s1 + ' [class*="as-body"]', (e) => e.textContent).catch(() => '')), 'the quote is on the card');

  // a window sent twice does not apply twice (the same key comes back in a later window)
  reply([act({ type: 'clock_add', key: K1, name: 'Drains Below Invented', size: 6, quote: "that's going to be a six-segment clock, call it Drains Below Invented" })]);
  say('so anyway', 'the water keeps rising', 'and the dock is wet');
  say("yes it's a six-segment clock, as I said");
  check(await until(() => seen.act.length >= 2, 8000), 'a second window is sent');
  await sleep(1200);
  check((await clocksNow()).filter((k) => k.name === 'Drains Below Invented').length === 1, 'the same key again: still ONE clock on the table');
  check((await cogmCards()).filter((x) => x.id === 'cogm|' + K1).length === 1 && (await cogmCards()).find((x) => x.id === 'cogm|' + K1).kind === 'done', 'and still one card, still green (not turned into an offer)');

  // Undo removes it
  await page.click(s1 + ' .as-undo');
  check(await until(async () => !(await clocksNow()).some((k) => k.name === 'Drains Below Invented'), 6000), 'Undo takes the clock off the table');
  check((await clocksNow()).some((k) => k.id === 'c_seed' && k.filled === 2), 'and leaves the GM\'s own clock alone');
  check(await until(() => page.$eval(firstCard(K1), (e) => /Undone/.test(e.textContent)), 3000), 'the card says Undone');
  // the key is still seen after an Undo: the same decision, heard again, does not bring the clock back
  reply([act({ type: 'clock_add', key: K1, name: 'Drains Below Invented', size: 6, quote: "that's going to be a six-segment clock, call it Drains Below Invented" })]);
  say('ok moving on', 'the next room', 'is quiet');
  say('the clock is six segments, said it already');
  check(await until(() => seen.act.length >= 3, 8000), 'a third window is sent');
  await sleep(1200);
  check(!(await clocksNow()).some((k) => k.name === 'Drains Below Invented'), 'after Undo, the same key again does not bring the clock back');

  // ============ a 429 does not advance the cursor: the same window goes again, and applies once ============
  const n0 = seen.act.length;
  const K2 = 'clock_add:ferry-late-invented:aa000002';
  seen.replies.push({ status: 429, body: { error: 'cooling down' } });
  reply([act({ type: 'clock_add', key: K2, name: 'Ferry Late Invented', size: 4, quote: 'make that a four part clock, the Ferry Late Invented' })]);
  say('make that a four part clock, the Ferry Late Invented', 'sure', 'right');
  check(await until(() => seen.act.length >= n0 + 2, 10000), 'after a 429 the window is sent again');
  const [r1, r2] = [seen.act[n0].body, seen.act[n0 + 1].body];
  check(r1.from === r2.from && r1.to === r2.to, 'the same window (' + r1.from + '-' + r1.to + ' twice): the 429 did not move the cursor');
  check(seen.act[n0 + 1].at - seen.act[n0].at >= 600, 'and not before the gap (' + (seen.act[n0 + 1].at - seen.act[n0].at) + ' ms)');
  check(await until(async () => (await clocksNow()).some((k) => k.name === 'Ferry Late Invented'), 6000), 'it applied');
  await sleep(1000);
  check((await clocksNow()).filter((k) => k.name === 'Ferry Late Invented').length === 1, 'exactly once');

  // ============ Undo is a compare-and-swap: a clock changed since is not clobbered ============
  const K3 = 'clock_tick:c_seed:aa000003';
  reply([act({ type: 'clock_tick', key: K3, clock_id: 'c_seed', clock_name: 'Seed Clock Invented', by: 1, from_filled: 2, to_filled: 3, size: 6, quote: 'tick that once, the guards are stirring' })]);
  say('tick that once, the guards are stirring', 'they are', 'quietly');
  check(await until(async () => (await clocksNow()).find((k) => k.id === 'c_seed').filled === 3, 10000), 'a tick: the seed clock goes 2 to 3');
  check(await until(async () => (await card(0)) && (await card(0)).id === 'cogm|' + K3, 3000), 'with a green card ' + JSON.stringify((await card(0) || {}).text));
  // the GM changes it by hand (here: through the API, then the page reads it)
  await api('PATCH', '/campaign', { clockOps: [{ id: 'c_seed', filled: 5 }] });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await sleep(1500);
  const s3 = await unfold(K3);
  await page.click(s3 + ' .as-undo');
  await sleep(1200);
  check((await clocksNow()).find((k) => k.id === 'c_seed').filled === 5, 'Undo of the tick REFUSES: the clock now at 5 is not clobbered');
  check(!(await page.$eval(firstCard(K3), (e) => /Undone/.test(e.textContent))), 'and the card does not say Undone');
  check(/Changed since: now 5\/6, was 3\/6/.test(await page.$eval(firstCard(K3), (e) => e.textContent)), 'it says what changed');
  check(await page.$eval(firstCard(K3), (e) => [...e.querySelectorAll('.as-act')].some((b) => b.textContent === 'Undo anyway')), 'and offers Undo anyway');
  await page.click(s3 + ' .as-act:has-text("Undo anyway")');
  check(await until(async () => (await clocksNow()).find((k) => k.id === 'c_seed').filled === 2, 6000), 'Undo anyway sets it back to 2');
  check(await until(() => page.$eval(firstCard(K3), (e) => /Undone/.test(e.textContent)), 3000), 'and the card says Undone');

  // ============ an offer: a yellow card and Do it; a same-name clock is an offer too ============
  const K4 = 'clock_add:low-light-invented:aa000004', K5 = 'clock_add:seed-clock-invented:aa000005';
  reply([act({ type: 'clock_add', key: K4, mode: 'offer', confidence: 0.5, name: 'Low Light Invented', size: 8, quote: 'maybe an eight segment clock for the low light' }),
    act({ type: 'clock_add', key: K5, name: 'seed clock invented', size: 4, quote: 'another four part clock called seed clock invented' })]);
  say('maybe an eight segment clock for the low light', 'another four part clock called seed clock invented', 'we will see', 'ok');
  check(await until(async () => (await cogmCards()).filter((x) => x.id === 'cogm|' + K4 || x.id === 'cogm|' + K5).length === 2, 10000), 'two cards arrive');
  const cs = await cogmCards();
  check(cs.filter((x) => x.kind === 'idea').length === 2, 'both are yellow (idea) offers: a low-confidence one, and one whose name is already on the table');
  check(!(await clocksNow()).some((k) => k.name === 'Low Light Invented') && (await clocksNow()).filter((k) => /seed clock invented/i.test(k.name)).length === 1, 'nothing was written');
  check(await page.$eval(firstCard(K4), (e) => e.getAttribute('data-open') === '1' && [...e.querySelectorAll('.as-act')].some((b) => b.textContent === 'Do it')), 'an offer is open, with Do it');
  await page.click(firstCard(K4) + ' .as-act:has-text("Do it")');
  check(await until(async () => (await clocksNow()).some((k) => k.name === 'Low Light Invented' && k.size === 8 && k.hidden === true), 8000), 'Do it makes the clock');
  check(await until(async () => (await card(0)) && ((await cogmCards()).find((x) => x.id === 'cogm|' + K4) || {}).kind === 'done', 3000), 'the offer turns into a green card');
  await page.click(firstCard(K4) + ' .as-fold').catch(() => {});
  const s4 = await unfold(K4);
  check(await page.$eval(s4, (e) => !!e.querySelector('.as-undo')), 'with an Undo');
  await page.click(s4 + ' .as-act:has-text("Rename")');
  check(seen.dialogs.some((d) => /^prompt: Rename the clock/.test(d)), 'Rename asks for the new name');     // the dialog is dismissed with empty text: nothing changes
  check((await clocksNow()).some((k) => k.name === 'Low Light Invented'), 'an empty rename changes nothing');
  seen.promptText = 'Low Light Renamed';
  await page.click(s4 + ' .as-act:has-text("Rename")');
  check(await until(async () => (await clocksNow()).some((k) => k.name === 'Low Light Renamed'), 6000), 'Rename renames it on the table');
  check(await until(async () => ((await cogmCards()).find((x) => x.id === 'cogm|' + K4) || {}).text === 'Clock made (hidden): Low Light Renamed (8)', 3000), 'and on the card');
  await page.click(s4 + ' .as-undo');
  check(await until(async () => !(await clocksNow()).some((k) => /Low Light/.test(k.name)), 6000), 'Undo after its own Rename still works: the card\'s own edit is not "changed since"');
  const kSkip = 'cogm|' + K5;
  await page.click('#as-list .as-card[data-id="' + kSkip + '"] .as-ack');
  await sleep(300);
  check(!(await cogmCards()).some((x) => x.id === kSkip), 'Skip dismisses an offer');

  // ============ a new NPC: hidden, a player cannot see it, model text stays text, Reveal and show asks first ============
  const K6 = 'npc_add:xss-name:aa000006';
  const displayKind = async () => (await api('GET', '/gm/display')).json.display.kind;
  const disp0 = await displayKind();
  const reqs0 = seen.requests.length;
  reply([act({ type: 'npc_add', key: K6, name: XSS, look: 'a tall figure in <b>green</b>', role: 'fence', quote: "his name's whoever, tall, green coat" })]);
  say("his name's whoever, tall, green coat", 'he nods', 'ok');
  check(await until(async () => (await cogmCards()).some((x) => x.id === 'cogm|' + K6), 10000), 'the NPC card arrives');
  const made2 = await npcNamed(XSS), doc = made2 ? made2.doc : null, nid = made2 ? made2.id : null;
  check(doc && doc.revealed === false && doc.firstSeen === null && doc.tags.includes('cogm') && doc.description === 'a tall figure in <b>green</b>' && doc.role === 'fence', 'the NPC is saved revealed: false, tagged cogm, with the look as plain text');
  const asPlayer = JSON.stringify(await npcs(PLAYER));
  check(!asPlayer.includes('onerror') && !asPlayer.includes('whoever') && !asPlayer.includes('tall figure'), 'a player\'s read of the cast does not include it');
  check(await page.evaluate(() => window.__pwn === undefined), 'the model\'s markup did not run');
  check(await page.$eval(firstCard(K6), (e) => !e.querySelector('img') && !e.querySelector('.as-text b, .as-text i')), 'no element was made from the NPC name or look (textContent only)');
  check(((await card(0)).text) === 'New NPC (hidden): ' + XSS, 'the headline shows the name as text');
  check(await displayKind() === disp0 && !seen.requests.slice(reqs0).some((r) => /^(PUT|POST|PATCH|DELETE) \/api\/gm\/(display|ambient)/.test(r)), 'creating the NPC wrote nothing to the display or the ambient document');
  const s6 = await unfold(K6);
  check(JSON.stringify(await page.$$eval(s6 + ' .as-acts button', (l) => l.map((b) => b.textContent.trim()))) === JSON.stringify(['Draw portrait', 'Reveal and show', '☆ Keep', 'Undo', 'Got it ×']), 'the NPC card has Draw portrait, Reveal and show, and Undo');
  seen.accept = false;
  await page.click(s6 + ' .as-act:has-text("Reveal and show")');
  await sleep(800);
  check(seen.dialogs.some((d) => /^confirm: .*hidden from the players/.test(d)), 'Reveal and show asks first');
  const afterNo = (await api('GET', '/npcs/' + nid)).json;
  check(((afterNo.doc || afterNo).revealed === false) && await displayKind() === disp0, 'a No reveals nothing and shows nothing');
  // an Undo of the NPC (still hidden) tags it undone, never deletes it
  const K7 = 'npc_add:second-face:aa000007';
  reply([act({ type: 'npc_add', key: K7, name: 'Second Face Invented', look: 'a thin clerk', quote: 'her name is Second Face Invented, thin clerk' })]);
  say('her name is Second Face Invented, thin clerk', 'she waves', 'ok');
  check(await until(async () => (await cogmCards()).some((x) => x.id === 'cogm|' + K7), 10000), 'a second NPC');
  const s7 = await unfold(K7);
  await page.click(s7 + ' .as-undo');
  check(await until(async () => { const n = await npcNamed('Second Face Invented'); return n && n.doc.tags.includes('undone'); }, 6000), 'Undo tags the NPC undone; it is not deleted');
  const u2 = await npcNamed('Second Face Invented');
  check(u2 && u2.doc.revealed === false, 'and it is still hidden');
  // the same name again after an undo is allowed (an undone NPC is not "known")
  const stateAfter = seen.act.length;
  reply([]); say('right', 'the next thing', 'and the next'); say('clock clock');
  check(await until(() => seen.act.length > stateAfter, 8000), 'another window');
  check(!seen.act[seen.act.length - 1].body.state.npcs.some((n) => n.name === 'Second Face Invented') && seen.act[seen.act.length - 1].body.state.npcs.some((n) => n.name === XSS), 'the state sent leaves the undone NPC out (so the name can be added again) and keeps the live one');
  // now the one that is revealed with a tap
  seen.accept = true;
  await page.click(s6 + ' .as-act:has-text("Reveal and show")');
  check(await until(async () => ((await api('GET', '/npcs/' + nid)).json.doc || {}).revealed === true, 8000), 'a Yes reveals the NPC');
  check(await until(async () => (await displayKind()) === 'npc', 8000), 'and shows it on the iPad through the display call');
  check(seen.requests.filter((r) => /^(PUT|POST|PATCH) \/api\/gm\/display/.test(r)).length >= 1, 'the display was written by that tap');
  // Undo after the reveal: the compare-and-swap refuses
  await page.click(s6 + ' .as-undo');
  await sleep(1200);
  check(((await api('GET', '/npcs/' + nid)).json.doc || {}).revealed === true && !(((await api('GET', '/npcs/' + nid)).json.doc || {}).tags || []).includes('undone'), 'Undo after the reveal is REFUSED: it does not hide them again behind the GM\'s back');
  check(/revealed to the players/.test(await page.$eval(firstCard(K6), (e) => e.textContent)), 'and the card says why');

  // ============ capture: filed in the capture bar, Undo takes the line out ============
  const K8 = 'capture:moment:aa000008';
  reply([act({ type: 'capture', key: K8, bucket: 'moment', text: 'Invented: the lamp went out on the stairs', quote: 'flashback to when the lamp went out on the stairs' })]);
  say('flashback to when the lamp went out on the stairs', 'oh', 'right');
  check(await until(async () => /the lamp went out on the stairs/.test(await page.$eval('#gm-foot', (e) => e.textContent)), 10000), 'the capture bar has the line');  const s8 = await unfold(K8);
  await page.click(s8 + ' .as-undo');
  check(await until(async () => !/the lamp went out on the stairs/.test(await page.$eval('#gm-foot', (e) => e.textContent)), 6000), 'Undo removes that capture line');

  // ============ the switch follows the box: Listening off switches it off ============
  await api('PATCH', '/gm/stt', { want: 'off' });
  check(await until(() => page.$eval(sw, (b) => b.getAttribute('aria-pressed') === 'false'), 10000), 'when Listening goes off, the switch goes off by itself');
  const nOff = seen.act.length;
  reply([act({ type: 'clock_add', key: 'clock_add:never:aa000009', name: 'Never Made Invented', size: 4, quote: 'a four part clock never made' })]);
  say('a four part clock never made', 'x', 'y');
  await sleep(2500);
  check(seen.act.length === nOff && !(await clocksNow()).some((k) => k.name === 'Never Made Invented'), 'and nothing is sent or applied while it is off');
  await api('PATCH', '/gm/stt', { want: 'on' });

  // ============ the safety ledger: what the page asked the server to write ============
  const writes = seen.requests.filter((r) => /^(PUT|POST|PATCH|DELETE) /.test(r));
  check(!writes.some((r) => /\/api\/characters/.test(r)), 'no request wrote a player\'s sheet (/api/characters): ' + writes.filter((r) => /characters/.test(r)).length);
  check(!writes.some((r) => /\/api\/gm\/ambient/.test(r)), 'no request wrote the ambient document');
  check(writes.filter((r) => /\/api\/gm\/display/.test(r)).length >= 1 && writes.filter((r) => /\/api\/gm\/display/.test(r)).length <= 3, 'the display was written only by the one Reveal and show');
  check(errors.length === 0, 'no console errors: ' + JSON.stringify(errors.slice(0, 3)));
  await c.close();
  await browser.close();
} catch (e) {
  console.log('FAIL ' + (e && e.stack || e)); failed++;
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
