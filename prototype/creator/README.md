# Blades '68 Character Creator (prototype)

A single-page prototype of the character creator from `PLAN.md`, built on the Blades '68 Design System's figure kit v2. It is published as a claude.ai artifact; the fonts are served from there and are not vendored here.

- `index.html` is the page: the creator studio, the crew line-up, and "Your files".
- `content.js` is the rulebook's character creation content, transcribed from the Characters chapter and all twelve playbook sheets (eight core, plus Ghost/Echo, Vampire and the two Time Travelers).
- `core.js` holds state, the control factory and drawing; `steps.js` the sixteen creation steps; `boot.js` navigation, filing to the shared `characters` collection, the roster with its Cards / Table views, JSON backup and restore, modes and routing.
- `zoom.js` adds zoom and pan on the stage (wheel, drag, pinch, and a Face button that frames the head).
- `tracker.js` and `tracker.css` are the living character sheet, with action, resistance and fortune rolls: every track from the printed playbook sheet (Drain, Instability, alluvium, irregularities, glitches, strictures, missions and the rest for the paranormal playbooks), saved to the artifact database on each change, with a print stylesheet behind the Print button.
- `CONTRACT.md` documents the character document, the `play` shape and the module APIs.
- `figures/` is the vendored figure kit and cast canon (kit v2.0.0).
- `checks/` holds Playwright checks that stub the artifact runtime: `e2e.js` walks file → sheet → roster → sheet, `pn-e2e.js` creates each paranormal playbook, `trackerpn.js` exercises every sheet control, `dice.js` the roll panel, `table.js` the GM table and backups, `trackercheck.js` the core sheet, and `printcheck.js` renders the print PDFs. They expect the scripts to sit one directory up (`../shots` paths in the scratchpad become `..` here).

Open `index.html` from a local web server to run it without filing and file saving.
