// Opening credits: a 90-second title sequence in the design system's Saul Bass language (flat colour fields, block wipes,
// silhouettes, mixed-weight caps), cut to the opening of the theme the display page plays (app/media/theme.mp3, local only).
// The cast is credited player and character (Alex, 16/10/2026). Pin only: it plays once and holds on the title card.
//
// Sound: the scene asks its parent (the display page) to play the theme with a same-origin b68:music message and runs its
// clock from the parent's replies ({ state: 'playing', t }), so the cuts follow the music even when it starts late (the iPad
// needs one tap before it may play sound). With no music, it runs on its own clock.
//
// An episode's own credits (IP5.2): `node tools/ambient/scenes/credits.js --episode <file.json> [--out <path>]` writes
// app/ambient/episode-credits.html (gitignored: an episode is campaign data, and this repository is public; the display plays it in
// place of opening-credits.html whenever it was deployed). The file (see tools/ambient/fixtures/episode-demo.json) may set:
//   episode, subtitle      the title card's lines ("EPISODE FOUR", and a smaller one under it)
//   cast                   four entries, each { id (from app/figures/cast.js) | spec (a full figure-kit spec), player, name, job, code,
//                          field, deep (colour token names, as C below: "file500") }
//   caption                the line under the line-up
//   leaves                 { id, stamp, limp }: that member's card plays to its name card, then they look off-screen, turn up a collar
//                          and walk out of frame; `stamp` lands on the name card. The montage and the line-up keep their place as an
//                          empty gap (a chalk outline)
//   introducing            { ...a cast entry..., line }: after the title, the line-up with the gap, the line slams in, the newcomer
//                          walks into the gap from the other side, stops, and the picture freezes on them: the scene holds that frame
// The new beats land on the theme's beat (BEAT below). With no argument the build is today's opening-credits.html, byte for byte.
"use strict";
const fs = require("fs"), path = require("path");
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
// The theme's beat, measured 13/11/2026 by decoding theme.mp3 in a browser and combing the onsets of its low band over 17.5-90 s:
// 137.9 bpm, a beat every 0.4352 s from 17.573 s (the strongest hits of the ending: 81.95 and 85.45 s, beats 148 and 156).
const BEAT = { at: 17.573, len: 0.4352 };
const beat = (n) => Math.round((BEAT.at + n * BEAT.len) * 1000) / 1000;

module.exports = function build(ep) {
  const E = ep ? episodeOf(ep) : null;
  const EPISODE_ = E ? E.episode : EPISODE, CAST_ = E ? E.cast : CAST;
  const specOf = (c) => (c.spec ? JSON.parse(JSON.stringify(c.spec)) : L.pc(c.id));
  const W = 1600, H = 1200, r = rng(1968);
  let shots = "";
  const shot = (id, inner, bg) => { shots += `<g class="shot" id="${id}" style="display:none">${bg ? `<rect width="${W}" height="${H}" fill="${bg}"/>` : ""}${inner}</g>`; };
  const poster = (txt, x, y, size, fill, extra = "") => `<text x="${x}" y="${y}" font-family="Archivo Compressed" font-weight="900" font-size="${size}" fill="${fill}" ${extra}>${esc(txt)}</text>`;
  const mono = (txt, x, y, size, fill, extra = "") => `<text x="${x}" y="${y}" font-family="Space Mono" font-weight="700" font-size="${size}" fill="${fill}" letter-spacing="${size * .22}" ${extra}>${esc(txt)}</text>`;
  const rings = (cx, cy, n, gap, col, w) => Array.from({ length: n }, (_, k) => `<circle cx="${cx}" cy="${cy}" r="${(k + 1) * gap}" fill="none" stroke="${col}" stroke-width="${w}"/>`).join("");
  const skyline = (y, col, seed) => { const rr = rng(seed); let o = "", x = -20; while (x < W + 20) { const w = 60 + rr() * 140, h = 120 + rr() * 320; o += `<rect x="${f2(x)}" y="${f2(y - h)}" width="${f2(w)}" height="${f2(h + 400)}" fill="${col}"/>`; if (rr() < .3) o += `<rect x="${f2(x + w / 2 - 3)}" y="${f2(y - h - 50)}" width="6" height="50" fill="${col}"/>`; x += w + 4; } return o; };
  const LV = E && E.leaves ? E.leaves : null, NEW = E && E.introducing ? E.introducing : null;
  const lvAt = LV ? CAST_.findIndex((c) => c.id === LV.id) : -1;
  const ex = { layers: "", css: "", script: "" };      // the episode's own parts, outside the shared timeline

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
  for (const c of CAST_) sil[c.id] = L.fig(specOf(c), { id: "sil-" + c.id, silhouette: true, lod: "lo", shadow: false });
  shot("s4", CAST_.map((c, i) => `<rect class="s4bar" x="${i * 400}" y="0" width="400" height="0" fill="${c.field}"/>`).join("") +
    CAST_.map((c, i) => `<g class="s4fig" data-i="${i}">${L.at(sil[c.id], 200 + i * 400, 1180, 0.4)}</g>`).join(""), C.ink900);
  // 5. STARRING
  shot("s5", `${poster("STARRING", 800, 640, 200, C.paper100, 'text-anchor="middle" id="s5t" letter-spacing="8"')}<rect id="s5bar" x="300" y="690" width="0" height="14" fill="${C.signal500}"/>`, C.ink900);

  // ---------- the crew ----------
  const moves = {
    booker: [{}, { pose: { head: { yaw: -12 } } }, { pose: { head: { yaw: -22, tilt: -3 } } }],
    alfie: L.smokeFrames("R", "down"),
    stacey: [{}, { pose: { head: { yaw: 14, tilt: 3 } } }],
    loader: [{}, { pose: { head: { yaw: -14, tilt: -4 } } }],
  };
  CAST_.forEach((c, i) => {
    const spec = specOf(c);
    const leaving = i === lvAt;
    const fig = leaving ? walker(spec, "cr-" + c.id, LEAVE_FRAMES, 0.42) : L.fig(spec, { id: "cr-" + c.id, frames: moves[c.id] || GLANCE, place: 0.42 });
    const big = L.at(fig, 1140, 1190, 0.42);
    // the silhouette again, big: its ids renamed, so no id is defined twice (a reference resolves to the first copy, and that
    // one sits in another shot, display:none, which older WebKit does not resolve into)
    const silBig = L.at(sil[c.id], 1140, 1190, 0.42, `fill="${c.deep}"`).split("sil-" + c.id).join("silb-" + c.id);
    const nameSize = c.name.length > 18 ? 104 : 124;
    // the one who leaves walks in a layer of their own (it moves every frame): their colour figure is there, not in the shot
    if (leaving) ex.layers += walkLayer("wkL", fig, 1140, 1190, 0.42);
    shot("c" + i, `<rect class="wipe" x="0" y="0" width="0" height="${H}" fill="${c.deep}"/>
      <g opacity=".22">${rings(1140, 640, 8, 80, C.paper100, 4)}</g>
      <g class="silf">${silBig}</g><g class="colf" style="display:none">${leaving ? "" : big}</g>
      <g class="card" style="display:none">
        <rect x="0" y="770" width="960" height="300" fill="${c.deep}"/>
        <text x="70" y="850" font-family="Archivo Condensed" font-size="54" fill="${C.paper100}"><tspan font-weight="900">${esc(c.player)}</tspan><tspan font-weight="300"> as</tspan></text>
        ${poster(c.name, 70, 965, nameSize, C.paper100, `textLength="${Math.min(840, c.name.length * nameSize * .44)}" lengthAdjust="spacingAndGlyphs"`)}
        ${mono(c.job + " · " + c.code, 72, 1030, 26, c.field)}
        <rect class="cardclip" x="0" y="770" width="960" height="300" fill="${c.deep}"/></g>${leaving ? stamp("lvStamp", LV.stamp, 740, 772, -8, C.caution500, 80) : ""}`, c.field);
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
  CAST_.forEach((c, i) => {
    const x = (i % 2) * 800, y = Math.floor(i / 2) * 600;
    if (i === lvAt) { grid += gapPanel(c, i, x, y, LV.stamp, specOf(c), poster); return; }
    const pr = L.K.portrait(specOf(c), { lod: "lo" });
    const m = pr.svg.match(/^<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>$/);
    grid += `<g class="panel" data-i="${i}"><rect x="${x}" y="${y}" width="800" height="600" fill="${c.field}" class="pbg"/><svg x="${x + 170}" y="${y + 20}" width="460" height="560" viewBox="${m[1]}">${m[2]}</svg>
      <rect x="${x}" y="${y + 500}" width="800" height="100" fill="${c.deep}"/>${poster(c.player, x + 40, y + 575, 80, C.paper100)}</g>`;
  });
  shot("m", grid, C.ink900);
  // ---------- the line-up ----------
  const caption = E && E.caption ? E.caption : "MILITANTS · TIER 0 · THE BONEYARD";
  if (!LV && !NEW) {
    const lu = L.K.lineup(CAST_.map((c) => specOf(c)), { chart: true, height: 820 });
    const lm = lu.svg.match(/^<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>$/);
    shot("lu", `<svg x="100" y="80" width="1400" height="900" viewBox="${lm[1]}">${lm[2]}</svg>${mono(caption, 800, 1120, 34, C.ink900, 'text-anchor="middle"')}`, C.paper100);
  } else {
    // the line-up with a gap: the slot is sized for whoever ends up in it (the newcomer, else the one who left), then emptied
    const slots = CAST_.map((c) => specOf(c)), at = lvAt >= 0 ? lvAt : slots.length;
    slots[at] = NEW ? specOf(NEW) : slots[at];
    const g = gapLineup(slots, at, { chart: true, height: 820 }, lvAt >= 0 ? specOf(CAST_[lvAt]) : null, lvAt >= 0 ? CAST_[lvAt].deep : null);
    // a smaller box than today's line-up (y 80-980): the line above it and the name card under it stay inside what a 16:9 TV shows of
    // the 4:3 stage (y 150-1050)
    const BX = { x: 100, y: 300, w: 1400, h: 580 }, box = (vb) => `x="${BX.x}" y="${BX.y}" width="${BX.w}" height="${BX.h}" viewBox="${vb}"`;
    shot("lu", `<svg ${box(g.vb)}>${g.inner}</svg>${mono(caption, 800, 960, 34, C.ink900, 'text-anchor="middle"')}` +
      (NEW ? `<g id="inLine" style="display:none" transform="translate(800 220)"><g class="slam"><rect x="-800" y="-70" width="${W}" height="140" fill="${C.ink900}"/>${poster(NEW.line, 0, 46, 130, C.paper100, 'text-anchor="middle" letter-spacing="6"')}</g></g>` : ""), C.paper100);
    if (NEW) {
      // the freeze: the same line-up in silhouette on the newcomer's colour, the newcomer (in their own layer) in colour over it
      const z = gapLineup(slots, at, { chart: true, height: 820, silhouette: true, suffix: "-z", ground: NEW.field }, null, null);
      shot("lz", `<svg ${box(z.vb)}>${z.inner}</svg>`, NEW.deep);
      const m = g.vb.split(/\s+/).map(Number), s = Math.min(BX.w / m[2], BX.h / m[3]);
      const ox = BX.x + (BX.w - m[2] * s) / 2 - m[0] * s, oy = BX.y + (BX.h - m[3] * s) / 2 - m[1] * s;
      const gapX = ox + g.cx * s, floor = oy;
      const nf = walker(specOf(NEW), "in-" + NEW.id, newFrames(specOf(NEW)), s);
      ex.layers += walkLayer("wkN", nf, gapX, floor, s);
      ex.layers += layer("fzCard", freezeCard(NEW, floor, poster, mono));
      ex.layers += `<div id="flash"></div>`;
      // in from the side with fewer of the line-up to pass (they walk in front of them), starting just out of frame
      const fromLeft = at <= slots.length - 1 - at, half = nf.vb[2] * s / 2 + 20;
      ex.script += `const NW={id:${JSON.stringify("in-" + NEW.id)},x0:${f2(fromLeft ? -(gapX + half) : W - gapX + half)}};\n`;
    }
  }

  // ---------- the title card ----------
  shot("tt", `<g id="ttrings" opacity=".3">${rings(800, 560, 10, 64, C.signal500, 6)}</g>
    <text x="808" y="668" text-anchor="middle" font-family="Bowlby One" font-size="200" fill="${C.caution500}" textLength="1240" lengthAdjust="spacingAndGlyphs">BLADES '68</text>
    <text id="tttop" x="800" y="660" text-anchor="middle" font-family="Bowlby One" font-size="200" fill="${C.signal500}" textLength="1240" lengthAdjust="spacingAndGlyphs">BLADES '68</text>
    <rect id="ttbar" x="400" y="730" width="0" height="12" fill="${C.paper100}"/>
    ${mono(EPISODE_, 800, 830, 46, C.paper100, 'text-anchor="middle" id="ttep" style="display:none"')}${E && E.subtitle ? mono(E.subtitle, 800, 910, 34, C.caution500, 'text-anchor="middle" id="ttsub" style="display:none"') : ""}`, C.ink900);

  const body = `<svg class="layer" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${shots}</svg>${ex.layers}`;
  // the episode's timing: T plus the new beats (absolute seconds, on BEAT), and the theme's fade moved after the freeze
  const TT = E ? Object.assign({}, T, episodeTimes(lvAt, !!NEW)) : T;

  let script = `
const T=${JSON.stringify(TT)};
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
const CREW=${JSON.stringify(CAST_.map((c) => c.id))};
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
  if (E) {
    // the one who leaves plays no head move of their own: the episode's loop below runs their frames
    if (lvAt >= 0) script = script.replace("if(t>4&&!moved){", "if(t>4&&!moved&&i!==" + lvAt + "){");
    script += ex.script + EPISODE_SCRIPT(lvAt, LV, NEW, CAST_[lvAt]);
  }
  const css = E ? EPISODE_CSS : undefined;
  return L.build({ file: E ? "episode-credits.html" : "opening-credits.html", out: E && E.out, title: "Opening credits", fonts: ["Archivo Compressed", "Archivo Condensed", "Bowlby One", "Space Mono Bold"], body, css, script, grain: .14, vignette: .35, bg: C.ink900, fps: 30 });
};
module.exports.T = T;
module.exports.BEAT = BEAT;

// ======================================================================================================================
// The episode's beats (IP5.2). Nothing below runs for today's opening-credits.html.
// ======================================================================================================================

const W_ = 1600, H_ = 1200;
/* an extra full-stage layer over the shots (the freeze's name card) */
const layer = (id, inner) => `<svg class="ep" id="${id}" viewBox="0 0 ${W_} ${H_}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" style="display:none">${inner}</svg>`;
/* A walker's own layer: no bigger than the figure (every pose cut repaints the layer, so on the iPad a figure-sized layer repaints a
   figure's worth of pixels, not the whole screen), composited (will-change), moved with a CSS transform in % of its own box
   (data-w/h, stage units), pivoting at the feet. Its viewBox is its box in stage units, so the figure keeps its stage coordinates. */
function walkLayer(id, fig, X, floor, s) {
  const [vx, vy, vw, vh] = fig.vb, pad = 8;
  const x = X + vx * s - pad, y = floor + vy * s - pad, w = vw * s + 2 * pad, h = vh * s + 2 * pad;
  const style = `display:none;left:${f2(x / 16)}%;top:${f2(y / 12)}%;width:${f2(w / 16)}%;height:${f2(h / 12)}%;transform-origin:${f2((X - x) / w * 100)}% ${f2((floor - y) / h * 100)}%`;
  return `<svg class="ep mv wk" id="${id}" viewBox="${f2(x)} ${f2(y)} ${f2(w)} ${f2(h)}" preserveAspectRatio="none" aria-hidden="true" data-w="${f2(w)}" data-h="${f2(h)}" style="${style}">${L.at(fig, X, floor, s)}</svg>`;
}
const EPISODE_CSS = `.ep{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
.ep.wk{right:auto;bottom:auto;overflow:visible}
.mv{will-change:transform}
#flash{position:absolute;inset:0;background:#fffaf0;opacity:0;pointer-events:none}`;

/* a rubber stamp: a double-ruled box, the word in condensed caps, tilted; hidden until it lands (its own group, so it can slam) */
function stamp(id, word, cx, cy, rot, col, size = 92) {
  const w = String(word || "").toUpperCase(), bw = Math.max(size * 2.8, w.length * size * 0.5 + 70), bh = Math.round(size * 1.4);
  return `<g id="${id}" style="display:none" transform="translate(${cx} ${cy}) rotate(${rot})" opacity=".94"><g class="slam">` +
    `<rect x="${f2(-bw / 2)}" y="${-bh / 2}" width="${f2(bw)}" height="${bh}" fill="none" stroke="${col}" stroke-width="9"/>` +
    `<rect x="${f2(-bw / 2 + 14)}" y="${-bh / 2 + 14}" width="${f2(bw - 28)}" height="${bh - 28}" fill="none" stroke="${col}" stroke-width="3"/>` +
    `<text x="0" y="${f2(size * 0.34)}" text-anchor="middle" font-family="Archivo Compressed" font-weight="900" font-size="${size}" letter-spacing="4" fill="${col}">${esc(w)}</text></g></g>`;
}

/* a figure's silhouette as a chalk outline: the silhouette drawn fat in `ring`, then again in `fill` over it, so only a rim shows.
   `svg` is a kit silhouette render; its ids are renamed per copy (each id once in the page). */
function outlined(svg, tag, ring, fill, px) {
  const copy = (k, col, w) => svg.replace(/fill="#14110e"/g, `fill="${col}" stroke="${col}" stroke-width="${w}" stroke-linejoin="round" vector-effect="non-scaling-stroke"`)
    .replace(/\sfilter="url\(#[^)]*\)"/g, "").replace(/\bid="([^"]+)"/g, `id="$1-${tag}${k}"`).replace(/url\(#([^)]+)\)/g, `url(#$1-${tag}${k})`);
  return `<g opacity=".9">${copy("a", ring, px)}</g>${copy("b", fill, 1.5)}`;
}

/* the montage's empty panel: the one who left, as a chalk outline on their colour, the stamp's word stamped across it (high enough to be
   inside what the iPad and a TV show of the bottom row) and an empty strip where the player's name was */
function gapPanel(c, i, x, y, word, spec) {
  const one = (k) => {
    const p = L.K.portrait(spec, { lod: "lo", silhouette: true, halo: false, chart: false, plate: false, ground: "none", suffix: "-gp" + k });
    const m = p.svg.match(/^<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>$/);
    return { vb: m[1], inner: m[2] };
  };
  const a = one("a"), b = one("b");
  const fat = (s, col, w) => s.replace(/fill="#14110e"/g, `fill="${col}" stroke="${col}" stroke-width="${w}" stroke-linejoin="round" vector-effect="non-scaling-stroke"`).replace(/\sfilter="url\(#[^)]*\)"/g, "");
  return `<g class="panel" data-i="${i}"><rect x="${x}" y="${y}" width="800" height="600" fill="${c.deep}" class="pbg"/>` +
    `<ellipse cx="${x + 400}" cy="${y + 470}" rx="240" ry="44" fill="${C.paper100}" opacity=".12"/>` +
    `<svg x="${x + 170}" y="${y + 20}" width="460" height="560" viewBox="${a.vb}" opacity=".85">${fat(a.inner, C.paper100, 7)}</svg>` +
    `<svg x="${x + 170}" y="${y + 20}" width="460" height="560" viewBox="${b.vb}">${fat(b.inner, c.deep, 1.5)}</svg>` +
    `<rect x="${x}" y="${y + 500}" width="800" height="100" fill="${C.ink900}"/>` + stamp("gapStamp", word, x + 400, y + 360, -8, C.caution500, 76).replace(' style="display:none"', "") + `</g>`;
}

/* the line-up with slot `at` emptied: the kit's own line-up of `slots` (so every other place is where the kit puts it), the figure in
   that slot cut back out, and, when `who` is given, their chalk outline (in `col`) standing in it.
   -> { vb, inner, cx (the gap's centre, in the line-up's units) } */
function gapLineup(slots, at, opts, who, col) {
  const lu = L.K.lineup(slots, opts);
  const m = lu.svg.match(/^<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>$/);
  const vb = m[1].split(/\s+/).map(Number);
  const one = L.K.render(slots[at], Object.assign({}, opts, { scale: lu.scale, suffix: (opts.suffix || "") + "-l" + at, pad: 0, fitShadow: false }));
  let inner = m[2];
  const k = inner.indexOf(one.inner), g0 = inner.lastIndexOf('<g transform="translate(', k);
  if (k < 0 || g0 < 0 || inner.slice(k + one.inner.length, k + one.inner.length + 4) !== "</g>") throw new Error("credits: could not find slot " + at + " in the line-up");
  const cx = lu.positions[at].x * vb[2];
  inner = inner.slice(0, g0) + inner.slice(k + one.inner.length + 4);
  if (who) {
    const s = L.K.render(who, { silhouette: true, lod: "lo", shadow: false, scale: lu.scale, pad: 0, suffix: "-gap" });
    const um = s.svg.match(/^<svg[^>]*>([\s\S]*)<\/svg>$/);
    inner += `<g transform="translate(${f2(cx)} 0)">${outlined(`<g>${um[1]}</g>`, "o", col, opts.ground || "#e8e2d4", 6)}</g>`;
  }
  return { vb: m[1], inner, cx };
}

/* the newcomer's name card, under the line-up's floor: their colour, the name, the job and code, and the player's name stamped on */
function freezeCard(n, floor, poster, mono) {
  const y = Math.max(885, floor + 6), nameSize = n.name.length > 18 ? 84 : 96;      // 885-1050: inside what a TV shows
  return `<g id="fzName" style="display:none"><rect x="0" y="${f2(y)}" width="1040" height="165" fill="${n.deep}"/>` +
    poster(n.name, 70, f2(y + 98), nameSize, C.paper100, `textLength="${Math.min(900, n.name.length * nameSize * .44)}" lengthAdjust="spacingAndGlyphs"`) +
    mono(n.job + " · " + n.code, 72, f2(y + 143), 24, n.field) + `</g>` + stamp("fzStamp", n.player, 1260, f2(y + 50), -7, C.caution500, 80);      // its foot >= 3% of a TV's height clear of the edge
}

/* The leaver's frames: rest, a look off-screen, the collar, then three walk poses (stride, pass, the other stride). The kit has no walk
   cycle and its figures face us, so a walk is these cut on the beat while the layer moves, with a bob. */
/* an episode's own cast member (not one of the four above): the head glance the page plays at 4 s into the card */
const GLANCE = [{}, { pose: { head: { yaw: -12 } } }, { pose: { head: { yaw: -22, tilt: -3 } } }];
const LEAVE_FRAMES = [
  {},
  { pose: { head: { yaw: 24, tilt: 2 } } },
  { pose: { head: { yaw: 24, tilt: 2 }, arms: { L: "lapel" } } },
  { pose: { stance: "wide", weight: "L", stoop: 0.05, head: { yaw: 20 }, arms: { L: "lapel", R: { a: "down", b: "behind", t: 0.35 } } } },
  { pose: { stance: "square", weight: "L", stoop: 0.12, head: { yaw: 20 }, arms: { L: "lapel", R: "down" } } },
  { pose: { stance: "wide", weight: "R", stoop: 0.05, head: { yaw: 20 }, arms: { L: "lapel", R: { a: "down", b: "carry", t: 0.35 } } } },
];
/* The newcomer's: standing, the two strides and the pass (the right arm down and swinging, the left as the spec has it), the right arm
   coming up into the spec's own pose (a cigarette to the lips, a hand to the lapel...) in three steps, and the freeze: the spec's own
   pose (frame 7 is {}). An arm the spec leaves down, or gives as a blend, just holds. */
function newFrames(spec) {
  const pose = (spec && spec.pose) || {}, R = (pose.arms || {}).R, tilt = Number((pose.head || {}).tilt) || 0;
  const up = (t) => (typeof R === "string" && R !== "down" ? { R: { a: "down", b: R, t } } : {});
  const head = (k) => ({ tilt: Math.round(tilt * k * 10) / 10 });
  return [
    { pose: { arms: { R: "down" }, head: head(0) } },
    { pose: { stance: "wide", weight: "R", arms: { R: { a: "down", b: "behind", t: 0.35 } }, head: head(0) } },
    { pose: { stance: "square", weight: "L", arms: { R: "down" }, head: head(0) } },
    { pose: { stance: "wide", weight: "L", arms: { R: { a: "down", b: "carry", t: 0.35 } }, head: head(0) } },
    { pose: { arms: up(0.4), head: head(0.35) } },
    { pose: { arms: up(0.7), head: head(0.65) } },
    { pose: { arms: up(0.93), head: head(0.85) } },
    {},
  ];
}
/* A walker's motion figure. The arm swung behind the body changes the stacking order of the sleeve, and with a ribbed top (the kit's rib
   textile) the merge cannot keep the pattern's id unique; then the swing goes out to the hip instead (frames 1 and 3 only). The kit's
   low level of detail: at a walker's size it drops only fine crease lines, and it halves the bytes of every pose. */
function walker(spec, id, frames, place) {
  let f;
  try { f = L.fig(spec, { id, frames, place, lod: "lo" }); } catch (e) {
    if (!/defined twice/.test(e.message)) throw e;
    const safe = frames.map((x) => JSON.parse(JSON.stringify(x).replace(/"b":"behind","t":0.35/g, '"b":"hip","t":0.18')));
    f = L.fig(spec, { id, frames: safe, place, lod: "lo" });
  }
  f.svg = still(f.svg, id);
  f.bytes = f.svg.length;
  return f;
}
/* A walker repaints at every pose cut, and an SVG filter re-runs on every repaint (the IP5 review measured 50-150 ms stalls on the
   walk-in): so nothing that moves keeps a live filter. The kit's grain (a filter over the whole figure; the stage's own grain lies
   over everything anyway), the stipple on the shade bands (they paint as plain translucent shade) and the cast shadow (a flood filter
   on a skewed copy of the body; the contact shadow under the feet stays) come out. Then the pose versions that came out identical
   are folded into one (a version listing every frame it shows in), which is most of the merge's repeats. */
function still(svg, id) {
  const P = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const s = svg.replace(new RegExp(`<filter id="${P}-(?:grain|stip|flat)"[\\s\\S]*?</filter>`, "g"), "")
    .replace(new RegExp(`<use [^>]*filter="url\\(#${P}-flat\\)"[^>]*/>`, "g"), "")
    .replace(new RegExp(`\\sfilter="url\\(#${P}-(?:grain|stip)\\)"`, "g"), "");
  if (/filter="url\(/.test(s)) throw new Error(id + ": a filter is left on a walker");
  const tree = L.M.parse(s);
  const ser = (n) => n.text != null ? n.text : n.kids.length ? `<${n.tag}${n.attrs}>${n.kids.map(ser).join("")}</${n.tag}>` : `<${n.tag}${n.attrs}/>`;
  (function fold(n) {
    if (n.text != null) return;
    for (const k of n.kids) fold(k);
    if (!/\sdata-mv=""/.test(n.attrs)) return;
    const byBody = new Map(), out = [];
    for (const v of n.kids) {
      const m = v.text == null && v.attrs.match(/\sdata-f="([^"]*)"/);
      if (!m) { out.push({ v }); continue; }
      const body = v.kids.map(ser).join(""), fr = m[1].trim().split(/\s+/).map(Number), hit = byBody.get(body);
      if (hit) hit.fr.push(...fr); else { const e = { v, fr }; byBody.set(body, e); out.push(e); }
    }
    n.kids = out.map((e) => {
      if (!e.fr) return e.v;
      const fr = e.fr.sort((a, b) => a - b);
      e.v.attrs = e.v.attrs.replace(/\sdata-f="[^"]*"/, ` data-f=" ${fr.join(" ")} "`).replace(/\sstyle="visibility:hidden"/, "") + (fr.includes(0) ? "" : ' style="visibility:hidden"');
      return e.v;
    });
  })(tree);
  return tree.kids.map(ser).join("");
}

/* the new beats, in absolute seconds on the theme's beat. The leaver's card i starts at T.crew0 + i * 11: they look on the first beat
   4.1 s in, turn the collar up two beats later, walk on the next (four beats: off by beat +7), and the stamp lands two beats after.
   The newcomer: the cut to the line-up on beat 148 (81.98 s, a hit), the line on 149, the walk on 150-155, the cigarette, the freeze
   on 156 (85.46 s, the strongest hit of the ending), the player's stamp on 157; the theme's fade moves to 86.5 s. */
function episodeTimes(lvAt, intro) {
  const o = {};
  if (lvAt >= 0) {
    const t0 = T.crew0 + lvAt * (T.crewLen + T.locLen), n = Math.ceil((t0 + 4.1 - BEAT.at) / BEAT.len);
    Object.assign(o, { lvLook: beat(n), lvCollar: beat(n + 2), lvWalk: beat(n + 3), lvGone: beat(n + 7), lvStamp: beat(n + 9), lvEnd: t0 + T.crewLen });
  }
  if (intro) Object.assign(o, { inCut: beat(148), inLine: beat(149), inWalk: beat(150), inStop: beat(155), inFreeze: beat(156), inStamp: beat(157), fade: 86.5 });
  return o;
}

/* the episode's own loop, after the shared one each frame (it reads the same clock): the walk layers, the stamps, the line and the
   freeze. Every frame is drawn from t alone, so a jump of the clock (the display's sync) lands on the right picture. Reduced motion:
   cuts only (the leaver is there, then gone; the newcomer is in place; no flash, no slam). */
function EPISODE_SCRIPT(lvAt, LV, NEW, lvCast) {
  return `
const EP={lv:${lvAt},limp:${!!(LV && LV.limp)},lvId:${JSON.stringify(lvCast ? "cr-" + lvCast.id : "")},intro:${!!NEW}};
const css=(el,s)=>{if(el&&el.__t!==s){el.style.transform=s;el.__t=s;}},vis=(el,on,op)=>{if(!el)return;const d=on?'':'none',o=op||'';if(el.style.display!==d)el.style.display=d;if(el.style.opacity!==o)el.style.opacity=o;};
const slam=(el,k)=>{if(!el)return;const g=el.firstChild,s=reduce||k>=1?'':'scale('+(1+.6*(1-ease(k))).toFixed(3)+')';if(g.__s!==s){g.setAttribute('transform',s);g.__s=s;}};
const wkL=$('wkL'),wkN=$('wkN'),fz=$('fzCard'),fl=$('flash'),inLine=$('inLine'),sub=$('ttsub');
// a walk, one cycle every two beats: [pose (0 one stride, 1 the pass, 2 the other stride), share of the cycle, bob px, sway deg]. The
// kit's figures face us and have no walk, so a step is a stride pose and a pass pose cut on the beat, the body dipping on the stride
// and leaning onto the stepping side. A limp holds the good leg longer and drops hard onto the other.
const WALK=[[0,.28,8,1.2],[1,.22,-8,0],[2,.28,8,-1.2],[1,.22,-8,0]],LIMP=[[0,.34,5,.9],[1,.2,-9,0],[2,.24,20,-2.8],[1,.22,-6,0]];
function step(g,u){const c=u-Math.floor(u);let a=0;for(const s of g){a+=s[1];if(c<a)return s;}return g[g.length-1];}
const prog=p=>p<=0?0:p>=1?1:(p<.1?5*p*p:p-.05)/.95;
// always a rotation, even a hundredth of a degree: a layer that turns from upright to rotated is painted afresh (a 150-180 ms stall
// measured at the first lean of the walk); one that is never upright is painted once
const place=(el,x,y,r)=>css(el,'translate3d('+(x/+el.dataset.w*100).toFixed(3)+'%,'+(y/+el.dataset.h*100).toFixed(3)+'%,0) rotate('+(r||.01).toFixed(2)+'deg)');
loop(()=>{const t=now();
 if(EP.lv>=0){const sh='c'+EP.lv,on=cur===sh;
  const lt=t-(T.crew0+EP.lv*(T.crewLen+T.locLen));
  // the colour figure shows from 2.2 s (as the others do), painted all but invisibly a beat early so the cut does not hitch
  const showL=on&&lt>=1.8&&t<(reduce?T.lvWalk:T.lvGone);vis(wkL,showL,showL&&lt<2.2?'.001':'');
  if(showL){let k=0,x=0,y=0,r=0;
   if(t>=T.lvWalk){const p=(t-T.lvWalk)/(T.lvGone-T.lvWalk),s=step(EP.limp?LIMP:WALK,(t-T.lvWalk)/(2*${BEAT.len}));k=3+s[0];x=760*prog(p);y=s[2];r=s[3];}
   else if(t>=T.lvCollar)k=2;else if(t>=T.lvLook)k=1;
   // while all but invisible (1.8-2.2 s), every pose is shown once, so the walk's first cuts do not wait on a first paint
   else if(lt<2.2&&!reduce)k=Math.max(0,5-Math.floor((lt-1.8)/.06));
   Motion.show(EP.lvId,k);place(wkL,x,y,r);}
  const st=$('lvStamp');if(st){const sOn=on&&t>=T.lvStamp;vis(st,sOn);if(sOn)slam(st,(t-T.lvStamp)/.12);}
 }
 if(sub)vis(sub,cur==='tt'&&t-T.title>1.7);
 if(EP.intro){const inLu=cur==='lu'&&t>=T.inCut,fzOn=t>=T.inFreeze&&cur==='lz';
  if(inLine){vis(inLine,inLu&&t>=T.inLine);if(inLu&&t>=T.inLine)slam(inLine,(t-T.inLine)/.1);}
  // painted all but invisibly from 2 s into the title card (it holds still there), so its first paint is neither in the cut nor the walk
  const showN=((inLu||(cur==='tt'&&t>=T.title+2))&&(!reduce||t>=T.inWalk))||fzOn;vis(wkN,showN,showN&&t<T.inWalk&&!reduce?'.001':'');
  if(showN){let k=7,x=0,y=0,r=0;
   if(t<T.inStop){const p=(t-T.inWalk)/(T.inStop-T.inWalk);
    if(reduce){k=0;}else{const s=step(WALK,Math.max(0,t-T.inWalk)/(2*${BEAT.len}));k=1+s[0];x=NW.x0*(1-prog(p));y=s[2]*.6;r=s[3]*.8;}}
   else if(t<T.inFreeze){const q=(t-T.inStop)/(T.inFreeze-T.inStop);k=reduce?0:q<.25?4:q<.5?5:q<.8?6:7;}
   Motion.show(NW.id,k);place(wkN,x,y,r);}
  vis(fz,fzOn);const nm=$('fzName'),fs=$('fzStamp');
  if(fzOn){vis(nm,true);vis(fs,t>=T.inStamp);if(t>=T.inStamp)slam(fs,(t-T.inStamp)/.12);}
  // the freeze's hard flash: two frames of white, then nothing (none at all with reduced motion)
  const f=!reduce&&t>=T.inFreeze&&t<T.inFreeze+.07?'1':'0';if(fl&&fl.style.opacity!==f)fl.style.opacity=f;
 }
});
${NEW ? "at(T.inCut,'lu');at(T.inFreeze,'lz');TL.sort((a,b)=>a[0]-b[0]);" : ""}
`;
}

/* an episode file -> the build's inputs; colours by token name; a cast entry names a cast.js id or carries a full spec */
function episodeOf(ep) {
  const col = (k, what) => { if (C[k]) return C[k]; throw new Error("credits: " + what + ": no colour token " + JSON.stringify(k) + " (one of " + Object.keys(C).join(", ") + ")"); };
  const entry = (c, what) => {
    if (!c || typeof c !== "object") throw new Error("credits: " + what + " is not an object");
    const id = c.spec ? String(c.spec.id || c.id || "") : String(c.id || "");
    if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error("credits: " + what + " needs an id of lower-case letters (" + JSON.stringify(id) + ")");
    if (!c.spec && !L.cast.byId[id]) throw new Error("credits: " + what + ": " + id + " is not in app/figures/cast.js; give a full spec");
    for (const k of ["player", "name", "job", "code"]) if (typeof c[k] !== "string" || !c[k]) throw new Error("credits: " + what + " needs " + k);
    const o = { id, player: c.player, name: c.name, job: c.job, code: c.code, field: col(c.field, what + ".field"), deep: col(c.deep, what + ".deep") };
    if (c.spec) o.spec = Object.assign({}, c.spec, { id });
    return o;
  };
  if (!Array.isArray(ep.cast) || ep.cast.length !== 4) throw new Error("credits: the cast is four entries (the cards are cut to the music for four)");
  const cast = ep.cast.map((c, i) => entry(c, "cast[" + i + "]"));
  if (new Set(cast.map((c) => c.id)).size !== cast.length) throw new Error("credits: two cast entries share an id");
  const out = { episode: String(ep.episode || EPISODE), subtitle: ep.subtitle ? String(ep.subtitle) : "", cast, caption: ep.caption ? String(ep.caption) : "", out: ep.out || null };
  if (ep.leaves) {
    const lv = typeof ep.leaves === "string" ? { id: ep.leaves } : ep.leaves;
    if (!cast.some((c) => c.id === lv.id)) throw new Error("credits: leaves names " + JSON.stringify(lv.id) + ", who is not in the cast");
    out.leaves = { id: lv.id, stamp: String(lv.stamp || ep.stamp || "GONE"), limp: !!lv.limp };
  }
  if (ep.introducing) {
    const n = entry(ep.introducing, "introducing");
    if (cast.some((c) => c.id === n.id)) throw new Error("credits: the newcomer's id is already in the cast");
    n.line = String(ep.introducing.line || "AND INTRODUCING");
    out.introducing = n;
  }
  return out;
}
module.exports.episodeOf = episodeOf;

if (require.main === module) {
  const a = process.argv.slice(2), at = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : null; };
  const file = at("--episode");
  if (!file) module.exports();
  else {
    const ep = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
    if (at("--out")) ep.out = at("--out");
    module.exports(ep);
  }
}
