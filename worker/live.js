// The live-sync hub (MD1a, MD1b): one Durable Object per campaign. It holds the WebSockets of every role and nothing else:
// no storage, no timers, no state beyond each socket's attachment (its role). On connect it says {"hello":1}. A poke arrives as
// an RPC method (stub.poke(kind), never a route) and goes out as {"k":kind,"t":ms} to the sockets whose role may hear that kind
// (functions/_lib/live.js KINDS): a poke carries a kind and a time, never data. Hibernation API, so an idle hub costs nothing.
//
// Its own file, not worker/app.js: this imports cloudflare:workers, which node cannot load, and the checks
// import app.js. worker/index.js re-exports the class, the only place it is exported from.

import { DurableObject } from 'cloudflare:workers';
import { ROLES, ROLE_HEADER, rolesFor } from '../functions/_lib/live.js';

export class LiveHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // 'ping' -> 'pong' is answered by the runtime without waking the object
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // The upgrade and nothing else. The role comes from the header the route sets from the signed-in caller (it overwrites any
  // client-sent one); an unknown role is refused. It is the socket's tag (a poke finds its sockets by tag) and its attachment.
  async fetch(request) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket', { status: 426 });
    }
    const role = request.headers.get(ROLE_HEADER) || '';
    if (!ROLES.includes(role)) return new Response('unknown role', { status: 400 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role });
    server.send('{"hello":1}');
    return new Response(null, { status: 101, webSocket: client });
  }

  // A poke (RPC): { k, t } to every socket whose role hears this kind. A send that throws (a socket closing) never stops the rest.
  // Returns how many sockets it went to (the checks read it; the Worker ignores it).
  poke(kind) {
    const roles = rolesFor(kind);
    if (!roles.length) return 0;
    const msg = JSON.stringify({ k: kind, t: Date.now() });
    let sent = 0;
    for (const role of roles) {
      for (const ws of this.ctx.getWebSockets(role)) {
        try { ws.send(msg); sent++; } catch (_) {}
      }
    }
    return sent;
  }

  // Nothing is read from a client.
  webSocketMessage(_ws, _message) {}

  // Close with 1000: echoing the incoming code throws for 1005, 1006 and 1015, which cannot be sent.
  webSocketClose(ws, _code, _reason, _wasClean) {
    try { ws.close(1000, 'bye'); } catch (_) {}
  }

  webSocketError(ws, _error) {
    try { ws.close(1000, 'error'); } catch (_) {}
  }
}
