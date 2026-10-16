// Wanted wall: City Watch of Duskwall posters of the crew on wet brick under a sodium lamp. One poster per Wanted Level
// (Babel, Ashtray & Buck, Stacey, 99.47 in that order); Heat 4+ adds curfew bills and 7+ a searchlight. When Wanted goes up,
// Vanden (the lazy Bluecoat, Alfie's rival) walks in and pastes the new one. Heat and Wanted arrive exactly as the City Watch
// feed's do: a same-origin b68:crew message from the display, or ?heat=&wanted= on the address.
"use strict";
const L = require("../lib.js");
const { C, f2, pts, rng, esc } = L;

module.exports = function build() {
  const W = 1600, H = 1200, r = rng(1107);
  let defs = "", wall = "", old = "", posters = "", fx = "";
  defs += `<radialGradient id="ww-lamp" cx=".78" cy="0" r=".9"><stop offset="0" stop-color="#ffcf7a" stop-opacity=".55"/><stop offset=".45" stop-color="#e09a3c" stop-opacity=".18"/><stop offset="1" stop-color="#e09a3c" stop-opacity="0"/></radialGradient>
  <linearGradient id="ww-wet" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient>
  <linearGradient id="ww-pave" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b2a2a"/><stop offset="1" stop-color="${C.ink900}"/></linearGradient>
  <linearGradient id="ww-sweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#e8f0ff" stop-opacity="0"/><stop offset=".5" stop-color="#e8f0ff" stop-opacity=".22"/><stop offset="1" stop-color="#e8f0ff" stop-opacity="0"/></linearGradient>`;

  // ---------- brick ----------
  const BW = 92, BH = 34, top = 0, base = 1010;
  wall += `<rect width="${W}" height="${base}" fill="#3a3330"/>`;
  let bricks = "";
  for (let y = top, row = 0; y < base; y += BH, row++) {
    for (let x = (row % 2) * -BW / 2; x < W; x += BW) {
      const v = r(), col = v < .15 ? "#4a3a33" : v < .3 ? "#2e2826" : v < .55 ? "#423833" : "#3d3430";
      bricks += `<rect x="${f2(x + 3)}" y="${f2(y + 3)}" width="${BW - 6}" height="${BH - 6}" fill="${col}"/>`;
      if (r() < .25) bricks += `<rect x="${f2(x + 3)}" y="${f2(y + 3)}" width="${BW - 6}" height="5" fill="#5a4a40" opacity=".5"/>`;
    }
  }
  wall += `<g>${bricks}</g>`;
  // stains and a drainpipe
  wall += `<rect x="1418" y="0" width="34" height="${base}" fill="#262321"/><rect x="1424" y="0" width="6" height="${base}" fill="#4a4440"/>`;
  for (let k = 0; k < 6; k++) wall += `<rect x="1410" y="${120 + k * 160}" width="50" height="12" fill="#1c1a19"/>`;
  wall += `<path d="M1436 ${base} q-6 -30 -40 -40 q-80 -20 -100 -120 L1296 0 L1460 0 L1460 ${base}z" fill="#000" opacity=".12"/>`;
  wall += `<rect width="${W}" height="${base}" fill="url(#ww-wet)"/>`;

  // ---------- old bills under everything: torn, faded ----------
  const bill = (x, y, w, h, rot, ground, ink, lines, font, tear) => {
    let o = `<g transform="translate(${x} ${y}) rotate(${rot})" opacity=".78"><polygon points="${pts(tornRect(w, h, tear))}" fill="${ground}"/>`;
    lines.forEach(([t, sz, dy, wt]) => o += `<text x="${w / 2}" y="${dy}" text-anchor="middle" font-family="${font}" font-size="${sz}" font-weight="${wt || 400}" fill="${ink}">${esc(t)}</text>`);
    return o + `<rect width="${w}" height="${h}" fill="url(#ww-wet)" opacity=".6"/></g>`;
  };
  function tornRect(w, h, tear) {
    const p = [[0, 0], [w, 0], [w, h], [0, h]];
    if (!tear) return p;
    const q = [];
    for (let i = 0; i < 4; i++) {
      const a = p[i], b = p[(i + 1) % 4];
      q.push(a);
      if (i === tear - 1) for (let k = 1; k < 9; k++) q.push([a[0] + (b[0] - a[0]) * k / 9 + (r() - .5) * 18, a[1] + (b[1] - a[1]) * k / 9 + (r() - .5) * 18 + (k % 2 ? 26 : 0)]);
    }
    return q;
  }
  old += bill(70, 90, 300, 420, -2, "#c9b58a", C.alarm700, [["FLUFF", 96, 140, 900], ["INSTANT MASH", 30, 182], ["JUST ADD WATER", 22, 380]], "Archivo Compressed", 3);
  old += bill(1040, 60, 280, 380, 3, "#b8c4bf", C.ink900, [["APPLE LANE", 44, 90, 900], ["SATURDAY", 30, 140], ["THE TELSTARS", 40, 300, 900]], "Archivo Compressed", 4);
  old += bill(560, 640, 330, 250, -4, "#d8cfb8", C.ink700, [["BILL STICKERS", 34, 70, 900], ["WILL BE", 26, 110], ["PROSECUTED", 34, 150, 900], ["CITY WATCH OF DUSKWALL", 14, 220]], "Jost", 2);
  // stencilled slogan
  old += `<text x="1170" y="900" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="64" fill="${C.paper200}" opacity=".22" transform="rotate(-3 1170 900)" letter-spacing="3">END BLUETIME CONTROL</text>`;

  // ---------- curfew bills (Heat 4+) ----------
  const curfew = (id, x, y, rot) => `<g id="${id}" transform="translate(${x} ${y}) rotate(${rot})" style="display:none"><rect width="220" height="150" fill="${C.caution500}"/>
    <rect x="8" y="8" width="204" height="134" fill="none" stroke="${C.ink900}" stroke-width="3"/>
    <text x="110" y="62" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="50" fill="${C.ink900}">CURFEW</text>
    <text x="110" y="92" text-anchor="middle" font-family="Jost" font-weight="600" font-size="16" fill="${C.ink900}" letter-spacing="2">IN FORCE · 22:00</text>
    <text x="110" y="124" text-anchor="middle" font-family="Space Mono" font-size="11" fill="${C.ink900}">BY ORDER · CWD-968-0047</text>
    <rect width="220" height="150" fill="url(#ww-wet)" opacity=".5"/></g>`;
  posters += curfew("cf1", 40, 620, -3) + curfew("cf2", 1210, 760, 4);

  // ---------- the four wanted posters ----------
  const crew = [
    { id: "booker", name: "BOOKER RASHAN", aka: "“BABEL”", code: "PAL-968-1107" },
    { id: "alfie", name: "ALFIE LANGSTROM", aka: "“ASHTRAY” · WITH DOG", code: "HND-968-0312" },
    { id: "stacey", name: "STACEY JATHAM", aka: "EX-MILITARY · ARMED", code: "SO-968-0419" },
    { id: "loader", name: "GARBAGE LOADER 99.47", aka: "HULL · DEFECTIVE", code: "AST-968-0314" },
  ];
  const slots = [[250, 150, -3], [560, 120, 2], [870, 160, -1.5], [1170, 300, 3]];
  const PW = 270, PH = 410;
  crew.forEach((c, i) => {
    const pr = L.K.portrait(L.pc(c.id), { lod: "lo" });
    if (pr.warnings.length) throw new Error(c.id + pr.warnings);
    const m = pr.svg.match(/^<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>$/);
    const vb = m[1].split(/\s+/).map(Number);
    const ph = PW - 70, phh = ph * vb[3] / vb[2];
    const [x, y, rot] = slots[i];
    posters += `<g class="wp" id="wp${i}" data-x="${x}" data-y="${y}" data-r="${rot}" transform="translate(${x} ${y}) rotate(${rot})" style="display:none">
      <rect x="6" y="9" width="${PW}" height="${PH}" fill="#000" opacity=".35"/>
      <rect width="${PW}" height="${PH}" fill="${C.paper100}"/>
      <rect x="0" y="0" width="${PW}" height="58" fill="${C.ink900}"/>
      <text x="${PW / 2}" y="48" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="52" fill="${C.paper100}" letter-spacing="4">WANTED</text>
      <svg x="35" y="68" width="${ph}" height="${f2(phh)}" viewBox="${vb.join(" ")}">${m[2]}</svg>
      <text x="${PW / 2}" y="${f2(70 + phh + 30)}" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="27" fill="${C.ink900}">${esc(c.name)}</text>
      <text x="${PW / 2}" y="${f2(70 + phh + 50)}" text-anchor="middle" font-family="Jost" font-weight="600" font-size="13" fill="${C.ink700}" letter-spacing="1.5">${esc(c.aka)}</text>
      <line x1="20" x2="${PW - 20}" y1="${f2(70 + phh + 62)}" y2="${f2(70 + phh + 62)}" stroke="${C.ink900}" stroke-width="2"/>
      <text class="reward" x="${PW / 2}" y="${f2(70 + phh + 86)}" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="22" fill="${C.alarm700}">REWARD · 2 STACKS</text>
      <text x="${PW / 2}" y="${PH - 12}" text-anchor="middle" font-family="Space Mono" font-size="9" fill="${C.ink500}">CITY WATCH OF DUSKWALL · ${esc(c.code)}</text>
      <path d="M0 ${PH * .3} q${PW * .5} 12 ${PW} -4 M0 ${PH * .7} q${PW * .4} -10 ${PW} 6" stroke="${C.ink300}" stroke-width="1" fill="none" opacity=".35"/>
      <rect width="${PW}" height="${PH}" fill="url(#ww-wet)" opacity=".5"/></g>`;
  });

  // ---------- pavement, lamp, rain ----------
  fx += `<rect x="0" y="${base}" width="${W}" height="${H - base}" fill="url(#ww-pave)"/><rect x="0" y="${base}" width="${W}" height="10" fill="#4a4440"/>`;
  fx += `<ellipse cx="1180" cy="${base + 90}" rx="380" ry="40" fill="#ffcf7a" opacity=".1"/><ellipse cx="520" cy="${base + 130}" rx="260" ry="20" fill="#ffcf7a" opacity=".06"/>`;
  fx += `<rect id="lamplight" width="${W}" height="${H}" fill="url(#ww-lamp)"/>`;
  fx += `<g transform="translate(1250 0)"><rect x="-6" y="0" width="12" height="70" fill="${C.ink900}"/><path d="M-70 70 L70 70 L44 104 L-44 104z" fill="${C.ink900}"/><ellipse id="bulb" cx="0" cy="104" rx="40" ry="8" fill="#ffd98a"/></g>`;
  let rain = `<g id="rain" stroke="#c9d3dc" stroke-width="1.6" opacity=".38">`;
  for (let k = 0; k < 90; k++) rain += `<line x1="0" y1="0" x2="-7" y2="${f2(26 + r() * 20)}" data-x="${f2(r() * 1700)}" data-y="${f2(r() * 1200)}" data-v="${f2(900 + r() * 500)}"/>`;
  rain += `</g>`;
  let ripples = `<g id="ripples" fill="none" stroke="#c9d3dc" stroke-width="1.2">`;
  for (let k = 0; k < 10; k++) ripples += `<ellipse rx="1" ry=".3" cx="${f2(r() * W)}" cy="${f2(base + 30 + r() * 160)}" opacity="0"/>`;
  ripples += `</g>`;
  fx += `<polygon id="sweep" points="${pts([[0, 0], [260, 0], [520, H], [160, H]])}" fill="url(#ww-sweep)" style="display:none"/>`;

  // ---------- Vanden, with a poster under his arm ----------
  const van = L.fig(L.npc("vanden"), { id: "vanden", lod: "mid", frames: [{}, { pose: { arms: { R: { a: "pocket", b: "raise", t: .55 } } } }, { pose: { arms: { R: { a: "pocket", b: "raise", t: 1 } } } }] });
  const vanden = `<g id="vgrp" style="display:none" transform="translate(-300 ${base + 150})">${L.at(van, 0, 0, 0.26)}</g>`;

  const body = `<svg class="layer" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>${defs}</defs>
  ${wall}${old}${posters}${fx}${ripples}${vanden}${rain}</svg>
  <div id="line" style="position:absolute;left:3%;bottom:3%;font:400 clamp(9px,1.1cqw,15px) 'Space Mono';color:#c9d3dc;opacity:.55;letter-spacing:.15em">LINE · —</div>`;

  const script = `
const Q=new URLSearchParams(location.search);
let heat=0,wanted=0,shown=-1;
const posters=[0,1,2,3].map(i=>$('wp'+i));const lineEl=$('line');
const rewardFor=(w,h)=>'REWARD · '+(w*2+Math.floor(h/3))+' STACKS';
function draw(animate){
 const prev=shown;
 posters.forEach((p,i)=>{p.querySelector('.reward').textContent=rewardFor(wanted,heat);if(i<wanted&&!(animate&&i===wanted-1&&wanted>prev))p.style.display='';else if(i>=wanted)p.style.display='none';});
 $('cf1').style.display=heat>=4?'':'none';$('cf2').style.display=heat>=6?'':'none';$('sweep').style.display=heat>=7?'':'none';
 if(animate&&wanted>prev&&prev>=0)paste(wanted-1);
 shown=wanted;
}
// the first value a freshly loaded wall hears is the state of play, not news: Vanden only pastes a poster when Wanted goes up
// after that (the display re-sends the crew every time the scene loads)
let heard=false;
function set(h,w,src){h=Math.max(0,Math.min(9,Math.round(+h||0)));w=Math.max(0,Math.min(4,Math.round(+w||0)));const up=w>wanted&&heard;heard=true;heat=h;wanted=w;lineEl.textContent='LINE · '+src;draw(up);}
// Vanden walks in, pastes the poster, walks off
let walking=null;
function paste(i){const p=posters[i];const tx=+p.dataset.x+60;const g=$('vgrp');g.style.display='';let x=-200,phase=0,t=0;
 if(walking&&walking.poster&&walking.poster.style.display==='none')walking.poster.style.display='';
 walking=(dt)=>{t+=dt;if(phase===0){x+=260*dt;if(x>=tx){x=tx;phase=1;t=0;move('vanden',[[1,140],[2,1500],[1,140],[0,0]]);}}
  else if(phase===1){if(t>.45&&p.style.display==='none'){p.style.display='';}if(t>2.2){phase=2;}}
  else{x+=260*dt;if(x>1900){g.style.display='none';walking=null;}}
  const bob=phase===1?0:Math.abs(Math.sin(t*7))*5;g.setAttribute('transform','translate('+x.toFixed(1)+' '+(${base + 150}-bob).toFixed(1)+')');};walking.poster=p;}
addEventListener('message',e=>{if(e.origin!==location.origin)return;const d=e.data;if(d&&d.type==='b68:crew')set(d.heat,d.wanted,'PUSHED');});
if(Q.has('heat')||Q.has('wanted'))set(Q.get('heat'),Q.get('wanted'),'MANUAL');else draw(false);
// rain, ripples, the lamp, the searchlight
const drops=[...document.querySelectorAll('#rain line')].map(l=>({l,x:+l.dataset.x,y:+l.dataset.y,v:+l.dataset.v}));
const rips=[...document.querySelectorAll('#ripples ellipse')].map(e=>({e,t:Math.random()}));
loop((dt,c)=>{
 for(const d of drops){d.y+=d.v*dt;d.x-=d.v*dt*.2;if(d.y>1220){d.y=-40;d.x=Math.random()*1750;}d.l.setAttribute('transform','translate('+d.x.toFixed(1)+' '+d.y.toFixed(1)+')');}
 for(const p of rips){p.t+=dt*1.4;if(p.t>1){p.t=0;p.e.setAttribute('cx',(Math.random()*1600).toFixed(0));p.e.setAttribute('cy',(${base}+30+Math.random()*160).toFixed(0));}p.e.setAttribute('rx',(2+p.t*26).toFixed(1));p.e.setAttribute('ry',(.6+p.t*6).toFixed(1));p.e.setAttribute('opacity',(.6*(1-p.t)).toFixed(2));}
 const fl=Math.random()<.006?.35:1;$('lamplight').setAttribute('opacity',fl);$('bulb').setAttribute('opacity',fl);
 const sw=$('sweep');if(sw.style.display!=='none'){const x=((c*140)%2600)-700;sw.setAttribute('transform','translate('+x.toFixed(0)+' 0)');}
 if(walking)walking(dt);
});
`;
  return L.build({ file: "wanted-wall.html", title: "Wanted wall", fonts: ["Archivo Compressed", "Jost", "Space Mono"], body, script, grain: .14, vignette: .6, bg: "#1c1a19", fps: 30 });
};
if (require.main === module) module.exports();
