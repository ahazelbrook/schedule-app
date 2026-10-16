// The deploy script's safety nets (scripts/deploy.sh; SETUP.md "Updating the app"), run for real in a throwaway git
// copy of this checkout, so nothing here is touched and nothing reaches Cloudflare:
//   - a working tree with uncommitted changes is refused before the sign-in (B68_DIRTY_OK=1 lets it through)
//   - a checkout without app/media/theme.mp3 or app/ambient/calling-cards.html is refused (B68_MEDIA_OK=1)
//   - a dry run stamps the build into app/routes.js, proves the Worker bundle carries it, prints the receipt and puts
//     'dev' back; a stamp left by a killed run is put back first; Ctrl-C in the middle puts it back too
// Needs sh and git (Git Bash on Windows); skipped without them.
//   node checks/api/deploy.mjs
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let passes = 0, failures = 0;
async function step(name, fn) {
  try { await fn(); passes++; console.log('PASS ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
const has = (cmd) => spawnSync('sh', ['-c', 'command -v ' + cmd], { stdio: 'ignore' }).status === 0;   // no sh: false too

if (process.platform === 'win32' || !has('git')) {
  console.log('SKIP the deploy script check needs sh and git on a POSIX system (Git Bash on Windows runs the script itself)');
  console.log('\n0 passed, 0 failed (skipped)');
  process.exit(0);
}

// the copy: every file git knows of here (tracked, or new and not ignored), committed in a fresh repository
const BOX = mkdtempSync(join(tmpdir(), 'b68-deploy-check-'));
process.on('exit', () => { try { rmSync(BOX, { recursive: true, force: true }); } catch (_) {} });
const files = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
for (const f of files) { if (!existsSync(join(ROOT, f))) continue; mkdirSync(dirname(join(BOX, f)), { recursive: true }); copyFileSync(join(ROOT, f), join(BOX, f)); }
symlinkSync(join(ROOT, 'node_modules'), join(BOX, 'node_modules'));
const git = (...a) => spawnSync('git', ['-c', 'user.email=check@example.test', '-c', 'user.name=check', ...a], { cwd: BOX, encoding: 'utf8' });
git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'the checkout');
const COMMIT = git('rev-parse', '--short=7', 'HEAD').stdout.trim();
const ROUTES = join(BOX, 'app', 'routes.js');
const buildLine = () => (readFileSync(ROUTES, 'utf8').match(/^\s*var BUILD = '([^']*)';/m) || [])[1];
const clean = () => git('status', '--porcelain').stdout.trim() === '';

// the script as `npm run deploy` runs it; HOME and the wrangler config point into the box so no sign-in is found
const ENV = { ...process.env, B68_GM_EMAILS: 'gm@example.test', B68_PLAYER_EMAILS: 'p@example.test', HOME: BOX, XDG_CONFIG_HOME: join(BOX, '.config'),
  CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '', WRANGLER_SEND_METRICS: 'false', CI: '1' };
for (const k of ['B68_DRY_RUN', 'B68_DIRTY_OK', 'B68_MEDIA_OK', 'B68_ACCESS_TEAM', 'B68_ACCESS_AUD']) delete ENV[k];
function deploy(extra = {}, { onOutput } = {}) {
  return new Promise((done) => {
    const p = spawn('sh', ['scripts/deploy.sh'], { cwd: BOX, env: { ...ENV, ...extra }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const take = (d) => { out += d; if (onOutput) onOutput(out, p); };
    p.stdout.on('data', take); p.stderr.on('data', take);
    const t = setTimeout(() => { try { process.kill(-p.pid, 'SIGKILL'); } catch (_) {} }, 240000);
    p.on('close', (code, signal) => { clearTimeout(t); done({ code, signal, out }); });
  });
}

await step('uncommitted changes: refused before the sign-in, with the files named and the way through', async () => {
  appendFileSync(join(BOX, 'app', 'boot.js'), '\n// a half-finished edit\n');
  writeFileSync(join(BOX, 'app', 'stray.js'), '// new, not committed, would ship\n');
  const r = await deploy();
  expect(r.code === 1, 'exit ' + r.code + '\n' + r.out);
  expect(/uncommitted changes/.test(r.out) && /M app\/boot\.js/.test(r.out) && /\?\? app\/stray\.js/.test(r.out) && /B68_DIRTY_OK=1/.test(r.out), r.out);
  expect(!/Signing in to Cloudflare/.test(r.out), 'it went on to the sign-in');
  expect(buildLine() === 'dev', 'routes.js touched: ' + buildLine());
  git('checkout', '-q', '--', 'app/boot.js'); rmSync(join(BOX, 'app', 'stray.js'));
  expect(clean(), 'the box is clean again');
});

await step('B68_DIRTY_OK=1 lets uncommitted changes through (said loudly); missing theme / calling cards: refused, B68_MEDIA_OK named', async () => {
  appendFileSync(join(BOX, 'app', 'boot.js'), '\n// a half-finished edit\n');
  const r = await deploy({ B68_DIRTY_OK: '1' });
  expect(r.code === 1, 'exit ' + r.code + '\n' + r.out);
  expect(/deploying them anyway \(B68_DIRTY_OK=1\)/.test(r.out), 'the override is said: ' + r.out);
  expect(/Missing on this disk[^\n]*app\/media\/theme\.mp3 app\/ambient\/calling-cards\.html/.test(r.out) && /REMOVE them from the live site/.test(r.out) && /B68_MEDIA_OK=1/.test(r.out), r.out);
  expect(!/Signing in to Cloudflare/.test(r.out), 'it went on to the sign-in');
  git('checkout', '-q', '--', 'app/boot.js');
});

// the two files are gitignored: in place, they leave the tree clean
mkdirSync(join(BOX, 'app', 'media'), { recursive: true });
writeFileSync(join(BOX, 'app', 'media', 'theme.mp3'), 'not really audio');
writeFileSync(join(BOX, 'app', 'ambient', 'calling-cards.html'), '<!doctype html><title>cards</title>');

await step('a dry run on a clean tree: the build <date>-<commit> is stamped, the Worker bundle carries it, the receipt is printed, and routes.js is back to dev', async () => {
  expect(clean(), 'the media files count as changes: ' + git('status', '--porcelain').stdout);
  const r = await deploy({ B68_DRY_RUN: '1' });
  const build = new Date().toISOString().slice(0, 10) + '-' + COMMIT;
  expect(r.code === 0, 'exit ' + r.code + '\n' + r.out.slice(-3000));
  expect(r.out.includes('commit:   ' + COMMIT + ' (clean)'), 'commit line: ' + r.out);
  expect(r.out.includes('the Worker bundle carries build ' + build), 'the bundle: ' + r.out.slice(-3000));
  const receipt = r.out.slice(r.out.indexOf('== Receipt'));
  for (const want of ['commit       ' + COMMIT + ' (working tree clean)', 'build        ' + build, 'migrations   ', 'secrets      not listed (dry run)',
    'files        app/media/theme.mp3 deployed, app/ambient/calling-cards.html deployed', 'sw cache     b68-shell-' + build, 'smoke test   not run (dry run)']) {
    expect(receipt.includes(want), 'receipt lacks "' + want + '":\n' + receipt);
  }
  expect(buildLine() === 'dev' && clean(), 'routes.js back to dev and the tree clean: ' + buildLine());
});

await step('a stamp left by a killed run is put back before anything else', async () => {
  writeFileSync(ROUTES, readFileSync(ROUTES, 'utf8').replace(/^(\s*var BUILD = )'dev';/m, "$1'2026-01-01-deadbee';"));
  const r = await deploy({ B68_DRY_RUN: '1' });
  expect(r.code === 0 && /earlier deploy \(2026-01-01-deadbee\): putting 'dev' back/.test(r.out), 'exit ' + r.code + ': ' + r.out.slice(0, 1500));
  expect(buildLine() === 'dev' && clean(), 'routes.js: ' + buildLine());
});

await step('Ctrl-C while the stamped build is being bundled: routes.js is put back to dev', async () => {
  let sent = false;
  const r = await deploy({ B68_DRY_RUN: '1' }, {
    onOutput: (out, p) => { if (!sent && /^build: {4}/m.test(out) && buildLine() !== 'dev') { sent = true; try { process.kill(-p.pid, 'SIGINT'); } catch (_) {} } },
  });
  expect(sent, 'never saw the stamp: ' + r.out.slice(-1500));
  expect(r.code !== 0, 'the run was not interrupted (exit ' + r.code + ')');
  expect(buildLine() === 'dev' && clean(), 'routes.js after the interrupt: ' + buildLine());
});

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
