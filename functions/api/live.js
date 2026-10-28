// GET /api/live (GM only): the live-sync socket (MD1a). The caller is checked as for every API call (the middleware
// resolves them and turns the display role away first), then a non-GM is 403 BEFORE the upgrade header is looked at;
// a GM request that is not a WebSocket upgrade is 426; otherwise the request goes to the campaign's LiveHub
// Durable Object (worker/live.js), which answers the upgrade with {"hello":1}. Nothing opens this socket yet.
//
// No cloudflare:workers import here: node loads this file through worker/app.js in the checks.

import { requireGm } from '../_lib/gm.js';
import { campaignOf } from '../_lib/http.js';

export async function onRequest({ request, env, data }) {
  requireGm(data);
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
    return new Response('expected a WebSocket upgrade', { status: 426, headers: { Upgrade: 'websocket' } });
  }
  if (!env || !env.LIVE) return new Response('live sync is not available', { status: 503 });
  const stub = env.LIVE.get(env.LIVE.idFromName(campaignOf(env)));
  return stub.fetch(request);
}
