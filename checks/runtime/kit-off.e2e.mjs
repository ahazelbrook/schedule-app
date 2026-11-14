// kit-off (KS04.2 of the kit and stage build): with all five settings off, the pages are today's. The demo night runs every scenario with the five settings written
// OFF (scripts/demo-night.mjs --kit none, the same as absent), each page is fingerprinted (scripts/kit-fingerprint.mjs), and the fingerprints are held to the day-0
// baseline taken from commit 798907c (scripts/kit-baseline.mjs; b68-wt\_kit-shots\baseline): every element's id and classes exact, its box within 1 px, its
// computed styles equal. The requests the GM page, the display and a phone make are held to the baseline's too: any request the baseline did not make fails, except
// app/ui/kit-flag.js (the one deliberate new request, the Gate 0 ruling).
// Exemptions (KS04.2) are a short named list, EXEMPTIONS in scripts/kit-fingerprint.mjs, each with its reason and each printed here: the five new Settings rows
// (#gm-ipad-settings [data-set-row="kit.desk"|"kit.stage"|"kit.phone"|"night.who"|"blade.pitches"], and the layout they push down), the Settings intro line
// (app/gm/settings.js:139, reworded by KS01.1), and the Preflight line that counts the files kept ("N of M kept": kit-flag.js made 107 bundles into 108). A later
// disclosed exception is one more line there. Masks (time or chance decides them): MASKS and MASK_KEYS in the helper let go of box and style only, never of an
// element's existence, ids or classes; STATE_CLASSES, LIVE_SLOTS and LOOSE_AXES are the other named allowances, each printed. Section 1b mutates baseline files
// (the band tray, the players chip, the iPad line, a Tonight line, a Debrief card, the rows allowance) and every mutation must be caught. KIT_OFF_SELF_ONLY=1 runs
// sections 1 and 1b alone (seconds, no browser).
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
import { compare, compareFolders, runShots, startDemo, fingerprint, MASKS, MASK_KEYS, STATE_CLASSES, LIVE_SLOTS, LOOSE_AXES, EXEMPTIONS, KIT_SETTING_KEYS, ALLOWED_NEW_REQUESTS, allowedRequest } from '../../scripts/kit-fingerprint.mjs';

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

/* THE MID-GAME REDRAW (KS08, #224; for the overseer's ruling). Turning any setting on writes the campaign's copy of the settings (stc.heal); its arrival
   publishes the players' mission, and missionSource (gm-page.js) auto-hears the leads in reach (A1) and writes ball.heard. That write is today's code and
   happens with or without KS08 (the same write, at the same moment, on kit/main without it). Today's Run view is not redrawn by it, so its stale picture
   matched the all-off one; with KS08, turning kit.desk off must redraw the Run view (to take the kit's markup down), and the redraw shows the leads now
   heard. So, in a mid-game round that turned kit.desk off, and only there, the elements that follow ball.heard may differ: a lead's line in This beat, a
   way's block in The job (its st- class is the heard state) and a Heard toggle. Nothing else in the Run view, and nothing outside it. Self-checked below. */
const MID_REDRAW = [
  { name: 'KS08: the Run view redrawn with the leads A1 heard', reason: 'turning kit.desk off redraws the Run view; ball.heard was written meanwhile by today\'s A1 auto-hear (a setting change publishes the mission)',
    keys: String.raw`div#gm-runv/(?:.*/)?(?:li\.rv-bi\.t-lead:\d+|div\.rv-way\.st-[a-z]+:\d+|div\.rv-heard:\d+/button\.rv-btn\.rv-tog\.sm:\d+)(?:/|$)` }
];

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

/* 1b. mutation tests (the review of KS04): a mask lets go of box and style, never existence; the new rows' allowance covers only what they push. Each mutation is made
   on a copy of a baseline fingerprint, as the capture would have written it, and must be caught (at least one difference); the controls must not be. */
{
  const load = (f) => { const p = path.join(BASELINE, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
  const copy = (fp) => JSON.parse(JSON.stringify(fp));
  const find = (fp, re) => fp.els.find((e) => re.test(e[0]));
  const under = (k) => (e) => e[0] === k || e[0].startsWith(k + '/');
  const remove = (fp, re) => { const t = find(fp, re); if (!t) return null; const m = copy(fp); m.els = m.els.filter((e) => !under(t[0])(e)); return m; };
  const reclass = (fp, re) => {        /* the element's class changed (as a kit would rename it): its key and every key inside it change, as the walk would write them */
    const t = find(fp, re); if (!t) return null; const m = copy(fp), k = t[0], cut = k.lastIndexOf('/'), nk = k.slice(0, cut) + '/' + t[1] + (t[2] ? '#' + t[2] : '.mutated:1');
    for (const e of m.els) { if (e[0] === k) { e[0] = nk; if (!t[2]) e[3] = 'mutated'; } else if (e[0].startsWith(k + '/')) e[0] = nk + e[0].slice(k.length); }
    return m;
  };
  const addChild = (fp, re) => { const t = find(fp, re); if (!t) return null; const m = copy(fp), at = m.els.findIndex((e) => e[0] === t[0]); m.els.splice(at + 1, 0, [t[0] + '/span.mutant:1', 'span', '', 'mutant', t[4], t[5], 10, 10, t[8], t[9]]); return m; };
  const caught = (name, fp, m) => { if (!fp || !m) { check(false, 'mutation: ' + name + ' (its baseline file or element is missing)'); return; } const n = compare(fp, m).diffs.length; check(n > 0, 'mutation caught: ' + name + ' (' + n + ' difference(s))'); };
  const run = load('gm-run-1366.json'), pb = load('gm-pb-1366.json'), deb = load('view-pb-debrief-1366.json');
  const TRAY = [['Send', /div\.gm-tray:\d+\/button\.gm-bb\.gm-tray-send:\d+$/], ['Clear', /div\.gm-tray:\d+\/button\.gm-bb\.gm-tray-clear:\d+$/], ['Blank', /div\.gm-tray:\d+\/button\.gm-bb\.gm-tray-blank:\d+$/],
    ['the live pill', /div\.gm-tray:\d+\/button\.gm-tray-live:\d+$/], ['Auto', /div\.gm-tray:\d+\/button\.gm-ap\.gm-pill\.gm-tray-ap:\d+$/], ['the whole tray', /span#gm-bar-tray\/div\.gm-tray:\d+$/]];
  for (const [n, re] of TRAY) { caught('the band tray\'s ' + n + ' taken away', run, remove(run, re)); caught('the band tray\'s ' + n + ' reclassed', run, reclass(run, re)); }
  caught('the live pill\'s dot taken away', run, remove(run, /button\.gm-tray-live:\d+\/span\.gm-dot\.on:\d+$/));
  caught('the Run view\'s players chip taken away', run, remove(run, /span\.rv-chip\.rv-players:\d+$/));
  caught('the Run view\'s players chip reclassed', run, reclass(run, /span\.rv-chip\.rv-players:\d+$/));
  caught('#gm-ipad-now taken away', run, remove(run, /p#gm-ipad-now$/));
  caught('the iPad line\'s box reclassed', run, reclass(run, /div\.gm-ipad-body:\d+$/));
  caught('a Tonight line taken away', pb, remove(pb, /div\.gm-tn-body:\d+\/p\.gm-tn-line:\d+$/));
  caught('a Tonight line reclassed', pb, reclass(pb, /div\.gm-tn-body:\d+\/p\.gm-tn-line:\d+$/));
  caught('an extra element in a Tonight line', pb, addChild(pb, /div\.gm-tn-body:\d+\/p\.gm-tn-line:\d+$/));
  caught('a Debrief card taken away', deb, remove(deb, /gm-debrief-card[^/]*$/));
  caught('a Debrief card reclassed', deb, reclass(deb, /gm-debrief-card[^/]*$/));
  caught('the Find button reclassed (the control)', run, reclass(run, /button\.gm-band-find[^/]*$/));
  { const m = copy(run), e = m.els.find((x) => /gm-band-r2:\d+\/button\.gm-band-panic:\d+$/.test(x[0])); if (e) e[6] += 30; caught('PANIC 30 px wider (band row 2 holds widths)', run, e ? m : null); }
  /* an element with an id: its key carries no classes, so classes are compared on their own (the re-review of KS04) */
  const classed = (fp, id, f) => { const m = copy(fp), e = m.els.find((x) => x[2] === id); if (!e) return null; e[3] = f(e[3]); return m; };
  for (const id of ['gm-bar-drawer', 'gm-cuebar', 'gm-ipad-now']) {
    caught('#' + id + ': a class added', run, classed(run, id, (c) => (c ? c + ' ' : '') + 'mutated'));
    caught('#' + id + ': a class taken off', run, classed(run, id, (c) => c.split(' ').slice(1).join(' ')));
  }
  /* the mid-game redraw allowance (MID_REDRAW): the heard elements may change; any other Run view element, or one outside it, is still caught */
  {
    const mx = { exemptions: EXEMPTIONS.concat(MID_REDRAW) }, letGo = (name, m) => check(!!m && compare(run, m, mx).diffs.length === 0, 'mid-game redraw allowance lets go: ' + name);
    const caughtMx = (name, m) => { if (!m) { check(false, 'mid-game redraw allowance: ' + name + ' (its element is missing)'); return; } const n = compare(run, m, mx).diffs.length; check(n > 0, 'mid-game redraw allowance still catches: ' + name + ' (' + n + ')'); };
    letGo('a lead\'s line gone from This beat', remove(run, /li\.rv-bi\.t-lead:\d+$/));
    { const t = find(run, /div\.rv-way\.st-[a-z]+:\d+$/), m = t ? copy(run) : null;        /* st-unheard to st-heard, as the walk would write it: its key and every key inside it */
      if (m) { const nk = t[0].replace(/st-[a-z]+:\d+$/, 'st-heard:9'); for (const e of m.els) { if (e[0] === t[0]) { e[0] = nk; e[3] = 'rv-way st-heard'; } else if (e[0].startsWith(t[0] + '/')) e[0] = nk + e[0].slice(t[0].length); } }
      letGo('a way\'s block changing its heard state', m); }
    { const m = copy(run), e = m.els.find((x) => /div\.rv-heard:\d+\/button\.rv-btn\.rv-tog\.sm:\d+$/.test(x[0])); if (e) e[6] += 20; letGo('a Heard toggle redrawn (20 px wider)', e ? m : null); }
    caughtMx('a room card taken away', remove(run, /div\.[a-z.-]*rv-card[a-z0-9.-]*:\d+$/));
    caughtMx('the Run view\'s right column room taken away', remove(run, /section\.rv-sec:1\/div\.rv-rm:1$/));
    caughtMx('the Run view\'s players chip taken away', remove(run, /span\.rv-chip\.rv-players:\d+$/));
    caughtMx('the band tray\'s Blank taken away', remove(run, /div\.gm-tray:\d+\/button\.gm-bb\.gm-tray-blank:\d+$/));
    check(!new RegExp(MID_REDRAW[0].keys).test('body/div#gm-band/div.rv-way.st-heard:1'), 'mid-game redraw allowance: nothing outside #gm-runv');
  }
  /* a live slot: empty on one side is let go; filled on both sides, an element lost inside it is caught */
  const q = load('gm-tray-live-1366.json');
  if (q && find(q, /span\.gm-band-quiet:\d+\/button\.gm-quiet-badge:\d+$/)) {
    const empty = remove(q, /span\.gm-band-quiet:\d+\/button\.gm-quiet-badge:\d+$/); const e2 = remove(empty, /span\.gm-band-quiet:\d+\/div\.gm-quiet-list:\d+$/);
    check(compare(q, e2).diffs.length === 0, 'a live slot the poll has not filled yet (the quiet badge) is let go');
    caught('the quiet list\'s Dismiss button taken away (the slot filled on both sides)', q, remove(q, /div\.gm-quiet-row:\d+\/button\.btn\.sm:\d+$/));
  } else check(false, 'mutation: the quiet badge (gm-tray-live-1366.json has none)');
  /* the new Settings rows' allowance. Hidden rows (0x0, the most files) push nothing; shown rows push what is below them by the height they add, and nothing else moves */
  const settings = find(run, /div#gm-ipad-settings$/);
  if (settings) {
    const withRows = (fp, y, h) => {        /* fp plus five new exempt rows at y, h high and 10 apart (0x0 when h is 0): what is below moves down, the ancestors grow */
      const m = copy(fp), sk = settings[0], add = h ? 5 * h + 5 * 10 : 0;
      for (const e of m.els) { if (h && e[5] >= y) e[5] = Math.round((e[5] + add) * 100) / 100; if (h && sk.startsWith(e[0] + '/') || e[0] === sk) e[7] = Math.round((e[7] + add) * 100) / 100; }
      const at = m.els.findIndex((e) => e[0] === sk), rows = [];
      for (let r = 0; r < 5; r++) rows.push([sk + '/div.gm-set-row:' + (90 + r), 'div', '', 'gm-set-row', h ? 10 : 0, h ? y + r * (h + 10) : 0, h ? 400 : 0, h, settings[8], 'xa']);
      m.els.splice(at + 1, 0, ...rows);
      return m;
    };
    const btn = run.els.find((e) => e[1] === 'button' && e[6] > 10 && e[7] > 10 && !(e[9] || '').includes('m') && !(e[9] || '').includes('x') && !/gm-band-r2|gm-ipad|gm-tray|pp-clock/.test(e[0]));
    const hidden = withRows(run, 0, 0);
    check(compare(run, hidden).diffs.length === 0, 'new rows hidden (0x0): nothing else differs');
    const tweak = (fp, dy, dh) => { const m = copy(fp), e = m.els.find((x) => x[0] === btn[0]); e[5] += dy; e[7] += dh; return m; };
    caught('rows hidden: a button moved down 10 px', run, tweak(hidden, 10, 0));
    caught('rows hidden: a button 12 px taller', run, tweak(hidden, 0, 12));
    const yRows = Math.max(0, btn[5] - 50), shown = withRows(run, yRows, 100);
    check(compare(run, shown).diffs.length === 0, 'new rows shown: what they push down by exactly the height they add, and their ancestors\' growth, are let go (' + compare(run, shown).diffs.length + ')');
    caught('rows shown: a button below them moved down 10 px more', run, tweak(shown, 10, 0));
    caught('rows shown: a button below them 12 px taller', run, tweak(shown, 0, 12));
  } else check(false, 'mutation: the rows allowance (gm-run-1366.json has no #gm-ipad-settings)');
}
if (process.env.KIT_OFF_SELF_ONLY === '1') { console.log(failed ? 'FAIL kit-off (self-checks only): ' + failed + ' check(s)' : 'PASS kit-off (self-checks only)'); process.exit(failed ? 1 : 0); }

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
console.log('masked (box and style not compared; existence, ids and classes still are): ' + MASKS.join(', '));
for (const m of MASK_KEYS) console.log('  key ~ ' + m.keys + ' (' + m.why + ')');
for (const s of STATE_CLASSES) console.log('  state class: .' + s.drop.join(', .') + ' on .' + s.on + ' (' + s.why + ')');
for (const s of LIVE_SLOTS) console.log('  live slot: ' + s.keys + ' (' + s.why + ')');
for (const l of LOOSE_AXES) console.log('  loose ' + l.axes.join(', ') + ': ' + l.keys + ' (' + l.why + ')');
for (const d of r.diffs.slice(0, 20)) console.log('  DIFF ' + d.file + '  ' + d.kind + '  ' + d.key.split('/').slice(-3).join('/') + '  ' + d.detail);
if (r.diffs.length > 20) console.log('  ... and ' + (r.diffs.length - 20) + ' more');
check(r.diffs.length === 0, 'off means today: no element differs from the baseline in id, classes, box or style (' + r.diffs.length + ' differences)');
console.log('allowed new requests (each named, with its reason; add one in ALLOWED_NEW_REQUESTS in scripts/kit-fingerprint.mjs):');
for (const a of ALLOWED_NEW_REQUESTS) console.log('  ' + a.name + ' (' + a.reason + ')');
for (const [screen, q] of Object.entries(r.requests)) {
  if (q.allowed.length) console.log('  allowed new request (' + screen + '): ' + q.allowed.map((u) => u + ' [' + allowedRequest(u).name + ']').join(', '));
  for (const u of q.extra) console.log('  NEW REQUEST (' + screen + ') ' + u);
  if (q.missing.length) console.log('  note: ' + q.missing.length + ' request(s) of the baseline were not made on ' + screen + ' this time (timing; not a failure): ' + q.missing.slice(0, 3).join(', '));
  check(q.extra.length === 0, 'requests on the ' + screen + ' screen: nothing the baseline did not make, bar the named allowed requests');
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
    const kitKey = () => page.evaluate(() => { try { return localStorage.getItem('b68.kit'); } catch (e) { return 'blocked'; } });
    check((await kitKey()) === null, 'with all five off the page wrote no b68.kit key (KIT-REVIEW 11)');
    console.log('mid-game: the page with all five off has ' + A0.els.length + ' elements, data-kit: ' + (attrsA.filter((x) => !/=null$/.test(x)).join(', ') || 'none'));
    const rounds = KIT_SETTING_KEYS.map((k) => [k]).concat([KIT_SETTING_KEYS]);
    for (const ids of rounds) {
      const A = await shoot('before-' + ids.join('+'));        /* each round is held to the picture taken just before it: live data (who is here) may change between rounds, not because of a setting */
      for (const id of ids) await set(id, true);
      const mid = await kitAttrs();
      /* the page saves after an 800 ms debounce (LIMITS.debounce) and its PATCH round trip, so one read 900 ms after the press could land before the save (IP2e: kit.desk=false once, 14/11): read until stored, 10 s at most */
      const readStored = () => page.evaluate(() => fetch('/api/gm/state', { credentials: 'same-origin', cache: 'no-store' }).then((r) => r.json()).then((j) => (j && j.doc && j.doc.features) || {}, () => ({})));
      let stored = await readStored();
      for (let t = 0; t < 20 && !ids.every((id) => stored[id] === true); t++) { await page.waitForTimeout(500); stored = await readStored(); }
      for (const id of ids) await set(id, false);
      const B = await shoot('after-' + ids.join('+')), attrsB = await kitAttrs();
      const r = compare(A, B, ids.includes('kit.desk') ? { tol: 1, exemptions: EXEMPTIONS.concat(MID_REDRAW) } : { tol: 1 });      /* MID_REDRAW: only a round that turned kit.desk off */
      { const mr = (r.exempted || []).filter((n) => /^KS08/.test(n)); if (mr.length) console.log('  allowed: ' + mr.length + ' element(s) by "' + MID_REDRAW[0].name + '"'); }
      for (const d of r.diffs.slice(0, 20)) console.log('  DIFF ' + d.kind + '  ' + d.key.split('/').slice(-3).join('/') + '  ' + d.detail);
      check(r.diffs.length === 0, 'mid-game off, no reload: ' + ids.join(' + ') + ' on, then off: the layout fingerprint is the all-off one (' + r.diffs.length + ' differences)');
      check(JSON.stringify(attrsA) === JSON.stringify(attrsB), 'mid-game off, no reload: ' + ids.join(' + ') + ': the data-kit attributes are the all-off ones' + (JSON.stringify(attrsA) === JSON.stringify(attrsB) ? '' : ' (' + attrsB.join(', ') + ')'));
      /* the round really turned its settings on (void mid, before the review): each is stored on, and kit.desk (the one token the GM page paints) is painted */
      check(ids.every((id) => stored[id] === true), 'mid-game: ' + ids.join(' + ') + ' were stored on while on (' + ids.map((id) => id + '=' + stored[id]).join(', ') + ')');
      if (ids.includes('kit.desk')) check(mid.some((x) => /^html=.*\bdesk\b/.test(x)), 'mid-game: with kit.desk on, <html data-kit> carries desk (' + (mid.filter((x) => !/=null$/.test(x)).join(', ') || 'none') + ')');
    }
    await page.reload(); await ready();
    check(JSON.stringify(await kitAttrs()) === JSON.stringify(attrsA), 'mid-game off: and the same data-kit attributes after the reload');
    check((await kitKey()) === null, 'mid-game off: after the last setting went off, and the reload, no b68.kit key is left');
    check(!errors.length, 'mid-game off: no page error' + (errors.length ? ': ' + errors[0] : ''));
    await c.close();
  } catch (e) { check(false, 'mid-game off ran: ' + String(e && e.stack || e).split(String.fromCharCode(10)).slice(0, 3).join(' | ')); }
  finally { await browser.close().catch(() => {}); await demo.stop(); }
}
console.log(failed ? 'FAIL kit-off: ' + failed + ' check(s)' : 'PASS kit-off');
process.exit(failed ? 1 : 0);
