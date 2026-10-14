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
//
// Idempotent: a part whose source is unchanged keeps its previous exportedAt, so a second run writes the same bytes.

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const PART_CAP = 900 * 1024;        // the server's per-part cap (contract)

// ---- args ---------------------------------------------------------------------------------------------
function args(argv) {
  const o = { vault: process.env.B68_VAULT || "", out: "gm-private/b68-gm-pack.json", quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vault") o.vault = argv[++i];
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--quiet") o.quiet = true;
    else if (a === "-h" || a === "--help") { console.log("usage: node scripts/gm-pack.mjs --vault <vault dir> [--out gm-private/b68-gm-pack.json] [--quiet]"); process.exit(0); }
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
    return v.map((x, i) => { const r = toJson(x, p + "[" + i + "]", dropped); return r === undefined ? null : r; });
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
      name, first: name.split(" ")[0], playbook: String(fm.playbook || ""),
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
  const builders = [["console", buildConsole], ["location", buildLocation], ["campaign", buildCampaign]];
  let locationExtraNames = [];
  for (const [name, fn] of builders) {
    try {
      const part = fn(vault, now);
      if (name === "location") { locationExtraNames = part._extraNames; delete part._extraNames; }
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
    const c = parts.campaign;
    console.log("  campaign: pcs " + c.pcs.length + ", callbacks " + c.callbacks.length + ", cast " + c.cast.length + ", standing " + c.standing.length +
      ", owed " + c.owed.length + ", npcs " + c.npcs.length + ", names " + c.names.first.length + "/" + c.names.family.length + ", clocks " + c.clocks.length);
  }
  for (const [name, part] of Object.entries(parts)) {
    const n = Buffer.byteLength(JSON.stringify(part));
    if (n > PART_CAP) warn(name + ": " + (n / 1024).toFixed(0) + " KiB exceeds the server's 900 KiB per-part cap");
  }
  for (const w of warnings) console.warn("WARNING " + w);
  if (!a.quiet && !warnings.length) console.log("\nno warnings");
}

main();
