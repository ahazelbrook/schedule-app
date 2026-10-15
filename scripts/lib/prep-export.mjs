// The GM pack's `prep` part (GM.md, "Prep"): every note under the '68 folder with `gm_prep: true` in its frontmatter,
// as the GM page's Prep tab shows it. The notes are not parsed into a model: each is cut into blocks of Markdown,
// split where a line is a transclusion (![[note#heading]]), and that section of the other note is carried in its place,
// as Obsidian shows it. The app renders the blocks with app/markdown.js, the same file this exporter runs, so both
// see the same task boxes in the same order; each box gets the anchor lib/prep.mjs gives it in its own note, which is
// how a tick at the table finds its line again (lib/sync-prep.mjs).
//
// Part body:
//   { v: 1, vault: <vault folder name, for obsidian:// links>,
//     notes: [{ id, rel, title, session, date, status, blocks: [{ k: 'md' | 'embed', from, heading?, src, tasks: [{ a, t, d }] }] }],
//     links: { <page, lower case>: { k: 'npc' | 'pc' | 'faction' | 'note' | 'vault', rel, name } } }
//   A task is { a: anchor or null (not tickable: the renderer and the line scan disagreed), t: its text, d: ticked in the note }.
// Nothing is dropped from a note: a transclusion that does not resolve stays as its line (shown as a link), with a warning.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { scanNote, sectionOf, embedOf, bodyStart, alignTasks } from './prep.mjs';

export const PREP_ROOT = 'Wiki/Games/Blades in the Dark';
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const readText = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const posix = (p) => p.split(path.sep).join('/');

/** app/markdown.js in a vm, as the unit test loads it: the exact renderer the page uses. */
export function loadMarkdown(repo) {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(repo, 'app', 'markdown.js'), 'utf8'), ctx, { filename: 'markdown.js' });
  return ctx.window.B68Markdown;
}

/** A block's source as both sides render it: a leading blank line, so a rule (---) at its top is never read as frontmatter. */
export const renderSrc = (src) => '\n' + src;

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
const truthy = (v) => v === true || /^(true|yes|1)$/i.test(String(Array.isArray(v) ? v[0] : v == null ? '' : v).trim());
const one = (v) => (Array.isArray(v) ? v[0] : v) == null ? '' : String(Array.isArray(v) ? v[0] : v);

/**
 * Build the part. opts: { vault, repo, exportedAt, basenames (Map lower-case basename -> [rel]), warn }.
 * Returns the part ({ src, ...body }), or null when no note opts in.
 */
export function buildPrep({ vault, repo, exportedAt, basenames, warn = () => {} }) {
  const M = loadMarkdown(repo);
  const root = path.join(vault, ...PREP_ROOT.split('/'));
  const used = new Map();                                    // rel -> text, for the part's hash
  const texts = new Map(), scans = new Map();
  const load = (rel) => {
    if (!texts.has(rel)) { const t = readText(path.join(vault, ...rel.split('/'))); texts.set(rel, t); used.set(rel, t); }
    return texts.get(rel);
  };
  const scanOf = (rel) => { if (!scans.has(rel)) scans.set(rel, scanNote(load(rel), rel)); return scans.get(rel); };
  const pick = (page) => {
    const hits = basenames.get(page.toLowerCase().replace(/\.md$/i, '')) || [];
    return hits.find((r) => r.startsWith(PREP_ROOT + '/')) || hits[0] || null;
  };

  // the notes that opt in
  const chosen = [];
  for (const f of walkMd(root)) {
    const rel = posix(path.relative(vault, f));
    let fm;
    try { fm = M.parseFrontmatter(readText(f)).meta.raw || {}; } catch (_) { continue; }
    if (!truthy(fm.gm_prep)) continue;
    load(rel);
    chosen.push({ rel, fm });
  }
  if (!chosen.length) return null;

  let unaligned = 0;
  /* one block: its lines of note `rel`, [a, b), with the renderer's boxes matched to the scan's */
  function block(k, rel, a, b, extra) {
    const scan = scanOf(rel), src = scan.lines.slice(a, b).map((l) => l.replace(/\r$/, '')).join('\n');
    const rendered = [];
    M.render(renderSrc(src), { task: (t) => { rendered.push(t); return null; } });
    const mine = scan.tasks.filter((t) => t.line >= a && t.line < b);
    const tasks = alignTasks(rendered, mine).map((t, i) => ({ a: t ? t.anchor : null, t: String(rendered[i].text).replace(/\s+/g, ' ').trim().slice(0, 200), d: !!rendered[i].done }));
    unaligned += tasks.filter((t) => !t.a).length;
    return Object.assign({ k, from: rel, src, tasks }, extra || {});
  }

  const notes = [], ids = new Set();
  for (const { rel, fm } of chosen) {
    const scan = scanOf(rel), blocks = [];
    let from = bodyStart(scan.lines);
    for (let i = from; i < scan.lines.length; i++) {
      const e = embedOf(scan.lines[i]);
      if (!e) continue;
      const target = pick(e.page);
      if (!target) { warn('prep: a transclusion in ' + path.basename(rel) + ' (line ' + (i + 1) + ') names a note that is not in the vault'); continue; }
      const tscan = scanOf(target);
      const sec = e.heading ? sectionOf(tscan, e.heading) : { start: bodyStart(tscan.lines), end: tscan.lines.length, text: '' };
      if (!sec) { warn('prep: a transclusion in ' + path.basename(rel) + ' (line ' + (i + 1) + ') names a heading that ' + path.basename(target) + ' does not have'); continue; }
      if (i > from) blocks.push(block('md', rel, from, i));
      blocks.push(block('embed', target, sec.start, sec.end, { heading: sec.text }));
      from = i + 1;
    }
    if (from < scan.lines.length) blocks.push(block('md', rel, from, scan.lines.length));
    for (let x = blocks.length - 1; x >= 0; x--) if (blocks[x].k === 'md' && !blocks[x].src.trim()) blocks.splice(x, 1);   // blank lines between transclusions
    const base = path.basename(rel, '.md');
    let id = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'note';
    while (ids.has(id)) id += '-x';
    ids.add(id);
    const h1 = scan.headings.find((h) => h.level === 1);
    notes.push({ id, rel, title: one(fm.title) || (h1 ? h1.text : base), session: one(fm.session), date: one(fm.date), status: one(fm.status), blocks });
  }
  // newest session first, then by title
  const num = (n) => { const x = parseFloat(n.session); return Number.isFinite(x) ? x : -1; };
  notes.sort((a, b) => num(b) - num(a) || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  if (unaligned) warn('prep: ' + unaligned + ' task box(es) could not be matched to a line, so they cannot be ticked in the app');

  // every wikilink's page, by where it lives
  const links = {}, inPack = new Set(notes.map((n) => n.rel).concat(notes.flatMap((n) => n.blocks.map((b) => b.from))));
  let unresolved = 0;
  for (const n of notes) for (const b of n.blocks) {
    for (const m of b.src.matchAll(/!?\[\[([^\[\]\n]+?)\]\]/g)) {
      const inner = m[1].replace(/\\\|/g, '|'), bar = inner.indexOf('|'), target = (bar < 0 ? inner : inner.slice(0, bar)).trim();
      const hash = target.indexOf('#'), page = (hash < 0 ? target : target.slice(0, hash)).trim();
      if (!page) continue;
      const key = page.toLowerCase().replace(/\.md$/i, '');
      if (links[key]) continue;
      const rel = pick(page);
      if (!rel) { unresolved++; continue; }
      const dir = path.posix.dirname(rel), name = path.posix.basename(rel, '.md');
      const k = inPack.has(rel) ? 'note'
        : dir === PREP_ROOT + '/NPCs' ? 'npc'
        : /\/Characters$/.test(dir) && dir.startsWith(PREP_ROOT + '/Campaigns/') ? 'pc'
        : dir === PREP_ROOT + '/Factions' ? 'faction' : 'vault';
      links[key] = { k, rel, name: k === 'npc' ? name.replace(/ \(NPC\)$/, '') : name };
    }
  }
  if (unresolved) warn('prep: ' + unresolved + ' linked page(s) are not in the vault (they show as plain text)');

  const stamp = [...used.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([p, t]) => p + '\n' + t).join('\n\u0000\n');
  return {
    src: { file: PREP_ROOT + '/ (' + notes.length + ' prep note' + (notes.length === 1 ? '' : 's') + ', ' + used.size + ' files)', blockSha: sha(stamp + '\u0000' + sha(fs.readFileSync(path.join(repo, 'app', 'markdown.js'), 'utf8'))), exportedAt },
    v: 1, vault: path.basename(path.resolve(vault)), notes, links,
  };
}
