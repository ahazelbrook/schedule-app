// Unit test for app/display-page.js (the table display, #display): the pure parts only, in plain Node, no browser, no deps.
// Covered: the SVG sanitiser (against malicious samples, run on a small XML parser stub that stands in for DOMParser), the
// poll / backoff state machine (fake gm, fake timers), the transcriber part of the display answer and app/stt.js taking it
// (and its fallback GET), the display -> view-model mapping (an npc push never carries gmNotes), the zoom maths and the
// corner-status text. The DOM layer (mount, gestures, fade, wake lock) needs a browser and is left to the Playwright run.
// Invented fixtures only.
//   node checks/runtime/display.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const D = require(path.join(ROOT, 'app', 'display-page.js'));
const P = D.Pure;

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const flush = () => new Promise((r) => setImmediate(r));

/* ---------- a small XML parser standing in for DOMParser('image/svg+xml') ---------- */
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
  });
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function mkNode(type, name) {
  const n = { nodeType: type, nodeName: name, childNodes: [], parentNode: null, attributes: [] };
  n.localName = name && name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
  n.tagName = name;
  n.getAttribute = (k) => { const a = n.attributes.find((x) => x.name === k); return a ? a.value : null; };
  n.setAttribute = (k, v) => { const a = n.attributes.find((x) => x.name === k); if (a) a.value = String(v); else n.attributes.push({ name: k, value: String(v) }); };
  n.removeAttribute = (k) => { n.attributes = n.attributes.filter((x) => x.name !== k); };
  n.removeChild = (c) => { n.childNodes = n.childNodes.filter((x) => x !== c); c.parentNode = null; return c; };
  n.insertBefore = (c, ref) => { if (c.parentNode) c.parentNode.removeChild(c); const i = n.childNodes.indexOf(ref); n.childNodes.splice(i < 0 ? n.childNodes.length : i, 0, c); c.parentNode = n; return c; };
  Object.defineProperty(n, 'firstChild', { get() { return n.childNodes[0] || null; } });
  Object.defineProperty(n, 'textContent', { get() { return n.nodeType === 3 || n.nodeType === 4 ? n._text : n.nodeType === 8 ? '' : n.childNodes.map((c) => c.textContent).join(''); } });
  return n;
}
class FakeDOMParser {
  parseFromString(src) {
    const bad = () => { const d = { documentElement: mkNode(1, 'parsererror'), getElementsByTagName: () => [1] }; return d; };
    const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!(?:DOCTYPE|ENTITY)[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/gy;
    let m, top = null; const stack = [];
    while (re.lastIndex < src.length) {
      const at = re.lastIndex; m = re.exec(src);
      if (!m) return bad();
      const whole = m[0];
      if (whole.startsWith('<!--')) { const c = mkNode(8, '#comment'); c._text = whole; if (stack.length) { c.parentNode = stack[stack.length - 1]; c.parentNode.childNodes.push(c); } continue; }
      if (whole.startsWith('<![CDATA[')) { const t = mkNode(4, '#cdata'); t._text = whole.slice(9, -3); if (stack.length) { t.parentNode = stack[stack.length - 1]; t.parentNode.childNodes.push(t); } continue; }
      if (whole.startsWith('<?') || whole.startsWith('<!')) continue;
      if (m[1] !== undefined) { const o = stack.pop(); if (!o || o.nodeName !== m[1]) return bad(); continue; }
      if (m[2] !== undefined) {
        const n = mkNode(1, m[2]);
        for (const a of m[3].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) n.attributes.push({ name: a[1], value: decode(a[2] !== undefined ? a[2] : a[3]) });
        if (stack.length) { n.parentNode = stack[stack.length - 1]; n.parentNode.childNodes.push(n); } else if (top) return bad(); else top = n;
        if (!m[4]) stack.push(n);
        continue;
      }
      if (m[5] !== undefined) {
        if (!stack.length) { if (m[5].trim()) return bad(); continue; }
        const t = mkNode(3, '#text'); t._text = decode(m[5]); t.parentNode = stack[stack.length - 1]; t.parentNode.childNodes.push(t);
      }
      if (re.lastIndex === at) return bad();
    }
    if (stack.length || !top) return bad();
    return { documentElement: top, getElementsByTagName: () => [] };
  }
}
class FakeXMLSerializer {
  serializeToString(n) {
    if (n.nodeType === 3) return esc(n._text);
    if (n.nodeType === 4) return '<![CDATA[' + n._text + ']]>';
    if (n.nodeType === 8) return n._text;
    const a = n.attributes.map((x) => ' ' + x.name + '="' + esc(x.value) + '"').join('');
    const kids = n.childNodes.map((c) => this.serializeToString(c)).join('');
    return '<' + n.nodeName + a + (kids ? '>' + kids + '</' + n.nodeName + '>' : '/>');
  }
}
const ENV = { DOMParser: FakeDOMParser, XMLSerializer: FakeXMLSerializer };
const clean = (svg) => P.sanitiseSvg(svg, ENV);

/* the things that must never survive in markup */
const FORBIDDEN = [/<script/i, /<foreignObject/i, /<iframe/i, /<object/i, /<embed/i, /\son[a-z]+\s*=/i, /javascript:/i, /@import/i, /(?:href|src)="(?!#|data:image\/)/i, /url\(\s*['"]?(?!#|data:image\/)/i];
function assertClean(markup, what) { for (const re of FORBIDDEN) assert.ok(!re.test(markup), what + ': markup still matches ' + re + '\n' + markup); }

const GOOD = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 400 300" width="800" height="600">' +
  '<defs><linearGradient id="g"><stop offset="0" stop-color="#112233"/></linearGradient><style>.a{fill:url(#g);font-family:"Fixture Sans"}</style></defs>' +
  '<rect id="r" class="a" x="10" y="10" width="100" height="50" fill="url(#g)"/><use href="#r" x="5"/><use xlink:href="#r"/>' +
  '<image href="data:image/png;base64,AAAA" width="10" height="10"/><text x="20" y="40">Fixture &amp; &lt;room&gt;</text></svg>';

await test('sanitiser keeps a clean map and normalises its size', () => {
  const r = clean(GOOD);
  assert.equal(r.ok, true);
  assert.deepEqual(r.viewBox, { x: 0, y: 0, w: 400, h: 300 });
  assert.equal(r.node.getAttribute('width'), null);
  assert.equal(r.node.getAttribute('height'), null);
  assert.equal(r.node.getAttribute('preserveAspectRatio'), 'xMidYMid meet');
  for (const keep of ['<rect', 'href="#r"', 'xlink:href="#r"', 'url(#g)', 'data:image/png;base64,AAAA', 'Fixture &amp; &lt;room&gt;', '.a{fill:url(#g)']) assert.ok(r.markup.includes(keep), 'kept: ' + keep);
  assertClean(r.markup, 'good map');
});

await test('sanitiser derives a viewBox from width and height, and refuses a map with neither', () => {
  const r = clean('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="1" height="1"/></svg>');
  assert.equal(r.ok, true); assert.deepEqual(r.viewBox, { x: 0, y: 0, w: 640, h: 480 });
  assert.equal(clean('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>').ok, false);
  assert.equal(clean('<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><rect/></svg>').ok, false);
});

const wrap = (inner, attrs = '') => '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"' + attrs + '>' + inner + '</svg>';

await test('script elements are removed with their text', () => {
  const r = clean(wrap('<g><script>alert(1)</script><rect id="ok"/></g><script type="text/javascript"><![CDATA[ fetch("https://evil.test") ]]></script>'));
  assert.equal(r.ok, true); assertClean(r.markup, 'script'); assert.ok(r.markup.includes('id="ok"')); assert.ok(!/alert|evil/.test(r.markup));
});
await test('on* attributes are removed everywhere (onload, onclick, onmouseover, mixed case)', () => {
  const r = clean(wrap('<rect onclick="x()" ONMOUSEOVER="x()" width="1"/><g onfocus="x()"><circle onerror="x()" r="2"/></g>', ' onload="x()"'));
  assert.equal(r.ok, true); assertClean(r.markup, 'on*'); assert.ok(r.markup.includes('width="1"') && r.markup.includes('r="2"'));
});
await test('foreignObject goes, and takes its HTML with it', () => {
  const r = clean(wrap('<foreignObject width="5" height="5"><div xmlns="http://www.w3.org/1999/xhtml"><iframe src="https://evil.test"/><p>hi</p></div></foreignObject><rect id="ok"/>'));
  assert.equal(r.ok, true); assertClean(r.markup, 'foreignObject'); assert.ok(!r.markup.includes('<div') && !r.markup.includes('hi')); assert.ok(r.markup.includes('id="ok"'));
});
await test('iframe, object, embed, link, meta, base, form, audio and video are removed', () => {
  const r = clean(wrap('<iframe src="x"/><object data="x"/><embed src="x"/><link href="x"/><meta content="x"/><base href="x"/><form action="x"/><audio src="x"/><video src="x"/><rect id="ok"/>'));
  assert.equal(r.ok, true); assertClean(r.markup, 'html elements');
  for (const n of ['iframe', 'object', 'embed', 'link', 'meta', 'base', 'form', 'audio', 'video']) assert.ok(!r.markup.includes('<' + n), n);
});
await test('external href / xlink:href / src are removed; #fragment and data:image stay', () => {
  const r = clean(wrap('<image href="https://evil.test/a.png"/><image xlink:href="//evil.test/b.png"/><use href="http://evil.test/x.svg#a"/><a href="https://evil.test"><rect/></a><image src="https://evil.test"/>' +
    '<use href="#local"/><image href="data:image/png;base64,AAA"/><image href="data:text/html;base64,AAA"/><image href="/relative.png"/>'));
  assert.equal(r.ok, true); assertClean(r.markup, 'hrefs');
  assert.ok(r.markup.includes('href="#local"') && r.markup.includes('data:image/png;base64,AAA'));
  assert.ok(!r.markup.includes('relative.png') && !r.markup.includes('data:text/html'));
});
await test('javascript: is refused outright, plainly or smuggled with whitespace', () => {
  assert.equal(clean(wrap('<a href="javascript:alert(1)"><rect/></a>')).ok, false);
  assert.equal(clean(wrap('<a href="JaVa\tScRiPt:alert(1)"><rect/></a>')).ok, false);
  assert.equal(clean(wrap('<a href="vbscript:x"><rect/></a>')).ok, false);
});
await test('entity-encoded javascript: is caught after parsing, and the attribute dropped', () => {
  const r = clean(wrap('<a href="java&#115;cript:alert(1)"><rect/></a><rect id="ok"/><a xlink:href="&#x6a;avascript&#58;alert(1)"><rect/></a>'));
  assert.equal(r.ok, true); assertClean(r.markup, 'encoded'); assert.ok(r.markup.includes('id="ok"'));
});
await test('style: @import and external url() remove the element; benign CSS stays', () => {
  const bad = ['@import url("https://evil.test/a.css"); .a{fill:red}', '@import "x.css";', '.a{background:url(https://evil.test/p.png)}', '.a{fill:url( "//evil.test/x" )}', '.a{fill:expression(alert(1))}', '.\\75rl{x:y}', '.a{-moz-binding:url(x)}'];
  for (const css of bad) {
    const r = clean(wrap('<style>' + css + '</style><rect id="ok"/>'));
    assert.equal(r.ok, true, css); assert.ok(!r.markup.includes('<style'), 'style kept for ' + css); assertClean(r.markup, css); assert.ok(r.markup.includes('id="ok"'));
  }
  const good = clean(wrap('<style>.a{fill:#123;stroke:url(#g)} @font-face-not{}</style><rect class="a"/>'));
  assert.ok(good.markup.includes('<style') && good.markup.includes('stroke:url(#g)'));
  const cdata = clean(wrap('<style><![CDATA[ @import url(https://evil.test/x.css); ]]></style><rect/>'));
  assert.ok(!cdata.markup.includes('<style'));
});
await test('style attributes and presentation attributes with external urls are removed', () => {
  const r = clean(wrap('<rect style="fill:url(https://evil.test/a)" id="a"/><rect fill="url(https://evil.test/b)" id="b"/><rect style="fill:red" id="c"/><rect filter="url(#f)" id="d"/><rect style="background:url(javascript:x)"/>'.replace('javascript:x', 'data:text/html,x')));
  assert.equal(r.ok, true); assertClean(r.markup, 'style attrs');
  assert.ok(r.markup.includes('style="fill:red"') && r.markup.includes('filter="url(#f)"'));
});
await test('animations that target href are removed; harmless ones stay', () => {
  const r = clean(wrap('<a href="#x"><animate attributeName="href" values="https://evil.test"/><set attributeName="xlink:href" to="https://evil.test"/></a><rect><animate attributeName="opacity" values="0;1" dur="1s"/></rect>'));
  assert.equal(r.ok, true); assertClean(r.markup, 'animate');
  assert.ok(!/attributeName="(xlink:)?href"/.test(r.markup)); assert.ok(r.markup.includes('attributeName="opacity"'));
});
await test('comments, DOCTYPE and ENTITY are not carried', () => {
  assert.equal(clean('<!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>').ok, false);
  const r = clean(wrap('<!-- <script>alert(1)</script> --><rect/>'));
  assert.equal(r.ok, true); assert.ok(!r.markup.includes('<!--'));
});
await test('malformed, non-svg, oversized and non-string input is rejected', () => {
  assert.equal(clean('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g></svg>').ok, false);
  assert.equal(clean('<html><body/></html>').ok, false);
  assert.equal(clean('hello').ok, false);
  assert.equal(clean('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">' + 'a'.repeat(P.LIMITS.svgChars) + '</svg>').ok, false);
  for (const v of [null, undefined, 42, {}, []]) assert.equal(clean(v).ok, false);
  assert.equal(P.sanitiseSvg(GOOD, {}).ok, false);
});
await test('a map that forgot its namespaces gets them (an XML parser would otherwise draw nothing)', () => {
  const r = clean('<svg viewBox="0 0 5 5"><image xlink:href="#a"/><rect id="a"/></svg>');
  assert.equal(r.ok, true);
  assert.ok(r.markup.includes('xmlns="http://www.w3.org/2000/svg"') && r.markup.includes('xmlns:xlink="http://www.w3.org/1999/xlink"'));
  const had = clean('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5 5"><rect/></svg>');
  assert.equal((had.markup.match(/xmlns=/g) || []).length, 1, 'no second xmlns');
  assert.equal(P.sanitiseSvg('<svg viewBox="0 0 1 1">' + 'a'.repeat(800000) + '</svg>', { DOMParser: FakeDOMParser, maxChars: 900000 }).ok, true, 'a larger cap can be passed for the kit');
});
await test('a combined attack leaves nothing active', () => {
  const r = clean('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 50 50" onload="x()">' +
    '<script>x()</script><style>@import url(https://evil.test/x.css);</style><foreignObject><div/></foreignObject>' +
    '<g onclick="x()"><image href="https://evil.test/p.png" onerror="x()"/><use xlink:href="https://evil.test/s.svg#a"/><rect fill="url(https://evil.test/f)" width="3" height="3"/></g></svg>');
  assert.equal(r.ok, true); assertClean(r.markup, 'combined'); assert.ok(r.markup.includes('<g'));
});

/* parity with the server's checkSvg (functions/_lib/gm.js; checks/api/gm.mjs sends the same payloads) */
await test('parity: namespaced script/foreignObject/iframe/style, <a>, xml:base, backslashes, image-set(), src(), data: on <use> are stripped', () => {
  const r = clean(wrap('<x:script xmlns:x="http://www.w3.org/2000/svg">alert(1)</x:script>' +
    '<x:foreignObject xmlns:x="http://www.w3.org/2000/svg"><p>hi</p></x:foreignObject>' +
    '<h:iframe xmlns:h="http://www.w3.org/1999/xhtml" src="https://evil.test"/>' +
    '<h:style xmlns:h="http://www.w3.org/1999/xhtml">@import url(https://evil.test/x.css);</h:style>' +
    '<a href="#ok"><rect id="inlink"/></a>' +
    '<g xml:base="https://evil.test/"><rect id="b1"/></g>' +
    '<rect id="bs" fill="u\\72l(https://evil.test/x)" style="fill:red"/>' +
    '<rect id="iset" style="background:image-set(&quot;https://evil.test/a.png&quot; 1x)"/>' +
    '<rect id="srcfn" style="background:src(&quot;https://evil.test/a.png&quot;)"/>' +
    '<use id="usedata" href="data:image/png;base64,AAAA"/>' +
    '<image id="svgdata" href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/>' +
    '<image id="png" href="data:image/png;base64,AAAA"/><feImage id="fe" href="data:image/webp;base64,AAAA"/>' +
    '<style>.a{fill:url(data:image/png;base64,AAAA)}</style><rect id="ok"/>'));
  assert.equal(r.ok, true); assertClean(r.markup, 'parity');
  for (const gone of ['alert', '<p>', 'iframe', 'evil.test', '<a ', 'inlink', 'xml:base', 'u\\72l', 'image-set', 'src(', 'svg+xml', 'url(data:']) assert.ok(!r.markup.includes(gone), 'still has ' + gone + '\n' + r.markup);
  assert.ok(!/id="usedata"[^>]*href/.test(r.markup), 'a data: href on <use> survived');
  assert.ok(/id="png"[^>]*href="data:image\/png/.test(r.markup) && /id="fe"[^>]*href="data:image\/webp/.test(r.markup), 'raster data on <image>/<feImage> stays');
  assert.ok(r.markup.includes('id="ok"') && r.markup.includes('id="b1"'), 'the rest stays');
});

/* the real map kit's output, every view and theme, through the sanitiser (needs the git-ignored pack; skipped without it) */
await test('the map kit output (real pack, player layer) loses nothing to the sanitiser', () => {
  const packPath = path.join(ROOT, 'gm-private', 'b68-gm-pack.json');
  if (!fs.existsSync(packPath)) { console.log('     skipped: no gm-private/b68-gm-pack.json'); return; }
  const pk = JSON.parse(fs.readFileSync(packPath, 'utf8')).parts.location;
  const L = require(path.join(ROOT, 'app', 'gm', 'location.js')), M = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
  let n = 0;
  for (let s = 1; s <= 6; s++) {
    const roll = L.generate(pk, {}, { seed: s * 104729, mem: {} });
    for (const view of ['rings', 'plan', 'iso', 'section']) for (const theme of ['rulebook', 'blueprint', 'casefile', 'board']) {
      const svg = M.render(roll, { view, theme, layer: 'player', reveal: ['public'], width: 1400 }).svg;
      const doc = new FakeDOMParser().parseFromString(svg.replace(/<svg(?=[\s>])/, '<svg'));
      if (!doc.documentElement || doc.documentElement.nodeName === 'parsererror') continue;   // the stub parser is strict; the browser run covers the rest
      const removed = P.cleanElement(doc.documentElement); n++;
      assert.equal(removed, 0, view + '/' + theme + ': the sanitiser removed ' + removed + ' thing(s) from a kit map');
    }
  }
  assert.ok(n > 0, 'no map parsed'); console.log('     ' + n + ' of 96 kit maps parsed and cleaned');
});

/* real figure-kit output goes through the sanitiser too (the NPC portrait), so it must survive it */
await test('the figure kit output survives the sanitiser (an NPC portrait and a full figure)', () => {
  const K = require(path.join(ROOT, 'app', 'figures', 'figure-kit.js'));
  const canon = require(path.join(ROOT, 'app', 'figures', 'cast.js'));
  const spec = JSON.parse(JSON.stringify(canon.npcs[0]));
  spec.id = 'dp-test';
  for (const draw of [(s) => K.render(s, { height: 900 }), (s) => K.portrait(s, { lod: 'mid' })]) {
    const out = draw(JSON.parse(JSON.stringify(spec)));
    const r = clean(out.svg);
    assert.equal(r.ok, true, 'kit output rejected: ' + (r.reason || ''));
    assertClean(r.markup, 'kit');
    assert.ok(r.markup.length > out.svg.length * 0.9, 'sanitiser removed a lot of the figure: ' + r.markup.length + ' of ' + out.svg.length);
  }
});

/* ---------- display -> view model ---------- */
const SECRET = 'GM-ONLY-SECRET-xyzzy';
const NPC_DOC = { name: 'Vera Fixture', alias: 'Quill', role: 'Clerk', faction: 'The Registry', description: 'A tidy person with ink on her cuffs.', spec: { heightIn: 66 },
  revealed: false, firstSeen: null, tags: ['tag-' + SECRET], gmNotes: 'Secret: ' + SECRET, extra: SECRET, nested: { gmNotes: SECRET } };

await test('npc view model carries player fields only, never gmNotes', () => {
  const vm = P.viewModel({ kind: 'npc', npcId: 'vera', title: 'Vera', gmNotes: SECRET }, NPC_DOC);
  assert.equal(vm.kind, 'npc'); assert.equal(vm.found, true);
  assert.equal(vm.name, 'Vera Fixture'); assert.equal(vm.alias, 'Quill'); assert.equal(vm.sub, 'Clerk · The Registry'); assert.equal(vm.description, NPC_DOC.description);
  assert.ok(!JSON.stringify(vm).includes(SECRET), 'a secret reached the view model');
  assert.ok(!('gmNotes' in vm) && !('tags' in vm) && !('revealed' in vm));
  assert.deepEqual(Object.keys(P.playerNpc(NPC_DOC)).sort(), ['alias', 'description', 'faction', 'name', 'role', 'spec']);
});
await test('npc not found: title only', () => {
  for (const doc of [null, undefined, 'x', [], 5]) {
    const vm = P.viewModel({ kind: 'npc', npcId: 'gone', title: 'Someone' }, doc);
    assert.equal(vm.found, false); assert.equal(vm.title, 'Someone'); assert.ok(!('description' in vm) && !('name' in vm));
  }
});
await test('npc with a missing name falls back to the pushed title; long fields are capped', () => {
  const vm = P.viewModel({ kind: 'npc', npcId: 'a', title: 'Pushed title' }, { description: 'x'.repeat(5000), gmNotes: SECRET });
  assert.equal(vm.name, 'Pushed title'); assert.equal(vm.description.length, 2000); assert.ok(!JSON.stringify(vm).includes(SECRET));
});
await test('svg, text and blank view models; unknown and malformed pushes draw as blank', () => {
  assert.deepEqual(P.viewModel({ kind: 'svg', title: 'T', caption: 'C', svg: '<svg/>' }), { kind: 'svg', title: 'T', caption: 'C', svg: '<svg/>' });
  const t = P.viewModel({ kind: 'text', title: 'Kicker', text: 'Hello' });
  assert.equal(t.kind, 'text'); assert.equal(t.title, 'Kicker'); assert.equal(t.text, 'Hello'); assert.equal(t.size, 'xl');
  for (const d of [{ kind: 'blank' }, { kind: 'wat' }, { kind: 'svg' }, { kind: 'svg', svg: 5 }, null, undefined, 'x', [], 7, {}]) assert.deepEqual(P.viewModel(d), { kind: 'blank' });
  assert.equal(P.viewModel({ kind: 'text', text: 7 }).text, '');
});
await test('text size steps down as the text grows', () => {
  assert.deepEqual(['a', 'a'.repeat(200), 'a'.repeat(500), 'a'.repeat(1500)].map(P.textSize), ['xl', 'l', 'm', 's']);
});

/* ---------- zoom maths ---------- */
await test('zoom: fit is the whole map, in the frame\'s aspect', () => {
  const V = { x: 0, y: 0, w: 400, h: 300 }, size = { w: 1024, h: 768 };
  const w = P.viewWindow(V, size, { s: 1, cx: 0, cy: 0 });
  assert.ok(Math.abs(w.x) < 1e-9 && Math.abs(w.y) < 1e-9 && Math.abs(w.w - 400) < 1e-9 && Math.abs(w.h - 300) < 1e-9);
  const wide = P.viewWindow(V, { w: 2000, h: 500 }, { s: 1 });                       // a wide frame shows extra margin, centred
  assert.ok(Math.abs(wide.h - 300) < 1e-9 && wide.w > 400 && Math.abs(wide.x + wide.w / 2 - 200) < 1e-9);
});
await test('zoom: pinch keeps the point under the fingers, clamps scale and pan', () => {
  const V = { x: 0, y: 0, w: 400, h: 300 }, size = { w: 800, h: 600 };              // k0 = 2
  const start = { s: 1, cx: 200, cy: 150, d: 100, px: 100, py: 0 };                  // midpoint 100 px right of centre: map x = 250
  const z = P.pinchView(V, size, start, { d: 200, px: 100, py: 0 });                 // fingers spread 2x, same midpoint
  assert.ok(Math.abs(z.s - 2) < 1e-9);
  assert.ok(Math.abs(z.cx + 100 / (2 * z.s) - 250) < 1e-9, 'point under the fingers moved');
  assert.equal(P.pinchView(V, size, start, { d: 1e6, px: 0, py: 0 }).s, P.MAXZOOM);
  assert.equal(P.pinchView(V, size, start, { d: 1, px: 0, py: 0 }).s, 1);
  const far = P.clampView(V, size, { s: 4, cx: -999, cy: 9999 });                    // pan far off: held to the map's edge
  const w = P.viewWindow(V, size, far);
  assert.ok(w.x >= -1e-9 && w.y + w.h <= 300 + 1e-9);
  const back = P.pinchView(V, size, { s: 3, cx: 100, cy: 100, d: 100, px: 0, py: 0 }, { d: 10, px: 0, py: 0 });
  assert.equal(back.s, 1); assert.ok(Math.abs(back.cx - 200) < 1e-9 && Math.abs(back.cy - 150) < 1e-9, 'fit recentres');
});
await test('zoom: one finger pans (same distance, midpoint moved)', () => {
  const V = { x: 0, y: 0, w: 400, h: 300 }, size = { w: 800, h: 600 };
  const z = P.pinchView(V, size, { s: 4, cx: 200, cy: 150, d: 1, px: 0, py: 0 }, { d: 1, px: 80, py: 0 });   // drag right 80 px at k = 8: map moves right, so the centre moves left by 10
  assert.ok(Math.abs(z.cx - 190) < 1e-9 && Math.abs(z.cy - 150) < 1e-9);
});

/* ---------- the poller ---------- */
function clock() {
  let now = 0, id = 0; const q = [];
  return {
    setTimeout(fn, ms) { q.push({ id: ++id, at: now + ms, fn }); return id; },
    clearTimeout(i) { const k = q.findIndex((t) => t.id === i); if (k >= 0) q.splice(k, 1); },
    get now() { return now; },
    pending() { return q.length; },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await flush();
        q.sort((a, b) => a.at - b.at || a.id - b.id);
        if (!q.length || q[0].at > end) break;
        const t = q.shift(); now = Math.max(now, t.at); t.fn();
      }
      now = end; await flush();
    }
  };
}
/* the beats, written out here and not read from the page: the Workers Free budget (100,000 requests a day) is what they are for */
const BEAT = 4000, SLOW = 10000, IDLE = 15000, HIDDEN = 60000, IDLE_AFTER = 2 * 3600 * 1000;
function rig(over = {}) {
  const c = clock(), calls = [], data = [], states = [];
  const g = { hidden: false, handler: null };
  const poller = P.createPoller(Object.assign({
    timers: c, now: () => c.now, fetch: (seq, aseq, sseq) => { calls.push({ seq, at: c.now }); return g.handler(seq, aseq, sseq); },
    onData: (d, seq, at) => data.push({ d, seq, at }), onStatus: (s) => states.push(s.state), isHidden: () => g.hidden
  }, over));
  return { c, calls, data, states, g, poller };
}
const ok = (seq, display) => ({ seq, display: display || { kind: 'blank', title: '', caption: '' }, updatedAt: '2026-10-17T09:00:00.000Z' });

await test('poller: the beats are 4 s, 15 s after two hours of nothing, 10 s when failing and a minute when hidden', () => {
  assert.deepEqual(P.POLL, { intervalMs: BEAT, idleMs: IDLE, idleAfterMs: IDLE_AFTER, slowMs: SLOW, hiddenMs: HIDDEN });
});
await test('poller: first request has no seq, then every 4 s, passing the seq it holds', async () => {
  const r = rig(); let n = 0; r.g.handler = (seq) => Promise.resolve(seq === null ? ok(3, { kind: 'text', text: 'a' }) : { seq: 3, unchanged: true });
  r.poller.start(); await r.c.advance(0);
  assert.deepEqual(r.calls.map((x) => x.seq), [null]); assert.equal(r.data.length, 1); assert.equal(r.data[0].seq, 3);
  await r.c.advance(3999); assert.equal(r.calls.length, 1);
  await r.c.advance(1); assert.equal(r.calls.length, 2); assert.equal(r.calls[1].seq, 3);
  await r.c.advance(12000); assert.deepEqual(r.calls.map((x) => x.at), [0, 4000, 8000, 12000, 16000]);
  assert.equal(r.data.length, 1, 'unchanged must not redraw');
  assert.equal(r.poller.state(), 'live'); r.poller.stop();
});
await test('poller: a new seq calls onData once with the display and updatedAt', async () => {
  const r = rig(); let cur = 1;
  r.g.handler = (seq) => Promise.resolve(seq === cur ? { seq: cur, unchanged: true } : ok(cur, { kind: 'text', text: 'v' + cur }));
  r.poller.start(); await r.c.advance(0); cur = 2; await r.c.advance(BEAT); await r.c.advance(BEAT);
  assert.deepEqual(r.data.map((x) => [x.seq, x.d.text]), [[1, 'v1'], [2, 'v2']]); assert.equal(r.data[1].at, '2026-10-17T09:00:00.000Z');
  r.poller.stop();
});
await test('poller: the answer\'s top-level `overlay` goes to onOverlay on every answer that carries the key (an object or null), after onData; a missing or junk key calls nothing', async () => {
  const order = [], got = [];
  const r = rig({ onOverlay: (o) => { order.push('overlay'); got.push(o); }, onAmbient: () => order.push('ambient') });
  const orig = r.poller;   // data goes through rig's onData; note its place in the order too
  const r2 = rig({ onData: () => order.push('data'), onOverlay: (o) => { order.push('overlay'); got.push(o); }, onAmbient: () => order.push('ambient') });
  const answers = [
    { ...ok(1), ambient: { seq: 5, doc: { mode: 'auto' }, updatedAt: 'x' }, overlay: { id: 'o1', kind: 'text', ms: 5000, text: 'x' } },
    { seq: 1, unchanged: true, ambient: { seq: 5, unchanged: true }, overlay: { id: 'o1', kind: 'text', ms: 5000, text: 'x', age: 4100 } },
    { seq: 1, unchanged: true, ambient: { seq: 5, unchanged: true }, overlay: null },
    { seq: 1, unchanged: true, ambient: { seq: 5, unchanged: true } },
    { seq: 1, unchanged: true, ambient: { seq: 5, unchanged: true }, overlay: 'junk' },
    { seq: 1, unchanged: true, ambient: { seq: 5, unchanged: true }, overlay: [] },
  ];
  let i = 0; r2.g.handler = () => Promise.resolve(answers[Math.min(i++, answers.length - 1)]);
  r2.poller.start(); await r2.c.advance(0); for (let k = 1; k < answers.length; k++) await r2.c.advance(BEAT);
  assert.deepEqual(order.slice(0, 3), ['ambient', 'data', 'overlay'], 'the ambient part, then the display, then the overlay (so the page knows whether it is dark)');
  assert.deepEqual(got.map((o) => (o === null ? null : o.id + (o.age ? '@' + o.age : ''))), ['o1', 'o1@4100', null], 'an object, an object with its age, then null; the answers with no key, a string or an array call nothing');
  r2.poller.stop(); orig.stop();
});
await test('poller: three failures in a row back off to 10 s; the first success returns to 4 s', async () => {
  const r = rig(); let fail = true; r.g.handler = () => (fail ? Promise.reject(new Error('net')) : Promise.resolve({ seq: 1, unchanged: true }));
  r.poller.start(); await r.c.advance(0);
  assert.equal(r.poller.state(), 'retrying');
  await r.c.advance(BEAT); await r.c.advance(BEAT);
  assert.deepEqual(r.calls.map((x) => x.at), [0, 4000, 8000]); assert.equal(r.poller.state(), 'offline'); assert.equal(r.poller.fails(), 3);
  await r.c.advance(9999); assert.equal(r.calls.length, 3, 'must wait the full 10 s');
  await r.c.advance(1); assert.equal(r.calls.length, 4); assert.equal(r.calls[3].at, 18000);
  await r.c.advance(10000); assert.equal(r.calls[4].at, 28000);
  fail = false; await r.c.advance(10000); assert.equal(r.calls[5].at, 38000); assert.equal(r.poller.state(), 'live'); assert.equal(r.poller.fails(), 0);
  await r.c.advance(BEAT); assert.equal(r.calls[6].at, 42000);
  assert.deepEqual(r.states, ['retrying', 'offline', 'live']); r.poller.stop();
});
await test('poller: a bad response (no seq, or neither display nor unchanged) counts as a failure', async () => {
  const r = rig(); const bad = [null, {}, { seq: 'x' }, { seq: 1 }, 'html', { error: 'x' }]; let i = 0;
  r.g.handler = () => Promise.resolve(bad[i++]);
  r.poller.start(); await r.c.advance(0); assert.equal(r.poller.fails(), 1);
  await r.c.advance(BEAT); await r.c.advance(BEAT); assert.equal(r.poller.state(), 'offline'); assert.equal(r.data.length, 0); r.poller.stop();
});
await test('poller: a 403 is "denied" and polls slowly; a thrown fetch is a failure, not a crash', async () => {
  const r = rig(); r.g.handler = () => Promise.reject(Object.assign(new Error('forbidden'), { status: 403 }));
  r.poller.start(); await r.c.advance(0); assert.equal(r.poller.state(), 'denied');
  await r.c.advance(5000); assert.equal(r.calls.length, 1); await r.c.advance(5000); assert.equal(r.calls.length, 2); r.poller.stop();
  const t = rig({ fetch: () => { throw new Error('sync'); } }); t.poller.start(); await t.c.advance(0); assert.equal(t.poller.state(), 'retrying'); t.poller.stop();
});
await test('poller: never overlaps requests, and times out a request that hangs', async () => {
  const r = rig({ timeoutMs: 5000 }); let release; r.g.handler = () => new Promise((res) => { release = res; });
  r.poller.start(); await r.c.advance(0);
  r.poller.kick(); r.poller.kick(); await r.c.advance(100); assert.equal(r.calls.length, 1, 'kick while in flight must not start another');
  await r.c.advance(5000); assert.equal(r.poller.fails(), 1, 'timeout counted');
  r.g.handler = () => Promise.resolve({ seq: 1, unchanged: true }); await r.c.advance(BEAT); assert.equal(r.calls.length, 2);
  release(ok(9)); await r.c.advance(0); assert.equal(r.data.length, 0, 'a late answer to a timed-out request is ignored');
  r.poller.stop();
});
await test('poller: a hidden page looks once a minute, never faster; visible again it polls at once and is back on the 4 s beat', async () => {
  const r = rig(); r.g.handler = () => Promise.resolve({ seq: 1, unchanged: true });
  r.poller.start(); await r.c.advance(0); await r.c.advance(BEAT); assert.equal(r.calls.length, 2);                  // looks at 0 and 4000
  r.g.hidden = true; r.poller.kick();                                                                               // to the background at 4000
  await r.c.advance(HIDDEN - 1); assert.equal(r.calls.length, 2, 'not before the minute is up');
  await r.c.advance(1); assert.equal(r.calls.length, 3); assert.equal(r.calls[2].at, 4000 + HIDDEN);
  await r.c.advance(HIDDEN); assert.equal(r.calls.length, 4); assert.equal(r.calls[3].at, 4000 + 2 * HIDDEN, 'and every minute after');
  assert.equal(r.poller.state(), 'live'); assert.equal(r.c.pending(), 1, 'one timer: the next look');
  r.g.hidden = false; r.poller.kick(); await r.c.advance(0); assert.equal(r.calls.length, 5); assert.equal(r.calls[4].at, 4000 + 2 * HIDDEN, 'visible: at once');
  await r.c.advance(BEAT); assert.equal(r.calls.length, 6, 'and on the 4 s beat again'); assert.equal(r.calls[5].at - r.calls[4].at, BEAT); r.poller.stop();
});
await test('poller: hiding mid-request lets it finish and then waits a minute; a kick while one is out starts nothing; stop ends everything', async () => {
  const r = rig(); let release; r.g.handler = () => new Promise((res) => { release = res; });
  r.poller.start(); await r.c.advance(0); r.g.hidden = true; r.poller.kick(); release({ seq: 4, display: { kind: 'blank' } }); await r.c.advance(0);
  assert.equal(r.calls.length, 1, 'the kick in flight started no second request'); assert.equal(r.data.length, 1);
  await r.c.advance(HIDDEN - 1); assert.equal(r.calls.length, 1, 'a minute after the answer, not 4 s');
  r.g.handler = () => Promise.resolve({ seq: 4, unchanged: true }); await r.c.advance(1); assert.equal(r.calls.length, 2);
  r.g.hidden = false; r.poller.kick(); await r.c.advance(0); assert.equal(r.calls.length, 3, 'visible: at once');
  r.poller.stop(); await r.c.advance(2 * HIDDEN); assert.equal(r.calls.length, 3); assert.equal(r.c.pending(), 0);
  let late; const s = rig(); s.g.handler = () => new Promise((res) => { late = res; }); s.poller.start(); await s.c.advance(0); s.poller.stop(); late(ok(5)); await s.c.advance(0);
  assert.equal(s.data.length, 0, 'an answer after stop must not draw'); assert.equal(s.c.pending(), 0);
});
await test('poller: a hidden page that is offline or denied is no faster than the minute either', async () => {
  const r = rig(); r.g.handler = () => Promise.reject(new Error('net')); r.g.hidden = true;
  r.poller.start(); await r.c.advance(0); await r.c.advance(HIDDEN); await r.c.advance(HIDDEN); await r.c.advance(HIDDEN);
  assert.deepEqual(r.calls.map((x) => x.at), [0, HIDDEN, 2 * HIDDEN, 3 * HIDDEN]); assert.equal(r.poller.state(), 'offline'); r.poller.stop();
});
await test('poller: the network coming back forgets the backoff', async () => {
  const r = rig(); let fail = true; r.g.handler = () => (fail ? Promise.reject(new Error('net')) : Promise.resolve({ seq: 1, unchanged: true }));
  r.poller.start(); await r.c.advance(0); await r.c.advance(BEAT); await r.c.advance(BEAT); assert.equal(r.poller.state(), 'offline');
  fail = false; r.poller.reset(); r.poller.kick(); await r.c.advance(0); assert.equal(r.poller.state(), 'live'); assert.equal(r.poller.fails(), 0); r.poller.stop();
});
await test('poller: an onData that throws does not stop polling', async () => {
  const r = rig({ onData: () => { throw new Error('draw failed'); } }); r.g.handler = () => Promise.resolve(ok(1));
  r.poller.start(); await r.c.advance(0); await r.c.advance(BEAT); assert.equal(r.calls.length, 2); r.poller.stop();
});

/* ---------- two hours without a change: 15 s (the Workers Free budget) ---------- */
/* a server whose three seqs the test moves through the returned object: a part comes in full when the poller's seq for it is stale */
function seqServer(r) {
  const st = { seq: 1, aseq: 1, sseq: 1 };
  r.g.handler = (seq, aseq, sseq) => {
    const ambient = aseq === st.aseq ? { seq: st.aseq, unchanged: true } : { seq: st.aseq, doc: { mode: 'auto' } };
    const stt = sseq === st.sseq ? { seq: st.sseq, unchanged: true } : { seq: st.sseq, want: 'off', session: '' };
    return Promise.resolve(seq === st.seq && aseq === st.aseq && sseq === st.sseq ? { seq: st.seq, unchanged: true, ambient, stt }
      : { seq: st.seq, display: { kind: 'blank' }, updatedAt: '2026-10-17T09:00:00.000Z', ambient, stt });
  };
  return st;
}
/* the time of the call before the last, and the last: how far apart the two newest looks are */
const gap = (r) => r.calls[r.calls.length - 1].at - r.calls[r.calls.length - 2].at;
async function idleRig() {
  const r = rig(); const st = seqServer(r);
  r.poller.start(); await r.c.advance(0);
  await r.c.advance(IDLE_AFTER);                                   // the look at exactly two hours is the last on the fast beat
  return { r, st };
}
await test('poller: two hours without a change slow the beat to 15 s, and not a moment before', async () => {
  const r = rig(); seqServer(r);
  r.poller.start(); await r.c.advance(0);
  await r.c.advance(IDLE_AFTER - 1); assert.equal(r.calls.length, 1800); assert.equal(r.calls[1799].at, IDLE_AFTER - BEAT);
  assert.ok(r.calls.every((x, i) => x.at === i * BEAT), 'every look so far was on the 4 s beat');
  await r.c.advance(1); assert.equal(r.calls.length, 1801); assert.equal(r.calls[1800].at, IDLE_AFTER, 'the look at two hours sees nothing new');
  await r.c.advance(IDLE - 1); assert.equal(r.calls.length, 1801, 'and the next is 15 s later');
  await r.c.advance(1); assert.equal(r.calls.length, 1802); assert.equal(gap(r), IDLE);
  await r.c.advance(IDLE); assert.equal(gap(r), IDLE); assert.equal(r.poller.state(), 'live'); assert.equal(r.data.length, 1, 'nothing redrawn all that time'); r.poller.stop();
});
for (const part of ['seq', 'aseq', 'sseq']) {
  await test('poller: after two idle hours a change of ' + (part === 'seq' ? 'the display' : part === 'aseq' ? 'the ambient' : 'the transcriber part') + ' brings the 4 s beat back, on the look that sees it', async () => {
    const { r, st } = await idleRig(); const n = r.calls.length;
    await r.c.advance(IDLE); assert.equal(r.calls.length, n + 1); assert.equal(gap(r), IDLE, 'still idle');
    st[part]++;                                                    // moves between two looks: seen 15 s later, at the idle beat
    await r.c.advance(IDLE); assert.equal(r.calls.length, n + 2); assert.equal(gap(r), IDLE, 'the look that finds the change is still one idle beat away');
    await r.c.advance(BEAT - 1); assert.equal(r.calls.length, n + 2); await r.c.advance(1); assert.equal(r.calls.length, n + 3); assert.equal(gap(r), BEAT, 'then 4 s');
    await r.c.advance(BEAT); assert.equal(gap(r), BEAT); assert.equal(r.calls.length, n + 4);
    await r.c.advance(IDLE_AFTER - BEAT); assert.equal(gap(r), BEAT, 'and it takes another two hours of nothing to slow down again'); r.poller.stop();
  });
}
await test('poller: failures while idle are no faster than 15 s, and a failure that recovers with nothing new leaves it idle', async () => {
  const { r } = await idleRig(); const inner = r.g.handler; let fail = false;
  r.g.handler = (...a) => (fail ? Promise.reject(new Error('net')) : inner(...a));
  fail = true; for (let i = 0; i < 4; i++) { await r.c.advance(IDLE); assert.equal(gap(r), IDLE, 'failure ' + (i + 1) + ' (' + r.poller.state() + ')'); }
  assert.equal(r.poller.state(), 'offline');
  fail = false; await r.c.advance(IDLE); assert.equal(r.poller.state(), 'live');
  await r.c.advance(IDLE); assert.equal(gap(r), IDLE, 'recovered, nothing moved: still idle'); r.poller.stop();
});
await test('poller: a clock that jumps (the iPad slept) counts: the first answer after two hours of nothing is on the idle beat', async () => {
  let t = 0; const r = rig({ now: () => t }); seqServer(r);
  r.poller.start(); await r.c.advance(0); t = IDLE_AFTER + 5000;                        // the wall clock moved two hours while the page slept
  await r.c.advance(BEAT); assert.equal(r.calls.length, 2); await r.c.advance(IDLE); assert.equal(r.calls.length, 3); assert.equal(gap(r), IDLE); r.poller.stop();
});

/* ---------- the poller with the ambient part (GET /api/gm/display?seq=N&aseq=M) ---------- */
const aok = (seq, aseq, doc, display) => ({ seq, display: display || { kind: 'blank' }, updatedAt: '2026-10-17T09:00:00.000Z', ambient: doc ? { seq: aseq, doc, updatedAt: '2026-10-17T09:00:01.000Z' } : { seq: aseq, unchanged: true } });
await test('poller: fetch gets both seqs; the first call has neither, then the ones it holds', async () => {
  const calls = []; const r = rig({ fetch: (seq, aseq) => { calls.push([seq, aseq]); return Promise.resolve(r.g.res); } });
  r.g.res = aok(4, 2, { mode: 'pin', scene: 'duskwall' });
  r.poller.start(); await r.c.advance(0);
  r.g.res = { seq: 4, unchanged: true, ambient: { seq: 2, unchanged: true } };
  await r.c.advance(BEAT);
  assert.deepEqual(calls, [[null, null], [4, 2]]); assert.equal(r.poller.seq(), 4); assert.equal(r.poller.aseq(), 2); r.poller.stop();
});
await test('poller: a display with an ambient doc calls onAmbient (first) then onData; both unchanged calls neither', async () => {
  const order = []; const r = rig({ onAmbient: (doc, aseq, at) => order.push(['amb', doc.mode, aseq, at]), onData: (d, seq) => order.push(['data', d.kind, seq]) });
  r.g.handler = () => Promise.resolve(aok(7, 3, { mode: 'off' }, { kind: 'text', text: 'x' }));
  r.poller.start(); await r.c.advance(0);
  assert.deepEqual(order, [['amb', 'off', 3, '2026-10-17T09:00:01.000Z'], ['data', 'text', 7]]);
  r.g.handler = () => Promise.resolve({ seq: 7, unchanged: true, ambient: { seq: 3, unchanged: true } });
  await r.c.advance(BEAT); assert.equal(order.length, 2, 'nothing redrawn'); r.poller.stop();
});
await test('poller: an ambient-only change carries the display along but must not redraw the spotlight', async () => {
  const order = []; const r = rig({ onAmbient: (doc) => order.push(['amb', doc.mode]), onData: (d, seq) => order.push(['data', seq]) });
  r.g.handler = () => Promise.resolve(aok(5, 1, { mode: 'auto' }, { kind: 'svg', svg: '<svg/>' }));
  r.poller.start(); await r.c.advance(0);
  r.g.handler = () => Promise.resolve(aok(5, 2, { mode: 'pin', scene: 'harvest' }, { kind: 'svg', svg: '<svg/>' }));
  await r.c.advance(BEAT);
  assert.deepEqual(order, [['amb', 'auto'], ['data', 5], ['amb', 'pin']]); assert.equal(r.poller.aseq(), 2);
  r.g.handler = () => Promise.resolve(aok(6, 2, null, { kind: 'blank' }));       // a display change with the ambient unchanged
  await r.c.advance(BEAT); assert.deepEqual(order.slice(3), [['data', 6]]); r.poller.stop();
});
await test('poller: the old shapes still work (no ambient part): seq alone, and the full display without one', async () => {
  const order = []; const r = rig({ onAmbient: () => order.push('amb'), onData: (d, seq) => order.push(seq) });
  r.g.handler = (seq) => Promise.resolve(seq === null ? ok(2, { kind: 'blank' }) : { seq: 2, unchanged: true });
  r.poller.start(); await r.c.advance(0); await r.c.advance(BEAT);
  assert.deepEqual(order, [2]); assert.equal(r.poller.aseq(), null); assert.equal(r.poller.state(), 'live'); r.poller.stop();
});
await test('poller: unchanged with an ambient part is a valid answer; a malformed ambient part is ignored, never an error', async () => {
  const order = []; const r = rig({ onAmbient: (d) => order.push(['amb', d]), onData: (d, seq) => order.push(['data', seq]) });
  r.g.handler = () => Promise.resolve({ seq: 1, unchanged: true, ambient: { seq: 1, unchanged: true } });
  r.poller.start(); await r.c.advance(0); assert.equal(r.poller.state(), 'live'); assert.equal(r.poller.aseq(), 1); assert.deepEqual(order, []);
  for (const bad of [null, 'x', 7, [], { seq: 'x', doc: {} }, { seq: 2 }, { seq: 2, doc: 'no' }, { doc: {} }]) {
    r.g.handler = () => Promise.resolve({ seq: 1, unchanged: true, ambient: bad }); await r.c.advance(BEAT);
    assert.equal(r.poller.state(), 'live', JSON.stringify(bad)); assert.equal(r.poller.aseq(), 1, 'a bad part did not move the seq: ' + JSON.stringify(bad));
  }
  r.g.handler = () => Promise.resolve({ seq: 2, display: { kind: 'blank' }, ambient: { seq: 'junk' } }); await r.c.advance(BEAT);
  assert.deepEqual(order, [['data', 2]], 'the spotlight still draws'); assert.equal(r.poller.fails(), 0); r.poller.stop();
});
await test('poller: an onAmbient that throws does not stop the display from drawing', async () => {
  const seen = []; const r = rig({ onAmbient: () => { throw new Error('plan failed'); }, onData: (d, seq) => seen.push(seq) });
  r.g.handler = () => Promise.resolve(aok(3, 1, { mode: 'auto' })); r.poller.start(); await r.c.advance(0);
  assert.deepEqual(seen, [3]); assert.equal(r.poller.state(), 'live'); r.poller.stop();
});

/* ---------- the poller with the transcriber part (GET /api/gm/display?seq=N&aseq=M&sseq=K) ---------- */
const sok = (seq, sseq, part, display) => ({ seq, display: display || { kind: 'blank' }, updatedAt: '2026-10-17T09:00:00.000Z', ambient: { seq: 1, unchanged: true }, stt: part ? { seq: sseq, ...part } : { seq: sseq, unchanged: true } });
await test('poller: fetch gets all three seqs (null on the first call); the transcriber part reaches onStt once per change, never when unchanged', async () => {
  const calls = [], got = []; const r = rig({ fetch: (seq, aseq, sseq) => { calls.push([seq, aseq, sseq]); return Promise.resolve(r.g.res); }, onStt: (p) => got.push(p) });
  r.g.res = sok(4, 77, { want: 'off', session: '' });
  r.poller.start(); await r.c.advance(0);
  r.g.res = { seq: 4, unchanged: true, ambient: { seq: 1, unchanged: true }, stt: { seq: 77, unchanged: true } };
  await r.c.advance(BEAT); await r.c.advance(BEAT);
  r.g.res = { seq: 4, unchanged: true, ambient: { seq: 1, unchanged: true }, stt: { seq: 88, want: 'on', session: '9.1' } };   // only the GM's listening changed: no display along
  await r.c.advance(BEAT);
  r.g.res = { seq: 4, unchanged: true, ambient: { seq: 1, unchanged: true }, stt: { seq: 88, unchanged: true } };
  await r.c.advance(BEAT);
  assert.deepEqual(calls, [[null, null, null], [4, 1, 77], [4, 1, 77], [4, 1, 77], [4, 1, 88]]);
  assert.deepEqual(got, [{ seq: 77, want: 'off', session: '' }, { seq: 88, want: 'on', session: '9.1' }]);
  assert.equal(r.poller.sseq(), 88); assert.equal(r.data.length, 1, 'the display drew once: a transcriber change is not a redraw'); assert.equal(r.poller.state(), 'live'); r.poller.stop();
});
await test('poller: the transcriber part comes after the ambient and before the display on one answer', async () => {
  const order = []; const r = rig({ onAmbient: () => order.push('amb'), onStt: (p) => order.push('stt:' + (p && p.want)), onData: (d, seq) => order.push('data:' + seq) });
  r.g.handler = () => Promise.resolve({ seq: 3, display: { kind: 'blank' }, ambient: { seq: 2, doc: { mode: 'auto' } }, stt: { seq: 5, want: 'on', session: '' } });
  r.poller.start(); await r.c.advance(0); assert.deepEqual(order, ['amb', 'stt:on', 'data:3']); r.poller.stop();
});
await test('poller: an answer with no transcriber part (an older server, or ?seq alone) tells onStt(null) once, and the display carries on', async () => {
  const got = [], seen = []; const r = rig({ onStt: (p) => got.push(p), onData: (d, seq) => seen.push(seq) });
  r.g.handler = (seq) => Promise.resolve(seq === null ? ok(2, { kind: 'blank' }) : { seq: 2, unchanged: true });
  r.poller.start(); await r.c.advance(0); await r.c.advance(BEAT); await r.c.advance(BEAT);
  assert.deepEqual(got, [null], 'once, not on every answer'); assert.deepEqual(seen, [2]); assert.equal(r.poller.sseq(), null); assert.equal(r.poller.state(), 'live');
  r.g.handler = () => Promise.resolve(sok(2, 5, { want: 'on', session: '3' }));   // the server was upgraded under it
  await r.c.advance(BEAT); assert.deepEqual(got, [null, { seq: 5, want: 'on', session: '3' }]);
  r.g.handler = () => Promise.resolve({ seq: 2, unchanged: true });                 // and rolled back: told once more
  await r.c.advance(BEAT); assert.deepEqual(got.slice(2), [null]); r.poller.stop();
});
await test('poller: a malformed transcriber part is ignored like a missing one, never an error; an onStt that throws does not stop polling', async () => {
  const got = []; const r = rig({ onStt: (p) => got.push(p) });
  r.g.handler = () => Promise.resolve({ seq: 1, unchanged: true }); r.poller.start(); await r.c.advance(0);
  for (const bad of [null, 'x', 7, [], { seq: 'x', want: 'on' }, { seq: 3 }, { seq: 3, want: 'maybe' }, { want: 'on' }, { seq: NaN, want: 'on' }]) {
    r.g.handler = () => Promise.resolve({ seq: 1, unchanged: true, stt: bad }); await r.c.advance(BEAT);
    assert.equal(r.poller.state(), 'live', JSON.stringify(bad)); assert.equal(r.poller.sseq(), null, 'a bad part did not move the seq: ' + JSON.stringify(bad));
  }
  assert.deepEqual(got, [null], 'told once that there is no usable part');
  assert.deepEqual(P.sttPart({ stt: { seq: 2, want: 'on', session: '12345678901234567890', extra: 'x' } }), { seq: 2, want: 'on', session: '123456789012' }, 'only want and session, the session capped');
  assert.equal(P.sttPart({ stt: { seq: 2, want: 'on', session: 5 } }).session, '');
  const t = rig({ onStt: () => { throw new Error('feed failed'); } }); t.g.handler = () => Promise.resolve(sok(1, 1, { want: 'on', session: '' }));
  t.poller.start(); await t.c.advance(0); await t.c.advance(BEAT); assert.equal(t.calls.length, 2); assert.equal(t.poller.state(), 'live'); t.poller.stop(); r.poller.stop();
});

/* ---------- app/stt.js: what the GM wants comes from the display poll; its own GET is only the fallback ---------- */
function sttRig(live) {
  const timers = []; let now = 0, id = 0; const base = 1.7e12, sockets = [];
  const add = (fn, ms, every) => { timers.push({ id: ++id, at: now + ms, fn, every }); return id; };
  const drop = (i) => { const k = timers.findIndex((t) => t.id === i); if (k >= 0) timers.splice(k, 1); };
  const el = (tag) => ({ tag, className: '', textContent: '', hidden: false, kids: [], attrs: {}, listeners: {}, appendChild(c) { this.kids.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, remove() {},
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, classList: { toggle() {} } });
  const doc = { hidden: false, createElement: el, listeners: {}, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== f); } };
  class FakeDate extends Date { static now() { return base + now; } }
  const win = { document: doc, navigator: {}, Date: FakeDate, setTimeout: (f, ms) => add(f, ms, 0), setInterval: (f, ms) => add(f, ms, ms), clearTimeout: drop, clearInterval: drop, console };
  win.self = win;
  if (live) {       /* a fake microphone and a fake Deepgram socket, so a tap really opens the stream and a Results message really reaches the merger */
    const track = { readyState: 'live', addEventListener() {} };
    win.navigator = { mediaDevices: { getUserMedia: () => Promise.resolve({ getAudioTracks: () => [track], getTracks: () => [track] }) } };
    win.AudioContext = class { constructor() { this.sampleRate = 48000; this.destination = {}; this.state = 'running'; }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; } createScriptProcessor() { return { connect() {}, disconnect() {} }; }
      resume() { return Promise.resolve(); } close() {} };
    win.WebSocket = class { constructor(url, protocols) { this.url = url; this.protocols = protocols; this.readyState = 0; sockets.push(this); Promise.resolve().then(() => { this.readyState = 1; if (this.onopen) this.onopen(); }); }
      send() {} close() { this.readyState = 3; } };
  }
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'app', 'cue.js'), 'utf8'), win);          /* the display bundle loads cue.js before stt.js */
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'app', 'stt.js'), 'utf8'), win);
  const calls = { stt: 0, patch: [], posts: [] }, server = { want: 'off', session: '' };
  const gm = {
    stt: () => { calls.stt++; return Promise.resolve({ doc: { want: server.want, session: server.session } }); },
    sttToken: () => live ? Promise.resolve({ token: 'fake-token' }) : Promise.reject(new Error('no token here')),
    addTranscript: (batch) => { calls.posts.push({ at: now, batch: JSON.parse(JSON.stringify(batch)) }); return Promise.resolve({ added: batch.length }); },
    patchStt: (p) => { calls.patch.push(p); return Promise.resolve({}); }
  };
  const container = el('div'); const ctl = win.B68Stt.attach(container, { gm });
  const tap = container.kids[0];
  return { ctl, gm, calls, server, doc, tap, sockets, now: () => now,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await flush(); timers.sort((a, b) => a.at - b.at || a.id - b.id);
        if (!timers.length || timers[0].at > end) break;
        const t = timers.shift(); now = Math.max(now, t.at); if (t.every) { t.at = now + t.every; timers.push(t); } t.fn();
      }
      now = end; await flush();
    } };
}
await test('stt.js: fed by the display poll it makes no request of its own for what the GM wants, and shows the tap while want is on', async () => {
  const r = sttRig(); r.ctl.feed({ seq: 5, want: 'off', session: '' });
  assert.equal(r.tap.hidden, true); assert.deepEqual([r.ctl.state().fed, r.ctl.state().want], [true, 'off']);
  await r.advance(60000); assert.equal(r.calls.stt, 0, 'no GET /api/gm/stt in a minute');
  r.ctl.feed({ seq: 6, want: 'on', session: '9.1' });
  assert.equal(r.tap.hidden, false, 'want on and not listening: Tap to start listening'); assert.equal(r.ctl.state().session, '9.1');
  await r.advance(60000); assert.equal(r.calls.stt, 0);
  r.ctl.feed({ seq: 7, want: 'off', session: '9.1' }); assert.equal(r.tap.hidden, true, 'the GM said stop: the tap goes');
  r.doc.hidden = true; r.doc.listeners.visibilitychange.forEach((f) => f()); await r.advance(60000); assert.equal(r.calls.stt, 0, 'nor on a visibility change');
  r.ctl.destroy();
});
await test('stt.js: an answer with no transcriber part (null) makes it ask GET /api/gm/stt itself at once and every 4 s; a part again ends that', async () => {
  const r = sttRig(); r.server.want = 'on'; r.server.session = '7';
  r.ctl.feed(null); await r.advance(0);
  assert.equal(r.calls.stt, 1, 'at once'); assert.deepEqual([r.ctl.state().fed, r.ctl.state().want, r.ctl.state().session], [false, 'on', '7']); assert.equal(r.tap.hidden, false);
  await r.advance(3999); assert.equal(r.calls.stt, 1); await r.advance(1); assert.equal(r.calls.stt, 2);
  await r.advance(8000); assert.equal(r.calls.stt, 4, 'every 4 s');
  r.ctl.feed(null); r.ctl.feed(null); await r.advance(0); assert.equal(r.calls.stt, 4, 'more nulls change nothing');
  r.server.want = 'off'; await r.advance(4000); assert.equal(r.ctl.state().want, 'off'); assert.equal(r.tap.hidden, true, 'the fallback hears the GM stop too');
  r.ctl.feed({ seq: 9, want: 'on', session: '' }); const n = r.calls.stt; await r.advance(60000); assert.equal(r.calls.stt, n, 'fed again: the fallback is quiet');
  r.ctl.feed(null); await r.advance(0); assert.equal(r.calls.stt, n + 1, 'and starts again when the parts stop');
  r.ctl.destroy();
});
await test('stt.js: before any display answer (or with a display page that never feeds it) it polls for itself, as it always did', async () => {
  const r = sttRig(); r.server.want = 'on';
  await r.advance(3999); assert.equal(r.calls.stt, 0); await r.advance(1); assert.equal(r.calls.stt, 1); assert.equal(r.ctl.state().fed, null);
  assert.equal(r.tap.hidden, false); await r.advance(8000); assert.equal(r.calls.stt, 3);
  r.ctl.destroy(); await r.advance(20000); assert.equal(r.calls.stt, 3, 'destroyed: nothing more');
  const late = sttRig(); late.server.want = 'on'; late.ctl.feed(null); late.ctl.destroy(); await late.advance(0); await late.advance(20000); assert.equal(late.calls.stt, 1, 'a feed after destroy is ignored');
});
await test('stt.js: a fallback answer that lands after the display poll has taken over is dropped', async () => {
  const r = sttRig(); let release; r.gm.stt = () => new Promise((res) => { release = res; });
  r.ctl.feed(null); await r.advance(0);                                              // the fallback GET is out
  r.ctl.feed({ seq: 3, want: 'off', session: '' });                                // the display poll answers first
  release({ doc: { want: 'on', session: '5' } }); await r.advance(0);
  assert.equal(r.ctl.state().want, 'off', 'the older fallback answer did not overwrite the display poll\'s'); assert.equal(r.tap.hidden, true); r.ctl.destroy();
});
await test('stt.js: the iPad reports its state at once on a change, then once a minute while visible and idle, and not at all while hidden', async () => {
  const r = sttRig(); r.ctl.feed({ seq: 1, want: 'off', session: '' });
  await r.advance(9999); assert.equal(r.calls.patch.length, 0); await r.advance(1); assert.equal(r.calls.patch.length, 1, 'the first look at 10 s');
  assert.equal(r.calls.patch[0].status.state, 'idle');
  await r.advance(59000); assert.equal(r.calls.patch.length, 1, 'then a minute apart, not every 10 s'); await r.advance(1000); assert.equal(r.calls.patch.length, 2);
  r.doc.hidden = true; await r.advance(10 * 60000); assert.equal(r.calls.patch.length, 2, 'a hidden page says nothing');
  r.doc.hidden = false; await r.advance(10000); assert.equal(r.calls.patch.length, 3, 'visible again: the next look reports');
  r.ctl.feed({ seq: 2, want: 'on', session: '' }); r.tap.listeners.click[0]({ stopPropagation() {} }); await r.advance(0);   // a tap: no microphone here, so it starts and fails at once
  assert.deepEqual(r.calls.patch.slice(3).map((p) => p.status.state), ['starting', 'error'], 'a change of state is reported at once');
  assert.ok(/microphone/.test(r.calls.patch[4].status.error), r.calls.patch[4].status.error);
  r.ctl.destroy();
});

await test('stt.js (C4b): a cue is posted within about a second of the words, and the line after it at once; an ordinary line waits for the 3 s round', async () => {
  const r = sttRig(true); r.ctl.feed({ seq: 1, want: 'on', session: '9' });
  r.tap.listeners.click[0]({ stopPropagation() {} }); await r.advance(10);
  assert.equal(r.sockets.length, 1, 'the tap opened the socket'); assert.ok(/keyterm=Blade/.test(r.sockets[0].url), 'the keyterm rides the real URL');
  assert.equal(r.ctl.state().state, 'listening');
  const msg = (speaker, text, start) => {
    const words = text.split(' ').map((w, i) => ({ word: w.toLowerCase().replace(/[^a-z0-9]/g, ''), punctuated_word: w, speaker, start: start + i * 0.4, end: start + i * 0.4 + 0.3 }));
    r.sockets[0].onmessage({ data: JSON.stringify({ type: 'Results', is_final: true, channel: { alternatives: [{ transcript: text, words }] } }) });
  };
  const t0 = r.now();
  msg(0, 'Okay so. Blade, make a 6 clock called Escape', 1);
  await r.advance(0); assert.equal(r.calls.posts.length, 0, 'the cue line is held for its one-second tail, nothing posted yet');
  await r.advance(1000); assert.equal(r.calls.posts.length, 0, 'still inside the tail (it closes after more than 1 s)');
  await r.advance(300);
  assert.equal(r.calls.posts.length, 1, 'posted by the cue, not by the 3 s round');
  assert.ok(r.calls.posts[0].at - t0 <= 1500 && r.calls.posts[0].at - t0 < 3000, 'posted ' + (r.calls.posts[0].at - t0) + ' ms after the words');
  const b = r.calls.posts[0].batch;
  assert.deepEqual(b.map((l) => l.text), ['Okay so.', 'Blade, make a 6 clock called Escape']);
  assert.ok(!('cue' in b[0]), 'the words before the cue are an ordinary line'); assert.strictEqual(b[1].cue, true, 'cue is a boolean true on the posted line');
  const t1 = r.now(); msg(1, 'and mark two', 5);
  await r.advance(0); assert.equal(r.calls.posts.length, 2, 'the line straight after a cued line goes at once'); assert.equal(r.calls.posts[1].at, t1);
  assert.deepEqual(r.calls.posts[1].batch.map((l) => l.text), ['and mark two']); assert.ok(!('cue' in r.calls.posts[1].batch[0]));
  msg(0, 'just talking now', 9); await r.advance(2500); assert.equal(r.calls.posts.length, 2, 'an ordinary line still waits (4 s quiet, then the 3 s round)');
  await r.advance(8000); assert.equal(r.calls.posts.length, 3); assert.deepEqual(r.calls.posts[2].batch.map((l) => l.text), ['just talking now']);
  r.ctl.destroy();
});

/* ---------- the way out of "denied": a reload after ten minutes signed out, at most once per half hour ---------- */
const MIN = 60000, T0 = 1.7e12;
/* one clock and one place to keep the time, and `page()` makes the reloader of one page load (a reload makes a new one) */
function reloadWorld() {
  const c = clock(), mem = { last: null, ok: true }, ev = [];
  const page = (over = {}) => P.createReloader(Object.assign({
    timers: c, now: () => T0 + c.now, last: () => mem.last,
    remember: (ms) => { if (!mem.ok) return false; mem.last = ms; ev.push(['kept', c.now]); return true; },
    reload: () => ev.push(['reload', c.now])
  }, over));
  return { c, mem, ev, page };
}
await test('reloader: the numbers are ten minutes signed out and half an hour between reloads', () => {
  assert.deepEqual(P.RELOAD, { deniedMs: 10 * MIN, gapMs: 30 * MIN, key: 'b68.display.reload' });
});
await test('reloader: denied for ten minutes reloads once, having kept the time first; not a moment before', async () => {
  const w = reloadWorld(), rl = w.page(); rl.state('denied');
  await w.c.advance(10 * MIN - 1); assert.deepEqual(w.ev, []);
  await w.c.advance(1); assert.deepEqual(w.ev, [['kept', 10 * MIN], ['reload', 10 * MIN]]);
  assert.equal(w.mem.last, T0 + 10 * MIN);
  await w.c.advance(3 * 3600000); assert.equal(w.ev.length, 2, 'once'); assert.equal(w.c.pending(), 0);
});
await test('reloader: any state but denied cancels it, and the ten minutes start over at the next denial; denied again does not restart them', async () => {
  const w = reloadWorld(), rl = w.page();
  rl.state('denied'); await w.c.advance(9 * MIN); rl.state('live'); assert.equal(w.c.pending(), 0); await w.c.advance(2 * 3600000); assert.deepEqual(w.ev, [], 'signed in again in time');
  for (const other of ['retrying', 'offline', 'connecting']) { rl.state('denied'); await w.c.advance(5 * MIN); rl.state(other); assert.equal(w.c.pending(), 0, other); await w.c.advance(MIN); }
  assert.deepEqual(w.ev, []);
  const t = w.c.now; rl.state('denied'); await w.c.advance(5 * MIN); rl.state('denied'); await w.c.advance(5 * MIN - 1); assert.deepEqual(w.ev, [], 'the clock runs from the first denial');
  await w.c.advance(1); assert.deepEqual(w.ev, [['kept', t + 10 * MIN], ['reload', t + 10 * MIN]]);
});
await test('reloader: stop cancels it', async () => {
  const w = reloadWorld(), rl = w.page(); rl.state('denied'); await w.c.advance(5 * MIN); rl.stop(); assert.equal(w.c.pending(), 0); await w.c.advance(MIN * 60); assert.deepEqual(w.ev, []);
});
await test('reloader: at most once per half hour: a page that comes back still denied waits out the half hour since the last reload', async () => {
  const w = reloadWorld(), first = w.page(); first.state('denied'); await w.c.advance(10 * MIN);
  assert.deepEqual(w.ev.map((e) => e[0]), ['kept', 'reload']); first.stop();                       // that page is gone; the new load
  await w.c.advance(1000); const second = w.page(); second.state('denied');                          // denied again, 1 s after the reload
  await w.c.advance(10 * MIN); assert.equal(w.ev.length, 2, 'ten minutes signed out again, but it reloaded 10 minutes ago');
  await w.c.advance(20 * MIN - 1001); assert.equal(w.ev.length, 2, 'not before half an hour from the last');
  await w.c.advance(1); assert.deepEqual(w.ev.slice(2), [['kept', 40 * MIN], ['reload', 40 * MIN]]);
  assert.equal(w.mem.last, T0 + 40 * MIN);
});
await test('reloader: a reload noted in the future (the clock was set back) counts its half hour from now', async () => {
  const w = reloadWorld(); w.mem.last = T0 + 5 * 3600000; const rl = w.page(); rl.state('denied');
  await w.c.advance(40 * MIN - 1); assert.deepEqual(w.ev, []); await w.c.advance(1); assert.deepEqual(w.ev, [['kept', 40 * MIN], ['reload', 40 * MIN]]);
});
await test('reloader: an old note (a day ago) does not hold it back', async () => {
  const w = reloadWorld(); w.mem.last = T0 - 24 * 3600000; const rl = w.page(); rl.state('denied'); await w.c.advance(10 * MIN);
  assert.deepEqual(w.ev, [['kept', 10 * MIN], ['reload', 10 * MIN]]);
});
await test('reloader: with nowhere to keep the time it never reloads (a stale word beats a loop)', async () => {
  const w = reloadWorld(); w.mem.ok = false; const rl = w.page(); rl.state('denied');
  await w.c.advance(3 * 3600000); assert.deepEqual(w.ev, []); assert.equal(w.c.pending(), 0);
});
await test('reloader: it counts the wall clock: after a jump forward (the iPad slept) the wake-up reloads and keeps the wall clock\'s time', async () => {
  let skew = 0; const w = reloadWorld(), rl = w.page({ now: () => T0 + w.c.now + skew }); rl.state('denied');
  await w.c.advance(MIN); skew = 3 * 3600000;                                          // the wall clock moves three hours
  await w.c.advance(9 * MIN - 1); assert.deepEqual(w.ev, []); await w.c.advance(1);
  assert.deepEqual(w.ev, [['kept', 10 * MIN], ['reload', 10 * MIN]]); assert.equal(w.mem.last, T0 + 10 * MIN + 3 * 3600000);
});
await test('reloader: after a jump of the clock back the wake-up finds the ten minutes not yet up and waits out the rest', async () => {
  let skew = 0; const w = reloadWorld(), rl = w.page({ now: () => T0 + w.c.now + skew }); rl.state('denied');
  await w.c.advance(MIN); skew = -5 * MIN;                                             // the clock is set back five minutes
  await w.c.advance(9 * MIN); assert.deepEqual(w.ev, [], 'at the wake-up the wall clock says five minutes have gone, not ten');
  await w.c.advance(5 * MIN - 1); assert.deepEqual(w.ev, []); await w.c.advance(1); assert.deepEqual(w.ev, [['kept', 15 * MIN], ['reload', 15 * MIN]]);
});
await test('reload store: both storages are written, the newer time wins, a blocked one is skipped, and nothing kept says so', () => {
  const KEY = P.RELOAD.key, mem = () => { const m = {}; return { m, getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); } }; };
  const boom = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  let w = { localStorage: mem(), sessionStorage: mem() }, st = P.reloadStore(w);
  assert.equal(st.last(), null); assert.equal(st.remember(1700000000123), true);
  assert.equal(w.localStorage.m[KEY], '1700000000123'); assert.equal(w.sessionStorage.m[KEY], '1700000000123'); assert.equal(st.last(), 1700000000123);
  w.sessionStorage.m[KEY] = '1700000999999'; assert.equal(st.last(), 1700000999999, 'the newer one');
  for (const half of [{ localStorage: boom, sessionStorage: mem() }, { localStorage: mem(), sessionStorage: boom }, { sessionStorage: mem() }, { localStorage: mem() }]) {
    st = P.reloadStore(half); assert.equal(st.last(), null); assert.equal(st.remember(5e12), true, 'the other one took it'); assert.equal(st.last(), 5e12);
  }
  for (const none of [{ localStorage: boom, sessionStorage: boom }, {}]) { st = P.reloadStore(none); assert.equal(st.remember(1), false); assert.equal(st.last(), null); }
  for (const bad of ['', 'abc', '0', '-5', 'NaN', 'Infinity', null]) {
    w = { localStorage: Object.assign(mem(), { getItem: () => bad }), sessionStorage: mem() };
    assert.equal(P.reloadStore(w).last(), null, 'not a time: ' + String(bad));
  }
});

/* ---------- lights out, the crew and the score messages ---------- */
await test('viewModel: dark is its own kind (title and caption only); anything extra is dropped', () => {
  assert.deepEqual(P.viewModel({ kind: 'dark', title: 'Break', caption: 'back at nine', svg: '<svg/>', text: 'x', npcId: 'y' }), { kind: 'dark', title: 'Break', caption: 'back at nine' });
  assert.deepEqual(P.viewModel({ kind: 'dark' }), { kind: 'dark', title: '', caption: '' });
  assert.equal(P.viewModel({ kind: 'blank' }).kind, 'blank'); assert.equal(P.viewModel({ kind: 'darker' }).kind, 'blank');
});
/* ---------- a rules entry (kind rule) ---------- */
await test('viewModel: rule carries title, caption and md (capped) and a size; anything extra is dropped', () => {
  const vm = P.viewModel({ kind: 'rule', title: 'Invented rule', caption: 'House rules', md: '## A\n\nWords.', text: 'x', svg: '<svg/>', npcId: 'y' });
  assert.deepEqual(vm, { kind: 'rule', title: 'Invented rule', caption: 'House rules', md: '## A\n\nWords.', size: 'l' });
  assert.equal(P.viewModel({ kind: 'rule', md: 7 }).md, '');
  assert.equal(P.viewModel({ kind: 'rule', md: 'x'.repeat(P.LIMITS.rule + 50) }).md.length, P.LIMITS.rule);
  assert.equal(P.ruleSize('x'.repeat(700)), 'l'); assert.equal(P.ruleSize('x'.repeat(701)), 'm'); assert.equal(P.ruleSize('x'.repeat(2501)), 's');
});
await test('cleanRuleTree: links become words; TODO notes, anchors, page chips, scripts and stray attributes go; callouts open', () => {
  const src = '<div><p>Roll <a class="rl-wl" href="#rules/b68/x">the <strong>dice</strong></a> now <span class="rl-todo">GM secret note</span><script>x()</script></p>' +
    '<span class="rl-anchor" id="rl-a-q"></span><div class="rl-src rl-src-b68"><span class="rl-src-book">Book</span><span class="rl-src-page">p. 3</span></div>' +
    '<p class="rl-todo">another GM note</p><details class="rl-callout" data-callout="note"><summary class="rl-callout-title">Tip</summary>' +
    '<div onclick="x()" style="color:red" id="z" class="rl-callout-body">body</div></details><ol start="3" onmouseover="y()"><li>a</li></ol>' +
    '<img src="x.png"/><a href="https://example.test/">out</a><p class="bad&quot;x">q</p></div>';
  const doc = new FakeDOMParser().parseFromString(src), root = doc.documentElement;
  const removed = P.cleanRuleTree(root);
  const out = new FakeXMLSerializer().serializeToString(root);
  assert.ok(removed > 0);
  assert.ok(!/<a[\s>]/.test(out) && !/href=/.test(out), 'no link survives: ' + out);
  assert.ok(out.includes('Roll the <strong>dice</strong> now'), 'the link words stay: ' + out);
  assert.ok(!/GM secret note|another GM note/.test(out), 'TODO notes go');
  assert.ok(!/<script|<img|rl-anchor|rl-src|p\. 3|onclick|onmouseover|style=|id=/.test(out), 'the rest goes: ' + out);
  assert.ok(/<details class="rl-callout" data-callout="note" open=""/.test(out), 'callouts open: ' + out);
  assert.ok(out.includes('<ol start="3">'), 'a list keeps its start');
  assert.ok(out.includes('>out<'), 'an outside link keeps its words');
  assert.ok(out.includes('<p>q</p>'), 'an odd class goes');
  assert.equal(P.cleanRuleTree(null), 0);
});
await test('crewMessage / crewChanged: post when the crew exists and differs from what the scene was told', () => {
  assert.equal(P.crewMessage(P.ambientPlan({})), null); assert.equal(P.crewMessage(null), null);
  assert.deepEqual(P.crewMessage(P.ambientPlan({ crew: { heat: 12, wanted: 2 } })), { type: 'b68:crew', heat: 9, wanted: 2 });
  assert.equal(P.crewChanged(null, null), false, 'no crew: nothing to say');
  assert.equal(P.crewChanged(null, { heat: 0, wanted: 0 }), true, 'never told: tell it, even zeros');
  assert.equal(P.crewChanged({ heat: 3, wanted: 1 }, { heat: 3, wanted: 1 }), false);
  assert.equal(P.crewChanged({ heat: 3, wanted: 1 }, { heat: 4, wanted: 1 }), true); assert.equal(P.crewChanged({ heat: 3, wanted: 1 }, { heat: 3, wanted: 2 }), true);
  assert.equal(P.crewChanged({ heat: 3, wanted: 1 }, null), false, 'a removed crew posts nothing');
});
await test('scoreMessage: board and iso are re-sanitised (script gone), the fields are copied by name, polaroids pass through', () => {
  const dirty = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>x()</script><rect id="r" onclick="x()" width="3" height="3"/></svg>';
  const score = { name: 'The Mint', district: 'Quay', target: '', reveal: ['public'], view: 'rings', board: dirty, iso: GOOD, at: 'x', gm: 'secret' };
  const m = P.scoreMessage(score, [{ svg: '<svg/>', cap: 'Babel' }, { svg: '', cap: 'none' }, null], ENV);
  assert.deepEqual(Object.keys(m).sort(), ['board', 'district', 'iso', 'name', 'polaroids', 'target', 'type', 'view']);
  assert.equal(m.type, 'b68:score'); assert.equal(m.view, 'rings'); assert.equal(m.name, 'The Mint');
  assertClean(m.board, 'board'); assert.ok(m.board.includes('id="r"') && !m.board.includes('onclick')); assertClean(m.iso, 'iso');
  assert.deepEqual(m.polaroids, [{ svg: '<svg/>', cap: 'Babel' }]);
  const bad = P.scoreMessage(Object.assign({}, score, { board: '<html>', iso: 'javascript:' }), [], ENV);
  assert.equal(bad.board, ''); assert.equal(bad.iso, '', 'what will not clean is not sent'); assert.deepEqual(bad.polaroids, []);
  assert.equal(P.scoreMessage(null, [], ENV), null); assert.equal(P.scoreMessage('x', [], ENV), null);
  assert.equal(P.scoreMessage({ board: GOOD, iso: GOOD }, [], ENV).view, 'plan');
  assert.equal(P.isScoreScene('board'), true); assert.equal(P.isScoreScene('exploded'), true); assert.equal(P.isScoreScene('watch'), false); assert.equal(P.isScoreScene('nope'), false);
  assert.deepEqual(P.POLAROIDS.map((p) => [p.id, p.cap]), [['booker', 'Babel'], ['alfie', 'Ashtray & Buck'], ['stacey', 'Stacey'], ['loader', '99.47']]);
});

/* ---------- the ambient floor: registry, plan and rotation ---------- */
await test('ambient registry: ordered, URLs come only from it, the watch feed is always ?api=off', () => {
  assert.deepEqual(P.AMBIENT_SCENES.map((s) => s.id), ['harvest', 'watch', 'duskwall', 'boneyard', 'undertow', 'vet', 'tram', 'lurker', 'cards', 'pells', 'wanted', 'meeting', 'credits', 'veil', 'board', 'exploded', 'testcard']);
  assert.equal(P.ambientUrl('harvest'), 'ambient/second-harvest');
  assert.equal(P.ambientUrl('wanted'), 'ambient/wanted-wall', 'the wanted wall polls nothing: no ?api=off');
  assert.equal(P.ambientUrl('vet'), 'ambient/grunts-vet');
  assert.deepEqual(P.ambientCrewScenes(), ['watch', 'wanted'], 'the scenes told heat and wanted');
  assert.equal(P.ambientUrl('watch'), 'ambient/watch-feed?api=off');
  assert.equal(P.ambientUrl('testcard'), 'ambient/test-card');
  for (const s of P.AMBIENT_SCENES) assert.ok(!/\.html/.test(P.ambientUrl(s.id)), s.id + ': no .html in the URL (the asset server 307s it)');
  assert.equal(P.ambientUrl('board'), 'ambient/planning-board'); assert.equal(P.ambientUrl('exploded'), 'ambient/score-exploded');
  assert.equal(P.ambientUrl('../../etc/passwd'), ''); assert.equal(P.ambientUrl('https://evil.example/x'), ''); assert.equal(P.ambientUrl(undefined), '');
  assert.equal(P.AMBIENT_SCENES.filter((s) => s.pinOnly).map((s) => s.id).join(), 'credits,veil,testcard');
  assert.equal(P.AMBIENT_SCENES.filter((s) => s.music).map((s) => s.id).join(), 'credits', 'only the credits may ask for the theme');
  assert.equal(P.AMBIENT_MUSIC, 'media/theme.mp3');
});

await test('the theme line: every music state reads as one plain line for the table, and only audio counts as the file', () => {
  assert.equal(P.themeText({ state: 'none', http: 404 }), 'Theme: no file on the server (app/media/theme.mp3)');
  assert.equal(P.themeText({ state: 'locked' }), 'Theme: tap the screen for sound');
  assert.equal(P.themeText({ state: 'playing', t: 62.7 }), 'Theme: playing · 1:02');
  assert.equal(P.themeText({ state: 'playing', t: 'x' }), 'Theme: playing · 0:00');
  assert.equal(P.themeText({ state: 'blocked' }), 'Theme: the iPad would not play it · tap the screen');
  assert.equal(P.themeText({ state: 'error', reason: 'NotSupportedError' }), 'Theme: the file would not play (NotSupportedError)');
  assert.equal(P.themeText({ state: 'error' }), 'Theme: the file would not play');
  assert.equal(P.themeText({ state: 'checking' }), 'Theme: looking for the file…');
  assert.equal(P.themeText({ state: 'ended' }), 'Theme: finished');
  assert.equal(P.themeText({ state: 'off' }), ''); assert.equal(P.themeText(null), ''); assert.equal(P.themeText({ state: 'bogus' }), '');
  assert.ok(P.themeType('audio/mpeg') && P.themeType('AUDIO/MP3') && P.themeType('') && P.themeType(null) && P.themeType('application/octet-stream'));
  assert.ok(!P.themeType('text/html; charset=utf-8') && !P.themeType('application/json'), 'a sign-in page or a fallback 200 is not the theme');
});

await test('wire: cleanWire keeps up to six one-line bulletins with distinct ids; ambientPlan carries them and ignores junk', () => {
  assert.deepEqual(P.cleanWire([{ id: 'a', text: '  Ferries \n late. ' }, { id: 'a', text: 'dup id' }, { id: 'b', text: '   ' }, { id: 5, text: 'x' }, null, 'x', { id: 'c', text: 'y'.repeat(300) }]),
    [{ id: 'a', text: 'Ferries late.' }, { id: 'c', text: 'y'.repeat(240) }]);
  assert.equal(P.cleanWire(Array.from({ length: 9 }, (_, i) => ({ id: 'i' + i, text: 'x' }))).length, 6);
  for (const bad of [undefined, null, 'x', 7, {}]) assert.deepEqual(P.cleanWire(bad), []);
  assert.deepEqual(P.ambientPlan({ wire: [{ id: 'a', text: 'Hello' }] }).wire, [{ id: 'a', text: 'Hello' }]);
  assert.deepEqual(P.ambientPlan({ wire: 'no' }).wire, []);
  const p = P.ambientPlan({ wire: [{ id: 'a', text: 'Hello' }] });
  assert.deepEqual(P.ambientPlan(p).wire, p.wire, 'the plan reads its own output');
  assert.deepEqual(P.ambientRotation(p), P.ambientRotation(P.ambientPlan({})), 'a wire adds no scene: it lies over whichever scene plays');
});

const DEFAULT_LIST = ['harvest', 'watch', 'duskwall', 'boneyard', 'undertow', 'vet', 'tram', 'lurker', 'cards', 'pells', 'wanted', 'meeting'];
await test('ambientPlan: defaults for nothing, null, {} and rubbish', () => {
  const want = { mode: 'auto', scene: null, playlist: DEFAULT_LIST, intervalMin: 7, skip: 0, crew: null, score: null, wire: [] };
  for (const d of [undefined, null, {}, 'x', 42, [], { mode: 'sideways', playlist: 'no', intervalMin: 'soon', skip: -3, crew: 'hot', score: 'none' }]) assert.deepEqual(P.ambientPlan(d), want);
  assert.notEqual(P.ambientPlan(null).playlist, P.AMBIENT_DEFAULT_PLAYLIST);                // a copy, not the shared array
});

await test('ambientPlan: unknown ids go, duplicates go, the test card is never in a playlist, order is kept', () => {
  assert.deepEqual(P.ambientPlan({ playlist: ['duskwall', 'nope', 'harvest', 'duskwall', 7, null, 'testcard'] }).playlist, ['duskwall', 'harvest']);
  assert.deepEqual(P.ambientPlan({ playlist: ['nope', 'testcard'] }).playlist, DEFAULT_LIST, 'nothing valid left: the default');
  assert.deepEqual(P.ambientPlan({ playlist: [] }).playlist, DEFAULT_LIST);
});

await test('ambientPlan: interval is clamped to 3-30 minutes, skip to a whole number, crew to heat 0-9 / wanted 0-4', () => {
  assert.equal(P.ambientPlan({ intervalMin: 1 }).intervalMin, 3); assert.equal(P.ambientPlan({ intervalMin: 99 }).intervalMin, 30);
  assert.equal(P.ambientPlan({ intervalMin: 10.4 }).intervalMin, 10); assert.equal(P.ambientPlan({ intervalMin: '12' }).intervalMin, 12);
  assert.equal(P.ambientPlan({ skip: 4.9 }).skip, 4); assert.equal(P.ambientPlan({ skip: 'x' }).skip, 0);
  assert.deepEqual(P.ambientPlan({ crew: { heat: 12, wanted: 9 } }).crew, { heat: 9, wanted: 4 });
  assert.deepEqual(P.ambientPlan({ crew: { heat: 3 } }).crew, { heat: 3, wanted: 0 });
  assert.equal(P.ambientPlan({ crew: {} }).crew, null);
});

await test('ambientPlan: score scenes are gated on a score, and a score is normalised', () => {
  const noScore = P.ambientPlan({ playlist: ['harvest', 'board', 'exploded', 'watch'] });
  assert.deepEqual(noScore.playlist, ['harvest', 'board', 'exploded', 'watch'], "the GM's list is kept");
  assert.deepEqual(P.ambientRotation(noScore), ['harvest', 'watch'], 'but the rotation drops the score scenes');
  const withScore = P.ambientPlan({ playlist: ['harvest', 'board', 'exploded'], score: { name: 'The Mint', district: 'Quay', target: 'vault', reveal: ['public', 7], board: '<svg/>', iso: 5, view: 'weird', at: '2026-10-15T01:00:00Z', extra: 'x' } });
  assert.deepEqual(P.ambientRotation(withScore), ['harvest', 'board', 'exploded']);
  assert.deepEqual(withScore.score, { name: 'The Mint', district: 'Quay', target: 'vault', reveal: ['public'], board: '<svg/>', iso: '', view: 'plan', at: '2026-10-15T01:00:00Z' });
  assert.equal(P.ambientPlan({ score: { view: 'rings' } }).score.view, 'rings');
  assert.equal(P.ambientPlan({ score: { board: 'x'.repeat(P.LIMITS.svgChars + 1) } }).score.board, '', 'an oversize svg is dropped');
});

await test('ambientPlan: pin keeps a playable scene, the test card is pinnable, anything else falls back to auto', () => {
  assert.deepEqual([P.ambientPlan({ mode: 'pin', scene: 'duskwall' }).mode, P.ambientPlan({ mode: 'pin', scene: 'duskwall' }).scene], ['pin', 'duskwall']);
  assert.equal(P.ambientPlan({ mode: 'pin', scene: 'testcard' }).mode, 'pin');
  for (const d of [{ mode: 'pin' }, { mode: 'pin', scene: 'nope' }, { mode: 'pin', scene: 'board' }, { mode: 'pin', scene: 'exploded', score: null }]) {
    const p = P.ambientPlan(d); assert.deepEqual([p.mode, p.scene], ['auto', null], JSON.stringify(d));
  }
  assert.equal(P.ambientPlan({ mode: 'pin', scene: 'board', score: { name: 'x' } }).mode, 'pin');
  assert.equal(P.ambientPlan({ mode: 'off' }).mode, 'off');
});

await test('ambientPlan reads its own output', () => {
  const d = { mode: 'pin', scene: 'board', playlist: ['watch', 'board'], intervalMin: 15, skip: 2, crew: { heat: 4, wanted: 1 }, score: { name: 'x', board: '<svg/>' } };
  assert.deepEqual(P.ambientPlan(P.ambientPlan(d)), P.ambientPlan(d));
});

await test('nextScene: next in the rotation, wrapping; first when the current one is not in it; null when nothing plays', () => {
  const plan = P.ambientPlan({});
  assert.equal(P.nextScene(plan, 'harvest'), 'watch'); assert.equal(P.nextScene(plan, 'watch'), 'duskwall');
  assert.equal(P.nextScene(plan, 'duskwall'), 'boneyard');
  assert.equal(P.nextScene(plan, 'wanted'), 'meeting');
  assert.equal(P.nextScene(plan, 'meeting'), 'harvest', 'wraps');
  assert.equal(P.nextScene(plan, null), 'harvest'); assert.equal(P.nextScene(plan, 'testcard'), 'harvest'); assert.equal(P.nextScene(plan, 'nope'), 'harvest');
  assert.equal(P.nextScene(null, 'harvest'), 'watch', 'a missing plan is the default plan');
  assert.equal(P.nextScene(P.ambientPlan({ playlist: ['duskwall'] }), 'duskwall'), 'duskwall', 'a single scene is its own next');
  assert.equal(P.nextScene(P.ambientPlan({ playlist: ['board', 'exploded'] }), 'board'), null, 'score scenes only, no score: nothing plays');
  assert.equal(P.nextScene(P.ambientPlan({ playlist: ['board', 'exploded'], score: {} }), 'board'), 'exploded');
});

await test('nextScene: score scenes are skipped without a score; excluded (benched) ids are passed over', () => {
  const plan = P.ambientPlan({ playlist: ['harvest', 'board', 'watch', 'exploded', 'duskwall'] });
  assert.equal(P.nextScene(plan, 'harvest'), 'watch');
  assert.equal(P.nextScene(plan, 'watch'), 'duskwall');
  assert.equal(P.nextScene(plan, 'harvest', ['watch']), 'duskwall');
  assert.equal(P.nextScene(plan, 'harvest', ['watch', 'duskwall']), 'harvest', 'only itself left');
  assert.equal(P.nextScene(plan, 'harvest', ['harvest', 'watch', 'duskwall']), null, 'all benched');
});

await test('the ambient controller is not reachable without a mount: the module-level calls are no-ops', () => {
  assert.equal(D.ambient.state(), null); assert.equal(D.ambient.post('watch', {}), false);
  assert.doesNotThrow(() => { D.ambient.setPlan({}); D.ambient.cover(); D.ambient.uncover(); });
});

/* ---------- corner status ---------- */
await test('status: waiting, updated, trouble and denied', () => {
  const at = new Date(2026, 9, 17, 9, 5).toISOString();
  assert.equal(P.formatTime(at), '09:05'); assert.equal(P.formatTime(null), ''); assert.equal(P.formatTime('nonsense'), '');
  assert.deepEqual(P.statusView({ state: 'connecting' }, 0, null), { dot: 'idle', text: 'Connecting…' });
  assert.deepEqual(P.statusView({ state: 'live' }, 0, null), { dot: 'ok', text: 'Waiting for the GM' });
  assert.deepEqual(P.statusView({ state: 'live' }, 4, at), { dot: 'ok', text: 'Updated 09:05' });
  assert.equal(P.statusView({ state: 'retrying' }, 4, at).dot, 'warn');
  assert.equal(P.statusView({ state: 'offline' }, 4, at).text, 'Offline, retrying · last update 09:05');
  assert.equal(P.statusView({ state: 'denied' }, 0, null).dot, 'bad');
});

/* ---------- overlays (Pure.cleanOverlay, overlayStep, clockWedges, dawnPhases, overlayCard) ---------- */
const OVC = { id: 'ov-1', kind: 'clock', ms: 8000, name: 'Invented Fuse', size: 6, filled: 2 };
await test('overlay: cleanOverlay keeps each kind with only its own fields', () => {
  assert.deepEqual(P.cleanOverlay(OVC), OVC);
  assert.deepEqual(P.cleanOverlay({ id: 'n', kind: 'npc', ms: 20000, npcId: 'npc_x' }), { id: 'n', kind: 'npc', ms: 20000, npcId: 'npc_x' });
  assert.deepEqual(P.cleanOverlay({ id: 'd', kind: 'fx', ms: 30000, fx: 'dawn' }), { id: 'd', kind: 'fx', ms: 30000, fx: 'dawn' });
  assert.deepEqual(P.cleanOverlay({ id: 't', kind: 'text', ms: 5000, text: '  a  b\n c ' }), { id: 't', kind: 'text', ms: 5000, text: 'a b c' });
  /* the server's `at`, and anything smuggled in beside the fields, does not survive */
  const smug = P.cleanOverlay({ ...OVC, at: '2026-10-28T00:00:00Z', text: 'smuggled', npcId: 'npc_x', svg: '<svg/>', description: 'secret' });
  assert.deepEqual(Object.keys(smug).sort(), ['filled', 'id', 'kind', 'ms', 'name', 'size']);
  assert.deepEqual(Object.keys(P.cleanOverlay({ id: 'd', kind: 'fx', ms: 30000, fx: 'dawn', text: 'x', name: 'y' })).sort(), ['fx', 'id', 'kind', 'ms']);
});
await test('overlay: cleanOverlay refuses (null) anything outside the bounds, rather than repairing it', () => {
  const bad = [
    undefined, null, 'x', 5, [], {}, { ...OVC, id: '' }, { ...OVC, id: '  ' }, { ...OVC, id: 'i'.repeat(41) }, { ...OVC, id: 5 }, { ...OVC, id: undefined },
    { ...OVC, kind: 'wire' }, { ...OVC, kind: undefined }, { ...OVC, kind: 'Clock' },
    { ...OVC, ms: 999 }, { ...OVC, ms: 180001 }, { ...OVC, ms: 5000.5 }, { ...OVC, ms: '5000' }, { ...OVC, ms: NaN }, { ...OVC, ms: Infinity }, { ...OVC, ms: undefined },
    { ...OVC, name: '' }, { ...OVC, name: 'n'.repeat(61) }, { ...OVC, name: 5 }, { ...OVC, size: 5 }, { ...OVC, size: '6' }, { ...OVC, size: 14 },
    { ...OVC, filled: 7 }, { ...OVC, filled: -1 }, { ...OVC, filled: 1.5 }, { ...OVC, filled: '2' }, { ...OVC, size: 4, filled: 5 },
    { id: 'n', kind: 'npc', ms: 5000 }, { id: 'n', kind: 'npc', ms: 5000, npcId: 'has space' }, { id: 'n', kind: 'npc', ms: 5000, npcId: '' }, { id: 'n', kind: 'npc', ms: 5000, npcId: 'a/b' },
    { id: 'n', kind: 'npc', ms: 5000, npcId: 'x'.repeat(81) }, { id: 'd', kind: 'fx', ms: 30000 }, { id: 'd', kind: 'fx', ms: 30000, fx: 'dusk' },
    { id: 't', kind: 'text', ms: 5000 }, { id: 't', kind: 'text', ms: 5000, text: '   ' }, { id: 't', kind: 'text', ms: 5000, text: 'x'.repeat(121) }, { id: 't', kind: 'text', ms: 5000, text: 5 },
  ];
  bad.forEach((b, i) => assert.equal(P.cleanOverlay(b), null, 'case ' + i + ': ' + JSON.stringify(b)));
  /* and the bounds that are allowed */
  assert.ok(P.cleanOverlay({ ...OVC, id: 'i'.repeat(40), ms: 1000, name: 'n'.repeat(60) }));
  assert.ok(P.cleanOverlay({ ...OVC, ms: 180000 }));
  [4, 6, 8, 10, 12].forEach((size) => { assert.ok(P.cleanOverlay({ ...OVC, size, filled: 0 })); assert.ok(P.cleanOverlay({ ...OVC, size, filled: size })); });
  assert.ok(P.cleanOverlay({ id: 't', kind: 'text', ms: 5000, text: 't'.repeat(120) }));
});
await test('overlay: overlayStep shows a new id once, keeps the same id, hides on null, and a cleared id can be shown afresh', () => {
  let r = P.overlayStep('', OVC);
  assert.equal(r.action, 'show'); assert.equal(r.seen, 'ov-1'); assert.deepEqual(r.overlay, OVC);
  r = P.overlayStep(r.seen, OVC); assert.equal(r.action, 'keep'); assert.equal(r.seen, 'ov-1');
  r = P.overlayStep(r.seen, { ...OVC, filled: 3 }); assert.equal(r.action, 'keep', 'the same id with other numbers is still the same overlay: it does not restart');
  r = P.overlayStep(r.seen, { ...OVC, id: 'ov-2' }); assert.equal(r.action, 'show', 'a new id replaces it'); assert.equal(r.seen, 'ov-2');
  r = P.overlayStep(r.seen, null); assert.equal(r.action, 'hide'); assert.equal(r.seen, ''); assert.equal(r.overlay, null);
  r = P.overlayStep(r.seen, undefined); assert.equal(r.action, 'keep', 'nothing to hide');
  r = P.overlayStep('', { ...OVC, id: 'ov-2' }); assert.equal(r.action, 'show', 'after a clear the same id shows again');
  r = P.overlayStep('ov-2', { ...OVC, ms: 5 }); assert.equal(r.action, 'hide', 'a malformed overlay is a null: it hides what was there');
  assert.equal(r.seen, '');
});
await test('overlay: clockWedges draws one wedge per segment from 12 o\'clock, the first `filled` on', () => {
  for (const size of [4, 6, 8, 10, 12]) {
    for (const filled of [0, 1, size - 1, size]) {
      const w = P.clockWedges(size, filled);
      assert.equal(w.length, size); assert.equal(w.filter((x) => x.on).length, filled);
      assert.deepEqual(w.map((x) => x.on), w.map((x, i) => i < filled), 'filled from the first segment');
      assert.equal(new Set(w.map((x) => x.d)).size, size, 'every wedge is its own path');
      w.forEach((x) => assert.match(x.d, /^M50 50L[-\d. ]+A46 46 0 0 1 [-\d. ]+Z$/));
    }
  }
  assert.match(P.clockWedges(4, 0)[0].d, /^M50 50L50 4A46 46 0 0 1 96 50Z$/, 'the first quarter runs from 12 to 3 o\'clock');
});
await test('overlay: dawnPhases is a 2 s ramp, a hold, a 2 s fade in 30 s; reduced motion is white at once and straight back', () => {
  assert.deepEqual(P.dawnPhases(30000, false), { ramp: 2000, hold: 26000, fade: 2000 });
  assert.deepEqual(P.dawnPhases(30000, true), { ramp: 0, hold: 30000, fade: 0 });
  for (const ms of [1000, 1500, 3999, 4000, 8000, 30000, 180000]) {
    const a = P.dawnPhases(ms, false), b = P.dawnPhases(ms, true);
    assert.equal(a.ramp + a.hold + a.fade, ms); assert.equal(b.ramp + b.hold + b.fade, ms);
    assert.ok(a.ramp <= 2000 && a.hold > 0 && a.fade === a.ramp, 'ms ' + ms);
  }
});
await test('overlay: cleanOverlay keeps the age the server reports (whole ms) and leaves a bad one off', () => {
  assert.equal(P.cleanOverlay({ ...OVC, age: 4200 }).age, 4200);
  assert.ok(!('age' in P.cleanOverlay(OVC)) && !('age' in P.cleanOverlay({ ...OVC, age: 0 })));
  for (const age of [-1, 1.5, '3000', null, 180001, NaN]) assert.ok(!('age' in P.cleanOverlay({ ...OVC, age })), String(age));
  assert.equal(P.overlayStep('', { ...OVC, age: 900 }).overlay.age, 900);
});
await test('overlay: dawnPlan, a dawn that ARRIVES on a running page: the whole show, the hold shortened by the poll lag, ending at the server end', () => {
  const MS = 30000;
  let p = P.dawnPlan(MS, 0, false, false);
  assert.equal(p.init, 'pre'); assert.deepEqual(p.steps, [{ at: 30, phase: 'ramp' }, { at: 2000, phase: 'hold' }, { at: 28000, phase: 'fade' }]); assert.equal(p.end, MS); assert.equal(p.ramp, 2000);
  for (const age of [1, 1500, 2500, 4000, 20000, 25999]) {   /* a tap seen late still warms up, holds, fades, and ends where the server does */
    p = P.dawnPlan(MS, age, false, false);
    assert.equal(p.init, 'pre', 'age ' + age); assert.equal(p.ramp, 2000); assert.equal(p.fade, 2000); assert.equal(p.end, MS - age);
    assert.deepEqual(p.steps.map((x) => x.phase), ['ramp', 'hold', 'fade']); assert.equal(p.steps[2].at, MS - age - 2000, 'the fade starts 2 s before the end');
  }
  p = P.dawnPlan(MS, 27000, false, false);   /* no room for a ramp and a fade: carries on instead */
  assert.equal(p.init, 'hold'); assert.equal(p.end, 3000);
  p = P.dawnPlan(MS, 12000, true, false); assert.equal(p.init, 'hold'); assert.deepEqual(p.steps, []); assert.equal(p.end, 18000, 'reduced motion: white to the end');
  assert.equal(P.dawnPlan(MS, MS, false, false), null);
});
await test('overlay: dawnPlan, a dawn FOUND on a page that was just loaded: carries on from where it has reached, never the warm start again, to the same end', () => {
  const MS = 30000;
  let p = P.dawnPlan(MS, 0, false, true); assert.equal(p.init, 'pre'); assert.equal(p.end, MS);
  p = P.dawnPlan(MS, 500, false, true);   /* inside the ramp: opens dark, runs the rest of the ramp (1.5 s) */
  assert.equal(p.init, 'pre'); assert.equal(p.ramp, 1500); assert.deepEqual(p.steps, [{ at: 30, phase: 'ramp' }, { at: 1500, phase: 'hold' }, { at: 27500, phase: 'fade' }]); assert.equal(p.end, 29500);
  p = P.dawnPlan(MS, 10000, false, true); /* in the hold: white at once */
  assert.equal(p.init, 'hold'); assert.equal(p.ramp, 0); assert.deepEqual(p.steps, [{ at: 18000, phase: 'fade' }]); assert.equal(p.end, 20000);
  p = P.dawnPlan(MS, 29000, false, true); /* in the fade: only the rest of the fade */
  assert.equal(p.init, 'fade'); assert.equal(p.fade, 1000); assert.deepEqual(p.steps, []); assert.equal(p.end, 1000);
  assert.equal(P.dawnPlan(MS, MS, false, true), null); assert.equal(P.dawnPlan(MS, MS + 5, false, true), null);
  p = P.dawnPlan(MS, 12000, true, true); assert.equal(p.init, 'hold'); assert.deepEqual(p.steps, []); assert.equal(p.end, 18000);
  for (const age of [1, 1999, 2000, 2001, 27999, 28000, 28001, 29999]) assert.equal(P.dawnPlan(MS, age, false, true).end, MS - age, 'age ' + age);
  for (const age of [2000, 10000, 27999]) assert.notEqual(P.dawnPlan(MS, age, false, true).init, 'pre', 'past the ramp it never goes back to the warm start: ' + age);
});
await test('overlay: overlayCard builds the card from the validated fields; an NPC card takes the player-safe fields only', () => {
  const clk = P.overlayCard(P.cleanOverlay(OVC), null);
  assert.equal(clk.kind, 'clock'); assert.equal(clk.name, 'Invented Fuse'); assert.equal(clk.count, '2 / 6'); assert.equal(clk.wedges.length, 6);
  assert.deepEqual(P.overlayCard(P.cleanOverlay({ id: 't', kind: 'text', ms: 5000, text: 'Invented line.' }), null), { kind: 'text', text: 'Invented line.', size: 'xl' });
  assert.deepEqual(P.overlayCard(P.cleanOverlay({ id: 'd', kind: 'fx', ms: 30000, fx: 'dawn' }), null), { kind: 'fx', fx: 'dawn' });
  assert.equal(P.overlayCard(null, null), null);
  /* the NPC card is drawn from what the SERVER joined to the overlay at read time (`npc`, present only while the NPC is revealed); the page reads nothing else */
  const raw = { id: 'n', kind: 'npc', ms: 20000, npcId: 'npc_x' };
  const joined = { name: 'Invented Person', alias: 'Inky', role: 'Clerk', faction: 'The Invented Guild', spec: { heightIn: 60 } };
  const o = P.cleanOverlay({ ...raw, npc: joined });
  const c = P.overlayCard(o);
  assert.deepEqual(c, { kind: 'npc', name: 'Invented Person', alias: 'Inky', sub: 'Clerk · The Invented Guild', spec: { heightIn: 60 } });
  /* whatever else rides on the joined object is not copied: the view model keeps the five fields */
  const dirty = P.cleanOverlay({ ...raw, npc: { ...joined, description: 'A long description.', gmNotes: 'SECRET-NOTE', tags: ['secret-tag'], revealed: true } });
  assert.deepEqual(Object.keys(dirty.npc).sort(), ['alias', 'faction', 'name', 'role', 'spec']);
  assert.ok(!/SECRET|secret|description|tags|revealed/.test(JSON.stringify(P.overlayCard(dirty))), 'no gmNotes, tags, description or revealed flag on the card');
  assert.equal(P.overlayCard(P.cleanOverlay(raw)), null, 'an npc overlay the server did not join (no `npc`) draws nothing at all');
  assert.equal(P.overlayCard(P.cleanOverlay({ ...raw, npc: 'x' })), null, 'a junk npc draws nothing');
  assert.equal(P.overlayCard(P.cleanOverlay({ ...raw, npc: { ...joined, name: '' } })), null, 'a nameless NPC draws nothing');
  assert.equal(P.overlayCard(P.cleanOverlay({ id: 't', kind: 'text', ms: 5000, text: 'Invented line.', npc: joined })).kind, 'text', 'an npc key on another kind is ignored');
  assert.ok(!('npc' in P.cleanOverlay({ id: 't', kind: 'text', ms: 5000, text: 'x', npc: joined })), 'and not kept');
});
await test('overlay: `auto` (the autopilot sent it) is kept as a boolean true and nothing else; a name beside an npc id is dropped', () => {
  assert.equal(P.cleanOverlay({ ...OVC, auto: true }).auto, true);
  for (const a of [false, 'true', 1, null, undefined]) assert.ok(!('auto' in P.cleanOverlay({ ...OVC, auto: a })), String(a));
  assert.deepEqual(Object.keys(P.cleanOverlay({ id: 'n', kind: 'npc', ms: 20000, npcId: 'npc_x', name: 'LEAK', auto: true })).sort(), ['auto', 'id', 'kind', 'ms', 'npcId'], 'a name beside an npc id is dropped');
});
await test('overlay: the ambient plan is unchanged by overlay and auto, and no model text can reach a card (the page draws text, never markup)', () => {
  const want = P.ambientPlan({});
  assert.deepEqual(P.ambientPlan({ overlay: OVC, auto: true }), want);
  assert.ok(!('overlay' in want) && !('auto' in want));
  const src = fs.readFileSync(path.join(ROOT, 'app', 'display-page.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const sinks = code.match(/\.(innerHTML|outerHTML)\s*=[^;]*|insertAdjacentHTML|document\.write|createContextualFragment/g) || [];
  assert.deepEqual(sinks.map((x) => x.trim()).filter((x) => x !== ".innerHTML = ''"), ['.innerHTML = html'], 'the only markup sink is the rules entry, rendered by B68Markdown: ' + JSON.stringify(sinks));
  const ov = code.slice(code.indexOf('s.ov = {'), code.indexOf('s.crew = null;'));
  assert.ok(ov.length > 500 && !/innerHTML|insertAdjacentHTML|\.href|setAttribute\(\s*['"]href/.test(ov), 'the overlay controller draws with textContent and nodes only');
});

await test('no way to the GM routes from the display: no link, no #gm, no href set anywhere in display-page.js', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'display-page.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert.ok(!/#gm\b/.test(code), 'display-page.js names #gm');
  assert.ok(!/\.href\s*=|setAttribute\(\s*['"]href['"]|el\(\s*['"]a['"]/.test(code), 'display-page.js makes a link');
  assert.ok(!/location\s*\.\s*(hash|href|assign|replace)/.test(code), 'display-page.js navigates');
  assert.ok(!/dp-hatch|dp-back/.test(fs.readFileSync(path.join(ROOT, 'app', 'display.css'), 'utf8')), 'the hold-to-reveal styles are gone');
});

/* ---------- the band beside the map (VV3, design 5.3): the hud as the page draws it ---------- */
/* a hud in the shape the server's cleanMission leaves (optional strings are "" rather than absent); the venue and names are invented */
const HUD = {
  time: '22:30', label: 'Gala night',
  now: [{ text: 'The photo call', where: 'The floor', until: '23:00' }],
  next: [{ text: 'The toast', where: 'Showroom', at: '00:00', inMin: 90 }],
  night: { beats: 16, start: 2, cur: 6, marks: [{ i: 3, icon: 'star', text: 'The speeches' }, { i: 12, icon: 'diamond', text: 'The fireworks' }] },
  alarm: { name: 'Fuse', size: 6, filled: 2, text: 'A door slams' },
  crew: [{ name: 'Ada', costume: 'Cook', icon: 'tray', room: 'Cocktail lounge' }, { name: 'Bo', costume: 'Guest', icon: 'mask', room: '' }],
  target: { room: '' }, ways: { found: 2, total: 7 }
};
await test('band: no hud, or junk, is no band', () => {
  for (const h of [null, undefined, 3, 'x', []]) assert.equal(P.bandModel(h), null);
});
await test('band: the time and label, NOW (with "until"), NEXT (with "in 1 h 30"), alarm, crew and ways, in the design\'s words', () => {
  const m = P.bandModel(HUD);
  assert.equal(m.time, '22:30'); assert.equal(m.label, 'Gala night');
  assert.deepEqual(m.now, [{ text: 'The photo call', where: 'The floor', until: 'until 23:00' }]);
  assert.equal(m.next.length, 1); assert.equal(m.next[0].inText, 'in 1 h 30'); assert.equal(m.next[0].soon, false); assert.equal(m.next[0].kicker, 'Next');
  assert.deepEqual(m.alarm, { name: 'Fuse', size: 6, filled: 2, count: '2 of 6', text: 'A door slams' });
  assert.deepEqual(m.crew.map((c) => [c.name, c.costume, c.badge, c.room]), [['Ada', 'Cook', 'T', 'Cocktail lounge'], ['Bo', 'Guest', 'M', '']]);
  assert.equal(m.ways, 'Ways found: 2 of 7');
});
await test('band: inText reads minutes the way the table says them', () => {
  assert.deepEqual([0, 15, 45, 60, 90, 125, null, 'x', -5].map(P.inText), ['now', 'in 15 min', 'in 45 min', 'in 1 h', 'in 1 h 30', 'in 2 h 5', '', '', 'now']);
});
await test('band: NEXT turns amber at one beat or less, and says so in words (a "Next, soon" label), not by colour alone', () => {
  const at = (inMin) => P.bandModel({ ...HUD, next: [{ text: 'The toast', where: '', at: '', inMin }] }).next[0];
  assert.equal(P.BAND_BEAT, 15);
  assert.equal(at(16).soon, false); assert.equal(at(15).soon, true); assert.equal(at(0).soon, true);
  assert.equal(at(15).kicker, 'Next, soon'); assert.equal(at(15).inText, 'in 15 min'); assert.equal(at(0).inText, 'now');
});
await test('band: the night is one square per beat: before the start shaded, past dark, the current outlined, marks keep their icon', () => {
  const sq = P.bandModel(HUD).night.squares;
  assert.equal(sq.length, 16);
  assert.deepEqual(sq.map((q) => q.state).slice(0, 8), ['before', 'before', 'past', 'past', 'past', 'past', 'cur', 'ahead']);
  assert.equal(sq[3].mark.icon, 'star'); assert.equal(sq[12].mark.icon, 'diamond'); assert.equal(sq[4].mark, null);
  assert.equal(sq.filter((q) => q.state === 'cur').length, 1);
  const none = P.bandModel({ ...HUD, night: { beats: 4, start: 0, cur: -1, marks: [{ i: 99, icon: 'star', text: 'off the end' }] } }).night;
  assert.deepEqual(none.squares.map((q) => q.state), ['ahead', 'ahead', 'ahead', 'ahead']); assert.equal(none.marks.length, 0);
  assert.equal(P.bandModel({ ...HUD, night: null }).night, null);
});
await test('band: empty strings and nulls leave their section out (truthiness, not key presence); ways only with a total', () => {
  const m = P.bandModel({ time: '22:30', label: '', now: [], next: [], night: null, alarm: null, crew: [{ name: '', costume: '', icon: '' }], target: null, ways: { found: 0, total: 0 } });
  assert.equal(m.label, ''); assert.deepEqual(m.now, []); assert.deepEqual(m.next, []); assert.equal(m.alarm, null); assert.deepEqual(m.crew, []); assert.equal(m.ways, null);
  assert.equal(P.bandModel({ ...HUD, ways: { found: 9, total: 7 } }).ways, 'Ways found: 7 of 7', 'found is held to the total');
  assert.equal(P.bandModel({ ...HUD, alarm: { name: 'Fuse', size: 6, filled: 99, text: '' } }).alarm.count, '6 of 6');
});
await test('band: the signature moves with the content and not with a repeat', () => {
  assert.equal(P.bandSig(P.bandModel(HUD)), P.bandSig(P.bandModel(JSON.parse(JSON.stringify(HUD)))));
  assert.notEqual(P.bandSig(P.bandModel(HUD)), P.bandSig(P.bandModel({ ...HUD, time: '22:45' })));
  assert.equal(P.bandSig(null), '');
});
await test('band: missionPart reads { hseq, hud }, { hseq, hud: null } and { hseq, unchanged } and ignores the rest', () => {
  assert.deepEqual(P.missionPart({ mission: { hseq: 3, hud: { time: 'x' } } }), { hseq: 3, hud: { time: 'x' } });
  assert.deepEqual(P.missionPart({ mission: { hseq: 0, hud: null } }), { hseq: 0, hud: null });
  assert.deepEqual(P.missionPart({ mission: { hseq: 3, unchanged: true } }), { hseq: 3, unchanged: true });
  for (const bad of [{}, { mission: null }, { mission: { hud: {} } }, { mission: { hseq: 'a', hud: {} } }, { mission: { hseq: 1, hud: 'x' } }, { mission: { hseq: 1 } }]) assert.equal(P.missionPart(bad), null);
});
await test('band: the poller sends hseq (0 first, then the one it holds), keeps the 4 s beat, and hands the hud over only when it moved', async () => {
  const got = [], calls = [];
  const r = rig({ onMission: (h) => got.push(h), fetch: (seq, aseq, sseq, hseq) => { calls.push({ hseq, at: r.c.now }); return r.g.handler(hseq); } });
  r.g.handler = (hseq) => Promise.resolve(hseq === 2 ? { seq: 1, unchanged: true, mission: { hseq: 2, unchanged: true } } : { ...ok(1, { kind: 'blank' }), mission: { hseq: 2, hud: HUD } });
  r.poller.start(); await r.c.advance(0); await r.c.advance(BEAT); await r.c.advance(BEAT);
  assert.deepEqual(calls.map((c) => [c.hseq, c.at]), [[0, 0], [2, 4000], [2, 8000]], 'hseq 0 first, then the held one, on the same 4 s beat');
  assert.equal(got.length, 1); assert.equal(got[0].time, '22:30');
  r.g.handler = () => Promise.resolve({ seq: 1, unchanged: true, mission: { hseq: 0, hud: null } });
  await r.c.advance(BEAT); assert.equal(got.length, 2); assert.equal(got[1], null, 'a removed mission clears the band');
  r.poller.stop();
});
await test('band: an answer with no mission part (an older server) calls onMission never and does not stop the display', async () => {
  const got = [], r = rig({ onMission: (h) => got.push(h) });
  r.g.handler = () => Promise.resolve(ok(1, { kind: 'text', text: 'a' }));
  r.poller.start(); await r.c.advance(0); assert.equal(got.length, 0); assert.equal(r.data.length, 1); r.poller.stop();
});
await test('band: the page paints the band with text nodes only and no control, and the band takes no taps', () => {
  const code = fs.readFileSync(path.join(ROOT, 'app', 'display-page.js'), 'utf8');
  const a = code.indexOf('function bandPaint'), b = code.indexOf('function bandFit');
  assert.ok(a > 0 && b > a, 'bandPaint found');
  const body = code.slice(a, b);
  assert.ok(!/innerHTML|insertAdjacentHTML|el\(\s*'(button|a|input)'|addEventListener|\bon\(/.test(body), 'no markup sink, no control, no listener in the band');
  const css = fs.readFileSync(path.join(ROOT, 'app', 'display.css'), 'utf8').replace(/\s+/g, ' ');
  assert.ok(/\.dp-band \{[^}]*pointer-events: none/.test(css), 'the band takes no taps');
  assert.ok(/prefers-reduced-motion: reduce\) \{ \.dp-band\.dp-b-fade \{ animation: none/.test(css), 'reduced motion: no fade');
});

await test('the module exposes the page interface', () => {
  assert.equal(typeof D.mount, 'function'); assert.equal(typeof D.unmount, 'function');
  assert.doesNotThrow(() => D.unmount());                                             // unmounting nothing is fine
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
