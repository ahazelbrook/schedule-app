# The page (`app/`)

The whole app as one static page with no build step: the character creator, the living
sheets, the table page, the schedule and the prints. It started as the single-page creator
prototype from `PLAN.md` and is built on the Blades '68 Design System's figure kit v2. It
runs as a claude.ai artifact or on the hosted build (Cloudflare Pages, see `HOSTING.md`);
storage, identity and downloads always go through `window.claude.use(...)`.

- `index.html` is the page: markup, theme tokens, the `@font-face` rules and the script
  order. It holds the creator studio, the crew line-up and "Your files", and the empty roots
  the modules render into (`#nextSession`, `#dossier`, `#table-page`, `#season`).
- `content.js` is the rulebook's character creation content, transcribed from the
  Characters chapter and all twelve playbook sheets (eight core, plus Ghost/Echo, Vampire and
  the two Time Travelers).
- `core.js` holds state, the control factory and drawing; `steps.js` the sixteen creation
  steps; `boot.js` the modes and hash routes, filing to the shared `characters` collection
  (field-level saves), the roster with its Cards / Table views, JSON backup and restore (the
  characters and the table's campaign document; CAMPAIGN.md, *Backups*), the
  table and print modes, and the one subscription to the campaign document.
- `zoom.js` adds zoom and pan on the stage (wheel, drag, pinch, and a Face button that frames
  the head).
- `tracker.js` and `tracker.css` are the living character sheet: every track from the printed
  playbook sheet, action, resistance and fortune rolls, end of session and downtime, and a
  print stylesheet behind the Print button.
- `campaign.js` and `campaign.css` are the table page (`#t`): session bar, crew, shared
  clocks, players and the campaign log (`CAMPAIGN.md`). `crews.js` holds the six crew
  playbooks and `crewsheet.js` / `crewsheet.css` draw the full crew sheet on that page.
- `schedule.js` and `schedule.css` are the next-session card at the top of every mode and the
  schedule box on the table page: dates, the availability grid, the RSVP board, attendance,
  and the GM's copied reminder and date poll (`SCHEDULE.md`).
- `season.js` and `season.css` are the season print (`#print`): every filed character and the
  crew in one printable document, opened from "Print the season" on the table page.
- `runtime/cf.js` is the hosted build's `window.claude` adapter. It does nothing inside the
  artifact or from `file://`. `sw.js`, `manifest.webmanifest` and `icons/` make the hosted
  build installable and usable offline.
- `figures/` is the vendored figure kit and cast canon (kit v2.0.0). `fonts/` holds the
  vendored fonts.
- `CONTRACT.md` documents the character document, the `play` shape and the module APIs.
- `checks/` holds Playwright checks that stub the artifact runtime and open `../index.html`
  from `file://`: `e2e.js` walks file → sheet → roster → sheet, `pn-e2e.js` creates each
  paranormal playbook, `trackerpn.js` exercises every sheet control, `trackercheck.js` the
  core sheet, `dice.js` the roll panel, `session.js` end of session and downtime, `table.js`
  the roster table and backups (both runtimes' formats, GM and player), `printcheck.js` renders the print PDFs, `campaign.js` the
  table page, `crewsheet.js` the crew sheet, `schedule.js` the schedule and `season.js` the
  season print. Run one with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node <name>.js`
  (from any directory); output goes to `checks/out/`, which is not committed.

Opened from `file://` the creator works, but there is no filing or saving. For the full app
run `npm run dev` at the repository root (see the root `README.md`).
