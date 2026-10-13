// POST /api/rules/import (GM only): put a rulebook into the rules table, in one request or in chunks (RULES.md).
//   body: { book: 'b68' | 'bitd', entries: [ { slug, title, trail, keys?, body, ord, src } ], replace: true | false,
//           part?: 1.., of?: 1.. }
// replace + the first chunk (no `part`, or part 1) deletes the book's rows first, in the same batch as the inserts;
// every other chunk adds to the book (an entry with a slug already stored replaces it, so a chunk sent twice is
// harmless). Answers { ok, book, received, part, of, replaced, count, version }.
// Caps (functions/_lib/rules.js, LIMITS): 400 for a malformed body, 413 for a size over a cap, 403 for a player.

import { getDb } from '../../_lib/db.js';
import { HttpError, json, methodNotAllowed, readJsonObject, campaignOf } from '../../_lib/http.js';
import { IMPORT_BOOKS, GM_ONLY, LIMITS, cleanEntry, upsertStmt, stamp, versionOf, nextStamp } from '../../_lib/rules.js';

function intIn(v, name, lo, hi) {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new HttpError(400, name + ' must be an integer from ' + lo + ' to ' + hi);
  return v;
}

export async function onRequest({ request, env, data }) {
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  if (data.me.role !== 'gm') throw new HttpError(403, GM_ONLY);
  const body = await readJsonObject(request, LIMITS.request);

  const book = body.book;
  if (book === 'house') throw new HttpError(400, 'house rules are written one at a time (PUT /api/rules/house/:slug)');
  if (!IMPORT_BOOKS.includes(book)) throw new HttpError(400, "book must be 'b68' or 'bitd'");
  if (body.replace !== undefined && typeof body.replace !== 'boolean') throw new HttpError(400, 'replace must be true or false');
  const replace = body.replace === true;
  let part;
  let of;
  if (body.part !== undefined || body.of !== undefined) {
    of = intIn(body.of, 'of', 1, LIMITS.parts);
    part = intIn(body.part, 'part', 1, of);
  }
  if (!Array.isArray(body.entries)) throw new HttpError(400, 'entries must be an array');
  if (body.entries.length > LIMITS.entriesPerRequest) {
    throw new HttpError(413, 'too many entries in one request (' + body.entries.length + ', at most ' + LIMITS.entriesPerRequest + '): send smaller chunks');
  }
  if (!body.entries.length && !replace) throw new HttpError(400, 'entries is empty');

  const seen = new Set();
  let bytes = 0;
  const entries = body.entries.map((raw, i) => {
    const e = cleanEntry(raw, 'entries[' + i + ']', i);
    if (seen.has(e.slug)) throw new HttpError(400, 'entries[' + i + '].slug "' + e.slug + '" appears twice in this request');
    seen.add(e.slug);
    bytes += e.bytes;
    return e;
  });

  const first = replace && (part === undefined || part === 1);
  const campaign = campaignOf(env);
  const db = await getDb(env);
  const before = await stamp(db, campaign);

  // totals for the book as it will be after this request (a replace starts the book again)
  if (!first) {
    const cur = await db
      .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(CAST(body AS BLOB))), 0) AS bytes FROM rules WHERE campaign = ?1 AND book = ?2')
      .bind(campaign, book)
      .first();
    if ((cur.n || 0) + entries.length > LIMITS.bookEntries) throw new HttpError(413, 'too many entries in ' + book + ' (at most ' + LIMITS.bookEntries + ')');
    if ((cur.bytes || 0) + bytes > LIMITS.bookBytes) throw new HttpError(413, book + ' is too large (at most ' + LIMITS.bookBytes + ' bytes of text)');
  } else if (entries.length > LIMITS.bookEntries || bytes > LIMITS.bookBytes) {
    throw new HttpError(413, book + ' is too large');
  }

  const now = nextStamp(before);
  const stmts = [];
  if (first) stmts.push(db.prepare('DELETE FROM rules WHERE campaign = ?1 AND book = ?2').bind(campaign, book));
  entries.forEach((e) => stmts.push(upsertStmt(db, campaign, book, e, now)));
  if (stmts.length) await db.batch(stmts);

  const after = await stamp(db, campaign);
  const total = await db.prepare('SELECT COUNT(*) AS n FROM rules WHERE campaign = ?1 AND book = ?2').bind(campaign, book).first();
  return json({ ok: true, book, received: entries.length, part: part || null, of: of || null, replaced: first, count: (total && total.n) || 0, version: versionOf(after) });
}
