// /api/gm/stt/token (GM.md "Listening"): POST -> { token, expiresIn }, a short-lived Deepgram token for the table iPad's
// live connection (it only has to be valid while the connection opens). The Deepgram key is the Worker secret
// DEEPGRAM_API_KEY and is never sent anywhere but Deepgram. GM, or the table display sign-in; 403 for anyone else.
// 503 while the secret is unset; 502 when Deepgram refuses.

import { json, methodNotAllowed } from '../../_lib/http.js';
import { requireListener, grantToken } from '../../_lib/stt.js';

export async function onRequest({ request, env, data }) {
  requireListener(data, true);
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  return json(await grantToken(env, env && env.__fetch ? env.__fetch : fetch));
}
