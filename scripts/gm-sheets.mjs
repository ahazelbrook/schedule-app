#!/usr/bin/env node
// The phone's Full sheet: the official playbook pages, filled in. This is the private step that turns the publisher's PDF of playbook sheets into
//   app/media/sheets/<playbook>.svg       the page, text as paths (git-ignored; deployed from disk like the handouts)
//   app/media/sheets/<playbook>.map.json  where each mark sits on it (the sheet map; the schema is at the top of scripts/lib/sheets-map.py)
// and, privately, outside the repository and outside the deploy:
//   <private>/proofs/proof-<playbook>.png every region outlined, for a person to look at once per publish
//   <private>/fix-<playbook>.json         hand fixes (read here, never written)
//
// The order, on the GM's PC: run this in the checkout that will run the release (the one holding app/media/sheets/), THEN `npm run release`. The release builds its
// own detached worktree and copies only the gitignored files it names; scripts/release.mjs copies app/media/sheets/ from the checkout into it (every run), so the
// pages reach the deploy. A bare `npm run deploy` is the old route and does not carry them unless it is run in this checkout.
//   npm run gm:sheets -- --pdf "C:\Users\ahaze\Downloads\Blades 68 playbooks.pdf"
//   node scripts/gm-sheets.mjs --pdf <pdf> [--out <dir>] [--private <dir>] [--pages 1,2] [--dry] [--python <exe>]
//   (--content <content.js> and --playbooks a,b name another character table and page order: the tests use them on an invented sheet)
// It reads the PDF and the fix files, and writes ONLY inside app/media/sheets/ (--out may name a folder inside it) and inside <private> (default b68-wt\_sheets, beside
// the worktrees; B68_SHEETS_PRIVATE or --private moves it). Every write goes through assertInsideSheets or assertInsidePrivate first, which follow symlinks and
// junctions. The PDF and <private> may not be inside the repository. It runs no network code, never calls the Anthropic API and never deploys.
//
// What it does, per page (the twelve pages are the playbooks in the printed order: sheets-check.mjs PAGE_ORDER):
//   1. scripts/lib/sheets-map.py (PyMuPDF) renders the page to an SVG and reads its text boxes and drawings into a raw map;
//   2. the page's fix file, if any, is laid over the raw map;
//   3. the map's counts are checked against the character data in app/content.js (sheets-check.mjs), and every count is printed;
//   4. a page that fails a count is REFUSED (nothing written for it) unless its fix file waives that count with a reason (the waiver is printed as a FLAG for a
//      person to settle, and the app's own run-time check keeps a mark from being drawn where the map and the data disagree);
//   5. the proof picture is drawn from the final map, for every page, refused or not.
//
// The map file (<playbook>.map.json) is the prototype's shape: region keys at the top level (stress, xp, xpi, xpp, xpr, acts, ab, items, stacks, bank, harm, heal, res,
// keys, friends, coh, id, load; rectangles [x0, y0, x1, y1] in PDF points, detail at the top of scripts/lib/sheets-map.py) plus a header:
//   v         the schema version (1)                       page      the 1-based page of the PDF
//   size      [w, h] of the page box in points (841.89 x 595.28)    title   the page's biggest text (the playbook's name)
//   playbook  the id (hound, hull, ... timepast)           kinds     { region: box | dot | lozenge | clock | text | mark }, advisory
//   waived    only when non-empty: the CHECK NAMES a fix waived. A check name is not always a region key: 'item loads' belongs to items, 'key hits' to keys,
//             'dots' to acts (sheets-check.mjs FAMILY). A waiver covers the WHOLE region: the app must draw nothing there unless its own counts agree.
//   fixed     only when non-empty: the region keys a fix file replaced whole
//
//   buildSheets(opts) -> { sheets, errors, warnings, table }
//     opts      { pdf, dest, private, python, pages, dry, content, playbooks }  (content: another content.js, playbooks: the page order; the tests use both)
//     sheets    one { id, page, svg, map, checks, waived, fixed } per page written
//     errors    strings (a refused page, a missing PDF...); the command exits 1 on any
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PAGE_ORDER, loadContent, expectFor, checkMap, applyFix, verdict, fixProblems } from './lib/sheets-check.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHEETS_DIR = path.join(REPO, 'app', 'media', 'sheets');
export const HELPER = path.join(REPO, 'scripts', 'lib', 'sheets-map.py');
export const CONTENT = path.join(REPO, 'app', 'content.js');
/* This PC's Python (the Store's python3 is a stub that hangs a shell: never named here). B68_PYTHON or --python overrides. */
const KNOWN_PYTHON = 'C:/Users/ahaze/AppData/Local/Python/pythoncore-3.14-64/python.exe';

/** The real path of `p` when it exists; else the real path of its deepest existing ancestor with the missing tail put back (so a junction or symlink on the
    way, or as `p` itself, shows where it really leads). Pure reading: nothing is created. */
export function realish(p) {
  const r = path.resolve(String(p));
  const tail = [];
  let cur = r;
  for (;;) {
    try { return path.join(fs.realpathSync(cur), ...tail.reverse()); } catch (e) {
      const up = path.dirname(cur);
      if (up === cur) return r;
      tail.push(path.basename(cur)); cur = up;
    }
  }
}

/** True when `p` is `root` itself or inside it, after both are resolved through symlinks and junctions. */
export function isInside(root, p) {
  const rel = path.relative(realish(root), realish(p));
  return !(rel.startsWith('..') || path.isAbsolute(rel));
}

/** Throw unless `p` is `root` itself or inside it, lexically AND as it really is. Returns the resolved path. */
export function assertInside(root, p, message) {
  const r = path.resolve(String(p));
  const rel = path.relative(path.resolve(root), r);
  if (rel.startsWith('..') || path.isAbsolute(rel) || !isInside(root, r)) throw new Error(message + ': ' + p);
  return r;
}

/** Throw unless `p` is app/media/sheets itself or a path inside it, as it REALLY is: a junction or symlink inside the folder that leads out is refused
    (the parent is resolved with fs.realpathSync, as far as it exists). Every write into the app goes through this first. Returns the resolved path. */
export function assertInsideSheets(p) {
  const bad = sheetsRootProblem(REPO);
  if (bad) throw new Error('gm:sheets writes only inside app/media/sheets/, which is not itself a real folder of this checkout: ' + bad);
  return assertInside(SHEETS_DIR, p, 'gm:sheets writes only inside app/media/sheets/');
}

/** '' when app/media/sheets of `repo` really is <real repo>/app/media/sheets; else what is wrong. If app/media or app/media/sheets is itself a junction or symlink
    the folder resolves through it and a write "inside" it would land elsewhere, so the whole step is refused. (The repo is a parameter so a test can use a made-up one.) */
export function sheetsRootProblem(repo = REPO) {
  const want = path.join(realish(repo), 'app', 'media', 'sheets');
  const got = realish(path.join(repo, 'app', 'media', 'sheets'));
  return path.relative(got, want) === '' ? '' : 'it leads to ' + got + ', not ' + want;
}

/** The private folder: --private, else B68_SHEETS_PRIVATE, else _sheets beside the worktrees (b68-wt\_sheets for any worktree under b68-wt). */
export function privateDir(opts = {}) {
  return path.resolve(opts.private || process.env.B68_SHEETS_PRIVATE || path.join(REPO, '..', '_sheets'));
}

/** Throw unless `p` is inside the private folder `priv` (and so outside the repository: buildSheets refuses a private folder that is inside it). */
export function assertInsidePrivate(priv, p) {
  return assertInside(priv, p, 'gm:sheets writes its private files only inside ' + priv);
}

/** The first Python that can `import pymupdf`, or null. Never python3. */
export function findPython(want) {
  const list = [want, process.env.B68_PYTHON, KNOWN_PYTHON, 'python'].filter(Boolean);
  for (const exe of list) {
    try {
      const r = spawnSync(exe, ['-I', '-c', 'import pymupdf'], { encoding: 'utf8', timeout: 30000 });
      if (r.status === 0) return exe;
    } catch (e) { /* not runnable: try the next */ }
  }
  return null;
}

function runHelper(python, args) {
  const r = spawnSync(python, ['-I', HELPER, ...args], { encoding: 'utf8', maxBuffer: 1 << 28, timeout: 600000 });
  if (r.status !== 0) throw new Error('the PDF helper failed (' + (r.error ? r.error.message : 'exit ' + r.status) + '): ' + String(r.stderr || '').trim().split('\n').slice(-3).join(' '));
  const line = String(r.stdout || '').trim().split('\n').pop();
  try { return JSON.parse(line); } catch (e) { throw new Error('the PDF helper printed something that is not JSON'); }
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const pad2 = (n) => String(n).padStart(2, '0');

export function buildSheets(opts = {}) {
  const dest = assertInsideSheets(opts.dest || SHEETS_DIR);       /* first, before anything is read: a dest outside the folder is refused */
  const out = { sheets: [], errors: [], warnings: [], table: [] };
  const fail = (m) => { out.errors.push(m); return out; };
  if (!opts.pdf) return fail('need --pdf <path to the playbooks PDF>');
  const pdf = path.resolve(String(opts.pdf));
  if (!fs.existsSync(pdf)) return fail('no such file: ' + pdf);
  if (isInside(REPO, pdf)) return fail('the PDF is the publisher\'s: keep it outside the repository (' + pdf + ')');
  const priv = privateDir(opts);
  if (isInside(REPO, priv)) return fail('the private folder must be outside the repository: ' + priv);
  const python = findPython(opts.python);
  if (!python) return fail('no Python with PyMuPDF found (set B68_PYTHON or pass --python <exe>)');

  const content = loadContent(opts.content || CONTENT);
  const order = opts.playbooks || PAGE_ORDER;
  const info = runHelper(python, ['probe', '--pdf', pdf]);
  const wanted = opts.pages && opts.pages.length ? opts.pages : order.map((_, i) => i + 1);
  if (!opts.pages && info.pages !== order.length) return fail('expected a ' + order.length + '-page PDF, found ' + info.pages + ' pages (use --pages to map some)');
  for (const n of wanted) if (!(n >= 1 && n <= order.length && n <= info.pages)) return fail('page ' + n + ' is not one of the ' + order.length + ' playbook pages');

  const proofs = assertInsidePrivate(priv, path.join(priv, 'proofs'));
  /* The work folder is a fresh one this run makes (mkdtemp) and removes: nothing that was already in <private> is ever deleted, whatever --private names. */
  fs.mkdirSync(priv, { recursive: true });
  const work = assertInsidePrivate(priv, fs.mkdtempSync(path.join(priv, 'work-')));
  try {
    runHelper(python, ['extract', '--pdf', pdf, '--work', work, '--pages', wanted.join(',')]);
    const written = [];
    for (const n of wanted) {
      const id = order[n - 1];
      const raw = readJson(path.join(work, 'page-' + pad2(n) + '.raw.json'));
      let fix = null;
      const fixFile = path.join(priv, 'fix-' + id + '.json');
      if (fs.existsSync(fixFile)) {
        try { fix = readJson(fixFile); } catch (e) { out.errors.push(id + ': fix file is not JSON (' + e.message + ')'); continue; }
        const bad = fixProblems(fix);
        if (bad.length) { out.errors.push(id + ': fix file: ' + bad.join('; ')); continue; }
      }
      const exp = expectFor(content, id);
      const map = applyFix(raw, fix);
      map.playbook = id;
      delete map.warn;
      const checks = checkMap(map, exp);
      const v = verdict(checks, fix);
      if (v.waived.length) map.waived = v.waived.map((w) => w.region);
      fs.writeFileSync(path.join(work, 'final-' + pad2(n) + '.json'), JSON.stringify(map));
      out.table.push({ page: n, id, checks, ok: v.ok, failed: v.failed, waived: v.waived, fixed: map.fixed || [] });
      if (!v.ok) { out.errors.push(id + ' (page ' + n + ') REFUSED: ' + v.failed.map((f) => { const c = checks.find((x) => x.region === f); return f + ' ' + c.got + '/' + c.want + (c.why ? ' (' + c.why + ')' : ''); }).join('; ') + '. Fix it in ' + fixFile + ' or waive it there with a reason.'); continue; }
      const flagged = new Set();            /* one waiver can cover two rows (items and item loads): say it once */
      for (const w of v.waived) if (!flagged.has(w.why)) { flagged.add(w.why); out.warnings.push('FLAG ' + id + ' (page ' + n + ') ' + w.region + ': ' + w.why); }
      written.push({ n, id, map, checks, waived: v.waived, fixed: map.fixed || [] });
    }
    fs.mkdirSync(proofs, { recursive: true });
    runHelper(python, ['proof', '--pdf', pdf, '--work', work, '--out', proofs, '--pages', wanted.join(',')]);
    if (!opts.dry && written.length) {
      fs.mkdirSync(dest, { recursive: true });
      for (const w of written) {
        const svgTo = assertInsideSheets(path.join(dest, w.id + '.svg'));
        const mapTo = assertInsideSheets(path.join(dest, w.id + '.map.json'));
        fs.copyFileSync(path.join(work, 'page-' + pad2(w.n) + '.svg'), svgTo);
        fs.writeFileSync(mapTo, JSON.stringify(w.map));
        out.sheets.push({ id: w.id, page: w.n, svg: svgTo, map: mapTo, checks: w.checks, waived: w.waived, fixed: w.fixed });
      }
    }
  } finally {
    try { fs.rmSync(assertInsidePrivate(priv, work), { recursive: true, force: true }); } catch (e) { out.warnings.push('could not remove ' + work + ': ' + e.message); }
  }
  return out;
}

/** The count table, one line per page: every region's got/want, a * on a count that fails, then OK, FIXED (a hand fix was laid over the map) or FLAG/REFUSED. */
export function formatTable(table) {
  return table.map((r) => {
    const cells = r.checks.map((c) => c.region + ' ' + c.got + '/' + c.want + (c.ok ? '' : '*')).join(', ');
    const tag = !r.ok ? 'REFUSED' : r.waived.length ? 'FLAG (' + r.waived.map((w) => w.region).join(', ') + ')' : r.fixed.length ? 'FIXED (' + r.fixed.join(', ') + ')' : 'OK';
    return pad2(r.page) + ' ' + r.id.padEnd(13) + ' ' + tag + '\n   ' + cells;
  }).join('\n');
}

function main(argv) {
  const get = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const pages = get('--pages') ? get('--pages').split(',').map(Number) : undefined;
  let r;
  try {
    r = buildSheets({ pdf: get('--pdf'), dest: get('--out') || get('--dest'), private: get('--private'), python: get('--python'), pages, dry: argv.includes('--dry'),
      content: get('--content'), playbooks: get('--playbooks') ? get('--playbooks').split(',') : undefined });
  } catch (e) { console.error('ERROR: ' + e.message); return 1; }
  if (r.table.length) console.log(formatTable(r.table));
  r.warnings.forEach((w) => console.log('warning: ' + w));
  r.errors.forEach((e) => console.log('ERROR: ' + e));
  console.log('sheets: ' + r.sheets.length + ' page(s) written, ' + r.errors.length + ' error(s), ' + r.warnings.length + ' warning(s)' + (argv.includes('--dry') ? ' (dry run: nothing written to the app)' : ''));
  return r.errors.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main(process.argv.slice(2)));
