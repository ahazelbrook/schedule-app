// Unit test for THE SITE (the GM night rebuild, N3; no browser, no network): the page's half (app/gm/site.js) and the Run view's new parts (app/gm/run-view.js):
// the ONE alarm readout, the toolbar and the stage group, the rooms' states, the Players' map (Seen stages, Send opens), the people, If it goes wrong, every
// data-site action, the Costume engine, the site line, the map's label marks, the header on one line, the ⋯ menu, the board's tints, the room card, the data-site
// route, the Esc registrations and the inline tool host. Invented fixtures only (the Pelican Rooms, pelican-play-v2.json); GM-only strings are GM-ONLY- markers.
//   node checks/runtime/gm-site.test.mjs
import path from 'node:path';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const B = require(path.join(ROOT, 'app', 'gm', 'ball.js'));
const R = require(path.join(ROOT, 'app', 'gm', 'run-view.js'));
const Site = require(path.join(ROOT, 'app', 'gm', 'site.js'));
const St = require(path.join(ROOT, 'app', 'gm', 'stage.js'));
const Se = require(path.join(ROOT, 'app', 'gm', 'security.js'));
const Sp = require(path.join(ROOT, 'app', 'gm', 'spotlight.js'));
const KN = require(path.join(ROOT, 'app', 'gm', 'knowledge.js'));
const raw = JSON.parse(readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'pelican-play-v2.json'), 'utf8'));
const ROOMS = ['Showroom', 'Cocktail lounge', 'Underground counting room', 'Security control room', 'Private card rooms', 'Luxury penthouse'];
const BANDS = { 'Showroom': 'public', 'Cocktail lounge': 'public', 'Underground counting room': 'working', 'Security control room': 'working', 'Private card rooms': 'controlled', 'Luxury penthouse': 'secure' };
const play = B.checkPlay(raw, ROOMS).play;

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* ---------- the pure parts ---------- */
await test('intelFor: the intel that tells of a room, by its events, a way said or due there, a route from or to it; play order, once each', () => {
  const ids = (room) => R.intelFor(play, room).map((x) => x.id).join();
  assert.equal(ids('Showroom'), 'I1,I3'); assert.equal(ids('Private card rooms'), 'I2,I4'); assert.equal(ids('Cocktail lounge'), 'I2');
  assert.equal(ids('Underground counting room'), 'I3'); assert.equal(ids('Luxury penthouse'), ''); assert.equal(ids('Security control room'), '');
  assert.equal(ids(''), ''); assert.deepEqual(R.intelFor(null, 'Showroom'), []);
});

await test('noteMd: the one-line "If it goes wrong" lines leave the note (the card shows them as action lines); a bare label, other lines and code stay', () => {
  const md = ['### Lobby', '- **Costume:** a coat', '- If it goes wrong: the GM-ONLY-guard turns', '> **If it goes wrong** — the door locks', 'If it goes wrong', '- a bullet under it', '```', 'If it goes wrong: in code', '```', 'SAY: hello'].join('\n');
  const out = Site.noteMd(md);
  assert.ok(!/the GM-ONLY-guard turns/.test(out) && !/the door locks/.test(out), out);
  assert.ok(/^If it goes wrong$/m.test(out) && /a bullet under it/.test(out) && /If it goes wrong: in code/.test(out) && /Costume/.test(out) && /SAY: hello/.test(out));
  assert.equal(Site.noteMd(''), '');
});

/* ---------- the site's page half, on a fake page ---------- */
function rig(opts = {}) {
  const log = { toasts: [], redraw: 0, threat: [], intro: [], montage: [], dawn: 0, layers: [], shows: [] };
  const ball = { open: [], know: [] }, clocks = opts.noClock ? {} : { Fuse: { name: 'Fuse', size: 6, filled: 2, hidden: !!opts.hidden } };
  const feature = () => true;
  const rooms = () => ROOMS.map((n) => ({ name: n, band: BANDS[n] }));
  const kn = KN.create({ feature: (id) => id === 'map.knowledge', rooms, ctx: () => ({ open: ball.open, know: ball.know, bands: ['public'] }), floors: () => [],
    write: (o, k) => { ball.open = o; ball.know = k; return true; }, toast: (m, bad) => log.toasts.push([m, !!bad]), changed() {} });
  const stage = St.create({ feature, rooms, opened: () => ball.open.slice(), shown: (n) => BANDS[n] === 'public', setOpen: (names) => { ball.open = names.slice(); ball.know = ball.know.filter((n) => names.indexOf(n) < 0); return true; },
    liveText: () => opts.live || '', dark: () => Promise.resolve(), toast: (m, bad) => log.toasts.push([m, !!bad]), changed() {} });
  const security = Se.create({ feature, alarm: () => (clocks.Fuse ? { size: clocks.Fuse.size, filled: clocks.Fuse.filled, visible: !clocks.Fuse.hidden } : null), names: () => null, key: () => 'k',
    layer: (p, v) => { log.layers.push(v); return Promise.resolve({}); }, show: (k, p) => { log.shows.push(p); return Promise.resolve({}); } });
  const CAST = [{ id: 'npc-od', name: 'Odette Marsh', alias: '', role: 'GM-ONLY-ROLE', revealed: true }, { id: 'npc-x', name: 'GM-ONLY-Hidden One', alias: '', revealed: false }];
  const holds = [];
  const spot = Sp.create({ feature, npcs: () => CAST, roomMd: (r) => (r === 'Showroom' ? '- **Who:** GM-ONLY-Hidden One\n- If it goes wrong: GM-ONLY-the guard turns' : ''), here: () => [], focusRoom: () => 'Showroom',
    hold: (id) => { holds.push(id); return Promise.resolve({ ok: true }); }, clear: () => Promise.resolve({}), overlayId: () => 'b17sl-1', confirm: () => true, reveal: () => Promise.resolve(), notes: () => '', toast: (m) => log.toasts.push([m, false]), changed() {},
    setTimeout: () => 1, clearTimeout() {} });
  const beats = { spotted: { on: () => true, busy: () => false, run: () => { log.spotted = (log.spotted || 0) + 1; return Promise.resolve({}); } },
    flashback: { on: () => true, up: () => !!opts.flash, pinned: () => opts.pin || '', toggle: () => { log.flash = (log.flash || 0) + 1; }, pin: () => { log.pinned = (log.pinned || 0) + 1; } } };
  const page = { toast: (m, bad) => log.toasts.push([m, !!bad]), rerender: () => { log.redraw++; },
    stage: () => stage, security: () => security, spot: () => spot, knowledge: () => kn, beats: () => beats,
    play: () => (opts.noPlay ? null : play), siteKind: () => opts.kind || 'v2', clock: (n) => clocks[n] || null, rooms, npcs: () => CAST,
    card: (names) => names.indexOf('Odette Marsh') >= 0, face: (id) => (id === 'npc-od' ? '<svg data-face="od"></svg>' : ''),
    roomMd: (r) => (r === 'Showroom' ? '- **Who:** GM-ONLY-Hidden One\n- If it goes wrong: GM-ONLY-the guard turns' : ''),
    scoreOver: () => !!opts.over, montageOpen: () => false, montage: (v) => log.montage.push(v), dawn: () => { log.dawn++; }, introduce: (id) => log.intro.push(id),
    setThreat: (t) => { log.threat.push(t); return !opts.noRoll; }, lineShown: () => true };
  if (opts.noSetThreat) delete page.setThreat;
  return { site: Site.create(page), log, ball, stage, security, spot, kn, holds, clocks };
}
const el = (attrs, extra) => Object.assign({ getAttribute: (k) => (k in attrs ? attrs[k] : null) }, extra || {});

await test('the ONE alarm: the table clock\'s segments and the level from it; the popover names the clock and this beat; a missing clock is stepped by hand', () => {
  const r = rig();
  security(r);
  function security(x) { x.security.tick(); }
  const h = r.site.alarm(false, 'data-rv="alarm"');
  assert.match(h, /data-rv="alarm"/); assert.equal((h.match(/<i class="f"><\/i>/g) || []).length, 2); assert.equal((h.match(/<i><\/i>/g) || []).length, 4); assert.match(h, /<b class="rv-alevel">Watchful<\/b>/);
  const pop = r.site.alarmPop(false);
  assert.match(pop, /<b>Fuse 2:<\/b> GM-ONLY-BEAT-2/); assert.match(pop, /Security <b>Watchful<\/b>/);
  const m = rig({ noClock: true }); const pm = m.site.alarmPop(true);
  assert.match(pm, /data-gm="site" data-site="sec-up"/); assert.match(pm, /No table clock is called Fuse/);
  const quiet = rig({ hidden: true }); quiet.security.tick(); assert.deepEqual(quiet.log.layers, [], 'a hidden clock: no level on the iPad');
});

await test('the toolbar: Spotted, Flashback (Back while up), Pin (pressed with its room), Montage (glows past the budget); the stage group only when it has something to say', () => {
  const r = rig({ over: true, flash: true, pin: 'Showroom' });
  const t = r.site.tools();
  assert.match(t, /data-site="spotted"/); assert.match(t, /data-site="flashback" aria-pressed="true"[^>]*>Back</); assert.match(t, /data-site="pin" aria-pressed="true" title="The pin is on Showroom/);
  assert.match(t, /class="rv-btn sm rv-tog rv-montage glow" data-site="montage"/);
  assert.doesNotMatch(rig().site.tools(), /glow/, 'within budget: no glow');
  assert.equal(r.site.stage(), '', 'nothing staged or live: no stage group');
  r.stage.stage('Private card rooms'); assert.match(r.site.stage(), /Send <b>1<\/b>/);
});

await test('select, then act: Dark and Blueprint at once, Seen stages (amber), Seen again unstages, Dark unstages and darkens, Send opens and leaves blueprint', () => {
  const r = rig(), act = (k, room) => r.site.act('kn', el({ 'data-k': k, 'data-room': room }));
  act('blueprint', 'Private card rooms'); assert.deepEqual(r.ball.know, ['Private card rooms']); assert.deepEqual(r.stage.staged(), []);
  act('seen', 'Private card rooms'); assert.deepEqual(r.stage.staged(), ['Private card rooms'], 'Seen stages it'); assert.deepEqual(r.ball.open, [], 'nothing opened yet');
  assert.deepEqual(r.site.states()['Private card rooms'], { k: 'blueprint', staged: true, band: 'controlled' });
  assert.match(r.site.seg('Private card rooms'), /Seen · staged/);
  act('seen', 'Private card rooms'); assert.deepEqual(r.stage.staged(), [], 'Seen again: unstaged');
  act('seen', 'Private card rooms'); act('seen', 'Luxury penthouse'); assert.deepEqual(r.stage.staged(), ['Private card rooms', 'Luxury penthouse']);
  act('dark', 'Luxury penthouse'); assert.deepEqual(r.stage.staged(), ['Private card rooms'], 'Dark unstages'); assert.equal(r.kn.stateOf('Luxury penthouse'), 'dark');
  r.site.act('send', el({})); assert.deepEqual(r.ball.open, ['Private card rooms']); assert.deepEqual(r.ball.know, [], 'sent: seen, out of the blueprint list'); assert.deepEqual(r.stage.staged(), []);
  act('seen', 'Showroom'); assert.deepEqual(r.stage.staged(), [], 'a room its band shows cannot be staged');
  r.site.act('intel', el({ 'data-group': 'band:working' })); assert.deepEqual(r.ball.know.sort(), ['Security control room', 'Underground counting room']);
  assert.ok(r.log.redraw >= 6, 'each act redraws the site');
});

await test('the people: rows with faces and Card where there is one; Spotlight toggles (held -> Take it down), the face looks, Introduce, Card opens the view\'s NPC card, Add and take off', async () => {
  const r = rig();
  const h = r.site.people('Showroom', [{ label: 'Odette Marsh', kind: 'target', npc: '', moving: null }]);
  assert.match(h, /<svg data-face="od"><\/svg>/); assert.match(h, /data-site="card" data-name="Odette Marsh"/); assert.match(h, /GM-ONLY-Hidden One/);
  assert.equal((h.match(/data-site="spot"/g) || []).length, 2);
  r.site.act('spot', el({ 'data-id': 'npc-od' })); await new Promise((res) => setTimeout(res, 5));
  assert.deepEqual(r.holds, ['npc-od']); assert.equal(r.spot.held(), 'npc-od');
  assert.match(r.site.people('Showroom', [{ label: 'Odette Marsh', kind: 'target', npc: '' }]), /data-site="down"/, 'held, in her room: Take it down on her row');
  const away = r.site.people('Luxury penthouse', [], true);
  assert.match(away, /held on the iPad/); assert.match(away, /data-site="down"/, 'the top card shows whoever is held, wherever they are');
  assert.doesNotMatch(r.site.people('Luxury penthouse', [], false), /data-site="down"/, 'the other cards do not');
  r.site.act('spot', el({ 'data-id': 'npc-od' })); await new Promise((res) => setTimeout(res, 5)); assert.equal(r.spot.held(), '', 'tapping the held one takes it down');
  r.site.act('intro', el({ 'data-id': 'npc-od' })); assert.deepEqual(r.log.intro, ['npc-od']);
  let shown = null; r.site.act('card', el({ 'data-name': 'Odette Marsh' }), { showNpc: (n, t) => { shown = [n, t]; } }); assert.deepEqual(shown, [['Odette Marsh'], 'Odette Marsh']);
  const inp = { value: 'Odette Marsh' }; r.site.act('who-add', el({ 'data-room': 'Luxury penthouse' }, { querySelector: () => inp }));
  assert.deepEqual(r.spot.extras('Luxury penthouse'), ['npc-od']); assert.equal(inp.value, '', 'the field empties');
  r.site.act('who-x', el({ 'data-room': 'Luxury penthouse', 'data-id': 'npc-od' })); assert.deepEqual(r.spot.extras('Luxury penthouse'), []);
});

await test('If it goes wrong: the room\'s lines; "→ the Roll" hands the line to the Roll (the page\'s setThreat: N4\'s B68GmPage.setThreat), and says so; a Roll that declines it, or none, says which', () => {
  const r = rig(); assert.deepEqual(r.site.wrong('Showroom'), ['GM-ONLY-the guard turns']); assert.deepEqual(r.site.wrong('Luxury penthouse'), []);
  r.site.act('threat', el({ 'data-text': 'GM-ONLY-the guard turns' })); assert.deepEqual(r.log.threat, ['GM-ONLY-the guard turns']);
  assert.ok(r.log.toasts.some(([m, bad]) => !bad && m === 'On the Roll: GM-ONLY-the guard turns'), JSON.stringify(r.log.toasts));
  const n = rig({ noRoll: true }); n.site.act('threat', el({ 'data-text': 'x' })); assert.ok(n.log.toasts.some(([m, bad]) => bad && /did not take that line/.test(m)), 'declined');
  const z = rig({ noSetThreat: true }); z.site.act('threat', el({ 'data-text': 'x' })); assert.ok(z.log.toasts.some(([m, bad]) => bad && /not on this page/.test(m)), 'no Roll at all');
});

await test('the rest of the acts: the alarm steps by hand, Spotted, Flashback, Pin, Montage, the stage\'s Freeze and Blank, the Costume engine', async () => {
  const r = rig({ noClock: true });
  r.site.act('sec-up', el({})); assert.equal(r.security.view().name, 'Watchful'); r.site.act('sec-down', el({})); assert.equal(r.security.view().name, 'Quiet');
  r.site.act('spotted', el({})); r.site.act('flashback', el({})); r.site.act('pin', el({})); assert.deepEqual([r.log.spotted, r.log.flash, r.log.pinned], [1, 1, 1]);
  const view = { id: 'v' }; r.site.act('montage', el({}), view); assert.deepEqual(r.log.montage, [view]);
  r.site.act('freeze', el({})); assert.equal(r.stage.holding(), true); r.site.act('freeze', el({})); assert.equal(r.stage.holding(), false);
  r.site.act('blank', el({})); await new Promise((res) => setTimeout(res, 5)); assert.equal(r.stage.view().blanked, true);
  assert.equal(r.site.costume(), false, 'hidden by default (no storage here)');
});

await test('the site line (no v2 night): the readout by hand with data-gm="site", the stage group re-routed to the page, the Costume engine for a v1 site', () => {
  const roll = rig({ noClock: true, noPlay: true, kind: 'roll', live: 'the public band' });
  const l = roll.site.line();
  assert.match(l, /class="rv-siteline"/); assert.match(l, /data-gm="site" data-site="alarm"/); assert.match(l, /data-gm="site" data-site="freeze"/); assert.match(l, /LIVE · the public band/);
  assert.doesNotMatch(l, /costume/, 'a rolled location has no Disguise select');
  roll.site.act('alarm', el({})); assert.match(roll.site.line(), /data-gm="site" data-site="sec-up"/, 'the popover opens in the line');
  const v1 = rig({ noClock: true, noPlay: true, kind: 'v1' }); assert.match(v1.site.line(), /data-gm="site" data-site="costume" aria-pressed="false"[^>]*>Costume engine: hidden</);
});

await test('the map\'s labels: each room\'s label (by its number badge) carries dark, blueprint, seen, staged and selected; others are left alone', () => {
  const r = rig(); r.site.act('kn', el({ 'data-k': 'blueprint', 'data-room': 'Private card rooms' })); r.stage.stage('Luxury penthouse');
  const mk = (n) => { const cls = new Set(['room-label']); return { cls, querySelector: () => ({ textContent: String(n) }), classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c) } }; };
  const labels = [1, 5, 6, 9].map(mk), svg = { querySelectorAll: () => labels };
  const model = { rooms: [{ n: 1, name: 'Showroom' }, { n: 5, name: 'Private card rooms' }, { n: 6, name: 'Luxury penthouse' }] };
  assert.equal(r.site.mapMarks(svg, model, 'Showroom'), 3);
  assert.deepEqual(labels.map((l) => [...l.cls].filter((c) => c !== 'room-label').sort().join()), ['rv-mk-seen,rv-mk-sel', 'rv-mk-blueprint', 'rv-mk-dark,rv-mk-staged', '']);
  assert.equal(r.site.mapMarks(null, model, ''), 0);
});

/* ---------- the Run view's new parts, on a fake box (the node rig of gm-run-view.test.mjs) ---------- */
const floors = { list: [{ lvl: -1, name: 'Under' }, { lvl: 0, name: 'Ground' }, { lvl: 1, name: 'Upper' }, { lvl: 2, name: 'Loft' }],
  floorOf: { 'Showroom': 0, 'Cocktail lounge': 0, 'Underground counting room': -1, 'Security control room': 1, 'Private card rooms': 1, 'Luxury penthouse': 2 } };
const PCS = [{ id: 'p1', name: 'Cass Fenn' }];
const dummy = () => ({ innerHTML: '', textContent: '', hidden: false, onclick: null, style: {}, setAttribute() {}, getAttribute() { return null; }, removeAttribute() {}, querySelector() { return null; }, querySelectorAll() { return []; }, classList: { add() {}, remove() {} } });
function viewRig(state, extra = {}) {
  const r = { state, sets: [], acts: [], handlers: {} };
  r.host = Object.assign({
    site: () => ({ name: 'The Pelican Rooms', play }), state: () => r.state, set: (c) => { r.sets.push(c); r.state = Object.assign({}, r.state, c); return true; }, pcs: () => PCS, floors: () => floors,
    isOpen: (n) => BANDS[n] === 'public', openRoom() {}, mapSvg: () => '', clockNamed: () => ({ name: 'Fuse', size: 6, filled: 2 }), publish() {}, toast() {}, confirm: () => true, resetMission: () => Promise.resolve(),
    alarmHtml: (open) => '<button type="button" class="rv-alarm" data-rv="alarm" aria-expanded="' + open + '">ALARM-READOUT</button>', alarmPop: () => '<div class="rv-pop rv-alarmpop">ALARM-POP</div>',
    toolsHtml: () => '<button data-site="spotted">Spotted</button>', stageHtml: () => '<span class="rv-stage">STAGE-GROUP</span>',
    roomStates: () => ({ 'Showroom': { k: 'seen', staged: false, band: 'public' }, 'Private card rooms': { k: 'blueprint', staged: true, band: 'controlled' }, 'Luxury penthouse': { k: 'dark', staged: false, band: 'secure' } }),
    knowledgeSeg: (n) => '<div class="rv-kseg">SEG:' + n + '</div>', peopleHtml: (n, ppl, first) => '<ul class="rv-ppl">PEOPLE:' + n + ':' + ppl.length + ':' + (first ? 'first' : '') + '</ul>', roomWrong: (n) => (n === 'Showroom' ? ['GM-ONLY-wrong'] : []),
    intelGroups: () => [{ id: 'band:working', label: 'The working band' }], costume: () => false, dawn() {}, siteAct: (a, e) => r.acts.push([a, e.getAttribute('data-x')]), feature: () => true
  }, extra);
  r.view = R.create(r.host); r.parts = {};
  r.box = Object.assign(dummy(), { querySelector: (s) => (r.parts[s] = r.parts[s] || dummy()), addEventListener: (k, fn) => { r.handlers[k] = fn; }, contains: () => true, ownerDocument: { createElement: () => Object.assign(dummy(), { parentNode: null, className: '' }) } });
  r.html = () => r.box.innerHTML + Object.keys(r.parts).map((k) => r.parts[k].innerHTML).join('');      /* the skeleton, then what each part was drawn with */
  r.view.attach(r.box); r.view.render(r.box);
  r.click = (rv) => r.handlers.click({ target: { closest: (s) => (/data-site/.test(s) ? null : /rv-pop/.test(s) ? null : { getAttribute: (k) => (k === 'data-rv' ? rv : null) }) }, preventDefault() {} });
  r.clickSite = (a, x) => r.handlers.click({ target: { closest: (s) => (/^\[data-site\]$/.test(s) ? { tagName: 'BUTTON', getAttribute: (k) => (k === 'data-site' ? a : k === 'data-x' ? x : null), closest: () => null } : null) }, preventDefault() {} });
  return r;
}
const NIGHT = { v: 2, site: 'The Pelican Rooms', start: 45, t: 45, crew: { p1: { room: 'Showroom' } } };

await test('the header: the time opens the night\'s squares and the timer\'s rest (drawn shut), the timer is one play/pause button, the ONE alarm is the page\'s, then Players and ⋯', () => {
  const r = viewRig({ ...NIGHT }), h = r.box.innerHTML;
  const head = h.split('</div>')[0];
  assert.ok(/data-rv="timepop" aria-haspopup="dialog" aria-expanded="false"/.test(h) && /<output class="rv-time" id="rv-time"[^>]*>21:45<\/output>/.test(h));
  assert.ok(/class="rv-pop rv-timepop"[^>]*hidden>/.test(h), 'the time popover is drawn shut'); assert.ok(/class="rv-sq/.test(h) && /data-rv="tadd5"/.test(h), 'its squares and the timer\'s rest are in it');
  assert.ok(/class="rv-btn sm rv-tgo" data-rv="tgo"/.test(h) && /<span class="rv-sr">Start <\/span><output/.test(h), 'the timer: one button, paused, says Start');
  assert.ok(/ALARM-READOUT/.test(h) && !/ALARM-POP/.test(h), 'the page\'s readout, its popover shut');
  assert.ok(h.indexOf('rv-players') > h.indexOf('ALARM-READOUT') && h.indexOf('data-rv="menu"') > h.indexOf('rv-players'), 'Players, then ⋯, last on the line');
  assert.ok(!/data-rv="reset"/.test(head), 'Reset the night is not on the header\'s line any more');
  r.click('alarm'); assert.ok(/ALARM-POP/.test(r.box.innerHTML) && /aria-expanded="true">ALARM-READOUT/.test(r.box.innerHTML), 'a tap opens the alarm');
  r.click('timepop'); assert.ok(!/ALARM-POP/.test(r.box.innerHTML) && /class="rv-pop rv-timepop"[^>]*>/.test(r.box.innerHTML) && !/rv-timepop"[^>]*hidden/.test(r.box.innerHTML), 'one popover at a time');
  const before = viewRig({ site: 'The Pelican Rooms' }); assert.ok(/data-rv="start"/.test(before.box.innerHTML) && !/data-rv="timepop"/.test(before.box.innerHTML) && /ALARM-READOUT/.test(before.box.innerHTML), 'before the night: the engagement roll row, and the alarm');
});

await test('⋯: Back to now (off unless looking elsewhere), False dawn, Intel by group, the seam\'s items, the Costume engine, Reset the night last (only once started)', () => {
  const r = viewRig({ ...NIGHT }); let h = r.box.innerHTML;
  const menu = h.slice(h.indexOf('id="rv-menu"'));
  const order = ['data-rv="unpeek"', 'data-rv="dawn"', 'data-site="intel" data-group="band:working"', 'data-mid="show-time"', 'data-site="costume"', 'data-rv="reset"'].map((s) => menu.indexOf(s));
  assert.ok(order.every((i) => i > 0) && order.every((i, k) => k === 0 || i > order[k - 1]), 'in that order: ' + order.join());
  assert.ok(/data-rv="unpeek" role="menuitem" disabled/.test(menu), 'Back to now waits for a peek'); assert.ok(/id="rv-menu"[^>]*hidden/.test(h), 'shut');
  r.view.peek(90); h = r.box.innerHTML; assert.ok(!/data-rv="unpeek" role="menuitem" disabled/.test(h));
  r.click('menu'); assert.ok(!/id="rv-menu"[^>]*hidden/.test(r.box.innerHTML)); r.click('unpeek'); assert.equal(r.view.peeking(), false); assert.ok(/id="rv-menu"[^>]*hidden/.test(r.box.innerHTML), 'an item shuts the menu');
  const before = viewRig({ site: 'The Pelican Rooms' }); assert.ok(!/data-rv="reset"/.test(before.box.innerHTML));
});

await test('the toolbar, the board\'s tints and the legend; the room card: the Players\' map, the people, the room\'s intel with Tell the crew, If it goes wrong -> the Roll', () => {
  const r = viewRig({ ...NIGHT }); r.view.select('Private card rooms'); const h = r.html();
  assert.ok(/class="rv-tools" role="toolbar"/.test(h) && /data-site="spotted"/.test(h) && /STAGE-GROUP/.test(h));
  assert.ok(/class="rv-card z\d fog k-blueprint staged sel"[^>]*data-room="Private card rooms"/.test(h), 'blueprint, staged, selected');
  assert.ok(/class="rv-card z\d fog k-dark"[^>]*data-room="Luxury penthouse"/.test(h) && /class="rv-card z\d open k-seen"[^>]*data-room="Showroom"/.test(h));
  assert.ok(/class="rv-legend"/.test(h) && /rv-lg staged/.test(h));
  assert.ok(/<p class="rv-rmk">controlled · <b>blueprint, staged<\/b><\/p>/.test(h), 'the card\'s state line');
  assert.ok(/SEG:Private card rooms/.test(h) && /PEOPLE:Private card rooms:\d+:first/.test(h) && /PEOPLE:Showroom:\d+:</.test(h) && !/PEOPLE:Showroom:\d+:first/.test(h), 'the people of each card; the first card is told it is first');
  assert.ok(/data-rv="tellroom" data-intel="I2" aria-pressed="false"/.test(h) && /data-rv="tellroom" data-intel="I4"/.test(h), 'the card rooms\' intel');
  assert.ok(/data-site="threat" data-text="GM-ONLY-wrong"[^>]*>→ the Roll</.test(h), 'the Showroom\'s If it goes wrong');
  const n0 = r.sets.length; r.click('tellroom'); assert.equal(r.sets.length, n0, 'a Tell the crew with no intel id (or one the play lacks) writes nothing');
});

await test('the room card\'s Tell the crew writes ball.told.<id> = "crew", and again takes it back; data-site controls go to the page; the view selects', () => {
  const r = viewRig({ ...NIGHT });
  const tell = (id) => r.handlers.click({ target: { closest: (s) => (/data-site/.test(s) || /rv-pop/.test(s) ? null : { getAttribute: (k) => (k === 'data-rv' ? 'tellroom' : k === 'data-intel' ? id : null) }) }, preventDefault() {} });
  tell('I1'); assert.deepEqual(r.sets.at(-1), { told: { I1: 'crew' } }); tell('I1'); assert.deepEqual(r.sets.at(-1), { told: null });
  r.clickSite('kn', 'x1'); assert.deepEqual(r.acts.at(-1), ['kn', 'x1']);
  assert.equal(r.view.selected(), 'Showroom', 'nothing tapped: the first room with a PC'); r.view.select('Luxury penthouse'); assert.equal(r.view.selected(), 'Luxury penthouse');
});

await test('Esc: the view registers its popovers (70) and its NPC card, peek and tool (40) with B68GmEsc, each open only while it is open; detach takes them away', () => {
  const E = require(path.join(ROOT, 'app', 'gm', 'esc.js')); E.reset();
  globalThis.window = { B68GmEsc: E };
  try {
    const r = viewRig({ ...NIGHT });
    const ids = E.list().map((x) => x.id + ':' + x.priority).sort();
    assert.deepEqual(ids, ['rv.alarm:70', 'rv.menu:70', 'rv.npc:40', 'rv.peek:40', 'rv.time:70', 'rv.tool:40']);
    assert.equal(E.anyOpen(), false);
    r.click('menu'); assert.equal(E.anyOpen(), true); assert.equal(E.handle({}), 'closed:rv.menu'); assert.ok(/id="rv-menu"[^>]*hidden/.test(r.box.innerHTML));
    r.view.peek(90); r.click('timepop'); assert.equal(E.handle({}), 'closed:rv.time', 'the popover before the peek'); assert.equal(E.handle({}), 'closed:rv.peek'); assert.equal(r.view.peeking(), false);
    assert.equal(E.handle({ panic() {} }), 'panic', 'nothing open: the page\'s panic');
    r.view.detach(); assert.equal(E.list().length, 0);
  } finally { delete globalThis.window; E.reset(); }
});

await test('the inline tool host: an element the page binds a tool into, at the top of the right column, kept across redraws until closed (its unbind runs once)', () => {
  const r = viewRig({ ...NIGHT }); let unbound = 0;
  const el1 = r.view.toolHost('montage', 'Montage'); assert.ok(el1 && el1.className === 'rv-toolbody'); assert.equal(r.view.toolOpen(), 'montage');
  r.view.toolOn(() => { unbound++; }); assert.ok(/data-sec="tool" aria-label="Montage"/.test(r.box.innerHTML) && /data-rv="toolx"/.test(r.box.innerHTML));
  r.view.rerender(); assert.equal(r.view.toolHost('montage', 'Montage'), el1, 'the same element after a redraw');
  r.click('toolx'); assert.equal(r.view.toolOpen(), ''); assert.equal(unbound, 1); assert.ok(!/data-sec="tool"/.test(r.box.innerHTML));
  assert.equal(r.view.toolClose(true), false, 'closed already'); assert.equal(unbound, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
