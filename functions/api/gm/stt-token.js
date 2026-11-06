// /api/gm/stt/token (GM.md "Listening"): POST -> { token, expiresIn }, a short-lived Deepgram token for the table iPad's
// live connection (it only has to be valid while the connection opens). The Deepgram key is the Worker secret
// DEEPGRAM_API_KEY and is never sent anywhere but Deepgram. GM, or the table display sign-in; 403 for anyone else.
// 503 while the secret is unset; 502 when Deepgram refuses.
// A1 (ai.keyterms): the answer also carries `keyterms`, the names the stream should listen for (functions/_lib/keyterms.js: revealed NPCs only).
// N0: everything built is on, so the line is read through the registry (Features.valueOf), which says ON whatever the GM state holds.

import { json, methodNotAllowed, campaignOf } from '../../_lib/http.js';
import { requireListener, grantToken } from '../../_lib/stt.js';
import { getDb } from '../../_lib/db.js';
import { loadState, loadPartBody } from '../../_lib/gm.js';
import { listNpcs } from '../../_lib/npcs.js';
import { buildKeyterms } from '../../_lib/keyterms.js';
import Features from '../../_lib/features.js';

export async function onRequest({ request, env, data }) {
  requireListener(data, true);
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  const out = await grantToken(env, env && env.__fetch ? env.__fetch : fetch);
  let keyterms = null;
  try {
    const db = await getDb(env), campaign = campaignOf(env);
    const { doc } = await loadState(db, campaign);
    if (Features.valueOf(doc, 'ai.keyterms')) {
      const camp = await loadPartBody(db, campaign, 'campaign');
      const npcs = await listNpcs(db, campaign, { role: 'player' });      // the player's view: revealed rows only
      keyterms = buildKeyterms(camp, npcs.map((n) => n.doc));
    }
  } catch (_) { keyterms = null; }          // key terms are a help, never a reason the stream will not open
  return json(keyterms ? { ...out, keyterms } : out);
}
