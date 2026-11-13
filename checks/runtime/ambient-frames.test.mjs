// A frame walk over every ambient scene with figure motion (tools/ambient/motion.js): for every figure ([data-fig]) and every
// frame any of its versions names, the markup is read the way the page's Motion player shows it, and
//   - every variant point ([data-mv]) shows exactly one version (none: that part vanishes in that frame; two: it is drawn twice),
//   - nothing a shown element references (a clip path, mask, gradient, filter, pattern or <use>d shape, and what those
//     reference in turn) is missing, defined twice, or sits in a version that is hidden in that frame. A hidden version is
//     visibility:hidden (or display:none in older builds); a clip path or mask inside one is empty in every browser, and older
//     WebKit (the iPad) does not resolve a reference into a display:none subtree at all, so the part that uses it vanishes,
//   - the head ([data-part="head"], the figure kit's part group) is shown exactly once in every frame, with all of the above,
//   - the markup's own state is frame 0 (what shows before the player first runs), and no element inside a version turns
//     itself visible again (visibility="visible" would leak out of a hidden version).
// Chromium resolves references that WebKit does not, so a screenshot in Chromium alone hides this; hence a walk of the markup.
// Plain Node, no browser.
//   node checks/runtime/ambient-frames.test.mjs [dir]     (dir defaults to app/ambient)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AMB = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'app', 'ambient');
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); }
}

// ---------- a small markup tree: enough for the scenes (script and style dropped, SVG closed properly) ----------
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
function attrsOf(s) {
  const a = {};
  for (const m of s.matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) a[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  return a;
}
function parse(html) {
  const src = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  const root = { tag: '#root', a: {}, kids: [], parent: null };
  const all = [];
  let cur = root;
  for (const m of src.matchAll(/<(\/?)([A-Za-z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    if (m[1]) { let n = cur; while (n && n.tag !== m[2]) n = n.parent; if (n && n.parent) cur = n.parent; continue; }
    const node = { tag: m[2], a: attrsOf(m[3]), kids: [], parent: cur };
    cur.kids.push(node); all.push(node);
    if (!m[4] && !VOID.has(m[2].toLowerCase())) cur = node;
  }
  return { root, all };
}
const framesOf = (n) => (n.a['data-f'] || '').trim().split(/\s+/).filter(Boolean).map(Number);
const isVersion = (n) => n.a['data-f'] !== undefined && n.parent && n.parent.a['data-mv'] !== undefined;
const hiddenByStyle = (n) => /(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden)/i.test(n.a.style || '') || n.a.display === 'none' || n.a.visibility === 'hidden';
const refsOf = (n) => {
  const out = [];
  for (const [k, v] of Object.entries(n.a)) {
    if (k === 'href' || k === 'xlink:href') { if (v.startsWith('#')) out.push([k, v.slice(1)]); continue; }
    for (const m of v.matchAll(/url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/g)) out.push([k, m[1]]);
  }
  return out;
};
const where = (n) => { const p = []; for (let x = n; x && x.tag !== '#root' && p.length < 4; x = x.parent) p.push(x.tag + (x.a.id ? '#' + x.a.id : x.a['data-part'] ? '[' + x.a['data-part'] + ']' : x.a['data-f'] !== undefined ? '[data-f="' + x.a['data-f'] + '"]' : '')); return p.join(' < '); };

/** walk one scene; returns { figures, frames, heads, problems: [...] } */
export function walkScene(html, name = 'scene', cap = 400) {
  const { root, all } = parse(html);
  const problems = [];
  const say = (s) => { if (problems.length < cap) problems.push(name + ': ' + s); };
  const byId = new Map();
  for (const n of all) if (n.a.id) (byId.get(n.a.id) || byId.set(n.a.id, []).get(n.a.id)).push(n);
  for (const [id, ns] of byId) if (ns.length > 1) say('#' + id + ' is defined ' + ns.length + ' times (' + where(ns[1]) + ')');
  // each element's frame mask: the frames in which every version around it is shown (bit k = frame k); -1 = every frame
  (function down(n, mask, fig) {
    for (const k of n.kids) {
      let m = mask, f = fig;
      if (k.a['data-fig'] !== undefined) f = k;
      if (k.a['data-f'] !== undefined) {
        if (!isVersion(k)) say('a data-f outside a variant point: ' + where(k));
        const fr = framesOf(k);
        if (fr.some((x) => !(x >= 0 && x < 31))) say('frame numbers out of range: ' + where(k));
        m &= fr.reduce((a, x) => a | (1 << x), 0);
        k.vfig = f;                                   // the figure this version belongs to
      }
      k.mask = m; k.fig = f;
      down(k, m, f);
    }
  })(root, -1, null);
  // the variant ancestors of an element, nearest first (to name a figure a reference leaves)
  const versionFigs = (n) => { const s = new Set(); for (let x = n; x; x = x.parent) if (x.vfig) s.add(x.vfig); return s; };

  const figRoots = all.filter((n) => n.a['data-fig'] !== undefined && hasMv(n));
  function hasMv(n) { for (const k of n.kids) if (k.a['data-mv'] !== undefined || hasMv(k)) return true; return false; }
  const sub = (n, out = []) => { out.push(n); for (const k of n.kids) sub(k, out); return out; };
  let frames = 0, heads = 0;
  for (const R of figRoots) {
    const nodes = sub(R);
    const label = R.a['data-fig'];
    const F = new Set(); for (const n of nodes) if (n.a['data-f'] !== undefined) framesOf(n).forEach((k) => F.add(k));
    const ks = [...F].sort((a, b) => a - b);
    if (!ks.includes(0)) say(label + ': no version shows frame 0');
    const headNodes = nodes.filter((n) => n.a['data-part'] === 'head');
    // the markup is frame 0: versions of other frames start hidden, frame-0 versions start shown
    for (const n of nodes) {
      if (!isVersion(n)) continue;
      const on = framesOf(n).includes(0);
      if (on === hiddenByStyle(n)) say(label + ': a version for frames' + n.a['data-f'] + 'starts ' + (on ? 'hidden' : 'shown') + ' (' + where(n) + ')');
    }
    for (const n of nodes) if (n.mask !== -1 && (/visibility\s*:\s*visible/i.test(n.a.style || '') || n.a.visibility === 'visible')) say(label + ': ' + where(n) + ' turns itself visible inside a version');
    for (const k of ks) {
      frames++;
      const on = (n) => (n.mask >>> 0 & (1 << k) >>> 0) !== 0 || n.mask === -1;
      // one version per variant point
      for (const P of nodes) {
        if (P.a['data-mv'] === undefined || !on(P)) continue;
        const kids = P.kids;
        if (kids.some((c) => c.a['data-f'] === undefined)) say(label + ' frame ' + k + ': a variant point holds an untagged child (' + where(P) + ')');
        const shown = kids.filter((c) => framesOf(c).includes(k));
        if (shown.length !== 1) say(label + ' frame ' + k + ': ' + shown.length + ' versions shown at ' + where(kids[0] || P) + (shown.length ? '' : ' (the part vanishes)'));
      }
      // references from everything shown, followed through what they reference
      const done = new Set();
      const check = (n, via) => {
        for (const [attr, id] of refsOf(n)) {
          const ts = byId.get(id);
          if (!ts) { say(label + ' frame ' + k + ': ' + where(n) + ' ' + attr + ' -> #' + id + ' is missing'); continue; }
          const T = ts[0];
          if (!on(T)) { say(label + ' frame ' + k + ': ' + where(n) + ' ' + attr + ' -> #' + id + ' sits in a version hidden in this frame (' + where(T) + ')' + (via ? ' via ' + via : '')); continue; }
          for (const vf of versionFigs(T)) if (vf !== R) { say(label + ' frame ' + k + ': #' + id + ' sits in the frames of another figure (' + (vf.a['data-fig']) + ')'); break; }
          if (done.has(id)) continue;
          done.add(id);
          for (const d of sub(T)) if (on(d)) check(d, via || '#' + id);
        }
      };
      for (const n of nodes) if (on(n)) check(n, '');
      // the head: shown exactly once, with something to draw
      if (headNodes.length) {
        const shownHeads = headNodes.filter(on);
        heads++;
        if (shownHeads.length !== 1) say(label + ' frame ' + k + ': ' + shownHeads.length + ' heads shown' + (shownHeads.length ? '' : ' (the head vanishes)'));
        for (const h of shownHeads) if (!sub(h).some((d) => on(d) && (d.tag === 'path' || d.tag === 'use'))) say(label + ' frame ' + k + ': the head has nothing to draw');
      }
    }
  }
  return { figures: figRoots.length, frames, heads, problems };
}

const MAIN = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const scenes = MAIN && fs.existsSync(AMB) ? fs.readdirSync(AMB).filter((f) => f.endsWith('.html')).sort() : [];
const read = (f) => fs.readFileSync(path.join(AMB, f), 'utf8');
// a scene with figure motion: variant points in its markup (every scene's script carries the player, which names data-mv too)
const moving = scenes.filter((f) => /<g data-mv=/.test(read(f)));

if (MAIN) {
await test('the scenes with figure motion are found (the meeting and the credits among them)', () => {
  if (!moving.includes('planning-meeting.html') || !moving.includes('opening-credits.html')) throw new Error('found only: ' + moving.join(', '));
});

for (const f of moving) {
  await test(f + ': every figure, every frame: one version per part, the head shown once, every reference shown and unique', () => {
    const r = walkScene(read(f), f);
    if (!r.figures) throw new Error('no figure with motion found');
    if (r.problems.length) throw new Error(r.problems.length + (r.problems.length >= 400 ? '+' : '') + ' problem(s):\n  ' + r.problems.slice(0, 12).join('\n  '));
    console.log('     ' + r.figures + ' figure(s), ' + r.frames + ' figure-frames, ' + r.heads + ' with a head');
  });
}

await test('the walk catches what it is for (a made-up figure: a clip in a hidden version, a lost part, a doubled head)', () => {
  const bad = `<svg><svg data-fig="x"><defs><path id="s" d="M0 0h1v1z"/></defs>
    <g data-mv=""><g data-f=" 0 "><clipPath id="c0"><use href="#s"/></clipPath><g data-part="head"><use href="#s"/></g></g><g data-f=" 1 " style="visibility:hidden"><g data-part="head"><use href="#s"/></g></g></g>
    <g data-mv=""><g data-f=" 0 "><use href="#s" clip-path="url(#c0)"/></g><g data-f=" 1 " style="visibility:hidden"><use href="#s" clip-path="url(#c0)"/></g></g>
    <g data-mv=""><g data-f=" 0 "><path d="M0 0h1"/></g></g>
    <g data-mv=""><g data-f=" 2 " style="visibility:hidden"><path d="M0 0"/></g><g data-f=" 0 1 2 "><g data-part="head"><use href="#s"/></g></g></g></svg></svg>`;
  const p = walkScene(bad, 'made-up').problems.join('\n');
  for (const want of ['#c0 sits in a version hidden in this frame', '0 versions shown', '2 versions shown', '2 heads shown']) if (!p.includes(want)) throw new Error('missed: ' + want + '\n' + p);
});

/* IP5.2: an episode's own credits, built from the invented fixture (the Dovetail Crew) to a temp folder, never into app/ambient */
{
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const { createRequire } = await import('node:module');
  const FIX = path.join(ROOT, 'tools', 'ambient', 'fixtures', 'episode-demo.json');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-episode-')), out = path.join(tmp, 'episode-credits.html');
  const local = path.join(ROOT, 'app', 'ambient', 'episode-credits.html'), stamp = () => (fs.existsSync(local) ? fs.statSync(local).mtimeMs : 'absent'), before = stamp();
  const run = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'ambient', 'scenes', 'credits.js'), '--episode', FIX, '--out', out], { cwd: ROOT, encoding: 'utf8' });
  const html = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  const ep = JSON.parse(fs.readFileSync(FIX, 'utf8'));
  /* one shot's markup: from its opening tag to the next shot's (the shots sit side by side in one svg) */
  const shotOf = (id) => { const a = html.indexOf('<g class="shot" id="' + id + '"'); if (a < 0) return ''; const b = html.indexOf('<g class="shot" id="', a + 10); return html.slice(a, b < 0 ? html.indexOf('</svg>', a) : b); };
  const T = (() => { const m = html.match(/const T=(\{[^}]*\});/); return m ? JSON.parse(m[1]) : {}; })();

  await test('episode: the fixture builds (no kit warning, nothing on stderr) to the path asked for, and app/ambient is not touched', () => {
    if (run.status !== 0) throw new Error('exit ' + run.status + '\n' + run.stderr);
    if (run.stderr.trim()) throw new Error('stderr: ' + run.stderr);
    if (!/^episode-credits\.html\s+\d+ KB\s*$/.test(run.stdout.trim())) throw new Error('stdout: ' + run.stdout);
    if (!/^\s*<!doctype html/i.test(html.slice(0, 200))) throw new Error('not a page');
    if (stamp() !== before) throw new Error('app/ambient/episode-credits.html changed');
  });

  await test('episode: every figure, every frame: one version per part, the head shown once, every id unique (the walkers among them)', () => {
    const r = walkScene(html, 'episode-credits.html');
    if (r.problems.length) throw new Error(r.problems.length + ' problem(s):\n  ' + r.problems.slice(0, 12).join('\n  '));
    for (const f of ['cr-tam', 'in-ada']) if (!html.includes('data-fig="' + f + '"')) throw new Error('no figure ' + f);
    console.log('     ' + r.figures + ' figure(s), ' + r.frames + ' figure-frames');
  });

  await test('episode: the one who leaves walks in a layer of their own, and is not in the line-up: a gap with their outline is', () => {
    const c2 = shotOf('c2'), lu = shotOf('lu');
    if (!/<svg class="ep mv wk" id="wkL"/.test(html) || !/id="wkL"[^>]*>[\s\S]*?data-fig="cr-tam"/.test(html)) throw new Error('the walker layer');
    if (/data-fig="cr-tam"/.test(c2)) throw new Error('the colour figure is still in the card shot');
    if (!/id="lvStamp"/.test(c2) || !c2.includes('ON THE RUN')) throw new Error('the stamp on the name card');
    if (!lu) throw new Error('no line-up shot');
    for (const id of ['nell', 'ray', 'octavia']) if (!lu.includes('data-id="' + id + '"')) throw new Error(id + ' is missing from the line-up');
    if (lu.includes('data-id="tam"')) throw new Error('the one who left is still in the line-up');
    if (lu.includes('data-id="ada"')) throw new Error('the newcomer is already in the line-up (they walk in)');
    if (!lu.includes('data-id="tam-oa"') || !lu.includes('data-id="tam-ob"')) throw new Error('no outline in the gap');
    const m = shotOf('m'), p2 = m.slice(m.indexOf('data-i="2"'), m.indexOf('data-i="3"'));
    if (!p2.includes('ON THE RUN') || /-grain\)/.test(p2) || !/-grain\)/.test(m.slice(m.indexOf('data-i="1"'), m.indexOf('data-i="2"')))) throw new Error('the montage keeps no empty panel');
  });

  await test('episode: the newcomer walks in after the title, and the held last frame is the freeze with them in it', () => {
    const lz = shotOf('lz');
    if (!lz) throw new Error('no freeze shot');
    if (!/<svg class="ep mv wk" id="wkN"[^>]*>[\s\S]*?data-fig="in-ada"/.test(html)) throw new Error('the newcomer layer');
    if (!/id="fzName"/.test(html) || !html.includes('>ADA VELL<') || !/id="fzStamp"[\s\S]*?>KIT</.test(html)) throw new Error('the name card and the player stamp');
    if (!html.includes("at(T.inFreeze,'lz')")) throw new Error('the freeze is not the last shot');
    if (!html.includes(ep.introducing.line)) throw new Error('the line');
  });

  await test('episode: the new beats in order, on the beat, inside the card and inside the theme’s 90 s; the fade after the freeze', async () => {
    const C = createRequire(import.meta.url)(path.join(ROOT, 'tools', 'ambient', 'scenes', 'credits.js'));
    const B = C.BEAT, card = T.crew0 + 2 * (T.crewLen + T.locLen);
    const seq = ['lvLook', 'lvCollar', 'lvWalk', 'lvGone', 'lvStamp'].map((k) => T[k]);
    if (seq.some((v, i) => !(typeof v === 'number') || (i && v <= seq[i - 1]))) throw new Error('out of order: ' + JSON.stringify(T));
    if (!(seq[0] > card + 4 && seq[4] < card + T.crewLen - 0.8)) throw new Error('the leaver beats leave the card: ' + seq.join(', '));
    const intro = ['inCut', 'inLine', 'inWalk', 'inStop', 'inFreeze', 'inStamp'].map((k) => T[k]);
    if (intro.some((v, i) => !(typeof v === 'number') || (i && v <= intro[i - 1])) || !(intro[0] > T.title + 3) || !(T.inFreeze < T.fade && T.fade < T.end && T.end === 90)) throw new Error('intro: ' + JSON.stringify(T));
    for (const v of seq.concat(intro)) { const n = (v - B.at) / B.len; if (Math.abs(n - Math.round(n)) > 0.01) throw new Error(v + ' s is not on the beat'); }
  });

  await test('episode: a bad file is refused with a reason (three in the cast, an unknown leaver, a colour that is not a token)', () => {
    const C = createRequire(import.meta.url)(path.join(ROOT, 'tools', 'ambient', 'scenes', 'credits.js'));
    const bad = (f, want) => { let e = null; try { C.episodeOf(f); } catch (x) { e = x; } if (!e || !want.test(e.message)) throw new Error('expected ' + want + ', got ' + (e && e.message)); };
    bad({ cast: ep.cast.slice(0, 3) }, /four entries/);
    bad(Object.assign({}, ep, { leaves: { id: 'nobody' } }), /not in the cast/);
    bad(Object.assign({}, ep, { cast: ep.cast.map((c, i) => (i ? c : Object.assign({}, c, { field: 'pink' }))) }), /no colour token/);
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* a lingering handle */ }
}

if (failed) { console.log('\n' + failed + ' failed'); process.exit(1); }
console.log('\nall ambient frame checks passed');
}
