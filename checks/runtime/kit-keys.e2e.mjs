// kit-keys (KS04.5 of the kit and stage build): every key on the Shortcuts card, pressed with the kit off and with it on, and what happened compared.
// It reads the card's own rows (app/gm/shortcuts.js SECTIONS: key rows, every hit) and, for each hit, in a fresh GM page of the demo night
// (scripts/demo-night.mjs): sets the context the key needs (the Score, the Run view for the site's arrows, an open Blade panel with invented cards for its keys, an open
// Find for its keys), takes a snapshot, presses the key, waits, takes a snapshot, and keeps what changed:
//   on the page   the ids that became visible or hidden, the states that changed (aria-pressed, aria-selected, aria-current, aria-expanded, data-state, data-open,
//                 data-alarm, data-active, data-on), where focus went, the hash, a toast's words
//   on the server what the GM state, the iPad's ambient document, the display and the campaign gained, lost or changed (times and ids of time dropped)
// Two demo nights, one after the other, the same keys in the same order: the five settings written OFF, then all five ON (kit.desk kit.stage kit.phone night.who
// blade.pitches). The check passes when (1) with the kit off every hit was pressed and no page error came up, (2) every key but the few named in NO_EFFECT_OK did
// something (so a key that stops working is caught), and (3) the same key did the same thing with the kit on: the server effect equal, the writes the page made
// while it loaded equal (the snapshot waits for the server to be still, so a late load write is not taken for the key's), the page effect equal for every element
// both pages have. A kit-off effect on an element the kit-on page does not have at all is LOST and fails (the review of KS04: it used to be dropped); an element
// only the new markup has is listed as a note (the new desk may add markup, it may not change what a key does). Deliberate differences are KEYS_EXEMPT, a named
// list with reasons and the overseer's ruling, printed with the hits that used them. The comparison checks itself first (KIT_KEYS_SELF_ONLY=1: that alone).
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9402] [KIT_KEYS_ONLY=<key labels, comma separated>] node checks/runtime/kit-keys.e2e.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startDemo, setClock, clockScript } from '../../scripts/kit-fingerprint.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9402);
const GM = 'gm@example.test';
const SC = require('../../app/gm/shortcuts.js');
const ONLY = (process.env.KIT_KEYS_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
let failed = 0;
const check = (ok, name) => { if (ok) console.log('PASS ' + name); else { failed++; console.log('FAIL ' + name); } };

/* THE EXEMPTIONS: where a key deliberately does something else with the kit on, each named with its reason and the overseer's ruling, each printed. `hit` is a
   pattern on the hit's label ("<keys> [<act or via> <key>]"); `off` a pattern on the kit-off page lines that may be missing with the kit on. Nothing else is
   forgiven: a server effect, a toast, the focus or the hash never is. Adding one is one line here, with the PR that makes the change. */
export const KEYS_EXEMPT = [
  { name: 'KS06: the pinned stamp', reason: 'KS06 (PR #216) pins the stamped line above the Blade fold with kit.desk on, so leaving the Score (Ctrl+Right, F, a Find result) no longer hides #gm-stamp. Ruled intended 12/11',
    hit: /\[(place Control\+ArrowRight|focus f|find Enter)\]$/, off: /^hidden #gm-stamp$/ },
  { name: 'KS07: the Screen, the Now zone and the tab put away', reason: 'KS07 (PR #214, ccd1010) hides the right-edge tab (#as-launch), the Now zone (#as-nowz, #as-now) and the Screen section (#as-screen, #as-sc-*) with kit.desk on, so A opens Blade without hiding the tab or showing them. Ruled intended 12/11',
    hit: /\[assist a\]$/, off: /^(hidden #as-launch|shown #as-(nowz|now|screen|sc-[a-z]+))$/ }
];

/* what a page line is about: an id (shown/hidden #id) or a state key (an id, or a short path from the nearest id) */
const lineKey = (line) => { let m = /^(?:shown|hidden) #(\S+)$/.exec(line); if (m) return { id: m[1] }; m = /^(?:new|state|gone) (\S+)/.exec(line); if (m) return { attr: m[1] }; return null; };
const knows = (known, k) => (k.id ? known.ids.has(k.id) : known.attrs.has(k.attr));
/* One key, kit off (o) against kit on (n). Each: { hit, page, server, load, known: { ids, attrs } } (known: every id and state key on that page, before or after
   the press). A kit-off line about an element the kit-on page does not have at all is LOST (the hooks rule: every id stays): a failure, unless exempted. A kit-on
   line about an element the kit-off page never had is new markup: a note. Every other page line, every server effect and every write the page made while it
   loaded must be the same. Returns { ok, lost, offOnly, onOnly, extra, exempted: [names], why: [lines] }. */
export function judge(o, n, exempt = KEYS_EXEMPT) {
  const ex = exempt.filter((x) => x.hit.test(o.hit.label));
  const okOff = (l) => ex.find((x) => x.off && x.off.test(l));
  const used = new Set(), lost = [], po = [], pn = [], extra = [];
  for (const l of o.page) { const k = lineKey(l); if (k && !knows(n.known, k)) { const x = okOff(l); if (x) used.add(x.name); else lost.push(l); } else po.push(l); }
  for (const l of n.page) { const k = lineKey(l); if (k && !knows(o.known, k)) extra.push(l); else pn.push(l); }
  let offOnly = po.filter((l) => !pn.includes(l)); const onOnly = pn.filter((l) => !po.includes(l));
  offOnly = offOnly.filter((l) => { const x = okOff(l); if (x) { used.add(x.name); return false; } return true; });
  const sv = (a, b) => a.filter((l) => !b.includes(l));
  const sOff = sv(o.server, n.server).concat(sv(o.load || [], n.load || []).map((l) => 'load ' + l)), sOn = sv(n.server, o.server).concat(sv(n.load || [], o.load || []).map((l) => 'load ' + l));
  const ok = !lost.length && !offOnly.length && !onOnly.length && !sOff.length && !sOn.length;
  return { ok, lost, offOnly: offOnly.concat(sOff), onOnly: onOnly.concat(sOn), extra, exempted: [...used] };
}

/* the comparison checks itself first (no browser): a lost effect fails, a press-made element is compared, an exemption lets only its own lines go */
{
  const K = (ids, attrs = []) => ({ ids: new Set(ids), attrs: new Set(attrs) });
  const r = (label, page, known, server = [], load = []) => ({ hit: { label }, page, server, load, known });
  check(judge(r('X [t x]', ['shown #panel'], K(['panel'])), r('X [t x]', ['shown #panel'], K(['panel']))).ok, 'judge: the same effect is the same');
  const lostR = judge(r('X [t x]', ['shown #panel'], K(['panel'])), r('X [t x]', [], K([])));
  check(!lostR.ok && lostR.lost.includes('shown #panel'), 'judge: kit off shows #panel, the kit-on page lost #panel and the key does nothing: a failure (lost)');
  check(!judge(r('X [t x]', ['shown #made'], K(['made'])), r('X [t x]', [], K(['made']))).ok, 'judge: an element the press makes is compared (kit on has it, never shows it): a failure');
  check(!judge(r('X [t x]', ['state #gm-x a -> b'], K([], ['#gm-x'])), r('X [t x]', [], K([], []))).ok, 'judge: a state change on an element the kit-on page lost: a failure');
  check(!judge(r('X [t x]', [], K([]), ['+ /state/doc/a = 1']), r('X [t x]', [], K([]), ['+ /state/doc/a = 1', '+ /state/doc/b = 2'])).ok, 'judge: a server write only the kit makes: a failure');
  check(!judge(r('X [t x]', [], K([]), [], []), r('X [t x]', [], K([]), [], ['+ /state/doc/b = 2'])).ok, 'judge: a write only the kit page makes while it loads: a failure');
  const nw = judge(r('X [t x]', ['shown #panel'], K(['panel'])), r('X [t x]', ['shown #panel', 'shown #kit-only'], K(['panel', 'kit-only'])));
  check(nw.ok && nw.extra.includes('shown #kit-only'), 'judge: markup only the kit-on page has is a note, not a failure');
  const exA = judge(r('A [assist a]', ['shown #as-screen', 'shown #as-feed'], K(['as-screen', 'as-feed'])), r('A [assist a]', ['shown #as-feed'], K(['as-screen', 'as-feed'])));
  check(exA.ok && exA.exempted.length === 1, 'judge: a named exemption lets its own line go (KS07, A)');
  check(!judge(r('A [assist a]', ['shown #as-feed'], K(['as-feed'])), r('A [assist a]', [], K(['as-feed']))).ok, 'judge: the exemption lets nothing else go (A: #as-feed not shown)');
  check(!judge(r('Q [t q]', ['shown #as-screen'], K(['as-screen'])), r('Q [t q]', [], K(['as-screen']))).ok, 'judge: the exemption holds for its own key only');
}
if (process.env.KIT_KEYS_SELF_ONLY === '1') { console.log(failed ? 'FAIL kit-keys (self-checks only)' : 'PASS kit-keys (self-checks only)'); process.exit(failed ? 1 : 0); }
if (!process.env.PW_MODULE) { console.log('SKIP kit-keys: PW_MODULE is not set (it needs Playwright)'); process.exit(0); }
const { chromium } = require(process.env.PW_MODULE);

/* keys that, in the context this check can set up, may legitimately do nothing: each with the reason (a capture bar that is off, nothing to undo) */
const NO_EFFECT_OK = {
  'u': 'nothing of Blade\'s to undo on a fresh night', 'p': 'the capture bar is off (it is a Menu setting)', 'x': 'the capture bar is off', 'm': 'the capture bar is off',
  'l': 'the capture bar is off; no roll to file', '0': 'the iPad is already clear', 'h': 'one tap of H H is half a blank',
  'panel k': 'at the first card there is nothing before it', 'panel u': 'nothing to undo on a fresh night',
  'panel j': 'with no card focused J has nothing to move from (the Now card leaving was its timer, not J: NOW_MS)'
};

/* the keys, from the card: [{ label, key (Playwright), ctx, via, sec, id }] in card order, the Esc and blanking keys last (they change the night's state for everyone after) */
const toPw = (h) => (h.ctrl ? 'Control+' : '') + (h.shift ? 'Shift+' : '') + (h.key === ' ' ? 'Space' : h.key);
const ctxOf = (h) => (h.via === 'site' ? 'run' : h.via === 'panel' ? 'panel' : h.via === 'find' ? 'find' : 'score');
const HITS = [];
for (const s of SC.SECTIONS) for (const r of s.rows) if (r.k === 'key') r.hits.forEach((h, i) => HITS.push({ sec: s.id, label: r.keys.join(' / ') + ' [' + (h.act ? h.act.type : h.via) + ' ' + toPw(h) + ']', key: toPw(h), ctx: ctxOf(h), act: h.act ? h.act.type : '', via: h.via || '', letter: (h.via ? h.via + ' ' : '') + h.key.toLowerCase() }));
const LAST = new Set(['esc', 'blank', 'blank-tap', 'clear']);
HITS.sort((a, b) => (LAST.has(a.act) ? 1 : 0) - (LAST.has(b.act) ? 1 : 0));
const hits = ONLY.length ? HITS.filter((h) => ONLY.some((o) => h.label.includes(o))) : HITS;

const NOW = Date.now(), iso = (m) => new Date(NOW - m * 60000).toISOString();
const CARDS = [
  { seat: 'ref', kind: 'rule', at: iso(9), text: 'Invented slip.', headline: 'No resistance roll was offered after the harm', bullets: ['The harm can be resisted'], cite: 'p.12', check: 'resist' },
  { seat: 'mystery', kind: 'idea', at: iso(8), text: 'Invented idea.', headline: 'Push the second key into the scene', bullets: ['How: the cook drops it'] },
  { seat: 'clerk', kind: 'note', at: iso(5), text: 'Invented note.', headline: 'Loose end: the missing ledger', bullets: ['Not yet in the cast'] }
];

/* in the page */
function snapPage() {
  const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('[hidden]'); };
  /* a step of a path: the tag and its FIRST CLASS IN SORTED ORDER (a kit part puts its ui-* class first and keeps the old one: the order is not a hook) */
  const sigOf = (a) => a.tagName.toLowerCase() + (typeof a.className === 'string' && a.className.trim() ? '.' + a.className.trim().split(/\s+/).sort()[0] : '');
  /* the insides of an svg (a figure's groups) are drawing, not hooks: the fingerprint skips them too */
  const inSvg = (e) => !!(e.parentElement && e.parentElement.closest('svg'));
  const path = (e) => { if (e.id) return '#' + e.id; const out = []; for (let a = e; a && a !== document.body && out.length < 4; a = a.parentElement) { const p = a.parentElement, sg = sigOf(a); out.push(a.id ? '#' + a.id : sg + ':' + (p ? [...p.children].filter((x) => sigOf(x) === sg).indexOf(a) : 0)); if (a.id) break; } return out.reverse().join('>'); };
  const A = ['aria-pressed', 'aria-selected', 'aria-current', 'aria-expanded', 'data-state', 'data-open', 'data-alarm', 'data-active', 'data-on'];
  const ids = [...document.querySelectorAll('[id]')].filter((e) => !inSvg(e) && vis(e)).map((e) => e.id).sort();
  const attrs = {}; document.querySelectorAll(A.map((a) => '[' + a + ']').join(',')).forEach((e) => { if (!inSvg(e)) attrs[path(e)] = A.map((a) => e.getAttribute(a)).join('|'); });
  const a = document.activeElement, toast = ['toastMsg', 'toastErr'].map((i) => { const e = document.getElementById(i); return e ? e.textContent.trim() : ''; }).join('|');
  const all = [...document.querySelectorAll('[id]')].filter((e) => !inSvg(e)).map((e) => e.id);
  return { ids, all, attrs, active: a && a !== document.body ? path(a) : '', hash: location.hash, toast, find: !!document.querySelector('#gm-find-q') && vis(document.querySelector('#gm-find-q')) };
}
/* an id the page made from the clock and a dice roll (hmwdbhyvbau3l, nmwdbi3uc013): a letter, then letters and at least one digit, 10 to 15 characters, or a letter and the clock's m... */
const GEN_ID = /^(?:[a-z](?=[a-z0-9]*\d)[a-z0-9]{9,14}|[a-z]m[a-z0-9]{9,12})$/;      /* the second shape: a letter, then the clock's base 36 (m...) */
const clean = (v) => {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) { if (/^(at|ts|updated|seq|rev|etag|until|sent|exportedAt|nowMs|savedAt|lastAt)$/.test(k)) continue; o[k] = clean(v[k]); } return o; }
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:/.test(v)) return 'ISO';
  if (typeof v === 'string' && GEN_ID.test(v)) return '<id>';
  if (typeof v === 'number' && v > 1e11) return 'EPOCH';
  return v;
};
const flat = (v, p = '', out = new Map()) => {
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) flat(v[k], p + '/' + (GEN_ID.test(k) ? '<id>' : k), out); if (!Object.keys(v).length) out.set(p, Array.isArray(v) ? '[]' : '{}'); }
  else out.set(p, JSON.stringify(v));
  return out;
};
/* the display GET is built from the ambient and campaign documents, which are compared themselves; an overlay's age and its timed expiry are the clock's */
const QUIET = (path) => /^\/display\//.test(path) || /\/age$/.test(path);
function serverDiff(a, b) {
  const out = [], A = new Map([...flat(clean(a))].filter(([k]) => !QUIET(k))), B = new Map([...flat(clean(b))].filter(([k]) => !QUIET(k)));
  for (const [k, v] of B) if (!A.has(k)) out.push('+ ' + k + ' = ' + v.slice(0, 60)); else if (A.get(k) !== v) out.push('~ ' + k + ' ' + A.get(k).slice(0, 40) + ' -> ' + v.slice(0, 40));
  for (const k of A.keys()) if (!B.has(k)) out.push('- ' + k);
  return out.sort();
}
function pageDiff(a, b) {
  const out = [], sa = new Set(a.ids), sb = new Set(b.ids);
  for (const i of b.ids) if (!sa.has(i)) out.push('shown #' + i);
  for (const i of a.ids) if (!sb.has(i)) out.push('hidden #' + i);
  /* state the clock or a poll changes, not the key: Blade's seat state (waiting, setting up); the Now card (it leaves Now 1.5 s after the panel shows it,
     app/gm/assist-panel.js NOW_MS); the Run view's people rows (presence arrives with the polls: kit-off masks the players chip for the same reason) */
  const live = (k) => /^#as-state$/.test(k) || /^#as-now>/.test(k) || /(^|>)ul\.rv-ppl:/.test(k);
  for (const k of Object.keys(b.attrs).filter((x) => !live(x))) if (a.attrs[k] === undefined) out.push('new ' + k + ' ' + b.attrs[k]); else if (a.attrs[k] !== b.attrs[k]) out.push('state ' + k + ' ' + a.attrs[k] + ' -> ' + b.attrs[k]);
  for (const k of Object.keys(a.attrs).filter((x) => !live(x))) if (b.attrs[k] === undefined) out.push('gone ' + k);
  if (a.active !== b.active) out.push('focus ' + (a.active || 'none') + ' -> ' + (b.active || 'none'));
  if (a.hash !== b.hash) out.push('hash ' + a.hash + ' -> ' + b.hash);
  if (a.toast !== b.toast) out.push('toast "' + b.toast + '"');
  return out.sort();
}

/* one demo night, every hit: returns [{ hit, page: [lines], server: [lines], known: { ids, attrs }, errors }] */
async function pass(port, kit) {
  const demo = await startDemo(ROOT, port, ['--kit', kit, '--clock', '20:00']);
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const api = (p) => fetch(demo.base + '/api' + p, { headers: { 'X-Dev-User': GM } }).then((r) => r.json().catch(() => null), () => null);
  const server = async () => ({ state: await api('/gm/state'), ambient: await api('/gm/ambient'), display: await api('/gm/display'), campaign: await api('/campaign') });
  await fetch(demo.base + '/api/gm/stt', { method: 'PATCH', headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: '{"want":"on"}' });      /* Blade's tick runs while Listening is wanted */
  const res = [];
  try {
    for (const h of hits) {
      const errors = [];
      const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
      await c.addInitScript(() => { window.__B68_POLL_MS = 1000; });
      /* the same dice and the same time of day in both passes: the two demo nights must be the same night (scripts/kit-fingerprint.mjs) */
      await c.addInitScript(() => { let a = 0x9e3779b9; Math.random = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; });
      const ck = clockScript(); if (ck) await c.addInitScript(ck[0], ck[1]);
      const page = await c.newPage();
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text().slice(0, 160)); });
      page.on('dialog', (d) => d.accept());
      let tick = CARDS.slice();
      if (h.ctx === 'panel') {
        await page.route('**/api/gm/assist/tick', (route) => { const cards = tick.splice(0); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards, updates: [], flags: [], spend: { tonight: 0.2, cap: 30, tier: 'all', tick: 0.02 }, last: 9 }) }); });
        await page.route('**/api/gm/assist/cards', (route) => route.request().method() === 'POST' ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"marked":1}' }) : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards: [], updates: [], asks: [] }) }));
      }
      try {
        const s0 = await server();
        await page.goto(demo.base + '/#gm');
        await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
        await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
        await page.waitForFunction(() => window.B68GmPage && window.B68GmPage._places && window.B68GmPage._places(), null, { timeout: 20000 });
        await page.evaluate(() => window.B68GmPage.goPlace('score'));
        await page.waitForTimeout(900);
        const blur = () => page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
        if (h.ctx === 'run') { await blur(); await page.keyboard.press('g'); await page.waitForSelector('.rv-head', { timeout: 15000 }); await page.waitForTimeout(500); }
        if (h.ctx === 'panel') {
          await page.waitForFunction(() => { const n = document.querySelector('#as-count'); return n && !n.hidden; }, null, { timeout: 20000 });
          await blur(); await page.keyboard.press('a');
          await page.waitForFunction(() => { const p = document.querySelector('#as-panel'); return p && p.getBoundingClientRect().left < innerWidth - 100; }, null, { timeout: 5000 });
          await page.waitForTimeout(600);
        }
        if (h.ctx === 'find') { await blur(); await page.keyboard.press('Control+k'); await page.waitForSelector('#gm-find-q', { timeout: 5000 }); await page.fill('#gm-find-q', 'go to'); await page.waitForTimeout(500); }
        else await blur();
        /* what the page writes while it loads and settles (going to the Score enters its phase; the Roll seeds its line from the room) lands before the press:
           wait until the server has been still for a moment, so a late write is not taken for the key's. Those writes are compared too (load) */
        let sb = await server();
        for (let t = 0; t < 12; t++) { await page.waitForTimeout(700); const s2 = await server(); if (!serverDiff(sb, s2).length) break; sb = s2; }
        const b = await page.evaluate(snapPage);
        await page.keyboard.press(h.key);
        await page.waitForTimeout(1100);
        const a = await page.evaluate(snapPage), sa = await server();
        res.push({ hit: h, page: pageDiff(b, a), server: serverDiff(sb, sa), load: serverDiff(s0, sb), before: b.ids,
          known: { ids: new Set(b.all.concat(a.all)), attrs: new Set(Object.keys(b.attrs).concat(Object.keys(a.attrs))) }, errors });
      } catch (e) {
        res.push({ hit: h, page: ['ERROR ' + String(e.message || e).split('\n')[0]], server: [], load: [], known: { ids: new Set(), attrs: new Set() }, errors: errors.concat(['setup failed']) });
      } finally { await c.close(); }
      console.log('  pressed ' + h.label + (res[res.length - 1].page.length + res[res.length - 1].server.length ? '' : '   (nothing changed)'));
    }
  } finally { await browser.close().catch(() => {}); await demo.stop(); }
  return res;
}

const timer = setTimeout(() => { console.log('FAIL timed out'); process.exit(1); }, 2700000);
setClock('20:00');
let off = null, on = null;
try {
  console.log('kit OFF (the five settings written off): ' + hits.length + ' key presses');
  off = await pass(PORT, 'none');
  console.log('kit ON (desk, stage, phone, who, pitches): ' + hits.length + ' key presses');
  on = await pass(PORT + 1, 'desk,stage,phone,who,pitches');
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
clearTimeout(timer);

if (off && on) {
  const rows = SC.rows('key').reduce((n, r) => n + r.hits.length, 0);
  check(ONLY.length || off.length === rows, 'every hit of every key row on the card was pressed (' + off.length + ' of ' + rows + ', ' + SC.SECTIONS.length + ' sections)');
  check(off.every((r) => !r.errors.length), 'kit off: no page error on any press' + (off.some((r) => r.errors.length) ? ': ' + off.filter((r) => r.errors.length).slice(0, 3).map((r) => r.hit.label + ' ' + r.errors[0]).join(' | ') : ''));
  const idle = off.filter((r) => !r.page.length && !r.server.length && !NO_EFFECT_OK[r.hit.letter]);
  check(idle.length === 0, 'kit off: every key did something' + (idle.length ? ' (nothing: ' + idle.map((r) => r.hit.label).join(', ') + ')' : ''));
  for (const r of off.filter((x) => !x.page.length && !x.server.length && NO_EFFECT_OK[x.hit.letter])) console.log('  note: ' + r.hit.label + ' did nothing here: ' + NO_EFFECT_OK[r.hit.letter]);
  let same = 0, notes = 0;
  const usedEx = new Map();
  off.forEach((o, i) => {
    const n = on[i], j = judge(o, n);
    if (j.extra.length) { notes++; console.log('  note: ' + o.hit.label + ': only the kit-on page has ' + j.extra.slice(0, 3).join('; ')); }
    for (const x of j.exempted) { if (!usedEx.has(x)) usedEx.set(x, []); usedEx.get(x).push(o.hit.label); }
    if (j.ok) same++;
    else {
      check(false, 'the same key does the same thing, kit off and on: ' + o.hit.label);
      if (j.lost.length) console.log('    LOST (the kit-on page has no such element): ' + JSON.stringify(j.lost).slice(0, 500));
      if (j.offOnly.length) console.log('    only with the kit off: ' + JSON.stringify(j.offOnly).slice(0, 500));
      if (j.onOnly.length) console.log('    only with the kit on:  ' + JSON.stringify(j.onOnly).slice(0, 500));
      if (process.env.KIT_KEYS_DEBUG === '1' && o.before && n.before) {        /* the context before the press: what was in view on one page only */
        const bo = new Set(o.before), bn = new Set(n.before);
        console.log('    in view before the press, kit off only: ' + o.before.filter((x) => !bn.has(x)).slice(0, 25).join(' '));
        console.log('    in view before the press, kit on only:  ' + n.before.filter((x) => !bo.has(x)).slice(0, 25).join(' '));
      }
    }
  });
  console.log('exemptions (KEYS_EXEMPT, each named with its reason):');
  for (const x of KEYS_EXEMPT) console.log('  ' + x.name + ' (' + x.reason + '): ' + (usedEx.has(x.name) ? 'used by ' + usedEx.get(x.name).join(', ') : 'not needed this run'));
  check(same === off.length, 'kit on does what kit off does, for ' + same + ' of ' + off.length + ' presses (' + notes + ' note(s) of markup only the new pages have; ' + usedEx.size + ' exemption(s) used)');
}
console.log(failed ? 'FAIL kit-keys' : 'PASS kit-keys');
process.exit(failed ? 1 : 0);
