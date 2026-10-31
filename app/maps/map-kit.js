/*! Blades '68 map kit — B68Map. Built 2026-10-28 from src/. Rooms are the book's; geometry is [interpretation]. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.B68Map = factory();
}(typeof self !== "undefined" ? self : this, function () {
"use strict";
const M = {};
// ---- src/core.js ----
// =============================================================================
// core — rng, pieces, geometry helpers, SVG serialiser
// =============================================================================
// Units: 1 kit unit = 1 foot. y grows downward. The front of the building (the
// street) is the bottom edge, so depth runs bottom → top in the plan view.
//
// Everything the kit draws is a PIECE: a shape tagged with a semantic ROLE
// ("wall", "fx", "floor-secure", "ov-target" …). Pieces never carry colour.
// A THEME turns roles into paint. That is the whole trick that lets one plan
// render as a rulebook plate, a blueprint, a case file or a heist board.

M.VERSION = "0.9.0";
// A table looked up by a word from a roll or an option: its own entries only, so "__proto__",
// "toString" or "constructor" find nothing (as any other unknown word does), never
// Object.prototype's.
const OWN = Object.prototype.hasOwnProperty;
M.own = (table, key) => table != null && key != null && OWN.call(table, key) ? table[key] : undefined;
// --- What the player copy shows (0.9) -------------------------------------------------
// opts.reveal lists the bands the crew has opened, and since 0.9 single rooms too, as
// "room:<name>" (the room's name exactly as the roll gives it, as a token's room is named).
// A room is known when its band OR its own entry is revealed. THIS is the one predicate: every
// place the player copy reads reveal (the seal, the cover, the labels, the titles, the tokens,
// the key) asks it, so a room is either everywhere in the file or nowhere. `reveal` is the Set
// of entries. A passage, a corridor or a stair core has no name: it follows its band, as before.
M.roomRevealed = (reveal, r) => reveal.has(r.band) || (typeof r.name === "string" && r.name !== "" && reveal.has("room:" + r.name));
const ROOM_ENTRY = /^room:/;
M.roomEntries = reveal => (Array.isArray(reveal) ? reveal : []).filter(e => typeof e === "string" && ROOM_ENTRY.test(e));
// Only for a copy that opens rooms singly, and only on the player copy: the model's room numbers are
// the book's order, so a room opened on its own would show a gap that counts the rooms before it.
// The rooms the crew knows are renumbered 1…k in the order they had; the others come after, drawn nowhere.
// A reveal of bands alone leaves every number as it was.
M.revealRooms = function (model, opts, W) {
  if (opts.layer !== "player") return;
  const entries = M.roomEntries(opts.reveal);
  if (!entries.length) return;
  const R = new Set(opts.reveal);
  for (const e of entries) if (!model.rooms.some(r => r.name === e.slice(5))) M.warn(W, `reveal "${e}" is not one of this roll's rooms — nothing opened by it`);
  let n = 0;
  for (const r of model.rooms) if (M.roomRevealed(R, r)) r.n = ++n;
  for (const r of model.rooms) if (!M.roomRevealed(R, r)) r.n = ++n;
  // the id a floor or a piece of furniture carries in the file (data-room="r4") is the room's index in the roll: the same count
  // by another name. It follows the number, so the file holds r0…r(k-1) for the k rooms the crew knows (nothing reads it by index).
  for (const r of model.rooms) r.id = "r" + (r.n - 1);
};
// A roll's list, as a list: a word where a list of words goes (props, neighbours) is a list of
// one; anything else that isn't a list is an empty one. Says so, unless it is simply missing.
M.list = (x, W, what, words) => {
  if (Array.isArray(x)) return x;
  if (x == null || x === "") return [];
  const one = words && typeof x === "string";
  if (W) M.warn(W, `${what} should be a list — ${one ? "read as a list of one" : "left out"}`);
  return one ? [x] : [];
};

// --- Random ----------------------------------------------------------------
// Mulberry32 — the same PRNG the vault generator uses for sticky rolls, so a
// seed means the same thing on both sides.
M.rng = function (seed) {
  let a = (seed >>> 0) || 1;
  const f = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.int = (lo, hi) => lo + Math.floor(f() * (hi - lo + 1));
  f.range = (lo, hi) => lo + f() * (hi - lo);
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  f.chance = p => f() < p;
  f.shuffle = arr => { const c = arr.slice(); for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; };
  f.fork = salt => M.rng((seed ^ M.hash(salt)) >>> 0);
  return f;
};
M.hash = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// --- Pieces ------------------------------------------------------------------
const P = M.P = {
  rect: (r, x, y, w, h, o) => Object.assign({ t: "rect", r, x, y, w, h }, o),
  circle: (r, cx, cy, rad, o) => Object.assign({ t: "circle", r, cx, cy, rad }, o),
  ellipse: (r, cx, cy, rx, ry, o) => Object.assign({ t: "ellipse", r, cx, cy, rx, ry }, o),
  poly: (r, pts, o) => Object.assign({ t: "poly", r, pts }, o),
  path: (r, d, o) => Object.assign({ t: "path", r, d }, o),
  line: (r, x1, y1, x2, y2, o) => Object.assign({ t: "line", r, x1, y1, x2, y2 }, o),
  text: (r, x, y, s, o) => Object.assign({ t: "text", r, x, y, s: String(s) }, o),
  g: (kids, o) => Object.assign({ t: "g", kids }, o),          // o.tf = {x,y,rot,s}
  raw: (svg, o) => Object.assign({ t: "raw", svg }, o)          // trusted kit-made svg only
};

// --- Geometry ----------------------------------------------------------------
const G = M.G = {
  area: pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a / 2); },
  centroid(pts) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length], k = p[0] * q[1] - q[0] * p[1];
      a += k; cx += (p[0] + q[0]) * k; cy += (p[1] + q[1]) * k;
    }
    if (Math.abs(a) < 1e-9) return [pts[0][0], pts[0][1]];
    return [cx / (3 * a), cy / (3 * a)];
  },
  rectPts: r => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]],
  inset: (r, d) => ({ x: r.x + d, y: r.y + d, w: Math.max(0, r.w - 2 * d), h: Math.max(0, r.h - 2 * d) }),
  cx: r => r.x + r.w / 2, cy: r => r.y + r.h / 2,
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]),
  lerp: (a, b, t) => a + (b - a) * t,
  round: v => Math.round(v * 100) / 100
};

// --- Text measure ----------------------------------------------------------------
// No DOM in Node, so text is measured from glyph advances taken in Chromium from
// the design system's own fonts (per unit of font size): Archivo Condensed Black
// for labels, Archivo Compressed for posters, GT America for the key. Space Mono
// and Courier Prime are monospaced. A label is sized by its real width.
const GLYPH_ORDER = "0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'’-–—&·,.:;()/?!↕×#\"";
const GLYPH_TABLES = {
  condensed: [597,574,591,595,594,594,597,573,593,597,158,700,690,695,693,640,583,741,732,335,600,731,593,888,734,744,647,744,693,642,644,729,687,914,690,684,644,596,595,589,595,592,346,586,595,290,289,603,290,889,594,593,595,595,397,544,396,594,549,847,598,547,502,257,255,304,440,880,787,294,298,298,298,298,389,389,297,552,311,500,619,610,465],
  poster: [444,371,427,440,435,437,445,387,432,445,110,530,498,513,509,462,402,543,513,263,453,510,432,705,518,554,485,554,509,469,475,503,490,729,500,481,475,443,440,421,440,428,277,415,437,228,232,462,228,649,437,433,440,440,296,400,293,437,414,638,448,408,383,213,204,240,310,620,566,210,222,222,222,222,389,389,278,424,266,500,528,499,396],
  text: [678,354,594,602,605,590,617,546,618,618,245,713,648,730,725,602,575,749,718,265,390,673,528,854,714,789,608,789,655,664,639,719,680,958,690,647,644,544,575,529,575,540,368,550,569,247,250,539,245,824,569,565,575,575,344,505,392,561,525,758,550,538,495,205,234,379,500,1000,659,227,242,225,227,242,293,293,337,529,272,416,620,570,374],
  textBold: [702,403,637,636,655,617,643,581,658,643,215,763,684,754,751,616,595,771,742,301,421,724,546,892,746,802,663,802,693,677,662,735,733,996,745,683,648,582,606,567,606,574,410,593,600,284,291,591,283,881,600,594,606,606,401,527,433,594,561,793,594,566,514,228,261,394,500,1000,716,255,264,254,255,264,321,321,371,565,296,447,620,652,429]
};
M.GLYPHS = {};
for (const k in GLYPH_TABLES) { const m = {}; Array.from(GLYPH_ORDER).forEach((c, i) => { m[c] = GLYPH_TABLES[k][i] / 1000; }); M.GLYPHS[k] = m; }
M.ADVANCE = { condensed: 0.64, text: 0.6, textBold: 0.63, mono: 0.612, typewriter: 0.6, poster: 0.46, script: 0.5 };
// Width of s at a font size, in the same units as the size. ls is the theme's
// letter-spacing (absolute units per character, as SVG applies it).
M.textW = (s, size, cls, ls) => {
  const t = M.own(M.GLYPHS, cls), str = String(s), n = Array.from(str).length;
  if (!t) return n * (M.own(M.ADVANCE, cls) || 0.6) * size + (ls || 0) * n;
  let w = 0;
  for (const c of str) { const v = t[c] != null ? t[c] : t[c.toUpperCase()]; w += v != null ? v : M.own(M.ADVANCE, cls); }
  return w * size + (ls || 0) * n;
};
// The size at which s fits maxW: never above size, never below min (default 45%).
M.fitText = (s, maxW, size, cls, min, ls) => {
  const need = M.textW(s, size, cls, ls);
  if (need <= maxW) return size;
  const n = Array.from(String(s)).length, per = (need - (ls || 0) * n) / size;   // width per unit of size
  return Math.max(min != null ? min : size * 0.45, (maxW - (ls || 0) * n) / per);
};
// Wrap s into lines no wider than maxW at this size (a single long word stays whole).
M.wrapW = (s, maxW, size, cls, ls) => {
  const words = String(s).split(/\s+/).filter(Boolean), lines = [];
  let cur = "";
  for (const w of words) { const next = cur ? cur + " " + w : w; if (cur && M.textW(next, size, cls, ls) > maxW) { lines.push(cur); cur = w; } else cur = next; }
  if (cur) lines.push(cur);
  return lines;
};
// The most even split of s into n lines: a name that must wrap wraps where
// its widest line is narrowest.
M.splitEven = (s, n, size, cls, ls) => {
  const words = String(s).split(/\s+/).filter(Boolean);
  if (n <= 1 || words.length <= 1) return [words.join(" ")];
  let best = null;
  const rec = (i, left, acc) => {
    if (left === 1) { const lines = acc.concat([words.slice(i).join(" ")]); const w = Math.max(...lines.map(l => M.textW(l, size, cls, ls))); if (!best || w < best.w - 1e-9) best = { w, lines }; return; }
    for (let j = i + 1; j <= words.length - left + 1; j++) rec(j, left - 1, acc.concat([words.slice(i, j).join(" ")]));
  };
  rec(0, Math.min(n, words.length), []);
  return best.lines;
};
M.wrap = (s, maxChars) => {
  const words = String(s).split(/\s+/), lines = []; let cur = "";
  for (const w of words) { if ((cur + " " + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
  if (cur) lines.push(cur);
  return lines;
};
M.esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// --- Serialiser --------------------------------------------------------------
// paint(role, piece) → attribute object, or null to skip the piece. In shadow
// mode the theme's shadow colour replaces every fill and stroke, which is how
// the rulebook theme gets its hard cast shadows without parts knowing about it.
const n = v => (typeof v === "number" ? +v.toFixed(2) : v);
function attrs(o) {
  let s = "";
  for (const k in o) if (o[k] !== undefined && o[k] !== null && o[k] !== false) s += ` ${k}="${M.esc(n(o[k]))}"`;
  return s;
}
function tfStr(tf) {
  if (!tf) return "";
  let s = "";
  if (tf.x || tf.y) s += `translate(${n(tf.x || 0)} ${n(tf.y || 0)})`;
  if (tf.rot) s += ` rotate(${n(tf.rot)})`;
  if (tf.s && tf.s !== 1) s += ` scale(${n(tf.s)})`;
  if (tf.sx && tf.sx !== 1) s += ` scale(${n(tf.sx)} 1)`;
  return s.trim();
}
M.toSVG = function toSVG(pieces, theme, mode) {
  let out = "";
  for (const p of pieces) {
    if (!p) continue;
    if (p.t === "g") {
      const inner = toSVG(p.kids, theme, mode);
      if (inner) out += `<g${attrs({ transform: tfStr(p.tf) || undefined, opacity: p.opacity, class: p.cls, "data-room": p.room })}>${inner}</g>`;
      continue;
    }
    if (p.t === "raw") { if (mode !== "shadow") out += p.svg; continue; }
    let a = theme.paint(p.r, p, mode);
    if (!a) continue;
    if (mode === "shadow") {
      if (a.fill && a.fill !== "none") a.fill = theme.shadowColour;
      if (a.stroke && a.stroke !== "none") a.stroke = theme.shadowColour;
      a.filter = undefined; a.opacity = undefined;
      if (p.t === "text") continue;
    }
    const tf = tfStr(p.tf);
    if (tf) a.transform = tf;
    if (p.data && mode !== "shadow") for (const key in p.data) a["data-" + key] = p.data[key];
    switch (p.t) {
      case "rect": out += `<rect${attrs(Object.assign({ x: p.x, y: p.y, width: p.w, height: p.h, rx: p.rx }, a))}/>`; break;
      case "circle": out += `<circle${attrs(Object.assign({ cx: p.cx, cy: p.cy, r: p.rad }, a))}/>`; break;
      case "ellipse": out += `<ellipse${attrs(Object.assign({ cx: p.cx, cy: p.cy, rx: p.rx, ry: p.ry }, a))}/>`; break;
      case "poly": out += `<polygon${attrs(Object.assign({ points: p.pts.map(q => n(q[0]) + "," + n(q[1])).join(" ") }, a))}/>`; break;
      case "path": out += `<path${attrs(Object.assign({ d: p.d }, a))}/>`; break;
      case "line": out += `<line${attrs(Object.assign({ x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2 }, a))}/>`; break;
      case "text": {
        const lines = Array.isArray(p.lines) ? p.lines : [p.s];
        const lh = (a["font-size"] || 10) * (p.lh || 1.1);
        const y0 = p.y - (lines.length - 1) * lh / 2 * (p.valign === "top" ? 0 : 1);
        if (lines.length === 1) out += `<text${attrs(Object.assign({ x: p.x, y: p.y }, a))}>${M.esc(lines[0])}</text>`;
        else out += `<text${attrs(Object.assign({ x: p.x, y: y0 }, a))}>${lines.map((l, i) => `<tspan x="${n(p.x)}" dy="${i ? n(lh) : 0}">${M.esc(l)}</tspan>`).join("")}</text>`;
        break;
      }
    }
  }
  return out;
};

// --- Warnings ----------------------------------------------------------------
M.warn = (W, msg) => { if (!W.includes(msg)) W.push(msg); };

// ---- src/tokens.gen.js ----
// =============================================================================
// tokens.gen — GENERATED by tools/tokens.js from the design system's tokens.json
// (its colour tokens and its `palette` group). Do not edit: change the tokens
// and run node tools/tokens.js.
// =============================================================================
M.PALETTE = {
 "version": 1,
 "source": "Blades '68 Design System v2",
 "inks": {
  "ink-900": "#14110e",
  "ink-700": "#2a2521",
  "ink-500": "#55504a",
  "ink-300": "#8e8880",
  "ink-150": "#c9c3b8",
  "paper-000": "#fbf8f1",
  "paper-100": "#f2ede1",
  "paper-200": "#e8e2d4",
  "paper-300": "#dcd4c2",
  "paper-tint": "#efe7d6",
  "signal-500": "#e0691e",
  "signal-700": "#b8481a",
  "signal-900": "#6b2a10",
  "caution-500": "#e8c33c",
  "caution-700": "#c39b18",
  "caution-900": "#6e5408",
  "alarm-500": "#e03a20",
  "alarm-700": "#a8210f",
  "alarm-900": "#5c1208",
  "file-500": "#3f62c4",
  "file-700": "#26418f",
  "file-900": "#12224f",
  "file-300": "#8fa3dd",
  "covert-500": "#6e8f6a",
  "covert-700": "#41633e",
  "covert-900": "#13513b",
  "rust-500": "#c1571c",
  "rust-700": "#8a3c14",
  "rust-900": "#3a2213",
  "swing-500": "#c9348c",
  "swing-700": "#98206a",
  "swing-900": "#4e0f36",
  "slate-500": "#6e8a8c",
  "slate-700": "#3e5356",
  "slate-900": "#1a1a1c",
  "flesh-500": "#d9736e"
 },
 "schemes": {
  "olive and mustard": [
   "#6f6c34",
   "#d6a42c"
  ],
  "orange and brown": [
   "#d6742c",
   "#6a3c1e"
  ],
  "turquoise and cream": [
   "#2e9894",
   "#efe2c2"
  ],
  "grey and charcoal": [
   "#9b9891",
   "#3b3936"
  ],
  "mint green and coral": [
   "#9ccfb2",
   "#e4705c"
  ],
  "teal and ochre": [
   "#2e6c70",
   "#c88a2e"
  ],
  "ketchup and mustard": [
   "#bf3a2c",
   "#dfae2e"
  ],
  "avocado and cream": [
   "#7e883c",
   "#ece0bf"
  ],
  "hot pink and orange": [
   "#cf3a87",
   "#e5732b"
  ],
  "brown and more brown": [
   "#7a4b2b",
   "#4a2c19"
  ],
  "black and white": [
   "#22201d",
   "#f1ebdf"
  ],
  "hot pink and lime green": [
   "#cf3a87",
   "#a3c43b"
  ]
 },
 "bands": {
  "public": {
   "from": "paper-000",
   "to": "a",
   "t": 0.14
  },
  "working": {
   "from": "paper-000",
   "to": "a",
   "t": 0.3
  },
  "controlled": {
   "from": "paper-000",
   "to": "a",
   "t": 0.52
  },
  "secure": {
   "from": "a",
   "to": "ink-900",
   "t": 0.18
  },
  "corridor": {
   "from": "paper-000",
   "to": "a",
   "t": 0.06
  },
  "darkField": {
   "public": "paper-000",
   "working": "paper-200",
   "controlled": "ink-150",
   "secure": {
    "from": "a",
    "to": "paper-300",
    "t": 0.15
   }
  }
 },
 "light": {
  "bluetime": {
   "time": "bluetime",
   "key": {
    "az": 135,
    "el": 40
   },
   "keyColor": "#f3f1ea",
   "ambient": "#3a4256",
   "shadow": {
    "color": "#1c2130",
    "opacity": 0.4
   },
   "rim": null,
   "under": null
  },
  "night": {
   "time": "night",
   "key": {
    "az": 115,
    "el": 22
   },
   "keyColor": "#f0b25a",
   "ambient": "#1d2438",
   "shadow": {
    "color": "#0d1220",
    "opacity": 0.55
   },
   "rim": {
    "color": "#6f86b8",
    "strength": 0.75
   },
   "under": null
  }
 },
 "plate": {
  "deep": {
   "olive and mustard": "caution-900",
   "orange and brown": "rust-900",
   "turquoise and cream": "covert-900",
   "grey and charcoal": "slate-900",
   "mint green and coral": "covert-900",
   "teal and ochre": "covert-900",
   "ketchup and mustard": "alarm-900",
   "avocado and cream": "covert-900",
   "hot pink and orange": "swing-900",
   "brown and more brown": "rust-900",
   "black and white": "ink-900",
   "hot pink and lime green": "swing-900"
  }
 }
};

// ---- src/light.js ----
// =============================================================================
// light — the light contract (WAVE2-SPEC S2.2), the map kit's side
// =============================================================================
// One object, the same in both kits:
//   light = { time: "bluetime" | "night", key: { az, el }, keyColor, ambient,
//             shadow: { color, opacity }, rim, under, pools }
// Its presets are the design system's (palette.light, src/tokens.gen.js). The
// street, the chase strip and the plate theme take `light` (a preset name or a
// contract object, merged onto its time's preset) or `time` (which picks the
// preset). B68Map.lightAt and B68Map.chaseLightAt return the light a figure
// standing at a spot gets, for the figure kit to read.
//
// key.az: the figure kit reads it on the picture plane (0 = from the viewer's
// right, 90 = from above, 180 = from the viewer's left). What lightAt returns is
// in those terms, worked out from where the map's own key comes from, so a
// figure stands in the street's light. The map draws from LT.MAP: the key's
// plan direction (`from`, x east and y toward the street; the plate's light
// comes from the street) and how low it is (`el`, which sets how long the
// shadows fall). [interpretation]

const LT = M.light = {};
LT.PRESETS = M.PALETTE.light;
LT.clone = o => JSON.parse(JSON.stringify(o));
LT.MAP = {
  bluetime: { from: [-0.6, 0.8], el: 30, stipple: 0.58 },
  night: { pool: "#f0c55a", spill: "#f0b34a", screen: "#a9c6ff", fire: "#e0691e", glow: "#d9736e" }
};

// A time or a preset name → "bluetime" | "night" | null.
LT.timeKey = t => {
  const s = String(t == null ? "" : t).trim();
  if (/^night$/i.test(s)) return "night";
  if (/^(bluetime|blue|day|daylight)$/i.test(s)) return "bluetime";
  return null;
};
// opt → the full contract, or null when opt names no light. A string is a
// preset; an object is merged onto its time's preset (Bluetime by default),
// as the figure kit reads it.
LT.resolve = function (opt) {
  if (opt == null || opt === false || opt === "") return null;
  if (typeof opt === "string") { const k = LT.timeKey(opt); return k ? LT.clone(LT.PRESETS[k]) : null; }
  if (typeof opt !== "object") return null;
  const k = LT.timeKey(opt.time) || "bluetime", base = LT.PRESETS[k];
  const L = Object.assign(LT.clone(base), LT.clone(opt));
  L.time = k;
  L.key = Object.assign({}, base.key, typeof opt.key === "object" ? opt.key : {});
  if (typeof opt.key === "number") L.key.az = opt.key;
  L.shadow = Object.assign({}, base.shadow, opt.shadow || {});
  return L;
};
// "Bluetime" | "Night" (the kit's own words) for a contract.
LT.word = L => L && L.time === "night" ? "Night" : "Bluetime";

// The street's (and the plate's) time and light: `light` first, then `time`,
// then the roll's printed time. Returns { time, rolled, asPlayed, light } with
// time "Bluetime" or "Night" and light the full contract. [interpretation]
LT.forRoll = function (o, opts, W) {
  const rolled = /night/i.test(o.timeOfDay || "") ? "Night" : o.timeOfDay ? "Bluetime" : null;
  let want = null, light = null;
  if (opts.light != null && opts.light !== "") {
    light = LT.resolve(opts.light);
    if (!light) M.warn(W, `light ${JSON.stringify(opts.light)} is not a light preset (bluetime, night) or a light object — drawing the roll's (${rolled || "Bluetime"})`);
    else want = LT.word(light);
  }
  if (!want && opts.time != null && opts.time !== "") {
    const k = LT.timeKey(opts.time);
    if (!k) M.warn(W, `time "${opts.time}" is not one of Bluetime, Night — drawing the roll's (${rolled || "Bluetime"})`);
    else want = k === "night" ? "Night" : "Bluetime";
  }
  const time = want || rolled || "Bluetime";
  if (!light) light = LT.resolve(time === "Night" ? "night" : "bluetime");
  return { time, rolled, asPlayed: !!want && !!rolled && want !== rolled, light };
};

// The plan direction the plate's key comes from, and its shadow per foot of
// height (a unit vector away from the key, times 1 / tan el), for an iso that
// looks in from corner vx (1: the front-right, −1: the front-left).
LT.planKey = function (L, vx) {
  const m = LT.MAP.bluetime, f = (L && L.map && L.map.from) || m.from, el = (L && L.map && L.map.el) || m.el;
  const fx = f[0] * (vx || 1), fy = f[1], n = Math.hypot(fx, fy) || 1;
  const len = 1 / Math.tan(el * Math.PI / 180);
  return { from: [fx / n, fy / n], shadow: [-fx / n * len, -fy / n * len], el };
};
// The picture-plane key a figure gets from a plan direction seen through a
// view's projection (screen x of the key's direction): the house key (135, the
// upper left) when the light comes from the viewer's left, mirrored (45) when
// it comes from the right.
LT.figureKey = function (L, screenFromX) {
  const az = screenFromX <= 0 ? L.key.az : 180 - L.key.az;
  return { az, el: L.key.el };
};

// How strongly a pool lights a figure d feet from its centre, r its reach.
LT.poolStrength = (d, r) => d >= r ? 0 : +(0.9 * (1 - (d / r) ** 1.6)).toFixed(3);
// A figure in a pool at Night: the pool's colour as the key and as an
// under-light from the floor (WAVE2-SPEC S2.2; the figure kit's NIGHT_POOL).
LT.inPool = function (L, pool, strength) {
  const out = LT.clone(L);
  if (!pool || !(strength >= 0.05)) { out.under = null; return out; }
  out.keyColor = pool.color;
  out.under = { color: pool.color, strength: +Math.min(1, strength).toFixed(3) };
  return out;
};

// --- B68Map.lightAt(roll, opts, { x, y }) -----------------------------------------
// The light a figure standing on the street gets: the preset (from opts.light,
// opts.time or the roll), with the street's key turned into the figure kit's
// picture-plane terms, plus at Night the nearest lamp pool or lit doorway as
// keyColor and `under`. The spot is in the street view's world feet (x east, y
// toward the street, the building's front at y = 0; z the ground it stands on,
// default 0) or, as { px, py }, in the viewBox units of the street render drawn
// with the same opts. Returns the contract with `at` (world feet), `px` (where
// that is on the render, in its viewBox units: translate(px) puts a figure's feet
// there), `pxPerFt` (viewBox units per foot, to size a figure there) and `pool`.
M.lightAt = function (o, opts = {}, pt = {}) {
  const W = [], raw = Object.assign({}, opts, { view: "street" });
  const ro = M.resolveOpts(raw, W), theme = M.own(M.THEMES, ro.theme) || M.THEMES.rulebook;
  const model = M.model(o, W);
  const seed = ro.seed != null ? ro.seed : (o.seed != null ? o.seed : M.hash(model.name + model.district));
  const B = M.street.build(o, ro, W, theme, model, seed, "b68l" + M.hash(model.name).toString(36));
  const sc = B.scene, out = B.out, V = sc.street.view, L = B.T.light;
  const cs = (out.content && out.content.cs) || 1;
  // the SVG's own viewBox units (the page composePage draws on), not output pixels
  const toPx = (x, y, z) => { const [sx, sy] = V.proj(x, y, z); return [out.content.cx + sx * cs, out.content.cy + sy * cs]; };
  let x = +pt.x, y = +pt.y, z = +pt.z || 0;
  if (pt.px != null && pt.py != null) {
    const dx = (pt.px - out.content.cx) / cs, dy = (pt.py - out.content.cy) / cs, IC = Math.cos(Math.PI / 6), a = dx / IC, b = 2 * (dy + z);
    if (V.flip) { y = (a + b) / 2; x = (a - b) / 2; } else { x = (a + b) / 2; y = (b - a) / 2; }
  }
  if (!isFinite(x) || !isFinite(y)) { M.warn(W, "lightAt: give { x, y } (street feet) or { px, py } (render pixels)"); x = 0; y = 10; }
  // the key on the picture plane: where the map's key comes from, as the view sees it
  const pk = LT.planKey(L, V.flip ? -1 : 1), sfx = V.proj(pk.from[0], pk.from[1], 0)[0] - V.proj(0, 0, 0)[0];
  let res = LT.clone(L);
  res.key = LT.figureKey(L, sfx);
  // at Night, the nearest pool: lamps, lit doorways and shopfronts
  let pool = null, best = 0;
  if (L.time === "night") for (const p of sc.street.pools || []) {
    if (Math.abs((p.z || 0) - z) > 1.5) continue;
    const d = Math.hypot(p.x - x, (p.y - y) / (p.ry && p.r ? p.ry / p.r : 1)), s = LT.poolStrength(d, p.r) * (p.strength || 1);
    if (s > best) { best = s; pool = Object.assign({ d: +d.toFixed(2) }, p); }
  }
  if (L.time === "night") res = Object.assign(LT.inPool(res, pool, best), { key: res.key });
  res.pools = undefined; delete res.pools;
  const [px, py] = toPx(x, y, z), up = toPx(x, y, z + 1);
  return Object.assign(res, { at: { x: +x.toFixed(2), y: +y.toFixed(2), z }, px: [+px.toFixed(1), +py.toFixed(1)], pxPerFt: +Math.hypot(up[0] - px, up[1] - py).toFixed(3), pool: pool ? Object.assign(pool, { strength: best }) : null, warnings: W });
};

// --- B68Map.chaseLightAt(chase, panel, x, opts) ----------------------------------------
// The light a figure standing in a chase panel gets: panel is the panel's index
// (0 = the first), x how far across it (0–1, as a panel's show[].x). The panel's
// time picks the preset; at Night the nearest lamp's pool lights it from below.
// opts are the chase's render options (layout, …): the lamps stand where that
// layout draws them.
M.chaseLightAt = function (chase, panel, x, opts = {}) {
  const cap = {};
  const r = M.chaseRender(chase, Object.assign({}, opts, { _light: cap }));
  const W = r.warnings.slice(), P = cap[panel];
  if (!P) { M.warn(W, `chaseLightAt: panel ${panel} is not drawn (panels 0–${Object.keys(cap).length - 1})`); return Object.assign(LT.resolve("bluetime"), { pool: null, warnings: W }); }
  const L = LT.resolve(P.night ? "night" : "bluetime"), at = Math.max(0, Math.min(1, +x || 0)) * P.W;
  let pool = null, best = 0;
  if (P.night) for (const p of P.pools) { const s = LT.poolStrength(Math.abs(p.x - at), p.r); if (s > best) { best = s; pool = Object.assign({ d: +Math.abs(p.x - at).toFixed(2) }, p); } }
  // the strip is side-on: its lamps are drawn with their light falling from the left (chaseparts chLamp) [interpretation]
  const res = P.night ? LT.inPool(L, pool, best) : L;
  return Object.assign(res, { panel, x: +(+x || 0).toFixed(3), atFt: +at.toFixed(2), pool: pool ? Object.assign(pool, { strength: best }) : null, warnings: W });
};

// ---- src/weather.js ----
// =============================================================================
// weather — E4: rain, fog and snow, as flat overlays
// =============================================================================
// The roll's printed weather (p.419–420: clear blue sky, bright grey sky,
// drizzle, a cold breeze, strong wind; cold and still, rain, fog, sleet and
// snow, howling winds, a thunderstorm), or the `weather` option, drawn over the
// drawing and under its words: rain as streaks, snow as flakes, fog as a veil in
// bands. Each is one small pattern or a few shapes, never a noise filter, so the
// file stays small. Wind, cold and a clear sky draw nothing. [interpretation]
//
//   weather: true (the roll's) | false (none) | "rain" | "fog" | "snow" | any printed weather
// The plate draws the roll's weather unless told otherwise; the other themes'
// street draws it only when asked (weather: true or a name), so their files
// stay as they were.

const WX = M.weather = {};
// A weather's words → what is drawn: rain 0–3 (drizzle, rain, a storm), fog 0–2,
// snow 0–2, and `after` when it comes only after the snap (Night).
WX.read = function (s) {
  const t = String(s || "").toLowerCase(), w = { rain: 0, fog: 0, snow: 0, after: false, text: String(s || "") };
  if (/thunder|storm/.test(t)) w.rain = 3; else if (/\brain|shower|downpour/.test(t)) w.rain = 2; else if (/drizzle|sleet/.test(t)) w.rain = 1;
  if (/snow|blizzard/.test(t)) w.snow = /blizzard|heavy/.test(t) ? 2 : 1;
  if (/\bfog|mist/.test(t)) w.fog = 2; else if (/smog|haze/.test(t)) w.fog = 1;
  if (/after|snap/.test(t)) w.after = true;
  return w;
};
WX.any = w => !!w && (w.rain > 0 || w.fog > 0 || w.snow > 0);
// What a render draws: from opts.weather, else (when the theme draws weather
// by default) the roll's. `night` gates a weather that comes after the snap.
WX.forRender = function (o, opts, night, byDefault, W) {
  const v = opts.weather;
  let w = null;
  if (v === false || v === "none") return null;
  if (v === true || (v == null && byDefault)) w = WX.read(o.weather || "");
  else if (typeof v === "string" && v) { w = WX.read(v); if (!WX.any(w) && !/clear|sky|breeze|wind|still|cold/i.test(v)) M.warn(W, `weather "${v}" names no rain, fog or snow — drawing none`); }
  if (!w || !WX.any(w)) return null;
  if (w.after && !night) return null;
  return w;
};

// The overlay over a box (drawing units), as SVG: its own defs, then its
// shapes. u is the size of a foot on the drawing (streaks and flakes keep
// their size on any sheet); dark is a dark (Night) drawing. id keeps its
// patterns apart from other maps on the page.
WX.overlay = function (w, box, id, o = {}) {
  if (!WX.any(w)) return "";
  const u = o.u || 1, dark = !!o.dark, n = v => +v.toFixed(2);
  const x = n(box.x), y = n(box.y), bw = n(box.w), bh = n(box.h);
  let defs = "", body = "";
  if (w.fog) {
    // a veil, and three bands of it lower down, thicker where the ground is
    const c = dark ? "#9aa2b4" : "#f6f3ec", a = w.fog > 1 ? 1 : 0.6;
    body += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${c}" opacity="${n((dark ? 0.12 : 0.22) * a)}"/>`;
    [[0.42, 0.16], [0.62, 0.2], [0.8, 0.14]].forEach(([f, hh], i) => {
      body += `<rect x="${x}" y="${n(y + bh * f)}" width="${bw}" height="${n(bh * hh)}" fill="${c}" opacity="${n((dark ? 0.1 : 0.16) * a)}" rx="${n(bh * hh / 2)}"/>`;
      void i;
    });
  }
  if (w.rain) {
    // streaks: a tile of a few short slanted strokes, denser as the rain gets heavier
    const t = 9 * u, k = w.rain, sw = n(0.16 * u * (k > 2 ? 1.25 : 1)), len = 2.4 * u * (k > 2 ? 1.3 : 1);
    const pts = [[0.1, 0.15], [0.55, 0.05], [0.32, 0.5], [0.8, 0.42], [0.05, 0.72], [0.62, 0.83], [0.9, 0.7], [0.4, 0.95]].slice(0, k === 1 ? 3 : k === 2 ? 5 : 8);
    const c = dark ? "#b9c3dc" : "#55607a";
    defs += `<pattern id="${id}-rain" width="${n(t)}" height="${n(t)}" patternUnits="userSpaceOnUse" patternTransform="rotate(16)">` +
      pts.map(([a, b]) => `<line x1="${n(a * t)}" y1="${n(b * t)}" x2="${n(a * t)}" y2="${n(b * t + len)}" stroke="${c}" stroke-width="${sw}" stroke-linecap="round"/>`).join("") + `</pattern>`;
    body += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="url(#${id}-rain)" opacity="${k === 1 ? 0.45 : k === 2 ? 0.6 : 0.72}"/>`;
    if (k > 2) body += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${dark ? "#0d1220" : "#3a4256"}" opacity="${dark ? 0.12 : 0.08}"/>`;
  }
  if (w.snow) {
    // flakes in two sizes, and a pale wash
    const t = 11 * u, c = "#fbf8f1";
    const big = [[0.12, 0.2], [0.6, 0.1], [0.4, 0.55], [0.85, 0.48], [0.2, 0.85], [0.7, 0.9]], small = [[0.33, 0.28], [0.9, 0.2], [0.05, 0.5], [0.55, 0.72], [0.78, 0.66], [0.45, 0.02]];
    defs += `<pattern id="${id}-snow" width="${n(t)}" height="${n(t)}" patternUnits="userSpaceOnUse" patternTransform="rotate(8)">` +
      big.map(([a, b]) => `<circle cx="${n(a * t)}" cy="${n(b * t)}" r="${n(0.36 * u)}" fill="${c}"/>`).join("") +
      small.map(([a, b]) => `<circle cx="${n(a * t)}" cy="${n(b * t)}" r="${n(0.2 * u)}" fill="${c}" opacity="0.8"/>`).join("") + `</pattern>`;
    body += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${c}" opacity="${dark ? 0.06 : 0.12}"/>`;
    body += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="url(#${id}-snow)" opacity="${(w.snow > 1 ? 0.95 : 0.8) * (dark ? 0.8 : 1)}"/>`;
  }
  return `<g class="map-weather" pointer-events="none">${defs ? `<defs>${defs}</defs>` : ""}${body}</g>`;
};

// ---- src/catalogue.js ----
// =============================================================================
// catalogue — every room the generator can roll, and what it looks like
// =============================================================================
// The room NAMES are the book's (Score Rolodex p.421–429) and are exactly the
// strings the vault generator emits. What each one is drawn AS — its archetype,
// its size, which floor it sits on — is the kit's [interpretation], the same
// way the generator's banding is. Every entry is one line so a wrong call is
// one edit.
//
//   arch   archetype → a furnishing recipe in parts.js
//   w      size weight: 1 closet · 2 room · 3 big room · 5 hall · 7 floor-sized
//   lvl    -1 below ground · 0 street level · 1 upstairs · 2 roof / top floor

M.ROOMS = {
  // --- Offices (p.421) ---
  "Reception lobby": { arch: "lobby", w: 3, lvl: 0 },
  "Conference room": { arch: "conference", w: 2, lvl: 1 },
  "Break room": { arch: "breakroom", w: 2, lvl: 1 },
  "File storage room": { arch: "files", w: 2, lvl: -1 },
  "Corner office": { arch: "corner-office", w: 2, lvl: 2 },
  "Secretarial pool": { arch: "open-office", w: 4, lvl: 1 },
  "Janitor's closet": { arch: "closet", w: 1, lvl: 0 },
  "Elevator hall": { arch: "lift-hall", w: 1.5, lvl: 0 },
  "Restrooms": { arch: "restroom", w: 1.5, lvl: 0 },
  "Rooftop": { arch: "roof", w: 4, lvl: 2 },
  "Basement": { arch: "plant-room", w: 3, lvl: -1 },
  // --- Industrial Facility (p.422) ---
  "Assembly line": { arch: "assembly", w: 6, lvl: 0 },
  "Packing area": { arch: "packing", w: 3, lvl: 0 },
  "Storage warehouse": { arch: "warehouse", w: 6, lvl: 0 },
  "Control room": { arch: "control", w: 2, lvl: 1 },
  "Maintenance room": { arch: "workshop", w: 2, lvl: 0 },
  "Boiler room": { arch: "boiler", w: 2.5, lvl: -1 },
  "Loading dock": { arch: "dock", w: 3, lvl: 0 },
  "Waste processing": { arch: "waste", w: 2.5, lvl: 0 },
  "Coolant area": { arch: "tanks", w: 2.5, lvl: 0 },
  "Hydraulics room": { arch: "machines", w: 2, lvl: -1 },
  "R&D workshop": { arch: "lab", w: 3, lvl: 1 },
  // --- Scientific Facility (p.423) ---
  "Main lab": { arch: "lab", w: 4, lvl: 0 },
  "Testing area": { arch: "testing", w: 3, lvl: 0 },
  "Prototype storage": { arch: "vault-store", w: 2.5, lvl: -1 },
  "Clean room": { arch: "clean", w: 2.5, lvl: 1 },
  "Research offices": { arch: "offices", w: 3, lvl: 1 },
  "Data processing": { arch: "computer", w: 4, lvl: 1 },
  "Reception": { arch: "lobby", w: 2.5, lvl: 0 },
  "Chemical storage": { arch: "chem-store", w: 2, lvl: -1 },
  "Radiation shielding room": { arch: "radiation", w: 2, lvl: -1 },
  "Observation deck": { arch: "observation", w: 2.5, lvl: 2 },
  "Cryogenics lab": { arch: "cryo", w: 2.5, lvl: -1 },
  "Biological research lab": { arch: "biolab", w: 3, lvl: 1 },
  "Library": { arch: "library", w: 3, lvl: 1 },
  // --- Trendy Mansion (p.424) ---
  "Sunken lounge": { arch: "sunken-lounge", w: 4, lvl: 0 },
  "Bar area": { arch: "bar", w: 2.5, lvl: 0 },
  "Rooftop terrace": { arch: "terrace", w: 4, lvl: 2 },
  "Extensive gardens": { arch: "garden", w: 7, lvl: 0 },
  "Primary bedroom": { arch: "bedroom", w: 3, lvl: 1 },
  "Kitchen": { arch: "kitchen", w: 2.5, lvl: 0 },
  "A den": { arch: "den", w: 2, lvl: 1 },
  "Meditation room": { arch: "meditation", w: 2, lvl: 1 },
  "Dance floor": { arch: "dance", w: 4, lvl: 0 },
  "Dressing room": { arch: "dressing", w: 1.5, lvl: 1 },
  "Underground garage": { arch: "garage", w: 5, lvl: -1 },
  "Panic room": { arch: "panic", w: 1.5, lvl: 1 },
  // --- Old Mansion (p.425) ---
  "Grand foyer": { arch: "foyer", w: 3, lvl: 0 },
  "Ballroom": { arch: "ballroom", w: 6, lvl: 0 },
  "Servant's quarters": { arch: "servants", w: 3, lvl: 2 },
  "Wine cellar": { arch: "wine-cellar", w: 3, lvl: -1 },
  "Portrait gallery": { arch: "gallery", w: 3, lvl: 1 },
  "Kitchens": { arch: "kitchen", w: 3, lvl: -1 },
  "Study": { arch: "study", w: 2, lvl: 1 },
  "Drawing room": { arch: "lounge", w: 3, lvl: 0 },
  "Attic": { arch: "attic", w: 3, lvl: 2 },
  "Dining room": { arch: "dining", w: 3, lvl: 0 },
  "Trophy room": { arch: "trophy", w: 2.5, lvl: 1 },
  "Basement laboratory": { arch: "lab", w: 3, lvl: -1 },
  "Music room": { arch: "music", w: 2.5, lvl: 1 },
  // --- Casino (p.426) ---
  "Main floor": { arch: "casino-floor", w: 7, lvl: 0 },
  "Showroom": { arch: "showroom", w: 5, lvl: 0 },
  "Cocktail lounge": { arch: "cocktail", w: 3, lvl: 0 },
  "High-roller suites": { arch: "vip", w: 3, lvl: 1 },
  "Security control room": { arch: "security", w: 2, lvl: 1 },
  "Underground counting room": { arch: "counting", w: 2.5, lvl: -1 },
  "The grand lobby": { arch: "foyer", w: 4, lvl: 0 },
  "Private card rooms": { arch: "card-rooms", w: 3, lvl: 1 },
  "A vault": { arch: "vault", w: 2, lvl: -1 },
  "An adjoining hotel": { arch: "hotel", w: 5, lvl: 1 },
  "Luxury penthouse": { arch: "penthouse", w: 4, lvl: 2 },
  "Dance club": { arch: "dance", w: 4, lvl: 0 },
  "Restaurant": { arch: "restaurant", w: 4, lvl: 0 },
  "Backroom offices": { arch: "offices", w: 2.5, lvl: 1 },
  // --- Apartment Block (p.427) ---
  "Lobby": { arch: "lobby-mail", w: 2.5, lvl: 0 },
  "Apartment Block:Basement": { arch: "laundry-basement", w: 3, lvl: -1 },
  "Hallways": { arch: "hallway", w: 2, lvl: 1 },
  "Run-down apartment": { arch: "flat-rundown", w: 3, lvl: 1 },
  "Tidy apartment": { arch: "flat-tidy", w: 3, lvl: 1 },
  "Strange apartment": { arch: "flat-strange", w: 3, lvl: 2 },
  "A stairwell": { arch: "stairwell", w: 1.5, lvl: 0 },
  "Elevator": { arch: "lift-hall", w: 1, lvl: 0 },
  "Roof terrace": { arch: "terrace", w: 3, lvl: 2 },
  "Communal lounge": { arch: "lounge", w: 3, lvl: 0 },
  "Apartment Block:Maintenance room": { arch: "workshop", w: 2, lvl: -1 },
  "Fire escape": { arch: "fire-escape", w: 1, lvl: 1 },
  // --- Anomalous Zone (p.428–429) ---
  "Gravity well": { arch: "anom-gravity", w: 3, lvl: 0 },
  "Shifting passage": { arch: "anom-shift", w: 2.5, lvl: 0 },
  "The void": { arch: "anom-void", w: 3, lvl: 0 },
  "Temporal glitch": { arch: "anom-temporal", w: 3, lvl: 0 },
  "Hall of mirrors": { arch: "anom-mirrors", w: 3, lvl: 0 },
  "Memory spheres": { arch: "anom-orbs", w: 3, lvl: 0 },
  "A room overgrown with dense plant life": { arch: "anom-overgrown", w: 3, lvl: 0 },
  "Infinite recursive staircases": { arch: "anom-stairs", w: 3, lvl: 0 },
  "A fire that doesn't burn": { arch: "anom-fire", w: 2, lvl: 0 },
  "A raging snowstorm indoors": { arch: "anom-snow", w: 3, lvl: 0 },
  "A doorway that leads to a woodland forest": { arch: "anom-forest", w: 3, lvl: 0 }
};

// Look a room up, theme-specific first ("Apartment Block:Basement" beats the
// office "Basement"). An unknown name still draws — as an empty room — and
// warns, so a new generator table never crashes the kit.
M.roomInfo = (name, theme, mix) => {
  const key = s => `${s}:${name}`;
  return M.own(M.ROOMS, key(mix)) || M.own(M.ROOMS, key(theme)) || M.own(M.ROOMS, name) || null;
};
// The same, for a name written in a sentence ("in through the kitchens"):
// matched without regard to case.
M.roomInfoAny = (name, theme, mix) => {
  const hit = M.roomInfo(name, theme, mix);
  if (hit) return hit;
  const low = String(name).toLowerCase(), keys = Object.keys(M.ROOMS);
  const k = keys.find(q => q.toLowerCase() === low) || keys.find(q => q.toLowerCase().endsWith(":" + low));
  return k ? M.own(M.ROOMS, k) : null;
};

// --- Dressing by target type — [interpretation] -----------------------------
// The generator rolls a cinema from the Casino theme, a bank from Offices ×
// Casino, a laundrette from Industrial. The room NAMES stay the book's; this
// table only changes what is drawn inside them, so a cinema's "Main floor" is
// seat rows and a screen, not roulette wheels. Approved 14/10/2026 as
// [interpretation]. Anything not listed falls back to the room's own archetype.
M.DRESS = {
  "Cinema": { "Main floor": "auditorium", "Showroom": "auditorium", "Cocktail lounge": "concession",
    "The grand lobby": "box-office", "High-roller suites": "boxes", "Security control room": "projection",
    "Dance club": "auditorium", "Restaurant": "concession" },
  "Pub": { "Main floor": "pub", "Showroom": "stage-small", "Cocktail lounge": "snug",
    "The grand lobby": "pub", "Restaurant": "dining" },
  "Milkbar": { "Main floor": "milkbar", "Cocktail lounge": "booths", "Showroom": "booths", "The grand lobby": "milkbar" },
  "Kaff house": { "Main floor": "kaff", "Cocktail lounge": "booths", "Showroom": "stage-small", "The grand lobby": "kaff" },
  "Automat diner": { "Main floor": "automat", "Cocktail lounge": "booths", "Showroom": "booths", "The grand lobby": "automat" },
  "Restaurant": { "Main floor": "dining", "Showroom": "stage-small", "Cocktail lounge": "bar", "The grand lobby": "maitre-d", "Restaurant": "dining" },
  "Bank": { "Main floor": "banking-hall", "The grand lobby": "banking-hall", "Showroom": "deposit-boxes",
    "Reception lobby": "banking-hall", "Underground counting room": "counting", "A vault": "vault",
    "Secretarial pool": "teller-backoffice", "High-roller suites": "private-banking", "Private card rooms": "private-banking",
    "Cocktail lounge": "private-banking", "Restaurant": "staff-canteen", "Dance club": "teller-backoffice" },
  "Precinct station": { "Reception lobby": "precinct-desk", "Secretarial pool": "squad-room", "File storage room": "evidence",
    "Basement": "cells", "Break room": "breakroom", "Conference room": "interview" },
  "Newsagent": { "Reception lobby": "shop-news", "Secretarial pool": "stockroom" },
  "Records office": { "Reception lobby": "counter-public", "Secretarial pool": "open-office" },
  "Pawnshop": { "Lobby": "shop-pawn", "Hallways": "stockroom", "Apartment Block:Basement": "stockroom" },
  "Bookshop": { "Lobby": "shop-books", "Hallways": "stockroom", "Communal lounge": "shop-books" },
  "House": { "Lobby": "foyer-small", "Hallways": "hallway" },
  "Laundrette": { "Assembly line": "laundry", "Packing area": "folding", "Storage warehouse": "laundry" },
  "Garage": { "Assembly line": "car-bays", "Storage warehouse": "car-bays", "Packing area": "parts-store" },
  "Boathouse": { "Storage warehouse": "boat-slip", "Assembly line": "boat-slip", "Loading dock": "jetty" },
  "Ship": { "Storage warehouse": "hold", "Assembly line": "hold", "Loading dock": "gangway", "Packing area": "hold" },
  "Electroplasmic substation": { "Assembly line": "transformers", "Boiler room": "generator", "Storage warehouse": "transformers" },
  "Pharmacy": { "Main lab": "dispensary", "Reception": "shop-pharmacy", "Testing area": "dispensary" },
  "School": { "Main lab": "classroom", "Testing area": "classroom", "Research offices": "staff-room",
    "Data processing": "classroom", "Conference room": "classroom" },
  "Temple": { "Ballroom": "nave", "Grand foyer": "narthex", "Portrait gallery": "chapel" },
  // The two open-air rows (seed-only, 21/10/2026): drawn without a roof (outdoors.js).
  // Market is Casino × Industrial Facility, Autodrome Industrial Facility × Casino.
  "Market": { "Main floor": "market-stalls", "Showroom": "market-stalls", "Dance club": "market-stalls", "The grand lobby": "market-gate",
    "Cocktail lounge": "food-stalls", "Restaurant": "food-stalls", "Storage warehouse": "stockyard" },
  "Autodrome": { "Assembly line": "track", "Main floor": "track", "Storage warehouse": "pits", "Packing area": "pits", "Showroom": "grandstand",
    "Dance club": "grandstand", "Control room": "race-control", "Loading dock": "car-bays", "High-roller suites": "boxes", "Cocktail lounge": "food-stalls", "Restaurant": "food-stalls" }
};

// --- The twelve printed colour schemes (p.430) → paint ----------------------
// Two swatches each: a = the field colour, b = the accent. Sampled to sit with
// the design system's own tokens rather than as pure hues. They live in the
// design system's palette (tokens.json → src/tokens.gen.js, palette.schemes).
M.COLOURS = Object.fromEntries(Object.entries(M.PALETTE.schemes).map(([k, v]) => [k, v.slice()]));

M.BANDS = ["public", "working", "controlled", "secure"];
M.BAND_LABEL = { public: "Public", working: "Working", controlled: "Controlled", secure: "Secure" };

// The six printed building styles' plan geometry — mirrors the generator's
// T.geometry so a bare spec (no o.geometry) still lays out the same way.
M.GEOMETRY = { "Modernist": "glazed", "Brutalist": "hard", "Old relic": "blurred",
  "Corporate chic": "spine", "Alternative": "soft", "Futurist": "radial" };

// ---- src/parts.js ----
// =============================================================================
// parts — the fixtures, drawn top-down
// =============================================================================
// A part is draw(o) → pieces, centred on (0,0), in feet, with its "back" toward
// −y (so a part placed against the top wall needs no rotation). It knows
// nothing about colour: it uses the fixture roles below and the theme paints.
//
//   fx     the furniture body          fx2   the building's accent colour
//   fx3    dark — upholstery, voids    fxl   light — paper, tops, sheets
//   fxm    metal and machine grey      fxw   water
//   fxg    plants                      fxglow anomalous light
//   fxline a thin detail strip (a filled sliver, never a stroke)
//
// The rulebook's rule holds here: no outlines. Detail is a darker or lighter
// filled shape, and the theme adds the hard cast shadow.

const PARTS = M.PARTS = {};
const reg = (name, describe, size, draw) => { PARTS[name] = { name, describe, size, draw }; };
const R_ = (r, x, y, w, h, o) => P.rect(r, x - w / 2, y - h / 2, w, h, o);   // centred rect

// --- Seating and tables --------------------------------------------------------
reg("chair", "A single chair.", [1.6, 1.6], () => [R_("fx3", 0, 0, 1.5, 1.5, { rx: 0.3 }), R_("fx", 0, -0.55, 1.5, 0.45, { rx: 0.2 })]);
reg("stool", "A bar stool.", [1.2, 1.2], () => [P.circle("fx3", 0, 0, 0.6), P.circle("fx", 0, 0, 0.35)]);
reg("armchair", "Club armchair.", [2.6, 2.6], () => [R_("fx2", 0, 0, 2.6, 2.6, { rx: 0.5 }), R_("fx", 0, 0.25, 1.7, 1.7, { rx: 0.3 })]);
reg("bubble-chair", "A Futurist bubble chair.", [3, 3], () => [P.circle("fxl", 0, 0, 1.5), P.circle("fx2", 0, 0.3, 1.0)]);
reg("sofa", "A three-seat sofa.", [6.5, 2.8], () => [R_("fx2", 0, 0, 6.5, 2.8, { rx: 0.5 }), R_("fx", 0, 0.35, 5.2, 1.9, { rx: 0.3 }), R_("fx3", -0.87, 0.35, 0.08, 1.7), R_("fx3", 0.87, 0.35, 0.08, 1.7)]);
reg("sofa-curve", "A conversation pit's curved sofa.", [8, 4], () => [P.path("fx2", "M-4 -1 A4 4 0 0 0 4 -1 L4 1 A4 2.6 0 0 1 -4 1 Z"), P.path("fx", "M-3.2 -0.4 A3.2 3 0 0 0 3.2 -0.4 L3.2 0.6 A3.2 2 0 0 1 -3.2 0.6 Z")]);
reg("table", "A small square table with chairs.", [5, 5], () => [R_("fx3", 0, -1.7, 1.4, 1.2, { rx: 0.25 }), R_("fx3", 0, 1.7, 1.4, 1.2, { rx: 0.25 }), R_("fx3", -1.7, 0, 1.2, 1.4, { rx: 0.25 }), R_("fx3", 1.7, 0, 1.2, 1.4, { rx: 0.25 }), R_("fx", 0, 0, 2.6, 2.6)]);
reg("table-round", "Round table with four chairs.", [5, 5], () => [P.circle("fx3", 0, -1.85, 0.65), P.circle("fx3", 0, 1.85, 0.65), P.circle("fx3", -1.85, 0, 0.65), P.circle("fx3", 1.85, 0, 0.65), P.circle("fx", 0, 0, 1.45), P.circle("fxl", 0, 0, 0.45)]);
reg("table-long", "A long table with chairs both sides.", [12, 5], o => {
  const L = o.w || 12, k = [];
  for (let x = -L / 2 + 1.5; x <= L / 2 - 1.4; x += 2.2) { k.push(R_("fx3", x, -1.75, 1.3, 1.1, { rx: 0.25 })); k.push(R_("fx3", x, 1.75, 1.3, 1.1, { rx: 0.25 })); }
  k.push(R_("fx", 0, 0, L - 1, 2.5)); k.push(R_("fxline", 0, 0, L - 2.4, 0.12)); return k;
});
reg("booth", "A diner or lounge booth.", [6, 6], () => [R_("fx2", 0, -2.2, 5.2, 1.5, { rx: 0.4 }), R_("fx2", 0, 2.2, 5.2, 1.5, { rx: 0.4 }), R_("fx", 0, 0, 4.4, 2.2)]);
reg("coffee-table", "A low coffee table.", [3.5, 2], () => [R_("fx", 0, 0, 3.4, 1.9, { rx: 0.2 }), R_("fxl", 0.5, 0, 0.7, 0.5)]);
reg("rug", "A rug.", [8, 6], o => [R_("fx2", 0, 0, o.w || 8, o.h || 6, { rx: 0.3 }), R_("fx", 0, 0, (o.w || 8) - 1.4, (o.h || 6) - 1.4, { rx: 0.2 })]);

// --- Work ----------------------------------------------------------------------
reg("desk", "A desk with chair and papers.", [5, 4.5], () => [R_("fx3", 0, 1.4, 1.5, 1.4, { rx: 0.3 }), R_("fx", 0, -0.5, 5, 2.6), R_("fxl", -1.2, -0.6, 1.1, 0.8), R_("fx3", 1.4, -0.7, 0.8, 0.8, { rx: 0.4 })]);
reg("desk-big", "An executive desk.", [7, 5], () => [R_("fx3", 0, 1.7, 2.0, 1.6, { rx: 0.4 }), R_("fx", 0, -0.4, 7, 3.2), R_("fx2", 0, -0.4, 6.2, 2.4), R_("fxl", -1.8, -0.5, 1.2, 0.9), R_("fx3", 2.2, -0.6, 0.9, 0.9, { rx: 0.45 })]);
reg("typing-desk", "A typist's desk.", [4, 4], () => [R_("fx3", 0, 1.2, 1.3, 1.2, { rx: 0.3 }), R_("fx", 0, -0.4, 3.8, 2.2), R_("fxm", 0, -0.5, 1.6, 1.1), R_("fxl", 0, -1.1, 1.2, 0.35)]);
reg("filing", "A run of filing cabinets.", [6, 2.2], o => { const L = o.w || 6, k = [R_("fxm", 0, 0, L, 2.2)]; for (let x = -L / 2 + 1.5; x < L / 2; x += 1.5) k.push(R_("fx3", x, 0, 0.1, 2.2)); return k; });
reg("shelf", "A shelving run.", [10, 2], o => { const L = o.w || 10, k = [R_("fx", 0, 0, L, 2)]; for (let x = -L / 2 + 0.5; x < L / 2 - 0.3; x += 1.1) k.push(R_(o.alt ? "fx2" : "fxl", x + 0.4, 0, 0.7, 1.5)); return k; });
reg("bookcase", "Bookshelves.", [8, 1.5], o => { const L = o.w || 8, k = [R_("fx", 0, 0, L, 1.5)]; let i = 0; for (let x = -L / 2 + 0.3; x < L / 2 - 0.3; x += 0.55) k.push(R_(["fx2", "fx3", "fxl"][i++ % 3], x + 0.2, 0.05, 0.4, 1.1)); return k; });
reg("counter", "A service counter.", [10, 2.5], o => { const L = o.w || 10; return [R_("fx", 0, 0, L, 2.5), R_("fx2", 0, 0.95, L, 0.6), R_("fxl", -L / 4, -0.2, 1.2, 0.8)]; });
reg("bar", "A bar with stools and a back bar.", [12, 6], o => { const L = o.w || 12, k = [R_("fx3", 0, -2.4, L, 1.2), R_("fx", 0, 0, L, 2.4, { rx: 0.4 }), R_("fx2", 0, 0, L - 0.8, 0.5)]; for (let x = -L / 2 + 1.2; x < L / 2 - 0.6; x += 2) k.push(P.circle("fx3", x, 2.1, 0.6)); for (let x = -L / 2 + 0.8; x < L / 2 - 0.4; x += 0.9) k.push(R_("fxl", x, -2.4, 0.4, 0.7)); return k; });
reg("workbench", "A workbench with tools.", [8, 3], o => { const L = o.w || 8; return [R_("fx", 0, 0, L, 3), R_("fxm", -L / 4, -0.3, 1.6, 1), R_("fxl", L / 5, 0.2, 1.4, 0.9), R_("fx3", L / 3, -0.6, 0.5, 0.5, { rx: 0.25 })]; });
reg("console", "A control desk of dials and switches.", [8, 3.5], o => { const L = o.w || 8, k = [R_("fxm", 0, 0, L, 3.4, { rx: 0.4 }), R_("fx3", 0, -0.7, L - 0.8, 1.2)]; for (let x = -L / 2 + 1; x < L / 2 - 0.5; x += 1.1) { k.push(P.circle("fx2", x, -0.7, 0.3)); k.push(R_("fxl", x, 0.6, 0.5, 0.3)); } return k; });
reg("monitor-wall", "A wall of surveillance monitors.", [10, 2], o => { const L = o.w || 10, k = [R_("fx3", 0, 0, L, 2)]; for (let x = -L / 2 + 0.9; x < L / 2 - 0.5; x += 1.6) k.push(R_("fxglow", x + 0.2, 0, 1.3, 1.1)); return k; });
reg("computer", "A room-sized punch-card computer cabinet.", [4, 2.5], () => [R_("fxm", 0, 0, 4, 2.5), P.circle("fx3", -0.9, -0.2, 0.55), P.circle("fx3", 0.5, -0.2, 0.55), R_("fx2", 0, 0.85, 3.4, 0.35)]);
reg("chalkboard", "A chalkboard on the wall.", [8, 0.8], o => [R_("fx3", 0, 0, o.w || 8, 0.7), R_("fxl", -1, 0, 1.5, 0.15)]);
reg("lockers", "A row of lockers.", [8, 1.8], o => { const L = o.w || 8, k = [R_("fxm", 0, 0, L, 1.8)]; for (let x = -L / 2 + 1.1; x < L / 2; x += 1.1) k.push(R_("fx3", x, 0, 0.08, 1.8)); return k; });

// --- Domestic --------------------------------------------------------------------
reg("bed", "A double bed.", [5, 7], () => [R_("fx", 0, 0, 5, 7, { rx: 0.3 }), R_("fxl", 0, -2.6, 4.4, 1.4, { rx: 0.4 }), R_("fx2", 0, 1.2, 5, 4.4)]);
reg("bed-round", "A huge circular bed.", [9, 9], () => [P.circle("fx2", 0, 0, 4.5), P.circle("fx", 0, 0, 3.6), R_("fxl", 0, -2.2, 3.4, 1, { rx: 0.5 })]);
reg("bunk", "A narrow bunk.", [3, 6.5], () => [R_("fx", 0, 0, 3, 6.5), R_("fxl", 0, -2.5, 2.5, 1, { rx: 0.3 }), R_("fx2", 0, 1, 3, 4)]);
reg("wardrobe", "Wardrobe or bureau.", [4, 2], () => [R_("fx", 0, 0, 4, 2), R_("fx3", 0, 0, 0.1, 2)]);
reg("stove", "A stove.", [2.5, 2.2], () => [R_("fxm", 0, 0, 2.5, 2.2), P.circle("fx3", -0.6, -0.4, 0.4), P.circle("fx3", 0.6, -0.4, 0.4), P.circle("fx3", -0.6, 0.5, 0.4), P.circle("fx3", 0.6, 0.5, 0.4)]);
reg("sink", "A sink.", [2.5, 2], () => [R_("fxm", 0, 0, 2.5, 2), R_("fxw", 0, 0.1, 1.7, 1.2, { rx: 0.4 })]);
reg("kitchen-run", "A run of counters with sink and stove.", [12, 2.4], o => { const L = o.w || 12; return [R_("fx", 0, 0, L, 2.4), R_("fxw", -L / 4, 0, 1.6, 1.2, { rx: 0.3 }), R_("fxm", L / 5, 0, 2.2, 1.8), P.circle("fx3", L / 5 - 0.5, -0.3, 0.35), P.circle("fx3", L / 5 + 0.5, 0.35, 0.35)]; });
reg("toilet-stall", "A toilet stall.", [3, 5], () => [R_("fxline", -1.5, 0, 0.15, 5), R_("fxline", 1.5, 0, 0.15, 5), R_("fxl", 0, -1.4, 1.4, 2, { rx: 0.6 })]);
reg("bath", "A bathtub.", [3, 6], () => [R_("fxl", 0, 0, 3, 6, { rx: 0.8 }), R_("fxw", 0, 0.3, 2.2, 4.8, { rx: 0.7 })]);
reg("piano", "A grand piano.", [5, 6], () => [P.path("fx3", "M-2.5 -3 L2.5 -3 L2.5 0.8 C2.5 3.4 0.2 3.3 -0.5 2.2 C-1.4 0.8 -2.5 1.2 -2.5 0 Z"), R_("fxl", 0, -2.6, 4.6, 0.6), R_("fx3", 0, -3.8, 2, 0.8, { rx: 0.3 })]);
reg("plant", "A potted plant.", [2, 2], () => [P.circle("fx2", 0, 0, 0.7), P.circle("fxg", -0.3, -0.2, 0.75), P.circle("fxg", 0.4, 0.1, 0.65), P.circle("fxg", 0, 0.45, 0.55)]);
reg("planter", "A long planter.", [8, 2], o => { const L = o.w || 8, k = [R_("fx2", 0, 0, L, 2)]; for (let x = -L / 2 + 0.8; x < L / 2 - 0.4; x += 1.3) k.push(P.circle("fxg", x, (x * 7 % 3) / 6 - 0.2, 0.75)); return k; });
reg("lounger", "A pool or terrace lounger.", [2.5, 6], () => [R_("fxl", 0, 0, 2.4, 6, { rx: 0.4 }), R_("fx2", 0, -2, 2.4, 1.8, { rx: 0.4 })]);
reg("pool", "A swimming pool.", [16, 9], o => [R_("fxl", 0, 0, (o.w || 16) + 2, (o.h || 9) + 2, { rx: 0.6 }), R_("fxw", 0, 0, o.w || 16, o.h || 9, { rx: 0.4 }), R_("fxl", -(o.w || 16) / 4, -0.5, (o.w || 16) / 3, 0.25)]);
reg("hedge", "A clipped hedge block.", [6, 2], o => [R_("fxg", 0, 0, o.w || 6, o.h || 2, { rx: 0.6 })]);
reg("topiary", "A geometric topiary ball.", [2.4, 2.4], () => [P.circle("fxg", 0, 0, 1.2), P.circle("fxl", -0.4, -0.4, 0.25)]);
reg("sculpture", "Modern sculpture on a plinth.", [3, 3], () => [R_("fxl", 0, 0, 3, 3), P.circle("fx2", 0, 0, 1), R_("fx3", 0.4, -0.3, 0.6, 1.4, { tf: { rot: 30 } })]);
reg("fireplace", "A fireplace.", [6, 2], () => [R_("fx", 0, 0, 6, 2), R_("fx3", 0, 0.3, 3, 1.2), R_("fx2", 0, 0.6, 1.8, 0.4)]);
reg("chandelier", "A chandelier, seen from below.", [5, 5], () => { const k = [P.circle("fxl", 0, 0, 2.4, { opacity: 0.35 })]; for (let a = 0; a < 6; a++) k.push(P.circle("fx2", Math.cos(a * 1.047) * 1.6, Math.sin(a * 1.047) * 1.6, 0.3)); k.push(P.circle("fx2", 0, 0, 0.6)); return k; });
reg("column", "A structural column.", [2, 2], o => [o.round ? P.circle("fx3", 0, 0, 1) : R_("fx3", 0, 0, 2, 2)]);
reg("display-case", "A glass display case.", [5, 2.5], () => [R_("fx", 0, 0, 5, 2.5), R_("fxl", 0, 0, 4.4, 1.9, { opacity: 0.8 }), R_("fx2", -1, 0, 0.7, 0.7), P.circle("fx2", 1.1, 0, 0.4)]);
reg("frame", "A framed picture on a wall.", [3, 0.5], () => [R_("fx2", 0, 0, 3, 0.5)]);
reg("trunk", "A travel trunk.", [3.2, 2], () => [R_("fx", 0, 0, 3.2, 2, { rx: 0.2 }), R_("fx3", 0, 0, 3.2, 0.15), R_("fx2", 0, 0.5, 0.6, 0.4)]);
reg("crate", "A crate.", [3, 3], () => [R_("fx", 0, 0, 3, 3), R_("fx3", 0, 0, 3, 0.15, { tf: { rot: 45 } }), R_("fx3", 0, 0, 3, 0.15, { tf: { rot: -45 } })]);
reg("pallet", "A loaded pallet.", [4, 4], () => [R_("fx", 0, 0, 4, 4), R_("fxl", -0.9, -0.9, 1.7, 1.7), R_("fxl", 0.9, -0.9, 1.7, 1.7), R_("fx2", -0.9, 0.9, 1.7, 1.7), R_("fxl", 0.9, 0.9, 1.7, 1.7)]);
reg("barrel", "A barrel or drum.", [2.2, 2.2], o => [P.circle(o.alt ? "fx2" : "fx", 0, 0, 1.1), P.circle("fx3", 0, 0, 0.75), P.circle(o.alt ? "fx2" : "fx", 0, 0, 0.6)]);
reg("wine-rack", "A wine rack.", [8, 2], o => { const L = o.w || 8, k = [R_("fx", 0, 0, L, 2)]; for (let x = -L / 2 + 0.4; x < L / 2; x += 0.6) for (let y = -0.5; y <= 0.5; y += 0.5) k.push(P.circle("fx3", x, y, 0.2)); return k; });

// --- Entertainment -------------------------------------------------------------
reg("slots", "A bank of slot machines.", [10, 3], o => { const L = o.w || 10, k = [R_("fx3", 0, 0, L, 1.2)]; for (let x = -L / 2 + 0.9; x < L / 2; x += 1.8) { k.push(R_("fx2", x, -0.8, 1.5, 1.6, { rx: 0.2 })); k.push(R_("fx2", x, 0.8, 1.5, 1.6, { rx: 0.2 })); k.push(R_("fxglow", x, -1.2, 0.9, 0.4)); k.push(R_("fxglow", x, 1.2, 0.9, 0.4)); } return k; });
reg("roulette", "A roulette table.", [9, 5], () => [R_("fx", 0, 0, 9, 5, { rx: 2.4 }), R_("fx2", 1, 0, 5, 3.4, { rx: 0.4 }), P.circle("fx3", -2.7, 0, 1.6), P.circle("fxl", -2.7, 0, 0.9), P.circle("fx3", -2.7, 0, 0.3)]);
reg("card-table", "A card table, kidney-shaped.", [8, 5], () => { const k = [P.path("fx", "M-4 -1.5 L4 -1.5 L4 0.3 A4 3 0 0 1 -4 0.3 Z"), P.path("fx2", "M-3.4 -1 L3.4 -1 L3.4 0.2 A3.4 2.4 0 0 1 -3.4 0.2 Z")]; for (let i = -2; i <= 2; i++) k.push(P.circle("fx3", i * 1.5, 2.6 - Math.abs(i) * 0.35, 0.55)); k.push(R_("fx3", 0, -2.2, 1.2, 0.9, { rx: 0.3 })); return k; });
reg("dice-table", "A craps table.", [11, 5], () => [R_("fx", 0, 0, 11, 5, { rx: 1.2 }), R_("fx2", 0, 0, 9.6, 3.6, { rx: 0.8 }), R_("fxl", 0, 0, 3, 0.15), R_("fxl", -2.5, 0, 0.15, 3), R_("fxl", 2.5, 0, 0.15, 3)]);
reg("stage", "A raised stage with footlights.", [16, 8], o => { const W = o.w || 16, H = o.h || 8, k = [R_("fx3", 0, 0, W, H), R_("fx2", 0, -H / 2 + 0.6, W, 1.2)]; for (let x = -W / 2 + 1; x < W / 2; x += 1.6) k.push(P.circle("fxglow", x, H / 2 - 0.5, 0.25)); return k; });
reg("dance-floor", "A lit dance floor.", [12, 12], o => { const W = o.w || 12, H = o.h || 12, k = []; const s = W / Math.round(W / 2); let i = 0; for (let x = -W / 2; x < W / 2 - 0.1; x += s) { let j = 0; for (let y = -H / 2; y < H / 2 - 0.1; y += s) k.push(P.rect((i + j++) % 2 ? "fx2" : "fxglow", x + 0.08, y + 0.08, s - 0.16, s - 0.16)); i++; } return k; });
reg("screen", "A cinema screen.", [20, 1.5], o => [R_("fx3", 0, 0, (o.w || 20) + 1, 1.4), R_("fxglow", 0, 0.2, o.w || 20, 0.6)]);
reg("seat-row", "A row of cinema seats.", [16, 2.2], o => { const L = o.w || 16, k = []; for (let x = -L / 2 + 0.9; x < L / 2 - 0.5; x += 1.8) k.push(R_("fx2", x, 0, 1.5, 1.8, { rx: 0.35 })); return k; });
reg("seat-row-curved", "A curved row of seats.", [16, 3], o => { const L = o.w || 16, k = []; for (let x = -L / 2 + 0.9; x < L / 2 - 0.5; x += 1.8) k.push(P.g([R_("fx2", 0, 0, 1.5, 1.8, { rx: 0.35 })], { tf: { x, y: Math.pow(x / (L / 2), 2) * 1.1 - 0.4, rot: x / (L / 2) * 14 } })); return k; });
reg("dj-booth", "A DJ booth.", [6, 3], () => [R_("fx3", 0, 0, 6, 3, { rx: 1.2 }), P.circle("fxl", -1.4, 0, 0.8), P.circle("fxl", 1.4, 0, 0.8), R_("fxglow", 0, 0, 1, 0.4)]);
reg("record-player", "A hi-fi with a record player.", [4, 2], () => [R_("fx", 0, 0, 4, 2), P.circle("fx3", -0.8, 0, 0.75), R_("fx2", 1.2, 0, 1, 1.4)]);
reg("plasmovision", "A plasmovision set.", [4, 1.5], () => [R_("fx3", 0, 0, 4, 1.5, { rx: 0.6 }), R_("fxglow", 0, 0.2, 3, 0.4)]);
reg("billiards", "A billiard table.", [5, 9], () => [R_("fx", 0, 0, 5, 9, { rx: 0.4 }), R_("fx2", 0, 0, 4, 8)]);

// --- Money and security ----------------------------------------------------------
reg("vault-door", "A round vault door, swung open to one side.", [8, 3], () => [R_("fx3", 0, 0, 8, 2.6), P.circle("fxm", 0, 0.2, 3.1), P.circle("fx3", 0, 0.2, 2.2), P.circle("fxm", 0, 0.2, 1.3), R_("fxl", 0, 0.2, 2.2, 0.25), R_("fxl", 0, 0.2, 0.25, 2.2)]);
reg("deposit-wall", "A wall of safe-deposit boxes.", [10, 1.5], o => { const L = o.w || 10, k = [R_("fxm", 0, 0, L, 1.5)]; for (let x = -L / 2 + 0.5; x < L / 2; x += 0.9) k.push(R_("fx3", x + 0.4, 0, 0.06, 1.5)); return k; });
reg("safe", "A floor safe.", [2.6, 2.6], () => [R_("fx3", 0, 0, 2.6, 2.6), P.circle("fxm", 0, 0, 0.8), R_("fxl", 0.9, 0, 0.3, 0.9)]);
reg("cash-cart", "A caged cash cart.", [3, 4.5], () => [R_("fxm", 0, 0, 3, 4.5), R_("fx2", 0, -0.6, 2.2, 1.4), R_("fx2", 0, 1.1, 2.2, 1.4), R_("fx3", 0, 0, 3, 0.1)]);
reg("count-table", "A counting table stacked with notes.", [8, 4], () => { const k = [R_("fxl", 0, 0, 8, 4)]; for (let i = 0; i < 6; i++) k.push(R_("fx2", -3 + i * 1.2, -0.6 + (i % 2) * 1.1, 0.9, 0.5)); k.push(R_("fxm", 2.6, 0.8, 1.6, 1.2)); return k; });
reg("teller-counter", "A teller counter with grilles.", [16, 3], o => { const L = o.w || 16, k = [R_("fx", 0, 0, L, 2.4), R_("fx2", 0, -0.9, L, 0.6)]; for (let x = -L / 2 + 2; x < L / 2 - 1; x += 3.2) { k.push(R_("fx3", x, 1.6, 0.12, 1.4)); k.push(R_("fxl", x + 1.6, 0, 1.2, 0.8)); } return k; });
reg("queue-rope", "Queue posts and rope.", [10, 1], o => { const L = o.w || 10, k = [R_("fx2", 0, 0, L, 0.2)]; for (let x = -L / 2; x <= L / 2 + 0.01; x += L / 4) k.push(P.circle("fxm", x, 0, 0.35)); return k; });
reg("cell", "A holding cell with bars.", [7, 8], () => { const k = [R_("fxl", 0, 0.9, 2.4, 5.4, { rx: 0.2 })]; for (let x = -3.3; x <= 3.31; x += 0.6) k.push(R_("fx3", x, -3.8, 0.18, 0.5)); return k; });
reg("evidence-cage", "A wire evidence cage.", [8, 4], () => { const k = [R_("fx", 0, 0, 8, 4)]; for (let x = -3.6; x <= 3.6; x += 0.6) k.push(R_("fx3", x, 0, 0.06, 4)); k.push(R_("fxl", -1.5, 0, 1.6, 1.1)); k.push(R_("fx2", 1.6, 0.4, 1.2, 1)); return k; });

// --- Machines and plant ----------------------------------------------------------
reg("conveyor", "A conveyor belt.", [20, 3], o => { const L = o.w || 20, k = [R_("fxm", 0, 0, L, 3), R_("fx3", 0, 0, L, 2)]; for (let x = -L / 2 + 1; x < L / 2; x += 1) k.push(R_("fxm", x, 0, 0.12, 2)); for (let x = -L / 2 + 3; x < L / 2 - 1; x += 5) k.push(R_("fx2", x, 0, 1.6, 1.6)); return k; });
reg("machine", "Heavy machinery.", [6, 5], () => [R_("fxm", 0, 0, 6, 5, { rx: 0.4 }), R_("fx3", -1, -0.4, 2.6, 2.4), P.circle("fx2", 1.8, -0.8, 0.8), R_("fx2", 1.6, 1.4, 1.6, 0.6)]);
reg("boiler", "A heavy-duty boiler.", [7, 5], () => [R_("fxm", 0, 0, 7, 5, { rx: 2.4 }), R_("fx3", 0, 0, 5.4, 0.25), P.circle("fx2", 2.6, 0, 0.7), R_("fxm", -3.8, -1.5, 1, 0.6), R_("fxm", -3.8, 1.5, 1, 0.6)]);
reg("tank", "A cylindrical tank.", [5, 5], o => [P.circle("fxm", 0, 0, (o.w || 5) / 2), P.circle("fx3", 0, 0, (o.w || 5) / 2 - 0.6), P.circle("fxm", 0, 0, (o.w || 5) / 2 - 0.9), R_("fx2", 0, 0, (o.w || 5) * 0.5, 0.3)]);
reg("pipe-run", "A run of pipes.", [14, 1.5], o => { const L = o.w || 14; return [R_("fxm", 0, -0.45, L, 0.5), R_("fx2", 0, 0.35, L, 0.5), R_("fx3", -L / 4, 0, 0.5, 1.6), R_("fx3", L / 4, 0, 0.5, 1.6)]; });
reg("transformer", "An electroplasmic transformer.", [6, 6], () => [R_("fxm", 0, 0, 6, 6), R_("fx3", 0, 0, 4.4, 4.4), P.circle("fxglow", -1.2, -1.2, 0.7), P.circle("fxglow", 1.2, -1.2, 0.7), P.circle("fxglow", -1.2, 1.2, 0.7), P.circle("fxglow", 1.2, 1.2, 0.7)]);
reg("washer-row", "A row of washing machines.", [12, 2.6], o => { const L = o.w || 12, k = []; for (let x = -L / 2 + 1.3; x < L / 2 - 0.5; x += 2.6) { k.push(R_("fxl", x, 0, 2.4, 2.4)); k.push(P.circle("fx3", x, 0.2, 0.8)); k.push(P.circle("fxw", x, 0.2, 0.55)); } return k; });
reg("autopod", "An autopod, parked.", [6, 11], o => [R_("fx2", 0, 0, 6, 11, { rx: 2.6 }), R_("fx3", 0, -1.4, 4.6, 3, { rx: 1.2 }), R_("fxglow", 0, -1.4, 4, 2.2, { rx: 1 }), R_("fx3", -3, -3.2, 0.5, 1.8), R_("fx3", 3, -3.2, 0.5, 1.8), R_("fx3", -3, 3.2, 0.5, 1.8), R_("fx3", 3, 3.2, 0.5, 1.8)]);
reg("car-lift", "A car lift bay.", [10, 14], () => [R_("fxline", -4.5, 0, 0.3, 13), R_("fxline", 4.5, 0, 0.3, 13), R_("fxm", -2.8, 0, 1.1, 10), R_("fxm", 2.8, 0, 1.1, 10)]);
reg("boat", "A moored boat.", [7, 18], () => [P.path("fx2", "M0 -9 C3.5 -6 3.5 6 3 9 L-3 9 C-3.5 6 -3.5 -6 0 -9 Z"), P.path("fxl", "M0 -6.5 C2.2 -4 2.2 5 2 7.5 L-2 7.5 C-2.2 5 -2.2 -4 0 -6.5 Z"), R_("fx", 0, 2, 3, 3.6)]);
reg("water", "Open water.", [10, 10], o => [R_("fxw", 0, 0, o.w || 10, o.h || 10), R_("fxl", -(o.w || 10) / 5, -(o.h || 10) / 5, (o.w || 10) / 4, 0.2, { opacity: 0.6 }), R_("fxl", (o.w || 10) / 6, (o.h || 10) / 6, (o.w || 10) / 5, 0.2, { opacity: 0.6 })]);
reg("forklift", "A forklift.", [4, 7], () => [R_("fx2", 0, 0.8, 4, 5, { rx: 0.4 }), R_("fx3", 0, 0.4, 2.4, 2.2), R_("fxm", -1.2, -3, 0.4, 2.2), R_("fxm", 1.2, -3, 0.4, 2.2)]);

// --- Science -------------------------------------------------------------------------
reg("lab-bench", "A lab bench with glassware.", [10, 3.5], o => { const L = o.w || 10, k = [R_("fxl", 0, 0, L, 3.5)]; for (let x = -L / 2 + 1; x < L / 2 - 0.5; x += 1.6) k.push(P.circle(x % 3 > 1 ? "fx2" : "fxw", x, -0.6, 0.4)); k.push(R_("fxm", L / 4, 0.7, 2, 1.2)); return k; });
reg("apparatus", "An incomprehensible, jury-rigged device.", [6, 6], () => [P.circle("fxm", 0, 0, 2.8), P.circle("fx3", 0, 0, 2), P.circle("fxglow", 0, 0, 1.1), R_("fx2", 2.4, 0, 1.6, 0.5), R_("fx2", -2.4, 0, 1.6, 0.5), R_("fxm", 0, -2.8, 0.5, 1.2)]);
reg("cryo-tank", "A cryogenic tank.", [3, 3], () => [P.circle("fxl", 0, 0, 1.5), P.circle("fxw", 0, 0, 1.05), P.circle("fxl", -0.3, -0.3, 0.3)]);
reg("dummy", "A crash-test dummy.", [2, 4.5], () => [P.circle("fx2", 0, -1.6, 0.6), R_("fx2", 0, 0.2, 1.6, 2.4, { rx: 0.5 }), R_("fx3", 0, 0.2, 1.6, 0.15)]);
reg("trefoil", "The radiation trefoil, painted on the floor.", [6, 6], () => { const k = [P.circle("fx2", 0, 0, 3)]; for (let a = 0; a < 3; a++) { const t = a * 2.094 - 1.571; k.push(P.path("fx3", `M0 0 L${Math.cos(t - 0.52) * 2.6} ${Math.sin(t - 0.52) * 2.6} A2.6 2.6 0 0 1 ${Math.cos(t + 0.52) * 2.6} ${Math.sin(t + 0.52) * 2.6} Z`)); } k.push(P.circle("fx2", 0, 0, 0.7)); k.push(P.circle("fx3", 0, 0, 0.45)); return k; });
reg("hazard-strip", "Hazard striping on the floor.", [10, 1], o => { const L = o.w || 10, k = [R_("fx2", 0, 0, L, 1)]; for (let x = -L / 2 + 0.5; x < L / 2; x += 1) k.push(P.poly("fx3", [[x - 0.25, -0.5], [x + 0.15, -0.5], [x - 0.15, 0.5], [x - 0.55, 0.5]])); return k; });

// --- Circulation ---------------------------------------------------------------------
reg("stairs", "A straight stair, drawn as treads.", [4, 10], o => { const W = o.w || 4, H = o.h || 10, k = [R_("fxl", 0, 0, W, H)]; for (let y = -H / 2 + 0.6; y < H / 2; y += 0.9) k.push(R_("fx3", 0, y, W, 0.12)); k.push(P.poly("fx2", [[0, -H / 2 + 0.8], [0.7, -H / 2 + 2], [-0.7, -H / 2 + 2]])); return k; });
reg("stairs-spiral", "Circular stairs.", [5, 5], () => { const k = [P.circle("fxl", 0, 0, 2.5)]; for (let a = 0; a < 12; a++) { const t = a * 0.5236; k.push(P.line("fx3", Math.cos(t) * 0.5, Math.sin(t) * 0.5, Math.cos(t) * 2.5, Math.sin(t) * 2.5, { sw: 0.12 })); } k.push(P.circle("fx3", 0, 0, 0.5)); return k; });
reg("lift", "A lift car in its shaft.", [5, 5], () => [R_("fx3", 0, 0, 5, 5), R_("fxm", 0, 0.3, 4, 4), R_("fx3", 0, 0.3, 0.1, 4), R_("fx2", 0, 2.4, 3, 0.25)]);
reg("ladder", "A ladder up through a hatch.", [2, 4], () => [R_("fx3", 0, 0, 2.6, 4), R_("fxl", -0.7, 0, 0.18, 4), R_("fxl", 0.7, 0, 0.18, 4), R_("fxl", 0, -1.2, 1.4, 0.15), R_("fxl", 0, 0, 1.4, 0.15), R_("fxl", 0, 1.2, 1.4, 0.15)]);
reg("skylight", "A skylight, light falling on the floor.", [6, 6], () => [R_("fxglow", 0, 0, 6, 6, { opacity: 0.55 }), R_("fxl", 0, 0, 6, 0.2), R_("fxl", 0, 0, 0.2, 6)]);
reg("hatch", "A floor hatch.", [3, 3], () => [R_("fx3", 0, 0, 3, 3), R_("fxm", 0, 0, 2.4, 2.4), R_("fx3", 0.8, 0, 0.3, 0.9)]);
reg("catwalk", "A catwalk overhead, shown dashed.", [14, 2], o => { const L = o.w || 14, k = []; for (let x = -L / 2; x < L / 2; x += 1.2) k.push(R_("fxm", x + 0.4, 0, 0.8, 1.8, { opacity: 0.7 })); return k; });

// --- What gets you in from outside ------------------------------------------------
// Drawn from the door: the origin is the door on the wall line, the wall runs
// along x and outside is +y. o.mirror (±1) sends the flight left or right.
reg("fire-escape", "An iron fire escape: a landing at an upper door and a flight down the outside wall.", [12, 3.6], o => {
  const m = o.mirror || 1, k = [R_("fxm", 0, 1.8, 4.4, 3)];
  const x0 = 2.2 * m, x1 = 9.6 * m, cx = (x0 + x1) / 2, L = Math.abs(x1 - x0);
  k.push(R_("fxm", cx, 1.8, L, 2.4));
  for (let t = 0.5; t < L; t += 0.75) k.push(R_("fx3", x0 + t * m, 1.8, 0.16, 2.4));
  k.push(R_("fx3", m * 3.7, 3.35, 11.2, 0.3), R_("fx3", -2.1 * m, 1.8, 0.3, 3.1));
  for (let t = -1.6; t <= 1.6; t += 0.8) k.push(R_("fx3", t, 1.8, 0.1, 2.8, { opacity: 0.6 }));
  return k;
});
reg("area-steps", "A railed area outside a basement door, with steps up to the pavement.", [11, 4], o => {
  const m = o.mirror || 1, k = [R_("fx3", 0, 1.95, 4.8, 3.3)];
  const x0 = 2.4 * m, x1 = 8.6 * m, cx = (x0 + x1) / 2, L = Math.abs(x1 - x0);
  k.push(R_("fxl", cx, 1.95, L, 2.7));
  for (let t = 0.45; t < L; t += 0.7) k.push(R_("fx3", x0 + t * m, 1.95, 0.16, 2.7));
  k.push(R_("fx3", m * 3.1, 3.85, 11.4, 0.3), R_("fx3", -2.5 * m, 1.95, 0.3, 3.9));
  return k;
});
reg("balcony", "A balcony with a railing, outside an upper door.", [7, 3], () => [R_("fxm", 0, 1.55, 6.6, 2.7), R_("fx3", 0, 2.85, 6.6, 0.22), R_("fx3", -3.2, 1.55, 0.22, 2.7), R_("fx3", 3.2, 1.55, 0.22, 2.7)]);
reg("roof-hatch", "A roof hatch with its ladder.", [3.2, 5], () => [R_("fx3", 0, -1, 3, 3), R_("fxm", 0, -1, 2.4, 2.4), R_("fx3", 0, 1.6, 2.2, 2.2, { opacity: 0.35 }), R_("fxl", -0.7, 1.4, 0.18, 2.6), R_("fxl", 0.7, 1.4, 0.18, 2.6), R_("fxl", 0, 0.7, 1.4, 0.15), R_("fxl", 0, 1.6, 1.4, 0.15), R_("fxl", 0, 2.5, 1.4, 0.15)]);

// --- Anomalous -------------------------------------------------------------------
reg("orb", "A memory sphere.", [2, 2], o => [P.circle("fxglow", 0, 0, (o.w || 2) / 2, { opacity: 0.85 }), P.circle("fxl", -(o.w || 2) / 6, -(o.w || 2) / 6, (o.w || 2) / 7)]);
reg("mirror", "A tall mirror panel.", [4, 0.6], () => [R_("fxl", 0, 0, 4, 0.5), R_("fxglow", 0, 0, 3.6, 0.2)]);
reg("flame", "A cold fire.", [3, 3], () => [P.circle("fx2", 0, 0, 1.5, { opacity: 0.6 }), P.circle("fxglow", 0, 0.1, 1), P.circle("fxl", 0, 0.2, 0.4)]);
reg("tree", "A tree, seen from above.", [7, 7], o => { const r = (o.w || 7) / 2; return [P.circle("fxg", 0, 0, r), P.circle("fxg", -r * 0.35, -r * 0.3, r * 0.6, { opacity: 0.8 }), P.circle("fxl", -r * 0.35, -r * 0.35, r * 0.18, { opacity: 0.5 })]; });
reg("snow", "Drifted snow.", [8, 5], o => [P.ellipse("fxl", 0, 0, (o.w || 8) / 2, (o.h || 5) / 2), P.ellipse("fxl", (o.w || 8) / 5, -(o.h || 5) / 5, (o.w || 8) / 4, (o.h || 5) / 4, { opacity: 0.8 })]);
reg("void", "A void — a hole in the plan.", [10, 10], o => [P.ellipse("fx3", 0, 0, (o.w || 10) / 2, (o.h || 10) / 2), P.ellipse("fxglow", 0, 0, (o.w || 10) / 2.6, (o.h || 10) / 2.6, { opacity: 0.25 })]);
reg("doorframe", "A free-standing doorway.", [4, 1], () => [R_("fx3", -1.8, 0, 0.5, 1), R_("fx3", 1.8, 0, 0.5, 1), R_("fxg", 0, 0, 3.1, 0.7)]);

// --- Room furnishing recipes ----------------------------------------------------
// recipe(R, rng, ctx) → placements. R is the room's furnishable rect (already
// inset from its walls). Helpers below keep each recipe to a line or three.
const F = M.F = {
  put: (part, x, y, o) => Object.assign({ part, x, y }, o),
  // Centre-relative placement: fx, fy in 0..1 across R.
  at: (R, part, fx, fy, o) => F.put(part, R.x + R.w * fx, R.y + R.h * fy, o),
  // Fill R with a grid of `part`, at cell size cw × ch, centred.
  grid(R, part, cw, ch, o = {}) {
    const nx = Math.max(1, Math.floor(R.w / cw)), ny = Math.max(1, Math.floor(R.h / ch)), out = [];
    const ox = R.x + (R.w - nx * cw) / 2 + cw / 2, oy = R.y + (R.h - ny * ch) / 2 + ch / 2;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      if (o.skip && o.skip(i, j, nx, ny)) continue;
      const { skip, opt, ...rest } = o;          // the helpers' own options never reach the part
      out.push(F.put(part, ox + i * cw, oy + j * ch, Object.assign({}, rest, opt ? opt(i, j) : {})));
    }
    return out;
  },
  // A run of parts along one wall of R. side: top|bottom|left|right.
  wall(R, side, part, depth, o = {}) {
    const len = side === "top" || side === "bottom" ? R.w : R.h;
    const L = Math.max(2, len * (o.frac || 0.8));
    const off = o.off || 0;
    const pos = { top: [G.cx(R) + off, R.y + depth / 2, 0], bottom: [G.cx(R) + off, R.y + R.h - depth / 2, 180],
      left: [R.x + depth / 2, G.cy(R) + off, 270], right: [R.x + R.w - depth / 2, G.cy(R) + off, 90] }[side];
    return F.put(part, pos[0], pos[1], Object.assign({ rot: pos[2], w: L }, o));
  },
  // Several separate items spaced along a wall.
  along(R, side, part, step, depth, o = {}) {
    const horiz = side === "top" || side === "bottom", len = horiz ? R.w : R.h, out = [];
    const n = Math.max(1, Math.floor((len - (o.margin || 1)) / step)), start = (len - n * step) / 2 + step / 2;
    for (let i = 0; i < n; i++) {
      const t = start + i * step;
      const pos = { top: [R.x + t, R.y + depth / 2, 0], bottom: [R.x + t, R.y + R.h - depth / 2, 180],
        left: [R.x + depth / 2, R.y + t, 270], right: [R.x + R.w - depth / 2, R.y + t, 90] }[side];
      out.push(F.put(part, pos[0], pos[1], Object.assign({ rot: pos[2] }, o)));
    }
    return out;
  },
  long: R => (R.w >= R.h ? "x" : "y"),
  // Rows of a long part across the room's long axis.
  rows(R, part, gap, o = {}) {
    const horiz = R.w >= R.h, out = [], span = horiz ? R.h : R.w, L = (horiz ? R.w : R.h) * (o.frac || 0.85);
    const n = Math.max(1, Math.floor(span / gap)), s0 = (span - (n - 1) * gap) / 2;
    for (let i = 0; i < n; i++) {
      const t = s0 + i * gap;
      out.push(F.put(part, horiz ? G.cx(R) : R.x + t, horiz ? R.y + t : G.cy(R), Object.assign({ rot: horiz ? 0 : 90, w: L }, o)));
    }
    return out;
  }
};

// Each recipe is tolerant of tiny rooms: the furnisher drops anything that
// does not fit inside R, so recipes can be generous.
const ARCH = M.ARCH = {
  "empty": () => [],
  "lobby": R => [F.wall(R, "top", "counter", 2.5, { frac: 0.45 }), F.at(R, "plant", 0.1, 0.85), F.at(R, "plant", 0.9, 0.85), F.at(R, "sofa", 0.3, 0.62, { rot: 0 }), F.at(R, "coffee-table", 0.3, 0.8)],
  "lobby-mail": R => [F.wall(R, "left", "lockers", 1.8, { frac: 0.7 }), F.at(R, "plant", 0.85, 0.15), F.at(R, "rug", 0.55, 0.55, { w: R.w * 0.4, h: R.h * 0.35 })],
  "foyer": R => [F.at(R, "rug", 0.5, 0.6, { w: R.w * 0.45, h: R.h * 0.55 }), F.wall(R, "top", "stairs", 7, { rot: 0, w: Math.min(10, R.w * 0.4), h: 7 }), F.at(R, "chandelier", 0.5, 0.55), F.at(R, "plant", 0.1, 0.9), F.at(R, "plant", 0.9, 0.9)],
  "foyer-small": R => [F.at(R, "rug", 0.5, 0.55, { w: R.w * 0.5, h: R.h * 0.5 }), F.at(R, "plant", 0.15, 0.2)],
  "conference": R => [F.at(R, "table-long", 0.5, 0.5, { rot: R.w >= R.h ? 0 : 90, w: Math.max(R.w, R.h) * 0.7 }), F.at(R, "plant", 0.08, 0.12)],
  "breakroom": R => [F.wall(R, "top", "kitchen-run", 2.4, { frac: 0.6 }), ...F.grid({ x: R.x, y: R.y + 3.5, w: R.w, h: R.h - 3.5 }, "table-round", 6, 6), F.at(R, "plant", 0.92, 0.9)],
  "files": R => [...F.rows(R, "filing", 4.5)],
  "corner-office": R => [F.at(R, "desk-big", 0.55, 0.3), F.at(R, "sofa", 0.3, 0.82, { rot: 180 }), F.at(R, "coffee-table", 0.3, 0.62), F.at(R, "plant", 0.92, 0.12), F.at(R, "rug", 0.55, 0.45, { w: R.w * 0.5, h: R.h * 0.4 })],
  "open-office": R => F.grid(R, "typing-desk", 5.5, 5.5),
  "offices": R => [...F.grid(R, "desk", 7, 6.5), F.wall(R, "right", "filing", 2.2, { frac: 0.4 })],
  "closet": R => [F.wall(R, "top", "shelf", 2, { frac: 0.9 }), F.at(R, "barrel", 0.5, 0.75, { alt: true })],
  "lift-hall": R => [...F.along(R, R.w >= R.h ? "top" : "left", "lift", 6, 5), F.at(R, "plant", 0.9, 0.85)],
  "restroom": R => [...F.along(R, "top", "toilet-stall", 3.2, 5), ...F.along(R, "bottom", "sink", 3, 2)],
  "roof": R => [F.at(R, "machine", 0.25, 0.3), F.at(R, "tank", 0.75, 0.3), F.at(R, "pipe-run", 0.5, 0.75, { w: R.w * 0.6 }), F.at(R, "hatch", 0.85, 0.85)],
  "plant-room": R => [F.at(R, "boiler", 0.3, 0.35), F.at(R, "tank", 0.75, 0.3), F.wall(R, "bottom", "pipe-run", 1.5, { frac: 0.85 }), F.at(R, "crate", 0.8, 0.7)],
  "assembly": R => [...F.rows(R, "conveyor", 9), F.at(R, "machine", 0.12, 0.2), F.at(R, "machine", 0.88, 0.8)],
  "packing": R => [...F.grid(R, "pallet", 6, 6, { skip: (i, j) => (i + j) % 3 === 2 }), F.at(R, "forklift", 0.85, 0.5, { rot: 90 })],
  "warehouse": R => [...F.rows(R, "shelf", 6.5, { alt: true }), F.at(R, "forklift", 0.9, 0.9, { rot: 180 })],
  "control": R => [F.wall(R, "top", "console", 3.5, { frac: 0.85 }), F.at(R, "chair", 0.35, 0.55), F.at(R, "chair", 0.65, 0.55), F.wall(R, "bottom", "filing", 2.2, { frac: 0.4 })],
  "workshop": R => [F.wall(R, "top", "workbench", 3, { frac: 0.7 }), F.wall(R, "left", "shelf", 2, { frac: 0.7 }), F.at(R, "barrel", 0.8, 0.75), F.at(R, "crate", 0.6, 0.75)],
  "boiler": R => [F.at(R, "boiler", 0.45, 0.4), F.wall(R, "bottom", "pipe-run", 1.5, { frac: 0.9 }), F.at(R, "tank", 0.85, 0.35, { w: 4 })],
  "dock": R => [...F.along(R, "bottom", "hazard-strip", 7, 1, { w: 6 }), ...F.grid({ x: R.x, y: R.y, w: R.w, h: R.h - 4 }, "pallet", 6.5, 6.5, { skip: (i, j) => (i * 3 + j) % 4 === 1 })],
  "waste": R => [...F.grid(R, "barrel", 3.5, 3.5, { skip: (i, j) => (i + j) % 2 === 1, opt: (i) => ({ alt: i % 3 === 0 }) }), F.at(R, "machine", 0.8, 0.3)],
  "tanks": R => [...F.grid(R, "tank", 7, 7), F.wall(R, "bottom", "pipe-run", 1.5, { frac: 0.8 })],
  "machines": R => [...F.grid(R, "machine", 8, 7), F.wall(R, "top", "pipe-run", 1.5, { frac: 0.8 })],
  "lab": R => [...F.rows(R, "lab-bench", 7.5, { frac: 0.7 }), F.at(R, "apparatus", 0.85, 0.5)],
  "testing": R => [F.at(R, "dummy", 0.3, 0.4), F.at(R, "dummy", 0.45, 0.45), F.at(R, "hazard-strip", 0.5, 0.75, { w: R.w * 0.7 }), F.wall(R, "top", "console", 3.5, { frac: 0.5 })],
  "vault-store": R => [F.wall(R, "bottom", "vault-door", 2.6, { rot: 180, w: 8 }), ...F.rows({ x: R.x, y: R.y, w: R.w, h: R.h - 4 }, "lockers", 4.5, { frac: 0.8 })],
  "clean": R => [F.wall(R, "bottom", "hazard-strip", 1, { frac: 0.5 }), ...F.rows({ x: R.x, y: R.y, w: R.w, h: R.h - 2 }, "lab-bench", 7, { frac: 0.6 })],
  "computer": R => F.grid(R, "computer", 6, 5),
  "chem-store": R => [...F.rows(R, "shelf", 4.5, { alt: true, frac: 0.7 }), F.at(R, "barrel", 0.9, 0.85, { alt: true })],
  "radiation": R => [F.at(R, "trefoil", 0.5, 0.5), F.wall(R, "top", "console", 3.5, { frac: 0.5 }), F.wall(R, "bottom", "hazard-strip", 1, { frac: 0.9 })],
  "observation": R => [F.wall(R, "top", "console", 3.5, { frac: 0.6 }), ...F.along(R, "bottom", "chair", 3, 1.6)],
  "cryo": R => [...F.grid(R, "cryo-tank", 4.5, 4.5), F.wall(R, "top", "console", 3.5, { frac: 0.4 })],
  "biolab": R => [...F.rows(R, "lab-bench", 7, { frac: 0.65 }), F.at(R, "cryo-tank", 0.9, 0.15)],
  "library": R => [...F.rows(R, "bookcase", 4.5, { frac: 0.75 }), F.at(R, "table", 0.12, 0.5)],
  "sunken-lounge": R => [F.at(R, "rug", 0.5, 0.5, { w: R.w * 0.6, h: R.h * 0.6 }), F.at(R, "sofa-curve", 0.5, 0.48), F.at(R, "coffee-table", 0.5, 0.55), F.at(R, "bubble-chair", 0.15, 0.2), F.at(R, "bubble-chair", 0.85, 0.2), F.at(R, "plasmovision", 0.5, 0.08)],
  "bar": R => [F.wall(R, "top", "bar", 6, { frac: 0.7 }), ...F.grid({ x: R.x, y: R.y + 7, w: R.w, h: R.h - 7 }, "table-round", 6, 6)],
  "terrace": R => [...F.along(R, "top", "lounger", 3.5, 6), F.wall(R, "bottom", "planter", 2, { frac: 0.8 }), F.at(R, "table-round", 0.5, 0.6), F.at(R, "plant", 0.08, 0.5)],
  "garden": R => [F.at(R, "pool", 0.4, 0.5, { w: R.w * 0.42, h: R.h * 0.42 }), F.wall(R, "top", "hedge", 2, { frac: 0.9, h: 2 }), ...F.grid({ x: R.x + R.w * 0.68, y: R.y + 3, w: R.w * 0.32, h: R.h - 6 }, "topiary", 4.5, 4.5), F.at(R, "sculpture", 0.12, 0.85), F.at(R, "lounger", 0.15, 0.5)],
  "bedroom": R => [F.wall(R, "top", "bed", 3.5, { w: 5 }), F.at(R, "wardrobe", 0.9, 0.5, { rot: 90 }), F.at(R, "rug", 0.5, 0.65, { w: R.w * 0.5, h: R.h * 0.3 }), F.at(R, "armchair", 0.15, 0.8)],
  "kitchen": R => [F.wall(R, "top", "kitchen-run", 2.4, { frac: 0.85 }), F.wall(R, "left", "kitchen-run", 2.4, { frac: 0.6 }), F.at(R, "table-long", 0.58, 0.62, { w: Math.max(6, R.w * 0.45) })],
  "den": R => [F.at(R, "armchair", 0.3, 0.4), F.at(R, "armchair", 0.7, 0.4), F.at(R, "coffee-table", 0.5, 0.6), F.wall(R, "top", "bookcase", 1.5, { frac: 0.7 }), F.at(R, "record-player", 0.5, 0.92, { rot: 180 })],
  "meditation": R => [F.at(R, "rug", 0.5, 0.5, { w: R.w * 0.55, h: R.h * 0.55 }), ...F.along(R, "top", "plant", 4, 1.2), F.at(R, "flame", 0.5, 0.5)],
  "dance": R => [F.at(R, "dance-floor", 0.5, 0.55, { w: Math.min(R.w, R.h) * 0.62, h: Math.min(R.w, R.h) * 0.62 }), F.wall(R, "top", "dj-booth", 3), ...F.along(R, "bottom", "booth", 7.5, 3)],
  "dressing": R => [F.wall(R, "left", "shelf", 2, { frac: 0.8, alt: true }), F.wall(R, "right", "mirror", 0.6, { frac: 0.6 }), F.at(R, "chair", 0.6, 0.5)],
  "garage": R => [...F.along(R, "top", "autopod", 7.5, 11.5), F.at(R, "barrel", 0.9, 0.9)],
  "panic": R => [F.wall(R, "top", "monitor-wall", 2, { frac: 0.8 }), F.at(R, "safe", 0.25, 0.7), F.at(R, "bunk", 0.75, 0.65, { rot: 0 })],
  "ballroom": R => [F.at(R, "dance-floor", 0.5, 0.5, { w: R.w * 0.6, h: R.h * 0.5 }), F.at(R, "chandelier", 0.33, 0.5), F.at(R, "chandelier", 0.67, 0.5), F.at(R, "piano", 0.1, 0.18), ...F.along(R, "bottom", "armchair", 6, 2.6)],
  "servants": R => [...F.along(R, "top", "bunk", 4.5, 6.5), F.wall(R, "bottom", "wardrobe", 2, { w: 4 })],
  "wine-cellar": R => [...F.rows({ x: R.x, y: R.y, w: R.w * 0.72, h: R.h }, "wine-rack", 4.5), F.at(R, "barrel", 0.82, 0.3), F.at(R, "barrel", 0.92, 0.3), F.at(R, "vault-door", 0.86, 0.85, { rot: 180, w: 6 })],
  "gallery": R => [...F.along(R, "top", "frame", 4.5, 0.5), ...F.along(R, "bottom", "frame", 4.5, 0.5), ...F.along(R, "left", "frame", 4.5, 0.5), ...F.along(R, "right", "frame", 4.5, 0.5), F.at(R, "sofa", 0.5, 0.5, { w: 5 })],
  "study": R => [F.at(R, "desk-big", 0.5, 0.35), F.wall(R, "left", "bookcase", 1.5, { frac: 0.85 }), F.at(R, "fireplace", 0.6, 0.94, { rot: 180 }), F.at(R, "armchair", 0.75, 0.72)],
  "lounge": R => [F.at(R, "rug", 0.5, 0.5, { w: R.w * 0.6, h: R.h * 0.55 }), F.at(R, "sofa", 0.5, 0.3), F.at(R, "coffee-table", 0.5, 0.5), F.at(R, "armchair", 0.25, 0.65), F.at(R, "armchair", 0.75, 0.65), F.wall(R, "bottom", "fireplace", 2, { rot: 180 })],
  "attic": R => [F.at(R, "trunk", 0.2, 0.3), F.at(R, "trunk", 0.3, 0.7, { rot: 20 }), F.at(R, "crate", 0.7, 0.3), F.at(R, "crate", 0.8, 0.65), F.at(R, "display-case", 0.5, 0.5, { rot: 10 })],
  "dining": R => [F.at(R, "table-long", 0.5, 0.5, { rot: R.w >= R.h ? 0 : 90, w: Math.max(R.w, R.h) * 0.75 }), F.at(R, "chandelier", 0.5, 0.5), F.wall(R, "top", "wardrobe", 2, { w: 5 })],
  "trophy": R => [...F.along(R, "left", "display-case", 7, 2.5), F.wall(R, "top", "frame", 0.5, { w: 3 }), F.at(R, "rug", 0.6, 0.5, { w: R.w * 0.45, h: R.h * 0.4 })],
  "music": R => [F.at(R, "piano", 0.4, 0.4), F.at(R, "record-player", 0.85, 0.12), F.at(R, "armchair", 0.75, 0.7), F.at(R, "rug", 0.45, 0.45, { w: R.w * 0.55, h: R.h * 0.55 })],
  "casino-floor": R => [...F.rows({ x: R.x, y: R.y, w: R.w, h: R.h * 0.36 }, "slots", 5.5, { frac: 0.85 }), ...F.grid({ x: R.x, y: R.y + R.h * 0.4, w: R.w, h: R.h * 0.6 }, "roulette", 11, 8, { opt: (i, j) => ({ part: (i + j) % 3 === 1 ? "card-table" : (i + j) % 3 === 2 ? "dice-table" : "roulette" }) })],
  "showroom": R => [F.wall(R, "top", "stage", 8, { frac: 0.7, w: R.w * 0.6, h: 8 }), ...F.grid({ x: R.x, y: R.y + 10, w: R.w, h: R.h - 10 }, "table-round", 6.5, 6.5)],
  "cocktail": R => [F.wall(R, "top", "bar", 6, { frac: 0.6 }), ...F.along(R, "bottom", "booth", 7, 3), F.at(R, "table-round", 0.5, 0.55)],
  "vip": R => [F.at(R, "card-table", 0.35, 0.4), F.at(R, "sofa", 0.75, 0.8, { rot: 180 }), F.at(R, "coffee-table", 0.75, 0.62), F.at(R, "rug", 0.5, 0.5, { w: R.w * 0.6, h: R.h * 0.6 })],
  "card-rooms": R => F.grid(R, "card-table", 10, 8),
  "security": R => [F.wall(R, "top", "monitor-wall", 2, { frac: 0.9 }), F.at(R, "console", 0.5, 0.45, { w: Math.max(6, R.w * 0.6) }), F.at(R, "chair", 0.35, 0.68), F.at(R, "chair", 0.65, 0.68), F.wall(R, "bottom", "lockers", 1.8, { frac: 0.5 })],
  "counting": R => [...F.grid({ x: R.x, y: R.y, w: R.w, h: R.h - 5 }, "count-table", 10, 6.5), ...F.along(R, "bottom", "cash-cart", 4, 4.5, { rot: 90 })],
  "vault": R => [F.wall(R, "bottom", "vault-door", 2.6, { rot: 180, w: 8 }), F.wall(R, "top", "deposit-wall", 1.5, { frac: 0.9 }), F.wall(R, "left", "deposit-wall", 1.5, { frac: 0.6 }), F.at(R, "cash-cart", 0.65, 0.5)],
  "hotel": R => [F.at(R, "foyer", 0, 0, { skip: true }), ...F.along(R, "top", "bed", 9, 7, { w: 5 }), ...F.along(R, "bottom", "bed", 9, 7, { w: 5 })],
  "penthouse": R => [F.at(R, "bed-round", 0.75, 0.35), F.at(R, "sofa-curve", 0.3, 0.55), F.at(R, "bar", 0.3, 0.12, { w: 8 }), F.at(R, "pool", 0.7, 0.8, { w: R.w * 0.3, h: R.h * 0.18 }), F.at(R, "plant", 0.05, 0.9)],
  "restaurant": R => [...F.grid({ x: R.x, y: R.y + 4, w: R.w, h: R.h - 4 }, "table-round", 6.5, 6.5), F.wall(R, "top", "counter", 2.5, { frac: 0.4 })],
  "hallway": R => [F.at(R, "rug", 0.5, 0.5, { w: R.w * (R.w >= R.h ? 0.85 : 0.4), h: R.h * (R.w >= R.h ? 0.4 : 0.85) }), F.at(R, "plant", 0.05, 0.05)],
  "flat-rundown": R => [F.at(R, "bed", 0.2, 0.3), F.at(R, "sofa", 0.65, 0.3, { rot: 0 }), F.wall(R, "bottom", "kitchen-run", 2.4, { frac: 0.5, off: R.w * 0.2 }), F.at(R, "barrel", 0.9, 0.6), F.at(R, "crate", 0.45, 0.65, { rot: 15 })],
  "flat-tidy": R => [F.at(R, "sofa", 0.4, 0.25, { rot: 0 }), F.at(R, "coffee-table", 0.4, 0.45), F.at(R, "table-round", 0.78, 0.7), F.wall(R, "left", "kitchen-run", 2.4, { frac: 0.5, off: R.h * 0.2 }), F.at(R, "plant", 0.92, 0.12)],
  "flat-strange": R => [F.at(R, "rug", 0.5, 0.5, { w: R.w * 0.6, h: R.h * 0.6 }), F.at(R, "bed", 0.5, 0.45, { opacity: 0.45 }), ...F.along(R, "top", "display-case", 6, 2.5), F.at(R, "flame", 0.15, 0.85)],
  "laundry-basement": R => [F.wall(R, "top", "washer-row", 2.6, { frac: 0.7 }), F.at(R, "boiler", 0.3, 0.65), F.at(R, "tank", 0.78, 0.7, { w: 4 })],
  "stairwell": R => [F.at(R, "stairs", 0.3, 0.5, { w: Math.min(4, R.w * 0.4), h: R.h * 0.8 }), F.at(R, "stairs", 0.7, 0.5, { w: Math.min(4, R.w * 0.4), h: R.h * 0.8, rot: 180 })],
  "fire-escape": R => [F.at(R, "ladder", 0.5, 0.5), F.at(R, "stairs", 0.25, 0.5, { w: 3, h: R.h * 0.7 })],
  // --- Anomalous (p.428–429). Furniture is placed, then deliberately broken.
  "anom-gravity": R => [F.at(R, "sofa", 0.3, 0.3, { rot: 37, opacity: 0.85 }), F.at(R, "table", 0.7, 0.4, { rot: -22 }), F.at(R, "armchair", 0.45, 0.7, { rot: 160 }), F.at(R, "plant", 0.8, 0.8, { rot: 90 }), F.at(R, "void", 0.5, 0.5, { w: 4, h: 4, opacity: 0.6 })],
  "anom-shift": R => [...F.grid(R, "doorframe", 6, 6, { opt: (i, j) => ({ rot: (i * 47 + j * 31) % 180 }) })],
  "anom-void": R => [F.at(R, "void", 0.5, 0.5, { w: R.w * 0.8, h: R.h * 0.8 })],
  "anom-temporal": R => [F.at(R, "desk", 0.4, 0.4), F.at(R, "desk", 0.45, 0.45, { opacity: 0.4, rot: 8 }), F.at(R, "sofa", 0.7, 0.75, { opacity: 0.5 }), F.at(R, "sofa", 0.72, 0.7, { rot: -6 }), F.at(R, "plant", 0.15, 0.8, { opacity: 0.4 })],
  "anom-mirrors": R => [...F.along(R, "top", "mirror", 5, 0.6), ...F.along(R, "bottom", "mirror", 5, 0.6), ...F.along(R, "left", "mirror", 5, 0.6), ...F.along(R, "right", "mirror", 5, 0.6), F.at(R, "mirror", 0.4, 0.5, { rot: 60 }), F.at(R, "mirror", 0.6, 0.5, { rot: -60 })],
  "anom-orbs": R => [...F.grid(R, "orb", 4.5, 4.5, { opt: (i, j) => ({ w: 1.2 + ((i * 7 + j * 3) % 4) * 0.5 }), skip: (i, j) => (i * 5 + j * 3) % 4 === 0 })],
  "anom-overgrown": R => [F.at(R, "tree", 0.3, 0.35, { w: Math.min(R.w, R.h) * 0.45 }), F.at(R, "tree", 0.72, 0.62, { w: Math.min(R.w, R.h) * 0.38 }), F.at(R, "desk", 0.6, 0.25, { opacity: 0.6 }), ...F.along(R, "bottom", "plant", 3, 1.2)],
  "anom-stairs": R => [F.at(R, "stairs", 0.3, 0.5, { h: R.h * 0.7 }), F.at(R, "stairs", 0.5, 0.5, { h: R.h * 0.7, rot: 180 }), F.at(R, "stairs", 0.7, 0.5, { h: R.h * 0.7 }), F.at(R, "stairs-spiral", 0.5, 0.5)],
  "anom-fire": R => [F.at(R, "flame", 0.5, 0.5, { w: 4 }), F.at(R, "rug", 0.5, 0.5, { w: R.w * 0.5, h: R.h * 0.5 }), F.at(R, "armchair", 0.2, 0.25)],
  "anom-snow": R => [F.at(R, "snow", 0.3, 0.35, { w: R.w * 0.45, h: R.h * 0.35 }), F.at(R, "snow", 0.7, 0.7, { w: R.w * 0.4, h: R.h * 0.3 }), F.at(R, "desk", 0.65, 0.3, { opacity: 0.7 })],
  "anom-forest": R => [F.at(R, "doorframe", 0.5, 0.88), F.at(R, "tree", 0.3, 0.35, { w: 7 }), F.at(R, "tree", 0.65, 0.3, { w: 6 }), F.at(R, "tree", 0.5, 0.6, { w: 5 })],
  // --- Dressing by target type (catalogue M.DRESS) ---
  "auditorium": R => [F.wall(R, "top", "screen", 1.5, { frac: 0.8 }), ...F.rows({ x: R.x, y: R.y + 4.5, w: R.w, h: R.h - 6 }, "seat-row-curved", 3.2, { frac: 0.82 })],
  "concession": R => [F.wall(R, "top", "counter", 2.5, { frac: 0.7 }), F.at(R, "plant", 0.08, 0.85), ...F.along(R, "bottom", "booth", 7.5, 3)],
  "box-office": R => [F.wall(R, "top", "counter", 2.5, { frac: 0.35 }), F.at(R, "queue-rope", 0.5, 0.5, { w: R.w * 0.5 }), F.at(R, "queue-rope", 0.5, 0.65, { w: R.w * 0.5 }), F.at(R, "rug", 0.5, 0.8, { w: R.w * 0.6, h: R.h * 0.2 })],
  "boxes": R => [...F.along(R, "top", "armchair", 3.5, 2.6), ...F.along(R, "bottom", "armchair", 3.5, 2.6)],
  "projection": R => [...F.along(R, "top", "machine", 7, 5), F.wall(R, "bottom", "shelf", 2, { frac: 0.6 })],
  "pub": R => [F.wall(R, "top", "bar", 6, { frac: 0.6 }), ...F.grid({ x: R.x, y: R.y + 7, w: R.w * 0.7, h: R.h - 7 }, "table", 6, 6), F.at(R, "billiards", 0.86, 0.6)],
  "snug": R => [...F.along(R, "top", "booth", 7, 3), F.at(R, "fireplace", 0.5, 0.94, { rot: 180 })],
  "stage-small": R => [F.wall(R, "top", "stage", 5, { w: R.w * 0.5, h: 5 }), ...F.grid({ x: R.x, y: R.y + 7, w: R.w, h: R.h - 7 }, "table-round", 6.5, 6.5)],
  "milkbar": R => [F.wall(R, "top", "counter", 2.5, { frac: 0.75 }), ...F.along({ x: R.x, y: R.y + 3, w: R.w * 0.75, h: 2 }, "top", "stool", 2.2, 1.2), ...F.along(R, "bottom", "booth", 7, 3)],
  "kaff": R => [F.wall(R, "top", "counter", 2.5, { frac: 0.5 }), ...F.grid({ x: R.x, y: R.y + 4, w: R.w, h: R.h - 4 }, "table-round", 6, 6), F.at(R, "record-player", 0.9, 0.08)],
  "automat": R => [F.wall(R, "top", "lockers", 1.8, { frac: 0.85 }), ...F.grid({ x: R.x, y: R.y + 4, w: R.w, h: R.h - 4 }, "table", 6, 6)],
  "booths": R => [...F.along(R, "top", "booth", 7, 3), ...F.along(R, "bottom", "booth", 7, 3)],
  "maitre-d": R => [F.at(R, "counter", 0.5, 0.35, { w: 5 }), F.at(R, "plant", 0.1, 0.8), F.at(R, "plant", 0.9, 0.8), F.at(R, "rug", 0.5, 0.65, { w: R.w * 0.5, h: R.h * 0.3 })],
  "banking-hall": R => [F.wall(R, "top", "teller-counter", 3, { frac: 0.85 }), F.at(R, "queue-rope", 0.4, 0.55, { w: R.w * 0.4 }), F.at(R, "queue-rope", 0.4, 0.68, { w: R.w * 0.4 }), F.at(R, "column", 0.15, 0.82, { round: true }), F.at(R, "column", 0.85, 0.82, { round: true }), F.at(R, "desk", 0.85, 0.5)],
  "deposit-boxes": R => [F.wall(R, "top", "deposit-wall", 1.5, { frac: 0.9 }), F.wall(R, "left", "deposit-wall", 1.5, { frac: 0.8 }), F.wall(R, "right", "deposit-wall", 1.5, { frac: 0.8 }), F.at(R, "table", 0.5, 0.6)],
  "teller-backoffice": R => [...F.grid(R, "typing-desk", 5.5, 5.5), F.at(R, "safe", 0.92, 0.12)],
  "private-banking": R => [F.at(R, "desk-big", 0.5, 0.35), F.at(R, "armchair", 0.35, 0.7), F.at(R, "armchair", 0.65, 0.7), F.at(R, "rug", 0.5, 0.55, { w: R.w * 0.6, h: R.h * 0.5 })],
  "staff-canteen": R => [...F.grid(R, "table-long", 14, 6.5, { w: 10 }), F.wall(R, "top", "counter", 2.5, { frac: 0.5 })],
  "precinct-desk": R => [F.wall(R, "top", "counter", 2.5, { frac: 0.7 }), ...F.along(R, "bottom", "chair", 2.2, 1.6), F.at(R, "plant", 0.08, 0.6)],
  "squad-room": R => [...F.grid(R, "desk", 7, 6.5), F.wall(R, "top", "chalkboard", 0.8, { frac: 0.6 })],
  "evidence": R => [...F.rows(R, "evidence-cage", 6, { frac: 0.8 })],
  "cells": R => [...F.along(R, "top", "cell", 7.5, 8)],
  "interview": R => [F.at(R, "table", 0.5, 0.5), F.at(R, "mirror", 0.5, 0.04, { w: R.w * 0.5 })],
  "shop-news": R => [F.wall(R, "right", "counter", 2.5, { frac: 0.4 }), ...F.rows({ x: R.x, y: R.y, w: R.w * 0.75, h: R.h }, "shelf", 5, { alt: true })],
  "shop-pawn": R => [F.wall(R, "top", "counter", 2.5, { frac: 0.7 }), ...F.along(R, "left", "display-case", 6, 2.5), F.at(R, "display-case", 0.6, 0.6)],
  "shop-books": R => [...F.rows(R, "bookcase", 5, { frac: 0.7 }), F.at(R, "counter", 0.85, 0.85, { w: 5 })],
  "shop-pharmacy": R => [F.wall(R, "top", "counter", 2.5, { frac: 0.6 }), ...F.rows({ x: R.x, y: R.y + 4, w: R.w, h: R.h - 4 }, "shelf", 5, { alt: true, frac: 0.6 })],
  "counter-public": R => [F.wall(R, "top", "counter", 2.5, { frac: 0.8 }), ...F.along(R, "bottom", "chair", 2.2, 1.6)],
  "stockroom": R => [...F.rows(R, "shelf", 5), F.at(R, "crate", 0.85, 0.85)],
  "laundry": R => [...F.rows(R, "washer-row", 6, { frac: 0.8 }), F.wall(R, "bottom", "counter", 2.5, { frac: 0.4 })],
  "folding": R => [...F.grid(R, "table-long", 12, 6, { w: 8 }), ...F.along(R, "top", "barrel", 3, 1.2)],
  "car-bays": R => [...F.along(R, "top", "car-lift", 11, 14), F.at(R, "autopod", 0.3, 0.38, { rot: 0 }), F.wall(R, "bottom", "workbench", 3, { frac: 0.6 })],
  "parts-store": R => [...F.rows(R, "shelf", 4.5, { alt: true })],
  "boat-slip": R => [F.at(R, "water", 0.5, 0.45, { w: R.w * 0.6, h: R.h * 0.8 }), F.at(R, "boat", 0.5, 0.45, { w: 7 }), F.wall(R, "bottom", "workbench", 3, { frac: 0.5 })],
  "jetty": R => [F.at(R, "water", 0.5, 0.75, { w: R.w * 0.95, h: R.h * 0.45 }), ...F.along(R, "top", "barrel", 3.5, 1.2), F.at(R, "crate", 0.5, 0.3)],
  "hold": R => [...F.grid(R, "crate", 4.5, 4.5, { skip: (i, j) => (i * 2 + j) % 5 === 0 }), F.at(R, "ladder", 0.5, 0.08)],
  "gangway": R => [F.at(R, "hazard-strip", 0.5, 0.85, { w: R.w * 0.8 }), F.at(R, "ladder", 0.5, 0.5)],
  "transformers": R => F.grid(R, "transformer", 9, 9),
  "generator": R => [F.at(R, "apparatus", 0.4, 0.5), F.wall(R, "top", "console", 3.5, { frac: 0.6 }), F.at(R, "transformer", 0.82, 0.6)],
  "dispensary": R => [F.wall(R, "top", "counter", 2.5, { frac: 0.75 }), ...F.rows({ x: R.x, y: R.y + 4, w: R.w, h: R.h - 4 }, "shelf", 4.5, { alt: true, frac: 0.7 })],
  "classroom": R => [F.wall(R, "top", "chalkboard", 0.8, { frac: 0.6 }), F.at(R, "desk", 0.85, 0.15), ...F.grid({ x: R.x, y: R.y + 6, w: R.w, h: R.h - 6 }, "chair", 3.6, 3.6)],
  "staff-room": R => [F.at(R, "table-long", 0.5, 0.55, { w: R.w * 0.6 }), F.wall(R, "top", "kitchen-run", 2.4, { frac: 0.5 })],
  "nave": R => [...F.rows({ x: R.x, y: R.y + R.h * 0.25, w: R.w, h: R.h * 0.75 }, "seat-row", 4, { frac: 0.75 }), F.wall(R, "top", "stage", 6, { w: R.w * 0.4, h: 6 })],
  "narthex": R => [F.at(R, "rug", 0.5, 0.5, { w: R.w * 0.4, h: R.h * 0.7 }), F.at(R, "flame", 0.2, 0.3), F.at(R, "flame", 0.8, 0.3)],
  "chapel": R => [...F.along(R, "top", "frame", 4.5, 0.5), F.at(R, "flame", 0.5, 0.2), ...F.rows({ x: R.x, y: R.y + R.h * 0.4, w: R.w, h: R.h * 0.6 }, "seat-row", 4, { frac: 0.6 })]
};
ARCH.hotel = R => [...F.along(R, "top", "bed", 9, 7, { w: 5 }), ...F.along(R, "bottom", "bed", 9, 7, { w: 5 })];

// ---- src/layout.js ----
// =============================================================================
// layout — the room graph becomes architecture
// =============================================================================
// The generator emits a GRAPH: rooms in four security bands, links that skip a
// ring, pairs of lock-and-answer, three ways in. It never emits geometry. This
// file is where geometry comes from, and it comes from two places only:
//
//   1. the BAND of each room (how deep it sits), and
//   2. the printed BUILDING STYLE, via o.geometry.rings (the generator's D10):
//        hard     Brutalist      one sealed core, thick walls, one way through
//        glazed   Modernist      glass partitions; you see across rings
//        blurred  Old relic      a warren; cuts jitter, passages on no plan
//        spine    Corporate chic a double-loaded corridor is the chokepoint
//        soft     Alternative    no doors to speak of; bead curtains
//        radial   Futurist       pods off a hub; everything passes the hub
//
// Two views, both approved 14/10/2026:
//   "rings" — the depth diagram drawn as a building: concentric bands, secure at
//             the centre. Honours decision 10 (a map of what stands between the
//             crew and the thing, not a traversal checklist).
//   "plan"  — a full floor plan, floor by floor, laid out per style.

const UNIT = 150;              // square feet per unit of room weight (rings)
const UNIT_PLAN = 260;         // … and in the floor plan, where rooms are real rooms
const WALL = { ext: 1.6, ring: 1.1, int: 0.6, glass: 0.45, soft: 0.3 };

const L = M.layout = {};

// --- Walls and doors -----------------------------------------------------------
// A wall is a straight segment or an arc; a door is a point on a wall with a
// width. finishWalls() cuts every door out of every wall it sits on, after
// merging collinear duplicates so a shared edge is one wall, not two.
L.seg = (a, b, t) => ({ a, b, t });
L.arc = (cx, cy, r, a0, a1, t) => ({ arc: true, cx, cy, r, a0, a1, t });
const RANK = { ext: 5, ring: 4, int: 3, glass: 2, soft: 1, none: 0 };

function mergeAxis(walls) {
  const keep = [], groups = {};
  for (const w of walls) {
    if (w.arc) { keep.push(w); continue; }
    const h = Math.abs(w.a[1] - w.b[1]) < 0.01, v = Math.abs(w.a[0] - w.b[0]) < 0.01;
    if (!h && !v) { keep.push(w); continue; }
    const key = h ? "h" + w.a[1].toFixed(2) : "v" + w.a[0].toFixed(2);
    const lo = h ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]);
    const hi = h ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1]);
    (groups[key] ||= []).push({ lo, hi, t: w.t, h, c: h ? w.a[1] : w.a[0] });
  }
  for (const key in groups) {
    // Sweep: at every point the highest-ranked wall type wins.
    const g = groups[key], pts = [...new Set(g.flatMap(s => [s.lo, s.hi]))].sort((a, b) => a - b);
    let run = null;
    for (let i = 0; i < pts.length - 1; i++) {
      const m = (pts[i] + pts[i + 1]) / 2;
      let best = null;
      for (const s of g) if (s.lo <= m && s.hi >= m && (!best || RANK[s.t] > RANK[best])) best = s.t;
      if (run && run.t === best && Math.abs(run.hi - pts[i]) < 0.01) run.hi = pts[i + 1];
      else { if (run && run.t) keep.push(run); run = best ? { lo: pts[i], hi: pts[i + 1], t: best, h: g[0].h, c: g[0].c } : null; }
    }
    if (run && run.t) keep.push(run);
  }
  return keep.map(s => s.lo === undefined ? s : (s.h ? L.seg([s.lo, s.c], [s.hi, s.c], s.t) : L.seg([s.c, s.lo], [s.c, s.hi], s.t)));
}

L.finishWalls = function (walls, doors) {
  const merged = mergeAxis(walls), out = [];
  for (const w of merged) {
    if (w.arc) {
      let spans = [[w.a0, w.a1]];
      for (const d of doors) {
        if (Math.abs(Math.hypot(d.x - w.cx, d.y - w.cy) - w.r) > 0.6) continue;
        let a = Math.atan2(d.y - w.cy, d.x - w.cx); while (a < w.a0) a += 2 * Math.PI; while (a > w.a0 + 2 * Math.PI) a -= 2 * Math.PI;
        if (a > w.a1) continue;
        const half = d.w / 2 / w.r;
        spans = spans.flatMap(([s, e]) => (a + half <= s || a - half >= e) ? [[s, e]] : [[s, a - half], [a + half, e]].filter(([p, q]) => q - p > 0.01));
      }
      spans.forEach(([s, e]) => out.push(Object.assign({}, w, { a0: s, a1: e })));
      continue;
    }
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], len = Math.hypot(dx, dy);
    if (len < 0.05) continue;
    let spans = [[0, len]];
    for (const d of doors) {
      const t = ((d.x - w.a[0]) * dx + (d.y - w.a[1]) * dy) / len;
      const off = Math.abs((d.x - w.a[0]) * dy - (d.y - w.a[1]) * dx) / len;
      if (off > 0.4 || t < -0.1 || t > len + 0.1) continue;
      spans = spans.flatMap(([s, e]) => (t + d.w / 2 <= s || t - d.w / 2 >= e) ? [[s, e]] : [[s, t - d.w / 2], [t + d.w / 2, e]].filter(([p, q]) => q - p > 0.05));
    }
    for (const [s, e] of spans) out.push(L.seg([w.a[0] + dx * s / len, w.a[1] + dy * s / len], [w.a[0] + dx * e / len, w.a[1] + dy * e / len], w.t));
  }
  return out;
};

// --- Room helpers ----------------------------------------------------------------
const depthOf = b => M.BANDS.indexOf(b);
const rectRoom = (room, x, y, w, h) => Object.assign(room, {
  shape: { kind: "poly", pts: G.rectPts({ x, y, w, h }) },
  rect: { x, y, w, h },
  frame: { cx: x + w / 2, cy: y + h / 2, w, h, rot: 0 }
});

// Shared edge between two axis-aligned rects, or null. Returns the midpoint
// range so a door can be placed anywhere along it.
function sharedEdge(a, b, min) {
  const E = 0.05;
  if (Math.abs(a.x + a.w - b.x) < E || Math.abs(b.x + b.w - a.x) < E) {
    const x = Math.abs(a.x + a.w - b.x) < E ? b.x : a.x;
    const lo = Math.max(a.y, b.y), hi = Math.min(a.y + a.h, b.y + b.h);
    if (hi - lo >= min) return { o: "v", c: x, lo, hi };
  }
  if (Math.abs(a.y + a.h - b.y) < E || Math.abs(b.y + b.h - a.y) < E) {
    const y = Math.abs(a.y + a.h - b.y) < E ? b.y : a.y;
    const lo = Math.max(a.x, b.x), hi = Math.min(a.x + a.w, b.x + b.w);
    if (hi - lo >= min) return { o: "h", c: y, lo, hi };
  }
  return null;
}
const doorOn = (e, t, w, kind, rng) => {
  const m = 1.5 + w / 2, span = e.hi - e.lo;
  const at = span <= 2 * m ? (e.lo + e.hi) / 2 : e.lo + m + (span - 2 * m) * (t === undefined ? (rng ? rng.range(0.25, 0.75) : 0.5) : t);
  return e.o === "v" ? { x: e.c, y: at, ang: 90, w, kind } : { x: at, y: e.c, ang: 0, w, kind };
};

// How many doors a style wants, and what kind. `extra` is the chance that an
// adjacency beyond the spanning tree also gets a way through.
const STYLE = {
  hard:    { int: "int",   ring: "ring",  door: "door",    extra: 0.0,  ringDoors: 1, wall: 1.25 },
  glazed:  { int: "glass", ring: "glass", door: "glass",   extra: 0.55, ringDoors: 2, wall: 1 },
  blurred: { int: "int",   ring: "ring",  door: "door",    extra: 0.4,  ringDoors: 3, wall: 1, jitter: 0.12 },
  spine:   { int: "int",   ring: "ring",  door: "door",    extra: 0.0,  ringDoors: 2, wall: 1 },
  soft:    { int: "soft",  ring: "soft",  door: "curtain", extra: 0.85, ringDoors: 9, wall: 1 },
  radial:  { int: "glass", ring: "int",   door: "door",    extra: 0.0,  ringDoors: 1, wall: 1 }
};
L.STYLE = STYLE;

// Door kind for a link between two rooms: the secure band's doors are vault
// doors in every style but soft, where even the vault has a curtain.
const kindFor = (st, a, b) => {
  const deep = Math.max(depthOf(a.band), depthOf(b.band));
  if (deep === 3 && st !== STYLE.soft) return "vault";
  return st.door;
};

// --- Spanning doors -----------------------------------------------------------------
// Prim's from the entrance rooms, cost by band jump: a link within a band or
// one band deeper is cheap, a jump of two bands is what skips are for, so the
// tree avoids it. Then the style adds extra doors.
function connect(rooms, edges, st, rng, roots) {
  const cost = (a, b) => 1 + Math.abs(depthOf(a.band) - depthOf(b.band)) * 2 + (Math.abs(depthOf(a.band) - depthOf(b.band)) > 1 ? 20 : 0) + rng() * 0.5;
  const inTree = new Set(roots.length ? roots : [rooms[0]]), chosen = [];
  while (inTree.size < rooms.length) {
    let best = null;
    for (const e of edges) {
      const ia = inTree.has(e.a), ib = inTree.has(e.b);
      if (ia === ib) continue;
      const c = cost(e.a, e.b);
      if (!best || c < best.c) best = { e, c };
    }
    if (!best) break;
    chosen.push(best.e); inTree.add(best.e.a); inTree.add(best.e.b);
  }
  for (const e of edges) if (!chosen.includes(e) && Math.abs(depthOf(e.a.band) - depthOf(e.b.band)) <= 1 && rng.chance(st.extra)) chosen.push(e);
  return chosen;
}

// =============================================================================
// VIEW 1 — RINGS (rectangular)
// =============================================================================
// Bands become concentric annuli: public outside, the deepest band at the
// core. Each annulus is cut into its rooms around the perimeter, weighted by
// room size. Ring thickness is solved from the band's area, so a band of big
// rooms is a fat ring.

function ringRect(model, rng) {
  const st = M.own(STYLE, model.rings) || STYLE.hard;
  const bands = M.BANDS.filter(b => model.rooms.some(r => r.band === b));
  const inner = bands[bands.length - 1];
  const coreRooms = model.rooms.filter(r => r.band === inner);
  const coreA = Math.max(360, coreRooms.reduce((s, r) => s + r.w, 0) * UNIT * 1.3);
  let cw = Math.sqrt(coreA * 1.35), ch = coreA / cw;
  cw = Math.max(cw, 18); ch = Math.max(ch, 14);
  let I = { x: -cw / 2, y: -ch / 2, w: cw, h: ch };
  const rings = [{ band: inner, O: I, I: null, rooms: coreRooms }];
  for (let k = bands.length - 2; k >= 0; k--) {
    const b = bands[k], rs = model.rooms.filter(r => r.band === b);
    const A = Math.max(500, rs.reduce((s, r) => s + r.w, 0) * UNIT * 1.5);
    let d = (-2 * (I.w + I.h) + Math.sqrt(4 * (I.w + I.h) ** 2 + 16 * A)) / 8;
    d = Math.min(34, Math.max(17, d));
    const O = { x: I.x - d, y: I.y - d, w: I.w + 2 * d, h: I.h + 2 * d };
    rings.unshift({ band: b, O, I, d, rooms: rs });
    I = O;
  }
  const walls = [], doors = [], extras = [];

  // The core: split the deepest band across the core rect, deepest-first.
  const core = rings[rings.length - 1];
  const sliceCore = (rs, R) => {
    if (rs.length === 1) { rectRoom(rs[0], R.x, R.y, R.w, R.h); return; }
    const tot = rs.reduce((s, r) => s + r.w, 0), f = rs[0].w / tot;
    if (R.w >= R.h) { rectRoom(rs[0], R.x, R.y, R.w * f, R.h); sliceCore(rs.slice(1), { x: R.x + R.w * f, y: R.y, w: R.w * (1 - f), h: R.h }); }
    else { rectRoom(rs[0], R.x, R.y, R.w, R.h * f); sliceCore(rs.slice(1), { x: R.x, y: R.y + R.h * f, w: R.w, h: R.h * (1 - f) }); }
  };
  sliceCore(core.rooms, core.O);
  for (let i = 0; i < core.rooms.length - 1; i++) {
    const a = core.rooms[i].rect, b = core.rooms[i + 1].rect, e = sharedEdge(a, b, 2);
    if (e) {
      walls.push(e.o === "v" ? L.seg([e.c, e.lo], [e.c, e.hi], st.int) : L.seg([e.lo, e.c], [e.hi, e.c], st.int));
      doors.push(Object.assign(doorOn(e, 0.5, 3, kindFor(st, core.rooms[i], core.rooms[i + 1])), { a: core.rooms[i], b: core.rooms[i + 1] }));
    }
  }
  // One band only (a lair, a hand-built roll): the core is the whole building.
  walls.push(...G.rectPts(core.O).map((p, i, a) => L.seg(p, a[(i + 1) % 4], rings.length === 1 ? "ext" : st.ring)));

  // Annuli.
  for (let k = 0; k < rings.length - 1; k++) {
    const ring = rings[k], { O, I, d } = ring;
    const C = { x: I.x - d / 2, y: I.y - d / 2, w: I.w + d, h: I.h + d };
    const Ltot = 2 * (C.w + C.h);
    const corners = [C.w / 2, C.w / 2 + C.h, C.w / 2 + C.h + C.w, Ltot - C.w / 2];
    // The ring's rooms in perimeter order. The outermost ring puts its widest
    // public room at the front door; inner rings start at a rolled offset.
    let rs = ring.rooms.slice();
    let items = rs.map(r => ({ room: r, w: r.w }));
    if (items.length === 1) items.push({ room: null, w: items[0].w * 0.9, band: ring.band });   // a passage completes the ring
    if (k === 0) { items.sort((a, b) => (b.room ? b.w : -1) - (a.room ? a.w : -1)); }
    else items = rng.shuffle(items);
    const tot = items.reduce((s, it) => s + it.w, 0);
    const start = k === 0 ? -items[0].w / tot * Ltot / 2 : rng.range(0, Ltot);
    // Cuts must land on a straight run, clear of the corner squares.
    const margin = d / 2 + 2.5;
    const snap = s => {
      s = ((s % Ltot) + Ltot) % Ltot;
      for (const c of corners) if (Math.abs(s - c) < margin) return s < c ? c - margin : c + margin;
      return s;
    };
    let acc = start; const cuts = [];
    for (const it of items) { cuts.push(snap(acc)); acc += it.w / tot * Ltot; }
    // A point on the centreline → which side, and the cut line across the ring.
    const sideAt = s => (s < corners[0] || s >= corners[3]) ? "bottom" : s < corners[1] ? "left" : s < corners[2] ? "top" : "right";
    const cutLine = s => {
      const side = sideAt(s);
      if (side === "bottom") { const x = C.x + C.w / 2 - (s >= corners[3] ? s - Ltot : s); return { side, o: [x, O.y + O.h], i: [x, I.y + I.h], c: x }; }
      if (side === "left") { const y = C.y + C.h - (s - corners[0]); return { side, o: [O.x, y], i: [I.x, y], c: y }; }
      if (side === "top") { const x = C.x + (s - corners[1]); return { side, o: [x, O.y], i: [x, I.y], c: x }; }
      const y = C.y + (s - corners[2]); return { side, o: [O.x + O.w, y], i: [I.x + I.w, y], c: y };
    };
    const oc = [[O.x, O.y + O.h], [O.x, O.y], [O.x + O.w, O.y], [O.x + O.w, O.y + O.h]];   // BL TL TR BR
    const ic = [[I.x, I.y + I.h], [I.x, I.y], [I.x + I.w, I.y], [I.x + I.w, I.y + I.h]];
    const segOf = (s0, s1) => {               // s1 may exceed Ltot
      const outer = [cutLine(s0).o], innerPts = [cutLine(s0).i], pieces = [];
      for (let lap = 0; lap < 2; lap++) corners.forEach((c, ci) => { const cc = c + lap * Ltot; if (cc > s0 && cc < s1) { outer.push(oc[ci]); innerPts.push(ic[ci]); } });
      const e = cutLine(s1 % Ltot); outer.push(e.o); innerPts.push(e.i);
      return outer.concat(innerPts.reverse());
    };
    items.forEach((it, i) => {
      const s0 = cuts[i]; let s1 = cuts[(i + 1) % cuts.length]; if (s1 <= s0) s1 += Ltot;
      const pts = segOf(s0, s1);
      // Furnishing frames: one per straight run of this arc, longest first.
      // Each run is measured on its own side, so a run that ends exactly on a
      // corner never reads the neighbouring side's coordinate.
      const runs = [];
      const sides = [["bottom", corners[3] - Ltot, corners[0]], ["left", corners[0], corners[1]], ["top", corners[1], corners[2]], ["right", corners[2], corners[3]]];
      for (let lap = 0; lap < 2; lap++) for (const [side, a, b] of sides) {
        const lo = Math.max(s0, a + lap * Ltot), hi = Math.min(s1, b + lap * Ltot);
        if (hi - lo > 1) runs.push({ side, len: hi - lo, lo: lo - lap * Ltot, hi: hi - lap * Ltot });
      }
      runs.sort((a, b) => b.len - a.len);
      const along = (side, t) => side === "bottom" ? C.x + C.w / 2 - t : side === "left" ? C.y + C.h - (t - corners[0]) : side === "top" ? C.x + (t - corners[1]) : C.y + (t - corners[2]);
      const inner = 1.2;
      const frames = runs.map(r0 => {
        const c0 = along(r0.side, r0.lo), c1 = along(r0.side, r0.hi), lo = Math.min(c0, c1), hi = Math.max(c0, c1);
        if (r0.side === "bottom" || r0.side === "top") {
          const y0 = r0.side === "top" ? O.y : I.y + I.h;
          return { cx: (lo + hi) / 2, cy: y0 + d / 2, w: Math.max(4, hi - lo - inner), h: d - inner, rot: 0, side: r0.side };
        }
        const x0 = r0.side === "left" ? O.x : I.x + I.w;
        return { cx: x0 + d / 2, cy: (lo + hi) / 2, w: d - inner, h: Math.max(4, hi - lo - inner), rot: 0, side: r0.side };
      });
      if (!frames.length) frames.push({ cx: G.centroid(pts)[0], cy: G.centroid(pts)[1], w: 6, h: d - inner, rot: 0, side: "bottom" });
      const frame = frames[0], r0 = { side: frame.side };
      if (it.room) Object.assign(it.room, { shape: { kind: "poly", pts }, frame, frames, ringSide: r0.side, s0, s1, ring: k });
      else extras.push({ kind: "passage", band: ring.band, shape: { kind: "poly", pts }, frame, frames });
      it.s0 = s0; it.s1 = s1;
      // The cut wall at s0, between this item and the previous one.
      const c = cutLine(s0);
      walls.push(L.seg(c.o, c.i, st.int));
    });
    ring.spare = [];
    const spare = ring.spare;
    // Doors inside the ring: neighbours around the perimeter. A passage is
    // always open to both neighbours; rooms connect per the style.
    items.forEach((it, i) => {
      const prev = items[(i - 1 + items.length) % items.length];
      if (prev === it) return;
      const c = cutLine(it.s0), mid = [(c.o[0] + c.i[0]) / 2, (c.o[1] + c.i[1]) / 2];
      const ang = (c.side === "bottom" || c.side === "top") ? 90 : 0;
      const open = !it.room || !prev.room;
      const want = open || i === 0 && k > 0 || rng.chance(Math.max(st.extra, k === 0 ? 0.65 : 0.35));
      const dr = { x: mid[0], y: mid[1], ang, w: open ? Math.min(d - 3, 7) : 3, kind: open ? "opening" : kindFor(st, it.room, prev.room || it.room), a: it.room || it, b: prev.room || prev };
      if (want) doors.push(dr); else spare.push(dr);
    });
    ring.items = items; ring.cutLine = cutLine; ring.C = C; ring.Ltot = Ltot; ring.corners = corners;
    walls.push(...G.rectPts(O).map((p, i, a) => L.seg(p, a[(i + 1) % 4], k === 0 ? "ext" : st.ring)));
  }

  // Doors between rings: along each ring's inner boundary, the items of ring
  // k and ring k+1 overlap; a door goes in the middle of the best overlaps.
  const perim = (R, p) => {           // point on rect boundary → param from bottom-mid, clockwise like the rings
    const [x, y] = p, E = 0.05, W = R.w, H = R.h;
    if (Math.abs(y - (R.y + H)) < E) return ((R.x + W / 2 - x) + 2 * (W + H)) % (2 * (W + H));
    if (Math.abs(x - R.x) < E) return W / 2 + (R.y + H - y);
    if (Math.abs(y - R.y) < E) return W / 2 + H + (x - R.x);
    return W / 2 + H + W + (y - R.y);
  };
  const atPerim = (R, s) => {
    const W = R.w, H = R.h, Lp = 2 * (W + H); s = ((s % Lp) + Lp) % Lp;
    if (s < W / 2) return { p: [R.x + W / 2 - s, R.y + H], ang: 0 };
    if (s < W / 2 + H) return { p: [R.x, R.y + H - (s - W / 2)], ang: 90 };
    if (s < W / 2 + H + W) return { p: [R.x + (s - W / 2 - H), R.y], ang: 0 };
    if (s < W / 2 + 2 * H + W) return { p: [R.x + W, R.y + (s - W / 2 - H - W)], ang: 90 };
    return { p: [R.x + W / 2 - (s - 2 * H - 2 * W), R.y + H], ang: 0 };
  };
  const intervalsOn = (R, ring, which) => {
    // Each item's span on the rect R (ring k's inner edge or ring k+1's outer edge).
    if (!ring.items) {          // the core: rooms are rects
      const Lp = 2 * (R.w + R.h), out = [];
      for (const r of ring.rooms) {
        const pts = G.rectPts(r.rect).filter(([x, y]) => (Math.abs(x - R.x) < 0.05 || Math.abs(x - R.x - R.w) < 0.05 || Math.abs(y - R.y) < 0.05 || Math.abs(y - R.y - R.h) < 0.05));
        // sample the room's boundary along R
        const samples = [];
        for (let s = 0; s < Lp; s += 0.5) { const q = atPerim(R, s).p; if (q[0] >= r.rect.x - 0.05 && q[0] <= r.rect.x + r.rect.w + 0.05 && q[1] >= r.rect.y - 0.05 && q[1] <= r.rect.y + r.rect.h + 0.05) samples.push(s); }
        if (samples.length) out.push({ room: r, node: r, ss: samples });
        void pts;
      }
      return out;
    }
    const Lp = 2 * (R.w + R.h);
    return ring.items.map(it => {
      const a = ring.cutLine(((it.s0 % ring.Ltot) + ring.Ltot) % ring.Ltot)[which], b = ring.cutLine(((it.s1 % ring.Ltot) + ring.Ltot) % ring.Ltot)[which];
      let p0 = perim(R, a), p1 = perim(R, b); if (p1 <= p0) p1 += Lp;
      const ss = []; for (let s = p0; s <= p1; s += 0.5) ss.push(s % Lp);
      return { room: it.room, node: it.room || it, ss, passage: !it.room };
    });
  };
  for (let k = 0; k < rings.length - 1; k++) {
    const R = rings[k].I, Lp = 2 * (R.w + R.h);
    const outerSide = intervalsOn(R, rings[k], "i"), innerSide = intervalsOn(R, rings[k + 1], "o");
    const pairs = [];
    for (const A of outerSide) for (const B of innerSide) {
      const setB = new Set(B.ss.map(s => Math.round(s * 2)));
      const both = A.ss.filter(s => setB.has(Math.round(s * 2)));
      // keep only straight runs: drop samples within 2.5 ft of a corner
      const cornersP = [R.w / 2, R.w / 2 + R.h, R.w / 2 + R.h + R.w, Lp - R.w / 2];
      const ok = both.filter(s => cornersP.every(c => Math.abs(s - c) > 3 && Math.abs(s - c - Lp) > 3 && Math.abs(s - c + Lp) > 3));
      if (ok.length > 6) pairs.push({ A, B, ok });
    }
    // Every inner-ring item needs a way out; the style decides how many more.
    pairs.sort((p, q) => q.ok.length - p.ok.length);
    // One crossing per boundary for hard and radial (the inner rooms reach it
    // around their own ring); more for the looser styles, preferring inner
    // items that have no way out yet.
    const used = [], served = new Set();
    const mk = p => {
      const s = p.ok[Math.floor(p.ok.length / 2)], at = atPerim(R, s);
      const a = p.A.room || { band: rings[k].band }, b = p.B.room || { band: rings[k + 1].band };
      return { x: at.p[0], y: at.p[1], ang: at.ang, w: 3.2, kind: kindFor(st, a, b), a: p.A.node, b: p.B.node, ringDoor: true };
    };
    for (const p of pairs) {
      if (used.length >= st.ringDoors) break;
      if (used.length && served.has(p.B.node)) continue;
      doors.push(mk(p)); used.push(p); served.add(p.B.node);
    }
    rings[k].crossSpare = pairs.filter(p => !used.includes(p)).map(mk);
  }

  // Everything must be reachable from the street. Where the rolled doors
  // leave a room stranded, open the nearest spare door — around its own ring
  // first, a ring crossing only if that fails.
  const front = rings[0].items ? (rings[0].items.find(it => it.room && it.room.ringSide === "bottom") || rings[0].items[0]) : { room: core.rooms[0] };
  const spares = rings.flatMap(r => (r.spare || []).concat(r.crossSpare || []));
  for (let guard = 0; guard < 40; guard++) {
    const seen = new Set([front.room || front]), q = [front.room || front];
    while (q.length) { const n = q.shift(); for (const d of doors) for (const [x, y] of [[d.a, d.b], [d.b, d.a]]) if (x === n && y && !seen.has(y)) { seen.add(y); q.push(y); } }
    const all = rings.flatMap(r => r.items ? r.items.map(it => it.room || it) : r.rooms);
    if (all.every(n => seen.has(n))) break;
    const fix = spares.find(d => (seen.has(d.a) && !seen.has(d.b)) || (seen.has(d.b) && !seen.has(d.a)));
    if (!fix) break;
    doors.push(fix); spares.splice(spares.indexOf(fix), 1);
  }
  const rooms = model.rooms;
  const outer = rings[0].O;
  return { kind: "rings", levels: [{ lvl: 0, title: null, rooms, extras, walls, doors, bbox: outer, exterior: { kind: "rect", r: outer } }], rings, rng, st };
}

// =============================================================================
// VIEW 1b — RINGS (circular), for the Futurist "radial" style
// =============================================================================
function ringCircle(model, rng) {
  const st = STYLE.radial;
  const bands = M.BANDS.filter(b => model.rooms.some(r => r.band === b));
  const inner = bands[bands.length - 1];
  const coreRooms = model.rooms.filter(r => r.band === inner);
  let r0 = Math.max(10, Math.sqrt(coreRooms.reduce((s, r) => s + r.w, 0) * UNIT / Math.PI));
  const rings = [{ band: inner, rin: 0, rout: r0, rooms: coreRooms }];
  let rin = r0;
  for (let k = bands.length - 2; k >= 0; k--) {
    const rs = model.rooms.filter(r => r.band === bands[k]);
    const A = Math.max(400, rs.reduce((s, r) => s + r.w, 0) * UNIT * 1.15);
    let rout = Math.sqrt(rin * rin + A / Math.PI); rout = Math.max(rout, rin + 13); rout = Math.min(rout, rin + 30);
    rings.unshift({ band: bands[k], rin, rout, rooms: rs }); rin = rout;
  }
  const walls = [], doors = [], extras = [];
  const FRONT = Math.PI / 2;            // screen-down is the street
  rings.forEach((ring, k) => {
    let items = ring.rooms.map(r => ({ room: r, w: r.w }));
    if (ring.rin > 0 && items.length === 1) items.push({ room: null, w: items[0].w * 0.9, band: ring.band });
    if (k === 0) items.sort((a, b) => b.w - a.w); else items = rng.shuffle(items);
    const tot = items.reduce((s, it) => s + it.w, 0);
    let a = k === 0 ? FRONT - items[0].w / tot * Math.PI : rng.range(0, 2 * Math.PI);
    items.forEach(it => {
      const span = it.w / tot * 2 * Math.PI, a0 = a, a1 = a + span; a = a1;
      const rr0 = ring.rin, rr1 = ring.rout, steps = Math.max(4, Math.ceil(span / 0.12));
      const pts = [];
      for (let i = 0; i <= steps; i++) { const t = a0 + span * i / steps; pts.push([Math.cos(t) * rr1, Math.sin(t) * rr1]); }
      if (rr0 > 0) for (let i = steps; i >= 0; i--) { const t = a0 + span * i / steps; pts.push([Math.cos(t) * rr0, Math.sin(t) * rr0]); }
      else pts.push([0, 0]);
      const am = (a0 + a1) / 2, rm = rr0 > 0 ? (rr0 + rr1) / 2 : rr1 * (items.length === 1 ? 0 : 0.5);
      const chord = rr0 > 0 ? 2 * rm * Math.sin(Math.min(span, Math.PI) / 2) : (items.length === 1 ? rr1 * 1.35 : 2 * rm * Math.sin(Math.min(span, Math.PI) / 2));
      const frame = { cx: Math.cos(am) * rm, cy: Math.sin(am) * rm, w: Math.max(4, chord * 0.72), h: rr0 > 0 ? (rr1 - rr0) * 0.78 : (items.length === 1 ? rr1 * 1.35 : rr1 * 0.6), rot: items.length === 1 && rr0 === 0 ? 0 : am * 180 / Math.PI + 90 };
      if (it.room) Object.assign(it.room, { shape: { kind: "poly", pts }, frame, a0, a1, ring: k });
      else extras.push({ kind: "passage", band: ring.band, shape: { kind: "poly", pts }, frame });
      Object.assign(it, { a0, a1 });
      if (items.length > 1) walls.push(L.seg([Math.cos(a0) * rr0, Math.sin(a0) * rr0], [Math.cos(a0) * rr1, Math.sin(a0) * rr1], st.int));
    });
    walls.push(L.arc(0, 0, ring.rout, 0, 2 * Math.PI, k === 0 ? "ext" : st.ring));
    ring.items = items;
    // Pods: no doors around the ring — every room opens inward only.
    if (items.some(it => !it.room)) items.forEach((it, i) => {
      const prev = items[(i - 1 + items.length) % items.length];
      if (it.room && prev.room) return;
      const rm = (ring.rin + ring.rout) / 2;
      doors.push({ x: Math.cos(it.a0) * rm, y: Math.sin(it.a0) * rm, ang: it.a0 * 180 / Math.PI, w: Math.min(6, ring.rout - ring.rin - 3), kind: "opening" });
    });
  });
  for (let k = 0; k < rings.length - 1; k++) {
    const R = rings[k].rin;
    for (const it of rings[k].items) {
      // each outer item gets one door inward, to whichever inner item it overlaps most
      let best = null;
      for (const jt of rings[k + 1].items) {
        let lo = Math.max(it.a0, jt.a0), hi = Math.min(it.a1, jt.a1);
        for (const off of [-2 * Math.PI, 2 * Math.PI]) { const l2 = Math.max(it.a0, jt.a0 + off), h2 = Math.min(it.a1, jt.a1 + off); if (h2 - l2 > hi - lo) { lo = l2; hi = h2; } }
        if (hi - lo > 0 && (!best || hi - lo > best.hi - best.lo)) best = { jt, lo, hi };
      }
      if (!best || (best.hi - best.lo) * R < 4) continue;
      const am = (best.lo + best.hi) / 2;
      doors.push({ x: Math.cos(am) * R, y: Math.sin(am) * R, ang: am * 180 / Math.PI + 90, w: 3.2, kind: kindFor(st, it.room || { band: rings[k].band }, best.jt.room || { band: rings[k + 1].band }), a: it.room, b: best.jt.room, ringDoor: true });
    }
  }
  const R = rings[0].rout;
  return { kind: "rings", circular: true, levels: [{ lvl: 0, title: null, rooms: model.rooms, extras, walls, doors, bbox: { x: -R, y: -R, w: 2 * R, h: 2 * R }, exterior: { kind: "circle", cx: 0, cy: 0, r: R } }], rings, rng, st };
}

// =============================================================================
// VIEW 2 — PLAN (floor by floor)
// =============================================================================
// Rooms go to floors by the catalogue's level hint. Each floor is laid out by
// the building style. A stair-and-lift core joins the floors.

const LEVEL_NAME = { "-1": "Basement", "0": "Ground floor", "1": "Upper floor", "2": "Top floor" };

function treemap(items, R, rng, jitter) {
  if (!items.length) return;
  if (items.length === 1) { const it = items[0]; it.place(R.x, R.y, R.w, R.h); return; }
  const tot = items.reduce((s, it) => s + it.w, 0);
  let k = 1, acc = items[0].w, best = Math.abs(acc - tot / 2);
  for (let i = 1; i < items.length - 1; i++) { const a2 = acc + items[i].w; if (Math.abs(a2 - tot / 2) < best) { best = Math.abs(a2 - tot / 2); acc = a2; k = i + 1; } else break; }
  let f = acc / tot;
  if (jitter) f = Math.min(0.85, Math.max(0.15, f + rng.range(-jitter, jitter)));
  const A = items.slice(0, k), B = items.slice(k);
  if (R.w >= R.h * 0.9) {           // vertical cut, shallow half on the left
    treemap(A, { x: R.x, y: R.y, w: R.w * f, h: R.h }, rng, jitter);
    treemap(B, { x: R.x + R.w * f, y: R.y, w: R.w * (1 - f), h: R.h }, rng, jitter);
  } else {                          // horizontal cut, shallow half at the front (bottom)
    treemap(A, { x: R.x, y: R.y + R.h * (1 - f), w: R.w, h: R.h * f }, rng, jitter);
    treemap(B, { x: R.x, y: R.y, w: R.w, h: R.h * (1 - f) }, rng, jitter);
  }
}

function planLevel(model, rooms, lvl, rng, multi) {
  const st = M.own(STYLE, model.rings) || STYLE.hard;
  const walls = [], doors = [], extras = [];
  const items = rooms.slice().sort((a, b) => depthOf(a.band) - depthOf(b.band) || b.w - a.w)
    .map(r => ({ room: r, w: r.w, place: (x, y, w, h) => rectRoom(r, x, y, w, h) }));
  let core = null;
  if (multi) {
    core = { kind: "core", band: "public", w: 1.3 };
    const it = { room: core, w: 1.3, place: (x, y, w, h) => Object.assign(core, { rect: { x, y, w, h }, shape: { kind: "poly", pts: G.rectPts({ x, y, w, h }) }, frame: { cx: x + w / 2, cy: y + h / 2, w, h, rot: 0 } }) };
    const at = items.findIndex(i => depthOf(i.room.band) > 0);
    items.splice(at < 0 ? items.length : at, 0, it);
  }
  const area = items.reduce((s, it) => s + it.w, 0) * UNIT_PLAN;
  let bbox, corridor = null;

  if (model.rings === "spine") {
    // A double-loaded corridor from the street door (bottom) to the back wall.
    const left = [], right = []; let wl = 0, wr = 0;
    for (const it of items) { if (wl <= wr) { left.push(it); wl += it.w; } else { right.push(it); wr += it.w; } }
    const D = Math.min(30, Math.max(14, Math.sqrt(area / 2 / 2.2)));
    const H = Math.max(wl, wr) * UNIT_PLAN / D, cw = 7;
    const place = (col, x) => { const tot = col.reduce((s, it) => s + it.w, 0); let y = H; for (const it of col) { const h = H * it.w / tot; it.place(x, y - h, D, h); y -= h; } };
    place(left, -cw / 2 - D); place(right, cw / 2);
    corridor = { kind: "corridor", band: "public", rect: { x: -cw / 2, y: 0, w: cw, h: H } };
    corridor.shape = { kind: "poly", pts: G.rectPts(corridor.rect) }; corridor.frame = { cx: 0, cy: H / 2, w: cw, h: H, rot: 0 };
    extras.push(corridor);
    bbox = { x: -cw / 2 - D, y: 0, w: 2 * D + cw, h: H };
  } else {
    const W = Math.sqrt(area * 1.4), H = area / W;
    bbox = { x: -W / 2, y: -H / 2, w: W, h: H };
    treemap(items, bbox, rng, st.jitter);
  }
  if (core) extras.push(core);

  // Walls: every room edge (merged later), the shell as exterior.
  const all = items.map(i => i.room).concat(corridor ? [corridor] : []);
  for (const r of all) G.rectPts(r.rect).forEach((p, i, a) => walls.push(L.seg(p, a[(i + 1) % 4], st.int)));
  G.rectPts(bbox).forEach((p, i, a) => walls.push(L.seg(p, a[(i + 1) % 4], "ext")));

  // Adjacency and doors.
  const edges = [];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const e = sharedEdge(all[i].rect, all[j].rect, 3.5);
    if (e) edges.push({ a: all[i], b: all[j], e });
  }
  let chosen;
  if (corridor) {
    // Spine: every room opens onto the corridor, and nowhere else.
    chosen = edges.filter(e => e.a === corridor || e.b === corridor);
  } else {
    const roots = all.filter(r => r.kind === "core" || depthOf(r.band) === 0);
    chosen = connect(all, edges, st, rng, roots.length ? [roots[0]] : []);
  }
  for (const c of chosen) {
    const big = (c.a.w >= 5 && c.b.w >= 5) || c.a.kind === "corridor" && c.b.w >= 5 || c.b.kind === "corridor" && c.a.w >= 5;
    const kind = c.a.kind === "core" || c.b.kind === "core" ? "opening" : kindFor(st, c.a, c.b);
    doors.push(Object.assign(doorOn(c.e, undefined, big && kind !== "vault" ? 5 : 3, kind, rng), { a: c.a.room === undefined ? c.a : c.a, b: c.b }));
  }
  return { lvl, title: LEVEL_NAME[lvl], rooms, extras, walls, doors, bbox, exterior: { kind: "rect", r: bbox }, edges, core, corridor };
}

// Radial plan: a hub with pods on short bridges. Nothing touches anything
// else, so every route really does pass back through the hub.
function planRadial(model, rooms, lvl, rng, multi) {
  const walls = [], doors = [], extras = [];
  const sorted = rooms.slice().sort((a, b) => depthOf(a.band) - depthOf(b.band) || b.w - a.w);
  const pods = sorted.map(r => ({ room: r, rad: Math.max(8, Math.sqrt(r.w * UNIT_PLAN / Math.PI)) }));
  const hubR = Math.max(9, 6 + pods.length * 0.9) + (multi ? 2 : 0);
  // Angular widths, then alternate pods left and right of the front.
  // Push the pods outward until they fit round the hub with the street door
  // left clear, rather than letting the last two collide at the back.
  const FRONT = Math.PI / 2;
  let orbitBase = hubR + 4;
  const widthOf = p => 2 * Math.asin(Math.min(0.99, (p.rad + 2) / (orbitBase + p.rad)));
  const totalA = () => pods.reduce((s, p) => s + widthOf(p), 0) + 0.5;
  for (let g = 0; g < 200 && totalA() > 2 * Math.PI; g++) orbitBase += 1.5;
  const slack = (2 * Math.PI - totalA()) / Math.max(1, pods.length);
  const scale = 1;
  let leftA = FRONT + 0.25, rightA = FRONT - 0.25;
  pods.forEach((p, i) => {
    const wA = widthOf(p) + slack;
    let a;
    if (i % 2 === 0) { a = rightA - wA / 2; rightA -= wA; } else { a = leftA + wA / 2; leftA += wA; }
    const orbit = (orbitBase + p.rad) * scale;
    const cx = Math.cos(a) * orbit, cy = Math.sin(a) * orbit;
    Object.assign(p.room, { shape: { kind: "circle", cx, cy, r: p.rad }, frame: { cx, cy, w: p.rad * 1.35, h: p.rad * 1.35, rot: 0 }, pod: { a, orbit } });
    walls.push(L.arc(cx, cy, p.rad, 0, 2 * Math.PI, "ext"));
    // bridge
    const bx0 = Math.cos(a) * hubR, by0 = Math.sin(a) * hubR, bx1 = Math.cos(a) * (orbit - p.rad), by1 = Math.sin(a) * (orbit - p.rad);
    const nx = -Math.sin(a) * 2.2, ny = Math.cos(a) * 2.2;
    extras.push({ kind: "bridge", band: p.room.band, shape: { kind: "poly", pts: [[bx0 + nx, by0 + ny], [bx1 + nx, by1 + ny], [bx1 - nx, by1 - ny], [bx0 - nx, by0 - ny]] } });
    walls.push(L.seg([bx0 + nx, by0 + ny], [bx1 + nx, by1 + ny], "glass"), L.seg([bx0 - nx, by0 - ny], [bx1 - nx, by1 - ny], "glass"));
    doors.push({ x: bx1, y: by1, ang: a * 180 / Math.PI + 90, w: 3.6, kind: kindFor(STYLE.radial, p.room, p.room), a: p.room, b: "hub" });
    doors.push({ x: bx0, y: by0, ang: a * 180 / Math.PI + 90, w: 4.4, kind: "opening" });
  });
  const hub = { kind: multi ? "core" : "hub", band: "public", shape: { kind: "circle", cx: 0, cy: 0, r: hubR }, frame: { cx: 0, cy: 0, w: hubR * 1.3, h: hubR * 1.3, rot: 0 } };
  extras.unshift(hub);
  walls.push(L.arc(0, 0, hubR, 0, 2 * Math.PI, "ext"));
  let minX = -hubR, maxX = hubR, minY = -hubR, maxY = hubR;
  for (const r of rooms) { const s = r.shape; minX = Math.min(minX, s.cx - s.r); maxX = Math.max(maxX, s.cx + s.r); minY = Math.min(minY, s.cy - s.r); maxY = Math.max(maxY, s.cy + s.r); }
  const bbox = { x: minX - 2, y: minY - 2, w: maxX - minX + 4, h: maxY - minY + 4 + 6 };
  return { lvl, title: LEVEL_NAME[lvl], rooms, extras, walls, doors, bbox, exterior: { kind: "hub", r: hubR }, hub, core: multi ? hub : null };
}

function planView(model, rng) {
  const byLvl = {};
  for (const r of model.rooms) (byLvl[r.lvl] ||= []).push(r);
  // A floor of one room that is not a basement or a roof folds into the floor
  // nearest the street, so the plan never shows a lonely single-room sheet.
  for (const k of Object.keys(byLvl)) if (byLvl[k].length === 1 && +k === 1) { (byLvl[0] ||= []).push(...byLvl[k]); byLvl[k][0].lvl = 0; delete byLvl[k]; }
  if (!byLvl[0]) { const first = Object.keys(byLvl).sort((a, b) => Math.abs(a) - Math.abs(b))[0]; byLvl[0] = byLvl[first]; byLvl[0].forEach(r => r.lvl = 0); delete byLvl[first]; }
  const order = [0, 1, 2, -1].filter(k => byLvl[k] && byLvl[k].length);
  const multi = order.length > 1;
  const levels = order.map(k => model.rings === "radial" ? planRadial(model, byLvl[k], k, rng.fork("lvl" + k), multi) : planLevel(model, byLvl[k], k, rng.fork("lvl" + k), multi));
  return { kind: "plan", levels, rng, st: M.own(STYLE, model.rings) || STYLE.hard };
}

// --- Entry points, skips, circulation ---------------------------------------------
// Placed after the rooms, on whichever level the room landed. These are the
// generator's own facts drawn into the building: nothing new is rolled here.
L._exteriorSides = (level, room) => exteriorSides(level, room);
function exteriorSides(level, room) {
  const R = room.rect, B = level.bbox, E = 0.05, out = [];
  if (!R) return out;
  if (Math.abs(R.y + R.h - (B.y + B.h)) < E) out.push({ side: "bottom", e: { o: "h", c: B.y + B.h, lo: R.x, hi: R.x + R.w } });
  if (Math.abs(R.x - B.x) < E) out.push({ side: "left", e: { o: "v", c: B.x, lo: R.y, hi: R.y + R.h } });
  if (Math.abs(R.x + R.w - (B.x + B.w)) < E) out.push({ side: "right", e: { o: "v", c: B.x + B.w, lo: R.y, hi: R.y + R.h } });
  if (Math.abs(R.y - B.y) < E) out.push({ side: "top", e: { o: "h", c: B.y, lo: R.x, hi: R.x + R.w } });
  return out;
}
const OUT = { bottom: [0, 1], top: [0, -1], left: [-1, 0], right: [1, 0] };
// A crowded wall: no spot on the room's stretch of it is 7 ft clear of the
// outside doors already there. The door goes where it is farthest from them
// (nearest its own spot on a tie), so it never sits on top of another.
function clearestOn(e, w, kind, exts, along) {
  const lo = e.lo + w / 2 + 0.3, hi = e.hi - w / 2 - 0.3, mk = at => e.o === "v" ? { x: e.c, y: at, ang: 90, w, kind } : { x: at, y: e.c, ang: 0, w, kind };
  const want = doorOn(e, along, w, kind), wantAt = e.o === "v" ? want.y : want.x;
  if (hi <= lo) return want;
  let best = null;
  for (let i = 0; i <= 80; i++) {
    const c = mk(lo + (hi - lo) * i / 80), gap = Math.min(...exts.map(q => Math.hypot(q.x - c.x, q.y - c.y)));
    const off = Math.abs((e.o === "v" ? c.y : c.x) - wantAt);
    if (!best || gap > best.gap + 0.01 || (Math.abs(gap - best.gap) <= 0.01 && off < best.off)) best = { c, gap, off };
  }
  return best.c;
}

// A way in the crew can't know from outside. In the player copy it leaves no
// door, gap, skylight or hatch anywhere in the file.
M.vecHidden = v => /can't be known/.test((v && v.know) || "");
M.vecAsks = v => /question/.test((v && v.know) || "");

// --- Where each way in lands ---------------------------------------------------------
// A way in resolves to a landing: the room it reaches (or none), the floor it
// is on, and what gets you there. A schema 2 roll says so in its fields
// (vectors[i].room, .level: "roof" | "upper" | "street" | "below", and
// optionally .means); an older roll is read from its words by this phrase
// table, the order mattering (the first match wins).
L.WAY_PHRASES = [
  [/\broof ?tops?\b|\broof\b/, "roof", "roof-hatch"],
  [/skylight/, "roof", "skylight"],
  [/cellar|basement|coal chute|sewer|tunnel|drain/, "below", "cellar"],
  [/balcon/, "upper", "balcony"],
  [/catwalk|gantr/, "upper", "catwalk"],
  [/fire escape/, "upper", "fire-escape"],
  [/circular stair|spiral|ladder/, "upper", "spiral-stair"],
  [/secret door|hidden door|false wall/, "street", "secret-door"],
  [/window/, "street", "window"]
];
L.LEVELS = ["roof", "upper", "street", "below"];
L.MEANS = ["door", "secret-door", "window", "fire-escape", "area-steps", "balcony", "catwalk", "spiral-stair", "roof-hatch", "skylight", "cellar", "floor-hatch"];
L.wayLanding = function (v, kind, model) {
  v = v || {};
  const how = String(v.how || "").toLowerCase(), named = /through the (.+?)\./i.exec(v.how || "");
  const out = { kind, room: null, level: "street", means: kind === "front" ? "street-door" : "door", source: "words" };
  if (kind !== "front") {
    if (kind === "service" && named) {
      const n = named[1].trim();
      const hit = L.WAY_PHRASES.find(([re]) => re.test(n.toLowerCase()));
      if (hit) { out.level = hit[1]; out.means = hit[2]; }
      else {
        out.room = n;
        const r = model.rooms.find(q => q.name.toLowerCase() === n.toLowerCase()), info = !r ? M.roomInfoAny(n, model.themeName) : null;
        const lvl = r ? r.lvl : info ? info.lvl : 0;
        out.level = lvl >= 1 ? "upper" : lvl < 0 ? "below" : "street";
      }
    } else {
      const hit = L.WAY_PHRASES.find(([re]) => re.test(how));
      if (hit) { out.level = hit[1]; out.means = hit[2]; }
    }
  }
  // schema 2: the roll's own fields win (M.model warns about any it can't use)
  if (v.room !== undefined || v.level || v.means) {
    out.source = "fields";
    if (v.room !== undefined) out.room = v.room || null;
    if (L.LEVELS.includes(v.level)) out.level = v.level;
    if (L.MEANS.includes(v.means)) out.means = v.means;
  }
  return out;
};

L.entries = function (lay, model, opts = {}) {
  const ents = [];
  const lv0 = lay.levels.find(l => l.lvl === 0) || lay.levels[0];
  const findRoom = name => name ? model.rooms.find(r => r.name.toLowerCase() === String(name).toLowerCase()) : null;
  const pushEnt = (vec, room, level, p, dir, kind, extra) => ents.push(Object.assign({ vec, room, level, x: p[0], y: p[1], dir, kind }, extra || {}));

  // Where a ring-view or radial entrance lands on the outer wall.
  const ringEntry = (room, prefer) => {
    if (lay.circular) {
      const ring = lay.rings[0], a = room ? (room.a0 + room.a1) / 2 : Math.PI / 2;
      return { p: [Math.cos(a) * ring.rout, Math.sin(a) * ring.rout], dir: [Math.cos(a), Math.sin(a)], ang: a * 180 / Math.PI + 90 };
    }
    const O = lay.rings[0].O;
    if (room && room.ring === 0 && room.ringSide) {
      const side = prefer && room.frame ? prefer : room.ringSide;
      const f = room.frame;
      const p = side === "bottom" ? [f.cx, O.y + O.h] : side === "top" ? [f.cx, O.y] : side === "left" ? [O.x, f.cy] : [O.x + O.w, f.cy];
      return { p, dir: OUT[side], ang: side === "bottom" || side === "top" ? 0 : 90 };
    }
    // No outer ring to land on (a one-band building): front below, service to the right.
    if (prefer === "right") return { p: [O.x + O.w, O.y + O.h / 2], dir: [1, 0], ang: 90 };
    return { p: [0, O.y + O.h], dir: [0, 1], ang: 0 };
  };
  // E3: a sheet for a floor a way in names that the building hasn't got (M.outdoors.levels)
  M.outdoors.levels(lay, model, opts);
  // The floor a landing asks for, as this building has it.
  // (the roof: the top floor, or E3's roof sheet; never a walkway, which the back route alone may make)
  const top = lay.levels.reduce((a, l) => (l.lvl >= 0 && (!l.ground || l.ground === "roof") && (!a || l.lvl > a.lvl) ? l : a), null) || lv0;
  const floorFor = level => level === "roof" ? top : level === "upper" ? (lay.levels.filter(l => l.lvl >= 1).sort((a, b) => a.lvl - b.lvl)[0] || null)
    : level === "below" ? (lay.levels.find(l => l.lvl < 0) || null) : lv0;
  const levelOf = r => lay.levels.find(l => l.rooms.includes(r)) || null;
  const spot = (room, part) => M.wayPoint(room, part) || (room.frame ? [room.frame.cx, room.frame.cy] : [room.shape.cx, room.shape.cy]);
  const FIXTURE = { "fire-escape": "fire-escape", "area-steps": "area-steps", "cellar-steps": "area-steps", balcony: "balcony", catwalk: "catwalk", "spiral-stair": "stairs-spiral" };
  const VERTICAL = new Set(["roof-hatch", "skylight", "floor-hatch"]);

  // --- 1. Where each way lands, from one corner of the iso -------------------------
  // The iso looks in from a front corner. Its two far walls stand full height
  // and hide whatever is outside them, so a way in takes a near face, where its
  // stair can be seen, and a face another way already uses on that floor only
  // when nothing else will do. Nothing is built here.
  const decide = corner => {
    const near = corner === "left" ? "left" : "right", far = corner === "left" ? "right" : "left";
    const NEAR = { bottom: 1, [near]: 1 }, usedSides = new Map(), usedRooms = new Set();
    return model.vectors.map((v, i) => {
      const kind = i === 0 ? "front" : i === 1 ? "service" : "back";
      const land = L.wayLanding(v, kind, model), d = { v, kind, land };
      if (lay.kind === "rings") return d;
      // the floor: the named room's own, or the one the landing asks for
      let room = kind === "front" ? null : findRoom(land.room);
      let level = room ? levelOf(room) : floorFor(land.level);
      let means = land.means;
      // a plain door on a floor off the street: a fire escape up, or area steps down
      if (kind !== "front" && means === "door" && level) means = level.lvl >= 1 ? "fire-escape" : level.lvl < 0 ? "area-steps" : "door";
      // E3: a sheet with no rooms of its own (the roof, a walkway, what lies under the
      // street). The way reaches a room of the floor the sheet serves: through a hatch
      // from the tunnel below, a hatch or skylight in the roof, or across the walkway
      // to a hatch down, its stair or balcony on the walkway's edge.
      if (level && level.ground) {
        const base = level.base, below = !!level.under;
        if (below) means = "floor-hatch";
        const vertical = !below && VERTICAL.has(means);
        const deepFirst = kind === "back" || means === "skylight";
        const depthKey = r => (deepFirst ? -depthOf(r.band) : (depthOf(r.band) === 0 ? 10 : 0) + depthOf(r.band)) + (usedRooms.has(r) ? 0.4 : 0);
        const walk = !below && !vertical;
        const used = usedSides.get(level) || new Set();
        const faceCost = sd => (NEAR[sd.side] ? 0 : 10) + (used.has(sd.side) ? 4 : 0) + [near, "bottom", "top", far].indexOf(sd.side);
        const pool = base.rooms.filter(r => r.frame && (!walk || exteriorSides(base, r).length));
        const cost = r => depthKey(r) + (walk ? exteriorSides(base, r).reduce((m, sd) => Math.min(m, faceCost(sd)), Infinity) * 0.15 : 0);
        room = pool.sort((a, b) => cost(a) - cost(b) || b.w - a.w)[0] || base.rooms[0] || null;
        Object.assign(d, { level, means, vertical, room, ground: below ? "below" : level.ground });
        if (walk && room) {
          const sideObj = exteriorSides(base, room).sort((a, b) => faceCost(a) - faceCost(b))[0];
          if (sideObj) { d.sideObj = sideObj; d.hidden = !NEAR[sideObj.side]; used.add(sideObj.side); usedSides.set(level, used); }
        }
        if (room) usedRooms.add(room);
        return d;
      }
      if (!level) {
        // the building has no such floor: a cellar becomes a hatch from below
        // into the ground floor; anything above comes in at street level
        level = lv0;
        if (means === "cellar") means = "floor-hatch";
        else if (/balcony|catwalk|spiral-stair|fire-escape/.test(means)) means = "door";
      } else if (means === "cellar") means = "cellar-steps";
      // a ship is boarded: no fire escapes, area steps or balconies on a hull
      if (model.target === "Ship" && /fire-escape|area-steps|cellar-steps|balcony/.test(means)) means = "door";
      Object.assign(d, { level, means, vertical: VERTICAL.has(means) });
      if (level.hub) {
        // Futurist: pods stand apart round the hub; the door turns toward the viewer
        if (kind !== "front" && !room && level.rooms.length) room = level.rooms.slice().sort((a, b) => (kind === "back" ? depthOf(b.band) - depthOf(a.band) : depthOf(a.band) - depthOf(b.band)))[0];
        return Object.assign(d, { room, hub: true, turnTo: corner === "left" ? Math.PI * 0.75 : Math.PI * 0.25 });
      }
      const used = usedSides.get(level) || new Set();
      const prefs = kind === "front" ? ["bottom", near, far, "top"] : kind === "service" ? [near, "bottom", far, "top"] : [near, "bottom", "top", far];
      const faceCost = sd => (NEAR[sd.side] ? 0 : 10) + (used.has(sd.side) ? 4 : 0) + prefs.indexOf(sd.side);
      const bestFace = r => exteriorSides(level, r).reduce((m, sd) => Math.min(m, faceCost(sd)), Infinity);
      if (kind === "front") {
        const cands = lv0.rooms.concat(lv0.corridor ? [lv0.corridor] : []).filter(r => exteriorSides(lv0, r).some(sd => sd.side === "bottom"));
        // app-side: a front vector that names a room on the street floor, with an outside wall to the street, lands on it
        const named = findRoom(land.room), picked = named && cands.includes(named) ? named : null;
        room = picked || lv0.corridor || cands.sort((a, b) => depthOf(a.band) - depthOf(b.band) || b.w - a.w)[0] || lv0.rooms[0];
      } else if (!room || (!d.vertical && !exteriorSides(level, room).length)) {
        // No room named (or it has no outside wall). The back route reaches as
        // deep as it can, the service side the shallowest room staff work in.
        // A room whose outside walls all face away from the viewer counts as
        // less deep (the back route will give up a band to be seen; the service
        // side never), and a room another way already uses as a little less.
        const deepFirst = kind === "back" || means === "skylight";
        const hidden = r => !d.vertical && bestFace(r) >= 10;
        const depthKey = r => (deepFirst ? -depthOf(r.band) : (depthOf(r.band) === 0 ? 10 : 0) + depthOf(r.band))
          + (hidden(r) ? (kind === "back" ? 1.5 : 0.6) : 0) + (usedRooms.has(r) ? 0.4 : 0);
        const pool = level.rooms.filter(r => d.vertical || exteriorSides(level, r).length);
        room = pool.sort((a, b) => depthKey(a) - depthKey(b) || b.w - a.w)[0] || level.rooms[0];
      }
      d.room = room;
      if (room && !d.vertical) {
        const sideObj = exteriorSides(level, room).sort((a, b) => faceCost(a) - faceCost(b))[0];
        if (sideObj) { d.sideObj = sideObj; d.hidden = !NEAR[sideObj.side]; used.add(sideObj.side); usedSides.set(level, used); }
      }
      if (room) usedRooms.add(room);
      return d;
    });
  };
  // The corner: the one that shows the service side and what stands outside
  // it (the front is always seen). The back route never chooses it, so the
  // player copy, which doesn't have it, is drawn from the same corner.
  const cost = plan => plan.filter(d => d.kind === "service" && d.hidden).reduce((s, d) => s + (FIXTURE[d.means] ? 2 : 1), 0);
  let plan = decide("right"), corner = "right";
  if (lay.kind !== "rings" && cost(plan) > 0) { const alt = decide("left"); if (cost(alt) < cost(plan)) { plan = alt; corner = "left"; } }
  lay.isoCorner = corner;

  // --- 2. Build: doors, what stands outside them, hatches, arrows ---------------
  plan.forEach(d => {
    const { v, kind, land } = d;
    // A back route the crew can't know adds nothing to the player copy: no door, hatch,
    // stair, branch off a tunnel, gap in a wall, sheet or arrow (OD.levels makes no sheet
    // for it either). Every reader of lay.entries skips it there too.
    const sealed = !!opts.player && kind === "back" && M.vecHidden(v);
    if (sealed) return;
    if (lay.kind === "rings") {
      let room = null;
      if (kind === "front") room = model.rooms.filter(r => r.ring === 0 && r.ringSide === "bottom").sort((a, b) => b.w - a.w)[0] || model.rooms.find(r => r.ring === 0);
      if (kind === "service") room = findRoom(land.room);
      const ring0 = model.rooms.filter(r => r.ring === 0);
      const frontRoom = model.rooms.filter(r => r.ring === 0 && r.ringSide === "bottom").sort((a, b) => b.w - a.w)[0];
      const sideScore = r => lay.circular ? Math.abs(Math.atan2(Math.sin((r.a0 + r.a1) / 2), Math.cos((r.a0 + r.a1) / 2))) : (r.ringSide === "right" ? 0 : r.ringSide === "left" ? 1 : 2);
      const landing = room && room.ring === 0 && (kind !== "service" || room !== (lay.circular ? ring0.slice().sort((a, b) => b.w - a.w)[0] : frontRoom)) ? room
        : (kind === "service" ? ring0.filter(r => lay.circular ? r !== ring0.slice().sort((a, b) => b.w - a.w)[0] : r.ringSide !== "bottom").sort((a, b) => sideScore(a) - sideScore(b))[0] || ring0[0] : null);
      const e = kind === "back"
        ? (lay.circular ? { p: [0, -lay.rings[0].rout], dir: [0, -1], ang: 0 } : { p: [lay.rings[0].O.x + lay.rings[0].O.w * 0.82, lay.rings[0].O.y], dir: [0, -1], ang: 0 })
        : ringEntry(landing, kind === "service" ? (landing && landing.ringSide === "bottom" ? "bottom" : landing ? null : "right") : "bottom");
      if (kind !== "back") lay.levels[0].doors.push({ x: e.p[0], y: e.p[1], ang: e.ang, w: kind === "front" ? 5 : 3.2, kind: kind === "front" ? "ext-double" : "ext", ext: true });
      pushEnt(v, room || landing, lay.levels[0], e.p, e.dir, kind, { means: land.means, want: land });
      return;
    }
    const { level, means, room } = d;
    const fixture = (part, x, y, rot, o) => { if (!sealed) (level.fixtures ||= []).push(Object.assign({ part, x, y, rot, way: kind }, o || {})); };
    // E3: onto a sheet of its own (M.outdoors.levels)
    if (d.ground && room) {
      if (d.ground === "below") {
        if (!sealed) room.hatch = true;
        const [hx, hy] = spot(room, "hatch"), t = M.outdoors.below(level, hx, hy, { kind, fixture: !sealed });
        pushEnt(v, room, level, t.tip, t.dir, kind, { means, from: "below", via: level.under, want: land });
        return;
      }
      if (d.vertical) {
        if (!sealed) { if (means === "skylight") room.skylight = true; else room.roofHatch = true; }
        const p = spot(room, means);
        fixture(means === "skylight" ? "skylight" : "roof-hatch", p[0], p[1], 0);
        pushEnt(v, room, level, p, [0, 0], kind, { means, from: "above", want: land });
        return;
      }
      // across the walkway, and down a hatch into the room
      if (!sealed) room.roofHatch = true;
      if (d.sideObj && !sealed) { const p = M.outdoors.walkway(level, d.sideObj); fixture("roof-hatch", p[0], p[1], 0); }
    }
    // a secret door is drawn as one only where it is known: the player copy's service side
    // (which costs a question) gets the plain exterior door
    const secret = means === "secret-door" && !(opts.player && kind === "service");

    if (d.hub) {
      // The front comes over the hub's own bridge; the others land on the pod
      // they name, through its outer half.
      const lv = level, R = lv.hub.shape.r;
      if (kind === "front" || !room) {
        const a = Math.PI / 2, p = [Math.cos(a) * R, Math.sin(a) * R];
        lv.doors.push({ x: p[0], y: p[1], ang: a * 180 / Math.PI + 90, w: 5, kind: "ext", ext: true });
        if (!lv.extras.some(e => e.kind === "bridge" && e.front)) lv.extras.push({ kind: "bridge", band: "public", front: true, shape: { kind: "poly", pts: [[-2.5, R - 0.5], [2.5, R - 0.5], [2.5, lv.bbox.y + lv.bbox.h], [-2.5, lv.bbox.y + lv.bbox.h]] } });
        pushEnt(v, null, lv, p, [0, 1], kind, { means: "street-door", want: land });
        return;
      }
      const s = room.shape, a0 = room.pod ? room.pod.a : Math.atan2(s.cy, s.cx);
      if (means === "roof-hatch" || means === "skylight") {
        if (!sealed) { if (means === "skylight") room.skylight = true; else room.roofHatch = true; }
        pushEnt(v, room, lv, spot(room, means), [0, 0], kind, { means, from: "above", want: land });
        return;
      }
      if (means === "floor-hatch") { if (!sealed) room.hatch = true; pushEnt(v, room, lv, spot(room, "hatch"), [0, 0], kind, { means, from: "below", want: land }); return; }
      const turn = Math.atan2(Math.sin(d.turnTo - a0), Math.cos(d.turnTo - a0));
      let a = a0 + Math.max(-1.2, Math.min(1.2, turn));
      // a second way into one pod moves round it, clear of the outside door already there
      const onPod = t => [s.cx + Math.cos(t) * s.r, s.cy + Math.sin(t) * s.r], gapAt = t => Math.min(Infinity, ...lv.doors.filter(q => q.ext).map(q => Math.hypot(q.x - onPod(t)[0], q.y - onPod(t)[1])));
      if (gapAt(a) < 7) {
        let best = { t: a, g: gapAt(a) };
        for (let i = 1; i <= 24; i++) for (const t of [a + i * 0.1, a - i * 0.1]) { const g = gapAt(t); if (Math.abs(t - a0) <= 1.2 + 1e-9 && g > best.g + 0.01 && best.g < 7) best = { t, g }; }
        a = best.t;
      }
      const p = onPod(a), dir = [Math.cos(a), Math.sin(a)], rot = a * 180 / Math.PI - 90;
      if (!sealed) lv.doors.push({ x: p[0], y: p[1], ang: a * 180 / Math.PI + 90, w: 3.2, kind: secret ? "secret" : "ext", ext: true });
      const fx = FIXTURE[means];
      let tip = p;
      if (fx) {
        const depth = fx === "catwalk" ? 7 : fx === "stairs-spiral" ? 3.2 : 0, reach = fx === "catwalk" ? 13.5 : fx === "stairs-spiral" ? 6 : 4.2;
        fixture(fx, p[0] + dir[0] * depth, p[1] + dir[1] * depth, fx === "catwalk" ? rot + 90 : fx === "stairs-spiral" ? 0 : rot, fx === "catwalk" ? { w: 12 } : {});
        tip = [p[0] + dir[0] * reach, p[1] + dir[1] * reach];
      }
      pushEnt(v, room, lv, tip, dir, kind, { means, want: land });
      return;
    }

    if (!room) { pushEnt(v, null, level, [0, level.bbox.y + level.bbox.h], [0, 1], kind, { means, want: land }); return; }
    // from above or below: a hatch or skylight in the room itself, and the
    // arrow lands on it
    if (d.vertical) {
      if (!sealed) { if (means === "skylight") room.skylight = true; else if (means === "roof-hatch") room.roofHatch = true; else room.hatch = true; }
      pushEnt(v, room, level, spot(room, means === "floor-hatch" ? "hatch" : means), [0, 0], kind, { means, from: means === "floor-hatch" ? "below" : "above", want: land });
      return;
    }
    const sideObj = d.sideObj;
    if (!sideObj) { pushEnt(v, room, level, [room.frame.cx, level.bbox.y + level.bbox.h], [0, 1], kind, { means, want: land }); return; }
    const side = sideObj.side, out = OUT[side];
    const doorKind = secret ? "secret" : kind === "front" ? "ext-double" : "ext", w = kind === "front" ? 5 : 3.2;
    // the door sits toward one end of a wall that takes a stair beside it,
    // and clear of any outside door already on that floor
    const along = /fire-escape|area-steps|cellar-steps/.test(means) ? 0.25 : 0.5;
    const exts = level.doors.filter(q => q.ext);
    const door = [along, 0.78, 0.22, 0.92, 0.08].map(t => doorOn(sideObj.e, t, w, doorKind)).find(c => !exts.some(q => Math.hypot(q.x - c.x, q.y - c.y) < 7)) || clearestOn(sideObj.e, w, doorKind, exts, along);
    door.ext = true;
    if (!sealed) level.doors.push(door);
    // what gets you there, outside the wall: drawn with its back to the wall
    const rot = { bottom: 0, top: 180, left: 90, right: -90 }[side];
    let tip = [door.x, door.y];
    const px = (dist, lat) => [door.x + out[0] * dist - out[1] * lat, door.y + out[1] * dist + out[0] * lat];
    if (means === "fire-escape" || means === "area-steps" || means === "cellar-steps") {
      // the flight runs along the wall, toward the longer stretch of it
      const run = Math.max(1, sideObj.e.hi - sideObj.e.lo), dirAlong = (side === "bottom" || side === "left") ? 1 : -1;
      const frac = ((sideObj.e.o === "h" ? door.x : door.y) - sideObj.e.lo) / run;
      fixture(means === "fire-escape" ? "fire-escape" : "area-steps", door.x, door.y, rot, { mirror: frac > 0.5 ? -dirAlong : dirAlong });
      tip = px(4.2, 0);
    } else if (means === "balcony") { fixture("balcony", door.x, door.y, rot); tip = px(3.4, 0); }
    else if (means === "catwalk") { fixture("catwalk", ...px(7, 0), rot + 90, { w: 12 }); tip = px(13.5, 0); }
    else if (means === "spiral-stair") { fixture("stairs-spiral", ...px(3.3, 0), 0); tip = px(6, 0); }
    // [interpretation] A way in on a wall the iso looks at from behind (the back wall, or the
    // far side wall) would stand hidden behind that wall, full height. The iso cuts the wall
    // down there instead (M.iso: lv.cutaways), as it cuts the near walls: just wide enough
    // to show the door, what stands outside it and where the arrow lands. Never for a way
    // the copy doesn't draw.
    if (d.hidden && !sealed) {
      const pts = [[door.x - out[1] * w / 2, door.y + out[0] * w / 2], [door.x + out[1] * w / 2, door.y - out[0] * w / 2], tip];
      for (const f of (level.fixtures || []).filter(f => f.way === kind)) {
        const a = (f.rot || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
        for (const pc of M.own(M.PARTS, f.part).draw(f)) {
          const box = pc.t === "rect" ? [pc.x, pc.y, pc.x + pc.w, pc.y + pc.h] : pc.t === "circle" ? [pc.cx - pc.rad, pc.cy - pc.rad, pc.cx + pc.rad, pc.cy + pc.rad] : null;
          if (box) for (const [u, q] of [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]]) pts.push([f.x + u * c - q * sn, f.y + u * sn + q * c]);
        }
      }
      (level.cutaways ||= []).push({ side, pts });
    }
    pushEnt(v, room, level, tip, out, kind, { means, side, want: land });
  });
  M.outdoors.finish(lay);
  return ents;
};

L.links = function (lay, model) {
  const out = [];
  const byName = n => model.rooms.find(r => r.name === n);
  const levelOf = r => lay.levels.find(l => l.rooms.includes(r));
  for (const s of model.skips) {
    const a = byName(s.from), b = byName(s.to);
    if (!a || !b || !a.frame || !b.frame) continue;
    const la = levelOf(a), lb = levelOf(b);
    out.push({ kind: "skip", a, b, la, lb, via: s.via, vertical: la !== lb });
  }
  for (const p of model.pairs) {
    const a = byName(p.answer), b = byName(p.lock);
    if (a && b && a.frame && b.frame) out.push({ kind: "pair", a, b, la: levelOf(a), lb: levelOf(b), vertical: levelOf(a) !== levelOf(b) });
  }
  return out;
};

// A Ship (seeded to the Nightbreaker, p.402) is the same building inside a
// hull: a deck margin all round, a rounded stern to the left, a raked bow to
// the right. The quay sits where the street would be.
L.hull = function (B) {
  const m = 5, x0 = B.x - m, x1 = B.x + B.w + m, y0 = B.y - m, y1 = B.y + B.h + m, cy = (y0 + y1) / 2, h = y1 - y0;
  const bow = Math.max(12, h * 0.55), r = h / 2;
  const outer = [], inner = [];
  const ring = (dx, dy, pad) => {
    const pts = [[x0 + r * 0.6 - pad, y0 - pad], [x1 - pad * 0.3, y0 - pad], [x1 + bow + pad * 1.6, cy], [x1 - pad * 0.3, y1 + pad], [x0 + r * 0.6 - pad, y1 + pad]];
    for (let a = Math.PI / 2; a <= Math.PI * 1.5 + 0.01; a += Math.PI / 12) pts.push([x0 + r * 0.6 - pad + Math.cos(a) * (r * 0.6 + pad), cy + Math.sin(a) * (r + pad)]);
    return pts;
  };
  return { outer: ring(0, 0, 1.4), inner: ring(0, 0, 0), bbox: { x: x0 - r * 0.6 - 2, y: y0 - 2, w: x1 + bow - x0 + r * 0.6 + 6, h: h + 4 } };
};

L.build = function (model, view, rng, opts = {}) {
  const lay = view === "plan" ? planView(model, rng) : (model.rings === "radial" ? ringCircle(model, rng) : ringRect(model, rng));
  if (model.target === "Ship") for (const lv of lay.levels) {
    lv.hull = L.hull(lv.bbox);
    // the site grows to hold the hull
    const hb = lv.hull.bbox;
    lv.siteBox = { x: Math.min(lv.bbox.x, hb.x), y: Math.min(lv.bbox.y, hb.y), w: Math.max(lv.bbox.x + lv.bbox.w, hb.x + hb.w) - Math.min(lv.bbox.x, hb.x), h: Math.max(lv.bbox.y + lv.bbox.h, hb.y + hb.h) - Math.min(lv.bbox.y, hb.y) };
  }
  // E2: is it drawn out of doors? (decided before the ways in land: a roof route on an
  // open-air site comes down onto its top deck, not onto a roof it hasn't got)
  if (lay.kind === "plan") lay.open = M.outdoors.formFor(model, lay);
  lay.entries = L.entries(lay, model, opts);
  lay.links = L.links(lay, model);
  for (const lv of lay.levels) lv.walls = L.finishWalls(lv.walls, lv.doors);
  M.outdoors.apply(lay, model);
  return lay;
};

// ---- src/model.js ----
// =============================================================================
// model — generator output → the kit's building model, plus furnishing
// =============================================================================
// Input is the vault generator's `o` exactly as generate() returns it. Every
// field is optional except rooms; a bare { rooms: [{ name, band }] } draws.
// Unknown names and bands come back as warnings with the valid choices, the
// same contract as the figure kit.

M.model = function (o, W) {
  if (!o || typeof o !== "object") throw new Error("B68Map: expected the generator's location object");
  const rooms = M.list(o.rooms, W, "rooms").map((r, i) => {
    if (typeof r === "string") r = { name: r, band: "public" };
    if (!r || typeof r !== "object") r = { name: r == null ? "" : String(r), band: "public" };
    if (typeof r.name !== "string" || !r.name) {
      const name = r.name != null && r.name !== "" ? String(r.name) : "Room " + (i + 1);
      M.warn(W, `room ${i + 1}: ${r.name != null && r.name !== "" ? "its name isn't text" : "it has no name"} — called "${name}"`);
      r = Object.assign({}, r, { name });
    }
    let band = r.band;
    if (!M.BANDS.includes(band)) { M.warn(W, `room "${r.name}": band "${band}" is not one of ${M.BANDS.join(", ")} — drawn as public`); band = "public"; }
    const info = M.roomInfo(r.name, o.themeName, r.mix);
    if (!info) M.warn(W, `room "${r.name}" is not in the catalogue — drawn empty. Add it to M.ROOMS in catalogue.js`);
    const dress = M.own(M.own(M.DRESS, o.target), r.name);
    const arch = dress || (info ? info.arch : "empty");
    return {
      id: "r" + i, n: 0, name: r.name, band, arch, dressed: !!dress,
      // app-side: a roll's own whole-number w (2..12) and lvl (-1..2) win over the catalogue's
      w: Number.isInteger(r.w) && r.w >= 2 && r.w <= 12 ? r.w : info ? info.w : 2.5,
      lvl: Number.isInteger(r.lvl) && r.lvl >= -1 && r.lvl <= 2 ? r.lvl : info ? info.lvl : 0,
      detail: r.detail || "", mix: r.mix || null,
      isTarget: !!r.isTarget, obstacle: r.obstacle || null, loot: r.loot || null,
      featured: !!r.featured, connects: r.connects || null,
      pairedWith: r.pairedWith || null, holdsAnswerTo: r.holdsAnswerTo || null
    };
  });
  if (!rooms.length) M.warn(W, "no rooms: the location has an empty o.rooms");
  rooms.sort((a, b) => M.BANDS.indexOf(a.band) - M.BANDS.indexOf(b.band));
  rooms.forEach((r, i) => { r.n = i + 1; });

  // schema 2 ways in: where each lands, if the generator says (L.wayLanding)
  M.list(o.vectors, W, "vectors").slice(0, 3).forEach((v, i) => {
    if (!v || typeof v !== "object") return;
    const which = ["front", "service side", "back route"][i];
    if (v.room && !rooms.some(r => r.name.toLowerCase() === String(v.room).toLowerCase())) M.warn(W, `the ${which}'s room "${v.room}" is not one of this roll's rooms — it lands by its level instead`);
    if (v.level && !M.layout.LEVELS.includes(v.level)) M.warn(W, `the ${which}'s level "${v.level}" is not one of ${M.layout.LEVELS.join(", ")} — read from its words instead`);
    if (v.means && !M.layout.MEANS.includes(v.means)) M.warn(W, `the ${which}'s means "${v.means}" is not one of ${M.layout.MEANS.join(", ")} — read from its words instead`);
  });

  const styleName = o.styleName || (o.style ? String(o.style).split(".")[0] : null);
  let rings = (o.geometry && o.geometry.rings) || M.own(M.GEOMETRY, styleName) || "hard";
  if (!M.own(M.layout.STYLE, rings)) { M.warn(W, `geometry.rings "${rings}" is unknown — one of ${Object.keys(M.layout.STYLE).join(", ")}; drawn as hard`); rings = "hard"; }
  const colour = M.own(M.COLOURS, o.colour) ? o.colour : null;
  if (o.colour && !colour) M.warn(W, `colour "${o.colour}" is not one of the twelve printed schemes — using grey and charcoal`);
  if (o.open != null && o.open !== true && o.open !== false && !M.own(M.outdoors.FORMS, o.open)) M.warn(W, `open "${o.open}" is not one of true, false, ${Object.keys(M.outdoors.FORMS).join(", ")} — drawn as its target type says`);

  return {
    name: o.name || "Unnamed location", target: o.target || "", district: o.district || "",
    themeName: o.themeName || "", mixName: o.mixName || null, styleName: styleName || "", rings,
    approach: o.approachName || (o.approach && o.approach.n) || "", gambit: o.approach && o.approach.gambit || "",
    targetWhat: o.targetWhat || "", targetRoom: o.targetRoom || "", colour: colour || "grey and charcoal",
    faction: o.faction || "", factionTier: o.factionTier || 0,
    phys: o.physThreatName ? { name: o.physThreatName, text: o.physThreatText || "" } : null,
    soc: o.socThreatName ? { name: o.socThreatName, text: o.socThreatText || "" } : null,
    vectors: M.list(o.vectors).slice(0, 3).map((v, i) => {
      // a way in that isn't one (a word, a number, nothing) is its words or none; one missing
      // its name or what is known of it gets the book's
      if (!v || typeof v !== "object") v = { how: typeof v === "string" ? v : "" };
      return v.n == null || v.know == null || v.how == null || v.cost == null
        ? Object.assign({}, v, { n: v.n == null ? ["Front", "Service side", "Back route"][i] : v.n, know: v.know == null ? "" : v.know, how: v.how == null ? "" : v.how, cost: v.cost == null ? "" : v.cost }) : v;
    }),
    skips: M.list(o.skips, W, "skips").filter(k => k && typeof k === "object"), circulation: M.list(o.circulation, W, "circulation").filter(c => c && typeof c === "object"),
    pairs: rooms.filter(r => r.pairedWith).map(r => ({ lock: r.name, answer: r.pairedWith })),
    time: o.timeOfDay || "", weather: o.weather || "", street: o.namedStreet || "",
    security: o.security || "", geometryNote: o.geometry && o.geometry.note || "",
    seed: o.seed, rooms,
    // out of doors (outdoors.js): o.open false draws the building, a form name that form;
    // the street type and props say what lies under the street (E3)
    openWant: o.open === undefined || o.open === null ? null : o.open, open: null,
    streetType: o.streetType || "", props: M.list(o.props, null, "props", true).slice()
  };
};

// --- Furnishing -----------------------------------------------------------------
// The room's frame is a rect in the room's own coordinates (rotated for ring
// arcs and radial pods). Its recipe places parts; anything that would poke out
// of the frame is shrunk once and then dropped, so recipes can be generous.
function fits(pl, part, R) {
  const w = pl.w || part.size[0], h = pl.h || part.size[1], a = (pl.rot || 0) * Math.PI / 180;
  const ew = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a)), eh = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
  return { ok: pl.x - ew / 2 >= R.x - 0.4 && pl.x + ew / 2 <= R.x + R.w + 0.4 && pl.y - eh / 2 >= R.y - 0.4 && pl.y + eh / 2 <= R.y + R.h + 0.4, ew, eh };
}
const CIRC_PART = { "circular stairs and ladders": "stairs-spiral", "a secret door": null, "catwalks": "catwalk", "skylights": "skylight", "a balcony": null, "a cellar": "hatch" };

// Parts a room should only have one of. An L-shaped ring room furnishes
// every straight run; the second and later runs leave these out.
const UNIQUE = new Set(["vault-door", "stage", "screen", "bed-round", "piano", "desk-big", "pool", "dj-booth", "fireplace", "apparatus", "trefoil", "sofa-curve", "bed", "plasmovision", "chandelier", "boiler", "dance-floor", "sculpture"]);

M.furnish = function (room, rng, W, extraParts) {
  const frames = (room.frames && room.frames.length ? room.frames : [room.frame]).filter(Boolean);
  if (!frames.length) return null;
  const recipe = M.own(M.ARCH, room.arch);
  if (!recipe) M.warn(W, `archetype "${room.arch}" has no recipe in parts.js`);
  const groups = [];
  frames.forEach((f, fi) => {
    if (fi > 0 && Math.max(f.w, f.h) < 11) return;
    const { rot, R } = M.furnishFrame(f);
    if (R.w < 3 || R.h < 3) return;
    let pls = recipe ? recipe(R, rng) : [];
    pls = pls.flat().filter(p => p && !p.skip && !(fi > 0 && UNIQUE.has(p.part)));
    if (extraParts && fi === 0) pls = pls.concat(extraParts(R));
    const kids = [];
    for (const pl of pls) {
      const part = M.own(M.PARTS, pl.part);
      if (!part) { M.warn(W, `part "${pl.part}" is not registered`); continue; }
      let s = 1;
      const fit = fits(pl, part, R);
      if (!fit.ok) {
        s = Math.min(R.w / fit.ew, R.h / fit.eh, 0.8);
        if (s < 0.55) continue;
        pl.x = Math.min(Math.max(pl.x, R.x + fit.ew * s / 2), R.x + R.w - fit.ew * s / 2);
        pl.y = Math.min(Math.max(pl.y, R.y + fit.eh * s / 2), R.y + R.h - fit.eh * s / 2);
      }
      kids.push(P.g(part.draw(pl), { tf: { x: pl.x, y: pl.y, rot: pl.rot || 0, s }, opacity: pl.opacity, cls: "fx-" + pl.part }));
    }
    groups.push(P.g(kids, { tf: { x: f.cx, y: f.cy, rot }, cls: "furniture", room: room.id }));
  });
  return P.g(groups, { cls: "room-furniture" });
};

// The frame a room is furnished in. Long thin runs are furnished along their
// length: the frame turns so the recipe always sees a landscape room with its
// "top" against the outer wall. toWorld maps a point in it back onto the plan.
M.furnishFrame = f => {
  let fw = f.w, fh = f.h, rot = f.rot || 0;
  if (fh > fw * 1.15 && !rot) { fw = f.h; fh = f.w; rot = f.side === "left" ? -90 : 90; }
  else if (f.side === "bottom" && !f.rotKeep) rot = 180;
  const R = { x: -fw / 2 + 1.2, y: -fh / 2 + 1.2, w: fw - 2.4, h: fh - 2.4 };
  const a = rot * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  return { fw, fh, rot, R, toWorld: (x, y) => [f.cx + x * c - y * sn, f.cy + x * sn + y * c] };
};
// Where a way in from above or below comes through a room's ceiling or floor,
// in the room's furnishing frame, so the arrow lands on the hatch it draws.
M.WAY_SPOT = { "roof-hatch": R => [R.x + 2.4, R.y + 3.2], hatch: R => [R.x + 2.5, R.y + R.h - 2.5], skylight: () => [0, 0] };
M.wayPoint = (room, part) => {
  const f = ((room.frames && room.frames.length ? room.frames : [room.frame]).filter(Boolean))[0];
  if (!f) return null;
  const F = M.furnishFrame(f), [x, y] = M.own(M.WAY_SPOT, part)(F.R);
  return F.toWorld(x, y);
};

// Circulation the generator put in a room (o.rooms[].connects), and the
// back route's skylight or cellar, drawn as real fixtures in that room.
M.circulationParts = room => R => {
  const out = [];
  const add = name => out.push({ part: name, x: R.x + R.w - 3.2, y: R.y + 3.2, rot: 0 });
  if (room.connects && M.own(CIRC_PART, room.connects)) {
    const p = M.own(CIRC_PART, room.connects);
    if (p === "catwalk") out.push({ part: "catwalk", x: 0, y: 0, rot: R.w >= R.h ? 0 : 90, w: Math.max(R.w, R.h) * 0.9 });
    else if (p === "skylight") out.push({ part: "skylight", x: 0, y: 0, rot: 0 });
    // a cellar's hatch that a way in comes up through sits where that way's arrow lands
    else if (p === "hatch" && room.hatch) { const [x, y] = M.WAY_SPOT.hatch(R); out.push({ part: "hatch", x, y }); }
    else add(p);
  }
  if (room.skylight && room.connects !== "skylights") out.push({ part: "skylight", x: 0, y: 0 });
  if (room.hatch && room.connects !== "a cellar") { const [x, y] = M.WAY_SPOT.hatch(R); out.push({ part: "hatch", x, y }); }
  if (room.roofHatch) { const [x, y] = M.WAY_SPOT["roof-hatch"](R); out.push({ part: "roof-hatch", x, y }); }
  return out;
};

// ---- src/outdoors.js ----
// =============================================================================
// outdoors — open-air sites (E2) and the floors above and below (E3)
// =============================================================================
// E2. An open-air site is a printed building theme drawn without a roof
// (decision 18/10). Its rooms, locks and ways in are the roll's, exactly: the
// plan lays it out as it would a building, and this file then redraws what
// stands between the rooms. A Garage is a car park (when it has decks above the
// street) or a yard, a Warehouse a yard, a Boathouse a quay; Market and
// Autodrome, the two seed-only target rows, are a market and an autodrome. A
// roll can say otherwise: o.open = false draws the building, o.open = "yard"
// (or any form below) draws that form.
//
// E3. The floors become above, street and below: the roofs (2), walkways and
// balconies (1), the street (0), the sewer, culvert, canal or underpass (−1).
// A way in that names a floor the building hasn't got lands on that floor all
// the same: L.entries asks OD.levels for the missing sheet, drawn as what lies
// under the street there (the same reading as the chase strip's, M.belowKind)
// or as the roof or walkway over the top of the building.
//
// Everything here is [interpretation], one table each.

const OD = M.outdoors = {};

// --- Exposure out of doors: the four bands read in the open ---------------------
// [interpretation] Indoors a band says how deep a room sits. Out of doors there is
// no depth to speak of, so a band says how exposed the ground is: who can see
// it, and what you must cross to stand on it. Written down here (and in
// CATALOG.md) before it is drawn. The floor keeps its band's tint; what changes
// is the barrier between two rooms, which is the barrier of the deeper band:
//   public      In the open   seen from the street and the gate; painted lines, no barrier
//   working     In sight      staff ground behind a kerb and a low rail; seen, crossed in a step
//   controlled  Fenced        behind mesh and a gate; seen through, not walked into
//   secure      Under cover   the one thing on the site with walls and a roof: a lock-up,
//                             a cage, a strongroom; the building style's own walls
// Two rooms of one band are one piece of ground: a painted line between them.
OD.EXPOSURE = {
  public: { reading: "In the open", barrier: "line", text: "Seen from the street and the gate. Painted lines, no barrier." },
  working: { reading: "In sight", barrier: "rail", text: "Staff ground behind a kerb and a low rail. Seen from the public ground, crossed in a step." },
  controlled: { reading: "Fenced", barrier: "fence", text: "Behind mesh and a gate. Seen through, not walked into." },
  secure: { reading: "Under cover", barrier: null, text: "The one thing on the site with walls and a roof: a lock-up, a cage, a strongroom. Unseen." }
};

// --- What stands between: the open-air wall kinds ---------------------------------
// h: its height in the iso (ft); th: its thickness; sw: its stroke in the plan;
// dash: dashed in the plan (it stops nobody); see: drawn see-through in the iso.
OD.WALL = {
  line: { h: 0, th: 0.3, sw: 0.22, dash: true, say: "a painted line" },
  rail: { h: 3.2, th: 0.3, sw: 0.32, dash: true, see: true, say: "a kerb and a low rail" },
  fence: { h: 6.5, th: 0.3, sw: 0.4, see: true, say: "mesh on posts" },
  parapet: { h: 3.4, th: 0.9, sw: 0.9, say: "a parapet" },
  quay: { h: 0.7, th: 1.4, sw: 0.9, say: "the quay's edge" }
};
OD.isWall = t => !!OD.WALL[t];

// --- The forms ----------------------------------------------------------------------
// perim: what stands round the street floor; deck: round a floor above it;
// water: the side the water is on; say: one line for the key.
OD.FORMS = {
  "car park": { perim: "parapet", deck: "parapet", ramp: true, park: true, say: "A car park: open decks behind parapets, painted bays, a ramp between the decks." },
  yard: { perim: "fence", deck: "rail", say: "A yard: a fenced lot, open to the sky; anything upstairs is a gantry." },
  quay: { perim: "fence", deck: "rail", water: "top", say: "A quay: a fenced lot open to the sky, its back edge on the water." },
  market: { perim: "rail", deck: "rail", say: "A market: open ground behind a low rail, stalls in the open." },
  autodrome: { perim: "fence", deck: "rail", say: "An autodrome: the track, the pits and the stands, fenced, open to the sky." }
};
// Which target types are drawn open-air, and as what. A Garage with floors above
// the street is a car park (its decks); without, a yard.
OD.TARGETS = { Garage: ["car park", "yard"], Warehouse: ["yard"], Boathouse: ["quay"], Market: ["market"], Autodrome: ["autodrome"] };

// The form a site is drawn as, or null for a building.
OD.formFor = function (model, lay) {
  const want = model.openWant;
  if (want === false || model.target === "Ship") return null;
  if (typeof want === "string") return M.own(OD.FORMS, want) ? want : null;
  const forms = M.own(OD.TARGETS, model.target);
  if (!forms && want !== true) return null;
  if (!forms) return "yard";
  if (forms.length > 1) return lay.levels.some(l => l.lvl >= 1 && !l.ground) ? forms[0] : forms[1];
  return forms[0];
};

// Open-air dressing [interpretation]: what a room is drawn as once it is out of
// doors, where the target type's own dressing (M.DRESS) says nothing. The car
// park's public ground is its parking; a yard keeps its stock in containers.
OD.DRESS = {
  "car park": r => r.band === "public" ? "parking" : null,
  yard: r => r.name === "Storage warehouse" ? "stockyard" : null
};

// --- The pass: a building's plan, redrawn out of doors --------------------------------
// After the plan is laid out and the walls are finished (L.build), every wall on
// a floor at or above the street takes the kind its two sides' bands give it
// (EXPOSURE), the perimeter the form's; a door through a line or a rail is an
// opening. Floors below the street stay as they are: they are under the yard.
const odBand = n => n ? (n.band || "public") : null;
const odDepth = b => b === "core" ? 9 : M.BANDS.indexOf(b);
OD.apply = function (lay, model) {
  const form = lay.kind === "plan" ? lay.open || null : null;
  model.open = form;
  if (!form) return;
  const FM = M.own(OD.FORMS, form);
  lay.open = form; model.open = form;
  // the key says so, under its notes: the form, and how the bands read out of doors
  model.geometryNote = `Out of doors [interpretation]: ${FM.say} Its bands read as exposure: public in the open, working in sight, controlled fenced, secure under cover.` + (model.geometryNote ? " " + model.geometryNote : "");
  for (const r of model.rooms) if (!r.dressed && M.own(OD.DRESS, form)) { const a = M.own(OD.DRESS, form)(r); if (a) r.arch = a; }
  // an autodrome has its track and a market its stalls, whichever rooms the roll gave it:
  // the biggest room on the street that isn't secure, if no room is drawn as one
  const must = { autodrome: "track", market: "market-stalls" }[form];
  if (must && !model.rooms.some(r => r.arch === must)) {
    const lv0 = lay.levels.find(l => l.lvl === 0 && !l.ground), pick = lv0 ? lv0.rooms.filter(r => r.band !== "secure").sort((a, b) => b.w - a.w || M.BANDS.indexOf(a.band) - M.BANDS.indexOf(b.band))[0] : null;
    if (pick) pick.arch = must;
  }
  for (const lv of lay.levels) {
    if (lv.lvl < 0 || lv.ground) continue;
    lv.open = form;
    const nodes = lv.rooms.filter(r => r.shape).map(r => ({ s: r.shape, band: r.band }))
      .concat(lv.extras.filter(e => e.shape).map(e => ({ s: e.shape, band: e.kind === "core" ? "core" : "public" })));
    const at = (x, y) => { for (const q of nodes) if (M.scene.inside(q.s, x, y)) return q; return null; };
    const B = lv.bbox;
    const edge = (x, y) => Math.abs(y - B.y) < 0.3 ? "top" : Math.abs(y - B.y - B.h) < 0.3 ? "bottom" : Math.abs(x - B.x) < 0.3 ? "left" : Math.abs(x - B.x - B.w) < 0.3 ? "right" : null;
    // the kind of wall at a point on it, n its normal
    const kindAt = (w, x, y, nx, ny) => {
      const A = at(x + nx, y + ny), C = at(x - nx, y - ny);
      if (!A && !C) return { t: w.t };
      if (!A || !C) {
        const inn = A || C;
        if (inn.band === "secure" || inn.band === "core") return { t: w.t };
        let t = lv.lvl > 0 ? FM.deck : FM.perim;
        if (FM.water && lv.lvl === 0 && edge(x, y) === FM.water) t = "quay";
        return { t, perim: true };
      }
      const a = odBand(A), c = odBand(C);
      if (a === "secure" || c === "secure" || a === "core" || c === "core") return { t: w.t };
      const d = Math.max(odDepth(a), odDepth(c));
      return { t: odDepth(a) === odDepth(c) ? "line" : OD.EXPOSURE[M.BANDS[d]].barrier };
    };
    const out = [];
    for (const w of lv.walls) {
      // walk the wall, and cut it where the kind changes (a long shell wall runs past many rooms)
      if (w.arc) {
        const len = (w.a1 - w.a0) * w.r, n = Math.max(2, Math.ceil(len / 0.5));
        const ptAt = i => { const a = w.a0 + (w.a1 - w.a0) * i / n; return [w.cx + Math.cos(a) * w.r, w.cy + Math.sin(a) * w.r, Math.cos(a), Math.sin(a), a]; };
        let run = null;
        for (let i = 0; i < n; i++) {
          const p = ptAt(i + 0.5), k = kindAt(w, p[0], p[1], p[2], p[3]), a0 = ptAt(i)[4], a1 = ptAt(i + 1)[4];
          if (run && run.k.t === k.t && !!run.k.perim === !!k.perim) run.a1 = a1;
          else { if (run) out.push(Object.assign({}, w, { a0: run.a0, a1: run.a1, t: run.k.t }, run.k.perim ? { perim: true } : {})); run = { k, a0, a1 }; }
        }
        if (run) out.push(Object.assign({}, w, { a0: run.a0, a1: run.a1, t: run.k.t }, run.k.perim ? { perim: true } : {}));
        continue;
      }
      const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], len = Math.hypot(dx, dy);
      if (len < 0.05) continue;
      const nx = -dy / len, ny = dx / len, n = Math.max(1, Math.ceil(len / 0.5));
      let run = null;
      const flush = () => { if (run) out.push(Object.assign({ a: [w.a[0] + dx * run.s0, w.a[1] + dy * run.s0], b: [w.a[0] + dx * run.s1, w.a[1] + dy * run.s1], t: run.k.t }, run.k.perim ? { perim: true } : {})); };
      for (let i = 0; i < n; i++) {
        const s = (i + 0.5) / n, k = kindAt(w, w.a[0] + dx * s, w.a[1] + dy * s, nx, ny);
        if (run && run.k.t === k.t && !!run.k.perim === !!k.perim) run.s1 = (i + 1) / n;
        else { flush(); run = { k, s0: i / n, s1: (i + 1) / n }; }
      }
      flush();
    }
    lv.walls = out;
    // a door through a painted line or a rail is a gap: there is nothing to swing
    for (const d of lv.doors) {
      const a = d.ang * Math.PI / 180, nx = -Math.sin(a), ny = Math.cos(a);
      const k = kindAt({ t: "int" }, d.x, d.y, nx * 1.2, ny * 1.2);
      if (k.t === "line" || k.t === "rail") { d.kind = "opening"; d.openAir = true; }
    }
    // what the form adds: the water and the quay's edge, a car park's ramp
    const fx = (part, x, y, rot, o) => (lv.fixtures ||= []).push(Object.assign({ part, x, y, rot, openAir: true }, o || {}));
    if (FM.water === "top" && lv.lvl === 0) {
      fx("water", B.x + B.w / 2, B.y - 8, 0, { w: B.w + 18, h: 14 });
      fx("quay-edge", B.x + B.w / 2, B.y + 1.1, 0, { w: B.w - 1 });
      // [interpretation] a chain boom across the water at the far end: the quay's water side is shut
      fx("chain-boom", B.x + B.w + 3, B.y - 8, 90, { w: 14 });
    }
    if (FM.ramp && lv.exterior.kind === "rect" && lay.levels.filter(l => l.lvl >= 0 && !l.ground).length > 1) {
      const rw = Math.min(42, B.w * 0.55);
      fx("ramp", B.x + B.w - rw / 2 - 3, B.y - 6.5, 90, { w: 10, h: rw });
    }
  }
};

// --- The iso: an open-air wall, drawn as what it is -----------------------------------
// Called by M.iso for every wall of a kind in OD.WALL (s: the wall's segment, P0:
// plan point and height → screen). Returns { key, pieces } in the iso's painter's
// order, or null for a wall that isn't one of these. A fence and a rail are seen
// through: posts and a top rail over a faint mesh. A line lies on the ground.
OD.isoWall = function (s, P0, vx) {
  const spec = OD.WALL[s.t];
  if (!spec) return null;
  const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], len = Math.hypot(dx, dy);
  let nx = -dy / len, ny = dx / len;
  if (vx * nx + ny < 0) { nx = -nx; ny = -ny; }
  const mx = (s.a[0] + s.b[0]) / 2, my = (s.a[1] + s.b[1]) / 2, key = vx * mx + my;
  const h = s.cutH != null ? Math.min(spec.h, s.cutH) : spec.h, o = spec.th / 2;
  const A = [s.a[0] + nx * o, s.a[1] + ny * o], B = [s.b[0] + nx * o, s.b[1] + ny * o], A2 = [s.a[0] - nx * o, s.a[1] - ny * o], B2 = [s.b[0] - nx * o, s.b[1] - ny * o];
  const pcs = [];
  const box = (z0, z1, role, op) => {
    const xo = op != null ? { opacity: op } : undefined;
    pcs.push(P.poly("wallf-" + role, [P0(A, z0), P0(B, z0), P0(B, z1), P0(A, z1)], xo));
    const endB = vx * dx + dy > 0, E1 = endB ? B : A, E2 = endB ? B2 : A2;
    pcs.push(P.poly("walle-" + role, [P0(E1, z0), P0(E2, z0), P0(E2, z1), P0(E1, z1)], xo));
    pcs.push(P.poly("wallt-" + role, [P0(A, z1), P0(B, z1), P0(B2, z1), P0(A2, z1)], xo));
  };
  if (s.t === "line" || h <= 0.05) {
    const p = P0(s.a, 0.02), q = P0(s.b, 0.02);
    pcs.push(P.line("wall-" + s.t, p[0], p[1], q[0], q[1], { sw: spec.sw, dash: true }));
    return { key, pieces: pcs };
  }
  if (spec.see) {
    // the mesh, faint; posts at a steady pitch and at both ends; the top rail
    if (s.t === "fence") pcs.push(P.poly("wallf-" + s.t, [P0(s.a, 0), P0(s.b, 0), P0(s.b, h), P0(s.a, h)], { opacity: 0.16 }));
    const pitch = s.t === "fence" ? 8 : 4, np = Math.max(1, Math.round(len / pitch));
    for (let i = 0; i <= np; i++) {
      const t = i / np, p = [s.a[0] + dx * t, s.a[1] + dy * t], q0 = P0(p, 0), q1 = P0(p, h);
      pcs.push(P.line("wall-" + s.t, q0[0], q0[1], q1[0], q1[1], { sw: s.t === "fence" ? 0.3 : 0.24 }));
    }
    const r0 = P0(s.a, h), r1 = P0(s.b, h);
    pcs.push(P.line("wall-" + s.t, r0[0], r0[1], r1[0], r1[1], { sw: 0.28 }));
    if (s.t === "rail") { const k0 = P0(s.a, 0.4), k1 = P0(s.b, 0.4); pcs.push(P.line("wall-" + s.t, k0[0], k0[1], k1[0], k1[1], { sw: 0.5 })); }
    return { key, pieces: pcs };
  }
  box(0, h, s.t);
  return { key, pieces: pcs };
};
// …and its stroke in the plan (M.scene.wallPiece)
OD.planStroke = t => OD.WALL[t] ? OD.WALL[t].sw : null;

// --- What lies under the street (shared with the chase strip) --------------------------
// [interpretation] One reading for the building views (E3's floor −1) and the chase
// strip's below level: a canal beside a towpath or under a bridge, an underpass under
// an open plaza or a roundabout, a service tunnel under a covered arcade, a culvert
// where the street has water, and a sewer everywhere else.
M.belowKind = (ground, water) => ground === "bridge" || ground === "waterside" || ground === "quay" ? "canal" : ground === "open" || ground === "hub" || ground === "carpark" ? "underpass" : ground === "covered" ? "service" : water ? "culvert" : "sewer";
OD.BELOW = {
  sewer: { title: "Sewer", wet: true, w: 10, say: "The sewer under the street, a branch under the site, a ladder up to the hatch." },
  culvert: { title: "Culvert", wet: true, w: 9, say: "The culvert under the street (its water props), a branch under the site, a ladder up." },
  canal: { title: "Canal", wet: true, w: 16, say: "The canal under the street's edge, a cut under the site, a ladder up." },
  underpass: { title: "Underpass", wet: false, w: 12, say: "The underpass under the plaza, a service passage under the site, a ladder up." },
  service: { title: "Service tunnel", wet: false, w: 10, say: "The service tunnel under the arcade, a branch under the site, a ladder up." }
};
// The kind under this roll's street: its printed street type's ground, and whether its props put water there.
OD.belowFor = function (model) {
  const st = M.street && M.street.GROUND ? Object.keys(M.street.GROUND).find(k => k.toLowerCase() === String(model.streetType || "").toLowerCase()) : null;
  const ground = st ? M.street.GROUND[st].g : null;
  const water = (model.props || []).some(p => M.street && M.street.PROP && M.street.PROP[p] && M.street.PROP[p].z === "water");
  const sewerGrate = (model.props || []).includes("a sewer grate");
  const kind = M.belowKind(ground, water);
  return sewerGrate && (kind === "culvert") ? "sewer" : kind;
};

// --- E3: the sheets a building hasn't got -----------------------------------------------
// A way in that lands on a floor the building has no sheet for: below the street
// (no basement), up a level (no floor above the street) or on the roof (no floor
// two). The sheet shares the floor's footprint (so the iso stacks it true over
// the room the way reaches) and has no rooms. In the player copy, a back route
// the crew can't know never makes one: the file would show it is there.
OD.levels = function (lay, model, opts) {
  if (lay.kind !== "plan" || model.target === "Ship") return;
  const real = lay.levels.filter(l => !l.ground);
  const lv0 = real.find(l => l.lvl === 0) || real[0];
  const want = new Set();
  model.vectors.forEach((v, i) => {
    if (i === 0) return;
    const kind = i === 1 ? "service" : "back";
    if (opts.player && kind === "back" && M.vecHidden(v)) return;
    const land = M.layout.wayLanding(v, kind, model);
    if (land.room && model.rooms.some(r => r.name.toLowerCase() === String(land.room).toLowerCase())) return;
    if (land.level === "below" && !real.some(l => l.lvl < 0)) want.add("below");
    if (land.level === "upper" && !real.some(l => l.lvl >= 1)) want.add("upper");
    if (land.level === "roof" && !lay.open && !real.some(l => l.lvl >= 2)) want.add("roof");
  });
  if (!want.size) return;
  const top = real.filter(l => l.lvl >= 0).sort((a, b) => b.lvl - a.lvl)[0] || lv0;
  const sheet = (lvl, ground, base, title) => {
    const B = Object.assign({}, base.bbox);
    // a roof keeps its floor's outline (a hub's roof is the hub's); a walkway or a tunnel has
    // none of its own (no dark ground, no slab under the whole footprint): a point exterior
    const ext = ground === "roof" ? (base.exterior.kind === "hub" ? Object.assign({}, base.exterior) : { kind: "rect", r: B }) : { kind: "circle", cx: B.x + B.w / 2, cy: B.y + B.h / 2, r: 0 };
    const lv = { lvl, title, rooms: [], extras: [], walls: [], doors: [], fixtures: [], bbox: B, exterior: ext, ground, base, ways: [] };
    lay.levels.push(lv);
    return lv;
  };
  if (want.has("below")) {
    const kind = OD.belowFor(model), lv = sheet(-1, kind, lv0, M.own(OD.BELOW, kind).title);
    lv.under = kind;
    const B = lv.bbox, W = M.own(OD.BELOW, kind).w, y0 = B.y + B.h + 4;
    lv.tunnel = { x0: B.x - 8, x1: B.x + B.w + 8, y0, y1: y0 + W };
    // the sheet grows to hold the tunnel, the same each way, so its centre (and the iso's
    // stack) stays the floor's above, and its title clears the tunnel's end
    const g = W + 8;
    lv.bbox = { x: B.x - 12, y: B.y - g, w: B.w + 24, h: B.h + 2 * g };
    lv.exterior = { kind: "circle", cx: B.x + B.w / 2, cy: B.y + B.h / 2, r: 0 };
  }
  // a walkway is a strip along the wall the way comes in on (OD.walkway), so the sheet
  // has no footprint of its own: no dark ground under it, no slab
  if (want.has("upper")) sheet(1, "walkway", lv0, "Walkway");
  if (want.has("roof")) { const lv = sheet(2, "roof", top, "Roof"); OD.deck(lv, "parapet"); }
  // the plan's order: the street, up, then down
  const ord = l => l.lvl < 0 ? 10 - l.lvl : l.lvl;
  lay.levels.sort((a, b) => ord(a) - ord(b));
};
// A roof or a walkway: the floor below's footprint as one deck (a Futurist hub and
// pods as theirs), with a parapet or a rail round it.
OD.deck = function (lv, wallT) {
  const base = lv.base, B = lv.bbox;
  if (base.exterior.kind === "hub") {
    for (const r of base.rooms.concat(base.extras.filter(e => e.kind === "hub" || e.kind === "core"))) if (r.shape && r.shape.kind === "circle") {
      lv.extras.push({ kind: "corridor", band: "public", shape: r.shape, frame: { cx: r.shape.cx, cy: r.shape.cy, w: r.shape.r * 1.3, h: r.shape.r * 1.3, rot: 0 } });
      lv.walls.push(Object.assign(M.layout.arc(r.shape.cx, r.shape.cy, r.shape.r, 0, 2 * Math.PI, wallT), { perim: true }));
    }
    for (const e of base.extras) if (e.kind === "bridge" && !e.front && e.shape) lv.extras.push({ kind: "bridge", band: "public", shape: e.shape });
    return;
  }
  lv.extras.push({ kind: "corridor", band: "public", shape: { kind: "poly", pts: G.rectPts(B) }, rect: Object.assign({}, B), frame: { cx: B.x + B.w / 2, cy: B.y + B.h / 2, w: B.w, h: B.h, rot: 0 } });
  G.rectPts(B).forEach((p, i, a) => lv.walls.push(Object.assign(M.layout.seg(p, a[(i + 1) % 4], wallT), { perim: true })));
};
// A walkway: a 6 ft strip inside the edge a way comes in on (sideObj, as L.entries
// gives it), the length of the room's stretch of that edge and a little more, railed
// on its three inner sides. Returns where its hatch down into the room goes.
OD.walkway = function (lv, sideObj) {
  const B = lv.bbox, e = sideObj.e, D = 6, lo = Math.max(e.o === "h" ? B.x : B.y, e.lo - 3), hi = Math.min(e.o === "h" ? B.x + B.w : B.y + B.h, e.hi + 3);
  const inward = { bottom: [0, -1], top: [0, 1], left: [1, 0], right: [-1, 0] }[sideObj.side];
  const pt = (u, d) => e.o === "h" ? [u, e.c + inward[1] * d] : [e.c + inward[0] * d, u];
  const pts = [pt(lo, 0), pt(hi, 0), pt(hi, D), pt(lo, D)];
  lv.extras.push({ kind: "corridor", band: "public", shape: { kind: "poly", pts } });
  const rail = (a, b) => lv.walls.push(M.layout.seg(a, b, "rail"));
  rail(pts[0], pts[1]); rail(pts[1], pts[2]); rail(pts[2], pts[3]); rail(pts[3], pts[0]);
  return pt(Math.min(hi - 3, Math.max(lo + 3, (e.lo + e.hi) / 2 + (hi - lo > 14 ? (hi - lo) * 0.25 : 0))), D / 2);
};
// The tunnel under the street and a branch from it to the foot of the ladder at
// (x, y), under the hatch in the room above. Returns the arrow's tip and its way.
OD.below = function (lv, x, y, way) {
  const T = lv.tunnel, spec = M.own(OD.BELOW, lv.under);
  if (!lv.ways.length) {
    lv.extras.push({ kind: "corridor", band: "public", shape: { kind: "poly", pts: G.rectPts({ x: T.x0, y: T.y0, w: T.x1 - T.x0, h: T.y1 - T.y0 }) } });
    lv.fixtures.push({ part: spec.wet ? "sewer-run" : "underpass-run", x: (T.x0 + T.x1) / 2, y: (T.y0 + T.y1) / 2, rot: 0, w: T.x1 - T.x0, h: T.y1 - T.y0, ground: true });
  }
  const bw = 5, bx0 = Math.max(T.x0 + 1, Math.min(T.x1 - 1 - bw, x - bw / 2)), by0 = y - 3;
  lv.extras.push({ kind: "corridor", band: "public", shape: { kind: "poly", pts: G.rectPts({ x: bx0, y: by0, w: bw, h: T.y0 - by0 }) } });
  lv.ways.push({ way, x0: bx0, x1: bx0 + bw, y0: by0 });
  if (way.fixture !== false) lv.fixtures.push({ part: "ladder", x: bx0 + bw / 2, y: y, rot: 0, way: way.kind });
  return { tip: [bx0 + bw / 2, y + 2.2], dir: [0, 1] };
};
// Once every way is in: the tunnel's walls (low, so the reader sees in), cut where
// the branches leave it; and on a roof, its plant, clear of the ways' hatches.
OD.finish = function (lay) {
  for (const lv of lay.levels) {
    if (!lv.ground) continue;
    if (lv.tunnel) {
      const T = lv.tunnel, gaps = lv.ways.map(w => [w.x0, w.x1]).sort((a, b) => a[0] - b[0]);
      const wall = (a, b) => lv.walls.push(Object.assign(M.layout.seg(a, b, "parapet"), { perim: true }));
      wall([T.x0, T.y1], [T.x1, T.y1]);
      let x = T.x0;
      for (const [g0, g1] of gaps) { if (g0 > x + 0.1) wall([x, T.y0], [g0, T.y0]); x = Math.max(x, g1); }
      if (x < T.x1 - 0.1) wall([x, T.y0], [T.x1, T.y0]);
      for (const w of lv.ways) { wall([w.x0, w.y0], [w.x0, T.y0]); wall([w.x1, w.y0], [w.x1, T.y0]); wall([w.x0, w.y0], [w.x1, w.y0]); }
    }
    if (lv.ground === "roof" && lv.base.exterior.kind !== "hub") {
      const B = lv.bbox, busy = (lv.fixtures || []).map(f => [f.x, f.y]);
      const free = (x, y, r) => busy.every(([a, b]) => Math.hypot(a - x, b - y) > r + 4);
      const spots = [[B.x + 6, B.y + 6, "tank", 5], [B.x + B.w - 7, B.y + 6, "machine", 6], [B.x + 7, B.y + B.h - 7, "machine", 6], [B.x + B.w - 6, B.y + B.h - 6, "tank", 5]];
      let n = 0;
      for (const [x, y, part, r] of spots) if (n < 2 && B.w > 26 && B.h > 22 && free(x, y, r)) { lv.fixtures.push({ part, x, y, rot: 0, plant: true }); n++; }
    }
  }
};

// --- Parts the open air adds --------------------------------------------------------------
// Drawn like every part (parts.js): top-down, in feet, back toward −y, fixture roles only.
const odR = (r, x, y, w, h, o) => P.rect(r, x - w / 2, y - h / 2, w, h, o);
const odReg = (name, describe, size, draw) => { M.PARTS[name] = { name, describe, size, draw }; };
odReg("bay", "A painted parking bay, an autopod in it or not.", [9, 14], o => {
  const k = [odR("fxline", -4.4, 0.4, 0.22, 13.2), odR("fxline", 4.4, 0.4, 0.22, 13.2), odR("fxline", 0, -6.2, 9, 0.22)];
  if (o.car) k.push(P.g(M.PARTS.autopod.draw({}), { tf: { x: 0, y: 0.4, s: 0.95 } }));
  return k;
});
odReg("lane-arrow", "An arrow painted on a lane.", [3, 6], () => [P.poly("fxline", [[0, -3], [1.5, -0.8], [0.5, -0.8], [0.5, 3], [-0.5, 3], [-0.5, -0.8], [-1.5, -0.8]])]);
odReg("bollard", "A bollard.", [1.4, 1.4], () => [P.circle("fx3", 0, 0, 0.65), P.circle("fxm", 0, 0, 0.3)]);
odReg("quay-edge", "A quay's coping, bollards along it.", [20, 2.4], o => {
  const L = o.w || 20, k = [odR("fxm", 0, 0, L, 1.6), odR("fx3", 0, -0.9, L, 0.3)];
  for (let x = -L / 2 + 4; x < L / 2 - 2; x += 12) k.push(P.circle("fx3", x, 0.1, 0.62), P.circle("fxm", x, 0.1, 0.28));
  return k;
});
odReg("ramp", "A car park's ramp between decks, chevrons up it.", [10, 30], o => {
  const W = o.w || 10, H = o.h || 30, k = [odR("fxm", 0, 0, W, H), odR("fx3", -W / 2 + 0.25, 0, 0.5, H), odR("fx3", W / 2 - 0.25, 0, 0.5, H)];
  for (let y = -H / 2 + 3; y < H / 2 - 2; y += 4.5) k.push(P.poly("fxline", [[-2.2, y + 1.4], [0, y], [2.2, y + 1.4], [2.2, y + 2.1], [0, y + 0.7], [-2.2, y + 2.1]]));
  return k;
});
odReg("chain-boom", "A chain boom across water: floats on a chain.", [14, 1.6], o => {
  const L = o.w || 14, k = [odR("fx3", 0, 0, L, 0.25)];
  for (let x = -L / 2 + 1; x < L / 2; x += 2.2) k.push(odR("fx2", x, 0, 1.4, 1.1, { rx: 0.4 }));
  return k;
});
odReg("stall", "A market stall: a striped awning over a counter.", [7, 6], () => {
  const k = [odR("fx2", 0, -0.6, 7, 4.2)];
  for (let x = -3; x < 3.4; x += 1.4) k.push(odR("fxl", x + 0.35, -0.6, 0.7, 4.2));
  k.push(odR("fx", 0, 2.2, 6.4, 1.4), odR("fxl", -1.6, 2.2, 1.2, 0.8), odR("fx2", 1.4, 2.2, 1.4, 0.8));
  return k;
});
odReg("track", "A racing oval: asphalt round an infield, a dashed line, the start.", [40, 24], o => {
  const W = o.w || 40, H = o.h || 24, t = Math.min(9, Math.min(W, H) * 0.28), rx = W / 2, ry = H / 2, ix = rx - t, iy = ry - t;
  const ell = (a, b) => `M${-a} 0 A${a} ${b} 0 1 1 ${a} 0 A${a} ${b} 0 1 1 ${-a} 0 Z`;
  const k = [P.path("fx3", ell(rx, ry) + " " + ell(ix, iy), { evenodd: true }), P.ellipse("fxg", 0, 0, ix - 0.6, iy - 0.6)];
  const mx = rx - t / 2, my = ry - t / 2;
  for (let i = 0; i < 28; i++) {
    const a = i / 28 * Math.PI * 2, x = Math.cos(a) * mx, y = Math.sin(a) * my, rot = Math.atan2(Math.cos(a) * my, -Math.sin(a) * mx) * 180 / Math.PI;
    k.push(P.g([odR("fxl", 0, 0, 1.4, 0.22)], { tf: { x, y, rot } }));
  }
  for (let j = 0; j < Math.floor(t / 1.2); j++) k.push(odR(j % 2 ? "fxl" : "fx3", 0.6 * (j % 2 ? 1 : -1), ry - t + 0.6 + j * 1.2, 1.2, 1.2));
  k.push(odR("fxl", 0, ry - t / 2, 0.3, t));
  k.push(P.g(M.PARTS.autopod.draw({}), { tf: { x: -mx * 0.55, y: my * 0.83, rot: 90, s: 0.55 } }), P.g(M.PARTS.autopod.draw({}), { tf: { x: mx * 0.9, y: -my * 0.3, rot: 0, s: 0.55 } }));
  return k;
});
odReg("grandstand", "A grandstand: stepped tiers under a canopy.", [20, 8], o => {
  const L = o.w || 20, k = [odR("fx3", 0, -3.6, L, 1)];
  for (let i = 0; i < 4; i++) k.push(odR(i % 2 ? "fx" : "fx2", 0, -2.4 + i * 1.6, L - 0.6, 1.4));
  for (let x = -L / 2 + 3; x < L / 2 - 1; x += 6) k.push(odR("fxl", x, 0, 0.4, 6.4));
  return k;
});
odReg("tyres", "A stack of tyres.", [3, 3], () => [P.circle("fx3", 0, 0, 1.4), P.circle("fxm", 0, 0, 0.6)]);
odReg("container", "A cargo container.", [8, 20], o => {
  const L = o.h || 20, k = [odR(o.alt ? "fx" : "fx2", 0, 0, 8, L)];
  for (let y = -L / 2 + 1.2; y < L / 2 - 0.6; y += 1.2) k.push(odR("fx3", 0, y, 8, 0.1));
  k.push(odR("fxline", 0, L / 2 - 0.3, 7, 0.25));
  return k;
});
odReg("barrier-arm", "A gate's barrier arm.", [10, 1.4], o => {
  const L = o.w || 10, k = [odR("fx3", -L / 2 + 0.6, 0, 1.2, 1.4)];
  for (let x = -L / 2 + 1.4, i = 0; x < L / 2; x += 1, i++) k.push(odR(i % 2 ? "fxl" : "fx2", x + 0.5, 0, 1, 0.45));
  return k;
});
odReg("sewer-run", "A sewer: a channel of water between two ledges.", [30, 10], o => {
  const W = o.w || 30, H = o.h || 10, ch = Math.max(2, H - 4.4), k = [odR("fxm", 0, 0, W, H), odR("fxw", 0, 0, W, ch)];
  for (let x = -W / 2 + 4; x < W / 2 - 2; x += 9) k.push(odR("fxl", x + ((x * 7) % 3), ((x * 13) % 5) / 5 * (ch - 1) - (ch - 1) / 2, 2.6, 0.2, { opacity: 0.6 }));
  for (let x = -W / 2 + 6; x < W / 2 - 3; x += 16) k.push(odR("fx3", x, -H / 2 + 0.3, 2.4, 0.5));
  return k;
});
odReg("underpass-run", "An underpass: a tiled passage, lamps along it.", [30, 12], o => {
  const W = o.w || 30, H = o.h || 12, k = [odR("fxl", 0, 0, W, H)];
  for (let x = -W / 2 + 3; x < W / 2; x += 3) k.push(odR("fxline", x, 0, 0.1, H));
  for (let x = -W / 2 + 7; x < W / 2 - 3; x += 14) k.push(P.circle("fxglow", x, -H / 2 + 1.2, 0.6));
  return k;
});

// --- Rooms out of doors ----------------------------------------------------------------------
// [interpretation] The book's room, drawn as it stands in the open (M.DRESS for the
// Market and the Autodrome; OD.DRESS for a car park's and a yard's).
const odBays = (R, side, n0) => {
  const horiz = side === "top" || side === "bottom", len = horiz ? R.w : R.h, n = Math.max(1, Math.floor((len - 1) / 9)), out = [];
  const start = (len - n * 9) / 2 + 4.5;
  for (let i = 0; i < n; i++) {
    const t = start + i * 9, car = ((i + n0) * 7 + 3) % 5 > 1;
    const pos = { top: [R.x + t, R.y + 7, 0], bottom: [R.x + t, R.y + R.h - 7, 180], left: [R.x + 7, R.y + t, 270], right: [R.x + R.w - 7, R.y + t, 90] }[side];
    out.push({ part: "bay", x: pos[0], y: pos[1], rot: pos[2], car });
  }
  return out;
};
Object.assign(M.ARCH, {
  "parking": R => {
    const horiz = R.w >= R.h, a = horiz ? "top" : "left", b = horiz ? "bottom" : "right", span = horiz ? R.h : R.w;
    const out = odBays(R, a, 0);
    if (span >= 34) out.push(...odBays(R, b, 2));
    const mid = span >= 34 ? 0.5 : Math.min(0.85, 16 / span + 0.12);
    out.push(M.F.at(R, "lane-arrow", horiz ? 0.3 : mid, horiz ? mid : 0.3, { rot: horiz ? 90 : 180 }), M.F.at(R, "lane-arrow", horiz ? 0.7 : mid, horiz ? mid : 0.7, { rot: horiz ? 90 : 180 }));
    return out;
  },
  "stockyard": R => [...M.F.grid(R, "container", 10.5, 22, { skip: (i, j) => (i + j * 2) % 4 === 3, opt: i => ({ alt: i % 2 === 1 }) }), M.F.at(R, "forklift", 0.9, 0.85, { rot: 180 })],
  "market-stalls": R => M.F.grid(R, "stall", 10, 9, { skip: (i, j) => j % 3 === 2 }),
  "food-stalls": R => [...M.F.along(R, "top", "stall", 9, 6), ...M.F.grid({ x: R.x, y: R.y + 8, w: R.w, h: R.h - 8 }, "table-round", 6.5, 6.5)],
  "market-gate": R => [M.F.at(R, "barrier-arm", 0.35, 0.75, { w: Math.min(10, R.w * 0.45) }), M.F.at(R, "counter", 0.7, 0.3, { w: Math.min(8, R.w * 0.4) }), M.F.at(R, "queue-rope", 0.4, 0.45, { w: R.w * 0.4 })],
  "track": R => [M.F.at(R, "track", 0.5, 0.5, { w: R.w * 0.96, h: R.h * 0.92 })],
  "grandstand": R => M.F.rows(R, "grandstand", 9, { frac: 0.9 }),
  "pits": R => [...M.F.along(R, "top", "car-lift", 11, 14), ...M.F.along(R, "bottom", "tyres", 4, 3)],
  "race-control": R => [M.F.wall(R, "top", "monitor-wall", 2, { frac: 0.9 }), M.F.at(R, "console", 0.5, 0.5, { w: Math.max(6, R.w * 0.6) }), M.F.at(R, "chair", 0.4, 0.75), M.F.at(R, "chair", 0.6, 0.75)]
});

// --- The street: an open-air site, seen from the street ---------------------------------------
// [interpretation] The lot the plan lays out, without a roof: each room's ground in its
// exposure (the public ground paved, the working ground a yard, the fenced ground darker),
// every wall the open-air pass gave a kind drawn as that kind (painted lines on the
// ground, rails, mesh fences, parapets, the quay's edge), the secure rooms as lock-ups,
// the stair core as a tower, and each floor above the street as a deck on columns. What
// the rooms are drawn as indoors (bays, stalls, the track, containers) stands in the open.
// Returns the site's item: flat on the lot (on the top deck for a car park), so the key's
// label and the ways in's gates sit on it.
OD.STREET_GROUND = { public: "plaza", working: "yard", controlled: "lot" };
OD.street = function (S, site, model, F, zs) {
  const lay = site.lay, V = S.V, P0 = S.P0, form = lay.open;
  // The player copy: what anyone sees from the gate. The public ground is drawn as it is; the
  // rest of the lot is plain ground with nothing on it (no lock-up, fence or line that would
  // say where an unsurveyed room is), inside the perimeter, which everyone can see.
  const player = S.ctx.opts.layer === "player", shown = r => !player || r.band === "public";
  const real = lay.levels.filter(l => !l.ground && l.lvl >= 0).sort((a, b) => a.lvl - b.lvl);
  const x0 = F.site.x0, x1 = F.site.x1, y0 = -site.D, y1 = 0;
  const poly = s => s.kind === "circle" ? Array.from({ length: 24 }, (_, i) => [s.cx + Math.cos(i * Math.PI / 12) * s.r, s.cy + Math.sin(i * Math.PI / 12) * s.r]) : s.pts;
  const bboxOf = pts => { const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
  let topZ = zs;
  for (const lv of real) {
    const z = zs + site.levelZ(lv), W = (x, y) => site.toWorld(lv, x, y);
    topZ = Math.max(topZ, z);
    let deck = null;
    if (lv.lvl > 0) {
      // the deck, on columns
      const B = lv.bbox, [a0, b0] = W(B.x, B.y), [a1, b1] = W(B.x + B.w, B.y + B.h);
      if (form === "car park") deck = S.box(a0, b0, z - 1.2, a1, b1, z, "concrete", null, {});
      else {
        // a gantry: a steel grating on beams, the ground seen through it
        deck = S.add({ b: [a0, b0, z - 0.6, a1, b1, z], pcs: [P.poly("st-t:iron", [P0(a0, b0, z), P0(a1, b0, z), P0(a1, b1, z), P0(a0, b1, z)], { opacity: 0.22 })], ground: z, shadow: false, grating: true });
        for (const [p, q, r2, s2] of [[a0, b0, a1, b0 + 0.8], [a0, b1 - 0.8, a1, b1], [a0, b0, a0 + 0.8, b1], [a1 - 0.8, b0, a1, b1]]) S.box(p, q, z - 0.8, r2, s2, z, "iron", null, { shadow: false });
      }
      const cw = form === "car park" ? 0.7 : 0.35, cm = form === "car park" ? "concrete" : "iron";
      for (let x = a0 + 3; x < a1 - 1; x += Math.max(12, (a1 - a0 - 6) / Math.max(1, Math.round((a1 - a0 - 6) / 22)))) for (const y of [b0 + 3, b1 - 3]) S.box(x - cw, y - cw, zs, x + cw, y + cw, z - (form === "car park" ? 1.2 : 0.8), cm, null, { shadow: false });
    }
    // on the ground (decals) or on the deck's top (its own pieces, so the deck never hides them)
    const surf = (pts, role, o) => deck ? deck.pcs.push(P.poly("st-g:" + role, pts.map(p => P0(p[0], p[1], z + 0.02)), deck.grating && role !== "mark" ? Object.assign({ opacity: 0.35 }, o) : o)) : S.decal(P.poly("st-g:" + role, pts, o), z);
    const parkRole = form === "car park" ? "road" : null;
    for (const r of lv.rooms) {
      if (!r.shape) continue;
      const pts = poly(r.shape).map(p => W(p[0], p[1])), [rx0, ry0, rx1, ry1] = bboxOf(pts), cx = (rx0 + rx1) / 2, cy = (ry0 + ry1) / 2;
      if (!shown(r)) { surf(pts, "lot"); continue; }
      if (r.band === "secure") {
        // the lock-up: walls and a roof, a roller door on the side the street sees
        const h = lv.lvl > 0 ? 9 : 10;
        if (r.shape.kind === "circle") S.cyl(cx, cy, (rx1 - rx0) / 2 - 0.6, z, z + h, "site");
        else S.box(rx0 + 0.3, ry0 + 0.3, z, rx1 - 0.3, ry1 - 0.3, z + h, "site", f => { f.front(cx - 3, cx + 3, z, z + 7, "st-d:roller"); }, {});
        continue;
      }
      surf(pts, r.band === "public" && parkRole ? parkRole : OD.STREET_GROUND[r.band] || "yard");
      const w = rx1 - rx0, d = ry1 - ry0;
      if (r.arch === "parking") {
        // bays along the long side, a car in some
        const along = w >= d, L = along ? w : d, n = Math.max(1, Math.floor((L - 2) / 9));
        for (let i = 0; i <= n; i++) { const u = (along ? rx0 : ry0) + 1 + i * (L - 2) / n; surf(along ? [[u - 0.15, ry0 + 1], [u + 0.15, ry0 + 1], [u + 0.15, ry0 + 13], [u - 0.15, ry0 + 13]] : [[rx0 + 1, u - 0.15], [rx0 + 13, u - 0.15], [rx0 + 13, u + 0.15], [rx0 + 1, u + 0.15]], "mark"); }
        for (let i = 0; i < n; i++) if ((i * 7 + 3) % 5 > 1) { const u = (along ? rx0 : ry0) + 1 + (i + 0.5) * (L - 2) / n; ST_autopod(S, along ? u : rx0 + 7, along ? ry0 + 7 : u, z, !along, ["pod1", "pod2", "pod3"][i % 3]); }
      } else if (r.arch === "market-stalls" || r.arch === "food-stalls") {
        for (let x = rx0 + 5; x < rx1 - 4; x += 10) for (let y = ry0 + 5; y < ry1 - 4; y += 11) M.street.stall(S, x, y, z, ((x + y) | 0) % 2 ? "awning" : "canvas");
      } else if (r.arch === "track") {
        const ell = (rx, ry) => Array.from({ length: 32 }, (_, i) => [cx + Math.cos(i * Math.PI / 16) * rx, cy + Math.sin(i * Math.PI / 16) * ry]);
        const t = Math.min(9, Math.min(w, d) * 0.28);
        surf(ell(w / 2 - 1, d / 2 - 1), "road"); surf(ell(w / 2 - 1 - t, d / 2 - 1 - t), "grass");
        ST_autopod(S, cx - w * 0.25, cy + d / 2 - 1 - t / 2, z, true, "pod1"); ST_autopod(S, cx + w / 2 - 1 - t / 2, cy - d * 0.1, z, false, "pod2");
      } else if (r.arch === "grandstand") {
        for (let i = 0; i < 3; i++) S.box(rx0 + 2, ry0 + 2 + i * 3, z, rx1 - 2, ry0 + 5 + i * 3, z + 7 - i * 2, i % 2 ? "concrete" : "site2", null, { shadow: i === 0 });
      } else if (r.arch === "stockyard") {
        for (let x = rx0 + 2; x < rx1 - 9; x += 11) for (let y = ry0 + 2; y < ry1 - 20; y += 23) S.box(x, y, z, x + 8, y + 20, z + 8.5, (x | 0) % 2 ? "site2" : "metal");
      } else if (r.arch === "car-bays" || r.arch === "pits") {
        for (let x = rx0 + 6; x < rx1 - 5; x += 12) ST_autopod(S, x, ry0 + 8, z, false, "pod2");
      }
    }
    // the stair core: a tower to the deck above it
    for (const e of lv.extras) if (e.kind === "core" && e.shape) {
      const pts = poly(e.shape).map(p => W(p[0], p[1])), [a, b, c, dd] = bboxOf(pts), up = real.find(l => l.lvl > lv.lvl);
      S.box(a, b, z, c, dd, up ? zs + site.levelZ(up) + 3 : z + 10, "concrete", null, {});
    }
    // what stands between: each wall of an open-air kind, drawn as that kind
    for (const wl of lv.walls) {
      if (!OD.WALL[wl.t]) continue;
      if (player && !wl.perim && !OD.publicWall(lv, wl)) continue;
      const na = wl.arc ? Math.max(2, Math.ceil((wl.a1 - wl.a0) * wl.r / 4)) : 0;
      const pieces = wl.arc ? Array.from({ length: na }, (_, i) => { const t0 = wl.a0 + (wl.a1 - wl.a0) * i / na, t1 = wl.a0 + (wl.a1 - wl.a0) * (i + 1) / na; return [[wl.cx + Math.cos(t0) * wl.r, wl.cy + Math.sin(t0) * wl.r], [wl.cx + Math.cos(t1) * wl.r, wl.cy + Math.sin(t1) * wl.r]]; }) : [[wl.a, wl.b]];
      for (const [pa, pb] of pieces) OD.streetWall(S, wl.t, W(pa[0], pa[1]), W(pb[0], pb[1]), z, surf);
    }
  }
  // the quay's water, behind the lot
  if (M.own(OD.FORMS, form) && M.own(OD.FORMS, form).water === "top") {
    S.decal(P.rect("st-g:water", x0 - 6, y0 - 9, x1 - x0 + 12, 9), -4.5);
    S.box(x0 - 6, y0 - 0.6, -4.5, x1 + 6, y0, zs, "edge", null, { noTop: true, shadow: false });
    // the chain boom across its far end, floats on the water
    const bx = V.flip ? x0 - 3 : x1 + 3;
    for (let y = y0 - 8.5; y < y0 - 0.8; y += 2.2) S.box(bx - 0.6, y, -4.5, bx + 0.6, y + 1.4, -3.7, "post", null, { shadow: false });
  }
  const it = { b: [x0, y0, zs, x1, y1, topZ + 0.05], pcs: [], ground: zs, shadow: false };
  S.items.push(it);
  return it;
};
// Does a wall stand between two public places (a room or the open ground and a corridor)?
OD.publicWall = function (lv, w) {
  const at = (x, y) => { for (const r of lv.rooms) if (r.shape && M.scene.inside(r.shape, x, y)) return r.band; for (const e of lv.extras) if (e.shape && M.scene.inside(e.shape, x, y)) return "public"; return null; };
  if (w.arc) return false;
  const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], l = Math.hypot(dx, dy) || 1, mx = (w.a[0] + w.b[0]) / 2, my = (w.a[1] + w.b[1]) / 2;
  const a = at(mx - dy / l, my + dx / l), b = at(mx + dy / l, my - dx / l);
  return (a === "public" || a === null) && (b === "public" || b === null);
};
const ST_autopod = (S, x, y, z, along, mat) => M.street.autopod(S, x, y, z, along, mat, { L: 10, W: 5 });
// One stretch of an open-air wall on the street, from a to b (world feet) on a surface at z.
OD.streetWall = function (S, t, a, b, z, surf) {
  const P0 = S.P0, dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  if (len < 0.2) return;
  const nx = -dy / len, ny = dx / len, spec = OD.WALL[t];
  if (t === "line") { const o = 0.18; surf([[a[0] + nx * o, a[1] + ny * o], [b[0] + nx * o, b[1] + ny * o], [b[0] - nx * o, b[1] - ny * o], [a[0] - nx * o, a[1] - ny * o]], "mark"); return; }
  const box = [Math.min(a[0], b[0]) - 0.2, Math.min(a[1], b[1]) - 0.2, z, Math.max(a[0], b[0]) + 0.2, Math.max(a[1], b[1]) + 0.2, z + spec.h];
  if (t === "parapet" || t === "quay") {
    const o = spec.th / 2;
    S.prism([[a[0] + nx * o, a[1] + ny * o], [b[0] + nx * o, b[1] + ny * o], [b[0] - nx * o, b[1] - ny * o], [a[0] - nx * o, a[1] - ny * o]], z, z + spec.h, t === "quay" ? "edge" : "concrete", { shadow: false });
    if (t === "quay") for (let u = 4; u < len - 2; u += 12) S.cyl(a[0] + dx * u / len, a[1] + dy * u / len, 0.7, z + spec.h, z + spec.h + 1.6, "dark", { shadow: false });
    return;
  }
  const h = spec.h, pcs = [];
  if (t === "fence") pcs.push(P.poly("st-x:fence", [P0(a[0], a[1], z), P0(b[0], b[1], z), P0(b[0], b[1], z + h), P0(a[0], a[1], z + h)]));
  const pitch = t === "fence" ? 8 : 2.4, n = Math.max(1, Math.round(len / pitch));
  for (let i = 0; i <= n; i++) { const p = [a[0] + dx * i / n, a[1] + dy * i / n]; pcs.push(P.line("st-x:rail", ...P0(p[0], p[1], z), ...P0(p[0], p[1], z + h), { sw: t === "fence" ? 0.3 : 0.16 })); }
  pcs.push(P.line("st-x:rail", ...P0(a[0], a[1], z + h), ...P0(b[0], b[1], z + h), { sw: 0.28 }));
  S.add({ b: box, pcs, ground: z, shadow: false });
};

// ---- src/overlay.js ----
// =============================================================================
// overlay — icons, and the game layer drawn over the building
// =============================================================================
// Icons are drawn in a 2 × 2 box centred on (0,0). Roles: "ic" body, "ic2"
// accent, "icbg" the badge disc behind it. Themes colour them per overlay kind
// by wrapping the icon in a group whose role prefix the theme reads.

const ICON = M.ICONS = {};
const ic = (name, describe, draw) => { ICON[name] = { name, describe, draw }; };
ic("star", "The target.", () => { const p = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.42 : 1; p.push([Math.cos(a) * r, Math.sin(a) * r]); } return [P.poly("ic", p)]; });
ic("camera", "Surveillance cameras.", () => [P.rect("ic", -0.9, -0.5, 1.4, 1, { rx: 0.15 }), P.poly("ic", [[0.5, -0.3], [1, -0.55], [1, 0.55], [0.5, 0.3]]), P.circle("ic2", -0.2, 0, 0.28)]);
ic("alarm", "Alarms.", () => [P.path("ic", "M-0.8 0.5 C-0.8 -0.2 -0.6 -0.9 0 -0.9 C0.6 -0.9 0.8 -0.2 0.8 0.5 L1 0.7 L-1 0.7 Z"), P.circle("ic", 0, 0.9, 0.22), P.rect("ic2", -0.06, -0.5, 0.12, 0.6)]);
ic("lock", "Locks, codes, secure doors.", () => [P.path("ic", "M-0.55 -0.1 L-0.55 -0.45 A0.55 0.55 0 0 1 0.55 -0.45 L0.55 -0.1 L0.32 -0.1 L0.32 -0.45 A0.32 0.32 0 0 0 -0.32 -0.45 L-0.32 -0.1 Z"), P.rect("ic", -0.8, -0.1, 1.6, 1.1, { rx: 0.12 }), P.circle("ic2", 0, 0.35, 0.18)]);
ic("guard", "A physical threat — guards, muscle.", () => [P.circle("ic", 0, -0.55, 0.38), P.path("ic", "M-0.75 0.95 C-0.75 0.1 -0.45 -0.12 0 -0.12 C0.45 -0.12 0.75 0.1 0.75 0.95 Z"), P.rect("ic2", -0.42, -0.98, 0.84, 0.18)]);
ic("social", "A social threat — the insulating layer (p.433).", () => [P.circle("ic", 0, -0.55, 0.38), P.path("ic", "M-0.75 0.95 L0 -0.12 L0.75 0.95 Z"), P.circle("ic2", 0, 0.45, 0.14)]);
ic("people", "Bystanders, guests, staff in the wrong place.", () => [P.circle("ic", -0.45, -0.45, 0.3), P.circle("ic", 0.45, -0.45, 0.3), P.path("ic", "M-1 0.9 C-1 0 -0.8 -0.05 -0.45 -0.05 C-0.1 -0.05 0 0.3 0 0.9 Z"), P.path("ic", "M0.05 0.9 C0.05 0.3 0.15 -0.05 0.45 -0.05 C0.8 -0.05 1 0 1 0.9 Z")]);
ic("animal", "Dogs, pets, a performing tiger.", () => [P.circle("ic", 0, 0.35, 0.55), P.circle("ic", -0.62, -0.25, 0.24), P.circle("ic", -0.22, -0.7, 0.24), P.circle("ic", 0.22, -0.7, 0.24), P.circle("ic", 0.62, -0.25, 0.24)]);
ic("laser", "Trip wires and lasers.", () => [P.rect("ic", -1, -0.75, 0.3, 1.5), P.rect("ic", 0.7, -0.75, 0.3, 1.5), P.rect("ic2", -0.7, -0.38, 1.4, 0.12), P.rect("ic2", -0.7, 0.26, 1.4, 0.12)]);
ic("fire", "Fire, sprinklers, fire alarms.", () => [P.path("ic", "M0 -1 C0.5 -0.4 0.85 0 0.85 0.35 C0.85 0.8 0.45 1 0 1 C-0.45 1 -0.85 0.8 -0.85 0.35 C-0.85 -0.1 -0.4 -0.2 -0.2 -0.6 C-0.1 -0.3 0 -0.2 0 -1 Z"), P.path("ic2", "M0 0 C0.25 0.25 0.4 0.4 0.4 0.6 C0.4 0.85 0.2 0.95 0 0.95 C-0.2 0.95 -0.4 0.85 -0.4 0.6 C-0.4 0.4 -0.1 0.3 0 0 Z")]);
ic("radiation", "Radiation.", () => { const k = []; for (let a = 0; a < 3; a++) { const t = a * 2.094 - 1.571; k.push(P.path("ic", `M${Math.cos(t - 0.5) * 0.3} ${Math.sin(t - 0.5) * 0.3} L${Math.cos(t - 0.5) * 1} ${Math.sin(t - 0.5) * 1} A1 1 0 0 1 ${Math.cos(t + 0.5)} ${Math.sin(t + 0.5)} L${Math.cos(t + 0.5) * 0.3} ${Math.sin(t + 0.5) * 0.3} Z`)); } k.push(P.circle("ic", 0, 0, 0.2)); return k; });
ic("voltage", "High voltage, electric fences, magnetised halls.", () => [P.poly("ic", [[0.2, -1], [-0.7, 0.15], [-0.05, 0.15], [-0.3, 1], [0.7, -0.2], [0.05, -0.2], [0.35, -1]])]);
ic("entity", "A resonance entity, a haunting, a test subject loose.", () => [P.circle("ic", 0, 0, 0.95), P.circle("ic2", 0, 0, 0.62), P.circle("ic", 0.1, -0.05, 0.36), P.circle("ic2", 0.15, -0.1, 0.12)]);
ic("hazard", "Any other obstacle.", () => [P.poly("ic", [[0, -1], [1, 0.85], [-1, 0.85]]), P.rect("ic2", -0.09, -0.35, 0.18, 0.7), P.circle("ic2", 0, 0.58, 0.11)]);
ic("loot", "Worth taking.", () => [P.poly("ic", [[0, -1], [0.8, -0.2], [0, 1], [-0.8, -0.2]]), P.poly("ic2", [[0, -1], [0.8, -0.2], [0, -0.2]])]);
ic("key", "Holds the answer to a lock deeper in.", () => [P.circle("ic", -0.45, 0, 0.5), P.circle("ic2", -0.45, 0, 0.2), P.rect("ic", -0.05, -0.12, 1.05, 0.24), P.rect("ic", 0.55, 0.05, 0.16, 0.38), P.rect("ic", 0.82, 0.05, 0.16, 0.3)]);
ic("eye", "Seen from outside — free to know.", () => [P.path("ic", "M-1 0 C-0.5 -0.7 0.5 -0.7 1 0 C0.5 0.7 -0.5 0.7 -1 0 Z"), P.circle("ic2", 0, 0, 0.34)]);
ic("question", "Costs a question to know.", () => [P.path("ic", "M-0.5 -0.45 C-0.5 -0.9 0.5 -1 0.55 -0.45 C0.6 0 0.12 0.05 0.12 0.45 L-0.12 0.45 C-0.12 -0.05 0.3 -0.1 0.3 -0.42 C0.3 -0.7 -0.25 -0.7 -0.25 -0.45 Z"), P.circle("ic", 0, 0.8, 0.16)]);
ic("stairs", "A way between floors.", () => [P.poly("ic", [[-1, 0.9], [-1, 0.4], [-0.4, 0.4], [-0.4, -0.1], [0.2, -0.1], [0.2, -0.6], [0.9, -0.6], [0.9, 0.9]])]);

// Obstacle text → icon. The six-per-theme obstacle tables (p.421–429) are
// all covered; anything new falls back to the hazard triangle.
M.obstacleIcon = text => {
  const t = String(text || "").toLowerCase();
  const rules = [
    [/camera|surveillance|monitor/, "camera"], [/alarm|siren/, "alarm"],
    [/laser|trip ?wire|traps/, "laser"], [/fire|sprinkler/, "fire"], [/radiation/, "radiation"],
    [/voltage|electric fence|electrified|magneti/, "voltage"],
    [/entity|resonance|possessed|looper|echo|aberration|warden|haunt|subject/, "entity"],
    [/dog|pet|tiger/, "animal"], [/access code|keys|lock|secure door/, "lock"],
    [/guard|security team|pit boss|concierge|bluecoats/, "guard"],
    [/worker|guest|patron|tenant|party|celebrity|maintenance|unexpected|nosy/, "people"]
  ];
  for (const [re, name] of rules) if (re.test(t)) return name;
  return "hazard";
};

M.icon = (name, x, y, size, role, o) => {
  const I = ICON[name] || ICON.hazard;
  const kids = [];
  if (!o || o.badge !== false) kids.push(P.circle("icbg", 0, 0, 1.35));
  kids.push(...I.draw());
  return P.g(kids.map(p => Object.assign(p, { r: role + ":" + p.r })), { tf: { x, y, s: size / 2 }, cls: "icon icon-" + name });
};

// ---- src/scene.js ----
// =============================================================================
// scene — layout + model → layered pieces, one group per floor
// =============================================================================
// Layer order, bottom to top. Themes may skip layers but never reorder them:
//   site → floors → furniture (+ shadows) → walls → doors → game layer
//   → unknown cover (player) → labels → entries

const S = M.scene = {};

S.wallPiece = (w, k) => {
  const sw = ({ ext: 1.6, ring: 1.15, int: 0.6, glass: 0.45, soft: 0.35 }[w.t] || M.outdoors.planStroke(w.t) || 0.6) * (k || 1);
  if (w.arc) {
    const span = w.a1 - w.a0;
    if (span >= 2 * Math.PI - 0.001) {
      const p = a => [w.cx + Math.cos(a) * w.r, w.cy + Math.sin(a) * w.r];
      const [x0, y0] = p(0), [x1, y1] = p(Math.PI);
      return P.path("wall-" + w.t, `M${x0} ${y0} A${w.r} ${w.r} 0 1 1 ${x1} ${y1} A${w.r} ${w.r} 0 1 1 ${x0} ${y0}`, { sw });
    }
    const [x0, y0] = [w.cx + Math.cos(w.a0) * w.r, w.cy + Math.sin(w.a0) * w.r], [x1, y1] = [w.cx + Math.cos(w.a1) * w.r, w.cy + Math.sin(w.a1) * w.r];
    return P.path("wall-" + w.t, `M${x0} ${y0} A${w.r} ${w.r} 0 ${span > Math.PI ? 1 : 0} 1 ${x1} ${y1}`, { sw });
  }
  return P.line("wall-" + w.t, w.a[0], w.a[1], w.b[0], w.b[1], M.outdoors.isWall(w.t) && M.outdoors.WALL[w.t].dash ? { sw, dash: true } : { sw });
};

// A door is drawn from its kind. `inward` is a point the door should swing
// toward (the room's side), so exterior doors open into the building.
S.doorPieces = (d, inward) => {
  const a = d.ang * Math.PI / 180, ux = Math.cos(a), uy = Math.sin(a);
  let nx = -uy, ny = ux;
  if (inward && ((inward[0] - d.x) * nx + (inward[1] - d.y) * ny) < 0) { nx = -nx; ny = -ny; }
  const hx = d.x - ux * d.w / 2, hy = d.y - uy * d.w / 2, ex = d.x + ux * d.w / 2, ey = d.y + uy * d.w / 2;
  const leaf = (x, y, len, sgn, role, t) => {
    const tx = x + nx * len, ty = y + ny * len;
    return [P.path(role || "door-swing", `M${x} ${y} L${x + ux * len * sgn} ${y + uy * len * sgn} A${len} ${len} 0 0 ${sgn > 0 ? (ux * ny - uy * nx > 0 ? 1 : 0) : (ux * ny - uy * nx > 0 ? 0 : 1)} ${tx} ${ty} Z`),
      P.line(t || "door-leaf", x, y, tx, ty, { sw: 0.28 })];
  };
  switch (d.kind) {
    case "opening": return [];
    case "curtain": { const k = []; for (let t = -d.w / 2 + 0.3; t <= d.w / 2 - 0.2; t += 0.55) k.push(P.circle("door-curtain", d.x + ux * t, d.y + uy * t, 0.2)); return k; }
    case "secret": return [P.line("door-secret", hx, hy, ex, ey, { sw: 0.5 })];
    case "glass": return [P.line("door-glass", hx, hy, ex, ey, { sw: 0.18 }), ...leaf(hx, hy, d.w, 1, "door-swing", "door-glass")];
    case "vault": return [P.circle("door-vault", hx + nx * d.w * 0.5, hy + ny * d.w * 0.5, d.w * 0.5), ...leaf(hx, hy, d.w, 1, "door-swing", "door-vaultleaf")];
    case "ext-double": case "double": return [...leaf(hx, hy, d.w / 2, 1), ...leaf(ex, ey, d.w / 2, -1)];
    default: return leaf(hx, hy, d.w, 1);
  }
};

const shapePiece = (role, s, o) => s.kind === "circle" ? P.circle(role, s.cx, s.cy, s.r, o) : P.poly(role, s.pts, o);
const centroidOf = r => r.frame ? [r.frame.cx, r.frame.cy] : (r.shape.kind === "circle" ? [r.shape.cx, r.shape.cy] : G.centroid(r.shape.pts));

// --- The player copy: what may reach the file ---------------------------------
// A handout is safe only if nothing of a hidden room is in the SVG at all, not
// merely painted over: no floor (its tint says its band), no wall or door that
// faces only hidden rooms (they say how many there are and where), no door for
// a way in the crew can't know. S.seal trims the layout before anything draws.
S.inside = function (shape, x, y) {
  if (!shape) return false;
  if (shape.kind === "circle") return Math.hypot(x - shape.cx, y - shape.cy) <= shape.r;
  let c = false;
  const p = shape.pts;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
};
const OPEN = new Set(["corridor", "hub", "bridge", "core"]);
// Is this room, passage or circulation space one the crew has surveyed?
// Corridors, hubs, bridges and the stair core are public circulation.
S.nodeKnown = (n, reveal) => {
  if (!n) return false;
  if (n === "hub") return true;
  if (n.kind && OPEN.has(n.kind)) return true;
  if (n.band) return M.roomRevealed(reveal, n);                       // a room: its band or its own entry; a passage (no name): its band
  if ("room" in n) return n.room ? M.roomRevealed(reveal, n.room) : false;
  return false;
};
// Spans of a parametric run [0, len] where vis(at(t)) holds; edges found by bisection.
function visibleSpans(len, at, vis) {
  const n = Math.max(2, Math.ceil(len / 0.5)), out = [];
  let start = null, prevT = 0, prevV = false;
  const edge = (t0, t1, v0) => { for (let i = 0; i < 14; i++) { const m = (t0 + t1) / 2; if (vis(at(m)) === v0) t0 = m; else t1 = m; } return (t0 + t1) / 2; };
  for (let i = 0; i <= n; i++) {
    const t = len * i / n, v = vis(at(t));
    if (i === 0) { if (v) start = 0; }
    else if (v !== prevV) { const e = edge(prevT, t, prevV); if (v) start = e; else { out.push([start, e]); start = null; } }
    prevT = t; prevV = v;
  }
  if (start !== null) out.push([start, len]);
  return out.filter(([a, b]) => b - a > 0.05);
}
S.seal = function (lay, reveal) {
  for (const lv of lay.levels) {
    const nodes = lv.rooms.filter(r => r.shape).map(r => ({ s: r.shape, known: M.roomRevealed(reveal, r) }))
      .concat(lv.extras.filter(e => e.shape).map(e => ({ s: e.shape, known: S.nodeKnown(e, reveal) })));
    const side = (x, y) => { for (const q of nodes) if (S.inside(q.s, x, y)) return q.known; return false; };
    const seen = ([x, y, nx, ny]) => side(x + nx * 0.8, y + ny * 0.8) || side(x - nx * 0.8, y - ny * 0.8);
    const walls = [];
    for (const w of lv.walls) {
      if (w.t === "ext" || w.perim) { walls.push(w); continue; }           // the shell (an open-air site's fence) is seen from the street
      if (w.arc) {
        const len = (w.a1 - w.a0) * w.r, at = t => { const a = w.a0 + t / w.r; return [w.cx + Math.cos(a) * w.r, w.cy + Math.sin(a) * w.r, Math.cos(a), Math.sin(a)]; };
        for (const [t0, t1] of visibleSpans(len, at, seen)) walls.push(Object.assign({}, w, { a0: w.a0 + t0 / w.r, a1: w.a0 + t1 / w.r }));
        continue;
      }
      const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], len = Math.hypot(dx, dy);
      if (len < 0.05) continue;
      const at = t => [w.a[0] + dx * t / len, w.a[1] + dy * t / len, -dy / len, dx / len];
      for (const [t0, t1] of visibleSpans(len, at, seen)) walls.push(L_seg([w.a[0] + dx * t0 / len, w.a[1] + dy * t0 / len], [w.a[0] + dx * t1 / len, w.a[1] + dy * t1 / len], w.t));
    }
    lv.walls = walls;
    lv.doors = lv.doors.filter(d => d.ext || S.nodeKnown(d.a, reveal) || S.nodeKnown(d.b, reveal));
  }
  return lay;
};
const L_seg = (a, b, t) => ({ a, b, t });
const pathOf = s => s.kind === "circle"
  ? `M${G.round(s.cx - s.r)} ${G.round(s.cy)} A${G.round(s.r)} ${G.round(s.r)} 0 1 1 ${G.round(s.cx + s.r)} ${G.round(s.cy)} A${G.round(s.r)} ${G.round(s.r)} 0 1 1 ${G.round(s.cx - s.r)} ${G.round(s.cy)} Z`
  : "M" + s.pts.map(p => G.round(p[0]) + " " + G.round(p[1])).join(" L") + " Z";
// ONE cover per floor: the floor's outline with the surveyed rooms cut out
// (even-odd), so the file never holds a hidden room's outline. Futurist pods
// stand apart, so there the cover is the hidden pods themselves.
S.coverPiece = function (lv, reveal) {
  const hidden = lv.rooms.filter(r => r.shape && !M.roomRevealed(reveal, r));
  if (!hidden.length) return null;
  let d;
  if (lv.exterior.kind === "hub") d = hidden.map(r => pathOf(r.shape)).join(" ");
  else {
    const known = lv.rooms.filter(r => r.shape && M.roomRevealed(reveal, r)).map(r => r.shape)
      .concat(lv.extras.filter(e => e.shape && S.nodeKnown(e, reveal)).map(e => e.shape));
    const X = lv.exterior;
    const outer = X.kind === "circle" ? pathOf({ kind: "circle", cx: X.cx, cy: X.cy, r: X.r }) : pathOf({ kind: "poly", pts: G.rectPts(X.r) });
    d = [outer].concat(known.map(pathOf)).join(" ");
  }
  return P.g([P.path("unknown", d, { evenodd: true })], { cls: "map-cover" });
};

// --- Room labels ----------------------------------------------------------------
// A label is upright text over the drawing. In iso it floats at head height
// over its room, so the room it has to fit is the room as the reader sees it:
// the plan shape through the iso projection (a parallelogram, for most rooms).
const IC0 = Math.cos(Math.PI / 6);
const isoLin = vx => ([dx, dy]) => [(dx - vx * dy) * IC0, (vx * dx + dy) * 0.5];
const shapePts = s => s.kind === "circle"
  ? Array.from({ length: 24 }, (_, i) => [s.cx + Math.cos(i * Math.PI / 12) * s.r, s.cy + Math.sin(i * Math.PI / 12) * s.r])
  : s.pts;
// The room's outline around its label anchor, as the reader sees it.
S.fitRegion = function (r, iso, vx = 1) {
  const [ax, ay] = r._label || centroidOf(r);
  const pts = r.shape ? shapePts(r.shape) : G.rectPts({ x: r.frame.cx - r.frame.w / 2, y: r.frame.cy - r.frame.h / 2, w: r.frame.w, h: r.frame.h });
  const rel = pts.map(p => [p[0] - ax, p[1] - ay]);
  return iso ? rel.map(isoLin(vx)) : rel;
};
// Is (x, y) inside the polygon and at least m from its edges?
S.insideBy = function (poly, x, y, m) {
  let c = false, d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [x1, y1] = poly[j], [x2, y2] = poly[i];
    if ((y2 > y) !== (y1 > y) && x < (x1 - x2) * (y - y2) / (y1 - y2) + x2) c = !c;
    const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L2));
    d = Math.min(d, Math.hypot(x - x1 - t * dx, y - y1 - t * dy));
  }
  return c && d >= m;
};
// Does a w × h box centred at (cx, cy) sit inside the polygon, m clear of it?
S.boxIn = (poly, cx, cy, w, h, m) => S.insideBy(poly, cx - w / 2, cy - h / 2, m) && S.insideBy(poly, cx + w / 2, cy - h / 2, m) &&
  S.insideBy(poly, cx + w / 2, cy + h / 2, m) && S.insideBy(poly, cx - w / 2, cy + h / 2, m);

// The type every label shares: the theme's face, and the floor under it.
S.type = ctx => Object.assign({ label: "condensed", labelLS: 0, entryLS: 0, smLS: 0, title: "poster", unknown: "poster" }, ctx.type || {});

// A room's label: its number in a disc, its name beside it, the GM's icons
// under the name. The name is set as large as its room allows, down to the
// type floor and never under it; a name that can't fit at the floor leaves
// the number alone in the room (a pin), and the key carries the name.
//   region  the room's outline around (x, y), as S.fitRegion returns it
//   o.pin   force a pin (the solver's last resort)
S.labelBlock = function (r, x, y, icons, ctx, region, o = {}) {
  const k = ctx.k, fu = ctx.floorU || 0, ty = S.type(ctx), cls = ty.label, ls = ty.labelLS;
  const pref = Math.max(1.9 * k, fu), min = fu || pref * 0.5;
  const ik = Math.max(2.4 * k, fu), pitch = ik * 1.42, n = icons.length;
  const iconsW = n ? n * pitch - 0.07 * ik : 0, iconsH = n ? ik * 1.36 : 0;
  const name = String(r.name).toUpperCase(), words = name.split(/\s+/).filter(Boolean), num = String(r.n);
  const margin = 0.55;
  // the number's badge: a disc, or a pill for two digits; its type never under the floor
  const badge = ns => { const h = ns * 1.25, w = Math.max(h, M.textW(num, ns, cls) + ns * 0.5); return { ns, h, w }; };
  // block size for a set of lines at a size: icons to the right ("B"), below
  // ("A"), or in a tab of their own under the name ("S", for parallelogram
  // rooms, which are narrower above and below their middle)
  const dims = (lines, s, arr) => {
    const bd = badge(Math.min(Math.max(1.2 * k, fu), s)), lh = s * 1.08, pad = s * 0.22, gap = s * 0.3, ni = arr === "S" ? 0 : n;
    const tw = Math.max(...lines.map(l => M.textW(l, s, cls, ls))), row1 = bd.w + gap + tw, textH = Math.max(lines.length * lh, bd.h);
    const w = (arr === "B" ? row1 + (ni ? 0.3 * s + iconsW : 0) : Math.max(row1, ni ? iconsW : 0)) + 2 * pad;
    const h = (arr === "B" ? Math.max(textH, ni ? iconsH : 0) : textH + (ni ? iconsH + 0.12 * s : 0)) + 2 * pad;
    const d = { lines, s, arr, bd, lh, pad, gap, tw, row1, textH, w, h };
    if (arr === "S") { d.tw2 = iconsW + 2 * pad; d.th2 = iconsH + 2 * pad; }
    return d;
  };
  // "S": the name at the centre, its icons' tab at the nearest free spot in the room
  const tabSpot = d => {
    const step = Math.max(0.4, Math.min(d.tw2, d.th2) * 0.35), sep = 0.2 * d.s, xs = region.map(p => p[0]), ys = region.map(p => p[1]);
    let best = null;
    for (let i = Math.floor(Math.min(...xs) / step); i <= Math.ceil(Math.max(...xs) / step); i++) for (let j = Math.floor(Math.min(...ys) / step); j <= Math.ceil(Math.max(...ys) / step); j++) {
      const cx = i * step, cy = j * step;
      if (Math.abs(cx) < (d.w + d.tw2) / 2 + sep && Math.abs(cy) < (d.h + d.th2) / 2 + sep) continue;      // clear of the name
      const cost = Math.hypot(cx, (cy - (d.h + d.th2) / 2) * 0.8);
      if ((!best || cost < best.cost) && S.boxIn(region, cx, cy, d.tw2, d.th2, margin)) best = { cx, cy, cost };
    }
    return best;
  };
  const fits = d => {
    if (!S.boxIn(region, 0, 0, d.w, d.h, margin)) return false;
    if (d.arr !== "S") return true;
    const t = tabSpot(d); if (!t) return false;
    d.tx = t.cx; d.ty = t.cy; return true;
  };
  let best = null;
  if (!o.pin && region) {
    for (let s = pref; s >= min - 1e-6 && !best; s = s > min && s * 0.93 < min ? min : s * 0.93) {
      for (let nl = 1; nl <= Math.min(3, words.length) && !best; nl++) {
        const lines = nl === 1 ? [name] : M.splitEven(name, nl, s, cls, ls);
        for (const arr of n ? ["B", "A", "S"] : ["A"]) {
          const d = dims(lines, s, arr);
          if (fits(d)) { best = d; break; }
        }
      }
      if (s === min) break;
    }
  }
  const kids = [];
  const badgeAt = (bd, x0, cy) => [P.rect("num-bg", x0, cy - bd.h / 2, bd.w, bd.h, { rx: bd.h / 2 }), P.text("num", x0 + bd.w / 2, cy + bd.ns * 0.36, num, { size: bd.ns })];
  if (best) {
    const d = best, x0 = x - d.w / 2, y0 = y - d.h / 2, rx = Math.min(0.5, d.s * 0.18);
    kids.push(P.rect("label-bg", x0, y0, d.w, d.h, { rx }));
    const tTop = y0 + d.pad + (d.textH - d.lines.length * d.lh) / 2;
    kids.push(...badgeAt(d.bd, x0 + d.pad, tTop + d.lh / 2));
    d.lines.forEach((l, i) => kids.push(P.text("label", x0 + d.pad + d.bd.w + d.gap, tTop + i * d.lh + d.s * 0.89, l, { size: d.s, anchor: "start" })));
    let parts = [{ x0, y0, w: d.w, h: d.h }];
    if (d.arr === "S") {
      const ix0 = x + d.tx - d.tw2 / 2, iy0 = y + d.ty - d.th2 / 2;
      kids.push(P.rect("label-bg", ix0, iy0, d.tw2, d.th2, { rx }));
      icons.forEach(([nm, role], i) => kids.push(M.icon(nm, ix0 + d.pad + ik * 0.68 + i * pitch, y + d.ty, ik, role)));
      parts.push({ x0: ix0, y0: iy0, w: d.tw2, h: d.th2 });
    } else {
      const ix = d.arr === "B" ? x0 + d.pad + d.row1 + 0.3 * d.s : x0 + d.pad + (d.row1 >= iconsW ? d.bd.w + d.gap : 0);
      const iy = d.arr === "B" ? y0 + d.h / 2 : y0 + d.pad + d.textH + 0.12 * d.s + iconsH / 2;
      icons.forEach(([nm, role], i) => kids.push(M.icon(nm, ix + ik * 0.68 + i * pitch, iy, ik, role)));
    }
    const ux0 = Math.min(...parts.map(b => b.x0)), uy0 = Math.min(...parts.map(b => b.y0)), ux1 = Math.max(...parts.map(b => b.x0 + b.w)), uy1 = Math.max(...parts.map(b => b.y0 + b.h));
    return P.g(kids, { anchor: [x, y], cls: "room-label", meta: { kind: "room", room: r, lv: o.lv, anchor: [x, y], box: { x0: ux0, y0: uy0, w: ux1 - ux0, h: uy1 - uy0 }, parts, region, size: d.s, icons, pin: false } });
  }
  // the pin: the number, and the GM's icons beside it
  const bd = badge(Math.max(1.2 * k, fu)), pad = n ? bd.ns * 0.22 : 0, gap = bd.ns * 0.25;
  const w = bd.w + (n ? gap + iconsW : 0) + 2 * pad, h = Math.max(bd.h, iconsH) + 2 * pad, x0 = x - w / 2, y0 = y - h / 2;
  if (n) kids.push(P.rect("label-bg", x0, y0, w, h, { rx: Math.min(0.5, bd.ns * 0.18) }));
  kids.push(...badgeAt(bd, x0 + pad, y));
  icons.forEach(([nm, role], i) => kids.push(M.icon(nm, x0 + pad + bd.w + gap + ik * 0.68 + i * pitch, y, ik, role)));
  return P.g(kids, { anchor: [x, y], cls: "room-label room-pin", meta: { kind: "room", room: r, lv: o.lv, anchor: [x, y], box: { x0, y0, w, h }, region, size: bd.ns, icons, pin: true } });
};

S.level = function (lv, model, ctx) {
  const { rng, W, opts, k } = ctx;
  const reveal = ctx.reveal;
  const known = r => !reveal || M.roomRevealed(reveal, r);
  const L = { site: [], floors: [], furn: [], walls: [], doors: [], game: [], cover: [], labels: [], entries: [] };

  // --- site and street ---
  const B = lv.bbox, pad = 10, SB = lv.siteBox || B;
  L.site.push(P.rect(lv.hull ? "water-body" : "site", SB.x - pad, SB.y - pad, SB.w + 2 * pad, SB.h + 2 * pad + (lv.lvl === 0 ? 10 : 0)));
  if (lv.hull) L.site.push(P.poly("hull", lv.hull.outer), P.poly("deck", lv.hull.inner));
  if (lv.lvl === 0) {
    L.site.push(P.rect(lv.hull ? "quay" : "street", SB.x - pad, SB.y + SB.h + pad * 0.6, SB.w + 2 * pad, 10));
    const fd = lv.doors.find(d => d.kind === "ext-double"), sx = fd && fd.x < B.x + B.w / 2 ? 0.74 : 0.26;
    if (model.street) {
      const st = model.street.replace(/^the /i, "").toUpperCase(), ss = Math.max(3.2 * k, (ctx.floorU || 0) * 1.1), sw = M.textW(st, ss, S.type(ctx).label, 0.8);
      const sx0 = B.x + B.w * sx, sy0 = B.y + B.h + pad * 0.6 + 5 + ss * 0.5;
      L.site.push(P.text("street-label", sx0, sy0, st, { size: ss, anchor: "middle", meta: { kind: "street", lv, box: { x0: sx0 - sw / 2, y0: sy0 - ss * 0.8, w: sw, h: ss } } }));
    }
  }
  if (lv.exterior.kind === "rect") L.site.push(P.rect("footprint", B.x, B.y, B.w, B.h));
  if (lv.exterior.kind === "circle") L.site.push(P.circle("footprint", lv.exterior.cx, lv.exterior.cy, lv.exterior.r));

  // --- floors --- (the player copy draws only what the crew has surveyed)
  for (const e of lv.extras) if (e.shape && (!reveal || S.nodeKnown(e, reveal))) L.floors.push(shapePiece(OPEN.has(e.kind) ? "floor-corridor" : "floor-" + e.band, e.shape));
  for (const r of lv.rooms) if (r.shape && known(r)) L.floors.push(shapePiece("floor-" + r.band, r.shape, { room: r.id, data: { band: r.band } }));
  // the deepest band gets the theme's tone (halftone, hatch …) on top
  for (const r of lv.rooms) if (r.shape && r.band === "secure" && known(r)) L.floors.push(shapePiece("floor-tone", r.shape, { data: { band: r.band } }));
  // …and one cover over the rest, under the walls that face what is known
  if (reveal) { const cv = S.coverPiece(lv, reveal); if (cv) L.floors.push(cv); }

  // --- furniture ---
  for (const r of lv.rooms) {
    if (!r.frame || !known(r)) continue;
    const g = M.furnish(r, rng.fork(r.name), W, M.circulationParts(r));
    if (g) L.furn.push(g);
  }
  // what gets you in from outside: fire escapes, area steps, balconies, catwalks
  for (const f of lv.fixtures || []) {
    const part = M.own(M.PARTS, f.part); if (!part) continue;
    L.furn.push(P.g(part.draw(f), { tf: { x: f.x, y: f.y, rot: f.rot || 0 }, cls: "furniture fixture fx-" + f.part }));
  }
  for (const e of lv.extras) {
    if (e.kind === "core" && e.frame) {
      const f = e.frame, kids = [];
      if (e.shape.kind === "circle") kids.push(P.g(M.PARTS["stairs-spiral"].draw({}), { tf: { x: -2.2, y: 0 } }), P.g(M.PARTS.lift.draw({}), { tf: { x: 3, y: 0, s: 0.8 } }));
      else { const vert = f.h > f.w; kids.push(P.g(M.PARTS.stairs.draw({ w: 4, h: Math.min(10, Math.max(f.w, f.h) - 7) }), { tf: { x: vert ? 0 : -f.w / 4, y: vert ? -f.h / 4 : 0, rot: vert ? 0 : 90 } }), P.g(M.PARTS.lift.draw({}), { tf: { x: vert ? 0 : f.w / 4, y: vert ? f.h / 4 : 0, s: 0.8 } })); }
      L.furn.push(P.g(kids, { tf: { x: f.cx, y: f.cy }, cls: "furniture core" }));
    }
  }

  // --- walls and doors ---
  for (const w of lv.walls) L.walls.push(S.wallPiece(w, ctx.wallK));
  const mid = [B.x + B.w / 2, B.y + B.h / 2];
  for (const d of lv.doors) {
    let target = d.ext ? mid : (d.b && d.b.frame ? [d.b.frame.cx, d.b.frame.cy] : null);
    // a door onto an unsurveyed room swings into the room the crew can see
    if (reveal && !d.ext && !S.nodeKnown(d.b, reveal) && d.a && d.a.frame) target = [d.a.frame.cx, d.a.frame.cy];
    L.doors.push(...S.doorPieces(d, target));
  }

  // --- the game layer (GM only, and only in rooms the reader may know) ---
  const gm = opts.layer !== "player";
  const ik = 2.4 * k;
  for (const r of lv.rooms) {
    if (!r.frame) continue;
    const [cx, cy] = centroidOf(r);
    r._label = [cx, cy];
    if (!gm) continue;
    const row = [];
    if (r.isTarget) row.push(["star", "ov-target"]);
    if (r.obstacle) row.push([M.obstacleIcon(r.obstacle), "ov-lock"]);
    if (r.holdsAnswerTo) row.push(["key", "ov-pair"]);
    if (r.loot && r.featured) row.push(["loot", "ov-loot"]);
    r._icons = row;
    if (r.isTarget) L.game.unshift(shapePiece("ov-target-area", r.shape));
    // A camera obstacle sweeps the room.
    if (r.obstacle && M.obstacleIcon(r.obstacle) === "camera") {
      const f = r.frame, a = (f.rot || 0) * Math.PI / 180;
      const loc = (x, y) => [f.cx + x * Math.cos(a) - y * Math.sin(a), f.cy + x * Math.sin(a) + y * Math.cos(a)];
      const c0 = loc(-f.w / 2 + 1, -f.h / 2 + 1), c1 = loc(f.w / 2 - 0.5, -f.h / 2 + f.h * 0.55), c2 = loc(-f.w / 2 + f.w * 0.55, f.h / 2 - 0.5);
      L.game.push(P.poly("ov-cone", [c0, c1, c2]));
      L.game.push(M.icon("camera", c0[0] + 1.2 * k, c0[1] + 1.2 * k, 1.8 * k, "ov-lock", { badge: false }));
    }
  }
  // Threat pawns. p.433: the social threat insulates the target, so it stands
  // in the band just shallower than the target; the physical threat stands at
  // the target and on the way in.
  if (gm) {
    const tgt = lv.rooms.find(r => r.isTarget);
    const tDepth = tgt ? M.BANDS.indexOf(tgt.band) : 3;
    const socRooms = lv.rooms.filter(r => r.frame && M.BANDS.indexOf(r.band) === Math.max(0, tDepth - 1)).slice(0, 2);
    const physRooms = lv.rooms.filter(r => r.frame && (r.isTarget || r.band === "controlled")).slice(0, 2);
    const pawn = (r, role, icon, t) => {
      const f = r.frame, a = (f.rot || 0) * Math.PI / 180, x = f.w * (0.3 + 0.1 * t), y = -f.h * 0.28;
      L.game.push(M.icon(icon, f.cx + x * Math.cos(a) - y * Math.sin(a), f.cy + x * Math.sin(a) + y * Math.cos(a), 2.2 * k, role));
    };
    if (model.soc) socRooms.forEach((r, i) => pawn(r, "ov-soc", "social", i));
    if (model.phys) physRooms.forEach((r, i) => pawn(r, "ov-phys", "guard", i));
  }

  // (the player cover sits in the floor layer: see S.coverPiece)

  // --- labels ---
  // Each room gets its name at a size the reader can read (never under the
  // type floor, ctx.floorU) or, when the name can't fit its room at that size,
  // a numbered pin, with the name in the key. Where labels go is solved once
  // for the whole sheet (M.solveLabels), against the tags and titles too.
  const iso = opts.view === "iso";
  for (const r of lv.rooms) {
    if (!r.frame || !known(r)) continue;
    const [x, y] = r._label;
    L.labels.push(S.labelBlock(r, x, y, gm ? r._icons || [] : [], ctx, S.fitRegion(r, iso, ctx.isoVx || 1), { lv }));
  }
  // One mark per floor for everything unsurveyed — never one per room, which
  // would tell the players how many rooms they haven't found.
  // It sits in the middle of the hidden area, never on the deepest room, which
  // would point at the vault.
  if (reveal) {
    const hid = lv.rooms.filter(r => r.frame && r.shape && !known(r));
    if (hid.length) {
      const pts = hid.flatMap(r => r.shape.kind === "circle" ? [[r.shape.cx - r.shape.r, r.shape.cy - r.shape.r], [r.shape.cx + r.shape.r, r.shape.cy + r.shape.r]] : r.shape.pts);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), c = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
      let host = hid.find(r => S.inside(r.shape, c[0], c[1])), at = c;
      if (!host) { host = hid.reduce((a, r) => G.dist(centroidOf(r), c) < G.dist(centroidOf(a), c) ? r : a, hid[0]); at = centroidOf(host); }
      const f = host.frame, rot = ((f.rot || 0) % 180 + 180) % 180, across = rot > 45 && rot < 135 ? f.h : f.w;
      const floorU = ctx.floorU || 0, uc = S.type(ctx).unknown;
      const size = M.fitText("UNSURVEYED", Math.max(6, across - 2), Math.max(3 * k, floorU * 1.2), uc, floorU || undefined);
      const w = M.textW("UNSURVEYED", size, uc) + 1, h = size * 1.1;
      L.labels.push(P.g([P.text("label-unknown", at[0], at[1] + size * 0.35, "UNSURVEYED", { size })],
        { anchor: at, cls: "map-unsurveyed", meta: { box: { x0: at[0] - w / 2, y0: at[1] - h / 2, w, h }, lv, pri: 2 } }));
    }
  }
  // a floor's core is labelled for what it is
  // (with a type floor it is left out when it can't fit the core: the stair and
  // lift drawn there say it anyway)
  if (lv.core && lv.core.frame && lv.core.shape.kind !== "circle") {
    const floorU = ctx.floorU || 0, ty = S.type(ctx), cls = ty.label, T = "STAIRS · LIFT", cw = lv.core.frame.w - 1.6;
    const size = M.fitText(T, cw, Math.max(1.3 * k, floorU), cls, floorU || undefined, ty.smLS), tw = M.textW(T, size, cls, ty.smLS);
    if (!floorU || tw <= cw + 0.5) {
      const cx = lv.core.frame.cx, cy = lv.core.frame.cy + lv.core.frame.h / 2 - 0.6 - size * 0.3, pd = size * 0.25;
      // on a tab of its own: lifted over the core in iso, it crosses wall tops
      L.labels.push(P.g([P.rect("label-bg", cx - tw / 2 - pd, cy - size * 0.85 - pd * 0.6, tw + 2 * pd, size * 1.1 + pd * 1.2, { rx: Math.min(0.4, size * 0.15) }), P.text("label-sm", cx, cy, T, { size })],
        { anchor: [cx, cy], cls: "map-core-label", meta: { box: { x0: cx - tw / 2 - pd, y0: cy - size * 0.85 - pd * 0.6, w: tw + 2 * pd, h: size * 1.1 + pd * 1.2 }, lv, pri: 3, fixed: true } }));
    }
  }
  return L;
};

// Links between rooms on the same floor: answers (lock ← key) and skips.
// Every word here is set at or above the type floor, and carries its box
// (meta) so the label solver keeps room labels off it.
S.links = function (lay, ctx) {
  const out = [];
  const { k, opts } = ctx, fu = ctx.floorU || 0, ty = S.type(ctx);
  if (opts.layer === "player") return out;
  const drawn = ctx.drawn || null;                       // the floors on this sheet (floor: option)
  const pos = (r, lv) => ctx.toScreen(lv, r.frame.cx, r.frame.cy, "room");
  for (const l of lay.links) {
    if (drawn && !drawn.has(l.la) && !drawn.has(l.lb)) continue;
    if (l.vertical && (!ctx.linkAcross || (drawn && !(drawn.has(l.la) && drawn.has(l.lb))))) {
      // Floors are separate sheets: a link between floors is a tag in each
      // room naming the other end, never a line across the page.
      if (l.kind === "pair") continue;
      for (const [r, lv, other, dir] of [[l.a, l.la, l.b, "to"], [l.b, l.lb, l.a, "from"]]) {
        if (drawn && !drawn.has(lv)) continue;
        const [x, y] = pos(r, lv), ts = Math.max(1.35 * k, fu);
        // the whole tag when it fits its room; otherwise just the other end's
        // number, and the key spells the link out (BETWEEN FLOORS)
        let t = `↕ ${dir} ${other.n} · ${l.via}`;
        const across = ctx.opts.view === "iso" ? Math.min(r.frame.w, r.frame.h) * 1.4 : r.frame.w;
        if (M.textW(t, ts, ty.label) + 1.2 * ts > across) { t = `↕ ${other.n}`; ctx.shortTags = true; }
        const w = M.textW(t, ts, ty.label) + 1.2 * ts, h = ts * 1.62, yy = y + (ctx.linkAcross ? 4 * k : r.frame.h * 0.32);
        out.push(P.g([P.rect("ov-skip-tag", x - w / 2, yy - h * 0.7, w, h, { rx: 0.4 }), P.text("ov-skip-tagtext", x, yy, t, { size: ts })],
          { cls: "map-skip-tag", meta: { kind: "tag", box: { x0: x - w / 2, y0: yy - h * 0.7, w, h } } }));
      }
      continue;
    }
    const a = pos(l.a, l.la), b = pos(l.b, l.lb);
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const bend = (l.kind === "pair" ? 0.18 : 0.1) * len, mx = (a[0] + b[0]) / 2 - dy / len * bend, my = (a[1] + b[1]) / 2 + dx / len * bend;
    const sh = 3.2 * k, ex = b[0] - dx / len * sh, ey = b[1] - dy / len * sh;
    out.push(P.path(l.kind === "pair" ? "ov-pair-line" : "ov-skip-line", `M${a[0]} ${a[1]} Q${mx} ${my} ${ex} ${ey}`, { sw: (l.kind === "pair" ? 0.45 : 0.75) * k }));
    // arrowhead at the lock / destination
    const tx = ex - mx, tyy = ey - my, tl = Math.hypot(tx, tyy) || 1, ux = tx / tl, uy = tyy / tl, s = 1.4 * k;
    out.push(P.poly(l.kind === "pair" ? "ov-pair-head" : "ov-skip-head", [[ex + ux * s, ey + uy * s], [ex - uy * s * 0.7, ey + ux * s * 0.7], [ex + uy * s * 0.7, ey - ux * s * 0.7]]));
    if (l.kind === "skip" && l.via) {
      // the label sits at the curve's midpoint (the curve passes halfway to its control point)
      const cx = (a[0] + ex) / 4 + mx / 2, cy = (a[1] + ey) / 4 + my / 2;
      const ts = Math.max(1.4 * k, fu), w = M.textW(l.via, ts, ty.label) + 0.4 * ts, yb = cy - 0.5 * ts;
      out.push(P.g([P.text("ov-skip-label", cx, yb, l.via, { size: ts })], { cls: "map-skip-label", meta: { kind: "skip", box: { x0: cx - w / 2, y0: yb - ts * 0.85, w, h: ts * 1.1 }, text: l.via, size: ts, at: [cx, yb], link: { a: l.a.n, b: l.b.n, via: l.via } } }));
    }
  }
  return out;
};

// The three ways in: an arrow from outside onto the door, and a tag.
S.entries = function (lay, ctx) {
  const all = [], { k, opts } = ctx, player = opts.layer === "player", fu = ctx.floorU || 0, ty = S.type(ctx);
  const drawn = ctx.drawn || null;
  const KIND = { front: "ov-front", service: "ov-service", back: "ov-back" };
  for (const e of lay.entries) {
    const know = e.vec && e.vec.know || "";
    if (player && /can't be known/.test(know)) continue;
    if (drawn && e.level && typeof e.level === "object" && !drawn.has(e.level)) continue;
    const out = [];
    const [x, y] = ctx.toScreen(e.level, e.x, e.y, "floor");
    const role = KIND[e.kind];
    let [dx, dy] = e.dir[0] || e.dir[1] ? ctx.dirScreen(e.dir) : [0, -1];
    const ts = Math.max(1.7 * k, fu), ic = Math.max(2.2 * k, 1.3 * fu), L0 = 9 * k + Math.max(0, ts - 1.7 * k) * 1.5;
    // a hatch or a skylight: the arrow comes down from above (or up from below)
    const vertical = !(e.dir[0] || e.dir[1]) && (e.from === "above" || e.from === "below");
    if (vertical) { dx = 0; dy = e.from === "above" ? 1 : -1; }
    // in the iso the arrow drops from clear above the floor's walls (or rises
    // from under its slab), so its tag never sits on the drawing
    let Lv = L0;
    if (vertical && opts.view === "iso" && e.level && e.level.bbox) {
      const B = e.level.bbox, ys = [[B.x, B.y], [B.x + B.w, B.y], [B.x + B.w, B.y + B.h], [B.x, B.y + B.h]].map(c => ctx.toScreen(e.level, c[0], c[1], e.from === "above" ? 9 : -2.5)[1]);
      Lv = Math.max(L0, e.from === "above" ? y - Math.min(...ys) + 1.5 * k : Math.max(...ys) - y + 1.5 * k);
    }
    const sx = vertical ? x - dx * Lv : x + dx * L0, sy = vertical ? y - dy * Lv : y + dy * L0;
    const dashed = player && /question/.test(know);
    const segs = [];
    if (vertical) {
      const ex = x - dx * 1.8, ey = y - dy * 1.8;
      out.push(P.line(role + "-line", sx, sy, ex, ey, { sw: 0.7 * k, dash: dashed }));
      segs.push([sx, sy, ex, ey]);
      const s = 1.6 * k, hx = x - dx * 0.6, hy = y - dy * 0.6;
      out.push(P.poly(role + "-head", [[hx, hy], [hx - dx * s * 1.4 - s, hy - dy * s * 1.4], [hx - dx * s * 1.4 + s, hy - dy * s * 1.4]]));
    } else if (e.dir[0] || e.dir[1]) {
      out.push(P.line(role + "-line", sx, sy, x + dx * 1.8, y + dy * 1.8, { sw: 0.7 * k, dash: dashed }));
      segs.push([sx, sy, x + dx * 1.8, y + dy * 1.8]);
      const s = 1.6 * k;
      out.push(P.poly(role + "-head", [[x + dx * 0.6, y + dy * 0.6], [x + dx * (0.6 + s * 1.4) - dy * s, y + dy * (0.6 + s * 1.4) + dx * s], [x + dx * (0.6 + s * 1.4) + dy * s, y + dy * (0.6 + s * 1.4) - dx * s]]));
    }
    // the tag names the way in without its article; where the full name would
    // be wide against the floor (a phone), its first word does ("SERVICE"),
    // and the key carries the full name beside the same colour
    const full = String(e.vec && e.vec.n || e.kind).replace(/^the\s+/i, "").toUpperCase();
    const lvB = e.level && e.level.bbox, floorW = lvB ? (ctx.opts.view === "iso" ? (lvB.w + lvB.h) * Math.cos(Math.PI / 6) : lvB.w) : Infinity;
    const tag = M.textW(full, ts, ty.label, ty.entryLS) + 1.2 * ts > floorW * 0.28 ? full.split(/\s+/)[0] : full;
    const off = 1.53 * ts;
    const tx = vertical ? sx : e.dir[0] || e.dir[1] ? sx + dx * off : x;
    const tyy = vertical ? (e.from === "above" ? sy - 0.9 * ts : sy + 1.9 * ts) : e.dir[0] || e.dir[1] ? sy + dy * off + (dy ? 0 : 0.35 * ts) : y - 2.35 * ts;
    const anchor = vertical ? "middle" : dx > 0.5 ? "start" : dx < -0.5 ? "end" : "middle";
    const w = M.textW(tag, ts, ty.label, ty.entryLS) + 1.2 * ts, th = 1.47 * ts;
    // a tag hanging below its arrow's tail sits under it, one standing above sits over it
    const by = dy > 0.5 && anchor === "middle" ? tyy - ts : tyy - ts;
    const bx = anchor === "start" ? tx - 0.47 * ts : anchor === "end" ? tx - w + 0.47 * ts : tx - w / 2;
    out.push(P.rect(role + "-tag", bx, by, w, th, { rx: 0.4 }));
    out.push(P.text(role + "-text", anchor === "middle" ? tx : anchor === "start" ? tx + 0.12 * ts : tx - 0.12 * ts, tyy, tag, { size: ts, anchor }));
    const icx = anchor === "end" ? bx - ic * 0.82 : bx + w + ic * 0.82, icy = by + th / 2;
    out.push(M.icon(/free/.test(know) ? "eye" : /question/.test(know) ? "question" : "lock", icx, icy, ic, role));
    const boxes = [{ x0: bx, y0: by, w, h: th }, { x0: icx - ic * 0.68, y0: icy - ic * 0.68, w: ic * 1.36, h: ic * 1.36 }];
    // a note under the tag (the street: what a way on the rear wall is, M.street.rearNote)
    if (e.note) {
      const ns = Math.max(1.35 * k, fu), nw = M.textW(e.note, ns, ty.label, ty.entryLS) + 1.2 * ns, nh = 1.47 * ns, ny = by + th + 0.25 * ts;
      const nx = anchor === "start" ? bx : anchor === "end" ? bx + w - nw : bx + w / 2 - nw / 2;
      out.push(P.rect(role + "-tag", nx, ny, nw, nh, { rx: 0.4 }), P.text(role + "-text", nx + nw / 2, ny + nh * 0.5 + ns * 0.36, e.note, { size: ns, anchor: "middle" }));
      boxes.push({ x0: nx, y0: ny, w: nw, h: nh });
    }
    all.push(P.g(out, { cls: "map-entry map-entry-" + e.kind, meta: { kind: "entry", boxes, segs, dir: e.dir[0] || e.dir[1] ? [dx, dy] : [0, -1], th } }));
  }
  return all;
};

// ---- src/labels.js ----
// =============================================================================
// labels — where every word on the sheet goes
// =============================================================================
// Runs once a sheet's floors, links and ways in are built, in drawing space
// (the iso projection, or the plan with each floor at its offset). The fixed
// words (entry tags and their arrows, skip labels and tags, floor titles,
// STAIRS · LIFT, UNSURVEYED, the street) are placed already; the solver keeps
// every room label clear of them and of each other:
//   1. pins first, each at its room's centre, moved inside its room if it must;
//   2. then names, largest first, anywhere inside their own room;
//   3. a label with no room left inside goes outside, on a leader line to its
//      room; a name with nowhere to go becomes a pin (its name is in the key).
// Rooms tile their floor, so two names inside their own rooms never collide;
// what collides is a pin too big for its room, and the fixed words.

const LB = M.labels = {};

const hit = (a, b, g) => a.x0 < b.x0 + b.w + g && b.x0 < a.x0 + a.w + g && a.y0 < b.y0 + b.h + g && b.y0 < a.y0 + a.h + g;
// Does the segment [x1 y1 x2 y2] cross box b grown by g? (Liang–Barsky)
const segHit = ([x1, y1, x2, y2], b, g) => {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1, X0 = b.x0 - g, X1 = b.x0 + b.w + g, Y0 = b.y0 - g, Y1 = b.y0 + b.h + g;
  for (const [p, q] of [[-dx, x1 - X0], [dx, X1 - x1], [-dy, y1 - Y0], [dy, Y1 - y1]]) {
    if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
};
LB.hit = hit;

// A plain text piece's box (floor titles), at offset o.
LB.textBox = function (p, ctx, o = [0, 0]) {
  const ty = M.scene.type(ctx), size = p.size || 2, w = M.textW(p.s, size, ty.title, ty.titleLS || 0);
  const x0 = p.anchor === "end" ? p.x - w : p.anchor === "start" ? p.x : p.x - w / 2;
  return { x0: x0 + o[0], y0: p.y - size * 0.82 + o[1], w, h: size * 1.02 };
};

// The street's name lies on the ground: in iso its box is the projected one.
LB.groundBox = function (p, part, ctx, view) {
  const b = p.meta.box;
  if (view !== "iso") return { x0: b.x0 + part.tf.x, y0: b.y0 + part.tf.y, w: b.w, h: b.h };
  const c = G.rectPts({ x: b.x0, y: b.y0, w: b.w, h: b.h }).map(q => ctx.toScreen(p.meta.lv, q[0], q[1], 0));
  const xs = c.map(q => q[0]), ys = c.map(q => q[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

// Collect a sheet's fixed words and its room labels.
LB.collect = function ({ parts, links, entries, ctx, view }) {
  const fixed = [], segs = [], movers = [];
  const offOf = (part, p) => [(part.tf ? part.tf.x || 0 : 0) + (p && p.tf ? p.tf.x || 0 : 0), (part.tf ? part.tf.y || 0 : 0) + (p && p.tf ? p.tf.y || 0 : 0)];
  // ways in are placed first of the movable words: their tags slide out along their arrows
  const ways = (entries || []).filter(e => e && e.meta && e.meta.kind === "entry");
  // skip labels and floor tags float: they move a little off each other and off the fixed words
  const floaters = [];
  for (const l of links || []) if (l && l.meta && l.meta.box) floaters.push({ g: l, m: l.meta });
  // the street lies on the ground; a floor title that lands on it steps up
  const streets = [];
  for (const part of parts) for (const p of part.layers.site) if (p && p.meta && p.meta.kind === "street") streets.push(LB.groundBox(p, part, ctx, view));
  for (const part of parts) {
    const L = part.layers;
    L.labels.forEach((p, i) => {
      if (!p) return;
      if (p.t === "text" && p.r === "level-title") {
        let b = LB.textBox(p, ctx, offOf(part));
        for (let n = 0; n < 8 && streets.some(q => hit(b, q, 0.5)); n++) { p.y -= b.h * 0.6; b = LB.textBox(p, ctx, offOf(part)); }
        fixed.push(Object.assign({ what: "title" }, b)); return;
      }
      if (!p.meta) return;
      const o = offOf(part, p);
      if (p.meta.kind === "room") movers.push({ part, g: p, o, m: p.meta, i });
      else if (p.meta.box) fixed.push({ what: p.meta.kind, x0: p.meta.box.x0 + o[0], y0: p.meta.box.y0 + o[1], w: p.meta.box.w, h: p.meta.box.h });
    });
  }
  for (const b of streets) fixed.push(Object.assign({ what: "street" }, b));
  return { fixed, segs, movers, floaters, ways };
};

LB.solve = function (S0) {
  const { parts, ctx, view, bounds } = S0;
  const fu = ctx.floorU || 0, k = ctx.k, gap = Math.max(0.35, fu * 0.2);
  const { fixed, segs, movers, floaters, ways } = LB.collect(S0);
  const placed = fixed.slice();
  // Each way in: its tag (and the tail of its arrow) slides further out, or a
  // little to the side, until it is clear of the titles and the other ways in.
  for (const e of ways) {
    const m = e.meta, [dx, dy] = m.dir, px = -dy, py = dx, step = (m.th || 2) * 0.6;
    let pick = null;
    for (let i = 0; i < 14 && !pick; i++) for (const j of i ? [0, 1, -1, 2, -2] : [0]) {
      const ox = dx * step * i + px * step * 1.3 * j, oy = dy * step * i + py * step * 1.3 * j;
      const bs = m.boxes.map(b => ({ x0: b.x0 + ox, y0: b.y0 + oy, w: b.w, h: b.h }));
      if (bs.every(b => !placed.some(q => hit(b, q, gap)))) { pick = { ox, oy, bs }; break; }
    }
    if (!pick) pick = { ox: 0, oy: 0, bs: m.boxes };
    if (pick.ox || pick.oy) {
      for (const q of e.kids) {
        if (q.t === "line") { q.x1 += pick.ox; q.y1 += pick.oy; }
        else if (q.t === "rect" || q.t === "text") { q.x += pick.ox; q.y += pick.oy; }
        else if (q.t === "g" && q.tf) q.tf = Object.assign({}, q.tf, { x: q.tf.x + pick.ox, y: q.tf.y + pick.oy });
      }
      m.boxes = pick.bs;
      m.segs = (m.segs || []).map(([x1, y1, x2, y2]) => [x1 + pick.ox, y1 + pick.oy, x2, y2]);
    }
    for (const b of pick.bs) { placed.push(Object.assign({ what: "entry" }, b)); fixed.push(Object.assign({ what: "entry" }, b)); }
    for (const sg of m.segs || []) segs.push(sg);
  }
  const free = b => !placed.some(q => hit(b, q, gap)) && !segs.some(s => segHit(s, b, gap * 0.5));
  const area = bounds ? { x0: bounds.minX - 3 * Math.max(fu, 2), y0: bounds.minY - 3 * Math.max(fu, 2), x1: bounds.maxX + 3 * Math.max(fu, 2), y1: bounds.maxY + 3 * Math.max(fu, 2) } : null;
  const inArea = b => !area || (b.x0 >= area.x0 && b.y0 >= area.y0 && b.x0 + b.w <= area.x1 && b.y0 + b.h <= area.y1);
  // every room's outline in drawing space, so a label put outside its room
  // prefers the street and the margins to the rooms next door
  const rooms = movers.map(mv => {
    const a = [mv.m.anchor[0] + mv.o[0], mv.m.anchor[1] + mv.o[1]];
    return { mv, a, poly: mv.m.region ? mv.m.region.map(p => [p[0] + a[0], p[1] + a[1]]) : null };
  });
  const overRoom = (b, self) => rooms.some(R => R.mv !== self && R.poly && M.scene.insideBy(R.poly, b.x0 + b.w / 2, b.y0 + b.h / 2, 0));
  const boxAt = (mv, a, ox, oy) => { const b = mv.m.box; return { x0: a[0] + (b.x0 - mv.m.anchor[0]) + ox, y0: a[1] + (b.y0 - mv.m.anchor[1]) + oy, w: b.w, h: b.h }; };
  // a label may be more than one box (a name and its icons' tab): every part is tested
  const partsAt = (mv, a, ox, oy) => (mv.m.parts || [mv.m.box]).map(b => ({ x0: a[0] + (b.x0 - mv.m.anchor[0]) + ox, y0: a[1] + (b.y0 - mv.m.anchor[1]) + oy, w: b.w, h: b.h }));
  const relParts = mv => (mv.m.parts || [mv.m.box]).map(b => ({ cx: b.x0 + b.w / 2 - mv.m.anchor[0], cy: b.y0 + b.h / 2 - mv.m.anchor[1], w: b.w, h: b.h }));

  const candidates = (mv, a) => {
    const { w, h } = mv.m.box, rel = mv.m.region, out = [], rp = relParts(mv);
    if (mv.m.pin) out.push({ ox: 0, oy: 0, cost: 0, inside: true });
    if (rel) {
      const xs = rel.map(p => p[0]), ys = rel.map(p => p[1]);
      const step = Math.max(0.45, Math.min(w, h) * 0.22);
      const nx = Math.ceil(Math.max(Math.abs(Math.min(...xs)), Math.max(...xs)) / step), ny = Math.ceil(Math.max(Math.abs(Math.min(...ys)), Math.max(...ys)) / step);
      for (let i = -nx; i <= nx; i++) for (let j = -ny; j <= ny; j++) {
        const ox = i * step, oy = j * step;
        if ((ox || oy || !mv.m.pin) && rp.every(q => M.scene.boxIn(rel, ox + q.cx, oy + q.cy, q.w, q.h, 0.35))) out.push({ ox, oy, cost: Math.hypot(ox, oy * 1.3), inside: true });
      }
    }
    // outside, on a leader: rings around the room, nearest first
    const reach = rel ? Math.max(...rel.map(p => Math.hypot(p[0], p[1]))) : Math.max(w, h);
    for (let ring = 0; ring < 7; ring++) {
      const R = reach * 0.6 + Math.max(w, h) * (0.55 + 0.45 * ring) + gap;
      for (let d = 0; d < 16; d++) {
        const t = d * Math.PI / 8, ox = Math.cos(t) * (R + w * 0.25 * Math.abs(Math.cos(t))), oy = Math.sin(t) * R * 0.8;
        out.push({ ox, oy, cost: 40 + Math.hypot(ox, oy), inside: false });
      }
    }
    return out.sort((p, q) => p.cost - q.cost);
  };

  const order = movers.slice().sort((p, q) => (q.m.pin - p.m.pin) || (q.m.box.w * q.m.box.h - p.m.box.w * p.m.box.h) || (p.m.room.n - q.m.room.n));
  const leaders = [], boxes = [];
  const place = mv => {
    const a = [mv.m.anchor[0] + mv.o[0], mv.m.anchor[1] + mv.o[1]];
    let pick = null;
    for (const c of candidates(mv, a)) {
      const b = boxAt(mv, a, c.ox, c.oy), ps = partsAt(mv, a, c.ox, c.oy);
      if (!ps.every(free)) continue;
      if (!c.inside && (!inArea(b) || overRoom(b, mv))) continue;
      pick = { c, b, ps }; break;
    }
    if (!pick) {
      // outside over another room is better than nothing
      for (const c of candidates(mv, a)) { if (c.inside) continue; const b = boxAt(mv, a, c.ox, c.oy), ps = partsAt(mv, a, c.ox, c.oy); if (ps.every(free) && inArea(b)) { pick = { c, b, ps }; break; } }
    }
    return pick;
  };
  const commit = (mv, pick) => {
    const { c, b } = pick, ps = pick.ps || [b];
    mv.g.tf = Object.assign({}, mv.g.tf || {}, { x: ((mv.g.tf && mv.g.tf.x) || 0) + c.ox, y: ((mv.g.tf && mv.g.tf.y) || 0) + c.oy });
    for (const q of ps) { placed.push(Object.assign({ what: "room" }, q)); boxes.push(q); }
    if (!c.inside) {
      const a = [mv.m.anchor[0] + mv.o[0], mv.m.anchor[1] + mv.o[1]];
      const pt = view === "iso" && ctx.toScreen && mv.m.lv ? ctx.toScreen(mv.m.lv, mv.m.anchor[0], mv.m.anchor[1], 0) : a;
      const ex = Math.max(b.x0, Math.min(pt[0], b.x0 + b.w)), ey = Math.max(b.y0, Math.min(pt[1], b.y0 + b.h));
      leaders.push({ part: mv.part, pts: [pt, [ex, ey]] });
      mv.m.leader = true;
    }
  };
  // nowhere free: the spot that overlaps least
  const overlapArea = b => placed.reduce((s, q) => { const ox = Math.min(b.x0 + b.w, q.x0 + q.w) - Math.max(b.x0, q.x0), oy = Math.min(b.y0 + b.h, q.y0 + q.h) - Math.max(b.y0, q.y0); return s + (ox > 0 && oy > 0 ? ox * oy : 0); }, 0);
  const leastBad = mv => {
    const a = [mv.m.anchor[0] + mv.o[0], mv.m.anchor[1] + mv.o[1]];
    let best = null;
    for (const c of candidates(mv, a)) {
      const b = boxAt(mv, a, c.ox, c.oy), ps = partsAt(mv, a, c.ox, c.oy);
      if (!c.inside && !inArea(b)) continue;
      const cost = ps.reduce((s2, q) => s2 + overlapArea(q), 0) * 10 + c.cost * 0.01;
      if (!best || cost < best.cost) best = { c, b, ps, cost };
    }
    return best || { c: { ox: 0, oy: 0, inside: true }, b: boxAt(mv, a, 0, 0) };
  };
  const later = [];
  for (const mv of order) {
    const pick = place(mv);
    if (pick) { commit(mv, pick); continue; }
    if (!mv.m.pin) later.push(mv); else commit(mv, leastBad(mv));
  }
  // names with nowhere to go become pins
  for (const mv of later) {
    const m = mv.m, g2 = M.scene.labelBlock(m.room, m.anchor[0], m.anchor[1], m.icons || [], ctx, m.region, { lv: m.lv, pin: true });
    g2.tf = mv.g.tf ? Object.assign({}, mv.g.tf) : undefined;
    const L = mv.part.layers.labels, at = L.indexOf(mv.g);
    if (at >= 0) L[at] = g2;
    const mv2 = Object.assign({}, mv, { g: g2, m: g2.meta });
    const pick = place(mv2) || leastBad(mv2);
    commit(mv2, pick);
  }
  // then skip labels and floor tags, each as near its anchor as it can be
  // A skip label with nowhere to go is set on two lines; failing that it
  // leaves the drawing and the key spells the link out (opts._dropped).
  const dropped = [];
  const ty = M.scene.type(ctx);
  for (const f of floaters) {
    const variants = [{ b0: f.m.box }];
    if (f.m.kind === "skip" && f.m.text && /\s/.test(f.m.text)) {
      const ts = f.m.size, lines = M.splitEven(f.m.text, 2, ts, ty.label), w = Math.max(...lines.map(l => M.textW(l, ts, ty.label))) + 0.4 * ts, [cx, yb] = f.m.at;
      variants.push({ lines, b0: { x0: cx - w / 2, y0: yb - ts * 0.85 - ts * 0.55, w, h: ts * 2.2 } });
    }
    let pick = null;
    for (const v of variants) {
      const b0 = v.b0, step = Math.max(0.6, b0.h * 0.5);
      for (let ring = 0; ring < 9 && !pick; ring++) for (let d = 0; d < (ring ? 16 : 1); d++) {
        const t = d * Math.PI / 8, ox = Math.cos(t) * ring * step * 1.4, oy = Math.sin(t) * ring * step;
        const b = { x0: b0.x0 + ox, y0: b0.y0 + oy, w: b0.w, h: b0.h };
        if (!placed.some(q => hit(b, q, gap)) && inArea(b)) { pick = { ox, oy, b, v }; break; }
      }
      if (pick) break;
    }
    if (!pick) { if (f.m.kind === "skip") { f.g.kids = []; if (f.m.link) dropped.push(f.m.link); continue; } pick = { ox: 0, oy: 0, b: f.m.box, v: variants[0] }; }
    if (pick.v.lines) { const tx = f.g.kids[0]; f.g.kids = [Object.assign({}, tx, { lines: pick.v.lines, y: f.m.at[1] - f.m.size * 0.55 + f.m.size * 1.1 * 0.5, lh: 1.1 })]; }
    if (pick.ox || pick.oy) f.g.tf = { x: pick.ox, y: pick.oy };
    placed.push(Object.assign({ what: f.m.kind }, pick.b));
    fixed.push(Object.assign({ what: f.m.kind }, pick.b));
  }
  ctx.opts._dropped = dropped;
  // leader lines go under the labels, from a dot on the room's floor
  for (const { part, pts } of leaders) {
    const ox = part.tf ? part.tf.x || 0 : 0, oy = part.tf ? part.tf.y || 0 : 0;
    const [[x1, y1], [x2, y2]] = pts;
    part.layers.labels.unshift(P.g([P.line("leader", x1 - ox, y1 - oy, x2 - ox, y2 - oy, { sw: Math.max(0.22, 0.2 * k) }), P.circle("leader-dot", x1 - ox, y1 - oy, Math.max(0.45, 0.4 * k))], { cls: "map-leader" }));
  }
  return { boxes, fixed, leaders: leaders.length };
};

// ---- src/iso.js ----
// =============================================================================
// iso — the floor plan as an exploded isometric
// =============================================================================
// Same layout as the plan view (same seed, same walls, same doors), projected:
// floors and furniture are skewed onto the ground plane, walls are extruded as
// cutaway boxes, and everything that has to be read — labels, icons, entry
// tags — stays upright. Floors stack bottom to top: basement, street, upstairs.
//
// The projection is the 2:1 isometric of a 30° axonometric, seen from the
// front-right corner (vx = 1) or the front-left (vx = −1); the layout picks the
// corner that shows the ways in (lay.isoCorner, see L.entries):
//   screen x = (x − vx·y) · cos 30°,  screen y = (vx·x + y) · sin 30° − z

const ISO = M.iso = {};
const IC = Math.cos(Math.PI / 6), IS = 0.5;
const WALL_H = { ext: 7, ring: 5, int: 5, glass: 4.5, soft: 3 }, CUT_H = 2.4, CUT_WAY = 0.4;

// Where a way in comes through a far exterior wall (L.entries: lv.cutaways), the
// stretch of that wall that would hide its door, what stands outside it and its
// arrow's tip, as [lo, hi] along the wall. A point d ft out from a wall h ft
// high is hidden behind the wall at d·px(n)/px(t) along it, while d <= h.
function cutSpans(lv, vx) {
  const B = lv.bbox, out = [];
  for (const c of lv.cutaways || []) {
    const h = c.side === "top" || c.side === "bottom", n = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] }[c.side];
    const line = { top: B.y, bottom: B.y + B.h, left: B.x, right: B.x + B.w }[c.side];
    const ratio = ((n[0] - vx * n[1]) * IC) / ((h ? 1 : -vx) * IC);
    let lo = Infinity, hi = -Infinity;
    for (const p of c.pts) {
      const a = h ? p[0] : p[1], d = Math.max(0, Math.min(WALL_H.ext, (h ? p[1] - line : p[0] - line) * (h ? n[1] : n[0])));
      lo = Math.min(lo, a, a + d * ratio); hi = Math.max(hi, a, a + d * ratio);
    }
    out.push({ side: c.side, h, line, lo: lo - 0.6, hi: hi + 0.6 });
  }
  return out;
}

ISO.projFor = vx => (x, y, z) => [(x - vx * y) * IC, (vx * x + y) * IS - z];
ISO.proj = ISO.projFor(1);
ISO.vx = lay => (lay && lay.isoCorner === "left" ? -1 : 1);

// Each wall becomes a box: its viewer-facing side, its viewer-facing end, and
// its top. Exterior walls on the two near sides are cut down so the rooms read.
// Each face carries its painter's key (dk) and its plan normal (nrm) for a
// theme that lights faces (the plate); rec, when given, gets each wall as
// drawn ({ a, b, h, t }) for the shadows it casts. Neither reaches the file.
function wallBoxes(lv, P0, hiddenAt, vx = 1, rec) {
  const cx = lv.bbox.x + lv.bbox.w / 2, cy = lv.bbox.y + lv.bbox.h / 2;
  const segs = [];
  for (const w of lv.walls) {
    if (w.arc) {
      const n = Math.max(2, Math.ceil((w.a1 - w.a0) / 0.2));
      for (let i = 0; i < n; i++) {
        const t0 = w.a0 + (w.a1 - w.a0) * i / n, t1 = w.a0 + (w.a1 - w.a0) * (i + 1) / n;
        segs.push({ a: [w.cx + Math.cos(t0) * w.r, w.cy + Math.sin(t0) * w.r], b: [w.cx + Math.cos(t1) * w.r, w.cy + Math.sin(t1) * w.r], t: w.t, arc: w });
      }
    } else segs.push({ a: w.a, b: w.b, t: w.t });
  }
  // a far wall a way in comes through is cut down there (cutSpans)
  for (const c of cutSpans(lv, vx)) for (const s of segs.splice(0)) {
    const k = c.h ? 1 : 0, on = !s.arc && Math.abs(s.a[k] - c.line) < 0.05 && Math.abs(s.b[k] - c.line) < 0.05;
    const u0 = on ? Math.min(s.a[1 - k], s.b[1 - k]) : 0, u1 = on ? Math.max(s.a[1 - k], s.b[1 - k]) : 0;
    if (!on || c.hi <= u0 || c.lo >= u1) { segs.push(s); continue; }
    const at = u => k ? [u, c.line] : [c.line, u], fwd = s.b[1 - k] >= s.a[1 - k];
    const keep = s.cutH != null ? s.cutH : null, cut = Math.min(CUT_WAY, keep != null ? keep : CUT_WAY);
    const cuts = [[u0, Math.max(u0, c.lo), keep], [Math.max(u0, c.lo), Math.min(u1, c.hi), cut], [Math.min(u1, c.hi), u1, keep]].filter(([p, q]) => q - p > 0.05);
    for (const [p, q, hh] of fwd ? cuts : cuts.reverse()) segs.push(Object.assign({}, s, fwd ? { a: at(p), b: at(q) } : { a: at(q), b: at(p) }, hh != null ? { cutH: hh } : {}));
  }
  const boxes = [];
  for (const s of segs) {
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], len = Math.hypot(dx, dy);
    if (len < 0.05) continue;
    // an open-air site's line, rail, fence, parapet or quay edge (outdoors.js)
    const od = M.outdoors.isoWall(s, P0, vx); if (od) { boxes.push(od); continue; }
    let nx = -dy / len, ny = dx / len;
    const th = { ext: 1.6, ring: 1.15, int: 0.6, glass: 0.45, soft: 0.35 }[s.t] || 0.6;
    const mx = (s.a[0] + s.b[0]) / 2, my = (s.a[1] + s.b[1]) / 2;
    // Player cover: a wall with hidden rooms on both sides isn't drawn at all.
    if (hiddenAt && s.t !== "ext") {
      const h1 = hiddenAt(mx + nx * 1.2, my + ny * 1.2), h2 = hiddenAt(mx - nx * 1.2, my - ny * 1.2);
      if (h1 !== false && h2 !== false) continue;
    }
    let h = s.cutH != null ? s.cutH : WALL_H[s.t] || 5;
    if (s.t === "ext") {
      // outward = away from the floor's centre (or the pod's centre for arcs)
      const ocx = s.arc ? s.arc.cx : cx, ocy = s.arc ? s.arc.cy : cy;
      const out = (mx - ocx) * nx + (my - ocy) * ny > 0 ? 1 : -1;
      if ((vx * nx + ny) * out > 0.05) h = CUT_H;
    }
    if (vx * nx + ny < 0) { nx = -nx; ny = -ny; }            // the face the viewer sees
    const o = th / 2;
    const A = [s.a[0] + nx * o, s.a[1] + ny * o], B = [s.b[0] + nx * o, s.b[1] + ny * o];
    const A2 = [s.a[0] - nx * o, s.a[1] - ny * o], B2 = [s.b[0] - nx * o, s.b[1] - ny * o];
    const pts = [], key = vx * mx + my;
    if (rec) rec.push({ a: s.a, b: s.b, h, t: s.t });
    pts.push(P.poly("wallf-" + s.t, [P0(A, 0), P0(B, 0), P0(B, h), P0(A, h)], { dk: key, nrm: [nx, ny] }));
    const endB = vx * dx + dy > 0;                             // which end faces the viewer
    const E1 = endB ? B : A, E2 = endB ? B2 : A2;
    pts.push(P.poly("walle-" + s.t, [P0(E1, 0), P0(E2, 0), P0(E2, h), P0(E1, h)], { dk: key, nrm: endB ? [dx / len, dy / len] : [-dx / len, -dy / len] }));
    pts.push(P.poly("wallt-" + s.t, [P0(A, h), P0(B, h), P0(B2, h), P0(A2, h)], { dk: key }));
    boxes.push({ key, pieces: pts });
  }
  boxes.sort((p, q) => p.key - q.key);
  return boxes.flatMap(b => b.pieces);
}

// Lift a piece list's upright things (label blocks, icons, free text) out of a
// skewed layer into screen space at the given height.
function upright(pieces, lv, toScreen, z) {
  const out = [];
  for (const p of pieces) {
    if (p.t === "g" && p.anchor) {
      const [sx, sy] = toScreen(lv, p.anchor[0], p.anchor[1], z);
      out.push(Object.assign({}, p, { tf: { x: sx - p.anchor[0], y: sy - p.anchor[1] } }));
    } else if (p.t === "g" && p.tf && /icon/.test(p.cls || "")) {
      const [sx, sy] = toScreen(lv, p.tf.x, p.tf.y, z);
      out.push(Object.assign({}, p, { tf: Object.assign({}, p.tf, { x: sx, y: sy }) }));
    } else if (p.t === "text") {
      const [sx, sy] = toScreen(lv, p.x, p.y, z);
      out.push(Object.assign({}, p, { x: sx, y: sy }));
    } else out.push(p);
  }
  return out;
}

// Build the parts for composePage, stacked bottom to top.
ISO.build = function (lay, model, ctx) {
  const { k } = ctx;
  const order = lay.levels.slice().sort((a, b) => a.lvl - b.lvl);
  const shift = new Map(), zOf = new Map();
  let z = 0;
  order.forEach((lv, i) => {
    const sx = -(lv.bbox.x + lv.bbox.w / 2), sy = -(lv.bbox.y + lv.bbox.h / 2);
    shift.set(lv, [sx, sy]);
    if (i > 0) {
      const prev = order[i - 1];
      z += (prev.bbox.w + prev.bbox.h) * IS * 0.5 + (lv.bbox.w + lv.bbox.h) * IS * 0.5 + 10 + 6 * k;
    }
    zOf.set(lv, z);
  });
  const lift = { room: 8, floor: 0, label: 8 };
  const vx = ISO.vx(lay), proj = ISO.projFor(vx);
  // Floor titles sit off each floor's left corner at the type floor's size. When the page draws the
  // building small (a long key on the iPad), two titles can outgrow the gap between their floors:
  // open the gap just enough that they clear each other. A sheet whose titles clear already is unchanged.
  if (M.showTitles(lay, ctx)) {
    const ts = Math.max(3.4 * k, ctx.floorU || 0), ty = M.scene.type(ctx);
    const cornerOf = (lv) => { const [sx, sy] = shift.get(lv), p = vx > 0 ? [lv.bbox.x, lv.bbox.y + lv.bbox.h] : [lv.bbox.x, lv.bbox.y]; return proj(p[0] + sx, p[1] + sy, zOf.get(lv)); };
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1], b = order[i];
      if (!a.title || !b.title) continue;
      const ca = cornerOf(a), cb = cornerOf(b), x = (c, lv) => [c[0] - 4 * k - M.textW(lv.title.toUpperCase(), ts, ty.title, ty.titleLS || 0), c[0] - 4 * k];
      const xa = x(ca, a), xb = x(cb, b), need = ts * 1.3 - (ca[1] - cb[1]);
      if (xa[0] < xb[1] && xb[0] < xa[1] && need > 0) for (let j = i; j < order.length; j++) zOf.set(order[j], zOf.get(order[j]) + need);
    }
  }
  const toScreen = (lv, x, y, kind) => {
    const [sx, sy] = shift.get(lv) || [0, 0];
    return proj(x + sx, y + sy, (zOf.get(lv) || 0) + (typeof kind === "number" ? kind : (lift[kind] || 0)));
  };
  const dirScreen = d => { const x = (d[0] - vx * d[1]) * IC, y = (vx * d[0] + d[1]) * IS, l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  ctx.toScreen = toScreen; ctx.dirScreen = dirScreen; ctx.linkAcross = true;   // floors are stacked: links between them are real lines
  ctx.isoVx = vx;

  const parts = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
  // Draw the top floor last so it sits over the one below.
  for (const lv of order) {
    const [sx, sy] = shift.get(lv), zz = zOf.get(lv);
    const mat = `matrix(${IC.toFixed(5)} ${vx * IS} ${(-vx * IC).toFixed(5)} ${IS} ${(IC * (sx - vx * sy)).toFixed(3)} ${(IS * (vx * sx + sy) - zz).toFixed(3)})`;
    const layers = M.scene.level(lv, model, ctx);
    const P0 = (p, h) => toScreen(lv, p[0], p[1], h);
    // The player copy arrives sealed (S.seal): walls and doors that face only
    // unsurveyed rooms are already gone, and the cover is in the floor layer.
    const hiddenAt = null;
    // Floor slab: the two near edges, extruded down.
    const slab = [], d = 1.6;
    if (lv.exterior.kind === "rect" || lv.exterior.kind === "hull") {
      const B = lv.bbox, c = G.rectPts(B);
      const [s0, s1] = vx > 0 ? [c[1], c[2]] : [c[3], c[0]];
      slab.push(P.poly("slab", [P0(c[2], 0), P0(c[3], 0), P0(c[3], -d), P0(c[2], -d)]), P.poly("slab-side", [P0(s0, 0), P0(s1, 0), P0(s1, -d), P0(s0, -d)]));
    } else {
      const pts = [];
      const r = lv.exterior.kind === "hub" ? lv.exterior.r : lv.exterior.r, ccx = lv.exterior.cx || 0, ccy = lv.exterior.cy || 0;
      const ca = Math.atan2(1, vx);
      for (let a = ca - Math.PI / 2; a <= ca + Math.PI / 2 + 0.01; a += Math.PI / 24) pts.push([ccx + Math.cos(a) * r, ccy + Math.sin(a) * r]);
      slab.push(P.poly("slab", pts.map(p => P0(p, 0)).concat(pts.slice().reverse().map(p => P0(p, -d)))));
    }
    // Upper floors float: no ground, no street.
    if (lv.lvl !== 0) layers.site = layers.site.filter(p => ["footprint", "hull", "deck"].includes(p.r));
    const drawnWalls = [];
    const walls = slab.concat(wallBoxes(lv, P0, hiddenAt, vx, drawnWalls));
    layers.walls = walls;
    // Icons and labels upright, at head height above their floor.
    const lifted = [];
    layers.game = layers.game.filter(p => { if (p.t === "g" && /icon/.test(p.cls || "")) { lifted.push(p); return false; } return true; });
    layers.labels = upright(lifted.concat(layers.labels), lv, toScreen, lift.label);
    // A floor's title sits off its left corner (every floor of a building with
    // more than one, so a one-floor sheet still says which floor it is).
    const corner = P0(vx > 0 ? [lv.bbox.x, lv.bbox.y + lv.bbox.h] : [lv.bbox.x, lv.bbox.y], 0), ts = Math.max(3.4 * k, ctx.floorU || 0);
    if (lv.title && M.showTitles(lay, ctx)) layers.labels.push(P.text("level-title", corner[0] - 4 * k, corner[1] + ts * 0.35, lv.title.toUpperCase(), { size: ts, anchor: "end" }));
    // iso: what a theme that lights the floor (the plate) needs to draw on it
    parts.push({ lv, layers, tf: { x: 0, y: 0 }, tfs: { site: mat, floors: mat, furn: `translate(0 -0.9) ${mat}`, doors: mat, game: mat, cover: mat }, iso: { mat, vx, P0, walls: drawnWalls, lift: 0.9 } });
    // bounds: the footprint at floor level and wall top
    const SB = lv.siteBox || lv.bbox;
    const c = lv.exterior.kind === "circle" || lv.exterior.kind === "hub" ? G.rectPts(SB) : G.rectPts({ x: SB.x - 10, y: SB.y - 10, w: SB.w + 20, h: SB.h + 20 + (lv.lvl === 0 ? 10 : 0) });
    for (const p of c) { const q = P0(p, 0); grow(q[0], q[1]); const r = P0(p, 9); grow(r[0], r[1]); }
    if (lv.title && M.showTitles(lay, ctx)) { const ty = M.scene.type(ctx); grow(corner[0] - 4 * k - M.textW(lv.title.toUpperCase(), ts, ty.title, ty.titleLS || 0), corner[1]); }
  }
  // The stair core, threaded up through the floors.
  const coreLinks = [];
  for (let i = 0; i < order.length - 1; i++) {
    const a = order[i].core, b = order[i + 1].core;
    if (!a || !b || !a.frame || !b.frame) continue;
    const p = toScreen(order[i], a.frame.cx, a.frame.cy, 0), q = toScreen(order[i + 1], b.frame.cx, b.frame.cy, 0);
    coreLinks.push(P.line("core-link", p[0], p[1], q[0], q[1], { sw: 0.5 * k }));
  }
  return { parts, coreLinks, bounds: { minX, minY, maxX, maxY } };
};

// ---- src/section.js ----
// =============================================================================
// section — the building cut open, every floor at once
// =============================================================================
// Built from the plan layout, so the floors, the rooms on each floor and their
// left-to-right order all match the plan view. What the section adds is
// height: the street at ground level, the basement in the earth, the roof,
// and every link between floors drawn as what it is — a skylight dropping
// onto the vault, a cellar door coming up under the counting room.
//
// Each printed building style gets its own shell (the generator's D10 again):
//   hard     Brutalist      thick slabs with cantilevered lips, a parapet
//   glazed   Modernist      thin slabs, a glass curtain wall
//   blurred  Old relic      a pitched roof, a chimney, brick
//   spine    Corporate chic flat roof, plant on top, drop ceilings everywhere
//   soft     Alternative    an arched roof, no doors in the partitions
//   radial   Futurist       pill-shaped floors and a dome
// A Ship is a hull below the waterline instead (see hull in layout.js).

const SEC = M.section = {};
const FLOOR_H = 14, BASE_H = 13;

// --- Side-view fixtures ------------------------------------------------------------
// Each draws standing on y = 0, rising to negative y, w feet wide, centred on 0.
const sv = {
  table: (w, h) => [P.rect("fx", -w / 2, -h, w, 0.4), P.rect("fx3", -w / 2 + 0.2, -h + 0.4, 0.25, h - 0.4), P.rect("fx3", w / 2 - 0.45, -h + 0.4, 0.25, h - 0.4)],
  block: (w, h, r = "fx") => [P.rect(r, -w / 2, -h, w, h)],
  cabinet: (w, h, r = "fxm") => { const k = [P.rect(r, -w / 2, -h, w, h)]; for (let y = -h + 1.2; y < -0.3; y += 1.3) k.push(P.rect("fx3", -w / 2, y, w, 0.1)); return k; },
  shelves: (w, h, alt) => { const k = [P.rect("fx", -w / 2, -h, w, 0.2), P.rect("fx", -w / 2, -0.2, w, 0.2)]; for (let y = -h + 1.4; y < -0.3; y += 1.4) { k.push(P.rect("fx", -w / 2, y, w, 0.15)); for (let x = -w / 2 + 0.2; x < w / 2 - 0.3; x += 0.6) k.push(P.rect(alt && (x * 3 | 0) % 2 ? "fx2" : "fxl", x, y - 1.05, 0.4, 1.05)); } k.push(P.rect("fx3", -w / 2, -h, 0.2, h), P.rect("fx3", w / 2 - 0.2, -h, 0.2, h)); return k; },
  seat: (w) => [P.rect("fx2", -w / 2, -1.6, w, 0.6, { rx: 0.2 }), P.rect("fx2", -w / 2, -3, Math.min(0.6, w * 0.25), 1.6, { rx: 0.2 }), P.rect("fx3", -w / 2 + 0.3, -1, 0.2, 1), P.rect("fx3", w / 2 - 0.5, -1, 0.2, 1)],
  sofa: (w) => [P.rect("fx2", -w / 2, -1.7, w, 1.2, { rx: 0.4 }), P.rect("fx2", -w / 2, -2.9, w, 1.3, { rx: 0.4 }), P.rect("fx", -w / 2 + 0.3, -2.0, w - 0.6, 0.5, { rx: 0.2 }), P.rect("fx3", -w / 2 + 0.3, -0.5, 0.3, 0.5), P.rect("fx3", w / 2 - 0.6, -0.5, 0.3, 0.5)],
  bed: (w, bunk) => { const k = [P.rect("fx", -w / 2, -1.9, w, 0.9), P.rect("fx2", -w / 2 + 0.2, -2.3, w - 0.4, 0.5, { rx: 0.2 }), P.rect("fxl", -w / 2 + 0.2, -2.6, 1.6, 0.5, { rx: 0.25 }), P.rect("fx3", -w / 2, -2.8, 0.3, 2.8)]; if (bunk) k.push(P.rect("fx", -w / 2, -5.4, w, 0.6), P.rect("fx2", -w / 2 + 0.2, -5.8, w - 0.4, 0.4), P.rect("fx3", w / 2 - 0.3, -6, 0.3, 6)); return k; },
  plant: (w) => [P.rect("fx2", -0.6, -1.4, 1.2, 1.4), P.circle("fxg", 0, -2.6, 1.1), P.circle("fxg", -0.6, -3.3, 0.8), P.circle("fxg", 0.5, -3.5, 0.75)],
  tree: (w) => [P.rect("fx3", -0.3, -4, 0.6, 4), P.circle("fxg", 0, -6, Math.max(2, w / 2.4)), P.circle("fxg", -1.2, -5, Math.max(1.3, w / 3.4))],
  machine: (w, h) => [P.rect("fxm", -w / 2, -h, w, h, { rx: 0.3 }), P.rect("fx3", -w / 2 + 0.6, -h + 0.8, w * 0.4, h * 0.4), P.circle("fx2", w / 4, -h * 0.65, Math.min(0.7, w / 6)), P.rect("fx2", -w / 2, -0.8, w, 0.3)],
  tank: (w, h) => [P.rect("fxm", -w / 2, -h, w, h, { rx: w / 2.2 }), P.rect("fx3", -w / 2, -h * 0.55, w, 0.25), P.rect("fx2", -w / 2 + 0.4, -h * 0.82, w - 0.8, 0.4)],
  wall: (w, y0, y1, r = "fx3") => [P.rect(r, -w / 2, -y1, w, y1 - y0)],
  stairs: (w, h) => { const k = [], n = Math.max(4, Math.round(h / 0.6)); for (let i = 0; i < n; i++) k.push(P.rect("fxl", -w / 2 + w * i / n, -h * (i + 1) / n, w / n + 0.05, h * (i + 1) / n)); k.push(P.poly("fx3", [[-w / 2, 0], [w / 2, -h], [w / 2, -h + 0.4], [-w / 2, 0.4]])); return k; },
  ladder: (h) => { const k = [P.rect("fx3", -0.8, -h, 0.2, h), P.rect("fx3", 0.6, -h, 0.2, h)]; for (let y = -0.8; y > -h; y -= 1) k.push(P.rect("fx3", -0.8, y, 1.6, 0.15)); return k; },
  hang: (w) => [P.rect("fx3", -0.05, -FLOOR_H + 0.8, 0.1, 2.6), P.poly("fx2", [[-w / 3, -FLOOR_H + 4.2], [w / 3, -FLOOR_H + 4.2], [0, -FLOOR_H + 3.2]]), P.circle("fxglow", 0, -FLOOR_H + 4.4, 0.35)],
  person: (r = "fx3") => [P.circle(r, 0, -5.4, 0.55), P.rect(r, -0.6, -4.8, 1.2, 2.6, { rx: 0.4 }), P.rect(r, -0.5, -2.3, 0.4, 2.3), P.rect(r, 0.1, -2.3, 0.4, 2.3)]
};
const SIDE = {
  // Out of doors (0.8): the upright pieces an open-air site is dressed with
  "container": w => { const W = Math.min(w, 20), k = [P.rect("fxm", -W / 2, -8.4, W, 8.4)]; for (let x = -W / 2 + 0.9; x < W / 2 - 0.5; x += 1.3) k.push(P.rect("fx3", x, -8.1, 0.12, 7.8)); return k; },
  "stall": w => { const W = Math.min(w, 7); return [P.rect("fx", -W / 2, -3.2, W, 0.4), P.rect("fx2", -W / 2 + 0.3, -2.8, W - 0.6, 2.8), P.rect("fx3", -W / 2, -7, 0.2, 7), P.rect("fx3", W / 2 - 0.2, -7, 0.2, 7), P.poly("fxl", [[-W / 2 - 0.6, -6.4], [W / 2 + 0.6, -6.4], [W / 2, -7.6], [-W / 2, -7.6]])]; },
  "tyres": () => [0, 1, 2].map(i => P.rect("fx3", -1.4, -0.9 * (i + 1), 2.8, 0.85, { rx: 0.4 })),
  "grandstand": w => sv.stairs(Math.min(w, 18), 7).concat([P.rect("fx3", -Math.min(w, 18) / 2, -FLOOR_H + 0.8, Math.min(w, 18), 0.6)]),
  "bollard": () => [P.rect("fx3", -0.4, -2.6, 0.8, 2.6, { rx: 0.3 })],
  "barrier-arm": w => [P.rect("fx3", -Math.min(w, 10) / 2, -3.4, 0.8, 3.4), P.rect("fxl", -Math.min(w, 10) / 2, -3.2, Math.min(w, 10), 0.4)],
  "chair": w => sv.seat(1.6), "stool": () => [P.circle("fx3", 0, -2.6, 0.6), P.rect("fx3", -0.1, -2.4, 0.2, 2.4)],
  "armchair": () => sv.sofa(2.6), "bubble-chair": () => [P.circle("fxl", 0, -2.2, 1.6), P.circle("fx2", 0.2, -2.1, 1.1), P.rect("fx3", -0.1, -0.6, 0.2, 0.6)],
  "sofa": w => sv.sofa(Math.min(w, 6.5)), "sofa-curve": w => sv.sofa(Math.min(w, 8)), "booth": w => sv.sofa(Math.min(w, 5.2)).concat(sv.table(3, 2.6)), "lounger": () => [P.poly("fxl", [[-3, -1.2], [1.6, -1.2], [3, -2.8], [3, -2.4], [1.8, -0.9], [-3, -0.9]]), P.rect("fx3", -2.6, -0.9, 0.2, 0.9), P.rect("fx3", 1.4, -0.9, 0.2, 0.9)],
  "table": () => sv.table(2.6, 2.6).concat(sv.seat(1.4).map(p => Object.assign(p, { tf: { x: -1.7 } }))), "table-round": () => sv.table(2.9, 2.6), "table-long": w => sv.table(Math.min(w, 14), 2.6),
  "coffee-table": () => sv.table(3.4, 1.4), "rug": () => [P.rect("fx2", -3, -0.12, 6, 0.12)],
  "desk": () => sv.table(5, 2.6).concat([P.rect("fxl", -1.6, -3, 1.1, 0.4), P.rect("fx3", 1, -3.4, 0.8, 0.8, { rx: 0.4 })]), "desk-big": () => sv.block(7, 2.7, "fx").concat([P.rect("fx2", -3.5, -2.9, 7, 0.3), P.rect("fx3", 2, -3.5, 0.9, 0.7, { rx: 0.4 })]),
  "typing-desk": () => sv.table(3.8, 2.4).concat([P.rect("fxm", -0.8, -3.1, 1.6, 0.7)]),
  "filing": w => sv.cabinet(Math.min(w, 8), 5, "fxm"), "shelf": w => sv.shelves(Math.min(w, 10), 7, true), "bookcase": w => sv.shelves(Math.min(w, 8), 7.5),
  "counter": w => sv.block(Math.min(w, 12), 3.6, "fx").concat([P.rect("fx2", -Math.min(w, 12) / 2, -3.8, Math.min(w, 12), 0.3)]),
  "bar": w => sv.block(Math.min(w, 12), 3.6, "fx").concat([P.rect("fx2", -Math.min(w, 12) / 2, -3.9, Math.min(w, 12), 0.35)], sv.shelves(Math.min(w, 12), 7).map(p => Object.assign(p, { opacity: 0.5 }))),
  "workbench": w => sv.table(Math.min(w, 8), 3).concat([P.rect("fxm", -1.6, -4, 1.4, 1)]), "console": w => [P.poly("fxm", [[-Math.min(w, 8) / 2, 0], [Math.min(w, 8) / 2, 0], [Math.min(w, 8) / 2, -3], [-Math.min(w, 8) / 2, -4.2]]), P.rect("fx2", -Math.min(w, 8) / 2 + 0.5, -3.8, Math.min(w, 8) - 1, 0.25)],
  "monitor-wall": w => { const W = Math.min(w, 10), k = []; for (let x = -W / 2 + 0.2; x < W / 2 - 1; x += 1.7) for (let y = -8; y < -4; y += 1.8) k.push(P.rect("fx3", x, y, 1.5, 1.5), P.rect("fxglow", x + 0.2, y + 0.2, 1.1, 1.1)); return k; },
  "computer": () => sv.cabinet(4, 6.5, "fxm").concat([P.circle("fx3", -0.9, -4.6, 0.6), P.circle("fx3", 0.9, -4.6, 0.6)]), "chalkboard": w => sv.wall(Math.min(w, 8), 3, 7.5), "lockers": w => sv.cabinet(Math.min(w, 8), 6.5, "fxm"),
  "bed": () => sv.bed(6.8), "bed-round": () => sv.bed(8.6), "bunk": () => sv.bed(6.3, true), "wardrobe": () => sv.block(4, 6.5, "fx").concat([P.rect("fx3", -0.05, -6.5, 0.1, 6.5)]),
  "stove": () => sv.block(2.5, 3, "fxm"), "sink": () => sv.block(2.5, 3, "fxm"), "kitchen-run": w => sv.block(Math.min(w, 12), 3, "fx").concat([P.rect("fx3", -Math.min(w, 12) / 2, -3.2, Math.min(w, 12), 0.2)], sv.block(Math.min(w, 12), 2, "fx").map(p => Object.assign(p, { y: -7.5 }))),
  "toilet-stall": () => [P.rect("fxm", -1.5, -6.5, 0.15, 6), P.rect("fxm", 1.35, -6.5, 0.15, 6), P.rect("fxl", -0.6, -1.4, 1.2, 1.4, { rx: 0.4 })], "bath": () => sv.block(5.5, 2, "fxl"),
  "piano": () => sv.block(5.5, 3.2, "fx3").concat([P.rect("fx3", -2.6, -1, 0.3, 1), P.rect("fx3", 2.3, -1, 0.3, 1), P.poly("fx3", [[-2.75, -3.2], [2.75, -3.2], [2.2, -5]])]),
  "plant": w => sv.plant(w), "planter": w => [P.rect("fx2", -Math.min(w, 8) / 2, -1.6, Math.min(w, 8), 1.6)].concat([-2, 0, 2].map(x => P.circle("fxg", x, -2.4, 1.1))), "topiary": () => [P.rect("fx2", -0.6, -1.2, 1.2, 1.2), P.circle("fxg", 0, -2.6, 1.4)], "hedge": w => [P.rect("fxg", -Math.min(w, 8) / 2, -3.5, Math.min(w, 8), 3.5, { rx: 0.8 })], "tree": w => sv.tree(w || 7),
  "pool": w => [P.rect("fxw", -Math.min(w, 16) / 2, 0, Math.min(w, 16), 3), P.rect("fxl", -Math.min(w, 16) / 2 - 0.5, -0.2, Math.min(w, 16) + 1, 0.25)], "water": w => [P.rect("fxw", -Math.min(w, 12) / 2, -0.3, Math.min(w, 12), 2.5)],
  "sculpture": () => [P.rect("fxl", -1.2, -3, 2.4, 3), P.circle("fx2", 0, -4, 1), P.rect("fx3", 0.4, -6, 0.5, 2.4, { tf: { rot: 20 } })], "fireplace": () => [P.rect("fx", -3, -4, 6, 4), P.rect("fx3", -1.6, -2.6, 3.2, 2.6), P.rect("fx2", -0.9, -0.9, 1.8, 0.7), P.rect("fx", -3.4, -4.4, 6.8, 0.5)],
  "chandelier": () => sv.hang(4), "column": () => [P.rect("fx3", -0.8, -FLOOR_H, 1.6, FLOOR_H)], "display-case": () => [P.rect("fx", -2.5, -1.2, 5, 1.2), P.rect("fxl", -2.4, -3.8, 4.8, 2.6, { opacity: 0.6 }), P.circle("fx2", 0, -2.2, 0.5)],
  "frame": () => sv.wall(3, 4, 7, "fx2"), "mirror": () => sv.wall(3, 1.5, 7.5, "fxl"), "trunk": () => sv.block(3.2, 2, "fx"), "crate": () => sv.block(3, 3, "fx").concat([P.line("fx3", -1.5, -3, 1.5, 0, { sw: 0.15 })]), "pallet": () => sv.block(4, 0.5, "fx").concat(sv.block(3.6, 3.4, "fxl").map(p => Object.assign(p, { y: -3.9 }))),
  "barrel": () => sv.block(2.2, 3, "fx").concat([P.rect("fx3", -1.1, -2.2, 2.2, 0.15), P.rect("fx3", -1.1, -0.9, 2.2, 0.15)]), "wine-rack": w => sv.shelves(Math.min(w, 8), 6.5),
  "slots": w => { const W = Math.min(w, 10), k = []; for (let x = -W / 2; x < W / 2 - 1.4; x += 1.8) k.push(P.rect("fx2", x, -5.5, 1.5, 5.5, { rx: 0.2 }), P.rect("fxglow", x + 0.25, -4.6, 1, 1.2), P.circle("fx3", x + 0.75, -2.6, 0.3)); return k; },
  "roulette": () => sv.table(8, 3).concat([P.rect("fx2", -3.8, -3.3, 7.6, 0.3), P.circle("fx3", -2.4, -3.6, 0.6)]), "card-table": () => sv.table(7, 2.8).concat([P.rect("fx2", -3.4, -3.1, 6.8, 0.3)]), "dice-table": () => sv.table(10, 3).concat([P.rect("fx2", -5, -3.4, 10, 0.4)]), "billiards": () => sv.table(8.5, 2.8).concat([P.rect("fx2", -4.2, -3.1, 8.4, 0.3)]),
  "stage": w => [P.rect("fx3", -Math.min(w, 16) / 2, -2.6, Math.min(w, 16), 2.6), P.rect("fx2", -Math.min(w, 16) / 2, -FLOOR_H + 0.4, Math.min(w, 16), 1.6)].concat(sv.person("fx2").map(p => Object.assign(p, { tf: { y: -2.6 } }))),
  "dance-floor": w => [P.rect("fxglow", -Math.min(w, 12) / 2, -0.2, Math.min(w, 12), 0.2)].concat(sv.person("fx3").map(p => Object.assign(p, { tf: { x: -2 } })), sv.person("fx2").map(p => Object.assign(p, { tf: { x: 1.5 } }))),
  "seat-row-curved": w => SIDE["seat-row"](w), "screen": w => [P.rect("fx3", -Math.min(w, 20) / 2 - 0.4, -11.4, Math.min(w, 20) + 0.8, 7.4), P.rect("fxglow", -Math.min(w, 20) / 2, -11, Math.min(w, 20), 6.6)], "seat-row": w => { const k = []; for (let x = -Math.min(w, 16) / 2; x < Math.min(w, 16) / 2 - 1.4; x += 1.8) k.push(...sv.seat(1.5).map(p => Object.assign(p, { tf: { x: x + 0.75 } }))); return k; },
  "dj-booth": () => sv.block(6, 3.6, "fx3").concat([P.rect("fxl", -2.2, -3.9, 1.6, 0.3), P.rect("fxl", 0.6, -3.9, 1.6, 0.3)]), "record-player": () => sv.block(4, 2.6, "fx").concat([P.rect("fx3", -1.6, -2.9, 1.6, 0.3)]), "plasmovision": () => [P.rect("fx3", -2, -5, 4, 3, { rx: 0.6 }), P.rect("fxglow", -1.6, -4.6, 3.2, 2.2, { rx: 0.4 }), P.rect("fx3", -0.2, -2, 0.4, 2)],
  "vault-door": () => [P.circle("fxm", 0, -4, 3.6), P.circle("fx3", 0, -4, 2.6), P.circle("fxm", 0, -4, 1.4), P.rect("fxl", -2.2, -4.15, 4.4, 0.3), P.rect("fxl", -0.15, -6.2, 0.3, 4.4)], "deposit-wall": w => sv.cabinet(Math.min(w, 10), 7.5, "fxm"),
  "safe": () => sv.block(2.6, 3, "fx3").concat([P.circle("fxm", 0, -1.6, 0.6)]), "cash-cart": () => [P.rect("fxm", -1.5, -4, 3, 3.4), P.rect("fx2", -1.2, -3.6, 2.4, 2.8), P.circle("fx3", -1, -0.3, 0.3), P.circle("fx3", 1, -0.3, 0.3)], "count-table": () => sv.table(8, 3).concat([P.rect("fx2", -3, -3.5, 1, 0.5), P.rect("fx2", -1.5, -3.5, 1, 0.5), P.rect("fx2", 0, -3.6, 1, 0.6)]),
  "teller-counter": w => { const W = Math.min(w, 16), k = sv.block(W, 3.8, "fx").concat([P.rect("fx2", -W / 2, -4, W, 0.3)]); for (let x = -W / 2 + 1; x < W / 2; x += 1.2) k.push(P.rect("fx3", x, -7.5, 0.1, 3.5)); return k; }, "queue-rope": w => [P.rect("fx2", -Math.min(w, 10) / 2, -2.8, Math.min(w, 10), 0.2)].concat([-1, 0, 1].map(i => P.rect("fxm", i * Math.min(w, 10) / 2 - 0.15, -3, 0.3, 3))),
  "cell": () => { const k = []; for (let x = -3.4; x <= 3.4; x += 0.6) k.push(P.rect("fx3", x, -FLOOR_H + 1, 0.15, FLOOR_H - 1)); k.push(P.rect("fxl", -3, -1.6, 2.4, 0.5)); return k; }, "evidence-cage": w => { const W = Math.min(w, 8), k = sv.shelves(W, 6.5); for (let x = -W / 2; x <= W / 2; x += 0.5) k.push(P.rect("fx3", x, -7, 0.06, 7)); return k; },
  "conveyor": w => { const W = Math.min(w, 20), k = [P.rect("fxm", -W / 2, -3, W, 0.6), P.rect("fx3", -W / 2, -2.4, W, 0.2)]; for (let x = -W / 2 + 0.6; x < W / 2; x += 2.5) k.push(P.rect("fx3", x, -2.2, 0.3, 2.2)); for (let x = -W / 2 + 2; x < W / 2 - 1; x += 5) k.push(P.rect("fx2", x, -4.4, 1.6, 1.4)); return k; },
  "machine": () => sv.machine(6, 6), "boiler": () => sv.tank(7, 7).concat([P.rect("fxm", -0.3, -FLOOR_H + 0.4, 0.6, FLOOR_H - 7.4)]), "tank": w => sv.tank(w || 5, 8), "pipe-run": w => [P.rect("fxm", -Math.min(w, 14) / 2, -FLOOR_H + 1.4, Math.min(w, 14), 0.6), P.rect("fx2", -Math.min(w, 14) / 2, -FLOOR_H + 2.4, Math.min(w, 14), 0.6)],
  "transformer": () => sv.machine(6, 8).concat([P.circle("fxglow", -1.5, -8.6, 0.6), P.circle("fxglow", 1.5, -8.6, 0.6)]), "washer-row": w => { const W = Math.min(w, 12), k = []; for (let x = -W / 2; x < W / 2 - 2; x += 2.6) k.push(P.rect("fxl", x, -3.4, 2.4, 3.4), P.circle("fx3", x + 1.2, -1.9, 0.8), P.circle("fxw", x + 1.2, -1.9, 0.55)); return k; },
  "autopod": () => [P.path("fx2", "M-5.5 -1 L-5.5 -2.4 C-4 -2.8 -3 -4.6 -0.5 -4.6 C2 -4.6 3.4 -3 5.5 -2.6 L5.5 -1 Z"), P.path("fxglow", "M-2.8 -3.2 C-2 -4.1 -1 -4.2 0 -4.2 C1.2 -4.2 2 -3.8 2.6 -3.2 Z"), P.circle("fx3", -3.4, -0.9, 0.9), P.circle("fx3", 3.4, -0.9, 0.9)],
  "car-lift": () => [P.rect("fxm", -4.5, -5.5, 0.6, 5.5), P.rect("fxm", 3.9, -5.5, 0.6, 5.5), P.rect("fxm", -4.5, -5.5, 9, 0.4)], "boat": () => [P.path("fx2", "M-8 -2 L8 -2 L6 1 L-6.5 1 Z"), P.rect("fx", -2, -4, 4, 2)], "forklift": () => [P.rect("fx2", -2.4, -4, 4.4, 3.2), P.rect("fxm", 2, -6, 0.3, 6), P.rect("fxm", 2, -0.8, 2.4, 0.3), P.circle("fx3", -1.4, -0.7, 0.7), P.circle("fx3", 1.2, -0.7, 0.7)],
  "lab-bench": w => sv.table(Math.min(w, 10), 3).concat([P.rect("fxw", -2, -4.2, 0.6, 1.2), P.rect("fx2", -0.6, -4, 0.5, 1), P.rect("fxm", 1.6, -4.4, 1.8, 1.4)]), "apparatus": () => [P.circle("fxm", 0, -4, 3), P.circle("fx3", 0, -4, 2.2), P.circle("fxglow", 0, -4, 1.2), P.rect("fxm", -0.4, -1, 0.8, 1)],
  "cryo-tank": () => [P.rect("fxl", -1.5, -7, 3, 7, { rx: 1.2 }), P.rect("fxw", -1.1, -6.4, 2.2, 5.6, { rx: 0.9 })], "dummy": () => sv.person("fx2"), "trefoil": () => [P.rect("fx2", -3, -0.15, 6, 0.15)], "hazard-strip": w => [P.rect("fx2", -Math.min(w, 10) / 2, -0.15, Math.min(w, 10), 0.15)],
  "stairs": w => sv.stairs(Math.max(6, Math.min(w || 6, 10)), FLOOR_H), "stairs-spiral": () => [P.rect("fx3", -0.3, -FLOOR_H, 0.6, FLOOR_H)].concat([0, 1, 2, 3, 4, 5, 6, 7].map(i => P.rect("fxl", i % 2 ? -2.5 : 0, -1.6 * (i + 1), 2.5, 0.3))), "lift": () => [P.rect("fx3", -2.5, -FLOOR_H, 5, FLOOR_H), P.rect("fxm", -2.1, -8, 4.2, 8), P.rect("fx3", -0.05, -8, 0.1, 8)],
  "fire-escape": () => [P.rect("fxm", -2.2, -0.35, 4.4, 0.35), P.rect("fx3", -2.2, -3.4, 0.2, 3.4), P.rect("fx3", -2.2, -3.4, 4.4, 0.2), P.poly("fxl", [[2.2, 0], [6, 4], [6, 3.5], [2.2, -0.5]])],
  "area-steps": () => { const k = []; for (let j = 0; j < 6; j++) k.push(P.rect("fxl", -3 + j, -0.5 * (j + 1), 1.05, 0.5 * (j + 1))); k.push(P.rect("fx3", 3, -4, 0.2, 4)); return k; },
  "balcony": () => [P.rect("fxm", -3.3, -0.45, 6.6, 0.45), P.rect("fx3", -3.3, -3.6, 6.6, 0.22), P.rect("fx3", -3.3, -3.6, 0.22, 3.6), P.rect("fx3", 3.1, -3.6, 0.22, 3.6)],
  "ladder": () => sv.ladder(FLOOR_H), "roof-hatch": () => sv.ladder(FLOOR_H).concat([P.rect("fx3", -1.6, -FLOOR_H, 3.2, 0.5)]), "skylight": () => [P.poly("fxglow", [[-3, -FLOOR_H], [3, -FLOOR_H], [5, 0], [-5, 0]], { opacity: 0.35 })], "hatch": () => [P.rect("fx3", -1.5, -0.2, 3, 0.4), P.rect("fxm", -1.5, -1.6, 0.25, 1.6, { tf: { rot: -30 } })], "catwalk": w => [P.rect("fxm", -Math.min(w, 14) / 2, -9, Math.min(w, 14), 0.4), P.rect("fxm", -Math.min(w, 14) / 2, -11.5, Math.min(w, 14), 0.15)],
  "orb": w => [P.circle("fxglow", 0, -6, (w || 2) / 2, { opacity: 0.9 })], "flame": () => [P.path("fxglow", "M0 -4 C1.2 -2.6 1.6 -1.6 1.4 -0.8 C1.2 0 -1.2 0 -1.4 -0.8 C-1.6 -1.6 -0.8 -2.4 0 -4 Z"), P.rect("fx3", -1.4, -0.3, 2.8, 0.3)], "snow": w => [P.ellipse("fxl", 0, 0, Math.min(w, 8) / 2, 1.6)],
  "void": w => [P.ellipse("fx3", 0, -FLOOR_H / 2, Math.min(w, 10) / 2, FLOOR_H / 2 - 1), P.ellipse("fxglow", 0, -FLOOR_H / 2, Math.min(w, 10) / 3, FLOOR_H / 3, { opacity: 0.3 })], "doorframe": () => [P.rect("fx3", -1.8, -7, 0.4, 7), P.rect("fx3", 1.4, -7, 0.4, 7), P.rect("fx3", -1.8, -7.4, 3.6, 0.4), P.rect("fxg", -1.4, -7, 2.8, 7, { opacity: 0.5 })]
};
SEC.SIDE = SIDE;

// --- Build ---------------------------------------------------------------------------
SEC.build = function (lay, model, ctx) {
  // Type in a section is sized to the floor height, not the footprint.
  const k = ctx.k = Math.min(ctx.k, 1.15), { rng } = ctx, st = model.rings;
  const reveal = ctx.reveal, known = r => !reveal || M.roomRevealed(reveal, r);
  const levels = lay.levels.filter(l => !l.ground).sort((a, b) => b.lvl - a.lvl);           // top first (E3's sheets aren't storeys)
  const above = levels.filter(l => l.lvl >= 0).sort((a, b) => a.lvl - b.lvl), below = levels.filter(l => l.lvl < 0).sort((a, b) => b.lvl - a.lvl);
  const rowY = new Map();
  above.forEach((lv, i) => rowY.set(lv, [-(i + 1) * FLOOR_H, -i * FLOOR_H]));
  below.forEach((lv, i) => rowY.set(lv, [i * BASE_H, (i + 1) * BASE_H]));
  const sumW = lv => lv.rooms.reduce((s, r) => s + r.w, 0);
  const maxSum = Math.max(...levels.map(sumW));
  const Wb = Math.max(56, Math.min(120, Math.sqrt(maxSum * 260) * 1.05));
  const multi = levels.length > 1, coreW = 8, L = 0;
  const coreX = L + Math.round(Wb * 0.2);
  const ship = model.target === "Ship";
  const slabT = st === "hard" ? 1.4 : st === "glazed" ? 0.6 : 0.9;
  const rows = [];
  // Rooms keep the plan's left-to-right order; widths follow their size.
  for (const lv of levels) {
    const [y0, y1] = rowY.get(lv);
    const frac = Math.max(0.5, Math.min(1, sumW(lv) / maxSum));
    const RW = lv.lvl === 0 || lv.lvl < 0 ? Wb : Math.max(multi ? coreX + coreW + 24 : 30, Wb * frac);
    const rooms = lv.rooms.slice().sort((a, b) => (a.frame ? a.frame.cx : 0) - (b.frame ? b.frame.cx : 0));
    const boxes = [];
    const fill = (rs, x0, x1) => {
      const tot = rs.reduce((s, r) => s + r.w, 0) || 1; let x = x0;
      for (const r of rs) { const w = (x1 - x0) * r.w / tot; boxes.push({ r, x, w, y0, y1 }); x += w; }
    };
    if (multi) {
      const f = (coreX - L) / (RW - coreW);
      let m = 0, acc = 0, best = Infinity, tot = rooms.reduce((s, r) => s + r.w, 0);
      for (let i = 0; i <= rooms.length; i++) { const d = Math.abs(acc / tot - f); if (d < best) { best = d; m = i; } if (i < rooms.length) acc += rooms[i].w; }
      if (m === 0) boxes.push({ passage: true, x: L, w: coreX - L, y0, y1 }); else fill(rooms.slice(0, m), L, coreX);
      if (m === rooms.length) boxes.push({ passage: true, x: coreX + coreW, w: L + RW - coreX - coreW, y0, y1 }); else fill(rooms.slice(m), coreX + coreW, L + RW);
      boxes.push({ core: true, x: coreX, w: coreW, y0, y1 });
    } else fill(rooms, L, L + RW);
    rows.push({ lv, y0, y1, RW, boxes });
  }
  const rowOf0 = new Map(rows.map(r => [r.lv, r]));
  const pos = new Map();                                                     // room → [cx, cy]
  for (const row of rows) for (const b of row.boxes) if (b.r) pos.set(b.r, [b.x + b.w / 2, (b.y0 + b.y1) / 2]);

  const Ls = { site: [], floors: [], furn: [], walls: [], doors: [], game: [], cover: [], labels: [], entries: [] };
  const top = Math.min(...rows.map(r => r.y0)), bot = Math.max(0, ...rows.map(r => r.y1));
  // --- ground, earth, street (or sea) ---
  const ext = 16;
  if (ship) {
    // the hull: rounded stern left, raked bow right, keel under the lowest deck
    const deckY = (rows.find(r => r.lv.lvl === 0) || rows[0]).y0, keel = bot + 4, bowX = L + Wb + Math.max(14, Wb * 0.18);
    Ls.site.push(P.path("hull", `M${L - 6} ${deckY - 2} L${bowX} ${deckY - 6} Q${L + Wb + 4} ${keel - 2} ${L + Wb - 6} ${keel} L${L + 8} ${keel} Q${L - 8} ${keel - 2} ${L - 6} ${deckY - 2} Z`));
    Ls.site.push(P.rect("quay", L - ext - 10, -2.6, ext + 2, 3.6));
    if (model.street) Ls.site.push(P.text("street-label", L - ext / 2 - 6, 3.6, model.street.replace(/^the /i, "").toUpperCase(), { size: Math.max(1.4 * k, ctx.floorU || 0) }));
    Ls.walls.push(P.rect("roof", L + Wb * 0.55, top - slabT - 9, 4, 9), P.rect("roof", L + Wb * 0.55 - 0.5, top - slabT - 10, 5, 1.2));
    Ls.cover.push(P.rect("water-front", L - ext - 10, 0, Wb + 2 * ext + 30, bot + 12));
  } else {
    Ls.site.push(P.rect("earth", L - ext - 8, 0, Wb + 2 * ext + 16, bot + 7));
    Ls.site.push(P.rect("street", L - ext - 8, -0.6, ext + 8, 0.8));
    if (model.street) Ls.site.push(P.text("street-label", L - ext / 2 - 4, 3.2, model.street.replace(/^the /i, "").toUpperCase(), { size: Math.max(1.6 * k, ctx.floorU || 0) }));
  }
  // --- the shell, per style ---
  const topRow = rows.find(r => r.y0 === top);
  const shellTop = top - slabT;
  const rTop = topRow.RW;
  if (st === "blurred" && !ship) {
    const h = Math.min(18, rTop * 0.32);
    Ls.walls.push(P.poly("roof", [[L - 2, shellTop], [L + rTop + 2, shellTop], [L + rTop / 2, shellTop - h]]));
    Ls.walls.push(P.rect("roof", L + rTop * 0.72, shellTop - h * 0.85, 3, h * 0.6));
  } else if (st === "soft" && !ship) {
    Ls.walls.push(P.path("roof", `M${L - 1} ${shellTop} Q${L + rTop / 2} ${shellTop - Math.min(12, rTop * 0.2)} ${L + rTop + 1} ${shellTop} Z`));
  } else if (st === "radial" && !ship) {
    const r = Math.min(rTop * 0.35, 16);
    Ls.walls.push(P.path("roof-glass", `M${L + rTop / 2 - r} ${shellTop} A${r} ${r * 0.75} 0 0 1 ${L + rTop / 2 + r} ${shellTop} Z`));
  } else if (st === "spine" && !ship) {
    Ls.walls.push(P.rect("roof", L + rTop * 0.6, shellTop - 4, rTop * 0.25, 4));
  }
  if (st === "hard" && !ship) Ls.walls.push(P.rect("roof", L - 1, shellTop - 3, rTop + 2, 3));
  // --- rooms ---
  const doorsBetween = new Set();
  for (const lv of levels) for (const d of lv.doors) if (d.a && d.b) { doorsBetween.add(d.a); doorsBetween.add(d.b); doorsBetween.add((d.a.id || "") + "|" + (d.b.id || "")); doorsBetween.add((d.b.id || "") + "|" + (d.a.id || "")); }
  const kindBetween = (a, b) => { for (const lv of levels) for (const d of lv.doors) if ((d.a === a && d.b === b) || (d.a === b && d.b === a)) return d.kind; return null; };
  for (const row of rows) {
    const { lv, y0, y1, RW, boxes } = row;
    const pill = st === "radial" && !ship;
    // back wall of each room
    const xs = boxes.map(b => b.x), xe = boxes.map(b => b.x + b.w), rowL = Math.min(...xs), rowR = Math.max(...xe), rr = (y1 - y0) / 2;
    // A Futurist floor is a capsule: its end rooms get the rounded ends.
    const boxShape = b => {
      if (!pill) return { t: "rect" };
      const l = Math.abs(b.x - rowL) < 0.01, r = Math.abs(b.x + b.w - rowR) < 0.01;
      if (!l && !r) return { t: "rect" };
      const x0 = b.x, x1 = b.x + b.w;
      const d = `M${l ? x0 + rr : x0} ${y0} L${r ? x1 - rr : x1} ${y0} ${r ? `A${rr} ${rr} 0 0 1 ${x1 - rr} ${y1}` : `L${x1} ${y0} L${x1} ${y1}`} L${l ? x0 + rr : x0} ${y1} ${l ? `A${rr} ${rr} 0 0 1 ${x0 + rr} ${y0}` : `L${x0} ${y1} L${x0} ${y0}`} Z`;
      return { t: "path", d };
    };
    for (const b of boxes) {
      // the player copy draws nothing of a room the crew hasn't surveyed
      if (b.r && !known(b.r)) continue;
      const role = b.core || b.passage ? "floor-corridor" : "floor-" + b.r.band, sh = boxShape(b), data = b.r ? { band: b.r.band } : undefined;
      Ls.floors.push(sh.t === "path" ? P.path(role, sh.d, { data }) : P.rect(role, b.x, y0, b.w, y1 - y0, { data }));
      if (b.r && b.r.band === "secure") Ls.floors.push(sh.t === "path" ? P.path("floor-tone", sh.d, { data }) : P.rect("floor-tone", b.x, y0, b.w, y1 - y0, { data }));
      if (st === "spine" && !b.core) Ls.walls.push(P.line("drop-ceiling", b.x + 0.5, y0 + 2.2, b.x + b.w - 0.5, y0 + 2.2, { sw: 0.25 }));
      if (b.core) {
        Ls.furn.push(P.g(SIDE.stairs(6), { tf: { x: b.x + b.w / 2, y: y1 }, cls: "furniture" }));
      }
    }
    // furniture, from the room's own plan recipe, laid along the room
    for (const b of boxes) {
      if (!b.r || !known(b.r) || !b.r.frame) continue;
      const f = b.r.frame, fw = Math.max(f.w, f.h), fh = Math.min(f.w, f.h);
      const R = { x: -fw / 2 + 1.2, y: -fh / 2 + 1.2, w: fw - 2.4, h: fh - 2.4 };
      const recipe = M.own(M.ARCH, b.r.arch);
      let pls = recipe ? recipe(R, rng.fork(b.r.name)).flat().filter(p => p && !p.skip) : [];
      pls = pls.concat(M.circulationParts(b.r)(R));
      pls.sort((p, q) => p.y - q.y);                                           // back of the room first
      const kids = [], used = [];
      for (const pl of pls) {
        const fn = M.own(SIDE, pl.part);
        if (!fn) continue;
        const fx = b.x + 1.2 + (pl.x - R.x) / (R.w || 1) * (b.w - 2.4);
        const w = Math.min((pl.w || (M.own(M.PARTS, pl.part) ? M.own(M.PARTS, pl.part).size[0] : 3)), b.w - 2.4);
        // skip near-duplicates in the same spot (a grid of tables reads as a row)
        if (used.some(u => u.part === pl.part && Math.abs(u.x - fx) < w * 0.7)) continue;
        used.push({ part: pl.part, x: fx });
        const back = (pl.y - R.y) / (R.h || 1) < 0.35;
        kids.push(P.g(fn(w), { tf: { x: fx, y: y1 }, opacity: back ? 0.55 : pl.opacity, cls: "fx-" + pl.part }));
      }
      if (kids.length) Ls.furn.push(P.g(kids, { cls: "furniture", room: b.r.id }));
    }
    // floor slab, ceiling, outer walls
    const slabRole = "slab-sec";
    if (!pill) {
      Ls.walls.push(P.rect(slabRole, L - (st === "hard" ? 1.5 : 0), y1, RW + (st === "hard" ? 3 : 0), slabT));
      if (row.y0 === top) Ls.walls.push(P.rect(slabRole, L - (st === "hard" ? 1.5 : 0), y0 - slabT, RW + (st === "hard" ? 3 : 0), slabT));
    }
    const facade = st === "glazed" ? "wall-glass" : "wall-ext";
    if (pill) {
      Ls.walls.push(P.path("wall-ext", `M${rowL + rr} ${y0} L${rowR - rr} ${y0} A${rr} ${rr} 0 0 1 ${rowR - rr} ${y1} L${rowL + rr} ${y1} A${rr} ${rr} 0 0 1 ${rowL + rr} ${y0} Z`, { sw: 1.4 }));
    } else {
      Ls.walls.push(P.line(facade, L, y0, L, y1, { sw: st === "glazed" ? 0.6 : 1.4 }), P.line(facade, L + RW, y0, L + RW, y1, { sw: st === "glazed" ? 0.6 : 1.4 }));
    }
    // partitions, with a door where the plan has one
    const sorted = boxes.slice().sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1], x = b.x;
      if (a.r && b.r && !known(a.r) && !known(b.r)) continue;               // between two unsurveyed rooms: nothing in the file
      const kind = a.r && b.r ? kindBetween(a.r, b.r) : (a.core || b.core || a.passage || b.passage) ? "opening" : null;
      const wallRole = a.core || b.core ? "wall-ring" : st === "soft" ? "wall-soft" : st === "glazed" ? "wall-glass" : "wall-int";
      if (kind && kind !== "secret") {
        Ls.walls.push(P.line(wallRole, x, y0, x, y1 - 7.2, { sw: 0.6 }));
        if (kind === "vault") Ls.doors.push(P.circle("door-vault", x, y1 - 3.6, 3.2));
        else if (kind === "curtain") for (let yy = y1 - 7; yy < y1 - 0.4; yy += 0.7) Ls.doors.push(P.circle("door-curtain", x, yy, 0.18));
        else if (kind !== "opening") Ls.doors.push(P.rect("door-leaf-sec", x - 0.15, y1 - 7.2, 0.3, 7.2));
      } else {
        Ls.walls.push(P.line(wallRole, x, y0, x, y1, { sw: 0.6 }));
        if (kind === "secret") Ls.doors.push(P.line("door-secret", x, y1 - 7, x, y1, { sw: 0.5 }));
      }
    }
    // floor title, off the left
    if (lv.title && M.showTitles(lay, ctx)) { const ts = Math.max(2.2 * k, ctx.floorU || 0); Ls.labels.push(P.text("level-title", L + RW + 2.4, y0 + ts * 1.1, lv.title.toUpperCase(), { size: ts, anchor: "start" })); }
  }
  // --- labels and the game layer ---
  // The same label block as plan and iso: the name in the upper half of its
  // room (the furniture stands in the lower half), at the type floor or above,
  // or the room's number when the name can't fit.
  const gm = ctx.opts.layer !== "player", ik = 2.2 * k;
  for (const row of rows) for (const b of row.boxes) {
    if (!b.r) continue;
    const r = b.r;
    if (!known(r)) continue;
    const x0 = b.x + 0.5, x1 = b.x + b.w - 0.5, y0 = row.y0 + 0.5, y1 = row.y0 + (row.y1 - row.y0) * 0.56;
    const ax = (x0 + x1) / 2, ay = (y0 + y1) / 2, region = [[x0 - ax, y0 - ay], [x1 - ax, y0 - ay], [x1 - ax, y1 - ay], [x0 - ax, y1 - ay]];
    const icons = gm ? [r.isTarget && ["star", "ov-target"], r.obstacle && [M.obstacleIcon(r.obstacle), "ov-lock"], r.holdsAnswerTo && ["key", "ov-pair"], r.loot && r.featured && ["loot", "ov-loot"]].filter(Boolean) : [];
    Ls.labels.push(M.scene.labelBlock(r, ax, ay, icons, ctx, region, { lv: row.lv }));
    if (gm && r.isTarget) Ls.game.unshift(P.rect("ov-target-area", b.x, row.y0, b.w, row.y1 - row.y0));
  }
  // threats standing in their rooms (p.433)
  if (gm) {
    const tgt = model.rooms.find(r => r.isTarget), td = tgt ? M.BANDS.indexOf(tgt.band) : 3;
    const stand = (r, role, icon, t) => { const p = pos.get(r); if (!p) return; const row = rows.find(rw => rw.boxes.some(b => b.r === r)), b = row.boxes.find(q => q.r === r); Ls.game.push(M.icon(icon, b.x + b.w * (0.72 + 0.1 * t), row.y1 - ik * 1.1, ik * 1.2, role)); };
    if (model.soc) model.rooms.filter(r => M.BANDS.indexOf(r.band) === Math.max(0, td - 1)).slice(0, 2).forEach((r, i) => stand(r, "ov-soc", "social", i));
    if (model.phys) model.rooms.filter(r => r.isTarget || r.band === "controlled").slice(0, 2).forEach((r, i) => stand(r, "ov-phys", "guard", i));
  }
  // --- links: pairs and skips, vertical ones included ---
  const links = [];
  if (gm) {
    const byName = n => model.rooms.find(r => r.name === n);
    const curve = (a, b, role, sw, label, link) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, bend = 0.16 * len;
      const mx = (a[0] + b[0]) / 2 - dy / len * bend, my = (a[1] + b[1]) / 2 + dx / len * bend;
      const sh = 2.6 * k, ex = b[0] - dx / len * sh, ey = b[1] - dy / len * sh;
      links.push(P.path(role + "-line", `M${a[0]} ${a[1]} Q${mx} ${my} ${ex} ${ey}`, { sw: sw * k }));
      const tx = ex - mx, ty = ey - my, tl = Math.hypot(tx, ty) || 1, ux = tx / tl, uy = ty / tl, s = 1.3 * k;
      links.push(P.poly(role + "-head", [[ex + ux * s, ey + uy * s], [ex - uy * s * 0.7, ey + ux * s * 0.7], [ex + uy * s * 0.7, ey - ux * s * 0.7]]));
      if (label) {
        const ts = Math.max(1.3 * k, ctx.floorU || 0), lc = M.scene.type(ctx).label, cx = (a[0] + ex) / 4 + mx / 2, cy = (a[1] + ey) / 4 + my / 2 - 0.5 * ts, w = M.textW(label, ts, lc) + 0.4 * ts;
        links.push(P.g([P.text("ov-skip-label", cx, cy, label, { size: ts })], { cls: "map-skip-label", meta: { kind: "skip", box: { x0: cx - w / 2, y0: cy - ts * 0.85, w, h: ts * 1.1 }, text: label, size: ts, at: [cx, cy], link } }));
      }
    };
    const mid = r => { const p = pos.get(r), row = rows.find(rw => rw.boxes.some(b => b.r === r)); return [p[0], (row.y0 + row.y1) / 2 + 2]; };
    for (const p of model.pairs) { const a = byName(p.answer), b = byName(p.lock); if (a && b && pos.has(a) && pos.has(b)) curve(mid(a), mid(b), "ov-pair", 0.4); }
    for (const s of model.skips) { const a = byName(s.from), b = byName(s.to); if (a && b && pos.has(a) && pos.has(b)) curve(mid(a), mid(b), "ov-skip", 0.7, (a.lvl !== b.lvl ? "↕ " : "") + s.via, { a: a.n, b: b.n, via: s.via }); }
  }
  // --- entries: the street on the left, the roof above, the earth below ---
  // Each way in lands where the plan put it (lay.entries): on its floor, in its
  // room, through the roof or the floor, or through a door in the facade with
  // what gets you there standing outside it.
  const ground = rows.find(r => r.lv.lvl === 0) || rows[rows.length - 1];
  const fake = [], secEntry = {};
  const boxOf = r => { for (const row of rows) { const b = row.boxes.find(q => q.r === r); if (b) return { row, b }; } return null; };
  const hatchX = b => { const f = b.r.frame, fw = Math.max(f.w, f.h), Rw = Math.max(1, fw - 2.4); return b.x + 1.2 + Math.min(2.4 / Rw, 0.5) * (b.w - 2.4); };
  for (const e of lay.entries) {
    const kind = e.kind, v = e.vec || {};
    const sealed = !!reveal && kind === "back" && M.vecHidden(v);           // nothing of a route they can't know
    const hit = e.room ? boxOf(e.room) : null;
    const row = hit ? hit.row : (e.level && rowOf0.get(e.level)) || ground;
    let x, y, dir;
    if (kind === "front") {
      x = L; y = ground.y1 - 3.6; dir = [-1, 0];
      Ls.doors.push(P.rect("door-gap", L - 0.9, ground.y1 - 7.2, 1.8, 7.2));
    } else if (e.from === "above" && hit) {
      // through the roof (or the ceiling): a skylight, or a hatch and its ladder
      const b = hit.b, onTop = row.y0 === top, cy = onTop ? top - slabT : row.y0;
      x = e.means === "skylight" ? b.x + b.w / 2 : hatchX(b); y = cy; dir = [0, -1];
      if (!sealed) {
        if (e.means === "skylight") { if (!(b.r.connects === "skylights")) Ls.doors.push(P.rect("skylight-sec", x - 3, cy - 0.2, 6, slabT + 0.4)); }
        else Ls.doors.push(P.rect("door-gap", x - 1.3, cy - 0.1, 2.6, slabT + 0.2));
      }
    } else if (e.from === "below" && hit) {
      // up through the floor from below
      const b = hit.b;
      x = hatchX(b); y = row.y1 + slabT; dir = [0, 1];
      if (!sealed) Ls.doors.push(P.rect("door-gap", x - 1.3, row.y1 - 0.1, 2.6, slabT + 0.2));
    } else {
      // a door in the facade: the side the plan put it on, or the nearer end
      const b = hit && hit.b, mid = b ? b.x + b.w / 2 : L + row.RW;
      const right = e.side === "right" || (e.side !== "left" && mid > L + row.RW / 2) || kind === "front";
      const fx0 = right ? L + row.RW : L, sgn = right ? 1 : -1;
      x = fx0; y = row.y1 - 3.6; dir = [sgn, 0];
      if (!sealed) {
        Ls.doors.push(P.rect("door-gap", fx0 - 0.9, row.y1 - 7.2, 1.8, 7.2));
        const out = [], m = e.means, yF = row.y1;
        // an upper floor narrower than the one below opens onto that floor's roof
        const lowerRW = Math.max(0, ...rows.filter(q => q !== row && q.y0 >= row.y1 - 0.01 && q.y1 <= 0.01).map(q => q.RW));
        const onRoof = right && lowerRW > row.RW + 0.5;
        if (onRoof && (m === "fire-escape" || m === "spiral-stair")) {
          out.push(P.rect("fxm", 0, yF - 0.35, 4.5, 0.35), P.rect("fx3", 4.3, yF - 3.4, 0.2, 3.4));
          x = fx0 + sgn * 6;
        } else if (m === "fire-escape") {
          // landings at each floor down to the street, flights between them
          for (let yy = yF; yy < -0.1; yy += FLOOR_H) {
            out.push(P.rect("fxm", 0, yy - 0.35, 4.5, 0.35), P.rect("fx3", 4.3, yy - 3.4, 0.2, 3.4));
            const y2 = Math.min(0, yy + FLOOR_H);
            out.push(P.poly("fxl", [[0.6, yy], [4.4, y2], [4.4, y2 - 0.5], [0.6, yy - 0.5]]));
          }
          x = fx0 + sgn * 6;
        } else if (m === "area-steps" || m === "cellar-steps") {
          // an area dug down to the basement door, steps up to the street
          out.push(P.rect("door-gap", 0, 0, 5.5, yF), P.rect("fxm", 5.3, -3, 0.25, yF + 3));
          const n = Math.max(4, Math.round(yF / 0.9));
          for (let j = 0; j < n; j++) out.push(P.rect("fxl", 1.2 + 4 * j / n, yF * j / n, 4 - 4 * j / n + 0.3, 0.45));
          x = fx0 + sgn * 7;
        } else if (m === "balcony") {
          out.push(P.rect("fxm", 0, yF - 0.45, 3.4, 0.45), P.rect("fx3", 3.2, yF - 3.6, 0.22, 3.6), P.rect("fx3", 0, yF - 3.6, 3.4, 0.22));
          x = fx0 + sgn * 4.5;
        } else if (m === "catwalk") {
          out.push(P.rect("fxm", 0, yF - 0.45, 13, 0.45), P.rect("fx3", 0, yF - 3.4, 13, 0.18));
          for (let xx = 2; xx < 13; xx += 3) out.push(P.rect("fx3", xx, yF - 3.4, 0.15, 3));
          x = fx0 + sgn * 13.5;
        } else if (m === "spiral-stair") {
          out.push(P.rect("fx3", 2.4, yF, 0.5, -yF));
          for (let yy = 0, j = 0; yy > yF + 0.8; yy -= 1.4, j++) out.push(P.rect("fxl", j % 2 ? 0 : 2.6, yy - 0.3, 2.3, 0.3));
          x = fx0 + sgn * 6;
        }
        if (out.length) Ls.furn.push(P.g(out, { tf: { x: fx0, y: 0, sx: sgn }, cls: "furniture fixture fx-" + m }));
      }
    }
    secEntry[kind] = [x, y];
    fake.push({ vec: v, kind, level: "sec", x, y, dir });
  }
  const ctx2 = Object.assign({}, ctx, { toScreen: (lv, x, y) => [x, y], dirScreen: d => { const l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l]; } });
  const entries = M.scene.entries({ entries: fake }, ctx2);
  // --- player cover --- one path for every unsurveyed run of rooms, so the
  // file never holds a hidden room's edge; a run stops short of the walls
  // that face a surveyed room, which stay visible.
  if (reveal) {
    const subs = [];
    for (const row of rows) {
      const bs = row.boxes.slice().sort((a, b) => a.x - b.x), runs = [];
      let cur = null;
      for (const b of bs) {
        if (b.r && !known(b.r)) { if (cur) cur.x1 = b.x + b.w; else cur = { x0: b.x, x1: b.x + b.w }; }
        else if (cur) { runs.push(cur); cur = null; }
      }
      if (cur) runs.push(cur);
      const rowL = Math.min(...bs.map(b => b.x)), rowR = Math.max(...bs.map(b => b.x + b.w)), rr = (row.y1 - row.y0) / 2;
      const pill = st === "radial" && !ship;
      for (const u of runs) {
        const atL = Math.abs(u.x0 - rowL) < 0.01, atR = Math.abs(u.x1 - rowR) < 0.01, R2 = G.round;
        if (pill) {
          // a Futurist floor is a capsule: the cover follows its rounded ends
          const cy = (row.y0 + row.y1) / 2, q = rr - 0.7, yt = cy - q, yb = cy + q;
          const lx = atL ? rowL + rr : u.x0 + 0.3, rx = atR ? rowR - rr : u.x1 - 0.3;
          subs.push(`M${R2(lx)} ${R2(yt)} L${R2(rx)} ${R2(yt)} ${atR ? `A${R2(q)} ${R2(q)} 0 0 1 ${R2(rx)} ${R2(yb)}` : `L${R2(rx)} ${R2(yb)}`} L${R2(lx)} ${R2(yb)} ${atL ? `A${R2(q)} ${R2(q)} 0 0 1 ${R2(lx)} ${R2(yt)}` : `L${R2(lx)} ${R2(yt)}`} Z`);
        } else {
          const x0 = u.x0 + (atL ? 0.7 : 0.3), x1 = u.x1 - (atR ? 0.7 : 0.3);
          subs.push(`M${R2(x0)} ${R2(row.y0)} H${R2(x1)} V${R2(row.y1)} H${R2(x0)} Z`);
        }
      }
      if (runs.length) {
        const u = runs.reduce((a, b) => (b.x1 - b.x0 > a.x1 - a.x0 ? b : a), runs[0]);
        const fu = ctx.floorU || 0, uc = M.scene.type(ctx).unknown, size = M.fitText("UNSURVEYED", Math.max(6, u.x1 - u.x0 - 2), Math.max(1.9 * k, fu), uc, fu || undefined);
        const ux = (u.x0 + u.x1) / 2, uy = (row.y0 + row.y1) / 2, uw = M.textW("UNSURVEYED", size, uc) + 1;
        Ls.labels.push(P.g([P.text("label-unknown", ux, uy + size * 0.35, "UNSURVEYED", { size })], { cls: "map-unsurveyed", meta: { box: { x0: ux - uw / 2, y0: uy - size * 0.55, w: uw, h: size * 1.1 }, kind: "unsurveyed" } }));
      }
    }
    if (subs.length) Ls.cover.push(P.g([P.path("unknown", subs.join(" "))], { cls: "map-cover" }));
  }
  // positions for tokens and the board
  const rowOf = new Map(rows.map(r => [r.lv, r]));
  ctx.toScreen = (lv, x, y) => {
    for (const r of lv.rooms) if (r.frame && Math.abs(r.frame.cx - x) < 0.01 && Math.abs(r.frame.cy - y) < 0.01 && pos.has(r)) return pos.get(r);
    for (const e of lay.entries) if (e.level === lv && Math.abs(e.x - x) < 0.01 && Math.abs(e.y - y) < 0.01) return secEntry[e.kind] || [L, 0];
    const row = rowOf.get(lv); return row ? [L + row.RW / 2, (row.y0 + row.y1) / 2] : [L, 0];
  };
  ctx.dirScreen = d => d;
  const flatE = M.flat(entries);
  const minY = Math.min(top - slabT - 20, ...flatE.filter(p => p.t === "rect").map(p => p.y));
  const maxY = bot + 8 + (ship ? 4 : 0);
  let minX = L - ext - 12, maxX = L + Wb + ext + 10 + 16 * k + (ship ? Math.max(14, Wb * 0.18) : 0);
  for (const p of flatE) if (p.t === "rect") { minX = Math.min(minX, p.x - 4 * k); maxX = Math.max(maxX, p.x + p.w + 4 * k); }
  return { parts: [{ lv: levels[0], layers: Ls, tf: { x: 0, y: 0 } }], bounds: { minX, minY, maxX, maxY }, entries, links };
};

// ---- src/street.js ----
// =============================================================================
// street — the street outside a score site (view "street")
// =============================================================================
// Every roll already carries its street: the printed street type, description,
// sound, smell, obstacle, time and weather (p.419–420), two nearby buildings
// (p.430), the block's use and three street props (base Blades, pp.300–302, as
// the generator imports them), and the district's named street and landmark
// (p.388–417). The street view draws them around the site, in the same
// isometric as the building. Nothing new is rolled: the street's own seed only
// decides where things stand.
//
// The site is the plan view's building: its footprint is the ground floor's,
// its height is its floors, and its doors are where the plan put them, so the
// front, the service side and the back route land where the building map says.
//
// [interpretation], one table each, in streetparts.js: which ground a street
// type makes (GROUND), what a neighbour, a block use, a description, a prop and
// an obstacle look like (NEIGHBOUR, USE, DESC, PROP, OBSTACLE).
//
// World coordinates are feet: x east, y south (toward the street), z up. The
// building's front faces south. The view looks from the south-east, so the
// south and east faces show; when the plan puts the service door on the west
// side, it looks from the south-west instead, and the west face shows. Left
// stays left either way.

const ST = M.street = {};
const SIC = Math.cos(Math.PI / 6), SIS = 0.5;
const f5 = v => v.toFixed(5);

// --- The view ---------------------------------------------------------------------
ST.view = function (flip) {
  const proj = flip ? (x, y, z = 0) => [(x + y) * SIC, (y - x) * SIS - z] : (x, y, z = 0) => [(x - y) * SIC, (x + y) * SIS - z];
  const mat = z => flip ? `matrix(${f5(SIC)} ${-SIS} ${f5(SIC)} ${SIS} 0 ${(-z).toFixed(3)})` : `matrix(${f5(SIC)} ${SIS} ${f5(-SIC)} ${SIS} 0 ${(-z).toFixed(3)})`;
  const dir = d => { const [x, y] = proj(d[0], d[1], 0), l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  // the plan direction the viewer looks from, for which faces of a prism show
  const eye = flip ? [-1, 1] : [1, 1];
  return { flip, proj, mat, dir, eye, sideSign: flip ? -1 : 1 };
};

// --- The stage: everything drawn, before it is sorted ------------------------------------
// A solid is { b: [x0, y0, z0, x1, y1, z1], pcs, ground }: its box (for the
// painter's order) and its pieces, already projected. Ground decals are plain
// pieces in world x, y, drawn under the iso matrix of the level they lie on.
ST.stage = function (V, rng, night, ctx) {
  const S = { V, rng, night, ctx, items: [], decals: new Map(), furn: new Map(), features: [], shadows: [], lights: [], marks: [], warnings: ctx.W };
  const P0 = (x, y, z) => V.proj(x, y, z);
  S.P0 = P0;
  // On a deck (a walkway, a flyover) the pavement in front of the frontage is the deck's top, a
  // solid. What lies on it (area steps, a hatch, a puddle, a lamp's pool) is drawn on that top, as
  // part of the deck's own drawing and clipped to it, instead of on the ground under it, where the
  // deck would hide it. GROUNDS.deck sets S.deckTop; compose closes it before the shadows fall.
  S.deckTop = null;
  const onDeck = (p, z, under) => {
    const D = S.deckTop;
    if (!D || D.closed || Math.abs(z - D.z) > 0.01) return false;
    const pts = ST.flatPts(p);
    if (!pts) return false;
    let ya = Infinity, yb = -Infinity;
    for (const q of pts) { if (q[1] < ya) ya = q[1]; if (q[1] > yb) yb = q[1]; }
    if (yb <= D.y0 + 0.01 || ya >= D.y1 - 0.01) return false;
    const o = p.opacity != null ? { opacity: p.opacity } : {};
    if (ya < D.y0 - 0.01) { const back = ST.clipY(pts, -Infinity, D.y0); if (back.length > 2) under(P.poly(p.r, back, o)); }
    const on = ST.clipY(pts, D.y0, D.y1);
    if (on.length > 2) D.item.pcs.push(P.poly(p.r, on.map(q => P0(q[0], q[1], z + 0.02)), o));
    return true;
  };
  const toDecals = (p, z) => { if (!S.decals.has(z)) S.decals.set(z, []); S.decals.get(z).push(p); return p; };
  const toFurn = (p, z) => { if (!S.furn.has(z)) S.furn.set(z, []); S.furn.get(z).push(p); return p; };
  S.decal = (p, z = 0) => onDeck(p, z, q => toDecals(q, z)) ? p : toDecals(p, z);
  S.flat = (p, z = 0) => onDeck(p, z, q => toFurn(q, z)) ? p : toFurn(p, z);
  S.add = it => { S.items.push(it); return it; };
  // a box: side, front and top faces; extra(F) adds detail on its faces
  S.box = (x0, y0, z0, x1, y1, z1, mat, extra, o = {}) => {
    const sx = V.flip ? x0 : x1, pcs = [];
    if (z1 - z0 > 0.01) {
      pcs.push(P.poly(`st-s:${mat}`, [P0(sx, y0, z0), P0(sx, y1, z0), P0(sx, y1, z1), P0(sx, y0, z1)]));
      pcs.push(P.poly(`st-f:${mat}`, [P0(x0, y1, z0), P0(x1, y1, z0), P0(x1, y1, z1), P0(x0, y1, z1)]));
    }
    if (!o.noTop) pcs.push(P.poly(`st-t:${o.topMat || mat}`, [P0(x0, y0, z1), P0(x1, y0, z1), P0(x1, y1, z1), P0(x0, y1, z1)]));
    const it = { b: [x0, y0, z0, x1, y1, z1], pcs, ground: o.ground != null ? o.ground : z0, shadow: o.shadow !== false && z1 - z0 > 2.5 };
    if (extra) extra(S.faces(it));
    if (!o.loose) S.items.push(it);
    return it;
  };
  // detail on a box's faces, in world coordinates (a hair off the face)
  S.faces = it => {
    const [x0, y0, , x1, y1] = it.b, sx = V.flip ? x0 - 0.02 : x1 + 0.02, fy = y1 + 0.02;
    return {
      it, x0, y0, x1, y1, z0: it.b[2], z1: it.b[5], sx,
      front: (xa, xb, za, zb, role, o) => it.pcs.push(P.poly(role, [P0(xa, fy, za), P0(xb, fy, za), P0(xb, fy, zb), P0(xa, fy, zb)], o)),
      side: (ya, yb, za, zb, role, o) => it.pcs.push(P.poly(role, [P0(sx, ya, za), P0(sx, yb, za), P0(sx, yb, zb), P0(sx, ya, zb)], o)),
      top: (xa, ya, xb, yb, role, o) => it.pcs.push(P.poly(role, [P0(xa, ya, it.b[5] + 0.02), P0(xb, ya, it.b[5] + 0.02), P0(xb, yb, it.b[5] + 0.02), P0(xa, yb, it.b[5] + 0.02)], o)),
      // a polygon on the front face from (u, z) points, u along x
      frontPoly: (pts, role, o) => it.pcs.push(P.poly(role, pts.map(([u, z]) => P0(u, fy, z)), o)),
      sidePoly: (pts, role, o) => it.pcs.push(P.poly(role, pts.map(([u, z]) => P0(sx, u, z)), o)),
      push: p => it.pcs.push(p)
    };
  };
  // a prism on any footprint (a hull, a stadium): the faces that face the viewer
  S.prism = (pts, z0, z1, mat, o = {}) => {
    const pcs = [], n = pts.length;
    let A = 0; for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; A += p[0] * q[1] - q[0] * p[1]; }
    const ccw = A > 0;
    const faces = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
      // outward normal
      const nx = (ccw ? dy : -dy) / l, ny = (ccw ? -dx : dx) / l;
      if (nx * V.eye[0] + ny * V.eye[1] <= 0.001) continue;
      const shade = ny > 0.72 ? "f" : Math.abs(nx) > 0.72 ? "s" : "m";
      faces.push({ key: ((p[0] + q[0]) / 2) * V.sideSign + (p[1] + q[1]) / 2, poly: P.poly(`st-${shade}:${mat}`, [P0(p[0], p[1], z0), P0(q[0], q[1], z0), P0(q[0], q[1], z1), P0(p[0], p[1], z1)]) });
    }
    faces.sort((a, b) => a.key - b.key);
    for (const f of faces) pcs.push(f.poly);
    if (!o.noTop) pcs.push(P.poly(`st-t:${o.topMat || mat}`, pts.map(p => P0(p[0], p[1], z1))));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const it = { b: [Math.min(...xs), Math.min(...ys), z0, Math.max(...xs), Math.max(...ys), z1], pcs, ground: o.ground != null ? o.ground : z0, shadow: o.shadow !== false && z1 - z0 > 2.5, foot: pts };
    if (!o.loose) S.items.push(it);
    return it;
  };
  // a cylinder (drums, tanks, posts, domes' drums)
  S.cyl = (cx, cy, r, z0, z1, mat, o = {}) => {
    const n = o.n || 18, pts = [];
    for (let i = 0; i < n; i++) { const a = i * 2 * Math.PI / n; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    const e = V.eye, el = Math.hypot(e[0], e[1]), a0 = Math.atan2(e[1] / el, e[0] / el);
    const arc = z => { const out = []; for (let i = 0; i <= 12; i++) { const a = a0 - Math.PI / 2 + i * Math.PI / 12; out.push(P0(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z)); } return out; };
    const pcs = [];
    if (z1 - z0 > 0.01) pcs.push(P.poly(`st-f:${mat}`, arc(z0).concat(arc(z1).reverse())));
    if (z1 - z0 > 0.01 && !o.flatSide) {
      // the half turned to the side is a shade darker
      const half = []; for (let i = 0; i <= 6; i++) { const a = a0 - (V.flip ? -1 : 1) * Math.PI / 2 * (1 - i / 6); half.push(P0(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z0)); }
      const top = []; for (let i = 6; i >= 0; i--) { const a = a0 - (V.flip ? -1 : 1) * Math.PI / 2 * (1 - i / 6); top.push(P0(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z1)); }
      pcs.push(P.poly(`st-s:${mat}`, half.concat(top)));
    }
    if (!o.noTop) pcs.push(P.poly(`st-t:${o.topMat || mat}`, pts.map(p => P0(p[0], p[1], z1))));
    const it = { b: [cx - r, cy - r, z0, cx + r, cy + r, z1], pcs, ground: o.ground != null ? o.ground : z0, shadow: o.shadow !== false && z1 - z0 > 2.5, foot: pts };
    if (!o.loose) S.items.push(it);
    return it;
  };
  // a gabled roof along x: the slope that faces the street, and the gable end that shows
  S.gable = (x0, y0, x1, y1, z, rise, mat, endMat) => {
    const ym = (y0 + y1) / 2, sx = V.flip ? x0 : x1, pcs = [];
    pcs.push(P.poly(`st-s:${endMat || mat}`, [P0(sx, y0, z), P0(sx, y1, z), P0(sx, ym, z + rise)]));
    pcs.push(P.poly(`st-t:${mat}`, [P0(x0, y1, z), P0(x1, y1, z), P0(x1, ym, z + rise), P0(x0, ym, z + rise)]));
    pcs.push(P.poly(`st-f:roofline`, [P0(x0, ym, z + rise), P0(x1, ym, z + rise), P0(x1, ym, z + rise + 0.4), P0(x0, ym, z + rise + 0.4)]));
    const it = { b: [x0, y0, z, x1, y1, z + rise], pcs, ground: 0, shadow: false };
    S.items.push(it);
    return it;
  };
  // a figure standing at (x, y) on a surface at z: a body and a head, upright. A loose one (one of a
  // crowd, a passer-by) may be left out where it would stand in front of a way in (ST.sightlines).
  S.person = (x, y, z = 0, role = "crowd", o = {}) => {
    const [sx, sy] = P0(x, y, z), h = (o.h || 6.2) + (o.rng || S.rng)() * 0.9, w = o.w || 1.9;
    const pcs = [P.rect(`st-f:${role}`, sx - w / 2, sy - h + 1.5, w, h - 1.5, { rx: w * 0.4 }), P.circle(`st-t:${o.head || "head"}`, sx, sy - h + 0.8, w * 0.42)];
    if (o.sign) pcs.push(P.rect("st-d:placard-stick", sx + w * 0.25, sy - h - 2.6, 0.24, 4), P.rect("st-d:placard", sx - 1.5, sy - h - 4.6, 3.6, 2.5));
    const it = { b: [x - 0.8, y - 0.8, z, x + 0.8, y + 0.8, z + h], pcs, ground: z, shadow: false, person: true, loose: !!o.loose };
    S.items.push(it);
    return it;
  };
  // a labelled thing on the street: the key numbers it and says where it is from
  S.feature = (f) => { S.features.push(f); return f; };
  return S;
};

// --- Painter's order ----------------------------------------------------------------
// Boxes that overlap on screen are ordered by the axis that separates them (the
// one nearer the viewer is drawn later); boxes that interpenetrate fall back to
// their centres. A topological sort, so a long building and a small thing in
// front of it come out right.
ST.sort = function (items, V) {
  const n = items.length, sb = items.map(it => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of it.pcs) for (const [x, y] of ptsOf(p)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return { x0, y0, x1, y1 };
  });
  const e = 0.01, sg = V.sideSign;
  const before = (A, B) => {                    // should A be drawn before B?
    const a = A.b, b = B.b;
    // x: the viewer is on +x (or −x from the south-west)
    if (sg > 0) { if (a[3] <= b[0] + e) return true; if (b[3] <= a[0] + e) return false; }
    else { if (a[0] >= b[3] - e) return true; if (b[0] >= a[3] - e) return false; }
    if (a[4] <= b[1] + e) return true; if (b[4] <= a[1] + e) return false;
    if (a[5] <= b[2] + e) return true; if (b[5] <= a[2] + e) return false;
    const ca = (a[0] + a[3]) / 2 * sg + (a[1] + a[4]) / 2 + (a[2] + a[5]) / 4, cb = (b[0] + b[3]) / 2 * sg + (b[1] + b[4]) / 2 + (b[2] + b[5]) / 4;
    return ca < cb;
  };
  const after = Array.from({ length: n }, () => []), indeg = new Array(n).fill(0);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const A = sb[i], B = sb[j];
    if (A.x1 <= B.x0 || B.x1 <= A.x0 || A.y1 <= B.y0 || B.y1 <= A.y0) continue;
    if (before(items[i], items[j])) { after[i].push(j); indeg[j]++; } else { after[j].push(i); indeg[i]++; }
  }
  const key = i => { const b = items[i].b; return (b[0] + b[3]) / 2 * sg + (b[1] + b[4]) / 2 + b[2] * 0.01; };
  const ready = [], out = [], done = new Array(n).fill(false);
  for (let i = 0; i < n; i++) if (!indeg[i]) ready.push(i);
  while (out.length < n) {
    if (!ready.length) {                        // a cycle: take the one with the fewest left before it, then the one furthest back
      let best = -1; for (let i = 0; i < n; i++) if (!done[i] && (best < 0 || indeg[i] < indeg[best] || (indeg[i] === indeg[best] && key(i) < key(best)))) best = i;
      ready.push(best); indeg[best] = 0;
    }
    ready.sort((p, q) => key(q) - key(p));
    const i = ready.pop();
    if (done[i]) continue;
    done[i] = true; out.push(items[i]);
    for (const j of after[i]) if (!done[j] && --indeg[j] === 0) ready.push(j);
  }
  return out;
};
function ptsOf(p) {
  if (p.t === "poly") return p.pts;
  if (p.t === "rect") return [[p.x, p.y], [p.x + p.w, p.y + p.h]];
  if (p.t === "circle") return [[p.cx - p.rad, p.cy - p.rad], [p.cx + p.rad, p.cy + p.rad]];
  if (p.t === "ellipse") return [[p.cx - p.rx, p.cy - p.ry], [p.cx + p.rx, p.cy + p.ry]];
  if (p.t === "line") return [[p.x1, p.y1], [p.x2, p.y2]];
  if (p.t === "g") return p.kids.flatMap(ptsOf).map(([x, y]) => p.tf ? [x * (p.tf.s || 1) + (p.tf.x || 0), y * (p.tf.s || 1) + (p.tf.y || 0)] : [x, y]);
  if (p.t === "path" && p.box) return p.box;
  return [];
}
ST.ptsOf = ptsOf;
// A flat piece's outline in world x, y (a decal's rect, ellipse, circle or polygon), or null.
ST.flatPts = function (p) {
  const ring = (cx, cy, rx, ry, n) => Array.from({ length: n }, (_, i) => [cx + Math.cos(i * 2 * Math.PI / n) * rx, cy + Math.sin(i * 2 * Math.PI / n) * ry]);
  if (p.t === "rect") return [[p.x, p.y], [p.x + p.w, p.y], [p.x + p.w, p.y + p.h], [p.x, p.y + p.h]];
  if (p.t === "poly") return p.pts.map(q => [q[0], q[1]]);
  if (p.t === "ellipse") return ring(p.cx, p.cy, p.rx, p.ry, 24);
  if (p.t === "circle") return ring(p.cx, p.cy, p.rad, p.rad, 16);
  return null;
};
// A polygon cut to lo <= y <= hi.
ST.clipY = function (pts, lo, hi) {
  const cut = (P_, keep, at) => {
    const out = [];
    for (let i = 0; i < P_.length; i++) {
      const a = P_[i], b = P_[(i + 1) % P_.length], ka = keep(a), kb = keep(b);
      if (ka) out.push(a);
      if (ka !== kb) { const y = at, t = (y - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, y]); }
    }
    return out;
  };
  let out = pts;
  if (lo > -Infinity) out = cut(out, q => q[1] >= lo, lo);
  if (hi < Infinity && out.length) out = cut(out, q => q[1] <= hi, hi);
  return out;
};
// Two world points' distance on the page.
ST.scrDist = (V, a, b) => { const p = V.proj(a[0], a[1], a[2] || 0), q = V.proj(b[0], b[1], b[2] || 0); return Math.hypot(p[0] - q[0], p[1] - q[1]); };
// Does a solid's drawing cover the page point (px, py), within r?
ST.covers = function (it, px, py, r) {
  const seg = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-9, t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)); return Math.hypot(px - a[0] - dx * t, py - a[1] - dy * t); };
  const inPoly = pts => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) c = !c; } return c; };
  const hit = p => {
    if (p.t === "poly") return inPoly(p.pts) || p.pts.some((q, i) => seg(q, p.pts[(i + 1) % p.pts.length]) <= r);
    if (p.t === "rect") return px >= p.x - r && px <= p.x + p.w + r && py >= p.y - r && py <= p.y + p.h + r;
    if (p.t === "circle") return Math.hypot(px - p.cx, py - p.cy) <= p.rad + r;
    if (p.t === "ellipse") return ((px - p.cx) / (p.rx + r)) ** 2 + ((py - p.cy) / (p.ry + r)) ** 2 <= 1;
    if (p.t === "line") return seg([p.x1, p.y1], [p.x2, p.y2]) <= r + (p.sw || 0.2) / 2;
    return false;
  };
  return it.pcs.some(hit);
};

// --- Light ------------------------------------------------------------------------------
// By Bluetime (real daylight, p.303) the rulebook's hard shadows fall across
// the street; at Night the lamps pool on the pavement and lit shopfronts spill.
const SUN = [0.24, 0.32];
// S.sun (the plate's: its key's shadow per foot, in world x, y) replaces the
// rulebook's; with S.stipple the shadow's far end is drawn as stipple from that
// share of the height up (WAVE2-SPEC M2.1: long hard shadows, stippled where they end).
ST.castShadow = function (S, it) {
  if (!it.shadow) return;
  const [x0, y0, z0, x1, y1, z1] = it.b, g = it.ground || 0, foot = it.foot || [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const sx = S.sun ? S.sun[0] : SUN[0] * S.V.sideSign, sy = S.sun ? S.sun[1] : SUN[1], ha = Math.max(0, z0 - g), hb = z1 - g;
  const sweep = (h0, h1) => { const pts = []; for (const [x, y] of foot) { pts.push([x + sx * h0, y + sy * h0]); pts.push([x + sx * h1, y + sy * h1]); } return hull(pts); };
  if (!S.stipple) { S.decal(P.poly("st-g:shadow", sweep(ha, hb)), g); return; }
  const hm = ha + (hb - ha) * S.stipple;
  S.decal(P.poly("st-g:shadow", sweep(ha, hm)), g);
  S.decal(P.poly("st-g:shadow-tail", sweep(hm - (hb - ha) * 0.04, hb)), g);
};
function hull(pts) {
  pts = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
ST.hull = hull;

// --- Times ----------------------------------------------------------------------------
// The roll's time by default (decision 4); the scene's through opts.time, or
// opts.light (the light contract, light.js), which picks the time too.
ST.TIMES = ["Bluetime", "Night"];
ST.time = (o, opts, W) => M.light.forRoll(o, opts, W);

// --- The model of the street -----------------------------------------------------------------
// The roll's street fields, checked against the printed tables. A field the
// roll doesn't carry is left out quietly; one the tables don't know is drawn
// as the nearest thing and named in a warning.
ST.read = function (o, W) {
  const lc = s => String(s || "").toLowerCase().trim();
  const known = (table, v, what) => {
    if (v == null || v === "") return null;
    const hit = Object.keys(table).find(k => lc(k) === lc(v));
    if (!hit) M.warn(W, `${what} "${v}" is not in the printed table — ${what === "street prop" ? "left off the street" : "drawn as the nearest thing"} (one of: ${Object.keys(table).join(", ")})`);
    return hit || null;
  };
  const st = known(ST.GROUND, o.streetType, "street type");
  return {
    named: o.namedStreet || "", type: st, typeRaw: o.streetType || "",
    desc: known(ST.DESC, o.streetDesc, "street description"), descRaw: o.streetDesc || "",
    sound: o.streetSound || "", smell: o.streetSmell || "",
    obstacle: known(ST.OBSTACLE, o.streetObstacle, "street obstacle"), obstacleRaw: o.streetObstacle || "",
    props: M.list(o.props, W, "props", true).map(p => known(ST.PROP, p, "street prop")).filter(Boolean),
    neighbours: M.list(o.neighbours, W, "neighbours", true).slice(0, 2).map(n => known(ST.NEIGHBOUR, n, "nearby building") || n),
    use: known(ST.USE, o.blockUse, "block use"), useRaw: o.blockUse || "",
    landmark: o.landmark || "", watcher: o.watcher || "", weather: o.weather || "", timeOfDay: o.timeOfDay || "",
    style: o.style || ""
  };
};

// "a news stand" → "News stand": the printed words, without the article.
ST.cap = s => String(s || "").replace(/^(a|an|the) /i, "").replace(/^./, c => c.toUpperCase());

// --- Render ------------------------------------------------------------------------------
// The same passes as the building: draw, measure a unit at the display width,
// draw again with the type floor, until no word is under it.
ST.render = function (o, opts, W, theme, model, seed, sid) {
  const B = ST.build(o, opts, W, theme, model, seed, sid), out = B.out;
  return { svg: out.svg, width: out.width, height: out.height, warnings: W, model, layout: null, seed, floorPx: opts.minLabelPx || 0, time: B.T.time };
};
// The street drawn, with its scene and time (B68Map.lightAt reads the scene).
ST.build = function (o, opts, W, theme, model, seed, sid) {
  const rng = M.rng(seed);
  const player = opts.layer === "player";
  const T = ST.time(o, opts, W);
  if (opts.floor != null && opts.floor !== "all") M.warn(W, "floor: the street view draws the street, not one floor — every floor is in the building views");
  // the site's building is the plan view's (same seed, same walls)
  const lay = model.rooms.length ? M.layout.build(model, "plan", rng.fork("layout"), { player }) : null;
  const typeTheme = opts.theme === "board" ? (M.own(M.THEMES, opts.sheet) && opts.sheet !== "board" ? M.own(M.THEMES, opts.sheet) : M.THEMES.blueprint) : theme;
  const street = ST.read(o, W);
  let fu = 0, fk = 0, out = null, keyAt = null, scene = null;
  for (let pass = 0; pass < 6; pass++) {
    const ctx = { rng: rng.fork("street"), W, opts, k: 2, reveal: player ? new Set(opts.reveal || ["public"]) : null, floorU: fu, type: typeTheme.type, drawn: null };
    scene = ST.scene(o, model, lay, street, ctx, { theme, sid, keyFloor: fk, keyAt, T });
    out = theme.compose(scene);
    if (pass >= 1) keyAt = keyAt || scene._keyAt;
    if (!opts.minLabelPx || !out.PW) break;
    const pxu = opts.displayWidth / out.PW, cs = (out.content && out.content.cs) || 1;
    const needD = opts.minLabelPx / (pxu * cs), needK = opts.minLabelPx / pxu;
    if (fu >= needD * 1.004 && fk >= needK * 1.004) break;
    fu = Math.max(fu, needD * 1.02); fk = Math.max(fk, needK * 1.02);
  }
  return { scene, out, T };
};

// Build the street's scene for a theme to compose: the drawing in parts and
// layers as composePage wants them, the ways in, the labels solved, the key's facts.
ST.scene = function (o, model, lay, street, ctx, X) {
  const { opts, W } = ctx, k = ctx.k, player = opts.layer === "player";
  const built = ST.compose(o, model, lay, street, ctx, X.T);
  const { S, V } = built;
  // the plate's light: its key's long shadows by day; at Night, light spilling
  // from the site's ways in the crew can use (plate.js)
  const plate = !!(X.theme && X.theme.name === "plate");
  if (plate && !S.night) { const pk = M.light.planKey(X.T.light, V.flip ? -1 : 1); S.sun = pk.shadow; S.stipple = M.light.MAP.bluetime.stipple; }
  if (plate && S.night) M.plate.streetSpills(S, built, ctx);
  // painter's order, then shadows by day
  const sorted = ST.sort(S.items, V);
  if (!S.night) for (const it of S.items) ST.castShadow(S, it);
  // the ways in, with the kit's own arrows and tags
  ctx.toScreen = (lv, x, y, kind) => V.proj(x, y, ((lv && lv.z) || 0) + (typeof kind === "number" ? kind : 0));
  ctx.dirScreen = V.dir;
  const entryOf = (turn = {}) => M.scene.entries({ entries: built.entries.map(e => Object.assign({}, e, { level: Object.assign({ bbox: { w: built.streetW, h: 0 } }, e.level) }, turn[e.kind] ? { dir: turn[e.kind] } : {})) }, ctx);
  // layers: each ground level is its own part, lowest first, under its own iso matrix
  const zs = [...new Set([...S.decals.keys(), ...S.furn.keys()])].sort((a, b) => a - b);
  const parts = zs.map(z => ({ lv: { z }, layers: { site: S.decals.get(z) || [], floors: [], furn: S.furn.get(z) || [], walls: [], doors: [], game: [], cover: [], labels: [], entries: [] },
    tf: { x: 0, y: 0 }, tfs: { site: V.mat(z), floors: V.mat(z), furn: V.mat(z), doors: V.mat(z), game: V.mat(z), cover: V.mat(z) } }));
  // [interpretation] Solids that lie wholly at or under the street's level (a deck, a quay's or a
  // canal's wall, the road below a deck, a hull's lower part) are drawn before the street's ground,
  // which hides whatever of them lies behind it; everything else stands on the ground, after it.
  const sunk = sorted.filter(it => it.b[5] <= 0.01), high = sorted.filter(it => it.b[5] > 0.01);
  const at0 = parts.findIndex(p => p.lv.z >= -0.01);
  parts.splice(at0 < 0 ? parts.length : at0, 0, { lv: { z: -0.005 }, layers: { site: sunk.flatMap(it => it.pcs), floors: [], furn: [], walls: [], doors: [], game: [], cover: [], labels: [], entries: [] }, tf: { x: 0, y: 0 } });
  const top = { lv: { z: 0 }, layers: { site: [], floors: [], furn: [], walls: high.flatMap(it => it.pcs).concat(S.marks), doors: [], game: [], cover: [], labels: [], entries: [] }, tf: { x: 0, y: 0 } };
  parts.push(top);
  const facts = ST.facts(o, model, street, built, opts, X.T);
  const labelled = facts.features;
  // the road's name on the road
  if (built.roadName) {
    const rn = built.roadName, ss = Math.max(3.2 * k, (ctx.floorU || 0) * 1.1);
    const host = parts.find(p => p.lv.z === rn.z) || parts[0];
    // painted on the road: labels may sit over it (its slanted box would wall off half the street)
    host.layers.site.push(P.text("street-label", rn.x, rn.y + ss * 0.35, rn.text, { size: ss, anchor: "middle" }));
  }
  // bounds: everything drawn
  const B0 = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow0 = (x, y) => { if (x < B0.minX) B0.minX = x; if (x > B0.maxX) B0.maxX = x; if (y < B0.minY) B0.minY = y; if (y > B0.maxY) B0.maxY = y; };
  for (const it of S.items) for (const p of it.pcs) for (const q of ptsOf(p)) grow0(q[0], q[1]);
  for (const [z, ds] of S.decals) for (const p of ds) for (const q of ptsOf(p)) { const s = V.proj(q[0], q[1], z); grow0(s[0], s[1]); }
  // labels: every feature numbered, its name on it when it fits, else a pin; and the landmark
  // where the road leaves the sheet. Solved with the ways in's tags; turn: arrows turned off their walls.
  const place = turn => {
    top.layers.labels = [];
    for (const f of labelled) {
      const lb = M.scene.labelBlock({ n: f.n, name: f.name }, f.anchor[0], f.anchor[1], f.icons || [], ctx, f.region, {});
      lb.cls = "room-label" + (lb.meta.pin ? " room-pin" : "");
      top.layers.labels.push(lb);
    }
    if (built.exit && street.landmark) top.layers.labels.push(ST.landmarkTag(built.exit, street.landmark, V, ctx, built.streetW));
    const ents = entryOf(turn), Bc = Object.assign({}, B0);
    const solved = M.labels.solve({ parts, links: [], entries: ents, ctx, view: "iso", bounds: Bc });
    return { ents, solved, Bc, clash: ST.tagClash(ents, top.layers.labels) };
  };
  // [interpretation] A way in whose tag the solver could only leave on another way's tag
  // (two ways on one face, a narrow sheet) comes in at an angle instead: its arrow turns off
  // its wall's normal, still from outside the wall, until its tag is clear. Only a later way
  // turns (the service side, then the back route, never the front), so the player copy never
  // depends on the back route.
  let turn = {}, res = place(turn);
  for (const kind of ["service", "back"]) {
    // the service side gives way to the front and the landmark only; the back route to all of them
    const mine = r => r.clash.filter(c => c.includes(kind) && (kind === "back" || !c.includes("back"))).length;
    const e = built.entries.find(q => q.kind === kind);
    if (!mine(res) || !e || !(e.dir[0] || e.dir[1])) continue;
    const nrm = e.normal || e.dir;
    let best = { n: mine(res), d: null };
    for (const t of [0.6, -0.6, 1.0, -1.0]) {
      const c = Math.cos(t), s = Math.sin(t), d = [e.dir[0] * c - e.dir[1] * s, e.dir[0] * s + e.dir[1] * c];
      if (d[0] * nrm[0] + d[1] * nrm[1] < 0.45) continue;          // still from outside its wall
      const n = mine(place(Object.assign({}, turn, { [kind]: d })));
      if (n < best.n) best = { n, d };
      if (!n) break;
    }
    if (best.d) turn[kind] = best.d;
    res = place(turn);          // the arrangement kept is the one placed last
  }
  const { ents: entries, solved } = res, B = res.Bc;
  const grow = (x, y) => { if (x < B.minX) B.minX = x; if (x > B.maxX) B.maxX = x; if (y < B.minY) B.minY = y; if (y > B.maxY) B.maxY = y; };
  for (const b of solved.boxes) { grow(b.x0, b.y0); grow(b.x0 + b.w, b.y0 + b.h); }
  for (const b of solved.fixed) { grow(b.x0, b.y0); grow(b.x0 + b.w, b.y0 + b.h); }
  for (const e of entries) if (e.meta) for (const b of e.meta.boxes || []) { grow(b.x0, b.y0); grow(b.x0 + b.w, b.y0 + b.h); }
  const pad = 4 * k, box = { x: B.minX - pad, y: B.minY - pad, w: B.maxX - B.minX + 2 * pad, h: B.maxY - B.minY + 2 * pad };
  const kl = Math.max(k, Math.min(box.w, box.h * 1.5) / 118);
  // the board strings its cards to these
  const at = { obstacle: built.stagePoint ? V.proj(...built.stagePoint) : null, landmark: built.exit ? V.proj(built.exit.x, built.exit.y, built.exit.z || 0) : null };
  const stModel = Object.assign({}, model, { name: model.name, colour: model.colour });
  // every word and arrow the solver placed, in drawing units, for a theme's stamp to keep clear of (ST.stampAt)
  const tags = { boxes: solved.fixed.concat(solved.boxes).map(q => ({ x0: q.x0, y0: q.y0, w: q.w, h: q.h })), segs: entries.flatMap(e => (e && e.meta && e.meta.segs) || []) };
  // the light a figure gets here (B68Map.lightAt): the lamps' pools and the lit doorways, in world feet
  const pools = [];
  if (S.night) for (const [z, ds] of S.decals) for (const p of ds) {
    if (p.r === "st-g:pool1" && p.t === "ellipse") pools.push({ kind: "lamp", x: p.cx, y: p.cy, z, r: p.rx, ry: p.ry, color: M.light.MAP.night.pool, strength: 1 });
    else if (p.r === "st-g:spill" && p.t === "poly") { const c = M.G.centroid(p.pts), r = Math.max(...p.pts.map(q => Math.hypot(q[0] - c[0], q[1] - c[1]))); pools.push({ kind: "doorway", x: c[0], y: c[1], z, r: r * 1.1, color: M.light.MAP.night.spill, strength: 0.8 }); }
  }
  return { model: stModel, lay: { levels: [], entries: built.entries }, parts, links: [], entries, box, k, kl, tokens: [], opts, offsets: new Map(), W,
    toScreen: ctx.toScreen, roomPos: () => null, _id: X.sid, keyFloor: X.keyFloor || 0, keyAt: X.keyAt || null, floorU: ctx.floorU || 0, onSheet: new Set(), drawn: null,
    street: { facts, night: S.night, flip: V.flip, at, colour: model.colour, tags, view: V, light: X.T.light, pools,
      weather: M.weather.forRender(o, opts, S.night, plate, W) } };
};

// Which ways in's tags (and icons) still lie on another's, or on the landmark, once solved:
// ["front×back", …], measured as the legibility check measures them, in drawing units.
ST.tagClash = function (entries, labels) {
  const boxes = [];
  for (const e of entries) if (e && e.meta && e.meta.kind === "entry") for (const b of e.meta.boxes || []) boxes.push({ k: e.cls.split("-").pop(), b });
  for (const p of labels) if (p && p.meta && p.meta.kind === "landmark") boxes.push({ k: "landmark", b: p.meta.box });
  const out = [];
  for (let a = 0; a < boxes.length; a++) for (let c = a + 1; c < boxes.length; c++) {
    if (boxes[a].k === boxes[c].k) continue;
    const A = boxes[a].b, C = boxes[c].b, ox = Math.min(A.x0 + A.w, C.x0 + C.w) - Math.max(A.x0, C.x0), oy = Math.min(A.y0 + A.h, C.y0 + C.h) - Math.max(A.y0, C.y0);
    if (ox > 0.05 && oy > 0.05) out.push(boxes[a].k + "×" + boxes[c].k);
  }
  // an arrow's shaft through another way's tag, or through the landmark
  const cross = ([x1, y1, x2, y2], b) => {
    let t0 = 0, t1 = 1;
    const dx = x2 - x1, dy = y2 - y1;
    for (const [p, q] of [[-dx, x1 - b.x0], [dx, b.x0 + b.w - x1], [-dy, y1 - b.y0], [dy, b.y0 + b.h - y1]]) {
      if (Math.abs(p) < 1e-12) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
    return t1 - t0 > 1e-6;
  };
  for (const e of entries) if (e && e.meta && e.meta.kind === "entry") {
    const k = e.cls.split("-").pop();
    for (const sg of e.meta.segs || []) for (const q of boxes) if (q.k !== k && cross(sg, q.b)) out.push(k + "~" + q.k);
  }
  return [...new Set(out)];
};

// Where a theme's stamp goes on the street (the case file's rubber stamp): a corner of the drawing
// clear of every tag, label and arrow and of the key, trying bottom-right (where a building's stamp
// goes) first, then bottom-left, top-right and top-left. On a narrow sheet (a phone), where the type
// floor makes the stamp big against the drawing and no corner is clear, it moves along the edges and
// then over the drawing, and only then is set smaller, step by step, until it is clear; if nothing
// is, the place and size that cover the least. [interpretation]
// D: the drawing's rect on the page; w: the stamp's box width; W: its widest line; k: its scale;
// key: the key's rect on the page, if there is one; start: a spot to keep if it is clear (a building
// view's stamp, bottom right). The stamp is a box from -3k to 2.2k round its origin, turned by `rot`
// degrees, then scaled by s. A building view's scene carries its tags as sc.stampTags.
ST.stampAt = function (sc, D, w, W, k, rot, key, start) {
  const cs = sc._cs || 1, ox = D.x - sc.box.x * cs, oy = D.y - sc.box.y * cs, T = (sc.street && sc.street.tags) || sc.stampTags;
  const page = b => ({ x0: ox + b.x0 * cs, y0: oy + b.y0 * cs, x1: ox + (b.x0 + b.w) * cs, y1: oy + (b.y0 + b.h) * cs });
  const boxes = (T ? T.boxes.map(page) : []).concat(key && key.w > 0 && key.h > 0 ? [{ x0: key.x, y0: key.y, x1: key.x + key.w, y1: key.y + key.h }] : []);
  const segs = T ? T.segs.map(([x1, y1, x2, y2]) => [ox + x1 * cs, oy + y1 * cs, ox + x2 * cs, oy + y2 * cs]) : [];
  const a = (rot || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  // the stamp's box turned and scaled, as an axis-aligned box on the page, round an origin (x, y)
  const ext = (x, y, s) => {
    const half = Math.max(w, W) / 2 * s, kk = k * s;
    const pts = [[-half, -3 * kk], [half, -3 * kk], [half, 2.2 * kk], [-half, 2.2 * kk]].map(([u, v]) => [x + u * c - v * sn, y + u * sn + v * c]);
    return { x0: Math.min(...pts.map(p => p[0])), y0: Math.min(...pts.map(p => p[1])), x1: Math.max(...pts.map(p => p[0])), y1: Math.max(...pts.map(p => p[1])) };
  };
  const cover = e => {
    let area = 0;
    for (const b of boxes) { const ox2 = Math.min(e.x1, b.x1) - Math.max(e.x0, b.x0), oy2 = Math.min(e.y1, b.y1) - Math.max(e.y0, b.y0); if (ox2 > 0 && oy2 > 0) area += ox2 * oy2; }
    for (const [x1, y1, x2, y2] of segs) { const n = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1))); for (let i = 0; i <= n; i++) { const px = x1 + (x2 - x1) * i / n, py = y1 + (y2 - y1) * i / n; if (px > e.x0 && px < e.x1 && py > e.y0 && py < e.y1) area += 1; } }
    return area;
  };
  // the four corners, as before
  const at = s => { const inset = Math.max(w, W) * 0.55 * s; return [[D.x + D.w - inset, D.y + D.h - 3 * k * s], [D.x + inset, D.y + D.h - 3 * k * s], [D.x + D.w - inset, D.y + 3.8 * k * s], [D.x + inset, D.y + 3.8 * k * s]]; };
  let best = null;
  for (const [x, y] of (start ? [start] : []).concat(at(1))) { const n = cover(ext(x, y, 1)); if (!best || n < best.n) best = { x, y, n, s: 1 }; if (!n) return { x, y, s: 1, clear: true }; }
  // then along the edges and over the drawing, nearest the bottom-right first; then smaller
  const bx = D.x + D.w, by = D.y + D.h;
  for (const s of [1, 0.85, 0.72, 0.6, 0.5]) {
    const inset = Math.max(w, W) * 0.55 * s, x0 = D.x + inset, x1 = D.x + D.w - inset, y0 = D.y + 3.8 * k * s, y1 = D.y + D.h - 3 * k * s, cands = [];
    if (x1 >= x0 && y1 >= y0) for (let i = 0; i <= 12; i++) for (let j = 0; j <= 8; j++) cands.push([x1 - (x1 - x0) * i / 12, y1 - (y1 - y0) * j / 8]);
    cands.sort((p, q) => Math.hypot(bx - p[0], by - p[1]) - Math.hypot(bx - q[0], by - q[1]));
    for (const [x, y] of cands) { const n = cover(ext(x, y, s)); if (n < best.n) best = { x, y, n, s }; if (!n) return { x, y, s, clear: true }; }
  }
  return { x: best.x, y: best.y, s: best.s, clear: false };
};

// The landmark: a tag shaped like a sign pointing off the sheet, where the road
// leaves it. Orientation for free, never a route.
ST.landmarkTag = function (exit, name, V, ctx, streetW) {
  const k = ctx.k, fu = ctx.floorU || 0, ty = M.scene.type(ctx), size = Math.max(1.7 * k, fu), ls = ty.entryLS || 0;
  // a long name wraps, so the tag never spans the sheet
  const maxW = Math.max(12 * size, (streetW || 200) * 0.22);
  const lines = M.wrapW(String(name).toUpperCase(), maxW, size, ty.label, ls);
  const tw = Math.max(...lines.map(l => M.textW(l, size, ty.label, ls))), pad = size * 0.5, lh = size * 1.12, h = lines.length * lh + size * 0.5, nub = Math.min(h * 0.5, size * 1.4);
  const [ex, ey] = V.proj(exit.x, exit.y, exit.z || 0), d = V.dir(exit.dir || [1, 0]);
  const right = d[0] >= 0, w = tw + 2 * pad;
  // the tag just past the road's end, pointing the way the road goes
  const gap = 2 * k, x0 = right ? ex + gap : ex - gap - w - nub, y0 = ey - h / 2;
  const body = right ? [[x0, y0], [x0 + w, y0], [x0 + w + nub, y0 + h / 2], [x0 + w, y0 + h], [x0, y0 + h]] : [[x0, y0 + h / 2], [x0 + nub, y0], [x0 + nub + w, y0], [x0 + nub + w, y0 + h], [x0 + nub, y0 + h]];
  const tx = right ? x0 + pad : x0 + nub + pad;
  const kids = [P.poly("st-tag", body)];
  lines.forEach((l, i) => kids.push(P.text("st-tag-text", tx, y0 + size * 0.25 + lh * (i + 0.5) + size * 0.36, l, { size, anchor: "start" })));
  return P.g(kids, { cls: "map-landmark", meta: { kind: "landmark", box: { x0, y0, w: w + nub, h } } });
};

// --- The key ---------------------------------------------------------------------------------
// The facts a theme typesets for the street. The player copy keeps what the
// crew could see from the street: no back route, no target, no watcher.
ST.facts = function (o, model, street, built, opts, T) {
  const player = opts.layer === "player";
  const feats = built.features.filter(f => !(player && f.gm));
  feats.forEach((f, i) => { f.n = i + 1; });
  const ways = model.vectors.map((v, i) => ({ kind: ["front", "service", "back"][i], n: v.n, how: v.how, cost: v.cost, know: v.know }))
    .filter(v => !player || !/can't be known/.test(v.know))
    .map(v => player && /question/.test(v.know) ? Object.assign(v, { how: "There is a way in here. Ask how to learn what it is.", cost: "" }) : v);
  const G = M.own(ST.GROUND, street.type) || ST.GROUND["a commercial high street"];
  const timeLine = T.asPlayed ? `${T.time}, as played (rolled: ${[street.timeOfDay, street.weather].filter(Boolean).join(", ")})` : [street.timeOfDay || T.time, street.weather].filter(Boolean).join(", ");
  const ob = street.obstacle ? M.own(ST.OBSTACLE, street.obstacle) : null;
  return {
    kind: "street", player,
    name: street.named || model.name, site: model.name, district: model.district, target: model.target,
    sub: ST.cap(street.type || street.typeRaw || "a street") + (street.named ? ` · outside ${model.name}` : ""),
    time: timeLine,
    street: [street.descRaw && `${ST.cap(street.descRaw)}.`, (street.sound || street.smell) && `${ST.cap(street.sound)}${street.sound && street.smell ? "; " : ""}${street.smell}.`, street.useRaw && `The block is ${street.useRaw.toLowerCase()}.`].filter(Boolean),
    features: feats,
    obstacle: ob ? { name: street.obstacle, icon: ob.icon, text: `Outside: ${street.obstacle.toLowerCase()}. The stretch of street it holds is marked.` } : null,
    ways, landmark: street.landmark, watcher: player ? "" : street.watcher,
    note: player ? "" : G.note + (built.waterNote ? " " + built.waterNote : "")
  };
};

// The key's blocks, in the same lg-* roles as the building's key, so every
// theme sets it in its own type.
ST.legendBlocks = function (F, w, k, opt, ty, fk) {
  const s = k * (opt.scale || 1), blocks = [], ns = Math.max(1.2 * s, fk || 0), nr = Math.max(1.0 * s, ns * 0.8);
  ty = Object.assign({ key: "text", keyBold: "textBold", keyHead: "condensed", title: "poster" }, ty || {});
  const face = { "lg-kicker": [ty.keyHead, ty.kickerLS], "lg-title": [ty.title, 0], "lg-sub": [ty.keyBold, 0], "lg-h": [ty.keyHead, ty.keyHeadLS], "lg-band": [ty.keyHead, ty.bandLS],
    "lg-text": [ty.key, 0], "lg-text-strong": [ty.keyBold, 0], "lg-small": [ty.key, 0], "lg-small-italic": [ty.key, 0] };
  const block = () => { const b = { pieces: [], h: 0 }; blocks.push(b); return b; };
  const text = (b, role, t, size, o = {}) => {
    const [c, ls] = face[role] || [ty.key, 0], maxW = w - (o.x || 0);
    const lines = o.nowrap ? [t] : M.wrapW(t, maxW, size, c, ls || 0);
    for (const l of lines) { b.h += size * 1.25; b.pieces.push(P.text(role, o.x || 0, b.h - size * 0.3, l, { size, anchor: "start" })); }
    return lines.length;
  };
  let b = block();
  text(b, "lg-kicker", ["The street", F.district].filter(Boolean).join(" · ").toUpperCase(), 1.9 * s);
  b.h += 0.6 * s;
  text(b, "lg-title", String(F.name).toUpperCase(), (opt.titleSize || 5.4) * s);
  if (F.sub) text(b, "lg-sub", F.sub, 2.1 * s);
  if (F.time) text(b, "lg-small", F.time, 1.8 * s);
  b.h += 1.2 * s;
  if (F.street.length) {
    b = block(); text(b, "lg-h", "THE STREET", 1.7 * s); b.h += 0.3 * s;
    for (const l of F.street) text(b, "lg-text", l, 1.95 * s);
  }
  if (F.features.length) {
    b = block(); text(b, "lg-h", "ON THE STREET", 1.7 * s); b.h += 0.2 * s;
    text(b, "lg-small-italic", "What a flashback can reach for. Never a route.", 1.7 * s); b.h += 0.4 * s;
    for (const f of F.features) {
      const y0 = b.h;
      b.pieces.push(P.circle("num-bg", 1.6 * s, y0 + 1.15 * s, nr), P.text("num", 1.6 * s, y0 + 1.15 * s + ns * 0.36, String(f.n), { size: ns }));
      const role = f.kind === "site" ? "lg-text-strong" : "lg-text", icons = f.icons || [];
      const iw = icons.length ? icons.length * 2.6 * s + 1.2 * s : 0, [c0, ls0] = face[role];
      const lines = M.wrapW(f.name, w - 3.6 * s - iw, 2 * s, c0, ls0 || 0);
      for (const l of lines) { b.h += 2 * s * 1.25; b.pieces.push(P.text(role, 3.6 * s, b.h - 2 * s * 0.3, l, { size: 2 * s, anchor: "start" })); }
      const ix = 3.6 * s + M.textW(lines[0], 2 * s, c0, ls0 || 0) + 1.6 * s;
      icons.forEach(([nmI, roleI], i) => b.pieces.push(M.icon(nmI, ix + i * 2.6 * s, y0 + 1.15 * s, 2 * s, roleI)));
      if (f.what) text(b, "lg-small", f.what, 1.7 * s, { x: 3.6 * s });
      b.h += 0.3 * s;
    }
  }
  if (F.obstacle) {
    b = block(); text(b, "lg-h", "IN THE WAY", 1.7 * s); b.h += 0.3 * s;
    const y0 = b.h;
    b.pieces.push(M.icon(F.obstacle.icon, 1.2 * s, y0 + 1.3 * s, 2.2 * s, "ov-lock"));
    text(b, "lg-text-strong", F.obstacle.name, 2 * s, { x: 3.4 * s });
    text(b, "lg-small", `${F.obstacle.text} Free to know: it is the front's cost (p.420).`, 1.75 * s, { x: 3.4 * s });
    b.h = Math.max(b.h, y0 + 2.7 * s);
  }
  if (F.ways.length) {
    b = block(); text(b, "lg-h", "THE WAY IN", 1.7 * s); b.h += 0.3 * s;
    for (const v of F.ways) {
      const y0 = b.h, role = "ov-" + v.kind;
      b.pieces.push(P.rect(role + "-tag", 0, y0 + 0.3 * s, 2.4 * s, 2.4 * s, { rx: 0.3 }));
      text(b, "lg-text-strong", `${v.n} — ${v.know}`, 2 * s, { x: 3.4 * s });
      text(b, "lg-small", `${v.how} ${F.player && /question/.test(v.know) ? "" : v.cost}`.trim(), 1.75 * s, { x: 3.4 * s });
      b.h += 0.6 * s;
    }
  }
  if (F.landmark || F.watcher) {
    b = block(); text(b, "lg-h", "NEARBY", 1.7 * s); b.h += 0.3 * s;
    if (F.landmark) text(b, "lg-text", `Landmark: ${F.landmark}.`, 1.9 * s);
    if (F.watcher) text(b, "lg-small", `Watching: ${F.watcher}.`, 1.75 * s);
  }
  if (F.note) { b = block(); text(b, "lg-small-italic", `${F.note} [interpretation]`, 1.7 * s); }
  return blocks;
};

// The key as HTML (B68Map.key with view "street").
ST.keyHTML = function (F, th) {
  const e = M.esc;
  const icon = (name, role) => th ? `<svg class="b68-key__icon" viewBox="-1.4 -1.4 2.8 2.8" aria-hidden="true">${M.toSVG([M.icon(name, 0, 0, 2, role)], { paint: th.paint })}</svg>` : "";
  let h = `<section class="b68-key" data-layer="${F.player ? "player" : "gm"}" data-view="street">`;
  h += `<header><p class="b68-key__kicker">${e(["The street", F.district].filter(Boolean).join(" · "))}</p><h2>${e(F.name)}</h2>`;
  if (F.sub) h += `<p class="b68-key__sub">${e(F.sub)}</p>`;
  if (F.time) h += `<p class="b68-key__time">${e(F.time)}</p>`;
  h += `</header>`;
  if (F.street.length) h += `<section class="b68-key__street"><h3>The street</h3>${F.street.map(l => `<p>${e(l)}</p>`).join("")}</section>`;
  if (F.features.length) {
    h += `<section class="b68-key__features"><h3>On the street</h3><p class="b68-key__small">What a flashback can reach for. Never a route.</p><ol>`;
    for (const f of F.features) h += `<li value="${f.n}" data-feature="${e(f.kind)}"><span class="b68-key__n">${f.n}</span><span><span class="${f.kind === "site" ? "b68-key__strong" : ""}">${e(f.name)}</span>${(f.icons || []).map(([n, r]) => icon(n, r)).join("")}${f.what ? `<br><span class="b68-key__small">${e(f.what)}</span>` : ""}</span></li>`;
    h += `</ol></section>`;
  }
  if (F.obstacle) h += `<section class="b68-key__obstacles"><h3>In the way</h3><ul><li>${icon(F.obstacle.icon, "ov-lock")}<span><span class="b68-key__strong">${e(F.obstacle.name)}</span><br><span class="b68-key__small">${e(F.obstacle.text)} Free to know: it is the front's cost (p.420).</span></span></li></ul></section>`;
  if (F.ways.length) {
    h += `<section class="b68-key__ways"><h3>The way in</h3><ul>`;
    for (const v of F.ways) { const a = th ? th.paint("ov-" + v.kind + "-tag", { t: "rect" }) : null; h += `<li data-way="${v.kind}"><span class="b68-key__swatch" style="background:${e(a && a.fill && !/^url/.test(a.fill) ? a.fill : "#14110e")}"></span><span><span class="b68-key__strong">${e(v.n)} — ${e(v.know)}</span><br><span class="b68-key__small">${e(`${v.how} ${F.player && /question/.test(v.know) ? "" : v.cost || ""}`.trim())}</span></span></li>`; }
    h += `</ul></section>`;
  }
  if (F.landmark || F.watcher) h += `<section class="b68-key__nearby"><h3>Nearby</h3>${F.landmark ? `<p>Landmark: ${e(F.landmark)}.</p>` : ""}${F.watcher ? `<p class="b68-key__small">Watching: ${e(F.watcher)}.</p>` : ""}</section>`;
  if (F.note) h += `<p class="b68-key__note">${e(F.note)} [interpretation]</p>`;
  return h + `</section>`;
};

// B68Map.key(o, { view: "street" }): the same facts, numbered as the drawing numbers them.
ST.key = function (o, opts, W, theme, model, seed) {
  const rng = M.rng(seed), player = opts.layer === "player", T = ST.time(o, opts, W);
  const lay = model.rooms.length ? M.layout.build(model, "plan", rng.fork("layout"), { player }) : null;
  const street = ST.read(o, W);
  const ctx = { rng: rng.fork("street"), W, opts, k: 2, reveal: player ? new Set(opts.reveal || ["public"]) : null, floorU: 0, type: theme.type, drawn: null };
  const built = ST.compose(o, model, lay, street, ctx, T);
  const facts = ST.facts(o, model, street, built, opts, T);
  const paintTheme = opts.theme === "board" ? (M.own(M.THEMES, opts.sheet) && opts.sheet !== "board" ? M.own(M.THEMES, opts.sheet) : M.THEMES.blueprint) : theme;
  const th = paintTheme.painter ? paintTheme.painter({ model, opts, _id: "b68k" + M.hash(model.name).toString(36), lay: { levels: [] }, street: { night: T.time === "Night", facts } }) : null;
  return { facts, html: ST.keyHTML(facts, th), css: M.KEY_CSS, warnings: W };
};

// The board's cards for the street: the obstacle, the ways in, the landmark.
ST.boardCards = function (scene, F) {
  const cards = [], at = scene.street.at;
  cards.push({ col: 0, head: "THE STREET", lines: [F.sub, ...F.street.slice(0, 1)] });
  if (F.obstacle) cards.push({ col: 0, head: "IN THE WAY", lines: [F.obstacle.name, F.obstacle.text], sheetAt: at.obstacle, pin: "#e8c33c" });
  if (F.landmark) cards.push({ col: 0, head: "NEARBY", lines: [F.landmark, F.watcher ? "Watching: " + F.watcher : ""], sheetAt: at.landmark, pin: "#6e8f6a" });
  const player = F.player;
  (scene.lay.entries || []).forEach((e, i) => {
    if (player && e.vec && /can't be known/.test(e.vec.know)) return;
    const ep = scene.toScreen(e.level, e.x, e.y, "floor"), hush = player && e.vec && /question/.test(e.vec.know);
    cards.push({ col: 1, head: (e.vec ? e.vec.n : e.kind).toUpperCase(), lines: e.vec ? (hush ? ["There is a way in here.", "(costs a question)"] : [e.vec.how, e.vec.cost, `(${e.vec.know})`]) : [], sheetAt: ep, pin: ["#14110e", "#3f62c4", "#98206a"][["front", "service", "back"].indexOf(e.kind)] || "#14110e" });
  });
  return cards;
};

// --- Paint --------------------------------------------------------------------------------
// Street roles: st-g:<ground> (flat, under the iso matrix), st-f/st-s/st-m/st-t:<material>
// (a solid's front, side, between and top faces), st-d:<detail> (windows,
// doors, signs on a face), st-x:<effect> (light, fire, wire). A theme gives a
// palette; this turns a role into paint with it.
ST.paint = function (pal, role, p) {
  if (!role.startsWith("st-")) return undefined;
  if (role === "st-tag") return pal.tag ? pal.tag() : undefined;
  if (role === "st-tag-text") return pal.tagText ? pal.tagText() : undefined;
  const i = role.indexOf(":"); if (i < 0) return undefined;
  const kind = role.slice(3, i), name = role.slice(i + 1);
  if (kind === "g") return pal.g(name, p);
  if (kind === "d") return pal.d(name, p);
  if (kind === "x") return pal.x(name, p);
  if (kind === "f" || kind === "s" || kind === "m" || kind === "t") return pal.face(kind, name, p);
  return undefined;
};

// ---- src/streetparts.js ----
// =============================================================================
// streetparts — what the street is made of, and where it all stands
// =============================================================================
// Every table here is [interpretation], one line per printed entry. The names
// are the book's: a label on the street is cut from the printed words ("an old
// bronze statue covered in graffiti and bird shit" → "Bronze statue") and the
// key prints them whole.

// --- Street types → grounds (p.420; the grouping is the pitch's Rule 1) ------------------
const GN = {
  corridor: "Corridor: frontage both sides. Traffic is the crowd you hide in.",
  lane: "Lane: doors open onto the road; a twisting lane hides its next bend.",
  deck: "Deck: two levels at once. The drop between them is the skip.",
  open: "Open: everyone sees everyone. Sightlines are the lock.",
  hub: "Hub: every route passes the island; the island sees everyone twice.",
  covered: "Covered: a spine under glass. The roof is a second street.",
  deadend: "Dead end: one mouth. Whoever holds it holds the street.",
  waterside: "Waterside: a towpath, with the canal as a second road."
};
ST.GROUND = {
  "a wide multi-lane boulevard": { g: "corridor", v: "boulevard" },
  "a dark, narrow alley": { g: "lane", v: "alley" },
  "a commercial high street": { g: "corridor", v: "high" },
  "an elevated concrete walkway": { g: "deck", v: "walkway" },
  "a grimy backstreet": { g: "lane", v: "back" },
  "a soaring flyover": { g: "deck", v: "flyover" },
  "a twisting cobblestone lane": { g: "lane", v: "twist" },
  "a glass-roofed arcade": { g: "covered", v: "arcade" },
  "a brutalist open plaza": { g: "open", v: "plaza" },
  "a dead-end cul-de-sac": { g: "deadend", v: "culdesac" },
  "a quiet canal path": { g: "waterside", v: "canal" },
  "a busy roundabout": { g: "hub", v: "roundabout" }
};
for (const v of Object.values(ST.GROUND)) v.note = GN[v.g];

// --- Nearby buildings (p.430): what each looks like from the street -------------------------
// w and d in feet, st storeys; k picks the façade.
ST.NEIGHBOUR = {
  "an apartment building": { k: "flats", w: 46, d: 40, st: 5, mat: "concrete" },
  "a house": { k: "house", w: 30, d: 30, st: 2, mat: "brick" },
  "a milkbar": { k: "shop", w: 28, d: 30, st: 2, mat: "render", awning: true },
  "a pub": { k: "pub", w: 34, d: 34, st: 2, mat: "brick" },
  "a laundrette": { k: "shop", w: 28, d: 30, st: 2, mat: "render" },
  "a pawnshop": { k: "shop", w: 26, d: 30, st: 2, mat: "brick", grille: true },
  "a pharmacy": { k: "shop", w: 28, d: 30, st: 2, mat: "render", cross: true },
  "a newsagent": { k: "shop", w: 24, d: 28, st: 2, mat: "brick", board: true },
  "a kaff house": { k: "shop", w: 30, d: 30, st: 2, mat: "render", awning: true, tables: true },
  "an office building": { k: "office", w: 44, d: 40, st: 6, mat: "glass" },
  "a garage": { k: "garage", w: 40, d: 36, st: 1, mat: "metal" },
  "a warehouse": { k: "warehouse", w: 50, d: 44, st: 2, mat: "brick" },
  "a casino": { k: "venue", w: 48, d: 44, st: 3, mat: "render" },
  "a cinema": { k: "cinema", w: 44, d: 48, st: 3, mat: "render" },
  "a restaurant": { k: "shop", w: 32, d: 32, st: 2, mat: "render", awning: true },
  "a bank": { k: "bank", w: 42, d: 40, st: 3, mat: "stone" },
  "a bookshop": { k: "shop", w: 26, d: 30, st: 2, mat: "brick" },
  "a precinct station": { k: "civic", w: 46, d: 42, st: 3, mat: "concrete", bluelamp: true },
  "a boathouse": { k: "boathouse", w: 40, d: 36, st: 1, mat: "wood" },
  "a mansion": { k: "mansion", w: 54, d: 44, st: 3, mat: "stone" },
  "an electroplasmic substation": { k: "substation", w: 44, d: 36, st: 1, mat: "metal" },
  "an automat diner": { k: "diner", w: 32, d: 30, st: 1, mat: "white" },
  "a temple": { k: "temple", w: 44, d: 44, st: 3, mat: "stone" },
  "a school": { k: "school", w: 52, d: 40, st: 3, mat: "brick" }
};

// --- Block use (base Blades): the lot at the end of the frontage ---------------------------------
ST.USE = {
  Residential: { k: "flats", w: 44 }, Crafts: { k: "workshop", w: 40 }, Labour: { k: "yard", w: 46 },
  Shops: { k: "shoprow", w: 50 }, Trade: { k: "market", w: 48 }, Hospitality: { k: "hotel", w: 44 },
  "Law and government": { k: "court", w: 48 }, "Public space": { k: "square", w: 48 }, Power: { k: "pylon", w: 44 },
  Manufacture: { k: "factory", w: 52 }, Transportation: { k: "depot", w: 52 }, Leisure: { k: "park", w: 48 },
  Vice: { k: "club", w: 38 }, Entertainment: { k: "theatre", w: 46 }, Storage: { k: "lockups", w: 46 },
  Cultivation: { k: "plot", w: 46 }, Academic: { k: "college", w: 50 }, Artists: { k: "studio", w: 40 }
};

// --- Street descriptions (p.419–420) ------------------------------------------------------------------
// where: "lot" takes the west end lot; "street" stands on the pavement; "back"
// shapes the block behind; "face" goes on a façade.
ST.DESC = {
  "a maze of tall brick buildings, with narrow streets between": { k: "maze", label: "Tall brick buildings", where: "back" },
  "a colourful storefront decorated with geometric designs": { k: "storefront", label: "Colourful storefront", where: "lot" },
  "a bright white building with rounded curves and bubble windows": { k: "bubble", label: "Bright white building", where: "lot" },
  "a huge concrete apartment block overhead": { k: "slab", label: "Concrete apartment block", where: "back" },
  "billboards advertising the latest music, fashion and consumer products": { k: "billboards", label: "Billboards", where: "lot" },
  "power poles holding up cables, wires and electroplasmic transformers": { k: "poles", label: "Power poles", where: "street" },
  "a street vendor operating out of a modular polyfiber kiosk": { k: "vendor", label: "Street vendor", where: "street" },
  "a brightly coloured mural of flowers in browns, yellows and greens": { k: "mural", label: "Mural of flowers", where: "lot" },
  "a scrap of nature; dark rock covered with tufts of yellow and red grass": { k: "nature", label: "A scrap of nature", where: "lot" },
  "dozens of glowing plasmovision screens": { k: "screens", label: "Plasmovision screens", where: "lot" },
  "an old bronze statue covered in graffiti and bird shit": { k: "statue", label: "Bronze statue", where: "street" },
  "scaffolding around an aged building, with a modern extension being added": { k: "scaffold", label: "Scaffolding", where: "lot" }
};

// --- Street props (base Blades): what each is and where it goes ---------------------------------
// z: pave (the pavement), road (the carriageway), water, lot (a gap or the end
// lot), passage (a side passage), air (overhead), kerb.
ST.PROP = {
  "nets and ropes": { d: "nets", z: "pave" }, "stacked crates": { d: "crates", z: "pave" }, "cables and chains": { d: "cables", z: "pave" },
  "drain pipes": { d: "pipes", z: "pave" }, "a water pump": { d: "pump", z: "pave" }, "oil drums": { d: "drums", z: "pave" },
  "a brick pile": { d: "bricks", z: "pave" }, "iron bars": { d: "bars", z: "pave" }, "wooden boards": { d: "boards", z: "pave" },
  "cut stones": { d: "stones", z: "pave" }, "loose rocks": { d: "rocks", z: "road" }, "cement buckets": { d: "buckets", z: "pave" },
  "a sewer grate": { d: "grate", z: "road" }, "rotting refuse": { d: "refuse", z: "pave" }, "mud puddles": { d: "puddles", z: "road" },
  "discarded junk": { d: "junk", z: "pave" }, "sodden trash": { d: "trash", z: "pave" }, "push carts": { d: "carts", z: "pave" },
  "moored boats": { d: "boats", z: "water" }, "a cargo barge": { d: "barge", z: "water" }, "gondolas": { d: "gondolas", z: "water" },
  "a crane and pulleys": { d: "crane", z: "lot" }, "cargo bales": { d: "bales", z: "pave" }, "metal ingots": { d: "ingots", z: "pave" },
  "coal and fuel drums": { d: "coal", z: "pave" }, "waste bins": { d: "bins", z: "pave" }, "street lamps": { d: "lamps", z: "kerb" },
  "electric wires": { d: "wires", z: "air" }, "junction boxes": { d: "boxes", z: "pave" }, "a spotlight tower": { d: "spotlight", z: "lot" },
  "a clock tower": { d: "clock", z: "lot" }, "a messenger post": { d: "post", z: "pave" }, "a monument": { d: "monument", z: "pave" },
  "a fountain": { d: "fountain", z: "pave" }, "a collapsed building": { d: "collapse", z: "lot" }, "a flimsy hovel": { d: "hovel", z: "lot" },
  "a barricade": { d: "barricade", z: "road" }, "a gate": { d: "gate", z: "passage" }, "a checkpoint": { d: "checkpoint", z: "road" },
  "piled rubble": { d: "rubble", z: "pave" }, "a canal lock": { d: "lock", z: "water" }, "a food stall": { d: "stall", z: "pave" },
  "a vendor stall": { d: "stall", z: "pave" }, "barrels and casks": { d: "barrels", z: "pave" }, "a news stand": { d: "news", z: "pave" }
};
const WATER_PROP = p => M.own(ST.PROP, p) && M.own(ST.PROP, p).z === "water";

// --- Street obstacles (p.420) as set pieces --------------------------------------------------------
ST.OBSTACLE = {
  "Quarantine/lockdown": { d: "quarantine", icon: "hazard" }, Parade: { d: "parade", icon: "people" }, Riot: { d: "riot", icon: "fire" },
  "Street performers": { d: "performers", icon: "people" }, Protest: { d: "protest", icon: "people" }, "Street evangelist": { d: "evangelist", icon: "people" },
  "Traffic jam": { d: "jam", icon: "hazard" }, "Construction/demolition": { d: "construction", icon: "hazard" }, "Gang warfare": { d: "gangs", icon: "guard" },
  "Paranormal incident": { d: "paranormal", icon: "entity" }, "Bluecoat checkpoint": { d: "checkpoint", icon: "guard" }, "Street closed by flooding": { d: "flood", icon: "hazard" }
};

// --- The site's condition and volume (the base location tables) as seen from the street ------------
// [interpretation] Only what can be seen from outside, on the site itself: its windows, its walls,
// its frontage, and how busy the street is. They never add a room, a guard, a lock or loot, never
// move a way in, and never change the building's size: "far bigger than it looks" is a fact about
// the plan, so the street shows nothing for it. The words are in the GM copy's key only.
ST.CONDITION = {
  "half-abandoned": { board: 0.3, litP: 0.1, litter: true, says: "boarded windows, litter at the door" },
  "standing empty": { board: 0.45, litP: 0, litter: true, people: 0.6, says: "boarded windows, no light inside, litter, few people" },
  forgotten: { board: 0.35, litP: 0, litter: true, people: 0.6, says: "boarded windows, no light inside, litter, few people" },
  broken: { board: 0.4, litP: 0.15, litter: true, says: "boarded windows, litter at the door" },
  defended: { grille: true, says: "bars on the ground-floor windows" },
  protected: { grille: true, says: "bars on the ground-floor windows" },
  "hard to get into": { grille: true, says: "bars on the ground-floor windows" },
  "blocked off": { grille: true, boardGround: true, says: "the ground floor boarded and barred" },
  occupied: { litP: 0.55, people: 1.3, says: "most windows lit at Night, more people" },
  "densely packed": { litP: 0.6, people: 1.6, says: "most windows lit at Night, a busy street" },
  contested: { graffiti: true, people: 1.2, says: "rival tags on the ground floor" },
  remote: { people: 0.5, traffic: 0.5, says: "a quiet street" },
  isolated: { people: 0.4, traffic: 0.4, says: "a quiet street" },
  hidden: { people: 0.7, says: "fewer people about" },
  rich: { litP: 0.5, says: "warm light in the windows at Night" },
  strange: { strange: true, says: "a shimmer at its foot" },
  "long settled": { says: "" }, exposed: { says: "" }, "far bigger than it looks": { says: "" }, "smaller than it looks": { says: "" }
};
ST.VOLUME = {
  "drafty and cold": { board: 0.12, says: "a few windows patched over" },
  "stout and quiet": { says: "" },
  "cosy and warm": { litP: 0.55, says: "warm light in the windows at Night" },
  "vaulted and spacious": { tall: 1.3, says: "tall windows" },
  "low and cramped": { tall: 0.72, says: "low windows" },
  "rickety and ramshackle": { patch: true, board: 0.1, says: "patched walls" }
};
// The roll's condition and volume, merged into one set of instructions for the street (unknown words: nothing).
ST.looks = function (o, W) {
  const c = String(o.condition || "").trim().toLowerCase(), v = String(o.volume || "").trim().toLowerCase();
  const C = c ? M.own(ST.CONDITION, c) : null, Vv = v ? M.own(ST.VOLUME, v) : null;
  if (c && !C && W) M.warn(W, `condition "${o.condition}" is not one the location tables print — the street shows nothing for it`);
  if (v && !Vv && W) M.warn(W, `volume "${o.volume}" is not one the location tables print — the street shows nothing for it`);
  const L = Object.assign({}, Vv || {}, C || {});
  L.board = Math.max((C && C.board) || 0, (Vv && Vv.board) || 0);
  L.litP = C && C.litP != null ? C.litP : Vv && Vv.litP != null ? Vv.litP : null;
  L.words = [c && C ? c : "", v && Vv ? v : ""].filter(Boolean).join(", ");
  L.says = [C && C.says, Vv && Vv.says].filter(Boolean).join("; ");
  L.any = !!(C || Vv);
  return L;
};

// --- The site's look from the street, by printed building style (p.430–431) -----------------------
const STYLE_LOOK = {
  Modernist: { win: "band", roof: "flat", parapet: 1.2 },
  Brutalist: { win: "slit", roof: "flat", parapet: 2.6 },
  "Old relic": { win: "tall", roof: "pitch", cornice: true },
  "Corporate chic": { win: "grid", roof: "plant", parapet: 1.4 },
  Alternative: { win: "odd", roof: "flat", parapet: 1, mural: true },
  Futurist: { win: "round", roof: "dome", rounded: true }
};
// Rooms that are the roof itself: on top, not a storey (p.421, p.423, p.424, p.427).
const ROOF_ROOMS = /^(Rooftop|Rooftop terrace|Roof terrace|Observation deck|Rooftop area)$/;
const GF = 13, STOREY = 11;

// =============================================================================
// Composition
// =============================================================================
ST.compose = function (o, model, lay, street, ctx, T) {
  const W = ctx.W, player = ctx.opts.layer === "player", gm = !player;
  const night = T.time === "Night";
  const ents = lay ? lay.entries : [];
  const ent = kind => ents.find(e => e.kind === kind) || null;
  const svc = ent("service");
  // look in from the corner the building's iso does (L.entries picks the one
  // that shows the service side; the back route never picks it, so the player
  // copy, which hasn't got one, looks in from the same corner)
  const flip = !!(lay && lay.isoCorner === "left");
  const V = ST.view(flip);
  // GM-only drawing (the back route) never rolls a die: the player copy and the
  // GM copy draw the same street, whatever the GM-only facts are
  const rng = ctx.rng, S = ST.stage(V, rng.fork("stage"), night, ctx);
  const G = M.own(ST.GROUND, street.type) || ST.GROUND["a commercial high street"];
  const waterProps = street.props.filter(WATER_PROP);
  const site = ST.siteSpec(model, lay, W);
  S.looks = ST.looks(o, W); S.looksRng = rng.fork("looks");

  // --- the frontage, west to east -----------------------------------------------------------
  // the face a way in lands on: the plan's wall (bottom is the street front),
  // the roof or the ground for a way from above or below, else its arrow
  const FACE = { bottom: "front", top: "back", left: "west", right: "east" };
  const sideOf = e => !e ? null : e.from ? (e.from === "above" ? "roof" : "below") : e.side && FACE[e.side] ? FACE[e.side]
    : !e.dir ? null : e.dir[0] > 0.5 ? "east" : e.dir[0] < -0.5 ? "west" : e.dir[1] < -0.5 ? "back" : "front";
  const svcSide = sideOf(svc);
  // The passage on the service side is wide, and when the plan's service door is
  // deeper than the passage, the neighbour there is cut down to its ground
  // floor (the cut shows as the iso's cut walls do), so the door can be seen.
  // The other passage on the side the street sees is an alley; the far one, 5 ft.
  const svcDepth = svc && svc.level && lay ? -site.toWorld(svc.level, svc.x, svc.y)[1] : 0;
  const gapW = svcSide === "west" ? 16 : flip ? 10 : 5, gapE = svcSide === "east" ? 16 : flip ? 5 : 10;
  const cutW = svcSide === "west" && svcDepth > gapW - 2, cutE = svcSide === "east" && svcDepth > gapE - 2;
  const nbSpec = n => M.own(ST.NEIGHBOUR, n) || ST.NEIGHBOUR["a house"];
  const n1 = street.neighbours[0] || null, n2 = street.neighbours[1] || null;
  const N1 = n1 ? nbSpec(n1) : null, N2 = n2 ? nbSpec(n2) : null;
  const desc = street.desc ? M.own(ST.DESC, street.desc) : null, use = street.use ? M.own(ST.USE, street.use) : null;
  const lots = [];
  const siteLot = { kind: "site", x0: -site.W / 2, x1: site.W / 2, d: site.D, y0: 0 };
  let xl = siteLot.x0 - gapW, xr = siteLot.x1 + gapE;
  const nb1 = N1 ? { kind: "nb", which: 1, name: n1, spec: N1, x1: xl, x0: xl - N1.w, d: N1.d, y0: N1.k === "mansion" || N1.k === "school" ? -12 : 0, cut: cutW } : null;
  if (nb1) { lots.push(nb1); xl = nb1.x0 - 4; }
  const nb2 = N2 ? { kind: "nb", which: 2, name: n2, spec: N2, x0: xr, x1: xr + N2.w, d: N2.d, y0: N2.k === "mansion" || N2.k === "school" ? -12 : 0, cut: cutE } : null;
  if (nb2) { lots.push(nb2); xr = nb2.x1 + 4; }
  const descLot = desc && desc.where === "lot" ? { kind: "desc", x1: xl, x0: xl - (desc.k === "billboards" ? 34 : 40), d: 36, y0: desc.k === "nature" ? 0 : 0 } : { kind: "block", x1: xl, x0: xl - 36, d: 34, y0: 0 };
  lots.push(descLot); xl = descLot.x0;
  const useLot = { kind: use ? "use" : "block", x0: xr, x1: xr + (use ? use.w : 36), d: 36, y0: 0 };
  lots.push(useLot); xr = useLot.x1;
  lots.push(siteLot);
  const F = { X0: xl - 18, X1: xr + 18, lots, site: siteLot, nb1, nb2, descLot, useLot, maxD: Math.max(...lots.map(l => l.d - l.y0)) };

  // --- the ground ---------------------------------------------------------------------------------
  const ground = M.own(ST.GROUNDS, G.g)(S, F, G.v, { water: waterProps.length > 0, street, rng: S.rng });
  F.ground = ground;
  const zs = ground.zSite || 0;                     // the level the frontage stands on
  // the side passages between the lots, under whatever stands in them
  ST.passages(S, F, zs);

  // --- the block behind ----------------------------------------------------------------------------
  ST.backdrop(S, F, desc, zs);

  // --- the site ---------------------------------------------------------------------------------------
  const siteOut = ST.siteMass(S, site, model, F, zs, { gm, ent, sideOf, street, o });

  // --- what the site's condition puts at its foot
  ST.siteFoot(S, F, zs, site);
  // --- next door, the end lots ------------------------------------------------------------------------------
  const nbOut = [nb1, nb2].map(L => L ? ST.neighbour(S, L, zs, F) : null);
  const descOut = descLot.kind === "desc" ? ST.descLot(S, descLot, desc, zs, F) : ST.plainLot(S, descLot, zs, "block");
  const useOut = useLot.kind === "use" ? ST.useLot(S, useLot, use, zs, F) : ST.plainLot(S, useLot, zs, "block");
  // --- the service side and (GM only) the back route, now that what stands beside the site is known ---
  ST.waysIn(S, site, F, zs, siteOut, { gm, ent, sideOf }, [nbOut[0], nbOut[1], descOut, useOut]);

  // --- on the street -----------------------------------------------------------------------------------
  const slots = ST.slots(S, F, ground, siteOut);
  const descStreet = desc && desc.where !== "lot" ? ST.descStreet(S, F, desc, ground, slots) : null;
  // the props spread along the frontage, one in front of each lot in turn
  const spots = [F.nb1, F.nb2, F.useLot, F.descLot].filter(Boolean).map(L => (L.x0 + L.x1) / 2);
  const propOut = street.props.map((p, i) => ST.prop(S, F, p, ground, slots, zs, spots[i % spots.length]));
  // the obstacle and the people keep the front door and the service side in sight
  const keep = ST.keep(siteOut), loose0 = S.items.length;
  const obOut = street.obstacle ? ST.stageObstacle(S, F, M.own(ST.OBSTACLE, street.obstacle).d, ground, zs, keep) : null;
  if (obOut) ST.obstacleGround(S, F, ground, zs);
  const LKs = S.looks || {};
  ST.streetLife(S, F, LKs.people || LKs.traffic ? Object.assign({}, ground, { people: Math.max(1, Math.round((ground.people || 4) * (LKs.people || 1))), traffic: Math.round((ground.traffic || 0) * (LKs.traffic || 1)) }) : ground, { obstacle: street.obstacle, props: street.props });
  ST.sightlines(S, keep, loose0);
  if (S.deckTop) S.deckTop.closed = true;

  // --- the features the key numbers ------------------------------------------------------------------------
  const feats = [];
  // a building's name sits on its roof, the biggest face the reader sees
  const faceFeature = (it, name, kind, what, icons, extra) => {
    if (!it) return;
    const [x0, y0, , x1, y1, z1] = it.b, m = 1.2;
    const region = [V.proj(x0 + m, y0 + m, z1), V.proj(x1 - m, y0 + m, z1), V.proj(x1 - m, y1 - m, z1), V.proj(x0 + m, y1 - m, z1)];
    const c = V.proj((x0 + x1) / 2, (y0 + y1) / 2, z1);
    feats.push(Object.assign({ name, kind, what, icons: icons || [], anchor: c, region: region.map(p => [p[0] - c[0], p[1] - c[1]]) }, extra || {}));
  };
  const pointFeature = (pt, name, kind, what, icons, size, extra) => {
    if (!pt) return;
    const c = V.proj(pt[0], pt[1], pt[2] || 0), s = size || 2.4;
    const region = [[-s, -s * 0.6], [s, -s * 0.6], [s, s * 0.6], [-s, s * 0.6]];
    feats.push(Object.assign({ name, kind, what, icons: icons || [], anchor: c, region }, extra || {}));
  };
  faceFeature(siteOut.item, model.name, "site", gm && S.looks && S.looks.words ? `The site: ${S.looks.words}${S.looks.says ? ` (drawn: ${S.looks.says})` : ""}. Its rooms are in the building views.` : "The site. Its rooms are in the building views.", gm && model.rooms.some(r => r.isTarget) ? [["star", "ov-target"]] : [], {});
  nbOut.forEach((n, i) => { if (n) faceFeature(n.item, ST.cap(i ? n2 : n1), "nb", "Next door (p.430)."); });
  if (descOut && descOut.item && desc) faceFeature(descOut.item, desc.label, "desc", `${ST.cap(street.descRaw)} (p.419).`);
  if (descStreet && desc) pointFeature(descStreet.pt, desc.label, "desc", `${ST.cap(street.descRaw)} (p.419).`, [], descStreet.size);
  propOut.forEach((p, i) => { if (p) pointFeature(p.pt, ST.cap(street.props[i]), "prop", "On the street (base Blades props).", [], p.size); });
  if (useOut && useOut.item && use) faceFeature(useOut.item, street.use, "use", "What the block is for (base Blades).");
  if (obOut) pointFeature(obOut.pt, street.obstacle, "obstacle", "In the way (p.420): the front's cost, free to know.", [[M.own(ST.OBSTACLE, street.obstacle).icon, "ov-lock"]], obOut.size);
  S.features = feats;

  // --- the ways in, where the plan put the doors --------------------------------------------------------------------
  const entries = siteOut.entries;
  return { S, V, entries, features: feats, streetW: (F.X1 - F.X0) * SIC, roadName: ground.roadName && street.named ? Object.assign({ text: street.named.replace(/^the /i, "").toUpperCase() }, ground.roadName) : null,
    exit: ground.exit, stagePoint: obOut ? obOut.pt : null, waterNote: ground.waterNote || "" };
};

// --- The site, as the plan builds it ------------------------------------------------------------------
ST.siteSpec = function (model, lay, W) {
  if (!lay) return { W: 60, D: 46, storeys: 2, H: GF + STOREY, roofDeck: false, shape: "rect", toWorld: () => [0, 0], levelZ: () => 0, lv0: null, empty: true };
  const lv0 = lay.levels.find(l => l.lvl === 0) || lay.levels[0];
  const B = lv0.bbox, SB = lv0.siteBox || B;
  const ship = !!lv0.hull, hub = lv0.exterior.kind === "hub";
  const Wd = ship ? SB.w : B.w, beam = ship ? Math.max(24, Math.min(44, (SB.w - 4) * 0.3)) : 0, Dd = ship ? beam + 17 : B.h;
  let top = 0, roofDeck = false;
  for (const lv of lay.levels) {
    if (lv.lvl <= 0 || lv.ground) continue;          // E3's sheets (a roof, a walkway) are not storeys
    if (lv.lvl === 2 && lv.rooms.length && lv.rooms.every(r => ROOF_ROOMS.test(r.name))) { roofDeck = true; top = Math.max(top, 1); continue; }
    top = Math.max(top, lv.lvl);
  }
  const storeys = top + 1, H = GF + STOREY * (storeys - 1);
  // plan → world: every floor centred on the ground floor, its front on y = 0
  const C = lv => { const b = lv === lv0 && ship ? SB : lv.bbox; return [b.x + b.w / 2, b.y + b.h / 2]; };
  const toWorld = (lv, x, y) => { const [cx, cy] = C(lv); return [x - cx, y - cy - Dd / 2]; };
  const levelZ = lv => lv.lvl < 0 ? -STOREY : lv.lvl === 0 ? 0 : GF + STOREY * (lv.lvl - 1);
  // an open-air site (outdoors.js): its "roof" is its top deck, or the lot
  const open = lay.open || null, deckZ = open ? Math.max(0, ...lay.levels.filter(l => l.lvl >= 0 && !l.ground).map(levelZ)) : 0;
  return { W: Wd, D: Dd, storeys, H, roofDeck, shape: ship ? "ship" : hub ? "hub" : "rect", toWorld, levelZ, lv0, lay, hull: ship ? lv0.hull : null, hullBox: SB, beam, open, deckZ };
};

// What must stay in sight, as points: a grid over a rect on a face (p0: where u = 0
// on it, t: along it, n: out of it) or on the ground.
const gridOn = (p0, t, n, ua, ub, za, zc, nu = 3, nz = 3) => {
  const out = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nz; j++) { const a = ua + (ub - ua) * (nu > 1 ? i / (nu - 1) : 0.5), z = za + (zc - za) * (nz > 1 ? j / (nz - 1) : 0.5); out.push([p0[0] + t[0] * a + n[0] * 0.05, p0[1] + t[1] * a + n[1] * 0.05, z]); }
  return out;
};
const gridGround = (xa, ya, xb, yb, z, n = 3) => { const out = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push([xa + (xb - xa) * i / (n - 1), ya + (yb - ya) * j / (n - 1), z]); return out; };

// The site's building: its walls from the printed style, its front door where
// the plan put it, the service door on its side, and (GM) the back route.
// out.taken records, for each way in as it is drawn, what it stands on (its face, its
// stretch of that face and its height) and where its arrow lands, so a later way keeps
// clear of an earlier one (ST.wayIn) and the obstacle keeps clear of both (ST.sightlines).
ST.siteMass = function (S, site, model, F, zs, X) {
  const { V } = S, look = M.own(STYLE_LOOK, model.styleName) || STYLE_LOOK.Brutalist, night = S.night;
  const x0 = F.site.x0, x1 = F.site.x1, y0 = -site.D, y1 = 0, H = site.H;
  const out = { item: null, entries: [], taken: [], blocks: [] };
  let main, shipOut = null, stad = null;
  if (site.open) main = M.outdoors.street(S, site, model, F, zs);           // drawn without a roof
  else if (site.shape === "ship") { shipOut = ST.ship(S, site, F, zs); main = shipOut.item; }
  else if (site.shape === "hub" || look.rounded) { stad = ST.stadium(x0, y0, x1, y1); main = ST.rounded(S, stad, zs, H, site); }
  else {
    main = S.box(x0, y0, zs, x1, y1, zs + H, "site", f => ST.windows(S, f, look, site.storeys, { site: true, night, looks: S.looks }));
    if (look.mural) ST.mural(S, main, x0, x1, y1, zs, H);
    if (look.cornice) S.box(x0 - 0.6, y1 - 1.4, zs + H - 1.6, x1 + 0.6, y1 + 0.6, zs + H, "site2");
    ST.roof(S, look, x0, y0, x1, y1, zs + H, site);
  }
  out.item = main;
  // --- the front: the plan's front door, on the street face ---
  // (a stadium's on its front flat, a ship's gangway on the straight of its hull)
  const fe = X.ent("front"), lay = site.lay;
  let fx = 0;
  if (fe && fe.level && lay) fx = site.toWorld(fe.level, fe.x, fe.y)[0];
  const [flo, fhi] = shipOut ? [shipOut.geo.stern + 3, shipOut.geo.bow - 3]
    : stad ? (stad.L > 2.8 ? [stad.cx - stad.L + 2.8, stad.cx + stad.L - 2.8] : [stad.cx, stad.cx]) : [x0 + 4, x1 - 4];
  fx = Math.max(flo, Math.min(fhi, fx));
  if (shipOut) {
    S.box(fx - 2, shipOut.gang.yS, zs, fx + 2, 0.6, zs + 0.7, "wood", f => f.top(fx - 1.6, shipOut.gang.yS, fx + 1.6, 0.6, "st-d:stripe"), { shadow: false });
    out.taken.push({ kind: "front", face: "front", u0: fx - 2, u1: fx + 2, z0: zs - 2, z1: zs + 4, tip: [fx, 0.2, zs], marks: gridGround(fx - 1.6, shipOut.gang.yS, fx + 1.6, 0.6, zs + 0.7) });
  } else {
    const f = S.faces(main), canopy = !site.open && (look.win === "slit" || look.win === "grid");
    f.front(fx - 2.8, fx + 2.8, zs, zs + 8.6, "st-d:door-site");
    f.front(fx - 0.12, fx + 0.12, zs, zs + 8.6, "st-d:frame");
    if (canopy) S.box(fx - 5, 0, zs + 9.2, fx + 5, 4.5, zs + 10.2, "site2");      // a canopy
    out.taken.push({ kind: "front", face: "front", u0: fx - (canopy ? 5 : 2.8), u1: fx + (canopy ? 5 : 2.8), z0: zs, z1: zs + (canopy ? 10.2 : 8.6), tip: [fx, 0.2, zs], marks: gridOn([0, 0], [1, 0], [0, 1], fx - 2.6, fx + 2.6, zs + 0.3, zs + 8.3) });
  }
  if (fe && fe.vec) out.entries.push({ kind: "front", vec: fe.vec, level: { z: zs }, x: fx, y: 0.2, dir: [0, 1] });
  Object.assign(out, { main, look, shipOut, stad });
  return out;
};

// The service side and (GM only) the back route: where the plan landed them,
// drawn as what gets you there. Neither rolls a die, and only the service side
// keeps the street's props clear of it, so the back route changes nothing in
// the player copy.
ST.waysIn = function (S, site, F, zs, siteOut, X, lots) {
  const occ = lots.map(l => l && l.item).filter(it => it && it.b).map(it => ({ b: it.b, poly: ST.hull([0, 1].flatMap(i => [0, 1].flatMap(j => [0, 1].map(k => S.V.proj(it.b[i * 3], it.b[1 + j * 3], it.b[2 + k * 3]))))) }));
  const se = X.ent("service");
  if (se && se.vec) siteOut.entries.push(ST.wayIn(S, site, F, zs, siteOut, se, X, occ, siteOut.blocks));
  const be = X.ent("back");
  if (be && be.vec && X.gm) siteOut.entries.push(ST.wayIn(S, site, F, zs, siteOut, be, X, occ, null));
};
// Is (x, y, z) behind one of these buildings, as the street sees it?
ST.occluded = function (V, occ, x, y, z) {
  const [px, py] = V.proj(x, y, z);
  return occ.some(o => {
    if (V.flip ? o.b[3] > x + 0.01 : o.b[0] < x - 0.01) return false;       // only what stands between it and the viewer
    let inside = false;
    for (let i = 0, j = o.poly.length - 1; i < o.poly.length; j = i++) {
      const [xi, yi] = o.poly[i], [xj, yj] = o.poly[j];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
};

// A way in, as the building views land it (L.entries): its floor, its wall and
// what gets you there. A door, a secret door or a window in the wall; a fire
// escape, a balcony, a catwalk or an outside spiral stair up to a door off the
// street; area steps down to a basement door; a roof hatch or a skylight from
// above; a hatch in the ground for a way up from below. Only the walls the
// street sees get the drawing; a way on a far wall still gets its arrow.
//
// [interpretation] Two ways in never share a spot on the street. A later way (the
// service side after the front, the back route after both) keeps its door, window
// or stair off an earlier one's and its arrow's tip TIP_GAP feet from theirs on the
// page, sliding along its own wall as far as it must (never off the wall, never
// round a corner); where it can't, its arrow comes in at an angle. The back route
// only ever moves itself, so the player copy never depends on it.
const REACH = { "fire-escape": 4.2, "area-steps": 4.2, "cellar-steps": 4.2, balcony: 3.4, catwalk: 13.5, "spiral-stair": 6 };
const TIP_GAP = 8, SLIDE = 16, FAN = 0.6;
ST.wayIn = function (S, site, F, zs, siteOut, e, X, occ, blocks) {
  const { V } = S, { main, look, shipOut, stad } = siteOut, lay = site.lay, H = site.H, x0 = F.site.x0, x1 = F.site.x1, y0 = -site.D, y1 = 0;
  const side = X.sideOf(e), lvl = e.level && e.level.lvl != null ? e.level.lvl : 0, means = e.means || "door";
  const way = { kind: e.kind, vec: e.vec };
  const dir = e.dir || [0, 0], reach = e.from ? 0 : REACH[means] || 0;
  // the door: the arrow's tip, less what stands outside the wall
  let [wx, wy] = e.level && lay ? site.toWorld(e.level, e.x - dir[0] * reach, e.y - dir[1] * reach) : [x1, -site.D / 2];
  wx = Math.max(x0 + 3, Math.min(x1 - 3, wx)); wy = Math.max(y0 + 3, Math.min(y1 - 3, wy));
  const taken = siteOut.taken;
  const block = (x, y, r) => { if (blocks) blocks.push([x, y, r]); };
  const tips = taken.filter(t => t.tip);
  const gapTo = pt => tips.reduce((m, t) => Math.min(m, ST.scrDist(V, pt, t.tip)), Infinity);
  // an arrow turned off its wall's normal n, along the wall's tangent t, away from the nearest tip
  const fanned = (n, t, tip) => {
    const q = tips.slice().sort((a, b) => ST.scrDist(V, tip, a.tip) - ST.scrDist(V, tip, b.tip))[0];
    if (!q) return n;
    const s = (tip[0] - q.tip[0]) * t[0] + (tip[1] - q.tip[1]) * t[1] >= 0 ? 1 : -1, c = Math.cos(FAN), sn = Math.sin(FAN);
    return [n[0] * c + t[0] * s * sn, n[1] * c + t[1] * s * sn];
  };
  const done = (o, foot) => { taken.push(Object.assign({ kind: e.kind, tip: [o.x, o.y, o.level.z] }, foot || {})); return o; };
  // --- from above: a skylight, or a roof hatch ---
  if (e.from === "above") {
    const [rx, ry, rz] = ST.roofSpot(S, site, F, zs, wx, wy, look, shipOut, occ, stad, tips);
    (site.clutter = site.clutter || []).push([rx - 3, ry - 3, rx + 3, ry + 3]);       // a later way keeps off it
    if (means === "skylight") { S.box(rx - 3, ry - 3, rz, rx + 3, ry + 3, rz + 1.4, "glass", null, { shadow: false }); return done(Object.assign(way, { level: { z: rz + 1.4 }, x: rx, y: ry, dir: [0, 0], from: "above" }), { face: "roof" }); }
    ST.roofHatch(S, rx, ry, rz);
    return done(Object.assign(way, { level: { z: rz + 1.1 }, x: rx, y: ry, dir: [0, 0], from: "above" }), { face: "roof" });
  }
  // the street sees the front and one side (the east, or the west from the south-west)
  const seen = V.flip ? "west" : "east";
  // --- from below: a hatch where the ground meets the nearer seen wall (a ship's, on the quay) ---
  if (e.from === "below") {
    const sg = V.flip ? -1 : 1, g = shipOut ? shipOut.geo : null;
    const toSide = !g && (V.flip ? wx - x0 : x1 - wx) < y1 - wy;
    const [lo, hi] = toSide ? (stad ? stad.span(seen) : [y0 + 3, y1 - 3]) : g ? [g.stern + 2, g.bow - 2] : [x0 + 2, x1 - 2];
    const at = v => toSide ? [(stad ? stad.at(seen, v).p[0] : V.flip ? x0 : x1) + sg * 2.6, v, zs] : [v, y1 + 2.6, zs];
    const u0 = Math.max(lo, Math.min(hi, toSide ? wy : wx));
    let u = u0;
    for (let s = 1; s <= SLIDE && gapTo(at(u)) < TIP_GAP; s++) { const c = [u0 + s, u0 - s].find(v => v >= lo && v <= hi && gapTo(at(v)) >= TIP_GAP); if (c != null) u = c; }
    const [hx, hy] = at(u);
    // E3: a way from what lies under the street (outdoors.js) comes up where that is reached
    // from: a manhole for a sewer, a grating for a culvert, steps for a canal or an underpass
    if (e.via === "sewer") { S.decal(P.circle("st-g:hatch", hx, hy, 1.7), zs); for (const d of [-0.8, 0, 0.8]) S.decal(P.rect("st-g:grate-bar", hx - 1.2, hy + d - 0.08, 2.4, 0.16), zs); }
    else if (e.via === "culvert") { S.decal(P.rect("st-g:hatch", hx - 1.6, hy - 1.6, 3.2, 3.2), zs); for (let d = -1.2; d <= 1.25; d += 0.6) S.decal(P.rect("st-g:grate-bar", hx + d - 0.08, hy - 1.5, 0.16, 3), zs); }
    else if (e.via === "canal" || e.via === "underpass") { S.decal(P.rect("st-g:hatch", hx - 1.6, hy - 1.6, 3.2, 3.2), zs); for (let d = -1.2; d <= 1.25; d += 0.8) S.decal(P.rect("st-g:step", hx - 1.5, hy + d - 0.15, 3, 0.3), zs); }
    else S.decal(P.rect("st-g:hatch", hx - 1.6, hy - 1.6, 3.2, 3.2), zs);
    if (e.via && M.own(M.outdoors.BELOW, e.via)) way.note = "FROM THE " + M.own(M.outdoors.BELOW, e.via).title.toUpperCase();
    block(hx, hy, 3);
    const d = gapTo(at(u)) < TIP_GAP ? fanned(toSide ? [sg, 0] : [0, 1], toSide ? [0, 1] : [1, 0], at(u)) : toSide ? [sg, 0] : [0, 1];
    // its arrow stops at the hatch's edge, so the hatch shows whole
    return done(Object.assign(way, { level: { z: zs }, x: hx + d[0] * 2, y: hy + d[1] * 2, dir: d, normal: toSide ? [sg, 0] : [0, 1] }), { face: "below", marks: gridGround(hx - 1.5, hy - 1.5, hx + 1.5, hy + 1.5, zs) });
  }
  // --- a ship: boarded from the quay, at its bow or its stern ---
  if (shipOut) return ST.shipWay(S, site, F, zs, siteOut, e, { way, side, lvl, means, wx, wy, gapTo, fanned, done, block, seen, gm: X.gm });
  // --- in the wall ---
  // a Futurist stadium: a way on an end stays near the end's nose, one on the front near its flat
  const round = !!stad, flat = side === "front" || side === "back";
  const shows = side === "front" || side === seen;
  const sg = side === "east" ? 1 : side === "west" ? -1 : 0;
  // a door on a floor off the street; one on a roof terrace is the roof's edge
  const zFloor = lvl <= 0 ? zs : zs + GF + STOREY * (lvl - 1), atRoof = zFloor > zs + H - 7.6, zDoor = Math.min(zFloor, zs + H);
  const zb = Math.max(zs + GF, zDoor);
  const gap = side === "east" ? (F.nb2 ? F.nb2.x0 : F.useLot.x0) - x1 : side === "west" ? x0 - (F.nb1 ? F.nb1.x1 : F.descLot.x1) : 12;
  const area = means === "area-steps" || means === "cellar-steps";
  const L = Math.max(4, Math.min(16, gap)), out = side === "front" ? 3.3 : Math.max(2.4, Math.min(3.3, gap - 2.2));
  // the face as a frame: where u along it stands (x on the front and back, y on a side), its outward normal and its tangent
  const RECT = { front: u => ({ p: [u, y1], n: [0, 1], t: [1, 0] }), back: u => ({ p: [u, y0], n: [0, -1], t: [1, 0] }), east: u => ({ p: [x1, u], n: [1, 0], t: [0, 1] }), west: u => ({ p: [x0, u], n: [-1, 0], t: [0, 1] }) };
  const frameAt = u => round ? stad.at(side, u) : RECT[side](u);
  const [lo, hi] = (() => { const [a, b] = flat ? [x0 + 3, x1 - 3] : [y0 + 3, y1 - 3]; if (!round) return [a, b]; const [c, d] = stad.span(side); return [Math.max(a, c), Math.min(b, d)]; })();
  const u0 = Math.max(lo, Math.min(hi, flat ? wx : wy));
  // what the way stands on, along the face and up it
  const runAt = u => side === "front" ? (u > (x0 + x1) / 2 ? -1 : 1) : ((side === "back" ? wy : u) + 12 <= y1 - 1 ? 1 : -1);
  const footAt = u => {
    const w = (a, b, za, zc) => ({ u0: Math.min(a, b), u1: Math.max(a, b), z0: za, z1: zc });
    switch (means) {
      case "fire-escape": { const r = runAt(u); return w(Math.min(u - 4, u + r * 11.7), Math.max(u + 4, u + r * 11.7), zs, zDoor + 7.6); }
      case "area-steps": case "cellar-steps": return flat ? w(u - 5, u + 5, zs - 11, zs + 2) : w(u - 7, u + 3, zs - 11, zs + 2);
      case "balcony": return w(u - 5, u + 5, zb, zb + 7.6);
      case "catwalk": return w(u - 1.8, u + 1.8, zDoor - 0.6, zDoor + 7.6);
      case "spiral-stair": return w(u - 2.6, u + 2.6, zs, zDoor + 7.6);
      case "window": return w(u - 2.1, u + 2.1, zDoor + 2.6, zDoor + 7);
      default: return w(u - 1.8, u + 1.8, zDoor, zDoor + 7.6);
    }
  };
  const clearOf = u => { const f = footAt(u); return taken.every(t => t.face !== side || t.u0 == null || f.u1 + 1 <= t.u0 || t.u1 + 1 <= f.u0 || f.z1 <= t.z0 || t.z1 <= f.z0); };
  // where its arrow lands: out from the wall by d, at z
  const AIM = { "fire-escape": [3.8, zDoor], "area-steps": [2.4, zs], "cellar-steps": [2.4, zs], balcony: [4, zb], catwalk: [L * 0.6, zDoor], "spiral-stair": [out + 2.4, zDoor], window: [0.3, zDoor + 3] }[means] || [0.3, zDoor];
  const tipAt = u => { const f = frameAt(u); return [f.p[0] + f.n[0] * AIM[0], f.p[1] + f.n[1] * AIM[0], AIM[1]]; };
  // A way on the side the street can't see, or behind a taller building on the
  // side it can, is marked where its passage meets the street, pointing in.
  const unseen = (side === "east" || side === "west") && side !== seen;
  const hiddenAt = u => !round && side === seen && ST.occluded(V, occ, frameAt(u).p[0] + sg * 0.3, u, (area ? zs : zDoor) + 2);
  const mouth = !round && (unseen || hiddenAt(u0));
  let u = u0, fan = false;
  if (!mouth && !(clearOf(u0) && gapTo(tipAt(u0)) >= TIP_GAP)) {
    let best = null;
    for (let s = 1; s <= SLIDE && best == null; s++) for (const v of [u0 + s, u0 - s]) if (v >= lo && v <= hi && clearOf(v) && gapTo(tipAt(v)) >= TIP_GAP && !hiddenAt(v)) { best = v; break; }
    if (best != null) u = best; else fan = gapTo(tipAt(u0)) < TIP_GAP;
  }
  if (flat) wx = u; else wy = u;
  const fr = frameAt(u), xs = fr.p[0];
  // a stadium's end curves: what runs along it follows it
  const wallX = round && sg ? y => stad.at(side, Math.max(stad.cy - stad.r + 0.01, Math.min(stad.cy + stad.r - 0.01, y))).p[0] : null;
  const onWall = (half, za, zc, role) => {
    if (!shows || zc > zs + H + 0.01) return;
    main.pcs.push(P.poly(role, [[-half, za], [half, za], [half, zc], [-half, zc]].map(([a, z]) => S.P0(fr.p[0] + fr.t[0] * a + fr.n[0] * 0.02, fr.p[1] + fr.t[1] * a + fr.n[1] * 0.02, z)), { way: true }));
  };
  const door = role => { if (!atRoof) onWall(1.8, zDoor, zDoor + 7.6, role); };
  switch (means) {
    case "fire-escape": {
      // the flight runs down toward the street, or toward the back if the street is too near
      const run = runAt(u);
      if (shows) { door("st-d:door"); ST.fireEscape(S, side, xs, wx, wy, zs, zDoor, run, wallX); }
      if (side === "front") block(wx + run * 4, 2, 7); else if (side === seen) block(xs + sg * 2, wy + run * 6, 7);
      break;
    }
    case "area-steps": case "cellar-steps":
      if (shows) ST.area(S, side, xs, wx, wy, zs);
      if (side === "front") block(wx, 2.5, 6); else if (side === seen) block(xs + sg * 2.4, wy - 2, 6);
      break;
    case "balcony":
      if (shows) { door("st-d:door"); ST.balcony(S, side, xs, wx, wy, zb); }
      break;
    case "catwalk": {
      // across the passage to the next building, on legs where that is lower
      const next = side === "east" ? F.nb2 : side === "west" ? F.nb1 : null;
      const legs = !next || ST.nbTop(next) < zDoor - zs - 1 || wy < next.y0 - next.d + 1.5;
      if (shows) { door("st-d:door"); ST.catwalk(S, side, xs, wx, wy, zs, zDoor, L, legs); }
      if (side === seen) block(xs + sg * L / 2, wy, 3);
      break;
    }
    case "spiral-stair":
      if (shows) { door("st-d:door"); ST.spiral(S, side, xs, wx, wy, zs, zDoor, out); }
      if (side === "front") block(wx, out, 4); else if (side === seen) block(xs + sg * out, wy, 4);
      break;
    case "window":
      if (shows) { onWall(1.6, zDoor + 3, zDoor + 7, "st-d:win"); onWall(2.1, zDoor + 2.6, zDoor + 3, "st-d:frame"); }
      break;
    case "secret-door":
      // a secret door is known only to those who paid for it: the player copy marks the
      // service side's spot with its arrow alone, never the glyph (the GM copy keeps it)
      if (shows && X.gm) door("st-d:secret");
      break;
    default:
      if (shows) door("st-d:door");
  }
  // what the obstacle keeps in sight of: the arrow's tip, and the door, steps or stair it points at
  const fp = footAt(u), onFace = (ua, ub, za, zc) => gridOn(fr.p, fr.t, fr.n, ua - u, ub - u, za, zc);
  const marks = [tipAt(u)].concat(
    area ? (flat ? gridGround(wx - 4.6, y1 + 0.3, wx + 4.6, y1 + 4.2, zs) : gridGround(xs + (sg > 0 ? 0.3 : -4.2), wy - 6.6, xs + (sg > 0 ? 4.2 : -0.3), wy + 2.6, zs))
    : means === "window" ? onFace(u - 1.6, u + 1.6, zDoor + 3, zDoor + 7)
    : means === "balcony" ? onFace(u - 4.6, u + 4.6, zb, zb + 3.6)
    : means === "fire-escape" || means === "spiral-stair" ? onFace(fp.u0 + 0.5, fp.u1 - 0.5, zs + 1, zDoor + 7)
    : atRoof ? [] : onFace(u - 1.6, u + 1.6, zDoor + 0.3, zDoor + 7.3));
  if (mouth) {
    // its arrow at the passage's mouth (a second way at the same mouth comes in beside the first)
    block(xs + sg * gap / 2, 0, 3);
    const mz = AIM[1], cand = [0, gap / 4, -gap / 4].map(o => [xs + sg * (gap / 2 + o), y1 + 1, mz]);
    const pt = cand.find(c => gapTo(c) >= TIP_GAP) || cand[0];
    const d = gapTo(pt) < TIP_GAP ? fanned([0, 1], [1, 0], pt) : [0, 1];
    return done(Object.assign(way, { x: pt[0], y: pt[1], dir: d, normal: [0, 1], passage: true, level: { z: mz } }), Object.assign({ face: side, marks: [pt] }, footAt(u)));
  }
  const tip = tipAt(u);
  if (side === "back") way.note = ST.rearNote(means, X.gm || e.kind !== "service");
  return done(Object.assign(way, { x: tip[0], y: tip[1], dir: fan ? fanned(fr.n, fr.t, tip) : [fr.n[0], fr.n[1]], normal: [fr.n[0], fr.n[1]], level: { z: AIM[1] } }), Object.assign({ face: side, marks }, footAt(u)));
};
// [interpretation] The street can't see the rear wall, so a way in there can't show its
// door, window or stair. Its tag says what it is instead, under the way's name: "FIRE
// ESCAPE, AT THE BACK". A secret door the crew hasn't paid for (the player copy's service
// side) is only "AT THE BACK", as it is only a marker on a wall the street sees.
const REAR_WORDS = { door: "DOOR", "secret-door": "SECRET DOOR", window: "WINDOW", "fire-escape": "FIRE ESCAPE", "area-steps": "AREA STEPS", "cellar-steps": "CELLAR STEPS",
  balcony: "BALCONY", catwalk: "CATWALK", "spiral-stair": "SPIRAL STAIR" };
ST.rearNote = (means, known) => (means === "secret-door" && !known) || !REAR_WORDS[means] ? "AT THE BACK" : REAR_WORDS[means] + ", AT THE BACK";

// A ship's way in (the Nightbreaker, p.402). A ship is boarded: a way on the side the
// quay sees comes across from the quay to a door or window in the hull's side (a stair
// stands on the side deck, a catwalk reaches the deck it names from the quay); one on
// the bow or the stern lands at its tip (a stair on the foredeck or the afterdeck, a
// catwalk from the land past the basin's end, on legs on the land); one on the far side
// is only an arrow over the water. Nothing stands in the water. [interpretation]
ST.shipWay = function (S, site, F, zs, siteOut, e, c) {
  const { V } = S, g = siteOut.shipOut.geo, { way, side, lvl, means, gapTo, fanned, done, block } = c;
  const deckOf = l => g.decks[Math.max(0, Math.min(g.decks.length - 1, l))];
  const floorZ = l => l >= 0 ? g.deck + 8 * l : g.deck;
  const hull = siteOut.shipOut.hull;
  const quad = (it, p, t, n, ua, ub, za, zc, role) => it.pcs.push(P.poly(role, [[ua, za], [ub, za], [ub, zc], [ua, zc]].map(([a, z]) => S.P0(p[0] + t[0] * a + n[0] * 0.03, p[1] + t[1] * a + n[1] * 0.03, z)), { way: true }));
  // a door, secret door or window in the hull's side, above the waterline
  const hullOpening = (p, t, n) => {
    if (means === "window") { quad(hull, p, t, n, -1.6, 1.6, zs + 0.7, zs + 3.1, "st-d:win"); quad(hull, p, t, n, -2.1, 2.1, zs + 0.3, zs + 0.7, "st-d:frame"); return zs + 1.8; }
    // (a secret door, as on a wall: the glyph in the GM copy only)
    if (means !== "secret-door" || c.gm) quad(hull, p, t, n, -1.8, 1.8, zs + 0.1, zs + 3.7, means === "secret-door" ? "st-d:secret" : "st-d:door");
    return zs + 0.6;
  };
  if (side === "front") {
    const lo = g.stern + 3, hi = g.bow - 3, u0 = Math.max(lo, Math.min(hi, c.wx));
    const side2 = g.yS - g.side / 2;           // the side deck, between the hull's side and the deckhouse
    const AIMZ = { "spiral-stair": g.deck + 3, catwalk: floorZ(Math.max(1, lvl)) }[means];
    const tipAt = u => [u, means === "catwalk" ? 3 : 0.3, AIMZ != null ? AIMZ : means === "window" ? zs + 1.5 : zs + 0.6];
    const foot = u => ({ u0: u - 2.6, u1: u + 2.6 });
    const clearOf = u => siteOut.taken.every(t => t.face !== "front" || t.u0 == null || foot(u).u1 + 1 <= t.u0 || t.u1 + 1 <= foot(u).u0);
    let u = u0;
    if (!(clearOf(u0) && gapTo(tipAt(u0)) >= TIP_GAP)) for (let s = 1; s <= SLIDE; s++) { const v = [u0 + s, u0 - s].find(q => q >= lo && q <= hi && clearOf(q) && gapTo(tipAt(q)) >= TIP_GAP); if (v != null) { u = v; break; } }
    let z = tipAt(u)[2];
    if (means === "spiral-stair") { ST.spiral(S, "front", u, u, side2, g.deck, floorZ(Math.max(1, lvl)), side2); block(u, 1.5, 3); }
    else if (means === "catwalk") { const dk = deckOf(Math.max(1, lvl)); ST.catwalk(S, "front", u, u, side2, zs, floorZ(Math.max(1, lvl)), 6, true, { from: dk ? dk.dy1 : g.yS }); block(u, 3, 3); }
    else hullOpening([u, g.yS], [1, 0], [0, 1]);
    const tip = [u, tipAt(u)[1], z], d = gapTo(tip) < TIP_GAP ? fanned([0, 1], [1, 0], tip) : [0, 1];
    return done(Object.assign(way, { x: tip[0], y: tip[1], dir: d, normal: [0, 1], level: { z } }), { face: "front", u0: u - 2.6, u1: u + 2.6, z0: zs - 2, z1: g.deck + 8, marks: [tip] });
  }
  if (side === "east" || side === "west") {
    const sg = side === "east" ? 1 : -1, tx = sg > 0 ? g.x1 : g.x0;
    let z, ax = tx + sg * (means === "catwalk" ? 1.5 : 0.3);
    if (means === "spiral-stair") {
      // on the foredeck (the afterdeck), up to the deck above; its arrow comes in over the tip,
      // up at the stair's top half, so it is clear of a way through the hull's side below it
      ST.spiral(S, side, tx - sg * 4.8, tx, g.cy, g.deck, floorZ(Math.max(1, lvl)), 0);
      z = floorZ(Math.max(1, lvl)) - 2;
    } else if (means === "catwalk") {
      // from the land past the basin's end onto the bow (the stern), on legs on the land
      const xa = tx - sg * 2, land = sg > 0 ? g.bx1 + 3.5 : g.bx0 - 3.5, Lc = Math.abs(land - xa);
      ST.catwalk(S, side, sg > 0 ? xa : xa, tx, g.cy, zs, g.deck + 0.6, Lc, true);
      block(land, g.cy, 3);
      z = g.deck + 0.6;
    } else {
      // in the hull's side, just behind the tip, on the side the quay sees
      let p, t, n;
      if (sg > 0) { const v = [g.bow - g.x1, g.yS - g.cy], l = Math.hypot(v[0], v[1]); t = [v[0] / l, v[1] / l]; n = [-t[1], t[0]]; if (n[1] < 0) n = [t[1], -t[0]]; p = [g.x1 + t[0] * 3.4, g.cy + t[1] * 3.4]; }
      else { const a = Math.PI - 0.32; p = [g.stern + Math.cos(a) * g.r, g.cy + Math.sin(a) * g.r]; n = [Math.cos(a), Math.sin(a)]; t = [-Math.sin(a), Math.cos(a)]; }
      z = hullOpening(p, t, n);
    }
    const tip = [ax, g.cy, z], d = gapTo(tip) < TIP_GAP ? fanned([sg, 0], [0, 1], tip) : [sg, 0];
    return done(Object.assign(way, { x: tip[0], y: tip[1], dir: d, normal: [sg, 0], level: { z } }), { face: side, marks: [tip] });
  }
  // the far side: the street can't see it
  const tip = [Math.max(g.stern, Math.min(g.bow, c.wx)), -site.D - 0.3, floorZ(lvl)];
  way.note = ST.rearNote(means, c.gm || way.kind !== "service");
  return done(Object.assign(way, { x: tip[0], y: tip[1], dir: [0, -1], normal: [0, -1], level: { z: tip[2] } }), { face: "back" });
};

// Where a way from above comes through the roof: on the flat, on a pitched
// roof's slope, clear of a Futurist dome, on a ship's top deck.
// If a taller building next door hides that spot, the nearest one it doesn't;
// and the nearest one clear of another way's arrow.
ST.roofSpot = function (S, site, F, zs, wx, wy, look, shipOut, occ, stad, tips) {
  const far = (x, y, z) => !tips || tips.every(t => ST.scrDist(S.V, [x, y, z], t.tip) >= TIP_GAP);
  if (shipOut && shipOut.top) {
    const b = shipOut.top.b, at = [Math.max(b[0] + 2.5, Math.min(b[3] - 2.5, wx)), Math.max(b[1] + 2.5, Math.min(b[4] - 2.5, wy)), b[5]];
    if (far(...at)) return at;
    let best = null;
    for (let x = b[0] + 2.5; x <= b[3] - 2.5; x += 2) for (let y = b[1] + 2.5; y <= b[4] - 2.5; y += 2) { const dd = Math.hypot(x - at[0], y - at[1]); if ((!best || dd < best[2]) && far(x, y, b[5])) best = [x, y, dd]; }
    return best ? [best[0], best[1], b[5]] : at;
  }
  const z = zs + (site.open ? site.deckZ : site.H), y0 = -site.D, y1 = 0, x0 = F.site.x0, x1 = F.site.x1;
  const round = !!stad, dr = round ? Math.min(stad.r * 0.8, 18) + 3 : 0;
  const pitch = look.roof === "pitch" && !site.roofDeck && !site.open, d = y1 - y0, cy = (y0 + y1) / 2, rise = Math.min(16, d * 0.32);
  const zAt = (x, y) => pitch ? z + rise * Math.max(0, 1 - Math.abs(y - cy) / (d / 2)) : z;
  // a Futurist dome: just outside it, on the stadium's roof
  if (round && Math.hypot(wx - stad.cx, wy - stad.cy) < dr) { const a = Math.hypot(wx - stad.cx, wy - stad.cy) > 0.1 ? Math.atan2(wy - stad.cy, wx - stad.cx) : 0; wx = stad.cx + Math.cos(a) * dr; wy = stad.cy + Math.sin(a) * dr; }
  // seen whole (the hatch's corners and a little round it), clear of what stands on the roof, and on it
  const clear = (x, y) => !(site.clutter || []).some(([a, b, c, e]) => x + 3.5 > a && x - 3.5 < c && y + 3.5 > b && y - 3.5 < e) && (!round || (stad.inside(x, y, 3.5) && Math.hypot(x - stad.cx, y - stad.cy) >= dr - 0.01));
  const seen = (x, y) => clear(x, y) && far(x, y, zAt(x, y) + 1.2) && (!occ || !occ.length || [[-3, -3], [3, -3], [3, 3], [-3, 3]].every(([u, v]) => !ST.occluded(S.V, occ, x + u, y + v, zAt(x + u, y + v) + 1.2)));
  if (seen(wx, wy)) return [wx, wy, zAt(wx, wy)];
  let best = null;
  for (let x = x0 + 3; x <= x1 - 3; x += 2) for (let y = y0 + 3; y <= y1 - 3; y += 2) {
    const dd = Math.hypot(x - wx, y - wy);
    if ((!best || dd < best[2]) && seen(x, y)) best = [x, y, dd];
  }
  return best ? [best[0], best[1], zAt(best[0], best[1])] : [wx, wy, zAt(wx, wy)];
};
// The height a neighbour stands to, from its kind (as ST.neighbour builds it).
ST.nbTop = function (L) {
  const sp = L.spec;
  if (L.cut) return GF - 1;
  return { garage: 15, warehouse: 28, boathouse: 16, substation: 14, diner: 14 }[sp.k] || GF + STOREY * (sp.st - 1);
};

// Windows, storey by storey, on the front and the side that shows.
ST.windows = function (S, f, look, storeys, o = {}) {
  const night = S.night, rng = S.rng, x0 = f.x0, x1 = f.x1, y0 = f.y0, y1 = f.y1, z0 = f.z0;
  const LK = o.looks && o.looks.any ? o.looks : null, lr = S.looksRng || rng;
  const litP = LK && LK.litP != null ? LK.litP : o.litP != null ? o.litP : 0.34;
  const lit = () => night && rng() < litP;
  for (let s = 0; s < storeys; s++) {
    const zb = z0 + (s === 0 ? 0 : GF + STOREY * (s - 1)), zh = s === 0 ? GF : STOREY;
    if (s === 0 && o.groundFloor === false) continue;
    const winA = zb + (s === 0 ? 3.4 : 2.8), winB = zb + zh - (s === 0 ? 2.6 : 2.2);
    const across = (a, b, put) => {
      if (look.win === "band") { put(a + 1.2, b - 1.2, winA - 0.6, winB + 0.4, lit() ? "st-d:winlit" : "st-d:glass"); for (let u = a + 6; u < b - 2; u += 6) put(u - 0.1, u + 0.1, winA - 0.6, winB + 0.4, "st-d:frame"); return; }
      const pitch = look.win === "slit" ? 6 : look.win === "grid" ? 6.4 : look.win === "tall" ? 8 : look.win === "round" ? 9 : 7.5;
      const ww = look.win === "slit" ? 1.5 : look.win === "grid" ? 4.6 : look.win === "tall" ? 3.6 : 4.2;
      const n = Math.max(1, Math.floor((b - a - 3) / pitch)), start = (a + b) / 2 - (n - 1) * pitch / 2;
      for (let i = 0; i < n; i++) {
        const c = start + i * pitch;
        if (o.skip && o.skip(c, s)) continue;
        let wa = ww, za = winA, zb2 = winB;
        if (look.win === "odd") { wa = 2.6 + rng() * 3.2; za = winA + rng() * 1.4; zb2 = winB - rng() * 1.6; }
        if (look.win === "tall") zb2 = Math.min(zb + zh - 1.2, winB + 1.2);
        if (LK && LK.tall) { const mid = (za + zb2) / 2, hh = Math.min((zb2 - za) * LK.tall, zh - 1.6) / 2; za = Math.max(zb + 0.8, mid - hh); zb2 = Math.min(zb + zh - 0.8, mid + hh); }
        const role = lit() ? "st-d:winlit" : "st-d:win";
        // boarded or barred: wide enough to read at map scale, even over a slit window
        if (LK && ((LK.boardGround && s === 0) || (LK.board && lr() < LK.board))) { const bw = Math.max(wa, 2.8) / 2 + 0.3; put(c - bw, c + bw, za - 0.3, zb2 + 0.3, "st-d:boards"); for (let zz = za + 0.7; zz < zb2 - 0.2; zz += 1.2) put(c - bw, c + bw, zz, zz + 0.28, "st-d:boardline"); continue; }
        put(c - wa / 2, c + wa / 2, za, zb2, role);
        if (LK && LK.grille && s === 0) { const gw = Math.max(wa, 2.8) / 2 + 0.25; put(c - gw, c + gw, za - 0.25, za + 0.15, "st-d:grille"); put(c - gw, c + gw, zb2 - 0.15, zb2 + 0.25, "st-d:grille"); for (let u = c - gw + 0.35; u < c + gw - 0.1; u += 0.75) put(u - 0.15, u + 0.15, za, zb2, "st-d:grille"); }
      }
    };
    if (!(s === 0 && o.shopfront)) across(x0, x1, (a, b, za, zb2, role) => f.front(a, b, za, zb2, role));
    // the site's walls: rival tags on the ground floor, patches anywhere (condition and volume)
    if (LK && LK.graffiti && s === 0) for (let u = x0 + 1.5 + lr() * 3; u < x1 - 7; u += 8 + lr() * 6) { const gz = zb + 0.4 + lr() * 1.2; f.front(u, u + 4.5 + lr() * 3.5, gz, gz + 2.4 + lr() * 1.8, lr() < 0.5 ? "st-d:tag1" : "st-d:tag2"); }
    if (LK && LK.strange && s === 0) f.front(x0, x1, zb, zb + zh * 0.7, "st-d:shimmer");
    if (LK && LK.patch) for (let u = x0 + 3 + lr() * 6; u < x1 - 5; u += 11 + lr() * 10) { const pz = zb + 1 + lr() * Math.max(0.5, zh - 4); f.front(u, u + 2.4 + lr() * 2, pz, pz + 1.6 + lr(), "st-d:patch"); }
    if (o.sideWindows !== false) across(y0, y1, (a, b, za, zb2, role) => f.side(a, b, za, zb2, role));
  }
};

// Alternative: a painted mural across the upper floors (p.430: "painted murals").
ST.mural = function (S, it, x0, x1, y1, zs, H) {
  const f = S.faces(it), cx = x0 + (x1 - x0) * 0.66, cz = zs + H - 3, R = Math.min(10, (x1 - x0) * 0.16);
  for (let r = R; r > 2; r -= R / 3.4) {
    const pts = [];
    for (let a = Math.PI; a <= 2 * Math.PI + 0.001; a += Math.PI / 16) pts.push([cx + Math.cos(a) * r * 1.4, cz + Math.sin(a) * r]);
    f.frontPoly(pts, Math.round(r / (R / 3.4)) % 2 ? "st-d:mural1" : "st-d:mural2");
  }
};

// Roofs by style: Brutalist parapet and tank, Old relic pitch and chimney,
// Corporate chic plant deck, Futurist dome (drawn with the rounded mass).
ST.roof = function (S, look, x0, y0, x1, y1, z, site) {
  const w = x1 - x0, d = y1 - y0;
  if (look.roof === "pitch") {
    S.gable(x0, y0, x1, y1, z, Math.min(16, d * 0.32), "roof", "site");
    S.box(x0 + w * 0.2, y0 + d * 0.3, z, x0 + w * 0.2 + 3.4, y0 + d * 0.3 + 3.4, z + Math.min(16, d * 0.32) + 4, "brick");
    return;
  }
  const pp = look.parapet || 1;
  // what stands on the roof, kept for a hatch or a skylight to stay clear of
  const keep = (a, b, c, d) => { if (site) (site.clutter = site.clutter || []).push([a, b, c, d]); };
  // the parapet: a rim round the roof
  S.box(x0, y1 - 1, z, x1, y1, z + pp, "site2", null, { shadow: false });
  S.box(V0(S) ? x0 : x1 - 1, y0, z, V0(S) ? x0 + 1 : x1, y1 - 1, z + pp, "site2", null, { shadow: false });
  if (site && site.roofDeck) {
    // a roof terrace: its rail and the stair hut
    S.box(x0 + 3, y0 + 3, z, x0 + 11, y0 + 11, z + 8, "site", null); keep(x0 + 3, y0 + 3, x0 + 11, y0 + 11);
    for (let x = x0 + 14; x < x1 - 3; x += 9) { S.cyl(x, y1 - 6, 1.6, z, z + 2.6, "plant"); keep(x - 1.6, y1 - 7.6, x + 1.6, y1 - 4.4); }
    return;
  }
  if (look.roof === "plant") {
    for (let i = 0; i < 3; i++) { S.box(x0 + 6 + i * 9, y0 + 6, z, x0 + 12 + i * 9, y0 + 14, z + 4.5, "metal"); keep(x0 + 6 + i * 9, y0 + 6, x0 + 12 + i * 9, y0 + 14); }
    S.box(x1 - 14, y0 + 4, z, x1 - 4, y0 + 10, z + 6, "concrete"); keep(x1 - 14, y0 + 4, x1 - 4, y0 + 10);
  } else {
    S.cyl(x0 + 9, y0 + 9, 3.2, z, z + 7.5, "metal"); keep(x0 + 5.8, y0 + 5.8, x0 + 12.2, y0 + 12.2);
    S.box(x1 - 10, y0 + 5, z, x1 - 5, y0 + 10, z + 3.5, "concrete"); keep(x1 - 10, y0 + 5, x1 - 5, y0 + 10);
  }
};
const V0 = S => S.V.flip;

// A Futurist stadium's footprint [interpretation]: a flat front on the street line, half-round
// ends at the lot's sides, its radius 0.92 of the lot's half-depth (or half-width). A way on an
// end stays near the end's nose and one on the front near the flat: within `reach` of them its
// door is within half a foot of the face's line, so it reads as on that face.
ST.stadium = function (x0, y0, x1, y1) {
  const w = x1 - x0, d = y1 - y0, r = Math.min(d / 2, w / 2) * 0.92, cx = (x0 + x1) / 2, L = w / 2 - r, cy = y1 - r;
  const reach = Math.acos(Math.min(1, (r - 0.45) / (r + 0.3)));
  const st = { x0, x1, y1, r, cx, cy, L, reach };
  // a point on a face (u: x on the front or back, y on an end): where it stands, its outward normal, its tangent along +u
  st.at = (face, u) => {
    if (face === "front" || face === "back") {
      const s = face === "front" ? 1 : -1, dx = Math.abs(u - cx) - L, sx = u < cx ? -1 : 1;
      if (dx <= 0) return { p: [u, cy + s * r], n: [0, s], t: [1, 0] };
      const a = Math.asin(Math.min(1, dx / r)), c = Math.cos(a), sn = Math.sin(a);
      return { p: [u, cy + s * r * c], n: [sx * sn, s * c], t: [c, -s * sx * sn] };
    }
    const s = face === "east" ? 1 : -1, a = Math.asin(Math.max(-1, Math.min(1, (u - cy) / r))), c = Math.cos(a), sn = Math.sin(a);
    return { p: [cx + s * (L + r * c), u], n: [s * c, sn], t: [-s * sn, c] };
  };
  st.span = face => face === "front" || face === "back" ? [cx - L - r * Math.sin(reach), cx + L + r * Math.sin(reach)] : [cy - r * Math.sin(reach), cy + r * Math.sin(reach)];
  st.inside = (x, y, m = 0) => Math.hypot(Math.max(0, Math.abs(x - cx) - L), y - cy) <= r - m;
  return st;
};

// Futurist: a stadium of glass and white, portholes, a dome. The portholes go round
// the face the street sees, each on the wall where it stands.
// A round window on the site (a Futurist mass, a ship's decks) under its condition and volume:
// lit as often as they say, boarded where they board (one storey = s).
ST.litOf = (S, p) => S.looks && S.looks.any && S.looks.litP != null ? S.looks.litP : p;
ST.porthole = function (S, lit, s) {
  const L = S.looks && S.looks.any ? S.looks : null;
  if (L && ((L.boardGround && s === 0) || (L.board && S.looksRng() < L.board))) return "st-d:boards";
  return lit ? "st-d:winlit" : "st-d:glass";
};
ST.rounded = function (S, st, zs, H, site) {
  const { cx, cy, r, L } = st, pts = [];
  for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + i * Math.PI / 12; pts.push([cx + L + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  for (let i = 0; i <= 12; i++) { const a = Math.PI / 2 + i * Math.PI / 12; pts.push([cx - L + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  const it = S.prism(pts, zs, zs + H, "site");
  const night = S.night, E = S.V.eye, el = Math.hypot(E[0], E[1]), half = Math.PI * r, tot = 2 * half + 2 * L;
  // along the outline: the west end from its back round to the front, the flat, the east end from the front round to its back
  const along = s => {
    if (s < half) { const a = 1.5 * Math.PI - s / r; return { p: [cx - L + Math.cos(a) * r, cy + Math.sin(a) * r], n: [Math.cos(a), Math.sin(a)] }; }
    if (s < half + 2 * L) return { p: [cx - L + (s - half), cy + r], n: [0, 1] };
    const a = Math.PI / 2 - (s - half - 2 * L) / r; return { p: [cx + L + Math.cos(a) * r, cy + Math.sin(a) * r], n: [Math.cos(a), Math.sin(a)] };
  };
  for (let s = 0; s < site.storeys; s++) {
    const zc = zs + (s === 0 ? 6.5 : GF + STOREY * (s - 1) + 5.5);
    for (let u = 4.5; u < tot; u += 9) {
      const { p, n } = along(u);
      if ((n[0] * E[0] + n[1] * E[1]) / el < 0.3) continue;
      const t = [-n[1], n[0]], pp = [];
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) pp.push(S.P0(p[0] + n[0] * 0.05 + t[0] * Math.cos(a) * 2.1, p[1] + n[1] * 0.05 + t[1] * Math.cos(a) * 2.1, zc + Math.sin(a) * 2.1));
      it.pcs.push(P.poly(ST.porthole(S, night && S.rng() < ST.litOf(S, 0.4), s), pp));
    }
  }
  // the dome
  const dr = Math.min(r * 0.8, 18), dz = zs + H;
  const top = []; for (let a = 0; a < Math.PI * 2; a += Math.PI / 14) top.push(S.P0(cx + Math.cos(a) * dr, cy + Math.sin(a) * dr, dz));
  const [dcx, dcy] = S.P0(cx, cy, dz + dr * 0.75);
  const dome = { b: [cx - dr, cy - dr, dz, cx + dr, cy + dr, dz + dr * 0.75], pcs: [P.poly("st-t:glass", top), P.ellipse("st-f:glass", dcx, dcy + dr * 0.42, dr * SIC * 1.0, dr * 0.62), P.ellipse("st-x:shine", dcx - dr * 0.25, dcy + dr * 0.15, dr * 0.3, dr * 0.16)], ground: 0, shadow: false };
  S.add(dome);
  return it;
};

// A ship at its berth (the Nightbreaker, p.402): the hull in the basin along
// the quay, decks stepping up amidships, a funnel. The plan's hull is the
// building's outline; from the street a ship reads by its length, so the hull
// here is long and narrow, stern to the west and bow to the east, as the plan's.
// [interpretation] It is moored close against the quay, and runs the length of
// its lot, so a way on its bow or stern lands at the tip.
ST.ship = function (S, site, F, zs) {
  const L = Math.max(70, F.site.x1 - F.site.x0), Bm = site.beam;
  const x0 = -L / 2, x1 = L / 2, yS = -1.6, yN = yS - Bm, cy = (yS + yN) / 2, r = Bm / 2, zw = zs - 6;
  // the basin, and the quay's edge
  const bx0 = Math.min(F.site.x0, x0) - 3, bx1 = Math.max(F.site.x1, x1) + 3, by0 = yN - 12;
  S.decal(P.rect("st-g:water", bx0, by0, bx1 - bx0, -by0), zw);
  for (let x = bx0 + 4; x < bx1; x += 11) S.decal(P.rect("st-g:ripple", x, by0 + 4 + ((x * 7) % Math.max(4, -by0 - 8)), 3.4, 0.35), zw);
  S.box(bx0, -1.2, zw, bx1, 0, zs, "edge", null, { noTop: true, shadow: false });
  const pts = [[x0 + r, yN], [x1 - Bm * 0.9, yN], [x1, cy], [x1 - Bm * 0.9, yS], [x0 + r, yS]];
  for (let a = Math.PI / 2; a <= Math.PI * 1.5 + 0.001; a += Math.PI / 10) pts.push([x0 + r + Math.cos(a) * r, cy + Math.sin(a) * r]);
  // the hull in two: under the quay's level (the quay hides what of it lies behind), and above
  const low = S.prism(pts, zw - 1, zs, "hull", { noTop: true });
  const hull = S.prism(pts, zs, zs + 4, "hull", { topMat: "deckwood", shadow: false });
  // a waterline stripe on the side the street sees
  low.pcs.push(P.poly("st-d:waterline", [S.P0(x0 + r, yS + 0.02, zw + 1.2), S.P0(x1 - Bm * 0.9, yS + 0.02, zw + 1.2), S.P0(x1 - Bm * 0.9, yS + 0.02, zw + 2.2), S.P0(x0 + r, yS + 0.02, zw + 2.2)]));
  // decks stepping back, portholes, a funnel
  const decks = Math.max(2, site.storeys), deckBoxes = [];
  let dx0 = x0 + L * 0.22, dx1 = x1 - L * 0.3, dy0 = yN + Bm * 0.16, dy1 = yS - Bm * 0.16, z = zs + 4, top = null;
  for (let i = 0; i < decks; i++) {
    const zz = z;
    top = S.box(dx0, dy0, z, dx1, dy1, z + 8, i ? "site" : "site", f => {
      for (let u = dx0 + 3; u < dx1 - 2; u += 5) { const pp = []; for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) pp.push(S.P0(u + Math.cos(a) * 1.1, dy1 + 0.05, zz + 4.4 + Math.sin(a) * 1.1)); f.push(P.poly(ST.porthole(S, S.night && S.rng() < ST.litOf(S, 0.45), i), pp)); }
      f.front(dx0, dx1, zz + 7.2, zz + 8, "st-d:stripe");
    });
    deckBoxes.push({ dx0, dx1, dy0, dy1, z0: zz, z1: zz + 8 });
    z += 8; dx0 += L * 0.05; dx1 -= L * 0.06; dy0 += 1.6; dy1 -= 1.6;
  }
  S.cyl(dx0 + (dx1 - dx0) * 0.6, (dy0 + dy1) / 2, Math.min(3.6, Bm * 0.12), z, z + 11, "site2");
  for (let x = F.site.x0 + 6; x < F.site.x1 - 4; x += 16) S.cyl(x, 1.6, 0.7, zs, zs + 2.2, "dark", { shadow: false });   // bollards
  // the label sits over the whole ship; a way from above comes through the top deck
  const geo = { x0, x1, yS, yN, cy, r, Bm, zw, deck: zs + 4, bow: x1 - Bm * 0.9, stern: x0 + r, side: Bm * 0.16, decks: deckBoxes, bx0, bx1 };
  return { item: { b: [x0, yN, zw - 1, x1, yS, z], pcs: [] }, gang: { yS }, top, hull, geo };
};

// Steps down to a basement door: the area, with its railings.
ST.area = function (S, side, xs, wx, wy, zs) {
  if (side === "front") {
    S.decal(P.rect("st-g:area", wx - 5, 0, 10, 4.5), zs);
    for (let i = 0; i < 6; i++) S.decal(P.rect("st-g:step", wx - 4.4 + i * 1.5, 0.4, 0.4, 3.7), zs);
    return;
  }
  const x0 = side === "east" ? xs : xs - 4.5, w = 4.5;
  S.decal(P.rect("st-g:area", x0, wy - 7, w, 10), zs);
  for (let i = 0; i < 6; i++) S.decal(P.rect("st-g:step", x0 + 0.4, wy - 6.4 + i * 1.5, w - 0.8, 0.4), zs);
};
// Steel stairs up the outside wall to a door off the street: a landing at the
// door, a flight down the wall (run: which way along it, ±1). On a curved wall
// (a stadium's end, wallX: the wall's x at y) each step keeps to the wall.
ST.fireEscape = function (S, side, xs, wx, wy, zs, zDoor, run, wallX) {
  const rise = Math.max(1, zDoor - zs);
  if (side === "front") {
    S.box(wx - 4, 0, zDoor - 0.5, wx + 4, 3.6, zDoor, "metal", f => f.front(wx - 4, wx + 4, zDoor, zDoor + 3.4, "st-x:rail"), { shadow: false });
    for (let z = zs + 2; z < zDoor - 1; z += 2.2) {
      const x = wx + run * (12 - (z - zs) / rise * 15);
      S.box(x - 1, 0, z - 0.3, x + 1, 3.6, z, "metal", null, { shadow: false });
    }
    return;
  }
  const o = side === "east" ? 0 : -3.6, xa = xs + o, xb = xa + 3.6;
  S.box(xa, wy - 4, zDoor - 0.5, xb, wy + 4, zDoor, "metal", f => f.side(wy - 4, wy + 4, zDoor, zDoor + 3.4, "st-x:rail"), { shadow: false });
  for (let z = zs + 2; z < zDoor - 1; z += 2.2) {
    const y = wy + run * (12 - (z - zs) / rise * 15), xw = wallX ? wallX(y) + o : xa;
    S.box(xw, y - 1, z - 0.3, xw + 3.6, y + 1, z, "metal", null, { shadow: false });
  }
};
// A railed balcony outside an upper door.
ST.balcony = function (S, side, xs, wx, wy, zb) {
  if (side === "front") { S.box(wx - 5, 0, zb, wx + 5, 4, zb + 0.8, "concrete", f => f.front(wx - 5, wx + 5, zb + 0.8, zb + 3.6, "st-x:rail"), { shadow: false }); return; }
  const xa = side === "west" ? xs - 4 : xs, xb = side === "west" ? xs : xs + 4;
  S.box(xa, wy - 5, zb, xb, wy + 5, zb + 0.8, "concrete", f => f.side(wy - 5, wy + 5, zb + 0.8, zb + 3.6, "st-x:rail"), { shadow: false });
};
// A catwalk from an upper door across the passage, on legs if what it reaches is lower.
// (o.from: where a front one starts, if not at the wall: a ship's deck.)
ST.catwalk = function (S, side, xs, wx, wy, zs, z, L, legs, o = {}) {
  const leg = (x, y) => S.box(x - 0.25, y - 0.25, zs, x + 0.25, y + 0.25, z - 0.6, "metal", null, { shadow: false });
  if (side === "front") {
    const ya = o.from != null ? o.from : 0;
    S.box(wx - 1.5, ya, z - 0.6, wx + 1.5, L, z, "metal", f => f.side(ya, L, z, z + 3, "st-x:rail"), { shadow: false });
    if (legs) { leg(wx - 1.2, L - 0.5); leg(wx + 1.2, L - 0.5); }
    return;
  }
  const xa = side === "east" ? xs : xs - L, xb = side === "east" ? xs + L : xs;
  S.box(xa, wy - 1.5, z - 0.6, xb, wy + 1.5, z, "metal", f => f.front(xa, xb, z, z + 3, "st-x:rail"), { shadow: false });
  if (legs) { const lx = side === "east" ? xb - 0.5 : xa + 0.5; leg(lx, wy - 1.2); leg(lx, wy + 1.2); }
};
// An outside spiral stair: a pole, wedge treads turning round it up to the door
// (the top one points at it), and a handrail along their outer ends. Drawn back
// to front, so treads in front of the pole cover it and those behind it don't.
ST.spiral = function (S, side, xs, wx, wy, zs, zTop, out) {
  const cx = side === "front" ? wx : xs + (side === "east" ? out : -out), cy = side === "front" ? out : wy, r = 2.2, r0 = 0.3, step = 0.5;
  const n = Math.max(6, Math.round((zTop - zs) / 0.75)), sg = S.V.sideSign;
  const aDoor = { front: -Math.PI / 2, east: Math.PI, west: 0 }[side];
  const end = aDoor != null ? aDoor : Math.PI / 2;
  const at = (a, rr, z) => S.P0(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, z);
  const depth = (x, y, z) => x * sg + y + z, pcs = [];
  let rail = null, zPrev = zs;
  for (let i = 1; i <= n; i++) {
    const z = zs + (zTop - zs) * i / n, a = end - (n - i) * step, a0 = a - step * 0.48, a1 = a + step * 0.48;
    const d = depth(cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6, z);
    pcs.push({ d, p: P.poly("st-f:metal", [at(a0, r, z - 0.25), at(a, r, z - 0.25), at(a1, r, z - 0.25), at(a1, r, z), at(a, r, z), at(a0, r, z)]) });
    pcs.push({ d: d + 0.001, p: P.poly("st-t:metal", [at(a0, r0, z), at(a0, r, z), at(a, r, z), at(a1, r, z), at(a1, r0, z)]) });
    // the pole between this tread and the one below
    pcs.push({ d: depth(cx, cy, (z + zPrev) / 2), p: P.line("st-x:rail", ...S.P0(cx, cy, zPrev), ...S.P0(cx, cy, z), { sw: 0.35 }) });
    // the handrail, 3 ft over the treads' outer ends
    const hr = [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z + 3];
    if (rail) pcs.push({ d: depth((rail[0] + hr[0]) / 2, (rail[1] + hr[1]) / 2, (rail[2] + hr[2]) / 2) + 0.002, p: P.line("st-x:rail", ...S.P0(...rail), ...S.P0(...hr), { sw: 0.22 }) });
    rail = hr; zPrev = z;
  }
  pcs.push({ d: depth(cx, cy, zTop + 1.7), p: P.line("st-x:rail", ...S.P0(cx, cy, zTop), ...S.P0(cx, cy, zTop + 3.4), { sw: 0.35 }) });
  pcs.sort((p, q) => p.d - q.d);
  S.add({ b: [cx - r, cy - r, zs, cx + r, cy + r, zTop + 3.4], pcs: pcs.map(q => q.p), ground: zs, shadow: false });
};
// A roof hatch: a raised curb and its lid.
ST.roofHatch = function (S, x, y, z) {
  S.box(x - 1.4, y - 1.4, z, x + 1.4, y + 1.4, z + 1.1, "metal", f => f.top(x - 1.05, y - 1.05, x + 1.05, y + 1.05, "st-d:frame"), { shadow: false });
};

// =============================================================================
// Grounds
// =============================================================================
// Each lays the street in front of the frontage (y > 0) and says where things
// can stand: the near pavement, the road, its lanes and kerbs, the far side,
// water, where the road leaves the sheet, and the stage for the obstacle.
const strip = (S, x0, x1, y0, y1, role, z = 0) => S.decal(P.rect("st-g:" + role, x0, y0, x1 - x0, y1 - y0), z);
ST.GROUNDS = {};

// The far side of the street: its buildings cut down, as the iso cuts its near walls.
ST.farRow = function (S, x0, x1, y, depth, z, o = {}) {
  const rng = S.rng;
  depth = Math.min(depth, 20);
  let x = x0;
  while (x < x1 - 8) {
    const w = Math.min(x1 - x, 22 + Math.floor(rng() * 26));
    if (o.skip && o.skip(x, x + w)) { x += w; continue; }
    const d = depth - (rng() < 0.3 ? 6 : 0);
    S.box(x, y, z, x + w, y + d, z + 2.4, "far", f => { if (o.shops !== false && rng() < 0.6) f.top(x + 1, y + 0.6, x + w - 1, y + 1.8, "st-d:shop"); }, { topMat: "cut", shadow: false });
    x += w + (rng() < 0.25 ? 7 : 0.8);
  }
};
// Lamp posts, and at Night their pools of light.
ST.lamps = function (S, x0, x1, y, z, step, o = {}) {
  const out = [];
  for (let x = x0 + step / 2; x < x1 - 4; x += step) {
    if (o.skip && o.skip(x)) continue;
    S.box(x - 0.3, y - 0.3, z, x + 0.3, y + 0.3, z + 14, "lamp", null, { shadow: false });
    const [hx, hy] = S.P0(x, y, z + 14.6);
    S.add({ b: [x - 1.4, y - 0.6, z + 13.8, x + 1.4, y + 0.6, z + 15], pcs: [P.rect("st-d:lamphead", hx - 1.3, hy - 0.5, 2.6, 0.9, { rx: 0.3 })].concat(S.night ? [P.circle("st-x:lampglow", hx, hy + 0.2, 1.7)] : []), ground: z, shadow: false });
    if (S.night) for (const [r, role] of [[13, "pool1"], [9, "pool2"], [5.5, "pool3"]]) S.decal(P.ellipse("st-g:" + role, x + (o.towardY || 0), y + (o.towardY || 2.5), r, r * 0.9), z);
    out.push(x);
  }
  return out;
};
// An autopod: a body and a cabin (rot 0 runs along x).
ST.autopod = function (S, x, y, z, along, mat, o = {}) {
  const L = o.L || 11, Wd = o.W || 5.6, h1 = o.tipped ? 5.4 : 2.8, w = along ? L : Wd, d = along ? Wd : L, x0 = x - w / 2, y0 = y - d / 2;
  const body = S.box(x0, y0, z, x0 + w, y0 + d, z + h1, mat, o.tipped ? f => { f.top(x0 + 1.4, y0 + 1, x0 + 2.8, y0 + d - 1, "st-d:dark"); f.top(x0 + w - 2.8, y0 + 1, x0 + w - 1.4, y0 + d - 1, "st-d:dark"); } : null, { shadow: !o.tipped });
  const grp = { lights: [] };       // body, cabin and lights go together (ST.sightlines)
  body.grp = grp;
  if (!o.tipped) {
    const cw = along ? 5 : 4.2, cd = along ? 4.2 : 5;
    S.box(x - cw / 2 - (along ? 0.6 : 0), y - cd / 2, z + h1, x + cw / 2 - (along ? 0.6 : 0), y + cd / 2, z + h1 + 1.9, "cabin", null, { shadow: false }).grp = grp;
    if (S.night && o.lights) { const [hx, hy] = S.P0(along ? x0 + w : x, along ? y : y0 + d, z + 1.6); const glow = P.circle("st-x:lampglow", hx, hy, 1.4); S.marks.push(glow); grp.lights.push(glow); }
  }
  return body;
};

ST.GROUNDS.corridor = function (S, F, v, o) {
  const boul = v === "boulevard", pave = boul ? 14 : 12, road = boul ? 46 : 26, y1 = pave + 0.8, y2 = y1 + road, fp = boul ? 14 : 12;
  strip(S, F.X0, F.X1, 0, pave, "pave"); strip(S, F.X0, F.X1, pave, y1, "kerb"); strip(S, F.X0, F.X1, y1, y2, "road");
  strip(S, F.X0, F.X1, y2, y2 + 0.8, "kerb"); strip(S, F.X0, F.X1, y2 + 0.8, y2 + 0.8 + fp, "pave");
  const lanes = [];
  if (boul) {
    const mid = y1 + road / 2;
    strip(S, F.X0, F.X1, mid - 3, mid + 3, "median");
    for (let x = F.X0 + 6; x < F.X1 - 6; x += 16) { strip(S, x, x + 8, y1 + road / 4 - 0.2, y1 + road / 4 + 0.2, "mark"); strip(S, x, x + 8, mid + road / 4 - 0.2, mid + road / 4 + 0.2, "mark"); }
    for (let x = F.X0 + 20; x < F.X1 - 10; x += 34) S.cyl(x, mid, 2.6, 0, 1.2, "plant", { shadow: false }), S.cyl(x, mid, 3.4, 9, 13, "tree"), S.cyl(x, mid, 0.5, 1.2, 9, "wood", { shadow: false });
    lanes.push({ y: y1 + road / 8 * 1.2, dir: -1 }, { y: y1 + road / 8 * 2.8, dir: -1 }, { y: mid + road / 8 * 1.2, dir: 1 }, { y: mid + road / 8 * 2.8, dir: 1 });
  } else {
    for (let x = F.X0 + 6; x < F.X1 - 6; x += 14) strip(S, x, x + 7, y1 + road / 2 - 0.25, y1 + road / 2 + 0.25, "mark");
    lanes.push({ y: y1 + road * 0.27, dir: -1 }, { y: y1 + road * 0.73, dir: 1 });
  }
  // a crossing outside the site
  for (let i = 0; i < Math.floor(road / 2.6); i++) S.decal(P.rect("st-g:zebra", F.site.x1 - 12, y1 + 0.8 + i * 2.6, 9, 1.3));
  const farY = y2 + 0.8 + fp;
  let water = null;
  if (o.water) { water = ST.canal(S, F, farY, 26); }
  ST.farRow(S, F.X0, F.X1, water ? water.y1 + 8 : farY, 28, 0);
  ST.lamps(S, F.X0, F.X1, pave - 1.2, 0, 42);
  ST.lamps(S, F.X0 + 21, F.X1, y2 + 1.6, 0, 42, { towardY: -2.5 });
  return { kind: "corridor", pave: [0, pave], road: [y1, y2], lanes, kerb: pave + 0.8 + 3.4, farKerb: y2 - 3.4, far: farY, farPave: [y2 + 0.8, y2 + 0.8 + fp], water,
    roadName: { x: F.site.x0 - 28, y: y1 + (boul ? road * 0.25 : road / 2), z: 0 }, exit: { x: F.X1 - 2, y: y1 + road * 0.5, z: 0, dir: [1, 0] },
    stage: { x: F.site.x0 + (F.site.x1 - F.site.x0) * 0.6, y: y1 + road * 0.5, w: Math.min(70, F.site.x1 - F.site.x0 + 30), h: road - 4, z: 0 }, people: boul ? 7 : 9, traffic: boul ? 6 : 3,
    waterNote: water ? "The water props put a canal across the street." : "" };
};

ST.GROUNDS.lane = function (S, F, v, o) {
  const alley = v === "alley", twist = v === "twist", pave = alley ? 0 : twist ? 4 : 6, road = alley ? 11 : twist ? 14 : 18, y1 = pave + (pave ? 0.6 : 0), y2 = y1 + road;
  const xEnd = twist ? F.useLot.x0 - 2 : F.X1;
  if (pave) { strip(S, F.X0, xEnd, 0, pave, "pave"); strip(S, F.X0, xEnd, pave, y1, "kerb"); }
  strip(S, F.X0, xEnd, y1, y2, twist ? "cobble" : "road");
  const cob = (x0, x1, y0, yb) => { for (let x = x0 + 1; x < x1; x += 2.2) S.decal(P.rect("st-g:joint", x, y0, 0.18, yb - y0)); };
  if (twist) cob(F.X0, xEnd, y1, y2);
  if (alley) for (let x = F.X0 + 10; x < F.X1 - 6; x += 23) S.decal(P.ellipse("st-g:puddle", x + (x * 13 % 7), y1 + 3 + (x * 7 % 5), 3.2, 1.2));
  let exit, farY = y2 + (pave ? 0.6 + pave : 0), skip = null;
  if (twist) {
    // the lane bends south beyond the site: you never see past the bend
    const bx = xEnd, bw = 16;
    strip(S, bx, bx + bw, y1, farY + 46, "cobble"); cob(bx, bx + bw, y1, farY + 46);
    strip(S, bx + bw, bx + bw + 0.6, y2, farY + 46, "kerb");
    S.box(bx + bw + 0.6, y1, 0, F.X1, y1 + 22, 2.4, "far", null, { topMat: "cut", shadow: false });
    skip = (a, b) => b > bx - 2;
    exit = { x: bx + bw / 2, y: farY + 44, z: 0, dir: [0, 1] };
  } else exit = { x: F.X1 - 2, y: y1 + road / 2, z: 0, dir: [1, 0] };
  if (pave) { strip(S, F.X0, twist ? xEnd : F.X1, y2, y2 + 0.6, "kerb"); strip(S, F.X0, twist ? xEnd : F.X1, y2 + 0.6, farY, "pave"); }
  let water = null;
  if (o.water) water = ST.canal(S, Object.assign({}, F, { X1: twist ? xEnd : F.X1 }), farY, 24);
  if (alley) S.box(F.X0, farY, 0, twist ? xEnd : F.X1, farY + 1.4, 9, "brick", null, { shadow: false });     // the alley's far wall
  ST.farRow(S, F.X0, twist ? xEnd : F.X1, water ? water.y1 + 6 : farY + (alley ? 1.4 : 0), 26, 0, { skip });
  ST.lamps(S, F.X0, twist ? xEnd : F.X1, Math.max(1, pave - 1), 0, alley ? 64 : 48);
  return { kind: "lane", pave: pave ? [0, pave] : [0, 2.5], road: [y1, y2], lanes: alley ? [] : [{ y: y1 + road / 2, dir: 1 }], kerb: alley ? null : y1 + 3.2, far: farY, farPave: pave ? [y2 + 0.6, farY] : null, water,
    roadName: { x: F.site.x0 - 26, y: y1 + road / 2, z: 0 }, exit, stage: { x: (F.site.x0 + F.site.x1) / 2 + 14, y: y1 + road / 2, w: 60, h: road - 2, z: 0 }, people: alley ? 2 : 4, traffic: alley ? 0 : 1,
    waterNote: water ? "The water props put a canal behind the far side." : "" };
};

ST.GROUNDS.deck = function (S, F, v, o) {
  const fly = v === "flyover", Hd = fly ? 26 : 14, Dk = fly ? 36 : 16, zl = -Hd;
  // the frontage stands on a podium; the deck runs along it; the ground is below
  S.box(F.X0, -F.maxD - 10, zl, F.X1, 0, 0, "podium", null, { noTop: true, shadow: false });
  S.decal(P.rect("st-g:under", F.X0, 0, F.X1 - F.X0, Dk), zl);
  const deckItem = S.box(F.X0, 0, -2, F.X1, Dk, 0, "deck", f => {
    if (fly) {
      f.top(F.X0, 0, F.X1, 8, "st-g:pave");
      f.top(F.X0, 8, F.X1, 8.8, "st-g:kerb");
      f.top(F.X0, 8.8, F.X1, Dk - 1.6, "st-g:road");
      for (let x = F.X0 + 6; x < F.X1 - 6; x += 14) f.top(x, 8.8 + (Dk - 10.4) / 2 - 0.25, x + 7, 8.8 + (Dk - 10.4) / 2 + 0.25, "st-g:mark");
    } else for (let x = F.X0 + 8; x < F.X1; x += 10) f.top(x, 0, x + 0.25, Dk - 1.2, "st-g:joint");
  }, { shadow: false });
  S.box(F.X0, Dk - 1.2, 0, F.X1, Dk, fly ? 3.2 : 3.6, "deck", null, { shadow: false });          // the parapet
  S.deckTop = { z: 0, y0: 0, y1: Dk - 1.2, item: deckItem };          // what lies on the deck is drawn on its top (ST.stage)
  for (let x = F.X0 + 10; x < F.X1 - 4; x += fly ? 34 : 22) S.box(x - (fly ? 2.4 : 1.2), Dk - (fly ? 6 : 3), zl, x + (fly ? 2.4 : 1.2), Dk - 1, -2, "deck", null, { shadow: false });
  // the ground below: a service road, waste ground, the far side cut down
  const ly0 = Dk, road = fly ? 30 : 22;
  strip(S, F.X0, F.X1, ly0, ly0 + 6, "pave", zl); strip(S, F.X0, F.X1, ly0 + 6, ly0 + 6 + road, fly ? "lot" : "road", zl);
  if (!fly) for (let x = F.X0 + 6; x < F.X1 - 6; x += 14) strip(S, x, x + 7, ly0 + 6 + road / 2 - 0.25, ly0 + 6 + road / 2 + 0.25, "mark", zl);
  else for (let i = 0; i < 18; i++) { const x = F.X0 + (i * 37 % (F.X1 - F.X0)), y = ly0 + 8 + (i * 13 % road); S.decal(P.ellipse(i % 3 ? "st-g:rubble" : "st-g:puddle", x, y, 3 + i % 3, 1.4), zl); }
  const farY = ly0 + 6 + road;
  ST.farRow(S, F.X0, F.X1, farY + 1, 26, zl);
  // stairs down at the west end
  const sx = F.X0 + 14;
  for (let i = 0; i < 10; i++) S.box(sx, Dk + i * 1.6, zl, sx + 6, Dk + i * 1.6 + 1.6, -Hd * (1 - (i + 1) / 10) - 0.01, "deck", null, { shadow: false });
  ST.lamps(S, F.X0, F.X1, fly ? 8.4 : Dk - 2.2, 0, 40, { towardY: -2.5 });
  return { kind: "deck", zSite: 0, pave: [0, fly ? 7.4 : Dk - 2], road: fly ? [8.8, Dk - 1.6] : null, lanes: fly ? [{ y: 8.8 + (Dk - 10.4) * 0.27, dir: -1 }, { y: 8.8 + (Dk - 10.4) * 0.73, dir: 1 }] : [], kerb: null,
    lower: { z: zl, road: [ly0 + 6, ly0 + 6 + road], pave: [ly0, ly0 + 6] }, far: farY, water: null,
    roadName: { x: F.site.x0 - 26, y: fly ? 8.8 + (Dk - 10.4) / 2 : Dk / 2, z: 0 }, exit: { x: F.X1 - 2, y: fly ? 8.8 + (Dk - 10.4) / 2 : Dk / 2, z: 0, dir: [1, 0] },
    stage: fly ? { x: (F.site.x0 + F.site.x1) / 2 + 10, y: 8.8 + (Dk - 10.4) / 2, w: 60, h: Dk - 12, z: 0 } : { x: (F.site.x0 + F.site.x1) / 2 + 12, y: Dk / 2, w: 56, h: Dk - 4, z: 0 },
    people: 4, traffic: fly ? 4 : 0, waterNote: "" };
};

ST.GROUNDS.open = function (S, F, v, o) {
  const depth = 62;
  strip(S, F.X0, F.X1, 0, depth, "plaza");
  for (let x = F.X0 + 10; x < F.X1; x += 10) S.decal(P.rect("st-g:joint", x, 0, 0.2, depth));
  for (let y = 10; y < depth; y += 10) S.decal(P.rect("st-g:joint", F.X0, y, F.X1 - F.X0, 0.2));
  // concrete planters, one row each side of the site's approach
  for (const x of [F.site.x0 - 10, F.site.x1 + 4]) for (const y of [22, 44]) S.box(x, y, 0, x + 7, y + 7, 3, "concrete", f => f.top(x + 0.8, y + 0.8, x + 6.2, y + 6.2, "st-g:grass"));
  const y1 = depth + 0.8, road = 22;
  strip(S, F.X0, F.X1, depth, y1, "kerb"); strip(S, F.X0, F.X1, y1, y1 + road, "road");
  for (let x = F.X0 + 6; x < F.X1 - 6; x += 14) strip(S, x, x + 7, y1 + road / 2 - 0.25, y1 + road / 2 + 0.25, "mark");
  strip(S, F.X0, F.X1, y1 + road, y1 + road + 0.8, "kerb"); strip(S, F.X0, F.X1, y1 + road + 0.8, y1 + road + 10, "pave");
  let water = null;
  if (o.water) water = ST.canal(S, F, y1 + road + 10, 24);
  ST.farRow(S, F.X0, F.X1, water ? water.y1 + 8 : y1 + road + 10, 26, 0);
  ST.lamps(S, F.X0, F.X1, depth - 2, 0, 36);
  return { kind: "open", pave: [0, depth], road: [y1, y1 + road], lanes: [{ y: y1 + road * 0.27, dir: -1 }, { y: y1 + road * 0.73, dir: 1 }], kerb: null, far: y1 + road + 10, water,
    roadName: { x: F.X0 + 50, y: y1 + road / 2, z: 0 }, exit: { x: F.X1 - 2, y: y1 + road / 2, z: 0, dir: [1, 0] },
    stage: { x: (F.site.x0 + F.site.x1) / 2, y: depth * 0.55, w: 70, h: depth * 0.6, z: 0 }, people: 10, traffic: 2, plaza: true,
    waterNote: water ? "The water props put a canal across the road." : "" };
};

ST.GROUNDS.hub = function (S, F, v, o) {
  const pave = 12, y1 = pave + 0.8, road = 30, y2 = y1 + road, cx = (F.site.x0 + F.site.x1) / 2, cy = y2 + 12, R = 32, Ri = 14, arm = 24;
  strip(S, F.X0, F.X1, 0, pave, "pave"); strip(S, F.X0, F.X1, pave, y1, "kerb"); strip(S, F.X0, F.X1, y1, y2, "road");
  S.decal(P.circle("st-g:road", cx, cy, R));
  strip(S, cx - arm / 2, cx + arm / 2, cy, cy + 80, "road");
  for (let y = cy + R + 4; y < cy + 78; y += 14) strip(S, cx - 0.25, cx + 0.25, y, y + 7, "mark");
  for (let x = F.X0 + 6; x < F.X1 - 6; x += 14) if (Math.abs(x + 3.5 - cx) > R + 4) strip(S, x, x + 7, y1 + road / 2 - 0.25, y1 + road / 2 + 0.25, "mark");
  // the island
  const pts = []; for (let a = 0; a < Math.PI * 2; a += Math.PI / 14) pts.push([cx + Math.cos(a) * Ri, cy + Math.sin(a) * Ri]);
  S.prism(pts, 0, 0.8, "kerbstone", { topMat: "grass", shadow: false });
  // the far side, split by the south arm
  const farY = y2 + 0.8 + 10;
  strip(S, F.X0, cx - R - 2, y2, y2 + 0.8, "kerb"); strip(S, cx + R + 2, F.X1, y2, y2 + 0.8, "kerb");
  strip(S, F.X0, cx - R - 2, y2 + 0.8, farY, "pave"); strip(S, cx + R + 2, F.X1, y2 + 0.8, farY, "pave");
  let water = null;
  if (o.water) water = { y0: farY, y1: farY, note: true };
  ST.farRow(S, F.X0, F.X1, farY + 2, 28, 0, { skip: (a, b) => b > cx - arm / 2 - 26 && a < cx + arm / 2 + 26 });
  ST.lamps(S, F.X0, F.X1, pave - 1.2, 0, 40, { skip: x => Math.abs(x - cx) < 6 });
  return { kind: "hub", pave: [0, pave], road: [y1, y2], lanes: [{ y: y1 + road * 0.25, dir: -1 }, { y: y1 + road * 0.75, dir: 1 }], kerb: null, far: farY, water: null,
    island: { x: cx, y: cy, r: Ri }, ring: { x: cx, y: cy, r: R }, roadName: { x: F.site.x0 - 34, y: y1 + road / 2, z: 0 }, exit: { x: cx, y: cy + 76, z: 0, dir: [0, 1] },
    stage: { x: cx + R + 26, y: y1 + road / 2, w: 50, h: road - 4, z: 0 }, people: 4, traffic: 7, waterNote: "" };
};

ST.GROUNDS.covered = function (S, F, v, o) {
  const depth = 22, zr = 26;
  strip(S, F.X0, F.X1, 0, depth, "tile");
  for (let x = F.X0 + 6; x < F.X1; x += 6) S.decal(P.rect("st-g:joint", x, 0, 0.16, depth));
  // the far side of the arcade: shopfronts, cut down
  ST.farRow(S, F.X0, F.X1, depth, 26, 0);
  // iron columns, and the glass roof on its ribs
  for (let x = F.X0 + 6; x < F.X1; x += 24) for (const y of [1.2, depth - 1.2]) S.box(x - 0.45, y - 0.45, 0, x + 0.45, y + 0.45, zr, "iron", null, { shadow: false });
  const pcs = [];
  pcs.push(P.poly("st-x:glazing", [S.P0(F.X0, 0, zr), S.P0(F.X1, 0, zr), S.P0(F.X1, depth / 2, zr + 5), S.P0(F.X0, depth / 2, zr + 5)]));
  pcs.push(P.poly("st-x:glazing2", [S.P0(F.X0, depth / 2, zr + 5), S.P0(F.X1, depth / 2, zr + 5), S.P0(F.X1, depth, zr), S.P0(F.X0, depth, zr)]));
  for (let x = F.X0 + 6; x <= F.X1; x += 12) pcs.push(P.path("st-x:rib", `M${S.P0(x, 0, zr).join(" ")} Q${S.P0(x, depth / 2, zr + 10).join(" ")} ${S.P0(x, depth, zr).join(" ")}`, { box: [S.P0(x, 0, zr), S.P0(x, depth, zr), S.P0(x, depth / 2, zr + 6)] }));
  pcs.push(P.line("st-x:rib", ...S.P0(F.X0, depth / 2, zr + 5), ...S.P0(F.X1, depth / 2, zr + 5), { sw: 0.35 }));
  S.add({ b: [F.X0, 0, zr, F.X1, depth, zr + 5], pcs, ground: 0, shadow: false });
  if (!S.night) S.decal(P.rect("st-g:shadow-soft", F.X0, 4, F.X1 - F.X0, depth));
  let water = null;
  if (o.water) water = ST.canal(S, F, depth + 26, 22);
  return { kind: "covered", pave: [0, depth], road: null, lanes: [], kerb: null, far: depth, water, roof: zr,
    roadName: { x: F.site.x0 - 30, y: depth / 2, z: 0 }, exit: { x: F.X1 - 2, y: depth / 2, z: 0, dir: [1, 0] },
    stage: { x: (F.site.x0 + F.site.x1) / 2 + 8, y: depth / 2, w: 60, h: depth - 4, z: 0 }, people: 10, traffic: 0,
    waterNote: water ? "The water props put a canal behind the arcade." : "" };
};

ST.GROUNDS.deadend = function (S, F, v, o) {
  const pave = 10, y1 = pave + 0.8, road = 20, y2 = y1 + road, R = 24;
  // the closed end is on the side whose closing wall the view can see
  const westEnd = !S.V.flip, xc = westEnd ? F.X0 + 30 : F.X1 - 30;
  const xa = westEnd ? xc : F.X0, xb = westEnd ? F.X1 : xc;
  strip(S, F.X0, F.X1, 0, pave, "pave"); strip(S, F.X0, F.X1, pave, y1, "kerb");
  strip(S, xa, xb, y1, y2, "road");
  S.decal(P.circle("st-g:kerb", xc, y1 + road / 2 + 2, R + 0.8)); S.decal(P.circle("st-g:road", xc, y1 + road / 2 + 2, R));
  for (let x = xa + 30; x < xb - 6; x += 14) strip(S, x, x + 7, y1 + road / 2 - 0.25, y1 + road / 2 + 0.25, "mark");
  const farY = y2 + 0.8 + 8;
  strip(S, xa + (westEnd ? R : 0), xb - (westEnd ? 0 : R), y2, y2 + 0.8, "kerb");
  strip(S, F.X0, F.X1, y2 + 0.8, farY, "pave");
  // the building that closes the end
  const cx0 = westEnd ? F.X0 - 30 : xc + R + 6, cx1 = westEnd ? xc - R - 6 : F.X1 + 30;
  S.box(cx0, 0, 0, cx1, farY + 8, 22, "block", f => ST.windows(S, f, { win: "grid" }, 2, { sideWindows: true }));
  let water = null;
  if (o.water) water = ST.canal(S, F, farY, 22);
  ST.farRow(S, F.X0, F.X1, water ? water.y1 + 6 : farY, 26, 0, { skip: (a, b) => westEnd ? a < xc + R : b > xc - R });
  ST.lamps(S, F.X0, F.X1, pave - 1.2, 0, 44, { skip: x => westEnd ? x < xc : x > xc });
  return { kind: "deadend", pave: [0, pave], road: [y1, y2], lanes: [], kerb: y1 + 3.2, far: farY, water, mouth: westEnd ? "east" : "west",
    roadName: { x: (F.site.x0 + F.site.x1) / 2 + (westEnd ? 30 : -30), y: y1 + road / 2, z: 0 }, exit: { x: westEnd ? F.X1 - 2 : F.X0 + 2, y: y1 + road / 2, z: 0, dir: [westEnd ? 1 : -1, 0] },
    stage: { x: westEnd ? (F.site.x1 + 30) : (F.site.x0 - 30), y: y1 + road / 2, w: 50, h: road - 2, z: 0 }, people: 3, traffic: 0, parkAll: true,
    waterNote: water ? "The water props put a canal behind the far side." : "" };
};

ST.GROUNDS.waterside = function (S, F, v, o) {
  const tow = 11;
  strip(S, F.X0, F.X1, 0, tow, "pave");
  for (let x = F.X0 + 4; x < F.X1; x += 8) S.decal(P.rect("st-g:joint", x, 0, 0.18, tow));
  const water = ST.canal(S, F, tow, 30, { towpath: true });
  ST.farRow(S, F.X0, F.X1, water.y1 + 9, 26, 0);
  ST.lamps(S, F.X0, F.X1, 2, 0, 46);
  return { kind: "waterside", pave: [0, tow - 1.5], road: null, lanes: [], kerb: null, far: water.y1 + 9, water,
    roadName: { x: F.site.x0 - 24, y: tow / 2, z: 0 }, exit: { x: F.X1 - 2, y: tow / 2, z: 0, dir: [1, 0] },
    stage: { x: (F.site.x0 + F.site.x1) / 2 + 14, y: tow / 2, w: 56, h: tow - 3, z: 0 }, people: 3, traffic: 0, waterNote: "" };
};

// A canal: the near bank's wall, the water a few feet down, a towpath beyond.
ST.canal = function (S, F, y0, width, o = {}) {
  const zw = -4.5, y1 = y0 + width;
  S.decal(P.rect("st-g:water", F.X0, y0, F.X1 - F.X0, width), zw);
  for (let x = F.X0 + 7; x < F.X1; x += 10) S.decal(P.rect("st-g:ripple", x + ((x * 13) % 5), y0 + 5 + ((x * 7) % (width - 9)), 3.4, 0.35), zw);
  S.box(F.X0, y0, zw, F.X1, y0 + 0.6, 0, "edge", null, { noTop: true, shadow: false });
  strip(S, F.X0, F.X1, y0 - 0.9, y0, "edge");
  strip(S, F.X0, F.X1, y1, y1 + 1, "edge");
  strip(S, F.X0, F.X1, y1 + 1, y1 + 9, "pave");
  for (let x = F.X0 + 12; x < F.X1; x += 26) S.cyl(x, y0 - 1.6, 0.7, 0, 2, "dark", { shadow: false });     // bollards
  return { y0, y1, z: zw };
};

// The block behind the frontage: the rest of the street's buildings, rising
// over it. A maze of tall brick buildings and a huge apartment block are drawn here.
ST.backdrop = function (S, F, desc, zs) {
  const rng = S.rng, yb = -F.maxD - 8, k = desc && desc.k;
  let x = F.X0 + 4;
  while (x < F.X1 - 10) {
    const w = 26 + Math.floor(rng() * 30), h = k === "maze" ? 48 + rng() * 30 : 14 + rng() * 12, d = 22 + rng() * 8;
    S.box(x, yb - d, zs, x + w, yb, zs + h, k === "maze" ? "brick" : "block", k === "maze" ? f => ST.windows(S, f, { win: "slit" }, Math.max(1, Math.floor(h / 11)), { litP: 0.2, sideWindows: false }) : null);
    x += w + (k === "maze" ? 4 : 2 + Math.floor(rng() * 8));
  }
  if (k === "slab") {
    const w = Math.min(150, F.X1 - F.X0 - 80), x0 = (F.site.x0 + F.site.x1) / 2 - w / 2 - 30, y1 = yb - 34, Hs = 74;
    S.box(x0, y1 - 26, zs, x0 + w, y1, zs + Hs, "concrete", f => {
      for (let z = zs + 6; z < zs + Hs - 4; z += 9) { f.front(x0 + 1, x0 + w - 1, z, z + 1, "st-d:balcony"); for (let u = x0 + 4; u < x0 + w - 3; u += 7) f.front(u, u + 4, z + 2, z + 6.4, S.night && rng() < 0.3 ? "st-d:winlit" : "st-d:win"); }
    });
    F.slab = { x0, x1: x0 + w, y1, z1: zs + Hs };
  }
};

// The side passages between the lots.
ST.passages = function (S, F, zs) {
  const L = F.lots.slice().sort((a, b) => a.x0 - b.x0);
  for (let i = 0; i < L.length - 1; i++) {
    const a = L[i], b = L[i + 1];
    if (b.x0 - a.x1 < 0.5) continue;
    S.decal(P.rect("st-g:passage", a.x1, -Math.max(a.d, b.d) - 6, b.x0 - a.x1, Math.max(a.d, b.d) + 6), zs);
  }
};

// =============================================================================
// Neighbours, end lots
// =============================================================================
ST.neighbour = function (S, L, zs, F) {
  if (L.cut) return ST.cutNeighbour(S, L, zs);
  const sp = L.spec, x0 = L.x0, x1 = L.x1, y1 = L.y0, y0 = L.y0 - L.d, night = S.night, rng = S.rng;
  const mat = L.which === 1 ? "nb1" : "nb2", H = GF + STOREY * (sp.st - 1);
  const shopLook = { win: "grid" };
  let item;
  const shopfront = (f, a, b, o = {}) => {
    const lit = night && rng() < 0.75;
    f.front(a + 1.2, b - 7, zs + 1.1, zs + 8.6, lit ? "st-d:shoplit" : "st-d:shop");
    f.front(b - 6, b - 2, zs, zs + 8.2, "st-d:door");
    f.front(a + 0.6, b - 0.6, zs + 9.2, zs + 11.6, o.sign || (L.which === 1 ? "st-d:sign1" : "st-d:sign2"));
    if (lit) S.decal(P.poly("st-g:spill", [[a + 1.2, y1], [b - 7, y1], [b - 4, y1 + 9], [a - 1.8, y1 + 9]]), zs);
  };
  switch (sp.k) {
    case "shop": case "pub": {
      item = S.box(x0, y0, zs, x1, y1, zs + H, sp.k === "pub" ? "brick" : mat, f => {
        shopfront(f, x0, x1);
        ST.windows(S, f, sp.k === "pub" ? { win: "tall" } : shopLook, sp.st, { shopfront: true });
        if (sp.grille) for (let u = x0 + 2; u < x1 - 7; u += 1.4) f.front(u, u + 0.14, zs + 1.1, zs + 8.6, "st-d:grille");
        if (sp.cross) f.front(x1 - 5.6, x1 - 2.4, zs + 12.4, zs + 13.4, "st-d:cross"), f.front(x1 - 4.5, x1 - 3.5, zs + 11.4, zs + 14.4, "st-d:cross");
      });
      if (sp.awning) S.box(x0 + 1, y1, zs + 8.6, x1 - 1, y1 + 4.5, zs + 9.6, "awning", f => { for (let u = x0 + 1; u < x1 - 1; u += 3) f.front(u, u + 1.5, zs + 8.6, zs + 9.6, "st-d:stripe"); }, { shadow: false });
      if (sp.k === "pub") S.box(x1 - 4, y1, zs + 10, x1 - 3.6, y1 + 3.6, zs + 14, "wood", f => f.front(x1 - 4.2, x1 - 3.4, zs + 10.2, zs + 13.8, "st-d:sign1"), { shadow: false });
      if (sp.board) S.box(x0 + 3, y1 + 1, zs, x0 + 5.4, y1 + 1.6, zs + 3.6, "paper", null, { shadow: false });
      if (sp.tables) for (const u of [x0 + 5, x0 + 13]) { S.cyl(u, y1 + 3.5, 1.1, zs, zs + 2.6, "metal", { shadow: false }); }
      ST.roofClutter(S, x0, y0, x1, y1, zs + H);
      break;
    }
    case "flats": item = ST.flats(S, x0, y0, x1, y1, zs, sp.st, mat); break;
    case "house": case "mansion": {
      const st = sp.st, Hh = GF + STOREY * (st - 1);
      item = S.box(x0, y0, zs, x1, y1, zs + Hh, sp.k === "mansion" ? "stone" : "brick", f => { ST.windows(S, f, { win: "tall" }, st, {}); f.front((x0 + x1) / 2 - 2.4, (x0 + x1) / 2 + 2.4, zs, zs + 8.4, "st-d:door"); });
      S.gable(x0, y0, x1, y1, zs + Hh, Math.min(14, L.d * 0.32), "roof", sp.k === "mansion" ? "stone" : "brick");
      if (sp.k === "mansion") { for (let u = (x0 + x1) / 2 - 9; u <= (x0 + x1) / 2 + 9; u += 6) S.box(u - 0.8, y1 + 0.4, zs, u + 0.8, y1 + 2, zs + GF + 4, "stone"); S.decal(P.rect("st-g:grass", x0, y1, x1 - x0, -L.y0), zs); ST.railing(S, x0, x1, 0.6, zs); }
      else S.decal(P.rect("st-g:yard", x0, y1, x1 - x0, -L.y0 || 0.01), zs);
      break;
    }
    case "office": item = S.box(x0, y0, zs, x1, y1, zs + H, "glassblock", f => { ST.windows(S, f, { win: "band" }, sp.st, { litP: 0.25 }); f.front((x0 + x1) / 2 - 3, (x0 + x1) / 2 + 3, zs, zs + 9, "st-d:door"); }); ST.roofClutter(S, x0, y0, x1, y1, zs + H); break;
    case "garage": {
      item = S.box(x0, y0, zs, x1, y1, zs + 15, "metal", f => {
        for (let i = 0; i < 2; i++) { const a = x0 + 3 + i * (x1 - x0 - 6) / 2, b = a + (x1 - x0 - 6) / 2 - 2; f.front(a, b, zs, zs + 11, "st-d:roller"); for (let z = zs + 1; z < zs + 11; z += 1.1) f.front(a, b, z, z + 0.14, "st-d:frame"); }
        f.front(x0 + 1, x1 - 1, zs + 12, zs + 14.2, L.which === 1 ? "st-d:sign1" : "st-d:sign2");
      });
      break;
    }
    case "warehouse": case "boathouse": {
      const Hw = sp.k === "boathouse" ? 16 : 28;
      item = S.box(x0, y0, zs, x1, y1, zs + Hw, sp.k === "boathouse" ? "wood" : "brick", f => {
        f.front((x0 + x1) / 2 - 8, (x0 + x1) / 2 + 8, zs, zs + 14, "st-d:roller"); for (let z = zs + 1; z < zs + 14; z += 1.2) f.front((x0 + x1) / 2 - 8, (x0 + x1) / 2 + 8, z, z + 0.14, "st-d:frame");
        if (sp.k === "warehouse") for (let u = x0 + 4; u < x1 - 4; u += 7) f.front(u, u + 3.4, zs + 19, zs + 24, night && rng() < 0.2 ? "st-d:winlit" : "st-d:win");
      });
      if (sp.k === "boathouse") S.gable(x0, y0, x1, y1, zs + Hw, 10, "roof", "wood");
      if (sp.k === "warehouse") S.box((x0 + x1) / 2 - 10, y1, zs, (x0 + x1) / 2 + 10, y1 + 4, zs + 3.6, "concrete", null, { shadow: false });
      break;
    }
    case "venue": case "cinema": {
      item = S.box(x0, y0, zs, x1, y1, zs + H, mat, f => {
        f.front(x0 + 6, x1 - 6, zs, zs + 9, night ? "st-d:shoplit" : "st-d:shop");
        ST.windows(S, f, { win: "grid" }, sp.st, { shopfront: true, litP: 0.3 });
        if (sp.k === "venue") f.front(x0 + 3, x1 - 3, zs + 14, zs + 17, "st-d:neon");
      });
      // a marquee over the doors, a blade sign
      S.box(x0 + 4, y1, zs + 10, x1 - 4, y1 + 6, zs + 13, sp.k === "cinema" ? "marquee" : "awning", f => f.front(x0 + 4.6, x1 - 4.6, zs + 10.6, zs + 12.4, "st-d:signlit"), { shadow: false });
      if (sp.k === "cinema") S.box(x1 - 6, y1, zs + 14, x1 - 5, y1 + 4.4, zs + H + 6, "marquee", f => f.front(x1 - 6.1, x1 - 4.9, zs + 15, zs + H + 5, "st-d:signlit"), { shadow: false });
      ST.roofClutter(S, x0, y0, x1, y1, zs + H);
      break;
    }
    case "bank": case "civic": case "temple": case "school": {
      const m = sp.k === "school" ? "brick" : sp.k === "civic" ? "concrete" : "stone";
      item = S.box(x0, y0, zs, x1, y1, zs + H, m, f => {
        ST.windows(S, f, { win: sp.k === "civic" ? "grid" : "tall" }, sp.st, { litP: 0.2 });
        f.front((x0 + x1) / 2 - 3, (x0 + x1) / 2 + 3, zs, zs + 10, "st-d:door");
        if (sp.bluelamp) f.front((x0 + x1) / 2 + 4, (x0 + x1) / 2 + 5.4, zs + 7, zs + 8.6, "st-d:bluelamp");
      });
      if (sp.k === "bank" || sp.k === "temple") for (let u = (x0 + x1) / 2 - 12; u <= (x0 + x1) / 2 + 12; u += 6) S.box(u - 0.9, y1 + 0.3, zs, u + 0.9, y1 + 2.1, zs + GF + 6, "stone");
      if (sp.k === "temple") { const cx = (x0 + x1) / 2; S.box(cx - 5, y0 + 6, zs + H, cx + 5, y0 + 16, zs + H + 14, "stone"); ST.spire(S, cx, y0 + 11, zs + H + 14, 5, 16); }
      if (sp.k === "school") { ST.railing(S, x0, x1, 0.6, zs); S.decal(P.rect("st-g:yard", x0, y1, x1 - x0, -L.y0), zs); }
      if (sp.k === "civic") S.cyl((x0 + x1) / 2 + 9, y1 + 2, 0.25, zs, zs + 22, "metal", { shadow: false });
      break;
    }
    case "substation": {
      S.decal(P.rect("st-g:yard", x0, y0, x1 - x0, L.d), zs);
      item = S.box(x0 + 4, y0 + 2, zs, x1 - 4, y0 + 14, zs + 14, "brick", f => f.front(x0 + 8, x0 + 12, zs, zs + 8, "st-d:door"));
      for (const u of [x0 + 9, x0 + 21, x0 + 33]) if (u < x1 - 6) { S.box(u - 3, y0 + 18, zs, u + 3, y0 + 25, zs + 7, "metal"); for (const du of [-1.8, 0, 1.8]) S.cyl(u + du, y0 + 21.5, 0.45, zs + 7, zs + 10, "white", { shadow: false }); }
      ST.fence(S, x0, x1, y1 - 0.4, zs, 8);
      break;
    }
    case "diner": {
      item = S.box(x0, y0, zs, x1, y1, zs + 14, "white", f => {
        f.front(x0 + 1.5, x1 - 6, zs + 2.2, zs + 9.4, night ? "st-d:shoplit" : "st-d:glass"); f.front(x1 - 5, x1 - 1.5, zs, zs + 8.4, "st-d:door");
        f.front(x0 + 1, x1 - 1, zs + 10.6, zs + 12.6, "st-d:neon");
        f.side(y0 + 3, y1 - 3, zs + 2.2, zs + 9.4, night ? "st-d:shoplit" : "st-d:glass");
      });
      if (night) S.decal(P.poly("st-g:spill", [[x0 + 1.5, y1], [x1 - 6, y1], [x1 - 3, y1 + 9], [x0 - 1.5, y1 + 9]]), zs);
      break;
    }
    default: item = S.box(x0, y0, zs, x1, y1, zs + H, mat, f => ST.windows(S, f, shopLook, sp.st, {}));
  }
  return { item };
};
// A neighbour cut down to its ground floor, its upper floors' outline shown as
// the cut, like the iso's near walls: so the service side can be seen past it.
ST.cutNeighbour = function (S, L, zs) {
  const sp = L.spec, x0 = L.x0, x1 = L.x1, y1 = L.y0, y0 = L.y0 - L.d, night = S.night, rng = S.rng;
  const shop = /shop|pub|venue|cinema|diner/.test(sp.k);
  const item = S.box(x0, y0, zs, x1, y1, zs + GF - 1, L.which === 1 ? "nb1" : "nb2", f => {
    if (shop) { f.front(x0 + 1.2, x1 - 7, zs + 1.1, zs + 8.6, night && rng() < 0.75 ? "st-d:shoplit" : "st-d:shop"); f.front(x1 - 6, x1 - 2, zs, zs + 8.2, "st-d:door"); }
    else { f.front((x0 + x1) / 2 - 2.6, (x0 + x1) / 2 + 2.6, zs, zs + 8.4, sp.k === "garage" || sp.k === "warehouse" ? "st-d:roller" : "st-d:door"); ST.windows(S, f, { win: "grid" }, 1, { skip: c => Math.abs(c - (x0 + x1) / 2) < 5 }); }
  }, { topMat: "cut" });
  return { item };
};
ST.flats = function (S, x0, y0, x1, y1, zs, st, mat) {
  const H = GF + STOREY * (st - 1);
  const it = S.box(x0, y0, zs, x1, y1, zs + H, mat === "nb1" || mat === "nb2" ? "concrete" : mat, f => { ST.windows(S, f, { win: "grid" }, st, {}); f.front((x0 + x1) / 2 - 2.6, (x0 + x1) / 2 + 2.6, zs, zs + 8.4, "st-d:door"); });
  for (let s = 1; s < st; s++) { const z = zs + GF + STOREY * (s - 1); for (let u = x0 + 4; u < x1 - 9; u += 14) S.box(u, y1, z, u + 9, y1 + 3, z + 0.8, "concrete", f => f.front(u, u + 9, z + 0.8, z + 3.4, "st-x:rail"), { shadow: false }); }
  return it;
};
ST.roofClutter = function (S, x0, y0, x1, y1, z) {
  const rng = S.rng;
  if (rng() < 0.6) S.box(x1 - 9, y0 + 4, z, x1 - 5, y0 + 8, z + 3, "concrete", null, { shadow: false });
  if (rng() < 0.4) S.cyl(x0 + 7, y0 + 7, 2.2, z, z + 5, "metal");
};
ST.railing = function (S, x0, x1, y, zs) {
  const pcs = [P.line("st-x:rail", ...S.P0(x0, y, zs + 3.4), ...S.P0(x1, y, zs + 3.4), { sw: 0.3 })];
  for (let x = x0; x <= x1; x += 1.2) pcs.push(P.line("st-x:rail", ...S.P0(x, y, zs), ...S.P0(x, y, zs + 3.4), { sw: 0.16 }));
  S.add({ b: [x0, y - 0.2, zs, x1, y + 0.2, zs + 3.4], pcs, ground: zs, shadow: false });
};
ST.fence = function (S, x0, x1, y, zs, h) {
  const pcs = [P.poly("st-x:fence", [S.P0(x0, y, zs), S.P0(x1, y, zs), S.P0(x1, y, zs + h), S.P0(x0, y, zs + h)])];
  for (let x = x0; x <= x1; x += 8) pcs.push(P.line("st-x:rail", ...S.P0(x, y, zs), ...S.P0(x, y, zs + h), { sw: 0.3 }));
  pcs.push(P.line("st-x:rail", ...S.P0(x0, y, zs + h), ...S.P0(x1, y, zs + h), { sw: 0.25 }));
  S.add({ b: [x0, y - 0.2, zs, x1, y + 0.2, zs + h], pcs, ground: zs, shadow: false });
};
ST.spire = function (S, cx, cy, z, r, h) {
  const tip = S.P0(cx, cy, z + h);
  const sx = S.V.flip ? cx - r : cx + r;
  S.add({ b: [cx - r, cy - r, z, cx + r, cy + r, z + h], pcs: [P.poly("st-s:roof", [S.P0(sx, cy - r, z), S.P0(sx, cy + r, z), tip]), P.poly("st-t:roof", [S.P0(cx - r, cy + r, z), S.P0(cx + r, cy + r, z), tip])], ground: 0, shadow: true });
};
ST.plainLot = function (S, L, zs, mat) {
  const it = S.box(L.x0, L.y0 - L.d, zs, L.x1, L.y0, zs + GF + STOREY * 2, mat, f => ST.windows(S, f, { win: "grid" }, 3, { litP: 0.25 }));
  return { item: null, it };
};

// The block's use, at the east end of the frontage (base Blades, Use).
ST.useLot = function (S, L, use, zs, F) {
  const x0 = L.x0, x1 = L.x1, y1 = L.y0, y0 = y1 - L.d, cx = (x0 + x1) / 2, night = S.night, rng = S.rng;
  let item = null;
  const yard = () => S.decal(P.rect("st-g:yard", x0, y0, x1 - x0, L.d), zs);
  switch (use.k) {
    case "flats": item = ST.flats(S, x0, y0, x1, y1, zs, 4, "concrete"); break;
    case "workshop": item = S.box(x0, y0, zs, x1, y1, zs + 16, "brick", f => { f.front(x0 + 4, x0 + 16, zs, zs + 11, night ? "st-d:shoplit" : "st-d:dark"); f.front(x0 + 20, x1 - 4, zs + 4, zs + 11, "st-d:win"); }); S.gable(x0, y0, x1, y1, zs + 16, 8, "roof", "brick"); S.box(x0 + 3, y1 + 1, zs, x0 + 11, y1 + 3.5, zs + 3, "wood", null, { shadow: false }); break;
    case "yard": yard(); item = S.box(x0 + 2, y0 + 2, zs, x1 - 14, y0 + 16, zs + 12, "metal", f => f.front(x0 + 6, x0 + 14, zs, zs + 9, "st-d:roller")); ST.fence(S, x0, x1, y1 - 0.4, zs, 7); for (let i = 0; i < 6; i++) S.person(x1 - 10 + (i % 2) * 2, y0 + 20 + i * 2.6, zs); break;
    case "shoprow": item = S.box(x0, y0, zs, x1, y1, zs + GF + STOREY, "render", f => { for (let i = 0; i < 3; i++) { const a = x0 + i * (x1 - x0) / 3, b = a + (x1 - x0) / 3; f.front(a + 1, b - 5, zs + 1, zs + 8.6, night && rng() < 0.7 ? "st-d:shoplit" : "st-d:shop"); f.front(b - 4.4, b - 1.2, zs, zs + 8.2, "st-d:door"); f.front(a + 0.6, b - 0.6, zs + 9.2, zs + 11.4, i % 2 ? "st-d:sign1" : "st-d:sign2"); } ST.windows(S, f, { win: "grid" }, 2, { shopfront: true }); }); break;
    case "market": yard(); for (let i = 0; i < 4; i++) { const sx = x0 + 4 + (i % 2) * 20, sy = y0 + 6 + Math.floor(i / 2) * 14; ST.stall(S, sx, sy, zs, i % 2 ? "awning" : "canvas"); } item = S.box(x0, y0, zs, x0 + 2, y0 + L.d, zs + 9, "brick"); break;
    case "hotel": item = ST.flats(S, x0, y0, x1, y1, zs, 6, "render"); S.box(cx - 8, y1, zs + 9, cx + 8, y1 + 7, zs + 10, "awning", null, { shadow: false }); break;
    case "court": item = S.box(x0, y0, zs, x1, y1, zs + GF + STOREY * 2, "stone", f => { ST.windows(S, f, { win: "tall" }, 3, {}); f.front(cx - 3, cx + 3, zs, zs + 10, "st-d:door"); }); for (let u = cx - 15; u <= cx + 15; u += 6) S.box(u - 1, y1 + 0.3, zs, u + 1, y1 + 2.3, zs + GF + 9, "stone"); S.cyl(x1 - 4, y1 + 3, 0.25, zs, zs + 30, "metal", { shadow: false }); break;
    case "square": case "park": {
      S.decal(P.rect(use.k === "park" ? "st-g:grass" : "st-g:plaza", x0, y0, x1 - x0, L.d), zs);
      for (const [tx, ty] of [[x0 + 9, y0 + 9], [x1 - 9, y0 + 12], [x0 + 14, y0 + 27], [x1 - 12, y0 + 29]]) ST.tree(S, tx, ty, zs);
      if (use.k === "park") S.decal(P.ellipse("st-g:water", cx, y0 + L.d / 2, 7, 4), zs);
      else for (const bx of [cx - 6, cx + 2]) S.box(bx, y1 - 5, zs, bx + 5, y1 - 3.6, zs + 1.6, "wood", null, { shadow: false });
      item = null; break;
    }
    case "pylon": yard(); ST.fence(S, x0, x1, y1 - 0.4, zs, 8); ST.pylon(S, cx, y0 + L.d / 2, zs, 46); item = S.box(x0 + 3, y0 + 3, zs, x0 + 15, y0 + 13, zs + 9, "brick"); break;
    case "factory": {
      item = S.box(x0, y0, zs, x1, y1, zs + 18, "brick", f => { for (let u = x0 + 4; u < x1 - 4; u += 8) f.front(u, u + 4, zs + 6, zs + 13, night && rng() < 0.4 ? "st-d:winlit" : "st-d:win"); f.front(x0 + 3, x0 + 13, zs, zs + 12, "st-d:roller"); });
      for (let u = x0; u < x1 - 1; u += 10) S.add({ b: [u, y0, zs + 18, u + 10, y1, zs + 24], pcs: [P.poly("st-t:roof", [S.P0(u, y1, zs + 18), S.P0(u + 10, y1, zs + 18), S.P0(u + 10, y1, zs + 24)]), P.poly("st-d:glass", [S.P0(u, y1, zs + 18), S.P0(u + 10, y1, zs + 24), S.P0(u, y1, zs + 24)])], ground: zs, shadow: false });
      S.cyl(x1 - 7, y0 + 7, 2.6, zs, zs + 58, "brick");
      if (!night) for (let i = 0; i < 5; i++) { const [sx, sy] = S.P0(x1 - 7 + i * 2.5, y0 + 7 + i * 1.5, zs + 60 + i * 4); S.marks.push(P.circle("st-x:smoke", sx, sy, 2.4 + i * 0.8)); }
      break;
    }
    case "depot": {
      item = S.box(x0, y0, zs, x1, y1, zs + 20, "brick", f => { for (const a of [x0 + 5, x0 + (x1 - x0) / 2 + 2]) { f.front(a, a + (x1 - x0) / 2 - 7, zs, zs + 14, "st-d:dark"); } });
      S.gable(x0, y0, x1, y1, zs + 20, 9, "roof", "brick");
      for (let x = x0 + 3; x < x1; x += 2) S.decal(P.rect("st-g:rail", x, y1, 0.3, 14), zs);
      break;
    }
    case "club": item = S.box(x0, y0, zs, x1, y1, zs + GF + STOREY, "dark", f => { f.front(cx - 3, cx + 3, zs, zs + 8.4, "st-d:door"); f.front(x0 + 3, x1 - 3, zs + 10, zs + 13, "st-d:neon"); f.front(x0 + 2, x0 + 3.4, zs + 3, zs + 20, "st-d:neon"); }); for (let i = 0; i < 5; i++) S.person(cx + 5 + i * 2.2, y1 + 2.4, zs); break;
    case "theatre": item = S.box(x0, y0, zs, x1, y1, zs + GF + STOREY * 2, "render", f => { f.front(x0 + 5, x1 - 5, zs, zs + 9, night ? "st-d:shoplit" : "st-d:shop"); ST.windows(S, f, { win: "tall" }, 3, { shopfront: true }); for (const u of [x0 + 2, x1 - 6]) f.front(u, u + 4, zs + 2, zs + 8, "st-d:poster"); }); S.box(x0 + 4, y1, zs + 10, x1 - 4, y1 + 6, zs + 13, "marquee", f => f.front(x0 + 4.6, x1 - 4.6, zs + 10.6, zs + 12.4, "st-d:signlit"), { shadow: false }); break;
    case "lockups": { item = S.box(x0, y0, zs, x1, y1, zs + 10, "concrete", f => { for (let u = x0 + 1.5; u < x1 - 9; u += 10) { f.front(u, u + 8.6, zs, zs + 8, "st-d:roller"); for (let z = zs + 0.8; z < zs + 8; z += 1) f.front(u, u + 8.6, z, z + 0.12, "st-d:frame"); } }); break; }
    case "plot": {
      S.decal(P.rect("st-g:soil", x0, y0, x1 - x0, L.d), zs);
      for (let y = y0 + 3; y < y1 - 3; y += 4.5) S.decal(P.rect("st-g:crop", x0 + 3, y, x1 - x0 - 6, 2), zs);
      S.box(x0, y1 - 1.2, zs, x1, y1, zs + 4.2, "brick", null, { shadow: false });
      item = S.box(cx - 10, y0 + 4, zs, cx + 10, y0 + 14, zs + 8, "glasshouse");
      break;
    }
    case "college": item = S.box(x0, y0, zs, x1, y1, zs + GF + STOREY * 2, "stone", f => { ST.windows(S, f, { win: "tall" }, 3, {}); f.front(cx - 3, cx + 3, zs, zs + 10, "st-d:door"); }); S.box(cx - 5, y0 + 4, zs + GF + STOREY * 2, cx + 5, y0 + 14, zs + GF + STOREY * 2 + 12, "stone", f => f.front(cx - 2.6, cx + 2.6, f.z1 - 9, f.z1 - 3.8, "st-d:clock")); break;
    case "studio": item = S.box(x0, y0, zs, x1, y1, zs + GF + STOREY, "brick", f => { f.front(x0 + 3, x1 - 3, zs + 12, zs + 22, "st-d:glass"); f.front(x0 + 4, x0 + 18, zs + 2, zs + 9, "st-d:mural1"); f.front(x0 + 10, x0 + 24, zs + 4, zs + 8, "st-d:mural2"); }); break;
  }
  return { item: item || { b: [x0, y0, zs, x1, y1, zs + 10], pcs: [] } };
};

// The west end lot: a street description that is a building, or a lot.
ST.descLot = function (S, L, desc, zs, F) {
  const x0 = L.x0, x1 = L.x1, y1 = L.y0, y0 = y1 - L.d, cx = (x0 + x1) / 2, night = S.night, rng = S.rng;
  let item = null;
  switch (desc.k) {
    case "storefront": item = S.box(x0, y0, zs, x1, y1, zs + GF + STOREY, "render", f => {
      f.front(x0 + 1.2, x1 - 6, zs + 1.1, zs + 8.6, night ? "st-d:shoplit" : "st-d:shop"); f.front(x1 - 5, x1 - 1.4, zs, zs + 8.2, "st-d:door");
      for (let u = x0; u < x1 - 0.1; u += 4) { f.frontPoly([[u, zs + 9], [u + 2, zs + 13], [u + 4, zs + 9]], "st-d:pattern1"); f.frontPoly([[u + 2, zs + 13], [u + 4, zs + 9], [u + 4, zs + 13]], "st-d:pattern2"); }
      f.front(x0, x1, zs + 13, zs + 14.4, "st-d:pattern2");
      ST.windows(S, f, { win: "grid" }, 2, { shopfront: true });
    }); break;
    case "bubble": {
      const r = Math.min(L.d, x1 - x0) / 2 - 1, pts = [];
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) pts.push([cx + Math.cos(a) * r, y0 + L.d / 2 + Math.sin(a) * r * 0.8]);
      item = S.prism(pts, zs, zs + 30, "white");
      for (let s = 0; s < 3; s++) for (let u = -1; u <= 1; u++) { const pp = [], zc = zs + 6 + s * 9, xc = cx + u * 9; for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) pp.push(S.P0(xc + Math.cos(a) * 2.6, y0 + L.d / 2 + r * 0.8 + 0.05, zc + Math.sin(a) * 2.6)); item.pcs.push(P.poly(night && rng() < 0.4 ? "st-d:winlit" : "st-d:glass", pp)); }
      break;
    }
    case "mural": item = S.box(x0, y0, zs, x1, y1, zs + GF + STOREY * 2, "brick", f => {
      for (let i = 0; i < 9; i++) { const u = x0 + 4 + (i * 13) % (x1 - x0 - 8), z = zs + 4 + (i * 7) % 22, r = 2.6 + (i % 3); const pp = []; for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) pp.push([u + Math.cos(a) * r * (a % (Math.PI / 3) < 0.1 ? 1.4 : 0.7), z + Math.sin(a) * r * (a % (Math.PI / 3) < 0.1 ? 1.4 : 0.7)]); f.frontPoly(pp, ["st-d:flower1", "st-d:flower2", "st-d:flower3"][i % 3]); f.front(u - 0.3, u + 0.3, zs, z - r, "st-d:stem"); }
    }); break;
    case "nature": {
      S.decal(P.rect("st-g:lot", x0, y0, x1 - x0, L.d), zs);
      for (let i = 0; i < 7; i++) { const rx = x0 + 5 + (i * 11) % (x1 - x0 - 10), ry = y0 + 6 + (i * 7) % (L.d - 10), rr = 3 + (i % 3) * 1.6; S.cyl(rx, ry, rr, zs, zs + 2 + (i % 3) * 1.6, "rock", { n: 7, shadow: false }); }
      for (let i = 0; i < 16; i++) { const gx = x0 + 3 + (i * 7.3) % (x1 - x0 - 6), gy = y0 + 4 + (i * 5.7) % (L.d - 6); S.decal(P.ellipse(i % 2 ? "st-g:tuft1" : "st-g:tuft2", gx, gy, 1.6, 1.1), zs); }
      item = { b: [x0, y0, zs, x1, y1, zs + 6], pcs: [] };
      break;
    }
    case "screens": item = S.box(x0, y0, zs, x1, y1, zs + GF + STOREY * 2, "dark", f => {
      for (let i = 0; i < 12; i++) { const u = x0 + 2 + (i % 4) * ((x1 - x0 - 4) / 4), z = zs + 3 + Math.floor(i / 4) * 9; f.front(u + 0.6, u + (x1 - x0 - 4) / 4 - 0.6, z, z + 6.4, i % 3 ? "st-d:screen" : "st-d:screen2"); }
      for (let i = 0; i < 6; i++) { const u = y0 + 3 + i * (L.d - 6) / 6; f.side(u, u + (L.d - 6) / 6 - 0.8, zs + 12, zs + 18, "st-d:screen"); }
    }); break;
    case "billboards": {
      S.decal(P.rect("st-g:lot", x0, y0, x1 - x0, L.d), zs);
      for (const [bx, by] of [[x0 + 2, y0 + 10], [x0 + 6, y0 + 24]]) {
        S.box(bx + 4, by, zs, bx + 5, by + 1, zs + 14, "metal", null, { shadow: false }); S.box(bx + 20, by, zs, bx + 21, by + 1, zs + 14, "metal", null, { shadow: false });
        S.box(bx, by, zs + 12, bx + 25, by + 1.2, zs + 24, "billboard", f => { f.front(bx + 0.6, bx + 12, zs + 12.6, zs + 23.4, "st-d:poster"); f.front(bx + 12.6, bx + 24.4, zs + 12.6, zs + 23.4, "st-d:poster2"); });
      }
      item = { b: [x0, y0 + 24, zs + 12, x0 + 31, y0 + 25.2, zs + 24], pcs: [] };
      break;
    }
    case "scaffold": {
      item = S.box(x0, y0, zs, x1, y1, zs + GF + STOREY * 2, "brick", f => ST.windows(S, f, { win: "tall" }, 3, {}));
      S.box(x0 + 6, y0 + 6, zs + GF + STOREY * 2, x1 - 6, y1 - 8, zs + GF + STOREY * 2 + 11, "glassblock");
      const pcs = [], zt = zs + GF + STOREY * 2 + 2;
      for (let u = x0 - 0.5; u <= x1 + 0.5; u += 6) pcs.push(P.line("st-x:pole", ...S.P0(u, y1 + 3, zs), ...S.P0(u, y1 + 3, zt), { sw: 0.3 }));
      for (let z = zs + 6; z <= zt; z += 6) { pcs.push(P.line("st-x:pole", ...S.P0(x0 - 0.5, y1 + 3, z), ...S.P0(x1 + 0.5, y1 + 3, z), { sw: 0.3 })); pcs.push(P.poly("st-x:plank", [S.P0(x0 - 0.5, y1 + 0.4, z), S.P0(x1 + 0.5, y1 + 0.4, z), S.P0(x1 + 0.5, y1 + 3, z), S.P0(x0 - 0.5, y1 + 3, z)])); }
      S.add({ b: [x0 - 0.5, y1, zs, x1 + 0.5, y1 + 3, zt], pcs, ground: zs, shadow: false });
      break;
    }
    default: item = ST.plainLot(S, L, zs, "block").it;
  }
  return { item };
};

// =============================================================================
// On the street: slots, props, the description, the obstacle, life
// =============================================================================
// Places along the pavement and the road where a prop can stand, clear of the
// site's door and of each other.
ST.slots = function (S, F, g, siteOut) {
  // clear of what the service side stands outside the walls (never the back route's)
  const used = (siteOut.blocks || []).slice();
  const doorX = siteOut.entries.filter(e => e.kind === "front").map(e => e.x);
  const free = (x, y, r) => !used.some(u => Math.hypot(u[0] - x, u[1] - y) < u[2] + r) && !doorX.some(d => Math.abs(d - x) < 6 + r && y < (g.pave ? g.pave[1] : 8) + 2);
  const take = (zone, r, prefer) => {
    const z = g.zSite || 0;
    let cands = [];
    if (zone === "water" && g.water) { for (let x = F.X0 + 16; x < F.X1 - 16; x += 9) cands.push([x, g.water.y0 + 7, g.water.z]); }
    else if (zone === "road" && g.road) { for (let x = F.X0 + 20; x < F.X1 - 20; x += 7) for (const f of [0.2, 0.5, 0.8]) cands.push([x, g.road[0] + (g.road[1] - g.road[0]) * f, z]); }
    else if (zone === "lot") { for (const L of F.lots) if (L.kind !== "site") for (let i = 0; i < 2; i++) { const x = L.x0 - 2.5; cands.push([x, -8 - i * 12, z]); } }
    else if (zone === "passage") { for (const L of F.lots) if (L.kind === "site") { cands.push([L.x0 - 2.5, -4, z]); cands.push([L.x1 + 2.5, -4, z]); } }
    if (!cands.length || zone === "pave" || zone === "kerb") {
      const p = g.pave || [0, 8], yy = zone === "kerb" ? p[1] - 1.5 : p[0] + (p[1] - p[0]) * 0.55;
      for (let x = F.X0 + 14; x < F.X1 - 14; x += 6) cands.push([x, yy, z]);
    }
    cands = cands.filter(([x, y]) => free(x, y, r));
    if (!cands.length) return null;
    // prefer near the site, then spread out
    cands.sort((a, b) => Math.abs(a[0] - (prefer != null ? prefer : (F.site.x0 + F.site.x1) / 2)) - Math.abs(b[0] - (prefer != null ? prefer : (F.site.x0 + F.site.x1) / 2)));
    const pick = cands[Math.min(cands.length - 1, Math.floor(S.rng() * Math.min(2, cands.length)))];
    used.push([pick[0], pick[1], r]);
    return pick;
  };
  return { take, used, block: (x, y, r) => used.push([x, y, r]) };
};

ST.prop = function (S, F, name, g, slots, zs, prefer) {
  const spec = M.own(ST.PROP, name); if (!spec) return null;
  let zone = spec.z;
  if (zone === "water" && !g.water) zone = "pave";
  if (zone === "road" && !g.road) zone = "pave";
  const at = slots.take(zone, spec.d === "barge" || spec.d === "boats" ? 10 : 4, prefer);
  if (!at) return null;
  const [x, y, z] = at, D = M.own(ST.PROPS, spec.d);
  const r = D ? D(S, x, y, z, g, F) : null;
  return { pt: r && r.pt ? r.pt : [x, y, z + 3], size: (r && r.size) || 2.4 };
};

// Each prop: a few solids, drawn where it stands. pt is where its label points.
const PR = ST.PROPS = {};
const crate = (S, x, y, z, s, mat) => S.box(x - s / 2, y - s / 2, z, x + s / 2, y + s / 2, z + s, mat, null, { shadow: false });
PR.crates = (S, x, y, z) => { crate(S, x - 1.6, y, z, 3, "wood"); crate(S, x + 1.6, y, z, 3, "wood"); crate(S, x, y - 0.2, z + 3, 3, "wood"); return { pt: [x, y, z + 6] }; };
PR.bales = (S, x, y, z) => { S.box(x - 3, y - 1.6, z, x, y + 1.6, z + 2.8, "canvas", null, { shadow: false }); S.box(x, y - 1.6, z, x + 3, y + 1.6, z + 2.8, "canvas", null, { shadow: false }); S.box(x - 1.5, y - 1.6, z + 2.8, x + 1.5, y + 1.6, z + 5.4, "canvas", null, { shadow: false }); return { pt: [x, y, z + 5.4] }; };
PR.nets = (S, x, y, z) => { S.cyl(x - 1.4, y, 1.6, z, z + 0.9, "rope", { shadow: false }); S.cyl(x + 1.6, y + 0.4, 1.3, z, z + 0.8, "rope", { shadow: false }); S.box(x - 2.6, y - 2.2, z, x + 2.6, y - 1.4, z + 1.6, "net", null, { shadow: false }); return { pt: [x, y, z + 2] }; };
PR.cables = (S, x, y, z) => { S.cyl(x, y, 2, z, z + 3.6, "wood", { shadow: false }); S.cyl(x, y, 1.1, z + 3.6, z + 3.7, "dark", { shadow: false }); for (const dx of [3, 5]) S.cyl(x + dx, y + 1, 0.3, z, z + 3, "metal", { shadow: false }); return { pt: [x, y, z + 3.6] }; };
PR.pipes = (S, x, y, z) => { for (let i = 0; i < 4; i++) S.cyl(x - 4 + i * 0, y - 0.9 + i * 0.9, 0.42, z + 0.4, z + 1.2, "metal", { flatSide: true, shadow: false }); S.box(x - 4, y - 1.4, z, x + 4, y + 2.4, z + 0.8, "metal", null, { shadow: false }); return { pt: [x, y, z + 1.2] }; };
PR.pump = (S, x, y, z) => { S.box(x - 0.6, y - 0.6, z, x + 0.6, y + 0.6, z + 4.2, "iron", null, { shadow: false }); S.box(x - 0.2, y - 2.2, z + 3.4, x + 0.2, y, z + 3.8, "iron", null, { shadow: false }); S.decal(P.ellipse("st-g:puddle", x, y + 1.4, 1.8, 1.1), z); return { pt: [x, y, z + 4.2] }; };
PR.drums = (S, x, y, z) => { for (const [dx, dy] of [[-1.2, 0], [1.2, 0], [0, 1.9]]) S.cyl(x + dx, y + dy, 1.05, z, z + 3.2, "drum", { shadow: false }); return { pt: [x, y, z + 3.2] }; };
PR.coal = (S, x, y, z) => { PR.drums(S, x - 2.5, y, z); S.decal(P.ellipse("st-g:coal", x + 2.4, y + 0.6, 2.8, 1.8), z); S.cyl(x + 2.4, y + 0.6, 1.6, z, z + 1.2, "coal", { n: 7, shadow: false }); return { pt: [x, y, z + 3.2] }; };
PR.barrels = (S, x, y, z) => { for (const [dx, dy] of [[-1.3, 0], [1.3, 0.3]]) S.cyl(x + dx, y + dy, 1.2, z, z + 3.4, "wood", { shadow: false }); S.cyl(x, y + 2.2, 1.2, z, z + 2.4, "wood", { shadow: false }); return { pt: [x, y, z + 3.4] }; };
PR.buckets = (S, x, y, z) => { for (const [dx, dy] of [[-1, 0], [1, 0.3], [0, 1.6]]) S.cyl(x + dx, y + dy, 0.75, z, z + 1.5, "metal", { shadow: false }); S.box(x + 2, y - 1, z, x + 4.6, y + 1, z + 1.8, "concrete", null, { shadow: false }); return { pt: [x, y, z + 1.8] }; };
const pile = (S, x, y, z, mat, n, s) => { for (let i = 0; i < n; i++) { const dx = ((i * 37) % 7 - 3) * s * 0.5, dy = ((i * 17) % 5 - 2) * s * 0.5; crate(S, x + dx, y + dy, z + (i > n * 0.6 ? s : 0), s, mat); } };
PR.bricks = (S, x, y, z) => { pile(S, x, y, z, "brick", 6, 1.6); return { pt: [x, y, z + 3] }; };
PR.stones = (S, x, y, z) => { pile(S, x, y, z, "stone", 5, 2); return { pt: [x, y, z + 3.6] }; };
PR.ingots = (S, x, y, z) => { for (let i = 0; i < 3; i++) S.box(x - 2, y - 1 + i * 0.1, z + i * 0.6, x + 2, y + 1, z + i * 0.6 + 0.6, i % 2 ? "gold" : "metal", null, { shadow: false }); return { pt: [x, y, z + 1.8] }; };
PR.bars = (S, x, y, z) => { for (let i = 0; i < 4; i++) S.box(x - 4, y - 1.2 + i * 0.7, z, x + 4, y - 0.8 + i * 0.7, z + 0.4 + (i % 2) * 0.4, "iron", null, { shadow: false }); return { pt: [x, y, z + 1] }; };
PR.boards = (S, x, y, z) => { for (let i = 0; i < 4; i++) S.box(x - 4, y - 1.6, z + i * 0.3, x + 4, y + 1.6, z + i * 0.3 + 0.3, "wood", null, { shadow: false }); S.box(x + 3, y - 2, z, x + 3.4, y + 2, z + 6, "wood", null, { shadow: false }); return { pt: [x, y, z + 1.4] }; };
PR.rocks = (S, x, y, z) => { for (let i = 0; i < 5; i++) S.cyl(x + ((i * 29) % 9 - 4), y + ((i * 13) % 5 - 2), 0.7 + (i % 3) * 0.3, z, z + 0.9, "rock", { n: 6, shadow: false }); return { pt: [x, y, z + 1] }; };
PR.rubble = (S, x, y, z) => { S.decal(P.ellipse("st-g:rubble", x, y, 5, 3), z); for (let i = 0; i < 6; i++) S.cyl(x + ((i * 31) % 7 - 3), y + ((i * 11) % 4 - 1.5), 0.8 + (i % 3) * 0.4, z, z + 1 + (i % 3) * 0.6, "rubblestone", { n: 6, shadow: false }); return { pt: [x, y, z + 2] }; };
PR.junk = (S, x, y, z) => { S.box(x - 2.4, y - 1, z, x, y + 1.2, z + 2.4, "metal", null, { shadow: false }); S.cyl(x + 1.6, y, 1.1, z, z + 0.5, "dark", { shadow: false }); S.box(x - 0.5, y + 1.3, z, x + 2.8, y + 2, z + 4, "wood", null, { shadow: false }); return { pt: [x, y, z + 2.6] }; };
PR.trash = (S, x, y, z) => { for (const [dx, dy] of [[-1, 0], [1.2, 0.4]]) S.box(x + dx - 1.1, y + dy - 1.1, z, x + dx + 1.1, y + dy + 1.1, z + 3.4, "bin", null, { shadow: false }); for (const [dx, dy, r] of [[2.8, 1.2, 1], [3.4, 2.6, 0.8], [-2.4, 2, 0.9]]) S.flat(P.circle("st-g:bag", x + dx, y + dy, r), z); S.decal(P.ellipse("st-g:puddle", x + 1, y + 2.6, 3, 1.2), z); return { pt: [x, y, z + 3.4] }; };
PR.refuse = (S, x, y, z) => { S.decal(P.ellipse("st-g:rot", x, y, 4, 2.4), z); for (const [dx, dy, r] of [[-1.4, 0, 1.1], [0.6, 0.6, 1.2], [1.9, -0.4, 0.9], [-0.2, 1.6, 0.8]]) S.flat(P.circle("st-g:bag", x + dx, y + dy, r), z); return { pt: [x, y, z + 1.2] }; };
PR.bins = (S, x, y, z) => { for (const dx of [-2.6, 0, 2.6]) S.box(x + dx - 1.1, y - 1.1, z, x + dx + 1.1, y + 1.1, z + 3.6, "bin", f => f.top(x + dx - 1.1, y - 1.1, x + dx + 1.1, y - 0.4, "st-d:dark"), { shadow: false }); return { pt: [x, y, z + 3.6] }; };
PR.carts = (S, x, y, z) => { for (const dx of [-2.4, 2.4]) { S.box(x + dx - 1.8, y - 1.2, z + 1, x + dx + 1.8, y + 1.2, z + 3, "wood", null, { shadow: false }); S.cyl(x + dx, y + 1.3, 0.8, z, z + 0.3, "dark", { shadow: false }); } return { pt: [x, y, z + 3] }; };
PR.lamps = (S, x, y, z) => { ST.lamps(S, x - 6, x + 6, y, z, 12); return { pt: [x, y, z + 15] }; };
PR.boxes = (S, x, y, z) => { for (const dx of [-1.4, 1.4]) S.box(x + dx - 1.1, y - 0.8, z, x + dx + 1.1, y + 0.8, z + 4.4, "metal", f => f.front(x + dx - 0.7, x + dx + 0.7, z + 3, z + 3.6, "st-d:hazard"), { shadow: false }); return { pt: [x, y, z + 4.4] }; };
PR.post = (S, x, y, z) => { S.cyl(x, y, 1.1, z, z + 4.6, "post", { topMat: "post" }); S.box(x - 0.6, y + 0.7, z + 2.6, x + 0.6, y + 1.2, z + 3, "dark", null, { shadow: false }); return { pt: [x, y, z + 4.6] }; };
PR.monument = (S, x, y, z) => { S.box(x - 3, y - 3, z, x + 3, y + 3, z + 2, "stone"); S.box(x - 1.4, y - 1.4, z + 2, x + 1.4, y + 1.4, z + 16, "stone"); ST.spire(S, x, y, z + 16, 1.4, 3); return { pt: [x, y, z + 19] }; };
PR.fountain = (S, x, y, z) => { S.cyl(x, y, 5, z, z + 1.6, "stone", { topMat: "water", shadow: false }); S.cyl(x, y, 1, z + 1.6, z + 5, "stone", { shadow: false }); const [sx, sy] = S.P0(x, y, z + 6.4); S.marks.push(P.ellipse("st-x:spray", sx, sy, 1.6, 1.2)); return { pt: [x, y, z + 6], size: 4 }; };
PR.stall = (S, x, y, z) => { ST.stall(S, x, y, z, "awning"); return { pt: [x, y, z + 8] }; };
PR.news = (S, x, y, z) => { S.box(x - 3.2, y - 1.6, z, x + 3.2, y + 1.6, z + 7.2, "kiosk", f => f.front(x - 2.6, x + 2.6, z + 2.2, z + 5.6, "st-d:papers")); return { pt: [x, y, z + 7.2] }; };
PR.grate = (S, x, y, z) => { S.decal(P.rect("st-g:grate", x - 2, y - 1.2, 4, 2.4), z); for (let i = 0; i < 5; i++) S.decal(P.rect("st-g:grate-bar", x - 1.8 + i * 0.85, y - 1, 0.3, 2), z); if (!S.night) S.marks.push(P.circle("st-x:steam", ...S.P0(x, y, z + 3), 1.8)); return { pt: [x, y, z + 0.5], size: 2.2 }; };
PR.puddles = (S, x, y, z) => { for (const [dx, dy, a, b] of [[-3, 0, 3.4, 1.4], [2.6, 1.4, 2.6, 1.1], [0, -1.6, 1.8, 0.8]]) S.decal(P.ellipse("st-g:mud", x + dx, y + dy, a, b), z); return { pt: [x, y, z + 0.4] }; };
PR.barricade = (S, x, y, z, g) => { const y0 = g.road ? g.road[0] + 2 : y - 4, y1 = g.road ? g.road[1] - 2 : y + 4; for (let yy = y0; yy < y1; yy += 3.4) S.box(x - 0.6, yy, z, x + 0.6, yy + 3, z + 3.4, "barrier", f => f.side(yy, yy + 3, z + 1.6, z + 2.4, "st-d:stripe"), { shadow: false }); return { pt: [x, (y0 + y1) / 2, z + 3.4], size: 3 }; };
PR.gate = (S, x, y, z) => { S.box(x - 0.3, y - 3, z, x + 0.3, y + 3, z + 7, "iron", f => { for (let u = y - 2.6; u < y + 3; u += 0.8) f.side(u, u + 0.14, z, z + 7, "st-d:grille"); }, { shadow: false }); return { pt: [x, y, z + 7] }; };
PR.checkpoint = (S, x, y, z, g) => { S.box(x - 2, y - 2, z, x + 2, y + 2, z + 8, "booth", f => f.front(x - 1.4, x + 1.4, z + 4, z + 6.4, S.night ? "st-d:winlit" : "st-d:glass")); const y1 = g.road ? g.road[1] - 1 : y + 10; S.box(x - 0.3, y + 2, z + 3.4, x + 0.3, y1, z + 4, "barrier", f => { for (let u = y + 2; u < y1; u += 2) f.side(u, u + 1, z + 3.4, z + 4, "st-d:stripe"); }, { shadow: false }); return { pt: [x, y, z + 8] }; };
PR.boats = (S, x, y, z) => { for (const dx of [-12, 0, 13]) ST.boat(S, x + dx, y, z, 9, "boat"); return { pt: [x, y, z + 2], size: 4 }; };
PR.gondolas = (S, x, y, z) => { for (const dx of [-8, 8]) ST.boat(S, x + dx, y + 1, z, 11, "gondola", { thin: true }); return { pt: [x, y, z + 2], size: 4 }; };
PR.barge = (S, x, y, z) => { S.box(x - 16, y - 3.5, z - 1, x + 16, y + 3.5, z + 2.4, "barge", f => { f.top(x - 13, y - 2.6, x + 6, y + 2.6, "st-d:cargo"); }); S.box(x + 8, y - 2.4, z + 2.4, x + 14, y + 2.4, z + 6.4, "barge", f => f.front(x + 9, x + 13, z + 4, z + 5.6, "st-d:win")); return { pt: [x, y, z + 6], size: 5 }; };
PR.lock = (S, x, y, z, g) => { const y0 = g.water ? g.water.y0 : y - 8, y1 = g.water ? g.water.y1 : y + 8; for (const dx of [-6, 6]) S.box(x + dx - 0.8, y0, z - 1, x + dx + 0.8, y1, z + 5, "wood", f => f.top(x + dx - 0.8, y0, x + dx + 0.8, y1, "st-d:dark")); S.decal(P.rect("st-g:waterhigh", x - 5.2, y0, 10.4, y1 - y0), z); return { pt: [x, (y0 + y1) / 2, z + 5], size: 4 }; };
PR.crane = (S, x, y, z) => { S.box(x - 1, y - 1, z, x + 1, y + 1, z + 26, "rust", null); S.box(x - 1, y - 1, z + 24, x + 1, y + 16, z + 26, "rust", null, { shadow: false }); const [a, b] = S.P0(x, y + 14, z + 24), [c, d] = S.P0(x, y + 14, z + 10); S.marks.push(P.line("st-x:wire", a, b, c, d, { sw: 0.2 })); crate(S, x, y + 14, z + 7, 3, "wood"); return { pt: [x, y, z + 26] }; };
PR.spotlight = (S, x, y, z) => { S.box(x - 1.2, y - 1.2, z, x + 1.2, y + 1.2, z + 30, "iron"); S.box(x - 3, y - 2, z + 30, x + 3, y + 2, z + 33, "iron", f => f.front(x - 2.4, x + 2.4, z + 30.6, z + 32.4, S.night ? "st-d:signlit" : "st-d:glass")); if (S.night) S.decal(P.ellipse("st-g:pool1", x + 2, y + 16, 12, 8), z); return { pt: [x, y, z + 33] }; };
PR.clock = (S, x, y, z) => { S.box(x - 3.4, y - 3.4, z, x + 3.4, y + 3.4, z + 40, "stone", f => { f.front(x - 2.4, x + 2.4, z + 32, z + 37, "st-d:clock"); f.side(y - 2.4, y + 2.4, z + 32, z + 37, "st-d:clock"); }); ST.spire(S, x, y, z + 40, 3.4, 8); return { pt: [x, y, z + 48] }; };
PR.collapse = (S, x, y, z) => { S.decal(P.rect("st-g:lot", x - 6, y - 12, 12, 24), z); S.box(x - 5, y - 10, z, x - 4, y + 2, z + 14, "brick"); S.box(x - 5, y - 11, z, x + 4, y - 10, z + 9, "brick"); PR.rubble(S, x, y + 3, z); return { pt: [x, y, z + 6], size: 4 }; };
PR.hovel = (S, x, y, z) => { S.box(x - 4, y - 3.5, z, x + 4, y + 3.5, z + 7, "wood", f => f.front(x - 1, x + 1.4, z, z + 5.6, "st-d:dark")); S.box(x - 4.6, y - 4, z + 7, x + 4.6, y + 4, z + 7.5, "rust", null, { shadow: false }); return { pt: [x, y, z + 7.5] }; };
PR.wires = (S, x, y, z) => {
  const zt = 22, pts = [];
  for (const px of [x - 30, x, x + 30]) { S.box(px - 0.4, y - 0.4, z, px + 0.4, y + 0.4, z + zt, "wood", null, { shadow: false }); pts.push(S.P0(px, y, z + zt - 1)); }
  for (let i = 0; i < pts.length - 1; i++) for (const dz of [0, 1.4]) { const a = pts[i], b = pts[i + 1]; S.marks.push(P.path("st-x:wire", `M${a[0]} ${a[1] + dz} Q${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2 + 3 + dz} ${b[0]} ${b[1] + dz}`, { box: [a, b] })); }
  return { pt: [x, y, z + zt] };
};
ST.stall = function (S, x, y, z, canvas) {
  S.box(x - 3.4, y - 1.6, z, x + 3.4, y + 1.6, z + 3.4, "wood", f => f.top(x - 3, y - 1.2, x + 3, y + 1.2, "st-d:goods"), { shadow: false });
  for (const dx of [-3.2, 3.2]) S.box(x + dx - 0.15, y - 1.6, z + 3.4, x + dx + 0.15, y - 1.3, z + 7.4, "wood", null, { shadow: false });
  S.box(x - 3.8, y - 2.4, z + 7.4, x + 3.8, y + 2.4, z + 8, canvas, f => { for (let u = x - 3.8; u < x + 3.8; u += 1.9) f.front(u, u + 0.95, z + 7.4, z + 8, "st-d:stripe"); }, { shadow: false });
};
ST.boat = function (S, x, y, z, L, mat, o = {}) {
  const w = o.thin ? 2.4 : 4, pts = [[x - L / 2, y - w / 2], [x + L / 2 - 2, y - w / 2], [x + L / 2, y], [x + L / 2 - 2, y + w / 2], [x - L / 2, y + w / 2]];
  S.prism(pts, z - 0.6, z + 1.4, mat, { topMat: o.thin ? "dark" : "deckwood", shadow: false });
};
ST.tree = function (S, x, y, zs) { S.cyl(x, y, 0.5, zs, zs + 7, "wood", { shadow: false }); S.cyl(x, y, 4.2, zs + 6, zs + 12, "tree"); };
ST.pylon = function (S, cx, cy, zs, h) {
  const pcs = [], b = 4, t = 1.2;
  const P0 = S.P0;
  for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pcs.push(P.line("st-x:pole", ...P0(cx + dx * b, cy + dy * b, zs), ...P0(cx + dx * t, cy + dy * t, zs + h), { sw: 0.35 }));
  for (let z = zs + 6; z < zs + h; z += 6) { const r = b - (b - t) * (z - zs) / h; pcs.push(P.line("st-x:pole", ...P0(cx - r, cy + r, z), ...P0(cx + r, cy + r, z), { sw: 0.2 }), P.line("st-x:pole", ...P0(cx + r, cy - r, z), ...P0(cx + r, cy + r, z), { sw: 0.2 })); }
  for (const z of [zs + h * 0.7, zs + h * 0.88]) pcs.push(P.line("st-x:pole", ...P0(cx - 9, cy, z), ...P0(cx + 9, cy, z), { sw: 0.35 }));
  S.add({ b: [cx - b, cy - b, zs, cx + b, cy + b, zs + h], pcs, ground: zs, shadow: false });
};

// The street description, where it stands on the street.
ST.descStreet = function (S, F, desc, g, slots) {
  const zs = g.zSite || 0;
  switch (desc.k) {
    case "statue": {
      const at = slots.take("pave", 5, F.site.x0 - 18) || [F.site.x0 - 18, 6, zs];
      const [x, y, z] = at;
      S.box(x - 2.2, y - 2.2, z, x + 2.2, y + 2.2, z + 6, "stone", f => { f.front(x - 1.7, x + 0.4, z + 1, z + 3.4, "st-d:graffiti"); f.side(y - 1.6, y + 1, z + 2.2, z + 4.4, "st-d:graffiti"); });
      const [sx, sy] = S.P0(x, y, z + 6);
      S.add({ b: [x - 1.2, y - 1.2, z + 6, x + 1.2, y + 1.2, z + 17], ground: z, shadow: true, foot: [[x - 1, y - 1], [x + 1, y - 1], [x + 1, y + 1], [x - 1, y + 1]], pcs: [
        P.path("st-f:bronze", `M${sx - 1.6} ${sy} L${sx - 1.1} ${sy - 7.2} Q${sx} ${sy - 8.4} ${sx + 1.1} ${sy - 7.2} L${sx + 1.7} ${sy} Z`, { box: [[sx - 1.7, sy - 8.4], [sx + 1.7, sy]] }),
        P.circle("st-f:bronze", sx, sy - 9.2, 1.2), P.rect("st-f:bronze", sx + 0.8, sy - 10.6, 0.6, 4.6),
        P.circle("st-d:birdshit", sx - 0.4, sy - 10, 0.35), P.circle("st-d:birdshit", sx + 0.5, sy - 9.6, 0.3), P.circle("st-d:birdshit", sx - 1, sy - 6.6, 0.3)] });
      for (const [dx, dy] of [[-5, 1], [-6.5, 3], [4, -1.5], [5.2, 2], [-3, 4.4]]) S.flat(P.circle("st-g:pigeon", x + dx, y + dy, 0.45), z);
      return { pt: [x, y, z + 17], size: 3 };
    }
    case "vendor": {
      const at = slots.take("pave", 5, F.site.x1 + 14) || [F.site.x1 + 14, 6, zs];
      const [x, y, z] = at, pts = [];
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) pts.push([x + Math.cos(a) * 3.4, y + Math.sin(a) * 2.6]);
      const k = S.prism(pts, z, z + 7.4, "plastic", { topMat: "awning" });
      k.pcs.push(P.poly("st-d:shoplit", [S.P0(x - 2, y + 2.6, z + 3), S.P0(x + 2, y + 2.6, z + 3), S.P0(x + 2, y + 2.6, z + 5.6), S.P0(x - 2, y + 2.6, z + 5.6)]));
      S.person(x + 1, y + 4.4, z, "crowd2");
      return { pt: [x, y, z + 7.4] };
    }
    case "poles": {
      const y = g.pave ? g.pave[1] - 2.4 : 6, pts = [];
      for (let x = F.X0 + 26; x < F.X1 - 20; x += 44) {
        S.box(x - 0.45, y - 0.45, zs, x + 0.45, y + 0.45, zs + 26, "wood", null, { shadow: false });
        S.box(x - 2.6, y - 0.3, zs + 23.4, x + 2.6, y + 0.3, zs + 24, "wood", null, { shadow: false });
        S.cyl(x + 1.6, y + 0.9, 1, zs + 18, zs + 21.4, "metal", { shadow: false });
        pts.push(x);
      }
      for (let i = 0; i < pts.length - 1; i++) for (const dx of [-2.2, 0, 2.2]) { const a = S.P0(pts[i] + dx, y, zs + 24), b = S.P0(pts[i + 1] + dx, y, zs + 24); S.marks.push(P.path("st-x:wire", `M${a[0]} ${a[1]} Q${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2 + 2.6} ${b[0]} ${b[1]}`, { box: [a, b] })); }
      const mid = pts[Math.floor(pts.length / 2)] || 0;
      return { pt: [mid, y, zs + 26] };
    }
  }
  return null;
};

// --- Sightlines: the front door and the service side are never hidden -------------------------------
// [interpretation] What the reader is shown the way in by stays in sight: the
// front door, and the service side's door, window, steps, stair or hatch with
// its arrow's tip. The obstacle moves along the street until none of its solids
// stands in front of them; one of a crowd, a passer-by or a parked autopod that
// would is left out. The back route is never kept in sight, so the player copy,
// which hasn't got one, draws the same street.
ST.keep = siteOut => siteOut.taken.filter(t => t.kind === "front" || t.kind === "service").flatMap(t => (t.marks || []).concat(t.tip ? [t.tip] : []));
// Does this solid stand in front of the point pt and cover it on the page?
ST.hides = function (S, it, pt) {
  const s = S.V.proj(pt[0], pt[1], pt[2]), sg = S.V.sideSign, b = it.b;
  if (!ST.covers(it, s[0], s[1], 0.4)) return false;
  return Math.max(b[0] * sg, b[3] * sg) + b[4] > pt[0] * sg + pt[1] + 0.2;
};
// The obstacle on its stage, moved along the street (up to 48 ft either way, never off it)
// until none of its solids stands in front of what is kept in sight.
ST.stageObstacle = function (S, F, d, g, zs, keep) {
  const snap = { items: S.items.length, marks: S.marks.length, decals: new Map([...S.decals].map(([z, a]) => [z, a.length])), furn: new Map([...S.furn].map(([z, a]) => [z, a.length])) };
  const undo = () => {
    S.items.length = snap.items; S.marks.length = snap.marks;
    for (const [m, n0] of [[S.decals, snap.decals], [S.furn, snap.furn]]) for (const z of [...m.keys()]) { if (n0.has(z)) m.get(z).length = n0.get(z); else m.delete(z); }
  };
  // a set piece in the way counts for a whole crowd; one of a crowd for one
  const blocked = () => S.items.slice(snap.items).reduce((s, it) => s + (keep.some(pt => ST.hides(S, it, pt)) ? (it.loose ? 1 : 100) : 0), 0);
  const base = S.rng, room = (F.X1 - F.X0) / 2 - Math.min(g.stage.w || 40, F.X1 - F.X0) / 2, mid = (F.X0 + F.X1) / 2;
  const build = (off, rng) => { S.rng = rng; const st = Object.assign({}, g.stage, { x: g.stage.x + off }); const out = ST.obstacle(S, F, d, Object.assign({}, g, { stage: st }), zs); S.rng = base; return { out, st }; };
  let res = build(0, base.fork("obstacle")), n = blocked(), best = { off: 0, n };
  if (n) {
    for (const off of [12, -12, 24, -24, 36, -36, 48, -48]) {
      if (Math.abs(g.stage.x + off - mid) > room) continue;
      undo(); res = build(off, base.fork("obstacle")); n = blocked();
      if (n < best.n) best = { off, n };
      if (!n) break;
    }
    // nowhere clear: where the least is hidden
    if (n && best.n < n) { undo(); res = build(best.off, base.fork("obstacle")); }
  }
  g.stage = res.st;
  return res.out;
};
// One of a crowd, a passer-by or a parked autopod (added from `from` on) that stands in front of
// what is kept in sight is left out; an autopod goes whole, with its lights.
ST.sightlines = function (S, keep, from) {
  const gone = new Set();
  for (let i = from; i < S.items.length; i++) { const it = S.items[i]; if ((it.loose || it.life) && keep.some(pt => ST.hides(S, it, pt))) gone.add(it.grp || it); }
  if (!gone.size) return;
  const lights = new Set([...gone].flatMap(g => g.lights || []));
  for (let i = S.items.length - 1; i >= from; i--) if (gone.has(S.items[i].grp || S.items[i])) S.items.splice(i, 1);
  if (lights.size) for (let i = S.marks.length - 1; i >= 0; i--) if (lights.has(S.marks[i])) S.marks.splice(i, 1);
};

// Litter at the site's door when it is run down, a shimmer at its foot when it is strange.
ST.siteFoot = function (S, F, zs, site) {
  const L = S.looks; if (!L || !(L.litter || L.strange)) return;
  const r = S.looksRng, x0 = F.site.x0, x1 = F.site.x1, z = zs;
  if (L.litter) for (let i = 0; i < 26; i++) {
    const x = x0 + 1 + r() * (x1 - x0 - 2), y = 0.3 + r() * 3.4;
    S.decal(P.rect(i % 3 ? "st-g:debris" : (i % 2 ? "st-g:tuft1" : "st-g:rot"), x, y, 0.9 + r() * 1.4, 0.6 + r() * 0.8), z);
  }
  if (L.strange) {
    S.decal(P.poly("st-g:anomaly1", [[x0 - 2, -0.5], [x1 + 2, -0.5], [x1 + 2, 4.5], [x0 - 2, 4.5]]), z);
    S.decal(P.poly("st-g:anomaly2", [[x0 + 2, 0], [x1 - 2, 0], [x1 - 2, 2.2], [x0 + 2, 2.2]]), z);
  }
};
// [interpretation] The obstacle's ground: the stretch of street it holds, washed in the
// lock colour from building line to building line, with a dashed edge where it begins and
// ends. It is the front's cost (p.420), so it is drawn in every copy: it is free to know.
// The set piece still stands on it; this only says how much of the street it takes.
ST.obstacleGround = function (S, F, g, zs) {
  const st = g.stage, z = st.z || zs;
  const half = Math.min(st.w || 40, F.X1 - F.X0 - 8) / 2 + 4;
  const x0 = Math.max(F.X0 + 2, st.x - half), x1 = Math.min(F.X1 - 2, st.x + half);
  // across the whole street where it has pavements; on a deck, a plaza or a towpath, the stage's own depth
  const ys = [st.y - st.h / 2, st.y + st.h / 2];
  for (const span of [g.pave, g.road, g.farPave]) if (span && span.length === 2 && span[0] != null && span[1] != null) { ys[0] = Math.min(ys[0], span[0]); ys[1] = Math.max(ys[1], span[1]); }
  if (g.far != null && g.farPave) ys[1] = Math.min(ys[1], g.far);
  if (!(x1 - x0 > 4 && ys[1] - ys[0] > 2)) return null;
  S.decal(P.poly("st-g:obzone", [[x0, ys[0]], [x1, ys[0]], [x1, ys[1]], [x0, ys[1]]]), z);
  return { x0, x1, y0: ys[0], y1: ys[1] };
};
// The obstacle (p.420), set on the street's stage. pt is where its label points.
ST.obstacle = function (S, F, d, g, zs) {
  const st = g.stage, rng = S.rng, x = st.x, y = st.y, z = st.z || zs;
  const crowd = (cx, cy, rx, ry, n, o = {}) => {
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng());
      const px = cx + Math.cos(a) * r * rx, py = cy + Math.sin(a) * r * ry;
      if (o.clip && !o.clip(px, py)) continue;
      S.person(px, py, z, o.role && rng() < o.share ? o.role : "crowd", { sign: o.signs && rng() < o.signs, loose: true });
    }
  };
  const inRoad = (px, py) => !g.road || (py > g.road[0] + 0.8 && py < g.road[1] - 0.8);
  const tape = (xa, ya, xb, yb) => { const a = S.P0(xa, ya, z + 3.2), b = S.P0(xb, yb, z + 3.2); S.marks.push(P.line("st-x:tape", a[0], a[1], b[0], b[1], { sw: 0.5 })); for (const [px, py] of [[xa, ya], [xb, yb]]) S.box(px - 0.3, py - 0.3, z, px + 0.3, py + 0.3, z + 3.6, "barrier", null, { shadow: false }); };
  const span = g.road || [y - st.h / 2, y + st.h / 2];
  switch (d) {
    case "riot": {
      ST.autopod(S, x + 12, y - 1, z, false, "podburnt", { tipped: true });
      const [fx, fy] = S.P0(x + 12, y - 1, z + 5.6), fire = [];
      if (S.night) fire.push(P.circle("st-x:fireglow", fx, fy - 1, 8), P.circle("st-x:fireglow2", fx, fy - 1, 4.4));
      fire.push(P.path("st-x:flame", `M${fx - 2.2} ${fy} Q${fx - 2.6} ${fy - 4} ${fx - 0.6} ${fy - 7.2} Q${fx - 0.2} ${fy - 4.6} ${fx + 0.6} ${fy - 4.2} Q${fx + 1.4} ${fy - 6.8} ${fx + 1.2} ${fy - 9} Q${fx + 3.6} ${fy - 5} ${fx + 2.4} ${fy} Z`, { box: [[fx - 2.6, fy - 9], [fx + 3.6, fy]] }));
      fire.push(P.path("st-x:flamecore", `M${fx - 1} ${fy} Q${fx - 1} ${fy - 2.6} ${fx + 0.2} ${fy - 4.4} Q${fx + 1.6} ${fy - 2.6} ${fx + 1.2} ${fy} Z`, { box: [[fx - 1, fy - 4.4], [fx + 1.6, fy]] }));
      S.add({ b: [x + 9, y - 4, z + 5.4, x + 15, y + 2, z + 14], pcs: fire, ground: z, shadow: false });
      crowd(x - 6, y, 20, (span[1] - span[0]) / 2.6, 90, { clip: inRoad, role: "crowd2", share: 0.12, signs: 0.08 });
      for (const [dx, dy] of [[-24, -3], [-20, 4], [24, 3], [18, -4], [-30, 1]]) S.decal(P.rect("st-g:debris", x + dx, y + dy, 1.4, 0.9), z);
      return { pt: [x - 6, y, z + 8], size: 6 };
    }
    case "protest": {
      crowd(x - 4, y, 18, (span[1] - span[0]) / 2.8, 60, { clip: inRoad, signs: 0.35 });
      ST.autopod(S, x + 20, y, z, true, "van", { L: 13 });
      S.box(x + 17, y - 1, z + 4.6, x + 19, y + 1, z + 6.4, "metal", f => f.front(x + 17.4, x + 18.6, z + 4.8, z + 6.2, "st-d:dark"), { shadow: false });
      return { pt: [x - 4, y, z + 8], size: 6 };
    }
    case "parade": {
      for (const [dx, m] of [[-26, "float"], [0, "float2"], [26, "float"]]) { S.box(x + dx - 7, y - 4, z, x + dx + 7, y + 4, z + 4.4, m, f => { for (let u = x + dx - 7; u < x + dx + 7; u += 2) f.front(u, u + 1, z + 3.4, z + 4.4, "st-d:stripe"); }); S.box(x + dx - 3, y - 2, z + 4.4, x + dx + 3, y + 2, z + 10, m); }
      const p = g.pave || [0, 8];
      for (let px = F.X0 + 20; px < F.X1 - 20; px += 2.3) if (Math.abs(px - x) < 60) { S.person(px, p[1] - 1.4, z, rng() < 0.3 ? "crowd2" : "crowd", { loose: true }); if (g.farPave) S.person(px + 1.1, g.farPave[0] + 1.4, z, "crowd", { loose: true }); }
      const a = S.P0(x - 40, y - 6, z + 18), b = S.P0(x + 40, y - 6, z + 18);
      S.marks.push(P.path("st-x:bunting", `M${a[0]} ${a[1]} Q${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2 + 5} ${b[0]} ${b[1]}`, { box: [a, b] }));
      return { pt: [x, y, z + 10], size: 6 };
    }
    case "performers": {
      for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; S.person(x + Math.cos(a) * 7, y + Math.sin(a) * 4.4, z, i % 4 ? "crowd" : "crowd2", { loose: true }); }
      S.person(x - 1, y, z, "performer", { h: 6.6 }); S.person(x + 1.6, y + 0.4, z, "performer2", { h: 7.6 });
      S.cyl(x + 3, y - 1.4, 0.6, z, z + 0.6, "dark", { shadow: false });
      return { pt: [x, y, z + 8], size: 5 };
    }
    case "evangelist": {
      S.box(x - 1.4, y - 1.1, z, x + 1.4, y + 1.1, z + 2.2, "wood", null, { shadow: false });
      S.person(x, y, z + 2.2, "crowd2", { h: 6.4 });
      for (let i = 0; i < 10; i++) { const a = Math.PI * 0.15 + i / 10 * Math.PI * 0.7; S.person(x + Math.cos(a) * 8, y + Math.sin(a) * 5, z, "crowd", { loose: true }); }
      return { pt: [x, y, z + 9], size: 4 };
    }
    case "jam": {
      const lanes = g.lanes && g.lanes.length ? g.lanes : [{ y, dir: 1 }];
      for (const L of lanes) for (let px = F.X0 + 14; px < F.X1 - 14; px += 13.5) ST.autopod(S, px + (L.dir > 0 ? 0 : 6), L.y, z, true, ["pod1", "pod2", "pod3", "van"][Math.floor(rng() * 4)], { lights: true });
      return { pt: [x, lanes[0].y, z + 5], size: 6 };
    }
    case "construction": {
      // scaffold, hoarding, a crane (the pitch's set piece, p.420)
      const hx0 = x - 22, hx1 = x + 22, hy = g.road ? g.road[0] + 1 : y - 3;
      S.box(hx0, hy, z, hx1, hy + 1, z + 8, "hoarding", f => { for (let u = hx0; u < hx1; u += 8) f.front(u + 0.5, u + 7.5, z + 1, z + 7, "st-d:poster"); });
      for (let i = 0; i < 4; i++) S.box(x - 15 + i * 7, hy + 4, z, x - 12 + i * 7, hy + 6, z + 3.2, "barrier", f => f.front(x - 15 + i * 7, x - 12 + i * 7, z + 1.4, z + 2.2, "st-d:stripe"), { shadow: false });
      PR.rubble(S, x + 8, hy + 8, z); PR.bricks(S, x - 6, hy + 8, z);
      // a scaffold tower behind the hoarding
      const pcs = [], sx0 = x - 18, sx1 = x - 6, zt = z + 24;
      for (let u = sx0; u <= sx1; u += 6) pcs.push(P.line("st-x:pole", ...S.P0(u, hy + 0.5, z), ...S.P0(u, hy + 0.5, zt), { sw: 0.3 }));
      for (let zz = z + 6; zz <= zt; zz += 6) { pcs.push(P.line("st-x:pole", ...S.P0(sx0, hy + 0.5, zz), ...S.P0(sx1, hy + 0.5, zz), { sw: 0.3 })); pcs.push(P.poly("st-x:plank", [S.P0(sx0, hy - 2, zz), S.P0(sx1, hy - 2, zz), S.P0(sx1, hy + 0.5, zz), S.P0(sx0, hy + 0.5, zz)])); }
      S.add({ b: [sx0, hy - 2, z, sx1, hy + 0.6, zt], pcs, ground: z, shadow: false });
      // a tower crane: its mast beside the road, its jib over it
      const cx = x + 18, cy = hy + 3;
      S.box(cx - 1, cy - 1, z, cx + 1, cy + 1, z + 44, "hazard", f => { for (let zz = z + 3; zz < z + 44; zz += 3) f.front(cx - 1, cx + 1, zz, zz + 0.3, "st-d:dark"); });
      S.box(cx - 10, cy - 0.8, z + 44, cx + 26, cy + 0.8, z + 46, "hazard", null, { shadow: false });
      S.box(cx - 10, cy - 1.6, z + 41, cx - 5, cy + 1.6, z + 44, "concrete", null, { shadow: false });
      const [ja, jb] = S.P0(cx + 20, cy, z + 44), [ka, kb] = S.P0(cx + 20, cy, z + 26);
      S.marks.push(P.line("st-x:wire", ja, jb, ka, kb, { sw: 0.2 }));
      crate(S, cx + 20, cy, z + 22, 3, "wood");
      return { pt: [x, hy + 6, z + 9], size: 6 };
    }
    case "gangs": {
      crowd(x - 16, y, 5, 4, 9, { clip: inRoad, role: "crowd2", share: 1 });
      crowd(x + 16, y, 5, 4, 9, { clip: inRoad });
      ST.autopod(S, x, y + 1, z, false, "pod2", { tipped: true });
      return { pt: [x, y, z + 7], size: 6 };
    }
    case "paranormal": {
      for (const [r, role] of [[11, "anomaly1"], [7, "anomaly2"], [3.6, "anomaly3"]]) S.decal(P.ellipse("st-g:" + role, x, y, r * 1.3, r), z);
      const [sx, sy] = S.P0(x, y, z + 7);
      S.add({ b: [x - 3, y - 3, z, x + 3, y + 3, z + 14], pcs: [P.ellipse("st-x:anomaly", sx, sy, 3.2, 7), P.ellipse("st-x:anomaly2", sx, sy, 1.4, 4.6)], ground: z, shadow: false });
      return { pt: [x, y, z + 14], size: 6 };
    }
    case "checkpoint": {
      const cx = F.site.x0 - 20;
      S.box(cx - 2.4, (span[0] + span[1]) / 2 - 2.4 - (span[1] - span[0]) / 2 + 2, z, cx + 2.4, (span[0] + span[1]) / 2 - (span[1] - span[0]) / 2 + 6.8, z + 8.6, "booth", f => f.front(cx - 1.6, cx + 1.6, z + 4.4, z + 6.8, S.night ? "st-d:winlit" : "st-d:glass"));
      S.box(cx - 0.3, span[0] + 7, z + 3.4, cx + 0.3, span[1] - 1, z + 4, "barrier", f => { for (let u = span[0] + 7; u < span[1] - 1; u += 2) f.side(u, u + 1, z + 3.4, z + 4, "st-d:stripe"); }, { shadow: false });
      for (let i = 0; i < 3; i++) ST.autopod(S, cx - 14 - i * 13, span[0] + (span[1] - span[0]) * 0.7, z, true, ["pod1", "pod3", "pod2"][i], { lights: true });
      for (const [dx, dy] of [[3, 3], [3.6, 9], [-2.6, 12]]) S.person(cx + dx, span[0] + dy, z, "bluecoat");
      return { pt: [cx, (span[0] + span[1]) / 2, z + 9], size: 5 };
    }
    case "quarantine": {
      const ya = span[0] + 0.4, yb = span[1] - 0.4;
      for (const qx of [F.site.x0 - 10, F.site.x1 + 10]) for (let yy = ya; yy < yb; yy += 3.4) S.box(qx - 0.5, yy, z, qx + 0.5, yy + 3, z + 3.4, "barrier", f => f.side(yy, yy + 3, z + 1.6, z + 2.4, "st-d:stripe"), { shadow: false });
      tape(F.site.x0 - 10, ya, F.site.x0 - 10, yb); tape(F.site.x1 + 10, ya, F.site.x1 + 10, yb);
      const tx = x + 6, ty = (ya + yb) / 2;
      S.box(tx - 6, ty - 4, z, tx + 6, ty + 4, z + 6, "tent", f => f.front(tx - 1.4, tx + 1.4, z, z + 5, "st-d:dark"));
      S.add({ b: [tx - 6, ty - 4, z + 6, tx + 6, ty + 4, z + 9], pcs: [P.poly("st-t:tent", [S.P0(tx - 6, ty + 4, z + 6), S.P0(tx + 6, ty + 4, z + 6), S.P0(tx + 6, ty, z + 9), S.P0(tx - 6, ty, z + 9)]), P.poly("st-s:tent", [S.P0(S.V.flip ? tx - 6 : tx + 6, ty - 4, z + 6), S.P0(S.V.flip ? tx - 6 : tx + 6, ty + 4, z + 6), S.P0(S.V.flip ? tx - 6 : tx + 6, ty, z + 9)])], ground: z, shadow: false });
      for (const [dx, dy] of [[-9, -2], [-8, 3], [11, 1]]) S.person(tx + dx, ty + dy, z, "suit", { loose: true });
      return { pt: [tx, ty, z + 9], size: 6 };
    }
    case "flood": {
      const ya = g.road ? g.road[0] - 1 : 0, yb = g.road ? g.road[1] + 1 : st.y + st.h / 2;
      S.decal(P.rect("st-g:flood", F.X0, ya, F.X1 - F.X0, yb - ya), z);
      for (let px = F.X0 + 8; px < F.X1; px += 11) S.decal(P.rect("st-g:ripple", px + ((px * 7) % 5), ya + 2 + ((px * 13) % Math.max(2, yb - ya - 4)), 3.2, 0.3), z);
      ST.autopod(S, x - 20, (ya + yb) / 2, z - 1.4, true, "pod1");
      ST.boat(S, x + 12, (ya + yb) / 2, z + 0.2, 9, "boat");
      return { pt: [x, (ya + yb) / 2, z + 3], size: 6 };
    }
  }
  return null;
};

// People on the pavements, autopods at the kerbs and in the lanes.
ST.streetLife = function (S, F, g, o) {
  const n0 = S.items.length;
  ST.streetLife1(S, F, g, o);
  for (let i = n0; i < S.items.length; i++) S.items[i].life = true;
};
ST.streetLife1 = function (S, F, g, o) {
  const rng = S.rng, z = g.zSite || 0, busyObstacle = /Traffic jam|Parade|Street closed by flooding/.test(o.obstacle || "");
  const people = Math.round((g.people || 4) * (S.night ? 0.6 : 1));
  const p = g.pave || [0, 6];
  for (let i = 0; i < people; i++) {
    const x = F.X0 + 20 + rng() * (F.X1 - F.X0 - 40), y = p[0] + 2 + rng() * Math.max(0.5, p[1] - p[0] - 4);
    if (Math.abs(x - (F.site.x0 + F.site.x1) / 2) < 4) continue;
    S.person(x, y, z, rng() < 0.2 ? "crowd2" : "walker");
  }
  if (g.lower) for (let i = 0; i < 3; i++) S.person(F.X0 + 30 + rng() * (F.X1 - F.X0 - 60), g.lower.pave[0] + 2 + rng() * 3, g.lower.z, "walker");
  if (g.lower && g.lower.road) for (let i = 0; i < 3; i++) ST.autopod(S, F.X0 + 40 + i * 40 + rng() * 10, g.lower.road[0] + 4, g.lower.z, true, ["pod1", "pod2", "pod3"][i]);
  if (!busyObstacle) {
    if (g.kerb != null) for (let i = 0; i < 3; i++) { const x = F.X0 + 30 + i * ((F.X1 - F.X0 - 60) / 3) + rng() * 10; if (x > g.stage.x - g.stage.w / 2 - 8 && x < g.stage.x + g.stage.w / 2 + 8) continue; ST.autopod(S, x, g.kerb, z, true, ["pod1", "pod2", "pod3"][i % 3]); }
    for (let i = 0; i < (g.traffic || 0); i++) {
      const L = g.lanes[i % Math.max(1, g.lanes.length)]; if (!L) break;
      const x = F.X0 + 20 + rng() * (F.X1 - F.X0 - 40);
      if (x > g.stage.x - g.stage.w / 2 - 8 && x < g.stage.x + g.stage.w / 2 + 8) continue;
      ST.autopod(S, x, L.y, z, true, ["pod1", "pod2", "pod3", "van"][Math.floor(rng() * 4)], { lights: true });
    }
    if (g.ring) for (let i = 0; i < 3; i++) { const a = rng() * Math.PI * 2, r = (g.ring.r + g.island.r) / 2; ST.autopod(S, g.ring.x + Math.cos(a) * r, g.ring.y + Math.sin(a) * r, z, Math.abs(Math.sin(a)) > 0.7, ["pod1", "pod2", "pod3"][i], { lights: true }); }
  }
};

// ---- src/render.js ----
// =============================================================================
// render — the public API
// =============================================================================
//   B68Map.render(o, opts) → { svg, width, height, warnings, model, layout, seed, floorPx }
//
//   o      the vault generator's location object (generate()'s return value)
//   opts   view    "iso" (default) | "plan" | "rings" | "section"
//          theme   "rulebook" (default) | "blueprint" | "casefile" | "board"
//          layer   "gm" (default) | "player"
//          reveal  bands the player layer shows, default ["public"]. Pass the
//                  bands the crew has opened, as the card's band headers open.
//          layout  where it will be seen: "sheet" (default) | "phone" | "screen" | "ipad"
//                  | "print" | "drawing" (see M.PRESETS)
//          displayWidth  the width it is shown at, in CSS px (defaults to the
//                  preset's, or width); type is sized for this width
//          minLabelPx    the type floor at displayWidth (preset's; 10 px default)
//          floor   one floor per sheet: 0, -1, 1, 2 or "basement", "ground"…
//          paper   "A4" (default) | "letter", for layout "print"
//          seed    layout seed; defaults to o.seed, then a hash of the name,
//                  so the same roll always draws the same building
//          width   output width in px (the preset's; 1400 for the sheet)
//          legend  false drops the key (layout "drawing" does too)
//          tokens  [{ room, svg, label }] — figure-kit portraits (or any SVG)
//                  pinned into rooms; on the board theme they become polaroids
//          figures { kit: B68Figure, cast: [{ room, spec, label }] } — the kit
//                  renders portraits itself (K.portrait(spec))
//          grain   false switches texture off (faster in big batches, smaller PDFs)

M.VIEWS = ["iso", "plan", "rings", "section", "street"];

// --- Where the map will be seen ---------------------------------------------------
// The width a map is shown at decides how big its type must be. A preset gives
// the file's pixel width, the width it is shown at (CSS px: a phone is about
// 390 px wide whatever its pixel density), the type floor at that width, where
// the key goes and the page's shape. No word on the sheet is set under the
// floor: a room name that can't fit its room at the floor becomes its number
// (a pin) and the key carries the name.
//   sheet    the v0.2 sheet, 1400 px, key beside or below            (default)
//   phone    390 px wide, key below, floor 10 px
//   screen   a laptop or TV across the table: 16:9, key beside, floor 16 px
//   print    A4 (or paper: "letter") portrait at 300 dpi, floor 7 pt (29 px)
//   drawing  the drawing alone, no key (typeset it with B68Map.key)
M.PRESETS = {
  sheet: { width: 1400, minLabelPx: 10, key: "auto" },
  phone: { width: 1170, displayWidth: 390, minLabelPx: 10, key: "below", margin: 1.2 },
  screen: { width: 1920, displayWidth: 1920, minLabelPx: 16, key: "side", aspect: 16 / 9, margin: 1.4 },
  ipad: { width: 1366, displayWidth: 1366, minLabelPx: 16, key: "best", aspect: 1366 / 1024, margin: 1.4 },
  print: { width: 2480, displayWidth: 2480, minLabelPx: 29, key: "best", aspect: 210 / 297, margin: 2.6, valign: "top", paper: "A4" },
  drawing: { width: 1400, minLabelPx: 10, key: "none" }
};
M.PAPER = { A4: { w: 210, h: 297 }, letter: { w: 215.9, h: 279.4 } };
M.resolveOpts = function (opts, W) {
  const o = Object.assign({ view: "iso", theme: "rulebook", layer: "gm", legend: true }, opts);
  if (o.view == null) o.view = "iso";
  if (o.theme == null) o.theme = "rulebook";
  // an unknown layer draws the player copy, never the GM's: a typo must not put secrets on the table's screen (as chase() does)
  if (o.layer == null) o.layer = "gm";
  if (o.layer !== "gm" && o.layer !== "player") { M.warn(W, `layer "${o.layer}" is not gm or player — drawing the player copy`); o.layer = "player"; }
  if (o.paper != null && !/^(a4|letter)$/i.test(String(o.paper))) M.warn(W, `paper "${o.paper}" is not A4 or letter — using A4`);
  let name = o.layout || "sheet";
  if (!M.own(M.PRESETS, name)) { M.warn(W, `layout "${name}" is not one of ${Object.keys(M.PRESETS).join(", ")} — using sheet`); name = "sheet"; }
  const pr = Object.assign({}, M.own(M.PRESETS, name));
  if (name === "print") {
    const paper = String(o.paper || pr.paper).toLowerCase() === "letter" ? "letter" : "A4", pp = M.own(M.PAPER, paper);
    pr.paper = paper; pr.aspect = pp.w / pp.h; pr.width = Math.round(pp.w / 25.4 * 300); pr.displayWidth = pr.width;
  }
  o.layout = name; o.preset = pr;
  o.width = o.width || pr.width;
  o.displayWidth = o.displayWidth || (opts.width && pr.displayWidth === pr.width ? o.width : pr.displayWidth) || o.width;
  o.minLabelPx = o.minLabelPx != null ? +o.minLabelPx : pr.minLabelPx;
  o.key = o.legend === false ? "none" : (o.key || pr.key);
  if (o.key === "none") o.legend = false;
  o.aspect = o.aspect != null ? o.aspect : (pr.aspect || null);
  return o;
};

// One floor per sheet: floor: 0 (the street), -1, 1, 2, or "basement",
// "ground", "upper", "top". Returns the set of floors drawn, or null for all.
const FLOOR_ALIAS = { basement: -1, cellar: -1, ground: 0, street: 0, upper: 1, first: 1, top: 2, roof: 2 };
M.pickFloors = function (lay, floor, W, view) {
  if (floor == null || floor === "all") return null;
  const want = typeof floor === "number" ? floor : (M.own(FLOOR_ALIAS, String(floor).toLowerCase().replace(/ floor$/, "")) ?? +floor);
  const lv = lay.levels.find(l => l.lvl === want) || (lay.levels.length === 1 && want === 0 ? lay.levels[0] : null);
  if (!lv) { M.warn(W, `floor ${JSON.stringify(floor)} is not on this map (floors: ${lay.levels.map(l => l.lvl).join(", ")}) — drawing them all`); return null; }
  // the section draws storeys: E3's sheets (a roof, a walkway, what lies under the street) aren't
  if (view === "section" && lv.ground) { M.warn(W, `floor ${JSON.stringify(floor)} is the ${String(lv.title || lv.ground).toLowerCase()}, which the section doesn't draw as a storey — drawing them all`); return null; }
  return new Set([lv]);
};

// A player copy never names a hidden room, not even in a floor's title: a hidden room called
// "Basement" would be named by the "BASEMENT" floor title. Such a floor takes the first neutral title
// that names no hidden room (whole words, any case: the table app's own leak check). The GM copy keeps
// the book's titles.
const LEVEL_ALT = { "-1": ["Below ground", "Lower level", "Level -1"], "0": ["Street level", "Level 0"], "1": ["First floor", "Level 1"], "2": ["Upper storey", "Level 2"] };
M.hiddenNames = function (model, reveal) {
  const R = new Set(reveal || ["public"]), low = (s) => String(s || "").toLowerCase();
  const seen = model.rooms.filter(r => M.roomRevealed(R, r)).map(r => low(r.name));
  return model.rooms.filter(r => !M.roomRevealed(R, r)).map(r => low(r.name)).filter(n => n && !seen.includes(n));
};
M.namesAny = function (text, names) {
  const t = " " + String(text || "").toLowerCase() + " ";
  return names.some(n => { let i = -1; while ((i = t.indexOf(n, i + 1)) >= 0) if (!/[a-z0-9]/.test(t.charAt(i - 1)) && !/[a-z0-9]/.test(t.charAt(i + n.length))) return true; return false; });
};
M.safeTitles = function (lay, model, reveal) {
  const hidden = M.hiddenNames(model, reveal);
  if (!hidden.length) return;
  for (const lv of lay.levels) {
    if (!lv.title || !M.namesAny(lv.title, hidden)) continue;
    const alt = (LEVEL_ALT[String(lv.lvl)] || ["Level " + lv.lvl]).find(a => !M.namesAny(a, hidden));
    lv.title = alt || null;
  }
};

// Floor titles: on a sheet of several floors; on a one-floor sheet only when
// there is no key to say which floor it is.
M.showTitles = (lay, ctx) => lay.levels.length > 1 || ((lay.allLevels || lay.levels).length > 1 && ctx.opts.legend === false);

// Pieces inside plain groups (no transform of their own), flattened: for
// measuring what a group of entry pieces covers.
M.flat = ps => ps.flatMap(p => p && p.t === "g" && !p.tf ? M.flat(p.kids) : [p]);

// The box a sheet's drawing needs: its floors' sites, every way in (tag,
// icon and arrow) and every label the solver placed.
const grow = (B, b) => { B.minX = Math.min(B.minX, b.x0); B.minY = Math.min(B.minY, b.y0); B.maxX = Math.max(B.maxX, b.x0 + b.w); B.maxY = Math.max(B.maxY, b.y0 + b.h); };
const growEntries = (B, entries) => {
  for (const e of entries) {
    if (e && e.meta) { for (const b of e.meta.boxes || []) grow(B, b); for (const [x1, y1, x2, y2] of e.meta.segs || []) grow(B, { x0: Math.min(x1, x2), y0: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }); continue; }
    for (const p of M.flat([e])) {
      if (p.t === "rect") grow(B, { x0: p.x, y0: p.y, w: p.w, h: p.h });
      if (p.t === "line") grow(B, { x0: Math.min(p.x1, p.x2), y0: Math.min(p.y1, p.y2), w: Math.abs(p.x2 - p.x1), h: Math.abs(p.y2 - p.y1) });
    }
  }
};

M.render = function (o, opts = {}) {
  const W = [], raw = opts;
  opts = M.resolveOpts(opts, W);
  if (!M.VIEWS.includes(opts.view)) { M.warn(W, `view "${opts.view}" is not one of ${M.VIEWS.join(", ")} — drawing iso`); opts.view = "iso"; }
  if (!M.own(M.THEMES, opts.theme)) { M.warn(W, `theme "${opts.theme}" is not one of ${Object.keys(M.THEMES).join(", ")} — drawing rulebook`); opts.theme = "rulebook"; }
  const theme = M.own(M.THEMES, opts.theme);
  const model = M.model(o, W);
  M.revealRooms(model, opts, W);
  const seed = opts.seed != null ? opts.seed : (o.seed != null ? o.seed : M.hash(model.name + model.district));
  // Ids come from the render's own inputs, so the same roll drawn the same way
  // is the same file, byte for byte (saved maps diff cleanly, caches hit).
  const sid = opts.idPrefix || ("b68m" + M.hash(JSON.stringify([model.name, model.district, model.rooms.map(r => r.name + r.band), seed,
    opts.view, opts.theme, opts.layer, opts.reveal || null, opts.width, opts.sheet || null, opts.legend, opts.grain !== false, raw.layout || null,
    raw.displayWidth || null, opts.floor == null ? null : opts.floor, raw.minLabelPx == null ? null : raw.minLabelPx, raw.paper || null, raw.key || null])).toString(36));
  // the street outside: its own module, the same type floor (street.js)
  if (opts.view === "street") return M.street.render(o, opts, W, theme, model, seed, opts.idPrefix || (sid + M.hash("street" + (raw.time || "")).toString(36).slice(0, 4)));
  if (!model.rooms.length) return M.emptyRender(model, opts, theme, W, seed, sid);
  const rng = M.rng(seed);
  // iso and section are drawn from the floor plan, so all three agree. The
  // player copy is laid out the same way, then sealed: see S.seal.
  const player = opts.layer === "player";
  const lay = M.layout.build(model, opts.view === "rings" ? "rings" : "plan", rng.fork("layout"), { player });
  if (player && opts.view !== "section") M.scene.seal(lay, new Set(opts.reveal || ["public"]));
  if (player) M.safeTitles(lay, model, opts.reveal);
  const drawn = M.pickFloors(lay, opts.floor, W, opts.view);
  lay.allLevels = lay.levels.slice();
  if (drawn) lay.levels = lay.levels.filter(l => drawn.has(l));

  // Overlay scale: icons and marks grow with the drawing so they read at any
  // size, sized off the biggest single floor, not the whole sheet. Type has its
  // own floor on top of this (floorU), found by drawing the sheet, measuring
  // how wide a unit is at the display width, and drawing again: two or three
  // passes, as the key and the margins grow with the type.
  const dim = Math.max(...lay.levels.map(l => { const B = l.siteBox || l.bbox; return Math.max(B.w, B.h); }));
  const k0 = Math.min(2.4, Math.max(1, dim / 92));
  const reveal = player ? new Set(opts.reveal || ["public"]) : null;
  const typeTheme = opts.theme === "board" ? (M.own(M.THEMES, opts.sheet) && opts.sheet !== "board" ? M.own(M.THEMES, opts.sheet) : M.THEMES.blueprint) : theme;
  let fu = 0, fk = 0, out = null, keyAt = null;
  for (let pass = 0; pass < 6; pass++) {
    const ctx = { rng: rng.fork("dress"), W, opts, k: k0, reveal, wallK: 1, floorU: fu, type: typeTheme.type, drawn };
    const scene = M.buildScene(lay, model, ctx, { theme, sid, keyFloor: fk, keyAt });
    out = theme.compose(scene);
    // the key's place is chosen afresh while the type settles, then kept
    if (pass >= 1) keyAt = keyAt || scene._keyAt;
    if (!opts.minLabelPx || !out.PW) break;
    const pxu = opts.displayWidth / out.PW, cs = (out.content && out.content.cs) || 1;
    const needD = opts.minLabelPx / (pxu * cs), needK = opts.minLabelPx / pxu;
    if (fu >= needD * 1.004 && fk >= needK * 1.004) break;
    fu = Math.max(fu, needD * 1.02); fk = Math.max(fk, needK * 1.02);
  }
  return { svg: out.svg, width: out.width, height: out.height, warnings: W, model, layout: lay, seed, floorPx: opts.minLabelPx || 0 };
};

// Build a sheet's scene (floors, links, ways in, labels placed) for a theme to compose.
M.buildScene = function (lay, model, ctx, X) {
  const { opts, W, reveal } = ctx;
  let r;
  if (opts.view === "iso") {
    // iso type sits over a smaller footprint on the page: give it room.
    ctx.k = Math.max(ctx.k, 1.2);
    const b = M.iso.build(lay, model, ctx);
    r = { parts: b.parts, links: b.coreLinks.concat(M.scene.links(lay, ctx)), entries: M.scene.entries(lay, ctx), bounds: b.bounds, pad: 4 * ctx.k };
  } else if (opts.view === "section") {
    const b = M.section.build(lay, model, ctx);
    r = { parts: b.parts, links: b.links, entries: b.entries, bounds: b.bounds, pad: 4 * ctx.k };
  } else r = M.buildPlan(lay, model, ctx);
  opts._shortTags = !!ctx.shortTags;
  const k = ctx.k, B = Object.assign({}, r.bounds);
  growEntries(B, r.entries);
  // every room label clear of every other word on the sheet
  const solved = M.labels.solve({ parts: r.parts, links: r.links, entries: r.entries, ctx, view: opts.view, bounds: r.bounds });
  for (const b of solved.boxes) grow(B, b);
  for (const b of solved.fixed) if (b.what !== "street") grow(B, b);
  const pad = r.pad, box = { x: B.minX - pad, y: B.minY - pad, w: B.maxX - B.minX + 2 * pad, h: B.maxY - B.minY + 2 * pad };
  // Portrait tokens: either supplied SVG or rendered by the figure kit.
  let tokens = (opts.tokens || []).slice();
  if (opts.figures && opts.figures.kit && opts.figures.cast) {
    for (const c of opts.figures.cast) {
      try { const p = opts.figures.kit.portrait(c.spec); tokens.push({ room: c.room, svg: p.svg, label: c.label || c.spec.name, warnings: p.warnings }); }
      catch (e) { M.warn(W, `figure for "${c.room}" failed to render: ${e.message}`); }
    }
  }
  const lvOf = rm => lay.levels.find(l => l.rooms.includes(rm));
  tokens = tokens.map(t => {
    const rm = model.rooms.find(x => x.name === t.room);
    if (!rm || !rm.frame) { M.warn(W, `token room "${t.room}" is not on this map`); return null; }
    if (reveal && !M.roomRevealed(reveal, rm)) return null;
    const lv = lvOf(rm); if (!lv) return null;
    const [px, py] = ctx.toScreen(lv, rm.frame.cx, rm.frame.cy, "room");
    return Object.assign({}, t, { x: px, y: py, roomObj: rm });
  }).filter(Boolean);
  // Legend type follows the sheet, so a big plan doesn't get a footnote legend.
  const kl = Math.max(k, Math.min(box.w, box.h * 1.5) / 118);
  const roomPos = rm => { const lv = lvOf(rm); return lv && rm.frame ? ctx.toScreen(lv, rm.frame.cx, rm.frame.cy, "room") : null; };
  const onSheet = new Set(lay.levels.flatMap(l => l.rooms));
  return { model, lay, parts: r.parts, links: r.links, entries: r.entries, box, k, kl, tokens, opts, offsets: r.offsets || new Map(lay.levels.map(l => [l, [0, 0]])), W,
    toScreen: ctx.toScreen, roomPos, _id: X.sid, keyFloor: X.keyFloor || 0, keyAt: X.keyAt || null, floorU: ctx.floorU || 0, onSheet, drawn: ctx.drawn,
    // every tag, label and arrow the solver placed, for a theme's stamp to keep clear of (M.street.stampAt)
    stampTags: { boxes: solved.fixed.filter(b => b.what !== "street" && b.what !== "title").concat(solved.boxes).map(q => ({ x0: q.x0, y0: q.y0, w: q.w, h: q.h })), segs: r.entries.flatMap(e => (e && e.meta && e.meta.segs) || []) } };
};

// Floors in a grid that lands near a 1.4 : 1 sheet — one row for two floors,
// two columns for three or four. A title sits above each floor.
M.buildPlan = function (lay, model, ctx) {
  const k = ctx.k, fu = ctx.floorU || 0, n = lay.levels.length, ts = Math.max(3.4 * k, fu);
  const offsets = new Map(), titleH = M.showTitles(lay, ctx) ? Math.max(7 * k, ts * 1.9) : 0, gap = 26 + 16 * k;
  const cols = n <= 2 ? n : 2;
  const colW = [], rowH = [];
  lay.levels.forEach((lv, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const B = lv.siteBox || lv.bbox;
    colW[c] = Math.max(colW[c] || 0, B.w + 20); rowH[r] = Math.max(rowH[r] || 0, B.h + 20 + titleH + (lv.lvl === 0 ? 10 : 0));
  });
  const parts = [];
  lay.levels.forEach((lv, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const B = lv.siteBox || lv.bbox;
    const x0 = colW.slice(0, c).reduce((s, v) => s + v + gap, 0) + (colW[c] - B.w - 20) / 2;
    const y0 = rowH.slice(0, r).reduce((s, v) => s + v + gap * 0.6, 0);
    const dx = x0 - (B.x - 10), dy = y0 - (B.y - 10) + titleH;
    offsets.set(lv, [dx, dy]);
    const layers = M.scene.level(lv, model, ctx);
    if (lv.title && M.showTitles(lay, ctx)) layers.labels.push(P.text("level-title", B.x - 10, B.y - 10 - titleH * 0.3, lv.title.toUpperCase(), { size: ts, anchor: "start" }));
    parts.push({ lv, layers, tf: { x: dx, y: dy } });
  });
  ctx.toScreen = (lv, x, y) => { const o = offsets.get(lv) || [0, 0]; return [x + o[0], y + o[1]]; };
  ctx.dirScreen = d => d;
  const links = M.scene.links(lay, ctx);
  const entries = M.scene.entries(lay, ctx);
  // Content box: every floor's site, plus room for the entry tags.
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const { lv } of parts) {
    const [dx, dy] = offsets.get(lv), B = lv.siteBox || lv.bbox;
    bounds.minX = Math.min(bounds.minX, B.x - 10 + dx); bounds.minY = Math.min(bounds.minY, B.y - 10 + dy - titleH);
    bounds.maxX = Math.max(bounds.maxX, B.x + B.w + 10 + dx); bounds.maxY = Math.max(bounds.maxY, B.y + B.h + 10 + dy + (lv.lvl === 0 ? 10 : 0));
  }
  return { parts, links, entries, bounds, offsets, pad: 3 * k };
};

// --- Shared legend ------------------------------------------------------------------
// Themes typeset the same facts their own way; this collects the facts.
M.legendFacts = scene => scene.street ? scene.street.facts : M.keyFacts(scene.model, scene.opts, scene.lay, scene.drawn);
// The key's facts for a roll drawn with these options. On a one-floor sheet
// (floor:) the key lists that floor's rooms and the ways in that land on it.
M.keyFacts = function (model, opts, lay, drawn) {
  const player = opts.layer === "player";
  const reveal = player ? new Set(opts.reveal || ["public"]) : null;
  const onSheet = drawn ? new Set([...drawn].flatMap(l => l.rooms)) : null;
  const rooms = model.rooms.filter(r => !onSheet || onSheet.has(r));
  // The player copy's facts carry exactly what its key shows: a band not yet surveyed is
  // its label alone (no rooms, names, numbers or icons), a surveyed one its rooms' numbers
  // and names, and no obstacle, its icon, loot, answer or target anywhere.
  // Since 0.9 a band is known when it is revealed or any of its rooms is (revealed singly); a band with some of its
  // rooms known lists just those, and says so ("partly surveyed").
  const bands = M.BANDS.filter(b => rooms.some(r => r.band === b)).map(b => {
    const inBand = rooms.filter(r => r.band === b), shown = reveal ? inBand.filter(r => M.roomRevealed(reveal, r)) : inBand;
    const band = {
      band: b, label: M.BAND_LABEL[b], known: !reveal || shown.length > 0,
      rooms: shown.map(r => ({ n: r.n, name: r.name, target: !player && r.isTarget, obstacle: !player && r.obstacle, icon: !player && r.obstacle ? M.obstacleIcon(r.obstacle) : null, loot: !player && r.featured && r.loot, answers: !player && r.holdsAnswerTo, mix: r.mix }))
    };
    if (reveal && shown.length && shown.length < inBand.length) band.partial = true;
    return band;
  });
  // In the player copy a way in that costs a question says only that it is
  // there: its text names rooms the crew hasn't surveyed.
  const lands = kind => !drawn || !lay || !lay.entries || !lay.entries.some(e => e.kind === kind) || lay.entries.some(e => e.kind === kind && drawn.has(e.level));
  const ways = model.vectors.map((v, i) => ({ kind: ["front", "service", "back"][i], n: v.n, how: v.how, cost: v.cost, know: v.know }))
    .filter(v => (!player || !/can't be known/.test(v.know)) && lands(v.kind))
    .map(v => player && /question/.test(v.know) ? Object.assign(v, { how: "There is a way in here. Ask how to learn what it is.", cost: "" }) : v);
  const floor = drawn && drawn.size === 1 ? [...drawn][0] : null;
  // links between floors, spelled out when the sheet tags them by number only
  const between = player || !lay || !opts._shortTags ? [] : (lay.links || []).filter(l => l.vertical && l.kind === "skip" && (!drawn || drawn.has(l.la) || drawn.has(l.lb)))
    .map(l => { const here = !drawn || drawn.has(l.la); const [x, y, ly] = here ? [l.a, l.b, l.lb] : [l.b, l.a, l.la]; return { a: x.n, b: y.n, via: l.via, bFloor: ly && ly.title }; });
  return {
    name: model.name, target: model.target, district: model.district, floor: floor && floor.title ? floor.title : null,
    sub: [model.themeName + (model.mixName ? " × " + model.mixName : ""), model.styleName].filter(Boolean).join(" · "),
    approach: player ? "" : model.approach + (model.gambit ? ` — ${model.gambit}` : ""),
    targetLine: player ? "" : (model.targetRoom ? `${model.targetRoom}: ${model.targetWhat}` : ""),
    bands, ways, player, between, skips: player ? [] : (opts._dropped || []),
    threats: player ? [] : [model.soc && { icon: "social", role: "ov-soc", name: model.soc.name, text: model.soc.text, kind: "Social" }, model.phys && { icon: "guard", role: "ov-phys", name: model.phys.name, text: model.phys.text, kind: "Physical" }].filter(Boolean),
    note: player ? "" : model.geometryNote, time: [model.time, model.weather].filter(Boolean).join(", ")
  };
};

// --- The key as data ---------------------------------------------------------------
//   B68Map.key(o, opts) → { facts, html, css, warnings }
// The legend's facts for a roll drawn with these options (layer, reveal, floor,
// theme), and the same facts as HTML a page can typeset with its own styles:
// semantic markup with b68-key__* classes, the theme's icons as inline SVG and
// its band colours as swatches. css is a small default stylesheet for it.
M.key = function (o, opts = {}) {
  const W = [], rings = opts.view === "rings";        // the key follows the floor plan unless rings is asked for
  opts = M.resolveOpts(Object.assign({}, opts), W);
  if (!M.VIEWS.includes(opts.view)) M.warn(W, `view "${opts.view}" is not one of ${M.VIEWS.join(", ")} — the key of the floor plan`);
  if (!M.own(M.THEMES, opts.theme)) M.warn(W, `theme "${opts.theme}" is not one of ${Object.keys(M.THEMES).join(", ")} — rulebook icons`);
  const theme = M.own(M.THEMES, opts.theme) || M.THEMES.rulebook;
  const model = M.model(o, W);
  M.revealRooms(model, opts, W);
  const seed = opts.seed != null ? opts.seed : (o.seed != null ? o.seed : M.hash(model.name + model.district));
  if (opts.view === "street") return M.street.key(o, opts, W, theme, model, seed);
  let lay = null, drawn = null;
  if (model.rooms.length) {
    lay = M.layout.build(model, rings ? "rings" : "plan", M.rng(seed).fork("layout"), { player: opts.layer === "player" });
    if (opts.layer === "player") M.safeTitles(lay, model, opts.reveal);
    drawn = M.pickFloors(lay, opts.floor, W, opts.view);
  }
  const facts = M.keyFacts(model, Object.assign({}, opts, { _shortTags: true }), lay, drawn);
  const paintTheme = opts.theme === "board" ? (M.own(M.THEMES, opts.sheet) && opts.sheet !== "board" ? M.own(M.THEMES, opts.sheet) : M.THEMES.blueprint) : theme;
  const html = M.keyHTML(facts, paintTheme.painter ? paintTheme.painter({ model, opts, _id: "b68k" + M.hash(model.name).toString(36), lay: { levels: [] } }) : null);
  return { facts, html, css: M.KEY_CSS, warnings: W };
};
M.KEY_CSS = `.b68-key{font:15px/1.35 "GT America",Helvetica,Arial,sans-serif;color:#14110e;max-width:42em}
.b68-key h2{font:900 2em/1 "Archivo Compressed",Impact,sans-serif;text-transform:uppercase;margin:.15em 0 .2em}
.b68-key h3{font:900 .78em/1.2 "Archivo Condensed",sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#55504a;margin:1.4em 0 .4em}
.b68-key h4{font:900 .9em/1.2 "Archivo Condensed",sans-serif;letter-spacing:.06em;text-transform:uppercase;margin:.7em 0 .2em;display:flex;align-items:center;gap:.45em}
.b68-key__kicker{font:900 .78em/1.2 "Archivo Condensed",sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#b8481a;margin:0}
.b68-key__sub{font-weight:700;margin:0}.b68-key__time,.b68-key__floor{margin:0;color:#2a2521}.b68-key__floor{font-weight:700}
.b68-key ol,.b68-key ul{list-style:none;margin:0;padding:0}.b68-key li{display:flex;align-items:baseline;gap:.4em;margin:.15em 0}
.b68-key__n{flex:none;min-width:1.45em;height:1.45em;border-radius:.75em;background:#14110e;color:#fbf8f1;font:900 .78em/1.45em "Archivo Condensed",sans-serif;text-align:center;padding:0 .2em;box-sizing:border-box}
.b68-key__swatch{display:inline-block;width:1em;height:1em;flex:none}.b68-key__icon{width:1.25em;height:1.25em;vertical-align:-.25em;flex:none}
.b68-key__target{font-weight:700}.b68-key__strong{font-weight:700}.b68-key__small{font-size:.88em;color:#2a2521;margin:.1em 0 .5em}
.b68-key [data-known=false] h4{opacity:.6}.b68-key__note{font-style:italic;color:#55504a;font-size:.88em;margin-top:1.4em}`;
M.keyHTML = function (F, th) {
  const e = M.esc;
  const icon = (name, role) => th ? `<svg class="b68-key__icon" viewBox="-1.4 -1.4 2.8 2.8" aria-hidden="true">${M.toSVG([M.icon(name, 0, 0, 2, role)], { paint: th.paint })}</svg>` : "";
  const swatch = band => { const a = th ? th.paint("lg-swatch-" + band, { t: "rect" }) : null; const fill = a && a.fill && !/^url/.test(a.fill) ? a.fill : "#ccc"; return `<span class="b68-key__swatch" style="background:${e(fill)}${a && a["fill-opacity"] != null ? `;opacity:${Math.max(0.25, a["fill-opacity"])}` : ""}"></span>`; };
  if (!F) return `<section class="b68-key"><p>No rooms to draw.</p></section>`;
  let h = `<section class="b68-key" data-layer="${F.player ? "player" : "gm"}">`;
  h += `<header><p class="b68-key__kicker">${e(["Score site", F.target, F.district].filter(Boolean).join(" · "))}</p><h2>${e(F.name)}</h2>`;
  if (F.sub) h += `<p class="b68-key__sub">${e(F.sub)}</p>`;
  if (F.time) h += `<p class="b68-key__time">${e(F.time)}</p>`;
  if (F.floor) h += `<p class="b68-key__floor">This sheet: ${e(F.floor)}</p>`;
  h += `</header>`;
  if (F.approach) h += `<section class="b68-key__approach"><h3>Approach</h3><p>${e(F.approach)}</p>${F.targetLine ? `<p class="b68-key__target">${icon("star", "ov-target")} ${e(F.targetLine)}</p>` : ""}</section>`;
  h += `<section class="b68-key__rooms"><h3>${F.player ? "What you know from outside" : "Rooms, by how deep"}</h3>`;
  for (const b of F.bands) {
    h += `<div class="b68-key__band" data-band="${b.band}" data-known="${b.known}"><h4>${swatch(b.band)}${e(b.label)}${b.known ? (b.partial ? " — partly surveyed" : "") : " — not yet surveyed"}</h4>`;
    if (b.known) {
      h += `<ol>`;
      for (const r of b.rooms) {
        const ics = [r.target && ["star", "ov-target"], r.obstacle && [r.icon, "ov-lock"], r.answers && ["key", "ov-pair"], r.loot && ["loot", "ov-loot"]].filter(Boolean).map(([n, ro]) => icon(n, ro)).join("");
        h += `<li value="${r.n}" data-room="${r.n}"><span class="b68-key__n">${r.n}</span><span class="${r.target ? "b68-key__strong" : ""}">${e(r.name + (r.mix ? ` (${r.mix})` : ""))}</span>${ics}</li>`;
      }
      h += `</ol>`;
    }
    h += `</div>`;
  }
  h += `</section>`;
  const obs = F.bands.flatMap(b => b.rooms).filter(r => r.obstacle);
  if (obs.length) {
    h += `<section class="b68-key__obstacles"><h3>In the way</h3><ul>`;
    for (const r of obs) { const by = F.bands.flatMap(b => b.rooms).find(x => x.answers === r.name); h += `<li>${icon(r.icon, "ov-lock")}<span>${r.n} · ${e(r.obstacle)}${by ? ` — answered in ${by.n}` : ""}</span></li>`; }
    h += `</ul></section>`;
  }
  if (F.threats.length) {
    h += `<section class="b68-key__threats"><h3>Threats</h3><ul>`;
    for (const t of F.threats) h += `<li>${icon(t.icon, t.role)}<span><span class="b68-key__strong">${e(t.kind)} — ${e(t.name)}</span><br><span class="b68-key__small">${e(t.text)}</span></span></li>`;
    h += `</ul></section>`;
  }
  if (F.ways.length) {
    h += `<section class="b68-key__ways"><h3>The way in</h3><ul>`;
    for (const v of F.ways) { const a = th ? th.paint("ov-" + v.kind + "-tag", { t: "rect" }) : null; h += `<li data-way="${v.kind}"><span class="b68-key__swatch" style="background:${e(a && a.fill && !/^url/.test(a.fill) ? a.fill : "#14110e")}"></span><span><span class="b68-key__strong">${e(v.n)} — ${e(v.know)}</span><br><span class="b68-key__small">${e(`${v.how} ${F.player && /question/.test(v.know) ? "" : v.cost || ""}`.trim())}</span></span></li>`; }
    h += `</ul></section>`;
  }
  if (F.between && F.between.length) {
    h += `<section class="b68-key__between"><h3>Between floors</h3><ul>`;
    for (const l of F.between) h += `<li><span>${l.a} ↕ ${l.b}${l.bFloor ? ` (${e(l.bFloor.toLowerCase())})` : ""} — ${e(l.via)}</span></li>`;
    h += `</ul></section>`;
  }
  if (F.skips && F.skips.length) {
    h += `<section class="b68-key__skips"><h3>Links that skip</h3><ul>`;
    for (const l of F.skips) h += `<li><span>${l.a} → ${l.b} — ${e(l.via)}</span></li>`;
    h += `</ul></section>`;
  }
  if (F.note && !F.player) h += `<p class="b68-key__note">${e(F.note)}</p>`;
  if (F.player) h += `<p class="b68-key__note">Hatched rooms are what gathering information is for. Open a band when the crew learns it.</p>`;
  return h + `</section>`;
};

// --- Floors ------------------------------------------------------------------------
//   B68Map.floors(o) → [{ lvl, title, rooms: [{ n, name, band }] }]
// The floors a roll is drawn on, street first, for one sheet per floor
// (render with floor: lvl) — one phone screen per floor, say.
M.floors = function (o, opts = {}) {
  const W = [], model = M.model(o, W);
  if (!model.rooms.length) return [];
  const seed = opts.seed != null ? opts.seed : (o.seed != null ? o.seed : M.hash(model.name + model.district));
  const lay = M.layout.build(model, "plan", M.rng(seed).fork("layout"), {});
  return lay.levels.map(l => ({ lvl: l.lvl, title: l.title || "Ground floor", rooms: l.rooms.map(r => ({ n: r.n, name: r.name, band: r.band })) }));
};

// --- Print ---------------------------------------------------------------------------
//   B68Map.printPage(o, opts) → { html, svg, width, height, paper, warnings }
// A print-ready page: the map drawn with the print preset (A4, or paper:
// "letter"), in an HTML document whose @page is that paper with no margins.
// Open it and print to PDF; pass fontCSS (@font-face rules for the design
// system's fonts) when the page that prints it doesn't load them already.
M.printPage = function (o, opts = {}) {
  const r = M.render(o, Object.assign({}, opts, { layout: "print" }));
  const paper = String(opts.paper || "A4").toLowerCase() === "letter" ? "letter" : "A4", pp = M.own(M.PAPER, paper);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${M.esc(r.model.name)}</title><style>${opts.fontCSS || ""}@page{size:${paper === "letter" ? "letter" : "A4"} portrait;margin:0}html,body{margin:0;padding:0;background:#fff}svg{display:block;width:${pp.w}mm;height:${(pp.w * r.height / r.width).toFixed(2)}mm}</style></head><body>${r.svg}</body></html>`;
  return { html, svg: r.svg, width: r.width, height: r.height, paper, warnings: r.warnings };
};

// --- Sheets: every piece on one page --------------------------------------------
//   B68Map.sheet({ kind: "parts" | "icons" | "rooms", theme, colour, cols, width, names })
// Draws the kit's own vocabulary in any theme, for the design system's
// catalogue pages and for checking a new part by eye.
M.sheet = function (o = {}) {
  const W = [], kind = ["parts", "icons", "rooms"].includes(o.kind) ? o.kind : (o.kind == null ? "parts" : "rooms"), themeName = o.theme && o.theme !== "board" && M.own(M.THEMES, o.theme) ? o.theme : "rulebook";
  if (o.kind != null && kind !== o.kind) M.warn(W, `kind "${o.kind}" is not parts, icons or rooms — drawing rooms`);
  if (o.theme != null && o.theme !== "board" && !M.own(M.THEMES, o.theme)) M.warn(W, `theme "${o.theme}" is not one of ${Object.keys(M.THEMES).join(", ")} — drawing rulebook`);
  const theme = M.own(M.THEMES, themeName), rng = M.rng(o.seed || 7);
  const kids = [], labels = [], floors = [], walls = [];
  let cell, cols, names;
  if (kind === "parts") { names = o.names || Object.keys(M.PARTS); cell = [16, 16]; cols = o.cols || 8; }
  else if (kind === "icons") { names = o.names || Object.keys(M.ICONS); cell = [10, 10]; cols = o.cols || 10; }
  else { names = o.names || Object.keys(M.ARCH).filter(n => n !== "empty"); cell = [40, 30]; cols = o.cols || 5; }
  const roles = ["ov-target", "ov-lock", "ov-loot", "ov-pair", "ov-soc", "ov-phys"];
  names.forEach((name, i) => {
    const x = (i % cols) * cell[0], y = Math.floor(i / cols) * (cell[1] + 4);
    floors.push(P.rect(kind === "rooms" ? "floor-working" : "floor-public", x + 0.5, y + 0.5, cell[0] - 1, cell[1] - 1));
    if (kind === "parts") {
      const p = M.own(M.PARTS, name); if (!p) { M.warn(W, `part "${name}" is not registered`); return; }
      const s = Math.min(o.fit ? 2.6 : 1, (cell[0] - 4) / p.size[0], (cell[1] - 5) / p.size[1]);
      kids.push(P.g(p.draw({}), { tf: { x: x + cell[0] / 2, y: y + cell[1] / 2 - 1, s }, cls: "furniture" }));
    } else if (kind === "icons") {
      kids.push(M.icon(name, x + cell[0] / 2, y + cell[1] / 2 - 0.6, 4.2, roles[i % roles.length]));
    } else {
      const room = { id: "s" + i, name, arch: name, frame: { cx: x + cell[0] / 2, cy: y + cell[1] / 2, w: cell[0] - 2, h: cell[1] - 2, rot: 0 } };
      const g = M.furnish(room, rng.fork(name), W);
      if (g) kids.push(g);
      G.rectPts({ x: x + 0.5, y: y + 0.5, w: cell[0] - 1, h: cell[1] - 1 }).forEach((p, j, a) => walls.push(M.scene.wallPiece({ a: p, b: a[(j + 1) % 4], t: "int" })));
    }
    labels.push(P.text("label", x + cell[0] / 2, y + cell[1] + 2.6, name.toUpperCase(), { size: kind === "rooms" ? 1.9 : 1.25 }));
  });
  const rows = Math.ceil(names.length / cols), box = { x: -4, y: -4, w: cols * cell[0] + 8, h: rows * (cell[1] + 4) + 6 };
  const layers = { site: [], floors, furn: kids.filter(k => kind !== "icons"), walls, doors: [], game: [], cover: [], labels: kind === "icons" ? kids.concat(labels) : labels, entries: [] };
  const scene = { _id: "b68s" + M.hash(JSON.stringify([kind, themeName, o.colour || null, names, o.width || 1400, !!o.fit, o.cols || null])).toString(36),
    model: { name: `${kind} sheet`, target: "", district: "", colour: M.own(M.COLOURS, o.colour) ? o.colour : "teal and ochre", rooms: [], seed: 1 },
    lay: { levels: [] }, parts: [{ lv: {}, layers, tf: { x: 0, y: 0 } }], links: [], entries: [], box, k: 1, kl: 1, tokens: [],
    opts: { legend: false, width: o.width || 1400, view: "sheet", layer: "gm", grain: o.grain }, offsets: new Map(), W };
  const out = theme.compose(scene);
  return { svg: out.svg, width: out.width, height: out.height, warnings: W, count: names.length };
};

// A roll with no rooms has nothing to draw: say so on the sheet, and warn.
M.emptyRender = function (model, opts, theme, W, seed, sid) {
  const w = opts.width || 1400, h = Math.round(w * 0.25), page = theme.page || "#f2ede1";
  const dark = parseInt(page.slice(1, 3), 16) + parseInt(page.slice(3, 5), 16) + parseInt(page.slice(5, 7), 16) < 384;
  const ink = dark ? "#f4f6fb" : "#14110e";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" font-weight="400" font-style="normal" viewBox="0 0 400 100" width="${w}" height="${h}" font-family='${M.FONTS.condensed}' role="img" aria-label="${M.esc(model.name)}: no rooms to draw" data-map="${sid}">` +
    `<title>${M.esc(model.name)}</title><rect width="100%" height="100%" fill="${page}"/>` +
    `<text x="200" y="46" font-size="14" font-weight="900" text-anchor="middle" fill="${ink}">${M.esc(model.name.toUpperCase())}</text>` +
    `<text x="200" y="66" font-size="8" text-anchor="middle" fill="${ink}" opacity="0.7">No rooms to draw: the roll's rooms list is empty.</text></svg>`;
  return { svg, width: w, height: h, warnings: W, model, layout: null, seed };
};

// ---- src/themes.js ----
// =============================================================================
// themes — roles → paint, and the page around the drawing
// =============================================================================
// A theme is { name, describe, paint(role, piece, mode), compose(scene) }.
// paint() returns SVG attributes for a role, or null to drop the piece. The
// four here share one legend typesetter and differ in everything else.

const T = M.THEMES = {};
let UID = 0;
const uid = () => (++UID).toString(36);
// The design system's colour tokens (palette.inks, src/tokens.gen.js), by
// camelCase name: "ink-900" → ink900, "paper-tint" → paperTint.
const TOK = M.TOKENS = {};
for (const [name, v] of Object.entries(M.PALETTE.inks)) TOK[name.replace(/-(\d)/g, "$1").replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
const FONT = M.FONTS = {
  poster: '"Archivo Compressed", Impact, "Arial Narrow", sans-serif',
  condensed: '"Archivo Condensed", "GT America", "Arial Narrow", sans-serif',
  text: '"GT America", Helvetica, Arial, sans-serif',
  mono: '"Space Mono", ui-monospace, Menlo, monospace',
  typewriter: '"Courier Prime", "Courier New", monospace',
  script: 'Yellowtail, "Brush Script MT", cursive'
};
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => { const A = hex(a), B = hex(b); return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join(""); };
M.mix = mix;
// A palette colour: a token by name ("ink-900"), a scheme swatch ("a", "b"), a
// hex, or { from, to, t } mixed (palette.bands).
const palColour = M.palColour = (v, a, b) => {
  if (v && typeof v === "object") return mix(palColour(v.from, a, b), palColour(v.to, a, b), v.t);
  if (v === "a") return a; if (v === "b") return b;
  return M.PALETTE.inks[v] || v;
};

// --- Shared defs: grain, halftone, hatch ---------------------------------------
const defs = (id, o) => {
  let s = "";
  if (o.grain !== false) s += `<filter id="${id}-grain" x="0" y="0" width="100%" height="100%" filterUnits="objectBoundingBox"><feTurbulence type="fractalNoise" baseFrequency="${((o.freq || 0.85) * (o.pxft || 6)).toFixed(3)}" numOctaves="2" seed="${o.seed || 3}" result="n"/><feColorMatrix type="matrix" values="0 0 0 0 ${o.gr || 0.08}  0 0 0 0 ${o.gg || 0.07}  0 0 0 0 ${o.gb || 0.05}  0 0 0 ${o.ga || -1.9} ${o.gb2 || 1.05}"/></filter>`;
  s += `<pattern id="${id}-dots" width="${o.dot || 1.1}" height="${o.dot || 1.1}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx="${(o.dot || 1.1) / 2}" cy="${(o.dot || 1.1) / 2}" r="${(o.dot || 1.1) * 0.22}" fill="${o.dotFill || "#14110e"}"/></pattern>`;
  s += `<pattern id="${id}-hatch" width="1.4" height="1.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.4" height="1.4" fill="${o.hatchBg || "#2a2521"}"/><rect width="0.35" height="1.4" fill="${o.hatchFg || "#55504a"}"/></pattern>`;
  if (o.rough) s += `<filter id="${id}-rough"><feTurbulence type="fractalNoise" baseFrequency="0.35" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="${o.rough}"/></filter>`;
  if (o.copy) s += `<filter id="${id}-copy"><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncR type="linear" slope="1.12" intercept="-0.04"/><feFuncG type="linear" slope="1.12" intercept="-0.04"/><feFuncB type="linear" slope="1.12" intercept="-0.04"/></feComponentTransfer></filter>`;
  return s;
};

// Common role → attribute plumbing every theme gets for free.
function finish(a, p) {
  if (!a) return a;
  a = Object.assign({}, a);
  if (p.t === "text") {
    if (a["font-size"] === undefined) a["font-size"] = p.size || 2;
    if (a["text-anchor"] === undefined) a["text-anchor"] = p.anchor || "middle";
  }
  if (a.stroke && a.stroke !== "none" && a["stroke-width"] === undefined) a["stroke-width"] = p.sw || 0.2;
  if (p.dash && a.stroke && !a["stroke-dasharray"]) a["stroke-dasharray"] = "1.6 1.1";
  if (p.opacity !== undefined && a.opacity === undefined) a.opacity = p.opacity;
  if (p.grow && a.fill && a.fill !== "none") { a.stroke = a.stroke || a.fill; a["stroke-width"] = p.grow * 2; a["stroke-linejoin"] = "round"; }
  if (p.evenodd) a["fill-rule"] = "evenodd";
  return a;
}
const wrapPaint = fn => (role, p, mode) => finish(fn(role, p, mode), p);

// --- Shared legend typesetter -------------------------------------------------------
// Lays the facts out as blocks, each a list of pieces with a height; then flows
// the blocks into columns. Roles are "lg-*" so each theme styles them.
function legendBlocks(F, w, k, opt, ty, fk) {
  if (F && F.kind === "street") return M.street.legendBlocks(F, w, k, opt, ty, fk);
  const s = k * (opt.scale || 1), blocks = [], ns = Math.max(1.2 * s, fk || 0), nr = Math.max(1.0 * s, ns * 0.8);
  ty = Object.assign({ key: "text", keyBold: "textBold", keyHead: "condensed", title: "poster" }, ty || {});
  // each role's face and letter-spacing, for measuring
  const face = { "lg-kicker": [ty.keyHead, ty.kickerLS], "lg-title": [ty.title, 0], "lg-sub": [ty.keyBold, 0], "lg-h": [ty.keyHead, ty.keyHeadLS], "lg-band": [ty.keyHead, ty.bandLS],
    "lg-text": [ty.key, 0], "lg-text-strong": [ty.keyBold, 0], "lg-small": [ty.key, 0], "lg-small-italic": [ty.key, 0] };
  const fw = (role, t, size) => { const [c, ls] = face[role] || [ty.key, 0]; return M.textW(t, size, c, ls || 0); };
  const block = () => { const b = { pieces: [], h: 0 }; blocks.push(b); return b; };
  const text = (b, role, t, size, o = {}) => {
    const [c, ls] = face[role] || [ty.key, 0], maxW = w - (o.x || 0);
    const lines = o.nowrap ? [t] : M.wrapW(t, maxW, size, c, ls || 0);
    for (const l of lines) { b.h += size * 1.25; b.pieces.push(P.text(role, o.x || 0, b.h - size * 0.3, l, { size, anchor: "start" })); }
    return lines.length;
  };
  // header
  let b = block();
  text(b, "lg-kicker", [opt.kicker || "SCORE SITE", F.target, F.district].filter(Boolean).join(" · ").toUpperCase(), 1.9 * s);
  b.h += 0.6 * s;
  text(b, "lg-title", F.name.toUpperCase(), (opt.titleSize || 5.4) * s);
  if (F.sub) text(b, "lg-sub", F.sub, 2.1 * s);
  if (F.time) text(b, "lg-small", F.time, 1.8 * s);
  if (F.floor) { b.h += 0.5 * s; text(b, "lg-h", "THIS SHEET: " + F.floor.toUpperCase(), 1.7 * s); }
  b.h += 1.2 * s;
  if (F.approach) {
    b.pieces.push(P.rect("lg-chip", 0, b.h, w, 0.2 * s));
    b.h += 1.4 * s;
    text(b, "lg-h", "APPROACH", 1.7 * s);
    text(b, "lg-text", F.approach, 2.1 * s);
    if (F.targetLine) { b.pieces.push(M.icon("star", 1.2 * s, b.h + 1.4 * s, 2.3 * s, "ov-target")); const n0 = b.h; b.h += 0.2 * s; text(b, "lg-text-strong", F.targetLine, 2.1 * s, { x: 3.2 * s }); if (b.h - n0 < 2.6 * s) b.h = n0 + 2.8 * s; }
    b.h += 1 * s;
  }
  // bands
  b = block();
  text(b, "lg-h", F.player ? "WHAT YOU KNOW FROM OUTSIDE" : "ROOMS, BY HOW DEEP", 1.7 * s); b.h += 0.4 * s;
  for (const band of F.bands) {
    b.pieces.push(P.rect("lg-swatch-" + band.band, 0, b.h + 0.2 * s, 2.4 * s, 2.4 * s));
    if (!band.known) b.pieces.push(P.rect("unknown", 0, b.h + 0.2 * s, 2.4 * s, 2.4 * s));
    text(b, "lg-band", band.label.toUpperCase() + (band.known ? (band.partial ? " — partly surveyed" : "") : " — not yet surveyed"), 2 * s, { x: 3.4 * s, nowrap: true });
    b.h += 0.2 * s;
    if (!band.known) { b.h += 0.6 * s; continue; }
    for (const r of band.rooms) {
      const y0 = b.h;
      b.pieces.push(P.circle("num-bg", 6.6 * s - nr - 0.5 * s, y0 + 1.15 * s, nr), P.text("num", 6.6 * s - nr - 0.5 * s, y0 + 1.15 * s + ns * 0.36, String(r.n), { size: ns }));
      let nm = r.name + (r.mix ? ` (${r.mix})` : "");
      const icons = [r.target && ["star", "ov-target"], r.obstacle && [r.icon, "ov-lock"], r.answers && ["key", "ov-pair"], r.loot && ["loot", "ov-loot"]].filter(Boolean);
      // the name wraps short of its icons, which follow its first line
      const role = r.target ? "lg-text-strong" : "lg-text", iw = icons.length ? icons.length * 2.6 * s + 1.2 * s : 0, [c0, ls0] = face[role];
      const lines = M.wrapW(nm, w - 6.6 * s - iw, 2 * s, c0, ls0 || 0);
      for (const l of lines) { b.h += 2 * s * 1.25; b.pieces.push(P.text(role, 6.6 * s, b.h - 2 * s * 0.3, l, { size: 2 * s, anchor: "start" })); }
      const ix = 6.6 * s + fw(role, lines[0], 2 * s) + 1.6 * s;
      icons.forEach(([nmI, roleI], i) => b.pieces.push(M.icon(nmI, ix + i * 2.6 * s, y0 + 1.15 * s, 2 * s, roleI)));
    }
    b.h += 0.8 * s;
  }
  // in the way
  const obs = F.bands.flatMap(x => x.rooms).filter(r => r.obstacle);
  if (obs.length) {
    b = block(); text(b, "lg-h", "IN THE WAY", 1.7 * s); b.h += 0.3 * s;
    for (const r of obs) {
      const y0 = b.h;
      b.pieces.push(M.icon(r.icon, 1.2 * s, y0 + 1.3 * s, 2.2 * s, "ov-lock"));
      const answeredBy = F.bands.flatMap(x => x.rooms).find(x => x.answers === r.name);
      text(b, "lg-text", `${r.n} · ${r.obstacle}${answeredBy ? ` — answered in ${answeredBy.n}` : ""}`, 1.9 * s, { x: 3.4 * s });
      b.h = Math.max(b.h, y0 + 2.7 * s);
    }
  }
  // threats
  if (F.threats.length) {
    b = block(); text(b, "lg-h", "THREATS", 1.7 * s); b.h += 0.3 * s;
    for (const t of F.threats) {
      const y0 = b.h;
      b.pieces.push(M.icon(t.icon, 1.2 * s, y0 + 1.3 * s, 2.3 * s, t.role));
      text(b, "lg-text-strong", `${t.kind} — ${t.name}`, 2 * s, { x: 3.4 * s });
      text(b, "lg-small", t.text, 1.75 * s, { x: 3.4 * s });
      b.h += 0.6 * s;
    }
  }
  // ways in
  if (F.ways.length) {
    b = block(); text(b, "lg-h", "THE WAY IN", 1.7 * s); b.h += 0.3 * s;
    for (const v of F.ways) {
      const y0 = b.h, role = "ov-" + v.kind;
      b.pieces.push(P.rect(role + "-tag", 0, y0 + 0.3 * s, 2.4 * s, 2.4 * s, { rx: 0.3 }));
      text(b, "lg-text-strong", `${v.n} — ${v.know}`, 2 * s, { x: 3.4 * s });
      text(b, "lg-small", `${v.how} ${F.player && /question/.test(v.know) ? "" : v.cost}`.trim(), 1.75 * s, { x: 3.4 * s });
      b.h += 0.6 * s;
    }
  }
  // skip links whose words wouldn't fit on the drawing
  if (F.skips && F.skips.length) {
    b = block(); text(b, "lg-h", "LINKS THAT SKIP", 1.7 * s); b.h += 0.3 * s;
    for (const l of F.skips) text(b, "lg-text", `${l.a} → ${l.b} — ${l.via}`, 1.9 * s);
  }
  // links between floors
  if (F.between && F.between.length) {
    b = block(); text(b, "lg-h", "BETWEEN FLOORS", 1.7 * s); b.h += 0.3 * s;
    for (const l of F.between) text(b, "lg-text", `${l.a} ↕ ${l.b}${l.bFloor ? ` (${l.bFloor.toLowerCase()})` : ""} — ${l.via}`, 1.9 * s);
  }
  // key
  if (!F.player) {
    b = block(); text(b, "lg-h", "LINES", 1.7 * s); b.h += 0.3 * s;
    const line = (role, head, label) => {
      const y = b.h + 1.2 * s;
      b.pieces.push(P.path(role, `M0 ${y} Q${3 * s} ${y - 1.2 * s} ${5.4 * s} ${y}`, { sw: (role === "ov-pair-line" ? 0.45 : 0.75) * s }), P.poly(head, [[6.6 * s, y], [5.2 * s, y - 0.9 * s], [5.2 * s, y + 0.9 * s]]));
      text(b, "lg-small", label, 1.75 * s, { x: 8 * s });
      b.h += 0.5 * s;
    };
    line("ov-pair-line", "ov-pair-head", "An earlier room holds the answer to a lock deeper in");
    line("ov-skip-line", "ov-skip-head", "A link that skips a ring — the line to plan around");
  }
  if (F.note && !F.player) { b = block(); text(b, "lg-small-italic", F.note, 1.7 * s); }
  if (F.player) { b = block(); text(b, "lg-small-italic", "Hatched rooms are what gathering information is for. Open a band when the crew learns it.", 1.75 * s); }
  return blocks;
}
function flowLegend(blocks, colW, cols, gap) {
  const H = new Array(cols).fill(0), out = [];
  const spacing = gap;
  blocks.forEach((b, i) => {
    // the header block always opens column 0
    let c = i === 0 ? 0 : H.indexOf(Math.min(...H));
    out.push(P.g(b.pieces, { tf: { x: c * (colW + gap), y: H[c] } }));
    H[c] += b.h + spacing;
  });
  return { pieces: out, h: Math.max(...H) - spacing };
}

// --- Generic page composer -------------------------------------------------------
// Drawing on the left, legend on the right — or below, for wide multi-floor
// plans. Theme supplies background, overlays above content, and texture.
function composePage(scene, th, o = {}) {
  const { box, opts, parts, links, entries, tokens } = scene, k = scene.kl || scene.k;
  const id = scene._id || ("b68m" + uid());
  const paint = th.paint, pr = opts.preset || {};
  const L = opts.aspect ? pageFirst(scene, th) : contentFirst(scene, th);
  const { legend, LW, LH, below, cs, bw, bh, PW, PH, cx, cy, lx, ly, kp, fk } = L;
  scene._cs = cs;
  const width = opts.width, height = Math.round(width * PH / PW);
  scene._pxft = width / PW * cs;
  scene._drawRect = { x: cx + box.x * cs, y: cy + box.y * cs, w: bw, h: bh };
  void pr;

  const ser = (pieces, mode) => M.toSVG(pieces, { paint, shadowColour: th.shadowColour }, mode);
  // A part may give each layer its own transform (the isometric view skews
  // floors and furniture but keeps walls, labels and entries upright).
  const tfOf = (p, name) => (p.tfs && p.tfs[name]) || `translate(${p.tf.x.toFixed(2)} ${p.tf.y.toFixed(2)})`;
  const layer = (name, mode) => parts.map(p => `<g transform="${tfOf(p, name)}">${ser(p.layers[name], mode)}</g>`).join("");
  let body = "";
  body += th.background ? th.background(id, { PW, PH, box, cx, cy, k, cs }) : "";
  body += `<g class="map-drawing" transform="translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${cs.toFixed(4)})"${th.contentFilter ? ` filter="url(#${id}-${th.contentFilter})"` : ""}>`;
  body += th.underlay ? th.underlay(id, scene) : "";
  body += layer("site") + layer("floors");
  if (th.shadow) body += `<g transform="translate(${th.shadow[0]} ${th.shadow[1]})" opacity="${th.shadow[2]}">${layer("furn", "shadow")}</g>`;
  body += layer("furn");
  for (const pass of th.wallPasses || [null]) body += layer("walls", pass);
  body += layer("doors");
  body += `<g${th.gameFilter ? ` filter="url(#${id}-${th.gameFilter})"` : ""}>${layer("game")}${ser(links)}</g>`;
  body += layer("cover");
  // E4 weather (weather.js): over the drawing, under its words
  const wx = scene.street ? scene.street.weather : scene.weather;
  if (wx) {
    const pg = th.page || "#ffffff", dark = (scene.street ? scene.street.night : scene.night) || parseInt(pg.slice(1, 3), 16) + parseInt(pg.slice(3, 5), 16) + parseInt(pg.slice(5, 7), 16) < 300;
    body += M.weather.overlay(wx, box, id, { u: Math.max(1, Math.min(box.w, box.h) / 160), dark });
  }
  // tokens: a portrait set into a framed square in the room
  for (const t of tokens) {
    const s = 7.5 * k, x = t.x + (t.roomObj.frame.w / 2 - s / 2 - 1.5) * 0, y = t.y;
    body += ser([P.rect("tok-frame", x - s / 2 - 0.4, y - s / 2 - 0.4, s + 0.8, s * 1.11 + 0.8 + (t.label ? 2.4 * k : 0), { rx: 0.3 })]);
    body += `<svg x="${(x - s / 2).toFixed(2)}" y="${(y - s / 2).toFixed(2)}" width="${s.toFixed(2)}" height="${(s * 1.11).toFixed(2)}" viewBox="0 0 540 600" preserveAspectRatio="xMidYMid slice">${String(t.svg).replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")}</svg>`;
    if (t.label) body += ser([P.text("tok-label", x, y + s * 1.11 / 2 + 2 * k, t.label.toUpperCase(), { size: 1.6 * k })]);
  }
  body += layer("labels");
  body += ser(entries);
  body += th.overlay ? th.overlay(id, scene) : "";
  body += "</g>";
  if (legend) body += `<g class="map-key" transform="translate(${lx.toFixed(2)} ${ly.toFixed(2)})">${th.legendBackground ? th.legendBackground(id, LW, LH, kp) : ""}${ser(legend)}</g>`;
  body += th.foreground ? th.foreground(id, { PW, PH, k: kp, scene, lx, ly, LW, LH, below, draw: scene._drawRect, floor: fk }) : "";
  // Grain sits on the drawing, not the type: the rulebook's text pages are clean.
  if (opts.grain !== false && th.grain) body += `<rect x="${(cx + box.x * cs).toFixed(2)}" y="${(cy + box.y * cs).toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" filter="url(#${id}-grain)" style="mix-blend-mode:${th.grainBlend || "multiply"}" opacity="${th.grain}" pointer-events="none"/>`;
  const lab = M.svgLabel(scene, id);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" font-weight="400" font-style="normal" viewBox="0 0 ${PW.toFixed(2)} ${PH.toFixed(2)}" width="${width}" height="${height}" font-family='${FONT.condensed}'${lab.attrs}>${lab.inner}<defs>${th.defs(id, scene)}</defs><rect width="100%" height="100%" fill="${th.page}"/>${body}</svg>`;
  return { svg, width, height, PW, PH, content: { cx, cy, cs } };
}
M.composePage = composePage;

// What a screen reader announces for a map: its name and view, and one line
// of what it shows. A player copy says only what the crew knows from outside.
M.svgLabel = function (scene, id) {
  const m = scene.model || {}, o = scene.opts || {}, player = o.layer === "player";
  const VIEW = { iso: "isometric map", plan: "floor plan", rings: "rings diagram", section: "section", street: "the street outside" };
  const title = `${m.name || "Map kit sheet"}: ${player ? "player handout" : M.own(VIEW, o.view) || "map"}`;
  let desc = "";
  if (scene.street) {
    // the street: what stands on it, the ways in (a player copy's, only those the crew could know)
    const F = scene.street.facts || {}, where = [m.target, m.district].filter(Boolean).join(", "), lead = where ? where + ". " : "", when = F.time ? ` (${F.time})` : "";
    desc = player ? `${lead}The street outside${when}: what the crew can see from it, and the ways in they could know.`
      : `${lead}The street outside${when}: ${F.sub || "the street"}, what stands on it, and the ways in marked.`;
  } else if (m.rooms && m.rooms.length) {
    const where = [m.target, m.district].filter(Boolean).join(", "), lead = where ? where + ". " : "";
    if (player) {
      const bands = o.reveal && o.reveal.length ? o.reveal : ["public"];
      const rooms = bands.some(b => typeof b === "string" && /^room:/.test(b)), whole = bands.filter(b => !(typeof b === "string" && /^room:/.test(b)));
      // (a room opened singly is never named here: the reveal list's own words stay out of the file)
      desc = rooms ? `${lead}What the crew knows from outside: ${whole.length ? `the ${whole.join(" and ")} band${whole.length > 1 ? "s" : ""}, ` : ""}the rooms they have opened and the ways in they could know. Rooms not yet surveyed are left out.`
        : `${lead}What the crew knows from outside: the ${bands.join(" and ")} band${bands.length > 1 ? "s" : ""} and the ways in they could know. Rooms not yet surveyed are left out.`;
    } else {
      const t = m.rooms.find(r => r.isTarget);
      desc = `${lead}${m.rooms.length} rooms in four security bands, the ways in marked.${t ? ` Target room: ${t.name}.` : ""}`;
    }
  }
  return { attrs: ` role="img" aria-labelledby="${id}-t${desc ? ` ${id}-d` : ""}"`, inner: `<title id="${id}-t">${M.esc(title)}</title>${desc ? `<desc id="${id}-d">${M.esc(desc)}</desc>` : ""}` };
};

// --- Page layouts ---------------------------------------------------------------
// Content first (the sheet, the phone): the drawing at its own size, the key
// beside or below it, the page as big as both. The key's type unit follows
// the type floor (keyFloor, from the render's passes).
function contentFirst(scene, th) {
  const { box, opts } = scene, k = scene.kl || scene.k, pr = opts.preset || {};
  const fk = scene.keyFloor || 0, ks = Math.max(k, fk / 1.7);
  const m = pr.margin ? Math.max(2.5 * scene.k, pr.margin * Math.max(fk, scene.k)) : 7 * k;
  const mode = opts.legend === false ? "none" : (opts.key || "auto");
  if (mode === "none") {
    const PW = box.w + 2 * m, PH = box.h + 2 * m + (th.footerH || 0) * ks;
    return { legend: null, LW: 0, LH: 0, below: false, cs: 1, bw: box.w, bh: box.h, PW, PH, cx: m - box.x, cy: m - box.y, lx: 0, ly: 0, kp: ks, fk };
  }
  const F = M.legendFacts(scene), gap = 3.4 * ks;
  const keyFor = (isBelow, maxCols) => {
    const colW = isBelow ? Math.min(box.w, Math.max(48 * ks, Math.min(64 * ks, box.w / 3 - 4 * ks))) : Math.max(54 * ks, Math.min(72 * ks, box.h * 0.55));
    let cols = isBelow ? Math.max(1, Math.floor((box.w + gap) / (colW + gap))) : 1;
    const blocks = legendBlocks(F, colW, ks, th.legend || {}, th.type, fk);
    let flowed = flowLegend(blocks, colW, cols, gap);
    // A side key much taller than the drawing takes a second column.
    while (!isBelow && cols < maxCols && flowed.h > box.h * 1.3) { cols++; flowed = flowLegend(blocks, colW, cols, gap); }
    const Kx = { pieces: flowed.pieces, LW: isBelow ? box.w : cols * colW + (cols - 1) * gap, LH: flowed.h, below: isBelow };
    // On the sheet, a drawing beside a taller key grows to match it.
    Kx.cs = !isBelow ? Math.min(1.35, Math.max(1, Kx.LH / box.h)) : 1;
    const bw = box.w * Kx.cs, bh = box.h * Kx.cs;
    Kx.PW = isBelow ? bw + 2 * m : bw + Kx.LW + 3 * m; Kx.PH = isBelow ? bh + Kx.LH + 3 * m : Math.max(bh, Kx.LH) + 2 * m;
    return Kx;
  };
  // Which arrangement puts the drawing biggest on the page, on a page that
  // stays between 1 : 1 and 2.4 : 1.
  const score = Kx => { const a = Kx.PW / Kx.PH; return Kx.cs / Kx.PW * Math.min(1, a * a, (2.4 / a) ** 2); };
  const want = scene.keyAt || (mode === "side" ? "side" : mode === "below" ? "below" : null);
  const cands = want ? [keyFor(want === "below", 2)] : [keyFor(false, 1), keyFor(false, 2), keyFor(true)];
  const K = cands.reduce((a, b) => score(b) > score(a) * 1.0001 ? b : a);
  scene._keyAt = K.below ? "below" : "side";
  const cs = K.cs, bw = box.w * cs, bh = box.h * cs;
  const cx = m - box.x * cs, cy = m + (K.below ? 0 : (K.PH - 2 * m - bh) / 2) - box.y * cs;
  return { legend: K.pieces, LW: K.LW, LH: K.LH, below: K.below, cs, bw, bh, PW: K.PW, PH: K.PH + (th.footerH || 0) * ks, cx, cy, lx: K.below ? m : bw + 2 * m, ly: K.below ? bh + 2 * m : m, kp: ks, fk };
}
// Page first (print, screen): a page of the preset's shape, the key set at
// the type floor in its own space, and the drawing scaled into the rest —
// beside the key or above it, whichever leaves the drawing bigger.
function pageFirst(scene, th) {
  const { box, opts } = scene, pr = opts.preset || {};
  const Wp = 1000, Hfull = Wp / opts.aspect;
  const fk = opts.minLabelPx ? opts.minLabelPx * Wp / opts.displayWidth : 6, ks = Math.max(fk / 1.7, Wp / 520);
  const Hp = Hfull - (th.footerH || 0) * ks;            // a theme's footer (the blueprint's title row) keeps its band
  const m = (pr.margin || 2) * Math.max(fk, ks), gap = 3.4 * ks, top = pr.valign === "top";
  const mode = opts.legend === false ? "none" : (opts.key || "best");
  const fit = (aw, ah) => Math.max(0.01, Math.min(aw / box.w, ah / box.h));
  if (mode === "none") {
    const cs = fit(Wp - 2 * m, Hp - 2 * m), bw = box.w * cs, bh = box.h * cs;
    const dx = (Wp - bw) / 2, dy = top ? m : (Hp - bh) / 2;
    return { legend: null, LW: 0, LH: 0, below: false, cs, bw, bh, PW: Wp, PH: Hfull, cx: dx - box.x * cs, cy: dy - box.y * cs, lx: 0, ly: 0, kp: ks, fk };
  }
  const F = M.legendFacts(scene);
  const blocksAt = colW => legendBlocks(F, colW, ks, th.legend || {}, th.type, fk);
  // Can the key be set in a W × H space? Fewest columns first, each column
  // between 36 and 64 type units wide.
  const keyIn = (Wa, Ha) => {
    for (let cols = 1; cols <= 4; cols++) {
      const colW = Math.min(64 * ks, (Wa - (cols - 1) * gap) / cols);
      if (colW < 36 * ks) break;
      const fl = flowLegend(blocksAt(colW), colW, cols, gap);
      if (fl.h <= Ha) return { pieces: fl.pieces, LW: cols * colW + (cols - 1) * gap, LH: fl.h };
    }
    return null;
  };
  // the biggest drawing scale at which the key still fits beside (or below)
  const best = isBelow => {
    const room = c => isBelow ? keyIn(Wp - 2 * m, Hp - 3 * m - box.h * c) : keyIn(Wp - 3 * m - box.w * c, Hp - 2 * m);
    let lo = 0, hi = isBelow ? Math.min((Wp - 2 * m) / box.w, (Hp - 3 * m) / box.h) : Math.min((Wp - 3 * m - 36 * ks) / box.w, (Hp - 2 * m) / box.h);
    if (hi <= 0 || !room(hi * 0.02)) return null;
    let K = room(hi); if (K) lo = hi;
    for (let i = 0; i < 18 && !K; i++) { const mid = (lo + hi) / 2, r = room(mid); if (r) lo = mid; else hi = mid; if (hi - lo < hi * 0.004) break; }
    K = K || room(lo);
    if (!K) return null;
    const aw = isBelow ? Wp - 2 * m : Wp - 3 * m - K.LW, ah = isBelow ? Hp - 3 * m - K.LH : Hp - 2 * m;
    return Object.assign(K, { below: isBelow, aw, ah, cs: fit(aw, ah) });
  };
  const cands = [];
  if (mode !== "side") { const b = best(true); if (b) cands.push(b); }
  if (mode !== "below") { const b = best(false); if (b) cands.push(b); }
  if (!cands.length) {
    // a key too long for the page: below the drawing, and the page grows
    const aw = Wp - 2 * m, colW = Math.min(aw, 58 * ks), cols = Math.max(1, Math.floor((aw + gap) / (colW + gap)));
    const fl = flowLegend(blocksAt(colW), colW, cols, gap), ah = Hp * 0.5;
    cands.push({ below: true, pieces: fl.pieces, LW: cols * colW + (cols - 1) * gap, LH: fl.h, aw, ah, cs: fit(aw, ah), grow: true });
  }
  const K = scene.keyAt ? (cands.find(c => (c.below ? "below" : "side") === scene.keyAt) || cands[0]) : cands.reduce((a, b) => b.cs > a.cs * 1.0001 ? b : a);
  scene._keyAt = K.below ? "below" : "side";
  const cs = K.cs, bw = box.w * cs, bh = box.h * cs;
  let PH = Hfull, dx, dy, lx, ly;
  if (K.below) {
    const block = bh + m + K.LH, oy = top ? m : Math.max(m, (Hp - block) / 2);
    dx = m + (K.aw - bw) / 2; dy = oy; lx = m + (K.aw - K.LW) / 2; ly = oy + bh + m;
    if (K.grow) PH = Math.max(Hfull, ly + K.LH + m + (Hfull - Hp));
  } else {
    dx = m + (K.aw - bw) / 2; dy = top ? m : m + (K.ah - bh) / 2;
    lx = m + K.aw + m; ly = top ? m : m + Math.max(0, (K.ah - K.LH) / 2);
  }
  return { legend: K.pieces, LW: K.LW, LH: K.LH, below: K.below, cs, bw, bh, PW: Wp, PH, cx: dx - box.x * cs, cy: dy - box.y * cs, lx, ly, kp: ks, fk };
}

// A page of width W and height H, padded out to aspect (W / H) when one is set.
M.padTo = (W, H, aspect) => !aspect ? { W, H } : (W / H < aspect ? { W: H * aspect, H } : { W, H: W / aspect });


// Roles the projected views add (iso wall boxes, section shells). One table
// per theme, from a small palette, so the three sheet themes stay in step.
const projectedPaint = (C, role) => {
  const m = /^wall([fet])-(\w+)$/.exec(role);
  if (m) {
    const [_, face, t] = m;
    if (t === "glass") return { fill: C.glass, opacity: face === "t" ? 0.9 : 0.45, stroke: C.glassEdge, "stroke-width": 0.08 };
    if (t === "soft") return { fill: C.soft, opacity: 0.55 };
    return Object.assign({ fill: face === "t" ? C.top : face === "f" ? C.face : C.end }, C.edge ? { stroke: C.edge, "stroke-width": 0.1, "stroke-linejoin": "round" } : {});
  }
  switch (role) {
    case "slab": return Object.assign({ fill: C.face }, C.edge ? { stroke: C.edge, "stroke-width": 0.1 } : {});
    case "slab-side": return Object.assign({ fill: C.end }, C.edge ? { stroke: C.edge, "stroke-width": 0.1 } : {});
    case "slab-sec": return Object.assign({ fill: C.top }, C.edge ? { stroke: C.edge, "stroke-width": 0.12, "fill-opacity": 0.2 } : {});
    case "roof": return Object.assign({ fill: C.roof }, C.edge ? { stroke: C.edge, "stroke-width": 0.15, "fill-opacity": 0.15 } : {});
    case "roof-glass": return { fill: C.glass, opacity: 0.55, stroke: C.glassEdge, "stroke-width": 0.2 };
    case "earth": return { fill: C.earth };
    case "water-body": return { fill: C.water };
    case "water-front": return { fill: C.water, opacity: 0.32 };
    case "hull": return Object.assign({ fill: C.hull || C.end }, C.edge ? { stroke: C.edge, "stroke-width": 0.25, "fill-opacity": 0.12 } : {});
    case "deck": return Object.assign({ fill: C.deck || C.gap }, C.edge ? { stroke: C.edge, "stroke-width": 0.12, "fill-opacity": 0.05 } : {});
    case "quay": return { fill: C.quay || C.earth };
    case "drop-ceiling": return { stroke: C.thin, "stroke-dasharray": "0.6 0.5" };
    case "door-leaf-sec": return { fill: C.door };
    case "door-gap": return { fill: C.gap };
    case "skylight-sec": return { fill: C.glass, opacity: 0.8 };
    case "core-link": return { stroke: C.thin, "stroke-dasharray": "1.2 0.9", "stroke-linecap": "round" };
  }
  return null;
};

// Icon roles come in as "ov-kind:part". One table per theme keeps it legible.
const iconPaint = (table, role) => {
  const i = role.indexOf(":"); if (i < 0) return null;
  const kind = role.slice(0, i), part = role.slice(i + 1), c = table[kind] || table["ov-lock"];
  if (part === "icbg") return c[0] ? Object.assign({ fill: c[0] }, c[3] ? { stroke: c[3], "stroke-width": 0.18 } : {}) : null;
  return { fill: part === "ic2" ? c[2] : c[1] };
};

// =============================================================================
// RULEBOOK — the Denee plate: flat colour, hard shadows, grain, no outlines
// =============================================================================
T.rulebook = {
  name: "rulebook",
  describe: "The rulebook plate: flat colour from the location's printed colour scheme, hard cast shadows, grain. No outlines.",
  page: TOK.paper100, shadow: [0.55, 0.75, 0.3], shadowColour: TOK.ink900, grain: 0.22,
  legend: { kicker: "Score site", titleSize: 5.6, cls: "text" },
  // faces (for measuring) and letter-spacing of the words this theme sets
  type: { label: "condensed", labelLS: 0.05, entryLS: 0.15, smLS: 0.2, title: "poster", titleLS: 0, unknown: "poster", key: "text", keyBold: "textBold", keyHead: "condensed", keyHeadLS: 0.35, kickerLS: 0.25, bandLS: 0.15 },
  defs: (id, sc) => defs(id, { dotFill: TOK.ink900, hatchBg: TOK.ink700, hatchFg: TOK.ink500, pxft: sc._pxft, freq: 0.55 }),
  // the theme with its paint and page hooks for a scene (compose draws with it;
  // B68Map.key() borrows its icon and swatch colours)
  painter(scene) {
    const [a, b] = M.own(M.COLOURS, scene.model.colour) || M.COLOURS["grey and charcoal"];
    const BR = M.PALETTE.bands, bandC = (r, n) => palColour(r[n], a, b);
    const C = {
      floor: { public: bandC(BR, "public"), working: bandC(BR, "working"), controlled: bandC(BR, "controlled"), secure: bandC(BR, "secure") },
      fx: mix(b, TOK.ink900, 0.42), fx2: b, fx3: TOK.ink900, fxl: TOK.paper000, fxm: TOK.slate500, fxw: mix(TOK.file500, TOK.paper000, 0.35), fxg: TOK.covert700, fxglow: TOK.caution500, fxline: TOK.ink700
    };
    // "black and white" and "brown and more brown" are dark fields: lift the floors.
    if (hex(a).reduce((s, v) => s + v, 0) < 200) { const D = BR.darkField; C.floor = { public: bandC(D, "public"), working: bandC(D, "working"), controlled: bandC(D, "controlled"), secure: bandC(D, "secure") }; }
    const icons = {
      "ov-target": [TOK.alarm700, TOK.paper000, TOK.alarm700], "ov-lock": [TOK.ink900, TOK.caution500, TOK.ink900],
      "ov-loot": [TOK.caution500, TOK.ink900, TOK.paper000], "ov-pair": [TOK.caution700, TOK.paper000, TOK.caution700],
      "ov-soc": [TOK.signal500, TOK.ink900, TOK.paper000], "ov-phys": [TOK.ink900, TOK.alarm500, TOK.paper000],
      "ov-front": [TOK.ink900, TOK.paper000, TOK.ink900], "ov-service": [TOK.file500, TOK.paper000, TOK.file500], "ov-back": [TOK.swing700, TOK.paper000, TOK.swing700]
    };
    const ENTRY = { "ov-front": TOK.ink900, "ov-service": TOK.file500, "ov-back": TOK.swing700 };
    const self = Object.assign({}, this);
    const PC = { face: TOK.ink700, end: TOK.ink900, top: TOK.ink900, glass: TOK.file300, glassEdge: TOK.file500, soft: b, roof: mix(a, TOK.ink900, 0.45), earth: mix(TOK.rust900 || "#3a2213", TOK.paper200, 0.55), water: mix(TOK.file700, TOK.paper000, 0.25), thin: TOK.ink500, door: TOK.ink700, gap: mix(TOK.paper000, a, 0.06), hull: mix(TOK.rust700, TOK.ink900, 0.45), deck: mix(TOK.paper300, TOK.rust500, 0.35), quay: TOK.paper300 };
    const SPAL = scene.street ? M.streetPalette.flat(scene) : null;
    self.paint = wrapPaint((role, p, mode) => {
      if (SPAL && role.startsWith("st-")) { const sp = M.street.paint(SPAL, role, p); return sp === undefined ? null : sp; }
      const ic = iconPaint(icons, role); if (ic || role.includes(":")) return ic;
      const pj = projectedPaint(PC, role); if (pj) return pj;
      if (role.startsWith("floor-")) { const band = role.slice(6); if (band === "tone") return { fill: `url(#${scene._id}-dots)`, opacity: 0.22 }; if (band === "corridor") return { fill: bandC(BR, "corridor") }; return { fill: C.floor[band] }; }
      if (C[role]) return { fill: C[role] };
      if (role.startsWith("wall-")) {
        const t = role.slice(5);
        if (t === "glass") return { stroke: TOK.file300, "stroke-linecap": "square" };
        if (t === "soft") return { stroke: b, "stroke-dasharray": "0.5 0.7", "stroke-linecap": "round", "stroke-width": 0.45 };
        return { stroke: TOK.ink900, "stroke-linecap": "square", fill: "none" };
      }
      if (role.startsWith("lg-swatch-")) return { fill: C.floor[role.slice(10)] };
      for (const k in ENTRY) if (role.startsWith(k + "-")) {
        const part = role.slice(k.length + 1);
        if (part === "line") return { stroke: ENTRY[k], "stroke-linecap": "round" };
        if (part === "head" || part === "tag") return { fill: ENTRY[k] };
        if (part === "text") return { fill: TOK.paper000, "font-weight": 900, "letter-spacing": 0.15 };
      }
      switch (role) {
        case "site": return { fill: TOK.paper200 };
        case "street": return { fill: TOK.paper300 };
        case "street-label": return { fill: TOK.ink500, "font-weight": 900, "letter-spacing": 0.8 };
        case "footprint": return { fill: TOK.ink900 };
        case "door-swing": return { fill: TOK.paper000, opacity: 0.5 };
        case "door-leaf": return { stroke: TOK.ink900, "stroke-linecap": "round" };
        case "door-curtain": return { fill: b };
        case "door-secret": return { stroke: TOK.alarm700, "stroke-dasharray": "0.5 0.4" };
        case "door-glass": return { stroke: TOK.file300 };
        case "door-vault": return { fill: TOK.slate700 };
        case "door-vaultleaf": return { stroke: TOK.slate700, "stroke-width": 0.8 };
        case "ov-target-area": return { fill: TOK.alarm500, opacity: 0.14 };
        case "ov-cone": return { fill: TOK.caution500, opacity: 0.26 };
        case "ov-pair-line": return { stroke: TOK.caution700, fill: "none", "stroke-dasharray": "1.1 0.8", "stroke-linecap": "round" };
        case "ov-pair-head": return { fill: TOK.caution700 };
        case "ov-skip-line": return { stroke: TOK.alarm700, fill: "none", "stroke-linecap": "round" };
        case "ov-skip-head": case "ov-skip-tag": return { fill: TOK.alarm700 };
        case "ov-skip-tagtext": return { fill: TOK.paper000, "font-weight": 900 };
        case "ov-skip-label": return { fill: TOK.alarm700, "font-weight": 900, "font-style": "italic", stroke: TOK.paper000, "stroke-width": 0.35, "paint-order": "stroke" };
        case "unknown": return { fill: `url(#${scene._id}-hatch)` };
        case "label-unknown": return { fill: TOK.paper200, "font-family": FONT.poster, "font-weight": 900 };
        case "label-bg": return { fill: TOK.paper000, opacity: 0.9 };
        case "label": return { fill: TOK.ink900, "font-weight": 900, "letter-spacing": 0.05 };
        case "label-sm": return { fill: TOK.ink700, "font-weight": 900, "letter-spacing": 0.2 };
        case "num-bg": return { fill: TOK.ink900, stroke: TOK.paper000, "stroke-width": Math.max(0.12, (p.h || 2 * (p.rad || 1)) * 0.07) };
        case "num": return { fill: TOK.paper000, "font-weight": 900 };
        case "leader": return { stroke: TOK.ink900, "stroke-linecap": "round" };
        case "leader-dot": return { fill: TOK.ink900 };
        case "level-title": return { fill: TOK.ink900, "font-family": FONT.poster, "font-weight": 900 };
        case "tok-frame": return { fill: TOK.paper000 };
        case "tok-label": return { fill: TOK.ink900, "font-weight": 900 };
        case "lg-kicker": return { fill: TOK.signal700, "font-weight": 900, "letter-spacing": 0.25 };
        case "lg-title": return { fill: TOK.ink900, "font-family": FONT.poster, "font-weight": 900 };
        case "lg-sub": return { fill: TOK.ink700, "font-family": FONT.text, "font-weight": 700 };
        case "lg-h": return { fill: TOK.ink500, "font-weight": 900, "letter-spacing": 0.35 };
        case "lg-band": return { fill: TOK.ink900, "font-weight": 900, "letter-spacing": 0.15 };
        case "lg-text": return { fill: TOK.ink900, "font-family": FONT.text };
        case "lg-text-strong": return { fill: TOK.ink900, "font-family": FONT.text, "font-weight": 700 };
        case "lg-small": return { fill: TOK.ink700, "font-family": FONT.text };
        case "lg-small-italic": return { fill: TOK.ink500, "font-family": FONT.text, "font-style": "italic" };
        case "lg-chip": return { fill: TOK.ink900 };
      }
      return null;
    });
    scene._id = scene._id || ("b68m" + uid());
    return self;
  },
  compose(scene) { return composePage(scene, this.painter(scene)); }
};

// =============================================================================
// BLUEPRINT — the architect's drawing. The one theme allowed lines (2.2 of the
// style bible is about illustration; a blueprint is a document, not a plate).
// =============================================================================
T.blueprint = {
  name: "blueprint",
  describe: "An architect's blueprint: white linework on blue, hollow walls, a 5 ft grid, title block, red-pencil annotations.",
  page: "#1e4d8f", wallPasses: [null, "hollow"], grain: 0.28, grainBlend: "screen", footerH: 6,
  legend: { kicker: "Drawing", titleSize: 4.6, cls: "mono" },
  type: { label: "mono", labelLS: 0, entryLS: 0, smLS: 0, title: "mono", titleLS: 1, unknown: "mono", key: "mono", keyBold: "mono", keyHead: "mono", keyHeadLS: 0.4, kickerLS: 0.3, bandLS: 0 },
  defs: (id, sc) => defs(id, { dotFill: "#ffffff", hatchBg: "#1e4d8f", hatchFg: "rgba(255,255,255,0.35)", gr: 1, gg: 1, gb: 1, ga: -2.4, gb2: 1.1, freq: 0.5, pxft: sc._pxft }) +
    `<pattern id="${id}-grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0 L0 0 0 5" fill="none" stroke="#ffffff" stroke-opacity="0.09" stroke-width="0.12"/></pattern>` +
    `<pattern id="${id}-grid25" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0 L0 0 0 25" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="0.16"/></pattern>`,
  background: (id, { box, cx, cy, cs }) => `<g transform="translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${cs.toFixed(4)})"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="url(#${id}-grid)"/><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="url(#${id}-grid25)"/></g>`,
  // the theme with its paint and page hooks for a scene (compose draws with it;
  // B68Map.key() borrows its icon and swatch colours)
  painter(scene) {
    const BG = this.page, W = "#f4f6fb", RED = "#ff6a4d", YEL = "#ffd65a";
    const line = (sw, o) => Object.assign({ fill: "none", stroke: W, "stroke-width": sw, "stroke-opacity": 0.92 }, o);
    const icons = {
      "ov-target": [BG, RED, BG, RED], "ov-lock": [BG, YEL, BG, YEL], "ov-loot": [BG, W, BG, W], "ov-pair": [BG, YEL, BG, YEL],
      "ov-soc": [BG, YEL, BG, YEL], "ov-phys": [BG, RED, BG, RED], "ov-front": [BG, W, BG, W], "ov-service": [BG, W, BG, W], "ov-back": [BG, RED, BG, RED]
    };
    const self = Object.assign({}, this);
    const id = scene._id = scene._id || ("b68m" + uid());
    const PC = { face: BG, end: BG, top: "#3f6db0", edge: W, glass: W, glassEdge: W, soft: W, roof: W, earth: "#1a4580", water: "#1a4580", thin: W, door: W, gap: BG };
    const SPAL = scene.street ? M.streetPalette.blue(scene, BG, W, RED, YEL) : null;
    self.paint = wrapPaint((role, p, mode) => {
      if (SPAL && role.startsWith("st-")) { const sp = M.street.paint(SPAL, role, p); return sp === undefined ? null : sp; }
      const ic = iconPaint(icons, role); if (ic || role.includes(":")) return ic;
      const pj = projectedPaint(PC, role); if (pj) { if (role === "glass" || /^wall[fe]-glass/.test(role)) return Object.assign(pj, { fill: W, opacity: 0.12 }); return pj; }
      if (role.startsWith("fx")) {
        if (role === "fx3") return { fill: W, "fill-opacity": 0.22, stroke: W, "stroke-width": 0.12 };
        if (role === "fxglow") return { fill: YEL, "fill-opacity": 0.35, stroke: W, "stroke-width": 0.1 };
        if (role === "fxline") return { fill: W, "fill-opacity": 0.6 };
        return line(0.13, { "fill-opacity": 0 });
      }
      if (role.startsWith("floor-")) { const band = role.slice(6); if (band === "tone") return { fill: `url(#${id}-hatch)`, opacity: 0.6 }; return { fill: W, "fill-opacity": { public: 0.02, working: 0.05, controlled: 0.09, secure: 0.12, corridor: 0.0 }[band] || 0 }; }
      if (role.startsWith("wall-")) {
        const t = role.slice(5);
        if (mode === "hollow") return t === "soft" || t === "glass" || p.sw < 0.7 ? null : { stroke: BG, "stroke-width": p.sw - 0.34, "stroke-linecap": "square", fill: "none" };
        if (t === "soft") return { stroke: W, "stroke-dasharray": "0.6 0.6", "stroke-width": 0.22, fill: "none" };
        if (t === "glass") return { stroke: W, "stroke-width": 0.42, fill: "none" };
        return { stroke: W, "stroke-linecap": "square", fill: "none" };
      }
      if (role.startsWith("lg-swatch-")) { const o = { public: 0.06, working: 0.16, controlled: 0.3, secure: 0.5 }[role.slice(10)]; return { fill: W, "fill-opacity": o, stroke: W, "stroke-width": 0.15 }; }
      for (const k of ["ov-front", "ov-service", "ov-back"]) if (role.startsWith(k + "-")) {
        const c = k === "ov-back" ? RED : W, part = role.slice(k.length + 1);
        if (part === "line") return { stroke: c, "stroke-dasharray": k === "ov-front" ? null : "1.2 0.8" };
        if (part === "head") return { fill: c };
        if (part === "tag") return { fill: BG, stroke: c, "stroke-width": 0.2 };
        if (part === "text") return { fill: c, "font-family": FONT.mono, "font-weight": 700 };
      }
      switch (role) {
        case "site": return null;
        case "footprint": return { fill: W, "fill-opacity": 0.03 };
        case "street": return { fill: W, "fill-opacity": 0.04, stroke: W, "stroke-opacity": 0.4, "stroke-width": 0.15, "stroke-dasharray": "2 1" };
        case "street-label": return { fill: W, "fill-opacity": 0.7, "font-family": FONT.mono, "letter-spacing": 0.6 };
        case "door-swing": return { fill: "none", stroke: W, "stroke-width": 0.1, "stroke-opacity": 0.7 };
        case "door-leaf": return { stroke: W, "stroke-width": 0.22 };
        case "door-curtain": return { fill: W, "fill-opacity": 0.7 };
        case "door-secret": return { stroke: RED, "stroke-dasharray": "0.4 0.35", "stroke-width": 0.4 };
        case "door-glass": return { stroke: W, "stroke-width": 0.14 };
        case "door-vault": return { fill: "none", stroke: W, "stroke-width": 0.3 };
        case "door-vaultleaf": return { stroke: W, "stroke-width": 0.5 };
        case "ov-target-area": return { fill: RED, "fill-opacity": 0.1, stroke: RED, "stroke-width": 0.35, "stroke-dasharray": "1.4 0.8" };
        case "ov-cone": return { fill: YEL, "fill-opacity": 0.16, stroke: YEL, "stroke-opacity": 0.6, "stroke-width": 0.12 };
        case "ov-pair-line": return { stroke: YEL, fill: "none", "stroke-dasharray": "1 0.7" };
        case "ov-pair-head": return { fill: YEL };
        case "ov-skip-line": return { stroke: RED, fill: "none" };
        case "ov-skip-head": return { fill: RED };
        case "ov-skip-tag": return { fill: BG, stroke: RED, "stroke-width": 0.2 };
        case "ov-skip-tagtext": return { fill: RED, "font-family": FONT.mono, "font-weight": 700 };
        case "ov-skip-label": return { fill: RED, "font-family": FONT.mono, "font-weight": 700, stroke: BG, "stroke-width": 0.4, "paint-order": "stroke" };
        case "unknown": return { fill: `url(#${id}-hatch)` };
        case "label-unknown": return { fill: W, "fill-opacity": 0.5, "font-family": FONT.mono, "font-weight": 700 };
        case "label-bg": return { fill: BG, opacity: 0.82 };
        case "label": return { fill: W, "font-family": FONT.mono, "font-weight": 700 };
        case "label-sm": return { fill: W, "font-family": FONT.mono, "fill-opacity": 0.8 };
        case "num-bg": return { fill: BG, stroke: W, "stroke-width": 0.15 };
        case "num": return { fill: W, "font-family": FONT.mono, "font-weight": 700 };
        case "leader": return { stroke: W, "stroke-opacity": 0.9 };
        case "leader-dot": return { fill: W };
        case "level-title": return { fill: W, "font-family": FONT.mono, "font-weight": 700, "letter-spacing": 1 };
        case "tok-frame": return { fill: BG, stroke: W, "stroke-width": 0.2 };
        case "tok-label": return { fill: W, "font-family": FONT.mono };
        case "lg-kicker": return { fill: W, "fill-opacity": 0.7, "font-family": FONT.mono, "letter-spacing": 0.3 };
        case "lg-title": return { fill: W, "font-family": FONT.mono, "font-weight": 700 };
        case "lg-sub": case "lg-text": case "lg-small": return { fill: W, "fill-opacity": role === "lg-small" ? 0.78 : 0.95, "font-family": FONT.mono };
        case "lg-text-strong": case "lg-band": return { fill: W, "font-family": FONT.mono, "font-weight": 700 };
        case "lg-h": return { fill: YEL, "font-family": FONT.mono, "font-weight": 700, "letter-spacing": 0.4 };
        case "lg-small-italic": return { fill: W, "fill-opacity": 0.7, "font-family": FONT.mono, "font-style": "italic" };
        case "lg-chip": return { fill: W, "fill-opacity": 0.6 };
      }
      return null;
    });
    // The title block: a ruled box, a drawing number, a scale bar and north.
    self.legendBackground = (id, LW, LH, k) => `<rect x="${-2.4 * k}" y="${-2.4 * k}" width="${LW + 4.8 * k}" height="${LH + 4.8 * k}" fill="none" stroke="${W}" stroke-width="${0.25}" stroke-opacity="0.8"/>`;
    self.foreground = (id, { PW, PH, k, scene: sc, floor }) => {
      const no = "DRG " + ((sc.model.target || "BLD").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase().padEnd(3, "X")) + "-968-" + String(M.hash(sc.model.name) % 10000).padStart(4, "0");
      // the footer row: a 25 ft scale bar at the drawing's own scale (along an
      // iso axis, in iso), the drawing number, north — all at the type floor or above
      const s = k, fs = Math.max(1.3 * s, floor || 0), x = 4 * k, y = PH - 2.2 * k - fs * 0.4, ft = (sc._cs || 1) * (sc.opts.view === "iso" || sc.opts.view === "street" ? Math.cos(Math.PI / 6) : 1);
      // north is the plan's up; in iso and on the street it turns with the corner the view looks in from
      const northRot = sc.opts.view === "iso" ? (sc.lay && sc.lay.isoCorner === "left" ? -60 : 60) : sc.street ? (sc.street.flip ? -60 : 60) : 0;
      const bar = [0, 1, 2, 3, 4].map(i => `<rect x="${(i * 5 * ft).toFixed(2)}" y="${(-1.1 * s).toFixed(2)}" width="${(5 * ft).toFixed(2)}" height="${(0.9 * s).toFixed(2)}" fill="${i % 2 ? "none" : W}" stroke="${W}" stroke-width="0.15"/>`).join("");
      return `<g font-family='${FONT.mono}' fill="${W}"><rect x="1.2" y="1.2" width="${(PW - 2.4).toFixed(2)}" height="${(PH - 2.4).toFixed(2)}" fill="none" stroke="${W}" stroke-opacity="0.7" stroke-width="0.3"/>` +
        `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)})">${bar}<text x="0" y="${(-1.6 * s).toFixed(2)}" font-size="${fs.toFixed(2)}">0</text><text x="${(25 * ft).toFixed(2)}" y="${(-1.6 * s).toFixed(2)}" font-size="${fs.toFixed(2)}" text-anchor="middle">25 FT</text>` +
        `<text x="${(25 * ft + 3 * s).toFixed(2)}" y="${(-0.2 * s).toFixed(2)}" font-size="${(fs * 1.12).toFixed(2)}" font-weight="700">${M.esc(no)} · DOSKVOL · 968 AC</text></g>` +
        `<g transform="translate(${(PW - 4.5 * k).toFixed(2)} ${(PH - 3.2 * k).toFixed(2)})"><circle r="${1.8 * k}" fill="none" stroke="${W}" stroke-width="0.2"/><path transform="rotate(${northRot})" d="M0 ${-1.6 * k} L${0.6 * k} ${0.8 * k} L0 ${0.35 * k} L${-0.6 * k} ${0.8 * k} Z" fill="${W}"/><text x="${(-2.4 * k).toFixed(2)}" y="${(0.4 * k).toFixed(2)}" font-size="${fs.toFixed(2)}" text-anchor="end" font-weight="700">N</text></g></g>`;
    };
    return self;
  },
  compose(scene) { return composePage(scene, this.painter(scene)); }
};

// =============================================================================
// CASE FILE — City Watch of Duskwall surveillance copy
// =============================================================================
T.casefile = {
  name: "casefile",
  describe: "A City Watch of Duskwall case file: a photocopied plan, typewriter labels, red grease pencil, a rubber stamp. The player layer redacts.",
  page: "#f3efe4", shadow: [0.4, 0.5, 0.2], shadowColour: "#2a2521", grain: 0.42, contentFilter: "copy", gameFilter: "rough",
  legend: { kicker: "Case file", titleSize: 4.4, cls: "typewriter" },
  type: { label: "typewriter", labelLS: 0, entryLS: 0, smLS: 0, title: "typewriter", titleLS: 0, unknown: "typewriter", key: "typewriter", keyBold: "typewriter", keyHead: "typewriter", keyHeadLS: 0, kickerLS: 0.2, bandLS: 0 },
  defs: (id, sc) => defs(id, { dotFill: "#14110e", hatchBg: "#14110e", hatchFg: "#14110e", rough: 0.9, copy: true, freq: 0.6, ga: -1.7, pxft: sc._pxft }),
  // the theme with its paint and page hooks for a scene (compose draws with it;
  // B68Map.key() borrows its icon and swatch colours)
  painter(scene) {
    const RED = "#c22f1c", INK = "#1a1816";
    const icons = {
      "ov-target": [null, RED, RED], "ov-lock": ["#f3efe4", RED, "#f3efe4", RED], "ov-loot": ["#f3efe4", INK, "#f3efe4", INK], "ov-pair": ["#f3efe4", INK, "#f3efe4", INK],
      "ov-soc": ["#f3efe4", RED, "#f3efe4", RED], "ov-phys": [RED, "#f3efe4", RED], "ov-front": [INK, "#f3efe4", INK], "ov-service": [INK, "#f3efe4", INK], "ov-back": [RED, "#f3efe4", RED]
    };
    const G = { public: "#f8f6f0", working: "#e6e2d8", controlled: "#d2cdc1", secure: "#b9b3a6" };
    const self = Object.assign({}, this);
    const id = scene._id = scene._id || ("b68m" + uid());
    const player = scene.opts.layer === "player";
    const PC = { face: "#55504a", end: "#2a2521", top: "#1a1816", glass: "#b8b4ab", glassEdge: "#55504a", soft: "#8a857d", roof: "#3a3632", earth: "#cfcabf", water: "#c4c0b6", thin: "#55504a", door: "#2a2521", gap: "#fbfaf6", hull: "#3a3632", deck: "#d9d5cb", quay: "#dcd8cd" };
    // the street is a surveillance photograph: the plate's colours, through the copy filter
    const SPAL = scene.street ? Object.assign(M.streetPalette.flat(scene), { tag: () => ({ fill: "#fbf8f1", stroke: INK, "stroke-width": 0.2 }), tagText: () => ({ fill: INK, "font-family": FONT.typewriter, "font-weight": 700 }) }) : null;
    self.paint = wrapPaint((role, p, mode) => {
      if (SPAL && role.startsWith("st-")) { const sp = M.street.paint(SPAL, role, p); return sp === undefined ? null : sp; }
      const ic = iconPaint(icons, role); if (ic || role.includes(":")) return ic;
      const pj = projectedPaint(PC, role); if (pj) return pj;
      const fxc = { fx: "#6f6a63", fx2: "#4e4a44", fx3: "#1f1c19", fxl: "#fbf8f1", fxm: "#8f8a82", fxw: "#a9a59c", fxg: "#625f58", fxglow: "#e7e3d8", fxline: "#1f1c19" };
      if (fxc[role]) return { fill: fxc[role] };
      if (role.startsWith("floor-")) { const band = role.slice(6); if (band === "tone") return { fill: `url(#${id}-dots)`, opacity: 0.16 }; if (band === "corridor") return { fill: "#fbfaf6" }; return { fill: G[band] }; }
      if (role.startsWith("wall-")) { const t = role.slice(5); if (t === "soft") return { stroke: INK, "stroke-dasharray": "0.5 0.6", "stroke-width": 0.3 }; if (t === "glass") return { stroke: "#6b665f" }; return { stroke: INK, "stroke-linecap": "square", fill: "none" }; }
      if (role.startsWith("lg-swatch-")) return { fill: G[role.slice(10)], stroke: INK, "stroke-width": 0.12 };
      for (const k of ["ov-front", "ov-service", "ov-back"]) if (role.startsWith(k + "-")) {
        const c = k === "ov-front" ? INK : RED, part = role.slice(k.length + 1);
        if (part === "line") return { stroke: c, "stroke-linecap": "round", filter: `url(#${id}-rough)` };
        if (part === "head") return { fill: c, filter: `url(#${id}-rough)` };
        if (part === "tag") return { fill: "#fbf8f1", stroke: c, "stroke-width": 0.18 };
        if (part === "text") return { fill: c, "font-family": FONT.typewriter, "font-weight": 700 };
      }
      switch (role) {
        case "site": return { fill: "#ebe7dc" };
        case "street": return { fill: "#dcd8cd" };
        case "street-label": return { fill: "#55504a", "font-family": FONT.typewriter, "letter-spacing": 0.5 };
        case "footprint": return { fill: INK };
        case "door-swing": return { fill: "none", stroke: "#55504a", "stroke-width": 0.1 };
        case "door-leaf": return { stroke: INK, "stroke-width": 0.22 };
        case "door-curtain": return { fill: "#55504a" };
        case "door-secret": return { stroke: RED, "stroke-dasharray": "0.5 0.4", "stroke-width": 0.5 };
        case "door-glass": return { stroke: "#6b665f" };
        case "door-vault": return { fill: "#55504a" };
        case "door-vaultleaf": return { stroke: "#55504a", "stroke-width": 0.7 };
        case "ov-target-area": return { fill: "none", stroke: RED, "stroke-width": 0.9, "stroke-linejoin": "round" };
        case "ov-cone": return { fill: RED, opacity: 0.12 };
        case "ov-pair-line": return { stroke: INK, fill: "none", "stroke-dasharray": "0.9 0.7" };
        case "ov-pair-head": return { fill: INK };
        case "ov-skip-line": return { stroke: RED, fill: "none", "stroke-linecap": "round" };
        case "ov-skip-head": return { fill: RED };
        case "ov-skip-tag": return { fill: "#fbf8f1", stroke: RED, "stroke-width": 0.18 };
        case "ov-skip-tagtext": return { fill: RED, "font-family": FONT.typewriter, "font-weight": 700 };
        case "ov-skip-label": return { fill: RED, "font-family": FONT.typewriter, "font-weight": 700, stroke: "#f3efe4", "stroke-width": 0.35, "paint-order": "stroke" };
        case "unknown": return { fill: INK };
        case "label-unknown": return { fill: "#f3efe4", "font-family": FONT.typewriter, "font-weight": 700 };
        case "label-bg": return { fill: "#fbf8f1", stroke: INK, "stroke-width": 0.08 };
        case "label": return { fill: INK, "font-family": FONT.typewriter, "font-weight": 700 };
        case "label-sm": return { fill: INK, "font-family": FONT.typewriter };
        case "num-bg": return { fill: INK, stroke: "#fbf8f1", "stroke-width": Math.max(0.12, (p.h || 2 * (p.rad || 1)) * 0.07) };
        case "num": return { fill: "#fbf8f1", "font-family": FONT.typewriter, "font-weight": 700 };
        case "leader": return { stroke: INK };
        case "leader-dot": return { fill: INK };
        case "level-title": return { fill: INK, "font-family": FONT.typewriter, "font-weight": 700, "text-decoration": "underline" };
        case "tok-frame": return { fill: "#fbf8f1", stroke: INK, "stroke-width": 0.1 };
        case "tok-label": return { fill: INK, "font-family": FONT.typewriter };
        case "lg-kicker": return { fill: RED, "font-family": FONT.typewriter, "font-weight": 700, "letter-spacing": 0.2 };
        case "lg-title": return { fill: INK, "font-family": FONT.typewriter, "font-weight": 700 };
        case "lg-h": return { fill: INK, "font-family": FONT.typewriter, "font-weight": 700, "text-decoration": "underline" };
        case "lg-sub": case "lg-text": case "lg-band": return { fill: INK, "font-family": FONT.typewriter };
        case "lg-text-strong": return { fill: INK, "font-family": FONT.typewriter, "font-weight": 700 };
        case "lg-small": return { fill: "#3a3632", "font-family": FONT.typewriter };
        case "lg-small-italic": return { fill: "#55504a", "font-family": FONT.typewriter, "font-style": "italic" };
        case "lg-chip": return { fill: INK };
      }
      return null;
    });
    // Unknown rooms in the player copy are redaction bars; the GM copy gets
    // the grease-pencil circle on the target and a stamp.
    self.foreground = (id, { PW, PH, k, scene: sc, lx, ly, LW, LH }) => {
      const code = "CWD-968-" + String(M.hash(sc.model.name + sc.model.district) % 10000).padStart(4, "0");
      const st = sc.street ? (player ? "STREET SURVEY" : "SURVEILLANCE — DO NOT REMOVE") : player ? "SURVEY — PARTIAL" : "EVIDENCE — DO NOT REMOVE";
      const w = st.length * 1.25 * k + 4 * k;
      const D = sc._drawRect || { x: 0, y: 0, w: sc.box.w, h: sc.box.h };
      let x = D.x + D.w - w * 0.55, y = D.y + D.h - 3 * k, s = 1;
      // a place on the drawing clear of every tag, arrow and the key (M.street.stampAt)
      // (a building view's stays bottom right wherever that is clear)
      ({ x, y, s } = M.street.stampAt(sc, D, w, M.textW("CITY WATCH OF DUSKWALL · " + code, 1.3 * k, "typewriter"), k, -7, LW ? { x: lx, y: ly, w: LW, h: LH } : null, sc.street ? null : [x, y]));
      return `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(-7)${s !== 1 ? ` scale(${s})` : ""}" opacity="0.82" filter="url(#${id}-rough)"><rect x="${-w / 2}" y="${-3 * k}" width="${w}" height="${5.2 * k}" fill="none" stroke="${RED}" stroke-width="${0.45 * k}"/><text y="${-0.2 * k}" font-family='${FONT.typewriter}' font-weight="700" font-size="${2 * k}" fill="${RED}" text-anchor="middle" letter-spacing="0.3">${M.esc(st)}</text><text y="${1.6 * k}" font-family='${FONT.typewriter}' font-size="${1.3 * k}" fill="${RED}" text-anchor="middle">CITY WATCH OF DUSKWALL · ${code}</text></g>`;
    };
    return self;
  },
  compose(scene) { return composePage(scene, this.painter(scene)); }
};

// =============================================================================
// HEIST BOARD — the plan pinned to cork, cards and string
// =============================================================================
// Composes a sheet (any other theme, without its legend) onto cork, and puts
// the facts on index cards around it, strung to the rooms they're about.
T.board = {
  name: "board",
  describe: "The crew's planning board: the plan pinned to cork, index cards for the target, threats and ways in, red string to the rooms, portraits as polaroids.",
  compose(scene) {
    const { opts, model, k } = scene;
    const sheetTheme = T[opts.sheet] && opts.sheet !== "board" ? opts.sheet : "blueprint";
    const inner = T[sheetTheme].compose(Object.assign({}, scene, { opts: Object.assign({}, opts, { legend: false, grain: false, width: 1000 }), tokens: [] }));
    const sw = inner.PW, sh = inner.PH;
    const F = M.legendFacts(scene);
    const cardW = 34 * k, gutter = 8 * k, colX = [gutter, gutter + cardW + gutter + sw + gutter];
    const sheetX = gutter * 2 + cardW, sheetY = 12 * k;
    const rot = -1.1, scx = sheetX + sw / 2, scy = sheetY + sh / 2;
    const toBoard = (x, y) => { // sheet-content coords → board
      const cs = inner.content.cs || 1, px = x * cs + inner.content.cx + sheetX, py = y * cs + inner.content.cy + sheetY, a = rot * Math.PI / 180;
      const dx = px - scx, dy = py - scy;
      return [scx + dx * Math.cos(a) - dy * Math.sin(a), scy + dx * Math.sin(a) + dy * Math.cos(a)];
    };
    const roomPos = r => { if (!r || !r.frame) return null; const p = scene.roomPos(r); return p ? toBoard(p[0], p[1]) : null; };
    const rng = M.rng(M.hash(model.name + "board"));
    // Cards: left column the target and threats, right column the ways in.
    const cards = [];
    const player = opts.layer === "player";
    if (scene.street) {
      // the street: its obstacle, the landmark, and the ways in, strung to where they are
      for (const c of M.street.boardCards(scene, F)) cards.push(Object.assign(c, { at: c.sheetAt ? toBoard(c.sheetAt[0], c.sheetAt[1]) : null, pin: c.pin || "#14110e" }));
    } else {
      const tgt = model.rooms.find(r => r.isTarget);
      if (!player && tgt) cards.push({ col: 0, head: "THE TARGET", lines: [`${tgt.n} · ${tgt.name}`, model.targetWhat, model.approach ? `${model.approach}: ${model.gambit}` : ""], room: tgt, pin: "#c22f1c" });
      for (const t of F.threats) cards.push({ col: 0, head: `${t.kind.toUpperCase()} THREAT`, lines: [t.name, t.text], room: model.rooms.find(r => t.kind === "Social" ? r.band === "working" : r.band === "controlled"), pin: t.kind === "Social" ? "#e0691e" : "#14110e" });
      const obs = model.rooms.filter(r => r.obstacle && !player);
      if (obs.length) cards.push({ col: 0, head: "IN THE WAY", lines: obs.map(r => `${r.n} · ${r.obstacle}`), pin: "#e8c33c" });
      scene.lay.entries.forEach((e, i) => {
        if (player && e.vec && /can't be known/.test(e.vec.know)) return;
        const ep = scene.toScreen(e.level, e.x, e.y, "floor");
        const hush = player && e.vec && /question/.test(e.vec.know);
        cards.push({ col: 1, head: (e.vec ? e.vec.n : e.kind).toUpperCase(), lines: e.vec ? (hush ? ["There is a way in here.", "(costs a question)"] : [e.vec.how, e.vec.cost, `(${e.vec.know})`]) : [], at: toBoard(ep[0], ep[1]), pin: ["#14110e", "#3f62c4", "#98206a"][i] });
      });
    }
    const tokens = scene.tokens.map(t => ({ col: 1, polaroid: t, room: t.roomObj, pin: "#c22f1c" }));
    const all = cards.concat(tokens);
    const colY = [sheetY, sheetY];
    const fs = 1.75 * k, CH = M.ADVANCE.typewriter;
    let out = "";
    const placed = [];
    for (const c of all) {
      let h, body = "";
      if (c.polaroid) {
        const s = cardW * 0.62; h = s * 1.11 + 7 * k;
        body = `<rect width="${s + 3 * k}" height="${h}" fill="#fbf8f1"/><svg x="${1.5 * k}" y="${1.5 * k}" width="${s}" height="${s * 1.11}" viewBox="0 0 540 600" preserveAspectRatio="xMidYMid slice">${String(c.polaroid.svg).replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")}</svg><text x="${(s + 3 * k) / 2}" y="${s * 1.11 + 5 * k}" font-family='${FONT.script}' font-size="${2.6 * k}" fill="#14110e" text-anchor="middle">${M.esc(c.polaroid.label || c.polaroid.room)}</text>`;
        c.w = s + 3 * k;
      } else {
        const lines = c.lines.filter(Boolean).flatMap(l => M.wrap(l, Math.floor((cardW - 4 * k) / (fs * CH))));
        h = 6.2 * k + lines.length * fs * 1.3 + 2 * k;
        body = `<rect width="${cardW}" height="${h}" fill="#f8f3e6"/><rect y="${4.4 * k}" width="${cardW}" height="0.25" fill="#c22f1c"/>` +
          lines.map((l, i) => `<rect y="${6.2 * k + (i + 1) * fs * 1.3 + 0.35}" width="${cardW}" height="0.08" fill="#8fa3dd"/>`).join("") +
          `<text x="${2 * k}" y="${3.2 * k}" font-family='${FONT.typewriter}' font-weight="700" font-size="${2 * k}" fill="#14110e">${M.esc(c.head)}</text>` +
          lines.map((l, i) => `<text x="${2 * k}" y="${6.2 * k + (i + 1) * fs * 1.3}" font-family='${FONT.typewriter}' font-size="${fs}" fill="#2a2521">${M.esc(l)}</text>`).join("");
        c.w = cardW;
      }
      const x = colX[c.col] + (cardW - c.w) / 2, y = colY[c.col], r = rng.range(-3, 3);
      colY[c.col] += h + 4 * k;
      c.pinAt = [x + c.w - 2.6 * k, y + 1.8 * k];
      placed.push(`<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${r.toFixed(2)} ${c.w / 2} ${h / 2})"><rect x="0.6" y="0.9" width="${c.w}" height="${h}" fill="#000" opacity="0.28"/>${body}</g>`);
    }
    const H = Math.max(sheetY + sh + 12 * k, colY[0] + 6 * k, colY[1] + 6 * k), Wd = colX[1] + cardW + gutter;
    // string
    let strings = "";
    for (const c of all) {
      const to = c.at || roomPos(c.room);
      if (!to) continue;
      const [x0, y0] = c.pinAt, sag = Math.min(14 * k, Math.hypot(to[0] - x0, to[1] - y0) * 0.12);
      strings += `<path d="M${x0.toFixed(2)} ${y0.toFixed(2)} Q${((x0 + to[0]) / 2).toFixed(2)} ${((y0 + to[1]) / 2 + sag).toFixed(2)} ${to[0].toFixed(2)} ${to[1].toFixed(2)}" fill="none" stroke="#a51d16" stroke-width="${0.32 * k}" stroke-linecap="round"/>`;
      strings += `<circle cx="${to[0].toFixed(2)}" cy="${to[1].toFixed(2)}" r="${0.75 * k}" fill="${c.pin}"/><circle cx="${(to[0] - 0.25 * k).toFixed(2)}" cy="${(to[1] - 0.25 * k).toFixed(2)}" r="${0.25 * k}" fill="#fff" opacity="0.6"/>`;
    }
    const pins = all.map(c => `<circle cx="${c.pinAt[0].toFixed(2)}" cy="${c.pinAt[1].toFixed(2)}" r="${1 * k}" fill="${c.pin}"/><circle cx="${(c.pinAt[0] - 0.3 * k).toFixed(2)}" cy="${(c.pinAt[1] - 0.3 * k).toFixed(2)}" r="${0.3 * k}" fill="#fff" opacity="0.6"/>`).join("");
    const sheetPins = [[sheetX + 3 * k, sheetY + 3 * k], [sheetX + sw - 3 * k, sheetY + 3 * k], [sheetX + 3 * k, sheetY + sh - 3 * k], [sheetX + sw - 3 * k, sheetY + sh - 3 * k]]
      .map(([x, y]) => { const cs = inner.content.cs || 1; const [bx, by] = toBoard((x - inner.content.cx - sheetX) / cs, (y - inner.content.cy - sheetY) / cs); return `<circle cx="${bx.toFixed(2)}" cy="${by.toFixed(2)}" r="${1.1 * k}" fill="#d9a62e"/>`; }).join("");
    const id = (scene._id || ("b68m" + uid())) + "-board";
    const head =`<text x="${Wd / 2}" y="${8 * k}" font-family='${FONT.script}' font-size="${5.4 * k}" fill="#fbf8f1" text-anchor="middle" opacity="0.92">${M.esc(scene.street ? scene.street.facts.name : model.name)}</text>`;
    // The pinned sheet keeps its own type: its labels inherit the root font.
    const sheetSvg = inner.svg.replace(/^<svg[^>]*>/, `<svg x="${sheetX}" y="${sheetY}" width="${sw}" height="${sh}" viewBox="0 0 ${sw} ${sh}" font-family='${FONT.condensed}'>`).replace(/<title id="[^"]*">[^<]*<\/title>(<desc id="[^"]*">[^<]*<\/desc>)?/, "");
    const lab = M.svgLabel(scene, id);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" font-weight="400" font-style="normal" viewBox="0 0 ${Wd.toFixed(2)} ${H.toFixed(2)}" width="${opts.width}" height="${Math.round(opts.width * H / Wd)}"${lab.attrs}>${lab.inner}<defs><filter id="${id}-cork" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="11"/><feColorMatrix values="0 0 0 0 0.22  0 0 0 0 0.12  0 0 0 0 0.05  0 0 0 -2.2 1.25"/></filter></defs>` +
      `<rect width="100%" height="100%" fill="#b8874f"/><rect width="100%" height="100%" filter="url(#${id}-cork)" opacity="0.9"/>${head}` +
      `<g transform="rotate(${rot} ${scx} ${scy})"><rect x="${sheetX + 0.8}" y="${sheetY + 1.2}" width="${sw}" height="${sh}" fill="#000" opacity="0.3"/>${sheetSvg}</g>${sheetPins}${placed.join("")}${strings}${pins}</svg>`;
    return { svg, width: opts.width, height: Math.round(opts.width * H / Wd), PW: Wd, PH: H, content: { cs: inner.content.cs || 1 } };
  }
};

// ---- src/plate.js ----
// =============================================================================
// plate — the plate theme (WAVE2-SPEC M2.1)
// =============================================================================
// The roll drawn the way Denee's plates are lit, for covers, session openers and
// the TV. One light, from the light contract (light.js):
//   Bluetime (look B, "built"): the public band lit from the street and each band
//     inward darker, down to the scheme's deep dark (palette.plate.deep, a *-900);
//     long hard shadows away from the street, stippled where they end; the hero
//     pieces stand up as boxes at their side-view heights (a lit face toward the
//     street, a shaded side, the piece's own drawing on top); chairs and rugs stay
//     flat; each room keeps its few biggest pieces.
//   Night (look C): no sun and no cast shadows; the building near black; the
//     target glows (the GM's copy only: a player copy never says which room it
//     is); lamps and screens pool light; light spills from the doors the crew
//     can use; the key goes light-on-dark.
// Time from the roll's timeOfDay (any time with "night" in it is Night), or
// `time` / `light` on request, as the street does. Weather (E4) from the roll's.
// The iso and the street get all of it; the plan and rings get the palette, the
// shadows and the night's light; the section gets the palette. [interpretation]

const PL = M.plate = {};
const lumOf = c => { const [r, g, b] = hex(c); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

// Side-view heights of the pieces that stand up, in feet. A piece not here
// stays flat (chairs, rugs, stairs, hatches, the ways in). [interpretation]
PL.HEIGHT = {
  table: 2.5, "table-round": 2.5, "table-long": 2.5, "coffee-table": 1.4, desk: 2.5, "desk-big": 2.6, "typing-desk": 2.5, filing: 4.5, shelf: 6, bookcase: 6.5,
  counter: 3.5, bar: 3.6, workbench: 3, console: 3.4, "monitor-wall": 7, computer: 6, lockers: 6, bed: 2, "bed-round": 2, bunk: 5, wardrobe: 6, stove: 3, sink: 3,
  "kitchen-run": 3, "toilet-stall": 6.5, bath: 2, piano: 3.4, planter: 2.5, hedge: 4, sculpture: 6, fireplace: 4.5, "display-case": 3.5, trunk: 2, crate: 3,
  pallet: 1, barrel: 3, "wine-rack": 6, slots: 5.5, roulette: 3, "card-table": 2.6, "dice-table": 3, stage: 2, screen: 7, "dj-booth": 3.5, "record-player": 3,
  plasmovision: 4, billiards: 2.8, "vault-door": 7, "deposit-wall": 7, safe: 4, "cash-cart": 3.4, "count-table": 3, "teller-counter": 3.8, cell: 7,
  "evidence-cage": 7, conveyor: 3, machine: 5, boiler: 7, tank: 7, transformer: 6, "washer-row": 3.4, autopod: 5, forklift: 6, "lab-bench": 3, apparatus: 7,
  "cryo-tank": 7, boat: 4, "car-lift": 2, "seat-row": 0, booth: 0
};
// Pieces that are a way in, a way up or a landing: always kept, always flat.
PL.KEEP = new Set(["stairs", "stairs-spiral", "lift", "ladder", "skylight", "hatch", "roof-hatch", "catwalk", "fire-escape", "area-steps", "balcony", "doorframe", "vault-door"]);
// What gives light at Night: a warm lamp, a screen's cool light, a fire.
PL.LIGHTS = {
  chandelier: "warm", bar: "warm", stage: "warm", "dj-booth": "screen", desk: "warm", "desk-big": "warm", "typing-desk": "warm", "lab-bench": "warm", "card-table": "warm",
  roulette: "warm", "dice-table": "warm", billiards: "warm", piano: "warm", "count-table": "warm", "teller-counter": "warm", counter: "warm", workbench: "warm",
  "monitor-wall": "screen", screen: "screen", plasmovision: "screen", computer: "screen", console: "screen", slots: "screen", apparatus: "screen", "cryo-tank": "screen",
  orb: "screen", fireplace: "fire", boiler: "fire", flame: "fire"
};

// The light this render is drawn in, for a building view (the street keeps its own in scene.street).
PL.lightOf = function (scene) {
  if (scene._plateT) return scene._plateT;
  if (scene.street) return (scene._plateT = { time: scene.street.night ? "Night" : "Bluetime", light: scene.street.light || M.light.resolve(scene.street.night ? "night" : "bluetime"), asPlayed: false });
  const m = scene.model || {};
  return (scene._plateT = M.light.forRoll({ timeOfDay: m.time || "" }, scene.opts || {}, scene.W || []));
};

// The palette for a scheme and a time.
PL.colours = function (scheme, night) {
  const [a1, b] = M.own(M.COLOURS, scheme) || M.COLOURS["grey and charcoal"];
  // a near-black field ("black and white") would vanish into the night: lift it toward its accent [interpretation]
  const a = night && lumOf(a1) < 0.18 ? mix(a1, b, 0.4) : a1;
  const deepTok = (M.PALETTE.plate && M.PALETTE.plate.deep[scheme]) || "ink-900", deep = M.PALETTE.inks[deepTok] || TOK.ink900;
  const pap = TOK.paper000, ink = TOK.ink900, NI = TOK.slate900 || "#1a1a1c";
  const lightB = lumOf(b) > 0.62, accent = lightB ? mix(a, deep, 0.5) : mix(b, deep, 0.2);
  const C = { a, b, deep, night };
  if (!night) {
    C.page = TOK.paper200; C.site = TOK.paper100; C.street = mix(TOK.paper300, TOK.ink300, 0.25); C.streetLabel = TOK.ink500;
    C.floor = { public: mix(pap, a, 0.24), working: mix(pap, a, 0.48), controlled: mix(a, deep, 0.38), secure: mix(deep, a, 0.08), corridor: mix(pap, a, 0.12) };
    C.wallTop = mix(deep, ink, 0.2); C.wallLit = mix(a, deep, 0.22); C.wallShade = mix(a, deep, 0.66); C.wallLine = mix(deep, ink, 0.25);
    C.shadow = mix(deep, M.light.PRESETS.bluetime.shadow.color, 0.55); C.shadowOp = 0.42;
    C.fx = { lit: { fx: accent, fx2: mix(a, deep, 0.28), fx3: mix(deep, ink, 0.35), fxl: pap, fxm: mix(TOK.slate500, deep, 0.25), fxw: mix(TOK.file300, pap, 0.3), fxg: TOK.covert700, fxglow: TOK.caution500, fxline: mix(deep, ink, 0.4) },
      dark: { fx: mix(a, deep, 0.15), fx2: mix(a, pap, 0.15), fx3: mix(deep, ink, 0.55), fxl: mix(pap, a, 0.3), fxm: mix(TOK.slate500, a, 0.3), fxw: mix(TOK.file300, a, 0.3), fxg: TOK.covert500, fxglow: TOK.caution500, fxline: mix(deep, ink, 0.6) } };
    C.heroLit = { lit: mix(accent, pap, 0.16), dark: mix(a, pap, 0.08) }; C.heroShade = { lit: mix(accent, deep, 0.55), dark: mix(a, deep, 0.5) };
    C.ink = ink; C.inkSoft = TOK.ink700; C.key = { bg: null, text: ink };
  } else {
    C.page = NI; C.site = mix(NI, a, 0.07); C.street = mix(NI, TOK.slate500, 0.32); C.streetLabel = mix(TOK.ink150, NI, 0.25);
    const n = t => mix(mix(a, deep, 0.3), NI, t);
    C.floor = { public: n(0.62), working: n(0.68), controlled: n(0.74), secure: n(0.8), corridor: n(0.6) };
    C.wallTop = mix(a, NI, 0.46); C.wallLit = mix(mix(a, deep, 0.3), NI, 0.66); C.wallShade = mix(mix(a, deep, 0.3), NI, 0.78); C.wallLine = mix(a, NI, 0.45);
    const f = { fx: mix(a, NI, 0.58), fx2: mix(b, NI, 0.62), fx3: mix(NI, "#000000", 0.3), fxl: mix(pap, NI, 0.55), fxm: mix(TOK.slate500, NI, 0.55), fxw: mix(TOK.file500, NI, 0.5), fxg: mix(TOK.covert700, NI, 0.45), fxglow: TOK.caution500, fxline: mix(NI, "#000000", 0.4) };
    C.fx = { lit: f, dark: f };
    C.ink = TOK.paper000; C.inkSoft = TOK.ink150; C.key = { text: TOK.paper100 };
    C.glow = M.light.MAP.night.glow; C.warm = M.light.MAP.night.pool; C.screen = M.light.MAP.night.screen; C.fire = M.light.MAP.night.fire; C.spill = M.light.MAP.night.spill;
  }
  return C;
};

// The street's palette in the plate: the rulebook's flat street (streetpaint.js),
// lit from the street by Bluetime (fronts lit, sides in shade, long shadows
// stippled at their ends); at Night as the rulebook's, darker. [interpretation]
PL.streetPalette = function (scene) {
  const base = M.streetPalette.flat(scene), night = !!(scene.street && scene.street.night), id = scene._id;
  const C = PL.colours(scene.model.colour, night);
  const out = Object.assign({}, base);
  out.face = (kind, name, p) => {
    const f = base.face(kind, name, p);
    if (!f || night || !f.fill || /^url/.test(f.fill)) return f;
    if (kind === "s") return Object.assign({}, f, { fill: mix(f.fill, C.deep, 0.32) });
    if (kind === "m") return Object.assign({}, f, { fill: mix(f.fill, C.deep, 0.16) });
    if (kind === "f") return Object.assign({}, f, { fill: mix(f.fill, TOK.paper000, 0.1) });
    return f;
  };
  out.g = (name, p) => {
    if (!night && name === "shadow") return { fill: C.shadow, opacity: 0.3 };
    if (!night && name === "shadow-tail") return { fill: `url(#${id}-stipple)`, opacity: 0.4 };
    if (night && (name === "shadow" || name === "shadow-tail")) return null;
    const g = base.g(name, p);
    if (night && g && g.fill && !/^url/.test(g.fill) && !/^(pool|spill|anomaly|obzone)/.test(name)) return Object.assign({}, g, { fill: mix(g.fill, TOK.slate900, 0.35) });
    return g;
  };
  if (night) { out.tag = () => ({ fill: TOK.paper000 }); out.tagText = () => ({ fill: TOK.ink900, "font-weight": 900, "letter-spacing": 0.15 }); }
  if (night) out.face = (kind, name, p) => { const f = base.face(kind, name, p); return f && f.fill && !/^url/.test(f.fill) ? Object.assign({}, f, { fill: mix(f.fill, TOK.slate900, 0.3) }) : f; };
  return out;
};

T.plate = {
  name: "plate",
  describe: "The plate: Denee's lit plates. By Bluetime lit from the street, the bands darker inward, long stippled shadows, the big pieces standing up; at Night the building dark, the target glowing, lamps and screens pooling light, light spilling from the ways in.",
  page: TOK.paper200, grain: 0.22,
  legend: { kicker: "Score site", titleSize: 5.6, cls: "text" },
  type: T.rulebook.type,
  painter(scene) {
    const LTx = PL.lightOf(scene), night = LTx.time === "Night";
    const C = PL.colours(scene.model.colour, night), { a, b, deep } = C;
    const id = scene._id = scene._id || ("b68m" + uid());
    const self = Object.assign({}, this, { page: C.page, night, C });
    self.grain = night ? 0.2 : 0.22; self.grainBlend = night ? "screen" : "multiply";
    self.shadowColour = C.shadow || TOK.ink900;
    self.defs = (id2, sc) => defs(id2, night ? { dotFill: TOK.paper000, hatchBg: mix(TOK.slate900, a, 0.12), hatchFg: mix(TOK.ink500, a, 0.2), gr: 1, gg: 1, gb: 1, ga: -2.6, gb2: 1.1, freq: 0.55, pxft: sc._pxft }
      : { dotFill: TOK.ink900, hatchBg: TOK.ink700, hatchFg: TOK.ink500, pxft: sc._pxft, freq: 0.55 }) +
      // the shadows' stipple, where they end; the night's pools and glows (one gradient each, reused)
      `<pattern id="${id2}-stipple" width="0.9" height="0.9" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><circle cx="0.45" cy="0.45" r="0.2" fill="${C.shadow || TOK.ink900}"/></pattern>` +
      (night ? ["glow", "warm", "screen", "fire", "spill"].map(k => `<radialGradient id="${id2}-${k}"><stop offset="0" stop-color="${C[k]}" stop-opacity="${k === "glow" ? 0.85 : 0.6}"/><stop offset="0.55" stop-color="${C[k]}" stop-opacity="${k === "glow" ? 0.38 : 0.22}"/><stop offset="1" stop-color="${C[k]}" stop-opacity="0"/></radialGradient>`).join("") : "");
    const icons = {
      "ov-target": [TOK.alarm700, TOK.paper000, TOK.alarm700], "ov-lock": [TOK.ink900, TOK.caution500, TOK.ink900],
      "ov-loot": [TOK.caution500, TOK.ink900, TOK.paper000], "ov-pair": [TOK.caution700, TOK.paper000, TOK.caution700],
      "ov-soc": [TOK.signal500, TOK.ink900, TOK.paper000], "ov-phys": [TOK.ink900, TOK.alarm500, TOK.paper000],
      "ov-front": night ? [TOK.paper000, TOK.ink900, TOK.paper000] : [TOK.ink900, TOK.paper000, TOK.ink900], "ov-service": [TOK.file500, TOK.paper000, TOK.file500], "ov-back": [TOK.swing700, TOK.paper000, TOK.swing700]
    };
    const ENTRY = { "ov-front": night ? TOK.paper000 : TOK.ink900, "ov-service": night ? "#6f8fe8" : TOK.file500, "ov-back": night ? "#d0499a" : TOK.swing700 };
    const PC = { face: C.wallLit, end: C.wallShade, top: C.wallTop, glass: TOK.file300, glassEdge: TOK.file500, soft: night ? mix(b, TOK.slate900, 0.5) : b, roof: mix(a, night ? TOK.slate900 : TOK.ink900, 0.45),
      earth: night ? mix(TOK.rust900, TOK.slate900, 0.5) : mix(TOK.rust900, TOK.paper200, 0.55), water: night ? mix(TOK.file700, TOK.slate900, 0.6) : mix(TOK.file700, TOK.paper000, 0.25), thin: night ? TOK.ink300 : TOK.ink500,
      door: night ? TOK.ink300 : TOK.ink700, gap: C.floor.corridor, hull: mix(TOK.rust700, TOK.ink900, 0.45), deck: night ? mix(TOK.paper300, TOK.slate900, 0.7) : mix(TOK.paper300, TOK.rust500, 0.35), quay: night ? mix(TOK.paper300, TOK.slate900, 0.7) : TOK.paper300 };
    const SPAL = scene.street ? PL.streetPalette(scene) : null;
    const K = C.key.text, K2 = night ? TOK.ink150 : TOK.ink700, K3 = night ? TOK.ink300 : TOK.ink500;
    self.paint = wrapPaint((role, p, mode) => {
      if (SPAL && role.startsWith("st-")) { const sp = M.street.paint(SPAL, role, p); return sp === undefined ? null : sp; }
      // the plate's own roles (PL.prepare)
      if (role.startsWith("pl-")) {
        const ci = role.indexOf(":"), kind = ci < 0 ? role.slice(3) : role.slice(3, ci), tone = ci < 0 ? "lit" : role.slice(ci + 1);
        switch (kind) {
          case "wall-lit": return { fill: C.wallLit };
          case "wall-shade": return { fill: C.wallShade };
          case "hero-lit": return { fill: C.heroLit ? C.heroLit[tone] : C.fx.lit.fx };
          case "hero-shade": return { fill: C.heroShade ? C.heroShade[tone] : C.fx.lit.fx3 };
          case "fx": { const [t2, r2] = tone.split("|"); return { fill: (C.fx[t2] || C.fx.lit)[r2] || C.fx.lit.fx }; }
        }
        return null;
      }
      const ic = iconPaint(icons, role); if (ic || role.includes(":")) return ic;
      if (role === "slab") return { fill: C.wallLit };
      if (role === "slab-side") return { fill: C.wallShade };
      const pj = projectedPaint(PC, role); if (pj) return pj;
      if (role.startsWith("floor-")) { const band = role.slice(6); if (band === "tone") return { fill: `url(#${id}-dots)`, opacity: night ? 0.08 : 0.16 }; return { fill: C.floor[band] || C.floor.public }; }
      if (C.fx.lit[role]) return { fill: C.fx.lit[role] };
      if (role.startsWith("wall-")) {
        const t = role.slice(5);
        if (t === "glass") return { stroke: TOK.file300, "stroke-linecap": "square" };
        if (t === "soft") return { stroke: PC.soft, "stroke-dasharray": "0.5 0.7", "stroke-linecap": "round", "stroke-width": 0.45 };
        return { stroke: C.wallLine, "stroke-linecap": "square", fill: "none" };
      }
      if (role.startsWith("lg-swatch-")) return Object.assign({ fill: C.floor[role.slice(10)] }, night ? { stroke: TOK.ink300, "stroke-width": 0.12 } : {});
      for (const k in ENTRY) if (role.startsWith(k + "-")) {
        const part = role.slice(k.length + 1);
        if (part === "line") return { stroke: ENTRY[k], "stroke-linecap": "round" };
        if (part === "head" || part === "tag") return { fill: ENTRY[k] };
        if (part === "text") return { fill: night && k === "ov-front" ? TOK.ink900 : TOK.paper000, "font-weight": 900, "letter-spacing": 0.15 };
      }
      switch (role) {
        case "site": return { fill: C.site };
        case "street": return { fill: C.street };
        case "street-label": return { fill: C.streetLabel, "font-weight": 900, "letter-spacing": 0.8 };
        case "footprint": return { fill: night ? mix(TOK.slate900, "#000000", 0.3) : deep };
        case "door-swing": return night ? { fill: TOK.paper000, opacity: 0.08 } : { fill: TOK.paper000, opacity: 0.45 };
        case "door-leaf": return { stroke: night ? TOK.ink300 : TOK.ink900, "stroke-linecap": "round" };
        case "door-curtain": return { fill: b };
        case "door-secret": return { stroke: night ? TOK.alarm500 : TOK.alarm700, "stroke-dasharray": "0.5 0.4" };
        case "door-glass": return { stroke: TOK.file300 };
        case "door-vault": return { fill: night ? TOK.slate500 : TOK.slate700 };
        case "door-vaultleaf": return { stroke: night ? TOK.slate500 : TOK.slate700, "stroke-width": 0.8 };
        case "ov-target-area": return night ? null : { fill: TOK.alarm500, opacity: 0.12 };
        case "ov-cone": return { fill: TOK.caution500, opacity: night ? 0.2 : 0.26 };
        case "ov-pair-line": return { stroke: night ? TOK.caution500 : TOK.caution700, fill: "none", "stroke-dasharray": "1.1 0.8", "stroke-linecap": "round" };
        case "ov-pair-head": return { fill: night ? TOK.caution500 : TOK.caution700 };
        case "ov-skip-line": return { stroke: night ? TOK.alarm500 : TOK.alarm700, fill: "none", "stroke-linecap": "round" };
        case "ov-skip-head": case "ov-skip-tag": return { fill: night ? TOK.alarm500 : TOK.alarm700 };
        case "ov-skip-tagtext": return { fill: TOK.paper000, "font-weight": 900 };
        case "ov-skip-label": return { fill: night ? "#ff8a73" : TOK.alarm700, "font-weight": 900, "font-style": "italic", stroke: night ? TOK.slate900 : TOK.paper000, "stroke-width": 0.35, "paint-order": "stroke" };
        case "unknown": return { fill: `url(#${id}-hatch)` };
        case "label-unknown": return { fill: night ? TOK.ink300 : TOK.paper200, "font-family": FONT.poster, "font-weight": 900 };
        case "label-bg": return { fill: TOK.paper000, opacity: 0.92 };
        case "label": return { fill: TOK.ink900, "font-weight": 900, "letter-spacing": 0.05 };
        case "label-sm": return { fill: TOK.ink700, "font-weight": 900, "letter-spacing": 0.2 };
        case "num-bg": return { fill: TOK.ink900, stroke: TOK.paper000, "stroke-width": Math.max(0.12, (p.h || 2 * (p.rad || 1)) * 0.07) };
        case "num": return { fill: TOK.paper000, "font-weight": 900 };
        case "leader": return { stroke: night ? TOK.paper000 : TOK.ink900, "stroke-linecap": "round" };
        case "leader-dot": return { fill: night ? TOK.paper000 : TOK.ink900 };
        case "level-title": return { fill: night ? TOK.paper100 : TOK.ink900, "font-family": FONT.poster, "font-weight": 900 };
        case "core-link": return { stroke: night ? TOK.ink300 : TOK.ink500, "stroke-dasharray": "1.2 0.9", "stroke-linecap": "round" };
        case "tok-frame": return { fill: TOK.paper000 };
        case "tok-label": return { fill: night ? TOK.paper000 : TOK.ink900, "font-weight": 900 };
        case "lg-kicker": return { fill: night ? TOK.signal500 : TOK.signal700, "font-weight": 900, "letter-spacing": 0.25 };
        case "lg-title": return { fill: K, "font-family": FONT.poster, "font-weight": 900 };
        case "lg-sub": return { fill: K2, "font-family": FONT.text, "font-weight": 700 };
        case "lg-h": return { fill: K3, "font-weight": 900, "letter-spacing": 0.35 };
        case "lg-band": return { fill: K, "font-weight": 900, "letter-spacing": 0.15 };
        case "lg-text": return { fill: K, "font-family": FONT.text };
        case "lg-text-strong": return { fill: K, "font-family": FONT.text, "font-weight": 700 };
        case "lg-small": return { fill: K2, "font-family": FONT.text };
        case "lg-small-italic": return { fill: K3, "font-family": FONT.text, "font-style": "italic" };
        case "lg-chip": return { fill: K };
      }
      return null;
    });
    return self;
  },
  compose(scene) {
    const th = this.painter(scene);
    PL.prepare(scene, th);
    return composePage(scene, th);
  }
};

// --- Preparing the scene: the plate's light on each floor ------------------------------
const ser1 = (pcs, th) => M.toSVG(pcs, { paint: th.paint, shadowColour: th.shadowColour });
const f2 = v => (+v).toFixed(2);
const polyD = pts => "M" + pts.map(p => f2(p[0]) + " " + f2(p[1])).join(" L") + " Z";
// one winding for every polygon, so overlapping shadows in one path add up and never cancel
const ccw = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; } return a < 0 ? pts.slice().reverse() : pts; };
// a point through a group's transform (translate, rotate, scale), as toSVG writes it
const tfPt = (tf, p) => {
  if (!tf) return p;
  const s = tf.s || 1, a = (tf.rot || 0) * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a), x = p[0] * s, y = p[1] * s;
  return [(tf.x || 0) + x * c - y * sn, (tf.y || 0) + x * sn + y * c];
};
const bboxOf = pcs => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pcs) for (const [x, y] of M.street.ptsOf(p)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return isFinite(x0) ? { x0, y0, x1, y1 } : null;
};
// a piece list with its fx roles turned to the plate's toned ones (pl-fx:lit|fx …)
const toned = (pcs, tone) => pcs.map(p => {
  if (!p) return p;
  if (p.t === "g") return Object.assign({}, p, { kids: toned(p.kids, tone) });
  if (/^fx/.test(p.r)) return Object.assign({}, p, { r: `pl-fx:${tone}|${p.r}` });
  return p;
});

PL.prepare = function (scene, th) {
  if (scene.street || scene._platePrepared) return;
  scene._platePrepared = true;
  const LTx = PL.lightOf(scene), night = LTx.time === "Night", C = th.C, opts = scene.opts || {};
  const gm = opts.layer !== "player", view = opts.view;
  scene.night = night;
  // the key says when it is drawn: as played, beside what was rolled
  const m0 = scene.model || {};
  scene.weather = M.weather.forRender({ weather: m0.weather || "" }, opts, night, true, scene.W || []);
  if (LTx.asPlayed) scene.model = Object.assign({}, m0, { time: `${LTx.time}, as played (rolled: ${[m0.time, m0.weather].filter(Boolean).join(", ")})`, weather: "" });
  if (view === "section" || !scene.parts) return;
  const iso = view === "iso", pk = M.light.planKey(LTx.light, scene.parts[0] && scene.parts[0].iso ? scene.parts[0].iso.vx : 1);
  const lay = scene.lay, player = !gm;
  // the display size of a foot, for how many pieces a big room keeps standing
  const pxPerFt = (opts.displayWidth || opts.width || 1400) / Math.max(1, scene.box.w) * (iso ? 0.85 : 1);
  let n = 0;
  for (const part of scene.parts) {
    const lv = part.lv, L = part.layers;
    if (!lv || !lv.rooms) continue;
    const vx = part.iso ? part.iso.vx : 1;
    const shadows = [], heroes = [], pools = [];
    // --- furniture: each room's few biggest pieces; the heroes stand up (Bluetime, iso) ---
    L.furn = L.furn.map(g => {
      if (!g || g.cls !== "room-furniture") return g;
      const roomId = g.kids[0] && g.kids[0].room, room = lv.rooms.find(r => r.id === roomId);
      const band = room ? room.band : "public", tone = band === "secure" || (band === "controlled" && !night && lumOf(C.floor.controlled) < 0.32) ? "dark" : "lit";
      const items = [];
      for (const fg of g.kids) for (const pg of fg.kids || []) {
        const name = String(pg.cls || "").replace(/^fx-/, ""), bb = bboxOf(pg.kids || []);
        if (!bb) continue;
        const s = (pg.tf && pg.tf.s) || 1, area = (bb.x1 - bb.x0) * (bb.y1 - bb.y0) * s * s;
        items.push({ fg, pg, name, bb, area, keep: PL.KEEP.has(name), h: Math.min(7, PL.HEIGHT[name] || 0), light: PL.LIGHTS[name] || null });
      }
      const fr = room && room.frame, roomPx = fr ? Math.sqrt(fr.w * fr.h) * pxPerFt : 0;
      const others = items.filter(i => !i.keep).sort((p, q) => q.area - p.area);
      const keepN = roomPx > 260 ? 4 : roomPx > 150 ? 3 : 2;
      let kept = others.slice(0, keepN);
      // at Night a room keeps its light, if it has one
      if (night && !kept.some(i => i.light)) { const l = others.find(i => i.light); if (l) kept = kept.slice(0, keepN - 1).concat([l]); }
      const nHero = !night && iso ? (roomPx > 320 ? 3 : roomPx > 200 ? 2 : 1) : 0;
      const heroSet = new Set(kept.filter(i => i.h > 0).slice(0, nHero));
      const keepSet = new Set(items.filter(i => i.keep).concat(kept));
      // heroes: a box on its footprint, its own drawing on top, its shadow on the floor
      for (const it of heroSet) {
        const { fg, pg, bb, h } = it;
        const quad = [[bb.x0, bb.y0], [bb.x1, bb.y0], [bb.x1, bb.y1], [bb.x0, bb.y1]].map(p => tfPt(fg.tf, tfPt(pg.tf, p)));
        const cx = quad.reduce((s, p) => s + p[0], 0) / 4, cy = quad.reduce((s, p) => s + p[1], 0) / 4;
        let area2 = 0; for (let i = 0; i < 4; i++) { const p = quad[i], q = quad[(i + 1) % 4]; area2 += p[0] * q[1] - q[0] * p[1]; }
        const pcs = [];
        for (let i = 0; i < 4; i++) {
          const p = quad[i], q = quad[(i + 1) % 4], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1;
          const nx = (area2 > 0 ? dy : -dy) / l, ny = (area2 > 0 ? -dx : dx) / l;
          if (vx * nx + ny <= 0.01) continue;
          const lit = nx * pk.from[0] + ny * pk.from[1] > 0.3;
          pcs.push(P.poly(`pl-hero-${lit ? "lit" : "shade"}:${tone}`, [part.iso.P0(p, 0), part.iso.P0(q, 0), part.iso.P0(q, h), part.iso.P0(p, h)]));
        }
        const top = ser1([P.g([P.g(toned(pg.kids, tone), { tf: pg.tf })], { tf: fg.tf })], th);
        pcs.push(P.raw(`<g transform="translate(0 ${f2(-h)}) ${part.iso.mat}">${top}</g>`));
        heroes.push({ dk: vx * cx + cy, pcs });
        const s0 = pk.shadow;
        shadows.push({ core: M.street.hull(quad.concat(quad.map(p => [p[0] + s0[0] * h * 0.6, p[1] + s0[1] * h * 0.6]))), tail: M.street.hull(quad.map(p => [p[0] + s0[0] * h * 0.55, p[1] + s0[1] * h * 0.55]).concat(quad.map(p => [p[0] + s0[0] * h, p[1] + s0[1] * h]))) });
      }
      // the night's lights: one pool per room, round its light
      if (night) {
        const src = kept.find(i => i.light);
        if (src) {
          const c = tfPt(src.fg.tf, tfPt(src.pg.tf, [(src.bb.x0 + src.bb.x1) / 2, (src.bb.y0 + src.bb.y1) / 2])), s = (src.pg.tf && src.pg.tf.s) || 1;
          const r = Math.min(fr ? Math.max(fr.w, fr.h) * 0.6 : 10, Math.max(src.bb.x1 - src.bb.x0, src.bb.y1 - src.bb.y0) * s * 0.75 + 4);
          pools.push({ x: c[0], y: c[1], r, kind: src.light, clip: room && room.shape });
        }
      }
      const fgs = g.kids.map(fg => Object.assign({}, fg, { kids: toned((fg.kids || []).filter(pg => items.some(i => i.pg === pg && keepSet.has(i) && !heroSet.has(i)) || !items.some(i => i.pg === pg)), tone) }));
      return Object.assign({}, g, { kids: fgs });
    });
    // --- walls: faces lit toward the key, shaded away (iso) ---
    if (iso) L.walls = L.walls.map(p => {
      if (!p || !p.nrm || !/^wall[fe]-(ext|ring|int)$/.test(p.r)) return p;
      const lit = night ? p.nrm[1] > 0.3 : p.nrm[0] * pk.from[0] + p.nrm[1] * pk.from[1] > 0.3;
      return Object.assign({}, p, { r: lit ? "pl-wall-lit" : "pl-wall-shade" });
    });
    if (heroes.length) {
      const out = [];
      const hs = heroes.slice().sort((p, q) => p.dk - q.dk);
      let j = 0;
      for (const p of L.walls) { while (j < hs.length && p && p.dk != null && p.dk > hs[j].dk) out.push(...hs[j++].pcs); out.push(p); }
      while (j < hs.length) out.push(...hs[j++].pcs);
      L.walls = out;
    }
    // --- Bluetime: the walls' long shadows, away from the key, stippled where they end ---
    const floorShapes = L.floors.filter(p => p && /^floor-/.test(p.r) && p.r !== "floor-tone");
    if (!night) {
      const WH = { ext: 7, ring: 5, int: 5, glass: 0, soft: 0 };
      const walls = part.iso ? part.iso.walls : (lv.walls || []).filter(w => !w.arc).map(w => ({ a: w.a, b: w.b, h: WH[w.t] || 0, t: w.t }));
      for (const w of walls) {
        if (!w.h || w.t === "glass" || w.t === "soft") continue;
        const s = [pk.shadow[0] * w.h, pk.shadow[1] * w.h], f = M.light.MAP.bluetime.stipple, at = t => [[w.a[0] + s[0] * t, w.a[1] + s[1] * t], [w.b[0] + s[0] * t, w.b[1] + s[1] * t]];
        const [a0, b0] = at(0), [a1, b1] = at(f), [a2, b2] = at(f - 0.04), [a3, b3] = at(1);
        shadows.push({ core: [a0, b0, b1, a1], tail: [a2, b2, b3, a3] });
      }
      if (shadows.length && floorShapes.length) {
        const cid = `${scene._id}-sh${n}`, comp = part.iso ? [0.9 * vx, 0.9] : [0, 0];
        const clip = `<clipPath id="${cid}">${M.toSVG(floorShapes, { paint: () => ({}) }).replace(/ data-band="[^"]*"/g, "")}</clipPath>`;
        const core = shadows.map(s => polyD(ccw(s.core))).join(" "), tail = shadows.map(s => polyD(ccw(s.tail))).join(" ");
        L.furn.unshift(P.raw(`${clip}<g transform="translate(${f2(comp[0])} ${f2(comp[1])})"><g clip-path="url(#${cid})" opacity="${C.shadowOp}"><path d="${core}" fill="${C.shadow}"/><path d="${tail}" fill="url(#${scene._id}-stipple)"/></g></g>`));
      }
    }
    // --- Night: the target's glow (GM only), the lights' pools, the ways in's spill ---
    if (night) {
      const glows = [];
      const tgt = gm ? lv.rooms.find(r => r.isTarget && r.frame && r.shape) : null;
      if (tgt) { const f = tgt.frame; glows.push({ x: f.cx, y: f.cy, rx: f.w * 0.62, ry: f.h * 0.62, rot: f.rot || 0, kind: "glow", clip: tgt.shape }); }
      for (const p of pools) glows.push({ x: p.x, y: p.y, rx: p.r, ry: p.r, rot: 0, kind: p.kind, clip: p.clip });
      if (glows.length) {
        let svg = "";
        glows.forEach((g2, i) => {
          const cid = `${scene._id}-gl${n}-${i}`, sh = g2.clip;
          const d = sh ? (sh.kind === "circle" ? `M${f2(sh.cx - sh.r)} ${f2(sh.cy)} A${f2(sh.r)} ${f2(sh.r)} 0 1 1 ${f2(sh.cx + sh.r)} ${f2(sh.cy)} A${f2(sh.r)} ${f2(sh.r)} 0 1 1 ${f2(sh.cx - sh.r)} ${f2(sh.cy)} Z` : polyD(sh.pts)) : null;
          svg += (d ? `<clipPath id="${cid}"><path d="${d}"/></clipPath>` : "") + `<ellipse cx="${f2(g2.x)}" cy="${f2(g2.y)}" rx="${f2(g2.rx)}" ry="${f2(g2.ry)}"${g2.rot ? ` transform="rotate(${f2(g2.rot)} ${f2(g2.x)} ${f2(g2.y)})"` : ""} fill="url(#${scene._id}-${g2.kind === "fire" ? "fire" : g2.kind === "screen" ? "screen" : g2.kind === "glow" ? "glow" : "warm"})"${d ? ` clip-path="url(#${cid})"` : ""}/>`;
        });
        // under the cover (a player copy's unsurveyed rooms), over the floors
        const ci = L.floors.findIndex(p => p && p.cls === "map-cover");
        L.floors.splice(ci < 0 ? L.floors.length : ci, 0, P.raw(svg));
      }
      // light spilling from the ways in this copy shows, onto the ground outside
      const ents = (lay && lay.entries || []).filter(e => e.level === lv && !(player && /can't be known/.test(e.vec && e.vec.know || "")));
      let sp = "";
      ents.forEach((e, i) => {
        const d = e.dir || [0, 0], dl = Math.hypot(d[0], d[1]);
        if (!dl || e.from) { sp += `<ellipse cx="${f2(e.x)}" cy="${f2(e.y)}" rx="4.5" ry="4.5" fill="url(#${scene._id}-spill)"/>`; return; }
        const ux = d[0] / dl, uy = d[1] / dl, nx = -uy, ny = ux, hw = 2.4, Ls = lv.lvl === 0 ? 13 : 8;
        const pts = [[e.x + nx * hw, e.y + ny * hw], [e.x - nx * hw, e.y - ny * hw], [e.x - nx * (hw + Ls * 0.42) + ux * Ls, e.y - ny * (hw + Ls * 0.42) + uy * Ls], [e.x + nx * (hw + Ls * 0.42) + ux * Ls, e.y + ny * (hw + Ls * 0.42) + uy * Ls]];
        const gid = `${scene._id}-sp${n}-${i}`;
        sp += `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="${f2(e.x)}" y1="${f2(e.y)}" x2="${f2(e.x + ux * Ls)}" y2="${f2(e.y + uy * Ls)}"><stop offset="0" stop-color="${C.spill}" stop-opacity="0.55"/><stop offset="1" stop-color="${C.spill}" stop-opacity="0"/></linearGradient>` +
          `<path d="${polyD(pts)}" fill="url(#${gid})"/><ellipse cx="${f2(e.x + ux * 1.2)}" cy="${f2(e.y + uy * 1.2)}" rx="3.2" ry="3.2" fill="url(#${scene._id}-spill)"/>`;
      });
      if (sp) L.site.push(P.raw(sp));
    }
    n++;
  }
};

// The street at Night in the plate: light spilling from the site's ways in the
// crew can use, onto the pavement (B68Map.lightAt reads them as doorways).
PL.streetSpills = function (S, built, ctx) {
  const player = ctx.opts.layer === "player";
  for (const e of built.entries || []) {
    if (player && /can't be known/.test(e.vec && e.vec.know || "")) continue;
    const d = e.dir || [0, 0], dl = Math.hypot(d[0], d[1]);
    if (!dl || e.from) continue;
    const z = (e.level && e.level.z) || 0, ux = d[0] / dl, uy = d[1] / dl, nx = -uy, ny = ux, hw = 2.6, Ls = 11;
    S.decal(P.poly("st-g:spill", [[e.x + nx * hw, e.y + ny * hw], [e.x - nx * hw, e.y - ny * hw], [e.x - nx * (hw + 4) + ux * Ls, e.y - ny * (hw + 4) + uy * Ls], [e.x + nx * (hw + 4) + ux * Ls, e.y + ny * (hw + 4) + uy * Ls]]), z);
  }
};

// ---- src/streetpaint.js ----
// =============================================================================
// streetpaint — the street's roles, painted per theme
// =============================================================================
// Two palettes. The flat one is the rulebook plate's: flat colour, the site in
// the roll's printed colour scheme, hard shadows by Bluetime, lamp pools and
// lit windows at Night. The case file uses it too, under its photocopy
// filter, which is what a surveillance photo of a street is. The blueprint
// draws the same street in white line on blue.

const SP = M.streetPalette = {};
const TK = M.TOKENS;
const NIGHT = "#1c1d2b";

SP.flat = function (scene) {
  const mix = M.mix, ink = TK.ink900, pap = TK.paper000;
  const [a, b] = M.own(M.COLOURS, scene.model.colour) || M.COLOURS["grey and charcoal"];
  const night = !!(scene.street && scene.street.night);
  const water = mix(TK.slate500, TK.file500, 0.35);
  // materials: the front face's colour; the side is darker, the top lighter
  const MAT = {
    site: a, site2: b, nb1: "#cdbca6", nb2: "#b7bbb0", render: "#e0d1b6", brick: "#9e5a3c", concrete: "#b9b3a7", stone: "#cdbf9f",
    metal: "#8e9497", iron: "#3e4246", rust: TK.rust500, wood: "#94683f", glass: TK.file300, glassblock: mix(TK.file300, TK.slate700, 0.35), glasshouse: mix(TK.file300, pap, 0.4),
    canvas: "#d9cfb2", awning: b, plastic: "#ece6d8", white: "#f2eee5", bronze: "#7a6440", dark: TK.ink700, light: pap, paper: pap,
    crowd: TK.ink900, crowd2: TK.alarm700, walker: "#4b4a55", head: TK.ink700, bluecoat: TK.file700, suit: "#f1efe8", performer: TK.swing500, performer2: TK.caution500,
    hazard: TK.caution500, plant: TK.covert500, tree: TK.covert500, lamp: TK.ink700, post: TK.alarm700,
    pod1: TK.rust500, pod2: TK.slate500, pod3: TK.caution700, van: "#d8d2c4", podburnt: TK.ink700, cabin: "#3d4a5a",
    tent: "#f4f1ea", float: TK.swing500, float2: TK.caution500, barrier: "#ebe5d6", booth: TK.file500, kiosk: b, drum: TK.rust700, coal: TK.ink900,
    rope: "#b89a6a", net: "#8a7a5a", gold: TK.caution500, rock: "#4a443e", rubblestone: "#9a9185", bin: TK.covert500,
    block: "#d2c9b7", far: "#d1c7b4", deck: "#c9c1b0", podium: "#8a8274", edge: "#8f8778", kerbstone: "#a39b8a", marquee: b, billboard: TK.ink700,
    hull: mix(TK.rust700, ink, 0.45), deckwood: "#a07850", barge: "#5b4a3a", boat: "#3e6b70", gondola: TK.ink900, hoarding: "#d9cfb2", roof: "#6b4b3c", roofline: ink
  };
  const dim = (c, t) => night ? mix(c, NIGHT, t) : c;
  // [interpretation] A way in's door or window stands out from its wall: dark on a
  // light wall, light on a dark one (the site's printed colour decides which).
  const lum = c => { const n = parseInt(String(c).slice(1, 7), 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
  const darkWall = lum(a) < 0.3;
  const face = (kind, name) => {
    if (name === "cut") return { fill: dim(mix(TK.ink300, TK.paper200, 0.3), 0.38) };
    const c = MAT[name] || MAT.block;
    if (name === "roofline") return { fill: dim(ink, 0.2) };
    if (name === "glass" && kind !== "t") return { fill: night ? "#2b3754" : mix(TK.file300, pap, 0.15), opacity: 0.92 };
    const f = kind === "t" ? mix(c, pap, 0.2) : kind === "s" ? mix(c, ink, 0.24) : kind === "m" ? mix(c, ink, 0.12) : c;
    // the block behind is quieter than the street: at Night it stays a shade lighter
    if (name === "block") return { fill: dim(f, kind === "t" ? 0.4 : 0.46) };
    return { fill: dim(f, kind === "t" ? 0.56 : 0.62) };
  };
  const G = {
    road: "#b5ac9a", mark: "#f4efe3", zebra: "#f4efe3", pave: "#e3dccc", kerb: "#9d9584", cobble: "#ab9e88", joint: "#8f8574", plaza: "#d9d1c0", tile: "#e3d9c4",
    grass: mix(TK.covert500, TK.paper200, 0.25), yard: "#d0c6b1", soil: "#8a6a48", crop: TK.covert500, water, waterhigh: mix(water, pap, 0.12), ripple: mix(TK.slate500, pap, 0.55),
    edge: "#8f8778", puddle: mix(TK.slate500, TK.paper200, 0.45), mud: "#8a7458", grate: TK.ink700, "grate-bar": "#7a746c", hatch: TK.ink700, lot: "#b9ad96", under: "#57524b",
    passage: "#d2c9b6", median: "#b8b09c", rail: "#6b6560", area: "#4a4540", step: "#a39b8a", rubble: "#a09484", coal: TK.ink900, rot: "#6b5a3a", bag: TK.ink700, debris: TK.ink500,
    pigeon: TK.ink500, flood: mix(water, "#b5ac9a", 0.25), tuft1: TK.caution500, tuft2: TK.alarm500
  };
  const OP = { mark: 0.85, zebra: 0.9, joint: 0.45, ripple: 0.6, puddle: 0.8, flood: 0.88, "grate-bar": 1, rubble: 0.9, mud: 0.85, rot: 0.8 };
  return {
    face,
    g(name) {
      switch (name) {
        case "shadow": return night ? null : { fill: ink, opacity: 0.17 };
        case "shadow-soft": return night ? null : { fill: ink, opacity: 0.07 };
        case "pool1": return night ? { fill: "#f0c55a", opacity: 0.07 } : null;
        case "pool2": return night ? { fill: "#f0c55a", opacity: 0.09 } : null;
        case "pool3": return night ? { fill: "#f0c55a", opacity: 0.13 } : null;
        case "spill": return night ? { fill: "#f0b34a", opacity: 0.17 } : null;
        case "obzone": return { fill: TK.caution500, "fill-opacity": night ? 0.2 : 0.17, stroke: night ? TK.caution500 : TK.caution700, "stroke-width": 0.4, "stroke-dasharray": "1.6 1", "stroke-opacity": 0.85 };
        case "anomaly1": return { fill: TK.swing500, opacity: 0.14 };
        case "anomaly2": return { fill: TK.swing500, opacity: 0.22 };
        case "anomaly3": return { fill: pap, opacity: night ? 0.5 : 0.35 };
      }
      const c = G[name]; if (!c) return null;
      return { fill: dim(c, 0.56), opacity: OP[name] };
    },
    d(name, p) {
      switch (name) {
        case "win": if (p && p.way && darkWall) return { fill: night ? "#f3c766" : mix(TK.file300, pap, 0.3) }; return { fill: night ? "#14151f" : mix(TK.ink700, a, 0.15) };
        case "winlit": return { fill: night ? "#f3c766" : mix(TK.ink700, a, 0.15) };
        case "glass": return { fill: night ? "#25314d" : mix(TK.file300, pap, 0.3) };
        case "frame": return { fill: dim(TK.ink700, 0.3) };
        case "shop": return { fill: night ? "#1a1f26" : mix(TK.file700, TK.ink700, 0.5) };
        case "shoplit": return { fill: night ? "#f2b552" : mix(TK.file700, TK.ink700, 0.5) };
        case "door": return { fill: p && p.way && darkWall ? dim(mix(pap, a, 0.3), 0.45) : dim(TK.ink700, 0.3) };
        case "door-site": return { fill: dim(mix(b, ink, 0.2), 0.45) };
        case "secret": return { fill: "none", stroke: TK.alarm700, "stroke-width": 0.35, "stroke-dasharray": "0.7 0.5" };
        case "sign1": return { fill: dim(TK.covert500, 0.5) };
        case "sign2": return { fill: dim(pap, 0.55) };
        case "signlit": return { fill: night ? "#ffd97a" : TK.caution500 };
        case "neon": return { fill: night ? "#ff5fc8" : TK.swing500 };
        case "mural1": return { fill: dim(b, 0.5) };
        case "mural2": return { fill: dim(mix(b, pap, 0.35), 0.5) };
        case "graffiti": return { fill: dim(TK.swing500, 0.4), opacity: 0.85 };
        case "tag1": return { fill: dim(TK.swing500, 0.3), opacity: 0.92 };
        case "tag2": return { fill: dim(TK.covert500, 0.3), opacity: 0.92 };
        case "boards": return { fill: dim("#d8c49a", 0.6) };
        case "boardline": return { fill: dim("#8a6c45", 0.55) };
        case "shimmer": return { fill: TK.swing500, opacity: night ? 0.3 : 0.22 };
        case "patch": return { fill: dim(mix("#9c8f78", a, 0.25), 0.55) };
        case "poster": return { fill: dim(TK.signal500, 0.4) };
        case "poster2": return { fill: dim(TK.file500, 0.4) };
        case "screen": return { fill: night ? "#7fd6ff" : TK.file300 };
        case "screen2": return { fill: night ? "#ff7ad9" : TK.swing500 };
        case "stripe": return { fill: dim(pap, 0.5) };
        case "waterline": return { fill: dim(TK.alarm700, 0.5) };
        case "cross": return { fill: night ? "#5fe08f" : TK.covert500 };
        case "bluelamp": return { fill: night ? "#7fb2ff" : TK.file500 };
        case "grille": return { fill: dim(ink, 0.2) };
        case "roller": return { fill: dim("#7c8285", 0.6) };
        case "lamphead": return { fill: night ? "#f6dc8a" : TK.ink700 };
        case "balcony": return { fill: dim(mix("#b9b3a7", ink, 0.25), 0.6) };
        case "papers": return { fill: dim(pap, 0.4) };
        case "goods": return { fill: dim(TK.caution500, 0.45) };
        case "cargo": return { fill: dim("#a07850", 0.55) };
        case "pattern1": return { fill: dim(TK.signal500, 0.45) };
        case "pattern2": return { fill: dim(TK.caution500, 0.45) };
        case "flower1": return { fill: dim("#7a4b2b", 0.45) };
        case "flower2": return { fill: dim(TK.caution500, 0.45) };
        case "flower3": return { fill: dim(TK.covert500, 0.45) };
        case "stem": return { fill: dim(TK.covert700, 0.45) };
        case "clock": return { fill: night ? "#f6e7b4" : pap };
        case "placard": return { fill: dim(pap, 0.45) };
        case "placard-stick": return { fill: dim(TK.ink500, 0.4) };
        case "birdshit": return { fill: dim("#f4efe3", 0.4) };
        case "hazard": return { fill: TK.caution500 };
        case "dark": return { fill: dim(ink, 0.2) };
      }
      return null;
    },
    x(name) {
      switch (name) {
        case "lampglow": return { fill: "#f6dc8a", opacity: 0.35 };
        case "fireglow": return { fill: TK.signal500, opacity: 0.14 };
        case "fireglow2": return { fill: TK.caution500, opacity: 0.18 };
        case "flame": return { fill: TK.signal500 };
        case "flamecore": return { fill: TK.caution500 };
        case "smoke": return { fill: TK.ink500, opacity: 0.16 };
        case "steam": return { fill: pap, opacity: 0.45 };
        case "spray": return { fill: TK.file300, opacity: 0.6 };
        case "anomaly": return { fill: TK.swing500, opacity: 0.38 };
        case "anomaly2": return { fill: pap, opacity: 0.7 };
        case "shine": return { fill: pap, opacity: 0.5 };
        case "wire": return { fill: "none", stroke: dim(ink, 0.2), "stroke-width": 0.22 };
        case "rib": return { fill: "none", stroke: dim(TK.ink700, 0.3), "stroke-width": 0.35 };
        case "glazing": return { fill: night ? "#9fb8ff" : TK.file300, opacity: night ? 0.12 : 0.26 };
        case "glazing2": return { fill: night ? "#9fb8ff" : TK.file300, opacity: night ? 0.08 : 0.18 };
        case "rail": return { stroke: dim(TK.ink700, 0.3), fill: "none" };
        case "fence": return { fill: dim(TK.ink500, 0.3), opacity: 0.16 };
        case "pole": return { stroke: dim(TK.ink700, 0.3), fill: "none" };
        case "plank": return { fill: dim("#a07850", 0.55) };
        case "tape": return { stroke: TK.caution500, "stroke-dasharray": "1.2 0.8", fill: "none" };
        case "bunting": return { stroke: TK.swing500, "stroke-dasharray": "1 0.6", "stroke-width": 0.6, fill: "none" };
        case "arm": return { stroke: dim(TK.caution700, 0.4), "stroke-linecap": "round", fill: "none" };
      }
      return null;
    },
    tag: () => ({ fill: TK.ink900 }),
    tagText: () => ({ fill: pap, "font-weight": 900, "letter-spacing": 0.15 })
  };
};

// The blueprint: every solid a white outline on blue, the ground in hairlines.
SP.blue = function (scene, BG, W, RED, YEL) {
  const night = !!(scene.street && scene.street.night), id = scene._id;
  const line = (o) => Object.assign({ stroke: W, "stroke-width": 0.12, "stroke-opacity": 0.9, "stroke-linejoin": "round" }, o);
  const FILL = { t: "#2f62a8", f: BG, s: "#23528f", m: "#29589a" };
  return {
    face(kind, name) {
      if (name === "cut") return { fill: "#3f6db0", stroke: W, "stroke-width": 0.14 };
      if (name === "glass" || name === "glasshouse") return line({ fill: W, "fill-opacity": 0.1 });
      if (/^(crowd|crowd2|walker|head|bluecoat|suit|performer|performer2)$/.test(name)) return { fill: name === "bluecoat" || name === "crowd2" ? RED : W, opacity: 0.75 };
      return line({ fill: FILL[kind] || BG });
    },
    g(name) {
      switch (name) {
        case "shadow": case "shadow-soft": case "spill": return null;
        case "pool1": case "pool2": case "pool3": return night ? { fill: YEL, opacity: 0.05 } : null;
        case "mark": case "zebra": return { fill: W, opacity: 0.5 };
        case "joint": case "grate-bar": return { fill: W, opacity: 0.18 };
        case "water": case "flood": case "waterhigh": return { fill: `url(#${id}-hatch)`, opacity: 0.55 };
        case "ripple": return { fill: W, opacity: 0.35 };
        case "road": return { fill: W, "fill-opacity": 0.05, stroke: W, "stroke-opacity": 0.35, "stroke-width": 0.12 };
        case "obzone": return { fill: YEL, "fill-opacity": 0.1, stroke: YEL, "stroke-width": 0.2, "stroke-dasharray": "1.2 0.7", "stroke-opacity": 0.9 };
        case "anomaly1": case "anomaly2": case "anomaly3": return { fill: RED, opacity: 0.12, stroke: RED, "stroke-width": 0.15, "stroke-dasharray": "1 0.6" };
        case "grass": case "crop": case "tuft1": case "tuft2": return { fill: W, opacity: 0.1 };
        case "area": case "under": case "hatch": case "grate": return { fill: `url(#${id}-hatch)`, opacity: 0.8 };
        case "pigeon": case "bag": case "debris": case "coal": return { fill: W, opacity: 0.5 };
      }
      return { fill: W, "fill-opacity": 0.03, stroke: W, "stroke-opacity": 0.22, "stroke-width": 0.1 };
    },
    d(name) {
      switch (name) {
        case "winlit": return night ? { fill: YEL, "fill-opacity": 0.55 } : line({ fill: "none", "stroke-width": 0.08 });
        case "shoplit": case "signlit": return night ? { fill: YEL, "fill-opacity": 0.45 } : line({ fill: W, "fill-opacity": 0.08, "stroke-width": 0.08 });
        case "neon": case "screen": case "screen2": case "bluelamp": case "cross": return { fill: name === "neon" || name === "screen2" ? RED : YEL, "fill-opacity": night ? 0.6 : 0.35 };
        case "secret": return { fill: "none", stroke: RED, "stroke-width": 0.35, "stroke-dasharray": "0.6 0.45" };
        case "door": case "door-site": return line({ fill: W, "fill-opacity": 0.22 });
        case "boards": case "patch": return line({ fill: W, "fill-opacity": 0.12, "stroke-width": 0.08 });
        case "shimmer": return { fill: RED, opacity: 0.18 };
        case "boardline": return { fill: W, opacity: 0.35 };
        case "hazard": case "graffiti": case "tag1": case "tag2": case "poster": case "poster2": case "pattern1": case "pattern2": case "mural1": case "mural2": case "flower1": case "flower2": case "flower3": return line({ fill: W, "fill-opacity": 0.14, "stroke-width": 0.08 });
        case "grille": case "frame": case "stripe": case "stem": case "placard-stick": return { fill: W, opacity: 0.55 };
        case "lamphead": return { fill: night ? YEL : W, opacity: 0.85 };
      }
      return line({ fill: "none", "stroke-width": 0.08, "stroke-opacity": 0.75 });
    },
    x(name) {
      switch (name) {
        case "lampglow": return night ? { fill: YEL, opacity: 0.35 } : null;
        case "fireglow": case "fireglow2": return { fill: RED, opacity: 0.14 };
        case "flame": case "flamecore": return { fill: RED, opacity: name === "flame" ? 0.85 : 0.5 };
        case "smoke": case "steam": case "spray": return { fill: W, opacity: 0.12 };
        case "anomaly": case "anomaly2": return { fill: RED, opacity: name === "anomaly" ? 0.25 : 0.4 };
        case "shine": return null;
        case "glazing": case "glazing2": return { fill: W, opacity: 0.05, stroke: W, "stroke-width": 0.1, "stroke-opacity": 0.4 };
        case "fence": return { fill: W, opacity: 0.08 };
        case "plank": return line({ fill: BG });
        case "tape": case "bunting": return { stroke: RED, "stroke-dasharray": "1.2 0.8", fill: "none", "stroke-width": 0.35 };
      }
      return { fill: "none", stroke: W, "stroke-width": 0.2, "stroke-opacity": 0.85 };
    },
    tag: () => ({ fill: BG, stroke: W, "stroke-width": 0.2 }),
    tagText: () => ({ fill: W, "font-family": M.FONTS.mono, "font-weight": 700 })
  };
};

// ---- src/chaseparts.js ----
// =============================================================================
// chaseparts — the chase strip's vocabulary: tokens, states, fx, and the street side-on
// =============================================================================
// A chase panel is the street cut open side-on, left to right, in three levels:
// above (rooftops, decks, girders), the street (the carriageway, the frontage
// behind it) and below (a sewer, a canal, an underpass). Everything here is
// drawn in feet, standing on y = 0 and rising to −y, facing +x (the way the
// chase runs), with roles only, never colours: the street's own materials
// (st-f/st-s/st-t:<material>, st-d:<detail>, st-x:<effect>, painted by the
// street palettes) and the chase's (ch-*), painted in chase.js. Every table and
// every shape here is [interpretation]: the roll says what is on the street,
// never how it looks side-on.

const CH = M.CH = {};
// The cut, in feet from the top of a panel: the above level's surface, the
// street's, the below level's (a water line or a tunnel floor), the bottom.
CH.Y = { above: 8, street: 21, below: 31.5, bottom: 36 };
CH.LEVELS = ["above", "street", "below"];
const chY = CH.Y;

// --- Colours a cast member can be ("colour": "yellow") ------------------------------
CH.COLOURS = {
  yellow: TOK.caution500, red: TOK.alarm500, black: "#262320", white: "#efebe2", blue: TOK.file500, navy: TOK.file700, green: TOK.covert500,
  olive: TOK.covert700, grey: "#8e9497", orange: TOK.signal500, purple: TOK.swing700, pink: TOK.swing500, brown: "#6b4f38", teal: TOK.slate500,
  rust: TOK.rust500, cream: "#e3d6b8", wood: "#94683f", silver: "#b9bcbd", gold: TOK.caution700
};

// --- Tokens ---------------------------------------------------------------------------
// L, H: length and height in feet; scale: how much bigger than life it is drawn
// [interpretation] (a strip is read across a table: a token is a comic's car, not
// a plan's); water: it floats (its y = 0 is its water line).
const chV = c => "ch-v:" + c, chVs = c => "ch-v:" + c + ":s", chVt = c => "ch-v:" + c + ":t";
const chWheel = (x, r) => [P.circle("ch-wheel", x, -r, r), P.circle("ch-hub", x, -r, r * 0.42)];
const chRider = (x, y, s = 1) => [P.rect("ch-rider", x - 0.58 * s, y + 0.3 * s, 1.16 * s, 0.85 * s, { rx: 0.35 * s }), P.circle("ch-rider", x, y, 0.58 * s)];
CH.TOKENS = {
  autopod: { page: "p.304–305", L: 11.4, H: 4.8, scale: 1.5, colour: "red", describe: "An autopod, the convertible: open top, riders' heads showing (one per rider, up to four). `half`: the rear torn off.",
    draw(o) {
      const c = o.colour, k = [], half = !!o.half, x0 = half ? -0.9 : -5.6;
      k.push(P.path(chV(c), half ? "M-0.6 -0.6 L-1.2 -1.3 L-0.5 -1.8 L-1.3 -2.4 L-0.6 -3.05 L1.5 -3.05 L3.1 -2.85 Q5.4 -2.55 5.7 -1.8 L5.7 -0.9 Q5.6 -0.6 5.1 -0.6 Z"
        : "M-5.6 -0.7 L-5.7 -2.5 L-5.1 -3.65 L-3.9 -3.05 L1.5 -3.05 L3.1 -2.85 Q5.4 -2.55 5.7 -1.8 L5.7 -0.9 Q5.6 -0.6 5.1 -0.6 L-5.1 -0.6 Z"));
      k.push(P.rect(chVs(c), x0 + 0.1, -1.4, 5.55 - x0, 0.8), P.rect("ch-trim", x0 + 0.3, -2.35, 5.2 - x0, 0.2));
      k.push(P.rect("ch-dark", x0 + 0.5, -3.3, 1.5 - x0 - 0.5, 0.3), P.poly("ch-glass", [[1.5, -3.05], [2.15, -3.05], [1.25, -4.65], [0.8, -4.65]]));
      const n = o.riders === 0 ? 0 : Math.max(1, Math.min(4, o.riders || 1));
      if (!half) [0.15, -1.35, -2.85, -4.2].slice(0, n).forEach(x => k.push(...chRider(x, -4.2)));
      else if (n) {
        k.push(...chRider(0.15, -4.2));
        // the others cling to the torn back
        for (let i = 1; i < n; i++) { const x = -1.3 - (i - 1) * 0.9, y = -2.6 + (i - 1) * 0.9; k.push(P.rect("ch-rider", x - 0.5, y, 1.5, 0.8, { rx: 0.35, tf: { rot: -18 } }), P.circle("ch-rider", x - 0.6, y - 0.2, 0.55)); }
      }
      k.push(P.circle("ch-head", 5.35, -1.95, 0.32));
      if (!half) k.push(P.rect("ch-tail", -5.75, -2.5, 0.35, 0.6));
      k.push(...chWheel(3.6, 1.05));
      if (!half) k.push(...chWheel(-3.6, 1.05));
      return k;
    } },
  autocycle: { page: "p.304–305", L: 7.6, H: 6, scale: 1.55, colour: "black", describe: "An autocycle with its rider, hunched forward.",
    draw(o) {
      const c = o.colour;
      return [P.rect("ch-hub", -3.5, -1.5, 2.6, 0.36, { rx: 0.15 }), P.poly("ch-hub", [[2.55, -1.0], [2.9, -1.0], [3.35, -2.7], [3.0, -2.7]]),
        P.path(chV(c), "M-3.2 -1.5 L-1.3 -2.35 L0.2 -2.25 L1.3 -2.85 L2.9 -2.95 Q3.75 -2.75 3.55 -2.1 L2.4 -1.6 L-0.4 -1.3 Z"),
        P.path("ch-rider", "M-1.3 -2.3 L0.6 -2.45 L1.95 -4.25 Q1.75 -4.95 1.0 -4.95 L-0.7 -3.0 Z"),
        P.poly("ch-rider", [[-0.2, -2.4], [0.95, -2.45], [1.05, -1.5], [0.5, -1.4]]), P.poly("ch-rider", [[1.2, -4.25], [1.65, -4.45], [3.0, -3.1], [2.65, -2.9]]),
        P.circle("ch-rider", 1.55, -5.4, 0.68), P.rect("ch-glass", 1.75, -5.7, 0.5, 0.35, { rx: 0.15 }),
        P.circle("ch-head", 3.55, -2.6, 0.3), ...chWheel(-2.7, 1.0), ...chWheel(2.75, 1.0)];
    } },
  suv: { page: null, L: 13.2, H: 6.4, scale: 1.38, colour: "black", describe: "A boxy SUV, tinted glass.",
    draw(o) {
      const c = o.colour;
      return [P.path(chV(c), "M-6.5 -1.2 L-6.5 -5.8 Q-6.4 -6.35 -5.8 -6.35 L2.4 -6.35 L4.3 -4.1 L6.2 -3.7 Q6.6 -3.5 6.6 -2.9 L6.6 -1.2 Z"),
        P.rect(chVs(c), -6.5, -2.05, 13.1, 0.85), P.poly("ch-win", [[-5.8, -5.9], [2.15, -5.9], [3.75, -4.25], [-5.8, -4.25]]),
        P.rect(chV(c), -2.3, -5.95, 0.45, 1.75), P.rect(chV(c), 0.9, -5.95, 0.45, 1.75), P.rect("ch-trim", -6.3, -3.4, 12.6, 0.16),
        P.circle("ch-head", 6.3, -3.25, 0.32), P.rect("ch-tail", -6.65, -4.6, 0.3, 0.9), ...chWheel(-4.2, 1.35), ...chWheel(4.3, 1.35)];
    } },
  "garbage-truck": { page: null, L: 24, H: 10.2, scale: 0.92, colour: "green", describe: "A garbage truck: the compactor body, ribbed, and its cab.",
    draw(o) {
      const c = o.colour, k = [P.path(chV(c), "M-11 -2 L-11 -8.6 Q-11 -10.1 -9.6 -10.1 L4.6 -10.1 L4.6 -2 Z")];
      for (let x = -8.6; x < 4; x += 2.3) k.push(P.rect(chVs(c), x, -9.8, 0.45, 7.6));
      k.push(P.poly(chVs(c), [[-11, -2], [-11, -7], [-12.5, -3.4], [-12.5, -2]]));
      for (let i = 0; i < 3; i++) k.push(P.rect("ch-hazard", -12.45, -3.2 + i * 0.4, 1.4, 0.2));
      k.push(P.path(chVt(c), "M4.9 -2 L4.9 -9.2 L8.4 -9.2 L11.2 -5.6 L11.2 -2 Z"), P.poly("ch-win", [[5.6, -8.6], [8.0, -8.6], [10.2, -5.9], [5.6, -5.9]]),
        P.rect("ch-hub", -12.5, -2.7, 23.9, 0.9), P.rect("ch-amber", 6, -9.75, 1.3, 0.55, { rx: 0.2 }), P.circle("ch-head", 11.0, -3.6, 0.4),
        ...chWheel(-8, 1.5), ...chWheel(-4.5, 1.5), ...chWheel(8.4, 1.5));
      return k;
    } },
  ambulance: { page: null, L: 17.4, H: 9.5, scale: 1.18, colour: "white", describe: "An ambulance: a high van with its stripe, its cross and a blue lamp.",
    draw(o) {
      const c = o.colour;
      return [P.path(chV(c), "M-8.5 -1.4 L-8.5 -8.6 L4.2 -8.6 L6.4 -5.3 L8.4 -4.8 Q8.7 -4.6 8.7 -4 L8.7 -1.4 Z"),
        P.rect(chVs(c), -8.5, -2.15, 17.2, 0.75), P.rect("ch-stripe", -8.5, -4.35, 17.2, 0.85),
        P.rect("ch-cross", -3.2, -7.75, 1.4, 2.8), P.rect("ch-cross", -3.9, -7.05, 2.8, 1.4),
        P.rect("ch-win", -8.2, -7.9, 1.1, 1.8), P.poly("ch-win", [[4.5, -8.2], [5.95, -8.2], [7.5, -5.55], [4.5, -5.55]]),
        P.rect("ch-siren", 2.5, -9.45, 1.7, 0.85, { rx: 0.35 }), P.circle("ch-head", 8.5, -3.3, 0.35), P.rect("ch-tail", -8.68, -3.3, 0.3, 0.9),
        ...chWheel(-5.4, 1.25), ...chWheel(5.4, 1.25)];
    } },
  "watch-car": { page: "p.261", L: 12.4, H: 5.6, scale: 1.42, colour: "navy", name: "Bluecoat autopod", describe: "A Bluecoat autopod: the Watch's blue, white doors, a light bar.",
    draw(o) {
      const c = o.colour;
      return [P.path(chV(c), "M-6 -1.1 L-6.1 -3.0 L-3.5 -3.25 L-2.1 -5.0 L2.0 -5.0 L3.6 -3.25 L5.9 -2.9 Q6.25 -2.7 6.25 -2.1 L6.25 -1.1 Z"),
        P.rect("ch-v:white", -2.0, -3.2, 4.0, 1.85), P.rect(chVs(c), -6, -1.75, 12.25, 0.65),
        P.poly("ch-win", [[-1.85, -4.75], [1.8, -4.75], [3.1, -3.3], [-3.15, -3.3]]), P.rect(chV(c), -0.2, -4.8, 0.4, 1.5),
        P.rect("ch-siren-red", -1.05, -5.6, 1.05, 0.6, { rx: 0.2 }), P.rect("ch-siren", 0, -5.6, 1.05, 0.6, { rx: 0.2 }),
        P.circle("ch-head", 6.05, -2.4, 0.3), P.rect("ch-tail", -6.2, -2.8, 0.3, 0.7), ...chWheel(-3.9, 1.1), ...chWheel(3.9, 1.1)];
    } },
  barge: { page: "p.404–405", L: 36.6, H: 9.6, deck: 5.8, scale: 0.9, colour: "brown", water: true, describe: "A canal barge: a long hull, a heap of cargo or rubbish, a cabin at the stern.",
    draw(o) {
      const c = o.colour, k = [P.path(chV(c), "M-18 -2.6 L16.4 -2.6 Q18.6 -2.4 18.4 -0.6 L17.2 1.6 L-16.8 1.6 Q-18.2 1 -18 -2.6 Z"), P.rect(chVs(c), -18, -3, 34.8, 0.55)];
      k.push(P.path("ch-trash", "M-10.6 -2.6 Q-10 -6.2 -6.2 -6.7 Q-3 -7.7 0 -6.3 Q3 -7.1 6 -5.5 Q8.6 -4.6 9.6 -2.6 Z"));
      for (const [x, y, r, j] of [[-8, -5.4, 0.95, 2], [-4.4, -6.6, 1.05, 3], [-0.6, -5.8, 0.9, 2], [3, -6.1, 0.8, 3], [6.4, -4.3, 0.8, 2], [-2.2, -4.4, 0.7, 3]]) k.push(P.circle("ch-trash" + j, x, y, r));
      k.push(P.rect("ch-trash3", 1.2, -7.4, 2.4, 0.5, { tf: { rot: -14 } }), P.rect(chVt(c), -16.6, -7.5, 5.4, 4.9), P.rect(o.night ? "ch-winlit" : "ch-win", -15.7, -6.7, 1.6, 1.4), P.rect("ch-dark", -12.9, -9.7, 0.7, 2.2));
      return k;
    } },
  canoe: { page: null, L: 13.6, H: 5.6, deck: 1.2, scale: 1.2, colour: "wood", water: true, describe: "A canoe with its paddler.",
    draw(o) {
      const c = o.colour;
      return [P.line("ch-paddle", 2.3, -5.7, -2.4, 0.6, { sw: 0.26 }), P.ellipse("ch-paddle-blade", -2.45, 0.7, 0.4, 1.15, { tf: { rot: 37 } }),
        P.path("ch-rider", "M-1.4 -0.8 L0.6 -0.8 L0.5 -3.4 Q0 -4.3 -0.8 -4.0 L-1.5 -2.6 Z"), P.circle("ch-rider", -0.1, -4.8, 0.6),
        P.poly("ch-rider", [[0.1, -3.6], [0.5, -3.9], [1.9, -4.9], [1.7, -4.4]]),
        P.path(chV(c), "M-6.6 -1.3 Q-3 0.5 0 0.55 Q3 0.5 6.6 -1.3 Q6.9 -1.75 6.3 -1.6 Q3 -0.7 0 -0.7 Q-3 -0.7 -6.3 -1.6 Q-6.9 -1.75 -6.6 -1.3 Z"),
        P.path(chVs(c), "M-6 -1.05 Q0 0.9 6 -1.05 Q0 0.1 -6 -1.05 Z")];
    } },
  gondola: { page: "p.304, p.412–413", L: 26, H: 8.4, deck: 1.0, scale: 0.95, colour: "black", water: true, describe: "A gondola: a long black hull, curled at both ends, its gondolier standing at the stern with the pole.",
    draw(o) {
      const c = o.colour;
      return [P.line("ch-paddle", -9.6, -8.2, -6.4, 1.4, { sw: 0.24 }), P.path("ch-rider", "M-10.6 -1 L-9.2 -1 L-9.3 -5.6 Q-9.8 -6.3 -10.4 -5.8 Z"), P.circle("ch-rider", -9.8, -6.6, 0.55),
        P.poly("ch-rider", [[-9.6, -5.4], [-9.2, -5.6], [-8.8, -7.4], [-9.2, -7.4]]),
        P.path(chV(c), "M-13 -2.6 Q-12.4 -1.4 -11 -0.9 L10 -0.9 Q12 -1.2 12.6 -2.6 L13.2 -4.6 L12.6 -4.6 L12 -2.4 Q11 -1.9 10 -1.8 L-11 -1.8 Q-12 -2 -12.4 -2.6 Z"),
        P.path(chV(c), "M-11.5 -0.9 Q0 0.9 11 -0.9 Z"), P.rect(chVs(c), 12.6, -5.4, 0.7, 1.2, { rx: 0.2 }), P.rect("ch-trim", -3, -2.2, 6, 0.5, { rx: 0.2 }), P.rect(chVt(c), -2.6, -2.6, 5.2, 0.6)];
    } },
  airship: { page: "p.259, p.305", L: 42, H: 16, scale: 0.62, colour: "grey", air: true, describe: "An airship: the envelope, its fins, the cabin slung under it and a searchlight. It flies over the panel whatever its level; with the searchlight fx the beam comes from it.",
    draw(o) {
      const c = o.colour;
      return [P.ellipse(chV(c), 0, -10.5, 21, 5.6), P.path(chVs(c), "M-21 -10.5 Q0 -2.6 21 -10.5 Q0 -6.4 -21 -10.5 Z"), P.rect("ch-trim", -14, -11.4, 28, 0.35),
        P.poly(chVs(c), [[-17, -11], [-23.5, -16.5], [-21.5, -10.5]]), P.poly(chVs(c), [[-17, -10], [-23.5, -5], [-21.5, -10.5]]),
        P.line("ch-paddle", -4, -5.4, -3, -3.4, { sw: 0.2 }), P.line("ch-paddle", 4, -5.4, 3, -3.4, { sw: 0.2 }),
        P.path(chVt(c), "M-5 -3.4 L5 -3.4 L4.2 -0.6 L-4.4 -0.6 Z"), P.rect(o.night ? "ch-winlit" : "ch-win", -3.8, -2.8, 7, 1.1), P.rect("ch-fx-lamp", 4.4, -1.4, 1.6, 1.1, { rx: 0.3 })];
    } },
  van: { page: "p.390–391", L: 14.4, H: 7.6, scale: 1.25, colour: "cream", describe: "A van: a boxy body, a short bonnet.",
    draw(o) {
      const c = o.colour;
      return [P.path(chV(c), "M-7.2 -1.2 L-7.2 -7.2 Q-7.2 -7.6 -6.8 -7.6 L3.6 -7.6 L5.6 -4.6 L7 -4.2 Q7.3 -4 7.3 -3.4 L7.3 -1.2 Z"),
        P.rect(chVs(c), -7.2, -2.0, 14.5, 0.8), P.poly("ch-win", [[3.8, -7.1], [5.2, -4.8], [2.6, -4.8], [2.6, -7.1]]), P.rect("ch-trim", -6.4, -4.2, 8.2, 0.18), P.rect(chVs(c), -0.2, -7.2, 0.25, 5.6),
        P.circle("ch-head", 7.1, -3.0, 0.32), P.rect("ch-tail", -7.35, -3.6, 0.3, 0.8), ...chWheel(-4.6, 1.2), ...chWheel(4.6, 1.2)];
    } },
  "fire-engine": { page: "p.261–262", L: 25, H: 10.2, scale: 0.95, colour: "red", describe: "A fire engine: the long red body, a ladder on top, a bell and a lamp.",
    draw(o) {
      const c = o.colour, k = [P.path(chV(c), "M-12.4 -1.6 L-12.4 -7.2 L6.4 -7.2 L6.4 -9 L9.8 -9 L12.5 -5.4 L12.5 -1.6 Z"), P.rect(chVs(c), -12.4, -2.6, 24.9, 1)];
      for (let x = -11.6; x < 5.6; x += 3.4) k.push(P.rect(chVs(c), x, -6.6, 2.8, 3.4, { rx: 0.2 }));
      k.push(P.rect("ch-hub", -12.8, -8.2, 18.4, 0.3), P.rect("ch-hub", -12.8, -9.4, 18.4, 0.3));
      for (let x = -12.2; x < 5.6; x += 1.4) k.push(P.rect("ch-hub", x, -9.4, 0.2, 1.5));
      k.push(P.poly("ch-win", [[6.9, -8.5], [9.5, -8.5], [11.6, -5.8], [6.9, -5.8]]), P.circle("ch-amber", 4.8, -7.9, 0.6), P.rect("ch-siren-red", 7.4, -9.6, 1.6, 0.6, { rx: 0.25 }),
        P.circle("ch-head", 12.3, -3.2, 0.4), ...chWheel(-8.6, 1.5), ...chWheel(-4.8, 1.5), ...chWheel(8.6, 1.5));
      return k;
    } },
  bus: { page: "p.304", L: 32, H: 10.4, scale: 0.88, colour: "orange", describe: "A bus: a long single deck, a row of windows, its route board lit at Night.",
    draw(o) {
      const c = o.colour, k = [P.path(chV(c), "M-16 -1.4 L-16 -9.4 Q-16 -10.4 -15 -10.4 L14.8 -10.4 Q16 -10.4 16 -9 L16 -1.4 Z"), P.rect(chVs(c), -16, -2.6, 32, 1.2), P.rect("ch-trim", -16, -4.4, 32, 0.4)];
      for (let x = -14.6; x < 11; x += 3.6) k.push(P.rect("ch-win", x, -9.2, 3, 3.6, { rx: 0.2 }));
      k.push(P.rect("ch-win", 12.6, -9.2, 2.8, 7.4, { rx: 0.2 }), P.rect(o.night ? "ch-amber" : "ch-dark", 8, -10.2, 6, 0.8), P.circle("ch-head", 15.7, -3.2, 0.4), ...chWheel(-10.4, 1.4), ...chWheel(10.2, 1.4));
      return k;
    } },
  "luxury-autopod": { page: "p.331, p.158, p.337", L: 14.4, H: 4.6, scale: 1.3, colour: "black", describe: "A luxury autopod: long and low, a glass canopy, chrome along its flank.",
    draw(o) {
      const c = o.colour;
      return [P.path(chV(c), "M-7.2 -0.8 L-7.3 -2.4 Q-6.6 -3.1 -4.4 -3.1 L-2.4 -3.1 Q-0.6 -4.6 1.8 -4.6 Q3.6 -4.6 4.6 -3.1 L5.8 -3.0 Q7.3 -2.7 7.4 -1.7 L7.4 -0.9 Q7.2 -0.6 6.6 -0.6 L-6.6 -0.6 Z"),
        P.path("ch-glass", "M-1.9 -3.15 Q-0.4 -4.3 1.8 -4.3 Q3.3 -4.3 4.1 -3.15 Z"), P.rect(chVs(c), -7.2, -1.4, 14.5, 0.75), P.rect("ch-trim", -6.8, -2.1, 13.6, 0.22), P.rect("ch-trim", -6.8, -1.5, 13.6, 0.1),
        P.circle("ch-rider", 0.7, -3.5, 0.5), P.circle("ch-head", 7.15, -2.0, 0.3), P.rect("ch-tail", -7.4, -2.4, 0.35, 0.6), ...chWheel(-4.6, 1.1), ...chWheel(4.6, 1.1)];
    } },
  walker: { page: "a person, not a vehicle", L: 2.6, H: 6.6, scale: 1.2, colour: "grey", describe: "A person on foot, as a flat silhouette.",
    draw(o) {
      const c = o.colour;
      return [P.poly(chVs(c), [[-0.5, -2.8], [0.15, -2.8], [-1.0, 0], [-1.65, 0]]), P.poly(chVs(c), [[0, -2.8], [0.65, -2.8], [1.55, -0.1], [0.95, 0]]),
        P.path(chV(c), "M-0.85 -2.35 L0.95 -2.35 L0.75 -4.95 Q0.55 -5.45 0 -5.45 Q-0.65 -5.45 -0.75 -4.95 Z"),
        P.poly(chVs(c), [[0.25, -4.85], [0.7, -4.75], [1.45, -3.35], [1.1, -3.15]]), P.circle("ch-rider", 0.12, -6.05, 0.58)];
    } }
};

// --- States -------------------------------------------------------------------------------
CH.STATES = {
  airborne: "Off the ground: nose up, lifted, its shadow left on the surface below.",
  wrecked: "On its roof, smoking.",
  burning: "On fire: flames on top, a glow, smoke.",
  down: "Down: a cycle on its side skidding, a car slumped, a person lying.",
  rammed: "Hit: knocked askew, a dent burst on its side.",
  "two-wheels": "Up on two wheels, sparks where it scrapes.",
  spin: "Spinning out: turned, with motion arcs and skid marks.",
  chasing: "Flat out: speed lines behind; at Night, its headlamps on.",
  half: "The rear torn off (an autopod only), sparks where it drags."
};

// --- FX -----------------------------------------------------------------------------------
CH.FX = {
  muzzle: "Gunfire: a muzzle flash at the crew's lead, toward the nearest pursuer.",
  impact: "A collision burst where two tokens meet (or on the rammed one).",
  "flame-wall": "A wall of flame across the road behind the crew.",
  nos: "A blue exhaust jet: NOS.",
  "railing-break": "A railing smashed through, the pieces flying.",
  grenade: "An explosion under the burning (or first pursuing) token.",
  searchlight: "A floodlight's beam sweeping down from above.",
  fog: "Fog in bands across the panel.",
  "glow-water": "The water lit from within: a bioluminescent canal.",
  "anomaly-bloom": "A bloom of anomalous light.",
  fruit: "A fruit stand smashed, fruit in the air.",
  grate: "A grate in the road, open, with its shaft down to the level below.",
  "briefcase-drop": "A briefcase falling from the street to the level below.",
  "dark-water": "Black water below: the sewer at its worst."
};

// --- Grounds ------------------------------------------------------------------------------------
// The eight grounds of the street view, plus the bridge. What each puts on each level.
CH.GROUNDS = {
  corridor: { above: "rooftops of the frontage", street: "a road, a pavement, shopfronts behind", below: "a sewer" },
  lane: { above: "rooftops and wires", street: "a narrow road between brick walls", below: "a sewer" },
  deck: { above: "the deck: a flyover or a walkway on pillars", street: "the road under it", below: "a sewer" },
  open: { above: "the podium decks of the blocks", street: "open paving", below: "an underpass" },
  hub: { above: "rooftops", street: "the roundabout and its island", below: "an underpass" },
  covered: { above: "the arcade's glass roof", street: "the arcade between its shopfronts", below: "a service tunnel" },
  deadend: { above: "rooftops", street: "a lane that ends in a wall", below: "a sewer" },
  waterside: { above: "warehouse roofs", street: "the towpath", below: "the canal" },
  bridge: { above: "the bridge's girders", street: "the bridge deck", below: "the canal under it" },
  // [interpretation] two grounds from Out of Doors (E2): a car park's decks and a quay's edge
  carpark: { above: "the car park's upper decks", street: "its ground floor, between the bays", below: "the lower deck" },
  quay: { above: "cranes and the warehouse roofs", street: "the quay's edge", below: "the dock water" }
};
// What a street description that isn't a printed type means: the first word that matches.
CH.GROUND_WORDS = [[/bridge|viaduct/i, "bridge"], [/car ?park|parking (?:deck|garage|structure)|multi-?stor(?:e)?y/i, "carpark"], [/flyover|overpass|elevated|walkway|deck/i, "deck"],
  [/quay|wharf|\bdocks?\b|jetty/i, "quay"], [/canal|tow ?path|river/i, "waterside"],
  [/alley|lane|backstreet|back street|cobble/i, "lane"], [/arcade|glass-roofed|covered/i, "covered"], [/roundabout|circus|junction/i, "hub"],
  [/plaza|square|open/i, "open"], [/dead[- ]end|cul-de-sac/i, "deadend"], [/boulevard|high street|avenue|road|street/i, "corridor"]];

// --- Words → drawers: a prop the printed table doesn't know is read for one of these ----------------
CH.PROP_WORDS = [[/barge/i, "barge"], [/gondola/i, "gondolas"], [/boat/i, "boats"], [/canal lock|\block\b/i, "lock"], [/lamp/i, "lamps"], [/railing|\brails?\b/i, "railing"],
  [/fruit/i, "fruit"], [/news/i, "news"], [/stall|stand|kiosk/i, "stall"], [/crate/i, "crates"], [/\bbins?\b/i, "bins"], [/trash|rubbish|refuse|garbage/i, "trash"],
  [/barrel|cask/i, "barrels"], [/drum/i, "drums"], [/statue/i, "statue"], [/barricade|roadblock/i, "barricade"], [/checkpoint/i, "checkpoint"], [/grate|drain|manhole/i, "grate"],
  [/wire|cable/i, "wires"], [/fountain/i, "fountain"], [/monument/i, "monument"], [/crane/i, "crane"], [/rubble/i, "rubble"], [/scaffold/i, "scaffold"], [/pipe/i, "pipes"], [/puddle/i, "puddles"]];

// --- People, side-on -------------------------------------------------------------------------------
const chPerson = (x, h, role, o = {}) => {
  const w = h * 0.3, k = [P.rect(role, x - w / 2, -h + h * 0.2, w, h * 0.8, { rx: w * 0.4 }), P.circle(role, x, -h + h * 0.1, h * 0.13)];
  if (o.sign) k.push(P.rect("st-d:placard-stick", x + w * 0.2, -h - 2.6, 0.24, 3.2), P.rect("st-d:placard", x - 1.2, -h - 4.4, 3, 2.1));
  if (o.arm) k.push(P.poly(role, [[x, -h * 0.72], [x + 0.35, -h * 0.75], [x + 1.6, -h * 1.02], [x + 1.3, -h * 1.06]]));
  return k;
};
CH.person = chPerson;
const chCrowd = (rng, x0, x1, role, o = {}) => {
  const k = [];
  for (let x = x0; x < x1; x += 1.2 + rng() * 1.1) k.push(...chPerson(x, 5.6 + rng() * 1.4, o.role2 && rng() < (o.share || 0.3) ? o.role2 : role, { sign: o.signs && rng() < o.signs, arm: o.arms && rng() < o.arms }));
  return k;
};
const chN = v => Math.round(v * 100) / 100;
const chFlame = (x, y, h, w) => {
  const X = f => chN(x + w * f), Y = f => chN(y - h * f);
  return [P.path("ch-fx-flame", `M${X(-0.5)} ${Y(0)} Q${X(-0.6)} ${Y(0.45)} ${X(-0.12)} ${Y(0.8)} Q${X(-0.02)} ${Y(0.5)} ${X(0.12)} ${Y(0.48)} Q${X(0.3)} ${Y(0.78)} ${X(0.18)} ${Y(1)} Q${X(0.75)} ${Y(0.5)} ${X(0.5)} ${Y(0)} Z`),
    P.path("ch-fx-flamecore", `M${X(-0.24)} ${Y(0)} Q${X(-0.24)} ${Y(0.3)} ${X(0.04)} ${Y(0.5)} Q${X(0.36)} ${Y(0.3)} ${X(0.26)} ${Y(0)} Z`)];
};
CH.n = chN;
CH.flame = chFlame;
const chSmoke = (x, y, s) => [P.circle("ch-fx-smoke", x, y, 1.6 * s), P.circle("ch-fx-smoke", x + 1.4 * s, y - 2.2 * s, 2.0 * s), P.circle("ch-fx-smoke", x + 0.2 * s, y - 4.4 * s, 2.4 * s)];
CH.smoke = chSmoke;

// --- Props, side-on (PROP.d → drawer) ----------------------------------------------------------------
// Each draws standing on y = 0 at x = 0. ctx: { rng, night, water, below }. Returns pieces, or
// { k: pieces, zone } to move it: "water" floats on the level below, "air" hangs at the above
// level, "back" stands behind the pavement, "road" lies in the road's top.
const chBox = (mat, x, y, w, h, o) => P.rect("st-f:" + mat, x, y, w, h, o);
const chEdge = (mat, x, y, w, h, o) => P.rect("st-s:" + mat, x, y, w, h, o);
const chLamp = (x, night) => {
  const k = [P.rect("st-f:lamp", x - 0.25, -12, 0.5, 12), P.rect("st-f:lamp", x - 0.25, -12.2, 2.4, 0.4), P.rect("st-d:lamphead", x + 1.2, -12.2, 1.6, 0.9, { rx: 0.3 })];
  if (night) k.unshift(P.poly("ch-cone", [[x + 1.4, -11.4], [x + 2.6, -11.4], [x + 6.8, 0], [x - 2.8, 0]]), P.ellipse("ch-pool", x + 2, 0, 5.6, 0.6));
  return k;
};
CH.lamp = chLamp;
const PRS = CH.PROPS = {
  crates: () => [chBox("wood", -3.1, -3, 3, 3), chBox("wood", 0.1, -3, 3, 3), chBox("wood", -1.5, -6, 3, 3), chEdge("wood", -3.1, -3, 3, 0.4), chEdge("wood", 0.1, -3, 3, 0.4), chEdge("wood", -1.5, -6, 3, 0.4)],
  bales: () => [chBox("canvas", -3, -2.8, 3, 2.8, { rx: 0.6 }), chBox("canvas", 0, -2.8, 3, 2.8, { rx: 0.6 }), chBox("canvas", -1.5, -5.4, 3, 2.7, { rx: 0.6 }), chEdge("rope", -1.6, -2.8, 0.25, 2.8), chEdge("rope", 1.4, -2.8, 0.25, 2.8)],
  nets: () => [P.path("st-f:net", "M-3 0 L-2.4 -2.4 Q0 -3.4 2.2 -2.2 L3 0 Z"), P.ellipse("st-f:rope", 1.6, -0.5, 1.6, 0.5), P.ellipse("st-s:rope", -1.6, -0.45, 1.3, 0.45)],
  cables: () => [P.circle("st-f:wood", 0, -2, 2), P.circle("st-s:wood", 0, -2, 1.1), P.circle("st-d:dark", 0, -2, 0.35), chBox("metal", 2.6, -3, 0.3, 3), chBox("metal", 3.6, -2.6, 0.3, 2.6)],
  pipes: () => { const k = []; for (let i = 0; i < 4; i++) k.push(P.circle("st-f:metal", -2.4 + i * 1.6, -0.75 - (i % 2) * 1.3, 0.75), P.circle("st-d:dark", -2.4 + i * 1.6, -0.75 - (i % 2) * 1.3, 0.4)); return k; },
  pump: () => [chBox("iron", -0.5, -4.2, 1, 4.2), chBox("iron", -0.3, -3.8, 2.4, 0.35, { tf: { rot: -12 } }), chBox("iron", 0.5, -2.8, 0.9, 0.35), P.ellipse("st-g:puddle", 1.4, 0, 1.8, 0.3)],
  drums: () => [-2.2, 0, 2.2].flatMap(x => [chBox("drum", x - 1, -3.2, 2, 3.2, { rx: 0.25 }), chEdge("drum", x - 1, -2.3, 2, 0.25), chEdge("drum", x - 1, -1.0, 2, 0.25)]),
  coal: () => [P.path("st-f:coal", "M-4 0 Q-2.6 -2.4 -0.6 -2 Q0.6 -2.8 2 0 Z"), chBox("drum", 2, -3.2, 2, 3.2, { rx: 0.25 }), chEdge("drum", 2, -2.3, 2, 0.25)],
  barrels: () => [-1.3, 1.3].flatMap(x => [chBox("wood", x - 1.2, -3.4, 2.4, 3.4, { rx: 0.9 }), chEdge("iron", x - 1.2, -2.6, 2.4, 0.22), chEdge("iron", x - 1.2, -1.0, 2.4, 0.22)]),
  buckets: () => [-1.6, 0, 1.6].map(x => P.poly("st-f:metal", [[x - 0.7, -1.5], [x + 0.7, -1.5], [x + 0.55, 0], [x - 0.55, 0]])).concat([chBox("concrete", 2.6, -1.8, 2.4, 1.8)]),
  bricks: () => { const k = []; for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) k.push(chBox("brick", -3 + r * 0.8 + i * 1.6, -(r + 1) * 0.8, 1.5, 0.75)); return k; },
  stones: () => [chBox("stone", -3, -1.8, 2.6, 1.8), chBox("stone", -0.2, -1.6, 2.8, 1.6), chBox("stone", -1.8, -3.4, 2.4, 1.6), chEdge("stone", -3, -1.8, 2.6, 0.3)],
  ingots: () => [0, 1, 2].map(i => P.poly(i % 2 ? "st-f:gold" : "st-f:metal", [[-2.2 + i * 0.3, -i * 0.6], [2.2 - i * 0.3, -i * 0.6], [1.9 - i * 0.3, -(i + 1) * 0.6], [-1.9 + i * 0.3, -(i + 1) * 0.6]])),
  bars: () => [0, 1, 2, 3].map(i => chBox("iron", -1.4 + i * 0.6, -6, 0.3, 6, { tf: { rot: 12 } })),
  boards: () => [0, 1, 2, 3].map(i => chBox("wood", -2 + i * 0.9, -7, 0.75, 7, { tf: { rot: 9 } })).concat([chBox("wood", -3.5, -0.9, 7, 0.9)]),
  rocks: () => [[-2.6, 0.7], [-1, 0.9], [0.9, 0.6], [2.4, 0.8]].map(([x, r]) => P.ellipse("st-f:rock", x, -r * 0.6, r, r * 0.7)),
  rubble: () => [P.path("st-f:rubblestone", "M-5 0 Q-3.4 -2.6 -1 -2.2 Q0.6 -3.6 2.6 -1.8 Q4.4 -1.2 5 0 Z"), chBox("brick", -2, -3, 1.6, 1, { tf: { rot: -20 } }), chBox("rubblestone", 1.2, -2.8, 1.4, 1, { tf: { rot: 14 } })],
  junk: () => [chBox("metal", -3, -2.4, 2.6, 2.4), P.circle("st-d:dark", 1.4, -0.9, 0.9), chBox("wood", 0.4, -4, 0.6, 4, { tf: { rot: 16 } }), chBox("rust", -0.6, -1.4, 1.8, 1.4)],
  trash: () => [chBox("bin", -2.6, -3.4, 2.2, 3.4), chEdge("bin", -2.8, -3.6, 2.6, 0.4), P.circle("st-g:bag", 0.8, -0.9, 1), P.circle("st-g:bag", 2.4, -0.8, 0.85), P.circle("st-g:bag", 1.5, -2.0, 0.8), P.ellipse("st-g:puddle", 0.6, 0, 3, 0.3)],
  refuse: () => [P.path("st-g:rot", "M-4 0 Q-2 -1.2 0 -0.9 Q2 -1.4 4 0 Z"), P.circle("st-g:bag", -1.4, -1.1, 1.1), P.circle("st-g:bag", 0.6, -1.3, 1.2), P.circle("st-g:bag", 2.2, -0.9, 0.9)],
  bins: () => [-2.6, 0, 2.6].flatMap(x => [chBox("bin", x - 1.1, -3.6, 2.2, 3.6), chEdge("bin", x - 1.25, -3.85, 2.5, 0.4)]),
  carts: () => [-2.4, 2.4].flatMap(x => [chBox("wood", x - 1.8, -3, 3.6, 2, { rx: 0.2 }), chEdge("wood", x + 1.6, -4.4, 0.3, 1.6, { tf: { rot: 20 } }), P.circle("st-d:dark", x, -0.8, 0.8)]),
  lamps: (c) => chLamp(0, c.night),
  boxes: () => [-1.4, 1.4].flatMap(x => [chBox("metal", x - 1.1, -4.4, 2.2, 4.4), P.rect("st-d:hazard", x - 0.5, -3.6, 1, 0.6)]),
  post: () => [chBox("post", -1.1, -4.6, 2.2, 4.6, { rx: 1 }), P.rect("st-d:dark", -0.6, -3.3, 1.2, 0.35), chEdge("post", -1.2, -4.8, 2.4, 0.5, { rx: 0.25 })],
  monument: () => [chBox("stone", -3, -2, 6, 2), chBox("stone", -1.4, -15, 2.8, 13), P.poly("st-f:stone", [[-1.4, -15], [1.4, -15], [0, -18.5]]), chEdge("stone", 0.8, -15, 0.6, 13)],
  fountain: () => [P.path("st-f:stone", "M-5 0 L-5 -1.6 L5 -1.6 L5 0 Z"), P.rect("st-g:water", -4.6, -1.6, 9.2, 0.4), chBox("stone", -0.5, -5, 1, 3.4), P.ellipse("st-x:spray", 0, -5.6, 1.8, 1.2)],
  stall: () => [chBox("wood", -3.4, -3.4, 6.8, 3.4), P.rect("st-d:goods", -3, -3.9, 6, 0.6), chBox("wood", -3.3, -7.6, 0.3, 4.2), chBox("wood", 3, -7.6, 0.3, 4.2), chBox("awning", -3.9, -8.2, 7.8, 0.8)].concat([0, 1, 2, 3].map(i => P.rect("st-d:stripe", -3.9 + i * 1.95, -8.2, 0.97, 0.8))),
  fruit: () => [chBox("wood", -3.4, -3.4, 6.8, 3.4), chBox("wood", -3.3, -7.6, 0.3, 4.2), chBox("wood", 3, -7.6, 0.3, 4.2), chBox("awning", -3.9, -8.2, 7.8, 0.8)]
    .concat([[-2.4, "1"], [-1.5, "2"], [-0.6, "3"], [0.3, "1"], [1.2, "2"], [2.1, "3"], [-1.9, "3"], [0.8, "1"]].map(([x, j], i) => P.circle("ch-fx-fruit" + j, x, -3.8 - (i > 5 ? 0.7 : 0), 0.5))),
  news: () => [chBox("kiosk", -3.2, -7.2, 6.4, 7.2), P.rect("st-d:papers", -2.6, -5.6, 5.2, 3.2), chEdge("kiosk", -3.6, -7.8, 7.2, 0.7), P.rect("st-d:shop", -2.6, -2, 5.2, 0.4)],
  grate: () => ({ zone: "road", k: [P.rect("st-g:grate", -2, -0.25, 4, 0.5)].concat([0, 1, 2, 3].map(i => P.rect("st-g:grate-bar", -1.8 + i * 1.1, -0.25, 0.3, 0.5))) }),
  puddles: () => ({ zone: "road", k: [P.ellipse("st-g:mud", -2, -0.05, 2.6, 0.22), P.ellipse("st-g:mud", 2.4, -0.05, 1.8, 0.18)] }),
  barricade: () => [-3, 0, 3].flatMap(x => [chBox("barrier", x - 1.4, -3.4, 2.8, 2.4), P.rect("st-d:stripe", x - 1.4, -2.6, 2.8, 0.6), chBox("barrier", x - 1.2, -1, 0.3, 1), chBox("barrier", x + 0.9, -1, 0.3, 1)]),
  gate: () => [chBox("iron", -3.2, -7, 0.5, 7), chBox("iron", 2.7, -7, 0.5, 7), chBox("iron", -3.2, -7.2, 6.4, 0.4)].concat([0, 1, 2, 3, 4, 5, 6].map(i => P.rect("st-d:grille", -2.4 + i * 0.8, -6.8, 0.16, 6.8))),
  checkpoint: (c) => [chBox("booth", -2, -8, 4, 8), P.rect(c.night ? "st-d:winlit" : "st-d:glass", -1.4, -6.4, 2.8, 2.2), chEdge("booth", -2.3, -8.4, 4.6, 0.5), chBox("barrier", 2, -4, 9, 0.6), P.rect("st-d:stripe", 4, -4, 1.4, 0.6), P.rect("st-d:stripe", 7, -4, 1.4, 0.6), chBox("barrier", 10.6, -4, 0.4, 4)],
  boats: () => ({ zone: "water", k: [-8, 7].flatMap(x => [P.path("st-f:boat", `M${x - 5} -1.4 L${x + 4} -1.4 L${x + 5.4} -1.2 L${x + 4} 0.8 L${x - 4.4} 0.8 Z`), chBox("deckwood", x - 2.4, -3, 3.4, 1.6), chEdge("boat", x - 5, -1.6, 9, 0.35)]) }),
  gondolas: () => ({ zone: "water", k: [-7, 8].flatMap(x => [P.path("st-f:gondola", `M${x - 6} -0.8 Q${x} 0.9 ${x + 5} -0.8 L${x + 6} -2.6 L${x + 5.4} -2.6 L${x + 4.4} -1 Q${x} -0.3 ${x - 5} -1 Z`), chBox("dark", x - 1, -1.8, 2, 0.8)]) }),
  barge: (c) => ({ zone: "water", k: [P.g(CH.TOKENS.barge.draw({ colour: "brown", night: c.night }), { tf: { s: 0.8 } })] }),
  lock: () => ({ zone: "water", k: [chBox("wood", -6.6, -5.5, 1.4, 7), chBox("wood", 5.2, -5.5, 1.4, 7), chEdge("wood", -7, -5.8, 14, 0.6), P.rect("st-g:waterhigh", -5.2, -1.6, 10.4, 1.6)] }),
  crane: () => ({ zone: "back", k: [chBox("rust", -1, -26, 2, 26), chBox("rust", -1, -26, 16, 1.6), P.line("st-x:wire", 13, -24.4, 13, -12, { sw: 0.2 }), chBox("wood", 11.5, -12, 3, 3), chEdge("rust", -3, -25.6, 2, 1.4)] }),
  spotlight: (c) => ({ zone: "back", k: (c.night ? [P.poly("ch-cone", [[-1.6, -31], [1.6, -31], [9, 0], [-4, 0]])] : []).concat([chBox("iron", -0.6, -30, 1.2, 30), chBox("iron", -2.4, -33, 4.8, 3), P.rect(c.night ? "st-d:signlit" : "st-d:glass", -1.8, -32.4, 3.6, 1.8)]) }),
  clock: () => ({ zone: "back", k: [chBox("stone", -3.4, -38, 6.8, 38), P.circle("st-d:clock", 0, -32, 2.4), P.poly("st-f:roof", [[-3.8, -38], [3.8, -38], [0, -45]]), chEdge("stone", 2.6, -38, 0.8, 38)] }),
  collapse: () => ({ zone: "back", k: [chBox("brick", -5, -14, 1.4, 14), P.poly("st-f:brick", [[-5, -14], [4, -9], [4, -7.6], [-3.6, -11]]), P.path("st-f:rubblestone", "M-6 0 Q-3 -3.4 0 -2.6 Q3 -4 6 0 Z")] }),
  hovel: () => ({ zone: "back", k: [chBox("wood", -4, -7, 8, 7), P.rect("st-d:dark", -1, -5.6, 2.2, 5.6), chBox("rust", -4.6, -7.6, 9.2, 0.7, { tf: { rot: -3 } })] }),
  wires: () => ({ zone: "air", k: [P.path("st-x:wire", "M-30 -2 Q0 2 30 -2", { sw: 0.2 }), P.path("st-x:wire", "M-30 -0.6 Q0 3.2 30 -0.6", { sw: 0.2 })] }),
  railing: () => { const k = [P.rect("st-f:iron", -8, -3.6, 16, 0.4)]; for (let x = -7.6; x <= 7.6; x += 1.6) k.push(P.rect("st-f:iron", x, -3.6, 0.26, 3.6)); k.push(P.rect("st-f:iron", -8, -1.9, 16, 0.2)); return k; },
  statue: () => [chBox("stone", -2.2, -6, 4.4, 6), P.rect("st-d:graffiti", -1.7, -4.4, 2.2, 2.2), P.path("st-f:bronze", "M-1.6 -6 L-1.1 -13.2 Q0 -14.4 1.1 -13.2 L1.7 -6 Z"), P.circle("st-f:bronze", 0, -15.2, 1.2),
    P.rect("st-f:bronze", 0.8, -16.6, 0.6, 4.6), P.circle("st-d:birdshit", -0.4, -16, 0.35), P.circle("st-d:birdshit", 0.5, -15.6, 0.3), P.circle("st-d:birdshit", -1, -12.6, 0.3)],
  scaffold: () => ({ zone: "back", k: [-6, -2, 2, 6].map(x => P.rect("st-x:pole", x, -20, 0.01, 20, { sw: 0.3 })).concat([-6, -12, -18].map(y => P.rect("st-f:wood", -6.5, y, 13, 0.5)), [P.line("st-x:pole", -6, -18, 6, -6, { sw: 0.25 })]) })
};
// Which of these show a token's kind: drawn as a prop only where no such token is in the panel.
CH.PROP_TOKEN = { barge: "barge", boats: "canoe" };

// A token's drawing in a street material instead of a cast colour (a burnt-out autopod, a jam).
const chAs = (pieces, mat) => pieces.map(p => { const m = /^ch-v:[^:]+(:([st]))?$/.exec(p.r); return m ? Object.assign({}, p, { r: `st-${m[2] || "f"}:${mat}` }) : p; });
// --- Street obstacles (p.420), side-on set pieces across a slot ---------------------------------------
const OBS = CH.OBSTACLES = {
  riot: (c) => {
    const k = [P.g(chAs(CH.TOKENS.autopod.draw({ colour: "black", riders: 0 }), "podburnt"), { tf: { x: 6, y: -5.8, rot: 180, s: 1.1 } })];
    k.push(...chSmoke(6, -9, 1.4), ...chFlame(6, -5.2, 7.5, 6.4));
    if (c.night) k.unshift(P.circle("ch-fx-glow", 6, -5, 9));
    return k.concat(chCrowd(c.rng, -10, 0.5, "st-f:crowd", { role2: "st-f:crowd2", signs: 0.3, arms: 0.4 }));
  },
  parade: (c) => [P.path("st-f:float", "M-8 -2 L-8 -7 Q-4 -10 0 -8 Q4 -10 8 -7 L8 -2 Z"), P.rect("st-d:pattern1", -6, -6, 4, 2), P.rect("st-d:pattern2", 1, -6.5, 4, 2), P.circle("st-d:dark", -5, -1, 1), P.circle("st-d:dark", 5, -1, 1),
    P.path("st-x:bunting", "M-11 -12 Q0 -9 11 -12", { sw: 0.5 })].concat(chCrowd(c.rng, -11, -8.5, "st-f:performer", {}), chCrowd(c.rng, 8.5, 11, "st-f:performer2", {})),
  performers: (c) => [chBox("wood", -4, -2, 8, 2), ...chPerson(-1.5, 6.6, "st-f:performer", { arm: true }), ...chPerson(1.6, 6.2, "st-f:performer2", { arm: true })].concat(chCrowd(c.rng, -10, -5, "st-f:crowd", {}), chCrowd(c.rng, 5, 10, "st-f:crowd", {})),
  protest: (c) => chCrowd(c.rng, -10, 10, "st-f:crowd", { role2: "st-f:crowd2", signs: 0.55, share: 0.2 }),
  evangelist: (c) => [chBox("wood", -1.6, -2.4, 3.2, 2.4), ...chPerson(0, 6.6, "st-f:suit", { arm: true }).map(p => Object.assign(p, { tf: { y: -2.4 } }))].concat(chCrowd(c.rng, -8, -3, "st-f:crowd", {}), chCrowd(c.rng, 4, 7, "st-f:crowd", {})),
  jam: () => [-11, 1].map((x, i) => P.g(chAs(CH.TOKENS.autopod.draw({ colour: "black", riders: 1 }), ["pod1", "pod2"][i]), { tf: { x: x + 5, s: 0.95 } }))
    .concat([P.g(chAs(CH.TOKENS.suv.draw({ colour: "black" }), "pod3"), { tf: { x: 13, s: 0.8 } })]),
  construction: () => [P.rect("st-f:hoarding", -10, -8, 12, 8), P.rect("st-d:poster", -8, -6.5, 3, 4), P.rect("st-d:poster2", -3.5, -6, 3, 3.5)]
    .concat([3, 7, 11].map(x => P.rect("st-x:pole", x, -18, 0.01, 18, { sw: 0.3 })), [-6, -12, -18].map(y => P.rect("st-f:wood", 2.5, y, 9, 0.5)), [chBox("barrier", -12, -3, 2, 3), P.rect("st-d:stripe", -12, -2.2, 2, 0.6)]),
  gangs: (c) => chCrowd(c.rng, -10, -2.5, "st-f:crowd", { arms: 0.6 }).concat(chCrowd(c.rng, 2.5, 10, "st-f:crowd2", { arms: 0.6 })),
  paranormal: () => [P.ellipse("ch-fx-anomaly", 0, -7, 8, 7), P.ellipse("ch-fx-anomaly2", 0, -7, 3.4, 4.4), P.path("st-g:debris", "M-6 0 L-3 -0.3 L-1 0 L2 -0.4 L5 0 Z"),
    chBox("rubblestone", -3, -12, 1.2, 1, { tf: { rot: 30 } }), chBox("rubblestone", 2.6, -10, 1, 0.8, { tf: { rot: -20 } }), chBox("wood", -0.4, -15, 2, 0.5, { tf: { rot: 50 } })],
  checkpoint: (c) => PRS.checkpoint(c).concat(chPerson(-4.2, 6.6, "st-f:bluecoat"), chPerson(-6.4, 6.4, "st-f:bluecoat", { arm: true })),
  flood: () => [P.rect("st-g:flood", -13, -0.9, 26, 1.1), P.path("st-g:ripple", "M-10 -0.7 q2 -0.4 4 0 M-2 -0.6 q2 -0.4 4 0 M6 -0.7 q2 -0.4 4 0", { sw: 0.2 })],
  quarantine: (c) => [P.path("st-f:tent", "M2 0 L2 -6 L6 -9 L10 -6 L10 0 Z"), P.line("st-x:tape", -11, -3.2, 12, -3.2, { sw: 0.4 }), chBox("barrier", -11.3, -3.6, 0.5, 3.6), chBox("barrier", 11.5, -3.6, 0.5, 3.6), chBox("hazard", -4, -7, 3, 3, { tf: { rot: 45, x: -1, y: -3 } })]
    .concat(chPerson(-6, 6.4, "st-f:white"), chPerson(-8.2, 6.6, "st-f:white", { arm: true }))
};

// --- Nearby buildings (p.430), as facades side-on ------------------------------------------------------
// w: the facade's width in feet (the slot's at most), st: storeys. The sign is the
// printed name without its article, where it fits at the type floor.
CH.STOREY = 5.0; CH.GROUND = 6.4;
CH.facade = function (c, nb, name, x0, w, base, signSize) {
  const k = [], st = nb ? nb.st : 2 + Math.floor(c.rng() * 2), mat = nb ? nb.mat : c.rng.pick(["brick", "render", "concrete", "nb1", "nb2"]), kind = nb ? nb.k : "plain";
  const h = CH.GROUND + (st - 1) * CH.STOREY + (kind === "office" ? 2 : 0), top = base - h, rng = c.rng;
  k.push(P.rect("st-f:" + mat, x0, top, w, h), P.rect("st-s:" + mat, x0 + w - 0.8, top, 0.8, h));
  // upper windows
  const win = (x, y, ww, hh) => P.rect(c.night && rng() < 0.45 ? "st-d:winlit" : "st-d:win", x, y, ww, hh);
  const cols = Math.max(1, Math.floor((w - 2) / (kind === "office" ? 3 : 4.4)));
  for (let s = 1; s < st; s++) {
    const y = base - CH.GROUND - s * CH.STOREY + 1.4;
    for (let i = 0; i < cols; i++) {
      const cw = (w - 2) / cols, x = x0 + 1 + i * cw;
      if (kind === "office") k.push(win(x + 0.2, y - 0.6, cw - 0.4, CH.STOREY - 1.6));
      else k.push(win(x + cw * 0.25, y, cw * 0.5, CH.STOREY - 2.6));
    }
  }
  // the ground floor
  const gf = base - CH.GROUND;
  if (kind === "shop" || kind === "diner" || kind === "pub" || kind === "plain") {
    k.push(P.rect(c.night ? "st-d:shoplit" : "st-d:shop", x0 + 1.2, gf + 2, w * 0.55, CH.GROUND - 2.6), P.rect("st-d:door", x0 + w * 0.68, gf + 1.6, 2.4, CH.GROUND - 1.6));
    if (nb && nb.awning) k.push(P.poly("st-f:awning", [[x0 + 0.6, gf + 1.2], [x0 + w * 0.62, gf + 1.2], [x0 + w * 0.62 + 1, gf + 2.6], [x0 - 0.4, gf + 2.6]]));
    if (nb && nb.grille) for (let x = x0 + 1.4; x < x0 + 1.2 + w * 0.55; x += 0.8) k.push(P.rect("st-d:grille", x, gf + 2, 0.14, CH.GROUND - 2.6));
    if (nb && nb.cross) k.push(P.rect("st-d:cross", x0 + w - 3.2, gf - 2.6, 0.8, 2.4), P.rect("st-d:cross", x0 + w - 3.6, gf - 2.2, 1.6, 0.8));
  } else if (kind === "garage" || kind === "warehouse" || kind === "boathouse" || kind === "substation") {
    k.push(P.rect("st-d:roller", x0 + 1.4, gf + 1, w - 3.4, CH.GROUND - 1));
    for (let y = gf + 1.8; y < base; y += 0.9) k.push(P.rect("st-d:grille", x0 + 1.4, y, w - 3.4, 0.12));
  } else if (kind === "bank" || kind === "civic" || kind === "temple" || kind === "mansion" || kind === "school") {
    for (let x = x0 + 1; x < x0 + w - 1.5; x += 3) k.push(P.rect("st-t:" + mat, x, gf + 0.6, 1, CH.GROUND - 0.6));
    k.push(P.rect("st-d:door", x0 + w / 2 - 1.3, gf + 1.6, 2.6, CH.GROUND - 1.6), P.poly("st-t:" + mat, [[x0 - 0.4, top], [x0 + w + 0.4, top], [x0 + w / 2, top - 3]]));
    if (nb && nb.bluelamp) k.push(P.rect("st-d:bluelamp", x0 + w / 2 - 0.5, gf - 1.4, 1, 1.2));
  } else if (kind === "venue" || kind === "cinema") {
    k.push(P.rect("st-f:marquee", x0 + 0.5, gf - 1.6, w - 1, 2.2), P.rect(c.night ? "st-d:shoplit" : "st-d:shop", x0 + 2, gf + 1.6, w - 4, CH.GROUND - 1.6));
    for (let x = x0 + 1; x < x0 + w - 0.8; x += 1.4) k.push(P.circle("st-d:signlit", x, gf - 1.9, 0.25));
  } else {
    k.push(P.rect("st-d:door", x0 + w / 2 - 1.3, gf + 1.6, 2.6, CH.GROUND - 1.6));
    for (let x = x0 + 1.4; x < x0 + w - 3; x += 4.6) if (Math.abs(x - (x0 + w / 2 - 1.3)) > 2.6) k.push(win(x, gf + 2, 2.2, 3));
  }
  if (kind === "substation") for (let x = x0; x < x0 + w; x += 0.9) k.push(P.rect("st-d:grille", x, base - 5, 0.12, 5));
  if (kind === "temple") k.push(P.poly("st-f:" + mat, [[x0 + w / 2 - 1.6, top - 3], [x0 + w / 2 + 1.6, top - 3], [x0 + w / 2, top - 11]]));
  // the sign, where the name fits
  if (name && signSize) {
    const tw = M.textW(name, signSize, "condensed", 0.05), sw = tw + signSize * 0.9, sh = signSize * 1.35;
    if (sw <= w - 0.8) {
      const sx = x0 + (w - sw) / 2, sy = kind === "venue" || kind === "cinema" ? gf - 1.6 - sh - 0.4 : gf - sh - 0.5;
      k.push(P.rect("ch-sign", sx, sy, sw, sh), P.text("ch-sign-text", sx + sw / 2, sy + sh / 2 + signSize * 0.36, name, { size: signSize, anchor: "middle" }));
      return { k, top, h, sign: { x0: sx, y0: sy, x1: sx + sw, y1: sy + sh } };
    }
  }
  return { k, top, h };
};

// ---- src/chase.js ----
// =============================================================================
// chase — the chase strip (B68Map.chase, chaseNew, chaseTick, chaseOptions)
// =============================================================================
//   B68Map.chase(chase, { layer, layout, theme, rolls, width, displayWidth })
//     → { svg, width, height, warnings, slots, drawn, viewBox }
//   B68Map.chaseNew({ name, district, time, weather, street | roll | scene, clocks, cast, seed, prelude })
//     → a chase ("b68-chase/1") with no panels
//   B68Map.chaseTick(chase, { clock, ticks, caption, roll, level, time, show, fx, between, gm })
//     → a new chase with one panel more (never mutates; .warnings says what was clamped)
//   B68Map.chaseOptions() → { tokens, states, fx, levels, grounds, layouts, themes, times, sides, colours }
//
// A chase runs on the crew's clocks. Every segment of a strip clock is one slot;
// a roll that fills k segments is one panel k slots wide, with one caption.
// Segments not yet filled are empty, numbered, dashed slots, so the table sees
// how far is left (a hidden clock's are left out of the player copy, count and
// all). A panel exists only once its segments tick: nothing is drawn ahead.
// Panels are the street cut open side-on (chaseparts.js), left to right like a
// comic page, wrapping into rows.

CH.SCHEMA = "b68-chase/1";
// Where the strip is shown: the file's size, the width it is shown at and the type floor there.
CH.LAYOUTS = {
  ipad: { width: 1366, height: 1024, displayWidth: 1366, floor: 16, describe: "The table's iPad (iPad Pro 12.9 at 1×, landscape): 1366 × 1024, type floor 16 px." },
  screen: { width: 1920, height: 1080, displayWidth: 1920, floor: 16, describe: "A laptop or TV: 16 : 9, type floor 16 px." },
  phone: { width: 1170, displayWidth: 390, floor: 10, stack: true, describe: "A phone, 390 px wide: one panel per row, as tall as it needs." },
  print: { width: 3508, height: 2480, displayWidth: 3508, floor: 29, describe: "A4 landscape at 300 dpi, type floor 7 pt (29 px)." }
};
CH.THEMES = ["rulebook", "blueprint", "casefile"];
CH.SIDES = ["crew", "against", "neutral"];
CH.DEFAULT_CAST = [{ id: "crew", token: "autopod", label: "The crew", side: "crew" }, { id: "pursuit", token: "watch-car", label: "Bluecoat autopod", side: "against" }];
CH.DEFAULT_CLOCKS = [{ id: "away", name: "Get away", size: 6, side: "crew", strip: true }];

const chClone = o => JSON.parse(JSON.stringify(o));
const chLC = s => String(s == null ? "" : s).toLowerCase().trim();
// A time the GM gives: Bluetime or Night, else a warning. A time a roll prints: Night if it says so, else Bluetime.
const chTime = (t, W, what) => {
  if (t == null || t === "") return null;
  const s = String(t).trim();
  if (/^night$/i.test(s)) return "Night";
  if (/^(bluetime|blue|day|daylight)$/i.test(s)) return "Bluetime";
  M.warn(W, `${what} "${s}" is not one of Bluetime, Night — drawing Bluetime`);
  return "Bluetime";
};
const chRolledTime = t => t ? (/night/i.test(t) ? "Night" : "Bluetime") : null;
const chWarned = (o, W) => { Object.defineProperty(o, "warnings", { value: W, enumerable: false, configurable: true, writable: true }); return o; };
const chSlug = s => chLC(s).replace(/^(the|a|an) /, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "x";

// --- The street, read -------------------------------------------------------------------------
// The printed tables first (streetparts.js), then the words. What neither knows is named in a warning.
CH.readStreet = function (st, W) {
  st = st || {};
  const typeKey = Object.keys(ST.GROUND).find(k => chLC(k) === chLC(st.type)) || null;
  let ground = st.ground ? chLC(st.ground).replace(/[\s_-]+/g, "") : null;
  if (ground && !M.own(CH.GROUNDS, ground)) { M.warn(W, `street ground "${st.ground}" is not one of ${Object.keys(CH.GROUNDS).join(", ")} — reading the street type`); ground = null; }
  const variant = typeKey ? M.own(ST.GROUND, typeKey).v : "";
  if (!ground && typeKey) ground = M.own(ST.GROUND, typeKey).g;
  if (!ground) {
    const words = [st.type, st.desc, st.named].filter(Boolean).join(" ");
    const hit = CH.GROUND_WORDS.find(([re]) => re.test(words));
    ground = hit ? hit[1] : "lane";
    if (!hit && (st.type || st.desc)) M.warn(W, `street "${st.type || st.desc}" names no printed street type and no ground — drawn as a lane`);
  }
  const prop = text => {
    const k = Object.keys(ST.PROP).find(p => chLC(p) === chLC(text));
    if (k) return { kind: "prop", text: k, d: M.own(ST.PROP, k).d };
    const w = CH.PROP_WORDS.find(([re]) => re.test(text));
    if (w) return { kind: "prop", text: String(text), d: w[1] };
    M.warn(W, `street prop "${text}" is not in the printed table and names nothing the kit draws — left off the street`);
    return null;
  };
  const near = text => {
    const k = Object.keys(ST.NEIGHBOUR).find(p => chLC(p) === chLC(text));
    if (!k) M.warn(W, `nearby building "${text}" is not in the printed table — drawn as a plain frontage with its name`);
    return { kind: "nearby", text: String(text), nb: k ? M.own(ST.NEIGHBOUR, k) : null, name: ST.cap(text).toUpperCase() };
  };
  const OBW = [[/quarantine|lockdown/i, "quarantine"], [/parade/i, "parade"], [/riot/i, "riot"], [/perform/i, "performers"], [/protest/i, "protest"], [/evangel|preach/i, "evangelist"],
    [/traffic|jam/i, "jam"], [/construct|demolition|roadworks/i, "construction"], [/gang/i, "gangs"], [/paranormal|anomal|ghost/i, "paranormal"], [/checkpoint|bluecoat/i, "checkpoint"], [/flood/i, "flood"]];
  let obstacle = null;
  if (st.obstacle) {
    const k = Object.keys(ST.OBSTACLE).find(p => chLC(p) === chLC(st.obstacle)), w = OBW.find(([re]) => re.test(st.obstacle));
    if (k) obstacle = { kind: "obstacle", text: k, d: M.own(ST.OBSTACLE, k).d };
    else if (w) obstacle = { kind: "obstacle", text: String(st.obstacle), d: w[1] };
    else M.warn(W, `street obstacle "${st.obstacle}" is not in the printed table — left off the street`);
  }
  const DW = [[/statue/i, "statue"], [/mural/i, "mural"], [/billboard/i, "billboards"], [/scaffold/i, "scaffold"], [/vendor|kiosk/i, "vendor"], [/screens?/i, "screens"], [/power pole|transformer/i, "poles"]];
  let desc = null;
  if (st.desc) {
    const k = Object.keys(ST.DESC).find(p => chLC(p) === chLC(st.desc)), w = DW.find(([re]) => re.test(st.desc));
    const d = k ? M.own(ST.DESC, k).k : w ? w[1] : null;
    if (d && M.own(CH.DESCS, d)) desc = { kind: "desc", text: String(st.desc), d };
  }
  const props = M.list(st.props, W, "street props", true).map(prop).filter(Boolean), nearby = M.list(st.nearby, W, "street nearby", true).slice(0, 2).map(near);
  // the street's handholds, in the order panels take them: a prop, next door, the obstacle, …
  const holds = [props[0], nearby[0], obstacle, props[1], desc, nearby[1], ...props.slice(2)].filter(Boolean);
  const water = ground === "bridge" || ground === "waterside" || ground === "quay" || props.some(p => ["boats", "barge", "gondolas", "lock"].includes(p.d)) || /canal|river|water/i.test(st.over || "");
  return { named: st.named || "", said: st.desc || "", type: st.type || "", typeKey, variant, ground, over: st.over || (ground === "bridge" ? "canal" : ""), landmark: st.landmark || "", holds, water };
};

// --- Normalising ---------------------------------------------------------------------------------
CH.normCast = function (c, i, W) {
  c = Object.assign({}, c);
  if (!c.token || !M.own(CH.TOKENS, c.token)) { M.warn(W, `cast "${c.label || c.id || i}": token "${c.token}" is not one of ${Object.keys(CH.TOKENS).join(", ")} — drawn as an autopod`); c.token = "autopod"; }
  c.label = c.label || c.token;
  c.id = c.id != null && c.id !== "" ? String(c.id) : chSlug(c.label) + (i ? "-" + i : "");
  if (!CH.SIDES.includes(c.side)) { if (c.side != null) M.warn(W, `cast "${c.label}": side "${c.side}" is not one of crew, against, neutral — neutral`); c.side = c.side == null ? "crew" : "neutral"; }
  if (c.colour != null && !M.own(CH.COLOURS, chLC(c.colour)) && !/^#[0-9a-f]{6}$/i.test(c.colour)) { M.warn(W, `cast "${c.label}": colour "${c.colour}" is not one of ${Object.keys(CH.COLOURS).join(", ")} — the token's own`); delete c.colour; }
  if (c.level != null && !CH.LEVELS.includes(c.level)) { M.warn(W, `cast "${c.label}": level "${c.level}" is not one of ${CH.LEVELS.join(", ")}`); delete c.level; }
  return c;
};
CH.normClock = function (k, i, W) {
  k = Object.assign({}, k);
  k.id = k.id != null && k.id !== "" ? String(k.id) : "clock" + (i + 1);
  k.name = k.name || "Clock";
  let size = Math.round(+k.size);
  if (!(size >= 1 && size <= 12)) { M.warn(W, `clock "${k.name}": size ${JSON.stringify(k.size)} is not 1 to 12 — ${size > 12 ? 12 : 6}`); size = size > 12 ? 12 : 6; }
  k.size = size;
  if (k.side !== "crew" && k.side !== "against") { if (k.side != null) M.warn(W, `clock "${k.name}": side "${k.side}" is not crew or against — crew`); k.side = "crew"; }
  if (k.strip == null) k.strip = k.side === "crew";
  k.strip = !!k.strip; k.hidden = !!k.hidden;
  if (!k.strip) k.filled = Math.max(0, Math.min(size, Math.round(+k.filled || 0)));
  return k;
};

// --- chaseNew --------------------------------------------------------------------------------------
M.chaseNew = function (o = {}) {
  const W = [];
  o = o || {};
  const roll = o.roll && typeof o.roll === "object" ? o.roll : null, scene = o.scene && typeof o.scene === "object" ? o.scene : null;
  let street = {};
  // a location roll: its printed street fields and nothing else (no watcher, no ways in, no target)
  if (roll) street = { named: roll.namedStreet || "", type: roll.streetType || "", desc: roll.streetDesc || "", props: M.list(roll.props, null, "props", true).slice(), nearby: M.list(roll.neighbours, null, "neighbours", true).slice(0, 2), obstacle: roll.streetObstacle || null, landmark: roll.landmark || null };
  else if (scene) street = { named: scene.street || "", type: scene.streetType || "", props: [], nearby: scene.neighbour ? [scene.neighbour] : [], obstacle: scene.obstacle || null, landmark: scene.landmark || null };
  if (typeof o.street === "string") street.desc = o.street;
  else if (o.street && typeof o.street === "object") street = Object.assign(street, chClone(o.street));
  const read = CH.readStreet(street, W);
  street.ground = read.ground;
  if (read.ground === "bridge" && !street.over) street.over = "canal";
  street.props = M.list(street.props, null, "", true); street.nearby = M.list(street.nearby, null, "", true);
  const district = o.district || (roll && roll.district) || (scene && scene.d && scene.d.n) || "";
  const time = chTime(o.time, W, "time") || chRolledTime((roll && roll.timeOfDay) || (scene && scene.timeOfDay)) || "Bluetime";
  const weather = o.weather || (roll && roll.weather) || (scene && scene.weather) || "";
  const name = o.name || (street.named ? `${street.named} chase` : "The chase");
  const seed = (o.seed != null && isFinite(+o.seed) ? +o.seed : roll && roll.seed != null ? +roll.seed : M.hash(name + district)) >>> 0;
  const cast = (Array.isArray(o.cast) && o.cast.length ? o.cast : CH.DEFAULT_CAST).map((c, i) => CH.normCast(c, i, W));
  const clocks = (Array.isArray(o.clocks) && o.clocks.length ? o.clocks : CH.DEFAULT_CLOCKS).map((k, i) => CH.normClock(k, i, W));
  const chase = { schema: CH.SCHEMA, id: o.id || "chase-" + M.hash(name + "|" + district + "|" + seed).toString(36), name };
  if (o.session) chase.session = String(o.session);
  Object.assign(chase, { district, seed, time, weather });
  if (o.site || (roll && roll.name)) chase.site = o.site || roll.name;
  Object.assign(chase, { street, cast, clocks });
  if (Array.isArray(o.prelude) && o.prelude.length) chase.prelude = o.prelude.map(String);
  chase.panels = [];
  return chWarned(chase, W);
};

// --- chaseTick --------------------------------------------------------------------------------------
// [interpretation] With no `show`, the kit puts the crew's lead and the nearest pursuer in the
// panel (seeded by the chase's seed and the panel's number), and reads a few plain words in the
// caption for how they are: "jumps", "two wheels", "spins", "rams", "crashes", "shoots", "burning",
// "grenade", "NOS", "fog", "searchlight". What it chose is written into the panel (and `auto: true`).
CH.CUES = [
  [/\b(jumps?|jumped|leaps?|leapt|airborne|launch(es|ed)?|flies|flew)\b/i, { lead: "airborne", level: "air" }],
  [/\btwo wheels\b/i, { lead: "two-wheels" }],
  [/\b(spins?|spun|handbrake)\b/i, { lead: "spin" }],
  [/\b(rams?|rammed|swerves? into|sideswipes?|shunts?)\b/i, { chaser: "rammed", fx: "impact" }],
  [/\b(crash(es|ed)?|wrecks?|wrecked|flips?|flipped|rolls over)\b/i, { chaser: "wrecked", fx: "impact" }],
  [/\b(shoots?|shot|shooting|fires at|guns?|opens fire)\b/i, { fx: "muzzle" }],
  [/\b(burns?|burning|ablaze|in flames)\b/i, { chaser: "burning" }],
  [/\b(grenades?|explodes?|explosion)\b/i, { fx: "grenade" }],
  [/\b(nos|nitro)\b/i, { fx: "nos" }],
  [/\bfog\b/i, { fx: "fog" }],
  [/\b(searchlights?|floodlights?)\b/i, { fx: "searchlight" }]
];
CH.autoShow = function (chase, idx, level, caption) {
  const rng = M.rng(((chase.seed >>> 0) + idx * 7919) >>> 0), cast = chase.cast || [];
  const out = { show: [], fx: [] };
  const done = new Set();
  for (const p of chase.panels || []) for (const s of p.show || []) if (/^(wrecked|down)$/.test(s.state || "")) done.add(s.id);
  const lvlOf = c => c.level || "street";
  const want = level === "below" ? "below" : null;
  const crew = cast.filter(c => c.side === "crew" && !done.has(c.id));
  const lead = (want && crew.find(c => lvlOf(c) === want)) || crew.find(c => lvlOf(c) !== "below") || crew[0];
  // the nearest pursuer: the one furthest forward last time, else the first still running
  const prev = (chase.panels || []).slice().reverse().find(p => (p.show || []).some(s => cast.some(c => c.id === s.id && c.side === "against")));
  const against = cast.filter(c => c.side === "against" && !done.has(c.id));
  let chaser = null;
  if (prev) { const seen = prev.show.filter(s => against.some(c => c.id === s.id)).sort((a, b) => (b.x || 0) - (a.x || 0)); if (seen[0]) chaser = against.find(c => c.id === seen[0].id); }
  chaser = chaser || against[0] || null;
  const cue = {};
  for (const [re, c] of CH.CUES) if (re.test(caption || "")) { for (const k of ["lead", "level", "chaser"]) if (c[k] && !cue[k]) cue[k] = c[k]; if (c.fx && !out.fx.includes(c.fx)) out.fx.push(c.fx); }
  if (lead) { const s = { id: lead.id, x: +(0.56 + rng() * 0.16).toFixed(2) }; if (cue.lead) s.state = cue.lead; if (cue.level) s.level = cue.level; else if (lvlOf(lead) !== level && level !== "below") s.level = level; out.show.push(s); }
  if (chaser) { const s = { id: chaser.id, x: +(0.14 + rng() * 0.16).toFixed(2), state: cue.chaser || "chasing" }; if (lvlOf(chaser) !== level && !(level === "below" && lvlOf(chaser) === "street")) s.level = lvlOf(chaser) === "below" ? "below" : level; out.show.push(s); }
  return out;
};
M.chaseTick = function (chase, t = {}) {
  const W = [];
  const c = chClone(chase || {});
  c.panels = c.panels || [];
  t = t || {};
  // ticks: 0 notes beats now (flashbacks, fails): SINCE THE LAST PANEL until the next panel takes them
  if (+t.ticks === 0 && t.ticks !== null && t.ticks !== "") { const pb = (c.pending || []).concat(Array.isArray(t.between) ? t.between.map(String) : t.between ? [String(t.between)] : []); if (pb.length) c.pending = pb; return chWarned(c, W); }
  const clocks = c.clocks || [];
  const used = id => c.panels.reduce((s, p) => s + (p.clock === id ? Math.round(+p.ticks) || 1 : 0) + (p.oppose && p.oppose.clock === id ? Math.round(+p.oppose.ticks) || 1 : 0), 0);
  let clock = t.clock != null ? clocks.find(k => k.id === t.clock || k.name === t.clock) : clocks.find(k => k.strip && used(k.id) < k.size) || clocks.find(k => k.strip);
  if (!clock) { M.warn(W, t.clock != null ? `clock "${t.clock}" is not one of this chase's (${clocks.map(k => k.id).join(", ")}) — nothing ticked` : "no clock to tick: every strip clock is full"); return chWarned(c, W); }
  let ticks = Math.round(+t.ticks); if (!(ticks >= 1)) { if (t.ticks != null) M.warn(W, `ticks ${JSON.stringify(t.ticks)} is not a whole number from 1 — 1`); ticks = 1; }
  const pend = (c.pending || []).concat(Array.isArray(t.between) ? t.between.map(String) : t.between ? [String(t.between)] : []);
  if (!clock.strip) {
    // a clock off the strip (the law, a hidden one): its count moves, no panel; its words stay GM-only
    const before = Math.round(+clock.filled || 0), size = Math.round(+clock.size) || 6;
    if (before + ticks > size) M.warn(W, `clock "${clock.name}" has ${size - before} segment${size - before === 1 ? "" : "s"} left — ticked ${Math.max(0, size - before)}, not ${ticks}`);
    clock.filled = Math.min(size, before + ticks);
    if (t.caption) clock.history = [clock.history, String(t.caption)].filter(Boolean).join("; ");
    if (pend.length) c.pending = pend;
    return chWarned(c, W);
  }
  const left = clock.size - used(clock.id);
  if (left <= 0) { M.warn(W, `clock "${clock.name}" is full — no panel added`); return chWarned(c, W); }
  if (ticks > left) { M.warn(W, `clock "${clock.name}" has ${left} segment${left === 1 ? "" : "s"} left — ticked ${left}, not ${ticks}`); ticks = left; }
  let level = t.level || "street";
  if (!CH.LEVELS.includes(level)) { M.warn(W, `level "${level}" is not one of ${CH.LEVELS.join(", ")} — street`); level = "street"; }
  const panel = { clock: clock.id, ticks, level };
  const time = chTime(t.time, W, "time"); if (time) panel.time = time;
  // the chase turns into another street from this panel on (a sentence, or a street object)
  if (t.street) {
    const st = typeof t.street === "string" ? { desc: t.street } : chClone(t.street);
    const read = CH.readStreet(st, W);
    st.ground = read.ground; if (read.ground === "bridge" && !st.over) st.over = "canal";
    st.props = M.list(st.props, null, "", true); st.nearby = M.list(st.nearby, null, "", true);
    panel.street = st;
  }
  panel.caption = t.caption != null ? String(t.caption) : "";
  if (t.roll) panel.roll = String(t.roll);
  if (pend.length) panel.between = pend;
  delete c.pending;
  if (Array.isArray(t.show)) { panel.show = chClone(t.show); if (t.fx) panel.fx = chClone(t.fx); }
  else {
    const a = CH.autoShow(c, c.panels.length, level, panel.caption);
    panel.show = a.show;
    const fx = (t.fx ? chClone(t.fx) : []).concat(a.fx.filter(f => !(t.fx || []).includes(f)));
    if (fx.length) panel.fx = fx;
    panel.auto = true;
  }
  if (t.gm) panel.gm = String(t.gm);
  // the same roll's consequence on an opposing clock (BitD p.16): ticked in this panel too
  if (t.oppose && t.oppose.clock != null) {
    const k = clocks.find(q => q.id === t.oppose.clock || q.name === t.oppose.clock);
    let n = Math.round(+t.oppose.ticks); if (!(n >= 1)) n = 1;
    if (!k) M.warn(W, `oppose: clock "${t.oppose.clock}" is not one of this chase's — not ticked`);
    else {
      const left = k.size - (k.strip ? used(k.id) : Math.round(+k.filled || 0));
      if (n > left) { M.warn(W, `clock "${k.name}" has ${Math.max(0, left)} segment${left === 1 ? "" : "s"} left — ticked ${Math.max(0, left)}, not ${n}`); n = Math.max(0, left); }
      if (n) { panel.oppose = { clock: k.id, ticks: n }; if (!k.strip) k.filled = Math.round(+k.filled || 0) + n; }
    }
  }
  c.panels.push(panel);
  return chWarned(c, W);
};

M.chaseOptions = () => ({ tokens: Object.keys(CH.TOKENS), states: Object.keys(CH.STATES), fx: Object.keys(CH.FX), levels: CH.LEVELS.slice(), grounds: Object.keys(CH.GROUNDS),
  layouts: Object.keys(CH.LAYOUTS), themes: CH.THEMES.slice(), times: ["Bluetime", "Night"], sides: CH.SIDES.slice(), colours: Object.keys(CH.COLOURS) });

// --- Reading a chase for drawing --------------------------------------------------------------------
CH.read = function (chase, W, player) {
  if (!chase || typeof chase !== "object") throw new Error("B68Map.chase: give it a chase object (B68Map.chaseNew makes one)");
  if (chase.schema && chase.schema !== CH.SCHEMA) M.warn(W, `schema "${chase.schema}" is not ${CH.SCHEMA} — drawing it as one`);
  const time = chTime(chase.time, W, "chase time") || "Bluetime";
  const street = CH.readStreet(chase.street || {}, W);
  const cast = (chase.cast || []).map((c, i) => CH.normCast(c, i, W));
  const castOf = new Map(cast.map(c => [c.id, c]));
  const clocks = (chase.clocks || []).map((k, i) => CH.normClock(k, i, W));
  const clockOf = new Map(clocks.map(k => [k.id, k]));
  const used = new Map(clocks.map(k => [k.id, 0]));
  let slot = 0, prevTime = time, cur = street, curSlot0 = 0;
  const streets = [street];
  const panels = (chase.panels || []).map((p, i) => {
    p = p || {};
    let clock = clockOf.get(p.clock);
    if (!clock) { M.warn(W, `panel ${i + 1}: clock "${p.clock}" is not one of this chase's (${clocks.map(k => k.id).join(", ") || "none"}) — drawn without one`); }
    else if (!clock.strip) M.warn(W, `panel ${i + 1}: clock "${clock.name}" is not a strip clock — drawn on the strip anyway`);
    let k = Math.round(+p.ticks); if (!(k >= 1)) { M.warn(W, `panel ${i + 1}: ticks ${JSON.stringify(p.ticks)} is not a whole number from 1 — 1`); k = 1; }
    const from = clock ? used.get(clock.id) + 1 : 0;
    if (clock) { used.set(clock.id, used.get(clock.id) + k); if (used.get(clock.id) > clock.size) M.warn(W, `panel ${i + 1}: clock "${clock.name}" is ticked past its ${clock.size} segments`); }
    let level = p.level || "street";
    if (!CH.LEVELS.includes(level)) { M.warn(W, `panel ${i + 1}: level "${level}" is not one of ${CH.LEVELS.join(", ")} — street`); level = "street"; }
    const ptime = chTime(p.time, W, `panel ${i + 1}: time`) || time;
    // a panel's own street: the chase is on it from here on, its handholds dealt from its first
    let turned = false;
    if (p.street && typeof p.street === "object") { const PW = []; cur = CH.readStreet(p.street, PW); PW.forEach(m => M.warn(W, `panel ${i + 1}: ${m}`)); curSlot0 = slot; turned = true; streets.push(cur); }
    const show = (Array.isArray(p.show) ? p.show : []).map(s => {
      const c = castOf.get(s && s.id);
      if (!c) { M.warn(W, `panel ${i + 1}: "${s && s.id}" is not in the cast — left out`); return null; }
      const o = { cast: c, x: Math.max(-0.2, Math.min(1.2, isFinite(+s.x) ? +s.x : 0.5)), level: s.level || c.level || level, state: s.state || null, on: s.on || null, face: s.face === "left" ? -1 : 1 };
      if (!CH.LEVELS.includes(o.level) && o.level !== "air") { M.warn(W, `panel ${i + 1}: "${c.label}" level "${o.level}" is not one of ${CH.LEVELS.join(", ")}, air — ${level}`); o.level = level; }
      if (o.state && !M.own(CH.STATES, o.state)) { M.warn(W, `panel ${i + 1}: state "${o.state}" is not one of ${Object.keys(CH.STATES).join(", ")} — drawn plain`); o.state = null; }
      if (o.state === "half" && c.token !== "autopod") { M.warn(W, `panel ${i + 1}: "half" is for the autopod — "${c.label}" drawn whole`); o.state = null; }
      return o;
    }).filter(Boolean);
    const fx = [];
    for (const f of Array.isArray(p.fx) ? p.fx : []) {
      const name = f && typeof f === "object" ? f.name : f;
      if (!M.own(CH.FX, name)) { M.warn(W, `panel ${i + 1}: fx "${name}" is not one of ${Object.keys(CH.FX).join(", ")} — left out`); continue; }
      fx.push(f && typeof f === "object" ? Object.assign({}, f) : { name });
    }
    let oppose = null;
    if (p.oppose && p.oppose.clock != null) {
      const ok = clockOf.get(p.oppose.clock), n = Math.max(1, Math.round(+p.oppose.ticks) || 1);
      if (!ok) M.warn(W, `panel ${i + 1}: oppose clock "${p.oppose.clock}" is not one of this chase's`);
      else { oppose = { clock: ok, ticks: n }; if (ok.strip) used.set(ok.id, used.get(ok.id) + n); }
    }
    const out = { i, clock, k, from, to: from + k - 1, oppose, level, time: ptime, snap: ptime !== prevTime, caption: p.caption ? String(p.caption) : "", roll: p.roll ? String(p.roll) : "",
      between: (Array.isArray(p.between) ? p.between : p.between ? [p.between] : []).map(String), gm: p.gm ? String(p.gm) : "", show, fx, slot0: slot,
      street: cur, hold0: slot - curSlot0, turned };
    out.ends = !!clock && out.to >= clock.size;
    // racing clocks that fill together: the crew escape, but the pursuers are outside the lair (BitD p.16)
    out.tie = out.ends && clock.side === "crew" && !!oppose && oppose.clock.side === "against" && (oppose.clock.strip ? used.get(oppose.clock.id) >= oppose.clock.size : oppose.clock.filled >= oppose.clock.size);
    slot += k; prevTime = ptime;
    return out;
  });
  // who is drawn: only cast members a panel shows (a player copy names no one else)
  const shown = cast.filter(c => panels.some(p => p.show.some(s => s.cast === c)));
  return { name: chase.name || "The chase", id: chase.id || "", session: chase.session || "", district: chase.district || "", time, weather: chase.weather || "", site: chase.site || "",
    street, streets, cast, shown, clocks, used, panels, prelude: (chase.prelude || []).map(String), pending: (chase.pending || []).map(String), seed: (+chase.seed || M.hash(chase.name || "")) >>> 0 };
};

// --- Paint -------------------------------------------------------------------------------------------
// The chase's own roles (ch-*); street roles (st-*) go to the street's palettes, so a panel's
// brick is the street view's brick. One painter per theme and time.
CH.painter = function (theme, id, night) {
  const fake = { model: { colour: "grey and charcoal" }, street: { night }, _id: id };
  const BG = "#1e4d8f", WH = "#f4f6fb", RED = "#ff6a4d", YEL = "#ffd65a";
  const blue = theme === "blueprint";
  const SPAL = blue ? M.streetPalette.blue(fake, BG, WH, RED, YEL) : M.streetPalette.flat(fake);
  const ink = TOK.ink900, pap = TOK.paper000;
  const dimN = (c, t) => night ? mix(c, NIGHT, t) : c;
  const colour = name => M.own(CH.COLOURS, name) || (/^#[0-9a-f]{6}$/i.test(name) ? name : "#8e9497");
  const flat = (role, p) => {
    if (role.startsWith("ch-v:")) {
      const [, nm, f] = role.split(":"), c = colour(nm);
      const v = f === "s" ? mix(c, ink, 0.32) : f === "t" ? mix(c, pap, 0.22) : c;
      return { fill: night ? mix(v, NIGHT, 0.14) : v };
    }
    switch (role) {
      case "ch-sky": return { fill: night ? NIGHT : mix(TOK.file300, pap, 0.6) };
      case "ch-far": return { fill: night ? "#2a2c3e" : mix(mix(TOK.file300, pap, 0.6), TOK.ink500, 0.22) };
      case "ch-far2": return { fill: night ? "#33354a" : mix(mix(TOK.file300, pap, 0.6), TOK.ink500, 0.38) };
      case "ch-far-lit": return night ? { fill: "#f3c766", opacity: 0.8 } : null;
      case "ch-earth": return { fill: dimN(mix(TOK.rust900, TOK.paper200, 0.55), 0.45) };
      case "ch-earth2": return { fill: dimN(mix(TOK.rust900, TOK.paper200, 0.4), 0.45) };
      case "ch-slab": return { fill: dimN(TOK.ink700, 0.2) };
      case "ch-tunnel": return { fill: night ? "#15161f" : mix(TOK.ink900, TOK.slate700, 0.45) };
      case "ch-rib": return { fill: night ? "#262734" : mix(TOK.ink700, TOK.rust700, 0.3) };
      case "ch-underpass": return { fill: dimN(mix(TOK.paper300, TOK.slate500, 0.25), 0.55) };
      case "ch-tile": return { fill: dimN(TOK.paper200, 0.55) };
      case "ch-water": return { fill: dimN(mix(TOK.slate500, TOK.file500, 0.35), 0.5) };
      case "ch-sewer": return { fill: night ? "#1f2a2c" : mix(TOK.slate700, TOK.covert700, 0.35) };
      case "ch-water-front": return { fill: night ? "#18222a" : mix(TOK.slate500, TOK.file500, 0.35), opacity: 0.62 };
      case "ch-ripple": return { fill: night ? "#4d6a78" : mix(TOK.slate500, pap, 0.5), opacity: 0.7 };
      case "ch-cone": return night ? { fill: "#f6dc8a", opacity: 0.13 } : null;
      case "ch-pool": return night ? { fill: "#f0c55a", opacity: 0.3 } : null;
      case "ch-shadow": return night ? null : { fill: ink, opacity: 0.2 };
      case "ch-shade": return night ? { fill: "#000", opacity: 0.18 } : { fill: ink, opacity: 0.13 };
      case "ch-sign": return { fill: dimN(TOK.ink900, 0.1) };
      case "ch-sign-text": return { fill: night ? "#f6dc8a" : pap, "font-family": FONT.condensed, "font-weight": 900, "letter-spacing": 0.05 };
      case "ch-trim": return { fill: dimN(pap, 0.3) };
      case "ch-dark": return { fill: ink };
      case "ch-glass": return { fill: night ? "#3a4a6a" : mix(TOK.file300, pap, 0.35) };
      case "ch-win": return { fill: night ? "#10111a" : mix(TOK.ink700, TOK.file700, 0.2) };
      case "ch-winlit": return { fill: night ? "#f3c766" : mix(TOK.ink700, TOK.file700, 0.2) };
      case "ch-rider": return { fill: ink };
      case "ch-head": return { fill: night ? "#fff4c8" : pap };
      case "ch-tail": return { fill: TOK.alarm500 };
      case "ch-wheel": return { fill: ink };
      case "ch-hub": return { fill: TOK.ink500 };
      case "ch-hazard": return { fill: TOK.caution500 };
      case "ch-amber": return { fill: night ? "#ffb347" : TOK.caution700 };
      case "ch-stripe": case "ch-cross": return { fill: TOK.alarm500 };
      case "ch-siren": return { fill: night ? "#7fb2ff" : TOK.file500 };
      case "ch-siren-red": return { fill: TOK.alarm500 };
      case "ch-trash": return { fill: dimN(mix(TOK.ink700, TOK.rust700, 0.3), 0.2) };
      case "ch-trash2": return { fill: dimN(TOK.ink500, 0.2) };
      case "ch-trash3": return { fill: dimN(TOK.covert700, 0.2) };
      case "ch-paddle": return { stroke: dimN("#94683f", 0.2), fill: "none" };
      case "ch-paddle-blade": return { fill: dimN("#94683f", 0.2) };
      case "ch-case": return { fill: TOK.rust700 };
      case "ch-case-handle": return { fill: "none", stroke: TOK.rust700, "stroke-width": 0.22 };
      case "ch-fx-flash": return { fill: TOK.caution500 };
      case "ch-fx-flash2": return { fill: pap };
      case "ch-fx-flame": return { fill: TOK.signal500 };
      case "ch-fx-flamecore": return { fill: TOK.caution500 };
      case "ch-fx-smoke": return { fill: night ? "#5a5866" : TOK.ink500, opacity: 0.42 };
      case "ch-fx-spark": return { fill: TOK.caution500 };
      case "ch-fx-nos": return { fill: "#5fb7ff", opacity: 0.85 };
      case "ch-fx-nos2": return { fill: "#e8f6ff" };
      case "ch-fx-beam": return { fill: "#fff6d8", opacity: night ? 0.26 : 0.16 };
      case "ch-fx-lamp": return { fill: night ? "#fff6d8" : TOK.ink700 };
      case "ch-fx-fog": return { fill: night ? "#c8cbd6" : pap, opacity: night ? 0.22 : 0.4 };
      case "ch-fx-glow": return { fill: TOK.signal500, opacity: night ? 0.22 : 0.12 };
      case "ch-fx-glowwater": return { fill: "#3fe0c8", opacity: 0.5 };
      case "ch-fx-glowline": return { fill: "#bafff2", opacity: 0.85 };
      case "ch-fx-darkwater": return { fill: "#0b0d0d", opacity: 0.6 };
      case "ch-fx-anomaly": return { fill: TOK.swing500, opacity: 0.4 };
      case "ch-fx-anomaly2": return { fill: pap, opacity: 0.75 };
      case "ch-fx-speed": return { fill: night ? "#d8dae6" : ink, opacity: night ? 0.5 : 0.42 };
      case "ch-fx-fruit1": return { fill: TOK.alarm500 };
      case "ch-fx-fruit2": return { fill: TOK.caution500 };
      case "ch-fx-fruit3": return { fill: TOK.covert500 };
      case "ch-fx-trace": return { fill: "none", stroke: TOK.caution500, "stroke-dasharray": "1.2 0.9", "stroke-linecap": "round" };
      case "ch-fx-fall": return { fill: "none", stroke: night ? "#d8dae6" : ink, "stroke-dasharray": "0.8 0.8", "stroke-linecap": "round", opacity: 0.6 };
      case "ch-fx-skid": return { fill: ink, opacity: night ? 0.5 : 0.3 };
      case "ch-fx-arc": return { fill: "none", stroke: night ? "#d8dae6" : ink, opacity: 0.5, "stroke-linecap": "round" };
      case "ch-rain": return { stroke: night ? "#9aa3c0" : TOK.slate700, opacity: 0.45 };
      case "ch-snow": return { fill: pap, opacity: night ? 0.85 : 0.9 };
      case "ch-fog-veil": return { fill: night ? "#c8cbd6" : pap, opacity: night ? 0.16 : 0.26 };
      case "ch-fog-band": return { fill: night ? "#c8cbd6" : pap, opacity: night ? 0.2 : 0.3 };
      case "ch-glow-blue": return night ? { fill: "#7fb2ff", opacity: 0.3 } : null;
      case "ch-fx-debris": return { fill: dimN(TOK.ink700, 0.1) };
      case "ch-badge-crew": return { fill: TOK.file500, stroke: pap, "stroke-width": p.sw || 0.3 };
      case "ch-badge-against": return { fill: TOK.alarm700, stroke: pap, "stroke-width": p.sw || 0.3 };
      case "ch-badge-neutral": return { fill: TOK.ink500, stroke: pap, "stroke-width": p.sw || 0.3 };
      case "ch-badge-text": return { fill: pap, "font-family": FONT.condensed, "font-weight": 900 };
      case "ch-badge-pole": return { stroke: night ? "#d8dae6" : ink, opacity: 0.7 };
    }
    return undefined;
  };
  const bp = (role, p) => {
    const line = (o) => Object.assign({ stroke: WH, "stroke-width": 0.14, "stroke-opacity": 0.9, "stroke-linejoin": "round" }, o);
    if (role.startsWith("ch-v:")) return line({ fill: role.endsWith(":s") ? "#23528f" : BG });
    switch (role) {
      case "ch-sky": return { fill: BG };
      case "ch-far": case "ch-far2": return line({ fill: BG, "stroke-opacity": 0.35, "stroke-width": 0.1 });
      case "ch-far-lit": return night ? { fill: YEL, opacity: 0.5 } : null;
      case "ch-earth": case "ch-earth2": return { fill: `url(#${id}-hatch)`, opacity: 0.55 };
      case "ch-slab": return line({ fill: "#23528f" });
      case "ch-tunnel": case "ch-underpass": return line({ fill: BG, "stroke-opacity": 0.5 });
      case "ch-rib": case "ch-tile": return { fill: WH, opacity: 0.12 };
      case "ch-water": case "ch-sewer": return { fill: `url(#${id}-hatch)`, opacity: 0.7 };
      case "ch-water-front": return { fill: BG, opacity: 0.45 };
      case "ch-ripple": return { fill: WH, opacity: 0.4 };
      case "ch-cone": return night ? { fill: YEL, opacity: 0.08 } : null;
      case "ch-pool": return night ? { fill: YEL, opacity: 0.18 } : null;
      case "ch-shadow": case "ch-shade": return null;
      case "ch-sign": return line({ fill: BG });
      case "ch-sign-text": return { fill: WH, "font-family": FONT.mono, "font-weight": 700 };
      case "ch-trim": case "ch-dark": case "ch-hub": case "ch-paddle-blade": case "ch-trash2": case "ch-trash3": return { fill: WH, opacity: 0.5 };
      case "ch-glass": case "ch-win": return line({ fill: WH, "fill-opacity": 0.12, "stroke-width": 0.08 });
      case "ch-winlit": return night ? { fill: YEL, "fill-opacity": 0.55 } : line({ fill: "none", "stroke-width": 0.08 });
      case "ch-rider": case "ch-wheel": return { fill: WH, opacity: 0.85 };
      case "ch-head": case "ch-amber": case "ch-hazard": return { fill: YEL };
      case "ch-tail": case "ch-stripe": case "ch-cross": case "ch-siren-red": case "ch-case": return { fill: RED };
      case "ch-siren": return { fill: YEL, opacity: 0.85 };
      case "ch-trash": return line({ fill: BG });
      case "ch-paddle": case "ch-case-handle": return { stroke: WH, fill: "none" };
      case "ch-fx-flash": case "ch-fx-flame": case "ch-fx-spark": return { fill: RED, opacity: 0.85 };
      case "ch-fx-flash2": case "ch-fx-flamecore": return { fill: YEL };
      case "ch-fx-smoke": case "ch-fx-fog": return { fill: WH, opacity: 0.16 };
      case "ch-fx-nos": return { fill: YEL, opacity: 0.6 };
      case "ch-fx-nos2": return { fill: WH };
      case "ch-fx-beam": return { fill: YEL, opacity: 0.12 };
      case "ch-fx-lamp": return { fill: YEL };
      case "ch-fx-glow": return { fill: RED, opacity: 0.12 };
      case "ch-fx-glowwater": return { fill: YEL, opacity: 0.22 };
      case "ch-fx-glowline": return { fill: YEL, opacity: 0.8 };
      case "ch-fx-darkwater": return { fill: "#0c2347", opacity: 0.55 };
      case "ch-fx-anomaly": return { fill: RED, opacity: 0.25 };
      case "ch-fx-anomaly2": return { fill: WH, opacity: 0.6 };
      case "ch-fx-speed": case "ch-fx-skid": case "ch-fx-debris": return { fill: WH, opacity: 0.5 };
      case "ch-fx-arc": case "ch-rain": return { fill: "none", stroke: WH, opacity: 0.45 };
      case "ch-glow-blue": return night ? { fill: YEL, opacity: 0.18 } : null;
      case "ch-fx-fruit1": case "ch-fx-fruit2": case "ch-fx-fruit3": return { fill: role.endsWith("1") ? RED : role.endsWith("2") ? YEL : WH };
      case "ch-fx-trace": return { fill: "none", stroke: YEL, "stroke-dasharray": "1.2 0.9" };
      case "ch-fx-fall": return { fill: "none", stroke: WH, "stroke-dasharray": "0.8 0.8", opacity: 0.6 };
      case "ch-badge-crew": return { fill: WH, stroke: BG, "stroke-width": p.sw || 0.3 };
      case "ch-badge-against": return { fill: RED, stroke: BG, "stroke-width": p.sw || 0.3 };
      case "ch-badge-neutral": return { fill: BG, stroke: WH, "stroke-width": p.sw || 0.3 };
      case "ch-badge-text": return { fill: BG, "font-family": FONT.mono, "font-weight": 700 };
      case "ch-badge-pole": return { stroke: WH, opacity: 0.7 };
      case "ch-snow": return { fill: WH, opacity: 0.7 };
      case "ch-fog-veil": return { fill: WH, opacity: 0.07 };
      case "ch-fog-band": return { fill: WH, opacity: 0.1 };
    }
    return undefined;
  };
  const paint = wrapPaint((role, p, mode) => {
    if (role.startsWith("st-")) { const sp = M.street.paint(SPAL, role, p); return sp === undefined ? null : sp; }
    const a = blue ? bp(role, p) : flat(role, p);
    return a === undefined ? null : a;
  });
  return { paint, shadowColour: ink };
};
// The page's own words and marks, per theme.
CH.pagePaint = function (theme, id, U = 1) {
  const ink = TOK.ink900, pap = TOK.paper000;
  const BG = "#1e4d8f", WH = "#f4f6fb", RED = "#ff6a4d", YEL = "#ffd65a", CRED = "#c22f1c", CINK = "#1a1816";
  const fam = theme === "blueprint" ? FONT.mono : theme === "casefile" ? FONT.typewriter : null;
  const T_ = {
    rulebook: {
      "ch-kicker": { fill: TOK.signal700, "font-family": FONT.condensed, "font-weight": 900, "letter-spacing": 0.12 },
      "ch-title": { fill: ink, "font-family": FONT.poster, "font-weight": 900 },
      "ch-sub": { fill: TOK.ink700, "font-family": FONT.text },
      "ch-h": { fill: TOK.ink500, "font-family": FONT.condensed, "font-weight": 900, "letter-spacing": 0.12 },
      "ch-text": { fill: ink, "font-family": FONT.text },
      "ch-cap": { fill: ink, "font-family": FONT.condensed, "font-weight": 600 },
      "ch-roll": { fill: TOK.ink500, "font-family": FONT.mono },
      "ch-beat": { fill: TOK.ink700, "font-family": FONT.text, "font-style": "italic" },
      "ch-gm": { fill: TOK.alarm700, "font-family": FONT.text, "font-weight": 700 },
      "ch-key": { fill: ink, "font-family": FONT.condensed, "font-weight": 900 },
      "ch-key-sub": { fill: TOK.ink500, "font-family": FONT.text },
      "ch-num-bg": { fill: ink }, "ch-num": { fill: pap, "font-family": FONT.condensed, "font-weight": 900 },
      "ch-frame": { fill: "none", stroke: ink },
      "ch-empty": { fill: TOK.paper200, stroke: TOK.ink300, "stroke-dasharray": "0.5 0.35" },
      "ch-empty-num": { fill: TOK.ink300, "font-family": FONT.poster, "font-weight": 900 },
      "ch-empty-name": { fill: TOK.ink500, "font-family": FONT.condensed, "font-weight": 700 },
      "ch-tag-crew": { fill: ink }, "ch-tag-against": { fill: TOK.alarm700 }, "ch-tag-text": { fill: pap, "font-family": FONT.condensed, "font-weight": 900, "letter-spacing": 0.06 },
      "ch-chip": { fill: TOK.caution500 }, "ch-chip-text": { fill: ink, "font-family": FONT.condensed, "font-weight": 900, "letter-spacing": 0.06 },
      "ch-dial-bg": { fill: TOK.paper000, stroke: ink }, "ch-dial-crew": { fill: ink }, "ch-dial-against": { fill: TOK.alarm700 }, "ch-dial-tick": { stroke: ink }, "ch-dial-gap": { stroke: TOK.paper000 },
      "ch-dial-hidden": { fill: "none", stroke: TOK.ink500, "stroke-dasharray": "0.3 0.25" },
      "ch-rule": { fill: ink }, "ch-gm-box": { fill: mix(TOK.alarm500, pap, 0.88) }
    },
    blueprint: {
      "ch-kicker": { fill: YEL, "letter-spacing": 0.1 }, "ch-title": { fill: WH, "font-weight": 700 }, "ch-sub": { fill: WH, "fill-opacity": 0.85 }, "ch-h": { fill: YEL, "font-weight": 700, "letter-spacing": 0.1 },
      "ch-text": { fill: WH }, "ch-cap": { fill: WH, "font-weight": 700 }, "ch-roll": { fill: WH, "fill-opacity": 0.7 }, "ch-beat": { fill: WH, "fill-opacity": 0.85, "font-style": "italic" },
      "ch-gm": { fill: RED, "font-weight": 700 }, "ch-key": { fill: WH, "font-weight": 700 }, "ch-key-sub": { fill: WH, "fill-opacity": 0.7 },
      "ch-num-bg": { fill: BG, stroke: WH, "stroke-width": 0.08 }, "ch-num": { fill: WH, "font-weight": 700 }, "ch-frame": { fill: "none", stroke: WH },
      "ch-empty": { fill: "none", stroke: WH, "stroke-opacity": 0.6, "stroke-dasharray": "0.5 0.35" }, "ch-empty-num": { fill: WH, "fill-opacity": 0.35, "font-weight": 700 }, "ch-empty-name": { fill: WH, "fill-opacity": 0.6 },
      "ch-tag-crew": { fill: BG, stroke: WH, "stroke-width": 0.06 }, "ch-tag-against": { fill: BG, stroke: RED, "stroke-width": 0.06 }, "ch-tag-text": { fill: WH, "font-weight": 700 },
      "ch-chip": { fill: YEL }, "ch-chip-text": { fill: BG, "font-weight": 700 },
      "ch-dial-bg": { fill: BG, stroke: WH }, "ch-dial-crew": { fill: WH }, "ch-dial-against": { fill: RED }, "ch-dial-tick": { stroke: WH }, "ch-dial-gap": { stroke: BG }, "ch-dial-hidden": { fill: "none", stroke: WH, "stroke-dasharray": "0.3 0.25" },
      "ch-rule": { fill: WH, "fill-opacity": 0.6 }, "ch-gm-box": { fill: WH, "fill-opacity": 0.06, stroke: RED, "stroke-width": 0.06 }
    },
    casefile: {
      "ch-kicker": { fill: CRED, "font-weight": 700, "letter-spacing": 0.08 }, "ch-title": { fill: CINK, "font-weight": 700 }, "ch-sub": { fill: CINK }, "ch-h": { fill: CINK, "font-weight": 700, "text-decoration": "underline" },
      "ch-text": { fill: CINK }, "ch-cap": { fill: CINK, "font-weight": 700 }, "ch-roll": { fill: "#55504a" }, "ch-beat": { fill: "#3a3632", "font-style": "italic" },
      "ch-gm": { fill: CRED, "font-weight": 700 }, "ch-key": { fill: CINK, "font-weight": 700 }, "ch-key-sub": { fill: "#55504a" },
      "ch-num-bg": { fill: CINK }, "ch-num": { fill: "#fbf8f1", "font-weight": 700 }, "ch-frame": { fill: "none", stroke: CINK },
      "ch-empty": { fill: "#ebe7dc", stroke: "#8a857d", "stroke-dasharray": "0.5 0.35" }, "ch-empty-num": { fill: "#8a857d", "font-weight": 700 }, "ch-empty-name": { fill: "#55504a" },
      "ch-tag-crew": { fill: CINK }, "ch-tag-against": { fill: CRED }, "ch-tag-text": { fill: "#fbf8f1", "font-weight": 700 },
      "ch-chip": { fill: "#fbf8f1", stroke: CINK, "stroke-width": 0.06 }, "ch-chip-text": { fill: CINK, "font-weight": 700 },
      "ch-dial-bg": { fill: "#fbf8f1", stroke: CINK }, "ch-dial-crew": { fill: CINK }, "ch-dial-against": { fill: CRED }, "ch-dial-tick": { stroke: CINK }, "ch-dial-gap": { stroke: "#fbf8f1" }, "ch-dial-hidden": { fill: "none", stroke: "#55504a", "stroke-dasharray": "0.3 0.25" },
      "ch-rule": { fill: CINK }, "ch-gm-box": { fill: "#f8f3e6", stroke: CRED, "stroke-width": 0.06 }
    }
  }[theme];
  // dashes, hairlines and letter-spacing are written in type floors: scaled here
  const scale = v => String(v).split(/\s+/).map(x => CH.n(+x * U)).join(" ");
  return wrapPaint((role) => {
    const a = T_[role]; if (!a) return null;
    const o = Object.assign({}, a);
    if (fam && /^ch-(kicker|title|sub|h|text|cap|roll|beat|gm|key|key-sub|num|empty-num|empty-name|tag-text|chip-text)$/.test(role)) o["font-family"] = fam;
    for (const k of ["stroke-dasharray", "stroke-width", "letter-spacing"]) if (o[k] != null) o[k] = scale(o[k]);
    return o;
  });
};
// The faces the page's words are measured in, per theme.
CH.FACES = {
  rulebook: { cap: "condensed", text: "text", roll: "mono", title: "poster", head: "condensed", key: "condensed" },
  blueprint: { cap: "mono", text: "mono", roll: "mono", title: "mono", head: "mono", key: "mono" },
  casefile: { cap: "typewriter", text: "typewriter", roll: "typewriter", title: "typewriter", head: "typewriter", key: "typewriter" }
};

// --- The art of one panel ------------------------------------------------------------------------------
// In feet: x 0 → A.W left to right, y 0 → CH.Y.bottom top to bottom. Returns { pieces, toks } (the
// tokens' boxes in feet, for the badges drawn over everything).
CH.DESCS = {
  statue: c => PRS.statue(c),
  vendor: c => PRS.stall(c),
  scaffold: c => PRS.scaffold(c),
  poles: () => ({ zone: "back", k: [-8, 8].flatMap(x => [P.rect("st-f:wood", x - 0.4, -18, 0.8, 18), P.rect("st-f:wood", x - 2.4, -16.6, 4.8, 0.5), P.rect("st-f:metal", x + 0.6, -14, 1.6, 2.6, { rx: 0.5 })]).concat([P.path("st-x:wire", "M-30 -16.4 Q-8 -13.6 -8 -16.4 Q0 -13.6 8 -16.4 Q20 -13.6 30 -16.4", { sw: 0.2 })]) }),
  billboards: () => ({ zone: "back", k: [P.rect("st-f:iron", -5, -22, 0.6, 12), P.rect("st-f:iron", 4.4, -22, 0.6, 12), P.rect("st-f:billboard", -7, -30, 14, 8), P.rect("st-d:poster", -6.2, -29.2, 6, 6.4), P.rect("st-d:poster2", 0.4, -29.2, 5.8, 6.4)] }),
  screens: () => ({ zone: "back", k: [P.rect("st-f:iron", -7.4, -26, 14.8, 10), P.rect("st-d:screen", -6.8, -25.4, 6.6, 4.2), P.rect("st-d:screen2", 0.2, -25.4, 6.6, 4.2), P.rect("st-d:screen2", -6.8, -20.8, 6.6, 4.2), P.rect("st-d:screen", 0.2, -20.8, 6.6, 4.2)] }),
  mural: () => ({ zone: "wall", k: [P.rect("st-d:mural1", -7, -9.5, 14, 7.2), P.circle("st-d:flower1", -3.6, -6.4, 1.8), P.circle("st-d:flower2", 0.4, -7, 2.2), P.circle("st-d:flower3", 4, -5.8, 1.7), P.rect("st-d:stem", -0.2, -4.8, 0.4, 2.5)] })
};
CH.art = function (A) {
  const Y = chY, Wd = A.W, rng = A.rng, night = A.night, g = A.ground, k = [], N = CH.n;
  const L = { sky: [], far: [], back: [], hold: [], struct: [], surf: [], below: [], props: [], light: [], shadow: [], tokB: [], wet: [], tok: [], fx: [], weather: [] };
  const c = { rng, night, water: A.water };
  const at = (pcs, x, y, o = {}) => P.g(pcs, { tf: Object.assign({ x: N(x), y: N(y) }, o) });
  const slotW = Wd / A.k, base = Y.street - 1.6;
  const holds = A.holds;              // one per slot (or null)
  const signs = [];                   // the words on the frontage, for the badges to keep off
  // the sky and the far city
  L.sky.push(P.rect("ch-sky", 0, 0, Wd, Y.street));
  const farTop = g === "bridge" || g === "waterside" || g === "quay" || g === "open" ? [7, 13] : [2, 7];
  for (let x = -4 - rng() * 6; x < Wd + 4;) { const w = 6 + rng() * 10, t = farTop[0] + rng() * (farTop[1] - farTop[0]); L.far.push(P.rect(rng() < 0.5 ? "ch-far" : "ch-far2", N(x), N(t), N(w), N(Y.street - t)));
    if (night) for (let i = 0; i < 3; i++) if (rng() < 0.6) L.far.push(P.rect("ch-far-lit", N(x + 1 + rng() * (w - 2)), N(t + 1.5 + rng() * 6), 0.6, 0.8));
    x += w + rng() * 2; }
  // the frontage behind the street: generic buildings, a nearby building in its slot
  const roofY = g === "covered" ? Y.above + 3.4 : g === "waterside" || g === "quay" ? Y.above - 2 : g === "deck" ? 1 : g === "open" || g === "bridge" ? null : Y.above;
  const frontage = (x0, x1, mats, o = {}) => {
    let x = x0;
    while (x < x1 - 2) {
      const w = Math.min(x1 - x, 10 + rng() * 9);
      if (x1 - x - w < 6) { /* the last one takes the rest */ }
      const ww = x1 - x - w < 6 ? x1 - x : w;
      const st = o.storeys || 2, h = CH.GROUND + (st - 1) * CH.STOREY, top = base - h, mat = rng.pick(mats);
      const f = CH.facade(c, { k: o.kind || "plain", st, mat, awning: o.awning && rng() < 0.4 }, null, x, ww, base, 0);
      // roofs: a parapet, a chimney or a tank on some
      const extra = [];
      if (o.roofs !== false) { const r = rng(); if (r < 0.3) extra.push(P.rect("st-f:" + mat, x + ww * 0.6, top - 2.2, 1.6, 2.2)); else if (r < 0.5) extra.push(P.rect("st-f:metal", x + ww * 0.2, top - 2.8, 3.2, 2.8, { rx: 0.4 }), P.rect("st-s:metal", x + ww * 0.2, top - 0.4, 3.2, 0.4)); extra.push(P.rect("st-t:" + mat, x - 0.2, top - 0.5, ww + 0.4, 0.5)); }
      if (o.escape && rng() < 0.5) { const fx = x + ww * (0.3 + rng() * 0.3); for (let y = base - CH.GROUND; y > top + 1; y -= CH.STOREY) extra.push(P.rect("st-f:iron", fx - 2, y - 0.3, 4, 0.3), P.line("st-x:rail", fx - 2, y - 2, fx + 2, y - 2, { sw: 0.15 }), P.line("st-x:rail", fx - 1.8, y, fx + 1.6, y - CH.STOREY + 0.3, { sw: 0.25 })); }
      if (o.pipes && rng() < 0.6) extra.push(P.rect("st-f:metal", x + ww - 1.6, top + 0.5, 0.4, h - 0.5));
      L.back.push(...f.k, ...extra);
      x += ww;
    }
  };
  const ground = {
    corridor: () => { frontage(-2, Wd + 2, ["render", "brick", "nb1", "nb2", "concrete"], { kind: "plain", awning: true }); },
    lane: () => { frontage(-2, Wd + 2, ["brick", "brick", "rust", "concrete"], { kind: "lane", escape: true, pipes: true }); },
    deadend: () => { frontage(-2, Wd + 2, ["brick", "brick", "concrete"], { kind: "lane", escape: true, pipes: true }); },
    hub: () => { frontage(-2, Wd + 2, ["render", "nb1", "stone", "brick"], { kind: "plain" }); },
    covered: () => { frontage(-2, Wd + 2, ["render", "white", "nb1", "nb2"], { kind: "plain", roofs: false }); },
    deck: () => { frontage(-2, Wd + 2, ["concrete", "concrete", "glassblock", "brick"], { kind: "office", storeys: 5, roofs: false }); },
    waterside: () => { frontage(-2, Wd + 2, ["brick", "brick", "wood"], { kind: "warehouse", storeys: 2 }); },
    open: () => { for (let x = -4 + rng() * 8; x < Wd + 4; x += 26 + rng() * 14) L.back.push(P.rect("st-f:concrete", N(x), 3, N(14 + rng() * 6), base - 3), P.rect("st-s:concrete", N(x), 3, 1.2, base - 3)); },
    quay: () => { frontage(-2, Wd + 2, ["brick", "rust", "wood", "concrete"], { kind: "warehouse", storeys: 2, pipes: true }); },
    carpark: () => {
      // [interpretation] the car park's open decks behind the street: slabs on columns, parked autopods in the bays, a ramp
      const lv = 3, sh = (base - Y.above + 2) / lv;
      for (let i = 0; i < lv; i++) {
        const top = base - (i + 1) * sh, sl = 1.1;
        L.back.push(P.rect("ch-shade", 0, N(top + sl), Wd, N(sh - sl)), P.rect("st-f:concrete", 0, N(top), Wd, sl), P.rect("st-s:concrete", 0, N(top + sl - 0.3), Wd, 0.3));
        for (let x = 1 + rng() * 3; x < Wd - 3; x += 5.4) if (rng() < 0.62) {
          const cy = top + sh - 0.1, cw = 3.6, ch = Math.min(1.9, sh - sl - 0.6);
          L.back.push(P.rect(rng.pick(["st-f:pod1", "st-f:pod2", "st-f:pod3", "st-f:metal"]), N(x), N(cy - ch), cw, N(ch), { rx: 0.5 }), P.rect(night && rng() < 0.2 ? "st-d:winlit" : "st-d:glass", N(x + 0.6), N(cy - ch + 0.3), 2.4, N(ch * 0.38), { rx: 0.25 }));
        }
        for (let x = 4 + rng() * 2; x < Wd; x += 11) L.back.push(P.rect("st-f:concrete", N(x), N(top + sl), 1.1, N(sh - sl)), P.rect("st-s:concrete", N(x + 0.8), N(top + sl), 0.3, N(sh - sl)));
      }
      const rx = Wd * (0.55 + rng() * 0.3);
      L.back.push(P.poly("st-f:deck", [[N(rx), N(base - sh + 0.4)], [N(rx + 14), N(base - 2 * sh + 1.5)], [N(rx + 14), N(base - 2 * sh + 2.6)], [N(rx), N(base - sh + 1.5)]]));
      L.back.push(P.rect("st-f:concrete", 0, N(Y.above - 1.6), Wd, 0.9), P.rect("st-t:concrete", 0, N(Y.above - 1.9), Wd, 0.35));
    },
    bridge: () => { for (let x = -4 + rng() * 6; x < Wd + 4; x += 9 + rng() * 6) { const t = 11 + rng() * 4; L.back.push(P.rect(rng() < 0.5 ? "st-f:render" : "st-f:brick", N(x), N(t), N(8 + rng() * 4), N(Y.street + 2 - t))); } }
  };
  (ground[g] || ground.lane)();
  // a nearby building, in its slot, in front of the generic frontage
  const sign = Math.max(A.U / A.s, 1.6);
  holds.forEach((h, j) => {
    if (!h || h.kind !== "nearby") return;
    const nb = h.nb, w = Math.min(slotW - 2, Math.max(16, (nb ? nb.w : 28) * 0.62)), x0 = j * slotW + (slotW - w) / 2 + (rng() - 0.5) * 3;
    const f = CH.facade(c, nb || { k: "shop", st: 2, mat: "render" }, h.name, N(x0), N(w), base, sign);
    L.back.push(P.rect("st-t:" + (nb ? nb.mat : "render"), N(x0 - 0.3), N(f.top - 0.5), N(w + 0.6), 0.5), ...f.k);
    if (f.sign) signs.push(f.sign);
  });
  // structure on the above level
  if (g === "deck") {
    // the deck: a darker slab on pillars, its parapet behind, its shadow on the frontage under it
    const dt = Y.above + 1.5, db = dt + 2.4;
    L.struct.push(P.rect("ch-shade", 0, db, Wd, base - db), P.rect("ch-shade", 0, db, Wd, 2.2));
    for (let x = 6 + rng() * 6; x < Wd; x += 20 + rng() * 6) L.struct.push(P.rect("st-f:podium", N(x), db, 2.6, Y.street - db), P.rect("st-s:podium", N(x + 2), db, 0.6, Y.street - db));
    L.struct.push(P.rect("st-f:podium", 0, dt - 2.6, Wd, 2.6), P.rect("st-t:podium", 0, dt - 2.9, Wd, 0.4), P.rect("st-f:edge", 0, dt, Wd, db - dt), P.rect("st-s:edge", 0, db - 0.7, Wd, 0.7), P.rect("st-g:road", 0, dt - 0.5, Wd, 0.5));
    for (let x = rng() * 6; x < Wd; x += 10) L.struct.push(P.rect("st-g:mark", N(x), dt - 0.32, 4.4, 0.16));
    if (night) for (let x = 10; x < Wd; x += 24) L.light.push(P.poly("ch-cone", [[x - 0.6, db], [x + 0.6, db], [x + 4.4, base + 1.4], [x - 4.4, base + 1.4]]));
  } else if (g === "covered") {
    for (let x = 0; x < Wd; x += 8) L.struct.push(P.path("st-x:rib", `M${N(x)} ${N(Y.above + 3.4)} Q${N(x + 4)} ${N(Y.above - 0.6)} ${N(x + 8)} ${N(Y.above + 3.4)}`, { sw: 0.3 }));
    L.struct.push(P.rect("st-x:glazing", 0, Y.above, Wd, 3.4), P.rect("st-f:iron", 0, Y.above - 0.5, Wd, 0.6));
    for (let x = 6 + rng() * 8; x < Wd; x += 18 + rng() * 8) L.struct.push(P.rect("st-f:iron", N(x), Y.above + 3.4, 0.2, 2.4), P.rect(night ? "st-d:signlit" : "st-d:sign2", N(x - 2), Y.above + 5.8, 4.2, 1.6));
  } else if (g === "open") {
    L.struct.push(P.rect("st-f:concrete", 0, Y.above, Wd, 1.8), P.rect("st-s:concrete", 0, Y.above + 1.3, Wd, 0.5));
    for (let x = 0; x < Wd; x += 1.4) L.struct.push(P.rect("st-f:iron", N(x), Y.above - 2.8, 0.18, 2.8));
    L.struct.push(P.rect("st-f:iron", 0, Y.above - 3, Wd, 0.3));
    for (let x = 8 + rng() * 8; x < Wd; x += 22) L.struct.push(P.rect("st-f:concrete", N(x), Y.above + 1.8, 1.8, base - Y.above - 1.8));
  } else if (g === "bridge") {
    // the far girder: top chord at the above level, verticals and diagonals down to the deck
    const bay = 8;
    L.struct.push(P.rect("st-f:iron", 0, Y.above, Wd, 1), P.rect("st-s:iron", 0, Y.above + 0.7, Wd, 0.3));
    for (let x = -((rng() * bay) | 0); x < Wd + bay; x += bay) {
      L.struct.push(P.rect("st-f:iron", N(x - 0.3), Y.above + 1, 0.6, Y.street - Y.above - 1));
      L.struct.push(P.line("st-x:rail", N(x), Y.above + 1, N(x + bay), Y.street - 1, { sw: 0.45 }));
    }
  }
  // lamps along the street (and their light at Night)
  if (g !== "covered") for (let x = 7 + rng() * 10; x < Wd; x += 24 + rng() * 8) L.light.push(at(chLamp(0, night), x, g === "bridge" ? Y.street - 0.8 : base));
  // the street's surface
  if (g === "bridge") {
    L.surf.push(P.rect("st-f:iron", 0, Y.street - 3.6, Wd, 0.35), P.rect("st-f:iron", 0, Y.street - 1.9, Wd, 0.2));
    for (let x = 0; x < Wd; x += 1.4) L.surf.push(P.rect("st-f:iron", N(x), Y.street - 3.6, 0.22, 3.6));
  }
  L.surf.push(P.rect(g === "open" ? "st-g:plaza" : g === "waterside" || g === "quay" ? "st-g:cobble" : g === "covered" ? "st-g:tile" : g === "carpark" ? "st-g:lot" : "st-g:pave", 0, Y.street - 1.6, Wd, 0.7),
    P.rect("st-g:kerb", 0, Y.street - 1.0, Wd, 0.22), P.rect(g === "waterside" || g === "open" || g === "covered" ? "st-g:plaza" : g === "quay" ? "st-g:cobble" : g === "carpark" ? "st-g:lot" : "st-g:road", 0, Y.street - 0.8, Wd, 0.8));
  // a car park's painted bays; a quay's bollards along its edge, a crane against the sky
  if (g === "carpark") for (let x = rng() * 3; x < Wd; x += 3.6) L.surf.push(P.rect("st-g:mark", N(x), Y.street - 1.55, 0.16, 1.4));
  if (g === "quay") {
    for (let x = 3 + rng() * 4; x < Wd; x += 9 + rng() * 3) L.surf.push(P.rect("st-f:iron", N(x - 0.45), Y.street - 1.9, 0.9, 1.2, { rx: 0.35 }), P.rect("st-t:iron", N(x - 0.6), Y.street - 2.05, 1.2, 0.3, { rx: 0.15 }));
    const cx = Wd * (0.2 + rng() * 0.5), top = Y.above - 3;
    L.struct.push(P.rect("st-f:rust", N(cx - 1.2), N(top), 2.4, N(base - top)), P.rect("st-s:rust", N(cx + 0.6), N(top), 0.6, N(base - top)));
    L.struct.push(P.poly("st-f:rust", [[N(cx - 1.2), N(top)], [N(cx + 22), N(top - 4)], [N(cx + 22), N(top - 3.2)], [N(cx - 1.2), N(top + 1.2)]]), P.line("st-x:rail", N(cx), N(top - 6), N(cx + 20), N(top - 4), { sw: 0.18 }), P.line("st-x:rail", N(cx), N(top - 6), N(cx), N(top), { sw: 0.25 }));
    L.struct.push(P.line("st-x:rail", N(cx + 18), N(top - 3.6), N(cx + 18), N(top + 6), { sw: 0.12 }), P.rect("st-f:wood", N(cx + 16.6), N(top + 6), 2.8, 1.8));
  }
  if (g !== "waterside" && g !== "quay" && g !== "carpark" && g !== "open" && g !== "covered" && g !== "lane" && g !== "deadend") for (let x = rng() * 6; x < Wd; x += 10) L.surf.push(P.rect("st-g:mark", N(x), Y.street - 0.45, 4.4, 0.18));
  if (!night && roofY != null && g !== "deck") L.surf.push(P.rect("ch-shade", 0, Y.street - 1.6, Wd, 0.6));
  if (g === "hub") { const x = Wd * (0.35 + rng() * 0.3); L.surf.push(P.rect("st-g:kerb", N(x - 9), Y.street - 1.6, 18, 1.6), P.path("st-g:grass", `M${N(x - 8)} ${Y.street - 1.6} Q${N(x)} ${Y.street - 4} ${N(x + 8)} ${Y.street - 1.6} Z`), ...PRS.monument(c).map(p => Object.assign(p, { tf: { x: N(x), y: Y.street - 1.6, s: 0.6 } }))); }
  // the cut: the slab under the street, and the level below
  const slabB = g === "bridge" ? Y.street + 1.8 : Y.street + 1.2;
  L.surf.push(P.rect(g === "bridge" ? "st-f:iron" : "ch-slab", 0, Y.street, Wd, slabB - Y.street));
  const below = M.belowKind(g, A.water);          // the same reading as the building views' floor −1 (outdoors.js)
  const B = { kind: below, water: below === "canal" || below === "culvert" || below === "sewer", floor: Y.below };
  if (below === "canal") {
    if (g === "bridge") {
      // stone arches under the deck, the canal below
      L.below.push(P.rect("ch-sky", 0, slabB, Wd, Y.below - slabB));
      L.below.push(...L.far.filter(p => p.r === "ch-far").slice(0, 0));
      const span = 30 + rng() * 6;
      for (let x = -((rng() * span) | 0); x < Wd + span; x += span) {
        const a = x + 3, b = x + span - 3;
        L.below.push(P.path("st-f:stone", `M${N(x)} ${N(slabB)} L${N(x + span)} ${N(slabB)} L${N(x + span)} ${N(Y.below + 1)} L${N(b)} ${N(Y.below + 1)} L${N(b)} ${N(slabB + 5)} Q${N((a + b) / 2)} ${N(slabB + 0.8)} ${N(a)} ${N(slabB + 5)} L${N(a)} ${N(Y.below + 1)} L${N(x)} ${N(Y.below + 1)} Z`));
        L.below.push(P.rect("st-s:stone", N(b), N(slabB + 5), 1.2, N(Y.below + 1 - slabB - 5)));
      }
    } else {
      L.below.push(P.rect("st-f:stone", 0, slabB, Wd, Y.below - slabB));
      for (let y = slabB + 1.6; y < Y.below; y += 1.6) L.below.push(P.rect("st-s:stone", 0, N(y), Wd, 0.12));
    }
    L.below.push(P.rect(A.darkWater ? "ch-sewer" : "ch-water", 0, Y.below, Wd, Y.bottom - Y.below + 1));
    for (let x = rng() * 5; x < Wd; x += 7 + rng() * 4) L.below.push(P.rect("ch-ripple", N(x), N(Y.below + 0.8 + rng() * 2.6), N(2 + rng() * 2), 0.18));
  } else {
    L.below.push(P.rect("ch-earth", 0, slabB, Wd, Y.bottom - slabB + 1));
    for (let x = rng() * 6; x < Wd; x += 5 + rng() * 6) L.below.push(P.rect("ch-earth2", N(x), N(slabB + 0.4 + rng() * 0.6), N(1 + rng() * 2), 0.3));
    const top = slabB + 1.2, bot = Y.bottom - 0.8;
    if (below === "underpass" || below === "service") {
      L.below.push(P.rect("ch-underpass", 0, top, Wd, bot - top), P.rect("ch-tile", 0, top + 2.4, Wd, 0.25), P.rect("ch-slab", 0, Y.below, Wd, bot - Y.below));
      for (let x = 6; x < Wd; x += 14) L.below.push(P.rect(night ? "st-d:winlit" : "st-d:frame", x, top + 0.3, 3, 0.4));
    } else {
      L.below.push(P.rect("ch-tunnel", 0, top, Wd, bot - top));
      for (let x = rng() * 4; x < Wd + 9; x += 9) L.below.push(P.path("ch-earth", `M${N(x)} ${N(top)} L${N(x + 9)} ${N(top)} L${N(x + 9)} ${N(top + 2.2)} Q${N(x + 4.5)} ${N(top - 0.4)} ${N(x)} ${N(top + 2.2)} Z`), P.rect("ch-rib", N(x - 0.4), N(top + 1.6), 0.8, N(bot - top - 1.6)));
      L.below.push(P.rect("st-f:concrete", 0, Y.below - 1.0, Wd, 0.9), P.rect(A.darkWater ? "ch-sewer" : below === "culvert" ? "ch-water" : "ch-sewer", 0, Y.below, Wd, bot - Y.below));
      for (let x = rng() * 5; x < Wd; x += 8 + rng() * 4) L.below.push(P.rect("ch-ripple", N(x), N(Y.below + 0.7 + rng() * 2), N(1.6 + rng() * 2), 0.16));
      L.below.push(P.rect("ch-earth", 0, bot, Wd, Y.bottom - bot + 1));
    }
  }
  // the street's handholds, one per slot
  holds.forEach((h, j) => {
    if (!h || h.kind === "nearby") return;
    const x = j * slotW + slotW * (0.3 + rng() * 0.4);
    if (h.kind === "obstacle") { const fn = M.own(OBS, h.d); if (fn) L.props.push(at(fn(c), x, Y.street - 0.9)); return; }
    if (h.kind === "prop" && M.own(CH.PROP_TOKEN, h.d) && A.tokens.has(M.own(CH.PROP_TOKEN, h.d))) return;
    const fn = h.kind === "desc" ? M.own(CH.DESCS, h.d) : M.own(PRS, h.d);
    if (!fn) return;
    let r = fn(c), zone = "pave";
    if (r && !Array.isArray(r)) { zone = r.zone; r = r.k; }
    if (zone === "water") { L.tokB.push(at(r, x, B.water ? Y.below : Y.below - 0.1)); return; }
    if (zone === "road") { L.surf.push(at(r, x, Y.street - 0.3)); if (h.d === "grate" && B.kind !== "canal") L.below.push(P.rect("ch-tunnel", N(x - 1.6), Y.street, 3.2, slabB - Y.street + 1.4)); return; }
    if (zone === "air") { L.struct.push(at(r, x, (roofY != null ? roofY : Y.above) - 1)); return; }
    if (zone === "wall") { L.back.push(at(r, x, base)); return; }
    (zone === "back" ? L.back : L.props).push(at(r, x, zone === "back" ? base : Y.street - 1.2));
  });
  // a dead end ends in its wall where its clock ends
  if (g === "deadend" && A.ends) L.props.push(P.rect("st-f:brick", N(Wd - 7), Y.above - 1, 7, base - Y.above + 1.6), P.rect("st-s:brick", N(Wd - 7), Y.above - 1, 0.6, base - Y.above + 1.6), ...[1, 2, 3].map(i => P.rect("st-f:post", N(Wd - 7 - i * 2.4), Y.street - 3, 0.9, 3, { rx: 0.4 })));
  return { L, B, slabB, base, roofY, signs };
};

// --- Tokens, their states, the fx, the badges ---------------------------------------------------------
const chSquash = (kids, a) => P.g([P.g([P.g(kids, { tf: { rot: 90 } })], { tf: { rot: -90, sx: a } })]);
const chStar = (role, x, y, r, n = 8, inner = 0.45, rot = 0) => { const pts = []; for (let i = 0; i < n * 2; i++) { const a = rot + i * Math.PI / n, rr = i % 2 ? r * inner : r; pts.push([CH.n(x + Math.cos(a) * rr), CH.n(y + Math.sin(a) * rr)]); } return P.poly(role, pts); };
const chSparks = (x, y, dir = -1) => [0, 1, 2, 3].map(i => P.poly("ch-fx-spark", [[CH.n(x), CH.n(y)], [CH.n(x + dir * (2.2 + i * 0.9)), CH.n(y - 0.4 - i * 0.7)], [CH.n(x + dir * (2.0 + i * 0.9)), CH.n(y - 0.1 - i * 0.7)]]));
const chSpeed = (x, y, H, n = 3, len = 6) => Array.from({ length: n }, (_, i) => P.rect("ch-fx-speed", CH.n(x - len - i * 1.4), CH.n(y - H * (0.25 + 0.27 * i)), CH.n(len - i * 0.8), 0.32, { rx: 0.16 }));
CH.actors = function (A, art) {
  const Y = chY, N = CH.n, L = art.L, B = art.B, Wd = A.W, toks = [], byId = new Map();
  const surface = lv => lv === "above" ? (A.ground === "waterside" ? Y.above - 2 : A.ground === "covered" ? Y.above - 0.5 : A.ground === "deck" ? Y.above + 1.5 : Y.above) : lv === "air" ? Y.street - 6 : lv === "below" ? null : Y.street;
  // where each stands, in show order, those standing on another after it
  const order = A.show.slice().sort((a, b) => (a.on ? 1 : 0) - (b.on ? 1 : 0));
  for (const o of order) {
    const def = M.own(CH.TOKENS, o.cast.token), sc = def.scale, H = def.H * sc, Lh = def.L * sc / 2;
    let x = o.x * Wd, y;
    const host = o.on ? byId.get(o.on) : null;
    if (o.on && !host) M.warn(A.W_, `panel ${A.n}: "${o.cast.label}" is on "${o.on}", which isn't in the panel — standing on its level`);
    if (host) y = host.y - host.deck;
    else if (def.air) y = Y.above + 2.6;
    else if (o.level === "below") y = def.water ? Y.below : B.water ? Y.below - 1.0 : Y.below;
    else y = surface(o.level);
    const t = { o, def, sc, H, Lh, x, y, ground: y, deck: (def.deck != null ? def.deck : def.H) * sc, side: o.cast.side, id: o.cast.id, level: o.level, state: o.state, lift: 0, top: y - H };
    toks.push(t); byId.set(t.id, t);
  }
  const colourOf = t => M.own(CH.COLOURS, chLC(t.o.cast.colour)) ? chLC(t.o.cast.colour) : /^#[0-9a-f]{6}$/i.test(t.o.cast.colour || "") ? t.o.cast.colour : t.def.colour;
  for (const t of toks) {
    const { def, sc, H, Lh, o } = t, st = t.state, cast = o.cast;
    const riders = Array.isArray(cast.riders) ? cast.riders.length : undefined;
    let g = P.g(def.draw({ colour: colourOf(t), riders: riders === 0 ? undefined : riders, half: st === "half", night: A.night }), { tf: { s: sc } });
    if (o.face < 0) g = P.g([g], { tf: { sx: -1 } });
    const fwd = o.face, out = t.level === "below" ? L.tokB : L.tok, fx = L.fx, under = L.light;
    let lift = 0;
    const walker = cast.token === "walker", cycle = cast.token === "autocycle";
    switch (st) {
      case "airborne":
        lift = t.level === "air" ? 0 : 3.2;
        g = P.g([g], { tf: { rot: -9 * fwd } });
        fx.push(...chSpeed(t.x - Lh * fwd, t.y - lift, H, 3, 7).map(p => fwd < 0 ? Object.assign(p, { x: 2 * t.x - p.x - p.w }) : p));
        break;
      case "wrecked":
        g = walker ? P.g([g], { tf: { x: 3.6 * sc, y: -1.9 * sc, rot: -90 } }) : P.g([g], { tf: { y: -H, rot: 180 } });
        if (!walker) fx.push(...CH.smoke(t.x - Lh * 0.2, t.y - H - 1.2, 1.1), ...CH.flame(t.x + Lh * 0.3, t.y - H * 0.15, 3.4, 2.4));
        t.top = t.y - (walker ? 2 * sc : H);
        break;
      case "burning":
        under.push(P.circle("ch-fx-glow", N(t.x), N(t.y - H * 0.6), N(Math.max(Lh * 1.5, 6))));
        fx.push(...CH.smoke(t.x - Lh * 0.3, t.y - H - 3.6, 1.3), ...CH.flame(t.x - Lh * 0.45, t.y - H * 0.75, H * 0.9, Lh * 0.7), ...CH.flame(t.x + Lh * 0.05, t.y - H * 0.8, H * 1.15, Lh * 0.8), ...CH.flame(t.x + Lh * 0.5, t.y - H * 0.6, H * 0.7, Lh * 0.55));
        break;
      case "down":
        if (walker) { g = P.g([g], { tf: { x: 3.6 * sc, y: -1.9 * sc, rot: -90 } }); t.top = t.y - 2 * sc; }
        else { g = cycle ? P.g([chSquash([g], 0.45)], { tf: { rot: 4 * fwd } }) : P.g([chSquash([g], 0.86)], { tf: { rot: 3 * fwd } }); t.top = t.y - H * (cycle ? 0.45 : 0.86); }
        fx.push(P.rect("ch-fx-skid", N(fwd > 0 ? t.x - Lh - 9 : t.x + Lh), N(t.y - 0.25), 9, 0.25), ...chSparks(t.x - Lh * 0.6 * fwd, t.y - 0.2, -fwd));
        break;
      case "rammed":
        g = P.g([g], { tf: { rot: 8 * fwd } });
        fx.push(chStar("ch-fx-flash", t.x - Lh * 0.35 * fwd, t.y - H * 0.55, 2.0, 7), chStar("ch-fx-flash2", t.x - Lh * 0.35 * fwd, t.y - H * 0.55, 0.9, 7));
        break;
      case "two-wheels": {
        const px = Lh * 0.62 * fwd;
        g = P.g([P.g([P.g([g], { tf: { x: -px } })], { tf: { rot: -14 * fwd } })], { tf: { x: px } });
        fx.push(...chSparks(t.x + px, t.y - 0.15, -fwd));
        t.top = t.y - H - Lh * 0.3;
        break;
      }
      case "spin":
        g = P.g([g], { tf: { rot: 20 * fwd } });
        fx.push(P.path("ch-fx-arc", `M${N(t.x - Lh * 1.1)} ${N(t.y - H * 0.4)} Q${N(t.x)} ${N(t.y - H * 1.7)} ${N(t.x + Lh * 1.1)} ${N(t.y - H * 0.6)}`, { sw: 0.45 }),
          P.path("ch-fx-arc", `M${N(t.x + Lh * 1.0)} ${N(t.y + 0.1)} Q${N(t.x)} ${N(t.y + 1.4)} ${N(t.x - Lh * 1.0)} ${N(t.y - 0.4)}`, { sw: 0.45 }),
          P.rect("ch-fx-skid", N(t.x - Lh * 1.4), N(t.y - 0.25), N(Lh * 2.8), 0.25));
        t.top = t.y - H - Lh * 0.3;
        break;
      case "chasing":
        fx.push(...chSpeed(fwd > 0 ? t.x - Lh : t.x + Lh + 6, t.y, H, 3, 6));
        break;
      case "half":
        fx.push(...chSparks(t.x - 0.9 * sc * fwd, t.y - 0.4, -fwd), ...chSpeed(t.x - 1.2 * sc * fwd, t.y, H * 0.8, 2, 5));
        break;
    }
    // At Night: headlamps on whatever is moving, the blue lamps lit
    if (A.night && !/wrecked|down|burning/.test(st || "") && !walker && !def.water && !def.air) {
      const hx = t.x + Lh * fwd, hy = t.y - lift - H * (cycle ? 0.42 : 0.36);
      under.push(P.poly("ch-fx-beam", [[N(hx), N(hy - 0.4)], [N(hx), N(hy + 0.4)], [N(hx + 15 * fwd), N(hy + 2.6)], [N(hx + 15 * fwd), N(hy - 1.6)]]));
      if (cast.token === "ambulance" || cast.token === "watch-car") under.push(P.circle("ch-glow-blue", N(t.x + (cast.token === "ambulance" ? 3.3 * sc : 0) * fwd), N(t.y - H - 0.4), 3.2));
    }
    t.lift = lift; t.top -= lift;
    if (!A.night && t.level !== "below" && !def.water && !def.air) {
      const gy = t.level === "air" ? Y.street : t.ground;
      L.shadow.push(P.ellipse("ch-shadow", N(t.x + 1.2), N(gy - 0.12), N(Lh * (st === "airborne" || t.level === "air" ? 0.6 : 0.95)), 0.5));
    }
    out.push(P.g([g], { tf: { x: N(t.x), y: N(t.y - lift) } }));
  }
  // what the fx are anchored to: the crew's lead and the nearest pursuer
  const crew = toks.filter(t => t.side === "crew"), against = toks.filter(t => t.side === "against");
  const lead = crew.find(t => t.level === A.level || (t.level === "air" && A.level === "street")) || crew[0] || toks[0] || null;
  const near = lead ? against.slice().sort((a, b) => Math.abs(a.x - lead.x) - Math.abs(b.x - lead.x))[0] || null : against[0] || null;
  const centre = t => [t.x, t.y - t.lift - t.H * 0.5];
  const fxL = L.fx;
  for (const f of A.fx) {
    const anchor = (f.at && byId.get(f.at)) || null, fxX = f.x != null && isFinite(+f.x) ? +f.x * Wd : null;
    const who = anchor || lead;
    switch (f.name) {
      case "muzzle": {
        const s = who || { x: Wd * 0.5, y: Y.street, H: 4, Lh: 4, lift: 0, top: Y.street - 4 };
        const tg = (anchor ? near : near) || null, back = tg ? tg.x < s.x : true;
        const mx = fxX != null ? fxX : s.x + (back ? -1 : 1) * s.Lh * 0.62, my = s.top + s.H * 0.28;
        if (tg) { const [cx, cy] = centre(tg); fxL.push(P.line("ch-fx-trace", N(mx), N(my), N(cx), N(cy), { sw: 0.3 })); }
        fxL.push(chStar("ch-fx-flash", mx, my, 2.4, 8, 0.42), chStar("ch-fx-flash2", mx, my, 1.0, 8, 0.5));
        break;
      }
      case "impact": {
        const tg = anchor || toks.find(t => /rammed|wrecked|down/.test(t.state || "") && t.side !== "crew") || near || lead;
        if (!tg) break;
        let [ix, iy] = centre(tg);
        if (lead && tg !== lead && Math.abs(lead.x - tg.x) < lead.Lh + tg.Lh + 6) ix = (lead.x - lead.Lh * Math.sign(lead.x - tg.x) + tg.x + tg.Lh * Math.sign(lead.x - tg.x)) / 2;
        if (fxX != null) ix = fxX;
        fxL.push(chStar("ch-fx-flash", ix, iy, 3.4, 9, 0.4, 0.2), chStar("ch-fx-flash2", ix, iy, 1.5, 9, 0.45, 0.2));
        for (let i = 0; i < 4; i++) fxL.push(P.rect("ch-fx-debris", N(ix - 4 + i * 2.6), N(iy - 3.5 - (i % 2) * 1.6), 0.9, 0.5, { tf: { rot: 20 + i * 35 } }));
        break;
      }
      case "flame-wall": {
        const fx0 = fxX != null ? fxX : lead && near ? (lead.x - lead.Lh * Math.sign(lead.x - near.x) + near.x + near.Lh * Math.sign(lead.x - near.x)) / 2 : lead ? lead.x - lead.Lh - 6 : Wd * 0.35;
        const gy = lead && lead.level !== "air" ? lead.ground : Y.street;
        fxL.push(P.ellipse("ch-fx-glow", N(fx0), N(gy - 4), 9, 6));
        for (let i = 0; i < 5; i++) fxL.push(...CH.flame(fx0 - 5 + i * 2.5, gy - 0.1, 6 + ((i * 7) % 4), 3.2));
        break;
      }
      case "nos": {
        if (!who) break;
        const fw = who.o.face, x0 = who.x - who.Lh * fw, y0 = who.y - who.lift - who.H * 0.3;
        fxL.push(P.poly("ch-fx-nos", [[N(x0), N(y0 - 1)], [N(x0 - 10 * fw), N(y0)], [N(x0), N(y0 + 1)]]), P.poly("ch-fx-nos2", [[N(x0), N(y0 - 0.45)], [N(x0 - 5 * fw), N(y0)], [N(x0), N(y0 + 0.45)]]));
        break;
      }
      case "railing-break": {
        const bx = fxX != null ? fxX : who ? who.x - who.Lh * 0.4 : Wd * 0.5, by = (who && who.level !== "below" && who.level !== "air" ? who.ground : Y.street) - 2.8;
        for (let i = 0; i < 7; i++) fxL.push(P.rect("st-f:iron", N(bx - 5 + i * 1.7), N(by - 1.5 - ((i * 5) % 4) * 1.2), 0.3, 2.6 + (i % 3) * 0.6, { tf: { rot: -40 + i * 17 } }));
        fxL.push(P.rect("st-f:iron", N(bx - 6), N(by - 0.6), 5, 0.35, { tf: { rot: -22 } }), chStar("ch-fx-flash2", bx, by, 1.4, 6));
        break;
      }
      case "grenade": {
        const tg = anchor || toks.find(t => t.state === "burning") || near || lead;
        const gx = fxX != null ? fxX : tg ? tg.x : Wd * 0.5, gy = tg ? tg.y - 0.4 : Y.street - 0.4;
        fxL.push(chStar("ch-fx-flash", gx, gy - 1.6, 4.6, 10, 0.42, 0.1), chStar("ch-fx-flash2", gx, gy - 1.6, 2.0, 10, 0.5, 0.1), ...CH.smoke(gx - 2, gy - 6, 1.1));
        break;
      }
      case "searchlight": {
        const tg = anchor || toks.find(t => t.level === A.level && t.side === "crew") || lead;
        const ship = toks.find(q => q.def.air);
        const sx = fxX != null ? fxX : ship ? ship.x + 5.2 * ship.sc * ship.o.face : Wd * 0.9, sy = ship ? ship.y - 0.9 * ship.sc : art.roofY != null ? Math.max(1.5, art.roofY - 1.5) : 1.5;
        const tx = tg ? tg.x : Wd * 0.45, ty = tg ? tg.y : Y.street;
        (ship ? L.light : fxL).unshift(P.poly("ch-fx-beam", [[N(sx - 0.8), N(sy)], [N(sx + 0.8), N(sy)], [N(tx + 7), N(ty + 0.5)], [N(tx - 7), N(ty + 0.5)]]));
        if (!ship) fxL.push(P.rect("ch-fx-lamp", N(sx - 1.6), N(sy - 1.2), 3.2, 1.6, { rx: 0.4 }), P.rect("st-f:iron", N(sx - 0.25), N(sy - 4), 0.5, 3));
        break;
      }
      case "fog":
        for (const [y, rx, ry] of [[Y.street - 3.5, Wd * 0.7, 2.2], [Y.above + 3, Wd * 0.6, 1.8], [Y.below - 1.2, Wd * 0.65, 1.6]]) L.weather.push(P.ellipse("ch-fx-fog", N(Wd * 0.5), N(y), N(rx), ry));
        break;
      case "glow-water":
        if (B.water) { L.wet.push(P.rect("ch-fx-glowwater", 0, N(Y.below), N(Wd), N(Y.bottom - Y.below + 1))); for (let x = 2; x < Wd; x += 6.5) L.wet.push(P.rect("ch-fx-glowline", N(x), N(Y.below + 0.8 + ((x * 7) % 3)), 2.6, 0.22)); }
        break;
      case "anomaly-bloom": {
        const tg = anchor || toks.find(t => t.side === "against" && /down|wrecked/.test(t.state || "")) || null;
        const ax = fxX != null ? fxX : tg ? tg.x : Wd * 0.3, ay = tg ? tg.y - 3 : Y.street - 4;
        for (let i = 0; i < 6; i++) fxL.push(P.ellipse("ch-fx-anomaly", N(ax), N(ay - 2.4), 1.5, 3.2, { tf: { rot: i * 60 } }));
        fxL.push(P.circle("ch-fx-anomaly2", N(ax), N(ay), 1.2));
        break;
      }
      case "fruit": {
        const fx0 = fxX != null ? fxX : who ? who.x - (who.Lh + 3) * who.o.face : Wd * 0.4;
        fxL.push(P.g(PRS.fruit({}), { tf: { x: N(fx0), y: Y.street - 0.6, rot: -16 } }));
        for (let i = 0; i < 9; i++) fxL.push(P.circle("ch-fx-fruit" + (1 + i % 3), N(fx0 - 4 + i * 1.3), N(Y.street - 9 - Math.sin(i * 1.3) * 2.6 - (i % 2) * 1.4), 0.55));
        break;
      }
      case "grate": {
        const gx = fxX != null ? fxX : who ? who.x : Wd * 0.45;
        if (B.kind !== "canal") { L.below.push(P.rect("ch-earth2", N(gx - 2.2), Y.street, 4.4, N(art.slabB - Y.street + 1.4)), P.rect("ch-tunnel", N(gx - 1.6), Y.street, 3.2, N(art.slabB - Y.street + 1.6))); for (let y = Y.street + 0.5; y < art.slabB + 1.4; y += 0.6) L.below.push(P.rect("st-f:iron", N(gx - 1.3), N(y), 2.6, 0.18)); }
        L.surf.push(P.rect("st-g:grate", N(gx - 2), Y.street - 0.55, 4, 0.55), ...[0, 1, 2, 3].map(i => P.rect("st-g:grate-bar", N(gx - 1.8 + i * 1.1), Y.street - 0.55, 0.3, 0.55)));
        break;
      }
      case "briefcase-drop": {
        const bx = fxX != null ? fxX : who ? who.x : Wd * 0.45, by = Y.street + 4.2;
        fxL.push(P.line("ch-fx-fall", N(bx), Y.street - 1, N(bx), N(by - 1.2), { sw: 0.28 }), P.path("ch-case-handle", `M${N(bx - 0.6)} ${N(by - 1)} Q${N(bx)} ${N(by - 1.9)} ${N(bx + 0.6)} ${N(by - 1)}`, { sw: 0.22 }),
          P.rect("ch-case", N(bx - 1.9), N(by - 1), 3.8, 2.6, { rx: 0.3 }), P.rect("ch-fx-flash2", N(bx - 1.9), N(by + 0.1), 3.8, 0.25), P.line("ch-fx-fall", N(bx), N(by + 2), N(bx), N(Y.below - 4.5), { sw: 0.28 }));
        break;
      }
      case "dark-water":
        if (B.water) L.wet.push(P.rect("ch-fx-darkwater", 0, N(Y.below), N(Wd), N(Y.bottom - Y.below + 1)));
        break;
    }
  }
  // the water in front of whatever floats
  if (B.water) L.wet.unshift(P.rect("ch-water-front", 0, N(Y.below + 0.45), N(Wd), N(Y.bottom - Y.below)));
  // the weather: rain in streaks, fog in bands [interpretation]
  if (A.rain) for (let x = 0.5; x < Wd; x += 2.6) L.weather.push(P.line("ch-rain", N(x + ((x * 13) % 2)), N(1 + ((x * 7) % 9)), N(x - 1.2 + ((x * 13) % 2)), N(4 + ((x * 7) % 9)), { sw: 0.12 }));
  // E4: the weather's fog is a flat veil over the panel, thicker in bands at the street and the level below
  if (A.fog && !A.fx.some(f => f.name === "fog")) {
    L.weather.push(P.rect("ch-fog-veil", 0, 0, N(Wd), N(Y.bottom)));
    for (const [y, h] of [[Y.above + 2, 3.2], [Y.street - 5, 4.4], [Y.below - 2.4, 3.4]]) L.weather.push(P.rect("ch-fog-band", 0, N(y), N(Wd), h, { rx: h / 2 }));
  }
  // E4: snow in flakes, two sizes, on a fixed scatter [interpretation]
  if (A.snow) for (let x = 0.8; x < Wd; x += 2.2) for (let j = 0; j < 3; j++) L.weather.push(P.circle("ch-snow", N(x + ((x * 7 + j * 5) % 1.8)), N(1 + ((x * 11 + j * 13) % (Y.bottom - 2))), (x * 3 + j) % 2 < 1 ? 0.16 : 0.1));
  return toks;
};
// The side marker over each token: a disc for the crew, a diamond against, a square for the
// rest, with the token's letter in it. Never colour alone. Sized for the type floor.
CH.badge = function (side, letter, x, y, rb, size) {
  const N = CH.n, k = [];
  if (side === "crew") k.push(P.circle("ch-badge-crew", N(x), N(y), N(rb), { sw: rb * 0.14 }));
  else if (side === "against") k.push(P.poly("ch-badge-against", [[N(x), N(y - rb * 1.22)], [N(x + rb * 1.22), N(y)], [N(x), N(y + rb * 1.22)], [N(x - rb * 1.22), N(y)]], { sw: rb * 0.14 }));
  else k.push(P.rect("ch-badge-neutral", N(x - rb * 0.92), N(y - rb * 0.92), N(rb * 1.84), N(rb * 1.84), { sw: rb * 0.14 }));
  if (letter) k.push(P.text("ch-badge-text", N(x), N(y + size * 0.36), letter, { size: N(size), anchor: "middle" }));
  return k;
};
// Letters: the first letter of each shown cast member's label (an article skipped), numbered where two share one.
CH.letters = function (cast) {
  const first = c => (String(c.label || c.token).replace(/^(the|a|an)\s+/i, "").match(/[A-Za-z0-9]/) || ["?"])[0].toUpperCase();
  const count = {}, seen = {}, out = new Map();
  for (const c of cast) count[first(c)] = (count[first(c)] || 0) + 1;
  for (const c of cast) { const f = first(c); seen[f] = (seen[f] || 0) + 1; out.set(c.id, count[f] > 1 ? f + seen[f] : f); }
  return out;
};

// --- The page --------------------------------------------------------------------------------------------
// A header (the chase's name, where and when, its clocks as dials), "Before the chase", then the
// panels and empty slots in rows, then the aside: beats since the last panel, who is who, and the
// GM's notes. The aside sits beside the last row when the row leaves room, else under the rows.
// Every word is at the layout's type floor or above. [interpretation]
M.chaseRender = function (chase, opts = {}) {
  const W = [];
  opts = Object.assign({}, opts || {});
  if (opts.layer != null && opts.layer !== "gm" && opts.layer !== "player") M.warn(W, `layer "${opts.layer}" is not gm or player — drawing the player copy`);
  // light (the contract) or time: the chase's time, for every panel that doesn't give its own; weather: the chase's weather
  if (opts.light != null || opts.time != null || opts.weather != null) {
    chase = Object.assign({}, chase);
    if (opts.light != null) { const L = M.light.resolve(opts.light); if (L) chase.time = M.light.word(L); else M.warn(W, `light ${JSON.stringify(opts.light)} is not a light preset (bluetime, night) or a light object — the chase's time`); }
    else if (opts.time != null) chase.time = opts.time;
    if (opts.weather != null) chase.weather = opts.weather === false ? "" : String(opts.weather);
  }
  const player = opts.layer != null && opts.layer !== "gm";
  let layoutName = opts.layout || "ipad";
  if (!M.own(CH.LAYOUTS, layoutName)) { M.warn(W, `layout "${layoutName}" is not one of ${Object.keys(CH.LAYOUTS).join(", ")} — ipad`); layoutName = "ipad"; }
  let theme = opts.theme || "rulebook";
  if (!CH.THEMES.includes(theme)) { M.warn(W, `theme "${theme}" is not one of ${CH.THEMES.join(", ")} — rulebook`); theme = "rulebook"; }
  const pr = M.own(CH.LAYOUTS, layoutName), stack = !!pr.stack;
  const PW = +opts.displayWidth > 0 ? +opts.displayWidth : pr.displayWidth;
  const width = +opts.width > 0 ? Math.round(+opts.width) : Math.round(PW * pr.width / pr.displayWidth);
  const U = +opts.minLabelPx > 0 ? +opts.minLabelPx : pr.floor;
  const fixedH = pr.height ? PW * pr.height / pr.width : null;
  const R = CH.read(chase, W, player);
  const rolls = !player || opts.rolls === true;
  const id = "b68c" + M.hash(JSON.stringify(chase) + "|" + JSON.stringify([player, layoutName, theme, rolls, width, PW, U, opts.grain !== false])).toString(36);
  const F = M.own(CH.FACES, theme), N = CH.n;
  const pp = CH.pagePaint(theme, id, U);
  const ser = pcs => M.toSVG(pcs, { paint: pp, shadowColour: TOK.ink900 });
  const tw = (s, size, face, ls) => M.textW(s, size, face, ls || 0);
  const m = (stack ? 0.9 : 1.25) * U, gap = 0.9 * U, rowGap = 1.1 * U;
  const avail = PW - 2 * m;
  const hiddenStrip = k => player && k.hidden;
  const dials = R.clocks.filter(k => !(player && k.hidden)).sort((a, b) => (a.side === "crew" ? 0 : 1) - (b.side === "crew" ? 0 : 1));
  const letters = CH.letters(R.shown);
  const painters = { Bluetime: CH.painter(theme, id, false), Night: CH.painter(theme, id, true) };
  // --- the header: its size first ---
  const sKick = U, sTitle = (stack ? 2.0 : 2.5) * U, sSub = 1.05 * U, sCap = (stack ? 1.1 : 1.15) * U;
  const kicker = ["The chase", R.district, R.session].filter(Boolean).join(" · ").toUpperCase() + (player ? "" : " · GM COPY");
  const typeLine = R.street.typeKey ? R.street.typeKey : R.street.type || M.own(CH.GROUNDS, R.street.ground).street;
  const names = R.streets.map(s => s.named || s.said || s.typeKey || s.type || M.own(CH.GROUNDS, s.ground).street).filter((n, i, a) => n && a.indexOf(n) === i);
  const subText = [R.streets.length > 1 ? names.join(", then ") : [R.street.named, typeLine].filter(Boolean).join(", "), R.site ? `outside ${R.site}` : "", R.street.landmark ? `toward ${R.street.landmark}` : "", [R.time, R.weather].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  const rD = 1.35 * U;
  const dialItems = dials.map(k => {
    const filled = k.strip ? Math.min(k.size, R.used.get(k.id) || 0) : k.filled || 0;
    const count = `${filled} of ${k.size}${k.hidden ? " · hidden" : ""}${k.strip ? "" : " · off the strip"}`;
    return { k, filled, name: k.name, count, w: 2 * rD + 0.6 * U + Math.max(tw(k.name, U, F.key), tw(count, U, F.text)) };
  });
  const groupW = items => items.reduce((s, d) => s + d.w + 1.4 * U, 0) - (items.length ? 1.4 * U : 0);
  const crewD = dialItems.filter(d => d.k.side === "crew"), agD = dialItems.filter(d => d.k.side === "against");
  const stampCode = "CWD-968-" + String(M.hash(R.name + R.district) % 10000).padStart(4, "0"), stampS1 = 1.4 * U;
  const stampW = theme === "casefile" ? Math.max(tw("PURSUIT REPORT", stampS1, "typewriter"), tw("CITY WATCH OF DUSKWALL · " + stampCode, U, "typewriter")) + 1.6 * U : 0;
  const dialsW0 = groupW(crewD) + (crewD.length && agD.length ? 2.4 * U : 0) + groupW(agD);
  const dialsW = dialsW0 + (stampW ? stampW + 2.4 * U : 0);
  const titleLines = M.wrapW(R.name.toUpperCase(), avail - (stampW && stack ? 0 : stampW ? stampW + 2 * U : 0), sTitle, F.title);
  const titleW0 = Math.max(tw(kicker, sKick, F.head, 0.12 * U), ...titleLines.map(l => tw(l, sTitle, F.title)));
  const dialsBeside = !stack && dialItems.length > 0 && titleW0 + 3 * U + dialsW <= avail;
  const subLines = M.wrapW(subText, dialsBeside ? Math.max(avail - dialsW - 3 * U, 20 * U) : avail - (stampW ? stampW + 2 * U : 0), sSub, F.text);
  const titleH = sKick * 1.3 + titleLines.length * sTitle * 0.98 + subLines.length * sSub * 1.3 + 0.2 * U;
  const dialRows = [];
  if (dialItems.length) { let row = [], w = 0; for (const d of dialItems) { if (row.length && w + d.w > avail) { dialRows.push(row); row = []; w = 0; } row.push(d); w += d.w + 1.4 * U; } dialRows.push(row); }
  const dialsH = 1.3 * U + 2 * rD + 0.2 * U;
  const headerH = (dialsBeside ? Math.max(titleH, dialsH) : titleH + (dialItems.length ? 0.6 * U + dialRows.length * (dialsH + 0.4 * U) : 0)) + 1.2 * U;
  // --- note blocks (before the chase, since the last panel, GM notes), at a width ---
  const notes = (title, lines, start) => !lines.length ? null : wd => {
    const items = lines.map((l, i) => ({ n: start != null ? start + i : null, lines: M.wrapW(l, wd - 1.9 * U, U, F.text) }));
    return { title, items, w: wd, h: 1.45 * U + items.reduce((s, it) => s + it.lines.length * U * 1.3 + 0.3 * U, 0) };
  };
  const prelude = notes("BEFORE THE CHASE", R.prelude, null);
  // --- cells: panels as played, then the segments still to fill ---
  let beatN = 0;
  const cells = R.panels.map(p => ({ type: "panel", p, k: stack ? 1 : p.k, beats: p.between.map(t => ({ n: ++beatN, t })) }));
  const pending = notes("SINCE THE LAST PANEL", R.pending, beatN + 1);
  const empties = [];
  for (const k of R.clocks) if (k.strip && !hiddenStrip(k)) for (let s = (R.used.get(k.id) || 0) + 1; s <= k.size; s++) empties.push({ type: "empty", clock: k, n: s, k: 1 });
  const capBlock = (cell, w) => {
    if (cell.type !== "panel") return { h: 0, parts: [] };
    const p = cell.p, parts = [];
    let h = 0.55 * U;
    for (const b of cell.beats) { const ls = M.wrapW(b.t, w - 1.9 * U, U, F.text); parts.push({ kind: "beat", n: b.n, lines: ls, y: h }); h += ls.length * U * 1.28 + 0.2 * U; }
    if (cell.beats.length) h += 0.25 * U;
    if (p.caption) { const ls = M.wrapW(p.caption, w - 0.1 * U, sCap, F.cap); parts.push({ kind: "cap", lines: ls, y: h }); h += ls.length * sCap * 1.16 + 0.25 * U; }
    if (rolls && p.roll) { const ls = M.wrapW(p.roll, w - 0.1 * U, U, F.roll); parts.push({ kind: "roll", lines: ls, y: h }); h += ls.length * U * 1.25 + 0.2 * U; }
    const gmFace = F.text === "text" ? "textBold" : F.text;
    if (!player && p.gm) { const ls = M.wrapW("GM: " + p.gm, w - 0.1 * U, U, gmFace); parts.push({ kind: "gm", lines: ls, y: h }); h += ls.length * U * 1.25 + 0.2 * U; }
    if (!player && p.tie) { const ls = M.wrapW(`Both clocks full (${p.clock.name}, ${p.oppose.clock.name}): the crew escape, but the pursuers are outside the lair (BitD p.16).`, w - 0.1 * U, U, gmFace); parts.push({ kind: "gm", lines: ls, y: h }); h += ls.length * U * 1.25 + 0.2 * U; }
    return { h, parts };
  };
  // --- who is who, at a width ---
  const keyAt = wd => {
    if (!R.shown.length) return null;
    const items = R.shown.map(c => {
      const riders = !player && Array.isArray(c.riders) && c.riders.length ? c.riders.join(", ") : "";
      const lw = tw(c.label, U, F.key), iw = 5.6 * U;
      const want = iw + Math.max(lw, riders ? tw(riders, U, F.text) : 0) + 0.4 * U;
      const w = Math.min(wd, want);
      const lab = M.wrapW(c.label, w - iw, U, F.key), rid = riders ? M.wrapW(riders, w - iw, U, F.text) : [];
      return { c, lab, rid, w, h: Math.max(2.3 * U, (lab.length + rid.length) * U * 1.25 + 0.4 * U) };
    });
    const rows = []; let row = [], x = 0;
    for (const it of items) { if (row.length && x + it.w > wd) { rows.push(row); row = []; x = 0; } row.push(it); x += it.w + 1.4 * U; }
    if (row.length) rows.push(row);
    const legend = ["crew", "against", "neutral"].filter(s => R.shown.some(c => c.side === s));
    return { rows, legend, w: wd, h: 1.45 * U + rows.reduce((s, r) => s + Math.max(...r.map(it => it.h)) + 0.35 * U, 0) };
  };
  const gmLines = player ? [] : R.clocks.filter(k => k.history || k.hidden).map(k => `${k.name}${k.hidden ? " (hidden)" : ""}: ${k.history || "not shown to the players."}`)
    .concat(R.panels.some(p => p.show.some(o => o.state)) ? ["States, speed lines and damage are pictures of what was said at the table, not rules: the book prints no speed or vehicle harm. [interpretation]"] : []);
  const gmNotes = notes("GM NOTES", gmLines, null);
  const asideAt = wd => {
    const parts = [pending && pending(wd), keyAt(wd), gmNotes && gmNotes(wd)].filter(Boolean);
    return { parts, w: wd, h: parts.reduce((s, b) => s + b.h + 0.9 * U, 0) - (parts.length ? 0.9 * U : 0) };
  };
  // --- rows: the biggest slots that fit the page ---
  const allCells = cells.concat(empties);
  const slotsTotal = allCells.reduce((s, c) => s + c.k, 0);
  const preH = prelude ? prelude(avail).h + U : 0;
  let lay;
  if (stack) {
    const rows = [];
    for (const c of cells) rows.push({ cells: [Object.assign({}, c, { w: avail })], artH: avail * 0.76 / Math.pow(c.p.k, 0.8) });
    if (empties.length) { const n = Math.min(5, empties.length), w = (avail - (n - 1) * gap) / n; for (let i = 0; i < empties.length; i += n) rows.push({ cells: empties.slice(i, i + n).map(e => Object.assign({}, e, { w })), artH: w * 0.8 }); }
    for (const r of rows) r.capH = Math.max(0, ...r.cells.map(c => capBlock(c, c.w).h));
    const aside = asideAt(avail);
    lay = { rows, aside, asideBeside: false };
  } else {
    const maxK = allCells.length ? Math.max(...allCells.map(c => c.k)) : 1;
    const top = m + headerH + preH, bottom = m;
    const asideFull = asideAt(avail);
    let best = null;
    for (let cols = Math.max(1, maxK); cols <= Math.max(maxK, Math.min(slotsTotal, 10)); cols++) {
      const slotW = (avail - (cols - 1) * gap) / cols;
      const packed = []; let cur = [], used = 0;
      for (const c of allCells) { if (cur.length && used + c.k > cols) { packed.push(cur); cur = []; used = 0; } cur.push(c); used += c.k; }
      if (cur.length) packed.push(cur);
      for (const r of [1.0, 0.92, 0.84, 0.76, 0.68, 0.6]) {
        const artH = slotW * r;
        for (const beside of [true, false]) {
          let aside = asideFull, asideBeside = false, ok = true;
          const rows = packed.map((rc, ri) => {
            const last = ri === packed.length - 1;
            const base = rc.map(c => c.k * slotW + (c.k - 1) * gap), sum = base.reduce((s, v) => s + v, 0) + (rc.length - 1) * gap;
            let f = Math.min((avail - (rc.length - 1) * gap) / (sum - (rc.length - 1) * gap), 1.34);
            if (last && beside) {
              const free = avail - sum - gap;
              if (free < 15 * U || !asideFull.parts.length) ok = false; else { f = 1; aside = asideAt(free); asideBeside = true; }
            }
            const ws = base.map(v => v * f);
            return { cells: rc.map((c, i) => Object.assign({}, c, { w: ws[i] })), artH, capH: Math.max(0, ...rc.map((c, i) => capBlock(c, ws[i]).h)) };
          });
          if (!ok) continue;
          let total = top + rows.reduce((s, row) => s + row.artH + row.capH, 0) + Math.max(0, rows.length - 1) * rowGap + bottom;
          if (asideBeside) { const lr = rows[rows.length - 1]; total += Math.max(0, aside.h - lr.artH - lr.capH); }
          else if (aside.parts.length) total += (rows.length ? 1.2 * U : 0) + aside.h;
          const fits = !fixedH || total <= fixedH + 0.01;
          const score = fits ? 1e9 + slotW * artH - 0.001 * total : -total;
          if (!best || score > best.score) best = { score, rows, total, fits, aside, asideBeside };
        }
      }
    }
    lay = best || { rows: [], aside: asideFull, asideBeside: false, total: top + asideFull.h + bottom, fits: true };
    if (fixedH && !lay.fits) M.warn(W, `the strip is taller than the ${layoutName} page at the type floor — the page grows to ${Math.round(lay.total)} px (it was ${Math.round(fixedH)})`);
  }
  const rowsH = lay.rows.reduce((s, r) => s + r.artH + r.capH, 0) + Math.max(0, lay.rows.length - 1) * rowGap;
  const lastRow = lay.rows[lay.rows.length - 1];
  const asideExtra = lay.asideBeside ? Math.max(0, lay.aside.h - lastRow.artH - lastRow.capH) : lay.aside.parts.length ? (lay.rows.length ? 1.2 * U : 0) + lay.aside.h : 0;
  const contentH = m + headerH + preH + rowsH + asideExtra + m;
  const PH = fixedH ? Math.max(fixedH, contentH) : contentH;
  let y = m + (fixedH && PH > contentH ? (PH - contentH) / 2 : 0);
  const out = [], defsS = [];
  // --- header ---
  const hp = [];
  hp.push(P.text("ch-kicker", m, N(y + sKick * 0.95), kicker, { size: sKick, anchor: "start" }));
  titleLines.forEach((l, i) => hp.push(P.text("ch-title", m, N(y + sKick * 1.3 + (i + 0.85) * sTitle * 0.98), l, { size: sTitle, anchor: "start" })));
  subLines.forEach((l, i) => hp.push(P.text("ch-sub", m, N(y + sKick * 1.3 + titleLines.length * sTitle * 0.98 + (i + 0.95) * sSub * 1.3), l, { size: sSub, anchor: "start" })));
  const dial = (d, x0, y0) => {
    const k = d.k, cx = x0 + rD, cy = y0 + rD, n = k.size, pcs = [P.circle("ch-dial-bg", N(cx), N(cy), N(rD), { sw: 0.12 * U })];
    const at = i => [cx + Math.sin(i / n * 2 * Math.PI) * rD, cy - Math.cos(i / n * 2 * Math.PI) * rD];
    for (let i = 0; i < d.filled; i++) { const [ax, ay] = at(i), [bx, by] = at(i + 1); pcs.push(P.path(k.side === "crew" ? "ch-dial-crew" : "ch-dial-against", `M${N(cx)} ${N(cy)} L${N(ax)} ${N(ay)} A${N(rD)} ${N(rD)} 0 0 1 ${N(bx)} ${N(by)} Z`)); }
    for (let i = 0; i < n; i++) { const [ax, ay] = at(i); pcs.push(P.line(i < d.filled || (i === d.filled && d.filled === n) || (i === 0 && d.filled) ? "ch-dial-gap" : "ch-dial-tick", N(cx), N(cy), N(ax), N(ay), { sw: 0.1 * U })); }
    if (k.hidden) pcs.push(P.circle("ch-dial-hidden", N(cx), N(cy), N(rD + 0.35 * U), { sw: 0.1 * U }));
    pcs.push(P.text("ch-key", N(x0 + 2 * rD + 0.6 * U), N(cy - 0.15 * U), d.name, { size: U, anchor: "start" }), P.text("ch-key-sub", N(x0 + 2 * rD + 0.6 * U), N(cy + 1.0 * U), d.count, { size: U, anchor: "start" }));
    return pcs;
  };
  const drawGroup = (items, title, x0, y0) => {
    if (!items.length) return x0;
    hp.push(P.text("ch-h", N(x0), N(y0 + U * 0.95), title, { size: U, anchor: "start" }));
    let x = x0;
    for (const d of items) { hp.push(...dial(d, x, y0 + 1.3 * U)); x += d.w + 1.4 * U; }
    return x - 1.4 * U;
  };
  if (dialsBeside) {
    const x0 = PW - m - dialsW0;
    const x1 = drawGroup(crewD, "CREW", x0, y);
    drawGroup(agD, "AGAINST", crewD.length ? x1 + 2.4 * U : x0, y);
  } else if (dialItems.length) {
    let yy = y + titleH + 0.6 * U;
    for (const row of dialRows) {
      const cr = row.filter(d => d.k.side === "crew"), ag = row.filter(d => d.k.side === "against");
      const x1 = drawGroup(cr, "CREW", m, yy);
      drawGroup(ag, "AGAINST", cr.length ? x1 + 2.4 * U : m, yy);
      yy += dialsH + 0.4 * U;
    }
  }
  y += headerH - 0.6 * U;
  hp.push(P.rect("ch-rule", m, N(y), avail, N(Math.max(1, 0.1 * U))));
  y += 0.6 * U;
  out.push(ser(hp));
  // --- note blocks, the key ---
  const drawNotes = (b, x0, y0) => {
    const pcs = [P.text("ch-h", N(x0), N(y0 + U * 0.95), b.title, { size: U, anchor: "start" })];
    let yy = y0 + 1.45 * U;
    for (const it of b.items) {
      if (it.n != null) pcs.push(P.circle("ch-num-bg", N(x0 + 0.65 * U), N(yy + 0.62 * U), N(0.62 * U)), P.text("ch-num", N(x0 + 0.65 * U), N(yy + 0.92 * U), String(it.n), { size: N(0.85 * U), anchor: "middle" }));
      else pcs.push(P.rect("ch-rule", N(x0 + 0.45 * U), N(yy + 0.45 * U), N(0.4 * U), N(0.4 * U)));
      it.lines.forEach((l, i) => pcs.push(P.text("ch-text", N(x0 + 1.8 * U), N(yy + (i + 0.9) * U * 1.3 - 0.2 * U), l, { size: U, anchor: "start" })));
      yy += it.lines.length * U * 1.3 + 0.3 * U;
    }
    out.push(ser(pcs));
  };
  const drawKey = (K_, x0, y0) => {
    const pcs = [P.text("ch-h", N(x0), N(y0 + U * 0.95), "WHO IS WHO", { size: U, anchor: "start" })];
    // what the shapes mean
    let lx = x0 + tw("WHO IS WHO", U, F.head, 0.12 * U) + 1.4 * U;
    for (const s of K_.legend) { pcs.push(...CH.badge(s, "", lx + 0.55 * U, y0 + 0.62 * U, 0.5 * U, U)); pcs.push(P.text("ch-key-sub", N(lx + 1.3 * U), N(y0 + U * 0.95), s, { size: U, anchor: "start" })); lx += 1.3 * U + tw(s, U, F.text) + 1.2 * U; }
    let yy = y0 + 1.45 * U;
    const icons = [];
    for (const row of K_.rows) {
      let x = x0;
      for (const it of row) {
        const c = it.c, def = M.own(CH.TOKENS, c.token), k = Math.min(3.2 * U / (def.L * 1), 1.7 * U / def.H);
        const col = M.own(CH.COLOURS, chLC(c.colour)) ? chLC(c.colour) : /^#[0-9a-f]{6}$/i.test(c.colour || "") ? c.colour : def.colour;
        icons.push(P.g(def.draw({ colour: col, riders: Array.isArray(c.riders) ? Math.max(1, c.riders.length) : undefined }), { tf: { x: N(x + 1.7 * U), y: N(yy + 1.85 * U), s: N(k) } }));
        pcs.push(...CH.badge(c.side, letters.get(c.id) || "?", x + 4.3 * U, yy + 1.1 * U, 0.78 * U, U));
        it.lab.forEach((l, i) => pcs.push(P.text("ch-key", N(x + 5.6 * U), N(yy + 1.45 * U + i * U * 1.25), l, { size: U, anchor: "start" })));
        it.rid.forEach((l, i) => pcs.push(P.text("ch-key-sub", N(x + 5.6 * U), N(yy + 1.45 * U + (it.lab.length + i) * U * 1.25), l, { size: U, anchor: "start" })));
        x += it.w + 1.4 * U;
      }
      yy += Math.max(...row.map(it => it.h)) + 0.35 * U;
    }
    const art0 = painters[R.time].paint, copy = theme === "casefile" ? ` filter="url(#${id}-copy)"` : "";
    out.push(`<g${copy}>${M.toSVG(icons, painters[R.time], null)}${M.toSVG(pcs.filter(q => q.r.startsWith("ch-badge")), painters[R.time], null)}</g>`);
    out.push(M.toSVG(pcs.filter(q => !q.r.startsWith("ch-badge")), { paint: pp }));
  };
  const drawAside = (A_, x0, y0) => {
    let yy = y0;
    for (const b of A_.parts) {
      if (b.rows) drawKey(b, x0, yy);
      else {
        if (b.title === "GM NOTES") out.push(ser([P.rect("ch-gm-box", N(x0 - 0.4 * U), N(yy - 0.3 * U), N(b.w + 0.8 * U), N(b.h + 0.3 * U), { rx: 0.3 * U })]));
        drawNotes(b, x0, yy);
      }
      yy += b.h + 0.9 * U;
    }
  };
  if (prelude) { const b = prelude(avail); drawNotes(b, m, y); y += b.h + U; }
  // --- panels and empty slots ---
  if (theme !== "blueprint") defsS.push(defs(id, { pxft: width / PW, freq: theme === "casefile" ? 0.6 : 0.55, ga: theme === "casefile" ? -1.7 : undefined, dotFill: TOK.ink900, hatchBg: TOK.ink700, hatchFg: TOK.ink500, copy: theme === "casefile", rough: theme === "casefile" ? 0.9 : 0 }));
  else defsS.push(defs(id, { pxft: width / PW, dotFill: "#ffffff", hatchBg: "#1e4d8f", hatchFg: "rgba(255,255,255,0.35)", gr: 1, gg: 1, gb: 1, ga: -2.4, gb2: 1.1, freq: 0.5 }));
  let drawn = 0, slotsDrawn = 0;
  lay.rows.forEach((row, ri) => {
    let x = m;
    for (const cell of row.cells) {
      const w = cell.w, h = row.artH;
      if (cell.type === "empty") {
        const pcs = [P.rect("ch-empty", N(x + 0.1 * U), N(y + 0.1 * U), N(w - 0.2 * U), N(h - 0.2 * U), { sw: 0.12 * U })];
        const ns = Math.min(h * 0.42, 3.6 * U);
        pcs.push(P.text("ch-empty-num", N(x + w / 2), N(y + h / 2 + ns * 0.3), String(cell.n), { size: N(ns), anchor: "middle" }));
        const nm = cell.clock.name.toUpperCase() + (cell.clock.hidden ? " (HIDDEN)" : "");
        const nl = M.wrapW(nm, w - 0.8 * U, U, F.key);
        if (nl.length <= 2 && nl.every(l => tw(l, U, F.key) <= w - 0.6 * U)) nl.forEach((l, i) => pcs.push(P.text("ch-empty-name", N(x + w / 2), N(y + h - 0.7 * U - (nl.length - 1 - i) * 1.2 * U), l, { size: U, anchor: "middle" })));
        out.push(ser(pcs));
        slotsDrawn += 1;
      } else {
        const p = cell.p, s = h / chY.bottom, Wft = w / s, night = p.time === "Night";
        const PS = p.street || R.street;
        const holds = Array.from({ length: p.k }, (_, j) => PS.holds.length ? PS.holds[(p.hold0 + j) % PS.holds.length] : null);
        const A = { W: Wft, k: p.k, n: p.i + 1, ground: PS.ground, night, rng: M.rng(((R.seed >>> 0) ^ M.hash("panel" + p.i)) >>> 0), holds, water: PS.water, U, s, ends: p.ends,
          tokens: new Set(p.show.map(o => o.cast.token)), darkWater: p.fx.some(f => f.name === "dark-water"), show: p.show, fx: p.fx, level: p.level, W_: W,
          rain: /rain|storm|drizzle|shower/i.test(R.weather), fog: /fog|mist|smog|haze/i.test(R.weather) && (night || !/after|snap|night/i.test(R.weather)),
          snow: /snow|sleet|blizzard/i.test(R.weather) && (night || !/after|snap/i.test(R.weather)) };
        const art = CH.art(A);
        // the light a figure gets in this panel (B68Map.chaseLightAt): its time, and its lamps' pools
        if (opts._light) opts._light[p.i] = { night, W: Wft, pools: art.L.light.filter(g => g && g.t === "g" && g.tf).map(g => ({ kind: "lamp", x: +(g.tf.x + 2).toFixed(2), r: 7, color: M.light.MAP.night.pool })) };
        const toks = CH.actors(A, art);
        // the frame's tag and time chip, in feet, so the badges keep off them
        const tagH = 1.5 * U, chips = [], tagY = p.level === "below" ? 0.35 * U : h - 0.35 * U - tagH;
        let tx = 0.35 * U;
        if (p.clock && !hiddenStrip(p.clock)) {
          const segs = p.k > 1 ? `${p.from}–${p.to}` : String(p.from);
          let t = `${p.clock.name.toUpperCase()} ${segs}`;
          if (tw(t, U, F.key, 0.06 * U) > w - 1.6 * U) t = segs;
          const cw = tw(t, U, F.key, 0.06 * U) + 0.9 * U;
          chips.push({ role: p.clock.side === "crew" ? "ch-tag-crew" : "ch-tag-against", text: t, textRole: "ch-tag-text", x: tx, y: tagY, w: cw });
          tx += cw + 0.4 * U;
        }
        if (p.turned) {
          let t = ("Into " + (PS.named || PS.said || PS.typeKey || PS.type || M.own(CH.GROUNDS, PS.ground).street)).toUpperCase();
          while (tw(t, U, F.key, 0.06 * U) + 0.9 * U > w - 0.7 * U && t.length > 8) t = t.slice(0, -2).replace(/\s*…?$/, "") + "…";
          const cw = tw(t, U, F.key, 0.06 * U) + 0.9 * U, down = tx + cw > w - 0.3 * U;
          chips.push({ role: "ch-chip", text: t, textRole: "ch-chip-text", x: down ? 0.35 * U : tx, y: down ? tagY + (p.level === "below" ? 1 : -1) * (tagH + 0.3 * U) : tagY, w: cw });
          if (!down) tx += cw + 0.4 * U;
        }
        if (p.snap) {
          const t = p.time.toUpperCase(), cw = tw(t, U, F.key, 0.06 * U) + 0.9 * U;
          const down = tx + cw > w - 0.3 * U;
          chips.push({ role: "ch-chip", text: t, textRole: "ch-chip-text", x: down ? 0.35 * U : tx, y: down ? tagY + (p.level === "below" ? 1 : -1) * (tagH + 0.3 * U) : tagY, w: cw });
        }
        // badges over everything, at the type floor, clear of the chips and of each other
        const rb = 0.82 * U / s, ts = U / s, badges = [], placed = [];
        const chipFt = chips.map(c => ({ x0: c.x / s, y0: c.y / s, x1: (c.x + c.w) / s, y1: (c.y + tagH) / s })).concat(art.signs);
        for (const t of toks.slice().sort((a, b) => a.x - b.x)) {
          const side = t.level === "below";
          let bx = Math.max(rb * 1.4, Math.min(Wft - rb * 1.4, side ? t.x + t.Lh + rb * 1.6 : t.x)), by = side ? t.y - t.H * 0.6 : Math.max(rb * 1.4 + 0.2, t.top - 1.0 - rb * 1.1);
          const hit = () => chipFt.some(c => bx + rb * 1.3 > c.x0 && bx - rb * 1.3 < c.x1 && by + rb * 1.3 > c.y0 && by - rb * 1.3 < c.y1) || placed.some(q => Math.hypot(q[0] - bx, q[1] - by) < rb * 2.7);
          for (let i = 0; i < 8 && hit(); i++) { if (i % 2 === 0) by += rb * 1.6; else bx += rb * 2.8 * (bx + rb * 4 < Wft ? 1 : -1); }
          placed.push([bx, by]);
          if (!side && Math.hypot(bx - t.x, by - t.top) > rb * 1.6) badges.push(P.line("ch-badge-pole", N(t.x), N(t.top - 0.2), N(bx), N(by), { sw: Math.max(0.12, 0.08 * U / s) }));
          badges.push(...CH.badge(t.side, letters.get(t.id) || "?", bx, by, rb, ts));
        }
        const Lr = art.L, artP = [].concat(Lr.sky, Lr.far, Lr.back, Lr.struct, Lr.surf, Lr.below, Lr.light, Lr.props, Lr.shadow, Lr.tokB, Lr.wet, Lr.tok, Lr.fx, Lr.weather, badges);
        const cid = `${id}-c${p.i}`;
        defsS.push(`<clipPath id="${cid}"><rect x="${N(x)}" y="${N(y)}" width="${N(w)}" height="${N(h)}"/></clipPath>`);
        out.push(`<g clip-path="url(#${cid})"${theme === "casefile" ? ` filter="url(#${id}-copy)"` : ""}><g transform="translate(${N(x)} ${N(y)}) scale(${s.toFixed(4)})">${M.toSVG(artP, painters[p.time], null)}</g>` +
          (opts.grain !== false ? `<rect x="${N(x)}" y="${N(y)}" width="${N(w)}" height="${N(h)}" filter="url(#${id}-grain)" style="mix-blend-mode:${theme === "blueprint" ? "screen" : "multiply"}" opacity="${theme === "casefile" ? 0.4 : theme === "blueprint" ? 0.25 : 0.22}"/>` : "") + `</g>`);
        const pcs = [P.rect("ch-frame", N(x), N(y), N(w), N(h), { sw: 0.16 * U })];
        for (const c of chips) pcs.push(P.rect(c.role, N(x + c.x), N(y + c.y), N(c.w), N(tagH), { rx: 0.2 * U }), P.text(c.textRole, N(x + c.x + c.w / 2), N(y + c.y + tagH / 2 + 0.36 * U), c.text, { size: U, anchor: "middle" }));
        if (stack && p.k > 1) for (let i = 0; i < p.k; i++) pcs.push(P.rect(p.clock && p.clock.side === "against" ? "ch-tag-against" : "ch-tag-crew", N(x + w - (p.k - i) * 0.95 * U - 0.2 * U), N(y + 0.55 * U), N(0.7 * U), N(0.7 * U), { rx: 0.12 * U }));
        // beats: their numbers in the gutter before the panel, their words over the caption
        cell.beats.forEach((b, i) => {
          const gx = x - gap / 2, gy = y + h - 0.9 * U - (cell.beats.length - 1 - i) * 1.45 * U;
          pcs.push(P.circle("ch-num-bg", N(gx), N(gy), N(0.66 * U), { sw: 0.1 * U }), P.text("ch-num", N(gx), N(gy + 0.3 * U), String(b.n), { size: N(0.85 * U), anchor: "middle" }));
        });
        for (const part of capBlock(cell, w).parts) {
          const y0 = y + h + part.y;
          if (part.kind === "beat") {
            pcs.push(P.circle("ch-num-bg", N(x + 0.65 * U), N(y0 + 0.62 * U), N(0.62 * U)), P.text("ch-num", N(x + 0.65 * U), N(y0 + 0.92 * U), String(part.n), { size: N(0.85 * U), anchor: "middle" }));
            part.lines.forEach((l, i) => pcs.push(P.text("ch-beat", N(x + 1.7 * U), N(y0 + (i + 0.95) * U * 1.28 - 0.2 * U), l, { size: U, anchor: "start" })));
          } else if (part.kind === "cap") part.lines.forEach((l, i) => pcs.push(P.text("ch-cap", N(x), N(y0 + (i + 0.82) * sCap * 1.16), l, { size: N(sCap), anchor: "start" })));
          else part.lines.forEach((l, i) => pcs.push(P.text(part.kind === "roll" ? "ch-roll" : "ch-gm", N(x), N(y0 + (i + 0.85) * U * 1.25), l, { size: U, anchor: "start" })));
        }
        out.push(ser(pcs));
        drawn++; slotsDrawn += p.k;
      }
      x += w + gap;
    }
    if (ri === lay.rows.length - 1 && lay.asideBeside) drawAside(lay.aside, x, y);
    y += row.artH + row.capH + (ri < lay.rows.length - 1 ? rowGap : 0);
  });
  if (!lay.asideBeside && lay.aside.parts.length) { y += lay.rows.length ? 1.2 * U : 0; drawAside(lay.aside, m, y); }
  // --- the page's own marks ---
  let marks = "";
  if (theme === "blueprint") marks += `<rect x="${N(0.4 * U)}" y="${N(0.4 * U)}" width="${N(PW - 0.8 * U)}" height="${N(PH - 0.8 * U)}" fill="none" stroke="#f4f6fb" stroke-opacity="0.7" stroke-width="${N(0.1 * U)}"/>`;
  if (theme === "casefile") {
    // the rubber stamp: left of the dials, or top right when the dials are under the title
    const w = stampW, sx = dialsBeside ? PW - m - dialsW0 - 2.4 * U - w / 2 : PW - m - w / 2, sy = m + (fixedH && PH > contentH ? (PH - contentH) / 2 : 0) + 2.2 * U;
    marks += `<g transform="translate(${N(sx)} ${N(sy)}) rotate(-6)" opacity="0.82" filter="url(#${id}-rough)"><rect x="${N(-w / 2)}" y="${N(-2 * U)}" width="${N(w)}" height="${N(3.6 * U)}" fill="none" stroke="#c22f1c" stroke-width="${N(0.22 * U)}"/><text y="${N(-0.2 * U)}" font-family='${FONT.typewriter}' font-weight="700" font-size="${N(stampS1)}" fill="#c22f1c" text-anchor="middle">PURSUIT REPORT</text><text y="${N(1.1 * U)}" font-family='${FONT.typewriter}' font-size="${N(U)}" fill="#c22f1c" text-anchor="middle">CITY WATCH OF DUSKWALL · ${stampCode}</text></g>`;
  }
  const page = theme === "blueprint" ? "#1e4d8f" : theme === "casefile" ? "#f3efe4" : TOK.paper100;
  const toGo = empties.length;
  const title = `${R.name}: chase strip${player ? ", player copy" : ""}`;
  const desc = `${drawn} panel${drawn === 1 ? "" : "s"} drawn${toGo ? `, ${toGo} segment${toGo === 1 ? "" : "s"} still to fill` : ""}, on ${[R.streets.length > 1 ? names.join(", then ") : R.street.named, R.district].filter(Boolean).join(", ") || "the street"}.`;
  const vb = `0 0 ${N(PW)} ${N(PH)}`, height = Math.round(width * PH / PW);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" font-weight="400" font-style="normal" viewBox="${vb}" width="${width}" height="${height}" font-family='${FONT.condensed}' role="img" aria-labelledby="${id}-t ${id}-d"><title id="${id}-t">${M.esc(title)}</title><desc id="${id}-d">${M.esc(desc)}</desc>` +
    `<defs>${defsS.join("")}</defs><rect width="100%" height="100%" fill="${page}"/>${out.join("")}${marks}</svg>`;
  return { svg, width, height, warnings: W, slots: slotsDrawn, drawn, viewBox: vb };
};

// ---- public surface ----
return {
  VERSION: M.VERSION,
  render: M.render,
  key: M.key,
  floors: M.floors,
  printPage: M.printPage,
  presets: M.PRESETS,
  sheet: M.sheet,
  model: (o) => { const W = []; return { model: M.model(o, W), warnings: W }; },
  options: () => ({ views: M.VIEWS.slice(), themes: Object.keys(M.THEMES), layers: ["gm", "player"], bands: M.BANDS.slice(), layouts: Object.keys(M.PRESETS), times: M.street.TIMES.slice(),
    rings: Object.keys(M.layout.STYLE), colours: Object.keys(M.COLOURS), archetypes: Object.keys(M.ARCH), parts: Object.keys(M.PARTS),
    icons: Object.keys(M.ICONS), rooms: Object.keys(M.ROOMS), dressedTargets: Object.keys(M.DRESS),
    streetTypes: Object.keys(M.street.GROUND), streetObstacles: Object.keys(M.street.OBSTACLE), streetProps: Object.keys(M.street.PROP) }),
  parts: M.PARTS, icons: M.ICONS, rooms: M.ROOMS, dress: M.DRESS, colours: M.COLOURS, themes: M.THEMES, archetypes: M.ARCH,
  chase: M.chaseRender, chaseNew: M.chaseNew, chaseTick: M.chaseTick, chaseOptions: M.chaseOptions,
  lightAt: M.lightAt, chaseLightAt: M.chaseLightAt, light: (opt) => M.light.resolve(opt), lightPresets: M.PALETTE.light, palette: M.PALETTE,
  street: { grounds: M.street.GROUND, neighbours: M.street.NEIGHBOUR, uses: M.street.USE, descriptions: M.street.DESC, props: M.street.PROP, obstacles: M.street.OBSTACLE },
  _internal: M
};
}));
