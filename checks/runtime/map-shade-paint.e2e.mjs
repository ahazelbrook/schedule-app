// IP7 round 2 (map kit 1.2.0 r2: a room's solids that would sink behind a wall are painted in the WALLS layer): what that painting order could break,
// measured in a real browser on what is actually on top (document.elementFromPoint), for the demo site and the grand site. No Worker, no network.
//   1. People against solids: the people layer is painted after every piece of furniture and every wall, so a person in front of a solid is never painted
//      over by it; a person behind one is cut by an occluder (a <use> of the solid, in the people layer) that overlaps that person. Measured on the
//      figures' own paint (points inside each shape's fill): nothing but the person, an occluder, another person or a label is ever on top of it.
//      Crowd and the crew's figures, keyed and stage layouts.
//   2. Nothing that shows flat goes missing shaded: per piece kind, no more pieces are wholly hidden by the drawing (walls, other furniture) shaded than
//      flat, and the area that shows is at least 60% of flat. A piece under a room label counts as shown (the label is on top in both). The security
//      control room's monitor wall shows. Player and GM copies, no people.
//   3. Room labels, way-in tags, tokens and the people's flags sit above every solid and wall (shaded, with tokens).
//   KIT_SHOTS=<dir> writes the demo site's keyed map with people at 1x, flat and shaded.
//   PW_MODULE=<playwright-core> [PW_CHANNEL=msedge] [PW_ENGINE=webkit] [KIT_SHOTS=<dir>] node checks/runtime/map-shade-paint.e2e.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sites } from './fixtures/gm/map-kit1-cases.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SHOTS = process.env.KIT_SHOTS || '';
const ENGINE = process.env.PW_ENGINE === 'webkit' ? 'webkit' : 'chromium';
let failed = 0, passed = 0;
async function step(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); } }
const expect = (c, m) => { if (!c) throw new Error(m); };
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
if (!/^1\.2\./.test(K.VERSION)) { console.log('SKIP the vendored map kit is ' + K.VERSION + ': this suite is for 1.2 (shade)'); process.exit(0); }
const FK = require(path.join(ROOT, 'app', 'figures', 'figure-kit.js'));
const G = require(path.join(ROOT, 'app', 'gm', 'scene-state.js'));
const P = require(path.join(ROOT, 'app', 'gm-page.js'))._pure; P.sceneMod = G; P.kit1On = () => true;
const S = sites(), SITES = [['demo', S.pelican], ['grand', S.pelicanK1]];
const PCS = [{ id: 'pc1', name: 'Nell Arbuthnot', spec: { id: 'nell', name: 'Nell Arbuthnot', figure: 'fem', heightIn: 66, skin: 'olive', outfit: 'street' } },
  { id: 'pc2', name: 'Ray Okonjo', spec: { id: 'ray', name: 'Ray Okonjo', figure: 'masc', heightIn: 71, skin: 'brown', outfit: 'street' } }, { id: 'pc3', name: 'Tam Petrakis', spec: null }];
const CREW = { pc1: { room: 'Showroom' }, pc2: { room: 'Cocktail lounge' }, pc3: { room: 'Security control room' } };
const FL = (ks) => G.flags((id) => ks.some((k) => G.IDS[k] === id));
const SC = (ks) => ({ flags: FL(ks), pcs: PCS, crew: CREW, disguises: [], crowd: true, lights: {}, screen: 'tv', stage: G.stageOk(K), view: '', room: '', kit: FK });
const MAP = { layer: 'player', view: 'iso', theme: 'rulebook', reveal: { public: true, working: true }, open: [], know: [] };
const TOK = (room, t) => ({ room, label: 'Marker ' + t, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="#3a5bd0"/><text x="10" y="14" font-size="9" text-anchor="middle" fill="#fff">' + t + '</text></svg>' });
/* the player copy through the GM page's own path */
function player(roll, on, ks, tokens) { P.shadeOn = () => on; try { return P.playerDisplay(roll, MAP, K.render, { tokens: tokens || [], hide: [], sig: tokens ? 't' : '', scene: ks ? SC(ks) : undefined }).svg; } finally { P.shadeOn = () => false; } }
/* furniture only: no people, no tokens */
function bare(roll, on, layer) {
  const o = { view: 'iso', theme: 'rulebook', layer, reveal: layer === 'gm' ? ['public', 'working', 'controlled', 'secure'] : ['public', 'working'], layout: 'ipad', kit1: true };
  if (on) o.shade = true;
  return K.render(roll, o).svg;
}

const PW = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const browser = ENGINE === 'webkit' ? await PW.webkit.launch() : await PW.chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
/* the svg alone on a page, scaled so its width is W css px */
async function load(svg, W) {
  await page.setContent('<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:#fff}#m svg{display:block}</style><div id=m>' + svg + '</div>');
  await page.evaluate((w) => { const s = document.querySelector('#m svg'), vb = s.viewBox.baseVal; s.setAttribute('width', w); s.setAttribute('height', Math.round(w * vb.height / vb.width)); }, W);
  const h = await page.evaluate(() => Math.ceil(document.querySelector('#m svg').getBoundingClientRect().height));
  await page.setViewportSize({ width: W, height: Math.max(200, Math.min(h, 16000)) });
}
/* the kind of what is on top at an element: its ancestry's classes */
const KIND = `(t, own) => {
  if (!t) return 'none'; if (own && own.contains(t)) return 'self';
  for (let q = t; q && q.getAttribute; q = q.parentNode) {
    const c = q.getAttribute('class') || '';
    if (/\\bmap-occluder\\b/.test(c)) return 'occluder';
    if (/\\bmap-person\\b/.test(c)) return 'person';
    if (/\\b(room-label|map-entry|map-way-tag|map-person-flag|map-person-label|map-core-label|map-skip-tag|map-leader|map-landmark|map-people-more)\\b/.test(c)) return 'label';
    if (/fx-|\\bfurniture\\b|\\broom-furniture\\b/.test(c)) return 'furniture';
    if (q.tagName && q.tagName.toLowerCase() === 'svg' && q.parentNode && q.parentNode.id === 'm') break;
    if (q.tagName && q.tagName.toLowerCase() === 'svg' && q.parentNode && q.parentNode.closest && !q.parentNode.closest('.map-person')) return 'label';      /* a nested svg outside a person: a token */
  }
  return 'drawing';
}`;
const docOrder = () => page.evaluate(() => {
  const all = [...document.querySelectorAll('#m *')], idx = new Map(all.map((e, i) => [e, i]));
  const last = (sel) => Math.max(-1, ...[...document.querySelectorAll(sel)].filter((e) => !e.closest('.map-people')).map((e) => idx.get(e)));
  const first = (sel) => { const l = [...document.querySelectorAll(sel)].map((e) => idx.get(e)); return l.length ? Math.min(...l) : Infinity; };
  return { lastFurniture: last('[class*="fx-"], .furniture, .room-furniture'), firstPeople: first('.map-people'),
    occluderUsesOutside: [...document.querySelectorAll('use')].filter((u) => /-o[0-9a-z]+$/.test(u.getAttribute('href') || '') && !u.closest('.map-occluder')).length };
});
/* every person's own paint (points inside each shape's fill), and what is on top there */
const PEOPLE = (kindSrc) => {
  const kind = eval(kindSrc), out = [];
  const persons = [...document.querySelectorAll('.map-people .map-person')].filter((p) => !(p.parentNode && p.parentNode.closest && p.parentNode.closest('.map-person')));
  for (const p of persons) {
    const tally = { self: 0, occluder: 0, person: 0, label: 0, furniture: 0, drawing: 0, none: 0 };
    for (const s of p.querySelectorAll('path, rect, circle, ellipse, polygon')) {
      if (typeof s.isPointInFill !== 'function' || !s.getScreenCTM()) continue;
      const cs = getComputedStyle(s);      /* only paint: a shape with no fill (an outline, a hit area) lets the point fall through to what is behind */
      if (cs.fill === 'none' || cs.visibility === 'hidden' || +cs.fillOpacity === 0 || +cs.opacity === 0) continue;
      const b = s.getBoundingClientRect(); if (b.width < 1 || b.height < 1) continue;
      const inv = s.getScreenCTM().inverse();
      for (let i = 1; i < 4; i++) for (let j = 1; j < 4; j++) {
        const x = b.left + b.width * i / 4, y = b.top + b.height * j / 4;
        const u = new DOMPoint(x, y).matrixTransform(inv); if (!s.isPointInFill(u)) continue;
        const t = document.elementFromPoint(x, y);
        /* what is on top there and comes BEFORE the person in the document cannot be painted over it: the hit test missed a sub-pixel part of the shape
           (a bow tie's crossing, a hair-thin stroke of fill). Counted apart, never as painted over */
        if (t && !p.contains(t) && (p.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_PRECEDING) && !t.closest('.map-occluder')) { tally.miss = (tally.miss || 0) + 1; continue; }
        tally[kind(t, p)]++;
      }
    }
    out.push(tally);
  }
  const occ = [...document.querySelectorAll('.map-people .map-occluder')].filter((o) => !(o.parentNode && o.parentNode.closest && o.parentNode.closest('.map-occluder')));
  const overlaps = occ.map((o) => { let prev = o.previousElementSibling; while (prev && !/map-person/.test(prev.getAttribute('class') || '')) prev = prev.previousElementSibling; if (!prev) return null;
    const a = o.getBoundingClientRect(), b = prev.getBoundingClientRect(); return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; });
  return { out, occ: occ.length, overlaps };
};
/* per piece kind: pieces, pieces wholly hidden by the drawing (no point on top of themselves or under a label), and the area that shows (or is under a label) */
const PIECES = (kindSrc) => {
  const kind = eval(kindSrc), by = {};
  const pieces = [...document.querySelectorAll('[class*="fx-"]')].filter((e) => !e.closest('[opacity]') && !(e.parentNode && e.parentNode.closest && e.parentNode.closest('[class*="fx-"]')));
  for (const e of pieces) {
    const k = ((e.getAttribute('class') || '').match(/fx-[a-z0-9-]+/) || ['fx-?'])[0], r = e.getBoundingClientRect(); let self = 0, label = 0;
    if (r.width >= 1 && r.height >= 1) for (let i = 1; i < 7; i++) for (let j = 1; j < 7; j++) { const w = kind(document.elementFromPoint(r.left + r.width * i / 7, r.top + r.height * j / 7), e); if (w === 'self') self++; else if (w === 'label') label++; }
    const b = by[k] = by[k] || { pieces: 0, hidden: 0, area: 0 }; b.pieces++; if (!self && !label) b.hidden++; b.area += self;      /* area: its own paint on top (a piece under a label in both counts as neither) */
  }
  return by;
};

try {
  for (const [site, roll] of SITES) {
    /* ---------- 1. people against solids ---------- */
    for (const [lay, ks] of [['keyed', ['people']], ['stage', ['people', 'fill']]]) {
      const svg = player(roll, true, ks);
      await step('1 ' + site + ' ' + lay + ': the people layer is painted after every piece of furniture and every wall; occluders live only in it', async () => {
        await load(svg, 2400); const d = await docOrder();
        expect(d.firstPeople < Infinity, 'no people drawn');
        expect(d.lastFurniture >= 0, 'no furniture found: the order check would prove nothing');
        expect(d.lastFurniture < d.firstPeople, 'furniture painted after the people: ' + JSON.stringify(d));
        expect(d.occluderUsesOutside === 0, 'an occluder outside the people layer');
      });
      await step('1 ' + site + ' ' + lay + ': on every person\'s own paint only the person, an occluder, another person or a label is on top; each occluder overlaps its person', async () => {
        const r = await page.evaluate(PEOPLE, KIND), sum = (k) => r.out.reduce((s, x) => s + x[k], 0);
        console.log('INFO ' + site + ' ' + lay + ': ' + r.out.length + ' people, ' + r.out.reduce((s, x) => s + Object.values(x).reduce((a, b) => a + b, 0), 0) + ' points of their paint: self ' + sum('self')
          + ', under an occluder ' + sum('occluder') + ', under another person ' + sum('person') + ', under a label ' + sum('label') + ', under furniture ' + sum('furniture') + ', under the drawing ' + sum('drawing') + ' (sub-pixel misses ' + r.out.reduce((s, x) => s + (x.miss || 0), 0) + '); ' + r.occ + ' occluders');
        expect(sum('furniture') === 0 && sum('drawing') === 0, 'a person painted over by furniture or the drawing: ' + JSON.stringify(r.out.filter((x) => x.furniture || x.drawing).slice(0, 3)));
        expect(sum('self') > 0.5 * r.out.reduce((s, x) => s + Object.values(x).reduce((a, b) => a + b, 0), 0), 'most of the people\'s paint is on top');
        expect(r.occ >= 1, 'no occluders: nobody stands behind a solid, so the cut is not tested');
        expect(r.overlaps.every((v) => v === true), 'an occluder with no person before it, or one that does not overlap that person: ' + JSON.stringify(r.overlaps));
      });
    }
    /* ---------- 3. labels, tags and tokens on top ---------- */
    await step('3 ' + site + ': room labels, way-in tags and tokens sit above every solid and wall (shaded, with tokens)', async () => {
      await load(player(roll, true, null, [TOK('Showroom', 'NA'), TOK('Cocktail lounge', 'RO'), TOK('Security control room', 'TP')]), 2400);
      const r = await page.evaluate((kindSrc) => {
        const kind = eval(kindSrc);
        const items = [...document.querySelectorAll('.room-label, .map-entry, .map-way-tag, .map-person-flag')].filter((e, i, a) => !a.some((x) => x !== e && x.contains(e)));
        const toks = [...document.querySelectorAll('#m svg svg')].filter((s) => /^(NA|RO|TP)$/.test((s.textContent || '').trim()));
        /* the whole stack at the centre of each of their shapes, top first: where the label (or token) is in the stack, nothing of the map's drawing
           (a wall, a floor), no furniture and no occluder may be above it. A centre that misses the shape's paint (the label is not in the stack) is skipped */
        const bad = []; let n = 0, miss = 0;
        for (const e of items.concat(toks)) for (const s of e.querySelectorAll('rect, path, circle, text, polygon')) {
          const b = s.getBoundingClientRect(); if (b.width < 2 || b.height < 2) continue;
          const st = document.elementsFromPoint(b.left + b.width / 2, b.top + b.height / 2), i = st.findIndex((x) => e.contains(x));
          if (i < 0) { miss++; continue; }
          n++;
          for (const x of st.slice(0, i)) { const w = kind(x, e); if (w === 'furniture' || w === 'occluder' || w === 'drawing') { bad.push((e.getAttribute('class') || 'token') + ' under ' + w); break; } }
        }
        return { items: items.length, toks: toks.length, n, miss, bad };
      }, KIND);
      console.log('INFO ' + site + ': ' + r.items + ' labels and tags, ' + r.toks + ' tokens, ' + r.n + ' of their shapes tested (' + r.miss + ' centres off their paint)');
      expect(r.items >= 1, 'labels and tags drawn: ' + r.items);
      expect(r.n >= 10, 'shapes tested: ' + r.n);
      expect(r.toks >= 2, 'tokens drawn: ' + r.toks);
      expect(!r.bad.length, r.bad.slice(0, 5).join(' | '));
    });
    /* ---------- 2. nothing that shows flat goes missing shaded ---------- */
    for (const layer of ['player', 'gm']) {
      await step('2 ' + site + ' ' + layer + ' copy: per kind, no more pieces wholly hidden shaded than flat, and at least 60% of the area shows', async () => {
        await load(bare(roll, false, layer), 2400); const flat = await page.evaluate(PIECES, KIND);
        await load(bare(roll, true, layer), 2400); const shaded = await page.evaluate(PIECES, KIND);
        const bad = [], rows = [];
        for (const k of Object.keys(flat)) {
          const a = flat[k], b = shaded[k] || { pieces: 0, hidden: a.pieces, area: 0 };
          rows.push(k + ' hidden ' + a.hidden + '->' + b.hidden + '/' + a.pieces + ', area ' + a.area + '->' + b.area);
          if (b.hidden > a.hidden) bad.push(k + ': ' + a.hidden + ' hidden flat, ' + b.hidden + ' shaded');
          if (a.area >= 6 && b.area < 0.6 * a.area) bad.push(k + ': area ' + a.area + ' flat, ' + b.area + ' shaded');
        }
        console.log('INFO ' + site + ' ' + layer + ': ' + rows.join('; '));
        expect(!bad.length, bad.join(' | '));
        if (flat['fx-monitor-wall']) expect(shaded['fx-monitor-wall'] && !shaded['fx-monitor-wall'].hidden && shaded['fx-monitor-wall'].area > 0, 'the monitor wall shows');
      });
    }
  }
  if (SHOTS) for (const on of [false, true]) { await load(player(S.pelican, on, ['people']), 1180); await page.screenshot({ path: path.join(SHOTS, 'pelican-keyed-people-1x-' + (on ? 'on' : 'off') + '-' + ENGINE + '.png'), fullPage: true }); }
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
await browser.close();
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
