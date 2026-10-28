// Runs before every /api/* handler: resolves the caller (Cloudflare Access JWT, or
// DEV_USER in development), turns thrown errors into JSON, and marks every API response
// Cache-Control: no-store.
//
// The table display role (DISPLAY_EMAILS, GM.md) is an allow-list enforced here, before any handler runs: only
// GET /api/me, GET /api/gm/display and the transcriber's calls (DISPLAY_ALLOWED in auth.js) pass; everything else, unknown paths included, is 403 before the body is read or
// the database touched. A route added later is denied to the display by default.

import { identify, displayMayCall, DISPLAY_ONLY } from '../_lib/auth.js';
import { HttpError, error, json } from '../_lib/http.js';

function noStore(res) {
  // a WebSocket upgrade (101) carries the socket on the response: never touch it, never copy it
  if (res.status === 101) return res;
  try {
    res.headers.set('Cache-Control', 'no-store');
    return res;
  } catch (_) {
    // immutable headers (e.g. a fetched response): copy
    const copy = new Response(res.body, res);
    copy.headers.set('Cache-Control', 'no-store');
    return copy;
  }
}

// The worker's router (worker/app.js) also names the route it matched: when it does, it must be one of these as well.
const DISPLAY_FUNCTIONS = new Set(['/api/me', '/api/gm/display', '/api/gm/stt', '/api/gm/stt/token', '/api/gm/transcript']);
function displayAllowed(context) {
  const { request } = context;
  let pathname;
  try { pathname = new URL(request.url).pathname; } catch (_) { return false; }
  if (!displayMayCall(request.method, pathname)) return false;
  return context.functionPath === undefined || DISPLAY_FUNCTIONS.has(context.functionPath);
}

export async function onRequest(context) {
  const { request, env } = context;
  let res;
  try {
    const { me, reason } = await identify(request, env);
    if (!me) {
      if (reason && reason !== 'no token') console.warn('api: not signed in:', reason);
      // The reason is a short fixed phrase from the token check (expired, wrong audience, no token...), never the token
      // itself. It reaches only callers Access let through, and the page shows it so a sign-in that will not stick can be
      // told apart from a session that ended.
      res = json({ error: 'not signed in', reason: String(reason || 'no token').slice(0, 60) }, 401);
    } else if (me.role === 'display' && !displayAllowed(context)) {
      res = error(403, DISPLAY_ONLY);
    } else {
      context.data.me = me;
      res = await context.next();
    }
  } catch (e) {
    if (e instanceof HttpError) {
      res = error(e.status, e.message);
    } else {
      console.error('api error', e && e.stack || e);
      res = error(500, 'server error');
    }
  }
  return noStore(res);
}
