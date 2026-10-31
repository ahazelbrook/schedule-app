// The Sunrise Ball, opening: a 30-second silent cinematic for the score (b68g-s04), pinned on the iPad after the engagement roll
// while the GM narrates. Four shots in the s04 briefing deck's look, so the Veil is the building the players were shown (slide 02's
// palazzo, slide 06's Ironclad, slide 04's chandelier):
//   A  the crane: down out of the sky over Silkshore's rooftops, pushing in to the Veil, the landing and the gondola queue
//   B  the landing: the water door, Ironclad either side who don't drink and don't dance, a gondola coming in, flashbulbs
//   C  the gold-leaf name over the door, then through the glass to the chandelier, its sunlamp still dark (it lights at midnight)
//   D  the title, held
// Everything in it is public (the deck and the programme show it all). Pin only, no sound, plays once and holds on the title; to
// replay, pin another scene then this one again. `?t=12` starts it twelve seconds in.
"use strict";
const L = require("../lib.js");
const { C, f2, rng, esc } = L;

const TITLE = "THE SUNRISE BALL";
// seconds: where each shot starts (the crane is 0)
const T = { landing: 11, door: 18.5, title: 26.5 };
const W = 1600, H = 1200;
const GOLD = C.caution500, GOLD2 = "#f6dc7a", G7 = C.caution700, BRASS = C.caution900, DEEP = C.alarm900, DEEPER = "#430c05";
const WATER = "#0c0a0c", CREAM = "#fff4d6", INK = "#100c0b", RED = "#c8321c";

const rect = (x, y, w, h, fill, extra = "") => `<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" fill="${fill}" ${extra}/>`;
const circ = (x, y, r, fill, extra = "") => `<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(r)}" fill="${fill}" ${extra}/>`;
/* an arched opening: left edge x, top of the arch, width, down to bottom */
const archD = (x, top, w, bottom) => { const r = w / 2; return `M${f2(x)} ${f2(bottom)} L${f2(x)} ${f2(top + r)} A${f2(r)} ${f2(r)} 0 0 1 ${f2(x + w)} ${f2(top + r)} L${f2(x + w)} ${f2(bottom)} Z`; };

/* A gondola side-on, prow to the left, waterline at y under the prow end, L long (the deck's scene.js). */
function gondola(x, y, Lh, fill, gold) {
  const h = Lh * 0.055;
  const hull = `M${f2(x)} ${f2(y - h * 3.2)} C${f2(x + Lh * 0.04)} ${f2(y - h * 1.2)} ${f2(x + Lh * 0.12)} ${f2(y + h * 0.8)} ${f2(x + Lh * 0.3)} ${f2(y + h * 0.9)}` +
    ` L${f2(x + Lh * 0.78)} ${f2(y + h * 0.9)} C${f2(x + Lh * 0.92)} ${f2(y + h * 0.8)} ${f2(x + Lh * 0.98)} ${f2(y - h * 0.6)} ${f2(x + Lh)} ${f2(y - h * 2.4)}` +
    ` L${f2(x + Lh * 0.97)} ${f2(y - h * 0.4)} C${f2(x + Lh * 0.9)} ${f2(y - h * 0.2)} ${f2(x + Lh * 0.85)} ${f2(y - h * 0.15)} ${f2(x + Lh * 0.78)} ${f2(y - h * 0.15)}` +
    ` L${f2(x + Lh * 0.25)} ${f2(y - h * 0.15)} C${f2(x + Lh * 0.1)} ${f2(y - h * 0.3)} ${f2(x + Lh * 0.04)} ${f2(y - h * 1.6)} ${f2(x + Lh * 0.02)} ${f2(y - h * 3.0)} Z`;
  let ferro = "";
  for (let i = 0; i < 6; i++) ferro += rect(x + Lh * 0.012 + i * h * 0.12, y - h * (2.9 - i * 0.33), h * 0.9, h * 0.16, gold);
  // a faint rim of lamplight along the hull, so a black boat reads on black water
  return `<path d="${hull}" fill="${fill}" stroke="${CREAM}" stroke-opacity=".16" stroke-width="${f2(Math.max(1, h * 0.1))}"/><path d="M${f2(x + Lh * 0.3)} ${f2(y - h * 0.1)} L${f2(x + Lh * 0.78)} ${f2(y - h * 0.1)}" stroke="${gold}" stroke-width="${f2(Math.max(1, h * 0.12))}" opacity=".7"/>` + ferro;
}
/* masked passengers, seated, facing us: n heads 30 apart at scale 1 (the deck's slide 02) */
function passengers(x, y, n, seed, s = 1) {
  const r = rng(seed); let o = "";
  for (let p = 0; p < n; p++) {
    const px = x + p * 30 * s, hh = (34 + r() * 8) * s;
    o += `<path d="M${f2(px - 12 * s)} ${f2(y)} Q${f2(px - 12 * s)} ${f2(y - hh * 0.6)} ${f2(px)} ${f2(y - hh * 0.62)} Q${f2(px + 12 * s)} ${f2(y - hh * 0.6)} ${f2(px + 12 * s)} ${f2(y)} Z" fill="${INK}"/>`;
    o += circ(px, y - hh * 0.8, 9 * s, INK) + rect(px - 8 * s, y - hh * 0.84, 16 * s, 4 * s, GOLD, `rx="${f2(2 * s)}"`);
  }
  return o;
}
/* the gondolier at the stern, standing, his oar in the water; (x, y) is where he stands on the hull, s his scale (1 = 100 px) */
function gondolier(x, y, s, fill) {
  return `<g transform="translate(${f2(x)} ${f2(y)}) scale(${f2(s)})"><path d="M0 -84 L-52 48" stroke="${fill}" stroke-width="5"/>` +
    `<path d="M-16 -6 q 26 -8 18 -76 l 14 0 q 8 62 -18 78 z" fill="${fill}"/>${circ(0, -96, 12, fill)}</g>`;
}
/* a lantern on a short post at the prow */
const lantern = (x, y, s) => rect(x - 1.2 * s, y - 16 * s, 2.4 * s, 16 * s, INK) + circ(x, y - 19 * s, 11 * s, CREAM, 'opacity=".16"') + circ(x, y - 19 * s, 4 * s, GOLD);

// ---------------------------------------------------------------- A · the crane
// The world is slide 02's own coordinates (1260 x 840, the waterline at 560), carried out far beyond its frame on every side.
function shotA() {
  const R = rng(68), lit = [], o = [], Wl = 560;
  // the sky and its stars, and Silkshore's far rooftops: their own layers, for parallax
  let sky = rect(-4000, -4000, 9000, 9000, "#181418") + rect(-4000, 300, 9000, 300, "#201a1e");
  { const r = rng(5); let st = ""; for (let i = 0; i < 170; i++) st += circ(-1400 + r() * 4100, -1500 + r() * 1800, 0.7 + r() * 1.3, C.paper100, `opacity="${f2(0.15 + r() * 0.45)}"`); sky += st; }
  let far = "";
  { const r = rng(9); let x = -1600; while (x < 2900) {
    const w = 60 + r() * 150, h = 130 + r() * 270, top = Wl - h;
    far += rect(x, top, w, h + 40, "#2a2226");
    if (r() < 0.16) far += circ(x + w / 2, top, w * 0.42, "#2a2226");
    else if (r() < 0.12) far += `<path d="M${f2(x + w / 2 - 9)} ${f2(top)} L${f2(x + w / 2)} ${f2(top - 120)} L${f2(x + w / 2 + 9)} ${f2(top)} Z" fill="#2a2226"/>`;
    for (let yy = top + 20; yy < Wl - 20; yy += 34) for (let xx = x + 12; xx < x + w - 14; xx += 26) if (r() < 0.07) far += rect(xx, yy, 10, 16, G7, 'opacity=".4"');
    x += w + 6;
  } }
  // the neighbours: slide 02's two blocks, and two more beyond them
  const block = (x, w, top, seed) => {
    const r = rng(seed); let s = rect(x, top, w, Wl - top, "#231d20");
    for (let yy = top + 26; yy < Wl - 30; yy += 44) for (let xx = x + 18; xx < x + w - 20; xx += 36) {
      const on = r() < 0.18; s += rect(xx, yy, 16, 24, on ? G7 : "#2e2629", on ? 'opacity=".55"' : "");
      if (on) lit.push([xx + 8, 16, yy, yy + 24, 0.35]);
    }
    return s;
  };
  o.push(block(-460, 440, 290, 21), block(-10, 250, 250, 3), block(1030, 250, 196, 9), block(1290, 470, 270, 17));
  // the Veil: slide 02's palazzo, ketchup red and mustard gold
  const X0 = 230, X1 = 1030;
  o.push(rect(X0, 180, X1 - X0, Wl - 180, DEEP), rect(X0, 470, X1 - X0, Wl - 470, DEEPER));
  o.push(`<path d="M430 ${Wl} Q630 300 830 ${Wl} Z" fill="#7d1a0b"/><path d="M500 ${Wl} Q630 380 760 ${Wl} Z" fill="#94200d"/>`);
  for (const [y, h] of [[172, 14], [286, 8], [378, 8], [466, 10]]) o.push(rect(X0 - 8, y, X1 - X0 + 16, h, BRASS) + rect(X0 - 8, y, X1 - X0 + 16, 2, G7));
  o.push(rect(X0 - 8, 148, X1 - X0 + 16, 6, BRASS));
  for (let bx = X0; bx < X1; bx += 16) o.push(rect(bx, 154, 7, 18, BRASS));
  o.push(`<path d="M520 172 L630 96 L740 172 Z" fill="${DEEP}"/><path d="M520 172 L630 96 L740 172" fill="none" stroke="${G7}" stroke-width="5"/>`);
  for (let k = 0; k < 9; k++) { const a = Math.PI + (k + 0.5) / 9 * Math.PI; o.push(`<path d="M630 162 L${f2(630 + Math.cos(a) * 52 - Math.sin(a) * 4)} ${f2(162 + Math.sin(a) * 52 + Math.cos(a) * 4)} L${f2(630 + Math.cos(a) * 52 + Math.sin(a) * 4)} ${f2(162 + Math.sin(a) * 52 - Math.cos(a) * 4)} Z" fill="${GOLD}"/>`); }
  o.push(`<path d="M600 162 A30 30 0 0 1 660 162 Z" fill="${GOLD}"/>`);
  const arch = (cx, top, w, h, on, op) => {
    const x = cx - w / 2, r = w / 2;
    let s = `<path d="${archD(x, top, w, top + h)}" fill="${on ? GOLD : "#2a1712"}"${op ? ` opacity="${op}"` : ""}/>`;
    if (on) {
      s += `<path d="M${f2(x + w * 0.2)} ${f2(top + h * 0.55)} L${f2(x + w * 0.2)} ${f2(top + r * 0.9)} A${f2(r * 0.8)} ${f2(r * 0.8)} 0 0 1 ${f2(x + w * 0.8)} ${f2(top + r * 0.9)} L${f2(x + w * 0.8)} ${f2(top + h * 0.55)} Z" fill="${GOLD2}"/>`;
      s += rect(cx - 1.5, top + r * 0.4, 3, h - r * 0.4, BRASS) + rect(x, top + h * 0.58, w, 3, BRASS);
      lit.push([cx, w, top, top + h, op || 1]);
    }
    return s;
  };
  const cols = 9, step = (X1 - X0) / cols;
  for (let i = 0; i < cols; i++) {
    const cx = X0 + step * (i + 0.5);
    o.push(arch(cx, 206, 30, 58, R() > 0.35, 0.9), arch(cx, 300, 36, 66, true), arch(cx, 392, 42, 66, true), rect(cx - 30, 452, 60, 5, BRASS));
  }
  for (let j = 0; j < 7; j++) { const ax = X0 + 60 + j * ((X1 - X0 - 120) / 6); if (Math.abs(ax - 630) < 60) continue; o.push(arch(ax, 488, 58, 72, true)); }
  o.push(`<path d="M560 ${Wl} L560 520 A70 70 0 0 1 700 520 L700 ${Wl} Z" fill="${GOLD}"/><path d="M584 ${Wl} L584 524 A46 46 0 0 1 676 524 L676 ${Wl} Z" fill="${CREAM}"/>`);
  lit.push([630, 140, 470, Wl, 1]);
  // the landing: a pontoon, a red carpet, striped poles, two lamps
  o.push(rect(470, Wl - 4, 320, 18, BRASS) + rect(470, Wl - 4, 320, 3, G7) + rect(604, Wl - 4, 52, 18, RED));
  for (const px of [440, 476, 784, 820]) { for (let yy = 470; yy < 640; yy += 22) o.push(rect(px - 5, yy, 10, 11, RED) + rect(px - 5, yy + 11, 10, 11, GOLD)); o.push(circ(px, 466, 8, GOLD)); }
  for (const lx of [540, 720]) { o.push(rect(lx - 2, 490, 4, 66, C.ink900) + circ(lx, 486, 40, CREAM, 'opacity=".10"') + circ(lx, 486, 18, CREAM, 'opacity=".25"') + rect(lx - 7, 476, 14, 20, CREAM)); lit.push([lx, 16, 476, 496, 0.8]); }
  // the water, the reflections broken into dashes (their own group, for the shimmer), and interference lines
  o.push(rect(-1600, Wl, 4600, 1400, WATER));
  let ref = "";
  for (const Lt of lit) {
    const [cx, w, top] = Lt, len = 40 + (Wl - top) * 0.45;
    for (let yy = Wl + 5; yy < Wl + len; yy += 10) {
      const f = 1 - (yy - Wl) / len, dw = w * (0.4 + R() * 0.6), off = Math.sin(yy * 0.07 + cx) * 4;
      ref += rect(cx - dw / 2 + off, yy, dw, 2.4, w > 100 ? CREAM : GOLD, `opacity="${Math.max(0, f * 0.5 * Lt[4]).toFixed(2)}"`);
    }
  }
  o.push(`<g id="aRef">${ref}</g>`);
  for (let wl = 0; wl < 16; wl++) { const yy = Wl + 16 + wl * 21; let d = `M-1600 ${yy}`; for (let xx = -1600; xx <= 3000; xx += 60) d += ` Q${xx + 30} ${yy + (wl % 2 ? 3 : -3)} ${xx + 60} ${yy}`; o.push(`<path d="${d}" stroke="${C.paper100}" stroke-width="1" fill="none" opacity=".05"/>`); }
  // the queue: gondolas waiting their turn at the landing, lanterns lit, running back towards us and out of frame (each drawn at
  // its origin, placed by the page every frame, the furthest first); then one leaving empty, and one close by
  const QN = 14;
  for (let i = 0; i < QN; i++) {
    const r = rng(40 + i);
    o.push(`<g id="q${i}">${gondola(0, 0, 170, "#0f0b0b", GOLD)}${passengers(50, -7, 1 + Math.floor(r() * 3), 50 + i)}${gondolier(166, -6, 0.42, "#0f0b0b")}${lantern(16, -14, 1)}</g>`);
  }
  o.push(`<g id="aOut1">${gondola(560, 640, 220, "#0d0909", GOLD)}${gondolier(776, 632, 0.53, "#0d0909")}${lantern(578, 626, 1.2)}</g>`);
  o.push(`<g id="aClose"><ellipse cx="420" cy="760" rx="300" ry="40" fill="${WATER}" opacity=".85"/>${passengers(330, 736, 3, 11)}${gondola(200, 752, 420, "#080606", GOLD)}${gondolier(612, 752, 1, "#080606")}${lantern(240, 712, 2)}</g>`);
  // fog lying on the canal, and mist the camera comes down through: each bank three soft layers, so it has no hard edge
  const bank = (y, h, op) => rect(-3000, y - h * 0.4, 8000, h * 1.8, C.paper100, `opacity="${f2(op * 0.3)}"`) + rect(-3000, y, 8000, h, C.paper100, `opacity="${f2(op * 0.4)}"`) + rect(-3000, y + h * 0.3, 8000, h * 0.4, C.paper100, `opacity="${f2(op * 0.4)}"`);
  const fog = `<g id="aDrift">${bank(530, 56, 0.09)}${bank(612, 90, 0.06)}${bank(300, 50, 0.04)}${bank(-300, 170, 0.05)}${bank(10, 80, 0.04)}</g>`;
  // two mooring poles close to the lens, rising into frame as the camera comes down
  let poles = "";
  for (const px of [96, 1186]) { for (let yy = 470; yy < 1700; yy += 34) poles += rect(px - 13, yy, 26, 17, RED) + rect(px - 13, yy + 17, 26, 17, GOLD); poles += circ(px, 462, 17, GOLD); }
  return { svg: `<g id="aSky">${sky}</g><g id="aFar">${far}</g><g id="aNear">${o.join("")}</g><g id="aFog">${fog}</g><g id="aPoles">${poles}</g>`, QN };
}

// ---------------------------------------------------------------- B · the landing
const IRONCLAD = {
  heightIn: 76, shape: "rect", build: 1.22, heads: 7.4, skin: "fair", age: 44,
  pose: { stance: "square", arms: { R: "down", L: "down" }, head: { tilt: -2 } },
  head: { shape: "wedge", ears: "cauliflower" },
  face: { eyes: "deepset", brows: "heavy", nose: "broken", mouth: "grim", expression: "stern" },
  hair: { style: "crew", color: "cloth-graphite" },
  outfit: { base: { type: "shirt", color: "cloth-white" }, neck: { type: "bow-tie", color: "cloth-black" },
    outer: { type: "suit-jacket", color: "cloth-black" }, bottom: { type: "trousers", color: "cloth-black" }, feet: { type: "oxfords", color: "cloth-black" } },
};
const IC_S = 0.3; // px per kit unit: 76 in tall is 570 px
function shotB() {
  const o = [];
  o.push(rect(-200, -200, 2000, 1210, DEEP), rect(-200, 640, 2000, 370, DEEPER));
  o.push(`<path d="M260 1010 Q800 150 1340 1010 Z" fill="#7d1a0b"/><path d="M430 1010 Q800 320 1170 1010 Z" fill="#94200d"/>`);
  o.push(rect(-200, 40, 2000, 16, BRASS) + rect(-200, 40, 2000, 3, G7) + rect(-200, 600, 2000, 12, BRASS) + rect(-200, 600, 2000, 3, G7));
  // the gold-leaf name over the door
  o.push(`<text x="803" y="194" text-anchor="middle" font-family="Libre Caslon Text" font-weight="700" font-size="62" letter-spacing="10" fill="#3a0a04">THE VELVET VEIL</text>` +
    `<text x="800" y="190" text-anchor="middle" font-family="Libre Caslon Text" font-weight="700" font-size="62" letter-spacing="10" fill="${GOLD}">THE VELVET VEIL</text>`);
  // the arcade either side, and the water door, lit from inside
  for (const ax of [160, 1300]) o.push(`<path d="${archD(ax, 380, 140, 610)}" fill="${GOLD}"/><path d="${archD(ax + 28, 410, 84, 600)}" fill="${GOLD2}"/>` + rect(ax + 68, 420, 4, 180, BRASS));
  o.push(`<path d="${archD(560, 250, 480, 990)}" fill="${GOLD}"/><path d="${archD(592, 282, 416, 990)}" fill="${CREAM}"/>`);
  // the guests going in, backs to us, black on the light; the ties of their masks catch it
  const guest = (x, h, gown, seed) => {
    const r = rng(seed), hr = h * 0.075, top = 985 - h, sw = h * (gown ? 0.11 : 0.135);
    let s = circ(x, top + hr, hr, INK) + rect(x - hr * 0.45, top + hr * 1.6, hr * 0.9, hr * 0.9, INK);
    if (gown) s += `<path d="M${f2(x - sw)} ${f2(top + h * 0.2)} Q${f2(x)} ${f2(top + h * 0.16)} ${f2(x + sw)} ${f2(top + h * 0.2)} L${f2(x + sw * 0.8)} ${f2(top + h * 0.5)} L${f2(x + sw * 1.5)} 985 L${f2(x - sw * 1.5)} 985 L${f2(x - sw * 0.8)} ${f2(top + h * 0.5)} Z" fill="${INK}"/>` + circ(x, top + hr * 0.2, hr * 0.55, INK);
    else { const m = sw * 1.12; s += `<path d="M${f2(x - m)} ${f2(top + h * 0.21)} Q${f2(x)} ${f2(top + h * 0.17)} ${f2(x + m)} ${f2(top + h * 0.21)} L${f2(x + m * 1.06)} ${f2(top + h * 0.54)} L${f2(x + m * 0.66)} ${f2(top + h * 0.57)} L${f2(x + m * 0.56)} 985 L${f2(x + m * 0.08)} 985 L${f2(x)} ${f2(top + h * 0.62)} L${f2(x - m * 0.08)} 985 L${f2(x - m * 0.56)} 985 L${f2(x - m * 0.66)} ${f2(top + h * 0.57)} L${f2(x - m * 1.06)} ${f2(top + h * 0.54)} Z" fill="${INK}"/>`; }
    const ty = top + hr * 0.95, dir = r() < 0.5 ? -1 : 1;
    s += `<path d="M${f2(x)} ${f2(ty)} q ${f2(dir * hr * 0.7)} ${f2(hr * 0.9)} ${f2(dir * hr * 0.3)} ${f2(hr * 2.1)}" stroke="${GOLD}" stroke-width="${f2(hr * 0.16)}" fill="none"/><path d="M${f2(x)} ${f2(ty)} q ${f2(dir * hr * 1.1)} ${f2(hr * 0.6)} ${f2(dir * hr * 1.0)} ${f2(hr * 1.7)}" stroke="${GOLD}" stroke-width="${f2(hr * 0.12)}" fill="none"/>`;
    return s;
  };
  const guests = guest(720, 300, true, 3) + guest(800, 330, false, 4) + guest(905, 290, true, 6);
  // everything in front of the guests; `o` above is the wall behind them
  const back = o.splice(0);
  // the glazing over the door: the fanlight's spokes and the mullions
  let gl = "";
  for (let k = 1; k < 8; k++) { const a = Math.PI + k / 8 * Math.PI; gl += `<path d="M800 490 L${f2(800 + Math.cos(a) * 208)} ${f2(490 + Math.sin(a) * 208)}" stroke="${G7}" stroke-width="5" opacity=".55"/>`; }
  gl += rect(592, 487, 416, 7, BRASS, 'opacity=".6"') + rect(797, 490, 6, 500, BRASS, 'opacity=".45"') + `<path d="M690 490 A110 110 0 0 1 910 490" stroke="${G7}" stroke-width="5" fill="none" opacity=".55"/>`;
  o.push(gl);
  // lamps and striped poles
  for (const lx of [420, 1180]) o.push(rect(lx - 5, 600, 10, 390, C.ink900) + circ(lx, 568, 90, CREAM, 'opacity=".09"') + circ(lx, 568, 40, CREAM, 'opacity=".22"') + rect(lx - 15, 548, 30, 42, CREAM) + rect(lx - 19, 540, 38, 8, BRASS));
  for (const px of [300, 362, 1238, 1300]) { for (let yy = 640; yy < 1220; yy += 40) o.push(rect(px - 10, yy, 20, 20, RED) + rect(px - 10, yy + 20, 20, 20, GOLD)); o.push(circ(px, 632, 15, GOLD)); }
  // the landing and the carpet, then the water
  o.push(`<path d="M690 985 L910 985 L944 1018 L656 1018 Z" fill="${RED}"/>`);
  o.push(rect(180, 985, 476, 33, BRASS) + rect(944, 985, 476, 33, BRASS) + rect(180, 985, 1240, 4, G7));
  o.push(rect(-200, 1018, 2000, 400, WATER));
  let ref = "";
  { const r = rng(12);
    for (const [cx, w, op, col] of [[800, 380, 0.5, CREAM], [230, 110, 0.45, GOLD], [1370, 110, 0.45, GOLD], [420, 28, 0.6, CREAM], [1180, 28, 0.6, CREAM]])
      for (let yy = 1026; yy < 1200; yy += 12) { const f = 1 - (yy - 1018) / 200; const dw = w * (0.35 + r() * 0.6); ref += rect(cx - dw / 2 + Math.sin(yy * 0.09 + cx) * 6, yy, dw, 3, col, `opacity="${(f * op).toFixed(2)}"`); } }
  // Ironclad either side of the door, in dinner jackets, earpieces in; they watch the boats
  const icL = L.fig(Object.assign({}, IRONCLAD, { id: "icL" }), { id: "icL", place: IC_S, frames: [{}, { pose: { head: { tilt: 3, yaw: 24 } } }, { pose: { head: { tilt: -2, yaw: -12 } } }] });
  const icR = L.fig(Object.assign({}, IRONCLAD, { id: "icR", skin: "brown", build: 1.3, hair: { style: "bald" } }), { id: "icR", place: IC_S, frames: [{}, { pose: { head: { tilt: 4, yaw: -24 } } }, { pose: { head: { tilt: 0, yaw: 14 } } }] });
  o.push(L.at(icL, 505, 990, IC_S), L.at(icR, 1095, 990, IC_S));
  // a gondola drawing up to the landing in front of them, its guests masked in gold
  const gon = passengers(170, 1052, 3, 21, 1.6) + gondola(0, 1060, 620, "#080606", GOLD) + gondolier(596, 1056, 1.3, "#080606") + lantern(40, 976, 2.4);
  // flashbulbs from the press on the landing, out of frame
  const flash = (x, y, rr, seed) => {
    const r = rng(seed); let rays = "";
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 + r() * 0.2, len = rr * (i % 2 ? 1.6 : 2.6), w = rr * 0.14, ax = Math.cos(a), ay = Math.sin(a); rays += `<path d="M${f2(x - ay * w)} ${f2(y + ax * w)} L${f2(x + ax * len)} ${f2(y + ay * len)} L${f2(x + ay * w)} ${f2(y - ax * w)}Z" fill="#fffaf0" opacity=".85"/>`; }
    return circ(x, y, rr * 3.2, CREAM, 'opacity=".14"') + circ(x, y, rr * 1.7, CREAM, 'opacity=".3"') + rays + circ(x, y, rr, "#ffffff");
  };
  const flashes = [[30, 720, 34, 1], [1580, 650, 30, 2], [60, 820, 26, 3]];
  // Its own layers, each composited, like the night tram: the push-in scales the whole stack with a CSS transform, and only the
  // small layers move inside it, so the two figures are never repainted for the camera (they cut only when they glance)
  const layer = (id, inner, moving) => `<svg class="tl${moving ? " mv" : ""}" id="${id}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">${inner}</svg>`;
  const html = `<div id="bCam">${layer("bBack", back.join(""))}${layer("bGuests", guests, true)}${layer("bFront", o.join(""))}${layer("bRef", ref, true)}${layer("bGon", gon, true)}</div>` +
    layer("bFlash", flashes.map((f, i) => `<g id="bF${i}" style="display:none">${flash(...f)}</g>`).join("") + rect(0, 0, W, H, "#fffaf0", 'id="bWhite" opacity="0"'));
  return { html, flashes: flashes.length };
}

// ---------------------------------------------------------------- C · the name, then through the glass
const CH = { x: 800, y: 380 }; // the chandelier's heart, in the ballroom's coordinates
function shotC() {
  // the ballroom: the ceiling's rings unlit, the chandelier's bulbs burning, its sunlamp dark until midnight
  const i = [], drops = [];
  i.push(rect(-2400, -2400, 6400, 6400, DEEPER));
  for (let r = 1900; r > 0; r -= 70) i.push(circ(CH.x, CH.y, r, (r / 70 | 0) % 2 ? DEEPER : DEEP));
  i.push(circ(CH.x, CH.y, 460, CREAM, 'opacity=".05"'));
  for (let y = CH.y - 70; y > -900; y -= 26) i.push(`<ellipse cx="${CH.x}" cy="${y}" rx="7" ry="13" fill="none" stroke="${G7}" stroke-width="3.5"/>`);
  const tiers = [[425, CH.y + 24], [300, CH.y + 6], [188, CH.y - 8]];
  for (let s = 0; s < 14; s++) { const a = s / 14 * Math.PI * 2; i.push(`<path d="M${CH.x} ${CH.y} L${f2(CH.x + Math.cos(a) * 425)} ${f2(CH.y + 24 + Math.sin(a) * 425 * 0.34)}" stroke="${BRASS}" stroke-width="8"/>`); }
  tiers.forEach(([rx, cy], n) => {
    const ry = rx * 0.34;
    i.push(`<ellipse cx="${CH.x}" cy="${cy}" rx="${rx}" ry="${f2(ry)}" fill="none" stroke="${BRASS}" stroke-width="15"/><ellipse cx="${CH.x}" cy="${cy - 3}" rx="${rx}" ry="${f2(ry)}" fill="none" stroke="${GOLD}" stroke-width="3.5"/>`);
    const nd = Math.round(rx / 12);
    for (let d = 0; d < nd; d++) {
      const b = d / nd * Math.PI * 2, x = CH.x + Math.cos(b) * rx, yy = cy + Math.sin(b) * ry, len = 20 + (d % 3) * 10;
      i.push(`<path d="M${f2(x)} ${f2(yy)} L${f2(x)} ${f2(yy + len)}" stroke="${G7}" stroke-width="1.8"/><path d="M${f2(x)} ${f2(yy + len)} l -6 11 l 6 11 l 6 -11 z" fill="${d % 4 ? "#fffaf0" : GOLD}"/>`);
      drops.push([f2(x), f2(yy + len + 11)]);
    }
    for (let c = 0; c < 10 + n * 2; c++) { const e = (c + 0.5) / (10 + n * 2) * Math.PI * 2, bx = CH.x + Math.cos(e) * rx, by = cy + Math.sin(e) * ry - 5; i.push(circ(bx, by, 17, CREAM, 'opacity=".22"') + circ(bx, by, 7, "#ffffff")); }
  });
  // the sunlamp at the heart of it: a dark glass globe in a brass cage
  i.push(circ(CH.x, CH.y, 104, "#241310") + `<ellipse cx="${CH.x}" cy="${CH.y}" rx="104" ry="104" fill="none" stroke="${G7}" stroke-width="5"/>`);
  for (const rx of [70, 34]) i.push(`<ellipse cx="${CH.x}" cy="${CH.y}" rx="${rx}" ry="104" fill="none" stroke="${BRASS}" stroke-width="4"/>`);
  i.push(`<ellipse cx="${CH.x}" cy="${CH.y}" rx="104" ry="30" fill="none" stroke="${BRASS}" stroke-width="4"/><path d="M${CH.x - 70} ${CH.y - 52} A86 86 0 0 1 ${CH.x - 10} ${CH.y - 84}" stroke="${CREAM}" stroke-width="7" fill="none" opacity=".3" stroke-linecap="round"/>`);
  // the crowd, backs to us, masks tied on, the gold light along their tops
  let crowd = "", ties = "";
  const r = rng(77);
  for (let k = 0; k < 12; k++) {
    const x = -260 + k * 190 + (r() - 0.5) * 60, y = 930 + r() * 70, hr = 44 + r() * 10, kind = Math.floor(r() * 3);
    let s = `<path d="M${f2(x - 2.9 * hr)} ${f2(y + 16 * hr)} C${f2(x - 2.9 * hr)} ${f2(y + 2 * hr)} ${f2(x - 1.7 * hr)} ${f2(y + 1.35 * hr)} ${f2(x)} ${f2(y + 1.35 * hr)} C${f2(x + 1.7 * hr)} ${f2(y + 1.35 * hr)} ${f2(x + 2.9 * hr)} ${f2(y + 2 * hr)} ${f2(x + 2.9 * hr)} ${f2(y + 16 * hr)} Z"/>`;
    s += rect(x - 0.42 * hr, y + 0.6 * hr, 0.84 * hr, 0.9 * hr, "inherit") + `<ellipse cx="${f2(x)}" cy="${f2(y)}" rx="${f2(hr)}" ry="${f2(hr * 1.14)}"/>`;
    if (kind === 0) s += circ(x, y - 1.15 * hr, 0.48 * hr, "inherit");
    if (kind === 1) s += `<ellipse cx="${f2(x)}" cy="${f2(y + 0.1 * hr)}" rx="${f2(hr * 1.22)}" ry="${f2(hr * 1.05)}"/>`;
    // the mask's wing tips, just showing either side of the head
    s += `<path d="M${f2(x - 0.95 * hr)} ${f2(y - 0.12 * hr)} l ${f2(-0.3 * hr)} ${f2(-0.1 * hr)} l ${f2(0.12 * hr)} ${f2(0.3 * hr)} z M${f2(x + 0.95 * hr)} ${f2(y - 0.12 * hr)} l ${f2(0.3 * hr)} ${f2(-0.1 * hr)} l ${f2(-0.12 * hr)} ${f2(0.3 * hr)} z"/>`;
    crowd += s;
    const dir = k % 2 ? 1 : -1;
    ties += `<path d="M${f2(x)} ${f2(y + 0.05 * hr)} q ${f2(dir * 0.6 * hr)} ${f2(0.8 * hr)} ${f2(dir * 0.25 * hr)} ${f2(1.9 * hr)}" stroke="${GOLD}" stroke-width="${f2(hr * 0.1)}" fill="none" opacity=".85"/>`;
  }
  i.push(`<g fill="${GOLD}" transform="translate(0 -5)">${crowd.split('"inherit"').join('"' + GOLD + '"')}</g><g fill="${INK}">${crowd.split('"inherit"').join('"' + INK + '"')}</g>${ties}`);
  i.push(`<path id="sp0" d="" fill="#ffffff"/><path id="sp1" d="" fill="#ffffff"/>`);

  // the door: the wall with the arch cut out of it, the gold-leaf name above, glass and glazing bars in the opening
  const A = { x: 520, top: 340, w: 560 }, cy = A.top + A.w / 2;
  const d = [];
  d.push(`<path d="M-4000 -4000 H5600 V5600 H-4000 Z ${archD(A.x, A.top, A.w, 3000)}" fill="${DEEP}" fill-rule="evenodd"/>`);
  d.push(rect(-4000, 40, 9600, 16, BRASS) + rect(-4000, 40, 9600, 3, G7));
  d.push(`<path d="${archD(A.x - 34, A.top - 34, A.w + 68, 3000)} ${archD(A.x, A.top, A.w, 3000)}" fill="${GOLD}" fill-rule="evenodd"/><path d="${archD(A.x - 4, A.top - 4, A.w + 8, 3000)}" fill="none" stroke="${BRASS}" stroke-width="6"/>`);
  // glass in the fanlight only: the doors below it stand open for the guests
  d.push(`<path d="M${A.x} ${cy} A${A.w / 2} ${A.w / 2} 0 0 1 ${A.x + A.w} ${cy} Z" fill="${CREAM}" opacity=".12"/>`);
  let gl = "";
  for (let k = 1; k < 8; k++) { const a = Math.PI + k / 8 * Math.PI; gl += `<path d="M800 ${cy} L${f2(800 + Math.cos(a) * 280)} ${f2(cy + Math.sin(a) * 280)}" stroke="${G7}" stroke-width="7"/>`; }
  gl += `<path d="M650 ${cy} A150 150 0 0 1 950 ${cy}" stroke="${G7}" stroke-width="7" fill="none"/>` + rect(A.x, cy - 5, A.w, 10, BRASS);
  d.push(gl);
  const NAME = (fill, dx, dy, extra = "") => `<text x="${800 + dx}" y="${250 + dy}" text-anchor="middle" font-family="Libre Caslon Text" font-weight="700" font-size="84" letter-spacing="12" fill="${fill}" ${extra}>THE VELVET VEIL</text>`;
  d.push(`<defs><clipPath id="glint"><rect id="glintR" x="-400" y="100" width="70" height="220" transform="skewX(-28)"/></clipPath></defs>`);
  d.push(NAME("#3a0a04", 4, 5) + NAME(GOLD, 0, 0) + NAME(GOLD2, 0, 0, 'clip-path="url(#glint)"'));
  return { svg: `<g id="cIn">${i.join("")}</g><g id="cDoor">${d.join("")}</g>`, drops, archCy: cy };
}

// ---------------------------------------------------------------- D · the title
function shotD() {
  let rays = "";
  for (let k = 0; k < 11; k++) { const a = Math.PI + (k + 0.5) / 11 * Math.PI, w = 9; rays += `<path d="M800 640 L${f2(800 + Math.cos(a) * 300 - Math.sin(a) * w)} ${f2(640 + Math.sin(a) * 300 + Math.cos(a) * w)} L${f2(800 + Math.cos(a) * 300 + Math.sin(a) * w)} ${f2(640 + Math.sin(a) * 300 - Math.cos(a) * w)} Z" fill="${GOLD}"/>`; }
  const ttl = (fill, dx, dy) => `<text x="${800 + dx}" y="${850 + dy}" text-anchor="middle" font-family="Bowlby One" font-size="138" fill="${fill}" textLength="1320" lengthAdjust="spacingAndGlyphs">${esc(TITLE)}</text>`;
  return `<defs><clipPath id="dHor"><rect x="0" y="0" width="${W}" height="640"/></clipPath><clipPath id="dWipe"><rect id="dWipeR" x="140" y="700" width="0" height="200"/></clipPath></defs>` +
    rect(0, 0, W, H, C.ink900) +
    `<g clip-path="url(#dHor)"><g id="dSun"><g id="dRays" style="display:none">${rays}</g><path d="M650 640 A150 150 0 0 1 950 640 Z" fill="${GOLD}"/></g></g>` +
    rect(300, 640, 1000, 8, GOLD) +
    `<g clip-path="url(#dWipe)">${ttl(C.signal500, 8, 8)}${ttl(GOLD, 0, 0)}</g>` + rect(500, 905, 0, 10, C.paper100, 'id="dBar"');
}

module.exports = function build() {
  const a = shotA(), b = shotB(), c = shotC();
  const body = `<svg class="layer" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
<g id="A" style="display:none">${a.svg}</g>
<g id="C" style="display:none">${c.svg}</g>
<g id="D" style="display:none">${shotD()}</g>
</svg><div id="B" style="display:none">${b.html}</div><div id="fade"></div>`;
  const css = `#fade{position:absolute;inset:0;background:#000;opacity:1;pointer-events:none}
#B,#bCam{position:absolute;inset:0}
#bCam{transform-origin:50% 58.333%;will-change:transform}
.tl{position:absolute;inset:0;width:100%;height:100%;display:block}
.mv{will-change:transform}
#bGuests{transform-origin:50% 82.083%}`;

  const script = `
const T=${JSON.stringify(T)};
const Q=new URLSearchParams(location.search), T0=+(Q.get('t')||0);
const shots={A:$('A'),B:$('B'),C:$('C'),D:$('D')};let cur=null;
const show=id=>{if(cur===id)return;if(cur)shots[cur].style.display='none';shots[id].style.display='';cur=id;};
const clamp=x=>x<0?0:x>1?1:x, lerp=(a,b,u)=>a+(b-a)*u, sine=u=>.5-.5*Math.cos(Math.PI*clamp(u)), out3=u=>1-Math.pow(1-clamp(u),3);
const tf=(el,s)=>el.setAttribute('transform',s), css=(el,s)=>{el.style.transform=s;}, fx=n=>n.toFixed(2);

// A: the crane. Every layer lands where it is drawn at the end of the move; a layer's factor says how much of the move it takes
const AE={cx:630,cy:483,z:1.3};
const aLayers=[[$('aSky'),.25],[$('aFar'),.55],[$('aNear'),1],[$('aFog'),1.15],[$('aPoles'),1.6]];
const queue=[];for(let i=0;i<${a.QN};i++)queue.push($('q'+i));
function shotA(t){
 const u=sine(t/10),c={cx:lerp(560,630,u),cy:lerp(-400,483,u),z:lerp(.85,1.3,u)};
 for(const [el,p] of aLayers){const ex=AE.cx+(c.cx-AE.cx)*p,ey=AE.cy+(c.cy-AE.cy)*p,ez=AE.z*Math.pow(c.z/AE.z,p);tf(el,'translate(800 600) scale('+ez.toFixed(4)+') translate('+fx(-ex)+' '+fx(-ey)+')');}
 tf($('aDrift'),'translate('+fx(-t*18)+' 0)');tf($('aRef'),'translate('+fx(Math.sin(t*2.3)*1.6)+' 0)');
 // the queue runs from the landing back towards us, so the nearer boats are bigger; it edges forward while the camera comes down
 queue.forEach((g,i)=>{const s=(i+.3)*.1-Math.min(t,11)*.003,k=1+.95*s;tf(g,'translate('+fx(800+430*s)+' '+fx(598+220*s+Math.sin(t*1.3+i)*1.4*k)+') scale('+k.toFixed(3)+')');});
 tf($('aOut1'),'translate('+fx(-t*30)+' '+fx(Math.sin(t*1.1)*1.2)+')');
 tf($('aClose'),'translate('+fx(60-t*14)+' '+fx(Math.sin(t*.9)*2)+')');
}
// B: the landing
const bF=[];for(let i=0;i<${b.flashes};i++)bF.push($('bF'+i));
const FLASH=[[2.4,0],[4.7,1],[6.0,2]];
let glance=0;
function shotB(t){
 // CSS transforms on composited layers; a viewBox unit is 1/16 % across and 1/12 % down
 css($('bCam'),'scale('+(1+.07*sine(t/7.5)).toFixed(4)+')');
 css($('bGon'),'translate3d('+(lerp(1700,490,out3((t-.2)/4.8))/16).toFixed(3)+'%,'+(Math.sin(t*1.4)*2/12).toFixed(3)+'%,0)');
 css($('bGuests'),'scale('+(1-.16*sine(t/7.5)).toFixed(4)+') translate3d(0,'+(Math.floor(t*2.2)%2*2/12).toFixed(3)+'%,0)');
 css($('bRef'),'translate3d('+(Math.sin(t*2.6)*2/16).toFixed(3)+'%,0,0)');
 let w=0;bF.forEach((el,i)=>{const on=FLASH.some(([at,k])=>k===i&&t>=at&&t<at+.11);el.style.display=on?'':'none';if(on)w=.22;});$('bWhite').setAttribute('opacity',w);
 if(t<.5)glance=0;
 const G=[[1.5,'icR',1],[3.1,'icL',1],[5.2,'icR',2],[6.3,'icL',2]];
 while(glance<G.length&&t>=G[glance][0]){Motion.show(G[glance][1],G[glance][2]);glance++;}
}
// C: the name, then the push through the glass; the ballroom behind scales more slowly than the door, so it reads as further away
const DROPS=${JSON.stringify(c.drops)}, ACY=${c.archCy};
const star=(x,y,r)=>'M'+x+' '+(y-r)+' L'+(x+r*.22)+' '+(y-r*.22)+' L'+(x+r)+' '+y+' L'+(x+r*.22)+' '+(y+r*.22)+' L'+x+' '+(y+r)+' L'+(x-r*.22)+' '+(y+r*.22)+' L'+(x-r)+' '+y+' L'+(x-r*.22)+' '+(y-r*.22)+' Z';
let spT=[0,0];
function shotC(t){
 let cx=800,cy,z;
 if(t<1.8){const u=sine(t/1.8);cy=lerp(280,470,u);z=lerp(1.1,1.25,u);}
 else{const u=sine((t-1.8)/4.6);cy=lerp(470,900,u);z=1.25*Math.pow(7/1.25,u);}
 const door=$('cDoor');door.style.display=z<6.6?'':'none';
 tf(door,'translate(800 600) scale('+z.toFixed(4)+') translate('+fx(-cx)+' '+fx(-cy)+')');
 $('glintR').setAttribute('x',fx(lerp(-300,1500,clamp((t-.3)/2))));
 // the ballroom is pinned to a point in the open doorway, below the fanlight, and grows more slowly than the door; as the door
 // goes past the lens the pin slides to the middle of the screen, so the chandelier settles in the top third
 const u=t<1.8?0:sine((t-1.8)/4.6),w=sine((t-.4)/7.4),si=.36*Math.pow(1.06/.36,w),ay=lerp((ACY+150-cy)*z+600,560,sine(u)),iy=lerp(560,600,w);
 tf($('cIn'),'translate(800 '+fx(ay)+') scale('+si.toFixed(4)+') translate(-800 '+fx(-iy)+')');
 for(let k=0;k<2;k++){if(t>spT[k]){spT[k]=t+.15+Math.random()*.5;const d=DROPS[Math.floor(Math.random()*DROPS.length)];$('sp'+k).setAttribute('d',star(d[0],d[1],10+Math.random()*8));}}
}
// D: the title, then it holds
function shotD(t){
 const u=out3(t/1.8);tf($('dSun'),'translate(0 '+fx((1-u)*170)+')');$('dRays').style.display=t>.7?'':'none';
 $('dWipeR').setAttribute('width',fx(1320*out3((t-1.1)/.5)));$('dBar').setAttribute('width',fx(600*out3((t-1.7)/.4)));
}
const fade=$('fade');
loop((dt,clock)=>{const t=clock+T0;
 // B's figures are painted a second and a half early, all but invisible over the crane, so the cut to it does not hitch
 if(t<T.landing){show('A');shotA(t);if(t>=T.landing-1.5&&shots.B.style.display){shots.B.style.opacity='.001';shots.B.style.display='';}}
 else if(t<T.door){show('B');shots.B.style.opacity='';shotB(t-T.landing);}else if(t<T.title){show('C');shotC(t-T.door);}else if(t<T.title+3||cur!=='D'){show('D');shotD(t-T.title);}
 fade.style.opacity=t<1.4?(1-t/1.4).toFixed(3):'0';
});
`;
  return L.build({ file: "sunrise-ball-opening.html", title: "The Sunrise Ball: opening", fonts: ["Libre Caslon Text Bold", "Bowlby One"], body, css, script, grain: 0.14, vignette: 0.45, bg: C.ink900, fps: 30 });
};
module.exports.T = T;
if (require.main === module) module.exports();
