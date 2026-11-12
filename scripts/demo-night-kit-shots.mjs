// The kit's demo-night scenarios (KS04.3 of the kit and stage build): one for each region of the new desk, each stage beat, each phone screen, Start the night and the
// pitch seat. They run at the end of scripts/demo-night-shots.mjs's list, after the places of the night, so no earlier picture sees the state they leave.
//   npm run demo:night -- --shots <dir> --only kit-            the kit's scenarios alone
//   npm run demo:night -- --shots <dir> --kit desk,stage,phone,who,pitches --theme night --only kit-
// With the settings off (and until a bundle fills its stub) every one of them shows today's screen for its region, which is what kit-off compares. Names:
//   kit-desk-band kit-desk-roll kit-desk-blade kit-desk-run kit-desk-shell kit-desk-skin     the desk, 1366x768 and 1536x864
//   kit-who-start kit-who-roster   Start the night and the roster (the Before place; Personal business)        kit-pitch-seat   the Blade panel's seat
//   kit-stage-idle kit-stage-band kit-stage-clocks kit-stage-stakes kit-stage-result kit-stage-npc kit-stage-map   the iPad at 1024x768, 1180x820 and 768x1024
//   kit-phone-sheet kit-phone-sheet-full   Nell's sheet at 390x844 and 375x667
// Invented fixtures only (the Pelican Rooms, the Dovetail Crew). Anything an overlay says is the demo's own words.
import { vnow } from './kit-fingerprint.mjs';
const IPAD = 'table.ipad@example.test', P1 = 'player1@example.test';
const IPADS = [[1024, 768], [1180, 820], [768, 1024]];
const HINT = () => { try { localStorage.setItem('b68.display.hint', '1'); } catch (e) { /* no storage */ } };       /* the iPad dismissed its Home Screen hint on day one */

export function kitScenarios(h) {
  const { GM_READY, DISPLAY_READY, PHONE_READY, enterPhase, then, toPlace, LAPTOPS, closeMission } = h;
  const gm = (name, steps, setup) => LAPTOPS.map((size) => ({ name, size, route: '#gm', ready: GM_READY, steps, setup }));
  const press = (key) => async (page) => {
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await page.keyboard.press(key); await page.waitForTimeout(700);
  };
  const overlay = (o) => async (ctx) => { const r = await ctx.api('PATCH', '/gm/ambient', { overlay: o }); if (r.status !== 200) throw new Error('PATCH /gm/ambient ' + r.status + ' ' + String(r.text || '').slice(0, 160)); };
  const stamp = (id, text, position, effect) => overlay({ id, kind: 'report', ms: 180000, payload: { position, effect, text } });
  const ipad = (name, setup, steps) => IPADS.map((size) => ({ name, size, route: '#display', as: IPAD, ready: DISPLAY_READY, settle: 2200, init: HINT, setup, steps }));
  const seen = (sel) => async (page) => { await page.waitForSelector(sel, { timeout: 20000 }).catch(() => {}); };
  /* the player layer of the map to the iPad, as the existing display scenario does it (a GM page opens, shows it, and closes) */
  const mapToIpad = async (ctx) => {
    await overlay(null)(ctx);
    const G = await ctx.open('#gm', ctx.users.GM, [1366, 768]);
    try {
      await GM_READY(G.page); await enterPhase('score')(G.page); await G.page.keyboard.press('b');
      await G.page.waitForSelector('#gm-loc [data-gm="layer"][data-v="player"]', { timeout: 20000 });
      await G.page.click('#gm-loc [data-gm="layer"][data-v="player"]');
      await G.page.waitForSelector('#gm-loc [data-gm="ipad"]:not([disabled])', { timeout: 10000 });
      await G.page.click('#gm-loc [data-gm="ipad"]');
      for (let i = 0; i < 40; i++) { const d = (await ctx.api('GET', '/gm/display')).json; if (d && d.display && d.display.kind === 'svg') break; await G.page.waitForTimeout(250); }
      await G.page.waitForTimeout(1500);
    } finally { await G.c.close(); }
  };
  const CLOCKS = [{ id: 'c-alarm', name: 'House alarm', size: 6, filled: 2, kind: 'danger', hidden: true }, { id: 'c-marker', name: 'Win back the marker', size: 8, filled: 5, kind: 'progress' },
    { id: 'c-ferry', name: 'Last ferry', size: 4, filled: 1, kind: 'danger' }];
  const tickClocks = async (ctx) => { await overlay(null)(ctx); const r = await ctx.api('PATCH', '/campaign', { clocks: CLOCKS }); if (r.status !== 200) throw new Error('PATCH /campaign clocks ' + r.status); };
  const phone = (name, extra) => [[390, 844], [375, 667]].map((size) => Object.assign({ name, size, route: '#c/pc-nell', as: P1, ready: PHONE_READY, context: { isMobile: true, hasTouch: true }, settle: 1200,
    steps: closeMission }, extra || {}));

  return [
    /* the desk, by region (the Score in play, so the band, the Roll and the Run view are all at work) */
    ...gm('kit-desk-band', then(toPlace('score'), enterPhase('score'))),
    ...gm('kit-desk-roll', then(toPlace('score'), press('2'))),
    ...gm('kit-desk-blade', then(toPlace('score'), press('a'))),
    ...gm('kit-desk-run', toPlace('score', 'run')),
    ...gm('kit-desk-shell', then(toPlace('before'), async (page) => { await page.click('[data-gm="menu"]'); await page.waitForSelector('.gm-menu-list:not([hidden])', { timeout: 5000 }); })),
    ...gm('kit-desk-skin', then(toPlace('score'), async (page) => { await page.keyboard.press('Control+k'); await page.fill('#gm-find-q', 'map'); await page.waitForTimeout(500); })),
    /* Start the night and the roster, and the pitch seat */
    { name: 'kit-who-start', size: [1366, 768], route: '#gm', ready: GM_READY, steps: toPlace('before') },
    { name: 'kit-who-roster', size: [1366, 768], route: '#gm', ready: GM_READY, steps: toPlace('pb') },
    { name: 'kit-pitch-seat', size: [1366, 768], route: '#gm', ready: GM_READY, steps: then(toPlace('score'), press('a')) },
    /* the stage, beat by beat (what the iPad is told is today's: an overlay the iPad already knows) */
    ...ipad('kit-stage-idle', overlay(null)),
    ...ipad('kit-stage-band', overlay(null), seen('.dp-overlay')),
    ...ipad('kit-stage-clocks', tickClocks),
    ...ipad('kit-stage-stakes', stamp('kit-stakes-' + vnow(), 'Nell goes for it: the guard is watching the door', 'risky', 'standard'), seen('.dp-overlay')),
    ...ipad('kit-stage-result', stamp('kit-result-' + vnow(), 'It goes wrong: a door slams upstairs', 'desperate', 'limited'), seen('.dp-overlay')),
    ...ipad('kit-stage-npc', overlay({ id: 'kit-npc-' + vnow(), kind: 'npc', ms: 180000, npcId: 'npc-mabel' }), seen('.dp-ov-npc')),
    ...ipad('kit-stage-map', mapToIpad),
    { name: 'kit-stage-clear', size: [1024, 768], route: '#display', as: IPAD, ready: DISPLAY_READY, settle: 500, init: HINT, setup: overlay(null) },
    /* the phone: Nell's sheet, the part that scrolls and the part that does not */
    ...phone('kit-phone-sheet'),
    ...phone('kit-phone-sheet-full', { fullPage: true })
  ];
}
