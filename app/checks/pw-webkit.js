// PW_MODULE wrapper: playwright-core with chromium.launch forced onto Playwright's WebKit build (the engine under every iOS browser).
// Looks for playwright-core in PW_CORE_DIR, else <TEMP>/lint/node_modules/playwright-core. Needs `npx playwright-core install webkit`.
//   PW_DEVICE=ipad | iphone   makes every context/page a touch device with that profile's user agent and scale factor.
//                             The suite's own viewport is kept, so a desktop-geometry suite is not failed for its size alone.
//   PW_ENGINE=chromium        the same device profile on Edge (channel msedge), so a WebKit failure can be told from a size failure.
// Test tooling only: nothing in the app imports this.
const path = require('path');
const dir = process.env.PW_CORE_DIR || path.join(process.env.TEMP || process.env.TMPDIR || '/tmp', 'lint', 'node_modules', 'playwright-core');
const pw = require(dir);
const PROFILES = {
  ipad: { userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', deviceScaleFactor: 2, hasTouch: true, isMobile: true },
  iphone: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', deviceScaleFactor: 3, hasTouch: true, isMobile: true },
};
const profile = PROFILES[String(process.env.PW_DEVICE || '').toLowerCase()] || null;
const edge = process.env.PW_ENGINE === 'chromium';
const real = edge ? pw.chromium : pw.webkit;
const engine = Object.create(real);
// Chromium-only launch options (channel, args such as --no-sandbox, chromiumSandbox) mean nothing to WebKit.
engine.launch = async (o = {}) => {
  const { channel, args, chromiumSandbox, ...rest } = o;
  const b = await (edge ? real.launch({ ...o, channel: 'msedge' }) : real.launch(rest));
  if (!profile) return b;
  const dev = edge ? { ...profile, userAgent: profile.userAgent } : profile;
  const newContext = b.newContext.bind(b);
  b.newContext = (opts = {}) => newContext({ ...dev, ...opts });
  b.newPage = async (opts = {}) => { const c = await b.newContext(opts); const p = await c.newPage(); return p; };
  return b;
};
module.exports = { ...pw, chromium: engine, webkit: pw.webkit, devicesProfiles: PROFILES };
