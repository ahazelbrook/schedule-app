// kit-off (KS04.2 of the kit and stage build): with all five settings off, the pages are today's. The demo night runs every scenario with the five settings written
// OFF (scripts/demo-night.mjs --kit none, the same as absent), each page is fingerprinted (scripts/kit-fingerprint.mjs), and the fingerprints are held to the day-0
// baseline taken from commit 798907c (scripts/kit-baseline.mjs; b68-wt\_kit-shots\baseline): every element's id and classes exact, its box within 1 px, its
// computed styles equal. The requests the GM page, the display and a phone make are held to the baseline's too: any request the baseline did not make fails, except
// app/ui/kit-flag.js (the one deliberate new request, the Gate 0 ruling).
// Exemptions (KS04.2) are a short named list, EXEMPTIONS in scripts/kit-fingerprint.mjs, each with its reason and each printed here: the five new Settings rows
// (#gm-ipad-settings [data-set-row="kit.desk"|"kit.stage"|"kit.phone"|"night.who"|"blade.pitches"], and the layout they push down), the Settings intro line
// (app/gm/settings.js:139, reworded by KS01.1), and the Preflight line that counts the files kept ("N of M kept": kit-flag.js made 107 bundles into 108). A later
// disclosed exception (KS12's score-scene polaroids) is one more line there. Masks (time or chance decides them; their box and styles are skipped): see MASKS in the helper.
// It also checks its own comparison on a copy of a baseline file (one button moved 3 px must be one difference; one element gone must be one difference).
// And the mid-game off path (Gate 1 addition): on a running page, with no reload, each of the five settings is turned ON and then OFF again from the Settings rows
// (and then all five together), and the page's layout fingerprint and its data-kit attributes are held to the same page's all-off fingerprint taken before. After KS01.5
// the old sheets stay layered until a reload (the same look), so it compares fingerprints, never the loaded sheet elements; with the stubs it has nothing to differ on.
// The same page, reloaded, must carry the same data-kit attributes (its layout is not compared: a reload opens where the page last was). It runs on PORT + 1.
// The pages run at a fixed time of day (20:00), the harness's own clock: the prep note's 19:30 start and 22:40 curfew would otherwise change the band by the hour.
// With no baseline folder it skips with a line saying so (exit 0). The scenarios are the same list the baseline ran, in the same order: a later bundle adds its own
// to the END of scripts/demo-night-shots.mjs's list only, or the state every later scenario inherits would differ.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9400] [KIT_BASELINE=<dir>] [KIT_OFF_ONLY=gm-,band-] [KIT_OFF_MID_ONLY=1] [KIT_OFF_KEEP=<dir: keep this run's fingerprints to compare again without a run: node scripts/kit-baseline.mjs --compare <baseline> <dir>>] node checks/runtime/kit-off.e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { compare, compareFolders, runShots, startDemo, fingerprint, MASKS, MASK_KEYS, EXEMPTIONS, KIT_SETTING_KEYS } from '../../scripts/kit-fingerprint.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9400);
const BASELINE = path.resolve(process.env.KIT_BASELINE || path.join(ROOT, '..', '_kit-shots', 'baseline'));
const ONLY = (process.env.KIT_OFF_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
let failed = 0;
const check = (ok, name) => { if (ok) console.log('PASS ' + name); else { failed++; console.log('FAIL ' + name); } };

const hasBaseline = fs.existsSync(BASELINE) && fs.readdirSync(BASELINE).some((f) => /\.json$/.test(f) && f !== 'baseline-meta.json');
if (!hasBaseline) { console.log('SKIP kit-off: no baseline folder at ' + BASELINE + ' (take it with node scripts/kit-baseline.mjs; it is kept outside the repo)'); process.exit(0); }
if (!process.env.PW_MODULE) { console.log('SKIP kit-off: PW_MODULE is not set (the demo night needs Playwright)'); process.exit(0); }

/* 1. the comparison itself, on a copy of one baseline file */
{
  const f = fs.readdirSync(BASELINE).find((x) => /^gm-run-1366\.json$/.test(x)) || fs.readdirSync(BASELINE).find((x) => /^gm-.*\.json$/.test(x));
  const base = JSON.parse(fs.readFileSync(path.join(BASELINE, f), 'utf8'));
  const same = compare(base, JSON.parse(JSON.stringify(base)));
  check(same.diffs.length === 0, 'the comparison: a fingerprint equals itself (' + f + ', ' + base.els.length + ' elements)');
  const i = base.els.findIndex((e) => e[1] === 'button' && e[6] > 10 && !(e[9] || '').includes('m') && !(e[9] || '').includes('x'));
  const moved = JSON.parse(JSON.stringify(base)); moved.els[i][4] += 3;
  const r1 = compare(base, moved);
  check(r1.diffs.length === 1 && r1.diffs[0].kind === 'box', 'the comparison: one button moved 3 px is one difference (' + r1.diffs.length + ')');
  const nudged = JSON.parse(JSON.stringify(base)); nudged.els[i][4] += 1; nudged.els[i][7] += 0.5;
  check(compare(base, nudged).diffs.length === 0, 'the comparison: a button within 1 px is the same');
  const gone = JSON.parse(JSON.stringify(base)); const removed = gone.els.splice(i, 1)[0];
  const r2 = compare(base, gone);
  check(r2.diffs.some((d) => d.kind === 'missing' && d.key === removed[0]), 'the comparison: a button taken away is a difference');
  const BS = String.fromCharCode(92), esc = [...removed[0]].map((ch) => ('.*+?^$[](){}|' + BS + '/').includes(ch) ? BS + ch : ch).join('');
  const r3 = compare(base, gone, { exemptions: [{ name: 'a test exemption', reason: 'the self-test', keys: esc + '$' }] });
  check(r3.diffs.length === 0 && r3.exempted.some((n) => n.startsWith('a test exemption: gone')), 'the comparison: a named exemption by key pattern lets that element be gone, and says so');
  const reclassed = JSON.parse(JSON.stringify(base)); reclassed.els[i][0] += 'x'; reclassed.els[i][3] += ' extra';
  check(compare(base, reclassed).diffs.length === 2, 'the comparison: a changed class is a missing element and an extra one');
}

/* 2. the run: every scenario, the five settings written off */
const meta = fs.existsSync(path.join(BASELINE, 'baseline-meta.json')) ? JSON.parse(fs.readFileSync(path.join(BASELINE, 'baseline-meta.json'), 'utf8')) : null;
if (meta) console.log('baseline: commit ' + String(meta.commit).slice(0, 7) + ', taken ' + meta.capturedAt + '; both runs live at 20:00 (the harness clock, scripts/kit-fingerprint.mjs), so the time of day does not matter');
const KEEP = process.env.KIT_OFF_KEEP ? path.resolve(process.env.KIT_OFF_KEEP) : '';
const dir = KEEP || fs.mkdtempSync(path.join(os.tmpdir(), 'b68-kit-off-'));
if (KEEP) fs.mkdirSync(KEEP, { recursive: true });
const t0 = Date.now();
const MID_ONLY = process.env.KIT_OFF_MID_ONLY === '1';      /* just the on-and-off case (about a minute): for a builder working on it */
const run = MID_ONLY ? { status: 0, out: '' } : await runShots(ROOT, PORT, dir, ['--fingerprint', '--kit', 'none'].concat(ONLY.length ? ['--only', ONLY.join(',')] : []));
console.log('the demo night ran ' + Math.round((Date.now() - t0) / 1000) + ' s, exit ' + run.status);
check(run.status === 0, 'the demo night ran to the end');
const shotLines = run.out.split('\n').filter((l) => /^(FAILED|shot .*page errors)/.test(l));
for (const l of shotLines.slice(0, 10)) console.log('  ' + l);
check(!run.out.split('\n').some((l) => /^FAILED/.test(l)), 'every scenario ran (none FAILED)');

/* 3. the fingerprints and the requests against the baseline */
const r = MID_ONLY ? { compared: 1, absent: [], diffs: [], exempted: [], requests: {} } : await compareFolders(BASELINE, dir, { only: ONLY.length ? ONLY : null });
console.log(r.compared + ' fingerprints compared with the baseline; ' + r.absent.length + ' not taken this run');
check(r.compared > 0, 'fingerprints were compared (' + r.compared + ')');
check(r.absent.length === 0, 'every scenario of the baseline was run' + (r.absent.length ? ': ' + r.absent.slice(0, 5).join(', ') : ''));
console.log('exemptions (each named, with its reason; add one in EXEMPTIONS in scripts/kit-fingerprint.mjs):');
for (const x of EXEMPTIONS) {
  const mine = r.exempted.filter((e) => e.note.startsWith(x.name + ': ')), files = new Set(mine.map((e) => e.file));
  console.log('  ' + x.name + ' (' + x.reason + '): ' + (mine.length ? mine.length + ' element(s) in ' + files.size + ' file(s), e.g. ' + mine[0].file + ' ' + mine[0].note.slice(x.name.length + 2) : 'not needed this run'));
}
const other = new Map(); for (const e of r.exempted) if (!EXEMPTIONS.some((x) => e.note.startsWith(x.name + ': '))) { if (!other.has(e.note)) other.set(e.note, []); other.get(e.note).push(e.file); }
for (const [note, files] of other) console.log('  allowance: ' + note + ' (' + files.length + ' file(s), e.g. ' + files[0] + ')');
console.log('masked (not compared for box or style): ' + MASKS.concat(MASK_KEYS.map((k) => 'key ~ ' + k)).join(', '));
for (const d of r.diffs.slice(0, 20)) console.log('  DIFF ' + d.file + '  ' + d.kind + '  ' + d.key.split('/').slice(-3).join('/') + '  ' + d.detail);
if (r.diffs.length > 20) console.log('  ... and ' + (r.diffs.length - 20) + ' more');
check(r.diffs.length === 0, 'off means today: no element differs from the baseline in id, classes, box or style (' + r.diffs.length + ' differences)');
for (const [screen, q] of Object.entries(r.requests)) {
  if (q.allowed.length) console.log('  allowed new request (' + screen + '): ' + q.allowed.join(', '));
  for (const u of q.extra) console.log('  NEW REQUEST (' + screen + ') ' + u);
  if (q.missing.length) console.log('  note: ' + q.missing.length + ' request(s) of the baseline were not made on ' + screen + ' this time (timing; not a failure): ' + q.missing.slice(0, 3).join(', '));
  check(q.extra.length === 0, 'requests on the ' + screen + ' screen: nothing the baseline did not make, bar kit-flag.js');
}
if (!KEEP) fs.rmSync(dir, { recursive: true, force: true });

/* 4. on and off again without a reload */
{
  const { chromium } = require(process.env.PW_MODULE);
  const demo = await startDemo(ROOT, PORT + 1, ['--kit', 'none']);
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  try {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': 'gm@example.test' }, viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
    await c.addInitScript(() => { window.__B68_POLL_MS = 1000; });
    const page = await c.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const ready = async () => {
      await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
      await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
      await page.waitForFunction(() => window.B68GmPage && window.B68GmPage._places && window.B68GmPage._places(), null, { timeout: 20000 });
      await page.evaluate(() => window.B68GmPage.goPlace('score'));
      await page.click('.gm-tray [data-tray="open"]');
      await page.waitForSelector('#gm-ipad-settings [data-set-row]', { timeout: 10000 });
      await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
      await page.waitForTimeout(1200);
    };
    const kitAttrs = () => page.evaluate(() => [...document.querySelectorAll('[data-kit]')].map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '=' + e.getAttribute('data-kit')).concat(['html=' + document.documentElement.getAttribute('data-kit'), 'body=' + document.body.getAttribute('data-kit')]).sort());
    const set = async (id, on) => {
      const sel = '#gm-ipad-settings button[data-set="' + id + '"][data-v="' + (on ? '1' : '0') + '"]';
      await page.waitForSelector(sel, { timeout: 8000 });
      await page.click(sel);
      await page.waitForSelector(sel + '[aria-pressed="true"]', { timeout: 8000 });
      await page.waitForTimeout(900);
    };
    const toastsGone = () => page.waitForFunction(() => !['toastMsg', 'toastErr'].some((i) => { const e = document.getElementById(i); return e && e.textContent.trim(); }), null, { timeout: 9000 }).catch(() => {});
    await page.goto(demo.base + '/#gm'); await ready();
    const shoot = async (name) => { await toastsGone(); await page.evaluate(() => { window.scrollTo(0, 0); document.querySelectorAll('*').forEach((e) => { if (e.scrollTop) e.scrollTop = 0; if (e.scrollLeft) e.scrollLeft = 0; }); }); await page.mouse.move(1, 766); await page.waitForTimeout(400); return fingerprint(page, name, 1366); };
    await page.waitForTimeout(9000);        /* the players' presence (the Run view's chip) arrives with the polls: let it settle before the all-off picture */
    const A0 = await shoot('all-off'), attrsA = await kitAttrs();
    console.log('mid-game: the page with all five off has ' + A0.els.length + ' elements, data-kit: ' + (attrsA.filter((x) => !/=null$/.test(x)).join(', ') || 'none'));
    const rounds = KIT_SETTING_KEYS.map((k) => [k]).concat([KIT_SETTING_KEYS]);
    for (const ids of rounds) {
      const A = await shoot('before-' + ids.join('+'));        /* each round is held to the picture taken just before it: live data (who is here) may change between rounds, not because of a setting */
      for (const id of ids) await set(id, true);
      const mid = await kitAttrs();
      for (const id of ids) await set(id, false);
      const B = await shoot('after-' + ids.join('+')), attrsB = await kitAttrs();
      const r = compare(A, B, { tol: 1 });
      for (const d of r.diffs.slice(0, 20)) console.log('  DIFF ' + d.kind + '  ' + d.key.split('/').slice(-3).join('/') + '  ' + d.detail);
      check(r.diffs.length === 0, 'mid-game off, no reload: ' + ids.join(' + ') + ' on, then off: the layout fingerprint is the all-off one (' + r.diffs.length + ' differences)');
      check(JSON.stringify(attrsA) === JSON.stringify(attrsB), 'mid-game off, no reload: ' + ids.join(' + ') + ': the data-kit attributes are the all-off ones' + (JSON.stringify(attrsA) === JSON.stringify(attrsB) ? '' : ' (' + attrsB.join(', ') + ')'));
      void mid;
    }
    await page.reload(); await ready();
    check(JSON.stringify(await kitAttrs()) === JSON.stringify(attrsA), 'mid-game off: and the same data-kit attributes after the reload');
    check(!errors.length, 'mid-game off: no page error' + (errors.length ? ': ' + errors[0] : ''));
    await c.close();
  } catch (e) { check(false, 'mid-game off ran: ' + String(e && e.stack || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }
  finally { await browser.close().catch(() => {}); await demo.stop(); }
}
console.log(failed ? 'FAIL kit-off: ' + failed + ' check(s)' : 'PASS kit-off');
process.exit(failed ? 1 : 0);
