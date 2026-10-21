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
// ({ "prep": "<vault-relative path>", "rules": "...", "cast": "..." }; every key optional), which the GM's PC supplies.
// With neither there is no prep in the prefix and the build says so.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, NPCS, GROUP } from './vault.mjs';

export const DEFAULT_RULES = ROOT + '/Rules/blades-68-table-reference.md';
export const DEFAULT_CAST = ROOT + '/Tools/blades-68-npc-cast.md';
export const NPC_BLOCK_NAME = 'npc-how-to-play.md';
export const PLAYERS_NAME = 'players.md';
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
  for (const k of ['prep', 'rules', 'cast']) {
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
 * `playersFile`, gm-private/players.json); tonight's prep stays last. Returns null when no note could be read. A missing note is a warning, not a failure, except a prep path the GM named
 * explicitly (a typo there would quietly leave tonight's prep out), which throws.
 */
export function buildAssist({ vault, exportedAt, warn = () => {}, prep, rules, cast, config = {}, playersFile = '' }) {
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
