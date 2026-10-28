// GET /api/live: the live-sync socket (design 2.5). Every signed-in role may open it (the GM, a player, the table display): the
// middleware has resolved the caller first (no token is 401 before this runs), and the display role is let through by its
// allow-list (auth.js DISPLAY_ALLOWED, and this file in the middleware's DISPLAY_FUNCTIONS). A request that is not a WebSocket
// upgrade is 426. Otherwise the request goes to the campaign's LiveHub Durable Object (worker/live.js) as a fresh request that
// carries the caller's role in a header this route sets itself (a client-sent one is never forwarded). The role becomes the
// socket's tag and attachment, and the socket hears only the kinds its role may (functions/_lib/live.js KINDS).
//
// The switch (the GM state document's `live`, off by an explicit false): while it is off no socket is opened (503), so a page
// that reconnects under it stays on its poll. One small read, only here.
//
// No cloudflare:workers import here: node loads this file through worker/app.js in the checks.

import { getDb } from '../_lib/db.js';
import { campaignOf } from '../_lib/http.js';
import { ROLES, ROLE_HEADER, liveFlag } from '../_lib/live.js';

export async function onRequest({ request, env, data }) {
  const role = data && data.me && data.me.role;
  if (!ROLES.includes(role)) return new Response('forbidden', { status: 403 });
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
    return new Response('expected a WebSocket upgrade', { status: 426, headers: { Upgrade: 'websocket' } });
  }
  if (!env || !env.LIVE) return new Response('live sync is not available', { status: 503 });
  const campaign = campaignOf(env);
  if (!(await liveFlag(await getDb(env), campaign))) return new Response('live sync is switched off', { status: 503 });
  // a new request, not the caller's: the object needs only the upgrade and the role, and the role is the signed-in caller's
  const stub = env.LIVE.get(env.LIVE.idFromName(campaign));
  return stub.fetch(new Request(request.url, { method: 'GET', headers: { Upgrade: 'websocket', Connection: 'Upgrade', [ROLE_HEADER]: role } }));
}
