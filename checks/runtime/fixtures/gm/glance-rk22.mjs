// RK22 (gm.glance): the quick rules. The browser half of the check, run by checks/runtime/glance.e2e.mjs on the demo night (the invented Pelican Rooms; the Dovetail
// Crew: Nell Arbuthnot is at the table with Stress 4; the fixture rules hold an "Engagement Roll" entry of placeholder prose). No model, no key, $0.
//   off      the page has no quick-rules panel anywhere (Roll, Run header, Downtime), the module is never fetched, and the Roll column is as today
//   roll     under the Roll card (before Blade's fold), shut; Actions lists the twelve, an action fills the Roll's own line and shows the rules' entry (a fixture
//            standing in for B68Rules); Heat sum shows the crew's heat + exposure through the Aftermath's heatOutcome and writes nothing to the campaign
//   eng      the Run header before the night starts: the net, the three numbers (no Score rolled: all tapped), the rule chip opens the real fixture entry;
//            tapping a control never starts the night
//   indulge  the Downtime card's Indulge activity: dice, highest die, stress from the sheet, the verdict, and it survives the card's redraw
//   secrecy  the display's GET and a phone's GET hold none of the panels' text, and no data-gm control is in the panels
//   shots    RK_SHOTS=<dir>: 1366x768 and 1536x864 and 1024x768 and 390x844, Paper and Night, kit.desk off and on
// Every part sets the settings, the ball and the campaign heat it uses at its start, and leaves gm.glance off at its end.
const SITE = 'The Pelican Rooms';
const CREW = { 'pc-nell': 'Cocktail lounge', 'pc-ray': 'Showroom', 'pc-tam': 'Showroom' };
const FIXTURE_HUNT = 'GLANCE-FIXTURE-HUNT: a made-up definition for the test, not the book.';
let heat0 = null;

async function resetState(c, on, extra) {
  const { api, sleep } = c;
  await api('PATCH', '/gm/state', { features: { 'gm.glance': on, 'kit.desk': false, 'kit.stage': null, ...(extra || {}) } });
  await api('PATCH', '/campaign', { features: { 'gm.glance': on } });
  const crew = {}; for (const [id, room] of Object.entries(CREW)) crew[id] = { room, disguise: 'guest', moved: null, noticed: null };
  /* the night not started: the Run header shows the result row (the engagement panel's place) */
  await api('PATCH', '/gm/state', { ball: { site: SITE, v: 2, crew, view: null, start: null, t: null }, con: { live: { pc: '' } } });
  await api('PATCH', '/gm/ambient', { overlay: null });
  await sleep(300);
}
export const reset = (c) => resetState(c, false);

export async function rk22(c) {
  const { BASE, GM, IPAD, P1, api, check, until, sleep, browser, errors, atPlace, shots } = c;
  const campaign = async () => ((await api('GET', '/campaign')).json || {}).doc || {};
  if (heat0 === null) heat0 = { heat: (await campaign()).crew && (await campaign()).crew.heat, wanted: (await campaign()).crew && (await campaign()).crew.wanted };
  await api('PATCH', '/campaign', { crew: { heat: 6 } });

  async function open(w, h, scheme, theme, on, desk) {
    await resetState(c, on, { 'kit.desk': !!desk });
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w || 1366, height: h || 768 }, serviceWorkers: 'block', colorScheme: scheme || 'light' });
    await ctx.addInitScript(atPlace('score'));
    await ctx.addInitScript(() => { window.__B68_POLL_MS = 700; });
    if (theme) await ctx.addInitScript((t) => { try { localStorage.setItem('b68.theme', t); } catch (e) { /* none */ } }, theme === 'night' ? 'dark' : 'light');
    const p = await ctx.newPage(); const requests = [];
    p.on('pageerror', (e) => errors.push('rk22 gm: ' + e.message));
    p.on('request', (r) => requests.push(r.url()));
    p.on('dialog', (d) => d.accept());
    await p.goto(BASE + '/#gm');
    await p.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000, state: 'attached' });
    await sleep(1500);
    await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    return { p, ctx, requests };
  }
  /* the keys go where the focus is (no blur first: a tap that leaves the focus in the Roll's line would swallow them, and the line would hold the letters) */
  const lineNow = (p) => p.$eval('#gm-c-threat', (t) => t.value);
  const toRun = async (p, tag) => { const before = await lineNow(p); await p.keyboard.press('b'); await p.keyboard.press('g'); await p.waitForSelector('.rv-head', { timeout: 20000 }); if (tag) check((await lineNow(p)) === before, tag + 'b and g went to the page (the Run view), not into the Roll’s line'); };
  const minFont = (p) => p.evaluate(() => { let m = 99, who = ''; for (const n of document.querySelectorAll('[data-gl-panel]')) for (const e of [n, ...n.querySelectorAll('*')]) { if (![...e.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue; const z = parseFloat(getComputedStyle(e).fontSize); if (z < m) { m = z; who = e.tagName + '.' + e.className; } } return { m, who }; });
  const panels = (p) => p.$$eval('[data-gl-panel]', (l) => l.map((n) => n.getAttribute('data-gl-panel')));
  /* the page's rules module stands in for the book: one entry, fixture text, so the definition path is the page's own */
  const realRules = (p) => p.evaluate(() => { if (window.__rk22Rules) window.B68Rules = window.__rk22Rules; });
  const fakeRules = (p) => p.evaluate((txt) => {
    if (!window.__rk22Rules) window.__rk22Rules = window.B68Rules;
    const e = { id: 'b68/hunt', title: 'Hunt', caption: "Blades '68 · Actions", md: txt };
    window.B68Rules = Object.assign({}, window.B68Rules, { available: () => true, load: () => Promise.resolve(null), hits: (q) => ({ total: 1, hits: /hunt|prowl/i.test(q) ? [{ id: 'b68/hunt', title: 'Hunt' }] : [] }), entry: () => e });
  }, FIXTURE_HUNT);

  /* ---- off ---- */
  {
    const { p, requests } = await open(1366, 768, 'light', 'light', false, false);
    await sleep(800);
    check((await panels(p)).length === 0, 'rk22 off: no quick-rules panel on the Roll');
    check(await p.evaluate(() => typeof window.B68GmQuickRules === 'undefined'), 'rk22 off: the module is not on the page');
    check(!requests.some((u) => /quick-rules|glance\.css/.test(u)), 'rk22 off: no request for the bundle (' + requests.filter((u) => /quick-rules|glance/.test(u)) + ')');
    await toRun(p);
    check((await panels(p)).length === 0, 'rk22 off: no engagement panel in the Run header either');
    await p.keyboard.press('d'); await p.waitForSelector('#gm-dt [data-gm="dt-who"]', { timeout: 20000 });
    await p.click('#gm-dt [data-gm="dt-who"][data-id="pc-nell"]'); await p.click('#gm-dt [data-gm="dt-act"][data-v="indulge"]');
    await p.waitForSelector('#gm-dt .gm-dt-vice', { timeout: 10000 });
    check((await panels(p)).length === 0, 'rk22 off: no Indulge Vice panel in the Downtime card');
    await p.context().close();
  }

  /* ---- on, both desks ---- */
  for (const desk of [false, true]) {
    const tag = 'rk22 ' + (desk ? 'kit.desk on' : 'kit.desk off') + ': ';
    const { p, ctx, requests } = await open(1366, 768, 'light', 'light', true, desk);
    await p.waitForSelector('[data-gl-panel="roll"] .gl-bar', { timeout: 30000 });
    check(requests.some((u) => /quick-rules/.test(u)), tag + 'the bundle is fetched while the setting is on');
    const place = await p.evaluate(() => {
      const n = document.querySelector('[data-gl-panel="roll"]'), sec = document.getElementById('gm-roll'), rack = document.getElementById('gm-rackf'), rl = document.getElementById('gm-rl');
      return { inSec: !!n && n.parentNode === sec, beforeRack: !!n && !!rack && (n.compareDocumentPosition(rack) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0, afterRl: !!n && !!rl && (rl.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        scope: !!n && n.hasAttribute('data-ui-scope'), shut: !n.querySelector('.gl-body'), pressed: n.querySelectorAll('[aria-pressed="true"]').length };
    });
    check(place.inSec && place.afterRl && place.beforeRack, tag + 'the panel sits under the Roll card and before Blade’s fold ' + JSON.stringify(place));
    check(place.shut && place.pressed === 0 && place.scope, tag + 'it is shut by default, with the kit’s scope');

    /* actions */
    await p.click('[data-gl-panel="roll"] [data-gl="tog"][data-v="acts"]');
    await p.waitForSelector('[data-gl-panel="roll"] .gl-acts', { timeout: 5000 });
    const acts = await p.$$eval('[data-gl-panel="roll"] [data-gl="act"]', (l) => l.map((b) => b.getAttribute('data-v')));
    const expected = await p.evaluate(() => window.B68Content.ACTIONS.flatMap((g) => g[1]));
    check(acts.length === 12 && JSON.stringify(acts) === JSON.stringify(expected), tag + 'Actions lists every action of B68Content.ACTIONS (' + acts.length + ')');
    await fakeRules(p);
    await p.fill('#gm-c-threat', '');      /* the room's own line is there to start with: the typed rest is what the check follows */
    await p.click('[data-gl-panel="roll"] [data-gl="act"][data-v="Hunt"]');
    check(await until(() => p.$eval('#gm-c-threat', (t) => t.value.startsWith('Hunt: ')), 4000, 100), tag + 'an action fills the Roll’s line');
    check(await until(() => p.$eval('[data-gl-panel="roll"] .gl-def', (d) => d.textContent.includes('GLANCE-FIXTURE-HUNT')).catch(() => false), 6000, 150), tag + 'its definition is the rules’ entry (from B68Rules at runtime)');
    check(await p.$eval('[data-gl-panel="roll"] [data-gl="act"][data-v="Hunt"]', (b) => b.getAttribute('aria-pressed') === 'true'), tag + 'the chosen action is marked pressed');
    await p.type('#gm-c-threat', 'the guard turns round');
    await p.click('[data-gl-panel="roll"] [data-gl="act"][data-v="Prowl"]');
    check(await p.$eval('#gm-c-threat', (t) => t.value === 'Prowl: the guard turns round'), tag + 'a second action takes the first’s place and keeps what was typed');
    { const f = await minFont(p); check(f.m >= 12, tag + 'nothing in the Roll panel is under 12 px (smallest ' + f.m + ' ' + f.who + ')'); }
    check(await p.evaluate(() => !!document.activeElement && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)), tag + 'the tap gave the focus back: the Roll’s line does not hold it');
    await p.click('[data-gl-panel="roll"] [data-gl="rule"]');
    check(await until(() => p.$eval('[data-gl-panel="roll"] .gl-rule-t', (d) => /GLANCE-FIXTURE-HUNT/.test(d.textContent)).catch(() => false), 4000, 100), tag + 'the rule chip opens the entry');
    /* the line goes to the iPad through the page's own stamp, as typed */
    await p.waitForSelector('#gm-stamp [data-gm="stamp"]', { timeout: 20000 });
    await p.click('#gm-pos [data-v="risky"]'); await p.click('#gm-eff [data-v="standard"]'); await p.click('#gm-stamp [data-gm="stamp"]');
    const ov = await until(async () => { const d = ((await api('GET', '/gm/ambient')).json || {}).doc || {}; return d.overlay ? JSON.stringify(d.overlay) : ''; }, 8000, 200);
    check(/Prowl: the guard turns round/.test(ov || ''), tag + 'the line the GM stamps is what they typed (the GM’s own line) ' + String(ov).slice(0, 300));
    check(!/GLANCE-FIXTURE/.test(ov || ''), tag + 'the definition never reaches the iPad');
    await p.keyboard.press('Escape'); await sleep(300);
    /* after a tap the keys are still the page's: 2 is They rolled 4/5 (a result card), and it is not typed into the line */
    await p.click('[data-gl-panel="roll"] [data-gl="act"][data-v="Study"]');
    const cardBefore = await p.$eval('#gm-card', (c) => c.innerHTML), lineBefore = await lineNow(p);
    await p.keyboard.press('2'); await p.keyboard.press('Space');
    check(await until(() => p.$eval('#gm-card', (c, b) => c.innerHTML !== b, cardBefore), 6000, 150), tag + 'after an action tap, the key 2 still fires They rolled (a result card comes up)');
    check((await lineNow(p)) === lineBefore, tag + 'and 2 and Space were not typed into the Roll’s line (' + (await lineNow(p)) + ')');
    await p.keyboard.press('Escape'); await sleep(300);

    /* heat sum */
    await p.click('[data-gl-panel="roll"] [data-gl="tog"][data-v="heat"]');
    await p.waitForSelector('[data-gl-panel="roll"] .gl-heat', { timeout: 5000 });
    check(await p.$eval('[data-gl-panel="roll"] .gl-sum', (s) => /Heat 6 · No siren/.test(s.textContent)), tag + 'the heat sum starts from the crew’s heat (6)');
    { const f = await minFont(p); check(f.m >= 12, tag + 'nothing in the Heat sum is under 12 px (smallest ' + f.m + ' ' + f.who + ')'); }
    await p.click('[data-gl-panel="roll"] [data-gl="pick"][data-id="exposure"][data-v="4"]');
    check(await p.$eval('[data-gl-panel="roll"] .gl-sum', (s) => /Heat 10 · Siren/.test(s.textContent)), tag + 'with exposure 4 it is the siren (the Aftermath’s heatOutcome)');
    await p.click('[data-gl-panel="roll"] [data-gl="step"][data-v="mods"][data-d="-1"]');
    check(await p.$eval('[data-gl-panel="roll"] .gl-sum', (s) => /Heat 9 · Siren/.test(s.textContent)), tag + 'a modifier of -1 brings it to 9, still the siren');
    await sleep(500);
    const crew = (await campaign()).crew || {};
    check(crew.heat === 6, tag + 'nothing was written: the campaign’s heat is still 6 (' + crew.heat + ')');
    await shots(p, 'RK22-roll-heat-' + (desk ? 'kit' : 'old'));
    await p.click('[data-gl-panel="roll"] [data-gl="tog"][data-v="acts"]');
    await shots(p, 'RK22-roll-actions-' + (desk ? 'kit' : 'old'));

    /* engagement */
    await toRun(p, tag);
    await p.waitForSelector('.rv-start', { timeout: 10000 });
    await p.waitForSelector('[data-gl-panel="eng"] .gl-bar', { timeout: 10000 });
    const inHead = await p.$eval('[data-gl-panel="eng"]', (n) => !!n.closest('.rv-headwrap, .krv-headwrap'));
    check(inHead, tag + 'the engagement dice sit in the Run header, under the result row');
    check(await p.$eval('[data-gl-panel="eng"] [data-gl="tog"]', (b) => /0d net/.test(b.textContent)), tag + 'shut, one line: "0d net"');
    await p.click('[data-gl-panel="eng"] [data-gl="tog"]');
    await p.waitForSelector('[data-gl-panel="eng"] .gl-eng-b', { timeout: 5000 });
    check(await p.$eval('[data-gl-panel="eng"]', (n) => /no Score rolled: tap the numbers/.test(n.textContent) && /Tier gap/.test(n.textContent) && /District/.test(n.textContent) && /Plan detail/.test(n.textContent)), tag + 'with no Score rolled it shows the three numbers to tap');
    await p.click('[data-gl-panel="eng"] [data-gl="step"][data-v="plan"][data-d="1"]');
    await p.click('[data-gl-panel="eng"] [data-gl="step"][data-v="tier"][data-d="-1"]');
    await p.click('[data-gl-panel="eng"] [data-gl="step"][data-v="district"][data-d="1"]');
    await p.click('[data-gl-panel="eng"] [data-gl="step"][data-v="district"][data-d="1"]');
    check(await p.$eval('[data-gl-panel="eng"] .gl-sum b', (b) => b.textContent === 'Net +2d'), tag + 'the net is the sum (plan +1, tier -1, district +2)');
    { const f = await minFont(p); check(f.m >= 12, tag + 'nothing in the engagement panel is under 12 px (smallest ' + f.m + ' ' + f.who + ')'); }
    check(await p.$('.rv-start') !== null, tag + 'tapping the dice did not start the night');
    await realRules(p);
    await p.click('[data-gl-panel="eng"] [data-gl="rule"]');
    check(await until(() => p.$eval('[data-gl-panel="eng"] .gl-rule-t', (d) => /warbling kettle/.test(d.textContent)).catch(() => false), 8000, 200), tag + 'the rule chip opens the real fixture entry from the rules table');
    await shots(p, 'RK22-eng-' + (desk ? 'kit' : 'old'));

    /* indulge */
    await p.keyboard.press('d'); await p.waitForSelector('#gm-dt [data-gm="dt-who"]', { timeout: 20000 });
    await p.click('#gm-dt [data-gm="dt-who"][data-id="pc-nell"]'); await p.click('#gm-dt [data-gm="dt-act"][data-v="indulge"]');
    await p.waitForSelector('[data-gl-panel="indulge"] .gl-bar', { timeout: 10000 });
    check(await p.$eval('[data-gl-panel="indulge"] .gl-gist', (g) => /lowest attribute, highest die, stress/.test(g.textContent)), tag + 'shut, the Indulge panel is one line');
    await p.click('[data-gl-panel="indulge"] [data-gl="tog"]');
    await p.waitForSelector('[data-gl-panel="indulge"] .gl-ind', { timeout: 5000 });
    check(await p.$eval('[data-gl-panel="indulge"] .gl-ind', (n) => /Stress now/.test(n.textContent) && />4</.test(n.innerHTML.replace(/\s/g, ''))), tag + 'Nell’s stress (4) comes from the sheet');
    await p.click('[data-gl-panel="indulge"] [data-gl="pick"][data-id="dice"][data-v="2"]');
    await p.click('[data-gl-panel="indulge"] [data-gl="pick"][data-id="die"][data-v="3"]');
    check(await p.$eval('[data-gl-panel="indulge"] .gl-sum', (s) => /Not overindulged/.test(s.textContent)), tag + 'a 3 against stress 4 is not an overindulge');
    await p.click('[data-gl-panel="indulge"] [data-gl="pick"][data-id="die"][data-v="6"]');
    check(await p.$eval('[data-gl-panel="indulge"] .gl-sum', (s) => /Overindulged\./.test(s.textContent) && /Mishaps/.test(s.textContent)), tag + 'a 6 is more than 4: overindulged, and the Morning After is the Mishaps');
    check(await p.$eval('[data-gl-panel="indulge"] .gl-steps', (o) => o.querySelectorAll('li').length === 5), tag + 'five steps listed');
    { const f = await minFont(p); check(f.m >= 12, tag + 'nothing in the Indulge panel is under 12 px (smallest ' + f.m + ' ' + f.who + ')'); }
    check(await p.evaluate(() => { const n = document.querySelector('[data-gl-panel="indulge"]'), r = document.querySelector('#gm-dt .gm-dt-row[aria-label="Rolled at the table"]'); return !!n && !!r && (n.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0; }), tag + 'the Indulge panel sits above Rolled at the table');
    check(await p.$eval('[data-gl-panel="indulge"] [data-gm="dt-roll"]', (b) => /Overindulged/.test(b.textContent) && b.getAttribute('data-v') === 'over'), tag + 'the verdict carries the page’s own Overindulged button');
    await p.click('[data-gl-panel="indulge"] [data-gm="dt-roll"]');
    await p.waitForSelector('#gm-dt-card', { timeout: 10000 });
    check(await p.$eval('[data-gl-panel="indulge"] .gl-sum', (s) => /Overindulged\./.test(s.textContent)).catch(() => false), tag + 'the panel survives the card’s redraw, with its taps');
    check(await p.$eval('#gm-dt [data-gm="dt-roll"][data-k="res"][data-v="over"].gm-dtb-over', (b) => b.getAttribute('aria-pressed') === 'true'), tag + 'the verdict button rolled the card as overindulged: the page’s own Overindulged button below shows it pressed');
    await shots(p, 'RK22-indulge-' + (desk ? 'kit' : 'old'));

    /* secrecy and the old controls */
    const dg = await api('GET', '/gm/display', undefined, IPAD), pc = await api('GET', '/campaign', undefined, P1);
    const leaks = ['GLANCE-FIXTURE', 'gl-rules', 'warbling kettle'].filter((s) => (dg.text || '').includes(s) || (pc.text || '').includes(s));
    check(leaks.length === 0, tag + 'secrecy: the display’s GET and a phone’s GET hold none of the panels’ text (' + leaks + ')');
    check(await p.evaluate(() => [...document.querySelectorAll('[data-gl-panel]')].every((n) => [...n.querySelectorAll('[data-gm]')].every((b) => n.getAttribute('data-gl-panel') === 'indulge' && b.getAttribute('data-gm') === 'dt-roll'))), tag + 'the only data-gm control in a panel is the Indulge verdict’s dt-roll (the page’s own)');
    await ctx.close();
  }

  /* ---- shots ---- */
  if (c.SHOTS) {
    const sizes = [[1366, 768], [1536, 864], [1024, 768], [390, 844]];
    for (const desk of [false, true]) for (const theme of ['light', 'night']) for (const [w, h] of sizes) {
      const { p, ctx } = await open(w, h, theme === 'night' ? 'dark' : 'light', theme, true, desk);
      await p.waitForSelector('[data-gl-panel="roll"] .gl-bar', { timeout: 30000 });
      await fakeRules(p);
      await p.fill('#gm-c-threat', 'the guard turns round');
      await p.click('[data-gl-panel="roll"] [data-gl="tog"][data-v="acts"]'); await p.click('[data-gl-panel="roll"] [data-gl="act"][data-v="Hunt"]'); await sleep(500);
      await shots(p, 'RK22-' + (desk ? 'kit' : 'old') + '-' + theme + '-' + w + '-roll');
      if (w >= 1000) {
        await toRun(p); await p.waitForSelector('[data-gl-panel="eng"] .gl-bar', { timeout: 10000 });
        await p.click('[data-gl-panel="eng"] [data-gl="tog"]'); await p.click('[data-gl-panel="eng"] [data-gl="step"][data-v="plan"][data-d="1"]'); await sleep(300);
        await shots(p, 'RK22-' + (desk ? 'kit' : 'old') + '-' + theme + '-' + w + '-eng');
        await p.keyboard.press('d'); await p.waitForSelector('#gm-dt [data-gm="dt-who"]', { timeout: 20000 });
        await p.click('#gm-dt [data-gm="dt-who"][data-id="pc-nell"]'); await p.click('#gm-dt [data-gm="dt-act"][data-v="indulge"]');
        await p.waitForSelector('[data-gl-panel="indulge"] .gl-bar', { timeout: 10000 });
        await p.click('[data-gl-panel="indulge"] [data-gl="tog"]'); await p.click('[data-gl-panel="indulge"] [data-gl="pick"][data-id="dice"][data-v="2"]'); await p.click('[data-gl-panel="indulge"] [data-gl="pick"][data-id="die"][data-v="6"]'); await sleep(300);
        await shots(p, 'RK22-' + (desk ? 'kit' : 'old') + '-' + theme + '-' + w + '-indulge');
      }
      await ctx.close();
    }
  }
  /* what a part leaves: the campaign's heat where it was, the setting off */
  if (heat0 && heat0.heat !== undefined) await api('PATCH', '/campaign', { crew: { heat: heat0.heat } });
  await resetState(c, false);
}
