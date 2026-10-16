// The GM pack's `downtime` part (GM.md, "Downtime (D)"): the house rule's Good Mornings, from the note under the '68 folder
// with `gm_downtime: true` in its frontmatter (the vault's House rules/blades-68-face-and-the-morning-after.md, "the Morning
// After"). The app's built-in downtime tables (app/downtime-tables.js) stay as they are; this part is laid over them, and
// carries only `T.good`. The Good Mornings are drawn from a zine that is for personal use, so they travel in the GM pack
// (GM-only, never committed) and never in the public repo.
//
// What is read: the note's `## The Good Morning` section, cut at its `### N · Kind` headings; under each, the rows of its
// table, `| **NN** | the line |`, in order. The line is kept as written (bold and italics are rendered by the card); a
// wikilink becomes its text. Anything else in the note stays in the vault.
//
// Part body:
//   { v: 1, rel, T: { good: [{ kind, lines: [string] }] } }

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PREP_ROOT } from './prep-export.mjs';
import { unlink } from './screen-export.mjs';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const readText = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const posix = (p) => p.split(path.sep).join('/');
const truthy = (v) => v === true || /^(true|yes|1)$/i.test(String(v == null ? '' : v).trim());

function walkMd(dir, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of ents) {
    if (e.name.startsWith('.') || e.name.startsWith('_') || e.name === 'node_modules') continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walkMd(f, out);
    else if (e.name.toLowerCase().endsWith('.md')) out.push(f);
  }
  return out;
}

/** The frontmatter's `gm_downtime` (only the flat `key: value` lines matter here). */
function flagged(text) {
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!m) return false;
  const line = m[1].split('\n').find((l) => /^gm_downtime\s*:/.test(l));
  return !!line && truthy(line.replace(/^gm_downtime\s*:\s*/, '').replace(/^["']|["']$/g, ''));
}

/** A table cell's text: `\|` as a bar, wikilinks as their text, the spaces trimmed. */
function cell(s) { return unlink(s.replace(/\\\|/g, '|')).trim(); }

/** The note's text -> [{ kind, lines }] from its `## The Good Morning` section (fences skipped), or [] when it has none. */
export function parseGood(text) {
  const lines = text.split('\n'), out = [];
  let inSec = false, cur = null, fence = false;
  for (const ln of lines) {
    if (/^\s*(```|~~~)/.test(ln)) { fence = !fence; continue; }
    if (fence) continue;
    const h2 = /^## +(.+?)\s*#*\s*$/.exec(ln);
    if (h2) { inSec = /^the good morning$/i.test(h2[1].trim()); cur = null; continue; }
    if (!inSec) continue;
    const h3 = /^### +(?:\d+\s*[·.:-]\s*)?(.+?)\s*#*\s*$/.exec(ln);
    if (h3) { cur = { kind: h3[1].trim(), lines: [] }; out.push(cur); continue; }
    const row = /^\|\s*\*\*\d+\*\*\s*\|(.*)\|\s*$/.exec(ln);
    if (row && cur) { const t = cell(row[1]); if (t) cur.lines.push(t); }
  }
  return out.filter((k) => k.kind && k.lines.length);
}

/**
 * Build the part. opts: { vault, exportedAt, warn }. Returns the part ({ src, ...body }), or null when no note opts in
 * (or the one that does has no Good Mornings: a warning says so).
 */
export function buildDowntime({ vault, exportedAt, warn = () => {} }) {
  const root = path.join(vault, ...PREP_ROOT.split('/'));
  const chosen = walkMd(root).filter((f) => { try { return flagged(readText(f)); } catch (_) { return false; } });
  if (!chosen.length) return null;
  if (chosen.length > 1) warn('downtime: ' + chosen.length + ' notes have gm_downtime: true; the first (' + path.basename(chosen[0]) + ') is used');
  const f = chosen[0], text = readText(f), rel = posix(path.relative(vault, f));
  const good = parseGood(text);
  if (!good.length) { warn('downtime: ' + path.basename(f) + ' has gm_downtime: true but no "## The Good Morning" tables, so no part'); return null; }
  const n = good.reduce((a, k) => a + k.lines.length, 0);
  if (good.length !== 6 || good.some((k) => k.lines.length !== 6)) warn('downtime: the Good Mornings are ' + good.length + ' kinds and ' + n + ' lines (the house rule has 6 × 6)');
  return {
    src: { file: rel, blockSha: sha(JSON.stringify(good)), exportedAt },
    v: 1, rel, T: { good },
  };
}
