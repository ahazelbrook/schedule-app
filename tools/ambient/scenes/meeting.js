// The planning meeting: the crew round the table in Second Harvest (the lair, b68g-s01), under one lamp, over a map of
// Doskvol with pins and red string. They take turns talking: whoever has the floor gestures and the others turn to look.
// A generic map, never the score (Alex, 16/10/2026).
"use strict";
const L = require("../lib.js");
const { C, f2, pts, rng } = L;

module.exports = function build() {
  const W = 1600, H = 1200, r = rng(180);
  const WALL = "#4a5246", WALL2 = "#3e463b";
  let defs = "", room = "", table = "", front = "";
  defs += `<radialGradient id="pm-lamp" cx=".5" cy=".55" r=".55"><stop offset="0" stop-color="#ffe2a0" stop-opacity=".42"/><stop offset=".55" stop-color="#e8b860" stop-opacity=".1"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  <radialGradient id="pm-dark" cx=".5" cy=".45" r=".72"><stop offset=".4" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#0b0d0a" stop-opacity=".82"/></radialGradient>
  <linearGradient id="pm-cone" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff0c0" stop-opacity=".2"/><stop offset="1" stop-color="#fff0c0" stop-opacity="0"/></linearGradient>
  <pattern id="pm-paper" width="46" height="46" patternUnits="userSpaceOnUse"><rect width="46" height="46" fill="${WALL}"/><circle cx="23" cy="23" r="9" fill="none" stroke="${WALL2}" stroke-width="3"/><circle cx="0" cy="0" r="5" fill="${WALL2}"/><circle cx="46" cy="46" r="5" fill="${WALL2}"/></pattern>`;

  // ---------- the lair: wallpaper, the neon, the boarded window, the goldfish ----------
  room += `<rect width="${W}" height="${H}" fill="url(#pm-paper)"/><rect y="760" width="${W}" height="${H - 760}" fill="#2e2a22"/>`;
  room += `<g transform="translate(800 150)"><text x="0" y="0" text-anchor="middle" font-family="Yellowtail" font-size="96" fill="none" stroke="#ff7ac0" stroke-width="10" opacity=".35">Second Harvest</text><text id="neon" x="0" y="0" text-anchor="middle" font-family="Yellowtail" font-size="96" fill="#ffd6ec" stroke="#ff7ac0" stroke-width="2">Second Harvest</text></g>`;
  room += `<g transform="translate(70 230)"><rect width="250" height="300" rx="14" fill="${C.ink900}"/><rect x="12" y="12" width="226" height="276" fill="#b84a1e"/><rect x="12" y="200" width="226" height="88" fill="#7a2a12"/>${[30, 80, 140, 180].map((x) => `<rect x="${x}" y="${120 - x % 70}" width="30" height="${170 + x % 70}" fill="#5a1e0c"/>`).join("")}<rect x="0" y="120" width="250" height="26" fill="#8a6a44" transform="rotate(-8 125 133)"/><rect x="0" y="180" width="250" height="22" fill="#7a5a38" transform="rotate(5 125 191)"/></g>`;
  room += `<g transform="translate(1310 330)"><rect width="230" height="160" fill="#2a2521"/><rect x="8" y="8" width="214" height="144" fill="#3f9aa0" opacity=".85"/><rect x="8" y="120" width="214" height="32" fill="#c9a45a" opacity=".7"/><g id="fish"><ellipse cx="0" cy="0" rx="16" ry="9" fill="${C.signal500}"/><polygon points="14,0 26,-8 26,8" fill="${C.signal500}"/><circle cx="-8" cy="-2" r="2" fill="${C.ink900}"/></g><rect x="0" y="152" width="230" height="16" fill="#2a2521"/></g>`;
  room += `<rect x="0" y="752" width="${W}" height="10" fill="#1e1b16"/>`;

  // ---------- the crew, behind the table ----------
  // each figure's frames: 0 neutral, 1 looks to the viewer's left, 2 looks right, 3 and 4 a gesture (has the floor)
  const S = 0.36, FLOOR = 1330;
  const crew = [
    { id: "loader", x: 300, gest: [{ arms: { R: "hold" } }, { arms: { R: "hold", L: "hold" } }] },
    { id: "booker", x: 640, gest: [{ arms: { R: "hold" } }, { arms: { R: { a: "hold", b: "raise", t: .6 } } }] },
    { id: "stacey", x: 980, gest: [{ arms: { R: "hold" } }, { arms: { R: { a: "hold", b: "raise", t: .5 } } }] },
    { id: "alfie", x: 1290, gest: [{ arms: { R: { a: "down", b: "smoke", t: .4, as: "smoke" } } }, { arms: { R: { a: "down", b: "smoke", t: 1, as: "smoke" } } }] },
  ];
  let people = "";
  crew.forEach((c) => {
    const spec = L.pc(c.id);
    // Alfie keeps his cigarette in the hand, at rest by his waist
    if (c.id === "alfie") spec.pose.arms.R = { a: "down", b: "smoke", t: .4, as: "smoke" };
    const base = spec.pose.arms;
    const look = (yaw) => ({ pose: { head: { yaw, tilt: 0 } } });
    const frames = [{}, look(-16), look(16),
      { pose: { arms: Object.assign({}, base, c.gest[0].arms), head: { yaw: 0, tilt: -3 } } },
      { pose: { arms: Object.assign({}, base, c.gest[1].arms), head: { yaw: 0, tilt: 2 } } }];
    const f = L.fig(spec, { id: "m-" + c.id, frames, place: S });
    people += L.at(f, c.x, FLOOR, S);
  });

  // ---------- the table and the map ----------
  const TY = 950;
  table += `<path d="M120 ${TY} L1480 ${TY} L1560 ${H} L40 ${H}z" fill="#5a3a22"/><path d="M120 ${TY} L1480 ${TY} L1488 ${TY + 14} L112 ${TY + 14}z" fill="#7a5232"/>`;
  for (let k = 0; k < 7; k++) table += `<line x1="${120 + k * 226}" y1="${TY + 14}" x2="${40 + k * 253}" y2="${H}" stroke="#4a2e1a" stroke-width="3" opacity=".6"/>`;
  // the map: a rough Doskvol, river and canals, districts, pins and string
  let map = `<g transform="translate(440 ${TY + 18})"><polygon points="${pts([[0, 0], [720, 0], [760, 230], [-40, 230]])}" fill="${C.paper200}"/>`;
  map += `<path d="M-20 160 C140 120 260 190 380 140 C500 90 600 150 750 110" stroke="#7aa0b0" stroke-width="18" fill="none" opacity=".8"/>`;
  map += `<g stroke="${C.ink300}" stroke-width="2" opacity=".7">${Array.from({ length: 14 }, (_, k) => `<line x1="${f2(-30 + k * 56)}" y1="0" x2="${f2(-40 + k * 58 + (r() - .5) * 30)}" y2="230"/>`).join("")}${[40, 90, 200].map((y) => `<line x1="-30" y1="${y}" x2="760" y2="${y + (r() - .5) * 20}"/>`).join("")}</g>`;
  map += [[60, 50, C.alarm700], [300, 70, C.alarm700], [520, 40, C.file500], [610, 180, C.alarm700], [180, 190, C.caution500]].map(([x, y, col]) => `<circle cx="${x}" cy="${y}" r="9" fill="${col}"/><circle cx="${x - 2}" cy="${y - 3}" r="3" fill="#fff" opacity=".6"/>`).join("");
  map += `<polyline points="60,50 300,70 520,40 610,180" fill="none" stroke="${C.alarm700}" stroke-width="2.5"/>`;
  map += `<text x="360" y="22" text-anchor="middle" font-family="Courier Prime" font-weight="700" font-size="18" fill="${C.ink700}">DOSKVOL</text></g>`;
  table += map;
  // coffee, an ashtray, a radio, Stacey's pill bottle
  table += `<g transform="translate(300 ${TY + 70})"><ellipse rx="34" ry="12" fill="#e8e2d4"/><ellipse rx="24" ry="8" fill="#3a2213"/><path d="M34 -4 q16 0 14 12 q-2 8 -14 8" stroke="#e8e2d4" stroke-width="6" fill="none"/></g>`;
  table += `<g transform="translate(1290 ${TY + 70})"><ellipse rx="42" ry="14" fill="#8a8f96"/><ellipse rx="28" ry="9" fill="#55504a"/><rect x="-4" y="-8" width="44" height="6" rx="2" fill="${C.paper100}" transform="rotate(-10)"/></g>`;
  table += `<g transform="translate(1340 ${TY + 30})"><rect x="0" y="-70" width="120" height="70" rx="10" fill="${C.rust700}"/><rect x="10" y="-60" width="60" height="44" rx="4" fill="#d8c79a"/><circle cx="96" cy="-38" r="14" fill="#2a2521"/></g>`;
  table += `<g transform="translate(1100 ${TY + 50})"><rect x="-12" y="-36" width="24" height="36" rx="4" fill="#c46a1e" opacity=".85"/><rect x="-14" y="-46" width="28" height="12" fill="${C.paper100}"/></g>`;

  // ---------- the lamp ----------
  front += `<polygon points="${pts([[740, 300], [860, 300], [1300, TY], [300, TY]])}" fill="url(#pm-cone)"/>`;
  front += `<g id="lampg"><line x1="800" y1="0" x2="800" y2="260" stroke="${C.ink900}" stroke-width="3"/><path d="M730 300 L870 300 L840 260 L760 260z" fill="${C.covert700}"/><ellipse cx="800" cy="300" rx="70" ry="9" fill="#fff0c0"/></g>`;
  front += `<rect width="${W}" height="${H}" fill="url(#pm-lamp)" style="mix-blend-mode:screen"/><rect width="${W}" height="${H}" fill="url(#pm-dark)"/>`;
  front += `<g id="smoke" fill="none" stroke="#e8e2d4" stroke-linecap="round" opacity=".18"><path d="M1290 ${TY + 50} q-30 -80 10 -160 q40 -80 -10 -180" stroke-width="10"/></g>`;

  const body = `<svg class="layer" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>${defs}</defs>${room}${people}${table}${front}</svg>`;

  const script = `
const ids=['m-loader','m-booker','m-stacey','m-alfie'];let floor=-1;
// whoever has the floor gestures; everyone else turns to look at them (left or right of where they stand)
function give(n){floor=n;ids.forEach((id,i)=>{if(i===n)return;Motion.show(id,i<n?2:1);});
 const g=ids[n];move(g,[[3,R(900,1500)],[4,R(700,1300)],[3,R(800,1400)],[4,R(600,1000)],[3,R(500,900)],[0,0]]);}
every(5,9,()=>{let n;do{n=Math.floor(Math.random()*4);}while(n===floor);give(n);},2);
// now and then the room relaxes: everyone back to neutral
every(20,40,()=>{ids.forEach((id,i)=>{if(i!==floor)Motion.show(id,0);});});
const fish=$('fish'),smoke=$('smoke'),neon=$('neon');let neonOp='1';
loop((dt,c)=>{
 fish.setAttribute('transform','translate('+(115+Math.sin(c*.35)*80).toFixed(1)+' '+(60+Math.sin(c*.9)*14).toFixed(1)+') scale('+(Math.cos(c*.35)>0?-1:1)+' 1)');
 smoke.setAttribute('transform','translate('+(Math.sin(c*.6)*8).toFixed(1)+' 0) skewX('+(Math.sin(c*.4)*6).toFixed(1)+')');
 // the flicker: written only when it changes (a write of the same value is still a style change to the browser, every tick)
 const op=Math.random()<.006?'.3':'1';if(op!==neonOp){neonOp=op;neon.setAttribute('opacity',op);}
});
`;
  return L.build({ file: "planning-meeting.html", title: "The planning meeting", fonts: ["Yellowtail", "Courier Prime Bold"], body, script, grain: .16, vignette: .55, bg: "#0b0d0a", fps: 24 });
};
if (require.main === module) module.exports();
