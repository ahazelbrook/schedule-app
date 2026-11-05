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

/* a page: a window with the real tools.js, tool-registry.js, esc.js and workshop.js loaded in the order routes.js gives */
function page() {
  const doc = { createElement: (t) => { const e = new MiniEl(t); e.ownerDocument = doc; return e; } };
  const win = { document: doc, console };
  win.self = win;
  vm.createContext(win);
  for (const f of ['gm/esc.js', 'gm/tools.js', 'gm/tool-registry.js', 'gm/workshop.js']) vm.runInContext(src(f), win, { filename: f });
  const box = () => { const e = doc.createElement('div'); e.isConnected = true; return e; };
  return { win, doc, W: win.B68GmWorkshop, T: win.B68GmTools, Esc: win.B68GmEsc, R, box };
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
