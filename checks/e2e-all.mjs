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
  ['checks/runtime/gm-drawer.e2e.mjs', 'the GM drawer: closed by default, Table / Crew / Players, one sheet frame at most, read only until Edit, three widths and a phone (9800)'],
  ['checks/runtime/gm-mission.e2e.mjs', 'the players\' mission from the Run view: the chip, Next and Back, a peek, the Players view, the overlay, End the night (8910)'],
  ['checks/runtime/mission-loop.e2e.mjs', 'the whole mission loop: GM, iPad and two phones; Next, Heard, Tell the crew, a hidden name refused, Reveal and send, End the night, latency (8920)'],
  ['checks/runtime/gm-marker.e2e.mjs', 'the target marker on the iPad: time, PC, open bands, Lockdown, Target is down (9022)'],
  ['checks/runtime/gm-score.e2e.mjs', 'the Score panel (8859)'],
  ['checks/runtime/gm-chase.e2e.mjs', 'the Chase panel and the iPad drawing its strip (8861)'],
  ['checks/runtime/gm-assist-panel.e2e.mjs', 'the Blade panel: tab, banner, polling, Fit, Ask (8862)'],
  ['checks/runtime/gm-assist-shell.e2e.mjs', 'the Blade side panel shell at three widths (8863)'],
  ['checks/runtime/gm-assist-cards.e2e.mjs', 'the Blade cards: fold, Now, filters, strip, restore, light and dark (8864)'],
  ['checks/runtime/gm-cogm.e2e.mjs', 'the co-GM: switch, clock and Undo, re-sent window, 429, Do it, compare-and-swap, hidden NPC, Reveal and show (8878)'],
  ['checks/runtime/gm-assist-health.e2e.mjs', 'the Blade header: seat-health dots, reaped note, meter, live regions, focus, contrast in light and dark (8872)'],
  ['checks/runtime/mission-card.e2e.mjs', 'the phone mission card: own card only, dot, live redraw, switcher, mission null (9020)'],
  ['checks/runtime/sheet-now.e2e.mjs', 'the phone sheet\'s Now card, Quiet and the Between fold: the order, +n more, nothing due, the long press and its lift-off, 16 px forms, read-only frames and the GM (9170)'],
  ['checks/runtime/display-ambient.e2e.mjs', 'the ambient floor on the display (8871)'],
  ['checks/runtime/display-band.e2e.mjs', 'the band beside the map: geometry at three sizes, hides over other stages, hud change within a poll, no /api/campaign (8900)'],
  ['checks/runtime/ipad-band.e2e.mjs', 'the iPad band: every layer combination in fixed slots at 1024x768, portrait and 1180x820, nothing over the map or the band beside it, lights out, the look book cards (8655)'],
  ['checks/runtime/display-webkit.e2e.mjs', 'the display at iPad and iPhone sizes, with a missing-API probe: the WebKit pass harness (9150)'],
  ['checks/runtime/display-overlay.e2e.mjs', 'overlays on the display: a clock, an NPC, a line, the dawn (8874)'],
  ['checks/runtime/ipad-follows.e2e.mjs', 'the iPad follows the GM (tech run 06/11): Spotlight over a pinned scene, Introduce twice in lights out, the Cast view’s Show on iPad on the display login, the Score puts the players’ map up, the site’s Show on iPad / Take it down, secrecy (9310)'],
  ['checks/runtime/sheet-keys.e2e.mjs', 'turn the key and the key cabinet: the offer at three hits, the deadlock, Stress clear, the iPad card, the automatic critical, the cabinet, All off (9160)'],
  ['checks/runtime/show-contract.e2e.mjs', 'the show contract: every brief beat on the GM display and the iPad within a poll, a hidden NPC dropped, the layers and the scene data channel, the look book (9050)'],
  ['checks/runtime/suite-b17.e2e.mjs', 'the site line of a rolled location on the real GM page: no box under Location, the ONE alarm readout stepped by hand and the iPad\'s band following, the stage group while the map is live, Freeze, no secret in the display GET (8953)'],
  ['checks/runtime/suite-b25.e2e.mjs', 'the face looks on the iPad: expressions, the signature pose, the five portrait formats, the badge and the motif on a fake audio context, a hidden person refused, no notes on the page (9250)'],
  ['checks/runtime/gm-fixer-stamp.e2e.mjs', 'the Fixer on the stamp: only a stamp asks for a fit, with its line and no draws; the coloured lines under They rolled; the 1–3 line above the card; Stamp again; the Fit button (9330)'],
  ['checks/runtime/gm-stamp.e2e.mjs', 'the stamp, the sizer and the strict cue grammar on the real GM page: the Roll’s Stamp it on the iPad, report card, 4/5 sizer with a two-tap reduce, Esc one thing per press, a typed cue with its Undo toast, didn’t catch that, All off (9030)'],
  ['checks/runtime/gm-roll.e2e.mjs', 'the Roll on the demo night: one position for the stamp and the tables, the line from the room and setThreat, Stamp again, Esc through gm/esc.js, keys 1-4, the sizer, the folds, Focus, 1366x768 and a phone (9036)'],
  ['checks/runtime/aftermath.e2e.mjs', 'the Aftermath show: Menu entry, the eight steps on the iPad, the phone commendations, the credits, off again (9110)'],
  ['checks/runtime/gm-autopilot.e2e.mjs', 'the iPad autopilot: a clock overlay, Take over, secrecy, lights out, display-only expiry (8879)'],
  ['checks/runtime/hard-start.e2e.mjs', 'the hard start and the ON AIR lamp on the iPad, switches off and on (9060)'],
  ['checks/runtime/gm-tools-inline.e2e.mjs', 'the 18 tools and the Music inline: bound to a container at 330 and 900 px, real content, close asks the shell, no request after unbind (8951; starts its own demo night)'],
  ['checks/runtime/gm-places.e2e.mjs', 'the places of the night: Before, Ctrl+arrows, entering and following the phase, extra views, Prep at the heading, Find, the desks, Call the Aftermath, the memory, the phone (8860; starts its own demo night)'],
  ['checks/runtime/gm-map-spotted.e2e.mjs', 'the Spotted beat on the Run map: zoom, sting, fill, one alarm tick, back, inside 3 seconds; two GM pages tick once (9071)'],
  ['checks/runtime/gm-map-flashback.e2e.mjs', 'the flashback filter: Flashback and Pin on the site\'s toolbar, grain and the Earlier caption on the iPad, a tap on Back clears it, switch off and on (9072)'],
  ['checks/runtime/gm-map-threat.e2e.mjs', 'the threat on the map: a stamp drops a guard or door glyph inside the crew room, none on the iPad card, it clears with the stamp (9073)'],
  ['checks/runtime/gm-map-knowledge.e2e.mjs', 'the three knowledge states: the Players\' map on each room card (Seen stages, Send opens), Intel in the ⋯, a blueprint room as linework on the iPad copy, dark rooms never in it, live follow (9201)'],
  ['checks/runtime/gm-site.e2e.mjs', 'the site: the ONE alarm, select a room and its card, the Players\' map and Send, the people rows, → the Roll, the ⋯, the Montage inline and its glow, Location without the boxes, no GM-ONLY text in the display GET (8760)'],
  ['checks/runtime/gm-title-card.e2e.mjs', 'the score title card: GO into the Score phase puts a six-second scoretitle beat on the iPad (the site and its storeys, no room name), the name lands last, reduced motion stills it, switch off and on (9202)'],
  ['checks/runtime/gm-cue-stack.e2e.mjs', 'the cue stack on the real GM page: STANDBY, Space and Bypass, two GOs within 500 ms fire once, Esc to the safe scene inside a second and Resume, a typed "Blade, go", All off (9040)'],
  ['checks/runtime/gm-band.e2e.mjs', 'the band (N1a): four widths in three states with no overlap and nothing off the screen, the places enter phases, Ctrl+arrows, Call the Aftermath, Esc in order, keys held behind an open thing, PANIC without cues, the quiet badge (8810)'],
  ['checks/runtime/gm-shortcuts.e2e.mjs', 'the Shortcuts card (K1): ? opens it at 1366 and 1536 with nothing overflowing, ? and Esc shut it, Find and the Menu open it, a ? typed in a field or behind an open box is not it, the phone\'s Menu, the iPad never has it (8765; starts its own demo night)'],
  ['checks/runtime/music.e2e.mjs', 'the Music desk (M1): three playlists filled through the picker, Play on a tap, Tension in the Score, Action on a Desperate 1–3, a held mood and Auto, PANIC and Resume, Stop, a reload waits, Esc, no audio sent, fit at 1366/1536/390 (8601; starts its own demo night)'],
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
