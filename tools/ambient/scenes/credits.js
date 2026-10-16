// Opening credits: a 90-second title sequence in the design system's Saul Bass language (flat colour fields, block wipes,
// silhouettes, mixed-weight caps), cut to the opening of the theme the display page plays (app/media/theme.mp3, local only).
// The cast is credited player and character (Alex, 16/10/2026). Pin only: it plays once and holds on the title card.
//
// Sound: the scene asks its parent (the display page) to play the theme with a same-origin b68:music message and runs its
// clock from the parent's replies ({ state: 'playing', t }), so the cuts follow the music even when it starts late (the iPad
// needs one tap before it may play sound). With no music, it runs on its own clock.
"use strict";
const L = require("../lib.js");
const { C, f2, pts, rng, esc } = L;

// edit these two: the title card's episode line, and the cast
const EPISODE = "EPISODE TWO";
const CAST = [
  { id: "booker", player: "MELUSI", name: "BOOKER “BABEL” RASHAN", job: "OPERATIVE", code: "PAL-968-1107", field: C.file500, deep: C.file900 },
  { id: "alfie", player: "JACK", name: "ALFIE “ASHTRAY” LANGSTROM", job: "HOUND", code: "HND-968-0312", field: C.caution500, deep: C.caution900 },
  { id: "stacey", player: "PAT", name: "STACEY JATHAM", job: "VETERAN", code: "SO-968-0419", field: C.alarm500, deep: C.alarm900 },
  { id: "loader", player: "ISAAC", name: "GARBAGE LOADER 99.47", job: "HULL", code: "AST-968-0314", field: C.covert500, deep: C.covert900 },
];
// seconds: the quiet intro (bass and bongos) carries the cards; the horns (from ~17.5 s) bring the crew
const T = { crew0: 17.5, crewLen: 9.5, locLen: 1.5, montage: 63.5, lineup: 71, title: 77, fade: 84, end: 90 };

module.exports = function build() {
  const W = 1600, H = 1200, r = rng(1968);
  let shots = "";
  const shot = (id, inner, bg) => { shots += `<g class="shot" id="${id}" style="display:none">${bg ? `<rect width="${W}" height="${H}" fill="${bg}"/>` : ""}${inner}</g>`; };
  const poster = (txt, x, y, size, fill, extra = "") => `<text x="${x}" y="${y}" font-family="Archivo Compressed" font-weight="900" font-size="${size}" fill="${fill}" ${extra}>${esc(txt)}</text>`;
  const mono = (txt, x, y, size, fill, extra = "") => `<text x="${x}" y="${y}" font-family="Space Mono" font-weight="700" font-size="${size}" fill="${fill}" letter-spacing="${size * .22}" ${extra}>${esc(txt)}</text>`;
  const rings = (cx, cy, n, gap, col, w) => Array.from({ length: n }, (_, k) => `<circle cx="${cx}" cy="${cy}" r="${(k + 1) * gap}" fill="none" stroke="${col}" stroke-width="${w}"/>`).join("");
  const skyline = (y, col, seed) => { const rr = rng(seed); let o = "", x = -20; while (x < W + 20) { const w = 60 + rr() * 140, h = 120 + rr() * 320; o += `<rect x="${f2(x)}" y="${f2(y - h)}" width="${f2(w)}" height="${f2(h + 400)}" fill="${col}"/>`; if (rr() < .3) o += `<rect x="${f2(x + w / 2 - 3)}" y="${f2(y - h - 50)}" width="6" height="50" fill="${col}"/>`; x += w + 4; } return o; };

  // ---------- the cards over the intro ----------
  // 1. black; an orange bar wipes; the place types on
  shot("s1", `<rect id="s1bar" x="0" y="560" width="0" height="80" fill="${C.signal500}"/>${mono("DOSKVOL · 968 AC", 800, 720, 40, C.paper100, 'text-anchor="middle" id="s1txt"')}`, C.ink900);
  // 2. mustard; THE SUN as a word stack, the recessive copies colour-shifted
  shot("s2", `${[0, 1, 2, 3, 4].map((k) => poster("THE SUN", 120, 260 + k * 190, 230, k === 2 ? C.ink900 : C.caution700, `class="s2w" data-k="${k}"`)).join("")}${poster("IS RATIONED", 120, 1130, 120, C.alarm700, 'id="s2b"')}`, C.caution500);
  // 3. cobalt; target rings over the skyline; the kicker in mixed weights
  shot("s3", `<g opacity=".35">${rings(800, 560, 9, 70, C.paper100, 3)}</g>${skyline(900, C.file900, 3)}
    <text x="800" y="1060" text-anchor="middle" font-family="Archivo Condensed" font-size="64" fill="${C.paper100}"><tspan font-weight="300">SOMEBODY </tspan><tspan font-weight="900">HAS TO DO </tspan><tspan font-weight="300">SOMETHING </tspan><tspan font-weight="900">ABOUT IT</tspan></text>`, C.file500);
  // 4. four colour bars wipe down, the crew in silhouette walk into them
  const sil = {};
  for (const c of CAST) sil[c.id] = L.fig(L.pc(c.id), { id: "sil-" + c.id, silhouette: true, lod: "lo", shadow: false });
  shot("s4", CAST.map((c, i) => `<rect class="s4bar" x="${i * 400}" y="0" width="400" height="0" fill="${c.field}"/>`).join("") +
    CAST.map((c, i) => `<g class="s4fig" data-i="${i}">${L.at(sil[c.id], 200 + i * 400, 1180, 0.4)}</g>`).join(""), C.ink900);
  // 5. STARRING
  shot("s5", `${poster("STARRING", 800, 640, 200, C.paper100, 'text-anchor="middle" id="s5t" letter-spacing="8"')}<rect id="s5bar" x="300" y="690" width="0" height="14" fill="${C.signal500}"/>`, C.ink900);

  // ---------- the crew ----------
  const moves = {
    booker: [{}, { pose: { head: { yaw: -12 } } }, { pose: { head: { yaw: -22, tilt: -3 } } }],
    alfie: L.smokeFrames("R", "down"),
    stacey: [{}, { pose: { head: { yaw: 14, tilt: 3 } } }],
    loader: [{}, { pose: { head: { yaw: -14, tilt: -4 } } }],
  };
  CAST.forEach((c, i) => {
    const spec = L.pc(c.id);
    const fig = L.fig(spec, { id: "cr-" + c.id, frames: moves[c.id], place: 0.42 });
    const big = L.at(fig, 1140, 1190, 0.42);
    // the silhouette again, big: its ids renamed, so no id is defined twice (a reference resolves to the first copy, and that
    // one sits in another shot, display:none, which older WebKit does not resolve into)
    const silBig = L.at(sil[c.id], 1140, 1190, 0.42, `fill="${c.deep}"`).split("sil-" + c.id).join("silb-" + c.id);
    const nameSize = c.name.length > 18 ? 104 : 124;
    shot("c" + i, `<rect class="wipe" x="0" y="0" width="0" height="${H}" fill="${c.deep}"/>
      <g opacity=".22">${rings(1140, 640, 8, 80, C.paper100, 4)}</g>
      <g class="silf">${silBig}</g><g class="colf" style="display:none">${big}</g>
      <g class="card" style="display:none">
        <rect x="0" y="770" width="960" height="300" fill="${c.deep}"/>
        <text x="70" y="850" font-family="Archivo Condensed" font-size="54" fill="${C.paper100}"><tspan font-weight="900">${esc(c.player)}</tspan><tspan font-weight="300"> as</tspan></text>
        ${poster(c.name, 70, 965, nameSize, C.paper100, `textLength="${Math.min(840, c.name.length * nameSize * .44)}" lengthAdjust="spacingAndGlyphs"`)}
        ${mono(c.job + " · " + c.code, 72, 1030, 26, c.field)}
        <rect class="cardclip" x="0" y="770" width="960" height="300" fill="${c.deep}"/></g>`, c.field);
  });

  // ---------- the locations between the crew ----------
  // Candle Bridge, the Boneyard, the rooftops, the City Watch star
  shot("l0", `${skyline(760, C.signal700, 7)}<rect y="760" width="${W}" height="440" fill="${C.signal900}"/><rect x="0" y="700" width="${W}" height="40" fill="${C.ink900}"/>${Array.from({ length: 9 }, (_, k) => `<rect x="${60 + k * 190}" y="560" width="10" height="140" fill="${C.ink900}"/><circle cx="${65 + k * 190}" cy="552" r="16" fill="${C.caution500}"/><rect x="${55 + k * 190}" y="780" width="20" height="${120 + (k % 3) * 40}" fill="${C.caution500}" opacity=".35"/>`).join("")}${mono("CANDLE BRIDGE", 80, 1120, 34, C.paper100)}`, C.signal500);
  let ribs = "";
  for (let k = 6; k >= 0; k--) { const p = 1 / (1 + k * .45); ribs += `<path d="M${f2(800 - 1000 * p)} 1300 Q800 ${f2(1300 - 2200 * p)} ${f2(800 + 1000 * p)} 1300" fill="none" stroke="${k > 3 ? C.rust700 : C.ink900}" stroke-width="${f2(130 * p)}"/>`; }
  shot("l1", `<circle cx="800" cy="760" r="160" fill="${C.caution500}"/>${ribs}${mono("THE BONEYARD", 80, 1120, 34, C.paper100)}`, C.rust500);
  shot("l2", `<polygon points="${pts([[1100, 0], [1250, 0], [700, 1200], [420, 1200]])}" fill="${C.paper100}" opacity=".18"/>${skyline(1000, C.ink900, 11)}<circle cx="300" cy="230" r="70" fill="${C.paper200}"/>${mono("DUSKWALL", 80, 1120, 34, C.paper100)}`, C.slate700);
  const star = Array.from({ length: 10 }, (_, k) => { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? 150 : 360; return [800 + Math.cos(a) * rr, 600 + Math.sin(a) * rr]; });
  shot("l3", `<polygon points="${pts(star)}" fill="${C.file500}"/><circle cx="800" cy="600" r="130" fill="${C.paper100}"/>${poster("11", 800, 670, 180, C.file900, 'text-anchor="middle"')}${mono("CITY WATCH OF DUSKWALL", 800, 1080, 30, C.paper100, 'text-anchor="middle"')}`, C.file900);

  // ---------- the montage: four panels flashing on the beat ----------
  let grid = "";
  CAST.forEach((c, i) => {
    const pr = L.K.portrait(L.pc(c.id), { lod: "lo" });
    const m = pr.svg.match(/^<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>$/);
    const x = (i % 2) * 800, y = Math.floor(i / 2) * 600;
    grid += `<g class="panel" data-i="${i}"><rect x="${x}" y="${y}" width="800" height="600" fill="${c.field}" class="pbg"/><svg x="${x + 170}" y="${y + 20}" width="460" height="560" viewBox="${m[1]}">${m[2]}</svg>
      <rect x="${x}" y="${y + 500}" width="800" height="100" fill="${c.deep}"/>${poster(c.player, x + 40, y + 575, 80, C.paper100)}</g>`;
  });
  shot("m", grid, C.ink900);
  // ---------- the line-up ----------
  const lu = L.K.lineup(CAST.map((c) => L.pc(c.id)), { chart: true, height: 820 });
  const lm = lu.svg.match(/^<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>$/);
  shot("lu", `<svg x="100" y="80" width="1400" height="900" viewBox="${lm[1]}">${lm[2]}</svg>${mono("MILITANTS · TIER 0 · THE BONEYARD", 800, 1120, 34, C.ink900, 'text-anchor="middle"')}`, C.paper100);

  // ---------- the title card ----------
  shot("tt", `<g id="ttrings" opacity=".3">${rings(800, 560, 10, 64, C.signal500, 6)}</g>
    <text x="808" y="668" text-anchor="middle" font-family="Bowlby One" font-size="200" fill="${C.caution500}" textLength="1240" lengthAdjust="spacingAndGlyphs">BLADES '68</text>
    <text id="tttop" x="800" y="660" text-anchor="middle" font-family="Bowlby One" font-size="200" fill="${C.signal500}" textLength="1240" lengthAdjust="spacingAndGlyphs">BLADES '68</text>
    <rect id="ttbar" x="400" y="730" width="0" height="12" fill="${C.paper100}"/>
    ${mono(EPISODE, 800, 830, 46, C.paper100, 'text-anchor="middle" id="ttep" style="display:none"')}`, C.ink900);

  const body = `<svg class="layer" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${shots}</svg>`;

  const script = `
const T=${JSON.stringify(T)};
const Q=new URLSearchParams(location.search);
const shots={};document.querySelectorAll('.shot').forEach(g=>shots[g.id]=g);
let cur=null;const show=id=>{if(cur===id)return;if(cur)shots[cur].style.display='none';shots[id].style.display='';cur=id;};
const ease=t=>t<0?0:t>1?1:1-Math.pow(1-t,3);
// the timeline: [start, shot, animate(local seconds)]
const TL=[];
const at=(t0,id,fn)=>TL.push([t0,id,fn||(()=>{})]);
at(0,'s1',t=>{$('s1bar').setAttribute('width',(1600*ease(t/0.6)).toFixed(0));const s='DOSKVOL · 968 AC';$('s1txt').textContent=s.slice(0,Math.max(0,Math.floor((t-0.8)*9)));});
at(3,'s2',t=>{document.querySelectorAll('.s2w').forEach(e=>{const k=+e.dataset.k;e.style.display=t>k*0.25?'':'none';});$('s2b').style.display=t>1.8?'':'none';});
at(6.5,'s3');
at(10,'s4',t=>{document.querySelectorAll('.s4bar').forEach((e,i)=>e.setAttribute('height',(1200*ease((t-i*.18)/.42)).toFixed(0)));document.querySelectorAll('.s4fig').forEach((g,i)=>{g.style.display=t>0.9+i*.35?'':'none';});});
at(13.5,'s5',t=>{$('s5bar').setAttribute('width',(1000*ease((t-.4)/.42)).toFixed(0));});
const CREW=${JSON.stringify(CAST.map((c) => c.id))};
CREW.forEach((id,i)=>{
 const t0=T.crew0+i*(T.crewLen+T.locLen);const g=shots['c'+i];const wipe=g.querySelector('.wipe'),silf=g.querySelector('.silf'),colf=g.querySelector('.colf'),card=g.querySelector('.card'),clip=g.querySelector('.cardclip');
 let moved=false;
 at(t0,'c'+i,t=>{
  wipe.setAttribute('width',(1600*ease(t/.42)).toFixed(0));wipe.setAttribute('x','0');
  if(t>.42)wipe.setAttribute('width',(Math.max(0,1600*(1-ease((t-.42)/.42)))).toFixed(0)),wipe.setAttribute('x',(1600*ease((t-.42)/.42)).toFixed(0));
  silf.style.display=t<2.2?'':'none';colf.style.display=t>=2.2?'':'none';
  card.style.display=t>2.6?'':'none';{const e=ease((t-2.6)/.42);clip.setAttribute('x',(960*e).toFixed(0));clip.setAttribute('width',(960*(1-e)).toFixed(0));}
  if(t>4&&!moved){moved=true;const seq=id==='alfie'?${JSON.stringify(L.DRAG)}:[[1,200],[2,2200],[1,200],[0,0]];Motion.play('cr-'+id,seq.slice(0,id==='stacey'||id==='loader'?2:seq.length).concat([[0,0]]));}
  if(t<1)moved=false;
 });
 at(t0+T.crewLen,'l'+i);
});
at(T.montage,'m',t=>{const k=Math.floor(t/0.66);document.querySelectorAll('.panel').forEach((p,i)=>{p.style.display=(k%5===4)||((k+i)%4!==0)?'':'none';});});
at(T.lineup,'lu');
at(T.title,'tt',t=>{$('ttbar').setAttribute('width',(800*ease((t-.6)/.42)).toFixed(0));$('ttep').style.display=t>1.2?'':'none';$('ttrings').setAttribute('transform','rotate('+(t*2).toFixed(2)+' 800 560)');});
TL.sort((a,b)=>a[0]-b[0]);
// the clock: its own, until the display says where the music is
let T0=performance.now()-(+(Q.get('t')||0))*1000,faded=false;
const now=()=>(performance.now()-T0)/1000;
addEventListener('message',e=>{if(e.origin!==location.origin)return;const d=e.data;if(!d||d.type!=='b68:music')return;
 if(d.state==='playing'&&typeof d.t==='number'){const want=performance.now()-d.t*1000;if(Math.abs(want-T0)>120)T0=want;}});
if(window.parent!==window){try{parent.postMessage({type:'b68:music',cmd:'play'},location.origin);}catch(e){}}
loop(()=>{const t=now();let s=TL[0];for(const x of TL)if(x[0]<=t)s=x;show(s[1]);s[2](t-s[0]);
 if(t>=T.fade&&!faded){faded=true;if(window.parent!==window){try{parent.postMessage({type:'b68:music',cmd:'fade',sec:T.end-T.fade},location.origin);}catch(e){}}}});
`;
  return L.build({ file: "opening-credits.html", title: "Opening credits", fonts: ["Archivo Compressed", "Archivo Condensed", "Bowlby One", "Space Mono Bold"], body, script, grain: .14, vignette: .35, bg: C.ink900, fps: 30 });
};
module.exports.T = T;
if (require.main === module) module.exports();
