// gm-npc-find: any NPC by name (gm.glance, RK24 of the room key build). No browser, no network, no key. The invented cast only (Dov Kessler, Mabel Quist and friends).
//   node checks/runtime/gm-npc-find.test.mjs
// The pure matcher and the notes reader, the box's markup and its state (through a fake host that throws on anything it was not meant to be asked), the listeners
// (a fake panel), the Esc entry (a fake B68GmEsc), and the sheet. The browser half is the RK24 part of glance.e2e.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/npc-find.js';
const SRC = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
const F = require(path.join(ROOT, FILE));
const U = require(path.join(ROOT, 'app/ui/ui.js'));
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const { norm, match, notesOf, answerText } = F._pure;

const CAST = [
  { id: 'npc-dov', doc: { name: 'Dov Kessler', alias: '', role: 'House security', faction: 'The Pelican Rooms', revealed: true, description: 'Watches the doors.', gmNotes: 'GM-ONLY-NOTE takes a bribe once\nTell: tired\nSignature: cross\nRelation: staff\nVoice: low and slow\nWants: a quiet shift\nKnows: who has the lift key\n' } },
  { id: 'npc-mabel', doc: { name: 'Mabel Quist', alias: 'Mab', role: 'The house', faction: 'The Pelican Rooms', revealed: true, description: 'Runs the rooms.', gmNotes: 'Tell: smirk' } },
  { id: 'npc-ada', doc: { name: 'Ada Vell', alias: ['Croupier Ada'], role: 'Croupier', revealed: true, gmNotes: '' } },
  { id: 'npc-lotte', doc: { name: 'Lotte Brand', alias: '', role: 'Doorwoman', revealed: true, gmNotes: '' } },
  { id: 'npc-zoe', doc: { name: 'Zo\u00eb M\u00e9nard', alias: '', role: 'Singer', revealed: true, gmNotes: '' } },
  { id: 'npc-ellis', doc: { name: 'Ellis Pell', alias: '', role: 'Barman', revealed: true, gmNotes: '' } },
  { id: 'npc-hid', doc: { name: 'GM-ONLY-Silent Partner', alias: '', role: 'GM-ONLY-ROLE', faction: 'GM-ONLY-FACTION', revealed: false, description: 'GM-ONLY-DESCRIPTION', gmNotes: 'Voice: GM-ONLY-VOICE\nKnows: GM-ONLY-KNOWS' } }
];
const ids = (r) => r.map((x) => x.id);
const whoBtn = (h) => h.match(/<button[^>]*gl-find-who[^>]*>/)[0];

await test('gm-npc-find: loads under Node and as a plain script, and is filled (no stub)', () => {
  assert.ok(F && typeof F.create === 'function' && !F.stub, 'filled');
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(SRC, win, { filename: FILE });
  assert.ok(win.B68GmNpcFind && typeof win.B68GmNpcFind.create === 'function' && !win.B68GmNpcFind.stub, 'window.B68GmNpcFind is the filled module');
});

await test('RK24 file: no hand-built button, no inline style, no !important, no literal over 220, and nothing that sends, stores, reveals or listens on the document', () => {
  const noComments = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/<button\b/.test(noComments), 'buttons are B68Ui parts');
  assert.ok(!/style=\\?["']/.test(noComments) && !/!\s*important/i.test(noComments), 'no inline style, no !important');
  const strings = [...noComments.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)].map((m) => (m[1] !== undefined ? m[1] : m[2]));
  assert.ok(strings.every((s) => s.length <= 220), 'no literal over 220');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|\bdocument\.addEventListener|\.reveal\s*\(|saveScene|\.show\s*\(/.test(noComments), 'no send, no storage, no reveal, no document listener');
});

/* ---------- pure ---------- */
await test('norm: case, accents, punctuation and spaces', () => {
  assert.equal(norm('  Zo\u00eb   M\u00e9nard!! '), 'zoe menard');
  assert.equal(norm("D'Arcy-O\u2019Neil"), 'd arcy o neil');
  assert.equal(norm(null), '');
  assert.equal(norm(''), '');
});
await test('match: "dov" finds Dov Kessler (and only him), whatever the case', () => {
  assert.deepEqual(ids(match(CAST, 'dov')), ['npc-dov']);
  assert.deepEqual(ids(match(CAST, 'DOV')), ['npc-dov']);
  assert.deepEqual(ids(match(CAST, ' Dov ')), ['npc-dov']);
});
await test('match: partial words, the second word, any order, accents either way', () => {
  assert.deepEqual(ids(match(CAST, 'kess')), ['npc-dov']);
  assert.deepEqual(ids(match(CAST, 'dov k')), ['npc-dov']);
  assert.deepEqual(ids(match(CAST, 'kessler dov')), ['npc-dov'], 'word order does not matter');
  assert.deepEqual(ids(match(CAST, 'zoe')), ['npc-zoe'], 'no accent typed, one on the name');
  assert.deepEqual(ids(match(CAST, 'm\u00e9nard')), ['npc-zoe'], 'an accent typed, one on the name');
  assert.deepEqual(ids(match(CAST, 'ZO\u00cb')), ['npc-zoe'], 'upper case with an accent');
});
await test('match: an alias finds them, after the name; a list of aliases works', () => {
  assert.deepEqual(ids(match(CAST, 'mab')), ['npc-mabel'], 'Mab is an alias and the start of Mabel');
  assert.deepEqual(ids(match(CAST, 'croupier')), ['npc-ada'], 'an alias in a list');
  const l = [{ id: 'a', doc: { name: 'Pat Rook', alias: 'Quill' } }, { id: 'b', doc: { name: 'Quill Hart', alias: '' } }];
  assert.deepEqual(ids(match(l, 'quill')), ['b', 'a'], 'the name before the alias');
});
await test('match: the start of a word before the inside of one; no query or no one finds nothing; bad rows are skipped', () => {
  assert.deepEqual(ids(match(CAST, 'ell')), ['npc-ellis', 'npc-ada'], 'Ellis starts with it, Vell has it inside');
  assert.deepEqual(match(CAST, ''), []);
  assert.deepEqual(match(CAST, '   '), []);
  assert.deepEqual(match(CAST, '!!'), []);
  assert.deepEqual(match(CAST, 'xyzzy'), []);
  assert.deepEqual(match(null, 'dov'), []);
  assert.deepEqual(match([{ id: '', doc: { name: 'Dov' } }, null, { id: 'x' }], 'dov'), []);
});
await test('match: every word typed must find something (an AND, not an OR); the role and the faction are not searched', () => {
  assert.deepEqual(ids(match(CAST, 'dov lotte')), []);
  assert.deepEqual(ids(match(CAST, 'ada vell')), ['npc-ada']);
  assert.deepEqual(match(CAST, 'security'), []);
  assert.deepEqual(match(CAST, 'pelican'), []);
});
await test('notesOf: Voice, Tell, Signature, Wants and Knows come out; the rest stays as lines; nothing is made up', () => {
  const n = notesOf(CAST[0].doc.gmNotes);
  assert.equal(n.voice, 'low and slow'); assert.equal(n.tell, 'tired'); assert.equal(n.signature, 'cross'); assert.equal(n.want, 'a quiet shift'); assert.equal(n.knows, 'who has the lift key');
  assert.deepEqual(n.rest, ['GM-ONLY-NOTE takes a bribe once', 'Relation: staff']);
  assert.deepEqual(notesOf(''), { voice: '', tell: '', signature: '', want: '', knows: '', rest: [] });
  assert.equal(notesOf('Want: money\nGoal: out\n').want, 'money; out', 'two lines under one label join');
  assert.equal(notesOf('Know: a name').knows, 'a name');
  assert.equal(notesOf('Tell:').tell, '', 'an empty label is not a field');
  assert.equal(notesOf('x'.repeat(900)).rest[0].length, 300, 'a long line is cut');
  assert.equal(notesOf(Array.from({ length: 40 }, (_, i) => 'line ' + i).join('\n')).rest.length, 12, 'at most twelve other lines');
  assert.equal(notesOf(null).rest.length, 0);
});
await test('answerText: the headline, the bullets and the More text of an Ask card', () => {
  assert.equal(answerText({ headline: 'H', bullets: ['a', 'b'], more: 'M' }), 'H\n\u2022 a\n\u2022 b\nM');
  assert.equal(answerText({ text: 'T' }), 'T');
  assert.equal(answerText(null), '');
});

/* ---------- the box ---------- */
/* a host that throws on anything it was not meant to be asked: the card can read the cast and ask Blade, and nothing else */
function strictHost(extra) {
  const allowed = new Set(['npcs', 'ask', 'canAsk', 'askWhy', 'redraw', 'ui', 'doc']), asks = [];
  const base = Object.assign({ npcs: () => CAST, canAsk: () => true, ask: (q) => { asks.push(q); return Promise.resolve({ answer: { headline: 'A weary guard.', bullets: ['Wants a quiet shift'], more: 'Knows the lift key.' } }); }, ui: U }, extra || {});
  const host = new Proxy(base, { get(t, k) { if (typeof k === 'symbol') return undefined; if (!allowed.has(k)) throw new Error('the box reached for host.' + String(k)); return t[k]; } });
  return { host, asks };
}
await test('the box: typing "dov" opens the card of Dov Kessler: the look, Voice, Tell, Signature, Wants, Knows, the other notes, Who is', () => {
  const { host } = strictHost(), b = F.create(host);
  assert.ok(/gl-find-q/.test(b.html()) && !/gl-find-card/.test(b.html()), 'the box with no query: the field, no list, no card');
  b.type('dov');
  const h = b.html();
  assert.equal(b.state().open, 'npc-dov', 'the only match opens its card');
  assert.ok(/data-gl-card="npc-dov"/.test(h) && /Dov Kessler/.test(h) && /House security/.test(h) && /Watches the doors/.test(h), 'the card');
  for (const [k, v] of [['Voice', 'low and slow'], ['Tell', 'tired'], ['Signature', 'cross'], ['Wants', 'a quiet shift'], ['Knows', 'who has the lift key']]) assert.ok(new RegExp('<dt>' + k + '</dt><dd>' + v + '</dd>').test(h), k + ' shown');
  assert.ok(/takes a bribe once/.test(h) && /Relation: staff/.test(h), 'the other notes');
  assert.ok(/data-glf="who"/.test(h) && /Who is/.test(whoBtn(h) + h), 'a Who is button');
  assert.ok(!/Hidden/.test(h), 'a revealed NPC wears no Hidden');
  assert.ok(!/Mabel|Lotte|Silent/.test(h), 'only the match is in the list');
});
await test('the box: a card shows only what the notes hold (no field for what is missing), and says so when nothing is filed', () => {
  const b = F.create(strictHost().host); b.type('mabel');
  const h = b.html();
  assert.ok(/<dt>Tell<\/dt><dd>smirk<\/dd>/.test(h) && !/<dt>Voice|<dt>Wants|<dt>Knows|<dt>Signature/.test(h), 'Tell only');
  b.type('lotte'); assert.ok(/Nothing is filed on them yet/.test(b.html()), 'no description, no notes');
});
await test('the box: several matches list them (a button each), nothing opens until one is chosen; a card for someone no longer matched closes', () => {
  const b = F.create(strictHost().host); b.type('e');
  const h = b.html();
  assert.ok(!/gl-find-card/.test(h) && b.state().open === '', 'no card yet');
  assert.ok((h.match(/data-glf="pick"/g) || []).length >= 4 && /matches/.test(h), 'a list of buttons and a count');
  b.pick('npc-mabel'); assert.equal(b.state().open, 'npc-mabel'); assert.ok(/data-gl-card="npc-mabel"/.test(b.html()));
  b.type('ellis'); assert.equal(b.state().open, 'npc-ellis', 'the only match opens its card (Mabel’s closed: she is not an "ellis")');
  b.type('e'); b.pick('npc-ellis'); b.type('ell'); assert.equal(b.state().open, 'npc-ellis', 'a still-matching card stays open as the query grows');
});
await test('the box: once someone is picked from several the list folds to one line, with a way back; typing or Close unfolds it', () => {
  const b = F.create(strictHost().host); b.type('e');
  assert.ok((b.html().match(/data-glf="pick"/g) || []).length >= 4, 'the list');
  b.pick('npc-mabel');
  let h = b.html();
  assert.ok(!/data-glf="pick"/.test(h) && /data-glf="list"/.test(h) && /Show the list/.test(h) && /[0-9]+ matches/.test(h), 'one line: the count and Show the list');
  assert.ok(/data-gl-card="npc-mabel"/.test(h), 'the card stays');
  const P = fakePanel(), c = F.create(strictHost({ doc: P.doc }).host); c.mount(P.box, null); P.box.listeners.input[0]({ target: { id: 'gl-find-q', value: 'e' } }); c.pick('npc-mabel');
  P.box.listeners.click[0]({ target: { closest() { return this; }, getAttribute(n) { return n === 'data-glf' ? 'list' : null; } } });
  assert.ok(/data-glf="pick"/.test(P.out.innerHTML) && /data-gl-card="npc-mabel"/.test(P.out.innerHTML), 'Show the list brings the rows back and keeps the card');
  b.type('el'); assert.ok(!/Show the list/.test(b.html()), 'typing unfolds it');
  b.type('e'); b.pick('npc-ellis'); assert.ok(/Show the list/.test(b.html())); b.type('e'); assert.ok(/data-glf="pick"/.test(b.html()), 'a new query shows the rows again');
  const one = F.create(strictHost().host); one.type('dov'); assert.ok(/data-glf="pick"/.test(one.html()) && !/Show the list/.test(one.html()), 'one match: its row stays, nothing to fold');
});
await test('Who is: when Blade cannot be asked the reason is visible text, not only a title (the host’s own, else a plain line)', () => {
  const a = F.create(strictHost({ canAsk: () => false, askWhy: () => 'Blade is not offered at a phone’s width.' }).host); a.type('dov');
  assert.ok(a.html().includes('<p class="gl-find-line gl-find-why">Blade is not offered at a phone’s width.</p>'), 'the host’s reason');
  const b = F.create(strictHost({ canAsk: () => false, askWhy: () => '' }).host); b.type('dov');
  assert.ok(/gl-find-why">Blade cannot be asked just now./.test(b.html()), 'a plain line');
  const c = F.create(strictHost().host); c.type('dov'); assert.ok(!/gl-find-why/.test(c.html()), 'nothing when it can be asked');
});
await test('the box: the notes can be scrolled by keyboard (they are focusable) and the list stops at eight, and says how many more', () => {
  assert.ok(/<div class="gl-find-body" tabindex="0"/.test((() => { const b = F.create(strictHost().host); b.type('dov'); return b.html(); })()), 'focusable notes (they scroll inside themselves)');
  const many = Array.from({ length: 12 }, (_, i) => ({ id: 'n' + i, doc: { name: 'Pip Number' + i, revealed: true } }));
  const b = F.create(strictHost({ npcs: () => many }).host); b.type('pip');
  const h = b.html(); assert.equal((h.match(/data-glf="pick"/g) || []).length, 8); assert.ok(/and 4 more/.test(h));
});
await test('the box: no one found says so; a cleared query clears the list and the card', () => {
  const b = F.create(strictHost().host); b.type('nobody');
  assert.ok(/No one by that name/.test(b.html()));
  b.type('dov'); assert.ok(/gl-find-card/.test(b.html())); b.type(''); assert.ok(!/gl-find-card|gl-find-list|No one/.test(b.html()));
});
await test('the box: a hidden NPC is searchable, wears the word Hidden, and the card has no reveal, show or stage control', () => {
  const b = F.create(strictHost().host); b.type('silent');
  const h = b.html();
  assert.equal(b.state().open, 'npc-hid'); assert.ok(/Hidden/.test(h) && /Not shown to the players/.test(h), 'the word');
  assert.ok(/GM-ONLY-VOICE/.test(h), 'the GM sees the notes (this is the GM\u2019s panel)');
  assert.deepEqual([...h.matchAll(/data-glf="([a-z]+)"/g)].map((m) => m[1]).sort(), ['clear', 'close', 'pick', 'who'], 'the controls: the list row, Who is, Close, and the box\u2019s Clear');
  assert.ok(!/reveal|iPad|stage/i.test(h.replace(/Not shown to the players/g, '')), 'no reveal, iPad or stage wording');
});
await test('Who is: asks Blade\u2019s Ask seat once with the name, shows the answer in the card, and a second tap while it waits does nothing', async () => {
  const { host, asks } = strictHost(), b = F.create(host); b.type('dov');
  const p = b.ask('npc-dov'); b.ask('npc-dov');
  assert.ok(/Asking Blade/.test(b.html()), 'a waiting line');
  assert.ok(/disabled/.test(whoBtn(b.html())), 'Who is is off while it waits');
  await p; await new Promise((r) => setTimeout(r, 0));
  assert.equal(asks.length, 1, 'one ask');
  assert.ok(/^Who is Dov Kessler\?/.test(asks[0]) && asks[0].length < 200, 'the question names them: ' + asks[0]);
  const h = b.html();
  assert.ok(/A weary guard\./.test(h) && /Wants a quiet shift/.test(h) && /Knows the lift key\./.test(h), 'the answer is in the card');
  assert.ok(!/disabled/.test(whoBtn(h)), 'Who is is back');
});
await test('Who is: a refusal, nothing, a throw, and Blade not being available are each a plain line, never a crash or an empty card', async () => {
  for (const [ask, want] of [[() => Promise.resolve(null), /cannot be asked/], [() => Promise.resolve({ error: 'cap' }), /nothing to say/], [() => Promise.reject(new Error('x')), /nothing to say/], [() => { throw new Error('y'); }, /cannot be asked/], [() => Promise.resolve({ answer: { headline: '' } }), /nothing to say/]]) {
    const b = F.create(strictHost({ ask }).host); b.type('dov'); await b.ask('npc-dov'); await new Promise((r) => setTimeout(r, 0));
    assert.ok(want.test(b.html()), 'line for ' + ask + ': ' + b.html().slice(-300));
  }
  const off = F.create(strictHost({ canAsk: () => false }).host); off.type('dov');
  assert.ok(/disabled/.test(whoBtn(off.html())), 'Who is is off when Blade cannot be asked');
});
await test('the box: markup from a name, an alias, a role, a description or a note is escaped (it is text)', () => {
  const evil = [{ id: 'e', doc: { name: '<img src=x onerror=1> Pat', alias: '"><b>', role: '<i>r</i>', revealed: true, description: '<script>1</script>', gmNotes: 'Tell: <u>x</u>\n<b>y</b>' } }];
  const b = F.create(strictHost({ npcs: () => evil }).host); b.type('pat');
  const h = b.html();
  assert.ok(!/<img|<script|<u>x|<b>y|<i>r/.test(h), 'no tag from the data');
  assert.ok(/&lt;img src=x onerror=1&gt; Pat/.test(h) && /&lt;script&gt;1&lt;\/script&gt;/.test(h) && /&lt;u&gt;x&lt;\/u&gt;/.test(h));
});

/* ---------- the panel: listeners once, focus kept over a redraw, Esc through B68GmEsc ---------- */
function fakePanel() {
  const out = { innerHTML: '' }, clear = { disabled: true }, q = { id: 'gl-find-q', value: '', focused: false, selectionStart: 0, selectionEnd: 0, focus() { this.focused = true; doc.activeElement = this; }, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; } };
  const node = { attrs: {}, className: '', setAttribute(k, v) { this.attrs[k] = v; }, _h: '', set innerHTML(v) { this._h = v; }, get innerHTML() { return this._h; }, parentNode: null, isConnected: true,
    querySelector(s) { return s === '.gl-find-out' ? out : s === '.gl-find-clear' ? clear : s === '#gl-find-q' ? q : null; }, contains() { return true; } };
  const box = { listeners: {}, children: [], firstChild: null, addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, insertBefore(n) { n.parentNode = box; this.children.unshift(n); }, contains() { return true; } };
  const doc = { activeElement: null, createElement() { return node; } };
  return { out, clear, q, node, box, doc };
}
await test('the panel: listeners go on once per panel however often it redraws; typing fills the list; Enter opens the first; Close, a tap on a row, and Clear work', () => {
  const P = fakePanel(), b = F.create(strictHost({ doc: P.doc }).host);
  b.mount(P.box, null); b.mount(P.box, null);
  assert.equal(P.box.listeners.input.length, 1); assert.equal(P.box.listeners.keydown.length, 1); assert.equal(P.box.listeners.click.length, 1);
  assert.ok(/gl-find-q/.test(P.node.innerHTML) && P.node.attrs['data-ui-scope'] === '' && P.node.attrs['data-gl-panel'] === 'find', 'the box, a ui scope');
  P.box.listeners.input[0]({ target: { id: 'gl-find-q', value: 'e' } });
  assert.ok(/data-glf="pick"/.test(P.out.innerHTML) && !/gl-find-card/.test(P.out.innerHTML), 'a list');
  assert.equal(P.clear.disabled, false, 'Clear is on once something is typed');
  let prevented = false; P.box.listeners.keydown[0]({ target: { id: 'gl-find-q' }, key: 'Enter', preventDefault() { prevented = true; } });
  assert.ok(prevented && /gl-find-card/.test(P.out.innerHTML), 'Enter opens the first match');
  const btn = (k, id) => ({ closest() { return this; }, getAttribute(n) { return n === 'data-glf' ? k : n === 'data-id' ? id : null; }, disabled: false });
  P.box.listeners.click[0]({ target: btn('close') }); assert.ok(!/gl-find-card/.test(P.out.innerHTML), 'Close');
  P.box.listeners.click[0]({ target: btn('pick', 'npc-ellis') }); assert.ok(/data-gl-card="npc-ellis"/.test(P.out.innerHTML), 'a tap on a row');
  P.box.listeners.click[0]({ target: btn('clear') }); assert.equal(b.state().q, ''); assert.ok(!/gl-find-list|gl-find-card/.test(P.out.innerHTML)); assert.equal(P.q.focused, true, 'the field has the focus again');
  P.box.listeners.input[0]({ target: { id: 'something-else', value: 'dov' } }); assert.equal(b.state().q, '', 'another field\u2019s input is not this box\u2019s');
});
await test('the panel: a redraw of the cast keeps the query, the card and the caret', () => {
  const P = fakePanel(), b = F.create(strictHost({ doc: P.doc }).host);
  b.mount(P.box, null); P.box.listeners.input[0]({ target: { id: 'gl-find-q', value: 'dov' } });
  P.q.focus(); P.q.selectionStart = 1; P.q.selectionEnd = 2;
  const keep = b.before(P.box); assert.deepEqual(keep, { focus: true, a: 1, b: 2 });
  P.q.focused = false; P.doc.activeElement = null;
  b.mount(P.box, keep);
  assert.ok(/value="dov"/.test(P.node.innerHTML), 'the field is drawn with the query'); assert.ok(/data-gl-card="npc-dov"/.test(P.out.innerHTML), 'the card is back');
  assert.equal(P.q.focused, true, 'the focus is back'); assert.equal(P.q.selectionStart, 1); assert.equal(P.q.selectionEnd, 2);
  P.doc.activeElement = null; assert.equal(b.before(P.box), null, 'no focus in the field: nothing to give back');
});
await test('the panel: without the UI kit nothing is drawn and the kit is asked for once; with it, the page redraws', async () => {
  const P = fakePanel(); let needs = 0, redraws = 0, release;
  const win = {}; win.self = win; win.window = win; win.B68Load = { need: (n) => { needs++; assert.equal(n, 'kit-ui'); return new Promise((r) => { release = r; }); } };
  vm.runInNewContext(SRC, win, { filename: FILE });
  const b = win.B68GmNpcFind.create({ npcs: () => CAST, doc: P.doc, redraw: () => { redraws++; } });
  assert.equal(b.mount(P.box, null), null); b.mount(P.box, null); assert.equal(needs, 1); assert.equal(P.box.children.length, 0, 'nothing in the panel');
  release(); await new Promise((r) => setTimeout(r, 0)); assert.equal(redraws, 1);
});
await test('Esc: the open card is a B68GmEsc entry (in-view panel, 40) and Esc shuts it; the module has no document listener', () => {
  const regs = {}, win = {}; win.self = win; win.window = win; win.B68GmEsc = { register: (id, o) => { regs[id] = o; return () => {}; } };
  vm.runInNewContext(SRC, win, { filename: FILE });
  const P = fakePanel(), b = win.B68GmNpcFind.create({ npcs: () => CAST, ui: U, doc: P.doc });
  b.mount(P.box, null); assert.ok(!regs['npc-find'], 'nothing registered until a card opens');
  P.box.listeners.input[0]({ target: { id: 'gl-find-q', value: 'dov' } });
  const e = regs['npc-find']; assert.ok(e && e.priority === 40, 'registered at 40'); assert.equal(e.isOpen(), true);
  e.close(); assert.equal(b.state().open, '', 'Esc shut the card'); assert.equal(e.isOpen(), false);
});

/* ---------- the sheet ---------- */
await test('glance.css: the RK24 block is there, every rule on a .gl-find class under #gm-page, nothing under 12 px, no !important, no C1 character', () => {
  const all = fs.readFileSync(path.join(ROOT, 'app/gm/glance.css'), 'utf8'), i = all.indexOf('/* ---------- RK24'), j = all.length;
  assert.ok(i >= 0 && j > i, 'the block sits before RK20\u2019s');
  const css = all.slice(i, j).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/[\u0080-\u009f]/.test(all), 'no U+0080 to U+009F');
  const sizes = [...css.matchAll(/font(?:-size)?\s*:\s*(?:[0-9]+\s+)?([0-9.]+)px/g)].map((m) => +m[1]); assert.ok(sizes.length >= 3 && sizes.every((n) => n >= 12), 'font sizes: ' + sizes);
  assert.ok(!/!important|@layer/.test(css), 'no !important, no @layer');
  for (const rule of css.replace(/@media[^{]*\{/g, '').split('}').map((r) => r.split('{')[0].trim()).filter(Boolean)) for (const sel of rule.split(',')) assert.ok(/^#gm-page \.gl-find/.test(sel.trim()), 'a rule outside .gl-find: ' + sel.trim());
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
