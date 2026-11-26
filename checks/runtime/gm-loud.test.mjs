// gm-loud (RK23, gm.glance): when it goes loud. No browser, no network. Run with: node checks/runtime/gm-loud.test.mjs
//   1. the app's OWN exporter and parser over a fixture prep note written for the section (fixtures/gm/glance-rk23-loud.md, the invented Pelican Rooms): the exporter
//      (scripts/lib/prep-export.mjs) makes the pack's prep part, gm/loud.js reads it, and the section's every line, group, label, the getaway clock and the lines it must skip
//      (a fenced copy of the heading, a chip on its own, a handout chip) are asserted. A note without the section, and a malformed part, read as none.
//   2. the beats: a row for each of play.alarm.beats, Done / Now / Next by the clock's fill (RK03.4: the next beat, read-only, never a button).
//   3. the popover: pop() puts the beats in before the popover's closing tag; the plan shows at the top segment only (before it, one dim line); the getaway chip is one tap
//      (data-site="loud-make"); every string from a note or the pack goes in escaped; and site.js draws it through the page's loud, and as it was without one.
//   4. the getaway clock: one tap adds one hidden danger clock through the page's addClock, with Undo (taken back only while it is as it was left); a second tap adds nothing.
//   5. GM-ONLY: the module is in the gm-glance bundle alone and no phone, display or table file names it. No string literal over 220 characters.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildPrep } from '../../scripts/lib/prep-export.mjs';
import { basenames } from '../../scripts/lib/vault.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const read = (f) => fs.readFileSync(path.join(ROOT, 'app', f), 'utf8');
const L = require(path.join(ROOT, 'app/gm/loud.js'));
const Se = require(path.join(ROOT, 'app/gm/security.js'));
const Site = require(path.join(ROOT, 'app/gm/site.js'));
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const FIXTURE = fs.readFileSync(path.join(ROOT, 'checks/runtime/fixtures/gm/glance-rk23-loud.md'), 'utf8');
const ESC = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* the exporter's prep part for the fixture note, in a temp vault (as the demo night builds its own) */
function exported(text) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'rk23-vault-')), R = 'Wiki/Games/Blades in the Dark';
  try {
    const f = path.join(vault, ...R.split('/'), 'Campaigns', 'Demo', 'Sessions', 'demo-s04.md'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text);
    return buildPrep({ vault, repo: ROOT, exportedAt: '2030-01-07T00:00:00.000Z', basenames: basenames(vault) });
  } finally { fs.rmSync(vault, { recursive: true, force: true }); }
}
const stateOf = (h) => [...h.matchAll(/<li class="gl-lb( gl-lb-[a-z]+)?">/g)].map((m) => (m[1] || '').trim().replace('gl-lb-', ''));

await test('gm-loud: the exporter\'s prep part for the fixture note carries the section, and loud.find reads it: heading, groups, labels, the getaway clock', () => {
  const part = exported(FIXTURE), got = L.find(part);
  assert.ok(got, 'the section is found'); assert.equal(got.heading, 'the evacuation');
  assert.ok(got.source && typeof got.source === 'string', 'the note\'s id');
  const by = (label) => got.items.filter((i) => i.label === label);
  assert.equal(by('Guests')[0].group, 'Who goes where'); assert.match(by('Guests')[0].text, /^out through the Cocktail lounge to the quay steps/);
  assert.match(by('Staff')[0].text, /Dov Kessler holds the Security control room; Ada Vell takes the strongbox keys/);
  assert.match(by('VIP')[0].text, /^Mabel Quist goes down to the Underground counting room with Lotte Brand\.$/);
  assert.equal(by('Shut')[0].group, 'Doors'); assert.match(by('Shut')[0].text, /GM-ONLY-LOUD-DOORS/); assert.equal(by('Open')[0].group, 'Doors');
  assert.deepEqual(got.clock, { name: 'Getaway', size: 6, ticks: 0 }, 'the getaway clock is the span\'s name / size / count');
  const plain = got.items.filter((i) => !i.label);
  assert.ok(plain.some((i) => i.text === 'The house empties by the front, in this order.' && i.group === ''), 'the intro line, ahead of any group');
  assert.ok(plain.some((i) => i.text === 'A plain line, no label, with a Mabel Quist link and bold words.'), 'a plain line: the link is its text, the bold marks are off');
  assert.equal(got.items.length, 7, 'seven lines in all: ' + got.items.map((i) => i.label + '|' + i.text.slice(0, 20)).join(' ; '));
  const all = JSON.stringify(got); assert.ok(!/Not a plan|fenced|▶|handout|night plan|Getaway \/|\[\[|\*\*/.test(all), 'no fenced copy, no chip, no Markdown marks in any text');
});
await test('gm-loud: no section, a fenced heading alone, an H3, a malformed part: nothing; an empty section is found with no lines', () => {
  assert.equal(L.parse('## Rooms\n\n### Showroom\n- **Who:** x\n'), null);
  assert.equal(L.parse('```\n## When it goes loud\n- **a:** b\n```\n'), null, 'a fenced heading is no section');
  assert.equal(L.parse('### When it goes loud\n- **a:** b\n'), null, 'an H3 is no section');
  for (const bad of [null, undefined, 5, 'x', {}, { notes: 'x' }, { notes: [null, 3, { blocks: 'x' }, { id: 'n', blocks: [null, { src: 7 }] }] }]) assert.equal(L.find(bad), null);
  assert.equal(L.parse('## When it goes loud\n').items.length, 0);
});
await test('gm-loud: the first note with the section wins; it ends at the next H2; a numbered list and quoted lines count; a time is no label', () => {
  const part = { notes: [{ id: 'a', blocks: [{ k: 'md', src: '## Rooms\n### X\n- y' }] }, { id: 'b', blocks: [{ k: 'md', src: '## When it goes loud - the lift\n1. **Doors:** the lift shuts\n> 22:40 the house lights go up\n- Doors: both stairs open\n## Cues\n- **Late:** not mine' }] }, { id: 'c', blocks: [{ k: 'md', src: '## When it goes loud\n- **Other:** no' }] }] };
  const got = L.find(part); assert.equal(got.source, 'b'); assert.equal(got.heading, 'the lift');
  assert.deepEqual(got.items.map((i) => [i.label, i.text]), [['Doors', 'the lift shuts'], ['', '22:40 the house lights go up'], ['Doors', 'both stairs open']]);
});
await test('gm-loud: the getaway clock grammar is the prep note\'s own: name / size (4, 6, 8, 12; 4 when absent) / count (0 when absent); a bad one says why and makes no chip', () => {
  assert.deepEqual(L.parseClock('Getaway'), { name: 'Getaway', size: 4, ticks: 0 });
  assert.deepEqual(L.parseClock('Getaway / 8 / 2'), { name: 'Getaway', size: 8, ticks: 2 });
  for (const bad of ['', 'G / 5', 'G / 6 / 7', 'G / 6 / x', 'G / 6 / 1 / 2']) assert.ok(L.parseClock(bad).bad, 'bad: ' + bad);
  const got = L.parse('## When it goes loud\n- **Getaway:** `▶ clock: Boat / 5 / 0`\n- **A:** b\n'); assert.ok(got.clock.bad && !got.items.some((i) => i.label === 'Getaway'));
  assert.equal(L.parse('## When it goes loud\n- `▶ clock: First / 4 / 0` and `>> clock: Second / 6 / 0`\n- **A:** b\n').clock.name, 'First', 'the first clock span wins');
  assert.equal(L.parse('## When it goes loud\n- **A:** b `▶ tick: Fuse / 1`\n').clock, null, 'another verb is no getaway clock');
});
await test('gm-loud: beatRows: Done before the clock\'s fill, Now on it, Next after it, nothing further; with no clock no state; at most 12', () => {
  const rows = L.beatRows(['a', 'b', 'c', 'd', 'e', 'f'], 3, 6);
  assert.deepEqual(rows.map((r) => r.state), ['done', 'done', 'now', 'next', '', '']); assert.deepEqual(rows.map((r) => r.n), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(L.beatRows(['a', 'b'], 0, 6).map((r) => r.state), ['next', ''], 'not started: the first beat is next');
  assert.deepEqual(L.beatRows(['a', 'b'], 2, 2).map((r) => r.state), ['done', 'now'], 'at the top: the last beat is now, nothing is next');
  assert.deepEqual(L.beatRows(['a', 'b'], 0, 0).map((r) => r.state), ['', ''], 'no clock: no state');
  assert.equal(L.beatRows(new Array(20).fill('x'), 1, 12).length, 12);
  assert.equal(L.topSegment(6, 6), true); assert.equal(L.topSegment(5, 6), false); assert.equal(L.topSegment(0, 0), false);
});

/* ---- the popover ---- */
const BEATS = ['Beat one <b>', 'Beat two', 'Beat three', 'Beat four', 'Beat five', 'Beat six "last"'];
const view = (filled) => ({ name: 'Alert', next: 'Hunting', index: 2, n: 5, site: true, source: 'default', size: 6, filled, quiet: false });
function popRig(filled, o) {
  o = o || {};
  const part = exported(FIXTURE), table = o.clocks || [], log = { toasts: [], added: [], ops: [], redraws: 0, undo: null };
  const host = { prep: () => part, clocks: () => table, canClock: () => o.canClock !== false,
    addClock: (c) => { if (o.fail) return Promise.reject(new Error('no table')); log.added.push(c); table.push({ ...c }); return Promise.resolve(); },
    clockOps: (ops) => { log.ops.push(ops); for (const op of ops) { const i = table.findIndex((c) => c.id === op.remove); if (i >= 0) table.splice(i, 1); } return Promise.resolve(); },
    undoToast: o.noUndoToast ? undefined : (text, undo) => { log.undo = { text, undo }; return true; }, toast: (m, bad) => log.toasts.push([m, !!bad]), redraw: () => { log.redraws++; } };
  const loud = L.create(host), v = view(filled), info = { v, clock: 'Fuse', beats: BEATS };
  return { loud, log, table, v, pop: (gm) => loud.pop(Se.popHtml(v, { clock: 'Fuse', beat: BEATS[filled - 1], missing: '', gm: !!gm }, ESC), info, !!gm) };
}
await test('gm-loud: pop: every beat is a row, Done / Now / Next in words; inside the popover; text escaped; no button in the beats (RK03.4: read-only)', () => {
  const h = popRig(3).pop(false);
  assert.ok(h.startsWith('<div class="rv-pop rv-alarmpop"') && h.endsWith('</div>') && h.indexOf('<div class="gl-loud">') > h.indexOf('Security'), 'the block sits inside the popover, after its own lines');
  assert.deepEqual(stateOf(h), ['done', 'done', 'now', 'next', '', ''], 'six rows, in the clock\'s order');
  assert.match(h, /<span class="gl-lb-s"><span aria-hidden="true">●<\/span> Now<\/span><span class="gl-lb-t">Beat three<\/span>/); assert.match(h, /Next<\/span><span class="gl-lb-t">Beat four</);
  assert.ok(!/Beat one <b>/.test(h) && /Beat one &lt;b&gt;/.test(h) && /Beat six &quot;last&quot;/.test(h), 'beat text is escaped');
  const beats = h.slice(h.indexOf('<ol class="gl-loud-beats"'), h.indexOf('</ol>')); assert.ok(!/<button|data-site/.test(beats), 'the beats are text');
});
await test('gm-loud: pop: the plan shows at the top segment only; before it, one dim line; the lines are escaped, grouped and labelled', () => {
  const early = popRig(3).pop(false); assert.ok(!/gl-loud-plan|GM-ONLY-LOUD-DOORS/.test(early) && /class="gl-loud-wait">The plan for the top segment is written: 7 lines\./.test(early));
  const top = popRig(6).pop(false);
  assert.match(top, /<section class="gl-loud-plan" aria-label="When it goes loud"><h4 class="gl-loud-h">When it goes loud <span class="gl-loud-sub">the evacuation<\/span><\/h4>/);
  assert.match(top, /<p class="gl-loud-g">Who goes where<\/p><ul class="gl-loud-list">/); assert.match(top, /<b class="gl-loud-k">VIP<\/b> <span class="gl-loud-t">Mabel Quist goes down to the Underground counting room with Lotte Brand\.<\/span>/);
  assert.match(top, /GM-ONLY-LOUD-DOORS/); assert.ok(!/gl-loud-wait/.test(top));
  assert.deepEqual(stateOf(top), ['done', 'done', 'done', 'done', 'done', 'now'], 'at the top the last beat is now');
  const evil = L.create({ prep: () => ({ notes: [{ id: 'n', blocks: [{ src: '## When it goes loud\n- **A<i>:** <img src=x onerror=alert(1)> & "q"\n- <script>x</script> plain\n' }] }] }) });
  const h = evil.pop('<div class="rv-pop"></div>', { v: view(6), clock: 'Fuse', beats: [] }, false); assert.ok(/gl-loud-plan/.test(h) && !/<img|<i>|<script/.test(h), 'a note\'s markup is not markup: ' + h);
});
await test('gm-loud: pop: the getaway chip is one data-site="loud-make" button (data-gm="site" on the site line); once the clock is on the table it reads where it stands', () => {
  const r = popRig(2), h = r.pop(false);
  assert.equal((h.match(/data-site="loud-make"/g) || []).length, 1, 'one tap'); assert.match(h, /Make the Getaway clock/); assert.ok(!/data-gm="site"/.test(h));
  const btn = (x) => (/<button[^>]*data-site="loud-make"[^>]*>/.exec(x) || [''])[0];
  assert.match(btn(r.pop(true)), /data-gm="site"/, 'the site line routes its click');
  const on = popRig(2, { clocks: [{ id: 'c1', name: 'getaway', size: 6, filled: 2, hidden: true }] }).pop(false);
  assert.ok(!/loud-make/.test(on) && /is on the table: <b>2\/6<\/b>/.test(on), 'a clock already there: where it stands, no button');
});
await test('gm-loud: pop: nothing to add means the popover as it was; an empty html stays empty', () => {
  const none = L.create({ prep: () => null }), base = Se.popHtml(view(2), { clock: 'Fuse', beat: 'x', gm: false }, ESC);
  assert.equal(none.pop(base, { v: view(2), clock: 'Fuse', beats: [] }, false), base); assert.equal(none.pop('', { v: view(2), beats: BEATS }, false), '');
  assert.equal(none.pop(base, null, false), base);
});
await test('gm-loud: make: one tap adds ONE hidden danger clock through the page\'s addClock, with Undo; a second tap adds nothing', async () => {
  const r = popRig(2);
  assert.equal(await r.loud.make(), true);
  assert.equal(r.log.added.length, 1); const c = r.log.added[0];
  assert.deepEqual([c.name, c.size, c.filled, c.kind, c.hidden], ['Getaway', 6, 0, 'danger', true]); assert.ok(/^c_/.test(c.id));
  assert.ok(r.log.redraws >= 1 && /hidden from the players: Getaway 0\/6/.test(r.log.undo.text));
  assert.match(r.pop(false), /is on the table: <b>0\/6<\/b>/, 'the popover reads it at once');
  assert.equal(await r.loud.make(), false); assert.equal(r.log.added.length, 1, 'no second clock'); assert.match(r.log.toasts.slice(-1)[0][0], /Nothing added/);
  assert.match(await r.log.undo.undo(), /Undone/); assert.deepEqual(r.log.ops, [[{ remove: c.id }]]); assert.equal(r.table.length, 0, 'the clock is off the table');
});
await test('gm-loud: make: Undo refuses a clock the table changed since; no table, a failed add and a bad clock each say so and add nothing', async () => {
  const r = popRig(2); await r.loud.make(); r.table[0].filled = 2;
  assert.match(await r.log.undo.undo(), /Not undone: the clock has changed/); assert.equal(r.table.length, 1);
  const nt = popRig(2, { canClock: false }); assert.equal(await nt.loud.make(), false); assert.deepEqual(nt.log.toasts.slice(-1)[0], ['The table is not available here: start the clock on the table page.', true]);
  const bad = popRig(2, { fail: true }); assert.equal(await bad.loud.make(), false); assert.match(bad.log.toasts.slice(-1)[0][0], /Could not add the clock: no table/);
  assert.equal(bad.log.toasts.slice(-1)[0][1], true);
  const none = L.create({ prep: () => null, toast: (m, b) => { none.t = [m, b]; } }); assert.equal(await none.make(), false); assert.deepEqual(none.t, ['The prep note names no getaway clock.', true]);
  const plain = popRig(2, { noUndoToast: true }); await plain.loud.make(); assert.match(plain.log.toasts.slice(-1)[0][0], /Clock added, hidden from the players/, 'no undo toast: a plain toast');
});
await test('gm-loud: site.js: alarmPop and the site line draw it through the page\'s loud, and as they were without one; loud-make is the page\'s make', async () => {
  const mk = (loud) => Site.create({ esc: ESC, toast() {}, rerender() {}, security: () => ({ view: () => view(6) }), play: () => ({ alarm: { clock: 'Fuse', beats: BEATS } }), clock: (n) => (n === 'Fuse' ? { name: 'Fuse' } : null), siteKind: () => 'roll', lineShown: () => true, loud: loud ? () => loud : undefined });
  const plain = mk(null).alarmPop(false); assert.ok(/rv-alarmpop/.test(plain) && !/gl-loud/.test(plain), 'no loud: the popover as it was');
  const r = popRig(6), site = mk(r.loud), h = site.alarmPop(false);
  assert.ok(h.startsWith(plain.slice(0, plain.length - 6)) && /gl-loud-beats/.test(h) && /gl-loud-plan/.test(h), 'the old popover first, then the block');
  const el = { getAttribute: () => '' }; site.act('alarm', el);
  const line = site.line(); assert.ok(/gl-loud-beats/.test(line) && /<button[^>]*data-gm="site"[^>]*data-site="loud-make"|<button[^>]*data-site="loud-make"[^>]*data-gm="site"/.test(line), 'the site line\'s popover too');
  site.act('loud-make', el); await new Promise((res) => setTimeout(res, 5)); assert.equal(r.log.added.length, 1, 'loud-make makes the clock');
});
await test('gm-loud: GM-ONLY: loud.js is in the gm-glance bundle alone; no phone, display, table or service-worker file names it; no string literal over 220 characters', () => {
  const w = {}; w.self = w; w.window = w; vm.runInNewContext(read('routes.js'), w, { filename: 'routes.js' });
  const B = w.B68Load.BUNDLES;
  assert.deepEqual(Object.keys(B).filter((n) => B[n].includes('gm/loud.js')), ['gm-glance']);
  for (const [name, list] of Object.entries(B)) for (const f of list) if (f.endsWith('.js') && !['gm/loud.js', 'routes.js', 'gm/site.js', 'gm-page.js'].includes(f)) assert.ok(!/B68GmLoud|gm\/loud/.test(read(f)), name + ': ' + f + ' names the loud module');
  for (const f of ['boot.js', 'display-page.js', 'sw.js', 'index.html', 'tracker.js']) assert.ok(!/B68GmLoud|gm\/loud/.test(read(f)), f + ' names the loud module');
  assert.ok(/B68GmLoud/.test(read('gm-page.js')), 'the GM page is the one reader');
  const js = read('gm/loud.js'); assert.ok(![...js.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].some((m) => m[1].length > 220), 'no string literal over 220 characters');
  assert.ok(!/[\u0080-\u009f]/.test(js + read('gm/glance.css')), 'no character in U+0080 to U+009F');
});
await test('gm-loud: glance.css: the RK23 block is under .gl- classes, nothing under 12 px, no !important, no @layer, kit rules scoped under the desk', () => {
  const all = read('gm/glance.css'), at = all.indexOf('/* ---------- RK23: when it goes loud'); assert.ok(at > 0, 'the RK23 block is there');
  const bare = all.slice(at).replace(/\/\*[\s\S]*?\*\//g, '');
  const sizes = [...bare.matchAll(/font(?:-size)?\s*:\s*(?:[0-9]+\s+)?([0-9.]+)px/g)].map((m) => +m[1]); assert.ok(sizes.length > 5 && sizes.every((n) => n >= 12), 'every font size is 12 px or more: ' + sizes.join(','));
  assert.ok(!/!important|@layer/.test(bare));
  for (const rule of bare.split('}').map((r) => r.split('{')[0].trim()).filter(Boolean)) for (const sel of rule.split(',')) assert.ok(/^(#gm-page|:root\[data-kit~="desk"\] #gm-page) \.gl-/.test(sel.trim()), 'a rule outside the .gl- classes: ' + sel.trim());
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
