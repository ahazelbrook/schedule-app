// kit-stage-roll (KS15, the roll as beats, behind kit.stage): the desk's side (app/gm/stamp.js: who on the stamp, the result and the cost laid
// again under the stamp's own id, and the guard that a re-lay never undoes a takedown), the Roll's cost field (app/gm/roll.js) and the iPad's
// beats (app/display/kit/roll.js through display/report-beat.js: the stakes plate, the slam in plain words, the cost, the last-roll chip held in
// the display's memory only). A fake host stands in for the page and a small DOM for the iPad. Invented cast only (Ray, Lotte); every GM-only
// string is a GM-ONLY- marker. No network, no model, no browser.
//   node checks/runtime/kit-stage-roll.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MiniEl, MiniText, writes } from './minidom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const St = require(path.join(ROOT, 'app', 'gm', 'stamp.js'));
const Show = require(path.join(ROOT, 'app', 'gm', 'show.js'));
const R = require(path.join(ROOT, 'app', 'gm', 'roll.js'));

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const tick = () => new Promise((r) => setTimeout(r, 0));

/* ---------- the desk ---------- */
const LINE = 'She calls the desk.';
function makeHost(over = {}) {
  const calls = { show: [], clear: 0, toast: [], timers: [], changed: 0 };
  let overlay = '', line = LINE, covered = false;
  const on = Object.assign({ 'spine.stamp': true, 'spine.sizer': true, 'kit.stage': true }, over.on || {});
  const host = {
    feature: (id) => !!on[id], positions: () => [{ value: 'risky', severity: 'moderate', ticks: '2 ticks', harm: '2' }], roomLines: () => [LINE],
    currentPosition: () => 'risky', setPosition: () => {}, line: () => line, setLine: (t) => { line = t; },
    show: (payload, key, ms, o) => {
      const call = { payload, key, ms, replace: !!(o && o.replace) }; calls.show.push(call);
      if (over.refuse && over.refuse(call)) return Promise.resolve(null);
      const go = () => { overlay = Show.idFor(key); return { ok: true }; };
      return over.hold ? new Promise((res) => { over.hold.push(() => res(go())); }) : Promise.resolve(go());
    },
    keyFor: (k) => Show.idFor(k), overlayId: () => overlay, clearOverlay: async () => { calls.clear++; overlay = ''; return {}; },
    who: () => (over.who !== undefined ? over.who : 'Ray'), covered: () => covered,
    vet: (p) => (over.vet ? over.vet(p) : true),
    log: () => {}, toast: (m, bad) => calls.toast.push([m, !!bad]), now: () => 1700000000000,
    setTimeout: (fn, ms) => { calls.timers.push({ fn, ms }); return calls.timers.length; }, clearTimeout: (h) => { const t = calls.timers[h - 1]; if (t) t.cancelled = true; }, changed: () => { calls.changed++; },
  };
  return { host, calls, on, setOverlay: (v) => { overlay = v; }, cover: (v) => { covered = v; }, fire: (ms) => calls.timers.filter((t) => t.ms === ms && !t.cancelled).forEach((t) => { t.cancelled = true; t.fn(); }) };
}
async function stamped(over) {
  const h = makeHost(over); const c = St.create(h.host);
  const p = c.fire(); if (over && over.hold) { await tick(); over.hold.splice(0).forEach((f) => f()); }
  assert.equal(await p, true); return { ...h, c };
}

await test('setting off: the stamp carries no who, and a mark takes the card down exactly as today (no re-lay, the sizer offered)', async () => {
  const { c, calls } = await stamped({ on: { 'kit.stage': false } });
  assert.deepEqual(calls.show[0].payload, { position: 'risky', effect: 'standard', text: LINE }); assert.equal(calls.show[0].replace, false);
  assert.equal(await c.mark('45'), true);
  assert.equal(calls.show.length, 1, 'nothing laid again'); assert.equal(calls.clear, 1, 'the card came down');
  assert.equal(c.view().active, null); assert.equal(c.view().sizer.result, '45'); assert.equal(c.view().cost, undefined, 'no cost field'); assert.equal(c.view().beats, undefined, 'off: Clean keeps its old words');
});

await test('stakes: the stamp carries who (cut to 40), as a normal keyed show; the payload passes the GM check', async () => {
  const { calls } = await stamped({ who: '  Ray   Okonjo ' + 'x'.repeat(60) });
  const p = calls.show[0].payload;
  assert.equal(p.who.length, 40); assert.ok(p.who.startsWith('Ray Okonjo x')); assert.equal(Show.payloadOk('report', p), true);
  assert.equal(calls.show[0].replace, false, 'the stamp itself is once by id'); assert.equal(calls.show[0].ms, 180000);
});

await test('result: a 4/5 lays the SAME beat again with its result (same key, replace, 8 s); it stays up, the sizer and the cost field are offered, and it folds after 8 s', async () => {
  const { c, calls, fire } = await stamped();
  assert.equal(await c.mark('45'), true);
  assert.equal(calls.show.length, 2); const r = calls.show[1];
  assert.equal(r.key, calls.show[0].key, 'the same key, so the same overlay'); assert.equal(r.replace, true); assert.equal(r.ms, 8000);
  assert.deepEqual(r.payload, { position: 'risky', effect: 'standard', text: LINE, who: 'Ray', result: '45' });
  assert.equal(calls.clear, 0, 'not taken down');
  const v = c.view(); assert.equal(v.beats, true); assert.equal(v.active.result, '45'); assert.equal(v.sizer.result, '45'); assert.deepEqual(v.cost, { result: '45', draft: '', sent: '' });
  fire(8000); assert.equal(c.view().active, null, 'folded'); assert.ok(c.view().cost, 'the cost can still follow once it has folded');
  assert.equal(calls.timers.filter((t) => t.ms === 170000 && !t.cancelled).length, 0, 'no stakes refresh after the result');
});

await test('result: Clean says "You do it." with no cost field; 1-3 offers one', async () => {
  let h = await stamped(); await h.c.mark('clean');
  assert.equal(h.calls.show[1].payload.result, 'clean'); assert.equal(h.c.view().cost, undefined);
  h = await stamped(); await h.c.mark('13'); assert.equal(h.calls.show[1].payload.result, '13'); assert.equal(h.c.view().cost.result, '13');
});

await test('Gate 2 (1): a re-lay never undoes a takedown: Take it down / Esc, Clean, another show, Blank, PANIC', async () => {
  let h = await stamped(); await h.c.clear(); let n = h.calls.show.length;
  assert.equal(await h.c.mark('45'), false); assert.equal(h.calls.show.length, n, 'Take it down: no re-lay');
  h = await stamped(); await h.c.esc(); n = h.calls.show.length; await h.c.mark('13'); assert.equal(h.calls.show.length, n, 'Esc: no re-lay');
  h = await stamped(); await h.c.mark('45'); n = h.calls.show.length; await h.c.mark('clean');
  assert.equal(h.calls.show.length, n, 'Clean over a result: no re-lay'); assert.equal(h.calls.clear, 1, 'Clean took it down'); assert.equal(h.c.view().active, null);
  assert.equal(h.c.view().cost, undefined, 'and the cost field went with it'); await h.c.mark('45'); assert.equal(h.calls.show.length, n);
  h = await stamped(); h.setOverlay('some-other-beat'); n = h.calls.show.length; await h.c.mark('45');
  assert.equal(h.calls.show.length, n, 'another show: no re-lay'); assert.equal(h.calls.clear, 0, 'and it is left up');
  h = await stamped(); h.cover(true); n = h.calls.show.length; await h.c.mark('45');
  assert.equal(h.calls.show.length, n, 'Blank: no re-lay'); assert.equal(h.calls.clear, 1, 'the card came down as today');
  h = await stamped(); h.cover(true); h.setOverlay(''); n = h.calls.show.length; await h.c.mark('13');
  assert.equal(h.calls.show.length, n, 'PANIC: no re-lay');
});

await test('Gate 2 (1), review: PANIC, Blank, another show taking over, or the overlay cleared elsewhere END the cost field, as Take it down does; it never comes back', async () => {
  // Blank, then Enter: not sent, and the field is gone; after the lights come back, nothing to send
  let h = await stamped(); await h.c.mark('45'); h.c.costDraft('Lotte remembers your face.'); h.cover(true); let n = h.calls.show.length;
  assert.equal(await h.c.sendCost(), false); assert.equal(h.calls.show.length, n, 'blank: not sent');
  assert.ok(h.calls.toast.some((t) => t[1] && /moved on/.test(t[0]))); assert.equal(h.c.view().cost, undefined, 'the field ended');
  h.cover(false); assert.equal(await h.c.sendCost('Lotte remembers your face.'), false); assert.equal(h.calls.show.length, n, 'after Resume: never put back');
  // the once-a-second look ends it without an Enter: Blank, PANIC (covered and cleared), another show, a clear from elsewhere
  for (const [what, act] of [['Blank', (x) => x.cover(true)], ['PANIC', (x) => { x.cover(true); x.setOverlay(''); }], ['another show', (x) => x.setOverlay('some-other-beat')], ['a clear from elsewhere', (x) => x.setOverlay('')]]) {
    h = await stamped(); await h.c.mark('13'); h.fire(1000); h.fire(8000); h.fire(1000);
    assert.ok(h.c.view().cost, what + ': the field stays while nothing has moved on (and after the fold)');
    act(h); const ch = h.calls.changed; h.fire(1000);
    assert.equal(h.c.view().cost, undefined, what + ': the field ended'); assert.ok(h.calls.changed > ch, what + ': the Roll is redrawn');
    h.cover(false); h.setOverlay(''); n = h.calls.show.length;
    assert.equal(await h.c.sendCost('Lotte remembers your face.'), false); assert.equal(h.calls.show.length, n, what + ': minutes later, still nothing goes');
    assert.equal(h.calls.timers.filter((t) => t.ms === 1000 && !t.cancelled).length, 0, what + ': no look left running');
  }
  // Take it down: no cost to send
  h = await stamped(); await h.c.mark('13'); await h.c.clear(); n = h.calls.show.length;
  assert.equal(h.c.view().cost, undefined); assert.equal(await h.c.sendCost('Lotte remembers your face.'), false); assert.equal(h.calls.show.length, n, 'taken down: never put back');
});

await test('review (4): a cost the page itself would refuse (a hidden name) gets only the cost message, is not sent, and keeps its text', async () => {
  const h = await stamped({ vet: (p) => !/GM-ONLY/.test(p.cost || '') }); await h.c.mark('45'); const n = h.calls.show.length;
  assert.equal(await h.c.sendCost('GM-ONLY-NPC-1 saw it'), false); assert.equal(h.calls.show.length, n, 'not sent');
  assert.deepEqual(h.calls.toast, [['The cost did not go to the iPad. It is still in the field.', true]]); assert.equal(h.c.view().cost.draft, 'GM-ONLY-NPC-1 saw it');
  assert.equal(await h.c.sendCost('Lotte remembers your face.'), true);
});

await test('Gate 2 (1): a mark after kit.stage turns off takes the card down as today, even over a result', async () => {
  let h = await stamped(); h.on['kit.stage'] = false; let n = h.calls.show.length; await h.c.mark('45');
  assert.equal(h.calls.show.length, n); assert.equal(h.calls.clear, 1); assert.equal(h.c.view().sizer.result, '45');
  h = await stamped(); await h.c.mark('45'); h.on['kit.stage'] = false; n = h.calls.show.length; await h.c.mark('13');
  assert.equal(h.calls.show.length, n, 'no re-lay'); assert.equal(h.calls.clear, 1, 'the result came down'); assert.equal(h.c.view().active, null);
  assert.equal(await h.c.sendCost('x'), false, 'off: no cost goes');
});

await test('Gate 2 (1): a result that lands after Esc (the write was still out) is taken straight back off', async () => {
  const hold = []; const h = await stamped({ hold });
  const pending = h.c.mark('45'); await tick();
  assert.equal(hold.length, 1, 'the result write is out');
  await h.c.esc(); const cleared = h.calls.clear;
  hold.splice(0).forEach((f) => f()); assert.equal(await pending, false);
  await tick(); assert.equal(h.calls.clear, cleared + 1, 'the late result was taken back off'); assert.equal(h.c.view().active, null);
});

await test('Gate 2 (2): a refused cost (the hidden-name scan) shows an error and KEEPS the typed text; a sent one goes as the same beat with the cost (10 s)', async () => {
  const h = await stamped({ refuse: (c) => /GM-ONLY/.test(c.payload.cost || '') });
  await h.c.mark('13');
  h.c.costDraft('GM-ONLY-NPC-1 saw it');
  assert.equal(await h.c.sendCost(), false);
  assert.ok(h.calls.toast.some((t) => t[1] && /did not go/.test(t[0])), 'an error toast: ' + JSON.stringify(h.calls.toast));
  assert.equal(h.c.view().cost.draft, 'GM-ONLY-NPC-1 saw it', 'the text is kept'); assert.equal(h.c.view().cost.sent, '');
  assert.equal(await h.c.sendCost(''), false, 'an empty cost is not sent'); assert.ok(h.calls.toast.pop()[1]);
  assert.equal(await h.c.sendCost('Lotte remembers your face.'), true);
  const s = h.calls.show[h.calls.show.length - 1];
  assert.equal(s.key, h.calls.show[0].key); assert.equal(s.replace, true); assert.equal(s.ms, 10000);
  assert.deepEqual(s.payload, { position: 'risky', effect: 'standard', text: LINE, who: 'Ray', result: '13', cost: 'Lotte remembers your face.' });
  assert.equal(h.c.view().cost.sent, 'Lotte remembers your face.'); assert.equal(h.c.view().active.cost, 'Lotte remembers your face.');
  assert.equal(await h.c.sendCost('x'.repeat(80)), true); assert.equal(h.calls.show[h.calls.show.length - 1].payload.cost.length, 60, 'cut to 60');
});

await test('a new stamp replaces whatever beat is up (a new key, once by id) and ends the cost field', async () => {
  const h = await stamped(); await h.c.mark('45'); h.c.costDraft('half typed');
  assert.equal(await h.c.stampNow('desperate', 'great', 'The lights fail'), true);
  const s = h.calls.show[h.calls.show.length - 1];
  assert.notEqual(s.key, h.calls.show[0].key); assert.equal(s.replace, false); assert.equal(s.payload.result, undefined);
  assert.equal(h.c.view().cost, undefined); assert.equal(h.c.view().active.result, undefined);
});

await test('the Roll: the cost field is drawn only when the stamp view carries it (setting off: stampHtml is what it was), escaped, Enter sends', async () => {
  const base = { on: true, active: { position: 'risky', effect: 'standard', text: 'x' }, stale: false };
  assert.ok(!R.stampHtml(base).includes('stamp-cost')); assert.ok(!R.stampHtml({ on: true, active: null }).includes('stamp-cost'));
  const h = R.stampHtml({ ...base, active: { ...base.active, result: '45' }, cost: { result: '45', draft: '<b>GM</b>', sent: '' } });
  assert.ok(h.includes('data-gm="stamp-cost"') && h.includes('Cost on the iPad') && h.includes('maxlength="60"'));
  assert.ok(h.includes('&lt;b&gt;GM&lt;/b&gt;') && !h.includes('<b>GM'), 'the draft is text'); assert.ok(h.includes('You do it. It costs.'));
  assert.ok(h.includes('>Stamp it on the iPad<') && !h.includes('Changed since it went up') && !h.includes('Stamp again'), 'while a result is up the next stamp is a new one');
  assert.ok(R.stampHtml({ on: true, active: null, cost: { result: '13', draft: '', sent: 'Lotte remembers your face.' } }).includes('On the iPad: Lotte remembers your face.'));
  // review (2): Clean says what it does with the setting on and the stakes up; over a result, and with the setting off, it is as today
  assert.ok(R.stampHtml({ ...base, beats: true }).includes('>Clean: You do it.<') && R.stampHtml({ ...base, beats: true }).includes('for 8 seconds'));
  assert.ok(R.stampHtml(base).includes('>Clean (no card)<') && R.stampHtml(base).includes('title="Take the card down; the roll needs no consequence"'), 'off: as today');
  assert.ok(R.stampHtml({ ...base, beats: true, active: { ...base.active, result: '45' } }).includes('>Clean (no card)<'), 'over a result it takes the card down');
  const box = new MiniEl('div'); const ls = {}; box.addEventListener = (t, fn) => { ls[t] = fn; };
  const got = { draft: [], sent: [] }; const ctl = { costDraft: (v) => got.draft.push(v), sendCost: (v) => { got.sent.push(v); return Promise.resolve(true); } };
  R.costBind(box, () => ctl); R.costBind(box, () => ctl);
  const field = new MiniEl('textarea'); field.setAttribute('data-gm', 'stamp-cost'); field.value = 'Lotte remembers';
  ls.input({ target: field }); let prevented = 0;
  ls.keydown({ target: field, key: 'Enter', preventDefault: () => { prevented++; } }); ls.keydown({ target: field, key: 'Enter', shiftKey: true, preventDefault: () => {} });
  ls.keydown({ target: field, key: 'a' });
  assert.deepEqual(got, { draft: ['Lotte remembers'], sent: ['Lotte remembers'] }); assert.equal(prevented, 1);
});

/* ---------- the iPad ---------- */
globalThis.self = globalThis;
const intervals = []; const realSI = globalThis.setInterval, realCI = globalThis.clearInterval;
globalThis.setInterval = (fn, ms) => { intervals.push({ fn, ms, on: true }); return intervals.length; };
globalThis.clearInterval = (h) => { if (intervals[h - 1]) intervals[h - 1].on = false; };
let kitReady = true;
globalThis.B68Kit = { ready: (n) => n === 'stage' && kitReady };
globalThis.B68Ui = require(path.join(ROOT, 'app', 'ui', 'ui.js'));
globalThis.B68Stage = require(path.join(ROOT, 'app', 'display', 'kit', 'stage.js'));
const K = require(path.join(ROOT, 'app', 'display', 'kit', 'roll.js'));
globalThis.B68StageRoll = K;
const S = require(path.join(ROOT, 'app', 'display', 'shows.js'));
require(path.join(ROOT, 'app', 'display', 'report-beat.js'));
const doc = { createElement: (t) => { const e = new MiniEl(t); e.style = { setProperty() {} }; return e; }, createTextNode: (s) => new MiniText(s), createElementNS: (ns, t) => doc.createElement(t) };
const textOf = (n) => (n.nodeType === 3 ? n.data : n.children.map(textOf).join(''));
function frame() { const slot = doc.createElement('div'); return { slot: (n) => (n === 'roll' ? slot : null), el: slot }; }
const P = { position: 'risky', effect: 'standard', text: LINE, who: 'Ray' };

await test('the words: plain words only, no numbers anywhere the iPad shows; Clean, 4/5 and 1-3 say what the brief says', () => {
  assert.deepEqual(K.SLAM, { clean: 'You do it.', '45': 'You do it. It costs.', '13': 'It goes wrong.' });
  for (const p of [P, { ...P, result: 'clean' }, { ...P, result: '45' }, { ...P, result: '13' }, { ...P, result: '45', cost: 'Lotte remembers your face.' }, { position: 'desperate', effect: 'great' }]) {
    const w = K.Pure.words(p);
    assert.ok(!/\d/.test([w.kicker, w.title, w.line, w.side, w.eff, w.slam].join(' ')), 'no number: ' + JSON.stringify(w));
  }
  assert.equal(K.Pure.words(P).kicker, 'Ray goes for it'); assert.equal(K.Pure.words({ position: 'risky', effect: 'standard' }).kicker, 'The roll');
  assert.equal(K.Pure.words(P).title, 'If it goes wrong: ' + LINE); assert.equal(K.Pure.words(P).side, 'Risky'); assert.equal(K.Pure.words(P).eff, 'Standard');
  assert.equal(K.Pure.beat({ ...P, result: 'clean', cost: 'x' }), 'result', 'a clean roll has no cost beat');
  assert.equal(K.chipText({ who: 'Ray', result: '45' }), 'Last roll · Ray · It costs'); assert.equal(K.chipText({ result: 'clean' }), 'Last roll · You do it');
});

await test('the beats draw through the report register while the setting is on: stakes, result (timed, a slam, the chip set), cost; text only', async () => {
  K.reset(); writes.length = 0; const F = frame();
  const env = (ms, age) => ({ document: doc, reduced: false, stage: F, ms, age });
  const st = await S.mount({ kind: 'report', payload: { ...P, junk: 'GM-ONLY-STRAY' } }, env(180000, 0));
  assert.equal(st.getAttribute('data-ks15-beat'), 'stakes'); assert.ok(st.classList.contains('dp-show-report') && st.getAttribute('data-show') === 'report', 'the old hooks stay');
  const t1 = textOf(st); assert.ok(/Ray goes for it/.test(t1) && t1.includes('If it goes wrong: ' + LINE) && /Risky/.test(t1) && /Standard/.test(t1), t1);
  assert.ok(!t1.includes('GM-ONLY')); assert.equal(st.querySelector('.ks15-slam'), null); assert.equal(F.el.children.length, 0, 'no chip from the stakes');
  const rs = await S.mount({ kind: 'report', payload: { ...P, result: '45' } }, env(8000, 1000));
  assert.equal(rs.getAttribute('data-ks15-beat'), 'result'); assert.ok(textOf(rs.querySelector('.ks15-slam')).includes('You do it. It costs.'));
  assert.ok(rs.querySelector('.stage-plate').hasAttribute('data-stage-timed'), 'the result shows its timer'); assert.equal(textOf(rs.querySelector('.stage-plate-timer')).trim(), '0:07');
  assert.equal(textOf(F.el).trim(), 'Last roll · Ray · It costs', 'the chip is set'); assert.deepEqual(K.last(), { who: 'Ray', result: '45', cost: '' });
  const co = await S.mount({ kind: 'report', payload: { ...P, result: '45', cost: '<i>Lotte remembers your face.</i>' } }, env(10000, 0));
  assert.equal(co.getAttribute('data-ks15-beat'), 'cost'); assert.ok(co.querySelector('.ks15-slam').hasAttribute('data-ks15-still'), 'no second slam');
  assert.ok(textOf(co).includes('<i>Lotte remembers your face.</i>'), 'markup stays text'); assert.ok(/It costs/.test(textOf(co.querySelector('.stage-plate-kicker'))));
  assert.equal(F.el.querySelectorAll('.ks15-chip').length, 1, 'one chip, replaced'); assert.deepEqual(writes, [], 'nothing written as HTML');
  const one = await S.mount({ kind: 'report', payload: { ...P, result: '13' } }, env(8000, 0));
  assert.ok(textOf(one).includes('It goes wrong.') && textOf(one).includes(LINE)); assert.ok(one.querySelector('.ks15-slam').classList.contains('ui-edge-out-low'));
});

await test('the plate\'s timer runs out: the beat folds on the iPad (hidden) and the chip stays', async () => {
  const F = frame(); intervals.length = 0;
  const realNow = Date.now; let t = realNow();
  Date.now = () => t;
  try {
    const n = await S.mount({ kind: 'report', payload: { ...P, result: 'clean' } }, { document: doc, stage: F, ms: 8000, age: 0 });
    t += 9000; intervals.filter((i) => i.on).forEach((i) => i.fn());
    assert.equal(n.hidden, true); assert.ok(n.hasAttribute('data-ks15-folded')); assert.equal(textOf(F.el).trim(), 'Last roll · Ray · You do it');
    assert.equal(intervals.filter((i) => i.on).length, 0, 'no timer left running on the idle stage');
  } finally { Date.now = realNow; }
});

await test('the chip is the display\'s memory only: a reload (a fresh module) starts with none, and drawing with no frame is no error', async () => {
  delete require.cache[require.resolve(path.join(ROOT, 'app', 'display', 'kit', 'roll.js'))];
  const fresh = require(path.join(ROOT, 'app', 'display', 'kit', 'roll.js'));
  assert.notEqual(fresh, K); assert.equal(fresh.last(), null, 'nothing carried over'); assert.equal(fresh.putChip(frame(), doc), null);
  assert.ok(fresh.render({ ...P, result: '13' }, { document: doc }), 'no frame: drawn, no error'); assert.equal(fresh.putChip(null, doc), null);
});

await test('setting off (or this bundle not in): the report draws the old card, the new fields ignored', async () => {
  kitReady = false;
  try {
    const n = await S.mount({ kind: 'report', payload: { ...P, result: '45', cost: 'Lotte remembers your face.' } }, { document: doc });
    assert.equal(n.getAttribute('data-ks15-beat'), null); assert.ok(n.classList.contains('dp-show-report'));
    assert.ok(!textOf(n).includes('Lotte') && !textOf(n).includes('It costs'), 'the old card shows the stakes only');
  } finally { kitReady = true; }
  assert.equal(K.on(), true);
});

globalThis.setInterval = realSI; globalThis.clearInterval = realCI;
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
