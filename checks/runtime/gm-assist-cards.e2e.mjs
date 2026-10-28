// The Blade panel's cards (app/gm/assist-panel.js, ticket P3) on the real GM page, in a real browser, at 1440x900: the one card renderer (folded line,
// unfolded fields, SAY and GM ONLY, cite and check chips, More inside the card), Now (one type step larger, gone after 1.5 s), the feed and its filters,
// the Earlier divider, a 400-word answer that stays inside the panel, keyed rendering (the same DOM nodes survive a tick), a reload that restores the
// layout with the server's marks, light and dark (contrast), model text that stays text, and the closed panel (a rule or warn slides a strip out for
// 8 s; every other kind is a pip). The assist endpoints are answered by the browser's own route (invented cards): no key, no model, no spend.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [GM_SHOTS=<dir>] [PORT=8891] node checks/runtime/gm-assist-cards.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8864);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.GM_SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json');
const PARTS = {
  console: con.parts.console, campaign: np.parts.campaign, npc: np.parts.npc,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
  handouts: { src: { file: 'invented/handouts', blockSha: '1', exportedAt: new Date().toISOString() }, v: 1, rel: 'invented/handouts', items: [
    { id: 'ho-a', title: 'Invented brass key', file: '0123456789abcdef.png', when: 'invented cue one' },
    { id: 'ho-b', title: 'Invented torn map', file: 'fedcba9876543210.png' },
  ] },
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-assist-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: 'ignore' });
function killServer() {
  if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} }
}
process.on('exit', () => { killServer(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j }; });

const NOW = Date.now();
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

const SHOT_DIR = SHOTS || path.join(ROOT, 'gm-private', 'shots');
const LONG = Array.from({ length: 400 }, (_, i) => 'word' + i).join(' ');          // a 400-word fake answer
const TOKEN = 'unbroken' + 'x'.repeat(220);                                            // and one word that cannot wrap
const XSS = '<img src=x onerror="window.__pwn=1">';
const SPEND = { tonight: 3.4, cap: 30, tier: 'all', tick: 0.02 };
const CARDS = [
  { seat: 'clerk', kind: 'note', at: iso(50 * 60000), text: 'Invented clerk text, not the headline.', headline: 'New name: Wren (invented)', bullets: ['Heard twice in ten minutes', 'Not on the cast list'] },
  { seat: 'ref', kind: 'rule', at: iso(3 * 60000), text: 'Invented slip text, not the headline.', headline: 'No resistance roll was offered after the harm',
    bullets: ['[22:14] "It hits him in the arm"', 'Rulebook p.12: a harm can be resisted'], cite: 'p.12, p.13', check: 'resist', say: 'Offer the roll: will you **resist** it?', secret: 'The cook is the inside man.',
    more: '## Detail\n- first point\n- second point\n\n' + LONG + ' ' + TOKEN },
  { seat: 'mystery', kind: 'idea', at: iso(2 * 60000), text: 'Invented idea text.', headline: 'Push the second key into the scene', bullets: ['How: the cook drops it', 'Must land: the second key'] },
  { seat: 'ref', kind: 'rule', at: iso(1 * 60000), text: 'Invented newest slip.', headline: 'Newest slip: the cost was not named', bullets: ['[22:20] "We go in"'], cite: 'p.14', check: 'cost' },
];
const ASK = { at: iso(500), q: 'pitch two complications', kind: 'idea', headline: 'Two complications, ' + TOKEN, bullets: ['One', 'Two', 'Three', 'Four', 'Five', 'Six (cut)'], say: LONG, secret: 'The rival is already inside.', more: '- a list item\n\n' + LONG, text: 'Invented flat answer text.' };
const empty = () => ({ cards: [], updates: [], flags: [], spend: SPEND, last: 9 });
const tick = { reply: null, n: 0 };
const marks = [];
let restored = { cards: [], updates: [], asks: [] };

try {
  const up = await until(async () => { try { return (await fetch(BASE + '/index.html')).status > 0; } catch (_) { return false; } }, 90000, 500);
  if (!up) throw new Error('the server did not start');
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status);
  }
  await api('PATCH', '/gm/stt', { want: 'on' });

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(width, height, { scheme = 'light', first = CARDS, restore = null, wait = true } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width, height }, serviceWorkers: 'block', colorScheme: scheme });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.addInitScript(() => {          // keep a handle on the panel's controller so the page-made cards can be driven
      let A; Object.defineProperty(window, 'B68GmAssist', { configurable: true, get() { return A; },
        set(v) { A = v && v.create ? Object.assign({}, v, { create(o) { const ctl = v.create(o); window.__ctl = ctl; return ctl; } }) : v; } });
    });
    tick.reply = first;
    await page.route('**/api/gm/assist/tick', (route) => { tick.n++; const cards = tick.reply; tick.reply = []; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...empty(), cards }) }); });
    await page.route('**/api/gm/assist/ask', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answer: { ...ASK, at: new Date().toISOString() }, spend: SPEND }) }));
    await page.route('**/api/gm/assist/cards', (route) => {
      if (route.request().method() === 'POST') { marks.push(JSON.parse(route.request().postData() || '{}')); return route.fulfill({ status: 200, contentType: 'application/json', body: '{"marked":1}' }); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(restore || { cards: [], updates: [], asks: [] }) });
    });
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
    if (wait) await page.waitForFunction(() => { const n = document.querySelector('#as-count'); return n && !n.hidden; }, null, { timeout: 20000 });
    return { c, page };
  }
  const shot = async (page, name) => page.screenshot({ path: path.join(SHOT_DIR, 'p3-' + name + '.png') });
  const rectOf = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; });
  const txt = (page, sel) => page.$$eval(sel, (l) => l.map((x) => x.textContent.trim().replace(/\s+/g, ' ')));
  const openPanel = async (p) => { await p.keyboard.press('a'); await p.waitForFunction(() => document.querySelector('#as-panel').getBoundingClientRect().left < innerWidth - 100, null, { timeout: 4000 }); };
  const feedIds = (p) => p.$$eval('#as-list .as-card', (l) => l.map((x) => x.getAttribute('data-id')));

  // ============ the folded feed, the filters, fold / unfold / More, the Now card, in light ============
  {
    const { c, page: p } = await open(1440, 900);
    await p.waitForTimeout(300);
    check(await p.$eval('#as-count', (n) => n.textContent) === '4', 'closed: the tab counts four unread cards');
    await openPanel(p);
    // Now: the newest unread card, unfolded, one type step larger
    check((await txt(p, '#as-now .as-text'))[0] === 'Newest slip: the cost was not named', 'Now shows the newest unread card by its headline, not its text');
    const nowSize = await p.$eval('#as-now .as-text', (e) => parseFloat(getComputedStyle(e).fontSize)), feedOpenSize = 17;
    check(nowSize === 19, 'Now is one type step above the 17 px unfolded headline (' + nowSize + ' px)');
    check(await p.$eval('#as-now .as-card', (e) => e.getAttribute('data-open')) === '1', 'Now is unfolded');
    check(await p.$$eval('#as-now .as-bullets li', (l) => l.length) === 1 && (await txt(p, '#as-now .as-cite'))[0] === 'p.14' && (await txt(p, '#as-now .as-check'))[0] === 'Cost', 'Now shows its bullet, the cite chip (a string) and the check chip');
    await shot(p, 'now-light');
    // after 1.5 s in view it leaves Now, is marked seen, and the count goes
    check(await p.waitForFunction(() => /^Quiet/.test(document.querySelector('#as-now').textContent.trim()), null, { timeout: 4000 }).then(() => true, () => false), 'after 1.5 s in view the card leaves Now');
    check(await p.$eval('#as-count', (n) => n.hidden), 'and the count goes');
    await p.waitForTimeout(200);
    check(marks.some((m) => m.op === 'seen' && m.items.some((i) => i.text === 'Invented newest slip.')), 'the server heard: seen');
    // the feed: newest first, folded, one line (44 px), with the Earlier divider after 30 minutes
    const ids = await feedIds(p);
    check(ids.length === 4 && /Invented newest slip/.test(ids[0]) && /clerk/.test(ids[3]), 'the feed is newest first');
    check(JSON.stringify(await p.$$eval('#as-list .as-card', (l) => l.map((x) => x.getAttribute('data-open')))) === '["0","0","0","0"]', 'every card in the feed is folded');
    const h0 = await rectOf(p, '#as-list .as-card:first-child .as-fold');
    check(h0.h >= 44 && h0.h < 60, 'a folded card is one touch-sized line (' + Math.round(h0.h) + ' px)');
    check(await p.$eval('#as-list .as-card:first-child .as-text', (e) => getComputedStyle(e).whiteSpace === 'nowrap' && getComputedStyle(e).textOverflow === 'ellipsis'), 'the folded headline is cut with an ellipsis');
    check((await p.$$eval('#as-list .as-earlier', (l) => l.map((x) => x.textContent))).join() === 'Earlier tonight' && (await p.$$eval('#as-list > *', (l) => l.map((x) => x.className.split(' ')[0]))).join() === 'as-card,as-card,as-card,as-earlier,as-card', 'one "Earlier tonight" divider, before the 50-minute-old card');
    check((await p.$$eval('#as-list .as-kind', (l) => l.map((x) => x.textContent))).join() === '⚙Rule,✦Idea,⚙Rule,·Note', 'folded: glyph and word per kind');
    const bar = await p.$eval('#as-list .as-card:first-child', (e) => getComputedStyle(e).borderLeftWidth);
    check(bar === '8px', 'the colour bar is 8 px');
    // fold / unfold / More on the rule card with the 400-word More
    const sel = '#as-list .as-card[data-kind="rule"][data-id*="Invented slip text"]';
    await p.click(sel + ' .as-fold');
    check(await p.$eval(sel, (e) => e.getAttribute('data-open')) === '1' && await p.$eval(sel + ' .as-fold', (e) => e.getAttribute('aria-expanded')) === 'true', 'tap a folded card: it unfolds');
    check((await p.$eval(sel + ' .as-text', (e) => parseFloat(getComputedStyle(e).fontSize))) === 17, 'unfolded, the headline is 17 px');
    check(await p.$$eval(sel + ' .as-bullets li', (l) => l.length) === 2 && (await txt(p, sel + ' .as-say'))[0] === 'SAYOffer the roll: will you resist it?' && (await txt(p, sel + ' .as-secret'))[0] === 'GM ONLYThe cook is the inside man.', 'unfolded: bullets, SAY and GM ONLY');
    check(await p.$eval(sel + ' .as-say strong', (e) => e.textContent) === 'resist', 'bold is a real <strong>, from **resist**');
    check(await p.$eval(sel + ' .as-secret', (e) => getComputedStyle(e).borderTopStyle) === 'dashed', 'GM ONLY has a dashed border');
    check(JSON.stringify(await txt(p, sel + ' .as-acts button')) === JSON.stringify(['More ▾', '☆ Keep', 'Got it ×']), 'actions: More, Keep, Got it (no Undo on a rule card)');
    check(await p.$$eval(sel + ' .as-detail', (l) => l.length) === 0, 'More is closed until asked for');
    await p.click(sel + ' [data-as="more"]');
    const mr = await p.evaluate((s) => { const d = document.querySelector(s + ' .as-detail'), pn = document.querySelector('#as-panel').getBoundingClientRect(), r = d.getBoundingClientRect(); return { h: r.height, ph: pn.height, sh: d.scrollHeight, ch: d.clientHeight, oy: getComputedStyle(d).overflowY, li: d.querySelectorAll('li').length, h2: d.querySelectorAll('h1,h2,h3').length, strongs: d.querySelectorAll('strong').length, html: d.innerHTML.length }; }, sel);
    check(mr.li >= 2 && mr.h2 === 0 && mr.strongs >= 1, 'More went through B68Markdown.render: its list is <li>s (' + mr.li + '), its heading was stripped to bold');
    check(mr.h <= mr.ph * 0.4 + 1 && mr.sh > mr.ch && mr.oy === 'auto', 'More is at most 40% of the panel (' + Math.round(mr.h) + ' of ' + Math.round(mr.ph) + ') and scrolls inside the card (' + mr.sh + ' > ' + mr.ch + ')');
    const cr = await rectOf(p, sel), pr = await rectOf(p, '#as-panel');
    check(cr.h <= pr.h && cr.r <= pr.r + 1 && cr.l >= pr.l - 1, 'the card is no taller or wider than the panel (' + Math.round(cr.h) + ' of ' + Math.round(pr.h) + ')');
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.scrollWidth <= innerWidth), 'no horizontal page scroll from the long unbroken word');
    check(await p.$eval(sel, (e) => e.scrollWidth <= e.clientWidth + 1), 'and the long word wraps inside the card');
    await shot(p, 'unfolded-more-light');
    await p.click(sel + ' [data-as="more"]');
    check(await p.$$eval(sel + ' .as-detail', (l) => l.length) === 0, 'More folds away again');
    await p.click(sel + ' .as-fold');
    check(await p.$eval(sel, (e) => e.getAttribute('data-open')) === '0', 'tap again: it folds');

    // the filters, with counts
    check(JSON.stringify(await txt(p, '#as-chips .as-chip')) === JSON.stringify(['All 4', 'Rule 2', 'Say 0', 'Idea 1', 'Done 0', 'Note 1']), 'chips carry counts');
    await p.click('#as-chips [data-k="rule"]');
    check(JSON.stringify(await p.$$eval('#as-list .as-card', (l) => l.map((x) => x.getAttribute('data-kind')))) === '["rule","rule"]' && await p.$eval('#as-chips [data-k="rule"]', (e) => e.getAttribute('aria-pressed')) === 'true', 'Rule shows the two rule cards, pressed');
    await p.click('#as-chips [data-k="say"]');
    check((await txt(p, '#as-list .as-empty'))[0] === 'No say cards tonight.', 'an empty filter says so');
    await p.click('#as-chips [data-k="idea"]');
    check(JSON.stringify(await p.$$eval('#as-list .as-card', (l) => l.map((x) => x.getAttribute('data-kind')))) === '["idea"]', 'Idea shows one');
    await p.click('#as-chips [data-k="all"]');
    check((await feedIds(p)).length === 4, 'All shows all four');
    await shot(p, 'feed-light');

    // keyed rendering: a tagged node survives a tick that adds a card
    const builds0 = await p.evaluate(() => window.__ctl.state().renders.cards);
    await p.evaluate(() => { document.querySelectorAll('#as-list .as-card').forEach((n, i) => { n.__tag = 'n' + i; }); });
    tick.reply = [{ seat: 'ledger', kind: 'note', at: new Date().toISOString(), text: 'Invented later note.', headline: 'A later note', bullets: [] }];
    await p.evaluate(() => window.__ctl.poll());
    await p.waitForFunction(() => document.querySelectorAll('#as-list .as-card').length === 5, null, { timeout: 4000 });
    const tags = await p.$$eval('#as-list .as-card', (l) => l.map((x) => x.__tag || null));
    check(JSON.stringify(tags) === JSON.stringify([null, 'n0', 'n1', 'n2', 'n3']), 'a new card adds one node; every other card is the same DOM node as before (' + JSON.stringify(tags) + ')');
    const builds1 = await p.evaluate(() => window.__ctl.state().renders.cards);
    check(builds1 - builds0 >= 1 && builds1 - builds0 <= 2, 'one new card is one build in the feed (and one in Now), not a redraw of the list (' + (builds1 - builds0) + ')');
    check(await p.evaluate(() => window.__ctl.state().renders.more) <= 2, 'Markdown rendered once per card that opened More (' + await p.evaluate(() => window.__ctl.state().renders.more) + ')');

    // Ask: the answer lands as a card, open, inside the panel
    await p.click('#as-ask-q'); await p.keyboard.type('pitch two complications'); await p.keyboard.press('Enter');
    check(await p.waitForFunction(() => document.querySelector('#as-list .as-card[data-id^="a|"]'), null, { timeout: 6000 }).then(() => true, () => false), 'the Ask answer lands in the feed as a card');
    await p.evaluate(() => document.activeElement && document.activeElement.blur());
    const ac = '#as-list .as-card[data-id^="a|"]';
    check(await p.$eval(ac, (e) => e.getAttribute('data-open')) === '1' && await p.$$eval(ac + ' .as-bullets li', (l) => l.length) === 5, 'it lands open, with five bullets of the six');
    const acr = await rectOf(p, ac), pr2 = await rectOf(p, '#as-panel'), fe = await rectOf(p, '#as-feed');
    check(acr.h <= pr2.h && acr.r <= pr2.r + 1 && acr.l >= pr2.l - 1, 'a 400-word answer stays inside the panel: the card is ' + Math.round(acr.h) + ' px of ' + Math.round(pr2.h));
    check(await p.$eval(ac + ' .as-more', (e) => e.scrollHeight > e.clientHeight && getComputedStyle(e).overflowY === 'auto'), 'and its body scrolls inside the card');
    check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal page scroll');
    check(await p.$eval(ac + ' .as-say', (e) => e.textContent.length > 1000), 'the 400 words are in SAY');
    await p.click(ac + ' [data-as="more"]');
    const ar = await p.evaluate((s) => { const d = document.querySelector(s + ' .as-detail'), pn = document.querySelector('#as-panel').getBoundingClientRect(), r = d.getBoundingClientRect(), cr = document.querySelector(s).getBoundingClientRect(); return { within: r.top >= pn.top - 1 || true, dh: r.height, ph: pn.height, ch: cr.height, sh: d.scrollHeight, cl: d.clientHeight }; }, ac);
    check(ar.dh <= ar.ph * 0.4 + 1 && ar.sh > ar.cl && ar.ch <= ar.ph, 'More on the long answer: at most 40% of the panel, scrolling inside a card that is not taller than the panel');
    await shot(p, 'ask-answer-light');
    await c.close();
  }

  // ============ safety: model text is text ============
  {
    const { c, page: p } = await open(1440, 900, { first: [{ seat: 'ref', kind: 'rule', at: new Date().toISOString(), text: 'x', headline: XSS, bullets: [XSS], say: XSS, secret: XSS, cite: XSS, more: XSS + '\n\n<script>window.__pwn=2</script>' }] });
    await openPanel(p);
    await p.click('#as-list .as-fold');
    await p.click('#as-list [data-as="more"]');
    await p.waitForTimeout(300);
    check(await p.evaluate(() => window.__pwn === undefined), 'a headline <img onerror> never runs');
    check(await p.$$eval('.gm-assist img[src="x"]', (l) => l.length) === 0, 'and there is no <img src="x"> anywhere in the panel');
    check((await txt(p, '#as-list .as-text'))[0] === XSS, 'the headline is the literal text, tag and all');
    check((await txt(p, '#as-list .as-secret'))[0] === 'GM ONLY' + XSS, 'GM ONLY too');
    check(await p.$$eval('#as-list .as-detail script, #as-list .as-detail img', (l) => l.length) === 0, 'and More (rendered by B68Markdown) has no live script or img');
    await c.close();
  }

  // ============ the closed panel: a rule slides a strip out for 8 s; everything else is a pip ============
  {
    const { c, page: p } = await open(1440, 900, { first: [], wait: false });
    await p.waitForTimeout(500);
    const strip = () => p.evaluate(() => { const b = document.querySelector('#as-banner'); return b && !b.hidden ? document.querySelector('.as-banner-b').textContent : null; });
    const pips = () => p.$$eval('#as-pips .as-pip', (l) => l.length);
    await p.evaluate(() => { window.__ctl.addCard({ kind: 'idea', headline: 'An idea, pip only', bullets: ['x'] }); window.__ctl.addCard({ kind: 'say', headline: 'A say line, pip only' }); window.__ctl.addCard({ kind: 'note', headline: 'A note, pip only' }); window.__ctl.addCard({ kind: 'done', headline: 'A done, pip only', undo: () => { window.__undone = (window.__undone || 0) + 1; } }); });
    await p.waitForTimeout(200);
    check(await strip() === null && await pips() === 4, 'idea, say, note and done add a pip each and pop no strip');
    tick.reply = [{ seat: 'ref', kind: 'rule', at: new Date().toISOString(), text: 'Invented rule text', headline: 'A rule: the strip slides out', bullets: ['BULLET-TEXT'], secret: 'SECRET-TEXT', say: 'SAY-TEXT' }];
    await p.evaluate(() => window.__ctl.poll());
    await p.waitForFunction(() => { const b = document.querySelector('#as-banner'); return b && !b.hidden; }, null, { timeout: 4000 });
    const t = await strip();
    check(/Rule/.test(t) && /A rule: the strip slides out/.test(t) && !/BULLET|SECRET|SAY-TEXT/.test(t), 'a rule card pops a one-line strip with the kind and the headline ("' + t + '")');
    check(await p.$eval('.as-banner-b', (b) => b.getBoundingClientRect().height < 60), 'the strip is one line');
    check(await pips() === 5, 'and it is a pip too');
    await shot(p, 'strip-closed');
    await p.waitForTimeout(8300);
    check(await strip() === null, 'the strip goes after 8 s');
    await p.evaluate(() => window.__ctl.addCard({ kind: 'warn', headline: 'Spend at 85%: Voice is off', secret: 'WARN-SECRET', bullets: ['WARN-BULLET'] }));
    await p.waitForTimeout(200);
    const w = await strip();
    check(/Stop/.test(w) && /Voice is off/.test(w) && !/WARN-/.test(w), 'a warn card pops it too, without its secret or bullets');
    check(await p.$eval('#as-banner', (b) => !b.hidden), 'the strip is visible');
    await p.waitForTimeout(8300);
    // Undo: U inside the panel
    await openPanel(p);
    await p.click('#as-list .as-card[data-kind="done"] .as-fold');
    check(JSON.stringify(await txt(p, '#as-list .as-card[data-kind="done"] .as-acts button')) === JSON.stringify(['☆ Keep', 'Undo', 'Got it ×']) || JSON.stringify(await txt(p, '#as-list .as-card[data-kind="done"] .as-acts button')) === JSON.stringify(['Undo', 'Got it ×']), 'a done card has Undo');
    await p.focus('#as-list .as-card[data-kind="done"] .as-fold'); await p.keyboard.press('u');
    check(await p.waitForFunction(() => window.__undone === 1 && /Undone/.test(document.querySelector('#as-list .as-card[data-kind="done"]').textContent), null, { timeout: 3000 }).then(() => true, () => false), 'U undoes the newest done card; it says Undone');
    check(await p.evaluate(() => { const id = window.__ctl.addCard({ kind: 'idea', headline: 'before', bullets: [] }); const ok = window.__ctl.updateCard(id, { headline: 'after the patch', bullets: ['b'] }); return ok && !!Array.from(document.querySelectorAll('#as-list .as-text')).find((e) => e.textContent === 'after the patch'); }), 'updateCard changes a page-made card on screen');
    check(!marks.some((m) => m.items.some((i) => /pip only|before|after the patch/.test(i.text))), 'no mark went to the server for a card made on the page');
    await c.close();
  }

  // ============ a reload restores the layout, with the server\'s marks ============
  {
    const stamp = (n) => new Date(Date.now() - n * 60000).toISOString();
    restored = { cards: [
      { seat: 'ref', kind: 'rule', at: stamp(4), text: 'Restored slip text', headline: 'Restored slip headline', bullets: ['A bullet'], cite: 'p.9', check: 'harm', seen: true, kept: true },
      { seat: 'mystery', kind: 'idea', at: stamp(3), text: 'Restored idea text', headline: 'Restored idea headline', bullets: [], seen: false },
      { seat: 'clerk', at: stamp(45), text: 'An old row from before the glance fields. '.repeat(6), headline: 'An old row from before the glance fields. An old row from before the glance fields. An old row from…', bullets: [], detail: { said_at: '21:00', rule: 'Rulebook p. 3' }, seen: true },
      { seat: 'clerk', at: stamp(2), text: 'Dismissed text', headline: 'Dismissed', dismissed: true }],
      updates: [], asks: [{ at: stamp(1), q: 'a restored question', kind: 'rule', headline: 'Restored answer headline', bullets: ['x'], text: 'Restored answer flat text', kept: false }] };
    const { c, page: p } = await open(1440, 900, { first: [], restore: restored });
    await p.waitForTimeout(500);
    check(await p.$eval('#as-count', (n) => n.textContent) === '1', 'after a reload the count is the server\'s unread (' + await p.$eval('#as-count', (n) => n.textContent) + ')');
    check(await p.$eval('#as-banner', (b) => b.hidden) !== false || (await p.$eval('.as-banner-b', (b) => b.textContent)) === '', 'a restored card pops no strip');
    await openPanel(p);
    const ids = await feedIds(p);
    check(ids.length === 4 && !ids.some((i) => /Dismissed/.test(i)), 'the dismissed card does not come back; the ask answer does (' + ids.length + ' cards)');
    check((await txt(p, '#as-list .as-text'))[0] === 'Restored answer headline' && (await txt(p, '#as-list .as-text'))[1] === 'Restored idea headline', 'newest first, by headline, in the new layout');
    check(await p.$eval('#as-list .as-card[data-id^="a|"]', (e) => e.getAttribute('data-kind')) === 'rule', 'the answer wears the kind it came with');
    check((await txt(p, '#as-now .as-text'))[0] === 'Restored idea headline', 'the one unread card is Now');
    check(JSON.stringify(await txt(p, '#as-chips .as-chip')) === JSON.stringify(['All 4', 'Rule 2', 'Say 0', 'Idea 1', 'Done 0', 'Note 1']), 'chip counts after a reload');
    await p.click('#as-list .as-card[data-kind="rule"][data-id*="Restored slip"] .as-fold');
    check((await txt(p, '#as-list .as-card[data-kind="rule"][data-id*="Restored slip"] .as-kept'))[0] === '★ Kept', 'the server\'s kept mark shows (★ Kept)');
    check((await txt(p, '#as-list .as-card[data-id*="old row"] .as-bullets li, #as-list .as-card[data-id*="An old row"] .as-bullets li')).join('|') === 'Said at 21:00|Rulebook p. 3', 'an old row is rebuilt from its detail');
    check(await p.waitForFunction(() => document.querySelector('#as-count').hidden, null, { timeout: 4000 }).then(() => true, () => false), 'and the unread card is read after 1.5 s in Now');
    await shot(p, 'reload-light');
    await c.close();
  }

  // ============ dark, and contrast of every kind\'s bar ============
  for (const scheme of ['light', 'dark']) {
    const { c, page: p } = await open(1440, 900, { scheme, first: [CARDS[1], CARDS[2], CARDS[0], { seat: 'fixer', kind: 'say', at: new Date().toISOString(), text: 's', headline: 'A line to read aloud', say: 'Read this.' }] });
    await openPanel(p);
    await p.waitForTimeout(1800);
    await p.click('#as-list .as-card[data-kind="rule"] .as-fold');
    const bg = await p.$eval('#as-panel', (e) => getComputedStyle(e).backgroundColor);
    const ratios = await p.evaluate(async () => {
      const kinds = ['rule', 'say', 'idea', 'done', 'warn', 'note'];
      const lum = (rgb) => { const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
      const out = {};
      for (const k of kinds) {
        const host = document.querySelector('.gm-assist'), probe = document.createElement('div'); probe.className = 'as-card'; probe.setAttribute('data-kind', k);
        probe.innerHTML = '<span class="as-kind"><b>x</b></span>'; host.appendChild(probe);
        const el = probe.querySelector('.as-kind'), cs = getComputedStyle(el); out[k] = ratio(cs.backgroundColor, cs.color); probe.remove();
      }
      const t = document.querySelector('#as-list .as-text'), card = document.querySelector('#as-list .as-card');
      out.text = ratio(getComputedStyle(t).color, getComputedStyle(card).backgroundColor);
      const say = document.querySelector('#as-list .as-say'); if (say) out.say = ratio(getComputedStyle(say).color, getComputedStyle(say).backgroundColor);
      const sec = document.querySelector('#as-list .as-secret'); if (sec) out.secret = ratio(getComputedStyle(sec).color, getComputedStyle(sec).backgroundColor);
      return out;
    });
    const low = Object.entries(ratios).filter(([k, v]) => v < 4.5);
    check(low.length === 0, scheme + ': every kind chip, the headline, SAY and GM ONLY meet 4.5:1 (' + Object.entries(ratios).map(([k, v]) => k + ' ' + v.toFixed(1)).join(', ') + ')');
    await shot(p, 'open-' + scheme);
    if (scheme === 'dark') check(bg !== 'rgba(0, 0, 0, 0)' && /^rgb\(\d{1,2}, \d{1,2}, \d{1,2}\)$/.test(bg), 'dark: the panel is dark (' + bg + ')');
    await c.close();
  }

  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
