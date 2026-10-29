// Every browser check, one after another, then a summary (npm run check:e2e-all). A failed check does not stop the run.
// The app/checks/ ones open app/index.html from file:// with a stubbed window.claude (the artifact's runtime); the
// checks/runtime/ ones start their own wrangler dev, each on its own default port (8790 to 8871), so stop `npm run dev`
// and anything else on those ports first. Each needs PLAYWRIGHT_BROWSERS_PATH (PW_MODULE / PW_CHANNEL on Windows).
//   node checks/e2e-all.mjs              every check
//   node checks/e2e-all.mjs gm offline   only the checks whose file name contains one of these words
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKS = [
  // the page against the stubbed runtime (file://)
  ['app/checks/e2e.js', 'Home states, filing a character, the sheet, the files, Back and drafts'],
  ['app/checks/pn-e2e.js', 'creating each paranormal playbook'],
  ['app/checks/trackercheck.js', 'the living sheet for the core playbooks'],
  ['app/checks/ms3.js', 'the sheet redraws only the boxes that changed'],
  ['app/checks/mu2.js', 'the roll panel abilities strip: the sheet and the crew, folded, read-only'],
  ['app/checks/trackerpn.js', 'every sheet control for the paranormal playbooks, and printing'],
  ['app/checks/printcheck.js', 'the single-sheet print PDFs'],
  ['app/checks/dice.js', 'the roll panel'],
  ['app/checks/session.js', 'end of session and downtime'],
  ['app/checks/table.js', 'the Table view and the JSON backups'],
  ['app/checks/campaign.js', 'the table page'],
  ['app/checks/crewsheet.js', 'the crew sheet for all six crews'],
  ['app/checks/schedule.js', 'the schedule box and the next-session card'],
  ['app/checks/season.js', 'the season print'],
  ['checks/runtime/creator-perf.e2e.mjs', 'the creator does not redraw the figure for sheet-only edits'],
  ['checks/runtime/cast.artifact.e2e.mjs', 'the cast in the artifact runtime'],
  // the hosted build against its own local Worker
  ['checks/runtime/offline.e2e.mjs', 'install, offline reload, a lazily loaded route offline, sync on reconnect (8790)'],
  ['checks/runtime/schedule.e2e.mjs', 'the schedule (8791)'],
  ['checks/runtime/phone.e2e.mjs', 'a 390 px phone: device width, standards mode, no overflow (8792)'],
  ['checks/runtime/rules.e2e.mjs', 'the rules wiki (8795)'],
  ['checks/runtime/clocks.e2e.mjs', 'the shared clocks: two players and the GM, each on a stale copy (8797)'],
  ['checks/runtime/cast.e2e.mjs', 'the cast, a GM and a player (8842)'],
  ['checks/runtime/gm.e2e.mjs', 'the GM page, its lazy bundle, the display wiring (8845)'],
  ['checks/runtime/gm-prep.e2e.mjs', 'the prep view (8846)'],
  ['checks/runtime/gm-stt.e2e.mjs', 'the iPad transcriber: fake mic, fake Deepgram (8847; Playwright 1.48+)'],
  ['checks/runtime/display-role.e2e.mjs', 'the display-only sign-in, its request budget, the reload when signed out (8856)'],
  ['checks/runtime/gm-scenes.e2e.mjs', 'the Street panel (8857)'],
  ['checks/runtime/gm-npc-panel.e2e.mjs', 'the NPC generator panel (8858)'],
  ['checks/runtime/gm-maps.e2e.mjs', 'the Location map on the iPad: map kit 0.7, live reveal (8866)'],
  ['checks/runtime/gm-run.e2e.mjs', 'Run the site: floors, the evening clock, disguise, crew, pins (8877)'],
  ['checks/runtime/gm-run-v2.e2e.mjs', 'the Run tab for a v2 night: start, beats, peek, moves, Open for the players, keys, Focus at three sizes (8950)'],
  ['checks/runtime/gm-mission.e2e.mjs', 'the players\' mission from the Run view: the chip, Next and Back, a peek, the Players view, the overlay, End the night (8910)'],
  ['checks/runtime/mission-loop.e2e.mjs', 'the whole mission loop: GM, iPad and two phones; Next, Heard, Tell the crew, a hidden name refused, Reveal and send, End the night, latency (8920)'],
  ['checks/runtime/gm-score.e2e.mjs', 'the Score panel (8859)'],
  ['checks/runtime/gm-chase.e2e.mjs', 'the Chase panel and the iPad drawing its strip (8861)'],
  ['checks/runtime/gm-assist-panel.e2e.mjs', 'the Blade panel: tab, banner, polling, Fit, Ask (8862)'],
  ['checks/runtime/gm-assist-shell.e2e.mjs', 'the Blade side panel shell at three widths (8863)'],
  ['checks/runtime/gm-assist-cards.e2e.mjs', 'the Blade cards: fold, Now, filters, strip, restore, light and dark (8864)'],
  ['checks/runtime/gm-cogm.e2e.mjs', 'the co-GM: switch, clock and Undo, re-sent window, 429, Do it, compare-and-swap, hidden NPC, Reveal and show (8878)'],
  ['checks/runtime/gm-assist-health.e2e.mjs', 'the Blade header: seat-health dots, reaped note, meter, live regions, focus, contrast in light and dark (8872)'],
  ['checks/runtime/mission-card.e2e.mjs', 'the phone mission card: own card only, dot, live redraw, switcher, mission null (9020)'],
  ['checks/runtime/display-ambient.e2e.mjs', 'the ambient floor on the display (8871)'],
  ['checks/runtime/display-band.e2e.mjs', 'the band beside the map: geometry at three sizes, hides over other stages, hud change within a poll, no /api/campaign (8900)'],
  ['checks/runtime/display-overlay.e2e.mjs', 'overlays on the display: a clock, an NPC, a line, the dawn (8874)'],
  ['checks/runtime/gm-autopilot.e2e.mjs', 'the iPad autopilot: a clock overlay, Take over, secrecy, lights out, display-only expiry (8879)'],
];

const want = process.argv.slice(2);
const run = CHECKS.filter(([file]) => !want.length || want.some((w) => file.includes(w)));
if (!run.length) { console.log('no check matches: ' + want.join(' ')); process.exit(2); }
const results = [];
for (const [file, what] of run) {
  console.log('\n======== ' + file + ': ' + what);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(ROOT, file)], { cwd: ROOT, stdio: 'inherit', env: process.env });
  results.push({ file, ok: r.status === 0, secs: Math.round((Date.now() - t0) / 1000), why: r.status === null ? 'killed by ' + r.signal : 'exit ' + r.status });
}
console.log('\n======== summary');
for (const r of results) console.log((r.ok ? 'PASS ' : 'FAIL ') + r.file.padEnd(40) + String(r.secs).padStart(5) + ' s' + (r.ok ? '' : '  (' + r.why + ')'));
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? '\n' + failed + ' of ' + results.length + ' FAILED' : '\nALL ' + results.length + ' PASSED');
process.exit(failed ? 1 : 0);
