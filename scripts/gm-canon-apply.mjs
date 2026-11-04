#!/usr/bin/env node
// The canon queue, applied (suite ticket A4, switch ai.canon). No model. Run on the GM's PC with the GM's own `wrangler login`.
//
//   npm run gm:canon-apply -- --queue "<queue note>"            the plan: what each ticked line would do; writes nothing
//   npm run gm:canon-apply -- --queue "<queue note>" --yes      do it
//   node scripts/gm-canon-apply.mjs --queue <file> [--yes] [--vault <path>] [--campaign <id>]
//
// The queue note is written by `/blade canon` (Claude Code, in the vault) and ticked by the GM in Obsidian. See docs/canon-and-frontpage.md.
// Exit: 0 fine, 1 something refused (the report says what), 2 stopped (no vault, no queue note).

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyCanon } from './lib/canon.mjs';

export function parseArgs(argv) {
  const o = { yes: false };
  const need = (i, f) => { if (i >= argv.length || argv[i].startsWith('--')) throw new Error(f + ' needs a value'); return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes') o.yes = true;
    else if (a === '--queue') o.queue = need(++i, a);
    else if (a === '--vault') o.vault = need(++i, a);
    else if (a === '--campaign') o.campaign = need(++i, a);
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  return o;
}

const USAGE = 'node scripts/gm-canon-apply.mjs --queue <queue note> [--yes] [--vault <path>] [--campaign <id>]\nWithout --yes it only says what it would do.';

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); console.error(USAGE); process.exit(2); }
  if (o.help) { console.log(USAGE); process.exit(0); }
  applyCanon(o).then(({ code }) => process.exit(code), (e) => { console.error('gm-canon-apply failed: ' + (e && e.stack || e)); process.exit(2); });
}
