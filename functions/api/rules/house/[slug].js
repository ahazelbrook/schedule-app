// /api/rules/house/:slug (GM only): the table's own rulings, written in the app (RULES.md).
//   PUT     body = { title, body, trail?, keys?, ord? }   create or replace -> { entry, version }
//   DELETE                                                  -> { ok: true, version }   404 when missing
// A player gets 403 for both. Slugs: lower case letters, digits, - and _ (400 otherwise).

import { getDb } from '../../../_lib/db.js';
import { HttpError, json, methodNotAllowed, readJsonObject, campaignOf } from '../../../_lib/http.js';
import { GM_ONLY, LIMITS, checkSlug, cleanEntry, upsertStmt, stamp, versionOf, nextStamp, toEntry } from '../../../_lib/rules.js';

export async function onRequest({ request, env, params, data }) {
  const method = request.method;
  if (!['PUT', 'DELETE'].includes(method)) return methodNotAllowed(['PUT', 'DELETE']);
  if (data.me.role !== 'gm') throw new HttpError(403, GM_ONLY);
  const slug = checkSlug(params.slug);
  const campaign = campaignOf(env);
  const db = await getDb(env);

  if (method === 'DELETE') {
    const res = await db.prepare("DELETE FROM rules WHERE campaign = ?1 AND book = 'house' AND slug = ?2").bind(campaign, slug).run();
    if (!res || !res.meta || !res.meta.changes) throw new HttpError(404, 'not found');
    return json({ ok: true, version: versionOf(await stamp(db, campaign)) });
  }

  const body = await readJsonObject(request, LIMITS.entryBody * 2);
  const e = cleanEntry({ trail: 'House rules', ...body, slug }, 'rule', 0);
  const before = await stamp(db, campaign);
  const exists = await db.prepare("SELECT 1 AS x FROM rules WHERE campaign = ?1 AND book = 'house' AND slug = ?2").bind(campaign, slug).first();
  if (!exists) {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM rules WHERE campaign = ?1 AND book = 'house'").bind(campaign).first();
    if ((n.n || 0) >= LIMITS.houseEntries) throw new HttpError(413, 'too many house rules (at most ' + LIMITS.houseEntries + ')');
  }
  const now = nextStamp(before);
  await upsertStmt(db, campaign, 'house', e, now).run();
  const row = { book: 'house', slug, title: e.title, trail: e.trail, keys: e.keys, body: e.body, ord: e.ord, src: e.src, updated_at: now };
  return json({ entry: toEntry(row), version: versionOf(await stamp(db, campaign)) });
}
