// The pack guard (SYNC.md, "The pack guard"): a rebuilt or pushed pack must not quietly lose prep.
//
// On 16/10/2026 Obsidian Sync put an old copy of b68g-s02.md back on the PC: no `gm_prep: true`, 26 000 characters
// shorter. The next `npm run gm:pack` had no prep part at all, and Update pack (which removes parts the file lacks) would
// have emptied the Prep tab the night before the game. This compares the pack before with the pack after and lists what
// would be lost: a part gone, a part much smaller, a prep or screen note gone or much shorter. gm-pack.mjs and the push
// (lib/sync-pack.mjs) refuse on any loss unless --allow-shrink; the GM page's Update pack asks first (app/gm-page.js).

export const SHRINK = 0.75;        // a loss: under 75% of the size before
const MIN_BYTES = 2048, MIN_CHARS = 1000;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const sizeOf = (v) => (typeof v === 'number' ? v : Buffer.byteLength(typeof v === 'string' ? v : JSON.stringify(v)));
const kib = (n) => (n / 1024).toFixed(1) + ' KiB';
const base = (rel) => String(rel).split('/').pop().replace(/\.md$/i, '');

/** A prep part's notes: rel -> characters of Markdown in the note (its transclusions included). */
export function prepNotes(body) {
  const out = new Map();
  for (const n of isObj(body) && Array.isArray(body.notes) ? body.notes : []) {
    if (!isObj(n)) continue;
    out.set(String(n.rel || n.id), (Array.isArray(n.blocks) ? n.blocks : []).reduce((m, b) => m + (isObj(b) ? String(b.src || '').length : 0), 0));
  }
  return out;
}

/**
 * What the new pack would lose against the old one: [{ part, what }] (empty: nothing lost).
 * before / after: { <part>: body | byte count | null }. A byte count (the server's index) checks the size only.
 * opts.missing: a part the new pack lacks counts as lost (gm:pack and Update pack; the CLI push leaves such parts alone).
 */
export function packLosses(before, after, { missing = true } = {}) {
  const out = [];
  for (const [name, old] of Object.entries(isObj(before) ? before : {})) {
    if (old == null) continue;
    const now = isObj(after) ? after[name] : undefined;
    if (now == null) {
      if (missing) out.push({ part: name, what: 'the ' + name + ' part is gone' + (name === 'prep' ? ' (no note has gm_prep: true now)' : name === 'screen' ? ' (no note has gm_screen: true now)' : name === 'downtime' ? ' (no note has gm_downtime: true now)' : '') });
      continue;
    }
    const b0 = sizeOf(old), b1 = sizeOf(now);
    if (b0 >= MIN_BYTES && b1 < b0 * SHRINK) out.push({ part: name, what: 'the ' + name + ' part shrank from ' + kib(b0) + ' to ' + kib(b1) });
    if (name === 'prep' && isObj(old)) {
      const n0 = prepNotes(old), n1 = prepNotes(now);
      for (const [rel, c0] of n0) {
        const c1 = n1.get(rel);
        if (c1 == null) out.push({ part: 'prep', what: 'prep note ' + base(rel) + ' is gone (its gm_prep: true is missing, or it moved)' });
        else if (c0 >= MIN_CHARS && c1 < c0 * SHRINK) out.push({ part: 'prep', what: 'prep note ' + base(rel) + ' shrank from ' + c0 + ' to ' + c1 + ' characters' });
      }
    }
  }
  return out;
}

/** The refusal, as lines to print. */
export function lossLines(losses, how) {
  return ['REFUSED: this pack would lose prep the app has now:'].concat(losses.map((l) => '  - ' + l.what), [
    'Usually Obsidian Sync brought back an old copy of a note: restore it from the note\'s version history (Obsidian: right-click',
    'the note > Open version history), then run this again. If the loss is on purpose: ' + how + ' --allow-shrink',
  ]);
}
