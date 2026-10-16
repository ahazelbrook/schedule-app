// Shared parts for the hand-built ambient scenes (tools/ambient/scenes/*.js): the design system's palette, the figure kit and
// cast, the vault NPCs copied into figures/, figure motion, small SVG helpers and the page writer.
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const K = require(path.join(ROOT, "app", "figures", "figure-kit.js"));
const cast = require(path.join(ROOT, "app", "figures", "cast.js"));
const M = require("./motion.js");
const { bakeNoise } = require("./noise.js");
const { page } = require("./shell.js");
// viewBox px -> device px on the table iPad (a 1600-wide stage on a 2048-px-wide 2x screen): what the grain tiles are sampled for
const DEVICE = 2048 / 1600;

// the design system's tokens (Blades '68 Design System, tokens.json), by name
const C = {
  ink900: "#14110e", ink700: "#2a2521", ink500: "#55504a", ink300: "#8e8880", ink150: "#c9c3b8",
  paper000: "#fbf8f1", paper100: "#f2ede1", paper200: "#e8e2d4", paper300: "#dcd4c2", paperTint: "#efe7d6",
  signal500: "#e0691e", signal700: "#b8481a", signal900: "#6b2a10",
  caution500: "#e8c33c", caution700: "#c39b18", caution900: "#6e5408",
  alarm500: "#e03a20", alarm700: "#a8210f", alarm900: "#5c1208",
  file500: "#3f62c4", file700: "#26418f", file900: "#12224f", file300: "#8fa3dd",
  covert500: "#6e8f6a", covert700: "#41633e", covert900: "#13513b",
  rust500: "#c1571c", rust700: "#8a3c14", rust900: "#3a2213",
  swing500: "#c9348c", swing700: "#98206a", swing900: "#4e0f36",
  slate500: "#6e8a8c", slate700: "#3e5356", slate900: "#1a1a1c", flesh500: "#d9736e",
  paraA: "#cce0f6", paraB: "#3c4b90", hullA: "#36536c", hullB: "#1e2633", swingB: "#cb6a85",
  vetA: "#837872", vetB: "#48342a", dealA: "#7b6868", dealB: "#3f3533", milA: "#eed33d", milB: "#231a18",
  raceA: "#ac5621", raceB: "#3e2714", shadA: "#a0b58e", shadB: "#191d15", intA: "#90491a", intB: "#341805",
};

const npc = (id) => JSON.parse(fs.readFileSync(path.join(__dirname, "figures", id + ".json"), "utf8"));
const pc = (id) => JSON.parse(JSON.stringify(cast.byId[id]));

// seeded random, so a rebuild draws the same scene
function rng(seed = 1) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/** a kit figure, optionally with motion frames. o: { id, frames, lod, scheme, silhouette, shadow, outline, place }
 *  `place` is the scale at() will show it at (px per kit unit): the grain and stipple noise are baked into tiles sampled
 *  where the iPad's pixels fall (noise.js), so a cut never has the browser compute fractal noise again. */
function fig(spec, o = {}) {
  const id = o.id || spec.id;
  const opts = { prefix: id, lod: o.lod || "mid" };
  for (const k of ["scheme", "silhouette", "shadow", "outline", "grain"]) if (o[k] !== undefined) opts[k] = o[k];
  const f = M.figure(K, spec, o.frames || [{}], { id, opts });
  if (f.warnings.length) throw new Error(id + ": " + f.warnings.join("; "));
  if (o.bake !== false) { f.svg = bakeNoise(f.svg, { upp: 1 / ((o.place || 0.36) * DEVICE) }); f.bytes = f.svg.length; }
  return f;
}
/** place a figure with its feet at (x, floor), `s` px per kit unit (25 units = 1 inch, so 0.2 makes 6 ft = 360 px) */
const at = (f, x, floor, s, attrs = "") => M.place(f, { x, y: floor, scale: s, attrs });

/** the standard cigarette move for a smoke-pose arm: frames rest -> mouth */
const SMOKE_T = [0.4, 0.7, 0.93, 1];
const smokeFrames = (side = "R", from = "down") => SMOKE_T.map((t) => ({ pose: { arms: { [side]: { a: from, b: "smoke", t } } } }));
// a drag: up, hold, down (frame index, ms)
const DRAG = [[1, 110], [2, 110], [3, 2600], [2, 120], [1, 120], [0, 0]];

const f2 = (n) => Math.round(n * 100) / 100;
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/** points [[x,y],...] -> "x,y x,y" */
const pts = (a) => a.map((p) => f2(p[0]) + "," + f2(p[1])).join(" ");
/** stipple: n dots of radius r in a polygon's bounding box, kept where keep(x,y) */
function stipple(r, n, box, keep, fill, rad = 1.6, op = 0.5) {
  let o = "";
  for (let i = 0; i < n; i++) {
    const x = box[0] + r() * box[2], y = box[1] + r() * box[3];
    if (!keep || keep(x, y)) o += `<circle cx="${f2(x)}" cy="${f2(y)}" r="${f2(rad * (0.6 + r() * 0.8))}"/>`;
  }
  return `<g fill="${fill}" opacity="${op}">${o}</g>`;
}

// page-side helpers every scene gets: Motion (from motion.js) and every(a, b, fn), a timer on the shell's clock (paused when hidden)
const SCRIPT_BASE = M.PLAYER + `
const every=(a,b,fn,first)=>{let t=first!=null?first:R(a,b);loop(dt=>{t-=dt;if(t<=0){t=R(a,b);fn();}});};
const busy={};const move=(id,seq)=>{if(busy[id])return Promise.resolve();busy[id]=1;return Motion.play(id,seq).then(()=>{busy[id]=0;});};
`;

/** write app/ambient/<file> and report its size */
function build(o) {
  const html = page(Object.assign({}, o, { script: SCRIPT_BASE + (o.script || "") }));
  const out = path.join(ROOT, "app", "ambient", o.file);
  fs.writeFileSync(out, html);
  console.log(o.file.padEnd(28), (html.length / 1024).toFixed(0).padStart(6) + " KB");
  return out;
}

module.exports = { K, cast, M, C, npc, pc, rng, fig, at, smokeFrames, DRAG, SMOKE_T, f2, esc, pts, stipple, build, ROOT };
