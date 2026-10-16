# Ambient scenes on the table iPad — build plan

Status: **built and deployed 15/10/2026** (PR #10, Worker `cc0e9b13`, migration 0006). Phases 1–4 done; Phase 5 docs in `GM.md`
("Ambient scenes"); the iPad soak (5.3) is Alex's. Source: `b68-ambient.zip` (six scenes + `tools/`), uploaded 15/10; a copy is at
`%USERPROFILE%\Documents\b68-ambient.zip`.

Built differently from this plan: scene URLs have no `.html` (the asset server redirects, and the service worker won't cache a redirect);
tapping a scene tile pins it in any mode; the score's `target` is always empty; heat/wanted sync needs `#gm` opened in that page load.

## What it does

The iPad's `#display` always has something playing. **Ambient is the floor**: when nothing is spotlit, a scene plays
full screen and rotates. When the GM pushes a map, an NPC or text, the ambient fades out under it. When the GM clears
the spotlight, the ambient fades back in.

Decisions (Alex, 15/10):

| | |
|---|---|
| Rotation | **Playlist + pin.** Auto-rotates (default 7 min, cross-fade). The GM can pin one scene, or skip to the next. |
| Score scenes | **Live from the current roll.** Planning board and exploded score site are built from the GM page's location roll and revealed bands, player layer only. |
| Blank | **Clear → ambient, plus Lights out.** "Clear" drops back to ambient. A separate **Lights out** gives true black. |
| Heat / wanted | **Auto from the campaign.** The GM page sends crew heat and wanted with the ambient doc and re-sends on change. |

## Facts this plan rests on (checked 15/10)

- The six pages are self-contained: no external requests. Only `watch-feed.html` calls anything: `GET /api/campaign` every
  30 s, unless loaded with `?api=off`. It also takes `postMessage({type:"b68:crew", heat, wanted}, origin)`, same origin only.
- Static assets are served without `X-Frame-Options` (only `/` and `/index.html` get `PAGE_HEADERS`), so `/ambient/*.html` can be
  framed by the display page. The `display` sign-in may only call `GET /api/me` and `GET /api/gm/display`. Static files are
  outside `/api`, so it can load them. Ambient settings must therefore ride on `GET /api/gm/display`.
- `planning-board.html` / `score-exploded.html` in the zip are the **map kit's sample roll (Convent Road Bank)**, not a real
  score. They are replaced, not shipped.
- `make-score-scenes.js` is string templating over `M.render` + `K.portrait`. Both already load in the browser. Player-layer
  sizes with the **app's** kit (`app/maps/map-kit.js`): board 43 KB (public) → 74 KB (all bands), iso 55 → 91 KB. They fit
  well under the 600 KiB `checkSvg` cap.
- The app's kit emits the two kit cork rects and the `#a51d16` red-string paths that the board transform targets. `rings`
  view + `board` theme renders cleanly (the fallback below).
- The zip's kits are a **newer** version than the app's (different hashes). This plan uses the app's kits. Upgrading them
  is a separate decision (it may fix the hidden-name bug in GM.md; it would need the full `gm-nosecrets` suite re-run).
- The service worker caches any same-origin GET it answers, so a scene works offline after it has played once.
  **Do not** add `ambient/*` to `SHELL`: that would push ~4.6 MB to every player's phone.

## Architecture

```
GM page (#gm)                          Server (D1)                       iPad (#display)
 iPad panel ──PATCH /api/gm/ambient──▶ gm_ambient {seq, doc} ─┐
 Show on iPad ─PUT /api/gm/display───▶ gm_display {seq, doc} ─┴─GET /api/gm/display?seq&aseq─▶ poller
                                                                                                  │
                                                         ┌────────────────────────────────────────┘
                                                         ▼
                                   .dp-stages   spotlight: svg | npc | text | dark  (opaque)  ← on top
                                   .dp-ambient  <iframe src="/ambient/<scene>.html">         ← the floor
                                                 postMessage b68:crew  → watch-feed
                                                 postMessage b68:score → planning-board / score-exploded
```

- **Two layers, two docs.** The spotlight doc (`gm_display`) is unchanged in meaning; `blank` now means "show ambient", and a
  new kind `dark` means lights out. The ambient doc (`gm_ambient`) holds the playlist and the score. An NPC push must not wipe
  the score maps, so they are kept apart.
- **Ambient doc** (merge-patched, GM only):
  `{ mode: 'auto'|'pin'|'off', scene, playlist: [ids], intervalMin: 3–30, skip: n, crew: { heat, wanted },
     score: null | { name, district, target, reveal: [bands], board: svg, iso: svg, view: 'plan'|'rings', at } }`
- **Scene registry** (`Pure.AMBIENT_SCENES` in `display-page.js`, mirrored as an id list in `functions/_lib/gm.js`):
  `harvest` (lair), `watch` (needs crew), `duskwall`, `board` (needs score), `exploded` (needs score), `testcard` (breaks:
  pin only, not in the default rotation). The URL is always built from the registry, never from the doc.
- **Iframes.** `sandbox="allow-scripts allow-same-origin"` (no top navigation, popups or forms on the GM's signed-in iPad),
  `allow="screen-wake-lock"`, `pointer-events:none` (taps still reach the display page for wake lock and its buttons). Two slots for
  the rotation cross-fade. **Covered by a spotlight:** keep it 30 s (a quick NPC flash returns instantly), then remove it. That
  stops its rendering: a hidden iframe does not get `visibilitychange`, so it would otherwise run behind the spotlight all
  night. **Uncovered:** reload and fade in on `load`. **Watchdog:** no `load` within 20 s → skip it and bench it for 10 min.
- **Score shells** hold no campaign data. They wait for `b68:score` (checked `e.source === parent && e.origin === location.origin`),
  parse each SVG with `DOMParser('image/svg+xml')` + `importNode` (never `innerHTML`), and do the cork-strip / red-string
  marking on the DOM, not by regex. The display page re-sanitises with `Pure.sanitiseSvg` before posting. The display draws the four crew
  polaroids with its own figure kit and sanitiser, so the shells load no kits.
- **`app/_headers`** for `/ambient/*`: `X-Frame-Options: SAMEORIGIN` and
  `Content-Security-Policy: frame-ancestors 'self'; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'self' data:; connect-src 'self'`.

## Secrecy (the line this must not cross)

- The score maps are the only new route from a roll to the players' screen. They go through **every** gate "Show on iPad" uses: the
  player layer rendered by the page itself (`gate`), the hidden-name leak scan, `confirmReveal` for bands beyond public, `checkSvg`
  on the server, and `sanitiseSvg` on the iPad.
- **`plan` view leaks hidden level titles on ~¼ of rolls** (GM.md). If the plan scan trips, the board falls back to `rings` view
  (clean) and the panel says so. If iso trips (it shouldn't), refuse.
- **Never auto-update** the score when bands are revealed. Alex presses **Set as score scene** again, which keeps "asks first".
- The ambient doc never enters `/api/export`. Players get 403 on `/api/gm/ambient` before the body is read. The display role is
  refused it: it reads the doc only through `GET /api/gm/display`.

## Phases, tasks and models

Model rule (CLAUDE.md): **Haiku** for mechanical, low-judgement work; **Sonnet** where the code needs judgement; **Opus** once, for
the secrecy review. One PR per phase (`ambient-p1` …), as with `gm2-pN`. Run `/usage` before each phase.

### Phase 1 — Ambient floor, client only (no server change)

Shippable alone: blank = a rotating default playlist of the four static scenes.

| # | Task | Model |
|---|---|---|
| 1.1 | Copy `second-harvest`, `watch-feed`, `duskwall-after-dark`, `test-card` byte-identical into `app/ambient/`. Copy `README.md`, `shell.js`, `grain.js` and `make-score-scenes.js` into `tools/ambient/` as porting reference (repo root, so not deployed; no kits, no fonts). Add `app/_headers`. | Haiku |
| 1.2 | Check `checks/runtime/ambient-assets.test.mjs`: the files exist; they have no `http(s)://` except the w3.org namespaces; `_headers` covers `/ambient/*`. Confirm under `npm run dev` that `_headers` is applied and is not itself served. | Haiku |
| 1.3 | `display-page.js`: `Pure.AMBIENT_SCENES`, `Pure.ambientPlan(doc)` (P1 default: auto, `[harvest, watch, duskwall]`, 7 min), `Pure.nextScene(...)`. The ambient controller: two-slot iframes, cross-fade, 30 s covered-grace then unload, reload on uncover, 20 s watchdog, pause the rotation timer while `document.hidden`. `watch` always loads with `?api=off`. `unmount` cleans up everything. Blank stage becomes transparent. | Sonnet |
| 1.4 | `display.css`: `.dp-ambient` layer, transparent `.dp-blank`, iframe fill, reduced-motion (no cross-fade). | Haiku |
| 1.5 | Pure tests in `display.test.mjs`. New `checks/runtime/display-ambient.e2e.mjs` (Playwright, like `display-role.e2e`): blank shows an iframe; text covers it; the iframe is gone after the grace (test hook shortens timings); blank brings it back; the rotation advances; no request leaves the origin; no console errors. | Sonnet |

Gate: `npm test`, `check:display`, the new e2e, then 30 min on the real iPad.

### Phase 2 — Server: ambient doc + Lights out

| # | Task | Model |
|---|---|---|
| 2.1 | `migrations/0006_gm_ambient.sql`: `gm_ambient(campaign TEXT PRIMARY KEY, seq INTEGER, updated_at TEXT, doc TEXT)`. Mirror it in `schema.sql`. | Haiku |
| 2.2 | `functions/_lib/gm.js`: `DISPLAY_KINDS` + `dark`. `cleanAmbientPatch`: mode, scene/playlist against the id list (≤12, unique), intervalMin 3–30, `skip: true` → server bumps the counter, crew heat 0–9 / wanted 0–4, score (`null` clears; strings ≤200; `reveal` ⊆ the four bands; `board` and `iso` through `checkSvg`). Merge, then a 1.4 MB cap on the stored doc (under D1's 2 MB row). `loadAmbient` / `patchAmbient` with the same optimistic `updated_at` retry as state. | Sonnet |
| 2.3 | `functions/api/gm/ambient.js`: GET + PATCH, GM only. Route in `worker/app.js` `ROUTES` before the `/api/gm` catch-all. `GET /api/gm/display` adds `ambient: { seq, doc, updatedAt }`; `?aseq=M` gives `ambient: { seq, unchanged: true }`; top-level `unchanged` only when both match. `?seq` alone behaves as today (old clients unchanged). | Sonnet |
| 2.4 | `app/runtime/cf.js`: `gm.ambient()`, `gm.patchAmbient(p)`, `gm.display(seq, aseq)`. | Haiku |
| 2.5 | `checks/api/gm.mjs` and `display-role.mjs`: player 403 before the body on every method; the display role gets ambient via display but 403 on `/api/gm/ambient`; 400s and 413s; the skip counter; the `checkSvg` rejection list replayed for `score.board` and `score.iso`; `/api/export` carries none of it; `dark` kind. | Sonnet |

Deploy: `npx wrangler d1 migrations apply DB --remote` **before** `wrangler deploy`.

### Phase 3 — GM controls + heat/wanted

| # | Task | Model |
|---|---|---|
| 3.1 | `gm-page.js`: a new side panel, **iPad (`I`)**. It shows what's on the iPad now (spotlight kind + title), **Clear → ambient** (= PUT blank; replaces every "Blank the iPad"), a **Lights out** toggle, Ambient **Off / Auto / Pin**, a six-tile scene picker (score tiles disabled until a score is set; test card pin-only), interval 4/7/10/15 min, **Next scene**, and the score line (name · bands · time) with **Clear score**. Key `0` = Clear → ambient. The server doc is the truth; refetch it on focus. | Sonnet |
| 3.2 | Heat/wanted: in `campaign(doc)`, when `crew.heat` / `crew.wanted` differ from the last sent and ambient isn't off, debounce 2 s → PATCH `{crew}`. One request in flight; on error, one toast. | Sonnet |
| 3.3 | `display-page.js`: the poller tracks `aseq` (validation accepts the new shape). Apply mode / pin / playlist / interval / skip. Post `b68:crew` to watch-feed on its `load` and on each change. Add the `dark` stage. | Sonnet |
| 3.4 | `gm.css` for the panel (copy the existing panel patterns); add `I` and `0` to the keys help. | Haiku |
| 3.5 | `gm-page.test.mjs` (keys, panel render, debounce), `gm.e2e.mjs` (panel → display end to end), `display.test.mjs` (aseq poller, skip). | Sonnet |

### Phase 4 — Live score scenes

| # | Task | Model |
|---|---|---|
| 4.1 | `app/ambient/planning-board.html` and `score-exploded.html` as shells ported from `tools/ambient/make-score-scenes.js` + `shell.js`. They keep the same stage, grain, vignette, ~30 fps loop, camera drift and string pinning. Fonts by `url(../fonts/…)`. They post `b68:ready`, accept `b68:score`, and import with DOMParser. | Sonnet |
| 4.2 | GM page: **Set as score scene** beside Show on iPad in the Location panel. It renders `plan`/`board` and `iso`/`blueprint` at the current reveal with the app's kit and runs `gate` + the leak scan on both. If plan leaks, it uses `rings`/`board` and says so. `confirmReveal` runs beyond public, then PATCH `{score}`. | Sonnet |
| 4.3 | Display: re-sanitise both SVGs, draw the four polaroids (`K.portrait` → `sanitiseSvg`), post on `b68:ready`. Crew list constant from the generator: booker "Babel", alfie "Ashtray & Buck", stacey "Stacey", loader "99.47". Score tiles are skipped in rotation while no score is set. | Sonnet |
| 4.4 | Checks: `gm-nosecrets` additions (only the player layer is pushed; a leaking plan swaps to rings; a GM-layer render is refused). e2e: set a score → the board iframe holds public-band room names only. Fixture roll invented, no '68 text. | Sonnet |
| 4.5 | **Secrecy review** of the P4 diff (`/code-review high`): the one new path from a roll to the players' screen. | **Opus** |

### Phase 5 — Docs, vault, rollout

| # | Task | Model |
|---|---|---|
| 5.1 | `GM.md`: an Ambient section, the endpoint table rows, the display section ("blank = ambient", `dark`). `app/ambient/README.md`. A `ROADMAP.md` line. | Haiku |
| 5.2 | Vault: update `blades-68-ambient-ipad`, index, log. | Haiku |
| 5.3 | **Alex, on the iPad:** a 60-min soak per scene (warmth, battery, any Safari reload), wake lock held with the iframe up, Home Screen (standalone) mode, Lights out and Clear from the laptop mid-scene. | — |

## Risks and open items

- **Thermals.** `watch-feed` is a 2.2 MB SVG animated at ~30 fps. If the iPad runs hot over 3 h, the knob is a frame-rate
  parameter in the scenes, which means regenerating them. Measure in 5.3 before building it.
- **The four static scenes have no generator in the zip** (only the score one). A PC change (e.g. Isaac's character) means asking
  Claude Design again. `[TODO: get the generators for second-harvest / watch-feed / duskwall / test-card if they need to stay current]`
- **Polaroid crew list is hard-coded** (4.3). `[TODO: move to the campaign doc when the roster changes]`
- **Public repo.** The static scenes carry PC names, portraits and the GT America font. `cast.js` and `app/fonts/` already do,
  so this is no new class of exposure. The score shells carry nothing. Private-repo switch is Alex's.
- **Offline, never-played scene.** The service worker answers an uncached iframe navigation with `index.html`, which is frame-denied →
  blank iframe → the watchdog skips it. Acceptable.
- **Deploy timing.** Never on a game day. Sat 17/10 is a session: P1 can only make it if it's green and deployed Fri 16/10.
  Otherwise everything lands after.
