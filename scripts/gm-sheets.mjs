#!/usr/bin/env node
// The phone's Full sheet: the official playbook pages, filled in, put in app/media/sheets/ (git-ignored; deployed from disk like the handouts).
// Registered as a stub by RK30 (the late registrar) of the room key build; RK33 fills it. The stub reads nothing and writes nothing.
//
//   npm run gm:sheets                          the vault is the one npm run with-vault names
//   node scripts/gm-sheets.mjs --vault <vault> [--dest <dir>] [--dry]
//
//   buildSheets(opts) -> { sheets, errors, warnings }
//     opts      { vault, dest, dry }; dest defaults to app/media/sheets and may not leave it (assertInsideSheets)
//     sheets    [] until RK33; each item will name one page written under app/media/sheets/
//     errors    strings; the command exits 1 on any
//     warnings  strings
//
// The art is the publisher's: it never goes in git (.gitignore holds app/media/ and app/media/sheets/; checks/runtime/sheets-private.test.mjs fails
// on any tracked file under app/media/ or any large tracked picture outside the known kit files). The script writes ONLY inside app/media/sheets/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHEETS_DIR = path.join(REPO, 'app', 'media', 'sheets');

/** Throw unless `p` is app/media/sheets itself or a path inside it. Every write RK33 makes goes through this first. Returns the resolved path. */
export function assertInsideSheets(p) {
  const r = path.resolve(String(p));
  const rel = path.relative(SHEETS_DIR, r);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('gm:sheets writes only inside app/media/sheets/: ' + p);
  return r;
}

export function buildSheets(opts = {}) {
  assertInsideSheets(opts.dest || SHEETS_DIR);
  return { sheets: [], errors: [], warnings: [] };
}

function main(argv) {
  const get = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  let r;
  try { r = buildSheets({ vault: get('--vault'), dest: get('--dest'), dry: argv.includes('--dry') }); } catch (e) { console.error('ERROR: ' + e.message); return 1; }
  r.warnings.forEach((w) => console.log('warning: ' + w));
  r.errors.forEach((e) => console.log('ERROR: ' + e));
  console.log('sheets: ' + r.sheets.length + ' page(s), ' + r.errors.length + ' error(s), ' + r.warnings.length + ' warning(s) (stub until RK33)');
  return r.errors.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(main(process.argv.slice(2)));
