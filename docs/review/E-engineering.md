# Review E: engineering health (performance, robustness, security, maintainability, deploy)

Repo `/home/user/schedule-app` at `7fce4b9` (branch `ccr-e0dcd379-q104ac` = origin/main), 16 Oct 2026. Read-only review; nothing edited.
Baseline: `npm test` run once in the background on this commit: **467 PASS, 0 FAIL, exit 0, 198 s** (`check:runtime` alone 139 s;
`gm-figure.test.mjs` 62 s and `gm-npc.test.mjs` 59 s are 500-seed render sweeps). Log:
`/tmp/claude-0/-home-user-schedule-app/129e0dec-ffd1-5d8e-bbdf-0627b22952a4/scratchpad/review/npmtest.log`.
Experiments in the same folder: `hung-poll.mjs` (cf.js poller with one request that never settles), `md-fuzz.mjs` (3041 hostile
inputs through markdown.js).

## 1. Keep (well engineered)

- **Server write loops.** `functions/_lib/characters.js`, `campaign.js` (`writeCampaign`), `gm.js` (`patchState`, `patchAmbient`),
  `stt.js` (`patchStt`, which compares the stored *text*): read-modify-write with an optimistic `updated_at` guard, 5 attempts,
  then a 409 the adapter retries twice. PATCH semantics commute where it matters: `log` appends with dedup (`mergeLog`),
  per-person `schedule.avail/rsvp` maps, crew field by field.
- **Role gates.** `functions/api/_middleware.js` applies the display allow-list before any handler, body read or DB touch
  (`DISPLAY_ALLOWED` in `auth.js`); every `/api/gm/*` handler calls `requireGm` first; unknown `/api/gm/x` is 403 for a player and
  404 for the GM. `PATCH /api/me` (`cleanName`) refuses control/format characters, `<>`, > 40 chars; the row is always the
  caller's. `deepMerge` (`http.js:57`) skips `__proto__`, builds fresh objects, so `constructor`/`prototype` keys become harmless
  own properties (verified by reading; the GM state PATCH goes through it).
- **JWT verification** (`auth.js`): alg pinned to RS256, `kid` required, JWKS cached 1 h per isolate with a 10 s refetch gap for
  rotated keys, `iss`, `aud` (array or string), `exp`, `nbf` with 60 s leeway, `email` required. `DEV_USER` is dropped off
  loopback (`worker/app.js:95`), refused by `checks/api/worker.mjs` and deleted by `deploy.sh`.
- **The display path fails closed.** `checkSvg` (server) and `Pure.sanitiseSvg` (client, DOM-based, drops rather than repairs
  and rejects on parse error / no viewBox) agree on the rules; `rule` kind renders through `markdown.js` and then
  `cleanRuleTree` strips to inert tags. `markdown.js` escapes every text; the fuzz run (3041 inputs incl. `javascript:` with
  control chars, `&colon;`, nested quotes, `<a id>` markers, callouts) produced no tag leak, no event attribute, no scheme link.
- **Offline design** (`app/runtime/cf.js`): per-user snapshot + ordered write queue in localStorage, idempotent writes,
  multi-tab claims, patch folding only when provably equivalent (`foldPatch`), rejected queued writes resync and report
  `code: 'dropped'`; the SW never touches `/api/*`; `window.claude.gm` is never queued or snapshotted.
- **Display robustness** (`display-page.js`): poller with a 10 s guard, backoff to 10 s after 3 failures, paused when hidden,
  generation counter on stop; ambient iframes with grace (30 s), watchdog (20 s), bench (10 min), two-slot cross-fade;
  timers and listeners tracked and cleared on `unmount`. No memory-growth path found for a display left on all night.
- **GM saver** (`gm-page.js:224`, `:746`): 800 ms debounce, one write in flight, exponential backoff to 30 s on network/409/429/5xx,
  keepalive beacon on `pagehide`/hidden, "Not saved" sticky with a localStorage mirror.
- **Deploy.** `wrangler deploy --secrets-file` is **additive** (wrangler 4.149 help text: "omitted secrets will not be deleted"),
  so `DISPLAY_EMAILS` and `DEEPGRAM_API_KEY` survive `npm run deploy`. Migrations and `schema.sql` are equal at statement
  level (checked by `worker.mjs`, confirmed with a diff: only comments differ). `.assetsignore` keeps `checks/`, `*.md` and
  `figures/npcs.js` off the host. `app/_headers` gives the ambient frames a real CSP.
- **Checks.** 467 passing node checks plus per-feature Playwright runs; `gm-nosecrets` sweeps the GM code for pack text.

## 2. Findings (prioritised)

Severity: P1 data loss / security / outage at the table · P2 real risk or cost · P3 hygiene. Effort S < 1 h, M an evening, L a weekend.

### E1 · P1 · A single stalled request freezes the player poller; the header keeps saying online
- Evidence: `app/runtime/cf.js` `api()` (line 137) has no timeout/AbortController; `tick()` (427) returns while `inflight`,
  and `inflight` is only cleared when the fetch settles; `visibilitychange` (478), `online` (483) and `pollSoon()` (466) all
  defer to `inflight`. Experiment `hung-poll.mjs`: after the 2nd poll never settles, **0** new polls in 13 intervals despite
  hidden→visible, `online`, and an own write; `B68Runtime.status.online` stayed `true` (no "Offline" chip). Polling resumed
  only when the hung request finally answered. Same shape for writes: `flush()` (703) sets `flushing` and a hung PATCH blocks
  every later write ("Saving N changes…" forever) until the browser aborts (iOS: minutes).
- At the table: café wifi that is "connected" but dead (captive portal, dropped stream) shows stale clocks/harm as current.
- Fix: `AbortController` in `api()`: 15 s for GETs, 25 s for writes; on abort reject with `network: true` (the existing
  network-error path: next tick, `online` event, status offline). Add a case to `adapter.test.mjs` with a never-settling fetch.
  Effort S. Risk low.

### E2 · P2 · The service worker's network-first has no timeout: a stalled network hangs the page load instead of serving the cached shell
- Evidence: `app/sw.js:66` `fetch(req).then(...)` falls back to the cache only on rejection. Offline (fetch rejects fast) works;
  a stalled connection does not.
- Fix: race the network with a timeout (navigation 4 s, scripts 8 s) and answer from the cache when it holds the file, letting
  the network answer refresh the cache in the background. To avoid mixed versions, add `?v=<B68_BUILD>` to script URLs
  (see plan, phase 3). Effort S. Risk: a very slow network serves last session's code, which is still a consistent set once
  versioned.

### E3 · P2 · Two players filling clocks within ~4.4 s lose one fill
- Evidence: `app/campaign.js:153` sends `clocks` as the whole array (`fillOnly` rebuilds it from the last server copy);
  the server's `deepMerge` replaces arrays (`http.js:63`) and `playerMayWrite` allows `clocks.<i>.filled`; the optimistic
  check only guards the row between read and write of *one* request, not a stale client copy. Window = poll interval 4 s
  + `SAVE_DELAY` 400 ms (`campaign.js:39`).
- Fix: a per-clock op, e.g. PATCH body `clockFill: { <id>: n }` applied inside `writeCampaign`'s build (which re-reads the
  row per attempt, so concurrent fills commute); mirror it in `cf.js` `mergeCampaign` and the artifact path (`campaign.js`
  keeps sending the array where no `update` exists). Document in CAMPAIGN.md/HOSTING.md. Effort M. Risk: contract change;
  `adapter.test.mjs` and `checks/api/flow.mjs` need a case each.

### E4 · P2 · An always-on table iPad can spend the Workers Free request budget (100k/day) by itself
- Evidence: display poll every 2 s (`Pure.createPoller` default `intervalMs` 2000, `display-page.js:329`, used at 1225) +
  `stt.js` polls `GET /api/gm/stt` every 4 s (`T.poll: 4000`, line 28) + status PATCH every 10 s ≈ **65k requests/day** while
  the page is visible (the wake lock keeps it visible). Each visible laptop/phone tab adds 21.6k/day (4 s), hidden 4.3k (20 s).
  Two always-open tabs plus the iPad exceed 100k, after which the Worker refuses for the rest of the (UTC) day: an outage
  that starts mid-session. D1 is not the constraint (≈3 small reads per poll; `getDb` runs the 13-statement schema batch
  once per isolate).
- Fix: display 2 s → 4 s; carry `stt` in the display GET like `ambient` (one request instead of two); slow the display to
  30 s after 1 h without a seq change and wake on a tap; hidden tabs 20 s → 60 s. Effort S. Risk low.

### E5 · P2 · After the Access session ends, the GM page parks every later change and says the opposite
- Evidence: `cf.js` latches `signedOut` on the first 401/redirect (146-158) and rejects every later call with status 401;
  `gm-page.js` `retryable()` (216) treats 401 as "will fail the same way" → `makeSaver` parks it (245) and toasts
  "It is kept on this device; later changes still save" (766), which is false from then on. The parked patch rides in
  `b68.gm.sticky` (`carriedParked`, 866) but nothing ever resends it (221: "never resent").
- Fix: on `e.status === 401 || e.code === 'signed_out'` keep the patch *pending* (not parked), show "Signed out: reload to
  sign in, your notes are kept", and resend pending from sticky on the next `open()`. Effort S-M.

### E6 · P2 · A player's tap after a sign-out is rejected before it is queued
- Evidence: `cf.js:793` `write()` returns `reject(signedOutError())` without `enqueue`; `boot.js:261` already updated
  `cache[id]` so the sheet shows the change; the toast says "Could not save: signed out"; a reload (needed to sign in again)
  loses it. Taps *before* the sign-out are safe (queued, re-sent by `restore()`).
- Fix: when `signedOut`, still `enqueue` (the queue is keyed per user id, so the next visit resends it) and reject with the
  same message. Effort S.

### E7 · P2 (deploy) · `npm run deploy` on Windows depends on `sh` and LF line endings that nothing guarantees
- Evidence: `package.json` `"deploy": "sh scripts/deploy.sh"`; npm runs scripts through cmd.exe on Windows, where `sh` is
  on PATH only with Git's optional Unix tools; no `.gitattributes`, so a clone with `core.autocrlf=true` (Git for Windows'
  default) turns the POSIX scripts into CRLF and `set -eu\r` fails on line 32. SETUP.md never says "run this from Git Bash".
  It works for the owner today, so this is latent, but it bites exactly when a fresh clone or a new PC deploys before a game.
- Fix: add `.gitattributes` (`*.sh text eol=lf`, `*.mjs text eol=lf`, `*.js text eol=lf`), say "Git Bash" in SETUP.md, or
  port `deploy.sh` + `lib/common.sh` to `scripts/deploy.mjs` (node is already required; `lib/cf.mjs` does the JSON work).
  Effort S (attributes/docs) or M (port).

### E8 · P2 (deploy) · The deploy script neither checks the gitignored assets nor reports the optional secrets
- Evidence: `scripts/deploy.sh` has no mention of `app/media/theme.mp3` or `app/ambient/calling-cards.html` (both gitignored,
  both absent from this checkout) and never lists secrets; GM.md ("Deploy", "The display sign-in", "Listening") leaves those
  three things to memory. A deploy from a clean clone silently ships a silent credits scene and a 404 cards scene.
- Fix: before `wr deploy`: warn (or die unless `B68_ALLOW_MISSING_MEDIA=1`) for each missing file; after: `wr secret list`
  and print ✓/✗ for ACCESS_TEAM, ACCESS_AUD, GM_EMAILS, DISPLAY_EMAILS, DEEPGRAM_API_KEY. Effort S.

### E9 · P3 · Checks: 60 % of `npm test` is two 500-seed sweeps; two unit files and three e2e files run by nothing
- Evidence: timings above; `display.test.mjs` (the sanitiser and poller, 61 tests, 0.3 s) and `gm-location.test.mjs` (0.7 s)
  are not in `check:runtime`; `display-role.e2e.mjs`, `gm-npc-panel.e2e.mjs`, `gm-prep.e2e.mjs` and 11 of `app/checks/*.js`
  are referenced by no npm script (README says "run them directly").
- Fix: `N = process.env.B68_SWEEP || 100` in the two sweeps (full 500 in a `check:sweep`); add the two unit files to
  `check:runtime`; add `check:e2e-all` that runs every `*.e2e.mjs` in sequence. Effort S.

### E10 · P3 · Docs contradict the code (spot-check of 15 claims: 7 stale)
1. HOSTING.md:85 "migrations 0001 to 0006" → there are seven (`0007_gm_stt.sql`).
2. HOSTING.md:39 Permissions-Policy "turns off … microphone" → `worker/app.js:144` allows `microphone=(self)` (GM.md agrees).
3. HOSTING.md:277 `window.claude.gm` lists 8 calls → `cf.js:1023` has 16 (ambient, stt, transcript…).
4. HOSTING.md:369 `check:runtime` = "adapter, pwa, markdown" → 17 files.
5. HOSTING.md:52 / GM.md:313 display role "exactly two calls" → `DISPLAY_ALLOWED` has six (stt token, stt GET/PATCH,
   transcript POST); GM.md:368 itself says so. Contradiction inside GM.md.
6. GM.md:46 display `kind` list omits `cards` (`gm.js:33`).
7. README.md:79 `check:runtime` list omits gm-prep, gm-screen, stt, ambient-*, gm-after.
Correct (sampled): 500-row cap, 256 KiB bodies, `since` 2 s overlap, PATCH /api/me rule, page headers, DEV_USER secret
deletion, `--secrets-file` behaviour, SETUP "Updating the app" (except: `npx wrangler deploy` alone skips migrations, fine for
new tables because `db.js` creates lazily, not for a future ALTER COLUMN). Effort S.

### E11 · P3 · Secrecy premise vs the public repo
- `git ls-files` holds `app/figures/npcs.js`, `migrations/0003_npcs.sql` and `schema.sql` with the seven **hidden** NPCs'
  names and look lines (no `gmNotes`: CAST.md:142) in a repo that is public (`gh api`: `"private": false`). The API hides them
  from players; GitHub does not. `gm-nosecrets.test.mjs` scans `app/gm/**`, `gm-page.js`, `display-page.js`, `scripts/**` only.
  CAST.md:39-42 and AMBIENT-PLAN.md:158 ("private-repo switch is Alex's") show this is known.
- `package.json` hard-codes the vault path `C:/Vault/Hazel Second Brain` in six scripts (a personal path in a public repo;
  also the only thing stopping another PC from running them).
- No real secrets, keys or non-test emails found (grep for key-like literals, long hex, non-`.test` emails: clean; the only
  `SECRET` literal is a test marker in `display.test.mjs`).
- Fix: move the NPC seed to `gm-private/` and import it with `gm:push`, or flip the repo private; `B68_VAULT` env with the
  default in `scripts/lib`. Effort S.

### E12 · P3 · The page's CSP is `frame-ancestors 'none'` only; a real one is feasible
- Evidence: no inline event handlers, no `eval`/`new Function`, every script same-origin (`grep` over `app/`). Blockers are
  only the inline `<style>` in index.html and `data:` images.
- Fix: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self';
  connect-src 'self' wss://api.deepgram.com; frame-src 'self'; media-src 'self'; object-src 'none'; base-uri 'self'`, shipped
  first as `Content-Security-Policy-Report-Only`, asserted in `worker.mjs`, then enforced after one e2e pass. Effort S-M.

### E13 · P3 · JWKS refetch failure has no stale-key fallback
- `auth.js:63-72`: after the 1 h TTL every request refetches; a failed fetch throws → every API call is 401
  "certs fetch failed" until Cloudflare's certs endpoint answers again. Fix: keep serving the cached keys when the refetch
  fails (refetch only on unknown `kid`). Effort S.

### E14 · P3 · The display never leaves `denied`
- `cf.js` latches `signedOut`; the poller's `denied` state polls every 10 s but each call is rejected locally; the iPad shows
  "Not signed in as the GM" until someone taps and reloads. Fix: in `denied` (or `offline`) for > 10 min, `location.reload()`
  once; a reload re-issues the Access JWT while the SSO session is valid. Effort S.

### E15 · P3 · No "new version" signal for an app kept open
- SW is network-first (good: a cold open always gets new code) but a PWA left open after a deploy keeps old code with no
  prompt; `cf.js` registers the SW and ignores `controllerchange`. Fix: a `B68_BUILD` constant (see plan) returned by
  `/api/me`; when it differs from the page's, show "Updated: reload". Effort S.

### E16 · P3 · Duplicated helpers with drifting semantics
- `esc` ×12 (two variants: with/without `'`), `isObj` ×12, `clone` ×12, `clamp` ×7 (round vs not), `str` ×7 (one trims),
  `nowIso` ×5, `deepMerge` ×3 with **different** null handling (`boot.js:326` keeps nulls, `cf.js:39` deletes, `core.js`
  `merge` clones). Fix: `app/util.js` → `window.B68Util`, adopted per module when a file is next touched. Effort M, low risk
  if done gradually.

### E17 · P3 · Dead weight
- `SITUATIONS_DEFAULT = true` (`gm-page.js:34`) keeps the whole "no Situations" branch and the "Classic layout" device
  switch alive; `schedule.js` (61 KB) + `season.js` are parked features shipped to everyone (the lazy plan removes the cost;
  the code can stay); artifact-only paths (`B68CastSeed`, `claude.hot`, `collection('campaign')` queries) are still needed
  while the artifact runs. `tools/ambient/` is reference-only but committed (fine, documented).

### E18 · P3 · GM state growth
- Caps exist (`LIMITS` `gm-page.js:40`: hist 5/tool, pins 50, capture 400 × 500 chars; server 256 KiB). Worst case the capture
  alone reaches the 240 KiB soft cap and every new roll is refused mid-session ("The GM notes are full"). Fix: cap capture by
  bytes (e.g. 96 KiB) and drop the oldest silently. `gm_transcript` is unbounded by design (prune is manual); ~10 MB/season.
  Campaign doc: log trimmed to 200; fine.

### E19 · P3 · Rendering cost
- No O(n²) found: roster/query snapshots sort N docs with a JSON clone per `data()` (N ≤ a few dozen); the table page
  re-renders its whole HTML on every snapshot and keystroke (fine at this size); rules search is linear over ≤ 4000 entries
  with precomputed folded text. The heaviest CPU path on the Worker is `POST /api/gm/pack` (parse + stringify + SHA-256 of
  900 KiB) against the Free plan's 10 ms CPU limit; it has worked so far.

## 3. Lazy-loading plan (keeps "no build step", artifact unaffected)

Measured: `index.html:549-569` loads 21 scripts synchronously, 2.3 MB (figure-kit 688 KB, map-kit 255 KB, gm-page 199 KB,
gm/* 221 KB, tracker 131 KB, boot 99 KB, display 77 KB, steps 78 KB, schedule 61 KB, rules 56 KB…), plus 10 render-blocking
stylesheets (~230 KB). Fonts already use `font-display: swap` (no preload). Dependency map (from `window.B68*` references):

| Bundle | Files | KB |
|---|---|---|
| core (every route) | figures/figure-kit.js, figures/cast.js, content.js, core.js, zoom.js, steps.js, tracker.js, schedule.js (home card), name-edit.js, runtime/cf.js, boot.js + tracker.css | ≈1240 (688 is the kit) |
| table `#t` | campaign.css, crewsheet.css, schedule.css, crews.js, crewsheet.js, campaign.js | 153 + 65 css |
| print `#print` | table + season.css, season.js | 23 + 10 |
| rules `#rules` | rules.css, markdown.js, rules.js | 85 + 25 |
| cast `#cast` | cast.css, cast-page.js | 37 + 12 |
| gm `#gm` | gm.css, prep.css, maps/map-kit.js, markdown.js, gm/console.js, gm/location.js, gm/scenes.js, gm/engagement.js, gm/npc.js, gm/figure-map.js, gm/prep.js, gm-page.js | 675 + 62 |
| display `#display` | display.css, markdown.js, display-page.js, stt.js | 94 + 17 |

Phase 1 (M, one evening, ≈ −1.07 MB JS and −170 KB CSS for every player):
1. `app/routes.js` (~40 lines, loaded right after `cf.js`): `BUNDLES` as above and `window.B68Load.need(name)` → appends
   `<script src>` / `<link rel=stylesheet>` **sequentially** (order matters: gm/console.js before gm-page.js), memoised per
   file, rejects on `error`, resolves when the last `load` fires. Relative URLs, exactly like the static tags, so the claude.ai
   artifact (which publishes the same files at the same paths) and the `file://` page checks resolve them unchanged.
2. `index.html`: keep only the core tags.
3. `boot.js`: each starter becomes self-retrying, e.g. `function startGm() { var G = gmMod(); if (!G) { B68Load.need('gm')
   .then(startGm, function (e) { toast('Could not load the GM page: ' + e.message, true); }); return; } … }` (same for
   `startTable`, `startPrint`, `startRules`, `startCast`, `startDisplay`, and `openSchedule` which needs `table`). The
   `A.isDisplay` branch (1173) and `route()` need no change because `setMode` still calls the starter. A one-line "Loading…"
   note in the panel while it loads.
4. `sw.js` `SHELL` = core ∪ every bundle file (so install still precaches everything in the background and every route works
   offline; nothing blocks first paint any more). `pwa.test.mjs` loads `routes.js` in its vm and asserts `index.html refs ⊆
   SHELL` and `∪ BUNDLES ⊆ SHELL`, plus "every bundle file exists".
5. Checks: the e2e runs already wait on selectors, so the async start is transparent; add one `gm.e2e` step "the GM bundle is
   not requested on the home page" (count script tags).

Phase 2 (M): make the figure kit async. Three top-level captures (`core.js:4`, `tracker.js:14`, `cast-page.js:12`) become
lookups (`schedule.js`, `season.js`, `gm-page.js`, `display-page.js` already look it up at call time); boot loads `kit` right
after the first `renderHome()` and dispatches `b68:kit`; the home line-up, the open sheet's portrait (`tracker.js:298`) and
the creator stage redraw on it. A player's first paint then needs ≈450 KB of JS.

Phase 3 (S): `B68_BUILD = 'YYYY-MM-DD-n'` in `routes.js`; bundle URLs get `?v=B68_BUILD`; `sw.js` derives `CACHE` from it;
`/api/me` returns it (from `env` or a generated file) so an open page can show "Updated: reload" (E15) and the mixed-version
window of E2 closes.

## 4. Docs consolidation

Root today: 16 `.md` + `TODO.md`. Proposal:

- **Keep at root (live contracts):** README.md (entry; trim the checks table to "the four commands you need": `npm run dev`,
  `npm test`, `npm run deploy`, `npm run gm:sync`, and link the rest), SETUP.md (merge DEPLOY-PROMPT.md into an appendix and
  DEPLOY.md's live *Backups* and *Status* rows into it), HOSTING.md, GM.md, CAST.md, CAMPAIGN.md, RULES.md, SYNC.md, TODO.md.
- **Mark parked, keep:** SCHEDULE.md with a first line "Parked until Nov/Dec 2026; the group's dates live in Google Calendar"
  (it is still the contract for `schedule.js`, which still ships).
- **Move to `docs/history/`:** PLAN.md (status section says "superseded"), RESEARCH.md (5 Oct build-vs-buy), ROADMAP.md
  (13 Oct "nothing here is built yet": names, cast, rules have since shipped; add a one-paragraph "what landed" header),
  AMBIENT-PLAN.md (status "built and deployed 15/10"; move its *Decisions* list into GM.md "Ambient scenes" first),
  DEPLOY.md (the plan half), DEPLOY-PROMPT.md.
- **app/:** `app/CONTRACT.md`'s opening ("Three modules are being built in parallel… do not edit files you do not own")
  is a stale working agreement; keep the document/`play`/module-API content, drop the ownership preamble. `app/README.md` fine.
- Fix the seven stale claims in E10 in the same pass, and add to README a "Secrets not managed by the deploy script"
  box (DISPLAY_EMAILS, DEEPGRAM_API_KEY) and "files that must be on disk before a deploy" (theme.mp3, calling-cards).

## 5. Deploy safety: the one command and what it should print

`npm run deploy` already does everything (checks → D1 → migrations → Access → secrets → deploy → smoke test). Make its last
screen a receipt: git commit + "working tree clean/dirty", Worker version id, `d1 migrations list --remote` (applied / pending),
secrets by name ✓/✗ (the five above), on-disk assets ✓/✗ (theme.mp3, calling-cards.html), `sw.js` cache version, the two smoke
results, then the existing "Next" steps. Refuse to run with a dirty tree unless `B68_DIRTY_OK=1` (a non-programmer deploying
half-edited files is the likeliest mistake). Note in SETUP.md "Updating the app" that `npx wrangler deploy` alone skips
migrations (safe today only because `db.js` creates new tables lazily).

## 6. Numbers worth keeping

- Polling: one visible device = 15 polls/min = 45 D1 statements/min (`characters since`, `campaigns.updated_at`, `MAX(npcs)`);
  requests/day: visible tab 21.6k, hidden tab 4.3k, iPad display 43.2k + stt 21.6k. Workers Free: 100k requests/day, 10 ms CPU.
- Sizes: 272 tracked files, `.git` 16 MB; `app/` JS 2.3 MB sync + 230 KB CSS + 380 KB fonts (lazy by `@font-face`).
- `npm test`: 198 s (runtime 139 s of which 121 s are the two sweeps; api ≈ 60 s). `display.test.mjs` 0.3 s, `gm-location` 0.7 s.
