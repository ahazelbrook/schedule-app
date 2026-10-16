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

// key children for alignment: an id when there is one (a per-frame copy, X__s1, counts as its part X, so the copies share a
// slot and come out as one variant point), else tag + its running index among same-tag id-less siblings
function keyed(kids) {
  const count = {};
  return kids.map((k) => {
    const id = idOf(k);
    if (id) return { key: "#" + id.replace(/__s\d+$/, ""), node: k };
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
    // only worth descending when most of the children line up: measured against a frame's own children, not the union of
    // slots (a part that moves in the stacking order takes a slot per place, and must not talk the merge out of descending)
    const shared = slots.filter((s) => s.nodes.filter(Boolean).length === F).length;
    const perFrame = nodes.reduce((a, n) => a + n.kids.length, 0) / F;
    if (inDefs || nodes[0].tag === "defs" || shared >= perFrame * 0.5) {
      const deeper = inDefs || nodes[0].tag === "defs";
      const inner = slots.map((s) => merge(Array.from({ length: F }, (_, f) => s.nodes[f]), F, out, deeper)).join("");
      return `<${nodes[0].tag}${nodes[0].attrs}>${inner}</${nodes[0].tag}>`;
    }
  }
  // inside <defs> nothing is shown, only referenced: every version stays, untagged (renameDefs gave each its own id)
  if (inDefs) return [...new Set(sers.filter((x) => x != null))].join("");
  // A variant point: each distinct version once, tagged with the frames that show it, and an empty version for the frames
  // that have nothing here (the part sits in another slot then, or is not drawn), so that every point shows exactly one
  // version in every frame and a point with nothing for a frame cannot pass for a part that vanished.
  // A version that is off is visibility:hidden, not display:none. WebKit keeps a hidden element's renderer (and its cached
  // masks and filter results), so a cut restyles and repaints the figure instead of tearing renderers down, laying the figure
  // out again and rebuilding every filter of the part it shows: in WebKit 26 a cut of one figure of the planning meeting costs
  // the main thread about 93 ms this way and 215 ms with display:none. The price: a clip path or mask inside a hidden version
  // is empty (its content is hidden too), so nothing outside a version may reference into it; the ids are per frame
  // (renameDefs, splitIds) and checks/runtime/ambient-frames.test.mjs walks every frame to prove it.
  const groups = [], none = [];
  sers.forEach((s, f) => {
    if (s == null) { none.push(f); return; }
    const g = groups.find((x) => x.s === s);
    if (g) g.f.push(f); else groups.push({ s, f: [f] });
  });
  if (none.length) groups.push({ s: "", f: none });
  out.points++;
  return `<g data-mv="">${groups.map((g) => `<g data-f=" ${g.f.join(" ")} "${g.f.includes(0) ? "" : ' style="visibility:hidden"'}>${g.s}</g>`).join("")}</g>`;
}

// A definition, meaning anything that is referenced (a clip path, mask, gradient or filter, the kit's part paths in <defs>,
// and a part group a yoke <use>s), that differs between frames gets one id per version, and each frame's markup points at
// its own version; the parts that reference it then differ between frames and become variants themselves. A definition's
// version counts what it references: a clip path reading <use href="#head-s"/> in every frame still differs when head-s does,
// so it is versioned too, and every id in the page stays unique (a duplicate id would hand some frames another frame's mask,
// and WebKit and Chromium do not even agree on which). A referenced part group is versioned whole on purpose: were it one
// element with variants inside, every cut would make WebKit rebuild each <use> copy of it (a relayout, and every cached mask
// of the copy drawn again), which costs more than the copies cost in bytes.
function renameDefs(svgs) {
  const refd = new Set();
  for (const s of svgs) for (const m of s.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)) refd.add(m[1] || m[2]);
  // the definitions each frame holds: id -> markup
  const defs = svgs.map((s) => {
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
  const ids = new Set([].concat(...defs.map((m) => [...m.keys()])));
  // a definition's version in a frame: its markup with every definition it references resolved to that one's version
  const memo = defs.map(() => new Map());
  function version(id, f, stack) {
    if (memo[f].has(id)) return memo[f].get(id);
    const raw = defs[f].get(id);
    if (raw == null) return null;
    if (stack.has(id)) return raw;                                   // a reference cycle: take the markup as it is
    stack.add(id);
    const v = raw.replace(/(url\(#|href="#)([^)"]+)/g, (all, pre, ref) => ids.has(ref) ? pre + ref + "@" + version(ref, f, stack) : all);
    stack.delete(id);
    memo[f].set(id, v);
    return v;
  }
  let out = svgs.slice();
  for (const id of ids) {
    const vers = svgs.map((_, f) => version(id, f, new Set()));
    if (vers.every((v) => v === vers[0])) continue;
    const uniq = [...new Set(vers.filter((v) => v != null))];
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp('(id="|#)' + esc + '(?=["\\)])', "g");
    out = out.map((s, f) => vers[f] == null ? s : s.replace(re, "$1" + id + "__v" + uniq.indexOf(vers[f])));
  }
  return out;
}

/** the ids defined more than once in a piece of markup (none, in a figure motion.js built) */
function duplicateIds(svg) {
  const seen = new Set(), dup = new Set();
  for (const m of svg.matchAll(/<[a-zA-Z][\w:-]*(?:\s[^>]*?)?\sid="([^"]+)"/g)) { if (seen.has(m[1])) dup.add(m[1]); seen.add(m[1]); }
  return [...dup];
}

/** the ids the merge put out more than once, renamed per frame in the frames' markup: the copy a frame shows is X__s<k> there */
function splitIds(texts, inner, dup) {
  const F = texts.length;
  const copies = {};                                                  // id -> the frames each copy covers, in markup order
  (function walk(n, frames) {
    for (const k of n.kids || []) {
      if (k.text != null) continue;
      const m = k.attrs.match(/\sdata-f="([^"]*)"/);
      const fr = m ? m[1].trim().split(/\s+/).filter(Boolean).map(Number) : frames;
      const id = idOf(k);
      if (id && dup.includes(id)) (copies[id] = copies[id] || []).push(fr);
      walk(k, fr);
    }
  })(parse(`<svg>${inner}</svg>`), Array.from({ length: F }, (_, f) => f));
  let out = texts.slice();
  for (const id of dup) {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp('(id="|#)' + esc + '(?=["\\)])', "g");
    out = out.map((s, f) => {
      const k = (copies[id] || []).findIndex((fr) => fr.includes(f));
      return k < 0 ? s : s.replace(re, "$1" + id + "__s" + k);
    });
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
  const id = o.id || "fig", F = frames.length;
  let texts = renameDefs(svgs), inner, out;
  // An element that is not a definition can still come out twice: a part whose place in the stacking order moves between
  // frames (an arm from behind the torso to in front of it) sits in two slots, and a part whose own attributes differ is a
  // variant as a whole. Each copy then gets its own id per frame (X__s0, X__s1), so the ids stay unique and anything that
  // references the part (a yoke's <use>) differs between frames and becomes a variant itself.
  for (let pass = 0; ; pass++) {
    const trees = texts.map((s) => parse(s).kids.find((k) => k.tag === "svg"));
    out = { points: 0 };
    inner = unionSlots(trees.map((t) => keyed(t.kids))).map((s) => merge(Array.from({ length: F }, (_, f) => s.nodes[f]), F, out)).join("");
    const dup = duplicateIds(inner);
    if (!dup.length) break;
    if (pass >= 4) throw new Error(id + ": " + dup.length + " id(s) still defined twice after " + pass + " passes (" + dup.slice(0, 4).join(", ") + ")");
    texts = splitIds(texts, inner, dup);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" data-fig="${id}" data-frames="${F}">${inner}</svg>`;
  const bad = verify(inner, texts);
  if (bad) throw new Error(id + ": the merged figure does not show " + bad);
  return { svg, frames: F, bytes: svg.length, single: svgs[0].length, points: out.points, warnings, vb: [x0, y0, x1 - x0, y1 - y0] };
}

/** Frame k of a merged figure, as the player shows it: every variant point replaced by the content of its version for k.
 *  `defs` collects the definitions (id -> markup) instead of returning them, since <defs> hold every frame's versions. */
function project(nodes, k, defs) {
  let o = "";
  for (const n of nodes) {
    if (n.text != null) { o += n.text; continue; }
    if (n.tag === "defs") { (function walk(d) { for (const c of d.kids) { if (c.text != null) continue; const i = idOf(c); if (i) defs.set(i, memoSer(c)); walk(c); } })(n); continue; }
    if (/\sdata-mv=""/.test(n.attrs)) {
      for (const v of n.kids) { const m = v.attrs && v.attrs.match(/\sdata-f="([^"]*)"/); if (m && m[1].trim().split(/\s+/).map(Number).includes(k)) o += project(v.kids, k, defs); }
      continue;
    }
    o += n.kids.length ? `<${n.tag}${n.attrs}>${project(n.kids, k, defs)}</${n.tag}>` : `<${n.tag}${n.attrs}/>`;
  }
  return o;
}
/** The merge's own proof: each frame, projected out of the merged markup, is exactly that frame's render (ids as renamed),
 *  and every definition the frame has is there, unchanged. Returns what differs, or null. */
function verify(inner, texts) {
  const merged = parse(`<svg>${inner}</svg>`).kids[0].kids;
  for (let k = 0; k < texts.length; k++) {
    const own = parse(texts[k]).kids.find((n) => n.tag === "svg").kids;
    const mDefs = new Map(), oDefs = new Map();
    const a = project(merged, k, mDefs), b = project(own, k, oDefs);
    if (a !== b) { let i = 0; while (a[i] === b[i]) i++; return "frame " + k + " as rendered (they part at: " + JSON.stringify(b.slice(Math.max(0, i - 60), i + 60)) + ")"; }
    for (const [i, d] of oDefs) if (mDefs.get(i) !== d) return "frame " + k + "'s definition #" + i;
  }
  return null;
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
// clock-free setTimeout; a hidden page simply finishes the move late. Kept small: it ships in every scene. A version that is
// off is visibility:hidden (see merge above: a display:none would make every cut a relayout on the iPad).
const PLAYER = `
const Motion=(()=>{const figs={};
 function idx(id){if(figs[id])return figs[id];const root=document.querySelectorAll('[data-fig="'+id+'"]');const pts=[];
  root.forEach(r=>r.querySelectorAll('[data-mv]').forEach(p=>{const vs=[];for(const c of p.children)vs.push({el:c,f:c.getAttribute('data-f')});pts.push(vs);}));
  return figs[id]={pts,cur:0};}
 function show(id,k){const F=idx(id);if(F.cur===k)return;const key=' '+k+' ';
  for(const vs of F.pts)for(const v of vs){const on=v.f.indexOf(key)>=0;const d=on?'':'hidden';if(v.el.style.visibility!==d)v.el.style.visibility=d;}F.cur=k;}
 function play(id,seq){return new Promise(res=>{let i=0;const next=()=>{if(i>=seq.length)return res();const [k,ms]=seq[i++];show(id,k);setTimeout(next,ms);};next();});}
 return {show,play};})();
`;

module.exports = { figure, unwrap, place, deepMerge, PLAYER, parse, ser, verify };
