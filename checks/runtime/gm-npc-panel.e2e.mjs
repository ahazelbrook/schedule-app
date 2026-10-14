// The NPC generator panel (N) on the real GM page, in a real browser, against a local wrangler dev:
// the tab and key, a roll with its portrait, the stored state (replay info only), reload (the same NPC), Earlier, Pin,
// "Add to the cast" (a hidden doc plus the roll's seed for the vault sync), a replay of that seed outside the page, a phone layout.
// Invented fixtures only (checks/runtime/fixtures/gm/).
//   PW_MODULE=<path to playwright> node checks/runtime/gm-npc-panel.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8858);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.GM_SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const N = require(path.join(ROOT, 'app', 'gm', 'npc.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json');
const PARTS = {
  console: con.parts.console, campaign: np.parts.campaign, npc: np.parts.npc,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-npcpanel-e2e-'));
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
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  await api('PATCH', '/campaign', { session: { number: 4 } });

  const browser = await chromium.launch();
  const errors = [];
  async function open(hash, { width = 1280, height = 900, mobile = false } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width, height }, serviceWorkers: 'block', isMobile: mobile, hasTouch: mobile });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(BASE + '/' + hash);
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
    return { c, page };
  }
  const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

  const G = await open('#gm');
  const p = G.page;
  await p.keyboard.press('n');
  check(await p.$eval('#gm-root', (r) => r.getAttribute('data-panel')) === 'npc' && await p.$eval('#gm-npc', (e) => !e.closest('[hidden]') && !e.hidden), 'key N opens the NPC panel');
  check(!/coming/i.test(await text(p, '#gm-npc')), 'the "coming" note is gone');
  check(await p.$('#gm-npc [data-gm="npcroll"]') !== null, 'there is a Roll an NPC button');
  const castBefore = (await api('GET', '/npcs')).json.docs.length;

  await p.click('[data-gm="npcroll"]');
  check(await p.waitForSelector('#gm-npc .gm-npccard', { timeout: 15000 }).then(() => true, () => false), 'Roll an NPC draws a card');
  const first = await text(p, '#gm-npc .gm-npccard');
  const name1 = await text(p, '#gm-npc .gm-npccard h3');
  check(name1.length > 2, 'the card has a name: ' + name1);
  check(await p.$('#gm-npc .gm-npccard .gm-npcfig svg') !== null, 'the card has a portrait');
  check(!/nearest of the stock figures/.test(first), 'the portrait is the generated figure, not a stock fallback');
  check(await p.$('#gm-npc .gm-npccard .gm-want') !== null && await p.$('#gm-npc .gm-npccard .gm-read') !== null && (await p.$$('#gm-npc .gm-npccard .gm-grid')).length >= 1, 'the card has the look, the want and the play grid');
  await sleep(1200);
  let st = (await api('GET', '/gm/state')).json.doc;
  check(st.cards.npc && typeof st.cards.npc.seed === 'number' && typeof st.cards.npc.mem === 'string' && Object.keys(st.hist.npc).length === 1 && st.mem && st.mem.npc, 'server: the card, its history entry and the repeat-guard memory are stored');
  const wantText = (await text(p, '#gm-npc .gm-npccard .gm-want')).replace(/\*/g, '').slice(0, 24);
  check(wantText.length > 8 && !JSON.stringify(st).includes(wantText), 'server: no card text in the stored state (seed and memory only)');
  await shot(p, 'npc-desktop');

  // a second roll, then reload: the same NPC; Earlier brings back the first
  await p.click('[data-gm="npcroll"]');
  await p.waitForFunction((n) => { const h = document.querySelector('#gm-npc .gm-npccard h3'); return h && h.textContent.replace(/\s+/g, ' ').trim() !== n; }, name1, { timeout: 15000 });
  const second = await text(p, '#gm-npc .gm-npccard');
  const svg2 = await p.$eval('#gm-npc .gm-npccard .gm-npcfig', (e) => e.innerHTML);
  await sleep(1200);
  await p.reload();
  await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  await p.keyboard.press('n');
  await p.waitForSelector('#gm-npc .gm-npccard', { timeout: 15000 });
  check(await text(p, '#gm-npc .gm-npccard') === second, 'reload: the same NPC');
  check(await p.$eval('#gm-npc .gm-npccard .gm-npcfig', (e) => e.innerHTML) === svg2, 'reload: the same portrait');
  await p.click('#gm-npc [data-gm="replay"]:not([aria-current])');
  await p.waitForFunction((n) => { const h = document.querySelector('#gm-npc .gm-npccard h3'); return h && h.textContent.replace(/\s+/g, ' ').trim() === n; }, name1, { timeout: 15000 });
  check(await text(p, '#gm-npc .gm-npccard') === first, 'Earlier: the first NPC is back, card for card');

  // Pin
  await p.click('#gm-npc [data-gm="pin"][data-tool="npc"]');
  check(await p.waitForFunction(() => /Pins\s*1\//.test(document.querySelector('#gm-rail').textContent), null, { timeout: 5000 }).then(() => true, () => false), 'Pin: the card is pinned in the rail');

  // Add to the cast
  check((await p.$eval('[data-gm="npcfile"]', (b) => b.disabled)) === false, 'Add to the cast is enabled');
  await p.click('[data-gm="npcfile"]');
  check(await p.waitForFunction(() => { const b = document.querySelector('[data-gm="npcfile"]'); return b && b.disabled && /In the cast/.test(b.textContent); }, null, { timeout: 10000 }).then(() => true, () => false), 'the button becomes "In the cast"');
  const docs = (await api('GET', '/npcs')).json.docs;
  const added = docs.filter((d) => d.doc && d.doc.name === name1.replace(/ — ".*"$/, '').trim() || (d.doc && name1.indexOf(d.doc.name) === 0 && Array.isArray(d.doc.tags) && d.doc.tags.includes('generated')));
  check(docs.length === castBefore + 1 && added.length === 1, 'server: one NPC added to the cast (' + castBefore + ' to ' + docs.length + ')');
  const a = added[0] && added[0].doc;
  check(!!a && a.revealed === false && a.tags.includes('generated') && a.spec && a.spec.id && /GM|How to play/.test(a.gmNotes || ''), 'the new NPC is hidden, tagged generated, has a figure spec and GM notes');
  await sleep(1200);
  st = (await api('GET', '/gm/state')).json.doc;
  const gid = Object.keys(st.npcgen || {})[0];
  check(!!gid && gid === (added[0] && added[0].id) && typeof st.npcgen[gid].seed === 'number' && st.npcgen[gid].s === 4, 'server: npcgen holds the seed under the NPC\'s id, with the session number');
  // the sync's replay: the same seed and memory over the pack rebuild the same NPC
  const gen = N.create({ T: np.parts.npc.T, cast: np.parts.npc.cast, F: np.parts.npc.F, campaign: np.parts.campaign });
  const rr = gen.roll({ seed: st.npcgen[gid].seed, mem: JSON.parse(st.npcgen[gid].mem) });
  check(!!a && rr.npc.name === a.name, 'outside the page: the stored seed and memory replay to ' + (a && a.name));
  check(await p.waitForFunction((n) => [].some.call(document.querySelectorAll('#gm-npc .gm-npcrow b'), (b) => b.textContent === n), a.name, { timeout: 8000 }).then(() => true, () => false), 'the cast list below shows them');
  check(/Hidden/.test(await text(p, '#gm-npc .gm-npcrow[data-id="' + added[0].id + '"]')), 'and marks them hidden from the players');
  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await G.c.close();

  // a phone
  const M = await open('#gm', { width: 390, height: 844, mobile: true });
  const mp = M.page;
  await mp.click('.gm-segbar [data-seg="npc"]');
  await mp.waitForSelector('#gm-npc [data-gm="npcroll"]', { state: 'visible', timeout: 5000 });
  await mp.click('[data-gm="npcroll"]');
  await mp.waitForSelector('#gm-npc .gm-npccard', { timeout: 15000 });
  const lay = await mp.evaluate(() => {
    const vw = window.innerWidth, wide = [], small = [];
    for (const el of document.querySelectorAll('#gm-page *')) { const r = el.getBoundingClientRect(); if (r.width && r.height && r.right > vw + 1) { let clipped = false; for (let q = el.parentElement; q && q !== document.body; q = q.parentElement) if (getComputedStyle(q).overflowX !== 'visible') { clipped = true; break; } if (!clipped && getComputedStyle(el).position !== 'fixed') wide.push(el.tagName + '.' + (el.className || '')); } }
    for (const el of document.querySelectorAll('#gm-page button, #gm-page select, #gm-page summary')) { const r = el.getBoundingClientRect(); if (r.width && r.height && r.height < 43.5) small.push((el.getAttribute('data-gm') || el.id || el.tagName) + ' ' + Math.round(r.height)); }
    return { vw, sw: document.documentElement.scrollWidth, wide: wide.slice(0, 5), small: small.slice(0, 6) };
  });
  check(lay.sw <= lay.vw + 1 && !lay.wide.length, 'phone: nothing wider than the screen (' + JSON.stringify({ sw: lay.sw, vw: lay.vw, wide: lay.wide }) + ')');
  check(!lay.small.length, 'phone: every visible control is 44 px or taller' + (lay.small.length ? ' (' + lay.small.join(', ') + ')' : ''));
  await shot(mp, 'phone-npc');
  check(errors.length === 0, 'no page errors on the phone' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
killServer();
process.exit(failed ? 1 : 0);
