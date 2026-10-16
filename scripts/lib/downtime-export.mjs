// The GM pack's `downtime` part (GM.md, "Downtime (D)"): the house rule's Benefits and Mishaps, from the note under the
// '68 folder with `gm_downtime: true` in its frontmatter (the vault's House rules/blades-68-face-and-the-morning-after.md,
// "the Morning After", version 3). The app's built-in downtime tables (app/downtime-tables.js) stay as they are; this
// part is laid over them, and carries only `T.benefit` and `T.mishap`. The entries are drawn from a zine that is for
// personal use, so they travel in the GM pack (GM-only, never committed) and never in the public repo.
//
// What is read: the note's `## Benefits` and `## Mishaps` sections, cut into bands at their `### 01–20 · Name`
// headings; under each, the entries, one paragraph apiece:
//   **41–42 · The title.** The picture, *"the line"*, and what it gives in **bold**.
//   **Play it:** what the scene is about.
// `00` reads as 100. A Mishap's cost is the overindulgence its first bold words name ("**Brag: +2 Heat.**"). The text is
// kept as written (bold and italics are rendered by the card); a wikilink becomes its text. Anything else in the note
// stays in the vault.
//
// Part body:
//   { v: 2, rel, T: { benefit: [entry], mishap: [entry] } }
//   entry: { lo, hi, band, title, md, play, cost }   cost: 'trouble' | 'decision' | 'lost' | 'brag' | 'brawl' | 'tapped' | ''

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

const COST = { 'attract trouble': 'trouble', 'bad decision': 'decision', bender: 'lost', brag: 'brag', brawl: 'brawl', tapped: 'tapped' };
const costOf = (md) => { const m = /\*\*\s*(attract trouble|bad decision|bender|brag|brawl|tapped)\b/i.exec(md); return m ? COST[m[1].toLowerCase()] : ''; };
const num = (s) => +s || 100;      // "00" is 100

/** The note's text -> { benefit: [entry], mishap: [entry] } from its `## Benefits` and `## Mishaps` sections (fences skipped). */
export function parseMorning(text) {
  const out = { benefit: [], mishap: [] };
  let sec = '', band = '', cur = null, fence = false;
  for (const ln of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(ln)) { fence = !fence; continue; }
    if (fence) continue;
    const h2 = /^## +(.+?)\s*#*\s*$/.exec(ln);
    if (h2) { const t = h2[1].trim(); sec = /^benefits$/i.test(t) ? 'benefit' : /^mishaps$/i.test(t) ? 'mishap' : ''; band = ''; cur = null; continue; }
    if (!sec) continue;
    const h3 = /^### +(\d\d)\s*[–-]\s*(\d\d)\s*·\s*(.+?)\s*#*\s*$/.exec(ln);
    if (h3) { band = h3[1] + '–' + h3[2] + ' · ' + h3[3].trim(); cur = null; continue; }
    const e = /^\*\*(\d\d)\s*[–-]\s*(\d\d) · (.+?)\.\*\*\s+(.+)$/.exec(ln);
    if (e && band) {
      const md = unlink(e[4]).trim();
      cur = { lo: num(e[1]), hi: num(e[2]), band, title: unlink(e[3]).trim(), md, play: '', cost: sec === 'mishap' ? costOf(md) : '' };
      out[sec].push(cur); continue;
    }
    const p = /^\*\*Play it:\*\*\s*(.+)$/.exec(ln);
    if (p && cur) { cur.play = unlink(p[1]).trim(); continue; }
    if (!ln.trim()) cur = null;
  }
  return out;
}

/** What is off about a table: a gap or an overlap in 1..100. */
function gaps(list, name) {
  const out = [];
  let next = 1;
  for (const x of list) {
    if (x.lo !== next) out.push(name + ' ' + (x.lo > next ? 'skip ' + next + '–' + (x.lo - 1) : 'overlap at ' + x.lo));
    next = Math.max(next, x.hi + 1);
  }
  if (list.length && next !== 101) out.push(name + ' stop at ' + (next - 1));
  return out;
}

/**
 * Build the part. opts: { vault, exportedAt, warn }. Returns the part ({ src, ...body }), or null when no note opts in
 * (or the one that does has no Benefits or Mishaps: a warning says so).
 */
export function buildDowntime({ vault, exportedAt, warn = () => {} }) {
  const root = path.join(vault, ...PREP_ROOT.split('/'));
  const chosen = walkMd(root).filter((f) => { try { return flagged(readText(f)); } catch (_) { return false; } });
  if (!chosen.length) return null;
  if (chosen.length > 1) warn('downtime: ' + chosen.length + ' notes have gm_downtime: true; the first (' + path.basename(chosen[0]) + ') is used');
  const f = chosen[0], text = readText(f), rel = posix(path.relative(vault, f));
  const T = parseMorning(text);
  if (!T.benefit.length && !T.mishap.length) { warn('downtime: ' + path.basename(f) + ' has gm_downtime: true but no "## Benefits" or "## Mishaps" entries, so no part'); return null; }
  const off = gaps(T.benefit, 'the Benefits').concat(gaps(T.mishap, 'the Mishaps'));
  const noCost = T.mishap.filter((x) => !x.cost).map((x) => x.lo);
  if (noCost.length > 1) off.push('Mishaps with no overindulgence named: ' + noCost.join(', '));
  for (const k of ['benefit', 'mishap']) if (!T[k].length) off.push('no ' + (k === 'benefit' ? 'Benefits' : 'Mishaps'));
  if (off.length) warn('downtime: ' + path.basename(f) + ': ' + off.join('; '));
  return {
    src: { file: rel, blockSha: sha(JSON.stringify(T)), exportedAt },
    v: 2, rel, T,
  };
}
