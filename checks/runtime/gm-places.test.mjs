// Unit test for the places of the night (app/gm/places.js; the night rebuild, N1b): the table, Prep at the section, the run order read for Before,
// Find's rows, the memory, and the controller against a host with no page (what it asks the page to do, and the state it keeps). No browser, no network.
// The page-level checks (the switcher, the left column, the chips, the views drawn, the phone) are in checks/runtime/gm-places.e2e.mjs.
//   node checks/runtime/gm-places.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const P = require(path.join(ROOT, 'app', 'gm', 'places.js'));
const Night = require(path.join(ROOT, 'app', 'gm', 'night.js'));
const Cues = require(path.join(ROOT, 'app', 'gm', 'cue-stack.js'));
const Tools = require(path.join(ROOT, 'app', 'gm', 'tools.js'));

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

/* an invented prep note, as the pack carries one */
const NOTE = { id: 'n1', title: 'Session 9: the Lantern Works', blocks: [{ k: 'md', src: [
  'start: 19:30', 'curfew: 22:40', '', '## Before the night', '- [ ] Charge the speaker', '', '## Tonight', 'The crew goes back to the works.', '',
  '## Run order', '', '| # | Beat | About |', '|---|---|---|', '| 1 | **Doors and the titles** | 10 min |', '| 2 | **Personal business** | 30 min |', '| 3 | **Planning**: the briefing | 25 min |',
  '| 4 | **The score** | 90 min |', '| 5 | **Aftermath**: payout | 20 min |', '', '## Titles', 'Previously.', '## Open', 'A cold open.', '## Downtime', '- Nell.', '## Briefing', 'The job.',
  '## Score', 'The night.', '## Rooms', '### Boiler room', 'Who: Mabel Quist', '### Counting house', 'Who: Dov Kessler', '```', '### Not a room', '```', '## Cues', '1. scene: tram', '2. phase: pb', '3. light: Down', '',
  '## Close', '- Payout.'].join('\n') }, { k: 'embed', from: 'Other.md', src: '## Rooms\n### Embedded room' }] };

await test('the places: six in night order with their labels and phases, Between apart; place() gives each its left column, views and words', () => {
  assert.deepEqual(P.list(), [{ id: 'before', label: 'Before', phase: null }, { id: 'opening', label: 'Opening', phase: null }, { id: 'pb', label: 'Personal', phase: 'pb' },
    { id: 'plan', label: 'Planning', phase: 'plan' }, { id: 'score', label: 'Score', phase: 'score' }, { id: 'after', label: 'Aftermath', phase: 'after' }]);
  assert.deepEqual(P.between(), { id: 'between', label: 'Between', phase: null });
  assert.deepEqual(P.list().map((p) => p.phase).filter(Boolean), Night.PHASES.map((p) => p.id), 'the phase places are the night controller\'s phases, in order');
  assert.equal(P.place('before').left, 'own'); assert.equal(P.place('opening').left, 'own'); assert.equal(P.place('after').left, 'own'); assert.equal(P.place('between').left, 'slim');
  for (const id of ['pb', 'plan', 'score']) { assert.equal(P.place(id).left, 'roll', id + ': people roll here'); assert.equal(P.place(id).leftLabel, 'The Roll'); }
  assert.equal(P.place('nowhere'), null);
  assert.equal(P.LEFT_TOOL.before, 'preflight'); assert.equal(P.LEFT_TOOL.opening, 'hardstart');
});
await test('the views each place lays out (the brief\'s list), first is the default; the four pinned views follow in every place', () => {
  const own = (id) => P.place(id).views.map((v) => v.id);
  assert.deepEqual(own('before'), ['tonight', 'room', 'print', 'ipadscenes']);
  assert.deepEqual(own('opening'), ['titles', 'frontpage']);
  assert.deepEqual(own('pb'), ['downtime', 'debrief', 'trouble']);
  assert.deepEqual(own('plan'), ['cards', 'corkboard', 'run', 'score']);
  assert.deepEqual(own('score'), ['run', 'chase', 'scenes', 'location']);
  assert.deepEqual(own('after'), ['aftermath', 'downtime']);
  assert.deepEqual(own('between'), ['desks']);
  for (const p of P.list().concat([P.between()])) assert.deepEqual(P.viewsOf(p.id).slice(-4), ['prep', 'rules', 'npc', 'ipad'], p.id);
  assert.deepEqual(P.place('pb').views.map((v) => v.label), ['Downtime', 'Debrief replies', 'Trouble desk'], 'a place may name a view its own way');
  assert.deepEqual(P.place('plan').views.map((v) => v.label), ['Opportunities', 'Intel', 'The site', 'Score generator']);
  assert.deepEqual(P.PINNED.map((id) => P.view(id).label + ' ' + P.view(id).key), ['Prep R', 'Rules T', 'Cast N', 'iPad I']);
  assert.ok(P.lists('score', 'chase') && !P.lists('plan', 'chase') && P.lists('plan', 'prep'));
});
await test('the one table: every pane is a view, every key of the design opens one, and every tool the Menu used to hold has a home', () => {
  const panes = ['prep', 'rules', 'npc', 'ipad', 'run', 'location', 'scenes', 'score', 'chase', 'downtime', 'cards'];
  for (const id of panes) assert.equal(P.view(id).pane, id, id);
  const keys = Object.keys(P.VIEWS).filter((id) => P.VIEWS[id].key).map((id) => P.VIEWS[id].key + ':' + id).sort();
  assert.deepEqual(keys, ['B:location', 'C:chase', 'D:downtime', 'G:run', 'I:ipad', 'J:score', 'N:npc', 'O:cards', 'R:prep', 'S:scenes', 'T:rules'], 'design section 8: R T N I G B S J C D O');
  const TOOLS = ['hardstart', 'preflight', 'print', 'corkboard', 'montage', 'practical', 'phone', 'trouble', 'canon', 'frontpage', 'absent', 'aftermath', 'debrief', 'board', 'castphoto', 'lair', 'record', 'light'];
  for (const id of TOOLS) { assert.equal(P.view(id).tool, id, id + ' is a view of its own'); assert.ok(P.view(id).desc, id + ' says what it is'); }
  const homes = Object.fromEntries(TOOLS.map((id) => [id, P.homeOf(id)]));
  assert.deepEqual(homes, { hardstart: 'opening', preflight: 'before', print: 'before', corkboard: 'plan', montage: '', practical: 'before', phone: 'before', trouble: 'pb', canon: 'between',
    frontpage: 'opening', absent: 'between', aftermath: 'after', debrief: 'pb', board: 'plan', castphoto: 'between', lair: 'between', record: 'before', light: 'before' }, 'montage has no home: it opens where the GM is (the site has it too)');
  assert.deepEqual(P.view('room').tools, ['music', 'practical', 'phone', 'light', 'record']);
  assert.equal(P.view('cards').slot.tool, 'board', 'Opportunities holds the players\' board over the GM\'s cards');
  assert.deepEqual(P.DESKS.map((d) => d.id), ['frontpage', 'absent', 'canon', 'debrief', 'board', 'lair', 'castphoto', 'trouble', 'print', 'gen']);
  assert.deepEqual(P.DESKS.find((d) => d.id === 'gen').panes.map((p) => p[0]), ['npc', 'score', 'location']);
});
await test('forPhase and step: a phase id is its place; Ctrl+arrows walk the night and Between, and stop at the ends', () => {
  assert.equal(P.forPhase('pb'), 'pb'); assert.equal(P.forPhase('after'), 'after'); assert.equal(P.forPhase(''), ''); assert.equal(P.forPhase('nonsense'), '');
  assert.deepEqual(['before', 'opening', 'pb', 'plan', 'score', 'after', 'between'].map((id) => P.step(id, 1)), ['opening', 'pb', 'plan', 'score', 'after', 'between', 'between']);
  assert.deepEqual(['before', 'opening', 'pb', 'between'].map((id) => P.step(id, -1)), ['before', 'before', 'opening', 'after']);
});
await test('Prep at the section: the first ## heading (note order) holding a word of the place, a word at the start of a word; none: -1 (the top)', () => {
  const heads = ['Before the night', 'Tonight', 'Run order', 'Titles', 'Open', 'Downtime', 'Briefing', 'Gather information', 'Score', 'Rooms', 'Cues', 'Close'];
  const at = (id) => { const i = P.prepTarget(id, heads); return i < 0 ? null : heads[i]; };
  assert.deepEqual(['before', 'opening', 'pb', 'plan', 'score', 'after'].map(at), ['Before the night', 'Titles', 'Downtime', 'Briefing', 'Score', 'Close']);
  assert.equal(P.prepTarget('opening', ['Reopen the case', 'Opening titles']), 1, '"open" finds "Opening", never "Reopen"');
  assert.equal(P.prepTarget('score', ['Must land', 'Score']), 0, 'the first in the note wins, whichever word');
  assert.equal(P.prepTarget('plan', ['Nothing', 'Here']), -1);
  assert.equal(P.prepTarget('opening', heads, ['titles', 'open']), 3, 'a view gives its own words (Titles)');
  assert.equal(P.prepTarget('between', ['Index', 'Close']), 0, 'Between opens Prep at the Index');
});
await test('the run order and the note as Before reads them: start, curfew, cues, rooms (fenced and transcluded rooms do not count), a place per beat', () => {
  assert.deepEqual(P.roomsOf(NOTE), ['Boiler room', 'Counting house']);
  const f = P.facts(NOTE, Night, Cues);
  assert.equal(f.title, 'Session 9: the Lantern Works'); assert.equal(f.start, '19:30'); assert.equal(f.curfew, '22:40'); assert.equal(f.cues, 3); assert.equal(f.rooms, 2);
  assert.deepEqual(f.rows.map((r) => [r.place, r.min]), [['opening', 10], ['pb', 30], ['plan', 25], ['score', 90], ['after', 20]], 'the titles row belongs to the Opening by its words');
  assert.equal(P.placeOfText('Doors and the titles'), 'opening'); assert.equal(P.placeOfText('Nothing much'), '');
  assert.deepEqual(P.facts(null, Night, Cues), { title: '', start: null, curfew: null, cues: 0, rooms: 0, rows: [], budgets: {} }, 'no note: nothing claimed');
  assert.equal(P.facts(NOTE, null, null).cues, 0, 'without the night or the cue modules: no numbers, no crash');
});
await test('Find: every place ("Go to Planning") and every view and tool, with the words the GM types', () => {
  const rows = P.findEntries([{ id: 'xtool', label: 'X tool', words: 'xyz' }, { id: 'prep', label: 'shadow' }]);
  const titles = rows.map((r) => r.title);
  for (const t of ['Go to Before', 'Go to Opening', 'Go to Personal', 'Go to Planning', 'Go to Score', 'Go to Aftermath', 'Go to Between', 'Montage', 'Front page', 'Hard start', 'Preflight', 'The lair', 'Cast photo', 'Print', 'Debrief', 'Opportunity board', 'Trouble desk', 'Canon queue', 'Absent packet', 'Practical speaker', 'Ringing phone', 'Record the night', 'Light relay', 'Intel (the corkboard)', 'The Aftermath show', 'X tool']) assert.ok(titles.includes(t), t);
  assert.equal(titles.filter((t) => t === 'shadow').length, 0, 'a registered tool cannot shadow a view of the table');
  const go = (t) => rows.find((r) => r.title === t).go;
  assert.deepEqual(go('Go to Planning'), { t: 'place', id: 'plan' }); assert.deepEqual(go('Montage'), { t: 'view', id: 'montage' }); assert.deepEqual(go('X tool'), { t: 'view', id: 'xtool' });
  const words = (t) => [rows.find((r) => r.title === t).title, rows.find((r) => r.title === t).text].join(' ').toLowerCase();
  assert.ok(words('Practical speaker').includes('speaker') && words('Ringing phone').includes('ringing phone') && words('Intel (the corkboard)').includes('corkboard') && words('Go to Personal').includes('personal business'));
  assert.equal(rows.find((r) => r.title === 'Practical speaker').sub, 'Before', 'the place that lays it out');
  assert.match(rows.find((r) => r.title === 'Prep').sub, /^every place · R$/);
});
await test('memory: the place left is restored while the night\'s phase is the one it was; a phase that moved since wins; nonsense is dropped', () => {
  assert.deepEqual(P.restore(null, ''), { place: 'before', views: {}, extra: '' });
  assert.deepEqual(P.restore(null, 'plan'), { place: 'plan', views: {}, extra: '' });
  assert.deepEqual(P.restore({ place: 'opening', phase: '', views: { opening: 'frontpage', plan: 'nonsense', bogus: 'prep' } }, ''), { place: 'opening', views: { opening: 'frontpage' }, extra: '' });
  assert.equal(P.restore({ place: 'opening', phase: '' }, 'score').place, 'score', 'a phase entered elsewhere while the page was shut');
  assert.equal(P.restore({ place: 'between', phase: 'after' }, 'after').place, 'between');
  assert.equal(P.restore({ place: 'before', phase: 'plan' }, 'plan').place, 'before', 'navigated without moving the night: kept');
  assert.deepEqual(P.restore({ place: 'plan', phase: 'plan', views: { plan: 'chase' }, extra: { place: 'plan', view: 'chase' } }, 'plan'), { place: 'plan', views: { plan: 'chase' }, extra: 'chase' });
  assert.deepEqual(P.restore({ place: 'plan', phase: 'plan', views: { plan: 'chase', score: 'downtime' }, extra: { place: 'score', view: 'chase' } }, 'plan'), { place: 'plan', views: {}, extra: '' }, 'an extra view of another place does not come back');
});

/* ---------- the controller, against a host with no page: what it asks, what it keeps ---------- */
function harness(o = {}) {
  const ls = new Map(o.stored ? [[P.KEY, JSON.stringify(o.stored)]] : []);
  const night = { phase: o.phase || '' }, calls = [];
  const W = { localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)) }, console };
  /* just enough page: the containers the controller fills, each a box that keeps its markup and finds nothing inside it */
  const box = () => ({ innerHTML: '', hidden: false, attrs: {}, setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} } });
  const parts = { '.gm-views': box(), '.gm-vchips': box(), '#gm-left': box(), '#gm-vhead': box(), '#gm-vpane': box(), '#gm-prep': box() };
  const rootEl = Object.assign(box(), { querySelector: (sel) => parts[sel] || null, addEventListener() {} });
  const host = {
    root: () => rootEl, phase: () => night.phase,
    enter: (p) => { calls.push('enter:' + p); night.phase = p; ctl && ctl.sync(); return true; },
    showPane: (p) => { calls.push('pane:' + p); ctl && ctl.sync(); }, seg: (s) => calls.push('seg:' + s), sheetOpen: (id) => { calls.push('sheet:' + id); return true; }, toast() {},
    endOpening: () => { calls.push('endOpening'); return Promise.resolve(true); }
  };
  const M = require(path.join(ROOT, 'app', 'gm', 'places.js'));   /* the module's factory took the real global; create() reads W through the closure, so give it ours */
  let ctl = null;
  const make = new Function('W', 'host', 'src', 'var module = { exports: {} }; (new Function("module", "self", src))(module, W); return module.exports.create(host);');
  ctl = make(W, host, require('node:fs').readFileSync(path.join(ROOT, 'app', 'gm', 'places.js'), 'utf8'));
  void M;
  return { ctl, calls, night, ls, stored: () => JSON.parse(ls.get(P.KEY) || 'null') };
}
await test('controller: on load, Before with no phase; a phase place for a phase in play; mount shows the place\'s first view', () => {
  let h = harness(); h.ctl.mount();
  assert.equal(h.ctl.currentPlace(), 'before'); assert.equal(h.ctl.currentView(), 'tonight'); assert.ok(h.calls.includes('pane:view'), 'Tonight is drawn in the view pane');
  h = harness({ phase: 'score' }); h.ctl.mount();
  assert.equal(h.ctl.currentPlace(), 'score'); assert.equal(h.ctl.currentView(), 'run'); assert.ok(h.calls.includes('pane:run'), 'the site');
});
await test('controller: goPlace on a phase place enters the phase (once); navigateOnly does not; Before, Opening and Between never do', () => {
  const h = harness(); h.ctl.mount();
  h.ctl.goPlace('plan'); assert.equal(h.night.phase, 'plan'); assert.equal(h.calls.filter((c) => c === 'enter:plan').length, 1); assert.equal(h.ctl.currentPlace(), 'plan'); assert.equal(h.ctl.currentView(), 'cards');
  h.ctl.goPlace('plan'); assert.equal(h.calls.filter((c) => c.startsWith('enter:')).length, 1, 'the same place again: no second entry');
  h.ctl.goPlace('score', { navigateOnly: true }); assert.equal(h.night.phase, 'plan', 'navigation only'); assert.equal(h.ctl.currentPlace(), 'score');
  for (const id of ['before', 'opening', 'between']) { h.ctl.goPlace(id); assert.equal(h.night.phase, 'plan', id + ' never changes the phase'); }
  assert.equal(h.ctl.goPlace('nowhere'), false);
  h.ctl.stepPlace(-1); assert.equal(h.ctl.currentPlace(), 'after', 'Ctrl+left from Between'); assert.equal(h.night.phase, 'plan');
});
await test('controller: follow the night: a phase moved any other way takes the page there, except in Between', () => {
  const h = harness(); h.ctl.mount();
  h.night.phase = 'pb'; h.ctl.sync(); assert.equal(h.ctl.currentPlace(), 'pb');
  h.ctl.goPlace('opening'); h.ctl.sync(); assert.equal(h.ctl.currentPlace(), 'opening', 'a sync with the phase unchanged leaves the GM where they went');
  h.night.phase = 'score'; h.ctl.sync(); assert.equal(h.ctl.currentPlace(), 'score');
  h.ctl.goPlace('between'); h.night.phase = 'after'; h.ctl.sync(); assert.equal(h.ctl.currentPlace(), 'between', 'Between is not followed out of');
  h.ctl.goPlace('after', { navigateOnly: true }); h.night.phase = ''; h.ctl.sync(); assert.equal(h.ctl.currentPlace(), 'after', 'a night reset moves nobody');
});
await test('controller: openView in the current place; a view the place does not list becomes its extra view, dropped by × or by leaving', () => {
  const h = harness({ phase: 'plan' }); h.ctl.mount();
  h.ctl.openView('chase'); assert.equal(h.ctl.currentPlace(), 'plan', 'never sent to another place'); assert.equal(h.ctl.currentView(), 'chase'); assert.equal(h.ctl._state().extra, 'chase');
  h.ctl.openView('scenes'); assert.equal(h.ctl._state().extra, 'scenes', 'one extra at a time: the newest');
  h.ctl.openView('prep'); assert.equal(h.ctl._state().extra, 'scenes', 'a pinned view leaves the extra in the switcher'); assert.equal(h.ctl.currentView(), 'prep');
  h.ctl.dropExtra(); assert.equal(h.ctl._state().extra, ''); assert.equal(h.ctl.currentView(), 'prep', 'dropped while not showing: the view stays');
  h.ctl.openView('montage'); h.ctl.dropExtra(); assert.equal(h.ctl.currentView(), 'prep', 'dropped while showing: back to the view before it');
  h.ctl.openView('downtime'); h.ctl.goPlace('score', { navigateOnly: true }); h.ctl.goPlace('plan', { navigateOnly: true });
  assert.equal(h.ctl._state().extra, ''); assert.notEqual(h.ctl.currentView(), 'downtime', 'leaving the place drops its extra view');
  assert.equal(h.ctl.openView('nonsense'), false);
});
await test('controller: a tool the place lays out is shown where it is (the left column, The room, Opportunities, a desk), never a second copy', () => {
  const h = harness(); h.ctl.mount();
  h.ctl.openView('practical'); assert.equal(h.ctl.currentView(), 'room'); assert.equal(h.ctl._state().extra, '');
  h.ctl.openView('preflight'); assert.equal(h.ctl.currentView(), 'room', 'Before\'s left column holds Preflight: the view stays'); assert.ok(h.calls.includes('seg:console'), 'a phone shows the left column');
  h.ctl.goPlace('plan', { navigateOnly: true }); h.ctl.openView('board'); assert.equal(h.ctl.currentView(), 'cards');
  h.ctl.goPlace('between'); h.ctl.openView('lair'); assert.equal(h.ctl.currentView(), 'desks'); assert.equal(h.ctl._state().desk, 'lair');
  h.ctl.openView('score'); assert.equal(h.ctl._state().desk, 'gen:score', 'a generator is a desk Between');
  h.ctl.openView('npc'); assert.equal(h.ctl.currentView(), 'npc'); assert.equal(h.ctl._state().desk, '', 'Cast is pinned: no desk');
  h.ctl.goPlace('opening'); h.ctl.openView('preflight'); assert.equal(h.ctl._state().extra, 'preflight', 'elsewhere a left-column tool is an extra view');
});
await test('controller: arriving shows the place\'s last view; Prep read while the place changes stays Prep (the notes follow the night)', () => {
  const h = harness(); h.ctl.mount();
  h.ctl.goPlace('plan', { navigateOnly: true }); h.ctl.openView('run');
  h.ctl.goPlace('score', { navigateOnly: true }); assert.equal(h.ctl.currentView(), 'run');
  h.ctl.openView('chase'); h.ctl.goPlace('plan', { navigateOnly: true }); assert.equal(h.ctl.currentView(), 'run', 'Planning remembers The site');
  h.ctl.goPlace('score', { navigateOnly: true }); assert.equal(h.ctl.currentView(), 'chase', 'Score remembers Chase');
  h.ctl.openView('prep'); h.ctl.goPlace('after', { navigateOnly: true }); assert.equal(h.ctl.currentView(), 'prep', 'Prep stays');
  h.ctl.openView('aftermath'); h.ctl.goPlace('pb', { navigateOnly: true }); assert.equal(h.ctl.currentView(), 'downtime', 'any other view: the place\'s own');
});
await test('controller: the memory is written as the GM moves, and a new page restores it (phase unchanged), with the extra view', () => {
  const h = harness({ phase: 'plan' }); h.ctl.mount();
  h.ctl.goPlace('before', { navigateOnly: true }); h.ctl.openView('print'); h.ctl.goPlace('plan', { navigateOnly: true }); h.ctl.openView('chase');
  const s = h.stored(); assert.equal(s.place, 'plan'); assert.equal(s.phase, 'plan'); assert.equal(s.views.before, 'print'); assert.deepEqual(s.extra, { place: 'plan', view: 'chase' });
  const again = harness({ phase: 'plan', stored: s }); again.ctl.mount();
  assert.equal(again.ctl.currentPlace(), 'plan'); assert.equal(again.ctl.currentView(), 'chase'); assert.equal(again.ctl._state().extra, 'chase');
  again.ctl.goPlace('before', { navigateOnly: true }); assert.equal(again.ctl.currentView(), 'print', 'Before remembers Print');
  const moved = harness({ phase: 'score', stored: s }); moved.ctl.mount(); assert.equal(moved.ctl.currentPlace(), 'score', 'the night moved since: its place');
});
await test('controller: callAftermath enters the Aftermath, goes there and opens the show; without the inline host it opens in its sheet', () => {
  const h = harness({ phase: 'score' }); h.ctl.mount();
  h.ctl.callAftermath();
  assert.equal(h.night.phase, 'after'); assert.equal(h.ctl.currentPlace(), 'after'); assert.equal(h.ctl.currentView(), 'aftermath');
  assert.ok(h.calls.includes('sheet:aftermath'), 'the show opened in its sheet: ' + h.calls.join(','));
  assert.equal(h.calls.filter((c) => c === 'enter:after').length, 1, 'entered once');
});
await test('controller: a roll in a place whose column is its own brings the Roll into the column until the GM leaves', () => {
  const h = harness(); h.ctl.mount();
  h.ctl.rolled(); assert.equal(h.ctl._state().rollHere, true);
  h.ctl.goPlace('opening'); assert.equal(h.ctl._state().rollHere, false, 'leaving takes it back');
  h.ctl.goPlace('plan', { navigateOnly: true }); h.ctl.rolled(); assert.equal(h.ctl._state().rollHere, false, 'the Roll is the column already');
});
await test('T10: the way forward: Next and ← Back go along the night (Before to the Aftermath); ahead() says when Next starts a phase', () => {
  assert.deepEqual(['before', 'opening', 'pb', 'plan', 'score', 'after', 'between'].map(P.nextOf), ['opening', 'pb', 'plan', 'score', 'after', '', '']);
  assert.deepEqual(['before', 'opening', 'pb', 'plan', 'score', 'after', 'between'].map(P.backOf), ['', 'before', 'opening', 'pb', 'plan', 'score', '']);
  assert.equal(P.ahead('pb', ''), true, 'no phase yet: Personal starts it'); assert.equal(P.ahead('plan', 'pb'), true); assert.equal(P.ahead('after', 'score'), true);
  assert.equal(P.ahead('plan', 'plan'), false, 'the phase the night is in'); assert.equal(P.ahead('pb', 'score'), false, 'a phase the night is past');
  assert.equal(P.ahead('opening', ''), false, 'Opening is no phase'); assert.equal(P.ahead('nowhere', ''), false);
});
await test('T10 controller: Next does what the chip does (Opening also ends the hard start and the credits); ← Back only looks; Back then Next never winds the night back', () => {
  const h = harness(); h.ctl.mount();
  assert.equal(h.ctl.back(), false, 'Before has nothing before it');
  h.ctl.next(); assert.equal(h.ctl.currentPlace(), 'opening'); assert.equal(h.night.phase, '', 'Opening is no phase'); assert.ok(!h.calls.includes('endOpening'), 'only the Opening’s Next ends the Opening');
  h.ctl.next(); assert.equal(h.ctl.currentPlace(), 'pb'); assert.equal(h.night.phase, 'pb', 'Personal business started, as its chip does');
  assert.equal(h.calls.filter((c) => c === 'endOpening').length, 1, 'the Opening’s Next took the hard start and the credits down');
  h.ctl.next(); assert.equal(h.night.phase, 'plan'); h.ctl.next(); assert.equal(h.night.phase, 'score'); assert.equal(h.ctl.currentPlace(), 'score');
  h.ctl.back(); assert.equal(h.ctl.currentPlace(), 'plan'); assert.equal(h.night.phase, 'score', '← Back only looks');
  h.ctl.back(); assert.equal(h.ctl.currentPlace(), 'pb'); assert.equal(h.night.phase, 'score');
  h.ctl.next(); assert.equal(h.ctl.currentPlace(), 'plan'); assert.equal(h.night.phase, 'score', 'Next to a phase the night is past: a look, not a rewind');
  h.ctl.next(); assert.equal(h.ctl.currentPlace(), 'score'); assert.equal(h.calls.filter((c) => c.startsWith('enter:')).length, 3, 'pb, plan, score: each entered once');
  h.ctl.next(); assert.equal(h.ctl.currentPlace(), 'after'); assert.equal(h.night.phase, 'after', 'the Aftermath started');
  assert.equal(h.ctl.next(), false, 'nothing after the Aftermath');
});
await test('tools.js: the pane registry without the phase filter or the Workshop flag; the same object a later module can extend', () => {
  Tools.reset();
  for (const k of ['setFilter', 'filter', 'visible', 'onChange', 'phasesOf', 'inPhase', 'tabs', 'workshop', 'PHASES', 'ALL']) assert.equal(Tools[k], undefined, k + ' is gone');
  assert.deepEqual(Tools.list().map((t) => t.id), ['console', 'prep', 'rules', 'location', 'scenes', 'score', 'chase', 'npc', 'downtime', 'cards', 'ipad', 'run']);
  assert.ok(Tools.list().every((t) => t.builtin === true && !('workshop' in t) && !('phases' in t)));
  for (const id of P.PINNED.concat(['run', 'location', 'scenes', 'score', 'chase', 'downtime', 'cards'])) assert.equal(Tools.get(id).label, P.view(id).label, id + ': the same label as the places give it');
  const t = Tools.register({ id: 'testtool', label: 'Test tool', phases: ['plan'], workshop: true, key: 'q', words: 'probe', mount() {} });
  assert.equal(t.key, 'Q'); assert.equal(t.words, 'probe'); assert.ok(!('phases' in t) && !('workshop' in t), 'an older def\'s phases and workshop are ignored');
  assert.deepEqual(Tools.extras().map((x) => x.id), ['testtool']);
  assert.throws(() => Tools.register({ id: 'prep', label: 'x' }), /built in/); assert.equal(Tools.unregister('testtool'), true); assert.equal(Tools.unregister('prep'), false);
  Tools.reset();
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
