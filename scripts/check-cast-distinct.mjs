#!/usr/bin/env node
// The distinctness linter (suite ticket 3.9): npm run check:cast-distinct
// Renders every NPC of the cast canon (app/figures/cast.js) at 64 px and warns on a silhouette overlap or on the same colour plus hat.
//   node scripts/check-cast-distinct.mjs [--specs <file.json>] [--threshold 0.8]
// --specs: a JSON array of figure specs to lint instead of the canon. Warnings only: the exit code is 0 either way (2 for a bad argument).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lint, OVERLAP, SIZE } from './lib/cast-distinct.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function main(argv) {
  let file = null, threshold = OVERLAP;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--specs' && argv[i + 1]) file = argv[++i];
    else if (argv[i] === '--threshold' && argv[i + 1]) threshold = Number(argv[++i]);
    else { console.error('unknown or incomplete option ' + argv[i]); return 2; }
  }
  const Kit = require(path.join(ROOT, 'app', 'figures', 'figure-kit.js'));
  const specs = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : require(path.join(ROOT, 'app', 'figures', 'cast.js')).npcs;
  const r = await lint(specs, (s) => Kit.render(s), threshold);
  console.log('cast-distinct: ' + specs.length + ' NPCs at ' + SIZE + ' px' + (r.skipped ? ' (sharp missing: silhouettes not compared)' : ''));
  r.warnings.forEach((w) => console.log('WARN ' + w));
  console.log(r.warnings.length ? r.warnings.length + ' warning(s); warnings only, nothing failed' : 'no warnings');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).then((c) => process.exit(c));
