// The counts a sheet map must pass before gm:sheets writes it (RK33). Pure: no files, no Python, no network. scripts/gm-sheets.mjs feeds it the raw map (plus any hand
// fix) and the character data in app/content.js. It holds the rules of the design's section 3 and none of the publisher's text: names come from content.js.
//
//   expectFor(playbook)       what the page must hold, from content.js
//   checkMap(map, expect)     [{ region, got, want, ok, why? }]  (ok false = the page does not agree with the data)
//   applyFix(map, fix)        the map with a fix file's regions put over it; a fix may also `waive` a region with the reason
//   verdict(checks, fix)      { ok, failed: [region], waived: [{ region, why }] }  (ok when every failed check is waived)
import fs from 'node:fs';
import vm from 'node:vm';

/* The twelve pages, in the order of the printed book (a page's number is its place here). */
export const PAGE_ORDER = ['hound', 'hull', 'intellectual', 'operative', 'radical', 'paranormalist', 'swinger', 'veteran', 'ghost', 'vampire', 'timetraveler', 'timepast'];
export const ACTION_COUNT = 12;
export const HARM_LINES = 6;      /* levels 4, 3, 2 and 2, 1 and 1: the page's six writing lines */
export const KEY_ROWS = 4;
export const KEY_HITS = 3;
export const XP_PLAYBOOK = 8;
export const XP_ATTRIBUTE = 6;
export const STACKS = 4;
export const BANK = 40;
const DEFAULT_STRESS = 9;
const DEFAULT_DOTS = 4;

/** Load app/content.js (a browser script that sets window.B68Content) in a sandbox and return B68Content. */
export function loadContent(file) {
  const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file });
  if (!ctx.B68Content) throw new Error('content.js did not set B68Content');
  return ctx.B68Content;
}

export function playbookById(content, id) {
  const all = [].concat(content.PLAYBOOKS || [], content.PARANORMAL || []);
  return all.find((p) => p.id === id) || null;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[‘’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** A playbook whose resource line gives its own track a length in the form "<word> (N boxes ...": N is the box count. */
function drainBoxes(p) { const m = /\((\d+) boxes/.exec(String(p.resource || '')); return m ? Number(m[1]) : 0; }

/** What a page must hold, for one playbook of content.js. */
export function expectFor(content, id) {
  const p = playbookById(content, id);
  if (!p) throw new Error('no playbook "' + id + '" in content.js');
  const paranormal = !!p.paranormal;
  /* a playbook whose items are a rule, not a list (the Ghost/Echo) prints no item lines */
  const own = (p.items || []).map((i) => ({ n: i[0], load: i[1], own: true }));
  const items = p.itemsRule && !own.length ? [] : own.concat((content.STANDARD_ITEMS || []).map((i) => ({ n: i[0], load: i[1], own: false })));
  return {
    id, name: p.name, paranormal,
    stress: p.stressMax || drainBoxes(p) || DEFAULT_STRESS,
    xp: XP_PLAYBOOK, xpi: XP_ATTRIBUTE, xpp: XP_ATTRIBUTE, xpr: XP_ATTRIBUTE,
    acts: ACTION_COUNT, dots: p.maxDot || DEFAULT_DOTS,
    /* the playbook's abilities, its fixed one, and Versatile on the ordinary playbooks (the paranormal pages print no Versatile) */
    abilities: (p.abilities || []).length + (p.fixedAbility ? 1 : 0) + (paranormal ? 0 : 1),
    items,
    stacks: STACKS, bank: p.bank === false ? 0 : BANK,
    friends: (p.contacts || []).map((c) => (Array.isArray(c) ? c.join(', ') : String(c))),
    keys: KEY_ROWS, hits: KEY_HITS, harm: HARM_LINES,
    heal: 1,
  };
}

/** One check row. */
const row = (region, got, want, extra) => Object.assign({ region, got, want, ok: got === want }, extra || {});

const tokens = (s) => norm(s).split(' ').filter(Boolean);
const subset = (a, b) => a.length > 0 && a.every((t) => b.includes(t));

/** Pair each content item with the page line that prints it. Exact names first (a line is used once), then a line whose words are all in the data's name or the other
    way round ("Second bandolier (3 uses)" for the page's "Bandolier (3 uses)"). Returns { pairs: [{ item, line|null }], spare: [lines no item claimed] }. */
export function pairItems(pageItems, items) {
  const used = new Set();
  const pairs = items.map((item) => ({ item, line: null }));
  for (const p of pairs) {
    const hit = pageItems.find((l) => !used.has(l) && norm(l.n) === norm(p.item.n));
    if (hit) { p.line = hit; used.add(hit); }
  }
  for (const p of pairs) {
    if (p.line) continue;
    const w = tokens(p.item.n);
    const hit = pageItems.find((l) => !used.has(l) && (subset(tokens(l.n), w) || subset(w, tokens(l.n))));
    if (hit) { p.line = hit; used.add(hit); }
  }
  return { pairs, spare: pageItems.filter((l) => !used.has(l)) };
}

/** What is wrong with one paired item: nothing (''), or a short reason. A standard item's squares are its load. A playbook item that takes a load shows that many
    squares; one that takes none (load 0) is printed in italics with its one tick box. */
export function itemProblem(item, line) {
  if (!line) return 'no line';
  const n = line.s.length;
  if (item.own && item.load === 0) return n >= 1 && line.i ? '' : (n < 1 ? 'no box' : 'not in italics');
  return n === item.load ? '' : n + ' square(s), data says ' + item.load;
}

/** Check a map against what the page must hold. Each row names a region; a row that fails says why. Regions a fix added are not checked (nothing to count them against). */
export function checkMap(map, exp) {
  const out = [];
  const len = (v) => (Array.isArray(v) ? v.length : 0);
  out.push(row('stress', len(map.stress), exp.stress));
  out.push(row('xp', len(map.xp), exp.xp));
  out.push(row('xpi', len(map.xpi), exp.xpi));
  out.push(row('xpp', len(map.xpp), exp.xpp));
  out.push(row('xpr', len(map.xpr), exp.xpr));
  const acts = map.acts || {};
  out.push(row('acts', Object.keys(acts).length, exp.acts));
  const dotCounts = Object.keys(acts).map((k) => len(acts[k].d));
  out.push(row('dots', dotCounts.every((n) => n === exp.dots) ? dotCounts.length * exp.dots : dotCounts.reduce((a, b) => a + b, 0), exp.acts * exp.dots,
    { why: dotCounts.every((n) => n === exp.dots) ? undefined : 'dots per action ' + dotCounts.join('') }));
  out.push(row('abilities', len(map.ab), exp.abilities));
  /* items: every content item has its own page line with the right squares, and the page holds no line the data does not know */
  const pageItems = Array.isArray(map.items) ? map.items : [];
  const { pairs, spare } = pairItems(pageItems, exp.items);
  const bad = pairs.map((p) => [p.item.n, itemProblem(p.item, p.line)]).filter((x) => x[1]).map((x) => x[0] + ': ' + x[1]).concat(spare.map((l) => l.n + ': a line the data does not know'));
  out.push(row('items', pageItems.length, exp.items.length, { why: bad.length ? bad.join('; ') : undefined }));
  out.push(row('item loads', bad.length, 0, { why: bad.length ? bad.join('; ') : undefined }));
  out.push(row('stacks', len(map.stacks), exp.stacks));
  out.push(row('bank', len(map.bank), exp.bank));
  out.push(row('harm', len(map.harm), exp.harm));
  out.push(row('heal', map.heal ? 1 : 0, exp.heal));
  const keys = Array.isArray(map.keys) ? map.keys : [];
  const hitsBad = keys.filter((k) => len(k.hits) !== exp.hits).length;
  out.push(row('keys', keys.length, exp.keys));
  out.push(row('key hits', hitsBad, 0, { why: hitsBad ? 'rows with a hit count other than ' + exp.hits + ': ' + keys.map((k) => len(k.hits)).join('/') : undefined }));
  const friends = Array.isArray(map.friends) ? map.friends : [];
  out.push(row('friends', friends.length, exp.friends.length));
  return out;
}

/** Put a fix file's regions over a raw map. A fix is { regions: { <region>: <value> }, waive: { <region or check name>: <reason> }, note }. A region a fix names
    replaces the raw one whole (the fix is the page's truth for it); the result also records which regions were hand-fixed. */
export function applyFix(map, fix) {
  if (!fix) return map;
  const out = Object.assign({}, map);
  const fixed = [];
  for (const [k, v] of Object.entries(fix.regions || {})) {
    if (k === 'kinds') out.kinds = Object.assign({}, out.kinds, v); else { out[k] = v; fixed.push(k); }
  }
  if (fixed.length) out.fixed = fixed;
  return out;
}

/** Which check names a region key belongs to, so a waiver on 'stress' also covers the row 'stress'. Names equal themselves. */
const FAMILY = { 'item loads': 'items', 'key hits': 'keys', dots: 'acts' };

/** The verdict: ok when every failed check is waived by the fix (a waiver names the check or its region and gives a reason). */
export function verdict(checks, fix) {
  const waive = (fix && fix.waive) || {};
  const failed = checks.filter((c) => !c.ok);
  const waived = [];
  const unwaived = [];
  for (const c of failed) {
    const why = waive[c.region] || waive[FAMILY[c.region]];
    if (why && String(why).length >= 8) waived.push({ region: c.region, why: String(why) }); else unwaived.push(c.region);
  }
  return { ok: unwaived.length === 0, failed: unwaived, waived };
}

/** A fix's own sanity: it may name only regions in the schema's shape (rect lists, objects) and never carry text longer than a note. Returns problems. */
export function fixProblems(fix) {
  const out = [];
  if (!fix || typeof fix !== 'object') return ['not an object'];
  if (fix.regions && typeof fix.regions !== 'object') out.push('regions is not an object');
  for (const [k, w] of Object.entries(fix.waive || {})) if (typeof w !== 'string' || w.length < 8) out.push('waive "' + k + '" needs a reason (8 characters or more)');
  return out;
}
