// The band's screenshots (the night rebuild, N1a): the GM page's top band in every state, at the four widths, on the demo night.
//   npm run demo:night -- --shots <dir> --only band
// Imported by scripts/demo-night-shots.mjs (the scenario format is described there). Each scenario sets the night it needs through the API first
// (a phase in play, budgets, a start and a curfew relative to the real clock), so the pictures read the same whenever they are taken.
//   band-normal     the Score in play, the beat running, a cue fired, the curfew an hour off
//   band-curfew     the curfew due: row 2 red, Call the Aftermath, Keep running, Snooze 10 min
//   band-panic      PANIC pressed: row 2 red, WORK LIGHT UP and Resume in the cue's place
//   band-signedout  the server says 401: row 2 red with the signed-out message
//   band-nocues     a prep note with no Cues section: NO CUES
//   band-long       long words everywhere: the cue, the beat, what is on the iPad
//   band-menu, band-cuemore, band-quiet, band-elsewhere: the Menu, the cue's popover, the quiet list, and Planning on screen while the Score runs
import { vnow } from './kit-fingerprint.mjs';
const M = 60000;
const pad = (n) => (n < 10 ? '0' : '') + n;
const hm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
const SIZES = [[1366, 768], [1536, 864], [900, 700], [390, 844]];
const PHONE = { isMobile: true, hasTouch: true };

const READY = async (page) => {
  await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
  await page.waitForSelector('#gm-band [data-band-place]', { timeout: 30000 });
  await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.waitForTimeout(600);
};
/* the night as the shots want it: Personal and Planning done (Planning a little over), the Score 41 minutes in, a start two hours ago, the curfew
   `curfewIn` minutes from now; the cue stack back at its first cue, with no work light */
async function night(ctx, o = {}) {
  const now = vnow();
  const n = { v: 1, phase: o.phase || 'score', startAt: hm(now - 120 * M), curfewAt: hm(now + (o.curfewIn === undefined ? 58 : o.curfewIn) * M),
    phases: { pb: { budget: 30, start: now - 111 * M, end: now - 79 * M }, plan: { budget: 25, start: now - 79 * M, end: now - 41 * M }, score: { budget: 90, start: now - 41 * M, end: null }, after: { budget: 25, start: null, end: null } } };
  await ctx.api('PATCH', '/gm/state', { night: null });
  await ctx.api('PATCH', '/gm/state', { night: n, cues: null });
}
/* the prep part as served, changed on the way (fresh browser context each time: nothing is cached before it is read) */
const prepRoute = (edit) => async (c) => {
  await c.route(/\/api\/gm\/pack\?.*part=prep/, async (route) => {
    const r = await route.fetch(); const j = await r.json();
    const walk = (v) => { if (typeof v === 'string') return edit(v); if (Array.isArray(v)) return v.map(walk); if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = walk(v[k]); return o; } return v; };
    if (j && j.body) j.body = walk(j.body);
    await route.fulfill({ response: r, json: j });
  });
};
/* start the Score's beat in the Prep run order, as the GM does (the Prep view's run-order button), then go back to the Location panel */
const startBeat = async (page) => {
  await page.keyboard.press('r'); await page.waitForTimeout(500);
  await page.evaluate(() => { const b = [...document.querySelectorAll('#gm-prep .pp-beat')]; const s = b.find((x) => /score/i.test(x.getAttribute('data-label') || '')) || b[2] || b[0]; if (s && s.getAttribute('aria-pressed') !== 'true') s.click(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.keyboard.press('b'); await page.waitForTimeout(400);
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
};
const each = (name, extra) => SIZES.map((size) => Object.assign({ name, size, route: '#gm', ready: READY, context: size[0] < 600 ? PHONE : {} }, extra));

export const BAND_SCENARIOS = [
  ...each('band-normal', { setup: (ctx) => night(ctx), steps: async (page) => { await startBeat(page); await page.click('#gm-cuebar [data-cs="go"]'); await page.waitForTimeout(700); } }),
  ...each('band-curfew', { setup: (ctx) => night(ctx, { curfewIn: -3 }), steps: async (page) => { await page.waitForSelector('#gm-band .gm-band-r2[data-alarm="curfew"]', { timeout: 15000 }); } }),
  ...each('band-panic', { setup: (ctx) => night(ctx), steps: async (page) => { await page.click('#gm-band [data-band="panic"]'); await page.waitForSelector('#gm-band .gm-band-r2[data-alarm="panic"]', { timeout: 8000 }); } }),
  ...each('band-signedout', { setup: (ctx) => night(ctx),
    routes: async (c) => { await c.route(/\/api\/gm\/state/, (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"signed out"}' }) : route.fallback())); },
    steps: async (page) => { await page.keyboard.press('2'); await page.waitForSelector('#gm-band.out #gm-signed:not([hidden])', { timeout: 15000 }); } }),
  ...each('band-nocues', { setup: (ctx) => night(ctx), routes: prepRoute((s) => s.replace(/## Cues[\s\S]*?(?=\n## )/, '')),
    steps: async (page) => { await page.waitForSelector('#gm-cuebar[data-state="idle"]', { state: 'attached', timeout: 15000 }); } }),
  ...each('band-long', { setup: async (ctx) => {
      await night(ctx);
      await ctx.api('PUT', '/gm/display', { kind: 'text', title: 'The Pelican Rooms: the long gallery over the card rooms, by lamplight', text: 'A long line of words for the players.' });
    },
    routes: prepRoute((s) => s.replace('2. show: title: The Pelican Rooms | A night at the tables', '2. show: title: The Pelican Rooms, the whole of its upper gallery and the card rooms under the stair | A night at the tables that runs long past its time')),
    steps: async (page) => { await startBeat(page); await page.click('#gm-cuebar [data-cs="go"]'); await page.waitForTimeout(700); } }),
  { name: 'band-menu', size: [1366, 768], route: '#gm', ready: READY, setup: (ctx) => night(ctx), steps: async (page) => { await page.click('#gm-band [data-gm="menu"]'); await page.waitForSelector('#gm-band .gm-menu-list:not([hidden])'); } },
  { name: 'band-menu', size: [390, 844], route: '#gm', ready: READY, context: PHONE, setup: (ctx) => night(ctx), steps: async (page) => { await page.click('#gm-band [data-gm="menu"]'); await page.waitForSelector('#gm-band .gm-menu-list:not([hidden])'); } },
  { name: 'band-cuemore', size: [1366, 768], route: '#gm', ready: READY, setup: (ctx) => night(ctx), steps: async (page) => { await page.click('#gm-cuebar .gm-cs-more'); await page.waitForSelector('#gm-cuebar .gm-cs-pop:not([hidden])'); } },
  { name: 'band-quiet', size: [1366, 768], route: '#gm', ready: READY, setup: (ctx) => night(ctx),
    steps: async (page) => { await page.waitForSelector('#gm-band .gm-quiet-badge', { timeout: 20000 }); await page.click('#gm-band .gm-quiet-badge'); await page.waitForSelector('#gm-band .gm-quiet-list:not([hidden])'); } },
  { name: 'band-elsewhere', size: [1366, 768], route: '#gm', ready: READY, setup: (ctx) => night(ctx),
    steps: async (page) => { await page.keyboard.press('Control+ArrowLeft'); await page.waitForSelector('#gm-band [data-band-place="plan"][aria-current="true"]', { timeout: 5000 }); } }
];
