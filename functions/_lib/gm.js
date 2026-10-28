// The GM tools' storage and validation (see GM.md): the GM pack (the generators' tables, imported by the GM from
// their own PC, never in git), the GM state document, the display the iPad shows and the ambient scenes behind it. Everything here is GM only:
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
  rule: 40000,                  // characters of a rules entry's Markdown (the importer cuts entries at 36000)
  ambient: 1400 * KiB,          // bytes of the stored ambient document (under D1's 2 MB row)
  ambientRequest: 2560 * KiB,   // one PATCH /api/gm/ambient (two 600 KiB svgs whose quotes double when JSON-escaped)
  ambientString: 200,           // characters of a score's name, district or target
  playlist: 16,                 // scenes in a playlist
};

export const PART_RE = /^[a-z0-9-]{1,32}$/;
// blank: nothing spotlit (the table display falls back to the ambient scene); dark: lights out (true black);
// rule: one rules entry, as Markdown (the display renders it with markdown.js, links as plain text)
// cards: the planning meeting's opportunity cards, typed by the GM on the GM page (from, client, target, type, a free line,
// payout), shown as a carousel or spread out
// handout: one prop image served from the git-ignored static folder app/media/handouts/ (HOSTING.md); the display carries only the file name
export const DISPLAY_KINDS = ['blank', 'dark', 'svg', 'npc', 'text', 'rule', 'cards', 'handout'];
export const HANDOUT_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,78}\.(?:png|jpe?g|gif|webp|svg)$/i;
export const CARD_FIELDS = ['from', 'client', 'target', 'type', 'note', 'payout'];
export const CARD_LIMITS = { cards: 8, field: 120, interval: 120 };

// The ambient scenes (GM.md, "Ambient scenes"; the plan: docs/history/AMBIENT-PLAN.md): the ids mirror Pure.AMBIENT_SCENES in app/display-page.js; the bands are the
// four reveal layers of a score site, lowest first.
export const AMBIENT_SCENES = ['harvest', 'watch', 'duskwall', 'boneyard', 'undertow', 'vet', 'tram', 'lurker', 'cards', 'pells', 'wanted', 'meeting', 'credits', 'board', 'exploded', 'testcard'];
export const WIRE_MAX = 240, WIRE_ITEMS_MAX = 6;       // a bulletin's characters, bulletins at once (mirrors functions/_lib/assist/prompts.js)
export const AMBIENT_MODES = ['auto', 'pin', 'off'];
// the overlay (cleanOverlay): the kinds, the clock sizes, the effects, and the caps; mirrored by Pure.OVERLAY in app/display-page.js
export const OVERLAY_KINDS = ['clock', 'npc', 'fx', 'text'];
export const OVERLAY_CLOCK_SIZES = [4, 6, 8, 10, 12];
export const OVERLAY_FX = ['dawn'];
export const OVERLAY = { id: 40, name: 60, text: 120, msMin: 1000, msMax: 180000 };
export const BANDS = ['public', 'working', 'controlled', 'secure'];

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
  if (kind === 'rule') out.md = str(raw.md, 'md', LIMITS.rule, true);
  if (kind === 'handout') {
    if (typeof raw.file !== 'string' || !HANDOUT_FILE_RE.test(raw.file) || raw.file.includes('..')) throw new HttpError(400, 'file must be a plain image file name (png, jpg, webp or svg)');
    out.file = raw.file;
    out.showTitle = raw.showTitle === true;
  }
  if (kind === 'cards') {
    if (!Array.isArray(raw.cards) || raw.cards.length < 1 || raw.cards.length > CARD_LIMITS.cards) throw new HttpError(400, 'cards must be a list of 1 to ' + CARD_LIMITS.cards + ' cards');
    out.cards = raw.cards.map((c, i) => {
      if (!isPlainObject(c)) throw new HttpError(400, 'card ' + (i + 1) + ' must be an object');
      const card = {};
      for (const f of CARD_FIELDS) card[f] = str(c[f], 'card ' + (i + 1) + ' ' + f, CARD_LIMITS.field);
      return card;
    });
    out.mode = raw.mode === 'spread' ? 'spread' : 'carousel';
    const n = Number(raw.interval);
    out.interval = Number.isInteger(n) && n >= 0 && n <= CARD_LIMITS.interval ? n : 0;
    out.start = Number.isInteger(raw.start) && raw.start >= 0 && raw.start < out.cards.length ? raw.start : 0;
  }
  return out;
}

export const BLANK_DISPLAY = { kind: 'blank', title: '', caption: '' };

export async function loadDisplay(db, campaign) {
  const row = await db.prepare('SELECT seq, updated_at, doc FROM gm_display WHERE campaign = ?1').bind(campaign).first();
  if (!row) return { seq: 0, display: { ...BLANK_DISPLAY }, updatedAt: null };
  const d = parseJson(row.doc, null);
  return { seq: row.seq, display: isPlainObject(d) ? d : { ...BLANK_DISPLAY }, updatedAt: row.updated_at };
}

/**
 * Only the `kind` of the display now ('blank' while none is stored), read with json_extract in SQL: no JS parse of a document that can hold a
 * 600 KiB map. For the one question the ambient handler asks (is the display in lights out?).
 */
export async function loadDisplayKind(db, campaign) {
  const row = await db.prepare("SELECT json_extract(doc, '$.kind') AS kind FROM gm_display WHERE campaign = ?1").bind(campaign).first();
  return row && typeof row.kind === 'string' ? row.kind : 'blank';
}

/** Store a display and bump seq, in one statement (no read-modify-write: the seq increments in SQL). */
export async function putDisplay(db, campaign, display, ifSeq) {
  const now = nowIso();
  /* ifSeq (the GM page's live reveal): store only while the display is still at that seq, else 409 and nothing changes, so a
     push made since (another device, another panel) is never overwritten by an older view of it */
  if (ifSeq !== undefined) {
    const hit = await db
      .prepare('UPDATE gm_display SET seq = seq + 1, updated_at = ?2, doc = ?3 WHERE campaign = ?1 AND seq = ?4 RETURNING seq, updated_at')
      .bind(campaign, now, JSON.stringify(display), ifSeq)
      .first();
    if (!hit) throw new HttpError(409, 'the display changed since seq ' + ifSeq);
    return { seq: hit.seq, display, updatedAt: hit.updated_at };
  }
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
// ---------- the ambient document ----------
// What plays on the table display when nothing is spotlit (GM.md, "Ambient scenes"; the plan: docs/history/AMBIENT-PLAN.md). Its own table, `gm_ambient`, so an NPC push
// (which replaces the display document) can never wipe the score maps. Never part of /api/export. Merge-patched by the
// GM only; the display sign-in reads it through GET /api/gm/display, never from /api/gm/ambient.

const AMBIENT_ATTEMPTS = 5;
const isInt = (v, lo, hi) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

function sceneId(v, name) {
  if (typeof v !== 'string' || !AMBIENT_SCENES.includes(v)) throw new HttpError(400, name + ' must be one of ' + AMBIENT_SCENES.join(', '));
  return v;
}

/**
 * The overlay (GM.md, "Overlays"): something laid over the iPad without replacing what is up. Pure shape checks; the one check that
 * needs the database is run by the handler: an npc overlay's NPC must be revealed (assertRevealedNpc, functions/_lib/npcs.js) and a
 * clock overlay's clock must be one the players can see (resolveOverlayClock, functions/_lib/campaign.js, which also fills in the
 * name, size and fill: the caller never sends them).
 * null removes it. Otherwise { id (at most 40), kind clock|npc|fx|text, ms 1000-180000, auto? } plus, per kind, clock { clockId },
 * npc { npcId }, fx { fx: 'dawn' }, text { text (at most 120) }. `auto: true` marks an overlay the autopilot sent (it never lights a
 * blacked-out screen). A fresh object is built, so any other key (a clock's name, size or fill included) is dropped; `at` is the
 * server's time. No model text or prep text belongs in one: the GM page sends only what the GM chose.
 */
export function cleanOverlay(v) {
  if (v === null) return null;
  if (!isPlainObject(v)) throw new HttpError(400, 'overlay must be an object or null');
  const id = str(v.id, 'overlay.id', OVERLAY.id, true).trim();
  if (typeof v.kind !== 'string' || !OVERLAY_KINDS.includes(v.kind)) throw new HttpError(400, 'overlay.kind must be one of ' + OVERLAY_KINDS.join(', '));
  if (!isInt(v.ms, OVERLAY.msMin, OVERLAY.msMax)) throw new HttpError(400, 'overlay.ms must be a whole number from ' + OVERLAY.msMin + ' to ' + OVERLAY.msMax);
  if (v.auto !== undefined && v.auto !== null && typeof v.auto !== 'boolean') throw new HttpError(400, 'overlay.auto must be true or false');
  const out = { id, kind: v.kind, ms: v.ms };
  if (v.auto === true) out.auto = true;
  if (v.kind === 'clock') {
    // the clock is named by its id; the handler looks it up (and refuses a hidden or missing one) and fills in the name, size and fill
    if (typeof v.clockId !== 'string' || !ID_RE.test(v.clockId)) throw new HttpError(400, 'overlay.clockId is a bad id');
    out.clockId = v.clockId;
  } else if (v.kind === 'npc') {
    if (typeof v.npcId !== 'string' || !ID_RE.test(v.npcId)) throw new HttpError(400, 'overlay.npcId is a bad id');
    out.npcId = v.npcId;
  } else if (v.kind === 'fx') {
    if (!OVERLAY_FX.includes(v.fx)) throw new HttpError(400, 'overlay.fx must be one of ' + OVERLAY_FX.join(', '));
    out.fx = v.fx;
  } else {
    out.text = str(v.text, 'overlay.text', OVERLAY.text, true).replace(/\s+/g, ' ').trim();
  }
  out.at = nowIso();
  return out;
}

/**
 * Validate one PATCH /api/gm/ambient body into a patch. Only these keys are kept (others are dropped); `null` on any
 * but `skip` means "delete this key":
 *   mode 'auto'|'pin'|'off', scene (a scene id), playlist (1 to 16 distinct scene ids, replaces), intervalMin (integer 3-30),
 *   skip (only `true`: the server adds one to its counter), crew ({ heat 0-9, wanted 0-4 }, replaces),
 *   overlay (null, or { id, kind, ms, ... } see cleanOverlay; replaces; `at` is set here), auto (true|false: the iPad's AUTO chip),
 *   score ({ name, district, target (each at most 200 characters), reveal (distinct bands), view 'plan'|'rings',
 *            board and iso (player-safe svgs, each through checkSvg) }, replaces; `at` is set here, to the server's time).
 * Malformed is 400, too long or too large 413.
 */
export function cleanAmbientPatch(raw) {
  const patch = {};
  if ('mode' in raw) {
    const v = raw.mode;
    if (v !== null && !AMBIENT_MODES.includes(v)) throw new HttpError(400, 'mode must be one of ' + AMBIENT_MODES.join(', '));
    patch.mode = v;
  }
  if ('scene' in raw) patch.scene = raw.scene === null ? null : sceneId(raw.scene, 'scene');
  if ('playlist' in raw) {
    const v = raw.playlist;
    if (v === null) patch.playlist = null;
    else {
      if (!Array.isArray(v) || !v.length) throw new HttpError(400, 'playlist must be a non-empty array of scene ids');
      if (v.length > LIMITS.playlist) throw new HttpError(413, 'playlist is too long (at most ' + LIMITS.playlist + ' scenes)');
      v.forEach((id) => sceneId(id, 'playlist entries'));
      if (new Set(v).size !== v.length) throw new HttpError(400, 'playlist must not repeat a scene');
      patch.playlist = v.slice();
    }
  }
  if ('intervalMin' in raw) {
    const v = raw.intervalMin;
    if (v !== null && !isInt(v, 3, 30)) throw new HttpError(400, 'intervalMin must be a whole number from 3 to 30');
    patch.intervalMin = v;
  }
  if ('skip' in raw && raw.skip !== undefined) {
    if (raw.skip !== true) throw new HttpError(400, 'skip must be true');
    patch.skip = true;
  }
  if ('crew' in raw) {
    const v = raw.crew;
    if (v === null) patch.crew = null;
    else {
      if (!isPlainObject(v)) throw new HttpError(400, 'crew must be an object or null');
      if (!isInt(v.heat, 0, 9)) throw new HttpError(400, 'crew.heat must be a whole number from 0 to 9');
      if (!isInt(v.wanted, 0, 4)) throw new HttpError(400, 'crew.wanted must be a whole number from 0 to 4');
      patch.crew = { heat: v.heat, wanted: v.wanted };
    }
  }
  if ('wire' in raw) {
    // the wire: short in-world bulletins the display shows over the ambient scenes, one at a time (a Screen item the GM tapped Show on)
    const v = raw.wire;
    if (v === null) patch.wire = null;
    else {
      if (!Array.isArray(v)) throw new HttpError(400, 'wire must be an array of { id, text } or null');
      if (v.length > WIRE_ITEMS_MAX) throw new HttpError(413, 'wire is too long (at most ' + WIRE_ITEMS_MAX + ' bulletins)');
      const seen = new Set();
      patch.wire = v.map((x) => {
        if (!isPlainObject(x)) throw new HttpError(400, 'each bulletin is an object { id, text }');
        const id = str(x.id, 'wire.id', 40, true).trim(), text = str(x.text, 'wire.text', WIRE_MAX, true).replace(/\s+/g, ' ').trim();
        if (seen.has(id)) throw new HttpError(400, 'wire ids must differ');
        seen.add(id);
        return { id, text };
      });
      if (!patch.wire.length) patch.wire = null;
    }
  }
  if ('overlay' in raw) patch.overlay = cleanOverlay(raw.overlay);
  if ('auto' in raw) {
    // the AUTO chip: the autopilot is driving the iPad (a boolean, for the badge only)
    if (raw.auto !== null && typeof raw.auto !== 'boolean') throw new HttpError(400, 'auto must be true or false');
    patch.auto = raw.auto;
  }
  if ('score' in raw) {
    const v = raw.score;
    if (v === null) patch.score = null;
    else {
      if (!isPlainObject(v)) throw new HttpError(400, 'score must be an object or null');
      const reveal = v.reveal;
      if (!Array.isArray(reveal) || !reveal.length) throw new HttpError(400, 'score.reveal must be a non-empty array of bands');
      if (reveal.some((b) => !BANDS.includes(b))) throw new HttpError(400, 'score.reveal holds only ' + BANDS.join(', '));
      if (v.view !== 'plan' && v.view !== 'rings') throw new HttpError(400, "score.view must be 'plan' or 'rings'");
      patch.score = {
        name: str(v.name, 'score.name', LIMITS.ambientString),
        district: str(v.district, 'score.district', LIMITS.ambientString),
        target: str(v.target, 'score.target', LIMITS.ambientString),
        reveal: BANDS.filter((b) => reveal.includes(b)),
        view: v.view,
        board: checkSvg(v.board),
        iso: checkSvg(v.iso),
        at: nowIso(),
      };
    }
  }
  return patch;
}

async function ambientRow(db, campaign) {
  return db.prepare('SELECT seq, updated_at, doc FROM gm_ambient WHERE campaign = ?1').bind(campaign).first();
}

const ambientOf = (row) => {
  const d = row ? parseJson(row.doc, {}) : {};
  return { seq: row ? row.seq : 0, doc: isPlainObject(d) ? d : {}, updatedAt: row ? row.updated_at : null };
};

/**
 * The ambient part as the display is served it (GET /api/gm/display): the overlay, once the SERVER's clock has passed at + ms, is
 * left out (a reload of the display then replays nothing), and while it runs it carries `age`, the whole ms since the server set
 * `at`, so a reloaded display carries on from the right moment. Nothing is written and seq does not move. One comparison per poll;
 * an overlay with no readable `at` (stored before the server set one) is served as it is. `nowMs` is the server's own clock.
 * `displayKind`, when given, is the kind the display is showing: an overlay the autopilot sent (`auto: true`) is left out while that is
 * 'dark' (lights out), so nothing autopilot-driven lights a blacked-out screen. A GM-pressed overlay (the dawn) carries no such mark.
 */
export function liveAmbient(amb, nowMs, displayKind) {
  const o = amb && amb.doc && amb.doc.overlay;
  if (!o || typeof o !== 'object') return amb;
  if (o.auto === true && displayKind === 'dark') { const d = { ...amb.doc }; delete d.overlay; return { ...amb, doc: d }; }
  const at = typeof o.at === 'string' ? Date.parse(o.at) : NaN;
  if (!Number.isFinite(at) || !Number.isInteger(o.ms)) return amb;
  const age = Math.max(0, nowMs - at);
  const doc = { ...amb.doc };
  if (age >= o.ms) delete doc.overlay; else doc.overlay = { ...o, age: Math.floor(age) };
  return { ...amb, doc };
}

/** { seq, doc, updatedAt }: `{ seq: 0, doc: {}, updatedAt: null }` while none is stored. */
export async function loadAmbient(db, campaign) {
  return ambientOf(await ambientRow(db, campaign));
}

/**
 * Apply a cleanAmbientPatch() result to the stored document: top-level keys replace (a playlist, crew or score as a whole),
 * null deletes the key, `skip: true` adds one to the stored counter. Writes with seq + 1 under the same optimistic
 * updated_at check as patchState (409 when it keeps colliding); the stored document is at most LIMITS.ambient bytes (413).
 * An empty patch changes nothing and does not move seq. Returns { seq, doc, updatedAt }.
 */
export async function patchAmbient(db, campaign, patch) {
  for (let attempt = 0; attempt < AMBIENT_ATTEMPTS; attempt++) {
    const row = await ambientRow(db, campaign);
    const cur = ambientOf(row);
    if (!Object.keys(patch).length) return cur;
    const doc = { ...cur.doc };
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'skip') doc.skip = (doc.skip | 0) + 1;
      else if (v === null) delete doc[k];
      else doc[k] = v;
    }
    const text = JSON.stringify(doc);
    if (byteLength(text) > LIMITS.ambient) throw new HttpError(413, 'the ambient document is too large (at most ' + LIMITS.ambient + ' bytes)');
    const now = nowIso(row && row.updated_at);
    const seq = cur.seq + 1;
    const result = row
      ? await db.prepare('UPDATE gm_ambient SET seq = ?1, updated_at = ?2, doc = ?3 WHERE campaign = ?4 AND updated_at = ?5').bind(seq, now, text, campaign, row.updated_at).run()
      : await db.prepare('INSERT INTO gm_ambient (campaign, seq, updated_at, doc) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(campaign) DO NOTHING').bind(campaign, seq, now, text).run();
    if (result && result.meta && result.meta.changes > 0) return { seq, doc, updatedAt: now };
  }
  throw new HttpError(409, 'the ambient document changed while saving, try again');
}
