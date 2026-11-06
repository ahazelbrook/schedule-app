// Unit test for the inline host (app/gm/workshop.js inline()) and the tool registry (app/gm/tool-registry.js), the night rebuild N2. No browser, no network.
//   node checks/runtime/gm-inline.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MiniEl } from './minidom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const require = createRequire(import.meta.url);
const R = require(path.join(APP, 'gm', 'tool-registry.js'));
const src = (f) => fs.readFileSync(path.join(APP, f), 'utf8');

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* a page: a window with the real tools.js, tool-registry.js, esc.js and workshop.js loaded in the order routes.js gives. Its elements have a small layout:
   isConnected (the chain reaches the page's body) and getClientRects() (none when detached, or when it or an ancestor is [hidden] or display:none) */
function page() {
  let body = null;
  const layout = (e) => {
    e.ownerDocument = doc; e.style = {}; e.addEventListener = () => {};
    Object.defineProperty(e, 'id', { get() { return e.attrs.id || ''; }, set(v) { e.attrs.id = String(v); } });
    Object.defineProperty(e, 'isConnected', { get() { for (let x = e; x; x = x.parentNode) if (x === body) return true; return false; } });
    e.getClientRects = () => { if (!e.isConnected) return []; for (let x = e; x; x = x.parentNode) if (x.hidden || (x.style && x.style.display === 'none')) return []; return [{ width: 1, height: 1 }]; };
    return e;
  };
  const doc = { createElement: (t) => layout(new MiniEl(t)) };
  body = doc.createElement('body');
  const win = { document: doc, console };
  win.self = win;
  vm.createContext(win);
  for (const f of ['gm/esc.js', 'gm/tools.js', 'gm/tool-registry.js', 'gm/workshop.js']) vm.runInContext(src(f), win, { filename: f });
  const box = () => body.appendChild(doc.createElement('div'));
  return { win, doc, body, W: win.B68GmWorkshop, T: win.B68GmTools, Esc: win.B68GmEsc, R, box };
}

await test('inline: bind gives a sheet-shaped object whose body sits inside the container, always open', () => {
  const p = page(), host = p.box(), closed = [];
  const s = p.W.inline('print', host, { onClose: (id) => closed.push(id) });
  assert.ok(s && s.inline === true);
  for (const k of ['el', 'body', 'isOpen', 'open', 'close', 'toggle']) assert.ok(k in s, k);
  assert.equal(s.isOpen(), true);
  assert.ok(host.contains(s.body) && host.contains(s.el), 'the body is inside the shell’s container');
  assert.ok(s.body.classList.contains('gm-sheet-body') && s.body.classList.contains('gm-inline'), 'same classes as a sheet body plus gm-inline');
  assert.equal(s.el.getAttribute('data-inline'), 'print');
  s.open(); assert.equal(s.isOpen(), true);
  s.close(); s.toggle(); assert.deepEqual(closed, ['print', 'print'], 'close and toggle ask the shell, they hide nothing');
  assert.equal(s.isOpen(), true, 'still there after close()');
  assert.equal(p.W.bound('print'), true); assert.deepEqual(Array.from(p.W.boundIds()), ['print']);
});

await test('inline: sheet(root, id, title) returns the same object while bound, and the title becomes the small heading', () => {
  const p = page(), host = p.box();
  const s = p.W.inline('trouble', host);
  const again = p.W.sheet(null, 'trouble', 'Trouble desk');     /* no root at all: the binding answers */
  assert.equal(again, s);
  assert.equal(host.querySelector('.gm-inline-h').textContent, 'Trouble desk');
  const quiet = p.W.inline('lair', p.box(), { title: false });
  assert.equal(quiet.el.querySelector('.gm-inline-h'), null, 'title: false drops the heading');
  const named = p.W.inline('canon', p.box(), { title: 'Canon' });
  assert.equal(p.W.sheet(null, 'canon', 'Canon queue'), named);
  assert.equal(named.el.querySelector('.gm-inline-h').textContent, 'Canon', 'an explicit title is kept');
});

await test('inline: unbind runs the tool’s hooks once, empties the container, and unbinding twice is false', () => {
  const p = page(), host = p.box();
  const s = p.W.inline('aftermath', host);
  let stopped = 0; s.onUnbind(() => { stopped++; }); s.onUnbind(() => { throw new Error('a tool’s cleanup must not stop the unbind'); });
  s.body.textContent = 'drawn';
  assert.equal(p.W.inline('aftermath', null), true);
  assert.equal(stopped, 1); assert.equal(host.children.length, 0, 'emptied'); assert.equal(p.W.bound('aftermath'), false);
  assert.equal(s.isOpen(), false, 'a stale object says it is not open');
  assert.equal(p.W.inline('aftermath', null), false);
  s.onUnbind(() => { stopped++; }); assert.equal(stopped, 1, 'a hook added after the unbind is dropped');
});

await test('inline: bind again replaces the old binding (hooks run, old wrapper gone), and a non-element is refused', () => {
  const p = page(), a = p.box(), b = p.box();
  const s1 = p.W.inline('board', a); let n = 0; s1.onUnbind(() => { n++; });
  const s2 = p.W.inline('board', b);
  assert.equal(n, 1); assert.equal(a.children.length, 0); assert.equal(b.children.length, 1); assert.notEqual(s1, s2);
  assert.equal(p.W.sheet(null, 'board', 'x'), s2);
  assert.equal(p.W.inline('board', {}), null); assert.equal(p.W.inline('board', 'nope'), null);
  assert.equal(p.W.bound('board'), true, 'a refused bind leaves the old one alone... (the refusal comes before the unbind)');
});

await test('inline: Esc goes through B68GmEsc at priority 40, only when asked (esc: true) and only while bound', () => {
  const p = page(), host = p.box(), closed = [];
  p.W.inline('print', host, { onClose: () => closed.push('print') });
  assert.deepEqual(Array.from(p.Esc.list()), [], 'no Esc entry unless asked');
  p.W.inline('print', host, { onClose: () => closed.push('print'), esc: true });
  const ent = Array.from(p.Esc.list()).filter((e) => e.id === 'inline-print')[0];
  assert.ok(ent && ent.priority === 40 && ent.open === true);
  assert.equal(p.Esc.handle({}), 'closed:inline-print'); assert.deepEqual(closed, ['print']);
  p.W.inline('print', null);
  assert.deepEqual(Array.from(p.Esc.list()), [], 'unbinding takes the entry down');
  assert.equal(p.Esc.handle({}), 'none');
  p.W.inline('lair', p.box(), { esc: true });
  assert.deepEqual(Array.from(p.Esc.list()), [], 'esc: true without an onClose registers nothing');
});

await test('inline Esc: a bound tool is open only while it is drawn; hidden or detached it holds back no key (anyOpen) and Esc goes past it', () => {
  const p = page(), host = p.box(), closed = [];
  p.W.inline('print', host, { onClose: () => closed.push('print'), esc: true });
  assert.equal(p.Esc.anyOpen(), true, 'bound and drawn: open');
  host.hidden = true;                                                     /* the place hides the column the tool lives in */
  assert.equal(p.Esc.anyOpen(), false, 'bound but hidden: not open');
  let panics = 0;
  assert.equal(p.Esc.handle({ panic: () => { panics++; } }), 'panic', 'Esc goes past a hidden tool'); assert.equal(panics, 1); assert.deepEqual(closed, []);
  host.hidden = false; host.style.display = 'none';
  assert.equal(p.Esc.anyOpen(), false, 'display:none on the container: not open');
  host.style.display = '';
  assert.equal(p.Esc.anyOpen(), true, 'drawn again: open again');
  host.remove();                                                          /* the shell dropped the container without unbinding */
  assert.equal(p.W.bound('print'), true, 'still bound');
  assert.equal(p.Esc.anyOpen(), false, 'bound but detached: not open');
  assert.equal(Array.from(p.Esc.list()).filter((e) => e.id === 'inline-print')[0].open, false);
  assert.equal(p.W.inline('print', null), true); assert.deepEqual(Array.from(p.Esc.list()), [], 'unbinding still takes the entry down');
});

await test('sheet Esc: an open right-edge sheet counts as open only while it is in the document', () => {
  const p = page(), root = p.box();
  const s = p.W.sheet(root, 'lair', 'The lair'); s.open();
  const ent = () => Array.from(p.Esc.list()).filter((e) => e.id === 'sheet-lair')[0];
  assert.ok(ent() && ent().priority === 50 && ent().open === true, 'open and in the page');
  root.remove();
  assert.equal(ent().open, false, 'its root left the document: not open'); assert.equal(p.Esc.anyOpen(), false);
  p.body.appendChild(root); assert.equal(ent().open, true, 'back in the page: open');
  s.close(); assert.equal(ent().open, false, 'closed: not open');
});

await test('aftermath: its 10 s tick lives on its own box: the right-edge copy a bind emptied stops (one tick while bound), the unbind stops the inline one, and a box that leaves stops only its own', () => {
  const p = page(), timers = new Map();
  let seq = 0, bound = false;
  const hooks = [], sheetBody = p.box(), inlineHost = p.box(), inlineBody = inlineHost.appendChild(p.doc.createElement('div'));
  const win = {
    document: p.doc, console,
    setInterval: (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms, live: true }); return id; },
    clearInterval: (id) => { const t = timers.get(id); if (t) t.live = false; },
    B68Features: { valueOf: () => true },
    B68GmPage: { aftermath: () => ({ doc: {}, night: null, npcs: [], crew: {}, toast() {} }), show: () => Promise.resolve(null), layer: () => Promise.resolve(null), clearShow: () => Promise.resolve(null) },
    /* the host as the tool sees it: the right-edge sheet's body, or (bound) the inline body with its onUnbind */
    B68GmWorkshop: { sheet: () => (bound ? { body: inlineBody, inline: true, open() {}, close() {}, isOpen: () => true, onUnbind: (fn) => hooks.push(fn) } : { body: sheetBody, open() {}, close() {}, isOpen: () => true }) }
  };
  win.self = win;
  vm.createContext(win);
  vm.runInContext(src('gm/aftermath.js'), win, { filename: 'gm/aftermath.js' });
  const A = win.B68GmAftermath, live = () => [...timers.entries()].filter(([, t]) => t.live).map(([id]) => id), tick = (id) => timers.get(id).fn();
  A.open(p.body);
  assert.deepEqual(live(), [1], 'the right-edge sheet ticks'); assert.equal(timers.get(1).ms, 10000);
  bound = true; A.open(p.body);
  assert.deepEqual(live(), [1, 2], 'bound inline, the inline copy has its own tick');
  sheetBody.textContent = '';                              /* what workshop.inline() does to the right-edge copy */
  tick(1); tick(2);
  assert.deepEqual(live(), [2], 'the emptied copy stopped itself: one tick runs while bound');
  hooks.splice(0).forEach((fn) => fn());                   /* the shell unbinds */
  assert.deepEqual(live(), [], 'the unbind stopped the inline tick: nothing is left running');
  bound = false; A.open(p.body); bound = true; A.open(p.body);
  assert.deepEqual(live(), [3, 4], 'both copies drawn again: one tick each');
  sheetBody.remove(); tick(3);                             /* the OLDER box leaves the page */
  assert.deepEqual(live(), [4], 'the box that left stopped its own interval and left the live one alone');
  hooks.splice(0).forEach((fn) => fn());
  assert.deepEqual(live(), []);
});

await test('registry: get(id) answers for the 18 tools and still for the tabs; a tool id cannot shadow a tab', () => {
  const p = page(), ids = p.R.IDS;
  assert.equal(ids.length, 18); assert.equal(new Set(ids).size, 18);
  assert.equal(p.T.get('prep').builtin, true, 'a tab is still the tab');
  assert.equal(p.T.get('hardstart'), null, 'nothing registered yet');
  const calls = [];
  for (const id of ids) p.T.registerTool(id, { open: () => { calls.push('open:' + id); return true; }, close: () => { calls.push('close:' + id); } });
  assert.deepEqual(Array.from(p.T.toolIds()), ids);
  for (const id of ids) { const t = p.T.get(id); assert.equal(t.id, id); assert.equal(t.kind, 'tool'); assert.equal(typeof t.open, 'function'); assert.equal(typeof t.close, 'function'); assert.equal(typeof t.mounted, 'function'); assert.ok(t.label); }
  assert.equal(p.T.get('run').builtin, true); assert.equal(p.T.tool('run'), null);
  assert.throws(() => p.T.registerTool('prep', { open: () => true }), /is a tab/);
  assert.throws(() => p.T.registerTool('Bad Id', { open: () => true })); assert.throws(() => p.T.registerTool('x', {}));
  p.T.get('print').open(); p.T.get('print').close(); assert.deepEqual(calls, ['open:print', 'close:print']);
  assert.equal(p.T.unregisterTool('print'), true); assert.equal(p.T.get('print'), null); assert.equal(p.T.unregisterTool('print'), false);
  assert.equal(p.T.table().length, p.T.list().length, 'the tab table is untouched');
});

await test('registry: a tab can never take a tool’s id (get() asks the tabs first, so the tab would hide the tool)', () => {
  const p = page();
  p.T.registerTool('print', { open: () => true });
  assert.throws(() => p.T.register({ id: 'print', label: 'Print tab', phases: 'all' }), /tab print is a tool/);
  assert.equal(p.T.get('print').kind, 'tool', 'the tool still answers'); assert.equal(p.T.list().some((t) => t.id === 'print'), false, 'and no tab was added');
  for (const id of p.R.IDS) assert.throws(() => p.T.register({ id, label: 'X', phases: 'all' }), /is a tool/, id + ': refused, registered yet or not');
  p.T.registerTool('zz-extra', { open: () => true });
  assert.throws(() => p.T.register({ id: 'zz-extra', label: 'X', phases: 'all' }), /is a tool/, 'a tool registered beyond the 18 too');
  const tab = p.T.register({ id: 'testtab', label: 'Test tab', phases: ['plan'] });
  assert.equal(tab.id, 'testtab'); assert.equal(p.T.get('testtab').label, 'Test tab', 'any other tab registers as before');
  assert.throws(() => p.T.register({ id: 'prep', label: 'x', phases: 'all' }), /built in/, 'the tab registry’s own checks still run');
  assert.throws(() => p.T.register(null), /object/);
  assert.equal(p.T.unregister('testtab'), true);
});

await test('registry: open() is true/false and never throws; mounted() follows the inline binding', () => {
  const p = page();
  p.T.registerTool('print', { open: () => true });
  p.T.registerTool('lair', { open: () => false });
  p.T.registerTool('absent', { open: () => { throw new Error('boom'); } });
  const quiet = { error() {} }; p.win.console = quiet;
  assert.equal(p.T.get('print').open(), true); assert.equal(p.T.get('lair').open(), false); assert.equal(p.T.get('absent').open(), false);
  assert.equal(p.T.get('print').mounted(), false);
  p.W.inline('print', p.box()); assert.equal(p.T.get('print').mounted(), true);
  p.W.inline('print', null); assert.equal(p.T.get('print').mounted(), false);
  p.T.registerTool('print', { open: () => 'again' }); assert.equal(Array.from(p.T.toolIds()).filter((i) => i === 'print').length, 1, 'registering again replaces');
});

await test('registry: gm-page.js registers every one of the 18 ids, each once, and no tool inserts its own Menu line', () => {
  const page_ = src('gm-page.js'), body = page_.slice(page_.indexOf('function registerTools()'), page_.indexOf('4.1 The cue stack'));
  const ids = (R && R.IDS) || [];
  assert.equal(ids.length, 18);
  for (const id of ids) {
    const n = (body.match(new RegExp("(reg|mod)\\('(?:B68Gm[A-Za-z]+', ')?" + id + "'", 'g')) || []).length + (body.match(new RegExp("reg\\('" + id + "'", 'g')) || []).length;
    assert.ok(n >= 1, id + ' is registered in gm-page.js');
  }
  for (const f of ['aftermath', 'debrief', 'board', 'castphoto', 'lair', 'room-desk', 'b29']) {
    const t = src('gm/' + f + '.js');
    assert.ok(!t.includes('gm-menu-list') && !t.includes('insertAdjacentHTML'), f + ' draws no Menu line');
  }
  assert.ok(!/(pf|pr|cb|mt|rd|hs)Menu(Sync|Line)|.menuSync/.test(page_), 'gm-page.js has no tool Menu-line sync left');
  const routes = src('routes.js');
  assert.ok(routes.indexOf("'gm/tools.js'") < routes.indexOf("'gm/tool-registry.js'") && routes.indexOf("'gm/tool-registry.js'") < routes.indexOf("'gm-page.js'"), 'tool-registry.js loads after tools.js and before the page');
  const display = routes.split('\n').find((l) => /^\s*display:/.test(l)); assert.ok(!/tool-registry/.test(display), 'the display never fetches it');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
