#!/usr/bin/env node
// A live check of the table iPad's transcriber path (GM.md "Listening"), run once on the GM's PC after the Deepgram key is
// set: mint a short-lived token the way the Worker does, then open Deepgram's live WebSocket the way the iPad does
// (the token as a subprotocol pair, 'bearer' then 'token'), send a second of silence, and say which worked.
//   DEEPGRAM_API_KEY=<key> node scripts/stt-check.mjs        (PowerShell: $env:DEEPGRAM_API_KEY='<key>'; npm run check:stt-live)
// Costs a few seconds of Deepgram streaming. Prints no key and no token.
import { grantToken } from '../functions/_lib/stt.js';
import stt from '../app/stt.js';

const key = process.env.DEEPGRAM_API_KEY;
if (!key) { console.error('set DEEPGRAM_API_KEY first (it is not stored anywhere by this check)'); process.exit(2); }
if (typeof WebSocket !== 'function') { console.error('this node has no WebSocket (node 22 or later)'); process.exit(2); }

function tryScheme(scheme) {
  return grantToken({ DEEPGRAM_API_KEY: key }).then(({ token }) => new Promise((resolve) => {
    let opened = false;
    const ws = new WebSocket(stt.DG_URL, [scheme, token]);
    const done = (ok, why) => { try { ws.close(); } catch (_) {} resolve({ scheme, ok, why, protocol: ws.protocol }); };
    const timer = setTimeout(() => done(opened, opened ? 'open' : 'timed out'), 6000);
    ws.onopen = () => { opened = true; ws.send(new Int16Array(16000).buffer); ws.send(JSON.stringify({ type: 'CloseStream' })); };
    ws.onmessage = () => { clearTimeout(timer); done(true, 'open, and Deepgram answered'); };
    ws.onclose = (ev) => { clearTimeout(timer); done(opened, opened ? 'open, closed ' + ev.code : 'refused (' + ev.code + (ev.reason ? ' ' + ev.reason : '') + ')'); };
    ws.onerror = () => {};
  }));
}

try {
  const results = [];
  for (const s of stt.SCHEMES) results.push(await tryScheme(s));
  for (const r of results) console.log((r.ok ? 'WORKS  ' : 'FAILS  ') + r.scheme.padEnd(7) + r.why + (r.protocol ? ' · protocol ' + r.protocol : ''));
  const good = results.find((r) => r.ok);
  console.log(good ? '\nThe iPad will use "' + good.scheme + '".' : '\nNeither worked: the iPad cannot connect. Check the key (Member permission or above).');
  process.exit(good ? 0 : 1);
} catch (e) { console.error('the token was refused: ' + (e && e.message || e)); process.exit(1); }
