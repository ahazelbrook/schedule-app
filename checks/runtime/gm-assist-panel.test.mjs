// Unit test for the GM page's Claude box (app/gm/assist-panel.js; "Claude at the table", Phase 1 UI): the pure helpers (error kinds,
// the five lines, folding a tick answer in with the `after` cursor and de-duplication) and the box itself on a small fake DOM with a
// FAKE gm api: no network, no key, no real call. Also the wiring in gm-page.js (key A, mounted on ready, destroyed on close) and the
// static promises: GM bundle only, nothing stored, no call but stt / assistTick / assistFit. Every sentence below is invented.
//   node checks/runtime/gm-assist-panel.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

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
  const stub = (sel) => els[sel] || (els[sel] = {
    sel, hidden: false, textContent: '', innerHTML: '', disabled: false, attrs: {}, cls: {}, focused: 0, value: '',
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
    classList: { toggle(c, on) { els[sel].cls[c] = !!on; } }, focus() { this.focused++; },
  });
  const listeners = {}, docListeners = {};
  const host = {
    className: '', innerHTML: '', parentNode: null, listeners,
    setAttribute() {}, addEventListener(t, f) { listeners[t] = f; }, contains() { return true; },
    querySelector(sel) { return sel === 'input[name="as-pos"]:checked' ? (host.pos === undefined ? null : { value: host.pos }) : stub(sel); },
  };
  host.pos = 'risky';
  const doc = {
    hidden: false, activeElement: null,
    createElement() { return host; },
    body: { appendChild(e) { e.parentNode = doc.body; doc.appended = e; }, removeChild(e) { e.parentNode = null; doc.removed = e; } },
    addEventListener(t, f) { docListeners[t] = f; }, removeEventListener(t) { delete docListeners[t]; },
  };
  const win = { matchMedia: () => ({ matches: phone }) };
  const click = (a, id) => listeners.click({ target: { closest: () => ({ getAttribute: (k) => (k === 'data-as' ? a : k === 'data-id' ? id : null) }) } });
  return { doc, win, host, stub, click, listeners, docListeners };
}
const GOOD = { cards: [], updates: [], flags: [], spend: { tonight: 1.234, cap: 20, tier: 'all', tick: 0.01 }, last: 10 };
function rig(over = {}, brOpts) {
  const br = fakeBrowser(brOpts), calls = { stt: 0, tick: [], fit: [] };
  const timers = [];
  const gm = {
    stt: async () => { calls.stt++; return { doc: { want: gm.want } }; }, want: 'on',
    assistTick: async (after) => { calls.tick.push(after); if (gm.tickErr) throw gm.tickErr; return gm.reply || GOOD; },
    assistFit: async (req) => { calls.fit.push(req); if (gm.fitErr) throw gm.fitErr; return gm.fitReply; },
  };
  // anything else on the api (state, display, ambient, transcript...) fails the test: the box has no business there
  const api = new Proxy(gm, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' && !['then', 'toJSON'].includes(k) ? () => { throw new Error('the box called gm.' + k); } : undefined)) });
  const notes = [];
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

await test('a card: the count, the banner (12 s, click opens), the bubble with its cite, then Got it removes it', async () => {
  const r = rig();
  r.gm.reply = { ...GOOD, cards: [{ seat: 'ref', at: '2026-01-01T00:10:00Z', text: 'No harm penalty inside a score <b>', detail: { said_at: '22:14', rule: 'p. 152' } }] };
  await r.ctl.poll();
  assert.equal(r.ctl.state().unread, 1);
  assert.equal(r.br.stub('#as-count').textContent, '1'); assert.equal(r.br.stub('#as-count').hidden, false);
  assert.equal(r.br.stub('#as-banner').hidden, false, 'the banner is up');
  assert.match(r.br.stub('.as-banner-b').innerHTML, /Rule slip/);
  assert.ok(r.timers.some((t) => t.ms === 12000), 'it dismisses itself after 12 s');
  assert.match(r.br.stub('#as-list').innerHTML, /p\. 152/, 'the page cite shows');
  assert.ok(!/<b>/.test(r.br.stub('#as-list').innerHTML.replace(/<b>[^<]*<\/b>/g, '')), 'card text is escaped');
  assert.match(r.br.stub('#as-list').innerHTML, /&lt;b&gt;/);
  r.timers.find((t) => t.ms === 12000).f(); assert.equal(r.br.stub('#as-banner').hidden, true);
  r.gm.reply = { ...GOOD, cards: [{ seat: 'clerk', at: '2026-01-01T00:20:00Z', text: 'A new name came up.' }] }; await r.ctl.poll();
  r.br.click('banner'); assert.equal(r.ctl.state().open, true, 'a click on the banner opens the box');
  assert.equal(r.ctl.state().unread, 0); assert.equal(r.br.stub('#as-count').hidden, true);
  assert.equal(r.br.stub('#as-banner').hidden, true);
  const id = r.ctl.state().cards[0].id; r.br.click('ack', id);
  assert.equal(r.ctl.state().cards.length, 1, 'Got it dismisses that card only');
});

await test('no banner while the box is open; a card that arrives then is already read', async () => {
  const r = rig(); r.ctl.open();
  r.gm.reply = { ...GOOD, cards: [{ seat: 'ref', at: 'a', text: 'Slip.' }] }; await r.ctl.poll();
  assert.equal(r.br.stub('#as-banner').hidden !== false, true); assert.equal(r.ctl.state().unread, 0);
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
  assert.deepEqual([...new Set([...src.matchAll(/\bgm\.(\w+)/g)].map((m) => m[1]))].sort(), ['assistFit', 'assistTick', 'stt']);
  assert.ok(!/localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest|setDisplay|patchState|patchAmbient|patchStt|sendBeacon|eval\(|innerHTML\s*=\s*[^'"(\s]*\bc\.text/.test(src), 'no storage, no network, no display or state write');
  const page = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  const m = /function mountAssist\(\) \{[\s\S]*?\n  \}\n/.exec(page);
  assert.ok(m && /isGM|status === 'ready'|start\(\)/.test(page) && !/pushDisplay|setDisplay/.test(m[0]), 'mountAssist writes nothing to the display');
  assert.ok(/mountAssist\(\);\s*\n\s*layout\(\)/.test(page), 'it is mounted from start(), which only a GM with a pack reaches');
  assert.ok(/me\.assist\.destroy\(\)/.test(page), 'close() destroys it');
});

await test('the gm adapter has assistTick (POST, cursor only when known) and assistFit', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'runtime', 'cf.js'), 'utf8');
  assert.ok(/assistTick: function \(after\) \{ return api\('POST', '\/gm\/assist\/tick'/.test(src));
  assert.ok(/assistFit: function \(req\) \{ return api\('POST', '\/gm\/assist\/fit'/.test(src));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
