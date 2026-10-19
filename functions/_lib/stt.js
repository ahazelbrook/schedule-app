// The table iPad's transcriber (GM.md, "Listening"): the iPad streams its mic to Deepgram with a short-lived token minted
// here (the Deepgram key is the Worker secret DEEPGRAM_API_KEY and never leaves the server), and posts each finished line
// back. Lines are kept in gm_transcript; scripts/gm-transcript.mjs on the GM's PC copies them into the vault as they come.
// The control document (gm_stt) says whether the GM wants the iPad listening, the session, the speaker names, and what
// the iPad last reported. GM only (and the table display sign-in, which may listen and report but not read the
// transcript); never part of /api/export.
//
// Plain ES module with no Cloudflare-specific imports, so node can import it.

import { HttpError, isPlainObject, deepMerge, nowIso } from './http.js';

export const STT_LIMITS = {
  lines: 50,          // lines in one POST
  text: 2000,         // characters in one line
  speakers: 16,       // named speakers
  name: 60,           // characters in a speaker's name
  tail: 50,           // lines in one ?tail= read
  page: 500,          // lines in one ?after= read
  error: 300,         // characters of the iPad's last error
  doc: 16 * 1024,     // bytes of the control document
};
export const STT_STATES = ['idle', 'starting', 'listening', 'reconnecting', 'stopped', 'error'];
export const DEEPGRAM_GRANT = 'https://api.deepgram.com/v1/auth/grant';

const LINE_ID = /^[A-Za-z0-9_-]{1,40}$/, CONN = /^[A-Za-z0-9_-]{0,40}$/, SESSION = /^[0-9]{0,4}(\.[0-9]{1,2})?$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** The GM, or the table display sign-in (role 'display') where `display` is true. 403 before the body is read. */
export function requireListener(data, display) {
  const role = data && data.me && data.me.role;
  if (role === 'gm' || (display && role === 'display')) return role;
  throw new HttpError(403, 'only the GM can use the GM tools');
}

/* ---------- the transcript lines ---------- */

/** POST body -> [{ id, session, at, conn, speaker, kind, text }]. Malformed is 400. */
export function cleanLines(raw) {
  const list = raw && raw.lines;
  if (!Array.isArray(list) || list.length > STT_LIMITS.lines) throw new HttpError(400, 'lines must be a list of at most ' + STT_LIMITS.lines);
  return list.map((l, i) => {
    const where = 'line ' + (i + 1);
    if (!isPlainObject(l)) throw new HttpError(400, where + ' must be an object');
    if (typeof l.id !== 'string' || !LINE_ID.test(l.id)) throw new HttpError(400, where + ': id must be 1 to 40 of A-Z, a-z, 0-9, _ and -');
    if (typeof l.at !== 'string' || !ISO.test(l.at) || isNaN(Date.parse(l.at))) throw new HttpError(400, where + ': at must be an ISO time');
    const kind = l.kind === undefined ? 'line' : l.kind;
    if (kind !== 'line' && kind !== 'mark') throw new HttpError(400, where + ': kind must be line or mark');
    const text = typeof l.text === 'string' ? l.text.replace(/\u0000/g, '').replace(/\s+/g, ' ').trim() : null;
    if (text === null || (kind === 'line' && !text)) throw new HttpError(400, where + ': text is required');
    if (text.length > STT_LIMITS.text) throw new HttpError(413, where + ': text is longer than ' + STT_LIMITS.text);
    const speaker = l.speaker === undefined || l.speaker === null ? null : l.speaker;
    if (speaker !== null && !(Number.isInteger(speaker) && speaker >= 0 && speaker < 64)) throw new HttpError(400, where + ': speaker must be a number from 0 to 63, or null');
    const conn = l.conn === undefined ? '' : l.conn, session = l.session === undefined || l.session === null ? '' : String(l.session);
    if (typeof conn !== 'string' || !CONN.test(conn)) throw new HttpError(400, where + ': conn must be an id');
    if (!SESSION.test(session)) throw new HttpError(400, where + ': session must be a session number');
    return { id: l.id, session, at: l.at, conn, speaker, kind, text };
  });
}

/** Store the lines in order, each with the next seq; a line whose id is already stored is skipped. -> { added, last } */
export async function addLines(db, campaign, lines) {
  if (lines.length) {
    const sql = `INSERT OR IGNORE INTO gm_transcript (campaign, seq, id, session, at, conn, speaker, kind, text)
      SELECT ?1, COALESCE(MAX(seq), 0) + 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 FROM gm_transcript WHERE campaign = ?1`;
    await db.batch(lines.map((l) => db.prepare(sql).bind(campaign, l.id, l.session, l.at, l.conn, l.speaker, l.kind, l.text)));
  }
  const ids = lines.map((l) => l.id);
  let added = 0;
  if (ids.length) {
    const marks = ids.map((_, i) => '?' + (i + 2)).join(', ');
    const r = await db.prepare('SELECT COUNT(*) AS n FROM gm_transcript WHERE campaign = ?1 AND id IN (' + marks + ')').bind(campaign, ...ids).first();
    added = r ? r.n : 0;   // stored now (new or from an earlier send of the same line)
  }
  return { added, last: await lastSeq(db, campaign) };
}

export async function lastSeq(db, campaign) {
  const r = await db.prepare('SELECT COALESCE(MAX(seq), 0) AS last FROM gm_transcript WHERE campaign = ?1').bind(campaign).first();
  return r ? r.last : 0;
}

const COLS = 'seq, id, session, at, conn, speaker, kind, text';
/** after: the lines with seq > after (oldest first, a page at most); tail: the newest n, oldest first; since: the newest page of
 *  lines stamped at or after this ISO time (a line count is the wrong unit for "the last few minutes": a busy table says far
 *  more than 50 lines in four). -> { lines, last } */
export async function readLines(db, campaign, { after = 0, tail = 0, since = '' } = {}) {
  let rows;
  if (since) {
    const r = await db.prepare('SELECT ' + COLS + ' FROM (SELECT ' + COLS + ' FROM gm_transcript WHERE campaign = ?1 AND at >= ?2 ORDER BY seq DESC LIMIT ?3) ORDER BY seq').bind(campaign, since, STT_LIMITS.page).all();
    rows = r.results || [];
  } else if (tail > 0) {
    const r = await db.prepare('SELECT ' + COLS + ' FROM gm_transcript WHERE campaign = ?1 ORDER BY seq DESC LIMIT ?2').bind(campaign, Math.min(tail, STT_LIMITS.tail)).all();
    rows = (r.results || []).reverse();
  } else {
    const r = await db.prepare('SELECT ' + COLS + ' FROM gm_transcript WHERE campaign = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3').bind(campaign, Math.max(0, after), STT_LIMITS.page).all();
    rows = r.results || [];
  }
  return { lines: rows, last: await lastSeq(db, campaign) };
}

/** Forget the lines up to and including seq `through` (the PC has filed them). -> { removed } */
export async function pruneLines(db, campaign, through) {
  const r = await db.prepare('DELETE FROM gm_transcript WHERE campaign = ?1 AND seq <= ?2').bind(campaign, through).run();
  return { removed: (r && r.meta && r.meta.changes) || 0 };
}

/* ---------- the control document ---------- */

// copier: the PC's heartbeat (scripts/gm-transcript.mjs --watch writes it in place; no client may PATCH it).
export const BLANK_STT = { want: 'off', session: '', speakers: {}, status: { state: 'idle', at: '', lines: 0, error: '' }, copier: { at: '', last: 0 } };

export async function loadStt(db, campaign) {
  const row = await db.prepare('SELECT updated_at, doc FROM gm_stt WHERE campaign = ?1').bind(campaign).first();
  let doc = null;
  try { doc = row ? JSON.parse(row.doc) : null; } catch (_) { doc = null; }
  return { doc: deepMerge(structuredClone(BLANK_STT), isPlainObject(doc) ? doc : {}), updatedAt: row ? row.updated_at : null, raw: row ? row.doc : null };
}

/**
 * What the table iPad needs of the control document, carried in GET /api/gm/display the way the ambient is (GM.md "Listening",
 * "The display"): whether the GM wants it listening, and the session number to stamp on its lines. Nothing else rides: no
 * speaker names, no status, no heartbeat, never a transcript line.
 * `seq` is a number made from those two values alone (32-bit FNV-1a), not the document's updated_at: the iPad reports its own
 * status (every 10 s while its mic is open, once a minute otherwise) and each report moves updated_at, which would make polls
 * look changed all the time. It moves when the GM turns listening on or off or changes the session, and only then.
 */
export function sttPartOf(doc) {
  const want = doc && doc.want === 'on' ? 'on' : 'off';
  const session = doc && typeof doc.session === 'string' && SESSION.test(doc.session) ? doc.session : '';
  let h = 0x811c9dc5;
  for (const c of want + '|' + session) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return { seq: h >>> 0, want, session };
}

/** { seq, want, session } for the display GET: `{ seq, want: 'off', session: '' }` while nothing is stored. */
export async function loadSttPart(db, campaign) {
  return sttPartOf((await loadStt(db, campaign)).doc);
}

/**
 * A PATCH body -> the patch to merge. The GM may set want, session, speakers and status; the display sign-in only status.
 * speakers: { "0": "Pat", "3": null } (null deletes).
 */
export function cleanSttPatch(raw, role) {
  if (!isPlainObject(raw)) throw new HttpError(400, 'body must be an object');
  const out = {};
  for (const k of Object.keys(raw)) {
    if (!['want', 'session', 'speakers', 'status'].includes(k)) throw new HttpError(400, 'unknown key ' + k);
    if (k !== 'status' && role !== 'gm') throw new HttpError(403, 'only the GM can change ' + k);
  }
  if ('want' in raw) { if (raw.want !== 'on' && raw.want !== 'off') throw new HttpError(400, 'want must be on or off'); out.want = raw.want; }
  if ('session' in raw) { const s = raw.session === null ? '' : String(raw.session); if (!SESSION.test(s)) throw new HttpError(400, 'session must be a session number'); out.session = s; }
  if ('speakers' in raw) {
    if (!isPlainObject(raw.speakers)) throw new HttpError(400, 'speakers must be an object');
    out.speakers = {};
    for (const [k, v] of Object.entries(raw.speakers)) {
      if (!/^(?:[0-9]|[1-5][0-9]|6[0-3])$/.test(k)) throw new HttpError(400, 'speaker numbers run from 0 to 63');
      if (v !== null && (typeof v !== 'string' || v.length > STT_LIMITS.name)) throw new HttpError(400, 'a speaker name is text of at most ' + STT_LIMITS.name + ' characters');
      out.speakers[k] = v === null ? null : v.replace(/[\r\n*_[\]]/g, ' ').trim() || null;
    }
  }
  if ('status' in raw) {
    const s = raw.status;
    if (!isPlainObject(s)) throw new HttpError(400, 'status must be an object');
    if (!STT_STATES.includes(s.state)) throw new HttpError(400, 'status.state must be one of ' + STT_STATES.join(', '));
    const lines = s.lines === undefined ? 0 : s.lines;
    if (!Number.isInteger(lines) || lines < 0) throw new HttpError(400, 'status.lines must be a count');
    out.status = { state: s.state, at: nowIso(), lines, error: typeof s.error === 'string' ? s.error.slice(0, STT_LIMITS.error) : '' };
  }
  return out;
}

const STT_ATTEMPTS = 5;
/**
 * Merge a cleanSttPatch() result into the stored document. The write lands only while the stored text is still what was
 * read (the iPad reports its status every few seconds, the GM turns listening on and off, and the PC's heartbeat sets
 * `copier` in place without moving updated_at), so none of them can undo another's change; 409 when it keeps colliding.
 */
export async function patchStt(db, campaign, patch) {
  for (let attempt = 0; attempt < STT_ATTEMPTS; attempt++) {
    const cur = await loadStt(db, campaign);
    const doc = deepMerge(cur.doc, patch);
    if (isPlainObject(doc.speakers)) {
      for (const k of Object.keys(doc.speakers)) if (doc.speakers[k] === null) delete doc.speakers[k];
      if (Object.keys(doc.speakers).length > STT_LIMITS.speakers) throw new HttpError(400, 'at most ' + STT_LIMITS.speakers + ' named speakers');
    }
    const text = JSON.stringify(doc);
    if (new TextEncoder().encode(text).byteLength > STT_LIMITS.doc) throw new HttpError(413, 'the listening document is too large');
    const now = nowIso(cur.updatedAt);
    const result = cur.raw === null
      ? await db.prepare('INSERT INTO gm_stt (campaign, updated_at, doc) VALUES (?1, ?2, ?3) ON CONFLICT (campaign) DO NOTHING').bind(campaign, now, text).run()
      : await db.prepare('UPDATE gm_stt SET updated_at = ?2, doc = ?3 WHERE campaign = ?1 AND doc = ?4').bind(campaign, now, text, cur.raw).run();
    if (result && result.meta && result.meta.changes > 0) return { doc, updatedAt: now };
  }
  throw new HttpError(409, 'the listening settings changed while saving, try again');
}

/* ---------- the Deepgram token ---------- */

/** A short-lived Deepgram token, minted with the Worker's key. 503 when the key is not set; 502 when Deepgram refuses. */
export async function grantToken(env, fetchFn = fetch) {
  /* trimmed: a secret piped in from Windows PowerShell arrives with a CRLF, and Deepgram answers 400 */
  const key = env && typeof env.DEEPGRAM_API_KEY === 'string' ? env.DEEPGRAM_API_KEY.trim() : '';
  if (!key) throw new HttpError(503, 'listening is not set up: the Worker has no DEEPGRAM_API_KEY secret');
  /* the checks' stand-in for Deepgram (gm-stt.e2e.mjs): honoured only on a loopback address, so the key can go nowhere else */
  const url = typeof env.DEEPGRAM_GRANT_URL === 'string' && /^http:\/\/127\.0\.0\.1:\d+\//.test(env.DEEPGRAM_GRANT_URL) ? env.DEEPGRAM_GRANT_URL : DEEPGRAM_GRANT;
  let res;
  try { res = await fetchFn(url, { method: 'POST', headers: { Authorization: 'Token ' + key, 'Content-Type': 'application/json' }, body: '{}' }); }
  catch (_) { throw new HttpError(502, 'could not reach Deepgram'); }
  if (!res.ok) throw new HttpError(502, 'Deepgram refused the token (' + res.status + (res.status === 403 ? ': the key needs Member permission or above' : '') + ')');
  const body = await res.json().catch(() => null);
  if (!body || typeof body.access_token !== 'string') throw new HttpError(502, 'Deepgram sent no token');
  return { token: body.access_token, expiresIn: Number(body.expires_in) || 30 };
}
