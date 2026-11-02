// The store (suite build W0.6): `docs`, one small table for the suite's per-campaign documents (migrations/0009_docs.sql).
//
// A row is keyed (campaign, kind, owner) and carries a scope and a JSON document. Who may do what is decided here, in SQL where
// it can be, so a route cannot forget a check:
//
//   role      reads                                          writes
//   gm        every row                                      every row; any kind, owner and scope
//   player    scope 'public', and scope 'player' rows        only kinds in PLAYER_KINDS, only owner = their own id, and the
//             whose owner is their own id                    row is always scope 'player' (a GM's or a public row of the same
//                                                            key is never overwritten: the upsert is guarded in SQL)
//   display   scope 'public' only                            nothing (the middleware refuses it before this runs)
//
// A row the caller may not read is absent from a list, never 403, so a list cannot tell a hidden row from a missing one. A
// row's json is at most DOC_LIMITS.row bytes. A write pokes the LiveHub with kind 'docs' (a kind and a time, no data) unless
// it touched only GM-scope rows, which nobody but the GM reads.
//
// A row's updated_at only ever moves forward for that row, but two different rows written in the same millisecond can share a time, and
// ?since is exclusive: a poller that asks for since = the newest time it has seen can miss the second of two same-millisecond writes.
// Poll with the pokes as the nudge and re-read by kind (rows are small), or ask for since a little earlier than the newest time seen.
//
// Plain ES with no Cloudflare import, so node loads it through the handler in the checks.

import { HttpError, isPlainObject, nowIso } from './http.js';

export const DOC_LIMITS = { row: 64 * 1024, request: 80 * 1024, list: 200, listDefault: 100 };
export const SCOPES = ['gm', 'player', 'public'];
export const PLAYER_KINDS = ['opportunity', 'debrief', 'quiet'];
export const KIND_RE = /^[a-z][a-z0-9-]{0,31}$/;
export const OWNER_RE = /^[^\s\u0000-\u001f\u007f]{1,254}$/;
export const GM_OWNER = '_';            // the owner of a GM row that is the campaign's, not a person's
export const FORBIDDEN = 'you cannot write that row';

const enc = new TextEncoder();
const byteLength = (s) => enc.encode(s).length;

function checkKind(v) {
  if (typeof v !== 'string' || !KIND_RE.test(v)) throw new HttpError(400, 'kind must match [a-z][a-z0-9-]{0,31}');
  return v;
}
function checkOwner(v) {
  if (typeof v !== 'string' || !OWNER_RE.test(v)) throw new HttpError(400, 'owner must be 1 to 254 characters with no spaces');
  return v;
}
function checkScope(v) {
  if (typeof v !== 'string' || !SCOPES.includes(v)) throw new HttpError(400, 'scope must be gm, player or public');
  return v;
}
function roleOf(me) {
  const role = me && me.role;
  if (role !== 'gm' && role !== 'player' && role !== 'display') throw new HttpError(401, 'not signed in');
  return role;
}

/** GET: the rows this caller may read, filtered by kind / owner / since (an ISO time: updated after it) / limit. -> the answer as JSON text
 *  (each row's json is spliced in as stored: the stored text is JSON.stringify output, so there is no parse of up to 64 KiB a row). */
export async function listDocs(db, campaign, me, q) {
  const role = roleOf(me);
  const binds = [campaign], where = ['campaign_id = ?1'];
  const bind = (sql, v) => { binds.push(v); where.push(sql.replace('?', '?' + binds.length)); };
  if (role === 'display') where.push("scope = 'public'");
  else if (role === 'player') { binds.push(me.id); where.push("(scope = 'public' OR (scope = 'player' AND owner = ?" + binds.length + '))'); }
  if (q.kind !== null && q.kind !== undefined) bind('kind = ?', checkKind(q.kind));
  if (q.owner !== null && q.owner !== undefined) bind('owner = ?', checkOwner(q.owner));
  if (q.since !== null && q.since !== undefined) {
    if (typeof q.since !== 'string' || !Number.isFinite(Date.parse(q.since))) throw new HttpError(400, 'since must be an ISO time');
    bind('updated_at > ?', q.since);
  }
  let limit = DOC_LIMITS.listDefault;
  if (q.limit !== null && q.limit !== undefined) {
    limit = Number(q.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > DOC_LIMITS.list) throw new HttpError(400, 'limit must be a whole number from 1 to ' + DOC_LIMITS.list);
  }
  const { results } = await db.prepare(
    "SELECT kind, owner, scope, updated_at, CASE WHEN json_valid(json) THEN json ELSE 'null' END AS json FROM docs WHERE " +
    where.join(' AND ') + ' ORDER BY updated_at DESC, kind, owner LIMIT ' + (limit + 1)
  ).bind(...binds).all();
  const rows = results || [], more = rows.length > limit;
  const docs = rows.slice(0, limit).map((r) =>
    '{"kind":' + JSON.stringify(r.kind) + ',"owner":' + JSON.stringify(r.owner) + ',"scope":' + JSON.stringify(r.scope) +
    ',"updatedAt":' + JSON.stringify(r.updated_at) + ',"json":' + r.json + '}');
  return '{"docs":[' + docs.join(',') + '],"more":' + (more ? 'true' : 'false') + '}';
}

/** What a PUT or DELETE names, checked for this caller: { role, kind, owner }. A player may name only their own rows of PLAYER_KINDS (403). */
function target(me, raw) {
  const role = roleOf(me);
  if (role === 'display') throw new HttpError(403, FORBIDDEN);
  const kind = checkKind(raw.kind);
  const given = raw.owner !== undefined && raw.owner !== null;
  if (role === 'gm') return { role, kind, owner: given ? checkOwner(raw.owner) : GM_OWNER };
  if (!PLAYER_KINDS.includes(kind)) throw new HttpError(403, FORBIDDEN);
  if (given && raw.owner !== me.id) throw new HttpError(403, FORBIDDEN);
  return { role, kind, owner: me.id };
}

/** PUT { kind, owner?, scope?, json } -> { ok, kind, owner, scope, updatedAt, bytes, poke }. `poke` says whether pages should be told. */
export async function putDoc(db, campaign, me, body) {
  const t = target(me, body);
  if (t.role === 'player' && body.scope !== undefined && body.scope !== 'player') throw new HttpError(403, FORBIDDEN);
  const scope = t.role === 'player' ? 'player' : (body.scope === undefined || body.scope === null ? null : checkScope(body.scope));
  const doc = body.json;
  if (!(Array.isArray(doc) || isPlainObject(doc))) throw new HttpError(400, 'json must be an object or an array');
  const text = JSON.stringify(doc), bytes = byteLength(text);
  if (bytes > DOC_LIMITS.row) throw new HttpError(413, 'json is too large (' + bytes + ' bytes, at most ' + DOC_LIMITS.row + ')');
  const cur = await db.prepare('SELECT scope, updated_at FROM docs WHERE campaign_id = ?1 AND kind = ?2 AND owner = ?3').bind(campaign, t.kind, t.owner).first();
  const now = nowIso(cur && cur.updated_at);
  // a null scope keeps the stored one, or 'gm' on a new row; a player's upsert only ever replaces a row that is already theirs (scope 'player')
  const r = await db.prepare(
    `INSERT INTO docs (campaign_id, kind, owner, scope, json, updated_at) VALUES (?1, ?2, ?3, COALESCE(?4, 'gm'), ?5, ?6)
     ON CONFLICT (campaign_id, kind, owner) DO UPDATE SET scope = COALESCE(?4, docs.scope), json = excluded.json, updated_at = excluded.updated_at` +
    (t.role === 'player' ? " WHERE docs.scope = 'player'" : '')
  ).bind(campaign, t.kind, t.owner, scope, text, now).run();
  if (!r || !r.meta || !r.meta.changes) throw new HttpError(403, FORBIDDEN);
  const after = scope || (cur && cur.scope) || 'gm';
  return { ok: true, kind: t.kind, owner: t.owner, scope: after, updatedAt: now, bytes, poke: !(after === 'gm' && (!cur || cur.scope === 'gm')) };
}

/** DELETE ?kind=&owner= -> { ok, kind, owner, poke } (404 when there is no such row to delete). A player deletes only their own scope-'player' rows. */
export async function deleteDoc(db, campaign, me, raw) {
  const t = target(me, raw);
  const cur = await db.prepare('SELECT scope FROM docs WHERE campaign_id = ?1 AND kind = ?2 AND owner = ?3').bind(campaign, t.kind, t.owner).first();
  const r = await db.prepare(
    'DELETE FROM docs WHERE campaign_id = ?1 AND kind = ?2 AND owner = ?3' + (t.role === 'player' ? " AND scope = 'player'" : '')
  ).bind(campaign, t.kind, t.owner).run();
  if (!r || !r.meta || !r.meta.changes) throw new HttpError(404, 'no such row');
  return { ok: true, kind: t.kind, owner: t.owner, poke: !(cur && cur.scope === 'gm') };
}
