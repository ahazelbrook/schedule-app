# Plan: shipping the Blades '68 app for weekly play

What the group needs on a game night: open one link on a phone or laptop, see your own
character exactly as you left it last week (stress, harm, xp, keys, stacks, clocks), tick
things off during play, and have the GM see everyone at a glance. The prototype (then in
`prototype/creator/`, now `app/`) already did all of that inside a claude.ai artifact. This
plan is about turning it into something the table opens every week without thinking about it.

## Status (updated)

The hosted build is **one Cloudflare Worker + Access + D1** at `https://blades.fieldguide.help`
(a subdomain of the domain you already have on Cloudflare; the apex and `www` are left alone),
instead of GitHub Pages + Firebase: Access gives emailed one-time codes (and Google, when you
add it) with an allowlist and no sign-in code of our own. It started as a Pages project and
moved to a Worker with static assets, so one deploy carries the page, the API, the custom
domain and the secrets. `SETUP.md` has the deploy (`scripts/deploy.sh`, then a few Access
steps in the dashboard); `DEPLOY-PROMPT.md` is that procedure as a prompt for a local Claude
session; `HOSTING.md` the Worker, API and adapter contract; `CAMPAIGN.md` the campaign layer; `SCHEDULE.md` the schedule;
the root `README.md` the repository layout, local runs and checks. The same page still runs as the claude.ai
artifact.

| Phase | State |
|---|---|
| 0. Table features on the artifact (dice, GM table, backups) | Done |
| 1. Repository, hosting, sign-in, API, adapter, field-level saves | Done and live at https://blades.fieldguide.help since 13/10/2026 (first deploy: `scripts/deploy.sh` plus the Access dashboard steps, `SETUP.md`) |
| 2. Campaign layer: the six crew sheets, shared clocks, session number, players, log | Done |
| 3. Night-of-play: end of session, downtime | Done (session wrap-up and downtime on each sheet) |
| 3. Night-of-play: schedule (next-session card, availability grid, RSVP, calendar) | Done (`SCHEDULE.md`) |
| 3. Schedule, second round: the RSVP board (the crew line-up coloured by each owner's answer), attendance recorded when the GM starts a session and correctable by the GM, the "missed N" streak and the best-date tie-break, the "Are you in?" nudge within 3 days, GM "Copy reminder" and "Copy date poll" | Done (`SCHEDULE.md`) |
| Sign-in on a phone | **Fixed 15/10/2026.** The cause was a second Worker, `schedule-app` (a Workers Builds link to this repository), which owned `blades.fieldguide.help` without the Access secrets. Its Git link is disconnected and `npx wrangler deploy` moved the domain back to `blades68`. Left to do: delete the `schedule-app` Worker in the dashboard. A 401 still names its `reason` (PR #8). |
| 3. Reminders by Discord, email or push | Not built: the app sends no mail (a Worker could run them on a cron trigger, but nothing does yet); the nudge on the card and the copied reminder for the group chat stand in |
| 4. Installable, offline reading and queued saves | Done (hosted build only) |
| 5. The rules wiki and the cast (NPC portraits, "on stage") | Done and live (`RULES.md`, `CAST.md`) |
| 6. GM tools: the `#gm` console (situations and classic), location generator and map, street scenes, engagement roll, capture, the `#display` iPad view, a display name for everyone | Done and live since 14/10/2026 and 15/10/2026 (`GM.md`). The NPC generator panel in the NPC tab is new on 15/10/2026 (`GM.md`) |
| 6. GM sync: what happened at the table into the vault, the vault's NPC cards and the pack back to the app | Done (`SYNC.md`; runs on the GM's PC) |
| 6. Ambient scenes on the iPad: a scene plays under the spotlight when nothing is shown (auto / pin / off, lights out), the iPad panel (`I`) on `#gm`, heat and wanted to the City Watch feed, score scenes from the current roll | Done and live since 15/10/2026 (`GM.md`, "Ambient scenes"; migration 0006). Not yet tried on the real iPad |
| 6. A display-only sign-in for the iPad (`DISPLAY_EMAILS`) | Built and deployed, switched off: the iPad uses the GM's own email (`GM.md`) |
| 4. Season print: every character and the crew in one printable document (`#print`, "Print the season" on the table page) | Done (`CAMPAIGN.md`, "Season print") |
| 4. Backups | Done, without a nightly job (none scheduled; `npx wrangler d1 export` makes a full copy by hand): "Download all (JSON)" in the app (the characters and the table page's campaign document; a player's copy leaves out hidden clocks), "Restore (JSON)" (characters as new files for anyone; the table for the GM only, after a confirm; it reads both that file and `/api/export`), the GM's "Download everything" on the hosted build (`/api/export`: characters, campaign, members), and D1 Time Travel (7 days of point-in-time restore on the free plan, 30 on Workers Paid) |

All four decisions below are settled. Fonts (3): keep GT America. All four families are
vendored in `app/fonts/` and the hosted build serves them behind Access; the site is private
and non-commercial. Decisions 1 and 2: both A and B exist, and sign-in is Cloudflare Access (Google
or an emailed code). For decision 4: the full rulebook text is not kept in the repository;
`app/content.js` and `app/crews.js` hold only what the sheets need. The character creator in
`app/` is the prototype's; a new creator is being built separately.

**Redeploys.** After the first deploy, a release is: merge to `main`, `npx wrangler d1 migrations apply DB --remote` (only
when `migrations/` has a new file; note `npx wrangler d1 time-travel info <database>` first for a restore point), then
`npx wrangler deploy`. `scripts/deploy.sh` is for the first deploy and for changing who is allowed in: it rewrites the
Access allow policy and needs the player list. Then `npm run gm:pack` and `npm run gm:push -- --only pack --yes` (or
Import GM pack on `#gm`). Not on a game day.

The sections below are the original plan, kept for reference.

## 0. Where we are

The prototype is a plain HTML/JS page with no build step. It talks to storage through a
tiny interface (`claude.use('db')`, `claude.use('user')`, `claude.use('downloads')`) whose
shape is Firestore's: `collection().doc().set()/get()/update()/delete()`, `onSnapshot`,
`where/orderBy/limit`. Characters live in one `characters` collection as whole documents
(`v: 2`, `sheet`, `play`, `owner`, timestamps). Every click on the living sheet saves the
whole `play` object; other viewers get the change live.

That interface is the hinge of the whole plan: we keep the page as it is and swap what is
behind `claude.use`.

## 1. Two ways to "deploy", and the recommendation

| | A. The artifact, as is | B. Our own hosted app |
|---|---|---|
| Effort to go live | None: it is live now | About three working sessions |
| Who can open it | People you share it with from the artifact's Share menu (your claude.ai workspace or invited guests) | Anyone on an allowlist, with a normal sign-in |
| Saves | Already persistent, per account, live between viewers | Same, on a database we own |
| Phones | Works in the browser; no home-screen install | Installable (PWA), works offline for reading |
| Cost | Free | Free tier covers a game group many times over |
| Risks | Share permissions are per artifact; the owner's account is the single point of failure; no custom domain | Fonts licensing (below); we run it |

Recommendation: play on A starting next week, and build B in the background. Nothing done
on A is lost: the JSON backup and restore being added now is the migration path, and the
page code is identical on both.

What to do for A right now:

1. Share the artifact with each player as a Contributor (Viewers can read, not tick boxes).
2. Each player opens their sheet once and bookmarks its link (`#c/<id>`), which opens
   straight to their character.
3. The GM uses the Everyone filter and the Table view.
4. After each session, Download all (JSON) once as a backup.

## 2. The target for B

- **Hosting:** GitHub Pages from this repository (static files, free, HTTPS). Fallback:
  Cloudflare Pages. No server code.
- **Database and sign-in:** Firebase (Firestore + Auth) on the free Spark plan. Chosen
  because the prototype's storage calls are already Firestore-shaped, so the adapter is thin,
  and because `onSnapshot` gives the live table view for free. Sign-in with Google, with an
  email allowlist so only the group can get in. (Supabase is the alternative if we would
  rather have SQL; it costs an extra week because the live-update model differs.)
- **One app, three surfaces:** the creator, the living sheets, the GM table. Later the
  schedule from `PLAN.md` (who can make it this week) joins as a fourth tab on the same
  stack.
- **Installable:** a web manifest and a small service worker so it sits on the home screen
  and still opens the last-seen sheets with no signal.

## 3. Data model changes for weekly play

The document shape stays `v: 2` with two changes that matter once several people edit at
the table:

1. **Field-level writes.** Today a save replaces the whole `play` object. Two people
   touching the same character at the same moment (a player and the GM) would clobber each
   other. On Firestore we write only the changed path (`play.stress`, `play.keys.2.hits`)
   with `update`, and use `arrayUnion` for the session log.
2. **A `campaign` document** that holds the group: member emails and roles (player / GM),
   the active session number, and shared clocks. Characters get a `campaign` field so one
   deployment can serve more than one game.

Security rules: signed-in members read everything in their campaign; a player writes
characters they own; the GM writes all of them; nobody else reads anything.

## 4. Phases

### Phase 0: finish the table features (this week, on the artifact)
- Dice rolls, resistance and fortune rolls, with the push and desperate rules applied to the
  sheet and written to the session log. *(in progress)*
- GM table view with every character's status, and JSON backup and restore. *(in progress)*
- Play one session on it. Collect what was annoying.

### Phase 1: repository and static hosting (one session)
- Create a `main` branch and move the app to `app/` at the repository root.
- Fonts: vendor Archivo and Space Mono (both open licences). GT America is a commercial
  typeface and is only served inside the artifact; replace it with Inter or Archivo for the
  body text. Decide this once; it is the only licensing question in the project.
- GitHub Actions workflow that publishes `app/` to GitHub Pages on every push to `main`.
- A `runtime/` folder with two adapters behind `window.claude.use`: `artifact.js` (today's
  behaviour, nothing to do) and `firebase.js` (empty for now). The page picks one at load.

### Phase 2: Firebase adapter and sign-in (one session)
- Firebase project, Firestore in production mode, Google sign-in, the allowlist in a
  `campaigns/<id>` document.
- `firebase.js` implements the subset of the interface the page uses: `collection`, `doc`,
  `get`, `set`, `update`, `delete`, `onSnapshot` (per document and per query),
  `where/orderBy/limit`, `user.id()`, `user.can('data.write')`, and `downloads.save` as a
  plain browser download.
- Field-level saves in `tracker.js` (the `api.save(patch)` contract already takes a patch;
  the adapter turns dotted paths into `update`).
- Security rules as in section 3, with the Firestore emulator tests in `checks/`.
- Migrate: Download all (JSON) from the artifact, Restore into the new app.

### Phase 3: night-of-play features (one to two sessions)
- Session start and end: the end-of-session xp triggers as a checklist that marks xp;
  session number stamped on log entries.
- Downtime: indulge vice (roll, overindulge consequence), recover (healing clock ticks),
  long-term project clocks, acquire asset. These are all buttons on tracks that exist.
- Crew sheet when the crew playbook pages are available: tier, hold, reputation, heat,
  wanted level, crew clocks, cohorts; a crew page shared by all characters in the campaign.
- Schedule tab from `PLAN.md`: weekly availability, a "next session" card on the home
  screen.

### Phase 4: installable and resilient (half a session)
- Web manifest, icons from the figure kit, service worker caching the app shell and the last
  roster so sheets open with no signal (writes queue until it returns, which Firestore does
  by itself).
- Nightly Firestore export to a storage bucket, plus the in-app JSON backup.
- A `#print` of every character and the crew at the end of a season.

## 5. Costs and limits

| Item | Number |
|---|---|
| Firestore free tier | 1 GiB stored, 50k reads and 20k writes per day |
| A character document | about 30 KB; a season of logs stays under 100 KB |
| A four-hour session, six people, live view open | a few thousand reads, a few hundred writes |
| GitHub Pages | free for a public or private repository on a paid plan |
| Domain (optional) | about 12 USD a year |

## 6. Decisions needed from you

1. **A then B, or B only?** The recommendation is A now and B in the background.
2. **Sign-in:** Google accounts for everyone, or email magic links (works for anyone, one
   extra click each visit)?
3. **Body font:** replace GT America with Inter or Archivo (both free), or keep it only on
   the artifact.
4. **Repository visibility:** the figure kit and rulebook text are in this repository. If it
   is public, the transcribed rules text should move behind sign-in or be trimmed to what
   the sheets need.

## 7. First steps

1. Share the artifact with the group as Contributors and play on it this week.
2. Answer the four decisions above.
3. Phase 1 starts on a `main` branch; the deployed URL arrives at the end of that session.
