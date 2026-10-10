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
- **Hosted on Cloudflare Pages**, behind Cloudflare Access, with a small API in Pages
  Functions on a D1 database. `app/runtime/cf.js` provides the same `window.claude` interface
  on top of that API, and adds offline use and home-screen install.

## Repository layout

```
app/                 the page (this is what Pages serves)
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
  figures/           the vendored figure kit (v2) and cast
  fonts/ icons/      vendored fonts; install icons
  runtime/cf.js      the hosted build's window.claude adapter
  sw.js, manifest.webmanifest   offline and install (hosted build only)
  checks/            Playwright page checks (file://, with a stubbed window.claude)
functions/           Cloudflare Pages Functions: the /api/* endpoints
  _lib/              auth (Access JWT), characters, campaign rules, D1 helpers
checks/
  api/               API checks (JWT unit test, end-to-end flow against wrangler)
  runtime/           adapter and PWA unit tests, offline and schedule end-to-end runs, icon builder
schema.sql           D1 tables
wrangler.toml        Pages project and D1 binding
```

## Running it locally

```
npm install
npm run db:local     # create the tables in the local D1 (optional: the API also creates them on first use)
npm run dev          # wrangler pages dev on http://127.0.0.1:8788, signed in as gm@example.test (a GM)
```

There is no Access in front locally: the `DEV_USER` binding in the `dev` script stands in
for the signed-in person. Opening `app/index.html` from `file://` also works for the creator,
but the adapter stays off there, so there is no filing, no table page data and no saving.

## Checks

The npm scripts (from the repository root):

| Script | What it runs |
|---|---|
| `npm run check:api` | `checks/api/jwt.mjs` (Access token verification) and `checks/api/flow.mjs` (the whole API against its own `wrangler pages dev` on ports 8788 and 8789, so stop `npm run dev` first) |
| `npm run check:runtime` | `checks/runtime/adapter.test.mjs` (the adapter, offline cases included) and `checks/runtime/pwa.test.mjs` (manifest, icons, the service worker) |
| `npm run check:e2e` | `app/checks/e2e.js`: file, sheet, roster and back, against the stubbed runtime. With `E2E_URL=http://127.0.0.1:8788` it runs against `npm run dev` instead |
| `npm run check:offline` | `checks/runtime/offline.e2e.mjs`: install, offline reload and sync on reconnect, on its own server (port 8790) |
| `npm run check:schedule` | `checks/runtime/schedule.e2e.mjs`: the schedule against a real local server (port 8791) |
| `npm run icons` | rebuilds `app/icons/*` from the figure kit (`checks/runtime/icons.mjs`) |

`npm test` runs the two that need no browser, `check:runtime` and then `check:api` (stop
`npm run dev` first, since `check:api` uses port 8788).

The page checks in `app/checks/` load `app/index.html` from `file://` with a stubbed
`window.claude`. Run each one with:

```
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node app/checks/<name>.js
```

They change to their own directory first, so they run from anywhere, and write screenshots
and PDFs to `app/checks/out/` (not committed). Playwright is loaded from
`/opt/node-tools/node_modules/playwright`, or from `PW_MODULE` when set. The npm scripts that
drive a browser (`check:e2e`, `check:offline`, `check:schedule`, `icons`) need the same
`PLAYWRIGHT_BROWSERS_PATH`.

| Check | Covers |
|---|---|
| `e2e.js` | file a character, open the sheet, the roster, back to the sheet |
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

- `SETUP.md`: putting the hosted app on Cloudflare (dashboard steps), phones, backups.
- `HOSTING.md`: the hosted build's contract: Access sign-in, the API, the adapter, offline, install.
- `CAMPAIGN.md`: the shared campaign document, the table page, the crew sheet, the season print.
- `SCHEDULE.md`: the schedule: the document, permissions, the card and the schedule box.
- `app/CONTRACT.md`: the character document, the living sheet's `play` shape, the module APIs.
- `app/README.md`: the files in `app/`.
- `DEPLOY.md`: deployment status, and the original deployment plan.
- `PLAN.md`: the original product plan, with a status section mapping it to what was built.
- `RESEARCH.md`: the build-or-buy research on scheduling tools that came before all of this.

The full rulebook text is intentionally not kept in this repository. `app/content.js` and
`app/crews.js` hold only what the sheets need.
