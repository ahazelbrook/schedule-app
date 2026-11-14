// The landing: night, a stone water landing below a grand lit building, seen from across the water and a little low. Slim boats
// glide in from the left, pause at the steps and glide out to the right; a guest or two steps up from each, climbs the carpet and
// goes in under the awning; the press at the top of the steps pops a flashbulb now and then. Extras only: invented looks, no names,
// no text, nothing a player could read as GM information. Ambient, so it loops (120 s) and can sit in the rotation.
//
// Layers, back to front, each composited on its own (the night tram's lesson): the still picture (sky, building, steps, the press);
// two water-reflection layers that cross-fade and drift; a ripple strip that slides; four tiny window-shadow layers; the guests,
// each a figure-sized layer moved and scaled with a CSS transform and cut between walk poses; the boats, each its own layer; the
// flashbulbs and their afterglow (opacity only). Nothing that moves carries an SVG filter: the figures' grain and stipple are
// stripped and their colours are mapped to a night ramp here, at build time.
//
// Held still (the display's "Hold scenes still": html.b68-fx-off) or under reduced motion the scene shows one composed frame (a boat
// at the steps, two guests going up): no flash, no figure moves; reduced motion keeps only the slow water. No flashbulb ever fires
// more than twice in a second (a double is 0.35 s apart, single flashes 6 to 20 s apart), each is one painted frame, and none at all
// when held or under reduced motion. `?t=30` starts the loop thirty seconds in.
"use strict";
const L = require("../lib.js");
const { C, f2, rng } = L;

const W = 1600, H = 1200;
const LOOP = 120;           // seconds
const HOLD = 15.2;          // the still frame, in loop seconds
const T_START = 3;          // where a fresh page starts (a boat already gliding in)
const S0 = 0.07;            // px per kit unit on the landing (6 ft is 126 px)
const YL = 818, RISE = 14, STEPS = 12, YT = YL - RISE * STEPS; // the landing, a riser, the terrace (650)
const WL = 850;             // a boat's waterline
const DX = 1300;            // how far out a boat starts and ends

// colours (the design system's tokens where one fits)
const SKY = ["#04060d", "#0c1229", "#211b36"];
const STONE = "#262d40", STONE_D = "#191e2c", STONE_L = "#3a4360", TRIM = "#434d6a";
const GOLD = C.caution500, GOLD2 = "#f6dc7a", BRASS = C.caution700, CREAM = "#fff4d6", WARM = "#ffe7a8";
const WATER = "#070a13", INK = "#0b0e17", CARPET = C.alarm700, AWN = C.signal700;
// the night ramp the figures are mapped through (dark navy to a lamp-lit cream): luminance in, colour out
const RAMP = ["#0d1019", "#181d2e", "#29324f", "#525f86", "#b3b5c2", "#f2ebdc"];

const rect = (x, y, w, h, fill, extra = "") => `<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" fill="${fill}"${extra ? " " + extra : ""}/>`;
const circ = (x, y, r, fill, extra = "") => `<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(r)}" fill="${fill}"${extra ? " " + extra : ""}/>`;
const archD = (x, top, w, bottom) => { const r = w / 2; return `M${f2(x)} ${f2(bottom)} L${f2(x)} ${f2(top + r)} A${f2(r)} ${f2(r)} 0 0 1 ${f2(x + w)} ${f2(top + r)} L${f2(x + w)} ${f2(bottom)} Z`; };
const lerp = (a, b, u) => a + (b - a) * u;
/* light as flat rings of low opacity (no gradient: a gradient fill is the dearest thing a software renderer repaints) */
const glow = (x, y, r, col = WARM, k = 1) => circ(x, y, r, col, `opacity="${f2(0.05 * k)}"`) + circ(x, y, r * 0.62, col, `opacity="${f2(0.07 * k)}"`) + circ(x, y, r * 0.34, col, `opacity="${f2(0.1 * k)}"`);
/* a vertical gradient as flat bands */
const bands = (x, y, w, h, cols) => cols.map((c, i) => rect(x, y + h * i / cols.length, w, h / cols.length + 0.5, c)).join("");

// ---------------------------------------------------------------- figures
const hex2 = (h) => (h.length === 3 ? h.split("").map((c) => c + c).join("") : h);
function ramp(h) {
  const x = hex2(h), r = parseInt(x.slice(0, 2), 16), g = parseInt(x.slice(2, 4), 16), b = parseInt(x.slice(4, 6), 16);
  const p = Math.max(0, Math.min(1, (0.3 * r + 0.58 * g + 0.12 * b) / 255)) * (RAMP.length - 1), i = Math.min(RAMP.length - 2, Math.floor(p)), u = p - i;
  const A = hex2(RAMP[i].slice(1)), B = hex2(RAMP[i + 1].slice(1));
  const ch = (k) => Math.round(lerp(parseInt(A.slice(k, k + 2), 16), parseInt(B.slice(k, k + 2), 16), u)).toString(16).padStart(2, "0");
  return "#" + ch(0) + ch(2) + ch(4);
}
/* A figure for this scene: no SVG filter anywhere (grain, stipple, shadow and the like come out: the stage's grain lies over it all),
   its colours mapped to the night ramp, and a pose version that is off carries the visibility ATTRIBUTE rather than an inline style
   (the page's own show() below flips it; the kit ratchet counts inline styles in app/, and this page adds none). */
function night(svg, id) {
  let s = svg.replace(/<filter\b[\s\S]*?<\/filter>/g, "").replace(/\sfilter="url\([^)]*\)"/g, "");
  s = s.replace(/\sstyle="visibility:hidden"/g, ' visibility="hidden"');
  if (/style=["']/.test(s)) throw new Error(id + ": an inline style is left on a figure");
  if (/<filter|filter="/.test(s)) throw new Error(id + ": a filter is left on a figure");
  // kit units are 1/25 inch, a hundredth of a stage pixel here: whole units are plenty (and a third of the bytes)
  s = s.replace(/\s(d|points)="([^"]*)"/g, (m, k, v) => ` ${k}="${v.replace(/-?\d*\.\d+/g, (n) => String(Math.round(+n)))}"`);
  s = s.replace(/((?:fill|stroke|stop-color|flood-color|lighting-color|color)=")#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})"/g, (m, a, h) => a + ramp(h) + '"');
  return flat(s);
}
/* Flat shapes: the kit's shading (crescents and bands laid over a part and clipped to it) comes out, with the clip paths, leaving each
   part in its own colour. At this size, mapped to the night ramp, the shading barely shows; it is most of what a repaint costs. */
function flat(svg) {
  const tree = L.M.parse(svg);
  (function walk(n) {
    if (n.text != null) return;
    n.kids = n.kids.filter((k) => k.text != null || (k.tag !== "clipPath" && !/\sclip-path="/.test(k.attrs)));
    for (const k of n.kids) walk(k);
  })(tree);
  return tree.kids.map(L.M.ser).join("");
}
function figure(spec, id, frames, place, silhouette) {
  const f = L.fig(Object.assign({}, spec, { id }), { id, frames: frames || [{}], place, lod: "lo", bake: false, shadow: false, silhouette: !!silhouette });
  f.svg = night(f.svg, id);
  return f;
}
const WALK = [{}, { pose: { stance: "wide", weight: "R" } }, { pose: { stance: "square", weight: "L" } }, { pose: { stance: "wide", weight: "L" } }];
const WAVE = { pose: { arms: { R: "raise" }, head: { tilt: 4 } } };

// the guests: invented looks, evening dress, one pale dinner jacket. `b` the boat, `o` seconds after it docks that they step off,
// `n` notable (a wave at the top, and the press fire twice)
const GUESTS = [
  { b: 0, o: 1.0, spec: { figure: "fem", skin: "fair", heightIn: 66, age: 31, hair: { style: "beehive", color: "cloth-black" }, outfit: { dress: { type: "gown", color: "cloth-oxblood" } } } },
  { b: 0, o: 2.3, spec: { skin: "brown", heightIn: 72, age: 38, hair: { style: "short", color: "cloth-black" }, outfit: { base: { type: "shirt", color: "cloth-white" }, outer: { type: "dinner-jacket", color: "cloth-black" }, bottom: { type: "trousers", color: "cloth-black" } } } },
  { b: 1, o: 1.2, n: true, spec: { skin: "tan", heightIn: 71, age: 52, hair: { style: "slick-back", color: "ink-300" }, outfit: { base: { type: "shirt", color: "cloth-white" }, outer: { type: "dinner-jacket", color: "cloth-white" }, bottom: { type: "trousers", color: "cloth-black" } } } },
  { b: 2, o: 1.0, spec: { skin: "pale", heightIn: 70, age: 45, hair: { style: "short", color: "cloth-brown" }, outfit: { base: { type: "shirt", color: "cloth-white" }, outer: { type: "tailcoat" }, bottom: { type: "trousers", color: "cloth-black" } } } },
  { b: 2, o: 2.2, spec: { figure: "fem", skin: "deep", heightIn: 64, age: 27, hair: { style: "bowl-bob", color: "cloth-black" }, outfit: { dress: { type: "gown", color: "cloth-cream" } } } },
  { b: 3, o: 1.2, n: true, spec: { figure: "fem", skin: "fair", heightIn: 67, age: 36, hair: { style: "short", color: "cloth-chocolate" }, outfit: { dress: { type: "gown", color: "cloth-black" } } } },
];
// the boats: start (loop s), seconds gliding in, at the steps, gliding out; hull and strake colours
const BOATS = [
  { s: 2, i: 9, d: 10, o: 8, hull: "#0c0f18", strake: "#c9a85a" },
  { s: 32, i: 10, d: 9, o: 8, hull: "#140f1a", strake: C.paper200 },
  { s: 61, i: 9, d: 11, o: 8, hull: "#0a1314", strake: C.rust500 },
  { s: 91, i: 10, d: 9, o: 8, hull: "#101320", strake: "#c9a85a" },
];
// the flashbulbs: [loop s, knot (0 left of the steps, 1 right)]. 6 to 20 s apart, doubles 0.35 s apart for the notable two
const FLASHES = [[8.0, 0], [17.6, 1], [27.0, 0], [41.0, 1], [48.4, 0], [48.75, 1], [57.5, 0], [66.0, 1], [76.3, 0], [85.5, 1], [94.0, 0], [107.4, 1], [107.8, 0], [116.0, 1]];

// ---------------------------------------------------------------- the still picture
function still(lit) {
  const r = rng(1968), o = [];
  const defs = "";
  o.push(bands(0, 0, W, 700, [SKY[0], "#070a17", "#0a0f22", SKY[1], "#121530", "#191834", SKY[2]]));
  { let s = ""; for (let i = 0; i < 70; i++) s += circ(r() * W, 10 + r() * 250, 0.7 + r() * 1.2, C.paper100, `opacity="${f2(0.15 + r() * 0.45)}"`); o.push(s); }

  // the neighbours either side: lower, darker, a few lit windows
  const side = (x0, x1, seed) => {
    const q = rng(seed); let s = "", x = x0;
    while (x < x1) {
      const w = 70 + q() * 90, top = 230 + q() * 120;
      s += rect(x, top, w + 2, 662 - top, "#141927");
      if (q() < 0.4) s += rect(x + w * 0.2, top - 26, w * 0.18, 26, "#141927");
      for (let yy = top + 26; yy < 600; yy += 46) for (let xx = x + 12; xx < x + w - 18; xx += 30) {
        const on = q() < 0.22;
        s += rect(xx, yy, 14, 24, on ? "#d9a948" : "#10131e", on ? `opacity="${f2(0.45 + q() * 0.4)}"` : "");
        if (on && q() < 0.6) lit.push([xx + 7, 12, 0.22, GOLD]);
      }
      x += w;
    }
    return s;
  };
  o.push(side(-20, 250, 3), side(1350, 1640, 4));

  // the palazzo: nine bays
  const X0 = 240, X1 = 1360, BW = (X1 - X0) / 9, cx = (i) => X0 + BW * (i + 0.5);
  o.push(bands(X0, 160, X1 - X0, 440, ["#1a2033", "#1d2337", "#20273b", "#232a3f", "#262d43", "#2c3246", "#333648"]));
  // the roof's balustrade, urns, cornice and dentils
  o.push(rect(X0 - 6, 112, X1 - X0 + 12, 8, TRIM) + rect(X0 - 6, 142, X1 - X0 + 12, 8, TRIM));
  { let s = ""; for (let x = X0 + 4; x < X1 - 4; x += 17) s += `<path d="M${f2(x)} 142 q -3 -6 0 -11 q 2 -4 0 -9 h 7 q -2 5 0 9 q 3 5 0 11 z" fill="${STONE_L}"/>`; o.push(s); }
  for (let i = 0; i <= 9; i++) { const x = X0 + BW * i; o.push(rect(x - 9, 104, 18, 46, TRIM) + `<path d="M${f2(x - 9)} 104 q 9 -26 18 0 z" fill="${TRIM}"/>`); }
  o.push(rect(X0 - 14, 150, X1 - X0 + 28, 18, TRIM) + rect(X0 - 14, 150, X1 - X0 + 28, 2, "#5a6688"));
  { let s = ""; for (let x = X0 - 10; x < X1 + 10; x += 12) s += rect(x, 168, 6, 6, STONE_L); o.push(s); }
  // pilasters
  for (let i = 0; i <= 9; i++) o.push(rect(X0 + BW * i - 7, 174, 14, 426, STONE_L, 'opacity=".55"'));
  // the attic windows (the centre bay carries a blank cartouche instead)
  for (let i = 0; i < 9; i++) {
    if (i === 4) { o.push(`<ellipse cx="${f2(cx(i))}" cy="212" rx="38" ry="26" fill="${TRIM}"/><ellipse cx="${f2(cx(i))}" cy="212" rx="30" ry="19" fill="#1a2030" stroke="${BRASS}" stroke-width="2.5"/>`); continue; }
    const on = r() < 0.5;
    o.push(rect(cx(i) - 17, 188, 34, 46, on ? "#c08f36" : "#121624", on ? 'opacity=".85"' : "") + rect(cx(i) - 1, 188, 2, 46, "#0d1018", 'opacity=".6"'));
    if (on) lit.push([cx(i), 26, 0.18, GOLD]);
  }
  o.push(rect(X0, 250, X1 - X0, 12, TRIM));
  // the piano nobile: tall arched windows, pediments, sills and little balconies; most of them lit
  const nob = [];
  for (let i = 0; i < 9; i++) {
    const w = i === 4 ? 78 : 62, x = cx(i) - w / 2, top = 290, bot = 440, on = i === 4 || r() < 0.82;
    const ped = i % 2 ? `<path d="M${f2(x - 10)} 284 L${f2(cx(i))} 262 L${f2(x + w + 10)} 284 Z" fill="${TRIM}"/>` : `<path d="M${f2(x - 10)} 284 Q${f2(cx(i))} 254 ${f2(x + w + 10)} 284 Z" fill="${TRIM}"/>`;
    o.push(ped + rect(x - 10, 284, w + 20, 5, TRIM));
    o.push(`<path d="${archD(x, top, w, bot)}" fill="${on ? GOLD2 : "#151a29"}"${on ? ' opacity=".92"' : ""}/>`);
    if (on) {
      // a chandelier's glow deep in the room, then the glazing bars
      o.push(`<path d="${archD(x + w * 0.18, top + w * 0.2, w * 0.64, bot - 10)}" fill="${CREAM}" opacity=".55"/>`);
      o.push(rect(cx(i) - 1.5, top + 8, 3, bot - top - 8, BRASS, 'opacity=".75"') + rect(x, 352, w, 3, BRASS, 'opacity=".75"') + rect(x, 398, w, 3, BRASS, 'opacity=".75"'));
      lit.push([cx(i), w, i === 4 ? 0.55 : 0.42, GOLD]);
      nob.push({ i, x, w, top, bot });
    } else o.push(rect(cx(i) - 1.5, top + 8, 3, bot - top - 8, "#0d1018"));
    o.push(rect(x - 12, 440, w + 24, 7, TRIM));
    let bal = rect(x - 8, 447, w + 16, 4, TRIM);
    for (let bx = x - 4; bx < x + w + 6; bx += 9) bal += rect(bx, 451, 4, 14, STONE_L);
    o.push(bal + rect(x - 8, 465, w + 16, 4, TRIM));
  }
  o.push(rect(X0, 472, X1 - X0, 10, TRIM));
  // the ground floor: rusticated, arched openings, and the door under the awning
  { let s = ""; for (let y = 494; y < 600; y += 18) s += rect(X0, y, X1 - X0, 2, "#0f1320", 'opacity=".55"'); o.push(s); }
  for (let i = 0; i < 9; i++) {
    if (i === 4) continue;
    const on = r() < 0.6;
    o.push(`<path d="${archD(cx(i) - 34, 500, 68, 600)}" fill="${on ? "#c99a45" : "#11151f"}"${on ? ' opacity=".75"' : ""}/>`);
    if (on) lit.push([cx(i), 50, 0.25, GOLD]);
  }
  o.push(glow(800, 560, 150, CREAM, 0.9));
  o.push(`<path d="${archD(746, 486, 108, 600)}" fill="${C.ink700}"/><path d="${archD(754, 494, 92, 600)}" fill="${CREAM}"/><path d="${archD(770, 510, 60, 600)}" fill="#ffffff" opacity=".7"/>`);
  lit.push([800, 110, 0.8, CREAM]);
  // the terrace and the light out of the door
  o.push(rect(0, 600, W, 52, "#1c2130") + `<ellipse cx="800" cy="626" rx="300" ry="40" fill="${WARM}" opacity=".06"/><ellipse cx="800" cy="626" rx="170" ry="26" fill="${WARM}" opacity=".09"/>`);
  // the awning: striped, scalloped, on two brass posts
  {
    const bl = 726, br = 874, fl = 700, fr = 900, by = 474, fy = 556, n = 12;
    let s = `<path d="M${bl} ${by} L${br} ${by} L${fr} ${fy} L${fl} ${fy} Z" fill="${AWN}"/>`;
    for (let k = 0; k < n; k += 2) s += `<path d="M${f2(lerp(bl, br, k / n))} ${by} L${f2(lerp(bl, br, (k + 1) / n))} ${by} L${f2(lerp(fl, fr, (k + 1) / n))} ${fy} L${f2(lerp(fl, fr, k / n))} ${fy} Z" fill="${C.paper200}"/>`;
    s += rect(fl - 2, fy, fr - fl + 4, 10, AWN);
    for (let k = 0; k < n; k++) { const x = lerp(fl, fr, k / n), w = (fr - fl) / n; s += `<path d="M${f2(x)} ${fy + 10} a ${f2(w / 2)} ${f2(w / 2.4)} 0 0 0 ${f2(w)} 0 z" fill="${k % 2 ? C.paper200 : AWN}"/>`; }
    s += rect(fl - 2, fy + 1, fr - fl + 4, 2, GOLD, 'opacity=".7"');
    s += rect(fl + 1, fy + 10, 4, 650 - fy - 10, BRASS) + rect(fr - 5, fy + 10, 4, 650 - fy - 10, BRASS);
    s += `<ellipse cx="800" cy="600" rx="120" ry="40" fill="${CREAM}" opacity=".16"/>`;
    o.push(s);
  }
  // the press at the head of the steps, behind the balustrade (their legs hidden by it)
  // (the press stand here, in layers of their own: see build())
  const cut = o.length;
  // the balustrade along the terrace's edge, broken for the steps, and the piers and lamps at the stair head
  const balus = (a, b) => {
    let s = rect(a, 606, b - a, 9, STONE_L) + rect(a, 606, b - a, 2, "#6a7392", 'opacity=".6"') + rect(a, 644, b - a, 8, STONE_L);
    for (let x = a + 4; x < b - 6; x += 15) s += `<path d="M${f2(x)} 644 q -3 -6 0 -12 q 3 -5 0 -10 h 8 q -3 5 0 10 q 3 6 0 12 z" fill="${STONE}"/>`;
    return s;
  };
  o.push(balus(-10, 600) + balus(1000, 1610));
  const lamp = (x, y, big) => rect(x - 2.5, y, 5, 26, INK) + glow(x, y - 8, big ? 46 : 36, CREAM, 0.9) + circ(x, y - 8, big ? 11 : 9, CREAM) + rect(x - 8, y - 22, 16, 5, BRASS);
  for (const x of [620, 980]) o.push(rect(x - 20, 590, 40, 62, TRIM) + rect(x - 24, 584, 48, 8, "#56618a") + lamp(x, 558, true));
  lit.push([620, 22, 0.7, CREAM], [980, 22, 0.7, CREAM]);
  // the coping and the embankment wall, down to the water
  o.push(rect(0, 652, W, 10, "#3d4766") + rect(0, 652, W, 2, "#6a7392", 'opacity=".7"'));
  o.push(rect(0, 662, W, 180, STONE_D));
  { let s = ""; let row = 0; for (let y = 662; y < 842; y += 22, row++) { s += rect(0, y, W, 2, "#0f121b", 'opacity=".8"'); for (let x = (row % 2) * 46; x < W; x += 92) s += rect(x, y, 2, 22, "#0f121b", 'opacity=".7"'); } o.push(s); }
  o.push(rect(0, 806, W, 36, "#0b0e16", 'opacity=".7"'));
  for (const x of [180, 420, 1180, 1420]) o.push(`<circle cx="${x}" cy="780" r="9" fill="none" stroke="${BRASS}" stroke-width="3" opacity=".6"/>`);

  // the steps: twelve risers from the landing up to the terrace, narrowing as they go back; a carpet runner held by brass rods; the
  // door's light lying down the upper flight
  const hw = (j) => lerp(205, 160, j / STEPS);
  {
    let s = "";
    // the flanks: a sloping parapet each side, from the stair head to the landing piers
    s += `<path d="M600 606 L640 606 L594 790 L556 790 Z" fill="${TRIM}"/><path d="M1000 606 L960 606 L1006 790 L1044 790 Z" fill="${TRIM}"/>`;
    s += `<path d="M600 606 L640 606 L594 790" fill="none" stroke="#6a7392" stroke-width="2" opacity=".6"/><path d="M1000 606 L960 606 L1006 790" fill="none" stroke="#6a7392" stroke-width="2" opacity=".6"/>`;
    for (let j = STEPS; j >= 1; j--) {
      const y = YL - RISE * j, w = hw(j), cw = lerp(118, 90, j / STEPS);
      s += rect(800 - w, y, w * 2, RISE, STONE) + rect(800 - w, y, w * 2, 2.5, "#56618a");
      s += rect(800 - cw / 2, y, cw, RISE, CARPET) + rect(800 - cw / 2, y + RISE - 4, cw, 4, "#6e160a") + rect(800 - cw / 2 - 3, y + 1, cw + 6, 2, GOLD, 'opacity=".85"');
    }
    s += [0.16, 0.1, 0.05].map((op, i) => rect(800 - hw(STEPS), YT + i * 36, hw(STEPS) * 2, 36, WARM, `opacity="${op}"`)).join("");
    // the landing at the water, and its piers and lamps
    s += rect(510, YL, 580, 14, "#353e58") + rect(510, YL, 580, 2, "#6a7392", 'opacity=".6"') + rect(510, YL + 14, 580, 10, "#151a27");
    s += rect(800 - 64, YL, 128, 14, CARPET);
    for (const x of [574, 1026]) s += rect(x - 24, 760, 48, 82, TRIM) + rect(x - 28, 754, 56, 8, "#56618a") + lamp(x, 728, false);
    lit.push([574, 18, 0.6, CREAM], [1026, 18, 0.6, CREAM]);
    // mooring poles, striped, standing in the water either side
    for (const x of [470, 1130]) { for (let y = 690; y < 900; y += 30) s += rect(x - 7, y, 14, 15, C.file700) + rect(x - 7, y + 15, 14, 15, C.paper200); s += circ(x, 688, 9, GOLD); }
    o.push(s);
  }
  // the water
  o.push(rect(0, 842, W, H - 842, WATER) + rect(0, 842, W, 26, "#0e1322", 'opacity=".9"'));
  return { defs, back: merge(o.slice(0, cut).join("")), front: merge(o.slice(cut).join("")), nob };
}
/* Runs of shapes that differ only in where they are (balusters, joints, dentils, lit windows) become one path each: the same picture
   in the same order, a fraction of the elements for a browser to walk when it repaints. */
function merge(svg) {
  const tok = /<rect x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"([^>]*)\/>|<path d="([^"]*)"([^>]*)\/>/g;
  let out = "", last = 0, key = null, ds = [];
  const flush = () => { if (key !== null) out += `<path d="${ds.join("")}"${key.slice(1)}/>`; key = null; ds = []; };
  let m;
  while ((m = tok.exec(svg))) {
    if (m.index !== last) { flush(); out += svg.slice(last, m.index); }
    const isRect = m[1] !== undefined, rest = isRect ? m[5] : m[7];
    const d = isRect ? `M${m[1]} ${m[2]}h${m[3]}v${m[4]}h${-m[3]}z` : m[6];
    const k = "p" + rest;
    if (k !== key) { flush(); key = k; }
    ds.push(isRect ? d : d.replace(/^(?![Mm])/, "M0 0"));
    last = tok.lastIndex;
  }
  flush();
  return out + svg.slice(last);
}

/* Many small rects of one colour and opacity, painted as ONE path: a browser that repaints the water every frame (WebKit on Windows
   has no composited layers) draws a handful of paths instead of a thousand rects. Only for marks that never overlap in a way that shows. */
function buckets() {
  const m = new Map();
  return {
    add(x, y, w, h, fill, op) { const k = fill + "|" + op; if (!m.has(k)) m.set(k, []); m.get(k).push(`M${f2(x)} ${f2(y)}h${f2(w)}v${f2(h)}h${f2(-w)}z`); },
    svg() { let o = ""; for (const [k, d] of m) { const [fill, op] = k.split("|"); o += `<path d="${d.join("")}" fill="${fill}" opacity="${op}"/>`; } return o; },
  };
}
/* the window reflections: a broken streak under each lit window, a dash at a time; two of them, seeded apart, cross-fade */
function reflections(lit, seed) {
  const r = rng(seed), B = buckets();
  for (const [x, w, op, col] of lit) {
    const len = 150 + r() * 200 + op * 160;
    for (let y = 850; y < 850 + len; y += 8 + r() * 4) {
      const f = 1 - (y - 850) / len, dw = Math.max(3, w * (0.25 + r() * 0.7));
      if (r() < 0.18) continue;
      B.add(x - dw / 2 + Math.sin(y * 0.08 + x + seed) * (4 + w * 0.05), y, dw, 2.4 + r() * 1.6, col, (Math.round(Math.max(0, f * op * 0.75) * 20) / 20).toFixed(2));
    }
  }
  return B.svg();
}
/* the ripples: pale dashes, a strip two stage-widths wide (one tile twice) that slides */
function ripples() {
  const r = rng(77), B = buckets();
  for (let i = 0; i < 190; i++) { const y = 856 + Math.pow(r(), 0.8) * 344, w = 16 + r() * 60 * (0.5 + (y - 850) / 350); B.add(r() * W, y, w, 1.6 + (y - 850) / 220, C.file300, (0.06 + Math.floor(r() * 4) * 0.03).toFixed(2)); }
  const one = B.svg();
  return `<g>${one}</g><g transform="translate(${W} 0)">${one}</g>`;
}

// ---------------------------------------------------------------- a boat (drawn docked, its middle at 800; bow to the right)
function boat(k, b) {
  const id = "ld-b" + k, x0 = 500, x1 = 1100;
  let s = `<ellipse cx="800" cy="${WL + 6}" rx="320" ry="9" fill="#03050a" opacity=".7"/>`;
  // the wake, only while it moves
  let wk = "";
  for (let i = 0; i < 4; i++) wk += `<path d="M${x0 - 10} ${WL - 2 + i * 3} q -60 ${3 + i * 2} -${120 + i * 30} ${6 + i * 5}" stroke="${C.file300}" stroke-width="${f2(2 - i * 0.3)}" fill="none" opacity="${f2(0.4 - i * 0.07)}"/>`;
  wk += `<path d="M${x1 + 4} ${WL - 6} q 14 6 30 6" stroke="${C.paper100}" stroke-width="2" fill="none" opacity=".35"/>`;
  s += `<g id="${id}w" visibility="hidden">${wk}</g>`;
  // the boatman at the stern, poling
  s += `<g fill="${INK}"><path d="M512 696 L552 ${WL + 40}" stroke="${INK}" stroke-width="5"/><path d="M522 828 q -4 -50 6 -72 q 8 -10 18 0 q 10 22 4 72 z"/>${circ(536, 742, 9, INK)}${rect(526, 730, 20, 5, INK)}</g>`;
  s += `<path d="M512 696 L552 ${WL + 40}" stroke="${b.strake}" stroke-width="1" opacity=".3"/>`;
  // the hull: long and low, the sheer rising to the bow
  s += `<path d="M${x0} 826 L1074 818 Q1104 812 1116 798 L1112 814 Q1094 846 1048 ${WL + 2} L540 ${WL + 2} Q508 ${WL} ${x0 + 2} 838 Z" fill="${b.hull}"/>`;
  s += `<path d="M${x0} 826 L1074 818 Q1104 812 1116 798" fill="none" stroke="${b.strake}" stroke-width="3" opacity=".85"/>`;
  s += `<path d="M${x0 + 6} 836 L1070 829 Q1094 825 1106 816" fill="none" stroke="${b.strake}" stroke-width="1.5" opacity=".4"/>`;
  s += `<path d="M960 818 L978 798 L1010 798 L1016 816" fill="none" stroke="${C.paper100}" stroke-width="2" opacity=".45"/>`;
  // the lantern on its post at the bow, and its light on the water (two versions, swapped)
  s += rect(1083, 772, 4, 46, INK) + glow(1085, 762, 38, CREAM, 0.9) + rect(1077, 752, 16, 18, CREAM) + rect(1075, 748, 20, 4, BRASS) + circ(1085, 761, 4, GOLD);
  const rr = rng(100 + k), refl = (v) => { let g = ""; for (let y = WL + 6; y < WL + 170; y += 7 + rr() * 4) { const f = 1 - (y - WL) / 170; if (rr() < 0.15) continue; const w = 6 + rr() * 22 * (0.4 + f); g += rect(1085 - w / 2 + (rr() - 0.5) * 10, y, w, 2.2 + rr() * 1.4, v ? GOLD : WARM, `opacity="${f2(0.75 * f)}"`); } return g; };
  s += `<g id="${id}ra">${refl(0)}</g><g id="${id}rb" visibility="hidden">${refl(1)}</g>`;
  return s;
}

// ---------------------------------------------------------------- build
module.exports = function build(opts = {}) {
  const lit = [];
  // the press: dark suits and hats, cameras; two hold theirs up (where the flashes come from)
  const PS = S0 * 0.86;
  const press = [
    [{ heightIn: 69, age: 44, skin: "fair", hair: { style: "short", color: "cloth-brown", hat: { type: "trilby", color: "cloth-charcoal", band: "cloth-black" } }, outfit: { outer: { type: "suit-jacket", color: "cloth-charcoal" }, bottom: { type: "trousers", color: "cloth-charcoal" } }, pose: { arms: { R: "hold", L: "down" } }, props: [{ type: "camera", side: "R" }] }, 520],
    [{ heightIn: 71, age: 33, skin: "tan", hair: { style: "short", color: "cloth-black", hat: { type: "trilby", color: "cloth-graphite", band: "cloth-black" } }, outfit: { outer: { type: "suit-jacket", color: "cloth-graphite" }, bottom: { type: "trousers", color: "cloth-graphite" } }, pose: { arms: { R: "raise", L: "down" } }, props: [{ type: "camera", side: "R" }] }, 562],
    [{ heightIn: 70, age: 39, skin: "brown", hair: { style: "short", color: "cloth-black", hat: { type: "trilby", color: "cloth-charcoal", band: "cloth-black" } }, outfit: { outer: { type: "suit-jacket", color: "cloth-charcoal" }, bottom: { type: "trousers", color: "cloth-charcoal" } }, pose: { arms: { R: "raise", L: "down" } }, props: [{ type: "camera", side: "R" }] }, 1034],
    [{ figure: "fem", heightIn: 65, age: 29, skin: "fair", hair: { style: "bowl-bob", color: "cloth-brown" }, outfit: { outer: { type: "suit-jacket", color: "cloth-graphite" }, bottom: { type: "trousers", color: "cloth-black" } }, pose: { arms: { R: "hold", L: "down" } }, props: [{ type: "camera", side: "R" }] }, 1072],
    [{ heightIn: 68, age: 55, skin: "pale", hair: { style: "short", color: "ink-300", hat: { type: "trilby", color: "cloth-brown", band: "cloth-black" } }, outfit: { outer: { type: "suit-jacket", color: "cloth-brown" }, bottom: { type: "trousers", color: "cloth-brown" } } }, 1108],
  ].map(([spec, x], i) => [figure(spec, "lgp" + i, [{}], PS, true), x, PS]);
  const st = still(lit);

  // where the two raised cameras' flashes are: the press figure's x, a little above its head (the camera is held up by the flash)
  const KNOTS = [[562 - 14, 650 - 71 * 25 * PS * 1.04], [1034 - 14, 650 - 70 * 25 * PS * 1.04]];

  // the guests: a walker each, in a layer the size of the figure, drawn at home (the landing, x 800) and moved from there
  const css = [], layers = [], gdata = [];
  const byBoat = {};
  GUESTS.forEach((g, i) => { (byBoat[g.b] = byBoat[g.b] || []).push(i); });
  GUESTS.forEach((g, i) => {
    const id = "lg" + "abcdef"[i], frames = g.n ? WALK.concat([WAVE]) : WALK;
    const f = figure(g.spec, id, frames, S0);
    const [vx, vy, vw, vh] = f.vb, pad = 6;
    const bx = 800 + vx * S0 - pad, by = YL + vy * S0 - pad, bw = vw * S0 + 2 * pad, bh = vh * S0 + 2 * pad;
    const mates = byBoat[g.b], n = mates.length, at = mates.indexOf(i);
    const lane = n === 1 ? 800 : at === 0 ? 778 : 824, deck = n === 1 ? 800 : at === 0 ? 768 : 838;
    css.push(`#${id}{left:${f2(bx / 16)}%;top:${f2(by / 12)}%;width:${f2(bw / 16)}%;height:${f2(bh / 12)}%;transform-origin:${f2((800 - bx) / bw * 100)}% ${f2((YL - by) / bh * 100)}%}`);
    layers.push(`<svg class="bx mv" id="${id}" viewBox="${f2(bx)} ${f2(by)} ${f2(bw)} ${f2(bh)}" preserveAspectRatio="none" aria-hidden="true">${L.at(f, 800, YL, S0)}</svg>`);
    gdata.push({ id, b: g.b, o: g.o, n: !!g.n, lane, deck, w: f2(bw), h: f2(bh), p: g.n ? 1.4 : 0.9 });
  });
  // the boats, each its own layer
  const BX = 360, BY = 680, BWd = 790, BH = 360;
  const boats = BOATS.map((b, k) => {
    css.push(`#ld-b${k}{left:${f2(BX / 16)}%;top:${f2(BY / 12)}%;width:${f2(BWd / 16)}%;height:${f2(BH / 12)}%}`);
    return `<svg class="bx mv" id="ld-b${k}" viewBox="${BX} ${BY} ${BWd} ${BH}" preserveAspectRatio="none" aria-hidden="true">${boat(k, b)}</svg>`;
  }).join("");
  // four windows with someone passing behind the glass now and then
  const pick = [st.nob[1], st.nob[3], st.nob[st.nob.length - 3], st.nob[st.nob.length - 1]].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i);
  const wins = pick.map((w, k) => {
    const id = "ld-w" + k, x = w.x, y = w.top, ww = w.w, hh = w.bot - w.top;
    css.push(`#${id}{left:${f2(x / 16)}%;top:${f2(y / 12)}%;width:${f2(ww / 16)}%;height:${f2(hh / 12)}%}`);
    const who = `<g fill="#4a3514" opacity=".5"><circle cx="0" cy="${f2(hh * 0.56)}" r="${f2(ww * 0.11)}"/><path d="M${f2(-ww * 0.26)} ${f2(hh + 4)} Q${f2(-ww * 0.26)} ${f2(hh * 0.68)} 0 ${f2(hh * 0.66)} Q${f2(ww * 0.26)} ${f2(hh * 0.68)} ${f2(ww * 0.26)} ${f2(hh + 4)} Z"/></g>`;
    return { html: `<svg class="bx mv" id="${id}" viewBox="0 0 ${f2(ww)} ${f2(hh)}" preserveAspectRatio="none" aria-hidden="true"><defs><clipPath id="${id}c"><path d="${archD(0, 0, ww, hh)}"/></clipPath></defs><g clip-path="url(#${id}c)"><g id="${id}s" transform="translate(-999 0)">${who}</g></g></svg>`, w: f2(ww), P: [29, 41, 35, 47][k], o: [3, 17, 26, 9][k] };
  });
  // the flashbulbs: a small hard burst, and a soft afterglow around it
  const flashes = KNOTS.map(([x, y], k) => {
    const R = 46, id = "ld-f" + k, hid = "ld-h" + k, G = 190;
    css.push(`#${id}{left:${f2((x - R) / 16)}%;top:${f2((y - R) / 12)}%;width:${f2(2 * R / 16)}%;height:${f2(2 * R / 12)}%}`);
    css.push(`#${hid}{left:${f2((x - G) / 16)}%;top:${f2((y - G) / 12)}%;width:${f2(2 * G / 16)}%;height:${f2(2 * G / 12)}%}`);
    let rays = "";
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + 0.2, len = i % 2 ? 26 : 44, w = 3.2, ax = Math.cos(a), ay = Math.sin(a); rays += `<path d="M${f2(R - ay * w)} ${f2(R + ax * w)} L${f2(R + ax * len)} ${f2(R + ay * len)} L${f2(R + ay * w)} ${f2(R - ax * w)} Z" fill="#ffffff"/>`; }
    return `<svg class="bx fl" id="${id}" viewBox="0 0 ${2 * R} ${2 * R}" preserveAspectRatio="none" aria-hidden="true">${circ(R, R, 30, "#ffffff", 'opacity=".35"')}${rays}${circ(R, R, 13, "#ffffff")}</svg><div class="bx fl glow" id="${hid}"></div>`;
  }).join("");

  const V = (id, inner, cls = "tl") => `<svg class="${cls}" id="${id}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${inner}</svg>`;
  css.push(`#ld-ra,#ld-rb{left:0;top:${f2(842 / 12)}%;width:100%;height:${f2((H - 842) / 12)}%}`, `#ld-rip{left:0;top:${f2(842 / 12)}%;width:200%;height:${f2((H - 842) / 12)}%}`);
  const water = `<svg class="bx op mv" id="ld-ra" viewBox="0 842 ${W} ${H - 842}" preserveAspectRatio="none" aria-hidden="true">${reflections(lit, 11)}</svg>` +
    `<svg class="bx op mv" id="ld-rb" viewBox="0 842 ${W} ${H - 842}" preserveAspectRatio="none" aria-hidden="true">${reflections(lit, 29)}</svg>` +
    `<svg class="bx mv" id="ld-rip" viewBox="0 842 ${W * 2} ${H - 842}" preserveAspectRatio="none" aria-hidden="true">${ripples()}</svg>`;
  // the press in two small layers of their own, between the building and the balustrade: a figure is costly to repaint, and a
  // browser without composited layers (WebKit on Windows) repaints what lies under anything that moves
  const pressLayer = (id, list) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [f, x, s] of list) { const [vx, vy, vw, vh] = f.vb; x0 = Math.min(x0, x + vx * s); y0 = Math.min(y0, 650 + vy * s); x1 = Math.max(x1, x + (vx + vw) * s); y1 = Math.max(y1, 650 + (vy + vh) * s); }
    x0 -= 4; y0 -= 4; x1 += 4; y1 += 4;
    css.push(`#${id}{left:${f2(x0 / 16)}%;top:${f2(y0 / 12)}%;width:${f2((x1 - x0) / 16)}%;height:${f2((y1 - y0) / 12)}%}`);
    return `<svg class="bx st" id="${id}" viewBox="${f2(x0)} ${f2(y0)} ${f2(x1 - x0)} ${f2(y1 - y0)}" preserveAspectRatio="none" aria-hidden="true">${list.map(([f, x, s]) => L.at(f, x, 650, s)).join("")}</svg>`;
  };
  const body = V("ld-bk", `<defs>${st.defs}</defs>${st.back}`) + pressLayer("ld-p0", press.slice(0, 2)) + pressLayer("ld-p1", press.slice(2)) + V("ld-fr", st.front) + water + wins.map((w) => w.html).join("") + layers.join("") + boats + flashes;

  const CSS = `.tl{position:absolute;inset:0;width:100%;height:100%;display:block;will-change:transform}
.bx{position:absolute;display:block;overflow:visible;pointer-events:none}
.mv,.st{will-change:transform}
.op{will-change:opacity,transform}
#ld-b0,#ld-b1,#ld-b2,#ld-b3,${gdata.map((g) => "#" + g.id).join(",")}{visibility:hidden}
.fl{opacity:0;will-change:opacity}
.glow{border-radius:50%;background:radial-gradient(circle,rgba(255,250,236,.75) 0,rgba(255,236,190,.32) 22%,rgba(255,226,170,.1) 48%,rgba(255,226,170,0) 70%)}
${css.join("\n")}`;

  const script = `
const LOOP=${LOOP},HOLD=${HOLD},DX=${DX},YL=${YL},RISE=${RISE},STEPS=${STEPS},STEP=.36;
const Q=new URLSearchParams(location.search),T0=Q.has('t')?(+Q.get('t')||0):${T_START};
const BOATS=${JSON.stringify(BOATS.map((b) => ({ s: b.s, i: b.i, d: b.d, o: b.o })))},G=${JSON.stringify(gdata)},FL=${JSON.stringify(FLASHES)};
const WIN=${JSON.stringify(wins.map((w) => ({ w: +w.w, P: w.P, o: w.o })))};
const root=document.documentElement,held=()=>root.classList.contains('b68-fx-off');
const mk=el=>({el,tf:'',v:''});
const tf=(o,s)=>{if(o.tf!==s){o.el.style.transform=s;o.tf=s;}};
const vis=(o,on)=>{const s=on?'visible':'hidden';if(o.v!==s){o.el.style.visibility=s;o.v=s;}};
const op=(o,x)=>{const s=x.toFixed(3);if(o.v!==s){o.el.style.opacity=s;o.v=s;}};
const attr=(el,k,v)=>{if(el.getAttribute(k)!==v)el.setAttribute(k,v);};
// a figure's pose: the versions of every moving part, cut on the visibility attribute (see night() in the generator)
const poses={};
function pose(id,k){let F=poses[id];if(!F){F=poses[id]={cur:0,pts:[]};document.querySelectorAll('[data-fig="'+id+'"] [data-mv]').forEach(p=>{const vs=[];for(const c of p.children)vs.push({el:c,f:c.getAttribute('data-f')||''});F.pts.push(vs);});}
 if(F.cur===k)return;const key=' '+k+' ';for(const vs of F.pts)for(const v of vs){if(v.f.indexOf(key)>=0)v.el.removeAttribute('visibility');else v.el.setAttribute('visibility','hidden');}F.cur=k;}
const bE=BOATS.map((b,k)=>Object.assign(mk($('ld-b'+k)),{ra:$('ld-b'+k+'ra'),rb:$('ld-b'+k+'rb'),wk:$('ld-b'+k+'w')}));
const gE=G.map(g=>mk($(g.id)));
const ra=mk($('ld-ra')),rb=mk($('ld-rb')),rip=mk($('ld-rip'));
const wE=WIN.map((w,k)=>$('ld-w'+k+'s'));
const fE=[0,1].map(k=>mk($('ld-f'+k))),hE=[0,1].map(k=>mk($('ld-h'+k)));
const since=(t,s)=>{let u=t-s;if(u<0)u+=LOOP;return u;};
// a boat's offset from the steps (stage units), or null when it is out of the picture; moving or not
function boatAt(b,t){let u=since(t,b.s);if(u<b.i){const k=1-u/b.i;return {dx:-DX*k*k,mv:true};}u-=b.i;if(u<b.d)return {dx:0,mv:false};u-=b.d;if(u<b.o){const k=u/b.o;return {dx:DX*k*k,mv:true};}return null;}
const bob=(k,c)=>Math.sin(c*1.3+k*2.1)*1.6;
// a guest: where their feet are, their scale and pose, or null when not in the picture
function guestAt(g,t,c){const b=BOATS[g.b];const u=since(t,b.s),ts=b.i+g.o;
 if(u<ts){const a=boatAt(b,t);return a?{x:g.deck+a.dx,y:YL+28+bob(g.b,c),k:1,f:0}:null;}
 let v=u-ts;if(v<.35)return {x:(g.deck+g.lane)/2,y:YL+12,k:1,f:1};if(v<.7)return {x:g.lane,y:YL,k:1,f:2};
 v-=.7;const j=Math.floor(v/STEP)+1;if(j<=STEPS)return {x:g.lane+(800-g.lane)*j/24,y:YL-RISE*j,k:1-.012*j,f:[2,1,2,3][j%4]};
 v-=STEPS*STEP;const xt=g.lane+(800-g.lane)/2;if(v<g.p)return {x:xt,y:YL-RISE*STEPS,k:.856,f:g.n&&v>.15&&v<g.p-.2?4:0};
 v-=g.p;const c2=Math.floor(v/.42)+1;if(c2<=3)return {x:xt+(800-xt)*c2/3,y:YL-RISE*STEPS-16*c2,k:.856-.035*c2,f:[1,3,1][c2-1]};return null;}
let done={},lastT=-1,glowAt=[-9,-9],burst=[0,0];
function paint(t,c,live,wc){
 for(let k=0;k<BOATS.length;k++){const a=boatAt(BOATS[k],t),o=bE[k];vis(o,!!a);if(!a)continue;
  tf(o,'translate3d('+(a.dx/${BWd}*100).toFixed(3)+'%,'+(bob(k,c)/${BH}*100).toFixed(3)+'%,0)');
  attr(o.wk,'visibility',a.mv&&live?'visible':'hidden');const sw=live&&Math.floor(c*3.4+k)%2===1;attr(o.ra,'visibility',sw?'hidden':'visible');attr(o.rb,'visibility',sw?'visible':'hidden');}
 for(let i=0;i<G.length;i++){const g=G[i],s=guestAt(g,t,c),o=gE[i];vis(o,!!s);if(!s)continue;
  tf(o,'translate3d('+((s.x-800)/g.w*100).toFixed(2)+'%,'+((s.y-YL)/g.h*100).toFixed(2)+'%,0) scale('+s.k.toFixed(3)+')');pose(g.id,s.f);}
 // the water steps ten times a second: slow enough to look smooth, and a browser that repaints it does so a third as often
 if(wc!==null){wc=Math.floor(wc*10)/10;const a=.5+.5*Math.sin(wc*.42);op(ra,.25+.75*a);op(rb,1-.75*a);
  tf(ra,'translate3d('+(Math.sin(wc*.17)*.35).toFixed(3)+'%,0,0)');tf(rb,'translate3d('+(Math.sin(wc*.13+2)*-.35).toFixed(3)+'%,0,0)');
  tf(rip,'translate3d('+(-((wc*9)%1600)/3200*100).toFixed(3)+'%,0,0)');}else{op(ra,.75);op(rb,.25);}
 for(let k=0;k<WIN.length;k++){const w=WIN[k];let x=-999;if(live){const ph=(Math.floor(c*10)/10+w.o)%w.P;if(ph<8)x=-w.w*.6+w.w*2.2*ph/8;}else if(k===1)x=w.w*.62;
  attr(wE[k],'transform','translate('+x.toFixed(1)+' 0)');}
 // the flashbulbs: a burst is on for one painted frame, then the afterglow fades over a second
 for(let k=0;k<2;k++)if(burst[k]){burst[k]=0;op(fE[k],0);}
 if(!live){for(let k=0;k<2;k++){op(fE[k],0);op(hE[k],0);}glowAt=[-9,-9];lastT=t;return;}
 if(t<lastT)done={};lastT=t;
 for(let e=0;e<FL.length;e++){const [ft,k]=FL[e];if(!done[e]&&t>=ft&&t<ft+.3){done[e]=1;burst[k]=1;op(fE[k],1);glowAt[k]=t;}}
 for(let k=0;k<2;k++){const u=since(t,glowAt[k]);op(hE[k],!burst[k]&&u<1.1?.85*Math.pow(1-u/1.1,2):burst[k]?1:0);}
}
loop((dt,c)=>{const h=held();if(h||reduce){paint(HOLD,0,false,h?null:c);return;}paint((c+T0)%LOOP,c,true,c);});
`;
  return L.build({ file: "night-landing.html", out: opts.out, title: "The landing", fonts: [], body, css: CSS, script, grain: 0.14, vignette: 0.5, bg: "#05070d", fps: 30 });
};
if (require.main === module) module.exports();
