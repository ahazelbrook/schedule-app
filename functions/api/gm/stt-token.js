// /api/gm/stt/token (GM.md "Listening"): POST -> { token, expiresIn }, a short-lived Deepgram token for the table iPad's
// live connection (it only has to be valid while the connection opens). The Deepgram key is the Worker secret
// DEEPGRAM_API_KEY and is never sent anywhere but Deepgram. GM, or the table display sign-in; 403 for anyone else.
// 503 while the secret is unset; 502 when Deepgram refuses.
// A1 (switch ai.keyterms, in the GM state's `features`): the answer also carries `keyterms`, the names the stream should listen for
// (functions/_lib/keyterms.js: revealed NPCs only). Switch off: the answer is exactly { token, expiresIn }, and nothing extra is read.

import { json, methodNotAllowed, campaignOf } from '../../_lib/http.js';
import { requireListener, grantToken } from '../../_lib/stt.js';
import { getDb } from '../../_lib/db.js';
import { loadState, parseJson } from '../../_lib/gm.js';
import { listNpcs } from '../../_lib/npcs.js';
import { buildKeyterms } from '../../_lib/keyterms.js';

export async function onRequest({ request, env, data }) {
  requireListener(data, true);
  if (request.method !== 'POST') return methodNotAllowed(['POST']);
  const out = await grantToken(env, env && env.__fetch ? env.__fetch : fetch);
  let keyterms = null;
  try {
    const db = await getDb(env), campaign = campaignOf(env);
    const { doc } = await loadState(db, campaign);
    if (doc.features && doc.features['ai.keyterms'] === true) {
      const row = await db.prepare('SELECT body FROM gm_pack WHERE campaign = ?1 AND part = ?2').bind(campaign, 'campaign').first();
      const npcs = await listNpcs(db, campaign, { role: 'player' });      // the player's view: revealed rows only
      keyterms = buildKeyterms(row ? parseJson(row.body, null) : null, npcs.map((n) => n.doc));
    }
  } catch (_) { keyterms = null; }          // key terms are a help, never a reason the stream will not open
  return json(keyterms ? { ...out, keyterms } : out);
}
