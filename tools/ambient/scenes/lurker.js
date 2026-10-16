// The Lurker press room: the Doskvol Lurker (faction card 27) going to press. A rotary press turns, sheets run past, and a new
// front page lands on the stack every so often. HEADLINES is the list to edit: dry, specific, never winking, and nothing the
// players haven't seen (no score targets, nothing from the GM's notes).
"use strict";
const L = require("../lib.js");
const { C, f2, pts, rng, esc } = L;

const HEADLINES = [
  ["FOG HOLDS BARGES AT THE DOCKS", "Limmerfield men ‘not available for enquiries’"],
  ["CHASE ON CANDLE BRIDGE", "City Watch ‘monitoring the situation’"],
  ["BLUETIME RUNS SHORT AGAIN", "Ministry of Discovery: ‘within tolerances’"],
  ["SPEAKERS OFF APPLE LANE, TRADERS TOLD", "Record shops defiant: ‘We were here first’"],
  ["STRANGFORD-MICHTER POSTS RECORD YEAR", "Daylight futures up four points"],
  ["CURFEW EXTENDED IN CROWFOOT", "City Watch cites ‘activity’"],
  ["DEATH RADAR SILENT FOR THIRD NIGHT", "Section 6 declines to comment"],
  ["BONEYARD CATCH ‘BEST IN YEARS’", "Fishmongers report a glut of oil"],
  ["COUNCIL DEBATES BUBBLE LEVY", "Vote deferred to the new year"],
  ["MINISTRY DENIES SHORTAGE OF SUN", "‘There is plenty of sun,’ says spokesman"],
];

module.exports = function build() {
  const W = 1600, H = 1200, r = rng(27);
  let defs = "", room = "", press = "", stack = "", page = "";
  defs += `<radialGradient id="lp-lamp" cx=".62" cy=".05" r=".8"><stop offset="0" stop-color="#ffe7a8" stop-opacity=".45"/><stop offset=".6" stop-color="#ffe7a8" stop-opacity=".06"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  <linearGradient id="lp-drum" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9bdb8"/><stop offset=".5" stop-color="#6c716d"/><stop offset="1" stop-color="#2e322f"/></linearGradient>`;

  // ---------- the room: brick, a gantry, the shop sign ----------
  room += `<rect width="${W}" height="${H}" fill="#2a2420"/>`;
  let bricks = "";
  for (let y = 0, row = 0; y < 820; y += 30, row++) for (let x = (row % 2) * -40; x < W; x += 80) bricks += `<rect x="${x + 2}" y="${y + 2}" width="76" height="26" fill="${r() < .3 ? "#332b26" : "#2f2823"}"/>`;
  room += `<g>${bricks}</g><rect x="0" y="820" width="${W}" height="${H - 820}" fill="#1b1714"/><rect x="0" y="820" width="${W}" height="8" fill="#3a322c"/>`;
  room += `<g transform="translate(60 60)"><rect width="430" height="120" fill="${C.paper100}"/><rect x="8" y="8" width="414" height="104" fill="none" stroke="${C.ink900}" stroke-width="3"/>
    <text x="215" y="66" text-anchor="middle" font-family="Pirata One" font-size="62" fill="${C.ink900}">The Lurker</text>
    <text x="215" y="98" text-anchor="middle" font-family="Space Mono" font-size="14" fill="${C.ink700}" letter-spacing="3">PRESS ROOM · NO SMOKING</text></g>`;

  // ---------- the press ----------
  const drums = [[700, 300, 110], [960, 300, 110], [830, 470, 90], [1180, 420, 70]];
  press += `<rect x="560" y="180" width="760" height="560" fill="#3b4340"/><rect x="560" y="180" width="760" height="24" fill="#545e5a"/><rect x="560" y="716" width="760" height="24" fill="#262b29"/>`;
  press += `<rect x="580" y="740" width="40" height="80" fill="#262b29"/><rect x="1260" y="740" width="40" height="80" fill="#262b29"/>`;
  for (const [x, y, rr] of drums) {
    press += `<circle cx="${x}" cy="${y}" r="${rr + 10}" fill="#262b29"/><g class="drum" data-x="${x}" data-y="${y}" data-v="${f2(200 / rr)}"><circle cx="${x}" cy="${y}" r="${rr}" fill="url(#lp-drum)"/>`;
    for (let k = 0; k < 6; k++) press += `<line x1="${x}" y1="${y}" x2="${f2(x + Math.cos(k * Math.PI / 3) * rr * .9)}" y2="${f2(y + Math.sin(k * Math.PI / 3) * rr * .9)}" stroke="#2e322f" stroke-width="6"/>`;
    press += `<circle cx="${x}" cy="${y}" r="${rr * .22}" fill="#9aa09b"/></g>`;
  }
  // the paper web threading the drums
  press += `<path d="M560 230 C640 180 760 200 700 410 C680 500 860 560 830 380 C820 300 940 200 960 410 C980 520 1120 520 1180 490 L1330 560" fill="none" stroke="${C.paper200}" stroke-width="10" opacity=".85"/>`;
  press += `<g transform="translate(1000 640)"><rect width="200" height="56" fill="#262b29"/><text x="100" y="36" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="30" fill="${C.caution500}">ROTARY · 1951</text></g>`;
  press += `<g transform="translate(620 620)"><circle r="34" fill="${C.paper100}"/><circle r="28" fill="none" stroke="${C.ink900}" stroke-width="3"/><line id="gauge" x1="0" y1="0" x2="0" y2="-24" stroke="${C.alarm700}" stroke-width="4"/></g>`;
  // the delivery conveyor, sheets running off it
  press += `<rect x="1300" y="560" width="300" height="20" fill="#262b29"/><g id="sheets">${Array.from({ length: 4 }, (_, k) => `<rect class="sheet" y="534" width="120" height="26" fill="${C.paper100}" data-o="${k * 80}"/>`).join("")}</g>`;

  // ---------- bundles on the floor ----------
  const bundle = (x, y, s) => `<g transform="translate(${x} ${y}) scale(${s})"><rect x="0" y="-90" width="200" height="90" fill="${C.paper200}"/>${[0, 1, 2, 3, 4, 5].map((k) => `<line x1="0" y1="${-14 - k * 13}" x2="200" y2="${-14 - k * 13}" stroke="${C.ink300}" stroke-width="2"/>`).join("")}<line x1="60" y1="-90" x2="60" y2="0" stroke="${C.rust700}" stroke-width="5"/><line x1="140" y1="-90" x2="140" y2="0" stroke="${C.rust700}" stroke-width="5"/><rect x="0" y="-104" width="200" height="14" fill="${C.paper100}"/></g>`;
  stack += bundle(90, 1100, 1) + bundle(120, 1006, 1) + bundle(300, 1110, .9) + bundle(1380, 1120, 1);

  // ---------- the front page ----------
  const PX = 520, PY = 760, PWd = 560, PH = 400;
  let cols = "";
  for (let c = 0; c < 3; c++) for (let k = 0; k < 9; k++) { const w = 150 - (k === 8 ? 60 : r() * 18); cols += `<rect x="${f2(PX + 24 + c * 176)}" y="${PY + 222 + k * 16}" width="${f2(w)}" height="6" fill="${C.ink500}" opacity=".7"/>`; }
  // the pile it lands on
  page += `<g>${[[-14, 3, -2], [10, 8, 1.5], [-4, 14, -.8]].map(([dx, dy, rot]) => `<rect x="${PX + dx}" y="${PY + dy}" width="${PWd}" height="${PH}" fill="${C.paper200}" transform="rotate(${rot} ${PX + PWd / 2} ${PY + PH / 2})"/>`).join("")}</g>`;
  page += `<g id="page"><rect x="${PX + 10}" y="${PY + 12}" width="${PWd}" height="${PH}" fill="#000" opacity=".35"/>
    <rect x="${PX}" y="${PY}" width="${PWd}" height="${PH}" fill="${C.paper100}"/>
    <text x="${PX + PWd / 2}" y="${PY + 62}" text-anchor="middle" font-family="Pirata One" font-size="62" fill="${C.ink900}">The Doskvol Lurker</text>
    <line x1="${PX + 20}" y1="${PY + 78}" x2="${PX + PWd - 20}" y2="${PY + 78}" stroke="${C.ink900}" stroke-width="3"/>
    <text id="dateline" x="${PX + PWd / 2}" y="${PY + 96}" text-anchor="middle" font-family="Space Mono" font-size="12" fill="${C.ink700}" letter-spacing="2">LATE EDITION · 968 AC · TWO SLUGS</text>
    <line x1="${PX + 20}" y1="${PY + 104}" x2="${PX + PWd - 20}" y2="${PY + 104}" stroke="${C.ink900}" stroke-width="1"/>
    <text id="hl" x="${PX + PWd / 2}" y="${PY + 160}" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="54" fill="${C.ink900}">${esc(HEADLINES[0][0])}</text>
    <text id="sub" x="${PX + PWd / 2}" y="${PY + 196}" text-anchor="middle" font-family="GT America" font-size="20" fill="${C.ink700}">${esc(HEADLINES[0][1])}</text>
    ${cols}</g>`;

  // the pressman, minding the press
  const pm = Object.assign(JSON.parse(JSON.stringify(L.cast.byId["dock-heavy"])), { id: "pressman", outfit: { base: { type: "shirt", color: "cloth-cream" }, mid: { type: "apron", color: "cloth-navy", length: "knee" }, bottom: { type: "trousers", color: "cloth-charcoal" }, feet: { type: "oxfords", color: "cloth-black" } }, hair: { style: "crew", color: "cloth-rust", hat: { type: "flat-cap", color: "cloth-warm-grey" } }, pose: { stance: "easy", weight: "L", arms: { R: "cross", L: "cross" }, head: { tilt: -2, yaw: 14 } } });
  const pman = L.fig(pm, { id: "pressman", frames: [{}, { pose: { arms: { R: { a: "cross", b: "hold", t: .6 }, L: "cross" }, head: { tilt: 4, yaw: 20 } } }, { pose: { arms: { R: "hold", L: "cross" }, head: { tilt: 8, yaw: 22 } } }] });
  stack += L.at(pman, 460, 1010, 0.24);
  const body = `<svg class="layer" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>${defs}</defs>
  ${room}${press}${stack}${page}<rect width="${W}" height="${H}" fill="url(#lp-lamp)" style="mix-blend-mode:screen"/>
  <g transform="translate(990 0)"><line x1="0" y1="0" x2="0" y2="60" stroke="${C.ink900}" stroke-width="3"/><path d="M-50 60 L50 60 L34 90 L-34 90z" fill="${C.covert700}"/><ellipse cx="0" cy="90" rx="34" ry="6" fill="#fff0c0"/></g></svg>`;

  const script = `
const HL=${JSON.stringify(HEADLINES)};let hi=0;
const drums=[...document.querySelectorAll('.drum')].map(g=>({g,x:+g.dataset.x,y:+g.dataset.y,v:+g.dataset.v}));
const sheets=[...document.querySelectorAll('.sheet')].map(e=>({e,o:+e.dataset.o}));
const page=$('page'),hl=$('hl'),sub=$('sub'),gauge=$('gauge');
function fit(){hl.removeAttribute('textLength');hl.removeAttribute('lengthAdjust');try{if(hl.getComputedTextLength()>520){hl.setAttribute('textLength','520');hl.setAttribute('lengthAdjust','spacingAndGlyphs');}}catch(e){}}
fit();
loop((dt,c)=>{
 for(const d of drums)d.g.setAttribute('transform','rotate('+((c*d.v*57)%360).toFixed(1)+' '+d.x+' '+d.y+')');
 for(const s of sheets){const x=1300+((c*120+s.o)%320);s.e.setAttribute('x',x.toFixed(0));}
 gauge.setAttribute('transform','rotate('+(30+Math.sin(c*2.3)*8+Math.random()*3).toFixed(1)+')');
});
// a new front page: it drops onto the stack with a hard cut and a little settle
every(12,26,()=>move('pressman',[[1,160],[2,2200],[1,160],[0,0]]),5);
every(9,14,async()=>{hi=(hi+1)%HL.length;page.setAttribute('transform','translate(0 -40)');page.style.opacity='0';await new Promise(r=>setTimeout(r,180));
 hl.textContent=HL[hi][0];sub.textContent=HL[hi][1];fit();page.style.opacity='1';
 for(const [y,ms] of [[-40,60],[-12,60],[4,70],[0,0]]){page.setAttribute('transform','translate(0 '+y+') rotate('+(y/20).toFixed(2)+' 800 960)');await new Promise(r=>setTimeout(r,ms));}},8);
`;
  return L.build({ file: "lurker-press.html", title: "The Lurker press room", fonts: ["Pirata One", "Archivo Compressed", "GT America", "Space Mono"], body, script, grain: .17, vignette: .55, bg: "#1b1714", fps: 24 });
};
module.exports.HEADLINES = HEADLINES;
if (require.main === module) module.exports();
