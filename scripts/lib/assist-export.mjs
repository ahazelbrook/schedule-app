// The GM pack's `assist` part ("Claude at the table", functions/api/gm/assist.js): the cached prefix every seat reads.
// It is the rules reference, the NPC cast and tonight's prep, read from the vault and joined as the replay script joins them:
//   <context name="file.md">
//   ...the note as written...
//   </context>
// Part body: { prefix: string, extra?: { <seat>: string } }, plus `src` (provenance, never sent to a model).
//
// GM only. The prefix quotes the campaign, so the part is built on the GM's PC, pushed like any other part and served
// only by /api/gm/pack and /api/gm/assist, both of which refuse a player before they read anything. It is never in git.
//
// Which notes: the rules and the cast have fixed places in the vault; tonight's prep is the session note the GM names.
// The name comes from --assist-prep <vault-relative path> on gm-pack.mjs, else from gm-private/assist-config.json
// ({ "prep": "<vault-relative path>", "rules": "...", "cast": "...", "factions": "..." }; every key optional), which the GM's PC supplies.
// With neither there is no prep in the prefix and the build says so.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, NPCS, GROUP } from './vault.mjs';

export const DEFAULT_RULES = ROOT + '/Rules/blades-68-table-reference.md';
export const DEFAULT_CAST = ROOT + '/Tools/blades-68-npc-cast.md';
export const NPC_BLOCK_NAME = 'npc-how-to-play.md';
export const PLAYERS_NAME = 'players.md';
export const NEVER_NAME = 'never-reveal.md';
export const HANDOUTS_NAME = 'handouts.md';
export const FACTIONS_NAME = 'factions.md';
export const CHARACTERS = GROUP + '/Characters';
export const TOKEN_WARN = 90000;          // Haiku's price rises above 100k prompt tokens; warn well before it
export const CHARS_PER_TOKEN = 3.5;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const readText = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const posix = (p) => p.split(path.sep).join('/');

/** About how many tokens a prefix is (characters / 3.5, rounded up). */
export function estimateTokens(text) { return Math.ceil(String(text).length / CHARS_PER_TOKEN); }

/** One note as a context block; the name is the file's own name, as in the replay. */
export function contextBlock(file, text) {
  return '<context name="' + path.basename(file) + '">\n' + text + '\n</context>';
}

/** gm-private/assist-config.json -> { prep?, rules?, cast? }; a missing file is {}, a broken one throws. */
export function readConfig(file) {
  if (!file || !fs.existsSync(file)) return {};
  let c;
  try { c = JSON.parse(readText(file)); } catch (e) { throw new Error('assist config ' + path.basename(file) + ' is not valid JSON: ' + e.message); }
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('assist config ' + path.basename(file) + ' must be a JSON object');
  const out = {};
  for (const k of ['prep', 'rules', 'cast', 'factions']) {
    if (c[k] === undefined) continue;
    if (typeof c[k] !== 'string' || !c[k].trim()) throw new Error('assist config: ' + k + ' must be a vault-relative path');
    out[k] = c[k].trim();
  }
  return out;
}

function inside(vault, rel) {
  const p = path.resolve(vault, ...String(rel).split('/'));
  const r = path.relative(path.resolve(vault), p);
  if (!r || r.startsWith('..') || path.isAbsolute(r)) throw new Error('assist: ' + rel + ' is outside the vault');
  return p;
}


const HOW_HEAD = /^how\s*to\s*play\s*:?$/i;

/**
 * The "How to play" block of one NPC note: a callout headed "How to play" (any callout type, optional fold marker, any case),
 * else a heading of that name and the lines under it up to the next heading. Returns the block's lines (callout quoting
 * removed), or '' when the note has none.
 */
export function extractHowToPlay(text) {
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^>\s*\[![\w-]+\][+-]?\s*(.*)$/.exec(lines[i]);
    if (m && HOW_HEAD.test(m[1].trim())) {
      const out = [];
      for (let j = i + 1; j < lines.length && /^>/.test(lines[j]); j++) out.push(lines[j].replace(/^>\s?/, ''));
      const body = out.join('\n').trim();
      if (body) return body;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]);
    if (h && HOW_HEAD.test(h[2].replace(/[*_]/g, '').trim())) {
      const out = [];
      for (let j = i + 1; j < lines.length && !(/^#{1,6}\s/.test(lines[j]) && lines[j].replace(/^(#+).*/, '$1').length <= h[1].length); j++) out.push(lines[j]);
      const body = out.join('\n').trim();
      if (body) return body;
    }
  }
  return '';
}

// ---------- the never-reveal list ----------
// What the vault's notes say must not reach the players. Conventions it reads (heading or callout titles only; nothing is guessed):
//   tonight's prep:  a "Must land" section (list items = clues to get out; a ticked box [x] has landed, so it is left out);
//                    any heading or callout titled with secret / never reveal / GM only / hidden truth / the truth / reveal.
//   NPC notes:       a "Knows / doesn't know" section (what the NPC holds, which the players must not be handed by a prop);
//                    the same secret-style headings and callouts.
const MUST_LAND = /^must[\s-]*land\b/i;
const SECRET_HEAD = /\b(secrets?|never reveal(?:ed)?|do not reveal|don['’]t reveal|gm[\s-]*only|hidden truths?|the truth|reveal)\b/i;
const KNOWS_HEAD = /^knows\s*\/\s*(?:doesn['’]t|does not|doesnt)\s+know\b/i;
const plainTitle = (s) => String(s).replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();

/** The lines under a heading at lines[i], up to the next heading of the same or a shallower level. -> { body, end } (end = index after). */
function headingSection(lines, i, level) {
  let j = i + 1;
  while (j < lines.length) {
    const h = /^(#{1,6})\s/.exec(lines[j]);
    if (h && h[1].length <= level) break;
    j++;
  }
  return { body: lines.slice(i + 1, j).join('\n').trim(), end: j };
}

/**
 * The never-reveal sections of one note. -> [{ title, body }]. `knows` also takes a "Knows / doesn't know" section (NPC notes).
 * A section is a heading whose title matches, or a callout (any type) whose title matches; a heading section runs to the next
 * heading of its level or above, a callout to its last quoted line.
 */
export function extractSecretSections(text, { knows = false } = {}) {
  const lines = String(text).split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]);
    if (h) {
      const title = plainTitle(h[2]);
      if (SECRET_HEAD.test(title) || (knows && KNOWS_HEAD.test(title))) {
        const s = headingSection(lines, i, h[1].length);
        if (s.body) out.push({ title, body: s.body });
        i = s.end - 1;
      }
      continue;
    }
    const c = /^>\s*\[![\w-]+\][+-]?\s*(.*)$/.exec(lines[i]);
    if (c && SECRET_HEAD.test(plainTitle(c[1]))) {
      const q = [];
      let j = i + 1;
      for (; j < lines.length && /^>/.test(lines[j]); j++) q.push(lines[j].replace(/^>\s?/, ''));
      const body = q.join('\n').trim();
      if (body) out.push({ title: plainTitle(c[1]), body });
      i = j - 1;
    }
  }
  return out;
}

/**
 * The "Must land" list of a prep note: -> { found, entries: [text], landed: n }. found is whether a Must land heading exists.
 * An entry is a top-level list item and the lines indented under it; a ticked box ([x]) has landed and is counted, not listed.
 * A Must land section with no list items yields its plain text as one entry rather than nothing.
 */
export function extractMustLand(text) {
  const lines = String(text).split('\n');
  const entries = [];
  let found = false, landed = 0;
  for (let i = 0; i < lines.length; i++) {
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(lines[i]);
    if (!h || !MUST_LAND.test(plainTitle(h[2]))) continue;
    found = true;
    const s = headingSection(lines, i, h[1].length);
    const body = s.body.split('\n');
    const items = [];
    for (const l of body) {
      if (/^(?:[-*+]|\d+[.)])\s/.test(l)) items.push([l]);
      else if (items.length && /^\s+\S/.test(l)) items[items.length - 1].push(l);
    }
    for (const it of items) {
      const first = it[0].replace(/^(?:[-*+]|\d+[.)])\s+/, '');
      const box = /^\[( |x|X)\]\s*/.exec(first);
      if (box && box[1] !== ' ') { landed++; continue; }
      entries.push([box ? first.slice(box[0].length) : first, ...it.slice(1).map((x) => x.trim())].join('\n').trim());
    }
    if (!items.length) {
      const plain = body.filter((l) => !/^>/.test(l)).join('\n').trim();
      if (plain) entries.push(plain);
    }
    i = s.end - 1;
  }
  return { found, entries, landed };
}

/** The never-reveal context text, or '' when there is nothing. npc: [{ name, sections }]; prep: { name, entries, sections }. */
export function neverRevealText({ npc = [], prep = null } = {}) {
  const parts = [];
  if (npc.length) {
    parts.push('## What the NPCs hold (stable between nights)\n\n' + npc.map((n) => '### ' + n.name + '\n\n' + n.sections.map((s) => '**' + s.title + '**\n' + s.body).join('\n\n')).join('\n\n'));
  }
  if (prep && (prep.entries.length || prep.sections.length)) {
    const bits = [];
    if (prep.entries.length) bits.push('### Clues not yet landed\n\n' + prep.entries.map((e) => '- ' + e).join('\n'));
    for (const s of prep.sections) bits.push('### ' + s.title + '\n\n' + s.body);
    parts.push('## Tonight (from ' + prep.name + ')\n\n' + bits.join('\n\n'));
  }
  if (!parts.length) return '';
  return '# Never reveal\n\nThese are held back from the players. Nothing here may reach their screen unless the table has already got it.\n\n' + parts.join('\n\n') + '\n';
}

/** Every NPC note in `dir` with a never-reveal section -> { npc: [{ name, sections }], absent? }. */
export function collectNever(vault, dir = NPCS) {
  const d = inside(vault, dir);
  if (!fs.existsSync(d)) return { npc: [], absent: true };
  const files = fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name).sort((a, b) => a.localeCompare(b));
  const npc = [];
  for (const f of files) {
    const sections = extractSecretSections(readText(path.join(d, f)), { knows: true });
    if (sections.length) npc.push({ name: f.replace(/\.md$/, ''), sections });
  }
  return { npc };
}

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  const fm = {};
  if (!m) return fm;
  for (const l of m[1].split('\n')) {
    const k = /^([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(l);
    if (!k) continue;
    fm[k[1]] = k[2].replace(/^(["'])(.*)\1$/, '$2').trim();
  }
  return fm;
}

/** Every NPC note in `dir` (top level only) with a How to play block -> { entries: [{name, body}], missing: [name] }. */
export function collectHowToPlay(vault, dir = NPCS) {
  const d = inside(vault, dir);
  const entries = [], missing = [];
  if (!fs.existsSync(d)) return { entries, missing, absent: true };
  const files = fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name).sort((a, b) => a.localeCompare(b));
  for (const f of files) {
    const name = f.replace(/\.md$/, '');
    const body = extractHowToPlay(readText(path.join(d, f)));
    if (body) entries.push({ name, body }); else missing.push(name);
  }
  return { entries, missing };
}

/** One section: a heading per NPC and the block under it. */
export function npcBlockText(entries) {
  return '# NPC cards: how to play\n\n' + entries.map((e) => '## ' + e.name + '\n' + e.body).join('\n\n') + '\n';
}

/**
 * The handouts context text, or '' when there are none. Lists each handout's id, title and cue (`when`) only: never a file name.
 * items: the `handouts` pack part's items ([{ id, title, file, when? }]).
 */
export function handoutsText(items) {
  const rows = (Array.isArray(items) ? items : []).filter((x) => x && typeof x.id === 'string' && x.id && typeof x.title === 'string' && x.title)
    .map((x) => '- id: ' + x.id + ' | title: ' + x.title + (typeof x.when === 'string' && x.when ? ' | cue: ' + x.when : ''));
  if (!rows.length) return '';
  return ['# Handouts', '', 'Props the GM can show the table. Each line is an id, a title and the cue for the moment it belongs to.', '', ...rows, ''].join('\n');
}

// ---------- the factions block ----------
// The Meanwhile seat needs the factions: each one's name, tier, standing with the crew and clocks, kept short. It is read from the
// campaign's faction board in the vault: the note in the Group campaign folder with "faction" in its name (or "factions" in
// gm-private/assist-config.json). Conventions (heading-free, by table header): a table with Faction, Tier and Status columns
// (the board), and a table with Faction, Goal and Clock columns (the live clocks). Nothing is guessed: a cell that is not there is left out.
const CELL_MAX = 70, TICKS_MAX = 90;
const stripLinks = (s) => String(s).replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2').replace(/\*\(GM only\)\*/gi, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
const clipCell = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
// the status cell is "+1 *(confirmed 01/01/2030)*" or "0 → **−2**": keep the figure, drop the aside
const statusOf = (s) => clipCell(stripLinks(String(s).replace(/\*\([^)]*\)\*/g, '').replace(/\([^)]*\)/g, '')), CELL_MAX);

function tableRows(lines, i) {
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
  const head = cells(lines[i]).map((c) => stripLinks(c).toLowerCase());
  const rows = [];
  for (let j = i + 2; j < lines.length && /^\s*\|/.test(lines[j]); j++) rows.push(cells(lines[j]));
  return { head, rows, end: i + 2 + rows.length };
}

/**
 * The factions on a board note -> [{ name, tier, status, clocks: [{ goal, clock, ticks }] }], in the order the note gives them.
 * A faction in the clocks table but not the board still gets an entry; names that start the same way (Acme and
 * Acme Holdings) are one faction.
 */
export function extractFactions(text) {
  const lines = String(text).split('\n'), byName = [];
  const find = (name) => {
    const bare = (n) => n.toLowerCase().replace(/^the\s+/, '');
    const k = bare(name);
    return byName.find((f) => { const g = bare(f.name); return g === k || g.startsWith(k + ' ') || k.startsWith(g + ' '); });
  };
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1])) continue;
    const t = tableRows(lines, i);
    const col = (n) => t.head.indexOf(n);
    const fc = col('faction');
    if (fc < 0) { i = t.end - 1; continue; }
    if (col('tier') >= 0 && col('status') >= 0) {
      for (const r of t.rows) {
        const name = stripLinks(r[fc] || '');
        if (!name || find(name)) continue;
        byName.push({ name, tier: clipCell(stripLinks(r[col('tier')] || ''), 20), status: statusOf(r[col('status')] || ''), clocks: [] });
      }
    } else if (col('clock') >= 0 && (col('goal') >= 0 || col('ticks') >= 0)) {
      for (const r of t.rows) {
        const name = stripLinks(r[fc] || '');
        if (!name) continue;
        let f = find(name);
        if (!f) { f = { name, tier: '', status: '', clocks: [] }; byName.push(f); }
        f.clocks.push({
          goal: clipCell(stripLinks(col('goal') >= 0 ? r[col('goal')] || '' : ''), CELL_MAX),
          clock: clipCell(stripLinks(r[col('clock')] || ''), 30),
          ticks: col('ticks') >= 0 ? clipCell(stripLinks(r[col('ticks')] || ''), TICKS_MAX) : '',
        });
      }
    }
    i = t.end - 1;
  }
  return byName;
}

/** The factions context text, or '' when there are none: one line a faction, its clocks beneath it. */
export function factionsText(list) {
  const fs_ = (Array.isArray(list) ? list : []).filter((f) => f && f.name);
  if (!fs_.length) return '';
  const out = ['# Factions', '', 'Each faction with its tier, its standing with the crew and the clocks it is running. For off-screen cutaways: suggest a tick, never decide one.', ''];
  for (const f of fs_) {
    out.push('- ' + f.name + (f.tier ? ' | tier ' + f.tier : '') + (f.status ? ' | standing ' + f.status : ''));
    for (const c of f.clocks) out.push('  - clock: ' + [c.goal, c.clock, c.ticks ? 'ticks: ' + c.ticks : ''].filter(Boolean).join(' | '));
  }
  return out.join('\n') + '\n';
}

/** The faction board note in the Group campaign folder: a configured path, else the first top-level note with "faction" in its name. -> vault-relative path or ''. */
export function findFactionNote(vault, configured = '') {
  if (configured) return configured;
  const d = inside(vault, GROUP);
  if (!fs.existsSync(d)) return '';
  const hit = fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md') && /faction/i.test(e.name)).map((e) => e.name).sort((a, b) => a.localeCompare(b))[0];
  return hit ? GROUP + '/' + hit : '';
}

/** Character -> player from PC notes' `player:` property (the note's `character:` property, else its file name). */
export function playersFromNotes(vault, dir = CHARACTERS) {
  const d = inside(vault, dir), out = {};
  if (!fs.existsSync(d)) return out;
  for (const f of fs.readdirSync(d).filter((n) => n.endsWith('.md')).sort()) {
    const fm = frontmatter(readText(path.join(d, f)));
    if (fm.player) out[fm.character || f.replace(/\.md$/, '')] = fm.player;
  }
  return out;
}

/** gm-private/players.json -> { character: player }; missing is {}, broken throws. */
export function readPlayersFile(file) {
  if (!file || !fs.existsSync(file)) return {};
  let c;
  try { c = JSON.parse(readText(file)); } catch (e) { throw new Error('players file ' + path.basename(file) + ' is not valid JSON: ' + e.message); }
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('players file ' + path.basename(file) + ' must be a JSON object');
  const out = {};
  for (const [k, v] of Object.entries(c)) if (typeof v === 'string' && v.trim() && k.trim()) out[k.trim()] = v.trim();
  return out;
}

/** The file wins over the notes, per character. Returns { map, source: 'file' | 'notes' | 'both' | '' }. */
export function mergePlayers(fromNotes, fromFile) {
  const map = { ...fromNotes, ...fromFile };
  const nf = Object.keys(fromFile).length, nn = Object.keys(fromNotes).length;
  return { map, source: nf && nn ? 'both' : nf ? 'file' : nn ? 'notes' : '' };
}

export function playersText(map) {
  const rows = Object.entries(map).map(([c, p]) => '| ' + c + ' | ' + p + ' |');
  return '# Players and their characters\n\n| Character | Player |\n| --- | --- |\n' + rows.join('\n') + '\n';
}

/**
 * Build the assist part. opts: { vault, exportedAt, warn, prep (vault-relative), rules, cast, config (parsed) }.
 * After the rules and cast come the NPC cards' How to play blocks and the player table (from `player:` on PC notes, overridden by
 * `playersFile`, gm-private/players.json), then the handouts list (`handouts`: the pack's handouts part, if any), then the factions (name, tier, standing, clocks; from the Group campaign's faction board), then never-reveal; tonight's prep stays last. Returns null when no note could be read. A missing note is a warning, not a failure, except a prep path the GM named
 * explicitly (a typo there would quietly leave tonight's prep out), which throws.
 */
export function buildAssist({ vault, exportedAt, warn = () => {}, prep, rules, cast, config = {}, playersFile = '', handouts = null, factions, prepBy = '', prepDate = null }) {
  const want = [
    ['rules', rules || config.rules || DEFAULT_RULES, false],
    ['cast', cast || config.cast || DEFAULT_CAST, false],
    ['prep', prep || config.prep || '', true],
  ];
  const blocks = [], used = [], stats = {};
  for (const [what, rel, named] of want) {
    if (what === 'prep') {
      const npc = collectHowToPlay(vault);
      if (npc.absent) warn('assist: no NPC folder in the vault: the prefix has no How to play blocks');
      else {
        if (npc.missing.length) warn('assist: ' + npc.missing.length + ' NPC note(s) have no How to play block: ' + npc.missing.join(', '));
        if (npc.entries.length) { const t = npcBlockText(npc.entries); blocks.push(contextBlock(NPC_BLOCK_NAME, t)); used.push({ rel: NPC_BLOCK_NAME, sha: sha(t) }); stats.npcWith = npc.entries.length; }
        stats.npcWithout = npc.missing.length;
      }
      const pl = mergePlayers(playersFromNotes(vault), readPlayersFile(playersFile));
      if (pl.source) { const t = playersText(pl.map); blocks.push(contextBlock(PLAYERS_NAME, t)); used.push({ rel: PLAYERS_NAME, sha: sha(t) }); stats.players = pl.source; }
      else warn('assist: no player table (no player: on the PC notes, no gm-private/players.json): the prefix does not say who plays whom');
      // handouts: a stable block (it changes only when the handouts do), so it sits with the others, ahead of never-reveal and prep
      const ht = handoutsText(handouts && handouts.items);
      if (ht) { blocks.push(contextBlock(HANDOUTS_NAME, ht)); used.push({ rel: HANDOUTS_NAME, sha: sha(ht) }); stats.handouts = handouts.items.length; }
      // factions: for Meanwhile. It changes between sessions, not within one, so it sits with the stable blocks, ahead of never-reveal and prep
      const fRel = findFactionNote(vault, factions || config.factions || '');
      if (fRel && fs.existsSync(inside(vault, fRel))) {
        const list = extractFactions(readText(inside(vault, fRel))), ft = factionsText(list);
        if (ft) { blocks.push(contextBlock(FACTIONS_NAME, ft)); used.push({ rel: FACTIONS_NAME, sha: sha(ft) }); stats.factions = list.length; stats.factionClocks = list.reduce((n, f) => n + f.clocks.length, 0); }
        else warn('assist: the faction note ' + fRel + ' has no table with Faction, Tier and Status (or Faction, Goal and Clock) columns: Meanwhile has no factions to draw on');
      } else if (factions || config.factions) warn('assist: the faction note ' + (factions || config.factions) + ' is not in the vault: Meanwhile has no factions to draw on');
      // never-reveal: after the stable blocks, before tonight's prep. The NPC part is stable between nights; tonight's part follows it.
      const nv = collectNever(vault);
      let prepNever = null, noMust = false;
      if (rel) {
        const pf = inside(vault, rel);
        if (fs.existsSync(pf)) {
          const pt = readText(pf), ml = extractMustLand(pt);
          prepNever = { name: path.basename(pf), entries: ml.entries, sections: extractSecretSections(pt) };
          stats.prep = posix(rel); if (prepBy) { stats.prepBy = prepBy; if (Number.isInteger(prepDate)) stats.prepDate = prepDate; } stats.mustLand = ml.entries.length; stats.mustLandLanded = ml.landed;
          noMust = !ml.found;
          if (ml.found && !ml.entries.length) warn('assist: the prep note\'s "Must land" section has no unlanded entries (' + ml.landed + ' ticked): no clues in the never-reveal list');
        }
      }
      const nt = neverRevealText({ npc: nv.npc, prep: prepNever });
      stats.neverNpc = nv.npc.length;
      if (nt) { blocks.push(contextBlock(NEVER_NAME, nt)); used.push({ rel: NEVER_NAME, sha: sha(nt) }); }
      if (nt && noMust) warn('assist: the prep note has no "Must land" section: no unlanded clues in the never-reveal list');
      if (!nt) warn('assist: nothing found for the never-reveal list (no "Must land" section, no "Knows / doesn\'t know" on NPC notes, no secret-style headings): the gatekeeper has nothing to check against');
    }
    if (!rel) { warn('assist: no prep note named (--assist-prep <vault path>, or "prep" in gm-private/assist-config.json): the prefix has no prep'); continue; }
    const file = inside(vault, rel);
    if (!fs.existsSync(file)) {
      if (what === 'prep' && named) throw new Error('assist: the prep note ' + rel + ' does not exist in the vault');
      warn('assist: the ' + what + ' note ' + rel + ' is not in the vault: left out of the prefix');
      continue;
    }
    const text = readText(file);
    blocks.push(contextBlock(file, text)); used.push({ rel: posix(rel), sha: sha(text) });
  }
  if (!blocks.length) return null;
  const prefix = blocks.join('\n\n');
  const tokens = estimateTokens(prefix);
  if (tokens > TOKEN_WARN) warn('assist: the prefix is about ' + Math.round(tokens / 1000) + 'k tokens (over ' + TOKEN_WARN / 1000 + 'k; Haiku\'s price rises above 100k): trim the prep or the cast');
  return {
    src: { file: used.map((u) => u.rel).join(' + ').slice(0, 1200), blockSha: sha(used.map((u) => u.sha).join('\n')), exportedAt, tokens, ...stats },
    prefix,
  };
}
