// The WebKit pass (F4): runs the app/checks suites and the display checks through a real WebKit build and, for comparison, through
// Edge with the same device profile, then prints a table of what fails where. It finds problems; it fixes none.
//   node checks/webkit-pass.mjs                       every suite, plain, ipad, iphone; WebKit and Edge
//   node checks/webkit-pass.mjs --device=ipad         one device profile
//   node checks/webkit-pass.mjs --only=dice,table     suites whose file name contains one of these words
//   node checks/webkit-pass.mjs --engine=webkit       skip the Edge comparison
// Needs: playwright-core (PW_CORE_DIR, else <TEMP>/lint/node_modules/playwright-core), WebKit installed for it
// (npx playwright-core install webkit), and the Edge channel for the comparison. Results go to webkit-results.json beside this file's out dir.
// The display checks start their own wrangler dev on 9150 and 9151; a leaked one on those ports is killed by the script that owns it.
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRAP = path.join(ROOT, 'app', 'checks', 'pw-webkit.js');
const arg = (k) => (process.argv.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1] || '';
const devices = arg('device') ? [arg('device')] : ['none', 'ipad', 'iphone'];
const engines = arg('engine') ? [arg('engine')] : ['webkit', 'chromium'];
const only = arg('only') ? arg('only').split(',') : null;

const SUITES = [
  ...['e2e', 'pn-e2e', 'trackercheck', 'ms3', 'mu2', 'trackerpn', 'printcheck', 'dice', 'session', 'table', 'campaign', 'crewsheet', 'schedule', 'season', 'kitlazy']
    .map((n) => ({ name: 'app/checks/' + n + '.js', file: n + '.js', cwd: path.join(ROOT, 'app', 'checks') })),
  { name: 'checks/runtime/display-webkit.e2e.mjs', file: 'display-webkit.e2e.mjs', cwd: ROOT, rel: 'checks/runtime/display-webkit.e2e.mjs', port: 9150 },
  { name: 'checks/runtime/display-band.e2e.mjs', file: 'display-band.e2e.mjs', cwd: ROOT, rel: 'checks/runtime/display-band.e2e.mjs', port: 9151 },
  /* the phone sheet's Now card, Quiet button and Between fold (N6): iPhone Safari is the phones' real browser */
  { name: 'checks/runtime/sheet-now.e2e.mjs', file: 'sheet-now.e2e.mjs', cwd: ROOT, rel: 'checks/runtime/sheet-now.e2e.mjs', port: 9170 },
];

const rows = [];
for (const s of SUITES) {
  if (only && !only.some((w) => s.file.includes(w))) continue;
  for (const device of devices) for (const engine of engines) {
    const env = { ...process.env, PW_MODULE: WRAP, PW_DEVICE: device === 'none' ? '' : device, PW_ENGINE: engine === 'chromium' ? 'chromium' : '' };
    delete env.PW_CHANNEL; delete env.ANTHROPIC_API_KEY;
    if (s.port) env.PORT = String(s.port);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [s.rel ? path.join(ROOT, s.rel) : s.file], { cwd: s.cwd, env, encoding: 'utf8', timeout: 12 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
    const out = (r.stdout || '') + '\n' + (r.stderr || '');
    const lines = out.split(/\r?\n/);
    const fails = lines.filter((l) => /^(FAIL|FAILED|✗|not ok)|pageerror|Error:|Executable doesn't exist/i.test(l.trim())).map((l) => l.trim().slice(0, 300));
    const row = { suite: s.name, device, engine, status: r.status, timedOut: !!(r.error && r.error.code === 'ETIMEDOUT'), secs: Math.round((Date.now() - t0) / 1000), fails: fails.slice(0, 12), nFails: fails.length, tail: lines.filter(Boolean).slice(-3).map((l) => l.slice(0, 200)) };
    rows.push(row);
    console.log([row.suite, device, engine, row.timedOut ? 'TIMEOUT' : row.status === 0 && !fails.length ? 'ok' : 'FAIL(' + row.status + ', ' + row.nFails + ' lines)', row.secs + 's'].join(' | '));
  }
}
mkdirSync(path.join(ROOT, 'app', 'checks', 'out'), { recursive: true });
writeFileSync(path.join(ROOT, 'app', 'checks', 'out', 'webkit-results.json'), JSON.stringify(rows, null, 1));
console.log('wrote app/checks/out/webkit-results.json');
