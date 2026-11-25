// kit-shell-stack (RK27.3): the kit shell's toast stack leaves the page with its last toast. No browser, no network: app/gm/kit/shell.js runs in a
// vm against a small fake page and a fake clock.
//   When kit.desk turns off, clearStack dismisses what the shell put in the stack. A toast leaves in two steps (it is marked is-leaving, and its
//   element goes when its leave ends), so at that moment the stack still holds a toast and the old code left it behind, empty, for good.
//   node checks/runtime/kit-shell-stack.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'app', 'gm', 'kit', 'shell.js'), 'utf8');
const LEAVE_MS = 200;

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

/* a page of nodes that know classes, children and a parent; selectors are one or more classes (".a" or ".a.b") */
class Node {
  constructor(cls) { this.cls = new Set(cls.split(' ').filter(Boolean)); this.kids = []; this.parentNode = null; this.classList = { add: (c) => this.cls.add(c), remove: (c) => this.cls.delete(c), contains: (c) => this.cls.has(c) }; }
  append(n) { n.parentNode = this; this.kids.push(n); return n; }
  removeChild(n) { this.kids = this.kids.filter((k) => k !== n); n.parentNode = null; return n; }
  matches(sel) { return sel.split('.').filter(Boolean).every((c) => this.cls.has(c)); }
  all(sel) { const out = []; for (const k of this.kids) { if (k.matches(sel)) out.push(k); out.push(...k.all(sel)); } return out; }
  querySelectorAll(sel) { return this.all(sel); }
  querySelector(sel) { return this.all(sel)[0] || null; }
}
function makePage() {
  const body = new Node(''), timers = []; let now = 0, seq = 0, kit = true;
  const W = {
    document: { body, getElementById: () => null, querySelectorAll: (s) => body.all(s), querySelector: (s) => body.querySelector(s) },
    setTimeout: (fn, ms) => { timers.push({ id: ++seq, at: now + (ms || 0), fn }); return seq; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    setInterval: () => 0, clearInterval: () => {},
    B68Kit: { ready: (n) => kit && n === 'desk', onChange: () => {} },
    B68Ui: { node: () => ({}) }
  };
  /* the kit's stack as overlay.js builds it: one .ui-toast-stack in the body, a .ui-toast in it per toast; dismiss marks it is-leaving and the element
     goes LEAVE_MS later, with no event */
  let stack = null, id = 0;
  W.B68Ui.toast = (o) => {
    if (!stack || stack.parentNode !== body) { stack = new Node('ui-toast-stack'); body.append(stack); }
    const el = new Node('ui-toast ui-toast--' + o.tone); stack.append(el);
    const h = { id: ++id, st: 'shown', el, state: () => h.st };
    h.dismiss = () => {
      if (h.st === 'gone' || h.st === 'leaving') return;
      h.st = 'leaving'; el.classList.add('is-leaving');
      W.setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); h.st = 'gone'; }, LEAVE_MS);
    };
    return h;
  };
  /* a toast the page raised some other way: it is in the stack, but the shell does not hold its handle */
  const foreign = () => { const h = W.B68Ui.toast({ tone: 'info' }); return h; };
  const tick = (ms) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      if (!timers.length || timers[0].at > end) break;
      const t = timers.shift(); now = Math.max(now, t.at); t.fn();
    }
    now = end;
  };
  const sandbox = { window: W, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'shell.js' });
  return { W, body, tick, foreign, setKit: (v) => { kit = v; }, pending: () => timers.length, shell: () => W.B68KitShell, stacks: () => body.all('ui-toast-stack').length };
}

await test('the fake page loads the shell and the shell speaks through the stack', () => {
  const p = makePage();
  assert.ok(p.shell(), 'B68KitShell is defined');
  assert.equal(p.shell().toast('Saved (invented)', false), true, 'the stack took it');
  assert.equal(p.stacks(), 1);
  assert.equal(p.body.all('ui-toast').length, 1);
});

await test('kit on, a toast live, no clearStack: the stack stays (as long as it likes)', () => {
  const p = makePage();
  p.shell().toast('Saved (invented)', false);
  p.shell().sync();
  assert.equal(p.stacks(), 1, 'a sync with the kit on leaves the stack');
  p.tick(60000);
  assert.equal(p.stacks(), 1, 'a toast that fades by its own timer is the overlay kit\'s own business: the shell sweeps nothing while the kit is on');
  assert.equal(p.pending(), 0, 'and it asks nothing of the clock');
});

await test('kit off with a toast mid-leave: the stack is gone once the toast has left', () => {
  const p = makePage();
  p.shell().toast('Saved (invented)', false);
  p.setKit(false); p.shell().sync();
  assert.equal(p.body.all('.ui-toast.is-leaving').length, 1, 'the toast is leaving at the moment clearStack ran');
  assert.equal(p.stacks(), 1, 'the stack is still holding it for now');
  p.tick(LEAVE_MS - 10);
  assert.equal(p.stacks(), 1, 'still leaving');
  p.tick(200);
  assert.equal(p.body.all('ui-toast').length, 0, 'the toast has left');
  assert.equal(p.stacks(), 0, 'and the empty stack left the page with it');
  assert.equal(p.pending(), 0, 'nothing is left asking');
});

await test('kit off with two toasts leaving: the stack goes when the last one has', () => {
  const p = makePage();
  p.shell().toast('Saved (invented)', false); p.shell().toast('Not saved (invented)', true);
  p.setKit(false); p.shell().sync();
  assert.equal(p.body.all('ui-toast').length, 2);
  p.tick(LEAVE_MS + 100);
  assert.equal(p.stacks(), 0);
});

await test('kit off with a toast the shell does not hold, still live: its stack stays and nothing keeps asking', () => {
  const p = makePage();
  p.shell().toast('Saved (invented)', false); p.foreign();
  p.setKit(false); p.shell().sync();
  p.tick(LEAVE_MS + 100);
  assert.equal(p.body.all('ui-toast').length, 1, 'the page\'s own live toast is not the shell\'s to take away');
  assert.equal(p.stacks(), 1, 'so its stack stays');
  assert.equal(p.pending(), 0, 'and the sweep stopped: a live toast is not leaving');
});

await test('kit off, the toast gone: a second sync has nothing left to do', () => {
  const p = makePage();
  p.shell().toast('Saved (invented)', false);
  p.setKit(false); p.shell().sync(); p.tick(LEAVE_MS + 100);
  assert.equal(p.stacks(), 0);
  p.shell().sync();
  assert.equal(p.stacks(), 0, 'a second sync has nothing to do');
  assert.equal(p.pending(), 0);
});

await test('kit off, then on again before the toast has left: the sweep lets go (nothing changes while the kit is on)', () => {
  const p = makePage();
  p.shell().toast('Saved (invented)', false);
  p.setKit(false); p.shell().sync();
  p.setKit(true);
  p.tick(LEAVE_MS + 500);
  assert.equal(p.pending(), 0, 'no sweep is still asking');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
