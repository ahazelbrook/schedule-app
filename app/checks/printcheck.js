process.chdir(__dirname); try { require('fs').mkdirSync('out', { recursive: true }); } catch (e) {}
/* The printed sheet: PDFs of each playbook, and the figure in the print slot. A phone never draws the 360 KB figure on screen
   (the thumbnail stands in), so printing from a phone has to draw it: beforeprint fills .ds-printfig, and a re-render while
   printing keeps it. Run from this dir: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node printcheck.js [hound,vampire] */
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const fs = require('fs'); const src = fs.readFileSync('trackerpn.js', 'utf8');
const STUB = src.match(/const STUB = `([\s\S]*?)`;/)[1]; const SHEET = src.match(/const SHEET = `([\s\S]*?)`;\n/)[1];
const URL = 'file://' + require('path').resolve(__dirname, '..', 'index.html');
(async () => {
  const b = await chromium.launch();
  const fails = [], errs = [], notes = [];
  const assert = (ok, msg) => { if (!ok) fails.push(msg); };
  for (const pb of (process.argv[2] || 'hound,vampire').split(',')) {
    for (const w of [1360, 390]) {
      const tag = pb + (w < 760 ? '-phone' : '');
      const ctx = await b.newContext({ viewport: { width: w, height: 900 } }); await ctx.addInitScript(STUB);
      const p = await ctx.newPage(); p.on('dialog', d => d.accept()); p.on('pageerror', e => errs.push(tag + ' pageerror: ' + e.message));
      await p.goto(URL); await p.waitForTimeout(1000);
      await p.evaluate(`(${SHEET})(${JSON.stringify(pb)}); true`); await p.waitForTimeout(1000);
      const screen = await p.evaluate(() => ({ fig: !!document.querySelector('#dossier .ds-figbox svg'), thumb: !!document.querySelector('#dossier img.ds-thumb') }));
      assert(w < 760 ? !screen.fig && screen.thumb : screen.fig && !screen.thumb, tag + ': on screen the ' + (w < 760 ? 'thumbnail, not the figure' : 'figure, not the thumbnail') + ': ' + JSON.stringify(screen));
      await p.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
      await p.emulateMedia({ media: 'print' }); await p.waitForTimeout(150);
      const look = () => p.evaluate(() => { const f = document.querySelector('#dossier .ds-printfig'); return { svg: !!(f && f.querySelector('svg')), display: f ? getComputedStyle(f).display : 'none', h: f ? Math.round(f.getBoundingClientRect().height) : 0 }; });
      const pr = await look();
      assert(pr.svg && pr.display === 'block' && pr.h > 60, tag + ': the figure prints in the header slot: ' + JSON.stringify(pr));
      await p.evaluate(() => B68Tracker.refresh()); await p.waitForTimeout(100);
      const pr2 = await look();
      assert(pr2.svg && pr2.display === 'block', tag + ': a re-render while printing keeps the figure: ' + JSON.stringify(pr2));
      notes.push(tag + ' print figure ' + JSON.stringify(pr));
      await p.pdf({ path: 'out/print-' + tag + '.pdf', format: 'A4', printBackground: true });
      if (w > 760) await p.pdf({ path: 'out/print-' + tag + '-letter.pdf', format: 'Letter', printBackground: true });
      await p.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      await ctx.close();
    }
  }
  await b.close();
  console.log('NOTES:\n' + notes.join('\n'));
  console.log('FAILS:', fails.length ? '\n' + fails.join('\n') : 'none');
  console.log('ERRORS:', errs.length ? '\n' + errs.join('\n') : 'none');
  process.exit(fails.length || errs.length ? 1 : 0);
})().catch(e => { console.error('FAILED', e); process.exit(1); });
