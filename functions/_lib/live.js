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

/** The kinds, and the roles that hear each. 'screen' (MM1) is reserved for phones: nothing sends it yet. */
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
 * campaignUpdatedAt and the switch in ONE read: the campaign row's updated_at and, from the GM state row beside it, the one key
 * (the CASE keeps json_type off the campaign document, which can be large). -> { at, live }
 */
export async function campaignStamp(db, campaign) {
  const state = campaign + '#gm';
  const { results } = await db.prepare(`SELECT id, updated_at, CASE WHEN id = ?2 THEN ${LIVE_SQL} END AS live FROM campaigns WHERE id IN (?1, ?2)`).bind(campaign, state).all();
  let at = null, live = null;
  for (const r of results || []) {
    if (r.id === campaign) at = r.updated_at;
    else if (r.id === state) live = r.live;
  }
  return { at, live: liveFlagOf(live) };
}
