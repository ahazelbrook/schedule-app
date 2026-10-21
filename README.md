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

## The four commands

From the repository root (on Windows, in Git Bash: SETUP.md):

| Command | What it does |
|---|---|
| `npm run dev` | the app on this computer at `http://127.0.0.1:8788`, signed in as a GM (no Access in front) |
| `npm test` | every check that needs no browser: `check:runtime`, then `check:api` (a few minutes; stop `npm run dev` first, `check:api` uses its port) |
| `npm run deploy` | puts the committed app live (SETUP.md, *Updating the app*): it stops on uncommitted changes or a missing media file, applies the migrations, and ends with a receipt |
| `npm run gm:sync` | on the GM's PC: what happened at the table into the vault, and the vault's NPCs and pack back to the app (SYNC.md). The vault is `B68_VAULT`, by default `C:/Vault/Hazel Second Brain` (also for `gm:pack`, `gm:pull`, `gm:push`, `gm:transcript`, `gm:after`) |

> [!IMPORTANT]
> **Before a deploy.** Two files are not in git and go up from this disk: `app/media/theme.mp3` (the
> opening credits' theme) and `app/ambient/calling-cards.html` (the calling-cards scene, built by
> `node tools/ambient/scenes/cards.js` from `tools/ambient/cards/*.jpg`). Without them `npm run deploy`
> stops, because a deploy uploads `app/` as it is and the live site would lose them. The handout images
> (`app/media/handouts/`, also git-ignored) go up the same way: run `npm run gm:handouts` on the deploying PC first (GM.md, "Handouts").
> Two secrets are never set by the deploy script and stay as they are on Cloudflare: `DISPLAY_EMAILS`
> (the table iPad's own sign-in) and `DEEPGRAM_API_KEY` (the iPad's transcriber). Set each once with
> `npx wrangler secret put <NAME>` (GM.md). The deploy's receipt shows all four.

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
  gm/, gm-page.js, gm.css  the GM's page (#gm): the console (the four situations, the nine single tables folded under the card), the location generator and map, street scenes, the score generator, the chase board, the NPC generator, capture (GM.md); gm/ also holds the NPC generator's logic and figure map, which the sync uses too
  display-page.js, display.css   the iPad's full-screen display (#display, GM.md): the spotlight over an ambient scene
  ambient/, _headers  the ambient scenes the iPad plays when nothing is spotlit (GM.md, "Ambient scenes"), framed same-origin only
  figures/           the vendored figure kit (v2) and cast
  maps/              the vendored map kit (B68Map, 0.7.0): a location roll drawn as a rings, plan, iso or section SVG, and the chase strip
  fonts/ icons/      vendored fonts; install icons
  runtime/cf.js      the hosted build's window.claude adapter
  routes.js          the build stamp (B68_BUILD) and the route bundles the page fetches on first use (table, print, gm, display)
  sw.js, manifest.webmanifest   offline and install (hosted build only)
  checks/            Playwright page checks (file://, with a stubbed window.claude)
worker/              the Worker: routes /api/* to functions/, serves the page with its doctype and viewport
functions/           the /api/* handlers (Pages Functions layout, called by worker/app.js)
  _lib/              auth (Access JWT), characters, campaign rules, D1 helpers
migrations/          D1 migrations (the statements of schema.sql)
scripts/             deploy.sh (D1, Access, secrets, deploy, smoke test) and access-emails.sh; the GM's local tools gm-pack.mjs
                     (build the pack from the vault), gm-sync.mjs (pull/push between the app and the vault, SYNC.md) and
                     gm-parity.mjs (the ports against the vault's own pages)
tools/ambient/       the designer's generator for the score scenes (make-score-scenes.js, shell.js, grain.js): reference only,
                     not deployed; the live score scenes are built in the browser (GM.md, "Ambient scenes")
checks/
  api/               API checks (JWT unit test, the Worker and its config, the deploy script, end-to-end flow against wrangler dev)
  runtime/           unit tests (the adapter, the PWA and routes.js, the GM modules), the browser runs, icon builder
  e2e-all.mjs        every browser check in turn (npm run check:e2e-all)
docs/history/        plans and research that led here (PLAN, RESEARCH, ROADMAP, the deployment plan, the ambient plan,
                     the deploy prompt): kept as written, not kept current
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
| `npm test` | `check:runtime`, then `check:api`: no browser |
| `npm run check:runtime` | 25 unit tests in plain node (`checks/runtime/*.test.mjs`): `adapter` (the adapter, offline cases included), `pwa` (manifest, icons, the service worker, `routes.js` and its bundles), `markdown`, `display` (the display's sanitiser and poller), `gm-nosecrets` (no GM table text in the public code; also `npm run check:gm-secrets`), then the GM modules against invented fixtures: `gm-logic`, `gm-location`, `gm-page`, `gm-figure`, `gm-npc`, `gm-sync`, `gm-scenes`, `gm-score`, `gm-score-export`, `gm-chase`, `gm-prep`, `gm-screen`, `stt`, `ambient-assets`, `ambient-shells`, `gm-after`. The two figure sweeps roll 100 seeds (`B68_SWEEP`) |
| `npm run check:sweep` | `gm-figure` and `gm-npc` with the full 500-seed sweeps |
| `npm run check:api` | `checks/api/jwt.mjs` (Access token verification), `worker.mjs` (the router, the DEV_USER guard, the page head, the build stamp, the deploy config and line endings), `deploy.mjs` (the deploy script for real in a throwaway git copy: its refusals, a dry run and its receipt, the build stamp put back; also `npm run check:deploy`), `flow.mjs` (the whole API against its own `wrangler dev` on ports 8788 and 8789, so stop `npm run dev` first), `clocks.mjs` (the shared clocks under concurrent writes: ticks of different clocks all land, the previous release's whole arrays, port 8788; also `npm run check:clocks`), `rules.mjs`, `npcs.mjs` (the cast), `gm.mjs` (the GM-only API and its secrecy), `name.mjs` (the display name, `PATCH /api/me`) and `display-role.mjs` (the `DISPLAY_EMAILS` role: six calls and a 403 for everything else) |
| `npm run check:e2e-all` | every browser check below, one after another, then a summary (`checks/e2e-all.mjs`; `node checks/e2e-all.mjs gm offline` runs only those). Each starts its own server where it needs one |
| `npm run check:e2e` | `app/checks/e2e.js`: the Home page in each state, filing a character, the sheet, the files and browser Back, against the stubbed runtime. With `E2E_URL=http://127.0.0.1:8788` it runs against `npm run dev` instead |
| `npm run check:offline` | `checks/runtime/offline.e2e.mjs`: install, offline reload, a lazily loaded route offline, and sync on reconnect, on its own server (port 8790) |
| `npm run check:schedule` | `checks/runtime/schedule.e2e.mjs`: the schedule against a real local server (port 8791) |
| `npm run check:phone` | `checks/runtime/phone.e2e.mjs`: a 390 px mobile Chromium against its own server (port 8792): device width, standards mode, no horizontal overflow |
| `npm run check:rules` | `checks/runtime/rules.e2e.mjs`: the rules wiki (port 8795) |
| `npm run check:clocks-e2e` | `checks/runtime/clocks.e2e.mjs`: two players' phones and the GM's laptop tick, rename, add and remove clocks from stale copies, against its own server (port 8797); every change lands |
| `npm run check:cast` | `checks/runtime/cast.e2e.mjs`: the cast end to end against its own server (port 8842), a GM and a player in two browser contexts, and at 360 px; then `cast.artifact.e2e.mjs`: the same in the artifact's runtime (a stubbed db) |
| `npm run check:gm` | `checks/runtime/gm.e2e.mjs`: the GM page and the display wiring against its own server (port 8845) with invented fixture tables: Home fetching none of the GM's files, importing a pack, the keys, replay on reload, capture, the location map (only the player layer reaches the display), the cast to the iPad, the phone and iPad layouts, a player's view and the pack purge |
| `npm run check:stt`, `npm run check:display-ambient` | the iPad's transcriber with a fake microphone (port 8847), and the ambient floor in a browser (port 8871): the spotlight covers and clears it, rotation, pin, skip, lights out, heat and wanted to the City Watch feed, the score scenes, same-origin requests only |
| `node checks/runtime/gm-scenes.e2e.mjs`, `gm-npc-panel.e2e.mjs`, `gm-score.e2e.mjs`, `gm-chase.e2e.mjs`, `gm-prep.e2e.mjs`, `display-role.e2e.mjs` | the Street panel, the NPC generator panel, the Score panel, the Chase panel and the iPad drawing its strip, the prep view and the iPad's display-only sign-in in a browser, with its request budget (the 4 s and 15 s beats, no call of its own for the transcriber, the reload after ten minutes signed out; ports 8857, 8858, 8859, 8861, 8846 and 8856; all in `check:e2e-all`) |
| `npm run check:ambient` | the ambient scene files (no outside URLs, the `_headers` rules; also in `check:runtime`) |
| `npm run build` | `wrangler deploy --dry-run`: bundles the Worker into `.wrangler/dist`, uploads nothing |
| `npm run icons` | rebuilds `app/icons/*` from the figure kit (`checks/runtime/icons.mjs`) |

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
drive a browser (`check:e2e-all` and every `check:` script above that names a port, `check:e2e`, `icons`) need the same
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

- `SETUP.md`: deploying and updating the hosted app (`npm run deploy`, the Access dashboard steps, an
  optional API token), what is live (*Status*), adding players, backups, phones.
- `HOSTING.md`: the hosted build's contract: the Worker, Access sign-in, the API, the lazy bundles
  and the build stamp, the adapter, offline, install.
- `CAMPAIGN.md`: the shared campaign document, the table page, the crew sheet, the season print.
- `SCHEDULE.md`: the schedule: the document, permissions, the card and the schedule box (parked until
  Nov/Dec 2026: the dates live in Google Calendar).
- `CAST.md`: the cast: NPC portraits, who sees what, "on stage".
- `RULES.md`: the rules wiki: the import from the GM's PC, search, house rules.
- `GM.md`: the GM's tools: the pack, the GM-only API, the `#gm` page and the `#display` iPad view, the
  ambient scenes, listening, and the display-only sign-in.
- `SYNC.md`: the two-way sync between the app and the GM's Obsidian vault (`npm run gm:pull`, `gm:push`, `gm:sync`).
- `app/CONTRACT.md`: the character document, the living sheet's `play` shape, the module APIs.
- `app/README.md`: the files in `app/`.
- `docs/history/`: how it got here, kept as written: `PLAN.md` (the original product plan),
  `RESEARCH.md` (build or buy, before all of this), `DEPLOY.md` (the deployment plan),
  `DEPLOY-PROMPT.md` (the first deploy as a prompt for a local Claude session), `ROADMAP.md` (names,
  calendar, cast, rules; what landed is on its first line) and `AMBIENT-PLAN.md` (the ambient scenes'
  build plan).

The full rulebook text is intentionally not kept in this repository. `app/content.js` and
`app/crews.js` hold only what the sheets need.
