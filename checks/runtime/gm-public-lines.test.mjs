// gm-public-lines (RK06 of the room key build, behind the GM setting night.flow): public lines that can't get lost. No browser, no network, no key.
// The pure parts and the controller, on a fake page and fake timers; the real box on the demo night is checks/runtime/fixtures/gm/night-flow-rk06.mjs
// (run by night-flow.e2e.mjs). Invented fixtures only (the Pelican Rooms).
//   the choice   night.pubAuto: off unless set; a stale stamp is off; the patch sets it or nulls it; nothing else of the night is written
//   the timer    one timer, on the oldest line: 20 s, the countdown ticks each second, a new oldest line gets its own 20 s, Hold and off stop it
//   the cards    the large card (the full words, Send, Not now, with auto-send the timer and Hold), the toggle row, the flash (and its cut)
//   the keys     Enter on the box itself sends the oldest line; no listener on the document and no key of the page's is touched
//   node checks/runtime/gm-public-lines.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/public-lines.js';
const PL = require(path.join(ROOT, FILE));
let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

/* ---- a fake page: just enough element for the cards ---- */
function fake(tag) {
  const attrs = {}, kids = [];
  let own = '';
  const e = {
    tagName: String(tag).toUpperCase(), style: {}, children: kids, className: '', checked: false, type: '', parent: null,
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute(k) { return k in attrs ? attrs[k] : null; }, hasAttribute(k) { return k in attrs; },
    appendChild(c) { kids.push(c); c.parent = e; return c; },
    get textContent() { return own + kids.map((k) => k.textContent).join(''); }, set textContent(v) { own = String(v); kids.length = 0; },
    all() { return kids.flatMap((k) => [k, ...k.all()]); },
    byAttr(k, v) { return this.all().filter((n) => n.hasAttribute(k) && (v === undefined || n.getAttribute(k) === v)); },
    querySelector(sel) {
      const m = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
      return m ? this.byAttr(m[1], m[2])[0] || null : null;
    },
  };
  return e;
}
const doc = { createElement: fake };

/* ---- fake timers ---- */
function clock() {
  let t = 1000000, next = 1;
  const timers = new Map();
  const c = {
    now: () => t,
    setTimeout: (f, ms) => { const id = next++; timers.set(id, { f, at: t + ms, every: 0 }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    setInterval: (f, ms) => { const id = next++; timers.set(id, { f, at: t + ms, every: ms }); return id; },
    clearInterval: (id) => { timers.delete(id); },
    live: () => timers.size,
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let best = null, bid = 0;
        for (const [id, x] of timers) if (x.at <= end && (!best || x.at < best.at)) { best = x; bid = id; }
        if (!best) break;
        t = best.at;
        if (best.every) best.at += best.every; else timers.delete(bid);
        best.f();
      }
      t = end;
    },
  };
  return c;
}

test('gm-public-lines: the module loads under Node, and as a plain script it defines window.B68GmPublicLines (no longer a stub)', () => {
  assert.ok(PL && typeof PL === 'object' && !PL.stub, 'a real module');
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, FILE), 'utf8'), win, { filename: FILE });
  const M = win.B68GmPublicLines;
  assert.ok(M && typeof M.attach === 'function' && typeof M.bigRow === 'function' && typeof M.autoOn === 'function', 'B68GmPublicLines has attach, bigRow, autoOn');
  assert.equal(M.AUTO_MS, 20000, 'twenty seconds');
});

test('the choice: off unless night.pubAuto is a recent time; a stale or far-future stamp is off', () => {
  const now = 5e12;
  assert.equal(PL.autoOn(null, now), false); assert.equal(PL.autoOn({}, now), false); assert.equal(PL.autoOn({ night: {} }, now), false);
  assert.equal(PL.autoOn({ night: { pubAuto: true } }, now), false, 'a boolean is not a stamp');
  assert.equal(PL.autoOn({ night: { pubAuto: now - 1000 } }, now), true);
  assert.equal(PL.autoOn({ night: { pubAuto: now - PL.EXPIRE_MS + 1000 } }, now), true);
  assert.equal(PL.autoOn({ night: { pubAuto: now - PL.EXPIRE_MS - 1 } }, now), false, 'a choice left on past 14 h is off');
  assert.equal(PL.autoOn({ night: { pubAuto: now + 3600000 } }, now), false, 'an hour in the future is off');
  assert.equal(PL.autoOn({ night: { pubAuto: now + 20000 } }, now), true, 'a little clock skew is fine');
  assert.equal(PL.autoOn({ night: { pubAuto: 1 } }), true, 'no clock given: the stamp is enough');
});
test('the choice: the patch writes one key under night, or nulls it; nothing else of the night', () => {
  assert.deepEqual(PL.autoPatch(true, 1234.6), { night: { pubAuto: 1235 } });
  assert.deepEqual(PL.autoPatch(false, 1234), { night: { pubAuto: null } });
  assert.deepEqual(Object.keys(PL.autoPatch(true, 99)), ['night']);
  assert.deepEqual(Object.keys(PL.autoPatch(true, 99).night), ['pubAuto']);
  assert.equal(JSON.stringify(PL.autoPatch(true, 1700000000000)).length < 60, true, 'a handful of bytes');
});

test('the timer text: seconds left, or held', () => {
  assert.equal(PL.timerText(14, false), 'Sends in 14 s'); assert.equal(PL.timerText(0, false), 'Sends in 0 s'); assert.match(PL.timerText(9, true), /^Held/);
  assert.equal(PL.secondsLeft(21000, 1000), 20); assert.equal(PL.secondsLeft(21000, 1001), 20); assert.equal(PL.secondsLeft(21000, 20999), 1); assert.equal(PL.secondsLeft(21000, 99999), 0);
});

test('the keys: Enter sends only on the box itself, with no modifier; a button or field inside it keeps its own Enter', () => {
  const box = fake('div'), inner = fake('button');
  assert.equal(PL.isSendKey({ key: 'Enter', target: box }, box), true);
  assert.equal(PL.isSendKey({ key: 'Enter', target: inner }, box), false, 'on a button inside: its own Enter');
  assert.equal(PL.isSendKey({ key: 'Enter', target: box, shiftKey: true }, box), false);
  assert.equal(PL.isSendKey({ key: 'Enter', target: box, ctrlKey: true }, box), false);
  assert.equal(PL.isSendKey({ key: 'Enter', target: box, isComposing: true }, box), false);
  for (const k of ['s', 'S', 'n', 'N', 'Escape', ' ', 'Tab']) assert.equal(PL.isSendKey({ key: k, target: box }, box), false, k + ' does nothing here');
  assert.equal(PL.isSendKey(null, box), false); assert.equal(PL.isSendKey({ key: 'Enter', target: box }, null), false);
});

test('the timer: 20 s on the one oldest line, ticking each second; the same line is not restarted; another line starts its own', () => {
  const c = clock(), fired = [], ticks = [];
  const cd = PL.countdown({ ...c, fire: (id) => fired.push(id), tick: (id, s) => ticks.push(id + ':' + s) });
  cd.sync('a');
  assert.equal(cd.running(), 'a'); assert.equal(cd.left('a'), 20); assert.equal(cd.left('b'), null);
  c.advance(5000); cd.sync('a'); assert.equal(cd.left('a'), 15, 'the same line keeps its clock');
  assert.deepEqual(ticks.slice(0, 5), ['a:19', 'a:18', 'a:17', 'a:16', 'a:15']);
  c.advance(14999); assert.deepEqual(fired, [], 'not yet at 19.999 s');
  c.advance(1); assert.deepEqual(fired, ['a'], 'fires once at 20 s'); assert.equal(cd.running(), '', 'and the timer is over');
  assert.equal(c.live(), 0, 'no timer is left running (nothing moves on an idle screen)');
  c.advance(60000); assert.deepEqual(fired, ['a']);
  cd.sync('b'); c.advance(3000); cd.sync('c'); assert.equal(cd.left('c'), 20, 'a new oldest line restarts the clock'); assert.equal(cd.left('b'), null);
  assert.equal(c.live(), 2, 'one timeout and one interval, never more');
  cd.sync(''); assert.equal(c.live(), 0); c.advance(60000); assert.deepEqual(fired, ['a']);
});

/* ---- the controller, on a fake box and queue ---- */
function rig(opts) {
  const c = clock(), box = fake('div'), q = [], log = [], sent = [], st = { auto: !!(opts && opts.auto), sets: [], redraws: 0 };
  let n = 0, ctl = null;
  const h = {
    el: () => box, items: () => q.slice(), env: c,
    send: (id, how) => { const i = q.findIndex((x) => x.id === id); if (i < 0) return; q.splice(i, 1); sent.push(id + ':' + how); ctl.drawn(); },
    log: (t) => log.push(t), redraw: () => { st.redraws++; ctl.drawn(); }, auto: () => st.auto, setAuto: (on) => { st.auto = on; st.sets.push(on); }, win: () => null,
  };
  ctl = PL.attach(h);
  const add = (text) => { const id = 'l' + (++n); q.push({ id, o: { text } }); ctl.added(); return id; };
  return { c, box, q, log, sent, st, ctl, add };
}
test('auto-send off (the default): a line queues, flashes, and nothing is ever sent by itself', () => {
  const r = rig(); const id = r.add('The speeches begin');
  assert.equal(r.ctl.running(), '', 'no timer'); assert.equal(r.c.live(), 0);
  assert.equal(r.box.getAttribute('data-pl-flash'), '1', 'the box flashed once as the line queued');
  r.c.advance(600000); assert.deepEqual(r.sent, []); assert.equal(r.q.length, 1); assert.equal(r.ctl.opts(id).auto, false);
  r.add('The fireworks'); assert.equal(r.box.getAttribute('data-pl-flash'), '2', 'and again for the next one');
});
test('auto-send on: the oldest line goes after 20 s; the next oldest gets its own 20 s', () => {
  const r = rig({ auto: true }); const a = r.add('The speeches begin'); const b = r.add('The fireworks');
  assert.equal(r.ctl.running(), a, 'the timer is on the oldest line only');
  assert.equal(r.ctl.opts(a).sec, 20); assert.equal(r.ctl.opts(b).sec, null);
  r.c.advance(19999); assert.deepEqual(r.sent, []);
  r.c.advance(1); assert.deepEqual(r.sent, [a + ':auto'], 'the oldest went at 20 s');
  assert.equal(r.ctl.running(), b, 'the next line is now the oldest, with a clock of its own'); assert.equal(r.ctl.opts(b).sec, 20);
  r.c.advance(20000); assert.deepEqual(r.sent, [a + ':auto', b + ':auto']);
  assert.equal(r.c.live(), 0, 'and nothing is left running');
});
test('Send or Not now before the 20 s: the timer follows to the next line; the line never also goes by itself', () => {
  const r = rig({ auto: true }); const a = r.add('One'); const b = r.add('Two');
  r.c.advance(8000);
  r.q.shift(); r.ctl.drawn();      /* the GM pressed Not now on the first */
  assert.equal(r.ctl.running(), b); assert.equal(r.ctl.opts(b).sec, 20, 'a fresh 20 s for the next');
  r.c.advance(19999); assert.deepEqual(r.sent, []); r.c.advance(1); assert.deepEqual(r.sent, [b + ':auto']);
  assert.equal(r.q.length, 0); assert.ok(a);
});
test('Hold stops that line\'s timer and keeps it waiting for Send; the line behind it does not start while it waits', () => {
  const r = rig({ auto: true }); const a = r.add('One'); const b = r.add('Two');
  r.c.advance(6000);
  assert.equal(r.ctl.click('hold', a), true);
  assert.equal(r.ctl.running(), '', 'no timer'); assert.equal(r.ctl.opts(a).held, true); assert.ok(r.st.redraws >= 1, 'the box is redrawn');
  r.c.advance(300000); assert.deepEqual(r.sent, [], 'a held line waits for Send, as today');
  r.q.shift(); r.ctl.drawn();      /* sent by hand */
  assert.equal(r.ctl.running(), b, 'then the next is the oldest and starts');
});
test('the toggle: switching it on starts the oldest line\'s timer and is logged; off stops it; the page stores it', () => {
  const r = rig(); const a = r.add('One');
  assert.equal(r.ctl.click('auto'), true);
  assert.deepEqual(r.st.sets, [true]); assert.deepEqual(r.log, ['Public lines: auto-send on']);
  assert.equal(r.ctl.running(), a);
  r.c.advance(5000);
  r.ctl.click('auto'); assert.deepEqual(r.st.sets, [true, false]); assert.equal(r.log[1], 'Public lines: auto-send off');
  assert.equal(r.ctl.running(), ''); r.c.advance(60000); assert.deepEqual(r.sent, []);
  assert.equal(r.ctl.click('more'), false, 'a press that is not this file\'s is left alone');
});
test('the night ends: the timer stops, the held marks go and the choice is switched off (once)', () => {
  const r = rig({ auto: true }); r.add('One'); r.ctl.end();
  assert.equal(r.ctl.running(), ''); assert.deepEqual(r.st.sets, [false]); assert.equal(r.c.live(), 0);
  r.ctl.end(); assert.deepEqual(r.st.sets, [false], 'already off: nothing more is written');
});
test('Enter on the box sends the oldest line; on anything else, or with nothing queued, it does nothing', () => {
  const r = rig(); const a = r.add('One'); r.add('Two');
  let prevented = 0; const ev = (t, k) => ({ key: k || 'Enter', target: t, preventDefault() { prevented++; } });
  assert.equal(r.ctl.key(ev(fake('button'))), false); assert.deepEqual(r.sent, []);
  assert.equal(r.ctl.key(ev(r.box, 's')), false);
  assert.equal(r.ctl.key(ev(r.box)), true); assert.deepEqual(r.sent, [a + ':key']); assert.equal(prevented, 1);
  r.q.length = 0; assert.equal(r.ctl.key(ev(r.box)), false, 'nothing to send');
});
test('drawn: the box can take the focus (tabindex 0) and a tick writes the seconds into the timer, never a redraw', () => {
  const r = rig({ auto: true }); const a = r.add('One');
  r.ctl.drawn(); assert.equal(r.box.getAttribute('tabindex'), '0');
  const card = PL.bigRow(doc, r.q[0], r.ctl.opts(a)); r.box.appendChild(card);
  const t = r.box.querySelector('[data-pl-timer="' + a + '"]');
  assert.equal(t.textContent, 'Sends in 20 s'); const redraws = r.st.redraws;
  r.c.advance(6000); assert.equal(t.textContent, 'Sends in 14 s', 'the countdown is shown'); assert.equal(r.st.redraws, redraws, 'by writing the text, not redrawing the box');
});

test('the large card: the full words, Send, Not now (the old hooks), and with auto-send the timer and Hold', () => {
  const words = 'The Pelican Rooms band strikes up the last waltz of the night and Ada Vell takes the floor with Dov Kessler, the whole room turning to watch the pair of them go';
  const card = PL.bigRow(doc, { id: 'l9', o: { text: words } }, { auto: false });
  assert.match(card.className, /\bgm-p2-line\b/); assert.equal(card.getAttribute('data-id'), 'l9');
  assert.equal(card.textContent.includes('Public line: “' + words + '”'), true, 'the words in full, not clipped');
  const send = card.byAttr('data-p2-line', 'send')[0], later = card.byAttr('data-p2-line', 'later')[0];
  assert.equal(send.textContent, 'Send'); assert.equal(later.textContent, 'Not now'); assert.equal(send.getAttribute('data-id'), 'l9'); assert.equal(later.getAttribute('data-id'), 'l9');
  assert.match(send.className, /primary/, 'Send is the one Primary'); assert.doesNotMatch(later.className, /primary/);
  assert.equal(card.byAttr('data-pl-timer').length, 0, 'no timer while auto-send is off'); assert.equal(card.byAttr('data-p2-line', 'hold').length, 0);
  const words2 = card.all().find((n) => n.className === 'gm-p2-text'); assert.equal(words2.style.whiteSpace, 'normal'); assert.ok(parseFloat(words2.style.fontSize) >= 14, 'large: at least 14 px');
  const on = PL.bigRow(doc, { id: 'l9', o: { text: 'x' } }, { auto: true, sec: 11 });
  assert.equal(on.byAttr('data-pl-timer')[0].textContent, 'Sends in 11 s'); assert.equal(on.byAttr('data-p2-line', 'hold')[0].textContent, 'Hold');
  const held = PL.bigRow(doc, { id: 'l9', o: { text: 'x' } }, { auto: true, held: true });
  assert.match(held.byAttr('data-pl-timer')[0].textContent, /^Held/); assert.equal(held.byAttr('data-p2-line', 'hold').length, 0, 'a held line has no Hold');
  for (const n of [card, on, held]) for (const x of n.all()) assert.ok(!x.style.fontSize || parseFloat(x.style.fontSize) >= 12, 'nothing under 12 px');
});
test('the toggle row: a checkbox in a label that says what it does, checked as stored', () => {
  const off = PL.footer(doc, false), on = PL.footer(doc, true);
  assert.equal(off.textContent, 'Send them by themselves after 20 s'); assert.equal(PL.AUTO_LABEL, off.textContent);
  const a = off.byAttr('data-p2-line', 'auto')[0], b = on.byAttr('data-p2-line', 'auto')[0];
  assert.equal(a.type, 'checkbox'); assert.equal(a.checked, false); assert.equal(b.checked, true); assert.equal(off.tagName, 'LABEL');
});
test('the flash: once per line (a count on the box); reduced motion is a cut, not an animation', () => {
  const calls = [];
  const box = fake('div'); box.animate = (k, o) => { calls.push([k.length, o.duration]); return {}; };
  assert.equal(PL.flash(box, { matchMedia: () => ({ matches: false }) }), true);
  assert.deepEqual(calls, [[2, 900]], 'one animation, under a second'); assert.equal(box.getAttribute('data-pl-flash'), '1');
  const calm = fake('div'); calm.animate = () => { throw new Error('no animation under reduced motion'); };
  assert.equal(PL.flash(calm, { matchMedia: (q) => ({ matches: /reduce/.test(q) }) }), true);
  assert.equal(calm.style.backgroundColor, '#6b3a12', 'a cut: the ground is brighter at once'); assert.equal(calm.getAttribute('data-pl-flash'), '1');
  assert.equal(PL.flash(null, null), false);
});
test('the flash: two inside 0.7 s do not leave the bright ground behind', async () => {
  const twice = fake('div'); twice.style.backgroundColor = '#1a1714'; const calmWin = { matchMedia: () => ({ matches: true }) };
  PL.flash(twice, calmWin); PL.flash(twice, calmWin); assert.equal(twice.style.backgroundColor, '#6b3a12'); assert.equal(twice.getAttribute('data-pl-flash'), '2');
  await new Promise((ok) => setTimeout(ok, 800)); assert.equal(twice.style.backgroundColor, '#1a1714', 'back to the ground it had');
});

test('the source: no listener on the document, no key bound by this file, no string over 220 characters, and the page file passes the flow in one place', () => {
  const src = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
  assert.doesNotMatch(src, /document\.addEventListener|W\.addEventListener|window\.addEventListener|keyCode/, 'no document-level listener');
  assert.doesNotMatch(src, /ev\.key === '[a-zA-Z]'|Escape/, 'no letter key, and Esc is B68GmEsc\'s, not this file\'s');
  for (const f of [FILE, 'app/gm/players-screen.js']) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of t.matchAll(/'([^'\\\n]|\\.)*'|"([^"\\\n]|\\.)*"/g)) assert.ok(m[0].length <= 222, f + ': a string literal of ' + m[0].length + ' characters');
    assert.doesNotMatch(t, /document\.addEventListener\(\s*['"]keydown/, f + ' adds no document-level key listener');
  }
  const ps = fs.readFileSync(path.join(ROOT, 'app/gm/players-screen.js'), 'utf8');
  assert.equal((ps.match(/addEventListener\('keydown'/g) || []).length, 1, 'one keydown listener, on the box');
  assert.match(ps, /rec\.el\.addEventListener\('keydown'/);
  const gp = fs.readFileSync(path.join(ROOT, 'app/gm-page.js'), 'utf8');
  assert.equal((gp.match(/function p2Flow\(/g) || []).length, 1); assert.equal((gp.match(/flow: function \(\) \{ return p2Flow\(me\); \}/g) || []).length, 2, 'the hold and the night\'s end');
  assert.match(gp, /b09On\('night\.flow'\)/);
});

for (const [name, fn] of queue) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
