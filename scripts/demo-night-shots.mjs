// The demo night's screenshots (the night rebuild, N0): `npm run demo:night -- --shots <dir>` seeds the night, then calls shoot() with this list.
// Secrecy: the prep note's cue 6 reveals a GM-ONLY- NPC on purpose, so a secrecy scan taken after a scenario fires it will hit.
// Later builders add their own scenarios here. A scenario:
//   { name, size: [w, h], route, as?, setup?(ctx), ready?(page, ctx), steps?(page, ctx), settle?, fullPage?, context? }
//     name      the file is <name>-<width>.png in the folder given (so one name can be shot at several sizes)
//     route     what the page opens, after the base URL and a slash: '#gm', '#display', '#c/pc-nell', 'lookbook.html'
//     as        the member the browser signs in as (the dev Worker's X-Dev-User; default the GM)
//     setup     runs before the page opens: ctx.api(method, path, body, user) is the Worker's API, ctx.open(route, user, [w, h]) opens a helper page
//               ({ c, page, errors }; close it with c.close()), ctx.users the members
//     ready     waits for the page to be drawn (the defaults below: the GM page's roll keys, the display's overlay, a sheet's Keys box)
//     steps     what to do on the page before the shot (open a tab, enter a phase, open the Menu)
//     settle    milliseconds to wait before the shot (default 800)       fullPage   the whole scrolling page       context   extra Playwright context options
//     keepToasts   take the shot without waiting for the toasts to clear (by default it waits up to 8 s, so a toast does not hide the layout)
//     init      a function run in the page before its own scripts (a Playwright init script: localStorage a real device would already hold)
// The scenarios run in order and share the server's state, so a phase entered in one is the phase of the next until another is entered.
// Every shot is taken with animations disabled and the mouse parked in a corner. A page error is printed beside the file name; a scenario that
// fails is reported and the rest go on. The pages run on the real clock: after the prep note's curfew (22:40) a phase shows the curfew bar.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const GM_READY = async (page) => {
  await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
  await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.waitForTimeout(600);
};
const DISPLAY_READY = async (page) => { await page.waitForSelector('.dp-overlay', { state: 'attached', timeout: 30000 }); };
const SHEET_READY = async (page) => {
  await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
  await page.waitForSelector('#dossier .ds-keybox', { timeout: 30000 });
};
/* enter a phase as the GM does: a tap on the phase rail (the night controller's enter); going back is allowed, the same phase again is a no-op */
const enterPhase = (id) => async (page) => {
  await page.waitForSelector('#gm-phaserail [data-rail="' + id + '"]', { timeout: 15000 });
  await page.$eval('#gm-phaserail [data-rail="' + id + '"]', (e) => { if (e.getAttribute('data-state') !== 'now') e.click(); });
  await page.waitForSelector('#gm-phaserail [data-rail="' + id + '"][data-state="now"]', { timeout: 10000 });
  await page.waitForTimeout(500);
};
/* a tab by its key (R T B S J C N D O I G), as the GM opens it */
const tab = (key) => async (page) => { await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); await page.keyboard.press(key); await page.waitForTimeout(400); };
const then = (...fns) => async (page, ctx) => { for (const f of fns) await f(page, ctx); };
const LAPTOPS = [[1366, 768], [1536, 864]];
const gmAt = (name, steps, setup) => LAPTOPS.map((size) => ({ name, size, route: '#gm', ready: GM_READY, steps, setup }));

export const SCENARIOS = [
  /* the GM page before the first phase (the night has none), on the Prep tab */
  ...gmAt('gm-nophase', tab('r'), async (ctx) => { await ctx.api('PATCH', '/gm/state', { night: null }); }),
  /* each of the four phases, entered through the phase rail, on the tab that phase works in today */
  ...gmAt('gm-pb', then(enterPhase('pb'), tab('d'))),
  ...gmAt('gm-plan', then(enterPhase('plan'), tab('o'))),
  /* the score: the Location tab's Map box, where the score's controls live today (stage, security, the people bar, knowledge) */
  ...gmAt('gm-score', then(enterPhase('score'), tab('b'), async (page) => { await page.waitForSelector('#gm-loc .gm-mapbox', { timeout: 15000 }); await page.$eval('#gm-loc .gm-mapbox', (e) => e.scrollIntoView({ block: 'start' })); })),
  /* the Run tab (G), during the score */
  { name: 'gm-run', size: [1366, 768], route: '#gm', ready: GM_READY, steps: async (page) => { await page.keyboard.press('g'); await page.waitForSelector('.rv-head', { timeout: 15000 }); } },
  { name: 'gm-run', size: [1536, 864], route: '#gm', ready: GM_READY, steps: async (page) => { await page.keyboard.press('g'); await page.waitForSelector('.rv-head', { timeout: 15000 }); } },
  /* the Menu open */
  { name: 'gm-menu', size: [1366, 768], route: '#gm', ready: GM_READY, steps: async (page) => { await page.click('[data-gm="menu"]'); await page.waitForSelector('.gm-menu-list:not([hidden])', { timeout: 5000 }); } },
  /* Menu > Settings (N0) */
  { name: 'gm-settings', size: [1366, 768], route: '#gm', ready: GM_READY, steps: async (page) => { await page.click('[data-gm="menu"]'); await page.click('#gm-menu-settings'); await page.waitForSelector('#gm-sheet-settings:not([hidden]) [data-set-row]', { timeout: 5000 }); } },
  { name: 'gm-settings', size: [390, 844], route: '#gm', ready: GM_READY, context: { isMobile: true, hasTouch: true }, steps: async (page) => { await page.click('[data-gm="menu"]'); await page.click('#gm-menu-settings'); await page.waitForSelector('#gm-sheet-settings:not([hidden]) [data-set-row]', { timeout: 5000 }); } },
  /* the display at 1024x768 (the iPad): the Location map shown from the GM page, a held NPC, the band (the phase is the score) */
  { name: 'display', size: [1024, 768], route: '#display', as: 'table.ipad@example.test', ready: DISPLAY_READY, settle: 2500,
    init: () => { try { localStorage.setItem('b68.display.hint', '1'); } catch (e) { /* no storage */ } },       /* the iPad dismissed its Home Screen hint on day one */
    setup: async (ctx) => {
      const G = await ctx.open('#gm', ctx.users.GM, [1366, 768]);
      try {
        await GM_READY(G.page);
        await enterPhase('score')(G.page);
        await G.page.keyboard.press('b');
        await G.page.waitForSelector('#gm-loc [data-gm="layer"][data-v="player"]', { timeout: 20000 });
        await G.page.click('#gm-loc [data-gm="layer"][data-v="player"]');       /* only the player layer goes to the iPad */
        await G.page.waitForSelector('#gm-loc [data-gm="ipad"]:not([disabled])', { timeout: 10000 });
        await G.page.click('#gm-loc [data-gm="ipad"]');
        for (let i = 0; i < 40; i++) { const d = (await ctx.api('GET', '/gm/display')).json; if (d && d.display && d.display.kind === 'svg') break; await G.page.waitForTimeout(250); }
        await G.page.keyboard.press('g'); await G.page.waitForSelector('.rv-head', { timeout: 15000 }).catch(() => {});
        /* a beat on and back: the page publishes the players' band (the mission's hud) on a move of the night's clock */
        await G.page.click('[data-rv="next"]').catch(() => {}); await G.page.waitForTimeout(1200);
        await G.page.click('[data-rv="back"]').catch(() => {}); await G.page.waitForTimeout(2500);
      } finally { await G.c.close(); }
      await ctx.api('PATCH', '/gm/ambient', { overlay: { id: 'demo-hold-mabel', kind: 'npc', ms: 180000, npcId: 'npc-mabel' } });
    },
    steps: async (page) => { await page.waitForSelector('.dp-ov-npc', { timeout: 20000 }).catch(() => {}); } },
  /* the Aftermath, last, so the shots before it are in the score: Menu > Aftermath show, where it is run today */
  ...gmAt('gm-after', then(enterPhase('after'), async (page) => { await page.click('[data-gm="menu"]'); await page.waitForSelector('#gm-menu-aftermath', { timeout: 5000 }); await page.click('#gm-menu-aftermath'); await page.waitForSelector('#gm-sheet-aftermath:not([hidden])', { timeout: 8000 }); })),
  /* Nell's phone: her sheet as player1 */
  { name: 'phone-nell', size: [390, 844], route: '#c/pc-nell', as: 'player1@example.test', ready: SHEET_READY, context: { isMobile: true, hasTouch: true }, settle: 1500 },
  { name: 'phone-nell-full', size: [390, 844], route: '#c/pc-nell', as: 'player1@example.test', ready: SHEET_READY, context: { isMobile: true, hasTouch: true }, settle: 1500, fullPage: true }
];

export async function shoot({ base, dir, only = [], api, users }) {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PW_MODULE || 'playwright');
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  mkdirSync(dir, { recursive: true });
  async function open(route, user, size, extra = {}, init = null) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width: size[0], height: size[1] }, serviceWorkers: 'block', ...extra });
    await c.addInitScript(() => { window.__B68_POLL_MS = 1000; });
    if (init) await c.addInitScript(init);
    const page = await c.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('dialog', (d) => d.accept());
    await page.goto(base + '/' + route);
    return { c, page, errors };
  }
  const ctx = { api, users, base, open };
  let n = 0;
  try {
    for (const s of SCENARIOS) {
      if (only.length && !only.some((o) => s.name.startsWith(o))) continue;
      const file = path.join(dir, s.name + '-' + s.size[0] + '.png');
      let P = null;
      try {
        if (s.setup) await s.setup(ctx);
        P = await open(s.route, s.as || users.GM, s.size, s.context || {}, s.init || null);
        if (s.ready) await s.ready(P.page, ctx);
        if (s.steps) await s.steps(P.page, ctx);
        await P.page.mouse.move(1, s.size[1] - 2);       /* no hover state in the picture */
        if (!s.keepToasts) await P.page.waitForFunction(() => !['toastMsg', 'toastErr'].some((id) => { const e = document.getElementById(id); return e && e.textContent.trim(); }), null, { timeout: 8000 }).catch(() => {});
        await P.page.waitForTimeout(s.settle === undefined ? 800 : s.settle);
        await P.page.screenshot({ path: file, fullPage: !!s.fullPage, animations: 'disabled' });
        n++;
        console.log('shot ' + path.basename(file) + (P.errors.length ? '   page errors: ' + P.errors.slice(0, 2).join(' | ') : ''));
      } catch (e) {
        console.log('FAILED ' + path.basename(file) + ': ' + (e && e.message || e).split('\n')[0]);
      } finally { if (P) await P.c.close(); }
    }
  } finally { await browser.close(); }
  return n;
}
