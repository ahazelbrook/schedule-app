// The rules wiki's storage and validation (see RULES.md). The text of the rulebooks never lives in git: the GM imports
// it from their own PC into the `rules` table, and the handlers in functions/api/rules/ serve it to signed-in members.
//
// Plain ES module with no Cloudflare-specific imports. The page keeps its own copy of the size limits (app/rules.js,
// LIMITS) so the importer splits to fit; keep the two in step.

import { HttpError, isPlainObject, nowIso } from './http.js';

export const BOOKS = ['b68', 'bitd', 'house'];
export const IMPORT_BOOKS = ['b68', 'bitd'];       // house rules are written one at a time (PUT /api/rules/house/:slug)
export const GM_ONLY = 'only the GM can change the rules';

export const LIMITS = {
  request: 1024 * 1024,        // bytes of JSON in one import request (the page sends about 300 KB)
  entriesPerRequest: 40,       // D1 batches one statement per entry; the Workers Free plan allows 50 queries a request
  entryBody: 120 * 1024,       // bytes of markdown in one entry (the importer splits larger sections)
  bookEntries: 4000,           // entries in one imported book
  bookBytes: 8 * 1024 * 1024,  // bytes of markdown in one imported book
  houseEntries: 300,           // house rules
  slug: 120, title: 200, trail: 600, keys: 600, src: 600,
  ord: 9999999,
  parts: 500,                  // `of` in a chunked import
};

export const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,119}$/;

const enc = new TextEncoder();
export const byteLength = (s) => enc.encode(s).byteLength;

export function checkSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) throw new HttpError(400, 'bad slug (lower case letters, digits, - and _, at most ' + LIMITS.slug + ')');
  return slug;
}

function text(v, name, max, { required = false, fallback = '' } = {}) {
  if (v === undefined || v === null) {
    if (required) throw new HttpError(400, name + ' is required');
    return fallback;
  }
  if (typeof v !== 'string') throw new HttpError(400, name + ' must be a string');
  const s = v.replace(/\u0000/g, '');
  if (required && !s.trim()) throw new HttpError(400, name + ' is required');
  if (s.length > max) throw new HttpError(413, name + ' is too long (at most ' + max + ' characters)');
  return s;
}

/**
 * Validate one entry from a request body into the row shape. `where` names it in errors ("entries[3]").
 * Size problems are 413, shape problems 400.
 * @returns {{ slug, title, trail, keys, body, ord, src, bytes }}
 */
export function cleanEntry(raw, where, index) {
  if (!isPlainObject(raw)) throw new HttpError(400, where + ' must be an object');
  const slug = checkSlugAt(raw.slug, where);
  const title = text(raw.title, where + '.title', LIMITS.title, { required: true }).trim();
  const trail = text(raw.trail, where + '.trail', LIMITS.trail);
  const keys = text(raw.keys, where + '.keys', LIMITS.keys);
  const src = text(raw.src, where + '.src', LIMITS.src);
  const body = text(raw.body, where + '.body', LIMITS.entryBody * 4);   // characters first (cheap), bytes next
  const bytes = byteLength(body);
  if (bytes > LIMITS.entryBody) throw new HttpError(413, where + '.body is too large (' + bytes + ' bytes, at most ' + LIMITS.entryBody + ')');
  let ord = raw.ord === undefined || raw.ord === null ? index : raw.ord;
  if (!Number.isInteger(ord) || ord < 0 || ord > LIMITS.ord) throw new HttpError(400, where + '.ord must be an integer from 0 to ' + LIMITS.ord);
  return { slug, title, trail, keys, body, ord, src, bytes };
}

function checkSlugAt(slug, where) {
  try { return checkSlug(slug); } catch (e) { throw new HttpError(400, where + '.slug is bad (lower case letters, digits, - and _, at most ' + LIMITS.slug + ')'); }
}

// ---------- storage ----------

const COLS = 'campaign, book, slug, title, trail, keys, body, ord, src, updated_at';
const UPSERT = `INSERT INTO rules (${COLS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
  ON CONFLICT (campaign, book, slug) DO UPDATE SET
    title = excluded.title, trail = excluded.trail, keys = excluded.keys, body = excluded.body,
    ord = excluded.ord, src = excluded.src, updated_at = excluded.updated_at`;

export function upsertStmt(db, campaign, book, e, now) {
  return db.prepare(UPSERT).bind(campaign, book, e.slug, e.title, e.trail, e.keys, e.body, e.ord, e.src, now);
}

/** { n, at }: how many rules rows the campaign holds and the newest updated_at (null when none). */
export async function stamp(db, campaign) {
  const row = await db.prepare('SELECT COUNT(*) AS n, MAX(updated_at) AS at FROM rules WHERE campaign = ?1').bind(campaign).first();
  return { n: (row && row.n) || 0, at: (row && row.at) || null };
}

/** The version the page caches the corpus under: changes with every import, edit and delete. */
export function versionOf(s) {
  return s.at ? s.at + '#' + s.n : '0';
}

/** The next updated_at: now, but after the newest one stored (so the version always moves forward). */
export function nextStamp(s) {
  return nowIso(s.at);
}

export function toEntry(r) {
  return { book: r.book, slug: r.slug, title: r.title, trail: r.trail, keys: r.keys, body: r.body, ord: r.ord, src: r.src, updatedAt: r.updated_at };
}
