// Authored sites (GM.md, "Authored sites"): a hand-built location the GM assigns to a score card, instead of a roll.
//
// The source is a location note in the vault's Locations/ folder holding one fenced block, ```json b68-site:
//   { "base":  { "seed": <integer>, "ui": { target, district, faction, approach }, "mem": "<json>" | { ... } },   (optional)
//     "patch": { "rooms": [{ "name", "band" }, ...], ...any other field of a location roll },                       (required)
//     "map":   { "view", "theme" },                                                                                  (optional)
//     "play":  { v, clock, floors, routes, people, disguises, events, clocks } }                                      (optional)
// `play` (app/gm/ball.js) is a site's timeline, routes and disguises, GM-only. It is checked against the patch's room names:
// what fails is dropped with a warning, keys it does not know are carried through. It rides here, not in a part of its own.
// The app rolls the base on the location generator (the street, the threats, the texture the card reads) and lays the patch
// over it (gm-page.js authoredRoll), so every tool that takes a roll (the card, the folds, the map, Show on iPad and its
// hidden-name check, the score scene) takes an authored site unchanged. Without a base, the base is a roll from a seed made
// from the note's name.
// A score card is bound to one by `site: "[[<note name>]]"` in its frontmatter (Campaigns/Group/Scores/).
//
// Carried in the LOCATION part (the server keeps at most 12 parts), as
//   authored: { v: 1, sites: { <note name>: { name, rel, base?, patch, map? } }, bind: { <score key>: <note name> } }
// or no `authored` key when the vault has none. A block that is not valid is skipped with a warning, never guessed at.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const { checkPlay } = createRequire(import.meta.url)('../../app/gm/ball.js');

export const LOCATIONS_REL = 'Wiki/Games/Blades in the Dark/Locations';
export const SCORES_REL = 'Wiki/Games/Blades in the Dark/Campaigns/Group/Scores';
export const BANDS = ['public', 'working', 'controlled', 'secure'];
export const VIEWS = ['rings', 'plan', 'iso', 'section'];
export const THEMES = ['rulebook', 'blueprint', 'casefile', 'board'];
export const LIMITS = { sites: 24, bytes: 60000, rooms: 40 };
const FENCE_RE = /^```json[ \t]+b68-site[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/m;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function mdFiles(dir) {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return []; }
  return ents.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md') && !e.name.startsWith('.')).map((e) => e.name).sort();
}
const readText = (f) => { try { return fs.readFileSync(f, 'utf8').replace(/^﻿/, ''); } catch (_) { return null; } };

/** The frontmatter's `site:` link target, or ''. */
export function siteLink(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  if (!m) return '';
  const line = m[1].split(/\r?\n/).find((l) => /^site:/.test(l));
  if (!line) return '';
  const v = line.slice(5).trim().replace(/^(["'])(.*)\1$/, '$2');
  return v.replace(/^\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
}

/** Does the note hold a ```json b68-site block (valid or not)? */
export function hasSiteBlock(text) { return FENCE_RE.test(String(text || '')); }

/** One note's site from its ```json b68-site block: { site } or { why }, or null when the note has no such block. */
export function parseSite(text, name, rel) {
  const m = FENCE_RE.exec(String(text || ''));
  if (!m) return null;
  if (m[1].length > LIMITS.bytes) return { why: 'the block is over ' + LIMITS.bytes + ' bytes' };
  let j; try { j = JSON.parse(m[1]); } catch (e) { return { why: 'the block is not valid JSON (' + e.message.slice(0, 60) + ')' }; }
  if (!isObj(j) || !isObj(j.patch)) return { why: 'the block has no "patch" object' };
  const rooms = j.patch.rooms;
  if (!Array.isArray(rooms) || !rooms.length || rooms.length > LIMITS.rooms) return { why: 'patch.rooms must list 1 to ' + LIMITS.rooms + ' rooms' };
  const bad = rooms.filter((r) => !isObj(r) || typeof r.name !== 'string' || !r.name.trim() || BANDS.indexOf(r.band) < 0);
  if (bad.length) return { why: bad.length + ' room(s) without a name or with a band that is not ' + BANDS.join(', ') };
  const site = { name, rel, patch: j.patch };
  if (j.base !== undefined) {
    const b = j.base;
    if (!isObj(b) || !Number.isInteger(b.seed)) return { why: 'base.seed must be a whole number' };
    let mem = b.mem;
    if (typeof mem === 'string') { try { mem = JSON.parse(mem || '{}'); } catch (_) { return { why: 'base.mem is not valid JSON' }; } }
    site.base = { seed: b.seed, ui: isObj(b.ui) ? b.ui : {}, mem: JSON.stringify(isObj(mem) ? mem : {}) };
  }
  if (isObj(j.map)) {
    const map = {};
    if (VIEWS.indexOf(j.map.view) >= 0) map.view = j.map.view;
    if (THEMES.indexOf(j.map.theme) >= 0) map.theme = j.map.theme;
    if (Object.keys(map).length) site.map = map;
  }
  if (j.play !== undefined) {
    const r = checkPlay(j.play, rooms.map((x) => x.name));
    if (r.play) site.play = r.play;
    return { site, warnings: r.warnings };
  }
  return { site };
}

/** The `authored` object for the location part, or null when the vault has no authored site. opts: { vault, warn }. */
export function buildAuthored({ vault, warn = () => {} }) {
  const dir = path.join(vault, ...LOCATIONS_REL.split('/')), sites = {};
  for (const f of mdFiles(dir)) {
    const name = f.slice(0, -3), rel = LOCATIONS_REL + '/' + f, r = parseSite(readText(path.join(dir, f)), name, rel);
    if (!r) continue;
    if (r.why) { warn('location: authored site ' + name + ' skipped: ' + r.why); continue; }
    if (Object.keys(sites).length >= LIMITS.sites) { warn('location: more than ' + LIMITS.sites + ' authored sites; ' + name + ' and later skipped'); break; }
    (r.warnings || []).forEach((w) => warn('location: authored site ' + name + ' ' + w));
    sites[name] = r.site;
  }
  if (!Object.keys(sites).length) return null;
  const sdir = path.join(vault, ...SCORES_REL.split('/')), bind = {}, lower = {};
  Object.keys(sites).forEach((n) => { lower[n.toLowerCase()] = n; });
  for (const f of mdFiles(sdir)) {
    const target = siteLink(readText(path.join(sdir, f)));
    if (target && lower[target.toLowerCase()]) bind[f.slice(0, -3)] = lower[target.toLowerCase()];
  }
  return { v: 1, sites, bind };
}
