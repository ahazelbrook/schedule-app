# Blades '68: the table app

A private web app for one Blades '68 group. Players make a character in the creator, file it,
and keep it on a living sheet during play (stress, harm, xp, keys, dice, end of session,
downtime). The table page holds what the group shares: the crew sheet, shared clocks, the
session number, the players, the campaign log, and the schedule (dates, availability, the
RSVP board). Everything can be printed, one sheet at a time or the whole season at once.

The app is a plain HTML/JS page in `app/` with no build step. It reaches storage, identity
and downloads through `window.claude.use('db' | 'user' | 'downloads')`, so the same page runs
two ways:

- **As a claude.ai artifact.** The platform provides `window.claude`.
- **Hosted as a Cloudflare Worker** at `https://blades.fieldguide.help`, behind Cloudflare
  Access: the Worker serves the page and a small JSON API on a D1 database.
  `app/runtime/cf.js` provides the same `window.claude` interface on top of that API, and adds
  offline use and home-screen install. `SETUP.md` deploys it (`scripts/deploy.sh`).

## Repository layout

```
app/                 the page (the Worker's static assets; app/.assetsignore keeps checks/ and *.md out)
  index.html         markup, theme tokens, fonts, script order
  boot.js            modes and routes, filing characters, the roster, backups (characters and the table), the table and print modes
  core.js steps.js   creator state, drawing, and the sixteen creation steps
  content.js         character creation content for the twelve playbooks
  zoom.js            zoom and pan on the creator's stage
  tracker.js/.css    the living character sheet, dice, session and downtime, single-sheet print
  campaign.js/.css   the table page (#t): session bar, crew, clocks, players, log
  crews.js           the six crew playbooks
  crewsheet.js/.css  the full crew sheet on the table page
  schedule.js/.css   the next-session card and the schedule box (grid, RSVP board, attendance)
  season.js/.css     the season print (#print)
  cast-page.js, cast.css   the cast (#cast) and the "on stage" banner (CAST.md)
  gm/, gm-page.js, gm.css  the GM's page (#gm): the console (situations and the nine classic rollers), the location generator and map, street scenes, the engagement roll, the NPC generator, capture (GM.md); gm/ also holds the NPC generator's logic and figure map, which the sync uses too
  display-page.js, display.css   the iPad's full-screen display (#display, GM.md)
  figures/           the vendored figure kit (v2) and cast
  maps/              the vendored map kit (B68Map): a location roll drawn as a rings, plan, iso or section SVG
  fonts/ icons/      vendored fonts; install icons
  runtime/cf.js      the hosted build's window.claude adapter
  sw.js, manifest.webmanifest   offline and install (hosted build only)
  checks/            Playwright page checks (file://, with a stubbed window.claude)
worker/              the Worker: routes /api/* to functions/, serves the page with its doctype and viewport
functions/           the /api/* handlers (Pages Functions layout, called by worker/app.js)
  _lib/              auth (Access JWT), characters, campaign rules, D1 helpers
migrations/          D1 migrations (the statements of schema.sql)
scripts/             deploy.sh (D1, Access, secrets, deploy, smoke test) and access-emails.sh; the GM's local tools gm-pack.mjs
                     (build the pack from the vault), gm-sync.mjs (pull/push between the app and the vault, SYNC.md) and
                     gm-parity.mjs (the ports against the vault's own pages)
checks/
  api/               API checks (JWT unit test, the Worker and its config, end-to-end flow against wrangler dev)
  runtime/           adapter and PWA unit tests, offline, schedule and phone end-to-end runs, icon builder
schema.sql           D1 tables (the whole schema; migrations/ applies it)
wrangler.toml        the Worker: assets, the custom domain, the D1 binding, dev settings
```

## Running it locally

```
npm install
npm run db:local     # apply the migrations to the local D1 (optional: the API also creates the tables on first use)
npm run dev          # wrangler dev on http://127.0.0.1:8788, signed in as gm@example.test (a GM)
```

There is no Access in front locally: the `DEV_USER` binding in the `dev` script stands in
for the signed-in person (only on a local address: the deployed Worker ignores it). Opening `app/index.html` from `file://` also works for the creator,
but the adapter stays off there, so there is no filing, no table page data and no saving.

## Checks

The npm scripts (from the repository root):

| Script | What it runs |
|---|---|
| `npm run check:api` | `checks/api/npcs.mjs` (the cast: the seeds, who sees what, writes, validation, the scene rule), `checks/api/jwt.mjs` (Access token verification), `checks/api/worker.mjs` (the router, the DEV_USER guard, the page head, the deploy config), `checks/api/flow.mjs` (the whole API against its own `wrangler dev` on ports 8788 and 8789, so stop `npm run dev` first), `checks/api/rules.mjs`, `checks/api/gm.mjs` (the GM-only API and its secrecy), `checks/api/name.mjs` (the display name, `PATCH /api/me`) and `checks/api/display-role.mjs` (the `DISPLAY_EMAILS` role: two calls and a 403 for everything else; also `npm run check:display-role`) |
| `npm run check:runtime` | `checks/runtime/adapter.test.mjs` (the adapter, offline cases included), `checks/runtime/pwa.test.mjs` (manifest, icons, the service worker), `markdown.test.mjs` and `gm-nosecrets.test.mjs` (no GM table text in the public code; the GM page's display gate; also `npm run check:gm-secrets`), then the GM modules against invented fixtures: `gm-logic`, `gm-page`, `gm-figure`, `gm-npc`, `gm-sync`, `gm-scenes` and `gm-engagement` (`.test.mjs`) |
| `npm run check:e2e` | `app/checks/e2e.js`: the Home page in each state, filing a character, the sheet, the files and browser Back, against the stubbed runtime. With `E2E_URL=http://127.0.0.1:8788` it runs against `npm run dev` instead |
| `npm run check:offline` | `checks/runtime/offline.e2e.mjs`: install, offline reload and sync on reconnect, on its own server (port 8790) |
| `npm run check:schedule` | `checks/runtime/schedule.e2e.mjs`: the schedule against a real local server (port 8791) |
| `npm run check:phone` | `checks/runtime/phone.e2e.mjs`: a 390 px mobile Chromium against its own server (port 8792): device width, standards mode, no horizontal overflow |
| `npm run check:cast` | `checks/runtime/cast.e2e.mjs`: the cast end to end against its own server (port 8842), a GM and a player in two browser contexts, and at 360 px; then `cast.artifact.e2e.mjs`: the same in the artifact's runtime (a stubbed db) |
| `npm run check:gm` | `checks/runtime/gm.e2e.mjs`: the GM page and the display wiring against its own server (port 8845) with invented fixture tables: importing a pack, the keys, replay on reload, capture, the location map (only the player layer reaches the display), the cast to the iPad, the phone and iPad layouts, a player's view |
| `node checks/runtime/gm-scenes.e2e.mjs`, `gm-npc-panel.e2e.mjs`, `display-role.e2e.mjs` | the Street and Engage panels, the NPC generator panel (a roll, reload, Earlier, Add to the cast and the seed the sync replays) and the iPad's display-only sign-in in a browser; no npm script, run them directly (each starts its own server, ports 8857, 8858 and 8856) |
| `npm run build` | `wrangler deploy --dry-run`: bundles the Worker into `.wrangler/dist`, uploads nothing |
| `npm run icons` | rebuilds `app/icons/*` from the figure kit (`checks/runtime/icons.mjs`) |

`npm test` runs the two that need no browser, `check:runtime` and then `check:api` (stop
`npm run dev` first, since `check:api` uses port 8788).

The page checks in `app/checks/` load `app/index.html` from `file://` with a stubbed
`window.claude`. Run each one with:

```
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node app/checks/<name>.js
```

On Windows the browser checks run with `PW_MODULE` pointing at a Playwright install (a small wrapper that launches Edge
works when Chromium will not download), and the API checks start wrangler through a shell and stop it with `taskkill`.
A dev server left behind by an interrupted run (ports 88xx / 288xx) serves stale data to the next one: stop it first.

They change to their own directory first, so they run from anywhere, and write screenshots
and PDFs to `app/checks/out/` (not committed). Playwright is loaded from
`/opt/node-tools/node_modules/playwright`, or from `PW_MODULE` when set. The npm scripts that
drive a browser (`check:e2e`, `check:offline`, `check:schedule`, `check:phone`, `check:cast`, `check:gm`, `icons`) need the same
`PLAYWRIGHT_BROWSERS_PATH`.

| Check | Covers |
|---|---|
| `e2e.js` | Home states, file a character, open the sheet, the files, Back and drafts |
| `pn-e2e.js` | creating each paranormal playbook |
| `trackercheck.js` | the living sheet for the core playbooks |
| `trackerpn.js` | every sheet control for the paranormal playbooks, and printing |
| `printcheck.js` | the single-sheet print PDFs |
| `dice.js` | the roll panel |
| `session.js` | end of session and downtime on the sheet |
| `table.js` | the roster's Table view and the JSON backups: the table in the download (a player's without hidden clocks), restoring each file format, the table restored by the GM only after a confirm, the hosted GM's "Download everything" |
| `campaign.js` | the table page |
| `crewsheet.js` | the crew sheet for all six crews |
| `schedule.js` | the schedule box, the next-session card, RSVP board, attendance, copied reminder and date poll |
| `season.js` | the season print (A4 and Letter PDFs) |

## Docs

- `SETUP.md`: deploying the hosted app (`scripts/deploy.sh`, the Access dashboard steps, an
  optional API token), adding players, backups, phones.
- `DEPLOY-PROMPT.md`: the same, as a prompt for a Claude session on your own computer.
- `HOSTING.md`: the hosted build's contract: the Worker, Access sign-in, the API, the adapter,
  offline, install.
- `CAMPAIGN.md`: the shared campaign document, the table page, the crew sheet, the season print.
- `SCHEDULE.md`: the schedule: the document, permissions, the card and the schedule box.
- `CAST.md`: the cast: NPC portraits, who sees what, "on stage".
- `GM.md`: the GM's tools: the pack, the GM-only API, the `#gm` page and the `#display` iPad view, and the display-only sign-in.
- `SYNC.md`: the two-way sync between the app and the GM's Obsidian vault (`npm run gm:pull`, `gm:push`, `gm:sync`).
- `app/CONTRACT.md`: the character document, the living sheet's `play` shape, the module APIs.
- `app/README.md`: the files in `app/`.
- `DEPLOY.md`: deployment status, and the original deployment plan.
- `PLAN.md`: the original product plan, with a status section mapping it to what was built.
- `RESEARCH.md`: the build-or-buy research on scheduling tools that came before all of this.

The full rulebook text is intentionally not kept in this repository. `app/content.js` and
`app/crews.js` hold only what the sheets need.
