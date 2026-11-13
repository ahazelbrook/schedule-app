// players-board (IP6 of the players' screen build, setting stage.players): the planning board's pins, their drawing and the cap. No browser.
//   the stored key (boardPins): clean pins, the 12-pin and 60-character caps, six sites at most, faces at most four
//   the drawing: each kind a 540 x 600 card that passes the display's own sanitiser (Pure.sanitiseSvg, on a small XML parser standing in for
//   DOMParser) and the planning board scene's checker (no script, no handler, no outside reference); three lines at most, never clipped;
//   a face is the figure kit's portrait of a REVEALED NPC under the name the players know, its ids its own on every draw
//   the door: every token passes the page's token screen (P.tokenScreen) as a token of its own; one in a room the players do not know is dropped;
//   one that names a hidden name is refused; the real map kit pins a card to its room with one more red string; a leaking board is null
//   the wiring: scoreScene unchanged (three arguments), one score write, the Board block only with the setting on, the shell's arrival
//   node checks/runtime/players-board.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sites } from './fixtures/gm/map-kit1-cases.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const req = createRequire(import.meta.url);
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const read = (p) => fs.readFileSync(path.join(APP, p), 'utf8');

const B = req(path.join(APP, 'gm', 'players-board.js'));
const D = req(path.join(APP, 'display-page.js')).Pure;
const P = req(path.join(APP, 'gm-page.js'))._pure;
const K = req(path.join(APP, 'maps', 'map-kit.js'));
const FK = req(path.join(APP, 'figures', 'figure-kit.js'));

/* ---------- a small XML parser standing in for DOMParser('image/svg+xml') (the same stand-in as display.test.mjs) ---------- */
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
  });
}
const xesc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    const bad = () => ({ documentElement: mkNode(1, 'parsererror'), getElementsByTagName: () => [1] });
    const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!(?:DOCTYPE|ENTITY)[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/gy;
    let m, top = null; const stack = [];
    while (re.lastIndex < src.length) {
      const at = re.lastIndex; m = re.exec(src);
      if (!m) return bad();
      const whole = m[0];
      if (whole.startsWith('<!--') || whole.startsWith('<?') || whole.startsWith('<!')) continue;
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
    if (n.nodeType === 3) return xesc(n._text);
    const a = n.attributes.map((x) => ' ' + x.name + '="' + xesc(x.value) + '"').join('');
    const kids = n.childNodes.map((c) => this.serializeToString(c)).join('');
    return '<' + n.nodeName + a + (kids ? '>' + kids + '</' + n.nodeName + '>' : '/>');
  }
}
const ENV = { DOMParser: FakeDOMParser, XMLSerializer: FakeXMLSerializer };
/* the planning board scene's checker (app/ambient/planning-board.html parseSvg): what it would strip, so nothing must be there to strip */
function shellStrips(svg) {
  const doc = new FakeDOMParser().parseFromString(svg); const root = doc.documentElement, out = [];
  if (root.localName !== 'svg') return ['root ' + root.localName];
  const walk = (n) => {
    const t = String(n.localName).toLowerCase();
    if (['script', 'foreignobject', 'iframe', 'object', 'embed'].includes(t)) out.push(t);
    for (const a of n.attributes) { const k = a.name.toLowerCase(); if (k.startsWith('on')) out.push(k); if ((k === 'href' || k === 'xlink:href') && !(a.value.trim()[0] === '#' || /^data:image\//i.test(a.value.trim()))) out.push(k); }
    n.childNodes.filter((c) => c.nodeType === 1).forEach(walk);
  };
  walk(root);
  return out;
}
const ids = (svg) => [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
const strings = (svg) => (svg.match(/stroke="#a51d16"/g) || []).length;

/* invented cast (the repo's fixtures): a revealed NPC, a known-as one, a hidden one */
const NPCS = {
  'npc-mabel': { name: 'Mabel Quist', alias: 'Mab', revealed: true, tags: ['major'], spec: { name: 'Mabel Quist', notes: 'GM-ONLY-NOTE' } },
  'npc-dov': { name: 'Dov Kessler', alias: 'Kessler', revealed: true, tags: ['known-as'], spec: { name: 'Dov Kessler', plate: 'Dov Kessler' } },
  'npc-hid': { name: 'GM-ONLY-Hidden Person', alias: '', revealed: false, tags: [], spec: { name: 'GM-ONLY-Hidden Person' } }
};

test('the stored pins: only the known shape, kinds and caps (8 pins, 60 characters); a face needs an NPC, a card needs words', () => {
  const ok = { id: 'p1', room: 'Showroom', kind: 'line', text: '  The house  takes a cut  ' };
  assert.deepEqual(B.clean([ok]), [{ id: 'p1', room: 'Showroom', kind: 'line', text: 'The house takes a cut' }]);
  assert.deepEqual(B.clean([{ id: 'p2', room: 'Showroom', kind: 'face', text: 'x', npcId: 'npc-mabel' }])[0], { id: 'p2', room: 'Showroom', kind: 'face', text: 'x', npcId: 'npc-mabel' });
  assert.deepEqual(B.clean([{ id: 'p2', room: 'Showroom', kind: 'face', text: '' }, { id: 'p3', room: 'Showroom', kind: 'line', text: ' ' }, { id: 'p4', room: '', kind: 'line', text: 'x' },
    { id: 'P5', room: 'A', kind: 'line', text: 'x' }, { id: 'p6', room: 'A', kind: 'rumour', text: 'x' }, null, 'p7']), [], 'every malformed pin is dropped');
  assert.equal(B.clean([{ id: 'p1', room: 'A', kind: 'item', text: 'x'.repeat(90) }])[0].text.length, 60, 'the text is capped at 60');
  const many = Array.from({ length: 20 }, (_, i) => ({ id: 'p' + i, room: 'A', kind: 'question', text: 'Who ' + i }));
  assert.equal(B.clean(many).length, 8, 'at most 8 pins (the overseer, 14/11)');
  assert.equal(B.clean([ok, ok]).length, 1, 'an id once');
  assert.deepEqual(B.KINDS, ['line', 'face', 'item', 'route', 'question']);
});

test('the key: boardPins, one entry a site, six sites at most (the oldest goes as null); old documents read as no pins', () => {
  assert.equal(B.KEY, 'boardPins');
  assert.deepEqual(B.pinsOf({}, 'The Pelican Rooms'), []);
  assert.deepEqual(B.pinsOf({ boardPins: 'junk' }, 'The Pelican Rooms'), []);
  const doc = { boardPins: {} };
  for (let i = 0; i < 6; i++) doc.boardPins['Site ' + i] = { pins: [], at: 1000 + i };
  const p = B.patchFor(doc, 'The Pelican Rooms', [{ id: 'p1', room: 'Showroom', kind: 'line', text: 'Hello' }], 5000);
  assert.deepEqual(p.boardPins['The Pelican Rooms'], { pins: [{ id: 'p1', room: 'Showroom', kind: 'line', text: 'Hello' }], at: 5000 });
  assert.equal(p.boardPins['Site 0'], null, 'the oldest site goes');
  assert.ok(!('Site 5' in p.boardPins), 'the others are untouched (a deep merge keeps them)');
  assert.equal(Object.keys(p).join(), 'boardPins', 'nothing but the new key');
});

test('the text: five lines at most, never clipped, for every length to 60 and for words longer than a line', () => {
  const words = 'the guard on the side door changes at ten and nobody checks the coal chute after dark'.split(' ');
  const texts = ['Ten', 'x'.repeat(60), 'Supercalifragilisticexpialidociousness and then some more of it', 'a'.repeat(25) + ' ' + 'b'.repeat(34)];
  for (let n = 1; n <= words.length; n++) texts.push(words.slice(0, n).join(' ').slice(0, 60));
  for (const t of texts) {
    const f = B.fitText(t);
    assert.ok(f.lines.length >= 1 && f.lines.length <= 5, t + ': ' + f.lines.length + ' lines');
    assert.equal(f.lines.join('').replace(/ /g, ''), t.slice(0, 60).replace(/ /g, ''), t + ': every character is set');
    assert.ok(f.size >= 40 && f.size <= 110, t + ': size ' + f.size);
  }
  assert.ok(B.fitText('Ten').size > B.fitText('x'.repeat(60)).size, 'a short line is set larger');
  for (const t of ['The croupier deals seconds after midnight on the last table!', 'Who holds the key to the cage behind the counting room door?']) assert.ok(B.fitText(t, 500, 334).size >= 60, t + ': 60 characters set at 60 units or more, so 26 px on a 234 px card (' + B.fitText(t, 500, 334).size + ')');
});

test('each card passes the display\'s own sanitiser and the scene\'s checker, is 540 x 600, carries its words, and each kind looks different', () => {
  const fills = new Set();
  for (const kind of ['line', 'item', 'route', 'question']) {
    const pin = { id: 'p3', room: 'Showroom', kind, text: 'Mab & "Kessler" <meet> at ten' };
    const t = B.token(pin, {});
    assert.deepEqual(Object.keys(t).sort(), ['label', 'room', 'svg'], 'the token shape the page screens');
    const r = D.sanitiseSvg(t.svg, ENV);
    assert.ok(r.ok, kind + ': ' + r.reason);
    assert.equal(r.markup.length > 0 && Number(D.cleanElement(new FakeDOMParser().parseFromString(t.svg).documentElement)), 0, kind + ': the sanitiser removes nothing');
    assert.deepEqual(r.viewBox, { x: 0, y: 0, w: 540, h: 600 }, kind + ': the kit\'s token frame');
    assert.deepEqual(shellStrips(t.svg), [], kind + ': the scene strips nothing');
    assert.ok(!/<script|javascript:|\son[a-z]+=|href=|style=/i.test(t.svg), kind + ': nothing active');
    assert.ok(t.svg.includes('<title>Mab &amp; &quot;Kessler&quot; &lt;meet&gt; at ten</title>'), kind + ': the words whole, escaped');
    const set = [...t.svg.matchAll(/font-weight="800"[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]).join(' ');
    assert.equal(set.replace(/ /g, ''), 'Mab &amp; &quot;Kessler&quot; &lt;meet&gt; at ten'.replace(/ /g, ''), kind + ': every word set on the card, escaped');
    assert.equal(t.label, B.WORD[kind]);
    fills.add(t.svg.match(/<rect width="540" height="600" fill="([^"]+)"/)[1]);
  }
  assert.equal(fills.size, 4, 'four kinds, four grounds');
});

test('a face: the figure kit\'s portrait of a revealed NPC, its ids its own on every draw; a hidden NPC is no token; known-as goes by the alias', () => {
  const a = B.token({ id: 'p4', room: 'Showroom', kind: 'face', text: '', npcId: 'npc-mabel' }, { npcs: NPCS, K: FK });
  const b = B.token({ id: 'p4', room: 'Showroom', kind: 'face', text: '', npcId: 'npc-mabel' }, { npcs: NPCS, K: FK });
  assert.equal(a.label, 'Mabel Quist');
  assert.ok(D.sanitiseSvg(a.svg, ENV).ok, 'the portrait passes the display\'s sanitiser'); assert.deepEqual(shellStrips(a.svg), []);
  assert.ok(a.svg.length > 20000 && a.svg.length < 120000, 'a portrait, ' + a.svg.length + ' bytes');
  const ia = ids(a.svg), ib = ids(b.svg);
  assert.ok(ia.length > 3, 'the portrait has ids'); assert.ok(ia.every((x) => /^pb-p4-/.test(x)), 'every id carries the draw\'s prefix: ' + ia.filter((x) => !/^pb-p4-/.test(x)).slice(0, 3));
  assert.ok(ia.every((x) => !ib.includes(x)), 'two draws share no id');
  assert.equal(new Set(ia).size, ia.length, 'no id twice in one draw');
  assert.ok(!/GM-ONLY-NOTE/.test(a.svg), 'the spec\'s notes never travel');
  assert.equal(B.token({ id: 'p5', room: 'Showroom', kind: 'face', text: '', npcId: 'npc-hid' }, { npcs: NPCS, K: FK }), null, 'a hidden NPC is no token');
  assert.equal(B.token({ id: 'p5', room: 'Showroom', kind: 'face', text: '', npcId: 'nobody' }, { npcs: NPCS, K: FK }), null);
  const k = B.token({ id: 'p6', room: 'Showroom', kind: 'face', text: '', npcId: 'npc-dov' }, { npcs: NPCS, K: FK });
  assert.equal(k.label, 'Kessler'); assert.ok(!/Dov Kessler/.test(k.svg), 'the full name is never drawn');
  const plain = B.token({ id: 'p7', room: 'Showroom', kind: 'face', text: '', npcId: 'npc-mabel' }, { npcs: NPCS, K: null });
  assert.ok(D.sanitiseSvg(plain.svg, ENV).ok && /<text[^>]*>MQ<\/text>/.test(plain.svg), 'no figure kit: a plate with the initials');
});

const ROLL = sites().pelicanK1;
const PUB = ROLL.rooms.filter((r) => r.band === 'public').map((r) => r.name), WORK = ROLL.rooms.filter((r) => r.band === 'working').map((r) => r.name);
test('the door: each token through the page\'s token screen: a known room keeps it, an unknown room drops it, a hidden name refuses it', () => {
  const seen = ['public'], hide = ['GM-ONLY-Hidden Person'];
  const t1 = B.token({ id: 'p1', room: PUB[0], kind: 'line', text: 'Bring a coat' }, {});
  assert.equal(P.tokenScreen([t1], ROLL, seen, hide).tokens.length, 1, 'a card in a known room passes');
  const t2 = B.token({ id: 'p2', room: WORK[0], kind: 'line', text: 'Bring a coat' }, {});
  assert.deepEqual(P.tokenScreen([t2], ROLL, seen, hide), { tokens: [], refused: [] }, 'a room the players do not know: waiting, not refused');
  assert.equal(P.tokenScreen([t2], ROLL, ['public', 'room:' + WORK[0]], hide).tokens.length, 1, 'the room opened on its own: it goes up');
  const t3 = B.token({ id: 'p3', room: PUB[0], kind: 'question', text: 'Who is GM-ONLY-Hidden Person?' }, {});
  assert.ok(P.tokenScreen([t3], ROLL, seen, hide).refused.length > 0, 'a hidden NPC named on a card is refused');
  const t4 = B.token({ id: 'p4', room: PUB[0], kind: 'route', text: 'In through ' + WORK[0] }, {});
  assert.ok(P.tokenScreen([t4], ROLL, seen, hide).refused.length > 0, 'a hidden room named on a card is refused');
  assert.equal(P.tokenScreen([t4], ROLL, ['public', 'working'], hide).refused.length, 0, 'once its band is revealed, it is fair');
});

test('the real map kit: a pinned card goes on the board in its room with one more red string; the leak scan and the size cap give null', () => {
  const base = K.render(ROLL, { view: 'plan', theme: 'board', layer: 'player', reveal: ['public'], width: 1600, kit1: true }).svg;
  const t1 = B.token({ id: 'p1', room: PUB[0], kind: 'line', text: 'Bring a coat' }, {});
  const svg = B.board(ROLL, K.render, { seen: ['public'], tokens: [t1], view: 'plan', kit1: true, leaks: P.leaks });
  assert.ok(svg, 'drawn');
  assert.equal(strings(svg), strings(base) + 1, 'one more string');
  assert.match(svg, /Bring a coat/); assert.match(svg, /id="pb-p1-/);
  assert.ok(D.sanitiseSvg(svg, ENV).ok, 'the whole board passes the sanitiser');
  assert.equal(P.leaks(svg, ROLL, ['public']).length, 0);
  const unknown = B.board(ROLL, K.render, { seen: ['public'], tokens: [B.token({ id: 'p2', room: WORK[0], kind: 'line', text: 'Bring a hat' }, {})], view: 'plan', kit1: true, leaks: P.leaks });
  assert.ok(!/Bring a hat/.test(unknown || '') && strings(unknown) === strings(base), 'the kit drops a token in a room the players do not know (as the screen does first)');
  assert.equal(B.board(ROLL, K.render, { seen: ['public'], tokens: [t1], view: 'plan', leaks: () => ['x'] }), null, 'a leak: null');
  assert.equal(B.board(ROLL, () => ({ svg: '<svg>' + 'x'.repeat(700 * 1024) + '</svg>' }), { seen: ['public'], tokens: [t1], view: 'plan', leaks: () => [] }), null, 'over the cap: null');
  assert.equal(B.board(ROLL, K.render, { seen: ['public'], tokens: [], view: 'plan', leaks: P.leaks }), null, 'no pins: null (the score scene\'s own board stands)');
  const four = ['npc-mabel', 'npc-dov'].map((id, i) => B.token({ id: 'f' + i, room: PUB[i % PUB.length], kind: 'face', text: '', npcId: id }, { npcs: NPCS, K: FK }));
  const full = four.concat(['line', 'item', 'route', 'question'].map((k, i) => B.token({ id: 'c' + i, room: PUB[i % PUB.length], kind: k, text: 'x'.repeat(60) }, {})));
  const big = B.board(ROLL, K.render, { seen: ['public'], tokens: full, view: 'plan', kit1: true, leaks: P.leaks });
  assert.ok(big && big.length < 600 * 1024, 'two faces and four full cards fit the iPad\'s 600 KiB: ' + Math.round((big || '').length / 1024) + ' KiB');
  console.log('  board sizes: none ' + Math.round(base.length / 1024) + ' KiB, two faces and four cards ' + Math.round(big.length / 1024) + ' KiB; four faces is the cap (' + B.FACES_MAX + ')');
});

test('the wiring: scoreScene is unchanged, one score write, the block and the paint only with the setting on, the module in the gm bundle', () => {
  const src = read('gm-page.js');
  assert.equal(P.scoreScene.length, 3);
  assert.equal((src.match(/patchAmbient\(\{ score: built\.score \}\)/g) || []).length, 1, 'the one write');
  assert.match(src, /function pbOn\(\) \{ return !!W\.B68GmPlayersBoard && b09On\('stage\.players'\); \}/);
  assert.match(src, /\(pbOn\(\) \? '<div class="gm-pb-slot" data-pb-slot><\/div>' : ''\)/);
  assert.match(src, /if \(pbOn\(\)\) W\.B68GmPlayersBoard\.paint\(box, pbHost\(\)\);/);
  assert.match(src, /P\.tokenScreen\(\[x\.tok\], S\.locRoll, seen, hide\)/, 'each pin screened alone');
  const R = req(path.join(APP, 'routes.js')); const gm = (R.BUNDLES || R.bundles || {}).gm || [];
  if (gm.length) assert.equal(gm[gm.length - 1], 'gm/players-board.js', 'the last of the gm bundle');
  else assert.ok(read('routes.js').includes("'gm/players-screen.js', 'gm/players-board.js']"), 'the last of the gm bundle');
  const mod = read('gm/players-board.js');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|fetch\(|XMLHttpRequest|<button|!important|style=/.test(mod), 'no markup sink, no request, no hand-built button');
});

test('the scene: off is ipad/main (no players flag: the old layout, every string re-pinned one at a time); on, the players layout; arrivals on timers, simply there held still', () => {
  const h = read('ambient/planning-board.html');
  const show = h.slice(h.indexOf('function show(d){'), h.indexOf('// ---- protocol'));
  assert.ok(show.includes('if(d.players===true&&showPlayers(d,board))return;'), 'the players layout only on a message with players: true');
  assert.ok(show.includes('strings.forEach((s,i)=>T(()=>{if(g0===gen)pin(s,2600);},1500+i*2200));'), 'off: a re-sent board re-pins every string, as ipad/main');
  assert.ok(!/prev|landQ|snap\(|still\(/.test(show), 'off: no same-site branch, no snap, no held-still probe in the old path');
  assert.ok(h.includes('[id^="pb-"]'), 'a pin card is found by its id');
  assert.ok(h.includes('getComputedStyle(content).transitionDuration'), 'held still is read from transitions that do not take (the scene never names the page classes)');
  const land = h.slice(h.indexOf('function land('), h.indexOf('let prev='));
  assert.ok(land.length > 100 && !/requestAnimationFrame|animation/.test(land), 'the arrival runs on setTimeout and transitions only');
});

await test('the module follows a name hidden after the fact, writes nothing for a replayed roll, and keeps a plate in reserve for each face', async () => {
  B.reset();
  const lists = [], doc = { boardPins: { 'Site A': { pins: [{ id: 'p1', room: 'Hall', kind: 'line', text: 'Mabel Quist owns it' }, { id: 'p2', room: 'Hall', kind: 'face', text: '', npcId: 'npc-mabel' }], at: 1 } } };
  let roll = { name: 'Site A' }, hide = [];
  const host = { doc: () => doc, roll: () => roll, site: () => roll.name, rooms: () => [{ name: 'Hall', shown: true }], npcs: () => NPCS, scan: () => [], patch: () => true,
    score: () => ({ name: 'Site A' }), busy: () => false, toast: () => {}, figures: () => null, hide: () => hide, showBoard: () => Promise.resolve(true),
    setScore: (list) => { lists.push(list); return Promise.resolve({ ok: true, refused: [] }); } };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  B.paint(null, host); await tick();
  assert.equal(lists.length, 0, 'the first look only takes its bearings');
  hide = ['Mabel Quist']; B.follow(host); await tick();
  assert.equal(lists.length, 1, 'a name hidden after the fact redraws the board (the screen then drops the pin)');
  const face = lists[0].find((x) => x.pin.kind === 'face');
  assert.ok(face && face.alt && /-plate"/.test(face.alt.svg) && face.alt.label === face.tok.label, 'a face carries a plate in reserve, same room and label');
  roll = { name: 'Site A' }; hide = []; B.follow(host); B.paint(null, host); await tick();
  assert.equal(lists.length, 1, 'the roll replayed (its reveal reset): nothing written');
  hide = ['Dov Kessler']; B.follow(host); await tick();
  assert.equal(lists.length, 2, 'after that, a change is followed again');
  B.reset();
});
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
