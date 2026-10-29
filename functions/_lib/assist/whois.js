// Who is who (seat `whois`): Blade suggests which person each Deepgram speaker number is. Plain ES module, no I/O: the Worker reads the
// lines and the roster, this file turns them into the seat's turn and turns the seat's answer into suggestions the GM may tap.
// A suggestion is only ever shown to the GM (the tick and /whois answers); it is never stored in the listening document, which the table
// display can read, and nothing is applied without the GM's tap.
//
// The roster is the assist part's `roster`: { players: { "<character>": "<player>" }, gm: "<name>" } (scripts/lib/assist-export.mjs). The
// Worker never holds the prefix text, so the part carries these names beside the file id. Validation is a set lookup: a name that is not
// a player's or the GM's is dropped, so the seat cannot invent a person.

export const WHOIS_LINES = 120;        // lines of this connection the seat reads (SQL LIMIT)
export const WHOIS_MIN_LINES = 8;      // an unnamed number must have said this many of them before the tick wakes the seat
export const WHOIS_NOW_MIN_LINES = 3;  // the "Blade, guess" button asks about any number with this many
export const WHOIS_NOW_GAP_MS = 10 * 1000;   // between two button presses (the 3-minute cooldown is for the tick)
export const WHY_MAX = 80;
export const LINE_CLIP = 240;          // characters of one line the seat reads
export const ROSTER_MAX = 16;

const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

/** The roster from an assist part body: { players: [{ character, player }], gm } or null when the part has no names. */
export function rosterOf(body) {
  const r = body && typeof body === 'object' ? body.roster : null;
  if (!r || typeof r !== 'object') return null;
  const players = [];
  if (r.players && typeof r.players === 'object' && !Array.isArray(r.players)) {
    for (const [character, player] of Object.entries(r.players)) {
      if (players.length >= ROSTER_MAX) break;
      const p = clean(player, 60), c = clean(character, 60);
      if (typeof player === 'string' && p && c) players.push({ character: c, player: p });
    }
  }
  const gm = typeof r.gm === 'string' ? clean(r.gm, 60) : '';
  return players.length || gm ? { players, gm } : null;
}

const key = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
/** Every name the seat may answer with, as a Map of lower-case -> the name as the roster spells it. */
export function allowedNames(roster) {
  const m = new Map();
  if (!roster) return m;
  for (const p of roster.players) m.set(key(p.player), p.player);
  if (roster.gm) m.set(key(roster.gm), roster.gm);
  return m;
}

/** Is the number named? A blank name counts as unnamed. */
const named = (speakers, n) => !!(speakers && typeof speakers[String(n)] === 'string' && speakers[String(n)].trim());

/**
 * The speaker numbers worth asking about: unnamed ones with at least `min` lines. lines: oldest first, { speaker, kind }.
 * -> [{ n, count }] in number order.
 */
export function unnamedNeeds(lines, speakers, min = WHOIS_MIN_LINES) {
  const counts = new Map();
  for (const l of lines || []) {
    if (!l || l.kind === 'mark' || !Number.isInteger(l.speaker)) continue;
    counts.set(l.speaker, (counts.get(l.speaker) || 0) + 1);
  }
  return [...counts].filter(([n, c]) => c >= min && !named(speakers, n)).map(([n, count]) => ({ n, count })).sort((a, b) => a.n - b.n);
}

/** Does any line in this stretch come from an unnamed number? (the tick's cheap pre-filter on the lines it already holds) */
export function anyUnnamed(lines, speakers) {
  return (lines || []).some((l) => l && l.kind !== 'mark' && Number.isInteger(l.speaker) && !named(speakers, l.speaker));
}

/** The seat's turn: the roster, the numbers to identify, the names the GM has already given, and the talk as "S<n>: text". */
export function whoisUser({ roster, needs, speakers, lines }) {
  const known = Object.keys(speakers || {}).filter((k) => named(speakers, k)).sort((a, b) => a - b).map((k) => 'S' + k + ' is ' + clean(speakers[k], 60));
  const talk = (lines || []).filter((l) => l.kind !== 'mark' && Number.isInteger(l.speaker))
    .map((l) => 'S' + l.speaker + ': ' + clean(l.text, LINE_CLIP)).join('\n');
  return 'People at the table:\n' +
    roster.players.map((p) => '- ' + p.player + ' plays ' + p.character).join('\n') + (roster.players.length ? '\n' : '') +
    (roster.gm ? '- ' + roster.gm + ' is the GM\n' : '') +
    'Identify these speaker numbers: ' + needs.map((x) => 'S' + x.n + ' (' + x.count + ' lines)').join(', ') + '.\n' +
    (known.length ? 'The GM has already named: ' + known.join('; ') + '.\n' : '') +
    'The last ' + (lines || []).length + ' lines of this connection (the numbers are one connection only):\n' + talk;
}

/**
 * The seat's answer -> { <n>: { name, why } } for the numbers that were asked about and whose name is on the roster. Anything else is dropped:
 * a number nobody asked about, a name that is not a player's or the GM's, a repeat of the same number, and a name claimed for two numbers
 * (ambiguous, so neither is kept). `why` is plain text clipped to WHY_MAX; the page still escapes it.
 */
export function toWhois(json, roster, asked) {
  const out = {};
  const list = json && Array.isArray(json.guesses) ? json.guesses : [];
  const ok = allowedNames(roster), want = new Set((asked || []).map((x) => (typeof x === 'number' ? x : x.n)));
  const byName = new Map();
  for (const g of list) {
    if (!g || typeof g !== 'object' || !Number.isInteger(g.speaker) || !want.has(g.speaker) || typeof g.name !== 'string') continue;
    const name = ok.get(key(g.name));
    if (!name || Object.prototype.hasOwnProperty.call(out, String(g.speaker))) continue;
    out[String(g.speaker)] = { name, why: clean(g.why, WHY_MAX) };
    byName.set(name, (byName.get(name) || 0) + 1);
  }
  for (const [n, v] of Object.entries(out)) if (byName.get(v.name) > 1) delete out[n];
  return out;
}
