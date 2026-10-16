// The GM pack's `screen` part (GM.md, "Screen"): the GM screen, from the note under the '68 folder with `gm_screen: true`
// in its frontmatter. The note is cut at its `## ` headings; each section's Markdown is carried as written and the app
// renders it with app/markdown.js. Text before the first `## ` (after the title) is the intro, shown above every section.
// The cut stops at a `## Related`, `## Provenance` or `## Sources` heading: what follows stays in the vault.
// Wikilinks become their text (the screen has nowhere to send them).
//
// Part body:
//   { v: 1, title, rel, intro: <md>, sections: [{ id, title, md }] }

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PREP_ROOT, loadMarkdown } from './prep-export.mjs';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const readText = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const posix = (p) => p.split(path.sep).join('/');
const truthy = (v) => v === true || /^(true|yes|1)$/i.test(String(Array.isArray(v) ? v[0] : v == null ? '' : v).trim());
export const SCREEN_STOP = /^(related|provenance|sources)\b/i;

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

/** [[page]] -> page, [[page|text]] -> text, ![[...]] dropped. */
export function unlink(md) {
  return md.replace(/!\[\[[^\]\n]*\]\]/g, '').replace(/\[\[([^\]\n]+?)\]\]/g, (_, inner) => {
    const s = inner.replace(/\\\|/g, '|'), bar = s.indexOf('|');
    return (bar < 0 ? s.replace(/#.*$/, '') : s.slice(bar + 1)).trim();
  });
}
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'section';

/** A note's body -> { title, intro, sections }. Headings inside code fences are not cuts. */
export function cutScreen(body) {
  const lines = body.split('\n');
  let title = '', intro = [], cur = null, fence = false, stopped = false;
  const sections = [], ids = new Set();
  for (const ln of lines) {
    if (/^\s*(```|~~~)/.test(ln)) fence = !fence;
    const h1 = !fence && /^# +(.+?)\s*#*\s*$/.exec(ln), h2 = !fence && /^## +(.+?)\s*#*\s*$/.exec(ln);
    if (h1 && !title && !cur) { title = h1[1].trim(); continue; }
    if (h2) {
      if (SCREEN_STOP.test(h2[1].trim())) { stopped = true; break; }
      let id = slug(h2[1]); while (ids.has(id)) id += '-x'; ids.add(id);
      cur = { id, title: h2[1].trim(), lines: [] };
      sections.push(cur);
      continue;
    }
    (cur ? cur.lines : intro).push(ln);
  }
  const tidy = (ls) => unlink(ls.join('\n')).replace(/^\n+|\s+$/g, '');
  return { title, intro: tidy(intro), sections: sections.map((s) => ({ id: s.id, title: s.title, md: tidy(s.lines) })).filter((s) => s.md), stopped };
}

/**
 * Build the part. opts: { vault, repo, exportedAt, warn }. Returns the part ({ src, ...body }), or null when no note opts in.
 */
export function buildScreen({ vault, repo, exportedAt, warn = () => {} }) {
  const M = loadMarkdown(repo);
  const hits = [];
  for (const f of walkMd(path.join(vault, ...PREP_ROOT.split('/')))) {
    let text, fm;
    try { text = readText(f); fm = M.parseFrontmatter(text); } catch (_) { continue; }
    if (truthy((fm.meta.raw || {}).gm_screen)) hits.push({ rel: posix(path.relative(vault, f)), text, body: fm.body });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => (a.rel < b.rel ? -1 : 1));
  if (hits.length > 1) warn('screen: ' + hits.length + ' notes have gm_screen: true; using ' + path.basename(hits[0].rel) + ' only');
  const { rel, text, body } = hits[0];
  const cut = cutScreen(body);
  if (!cut.sections.length) warn('screen: ' + path.basename(rel) + ' has no ## sections');
  return {
    src: { file: rel, blockSha: sha(text + '\u0000' + sha(fs.readFileSync(path.join(repo, 'app', 'markdown.js'), 'utf8'))), exportedAt },
    v: 1, title: cut.title || path.basename(rel, '.md'), rel, intro: cut.intro, sections: cut.sections,
  };
}
