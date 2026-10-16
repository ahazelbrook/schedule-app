// Shared page shell for the Blades '68 ambient scenes: a 4:3 stage that always covers its frame,
// the design-system fonts, grain, a vignette, a wake lock and pause-when-hidden.
const fs = require("fs"), path = require("path");
// the design system's fonts: the app's own copies first, then the extra faces kept beside these tools
const FONT_DIRS = [path.join(__dirname, "..", "..", "app", "fonts"), path.join(__dirname, "fonts")];
const fontFile = (f) => { for (const d of FONT_DIRS) { const p = path.join(d, f); if (fs.existsSync(p)) return p; } throw new Error("font " + f + " not found in " + FONT_DIRS.join(", ")); };
const FONTS = {
  "Archivo Compressed": ["ArchivoCompressed-Black.woff2", "900"],
  "Archivo Condensed": ["ArchivoCondensed-Variable.woff2", "100 900"],
  "GT America": ["GTAmericaArabic-Regular.woff2", "400"],
  "GT America Bold": ["GTAmericaArabic-Bold.woff2", "700", "GT America"],
  "Space Mono": ["SpaceMono-Regular.woff2", "400"],
  "Space Mono Bold": ["SpaceMono-Bold.woff2", "700", "Space Mono"],
  "Courier Prime": ["CourierPrime-Regular.woff2", "400"],
  "Courier Prime Bold": ["CourierPrime-Bold.woff2", "700", "Courier Prime"],
  "Yellowtail": ["Yellowtail-Regular.woff2", "400"],
  "GT America Black": ["GTAmericaArabic-Black.woff2", "900", "GT America"],
  "Pirata One": ["PirataOne-Regular.woff2", "400"],
  "Jost": ["Jost-Variable.woff2", "100 900"],
  "Michroma": ["Michroma-Regular.woff2", "400"],
  "Bowlby One": ["BowlbyOne-Regular.woff2", "400"],
  "Archivo Expanded": ["ArchivoExpanded-Variable.woff2", "100 900"],
  "Libre Caslon Text": ["LibreCaslonText-Regular.woff2", "400"],
  "Libre Caslon Text Bold": ["LibreCaslonText-Bold.woff2", "700", "Libre Caslon Text"],
};
function fontFace(names) {
  return names.map(n => {
    const [file, weight, family] = FONTS[n];
    const b64 = fs.readFileSync(fontFile(file)).toString("base64");
    return `@font-face{font-family:"${family || n}";src:url(data:font/woff2;base64,${b64}) format("woff2");font-weight:${weight};font-display:block}`;
  }).join("\n");
}
const grain = require("./grain.js")(224, 7);

/** page({ title, fonts:[...], css, body, script, grain: 0..1, vignette: 0..1, bg, fps }) -> html */
function page(o) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${o.title}</title>
<style>
${fontFace(o.fonts || [])}
html,body{margin:0;height:100%;background:${o.bg || "#141310"};overflow:hidden}
body{container-type:size}
/* the scene is 4:3 and always covers its frame */
.stage{position:absolute;left:50%;top:50%;width:max(100%,133.334vh);aspect-ratio:4/3;transform:translate(-50%,-50%);min-height:100%;overflow:hidden}
@supports (width:1cqw){.stage{width:max(100cqw,133.334cqh)}}
.layer{position:absolute;inset:0;width:100%;height:100%;display:block}
#grain{position:absolute;inset:0;background:url(${grain});background-size:224px;opacity:${o.grain ?? .14};mix-blend-mode:overlay;pointer-events:none}
#vig{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 46%,transparent 55%,rgba(8,7,10,${o.vignette ?? .5}) 100%);pointer-events:none}
${o.css || ""}
</style></head>
<body>
<div class="stage" id="stage">
${o.body}
<div id="vig"></div>
<div id="grain"></div>
</div>
<script>
(()=>{"use strict";
const $=id=>document.getElementById(id), NS="http://www.w3.org/2000/svg";
const R=(a,b)=>a+(b-a)*Math.random();
const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
const el=(tag,attrs,parent)=>{const e=document.createElementNS(NS,tag);for(const k in attrs)e.setAttribute(k,attrs[k]);parent&&parent.appendChild(e);return e;};
// one loop (default ~30fps, the fps option lowers it), paused while hidden; step(dt, clock)
let last=performance.now(),acc=0,clock=0,run=!document.hidden;const steps=[];
const loop=fn=>steps.push(fn);
function frame(now){if(!run)return;const dt=Math.min(.1,(now-last)/1000);last=now;acc+=dt;
 if(acc>=1/${o.fps || 30}){const d=reduce?acc*.5:acc;clock+=d;for(const f of steps)f(d,clock);acc=0;}requestAnimationFrame(frame);}
document.addEventListener("visibilitychange",()=>{run=!document.hidden;if(run){last=performance.now();requestAnimationFrame(frame);}});
if(navigator.wakeLock){const lock=()=>navigator.wakeLock.request("screen").catch(()=>{});lock();document.addEventListener("visibilitychange",()=>{if(!document.hidden)lock();});}
${o.script || ""}
requestAnimationFrame(frame);
})();
</script>
</body></html>`;
}
module.exports = { page, fontFace };
