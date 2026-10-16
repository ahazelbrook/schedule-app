// Grunt's: the vet's two doors down from Second Harvest where Grunt, the back-alley doctor, sees people after hours on the
// same steel table (Grunt's NPC page). Carbolic and wet dog: one bare bulb, tiled walls, worming paste with the pills behind
// it, LARGE ANIMALS · NO BIRDS on the door glass, and a covered birdcage.
"use strict";
const L = require("../lib.js");
const { C, f2, pts, rng } = L;

module.exports = function build() {
  const W = 1600, H = 1200, r = rng(102);
  const TILE = "#9fb39a", TILE2 = "#8aa086", CREAM = "#d8d2bc";
  let defs = "", room = "", props = "", front = "";
  defs += `<radialGradient id="gv-bulb" cx=".5" cy="0" r=".9"><stop offset="0" stop-color="#ffe9a8" stop-opacity=".55"/><stop offset=".5" stop-color="#e8c060" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  <radialGradient id="gv-dark" cx=".5" cy=".35" r=".75"><stop offset=".35" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#0a0f0b" stop-opacity=".78"/></radialGradient>
  <linearGradient id="gv-steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6e9e6"/><stop offset=".25" stop-color="#9aa3a2"/><stop offset="1" stop-color="#5d6766"/></linearGradient>
  <linearGradient id="gv-glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9d6c8"/><stop offset="1" stop-color="#8fa48d"/></linearGradient>
  <clipPath id="gv-pane"><rect x="110" y="260" width="250" height="300"/></clipPath>`;

  // ---------- the room ----------
  room += `<rect width="${W}" height="${H}" fill="${CREAM}"/>`;
  // tiles to dado height
  let tiles = "";
  for (let y = 560; y < 960; y += 40) for (let x = (y / 40 % 2) * -20; x < W; x += 40) tiles += `<rect x="${x + 1.5}" y="${y + 1.5}" width="37" height="37" fill="${r() < .2 ? TILE2 : TILE}"/>`;
  room += `<rect x="0" y="560" width="${W}" height="400" fill="#6d8269"/><g>${tiles}</g><rect x="0" y="552" width="${W}" height="12" fill="${C.covert700}"/>`;
  // floor: lino
  room += `<rect x="0" y="960" width="${W}" height="${H - 960}" fill="#4f5a4a"/>`;
  let lino = "";
  for (let k = -10; k < 20; k++) lino += `<line x1="${800 + k * 60}" y1="960" x2="${800 + k * 200}" y2="${H}" stroke="#3e4739" stroke-width="2"/>`;
  room += lino + `<rect x="0" y="960" width="${W}" height="10" fill="#2f362b"/>`;

  // the door, glass from inside: lettering reads backwards
  room += `<rect x="80" y="230" width="310" height="730" fill="#5b4a36"/><rect x="96" y="246" width="278" height="714" fill="#6e5a42"/>`;
  room += `<rect x="110" y="260" width="250" height="300" fill="url(#gv-glass)"/>`;
  room += `<g clip-path="url(#gv-pane)"><g id="passer" transform="translate(-200 0)"><ellipse cx="0" cy="330" rx="46" ry="56" fill="#3e4c3c" opacity=".55"/><rect x="-70" y="380" width="140" height="240" rx="50" fill="#3e4c3c" opacity=".55"/></g></g>`;
  room += `<g transform="translate(235 0) scale(-1 1)" fill="${C.ink900}" opacity=".7"><text x="0" y="372" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="46">LARGE ANIMALS</text><text x="0" y="420" text-anchor="middle" font-family="Archivo Condensed" font-weight="700" font-size="30" letter-spacing="6">· NO BIRDS ·</text></g>`;
  room += `<rect x="330" y="600" width="18" height="60" rx="6" fill="#c9a24a"/>`;

  // the horse chart
  room += `<g transform="translate(440 190) rotate(-1.5)"><rect width="300" height="230" fill="${C.paper100}"/><rect x="0" y="0" width="300" height="34" fill="${C.covert900}"/>
    <text x="150" y="24" text-anchor="middle" font-family="Archivo Condensed" font-weight="800" font-size="20" fill="${C.paper100}" letter-spacing="2">EQUINE · LATERAL VIEW</text>
    <path d="M60 170 L70 120 Q80 90 120 88 L190 86 Q215 60 228 58 L246 46 L252 62 L246 80 Q246 96 236 106 L228 112 L236 170 L226 172 L218 126 L200 124 L190 172 L180 172 L178 128 L110 130 L104 172 L94 172 L92 132 L78 140 L72 172z" fill="#8a5a3a"/>
    <path d="M120 96 L190 94 M130 110 L180 108" stroke="${C.paper100}" stroke-width="2" opacity=".6"/>
    ${[[100, 110, 1], [150, 100, 2], [214, 80, 3], [236, 150, 4]].map(([x, y, n]) => `<circle cx="${x}" cy="${y}" r="9" fill="${C.alarm700}"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-family="Space Mono" font-size="11" font-weight="700" fill="${C.paper100}">${n}</text>`).join("")}
    <text x="150" y="210" text-anchor="middle" font-family="Space Mono" font-size="11" fill="${C.ink700}">PLATE 7 · DRAUGHT HORSE</text></g>`;

  // shelves: worming paste in front, pills behind it
  room += `<g transform="translate(1010 200)"><rect x="0" y="120" width="460" height="12" fill="#5b4a36"/><rect x="0" y="250" width="460" height="12" fill="#5b4a36"/>`;
  for (let k = 0; k < 9; k++) room += `<rect x="${14 + k * 50}" y="${120 - 70}" width="38" height="70" fill="${C.paper200}"/><rect x="${14 + k * 50}" y="${120 - 52}" width="38" height="26" fill="${k % 3 ? C.covert700 : C.alarm700}"/><text x="${33 + k * 50}" y="${120 - 35}" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="12" fill="${C.paper100}">WORM</text><rect x="${16 + k * 50}" y="${120 - 80}" width="34" height="12" fill="${C.ink700}"/>`;
  for (let k = 0; k < 14; k++) { const h = 30 + r() * 30; room += `<rect x="${12 + k * 32}" y="${f2(250 - h)}" width="24" height="${f2(h)}" rx="3" fill="${["#8a5a2a", C.paperTint, "#6a7d9a", C.rust500][k % 4]}"/><rect x="${12 + k * 32}" y="${f2(250 - h - 8)}" width="24" height="8" fill="${C.ink700}"/>`; }
  room += `<text x="230" y="300" text-anchor="middle" font-family="Courier Prime" font-size="18" fill="${C.ink700}" transform="rotate(1 230 300)">LARGE ANIMALS ONLY</text></g>`;

  // a wall clock that ticks
  room += `<g transform="translate(1530 120)"><circle r="44" fill="${C.paper000}" stroke="${C.ink900}" stroke-width="6"/>${Array.from({ length: 12 }, (_, k) => `<line x1="0" y1="-36" x2="0" y2="-30" stroke="${C.ink900}" stroke-width="3" transform="rotate(${k * 30})"/>`).join("")}<line id="hh" x1="0" y1="0" x2="0" y2="-20" stroke="${C.ink900}" stroke-width="5"/><line id="mh" x1="0" y1="0" x2="0" y2="-30" stroke="${C.ink900}" stroke-width="3"/><line id="sh" x1="0" y1="6" x2="0" y2="-34" stroke="${C.alarm700}" stroke-width="1.5"/></g>`;

  // the sink, dripping
  props += `<g transform="translate(1240 640)"><rect x="0" y="0" width="240" height="70" fill="#d9ddd9"/><rect x="10" y="8" width="220" height="40" fill="#b7bdb9"/><rect x="110" y="-60" width="12" height="60" fill="#8a9190"/><rect x="110" y="-60" width="50" height="12" fill="#8a9190"/><rect x="0" y="70" width="20" height="290" fill="#8a9190"/><rect x="220" y="70" width="20" height="290" fill="#8a9190"/><circle id="drip" cx="155" cy="-44" r="5" fill="#cfe0e8"/></g>`;
  // the covered birdcage
  props += `<g id="cage" transform="translate(1440 960)"><line x1="0" y1="-330" x2="0" y2="0" stroke="${C.ink900}" stroke-width="6"/><rect x="-50" y="-6" width="100" height="10" fill="${C.ink900}"/>
    <g id="cloth"><path d="M-80 -150 Q-84 -300 0 -310 Q84 -300 80 -150 L90 -110 Q60 -100 40 -116 Q20 -100 0 -114 Q-20 -100 -40 -116 Q-60 -100 -90 -110z" fill="#7a2e2a"/><path d="M-50 -280 Q-40 -200 -56 -126 M20 -300 Q30 -210 16 -118" stroke="#5a1e1a" stroke-width="5" fill="none"/></g></g>`;

  // ---------- the steel table and its patient ----------
  props += `<g id="tblshadow" opacity=".35"><ellipse cx="800" cy="1010" rx="360" ry="34" fill="#0a0f0b"/></g>`;
  props += `<g transform="translate(800 0)"><rect x="-320" y="830" width="640" height="34" fill="url(#gv-steel)"/><rect x="-320" y="826" width="640" height="8" fill="#f2f4f2"/>
    <rect x="-290" y="864" width="18" height="140" fill="#6d7675"/><rect x="272" y="864" width="18" height="140" fill="#6d7675"/><rect x="-290" y="950" width="580" height="10" fill="#6d7675"/>
    <g id="patient"><path d="M-240 828 Q-250 760 -170 744 Q-60 724 60 740 Q170 748 210 790 L230 828z" fill="#a39074"/><path d="M-60 740 Q20 728 110 744" stroke="#7d6c56" stroke-width="5" fill="none"/>
    <path d="M190 780 Q250 760 280 790 L270 828 L210 828z" fill="#8a7458"/><ellipse cx="262" cy="796" rx="10" ry="6" fill="${C.ink900}"/><path d="M196 770 Q214 744 230 774" fill="#6b5842"/>
    <rect x="-120" y="752" width="90" height="70" fill="${C.paper000}"/><line x1="-120" y1="770" x2="-30" y2="770" stroke="${C.alarm700}" stroke-width="3"/></g></g>`;
  props += `<g transform="translate(560 822)"><rect x="0" y="0" width="140" height="8" fill="#b7bdb9"/><rect x="18" y="-6" width="50" height="6" fill="#8a9190"/><rect x="80" y="-10" width="10" height="10" fill="${C.covert700}"/><path d="M100 -2 l30 -4" stroke="#8a9190" stroke-width="3"/></g>`;

  // ---------- Grunt behind the table, wiping his hands ----------
  const grunt = L.fig(L.npc("grunt"), { id: "grunt", frames: [{},
    { pose: { arms: { R: { a: "cross", b: "hold", t: .5 }, L: { a: "cross", b: "hold", t: .5 } }, head: { tilt: 6 } } },
    { pose: { arms: { R: "hold", L: "hold" }, head: { tilt: 9 } } },
    { pose: { arms: { R: "hold", L: { a: "hold", b: "down", t: .3 } }, head: { tilt: 9 } } },
    { pose: { arms: { R: "hold", L: "hold" }, head: { tilt: -2 } } }] });
  const gruntSvg = L.at(grunt, 830, 1060, 0.255);

  // ---------- the bulb ----------
  front += `<g id="bulbg"><line x1="800" y1="0" x2="800" y2="170" stroke="${C.ink900}" stroke-width="3"/><rect x="792" y="166" width="16" height="16" fill="${C.ink700}"/><circle cx="800" cy="196" r="17" fill="#fff6d0"/><circle cx="800" cy="196" r="60" fill="#fff0b0" opacity=".25"/></g>`;
  front += `<rect id="pool" width="${W}" height="${H}" fill="url(#gv-bulb)" style="mix-blend-mode:screen"/><rect width="${W}" height="${H}" fill="url(#gv-dark)"/>`;

  const body = `<svg class="layer" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>${defs}</defs>
  ${room}${gruntSvg}${props}${front}</svg>`;

  const script = `
const bulb=$('bulbg'),pool=$('pool'),sh=$('tblshadow'),cloth=$('cloth'),drip=$('drip'),pat=$('patient'),passer=$('passer');
let dy=0,dripping=false;
loop((dt,c)=>{
 const a=Math.sin(c*.9)*2.2;bulb.setAttribute('transform','rotate('+a.toFixed(2)+' 800 0)');
 const sx=-Math.sin(a*Math.PI/180)*900;sh.setAttribute('transform','translate('+sx.toFixed(1)+' 0)');
 pool.setAttribute('transform','translate('+(Math.sin(a*Math.PI/180)*196).toFixed(1)+' 0)');
 pool.setAttribute('opacity',Math.random()<.008?'.5':'1');
 // the patient breathes
 pat.setAttribute('transform','translate(0 828) scale(1 '+(1+Math.sin(c*1.6)*.012).toFixed(4)+') translate(0 -828)');
 if(dripping){dy+=dt*420;drip.setAttribute('cy',(-44+dy).toFixed(1));if(dy>60){dripping=false;dy=0;drip.setAttribute('cy','-44');}}
 const d=new Date();$('sh').setAttribute('transform','rotate('+d.getSeconds()*6+')');$('mh').setAttribute('transform','rotate('+(d.getMinutes()*6+d.getSeconds()*.1)+')');$('hh').setAttribute('transform','rotate('+((d.getHours()%12)*30+d.getMinutes()*.5)+')');
});
every(3,7,()=>{dripping=true;});
// the cage: something under the cloth moves. No birds.
every(25,70,async()=>{for(const k of [3,-2,2,0]){cloth.setAttribute('transform','rotate('+k+' 0 -310)');await new Promise(r=>setTimeout(r,90));}});
// someone passes the door glass
every(30,80,()=>{let x=-200;const step=()=>{x+=9;passer.setAttribute('transform','translate('+x+' 0)');if(x<700)setTimeout(step,40);};step();},14);
// Grunt finishes with his hands, then looks up
every(14,30,()=>move('grunt',[[1,180],[2,1400],[3,500],[2,500],[3,500],[2,900],[4,2400],[1,200],[0,0]]),5);
`;
  return L.build({ file: "grunts-vet.html", title: "Grunt's", fonts: ["Archivo Compressed", "Archivo Condensed", "Space Mono", "Courier Prime"], body, script, grain: .16, vignette: .5, bg: "#0a0f0b", fps: 24 });
};
if (require.main === module) module.exports();
