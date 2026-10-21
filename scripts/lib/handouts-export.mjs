// The handouts: the prop images the GM can put on the table iPad (GM.md, "Handouts").
//
// The IMAGES are git-ignored static assets (app/media/handouts/, copied from the vault by `npm run gm:handouts`, deployed from disk
// like the calling cards). The MANIFEST is the GM pack's `handouts` part: [{ id, title, file, when? }]. Only the GM page reads it;
// the iPad is sent one item (kind `handout`, the file name) and never the list.
//
// The vault folder holds the images. Titles come from the vault, never invented:
//   - an embed in a Markdown note beside them: `![[file.png|Caption]]` (a non-numeric alias), else the nearest heading above it,
//   - else the file name (extension off, - and _ read as spaces).
// `when` is the one-line cue the vault gives: a line straight after the embed that starts `When:` or `Cue:`.
//
// Part body: { v: 1, rel: <folder in the vault>, items: [{ id, title, file, when? }] }.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const WEB_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
export const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,78}\.(?:png|jpe?g|gif|webp|svg)$/i;
const NOT_IMAGES = new Set(['.md', '.json', '.txt', '.base', '.canvas']);
export const SRC_CANDIDATES = [
  'Wiki/Games/Blades in the Dark/Campaigns/Group/handouts',
  'Wiki/Games/Blades in the Dark/Campaigns/Group/props',
  'Wiki/Games/Blades in the Dark/Projects/handouts',
  'Wiki/Games/Blades in the Dark/Projects/props',
];
const posix = (p) => p.split(path.sep).join('/');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** The vault folder to read: `--src` (relative to the vault, or absolute), else the first of SRC_CANDIDATES that exists, else null. */
export function findSource(vault, explicit) {
  if (explicit) { const d = path.resolve(vault, explicit); return fs.existsSync(d) && fs.statSync(d).isDirectory() ? d : null; }
  for (const c of SRC_CANDIDATES) { const d = path.join(vault, ...c.split('/')); if (fs.existsSync(d) && fs.statSync(d).isDirectory()) return d; }
  return null;
}

function walk(dir, out = []) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  ents.sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const e of ents) {
    if (e.name.startsWith('.') || e.name.startsWith('_') || e.name === 'node_modules') continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out); else out.push(f);
  }
  return out;
}

/** The served name of an image: first 16 hex of the sha256 of its bytes, plus its extension in lower case. */
export function hashName(bytes, name) {
  return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 16) + path.extname(name).toLowerCase().replace('.jpeg', '.jpg');
}
export const HASHED_RE = /^[0-9a-f]{16}\.(?:png|jpg|gif|webp|svg)$/;

/** A name safe to serve and to send to the display: letters, digits, . _ - ; spaces become -; null when nothing is left. */
export function safeName(name) {
  const ext = path.extname(name).toLowerCase();
  const stem = path.basename(name, path.extname(name)).normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^[-_.]+|[-_.]+$/g, '').replace(/-{2,}/g, '-').slice(0, 70);
  const out = stem + ext;
  return stem && FILE_RE.test(out) ? out : null;
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'handout';
const fromFile = (name) => path.basename(name, path.extname(name)).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (s, n) => String(s).replace(/\s+/g, ' ').trim().slice(0, n);

/** Embeds in a note: [{ name (basename of the target, lower case), alias, heading, when }]. */
export function embedsOf(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n'), out = [];
  let heading = '', fence = false;
  lines.forEach((ln, i) => {
    if (/^\s*(```|~~~)/.test(ln)) fence = !fence;
    if (fence) return;
    const h = /^#{1,6} +(.+?)\s*#*\s*$/.exec(ln);
    if (h) heading = h[1].replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a).trim();
    const re = /!\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]|!\[([^\]\n]*)\]\(([^)\n]+)\)/g;
    let m;
    while ((m = re.exec(ln))) {
      const target = m[1] || decodeURIComponent((m[4] || '').split(/[?#]/)[0]);
      const aliasRaw = (m[2] !== undefined ? m[2] : m[3]) || '';
      const alias = /^\d+(x\d+)?$/.test(aliasRaw.trim()) ? '' : aliasRaw.trim();
      const next = /^\s*(?:when|cue)\s*:\s*(.+?)\s*$/i.exec(lines[i + 1] || '');
      out.push({ name: path.basename(target.trim()).toLowerCase(), alias, heading, when: next ? clip(next[1].replace(/\*\*|__/g, ''), 200) : '' });
    }
  });
  return out;
}

/**
 * Read the source folder. Returns { items: [{ id, title, file, when?, from }], skipped: [{ rel, why }] }. `from` is the path of the
 * image (not part of the pack). Files in a form the iPad cannot show (pdf, tiff, gif, ...) are skipped and named.
 */
export function scanHandouts(srcDir) {
  const files = walk(srcDir), skipped = [], images = [], notes = [];
  for (const f of files) {
    const ext = path.extname(f).toLowerCase(), rel = posix(path.relative(srcDir, f));
    if (ext === '.md') { notes.push(f); continue; }
    if (NOT_IMAGES.has(ext) || !ext) continue;
    if (!WEB_EXT.includes(ext)) { skipped.push({ rel, why: 'not a web image (' + ext.slice(1) + ')' }); continue; }
    images.push(f);
  }
  const embeds = new Map();
  for (const n of notes) {
    let text = ''; try { text = fs.readFileSync(n, 'utf8').replace(/^﻿/, ''); } catch (_) { continue; }
    for (const e of embedsOf(text)) if (!embeds.has(e.name)) embeds.set(e.name, e);
  }
  const items = [], ids = new Set();
  for (const f of images) {
    const rel = posix(path.relative(srcDir, f)), base = path.basename(f);
    /* the served name is the content hash (16 hex of sha256) + the extension: never the vault's file name, so it cannot be guessed */
    let bytes; try { bytes = fs.readFileSync(f); } catch (_) { skipped.push({ rel, why: 'unreadable' }); continue; }
    const file = hashName(bytes, base);
    let id = slug(path.basename(base, path.extname(base))); while (ids.has(id)) id += '-x'; ids.add(id);
    const em = embeds.get(base.toLowerCase());
    embeds.delete(base.toLowerCase());      /* a name used twice in the folder: the note's caption goes to the first only */
    const title = clip((em && (em.alias || em.heading)) || fromFile(base), 200);
    const it = { id, title, file };
    if (em && em.when) it.when = em.when;
    it.from = f;
    items.push(it);
  }
  return { items, skipped };
}

/** The GM pack part, or null when the vault has no handouts folder or no web image in it. opts: { vault, repo, exportedAt, warn, src }. */
export function buildHandouts({ vault, repo, exportedAt, warn = () => {}, src }) {
  const dir = findSource(vault, src);
  if (!dir) return null;
  const { items, skipped } = scanHandouts(dir);
  for (const s of skipped) warn('handouts: skipped ' + s.rel + ' (' + s.why + ')');
  if (!items.length) return null;
  const media = repo ? path.join(repo, 'app', 'media', 'handouts') : null;
  if (media) {
    const missing = items.filter((i) => !fs.existsSync(path.join(media, i.file)));
    if (missing.length) warn('handouts: ' + missing.length + ' of ' + items.length + ' image(s) are not in app/media/handouts/ yet: run npm run gm:handouts before a deploy');
  }
  const rel = posix(path.relative(vault, dir));
  const list = items.map(({ from, ...rest }) => rest);
  const sig = sha(JSON.stringify(list) + '\u0000' + items.map((i) => { try { const st = fs.statSync(i.from); return st.size + ':' + Math.floor(st.mtimeMs); } catch (_) { return '?'; } }).join(','));
  return { src: { file: rel, blockSha: sig, exportedAt }, v: 1, rel, items: list };
}
