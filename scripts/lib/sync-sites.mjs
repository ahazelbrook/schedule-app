// Score sites (GM.md "Score sites", SYNC.md "Pull"): a location roll the GM saved against a score card in the app, filed into
// the vault. For each GM state sites[<score key>]:
//   Locations/<Name>.md   the vault location generator's "Save this one" note (app/gm/location.js noteBody, the same builder),
//                         replayed from the site's seed, picks and memory over the local pack's location tables. Its
//                         frontmatter gains score: "[[<key>]]" and site_seed: <seed>; the map is embedded under its title;
//                         "## In play" gets a dated line naming the score.
//   Locations/<Name>.svg  the map (app/maps/map-kit.js), GM layer, in the view and theme the GM saved it in.
//   the score card        Campaigns/Group/Scores/<key>.md: site: "[[<Name>]]" in its frontmatter (added, or moved to a site
//                         saved again). The only edit to the card; a card elsewhere, or with no frontmatter, is refused.
// Nothing is deleted or replaced: a site saved again gets a new location note and the card's link moves; the old note stays.
// A card whose site: names an AUTHORED site (a Locations/ note with a ```json b68-site block, lib/authored-export.mjs) keeps it:
// the roll is still filed, but the link is not moved.
// Idempotent without the ledger: a location note whose frontmatter names this score and this seed is that site, filed.
// A replay that comes out as another place (the location tables changed since the save) is refused, not filed.
// The name is checked across the whole vault first (any .md, and any file of the map's name): taken -> "<Name> (location)".

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  LOCATIONS, SCORES, LOG, abs, readNote, toLines, fromLines, bare, headings, insertBlock, editNote, createNote, safeName, dmy,
  assertSiteWritable,
} from './vault.mjs';
import { hasSiteBlock } from './authored-export.mjs';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const KEY_RE = /^[^\u0000-\u001f"<>\\/:*?|#^[\]]{1,120}$/;          // a score card's file name, as the exporter gives it
const BANDS = ['public', 'working', 'controlled', 'secure'];
const VIEWS = ['rings', 'plan', 'iso', 'section'], THEMES = ['rulebook', 'blueprint', 'casefile', 'board'];
class Refusal extends Error {}

/** app/gm/location.js, app/maps/map-kit.js and the local pack's location part: { L, K, pk } or { why }. */
export function loadSiteKit(root, packFile) {
  try {
    const req = createRequire(import.meta.url);
    const lf = path.join(root, 'app', 'gm', 'location.js'), kf = path.join(root, 'app', 'maps', 'map-kit.js');
    if (!fs.existsSync(lf)) return { why: 'app/gm/location.js is not in this build' };
    if (!packFile || !fs.existsSync(packFile)) return { why: 'no local pack (npm run gm:pack)' };
    const pack = JSON.parse(fs.readFileSync(packFile, 'utf8')), parts = (pack && pack.parts) || {};
    if (!isObj(parts.location) || !isObj(parts.location.T)) return { why: 'the pack has no location part' };
    return { L: req(lf), K: fs.existsSync(kf) ? req(kf) : null, pk: { T: parts.location.T, extra: parts.location.extra } };
  } catch (e) { return { why: 'the location generator would not load (' + String(e && e.message || e).slice(0, 80) + ')' }; }
}

// ---------- frontmatter, line by line (the note's own line endings kept) ----------
/** The frontmatter's lines [start, end) (between the --- lines), or null. */
function fmRange(lines) {
  if (!lines.length || bare(lines[0]) !== '---') return null;
  for (let i = 1; i < lines.length; i++) if (bare(lines[i]) === '---' || bare(lines[i]) === '...') return { start: 1, end: i };
  return null;
}
/** A top-level frontmatter value, quotes off, or null. */
export function fmValue(text, key) {
  const lines = toLines(text), r = fmRange(lines); if (!r) return null;
  for (let i = r.start; i < r.end; i++) {
    const l = bare(lines[i]);
    if (l.startsWith(key + ':')) return l.slice(key.length + 1).trim().replace(/^(["'])(.*)\1$/, '$2');
  }
  return null;
}
const linkTarget = (v) => String(v || '').replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();

/** The card with its site: line set to [[fname]] (added before the closing ---, or replacing the old one and any lines indented
 *  under it). null when it already says so. Throws a Refusal for a card with no frontmatter. */
export function linkSite(text, eol, fname) {
  const lines = toLines(text), r = fmRange(lines);
  if (!r) throw new Refusal('the score card has no frontmatter');
  const line = 'site: "[[' + fname + ']]"', withEol = (l) => (eol === '\r\n' ? l + '\r' : l);
  let at = -1;
  for (let i = r.start; i < r.end; i++) if (/^site:/.test(bare(lines[i]))) { at = i; break; }
  if (at < 0) { lines.splice(r.end, 0, withEol(line)); return fromLines(lines); }
  let to = at + 1; while (to < r.end && /^\s+\S/.test(bare(lines[to]))) to++;
  if (to === at + 1 && bare(lines[at]) === line) return null;
  lines.splice(at, to - at, withEol(line));
  return fromLines(lines);
}

/** The location note: the generator's Save note, with the score, the seed, the map and the In play line added. */
export function siteNote(L, roll, pk, o) {
  const lines = toLines(L.noteBody(roll, { date: o.today, pack: pk })), r = fmRange(lines);
  if (r) lines.splice(r.end, 0, 'score: "[[' + o.key + ']]"', 'site_seed: ' + o.seed);
  if (o.svg) { const h = lines.findIndex((l) => /^# /.test(l)); if (h >= 0) lines.splice(h + 1, 0, '', '![[' + o.fname + '.svg]]'); }
  const H = headings(lines), label = String(o.label || '').replace(/[|\]\[]/g, '').trim();
  if (H['In play'] && H['In play'].length === 1) {
    insertBlock(lines, H['In play'][0], ['- **' + o.today + ' (app):** the site for [[' + o.key + (label ? '|' + label : '') + ']], saved in the GM app.'], { list: true });
  }
  return fromLines(lines);
}

// ---------- the vault: what is filed, what names are taken ----------
/** Location notes that are a score's site: [{ name, rel, score, seed }]. */
function filedSites(vault) {
  const dir = abs(vault, LOCATIONS), out = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return out; }
  for (const n of names) {
    if (!n.toLowerCase().endsWith('.md')) continue;
    let note = null; try { note = readNote(path.join(dir, n)); } catch (_) { continue; }
    if (!note) continue;
    const score = linkTarget(fmValue(note.text, 'score')), seed = Number(fmValue(note.text, 'site_seed'));
    if (score && Number.isFinite(seed)) out.push({ name: n.slice(0, -3), rel: LOCATIONS + '/' + n, score, seed });
  }
  return out;
}
/** One walk of the vault: .md basenames (lower case) -> [rel], and every file name (lower case, with its extension). */
function vaultNames(vault) {
  const md = new Map(), any = new Set();
  (function walk(dir, rel) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) { walk(path.join(dir, e.name), r); continue; }
      any.add(e.name.toLowerCase());
      if (e.name.toLowerCase().endsWith('.md')) { const k = e.name.slice(0, -3).toLowerCase(); if (!md.has(k)) md.set(k, []); md.get(k).push(r); }
    }
  })(vault, '');
  return { md, any };
}

// ---------- pull ----------
/** The authored site (lib/authored-export.mjs) the card's site: names now, or ''. A card bound to one keeps it: the vault chose it. */
function authoredOn(vault, card) {
  let n = null; try { n = readNote(abs(vault, card)); } catch (_) { return ''; }
  const target = n ? linkTarget(fmValue(n.text, 'site')) : '';
  if (!target) return '';
  let loc = null; try { loc = readNote(abs(vault, LOCATIONS + '/' + target + '.md')); } catch (_) { return ''; }
  return loc && hasSiteBlock(loc.text) ? target : '';
}
function linkCard(ctx, card, fname, key) {
  const { vault, report } = ctx;
  try {
    const au = authoredOn(vault, card);
    if (au && au !== fname) { report.skip({ kind: 'sitelink', id: key }, 'the card\'s site: is the authored site ' + au + ', so it stays'); return; }
    assertSiteWritable(card);
    let changed;
    if (ctx.dryRun) { const n = readNote(abs(vault, card)); if (!n) throw Object.assign(new Error('note missing'), { code: 'MISSING' }); changed = linkSite(n.text, n.eol, fname) !== null; }
    else changed = editNote(vault, card, (n) => linkSite(n.text, n.eol, fname), { site: true }).changed;
    if (changed) report.file({ kind: 'sitelink', id: key }, path.posix.basename(card, '.md'), ctx.dryRun);
  } catch (e) {
    if (e instanceof Refusal || ['RACE', 'NOT_UTF8', 'MISSING'].includes(e.code) || /not a score card|no-touch|never writes/.test(e.message)) report.refuse('site', 'the score card was not linked: ' + e.message, [], key);
    else throw e;
  }
}

export function pullSites(ctx, injected) {
  const { vault, ledger, report } = ctx;
  const sites = isObj(ctx.doc && ctx.doc.sites) ? ctx.doc.sites : {};
  const keys = Object.keys(sites).filter((k) => isObj(sites[k])).sort();
  if (!keys.length) return;
  ledger.sites = ledger.sites || {};
  const today = dmy(new Date(ctx.now)), at = new Date(ctx.now).toISOString(), created = [];
  let kit = null, filed = null, names = null;

  for (const key of keys) {
    const x = sites[key];
    if (!KEY_RE.test(key) || typeof x.seed !== 'number') { report.refuse('site', 'not a site the app saves (a bad key or no seed)', [], key); continue; }
    names = names || vaultNames(vault);
    const hits = names.md.get(key.toLowerCase()) || [];
    const card = hits.find((r) => r.startsWith(SCORES + '/')) || hits[0] || null;
    if (!card) { report.refuse('site', 'no score card named ' + key + '.md in the vault (renamed since the site was saved?)', [], key); continue; }
    filed = filed || filedSites(vault);
    const have = filed.find((f) => f.score.toLowerCase() === key.toLowerCase() && f.seed === x.seed);
    if (have) { report.skip({ kind: 'site', id: key }, 'already in the vault'); linkCard(ctx, card, have.name, key); continue; }

    if (!kit) kit = injected || loadSiteKit(ctx.root, ctx.packFile || path.join(ctx.privateDir, 'b68-gm-pack.json'));
    if (kit.why) { report.refuse('site', 'cannot replay it: ' + kit.why, [], key); continue; }
    let mem = {};
    try { mem = typeof x.mem === 'string' ? JSON.parse(x.mem) : isObj(x.mem) ? x.mem : {}; } catch (_) { mem = {}; }
    let roll;
    try { roll = kit.L.generate(kit.pk, isObj(x.ui) ? x.ui : {}, { seed: x.seed, mem: isObj(mem) ? mem : {} }); }
    catch (e) { report.refuse('site', 'the replay failed (' + String(e && e.message || e).slice(0, 80) + ')', [], key); continue; }
    if (x.name && String(roll.name) !== String(x.name)) { report.refuse('site', 'the location tables changed since the site was saved: its seed now gives another place, so nothing was filed. Open it in the app and save it again', [], key); continue; }
    const safe = safeName(roll.name || '');
    if (!safe) { report.refuse('site', 'the place has no name a file can hold', [], key); continue; }
    const options = [safe, safe + ' (location)'].concat([2, 3, 4, 5, 6, 7, 8, 9].map((n) => safe + ' (location ' + n + ')'));
    const fname = options.find((c) => !names.md.has(c.toLowerCase()) && !names.any.has((c + '.md').toLowerCase()) && !names.any.has((c + '.svg').toLowerCase()));
    if (!fname) { report.refuse('site', 'its name is taken in the vault ten times over', [], key); continue; }

    let svg = null;
    if (kit.K && typeof kit.K.render === 'function') {
      const m = isObj(x.map) ? x.map : {};
      try { svg = kit.K.render(roll, { view: VIEWS.includes(m.view) ? m.view : 'rings', theme: THEMES.includes(m.theme) ? m.theme : 'rulebook', layer: 'gm', reveal: BANDS, width: 1400 }).svg; }
      catch (e) { svg = null; report.note('site ' + key + ': the map would not draw (' + String(e && e.message || e).slice(0, 80) + '); the note is filed without it'); }
      if (svg !== null && (typeof svg !== 'string' || !/^\s*<svg[\s>]/.test(svg))) { svg = null; report.note('site ' + key + ': the map kit gave no svg; the note is filed without it'); }
    } else report.note('the map kit is not in this build: site notes are filed without a map');
    const text = siteNote(kit.L, roll, kit.pk, { key, label: x.label || '', seed: x.seed, fname, svg: !!svg, today });
    const rel = LOCATIONS + '/' + fname + '.md';
    if (!ctx.dryRun) {
      try { createNote(vault, rel, text); }
      catch (e) { if (e.code === 'EXISTS') { report.refuse('site', 'a file appeared with that name mid-run', [], key); continue; } throw e; }
      if (svg) {
        try { createNote(vault, LOCATIONS + '/' + fname + '.svg', svg); }
        catch (e) { if (e.code !== 'EXISTS') throw e; report.note('site ' + key + ': its map file appeared mid-run; the note links to that one'); }
      }
      ledger.sites[key] = { seed: x.seed, rel, at };
    }
    names.md.set(fname.toLowerCase(), [rel]); names.any.add((fname + '.md').toLowerCase()); if (svg) names.any.add((fname + '.svg').toLowerCase());
    filed.push({ name: fname, rel, score: key, seed: x.seed });
    report.file({ kind: 'site', id: key }, fname, ctx.dryRun);
    created.push({ fname, key, label: String(x.label || '').replace(/[|\]\[]/g, '').trim() });
    linkCard(ctx, card, fname, key);
  }
  if (created.length && !ctx.dryRun) logSites(ctx, created, today);
}

function logSites(ctx, created, today) {
  const { vault } = ctx;
  if (!readNote(abs(vault, LOG))) { ctx.report.note('Wiki/log.md not found: no log entry written'); return; }
  editNote(vault, LOG, (n) => {
    const e = n.eol, t = n.text;
    const lead = t.endsWith(e + e) ? '' : t.endsWith('\n') ? e : e + e;
    return t + lead + '## [' + today + '] sync | GM app: ' + created.length + ' score site' + (created.length > 1 ? 's' : '') + e +
      '- Filed ' + created.map((c) => '[[' + c.fname + ']] for [[' + c.key + (c.label ? '|' + c.label : '') + ']]').join(', ') +
      ' from sites saved in the GM app: a location note and its map in `Locations/`, linked from the score card\'s `site:`. Filed by `npm run gm:sync`.' + e;
  });
}
