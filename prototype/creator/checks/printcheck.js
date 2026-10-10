process.chdir(__dirname); try { require('fs').mkdirSync('out', { recursive: true }); } catch (e) {}
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const fs = require('fs'); const src = fs.readFileSync('trackerpn.js', 'utf8');
const STUB = src.match(/const STUB = `([\s\S]*?)`;/)[1]; const SHEET = src.match(/const SHEET = `([\s\S]*?)`;\n/)[1];
const URL = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
(async () => {
  const b = await chromium.launch();
  for (const pb of (process.argv[2] || 'hound,vampire').split(',')) {
    const ctx = await b.newContext({ viewport: { width: 1360, height: 900 } }); await ctx.addInitScript(STUB);
    const p = await ctx.newPage(); p.on('dialog', d => d.accept()); p.on('pageerror', e => console.log('pageerror', e.message));
    await p.goto(URL); await p.waitForTimeout(1000);
    await p.evaluate(`(${SHEET})(${JSON.stringify(pb)}); true`); await p.waitForTimeout(1000);
    await p.pdf({ path: 'out/print-' + pb + '.pdf', format: 'A4', printBackground: true });
    await p.pdf({ path: 'out/print-' + pb + '-letter.pdf', format: 'Letter', printBackground: true });
    await ctx.close();
  }
  await b.close();
})();
