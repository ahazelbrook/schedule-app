// Calling cards: the faction deck's cards for the factions the crew know (b68g-factions; never a GM-only faction), dealt one
// at a time onto green baize under a hanging lamp, face down, then flipped. The art is the design system's faction deck
// (assets/factions), shrunk into cards/.
"use strict";
const fs = require("fs"), path = require("path");
const L = require("../lib.js");
const { C, f2, pts, rng } = L;

const CARDS = ["19-limmerfield-gang", "16-keel-twins", "22-ministry-of-discovery", "33-strangford-michter-financial", "05-bluecoats-city-watch", "30-section-6", "21-lounge-rats", "27-doskvol-lurker-newspaper"];

module.exports = function build() {
  const W = 1600, H = 1200, r = rng(40);
  const CW = 380, CH = 228;
  let defs = "", table = "", deck = "", cards = "";
  defs += `<radialGradient id="cc-lamp" cx=".5" cy=".42" r=".62"><stop offset="0" stop-color="#2f7a52"/><stop offset=".55" stop-color="#1d5a3a"/><stop offset="1" stop-color="#0b2416"/></radialGradient>
  <radialGradient id="cc-pool" cx=".5" cy=".4" r=".55"><stop offset="0" stop-color="#fff2c0" stop-opacity=".22"/><stop offset="1" stop-color="#fff2c0" stop-opacity="0"/></radialGradient>
  <pattern id="cc-back" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="${C.alarm700}"/><circle cx="20" cy="20" r="14" fill="none" stroke="${C.paper100}" stroke-width="2" opacity=".5"/><circle cx="20" cy="20" r="6" fill="${C.paper100}" opacity=".35"/></pattern>`;

  // ---------- the table ----------
  table += `<rect width="${W}" height="${H}" fill="url(#cc-lamp)"/>`;
  let nap = "";
  for (let k = 0; k < 900; k++) nap += `<rect x="${f2(r() * W)}" y="${f2(r() * H)}" width="${f2(2 + r() * 5)}" height="1.4" fill="#000" opacity="${f2(.05 + r() * .1)}" transform="rotate(${f2(r() * 180)} 0 0)"/>`;
  table += `<g>${nap}</g>`;
  table += `<rect x="-20" y="-20" width="${W + 40}" height="${H + 40}" rx="120" fill="none" stroke="#3a2213" stroke-width="80"/><rect x="18" y="18" width="${W - 36}" height="${H - 36}" rx="90" fill="none" stroke="${C.caution700}" stroke-width="3" opacity=".5"/>`;
  // chips, an ashtray with a cigarette, a glass
  const chip = (x, y, col, n) => Array.from({ length: n }, (_, k) => `<g transform="translate(${x} ${y - k * 7})"><ellipse rx="34" ry="14" fill="${C.ink900}" opacity="${k ? 0 : .35}" cy="8"/><ellipse rx="34" ry="14" fill="${col}"/><ellipse rx="22" ry="9" fill="none" stroke="${C.paper100}" stroke-width="3" stroke-dasharray="6 6"/></g>`).join("");
  table += chip(1350, 1040, C.alarm700, 5) + chip(1420, 1070, C.file500, 3) + chip(1300, 1100, C.paper200, 4) + chip(220, 1080, C.covert700, 6);
  table += `<g transform="translate(240 170)"><ellipse rx="90" ry="44" fill="#000" opacity=".3" cy="10"/><ellipse rx="90" ry="44" fill="#8a8f96"/><ellipse rx="64" ry="30" fill="#55504a"/><rect x="-6" y="-8" width="110" height="10" rx="4" fill="${C.paper100}" transform="rotate(-12)"/><rect x="96" y="-30" width="14" height="10" fill="${C.signal500}" transform="rotate(-12)"/>
    <g id="wisp" fill="none" stroke="#e8e2d4" stroke-linecap="round" opacity=".5"><path d="M108 -36 q-20 -40 10 -80 q30 -40 0 -90" stroke-width="5"/></g></g>`;
  table += `<g transform="translate(1380 200)"><ellipse rx="60" ry="22" fill="#000" opacity=".3" cy="14"/><ellipse rx="56" ry="20" fill="#c9d6dc" opacity=".55"/><ellipse rx="44" ry="15" fill="${C.caution700}" opacity=".7"/><ellipse rx="56" ry="20" fill="none" stroke="#fff" stroke-width="3" opacity=".5"/></g>`;
  table += `<rect width="${W}" height="${H}" fill="url(#cc-pool)"/>`;

  // ---------- the deck ----------
  const DX = 800, DY = 1060;
  deck += `<g transform="translate(${DX} ${DY})">${[0, 1, 2, 3].map((k) => `<rect x="${-CW / 2 + k}" y="${-CH / 2 - k * 3}" width="${CW}" height="${CH}" rx="10" fill="url(#cc-back)" stroke="${C.paper100}" stroke-width="6"/>`).join("")}</g>`;

  // ---------- the cards ----------
  const spots = [[300, 340, -8], [670, 300, -2], [1040, 320, 5], [1350, 400, 9], [330, 700, -5], [690, 680, 3], [1060, 700, -4], [1330, 760, 7]];
  CARDS.forEach((c, i) => {
    const b64 = fs.readFileSync(path.join(__dirname, "..", "cards", c + ".jpg")).toString("base64");
    cards += `<g class="card" id="cd${i}" style="display:none" data-x="${spots[i][0]}" data-y="${spots[i][1]}" data-r="${spots[i][2]}">
      <rect x="${-CW / 2 + 8}" y="${-CH / 2 + 12}" width="${CW}" height="${CH}" rx="10" fill="#000" opacity=".4"/>
      <g class="back"><rect x="${-CW / 2}" y="${-CH / 2}" width="${CW}" height="${CH}" rx="10" fill="url(#cc-back)" stroke="${C.paper100}" stroke-width="6"/></g>
      <g class="face" style="display:none"><rect x="${-CW / 2 - 3}" y="${-CH / 2 - 3}" width="${CW + 6}" height="${CH + 6}" rx="11" fill="${C.paper100}"/><image href="data:image/jpeg;base64,${b64}" x="${-CW / 2}" y="${-CH / 2}" width="${CW}" height="${CH}" preserveAspectRatio="xMidYMid slice"/></g></g>`;
  });

  const body = `<svg class="layer" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>${defs}</defs>
  ${table}${deck}<g id="cards">${cards}</g>
  <g transform="translate(800 0)"><line x1="0" y1="0" x2="0" y2="40" stroke="${C.ink900}" stroke-width="4"/><path d="M-120 40 L120 40 L80 90 L-80 90z" fill="${C.covert900}"/><ellipse cx="0" cy="90" rx="80" ry="10" fill="#fff2c0"/></g></svg>`;

  const script = `
const DX=${DX},DY=${DY};const cards=[...document.querySelectorAll('.card')].map(g=>({g,x:+g.dataset.x,y:+g.dataset.y,r:+g.dataset.r,back:g.querySelector('.back'),face:g.querySelector('.face')}));
const host=$('cards'),wisp=$('wisp');
const sleep=ms=>new Promise(res=>setTimeout(res,ms));
const ease=t=>1-Math.pow(1-t,3);
function put(c,x,y,r,sx){c.g.setAttribute('transform','translate('+x.toFixed(1)+' '+y.toFixed(1)+') rotate('+r.toFixed(2)+') scale('+(sx==null?1:sx).toFixed(3)+' 1)');}
function fly(c,from,to,ms){return new Promise(res=>{const t0=performance.now();const f=()=>{const t=Math.min(1,(performance.now()-t0)/ms),e=ease(t);put(c,from[0]+(to[0]-from[0])*e,from[1]+(to[1]-from[1])*e,from[2]+(to[2]-from[2])*e);if(t<1)requestAnimationFrame(f);else res();};f();});}
async function flip(c){for(const s of [.6,.15]){put(c,c.x,c.y,c.r,s);await sleep(50);}c.back.style.display='none';c.face.style.display='';for(const s of [.15,.6,1]){put(c,c.x,c.y,c.r,s);await sleep(50);}}
async function round(){
 const order=cards.slice().sort(()=>Math.random()-.5);
 // the deal order decides the spots, so the spread changes every round
 const spots=cards.map(c=>[c.x,c.y,c.r]);
 for(let i=0;i<order.length;i++){const c=order[i];[c.x,c.y,c.r]=spots[i];c.back.style.display='';c.face.style.display='none';c.g.style.display='';host.appendChild(c.g);
  await fly(c,[DX,DY,0],[c.x,c.y,c.r],520);await sleep(260);await flip(c);await sleep(R(1800,3200));}
 await sleep(R(20000,32000));
 for(const c of order.slice().reverse()){await fly(c,[c.x,c.y,c.r],[DX,DY,0],300);c.g.style.display='none';}
 await sleep(1800);round();
}
// ?spread shows the whole spread at once (for a still)
if(new URLSearchParams(location.search).has('spread')){for(const c of cards){c.g.style.display='';c.back.style.display='none';c.face.style.display='';put(c,c.x,c.y,c.r);}}else round();
loop((dt,c)=>{wisp.setAttribute('transform','translate('+(Math.sin(c*.7)*6).toFixed(1)+' 0) skewX('+(Math.sin(c*.5)*8).toFixed(1)+')');wisp.setAttribute('opacity',(.35+Math.sin(c*1.1)*.15).toFixed(2));});
`;
  return L.build({ file: "calling-cards.html", title: "Calling cards", fonts: [], body, script, grain: .14, vignette: .6, bg: "#0b2416", fps: 20 });
};
if (require.main === module) module.exports();
