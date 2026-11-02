#!/usr/bin/env node
// The pacing post-mortem (suite ticket A5): actual against planned, per phase and per room, filed in the session note for the census.
//
//   npm run gm:pacing -- --night <file.json>                 print the table; writes nothing
//   npm run gm:pacing -- --night <file.json> --yes           file it under "## Pacing post-mortem" in the session note
//   node scripts/gm-pacing.mjs --night <file> [--session <N>] [--end <ms>] [--yes] [--force] [--vault <path>]
//
// --night is a saved copy of the night (the GM state document's `night`, or the whole document): the phase times and budgets, and the
// night.log of phase changes, stamps and cues. A log entry "Room: <name> (8m)" marks a room (the "(8m)" planned time is optional).
// A heading already in the note is left alone unless --force, which replaces only that block. Reads a file; no network, no model.
// Exit: 0 fine, 2 stopped (no file, no vault, no session note).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sessionNotes, highestNote, toLines, fromLines, headings, sectionEnd, insertBlock, addHeading, editNote } from './lib/vault.mjs';
import { pacing, render, HEADING } from './lib/pacing.mjs';

export function parseArgs(argv) {
  const o = { yes: false, force: false };
  const need = (i, f) => { if (i >= argv.length || argv[i].startsWith('--')) throw new Error(f + ' needs a value'); return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes') o.yes = true;
    else if (a === '--force') o.force = true;
    else if (a === '--night') o.night = need(++i, a);
    else if (a === '--vault') o.vault = need(++i, a);
    else if (a === '--session') o.session = Number(need(++i, a));
    else if (a === '--end') o.end = Number(need(++i, a));
    else throw new Error('unknown option ' + a);
  }
  return o;
}

/** Put the block under the heading: add the heading at the end if absent; replace its body with force; else null (left alone). */
export function file(text, block, force) {
  const lines = toLines(text), eol = /\r\n/.test(text) ? '\r\n' : '\n', at = headings(lines)[HEADING];
  if (at) {
    if (!force) return null;
    const end = sectionEnd(lines, at[0]);
    lines.splice(at[0] + 1, end - at[0] - 1);
    insertBlock(lines, at[0], block, { eol });
    return fromLines(lines);
  }
  const all = Object.values(headings(lines)).flat().sort((a, b) => a - b);
  if (all.length) {
    const start = addHeading(lines, all[all.length - 1], HEADING, eol);
    insertBlock(lines, start, block, { eol });
  } else {
    lines.push('', '## ' + HEADING);
    insertBlock(lines, lines.length - 1, block, { eol });
  }
  return fromLines(lines);
}

export function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.error(e.message); return 2; }
  if (!o.night) { console.error('--night <file.json> is needed (a saved copy of the night)'); return 2; }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(o.night, 'utf8')); } catch (e) { console.error('cannot read ' + o.night + ': ' + e.message); return 2; }
  const block = render(pacing(raw, o.end));
  console.log(block.join('\n'));
  if (!o.yes) { console.log('\n(dry run: add --yes to file it in the session note)'); return 0; }
  const vault = o.vault || process.env.B68_VAULT;
  if (!vault) { console.error('no vault: pass --vault <path>'); return 2; }
  const notes = sessionNotes(vault);
  const pick = o.session != null ? { note: notes.find((n) => n.int && n.num === o.session) } : highestNote(notes);
  if (!pick.note) { console.error(pick.error || 'no session note ' + o.session); return 2; }
  const r = editNote(vault, pick.note.rel, (n) => file(n.text, block, o.force));
  console.log(r.changed ? 'filed in ' + pick.note.name : 'left alone: ' + pick.note.name + ' already has "' + HEADING + '" (--force replaces it)');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exit(main(process.argv.slice(2)));
