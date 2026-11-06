// Unit test for the band (app/gm/band.js, the GM night rebuild N1a): the pure part (the places, the chips' minutes and states, the clock, the
// curfew line, Ctrl+arrow steps) and the band itself on a small fake page: the skeleton, the chips (selected and now), the curfew's red row and its
// three buttons, PANIC, the work light, the tray's stand-in or the tray module, the quiet slot, the Esc entries it registers and takes down.
// No browser, no network. Invented content only.
//   node checks/runtime/gm-band.test.mjs
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const Band = require(path.join(ROOT, 'app', 'gm', 'band.js'));
const Night = require(path.join(ROOT, 'app', 'gm', 'night.js'));

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const MIN = 60000;
const plain = (x) => JSON.parse(JSON.stringify(x));      /* a value from the band's own realm (vm), as this file's */
const T0 = new Date(2026, 10, 7, 21, 0, 0).getTime();          /* a Saturday, 21:00 */
const at = (h, m) => new Date(2026, 10, 7, h, m, 0).getTime();

/* ---------- 1. the pure part ---------- */
await test('placeList: the six places of the night and Between when no registry is on the page; a registry\'s list when it gives one; a broken one falls back', () => {
  const p = Band.placeList({});
  assert.deepEqual(p.list.map((x) => x.id), ['before', 'opening', 'pb', 'plan', 'score', 'after']);
  assert.deepEqual(p.list.map((x) => x.label), ['Before', 'Opening', 'Personal', 'Planning', 'Score', 'Aftermath']);
  assert.deepEqual(p.list.map((x) => x.phase), [null, null, 'pb', 'plan', 'score', 'after']);
  assert.deepEqual(p.between, { id: 'between', label: 'Between', phase: null });
  const reg = { list: () => [{ id: 'before', label: 'Before' }, { id: 'score', label: 'The score', phase: 'score' }, { id: 'between', label: 'no' }, { id: 'BAD id' }], between: () => ({ id: 'between', label: 'Between' }) };
  assert.deepEqual(Band.placeList(reg).list, [{ id: 'before', label: 'Before', phase: null }, { id: 'score', label: 'The score', phase: 'score' }], 'its own list, Between kept apart, a bad id dropped');
  assert.deepEqual(Band.placeList({ list: () => { throw new Error('x'); } }).list.length, 6, 'a registry that throws: the six');
  assert.deepEqual(Band.placeList({ list: () => [] }).list.length, 6, 'an empty list: the six');
});

await test('chips: a phase shows minutes / budget; done is struck, now carries its tone (amber at 80%, red when over); next shows its budget; the selected place is the one on screen, not the phase', () => {
  const night = Night.clean({ phase: 'score', phases: { pb: { budget: 30, start: T0 - 100 * MIN, end: T0 - 64 * MIN }, plan: { budget: 25, start: T0 - 64 * MIN, end: T0 - 41 * MIN }, score: { budget: 50, start: T0 - 41 * MIN }, after: { budget: 25 } } });
  const cs = Band.chips({ places: Band.placeList({}), night, budgets: null, start: '19:30', started: true, now: T0, current: 'plan' });
  const by = Object.fromEntries(cs.map((c) => [c.id, c]));
  assert.deepEqual(cs.map((c) => c.id), ['before', 'opening', 'pb', 'plan', 'score', 'after', 'between']);
  assert.deepEqual([by.pb.state, by.pb.text, by.pb.tone], ['done', '36/30', 'red'], 'a done phase over its budget is red');
  assert.deepEqual([by.plan.state, by.plan.text, by.plan.tone], ['done', '23/25', ''], 'done inside its budget: no tone');
  assert.deepEqual([by.score.state, by.score.text, by.score.tone], ['now', '41/50', 'amber'], '41 of 50 is past 80%');
  assert.deepEqual([by.after.state, by.after.text], ['next', '–/25']);
  assert.equal(by.plan.selected, true, 'Planning is on screen'); assert.equal(by.score.selected, false, 'while the night is in the Score');
  assert.deepEqual([by.before.text, by.opening.text, by.between.text, by.between.between], ['start 19:30', 'titles', 'sessions', true]);
  assert.equal(Band.chips({ places: Band.placeList({}), night, start: '19:30', started: false, now: T0, current: 'before' })[0].text, 'to 19:30', 'before the start: "to"');
  const red = Band.chips({ places: Band.placeList({}), night, now: T0 + 10 * MIN, current: 'score' }).find((c) => c.id === 'score');
  assert.deepEqual([red.text, red.tone], ['51/50', 'red']);
  assert.equal(by.score.title, 'Score: the night is here, 41 of 50 min, nearly at budget. Tap to go there'); assert.equal(by.plan.title, 'Planning: done, 23 of 25 min. On screen');
  assert.equal(by.after.title, 'Aftermath: to come, a 25 min budget. Tap to go there'); assert.equal(by.pb.title, 'Personal Business: done, 36 of 30 min, over budget. Tap to go there');
});

await test('chips: before the first phase, the prep note\'s budgets stand in; no budget at all is an empty line, never "null"', () => {
  const cs = Band.chips({ places: Band.placeList({}), night: Night.clean({}), budgets: { pb: 40, plan: null, score: 90, after: 25 }, now: T0, current: 'before' });
  assert.deepEqual(cs.filter((c) => c.phase).map((c) => [c.state, c.text]), [['next', '–/40'], ['next', ''], ['next', '–/90'], ['next', '–/25']]);
  assert.ok(!cs.map((c) => c.text + ' ' + c.title).join(' | ').match(/null|undefined|NaN/), JSON.stringify(cs));
});

await test('chipHtml: a phase chip carries data-state and its tone; aria-current marks the place on screen; names are escaped', () => {
  const h = Band.chipHtml({ id: 'score', label: 'Score', phase: 'score', between: false, selected: true, state: 'now', tone: 'red', text: '51/50', title: '<b>' });
  assert.ok(/data-band-place="score"/.test(h) && /data-state="now"/.test(h) && /data-tone="red"/.test(h) && /aria-current="true"/.test(h));
  assert.ok(!/<b>/.test(h) && /&lt;b&gt;/.test(h), 'the title is escaped');
  const b = Band.chipHtml({ id: 'between', label: 'Between', phase: null, between: true, selected: false, state: '', tone: '', text: 'sessions', title: '' });
  assert.ok(/gm-place-btw/.test(b) && !/data-state/.test(b) && /aria-current="false"/.test(b));
});

await test('clockText and curfewText: HH:MM; "58 min" before, "now" in its minute, "N min over" after, and only the time when it is half a day away', () => {
  assert.equal(Band.clockText(at(21, 7)), '21:07'); assert.equal(Band.clockText(at(9, 5)), '09:05');
  assert.equal(Band.curfewText('22:40', at(22, 40), at(21, 42)), 'curfew 22:40 · 58 min');
  assert.equal(Band.curfewText('22:40', at(22, 40), at(22, 39) + 30000), 'curfew 22:40 · 1 min');
  assert.equal(Band.curfewText('22:40', at(22, 40), at(22, 40) + 20000), 'curfew 22:40 · now');
  assert.equal(Band.curfewText('22:40', at(22, 40), at(22, 52)), 'curfew 22:40 · 12 min over');
  assert.equal(Band.curfewText('22:40', at(22, 40) + 86400000, at(21, 0)), 'curfew 22:40', 'tomorrow\'s curfew: the time alone');
  assert.equal(Band.curfewText('', null, at(21, 0)), ''); assert.equal(Band.curfewText('22:40', null, at(21, 0)), '');
});

await test('step: Ctrl+Left / Ctrl+Right walk the night one place at a time, Between last, never past either end', () => {
  const P = Band.placeList({});
  assert.equal(Band.step(P, 'score', -1), 'plan'); assert.equal(Band.step(P, 'score', 1), 'after'); assert.equal(Band.step(P, 'after', 1), 'between');
  assert.equal(Band.step(P, 'between', 1), 'between'); assert.equal(Band.step(P, 'before', -1), 'before'); assert.equal(Band.step(P, 'nowhere', 1), 'opening', 'an unknown place starts from Before');
});

/* ---------- 2. the band on a fake page ---------- */
const VOID = new Set(['input', 'br', 'img', 'hr']);
const decode = (s) => s.replace(/&(#\d+|amp|lt|gt|quot|#39);/g, (m, e) => (e[0] === '#' ? String.fromCodePoint(+e.slice(1)) : { amp: '&', lt: '<', gt: '>', quot: '"' }[e]));
function parseSel(sel) {
  return sel.split(',').map((part) => part.trim().split(/\s+/).map((c) => {
    const o = { tag: null, id: null, cls: [], attrs: [] }; let m; const re = /^([a-z][a-z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/i; let rest = c;
    while (rest && (m = re.exec(rest))) { if (m[1]) o.tag = m[1].toUpperCase(); else if (m[2]) o.id = m[2]; else if (m[3]) o.cls.push(m[3]); else o.attrs.push([m[4], m[5]]); rest = rest.slice(m.index + m[0].length); }
    return o;
  }));
}
function matches(el, c) {
  if (c.tag && el.tagName !== c.tag) return false; if (c.id && el.getAttribute('id') !== c.id) return false;
  const cl = (el.getAttribute('class') || '').split(/\s+/); if (c.cls.some((x) => !cl.includes(x))) return false;
  return c.attrs.every(([k, v]) => el.hasAttribute(k) && (v === undefined || el.getAttribute(k) === v));
}
function matchPath(el, p, scope) {
  if (!matches(el, p[p.length - 1])) return false;
  let i = p.length - 2, n = el.parentNode;
  while (i >= 0) { while (n && n !== scope && !matches(n, p[i])) n = n.parentNode; if (!n || n === scope) return false; i--; n = n.parentNode; }
  return true;
}
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.nodeType = 1; this.attrs = new Map(); this.kids = []; this.parentNode = null; this.ls = {}; this._h = ''; this.style = { props: {}, setProperty(k, v) { this.props[k] = v; } }; }
  get hidden() { return this.attrs.has('hidden'); } set hidden(v) { if (v) this.attrs.set('hidden', ''); else this.attrs.delete('hidden'); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; } setAttribute(k, v) { this.attrs.set(k, String(v)); } hasAttribute(k) { return this.attrs.has(k); } removeAttribute(k) { this.attrs.delete(k); }
  get textContent() { return this.kids.map((k) => (k.nodeType === 3 ? k.text : k.textContent)).join(''); } set textContent(v) { this.kids = [{ nodeType: 3, text: String(v) }]; }
  set innerHTML(h) { this.kids = []; this._h = String(h); parse(this, this._h); } get innerHTML() { return this._h; }
  appendChild(n) { n.parentNode = this; this.kids.push(n); return n; }
  addEventListener(t, fn) { (this.ls[t] = this.ls[t] || []).push(fn); }
  contains(n) { for (let p = n; p; p = p.parentNode) if (p === this) return true; return false; }
  closest(sel) { const alts = parseSel(sel); for (let p = this; p && p.nodeType === 1; p = p.parentNode) if (alts.some((a) => a.length === 1 && matches(p, a[0]))) return p; return null; }
  querySelectorAll(sel) { const alts = parseSel(sel), out = []; const walk = (n) => { for (const k of n.kids) if (k.nodeType === 1) { if (alts.some((a) => matchPath(k, a, this))) out.push(k); walk(k); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  getBoundingClientRect() { return { top: 0, bottom: 88, left: 0, right: 1366, width: 1366, height: 88 }; }
  click() { const ev = { type: 'click', target: this }; for (let n = this; n; n = n.parentNode) for (const fn of (n.ls && n.ls.click) || []) fn(ev); }
}
function parse(root, html) {
  const re = /<\/([a-z0-9-]+)\s*>|<([a-z][a-z0-9-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*\/?>|([^<]+)/gi; let m; const stack = [root];
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) { top.kids.push({ nodeType: 3, text: decode(m[4]), parentNode: top }); continue; }
    if (m[1]) { for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName.toLowerCase() === m[1].toLowerCase()) { stack.length = i; break; } continue; }
    const el = new El(m[2]); el.parentNode = top; top.kids.push(el);
    for (const a of m[3].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g)) el.attrs.set(a[1], decode(a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : ''));
    if (!VOID.has(m[2].toLowerCase())) stack.push(el);
  }
}
/* the band's window: the Esc registry, the night module, the curfew and the rail as the GM bundle has them, a clock the test moves */
function world(over = {}) {
  const W = { setTimeout, clearTimeout, console, Date, JSON, Math, Object, Array, String, Number, isFinite, document: { hidden: false, addEventListener() {}, removeEventListener() {} } };
  W.self = W; W.window = W;
  const ctx = vm.createContext(W);
  for (const f of ['gm/esc.js', 'gm/prep.js', 'gm/night.js', 'gm/phase-rail.js', 'gm/curfew.js', 'gm/band.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', f), 'utf8'), ctx, { filename: f });
  Object.assign(W, over);
  return W;
}
function page(W, o = {}) {
  const clock = { t: o.t || T0 }, state = { doc: { night: o.night || {} } }, calls = [];
  const N = W.B68GmNight.create({ doc: () => state.doc, patch: (p) => { state.doc = { night: W.B68GmNight.clean(Object.assign({}, state.doc.night, p.night, { phases: Object.assign({}, (state.doc.night || {}).phases, p.night && p.night.phases) })) }; return true; }, now: () => clock.t });
  let mem = null;
  const curfew = W.B68GmCurfew.create({ root: () => null, night: () => N, now: () => clock.t, toast() {}, store: { get: () => mem, set: (v) => { mem = v; } }, callAftermath: () => { calls.push(['callAftermath']); return true; } });
  const cueView = { panic: 0 };
  const cue = { view: () => cueView, moreOpen: () => !!cueView.more, closeMore: () => { calls.push(['closeMore']); cueView.more = false; } };
  const rootEl = new El('div');
  const host = {
    root: () => rootEl, night: () => N, prep: () => o.prep || null, now: () => clock.t,
    currentPlace: () => o.current || N.phase() || 'before', goPlace: (id, opts) => { calls.push(['goPlace', id, opts]); },
    callAftermath: () => calls.push(['callAftermath']), openView: (id) => calls.push(['openView', id]),
    curfew: () => curfew, cue: () => cue, panic: () => { calls.push(['panic']); cueView.panic = clock.t; },
    menuHtml: () => '<a href="#display">Open the display page</a><button type="button" data-gm="forget">Forget</button>', signedOut: () => 'Signed out: reload to sign in.'
  };
  const hdr = new El('header'); hdr.setAttribute('id', 'gm-band');
  const band = W.B68GmBand.create(host); band.mount(hdr);
  return { band, hdr, host, clock, N, calls, curfew, cueView, rootEl, q: (s) => hdr.querySelector(s), qa: (s) => hdr.querySelectorAll(s), mem: () => mem };
}
const SCORE_NIGHT = { phase: 'score', curfewAt: '22:40', startAt: '19:30', phases: { pb: { budget: 30, start: T0 - 100 * MIN, end: T0 - 64 * MIN }, plan: { budget: 25, start: T0 - 64 * MIN, end: T0 - 41 * MIN }, score: { budget: 90, start: T0 - 41 * MIN } } };

await test('mount: one header, two rows: the mark, the session, the places, Find, Crew and the Menu; the clock, the curfew, the beat, the tray, the mic, the cue, the quiet slot and PANIC last', () => {
  const W = world(), p = page(W, { night: SCORE_NIGHT });
  const r1 = p.q('.gm-band-r1'), r2 = p.q('.gm-band-r2');
  assert.ok(r1 && r2 && p.hdr.kids.filter((k) => k.nodeType === 1).length === 2, 'two rows');
  for (const sel of ['.gm-band-mark', '#gm-bar-sess', '[data-band-places]', '.gm-save', '[data-gm="find-open"]', '#gm-bar-drawer', '[data-gm="menu"]', '.gm-menu-list', '#gm-bar-exp']) assert.ok(r1.querySelector(sel), 'row 1: ' + sel);
  for (const sel of ['[data-band-clock]', '[data-band-curfew]', '[data-band-due]', '#gm-bar-beat', '[data-band-slot="tray"]', '#gm-bar-stt', '#gm-cuebar', '[data-band-slot="quiet"]', '#gm-signed', '[data-band="panic"]']) assert.ok(r2.querySelector(sel), 'row 2: ' + sel);
  const r2kids = r2.kids.filter((k) => k.nodeType === 1); assert.equal(r2kids[r2kids.length - 1].getAttribute('data-band'), 'panic', 'PANIC is always the last item');
  assert.ok(/PANIC/.test(p.q('[data-band="panic"]').textContent) && p.q('[data-band="panic"] kbd').textContent === 'Esc', 'PANIC with its Esc badge');
  assert.ok(/Find/.test(p.q('[data-gm="find-open"]').textContent) && p.q('[data-gm="find-open"] kbd').textContent === 'Ctrl K', 'Find with Ctrl K');
  assert.equal(p.q('#gm-bar-drawer').textContent, 'Crew');
  assert.equal(p.q('.gm-menu-list').hasAttribute('hidden'), true, 'the Menu starts shut'); assert.ok(p.q('.gm-menu-list [data-gm="forget"]'), 'the page\'s lines are in it');
  assert.ok(p.q('#gm-bar-ipad') && /^Clear/.test(p.q('[data-gm="blankipad"]').textContent) && p.q('[data-gm="blankipad"] kbd').textContent === '0' && /Blank/.test(p.q('[data-gm="darkipad"]').textContent) && p.q('#gm-bar-ap'),
    'no tray module on the page: today\'s iPad pill, Clear 0, Blank and the autopilot pill');
  assert.equal(p.q('[data-band-clock]').textContent, '21:00'); assert.equal(p.q('[data-band-curfew]').textContent, 'curfew 22:40 · 100 min');
  assert.equal(p.rootEl.style.props['--dw-top'], '88px', 'the drawer and the sheets open under the band'); assert.equal(p.rootEl.style.props['--gm-bar-h'], '88px');
  p.band.destroy();
});

await test('the chips: the night\'s phase is now, the place on screen is selected; a tap goes to the place through the host; the band redraws them only when they change', () => {
  const W = world(), p = page(W, { night: SCORE_NIGHT, current: 'plan' });
  const chip = (id) => p.q('[data-band-place="' + id + '"]');
  assert.equal(p.qa('[data-band-place]').length, 7, 'six places and Between');
  assert.equal(chip('score').getAttribute('data-state'), 'now'); assert.equal(chip('score').getAttribute('aria-current'), 'false');
  assert.equal(chip('plan').getAttribute('aria-current'), 'true'); assert.equal(chip('plan').getAttribute('data-state'), 'done');
  assert.equal(chip('pb').getAttribute('data-tone'), 'red', 'Personal ran over'); assert.equal(chip('before').hasAttribute('data-state'), false, 'Before is not a phase');
  assert.equal(chip('score').querySelector('.gm-place-t').textContent, '41/90');
  const html = p.q('[data-band-places]').innerHTML; p.band.update(); assert.equal(p.q('[data-band-places]').innerHTML, html, 'nothing moved: the same drawing');
  chip('after').click(); assert.deepEqual(plain(p.calls.pop()), ['goPlace', 'after', {}], 'a tap asks the host to go there');
  chip('between').click(); assert.deepEqual(plain(p.calls.pop()), ['goPlace', 'between', {}]);
  p.clock.t += 10 * MIN; p.band.update(); assert.equal(p.q('[data-band-place="score"] .gm-place-t').textContent, '51/90', 'the minutes move with the clock');
  p.band.destroy();
});

await test('the curfew: due turns row 2 red with Call the Aftermath, Keep running and Snooze 10 min; Snooze is offered once; Keep running calms it; Call goes through the host', () => {
  const W = world(), p = page(W, { night: SCORE_NIGHT, t: at(22, 41) });
  const r2 = p.q('.gm-band-r2');
  assert.equal(r2.getAttribute('data-alarm'), 'curfew'); assert.equal(p.q('[data-band-due]').hasAttribute('hidden'), false);
  assert.equal(p.q('[data-band-curfew]').textContent, '1 min over', 'due: the red row says the rest, the words say how late'); assert.ok(/22:40/.test(p.q('[data-band-curfew]').getAttribute('title')));
  assert.deepEqual(p.qa('[data-band-due] button').map((b) => b.textContent), ['Call the Aftermath', 'Keep running', 'Snooze 10 min']);
  p.q('[data-band="snooze"]').click(); assert.equal(r2.getAttribute('data-alarm'), '', 'snoozed: the row is calm');
  p.clock.t = at(22, 52); p.band.update(); assert.equal(r2.getAttribute('data-alarm'), 'curfew', 'due again after ten minutes');
  assert.equal(p.q('[data-band="snooze"]').hasAttribute('hidden'), true, 'and the snooze is spent');
  p.q('[data-band="call"]').click(); assert.deepEqual(p.calls.filter((c) => c[0] === 'callAftermath').length, 1, 'Call the Aftermath asks the host');
  p.q('[data-band="keep"]').click(); assert.equal(r2.getAttribute('data-alarm'), '', 'Keep running: not due any more tonight');
  p.band.destroy();
  const q = page(world(), { night: SCORE_NIGHT, t: at(22, 0) }); assert.equal(q.q('.gm-band-r2').getAttribute('data-alarm'), ''); assert.equal(q.q('[data-band-due]').hasAttribute('hidden'), true, 'not due: no buttons'); q.band.destroy();
});

await test('PANIC: the band\'s last button calls the host\'s panic, with or without cues; the work light turns row 2 red until it is resumed', () => {
  const W = world(), p = page(W, { night: SCORE_NIGHT });
  p.q('[data-band="panic"]').click(); assert.deepEqual(plain(p.calls.pop()), ['panic']);
  assert.equal(p.q('.gm-band-r2').getAttribute('data-alarm'), 'panic'); assert.equal(p.q('[data-band="panic"]').getAttribute('aria-pressed'), 'true');
  p.cueView.panic = 0; p.band.update(); assert.equal(p.q('.gm-band-r2').getAttribute('data-alarm'), '', 'resumed: calm again');
  p.band.destroy();
  const none = page(world({}), { night: {} }); none.host.cue = () => null; none.band.update();
  none.q('[data-band="panic"]').click(); assert.deepEqual(plain(none.calls.pop()), ['panic'], 'no cue stack: PANIC still goes to the page'); none.band.destroy();
});

await test('the tray: with the tray module on the page the band mounts it in its slot and updates it; the quiet line mounts in its own slot', () => {
  const log = [];
  const Tray = { create: (host) => { log.push(['create', typeof host.openView]); return { mount: (el) => log.push(['mount', el.getAttribute('data-band-slot')]), update: () => log.push(['update']), destroy: () => log.push(['destroy']) }; } };
  const Quiet = { mount: (el) => log.push(['quiet', el.getAttribute('data-band-slot')]), isOpen: () => false, close() {} };
  const W = world({ B68GmIpadTray: Tray, B68GmQuiet: Quiet }), p = page(W, { night: SCORE_NIGHT });
  assert.deepEqual(plain(log.slice(0, 3)), [['create', 'function'], ['mount', 'tray'], ['quiet', 'quiet']]);
  assert.ok(!p.q('#gm-bar-ipad'), 'no stand-in once the tray is there'); assert.ok(log.some((x) => x[0] === 'update'), 'the tray is updated with the band');
  p.band.destroy(); assert.deepEqual(plain(log[log.length - 1]), ['destroy']);
});

await test('Esc: the band registers the cue\'s popover and the quiet list (priority 70) and takes both down when it goes; a popover open is the topmost thing', () => {
  const quiet = { open: false };
  const W = world({ B68GmQuiet: { mount() {}, isOpen: () => quiet.open, close: () => { quiet.open = false; } } }), p = page(W, { night: SCORE_NIGHT });
  const ids = () => plain(W.B68GmEsc.list().map((e) => e.id));
  assert.deepEqual(ids().sort(), ['band.cue-more', 'band.quiet']); assert.ok(W.B68GmEsc.list().every((e) => e.priority === 70));
  assert.equal(W.B68GmEsc.anyOpen(), false);
  p.cueView.more = true; assert.equal(W.B68GmEsc.anyOpen(), true);
  assert.equal(W.B68GmEsc.handle({ panic() { assert.fail('not a panic'); } }), 'closed:band.cue-more'); assert.deepEqual(plain(p.calls.pop()), ['closeMore']);
  quiet.open = true; assert.equal(W.B68GmEsc.handle({ panic() { assert.fail('not a panic'); } }), 'closed:band.quiet'); assert.equal(quiet.open, false);
  let panicked = 0; assert.equal(W.B68GmEsc.handle({ panic() { panicked++; } }), 'panic'); assert.equal(panicked, 1, 'nothing open: PANIC');
  p.band.destroy(); assert.deepEqual(ids(), [], 'gone with the band');
});

await test('a band that went away stops: no timer left, no slot handed out', () => {
  const timers = []; const W = world({ setInterval: (fn, ms) => { timers.push(ms); return 7; }, clearInterval: (h) => timers.push('clear ' + h) });
  const p = page(W, { night: SCORE_NIGHT });
  assert.deepEqual(plain(timers), [W.B68GmBand.TICK_MS], 'one clock for the minutes');
  p.band.destroy(); assert.deepEqual(plain(timers), [W.B68GmBand.TICK_MS, 'clear 7']); assert.equal(p.band.cueSlot(), null);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
