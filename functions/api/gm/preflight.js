// /api/gm/preflight (4.2, switch room.preflight; GM only): GET -> what the Preflight sheet needs of the server, in one read-only answer
// (functions/_lib/preflight.js). Writes nothing and calls nothing paid; the Deepgram line is an unauthenticated reachability ping.
// A player or the table display sign-in gets 403 before anything is read.

import { getDb } from '../../_lib/db.js';
import { json, methodNotAllowed, campaignOf } from '../../_lib/http.js';
import { requireGm } from '../../_lib/gm.js';
import { preflightFacts } from '../../_lib/preflight.js';

export async function onRequest({ request, env, data }) {
  requireGm(data);
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  const db = await getDb(env);
  return json(await preflightFacts({ db, env, campaign: campaignOf(env), request, fetchFn: env && env.__fetch ? env.__fetch : fetch }));
}
