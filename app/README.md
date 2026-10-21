# The page (`app/`)

The whole app as one static page with no build step: the character creator, the living
sheets, the table page, the schedule and the prints. It started as the single-page creator
prototype from `docs/history/PLAN.md` and is built on the Blades '68 Design System's figure kit 3. It
runs as a claude.ai artifact or on the hosted build (a Cloudflare Worker, see `HOSTING.md`);
storage, identity and downloads always go through `window.claude.use(...)`.

- `index.html` is the page: markup, theme tokens, the `@font-face` rules and the script
  order. It holds the header (wordmark, the view's name, Home · The table · Your sheet), Home
  (`#home`, with the "Characters" list and the backups), the creator studio and the crew line-up, the
  empty roots the modules render into (`#nextSession`, `#dossier`, `#table-page`, `#season`),
  the toast region, the restore preview dialog and, in the footer, the Auto / Paper / Night switch
  (an inline script at the top applies the saved choice before the first paint; CAMPAIGN.md, *Page*).
- `routes.js` says which files each route needs: index.html loads the core (the sheet, rules and cast every sheet uses),
  and `B68Load.need('table' | 'print' | 'gm' | 'display')` adds a route's bundle on first use, scripts in order. It also
  holds the build stamp (`B68_BUILD`, 'dev' in the repository; `npm run deploy` stamps it) that the service worker and
  `/api/me` share, which is how an open page knows to offer "Updated: reload".
- `content.js` is the rulebook's character creation content, transcribed from the
  Characters chapter and all twelve playbook sheets (eight core, plus Ghost/Echo, Vampire and
  the two Time Travelers).
- `core.js` holds state, the control factory and drawing; `steps.js` the sixteen creation
  steps; `boot.js` Home (the start page, drawn from the viewer's role, the table and their
  characters), the modes, hash routes and Back, the creator's draft, filing to the shared `characters` collection
  (field-level saves), the roster with its Cards / Table views, JSON backup and restore (the
  characters and the table's campaign document, with a preview before a restore writes; CAMPAIGN.md, *Backups*), the
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
- `cast-page.js` and `cast.css` are the cast (`#cast`, `#cast/<id>`, the GM's editor) and the "on stage" banner shown on every
  screen; `figures/npcs.js` holds the seven starting NPCs (`CAST.md`).
- `gm-page.js` and `gm.css` are the GM's page (`#gm`), and `display-page.js` and `display.css` the iPad's full-screen display
  (`#display`); both are hosted-build only (`GM.md`). `gm/` holds the pure logic behind them, one UMD module each, with no DOM,
  storage or table text (the tables arrive from the GM's pack): `console.js` (the console and its situations), `location.js`
  (the location generator and map data), `scenes.js` (street scenes), `score.js` (the score generator), `npc.js` with
  `figure-map.js` (the NPC generator and its figure map: the NPC tab on `#gm`, and the sync), `prep.js` (the Prep tab),
  `downtime.js` (the Downtime tab's cards), and `chase.js` (the Chase tab: what the map kit's chase strip is given, the clocks read back,
  and what the players may see of a chase). `downtime-tables.js` holds those cards' tables (`B68DowntimeTables`): original writing
  with no book text, public like `content.js`, and outside `gm/` because it names the setting; a pack part may be laid over them.
- `ambient/` holds the scenes the display plays when nothing is spotlit: four designer pages as delivered and two data-free
  score shells (`planning-board`, `score-exploded`) that draw what the display sends them. `_headers` lets only this origin frame
  them and blocks every network call from them (`GM.md`, "Ambient scenes").
- `runtime/cf.js` is the hosted build's `window.claude` adapter. It does nothing inside the
  artifact or from `file://`. `sw.js`, `manifest.webmanifest` and `icons/` make the hosted
  build installable and usable offline.
- `figures/` is the vendored figure kit and cast canon (figure kit 3.0.1); `maps/` is the vendored map kit (0.7.0, 21/10 build). `fonts/` holds the
  vendored fonts.
- `CONTRACT.md` documents the character document, the `play` shape and the module APIs.
- `checks/` holds Playwright checks that stub the artifact runtime and open `../index.html`
  from `file://`: `e2e.js` walks Home → file → sheet → Back → Home's files → sheet, then each
  Home state (GM set-up, GM table, a new player, a returning player, read only, no runtime,
  the draft), `pn-e2e.js` creates each
  paranormal playbook, `trackerpn.js` exercises every sheet control, `trackercheck.js` the
  core sheet, `dice.js` the roll panel, `session.js` end of session and downtime, `table.js`
  the roster table and backups (both runtimes' formats, GM and player, the restore preview), `printcheck.js` renders the print PDFs, `campaign.js` the
  table page, `crewsheet.js` the crew sheet, `schedule.js` the schedule and `season.js` the
  season print. Run one with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node <name>.js`
  (from any directory); output goes to `checks/out/`, which is not committed.

Opened from `file://` the creator works, but there is no filing or saving. For the full app
run `npm run dev` at the repository root (see the root `README.md`).
