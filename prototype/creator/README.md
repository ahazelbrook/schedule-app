# Blades '68 Character Creator (prototype)

A single-page prototype of the character creator from `PLAN.md`, built on the Blades '68 Design System's figure kit v2.

- `index.html` is the page (published as a claude.ai artifact; the fonts are served from there and are not vendored here).
- `content.js` is the rulebook's character creation content, transcribed from the Characters chapter and the eight playbook sheets.
- `core.js` holds state, the control factory and drawing; `steps.js` the sixteen steps; `boot.js` navigation, the crew line-up, the shared roster and exports.
- `figures/` is the vendored figure kit and cast canon (kit v2.0.0).

Open `index.html` from a local web server to run it without the shared roster and file saving.
