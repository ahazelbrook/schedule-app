// The Undertow: Mira's club in Silkshore (Alfie's ex, his friend and vice purveyor), in a drained swimming baths where the
// dance floor is the deep end (b68g-factions). The Swinger palette, mustard and dusty magenta: an oil-wheel light show on the
// baths' tiles, a mirror ball, go-go cages on the pool deck, the crowd down in the deep end, and Mira at the bar.
"use strict";
const L = require("../lib.js");
const { C, f2, pts, rng } = L;

module.exports = function build() {
  const W = 1600, H = 1200, r = rng(808);
  const MAG = C.swingB, MUS = C.caution500;
  let defs = "", back = "", floor = "", stage = "", bar = "", crowd = "";

  defs += `<radialGradient id="mc-blob"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".6" stop-color="#fff" stop-opacity=".5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <linearGradient id="mc-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.swing900}"/><stop offset="1" stop-color="#1a0a14"/></linearGradient>
  <radialGradient id="mc-ball"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#c9c3b8"/><stop offset="1" stop-color="#55504a"/></radialGradient>
  <radialGradient id="mc-glow"><stop offset="0" stop-color="${C.swing500}" stop-opacity=".55"/><stop offset="1" stop-color="${C.swing500}" stop-opacity="0"/></radialGradient>
  <radialGradient id="mc-spot" cx=".5" cy="0" r="1"><stop offset="0" stop-color="${MUS}" stop-opacity=".5"/><stop offset="1" stop-color="${MUS}" stop-opacity="0"/></radialGradient>
  <clipPath id="mc-wallclip"><rect x="0" y="0" width="${W}" height="760"/></clipPath>`;

  // ---------- back wall and the oil-wheel projection ----------
  back += `<rect width="${W}" height="760" fill="${C.swing900}"/>`;
  let oil = `<g clip-path="url(#mc-wallclip)" style="mix-blend-mode:screen">`;
  const cols = [MAG, MUS, C.signal500, C.swing500, "#7a3fa0"];
  for (let w = 0; w < 3; w++) {
    const cx = [380, 820, 1240][w], cy = [330, 300, 360][w];
    oil += `<g class="wheel" data-cx="${cx}" data-cy="${cy}" data-v="${[7, -5, 6][w]}" opacity=".75">`;
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * Math.PI * 2 + r(), d = 60 + r() * 140, rr = 80 + r() * 120;
      oil += `<circle class="blob" cx="${f2(cx + Math.cos(a) * d)}" cy="${f2(cy + Math.sin(a) * d)}" r="${f2(rr)}" fill="${cols[(k + w) % cols.length]}" opacity="${f2(.35 + r() * .35)}" data-ph="${f2(r() * 6)}" data-r="${f2(rr)}"/>`;
    }
    oil += `</g>`;
  }
  oil += `</g>`;
  back += oil;
  // the wall's panelling and a dark band at the floor line
  let bt = "";
  for (let y = 0; y < 700; y += 50) for (let x = 0; x < W; x += 50) bt += `<rect x="${x + 2}" y="${y + 2}" width="46" height="46"/>`;
  back += `<g fill="#000" opacity=".16">${bt}</g>`;
  // high baths windows, blacked out
  for (let k = 0; k < 5; k++) back += `<path d="M${120 + k * 320} 420 V200 Q${200 + k * 320} 120 ${280 + k * 320} 200 V420z" fill="#000" opacity=".3"/>`;

  // ---------- neon ----------
  back += `<g id="neon" transform="translate(1210 210)"><circle r="260" fill="url(#mc-glow)"/>
    <text x="0" y="40" text-anchor="middle" font-family="Yellowtail" font-size="118" fill="none" stroke="${C.swing500}" stroke-width="14" opacity=".45">the Undertow</text>
    <text x="0" y="40" text-anchor="middle" font-family="Yellowtail" font-size="118" fill="#ffd6ec" stroke="#ff7ac0" stroke-width="3">the Undertow</text>
    <text x="0" y="96" text-anchor="middle" font-family="Michroma" font-size="22" fill="${MUS}" letter-spacing="6">SILKSHORE · THE DEEP END</text></g>`;

  // ---------- mirror ball ----------
  let ball = `<g transform="translate(560 0)"><line x1="0" y1="0" x2="0" y2="40" stroke="${C.ink900}" stroke-width="3"/><g id="ball" transform="translate(0 92)"><circle r="54" fill="url(#mc-ball)"/>`;
  for (let row = -4; row <= 4; row++) for (let k = -5; k <= 5; k++) {
    const x = k * 10 * Math.cos(row / 5), y = row * 11;
    if (x * x + y * y < 50 * 50) ball += `<rect class="tile" x="${f2(x - 4)}" y="${f2(y - 4)}" width="8" height="8" fill="#fff" opacity="${f2(.15 + r() * .6)}"/>`;
  }
  ball += `</g></g>`;
  let specks = `<g id="specks" fill="#fff">`;
  for (let k = 0; k < 40; k++) specks += `<rect width="${f2(4 + r() * 5)}" height="${f2(4 + r() * 5)}" data-a="${f2(r() * 6.28)}" data-d="${f2(200 + r() * 700)}" data-y="${f2(r())}" opacity="${f2(.3 + r() * .5)}"/>`;
  specks += `</g>`;

  // ---------- the floor: perspective checkerboard ----------
  // the pool deck the cages stand on, then the deep end's wall, then the basin floor
  floor += `<rect x="0" y="700" width="${W}" height="40" fill="${C.paper200}"/><rect x="0" y="736" width="${W}" height="8" fill="${C.ink700}"/>`;
  let dw = "";
  for (let y = 744; y < 930; y += 31) for (let x = (y % 2) * 0; x < W; x += 62) dw += `<rect x="${x + 2}" y="${y + 2}" width="58" height="27"/>`;
  floor += `<rect x="0" y="744" width="${W}" height="186" fill="#3e7f86"/><g fill="#4f96a0">${dw}</g>`;
  floor += `<text x="720" y="860" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="64" fill="${C.ink900}" opacity=".7" letter-spacing="3" word-spacing="16">DEEP END · 3.5 M</text>`;
  floor += [400].map((x) => `<g fill="none" stroke="#d9dde0" stroke-width="8" stroke-linecap="round"><path d="M${x} 700 Q${x} 660 ${x + 30} 660 Q${x + 60} 660 ${x + 60} 700 V900"/><path d="M${x + 70} 700 Q${x + 70} 660 ${x + 100} 660 Q${x + 130} 660 ${x + 130} 700 V900"/></g><g stroke="#d9dde0" stroke-width="6">${[760, 800, 840].map((y) => `<line x1="${x + 60}" y1="${y}" x2="${x + 130}" y2="${y}"/>`).join("")}</g>`).join("");
  floor += `<rect x="0" y="930" width="${W}" height="${H - 930}" fill="#245a62"/><rect x="0" y="930" width="${W}" height="12" fill="#163c42"/>`;
  const HY = 942, VPX = 800, VPY = 560;
  let chk = "";
  const rows = [942, 980, 1030, 1100, 1190, 1320];
  for (let i = 0; i < rows.length - 1; i++) {
    const y0 = rows[i], y1 = rows[i + 1];
    for (let k = -14; k < 14; k++) {
      if ((i + k) % 2) continue;
      const xa = (y) => VPX + (k * 120) * (y - VPY) / (HY - VPY);
      const xb = (y) => VPX + ((k + 1) * 120) * (y - VPY) / (HY - VPY);
      chk += `<polygon points="${pts([[xa(y0), y0], [xb(y0), y0], [xb(y1), y1], [xa(y1), y1]])}"/>`;
    }
  }
  floor += `<g fill="#1e4e56" opacity=".55">${chk}</g>`;
  // the lane lines on the basin floor
  floor += `<g stroke="${C.ink900}" stroke-width="16" opacity=".45">${[-3, -1, 1, 3].map((k) => `<line x1="${VPX + k * 240 * 0 + k * 60}" y1="942" x2="${VPX + k * 420}" y2="${H}"/>`).join("")}</g>`;
  floor += `<g id="floorglow" style="mix-blend-mode:screen"><ellipse cx="560" cy="930" rx="300" ry="60" fill="${MUS}" opacity=".18"/><ellipse cx="1040" cy="980" rx="260" ry="50" fill="${C.swing500}" opacity=".2"/></g>`;

  // ---------- go-go cages with dancers (silhouettes, a stop-motion groove) ----------
  const dancer = (id, base, flip) => {
    const s = Object.assign(L.pc("stacey"), base);
    return L.fig(s, { id, silhouette: true, lod: "lo", shadow: false, frames: [
      { pose: { arms: { R: "raise", L: "hip" }, head: { tilt: 6 } } },
      { pose: { arms: { R: { a: "raise", b: "hip", t: .5 }, L: { a: "hip", b: "raise", t: .5 } }, head: { tilt: 0 } } },
      { pose: { arms: { R: "hip", L: "raise" }, head: { tilt: -6 } } },
      { pose: { arms: { R: "raise", L: "raise" }, head: { tilt: 0 } } },
    ] });
  };
  const soc = L.cast.byId.socialite;
  const d1 = dancer("dancer1", { id: "dancer1", figure: "fem", shape: "hourglass", hair: soc.hair, outfit: soc.outfit, props: [], face: soc.face, head: soc.head, heightIn: 66 });
  const d2 = dancer("dancer2", { id: "dancer2", figure: "fem", shape: "slim", hair: { style: "pixie", color: "cloth-black" }, outfit: { dress: { type: "shift-dress", color: "cloth-white" }, feet: { type: "go-go-boots", color: "cloth-white" } }, props: [], face: soc.face, head: soc.head, heightIn: 65 });
  const cage = (x, y, f, fill) => `<g transform="translate(${x} ${y})">
    <rect x="-110" y="0" width="220" height="40" fill="${C.ink900}"/><rect x="-110" y="0" width="220" height="8" fill="${MUS}"/>
    <ellipse cx="0" cy="-2" rx="110" ry="14" fill="${fill}" opacity=".5"/>
    <g opacity=".95">${L.at(f, 0, 0, 0.19, `fill="${C.ink900}"`)}</g>
    <g stroke="${MUS}" stroke-width="4">${[-100, -60, -20, 20, 60, 100].map((cx) => `<line x1="${cx}" y1="0" x2="${cx * .82}" y2="-420"/>`).join("")}</g>
    <path d="M-82 -420 Q0 -470 82 -420" stroke="${MUS}" stroke-width="6" fill="none"/><ellipse cx="0" cy="-420" rx="82" ry="10" fill="none" stroke="${MUS}" stroke-width="4"/>
    <line x1="0" y1="-460" x2="0" y2="-900" stroke="${C.ink900}" stroke-width="5"/></g>`;
  stage += cage(230, 720, d1, MAG) + cage(830, 720, d2, MUS);
  // spotlights on the cages
  stage += `<polygon class="spot" points="${pts([[200, -10], [260, -10], [370, 720], [90, 720]])}" fill="url(#mc-spot)" style="mix-blend-mode:screen"/>`;
  stage += `<polygon class="spot" points="${pts([[800, -10], [860, -10], [970, 720], [690, 720]])}" fill="url(#mc-spot)" style="mix-blend-mode:screen"/>`;

  // ---------- the bar and Mira ----------
  const mira = L.fig(L.npc("mira"), { id: "mira", frames: [{},
    { pose: { arms: { R: { a: "hold", b: "smoke", t: .45, as: "hold" } } } },
    { pose: { arms: { R: { a: "hold", b: "smoke", t: .85, as: "hold" } }, head: { tilt: -8 } } }] });
  bar += `<g transform="translate(1060 0)">`;
  // back bar: shelves of bottles under a strip light
  bar += `<rect x="0" y="520" width="560" height="240" fill="#2a1020"/><rect x="0" y="516" width="560" height="6" fill="${MUS}" opacity=".7"/>`;
  for (let sh = 0; sh < 2; sh++) {
    bar += `<rect x="10" y="${640 + sh * 70}" width="540" height="6" fill="${C.ink900}"/>`;
    for (let k = 0; k < 20; k++) { const bx = 20 + k * 27 + r() * 6, bh = 34 + r() * 26, bc = [C.covert700, C.rust500, MUS, C.paraA, MAG, C.ink700][Math.floor(r() * 6)]; bar += `<rect x="${f2(bx)}" y="${f2(640 + sh * 70 - bh)}" width="14" height="${f2(bh)}" rx="3" fill="${bc}" opacity=".85"/><rect x="${f2(bx + 4)}" y="${f2(640 + sh * 70 - bh - 10)}" width="6" height="12" fill="${bc}"/><rect x="${f2(bx + 2)}" y="${f2(640 + sh * 70 - bh + 6)}" width="3" height="${f2(bh - 12)}" fill="#fff" opacity=".25"/>`; }
  }
  bar += `</g>`;
  bar += L.at(mira, 1330, 1080, 0.255);
  // the counter in front of her
  bar += `<path d="M1040 900 L1600 880 L1600 1200 L1070 1200z" fill="#5e1840"/><path d="M1040 900 L1600 880 L1600 904 L1046 926z" fill="${MUS}"/><path d="M1046 926 L1600 904 L1600 920 L1052 942z" fill="#1a0a14" opacity=".6"/>${[0,1,2,3,4,5].map((k) => `<line x1="${1090 + k * 90}" y1="${942 - k * 3}" x2="${1100 + k * 90}" y2="1200" stroke="#1a0a14" stroke-width="3" opacity=".35"/>`).join("")}`;
  bar += `<g transform="translate(1160 895)"><rect x="-10" y="-30" width="20" height="30" fill="${C.paraA}" opacity=".55"/><rect x="40" y="-46" width="16" height="46" rx="3" fill="${C.covert700}"/><rect x="45" y="-56" width="6" height="12" fill="${C.covert700}"/></g>`;

  // ---------- the crowd down in the deep end: kit silhouettes dancing, a four-frame groove each, no jumping ----------
  const grooves = [
    [{ R: "raise", L: "hip" }, { R: { a: "raise", b: "hip", t: .5 }, L: { a: "hip", b: "raise", t: .5 } }, { R: "hip", L: "raise" }, { R: "raise", L: "raise" }],
    [{ R: "hold", L: "hold" }, { R: "raise", L: "hold" }, { R: "hold", L: "hold" }, { R: "hold", L: "raise" }],
    [{ R: "down", L: "raise" }, { R: { a: "down", b: "raise", t: .5 }, L: { a: "raise", b: "down", t: .5 } }, { R: "raise", L: "down" }, { R: "hip", L: "hip" }],
  ];
  const tilts = [6, 0, -6, 0];
  const who = ["socialite", "racer", "militant", "fence", "noble", "urchin", "intellectual", "bartender"];
  const spots = [[110, 1080, .14], [280, 1070, .14], [450, 1082, .14], [620, 1072, .14], [790, 1080, .14], [190, 1270, .2], [480, 1262, .2], [770, 1275, .2]];
  crowd += `<g id="crowd">`;
  who.forEach((id, i) => {
    const base = JSON.parse(JSON.stringify(L.cast.byId[id]));
    const spec = Object.assign(base, { id: "pool" + i, props: [], companion: undefined });
    delete spec.companion;
    const g = grooves[i % grooves.length];
    const f = L.fig(spec, { id: "pool" + i, silhouette: true, lod: "lo", shadow: false, frames: g.map((arms, k) => ({ pose: { arms, head: { tilt: tilts[(k + i) % 4] }, stance: "easy" } })) });
    const [x, y, s] = spots[i];
    crowd += `<g class="pooldancer" data-x="${x}" data-y="${y}" data-i="${i}" data-ph="${f2(r() * 6)}" transform="translate(${x} ${y})">${L.at(f, 0, 0, s)}</g>`;
  });
  crowd += `</g>`;

  const body = `<svg class="layer" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>${defs}</defs>
  ${back}${floor}${stage}${ball}${specks}${bar}${crowd}</svg>`;

  const script = `
const wheels=[...document.querySelectorAll('.wheel')].map(g=>({g,cx:+g.dataset.cx,cy:+g.dataset.cy,v:+g.dataset.v,b:[...g.querySelectorAll('.blob')].map(c=>({c,r:+c.dataset.r,ph:+c.dataset.ph}))}));
const specks=[...document.querySelectorAll('#specks rect')].map(e=>({e,a:+e.dataset.a,d:+e.dataset.d,y:+e.dataset.y}));
const pool=[...document.querySelectorAll('.pooldancer')].map(g=>({g,x:+g.dataset.x,y:+g.dataset.y,i:+g.dataset.i,ph:+g.dataset.ph,k:+g.dataset.i%4}));
const tiles=[...document.querySelectorAll('.tile')];const neon=$('neon');
const BPM=118, beat=60/BPM;
loop((dt,c)=>{
 for(const w of wheels){w.g.setAttribute('transform','rotate('+(c*w.v).toFixed(2)+' '+w.cx+' '+w.cy+')');for(const b of w.b)b.c.setAttribute('r',(b.r*(1+Math.sin(c*.4+b.ph)*.18)).toFixed(1));}
 for(const s of specks){const a=s.a+c*.25;const x=560+Math.cos(a)*s.d;const y=120+s.y*600+Math.sin(a*2)*20;s.e.setAttribute('x',x.toFixed(0));s.e.setAttribute('y',y.toFixed(0));s.e.style.display=(Math.cos(a)>-.2)?'':'none';}
 const ph=(c/beat)%1;
 // a slow sway from the feet, on the beat; the groove itself is the frame cuts below
 for(const d of pool){d.g.setAttribute('transform','translate('+d.x+' '+d.y+') rotate('+(Math.sin((c/beat)*Math.PI+d.ph)*2.2).toFixed(2)+')');}
 if(Math.random()<.02){const t=tiles[Math.floor(Math.random()*tiles.length)];t.setAttribute('opacity',(.15+Math.random()*.7).toFixed(2));}
 neon.setAttribute('opacity',Math.random()<.004?'.25':'1');
});
// the dancers: a four-frame groove on the beat, in turn
let n1=0,n2=2;every(beat*2,beat*2,()=>{n1=(n1+1)%4;Motion.show('dancer1',n1);},0);
every(beat*2,beat*2,()=>{n2=(n2+3)%4;Motion.show('dancer2',n2);},beat);
// the deep end: everyone on their own count, half of them on the off-beat
every(beat,beat,()=>{for(const d of pool){if(Math.random()<.55){d.k=(d.k+1)%4;Motion.show('pool'+d.i,d.k);}}},beat/2);
// Mira sips, now and then
every(10,24,()=>move('mira',[[1,160],[2,1800],[1,160],[0,0]]),6);
`;
  return L.build({ file: "undertow.html", title: "The Undertow", fonts: ["Yellowtail", "Michroma", "Archivo Compressed"], body, script, grain: .16, vignette: .55, bg: "#1a0a14", fps: 30 });
};
if (require.main === module) module.exports();
