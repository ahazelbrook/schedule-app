// The live-sync hub (MD1a): one Durable Object per campaign. It holds the GM's WebSockets and nothing else:
// no storage, no timers, no state beyond each socket's attachment. On connect it says {"hello":1}; it never
// sends anything more in this build (a poke, which carries only a kind and a time, arrives in MD1b as an RPC
// method). Hibernation API, so an idle hub costs nothing.
//
// Its own file, not worker/app.js: this imports cloudflare:workers, which node cannot load, and the checks
// import app.js. worker/index.js re-exports the class, the only place it is exported from.

import { DurableObject } from 'cloudflare:workers';

export class LiveHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // 'ping' -> 'pong' is answered by the runtime without waking the object
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // The upgrade and nothing else.
  async fetch(request) {
    if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, ['gm']);
    server.serializeAttachment({ role: 'gm' });
    server.send('{"hello":1}');
    return new Response(null, { status: 101, webSocket: client });
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
