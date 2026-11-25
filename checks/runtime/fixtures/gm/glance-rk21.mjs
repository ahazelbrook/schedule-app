// RK21 (gm.glance): the fiction's clock and who's where. The browser half of the check, run by checks/runtime/glance.e2e.mjs on the demo night (the invented
// Pelican Rooms, night started at 21:45; the Dovetail Crew: Nell Arbuthnot in the Cocktail lounge, Ray Okonjo and Tam Petrakis in the Showroom; Mabel Quist
// in the Showroom till 23:30). No model, no key, $0.
//   off      no block under the Run header, and the gm-glance bundle is not on the page; a stored ball.fic changes nothing (the published time stays)
//   on       the block answers the four questions: the fiction's time, who is where now, who is where next, where the crew is
//            +5 and +15 move the fiction (ball.fic = { b, off }, numbers only); a typed time sets it; Clear drops it; a beat step catches it up
//            the Now line follows the fiction's time; a marker moved (the ball's crew) shows in the Crew line; typing a time never fires a page key
//   kit      the same block on the kit desk, its buttons B68Ui parts
//   secrecy  the display's GET and a phone's GET hold none of it, and a +5 publishes nothing to the players (the mission's hseq stays)
//   shots    RK_SHOTS=<dir>: 1366x768 and 1536x864, Paper and Night, kit.desk off and on; and 1024x768
// Every part sets the settings and the ball it uses at its start, and leaves gm.glance off at its end.
const SITE = 'The Pelican Rooms';
const CREW = { 'pc-nell': 'Cocktail lounge', 'pc-ray': 'Showroom', 'pc-tam': 'Showroom' };
async function resetState(c, on, extra) {
  const { api, sleep } = c;
  await api('PATCH', '/gm/state', { features: { 'gm.glance': on, ...(extra || {}) } });
  const crew = {}; for (const [id, room] of Object.entries(CREW)) crew[id] = { room, disguise: 'guest', moved: null, noticed: null };
  await api('PATCH', '/gm/state', { ball: { site: SITE, v: 2, start: 45, t: 45, crew, view: null, fic: null, timer: null } });
  await sleep(300);
}
export const reset = (c) => resetState(c, false, { 'kit.desk': null });
export async function rk21(c) {
  const { BASE, GM, IPAD, P1, api, check, until, sleep, browser, errors, atPlace, shots } = c;
  const gmDoc = async () => (await api('GET', '/gm/state')).json.doc;
  const ficOf = async () => ((await gmDoc()).ball || {}).fic;
  const reset = (on, extra) => resetState(c, on, extra);

  async function open(w, h, scheme) {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w || 1366, height: h || 768 }, serviceWorkers: 'block', colorScheme: scheme || 'light' });
    await ctx.addInitScript(atPlace('score'));
    await ctx.addInitScript(() => { window.__B68_POLL_MS = 700; });
    if (scheme) await ctx.addInitScript((t) => { try { localStorage.setItem('b68.theme', t); } catch (e) { /* no storage */ } }, scheme === 'dark' ? 'dark' : 'light');
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push('rk21 gm: ' + e.message));
    p.on('dialog', (d) => d.accept());
    await p.goto(BASE + '/#gm');
    await p.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000, state: 'attached' });
    await sleep(1500);
    await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await p.keyboard.press('b');
    await p.keyboard.press('g');
    await p.waitForSelector('.rv-head', { timeout: 20000 });
    return { p, ctx };
  }
  /* the block's text, a line at a time (textContent: the labels' CSS capitals are not in it) */
  const block = (p) => p.evaluate(() => { const b = document.querySelector('#gm-runv .gl-now'); return b ? Array.from(b.querySelectorAll('.gl-now-row, .gl-now-line')).map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' ') : null; });
  const fiction = (p) => p.evaluate(() => { const o = document.querySelector('#gm-runv .gl-now-t'); return o ? o.textContent : null; });
  const waitFiction = (p, want) => until(async () => (await fiction(p)) === want, 8000, 150);
  const lineOf = (txt, k) => { const m = new RegExp(k + ' (.*?)(?= (?:Crew|Now) |$)').exec(txt || ''); return m ? m[1] : ''; };

  try {
    /* ---------- off: today's header, even with a fiction offset stored ---------- */
    await reset(false);
    await api('PATCH', '/gm/state', { ball: { fic: { b: 45, off: 7 } } });
    {
      const { p, ctx } = await open();
      await sleep(1200);
      check(await p.evaluate(() => !window.B68GmGlanceNow), 'off: gm/glance-now.js is not on the page (the gm-glance bundle is not asked for)');
      check((await p.$$('#gm-runv .gl-now')).length === 0, 'off: no block under the Run header');
      check((await p.$eval('#rv-time', (e) => e.textContent)) === '21:45', 'off: the published time is the beat’s (21:45), a stored ball.fic changes nothing');
      await ctx.close();
    }

    /* ---------- on: the four questions, and the clock's controls ---------- */
    await reset(true);
    {
      const { p, ctx } = await open();
      check(!!(await until(() => p.evaluate(() => !!window.B68GmGlanceNow && !window.B68GmGlanceNow.stub), 10000)), 'on: the gm-glance bundle loads glance-now.js');
      const t0 = await until(() => block(p), 10000);
      check(!!t0, 'on: the block is under the Run header (' + t0 + ')');
      check(await p.evaluate(() => { const h = document.querySelector('#gm-runv .rv-head'), b = document.querySelector('#gm-runv .gl-now'); return !!(h && b && h.compareDocumentPosition(b) & 4); }), 'on: after the header line');
      check((await fiction(p)) === '21:45', 'what time is it in the fiction: 21:45, the night’s start (the engagement result’s time)');
      const crew = lineOf(t0, 'Crew');
      check(/Nell Arbuthnot Cocktail lounge/.test(crew) && /Ray Okonjo Showroom/.test(crew) && /Tam Petrakis Showroom/.test(crew), 'where the crew is: ' + crew);
      const now = lineOf(t0, 'Now');
      check(/Mabel Quist Showroom till 23:30, then Private card rooms/.test(now), 'who is where now, and next: ' + now.slice(0, 160));
      check(/^Mabel Quist/.test(now), 'the target comes first');
      check(!/GM-ONLY-STOP|GM-ONLY-NOTE/.test(t0), 'a stop’s note is never drawn');

      await p.click('#gm-runv [data-site="gln-add"][data-min="5"]');
      check(!!(await waitFiction(p, '21:50')), '+5: the fiction reads 21:50');
      check(!!(await until(async () => { const f = await ficOf(); return f && f.b === 45 && f.off === 5; }, 6000)), '+5: stored as ball.fic = { b: 45, off: 5 }: ' + JSON.stringify(await ficOf()));
      await p.click('#gm-runv [data-site="gln-add"][data-min="15"]');
      check(!!(await waitFiction(p, '22:05')), '+15: the fiction reads 22:05');
      check((await p.$eval('#rv-time', (e) => e.textContent)) === '21:45', 'the published time stays 21:45 (the players’ time is not the fiction’s)');
      const t1 = await block(p);
      check(/Dov Kessler Showroom till 23:00, then Security control room/.test(lineOf(t1, 'Now')), 'the Now line follows the fiction’s time: ' + lineOf(t1, 'Now').slice(0, 200));
      check(/20 min ahead/.test(t1) &&(await p.$$('#gm-runv [data-site="gln-clear"]')).length === 1, 'the block says how far it is ahead, and offers Clear');

      /* a typed time; the keys typed into the box never reach the page's shortcuts */
      await p.fill('#gm-runv .gl-now-in', '');
      await p.click('#gm-runv .gl-now-in');
      await p.keyboard.type('23:31');
      await p.keyboard.press('Enter');
      check(!!(await waitFiction(p, '23:31')), 'a typed 23:31 sets the fiction');
      check(!!(await p.$('#gm-runv .rv-head')), 'typing the time fired no page key (the Run view is still up)');
      check(!!(await until(async () => { const f = await ficOf(); return f && f.b === 45 && f.off === 106; }, 6000)), 'stored as an offset: ' + JSON.stringify(await ficOf()));
      check(/Mabel Quist Private card rooms till 00:15, then Luxury penthouse/.test(lineOf(await block(p), 'Now')), 'at 23:31 Mabel Quist is in the Private card rooms till 00:15');
      await p.fill('#gm-runv .gl-now-in', '7pm');
      await p.click('#gm-runv .gl-now-form [type="submit"]');
      await sleep(500);
      check((await fiction(p)) === '23:31', 'a time that is not HH:MM changes nothing');

      await p.click('#gm-runv [data-site="gln-clear"]');
      check(!!(await waitFiction(p, '21:45')), 'Clear: back to the beat’s time');
      check(!!(await until(async () => (await ficOf()) == null, 6000)), 'Clear: ball.fic is gone');

      /* the beats: +5, then a step forward, and the fiction is the new beat's time */
      await p.click('#gm-runv [data-site="gln-add"][data-min="5"]');
      await waitFiction(p, '21:50');
      await p.click('#gm-runv [data-rv="next"]');
      check(!!(await waitFiction(p, '22:00')), 'a beat step catches the fiction up (21:50, then the 22:00 beat)');

      /* a marker moved on the board (a chip armed, then a room: the ball's crew, as a drag or RK05.2 writes it) shows in the Crew line */
      await p.$eval('#gm-runv [data-rv="room"][data-room="Showroom"] [data-rv="pc"][data-id="pc-ray"]', (e) => e.click());
      await sleep(300);
      await p.$eval('#gm-runv [data-rv="room"][data-room="Cocktail lounge"]', (e) => e.click());
      check(!!(await until(async () => /Ray Okonjo Cocktail lounge/.test(lineOf(await block(p), 'Crew')), 10000, 250)), 'a marker moved shows in the Crew line');

      /* secrecy: the iPad and a phone get none of it, and the clicks published nothing */
      const dg = await api('GET', '/gm/display', undefined, IPAD), pc = await api('GET', '/campaign', undefined, P1), ts = await api('GET', '/table/screen', undefined, P1);
      const bad = ['"fic"', 'gl-now', 'Fiction', 'till 23:30', 'till 00:15', '23:31'].filter((s) => dg.text.includes(s) || pc.text.includes(s) || ts.text.includes(s));
      check(bad.length === 0, 'secrecy: the display’s GET, a phone’s campaign and the table screen hold none of it (' + bad + ')');
      await ctx.close();
    }

    /* ---------- a +5 alone publishes nothing to the players ---------- */
    await reset(true);
    {
      const { p, ctx } = await open();
      await until(() => block(p), 10000);
      await sleep(1500);
      const before = await api('GET', '/gm/display', undefined, IPAD);
      await p.click('#gm-runv [data-site="gln-add"][data-min="5"]');
      await waitFiction(p, '21:50');
      await sleep(2000);      /* the mission's publish waits 800 ms */
      const after = await api('GET', '/gm/display', undefined, IPAD);
      check(JSON.stringify((before.json || {}).mission || null) === JSON.stringify((after.json || {}).mission || null), 'a +5 publishes nothing: the display’s mission is the same before and after');
      await ctx.close();
    }

    /* ---------- the kit desk ---------- */
    await reset(true, { 'kit.desk': true });
    {
      const { p, ctx } = await open();
      const t = await until(() => block(p), 10000);
      check(!!t && (await p.$$('#gm-runv .gl-now.gl-now-kit')).length === 1, 'kit desk: the block is there');
      check((await p.$$('#gm-runv .gl-now-kit .ui-btn[data-site="gln-add"]')).length === 2, 'kit desk: +5 and +15 are B68Ui buttons');
      await p.click('#gm-runv [data-site="gln-add"][data-min="15"]');
      check(!!(await waitFiction(p, '22:00')), 'kit desk: +15 reads 22:00');
      check(/Nell Arbuthnot Cocktail lounge/.test(lineOf(await block(p), 'Crew')) && /Mabel Quist Showroom till 23:30/.test(lineOf(await block(p), 'Now')), 'kit desk: the crew and the people');
      await ctx.close();
    }

    /* ---------- the screenshots to look at (RK_SHOTS) ---------- */
    if (c.SHOTS) {
      for (const desk of [false, true]) {
        for (const scheme of ['light', 'dark']) {
          for (const [w, h] of [[1366, 768], [1536, 864], [1024, 768]]) {
            if (w === 1024 && scheme === 'dark') continue;
            await reset(true, { 'kit.desk': desk });
            await api('PATCH', '/gm/state', { ball: { fic: { b: 45, off: 7 } } });
            const { p, ctx } = await open(w, h, scheme);
            await until(() => block(p), 10000);
            await sleep(500);
            await shots(p, 'rk21-desk-' + (desk ? 'on' : 'off') + '-' + (scheme === 'dark' ? 'night' : 'paper') + '-' + w + 'x' + h);
            await ctx.close();
          }
        }
      }
    }
  } finally {
    await reset(false, { 'kit.desk': null }).catch(() => {});
  }
  return true;
}
