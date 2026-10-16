// /api/gm/stt (GM.md "Listening"): the table iPad's transcriber control document. GM only; the table display sign-in
// (role 'display') may GET it and PATCH `status`. A player gets 403 on every method, before the body is read.
//   GET   -> { doc, updatedAt }   doc: { want: on | off, session, speakers: { n: name }, status: { state, at, lines, error } }
//   PATCH -> { doc, updatedAt }   merges want / session / speakers (GM) and status (GM or display); null deletes a speaker

import { getDb } from '../../_lib/db.js';
import { json, methodNotAllowed, readJsonObject, campaignOf } from '../../_lib/http.js';
import { requireListener, loadStt, cleanSttPatch, patchStt } from '../../_lib/stt.js';

const METHODS = ['GET', 'PATCH'];

export async function onRequest({ request, env, data }) {
  const role = requireListener(data, true);
  if (!METHODS.includes(request.method)) return methodNotAllowed(METHODS);
  const db = await getDb(env), campaign = campaignOf(env);
  if (request.method === 'GET') return json(await loadStt(db, campaign));
  const patch = cleanSttPatch(await readJsonObject(request, 16 * 1024), role);
  return json(await patchStt(db, campaign, patch));
}
