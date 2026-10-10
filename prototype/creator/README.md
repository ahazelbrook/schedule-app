# Blades '68 Character Creator (prototype)

A single-page prototype of the character creator from `PLAN.md`, built on the Blades '68 Design System's figure kit v2. It is published as a claude.ai artifact; the fonts are served from there and are not vendored here.

- `index.html` is the page: the creator studio, the crew line-up, and "Your files".
- `content.js` is the rulebook's character creation content, transcribed from the Characters chapter and the eight playbook sheets.
- `core.js` holds state, the control factory and drawing; `steps.js` the sixteen creation steps; `boot.js` navigation, filing to the shared `characters` collection, the roster, modes and routing.
- `zoom.js` adds zoom and pan on the stage (wheel, drag, pinch, and a Face button that frames the head).
- `tracker.js` and `tracker.css` are the living character sheet: every track from the printed playbook sheet, saved to the artifact database on each change.
- `CONTRACT.md` documents the character document, the `play` shape and the module APIs.
- `figures/` is the vendored figure kit and cast canon (kit v2.0.0).
- `e2e-check.js` is a Playwright check that stubs the artifact runtime and walks file → sheet → roster → sheet.

Open `index.html` from a local web server to run it without filing and file saving.
