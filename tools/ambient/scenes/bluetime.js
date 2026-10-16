// Bluetime: the city under the Ministry of Discovery's B.L.U.E. Array (b68g-permanent-bluetime: End Bluetime Control). Night
// most of the time; every so often the Array runs and the sky hard-cuts to real blue sky and sun, erratic in length, sometimes
// stuttering first, then snaps off. The book's motion is hard cuts, so day and night are two inks of one drawing, swapped.
"use strict";
const L = require("../lib.js");
const { C, f2, pts, rng } = L;

module.exports = function build() {
  const W = 1600, H = 1200, r = rng(1968);
  let defs = "";
  defs += `<linearGradient id="bt-night" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c0f1c"/><stop offset=".7" stop-color="${C.hullB}"/><stop offset="1" stop-color="#2a2f44"/></linearGradient>
  <linearGradient id="bt-day" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.file500}"/><stop offset=".6" stop-color="#6f9be0"/><stop offset="1" stop-color="${C.paraA}"/></linearGradient>
  <radialGradient id="bt-sun"><stop offset="0" stop-color="#fffbe8"/><stop offset=".3" stop-color="#fff2b0" stop-opacity=".9"/><stop offset="1" stop-color="#fff2b0" stop-opacity="0"/></radialGradient>`;

  // the skyline, drawn once as shapes; each state fills it with its own inks
  const blds = [];
  let x = -20;
  while (x < W + 20) {
    const w = 70 + r() * 120, h = 180 + r() * 380, kind = r();
    blds.push({ x, w, h, kind, win: r() });
    x += w + r() * 10;
  }
  const far = [];
  for (let k = 0, xx = -40; xx < W; k++) { const w = 50 + r() * 90, h = 260 + r() * 340; far.push({ x: xx, w, h }); xx += w; }
  const GY = 930;
  function city(night) {
    let o = "";
    // far towers in haze
    o += `<g fill="${night ? "#1b2236" : "#9bb6e6"}">${far.map((b) => `<rect x="${f2(b.x)}" y="${f2(GY - 160 - b.h)}" width="${f2(b.w)}" height="${f2(b.h + 160)}"/>`).join("")}</g>`;
    // the B.L.U.E. Array: a lattice tower with a dish ring
    const ax = 1060, ay = 120;
    const tw = night ? "#0e1220" : C.slate700;
    o += `<g fill="${tw}"><polygon points="${pts([[ax - 70, GY], [ax - 14, ay + 140], [ax + 14, ay + 140], [ax + 70, GY]])}"/></g>`;
    o += `<g stroke="${night ? "#1e2638" : C.slate500}" stroke-width="3">${Array.from({ length: 14 }, (_, k) => { const y0 = ay + 150 + k * 48, y1 = y0 + 48, w0 = 14 + (y0 - ay - 140) / (GY - ay - 140) * 56, w1 = 14 + (y1 - ay - 140) / (GY - ay - 140) * 56; return `<line x1="${f2(ax - w0)}" y1="${y0}" x2="${f2(ax + w1)}" y2="${y1}"/><line x1="${f2(ax + w0)}" y1="${y0}" x2="${f2(ax - w1)}" y2="${y1}"/>`; }).join("")}</g>`;
    o += `<ellipse cx="${ax}" cy="${ay + 120}" rx="120" ry="26" fill="none" stroke="${tw}" stroke-width="12"/><ellipse cx="${ax}" cy="${ay + 120}" rx="70" ry="14" fill="none" stroke="${tw}" stroke-width="8"/>`;
    o += `<rect x="${ax - 8}" y="${ay}" width="16" height="130" fill="${tw}"/><circle cx="${ax}" cy="${ay}" r="14" fill="${night ? C.alarm500 : C.paper100}" class="${night ? "beacon" : ""}"/>`;
    // the near skyline
    for (const b of blds) {
      const top = GY - b.h;
      const fill = night ? "#141a2a" : b.kind < .33 ? C.paper200 : b.kind < .66 ? C.caution500 : "#d9a46a";
      const side = night ? "#0c101c" : b.kind < .33 ? C.paper300 : b.kind < .66 ? C.caution700 : C.rust500;
      o += `<rect x="${f2(b.x)}" y="${f2(top)}" width="${f2(b.w)}" height="${f2(b.h + 300)}" fill="${fill}"/>`;
      o += `<rect x="${f2(b.x + b.w * .72)}" y="${f2(top)}" width="${f2(b.w * .28)}" height="${f2(b.h + 300)}" fill="${side}"/>`;
      if (b.kind > .8) o += `<rect x="${f2(b.x + b.w * .4)}" y="${f2(top - 40)}" width="6" height="40" fill="${side}"/>`;
      // windows: lit at night, dark glass by day
      let win = "";
      for (let wy = top + 20; wy < GY - 20; wy += 34) for (let wx = b.x + 10; wx < b.x + b.w * .7 - 12; wx += 24) {
        const lit = ((wx * 7 + wy * 13) % 17) / 17 < (0.25 + b.win * .4);
        if (night ? lit : true) win += `<rect x="${f2(wx)}" y="${f2(wy)}" width="12" height="18"/>`;
      }
      o += `<g fill="${night ? "#f2d48a" : C.file700}" opacity="${night ? .75 : .35}">${win}</g>`;
    }
    // the billboard
    const bx = 120, by = 520;
    o += `<g transform="translate(${bx} ${by})"><rect x="40" y="200" width="10" height="220" fill="${night ? "#0c101c" : C.ink700}"/><rect x="350" y="200" width="10" height="220" fill="${night ? "#0c101c" : C.ink700}"/>
      <rect width="400" height="200" fill="${night ? "#20283c" : C.paper100}"/><circle cx="76" cy="100" r="58" fill="${night ? "#2b3550" : C.caution500}"/>
      <text x="150" y="70" font-family="Michroma" font-size="20" fill="${night ? "#3a4566" : C.file700}">THE SUN</text>
      <text x="150" y="104" font-family="Archivo Condensed" font-weight="800" font-size="23" fill="${night ? "#3a4566" : C.ink900}">BROUGHT TO YOU BY</text>
      <text x="150" y="136" font-family="Archivo Condensed" font-weight="800" font-size="23" fill="${night ? "#3a4566" : C.ink900}">THE MINISTRY</text>
      <text x="150" y="168" font-family="Archivo Condensed" font-weight="800" font-size="23" fill="${night ? "#3a4566" : C.ink900}">OF DISCOVERY</text></g>`;
    // the street
    o += `<rect x="0" y="${GY}" width="${W}" height="${H - GY}" fill="${night ? "#0b0d14" : "#8a8f96"}"/><rect x="0" y="${GY}" width="${W}" height="14" fill="${night ? "#1a1f2c" : C.paper300}"/>`;
    o += `<g fill="${night ? "#161a26" : C.paper200}">${[0, 1, 2, 3, 4, 5].map((k) => `<rect x="${60 + k * 280}" y="${GY + 120}" width="140" height="12"/>`).join("")}</g>`;
    return o;
  }

  // the Array's interference rings while it runs (the paranormal motif)
  let rings = `<g id="rings" style="display:none" fill="none" stroke="${C.paraA}">`;
  for (let k = 0; k < 6; k++) rings += `<circle class="ring" cx="1060" cy="240" r="40" stroke-width="3" data-k="${k}"/>`;
  rings += `</g>`;

  // a tram stop and Zam, who shades his eyes when the sky comes on
  const zam = L.fig(L.npc("zam"), { id: "zam", frames: [{}, { pose: { arms: { L: { a: "hip", b: "raise", t: .6 } }, head: { tilt: -4 } } }, { pose: { arms: { L: { a: "hip", b: "raise", t: 1 } }, head: { tilt: -10 } } }] });
  const stop = (night) => `<g transform="translate(1290 ${GY + 160})"><rect x="-6" y="-300" width="12" height="300" fill="${night ? "#1a1f2c" : C.ink700}"/><rect x="-60" y="-340" width="120" height="60" fill="${night ? "#20283c" : C.signal500}"/><text x="0" y="-300" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="36" fill="${night ? "#3a4566" : C.paper100}">TRAM</text></g>`;

  const body = `<svg class="layer" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>${defs}</defs>
  <g id="night"><rect width="${W}" height="${H}" fill="url(#bt-night)"/><g id="stars">${Array.from({ length: 70 }, () => `<circle cx="${f2(r() * W)}" cy="${f2(r() * 520)}" r="${f2(.8 + r() * 1.4)}" fill="#c9d6ff" opacity="${f2(.2 + r() * .5)}"/>`).join("")}</g>
    <path d="M-100 700 Q800 -260 1700 700" fill="none" stroke="#3a4a80" stroke-width="2" opacity=".35"/><path d="M-100 760 Q800 -160 1700 760" fill="none" stroke="#3a4a80" stroke-width="1.5" opacity=".2"/>
    ${city(true)}${stop(true)}</g>
  <g id="day" style="display:none"><rect width="${W}" height="${H}" fill="url(#bt-day)"/><circle cx="420" cy="230" r="220" fill="url(#bt-sun)"/><circle cx="420" cy="230" r="62" fill="#fffbe8"/>
    ${Array.from({ length: 5 }, (_, k) => `<ellipse class="cloud" cx="${f2(r() * W)}" cy="${f2(120 + r() * 260)}" rx="${f2(90 + r() * 120)}" ry="${f2(18 + r() * 14)}" fill="#fff" opacity=".75" data-v="${f2(8 + r() * 10)}"/>`).join("")}
    ${city(false)}${stop(false)}
    <g opacity=".22" fill="${C.file900}">${blds.map((b) => `<polygon points="${pts([[b.x + b.w, GY], [b.x + b.w + 60, GY + 70], [b.x + b.w * 1.2 + 60, GY + 70], [b.x + b.w * 1.2, GY]])}"/>`).join("")}</g></g>
  ${rings}
  ${L.at(zam, 1200, GY + 200, 0.27)}
  </svg>
  <div id="cap" style="position:absolute;right:3%;bottom:3%;font:400 clamp(9px,1.1cqw,15px) 'Space Mono';color:#c9d6ff;opacity:.6;letter-spacing:.18em">B.L.U.E. ARRAY · STANDBY</div>`;

  const script = `
const night=$('night'),day=$('day'),rings=$('rings'),cap=$('cap');const rs=[...document.querySelectorAll('.ring')];
const clouds=[...document.querySelectorAll('.cloud')].map(e=>({e,x:+e.getAttribute('cx'),v:+e.dataset.v}));
const beacons=[...document.querySelectorAll('.beacon')];
let on=false,onAt=0;
function sky(v){on=v;night.style.display=v?'none':'';day.style.display=v?'':'none';rings.style.display=v?'':'none';cap.textContent=v?'B.L.U.E. ARRAY · BLUETIME':'B.L.U.E. ARRAY · STANDBY';cap.style.color=v?'#12224f':'#c9d6ff';}
const wait=ms=>new Promise(res=>setTimeout(res,ms));
async function bluetime(){
 // sometimes it stutters before it holds
 if(Math.random()<.6){for(let i=0,n=1+Math.floor(Math.random()*3);i<n;i++){sky(true);await wait(R(80,260));sky(false);await wait(R(200,900));}}
 sky(true);onAt=performance.now();move('zam',[[1,160],[2,0]]);
 await wait(R(22000,70000));
 if(Math.random()<.4){sky(false);await wait(120);sky(true);await wait(R(400,1500));}
 sky(false);move('zam',[[1,160],[0,0]]);
}
let next=R(12,30);loop(dt=>{if(on)return;next-=dt;if(next<=0){next=R(45,140);bluetime();}});
loop((dt,c)=>{
 for(const b of beacons)b.setAttribute('opacity',(Math.sin(c*3)>0?1:.15));
 if(!on)return;
 for(const r of rs){const k=+r.dataset.k;const t=((c*.35+k/6)%1);r.setAttribute('r',(40+t*520).toFixed(1));r.setAttribute('opacity',(.6*(1-t)).toFixed(2));}
 for(const cl of clouds){cl.x+=cl.v*dt;if(cl.x>1850)cl.x=-250;cl.e.setAttribute('cx',cl.x.toFixed(1));}
});
`;
  return L.build({ file: "bluetime.html", title: "Bluetime", fonts: ["Archivo Compressed", "Archivo Condensed", "Michroma", "Space Mono"], body, script, grain: .14, vignette: .45, bg: "#0c0f1c", fps: 20 });
};
if (require.main === module) module.exports();
