// kit-keys (KS04.5 of the kit and stage build): every key on the Shortcuts card, pressed with the kit off and with it on, and what happened compared.
// It reads the card's own rows (app/gm/shortcuts.js SECTIONS: key rows, every hit) and, for each hit, in a fresh GM page of the demo night
// (scripts/demo-night.mjs): sets the context the key needs (the Score, the Run view for the site's arrows, an open Blade panel with invented cards for its keys, an open
// Find for its keys), takes a snapshot, presses the key, waits, takes a snapshot, and keeps what changed:
//   on the page   the ids that became visible or hidden, the states that changed (aria-pressed, aria-selected, aria-current, aria-expanded, data-state, data-open,
//                 data-alarm, data-active, data-on), where focus went, the hash, a toast's words
//   on the server what the GM state, the iPad's ambient document, the display and the campaign gained, lost or changed (times and ids of time dropped)
// Two demo nights, one after the other, the same keys in the same order: the five settings written OFF, then all five ON (kit.desk kit.stage kit.phone night.who
// blade.pitches). The check passes when (1) with the kit off every hit was pressed and no page error came up, (2) every key but the few named in NO_EFFECT_OK did
// something (so a key that stops working is caught), and (3) the same key did the same thing with the kit on: the server effect equal, the page effect equal for
// every element both pages have (an element only the new markup has is listed as a note: the new desk may add markup, it may not change what a key does).
// Until a bundle fills its stub the two runs are the same page, so they agree.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9402] [KIT_KEYS_ONLY=<key labels, comma separated>] node checks/runtime/kit-keys.e2e.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startDemo } from '../../scripts/kit-fingerprint.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9402);
const GM = 'gm@example.test';
const SC = require('../../app/gm/shortcuts.js');
const ONLY = (process.env.KIT_KEYS_ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);
if (!process.env.PW_MODULE) { console.log('SKIP kit-keys: PW_MODULE is not set (it needs Playwright)'); process.exit(0); }
const { chromium } = require(process.env.PW_MODULE);
let failed = 0;
const check = (ok, name) => { if (ok) console.log('PASS ' + name); else { failed++; console.log('FAIL ' + name); } };

/* keys that, in the context this check can set up, may legitimately do nothing: each with the reason (a capture bar that is off, nothing to undo) */
const NO_EFFECT_OK = {
  'u': 'nothing of Blade\'s to undo on a fresh night', 'p': 'the capture bar is off (it is a Menu setting)', 'x': 'the capture bar is off', 'm': 'the capture bar is off',
  'l': 'the capture bar is off; no roll to file', '0': 'the iPad is already clear', 'h': 'one tap of H H is half a blank',
  'panel k': 'at the first card there is nothing before it', 'panel u': 'nothing to undo on a fresh night'
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
  const path = (e) => { if (e.id) return '#' + e.id; const out = []; for (let a = e; a && a !== document.body && out.length < 4; a = a.parentElement) { const p = a.parentElement; out.push(a.tagName.toLowerCase() + (typeof a.className === 'string' && a.className.trim() ? '.' + a.className.trim().split(/\s+/)[0] : '') + ':' + (p ? [...p.children].indexOf(a) : 0)); } return out.reverse().join('>'); };
  const A = ['aria-pressed', 'aria-selected', 'aria-current', 'aria-expanded', 'data-state', 'data-open', 'data-alarm', 'data-active', 'data-on'];
  const ids = [...document.querySelectorAll('[id]')].filter(vis).map((e) => e.id).sort();
  const attrs = {}; document.querySelectorAll(A.map((a) => '[' + a + ']').join(',')).forEach((e) => { attrs[path(e)] = A.map((a) => e.getAttribute(a)).join('|'); });
  const a = document.activeElement, toast = ['toastMsg', 'toastErr'].map((i) => { const e = document.getElementById(i); return e ? e.textContent.trim() : ''; }).join('|');
  return { ids, attrs, active: a && a !== document.body ? path(a) : '', hash: location.hash, toast, find: !!document.querySelector('#gm-find-q') && vis(document.querySelector('#gm-find-q')) };
}
const clean = (v) => {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) { if (/^(at|ts|updated|seq|rev|etag|until|sent|exportedAt|nowMs|savedAt|lastAt)$/.test(k)) continue; o[k] = clean(v[k]); } return o; }
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:/.test(v)) return 'ISO';
  if (typeof v === 'number' && v > 1e11) return 'EPOCH';
  return v;
};
const flat = (v, p = '', out = new Map()) => {
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) flat(v[k], p + '/' + k, out); if (!Object.keys(v).length) out.set(p, Array.isArray(v) ? '[]' : '{}'); }
  else out.set(p, JSON.stringify(v));
  return out;
};
function serverDiff(a, b) {
  const out = [], A = flat(clean(a)), B = flat(clean(b));
  for (const [k, v] of B) if (!A.has(k)) out.push('+ ' + k + ' = ' + v.slice(0, 60)); else if (A.get(k) !== v) out.push('~ ' + k + ' ' + A.get(k).slice(0, 40) + ' -> ' + v.slice(0, 40));
  for (const k of A.keys()) if (!B.has(k)) out.push('- ' + k);
  return out.sort();
}
function pageDiff(a, b) {
  const out = [], sa = new Set(a.ids), sb = new Set(b.ids);
  for (const i of b.ids) if (!sa.has(i)) out.push('shown #' + i);
  for (const i of a.ids) if (!sb.has(i)) out.push('hidden #' + i);
  for (const k of Object.keys(b.attrs)) if (a.attrs[k] === undefined) out.push('new ' + k + ' ' + b.attrs[k]); else if (a.attrs[k] !== b.attrs[k]) out.push('state ' + k + ' ' + a.attrs[k] + ' -> ' + b.attrs[k]);
  for (const k of Object.keys(a.attrs)) if (b.attrs[k] === undefined) out.push('gone ' + k);
  if (a.active !== b.active) out.push('focus ' + (a.active || 'none') + ' -> ' + (b.active || 'none'));
  if (a.hash !== b.hash) out.push('hash ' + a.hash + ' -> ' + b.hash);
  if (a.toast !== b.toast) out.push('toast "' + b.toast + '"');
  return out.sort();
}

/* one demo night, every hit: returns [{ hit, page: [lines], server: [lines], known: { ids, attrs }, errors }] */
async function pass(port, kit) {
  const demo = await startDemo(ROOT, port, ['--kit', kit]);
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
        const b = await page.evaluate(snapPage), sb = await server();
        await page.keyboard.press(h.key);
        await page.waitForTimeout(1100);
        const a = await page.evaluate(snapPage), sa = await server();
        res.push({ hit: h, page: pageDiff(b, a), server: serverDiff(sb, sa), known: { ids: new Set(b.ids), attrs: new Set(Object.keys(b.attrs)) }, errors });
      } catch (e) {
        res.push({ hit: h, page: ['ERROR ' + String(e.message || e).split('\n')[0]], server: [], known: { ids: new Set(), attrs: new Set() }, errors: errors.concat(['setup failed']) });
      } finally { await c.close(); }
      console.log('  pressed ' + h.label + (res[res.length - 1].page.length + res[res.length - 1].server.length ? '' : '   (nothing changed)'));
    }
  } finally { await browser.close().catch(() => {}); await demo.stop(); }
  return res;
}

const timer = setTimeout(() => { console.log('FAIL timed out'); process.exit(1); }, 1500000);
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
  off.forEach((o, i) => {
    const n = on[i];
    const onlyBoth = (line, ko, kn) => { const m = /^(?:shown|hidden) (#\S+)$/.exec(line) || /^(?:new|state|gone) (\S+)/.exec(line); if (!m) return true; const id = m[1].replace(/^#/, ''); const inBoth = (ko.ids.has(id) && kn.ids.has(id)) || (ko.attrs.has(m[1]) && kn.attrs.has(m[1])); return inBoth; };
    const po = o.page.filter((l) => onlyBoth(l, o.known, n.known)), pn = n.page.filter((l) => onlyBoth(l, o.known, n.known));
    const extra = n.page.filter((l) => !onlyBoth(l, o.known, n.known));
    const ok = JSON.stringify(po) === JSON.stringify(pn) && JSON.stringify(o.server) === JSON.stringify(n.server);
    if (extra.length) { notes++; console.log('  note: ' + o.hit.label + ': only the kit-on page has ' + extra.slice(0, 3).join('; ')); }
    if (ok) same++;
    else { check(false, 'the same key does the same thing, kit off and on: ' + o.hit.label); console.log('    off: ' + JSON.stringify(po.concat(o.server)).slice(0, 400)); console.log('    on:  ' + JSON.stringify(pn.concat(n.server)).slice(0, 400)); }
  });
  check(same === off.length, 'kit on does what kit off does, for ' + same + ' of ' + off.length + ' presses (' + notes + ' note(s) of markup only the new pages have)');
}
console.log(failed ? 'FAIL kit-keys' : 'PASS kit-keys');
process.exit(failed ? 1 : 0);
