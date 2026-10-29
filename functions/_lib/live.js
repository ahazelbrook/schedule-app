// Live sync, the Worker's half (design 2.5, MD1b). A poke names a kind and carries a time, never data; every open page that
// hears it runs its existing poll at once. The poll stays the source of truth, so a poke that never arrives costs only time.
//
// This file is plain ES with no cloudflare:workers import, so node loads it through the handlers in the checks. The Durable
// Object (worker/live.js) imports KINDS from here, which keeps the table in one place.
//
//   pokeLive(context, kinds)  after a write has succeeded: sends one poke per kind through waitUntil; never throws, never delays the answer
//   liveFlagOf(row)           the switch from a row that carries it (the GM state document's `live`): on unless it is explicitly false
//   liveFlag(db, campaign)    one small read of just that key (json_type in SQL: the state document is never loaded or parsed)

import { campaignOf } from './http.js';

/** The kinds, and the roles that hear each. 'screen' (MM1) is for phones: sent when the stored display changes to a map or a handout while the mirror is on, and when the mirror flips. */
export const KINDS = {
  characters: ['player', 'gm'],
  campaign: ['player', 'gm'],
  npcs: ['player', 'gm'],
  screen: ['player'],
  display: ['display', 'gm'],
  ambient: ['display', 'gm'],
  stt: ['display', 'gm'],
  cue: ['gm'],
};
export const ROLES = ['gm', 'player', 'display'];
export const rolesFor = (kind) => (Object.prototype.hasOwnProperty.call(KINDS, kind) ? KINDS[kind] : []);

/** The header the Worker sets on the request it forwards to the object. The object is reachable only through a stub, but the
 *  route always overwrites this header from the signed-in role, so nothing a client sends can name its own role. */
export const ROLE_HEADER = 'X-B68-Role';

/**
 * Send a poke for each kind to the campaign's LiveHub, without delaying the answer: the work is handed to waitUntil.
 * Called AFTER the write has been awaited, so a refused or failed write (403, 409, 412) never pokes. A failure of any kind (no
 * binding, a stub that throws, an object that rejects or never answers) is logged and dropped; the write has already succeeded
 * and the pages poll anyway.
 */
export function pokeLive(context, kinds) {
  try {
    const env = context && context.env;
    if (!env || !env.LIVE || !kinds || !kinds.length) return;
    const names = [...new Set([].concat(kinds))].filter((k) => rolesFor(k).length);
    if (!names.length) return;
    const work = (async () => {
      const stub = env.LIVE.get(env.LIVE.idFromName(campaignOf(env)));
      await Promise.all(names.map(async (k) => {
        try { await stub.poke(k); } catch (e) { console.warn('live: poke dropped:', k, e && e.message || e); }
      }));
    })().catch((e) => { console.warn('live: poke dropped:', e && e.message || e); });
    if (context && typeof context.waitUntil === 'function') context.waitUntil(work);
  } catch (e) {
    console.warn('live: poke dropped:', e && e.message || e);
  }
}

/**
 * The switch has just gone off: ask the object to close every socket (code 1000), through waitUntil like a poke. Called only on
 * that flip (GM state going from on or absent to an explicit false), after the write. A failure is logged and dropped; the pages
 * close client-side too, so this is belt and braces.
 */
export function closeLive(context) {
  try {
    const env = context && context.env;
    if (!env || !env.LIVE) return;
    const work = (async () => {
      const stub = env.LIVE.get(env.LIVE.idFromName(campaignOf(env)));
      await stub.closeAll();
    })().catch((e) => { console.warn('live: closeAll dropped:', e && e.message || e); });
    if (context && typeof context.waitUntil === 'function') context.waitUntil(work);
  } catch (e) {
    console.warn('live: closeAll dropped:', e && e.message || e);
  }
}

/** The SQL that reads the switch from a document column as its JSON type ('false', 'true', 'integer'..., NULL when missing): json_type tells false from 0, and NULL comes back for a document that is not valid JSON (json_type would raise and break the poll). */
export const LIVE_SQL = "CASE WHEN json_valid(doc) THEN json_type(doc, '$.live') END";

/** The switch from LIVE_SQL's value (the JSON type of the key): on unless it is stored as an explicit false. A missing key, true, 0 or a string all mean on. */
export const liveFlagOf = (v) => v !== 'false';

/** The switch: one read of the one key. A missing row or key means on. */
export async function liveFlag(db, campaign) {
  const row = await db.prepare(`SELECT ${LIVE_SQL} AS live FROM campaigns WHERE id = ?1`).bind(campaign + '#gm').first();
  return liveFlagOf(row ? row.live : null);
}

/**
 * The phones' mirror switch (MM1, design 2.4): the GM state document's `mirror`, stored beside `live` in the same row, so the data poll's
 * one read of that row carries it for nothing. On unless it is an explicit false; same SQL shape as the live switch.
 */
export const MIRROR_SQL = "CASE WHEN json_valid(doc) THEN json_type(doc, '$.mirror') END";
export const mirrorFlagOf = (v) => v !== 'false';

/** The display kinds a phone's table screen may copy (MM1): a map and a handout, nothing else. */
export const SCREEN_KINDS = ['svg', 'handout'];
export const screenKind = (kind) => typeof kind === 'string' && SCREEN_KINDS.includes(kind);

/** The mirror switch on its own: one read of the one key. A missing row or key means on. */
export async function mirrorFlag(db, campaign) {
  const row = await db.prepare(`SELECT ${MIRROR_SQL} AS mirror FROM campaigns WHERE id = ?1`).bind(campaign + '#gm').first();
  return mirrorFlagOf(row ? row.mirror : null);
}

/**
 * Everything the data poll learns beyond the characters, in ONE statement and one D1 call: the campaign row's updated_at, the two
 * switches from the GM state row beside it (a single key each; the CASE keeps json_type off the document), and the table display's
 * seq and kind. The display's kind is read (json_extract, in SQL, so no JS parse and no svg ever reaches the Worker) only while the
 * mirror is not off. -> { at, live, mirror, screenSeq }
 *   screenSeq: the display's seq while the mirror is on and the display is an svg or a handout; 0 otherwise (a number and nothing
 *   else of the display: the phone asks /api/table/screen for the picture).
 */
export async function campaignStamp(db, campaign) {
  const state = campaign + '#gm';
  const row = await db.prepare(
    `SELECT (SELECT updated_at FROM campaigns WHERE id = ?1) AS at,
            (SELECT ${LIVE_SQL} FROM campaigns WHERE id = ?2) AS live,
            (SELECT ${MIRROR_SQL} FROM campaigns WHERE id = ?2) AS mirror,
            (SELECT seq FROM gm_display WHERE campaign = ?1) AS dseq,
            (SELECT CASE WHEN json_valid(doc) THEN json_extract(doc, '$.kind') END FROM gm_display WHERE campaign = ?1
               AND COALESCE((SELECT ${MIRROR_SQL} FROM campaigns WHERE id = ?2), '') != 'false') AS dkind`
  ).bind(campaign, state).first();
  const r = row || {};
  const mirror = mirrorFlagOf(r.mirror === undefined ? null : r.mirror);
  const screenSeq = mirror && screenKind(r.dkind) && Number.isInteger(r.dseq) && r.dseq > 0 ? r.dseq : 0;
  return { at: r.at === undefined ? null : r.at, live: liveFlagOf(r.live === undefined ? null : r.live), mirror, screenSeq };
}
