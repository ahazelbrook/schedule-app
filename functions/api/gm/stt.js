// /api/gm/stt (GM.md "Listening"): the table iPad's transcriber control document. GM only; the table display sign-in
// (role 'display') may GET it and PATCH `status`. A player gets 403 on every method, before the body is read.
//   GET   -> { doc, updatedAt }   doc: { want: on | off, session, speakers: { n: name }, status: { state, at, lines, error } }
//   PATCH -> { doc, updatedAt }   merges want / session / speakers (GM) and status (GM or display); null deletes a speaker

import { getDb } from '../../_lib/db.js';
import { json, methodNotAllowed, readJsonObject, campaignOf } from '../../_lib/http.js';
import { requireListener, loadStt, cleanSttPatch, patchStt } from '../../_lib/stt.js';
import { pokeLive } from '../../_lib/live.js';

const METHODS = ['GET', 'PATCH'];

export async function onRequest({ request, env, data, waitUntil }) {
  const role = requireListener(data, true);
  if (!METHODS.includes(request.method)) return methodNotAllowed(METHODS);
  const db = await getDb(env), campaign = campaignOf(env);
  if (request.method === 'GET') { const { doc, updatedAt } = await loadStt(db, campaign); return json({ doc, updatedAt }); }
  const patch = cleanSttPatch(await readJsonObject(request, 16 * 1024), role);
  const meta = {};
  const out = await patchStt(db, campaign, patch, meta);
  // a poke only when what the pages show moved: the iPad's heartbeat (a new `at`, the same state) pokes nothing
  if (meta.changed) pokeLive({ env, waitUntil }, ['stt']);
  return json(out);
}
