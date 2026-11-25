// RK05 (night.flow): the threat marker follows the roll. The browser half of the check, run by checks/runtime/night-flow.e2e.mjs on the demo night
// (the invented Pelican Rooms; the Dovetail Crew: Nell Arbuthnot in the Cocktail lounge, Ray Okonjo and Tam Petrakis in the Showroom). No model, no key, $0.
//   off      a stamp with the Cocktail lounge selected and Ray picked drops its glyph where most of the crew are (the Showroom), as today; nobody moves; a line
//            with no threat stem still gets the plain warning mark and its log line; the night-flow bundle is not on the page
//   on       the same stamp drops its glyph in the Cocktail lounge (the room the Run view has selected) and moves Ray's marker there (the Ball doc's crew[k].room),
//            logged once; nobody else moves; a second stamp in the room writes nothing; no clock, no heat; a line with no threat stem leaves no glyph and no log line
//   nothing selected   the glyph and the roller go to the room most of the crew are in
//   secrecy  the display's GET and a phone's GET hold none of the new log lines
//   shots    RK_SHOTS=<dir>: the Run map with the glyph in the selected room, 1366x768 and 1024x768, Paper and Night, kit.desk off and on
// Every part sets the settings, the ball and the overlay it uses at its start, and leaves night.flow off at its end.
const SITE = 'The Pelican Rooms';
const CREW = { 'pc-nell': 'Cocktail lounge', 'pc-ray': 'Showroom', 'pc-tam': 'Showroom' };
/* the setting, the crew where the demo night has them, no Who picked, no overlay on the iPad, no night log: what a part starts from, and what it leaves */
async function resetState(c, on, extra) {
  const { api, sleep } = c;
  await api('PATCH', '/gm/state', { features: { 'night.flow': on, 'map.threat': null, 'spine.stamp': null, ...(extra || {}) } });
  const crew = {}; for (const [id, room] of Object.entries(CREW)) crew[id] = { room, disguise: 'guest', moved: null, noticed: null };
  await api('PATCH', '/gm/state', { ball: { site: SITE, v: 2, crew, view: null }, night: { v: 1, log: null }, con: { live: { pc: '' } } });
  await api('PATCH', '/gm/ambient', { overlay: null });
  await sleep(300);
}
export const reset = (c) => resetState(c, false, { 'kit.desk': null });
export async function rk05(c) {
  const { BASE, GM, IPAD, P1, api, check, until, sleep, browser, errors, atPlace, shots } = c;
  const LOUNGE = 'Cocktail lounge', SHOW = 'Showroom';
  const gmDoc = async () => (await api('GET', '/gm/state')).json.doc;
  const ballCrew = async () => ((await gmDoc()).ball || {}).crew || {};
  const roomOf = async (id) => ((await ballCrew())[id] || {}).room || '';
  const logText = async () => JSON.stringify((await gmDoc()).night || {});
  const count = (hay, needle) => hay.split(needle).length - 1;
  /* the page writes the night log a moment after the click: wait for a line, or settle before reading what is not there */
  const logHas = async (text) => !!(await until(async () => (await logText()).includes(text), 8000, 200));
  const settle = async () => { await sleep(1500); return logText(); };
  const campaign = async () => { const d = (await api('GET', '/campaign')).json.doc; return JSON.stringify({ clocks: d.clocks, heat: d.crew && d.crew.heat, wanted: d.crew && d.crew.wanted }); };

  const reset = (on, extra) => resetState(c, on, extra);
  async function open(w, h, scheme) {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w || 1366, height: h || 768 }, serviceWorkers: 'block', colorScheme: scheme || 'light' });
    await ctx.addInitScript(atPlace('score'));
    await ctx.addInitScript(() => { window.__B68_POLL_MS = 700; });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push('rk05 gm: ' + e.message));
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
  const selectRoom = async (p, room) => { await p.waitForSelector('.rv-card[data-room="' + room + '"]', { timeout: 20000 }); await p.$eval('.rv-card[data-room="' + room + '"]', (e) => e.click()); await sleep(300); };
  /* a tap on the chip that is already picked puts it down again, so tap only a chip that is not picked */
  const pickWho = async (p, name) => { const sel = '#gm-who [data-gm="who"][data-v="' + name + '"]'; await p.waitForSelector(sel, { timeout: 20000 }); if ((await p.getAttribute(sel, 'aria-checked')) !== 'true') await p.click(sel); await p.waitForSelector(sel + '[aria-checked="true"]', { timeout: 5000 }); };
  const stampIt = async (p, text) => {
    await p.waitForSelector('#gm-stamp [data-gm="stamp"]', { timeout: 20000 });
    await p.fill('#gm-c-threat', text);
    await p.click('#gm-pos [data-v="risky"]');
    await p.click('#gm-eff [data-v="standard"]');
    await p.click('#gm-stamp [data-gm="stamp"]');
    await until(async () => (((await api('GET', '/gm/ambient')).json || {}).doc || {}).overlay, 8000, 150);
    await sleep(400);
  };
  const toMap = async (p) => { await p.click('[data-rv="view"][data-v="map"]'); await p.waitForSelector('#rv-map svg', { timeout: 20000 }); await sleep(500); };
  const glyph = (p) => p.evaluate(() => { const g = document.querySelector('#rv-map svg .b19-threat'); if (!g) return null; const ci = g.querySelector('circle'); return { kind: g.getAttribute('data-glyph'), cx: ci && ci.getAttribute('cx'), cy: ci && ci.getAttribute('cy') }; });
  const glyphs = (p) => p.$$eval('#rv-map svg .b19-threat', (l) => l.length);
  const clearStamp = async (p) => { await p.keyboard.press('Escape'); await sleep(300); };

  let offPos = null;
  try {
    /* ---------- off ---------- */
    await reset(false);
    {
      const camp0 = await campaign();
      const { p, ctx } = await open();
      check(await p.evaluate(() => !window.B68GmThreatRoom), 'off: gm/threat-room.js is not on the page (the night-flow bundle is not asked for)');
      await selectRoom(p, LOUNGE); await pickWho(p, 'Ray Okonjo');
      await stampIt(p, 'The guard turns');
      await toMap(p);
      const g = await until(() => glyph(p), 6000, 150);
      check(!!g && g.kind === 'guard', 'off: the stamp drops its guard glyph on the map');
      offPos = g;
      const logged = await logHas('Threat on the map: guard in ' + SHOW), log = await settle();
      check(logged, 'off: the glyph goes where most of the crew are, the ' + SHOW + ', whatever room is selected');
      check((await roomOf('pc-ray')) === SHOW && (await roomOf('pc-nell')) === LOUNGE && (await roomOf('pc-tam')) === SHOW, 'off: nobody moves');
      check(!log.includes('Marker follows the roll'), 'off: no marker line in the log');
      await clearStamp(p);
      await stampIt(p, 'The ceiling is thin');
      await toMap(p);
      const w = await until(async () => { const x = await glyph(p); return x && x.kind === 'warn' ? x : null; }, 6000, 150);
      const warned = await logHas('Threat on the map: warn in ' + SHOW), lg = await logText();
      check(!!w && warned, 'off: a line with no threat stem still gets the plain warning mark and its log line (glyph ' + JSON.stringify(await glyph(p)) + '; log ' + (lg.match(/Threat on the map: [a-z]+ in [A-Za-z ]+/g) || []).join(' | ') + ')');
      check((await campaign()) === camp0, 'off: no clock, heat or wanted changed');
      await ctx.close();
    }

    /* ---------- on ---------- */
    await reset(true);
    {
      const camp0 = await campaign();
      const { p, ctx } = await open();
      check(!!(await until(() => p.evaluate(() => !!window.B68GmThreatRoom && !window.B68GmThreatRoom.stub), 10000)), 'on: the night-flow bundle loads threat-room.js');
      await selectRoom(p, LOUNGE); await pickWho(p, 'Ray Okonjo');
      await stampIt(p, 'The guard turns');
      await toMap(p);
      const g = await until(() => glyph(p), 6000, 150);
      check(!!g && g.kind === 'guard', 'on: the stamp drops its guard glyph');
      check(!!g && !!offPos && (g.cx !== offPos.cx || g.cy !== offPos.cy), 'on: and the glyph is in another room than it was with the setting off (' + (g && g.cx + ',' + g.cy) + ' against ' + (offPos && offPos.cx + ',' + offPos.cy) + ')');
      check(!!(await until(async () => (await roomOf('pc-ray')) === LOUNGE, 8000, 150)), 'on: the roller’s marker moves to the ' + LOUNGE + ' (the Ball doc’s crew[k].room)');
      check((await roomOf('pc-nell')) === LOUNGE && (await roomOf('pc-tam')) === SHOW, 'on: nobody else moves');
      check(await logHas('Threat on the map: guard in ' + LOUNGE), 'on: the threat is logged in the ' + LOUNGE);
      await logHas('Marker follows the roll');
      let log = await settle();
      check(count(log, 'Marker follows the roll: Ray Okonjo to ' + LOUNGE) === 1, 'on: the marker move is logged once');
      check((await campaign()) === camp0, 'on: moving a marker costs nothing: no clock, heat or wanted changed');

      /* a second stamp in the same room, same roller: the glyph again, no second move */
      await clearStamp(p);
      await stampIt(p, 'The door locks behind you');
      await logHas('Threat on the map: door in ' + LOUNGE);
      log = await settle();
      check(count(log, 'Threat on the map: door in ' + LOUNGE) === 1 && count(log, 'Marker follows the roll') === 1, 'on: a second stamp there logs its threat, and writes no second move');

      /* the fall-through: no glyph, no log line */
      await clearStamp(p);
      const threats0 = count(log, 'Threat on the map');
      await stampIt(p, 'The ceiling is thin');
      await toMap(p);
      log = await settle();
      check((await glyphs(p)) === 0, 'on: a line with no threat stem leaves no glyph on the map');
      check(count(log, 'Threat on the map') === threats0 && !log.includes('Threat on the map: warn'), 'on: and no log line');

      /* secrecy: nothing of this reaches the iPad or a phone */
      const dg = await api('GET', '/gm/display', undefined, IPAD);
      const pc = await api('GET', '/campaign', undefined, P1);
      const leaks = ['Marker follows', 'Threat on the map', 'b19-threat'].filter((t) => dg.text.includes(t) || pc.text.includes(t));
      check(leaks.length === 0, 'secrecy: the display’s GET and a phone’s GET hold none of the new log lines (' + leaks + ')');
      await ctx.close();
    }

    /* ---------- on, nothing selected: the roller goes where most of the crew are ---------- */
    await reset(true);
    {
      const { p, ctx } = await open();
      await pickWho(p, 'Nell Arbuthnot');
      await stampIt(p, 'The door locks behind you');
      await toMap(p);
      const g = await until(() => glyph(p), 6000, 150);
      check(!!g && g.kind === 'door', 'nothing selected: the stamp drops its door glyph');
      check(await logHas('Threat on the map: door in ' + SHOW), 'nothing selected: in the ' + SHOW + ', where most of the crew are');
      check(!!(await until(async () => (await roomOf('pc-nell')) === SHOW, 8000, 150)) && (await roomOf('pc-ray')) === SHOW, 'nothing selected: the roller’s marker goes there too');
      await ctx.close();
    }

    /* ---------- on, no Who: the threat goes to the selected room and nobody moves ---------- */
    await reset(true);
    {
      const { p, ctx } = await open();
      await selectRoom(p, LOUNGE);
      await stampIt(p, 'An alarm trips');
      const said = await logHas('Threat on the map: alarm in ' + LOUNGE), log = await settle();
      check(said && !log.includes('Marker follows'), 'no Who: the threat is in the selected room, and no marker moves');
      check((await roomOf('pc-ray')) === SHOW && (await roomOf('pc-tam')) === SHOW, 'no Who: the crew stay where they were');
      await ctx.close();
    }

    /* ---------- on, a room the players have not been shown: the threat lands there (GM only), the marker does not ---------- */
    await reset(true);
    {
      const CLOSED = 'Private card rooms';
      const { p, ctx } = await open();
      const isClosed = await p.$eval('.rv-card[data-room="' + CLOSED + '"]', (e) => !e.classList.contains('open')).catch(() => false);
      check(isClosed, 'closed room: the demo night has not shown the ' + CLOSED + ' to the players');
      const camp0 = await campaign();
      await selectRoom(p, CLOSED); await pickWho(p, 'Ray Okonjo');
      await stampIt(p, 'The guard turns');
      check(await logHas('Threat on the map: guard in ' + CLOSED), 'closed room: the threat is logged there (the glyph is GM-only)');
      const told = await until(() => p.evaluate(() => /Marker stays put: /.test(document.body.innerText)), 6000, 200);
      const log = await settle();
      check(!log.includes('Marker follows the roll'), 'closed room: no marker line in the log');
      check((await roomOf('pc-ray')) === SHOW && (await roomOf('pc-nell')) === LOUNGE && (await roomOf('pc-tam')) === SHOW, 'closed room: no marker moves into it');
      check(!!told, 'closed room: the GM page says why, in a toast');
      const dg = await api('GET', '/gm/display', undefined, IPAD);
      const pc = await api('GET', '/campaign', undefined, P1);
      const leaks = [CLOSED, 'Marker follows', 'Marker stays', 'Threat on the map'].filter((t) => dg.text.includes(t) || pc.text.includes(t));
      check(leaks.length === 0, 'closed room: the display’s GET and a phone’s GET never hold its name or the new log lines (' + leaks + ')');
      check((await campaign()) === camp0, 'closed room: no clock, heat or wanted changed');
      await ctx.close();
    }

    /* ---------- the screenshots to look at (RK_SHOTS): the Run map with the glyph in the selected room ---------- */
    if (c.SHOTS) {
      for (const desk of [false, true]) {
        for (const scheme of ['light', 'dark']) {
          for (const [w, h] of [[1366, 768], [1024, 768]]) {
            await reset(true, { 'kit.desk': desk });
            const { p, ctx } = await open(w, h, scheme);
            await selectRoom(p, LOUNGE); await pickWho(p, 'Ray Okonjo');
            await stampIt(p, 'The guard turns');
            await toMap(p);
            await until(() => glyph(p), 6000, 150);
            await sleep(300);
            await shots(p, 'rk05-desk-' + (desk ? 'on' : 'off') + '-' + (scheme === 'dark' ? 'night' : 'paper') + '-' + w + 'x' + h + '-map');
            await ctx.close();
          }
        }
      }
    }
  } finally {
    /* leave nothing on: the setting off, the crew where they were, no overlay */
    await reset(false, { 'kit.desk': null }).catch(() => {});
  }
  return true;
}
