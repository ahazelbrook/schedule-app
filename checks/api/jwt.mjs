// Unit check of the Cloudflare Access JWT verification in functions/_lib/auth.js,
// with a generated RSA key and a mocked JWKS endpoint. No server, no network.
//
//   node checks/api/jwt.mjs

import { verifyAccessJwt, identify, resetJwksCache, certsUrl, roleFor } from '../../functions/_lib/auth.js';
import { onRequest as middleware } from '../../functions/api/_middleware.js';

const subtle = globalThis.crypto.subtle;
const TEAM = 'blades-team';
const AUD = 'aud-tag-1234';
const ISS = 'https://' + TEAM + '.cloudflareaccess.com';

let passes = 0;
let failures = 0;
async function step(name, fn) {
  try {
    await fn();
    passes++;
    console.log('PASS ' + name);
  } catch (e) {
    failures++;
    console.log('FAIL ' + name + '\n     ' + (e && e.stack || e));
  }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
async function expectReject(p, reason) {
  try {
    await p;
  } catch (e) {
    expect(e.message === reason, 'expected "' + reason + '", got "' + e.message + '"');
    return;
  }
  throw new Error('expected rejection "' + reason + '", got success');
}

const b64url = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

async function newKey() {
  return subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  );
}
async function publicJwk(pair, kid) {
  const jwk = await subtle.exportKey('jwk', pair.publicKey);
  return { kid, kty: 'RSA', alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e };
}
async function sign(pair, kid, claims, headerExtra = {}) {
  const head = enc({ alg: 'RS256', kid, typ: 'JWT', ...headerExtra });
  const body = enc(claims);
  const sig = await subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(head + '.' + body));
  return head + '.' + body + '.' + b64url(new Uint8Array(sig));
}
const nowS = () => Math.floor(Date.now() / 1000);
function claims(extra = {}) {
  return {
    aud: [AUD], email: 'Player@Example.test', sub: 'sub-123', name: 'Pat Player',
    iss: ISS, iat: nowS() - 10, nbf: nowS() - 10, exp: nowS() + 3600, type: 'app', ...extra,
  };
}

// --- mocked JWKS endpoint -------------------------------------------------------------
let published = [];
let certFetches = 0;
let certsDown = false;   // Cloudflare's certs endpoint having a bad minute: 503
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url === certsUrl(TEAM)) {
    certFetches++;
    if (certsDown) return new Response('unavailable', { status: 503 });
    return new Response(JSON.stringify({ keys: published, public_cert: {}, public_certs: [] }), {
      headers: { 'content-type': 'application/json' },
    });
  }
  if (url.includes('cloudflareaccess.com')) return new Response('not found', { status: 404 });
  return realFetch(input, init);
};

const k1 = await newKey();
const k2 = await newKey();
const other = await newKey();
published = [await publicJwk(k1, 'k1')];
const opts = { team: TEAM, aud: AUD };

await step('valid token (aud array) verifies and returns claims', async () => {
  const c = await verifyAccessJwt(await sign(k1, 'k1', claims()), opts);
  expect(c.email === 'Player@Example.test' && c.sub === 'sub-123', JSON.stringify(c));
  expect(certFetches === 1, 'cert fetches ' + certFetches);
});

await step('valid token (aud string) verifies; JWKS served from cache', async () => {
  await verifyAccessJwt(await sign(k1, 'k1', claims({ aud: AUD })), opts);
  expect(certFetches === 1, 'cert fetches ' + certFetches);
});

await step('wrong aud is refused', async () => {
  await expectReject(verifyAccessJwt(await sign(k1, 'k1', claims({ aud: ['someone-else'] })), opts), 'wrong audience');
  await expectReject(verifyAccessJwt(await sign(k1, 'k1', claims({ aud: undefined })), opts), 'wrong audience');
});

await step('expired token is refused', async () => {
  await expectReject(verifyAccessJwt(await sign(k1, 'k1', claims({ exp: nowS() - 1 })), opts), 'expired');
  await expectReject(verifyAccessJwt(await sign(k1, 'k1', claims({ exp: undefined })), opts), 'expired');
});

await step('nbf in the future is refused', async () => {
  await expectReject(verifyAccessJwt(await sign(k1, 'k1', claims({ nbf: nowS() + 600 })), opts), 'not yet valid');
});

await step('wrong issuer is refused', async () => {
  await expectReject(
    verifyAccessJwt(await sign(k1, 'k1', claims({ iss: 'https://evil.cloudflareaccess.com' })), opts),
    'wrong issuer'
  );
});

await step('unknown kid is refused (no refetch storm right after a fetch)', async () => {
  const before = certFetches;
  await expectReject(verifyAccessJwt(await sign(k2, 'k2', claims()), opts), 'unknown kid');
  expect(certFetches === before, 'refetched within the gap');
});

await step('unknown kid refetches once and picks up a rotated key', async () => {
  published = [await publicJwk(k1, 'k1'), await publicJwk(k2, 'k2')];
  const before = certFetches;
  const c = await verifyAccessJwt(await sign(k2, 'k2', claims()), { ...opts, now: Date.now() + 15000 });
  expect(c.email, 'claims');
  expect(certFetches === before + 1, 'expected one refetch, got ' + (certFetches - before));
  const before2 = certFetches;
  await expectReject(verifyAccessJwt(await sign(k2, 'k3', claims()), { ...opts, now: Date.now() + 30000 }), 'unknown kid');
  expect(certFetches === before2 + 1, 'unknown kid should refetch exactly once, got ' + (certFetches - before2));
});

await step('JWKS cache expires after an hour', async () => {
  const before = certFetches;
  await verifyAccessJwt(await sign(k1, 'k1', claims({ exp: nowS() + 7200 })), { ...opts, now: Date.now() + 61 * 60 * 1000 });
  expect(certFetches === before + 1, 'expected a refetch, got ' + (certFetches - before));
});

await step('a failed refresh after the hour keeps the last good keys (nobody is signed out by it), retried after 10 s, not on every request', async () => {
  resetJwksCache();
  published = [await publicJwk(k1, 'k1')];
  const t0 = Date.now(), tok = await sign(k1, 'k1', claims({ exp: nowS() + 3 * 3600 }));
  await verifyAccessJwt(tok, { ...opts, now: t0 });
  certsDown = true;
  const before = certFetches, at = t0 + 61 * 60 * 1000;
  const c = await verifyAccessJwt(tok, { ...opts, now: at });
  expect(c.email === 'Player@Example.test', 'verified with the cached keys');
  expect(certFetches === before + 1, 'one refresh tried, got ' + (certFetches - before));
  await verifyAccessJwt(tok, { ...opts, now: at + 5000 });
  expect(certFetches === before + 1, 'no refetch inside the 10 s pause, got ' + (certFetches - before));
  await verifyAccessJwt(tok, { ...opts, now: at + 11000 });
  expect(certFetches === before + 2, 'tried again after the pause, got ' + (certFetches - before));
  // a kid the cached keys do not hold is never vouched for by them
  await expectReject(verifyAccessJwt(await sign(other, 'k9', claims({ exp: nowS() + 3 * 3600 })), { ...opts, now: at + 12000 }), 'unknown kid');
  expect(certFetches === before + 2, 'and inside the pause it fetches nothing');
  certsDown = false;
  await verifyAccessJwt(tok, { ...opts, now: at + 25000 });
  expect(certFetches === before + 3, 'refreshed as soon as the endpoint answers, got ' + (certFetches - before));
  await verifyAccessJwt(tok, { ...opts, now: at + 26000 });
  expect(certFetches === before + 3, 'and fresh again: served from the cache');
});

await step('the last good keys serve for at most a day past their hour; with none cached a failed fetch is refused', async () => {
  resetJwksCache();
  const t0 = Date.now(), tok = await sign(k1, 'k1', claims({ exp: nowS() + 30 * 3600 }));
  await verifyAccessJwt(tok, { ...opts, now: t0 });
  certsDown = true;
  await verifyAccessJwt(tok, { ...opts, now: t0 + 24 * 3600 * 1000 });   // 23 h past the hour: still served
  await expectReject(verifyAccessJwt(tok, { ...opts, now: t0 + 25 * 3600 * 1000 + 60000 }), 'certs fetch failed: 503');
  await expectReject(verifyAccessJwt(tok, { ...opts, now: t0 + 25 * 3600 * 1000 + 65000 }), 'certs fetch failed: no fresh keys');   // inside the pause
  resetJwksCache();
  await expectReject(verifyAccessJwt(tok, opts), 'certs fetch failed: 503');
  certsDown = false;
  resetJwksCache();
});

await step('garbage is refused', async () => {
  resetJwksCache();
  await expectReject(verifyAccessJwt('garbage', opts), 'malformed token');
  await expectReject(verifyAccessJwt('a.b.c', opts), 'malformed token');
  await expectReject(verifyAccessJwt('', opts), 'malformed token');
  await expectReject(verifyAccessJwt('a.b.c.d', opts), 'malformed token');
  await expectReject(verifyAccessJwt(enc({ alg: 'none', kid: 'k1' }) + '.' + enc(claims()) + '.', opts), 'unsupported alg');
  await expectReject(verifyAccessJwt(await sign(k1, 'k1', claims(), { alg: 'HS256' }), opts), 'unsupported alg');
  // right kid, signed with a different key
  await expectReject(verifyAccessJwt(await sign(other, 'k1', claims()), opts), 'bad signature');
  // tampered payload
  const good = await sign(k1, 'k1', claims());
  const [h, , s] = good.split('.');
  await expectReject(verifyAccessJwt(h + '.' + enc(claims({ email: 'gm@example.test' })) + '.' + s, opts), 'bad signature');
  // no email claim
  await expectReject(verifyAccessJwt(await sign(k1, 'k1', claims({ email: undefined })), opts), 'no email');
});

await step('not configured (no ACCESS_TEAM / ACCESS_AUD) refuses', async () => {
  await expectReject(verifyAccessJwt(await sign(k1, 'k1', claims()), { team: TEAM }), 'access not configured');
});

const env = { ACCESS_TEAM: TEAM, ACCESS_AUD: AUD, GM_EMAILS: ' GM@example.test , other@example.test' };
const req = (headers) => new Request('https://app.example.test/api/me', { headers });

await step('identify(): Access token -> lower-cased email id, name, sub, role', async () => {
  const { me } = await identify(req({ 'Cf-Access-Jwt-Assertion': await sign(k1, 'k1', claims()) }), env);
  expect(me && me.id === 'player@example.test' && me.email === me.id, JSON.stringify(me));
  expect(me.name === 'Pat Player' && me.sub === 'sub-123' && me.role === 'player', JSON.stringify(me));
  const gm = await identify(req({ 'Cf-Access-Jwt-Assertion': await sign(k1, 'k1', claims({ email: 'gm@EXAMPLE.test', name: undefined })) }), env);
  expect(gm.me && gm.me.role === 'gm' && gm.me.name === 'gm', JSON.stringify(gm.me));
});

await step('identify(): bad token -> null even with DEV_USER set', async () => {
  const r = await identify(req({ 'Cf-Access-Jwt-Assertion': 'garbage' }), { ...env, DEV_USER: 'dev@example.test' });
  expect(r.me === null, JSON.stringify(r));
});

await step('identify(): DEV_USER and X-Dev-User only in development', async () => {
  const a = await identify(req({}), { ...env, DEV_USER: 'GM@example.test' });
  expect(a.me && a.me.id === 'gm@example.test' && a.me.role === 'gm', JSON.stringify(a.me));
  const b = await identify(req({ 'X-Dev-User': 'p2@example.test' }), { ...env, DEV_USER: 'gm@example.test' });
  expect(b.me && b.me.id === 'p2@example.test' && b.me.role === 'player', JSON.stringify(b.me));
  const c = await identify(req({ 'X-Dev-User': 'gm@example.test' }), env);
  expect(c.me === null, 'X-Dev-User must be ignored without DEV_USER');
  const d = await identify(req({}), env);
  expect(d.me === null, 'no token, no DEV_USER');
});

await step('roleFor(): GM_EMAILS is comma-separated and case-insensitive', async () => {
  expect(roleFor('Other@Example.Test', env.GM_EMAILS) === 'gm', 'other');
  expect(roleFor('x@example.test', env.GM_EMAILS) === 'player', 'x');
  expect(roleFor('x@example.test', undefined) === 'player', 'unset');
});

await step('middleware: 401 JSON + no-store without identity; sets data.me otherwise', async () => {
  const ctx = (headers, e) => ({ request: req(headers), env: e, data: {}, next: async () => new Response('{"ok":1}') });
  const c1 = ctx({}, env);
  const r1 = await middleware(c1);
  expect(r1.status === 401, 'status ' + r1.status);
  const b1 = await r1.json();
  expect(b1.error === 'not signed in' && b1.reason === 'no token', 'body ' + JSON.stringify(b1));
  expect(r1.headers.get('cache-control') === 'no-store', 'no-store');
  // a token the check refuses: the 401 names the reason (a fixed phrase), never the token
  const bad = await sign(k1, 'k1', claims({ aud: ['someone-else'] }));
  const rb = await middleware(ctx({ 'Cf-Access-Jwt-Assertion': bad }, env));
  const bb = await rb.json();
  expect(rb.status === 401 && bb.reason === 'wrong audience' && !JSON.stringify(bb).includes(bad.slice(0, 20)), 'reason ' + JSON.stringify(bb));
  const c2 = ctx({ 'Cf-Access-Jwt-Assertion': await sign(k1, 'k1', claims()) }, env);
  const r2 = await middleware(c2);
  expect(r2.status === 200 && r2.headers.get('cache-control') === 'no-store', 'status ' + r2.status);
  expect(c2.data.me && c2.data.me.id === 'player@example.test', JSON.stringify(c2.data.me));
});

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
