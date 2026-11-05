// The phone's Now card and Between sessions fold (the night rebuild, N6; design 7): app/sheet/now.js against fake phone modules and the real keys.js,
// the packet's read state (app/sheet/absent.js), the quiet line's long press and its lift-off guard (app/sheet/quiet.js), and the sheet's seams
// (tracker.js, routes.js, tracker.css). No browser, no network, no clock: windows are fakes, the time is the test's. The real page is
// checks/runtime/sheet-now.e2e.mjs. INVENTED data only.
//   node checks/runtime/sheet-now.test.mjs
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { MiniEl } from './minidom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const flush = () => new Promise((r) => setTimeout(r, 0));

/* a window for the phone files: each runs as the page runs it (self is the window), with whatever fakes the test gives */
function win(extra) { const w = Object.assign({ console: { error() {}, log() {} } }, extra || {}); w.self = w; w.window = w; vm.createContext(w); return w; }
function load(w, file) { vm.runInContext(fs.readFileSync(path.join(APP, file), 'utf8'), w, { filename: file }); return w; }
const item = (title, extra) => Object.assign({ title, line: title + ' line', actions: [{ label: 'Go ' + title, attrs: 'data-go="' + title + '"', primary: true }] }, extra || {});
const fake = (now, between) => ({ now: () => (typeof now === 'function' ? now() : now || null), between: () => (typeof between === 'function' ? between() : between || null) });
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const keyPlay = (hits, more) => ({ stress: 4, keys: [{ name: 'KEY-1', down: 'Walk away', up: 'Burn it down', hits }].concat(more || []) });
const keyCtx = (play, over) => Object.assign({ esc, play, pb: {}, ui: {}, turn: true }, over || {});
const order = (html) => [...html.matchAll(/class="ds-now-item[^"]*" data-now="([a-z]+)"/g)].map((m) => m[1]);

/* ---------- the Now card ---------- */
await test('the order is the design\'s: commendations, the Debrief, the packet, a key to turn, the mission card', () => {
  const w = load(win(), 'sheet/now.js');
  assert.deepEqual(Array.from(w.B68Now.ORDER), ['commend', 'debrief', 'absent', 'keys', 'mission']);
  assert.deepEqual(Array.from(w.B68Now.FOLD), ['board', 'absent', 'debrief']);
});
await test('nothing due: no card and no fold, whether the modules are missing, not started or have nothing', () => {
  let w = load(win(), 'sheet/now.js');
  assert.equal(w.B68Now.card({ ui: {} }), '', 'no modules: no card'); assert.equal(w.B68Now.fold({ ui: {} }), '', 'and no fold');
  w = load(win({ B68Commend: fake(), B68Debrief: fake(), B68Absent: fake(), B68Board: fake() }), 'sheet/now.js'); load(w, 'sheet/keys.js');
  assert.equal(w.B68Now.card(keyCtx(keyPlay(2))), '', 'every module has nothing (a key at two hits): no card');
  assert.equal(w.B68Now.fold({ ui: {} }), '', 'and nothing in the fold');
  assert.equal(w.B68Now.card(keyCtx(keyPlay(3), { turn: false })), '', 'a key at three hits with Turn the key off: no card');
});
await test('several due at once: the first in the order is the card, the rest wait behind "+n more", which lists them by name, in order', () => {
  const w = load(win({ B68Commend: fake(item('Did you earn xp tonight?')), B68Debrief: fake(item('Debrief')), B68Absent: fake(item('While you were away')) }), 'sheet/now.js'); load(w, 'sheet/keys.js');
  const mission = { pcs: [{ id: 'c1', name: 'Nell Arbuthnot', card: { room: 'Showroom' } }] };
  const ctx = keyCtx(keyPlay(3), { mission, docId: 'c1' });
  const h = w.B68Now.card(ctx);
  assert.deepEqual(order(h), ['commend'], 'one item drawn: the commendations');
  assert.match(h, /<div class="ds-band"><h3 class="ds-bt">Now · the Aftermath<\/h3><\/div>/, 'the band names the card alone: "+n more" says how many wait');
  assert.match(h, /data-act="nowmore" aria-expanded="false"><span>\+4 more: Debrief · your packet · a key to turn · Mission<\/span>/);
  assert.ok(!/ds-now-rest/.test(h), 'the rest are not drawn while folded');
  ctx.ui.nowMore = true;
  const open = w.B68Now.card(ctx);
  assert.deepEqual(order(open), ['commend', 'debrief', 'absent', 'keys', 'mission'], 'opened: all five, in order');
  assert.match(open, /aria-expanded="true" aria-controls="ds-now-rest"><span>Show less<\/span>/);
  assert.equal((open.match(/ds-now-sm/g) || []).length, 4, 'the four that wait are drawn small');
  assert.ok(/class="btn sm primary" data-go="Did you earn xp tonight\?"/.test(open) && /class="btn sm" data-go="Debrief"/.test(open), 'only the card\'s own action is primary');
  assert.equal(w.B68Now.due(ctx).length, 5);
  const one = load(win({ B68Commend: fake(item('xp')) }), 'sheet/now.js'), ui = { nowMore: true };
  assert.deepEqual(order(one.B68Now.card({ ui })), ['commend']); assert.equal(ui.nowMore, false, 'nothing waits: "+n more" is folded again for next time');
});
await test('every pair keeps the order, whichever two are due', () => {
  const ids = ['commend', 'debrief', 'absent', 'keys', 'mission'];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const on = new Set([ids[i], ids[j]]);
    const w = load(win({ B68Commend: fake(on.has('commend') ? item('C') : null), B68Debrief: fake(on.has('debrief') ? item('D') : null), B68Absent: fake(on.has('absent') ? item('A') : null) }), 'sheet/now.js'); load(w, 'sheet/keys.js');
    const ctx = keyCtx(keyPlay(on.has('keys') ? 3 : 1), { mission: on.has('mission') ? { pcs: [{ id: 'c1', name: 'Nell', card: { room: 'Showroom' } }] } : null, docId: 'c1', ui: { nowMore: true } });
    assert.deepEqual(order(w.B68Now.card(ctx)), [ids[i], ids[j]], ids[i] + ' before ' + ids[j]);
  }
});
await test('a module that throws, or answers with no title, is passed over; the others still show', () => {
  const errs = [];
  const w = load(win({ console: { error: (e) => errs.push(e) }, B68Commend: { now() { throw new Error('boom'); } }, B68Debrief: fake({ line: 'no title' }), B68Absent: fake(item('While you were away')) }), 'sheet/now.js');
  assert.deepEqual(order(w.B68Now.card({ ui: {} })), ['absent']);
  assert.equal(errs.length, 1, 'the throw is logged, once');
});
await test('text is escaped; the module\'s own attributes and markup are kept', () => {
  const w = load(win({ B68Commend: fake(item('<img src=x onerror=alert(1)>', { line: 'a "line" & <b>more</b>', actions: [{ label: '<i>Go</i>', attrs: 'data-act="endopen"' }] })) }), 'sheet/now.js');
  const h = w.B68Now.card({ ui: {} });
  assert.ok(!/<img|<b>|<i>/.test(h), 'no markup from text: ' + h);
  assert.match(h, /&lt;img src=x onerror=alert\(1\)&gt;/); assert.match(h, /a &quot;line&quot; &amp; &lt;b&gt;more&lt;\/b&gt;/);
  assert.match(h, /<button type="button" class="btn sm" data-act="endopen">&lt;i&gt;Go&lt;\/i&gt;<\/button>/);
});
await test('the countdown: the card\'s markup holds the end, not the seconds (so it is not redrawn every second); tick() writes "Closes in m:ss" in place', () => {
  const real = Date.now; let t = 1_000_000;
  const ivs = [];
  const w = load(win({ Date: { now: () => t }, B68Commend: fake(item('xp', { ends: 1_090_000 })), setInterval: (fn, ms) => { ivs.push({ fn, ms, on: true }); return ivs.length; }, clearInterval: (id) => { if (ivs[id - 1]) ivs[id - 1].on = false; } }), 'sheet/now.js');
  try {
    Date.now = () => t;
    const a = w.B68Now.card({ ui: {} }); t += 5000; const b = w.B68Now.card({ ui: {} });
    assert.equal(a, b, 'the same markup five seconds apart'); assert.match(a, /<span class="ds-now-left mono" data-ends="1090000"><\/span>/);
    const root = new MiniEl('div'), span = new MiniEl('span'); span.setAttribute('data-ends', '1090000'); root.appendChild(span);
    w.document = { querySelectorAll: (s) => root.querySelectorAll(s) };
    t = 1_000_000; w.B68Now.tick(root); assert.equal(span.textContent, 'Closes in 1:30');
    assert.equal(ivs.length, 1, 'one interval while a countdown stands'); assert.equal(ivs[0].ms, 1000);
    t = 1_031_000; ivs[0].fn(); assert.equal(span.textContent, 'Closes in 0:59', 'the interval writes it again');
    w.B68Now.tick(root); assert.equal(ivs.length, 1, 'never a second interval');
    root.removeChild(span); ivs[0].fn(); assert.equal(ivs[0].on, false, 'no countdown left: the interval stops');
    assert.equal(w.B68Now.left(5000, 5000), '0:00'); assert.equal(w.B68Now.left(66001, 5000), '1:02'); assert.equal(w.B68Now.left(0, 5000), '0:00');
  } finally { Date.now = real; }
});
await test('the mission card item: this sheet\'s character first, the room as text, busy, not placed, and none without a card', () => {
  const w = load(win(), 'sheet/now.js'), N = w.B68Now;
  const m = { pcs: [{ id: 'c2', name: 'Ray Okonjo', card: { room: 'Cocktail lounge' } }, { id: 'c1', name: 'Nell Arbuthnot', card: { room: 'Showroom', busy: '23:30' } }] };
  let it = N.due({ mission: m, docId: 'c1' })[0];
  assert.equal(it.id, 'mission'); assert.equal(it.line, 'You are in Showroom. Busy until 23:30.');
  assert.equal(it.actions[0].label, 'Open the mission card'); assert.match(it.actions[0].attrs, /data-act="missionscreen"/);
  it = N.due({ mission: m, docId: 'c9' })[0]; assert.equal(it.line, 'Ray Okonjo is in Cocktail lounge.', 'another sheet: the player\'s first character, by name');
  it = N.due({ mission: { pcs: [{ id: 'c1', name: 'Nell', card: {} }] }, docId: 'c1' })[0]; assert.equal(it.line, 'You are not placed yet.');
  assert.deepEqual(Array.from(N.due({ mission: null })), []); assert.deepEqual(Array.from(N.due({ mission: { pcs: [] } })), []);
  assert.match(N.card({ mission: { pcs: [{ id: 'c1', name: 'N', card: { room: '<b>x</b>' } }] }, docId: 'c1', ui: {} }), /You are in &lt;b&gt;x&lt;\/b&gt;\./, 'the room is text');
});
await test('the key item (keys.js now): one key by name with its two turn buttons; two keys a row each; nothing when it cannot turn', () => {
  const w = load(win(), 'sheet/keys.js'), K = w.B68SheetKeys;
  const one = K.now(keyCtx(keyPlay(3)));
  assert.equal(one.title, 'You can turn this key'); assert.match(one.line, /^KEY-1 has three hits\. Decide before you roll/);
  assert.equal((one.html.match(/data-act="kturn"/g) || []).length, 2); assert.match(one.html, /data-i="0" data-dir="down"[^>]*>▼ Walk away/); assert.match(one.html, /data-i="0" data-dir="up"[^>]*>▲ Burn it down/);
  assert.ok(!/ds-kt-row/.test(one.html), 'one key: no row of names, it is in the line');
  const two = K.now(keyCtx(keyPlay(3, [{ name: 'KEY-2', down: 'd', up: 'u', hits: 3 }])));
  assert.equal(two.title, 'You can turn a key'); assert.match(two.line, /^2 keys have three hits/);
  assert.equal((two.html.match(/class="ds-kt-row"/g) || []).length, 2); assert.equal((two.html.match(/data-act="kturn"/g) || []).length, 4);
  assert.equal(K.now(keyCtx(keyPlay(2))), null, 'two hits'); assert.equal(K.now(keyCtx(keyPlay(3), { turn: false })), null, 'Turn the key off');
  assert.equal(K.now(keyCtx(keyPlay(3), { pb: { ghost: true } })), null, 'a playbook that cannot turn keys');
  assert.equal(K.now(keyCtx({ keys: [{ name: 'KEY-1', hits: 3, deadlock: 'up' }] })), null, 'a key already turned');
  assert.equal(K.now(null), null);
  assert.ok(!/<script/.test(K.now(keyCtx({ keys: [{ name: '<script>x</script>', down: '<b>', up: 'u', hits: 3 }] })).html), 'names are escaped');
});

/* ---------- the fold ---------- */
await test('the Between fold: closed by default with a count; open it lists the board, then the packet and the Debrief once they are not current', () => {
  const w = load(win({ B68Board: fake(null, item('Opportunities')), B68Absent: fake(null, item('While you were away')), B68Debrief: fake(null, item('Debrief')) }), 'sheet/now.js');
  const closed = w.B68Now.fold({ ui: {} });
  assert.match(closed, /<button type="button" class="ds-band ds-between-t" data-act="between" aria-expanded="false">/);
  assert.match(closed, /<span class="ds-bt">Between sessions<\/span>/); assert.match(closed, /3 inside/);
  assert.deepEqual(order(closed), [], 'closed: nothing inside is drawn');
  const open = w.B68Now.fold({ ui: { between: true } });
  assert.deepEqual(order(open), ['board', 'absent', 'debrief']); assert.match(open, /aria-expanded="true" aria-controls="ds-between-b"/);
  assert.match(open, /class="ds-now-item ds-board ds-now-sm"/, 'each keeps its strip\'s class');
  const w1 = load(win({ B68Board: fake(null, item('Opportunities')) }), 'sheet/now.js');
  assert.match(w1.B68Now.fold({ ui: {} }), /1 inside/);
});

/* ---------- the packet: current until opened ---------- */
function domWin(extra) {
  const listeners = {};
  const body = new MiniEl('body');
  const document = {
    hidden: false, body, head: new MiniEl('head'),
    createElement: (t) => { const e = new MiniEl(t); e._l = {}; e.addEventListener = (k, fn) => { (e._l[k] = e._l[k] || []).push(fn); }; e.fire = (k, ev) => (e._l[k] || []).forEach((fn) => fn(ev)); e.style = {}; return e; },
    addEventListener: (k, fn, cap) => { (listeners[k] = listeners[k] || []).push({ fn, cap: !!cap }); },
    removeEventListener: (k, fn) => { listeners[k] = (listeners[k] || []).filter((x) => x.fn !== fn); },
    querySelector: () => null
  };
  return { w: win(Object.assign({ document, setInterval: () => 1, clearInterval() {} }, extra)), listeners, body };
}
function store(throws) { const m = new Map(); return { m, getItem: (k) => { if (throws) throw new Error('private'); return m.has(k) ? m.get(k) : null; }, setItem: (k, v) => { if (throws) throw new Error('private'); m.set(k, String(v)); } }; }
const PKT = (at) => ({ v: 1, at, front: { masthead: 'The Pelican Post', headline: 'Lights out' }, previously: { faces: [], lines: ['One', 'Two', 'Three'] }, changes: ['Stress 2 to 5'] });
await test('the packet is on the Now card until it is opened, then in the fold; a reload remembers which; a new packet is new again; private mode still works', async () => {
  const ls = store(); let rows = [{ kind: 'packet', json: PKT(111) }], redrawn = 0;
  const make = (lstore) => {
    const d = domWin({ localStorage: lstore, fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ docs: rows }) }), B68Tracker: { isOpen: () => true, refresh: () => { redrawn++; } } });
    return { P: load(d.w, 'sheet/absent.js').B68Absent, body: d.body };
  };
  let { P, body } = make(ls);
  P.start(); await flush(); await flush();
  assert.ok(P.now() && P.now().title === 'While you were away', 'unread: the Now card'); assert.equal(P.between(), null);
  const before = redrawn;
  assert.equal(P.open(), true);
  assert.equal(ls.m.get('b68.packet.seen'), 'at:111', 'opening it keeps its time on this phone');
  assert.equal(P.now(), null, 'opened: off the Now card'); assert.equal(P.between().actions[0].label, 'Read it again', 'and in the fold');
  assert.ok(redrawn > before, 'the sheet was redrawn so the card moves at once');
  const dlg = body.children.find((c) => /ds-absent-dlg/.test(c.className));
  assert.ok(dlg && dlg.getAttribute('aria-modal') === 'true' && /ds-dlg/.test(dlg.className), 'the page is a bottom sheet in the sheet\'s style');
  const card = dlg.querySelector('.ds-absent-card');
  assert.ok(card && card.focused === 1 && card.getAttribute('tabindex') === '-1', 'focus goes to the top of the page');
  dlg.fire('click', { target: dlg }); assert.equal(P.state().open, true, 'a click on the dimmed page that did not start there leaves it open');
  dlg.fire('pointerdown', { target: dlg }); dlg.fire('click', { target: dlg }); assert.equal(P.state().open, false, 'a tap that starts and ends on the dimmed page closes it');
  P.open(); const d2 = body.children.find((c) => /ds-absent-dlg/.test(c.className)); let held = 0;
  d2.fire('keydown', { key: 'Escape', preventDefault() { held++; }, stopPropagation() { held++; } });
  assert.equal(P.state().open, false, 'Esc closes it'); assert.equal(held, 2, 'and goes no further (the sheet\'s own Esc does not also fire)');
  P.stop();
  ({ P } = make(ls)); P.start(); await flush(); await flush();
  assert.equal(P.now(), null, 'a reload: still read'); assert.ok(P.between(), 'still in the fold');
  rows = [{ kind: 'packet', json: PKT(222) }]; P._set(PKT(222));
  assert.ok(P.now(), 'a new packet is on the Now card again'); assert.equal(P.between(), null);
  P.stop();
  ({ P } = make(store(true))); P.start(); await flush(); await flush();
  assert.ok(P.now(), 'private mode: unread'); P.open(); assert.equal(P.now(), null, 'opened: remembered for this visit'); P.stop();
});

/* ---------- the quiet line: the long press, the lift-off, the dimmed page ---------- */
await test('quiet: a long press on the header opens the menu; the click its lift-off makes is swallowed and leaves the menu open; the button opens it too', () => {
  const pending = new Map(); let tid = 0;
  const timers = { filter: () => { const fns = [...pending.values()]; pending.clear(); return fns; } };   /* timers.filter(Boolean).forEach(run): fires what is pending, once */
  const d = domWin({ setTimeout: (fn) => { pending.set(++tid, fn); return tid; }, clearTimeout: (id) => { pending.delete(id); }, fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ docs: [] }) }) });
  const Q = load(d.w, 'sheet/quiet.js').B68Quiet;
  Q.start();
  const on = (k) => (d.listeners[k] || []);
  const head = { id: 'head' }, target = { closest: (s) => (/button/.test(s) ? null : /\.ds-head/.test(s) ? head : null) };
  on('pointerdown').forEach((l) => l.fn({ target, pointerId: 7, clientX: 10, clientY: 10, pointerType: 'touch', button: 0 }));
  assert.equal(Q.state().open, false, 'not before 600 ms');
  timers.filter(Boolean).forEach((fn) => fn());
  assert.equal(Q.state().open, true, 'held: the menu is open');
  const dlg = d.body.children.find((c) => /ds-quiet-dlg/.test(c.className));
  assert.ok(dlg && dlg.getAttribute('aria-modal') === 'true', 'the menu is a modal bottom sheet');
  const opts = dlg.querySelectorAll('button').map((b) => b.textContent);
  assert.deepEqual(opts.slice(0, 4), ['X-card', 'Pause', 'Spotlight me', 'Secret note']); assert.ok(opts.includes('Cancel'));
  const note = dlg.querySelector('textarea'); assert.ok(note && /ds-quiet-note/.test(note.className) && note.hasAttribute('hidden'), 'the note box is there, hidden until asked for');
  on('pointerup').forEach((l) => l.fn({ pointerId: 7 }));
  let stopped = 0, prevented = 0;
  const click = { preventDefault: () => { prevented++; }, stopPropagation: () => { stopped++; } };
  const caps = on('click').filter((l) => l.cap);
  assert.equal(caps.length, 1, 'one capturing click listener');
  caps[0].fn(click);
  assert.deepEqual([prevented, stopped], [1, 1], 'the lift-off click is swallowed before it reaches the menu');
  dlg.fire('click', { target: dlg });
  assert.equal(Q.state().open, true, 'and the dimmed page does not close it: the tap did not start there');
  caps[0].fn(click); assert.deepEqual([prevented, stopped], [1, 1], 'only one click is swallowed');
  dlg.fire('pointerdown', { target: dlg }); dlg.fire('click', { target: dlg });
  assert.equal(Q.state().open, false, 'a real tap on the dimmed page closes it');
  on('pointerdown').forEach((l) => l.fn({ target: { closest: () => null }, pointerId: 8, clientX: 0, clientY: 0 }));
  timers.filter(Boolean).forEach((fn) => fn()); assert.equal(Q.state().open, false, 'a press anywhere else opens nothing');
  on('pointerup').forEach((l) => l.fn({ pointerId: 8 })); caps[0].fn(click); assert.equal(prevented, 1, 'and swallows nothing');
  assert.equal(Q.open({ focus() {} }), true, 'the Quiet button opens the same menu'); Q.close();
  Q.stop(); assert.equal((d.listeners.click || []).length, 0, 'stop() lets go of the click guard');
});
await test('quiet: a long press on a read-only sheet (the GM\'s drawer) opens nothing', () => {
  const src = fs.readFileSync(path.join(APP, 'sheet', 'quiet.js'), 'utf8');
  assert.match(src, /closest\('#dossier\.ds-live:not\(\.ds-ro\) \.ds-head'\)/, 'the header is found only on a live sheet that is not read-only');
});

/* ---------- the sheet's seams ---------- */
await test('the sheet: a Now slot under the head and a Between slot after the last box; none of it for print, a read-only frame or the GM', () => {
  const t = fs.readFileSync(path.join(APP, 'tracker.js'), 'utf8');
  assert.match(t, /var ORDER = \['head', 'vitals', 'now', 'bar', [^\]]*'log', 'between'\];/);
  assert.match(t, /slotMark\('head'\) \+ slotMark\('now'\) \+ slotMark\('bar'\) \+ '<div class="ds-grid">'[\s\S]*?\.join\(''\) \+ '<\/div>' \+ slotMark\('between'\);/);
  assert.match(t, /function nowOn\(\) \{ return !!cur && !cur\.ui\.static && !readOnly\(\) && B\(\)\.isGM !== true && !!window\.B68Now; \}/);
  assert.match(t, /case 'bar': return tableBar\(play\);/, 'the table bar is the bar slot\'s only content: the strips are gone from it');
  assert.ok(!/B68(Commend|Debrief|Board|Absent)\.bar\(/.test(t), 'nothing calls the old strips');
  assert.match(t, /nowmore: function \(\) \{ cur\.ui\.nowMore = !cur\.ui\.nowMore;/); assert.match(t, /between: function \(\) \{ cur\.ui\.between = !cur\.ui\.between;/);
  assert.match(t, /'<button type="button" class="btn sm ds-quietbtn" data-act="quiet" aria-haspopup="dialog"/);
  for (const f of ['commend', 'debrief', 'absent', 'board']) assert.ok(!/function bar\(/.test(fs.readFileSync(path.join(APP, 'sheet', f + '.js'), 'utf8')), f + '.js has no strip of its own');
});
await test('routes: now.js is in the core (every route has the sheet) and index.html loads it; the GM and display bundles do not', () => {
  const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(APP, 'routes.js'), 'utf8'), ctx);
  const B = ctx.window.B68Load.BUNDLES;
  assert.ok(B.core.includes('sheet/now.js') && B.core.indexOf('sheet/now.js') === B.core.indexOf('sheet/keys.js') + 1);
  for (const b of ['gm', 'display', 'table', 'lookbook']) assert.ok(!B[b].includes('sheet/now.js'), b);
  assert.match(fs.readFileSync(path.join(APP, 'index.html'), 'utf8'), /<script src="sheet\/keys\.js"><\/script>\n<script src="sheet\/now\.js"><\/script>/);
});
await test('css: every field of the phone forms is 16 px (iPhone Safari zooms below that); Quiet is 44 px; the Now card and the fold do not print', () => {
  const css = fs.readFileSync(path.join(APP, 'tracker.css'), 'utf8');
  assert.match(css, /\.ds-dlg-card :is\(input\[type="text"\], textarea, select\) \{[^}]*font: 400 16px/);
  assert.match(css, /#dossier \.btn\.sm\.ds-quietbtn \{ min-height: 44px; \}/, 'Quiet outranks #dossier .btn.sm (40 px on touch)');
  assert.match(css, /@media print \{ #dossier \.ds-now, #dossier \.ds-betweenbox, #dossier \.ds-quietbtn \{ display: none !important; \} \}/);
  for (const f of ['debrief', 'board', 'absent', 'quiet']) assert.ok(!/style\.cssText/.test(fs.readFileSync(path.join(APP, 'sheet', f + '.js'), 'utf8')), f + '.js draws with the sheet\'s classes, not inline styles');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
