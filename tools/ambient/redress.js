#!/usr/bin/env node
// Re-dress a character inside the designer-built ambient scenes, and give a figure motion, without the designer's generator.
//
//   node tools/ambient/redress.js            rewrites second-harvest, duskwall-after-dark and watch-feed in app/ambient
//
// Every figure in those pages is a kit render placed as <g transform="translate(x,floor) scale(s)"><g class="b68-figure"
// data-id="ID">...</g></g>. For each one this finds the render options that reproduce it (scale s, the kit's own lod, plain or
// silhouette), learns the page's colour treatment by pairing the original's colours with a natural render's (the watch feed's
// phosphor green, the wall shadows' ink), renders the new spec (or motion frames) with the same options and the same colour
// treatment, and swaps it in. The old spec comes from git (the cast before the change), so the pairing is exact.
"use strict";
const fs = require("fs"), path = require("path"), cp = require("child_process");
const L = require("./lib.js");
const { K, M } = L;
const ROOT = L.ROOT;

const oldCast = (() => {
  const src = cp.execSync("git show a3d5370:app/figures/cast.js", { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 26 });
  const m = { exports: {} }; new Function("module", "exports", "window", src)(m, m.exports, undefined); return m.exports;
})();

function elementAt(s, i) {
  let d = 0; const re = /<(\/?)g\b[^>]*?(\/?)>/g; re.lastIndex = i; let m;
  while ((m = re.exec(s))) { if (m[1]) d--; else if (!m[2]) d++; if (d === 0) return s.slice(i, re.lastIndex); }
  throw new Error("unbalanced <g> at " + i);
}
// the kit writes most colours as #rrggbb and a few mask colours as #fff / #000
const HEX = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
const full = (h) => (h.length === 4 ? "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3] : h).toLowerCase();
const hexes = (s) => s.match(HEX) || [];
const shape = (s) => s.replace(HEX, "#");
const lum = (h) => { const n = parseInt(full(h).slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255); };

// the colour treatment: natural colour -> page colour, learnt from a pair of renders of the same spec
function learn(natural, page) {
  const a = hexes(natural), b = hexes(page), map = new Map();
  if (a.length !== b.length) throw new Error("colour counts differ: " + a.length + " vs " + b.length);
  a.forEach((c, i) => map.set(full(c), full(b[i])));
  const identity = [...map].every(([k, v]) => k === v);
  const pairs = [...map].map(([k, v]) => [lum(k), v]).sort((x, y) => x[0] - y[0]);
  const mix = (p, q, t) => { const P = parseInt(p.slice(1), 16), Q = parseInt(q.slice(1), 16); const c = (s) => Math.round((P >> s & 255) + ((Q >> s & 255) - (P >> s & 255)) * t); return "#" + ((1 << 24) + (c(16) << 16) + (c(8) << 8) + c(0)).toString(16).slice(1); };
  const single = new Set(map.values()).size === 1 ? [...map.values()][0] : null;
  return (c) => {
    const k = full(c);
    if (identity) return c;
    if (single) return single;
    if (map.has(k)) return map.get(k);
    // a colour the old render never used (the new suit): by value, between the nearest learnt colours
    const l = lum(k);
    if (l <= pairs[0][0]) return pairs[0][1];
    if (l >= pairs[pairs.length - 1][0]) return pairs[pairs.length - 1][1];
    for (let i = 1; i < pairs.length; i++) if (l <= pairs[i][0]) { const t = (l - pairs[i - 1][0]) / (pairs[i][0] - pairs[i - 1][0] || 1); return mix(pairs[i - 1][1], pairs[i][1], t); }
    return c;
  };
}

// the options that reproduce an original figure: same structure once colours are ignored
function optionsFor(id, scale, orig) {
  const spec = oldCast.byId[id];
  const bf = (x) => +((x.match(/baseFrequency="([\d.]+)"/) || [])[1] || 0);
  const pid = (x) => (x.match(/id="([^"]+?)-(?:grain|stip)"/) || [])[1];
  // the grain is tuned to the render scale, so the original's baseFrequency gives its render scale (a wall shadow is a
  // figure rendered at one scale and placed a little larger)
  const probe = K.render(spec, { scale });
  const scales = [scale];
  if (bf(orig) && bf(probe.inner)) scales.push(+(scale * bf(orig) / bf(probe.inner)).toFixed(6));
  const sil = K.render(spec, { scale, silhouette: true });
  if (bf(orig) && bf(sil.inner)) scales.push(+(scale * bf(orig) / bf(sil.inner)).toFixed(6));
  // the frequencies are printed to 4 places, so try the estimates rounded too
  for (const v of scales.slice(1)) for (const d of [2, 3, 4]) scales.push(+v.toFixed(d));
  for (const sc of scales) for (const silhouette of [false, true]) for (const shadow of [true, false]) for (const lod of [undefined, "mid", "hi", "lo"]) {
    const o = { scale: sc }; if (silhouette) o.silhouette = true; if (!shadow) o.shadow = false; if (lod) o.lod = lod;
    const r = K.render(spec, o);
    const pre = pid(r.inner), opre = pid(orig);
    let inner = r.inner; if (pre && opre && pre !== opre) inner = inner.split(pre + "-").join(opre + "-");
    if (shape(inner) === shape(orig)) return { o, natural: inner };
  }
  return null;
}

/** swap one figure. how: { spec } for a re-dress, or { frames, figId } for motion (spec defaults to the cast's current one) */
function swap(s, id, index, how) {
  let n = -1, at = -1;
  const re = new RegExp('<g class="b68-figure" data-id="' + id + '"', "g"); let m;
  while ((m = re.exec(s))) { n++; if (n === index) { at = m.index; break; } }
  if (at < 0) throw new Error(id + " #" + index + " not found");
  const orig = elementAt(s, at);
  const head = s.slice(Math.max(0, at - 300), at).match(/scale\(([\d.]+)\)\s*"?>\s*$/);
  if (!head) throw new Error(id + " #" + index + ": no scale wrapper");
  const scale = +head[1];
  const found = optionsFor(id, scale, orig);
  if (!found) throw new Error(id + " #" + index + ": could not reproduce the original render");
  const tint = learn(found.natural, orig);
  const spec = how.spec || L.pc(id);
  const prefix = (how.figId || id + "-s") + index;
  let out;
  if (how.frames) {
    const f = M.figure(K, spec, how.frames, { id: how.figId, opts: Object.assign({}, found.o, { prefix }) });
    if (f.warnings.length) throw new Error(f.warnings.join("; "));
    const u = M.unwrap(f.svg);
    out = `<g data-fig="${how.figId}">${u.inner.replace(/<title>[\s\S]*?<\/title>/, "")}</g>`;
  } else {
    const r = K.render(spec, Object.assign({}, found.o, { prefix }));
    if (r.warnings.length) throw new Error(r.warnings.join("; "));
    out = r.inner;
  }
  out = out.replace(HEX, tint);
  return { s: s.slice(0, at) + out + s.slice(at + orig.length), opts: found.o, before: orig.length, after: out.length };
}

// the page-side player for these pages: Motion plus a timer that waits while the page is hidden
const PLAYER = `<script>
(()=>{"use strict";${M.PLAYER}
const R=(a,b)=>a+(b-a)*Math.random();
const busy={};const move=(ids,seq)=>{const k=ids.join();if(busy[k])return;busy[k]=1;Promise.all(ids.map(id=>Motion.play(id,seq))).then(()=>{busy[k]=0;});};
const every=(a,b,fn)=>{const t=()=>setTimeout(()=>{if(!document.hidden)fn();t();},R(a,b)*1000);t();};
__MOVES__
})();
</script>`;

function apply(file, jobs, moves) {
  const p = path.join(ROOT, "app", "ambient", file);
  let s = fs.readFileSync(p, "utf8");
  // a re-run starts from the committed page, never from an already re-dressed one
  s = cp.execSync("git show a3d5370:app/ambient/" + file, { cwd: ROOT, encoding: "utf8", maxBuffer: 1 << 28 });
  const before = s.length;
  for (const j of jobs) { const r = swap(s, j.id, j.index, j); s = r.s; console.log("  " + file + " " + j.id + "#" + j.index + (j.frames ? " motion " + j.figId : " re-dressed") + " " + JSON.stringify(r.opts) + " " + (r.before / 1024).toFixed(0) + "→" + (r.after / 1024).toFixed(0) + " KB"); }
  if (moves) s = s.replace(/<\/body>/, PLAYER.replace("__MOVES__", moves) + "\n</body>");
  fs.writeFileSync(p, s);
  console.log(file.padEnd(28), (before / 1024).toFixed(0) + " → " + (s.length / 1024).toFixed(0) + " KB");
}

const smoke = L.smokeFrames("R", "down");
const DRAG = JSON.stringify(L.DRAG);
const glance = [{}, { pose: { head: { yaw: -10 } } }, { pose: { head: { yaw: -22, tilt: -2 } } }];

if (require.main === module) {
  // the lair: Booker in his suit (wall shadow and figure), Alfie smokes (both), Booker glances round now and then
  apply("second-harvest.html", [
    { id: "booker", index: 0, frames: glance, figId: "bookerShadow" },
    { id: "booker", index: 1, frames: glance, figId: "booker" },
    { id: "alfie", index: 0, frames: smoke, figId: "alfieShadow" },
    { id: "alfie", index: 1, frames: smoke, figId: "alfie" },
  ], `every(14,34,()=>move(['alfie','alfieShadow'],${DRAG}));every(18,40,()=>move(['booker','bookerShadow'],[[1,160],[2,2400],[1,160],[0,0]]));`);
  // the rooftop: silhouettes; Booker's suit changes his outline, Alfie's cigarette goes up and down
  apply("duskwall-after-dark.html", [
    { id: "booker", index: 0 },
    { id: "alfie", index: 0, frames: smoke, figId: "alfie" },
  ], `every(16,38,()=>move(['alfie'],${DRAG}));`);
  // the watch feed: Booker's record on the main monitor and his camera; Alfie smokes on camera 12
  apply("watch-feed.html", [
    { id: "booker", index: 0 },
    { id: "booker", index: 1 },
    { id: "alfie", index: 1, frames: smoke, figId: "alfieCam" },
  ], `every(12,30,()=>move(['alfieCam'],${DRAG}));`);
}
module.exports = { swap, learn };
