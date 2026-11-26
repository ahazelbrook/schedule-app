// gm-quick-rules (RK22, setting gm.glance): the quick rules. Actions on the Roll, the engagement dice, Indulge Vice step by step, the heat sum.
// app/gm/quick-rules.js on its own: the pure parts, the markup it draws (with B68Ui's real parts), and its click handling against a small stand-in DOM.
// No browser, no network, no clock. INVENTED data only: the rules text below is a fixture sentence, never the book's; the Dovetail Crew and the Pelican Rooms.
// RULING 1 (Gate 0): no rules part and no book text in the code. The definitions and the engagement and Indulge Vice rules come from B68Rules at runtime
// (here a fake with .hits/.entry/.load), so this suite also scans the file for a sentence of prose in a string.
//   node checks/runtime/gm-quick-rules.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/quick-rules.js';
const SRC = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

globalThis.self = globalThis;
const Q = require(path.join(ROOT, FILE));
const Ui = require(path.join(ROOT, 'app', 'ui', 'ui.js'));
const A = require(path.join(ROOT, 'app', 'gm', 'aftermath.js'));
require(path.join(ROOT, 'app', 'content.js'));           /* sets B68Content on globalThis */
const CT = globalThis.B68Content;

/* a fake B68Rules: one entry per topic, fixture text only */
function fakeRules(extra) {
  const entries = Object.assign({}, {
    hunt: { title: 'Hunt', caption: "Blades '68 · Actions", md: '**Hunt** is a fixture definition: *only for tests*, [[a link]] and more words after it.' },
    'engagement-roll': { title: 'Engagement Roll', caption: "Blades '68 · Scores", md: 'Fixture engagement text.' },
    'indulge-vice': { title: 'Indulge Vice', caption: "Blades '68 · Downtime", md: 'Fixture indulge text.' } }, extra || {});
  const calls = [];
  return {
    calls, load() { calls.push('load'); return Promise.resolve(null); },
    hits(q, n) { calls.push('hits:' + q); const k = String(q).toLowerCase().replace(/\s+/g, '-'); const list = Object.keys(entries).filter((id) => id.indexOf(k) >= 0 || k.indexOf(id) >= 0).map((id) => ({ id, title: entries[id].title })); return { total: list.length, hits: list.slice(0, n) }; },
    entry(id) { return entries[id] ? Object.assign({ id }, entries[id]) : null; }
  };
}
/* a stand-in DOM: elements with attributes, closest(), the Roll's line, and the document the module listens on */
function fakeDom() {
  const listeners = [];
  const el = (attrs) => ({ attrs, disabled: false, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, closest() { return this; }, focus() { doc.activeElement = this; } });
  const line = { value: '', maxLength: 100, events: [], dispatchEvent(ev) { this.events.push(ev.type); return true; }, focus() { this.focused = true; doc.activeElement = this; }, setSelectionRange() {} };
  const doc = { activeElement: null, getElementById(id) { return id === 'gm-c-threat' ? line : null; }, querySelectorAll() { return []; }, addEventListener(t, f) { listeners.push([t, f]); } };
  return { doc, line, el, listeners };
}
const click = (dom, attrs) => { const ev = { target: dom.el(attrs), prevented: false, preventDefault() { this.prevented = true; } }; Q.onClick(ev); return ev; };
const g = (kind, v, k, extra) => Object.assign({ 'data-gl': kind, 'data-v': String(v), 'data-k': k }, extra || {});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- the module ---------- */
await test('gm-quick-rules: loads under Node and as a plain script, and is filled (no stub)', () => {
  assert.ok(Q && typeof Q === 'object' && !Q.stub, 'filled');
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(SRC, win, { filename: FILE });
  assert.ok(win.B68GmQuickRules && typeof win.B68GmQuickRules.rollHtml === 'function' && !win.B68GmQuickRules.stub, 'window.B68GmQuickRules is the filled module');
});

await test('RULING 1: the file holds no sentence of prose, no hand-built button, no style attribute, no !important, and no string over 220 characters', () => {
  const noComments = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/<button\b/.test(noComments), 'buttons are B68Ui parts (the ratchet)');
  assert.ok(!/style=\\?["']/.test(noComments) && !/!\s*important/i.test(noComments), 'no inline style, no !important');
  const strings = [...noComments.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)].map((m) => (m[1] !== undefined ? m[1] : m[2]));
  assert.ok(strings.every((s) => s.length <= 220), 'no literal over 220');
  /* a "sentence" is a long run of lower-case words: short labels and notes are fine, a rule's wording is not */
  const prose = strings.filter((s) => s.split(/\s+/).length > 14 && /[a-z]{3,} [a-z]{3,} [a-z]{3,}/.test(s));
  assert.deepEqual(prose, [], 'no long prose strings');
});

/* ---------- pure ---------- */
await test('ACTIONS: the twelve of B68Content.ACTIONS, three attributes of four, in the app\u2019s order', () => {
  const a = Q.ACTIONS(CT);
  assert.deepEqual(a.map((x) => x[0]), ['Insight', 'Prowess', 'Resolve']);
  assert.equal(a.reduce((n, x) => n + x[1].length, 0), 12);
  assert.deepEqual(Q.ACTIONS({}).map((x) => x[0]), ['Insight', 'Prowess', 'Resolve'], 'a page without B68Content still has them');
});

await test('lowestAttr: the least of the three attribute ratings (dotted actions each), null without dots', () => {
  assert.equal(Q.lowestAttr({ Hunt: 1, Study: 2, Finesse: 1, Prowl: 1, Skirmish: 1 }, CT), 0, 'Resolve has none');
  assert.equal(Q.lowestAttr({ Hunt: 1, Finesse: 1, Sway: 2, Attune: 1 }, CT), 1);
  assert.equal(Q.lowestAttr({ Hunt: 1, Study: 1, Prowl: 1, Wreck: 1, Attune: 3, Sway: 1 }, CT), 2);
  assert.equal(Q.lowestAttr(null, CT), null);
});

await test('engagement: the Tier factor, the district and the plan detail make the net; the crew\u2019s notes ride beside (the 21:02 slip: a die off, and the ability that answers it)', () => {
  const e = { gap: 1, factor: -1, notes: ['Fixture Ability answers the lost die'], district: 1 };
  const m = Q.engagement(e, { plan: 1 });
  assert.deepEqual(m.rows.map((r) => [r.id, r.n, r.tapped]), [['tier', -1, true], ['district', 1, false], ['plan', 1, true]]);
  assert.equal(m.net, 1);
  assert.deepEqual(m.notes, ['Fixture Ability answers the lost die'], 'the note is shown, never netted off in code: the rule says what it cancels');
  assert.equal(m.scored, true);
  assert.equal(m.rows[0].note, '+1', 'the gap shown with a sign');
  const t = Q.engagement(null, { tier: 1, district: -1, plan: 2 });
  assert.deepEqual([t.net, t.scored, t.rows[0].tapped, t.rows[1].tapped], [2, false, true, true], 'no Score rolled: the GM taps all three');
  const o = Q.engagement(e, { plan: 0, tierOv: 0 });
  assert.deepEqual([o.net, o.rows[0].n, o.rows[0].note], [1, 0, '+1 (note)'], 'a crew ability note answers the Tier die (the 21:02 slip): the GM’s tap, marked (note), and the net follows it');
  assert.equal(Q.engagement(e, { tierOv: null }).rows[0].note, '+1', 'no tap, no mark');
  assert.equal(Q.engagement(e, { plan: 9 }).rows[2].n, 2, 'the plan detail is capped');
  assert.equal(Q.engagement(null, { tier: 5 }).rows[0].n, 1, 'and so is the tapped tier');
  assert.equal(Q.signedDice(-1), '−1d'); assert.equal(Q.signedDice(0), '0d'); assert.equal(Q.signedDice(2), '+2d');
});

await test('indulge: the steps in order, the clear is the highest die, overindulged only when it is more than the stress', () => {
  const ok = Q.indulge({ dice: 2, die: 4, stress: 5 });
  assert.deepEqual(ok.steps.map((s) => s.id), ['attr', 'roll', 'high', 'clear', 'over']);
  assert.deepEqual([ok.over, ok.left], [false, 1]);
  const eq = Q.indulge({ dice: 2, die: 5, stress: 5 });
  assert.deepEqual([eq.over, eq.left], [false, 0], 'equal is not more');
  const over = Q.indulge({ dice: 3, die: 6, stress: 2 });
  assert.deepEqual([over.over, over.left], [true, 0]);
  assert.equal(over.steps[4].label, 'Overindulged'); assert.equal(over.steps[4].value, '6 is more than 2');
  const open = Q.indulge({ dice: 1 });
  assert.deepEqual([open.over, open.left, open.steps[2].value, open.steps[4].label], [false, null, '?', 'Overindulge'], 'before the die and the stress are known nothing is decided');
  assert.equal(Q.indulge({ dice: 1 }).steps[1].value, '1 die'); assert.equal(Q.indulge({ dice: 0 }).steps[1].value, '0 dice');
});

await test('heatSum: reuses the Aftermath\u2019s heatOutcome (9 or more is the siren), and says nothing when it is not there', () => {
  assert.deepEqual(Q.heatSum({ heat: 5, exposure: 2, mods: 1 }, A.heatOutcome), { heat: 5, exposure: 2, mods: 1, total: 8, after: 8, siren: false, wantedUp: 0 });
  const s = Q.heatSum({ heat: 7, exposure: 2, mods: 0 }, A.heatOutcome);
  assert.deepEqual([s.total, s.siren, s.after, s.wantedUp], [9, true, 0, 1]);
  assert.equal(Q.heatSum({ heat: 4, exposure: 6, mods: -6 }, A.heatOutcome).total, 4, 'the modifier is capped at six either way, as the close\u2019s');
  assert.equal(Q.heatSum({ heat: 1 }, null), null);
});

await test('plain and pickEntry: the rules entry\u2019s own words as a line; the title that is the action wins; nothing without the rules', async () => {
  assert.equal(Q.plain('# Head\n\n**Bold** and *it* with [[a link|shown]] and [x](http://e.test)'), 'Head Bold and it with shown and x');
  const R = fakeRules({ hunting: { title: 'Hunting parties', caption: 'x', md: 'Not this one.' } });
  const d = await Q.pickEntry(R, 'Hunt', 'Hunt');
  assert.deepEqual([d.title, d.caption], ['Hunt', "Blades '68 · Actions"]);
  assert.equal(d.text, 'Hunt is a fixture definition: only for tests, a link and more words after it.');
  assert.ok(R.calls.indexOf('load') >= 0, 'the corpus is loaded first');
  assert.equal(await Q.pickEntry(R, 'Wreck', 'Wreck'), null, 'no entry, no definition');
  assert.equal(await Q.pickEntry(null, 'Hunt'), null);
});

/* ---------- the markup (B68Ui's real parts) ---------- */
const host = (o) => Object.assign({ ui: Ui, Content: CT, aftermath: A, rules: fakeRules(), engage: () => null, crewHeat: () => 3, pc: null }, o || {});

await test('rollHtml: shut by default: two toggles, no panel, nothing pressed', () => {
  Q.reset();
  const h = Q.rollHtml(host());
  assert.ok(/aria-label="Quick rules"/.test(h));
  assert.equal((h.match(/data-gl="tog"/g) || []).length, 2);
  assert.ok(!/gl-acts|gl-heat|data-gl="act"/.test(h), 'the panels are not drawn until opened');
  assert.ok(!/aria-pressed="true"/.test(h));
});

await test('rollHtml: Actions open lists all twelve actions of B68Content.ACTIONS, each one control, in three groups', () => {
  Q.reset(); Q.state().open.roll = 'acts';
  const h = Q.rollHtml(host());
  const acts = [...h.matchAll(/data-gl="act" data-v="([A-Za-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(acts, Q.ACTIONS(CT).flatMap((x) => x[1]), 'every action, in the app\u2019s order');
  assert.equal(acts.length, 12);
  assert.equal((h.match(/class="gl-grp"/g) || []).length, 3);
});

await test('rollHtml: Heat sum open: the crew\u2019s heat, the Aftermath\u2019s exposures, the sum and the siren word; nothing is written', () => {
  Q.reset(); const st = Q.state(); st.open.roll = 'heat'; st.heat.exposure = 4;
  let h = Q.rollHtml(host({ crewHeat: () => 5 }));
  assert.ok(/<b>Heat 9<\/b> · Siren: Wanted up 1, Heat clears\./.test(h), h.match(/<p class="gl-sum"[^]*?<\/p>/)[0]);
  assert.deepEqual([0, 2, 4, 6].map((n) => new RegExp('data-v="' + n + '"[^>]*data-id="exposure"|data-id="exposure"[^>]*data-v="' + n + '"').test(h)), [true, true, true, true], 'the four exposures');
  st.heat.exposure = 0; h = Q.rollHtml(host({ crewHeat: () => 5 }));
  assert.ok(/<b>Heat 5<\/b> · No siren\./.test(h));
  assert.ok(/Nothing is written/.test(h));
  assert.ok(!/data-gm=/.test(h), 'no data-gm control: the page\u2019s handlers never see these');
});

await test('engHtml: shut it is one line with the net; open it has the three numbers, the crew\u2019s notes and the rule chip; read-only when Score rolled them', () => {
  Q.reset();
  const e = { gap: 1, factor: -1, notes: ['Fixture Ability answers the lost die'], district: 0 };
  let h = Q.engHtml(host({ engage: () => e }));
  assert.ok(/−1d net/.test(h), 'the net is on the toggle'); assert.ok(!/gl-eng-b/.test(h));
  Q.state().open.eng = true;
  h = Q.engHtml(host({ engage: () => e }));
  assert.ok(/Tier gap \+1/.test(h) && /District/.test(h) && /Plan detail/.test(h));
  assert.ok(/<li>Fixture Ability answers the lost die<\/li>/.test(h));
  assert.ok(/rule: engagement roll/.test(h));
  const step = (html, label) => html.match(new RegExp('<span class="gl-step"[^>]*aria-label="' + label + '"[^]*?</output>[^]*?</span>'))[0];
  assert.equal((step(h, 'Tier gap \\+1').match(/disabled/g) || []).length, 1, 'the Tier gap starts at Score\u2019s -1: only the less button is at its end, the GM may step it up');
  assert.equal((step(h, 'District').match(/disabled/g) || []).length, 2, 'the district is Score\u2019s: read-only');
  assert.equal((step(h, 'Plan detail').match(/disabled/g) || []).length, 0, 'the plan\u2019s detail is the GM\u2019s tap');
  h = Q.engHtml(host({ engage: () => null }));
  assert.ok(/no Score rolled: tap the numbers/.test(h));
  assert.equal((step(h, 'Tier gap').match(/disabled/g) || []).length, 0, 'with no Score the tier is tapped too');
});

await test('indulgeHtml: shut it is one line; open it is the steps, the dice and die picks, stress, the verdict and the Morning After pointer', () => {
  Q.reset();
  const pc = { id: 'pc_nell', name: 'Nell Arbuthnot', status: { stress: 3, harm: [], locks: 0, turn: [] }, glance: { play: { dots: { Hunt: 1, Finesse: 1, Prowl: 1, Attune: 1, Command: 1 } } } };
  let h = Q.indulgeHtml(host({ pc }));
  assert.ok(/aria-label="Indulge Vice, step by step"/.test(h)); assert.ok(!/gl-ind/.test(h));
  Q.state().open.indulge = true;
  h = Q.indulgeHtml(host({ pc }));
  assert.ok(/<li><span class="gl-sl">Lowest attribute<\/span> <b>1<\/b><\/li>/.test(h), 'the dice come from the sheet\u2019s dots (Insight 1, Prowess 2, Resolve 2: the lowest is 1)');
  assert.ok(/Stress now/.test(h) && /<output class="gl-n"[^>]*>3<\/output>/.test(h), 'the stress from the sheet');
  assert.ok(/Tap the highest die and the stress, then the Morning After roll\./.test(h));
  Q.state().ind.pc_nell = { dice: null, die: 5, stress: null };
  h = Q.indulgeHtml(host({ pc }));
  assert.ok(/<b>Overindulged\.<\/b> The Morning After is the Mishaps\./.test(h), '5 is more than 3');
  const verdictBtn = h.match(/<button[^>]*data-gm="dt-roll"[^>]*>/);
  assert.ok(verdictBtn && /data-k="res"/.test(verdictBtn[0]) && /data-v="over"/.test(verdictBtn[0]), 'the verdict is the page’s own Overindulged button (dt-roll, res, over)');
  assert.ok(/class="is-over"/.test(h));
  Q.state().ind.pc_nell.die = 2; h = Q.indulgeHtml(host({ pc }));
  assert.ok(/<b>Not overindulged\.<\/b>/.test(h) && /Stress 3 → 1/.test(h) && /data-gm="dt-roll"[^>]*>|data-v="in"/.test(h) && /data-v="in"/.test(h), 'and the Indulged button when it is not');
  Q.state().ind.pc_nell.die = 0;
  h = Q.indulgeHtml(host({ pc: null }));
  assert.ok(/<output class="gl-n"[^>]*>\?<\/output>/.test(h), 'no PC chosen: the GM taps the stress too');
});

await test('without the UI kit the panels say they are loading, ask for it once, and never throw', () => {
  Q.reset();
  const asked = []; globalThis.B68Load = { need(n) { asked.push(n); return new Promise(() => {}); } };
  const bare = { Content: CT, ui: null };
  assert.ok(/gl-wait/.test(Q.rollHtml(bare))); assert.ok(/gl-wait/.test(Q.engHtml(bare))); assert.ok(/gl-wait/.test(Q.indulgeHtml(bare)));
  assert.deepEqual(asked, ['kit-ui'], 'one request');
  delete globalThis.B68Load;
});

await test('every text from the pack or the rules goes through esc(): a note with markup is shown as text', () => {
  Q.reset(); Q.state().open.eng = true;
  const h = Q.engHtml(host({ engage: () => ({ gap: 0, factor: 0, district: 0, notes: ['<img src=x onerror=alert(1)>'] }) }));
  assert.ok(!/<img/.test(h) && /&lt;img/.test(h));
});

/* ---------- the clicks ---------- */
await test('clicks: Actions open, an action fills the Roll\u2019s line with its name, a second replaces the first, a typed rest is kept, a second tap lets go', () => {
  Q.reset(); const dom = fakeDom(); globalThis.document = dom.doc;
  Q.rollHtml(host());                                /* the host the click reads */
  assert.equal(click(dom, g('tog', 'acts', 'roll')).prevented, true);
  assert.equal(Q.state().open.roll, 'acts');
  click(dom, g('act', 'Hunt', 'roll'));
  assert.equal(dom.line.value, 'Hunt: '); assert.ok(dom.line.events.includes('input'), 'the page\u2019s own input handler hears it');
  assert.equal(dom.line.focused, true, 'the field had the focus while it was filled');
  assert.notEqual(dom.doc.activeElement, dom.line, 'and gave it back: the keys (1 to 4, Space, the letters) stay the page\u2019s, never typed into the line');
  dom.line.value = 'Hunt: the guard turns round';
  click(dom, g('act', 'Prowl', 'roll'));
  assert.equal(dom.line.value, 'Prowl: the guard turns round');
  click(dom, g('act', 'Prowl', 'roll'));
  assert.equal(dom.line.value, 'the guard turns round', 'a second tap takes the name off again');
  assert.equal(Q.state().act, '');
  dom.line.value = 'a line typed first'; click(dom, g('act', 'Sway', 'roll'));
  assert.equal(dom.line.value, 'Sway: a line typed first', 'a line already there is kept after the name');
  dom.line.maxLength = 12; dom.line.value = ''; Q.state().fill = ''; click(dom, g('act', 'Skirmish', 'roll'));
  assert.ok(dom.line.value.length <= 12, 'the line\u2019s own limit holds');
  dom.line.maxLength = 100; Q.reset(); Q.rollHtml(host()); dom.line.value = 'Hunt: Hunt: Study: the guard turns';
  click(dom, g('act', 'Sway', 'roll'));
  assert.equal(dom.line.value, 'Sway: the guard turns', 'a name left from an earlier page load (state gone) is replaced, never stacked');
  delete globalThis.document;
});

await test('clicks: with the page’s setThreat there, the line goes through it (stored at once), whole, with the space after the name kept in the field', () => {
  Q.reset(); const dom = fakeDom(); globalThis.document = dom.doc; const sent = [];
  globalThis.B68GmPage = { setThreat(t) { sent.push(t); dom.line.value = t.trim(); return true; } };
  Q.rollHtml(host());
  click(dom, g('act', 'Hunt', 'roll'));
  assert.deepEqual(sent, ['Hunt: '], 'the page was told');
  assert.equal(dom.line.value, 'Hunt: ', 'the field keeps the space the page’s cut would take, so the next key follows it');
  dom.line.value = 'Hunt: the guard'; click(dom, g('act', 'Prowl', 'roll'));
  assert.equal(sent[1], 'Prowl: the guard');
  delete globalThis.B68GmPage; delete globalThis.document;
});

await test('clicks: the page’s repaint (started by setThreat) redraws the panel: the focus goes to the new button, found by what it is', () => {
  Q.reset(); const dom = fakeDom(); globalThis.document = dom.doc;
  const attrs = g('act', 'Hunt', 'roll'), old = dom.el(attrs), fresh = dom.el(attrs); let asked = '';
  dom.doc.querySelector = (sel) => { asked = sel; return fresh; };
  globalThis.B68GmPage = { setThreat() { old.isConnected = false; return true; } };      /* the redraw took the tapped button out of the page */
  Q.rollHtml(host());
  Q.onClick({ target: old, preventDefault() {} });
  assert.equal(dom.doc.activeElement, fresh, 'the focus is on the button that replaced it');
  assert.ok(/data-gl="act"/.test(asked) && /data-v="Hunt"/.test(asked) && /data-k="roll"/.test(asked), asked);
  delete globalThis.B68GmPage; delete globalThis.document;
});

await test('clicks: an action asks the rules once for its definition and keeps it (no book text is held in code)', async () => {
  Q.reset(); const dom = fakeDom(); globalThis.document = dom.doc;
  const R = fakeRules(); const H = host({ rules: R }); Q.rollHtml(H);
  Q.state().open.roll = 'acts';
  click(dom, g('act', 'Hunt', 'roll'));
  assert.ok(/Looking it up/.test(Q.rollHtml(H)), 'while it loads');
  await wait(10);
  const h = Q.rollHtml(H);
  assert.ok(/<b>Hunt<\/b> <span class="gm-dim">Blades &#39;68 · Actions<\/span><br>Hunt is a fixture definition/.test(h), h.match(/<p class="gl-def"[^]*?<\/p>/)[0]);
  click(dom, g('act', 'Hunt', 'roll')); click(dom, g('act', 'Hunt', 'roll'));
  assert.equal(R.calls.filter((c) => c === 'hits:Hunt').length, 1, 'asked once');
  click(dom, g('rule', 'Hunt', 'roll', { 'data-p': 'Hunt' }));
  await wait(10);
  assert.ok(/class="gl-rule-t"/.test(Q.rollHtml(H)), 'the rule chip opens the entry');
  delete globalThis.document;
});

await test('clicks: a corpus with nothing, or no rules at all, is said plainly', async () => {
  Q.reset(); const dom = fakeDom(); globalThis.document = dom.doc;
  const H = host({ rules: fakeRules() }); Q.rollHtml(H); Q.state().open.roll = 'acts';
  click(dom, g('act', 'Wreck', 'roll')); await wait(10);
  assert.ok(/Nothing in the rules this device holds matches\./.test(Q.rollHtml(H)));
  Q.reset(); const H2 = host({ rules: null }); delete globalThis.B68Rules;
  Q.rollHtml(H2); Q.state().open.roll = 'acts'; click(dom, g('act', 'Hunt', 'roll'));
  assert.ok(/The rules are not available here\./.test(Q.rollHtml(H2)));
  delete globalThis.document;
});

await test('clicks: heat steps, exposure and Clear; the engagement\u2019s plan detail and Clear; Indulge dice, die, stress and Clear', () => {
  Q.reset(); const dom = fakeDom(); globalThis.document = dom.doc;
  const pc = { id: 'p1', status: { stress: 2 } };
  Q.rollHtml(host({ crewHeat: () => 4 })); Q.engHtml(host()); Q.indulgeHtml(host({ pc }));
  const up = () => click(dom, g('step', 'heat', 'roll', { 'data-d': 1 }));
  up(); assert.equal(Q.state().heat.base, 5);
  up(); up(); up(); up(); assert.equal(Q.state().heat.base, 9, 'capped at nine');
  click(dom, g('step', 'mods', 'roll', { 'data-d': -1 })); assert.equal(Q.state().heat.mods, -1);
  click(dom, g('pick', 4, 'roll', { 'data-id': 'exposure' })); assert.equal(Q.state().heat.exposure, 4);
  click(dom, g('clear', 'heat', 'roll')); assert.deepEqual(Q.state().heat, { exposure: 0, mods: 0, base: null });
  for (let i = 0; i < 3; i++) click(dom, g('step', 'plan', 'eng', { 'data-d': 1 }));
  assert.equal(Q.state().adj.plan, 2, 'capped at two');
  click(dom, g('step', 'tier', 'eng', { 'data-d': -1 })); click(dom, g('step', 'tier', 'eng', { 'data-d': -1 })); assert.equal(Q.state().adj.tier, -1);
  click(dom, g('clear', 'eng', 'eng')); assert.deepEqual(Q.state().adj, { tier: 0, district: 0, plan: 0, tierOv: null });
  /* with a Score rolled the Tier gap steps from Score's own number, and stepping back to it takes the mark off */
  const sc = { gap: 1, factor: -1, notes: [], district: 0 }; Q.engHtml(host({ engage: () => sc }));
  click(dom, g('step', 'tier', 'eng', { 'data-d': 1 })); assert.equal(Q.state().adj.tierOv, 0, 'a note answers the die: 0');
  click(dom, g('step', 'tier', 'eng', { 'data-d': 1 })); assert.equal(Q.state().adj.tierOv, 1);
  click(dom, g('step', 'tier', 'eng', { 'data-d': -1 })); assert.equal(Q.state().adj.tierOv, 0);
  click(dom, g('step', 'tier', 'eng', { 'data-d': -1 })); assert.equal(Q.state().adj.tierOv, null, 'back to Score’s own number: no mark');
  click(dom, g('step', 'tier', 'eng', { 'data-d': -1 })); assert.equal(Q.state().adj.tierOv, null, 'and not past the end');
  click(dom, g('step', 'tier', 'eng', { 'data-d': 1 }));
  click(dom, g('clear', 'eng', 'eng')); assert.equal(Q.state().adj.tierOv, null);
  click(dom, g('pick', 3, 'indulge', { 'data-id': 'dice' })); click(dom, g('pick', 6, 'indulge', { 'data-id': 'die' }));
  click(dom, g('step', 'stress', 'indulge', { 'data-d': 1 }));
  assert.deepEqual(Q.state().ind.p1, { dice: 3, die: 6, stress: 3 }, 'the stress stepped from the sheet\u2019s 2');
  click(dom, g('pick', 6, 'indulge', { 'data-id': 'die' })); assert.equal(Q.state().ind.p1.die, 0, 'the same die again lets go');
  click(dom, g('clear', 'indulge', 'indulge')); assert.equal(Q.state().ind.p1, undefined);
  delete globalThis.document;
});

await test('clicks: a disabled control and anything without data-gl do nothing; no control here carries a data-gm (the page\u2019s handlers are never reached)', () => {
  Q.reset();
  Q.onClick({ target: { closest() { return null; } }, preventDefault() { throw new Error('should not'); } });
  const d = { getAttribute: () => 'tog', disabled: true }; Q.onClick({ target: { closest: () => d }, preventDefault() { throw new Error('should not'); } });
  assert.ok(!/data-gm=/.test(Q.rollHtml(host())) && !/data-gm=/.test(Q.engHtml(host())) && !/data-gm=/.test(Q.indulgeHtml(host())));
});

await test('mountRoll and attach: a null host takes the panel down; with no DOM nothing happens; ONE click listener however often it is attached', () => {
  Q.reset();
  assert.equal(Q.mountRoll(null), null);
  const dom = fakeDom();
  assert.equal(Q.attach(dom.doc), true); assert.equal(Q.attach(dom.doc), true);
  assert.deepEqual(dom.listeners.map((l) => l[0]), ['click', 'keyup'], 'one click listener and one keyup, however often it is attached');
  let stopped = 0; const chip = { closest: () => ({}) };
  Q.onKeyUp({ key: ' ', target: chip, preventDefault() { stopped++; } }); Q.onKeyUp({ key: 'Enter', target: chip, preventDefault() { stopped++; } }); Q.onKeyUp({ key: ' ', target: { closest: () => null }, preventDefault() { stopped++; } });
  assert.equal(stopped, 1, 'Space released on one of these buttons does not press it (it is the page’s GO); Enter does, and Space elsewhere is untouched');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
