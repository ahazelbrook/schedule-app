// Small helpers shared by the API handlers.

export const MAX_BODY_BYTES = 256 * 1024;
export const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

export function error(status, message, headers) {
  return json({ error: message }, status, headers);
}

export function methodNotAllowed(allowed) {
  return error(405, 'method not allowed', { Allow: allowed.join(', ') });
}

export function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
}

// Read the request body as a JSON object, refusing anything over MAX_BODY_BYTES.
export async function readJsonObject(request) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
  const buf = await request.arrayBuffer();
  if (buf.byteLength > MAX_BODY_BYTES) throw new HttpError(413, 'body too large');
  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(buf));
  } catch (_) {
    throw new HttpError(400, 'body must be JSON');
  }
  if (!isPlainObject(body)) throw new HttpError(400, 'body must be a JSON object');
  return body;
}

// RFC 7396-style merge: plain objects merge recursively, arrays and scalars replace,
// null deletes the key. Returns a new object; neither input is modified.
export function deepMerge(target, patch) {
  if (!isPlainObject(patch)) return patch;
  const out = isPlainObject(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__') continue;
    if (v === null) delete out[k];
    else if (isPlainObject(v)) out[k] = deepMerge(out[k], v);
    else out[k] = v;
  }
  return out;
}

// Server time as ISO, strictly after `after` (an ISO string) when given, so each write
// moves a row's updated_at forward even within the same millisecond.
export function nowIso(after) {
  let t = Date.now();
  const prev = after ? Date.parse(after) : NaN;
  if (Number.isFinite(prev) && t <= prev) t = prev + 1;
  return new Date(t).toISOString();
}

export function campaignOf(env) {
  return (env && typeof env.CAMPAIGN === 'string' && env.CAMPAIGN.trim()) || 'default';
}
