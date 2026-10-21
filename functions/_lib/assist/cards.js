// The night's shown cards, read back from gm_assist_log (the log IS the store: nothing else keeps a card). Used by
// GET/POST /api/gm/assist/cards (the Claude box restores its chat after a reload) and by scripts/gm-after.mjs (the "Claude's
// notes" section of the session note). Plain ES module, node-importable; it takes any D1-shaped db.
//
// What a row's card JSON carries (functions/api/gm/assist.js writes it): text, keys, shown:1 for a card the Editor let through,
// update:1 (+ items) for a Ledger row, detail { said_at, rule } for a Ref slip, and the marks written here:
//   seen:1 (read in the box)  dismissed:1 (Got it)  kept:1 (starred)  done:[i] (Ledger items applied or dismissed)
//   filed:1 (gm:after put it in the session note)
// Ask Blade's rows (seat 'ask', ask:1, q, text) are never `shown` cards: they ride beside cards and updates as `asks`, and the box marks one
// by (at, question): a dismiss or keep matches c.ask === 1 and c.q === the item's text. gm:after never files them (it reads cards only).
// A card is identified to the box by (at, text) and a Ledger item by (at, key, text): the same three values the tick answer
// carries, so a card that arrives by tick and the same card restored after a reload are one card.

export const NIGHT_MS = 12 * 60 * 60 * 1000;
const LIMIT = 300;
export const OPS = ['seen', 'dismiss', 'keep'];
export const MARK_MAX = 50;
export const ASKS_MAX = 10;                  // Ask Blade answers handed back to the box

function parse(s) { try { const v = JSON.parse(s); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch (_) { return null; } }
const str = (v) => (typeof v === 'string' ? v : '');

/**
 * Tonight's shown cards and Ledger items, oldest first.
 *   opts.since    ISO time; default now - 12 h
 *   opts.session  keep rows logged under this session or under none (the box passes nothing)
 *   opts.all      include dismissed cards and finished Ledger items (gm:after files everything shown)
 * -> { cards: [{ row, seat, at, text, detail?, important, seen, kept, filed, dismissed }],
 *      updates: [{ row, i, seat: 'ledger', at, key, text }],
 *      asks: [{ row, at, q, text, kept }] }      Ask Blade's answers, oldest first, the last ASKS_MAX only
 */
export async function nightCards(db, campaign, { since, now = Date.now(), session, all = false } = {}) {
  const from = since || new Date(now - NIGHT_MS).toISOString();
  const sql = "SELECT id, at, session, seat, card FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2 AND card IS NOT NULL AND (json_extract(card, '$.shown') = 1 OR json_extract(card, '$.update') = 1)" +
    (session !== undefined && session !== null && session !== '' ? " AND (session = ?3 OR session = '')" : '') + ' ORDER BY id LIMIT ' + LIMIT;
  const q = db.prepare(sql);
  const { results } = await (session !== undefined && session !== null && session !== '' ? q.bind(campaign, from, String(session)) : q.bind(campaign, from)).all();
  const cards = [], updates = [];
  for (const r of results || []) {
    const c = parse(r.card); if (!c) continue;
    if (c.update === 1) {
      const items = Array.isArray(c.items) && c.items.length ? c.items : [{ key: (c.keys || [])[0] || '', text: c.text }];
      const done = Array.isArray(c.done) ? c.done : [];
      items.forEach((it, i) => {
        if (!str(it.text).trim() || (!all && done.includes(i))) return;
        updates.push({ row: r.id, i, seat: 'ledger', at: r.at, key: str(it.key), text: str(it.text) });
      });
      continue;
    }
    if (!str(c.text).trim() || (!all && c.dismissed === 1)) continue;
    const seat = str(c.seat) || (r.seat === 'editor' ? 'ref' : r.seat);
    const d = c.detail && typeof c.detail === 'object' ? c.detail : null;
    cards.push({ row: r.id, session: str(r.session), seat, at: r.at, text: str(c.text), ...(d ? { detail: { said_at: str(d.said_at), rule: str(d.rule) } } : {}),
      important: seat === 'ref', seen: c.seen === 1, kept: c.kept === 1, filed: c.filed === 1, dismissed: c.dismissed === 1 });
  }
  return { cards, updates, asks: await nightAsks(db, campaign, from, all) };
}

/** Ask Blade's answers since `from` (a separate small query: an ask row is never a shown card), oldest first, the last ASKS_MAX. */
async function nightAsks(db, campaign, from, all) {
  const { results } = await db.prepare("SELECT id, at, card FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2 AND seat = 'ask' AND card IS NOT NULL AND json_extract(card, '$.ask') = 1 AND COALESCE(json_extract(card, '$.text'), '') != '' ORDER BY id DESC LIMIT " + LIMIT).bind(campaign, from).all();
  const out = [];
  for (const r of results || []) {
    const c = parse(r.card); if (!c || !str(c.text).trim() || (!all && c.dismissed === 1)) continue;
    out.push({ row: r.id, at: r.at, q: str(c.q), text: str(c.text), kept: c.kept === 1 });
    if (out.length >= ASKS_MAX) break;
  }
  return out.reverse();
}

/** Clean a mark request's items: [{ at, text, key? }] with the bounds the route promises. Returns null when it is not valid. */
export function cleanMarks(items) {
  if (!Array.isArray(items) || !items.length || items.length > MARK_MAX) return null;
  const out = [];
  for (const it of items) {
    if (!it || typeof it !== 'object' || typeof it.at !== 'string' || !it.at || it.at.length > 40 || typeof it.text !== 'string' || !it.text || it.text.length > 600) return null;
    if (it.key !== undefined && (typeof it.key !== 'string' || it.key.length > 200)) return null;
    out.push({ at: it.at, text: it.text, ...(it.key !== undefined ? { key: it.key } : {}) });
  }
  return out;
}

/** Write a mark ('seen' | 'dismiss' | 'keep') onto the rows the items name. Returns how many items matched. */
export async function markCards(db, campaign, op, items) {
  const edits = new Map();      // row id -> card json
  let matched = 0;
  for (const it of items) {
    const { results } = await db.prepare('SELECT id, card FROM gm_assist_log WHERE campaign = ?1 AND at = ?2 AND card IS NOT NULL').bind(campaign, it.at).all();
    for (const r of results || []) {
      const c = edits.get(r.id) || parse(r.card); if (!c) continue;
      if (c.update === 1) {
        if (op !== 'dismiss' && op !== 'seen') continue;       // a Ledger item is applied or dismissed; it is not read or starred
        const list = Array.isArray(c.items) && c.items.length ? c.items : [{ key: (c.keys || [])[0] || '', text: c.text }];
        const i = list.findIndex((x) => str(x.text) === it.text && (it.key === undefined || str(x.key) === it.key));
        if (i < 0 || op === 'seen') continue;
        c.done = Array.from(new Set((Array.isArray(c.done) ? c.done : []).concat(i))).sort((a, b) => a - b);
      } else if (c.ask === 1) {
        if (op === 'seen' || c.q !== it.text) continue;        // an Ask Blade answer is matched by its question; it is dismissed or kept, not "seen"
        c[op === 'dismiss' ? 'dismissed' : 'kept'] = 1;
      } else {
        if (c.shown !== 1 || c.text !== it.text) continue;
        c[op === 'dismiss' ? 'dismissed' : op === 'keep' ? 'kept' : 'seen'] = 1;
      }
      edits.set(r.id, c); matched++;
    }
  }
  if (edits.size) await db.batch([...edits].map(([id, c]) => db.prepare('UPDATE gm_assist_log SET card = ?1 WHERE id = ?2 AND campaign = ?3').bind(JSON.stringify(c), id, campaign)));
  return matched;
}

/** gm:after filed these rows into the session note: remember it, so the box can say "saved to history". */
export async function markFiled(db, campaign, rowIds) {
  const ids = Array.from(new Set(rowIds));
  if (!ids.length) return 0;
  const stmts = [];
  for (const id of ids) {
    const r = await db.prepare('SELECT card FROM gm_assist_log WHERE id = ?1 AND campaign = ?2').bind(id, campaign).first();
    const c = r && parse(r.card);
    if (c && c.filed !== 1) stmts.push(db.prepare('UPDATE gm_assist_log SET card = ?1 WHERE id = ?2 AND campaign = ?3').bind(JSON.stringify({ ...c, filed: 1 }), id, campaign));
  }
  if (stmts.length) await db.batch(stmts);
  return stmts.length;
}
