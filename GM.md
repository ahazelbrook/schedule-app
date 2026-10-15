# GM tools: the API and the secrecy contract

The `#gm` page (the console with its Situations and Classic views, the location generator, street scenes and the engagement
roll) and the `#display` page (an iPad signed in as the GM) run on three GM-only endpoints. The generators' tables hold '68
text and GM-only secrets, so they never enter git: the GM builds a **pack** from the vault on their own PC (`npm run
gm:pack`, into the git-ignored `gm-private/`) and uploads it, from the browser or with `npm run gm:push -- --only pack
--yes` (see `SYNC.md`, which also moves what happened at the table back into the vault). Code: `functions/_lib/gm.js`,
`functions/api/gm/*.js`; tables in `migrations/0004_gm.sql`. The pack parts are `console`, `location`, `campaign`, `npc`,
`scenes` and `engagement` (`scripts/gm-pack.mjs` lists what each holds).

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
| `GET /api/gm/display` (ambient) | also carries `ambient: { seq, doc, updatedAt }`. `?seq=N&aseq=M` → `{ seq, unchanged: true, ambient: { seq, unchanged: true } }` while both are current; otherwise the full display, with `ambient` `{ seq, unchanged: true }` when only M is current. `?seq=N` alone is the old answer. |
| `GET /api/gm/ambient` | `{ seq, doc, updatedAt }` (`0`, `{}`, `null` until written). GM only; the display sign-in is refused (it reads the doc through the display). |
| `PATCH /api/gm/ambient` | top-level merge (`null` deletes, `skip: true` bumps a counter) → `{ seq, doc, updatedAt }`. Keys: `mode` auto/pin/off, `scene`, `playlist` (1–12 distinct ids), `intervalMin` 3–30, `skip`, `crew { heat 0–9, wanted 0–4 }`, `score { name, district, target, reveal, view plan/rings, board, iso }` (both svgs through `checkSvg`; the server sets `at`). Stored doc at most 1.4 MiB, in `gm_ambient` (migration 0006). |

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
- **Layout.** Laptop (>= 1100 px): the console (the Situations | Classic toggle, Position, controls, the four buttons, the card, "Earlier:" the last five rolls) |
  a side panel with **Location (B)**, **Street (S)**, **Engage (E)**, **NPC (N)**, **Rules (T)** and **iPad (I)** | the state rail (crew heat, wanted, rep, stacks and
  vault from the table, read only; table clocks; the pack's world clocks; bargains owed with **Collect**; pins; who is on
  stage) | the capture bar at the foot. 600–1100 px: two columns, the rail below. Phone: a Console | Location | Street | Engage | NPC |
  State bar, the Position switch at the top, the situations a 2 × 2 grid (Classic: 3 × 3), the other controls behind a "Scene" line,
  capture on a floating button.
- **Keys** (only on `#gm`; never while typing, never with Ctrl/Alt/Cmd): `1`–`4` roll a situation (Classic: `1`–`9` roll a single table), `B` `N` `S` `E` `T` `I` switch the panel
  (Location, NPC, Street scene, Engagement, Rules, iPad), `P` `X` `M` open capture as Name / Loose end / Moment (Enter files, Esc leaves), `L` files
  the last roll under "Rolled at the table", `H` blanks the screen until any key or tap, `0` clears the iPad to its ambient scene (the same as **Clear → ambient**).
- **Situations and Classic.** The console opens on **Situations**: four buttons, each a moment in the roll: `1` **Before** (a Devil's
  Bargain), `2` **4/5**, `3` **1–3**, `4` **Someone**. A large three-way **Position** switch (controlled / risky / desperate, with what
  it means for severity, winds and harm) sits above them, always on screen; the other controls stay (scene, district, PC, NPC,
  threat); there is no Result control (the button is the result). A card is a **lead box** (one big line, its chips, its own
  detail under *More*), at most three one-line **Or** rows that each open to their full section, and **one** actions row merged
  from every section (bargains owed, callbacks used, ticks...), then Pin and Copy. Under the cards a small **Single tables** row
  holds the nine classic rollers (no keys). **Classic** is the nine-button console exactly as it was (keys `1`–`9`, the Result
  control): the **Situations | Classic** toggle in the console header is one tap and is remembered per device
  (`localStorage` `b68.gm.view`; without storage it opens on Situations). The release switch is `SITUATIONS_DEFAULT` near the top
  of `gm-page.js`: `false` hides the toggle and shows Classic only (the safe release; rollback is also one tap on the toggle).
  Composed cards are stored under `cards.situation` / `hist.situation` (replay info: `{ id: 'situation', situation, seed, ui, mem }`),
  never under `console`: code from before redraws any unknown console id as a Devil's Bargain. Classic and single tables keep
  `cards.console` / `hist.console`. In Situations, Earlier lists the last five across both. Position is the same live control in both views.
- **Location.** The generator's controls and Roll, then the card (since 15/10/2026), then the map.
  - **The glance card** (`B68GmLocation.glance`): the name and place, **Say** (the first line of the street
    description, built only from fields `playerSummary` already shows) with the **Street description on iPad** button,
    then Whose (faction, Tier, hold, district Security), the bands (room count, locks, ★ on the target's band, dashed
    when the players can see it), the target, and Flags (off turf, a low Tier holding a high-value target, a district
    clash, low paranormal, a district rule, ring-skips).
  - **Folds** (`B68GmLocation.folds`), closed by default: Read aloud, Ways in, one per band, Opposition (both threats and
    the dossier), Block & word out, Plan & routes (the ring-skips), Reference (the four ratings, the band labels, why
    the target is there, the band note, the target type's note, the flags in full, Also here, the plan geometry, the
    fixed lines on the service side and back route). A band note that says to call it at the table also shows in the
    band fold of the room it names. Wording is shortened in the folds only, never in `generate()`, because the map kit,
    the canvas and `playerSummary` read the roll. Open folds are remembered per device (`b68.gm.locfold`, fold ids only).
    The glance card and every fold are GM-only and carry the badge.
  - **Pin** stores the glance card; **Copy** and **Download note (.md)** keep the whole card (`cardLines`, `noteBody`).
  - **The map**: view, theme, layer (GM / Player) and the bands revealed to the player layer, Draw; then the warning
    line, **Show on iPad**, **Set as score scene** and **Clear → ambient** together, never in a fold; then the map;
    Download SVG / note (.md) / canvas fold under Downloads. **Show on iPad** is enabled only on the player layer, and
    the code renders the player layer itself and refuses any other svg (`gate` in `gm-page.js`; tested in
    `gm-nosecrets.test.mjs`, `gm-page.test.mjs` and `gm.e2e.mjs`). The street description goes to the iPad as plain
    text through the `playerSummary` whitelist only (the gate passes non-svg kinds), so `playerSummary` and `pushText`
    are secrecy-critical.
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
- **Street (S) and Engage (E).** Two more side panels, ports of the vault pages `Tools/blades-68-district-scenes.md` and
  `Tools/blades-68-engagement-roll.md` (`app/gm/scenes.js`, `app/gm/engagement.js`; tables from the pack parts `scenes` and
  `engagement`; both optional: an older pack shows "The pack has no scenes part. Update the pack." in the panel).
  **Street**: a district select (or anywhere) and **Roll a street scene**: three read-aloud paragraphs, the four ratings, and a
  GM grid (landmark, who is out, what is in the way, word out, factions, the district rule). **Read-aloud to the iPad** sends
  only the three paragraphs as plain text (never the notable, the rumour or the rule). **Engage**: approach, loadout (Quiet
  3 / Loud 6) and one -1d / 0 / +1d control per factor; the card shows the pool before a roll, **Roll engagement** rolls it
  (a 0d pool rolls two and keeps the lowest) and the card gives the position, the dice and the closing "cut to the first
  obstacle" line. Both file a card under `cards.scenes` / `cards.engagement` (`{ hid, seed, ui, mem?, label, at }`; the street
  scene keeps its repeat-guard in `mem.scenes`, the engagement roll has none), five Earlier per tool, Pin, Copy and `L`. A reload
  or an Earlier click redraws the same card from the seed. Changing an engagement control drops the stored roll (the Earlier row
  keeps it) and shows the pool again; the controls live in `eng.ui` and `scn.ui`. Parity with the vault pages:
  `node scripts/gm-parity.mjs --scenes --engagement` (see the header of that script for the one deliberate difference).
- **NPC (`N`).** At the top the generator: **Roll an NPC** draws a card (the vault generator's port, `app/gm/npc.js`, fed by the
  pack's `npc` part and the campaign part): a portrait, what the table could see, what they want, how to play them (cast,
  status, dial, mannerism, verb), the levers, and the faction's dossier folded away. A roll is a seed plus the repeat-guard
  memory, so a reload or an Earlier click (five kept) redraws the same NPC and the same portrait. The portrait comes from
  `app/gm/figure-map.js` (an NPC's fields to a figure kit spec, with a built-in map while the vault's
  `Tools/blades-68-npc-figure-map.md` page does not exist); if the kit will not draw it, the nearest stock figure is used and
  the card says so. **Add to the cast** files the NPC as a hidden cast doc (tag `generated`, the look as the description, the
  play notes as GM notes) and stores the roll's seed and memory under `npcgen[<npc id>]` in the GM state, so `npm run gm:pull`
  can rebuild the vault card from it (`SYNC.md`). Pin and Copy work as on the other cards. Under it, the app's cast with
  portraits: **Show on iPad** (a hidden NPC asks first) and **Put on stage** (opens the NPC on the cast page, which stages it).
  A roll uses the pack's campaign part, not the live cast, so a freshly filed NPC is avoided by name only after the next
  pack build and push; that keeps the replay identical to the sync's. Code: `app/gm-page.js`, `app/gm/npc.js`,
  `app/gm/figure-map.js`, `scripts/lib/sync-npc.mjs`. Check: `checks/runtime/gm-npc-panel.e2e.mjs`.
- **State.** The GM state document holds `con` (the console state: `live` controls, `owed`, `struck`, `used`), `loc`
  (`ui`, `map`), `mem` (the repeat guards), `cards` (the current card per tool as `{ id, seed, ui, mem }`, `mem` a JSON
  string of the guard before the roll, and for the console `con`, a JSON string of the bargains and callbacks as they were,
  so a reload or an Earlier click redraws exactly the same card even after a callback was used or a bargain collected),
  `hist` (five per tool), `npcgen` (`{ seed, mem, at, s? }` per generated NPC id: the roll that made them), `pins` (50, text), `capture` (400: `{ id, bucket: n|x|m|r, text, at, s? }`). Capture never touches
  the campaign log; **Export tonight's note** downloads `b68g-s<NN>-notes.md`.
  `s` is the session number the campaign document held when the line was filed (`camp.session.number`, a whole number; absent when
  there was none), on typed lines, on lines filed by a card's action (a bargain accepted) and on rolls filed with `L`, so the sync
  (`npm run gm:sync`) files each line in the right session note. The campaign log never gets capture text.
- **Saving.** Writes are debounced 800 ms, one in flight at a time; what is added meanwhile goes when it lands, even
  after leaving the page, and a hidden tab or `pagehide` sends what is pending as a `keepalive` request. A network error,
  409, 429 or 5xx retries with backoff; any other refusal is shown as "Not saved", kept in `b68.gm.sticky` and never
  resent, so later changes still save. Sizes are measured in bytes: past 240 KiB only rolls are taken, past the server's
  256 KiB nothing. The page refetches the state on focus.

## The display (`#display`, `app/display-page.js`, `app/display.css`)

Full screen (no header, nav or banner) for an iPad signed in as the GM. Boot mounts
`B68DisplayPage.mount(container, { gm, db, figures, cast, isGM })` once the files settle (`db` is the resolved db) and
calls `unmount()` on leaving; anyone but the GM sees a message instead. The GM page's **Display** button opens it.

The display offers **no way back** to the GM page (no link, hidden or not). Its sanitiser applies the same rules as the server's `checkSvg` (namespaced
elements, `<a>`, `xml:base`, backslashes, `image-set()` / `src()`, raster `data:` images only on `<image>` / `<feImage>`).

### Ambient scenes (`app/ambient/`, the iPad panel `I`)

When nothing is spotlit the display plays an **ambient scene** underneath: `blank` means "the ambient plays", and the new
kind `dark` is lights out (true black). Scenes are same-origin pages in `app/ambient/`, framed with
`sandbox="allow-scripts allow-same-origin"` and served with `X-Frame-Options: SAMEORIGIN` and a no-network CSP (`app/_headers`).
URLs are built from the registry (`Pure.AMBIENT_SCENES`) and have **no `.html`**: the asset server 307s `x.html` → `x`, and the
service worker never caches a redirect. The registry ids are `harvest`, `watch` (City Watch feed, always `?api=off`, told heat and wanted by
`postMessage`), `duskwall`, `board` and `exploded` (the score scenes), and `testcard` (pin only).

- **Rotation.** Auto (default `harvest` → `watch` → `duskwall`, every 7 min, cross-faded), Pin (one scene), or Off. **Next scene** skips.
  A covered scene is kept for 30 s, then its frame is removed (a hidden frame gets no `visibilitychange` and would animate all night),
  and reloaded when the spotlight clears. A scene that has not loaded in 20 s is benched for 10 min.
- **Heat and wanted.** The GM page sends the campaign's crew heat and wanted (debounced 2 s) while the ambient is not off. The page
  has to have been opened as the GM in that page load; the iPad panel also corrects a stale value when it opens.
- **Score scenes.** **Set as score scene** (Location panel, player layer only) renders the board (`plan`, board theme) and the exploded
  site (`iso`, blueprint) from the current roll at the revealed bands, through the same gate and hidden-name scan as Show on iPad.
  A plan that names a hidden room is redrawn as `rings`; a leaking iso is refused. Bands beyond public ask first. Only the place name and
  district go with it (`target` is always empty). It **never updates on its own**: press it again after revealing more. The shells
  (`planning-board`, `score-exploded`) hold no data; they post `b68:ready` and the display answers with `b68:score` (both svgs
  re-sanitised, four crew polaroids drawn with the figure kit, `Pure.POLAROIDS`).
- **Checks.** `check:ambient` (assets), `ambient-shells.test.mjs`, `check:display-ambient` (e2e), plus the ambient cases in
  `checks/api/gm.mjs`, `display-role.mjs`, `display.test.mjs`, `gm-page.test.mjs` and `gm-nosecrets.test.mjs`. The e2e checks take
  `PW_CHANNEL=msedge` when Playwright's own Chromium is not installed.
- **Deploy.** `npx wrangler d1 migrations apply DB --remote` (0006) before `wrangler deploy`.

### The display sign-in (`DISPLAY_EMAILS`)

A third role, `display`, so the iPad never holds a GM session. An email in `DISPLAY_EMAILS` (comma-separated, case-insensitive,
like `GM_EMAILS`; the GM wins if an email is in both) gets exactly two calls: `GET /api/me` and `GET /api/gm/display`.
Everything else, any method, known route or not, is the same 403 ("this is the table display sign-in: it can only show
the display") from `functions/api/_middleware.js` before the body is read or the database touched, so a route added later is
refused by default. It is never recorded in `members`, never listed as a player, and `PUT /api/gm/display` stays GM only.
With `DISPLAY_EMAILS` unset the role does not exist. Check: `npm run check:display-role`.

**To turn it on** (Alex's steps, not done by code): pick an email for the iPad, add it to the Cloudflare Access allow policy,
then `npx wrangler secret put DISPLAY_EMAILS` and sign the iPad in with that email. `scripts/deploy.sh` does not manage this secret.
The display page's NPC view reads `npcs`, which this role cannot; it falls back to the pushed title and caption.
