#!/usr/bin/env node
// 4.6 (switch room.light): the light relay, a small local relay on the GM laptop. The browser cannot reach lights on the network, and a page
// asking a local address sends a private-network preflight first: this answers it. It ships with a SIMULATOR driver only (no hardware, no
// network beyond this machine); a real driver comes once the hardware is named [TODO: which lights you have, if any].
//   node tools/light-relay.mjs [--port 9300]
//   B68_LIGHT_ORIGINS=https://gm.example.test,...   extra page origins allowed (localhost and 127.0.0.1 are allowed on ports 8787,8788, or B68_LIGHT_PORTS)
// POST /light  { channel: 'strip', rgb: [r,g,b] }  |  { channel: 'rim', alarm: true }      GET /state
// The limits are enforced HERE on whatever arrives (app/gm/light.js holds them): the alarm is the rim only, 3 s at most, the rim never changes faster
// than every 250 ms (2 Hz at most), one alarm at a time, and any other channel, the work light included, is refused. The driver has no work-light method at all.
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const L = createRequire(import.meta.url)('../app/gm/light.js');

/* the simulator: records what a real driver would be told. strip(rgb), rim(on), state() */
export function simulator(now = Date.now) {
  const s = { strip: [0, 0, 0], rim: false, log: [] };
  return {
    strip(rgb) { s.strip = rgb.slice(); s.log.push({ at: now(), ch: 'strip', v: rgb.slice() }); },
    rim(on) { s.rim = !!on; s.log.push({ at: now(), ch: 'rim', v: !!on }); },
    state() { return { strip: s.strip.slice(), rim: s.rim, log: s.log.slice() }; }
  };
}

/* the guard between a command and the driver: the rim is only ever changed through here */
export function createGuard({ driver, now = Date.now, schedule = (fn, ms) => setTimeout(fn, ms) }) {
  let alarmUntil = 0, lastRim = -Infinity;
  function rim(on) {                        /* never faster than STEP_MS between two changes; a change that comes sooner is dropped */
    const t = now(); if (t - lastRim < L.LIMITS.GUARD_MS) return false;
    lastRim = t; driver.rim(on); return true;
  }
  return {
    apply(raw) {
      const v = L.check(raw); if (!v.ok) return { ok: false, status: 400, why: v.why };
      const c = v.cmd;
      if (c.channel === 'strip') { driver.strip(c.rgb); return { ok: true }; }
      if (now() < alarmUntil) return { ok: false, status: 409, why: 'an alarm is already running' };
      alarmUntil = now() + c.durationMs;
      const steps = L.alarmSteps(c.durationMs, c.stepMs);
      steps.forEach((st) => { if (st.at === 0) rim(st.on); else schedule(() => { rim(st.on); }, st.at); });
      /* belt and braces: whatever happened to the steps, the rim is dark when the window closes */
      schedule(() => { lastRim = -Infinity; driver.rim(false); }, c.durationMs + L.LIMITS.STEP_MS);
      return { ok: true, steps: steps.length };
    }
  };
}

/* a local page counts only on wrangler dev's ports (B68_LIGHT_PORTS, comma list); the hosted GM page's origin comes from B68_LIGHT_ORIGINS */
const LOCAL_PORTS = String(process.env.B68_LIGHT_PORTS || '8787,8788').split(',').map((s) => s.trim());
function originOk(origin, extra) {
  if (!origin) return true;                 /* not a browser page (curl, the tests' raw client) */
  try { const u = new URL(origin); if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && LOCAL_PORTS.includes(u.port)) return true; } catch { return false; }
  return extra.includes(origin);
}

export function createRelay({ driver = simulator(), guard, extraOrigins = String(process.env.B68_LIGHT_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean), ...gopts } = {}) {
  const g = guard || createGuard({ driver, ...gopts });
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin || '';
    const cors = origin && originOk(origin, extraOrigins) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {};
    const send = (code, body, extra = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...cors, ...extra }); res.end(JSON.stringify(body)); };
    if (!originOk(origin, extraOrigins)) return send(403, { error: 'origin not allowed' });
    if (req.method === 'OPTIONS') {         /* the preflight, including the private-network one */
      return send(204, {}, { 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'content-type',
        ...(req.headers['access-control-request-private-network'] === 'true' ? { 'access-control-allow-private-network': 'true' } : {}), 'access-control-max-age': '600' });
    }
    if (req.method === 'GET' && req.url === '/state') { const st = driver.state ? driver.state() : {}; return send(200, { strip: st.strip, rim: st.rim }); }
    if (req.method === 'POST' && req.url === '/light') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 2048) req.destroy(); });
      req.on('end', () => {
        let raw; try { raw = JSON.parse(body); } catch { return send(400, { error: 'bad json' }); }
        const r = g.apply(raw); send(r.ok ? 200 : r.status, r.ok ? { ok: true } : { error: r.why });
      });
      return;
    }
    send(404, { error: 'not found' });
  });
  return { server, driver, guard: g };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--port'), port = i > 0 ? +process.argv[i + 1] : 9300;
  const { server } = createRelay();
  server.listen(port, '127.0.0.1', () => console.log('Light relay (simulator) on http://127.0.0.1:' + port));
}
