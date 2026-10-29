// VV2 against a real `wrangler dev` (local D1, workerd): the campaign document's `mission` at FULL SIZE (every cap used: 8 cards of 8 leads and
// the rest) written and read back, the display GET's fourth part answered from real SQLite (json_extract, the CASE on the seq), a hidden NPC
// refused with 422 in the middle of 50-odd hidden names, a player refused, and the timings the ticket asks for. Invented names only.
//   node checks/api/mission-d1.mjs        (Windows: wrangler is started with a shell)
//
// Applies migrations/ to a throwaway local D1, then starts the Worker on PORT (default 8900, lane 1's range 8900-8949).
// The timings are wall time over loopback, one request at a time: they include the HTTP round trip and workerd's own work, and they are
// NOT Cloudflare's CPU meter (wrangler dev has none). The CPU that belongs to this ticket's code is measured in node, warm, on the same
// full-size mission: cleanMission + missionHit + the stringify the write does.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanMission, missionHit } from '../../functions/_lib/campaign.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8900);
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test', PLAYER = 'player@example.test';
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');
const OVERALL_TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS || 300000);
const stateDir = mkdtempSync(join(tmpdir(), 'b68-mission-check-'));
const persist = join(stateDir, 'state');
const envOf = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
let server = null, passes = 0, failures = 0;

function stop() {
  if (server) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} }
    server = null;
  }
  try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {}
}
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, { user, body } = {}) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let payload;
  if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch('http://127.0.0.1:' + PORT + path, { method, headers: h, body: payload });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, json, text };
}
async function step(name, fn) {
  try { await fn(); passes++; console.log('PASS ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }

// ---------- a full-size mission: every cap used, every string at its limit ----------
const word = (i, n) => { let s = ''; while (s.length < n) s += 'word' + i + ' bright '; s = s.slice(0, n); return s.endsWith(' ') ? s.slice(0, -1) + 'x' : s; };   // exactly n characters, never ending in a space
const many = (n, f) => Array.from({ length: n }, (_, i) => f(i));
function fullMission(seq) {
  return {
    v: 1, site: word(1, 160), t: 120, seq,
    hud: {
      time: '22:30', label: word(2, 160),
      now: many(3, (i) => ({ text: word(i, 160), where: word(i + 1, 160), until: '23:00' })),
      next: many(3, (i) => ({ text: word(i, 160), where: word(i + 1, 160), at: '00:00', inMin: 30 * i })),
      night: { beats: 16, start: 2, cur: 6, marks: many(24, (i) => ({ i, icon: 'spark', text: word(i, 160) })) },
      alarm: { name: 'Burn', size: 6, filled: 2, text: word(3, 160) },
      crew: many(8, (i) => ({ name: 'Crew ' + i, costume: word(i, 60), icon: 'mask', room: word(i, 100) })),
      target: { room: word(4, 160) }, ways: { found: 3, total: 7 },
    },
    cards: Object.fromEntries(many(8, (c) => ['char_' + c, {
      name: 'Card ' + c, owner: word(c, 160), costume: word(c, 160), icon: 'mask', room: word(c, 160), pos: 'safe',
      warn: { who: word(1, 160), look: word(2, 160), sees: word(3, 160) },
      zones: { controlled: many(12, (i) => word(i, 160)), risky: many(12, (i) => word(i + 3, 160)) },
      items: many(10, (i) => word(i, 160)),
      leads: many(8, (i) => ({ name: word(i, 160), line: word(i, 300), heard: word(i, 160), window: word(i, 160), next: word(i, 160), ...(i % 3 === 0 ? { done: true } : {}) })),
      know: many(16, (i) => word(i, 160)),
      next: many(4, (i) => ({ text: word(i, 160), where: word(i, 160), at: '00:15', inMin: 15 * i })),
      paths: many(6, (i) => ({ text: word(i, 160), until: '00:00' })),
      busy: '22:45',
    }])),
  };
}

const pct = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };
const fmt = (xs) => 'n=' + xs.length + ' p50 ' + pct(xs, 0.5).toFixed(1) + ' p99 ' + pct(xs, 0.99).toFixed(1) + ' max ' + Math.max(...xs).toFixed(1) + ' ms';

async function main() {
  const busy = await fetch('http://127.0.0.1:' + PORT + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
  if (busy) throw new Error('port ' + PORT + ' is already in use: stop what is on it, or set PORT');
  const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist],
    { cwd: ROOT, env: envOf, encoding: 'utf8', shell: process.platform === 'win32' });
  if (mig.status !== 0) throw new Error('migrations failed:\n' + mig.stdout + mig.stderr);
  server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
    '--persist-to', persist, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'DISPLAY_EMAILS:' + IPAD, '--var', 'CAMPAIGN:missioncheck'],
  { cwd: ROOT, env: envOf, detached: process.platform !== 'win32', stdio: 'ignore', shell: process.platform === 'win32' });
  let up = false;
  for (let i = 0; i < 180 && !up; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/index.html', { signal: AbortSignal.timeout(2000) }); up = r.status > 0; } catch (_) {} if (!up) await sleep(500); }
  if (!up) throw new Error('server did not start on ' + PORT);
  console.log('server up on ' + PORT);

  const names = [];
  await step('setup: 50 hidden NPCs (each with an alias) and 5 hidden clocks, so the name scan has a realistic list', async () => {
    for (let i = 0; i < 50; i++) {
      const r = await call('POST', '/api/npcs', { user: GM, body: { name: 'Hidden Person' + i + ' Zed', alias: 'Shade' + i + ' Quill', revealed: false } });
      expect(r.status === 200 || r.status === 201, 'npc ' + i + ': ' + r.status + r.text.slice(0, 120));
      names.push('Hidden Person' + i + ' Zed', 'Shade' + i + ' Quill');
    }
    const clocks = many(5, (i) => ({ id: 'hc' + i, name: 'Secret Burn' + i, size: 6, filled: 0, kind: 'danger', hidden: true }));
    const r = await call('PATCH', '/api/campaign', { user: GM, body: { clocks } });
    expect(r.status === 200, 'clocks ' + r.status + r.text.slice(0, 120));
    for (const c of clocks) names.push(c.name);
  });

  const full = fullMission(1);
  const fullBytes = JSON.stringify(full).length;
  await step('a full-size mission is written (' + fullBytes + ' bytes of body) and read back by a player exactly as cleanMission rebuilds it', async () => {
    const r = await call('PATCH', '/api/campaign', { user: GM, body: { mission: full } });
    expect(r.status === 200, 'PATCH ' + r.status + ' ' + r.text.slice(0, 200));
    const want = cleanMission(full);
    expect(JSON.stringify(want) === JSON.stringify(full), 'the fixture is already clean, so nothing is cut: the test is at full size');
    const g = await call('GET', '/api/campaign', { user: PLAYER });
    expect(JSON.stringify(g.json.doc.mission) === JSON.stringify(want), 'read back differs');
    expect(Object.keys(g.json.doc.mission.cards).length === 8 && g.json.doc.mission.cards.char_0.leads.length === 8, 'eight cards of eight leads');
  });

  await step('the fourth part on real D1: hud for a stale seq, unchanged for the current one, hud only, never a card', async () => {
    const q = 'seq=0&aseq=0&sseq=0&hseq=';
    const a = await call('GET', '/api/gm/display?' + q + '0', { user: IPAD });
    expect(a.status === 200 && a.json.mission.hseq === 1 && JSON.stringify(a.json.mission.hud) === JSON.stringify(full.hud), 'hud: ' + a.text.slice(0, 200));
    expect(!a.text.includes('char_0') && !/"cards"/.test(a.text) && !a.text.includes(full.cards.char_3.leads[2].line), 'no card in the answer');
    const b = await call('GET', '/api/gm/display?' + q + '1', { user: IPAD });
    expect(JSON.stringify(b.json.mission) === '{"hseq":1,"unchanged":true}', 'unchanged: ' + JSON.stringify(b.json.mission));
    expect(b.text.length < a.text.length, 'and the answer is smaller');
    const none = await call('GET', '/api/gm/display?seq=0&aseq=0&sseq=0', { user: IPAD });
    expect(!('mission' in none.json), 'no hseq, no part');
    const refused = await call('GET', '/api/campaign', { user: IPAD });
    expect(refused.status === 403, 'the iPad cannot read the campaign route');
  });

  await step('422 names a hidden NPC among 55 hidden names; a player is 403; neither changes the stored mission', async () => {
    const m = fullMission(2); m.cards.char_5.know[7] = 'They mention shade37 quill at the door';
    const r = await call('PATCH', '/api/campaign', { user: GM, body: { mission: m } });
    expect(r.status === 422 && r.json.error.includes('"Shade37 Quill"') && r.json.error.includes('mission.cards.char_5.know.7'), r.status + ' ' + r.text);
    const p = await call('PATCH', '/api/campaign', { user: PLAYER, body: { mission: fullMission(3) } });
    expect(p.status === 403, 'player ' + p.status);
    const d = await call('PATCH', '/api/campaign', { user: PLAYER, body: { mission: null } });
    expect(d.status === 403, 'player delete ' + d.status);
    const g = await call('GET', '/api/campaign', { user: PLAYER });
    expect(g.json.doc.mission.seq === 1, 'still seq 1');
  });

  await step('TIMING: the PATCH with a full-size mission, and the display GET with the fourth part (wall time over loopback, workerd, local D1)', async () => {
    const patch = [];
    for (let i = 0; i < 60; i++) {
      const m = fullMission(10 + i); m.hud.time = String(i);
      const t0 = performance.now();
      const r = await call('PATCH', '/api/campaign', { user: GM, body: { mission: m } });
      patch.push(performance.now() - t0);
      expect(r.status === 200, 'PATCH ' + i + ': ' + r.status + r.text.slice(0, 120));
    }
    const run = async (qs, n) => {
      const out = [];
      for (let i = 0; i < n; i++) { const t0 = performance.now(); const r = await call('GET', '/api/gm/display?' + qs, { user: IPAD }); out.push(performance.now() - t0); expect(r.status === 200, qs + ' ' + r.status); }
      return out;
    };
    const base = 'seq=0&aseq=0&sseq=0';
    await run(base, 20);   // warm
    const s = await run(base, 300);
    const same = await run(base + '&hseq=69', 300);     // the page is current: { hseq, unchanged }
    const stale = await run(base + '&hseq=1', 300);     // a change: the hud rides along
    // all three current, the form the iPad uses most: the display, ambient and transcriber seqs match, so the answer is the small one
    const cur = (await call('GET', '/api/gm/display?' + base, { user: IPAD })).json;
    const tight = 'seq=' + cur.seq + '&aseq=' + cur.ambient.seq + '&sseq=' + cur.stt.seq;
    const tightNo = await run(tight, 300), tightSame = await run(tight + '&hseq=69', 300);
    console.log('     PATCH, full mission, ' + fullBytes + ' bytes, 50 + 5 hidden names: ' + fmt(patch));
    console.log('     display GET, all current, without hseq:    ' + fmt(tightNo));
    console.log('     display GET, all current, hseq current:    ' + fmt(tightSame));
    console.log('     display GET, stale parts, without hseq:    ' + fmt(s));
    console.log('     display GET, stale parts, hseq current:    ' + fmt(same));
    console.log('     display GET, stale parts, hseq stale (hud): ' + fmt(stale));
  });

  await step('CPU: cleanMission + missionHit (55 hidden names) + the stringify the write does, node, warm, on the same full-size mission', async () => {
    const m = fullMission(1);
    for (let i = 0; i < 100; i++) { const c = cleanMission(m); missionHit(c, names); JSON.stringify(c); }    // warm up the JIT as a long-lived isolate would be
    const xs = [];
    for (let i = 0; i < 400; i++) {
      const t0 = performance.now();
      const c = cleanMission(m); const hit = missionHit(c, names); const text = JSON.stringify(c);
      xs.push(performance.now() - t0);
      if (hit || !text) throw new Error('unexpected hit');
    }
    console.log('     cleanMission + missionHit + stringify: ' + fmt(xs));
    // the whole route's JS work on that write, as the handler does it: parse the body, scan, read the stored row (a parse of the whole document), merge, stringify, byte-count
    const body = JSON.stringify({ mission: m }), enc = new TextEncoder(), ys = [];
    for (let i = 0; i < 500; i++) {
      const t0 = performance.now();
      const b = JSON.parse(body); const c = cleanMission(b.mission); const hit = missionHit(c, names);
      const stored = JSON.parse(body);                      // the campaign row as writeCampaign reads it
      const next = { ...stored, mission: c, updatedAt: 'x' }; const text = JSON.stringify(next); const bytes = enc.encode(text).byteLength;
      ys.push(performance.now() - t0);
      if (hit || bytes < 1000) throw new Error('unexpected');
    }
    console.log('     whole write path (2 parses, clean, scan, stringify, encode): ' + fmt(ys.slice(100)));
    // cold, once: the first call in a fresh isolate (regexes unbuilt, code uncompiled)
    expect(pct(xs, 0.5) < 5, 'p50 over the 5 ms this should stay well inside: ' + pct(xs, 0.5));
  });
}

const timer = setTimeout(() => { console.log('FAIL overall timeout after ' + OVERALL_TIMEOUT_MS + ' ms'); stop(); process.exit(1); }, OVERALL_TIMEOUT_MS);
try {
  await main();
} catch (e) {
  failures++;
  console.log('FAIL setup\n     ' + (e && e.message || e));
}
clearTimeout(timer);
console.log('\n' + passes + ' passed, ' + failures + ' failed');
stop();
process.exit(failures ? 1 : 0);
