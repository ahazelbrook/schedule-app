// night-who (Start the night, KS11 of the kit and stage build): app/gm/kit/who.js, the roster and the session writes. No browser, no network.
//   1. the roster: session.present counts only while its values are the session's own startedAt (the Gate 2 contract), else everyone
//   2. startSession's patch writes the same campaign document as the table page's own Start session button (app/campaign.js sessstart, run here
//      on a fake page with the real schedule.js), plus session.present; End the same as the table's End
//   3. the sheet's model: ticks from the roster, else the RSVPs, else everyone; the number (counter + 1, carry on, the Prep note's)
//   4. the sheet on a fake page: rows, a tick, Start (host.start gets the number, two of three ids and the attendance), the night log, the Opening
//   node checks/runtime/night-who.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { deepMerge } from '../../functions/_lib/http.js';
import { mergeLog } from '../../functions/_lib/campaign.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const require = createRequire(import.meta.url);
const Who = require(path.join(APP, 'gm', 'kit', 'who.js'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e && e.stack || e)); }
}
async function atest(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n  ' + (e && e.stack || e)); }
}
const clone = (v) => JSON.parse(JSON.stringify(v));

// the invented table: the Dovetail Crew, three players, three characters
const NOW = Date.parse('2026-11-21T08:42:00.000Z');
const NOW_ISO = new Date(NOW).toISOString();
const GM = 'gm@example.test';
const CHARS = [
  { id: 'ch-nell', name: 'Nell Arbuthnot', owner: 'nell.player@example.test' },
  { id: 'ch-ray', name: 'Ray Okonjo', owner: 'ray.player@example.test' },
  { id: 'ch-tam', name: 'Tam Petrakis', owner: 'tam.player@example.test' },
];
function storedDoc() {
  return {
    v: 1,
    session: { number: 4, startedAt: '2026-11-07T08:30:00.000Z', endedAt: '2026-11-07T12:10:00.000Z' },
    crew: { name: 'The Dovetail Crew', type: 'Shadows', lair: 'The Pelican Rooms', notes: '', tier: 1, hold: 'weak', rep: 2, turf: 0, heat: 3, wanted: 0, vault: 2, claims: [], cohorts: [], factions: [] },
    clocks: [{ id: 'c_one', name: 'The Pelican Rooms are watched', size: 6, filled: 2, kind: 'danger', hidden: false }],
    log: [{ at: '2026-11-07T12:10:00.000Z', by: GM, text: 'Session 4 ended' }, { at: '2026-11-07T08:30:00.000Z', by: GM, text: 'Session 4 started' }],
    schedule: {
      options: { o_old: { at: '2026-11-14T08:30:00.000Z', minutes: 240, note: '' }, o_later: { at: '2026-12-05T08:30:00.000Z', minutes: 240, note: '' } },
      avail: {}, next: { at: '2026-11-21T08:30:00.000Z', minutes: 240, place: 'The Pelican Rooms', note: '', confirmedAt: null },
      rsvp: { 'nell.player@example.test': { at: '2026-11-21T08:30:00.000Z', v: 'in' }, 'tam.player@example.test': { at: '2026-11-21T08:30:00.000Z', v: 'out' } },
      cadence: null, quorum: 0, attendance: { 4: { 'nell.player@example.test': true } },
    },
    updatedAt: '2026-11-07T12:10:00.000Z',
  };
}
// the server's PATCH (functions/api/campaign.js): a deep merge, the log's entries added
function serverPatch(doc, patch, gm = true) {
  const { log, ...rest } = patch;
  const next = deepMerge(doc, rest);
  if (log !== undefined) next.log = mergeLog(doc.log, log, gm);
  return next;
}

// ---------- a fake page that runs app/schedule.js and app/campaign.js (the table page) at a fixed time ----------
function fixedDate(t) {
  return class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(t); }
    static now() { return t; }
  };
}
function tablePage(at = NOW) {
  const listeners = {};
  const rootEl = {
    className: '', innerHTML: '', id: 'table-page',
    addEventListener(k, f) { listeners[k] = f; }, removeEventListener() {},
    contains() { return true; }, querySelector() { return null; }, querySelectorAll() { return []; },
  };
  const win = {
    console, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Promise, Error, isFinite, parseInt, parseFloat, setTimeout, clearTimeout,
    Date: fixedDate(at), location: { hash: '#t' }, scrollY: 0, scrollTo() {}, addEventListener() {}, removeEventListener() {}, confirm: () => true,
    matchMedia: () => ({ matches: false }), localStorage: { getItem: () => null, setItem() {} },
    document: { getElementById: (id) => (id === 'table-page' ? rootEl : null), activeElement: null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), querySelector: () => null },
  };
  win.window = win; win.self = win;
  vm.createContext(win);
  for (const f of ['schedule.js', 'campaign.js']) vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), win, { filename: f });
  const saved = [];
  const replaced = [];
  const api = { save: (p) => { saved.push(clone(p)); return Promise.resolve(true); }, replace: (w) => { replaced.push(clone(w)); return Promise.resolve(true); }, me: GM, canWrite: true, isGM: true, clockOps: true, roster: () => [], profiles: null };
  win.B68Campaign.open(api);
  return {
    win, saved, replaced,
    load(doc) { win.B68Campaign.update(clone(doc)); },
    click(act, data = {}) {
      const attributes = [{ name: 'data-act', value: act }].concat(Object.entries(data).map(([k, v]) => ({ name: 'data-' + k, value: String(v) })));
      const btn = { tagName: 'DIV', disabled: false, attributes, getAttribute: (k) => (k === 'data-act' ? act : null), focus() {} };
      listeners.click({ target: { closest: () => btn } });
    },
  };
}
// who.js's patch at the same time, with the same page's schedule.js
function whoPatch(win, doc, o) { return Who.startPatch(clone(doc), o, { iso: NOW_ISO, ms: NOW, me: GM, Sm: win.B68Schedule }); }
function withoutPresent(doc) { const d = clone(doc); if (d.session) delete d.session.present; return d; }

// ---------- 1. the roster ----------
test('roster: none stored is null (everyone, as before the setting)', () => {
  assert.equal(Who.roster(storedDoc()), null);
  assert.equal(Who.roster(null), null);
  assert.equal(Who.roster({ session: { number: 5, startedAt: NOW_ISO, present: {} } }), null);
});
test('roster: the entries stamped with the session start count; a stale stamp, true, or null does not', () => {
  const d = { session: { number: 5, startedAt: NOW_ISO, endedAt: null, present: { 'ch-ray': NOW_ISO, 'ch-nell': NOW_ISO, 'ch-tam': '2026-11-07T08:30:00.000Z', 'ch-x': true, 'ch-y': null } } };
  assert.deepEqual(Who.roster(d), { ids: ['ch-nell', 'ch-ray'], at: NOW_ISO });
});
test('roster: a Start by another path (the table, an older release) leaves last night\'s roster inert', () => {
  const night = serverPatch(storedDoc(), { session: { number: 5, startedAt: NOW_ISO, endedAt: null, present: { 'ch-nell': NOW_ISO, 'ch-ray': NOW_ISO } } });
  assert.equal(Who.roster(night).ids.length, 2);
  const ended = serverPatch(night, { session: { number: 5, startedAt: NOW_ISO, endedAt: '2026-11-21T12:00:00.000Z' } });
  assert.equal(Who.roster(ended).ids.length, 2, 'End keeps the roster (After says 2 playing)');
  assert.ok(ended.session.present, 'the server kept the key the old End did not send');
  const next = serverPatch(ended, { session: { number: 6, startedAt: '2026-11-28T08:40:00.000Z', endedAt: null } });
  assert.ok(next.session.present, 'the key survives an old Start...');
  assert.equal(Who.roster(next), null, '...but no longer counts: everyone');
});

// ---------- 2. the writes, against the table page's own buttons ----------
test('startPatch: the same document the table\'s Start session writes, plus session.present', () => {
  const t = tablePage(); t.load(storedDoc()); t.click('sessstart');
  assert.equal(t.saved.length, 1, 'the table saved once: ' + JSON.stringify(t.saved));
  const table = serverPatch(storedDoc(), t.saved[0]);
  const p = whoPatch(t.win, storedDoc(), { present: ['ch-nell', 'ch-ray'] });
  const who = serverPatch(storedDoc(), p);
  assert.deepEqual(withoutPresent(who), table);
  assert.deepEqual(who.session.present, { 'ch-nell': NOW_ISO, 'ch-ray': NOW_ISO });
  assert.equal(table.session.number, 5);
  assert.equal(table.log[0].text, 'Session 5 started');
  assert.equal(who.schedule.next, undefined, 'next went (it was within 12 h)');
  assert.deepEqual(who.schedule.attendance['5'], { 'nell.player@example.test': true, 'tam.player@example.test': false }, 'the RSVPs became session 5\'s attendance');
});
test('startPatch: attendance from the sheet\'s ticks overlays the RSVPs for that session only', () => {
  const t = tablePage(); t.load(storedDoc());
  const att = Who.attendanceOf(CHARS, ['ch-nell', 'ch-ray']);
  assert.deepEqual(att, { 'nell.player@example.test': true, 'ray.player@example.test': true, 'tam.player@example.test': false });
  const who = serverPatch(storedDoc(), whoPatch(t.win, storedDoc(), { present: ['ch-nell', 'ch-ray'], attendance: att }));
  assert.deepEqual(who.schedule.attendance['5'], att);
  assert.deepEqual(who.schedule.attendance['4'], { 'nell.player@example.test': true }, 'last session untouched');
});
test('startPatch: a number the GM typed is the session\'s; the default is the counter + 1', () => {
  const t = tablePage();
  const who = serverPatch(storedDoc(), whoPatch(t.win, storedDoc(), { number: 7, present: ['ch-ray'] }));
  assert.equal(who.session.number, 7); assert.equal(who.log[0].text, 'Session 7 started'); assert.ok(who.schedule.attendance['7']);
  assert.equal(serverPatch(storedDoc(), whoPatch(t.win, storedDoc(), { number: 'x', present: [] })).session.number, 5);
});
test('startPatch: the open session\'s own number carries it on (same start, roster rewritten, nothing logged, a player let go is gone)', () => {
  const t = tablePage();
  const night = serverPatch(storedDoc(), whoPatch(t.win, storedDoc(), { present: ['ch-nell', 'ch-ray'] }));
  const later = new Date(NOW + 3600000).toISOString();
  const p = Who.startPatch(clone(night), { number: 5, present: ['ch-nell', 'ch-tam'] }, { iso: later, ms: NOW + 3600000, me: GM, Sm: t.win.B68Schedule });
  assert.equal(p.log, undefined); assert.equal(p.schedule, undefined);
  const after = serverPatch(night, p);
  assert.equal(after.session.startedAt, NOW_ISO);
  assert.deepEqual(after.session.present, { 'ch-nell': NOW_ISO, 'ch-tam': NOW_ISO });
  assert.equal(after.log.length, night.log.length);
});
test('startPatch: a new session clears the old roster\'s keys', () => {
  const t = tablePage();
  const night = serverPatch(storedDoc(), whoPatch(t.win, storedDoc(), { present: ['ch-nell', 'ch-ray'] }));
  const ended = serverPatch(night, Who.endPatch(night, { iso: '2026-11-21T12:00:00.000Z', me: GM }));
  const next = serverPatch(ended, Who.startPatch(ended, { present: ['ch-tam'] }, { iso: '2026-11-28T08:40:00.000Z', ms: Date.parse('2026-11-28T08:40:00.000Z'), me: GM, Sm: t.win.B68Schedule }));
  assert.equal(next.session.number, 6);
  assert.deepEqual(next.session.present, { 'ch-tam': '2026-11-28T08:40:00.000Z' });
});
test('endPatch: the same document the table\'s End session writes; the roster stays; nothing when no session is open', () => {
  const t = tablePage();
  const night = serverPatch(storedDoc(), whoPatch(t.win, storedDoc(), { present: ['ch-nell', 'ch-ray'] }));
  const END = NOW + 3 * 3600000, t2 = tablePage(END); t2.load(night); t2.click('sessend');
  assert.equal(t2.saved.length, 1);
  const table = serverPatch(night, t2.saved[0]);
  const who = serverPatch(night, Who.endPatch(night, { iso: new Date(END).toISOString(), me: GM }));
  assert.deepEqual(who, table);
  assert.equal(who.log[0].text, 'Session 5 ended');
  assert.equal(Who.roster(who).ids.length, 2);
  assert.equal(Who.endPatch(storedDoc(), { iso: NOW_ISO }), null);
  assert.equal(Who.isOpen(who), false); assert.equal(Who.isOpen(night), true);
});

test('Gate 2: a whole-document write during the night (the table removes a log line: a PUT) keeps the roster; Tam is still absent', () => {
  const t = tablePage();
  const night = serverPatch(storedDoc(), whoPatch(t.win, storedDoc(), { present: ['ch-nell', 'ch-ray'] }));
  const t2 = tablePage(NOW + 600000); t2.load(night); t2.click('logrm', { i: 1 });
  assert.equal(t2.replaced.length, 1, 'the table wrote the whole document (PUT)');
  const after = t2.replaced[0];      // a PUT stores the body as sent (functions/api/campaign.js: only mission and features are carried over)
  assert.equal(after.log.length, night.log.length - 1, 'the line is gone');
  assert.deepEqual(Who.roster(after), { ids: ['ch-nell', 'ch-ray'], at: NOW_ISO });
  assert.equal(Who.model(after, CHARS, { Sm: t.win.B68Schedule }).rows.find((r) => r.id === 'ch-tam').on, false, 'Tam is still absent');
});
test('Gate 2: the table page reading (normalize) keeps present exactly as stored; with none stored it adds nothing', () => {
  const t = tablePage(), N = t.win.B68Campaign.normalize;
  const night = serverPatch(storedDoc(), whoPatch(t.win, storedDoc(), { present: ['ch-nell', 'ch-ray'] }));
  const n = N(clone(night));
  assert.equal(n.session.startedAt, night.session.startedAt, 'startedAt is the stored string');
  assert.deepEqual(clone(n.session.present), night.session.present);
  assert.deepEqual(Object.keys(N(storedDoc()).session), ['number', 'startedAt', 'endedAt'], 'no roster stored: the session reads as before');
  const odd = clone(night); odd.session.present = { 'ch-nell': NOW_ISO, 'ch-ray': true, 'ch-tam': null };
  assert.deepEqual(clone(N(odd).session.present), { 'ch-nell': NOW_ISO });
});

// ---------- 3. the sheet's model and After's line ----------
test('model: ticks from the RSVPs (everyone but a no), the number, the Prep note beside it when it differs', () => {
  const t = tablePage();
  const m = Who.model(storedDoc(), CHARS, { Sm: t.win.B68Schedule, prep: '4.5', names: { 'ray.player@example.test': 'Ray’s player' } });
  assert.equal(m.from, 'rsvp');
  assert.deepEqual(m.rows.map((r) => [r.id, r.on, r.rsvp]), [['ch-nell', true, 'in'], ['ch-ray', true, ''], ['ch-tam', false, 'out']]);
  assert.equal(m.rows[1].player, 'Ray’s player'); assert.equal(m.rows[0].player, 'nell.player');
  assert.equal(m.number, 5); assert.equal(m.prep, '4.5'); assert.equal(m.open, false);
  assert.equal(Who.model(storedDoc(), CHARS, { Sm: t.win.B68Schedule, prep: '5' }).prep, '', 'the same number is not repeated');
});
test('model: no RSVPs: everyone ticked; an open session: its roster and Carry on', () => {
  const t = tablePage(), d = storedDoc(); d.schedule.next = null; d.schedule.rsvp = {};
  assert.deepEqual(Who.model(d, CHARS, { Sm: t.win.B68Schedule }).rows.map((r) => r.on), [true, true, true]);
  const night = serverPatch(storedDoc(), whoPatch(t.win, storedDoc(), { present: ['ch-nell', 'ch-ray'] }));
  const m = Who.model(night, CHARS, { Sm: t.win.B68Schedule });
  assert.equal(m.from, 'roster'); assert.equal(m.open, true); assert.equal(m.carry, 5); assert.equal(m.number, 5);
  assert.deepEqual(m.rows.map((r) => r.on), [true, true, false]);
});
test('summary: After\'s one line', () => {
  const t = tablePage(), hhmm = () => '19:42';
  const night = serverPatch(storedDoc(), whoPatch(t.win, storedDoc(), { present: ['ch-nell', 'ch-ray'] }));
  assert.equal(Who.summary(night, CHARS, { hhmm }), 'Session 5 · started 19:42 · 2 playing');
  const ended = serverPatch(night, Who.endPatch(night, { iso: NOW_ISO }));
  assert.equal(Who.summary(ended, CHARS, { hhmm }), 'Session 5 · started 19:42 · ended 19:42 · 2 playing');
  assert.equal(Who.summary(storedDoc(), CHARS, { hhmm }), 'Session 4 · started 19:42 · ended 19:42 · 3 playing', 'no roster: everyone');
  assert.equal(Who.summary({}, CHARS), 'No session started yet');
});
test('a model and a summary never carry markup: names go in escaped by the sheet', () => {
  const src = fs.readFileSync(path.join(APP, 'gm', 'kit', 'who.js'), 'utf8');
  /* KS12: the rows are B68Ui buttons (every label escaped by the kit) laid out with text nodes; After's line is text */
  assert.match(src, /btn\(\{ label: \[r\.name, sub,/); assert.match(src, /part\('b', '', r\.name\)/); assert.match(src, /n\.textContent !== t\) n\.textContent = t/);
  assert.doesNotMatch(src, /<button/, 'no hand-built button (the ratchet\'s kit debt is paid)');
});

// ---------- 4. the sheet on a fake page ----------
function fakeEl(tag) {
  const el = {
    tagName: tag.toUpperCase(), attrs: {}, children: [], listeners: {}, hidden: false, className: '', id: '', _html: '',
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; }, hasAttribute(k) { return k in this.attrs; },
    addEventListener(k, f, cap) { if (cap === true) (this.capture = this.capture || []).push(k); else this.listeners[k] = f; }, removeEventListener() {},      /* a capture listener (B68Ui.guardBusy) is noted, not called */ appendChild(c) { this.children.push(c); c.parentNode = this; return c; }, removeChild() {},
    contains() { return false; }, querySelector() { return null; }, querySelectorAll() { return []; }, focus() {},
  };
  Object.defineProperty(el, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v; } });
  return el;
}
await atest('the sheet: rows from the characters, a tick toggled, Start with two of three; the night log, the Opening, Esc', async () => {
  const page = fakeEl('div'), gmRoot = fakeEl('div');
  const escs = [];
  const W = { document: { getElementById: (id) => (id === 'gm-page' ? page : null), createElement: fakeEl, activeElement: null, body: page },
    B68GmEsc: { register: (id, o) => { escs.push({ id, o }); return () => {}; } } };
  W.self = W; vm.createContext(W);
  vm.runInContext(fs.readFileSync(path.join(APP, 'ui', 'ui.js'), 'utf8'), W, { filename: 'ui.js' });      /* the kit-ui bundle comes first (B68Ui) */
  vm.runInContext(fs.readFileSync(path.join(APP, 'gm', 'kit', 'who.js'), 'utf8'), W, { filename: 'who.js' });
  const t = tablePage(); const d = storedDoc();
  const calls = { start: [], log: [], go: [], restamp: [], toast: [] };
  const ctl = W.B68GmWho.create({
    root: () => gmRoot, campaign: () => d, characters: () => CHARS, schedule: () => t.win.B68Schedule, prep: () => '4.5',
    names: () => Promise.resolve({ 'nell.player@example.test': 'Nell’s player' }),
    start: (o) => { calls.start.push(o); return Promise.resolve(true); }, log: (x) => calls.log.push(x), go: (p) => calls.go.push(p), restamp: (n) => calls.restamp.push(n), toast: (m) => calls.toast.push(m),
  });
  // Before's lead and After's line
  const lead = fakeEl('div'), after = fakeEl('p'), left = fakeEl('div');
  left.querySelectorAll = (sel) => (sel === '[data-who-lead]' ? [lead] : sel === '[data-who-after]' ? [after] : []);
  ctl.paint(left);
  assert.match(lead.innerHTML, /<button type="button" class="ui-btn ui-btn--primary btn primary"[^>]*data-who="open"[^>]*>Start the night<\/button>/, 'a B68Ui Primary keeping the old classes');
  assert.equal((lead.innerHTML.match(/ui-btn--primary/g) || []).length, 1, 'one Primary');
  assert.equal(after.textContent, Who.summary(d, CHARS));
  // the page's root opens it
  gmRoot.listeners.click({ target: { closest: (s) => (s === '[data-who="open"]' ? { getAttribute: () => 'open' } : null) }, preventDefault() {} });
  assert.equal(ctl.isOpen(), true);
  const sheet = gmRoot.children[0];      /* in #gm-root, under the band, as the workshop's sheets */
  assert.equal(page.children.length, 0);
  assert.equal(sheet.id, 'gm-who-sheet'); assert.equal(sheet.hidden, false); assert.equal(sheet.getAttribute('role'), 'dialog');
  assert.equal(sheet.getAttribute('data-ui-scope'), '', 'KS02b: the sheet is a kit scope'); assert.ok((sheet.capture || []).includes('click'), 'and B68Ui.guardBusy guards it');
  assert.match(sheet.innerHTML, /data-who-pc="ch-nell" aria-pressed="true"/);
  assert.match(sheet.innerHTML, /data-who-pc="ch-tam" aria-pressed="false"/, 'Tam said no');
  assert.match(sheet.innerHTML, /value="5"/); assert.match(sheet.innerHTML, /the Prep note says 4\.5/);
  assert.match(sheet.innerHTML, />Start session 5<\/button>/);
  await new Promise((r) => setTimeout(r, 0));
  assert.match(sheet.innerHTML, /Nell’s player/, 'the player\'s name arrived');
  // Esc closes it through B68GmEsc
  assert.equal(escs[0].id, 'who.sheet'); assert.equal(escs[0].o.isOpen(), true);
  // untick Ray, tick him back: the count follows
  const click = (attr, val) => sheet.listeners.click({ target: { closest: () => ({ getAttribute: (k) => (k === attr ? val : null) }) }, preventDefault() {} });
  click('data-who-pc', 'ch-ray'); assert.match(sheet.innerHTML, /1 playing/);
  click('data-who-pc', 'ch-ray'); assert.match(sheet.innerHTML, /2 playing/);
  click('data-who', 'start');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.start.length, 1);
  assert.deepEqual(clone(calls.start[0]), { number: 5, present: ['ch-nell', 'ch-ray'], attendance: { 'nell.player@example.test': true, 'ray.player@example.test': true, 'tam.player@example.test': false } });
  assert.deepEqual(calls.log, ['Session 5 started · 2 playing']);
  assert.deepEqual(calls.go, ['opening']); assert.deepEqual(calls.restamp, [5]);
  assert.equal(ctl.isOpen(), false); assert.equal(sheet.hidden, true);
  assert.equal(escs[0].o.isOpen(), false);
  ctl.destroy();
});

// ---------- 5. KS12.0: the fixes from KS11's review ----------
test('KS12.0: the ticks go over the RSVP record: a yes with no filed character stays; the GM\'s own character never marks the GM', () => {
  const t = tablePage(), d = storedDoc();
  d.schedule.rsvp['mabel.player@example.test'] = { at: '2026-11-21T08:30:00.000Z', v: 'in' };      /* said yes, has no character yet */
  const chars = CHARS.concat([{ id: 'ch-gm', name: 'Lotte Brand', owner: GM }]);
  const att = Who.attendanceOf(chars, ['ch-nell', 'ch-ray', 'ch-gm']);
  const who = serverPatch(d, Who.startPatch(clone(d), { present: ['ch-nell', 'ch-ray', 'ch-gm'], attendance: att }, { iso: NOW_ISO, ms: NOW, me: GM, Sm: t.win.B68Schedule }));
  assert.deepEqual(who.schedule.attendance['5'], { 'nell.player@example.test': true, 'mabel.player@example.test': true, 'tam.player@example.test': false, 'ray.player@example.test': true });
  assert.equal(GM in who.schedule.attendance['5'], false, 'the GM is not a player');
});
test('KS12.0: a carried-on night keeps its record and changes only the ticked players', () => {
  const t = tablePage();
  const night = serverPatch(storedDoc(), whoPatch(t.win, storedDoc(), { present: ['ch-nell', 'ch-ray'], attendance: Who.attendanceOf(CHARS, ['ch-nell', 'ch-ray']) }));
  const p = Who.startPatch(clone(night), { number: 5, present: ['ch-nell', 'ch-ray', 'ch-tam'], attendance: Who.attendanceOf(CHARS, ['ch-nell', 'ch-ray', 'ch-tam']) }, { iso: NOW_ISO, ms: NOW, me: GM, Sm: t.win.B68Schedule });
  const late = serverPatch(night, p);
  assert.deepEqual(late.schedule.attendance['5'], { 'nell.player@example.test': true, 'tam.player@example.test': true, 'ray.player@example.test': true }, 'Tam arrived late');
  assert.deepEqual(Object.keys(late.session.present).sort(), ['ch-nell', 'ch-ray', 'ch-tam']);
});

// ---------- 6. KS12.1: the one reader ----------
const PACK = [{ name: 'Nell Arbuthnot', first: 'Nell' }, { name: 'Ray Okonjo', first: 'Ray' }, { name: 'Tam Petrakis', first: 'Tam' }];
function nightOf(ids) { const t = tablePage(); return serverPatch(storedDoc(), whoPatch(t.win, storedDoc(), { present: ids })); }
test('KS12.1 join: the pack\'s names meet the filed ids on a tidied name; the roster says who is here', () => {
  const j = Who.join(PACK, CHARS, Who.roster(nightOf(['ch-nell', 'ch-ray'])));
  assert.equal(j.all, false);
  assert.deepEqual(j.pack.map((p) => [p.name, p.id, p.here]), [['Nell Arbuthnot', 'ch-nell', true], ['Ray Okonjo', 'ch-ray', true], ['Tam Petrakis', 'ch-tam', false]]);
  assert.deepEqual(j.unmatched, []);
  assert.equal(Who.presentIn(j, 'ch-tam'), false); assert.equal(Who.presentIn(j, 'ch-ray'), true);
  assert.equal(Who.presentIn(j, '  tam   PETRAKIS '), false, 'a name, tidied'); assert.equal(Who.presentIn(j, { label: 'Tam', value: 'Tam Petrakis' }), false, 'a Who chip option');
  assert.equal(Who.presentIn(j, { id: 'ch-nell', name: 'Nell Arbuthnot' }), true);
  assert.equal(Who.tidy('Ñell  O’Arbuthnot-Smith'), 'nell oarbuthnot smith');
  assert.deepEqual(Who.awayOwners(j), ['tam.player@example.test']);
  assert.deepEqual(Who.splitIn(j, CHARS).away.map((c) => c.id), ['ch-tam']);
});
test('KS12.1 join: a first name only one filed character has joins; a pack name with no match counts as present and is listed', () => {
  const chars = [{ id: 'ch-nell', name: 'Nell A.', owner: 'n@x.test' }, { id: 'ch-ray', name: 'Ray Okonjo', owner: 'r@x.test' }, { id: 'ch-tam', name: 'Tam Petrakis', owner: 't@x.test' }];
  const pack = PACK.concat([{ name: 'Lotte Brand', first: 'Lotte' }]);
  const j = Who.join(pack, chars, Who.roster(nightOf(['ch-nell'])));
  assert.equal(j.pack[0].id, 'ch-nell', 'Nell by her first name');
  assert.deepEqual(j.unmatched, ['Lotte Brand']);
  assert.equal(Who.presentIn(j, 'Lotte Brand'), true, 'unmatched: playing');
  assert.equal(Who.presentIn(j, 'Ray Okonjo'), false);
  const two = Who.join([{ name: 'Nell Arbuthnot' }], chars.concat([{ id: 'ch-n2', name: 'Nell Other', owner: 'o@x.test' }]), null);
  assert.deepEqual(two.unmatched, ['Nell Arbuthnot'], 'a first name two characters share joins neither');
});
test('KS12.1 join: no roster is everyone, exactly as before (the empty roster, a stale one, none stored)', () => {
  for (const d of [storedDoc(), { session: { number: 5, startedAt: NOW_ISO, present: {} } }, { session: { number: 6, startedAt: NOW_ISO, present: { 'ch-nell': '2026-11-07T08:30:00.000Z' } } }]) {
    const j = Who.join(PACK, CHARS, Who.roster(d));
    assert.equal(j.all, true);
    assert.ok(['ch-nell', 'ch-ray', 'ch-tam', 'Tam Petrakis', 'anyone'].every((x) => Who.presentIn(j, x)));
    assert.deepEqual(Who.awayOwners(j), []);
    assert.deepEqual(Who.splitIn(j, CHARS).here, CHARS);
  }
});
test('KS12.5 polaroidsOf: the cast id is the tidied first name, the caption the alias or the name; at most 8, no repeats', () => {
  assert.deepEqual(Who.polaroidsOf([{ name: 'Nell Arbuthnot', alias: 'The Heron' }, { name: 'Ray Okonjo' }, { name: 'Ray Other' }, { name: '<b>' }]),
    [{ id: 'nell', cap: 'The Heron' }, { id: 'ray', cap: 'Ray Okonjo' }, { id: 'b', cap: '<b>' }]);
  assert.equal(Who.polaroidsOf(Array.from({ length: 12 }, (_, i) => ({ name: 'P' + i + ' X' }))).length, 8);
  assert.equal(Who.polaroidsOf([{ name: 'A ' + 'x'.repeat(100), alias: 'y'.repeat(100) }])[0].cap.length, 60);
});

await atest('KS12.0/12.1/12.7 on a fake page: Carry on session N, the warning, onChange, the band chip', async () => {
  const page = fakeEl('div'), gmRoot = fakeEl('div'), bar = fakeEl('span'), sess = fakeEl('span');
  sess.parentNode = bar; bar.insertBefore = (c, ref) => { bar.children.push(c); c.parentNode = bar; return c; };
  bar.removeChild = (c) => { bar.children = bar.children.filter((x) => x !== c); c.parentNode = null; };
  const els = { 'gm-page': page, 'gm-bar-sess': sess };
  const W = { document: { getElementById: (id) => els[id] || bar.children.find((c) => c.id === id) || null, createElement: (t) => { const e = fakeEl(t); Object.defineProperty(e, 'textContent', { get() { return this._t || ''; }, set(v) { this._t = v; } }); const sa = e.setAttribute; e.setAttribute = function (k, v) { sa.call(this, k, v); if (k === 'id') this.id = String(v); }; return e; },
    createTextNode: (x) => ({ nodeType: 3, data: String(x) }), activeElement: null, body: page } };
  W.self = W; vm.createContext(W);
  vm.runInContext(fs.readFileSync(path.join(APP, 'ui', 'ui.js'), 'utf8'), W, { filename: 'ui.js' });      /* the kit-ui bundle comes first (B68Ui) */
  vm.runInContext(fs.readFileSync(path.join(APP, 'gm', 'kit', 'who.js'), 'utf8'), W, { filename: 'who.js' });
  const t = tablePage(); let d = nightOf(['ch-nell', 'ch-ray']);
  const ctl = W.B68GmWho.create({ root: () => gmRoot, campaign: () => d, characters: () => CHARS, schedule: () => t.win.B68Schedule, pack: () => PACK.concat([{ name: 'Lotte Brand' }]), start: () => Promise.resolve(true) });
  let fired = 0; const off = ctl.onChange(() => { fired++; });
  const lead = fakeEl('div'), left = fakeEl('div');
  left.querySelectorAll = (sel) => (sel === '[data-who-lead]' ? [lead] : []);
  ctl.paint(left);
  assert.match(lead.innerHTML, />Carry on session 5<\/button>/, 'KS12.0: an open session is carried on');
  assert.equal(fired, 1, 'the roster arrived: one change');
  ctl.paint(left); assert.equal(fired, 1, 'nothing changed: no call');
  assert.equal(ctl.isPresent('Tam Petrakis'), false); assert.equal(ctl.isPresent('Lotte Brand'), true);
  assert.deepEqual(clone(ctl.only(CHARS).map((c) => c.id)), ['ch-nell', 'ch-ray']); assert.deepEqual(clone(ctl.away()), ['tam.player@example.test']);
  const chip = bar.children.find((c) => c.id === 'gm-bar-who');
  assert.ok(chip, 'the band chip is placed after the session chip'); assert.equal(chip.textContent, '2 playing');
  chip.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(ctl.isOpen(), true, 'the chip opens the sheet');
  const sheet = gmRoot.children[0];
  assert.match(sheet.innerHTML, /<h2 class="gm-sheet-h">Who is here<\/h2>/);
  assert.match(sheet.innerHTML, /class="who-warn" role="note"><b>Not filed:<\/b> Lotte Brand\./, 'the unmatched pack name is warned about');
  d = serverPatch(d, Who.startPatch(clone(d), { number: 5, present: ['ch-nell', 'ch-ray', 'ch-tam'] }, { iso: NOW_ISO, ms: NOW, me: GM, Sm: t.win.B68Schedule }));
  ctl.paint(left); assert.equal(fired, 2, 'a late arrival: a change'); assert.equal(chip.textContent, '3 playing'); assert.equal(ctl.isPresent('ch-tam'), true);
  off(); d = nightOf(['ch-nell']); ctl.paint(left); assert.equal(fired, 2, 'unsubscribed');
  ctl.destroy();
  assert.equal(bar.children.some((c) => c.id === 'gm-bar-who'), false, 'destroy takes the chip it made away');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
