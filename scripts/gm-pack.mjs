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
//   location  T (+ extra: the other top-level consts the generator reads) from the location generator
//   campaign  pcs, callbacks, cast, standing, owed, npcs, names, clocks (mirrors view.js readPCs/pipeList/readNPCs/readNames)
//             (pcs[].file is each character sheet's file name: the NPC generator's initials rule uses file names)
//   npc       T (NPC generator tables, cut before `const POOL`), cast (anchor rows from blades-68-npc-cast.md, the vault's own
//             regex), F (the figure map). T.leverage[].t are functions in the vault; they are stored as data
//             { f, t: "...{v}...", lower, head } and every one is round-trip tested, or the export fails.
//   scenes    T from the district scene roller (Tools/blades-68-district-scenes.md, cut at `// --- Machinery`), plus
//             T.ratingLabels (the four district rating labels, probed from the vault's ratings()). Checked: the time-of-day
//             rule in generate() matches the keys of T.weather, the %F% placeholder is still used, every district is complete.
//   engagement T from the engagement roll page (Tools/blades-68-engagement-roll.md): approach, factor, plus loadout
//             [{value,label,load}], outcome {crit,six,risky,desperate: {pos,how}} (probed from the vault's outcome() over
//             every result, and the grouping is verified), cut (the closing line) and cite (the page reference).
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
import { fileURLToPath } from "node:url";
import { basenames } from "./lib/vault.mjs";
import { buildPrep } from "./lib/prep-export.mjs";
import { packLosses, lossLines } from "./lib/pack-guard.mjs";
import { buildScreen } from "./lib/screen-export.mjs";
import { buildDowntime } from "./lib/downtime-export.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const PART_CAP = 900 * 1024;        // the server's per-part cap (contract)

// ---- args ---------------------------------------------------------------------------------------------
function args(argv) {
  const o = { vault: process.env.B68_VAULT || "", out: "gm-private/b68-gm-pack.json", quiet: false, allowShrink: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vault") o.vault = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--quiet") o.quiet = true;
    else if (a === "--allow-shrink") o.allowShrink = true;
    else if (a === "-h" || a === "--help") { console.log("usage: node scripts/gm-pack.mjs --vault <vault dir> [--out gm-private/b68-gm-pack.json] [--quiet] [--allow-shrink]"); process.exit(0); }
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
  return { src: { file: rel(vault, file), blockSha: sha(block), exportedAt }, T, extra, _extraNames: extraNames };
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

// ---- parts: scenes and engagement -----------------------------------------------------------------------
// Both are read from the vault page's dataviewjs block. The tables are what runs; the few facts generate() and the UI hold
// as literals (the rating labels, the loadout loads, the outcome wording, the closing line, the page reference) are probed
// or lifted by pattern, and every one is checked, so a vault edit that moves them stops the export instead of drifting.
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

function buildEngagement(vault, exportedAt) {
  const label = "engagement";
  const { file, block } = pageBlock(vault, "blades-68-engagement-roll.md", label);
  const T = runTables(block, label, file);
  if (!Array.isArray(T.approach) || T.approach.length < 1 || !T.approach.every(a => Array.isArray(a) && a.length === 2 && a.every(x => typeof x === "string"))) {
    throw new Error(label + ": T.approach is not [[name, gambit], ...]");
  }
  if (!Array.isArray(T.factor) || T.factor.length < 1 || !T.factor.every(f => f && typeof f.id === "string" && typeof f.plus === "string" && typeof f.minus === "string")) {
    throw new Error(label + ": T.factor is not [{ id, plus, minus }, ...]");
  }

  // loadout: the options of the Loadout select, and the load each one means
  const opts = [...block.matchAll(/loadSel\.createEl\("option",\s*\{\s*text:\s*("(?:[^"\\]|\\.)*"),\s*value:\s*("(?:[^"\\]|\\.)*")\s*\}\)/g)]
    .map(m => ({ value: JSON.parse(m[2]), label: JSON.parse(m[1]) }));
  if (!opts.length) throw new Error(label + ": the Loadout options were not found; update the exporter");
  const ld = block.match(/loadSel\.value\s*===\s*("(?:[^"\\]|\\.)*")\s*\?\s*(\d+)\s*:\s*(\d+)/);
  if (!ld) throw new Error(label + ": the load rule (`loadSel.value === \"X\" ? a : b`) was not found; update the exporter");
  if (opts.length !== 2 || opts[0].value !== JSON.parse(ld[1])) throw new Error(label + ": the load rule does not match the two Loadout options");
  opts[0].load = Number(ld[2]); opts[1].load = Number(ld[3]);
  opts.forEach(o => { const n = o.label.match(/load (\d+)/); if (n && Number(n[1]) !== o.load) throw new Error(label + ": the load in the label '" + o.label + "' disagrees with the rule"); });
  T.loadout = opts;

  // outcome(): probed over every result, then the grouping is verified
  const src = cutFunction(block, "outcome", label);
  const probe = "const __o = " + src.replace(/^function outcome/, "function") + ";\n" +
    "globalThis.__O = { crit: __o({ crit: true, best: 6, zero: false }), crit5: __o({ crit: true, best: 5, zero: false })," +
    " six: __o({ crit: false, best: 6, zero: false }), zero6: __o({ crit: false, best: 6, zero: true })," +
    " b5: __o({ crit: false, best: 5, zero: false }), b4: __o({ crit: false, best: 4, zero: false })," +
    " b3: __o({ crit: false, best: 3, zero: false }), b2: __o({ crit: false, best: 2, zero: false }), b1: __o({ crit: false, best: 1, zero: false }) };";
  const { ctx, error } = runBody(probe, "outcome");
  if (error || !ctx.__O) throw new Error(label + ": outcome() could not be probed" + (error ? ": " + error.message : ""));
  const O = JSON.parse(JSON.stringify(ctx.__O));
  const one = k => { const v = O[k]; if (!Array.isArray(v) || v.length !== 2 || !v.every(x => typeof x === "string" && x)) throw new Error(label + ": outcome() did not return [position, how] for " + k); return { pos: v[0], how: v[1] }; };
  const same = (a, b) => a.pos === b.pos && a.how === b.how;
  const out = { crit: one("crit"), six: one("six"), risky: one("b5"), desperate: one("b1") };
  if (!same(one("crit5"), out.crit)) throw new Error(label + ": outcome() groups a critical by its best die; the port assumes a critical is one result");
  if (!same(one("zero6"), out.six)) throw new Error(label + ": outcome() treats a 0d six differently; update the exporter and the port");
  if (!same(one("b4"), out.risky)) throw new Error(label + ": outcome() splits 4 and 5; the port groups them");
  if (!same(one("b3"), out.desperate) || !same(one("b2"), out.desperate)) throw new Error(label + ": outcome() splits 1-3; the port groups them");
  if (same(out.crit, out.six) || same(out.six, out.risky) || same(out.risky, out.desperate)) throw new Error(label + ": outcome() does not distinguish the four results");
  T.outcome = out;

  // the closing line the card shows after a roll, and the page reference in the role line
  const cut = block.match(/dv\.el\("div",\s*((?:"(?:[^"\\]|\\.)*"\s*\+\s*)*"(?:[^"\\]|\\.)*"),\s*\{ container: card, cls: "b68-read" \}\);\s*\n\s*\} else \{/);
  if (!cut) throw new Error(label + ": the closing line after a roll was not found; update the exporter");
  T.cut = vm.runInNewContext(cut[1]);
  if (typeof T.cut !== "string" || !T.cut) throw new Error(label + ": the closing line is empty");
  const cite = block.match(/·\s*('68 p\.[0-9–-]+)`/);
  if (!cite) throw new Error(label + ": the page reference in the role line was not found; update the exporter");
  T.cite = cite[1];
  return { src: { file: rel(vault, file), blockSha: sha(block), exportedAt }, T };
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
  const npcs = [];
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

  const stamp = used.slice().sort((a, b) => a[0] < b[0] ? -1 : 1).map(([p, t]) => p + "\n" + t).join("\n\u0000\n");
  return {
    src: { file: "Wiki/Games/Blades in the Dark/{Campaigns/Group/b68g-factions.md, Campaigns/Group/Characters/, NPCs/, Clocks/, Tools/blades-68-npc-generator.md} (" + used.length + " files)", blockSha: sha(stamp), exportedAt },
    pcs, callbacks, cast, standing, owed, npcs, names, clocks,
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

// ---- part: downtime -----------------------------------------------------------------------------------
function buildDowntimePart(vault, exportedAt) {
  return buildDowntime({ vault, exportedAt, warn });
}

// ---- main ---------------------------------------------------------------------------------------------
function main() {
  const a = args(process.argv.slice(2));
  const vault = path.resolve(a.vault);
  if (!fs.existsSync(path.join(vault, "Wiki", "Games", "Blades in the Dark"))) { console.error("not a Blades '68 vault: " + vault); process.exit(2); }
  const out = path.resolve(REPO, a.out);
  const now = new Date().toISOString();

  // previous pack, to keep exportedAt stable for unchanged parts
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(out, "utf8")); } catch (e) { prev = null; }

  const parts = {};
  const failures = [];
  const builders = [["console", buildConsole], ["location", buildLocation], ["campaign", buildCampaign], ["npc", buildNpc], ["scenes", buildScenes], ["engagement", buildEngagement], ["prep", buildPrepPart], ["screen", buildScreenPart], ["downtime", buildDowntimePart]];
  let npcLeverage = 0;
  let locationExtraNames = [];
  for (const [name, fn] of builders) {
    try {
      const part = fn(vault, now);
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
    console.log("  npc.T       (" + Object.keys(parts.npc.T).length + ")  " + summariseKeys(parts.npc.T).join(" "));
    console.log("  npc: cast " + parts.npc.cast.length + ", leverage shapes " + npcLeverage + " (round-trip tested), F " + (parts.npc.F ? "present (" + Object.keys(parts.npc.F).join(", ") + ")" : "null"));
    console.log("  scenes.T     (" + Object.keys(parts.scenes.T).length + ")  " + summariseKeys(parts.scenes.T).join(" "));
    console.log("  engagement.T (" + Object.keys(parts.engagement.T).length + ")  " + summariseKeys(parts.engagement.T).join(" "));
    const c = parts.campaign;
    console.log("  campaign: pcs " + c.pcs.length + ", callbacks " + c.callbacks.length + ", cast " + c.cast.length + ", standing " + c.standing.length +
      ", owed " + c.owed.length + ", npcs " + c.npcs.length + ", names " + c.names.first.length + "/" + c.names.family.length + ", clocks " + c.clocks.length);
    const pr = parts.prep;
    console.log("  prep: " + (pr ? pr.notes.length + " note(s), " + pr.notes.reduce((n, x) => n + x.blocks.length, 0) + " blocks, " +
      pr.notes.reduce((n, x) => n + x.blocks.reduce((m, b) => m + b.tasks.length, 0), 0) + " task boxes, " + Object.keys(pr.links).length + " linked pages, " +
      new Set(pr.notes.flatMap((x) => x.blocks.filter((b) => b.score).map((b) => b.score.key))).size + " score cards (GM.md, Score sites)" : "none (no note has gm_prep: true)"));
    const sc = parts.screen;
    console.log("  screen: " + (sc ? sc.sections.length + " sections from " + path.basename(sc.rel) : "none (no note has gm_screen: true)"));
    const dp = parts.downtime;
    console.log("  downtime: " + (dp ? dp.T.benefit.length + " Benefits and " + dp.T.mishap.length + " Mishaps from " + path.basename(dp.rel) : "none (no note has gm_downtime: true)"));
  }
  for (const [name, part] of Object.entries(parts)) {
    const n = Buffer.byteLength(JSON.stringify(part));
    if (n > PART_CAP) warn(name + ": " + (n / 1024).toFixed(0) + " KiB exceeds the server's 900 KiB per-part cap");
  }
  for (const w of warnings) console.warn("WARNING " + w);
  if (!a.quiet && !warnings.length) console.log("\nno warnings");
}

// Runs as a script; importing the file (the unit test does) only exposes the npc helpers below.
export { buildNpc, buildScenes, buildEngagement, leverageToData, applyLeverage, parseCast, parseFigureMap, warnings as exportWarnings };
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
