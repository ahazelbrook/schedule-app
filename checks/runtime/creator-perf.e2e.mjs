/* The creator must not redraw the figure for edits that cannot change it. Re-parsing the ~270 KB figure SVG on every
   keystroke or click was what made character creation feel slow on a phone. Run: node checks/runtime/creator-perf.e2e.mjs
   (PW_MODULE points at playwright, as the other e2e checks). */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_MODULE || 'playwright');
const index = 'file://' + path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'index.html');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 390, height: 800 } });
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto(index); await p.waitForTimeout(1000);
const r = await p.evaluate(async () => {
  const A = window.B68, wait = ms => new Promise(r => setTimeout(r, ms));
  A.set('sheet.playbook', A.CT.PLAYBOOKS[0].id); await wait(1500);
  const art = document.querySelector('#art svg'), lu = document.querySelector('#lineup svg');
  for (let i = 0; i < 6; i++) { A.set('sheet.vice', 'v' + i); A.set('sheet.dots', { Hunt: i % 3 }); await wait(80); }
  await wait(1800);
  const sameAfterSheet = art === document.querySelector('#art svg') && lu === document.querySelector('#lineup svg');
  A.set('heightIn', 63); await wait(300);
  const art2 = document.querySelector('#art svg');
  const changedAfterFigure = art2 !== art;
  A.set('sheet.name', 'Typing Test'); await wait(900);   /* the name is drawn on the plate, so this one redraws */
  const redrawnForName = document.querySelector('#art svg') !== art2;
  return { sameAfterSheet, changedAfterFigure, redrawnForName };
});
ok(r.sameAfterSheet, 'sheet-only edits (vice, dots) leave the figure and the line-up on screen untouched');
ok(r.changedAfterFigure, 'a figure edit (height) still redraws the figure');
ok(r.redrawnForName, 'a name edit still redraws (the name is on the plate)');
ok(errs.length === 0, 'no page errors' + (errs.length ? ': ' + errs[0] : ''));
await b.close(); console.log(fails ? fails + ' failed' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
