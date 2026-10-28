// PW_MODULE wrapper: playwright-core with chromium.launch forced onto the installed Edge (channel 'msedge').
// Looks for playwright-core in PW_CORE_DIR, else <TEMP>/lint/node_modules/playwright-core.
const path = require('path');
const dir = process.env.PW_CORE_DIR || path.join(process.env.TEMP || process.env.TMPDIR || '/tmp', 'lint', 'node_modules', 'playwright-core');
const pw = require(dir);
const orig = pw.chromium.launch.bind(pw.chromium);
pw.chromium.launch = (o = {}) => orig({ ...o, channel: 'msedge' });
module.exports = pw;
