// Runs before every /api/* handler: resolves the caller (Cloudflare Access JWT, or
// DEV_USER in development), turns thrown errors into JSON, and marks every API response
// Cache-Control: no-store.

import { identify } from '../_lib/auth.js';
import { HttpError, error } from '../_lib/http.js';

function noStore(res) {
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

export async function onRequest(context) {
  const { request, env } = context;
  let res;
  try {
    const { me, reason } = await identify(request, env);
    if (!me) {
      if (reason && reason !== 'no token') console.warn('api: not signed in:', reason);
      res = error(401, 'not signed in');
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
