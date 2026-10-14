#!/usr/bin/env node
// Blades '68 ambient scenes for a score site: the planning board and the exploded score site.
//
//   node make-score-scenes.js [roll.json] [--reveal public,working] [--seed N] [--out DIR]
//                             [--map-kit PATH] [--figure-kit PATH] [--cast PATH]
//
// roll.json is the location generator's roll (the `current` object / generate()'s return value), exactly as the map kit
// takes it. Without one, the map kit's sample "Convent Road Bank" is used. --reveal lists the bands the crew has surveyed
// (default public); re-run with more bands as the crew gathers information.
//
// Both pages are PLAYER copies. The map kit renders the player layer here, at build time, and only that SVG goes into the
// pages: hidden rooms, threats and the back route never reach the files, so nothing on the iPad can be read for spoilers.
const fs = require("fs"), path = require("path");
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 ? args[i + 1] : d; };
const positional = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const here = __dirname;
const M = require(path.resolve(flag("map-kit", path.join(here, "kits/map-kit.js"))));
const K = require(path.resolve(flag("figure-kit", path.join(here, "kits/figure-kit.js"))));
const castFile = path.resolve(flag("cast", path.join(here, "kits/cast.json")));
const cast = castFile.endsWith(".js") ? require(castFile) : JSON.parse(fs.readFileSync(castFile, "utf8"));
const { page } = require(path.join(here, "shell.js"));

let roll;
if (positional[0]) roll = JSON.parse(fs.readFileSync(positional[0], "utf8"));
else roll = require(path.join(here, "kits/samples.json")).find(r => r.name === "Convent Road Bank");
if (roll && roll.current) roll = roll.current;
const reveal = (flag("reveal", "public")).split(",").map(s => s.trim()).filter(Boolean);
const seed = flag("seed") ? +flag("seed") : undefined;
const outDir = path.resolve(flag("out", "."));

const base = { layer: "player", reveal, width: 1600 };
if (seed !== undefined) base.seed = seed;
const board = M.render(roll, Object.assign({ view: "plan", theme: "board" }, base));
const iso = M.render(roll, Object.assign({ view: "iso", theme: "blueprint", legend: false }, base));
const warn = [...board.warnings, ...iso.warnings];
if (warn.length) { console.error("map kit warnings:\n" + warn.join("\n")); process.exit(1); }

// player-safe words only: the legend of a player render shows these
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const placeName = esc(roll.name || "Score site"), district = esc(roll.district || ""), target = esc(roll.target || "");

// inner content of a root <svg>, keeping its viewBox
function unwrap(svg) {
  const m = svg.match(/^<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>\s*$/);
  return { vb: m[1].split(/\s+/).map(Number), inner: m[2] };
}

// =====================================================================================================================
// The planning board
// =====================================================================================================================
{
  const W = 1600, H = 1200;
  let { vb, inner } = unwrap(board.svg);
  // drop the kit's own cork (the first two full-size rects): the page draws one cork under everything
  inner = inner.replace(/<rect width="100%" height="100%" fill="#[0-9a-f]+"\/><rect width="100%" height="100%" filter="url\(#[^)]+\)" opacity="[\d.]+"\/>/, "");
  // red string: mark it so the page can pin it up
  let n = 0;
  inner = inner.replace(/<path ([^>]*stroke="#a51d16"[^>]*)\/>/g, (m, a) => `<path class="string" data-i="${n++}" pathLength="1" ${a}/>`);
  const bw = 1220, bh = bw * vb[3] / vb[2], bx = (W - bw) / 2 + 20, by = 120;

  // the crew as polaroids along the bottom of the board
  const crew = [
    { id: "booker", cap: "Babel" }, { id: "alfie", cap: "Ashtray & Buck" },
    { id: "stacey", cap: "Stacey" }, { id: "loader", cap: "99.47" },
  ];
  let polaroids = "";
  const pw = 176, ph = 228;
  crew.forEach((c, i) => {
    const spec = cast.pcs.find(p => p.id === c.id);
    const r = K.portrait(spec);
    if (r.warnings.length) { console.error(r.warnings); process.exit(1); }
    const u = unwrap(r.svg);
    const x = 380 + i * 270 + (i % 2 ? 14 : -8), y = by + bh - 70 + (i % 2 ? 16 : 0), rot = [-4, 3, -2, 5][i];
    polaroids += `<g class="pol" data-rot="${rot}" transform="translate(${x} ${y}) rotate(${rot})">
      <rect x="${-pw / 2 + 5}" y="9" width="${pw}" height="${ph}" fill="#000" opacity=".3"/>
      <rect x="${-pw / 2}" y="0" width="${pw}" height="${ph}" fill="#f6f2e8"/>
      <svg x="${-pw / 2 + 14}" y="14" width="${pw - 28}" height="${(pw - 28) * u.vb[3] / u.vb[2]}" viewBox="${u.vb.join(" ")}">${u.inner}</svg>
      <text x="0" y="${ph - 13}" text-anchor="middle" font-family="Yellowtail" font-size="24" fill="#2a2521">${esc(c.cap)}</text>
      <circle cx="0" cy="10" r="8" fill="#a8210f"/><circle cx="-2.5" cy="7.5" r="3" fill="#e03a20"/>
    </g>`;
  });

  const body = `
<svg class="layer" id="world" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <filter id="cork" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.13" numOctaves="3" seed="11"/><feColorMatrix values="0 0 0 0 0.22  0 0 0 0 0.12  0 0 0 0 0.05  0 0 0 -2.2 1.25"/></filter>
    <radialGradient id="lamp" cx="760" cy="460" r="900" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffd27a" stop-opacity=".12"/><stop offset=".55" stop-color="#1a1208" stop-opacity=".25"/><stop offset="1" stop-color="#0d0905" stop-opacity=".72"/></radialGradient>
  </defs>
  <g id="cam">
    <rect x="-200" y="-200" width="${W + 400}" height="${H + 400}" fill="#a27445"/>
    <rect x="-200" y="-200" width="${W + 400}" height="${H + 400}" filter="url(#cork)" opacity=".9"/>
    <svg x="${bx}" y="${by}" width="${bw}" height="${bh}" viewBox="${vb.join(" ")}">${inner}</svg>
    <!-- masking tape and a pushpin on the sheet's corners -->
    <rect x="${bx + 160}" y="${by + 30}" width="120" height="30" fill="#e8dfc4" opacity=".8" transform="rotate(-12 ${bx + 220} ${by + 45})"/>
    <rect x="${bx + bw - 520}" y="${by + 10}" width="110" height="28" fill="#e8dfc4" opacity=".8" transform="rotate(9 ${bx + bw - 465} ${by + 24})"/>
    ${polaroids}
    <rect x="-200" y="-200" width="${W + 400}" height="${H + 400}" fill="url(#lamp)"/>
  </g>
</svg>`;
  const css = `#world{will-change:transform}.string{stroke-dasharray:1 1;stroke-dashoffset:1}`;
  const script = `
const cam=$("cam");
// a slow drift across the board: never still, never fast
loop((dt,t)=>{const x=Math.sin(t*2*Math.PI/97)*70+Math.sin(t*2*Math.PI/41)*18, y=Math.sin(t*2*Math.PI/73+1)*45+Math.cos(t*2*Math.PI/37)*12, s=1.16+Math.sin(t*2*Math.PI/131)*.05;
 cam.setAttribute("transform","translate(800 600) scale("+s.toFixed(4)+") translate("+(-800+x).toFixed(1)+" "+(-600+y).toFixed(1)+")");});
// polaroids lift a little in a draught
const pols=[...document.querySelectorAll(".pol")].map(e=>({e,base:e.getAttribute("transform"),rot:+e.dataset.rot,ph:R(0,6),sp:R(.5,.8)}));
loop((dt,t)=>{for(const p of pols){const a=Math.sin(t*p.sp+p.ph)*.6+Math.sin(t*p.sp*2.3+p.ph)*.25;p.e.setAttribute("transform",p.base.replace(/rotate\\([^)]*\\)/,"rotate("+(p.rot+a).toFixed(2)+")"));}});
// the red string is pinned up one length at a time, then now and then taken down and pinned again
const strings=[...document.querySelectorAll(".string")];
function pin(s,ms){s.style.transition="stroke-dashoffset "+ms+"ms cubic-bezier(.6,.1,.3,1)";s.style.strokeDashoffset="0";}
strings.forEach((s,i)=>setTimeout(()=>pin(s,2600),1500+i*2200));
function repin(){if(!strings.length)return;const s=strings[Math.floor(Math.random()*strings.length)];
 s.style.transition="stroke-dashoffset 1800ms ease-in";s.style.strokeDashoffset="-1";
 setTimeout(()=>{s.style.transition="none";s.style.strokeDashoffset="1";requestAnimationFrame(()=>requestAnimationFrame(()=>pin(s,3200)));},2600);
 setTimeout(repin,R(70,140)*1000);}
setTimeout(repin,R(60,90)*1000);
`;
  fs.writeFileSync(path.join(outDir, "planning-board.html"), page({ title: placeName + " · planning board", fonts: ["Yellowtail", "Courier Prime", "Courier Prime Bold", "Space Mono", "Space Mono Bold", "Archivo Condensed", "GT America", "GT America Bold"], body, css, script, grain: .12, vignette: .55, bg: "#3a2a18" }));
}

// =====================================================================================================================
// The exploded score site
// =====================================================================================================================
{
  const W = 1600, H = 1200;
  const { vb, inner } = unwrap(iso.svg);
  const ww = 1600, wh = ww * vb[3] / vb[2];     // the drawing at full stage width; taller than the stage
  const bg = (inner.match(/<rect[^>]*width="100%"[^>]*fill="(#[0-9a-fA-F]+)"/) || [])[1] || "#1d4f9c";
  const body = `
<svg class="layer" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="scan" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfe3ff" stop-opacity="0"/><stop offset=".5" stop-color="#cfe3ff" stop-opacity=".16"/><stop offset="1" stop-color="#cfe3ff" stop-opacity="0"/></linearGradient>
    <radialGradient id="lampB" cx="800" cy="520" r="900" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".07"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <g id="cam">
    <svg x="0" y="0" width="${ww}" height="${wh}" viewBox="${vb.join(" ")}">${inner}</svg>
    <rect id="scanBar" x="-100" y="-260" width="${ww + 200}" height="260" fill="url(#scan)" opacity="0"/>
  </g>
  <rect width="${W}" height="${H}" fill="url(#lampB)"/>
</svg>
<div class="plate"><span class="k">Score site</span><b>${placeName}</b><span>${[target, district].filter(Boolean).join(" · ")}</span></div>`;
  const css = `.plate{position:absolute;left:3.2%;bottom:4.2%;font:400 clamp(10px,1.25cqw,18px)/1.35 "Space Mono",monospace;color:#f4f6fb;opacity:.78;letter-spacing:.06em;text-transform:uppercase}
.plate b{display:block;font:700 clamp(16px,2.4cqw,34px)/1.1 "Space Mono",monospace;letter-spacing:.02em}
.plate .k{display:block;color:#e8c33c;font-size:.85em}`;
  const script = `
const cam=$("cam"),bar=$("scanBar");const WH=${wh.toFixed(1)},H=${H};const travel=Math.max(0,WH-H*.92);
// the camera eases down the building and back up, floor by floor, with a little sideways drift
loop((dt,t)=>{const p=.5-.5*Math.cos(t*2*Math.PI/150);const y=-p*travel+40, x=Math.sin(t*2*Math.PI/61)*40, s=1.08+Math.sin(t*2*Math.PI/89)*.04;
 cam.setAttribute("transform","translate(800 600) scale("+s.toFixed(4)+") translate("+(-800+x).toFixed(1)+" "+(-600+y).toFixed(1)+")");});
// a copier's light passes over the drawing now and then
let sT=-1,sNext=R(8,16);
loop((dt)=>{if(sT<0){sNext-=dt;if(sNext<=0)sT=0;return;}sT+=dt;const k=sT/9;bar.setAttribute("y",(-260+k*(WH+520)).toFixed(1));
 bar.setAttribute("opacity",Math.sin(Math.min(1,k)*Math.PI).toFixed(3));if(k>=1){sT=-1;sNext=R(40,80);bar.setAttribute("opacity",0);}});
`;
  fs.writeFileSync(path.join(outDir, "score-exploded.html"), page({ title: placeName + " · exploded", fonts: ["Space Mono", "Space Mono Bold", "Archivo Condensed", "GT America"], body, css, script, grain: .1, vignette: .6, bg }));
}

console.log("wrote planning-board.html and score-exploded.html for " + (roll.name || "the roll") + " · surveyed: " + reveal.join(", "));
