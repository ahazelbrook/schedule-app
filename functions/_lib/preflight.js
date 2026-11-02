// 4.2 Preflight (switch room.preflight): the Worker's half. READ-ONLY and free: it reads, it pings, it never writes and never calls anything paid
// (no Anthropic, no Deepgram transcription, no Deepgram token). Plain ES with no Cloudflare imports, so node can load it.
//
//   accessExpiry(token)        -> ISO time | null     the sign-in token's `exp` claim. The middleware already verified the token before any handler ran;
//                                                      this only reads the claim to say how long the session has left. No token (local dev): null.
//   pingDeepgram(fetchFn, ms)  -> { reachable, ms }   an unauthenticated GET to Deepgram's API host: ANY HTTP answer (a 401 is the expected one)
//                                                      means the host is reachable from the Worker; nothing is sent to be transcribed, no key is sent.
//   preflightFacts(...)        -> the answer of GET /api/gm/preflight

import { loadStt } from './stt.js';
import { packHeads, packVersion } from './gm.js';

export const DEEPGRAM_PING = 'https://api.deepgram.com/v1/projects';
export const PING_MS = 3000;

export function accessExpiry(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)));
    return claims && typeof claims.exp === 'number' ? new Date(claims.exp * 1000).toISOString() : null;
  } catch (_) { return null; }
}

export async function pingDeepgram(fetchFn, timeoutMs = PING_MS) {
  const t0 = Date.now();
  try {
    const res = await fetchFn(DEEPGRAM_PING, { method: 'GET', signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined });
    return { reachable: !!res && typeof res.status === 'number', ms: Date.now() - t0 };
  } catch (_) { return { reachable: false, ms: Date.now() - t0 }; }
}

export async function preflightFacts({ db, env, campaign, request, fetchFn }) {
  const keySet = !!(env && typeof env.DEEPGRAM_API_KEY === 'string' && env.DEEPGRAM_API_KEY.trim());
  const [heads, stt, dg] = await Promise.all([packHeads(db, campaign), loadStt(db, campaign), keySet ? pingDeepgram(fetchFn) : Promise.resolve({ reachable: null, ms: 0 })]);
  const d = stt.doc && stt.doc.status && stt.doc.status.device;
  return {
    now: Date.now(),
    access: { expiresAt: accessExpiry(request.headers.get('Cf-Access-Jwt-Assertion')) },
    deepgram: { keySet, reachable: dg.reachable, ms: dg.ms },
    pack: { version: await packVersion(heads), parts: heads.length },
    device: d ? { ...d, at: stt.doc.status.at || '' } : null,
  };
}
