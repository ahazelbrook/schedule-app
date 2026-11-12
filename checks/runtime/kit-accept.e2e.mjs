// kit-accept (KS04.4 of the kit and stage build): the acceptance numbers, measured in a real browser against the demo night (scripts/demo-night.mjs).
//   1. boxed controls on the Run view at 1366x768            target 25 or fewer
//   2. the smallest GM text (the Run view; and the Blade panel)  target 12 px or more
//   3. Blade cards visible at once (1366x768, panel open)    target 4 or more
//   4. the iPad's text height (1024x768): the share of the screen's height   target 3.3% or more
//   5. the lowest iPad text contrast: text against what is behind it (not plates alone)   target 4.5:1 or more
//   (the design's "idle stage: nothing moving" is KS13's, measured when that stage exists)
// REPORTS ONLY, until KS20 makes it a hard check: it prints the numbers (today's, for the old desk) and passes if every page could be measured. KIT_ACCEPT_HARD=1 turns
// the targets into failures (KS20). KIT_ACCEPT_KIT=desk,stage,... starts the demo night with those settings on, so a bundle can see its own numbers.
// How each is counted, so a later builder reads the same thing:
//   boxed control    a visible button, [role=button], input, select, textarea or summary that touches the 1366x768 window and is drawn as a box: a border of 1 px or more in a
//                    colour that shows, or a background that is not transparent, or a box shadow
//   text             an element with text of its own that is drawn (not hidden, not zero-size, not screen-reader-only: clipped to 1 px); its computed font-size.
//                    "Drawn" multiplies the opacity of the element and EVERY ancestor (0 under a display:none ancestor), so chrome a parent hides with opacity 0
//                    (the old iPad chrome under kit.stage) is not counted. An idle kit.stage screen may draw no text at all: its iPad rows print "n/a idle".
//   Blade card       an .as-card whose whole box is inside the open panel and the window (cards are invented, answered by the browser's own route: no key, no model)
//   text height      font-size / window height; the median is by characters, so a long line counts more than a label
//   contrast         the text colour against the nearest background behind it (translucent layers composited); text on an image or a gradient is counted as "not measured"
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9401] [KIT_ACCEPT_KIT=desk] [KIT_ACCEPT_HARD=1] node checks/runtime/kit-accept.e2e.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startDemo } from '../../scripts/kit-fingerprint.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9401);
const HARD = process.env.KIT_ACCEPT_HARD === '1';
const KIT = (process.env.KIT_ACCEPT_KIT || '').trim();
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
if (!process.env.PW_MODULE) { console.log('SKIP kit-accept: PW_MODULE is not set (it needs Playwright)'); process.exit(0); }
const { chromium } = require(process.env.PW_MODULE);
let failed = 0;
const check = (ok, name) => { if (ok) console.log('PASS ' + name); else { failed++; console.log('FAIL ' + name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Everything below runs in the page. */
const MEASURE = {
  controls() {
    const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0; };
    const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 0; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
    const boxed = (e) => {
      const s = getComputedStyle(e);
      for (const side of ['top', 'right', 'bottom', 'left']) if (parseFloat(s.getPropertyValue('border-' + side + '-width')) >= 1 && s.getPropertyValue('border-' + side + '-style') !== 'none' && alpha(s.getPropertyValue('border-' + side + '-color')) > 0) return true;
      return alpha(s.backgroundColor) > 0 || (s.boxShadow && s.boxShadow !== 'none') || false;
    };
    const touches = (e) => { const r = e.getBoundingClientRect(); return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; };
    const all = [...document.querySelectorAll('button, [role="button"], input:not([type="hidden"]), select, textarea, summary')].filter(vis);
    const onScreen = all.filter(touches), boxedOn = onScreen.filter(boxed);
    const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : '');
    return { visible: all.length, onScreen: onScreen.length, boxedOnScreen: boxedOn.length, boxedTotal: all.filter(boxed).length, sample: boxedOn.slice(0, 6).map(name) };
  },
  text() {
    /* shown: the opacity the element is really drawn at, its own times every ancestor's (the kit stage hides the old chrome with opacity 0 on a PARENT, so the
       element's own opacity is not enough); 0 under a display:none ancestor. Visibility is the element's computed value, which a visibility:hidden ancestor
       passes down (a child that sets visible again really is drawn). */
    const shown = (e) => { let o = 1; for (let a = e; a; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.display === 'none') return 0; o *= +cs.opacity; if (!(o > 0)) return 0; } return o; };
    const drawn = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 1 && r.height > 1 && s.visibility === 'visible' && shown(e) > 0 && !(s.position === 'absolute' && s.clip && s.clip !== 'auto'); };
    const out = [];
    for (const e of document.body.querySelectorAll('*')) {
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(e.tagName) || e.closest('svg')) continue;
      let own = ''; for (const n of e.childNodes) if (n.nodeType === 3) own += n.nodeValue;
      own = own.trim(); if (!own || !drawn(e)) continue;
      const r = e.getBoundingClientRect(); if (r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue;
      out.push({ px: parseFloat(getComputedStyle(e).fontSize), n: own.length, name: e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : ''), text: own.slice(0, 24) });
    }
    return out;
  },
  contrast() {
    const parse = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
    /* the same "really drawn" test as text(): every ancestor's opacity multiplied in, 0 under a display:none ancestor, the computed visibility */
    const shown = (e) => { let o = 1; for (let a = e; a; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.display === 'none') return 0; o *= +cs.opacity; if (!(o > 0)) return 0; } return o; };
    const out = [];
    for (const e of document.body.querySelectorAll('*')) {
      if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(e.tagName) || e.closest('svg')) continue;
      let own = ''; for (const n of e.childNodes) if (n.nodeType === 3) own += n.nodeValue;
      own = own.trim(); if (!own) continue;
      const r = e.getBoundingClientRect(), s = getComputedStyle(e);
      if (r.width <= 1 || r.height <= 1 || s.visibility !== 'visible' || !(shown(e) > 0) || r.right <= 0 || r.bottom <= 0 || r.left >= innerWidth || r.top >= innerHeight) continue;
      let fg = parse(s.color), layers = [], image = false;
      for (let a = e; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') { image = true; break; }
        const bg = parse(cs.backgroundColor); if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 1) break; }
      }
      const name = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : '');
      if (image || !fg) { out.push({ name, text: own.slice(0, 24), ratio: null }); continue; }
      let base = { r: 255, g: 255, b: 255, a: 1 }; for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
      const f = fg.a < 1 ? over(fg, base) : fg, L1 = lum(f), L2 = lum(base);
      out.push({ name, text: own.slice(0, 24), ratio: Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100 });
    }
    return out;
  }
};

/* the cards the Blade panel is given (invented; the browser's own route answers the tick: no key, no model, no spend) */
const NOW = Date.now(), iso = (m) => new Date(NOW - m * 60000).toISOString();
const CARDS = [
  { seat: 'clerk', kind: 'note', at: iso(50), text: 'Invented clerk text.', headline: 'New name: Wren (invented)', bullets: ['Heard twice in ten minutes'] },
  { seat: 'ref', kind: 'rule', at: iso(9), text: 'Invented slip.', headline: 'No resistance roll was offered after the harm', bullets: ['The harm can be resisted'], cite: 'p.12', check: 'resist' },
  { seat: 'mystery', kind: 'idea', at: iso(8), text: 'Invented idea.', headline: 'Push the second key into the scene', bullets: ['How: the cook drops it'] },
  { seat: 'ref', kind: 'rule', at: iso(7), text: 'Invented slip two.', headline: 'The cost was not named', bullets: ['"We go in"'], cite: 'p.14', check: 'cost' },
  { seat: 'mystery', kind: 'idea', at: iso(6), text: 'Invented idea two.', headline: 'A guard changes shift early', bullets: ['The door is unwatched'] },
  { seat: 'clerk', kind: 'note', at: iso(5), text: 'Invented note two.', headline: 'Loose end: the missing ledger', bullets: ['Not yet in the cast'] },
  { seat: 'ref', kind: 'rule', at: iso(4), text: 'Invented slip three.', headline: 'Position was not set before the roll', bullets: ['Set it first'], check: 'position' },
  { seat: 'mystery', kind: 'idea', at: iso(3), text: 'Invented idea three.', headline: 'The alarm bell rings upstairs', bullets: ['Everyone looks up'] }
];
const SPEND = { tonight: 0.2, cap: 30, tier: 'all', tick: 0.02 };

const sum = (a) => a.reduce((x, y) => x + y, 0);
const median = (list) => { const s = list.slice().sort((a, b) => a.px - b.px), total = sum(s.map((x) => x.n)); let run = 0; for (const x of s) { run += x.n; if (run >= total / 2) return x.px; } return 0; };
const num = (v, d = 1) => (Math.round(v * Math.pow(10, d)) / Math.pow(10, d));

let demo = null, browser = null;
const timer = setTimeout(async () => { console.log('FAIL timed out'); if (browser) await browser.close().catch(() => {}); if (demo) await demo.stop(); process.exit(1); }, 420000);
try {
  demo = await startDemo(ROOT, PORT, KIT ? ['--kit', KIT] : []);
  const BASE = demo.base;
  const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, text: await r.text() }));
  browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const open = async (route, user, w, h, setup) => {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width: w, height: h }, serviceWorkers: 'block' });
    await c.addInitScript(() => { window.__B68_POLL_MS = 1000; try { localStorage.setItem('b68.display.hint', '1'); } catch (e) { /* no storage */ } });
    const page = await c.newPage();
    if (setup) await setup(page);
    await page.goto(BASE + '/' + route);
    return { c, page };
  };
  const GM_READY = async (page) => {
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await page.waitForTimeout(800);
  };
  const toScore = async (page) => { await page.waitForFunction(() => window.B68GmPage && window.B68GmPage._places && window.B68GmPage._places(), null, { timeout: 20000 }); await page.evaluate(() => window.B68GmPage.goPlace('score')); await page.waitForTimeout(900); };
  const note = (s) => console.log(s);

  /* ---- 1 and 2: the GM page, the Run view at 1366x768 ---- */
  let boxed = null, minPx = null, blade = null, minBlade = null;
  {
    const { c, page } = await open('#gm', GM, 1366, 768);
    await GM_READY(page); await toScore(page);
    await page.keyboard.press('g'); await page.waitForSelector('.rv-head', { timeout: 20000 }); await page.waitForTimeout(600);
    boxed = await page.evaluate(MEASURE.controls);
    const t = await page.evaluate(MEASURE.text);
    const small = t.filter((x) => x.px < 12), minAll = Math.min(...t.map((x) => x.px));
    minPx = minAll;
    note('1. Run at 1366x768: ' + boxed.boxedOnScreen + ' boxed controls in the window (' + boxed.onScreen + ' controls in the window, ' + boxed.visible + ' on the page, ' + boxed.boxedTotal + ' of those boxed)   target 25 or fewer');
    note('   boxed, for example: ' + boxed.sample.join(', '));
    note('2. smallest GM text (the Run view only): ' + minAll + ' px   ' + small.length + ' of ' + t.length + ' text elements under 12 px   target 12 px or more');
    const byName = new Map(); for (const x of small) byName.set(x.name, (byName.get(x.name) || 0) + 1);
    note('   under 12 px, by element: ' + ([...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, k]) => n + ' x' + k).join(', ') || 'none'));
    /* the panel too, with cards */
    await c.close();
  }
  await api('PATCH', '/gm/stt', { want: 'on' });      /* Blade's tick runs while Listening is wanted */
  let tickReply = CARDS.slice();
  {
    const { c, page } = await open('#gm', GM, 1366, 768, async (p) => {
      await p.route('**/api/gm/assist/tick', (route) => { const cards = tickReply.splice(0); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards, updates: [], flags: [], spend: SPEND, last: 9 }) }); });
      await p.route('**/api/gm/assist/cards', (route) => route.request().method() === 'POST' ? route.fulfill({ status: 200, contentType: 'application/json', body: '{"marked":1}' }) : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards: [], updates: [], asks: [] }) }));
    });
    await GM_READY(page); await toScore(page);
    await page.waitForFunction(() => { const n = document.querySelector('#as-count'); return n && !n.hidden; }, null, { timeout: 20000 }).catch(() => {});
    await page.keyboard.press('a');
    await page.waitForFunction(() => { const p = document.querySelector('#as-panel'); return p && p.getBoundingClientRect().left < innerWidth - 100; }, null, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
    blade = await page.evaluate(() => {
      const panel = document.querySelector('#as-panel'), pr = panel ? panel.getBoundingClientRect() : null;
      const cards = [...document.querySelectorAll('#as-list .as-card')];
      const inside = cards.filter((e) => { const r = e.getBoundingClientRect(); return pr && r.height > 0 && r.top >= Math.max(pr.top, 0) - 0.5 && r.bottom <= Math.min(pr.bottom, innerHeight) + 0.5 && r.left >= pr.left - 0.5 && r.right <= pr.right + 0.5; });
      return { cards: cards.length, whole: inside.length, folded: cards.filter((e) => e.getAttribute('data-open') !== '1').length };
    });
    const t = await page.evaluate(MEASURE.text);
    minBlade = Math.min(...t.map((x) => x.px));
    note('3. Blade cards visible at once (1366x768, the panel open, ' + blade.cards + ' cards given): ' + blade.whole + ' whole   target 4 or more');
    note('   smallest text with the Blade panel open: ' + minBlade + ' px');
    await c.close();
  }
  /* ---- 4 and 5: the iPad at 1024x768, idle and with a stamp up ---- */
  const rows = [];
  for (const state of ['idle', 'stamp']) {
    await api('PATCH', '/gm/ambient', { overlay: state === 'idle' ? null : { id: 'kit-accept-' + state, kind: 'report', ms: 180000, payload: { position: 'risky', effect: 'standard', text: 'Nell goes for it: the guard is watching the door' } } });
    const { c, page } = await open('#display', IPAD, 1024, 768);
    await page.waitForSelector('.dp-overlay', { state: 'attached', timeout: 30000 });
    if (state === 'stamp') await page.waitForSelector('.dp-ov-stamp, .dp-ov-report, [class*="dp-ov-"]', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const t = await page.evaluate(MEASURE.text), k = await page.evaluate(MEASURE.contrast);
    /* the new stage (kit.stage) puts no chrome on the idle screen by design, so an idle stage may draw no text at all: that row is "n/a idle", never a crash
       and never a pass by default (see the checks below) */
    const stageOn = await page.evaluate(() => /(^|\s)stage(\s|$)/.test(document.documentElement.getAttribute('data-kit') || ''));
    const H = 768, px = t.map((x) => x.px), med = median(t);
    const measured = k.filter((x) => x.ratio !== null), low = measured.filter((x) => x.ratio < 4.5);
    rows.push({ state, stageOn, min: t.length ? Math.min(...px) : null, med, n: t.length, k, measured, low });
    if (!t.length) note('4. iPad ' + state + ' (1024x768): no visible text (n/a ' + state + '; kit.stage ' + (stageOn ? 'on' : 'off') + ')   target 3.3% (25.3 px) or more');
    else note('4. iPad ' + state + ' (1024x768): median text ' + num(med) + ' px = ' + num((med / H) * 100) + '% of the height, smallest ' + Math.min(...px) + ' px = ' + num((Math.min(...px) / H) * 100) + '%, largest ' + Math.max(...px) + ' px (' + t.length + ' text elements)   target 3.3% (25.3 px) or more');
    note('5. iPad ' + state + ': contrast, ' + measured.length + ' measured, ' + (k.length - measured.length) + ' on an image or a gradient (not measured); lowest ' + (measured.length ? Math.min(...measured.map((x) => x.ratio)) + ':1' : 'n/a') + ', ' + low.length + ' under 4.5:1   target 4.5:1 or more');
    if (low.length) note('   under 4.5:1: ' + low.slice(0, 5).map((x) => x.name + ' "' + x.text + '" ' + x.ratio).join('; '));
    await c.close();
  }
  await api('PATCH', '/gm/ambient', { overlay: null });
  /* a row with no visible text is acceptable ONLY for the idle screen with kit.stage on; the stamp must always draw text, and so must the old (stage off) idle
     screen, whose chrome is really there. The target rows below are judged on the rows that drew text; an empty row prints "n/a". */
  const emptyOk = (r) => r.n > 0 || (r.state === 'idle' && r.stageOn);
  const drew = rows.filter((r) => r.n > 0);

  /* what was measured, as pass or fail only for "could it be measured" (and the targets when KIT_ACCEPT_HARD=1) */
  check(boxed && boxed.onScreen > 0, 'the Run view was measured');
  check(minPx !== null && Number.isFinite(minPx), 'the GM page text was measured');
  check(blade && blade.cards > 0, 'the Blade panel showed the cards it was given (' + (blade ? blade.cards : 0) + ')');
  check(rows.length === 2 && rows.every(emptyOk) && drew.some((r) => r.state === 'stamp'), 'the iPad was measured, idle and with a stamp up (' + rows.map((r) => r.state + ' ' + (r.n ? r.n + ' text elements' : 'no visible text')).join(', ') + ')');
  console.log('targets: ' + (HARD ? 'HARD (a miss fails)' : 'reports only until KS20 makes them hard (KIT_ACCEPT_HARD=1)'));
  const targets = [
    ['boxed controls on Run, 1366x768', boxed.boxedOnScreen <= 25, boxed.boxedOnScreen + ' (25 or fewer)'],
    ['smallest GM text (Run view, Blade panel)', Math.min(minPx, minBlade) >= 12, Math.min(minPx, minBlade) + ' px (12 or more)'],
    ['Blade cards visible at once', blade.whole >= 4, blade.whole + ' (4 or more)'],
    ['iPad text height (median)', drew.length > 0 && drew.every((r) => r.med / 768 >= 0.033), rows.map((r) => (r.n ? num((r.med / 768) * 100) + '% ' : 'n/a ') + r.state).join(', ') + ' (3.3% or more)'],
    ['lowest iPad text contrast', drew.length > 0 && rows.every((r) => r.low.length === 0), rows.map((r) => (r.n ? r.low.length + ' under 4.5:1 ' : 'n/a ') + r.state).join(', ')]
  ];
  for (const [name, ok, what] of targets) { console.log((ok ? 'MET  ' : 'MISS ') + name + ': ' + what); if (HARD && !ok) failed++; }
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
} finally {
  clearTimeout(timer);
  if (browser) await browser.close().catch(() => {});
  if (demo) await demo.stop();
}
console.log(failed ? 'FAIL kit-accept' : 'PASS kit-accept' + (HARD ? '' : ' (reports only)'));
process.exit(failed ? 1 : 0);
