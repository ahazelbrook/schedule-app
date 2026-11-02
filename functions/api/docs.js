// /api/docs: the store (suite build W0.6; functions/_lib/docs.js says who may do what and why).
//   GET    ?kind=&owner=&since=&limit=    -> { docs: [{ kind, owner, scope, updatedAt, json }], more }   the rows THIS caller may read, newest first
//   PUT    { kind, owner?, scope?, json } -> { ok, kind, owner, scope, updatedAt, bytes }                 one row, replaced whole (json an object or array, at most 64 KiB)
//   DELETE ?kind=&owner=                  -> { ok, kind, owner }                                          404 when there is no such row to delete
// The GM reads and writes every row. A player reads the public rows and their own, and writes only their own rows of the kinds
// opportunity, debrief and quiet (the owner is always the caller's own id: leave it out). The table display reads the public rows
// only, GET only. A write pokes the LiveHub with kind 'docs'. A malformed body or parameter is 400, a json over 64 KiB is 413.

import { getDb } from '../_lib/db.js';
import { json, methodNotAllowed, readJsonObject, campaignOf, error } from '../_lib/http.js';
import { jsonText } from '../_lib/gm.js';
import { listDocs, putDoc, deleteDoc, DOC_LIMITS } from '../_lib/docs.js';
import { pokeLive } from '../_lib/live.js';

const METHODS = ['GET', 'PUT', 'DELETE'];

export async function onRequest({ request, env, data, waitUntil }) {
  const me = data && data.me;
  if (!me || (me.role !== 'gm' && me.role !== 'player' && me.role !== 'display')) return error(401, 'not signed in');
  if (!METHODS.includes(request.method)) return methodNotAllowed(METHODS);
  const campaign = campaignOf(env);
  const q = new URL(request.url).searchParams;
  if (request.method === 'GET') {
    return jsonText(await listDocs(await getDb(env), campaign, me, { kind: q.get('kind'), owner: q.get('owner'), since: q.get('since'), limit: q.get('limit') }));
  }
  if (request.method === 'PUT') {
    const body = await readJsonObject(request, DOC_LIMITS.request);
    const { poke, ...out } = await putDoc(await getDb(env), campaign, me, body);
    if (poke) pokeLive({ env, waitUntil }, ['docs']);
    return json(out);
  }
  const { poke, ...out } = await deleteDoc(await getDb(env), campaign, me, { kind: q.get('kind'), owner: q.get('owner') });
  if (poke) pokeLive({ env, waitUntil }, ['docs']);
  return json(out);
}
