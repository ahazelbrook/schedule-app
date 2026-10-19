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
import { ROOT } from './vault.mjs';

export const DEFAULT_RULES = ROOT + '/Rules/blades-68-table-reference.md';
export const DEFAULT_CAST = ROOT + '/Tools/blades-68-npc-cast.md';
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

/**
 * Build the assist part. opts: { vault, exportedAt, warn, prep (vault-relative), rules, cast, config (parsed) }.
 * Returns null when no note could be read. A missing note is a warning, not a failure, except a prep path the GM named
 * explicitly (a typo there would quietly leave tonight's prep out), which throws.
 */
export function buildAssist({ vault, exportedAt, warn = () => {}, prep, rules, cast, config = {} }) {
  const want = [
    ['rules', rules || config.rules || DEFAULT_RULES, false],
    ['cast', cast || config.cast || DEFAULT_CAST, false],
    ['prep', prep || config.prep || '', true],
  ];
  const blocks = [], used = [];
  for (const [what, rel, named] of want) {
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
    src: { file: used.map((u) => u.rel).join(' + ').slice(0, 1200), blockSha: sha(used.map((u) => u.sha).join('\n')), exportedAt, tokens },
    prefix,
  };
}
