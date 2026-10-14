// The GM tools' storage and validation (see GM.md): the GM pack (the generators' tables, imported by the GM from
// their own PC, never in git), the GM state document and the display the iPad shows. Everything here is GM only:
// every /api/gm/* handler calls requireGm() before it reads the body or touches the database.
//
// Plain ES module with no Cloudflare-specific imports (WebCrypto and TextEncoder only), so node can import it.

import { HttpError, ID_RE, MAX_BODY_BYTES, isPlainObject, deepMerge, nowIso, error } from './http.js';

export const GM_ONLY = 'only the GM can use the GM tools';

const KiB = 1024;
export const LIMITS = {
  partBody: 900 * KiB,          // bytes of JSON in one stored pack part
  parts: 12,                    // parts in one campaign's pack
  request: 900 * KiB + 16 * KiB, // one POST /api/gm/pack (the part, its src and the JSON around them)
  src: 2 * KiB,                 // bytes of JSON in a part's `src`
  state: MAX_BODY_BYTES,        // 256 KiB: the stored state document, and one PATCH body
  svg: 600 * KiB,               // bytes of a display svg
  displayRequest: 1280 * KiB,   // one PUT /api/gm/display (an svg's quotes double when JSON-escaped)
  text: 2000,                   // characters of a display title, caption or text
};

export const PART_RE = /^[a-z0-9-]{1,32}$/;
export const DISPLAY_KINDS = ['blank', 'svg', 'npc', 'text'];

/** 403 unless the caller is the GM. Call it first, before the method check and before the body is read. */
export function requireGm(data) {
  if (!data || !data.me || data.me.role !== 'gm') throw new HttpError(403, GM_ONLY);
}

/** Any other /api/gm/* path: 403 for a player (nothing about the GM tools is revealed), 404 for the GM. */
export function gmNotFound({ data }) {
  requireGm(data);
  return error(404, 'not found');
}

const enc = new TextEncoder();
export const byteLength = (s) => enc.encode(s).byteLength;

/** A short deterministic hash of a text: the first 12 hex digits of its SHA-256. */
export async function shortHash(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  let out = '';
  for (let i = 0; i < 6; i++) out += d[i].toString(16).padStart(2, '0');
  return out;
}

/** A JSON response whose body is pre-built text (a stored part is sent as it is stored, without a parse). */
export function jsonText(text, status = 200) {
  return new Response(text, {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

// ---------- the pack ----------

export function checkPart(name, where = 'part') {
  if (typeof name !== 'string' || !PART_RE.test(name)) throw new HttpError(400, where + ' must be 1 to 32 of a-z, 0-9 and -');
  return name;
}

/**
 * Validate one POST /api/gm/pack body into what is stored: { part, src (JSON text), body (JSON text), bytes }.
 * `body` is a JSON object, or a string holding one; anything else is 400. Over the caps is 413.
 */
export function cleanPart(raw) {
  const part = checkPart(raw.part);
  let body = raw.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { throw new HttpError(400, 'body must be valid JSON'); }
  }
  if (!isPlainObject(body)) throw new HttpError(400, 'body must be a JSON object');
  const text = JSON.stringify(body);
  const bytes = byteLength(text);
  if (bytes > LIMITS.partBody) throw new HttpError(413, 'part ' + part + ' is too large (' + bytes + ' bytes, at most ' + LIMITS.partBody + ')');
  const s = raw.src === undefined || raw.src === null ? {} : raw.src;
  if (!isPlainObject(s)) throw new HttpError(400, 'src must be an object');
  const src = JSON.stringify(s);
  if (byteLength(src) > LIMITS.src) throw new HttpError(413, 'src is too large (at most ' + LIMITS.src + ' bytes)');
  return { part, src, body: text, bytes };
}

export function parseJson(text, fallback) {
  try { const v = JSON.parse(text); return v === undefined ? fallback : v; } catch (_) { return fallback; }
}

/** Every part's head (no bodies), by name: [{ part, version, src, updated_at, bytes }]. */
export async function packHeads(db, campaign) {
  const { results } = await db
    .prepare('SELECT part, version, src, updated_at, LENGTH(CAST(body AS BLOB)) AS bytes FROM gm_pack WHERE campaign = ?1 ORDER BY part')
    .bind(campaign)
    .all();
  return results || [];
}

/** The pack's version: changes whenever any part's body or src does ('0' when the pack is empty). */
export async function packVersion(heads) {
  if (!heads.length) return '0';
  return shortHash(heads.map((h) => h.part + ':' + h.version + ':' + h.src).join('\n'));
}

export async function packIndex(db, campaign) {
  const heads = await packHeads(db, campaign);
  const parts = {};
  heads.forEach((h) => {
    parts[h.part] = { version: h.version, src: parseJson(h.src, {}), updatedAt: new Date(h.updated_at).toISOString(), bytes: h.bytes || 0 };
  });
  return { version: await packVersion(heads), parts };
}

// ---------- the state document ----------
// Stored as a `campaigns` row with id `<CAMPAIGN>#gm`, so it lives beside the campaign document but /api/campaign never
// reads it (that handler only ever asks for id = CAMPAIGN) and /api/export never selects it. campaign.js's
// writeCampaign() is not reused: it fills a missing row with defaultCampaign() (crew, clocks, schedule...) and trims a
// `log` key to 200 entries, both wrong for this document. The loop below is the same optimistic-check-and-retry on
// updated_at, without those two.

export const stateId = (campaign) => campaign + '#gm';
const STATE_ATTEMPTS = 5;

export async function loadState(db, campaign) {
  const row = await db.prepare('SELECT updated_at, doc FROM campaigns WHERE id = ?1').bind(stateId(campaign)).first();
  const doc = row ? parseJson(row.doc, {}) : {};
  return { doc: isPlainObject(doc) ? doc : {}, updatedAt: row ? row.updated_at : null, row };
}

/** Merge `patch` into the stored state (plain objects merge, arrays and scalars replace, null deletes). */
export async function patchState(db, campaign, patch) {
  const id = stateId(campaign);
  for (let attempt = 0; attempt < STATE_ATTEMPTS; attempt++) {
    const { doc: current, row } = await loadState(db, campaign);
    const now = nowIso(row && row.updated_at);
    const doc = deepMerge(current, patch);
    const text = JSON.stringify(doc);
    if (byteLength(text) > LIMITS.state) throw new HttpError(413, 'the GM state is too large (at most ' + LIMITS.state + ' bytes)');
    const result = row
      ? await db.prepare('UPDATE campaigns SET updated_at = ?1, doc = ?2 WHERE id = ?3 AND updated_at = ?4').bind(now, text, id, row.updated_at).run()
      : await db.prepare('INSERT INTO campaigns (id, updated_at, doc) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO NOTHING').bind(id, now, text).run();
    if (result && result.meta && result.meta.changes > 0) return { doc, updatedAt: now };
  }
  throw new HttpError(409, 'the GM state changed while saving, try again');
}

// ---------- the display ----------

function str(v, name, max, required) {
  if (v === undefined || v === null) {
    if (required) throw new HttpError(400, name + ' is required');
    return '';
  }
  if (typeof v !== 'string') throw new HttpError(400, name + ' must be a string');
  const s = v.replace(/\u0000/g, '');
  if (required && !s.trim()) throw new HttpError(400, name + ' is required');
  if (s.length > max) throw new HttpError(413, name + ' is too long (at most ' + max + ' characters)');
  return s;
}

// What a player-safe svg may not hold. It is drawn on a screen the players look at, so nothing in it may run, load
// from elsewhere, navigate or break out of the svg into HTML. The page renders it as well; this is the server's half.
// Element names are matched with or without a namespace prefix (<x:script>, <h:iframe>). The display page's sanitiser
// (app/display-page.js) enforces the same rules on its side.
const SVG_BANNED = [
  [/<\s*(?:[\w.-]+:)?script/i, '<script'],
  [/<\s*(?:[\w.-]+:)?foreignobject/i, '<foreignObject'],
  [/<\s*(?:[\w.-]+:)?(?:iframe|frame|frameset|embed|object|portal|meta|link|base|form|input|button|textarea|select|audio|video|canvas|applet)\b/i, 'an HTML element'],
  [/[\s"'/]srcset\s*=/i, 'srcset'],
  [/<!\s*(?:doctype|entity)/i, 'a DOCTYPE or ENTITY'],
  [/javascript\s*:/i, 'javascript:'],
  [/vbscript\s*:/i, 'vbscript:'],
  [/[\s"'/]on[a-z]+\s*=/i, 'an on...= event attribute'],
  [/attributename\s*=\s*["']?\s*(?:[\w-]+:)?href/i, 'an animated href'],
  [/@import/i, '@import'],
  [/<\s*[\w.-]+:style\b/i, 'a namespaced <style>'],
  [/<\s*(?:[\w.-]+:)?a[\s>/]/i, 'an <a> element'],
  [/xml:base/i, 'xml:base'],
  [/image-set\s*\(/i, 'image-set()'],
  [/(?:^|[^-\w])src\s*\(/i, 'src()'],
];
const REF_RE = /(?:^|[\s"'/])((?:[\w-]+:)?(?:href|src))\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
const RASTER = /^data:image\/(?:png|jpe?g|gif|webp)[;,]/i;
const safeRef = (v) => { const t = v.trim(); return t.startsWith('#') || RASTER.test(t); };
// every tag with its attributes; an attribute value may hold '>' inside quotes
const TAG_RE = /<\s*([\w.:-]+)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
const ATTR_RE = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
const STYLE_RE = /<\s*style\b[^>]*>([\s\S]*?)<\s*\/\s*style\s*>/gi;

/** 400 unless `svg` is a string starting `<svg` with nothing unsafe in it; 413 over LIMITS.svg bytes. */
export function checkSvg(svg) {
  if (typeof svg !== 'string') throw new HttpError(400, 'svg must be a string');
  const bytes = byteLength(svg);
  if (bytes > LIMITS.svg) throw new HttpError(413, 'svg is too large (' + bytes + ' bytes, at most ' + LIMITS.svg + ')');
  if (!/^<svg[\s>/]/i.test(svg.trimStart())) throw new HttpError(400, 'svg must start with <svg');
  for (const [re, what] of SVG_BANNED) if (re.test(svg)) throw new HttpError(400, 'svg must not contain ' + what);
  for (const m of svg.matchAll(REF_RE)) {
    const v = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
    if (!safeRef(v)) throw new HttpError(400, 'svg ' + m[1] + ' must be a #fragment or a data:image/ URI');
  }
  for (const t of svg.matchAll(TAG_RE)) {
    const el = t[1].toLowerCase().replace(/^.*:/, '');
    for (const a of t[2].matchAll(ATTR_RE)) {
      const v = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4];
      if (v.indexOf('\\') >= 0) throw new HttpError(400, 'svg attribute values must not hold a backslash');
      const local = a[1].toLowerCase().replace(/^.*:/, '');
      if ((local === 'href' || local === 'src') && !v.trim().startsWith('#') && !(el === 'image' || el === 'feimage'))
        throw new HttpError(400, 'svg ' + a[1] + ' on <' + t[1] + '> must be a #fragment (a data: image only on <image> or <feImage>)');
    }
  }
  for (const m of svg.matchAll(STYLE_RE)) if (m[1].indexOf('\\') >= 0) throw new HttpError(400, 'svg <style> must not hold a backslash');
  for (const m of svg.matchAll(URL_RE)) {
    const v = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
    if (!v.trim().startsWith('#')) throw new HttpError(400, 'svg url() must be a #fragment');
  }
  return svg.trimStart();
}

/** Validate a PUT /api/gm/display body into the stored display: { kind, title, caption } + svg | npcId | text. */
export function cleanDisplay(raw) {
  const kind = raw.kind;
  if (!DISPLAY_KINDS.includes(kind)) throw new HttpError(400, 'kind must be one of ' + DISPLAY_KINDS.join(', '));
  const out = { kind, title: str(raw.title, 'title', LIMITS.text), caption: str(raw.caption, 'caption', LIMITS.text) };
  if (kind === 'svg') out.svg = checkSvg(raw.svg);
  if (kind === 'npc') {
    if (typeof raw.npcId !== 'string' || !ID_RE.test(raw.npcId)) throw new HttpError(400, 'npcId must be an id (A-Z, a-z, 0-9, _ and -, at most 80)');
    out.npcId = raw.npcId;
  }
  if (kind === 'text') out.text = str(raw.text, 'text', LIMITS.text, true);
  return out;
}

export const BLANK_DISPLAY = { kind: 'blank', title: '', caption: '' };

export async function loadDisplay(db, campaign) {
  const row = await db.prepare('SELECT seq, updated_at, doc FROM gm_display WHERE campaign = ?1').bind(campaign).first();
  if (!row) return { seq: 0, display: { ...BLANK_DISPLAY }, updatedAt: null };
  const d = parseJson(row.doc, null);
  return { seq: row.seq, display: isPlainObject(d) ? d : { ...BLANK_DISPLAY }, updatedAt: row.updated_at };
}

/** Store a display and bump seq, in one statement (no read-modify-write: the seq increments in SQL). */
export async function putDisplay(db, campaign, display) {
  const now = nowIso();
  const row = await db
    .prepare(
      `INSERT INTO gm_display (campaign, seq, updated_at, doc) VALUES (?1, 1, ?2, ?3)
       ON CONFLICT (campaign) DO UPDATE SET seq = gm_display.seq + 1, updated_at = excluded.updated_at, doc = excluded.doc
       RETURNING seq, updated_at`
    )
    .bind(campaign, now, JSON.stringify(display))
    .first();
  return { seq: row.seq, display, updatedAt: row.updated_at };
}
