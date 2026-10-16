// Figure motion for the ambient scenes: render one figure-kit figure in several poses (the frames of a move) and fold them
// into ONE svg that holds every unchanged part once and only the parts that move as per-frame variants. A tiny player in
// the page (PLAYER below) shows one frame at a time, so a move is a few hard-cut frames: the book's print logic, not a tween.
//
//   const M = require("./motion.js");
//   const fig = M.figure(K, spec, [ {}, { pose: { arms: { R: { a: "hold", b: "smoke", t: 1 } } } } ], { id: "alfie" });
//   fig.svg      -> "<svg ...>" with data-mv groups; place it like any kit svg
//   fig.frames   -> number of frames
//
// Each frame is a partial spec merged over `spec` (objects merge, everything else replaces). Frame 0 shows first.
"use strict";

// ---------- a small XML tree, enough for the kit's own output ----------
function parse(src) {
  const root = { tag: "#root", attrs: "", kids: [] };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith("<!--")) continue;
    const top = stack[stack.length - 1];
    if (m[5] != null) { top.kids.push({ text: m[5] }); continue; }
    if (m[1]) { stack.pop(); continue; }
    const node = { tag: m[2], attrs: m[3] || "", kids: [] };
    top.kids.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}
const ser = (n) => n.text != null ? n.text : n.kids.length ? `<${n.tag}${n.attrs}>${n.kids.map(ser).join("")}</${n.tag}>` : `<${n.tag}${n.attrs}/>`;
function memoSer(n) { if (n._s == null) n._s = ser(n); return n._s; }
const idOf = (n) => { if (n.text != null) return null; const m = n.attrs.match(/\sid="([^"]+)"/); return m ? m[1] : null; };

// key children for alignment: an id when there is one, else tag + its running index among same-tag id-less siblings
function keyed(kids) {
  const count = {};
  return kids.map((k) => {
    const id = idOf(k);
    if (id) return { key: "#" + id, node: k };
    const t = k.text != null ? "#text" : k.tag;
    count[t] = (count[t] || 0) + 1;
    return { key: t + ":" + count[t], node: k };
  });
}

// union order of the frames' child keys; a key a frame has out of order gets its own slot ("moved" part, e.g. an arm that
// swaps from behind the torso to in front of it)
function unionSlots(lists) {
  const slots = []; // { key, nodes: [] per frame }
  lists.forEach((list, f) => {
    let prev = -1;
    for (const { key, node } of list) {
      let at = -1;
      for (let i = prev + 1; i < slots.length; i++) if (slots[i].key === key && slots[i].nodes[f] === undefined) { at = i; break; }
      if (at < 0) { at = prev + 1; slots.splice(at, 0, { key, nodes: [] }); }
      slots[at].nodes[f] = node;
      prev = at;
    }
  });
  return slots;
}

// merge the same node across frames into markup; `F` frames
function merge(nodes, F, out, inDefs) {
  const present = nodes.map((n) => n !== undefined);
  const sers = nodes.map((n) => n === undefined ? null : memoSer(n));
  if (present.every(Boolean) && sers.every((s) => s === sers[0])) return sers[0];
  const same = present.every(Boolean) && nodes.every((n) => n.text == null && n.tag === nodes[0].tag && n.attrs === nodes[0].attrs);
  if (same && nodes[0].kids.length) {
    const slots = unionSlots(nodes.map((n) => keyed(n.kids)));
    // only worth descending when most of the children line up
    const shared = slots.filter((s) => s.nodes.filter(Boolean).length === F).length;
    if (inDefs || nodes[0].tag === "defs" || shared >= slots.length * 0.5) {
      const deeper = inDefs || nodes[0].tag === "defs";
      const inner = slots.map((s) => merge(Array.from({ length: F }, (_, f) => s.nodes[f]), F, out, deeper)).join("");
      return `<${nodes[0].tag}${nodes[0].attrs}>${inner}</${nodes[0].tag}>`;
    }
  }
  // inside <defs> nothing is shown, only referenced: every version stays, untagged (renameDefs gave each its own id)
  if (inDefs) return [...new Set(sers.filter((x) => x != null))].join("");
  // a variant point: each distinct version once, tagged with the frames that show it
  const groups = [];
  sers.forEach((s, f) => {
    if (s == null) return;
    const g = groups.find((x) => x.s === s);
    if (g) g.f.push(f); else groups.push({ s, f: [f] });
  });
  out.points++;
  return `<g data-mv="">${groups.map((g) => `<g data-f=" ${g.f.join(" ")} "${g.f.includes(0) ? "" : ' style="display:none"'}>${g.s}</g>`).join("")}</g>`;
}

// a definition (clip path, mask, gradient...) that differs between frames gets one id per version, and each frame's markup
// points at its own version; the referencing parts then differ between frames and become variants themselves
function renameDefs(svgs) {
  // every referenced id (url(#x), href="#x"), wherever it is defined: a clip path can sit inside a part group, not only in <defs>
  const refd = new Set();
  for (const s of svgs) for (const m of s.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)) refd.add(m[1] || m[2]);
  const maps = svgs.map((s) => {
    const m = new Map();
    (function walk(n) {
      for (const k of n.kids || []) {
        if (k.text != null) continue;
        const id = idOf(k);
        if (id && refd.has(id)) m.set(id, memoSer(k));
        walk(k);
      }
    })(parse(s));
    return m;
  });
  const ids = new Set([].concat(...maps.map((m) => [...m.keys()])));
  let out = svgs.slice();
  for (const id of ids) {
    const vers = maps.map((m) => m.get(id));
    if (vers.every((v) => v === vers[0])) continue;
    const uniq = [...new Set(vers.filter((v) => v != null))];
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp('(id="|#)' + esc + '(?=["\\)])', "g");
    out = out.map((s, f) => vers[f] == null ? s : s.replace(re, "$1" + id + "__v" + uniq.indexOf(vers[f])));
  }
  return out;
}

function deepMerge(base, over) {
  if (over === null || typeof over !== "object" || Array.isArray(over)) return over === undefined ? base : over;
  const o = base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
  for (const k of Object.keys(over)) o[k] = deepMerge(o[k], over[k]);
  return o;
}

/** figure(K, spec, frames, { id, render: "render" | "portrait", opts }) -> { svg, frames, bytes, points, warnings } */
function figure(K, spec, frames, o = {}) {
  const fn = o.render || "render";
  const renders = frames.map((fr) => K[fn](deepMerge(JSON.parse(JSON.stringify(spec)), fr), o.opts || {}));
  const warnings = [].concat(...renders.map((r) => r.warnings || []));
  const pre = (svg) => { const m = svg.match(/id="([^"]+?)-grain"/); return m ? m[1] : null; };
  const p0 = pre(renders[0].svg);
  const svgs = renders.map((r) => { const p = pre(r.svg); return p && p0 && p !== p0 ? r.svg.split(p + "-").join(p0 + "-") : r.svg; });
  // one viewBox for every frame: the union, so nothing jumps
  const vbs = svgs.map((s) => s.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number));
  const x0 = Math.min(...vbs.map((v) => v[0])), y0 = Math.min(...vbs.map((v) => v[1]));
  const x1 = Math.max(...vbs.map((v) => v[0] + v[2])), y1 = Math.max(...vbs.map((v) => v[1] + v[3]));
  const trees = renameDefs(svgs).map((s) => parse(s).kids.find((k) => k.tag === "svg"));
  const out = { points: 0 };
  const inner = unionSlots(trees.map((t) => keyed(t.kids))).map((s) => merge(Array.from({ length: frames.length }, (_, f) => s.nodes[f]), frames.length, out)).join("");
  const id = o.id || "fig";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" data-fig="${id}" data-frames="${frames.length}">${inner}</svg>`;
  return { svg, frames: frames.length, bytes: svg.length, single: svgs[0].length, points: out.points, warnings, vb: [x0, y0, x1 - x0, y1 - y0] };
}

/** strip the outer <svg> and give back { vb, inner } so a scene can nest the figure in its own <svg> */
function unwrap(svg) {
  const m = svg.match(/^<svg([^>]*)>([\s\S]*)<\/svg>\s*$/);
  const vb = m[1].match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const fig = (m[1].match(/data-fig="([^"]+)"/) || [])[1];
  return { vb, inner: m[2], fig };
}

/** place a figure at its feet: x centre, y baseline, h px tall for its world height (kit units are 25/inch) */
function place(fig, { x, y, scale, attrs = "" }) {
  const u = unwrap(fig.svg || fig);
  const [vx, vy, vw, vh] = u.vb;
  return `<svg x="${x + vx * scale}" y="${y + vy * scale}" width="${vw * scale}" height="${vh * scale}" viewBox="${u.vb.join(" ")}" overflow="visible"${u.fig ? ` data-fig="${u.fig}"` : ""} ${attrs}>${u.inner}</svg>`;
}

// The page-side player: Motion.show(figId, k) and Motion.play(figId, [[frame, ms], ...]) -> Promise. Uses the page's own
// clock-free setTimeout; a hidden page simply finishes the move late. Kept small: it ships in every scene.
const PLAYER = `
const Motion=(()=>{const figs={};
 function idx(id){if(figs[id])return figs[id];const root=document.querySelectorAll('[data-fig="'+id+'"]');const pts=[];
  root.forEach(r=>r.querySelectorAll('[data-mv]').forEach(p=>{const vs=[];for(const c of p.children)vs.push({el:c,f:c.getAttribute('data-f')});pts.push(vs);}));
  return figs[id]={pts,cur:0};}
 function show(id,k){const F=idx(id);if(F.cur===k)return;const key=' '+k+' ';
  for(const vs of F.pts)for(const v of vs){const on=v.f.indexOf(key)>=0;const d=on?'':'none';if(v.el.style.display!==d)v.el.style.display=d;}F.cur=k;}
 function play(id,seq){return new Promise(res=>{let i=0;const next=()=>{if(i>=seq.length)return res();const [k,ms]=seq[i++];show(id,k);setTimeout(next,ms);};next();});}
 return {show,play};})();
`;

module.exports = { figure, unwrap, place, deepMerge, PLAYER, parse, ser };
