#!/usr/bin/env node
// Build the GM pack (format 1) from the Blades '68 vault's own tools.
//
//   node scripts/gm-pack.mjs --vault "C:\Vault\Hazel Second Brain" --out gm-private/b68-gm-pack.json
//
// The pack holds the generators' tables (the T objects), which are '68 text and GM-only secrets.
// It is written to gm-private/ (git-ignored), never committed; the GM uploads it in the browser.
// Zero npm dependencies: node:vm, node:fs, node:crypto only.
//
// Parts (independent):
//   console   T from Tools/views/gm-console/view.js
//   location  T (+ extra: the other top-level consts the generator reads) from the location generator, and `authored`: the
//             hand-built sites in Locations/ notes (a ```json b68-site block) and the score cards bound to them by `site:`
//             (lib/authored-export.mjs). No authored site: no `authored` key.
//   campaign  pcs, callbacks, cast, standing, owed, npcs, names, clocks (mirrors view.js readPCs/pipeList/readNPCs/readNames)
//             (pcs[].file is each character sheet's file name: the NPC generator's initials rule uses file names)
//             and crew: the crew sheet's { name, type, tier, hold, enemies[], abilities[] } (the note under Campaigns/Group/
//             whose frontmatter has `crew_type`; wikilinks reduced to their text), or null when there is no such note
//   npc       T (NPC generator tables, cut before `const POOL`), cast (anchor rows from blades-68-npc-cast.md, the vault's own
//             regex), F (the figure map). T.leverage[].t are functions in the vault; they are stored as data
//             { f, t: "...{v}...", lower, head } and every one is round-trip tested, or the export fails.
//   scenes    T from the district scene roller (Tools/blades-68-district-scenes.md, cut at `// --- Machinery`), plus
//             T.ratingLabels (the four district rating labels, probed from the vault's ratings()). Checked: the time-of-day
//             rule in generate() matches the keys of T.weather, the %F% placeholder is still used, every district is complete.
//   score     (optional) T from the score generator page (Tools/blades-68-score-generator.md, cut at `// --- Machinery`), with
//             T.loc laid over it from the location part: factionDetail, factionThumb, district (the names), gaz { <district>:
//             { factions[], notables[] } } and targetNames, so the dossiers and districts have one source. No such page: no
//             part. Checked: the app module's own check(T), the faction master against the location page's, and every building
//             type, district and faction a table borrows from the location page; all of these are warnings.
//
//   prep      the prep notes: every note under the '68 folder with `gm_prep: true`, cut into Markdown blocks with their
//             transclusions carried in, each task box with its anchor (lib/prep-export.mjs). No such note: no part.
//
//   screen    the GM screen: the note under the '68 folder with `gm_screen: true`, cut at its ## headings into sections
//             of Markdown (lib/screen-export.mjs). No such note: no part.
//
//   downtime  T.benefit and T.mishap, the house rule's two d100 tables (the Morning After), from the note under the '68
//             folder with `gm_downtime: true`: its "## Benefits" and "## Mishaps" entries (lib/downtime-export.mjs). Laid
//             over the app's built-in downtime tables; it is the only place they live outside the vault. No such note: no part.
//
//   handouts  the manifest of the prop images the GM can show on the iPad: [{ id, title, file, when? }] (lib/handouts-export.mjs).
//             Manifest only: the images are git-ignored static files in app/media/handouts/ (npm run gm:handouts). No images: no part.
//
//   assist    { prefix }: the cached prefix for "Claude at the table" (functions/api/gm/assist.js): the rules reference, the NPC
//             cast, every NPC card's How to play block, the player-to-character table (player: on the PC notes, or the git-ignored
//             gm-private/players.json, which wins) and tonight's prep (last) as <context name="..."> blocks (lib/assist-export.mjs). GM only. This file keeps the text;
//             gm-sync push uploads it to Anthropic's Files API and pushes only { file_id, hash, extra } (lib/assist-file.mjs). Tonight's prep is
//             --assist-prep <vault-relative note> or "prep" in gm-private/assist-config.json; with neither, the gm_prep: true session note with the
//             soonest date on or after today (else the newest) is picked and printed (lib/assist-prep.mjs; --today DD/MM/YYYY overrides today); warns past ~90k tokens.
//             The part also carries extra.<seat> (text appended to that seat's instructions, e.g. a house-rule checklist for Ref): the body of a vault note, frontmatter
//             stripped, at most 4,000 characters. "extra": { "<seat>": "<note>" } in assist-config.json, or --assist-extra <seat>=<note> (repeatable, wins per seat).
//             src.extra.<seat> records { rel, chars, sha }, never the text.
//
// F (the figure map) comes from the vault page Tools/blades-68-npc-figure-map.md, read as JSON from fenced code blocks:
//   ```json F          the whole F object (use this form for a small map), or
//   ```json F.<key>    one top-level key of F per block (e.g. ```json F.faction), merged in page order.
//   Any other fence is ignored. If the page is missing, or holds no such block, F is exported as null with a warning.
//   A block that is not valid JSON fails the export.
//
// Idempotent: a part whose source is unchanged keeps its previous exportedAt, so a second run writes the same bytes.
//
// The guard (lib/pack-guard.mjs): when the new pack would lose prep against the pack file already there (the prep or
// screen part gone, a prep note gone or much shorter, any part far smaller), nothing is written and the run exits 1.
// --allow-shrink writes it anyway.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { basenames } from "./lib/vault.mjs";
import { buildPrep, npcCard } from "./lib/prep-export.mjs";
import { packLosses, lossLines } from "./lib/pack-guard.mjs";
import { buildScreen } from "./lib/screen-export.mjs";
import { buildDowntime } from "./lib/downtime-export.mjs";
import { buildAssist, readConfig, parseExtraSpec } from "./lib/assist-export.mjs";
import { resolvePrep, dateKey } from "./lib/assist-prep.mjs";
import { buildHandouts } from "./lib/handouts-export.mjs";
import { buildAuthored } from "./lib/authored-export.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const PART_CAP = 900 * 1024;        // the server's per-part cap (contract)
const { countPlay } = createRequire(import.meta.url)("../app/gm/ball.js");
const Rooms = createRequire(import.meta.url)("../app/gm/room-notes.js");     // find(): a prep note's ## Rooms section, read as the GM page reads it
const Score = createRequire(import.meta.url)("../app/gm/score.js");     // check(T) and fkey(): the app's own definitions of a complete table set and of a matching name

// ---- args ---------------------------------------------------------------------------------------------
function args(argv) {
  const o = { vault: process.env.B68_VAULT || "", out: "gm-private/b68-gm-pack.json", quiet: false, allowShrink: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vault") o.vault = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--quiet") o.quiet = true;
    else if (a === "--allow-shrink") o.allowShrink = true;
    else if (a === "--handouts-src") o.handoutsSrc = argv[++i];
    else if (a === "--assist-prep") o.assistPrep = argv[++i];
    else if (a === "--assist-config") o.assistConfig = argv[++i];
    else if (a === "--assist-extra") { try { const [seat, rel] = parseExtraSpec(argv[++i] || ""); (o.assistExtra = o.assistExtra || {})[seat] = rel; } catch (e) { console.error(e.message); process.exit(2); } }
    else if (a === "--today") { o.today = argv[++i]; if (dateKey(o.today) === null) { console.error("--today takes DD/MM/YYYY"); process.exit(2); } }
    else if (a === "-h" || a === "--help") { console.log("usage: node scripts/gm-pack.mjs --vault <vault dir> [--out gm-private/b68-gm-pack.json] [--quiet] [--allow-shrink]"); console.log("  [--assist-prep <vault-relative session note>] [--assist-config <file>] [--assist-extra <seat>=<vault-relative note>]... [--today DD/MM/YYYY]"); process.exit(0); }
    else { console.error("unknown argument: " + a); process.exit(2); }
  }
  if (!o.vault) { console.error("--vault <vault dir> is required (or set B68_VAULT)"); process.exit(2); }
  return o;
}

const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const warnings = [];
const warn = m => { warnings.push(m); };
const kb = n => (n / 1024).toFixed(1).padStart(8) + " KB";
const readText = f => fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");

// ---- JSON hygiene -------------------------------------------------------------------------------------
// Deep-clone to plain JSON; anything that is not JSON is dropped and its path is reported.
function toJson(v, p, dropped) {
  if (v === null) return null;
  const t = typeof v;
  if (t === "string" || t === "boolean") return v;
  if (t === "number") { if (Number.isFinite(v)) return v; dropped.push(p + " (non-finite number)"); return undefined; }
  if (t === "function") { dropped.push(p + " (function)"); return undefined; }
  if (t === "undefined" || t === "symbol" || t === "bigint") { dropped.push(p + " (" + t + ")"); return undefined; }
  if (v instanceof RegExp || Object.prototype.toString.call(v) === "[object RegExp]") { dropped.push(p + " (RegExp)"); return undefined; }
  if (Array.isArray(v)) {
    return Array.from(v, (x, i) => { const r = toJson(x, p + "[" + i + "]", dropped); return r === undefined ? null : r; });   // Array.from: a host array even for a vm-realm one
  }
  if (t === "object") {
    const out = {};
    for (const k of Object.keys(v)) {
      const r = toJson(v[k], p ? p + "." + k : k, dropped);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  dropped.push(p + " (" + t + ")");
  return undefined;
}

// ---- vm runner ----------------------------------------------------------------------------------------
// Stubs for everything a Dataview module could reach. Table statements only touch T, so the UI never runs.
function stubContext() {
  const noop = () => {};
  const chain = () => new Proxy(function () {}, { get: (_, k) => (k === "array" ? () => [] : k === Symbol.toPrimitive ? () => "" : chain()), apply: () => chain() });
  const ctx = {
    dv: { pages: () => ({ where: () => ({ array: () => [] }), array: () => [] }), page: () => null, current: () => ({ file: { name: "gm-pack" } }),
      io: { load: async () => "" }, container: chain(), el: noop, header: noop, paragraph: noop, span: noop },
    app: { vault: { getAbstractFileByPath: () => null }, fileManager: { processFrontMatter: async () => {} } },
    input: {}, document: chain(), window: {}, localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    Notice: function Notice() {}, console: { log: noop, warn: noop, error: noop, info: noop },
    setTimeout: noop, setInterval: noop, clearTimeout: noop, clearInterval: noop, requestAnimationFrame: noop,
  };
  ctx.window = ctx;
  return vm.createContext(ctx);
}

// Run `code` (a function-body of statements) with the stubs; return {globals, error}. Never throws.
function runBody(code, label) {
  const ctx = stubContext();
  let error = null;
  try {
    vm.runInContext("(function(){\n" + code + "\n})()", ctx, { filename: label, timeout: 5000 });
  } catch (e) { error = e; }
  return { ctx, error };
}

function summariseKeys(T) {
  return Object.keys(T).map(k => {
    const v = T[k];
    const n = Array.isArray(v) ? "[" + v.length + "]" : v && typeof v === "object" ? "{" + Object.keys(v).length + "}" : typeof v;
    return k + n;
  });
}

const LATE_T = /^\s*T\.[A-Za-z_$][\w$]*(\[[^\]\n]*\])*\s*(=|\+=)[^=]/m;

// ---- part: console ------------------------------------------------------------------------------------
function buildConsole(vault, exportedAt) {
  const file = path.join(vault, "Wiki", "Games", "Blades in the Dark", "Tools", "views", "gm-console", "view.js");
  const text = readText(file);
  const decl = text.match(/^const T = \{\};[ \t]*$/m);
  if (!decl) throw new Error("console: `const T = {};` not found in view.js");
  const declEnd = decl.index + decl[0].length;
  // Table statements are above the live-campaign section; stop there so no vault/UI code runs.
  const stop = text.search(/^\/\/ --- Campaign data/m);
  if (stop < 0) throw new Error("console: the `// --- Campaign data` marker is missing from view.js; update the exporter");
  const rest = text.slice(stop);
  if (LATE_T.test(rest)) warn("console: `T.x = ...` statements exist AFTER the cut at `// --- Campaign data`; they are NOT in the pack");
  const code = text.slice(0, declEnd) + "\nglobalThis.__T = T;\n" + text.slice(declEnd, stop) + "\n";
  const { ctx, error } = runBody(code, "gm-console/view.js");
  if (error) throw new Error("console: table statements threw: " + error.message);
  if (!ctx.__T || !Object.keys(ctx.__T).length) throw new Error("console: T is empty");
  const dropped = [];
  const T = toJson(ctx.__T, "T", dropped);
  if (dropped.length) warn("console: dropped non-JSON values: " + dropped.join(", "));
  return { src: { file: rel(vault, file), blockSha: sha(text), exportedAt }, T };
}

// ---- part: location -----------------------------------------------------------------------------------
// Top-level consts after the tables that the generator's logic or plan renderer reads. All single-line statements.
const LOCATION_EXTRA = [
  ["BAND_RANGE"], ["ROMAN"], ["SERVICE_RE"],              // generate(): room quotas, roman numerals, service-room test
  ["CANVAS_BAND"], ["RING_R"],                            // plan canvas (rings diagram)
  ["NODE_W", "NODE_H", "VECTOR_R", "RING_WIDEN"],         // plan canvas geometry (one statement)
];

function buildLocation(vault, exportedAt) {
  const file = path.join(vault, "Wiki", "Games", "Blades in the Dark", "Tools", "blades-68-location-generator.md");
  const text = readText(file);
  const open = text.match(/^```dataviewjs[ \t]*$/m);
  if (!open) throw new Error("location: no ```dataviewjs block found");
  const bodyStart = open.index + open[0].length + 1;
  const close = text.indexOf("\n```", bodyStart);
  if (close < 0) throw new Error("location: the dataviewjs block is not closed");
  const block = text.slice(bodyStart, close);
  const decl = block.match(/^const T = \{\};[ \t]*$/m);
  if (!decl) throw new Error("location: `const T = {};` not found in the block");
  const declEnd = decl.index + decl[0].length;
  // The tables end where the machinery (rng, memory, generate()) begins.
  const stopM = block.match(/^\/\/ --- Machinery -+\s*$/m) || block.match(/^const pick = /m);
  if (!stopM) throw new Error("location: could not find where the tables end (`// --- Machinery`)");
  const stop = stopM.index;
  const rest = block.slice(stop);
  if (LATE_T.test(rest)) warn("location: `T.x = ...` statements exist AFTER the tables/machinery cut; they are NOT in the pack");

  const extraLines = [];
  const extraNames = [];
  for (const names of LOCATION_EXTRA) {
    const re = new RegExp("^const " + names[0] + "\\b.*;[ \\t]*$", "m");
    const m = rest.match(re);
    if (!m) { warn("location: extra const " + names.join("/") + " not found; skipped"); continue; }
    extraLines.push(m[0]);
    extraNames.push(...names);
  }
  const code = block.slice(0, declEnd) + "\nglobalThis.__T = T;\n" + block.slice(declEnd, stop) + "\n" + extraLines.join("\n") +
    "\nglobalThis.__X = {" + extraNames.join(",") + "};\n";
  const { ctx, error } = runBody(code, "blades-68-location-generator.md");
  if (error) throw new Error("location: table statements threw: " + error.message);
  if (!ctx.__T || !Object.keys(ctx.__T).length) throw new Error("location: T is empty");
  const dropped = [];
  const T = toJson(ctx.__T, "T", dropped);
  // A RegExp is the one non-JSON extra we keep, in an explicit shape: { $re, flags }.
  const rawX = ctx.__X || {};
  const x = {};
  for (const k of Object.keys(rawX)) {
    const v = rawX[k];
    x[k] = Object.prototype.toString.call(v) === "[object RegExp]" ? { $re: v.source, flags: v.flags } : v;
  }
  const extra = toJson(x, "extra", dropped);
  if (dropped.length) warn("location: dropped non-JSON values: " + dropped.join(", "));
  // authored sites: hand-built locations bound to score cards (lib/authored-export.mjs); here, not a part of their own (12 parts max)
  const authored = buildAuthored({ vault, warn });
  const out = { src: { file: rel(vault, file), blockSha: authored ? sha(block + "\u0000" + JSON.stringify(authored)) : sha(block), exportedAt }, T, extra, _extraNames: extraNames };
  if (authored) out.authored = authored;
  return out;
}

// ---- part: npc ----------------------------------------------------------------------------------------
// T.leverage[].t are arrow functions of one string. toJson would drop them silently, so each is probed with a marker
// and stored as data: { f, t: "...{v}...", lower?, head? }. Applying it: x = v; if head, x = x.split(" — ")[0];
// if lower, x = x.toLowerCase(); result = t with "{v}" replaced by x. Every shape is then checked against the original
// function on several values; any mismatch throws (a wrong sentence in the pack is worse than no pack).
const LEV_MARK = "ZzMarkQ — TailQ";
const LEV_SAMPLES = ["Alpha", "Beta Gamma — Delta", "ÉCLAIR — x — y", "mIxEd CaSe", "a$&b$1", "", "Trailing —", "— leading"];
function applyLeverage(shape, v) {
  let x = String(v);
  if (shape.head) x = x.split(" — ")[0];
  if (shape.lower) x = x.toLowerCase();
  return shape.t.replace("{v}", () => x);
}
function leverageToData(fn, f, idx) {
  const label = "npc: T.leverage[" + idx + "] (" + f + ")";
  const out = String(fn(LEV_MARK));
  const forms = [
    { head: false, lower: false, needle: LEV_MARK },
    { head: false, lower: true, needle: LEV_MARK.toLowerCase() },
    { head: true, lower: false, needle: LEV_MARK.split(" — ")[0] },
    { head: true, lower: true, needle: LEV_MARK.split(" — ")[0].toLowerCase() },
  ];
  // longest needle first, so the full marker is not mistaken for its head
  forms.sort((a, b) => b.needle.length - a.needle.length);
  const hit = forms.find(m => out.includes(m.needle));
  if (!hit) throw new Error(label + " does not echo its argument in a recognised form (verbatim, lower-cased, or head before ' — ')");
  if (out.split(hit.needle).length !== 2) throw new Error(label + " uses its argument more than once; the exporter's {v} form holds one");
  if (out.includes("{v}")) throw new Error(label + " already contains the literal {v}");
  const shape = { f, t: out.replace(hit.needle, "{v}") };
  if (hit.lower) shape.lower = true;
  if (hit.head) shape.head = true;
  for (const v of LEV_SAMPLES) {
    if (String(fn(v)) !== applyLeverage(shape, v)) throw new Error(label + " does not round-trip on a test value (the stored form gives different text); the leverage function does something the exporter cannot express");
  }
  return shape;
}

const FIGMAP_PAGE = ["Wiki", "Games", "Blades in the Dark", "Tools", "blades-68-npc-figure-map.md"];

// The vault's own cast regex (generator page loadCast): one row per anchor, name in bold in the first cell.
function parseCast(text) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\|\s*\*\*(.+?)\*\*[^|]*\|(.*)$/);
    if (!m) continue;
    const c = m[2].split("|").map(s => s.trim());
    if (c.length < 4 || !c[0]) continue;
    out.push({ n: m[1].trim(), status: c[0], pace: c[1], borrow: c[2], never: c[3] });
  }
  return out;
}

// ```json F  or  ```json F.<key>  fences of the figure-map page -> F, or null
function parseFigureMap(text) {
  const lines = text.split("\n");
  let F = null;
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^```json[ \t]+(F(?:\.[A-Za-z_$][\w$-]*)?)[ \t]*$/);
    if (!open) continue;
    let j = i + 1;
    while (j < lines.length && !/^```[ \t]*$/.test(lines[j])) j++;
    if (j >= lines.length) throw new Error("npc: the figure-map block '" + open[1] + "' is not closed");
    let val;
    try { val = JSON.parse(lines.slice(i + 1, j).join("\n")); } catch (e) { throw new Error("npc: the figure-map block '" + open[1] + "' is not valid JSON (" + e.message + ")"); }
    if (open[1] === "F") {
      if (!val || typeof val !== "object" || Array.isArray(val)) throw new Error("npc: block 'F' must be a JSON object");
      F = Object.assign(F || {}, val);
    } else {
      (F ||= {})[open[1].slice(2)] = val;
    }
    i = j;
  }
  return F;
}

function buildNpc(vault, exportedAt) {
  const tools = path.join(vault, "Wiki", "Games", "Blades in the Dark", "Tools");
  const genFile = path.join(tools, "blades-68-npc-generator.md");
  const text = readText(genFile);
  const open = text.match(/^```dataviewjs[ \t]*$/m);
  if (!open) throw new Error("npc: no ```dataviewjs block found in the generator page");
  const bodyStart = open.index + open[0].length + 1;
  const close = text.indexOf("\n```", bodyStart);
  if (close < 0) throw new Error("npc: the dataviewjs block is not closed");
  const block = text.slice(bodyStart, close);
  const decl = block.match(/^const T = \{\};[ \t]*$/m);
  if (!decl) throw new Error("npc: `const T = {};` not found in the generator block");
  const declEnd = decl.index + decl[0].length;
  const stopM = block.match(/^const POOL = /m);
  if (!stopM) throw new Error("npc: `const POOL = ` not found; the tables are cut before it");
  const stop = stopM.index;
  if (LATE_T.test(block.slice(stop))) warn("npc: `T.x = ...` statements exist AFTER `const POOL`; they are NOT in the pack");
  const code = block.slice(0, declEnd) + "\nglobalThis.__T = T;\n" + block.slice(declEnd, stop) + "\n";
  const { ctx, error } = runBody(code, "blades-68-npc-generator.md");
  if (error) throw new Error("npc: table statements threw: " + error.message);
  const rawT = ctx.__T;
  if (!rawT || !Object.keys(rawT).length) throw new Error("npc: T is empty");

  // leverage: functions -> data (fails loudly)
  if (!Array.isArray(rawT.leverage) || !rawT.leverage.length) throw new Error("npc: T.leverage is missing or empty");
  const leverage = rawT.leverage.map((s, i) => {
    if (!s || typeof s.f !== "string" || typeof s.t !== "function") throw new Error("npc: T.leverage[" + i + "] is not { f: string, t: function }");
    return leverageToData(s.t, s.f, i);
  });
  const dropped = [];
  const T = toJson(Object.assign({}, rawT, { leverage }), "T", dropped);
  if (dropped.length) throw new Error("npc: non-JSON values in T would be dropped: " + dropped.join(", "));
  // generate() holds one rule as a literal: which heritage rolls a telltale. It is data in the pack (T.telltaleHeritage),
  // so the app's code carries no heritage name.
  const tt = block.match(/o\.telltale\s*=\s*h\.n\s*===\s*("(?:[^"\\]|\\.)*")\s*\?\s*pick\(T\.telltale\)\s*:\s*null/);
  if (!tt) throw new Error("npc: the telltale rule in generate() was not found; update the exporter");
  T.telltaleHeritage = JSON.parse(tt[1]);
  if (!T.heritage.some(h => h.n === T.telltaleHeritage)) warn("npc: the telltale heritage is not in T.heritage; telltales will never roll");

  // the cast
  const castFile = path.join(tools, "blades-68-npc-cast.md");
  let castText = "";
  let cast = [];
  try { castText = readText(castFile); cast = parseCast(castText); } catch (e) { warn("npc: the cast page is unreadable (" + e.message + "); cast is empty"); }
  if (!cast.length) warn("npc: no cast anchors parsed; the generator will roll a status and dial instead");

  // the figure map
  const mapFile = path.join(vault, ...FIGMAP_PAGE);
  let F = null, mapText = "";
  if (fs.existsSync(mapFile)) {
    mapText = readText(mapFile);
    F = parseFigureMap(mapText);
    if (!F) warn("npc: Tools/blades-68-npc-figure-map.md has no ```json F block; F is null");
  } else warn("npc: Tools/blades-68-npc-figure-map.md does not exist yet; F is null (portraits use the built-in fallback map)");

  return {
    src: { file: rel(vault, genFile) + " (+ npc-cast, npc-figure-map)", blockSha: sha(block + "\n\u0000\n" + castText + "\n\u0000\n" + mapText), exportedAt },
    T, cast, F, _leverage: leverage.length,
  };
}

// ---- part: scenes ---------------------------------------------------------------------------------------
// Read from the vault page's dataviewjs block. The tables are what runs; the few facts generate() and the UI hold
// as literals (the rating labels, the time-of-day rule, the rumour placeholder) are probed or lifted by pattern, and every one
// is checked, so a vault edit that moves them stops the export instead of drifting.
const TOOLS = ["Wiki", "Games", "Blades in the Dark", "Tools"];
function pageBlock(vault, name, label) {
  const file = path.join(vault, ...TOOLS, name);
  const text = readText(file);
  const open = text.match(/^```dataviewjs[ \t]*$/m);
  if (!open) throw new Error(label + ": no ```dataviewjs block found");
  const bodyStart = open.index + open[0].length + 1;
  const close = text.indexOf("\n```", bodyStart);
  if (close < 0) throw new Error(label + ": the dataviewjs block is not closed");
  return { file, block: text.slice(bodyStart, close) };
}
function runTables(block, label, file) {
  const decl = block.match(/^const T = \{\};[ \t]*$/m);
  if (!decl) throw new Error(label + ": `const T = {};` not found in the block");
  const declEnd = decl.index + decl[0].length;
  const stopM = block.match(/^\/\/ --- Machinery -+\s*$/m);
  if (!stopM) throw new Error(label + ": `// --- Machinery` not found; the tables are cut there");
  if (LATE_T.test(block.slice(stopM.index))) warn(label + ": `T.x = ...` statements exist AFTER `// --- Machinery`; they are NOT in the pack");
  const code = block.slice(0, declEnd) + "\nglobalThis.__T = T;\n" + block.slice(declEnd, stopM.index) + "\n";
  const { ctx, error } = runBody(code, path.basename(file));
  if (error) throw new Error(label + ": table statements threw: " + error.message);
  if (!ctx.__T || !Object.keys(ctx.__T).length) throw new Error(label + ": T is empty");
  const dropped = [];
  const T = toJson(ctx.__T, "T", dropped);
  if (dropped.length) throw new Error(label + ": non-JSON values in T would be dropped: " + dropped.join(", "));
  return T;
}
// Cut `function name(...) { ... }` (closing brace alone at column 0) out of a block and return its source.
function cutFunction(block, name, label) {
  const m = block.match(new RegExp("^function " + name + "\\([^)]*\\) \\{\\n[\\s\\S]*?\\n\\}[ \\t]*$", "m"));
  if (!m) throw new Error(label + ": function " + name + "() not found; update the exporter");
  return m[0];
}

function buildScenes(vault, exportedAt) {
  const label = "scenes";
  const { file, block } = pageBlock(vault, "blades-68-district-scenes.md", label);
  const T = runTables(block, label, file);

  // every district complete
  if (!Array.isArray(T.district) || T.district.length < 1) throw new Error(label + ": T.district is missing or empty");
  const str = v => typeof v === "string";
  const strs = v => Array.isArray(v) && v.length > 0 && v.every(str);
  T.district.forEach((d, i) => {
    const at = "T.district[" + i + "] (" + (d && d.n) + ")";
    if (!d || !str(d.n) || !str(d.p) || !Array.isArray(d.r) || d.r.length !== 4 || !d.r.every(str) || !str(d.streets) || !str(d.buildings) ||
      !strs(d.named) || !strs(d.scene) || !strs(d.landmarks) || !str(d.factions) || !str(d.special) ||
      !Array.isArray(d.notables) || d.notables.length < 1 || !d.notables.every(n => Array.isArray(n) && n.length === 3 && n.every(str))) {
      throw new Error(label + ": " + at + " is incomplete (needs n, p, r[4], streets, named[], buildings, scene[], landmarks[], notables[[name, text, traits]], factions, special)");
    }
  });
  for (const k of ["streetType", "streetSound", "streetSmell", "streetObstacle", "buildingCommon", "buildingRare", "rumour", "faction"]) {
    if (!strs(T[k])) throw new Error(label + ": T." + k + " is missing or empty");
  }

  // the time-of-day rule in generate(): `oneIn(2) ? "A" : "B"`, which the port reads as the first and second key of T.weather
  const tod = block.match(/o\.timeOfDay\s*=\s*oneIn\(2\)\s*\?\s*("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*")\s*;/);
  if (!tod) throw new Error(label + ": the timeOfDay rule in generate() was not found; update the exporter");
  const keys = Object.keys(T.weather || {});
  if (keys.length !== 2 || keys[0] !== JSON.parse(tod[1]) || keys[1] !== JSON.parse(tod[2])) {
    throw new Error(label + ": the timeOfDay rule in generate() does not match the keys of T.weather (in order)");
  }
  keys.forEach(k => { if (!strs(T.weather[k])) throw new Error(label + ": T.weather." + k + " is empty"); });
  // the faction placeholder in the rumours
  if (!/\.replace\("%F%"/.test(block)) throw new Error(label + ": generate() no longer replaces %F%; update the exporter");
  if (!T.rumour.some(r => r.includes("%F%"))) warn(label + ": no rumour carries %F%");

  // the four rating labels: ratings(o) run on a probe whose r[i] are markers
  const src = cutFunction(block, "ratings", label);
  const { ctx, error } = runBody("globalThis.__R = (" + src.replace(/^function ratings/, "function") + ")({ d: { r: ['@0@', '@1@', '@2@', '@3@'] } });", "ratings");
  if (error || !Array.isArray(ctx.__R) || ctx.__R.length !== 4) throw new Error(label + ": ratings() could not be probed" + (error ? ": " + error.message : ""));
  T.ratingLabels = Array.from(ctx.__R, (s, i) => {   // Array.from: a host array, not the vm realm's
    const m = String(s).match(/^(.*?)\s*@(\d)@$/);
    if (!m || Number(m[2]) !== i || !m[1]) throw new Error(label + ": ratings() entry " + i + " does not read '<label> r[" + i + "]'");
    return m[1];
  });
  return { src: { file: rel(vault, file), blockSha: sha(block), exportedAt }, T };
}

// ---- part: score ----------------------------------------------------------------------------------------
// The tables are read from the score generator's vault page the way the scenes page's are. What that page does not hold (the faction
// dossiers, the district names and their notables, the building types) is the location part's, laid in as T.loc: one source for it.
// An optional part: no page, no part. Everything below is checked, and every finding is a warning (the app's Pack check treats a
// missing table the same way: the upload works, and a roll that needs one falls back to a neutral word); only a page that cannot be
// read as tables at all (no marker, a statement that throws, a value that is not JSON) stops the export.
const SCORE_PAGE = "blades-68-score-generator.md";
const isStr = v => typeof v === "string" && v.trim() !== "";
const isObj = v => v !== null && typeof v === "object" && !Array.isArray(v);
const nameList = (a, n = 4) => a.slice(0, n).join(", ") + (a.length > n ? ", … (+" + (a.length - n) + " more)" : "");

// The location page keeps a district as a row ([name, ...ratings]) and a district's factions as one comma-separated string; the
// score part carries names and lists, and only the fields the generator reads.
function layLocation(L) {
  const names = (Array.isArray(L.district) ? L.district : []).map(r => (Array.isArray(r) ? r[0] : r)).filter(isStr);
  const gazIn = isObj(L.gaz) ? L.gaz : {};
  const gaz = {};
  for (const d of names.length ? names : Object.keys(gazIn)) {
    const g = gazIn[d];
    if (!isObj(g)) continue;
    const f = Array.isArray(g.factions) ? g.factions : String(g.factions == null ? "" : g.factions).split(",");
    gaz[d] = { factions: f.map(s => String(s).trim()).filter(Boolean), notables: (Array.isArray(g.notables) ? g.notables : []).filter(isStr) };
  }
  const types = Array.isArray(L.targetNames) && L.targetNames.length ? L.targetNames : isObj(L.targetType) ? Object.keys(L.targetType) : [];
  return {
    factionDetail: isObj(L.factionDetail) ? L.factionDetail : {},
    factionThumb: isObj(L.factionThumb) ? L.factionThumb : {},
    district: names.length ? names : Object.keys(gaz),
    gaz,
    targetNames: types.filter(isStr),
  };
}

// What the score tables borrow from the location page must be there, spelled the way the generators match it.
function checkScore(T, L, loc) {
  const label = "score";
  const fk = Score.fkey;
  const miss = Score.check(T);
  if (miss.length) warn(label + ": the tables lack " + nameList(miss, 12));
  const master = rows => new Map((Array.isArray(rows) ? rows : []).filter(r => Array.isArray(r) && isStr(r[0])).map(r => [fk(r[0]), r]));
  const mine = master(T.faction), theirs = master(L.faction);
  if (theirs.size) {                                         // the page keeps the 58 for its own roller; the location page's is the source
    const here = [...mine.keys()].filter(k => !theirs.has(k)).map(k => mine.get(k)[0]);
    const there = [...theirs.keys()].filter(k => !mine.has(k)).map(k => theirs.get(k)[0]);
    const differ = [...mine.keys()].filter(k => theirs.has(k) && (mine.get(k)[1] !== theirs.get(k)[1] || mine.get(k)[2] !== theirs.get(k)[2])).map(k => mine.get(k)[0]);
    const say = (a, what) => a.length ? a.length + " " + what + " (" + nameList(a) + ")" : "";
    if (here.length || there.length || differ.length) warn(label + ": T.faction is not the location page's: " + [say(here, "only here"), say(there, "only there"), say(differ, "with another Tier or hold")].filter(Boolean).join("; "));
  }
  if (!loc) return;
  const types = new Set(loc.targetNames), dists = new Set(loc.district.map(fk));
  const badType = [], badFac = [], badDist = [];
  const note = (a, v) => { if (isStr(v) && !a.includes(v)) a.push(v); };
  for (const k of Object.keys(isObj(T.site) ? T.site : {})) for (const t of Array.isArray(T.site[k]) ? T.site[k] : []) if (types.size && !types.has(t)) note(badType, t);
  for (const f of Object.keys(isObj(T.holding) ? T.holding : {})) {
    if (mine.size && !mine.has(fk(f))) note(badFac, f);
    for (const h of Array.isArray(T.holding[f]) ? T.holding[f] : []) {
      if (!Array.isArray(h)) continue;
      if (types.size && isStr(h[1]) && !types.has(h[1])) note(badType, h[1]);
      if (dists.size && isStr(h[2]) && !dists.has(fk(h[2]))) note(badDist, h[2]);
    }
  }
  for (const d of Object.keys(isObj(T.districtRule) ? T.districtRule : {})) if (dists.size && !dists.has(fk(d))) note(badDist, d);
  if (badType.length) warn(label + ": building types the location page lacks, so Roll the site would not match: " + nameList(badType));
  if (badFac.length) warn(label + ": T.holding names factions the faction master lacks: " + nameList(badFac));
  if (badDist.length) warn(label + ": districts the location page lacks (in T.holding or T.districtRule): " + nameList(badDist));
  const gazFac = [];
  for (const d of Object.keys(loc.gaz)) for (const f of loc.gaz[d].factions) if (mine.size && !mine.has(fk(f))) note(gazFac, f);
  if (gazFac.length) warn(label + ": the location page's gazetteer names factions the faction master lacks: " + nameList(gazFac));
  const noGaz = loc.district.filter(d => !loc.gaz[d]);
  if (noGaz.length) warn(label + ": districts with no gazetteer entry on the location page: " + nameList(noGaz));
}

function buildScore(vault, exportedAt, location) {
  const label = "score";
  const file = path.join(vault, ...TOOLS, SCORE_PAGE);
  if (!fs.existsSync(file)) { warn(label + ": Tools/" + SCORE_PAGE + " does not exist yet, so there is no score part (the Score tab says the pack lacks it)"); return null; }
  const { block } = pageBlock(vault, SCORE_PAGE, label);
  const T = runTables(block, label, file);
  const L = location && isObj(location.T) ? location.T : null;
  let loc = null;
  if (L) {
    if (T.loc !== undefined) warn(label + ": the page sets T.loc; the location part's replaces it");
    loc = T.loc = layLocation(L);
  } else warn(label + ": there is no location part to lay the faction dossiers, districts and building types from, so the score part has no T.loc (Where, Their friends and the client's rivals fall back to what the tables hold)");
  checkScore(T, L || {}, loc);
  return { src: { file: rel(vault, file) + (loc ? " (+ the location part's dossiers)" : ""), blockSha: sha(block + "\u0000" + (loc ? JSON.stringify(loc) : "")), exportedAt }, T };
}

// Across the parts: the crew the campaign part carries must be one the score tables know.
function crossCheckScore(score, campaign) {
  const T = score.T, crew = campaign && campaign.crew, fk = Score.fkey;
  if (!crew) { warn("score: the campaign part has no crew sheet (a note under Campaigns/Group/ with crew_type:), so the Score tab follows the table's own crew and has no enemies"); return; }
  const types = Object.keys(isObj(T.crew) ? T.crew : {});
  if (types.length && !types.some(t => fk(t) === fk(crew.type))) warn("score: the crew sheet's type (" + crew.type + ") has no row in T.crew (" + nameList(types) + "), so the Score tab has no seeds, favoured operations or ability notes for it");
  const facs = new Set((Array.isArray(T.faction) ? T.faction : []).filter(r => Array.isArray(r)).map(r => fk(r[0])));
  const unknown = (a) => a.filter(n => facs.size && !facs.has(fk(n)));
  const badE = unknown(crew.enemies), badS = unknown((Array.isArray(campaign.standing) ? campaign.standing : []).map(s => s.faction));
  if (badE.length) warn("score: the crew sheet's enemies the faction master lacks: " + nameList(badE));
  if (badS.length) warn("score: the board's standing names factions the faction master lacks: " + nameList(badS));
}

// Across the parts: each v2 site's rooms against the prep notes' "## Rooms" section (app/gm/room-notes.js). Warnings only: a room with no
// section, and a play.secret word in a room's costume or SAY line (those lines reach the players' cards). No section anywhere: quiet.
function crossCheckRooms(prep, location) {
  const sites = location && location.authored && isObj(location.authored.sites) ? location.authored.sites : null;
  if (!prep || !sites) return;
  for (const name of Object.keys(sites)) {
    const play = isObj(sites[name]) && isObj(sites[name].play) ? sites[name].play : null;
    if (!play || play.v !== 2) continue;
    const rooms = [];
    for (const z of Array.isArray(play.zones) ? play.zones : []) for (const r of isObj(z) && Array.isArray(z.rooms) ? z.rooms : []) if (typeof r === "string" && r && !rooms.includes(r)) rooms.push(r);
    const found = Rooms.find(prep, rooms);
    if (found.source === null) continue;
    for (const r of found.missing) warn("rooms: no section for " + r);
    const secret = (Array.isArray(play.secret) ? play.secret : []).filter(w => typeof w === "string" && w.trim()).map(w => w.trim());
    for (const r of rooms) {
      const n = Object.prototype.hasOwnProperty.call(found.byRoom, r) ? found.byRoom[r] : null;
      const lines = n ? [n.costume].concat(n.say).filter(s => typeof s === "string" && s).map(s => s.toLowerCase()) : [];
      if (!lines.length) continue;
      for (const w of secret) if (lines.some(s => s.includes(w.toLowerCase()))) warn('rooms: "' + w + '" from play.secret in ' + r);
    }
  }
}

// ---- tiny YAML frontmatter parser ---------------------------------------------------------------------
// Handles what Dataview would hand view.js for these notes: scalars (numbers, booleans, null), quoted strings,
// [a, b] flow lists, and `- item` block lists. Not a general YAML parser.
function unquote(s) {
  if (s.length >= 2 && s[0] === '"' && s.endsWith('"')) {
    try { return JSON.parse(s); } catch (e) { return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\"); }
  }
  if (s.length >= 2 && s[0] === "'" && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  return s;
}
function splitFlow(inner) {
  const out = []; let cur = ""; let q = null; let depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) { cur += c; if (c === "\\" && q === '"') { cur += inner[++i] || ""; } else if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === "[") depth++;
    if (c === "]") depth--;
    if (c === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim() !== "") out.push(cur);
  return out;
}
function scalar(raw) {
  let s = raw.trim();
  if (s === "") return null;
  if (s[0] === '"' || s[0] === "'") {
    // quoted: take through the matching close quote, ignore a trailing comment
    return unquote(s);
  }
  s = s.replace(/\s+#.*$/, "").trim();                       // trailing comment (unquoted only)
  if (s.startsWith("[[")) return s;                          // a bare wikilink, kept as text
  if (s[0] === "[" && s.endsWith("]")) return splitFlow(s.slice(1, -1)).map(scalar);
  if (s === "~" || s === "null") return null;
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return Number(s);
  return s;
}
function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!m) return {};
  const lines = m[1].split("\n");
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const kv = line.match(/^([A-Za-z0-9_][\w .-]*?)\s*:(?:\s+(.*)|\s*)$/);
    if (!kv || /^\s/.test(line)) continue;
    const key = kv[1];
    const val = kv[2] === undefined ? "" : kv[2];
    if (val.trim() === "" ) {
      // block list, or empty
      const items = [];
      let j = i + 1;
      while (j < lines.length && (/^\s*-(\s|$)/.test(lines[j]) || /^\s+\S/.test(lines[j]) && items.length && !/^\S/.test(lines[j]))) {
        const li = lines[j].match(/^\s*-(?:\s+(.*))?$/);
        if (li) items.push(scalar(li[1] === undefined ? "" : li[1]));
        else items[items.length - 1] = String(items[items.length - 1]) + " " + lines[j].trim();   // folded continuation
        j++;
      }
      if (items.length) { out[key] = items; i = j - 1; } else out[key] = null;
    } else if (/^[>|][+-]?$/.test(val.trim())) {
      // block scalar: indented lines until the next key
      const parts = []; let j = i + 1;
      while (j < lines.length && (/^\s+/.test(lines[j]) || lines[j] === "")) { parts.push(lines[j].trim()); j++; }
      out[key] = parts.join(val.trim()[0] === ">" ? " " : "\n").trim();
      i = j - 1;
    } else {
      out[key] = scalar(val);
    }
  }
  return out;
}

// ---- part: campaign -----------------------------------------------------------------------------------
// Mirrors view.js: bare, rawList, readPCs, pipeList, readNPCs, readNames. Same regexes.
const bare = s => String(s).replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2").trim();
const rawList = v => v == null ? [] : (Array.isArray(v) ? v : [v]).map(x => String(x)).filter(Boolean);
const mdFiles = dir => { try { return fs.readdirSync(dir).filter(f => f.endsWith(".md")).sort().map(f => path.join(dir, f)); } catch (e) { return []; } };

function buildCampaign(vault, exportedAt) {
  const root = path.join(vault, "Wiki", "Games", "Blades in the Dark");
  const group = path.join(root, "Campaigns", "Group");
  const used = [];                                           // [relPath, text] for blockSha
  const load = f => { const t = readText(f); used.push([rel(vault, f), t]); return t; };

  // board
  let board = {};
  try { board = parseFrontmatter(load(path.join(group, "b68g-factions.md"))); } catch (e) { warn("campaign: b68g-factions.md unreadable (" + e.message + ")"); }
  const pipeList = prop => rawList(board[prop]).map(s => {
    const i = s.indexOf("|");
    return i < 0 ? { text: s.trim(), src: "" } : { text: s.slice(0, i).trim(), src: s.slice(i + 1).trim() };
  });
  const callbacks = pipeList("callbacks");
  const cast = pipeList("cast");
  const standing = pipeList("standing").map(x => ({ faction: x.text, status: parseInt(String(x.src).replace("\u2212", "-"), 10) || 0 }));
  const owed = pipeList("bargains_owed");

  // PCs (status: active, default active)
  const pcs = [];
  for (const f of mdFiles(path.join(group, "Characters"))) {
    const fm = parseFrontmatter(load(f));
    if (String(fm.status ?? "active").toLowerCase() !== "active") continue;
    const base = path.basename(f, ".md");
    const name = String(fm.character || base);
    pcs.push({
      name, file: base, first: name.split(" ")[0], playbook: String(fm.playbook || ""),
      insight: Number(fm.insight) || 0, prowess: Number(fm.prowess) || 0, resolve: Number(fm.resolve) || 0,
      wont: rawList(fm.wont_breaks).map(bare), vice: rawList(fm.vice).map(bare),
      friend: rawList(fm.friends).map(bare), rival: rawList(fm.rival).map(bare),
      extra: rawList(fm.bargains).map(bare),
      keyPressure: rawList(fm.key_pressure).map(bare),
    });
  }

  // NPCs (not solo)
  const npcs = [], cards = {};
  for (const f of mdFiles(path.join(root, "NPCs"))) {
    const body = load(f);
    const fm = parseFrontmatter(body);
    if (String(fm.campaign ?? "group").toLowerCase() === "solo") continue;
    const say = [];
    const sIdx = body.indexOf("## Say it out loud");
    if (sIdx >= 0) {
      for (const line of body.slice(sIdx).split("\n").slice(1)) {
        if (line.startsWith("## ")) break;
        const m = line.match(/^>\s*(?:\*[^*]+\*\s*)?(".*")\s*$/);
        if (m) say.push(m[1]);
      }
    }
    const g = body.match(/\[!quote\] At a glance\s*\n>\s*([^\n]+)/);
    const mn = body.match(/^>\s*-\s*\*\*Mannerism\*\*\s*([^\n]+)/m);
    npcs.push({
      name: path.basename(f, ".md"), role: String(fm.role || ""), faction: bare(fm.faction || ""),
      district: String(fm.district || ""), glance: g ? g[1].trim() : "", say,
      playedBy: String(fm.played_by || ""), mannerism: mn ? mn[1].trim() : "",
    });
    const card = npcCard(body);
    if (card) cards[path.basename(f, ".md")] = card;
  }

  // names: view.js reads the NPC generator's T.nameMasc / nameFem / nameAmb / family arrays by regex
  const pickArr = (src, name) => {
    const m = src.match(new RegExp("T\\." + name + "\\s*=\\s*(\\[[^\\]]*\\])"));
    try { return m ? JSON.parse(m[1]) : []; } catch (e) { return []; }
  };
  let names = { first: [], family: [] };
  try {
    const src = load(path.join(root, "Tools", "blades-68-npc-generator.md"));
    const first = [...pickArr(src, "nameMasc"), ...pickArr(src, "nameFem"), ...pickArr(src, "nameAmb")];
    const family = pickArr(src, "family");
    if (first.length && family.length) names = { first, family };
  } catch (e) { /* falls through */ }
  if (!names.first.length || !names.family.length) {
    warn("campaign: NPC-generator name lists not found; using view.js's six-name fallback");
    names = { first: ["Hattie", "Silas", "Edda", "Gage", "Lorna", "Kenton"], family: ["Darrow", "Fane", "Gaunt", "Bray", "Cooper", "Haig"] };
  }

  // live clocks: Campaigns/Group/Clocks/ if it exists, else the shared Clocks/ folder (group campaign, status active)
  const clockDir = fs.existsSync(path.join(group, "Clocks")) ? path.join(group, "Clocks") : path.join(root, "Clocks");
  const clocks = [];
  for (const f of mdFiles(clockDir)) {
    const fm = parseFrontmatter(load(f));
    if (String(fm.campaign ?? "group").toLowerCase() === "solo") continue;
    const st = String(fm.status ?? "active").toLowerCase();
    if (st !== "active" && st !== "reactive") continue;      // dormant clocks are not in play
    clocks.push({
      name: path.basename(f, ".md"), goal: String(fm.goal || ""), faction: bare(fm.faction || ""), tier: Number(fm.tier) || 0,
      district: String(fm.district || ""), segments: Number(fm.segments) || 0, filled: Number(fm.filled) || 0,
      beats: rawList(fm.beats).map(bare), status: st,
    });
  }

  // the crew sheet: the active note directly under Campaigns/Group/ whose frontmatter has `crew_type` (the file is named after the type,
  // but the property is what is read). Generic keys, so no book term is in the app: the Score generator takes the crew's type, Tier,
  // hold, enemies (factions) and abilities from here.
  const sheets = [];
  for (const f of mdFiles(group)) {
    const text = readText(f), fm = parseFrontmatter(text);
    if (!isStr(fm.crew_type) || String(fm.status ?? "active").toLowerCase() !== "active" || String(fm.campaign ?? "group").toLowerCase() === "solo") continue;
    used.push([rel(vault, f), text]);
    sheets.push({ file: path.basename(f), fm });
  }
  if (sheets.length > 1) warn("campaign: " + sheets.length + " active notes under Campaigns/Group/ have crew_type; the first (" + sheets[0].file + ") is the crew");
  let crew = null;
  if (sheets.length) {
    const { file, fm } = sheets[0];
    crew = {
      name: String(fm.crew_name ?? "").trim(), type: String(fm.crew_type).trim(), tier: Number(fm.tier) || 0, hold: String(fm.hold ?? "").trim(),
      enemies: rawList(fm.enemies).map(bare), abilities: rawList(fm.abilities).map(bare),
    };
    if (fm.enemies === undefined) warn("campaign: the crew sheet (" + file + ") has no `enemies:` property, so the Score generator knows no enemies of the crew");
    if (fm.abilities === undefined) warn("campaign: the crew sheet (" + file + ") has no `abilities:` property, so the Score generator adds no ability notes");
  } else warn("campaign: no active note under Campaigns/Group/ has crew_type, so the campaign part has no crew");

  const stamp = used.slice().sort((a, b) => a[0] < b[0] ? -1 : 1).map(([p, t]) => p + "\n" + t).join("\n\u0000\n");
  return {
    src: { file: "Wiki/Games/Blades in the Dark/{Campaigns/Group/b68g-factions.md, Campaigns/Group/Characters/, Campaigns/Group/ (the crew sheet), NPCs/, Clocks/, Tools/blades-68-npc-generator.md} (" + used.length + " files)", blockSha: sha(stamp), exportedAt },
    pcs, callbacks, cast, standing, owed, npcs, cards, names, clocks, crew,
  };
}

const rel = (vault, f) => path.relative(vault, f).split(path.sep).join("/");

// ---- part: prep ---------------------------------------------------------------------------------------
function buildPrepPart(vault, exportedAt) {
  return buildPrep({ vault, repo: REPO, exportedAt, basenames: basenames(vault), warn });
}

// ---- part: screen -------------------------------------------------------------------------------------
function buildScreenPart(vault, exportedAt) {
  return buildScreen({ vault, repo: REPO, exportedAt, warn });
}

// ---- part: handouts -----------------------------------------------------------------------------------
// (the source folder: --handouts-src, else the first handouts/props folder under the Group campaign or Projects)
let handoutsSrc = "";
function buildHandoutsPart(vault, exportedAt) {
  return buildHandouts({ vault, repo: REPO, exportedAt, warn, src: handoutsSrc });
}

// ---- part: downtime -----------------------------------------------------------------------------------
function buildDowntimePart(vault, exportedAt) {
  return buildDowntime({ vault, exportedAt, warn });
}

// ---- main ---------------------------------------------------------------------------------------------
function main() {
  const a = args(process.argv.slice(2));
  const vault = path.resolve(a.vault);
  if (!fs.existsSync(path.join(vault, "Wiki", "Games", "Blades in the Dark"))) { console.error("not a Blades '68 vault: " + vault); process.exit(2); }
  handoutsSrc = a.handoutsSrc || "";
  const out = path.resolve(REPO, a.out);
  const now = new Date().toISOString();

  // previous pack, to keep exportedAt stable for unchanged parts
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(out, "utf8")); } catch (e) { prev = null; }

  const parts = {};
  const failures = [];
  // score comes after location: it lays the location part's dossiers and districts over its own tables
  // assist: the cached prefix for "Claude at the table" (rules reference, NPC cast, tonight's prep); GM only (lib/assist-export.mjs)
  const assistConfig = readConfig(a.assistConfig ? path.resolve(a.assistConfig) : path.join(REPO, "gm-private", "assist-config.json"));
  // no --assist-prep and no "prep" in the config: pick the gm_prep: true session note by date (lib/assist-prep.mjs), and say which
  const picked = resolvePrep({ vault, assistPrep: a.assistPrep, config: assistConfig, today: a.today ? dateKey(a.today) : undefined });
  const assistPrep = picked ? picked.rel : a.assistPrep;
  if (picked && (picked.how === "date" || picked.how === "past")) console.log("assist prep: " + picked.rel + " (picked by date" + (picked.how === "past" ? "; every prep note is dated before today, so this is the newest" : "") + ")");
  const buildAssistPart = (v, exportedAt) => buildAssist({ vault: v, exportedAt, warn, prep: assistPrep, prepBy: picked ? picked.how : "cli", prepDate: picked ? dateKey(picked.date) : null, config: assistConfig, extra: a.assistExtra, playersFile: path.join(REPO, "gm-private", "players.json"), handouts: parts.handouts || null });
  const builders = [["console", buildConsole], ["location", buildLocation], ["campaign", buildCampaign], ["npc", buildNpc], ["scenes", buildScenes], ["score", buildScore], ["prep", buildPrepPart], ["screen", buildScreenPart], ["downtime", buildDowntimePart], ["handouts", buildHandoutsPart], ["assist", buildAssistPart]];
  let npcLeverage = 0;
  let locationExtraNames = [];
  for (const [name, fn] of builders) {
    try {
      const part = fn(vault, now, parts.location);
      if (part === null) continue;                           // an optional part with nothing to carry (prep, screen)
      if (name === "location") { locationExtraNames = part._extraNames; delete part._extraNames; }
      if (name === "npc") { npcLeverage = part._leverage; delete part._leverage; }
      const old = prev && prev.parts && prev.parts[name];
      if (old && old.src && old.src.blockSha === part.src.blockSha) {
        const body = JSON.stringify({ ...part, src: { ...part.src, exportedAt: old.src.exportedAt } });
        if (body === JSON.stringify(old)) part.src.exportedAt = old.src.exportedAt;
      }
      JSON.stringify(part);                                  // JSON-serialisable or throw
      parts[name] = part;
    } catch (e) { failures.push(name + ": " + e.message); }
  }
  if (failures.length) { for (const f of failures) console.error("FAILED  " + f); process.exit(1); }
  if (parts.score) crossCheckScore(parts.score, parts.campaign);
  crossCheckRooms(parts.prep, parts.location);                  // warnings only, never fails the pack

  // the guard: never lose prep quietly (the 16/10/2026 Sync rollback)
  const losses = prev && prev.parts && typeof prev.parts === "object" ? packLosses(prev.parts, parts) : [];
  if (losses.length && !a.allowShrink) {
    for (const l of lossLines(losses, "npm run gm:pack --")) console.error(l);
    console.error("Nothing written: " + path.relative(REPO, out) + " is still the pack from before.");
    process.exit(1);
  }
  for (const l of losses) warn("allowed by --allow-shrink: " + l.what);

  let exportedAt = now;
  const pack = { format: 1, exportedAt, parts };
  if (prev && prev.exportedAt) {
    const same = JSON.stringify({ ...pack, exportedAt: prev.exportedAt }) === JSON.stringify(prev);
    if (same) pack.exportedAt = exportedAt = prev.exportedAt;
  }
  const json = JSON.stringify(pack);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const unchanged = fs.existsSync(out) && fs.readFileSync(out, "utf8") === json;
  if (!unchanged) fs.writeFileSync(out, json);

  // ---- report
  if (!a.quiet) {
    console.log((unchanged ? "unchanged " : "wrote     ") + path.relative(REPO, out));
    console.log("\npart        raw size     cap (900 KiB)");
    let total = 0;
    for (const [name, part] of Object.entries(parts)) {
      const n = Buffer.byteLength(JSON.stringify(part));
      total += n;
      console.log(name.padEnd(10) + kb(n) + (n > PART_CAP ? "   OVER THE SERVER CAP" : "   ok"));
    }
    console.log("total     " + kb(total) + "   (file " + kb(Buffer.byteLength(json)).trim() + ")");
    console.log("\nkeys:");
    console.log("  console.T   (" + Object.keys(parts.console.T).length + ")  " + summariseKeys(parts.console.T).join(" "));
    console.log("  location.T  (" + Object.keys(parts.location.T).length + ")  " + summariseKeys(parts.location.T).join(" "));
    console.log("  location.extra: " + locationExtraNames.join(", "));
    const au = parts.location.authored;
    console.log("  location.authored: " + (au ? Object.keys(au.sites).map((n) => { const p = au.sites[n].play; if (!p) return n; const c = countPlay(p); return n + " [play: " + c.people + " people, " + c.stops + " stops, " + c.routes + " routes, " + c.disguises + " disguises, " + c.events + " events, " + c.clocks + " clocks]"; }).join(", ") + (Object.keys(au.bind).length ? " (bound: " + Object.keys(au.bind).map((k) => k + " -> " + au.bind[k]).join(", ") + ")" : " (no score card's site: names one)") : "none"));
    console.log("  npc.T       (" + Object.keys(parts.npc.T).length + ")  " + summariseKeys(parts.npc.T).join(" "));
    console.log("  npc: cast " + parts.npc.cast.length + ", leverage shapes " + npcLeverage + " (round-trip tested), F " + (parts.npc.F ? "present (" + Object.keys(parts.npc.F).join(", ") + ")" : "null"));
    console.log("  scenes.T     (" + Object.keys(parts.scenes.T).length + ")  " + summariseKeys(parts.scenes.T).join(" "));
    const sc0 = parts.score;
    console.log("  score: " + (sc0 ? "T (" + Object.keys(sc0.T).length + ")  " + summariseKeys(sc0.T).join(" ") : "none (no Tools/" + SCORE_PAGE + ")"));
    if (sc0 && sc0.T.loc) console.log("  score.T.loc: " + Object.keys(sc0.T.loc.factionDetail).length + " dossiers, " + Object.keys(sc0.T.loc.factionThumb).length + " thumbnails, " + sc0.T.loc.district.length + " districts, " + sc0.T.loc.targetNames.length + " building types (laid from the location part)");
    const c = parts.campaign;
    console.log("  campaign: pcs " + c.pcs.length + ", callbacks " + c.callbacks.length + ", cast " + c.cast.length + ", standing " + c.standing.length +
      ", owed " + c.owed.length + ", npcs " + c.npcs.length + ", cards " + Object.keys(c.cards).length + " (" + Math.round(JSON.stringify(c.cards).length / 1024) + " KiB)" + ", names " + c.names.first.length + "/" + c.names.family.length + ", clocks " + c.clocks.length +
      ", crew " + (c.crew ? c.crew.type + " Tier " + c.crew.tier + " (" + c.crew.enemies.length + " enemies, " + c.crew.abilities.length + " abilities)" : "none"));
    const pr = parts.prep;
    console.log("  prep: " + (pr ? pr.notes.length + " note(s), " + pr.notes.reduce((n, x) => n + x.blocks.length, 0) + " blocks, " +
      pr.notes.reduce((n, x) => n + x.blocks.reduce((m, b) => m + b.tasks.length, 0), 0) + " task boxes, " + Object.keys(pr.links).length + " linked pages, " +
      new Set(pr.notes.flatMap((x) => x.blocks.filter((b) => b.score).map((b) => b.score.key))).size + " score cards (GM.md, Score sites)" : "none (no note has gm_prep: true)"));
    const sc = parts.screen;
    console.log("  screen: " + (sc ? sc.sections.length + " sections from " + path.basename(sc.rel) : "none (no note has gm_screen: true)"));
    const ho = parts.handouts;
    console.log("  handouts: " + (ho ? ho.items.length + " handout(s), " + ho.items.filter(i => i.when).length + " with a cue, from " + ho.rel : "none (no images in the vault's handouts folder)"));
    const dp = parts.downtime;
    console.log("  downtime: " + (dp ? dp.T.benefit.length + " Benefits and " + dp.T.mishap.length + " Mishaps from " + path.basename(dp.rel) : "none (no note has gm_downtime: true)"));
    const as = parts.assist;
    console.log("  assist: " + (as ? "about " + as.src.tokens + " tokens, NPC cards " + (as.src.npcWith || 0) + " with How to play / " + (as.src.npcWithout || 0) + " without, players " + (as.src.players || "none") + " (" + as.src.file.split(" + ").map(f => path.basename(f)).join(", ") + ")" : "none (no rules, cast or prep note found)"));
    if (as && as.src.extra) for (const [seat, e] of Object.entries(as.src.extra)) console.log("  assist extra: " + seat + " (" + e.chars + " chars, " + e.rel + ")");
  }
  for (const [name, part] of Object.entries(parts)) {
    const n = Buffer.byteLength(JSON.stringify(part));
    if (n > PART_CAP) warn(name + ": " + (n / 1024).toFixed(0) + " KiB exceeds the server's 900 KiB per-part cap");
  }
  for (const w of warnings) console.warn("WARNING " + w);
  if (!a.quiet && !warnings.length) console.log("\nno warnings");
}

// Runs as a script; importing the file (the unit test does) only exposes the npc helpers below.
export { buildNpc, buildScenes, buildScore, buildCampaign, layLocation, crossCheckScore, leverageToData, applyLeverage, parseCast, parseFigureMap, warnings as exportWarnings };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
