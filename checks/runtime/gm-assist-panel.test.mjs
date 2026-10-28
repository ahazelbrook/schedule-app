// Unit test for the GM page's Claude box (app/gm/assist-panel.js; "Claude at the table", Phase 1 UI): the pure helpers (error kinds,
// the five lines, folding a tick answer in with the `after` cursor and de-duplication) and the box itself on a small fake DOM with a
// FAKE gm api: no network, no key, no real call. Also the wiring in gm-page.js (key A, mounted on ready, destroyed on close) and the
// static promises: GM bundle only, nothing stored, no call but stt / assistTick / assistFit. Every sentence below is invented.
//   node checks/runtime/gm-assist-panel.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { MiniEl, MiniText, writes as htmlWrites } from './minidom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const A = require(path.join(ROOT, 'app', 'gm', 'assist-panel.js'));
const GP = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const P = A._pure;
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const tick = () => new Promise((r) => setImmediate(r));

// ---------- a small fake DOM: elements are looked up by selector and remember what the box wrote to them ----------
function fakeBrowser({ phone = false } = {}) {
  const els = {};
  let made = 0;
  const stub = (sel) => els[sel] || (els[sel] = Object.assign(new MiniEl('div', (e) => { doc.activeElement = e; }), { sel }));
  const listeners = {}, docListeners = {};
  const host = {
    className: '', innerHTML: '', parentNode: null, listeners,
    setAttribute() {}, addEventListener(t, f) { listeners[t] = f; }, contains() { return true; },
    querySelector(sel) { return sel === 'input[name="as-pos"]:checked' ? (host.pos === undefined ? null : { value: host.pos }) : stub(sel); },
    // '#as-list [data-as="fold"]': look inside the stub the box draws the list in
    querySelectorAll(sel) { const m = /^(#[w-]+)s+(.*)$/.exec(sel); return m ? stub(m[1]).querySelectorAll(m[2]) : []; },
  };
  host.pos = 'risky';
  const doc = {
    hidden: false, activeElement: null,
    // the first element made is the panel's own host; everything after it is a real (mini) node the renderer builds
    createElement(tag) { return made++ === 0 ? host : new MiniEl(tag, (e) => { doc.activeElement = e; }); }, createTextNode(t) { return new MiniText(t); },
    body: { appendChild(e) { e.parentNode = doc.body; doc.appended = e; }, removeChild(e) { e.parentNode = null; doc.removed = e; } },
    addEventListener(t, f) { docListeners[t] = f; }, removeEventListener(t) { delete docListeners[t]; },
  };
  const win = { matchMedia: () => ({ matches: phone }) };
  const click = (a, id, dk, act) => listeners.click({ target: { closest: () => ({ getAttribute: (k) => (k === 'data-as' ? a : k === 'data-id' ? id : k === 'data-act' ? (act === undefined ? null : act) : k === 'data-k' && dk !== undefined ? dk : null) }) } });
  return { doc, win, host, stub, click, listeners, docListeners };
}
const GOOD = { cards: [], updates: [], flags: [], spend: { tonight: 1.234, cap: 20, tier: 'all', tick: 0.01 }, last: 10 };
function rig(over = {}, brOpts) {
  const br = fakeBrowser(brOpts), calls = { stt: 0, rolled: [], tick: [], tickArgs: [], another: [], fit: [], cards: 0, marks: [] };
  const timers = [];
  const gm = {
    stt: async () => { calls.stt++; return { doc: { want: gm.want } }; }, want: 'on',
    assistTick: async (after, npc, rolled) => { calls.rolled.push(rolled === true); calls.tick.push(after); calls.tickArgs.push(npc === undefined ? [after] : [after, npc]); if (gm.tickErr) throw gm.tickErr; return gm.reply || GOOD; },
    assistAnother: async (req) => { calls.another.push(req); if (gm.anotherErr) throw gm.anotherErr; return gm.anotherReply; },
    assistFit: async (req) => { calls.fit.push(req); if (gm.fitErr) throw gm.fitErr; return gm.fitReply; },
    assistCards: async () => { calls.cards++; if (gm.cardsErr) throw gm.cardsErr; return gm.stored || { cards: [], updates: [] }; },
    assistMark: async (req) => { calls.marks.push(req); if (gm.markErr) throw gm.markErr; return { marked: req.items.length }; },
  };
  // anything else on the api (state, display, ambient, transcript...) fails the test: the box has no business there
  const api = new Proxy(gm, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' && !['then', 'toJSON'].includes(k) ? () => { throw new Error('the box called gm.' + k); } : undefined)) });
  const notes = [];
  gm.stored = over.stored; gm.cardsErr = over.cardsErr; delete over.stored; delete over.cardsErr;
  const ctl = A.create({ gm: api, doc: br.doc, win: br.win, noTimer: true, onNote: (t) => { notes.push(t); return true; }, setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout() {}, ...over });
  return { br, gm, calls, ctl, notes, timers };
}
const err = (status, message, extra) => Object.assign(new Error(message || 'x'), { status }, extra || {});

// ---------- pure ----------
await test('errKind: a 429 is cap or busy (it stops the polling), 503 setup, network, bad input', () => {
  assert.equal(P.errKind(err(429, "tonight's cap is reached")), 'cap');
  assert.equal(P.errKind(err(429, 'the fixer is busy')), 'busy');
  assert.equal(P.errKind(err(429)), 'busy');
  assert.equal(P.errKind(err(503, 'assist is not set up (no API key)')), 'setup');
  assert.equal(P.errKind(err(400)), 'bad');
  assert.equal(P.errKind(err(undefined, 'offline', { network: true })), 'net');
  assert.equal(P.errKind(err(500, '{"error":"boom"}')), 'other');
  for (const k of ['cap', 'busy', 'setup', 'net', 'bad', 'other']) assert.ok(P.errLine(k) && !/[{}]/.test(P.errLine(k)), k + ' has a plain sentence');
});

await test('fitLines: the five lines in the order they are read; an empty one is left out', () => {
  const c = { read: 'r', one_three: 'a', four_five: 'b', six: 'c', crit: 'd', bargain: 'e' };
  assert.deepEqual(P.fitLines(c).map((l) => l.label), ['1–3', '4–5', '6', 'Crit', 'Bargain']);
  assert.deepEqual(P.fitLines(c).map((l) => l.text), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(P.fitLines({ ...c, crit: '  ' }).length, 4);
  assert.deepEqual(P.fitLines(null), []);
});

await test('absorb: cards and updates in, repeats dropped, the cursor and spend kept, junk ignored', () => {
  const st = { cards: [], updates: [], after: null, spend: null };
  const res = { cards: [{ seat: 'ref', at: '2026-01-01T10:00:00Z', text: 'A slip.', detail: { said_at: '22:14', rule: 'p. 1' } }, { seat: 'ref', text: '' }, null],
    updates: [{ seat: 'ledger', at: '2026-01-01T10:00:00Z', key: 'stress', text: 'Two stress.' }], spend: { tonight: 2, cap: 20, tier: 'reduced' }, last: 41 };
  assert.equal(P.absorb(st, res, 'now').length, 1);
  assert.equal(P.absorb(st, res, 'now').length, 0, 'the same card twice is one');
  assert.equal(st.cards.length, 1); assert.equal(st.updates.length, 1); assert.equal(st.after, 41); assert.equal(st.spend.tier, 'reduced');
  P.absorb(st, { cards: 'x', updates: 7, last: -1 }, 'now');
  assert.equal(st.after, 41, 'a bad cursor does not replace the good one');
});

// ---------- the box ----------
await test('polling: only while Listening is on; the first tick has no cursor, the next carries the last answer', async () => {
  const r = rig();
  r.gm.want = 'off'; await r.ctl.poll();
  assert.equal(r.calls.tick.length, 0, 'Listening off: no tick');
  assert.equal(r.ctl.state().listening, false);
  assert.match(r.br.stub('#as-status').innerHTML, /Listening is off/);
  r.gm.want = 'on'; await r.ctl.poll();
  assert.deepEqual(r.calls.tick, [null], 'first tick: no cursor');
  await r.ctl.poll();
  assert.deepEqual(r.calls.tick, [null, 10], 'then the `last` of the answer before');
  assert.match(r.br.stub('#as-status').innerHTML, /Last checked/);
});

await test('polling: not while the page is hidden, and not on a phone', async () => {
  const r = rig(); r.br.doc.hidden = true; await r.ctl.poll();
  assert.equal(r.calls.stt + r.calls.tick.length, 0, 'hidden: nothing is even asked');
  r.br.doc.hidden = false; await r.ctl.poll(); assert.equal(r.calls.tick.length, 1);
  const p = rig({}, { phone: true }); await p.ctl.poll();
  assert.equal(p.calls.stt + p.calls.tick.length, 0, 'phone: no polling');
  r.br.docListeners.visibilitychange && await r.br.docListeners.visibilitychange();   // coming back to the tab polls at once
});

await test('a card: the count, the strip (8 s, click opens) for a rule, its cite, then Got it removes it', async () => {
  const r = rig();
  r.gm.reply = { ...GOOD, cards: [{ seat: 'ref', kind: 'rule', at: '2026-01-01T00:10:00Z', text: 'No harm penalty inside a score <b>', headline: 'Headline, not text: resist the harm', bullets: ['Said at 22:14 <b>'], cite: 'p. 152', detail: { said_at: '22:14', rule: 'p. 152' } }] };
  await r.ctl.poll();
  assert.equal(r.ctl.state().unread, 1);
  assert.equal(r.br.stub('#as-count').textContent, '1'); assert.equal(r.br.stub('#as-count').hidden, false);
  assert.equal(r.br.stub('#as-banner').hidden, false, 'the banner is up');
  assert.match(r.br.stub('.as-banner-b').textContent, /Rule.*Headline, not text: resist the harm/, 'the strip says the kind and the headline');
  assert.ok(!/No harm penalty/.test(r.br.stub('.as-banner-b').textContent), 'not the card text');
  assert.ok(r.timers.some((t) => t.ms === 8000), 'it dismisses itself after 8 s');
  assert.match(r.br.stub('#as-list').innerHTML, /Headline, not text/, 'the renderer reads the headline');
  assert.match(r.br.stub('#as-list').innerHTML, /p\. 152/, 'the page cite shows');
  assert.ok(!/<b>/.test(r.br.stub('#as-list').innerHTML.replace(/<b>[^<]*<\/b>/g, '')), 'card text is escaped');
  assert.match(r.br.stub('#as-list').innerHTML, /&lt;b&gt;/);
  r.timers.find((t) => t.ms === 8000).f(); assert.equal(r.br.stub('#as-banner').hidden, true);
  r.gm.reply = { ...GOOD, cards: [{ seat: 'clerk', at: '2026-01-01T00:20:00Z', text: 'A new name came up.' }] }; await r.ctl.poll();
  assert.equal(r.br.stub('#as-banner').hidden, true, 'a note is a pip, never a strip'); assert.equal(r.ctl.state().unread, 2);
  r.br.click('toggle'); assert.equal(r.ctl.state().open, true, 'a click on the tab opens the box');
  assert.equal(r.ctl.state().unread, 1, 'the older card is read at once; the newest is Now and is read after 1.5 s'); r.timers.filter((x) => x.ms === 1500).pop().f();
  assert.equal(r.ctl.state().unread, 0); assert.equal(r.br.stub('#as-count').hidden, true);
  assert.equal(r.br.stub('#as-banner').hidden, true);
  const id = r.ctl.state().cards[0].id; r.br.click('ack', id);
  assert.equal(r.ctl.state().cards.length, 1, 'Got it dismisses that card only');
  assert.ok(!/Headline, not text/.test(r.br.stub('#as-list').innerHTML), 'and its node leaves the list');
});

await test('no strip while the box is open; a card that arrives then is Now, and is read after 1.5 s, not before', async () => {
  const r = rig(); r.ctl.open();
  r.gm.reply = { ...GOOD, cards: [{ seat: 'ref', at: 'a', text: 'Slip.' }] }; await r.ctl.poll();
  assert.equal(r.br.stub('#as-banner').hidden !== false, true);
  assert.equal(r.ctl.state().nowId, r.ctl.state().cards[0].id, 'it is Now');
  assert.equal(r.ctl.state().unread, 1); assert.equal(r.calls.marks.length, 0, 'no seen mark has gone out before the timer');
  r.timers.filter((x) => x.ms === 1500).pop().f(); await tick();
  assert.equal(r.ctl.state().unread, 0); assert.equal(r.calls.marks.length, 1); assert.equal(r.calls.marks[0].op, 'seen');
});

await test('the spend tier badge shows the tier and the dollars; tier off stops the polling', async () => {
  const r = rig(); await r.ctl.poll();
  assert.match(r.br.stub('#as-tier').textContent, /Full · \$1\.23 of \$20/);
  r.gm.reply = { ...GOOD, spend: { tonight: 20, cap: 20, tier: 'off' } }; await r.ctl.poll();
  assert.equal(r.ctl.state().paused, 'cap');
  assert.match(r.br.stub('#as-tier').textContent, /Off: cap reached/);
  const n = r.calls.tick.length; await r.ctl.poll(); assert.equal(r.calls.tick.length, n, 'no more ticks while paused');
});

await test('a 429 stops the polling with a clear state; Check again resumes; no raw JSON is ever shown', async () => {
  const r = rig(); r.gm.tickErr = err(429, "tonight's cap is reached", { body: '{"error":"x"}' }); await r.ctl.poll();
  assert.equal(r.ctl.state().paused, 'cap');
  assert.match(r.br.stub('#as-status').innerHTML, /Cap reached for tonight/); assert.match(r.br.stub('#as-status').innerHTML, /Check again/);
  await r.ctl.poll(); assert.equal(r.calls.tick.length, 1, 'paused: one call, not a retry loop');
  r.gm.tickErr = null; r.br.click('resume'); await tick(); await tick();
  assert.equal(r.ctl.state().paused, ''); assert.equal(r.calls.tick.length, 2);
  r.gm.tickErr = err(429, 'busy'); await r.ctl.poll(); assert.equal(r.ctl.state().paused, 'busy');
  assert.match(r.br.stub('#as-status').innerHTML, /busy/i);
  const r2 = rig(); r2.gm.tickErr = err(500, '{"error":"provider status 500"}'); await r2.ctl.poll();
  assert.ok(!/[{}"]/.test(r2.br.stub('#as-status').innerHTML.replace(/<[^>]*>/g, '')), 'a server error is a sentence, not JSON');
  assert.equal(r2.ctl.state().paused, '', 'a plain failure retries next minute');
});

await test('Ledger updates are read-only: Note it files the text through the page, Done dismisses; nothing else is written', async () => {
  const r = rig();
  r.gm.reply = { ...GOOD, updates: [{ seat: 'ledger', at: 'a', key: 'stress', text: 'Two stress to a crew member.' }] }; await r.ctl.poll();
  assert.match(r.br.stub('#as-updates').innerHTML, /Two stress/); assert.match(r.br.stub('#as-updates').innerHTML, /Note it/);
  assert.equal(r.ctl.state().unread, 0, 'updates are not cards: no count for them');
  r.br.click('note', r.ctl.state().updates[0].id);
  assert.deepEqual(r.notes, ['Two stress to a crew member.']); assert.equal(r.ctl.state().updates.length, 0);
  r.gm.reply = { ...GOOD, updates: [{ seat: 'ledger', at: 'b', key: 'xp', text: 'xp: desperate roll.' }] }; await r.ctl.poll();
  r.br.click('done', r.ctl.state().updates[0].id); assert.equal(r.ctl.state().updates.length, 0); assert.equal(r.notes.length, 1);
  const q = rig({ onNote: undefined }); q.gm.reply = { ...GOOD, updates: [{ seat: 'ledger', at: 'a', text: 'x' }] }; await q.ctl.poll();
  assert.ok(!/Note it/.test(q.br.stub('#as-updates').innerHTML), 'without the page\'s capture there is no Note it');
});

await test('Fit it: sends position and effect, shows the five lines; a 429 and a 400 are sentences', async () => {
  const r = rig();
  r.gm.fitReply = { cards: [{ seat: 'fixer', at: 'a', text: 'Crew on the roof, risky', read: 'Crew on the roof, risky', one_three: 'Slip.', four_five: 'A cost.', six: 'Clean.', crit: 'Better.', bargain: 'A debt.' }], spend: { tonight: 3, cap: 20, tier: 'all' } };
  r.br.stub('#as-eff').value = 'standard';
  r.br.host.pos = 'desperate';
  await r.br.listeners.submit({ target: { getAttribute: () => 'fit' }, preventDefault() {} }); await tick();
  assert.deepEqual(r.calls.fit, [{ position: 'desperate', effect: 'standard' }]);
  const h = r.br.stub('#as-fitout').innerHTML;
  for (const w of ['1–3', '4–5', 'Crit', 'Bargain', 'Slip.', 'A debt.']) assert.ok(h.includes(w), 'shows ' + w);
  assert.equal(r.ctl.state().cards.length, 0, 'a fit is shown in its own place, not as a card');
  assert.match(r.br.stub('#as-tier').textContent, /\$3\.00/);
  r.br.click('fitclear'); assert.equal(r.br.stub('#as-fitout').innerHTML, '');
  r.gm.fitErr = err(429, 'the fixer is busy'); await r.ctl.fit('risky', ''); assert.match(r.br.stub('#as-fitout').innerHTML, /busy/);
  assert.deepEqual(r.calls.fit[1], { position: 'risky' }, 'no effect, no field');
  r.gm.fitErr = err(429, "tonight's cap is reached"); await r.ctl.fit('risky', ''); assert.match(r.br.stub('#as-fitout').innerHTML, /Cap reached/); assert.equal(r.ctl.state().paused, 'cap');
  r.gm.fitErr = err(400, 'position is required'); await r.ctl.fit('risky', ''); assert.ok(!/position is required/.test(r.br.stub('#as-fitout').innerHTML));
  assert.equal(await r.ctl.fit('  ', ''), undefined, 'an empty position sends nothing'); assert.equal(r.calls.fit.length, 4);
});

await test('open and close: key A (toggle), the Close button, Escape (not while typing); focus goes back to the launcher', () => {
  const r = rig(); r.ctl.toggle(); assert.equal(r.ctl.state().open, true); assert.equal(r.br.stub('#as-panel').hidden, false);
  assert.equal(r.br.stub('#as-launch').attrs['aria-expanded'], 'true');
  r.ctl.toggle(); assert.equal(r.ctl.state().open, false); assert.equal(r.br.stub('#as-panel').hidden, true);
  r.ctl.open(); r.br.click('close'); assert.equal(r.ctl.state().open, false);
  r.ctl.open(); let pd = 0;
  r.br.listeners.keydown({ key: 'Escape', target: { tagName: 'INPUT' }, preventDefault() { pd++; } }); assert.equal(r.ctl.state().open, true, 'Escape in the effect field only leaves the field');
  r.br.listeners.keydown({ key: 'Escape', target: { tagName: 'BUTTON' }, preventDefault() { pd++; } }); assert.equal(r.ctl.state().open, false);
});

await test('destroy: the element goes, the timers and the tab listener go, later answers are ignored', async () => {
  const r = rig(); const p = r.ctl.poll(); r.ctl.destroy(); await p;
  assert.equal(r.br.host.parentNode, null); assert.equal(r.br.docListeners.visibilitychange, undefined);
  assert.equal(r.ctl.el(), null); await r.ctl.poll(); assert.equal(r.calls.tick.length <= 1, true);
});

// ---------- the page, the bundle and the promises ----------
await test('gm-page: key A is the Claude box; no other key changed', () => {
  assert.deepEqual(GP.keyAction({ key: 'a' }), { type: 'assist' });
  assert.deepEqual(GP.keyAction({ key: 'A' }), { type: 'assist' });
  assert.equal(GP.keyAction({ key: 'a', typing: true }), null, 'typing in a field is left alone');
  assert.equal(GP.keyAction({ key: 'a', ctrlKey: true }), null);
  assert.deepEqual(GP.keyAction({ key: 'i' }), { type: 'panel', panel: 'ipad' });
  assert.deepEqual(GP.keyAction({ key: 'n' }), { type: 'panel', panel: 'npc' });
  assert.deepEqual(GP.keyAction({ key: '2' }), { type: 'situation', n: 2 });
});

await test('the box is in the GM bundle only, before gm-page.js, and the avatar is a static SVG', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8');
  const lines = routes.split(String.fromCharCode(10)).filter((l) => l.includes('assist-panel.js'));
  assert.equal(lines.length, 1, 'listed once');
  assert.ok(lines[0].trim().startsWith('gm: [') && lines[0].indexOf('gm/assist-panel.js') < lines[0].indexOf('gm-page.js'), 'in the gm bundle, before gm-page.js');
  const html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
  assert.ok(!html.includes('assist-panel'), 'index.html does not load it');
  const svg = fs.readFileSync(path.join(ROOT, 'app', 'gm', 'blade.svg'), 'utf8');
  assert.ok(/^<svg /.test(svg) && !/<script|onload|href="http/i.test(svg), 'the avatar is plain SVG');
});

await test('GM only and never player-visible: the box touches nothing but stt / assistTick / assistFit, stores nothing, no network of its own', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm', 'assist-panel.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepEqual([...new Set([...src.matchAll(/\bgm\.(\w+)/g)].map((m) => m[1]))].sort(), ['assistAnother', 'assistAsk', 'assistCards', 'assistFit', 'assistGate', 'assistMark', 'assistTick', 'stt']);
  assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|setDisplay|patchState|patchAmbient|patchStt|sendBeacon|eval\(|innerHTML\s*=\s*[^'"(\s]*\bc\.text/.test(src), 'no storage, no network, no display or state write');
  const page = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  const m = /function mountAssist\(\) \{[\s\S]*?\n  \}\n/.exec(page);
  assert.ok(m && /isGM|status === 'ready'|start\(\)/.test(page) && !/pushDisplay|setDisplay/.test(m[0]), 'mountAssist writes nothing to the display');
  assert.ok(/mountAssist\(\);\s*\n\s*layout\(\)/.test(page), 'it is mounted from start(), which only a GM with a pack reaches');
  assert.ok(/me\.assist\.destroy\(\)/.test(page), 'close() destroys it');
});

await test('the gm adapter has assistTick (POST, cursor only when known) and assistFit', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'runtime', 'cf.js'), 'utf8');
  assert.ok(/assistTick: function \(after, npc, rolled\) \{ var b = \{\}; if \(after !== undefined && after !== null\) b\.after = after; if \(typeof npc === 'string' && npc\) b\.npc = npc; if \(rolled === true\) b\.rolled = true; return api\('POST', '\/gm\/assist\/tick'/.test(src), 'the tick carries the cursor and the on-stage name only when there are some, and rolled only when it is exactly true');
  assert.ok(/assistAnother: function \(req\) \{ return api\('POST', '\/gm\/assist\/another'/.test(src));
  assert.ok(/assistFit: function \(req\) \{ return api\('POST', '\/gm\/assist\/fit'/.test(src));
  assert.ok(/assistCards: function \(\) \{ return api\('GET', '\/gm\/assist\/cards'\)/.test(src));
  assert.ok(/assistMark: function \(req\) \{ return api\('POST', '\/gm\/assist\/cards'/.test(src));
  assert.ok(/assistAsk: function \(req\) \{ return api\('POST', '\/gm\/assist\/ask', req \|\| \{\}, 120000\)/.test(src), 'Ask Blade waits up to 120 s for Opus');
});

// ---------- memory: a reload restores the chat; Keep files a Moment; high-importance cards say where they are saved ----------
const REF = { seat: 'ref', at: '2026-01-01T00:10:00Z', text: 'A slip, made up.', detail: { said_at: '22:14', rule: 'p. 12' } };
await test('reload: tonight\'s cards come back with their read marks; unread count and no banner; dismissed ones never return', async () => {
  const r = rig({ stored: { cards: [{ ...REF, seen: false }, { seat: 'clerk', at: '2026-01-01T00:20:00Z', text: 'A name, made up.', seen: true }, { seat: 'clerk', at: '2026-01-01T00:21:00Z', text: 'gone', dismissed: true }],
    updates: [{ seat: 'ledger', at: '2026-01-01T00:20:00Z', key: 'k', text: 'Two stress, made up.' }] } });
  await r.ctl.ready;
  const s = r.ctl.state();
  assert.deepEqual(s.cards.map((c) => c.seat), ['ref', 'clerk']); assert.equal(s.unread, 1, 'one was read already');
  assert.equal(r.br.stub('#as-count').textContent, '1'); assert.equal(s.updates.length, 1);
  assert.equal(s.banner, '', 'a restored card pops no banner');
  assert.match(r.br.stub('#as-list').innerHTML, /A slip, made up/);
  // the same card arriving by tick is the same card
  r.gm.reply = { ...GOOD, cards: [REF] }; await r.ctl.poll();
  assert.equal(r.ctl.state().cards.length, 2, 'not doubled');
  assert.equal(r.calls.marks.length, 0, 'restoring marks nothing');
  r.ctl.open(); await tick();
  assert.deepEqual(r.calls.marks, [], 'opening marks nothing yet: the card is Now');
  r.timers.filter((x) => x.ms === 1500).pop().f(); await tick();
  assert.deepEqual(r.calls.marks, [{ op: 'seen', items: [{ at: REF.at, text: REF.text }] }], 'after 1.5 s in view it is read, on the server');
  assert.equal(r.ctl.state().unread, 0);
});

await test('reload: if the log cannot be read the box starts empty as before; no assistCards on the api is fine', async () => {
  const r = rig({ cardsErr: err(500, 'x') }); await r.ctl.ready;
  assert.equal(r.ctl.state().cards.length, 0); assert.equal(r.calls.cards, 1);
  const e = r.ctl.state(); assert.equal(e.error, '');
  const bare = A.create({ gm: { stt: async () => ({}), assistTick: async () => GOOD, assistFit: async () => ({}) }, doc: fakeBrowser().doc, win: fakeBrowser().win, noTimer: true });
  await bare.ready; assert.equal(bare.state().cards.length, 0);
});

await test('Got it, Done and Note it mark the server (dismiss); a failed mark changes nothing on screen', async () => {
  const r = rig();
  r.gm.reply = { ...GOOD, cards: [REF], updates: [{ seat: 'ledger', at: 'a', key: 'k', text: 'U one.' }, { seat: 'ledger', at: 'a', key: 'j', text: 'U two.' }] }; await r.ctl.poll();
  r.gm.markErr = err(500, 'x');
  const st = r.ctl.state();
  r.br.click('ack', st.cards[0].id); await tick();
  assert.deepEqual(r.calls.marks[0], { op: 'dismiss', items: [{ at: REF.at, text: REF.text }] });
  assert.equal(r.ctl.state().cards.length, 0, 'gone from the screen even though the mark failed');
  r.br.click('done', st.updates[0].id); await tick();
  assert.deepEqual(r.calls.marks[1], { op: 'dismiss', items: [{ at: 'a', text: 'U one.', key: 'k' }] });
  r.br.click('note', st.updates[1].id); await tick();
  assert.deepEqual(r.calls.marks[2], { op: 'dismiss', items: [{ at: 'a', text: 'U two.', key: 'j' }] });
  assert.deepEqual(r.notes, ['U two.']);
});

await test('Keep (star): files the card as a Moment through the page\'s capture, marks it kept once, and shows Kept; no capture, no Keep', async () => {
  const r = rig();
  r.gm.reply = { ...GOOD, cards: [REF] }; await r.ctl.poll();
  assert.match(r.br.stub('#as-list').innerHTML, /data-as="keep"/);
  r.br.click('keep', r.ctl.state().cards[0].id); await tick();
  assert.equal(r.notes.length, 1); assert.match(r.notes[0], /^Blade, rule slip \(\d\d:\d\d\): A slip, made up\. \[said 22:14; p\. 12\]$/);
  assert.deepEqual(r.calls.marks, [{ op: 'keep', items: [{ at: REF.at, text: REF.text }] }]);
  assert.equal(r.ctl.state().cards[0].kept, true);
  assert.match(r.br.stub('#as-list').innerHTML, /Kept/); assert.ok(!/data-as="keep"/.test(r.br.stub('#as-list').innerHTML));
  r.br.click('keep', r.ctl.state().cards[0].id); await tick();
  assert.equal(r.notes.length, 1, 'a kept card is not filed twice'); assert.equal(r.calls.marks.length, 1);
  const f = rig({ onNote: () => false }); f.gm.reply = { ...GOOD, cards: [REF] }; await f.ctl.poll();
  f.br.click('keep', f.ctl.state().cards[0].id); await tick();
  assert.equal(f.ctl.state().cards[0].kept, false, 'the capture refused: not kept'); assert.equal(f.calls.marks.length, 0);
  const q = rig({ onNote: undefined }); q.gm.reply = { ...GOOD, cards: [REF] }; await q.ctl.poll();
  assert.ok(!/data-as="keep"/.test(q.br.stub('#as-list').innerHTML));
});

await test('a Ref slip says it is in the log, and "saved to campaign history" once gm:after has filed it; a Clerk note says neither', async () => {
  const r = rig({ stored: { cards: [{ ...REF, filed: false }, { seat: 'clerk', at: '2026-01-01T00:20:00Z', text: 'A name.' }] } }); await r.ctl.ready;
  let h = r.br.stub('#as-list').innerHTML;
  assert.equal((h.match(/In tonight’s log/g) || []).length, 1, 'only the Ref slip'); assert.ok(!/Saved to campaign history/.test(h));
  const f = rig({ stored: { cards: [{ ...REF, filed: true }] } }); await f.ctl.ready;
  assert.match(f.br.stub('#as-list').innerHTML, /Saved to campaign history/);
  assert.equal(P.momentText({ seat: 'clerk', at: 'bad', text: ' x ', detail: null }), 'Blade, clerk (): x');
});

// ---------- WP2: the console's own fit (autoFit) and the form's draws ----------
const DRAWS2 = { low: 'A 1-3: the way in is shut.', mid: 'A 4/5: a second watcher arrives.' };
const FITOK = { cards: [{ seat: 'fixer', at: 'a', text: 'r', read: 'r', one_three: 'Slip.', four_five: 'A cost.', six: 'Clean.', crit: 'More.', bargain: 'Deal.' }], flags: [], spend: { tonight: 0.4, cap: 20, tier: 'all', tick: 0.4 } };

await test('autoFit: asks Listening first, then makes the call with the draws; the card comes back and onStart fires just before the call', async () => {
  const r = rig(); r.gm.fitReply = FITOK;
  const order = [];
  const p = r.ctl.autoFit({ position: 'risky', draws: DRAWS2 }, () => order.push('start'));
  const out = await p;
  assert.equal(r.calls.stt, 1);
  assert.deepEqual(r.calls.fit, [{ position: 'risky', draws: DRAWS2 }]);
  assert.deepEqual(order, ['start']);
  assert.equal(out.card.one_three, 'Slip.');
  assert.equal(r.ctl.state().spend.tonight, 0.4, 'the spend is folded in');
});

await test('autoFit: no call at all with Listening off, with the cap reached, on a phone, or without draws', async () => {
  let r = rig(); r.gm.want = 'off'; r.gm.fitReply = FITOK;
  assert.equal(await r.ctl.autoFit({ position: 'risky', draws: DRAWS2 }), null); assert.equal(r.calls.fit.length, 0);
  r = rig({}, { phone: true }); r.gm.fitReply = FITOK;
  assert.equal(r.ctl.canFit(), false); assert.equal(await r.ctl.autoFit({ position: 'risky', draws: DRAWS2 }), null); assert.equal(r.calls.fit.length, 0);
  r = rig(); r.gm.fitReply = FITOK;
  assert.equal(await r.ctl.autoFit({ position: 'risky' }), null, 'no draws, no call'); assert.equal(r.calls.fit.length, 0);
  r = rig(); r.gm.fitReply = { ...FITOK, spend: { tonight: 20, cap: 20, tier: 'off', tick: 0 } };
  await r.ctl.autoFit({ position: 'risky', draws: DRAWS2 });
  assert.equal(r.ctl.canFit(), false, 'tier off: the cap is reached');
  const n = r.calls.fit.length;
  assert.equal(await r.ctl.autoFit({ position: 'risky', draws: DRAWS2 }), null); assert.equal(r.calls.fit.length, n, 'and no further call is made');
  r = rig(); r.gm.fitErr = err(429, "tonight's cap is reached");
  assert.deepEqual(await r.ctl.autoFit({ position: 'risky', draws: DRAWS2 }), { error: 'cap' });
  assert.equal(r.ctl.canFit(), false); assert.equal(r.ctl.state().paused, 'cap');
});

await test('autoFit: a busy answer, a failure and an empty answer come back as errors, never as a card', async () => {
  let r = rig(); r.gm.fitErr = err(429, 'the fixer is busy');
  assert.deepEqual(await r.ctl.autoFit({ position: 'risky', draws: DRAWS2 }), { error: 'busy' });
  assert.equal(r.ctl.canFit(), true, 'busy is a 10 s cooldown, not a pause');
  r = rig(); r.gm.fitErr = err(500, 'x'); assert.deepEqual(await r.ctl.autoFit({ position: 'risky', draws: DRAWS2 }), { error: 'other' });
  r = rig(); r.gm.fitReply = { cards: [], spend: { tonight: 0, cap: 20, tier: 'all', tick: 0 } }; assert.deepEqual(await r.ctl.autoFit({ position: 'risky', draws: DRAWS2 }), { error: 'none' });
});

await test('Fit it (the form) sends the console\'s draws when the page supplies them, and none when it does not', async () => {
  let r = rig({ draws: (pos) => (pos === 'risky' ? DRAWS2 : null) }); r.gm.fitReply = FITOK;
  await r.ctl.fit('risky', 'limited');
  assert.deepEqual(r.calls.fit[0], { position: 'risky', effect: 'limited', draws: DRAWS2 });
  await r.ctl.fit('desperate', '');
  assert.deepEqual(r.calls.fit[1], { position: 'desperate' });
});


// ---------- WP3: Voice (the NPC on stage) and Another ----------
const VOICE = { who: 'Mrs Test', want: 'to be paid', lines: ['Pay up, dear.', 'I could forget I saw you.'], at: '2030-01-01T09:30:00.000Z' };
await test('Voice: the tick carries the on-stage name only when there is one; the lines reach the page, not the box', async () => {
  const got = [];
  let name = 'Mrs Test';
  const r = rig({ onStage: () => name, onVoice: (v) => got.push(v) }); r.gm.reply = { ...GOOD, voice: VOICE };
  await r.ctl.poll();
  assert.deepEqual(r.calls.tickArgs, [[null, 'Mrs Test']]);
  assert.deepEqual(got, [VOICE]);
  assert.ok(!/Pay up/.test(r.br.stub('#as-list').innerHTML), 'Voice lines are not cards in the box');
  name = ''; r.gm.reply = GOOD;
  await r.ctl.poll();
  assert.deepEqual(r.calls.tickArgs[1], [GOOD.last], 'nobody on stage: the old call shape, no name');
  assert.equal(got[1], null, 'and the page is told to clear the lines');
  name = '  Mrs   Test '; r.gm.reply = GOOD;
  await r.ctl.poll();
  assert.deepEqual(r.calls.tickArgs[2], [GOOD.last, 'Mrs Test'], 'a name is cleaned');
  assert.equal(got.length, 2, 'on stage but Voice silent this time: the lines already shown stay');
});

await test('Voice: nothing with Listening off, on a phone or at the cap, and the lines go when the cap is reached', async () => {
  let got = [];
  let r = rig({ onStage: () => 'Mrs Test', onVoice: (v) => got.push(v) }); r.gm.want = 'off'; r.gm.reply = { ...GOOD, voice: VOICE };
  await r.ctl.poll();
  assert.equal(r.calls.tick.length, 0); assert.deepEqual(got, [null], 'Listening off: no call, and the page clears Voice');
  got = []; r = rig({ onStage: () => 'Mrs Test', onVoice: (v) => got.push(v) }, { phone: true }); r.gm.reply = { ...GOOD, voice: VOICE };
  await r.ctl.poll();
  assert.equal(r.calls.tick.length, 0); assert.equal(r.calls.stt, 0); assert.deepEqual(got, [], 'a phone: nothing runs, nothing is sent');
  got = []; r = rig({ onStage: () => 'Mrs Test', onVoice: (v) => got.push(v) }); r.gm.reply = { ...GOOD, spend: { tonight: 20, cap: 20, tier: 'off', tick: 0 }, voice: VOICE };
  await r.ctl.poll();
  assert.equal(r.ctl.state().paused, 'cap'); assert.equal(got[got.length - 1], null, 'the cap: Voice is cleared');
  got = []; r = rig({ onStage: () => 'Mrs Test', onVoice: (v) => got.push(v) }); r.gm.tickErr = err(429, "tonight's cap is reached");
  await r.ctl.poll();
  assert.deepEqual(got, [null], 'a 429 for the cap clears Voice too');
  got = []; r = rig({ onStage: () => 'Mrs Test', onVoice: (v) => got.push(v) }); r.gm.tickErr = err(429, 'the fixer is busy');
  await r.ctl.poll();
  assert.deepEqual(got, [], 'busy is not the cap: lines stay');
  r = rig(); r.gm.reply = { ...GOOD, voice: VOICE };
  await r.ctl.poll(); assert.equal(r.calls.tick.length, 1, 'a page without onStage / onVoice is unchanged');
  assert.deepEqual(r.calls.tickArgs, [[null]]);
});

await test('Another: asks for one more line with the NPC and what was shown; no call on a phone, at the cap or without lines', async () => {
  let r = rig(); r.gm.anotherReply = { cards: [], voice: { who: 'Mrs Test', lines: ['A new line.'], at: 'x' }, spend: { tonight: 0.5, cap: 20, tier: 'all', tick: 0.01 } };
  assert.equal(r.ctl.canAnother(), true);
  const shown = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'];
  const out = await r.ctl.another({ npc: ' Mrs  Test ', shown });
  assert.deepEqual(r.calls.another, [{ npc: 'Mrs Test', shown: shown.slice(-6) }], 'at most the last six lines, cleaned');
  assert.deepEqual(out.voice.lines, ['A new line.']); assert.equal(r.ctl.state().spend.tonight, 0.5, 'the spend is folded in');
  assert.equal(await r.ctl.another({ npc: '', shown: ['x'] }), null); assert.equal(await r.ctl.another({ npc: 'Mrs Test', shown: [] }), null);
  assert.equal(r.calls.another.length, 1);
  r = rig({}, { phone: true });
  assert.equal(r.ctl.canAnother(), false); assert.equal(await r.ctl.another({ npc: 'Mrs Test', shown: ['x'] }), null); assert.equal(r.calls.another.length, 0);
  r = rig(); r.gm.reply = { ...GOOD, spend: { tonight: 20, cap: 20, tier: 'off', tick: 0 } }; await r.ctl.poll();
  assert.equal(r.ctl.canAnother(), false); assert.equal(await r.ctl.another({ npc: 'Mrs Test', shown: ['x'] }), null); assert.equal(r.calls.another.length, 0, 'capped: no call');
});

await test('Another: busy, the cap, a failure and an empty answer come back as errors; the cap clears Voice and pauses', async () => {
  const got = [];
  let r = rig({ onVoice: (v) => got.push(v) }); r.gm.anotherErr = err(429, 'the voice coach is busy');
  assert.deepEqual(await r.ctl.another({ npc: 'Mrs Test', shown: ['x'] }), { error: 'busy' }); assert.equal(r.ctl.canAnother(), true, 'busy is not a pause');
  r = rig({ onVoice: (v) => got.push(v) }); r.gm.anotherErr = err(429, "tonight's cap is reached");
  assert.deepEqual(await r.ctl.another({ npc: 'Mrs Test', shown: ['x'] }), { error: 'cap' });
  assert.equal(r.ctl.state().paused, 'cap'); assert.equal(r.ctl.canAnother(), false); assert.deepEqual(got, [null]);
  r = rig(); r.gm.anotherErr = err(500, 'x'); assert.deepEqual(await r.ctl.another({ npc: 'Mrs Test', shown: ['x'] }), { error: 'other' });
  r = rig(); r.gm.anotherReply = { cards: [], spend: { tonight: 0, cap: 20, tier: 'all', tick: 0 } }; assert.deepEqual(await r.ctl.another({ npc: 'Mrs Test', shown: ['x'] }), { error: 'none' });
});

await test('gm-page: Voice is wired into the Rack (name, Another, Clear), the tick carries the on-stage name, and the rest of the page is unchanged', () => {
  const page = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  const m = /function mountAssist\(\) \{[\s\S]*?\n  \}\n/.exec(page);
  assert.ok(m && /onStage: function \(\) \{ return S === me \? onStageName\(\) : ''; \}/.test(m[0]) && /onVoice: function \(v\) \{ if \(S === me\) setVoice\(v\); \}/.test(m[0]));
  assert.ok(/case 'another': voiceAnother\(\); break;/.test(page) && /case 'voiceclear'/.test(page));
  const rack = /function renderRack\(\) \{[\s\S]*?\n  \}\n/.exec(page)[0];
  assert.ok(/voiceHtml\(vo\)/.test(rack), 'the Rack draws Voice beside the Fixer');
  const vh = /function voiceHtml\(vo\) \{[\s\S]*?\n  \}\n/.exec(page)[0];
  assert.ok(/esc\(vo\.who\)/.test(vh) && /data-gm="another"/.test(vh) && /canAnother\(\)/.test(vh), 'labelled with the NPC, an Another button only when the box can');
  const css = fs.readFileSync(path.join(ROOT, 'app', 'gm.css'), 'utf8');
  assert.ok(/\.gm-voice \{/.test(css));
});

// ---------- WP4: Stall (the Rack), Mystery and Showrunner cards ----------
const STALL = { kind: 'complication', offer: 'A runner bursts in with bad news.', why: 'The table has gone quiet.', at: '2030-01-01T09:30:00.000Z' };
await test('Stall: the offer reaches the page (onStall), not the box; Listening off, a phone and the cap clear it; busy leaves it', async () => {
  let got = [];
  let r = rig({ onStall: (v) => got.push(v) }); r.gm.reply = { ...GOOD, stall: STALL };
  await r.ctl.poll();
  assert.deepEqual(got, [STALL]);
  assert.ok(!/runner bursts/.test(r.br.stub('#as-list').innerHTML), 'a Stall offer is not a card in the box');
  r.gm.reply = GOOD; await r.ctl.poll();
  assert.deepEqual(got, [STALL], 'a tick with no stall leaves the offer where it is');
  got = []; r = rig({ onStall: (v) => got.push(v) }); r.gm.want = 'off'; r.gm.reply = { ...GOOD, stall: STALL };
  await r.ctl.poll(); assert.equal(r.calls.tick.length, 0); assert.deepEqual(got, [null], 'Listening off: no call, and the page clears Stall');
  got = []; r = rig({ onStall: (v) => got.push(v) }, { phone: true }); r.gm.reply = { ...GOOD, stall: STALL };
  await r.ctl.poll(); assert.equal(r.calls.tick.length, 0); assert.deepEqual(got, []);
  got = []; r = rig({ onStall: (v) => got.push(v) }); r.gm.reply = { ...GOOD, spend: { tonight: 20, cap: 20, tier: 'off', tick: 0 }, stall: STALL };
  await r.ctl.poll(); assert.equal(got[got.length - 1], null, 'the cap clears it');
  got = []; r = rig({ onStall: (v) => got.push(v) }); r.gm.tickErr = err(429, "tonight's cap is reached");
  await r.ctl.poll(); assert.deepEqual(got, [null]);
  got = []; r = rig({ onStall: (v) => got.push(v) }); r.gm.tickErr = err(429, 'the fixer is busy');
  await r.ctl.poll(); assert.deepEqual(got, []);
  got = []; r = rig({ onStall: (v) => got.push(v) }); r.gm.reply = { ...GOOD, stall: { ...STALL, offer: '  ' } };
  await r.ctl.poll(); assert.deepEqual(got, [], 'an empty offer is nothing');
  r = rig(); r.gm.reply = { ...GOOD, stall: STALL }; await r.ctl.poll(); assert.equal(r.calls.tick.length, 1, 'a page without onStall is unchanged');
});

const MEANWHILE = { faction: 'The Lamplighters', cutaway: 'Their runners post a watch at the quay.', clock: 'Seal the quay', ticks: 1, why: 'they now know', at: '2030-01-01T09:30:00.000Z' };
await test('Meanwhile: the cutaway reaches the page (onMeanwhile), not the box; Listening off and the cap clear it; busy leaves it; an empty one is nothing', async () => {
  let got = [];
  let r = rig({ onMeanwhile: (v) => got.push(v) }); r.gm.reply = { ...GOOD, meanwhile: MEANWHILE };
  await r.ctl.poll();
  assert.deepEqual(got, [MEANWHILE]);
  assert.ok(!/post a watch/.test(r.br.stub('#as-list').innerHTML), 'a cutaway is not a card in the box');
  r.gm.reply = GOOD; await r.ctl.poll();
  assert.deepEqual(got, [MEANWHILE], 'a tick without one leaves it where it is');
  got = []; r = rig({ onMeanwhile: (v) => got.push(v) }); r.gm.want = 'off'; r.gm.reply = { ...GOOD, meanwhile: MEANWHILE };
  await r.ctl.poll(); assert.equal(r.calls.tick.length, 0); assert.deepEqual(got, [null], 'Listening off clears it');
  got = []; r = rig({ onMeanwhile: (v) => got.push(v) }); r.gm.reply = { ...GOOD, spend: { tonight: 20, cap: 20, tier: 'off', tick: 0 }, meanwhile: MEANWHILE };
  await r.ctl.poll(); assert.equal(got[got.length - 1], null, 'the cap clears it');
  got = []; r = rig({ onMeanwhile: (v) => got.push(v) }); r.gm.tickErr = err(429, 'the fixer is busy');
  await r.ctl.poll(); assert.deepEqual(got, []);
  got = []; r = rig({ onMeanwhile: (v) => got.push(v) }); r.gm.reply = { ...GOOD, meanwhile: { ...MEANWHILE, cutaway: '  ' } };
  await r.ctl.poll(); assert.deepEqual(got, []);
  r = rig(); r.gm.reply = { ...GOOD, meanwhile: MEANWHILE }; await r.ctl.poll(); assert.equal(r.calls.tick.length, 1, 'a page without onMeanwhile is unchanged');
});

await test('gm-page: Meanwhile is wired into the box as an idea card (cutaway, faction, clock, suggested tick, Clear) and ticks nothing', () => {
  const page = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  const m = /function mountAssist\(\) \{[\s\S]*?\n  \}\n/.exec(page);
  assert.ok(m && /onMeanwhile: function \(v\) \{ if \(S === me\) setMeanwhile\(v\); \}/.test(m[0]));
  assert.ok(!/meanwhileclear|meanwhileHtml/.test(page), 'no Rack markup or Rack button is left');
  assert.ok(/want\.meanwhile = /.test(/function syncCards\(\) \{[\s\S]*?\n  \}\n/.exec(page)[0]), 'syncCards makes the card from S.meanwhile');
  const ms = /function meanwhileSpec\(m\) \{[\s\S]*?\n  \}\n/.exec(page)[0], st = /function setMeanwhile\(v\) \{[\s\S]*?\n  \}\n/.exec(page)[0];
  assert.ok(/seat: 'meanwhile'/.test(ms) && /m\.faction/.test(ms) && /m\.clock/.test(ms) && /your call/.test(ms) && /ackLabel: 'Clear'/.test(ms));
  assert.ok(!/addClock|clockOps|campaignSave|\.filled/.test(ms + st), 'it suggests; it never touches a clock');
});

await test('Mystery and Showrunner cards arrive as ordinary cards with their own label', async () => {
  const r = rig();
  r.gm.reply = { ...GOOD, cards: [{ seat: 'mystery', kind: 'idea', at: '2030-01-01T09:30:00.000Z', text: 'Push next: the second key.', headline: 'Bring in the second key', bullets: ['How: through the cook'] }] };
  await r.ctl.poll();
  r.ctl.open();
  const html = r.br.stub('#as-list').innerHTML;
  assert.ok(/second key/.test(html) && /Mystery/.test(html), 'labelled Mystery');
  assert.match(html, /data-kind="idea"/); assert.match(html, /How: through the cook/);
  assert.equal(r.ctl.state().cards.length, 1); assert.equal(r.ctl.state().cards[0].important, false, 'only a Ref slip is important');
});

await test('gm-page: Stall is wired into the box as an idea card (offer, kind chip, Clear) and cleared with the rest', () => {
  const page = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  const m = /function mountAssist\(\) \{[\s\S]*?\n  \}\n/.exec(page);
  assert.ok(m && /onStall: function \(v\) \{ if \(S === me\) setStall\(v\); \}/.test(m[0]));
  assert.ok(!/stallclear|stallHtml/.test(page), 'no Rack markup or Rack button is left');
  const rack = /function renderRack\(\) \{[\s\S]*?\n  \}\n/.exec(page)[0];
  assert.ok(/syncCards\(\)/.test(rack) && !/gm-stall|gm-offer|gm-screenitem|S\.stall|S\.offers|S\.screenItems/.test(rack), 'the Rack draws Voice and the Fixer only; the cards come from syncCards');
  const ss = /function stallSpec\(st\) \{[\s\S]*?\n  \}\n/.exec(page)[0];
  assert.ok(/headline: st\.offer/.test(ss) && /text: st\.kind/.test(ss) && /ackLabel: 'Clear'/.test(ss) && /seat: 'stall'/.test(ss));
});


// ---------- handout suggestions and dots ----------
await test('Handout: a tick answer with a handout reaches onHandout; none, an empty id or a bad shape does not', async () => {
  const H = { id: 'torn-map', why: 'The table is at the cue.', at: '2030-01-01T09:30:00.000Z' };
  let got = [];
  let r = rig({ onHandout: (h) => got.push(h) }); r.gm.reply = { ...GOOD, handout: H };
  await r.ctl.poll();
  assert.deepEqual(got, [H]);
  assert.ok(!/torn-map|cue/.test(r.br.stub('#as-list').innerHTML), 'a handout is not a card in the box');
  r.gm.reply = GOOD; await r.ctl.poll(); assert.equal(got.length, 1, 'a tick without one calls nothing');
  for (const bad of [{ ...H, id: '  ' }, 'torn-map', null, { why: 'x' }]) { got = []; r = rig({ onHandout: (h) => got.push(h) }); r.gm.reply = { ...GOOD, handout: bad }; await r.ctl.poll(); assert.deepEqual(got, [], JSON.stringify(bad)); }
  r = rig(); r.gm.reply = { ...GOOD, handout: H }; await r.ctl.poll();            // no callback: nothing breaks
  assert.equal(r.calls.tick.length, 1);
});

await test('Dots: the Fit it form sends dots when the page has set them, and leaves the field out otherwise', async () => {
  let dots = 3;
  const r = rig({ dots: () => dots });
  r.gm.fitReply = { cards: [{ seat: 'fixer', at: 'a', text: 't', read: 't', one_three: 'a', four_five: 'b', six: 'c', crit: 'd', bargain: 'e' }], spend: { tonight: 3, cap: 20, tier: 'all' } };
  r.br.host.pos = 'risky';
  await r.br.listeners.submit({ target: { getAttribute: () => 'fit' }, preventDefault() {} }); await tick();
  assert.equal(r.calls.fit[0].dots, 3);
  dots = 0; await r.ctl.fit('risky', ''); assert.equal(r.calls.fit[1].dots, 0, 'zero is sent');
  dots = null; await r.ctl.fit('risky', ''); assert.ok(!('dots' in r.calls.fit[2]));
  dots = 9; await r.ctl.fit('risky', ''); assert.ok(!('dots' in r.calls.fit[3]), 'out of range: not sent');
  const r2 = rig(); r2.gm.fitReply = r.gm.fitReply; await r2.ctl.fit('risky', ''); assert.ok(!('dots' in r2.calls.fit[0]), 'no dots callback: as before');
  // the console's own fit passes whatever the page puts in the request
  const r3 = rig(); r3.gm.fitReply = r.gm.fitReply;
  await r3.ctl.autoFit({ position: 'risky', dots: 2, draws: { low: 'a', mid: 'b' } });
  assert.equal(r3.calls.fit[0].dots, 2);
});

// ---------- the Screen: Draw them, Make the prop, Wire, Case board; the gatekeeper on each; the cite flag on a Ref card ----------
await test('screenAllowed: the ladder as the box shows it (Wire stops at reduced, Portrait and Prop at core, the Board always)', () => {
  const at = (t) => ['portrait', 'prop', 'wire', 'board'].map((k) => P.screenAllowed(k, t));
  assert.deepEqual(at('all'), [true, true, true, true]); assert.deepEqual(at(''), [true, true, true, true]);
  assert.deepEqual(at('reduced'), [true, true, false, true]); assert.deepEqual(at('core'), [false, false, false, true]); assert.deepEqual(at('off'), [false, false, false, true]);
  assert.equal(P.screenAllowed('poster', 'all'), false);
});

await test('gateText, citesOf, gateOf, gateLine', () => {
  assert.equal(P.gateText({ kind: 'portrait', name: 'A B', description: 'Tall.' }), 'Portrait of A B. Tall.');
  assert.equal(P.gateText({ kind: 'prop', title: 'Memo', text: 'Body' }), 'Memo\nBody'); assert.equal(P.gateText({ kind: 'wire', text: 'Hi' }), 'Hi');
  assert.equal(P.gateText({ kind: 'prop', title: '', text: 'x'.repeat(2000) }).length, 1500);
  assert.deepEqual(P.citesOf('Rulebook p. 12 and pp.30-31, page 9, p. 12 again'), ['p. 12', 'pp.30-31', 'page 9']);
  assert.deepEqual(P.citesOf('no cite here'), []);
  assert.deepEqual(P.gateOf({ verdict: 'pass', unknown: false, reasons: [], revealed: [], rule: [], cites_bad: ['p.9'] }), { verdict: 'pass', unknown: false, checked: true, reasons: [], revealed: [], rule: [], cites_bad: ['p.9'] });
  const closed = P.gateOf(null); assert.deepEqual([closed.verdict, closed.checked, closed.unknown], ['block', false, true]);
  assert.deepEqual([P.gateOf({ verdict: 'maybe' }).verdict, P.gateOf({ verdict: 'block', unknown: true }).checked], ['block', false]);
  assert.deepEqual([P.gateLine(null), P.gateLine(closed), P.gateLine(P.gateOf({ verdict: 'pass' })), P.gateLine(P.gateOf({ verdict: 'block', reasons: ['x'] }))], ['Checking…', 'Not checked', 'Checked: clear', 'Blocked']);
});

const PASS_GATE = { verdict: 'pass', unknown: false, reasons: [], revealed: [], rule: [], cites_bad: [], spend: { tonight: 2, cap: 20, tier: 'all', tick: 0.01 } };
function screenRig(over = {}) {
  const items = [];
  const screen = { vocab: () => 'eyes: round', cleanSpec: (spec, name) => (spec && spec.bad ? { ok: false, spec: {}, notes: [], warnings: ['bad part'] } : { ok: true, spec: { ...spec, name }, notes: ['dropped x'], warnings: [] }) };
  const r = rig({ screen, onScreen: (i) => items.push(i), ...over });
  const made = { asked: [], gated: [] };
  r.gm.assistProp = async (req) => { made.asked.push(['prop', req]); return { item: { kind: 'prop', title: 'Memo', text: 'Invented memo text.', at: '2030-01-01T00:00:00Z' }, spend: { tonight: 1, cap: 20, tier: 'all', tick: 0.1 } }; };
  r.gm.assistWire = async (req) => { made.asked.push(['wire', req]); return { item: { kind: 'wire', text: 'Invented bulletin.', at: '2030-01-01T00:00:00Z' } }; };
  r.gm.assistPortrait = async (req) => { made.asked.push(['portrait', req]); return { item: { kind: 'portrait', name: 'Test Person', description: 'Tall.', spec: { heightIn: 70 }, at: '2030-01-01T00:00:00Z' } }; };
  r.gm.assistBoard = async (req) => { made.asked.push(['board', req]); return { item: { kind: 'board', title: 'Case board', text: 'WHAT WE KNOW\n- x', at: '2030-01-01T00:00:00Z' } }; };
  r.gm.assistGate = async (req) => { made.gated.push(req); if (r.gm.gateErr) throw r.gm.gateErr; return r.gm.gateReply || PASS_GATE; };
  return { ...r, items, made };
}

await test('Screen: press -> preview (checking) -> gate -> ready; the box writes nothing to the display, only hands the item to the page', async () => {
  const r = screenRig();
  const out = await r.ctl.screenMake('prop', { ask: '  a ferry   telegram ' });
  assert.deepEqual(r.made.asked, [['prop', { ask: 'a ferry telegram' }]]);
  assert.deepEqual(r.items.map((i) => [i.kind, i.status]), [['prop', 'checking'], ['prop', 'ready']]);
  assert.equal(r.items[0].id, r.items[1].id, 'the same item, updated');
  assert.deepEqual(r.made.gated, [{ kind: 'prop', text: 'Memo\nInvented memo text.', cites: [] }]);
  assert.equal(r.items[1].gate.verdict, 'pass'); assert.equal(r.items[1].gate.checked, true); assert.equal(out.item.status, 'ready');
  assert.equal(r.ctl.state().spend.tonight, 2, 'the gate\'s spend is folded in');
  assert.equal(r.ctl.state().screen.error, '');
});

await test('Screen: a block keeps its reasons; a gate that errors, refuses or is busy twice is "not checked" (fails closed)', async () => {
  let r = screenRig(); r.gm.gateReply = { verdict: 'block', unknown: false, reasons: ['too specific'], revealed: ['#2 The buyer'], rule: ['decides the roll'], cites_bad: [] };
  await r.ctl.screenMake('wire');
  let g = r.items.pop().gate; assert.deepEqual([g.verdict, g.checked, g.reasons, g.revealed, g.rule], ['block', true, ['too specific'], ['#2 The buyer'], ['decides the roll']]);
  r = screenRig(); r.gm.gateErr = err(500, 'boom'); await r.ctl.screenMake('prop');
  g = r.items.pop().gate; assert.deepEqual([g.verdict, g.checked, g.unknown], ['block', false, true]);
  r = screenRig(); r.gm.gateReply = { verdict: 'block', unknown: true, reasons: ['no verdict'], revealed: [], rule: [], cites_bad: [] }; await r.ctl.screenMake('prop');
  g = r.items.pop().gate; assert.equal(g.checked, false);
  r = screenRig(); r.gm.gateErr = err(429, 'the gatekeeper is busy');
  const done = r.ctl.screenMake('prop');
  await tick(); await tick();
  for (const t of r.timers) t.f();         // the one retry
  await done;
  assert.equal(r.made.gated.length, 2, 'busy is retried once, no more'); assert.equal(r.items.pop().gate.checked, false);
  r = screenRig(); r.gm.gateErr = err(429, "tonight's cap is reached"); await r.ctl.screenMake('prop');
  assert.equal(r.made.gated.length, 1, 'the cap is not retried'); assert.equal(r.items.pop().gate.checked, false);
});

await test('Screen: Draw them needs the figure kit\'s vocabulary, sends the typed name, and an item the kit rejects is never offered', async () => {
  let r = screenRig({ screen: { vocab: () => '', cleanSpec: () => null } });
  const none = await r.ctl.screenMake('portrait', { name: 'X' }); assert.deepEqual(none, { error: 'kit' }); assert.equal(r.made.asked.length, 0);
  r = screenRig(); await r.ctl.screenMake('portrait', { name: ' Test   Person ' });
  assert.deepEqual(r.made.asked, [['portrait', { vocab: 'eyes: round', name: 'Test Person' }]]);
  assert.deepEqual(r.items.map((i) => i.status), ['checking', 'ready']); assert.equal(r.items[1].spec.name, 'Test Person'); assert.deepEqual(r.items[1].notes, ['dropped x']);
  assert.equal(r.made.gated[0].text, 'Portrait of Test Person. Tall.'); assert.equal(r.made.gated[0].kind, 'portrait');
  r = screenRig(); r.gm.assistPortrait = async () => ({ item: { kind: 'portrait', name: 'Bad', description: '', spec: { bad: 1 } } });
  const bad = await r.ctl.screenMake('portrait', {}); assert.deepEqual(bad, { error: 'kit' });
  assert.equal(r.items.length, 0); assert.equal(r.made.gated.length, 0); assert.match(r.ctl.state().screen.error, /did not pass the figure kit \(bad part\)/);
});

await test('Screen: no item (a refusal or a cut-off, logged server-side) shows nothing and says so plainly; the Board says why it is empty', async () => {
  const r = screenRig(); r.gm.assistWire = async () => ({ item: null });
  assert.deepEqual(await r.ctl.screenMake('wire'), { error: 'none' }); assert.equal(r.items.length, 0); assert.match(r.ctl.state().screen.error, /nothing usable/);
  r.gm.assistBoard = async () => ({ item: null });
  await r.ctl.screenMake('board'); assert.match(r.ctl.state().screen.error, /Mystery keeper/);
});

await test('Screen: the ladder in the box and at the cap; a 429 from the server is worded, not shown raw; one model call at a time', async () => {
  let r = screenRig(); r.gm.reply = { ...GOOD, spend: { tonight: 13, cap: 20, tier: 'reduced' } }; await r.ctl.poll();
  assert.deepEqual(['portrait', 'prop', 'wire', 'board'].map((k) => r.ctl.canScreen(k)), [true, true, false, true]);
  assert.equal(await r.ctl.screenMake('wire'), null, 'no call when the ladder has dropped it'); assert.equal(r.made.asked.length, 0);
  r = screenRig(); r.gm.reply = { ...GOOD, spend: { tonight: 18, cap: 20, tier: 'core' } }; await r.ctl.poll();
  assert.deepEqual(['portrait', 'prop', 'wire', 'board'].map((k) => r.ctl.canScreen(k)), [false, false, false, true]);
  r = screenRig(); r.gm.reply = { ...GOOD, spend: { tonight: 20, cap: 20, tier: 'off' } }; await r.ctl.poll();
  assert.deepEqual(['portrait', 'prop', 'wire', 'board'].map((k) => r.ctl.canScreen(k)), [false, false, false, true], 'at the cap only the code-only Board');
  r = screenRig(); r.gm.assistProp = async () => { throw err(429, 'the budget ladder has dropped this for tonight'); };
  await r.ctl.screenMake('prop'); assert.match(r.ctl.state().screen.error, /budget has dropped/); assert.ok(!/ladder|\{/.test(r.ctl.state().screen.error)); assert.equal(r.ctl.state().paused, '', 'a ladder 429 does not pause the box');
  r = screenRig(); r.gm.assistProp = async () => { throw err(429, "tonight's cap is reached"); };
  await r.ctl.screenMake('prop'); assert.equal(r.ctl.state().paused, 'cap');
  // one model call at a time
  r = screenRig(); let release; r.gm.assistProp = () => new Promise((ok) => { release = () => ok({ item: { kind: 'prop', title: 't', text: 'x' } }); });
  const first = r.ctl.screenMake('prop'); await tick();
  assert.equal(await r.ctl.screenMake('wire'), null, 'a second model seat waits'); assert.equal(await r.ctl.screenMake('prop'), null);
  release(); await first;
  assert.ok(r.ctl.canScreen('wire'));
});

await test('Screen: a phone gets nothing (the box is hidden and makes no call)', async () => {
  const r = screenRig({}); const p = rig({ screen: {}, onScreen() {} }, { phone: true });
  p.gm.assistProp = async () => { throw new Error('called'); };
  assert.equal(p.ctl.canScreen('prop'), false); assert.equal(await p.ctl.screenMake('prop'), null);
  assert.ok(r.ctl.canScreen('prop'));
});

await test('Ref cite flag: a Ref card with a page cite is spot-checked; a bad cite gets a flag; no cite, no call; unknown or an error: no flag', async () => {
  const ref = (text, rule) => ({ cards: [{ seat: 'ref', at: '2030-01-01T10:00:00Z', text, detail: { said_at: '22:14', rule } }], updates: [], flags: [], spend: GOOD.spend, last: 5 });
  let r = screenRig(); r.gm.reply = ref('Position was set after the dice.', 'Rulebook p. 12'); r.gm.gateReply = { ...PASS_GATE, cites_bad: ['p. 12'] };
  await r.ctl.poll(); await tick(); await tick();
  assert.equal(r.made.gated.length, 1); assert.equal(r.made.gated[0].kind, 'card'); assert.deepEqual(r.made.gated[0].cites, ['p. 12']); assert.match(r.made.gated[0].text, /Rule: Rulebook p\. 12/);
  assert.deepEqual(r.ctl.state().cards[0].citeBad, ['p. 12']);
  assert.match(r.br.stub('#as-list').innerHTML, /as-citeflag/); assert.equal(r.ctl.state().cards[0].seat, 'ref');
  r = screenRig(); r.gm.reply = ref('A plain card.', 'no page named'); await r.ctl.poll(); await tick();
  assert.equal(r.made.gated.length, 0, 'no cite, no cost');
  r = screenRig(); r.gm.reply = ref('Card.', 'p. 9'); r.gm.gateReply = { ...PASS_GATE, unknown: true, verdict: 'block', cites_bad: ['p. 9'] }; await r.ctl.poll(); await tick(); await tick();
  assert.equal(r.ctl.state().cards[0].citeBad, undefined, 'an unchecked card is not flagged');
  r = screenRig(); r.gm.reply = ref('Card.', 'p. 9'); r.gm.gateErr = err(500, 'x'); await r.ctl.poll(); await tick(); await tick();
  assert.equal(r.ctl.state().cards.length, 1); assert.equal(r.ctl.state().cards[0].citeBad, undefined);
  r = screenRig(); r.gm.reply = { ...ref('Card.', 'p. 9'), cards: [{ seat: 'clerk', at: '2030-01-01T10:00:00Z', text: 'See p. 9', detail: null }] }; await r.ctl.poll(); await tick();
  assert.equal(r.made.gated.length, 0, 'only Ref cards');
});

await test('Screen wiring: the buttons are in the box, the page owns Show and Add, and the box never writes to the display, the cast or the ambient document', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'app', 'gm', 'assist-panel.js'), 'utf8');
  for (const id of ['as-sc-portrait', 'as-sc-prop', 'as-sc-wire', 'as-sc-board', 'as-sc-name', 'as-sc-ask']) assert.ok(panel.includes('id="' + id + '"'), id);
  assert.ok(/Draw them/.test(panel) && /Make the prop/.test(panel) && /Case board/.test(panel));
  const code = panel.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/setDisplay|patchAmbient|assistPortraitAdd|pushDisplay|patchState/.test(code), 'the box only makes and checks');
  const names = [...new Set([...code.matchAll(/'(assist\w+)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(names, ['assistBoard', 'assistPortrait', 'assistProp', 'assistWire']);
  const page = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  const m = /function mountAssist\(\) \{[\s\S]*?\n  \}\n/.exec(page);
  assert.ok(m && /onScreen: function \(item\)/.test(m[0]) && !/pushDisplay|setDisplay|patchAmbient/.test(m[0]), 'mountAssist hands items to the page and writes nothing itself');
  for (const fn of ['screenShow', 'screenWire', 'wireClear', 'screenAdd']) assert.ok(page.includes('function ' + fn), fn);
  assert.ok(/disabled: it\.status !== 'ready'/.test(/function screenSpec\(it\) \{[\s\S]*?\n  \}\n/.exec(page)[0]), 'Show is disabled until the gatekeeper has answered');
  assert.ok(/run: function \(\) \{ return screenShow\(id\); \}/.test(page) && /run: function \(\) \{ return showHandout\(o\.id\)/.test(page), "a card button runs the page's own screenShow / showHandout (one path to the iPad)");
  const cf = fs.readFileSync(path.join(ROOT, 'app', 'runtime', 'cf.js'), 'utf8');
  for (const [fn, p] of [['assistPortrait', 'portrait'], ['assistProp', 'prop'], ['assistWire', 'wire'], ['assistBoard', 'board'], ['assistGate', 'gatekeeper'], ['assistPortraitAdd', 'portrait-add']]) {
    assert.ok(new RegExp(fn + ": function \\([^)]*\\) \\{ return api\\('POST', '/gm/assist/" + p + "'").test(cf), fn);
  }
});

await test('page cards (P4): actions run the page function, Got it runs onAck once, removeCard sends nothing, state() holds no functions, the body is text', async () => {
  const r = rig(); r.ctl.open();
  const ran = []; let acked = 0;
  const id = r.ctl.addCard({ kind: 'idea', seat: 'handout', headline: 'Show handout: Invented key?', body: '<b>raw</b> text', bodyLabel: 'Will show', open: true, ackLabel: 'Dismiss',
    chips: [{ text: 'Blocked', tone: 'bad' }, { text: 'x', tone: 'nonsense' }],
    actions: [{ id: 'show', label: 'Show', primary: true, run: () => { ran.push('show'); } }, { id: 'off', label: 'Off', disabled: true, run: () => { ran.push('off'); } }],
    onAck: () => { acked++; } });
  assert.ok(id);
  const st = r.ctl.state().cards.find((c) => c.id === id);
  assert.equal(st.kind, 'idea'); assert.equal(st.actions.length, 2); assert.equal(st.chips[1].tone, ''); assert.equal(st.ackLabel, 'Dismiss');
  assert.ok(!JSON.stringify(st).includes('function'), 'no function on the copied card');
  const html = r.br.stub('#as-list').innerHTML;
  assert.ok(/data-act="show"/.test(html) && /Dismiss/.test(html) && /as-tone-bad/.test(html) && /Handout/.test(html), 'buttons, label, tone and seat chip are drawn');
  assert.ok(!/<b>raw<\/b>/.test(html), 'the body is text, never markup');
  assert.equal(r.ctl.state().cards.find((c) => c.id === id).seen, false);
  r.br.click('act', id, undefined, 'show'); await tick();
  assert.deepEqual(ran, ['show'], 'the page function ran');
  r.br.click('act', id, undefined, 'nonesuch'); r.br.click('act', 'nope', undefined, 'show'); await tick();
  assert.deepEqual(ran, ['show'], 'an unknown action or card does nothing');
  assert.equal(r.calls.marks.length, 0, 'no server mark for a page card');
  assert.equal(r.ctl.updateCard(id, { actions: [{ id: 'show', label: 'Show again', primary: true, run: () => { ran.push('again'); } }], chips: [{ text: 'Checked: clear', tone: 'ok' }] }), true);
  r.br.click('act', id, undefined, 'show'); await tick();
  assert.deepEqual(ran, ['show', 'again'], 'updateCard replaces the action functions');
  assert.ok(/Show again/.test(r.br.stub('#as-list').innerHTML) && /Checked: clear/.test(r.br.stub('#as-list').innerHTML), 'and the node is rebuilt');
  r.br.click('ack', id); await tick();
  assert.equal(acked, 1, 'Got it ran onAck once'); assert.equal(r.ctl.state().cards.length, 0); assert.equal(r.calls.marks.length, 0);
  const id2 = r.ctl.addCard({ kind: 'idea', headline: 'Second', onAck: () => { acked++; } });
  assert.equal(r.ctl.removeCard(id2), true); assert.equal(r.ctl.removeCard(id2), false); assert.equal(acked, 1, 'removeCard does not run onAck');
  assert.equal(r.ctl.state().cards.length, 0); assert.equal(r.calls.marks.length, 0);
});

// ---------- Ask Blade: the question field at the top of the box ----------
const ANS = { q: 'pitch three complications', kind: 'idea', headline: 'Three complications, headline', bullets: ['A runner arrives early', 'The lamp goes out'], say: 'Read this: **the lamp** goes out.', secret: 'The runner is *the rival\'s* man.', more: '', text: 'One: a runner arrives early.\nTwo: the lamp goes out.', at: '2030-01-01T10:00:00.000Z' };
function askRig(over = {}, brOpts) {
  const r = rig(over, brOpts), asked = [];
  r.gm.assistAsk = async (req) => { asked.push(req); if (r.gm.askErr) throw r.gm.askErr; return r.gm.askReply || { answer: ANS, spend: { tonight: 1.5, cap: 20, tier: 'all', tick: 0.5 } }; };
  const ta = r.br.stub('#as-ask-q');
  const submit = () => r.br.listeners.submit({ target: { getAttribute: (k) => (k === 'data-as-form' ? 'ask' : null) }, preventDefault() { r.prevented = (r.prevented || 0) + 1; } });
  const key = (k, extra = {}) => { let pd = 0; r.br.listeners.keydown({ key: k, shiftKey: false, target: { tagName: 'TEXTAREA', id: 'as-ask-q' }, preventDefault() { pd++; }, ...extra }); return pd; };
  return { ...r, asked, ta, submit, key };
}

await test('Ask Blade: the field is the first thing in the body, a 600-character textarea with the placeholder, and an Ask button; the page key ignores typing in it', () => {
  const r = askRig(); const h = r.br.host.innerHTML;
  assert.ok(h.indexOf('id="as-ask"') > h.indexOf('class="as-body"') && h.indexOf('id="as-ask"') < h.indexOf('id="as-list"') && h.indexOf('id="as-ask"') < h.indexOf('id="as-fit"'), 'above the cards and the Fixer');
  assert.match(h, /<form class="as-ask" id="as-ask" data-as-form="ask"/);
  assert.match(h, /<textarea id="as-ask-q" maxlength="600" rows="2" placeholder="Ask Blade: a ruling, three ideas, a read-aloud…"/);
  assert.match(h, /<button type="submit" class="as-go" id="as-ask-go">Ask<\/button>/);
  assert.equal(GP.keyAction({ key: 'a', typing: true }), null, 'typing in the field does not open or close the box');
  assert.deepEqual(GP.keyAction({ key: 'Escape', typing: true }), { type: 'esc' }, 'Escape in a field only blurs it (the page), the box stays');
});

await test('Ask Blade: submit sends { q } squashed, shows Thinking while it waits, then the answer under the field; the field is cleared; the spend is folded in', async () => {
  const r = askRig(); let release;
  r.gm.assistAsk = (req) => { r.asked.push(req); return new Promise((ok) => { release = () => ok({ answer: ANS, spend: { tonight: 1.5, cap: 20, tier: 'reduced', tick: 0.5 } }); }); };
  r.ta.value = '  pitch   three\ncomplications ';
  r.submit(); await tick();
  assert.deepEqual(r.asked, [{ q: 'pitch three complications' }]);
  assert.equal(r.br.stub('#as-ask-go').textContent, 'Thinking…'); assert.equal(r.br.stub('#as-ask-go').disabled, true); assert.equal(r.ctl.state().ask.busy, true);
  assert.equal(await r.ctl.ask('a second one'), null, 'while it is thinking a second ask is ignored'); assert.equal(r.asked.length, 1);
  release(); await tick(); await tick();
  assert.equal(r.br.stub('#as-ask-go').textContent, 'Ask'); assert.equal(r.br.stub('#as-ask-go').disabled, false);
  assert.equal(r.ta.value, '', 'cleared on success');
  const s = r.ctl.state();
  assert.equal(s.asks.length, 1); const a0 = s.asks[0];
  assert.deepEqual([a0.id, a0.src, a0.kind, a0.at, a0.q, a0.text, a0.kept, a0.seen], ['a|' + ANS.at + '|' + ANS.q, 'ask', 'idea', ANS.at, ANS.q, ANS.text, false, true], 'the answer is a card; its text is the server\'s, unchanged');
  assert.equal(a0.headline, ANS.headline); assert.deepEqual(a0.bullets, ANS.bullets); assert.equal(a0.say, ANS.say); assert.equal(a0.secret, ANS.secret);
  assert.equal(s.unread, 0, 'an answer that was asked for is not unread');
  const html = r.br.stub('#as-list').innerHTML;
  assert.match(html, /You asked: pitch three complications/); assert.match(html, /Three complications, headline/); assert.match(html, /A runner arrives early/);
  assert.match(html, /data-open="1"/, 'it lands open'); assert.match(html, /<strong>the lamp<\/strong>/, 'bold is a node, not asterisks'); assert.match(html, /GM ONLY/);
  assert.match(html, /Keep/); assert.match(html, /data-as="ack"/);
  assert.equal(s.spend.tier, 'reduced'); assert.match(r.br.stub('#as-tier').textContent, /Reduced/);
  assert.equal(r.calls.tick.length, 0, 'asking never ticks');
});

await test('Ask Blade: an answer is escaped; an empty field asks nothing; a long question is cut at 600; the newest answer is on top and ten are kept', async () => {
  const r = askRig();
  r.gm.askReply = { answer: { q: '<b>q</b>', kind: 'say', headline: '<img src=x onerror=1> & more', secret: '<script>x</script>', text: '<img src=x onerror=1> & more', at: '2030-01-01T10:00:00.000Z' } };
  assert.ok((await r.ctl.ask('<b>q</b>')).answer);
  assert.ok(!/<img|<b>q|<script/.test(r.br.stub('#as-list').innerHTML) && /&lt;img/.test(r.br.stub('#as-list').innerHTML));
  assert.equal(await r.ctl.ask('   '), null); assert.equal(await r.ctl.ask(undefined), null);
  assert.equal(r.asked.length, 1);
  r.gm.askReply = undefined; await r.ctl.ask('x'.repeat(900));
  assert.equal(r.asked[1].q.length, 600);
  for (let i = 0; i < 12; i++) { r.gm.askReply = { answer: { q: 'q' + i, headline: 'a' + i, text: 'a' + i, at: '2030-01-01T11:' + String(i).padStart(2, '0') + ':00.000Z' } }; await r.ctl.ask('q' + i); }
  const asks = r.ctl.state().asks;
  assert.equal(asks.length, 10); assert.equal(asks[9].q, 'q11'); assert.equal(asks[0].q, 'q2');
  const html = r.br.stub('#as-list').innerHTML; assert.ok(html.indexOf('>a11<') < html.indexOf('>a10<'), 'newest first');
});

await test('Ask Blade: Enter asks, Shift+Enter is a new line, a composing Enter or an Enter elsewhere does nothing, and Escape in the field does not close the box', async () => {
  const r = askRig(); r.ctl.open(); await tick();
  r.ta.value = 'what next?';
  assert.equal(r.key('Enter', { shiftKey: true }), 0, 'Shift+Enter: the browser adds the line break'); await tick(); assert.equal(r.asked.length, 0);
  assert.equal(r.key('Enter', { isComposing: true }), 0); assert.equal(r.asked.length, 0);
  assert.equal(r.key('Enter', { target: { tagName: 'INPUT', id: 'as-eff' } }), 0); assert.equal(r.asked.length, 0, 'not in the Effect field');
  assert.equal(r.key('Enter'), 1, 'Enter is taken'); await tick(); await tick();
  assert.deepEqual(r.asked, [{ q: 'what next?' }]);
  assert.equal(r.key('Escape'), 0); assert.equal(r.ctl.isOpen(), true, 'Escape in the textarea leaves the box open');
  r.br.listeners.keydown({ key: 'Escape', target: { tagName: 'DIV' }, preventDefault() {} }); assert.equal(r.ctl.isOpen(), false, 'Escape outside a field closes it');
});

await test('Ask Blade: a failure keeps the words in the field and says why in plain words; only a cap pauses the box', async () => {
  const cases = [[err(500, '{"error":"boom"}'), /nothing to say to that just now/, ''], [err(undefined, 'offline', { network: true }), /Could not reach the server/, ''],
    [err(429, 'this is busy'), /busy/, ''], [err(429, 'the budget ladder has dropped this for tonight'), /budget has dropped/, ''], [err(429, "tonight's cap is reached"), /Cap reached/, 'cap'],
    [err(503, 'assist is not set up (no API key)'), /not set up on the server/, '']];
  for (const [e, re, paused] of cases) {
    const r = askRig(); r.gm.askErr = e; r.ta.value = 'keep these words';
    const out = await r.ctl.ask('keep these words');
    assert.ok(out && out.error, String(e.status)); assert.equal(r.ta.value, 'keep these words', 'the question stays');
    const msg = r.br.stub('#as-ask-status').textContent;
    assert.match(msg, re); assert.ok(!/ladder|\{|boom|offline/.test(msg), 'the server\'s own words are not shown');
    assert.equal(r.br.stub('#as-ask-status').hidden, false); assert.equal(r.ctl.state().paused, paused); assert.equal(r.ctl.state().asks.length, 0);
    assert.equal(r.br.stub('#as-ask-go').disabled, paused === 'cap' || paused === 'setup', 'the button is back unless the cap has stopped it');
  }
  // the next try clears the message
  const r = askRig(); r.gm.askErr = err(500, 'x'); await r.ctl.ask('one'); r.gm.askErr = null; await r.ctl.ask('one');
  assert.equal(r.br.stub('#as-ask-status').textContent, ''); assert.equal(r.ctl.state().asks.length, 1);
});

await test('Ask Blade: no answer (a refusal or a cut-off, logged on the server) says so and keeps the question; a missing briefing says that', async () => {
  const r = askRig(); r.gm.askReply = { answer: null, spend: { tonight: 1, cap: 20, tier: 'all', tick: 0.1 } }; r.ta.value = 'my words';
  assert.deepEqual(await r.ctl.ask('my words'), { error: 'none' });
  assert.equal(r.br.stub('#as-ask-status').textContent, 'Blade had nothing to say to that just now. Try again.'); assert.equal(r.ta.value, 'my words'); assert.equal(r.ctl.state().asks.length, 0);
  assert.equal(r.ctl.state().spend.tonight, 1, 'what the call cost still counts');
  r.gm.askReply = { answer: null, spend: GOOD.spend, warnings: ['no assist part in the GM pack'] };
  await r.ctl.ask('my words'); assert.match(r.br.stub('#as-ask-status').textContent, /no briefing loaded/);
  r.gm.askReply = { answer: { q: 'x', text: '   ', at: 'a' } }; assert.deepEqual(await r.ctl.ask('x'), { error: 'none' }, 'a blank answer is none');
});

await test('Ask Blade: canAsk is false on a phone, with the cap or setup paused, from 85% (core) and at the cap, and when the runtime has no assistAsk; true up to 85%', async () => {
  let r = askRig(); assert.equal(r.ctl.canAsk(), true);
  for (const [tier, can] of [['all', true], ['reduced', true], ['core', false], ['off', false]]) {
    r = askRig(); r.gm.reply = { ...GOOD, spend: { tonight: 1, cap: 20, tier } }; await r.ctl.poll();
    assert.equal(r.ctl.canAsk(), can, tier);
    await r.ctl.ask('hello');
    assert.equal(r.asked.length, can ? 1 : 0, tier + (can ? ' asks' : ' makes no call'));
    r.br.stub('#as-ask-q').value = ''; r.ctl.state();
    assert.equal(r.br.stub('#as-ask-go').disabled, !can, tier + ' button');
    if (!can) assert.match(r.br.stub('#as-ask-status').textContent, /budget/, 'and says why');
  }
  r = askRig(); r.gm.tickErr = err(503, 'x'); await r.ctl.poll(); assert.equal(r.ctl.state().paused, 'setup'); assert.equal(r.ctl.canAsk(), false);
  r = askRig(); r.gm.tickErr = err(429, "tonight's cap is reached"); await r.ctl.poll(); assert.equal(r.ctl.state().paused, 'cap'); assert.equal(r.ctl.canAsk(), false);
  r = askRig(); r.gm.tickErr = err(429, 'this is busy'); await r.ctl.poll(); assert.equal(r.ctl.state().paused, 'busy'); assert.equal(r.ctl.canAsk(), true, 'a busy tick does not stop a question');
  const p = askRig({}, { phone: true }); assert.equal(p.ctl.canAsk(), false); assert.equal(await p.ctl.ask('hi'), null); assert.equal(p.asked.length, 0);
  const brw = fakeBrowser();
  const bare = A.create({ gm: { stt: async () => ({}), assistTick: async () => GOOD, assistFit: async () => ({}) }, doc: brw.doc, win: brw.win, noTimer: true });
  assert.equal(bare.canAsk(), false); assert.equal(await bare.ask('hi'), null);
  assert.equal(brw.stub('#as-ask').hidden, true, 'an older runtime without assistAsk is not offered the field');
});

await test('Ask Blade: the answers come back after a reload (deduped, newest first, kept marks), and a reload marks nothing', async () => {
  const stored = { cards: [], updates: [], asks: [
    { row: 1, at: '2030-01-01T10:00:00.000Z', q: 'first?', text: 'First answer.', kept: true },
    { row: 2, at: '2030-01-01T10:05:00.000Z', q: 'second?', text: 'Second answer.', kept: false },
    { row: 3, at: '2030-01-01T10:06:00.000Z', q: 'gone?', text: 'Dismissed one.', dismissed: true }, { at: 'x', q: '', text: 'no question' }, { at: 'y', q: 'blank?', text: '  ' }, null] };
  const r = askRig({ stored }); await r.ctl.ready;
  const s = r.ctl.state();
  assert.deepEqual(s.asks.map((a) => [a.q, a.kept]), [['first?', true], ['second?', false]]);
  const html = r.br.stub('#as-list').innerHTML; assert.ok(html.indexOf('Second answer') < html.indexOf('First answer'), 'newest on top'); assert.match(html, /★ Kept/);
  assert.equal(s.unread, 0, 'a restored answer is not unread (the server never records a read for one)');
  assert.equal(r.calls.marks.length, 0);
  // the same answer sent by the server twice is one answer
  const again = { asks: stored.asks };
  const st = { cards: [], updates: [] }; assert.equal(P.restoreAsks(st, again), 2); assert.equal(P.restoreAsks(st, again), 0);
  assert.equal(P.restore({ cards: [], updates: [] }, { asks: stored.asks }), 0, 'restore() tolerates a state with no asks list and returns the card count');
  const many = { asks: Array.from({ length: 14 }, (_, i) => ({ at: '2030-01-01T10:' + String(i).padStart(2, '0') + ':00.000Z', q: 'q' + i, text: 'a' + i })) };
  const st2 = { cards: [] }; P.restoreAsks(st2, many); assert.deepEqual([st2.cards.length, st2.cards[0].q, st2.cards[9].q], [10, 'q4', 'q13']);
  // an old server with no `asks` is fine
  const old = askRig({ stored: { cards: [], updates: [] } }); await old.ctl.ready; assert.deepEqual(old.ctl.state().asks, []);
});

await test('Ask Blade: Keep files "Blade, ask (HH:MM): question -> answer" through the page\'s capture (clipped to 500) and marks the server; × dismisses and marks', async () => {
  const r = askRig(); await r.ctl.ask('pitch three complications');
  const a = r.ctl.state().asks[0];
  r.br.click('keep', a.id); await tick();
  assert.equal(r.notes.length, 1);
  assert.equal(r.notes[0], 'Blade, ask (' + P.hhmm(ANS.at) + '): pitch three complications -> One: a runner arrives early. Two: the lamp goes out.');
  assert.deepEqual(r.calls.marks, [{ op: 'keep', items: [{ at: ANS.at, text: ANS.q }] }]);
  assert.equal(r.ctl.state().asks[0].kept, true); assert.match(r.br.stub('#as-list').innerHTML, /★ Kept/); assert.ok(!/data-as="keep"/.test(r.br.stub('#as-list').innerHTML));
  r.br.click('keep', a.id); await tick(); assert.equal(r.notes.length, 1, 'kept once');
  r.br.click('ack', a.id); await tick();
  assert.deepEqual(r.calls.marks[1], { op: 'dismiss', items: [{ at: ANS.at, text: ANS.q }] });
  assert.equal(r.ctl.state().asks.length, 0); assert.ok(!/pitch three/.test(r.br.stub('#as-list').innerHTML));
  // a long answer is clipped to what the capture bar takes
  const long = askRig(); long.gm.askReply = { answer: { q: 'q', text: 'word '.repeat(400), at: ANS.at } }; await long.ctl.ask('q');
  long.br.click('keep', long.ctl.state().asks[0].id); await tick();
  assert.ok(long.notes[0].length <= 500 && long.notes[0].endsWith('…') && long.notes[0].startsWith('Blade, ask ('), String(long.notes[0].length));
  // the capture bar refusing it (full) leaves the answer unkept
  const full = askRig({ onNote: () => false }); await full.ctl.ask('q');
  full.br.click('keep', full.ctl.state().asks[0].id); await tick(); assert.equal(full.ctl.state().asks[0].kept, false); assert.equal(full.calls.marks.length, 0);
  // a failed server mark changes nothing on screen
  const bad = askRig(); await bad.ctl.ask('q'); bad.gm.markErr = err(500, 'x');
  bad.br.click('ack', bad.ctl.state().asks[0].id); await tick(); assert.equal(bad.ctl.state().asks.length, 0);
  // no capture bar on the page: no Keep button
  const nk = askRig({ onNote: undefined }); await nk.ctl.ask('q');
  assert.ok(!/data-as="keep"/.test(nk.br.stub('#as-list').innerHTML) && /data-as="ack"/.test(nk.br.stub('#as-list').innerHTML));
});

await test('Ask Blade: the helpers are plain, and the styles keep the answer to the box width and its line breaks', () => {
  assert.equal(P.askAllowed('all'), true); assert.equal(P.askAllowed('reduced'), true); assert.equal(P.askAllowed('core'), false); assert.equal(P.askAllowed('off'), false);
  for (const e of [err(500), err(400), err(undefined, 'x', { timeout: true }), err(429, 'busy'), err(429, 'cap'), err(429, 'ladder'), err(503)]) assert.ok(P.askErr(e) && !/[{}]/.test(P.askErr(e)));
  assert.equal(P.askMoment({ at: ANS.at, q: ' q ', text: ' a \n b ' }), 'Blade, ask (' + P.hhmm(ANS.at) + '): q -> a b');
  const css = fs.readFileSync(path.join(ROOT, 'app', 'gm.css'), 'utf8');
  assert.match(css, /\.gm-assist \.as-band-text \{[^}]*white-space: pre-wrap/); assert.match(css, /\.gm-assist \.as-detail \{[^}]*overflow-y: auto/); assert.match(css, /\.gm-assist \.as-ask textarea \{[^}]*width: 100%[^}]*box-sizing: border-box/);
});

// ---------- the side panel's shell (P2): the glance grammar, the feed's chips, the header, the tab, U, Pin ----------
await test('the glance grammar: every seat has a kind (rule, say, idea, done, warn, note), a glyph and a word; an unknown seat is a note', () => {
  assert.deepEqual(['ref', 'fixer', 'mystery', 'showrunner', 'clerk', 'ledger', 'nobody'].map(P.kindOf), ['rule', 'say', 'idea', 'idea', 'note', 'note', 'note']);
  assert.deepEqual(Object.keys(P.KIND), ['rule', 'say', 'idea', 'done', 'warn', 'note']);
  for (const k of Object.keys(P.KIND)) assert.ok(P.KIND[k].glyph && P.KIND[k].word, k + ' has a glyph and a word: colour is never the only signal');
  assert.deepEqual(P.FILTERS, ['all', 'rule', 'say', 'idea', 'done', 'note']);
});
await test('the feed: counts per kind, a filter keeps one kind newest first, the tab shows at most five pips of the unread, newest first', () => {
  const cards = ['ref', 'clerk', 'ref', 'mystery', 'fixer', 'ref', 'clerk'].map((seat, i) => ({ id: 'c' + i, seat, at: '2026-01-01T10:0' + i + ':00Z', text: 't' + i, seen: i === 0 }));
  assert.deepEqual(P.countsOf(cards), { all: 7, rule: 3, say: 1, idea: 1, done: 0, warn: 0, note: 2 });
  assert.deepEqual(P.feedOf(cards, 'rule').map((c) => c.id), ['c5', 'c2', 'c0']);
  assert.equal(P.feedOf(cards, 'all').length, 7); assert.deepEqual(P.feedOf(null, 'all'), []);
  assert.deepEqual(P.pipsOf(cards), ['note', 'rule', 'say', 'idea', 'rule'], 'the unread, newest first, five of the six');
  assert.deepEqual(P.pipsOf(cards.map((c) => ({ ...c, seen: true }))), []);
  assert.equal(P.headline('x'.repeat(300)).length, 140);
});
await test('the header: the state word (Listening, Paused, Off, Not set up) and the spend meter (mustard from 60%, red from 85%)', () => {
  assert.deepEqual(P.stateOf({ listening: true }), { key: 'on', word: 'Listening' });
  assert.equal(P.stateOf({ listening: false }).word, 'Paused'); assert.equal(P.stateOf({ paused: 'busy' }).word, 'Paused');
  assert.equal(P.stateOf({ paused: 'cap' }).word, 'Off'); assert.equal(P.stateOf({ spend: { tier: 'off' }, listening: true }).word, 'Off');
  assert.equal(P.stateOf({ paused: 'setup' }).word, 'Not set up'); assert.equal(P.stateOf({ setup: true, listening: true }).word, 'Not set up');
  assert.equal(P.stateOf({}).word, 'Waiting');
  assert.deepEqual(P.meterOf({ tonight: 3.4, cap: 30 }), { cells: 1, tone: 'ok', frac: 3.4 / 30 });
  assert.equal(P.meterOf({ tonight: 18, cap: 30 }).tone, 'mid'); assert.equal(P.meterOf({ tonight: 25.5, cap: 30 }).tone, 'warn');
  assert.equal(P.meterOf({ tonight: 30, cap: 30 }).cells, 5); assert.equal(P.meterOf(null).cells, 0); assert.equal(P.meterOf({ tonight: 1 }).cells, 0);
});
await test('the tab: the count, the pips and the unread kinds are drawn from the cards; the panel markup has every zone, in order, and the old ids', async () => {
  const r = rig({ stored: { cards: [{ seat: 'ref', at: '2026-01-01T10:00:00Z', text: 'A slip.' }, { seat: 'mystery', at: '2026-01-01T10:01:00Z', text: 'An idea.' }], updates: [] } });
  await r.ctl.ready;
  assert.equal(r.br.stub('#as-pips').innerHTML.match(/class="as-pip"/g).length, 2);
  assert.match(r.br.stub('#as-pips').innerHTML, /data-kind="idea"[^>]*><\/i><i class="as-pip" data-kind="rule"/, 'newest first');
  const h = r.br.host.innerHTML, at = (s) => h.indexOf(s);
  const order = ['class="as-head"', 'id="as-now"', 'id="as-ask"', 'id="as-chips"', 'id="as-list"', 'id="as-tools"', 'id="as-fit"', 'id="as-screen"'].map(at);
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), 'header, Now, Ask, chips, feed, Tools (Fit it, Screen): ' + order);
  assert.match(h, /id="as-launch"/); assert.match(h, /<details class="as-tools" id="as-tools">/);
});
await test('Now: the newest unread card is open for 1.5 s once the panel opens, then it is only in the feed', async () => {
  const r = rig({ stored: { cards: [{ seat: 'ref', at: '2026-01-01T10:00:00Z', text: 'Older slip.' }, { seat: 'ref', at: '2026-01-01T10:01:00Z', text: 'Newest slip.' }], updates: [] } });
  await r.ctl.ready;
  assert.match(r.br.stub('#as-now').innerHTML, /Quiet/, 'closed: nothing is in Now');
  r.ctl.open();
  assert.match(r.br.stub('#as-now').innerHTML, /Newest slip/); assert.ok(!/Older slip/.test(r.br.stub('#as-now').innerHTML));
  const t = r.timers.find((x) => x.ms === 1500); assert.ok(t, 'a 1.5 s timer');
  t.f(); assert.match(r.br.stub('#as-now').innerHTML, /Quiet/); assert.match(r.br.stub('#as-list').innerHTML, /Newest slip/, 'still in the feed');
});
await test('mock cards (o.mock) are labelled examples with no actions, never counted, and off unless asked for; real cards replace them', async () => {
  const off = rig(); assert.ok(!/example/.test(off.br.stub('#as-list').innerHTML) && /Nothing yet/.test(off.br.stub('#as-list').innerHTML), 'off by default: the empty feed says so');
  const on = rig({ mock: true }); const h = on.br.stub('#as-list').innerHTML;
  assert.equal((h.match(/data-mock/g) || []).length, 3); assert.ok(!/data-as="keep"|data-as="ack"/.test(h), 'an example has no Keep and no Got it, so nothing invented reaches the capture bar');
  assert.equal(on.ctl.state().cards.length, 0); assert.equal(on.ctl.state().unread, 0);
  assert.match(h, /data-kind="rule"/); assert.match(h, /data-kind="idea"/); assert.match(h, /data-kind="done"/);
  const real = rig({ mock: true, stored: { cards: [{ seat: 'ref', at: '2026-01-01T10:00:00Z', text: 'A real slip.' }], updates: [] } }); await real.ctl.ready;
  assert.ok(!/data-mock/.test(real.br.stub('#as-list').innerHTML) && /A real slip/.test(real.br.stub('#as-list').innerHTML));
});
await test('U is wired to undoNewest, a no-op until C2; Pin is refused when the window is too narrow, and the page maps U to it', async () => {
  const r = rig(); assert.equal(typeof r.ctl.undoNewest, 'function'); assert.equal(await r.ctl.undoNewest(), null);
  r.ctl.open(); r.ctl.pin(); assert.equal(r.ctl.isPinned(), false, 'a fake window is under 1600 px: no dock');
  assert.deepEqual(GP.keyAction({ key: 'u' }), { type: 'undo' }); assert.equal(GP.keyAction({ key: 'u', typing: true }), null);
  const page = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  assert.ok(/a\.type === 'undo'[^}]*undoNewest/.test(page), 'the page calls undoNewest'); assert.ok(/\[jku\]/.test(page), 'J, K and U inside the panel are the panel\'s, not the page\'s');
});
await test('the shell\'s CSS: tokens for the six kinds on #gm-page and on the panel (light and dark), a 400 px panel (min 360, max 33vw), no slide under reduced motion, a fourth column when docked', () => {
  const css = fs.readFileSync(path.join(ROOT, 'app', 'gm.css'), 'utf8');
  assert.match(css, /#gm-page, \.gm-assist \{[^}]*--k-rule: #3f62c4;[^}]*--k-idea: var\(--mustard\)/);
  assert.equal((css.match(/--k-rule: #8fa3dd/g) || []).length, 2, 'the dark blue under the media query and under data-theme');
  assert.match(css, /--as-w: max\(360px, min\(400px, 33vw\)\)/);
  assert.match(css, /transition: transform \.18s ease-out/); assert.match(css, /prefers-reduced-motion: reduce\) \{ \.gm-assist \.as-panel, \.gm-assist \.as-panel\[hidden\] \{ transition: none/);
  assert.match(css, /body\.as-dock\.gm-app #gm-page \.gm-main \{[^}]*var\(--as-w\)/);
  assert.ok(!/\.gm-assist [^{]*\{[^}]*font(-size)?: [^;}]*\b(9|10|10\.5|11|11\.5)(px|\/)/.test(css.slice(css.indexOf('Blade, the side panel'))), 'nothing in the panel is under 12 px');
});

// ---------- rolled: one tick 40 s after a result is tapped or a roll is filed ----------
function clockRig(over = {}) {
  const fake = { list: [], next: 1, ints: [] };
  const r = rig({
    setTimeout: (f, ms) => { const id = fake.next++; fake.list.push({ id, f: () => { fake.list = fake.list.filter((x) => x.id !== id); return f(); }, ms }); return id; },
    clearTimeout: (id) => { fake.list = fake.list.filter((x) => x.id !== id); },
    setInterval: (f, ms) => { const id = 'i' + fake.next++; fake.ints.push({ id, f, ms }); return id; },
    clearInterval: (id) => { fake.ints = fake.ints.filter((x) => x.id !== id); },
    ...over,
  });
  return { ...r, fake };
}
const settle = () => new Promise((ok) => setImmediate(ok));

await test('rolled: one tick with rolled: true falls due 40 s after the tap; a regular poll sends no rolled', async () => {
  const r = clockRig(); await r.ctl.ready;
  r.ctl.rolled();
  assert.equal(r.fake.list.length, 1); assert.equal(r.fake.list[0].ms, 40000, '40 s');
  assert.deepEqual(r.calls.tick, [], 'nothing is sent at the tap');
  r.fake.list[0].f(); await settle(); await settle();
  assert.deepEqual(r.calls.rolled, [true], 'the tick says rolled');
  await r.ctl.poll();
  assert.deepEqual(r.calls.rolled, [true, false], 'an ordinary poll sends no rolled');
  r.ctl.destroy();
});

await test('rolled: one pending at a time, and a newer result restarts the 40 s', async () => {
  const r = clockRig(); await r.ctl.ready;
  r.ctl.rolled(); const first = r.fake.list[0].id;
  r.ctl.rolled();
  assert.equal(r.fake.list.length, 1, 'the first timer was cleared');
  assert.notEqual(r.fake.list[0].id, first);
  r.ctl.rolled(); r.ctl.rolled();
  assert.equal(r.fake.list.length, 1);
  r.fake.list[0].f(); await settle(); await settle();
  assert.deepEqual(r.calls.rolled, [true], 'one tick for three taps');
  r.ctl.destroy();
});

await test('rolled: not while Listening is off, paused or hidden; a tick in flight makes it wait, not drop; destroy clears it', async () => {
  let r = clockRig(); await r.ctl.ready;
  r.gm.want = 'off'; r.ctl.rolled(); r.fake.list[0].f(); await settle(); await settle();
  assert.deepEqual(r.calls.tick, [], 'Listening off: no tick');
  r.gm.want = 'on'; r.gm.tickErr = err(429, "tonight's cap is reached"); await r.ctl.poll();
  assert.equal(r.ctl.state().paused, 'cap');
  const before = r.calls.tick.length; r.ctl.rolled(); r.fake.list[0].f(); await settle(); await settle();
  assert.equal(r.calls.tick.length, before, 'paused: no tick');
  r.ctl.destroy();
  r = clockRig(); await r.ctl.ready;
  r.br.doc.hidden = true; r.ctl.rolled(); r.fake.list[0].f(); await settle(); await settle();
  assert.deepEqual(r.calls.tick, [], 'hidden page: no tick');
  r.ctl.destroy();
  // in flight: a slow poll holds st.busy; the rolled timer re-arms a short retry instead of dropping
  r = clockRig(); await r.ctl.ready;
  let release; r.gm.assistTick = async (after, npc, rolled) => { r.calls.rolled.push(rolled === true); await new Promise((ok) => { release = ok; }); return GOOD; };
  const slow = r.ctl.poll(); await settle(); await settle();
  r.ctl.rolled(); r.fake.list[0].f(); await settle();
  assert.equal(r.fake.list.length, 1, 'a retry is waiting'); assert.ok(r.fake.list[0].ms < 10000, 'a short retry');
  release(); await slow; await settle();
  r.fake.list[0].f(); await settle(); await settle();
  assert.deepEqual(r.calls.rolled, [false, true], 'the rolled tick went once the first was done');
  release(); await settle();
  r.ctl.rolled(); assert.equal(r.fake.list.length, 1); r.ctl.destroy();
  assert.equal(r.fake.list.length, 0, 'destroy clears the pending timer');
  const n = r.calls.rolled.length; r.ctl.rolled(); assert.equal(r.fake.list.length, 0, 'a destroyed box schedules nothing'); assert.equal(r.calls.rolled.length, n);
});

await test('rolled: after its tick the regular minute starts again, so the next ordinary tick is not squeezed up against it', async () => {
  const r = clockRig({ noTimer: false }); await r.ctl.ready;
  assert.equal(r.fake.ints.length, 1); const firstInt = r.fake.ints[0].id;
  r.ctl.rolled(); r.fake.list.find((x) => x.ms === 40000).f(); await settle(); await settle(); await settle();
  assert.deepEqual(r.calls.rolled, [true]);
  assert.equal(r.fake.ints.length, 1, 'still one interval'); assert.notEqual(r.fake.ints[0].id, firstInt, 'a fresh one');
  assert.equal(r.fake.ints[0].ms, 60000);
  r.ctl.destroy();
});

await test('rolled: the page asks for it on a tapped situation and on a filed roll (L), not on a single table or an empty L', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  assert.ok(src.includes("stamp('situation', res);\n    if (res && res.meta && (res.meta.situation === 'fourfive' || res.meta.situation === 'onetothree')) assistRolled();"), 'a 4/5 or 1-3 result only');
  assert.ok(!/stamp\('console', res\);\s*assistRolled/.test(src), 'not a single table');
  assert.ok(/if \(addCapture\('r', S\.last\.text\)\) assistRolled\(\);/.test(src), 'L files, then asks');
  assert.ok(/function assistRolled\(\) \{ if \(S && S\.assist && typeof S\.assist\.rolled === 'function'\)/.test(src), 'guarded');
});

// ---------- P3: the card (one renderer for every kind), Now, the strip, keyed rendering, page-made cards ----------
const vmCtx = {}; vmCtx.window = vmCtx; vm.createContext(vmCtx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', 'markdown.js'), 'utf8'), vmCtx, { filename: 'markdown.js' });
const MD = vmCtx.B68Markdown;
const XSS = '<img src=x onerror=1>';
const textOf = (el) => el.textContent;
const find = (el, pred) => { const out = []; (function w(n) { for (const c of n.children || []) { if (c.nodeType === 1) { if (pred(c)) out.push(c); w(c); } } })(el); return out; };
const byClass = (el, cls) => find(el, (n) => n.classList.contains(cls));

await test('inline marks: **bold** and *italic* are strong and em nodes; an unmatched * stays; a tag in the text is literal text', () => {
  const doc = fakeBrowser().doc; doc.createElement('host'); const wrap = new MiniEl('p');      // the first element a fake document makes is the panel's host
  P.appendInline(doc, wrap, 'a **bold** and *ital* and 2 * 3 and ' + XSS + ' end');
  assert.equal(wrap.textContent, 'a bold and ital and 2 * 3 and ' + XSS + ' end');
  assert.deepEqual(wrap.children.filter((c) => c.nodeType === 1).map((c) => [c.tagName, c.textContent]), [['STRONG', 'bold'], ['EM', 'ital']]);
  assert.match(wrap.innerHTML, /&lt;img src=x onerror=1&gt;/); assert.ok(!/<img/.test(wrap.innerHTML), 'serialised, the tag is escaped');
  const w2 = new MiniEl('p'); P.appendInline(doc, w2, '**<b>x</b>** *<i>*'); assert.deepEqual(w2.children.filter((c) => c.nodeType === 1).map((c) => [c.tagName, c.textContent]), [['STRONG', '<b>x</b>'], ['EM', '<i>']], 'a tag inside a mark is still text');
  assert.ok(!/<b>|<i>/.test(w2.innerHTML.replace(/<\/?(strong|em)>/g, '')));
  for (const s of ['', '*', '**', '****', '* *', '**a', 'a**']) { const w = new MiniEl('p'); P.appendInline(doc, w, s); assert.equal(w.textContent.replace(/\*/g, ''), s.replace(/\*/g, '')); }
});

await test('stripHeadings: a heading line becomes a bold line, outside a code fence only', () => {
  assert.equal(P.stripHeadings('# One\ntext\n### Two ###\n```\n# kept\n```\n~~~\n## also kept\n~~~\n#nospace'), '**One**\ntext\n**Two**\n```\n# kept\n```\n~~~\n## also kept\n~~~\n#nospace');
  assert.equal(P.stripHeadings('## has *stars*'), 'has *stars*');
});

await test('the card: folded one line (kind, headline, time); open shows bullets (5 at most), SAY, GM ONLY, the cite string and the check chip, and the actions', async () => {
  const r = rig({ markdown: MD });
  r.gm.reply = { ...GOOD, cards: [{ seat: 'ref', kind: 'rule', at: '2030-01-01T09:30:00.000Z', text: 'Server text, not the headline.', headline: 'Resist the **harm**', bullets: ['one', 'two', 'three', 'four', 'five', 'six'],
    cite: 'p.32, p.40', check: 'resist', say: 'Read: *softly*', secret: 'The cook did it', more: 'More **detail**' }] };
  await r.ctl.poll();
  const li = r.br.stub('#as-list').children[0], id = r.ctl.state().cards[0].id;
  assert.equal(li.getAttribute('data-open'), '0'); assert.equal(li.tagName, 'LI');
  const fold = byClass(li, 'as-fold')[0]; assert.equal(fold.tagName, 'BUTTON'); assert.equal(fold.getAttribute('aria-expanded'), 'false');
  assert.deepEqual([textOf(byClass(li, 'as-kind')[0]), textOf(byClass(li, 'as-text')[0])], ['⚙Rule', 'Resist the harm'], 'colour bar is the card\'s data-kind; glyph, word, headline');
  assert.equal(li.getAttribute('data-kind'), 'rule');
  r.br.click('fold', id);
  const open = r.br.stub('#as-list').children[0];
  assert.equal(open.getAttribute('data-open'), '1');
  assert.equal(byClass(open, 'as-bullets')[0].children.length, 5, 'five bullets at most');
  assert.equal(textOf(byClass(open, 'as-say')[0]), 'SAYRead: softly'); assert.equal(textOf(byClass(open, 'as-secret')[0]), 'GM ONLYThe cook did it');
  assert.equal(textOf(byClass(open, 'as-cite')[0]), 'p.32, p.40', 'the cite is a string chip'); assert.equal(textOf(byClass(open, 'as-check')[0]), 'Resist');
  const acts = byClass(open, 'as-acts')[0].children.map((c) => c.textContent);
  assert.deepEqual(acts, ['More ▾', '☆ Keep', 'Got it ×'], 'Undo is for done cards only');
  assert.equal(byClass(open, 'as-detail').length, 0, 'More is closed');
  r.br.click('more', id);
  assert.match(byClass(r.br.stub('#as-list').children[0], 'as-detail')[0].innerHTML, /More <strong>detail<\/strong>/);
  r.br.click('more', id); assert.equal(byClass(r.br.stub('#as-list').children[0], 'as-detail').length, 0);
  r.br.click('fold', id); assert.equal(r.br.stub('#as-list').children[0].getAttribute('data-open'), '0');
});

await test('safety: model text is only ever text. A tag in a headline, bullet, say, secret or the cite is literal; the only HTML written is B68Markdown\'s output', async () => {
  htmlWrites.length = 0;
  const r = rig({ markdown: MD });
  r.ctl.open();
  r.gm.reply = { ...GOOD, cards: [{ seat: 'ref', kind: 'rule', at: '2030-01-01T09:30:00.000Z', text: XSS + ' text', headline: XSS + ' head', bullets: [XSS + ' b'], say: XSS + ' say', secret: XSS + ' sec', cite: XSS, more: '# H\n' + XSS + '\n\n[x](javascript:alert(1))' }] };
  await r.ctl.poll();
  const id = r.ctl.state().cards[0].id; r.br.click('fold', id); r.br.click('more', id);
  const whole = r.br.stub('#as-now').innerHTML + r.br.stub('#as-list').innerHTML;
  assert.ok(!/<img|<script|onerror=1>/.test(whole.replace(/&lt;img[^&]*&gt;/g, '')), 'no live tag from model text: ' + whole.slice(0, 300));
  assert.ok(find(r.br.stub('#as-list'), (n) => n.tagName === 'IMG').length === 0 && find(r.br.stub('#as-now'), (n) => n.tagName === 'IMG').length === 0, 'no img node');
  assert.match(textOf(byClass(r.br.stub('#as-list').children[0], 'as-text')[0]), /^<img src=x onerror=1> head$/);
  assert.match(textOf(byClass(r.br.stub('#as-now'), 'as-text')[0]), /^<img src=x onerror=1> head$/, 'Now too');
  assert.match(textOf(byClass(r.br.stub('#as-list').children[0], 'as-secret')[0]), /<img src=x onerror=1> sec/);
  const modelWrites = htmlWrites.filter((w) => /img|onerror|sec|head/.test(w.html));
  assert.ok(modelWrites.length >= 1 && modelWrites.length <= 2, 'only `more` is written as HTML (in the feed card, and in Now): ' + JSON.stringify(modelWrites.map((w) => w.el)));
  assert.equal(r.ctl.state().renders.more, 1, 'and it was rendered once');
  assert.ok(modelWrites.every((w) => w.html === modelWrites[0].html));
  assert.equal(modelWrites[0].html, MD.render('**H**\n' + XSS + '\n\n[x](javascript:alert(1))', { headingOffset: 1 }), 'and it is exactly what B68Markdown.render returned for `more` (headings stripped)');
  assert.ok(!/javascript:/.test(modelWrites[0].html.replace(/&[a-z]+;/g, '')) || !/href="javascript/.test(modelWrites[0].html), 'no javascript: link');
  assert.ok(!/<h\d/.test(modelWrites[0].html), 'headings are stripped');
  // the strip (closed panel) shows the headline as text and never the secret
  const c = rig({ markdown: MD });
  c.gm.reply = { ...GOOD, cards: [{ seat: 'ref', kind: 'rule', at: '2030-01-01T09:30:00.000Z', text: 't', headline: XSS + ' head', secret: 'SECRET-WORDS', bullets: ['BULLET-WORDS'], say: 'SAY-WORDS' }] };
  await c.ctl.poll();
  const strip = c.br.stub('.as-banner-b'); assert.equal(strip.textContent, '⚙ Rule ' + XSS + ' head'); assert.ok(!/SECRET|BULLET|SAY-WORDS|<img/.test(strip.innerHTML.replace(/&lt;img[^&]*&gt;/, '')), 'the strip is text: ' + strip.innerHTML);
});

await test('the strip: rule and warn pop it for 8 s; every other kind only adds a pip; a restored card never pops; a warn with a secret keeps the secret out of it', async () => {
  const r = rig(); const stripText = () => r.br.stub('.as-banner-b').textContent;
  r.gm.reply = { ...GOOD, cards: [{ seat: 'clerk', at: '2030-01-01T09:00:00.000Z', text: 'n', headline: 'A note', kind: 'note' }, { seat: 'mystery', at: '2030-01-01T09:01:00.000Z', text: 'i', headline: 'An idea', kind: 'idea' }, { seat: 'fixer', at: '2030-01-01T09:02:00.000Z', text: 's', headline: 'A say', kind: 'say' }] };
  await r.ctl.poll(); assert.equal(stripText(), '', 'note, idea and say: no strip'); assert.equal(r.ctl.state().banner, '');
  assert.equal(r.ctl.state().unread, 3); assert.equal(r.br.stub('#as-pips').children.length, 3, 'a pip each');
  const id = r.ctl.addCard({ kind: 'warn', headline: 'Spend at 85%', secret: 'DO-NOT-SHOW', bullets: ['also not'] });
  assert.ok(id); assert.equal(r.br.stub('#as-banner').hidden, false, 'a warn pops'); assert.equal(r.br.stub('.as-banner-b').getAttribute('data-kind'), 'warn');
  assert.equal(r.br.stub('.as-banner-b').textContent, '⚠ Stop Spend at 85%'); assert.ok(!/DO-NOT-SHOW|also not/.test(r.br.stub('.as-banner-b').innerHTML));
  assert.ok(r.timers.some((t) => t.ms === 8000), '8 s');
  assert.equal(r.ctl.state().banner, 'Spend at 85%');
  const kinds = r.br.stub('#as-pips').children.map((p) => p.getAttribute('data-kind')); assert.deepEqual(kinds, ['warn', 'say', 'idea', 'note'], 'newest first');
  // restored cards: no strip
  const q = rig({ stored: { cards: [{ seat: 'ref', kind: 'rule', headline: 'Old slip', at: '2030-01-01T09:00:00.000Z', text: 'Old slip', seen: false }], updates: [] } }); await q.ctl.ready;
  assert.equal(q.ctl.state().banner, ''); assert.equal(q.br.stub('.as-banner-b').textContent, ''); assert.equal(q.ctl.state().unread, 1);
  // an open panel has no strip
  const o = rig(); o.ctl.open(); o.ctl.addCard({ kind: 'rule', headline: 'Open' }); assert.equal(o.ctl.state().banner, ''); assert.equal(o.br.stub('.as-banner-b').textContent, '');
});

await test('glance fields come through the tick, the restore and the marks: headline over text, kind (a stall kind is not one), cite, check; an old row is built from text and detail', async () => {
  const r = rig({ stored: { cards: [
    { seat: 'ref', kind: 'rule', at: '2030-01-01T09:00:00.000Z', text: 'T1', headline: 'H1', bullets: ['b1'], cite: 'p.9', check: 'harm', seen: true },
    { seat: 'ref', at: '2030-01-01T09:01:00.000Z', text: 'Old row full text that is long '.repeat(8), headline: 'Old row full text that is long Old row full text that is long Old row full text that is long Old row full te…', bullets: [], detail: { said_at: '22:14', rule: 'Rulebook p. 12' }, seen: true },
    { seat: 'mystery', kind: 'complication', at: '2030-01-01T09:02:00.000Z', text: 'T3', headline: 'H3', seen: true }], updates: [] } });
  await r.ctl.ready;
  const cs = r.ctl.state().cards;
  assert.deepEqual(cs.map((c) => [c.kind, c.headline.slice(0, 3), c.check, c.cite]), [['rule', 'H1', 'harm', 'p.9'], ['rule', 'Old', '', ''], ['idea', 'H3', '', '']], 'a complication/clue kind falls back to the seat\'s kind');
  assert.deepEqual(cs[1].bullets, ['Said at 22:14', 'Rulebook p. 12']); assert.ok(cs[1].more.startsWith('Old row full text'), 'a cut headline keeps the whole text under More');
  assert.equal(cs[0].text, 'T1', 'text is untouched: the marks match on it');
  r.br.click('fold', cs[0].id); assert.equal(textOf(byClass(r.br.stub('#as-list'), 'as-check')[0]), 'Harm');
  r.br.click('ack', cs[0].id); await tick(); assert.deepEqual(r.calls.marks, [{ op: 'dismiss', items: [{ at: cs[0].at, text: 'T1' }] }], 'marks use the server\'s text, not the headline');
});

await test('keyed rendering: a new card builds one node; the others are the same nodes; Markdown is rendered once per card however often the list is drawn', async () => {
  const r = rig({ markdown: MD });
  const mk = (n) => ({ seat: 'clerk', kind: 'note', at: '2030-01-01T09:0' + n + ':00.000Z', text: 'c' + n, headline: 'Card ' + n, more: 'more ' + n });
  r.gm.reply = { ...GOOD, cards: [mk(1), mk(2), mk(3)] }; await r.ctl.poll();
  const builds = () => r.ctl.state().renders.cards, nodes = () => r.br.stub('#as-list').children.slice();
  const before = nodes(), b0 = builds(); assert.equal(b0, 3);
  for (let i = 0; i < 5; i++) r.ctl.state(), r.ctl.relayout();
  r.gm.reply = { ...GOOD, cards: [mk(4)] }; await r.ctl.poll();
  assert.equal(builds(), b0 + 1, 'one new card, one build');
  const after = nodes(); assert.equal(after.length, 4); assert.deepEqual(after.slice(1), before, 'the three old nodes are the very same objects, in order');
  // open More on one card, redraw many times: one Markdown render
  const id = r.ctl.state().cards[1].id; r.br.click('fold', id); r.br.click('more', id);
  const m0 = r.ctl.state().renders.more; assert.equal(m0, 1);
  for (let i = 0; i < 4; i++) { r.gm.reply = { ...GOOD, cards: [] }; await r.ctl.poll(); }
  r.br.click('fold', id); r.br.click('fold', id); assert.equal(r.ctl.state().renders.more, 1, 'one render for the card\'s `more`');
  const untouched = nodes().filter((n) => n.getAttribute('data-id') !== id);
  r.br.click('fold', id); assert.deepEqual(nodes().filter((n) => n.getAttribute('data-id') !== id), untouched, 'folding one card leaves the others as they were');
  // a filter swaps the nodes shown but rebuilds none
  const b1 = builds(), keptNodes = nodes().slice();
  r.br.click('chip', '', 'clerk'); assert.equal(nodes().length, 4, 'all four are clerk cards: nothing filtered out'); r.br.click('chip', '', 'rule');
  assert.deepEqual(nodes().map((n) => n.className), ['as-empty'], 'Rule shows none of them (there are no rule cards): the filter really ran');
  assert.equal(r.br.stub('#as-chips').children.find((c) => c.getAttribute('data-k') === 'rule').getAttribute('aria-pressed'), 'true');
  r.br.click('chip', '', 'all'); assert.deepEqual(nodes(), keptNodes, 'back on All the very same nodes return'); assert.equal(builds(), b1, 'and no card was rebuilt by any of it');
});

await test('the divider: "Earlier tonight" once, after 30 minutes; filters show counts and keep the node set', async () => {
  const old = new Date(Date.now() - 50 * 60000).toISOString(), fresh = new Date().toISOString();
  const r = rig({ stored: { cards: [{ seat: 'clerk', at: old, text: 'old', headline: 'Old one', seen: true }, { seat: 'ref', kind: 'rule', at: fresh, text: 'new', headline: 'New one', seen: true }], updates: [] } });
  await r.ctl.ready;
  const kids = r.br.stub('#as-list').children; assert.deepEqual(kids.map((k) => k.className), ['as-card', 'as-earlier', 'as-card']);
  assert.equal(kids[1].textContent, 'Earlier tonight'); assert.equal(kids[1].getAttribute('role'), 'separator');
  assert.match(r.br.stub('#as-chips').innerHTML, /data-k="rule"[^>]*aria-pressed="false">Rule <span class="as-chip-n">1<\/span>/);
  r.br.click('chip', '', 'rule'); assert.deepEqual(r.br.stub('#as-list').children.map((k) => k.className), ['as-card'], 'Rule: the one rule card, no divider (it is not older)');
  assert.equal(r.br.stub('#as-list').children[0].getAttribute('data-kind'), 'rule');
  r.br.click('chip', '', 'all'); assert.equal(r.br.stub('#as-list').children.length, 3);
});

await test('Now: the card is one type step larger (CSS), shows the same fields, and leaves after 1.5 s (marked) or when a newer card arrives (the older is marked then)', async () => {
  const r = rig(); r.ctl.open();
  r.gm.reply = { ...GOOD, cards: [{ seat: 'ref', kind: 'rule', at: 'a1', text: 'one', headline: 'First', bullets: ['x'] }] }; await r.ctl.poll();
  const now = () => r.br.stub('#as-now').children[0];
  assert.equal(now().className, 'as-card as-now-card'); assert.equal(now().tagName, 'DIV'); assert.equal(now().getAttribute('data-open'), '1'); assert.match(now().innerHTML, /First/); assert.match(now().innerHTML, /<li>x<\/li>/);
  assert.equal(r.calls.marks.length, 0);
  r.gm.reply = { ...GOOD, cards: [{ seat: 'clerk', kind: 'note', at: 'a2', text: 'two', headline: 'Second' }] }; await r.ctl.poll(); await tick();
  assert.match(now().innerHTML, /Second/); assert.ok(!/First/.test(r.br.stub('#as-now').innerHTML));
  assert.deepEqual(r.calls.marks, [{ op: 'seen', items: [{ at: 'a1', text: 'one' }] }], 'the newer card took Now, so the first was marked then');
  r.ctl.close(); await tick(); assert.equal(r.ctl.state().unread, 1, 'closed before 1.5 s: the second card was not in view long enough, still unread');
  r.ctl.open(); assert.match(now().innerHTML, /Second/, 'and it is Now again');
  const css = fs.readFileSync(path.join(ROOT, 'app', 'gm.css'), 'utf8');
  assert.match(css, /\.as-card\.as-now-card\[data-open\] \.as-text \{[^}]*font-size: 19px/); assert.match(css, /\.as-card\[data-open="1"\] \.as-text \{[^}]*font-size: 17px/);
  assert.match(css, /\.as-detail \{[^}]*max-height: calc\(var\(--as-h\) \* \.4\)/); assert.match(css, /\.as-card \{[^}]*max-height: calc\(var\(--as-h\) - 24px\)/);
});

await test('page-made cards: addCard / updateCard / undoNewest; no server mark is ever sent for one; Undo needs a handler', async () => {
  const r = rig(); r.ctl.open();
  let undone = 0;
  const id = r.ctl.addCard({ kind: 'done', headline: 'Clock made: Alarm', bullets: ['heard at 22:14'], undo: () => { undone++; } });
  assert.ok(id); assert.equal(r.ctl.state().cards.length, 1);
  assert.equal(r.ctl.addCard({ headline: '' }), ''); assert.equal(r.ctl.addCard(null), ''); assert.equal(r.ctl.addCard({ kind: 'bogus', headline: 'x' }) !== '', true);
  assert.equal(r.ctl.state().cards[1].kind, 'note', 'an unknown kind is a note');
  const open = (c) => { r.br.click('fold', c); return byClass(r.br.stub('#as-list'), 'as-card').filter((n) => n.getAttribute('data-id') === c)[0]; };
  const li = open(id); assert.deepEqual(byClass(li, 'as-acts')[0].children.map((c) => c.textContent), ['☆ Keep', 'Undo', 'Got it ×']);
  assert.ok(r.ctl.updateCard(id, { headline: 'Clock made: Alarm (6)', bullets: ['a', 'b'] })); assert.match(r.br.stub('#as-list').innerHTML, /Alarm \(6\)/);
  assert.equal(r.ctl.updateCard('nope', {}), false);
  assert.deepEqual(await r.ctl.undoNewest(), { id }); assert.equal(undone, 1);
  assert.equal(await r.ctl.undoNewest(), null, 'done once'); assert.match(r.br.stub('#as-list').innerHTML, /Undone/); assert.ok(!/data-as="undo"/.test(r.br.stub('#as-list').innerHTML));
  const id2 = r.ctl.addCard({ kind: 'done', headline: 'No handler' }); r.br.click('fold', id2); assert.ok(!/data-as="undo"/.test(byClass(r.br.stub('#as-list'), 'as-card').filter((n) => n.getAttribute('data-id') === id2)[0].innerHTML));
  r.br.click('keep', id); r.br.click('ack', id); await tick(); await tick();
  assert.equal(r.calls.marks.length, 0, 'a page card is not in the server\'s log: no mark');
  assert.equal(r.notes.length, 1, 'but Keep still files a Moment');
  const f = rig(); let n = 0; const fid = f.ctl.addCard({ kind: 'done', headline: 'Fails', undo: async () => { n++; throw new Error('x'); } });
  assert.deepEqual(await f.ctl.undoNewest(), { error: 'undo' }); assert.match(f.br.stub('#as-list').innerHTML, /Fails/);
  assert.ok(typeof r.ctl.addCard === 'function' && typeof r.ctl.updateCard === 'function' && typeof r.ctl.undoNewest === 'function');
});

await test('seen marks go out as one batch: opening with 3 unread sends one request of 2; two cards arriving while open send the older at once, and Now\'s card is read after 1.5 s', async () => {
  const mk = (n) => ({ seat: 'clerk', kind: 'note', at: '2030-01-01T09:0' + n + ':00.000Z', text: 't' + n, headline: 'H' + n, seen: false });
  const r = rig({ stored: { cards: [mk(1), mk(2), mk(3)], updates: [] } }); await r.ctl.ready;
  r.ctl.open(); await tick();
  assert.equal(r.calls.marks.length, 1, 'one POST, not one per card'); assert.equal(r.calls.marks[0].op, 'seen'); assert.deepEqual(r.calls.marks[0].items.map((i) => i.text), ['t1', 't2']);
  r.timers.filter((x) => x.ms === 1500).pop().f(); await tick();
  assert.equal(r.calls.marks.length, 2); assert.deepEqual(r.calls.marks[1].items.map((i) => i.text), ['t3']); assert.equal(r.ctl.state().unread, 0);
  // two arrive together while the panel is open: the newest is Now, the older is in the feed and is read at once; Now's previous card goes in the same request
  r.gm.reply = { ...GOOD, cards: [{ ...mk(4), text: 't4' }, { ...mk(5), text: 't5' }] }; await r.ctl.poll(); await tick();
  assert.equal(r.calls.marks.length, 3); assert.deepEqual(r.calls.marks[2].items.map((i) => i.text), ['t4']); assert.equal(r.ctl.state().unread, 1, 'only Now\'s card is unread');
  r.ctl.close(); assert.equal(r.ctl.state().unread, 1, 'closed before 1.5 s: still unread');
});

await test('every method the panel returned before P3 is still returned', () => {
  const r = rig(); for (const m of ['ready', 'open', 'close', 'toggle', 'isOpen', 'pin', 'isPinned', 'undoNewest', 'relayout', 'poll', 'resume', 'fit', 'canFit', 'autoFit', 'canAnother', 'another', 'canScreen', 'screenMake', 'ask', 'canAsk', 'state', 'el', 'destroy', 'addCard', 'updateCard']) assert.ok(m in r.ctl, m);
});

await test('the fallback: without B68Markdown `more` is plain text in the card, never HTML', async () => {
  const r = rig({ markdown: null }); const W0 = A.create; htmlWrites.length = 0;
  r.gm.reply = { ...GOOD, cards: [{ seat: 'clerk', at: 'z', text: 't', headline: 'h', more: '<b>bold</b> line' }] }; await r.ctl.poll();
  const id = r.ctl.state().cards[0].id; r.br.click('fold', id); r.br.click('more', id);
  const det = byClass(r.br.stub('#as-list'), 'as-detail')[0]; assert.equal(det.textContent, '<b>bold</b> line'); assert.equal(htmlWrites.filter((w) => /bold/.test(w.html)).length, 0);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
