// /api/gm/pack (GM only, see GM.md): the GM pack, the generators' tables imported by the GM from their own PC.
// Never in git, never part of /api/export. A player gets 403 on every method, before the body is read.
//   GET                          -> { version, parts: { <name>: { version, src, updatedAt, bytes } } }   (the index, no bodies)
//   GET ?v=<version>             -> { version, unchanged: true } while the pack's version still matches
//   GET ?part=<name>             -> { part, version, src, updatedAt, body }   (404 when missing)
//   GET ?part=<name>&v=<version> -> { part, version, src, updatedAt, unchanged: true } while the part still matches
//   POST { part, src, body }     -> { ok, part, version, bytes, unchanged, packVersion }: stores one part (body: a JSON
//                                   object); the same body and src again is { unchanged: true } and writes nothing
//   DELETE ?part=<name>          -> { ok, part, packVersion } (404 when missing)
// Caps (functions/_lib/gm.js, LIMITS): part name [a-z0-9-]{1,32}, 900 KiB of JSON per part, 12 parts, 2 KiB of src;
// a malformed body is 400, a size over a cap 413.

import { getDb } from '../../_lib/db.js';
import { HttpError, json, methodNotAllowed, readJsonObject, campaignOf } from '../../_lib/http.js';
import { LIMITS, requireGm, checkPart, cleanPart, shortHash, packIndex, packHeads, packVersion, parseJson, jsonText } from '../../_lib/gm.js';

const METHODS = ['GET', 'POST', 'DELETE'];

export async function onRequest({ request, env, data }) {
  requireGm(data);
  const method = request.method;
  if (!METHODS.includes(method)) return methodNotAllowed(METHODS);
  const campaign = campaignOf(env);
  const q = new URL(request.url).searchParams;

  if (method === 'GET') {
    const db = await getDb(env);
    const name = q.get('part');
    const v = q.get('v');
    if (name === null) {
      const index = await packIndex(db, campaign);
      if (v !== null && v === index.version) return json({ version: index.version, unchanged: true });
      return json(index);
    }
    checkPart(name);
    const head = await db.prepare('SELECT version, src, updated_at FROM gm_pack WHERE campaign = ?1 AND part = ?2').bind(campaign, name).first();
    if (!head) throw new HttpError(404, 'no part ' + name);
    const meta = { part: name, version: head.version, src: parseJson(head.src, {}), updatedAt: new Date(head.updated_at).toISOString() };
    if (v !== null && v === head.version) return json({ ...meta, unchanged: true });
    const row = await db.prepare('SELECT body FROM gm_pack WHERE campaign = ?1 AND part = ?2').bind(campaign, name).first();
    if (!row) throw new HttpError(404, 'no part ' + name);
    // the stored body is JSON.stringify output, so it goes into the answer as it is (no parse of up to 900 KiB)
    return jsonText(JSON.stringify(meta).slice(0, -1) + ',"body":' + row.body + '}');
  }

  if (method === 'DELETE') {
    const name = checkPart(q.get('part'));
    const db = await getDb(env);
    const r = await db.prepare('DELETE FROM gm_pack WHERE campaign = ?1 AND part = ?2').bind(campaign, name).run();
    if (!r || !r.meta || !r.meta.changes) throw new HttpError(404, 'no part ' + name);
    return json({ ok: true, part: name, packVersion: await packVersion(await packHeads(db, campaign)) });
  }

  // POST
  const p = cleanPart(await readJsonObject(request, LIMITS.request));
  // The assist part is a file id: its prefix text goes to Anthropic's Files API from the GM's PC, never into D1 (Workers Free CPU).
  if (p.part === 'assist' && typeof parseJson(p.body, {}).prefix === 'string') throw new HttpError(400, 'push the assist part from the PC with gm:sync (it carries prefix text)');
  const version = await shortHash(p.body);
  const db = await getDb(env);
  const heads = await packHeads(db, campaign);
  const cur = heads.find((h) => h.part === p.part);
  if (cur && cur.version === version && cur.src === p.src) {
    return json({ ok: true, part: p.part, version, bytes: p.bytes, unchanged: true, packVersion: await packVersion(heads) });
  }
  if (!cur && heads.length >= LIMITS.parts) throw new HttpError(413, 'too many parts (at most ' + LIMITS.parts + '): delete one first');
  // updated_at in ms, always after the newest stored one, so the change stamp moves forward
  const newest = heads.reduce((m, h) => Math.max(m, h.updated_at || 0), 0);
  const now = Math.max(Date.now(), newest + 1);
  await db
    .prepare(
      `INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (campaign, part) DO UPDATE SET version = excluded.version, src = excluded.src,
         updated_at = excluded.updated_at, body = excluded.body`
    )
    .bind(campaign, p.part, version, p.src, now, p.body)
    .run();
  return json({ ok: true, part: p.part, version, bytes: p.bytes, unchanged: false, packVersion: await packVersion(await packHeads(db, campaign)) });
}
