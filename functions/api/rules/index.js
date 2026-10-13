// GET /api/rules (any signed-in member) -> { version, updatedAt, count, books, entries }: the whole rules corpus of
// the campaign (every book), for the page to cache (see RULES.md). `version` changes with every import, edit and
// delete; GET /api/rules?v=<version> answers { version, updatedAt, count, unchanged: true } when it still matches,
// without the entries.
//   entries: [ { book: 'b68' | 'bitd' | 'house', slug, title, trail, keys, body, ord, src, updatedAt } ]
// Never part of /api/export: the text is not ours to back up into a file that gets shared.

import { getDb } from '../../_lib/db.js';
import { json, methodNotAllowed, campaignOf } from '../../_lib/http.js';
import { BOOKS, stamp, versionOf, toEntry } from '../../_lib/rules.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  const campaign = campaignOf(env);
  const db = await getDb(env);
  const s = await stamp(db, campaign);
  const version = versionOf(s);
  const head = { version, updatedAt: s.at, count: s.n };
  if (new URL(request.url).searchParams.get('v') === version) return json({ ...head, unchanged: true });
  const { results } = await db
    .prepare(
      `SELECT book, slug, title, trail, keys, body, ord, src, updated_at FROM rules
       WHERE campaign = ?1 ORDER BY book, ord, slug`
    )
    .bind(campaign)
    .all();
  const rows = results || [];
  const books = {};
  BOOKS.forEach((b) => { books[b] = 0; });
  rows.forEach((r) => { books[r.book] = (books[r.book] || 0) + 1; });
  return json({ ...head, books, entries: rows.map(toEntry) });
}
