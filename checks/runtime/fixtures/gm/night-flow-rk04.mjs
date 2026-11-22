// RK04 (night.flow): Blade's cards act on what they suggest. The browser half of the check, run by checks/runtime/night-flow.e2e.mjs on the demo night
// (the invented Pelican Rooms, the Dovetail Crew, a hidden "House alarm" clock at 2 of 6 and a visible "Win back the marker"). The Ask endpoint is answered by
// the browser's own route with an invented answer: no key, no model, no spend.
//   off      "tick the house alarm 1" typed bare is a question: the Ask call goes out and no clock moves; an answer's ▶ lines are plain text, no chip
//   typed    on: it ticks the alarm clock with no Ask call and Undo; "make a 6 clock called ..." adds a hidden clock, Undo takes it off; a question still asks
//   chips    on: an Ask card's ▶ lines (its bullets and its More) are chips; ▶ clock: makes the clock with one tap (hidden, never on the players' side), then offers
//            Tick +1; ▶ tick: ticks, with Undo; the same on the kit desk (kit.desk on)
//   secrecy  the display's GET and a phone's GET never hold a hidden clock's name; the GM page makes no request outside its own origin
//   shots    RK_SHOTS=<dir>: the Blade panel with chips, 1366x768 and 1536x864, Paper and Night, kit.desk off and on; 1024x768 (the iPad's width)
export async function rk04(c) {
  const { BASE, GM, IPAD, P1, api, check, until, sleep, browser, errors, atPlace, shots, mkdirSync, path } = c;
  const ANSWER = { q: 'a getaway clock', at: new Date().toISOString(), kind: 'idea', headline: 'Start a getaway clock for the quay', text: 'Start a getaway clock for the quay',
    bullets: ['Start it: `▶ clock: Reach the boats / 4 / 0`', 'Then push the alarm: `▶ tick: House alarm / 1`', 'Not a chip: `plain code`'],
    say: '', secret: '', more: 'Two things to tap:\n\n- `▶ clock: Reach the boats / 4 / 0`\n- `▶ tick: House alarm / 1`\n- `▶ tick: Lighthouse / 1` (no clock of that name)\n- `▶ rule: Position and effect`\n' };
  const clocks = async () => ((await api('GET', '/campaign')).json.doc.clocks || []);
  const clockOf = async (name) => (await clocks()).find((k) => k.name === name) || null;
  const setting = async (on, extra) => { await api('PATCH', '/gm/state', { features: { 'night.flow': on, ...(extra || {}) } }); };
  const asks = [];
  const outside = [];

  async function open(w, h, scheme) {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block', colorScheme: scheme || 'light' });
    await ctx.addInitScript(atPlace('score'));
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push('rk04 gm: ' + e.message));
    p.on('request', (r) => { const u = r.url(); if (!/^(?:http:\/\/127\.0\.0\.1|data:|blob:|about:)/.test(u)) outside.push(u); });
    await p.route('**/api/gm/assist/ask', (route) => {
      asks.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ answer: { ...ANSWER, at: new Date().toISOString() }, spend: { tonight: 1, cap: 20, tier: 'all', tick: 0 } }) });
    });
    await p.goto(BASE + '/#gm');
    await p.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000, state: 'attached' });
    await sleep(2000);
    await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await p.keyboard.press('a');
    await p.waitForSelector('#as-panel:not([hidden]) #as-ask-q', { timeout: 10000 });
    return { p, ctx };
  }
  const ask = async (p, text) => { await p.fill('#as-ask-q', text); await p.click('#as-ask-go'); };
  const field = (p) => p.$eval('#as-ask-q', (e) => e.value);
  const undoBtn = (p) => p.locator('.gm-ugtoast button:has-text("Undo"), [data-kit-toast] button:has-text("Undo"), .ui-toast button:has-text("Undo")').first();
  const chips = (p) => p.$$eval('#as-list .pa-chip', (l) => l.map((b) => ({ text: b.textContent.trim(), cls: b.className, title: b.title, muted: b.classList.contains('pa-muted') })));
  const wait = (fn, ms = 8000) => until(fn, ms);

  /* ---------- off ---------- */
  await setting(false);
  let before = await clockOf('House alarm');
  {
    const { p, ctx } = await open(1366, 768);
    check(await p.evaluate(() => !window.B68GmBladeChips), 'off: gm/blade-chips.js is not on the page (the night-flow bundle is not asked for)');
    const n0 = asks.length;
    await ask(p, 'tick the house alarm 1');
    check(!!(await wait(() => asks.length === n0 + 1)), 'off: "tick the house alarm 1" typed bare is a question: the Ask call goes out');
    await sleep(800);
    check((await clockOf('House alarm')).filled === before.filled, 'off: and the alarm clock has not moved (' + before.filled + ')');
    check(!!(await wait(() => p.$('#as-list .as-card'))), 'off: the answer is a card');
    await p.click('#as-list .as-moreb');
    await sleep(300);
    const txt = await p.$eval('#as-list', (e) => e.textContent);
    check((await chips(p)).length === 0 && /▶ clock: Reach the boats/.test(txt) && /`▶ clock: Reach the boats \/ 4 \/ 0`/.test(txt), 'off: the ▶ lines are plain text in the card (the bullets keep their backticks), no chip');
    await ctx.close();
  }

  /* ---------- on ---------- */
  await setting(true);
  {
    const { p, ctx } = await open(1366, 768);
    check(!!(await wait(() => p.evaluate(() => !!window.B68GmBladeChips && !!window.B68GmPrepActions))), 'on: the night-flow bundle loads blade-chips.js (and prep-actions.js with it)');
    before = await clockOf('House alarm');
    const n0 = asks.length;
    await ask(p, 'tick the house alarm 1');
    check(!!(await wait(async () => (await clockOf('House alarm')).filled === before.filled + 1)), 'typed: "tick the house alarm 1" ticks the alarm clock ' + before.filled + ' to ' + (before.filled + 1) + ' of ' + before.size);
    check(asks.length === n0, 'typed: no Ask call went out (no model, $0)');
    check((await field(p)) === '', 'typed: the field is cleared');
    const ub = undoBtn(p);
    check(!!(await wait(() => ub.isVisible())), 'typed: the toast has Undo');
    await ub.click();
    check(!!(await wait(async () => (await clockOf('House alarm')).filled === before.filled)), 'typed: Undo puts it back');
    await sleep(500);

    await ask(p, 'make a 6 clock called Reach the roof');
    const roof = await wait(() => clockOf('Reach the roof'));
    check(!!roof && roof.size === 6 && roof.hidden === true && roof.filled === 0, 'typed: "make a 6 clock called Reach the roof" adds a hidden 6-segment clock (' + JSON.stringify(roof) + ')');
    check(!!(await wait(() => undoBtn(p).isVisible())), 'typed: with Undo');
    await undoBtn(p).click();
    check(!!(await wait(async () => !(await clockOf('Reach the roof')))), 'typed: Undo takes it off the table');

    const n1 = asks.length;
    await ask(p, 'how do I tick the house alarm?');
    check(!!(await wait(() => asks.length === n1 + 1)), 'typed: a question that mentions ticking is still an Ask');
    check((await clockOf('House alarm')).filled === before.filled, 'typed: and moves nothing');

    /* the answer card: chips */
    check(!!(await wait(() => p.$('#as-list .as-card'))), 'chips: the answer is a card');
    if (!(await p.$('#as-list .as-detail'))) await p.click('#as-list .as-moreb');
    await wait(async () => (await chips(p)).length >= 6);
    const cs = await chips(p);
    check(cs.length === 6, 'chips: the ▶ bullets and ▶ More lines are chips (' + cs.map((x) => x.text).join(' | ') + ')');
    check(cs.some((x) => /^.?Clock: Reach the boats \(4\)/.test(x.text)) && cs.some((x) => /^.?Tick: House alarm \d to \d of 6/.test(x.text)), 'chips: a clock chip and a tick chip say what a tap does');
    check(cs.filter((x) => x.muted).length === 1 && /No clock called/.test(cs.find((x) => x.muted).title), 'chips: a tick of a clock that is not there is muted, and says why');
    check(/plain code/.test(await p.$eval('#as-list .as-bullets', (e) => e.textContent)) && (await p.$$eval('#as-list .as-bullets code', (l) => l.length)) === 0, 'chips: a code span that is not an action is left as typed');

    const tapChip = async (re) => { const l = p.locator('#as-list .pa-chip'); const n = await l.count(); for (let i = 0; i < n; i++) { if (re.test(await l.nth(i).textContent())) { await l.nth(i).click(); return true; } } return false; };
    check(await tapChip(/Clock: Reach the boats \(4\)/), 'chips: tap the ▶ clock: chip');
    const boats = await wait(() => clockOf('Reach the boats'));
    check(!!boats && boats.size === 4 && boats.filled === 0 && boats.hidden === true, 'chips: one tap makes the clock, hidden (' + JSON.stringify(boats) + ')');
    check(!!(await wait(async () => (await chips(p)).every((x) => !/Reach the boats \(4\)/.test(x.text)) && (await chips(p)).some((x) => /Reach the boats 0\/4 · Tick \+1/.test(x.text)))), 'chips: both ▶ clock: chips now read "Tick +1"');
    await sleep(400);
    check(await tapChip(/Reach the boats 0\/4 · Tick \+1/), 'chips: tap Tick +1');
    check(!!(await wait(async () => (await clockOf('Reach the boats')).filled === 1)), 'chips: the clock is at 1 of 4');
    await undoBtn(p).click();
    check(!!(await wait(async () => (await clockOf('Reach the boats')).filled === 0)), 'chips: Undo puts it back to 0');
    await sleep(600);
    const a0 = (await clockOf('House alarm')).filled;
    check(await tapChip(/Tick: House alarm/), 'chips: tap the ▶ tick: chip');
    check(!!(await wait(async () => (await clockOf('House alarm')).filled === a0 + 1)), 'chips: ▶ tick: ticks the alarm clock once, capped by its size');
    const m0 = (await chips(p)).find((x) => x.muted);
    check(!!m0, 'chips: the muted chip stays muted');
    /* a rule chip in a card: its pop-over opens on the body (the panel is outside #gm-page), is styled, stays on screen and shuts with Esc */
    check(await tapChip(/Position and effect/), 'chips: tap the ▶ rule: chip');
    const pop = await wait(() => p.evaluate(() => { const e = document.querySelector('.pa-pop'); if (!e) return null; const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.height > 0 ? { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight, border: s.borderTopWidth, pos: s.position, text: e.textContent.slice(0, 60) } : null; }));
    check(!!pop && pop.pos === 'fixed' && pop.border === '2px' && pop.l >= 0 && pop.t >= 0 && pop.r <= pop.w && pop.b <= pop.h, 'chips: the rule\'s pop-over is styled and inside the screen (' + JSON.stringify(pop) + ')');
    await p.keyboard.press('Escape');
    check(!!(await wait(() => p.evaluate(() => !document.querySelector('.pa-pop')))), 'chips: Esc closes it');
    await shots(p, 'rk04-desk-off-paper');

    /* secrecy */
    const dg = await api('GET', '/gm/display', undefined, IPAD);
    const pc = await api('GET', '/campaign', undefined, P1);
    const seen = (t) => ['Reach the boats', 'Reach the roof', 'House alarm'].filter((n) => t.includes(n));
    const phoneClocks = ((pc.json && (pc.json.doc || pc.json).clocks) || []).filter((k) => ['Reach the boats', 'Reach the roof', 'House alarm'].includes(k.name));
    check(seen(dg.text).length === 0, 'secrecy: the display GET never holds a hidden clock\'s name (' + seen(dg.text) + ')');
    check(phoneClocks.length > 0 && phoneClocks.every((k) => k.hidden === true), 'secrecy: the table document a phone reads marks every clock Blade made or ticked as hidden, as every hidden table clock is (' + phoneClocks.map((k) => k.name).join() + ')');
    check(outside.length === 0, 'the GM page made no request outside its own origin (' + outside.length + ')');
    await ctx.close();
  }

  /* ---------- the kit desk ---------- */
  await setting(true, { 'kit.desk': true });
  {
    const { p, ctx } = await open(1366, 768);
    await ask(p, 'a getaway clock');
    check(!!(await wait(() => p.$('#as-list .kbl-card'))), 'kit desk: the answer is a kit card');
    if (!(await p.$('#as-list .kbl-detail'))) await p.click('#as-list .as-moreb');
    await wait(async () => (await chips(p)).length >= 6);
    check((await chips(p)).length === 6, 'kit desk: the same six chips on the kit card');
    const a0 = (await clockOf('House alarm')).filled;
    await ask(p, 'tick the house alarm 1');
    check(!!(await wait(async () => (await clockOf('House alarm')).filled === a0 + 1)), 'kit desk: "tick the house alarm 1" typed bare ticks it');
    await sleep(500);
    await shots(p, 'rk04-desk-on-paper');
    await ctx.close();
  }

  /* ---------- the screenshots to look at (RK_SHOTS): the panel with an answer's chips open and a typed tick's toast, both desks, Paper and Night ---------- */
  if (c.SHOTS) {
    for (const desk of [false, true]) {
      await setting(true, { 'kit.desk': desk });
      for (const scheme of ['light', 'dark']) {
        for (const [w, h] of [[1366, 768], [1536, 864], [1024, 768]]) {
          /* each shot starts from the demo night's table: the alarm at 2 of 6, no getaway clock yet */
          const boats = await clockOf('Reach the boats');
          await api('PATCH', '/campaign', { clockOps: [{ id: 'c-alarm', filled: 2 }, ...(boats ? [{ remove: boats.id }] : [])] });
          const { p, ctx } = await open(w, h, scheme);
          await ask(p, 'a getaway clock');
          await wait(() => p.$('#as-list .as-card'));
          if (!(await p.$('#as-list .as-detail'))) await p.click('#as-list .as-moreb');
          await wait(async () => (await chips(p)).length >= 6);
          await sleep(300);
          const tag = 'rk04-desk-' + (desk ? 'on' : 'off') + '-' + (scheme === 'dark' ? 'night' : 'paper') + '-' + w + 'x' + h;
          await shots(p, tag + '-chips');
          const box = await p.$eval('#as-list .pa-chip', (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { h: Math.round(r.height), fs: cs.fontSize }; });
          check(parseFloat(box.fs) >= 12, tag + ': a chip is 12 px or more (' + box.fs + ', ' + box.h + ' px tall)');
          await ask(p, 'tick the house alarm 1');
          await sleep(500);
          await shots(p, tag + '-ticked');
          await ctx.close();
        }
      }
    }
  }
  return true;
}
