# GM tools: the API and the secrecy contract

The `#gm` page (console, location generator) and the `#display` page (an iPad signed in as the GM) run on three
GM-only endpoints. The generators' tables hold '68 text and GM-only secrets, so they never enter git: the GM builds
a **pack** from the vault on their own PC (`npm run gm:pack`, into the git-ignored `gm-private/`) and uploads it from
the browser. Code: `functions/_lib/gm.js`, `functions/api/gm/*.js`; tables in `migrations/0004_gm.sql`.

## Secrecy rules (server enforced)

- Every method of every `/api/gm/*` path (unknown ones too) answers **403** `{"error":"only the GM can use the GM tools"}`
  to anyone who is not the GM, **before the body is read**, before the method check and before the database is
  touched. No token is the usual 401. A player cannot learn which GM routes exist (an unknown `/api/gm/x` is 403 for a
  player, 404 for the GM).
- `/api/export` carries none of it (no pack, state or display), as with the rules wiki.
- `/api/characters` carries nothing about the GM tools, for anyone.
- The service worker never caches `/api/*` (`app/sw.js` bypasses it). The adapter's `window.claude.gm` calls are plain
  requests: never queued, never in the offline snapshot or localStorage, never through the db layer. The GM page keeps
  its own copy of the pack in IndexedDB (`b68-gm`, key `pack:<userId>`) and purges it when a non-GM signs in.
- Checks and fixtures use invented data only (`checks/api/gm.mjs`, `checks/runtime/fixtures/gm/`).

## Endpoints

| | |
|---|---|
| `GET /api/gm/pack` | `{ version, parts: { <name>: { version, src, updatedAt, bytes } } }`, the index (no bodies). `?v=<version>` → `{ version, unchanged: true }` while current. |
| `GET /api/gm/pack?part=<name>` | `{ part, version, src, updatedAt, body }`; 404 when missing. `&v=<version>` → the same without `body`, plus `unchanged: true`. |
| `POST /api/gm/pack` | `{ part, src, body }` stores one part → `{ ok, part, version, bytes, unchanged, packVersion }`. The same body and src again writes nothing (`unchanged: true`). |
| `DELETE /api/gm/pack?part=<name>` | → `{ ok, part, packVersion }`; 404 when missing. |
| `GET /api/gm/state` | `{ doc, updatedAt }` (`{}` and `null` until written). |
| `PATCH /api/gm/state` | deep merge (plain objects merge, arrays and scalars replace, `null` deletes) → `{ doc, updatedAt }`. Keep collections as maps, not arrays. |
| `GET /api/gm/display` | `{ seq, display, updatedAt }` (`seq` 0, a blank display, until written). `?seq=N` → `{ seq, unchanged: true }` while N is current. |
| `PUT /api/gm/display` | `{ kind, title?, caption?, svg \| npcId \| text }` → `{ seq, display, updatedAt }`; `seq` goes up by one on every PUT. |

- **Pack.** Part names `[a-z0-9-]{1,32}`; at most 12 parts; `body` a JSON object (or a string holding one), at most
  900 KiB as JSON; `src` an object, at most 2 KiB. A part's `version` is the first 12 hex digits of the SHA-256 of
  `JSON.stringify(body)`; the pack's `version` hashes every part's name, version and src (`'0'` when empty). Stored in
  `gm_pack(campaign, part, version, src, updated_at /* ms */, body)`.
- **State.** The `campaigns` row `<CAMPAIGN>#gm` (beside the campaign document; `/api/campaign` never reads it). Patch
  and stored document at most 256 KiB each; optimistic `updated_at` check with retries, 409 when it keeps colliding.
- **Display.** `kind` is `blank`, `svg`, `npc` or `text`; other keys are dropped. `title`, `caption`, `text` at most
  2000 characters (`text` required for `text`); `npcId` an id `[A-Za-z0-9_-]{1,80}`. `svg` is the player-safe render:
  at most 600 KiB, must start with `<svg`, and is **rejected** (400) if it holds `<script`, `<foreignObject`, an HTML
  element (`iframe`, `embed`, `object`, `meta`, `link`, `base`, `form`...), any of those with a namespace prefix
  (`<x:script>`, `<h:iframe>`), a namespaced `<style>`, an `<a>`, `xml:base`, `<!DOCTYPE`/`<!ENTITY`, `javascript:`,
  `vbscript:`, any `on…=` attribute, `srcset`, `@import`, `image-set()`, `src()`, an animated `href`, a backslash in an
  attribute value or a `<style>`, a `url()` that is not a `#fragment`, or an `href`/`src` that is not a `#fragment`
  (a raster `data:image/png|jpeg|gif|webp` URI is allowed on `<image>` and `<feImage>` only). The display page's
  sanitiser enforces the same rules on its side.
  Stored in `gm_display(campaign, seq, updated_at, doc)`.
- Errors are the repo's: `{ "error": "..." }`, 400 malformed, 413 over a cap, 405 other methods (GM only; a player is
  403 first).

## Adapter (`app/runtime/cf.js`, hosted build only)

`window.claude.gm = { pack(opts), packPart(name, opts), importPart(req), removePart(name), state(), patchState(patch),
display(seq), setDisplay(d) }`; `opts.version` asks for the unchanged answer. Each returns the API's JSON, or rejects
with `err.status` (403 for a player) or `err.network = true`. In the claude.ai artifact there is no `window.claude.gm`.

## The page (`#gm`, `app/gm-page.js`, `app/gm.css`)

GM only: the nav's **GM** button shows only for the GM on the hosted build; anyone else (and the claude.ai artifact) gets a
one-line message at `#gm`. Boot calls `B68GmPage.open(root, api)` / `close()` / `campaign(doc)`, and `purge()` when the
signed-in viewer is **known** not to be the GM (every `pack:*` key in IndexedDB and `b68.gm.sticky` go). When `/api/me`
fails and nobody is known, nothing is purged.

- **First run.** With no pack on the server the page asks for `gm-private/b68-gm-pack.json` (built by `npm run gm:pack`),
  checks it (`format` 1, `console` and `location` parts with `T`), previews the parts and uploads one part per
  `importPart` with a progress bar; parts the server holds that the file lacks are removed. **Update pack** does the same
  again; **Forget GM data on this device** drops the local copies. After that, each visit compares the cached part
  versions with `pack()` and fetches only what changed; if a part will not download, the page carries on with the copy on
  the device ("offline copy" in the header). The header shows "Campaign data exported DD/MM/YYYY", amber when
  more than three days old.
- **Layout.** Laptop (>= 1100 px): the console (controls, the nine buttons, the card, "Earlier:" the last five rolls) |
  a side panel with **Location (B)**, **NPC (N)** and **Rules (T)** | the state rail (crew heat, wanted, rep, stacks and
  vault from the table, read only; table clocks; the pack's world clocks; bargains owed with **Collect**; pins; who is on
  stage) | the capture bar at the foot. 600–1100 px: two columns, the rail below. Phone: a Console | Location | NPC |
  State bar, the buttons a 3 × 3 grid, the controls behind a "Scene" line, capture on a floating button.
- **Keys** (only on `#gm`; never while typing, never with Ctrl/Alt/Cmd): `1`–`9` roll, `B` `N` `T` switch the panel
  (`S` and `E` are reserved), `P` `X` `M` open capture as Name / Loose end / Moment (Enter files, Esc leaves), `L` files
  the last roll under "Rolled at the table", `H` blanks the screen until any key or tap.
- **Location.** The generator's controls and Roll, the card with GM-only sections marked, then the map: view, theme,
  layer (GM / Player) and the bands revealed to the player layer; Draw, Download SVG / note (.md) / canvas. **Show on
  iPad** is enabled only on the player layer, and the code renders the player layer itself and refuses any other svg
  (`gate` in `gm-page.js`; tested in `gm-nosecrets.test.mjs`, `gm-page.test.mjs` and `gm.e2e.mjs`). The street
  description can go to the iPad as plain text; **Blank the iPad** clears it.
- **Reveal.** Every new roll and every replay starts with the public band only. The ticks count only while Layer is
  Player (on the GM layer the street description and everything else use public only), and sending anything beyond public
  to the iPad asks first, naming the bands.
- **Hidden names (a map kit bug, worked around here).** The vendored kit's player layer titles a `plan` or `section`
  level after the room on it even when that room is hidden (a basement title on an UNSURVEYED plate; about a quarter of
  rolls, sometimes the target). Until the design system fixes it upstream (kit-source `scene.js` / `section.js`: level
  titles in the player layer should be generic), the page scans every player render for the names of hidden rooms, both
  threats and a hidden target, and refuses to send it ("This view would name a hidden room: use Rings or Iso, or reveal
  more bands"); the in-page Player draw shows the same warning and the Player SVG download is refused. `rings` and `iso`
  are clean.
- **NPC.** The NPC generator is not ported yet. The app's cast is listed with portraits: **Show on iPad** (a hidden NPC
  asks first) and **Put on stage** (opens the NPC on the cast page, which stages it).
- **State.** The GM state document holds `con` (the console state: `live` controls, `owed`, `struck`, `used`), `loc`
  (`ui`, `map`), `mem` (the repeat guards), `cards` (the current card per tool as `{ id, seed, ui, mem }`, `mem` a JSON
  string of the guard before the roll, and for the console `con`, a JSON string of the bargains and callbacks as they were,
  so a reload or an Earlier click redraws exactly the same card even after a callback was used or a bargain collected),
  `hist` (five per tool), `pins` (50, text), `capture` (400: `{ id, bucket: n|x|m|r, text, at }`). Capture never touches
  the campaign log; **Export tonight's note** downloads `b68g-s<NN>-notes.md`.
- **Saving.** Writes are debounced 800 ms, one in flight at a time; what is added meanwhile goes when it lands, even
  after leaving the page, and a hidden tab or `pagehide` sends what is pending as a `keepalive` request. A network error,
  409, 429 or 5xx retries with backoff; any other refusal is shown as "Not saved", kept in `b68.gm.sticky` and never
  resent, so later changes still save. Sizes are measured in bytes: past 240 KiB only rolls are taken, past the server's
  256 KiB nothing. The page refetches the state on focus.

## The display (`#display`, `app/display-page.js`, `app/display.css`)

Full screen (no header, nav or banner) for an iPad signed in as the GM. Boot mounts
`B68DisplayPage.mount(container, { gm, db, figures, cast, isGM })` once the files settle (`db` is the resolved db) and
calls `unmount()` on leaving; anyone but the GM sees a message instead. The GM page's **Display** button opens it.

The display offers **no way back** to the GM page (no link, hidden or not): the iPad lies in front of the players,
signed in as the GM. Run it as a Home Screen app (Share, Add to Home Screen), which has no address bar, and leave or
change it from the GM's own device. Its sanitiser applies the same rules as the server's `checkSvg` (namespaced
elements, `<a>`, `xml:base`, backslashes, `image-set()` / `src()`, raster `data:` images only on `<image>` /
`<feImage>`). The proper follow-up is a dedicated display sign-in (a `DISPLAY_EMAILS` role that can read the display and
nothing else), so the iPad never holds a GM session.
