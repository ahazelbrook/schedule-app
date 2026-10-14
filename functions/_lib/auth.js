// Identity for the hosted build (see HOSTING.md, "Identity").
//
// Plain ES module with no Cloudflare-specific imports: it only uses WebCrypto,
// fetch, atob and TextEncoder, so node (>= 20) can import it for checks/api/jwt.mjs.

const JWKS_TTL_MS = 60 * 60 * 1000; // one hour
const JWKS_REFETCH_GAP_MS = 10 * 1000; // an unknown kid triggers at most one refetch per 10 s
const NBF_LEEWAY_S = 60; // tolerate a little clock skew on nbf / iat

// Module-level cache, one per isolate: team -> { keys: Map(kid -> CryptoKey), fetchedAt }
const jwksCache = new Map();

export function resetJwksCache() {
  jwksCache.clear();
}

export function certsUrl(team) {
  return 'https://' + team + '.cloudflareaccess.com/cdn-cgi/access/certs';
}

export function issuerFor(team) {
  return 'https://' + team + '.cloudflareaccess.com';
}

function b64urlToBytes(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad base64url');
  let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

async function fetchJwks(team, now) {
  const res = await fetch(certsUrl(team), { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('certs fetch failed: ' + res.status);
  const body = await res.json();
  const keys = new Map();
  for (const jwk of (body && Array.isArray(body.keys)) ? body.keys : []) {
    if (!jwk || jwk.kty !== 'RSA' || !jwk.kid || !jwk.n || !jwk.e) continue;
    if (jwk.use && jwk.use !== 'sig') continue;
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
      );
      keys.set(jwk.kid, key);
    } catch (_) { /* skip keys we cannot import */ }
  }
  const entry = { keys, fetchedAt: now };
  jwksCache.set(team, entry);
  return entry;
}

async function keyFor(team, kid, now) {
  let entry = jwksCache.get(team);
  if (!entry || now - entry.fetchedAt > JWKS_TTL_MS) entry = await fetchJwks(team, now);
  let key = entry.keys.get(kid);
  if (!key && now - entry.fetchedAt > JWKS_REFETCH_GAP_MS) {
    entry = await fetchJwks(team, now); // keys may have rotated: refetch once
    key = entry.keys.get(kid);
  }
  return key || null;
}

/**
 * Verify a Cloudflare Access JWT (RS256).
 * @param {string} token  the Cf-Access-Jwt-Assertion header
 * @param {{ team: string, aud: string, now?: number }} opts  now in ms (tests)
 * @returns {Promise<object>} the claims; throws an Error with a short reason otherwise
 */
export async function verifyAccessJwt(token, opts) {
  const team = opts && opts.team;
  const aud = opts && opts.aud;
  const now = (opts && typeof opts.now === 'number') ? opts.now : Date.now();
  if (!team || !aud) throw new Error('access not configured');
  if (typeof token !== 'string') throw new Error('missing token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed token');

  let header, claims, sig;
  try {
    header = b64urlJson(parts[0]);
    claims = b64urlJson(parts[1]);
    sig = b64urlToBytes(parts[2]);
  } catch (_) {
    throw new Error('malformed token');
  }
  if (!header || header.alg !== 'RS256') throw new Error('unsupported alg');
  if (!header.kid) throw new Error('missing kid');
  if (!claims || typeof claims !== 'object') throw new Error('malformed claims');

  const key = await keyFor(team, header.kid, now);
  if (!key) throw new Error('unknown kid');
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    sig,
    new TextEncoder().encode(parts[0] + '.' + parts[1])
  );
  if (!ok) throw new Error('bad signature');

  const nowS = Math.floor(now / 1000);
  if (claims.iss !== issuerFor(team)) throw new Error('wrong issuer');
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(aud)) throw new Error('wrong audience');
  if (typeof claims.exp !== 'number' || claims.exp <= nowS) throw new Error('expired');
  if (typeof claims.nbf === 'number' && claims.nbf > nowS + NBF_LEEWAY_S) throw new Error('not yet valid');
  if (typeof claims.email !== 'string' || !claims.email.includes('@')) throw new Error('no email');
  return claims;
}

export function parseList(s) {
  return String(s || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
}

/**
 * The caller's role: 'gm' (in GM_EMAILS), 'display' (in DISPLAY_EMAILS: the table's iPad, see GM.md "The display
 * sign-in") or 'player' (anyone else Access lets in). GM wins when an email is in both lists. With DISPLAY_EMAILS
 * unset nobody is 'display', so the role ships inert.
 */
export function roleFor(email, gmEmails, displayEmails) {
  const e = String(email || '').toLowerCase();
  if (parseList(gmEmails).includes(e)) return 'gm';
  if (parseList(displayEmails).includes(e)) return 'display';
  return 'player';
}

// ---------- the display role: an allow-list, applied by functions/api/_middleware.js before any handler ----------
// The table display may read itself and its own identity, nothing else. Every other method and path (other /api/gm/*
// routes, the campaign, characters, NPCs, rules, members, export, unknown paths) is 403 with the same message, before
// the body is read or the database touched, so the display cannot tell which routes exist. A route added later is
// refused by default. The patterns are the router's own (worker/app.js ROUTES: an optional trailing slash).
export const DISPLAY_ONLY = 'this is the table display sign-in: it can only show the display';
export const DISPLAY_ALLOWED = [
  { method: 'GET', re: /^\/api\/me\/?$/ },
  { method: 'GET', re: /^\/api\/gm\/display\/?$/ },
];

/** true when the display role may make this call (method and the raw URL pathname, as the router matches it). */
export function displayMayCall(method, pathname) {
  return DISPLAY_ALLOWED.some((a) => a.method === method && a.re.test(String(pathname || '')));
}

function displayName(name, email) {
  if (typeof name === 'string' && name.trim()) return name.trim().slice(0, 200);
  return String(email).split('@')[0];
}

function looksLikeEmail(s) {
  return typeof s === 'string' && s.length <= 254 && /^[^\s@,]+@[^\s@,]+$/.test(s.trim());
}

/**
 * Resolve the caller from a request and the environment.
 * @returns {Promise<{ me: object|null, reason?: string }>}
 */
export async function identify(request, env) {
  env = env || {};
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (token) {
    try {
      const claims = await verifyAccessJwt(token, { team: env.ACCESS_TEAM, aud: env.ACCESS_AUD });
      const email = claims.email.trim().toLowerCase();
      return {
        me: {
          id: email,
          email,
          name: displayName(claims.name, email),
          sub: claims.sub || null,
          role: roleFor(email, env.GM_EMAILS, env.DISPLAY_EMAILS),
        },
      };
    } catch (e) {
      return { me: null, reason: e && e.message };
    }
  }
  if (env.DEV_USER) {
    // Development only: the X-Dev-User header is honoured only when DEV_USER is set.
    const override = request.headers.get('X-Dev-User');
    const raw = looksLikeEmail(override) ? override : env.DEV_USER;
    if (!looksLikeEmail(raw)) return { me: null, reason: 'DEV_USER is not an email' };
    const email = raw.trim().toLowerCase();
    return {
      me: { id: email, email, name: displayName(null, email), sub: 'dev:' + email, role: roleFor(email, env.GM_EMAILS, env.DISPLAY_EMAILS) },
    };
  }
  return { me: null, reason: 'no token' };
}
