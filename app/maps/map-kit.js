/*! Blades '68 map kit — B68Map. Built 2026-10-14 from src/. Rooms are the book's; geometry is [interpretation]. */
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

M.VERSION = "0.2.0";

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

// --- Text fit ----------------------------------------------------------------
// No DOM in Node, so text is fitted by an average advance per font class.
M.ADVANCE = { condensed: 0.6, text: 0.58, mono: 0.62, typewriter: 0.62, poster: 0.42, script: 0.5 };
M.fitText = (s, maxW, size, cls) => {
  const adv = M.ADVANCE[cls] || 0.55, need = s.length * adv * size;
  return need <= maxW ? size : Math.max(size * 0.45, maxW / (s.length * adv));
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
  return M.ROOMS[key(mix)] || M.ROOMS[key(theme)] || M.ROOMS[name] || null;
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
  "Temple": { "Ballroom": "nave", "Grand foyer": "narthex", "Portrait gallery": "chapel" }
};

// --- The twelve printed colour schemes (p.430) → paint ----------------------
// Two swatches each: a = the field colour, b = the accent. Sampled to sit with
// the design system's own tokens rather than as pure hues.
M.COLOURS = {
  "olive and mustard": ["#6f6c34", "#d6a42c"],
  "orange and brown": ["#d6742c", "#6a3c1e"],
  "turquoise and cream": ["#2e9894", "#efe2c2"],
  "grey and charcoal": ["#9b9891", "#3b3936"],
  "mint green and coral": ["#9ccfb2", "#e4705c"],
  "teal and ochre": ["#2e6c70", "#c88a2e"],
  "ketchup and mustard": ["#bf3a2c", "#dfae2e"],
  "avocado and cream": ["#7e883c", "#ece0bf"],
  "hot pink and orange": ["#cf3a87", "#e5732b"],
  "brown and more brown": ["#7a4b2b", "#4a2c19"],
  "black and white": ["#22201d", "#f1ebdf"],
  "hot pink and lime green": ["#cf3a87", "#a3c43b"]
};

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
  const st = STYLE[model.rings] || STYLE.hard;
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
  walls.push(...G.rectPts(core.O).map((p, i, a) => L.seg(p, a[(i + 1) % 4], st.ring)));

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
    if (items.length === 1) items.push({ room: null, w: items[0].w * 0.9 });   // a passage completes the ring
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
  const front = rings[0].items.find(it => it.room && it.room.ringSide === "bottom") || rings[0].items[0];
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
    if (ring.rin > 0 && items.length === 1) items.push({ room: null, w: items[0].w * 0.9 });
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
  const st = STYLE[model.rings] || STYLE.hard;
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
  return { kind: "plan", levels, rng, st: STYLE[model.rings] || STYLE.hard };
}

// --- Entry points, skips, circulation ---------------------------------------------
// Placed after the rooms, on whichever level the room landed. These are the
// generator's own facts drawn into the building: nothing new is rolled here.
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

L.entries = function (lay, model) {
  const ents = [];
  const lv0 = lay.levels.find(l => l.lvl === 0) || lay.levels[0];
  const findRoom = name => model.rooms.find(r => r.name.toLowerCase() === String(name).toLowerCase());
  const pushEnt = (vec, room, level, p, dir, kind) => ents.push({ vec, room, level, x: p[0], y: p[1], dir, kind });

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
    return { p: [0, O.y + O.h], dir: [0, 1], ang: 0 };
  };

  model.vectors.forEach((v, i) => {
    const kind = i === 0 ? "front" : i === 1 ? "service" : "back";
    if (lay.kind === "rings") {
      let room = null;
      if (kind === "front") room = model.rooms.filter(r => r.ring === 0 && r.ringSide === "bottom").sort((a, b) => b.w - a.w)[0] || model.rooms.find(r => r.ring === 0);
      if (kind === "service") { const m = /through the (.+?)\./i.exec(v.how || ""); room = (m && findRoom(m[1])) || null; }
      if (kind === "back") room = null;
      const ring0 = model.rooms.filter(r => r.ring === 0);
      const frontRoom = model.rooms.filter(r => r.ring === 0 && r.ringSide === "bottom").sort((a, b) => b.w - a.w)[0];
      const sideScore = r => lay.circular ? Math.abs(Math.atan2(Math.sin((r.a0 + r.a1) / 2), Math.cos((r.a0 + r.a1) / 2))) : (r.ringSide === "right" ? 0 : r.ringSide === "left" ? 1 : 2);
      const landing = room && room.ring === 0 && (kind !== "service" || room !== (lay.circular ? ring0.slice().sort((a, b) => b.w - a.w)[0] : frontRoom)) ? room
        : (kind === "service" ? ring0.filter(r => lay.circular ? r !== ring0.slice().sort((a, b) => b.w - a.w)[0] : r.ringSide !== "bottom").sort((a, b) => sideScore(a) - sideScore(b))[0] || ring0[0] : null);
      const e = kind === "back"
        ? (lay.circular ? { p: [0, -lay.rings[0].rout], dir: [0, -1], ang: 0 } : { p: [lay.rings[0].O.x + lay.rings[0].O.w * 0.82, lay.rings[0].O.y], dir: [0, -1], ang: 0 })
        : ringEntry(landing, kind === "service" ? (landing && landing.ringSide === "bottom" ? "bottom" : null) : "bottom");
      if (kind !== "back") lay.levels[0].doors.push({ x: e.p[0], y: e.p[1], ang: e.ang, w: kind === "front" ? 5 : 3.2, kind: kind === "front" ? "ext-double" : "ext", ext: true });
      pushEnt(v, room || landing, lay.levels[0], e.p, e.dir, kind);
      return;
    }
    // Plan view.
    if (lay.levels[0].hub) {     // radial
      const lv = lv0, R = lv.hub.shape.r, a = kind === "front" ? Math.PI / 2 : kind === "service" ? 0 : -Math.PI / 2;
      const p = [Math.cos(a) * R, Math.sin(a) * R];
      if (kind !== "back") lv.doors.push({ x: p[0], y: p[1], ang: a * 180 / Math.PI + 90, w: kind === "front" ? 5 : 3.2, kind: "ext", ext: true });
      if (kind === "front") lv.extras.push({ kind: "bridge", band: "public", shape: { kind: "poly", pts: [[-2.5, R - 0.5], [2.5, R - 0.5], [2.5, lv.bbox.y + lv.bbox.h], [-2.5, lv.bbox.y + lv.bbox.h]] } });
      pushEnt(v, null, lv, p, [Math.cos(a), Math.sin(a)], kind);
      return;
    }
    let room = null, level = lv0, side = null;
    if (kind === "front") {
      const cands = lv0.rooms.concat(lv0.corridor ? [lv0.corridor] : []).filter(r => exteriorSides(lv0, r).some(s => s.side === "bottom"));
      room = lv0.corridor || cands.sort((a, b) => depthOf(a.band) - depthOf(b.band) || b.w - a.w)[0] || lv0.rooms[0];
      side = "bottom";
    } else if (kind === "service") {
      const m = /through the (.+?)\./i.exec(v.how || "");
      room = m && findRoom(m[1]);
      if (room) level = lay.levels.find(l => l.rooms.includes(room)) || lv0;
      const sides = room ? exteriorSides(level, room).filter(s => s.side !== "bottom") : [];
      if (!room || !sides.length) {
        level = lv0;
        room = lv0.rooms.filter(r => depthOf(r.band) >= 1 && exteriorSides(lv0, r).some(s => s.side !== "bottom")).sort((a, b) => depthOf(a.band) - depthOf(b.band))[0]
          || lv0.rooms.find(r => exteriorSides(lv0, r).some(s => s.side !== "bottom")) || lv0.rooms[0];
      }
      side = (exteriorSides(level, room).find(s => s.side === "right") || exteriorSides(level, room).find(s => s.side !== "bottom") || exteriorSides(level, room)[0] || {}).side;
    } else {
      // The back route goes in by whatever circulation the generator rolled for it.
      const how = (v.how || "").toLowerCase();
      if (/skylight/.test(how)) { level = lay.levels.find(l => l.lvl === 2) || lay.levels.find(l => l.lvl === 1) || lv0; }
      else if (/cellar/.test(how)) { level = lay.levels.find(l => l.lvl === -1) || lv0; }
      else if (/balcony|catwalk|ladder|stair/.test(how)) { level = lay.levels.find(l => l.lvl >= 1) || lv0; }
      const pool = level.rooms.filter(r => exteriorSides(level, r).some(s => s.side !== "bottom"));
      room = pool.sort((a, b) => depthOf(b.band) - depthOf(a.band))[0] || level.rooms[0];
      side = (exteriorSides(level, room).find(s => s.side === "left") || exteriorSides(level, room).find(s => s.side === "top") || exteriorSides(level, room)[0] || {}).side;
      if (/skylight/.test(how)) { room.skylight = true; pushEnt(v, room, level, [room.frame.cx, room.frame.cy], [0, 0], kind); return; }
      if (/cellar/.test(how)) room.hatch = true;
    }
    if (!room || !side) { pushEnt(v, room, level, [0, level.bbox.y + level.bbox.h], [0, 1], kind); return; }
    const es = exteriorSides(level, room).find(s => s.side === side);
    const d = doorOn(es.e, 0.5, kind === "front" ? 5 : 3.2, kind === "back" && /secret/.test(v.how || "") ? "secret" : kind === "front" ? "ext-double" : "ext");
    d.ext = true;
    level.doors.push(d);
    pushEnt(v, room, level, [d.x, d.y], OUT[side], kind);
  });
  return ents;
};

// Skips and room circulation, drawn as the thing they are.
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

L.build = function (model, view, rng) {
  const lay = view === "plan" ? planView(model, rng) : (model.rings === "radial" ? ringCircle(model, rng) : ringRect(model, rng));
  if (model.target === "Ship") for (const lv of lay.levels) {
    lv.hull = L.hull(lv.bbox);
    // the site grows to hold the hull
    const hb = lv.hull.bbox;
    lv.siteBox = { x: Math.min(lv.bbox.x, hb.x), y: Math.min(lv.bbox.y, hb.y), w: Math.max(lv.bbox.x + lv.bbox.w, hb.x + hb.w) - Math.min(lv.bbox.x, hb.x), h: Math.max(lv.bbox.y + lv.bbox.h, hb.y + hb.h) - Math.min(lv.bbox.y, hb.y) };
  }
  lay.entries = L.entries(lay, model);
  lay.links = L.links(lay, model);
  for (const lv of lay.levels) lv.walls = L.finishWalls(lv.walls, lv.doors);
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
  const rooms = (o.rooms || []).map((r, i) => {
    if (typeof r === "string") r = { name: r, band: "public" };
    let band = r.band;
    if (!M.BANDS.includes(band)) { M.warn(W, `room "${r.name}": band "${band}" is not one of ${M.BANDS.join(", ")} — drawn as public`); band = "public"; }
    const info = M.roomInfo(r.name, o.themeName, r.mix);
    if (!info) M.warn(W, `room "${r.name}" is not in the catalogue — drawn empty. Add it to M.ROOMS in catalogue.js`);
    const dress = (M.DRESS[o.target] || {})[r.name];
    const arch = dress || (info ? info.arch : "empty");
    return {
      id: "r" + i, n: 0, name: r.name, band, arch, dressed: !!dress,
      w: info ? info.w : 2.5, lvl: info ? info.lvl : 0,
      detail: r.detail || "", mix: r.mix || null,
      isTarget: !!r.isTarget, obstacle: r.obstacle || null, loot: r.loot || null,
      featured: !!r.featured, connects: r.connects || null,
      pairedWith: r.pairedWith || null, holdsAnswerTo: r.holdsAnswerTo || null
    };
  });
  if (!rooms.length) M.warn(W, "no rooms: the location has an empty o.rooms");
  rooms.sort((a, b) => M.BANDS.indexOf(a.band) - M.BANDS.indexOf(b.band));
  rooms.forEach((r, i) => { r.n = i + 1; });

  const styleName = o.styleName || (o.style ? String(o.style).split(".")[0] : null);
  let rings = (o.geometry && o.geometry.rings) || M.GEOMETRY[styleName] || "hard";
  if (!M.layout.STYLE[rings]) { M.warn(W, `geometry.rings "${rings}" is unknown — one of ${Object.keys(M.layout.STYLE).join(", ")}; drawn as hard`); rings = "hard"; }
  const colour = M.COLOURS[o.colour] ? o.colour : null;
  if (o.colour && !colour) M.warn(W, `colour "${o.colour}" is not one of the twelve printed schemes — using grey and charcoal`);

  return {
    name: o.name || "Unnamed location", target: o.target || "", district: o.district || "",
    themeName: o.themeName || "", mixName: o.mixName || null, styleName: styleName || "", rings,
    approach: o.approachName || (o.approach && o.approach.n) || "", gambit: o.approach && o.approach.gambit || "",
    targetWhat: o.targetWhat || "", targetRoom: o.targetRoom || "", colour: colour || "grey and charcoal",
    faction: o.faction || "", factionTier: o.factionTier || 0,
    phys: o.physThreatName ? { name: o.physThreatName, text: o.physThreatText || "" } : null,
    soc: o.socThreatName ? { name: o.socThreatName, text: o.socThreatText || "" } : null,
    vectors: (o.vectors || []).slice(0, 3), skips: o.skips || [], circulation: o.circulation || [],
    pairs: rooms.filter(r => r.pairedWith).map(r => ({ lock: r.name, answer: r.pairedWith })),
    time: o.timeOfDay || "", weather: o.weather || "", street: o.namedStreet || "",
    security: o.security || "", geometryNote: o.geometry && o.geometry.note || "",
    seed: o.seed, rooms
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
  const recipe = M.ARCH[room.arch];
  if (!recipe) M.warn(W, `archetype "${room.arch}" has no recipe in parts.js`);
  const groups = [];
  frames.forEach((f, fi) => {
    if (fi > 0 && Math.max(f.w, f.h) < 11) return;
    // Long thin runs are furnished along their length: rotate the frame so the
    // recipe always sees a landscape room with its "top" against the outer wall.
    let fw = f.w, fh = f.h, rot = f.rot || 0;
    if (fh > fw * 1.15 && !rot) { fw = f.h; fh = f.w; rot = f.side === "left" ? -90 : 90; }
    else if (f.side === "bottom" && !f.rotKeep) rot = 180;
    const R = { x: -fw / 2 + 1.2, y: -fh / 2 + 1.2, w: fw - 2.4, h: fh - 2.4 };
    if (R.w < 3 || R.h < 3) return;
    let pls = recipe ? recipe(R, rng) : [];
    pls = pls.flat().filter(p => p && !p.skip && !(fi > 0 && UNIQUE.has(p.part)));
    if (extraParts && fi === 0) pls = pls.concat(extraParts(R));
    const kids = [];
    for (const pl of pls) {
      const part = M.PARTS[pl.part];
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

// Circulation the generator put in a room (o.rooms[].connects), and the
// back route's skylight or cellar, drawn as real fixtures in that room.
M.circulationParts = room => R => {
  const out = [];
  const add = name => out.push({ part: name, x: R.x + R.w - 3.2, y: R.y + 3.2, rot: 0 });
  if (room.connects && CIRC_PART[room.connects]) {
    const p = CIRC_PART[room.connects];
    if (p === "catwalk") out.push({ part: "catwalk", x: 0, y: 0, rot: R.w >= R.h ? 0 : 90, w: Math.max(R.w, R.h) * 0.9 });
    else if (p === "skylight") out.push({ part: "skylight", x: 0, y: 0, rot: 0 });
    else add(p);
  }
  if (room.skylight && room.connects !== "skylights") out.push({ part: "skylight", x: 0, y: 0 });
  if (room.hatch && room.connects !== "a cellar") out.push({ part: "hatch", x: R.x + 2.5, y: R.y + R.h - 2.5 });
  return out;
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
  const sw = { ext: 1.6, ring: 1.15, int: 0.6, glass: 0.45, soft: 0.35 }[w.t] * (k || 1);
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
  return P.line("wall-" + w.t, w.a[0], w.a[1], w.b[0], w.b[1], { sw });
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

S.level = function (lv, model, ctx) {
  const { rng, W, opts, k } = ctx;
  const reveal = ctx.reveal;
  const known = r => !reveal || reveal.has(r.band);
  const L = { site: [], floors: [], furn: [], walls: [], doors: [], game: [], cover: [], labels: [], entries: [] };

  // --- site and street ---
  const B = lv.bbox, pad = 10, SB = lv.siteBox || B;
  L.site.push(P.rect(lv.hull ? "water-body" : "site", SB.x - pad, SB.y - pad, SB.w + 2 * pad, SB.h + 2 * pad + (lv.lvl === 0 ? 10 : 0)));
  if (lv.hull) L.site.push(P.poly("hull", lv.hull.outer), P.poly("deck", lv.hull.inner));
  if (lv.lvl === 0) {
    L.site.push(P.rect(lv.hull ? "quay" : "street", SB.x - pad, SB.y + SB.h + pad * 0.6, SB.w + 2 * pad, 10));
    const fd = lv.doors.find(d => d.kind === "ext-double"), sx = fd && fd.x < B.x + B.w / 2 ? 0.74 : 0.26;
    if (model.street) L.site.push(P.text("street-label", B.x + B.w * sx, B.y + B.h + pad * 0.6 + 6.6, model.street.replace(/^the /i, "").toUpperCase(), { size: 3.2 * k, anchor: "middle" }));
  }
  if (lv.exterior.kind === "rect") L.site.push(P.rect("footprint", B.x, B.y, B.w, B.h));
  if (lv.exterior.kind === "circle") L.site.push(P.circle("footprint", lv.exterior.cx, lv.exterior.cy, lv.exterior.r));

  // --- floors ---
  for (const e of lv.extras) if (e.shape) L.floors.push(shapePiece(e.kind === "corridor" || e.kind === "bridge" || e.kind === "hub" || e.kind === "core" ? "floor-corridor" : "floor-" + e.band, e.shape));
  for (const r of lv.rooms) if (r.shape) L.floors.push(shapePiece("floor-" + r.band, r.shape, { room: r.id }));
  // the deepest band gets the theme's tone (halftone, hatch …) on top
  for (const r of lv.rooms) if (r.shape && r.band === "secure") L.floors.push(shapePiece("floor-tone", r.shape));

  // --- furniture ---
  for (const r of lv.rooms) {
    if (!r.frame || !known(r)) continue;
    const g = M.furnish(r, rng.fork(r.name), W, M.circulationParts(r));
    if (g) L.furn.push(g);
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
    const target = d.ext ? mid : (d.b && d.b.frame ? [d.b.frame.cx, d.b.frame.cy] : null);
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

  // --- unknown cover (player layer) ---
  if (reveal) {
    for (const r of lv.rooms) if (!known(r) && r.shape) L.cover.push(shapePiece("unknown", r.shape, { grow: 0.5 }));
    for (const e of lv.extras) if (e.shape && e.band && !reveal.has(e.band) && e.kind !== "corridor" && e.kind !== "hub" && e.kind !== "bridge" && e.kind !== "core") L.cover.push(shapePiece("unknown", e.shape, { grow: 0.5 }));
    // the shell is visible from the street — redraw it over the cover
    for (const w of lv.walls) if (w.t === "ext") L.cover.push(S.wallPiece(w, ctx.wallK));
  }

  // --- labels ---
  // Measure every label first, nudge overlapping ones apart, then draw.
  const blocks = [];
  for (const r of lv.rooms) {
    if (!r.frame || !known(r)) continue;
    const [x, y] = r._label;
    const f = r.frame, rot = ((f.rot || 0) % 180 + 180) % 180, across = rot > 45 && rot < 135 ? f.h : f.w;
    const maxW = Math.max(8, Math.min(across, f.w > f.h * 2.5 || f.h > f.w * 2.5 ? Math.max(f.w, f.h) * 0.9 : across) - 2);
    const size = 1.9 * k;
    const lines = M.wrap(r.name.toUpperCase(), Math.max(6, Math.floor(maxW / (size * M.ADVANCE.condensed))));
    const fs = Math.min(size, ...lines.map(l => M.fitText(l, maxW, size, "condensed")));
    const icons = r._icons || [];
    const lh = fs * 1.08, blockH = lines.length * lh + (icons.length ? ik * 1.1 : 0);
    const textW = Math.max(...lines.map(l => l.length * M.ADVANCE.condensed * fs)), bw = 2.3 * k + 0.5;
    const wTot = Math.max(bw + textW + 0.9, icons.length * ik * 1.15);
    blocks.push({ r, x, y, lines, fs, icons, lh, blockH, bw, wTot, textW });
  }
  for (let it = 0; it < 40; it++) {
    let moved = false;
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
      const a = blocks[i], b = blocks[j];
      const ox = (a.wTot + b.wTot) / 2 + 0.6 - Math.abs(a.x - b.x), oy = (a.blockH + b.blockH) / 2 + 0.6 - Math.abs(a.y - b.y);
      if (ox <= 0 || oy <= 0) continue;
      moved = true;
      if (oy < ox) { const d = oy / 2 + 0.05, s = a.y <= b.y ? -1 : 1; a.y += s * d; b.y -= s * d; }
      else { const d = ox / 2 + 0.05, s = a.x <= b.x ? -1 : 1; a.x += s * d; b.x -= s * d; }
    }
    if (!moved) break;
  }
  for (const B of blocks) {
    const { x, y, lines, fs, icons, lh, blockH, bw, textW } = B;
    const wT = bw + textW + 0.9;
    const x0 = x - wT / 2, y0 = y - blockH / 2 + lh * 0.82;
    const kids = [];
    kids.push(P.rect("label-bg", x0 - 0.4, y0 - lh * 0.92, wT + 0.8, lines.length * lh + 0.55, { rx: 0.3 }));
    kids.push(P.circle("num-bg", x0 + 1.1 * k, y0 - lh * 0.92 + lh * 0.5 + 0.12, 1.05 * k));
    kids.push(P.text("num", x0 + 1.1 * k, y0 - lh * 0.92 + lh * 0.5 + 0.12 + 0.42 * k, String(B.r.n), { size: 1.2 * k }));
    lines.forEach((l, i) => kids.push(P.text("label", x0 + bw, y0 + i * lh, l, { size: fs, anchor: "start" })));
    icons.forEach(([name, role], i) => kids.push(M.icon(name, x + (i - (icons.length - 1) / 2) * ik * 1.15, y0 + (lines.length - 1) * lh + ik * 0.95, ik, role)));
    L.labels.push(P.g(kids, { anchor: [x, y], cls: "room-label" }));
    B.r._label = [x, y];
  }
  // One mark per floor for everything unsurveyed — never one per room, which
  // would tell the players how many rooms they haven't found.
  if (reveal) {
    const hid = lv.rooms.filter(r => r.frame && !known(r));
    if (hid.length) {
      const deepest = hid.reduce((a, r) => M.BANDS.indexOf(r.band) > M.BANDS.indexOf(a.band) ? r : a, hid[0]);
      const [x, y] = centroidOf(deepest);
      L.labels.push(P.text("label-unknown", x, y + 1.2 * k, "UNSURVEYED", { size: 3 * k }));
    }
  }
  // a floor's core is labelled for what it is
  if (lv.core && lv.core.frame && lv.core.shape.kind !== "circle") L.labels.push(P.text("label-sm", lv.core.frame.cx, lv.core.frame.cy + lv.core.frame.h / 2 - 1.4, "STAIRS · LIFT", { size: M.fitText("STAIRS · LIFT", lv.core.frame.w - 2, 1.3 * k, "condensed") }));
  return L;
};

// Links between rooms on the same floor: answers (lock ← key) and skips.
S.links = function (lay, ctx) {
  const out = [];
  const { k, opts } = ctx;
  if (opts.layer === "player") return out;
  const pos = (r, lv) => ctx.toScreen(lv, r.frame.cx, r.frame.cy, "room");
  for (const l of lay.links) {
    if (l.vertical && !ctx.linkAcross) {
      // Floors are separate sheets: a link between floors is a tag in each
      // room naming the other end, never a line across the page.
      if (l.kind === "pair") continue;
      for (const [r, lv, other, dir] of [[l.a, l.la, l.b, "to"], [l.b, l.lb, l.a, "from"]]) {
        const [x, y] = pos(r, lv), t = `↕ ${dir} ${other.n} · ${l.via}`;
        const w = t.length * M.ADVANCE.condensed * 1.35 * k + 1.6 * k, yy = y + r.frame.h * 0.32;
        out.push(P.rect("ov-skip-tag", x - w / 2, yy - 1.5 * k, w, 2.2 * k, { rx: 0.4 }));
        out.push(P.text("ov-skip-tagtext", x, yy, t, { size: 1.35 * k }));
      }
      continue;
    }
    const a = pos(l.a, l.la), b = pos(l.b, l.lb);
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const bend = (l.kind === "pair" ? 0.18 : 0.1) * len, mx = (a[0] + b[0]) / 2 - dy / len * bend, my = (a[1] + b[1]) / 2 + dx / len * bend;
    const sh = 3.2 * k, ex = b[0] - dx / len * sh, ey = b[1] - dy / len * sh;
    out.push(P.path(l.kind === "pair" ? "ov-pair-line" : "ov-skip-line", `M${a[0]} ${a[1]} Q${mx} ${my} ${ex} ${ey}`, { sw: (l.kind === "pair" ? 0.45 : 0.75) * k }));
    // arrowhead at the lock / destination
    const tx = ex - mx, ty = ey - my, tl = Math.hypot(tx, ty) || 1, ux = tx / tl, uy = ty / tl, s = 1.4 * k;
    out.push(P.poly(l.kind === "pair" ? "ov-pair-head" : "ov-skip-head", [[ex + ux * s, ey + uy * s], [ex - uy * s * 0.7, ey + ux * s * 0.7], [ex + uy * s * 0.7, ey - ux * s * 0.7]]));
    if (l.kind === "skip" && l.via) out.push(P.text("ov-skip-label", mx, my - 0.8 * k, l.via, { size: 1.4 * k }));
  }
  return out;
};

// The three ways in: an arrow from outside onto the door, and a tag.
S.entries = function (lay, ctx) {
  const out = [], { k, opts } = ctx, player = opts.layer === "player";
  const KIND = { front: "ov-front", service: "ov-service", back: "ov-back" };
  for (const e of lay.entries) {
    const know = e.vec && e.vec.know || "";
    if (player && /can't be known/.test(know)) continue;
    const [x, y] = ctx.toScreen(e.level, e.x, e.y, "floor");
    const role = KIND[e.kind];
    const [dx, dy] = e.dir[0] || e.dir[1] ? ctx.dirScreen(e.dir) : [0, -1];
    const L0 = 9 * k, sx = x + dx * L0, sy = y + dy * L0;
    const dashed = player && /question/.test(know);
    if (e.dir[0] || e.dir[1]) {
      out.push(P.line(role + "-line", sx, sy, x + dx * 1.8, y + dy * 1.8, { sw: 0.7 * k, dash: dashed }));
      const s = 1.6 * k;
      out.push(P.poly(role + "-head", [[x + dx * 0.6, y + dy * 0.6], [x + dx * (0.6 + s * 1.4) - dy * s, y + dy * (0.6 + s * 1.4) + dx * s], [x + dx * (0.6 + s * 1.4) + dy * s, y + dy * (0.6 + s * 1.4) - dx * s]]));
    }
    const tag = (e.vec && e.vec.n || e.kind).toUpperCase();
    const tx = e.dir[0] || e.dir[1] ? sx + dx * 2.6 * k : x, ty = e.dir[0] || e.dir[1] ? sy + dy * 2.6 * k + (dy ? 0 : 0.6 * k) : y - 4 * k;
    const anchor = dx > 0.5 ? "start" : dx < -0.5 ? "end" : "middle";
    const w = tag.length * (M.ADVANCE.condensed * 1.7 * k + 0.2) + 2 * k;      // + letter-spacing
    const bx = anchor === "start" ? tx - 0.8 * k : anchor === "end" ? tx - w + 0.8 * k : tx - w / 2;
    out.push(P.rect(role + "-tag", bx, ty - 1.7 * k, w, 2.5 * k, { rx: 0.4 }));
    out.push(P.text(role + "-text", anchor === "middle" ? tx : anchor === "start" ? tx + 0.2 * k : tx - 0.2 * k, ty, tag, { size: 1.7 * k, anchor }));
    out.push(M.icon(/free/.test(know) ? "eye" : /question/.test(know) ? "question" : "lock", anchor === "end" ? bx - 1.8 * k : bx + w + 1.8 * k, ty - 0.45 * k, 2.2 * k, role));
  }
  return out;
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
// The projection is the 2:1 isometric of a 30° axonometric:
//   screen x = (x − y) · cos 30°,  screen y = (x + y) · sin 30° − z

const ISO = M.iso = {};
const IC = Math.cos(Math.PI / 6), IS = 0.5;
const WALL_H = { ext: 7, ring: 5, int: 5, glass: 4.5, soft: 3 }, CUT_H = 2.4;

ISO.proj = (x, y, z) => [(x - y) * IC, (x + y) * IS - z];

// Point in a room's shape (rect polygon or circle), for the player cover.
function inside(shape, x, y) {
  if (!shape) return false;
  if (shape.kind === "circle") return Math.hypot(x - shape.cx, y - shape.cy) <= shape.r;
  let c = false;
  const p = shape.pts;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
}

// Each wall becomes a box: its viewer-facing side, its viewer-facing end, and
// its top. Exterior walls on the two near sides are cut down so the rooms read.
function wallBoxes(lv, P0, hiddenAt) {
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
  const boxes = [];
  for (const s of segs) {
    const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1], len = Math.hypot(dx, dy);
    if (len < 0.05) continue;
    let nx = -dy / len, ny = dx / len;
    const th = { ext: 1.6, ring: 1.15, int: 0.6, glass: 0.45, soft: 0.35 }[s.t] || 0.6;
    const mx = (s.a[0] + s.b[0]) / 2, my = (s.a[1] + s.b[1]) / 2;
    // Player cover: a wall with hidden rooms on both sides isn't drawn at all.
    if (hiddenAt && s.t !== "ext") {
      const h1 = hiddenAt(mx + nx * 1.2, my + ny * 1.2), h2 = hiddenAt(mx - nx * 1.2, my - ny * 1.2);
      if (h1 !== false && h2 !== false) continue;
    }
    let h = WALL_H[s.t] || 5;
    if (s.t === "ext") {
      // outward = away from the floor's centre (or the pod's centre for arcs)
      const ocx = s.arc ? s.arc.cx : cx, ocy = s.arc ? s.arc.cy : cy;
      const out = (mx - ocx) * nx + (my - ocy) * ny > 0 ? 1 : -1;
      if ((nx * out + ny * out) > 0.05) h = CUT_H;
    }
    if (nx + ny < 0) { nx = -nx; ny = -ny; }                 // the face the viewer sees
    const o = th / 2;
    const A = [s.a[0] + nx * o, s.a[1] + ny * o], B = [s.b[0] + nx * o, s.b[1] + ny * o];
    const A2 = [s.a[0] - nx * o, s.a[1] - ny * o], B2 = [s.b[0] - nx * o, s.b[1] - ny * o];
    const pts = [];
    pts.push(P.poly("wallf-" + s.t, [P0(A, 0), P0(B, 0), P0(B, h), P0(A, h)]));
    const endB = dx + dy > 0;                                  // which end faces the viewer
    const E1 = endB ? B : A, E2 = endB ? B2 : A2;
    pts.push(P.poly("walle-" + s.t, [P0(E1, 0), P0(E2, 0), P0(E2, h), P0(E1, h)]));
    pts.push(P.poly("wallt-" + s.t, [P0(A, h), P0(B, h), P0(B2, h), P0(A2, h)]));
    boxes.push({ key: mx + my, pieces: pts });
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
  const toScreen = (lv, x, y, kind) => {
    const [sx, sy] = shift.get(lv) || [0, 0];
    return ISO.proj(x + sx, y + sy, (zOf.get(lv) || 0) + (typeof kind === "number" ? kind : (lift[kind] || 0)));
  };
  const dirScreen = d => { const x = (d[0] - d[1]) * IC, y = (d[0] + d[1]) * IS, l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  ctx.toScreen = toScreen; ctx.dirScreen = dirScreen; ctx.linkAcross = true;   // floors are stacked: links between them are real lines

  const parts = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
  // Draw the top floor last so it sits over the one below.
  for (const lv of order) {
    const [sx, sy] = shift.get(lv), zz = zOf.get(lv);
    const mat = `matrix(${IC.toFixed(5)} ${IS} ${(-IC).toFixed(5)} ${IS} ${(IC * (sx - sy)).toFixed(3)} ${(IS * (sx + sy) - zz).toFixed(3)})`;
    const layers = M.scene.level(lv, model, ctx);
    const P0 = (p, h) => toScreen(lv, p[0], p[1], h);
    // The player cover goes under the walls here, not over them.
    let hiddenAt = null;
    if (ctx.reveal) {
      const shapes = lv.rooms.map(r => ({ r, s: r.shape, hid: !ctx.reveal.has(r.band) })).concat(lv.extras.filter(e => e.shape).map(e => ({ r: e, s: e.shape, hid: e.band && !ctx.reveal.has(e.band) && !["corridor", "hub", "bridge", "core"].includes(e.kind) })));
      hiddenAt = (x, y) => { const f = shapes.find(q => inside(q.s, x, y)); return f ? (f.hid ? true : false) : null; };
      layers.floors = layers.floors.concat(layers.cover.filter(p => p.r === "unknown"));
      layers.cover = [];
    }
    // Floor slab: the two near edges, extruded down.
    const slab = [], d = 1.6;
    if (lv.exterior.kind === "rect" || lv.exterior.kind === "hull") {
      const B = lv.bbox, c = G.rectPts(B);
      slab.push(P.poly("slab", [P0(c[2], 0), P0(c[3], 0), P0(c[3], -d), P0(c[2], -d)]), P.poly("slab-side", [P0(c[1], 0), P0(c[2], 0), P0(c[2], -d), P0(c[1], -d)]));
    } else {
      const pts = [];
      const r = lv.exterior.kind === "hub" ? lv.exterior.r : lv.exterior.r, ccx = lv.exterior.cx || 0, ccy = lv.exterior.cy || 0;
      for (let a = -Math.PI / 4; a <= Math.PI * 0.75 + 0.01; a += Math.PI / 24) pts.push([ccx + Math.cos(a) * r, ccy + Math.sin(a) * r]);
      slab.push(P.poly("slab", pts.map(p => P0(p, 0)).concat(pts.slice().reverse().map(p => P0(p, -d)))));
    }
    // Upper floors float: no ground, no street.
    if (lv.lvl !== 0) layers.site = layers.site.filter(p => ["footprint", "hull", "deck"].includes(p.r));
    const walls = slab.concat(wallBoxes(lv, P0, hiddenAt));
    layers.walls = walls;
    // Icons and labels upright, at head height above their floor.
    const lifted = [];
    layers.game = layers.game.filter(p => { if (p.t === "g" && /icon/.test(p.cls || "")) { lifted.push(p); return false; } return true; });
    layers.labels = upright(lifted.concat(layers.labels), lv, toScreen, lift.label);
    // A floor's title sits off its left corner.
    layers.labels = layers.labels.map(p => p.r === "level-title" ? Object.assign({}, p, { x: P0([lv.bbox.x, lv.bbox.y + lv.bbox.h], 0)[0] - 4 * k, y: P0([lv.bbox.x, lv.bbox.y + lv.bbox.h], 0)[1], anchor: "end" }) : p);
    parts.push({ lv, layers, tf: { x: 0, y: 0 }, tfs: { site: mat, floors: mat, furn: `translate(0 -0.9) ${mat}`, doors: mat, game: mat, cover: mat } });
    // bounds: the footprint at floor level and wall top
    const SB = lv.siteBox || lv.bbox;
    const c = lv.exterior.kind === "circle" || lv.exterior.kind === "hub" ? G.rectPts(SB) : G.rectPts({ x: SB.x - 10, y: SB.y - 10, w: SB.w + 20, h: SB.h + 20 + (lv.lvl === 0 ? 10 : 0) });
    for (const p of c) { const q = P0(p, 0); grow(q[0], q[1]); const r = P0(p, 9); grow(r[0], r[1]); }
    const t = P0([lv.bbox.x, lv.bbox.y + lv.bbox.h], 0); grow(t[0] - 4 * k - (lv.title || "").length * 3.4 * k * 0.42, t[1]);
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
  "ladder": () => sv.ladder(FLOOR_H), "skylight": () => [P.poly("fxglow", [[-3, -FLOOR_H], [3, -FLOOR_H], [5, 0], [-5, 0]], { opacity: 0.35 })], "hatch": () => [P.rect("fx3", -1.5, -0.2, 3, 0.4), P.rect("fxm", -1.5, -1.6, 0.25, 1.6, { tf: { rot: -30 } })], "catwalk": w => [P.rect("fxm", -Math.min(w, 14) / 2, -9, Math.min(w, 14), 0.4), P.rect("fxm", -Math.min(w, 14) / 2, -11.5, Math.min(w, 14), 0.15)],
  "orb": w => [P.circle("fxglow", 0, -6, (w || 2) / 2, { opacity: 0.9 })], "flame": () => [P.path("fxglow", "M0 -4 C1.2 -2.6 1.6 -1.6 1.4 -0.8 C1.2 0 -1.2 0 -1.4 -0.8 C-1.6 -1.6 -0.8 -2.4 0 -4 Z"), P.rect("fx3", -1.4, -0.3, 2.8, 0.3)], "snow": w => [P.ellipse("fxl", 0, 0, Math.min(w, 8) / 2, 1.6)],
  "void": w => [P.ellipse("fx3", 0, -FLOOR_H / 2, Math.min(w, 10) / 2, FLOOR_H / 2 - 1), P.ellipse("fxglow", 0, -FLOOR_H / 2, Math.min(w, 10) / 3, FLOOR_H / 3, { opacity: 0.3 })], "doorframe": () => [P.rect("fx3", -1.8, -7, 0.4, 7), P.rect("fx3", 1.4, -7, 0.4, 7), P.rect("fx3", -1.8, -7.4, 3.6, 0.4), P.rect("fxg", -1.4, -7, 2.8, 7, { opacity: 0.5 })]
};
SEC.SIDE = SIDE;

// --- Build ---------------------------------------------------------------------------
SEC.build = function (lay, model, ctx) {
  // Type in a section is sized to the floor height, not the footprint.
  const k = ctx.k = Math.min(ctx.k, 1.15), { rng } = ctx, st = model.rings;
  const reveal = ctx.reveal, known = r => !reveal || reveal.has(r.band);
  const levels = lay.levels.slice().sort((a, b) => b.lvl - a.lvl);           // top first
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
    if (model.street) Ls.site.push(P.text("street-label", L - ext / 2 - 6, 3.6, model.street.replace(/^the /i, "").toUpperCase(), { size: 1.4 * k }));
    Ls.walls.push(P.rect("roof", L + Wb * 0.55, top - slabT - 9, 4, 9), P.rect("roof", L + Wb * 0.55 - 0.5, top - slabT - 10, 5, 1.2));
    Ls.cover.push(P.rect("water-front", L - ext - 10, 0, Wb + 2 * ext + 30, bot + 12));
  } else {
    Ls.site.push(P.rect("earth", L - ext - 8, 0, Wb + 2 * ext + 16, bot + 7));
    Ls.site.push(P.rect("street", L - ext - 8, -0.6, ext + 8, 0.8));
    if (model.street) Ls.site.push(P.text("street-label", L - ext / 2 - 4, 3.2, model.street.replace(/^the /i, "").toUpperCase(), { size: 1.6 * k }));
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
      const role = b.core || b.passage ? "floor-corridor" : "floor-" + b.r.band, sh = boxShape(b);
      Ls.floors.push(sh.t === "path" ? P.path(role, sh.d) : P.rect(role, b.x, y0, b.w, y1 - y0));
      if (b.r && b.r.band === "secure") Ls.floors.push(sh.t === "path" ? P.path("floor-tone", sh.d) : P.rect("floor-tone", b.x, y0, b.w, y1 - y0));
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
      const recipe = M.ARCH[b.r.arch];
      let pls = recipe ? recipe(R, rng.fork(b.r.name)).flat().filter(p => p && !p.skip) : [];
      pls = pls.concat(M.circulationParts(b.r)(R));
      pls.sort((p, q) => p.y - q.y);                                           // back of the room first
      const kids = [], used = [];
      for (const pl of pls) {
        const fn = SIDE[pl.part];
        if (!fn) continue;
        const fx = b.x + 1.2 + (pl.x - R.x) / (R.w || 1) * (b.w - 2.4);
        const w = Math.min((pl.w || (M.PARTS[pl.part] ? M.PARTS[pl.part].size[0] : 3)), b.w - 2.4);
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
    Ls.labels.push(P.text("level-title", L + RW + 2.4, y0 + 2.6 * k * 0.9, (lv.title || "").toUpperCase(), { size: 2.2 * k, anchor: "start" }));
  }
  // --- labels and the game layer ---
  const gm = ctx.opts.layer !== "player", ik = 2.2 * k;
  for (const row of rows) for (const b of row.boxes) {
    if (!b.r) continue;
    const r = b.r, [cx] = pos.get(r);
    if (!known(r)) continue;
    const size = 1.6 * k, maxW = b.w - 1.2;
    const lines = M.wrap(r.name.toUpperCase(), Math.max(6, Math.floor(maxW / (size * M.ADVANCE.condensed))));
    const fs = Math.min(size, ...lines.map(l => M.fitText(l, maxW, size, "condensed"))), lh = fs * 1.08;
    const textW = Math.max(...lines.map(l => l.length * M.ADVANCE.condensed * fs)), bw = 2.3 * k * 0.85 + 0.5, wT = bw + textW + 0.9;
    const x0 = cx - wT / 2, y0 = row.y0 + 1 + lh;
    const kids = [P.rect("label-bg", x0 - 0.4, y0 - lh * 0.92, wT + 0.8, lines.length * lh + 0.55, { rx: 0.3 }),
      P.circle("num-bg", x0 + 0.95 * k, y0 - lh * 0.92 + lh * 0.5 + 0.12, 0.9 * k), P.text("num", x0 + 0.95 * k, y0 - lh * 0.92 + lh * 0.5 + 0.12 + 0.36 * k, String(r.n), { size: 1.05 * k })];
    lines.forEach((l, i) => kids.push(P.text("label", x0 + bw, y0 + i * lh, l, { size: fs, anchor: "start" })));
    if (gm) {
      const icons = [r.isTarget && ["star", "ov-target"], r.obstacle && [M.obstacleIcon(r.obstacle), "ov-lock"], r.holdsAnswerTo && ["key", "ov-pair"], r.loot && r.featured && ["loot", "ov-loot"]].filter(Boolean);
      icons.forEach(([nm, role], i) => kids.push(M.icon(nm, cx + (i - (icons.length - 1) / 2) * ik * 1.15, y0 + (lines.length - 1) * lh + ik * 0.95, ik, role)));
      if (r.isTarget) Ls.game.unshift(P.rect("ov-target-area", b.x, row.y0, b.w, row.y1 - row.y0));
    }
    Ls.labels.push(P.g(kids, { cls: "room-label" }));
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
    const curve = (a, b, role, sw, label) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1, bend = 0.16 * len;
      const mx = (a[0] + b[0]) / 2 - dy / len * bend, my = (a[1] + b[1]) / 2 + dx / len * bend;
      const sh = 2.6 * k, ex = b[0] - dx / len * sh, ey = b[1] - dy / len * sh;
      links.push(P.path(role + "-line", `M${a[0]} ${a[1]} Q${mx} ${my} ${ex} ${ey}`, { sw: sw * k }));
      const tx = ex - mx, ty = ey - my, tl = Math.hypot(tx, ty) || 1, ux = tx / tl, uy = ty / tl, s = 1.3 * k;
      links.push(P.poly(role + "-head", [[ex + ux * s, ey + uy * s], [ex - uy * s * 0.7, ey + ux * s * 0.7], [ex + uy * s * 0.7, ey - ux * s * 0.7]]));
      if (label) links.push(P.text("ov-skip-label", mx, my - 0.6 * k, label, { size: 1.3 * k }));
    };
    const mid = r => { const p = pos.get(r), row = rows.find(rw => rw.boxes.some(b => b.r === r)); return [p[0], (row.y0 + row.y1) / 2 + 2]; };
    for (const p of model.pairs) { const a = byName(p.answer), b = byName(p.lock); if (a && b && pos.has(a) && pos.has(b)) curve(mid(a), mid(b), "ov-pair", 0.4); }
    for (const s of model.skips) { const a = byName(s.from), b = byName(s.to); if (a && b && pos.has(a) && pos.has(b)) curve(mid(a), mid(b), "ov-skip", 0.7, (a.lvl !== b.lvl ? "↕ " : "") + s.via); }
  }
  // --- entries: the street on the left, the roof above, the earth below ---
  const ground = rows.find(r => r.lv.lvl === 0) || rows[rows.length - 1];
  const firstIn = row => row.boxes.filter(b => b.r || b.passage || b.core).sort((a, b) => a.x - b.x)[0];
  const fake = [], secEntry = {};
  model.vectors.forEach((v, i) => {
    const kind = ["front", "service", "back"][i], how = (v.how || "").toLowerCase();
    let x, y, dir;
    if (kind === "front") { x = L; y = ground.y1 - 3.6; dir = [-1, 0]; Ls.doors.push(P.rect("door-gap", L - 0.9, ground.y1 - 7.2, 1.8, 7.2)); }
    else if (kind === "service") {
      const m = /through the (.+?)\./i.exec(v.how || ""), r = m && model.rooms.find(q => q.name.toLowerCase() === m[1].toLowerCase());
      const row = r ? rows.find(rw => rw.boxes.some(b => b.r === r)) : ground;
      x = L + row.RW; y = row.y1 - 3.6; dir = [1, 0];
      Ls.doors.push(P.rect("door-gap", x - 0.9, row.y1 - 7.2, 1.8, 7.2));
    } else if (/skylight/.test(how)) {
      const r = model.rooms.filter(q => pos.has(q) && q.lvl === topRow.lv.lvl).sort((a, b) => M.BANDS.indexOf(b.band) - M.BANDS.indexOf(a.band))[0];
      x = r ? pos.get(r)[0] : L + rTop / 2; y = top - slabT; dir = [0, -1];
      Ls.doors.push(P.rect("skylight-sec", x - 3, top - slabT - 0.2, 6, slabT + 0.4));
    } else if (/cellar/.test(how)) {
      const low = rows[rows.length - 1];
      x = L - 4; y = low.y1 - 2; dir = [-1, 0.6];
    } else {
      const row = rows.length > 1 ? rows[0] : ground;
      x = L + row.RW; y = row.y1 - 3.6; dir = [1, 0];
    }
    secEntry[kind] = [x, y];
    fake.push({ vec: v, kind, level: "sec", x, y, dir });
  });
  const ctx2 = Object.assign({}, ctx, { toScreen: (lv, x, y) => [x, y], dirScreen: d => { const l = Math.hypot(d[0], d[1]) || 1; return [d[0] / l, d[1] / l]; } });
  const entries = M.scene.entries({ entries: fake }, ctx2);
  // --- player cover ---
  if (reveal) {
    for (const row of rows) {
      const hid = row.boxes.filter(b => b.r && !known(b.r));
      for (const b of hid) Ls.cover.push(P.rect("unknown", b.x - 0.2, row.y0, b.w + 0.4, row.y1 - row.y0));
      if (hid.length) { const b = hid[Math.floor(hid.length / 2)]; Ls.labels.push(P.text("label-unknown", b.x + b.w / 2, (row.y0 + row.y1) / 2 + 1, "UNSURVEYED", { size: 1.9 * k })); }
    }
  }
  // positions for tokens and the board
  const rowOf = new Map(rows.map(r => [r.lv, r]));
  ctx.toScreen = (lv, x, y) => {
    for (const r of lv.rooms) if (r.frame && Math.abs(r.frame.cx - x) < 0.01 && Math.abs(r.frame.cy - y) < 0.01 && pos.has(r)) return pos.get(r);
    for (const e of lay.entries) if (e.level === lv && Math.abs(e.x - x) < 0.01 && Math.abs(e.y - y) < 0.01) return secEntry[e.kind] || [L, 0];
    const row = rowOf.get(lv); return row ? [L + row.RW / 2, (row.y0 + row.y1) / 2] : [L, 0];
  };
  ctx.dirScreen = d => d;
  const minY = Math.min(top - slabT - 20, ...entries.filter(p => p.t === "rect").map(p => p.y));
  const maxY = bot + 8 + (ship ? 4 : 0);
  let minX = L - ext - 12, maxX = L + Wb + ext + 10 + 16 * k + (ship ? Math.max(14, Wb * 0.18) : 0);
  for (const p of entries) if (p.t === "rect") { minX = Math.min(minX, p.x - 4 * k); maxX = Math.max(maxX, p.x + p.w + 4 * k); }
  return { parts: [{ lv: levels[0], layers: Ls, tf: { x: 0, y: 0 } }], bounds: { minX, minY, maxX, maxY }, entries, links };
};

// ---- src/render.js ----
// =============================================================================
// render — the public API
// =============================================================================
//   B68Map.render(o, opts) → { svg, width, height, warnings, model, layout }
//
//   o      the vault generator's location object (generate()'s return value)
//   opts   view    "rings" (default) | "plan" | "iso" | "section"
//          theme   "rulebook" (default) | "blueprint" | "casefile" | "board"
//          layer   "gm" (default) | "player"
//          reveal  bands the player layer shows, default ["public"]. Pass the
//                  bands the crew has opened, as the card's band headers open.
//          seed    layout seed; defaults to o.seed, then a hash of the name,
//                  so the same roll always draws the same building
//          width   output width in px (default 1400); height follows
//          legend  false drops the side panel
//          tokens  [{ room, svg, label }] — figure-kit portraits (or any SVG)
//                  pinned into rooms; on the board theme they become polaroids
//          figures { kit: B68Figure, cast: [{ room, spec, label }] } — the kit
//                  renders portraits itself (K.portrait(spec))
//          grain   false switches texture off (faster in big batches)

M.VIEWS = ["rings", "plan", "iso", "section"];

M.render = function (o, opts = {}) {
  const W = [];
  opts = Object.assign({ view: "rings", theme: "rulebook", layer: "gm", width: 1400, legend: true }, opts);
  if (!M.VIEWS.includes(opts.view)) { M.warn(W, `view "${opts.view}" is not one of ${M.VIEWS.join(", ")} — drawing rings`); opts.view = "rings"; }
  const theme = M.THEMES[opts.theme];
  if (!theme) throw new Error(`B68Map: theme "${opts.theme}" is not one of ${Object.keys(M.THEMES).join(", ")}`);
  const model = M.model(o, W);
  const seed = opts.seed != null ? opts.seed : (o.seed != null ? o.seed : M.hash(model.name + model.district));
  const rng = M.rng(seed);
  // iso and section are drawn from the floor plan, so all three agree.
  const lay = M.layout.build(model, opts.view === "rings" ? "rings" : "plan", rng.fork("layout"));

  // Overlay scale: icons and type grow with the drawing so they read at any size.
  // Sized off the biggest single floor, not the whole sheet, so a three-floor
  // plan doesn't get poster-sized type over small rooms.
  const dim = Math.max(...lay.levels.map(l => { const B = l.siteBox || l.bbox; return Math.max(B.w, B.h); }));
  let k = Math.min(2.4, Math.max(1, dim / 92));
  // …but never so small that a room name drops under ~11 px on the page.
  const n0 = lay.levels.length, estW = (n0 <= 1 ? dim : 2 * dim + 40) * 1.5;
  k = Math.max(k, Math.min(3, 11 / (1.9 * ((opts.width || 1400) / estW))));
  const reveal = opts.layer === "player" ? new Set(opts.reveal || ["public"]) : null;
  const ctx = { rng: rng.fork("dress"), W, opts, k, reveal, wallK: 1 };

  if (opts.view === "iso" || opts.view === "section") return M.renderProjected(o, opts, { W, theme, model, seed, rng, lay, k, reveal, ctx });

  // Floors in a grid that lands near a 1.4 : 1 sheet — one row for two floors,
  // two columns for three or four. A title sits above each floor.
  const offsets = new Map(), titleH = lay.levels.length > 1 ? 7 * k : 0, gap = 26 + 16 * k;
  const n = lay.levels.length, cols = n <= 2 ? n : 2, rows = Math.ceil(n / cols);
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
    if (lv.title && n > 1) layers.labels.push(P.text("level-title", lv.bbox.x - 10, lv.bbox.y - 10 - titleH * 0.3, lv.title.toUpperCase(), { size: 3.4 * k, anchor: "start" }));
    parts.push({ lv, layers, tf: { x: dx, y: dy } });
  });
  void rows;
  ctx.toScreen = (lv, x, y) => { const o = offsets.get(lv) || [0, 0]; return [x + o[0], y + o[1]]; };
  ctx.dirScreen = d => d;
  const links = M.scene.links(lay, ctx);
  const entries = M.scene.entries(lay, ctx);

  // Content box: every floor's site, plus room for the entry tags.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const { lv } of parts) {
    const [dx, dy] = offsets.get(lv), B = lv.siteBox || lv.bbox;
    minX = Math.min(minX, B.x - 10 + dx); minY = Math.min(minY, B.y - 10 + dy - titleH);
    maxX = Math.max(maxX, B.x + B.w + 10 + dx); maxY = Math.max(maxY, B.y + B.h + 10 + dy + (lv.lvl === 0 ? 10 : 0));
  }
  // …and every entry tag, measured, so an arrow's label is never cropped.
  (function grow(ps) {
    for (const p of ps) {
      if (p.t === "g") { const tf = p.tf || {}; const sc = tf.s || 1; for (const q of p.kids) if (q.t === "circle") { const cx = (tf.x || 0) + q.cx * sc, cy = (tf.y || 0) + q.cy * sc, rr = q.rad * sc; minX = Math.min(minX, cx - rr); maxX = Math.max(maxX, cx + rr); minY = Math.min(minY, cy - rr); maxY = Math.max(maxY, cy + rr); } continue; }
      if (p.t === "rect") { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x + p.w); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y + p.h); }
      if (p.t === "line") { minX = Math.min(minX, p.x1, p.x2); maxX = Math.max(maxX, p.x1, p.x2); minY = Math.min(minY, p.y1, p.y2); maxY = Math.max(maxY, p.y1, p.y2); }
    }
  })(entries);
  const tagPad = 3 * k;
  const box = { x: minX - tagPad, y: minY - tagPad, w: maxX - minX + 2 * tagPad, h: maxY - minY + 2 * tagPad };

  // Portrait tokens: either supplied SVG or rendered by the figure kit.
  let tokens = (opts.tokens || []).slice();
  if (opts.figures && opts.figures.kit && opts.figures.cast) {
    for (const c of opts.figures.cast) {
      try { const p = opts.figures.kit.portrait(c.spec); tokens.push({ room: c.room, svg: p.svg, label: c.label || c.spec.name, warnings: p.warnings }); }
      catch (e) { M.warn(W, `figure for "${c.room}" failed to render: ${e.message}`); }
    }
  }
  tokens = tokens.map(t => {
    const r = model.rooms.find(x => x.name === t.room);
    if (!r || !r.frame) { M.warn(W, `token room "${t.room}" is not on this map`); return null; }
    if (reveal && !reveal.has(r.band)) return null;
    const lv = lay.levels.find(l => l.rooms.includes(r)), [px, py] = ctx.toScreen(lv, r.frame.cx, r.frame.cy, "room");
    return Object.assign({}, t, { x: px, y: py, roomObj: r });
  }).filter(Boolean);

  // Legend type follows the sheet, so a big plan doesn't get a footnote legend.
  const kl = Math.max(k, Math.min(box.w, box.h * 1.5) / 118);
  const roomPos = r => { const lv = lay.levels.find(l => l.rooms.includes(r)); return lv && r.frame ? ctx.toScreen(lv, r.frame.cx, r.frame.cy, "room") : null; };
  const scene = { model, lay, parts, links, entries, box, k, kl, tokens, opts, offsets, W, toScreen: ctx.toScreen, roomPos };
  const out = theme.compose(scene);
  return { svg: out.svg, width: out.width, height: out.height, warnings: W, model, layout: lay, seed };
};

// --- Shared legend ------------------------------------------------------------------
// Themes typeset the same facts their own way; this collects the facts.
M.legendFacts = function (scene) {
  const { model, opts } = scene, player = opts.layer === "player";
  const reveal = player ? new Set(opts.reveal || ["public"]) : null;
  const bands = M.BANDS.filter(b => model.rooms.some(r => r.band === b)).map(b => ({
    band: b, label: M.BAND_LABEL[b], known: !reveal || reveal.has(b),
    rooms: model.rooms.filter(r => r.band === b).map(r => ({ n: r.n, name: r.name, target: !player && r.isTarget, obstacle: !player && r.obstacle, icon: r.obstacle && M.obstacleIcon(r.obstacle), loot: !player && r.featured && r.loot, answers: !player && r.holdsAnswerTo, mix: r.mix }))
  }));
  // In the player copy a way in that costs a question says only that it is
  // there: its text names rooms the crew hasn't surveyed.
  const ways = model.vectors.map((v, i) => ({ kind: ["front", "service", "back"][i], n: v.n, how: v.how, cost: v.cost, know: v.know }))
    .filter(v => !player || !/can't be known/.test(v.know))
    .map(v => player && /question/.test(v.know) ? Object.assign(v, { how: "There is a way in here. Ask how to learn what it is.", cost: "" }) : v);
  return {
    name: model.name, target: model.target, district: model.district,
    sub: [model.themeName + (model.mixName ? " × " + model.mixName : ""), model.styleName].filter(Boolean).join(" · "),
    approach: player ? "" : model.approach + (model.gambit ? ` — ${model.gambit}` : ""),
    targetLine: player ? "" : (model.targetRoom ? `${model.targetRoom}: ${model.targetWhat}` : ""),
    bands, ways, player,
    threats: player ? [] : [model.soc && { icon: "social", role: "ov-soc", name: model.soc.name, text: model.soc.text, kind: "Social" }, model.phys && { icon: "guard", role: "ov-phys", name: model.phys.name, text: model.phys.text, kind: "Physical" }].filter(Boolean),
    note: model.geometryNote, time: [model.time, model.weather].filter(Boolean).join(", ")
  };
};

// --- Sheets: every piece on one page --------------------------------------------
//   B68Map.sheet({ kind: "parts" | "icons" | "rooms", theme, colour, cols, width, names })
// Draws the kit's own vocabulary in any theme, for the design system's
// catalogue pages and for checking a new part by eye.
M.sheet = function (o = {}) {
  const W = [], kind = o.kind || "parts", themeName = o.theme && o.theme !== "board" ? o.theme : "rulebook";
  const theme = M.THEMES[themeName], rng = M.rng(o.seed || 7);
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
      const p = M.PARTS[name]; if (!p) { M.warn(W, `part "${name}" is not registered`); return; }
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
  const scene = { model: { name: `${kind} sheet`, target: "", district: "", colour: M.COLOURS[o.colour] ? o.colour : "teal and ochre", rooms: [], seed: 1 },
    lay: { levels: [] }, parts: [{ lv: {}, layers, tf: { x: 0, y: 0 } }], links: [], entries: [], box, k: 1, kl: 1, tokens: [],
    opts: { legend: false, width: o.width || 1400, view: "sheet", layer: "gm", grain: o.grain }, offsets: new Map(), W };
  const out = theme.compose(scene);
  return { svg: out.svg, width: out.width, height: out.height, warnings: W, count: names.length };
};

// --- iso and section --------------------------------------------------------------
// Both reuse the plan layout. iso projects it; section rebuilds it side-on.
M.renderProjected = function (o, opts, S0) {
  const { W, theme, model, seed, lay, reveal, ctx } = S0;
  let k = S0.k;
  let parts, extra = [], bounds;
  if (opts.view === "iso") {
    // iso type sits over a smaller footprint on the page: give it room.
    ctx.k = k = Math.max(k, 1.2);
    const r = M.iso.build(lay, model, ctx);
    parts = r.parts; extra = r.coreLinks; bounds = r.bounds;
  } else {
    const r = M.section.build(lay, model, ctx);
    parts = r.parts; bounds = r.bounds; S0.secEntries = r.entries; S0.secLinks = r.links;
  }
  const offsets = new Map(lay.levels.map(l => [l, [0, 0]]));
  const links = extra.concat(opts.view === "iso" ? M.scene.links(lay, ctx) : S0.secLinks);
  const entries = opts.view === "iso" ? M.scene.entries(lay, ctx) : S0.secEntries;
  let { minX, minY, maxX, maxY } = bounds;
  for (const p of entries) {
    if (p.t === "rect") { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x + p.w); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y + p.h); }
    if (p.t === "line") { minX = Math.min(minX, p.x1, p.x2); maxX = Math.max(maxX, p.x1, p.x2); minY = Math.min(minY, p.y1, p.y2); maxY = Math.max(maxY, p.y1, p.y2); }
    if (p.t === "g" && p.tf) { minX = Math.min(minX, p.tf.x - 3 * k); maxX = Math.max(maxX, p.tf.x + 3 * k); }
  }
  const pad = 4 * k, box = { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
  let tokens = [];
  if (opts.figures && opts.figures.kit && opts.figures.cast) for (const c of opts.figures.cast) {
    try { const p = opts.figures.kit.portrait(c.spec); tokens.push({ room: c.room, svg: p.svg, label: c.label || c.spec.name }); } catch (e) { M.warn(W, `figure for "${c.room}" failed to render: ${e.message}`); }
  }
  tokens = tokens.concat(opts.tokens || []).map(t => {
    const r = model.rooms.find(x => x.name === t.room);
    if (!r || !r.frame) { M.warn(W, `token room "${t.room}" is not on this map`); return null; }
    if (reveal && !reveal.has(r.band)) return null;
    const lv = lay.levels.find(l => l.rooms.includes(r)), q = ctx.toScreen(lv, r.frame.cx, r.frame.cy, "room");
    return Object.assign({}, t, { x: q[0], y: q[1], roomObj: r });
  }).filter(Boolean);
  const kl = Math.max(k, Math.min(box.w, box.h * 1.5) / 118);
  const roomPos = r => { const lv = lay.levels.find(l => l.rooms.includes(r)); return lv && r.frame ? ctx.toScreen(lv, r.frame.cx, r.frame.cy, "room") : null; };
  const scene = { model, lay, parts, links, entries, box, k, kl, tokens, opts, offsets, W, toScreen: ctx.toScreen, roomPos };
  const out = theme.compose(scene);
  return { svg: out.svg, width: out.width, height: out.height, warnings: W, model, layout: lay, seed };
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
const TOK = M.TOKENS = {
  ink900: "#14110e", ink700: "#2a2521", ink500: "#55504a", ink300: "#8e8880", ink150: "#c9c3b8",
  paper000: "#fbf8f1", paper100: "#f2ede1", paper200: "#e8e2d4", paper300: "#dcd4c2", paperTint: "#efe7d6",
  signal500: "#e0691e", signal700: "#b8481a", rust500: "#c1571c", rust700: "#8a3c14", caution500: "#e8c33c", caution700: "#c39b18", caution900: "#6e5408",
  alarm500: "#e03a20", alarm700: "#a8210f", file500: "#3f62c4", file700: "#26418f", file300: "#8fa3dd",
  covert500: "#6e8f6a", covert700: "#41633e", rust900: "#3a2213", swing500: "#c9348c", swing700: "#98206a", slate500: "#6e8a8c", slate700: "#3e5356"
};
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
  return a;
}
const wrapPaint = fn => (role, p, mode) => finish(fn(role, p, mode), p);

// --- Shared legend typesetter -------------------------------------------------------
// Lays the facts out as blocks, each a list of pieces with a height; then flows
// the blocks into columns. Roles are "lg-*" so each theme styles them.
function legendBlocks(F, w, k, opt) {
  const s = k * (opt.scale || 1), blocks = [], CH = M.ADVANCE[opt.cls || "condensed"];
  const wrapW = (t, size) => M.wrap(t, Math.max(10, Math.floor(w / (size * CH))));
  const block = () => { const b = { pieces: [], h: 0 }; blocks.push(b); return b; };
  const text = (b, role, t, size, o = {}) => {
    const lines = o.nowrap ? [t] : wrapW(t, size);
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
    text(b, "lg-band", band.label.toUpperCase() + (band.known ? "" : " — not yet surveyed"), 2 * s, { x: 3.4 * s, nowrap: true });
    b.h += 0.2 * s;
    if (!band.known) { b.h += 0.6 * s; continue; }
    for (const r of band.rooms) {
      const y0 = b.h;
      b.pieces.push(P.circle("num-bg", 4.5 * s, y0 + 1.15 * s, 1.0 * s), P.text("num", 4.5 * s, y0 + 1.55 * s, String(r.n), { size: 1.2 * s }));
      let nm = r.name + (r.mix ? ` (${r.mix})` : "");
      text(b, r.target ? "lg-text-strong" : "lg-text", nm, 2 * s, { x: 6.6 * s });
      let ix = 6.6 * s + Math.min(w - 10 * s, nm.length * 2 * s * CH) + 1.6 * s;
      const icons = [r.target && ["star", "ov-target"], r.obstacle && [r.icon, "ov-lock"], r.answers && ["key", "ov-pair"], r.loot && ["loot", "ov-loot"]].filter(Boolean);
      if (ix + icons.length * 2.6 * s > w) ix = w - icons.length * 2.6 * s;
      icons.forEach(([nmI, role], i) => b.pieces.push(M.icon(nmI, ix + i * 2.6 * s, y0 + 1.15 * s, 2 * s, role)));
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
  const paint = th.paint, m = 7 * k;
  let legend = null, LW = 0, LH = 0, below = false;
  if (opts.legend !== false) {
    const F = M.legendFacts(scene);
    below = box.w / box.h > 2.1;
    const colW = below ? Math.max(48 * k, Math.min(64 * k, box.w / 3 - 4 * k)) : Math.max(54 * k, Math.min(72 * k, box.h * 0.55));
    let cols = below ? Math.max(1, Math.floor((box.w + 4 * k) / (colW + 4 * k))) : 1;
    const blocks = legendBlocks(F, colW, k, th.legend || {});
    let flowed = flowLegend(blocks, colW, cols, 3.4 * k);
    // A side legend much taller than the drawing goes to two columns.
    if (!below && flowed.h > box.h * 1.3) { cols = 2; flowed = flowLegend(blocks, colW, cols, 3.4 * k); }
    legend = flowed.pieces; LW = below ? box.w : cols * colW + (cols - 1) * 3.4 * k; LH = flowed.h;
  }
  // When the legend runs taller than the drawing, the drawing grows to match
  // it instead of sitting small in the top corner of a long page.
  const cs = !below && legend ? Math.min(1.35, Math.max(1, LH / box.h)) : 1;
  const bw = box.w * cs, bh = box.h * cs;
  const PW = below ? bw + 2 * m : bw + (legend ? LW + 3 * m : 2 * m);
  const PH = below ? bh + (legend ? LH + 3 * m : 2 * m) : Math.max(bh, LH) + 2 * m;
  const cx = m - box.x * cs, cy = m + (below ? 0 : (PH - 2 * m - bh) / 2) - box.y * cs;
  const lx = below ? m : bw + 2 * m, ly = below ? bh + 2 * m : m;
  scene._cs = cs;
  const width = opts.width, height = Math.round(width * PH / PW);
  scene._pxft = width / PW * cs;

  const ser = (pieces, mode) => M.toSVG(pieces, { paint, shadowColour: th.shadowColour }, mode);
  // A part may give each layer its own transform (the isometric view skews
  // floors and furniture but keeps walls, labels and entries upright).
  const tfOf = (p, name) => (p.tfs && p.tfs[name]) || `translate(${p.tf.x.toFixed(2)} ${p.tf.y.toFixed(2)})`;
  const layer = (name, mode) => parts.map(p => `<g transform="${tfOf(p, name)}">${ser(p.layers[name], mode)}</g>`).join("");
  let body = "";
  body += th.background ? th.background(id, { PW, PH, box, cx, cy, k, cs }) : "";
  body += `<g transform="translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${cs.toFixed(4)})"${th.contentFilter ? ` filter="url(#${id}-${th.contentFilter})"` : ""}>`;
  body += th.underlay ? th.underlay(id, scene) : "";
  body += layer("site") + layer("floors");
  if (th.shadow) body += `<g transform="translate(${th.shadow[0]} ${th.shadow[1]})" opacity="${th.shadow[2]}">${layer("furn", "shadow")}</g>`;
  body += layer("furn");
  for (const pass of th.wallPasses || [null]) body += layer("walls", pass);
  body += layer("doors");
  body += `<g${th.gameFilter ? ` filter="url(#${id}-${th.gameFilter})"` : ""}>${layer("game")}${ser(links)}</g>`;
  body += layer("cover");
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
  if (legend) body += `<g transform="translate(${lx.toFixed(2)} ${ly.toFixed(2)})">${th.legendBackground ? th.legendBackground(id, LW, LH, k) : ""}${ser(legend)}</g>`;
  body += th.foreground ? th.foreground(id, { PW, PH, k, scene, lx, ly, LW, LH, below }) : "";
  // Grain sits on the drawing, not the type: the rulebook's text pages are clean.
  if (opts.grain !== false && th.grain) body += `<rect x="${(cx + box.x * cs).toFixed(2)}" y="${(cy + box.y * cs).toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" filter="url(#${id}-grain)" style="mix-blend-mode:${th.grainBlend || "multiply"}" opacity="${th.grain}" pointer-events="none"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PW.toFixed(2)} ${PH.toFixed(2)}" width="${width}" height="${height}" font-family='${FONT.condensed}'><defs>${th.defs(id, scene)}</defs><rect width="100%" height="100%" fill="${th.page}"/>${body}</svg>`;
  return { svg, width, height, PW, PH, content: { cx, cy, cs } };
}
M.composePage = composePage;


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
  defs: (id, sc) => defs(id, { dotFill: TOK.ink900, hatchBg: TOK.ink700, hatchFg: TOK.ink500, pxft: sc._pxft, freq: 0.55 }),
  compose(scene) {
    const [a, b] = M.COLOURS[scene.model.colour] || M.COLOURS["grey and charcoal"];
    const C = {
      floor: { public: mix(TOK.paper000, a, 0.14), working: mix(TOK.paper000, a, 0.3), controlled: mix(TOK.paper000, a, 0.52), secure: mix(a, TOK.ink900, 0.18) },
      fx: mix(b, TOK.ink900, 0.42), fx2: b, fx3: TOK.ink900, fxl: TOK.paper000, fxm: TOK.slate500, fxw: mix(TOK.file500, TOK.paper000, 0.35), fxg: TOK.covert700, fxglow: TOK.caution500, fxline: TOK.ink700
    };
    // "black and white" and "brown and more brown" are dark fields: lift the floors.
    if (hex(a).reduce((s, v) => s + v, 0) < 200) { C.floor = { public: TOK.paper000, working: TOK.paper200, controlled: TOK.ink150, secure: mix(a, TOK.paper300, 0.15) }; }
    const icons = {
      "ov-target": [TOK.alarm700, TOK.paper000, TOK.alarm700], "ov-lock": [TOK.ink900, TOK.caution500, TOK.ink900],
      "ov-loot": [TOK.caution500, TOK.ink900, TOK.paper000], "ov-pair": [TOK.caution700, TOK.paper000, TOK.caution700],
      "ov-soc": [TOK.signal500, TOK.ink900, TOK.paper000], "ov-phys": [TOK.ink900, TOK.alarm500, TOK.paper000],
      "ov-front": [TOK.ink900, TOK.paper000, TOK.ink900], "ov-service": [TOK.file500, TOK.paper000, TOK.file500], "ov-back": [TOK.swing700, TOK.paper000, TOK.swing700]
    };
    const ENTRY = { "ov-front": TOK.ink900, "ov-service": TOK.file500, "ov-back": TOK.swing700 };
    const self = Object.assign({}, this);
    const PC = { face: TOK.ink700, end: TOK.ink900, top: TOK.ink900, glass: TOK.file300, glassEdge: TOK.file500, soft: b, roof: mix(a, TOK.ink900, 0.45), earth: mix(TOK.rust900 || "#3a2213", TOK.paper200, 0.55), water: mix(TOK.file700, TOK.paper000, 0.25), thin: TOK.ink500, door: TOK.ink700, gap: mix(TOK.paper000, a, 0.06), hull: mix(TOK.rust700, TOK.ink900, 0.45), deck: mix(TOK.paper300, TOK.rust500, 0.35), quay: TOK.paper300 };
    self.paint = wrapPaint((role, p, mode) => {
      const ic = iconPaint(icons, role); if (ic || role.includes(":")) return ic;
      const pj = projectedPaint(PC, role); if (pj) return pj;
      if (role.startsWith("floor-")) { const band = role.slice(6); if (band === "tone") return { fill: `url(#${scene._id}-dots)`, opacity: 0.22 }; if (band === "corridor") return { fill: mix(TOK.paper000, a, 0.06) }; return { fill: C.floor[band] }; }
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
        case "num-bg": return { fill: TOK.ink900 };
        case "num": return { fill: TOK.paper000, "font-weight": 900 };
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
    return composePage(scene, self);
  }
};

// =============================================================================
// BLUEPRINT — the architect's drawing. The one theme allowed lines (2.2 of the
// style bible is about illustration; a blueprint is a document, not a plate).
// =============================================================================
T.blueprint = {
  name: "blueprint",
  describe: "An architect's blueprint: white linework on blue, hollow walls, a 5 ft grid, title block, red-pencil annotations.",
  page: "#1e4d8f", wallPasses: [null, "hollow"], grain: 0.28, grainBlend: "screen",
  legend: { kicker: "Drawing", titleSize: 4.6, cls: "mono" },
  defs: (id, sc) => defs(id, { dotFill: "#ffffff", hatchBg: "#1e4d8f", hatchFg: "rgba(255,255,255,0.35)", gr: 1, gg: 1, gb: 1, ga: -2.4, gb2: 1.1, freq: 0.5, pxft: sc._pxft }) +
    `<pattern id="${id}-grid" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M5 0 L0 0 0 5" fill="none" stroke="#ffffff" stroke-opacity="0.09" stroke-width="0.12"/></pattern>` +
    `<pattern id="${id}-grid25" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0 L0 0 0 25" fill="none" stroke="#ffffff" stroke-opacity="0.18" stroke-width="0.16"/></pattern>`,
  background: (id, { box, cx, cy, cs }) => `<g transform="translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${cs.toFixed(4)})"><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="url(#${id}-grid)"/><rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="url(#${id}-grid25)"/></g>`,
  compose(scene) {
    const BG = this.page, W = "#f4f6fb", RED = "#ff6a4d", YEL = "#ffd65a";
    const line = (sw, o) => Object.assign({ fill: "none", stroke: W, "stroke-width": sw, "stroke-opacity": 0.92 }, o);
    const icons = {
      "ov-target": [BG, RED, BG, RED], "ov-lock": [BG, YEL, BG, YEL], "ov-loot": [BG, W, BG, W], "ov-pair": [BG, YEL, BG, YEL],
      "ov-soc": [BG, YEL, BG, YEL], "ov-phys": [BG, RED, BG, RED], "ov-front": [BG, W, BG, W], "ov-service": [BG, W, BG, W], "ov-back": [BG, RED, BG, RED]
    };
    const self = Object.assign({}, this);
    const id = scene._id = scene._id || ("b68m" + uid());
    const PC = { face: BG, end: BG, top: "#3f6db0", edge: W, glass: W, glassEdge: W, soft: W, roof: W, earth: "#1a4580", water: "#1a4580", thin: W, door: W, gap: BG };
    self.paint = wrapPaint((role, p, mode) => {
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
        case "num-bg": return { fill: "none", stroke: W, "stroke-width": 0.15 };
        case "num": return { fill: W, "font-family": FONT.mono, "font-weight": 700 };
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
    self.foreground = (id, { PW, PH, k, scene: sc }) => {
      const no = "DRG " + ((sc.model.target || "BLD").replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase().padEnd(3, "X")) + "-968-" + String(M.hash(sc.model.name) % 10000).padStart(4, "0");
      const x = 4 * k, y = PH - 4 * k, s = k;
      return `<g font-family='${FONT.mono}' fill="${W}"><rect x="1.2" y="1.2" width="${(PW - 2.4).toFixed(2)}" height="${(PH - 2.4).toFixed(2)}" fill="none" stroke="${W}" stroke-opacity="0.7" stroke-width="0.3"/>` +
        `<g transform="translate(${x} ${y})"><rect x="0" y="${-1.4 * s}" width="${25}" height="${1.1 * s}" fill="none" stroke="${W}" stroke-width="0.15"/><rect x="0" y="${-1.4 * s}" width="5" height="${1.1 * s}" fill="${W}"/><rect x="10" y="${-1.4 * s}" width="5" height="${1.1 * s}" fill="${W}"/><rect x="20" y="${-1.4 * s}" width="5" height="${1.1 * s}" fill="${W}"/><text x="0" y="${-2 * s}" font-size="${1.3 * s}">0</text><text x="25" y="${-2 * s}" font-size="${1.3 * s}" text-anchor="middle">25 FT</text>` +
        `<text x="${30}" y="${-0.3 * s}" font-size="${1.5 * s}" font-weight="700">${M.esc(no)} · DOSKVOL · 968 AC</text></g>` +
        `<g transform="translate(${(PW - 6 * k).toFixed(2)} ${(PH - 7 * k).toFixed(2)})"><circle r="${2.6 * k}" fill="none" stroke="${W}" stroke-width="0.2"/><path d="M0 ${-2.4 * k} L${0.9 * k} ${1.2 * k} L0 ${0.5 * k} L${-0.9 * k} ${1.2 * k} Z" fill="${W}"/><text y="${-3.2 * k}" font-size="${1.5 * k}" text-anchor="middle" font-weight="700">N</text></g></g>`;
    };
    return composePage(scene, self);
  }
};

// =============================================================================
// CASE FILE — City Watch of Duskwall surveillance copy
// =============================================================================
T.casefile = {
  name: "casefile",
  describe: "A City Watch of Duskwall case file: a photocopied plan, typewriter labels, red grease pencil, a rubber stamp. The player layer redacts.",
  page: "#f3efe4", shadow: [0.4, 0.5, 0.2], shadowColour: "#2a2521", grain: 0.42, contentFilter: "copy", gameFilter: "rough",
  legend: { kicker: "Case file", titleSize: 4.4, cls: "typewriter" },
  defs: (id, sc) => defs(id, { dotFill: "#14110e", hatchBg: "#14110e", hatchFg: "#14110e", rough: 0.9, copy: true, freq: 0.6, ga: -1.7, pxft: sc._pxft }),
  compose(scene) {
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
    self.paint = wrapPaint((role, p, mode) => {
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
        case "num-bg": return { fill: INK };
        case "num": return { fill: "#fbf8f1", "font-family": FONT.typewriter, "font-weight": 700 };
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
    self.foreground = (id, { PW, PH, k, scene: sc, lx, ly, LW }) => {
      const code = "CWD-968-" + String(M.hash(sc.model.name + sc.model.district) % 10000).padStart(4, "0");
      const st = player ? "SURVEY — PARTIAL" : "EVIDENCE — DO NOT REMOVE";
      const w = st.length * 1.25 * k + 4 * k;
      const cs = sc._cs || 1, x = sc.box.w * cs - w * 0.5, y = sc.box.h * cs + 2 * k;
      return `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(-7)" opacity="0.82" filter="url(#${id}-rough)"><rect x="${-w / 2}" y="${-3 * k}" width="${w}" height="${5.2 * k}" fill="none" stroke="${RED}" stroke-width="${0.45 * k}"/><text y="${-0.2 * k}" font-family='${FONT.typewriter}' font-weight="700" font-size="${2 * k}" fill="${RED}" text-anchor="middle" letter-spacing="0.3">${M.esc(st)}</text><text y="${1.6 * k}" font-family='${FONT.typewriter}' font-size="${1.3 * k}" fill="${RED}" text-anchor="middle">CITY WATCH OF DUSKWALL · ${code}</text></g>`;
    };
    return composePage(scene, self);
  }
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
    const id = "b68board" + uid();
    const head = `<text x="${Wd / 2}" y="${8 * k}" font-family='${FONT.script}' font-size="${5.4 * k}" fill="#fbf8f1" text-anchor="middle" opacity="0.92">${M.esc(model.name)}</text>`;
    const sheetSvg = inner.svg.replace(/^<svg[^>]*>/, `<svg x="${sheetX}" y="${sheetY}" width="${sw}" height="${sh}" viewBox="0 0 ${sw} ${sh}">`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Wd.toFixed(2)} ${H.toFixed(2)}" width="${opts.width}" height="${Math.round(opts.width * H / Wd)}"><defs><filter id="${id}-cork" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed="11"/><feColorMatrix values="0 0 0 0 0.22  0 0 0 0 0.12  0 0 0 0 0.05  0 0 0 -2.2 1.25"/></filter></defs>` +
      `<rect width="100%" height="100%" fill="#b8874f"/><rect width="100%" height="100%" filter="url(#${id}-cork)" opacity="0.9"/>${head}` +
      `<g transform="rotate(${rot} ${scx} ${scy})"><rect x="${sheetX + 0.8}" y="${sheetY + 1.2}" width="${sw}" height="${sh}" fill="#000" opacity="0.3"/>${sheetSvg}</g>${sheetPins}${placed.join("")}${strings}${pins}</svg>`;
    return { svg, width: opts.width, height: Math.round(opts.width * H / Wd) };
  }
};

// ---- public surface ----
return {
  VERSION: M.VERSION,
  render: M.render,
  sheet: M.sheet,
  model: (o) => { const W = []; return { model: M.model(o, W), warnings: W }; },
  options: () => ({ views: M.VIEWS.slice(), themes: Object.keys(M.THEMES), layers: ["gm", "player"], bands: M.BANDS.slice(),
    rings: Object.keys(M.layout.STYLE), colours: Object.keys(M.COLOURS), archetypes: Object.keys(M.ARCH), parts: Object.keys(M.PARTS),
    icons: Object.keys(M.ICONS), rooms: Object.keys(M.ROOMS), dressedTargets: Object.keys(M.DRESS) }),
  parts: M.PARTS, icons: M.ICONS, rooms: M.ROOMS, dress: M.DRESS, colours: M.COLOURS, themes: M.THEMES, archetypes: M.ARCH,
  _internal: M
};
}));
