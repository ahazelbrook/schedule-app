# GM tools: the API and the secrecy contract

The `#gm` page (the console with its four Situations, the location generator, street scenes, the score generator, the chase
board and the downtime cards) and the `#display` page (an iPad signed in as the GM) run on three GM-only endpoints. The generators' tables hold '68
text and GM-only secrets, so they never enter git (the downtime cards' tables are original writing, so they are in git, in
`app/downtime-tables.js`): the GM builds a **pack** from the vault on their own PC (`npm run gm:pack`, into the git-ignored
`gm-private/`) and uploads it, from the browser or with `npm run gm:push -- --only pack --yes` (see `SYNC.md`, which also
moves what happened at the table back into the vault). Code: `functions/_lib/gm.js`, `functions/api/gm/*.js`; tables in
`migrations/0004_gm.sql`. The pack parts are `console`, `location`, `campaign`, `npc`, `scenes`, `score`, `prep`,
`screen` and `downtime` (`score` and the last three optional; `scripts/gm-pack.mjs` lists what each holds). The `downtime` part carries the
house rule's two d100 tables, the Benefits and the Mishaps (`T.benefit`, `T.mishap`, from the vault note with `gm_downtime: true`),
and is laid over the Downtime panel's built-in tables (see Downtime (D) below). The `score` part carries the score generator's tables (`T`,
from `Tools/blades-68-score-generator.md`) with the location part's faction dossiers, district names and notables, and building types laid
over them as `T.loc`, so each has one source; the `campaign` part also carries `crew`, the crew sheet's type, Tier, hold, enemies and
abilities (see Score (J) below). The `engagement` part went with Engage.

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
| `PUT /api/gm/display` | `{ kind, title?, caption?, svg \| npcId \| text \| md \| file, showTitle? }` → `{ seq, display, updatedAt }`; `seq` goes up by one on every PUT. |
| `GET /api/gm/display` (ambient) | also carries `ambient: { seq, doc, updatedAt }`. `?seq=N&aseq=M` → `{ seq, unchanged: true, ambient: { seq, unchanged: true } }` while both are current; otherwise the full display, with `ambient` `{ seq, unchanged: true }` when only M is current. `?seq=N` alone is the old answer. |
| `GET /api/gm/display` (transcriber) | also carries `stt: { seq, want, session }`: whether the GM wants the iPad listening (`on` / `off`) and the session number to stamp on its lines, and **nothing else**: never a speaker name, the iPad's own report, the PC's heartbeat or a transcript line, whoever asks. Its `seq` is made from those two values alone, so the iPad's reports (which rewrite the control document every minute) never move it. `?seq=N&aseq=M&sseq=K` → `{ seq, unchanged: true, ambient: { seq, unchanged: true }, stt: { seq, unchanged: true } }` while all three are current; otherwise the full display, each part `{ seq, unchanged: true }` when its number is the one given and in full when not. Without `sseq` (a display page from before the transcriber rode along) there is no `stt` and the answers are the ones above. Why: one request where the display and the transcriber used to make two (see "The display", how it polls). |
| `GET /api/gm/ambient` | `{ seq, doc, updatedAt }` (`0`, `{}`, `null` until written). GM only; the display sign-in is refused (it reads the doc through the display). |
| `PATCH /api/gm/ambient` | top-level merge (`null` deletes, `skip: true` bumps a counter) → `{ seq, doc, updatedAt }`. Keys: `mode` auto/pin/off, `scene`, `playlist` (1–16 distinct ids), `intervalMin` 3–30, `skip`, `crew { heat 0–9, wanted 0–4 }`, `score { name, district, target, reveal, view plan/rings, board, iso }` (both svgs through `checkSvg`; the server sets `at`). Stored doc at most 1.4 MiB, in `gm_ambient` (migration 0006). |

- **Pack.** Part names `[a-z0-9-]{1,32}`; at most 12 parts; `body` a JSON object (or a string holding one), at most
  900 KiB as JSON; `src` an object, at most 2 KiB. A part's `version` is the first 12 hex digits of the SHA-256 of
  `JSON.stringify(body)`; the pack's `version` hashes every part's name, version and src (`'0'` when empty). Stored in
  `gm_pack(campaign, part, version, src, updated_at /* ms */, body)`.
- **State.** The `campaigns` row `<CAMPAIGN>#gm` (beside the campaign document; `/api/campaign` never reads it). Patch
  and stored document at most 256 KiB each; optimistic `updated_at` check with retries, 409 when it keeps colliding.
- **Display.** `kind` is `blank`, `dark`, `svg`, `npc`, `text`, `rule`, `cards` (1 to 8 opportunity cards, see Cards below) or `handout` (`file`: a plain image file name in `app/media/handouts/`, png/jpg/webp/svg; `showTitle` true shows the title caption; see Handouts below); other keys are dropped. `title`, `caption`,
  `text` at most 2000 characters (`text` required for `text`); `npcId` an id `[A-Za-z0-9_-]{1,80}`; `md` (required for
  `rule`) a rules entry's Markdown, at most 40000 characters. The rules page's **Show on iPad** (GM only, on every
  entry and on a house-rule twin) sends the entry without the compiler's `[TODO]` notes and `%%` comments; the display
  renders it with `markdown.js` (which escapes all text), parses that inert in a `<template>`, and keeps only plain
  structure (`Pure.cleanRuleTree`): links become their words, anchors, page chips and `[TODO]` notes go, folded
  callouts open. The text scrolls on the iPad. A push from the rules page tells the GM page through a `b68:display`
  window event, so "On the iPad now" stays true. `svg` is the player-safe render:
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
display(seq, aseq, sseq), setDisplay(d) }` (and `ambient`, `patchAmbient`, `stt`, `patchStt`, `sttToken`, `transcript`, `addTranscript`; HOSTING.md
lists them all); `opts.version` asks for the unchanged answer, and the three seqs of `display` are the display's, the ambient's and the
transcriber's. Each returns the API's JSON, or rejects
with `err.status` (403 for a player) or `err.network = true`. In the claude.ai artifact there is no `window.claude.gm`.

## The page (`#gm`, `app/gm-page.js`, `app/gm.css`)

GM only: the nav's **GM** button shows only for the GM on the hosted build; anyone else (and the claude.ai artifact) gets a
one-line message at `#gm`. Boot calls `B68GmPage.open(root, api)` / `close()` / `campaign(doc)`, and `purge()` when the
signed-in viewer is **known** not to be the GM (every `pack:*` key in IndexedDB and `b68.gm.sticky` go). When `/api/me`
fails and nobody is known, nothing is purged.

- **First run.** With no pack on the server the page asks for `gm-private/b68-gm-pack.json` (built by `npm run gm:pack`),
  checks it (`format` 1, `console` and `location` parts with `T`), previews the parts and uploads one part per
  `importPart` with a progress bar; parts the server holds that the file lacks are removed. Each module checks its own part
  (`B68GmConsole`, `B68GmLocation`, `B68GmNpc`, `B68GmScenes`, `B68GmScore`: `check(T)`; `B68GmDowntime`: `check(T, part)`, the part laid
  over the built-in tables): the table entries a part lacks are listed
  as a **warning** in the preview and, for the pack the page loads, in the Menu under **Pack check** (with one toast per page load).
  A warning never stops the upload, and a roll that needs a missing entry uses a neutral word. **Update pack** does the same
  again; **Forget GM data on this device** drops the local copies. After that, each visit compares the cached part
  versions with `pack()` and fetches only what changed; if a part will not download, the page carries on with the copy on
  the device ("offline copy" in the header). The header shows "Campaign data exported DD/MM/YYYY", amber when
  more than three days old.
- **Layout.** Laptop (>= 1100 px): the console column, top to bottom, nothing above the card but what rolls it: **Position**,
  the **Scene** line (one row of labelled chips, `Scene: any · District: any · Aim: anyone · NPC: … · Threat: 3`, that opens
  to the scene, district, PC, NPC and threat controls; closed by default at every width), the four Situation buttons, the
  card, "Earlier:" the last five rolls, and **More tables** (the nine single tables, folded) |
  a side panel with **Prep (R)**, **GM screen (T)**, **Location (B)**, **Street (S)**, **Score (J)**, **Chase (C)**, **NPC (N)**, **Downtime (D)**, **Cards (O)** and **iPad (I)** | the state rail (crew heat, wanted, rep, stacks and
  vault from the table, read only; table clocks; the pack's world clocks; bargains owed with **Collect**; pins; who is on
  stage) | the capture bar at the foot (buckets, the input, **File**, "N filed", **File last roll**). 600–1100 px: two columns, the rail below. Phone: the same bar as the laptop, 44 px
  (`’68 GM · Session · iPad: … · Menu`), then a Console | Prep | Location | Street | Score | Chase / NPC | Downtime | Cards | GM screen | iPad | State
  bar in two full rows of six (every segment in reach, nothing to drag sideways), both stuck to the top; the Position switch first,
  **Now in** (its select moves into the Scene line here) and the Scene line, the situations a 2 × 2 grid, the other controls behind the
  Scene line, capture on a floating button. After a
  roll the card is scrolled into view by the least scroll that shows it (the whole card when it fits, else its lead box; the
  console column on a laptop, the page on a phone), so Position stays on screen when there is room: a roll is never below the fold.
- **The app layout** (`body.gm-app`, 16/10/2026; the only layout, at every width, since 18/10: the "Classic layout" switch and
  the `b68.gm.layout` preference went): the window is the page. While the tools are open the
  site header and footer give way to a slim top bar (the session, **Now in**, Saved, a
  stale-pack note, the beat, **Find**, **iPad:** what the players see, **Listening** with whether the PC is copying (only once
  the transcriber has ever been set up: the pill is hidden while `gm_stt` has never been written), **Clear → ambient**, **Lights out**,
  and a **Menu** with what is not play: the pack's export date, the **Pack check** (the table entries the pack lacks, only when it lacks
  some), **Open the display page (for the iPad)**, Export tonight's note,
  Clear tonight's capture (it confirms), Update pack, the site's pages and Forget GM data). When the Access session has ended a red
  **Signed out: reload to sign in. Your notes are kept on this device.** strip runs across a second row of the bar (see Saving).
  On a laptop the three columns each
  scroll on their own and capture sits fixed at the foot, so a
  long Prep note or the GM screen never carries the console or the rail away; toasts sit above the capture bar, never over its
  input. The side tabs are one row with their keys showing at 1280 px (Prep, GM screen |
  Location, Street, Score, Chase, NPC, Downtime | Cards, iPad). Prep and the GM screen show their sections as an outline beside the text, the one
  being read marked. **Focus** (`F`, or the button by the tabs) shrinks the console to its keys on any tab (it replaces Prep's
  Wide, and shares its setting, `b68.gm.prepWide`); a roll made in Focus leaves Focus so the card shows (a toast says so, once
  per page load). Empty rail boxes are one line. Below 1100 px the page scrolls under the sticky bar. `body.gm-app` turns it
  on while the tools are open; the loading and import screens keep the site header.
- **Table aids** (17/10/2026):
  - **Find** (`Ctrl+K`, `/`, or **Find** in the bar): one box over the open Prep note (its sections and transclusions),
    the GM screen, the pack's NPCs, PCs, factions and world clocks, the cast's NPCs made in the app, the table clocks,
    callbacks, the running chase's panels (by caption; one jumps to the Chase tab), and tonight's capture lines, and a few entries of the rules (from the copy this device already holds: Find never
    starts a download). Every word must match; title matches first. `↑` `↓` choose, `Enter` jumps
    (an NPC, PC or faction opens its peek card in the Prep tab; a rules entry opens in the GM screen pane; a capture or callback is
    copied), `Esc` shuts it.
  - **The beat in the bar**: the newest beat started in the Prep tab's run order, with its minutes against the row's
    budget (amber at the budget, red at 1.5x). Tap it to see the row; **Next beat** starts the next row not yet started.
  - **The session in the bar**: while the table's counter is 0 it shows the open Prep note's session, "(prep)".
  - **Clocks on the iPad**: **Show on iPad** under Table clocks in the rail sends the clocks the players may see (never
    a hidden one) as a picture (an svg, checked by the server like a map). While it is up, a clock changing on the table
    sends it again.
  - **Naming a speaker from a line**: in the iPad panel's newest lines, the speaker is a button; it opens **Who is who**
    on that speaker's box. `Enter` saves the name.
  - **Update pack asks first** when the file would lose prep the app has (a part gone, a prep note gone or much
    shorter): the button reads **Upload anyway** and confirms (the same guard as `gm:pack` and `gm:push`, SYNC.md). A part the app
    retired on purpose (`engagement`, Engage's) is not a loss, in either guard (`RETIRED_PARTS`).
- **Keys** (only on `#gm`; never while typing, never with Ctrl/Alt/Cmd but `Ctrl+K`): `1`–`4` roll a situation (`5`–`9` do nothing: the single tables have no keys), `R` `B` `N` `S` `J` `C` `D` `O` `T` `I` switch the panel
  (Prep, Location, NPC, Street scene, Score, Chase, Downtime, Cards, GM screen, iPad; `R` and `T` also put the cursor in that pane's find box, so typing
  lands there and not on the shortcuts), `F` Focus, `/` or `Ctrl+K` Find, `P` `X` `M` open capture as Name / Loose end / Moment (Enter files, Esc leaves), `L` files
  the last roll under "Rolled at the table", `Shift+H`, or `H` twice within a second, blanks the screen until any key or tap (one stray `H` does
  nothing; the first alone says how, once per page load), `0` clears the iPad to its ambient scene (the same as **Clear → ambient**).
- **Situations.** The console is the four Situations, one mode only (the Classic nine-button view, its toggle, the `b68.gm.view`
  preference and the `SITUATIONS_DEFAULT` switch went on 18/10/2026): four buttons, each a moment in the roll: `1` **Before** (a Devil's
  Bargain), `2` **4/5**, `3` **1–3**, `4` **Someone**. A large three-way **Position** switch (controlled / risky / desperate, with what
  it means for severity, winds and harm) sits above them, always on screen, with a small **Dots** chip (0 1 2 3 4; tap to set, tap again to clear, unset by default, no key) under it that you set per roll: when set, the filed 4/5 or 1-3 line carries it ("A 4/5 (risky, 2d, Name): ..."), the Night Shift reads it back for the zero-dot XP candidate, and it resets once the roll is filed or the Rack is cleared; the other controls (scene, district, PC, NPC,
  threat) fold under the **Scene** line; there is no Result control (the button is the result). A card is a **lead box** (one big line,
  with the **spend sentence** under it when a threat is set, its chips, its own detail under *More*, which does not repeat the lead
  line), at most three one-line **Or** rows that each open to their full section, and **one** actions row merged
  from every section (bargains owed, callbacks used, ticks...), then Pin and Copy. The console's recurring coaching lines
  (`coach: true`: "say it before the dice...") sit under a closed **Why** in every section (in More for the lead, in the body of an
  Or row), so the card reads as the draw and its numbers; Pin and Copy leave them out, show the lead line once, and put the position
  chip ("risky → 2 winds · harm 2") on the title line (`L` files the title and the lead, which never held coaching). Under the card and Earlier, **More tables**
  folds out the nine single tables (no keys); a pack whose console has no situations layer shows a note where the four buttons
  go, and its single tables still roll. Composed cards are stored under `cards.situation` / `hist.situation` (replay info:
  `{ id: 'situation', situation, seed, ui, mem, composeVersion }`), never under `console`: code from before redraws any unknown console id as a
  Devil's Bargain. A card stored before the composition was versioned has no `composeVersion`: it is redrawn with the current
  composition and a quiet line on the card says so ("Redrawn with the current tables"). Single tables keep `cards.console` /
  `hist.console`, where rolls from before the Situations also live, and
  Earlier lists the last five across both; the newer of the two cards is the one on screen. An **Earlier** chip names what the
  card is (the NPC for a Someone, Contact or Face card; a Devil's Bargain without its "Want +1d?" lead-in), with the time it was rolled and its
  position (`21:14 · risky`) in small type under it and in its tooltip; the other tools' chips carry the time.
- **Now in** (the district every tool starts from, 18/10/2026). One select in the top bar (on a phone, where the bar has no room, in the
  Scene line), kept in the GM state as `now: { district }` (`''`: anywhere). The console's **District**, the Street scene's, the
  Location's and the NPC generator's pickers each lead with **Now in: <district>**, which follows it; picking a district there is that
  tool's own and stays through a change of Now in, **any** keeps a tool on any, and the first choice gives the tool back to Now in.
  Each tool has its own district list (its pack part's), so a name is matched without case, a leading "the" or punctuation (the
  tool's own spelling is what it rolls on), and a tool whose list lacks it says so ("Now in: any (no <district> here)") and rolls on any. A roll
  stores the district it resolved to in its own `ui` (`cards.<tool>.ui`, the same as before), so Earlier, a reload and a replay never
  move when Now in does; Now in changes what the *next* roll starts from, never a stored card. A tool's stored choice (`con.live.district`,
  `loc.ui.district`, `scn.ui.sel`, `npc.ui.district`) is `''` or absent (never set here: follows Now in), `'*'` (any) or a name (its
  own); `'*'` never reaches a roll, and a state from before Now in reads the same (a district already set is that tool's own pick).
  The Score panel's **Where** is the exception: its default is where the *target* is (the score happens wherever the target is), and
  **Now in: <district>** is one of its choices (`sc.ui.district` is `''`, `'now'`, `'*'` or a name; a card stores the district it resolved to).
  Checks: `gm-page.test.mjs` (12a–12f, 18d), `gm.e2e.mjs`, `gm-scenes.e2e.mjs`, `gm-npc-panel.e2e.mjs`.
- **Location.** The generator's controls and Roll, then the card (since 15/10/2026), then the map. A roll draws the GM-layer
  **rings** map at once (the controls go to rings / GM, the theme stays; Draw is for another view, theme or layer).
  - **The glance card** (`B68GmLocation.glance`): the name and place, **Say** (the first line of the street
    description, built only from fields `playerSummary` already shows) with the **Street description on iPad** button,
    the **Plan** (one sentence under Say, outside its box: the front door and its obstacle, the target room and band, the
    locks on the way down; it names the target, so it is GM only and reaches no push: `gm-nosecrets.test.mjs` (h)),
    then Whose (faction, Tier, hold, district Security), the bands (room count, locks, ★ on the target's band, dashed
    when the players can see it), the target, the district **Rule** (its first sentence, a row only when there is one), and
    Flags, which are now only the rare cases (off turf, a low Tier holding a high-value target, a district clash, low
    paranormal; the ring-skips sit in the Plan fold's hint).
  - **Folds** (`B68GmLocation.folds`), closed by default: Read aloud, Ways in, one per band, Opposition (both threats and
    the dossier), Block & word out, Plan & routes (the ring-skips), Reference (the four ratings, the band labels, why
    the target is there, the band note, the target type's note, the flags in full, Also here, the plan geometry, the
    fixed lines on the service side and back route). A band note that says to call it at the table also shows in the
    band fold of the room it names. Wording is shortened in the folds only, never in `generate()`, because the map kit,
    the canvas and `playerSummary` read the roll. Open folds are remembered per device (`b68.gm.locfold`, fold ids only).
    The whole page is GM-only, so nothing on the card says so; a mustard **Players see** chip marks what the players can see:
    a revealed band (in the bands row and on its fold) and the Say box once the street description has gone to the iPad (this
    roll, this page load).
  - **Pin** stores the glance card; **Copy** and **Download note (.md)** keep the whole card (`cardLines`, `noteBody`).
  - **Site for a score** (a row under the card, only when the pack's prep part has score cards): a select of the scores and
    **Save as the site for …**. See **Score sites** below.
  - **The map**: layer (GM / Player) and the bands revealed to the player layer, Draw; then the warning
    line, **Show on iPad**, **Set as score scene** and **Clear → ambient** together, never in a fold; then the map; under it
    **View & theme** (a fold, presentation only) and Download SVG / note (.md) / canvas under Downloads. **Show on iPad** is enabled only on the player layer, and
    the code renders the player layer itself and refuses any other svg (`gate` in `gm-page.js`; tested in
    `gm-nosecrets.test.mjs`, `gm-page.test.mjs` and `gm.e2e.mjs`). The street description goes to the iPad as plain
    text through the `playerSummary` whitelist only (the gate passes non-svg kinds), so `playerSummary` and `pushText`
    are secrecy-critical.
- **Reveal.** Every new roll and every replay starts with the public band only. The ticks count only while Layer is
  Player (on the GM layer the street description and everything else use public only), and sending anything beyond public
  to the iPad asks first, naming the bands.
- **Hidden names.** Map kit 0.2 titled a `plan` or `section` level of the player layer after the room on it, even when that room was
  hidden. From 0.5 (vendored: 0.6.0, 21/10/2026) every floor is titled generically ("Basement", "Ground floor", "Upper floor", "Top
  floor") and a hidden room's name is not in the player file at all. The page still scans every player render for the names of hidden
  rooms, both threats and a hidden target, and refuses to send one that holds a name ("This view would name a hidden room: use Rings
  or Iso, or reveal more bands"); the in-page Player draw shows the same warning and the Player SVG download is refused. The kit's four
  floor titles are not counted (`P.LEVEL_TITLES`): a hidden room called "Basement" tells the crew no more than the title of that floor,
  which the kit prints for every building with a basement.
- **Street (S).** A side panel, a port of the vault page `Tools/blades-68-district-scenes.md` (`app/gm/scenes.js`; tables from the
  pack part `scenes`, optional: an older pack shows "The pack has no scenes part. Update the pack." in the panel). A district select
  (or anywhere) and **Roll a street scene**: three read-aloud paragraphs, the four ratings, and a GM grid (landmark, who is out, what
  is in the way, word out, factions, the district rule). **Read-aloud to the iPad** sends only the three paragraphs as plain text
  (never the notable, the rumour or the rule). The card is filed under `cards.scenes` (`{ hid, seed, ui, label, at }`; the repeat-guard
  is `mem.scenes`), five Earlier, Pin, Copy and `L`. A reload or an Earlier click redraws the same card from its seed; the district
  control lives in `scn.ui`. Parity with the vault page: `node scripts/gm-parity.mjs --scenes`. Engage (E, the engagement roll
  calculator) went on 17/10/2026, with its `engagement` pack part and the `eng` / `cards.engagement` / `hist.engagement` keys of the
  notes (the page drops them from the state once); the vault page `Tools/blades-68-engagement-roll.md` stays as a reference.
- **Score (`J`; on a phone the Score segment).** The outline of a heist, rolled for inspiration: for when the table is lost, has a rough idea,
  or an NPC turns up and the players start poking around for a favour. It took Engage's place in the tab row. `app/gm/score.js`
  (`B68GmScore`: pure logic, seeded, no DOM and no table text) draws it from the pack part `score` (optional: an older pack shows "The pack
  has no score part. Update the pack." in the panel, and the Pack check names what a part lacks), the campaign part and the GM's choices.
  **Nothing in this panel goes to the iPad**: **To Cards** is the one road to the players, through the Cards panel's own Show buttons.
  - **The pickers** (each on **any** by default; they are the planning meeting's slots, and the GM can set none, one or several):
    **Who's asking** (an NPC on stage, the last NPC roll, the cast, a campaign NPC, a faction, a kind of client from the tables, or
    **nobody**), **Target** (a faction with its Tier, the crew's enemies, someone on bad terms from the board's standing), **Job** (the
    crew's favoured operations first, then all), **Where** (the default is where the target is; or Now in, anywhere, or a district), **Crew**
    and **Tier**. Crew and Tier follow the table: the campaign document's `crew.type` and `crew.tier`, else the pack's crew sheet
    (`campaign.crew`), shown as "<crew> (the crew)"; picking another is for this panel only and never touches the table. An NPC picked as
    the client is kept with the choices as the strings the page resolved when they were picked (name, faction, district, role, want), so a
    replay never depends on a list that changed. The pickers follow the table, the stage and the last NPC roll, but never redraw under a
    list the GM has open.
  - **The card.** Title ("<job> · <target>"), sub (Tier · district · stacks, the scope), chips, then the **pitch** in the lead box (one of
    the crew's own opportunity seeds from the tables with its enemy phrase read as the target, or a composed line), **Who's asking**,
    **The job**, **Target**, **Where**, **Why now**, **Twist**, **Ways in** and **Pays** (the crew's Tier in dice, 0d being two dice
    keep the lowest, plus the target's Tier and a district's pay; who pays), and **The cloud**, folded (open or shut is remembered per
    device, with the Location folds): By the book, In the way, Their friends, Right now, Secret, Clock, Engagement (the Tier gap and the
    crew's ability notes), Called Shot, Even if it goes well, Also earns and District. A row the tables cannot fill is left out.
  - **↻ on a row** (the pitch, Who's asking, The job, Target, Where, Why now, Twist, Pays) rolls just that row again and keeps the rest;
    what reads the row follows (a new target brings a new place, new friends and new pay). Every section of a roll draws from its own
    seeded stream (`fnv(seed:section:bump)`), so ↻ raises that section's bump, the card keeps its seed, and no section before it moves;
    the new draw is repeated (up to 12 times) when it lands on the text already shown. A row the GM fixed with a picker has no ↻, and
    neither has one the tables leave a single choice for. The card and its Earlier entry change in place (no new entry), and a reload or
    an Earlier click redraws exactly the same card.
  - **Actions.** **To Cards** adds the score to the Cards panel as an opportunity card (From, Client, Target, Type, note, Payout; 120
    characters a field; after the last, eight at most) and says so in a toast. **Roll the site** opens Location with its pickers set from
    the score, as Score sites does, and rolls (what the location generator lacks is named in a toast and rolled on any). **A face** opens
    NPC with the faction and district pickers set from the client's faction, or the target's when nobody asks (not offered when an NPC
    asks). **Start the clock** puts the card's danger clock on the table's clocks, hidden, once (as Downtime does it; the card keeps the
    clock's id under `started`, so the button stays done after a reload). **Pin**, **Copy**, `L` (files "Score: <label>") and Earlier (five).
  - **A job for them**, on the NPC card, and **Job**, beside each name in the rail's On stage box, make that NPC the client, open Score and roll.
  - **State:** `sc.ui` `{ client, who, target, job, district, crew, tier }` (the pickers); `cards.score` `{ hid, seed, ui, mem, bump?, label, at,
    started? }` (`ui` the choices as the roll resolved them, `mem` the repeat guard before the roll, `bump` the sections rolled again);
    `hist.score` (five); `mem.score` (the guard itself: a short hash of each recent pick, per section). Never any table text.
  - **The pack.** `npm run gm:pack` builds the `score` part from the vault page `Tools/blades-68-score-generator.md` (`buildScore` in
    `scripts/gm-pack.mjs`), lays the location part's dossiers, district names, notables and building types over it as `T.loc`, and reads the
    crew sheet (the active note under `Campaigns/Group/` with `crew_type`) into `campaign.crew`; what it finds wrong is a warning (the
    script's header lists the checks). There is no parity script: the machinery is designed in the app, and the vault page's own roller is
    a simpler cousin.
  - Checks: `gm-score.test.mjs` (the module; with `B68_SCORE_PACK` set to a pack file, or `gm-private/b68-gm-pack.json` present, it also runs
    on the real tables and prints counts only), `gm-score-export.test.mjs` (the exporter, on an invented vault), `gm-page.test.mjs`
    (18a–18n), `gm-score.e2e.mjs`, and the secrecy sweeps in `gm-nosecrets.test.mjs`.
- **Chase (`C`; on a phone the Chase segment).** A chase strip that grows on the iPad as the chase clock fills (Alex, 21/10/2026). The
  strip is a comic strip, left to right: one panel per segment of the crew's clock. A roll that fills two segments draws one panel two
  slots wide, with one caption. A panel exists only once its segments tick: nothing is drawn ahead. The map kit draws it (0.6:
  `B68Map.chaseNew`, `chaseTick`, `chase`); `app/gm/chase.js` (`B68GmChase`) builds what the kit is given and reads the clocks back.
  With an older kit the panel says it needs 0.6, and nothing starts.
  - **Start a chase.** The street comes from the Location roll, the Street scene or a plain street type (the kit's grounds: a wide road,
    a lane, a raised walkway, a plaza, a roundabout, an arcade, a dead end, a canal path, a bridge). It follows what is on screen until
    the GM picks. Only the street's public fields go into the chase: never a room, the target, a threat, the watcher, a notable or a rumour.
    Then a name, the crew's clock (a name, and 4, 6 or 8), an opposing clock (none, shown or hidden; a name and a size), and what the
    crew and their pursuers are in (map kit tokens). A line under the crew's clock says a split crew shares one clock: one Lose the Tail
    clock for everyone ('68 p.262–263). It shows in play too.
  - **Tick.** Three big buttons: **+1** (limited), **+2** (standard), **+3** (great). Each draws one panel on the leg in play. Above
    them: what happened (the caption), the roll (GM only: who, action, position and effect, dice; it starts at "Finesse · ", the
    driver's action, BitD p.173, and a roll line left at that is no roll line), between ticks (flashbacks and fails
    before this roll, one per line; the table heard them, so the players see them), the level (above, street, below) and the time
    (Bluetime or Night: it can snap mid-chase). Level and time carry to the next tick. A tick past the leg's size is cut to what is left,
    and a toast says so. **Undo last panel** takes the last one back. The opposing clock has **−1** (take one back) and **+1**, **+2**,
    **+3** on its row: a consequence ticks it by its level, as a danger clock (BitD p.16), so a serious one is one press.
  - **Racing clocks** (BitD p.16). When both clocks fill on the same tick (the opposing clock fills with the panel that fills the crew's
    last leg, pressed just before it or after it), the panel says so: they escape, but the pursuers are outside the lair. When only the
    opposing clock is full, it says they were caught, unless the GM says otherwise.
  - **A second leg.** When the crew's clock is full, **Add a leg** ("Land the barge", 4) gives the next ticks a clock of their own.
  - **Show on iPad** sends the player copy, drawn here at the iPad's size (`layer: "player", layout: "ipad"`): no roll line, no GM
    note, no hidden clock. The page draws it from a copy of the chase without them (`B68GmChase.playerCopy`), then scans the svg for
    every one of them and refuses to send it if one is there (`chaseDisplay` in `gm-page.js`). Over 600 KiB it refuses with a toast.
    The server's `checkSvg` and the display's sanitiser check it as they check a map. While the chase is on the iPad, every tick, undo,
    leg or move of the opposing clock sends it again, as **Clocks on the iPad** does. Once something else is up, nothing more goes.
  - **The panel** shows the GM copy under the controls: every clock, the roll lines. The clocks list above the tick box marks the leg in
    play and the hidden clock. `L` files the last tick ("Chase: <caption> (+n)").
  - **End chase** (it asks) moves the chase to **Past chases**, a fold under the panel, with how it ended: the select beside it offers
    what the clocks say (they got away, they were caught, or the tie) and the GM may pick another or none. Past keeps the last 10 and
    64 KiB at most; the oldest go, and a toast names them.
  - **State:** `chase: { current, past: { <id>: chase }, ui: { level, time } }`. `current` is the kit's chase object (`schema:
    "b68-chase/1"`), stored whole on every change (a key the new one lacks is deleted). An ended chase gets `endedAt`, and `outcome` (`escaped`, `caught` or `tie`) when one was picked;
    the opposing clock keeps `fullAt`, the panel count when it filled (the tie is told from it). The start form
    is this page's only, never stored. Nothing here touches the table, its clocks or the campaign log.
  - Checks: `gm-chase.test.mjs` (the module and the gate), `gm-page.test.mjs` (19a–19e), `gm-nosecrets.test.mjs` (i),
    `gm-chase.e2e.mjs` (port 8861). `checks/runtime/fixtures/chase-kit-stub.js` was the stand-in written from the kit's spec
    before 0.6 was vendored; it installs only on a kit without a chase strip, so on 0.6 the checks run the real one.
- **NPC (`N`).** At the top the generator: **Roll an NPC** draws a card (the vault generator's port, `app/gm/npc.js`, fed by the
  pack's `npc` part and the campaign part): a portrait, what the table could see, what they want, how to play them (cast,
  status, dial, mannerism, verb), the levers, and the faction's dossier folded away. Above the button three pickers, each on
  **any** by default: **Faction** (or none, unaffiliated), **District**, and **Place** (the pack's `npc.T.place`, a vault table
  keyed by the location generator's building types: the profession comes from the place's `work` list; with the faction on
  any, about half the affiliated rolls come from its `factions`; with the district on any, its `districts` when it has them).
  An older pack without `T.place` shows no Place picker. **Use the location** (shown once there is a location card) copies that
  card's building, district and owning faction into the pickers, each one the NPC tables do not hold going back to any. With
  every picker on any the draws are the vault generator's, unchanged. A roll is a seed, the repeat-guard memory and the
  choices, so a reload or an Earlier click (five kept) redraws the same NPC and the same portrait. The portrait comes from
  `app/gm/figure-map.js` (an NPC's fields to a figure kit spec, with a built-in map while the vault's
  `Tools/blades-68-npc-figure-map.md` page does not exist); the one line under the portrait is the module's own `fig.note`
  (what was stripped, "a stock figure" when the kit would not draw it, or why there is none). When the figure could not be
  built (`fig.failed`), or the kit itself throws or is not loaded, the card draws no portrait and the note reads
  "No portrait: <reason>", never a blank. **Add to the cast** files the NPC as a hidden cast doc (tag `generated`, the look as the description, the
  play notes as GM notes) and stores the roll's seed and memory under `npcgen[<npc id>]` in the GM state, so `npm run gm:pull`
  can rebuild the vault card from it (`SYNC.md`). Pin and Copy work as on the other cards. Under it, the app's cast with
  portraits: **Show on iPad** (a hidden NPC asks first) and **Put on stage**, which stages them from here (a hidden NPC is
  revealed first, after a confirm, as the cast page does; `campaign.scene = { npcs: { id: true }, at }` through boot's
  `saveScene`, the same document the cast page writes); the rail's **On stage** box is the feedback, the button turns into
  **Off stage**, and a small "open in the cast" link opens them on the cast page.
  A roll uses the pack's campaign part, not the live cast, so a freshly filed NPC is avoided by name only after the next
  pack build and push; that keeps the replay identical to the sync's. Code: `app/gm-page.js`, `app/gm/npc.js`,
  `app/gm/figure-map.js`, `scripts/lib/sync-npc.mjs`. Check: `checks/runtime/gm-npc-panel.e2e.mjs`.
- **Downtime (`D`; on a phone the Downtime segment).** Personal business, heading "Downtime · personal business": one card per activity a
  PC takes in the downtime phase, to frame it at the table (`app/gm/downtime.js`, `B68GmDowntime`). The tables are original writing with no
  book text, so the panel works with any pack: `app/downtime-tables.js` (`B68DowntimeTables`, public like `content.js`, loaded before the
  module; it names the setting, so the module and `app/gm-page.js` name nothing of it). A pack part `downtime` is laid over them (any top-level
  key of its `T` replaces that table, a vice's tables one by one: the module's header). A part that lacks tables is listed by the Pack check,
  and the panel uses the built-in tables with a note. **The Benefits and the Mishaps come only from that part**: `npm run gm:pack` builds it
  from the vault note with `gm_downtime: true` (the house rule *the Morning After*, version 3: its "## Benefits" and "## Mishaps" entries,
  `**41–42 · Title.** …` under `### 41–60 · Band` headings, with a `**Play it:**` line; `scripts/lib/downtime-export.mjs`). They are drawn
  from a zine that is for personal use, so they never go into this public repo; with no part, the card says where the tables are.
  - **Who**: a chip per PC from the live sheets (boot's `characters()`: a slim copy of each filed character, never the figure spec, read on
    every draw and again when the characters snapshot changes) and **anyone**. Picking a PC prefills the vice (a select of the seven, theirs
    picked) and the purveyor (a text field) from their sheet; an edit is panel state (`dt.ui`), never written to the sheet.
  - **Activity**: chips in the module's order (Indulge vice, Recover, Long-term project, Train, Friend or rival, Lay low, Acquire; a phone shows
    the module's short labels). Then the activity's ONE row of buttons, each rolling the card at once (everyone rolls physical dice: the tap on
    the result is the roll): for Indulge vice, under the Vice and Purveyor, how the vice roll went, **Indulged** or **Overindulged** (on a
    phone one row, clear of the Capture button); "Rolled at the table:" **1–3**
    **4/5** **6** **Crit** for Recover, Lay low, Acquire and Long-term project (which also gets a select of the PC's own clocks, the first still open picked, or
    another project); **Insight** **Prowess** **Resolve** **Playbook** for Train; **Friend** / **Rival** under a select of the PC's contacts (a
    friend or a rival first), the relation the sheet gives that contact marked "on the sheet". The button that made the card on screen stays
    marked.
  - **The card** is the usual card (title and sub, chips, the lead box with its small line, the grid, one actions row with Pin and Copy). An
    Indulge vice card's lead is the night: a picture, then the line the host says, in quotes, for the GM to read aloud. Right under it sits
    **the morning after** (the house rule, version 3): "The morning after · Benefits" (or "· Mishaps", in the alarm colour, with a **?** that
    opens the rules on overindulging in the GM screen pane: its rules search for "overindulge"; the first hit about indulging opens), a **d100**
    box (a number pad on a phone; Enter or **Read it** reads it, 0 and 00 are 100; **Roll one** rolls it on the page), and a line that says
    roll high. Once the number is in, the box gives way to **two cards**: the entry it lands on, and one more from the same band (the same
    size, another story), each with its range, title, text, **Play it** and, for a Mishap, its cost (the overindulgence it names, with
    T.over's line in our words; Tapped adds a new source from the book). **Keep this** marks one and folds the other to its title (a second
    tap unfolds it); **Another** deals the band's next card in a seeded order (fresh ones first) while neither is kept; **Change** in the
    heading brings the box back. A small **Overindulged?** (or **Not overindulged?**) under the morning turns the same card to the other
    table, the d100 kept. All of these redraw the SAME card (its seed and memory: the module draws the morning last, so the scene above never
    moves; only `ui.res`, `ui.d100`, `ui.keep`, `ui.deal` and the label that names the card change). Once a d100 is in, both cards go into the
    repeat guard (`mem.downtime['morning.benefit' | 'morning.mishap']`, half the table at most), so the next card deals others; the card's own
    `mem` never moves. A card stored by the version before (a vice result, a picked overindulgence) opens as the night with the d100 to come.
  - **Start a clock: <name> (4)** (a clock the card suggests) puts it on the table's clocks through boot's `addClock` (an `add` op where the
    store takes `clockOps`, else the whole array: CAMPAIGN.md "Clocks"): `{ id: 'c_…', name, size, filled: 0, kind: 'danger', hidden: true }`,
    with the toast "Clock started, hidden from the players: <name>. Show it from the table page." The rail's Table clocks shows it. The card
    keeps the clock's id (`started`), so its button stays done after a reload and on its Earlier entry.
  - After a roll the card is scrolled into view as the console's is (when it is taller than the pane: its morning box, else its lead). `L` files
    "Downtime: <label>"; Earlier keeps five. **Nothing goes to the iPad**: the prompts and hooks are the GM's, so there is no Show on iPad.
  - State: `cards.downtime` `{ hid, seed, ui, mem, label, at, started? }`, where `ui` holds the resolved strings (the PC's name, the vice, the
    purveyor line, the contact line, the project's name, the district), so a reload or an Earlier click redraws the same card after a sheet
    changes, and `mem` is the repeat guard before the roll; `hist.downtime` (five); `mem.downtime` (the guard itself: small integer arrays);
    `dt.ui` `{ who (a character id, '' for anyone), act, vice, purveyor, project, contact }` (`project` and `contact` '' follow the sheet, `*`
    is none of the sheet's). Now in is the card's district: the tables' own spelling when their list holds it, else as the bar has it (a
    downtime card reads a district as words in a sentence, never as a table key).
  - Checks: `checks/runtime/gm-downtime.test.mjs` (the module), `gm-downtime-export.test.mjs` (the part), `gm-page.test.mjs` (17a–17m),
    `gm.e2e.mjs` (the laptop and the phone).
- **GM screen** (`T`; on a phone the GM screen segment). The GM screen: the vault note with `gm_screen: true` under the '68
  folder, which `npm run gm:pack` cuts at its `##` headings into the pack's `screen` part (`scripts/lib/screen-export.mjs`;
  text before the first `##` is an intro shown above them; a `## Related`, `## Provenance` or `## Sources` heading ends
  the cut; wikilinks become plain text). Book text, so it travels only in the pack, never in git. Jump chips per section,
  **Find on the screen** filters the sections by their words, **Show on iPad** sends one section as a `rule` display
  (caption "GM screen"). Under it, **The full rules** (also the last jump chip in the outline): a search box and the twelve common terms
  as buttons, answered in the pane by the rules page's own search over the rules this device holds (`B68Rules.load`, `.hits`,
  `.entry`; the server only when this device holds none). The hits are listed (title, book and chapter, a snippet with the words
  marked); one opens in place with **Show on iPad** (a `rule` display whose caption is the book and chapter, exactly what the
  rules page sends: the compiler's `[TODO]` notes never go) and a chip for the entries of the same title in the other books; **Open in the
  Rules page** (a new tab) stays as the way out, and is the whole answer when the module cannot search. In **Find on the screen**, a
  query with no section left offers the same words to the rules, and `Enter` there goes to the first section still showing (or
  searches the rules when none is). Checks: `checks/runtime/gm-screen.test.mjs`, `gm-page.test.mjs` (10c),
  `checks/runtime/gm-prep.e2e.mjs` (the Screen part, invented text; one invented house rule is the rules corpus).
- **Prep** (`R`, the first side tab; on a phone the Prep segment). The GM's prep notes as written in the vault, laid out in
  the design system. A note opts in with the property `gm_prep: true`; `npm run gm:pack` exports every such note under the
  '68 folder as the pack part `prep` (`scripts/lib/prep-export.mjs`): the note cut into Markdown blocks, each transclusion
  (`![[note#heading]]` on a line of its own) carried in as that section of the other note, and every task box matched to its
  line. Nothing parses a note into a model, so any layout works; a heading or table the page does not recognise renders as
  written. The page (`app/gm/prep.js`, `app/prep.css`) renders the blocks with `markdown.js`, cut at their `##` headings into
  sections with a sticky rail of section chips, and then adds what it recognises:
  - **task boxes** tick (GM state `prep.ticks[anchor]`: `{ at, s, rel, t }`); orange means ticked here and not yet in the
    note, solid ink means ticked in the note (locked here). `npm run gm:pull` ticks the box in its note (SYNC.md, "Prep");
  - a table with a `✓` or `☐` column: its cells tick (`prep.cells`), filed as lines under `## At the table (app)`;
  - a run-order table (first column `#`, a column headed About, Time, Budget or Length): a start button per beat
    (`prep.beats`) and the running beat's time against its budget, amber at the budget and red at half as much again;
  - `> [!quote] SAY` as a read-aloud card; a code span that is one `[bracket]` (`` `[Blade's pitch]` ``) as a provenance chip;
  - links: `[[#Heading]]` scrolls; an NPC, PC or faction opens a peek card from the pack's campaign part (an NPC in the app's
    cast gets Show on iPad and Put on stage); another prep note opens it, at the heading the link names; a note carried in as a
    transclusion scrolls to the heading the link names inside it (`[[pockets#B. The swan job]]` lands on B, not on the note's
    first transclusion), else to the transclusion; the open note by its own name scrolls here rather than leaving for Obsidian;
    anything else opens in Obsidian (`obsidian://open`). A jump lands under the sticky bars (`scroll-margin-top` on the sections,
    the headings and the transclusions: 140 px on a phone, 8 px in the laptop layout);
  - **Pin** on a section keeps it, live, at the top of the rail (three at most, `prep.pins`); **Wide** hides the console (on a laptop, **Focus** shrinks it to its keys instead);
  - an embedded **score card** (the exporter's `score` on the block) gets a **Site** strip under its header: see **Score sites** below;
  - **Find in the note** (the box in the bar; `R` puts the cursor there): every word somewhere in a section's heading or text keeps
    its chip in the section list, Enter goes to the first match, Esc leaves the box.
  The header says when the part was exported and warns after a day. Prep text never goes to the iPad or to players; edits are
  made in Obsidian and reach the page with the next pack build and push. Checks: `checks/runtime/gm-prep.test.mjs`,
  `checks/runtime/gm-prep.e2e.mjs` (`PREP_PACK=<pack>` to look at a real pack locally).
- **Cards** (`O`): the planning meeting's opportunity cards, typed straight onto the book's ruled index card (From, Client,
  Target, Type, a free line, Payout; From suggests the PCs and GM). Up to eight, reordered with the arrows. **Show on iPad**
  sends them as a carousel (display kind `cards`; the Turns setting makes it turn by itself, or a tap on the right turns it,
  on the left goes back); **Spread on iPad** lays them all out; **Show this one** sends a single card. GM state `opps`:
  `{ list: { id: { from, client, target, type, note, payout, order, at } }, interval }`. Only typed text goes out, and only
  on a Show button; the server keeps the six lines of each card (120 characters each) and nothing else.
- **Score sites** (17/10/2026; the design is the vault page `Projects/blades-68-score-sites.md`). A location roll saved against a
  score card, so the same map comes back on any device, any night, and the vault gets it after the game.
  - **Which scores.** `npm run gm:pack` marks every note embedded in a prep note that is a score card (tagged `wiki/b68-score`, or
    kept in a `Scores/` folder): the embed block carries `score: { key, label, site }`, the key being the card's file name, the label
    the heading just above the embed ("F · The goose job"), and `site` the card's optional `site_target`, `site_district`,
    `site_faction` and `site_approach` properties. `B68GmPrep.scores(part)` lists them once each; `view()` leaves each card a slot,
    `<div class="pp-site" data-score>`.
  - **Save.** The Location panel's **Site for a score** row: pick a score (or arrive from its strip), press **Save as the site for …**.
    The current card's replay info goes into the GM state, `sites[<key>] = { seed, ui, mem, name, district, label, map: { view, theme },
    at }`, replacing the score's earlier site after a confirm. Saving is always a press. At most 24 (`P.SITE_MAX`, about 3 KB each,
    mostly the generator's memory); past that the page says to clear a played score's site.
  - **The strip in Prep.** Saved: the place and district, **Open map**, **Roll another**, **Clear** (asks). Not saved: the card's hints
    and **Roll a site**. Roll a site sets the Location pickers from the hints (`P.siteUi`: matched as Now in matches names; a hint the
    tables lack rolls on any and a toast names it; no district hint is any, not Now in), opens the panel and rolls; the save row then
    points at that score (`S.siteFor`, this page only). **Open map** makes the saved roll the Location card, on the GM layer, in the view
    and theme it was saved with, public band only, and draws it; if the location tables changed since, a toast says the seed now
    gives another place. Show on iPad and Set as score scene then work as always: no push starts from Prep.
  - **The vault.** `npm run gm:pull` (and `gm:after`) files each site (SYNC.md, "Score sites"). Checks: `gm-page.test.mjs` (S1–S3),
    `gm-prep.test.mjs` (score sites), `gm-sites.test.mjs`, `gm-prep.e2e.mjs` (the score site block).
- **State.** The GM state document holds `con` (the console state: `live` controls, `owed`, `struck`, `used`), `loc`
  (`ui`, `map`), `mem` (the repeat guards), `cards` (the current card per tool as `{ id, seed, ui, mem }`, `mem` a JSON
  string of the guard before the roll, and for the console `con`, a JSON string of the bargains and callbacks as they were,
  so a reload or an Earlier click redraws exactly the same card even after a callback was used or a bargain collected),
  `hist` (five per tool), `npc` (`ui`: the NPC pickers), `npcgen` (`{ seed, mem, at, s?, ui? }` per generated NPC id: the
  roll that made them, `ui` only when a picker was set), `sc` (`ui`: the Score panel's choices; its cards are `cards.score` /
  `hist.score` / `mem.score`, see Score (J)), `dt` (`ui`: the Downtime panel's choices; its cards are `cards.downtime` /
  `hist.downtime` / `mem.downtime`, see Downtime (D)), `pins` (50, text), `capture` (400, and 128 KiB: `{ id, bucket: n|x|m|r, text, at, s? }`),
  `prep` (`ticks`, `cells`, `beats`, `pins`: the Prep tab), `opps` (the Cards panel), `sites` (Score sites), `chase` (the Chase panel:
  `current`, `past`, `ui`) and `now` (`{ district }`: Now in). Capture never touches
  the campaign log; **Export tonight's note** downloads `b68g-s<NN>-notes.md`.
  `s` is the session number the campaign document held when the line was filed (`camp.session.number`, a whole number; absent when
  there was none), on typed lines, on lines filed by a card's action (a bargain accepted) and on rolls filed with `L`, so the sync
  (`npm run gm:sync`) files each line in the right session note. The campaign log never gets capture text.
- **Saving.** Writes are debounced 800 ms, one in flight at a time; what is added meanwhile goes when it lands, even
  after leaving the page, and a hidden tab or `pagehide` sends what is pending as a `keepalive` request. A network error,
  409, 429 or 5xx retries with backoff; any other refusal is shown as "Not saved", kept in `b68.gm.sticky` and never
  resent, so later changes still save. **Signed out** (the Cloudflare Access session ended): the saver gets a 401 (or the
  adapter's own signed-out error, or the keepalive request meets the sign-in page's redirect). It does not park the patch: it goes on
  **hold**. Nothing more is sent (no retry, not the page-hide request either), later changes keep merging into the pending copy, and
  the bar carries a plain message on a second row, "Signed out: reload to sign in. Your notes are kept on this device." (and the
  status reads "Signed out"). The pending copy waits in `b68.gm.sticky` as `pending`, which is not `parked` (a patch the server
  refused: that stays refused and is never resent). On the next open after a reload, drawn and signed in again, the pending copy is
  drawn into the page and sent once; it stays in the sticky copy until the server has answered. Forget GM data warns when changes have not gone.
  Sizes are measured in bytes: past 240 KiB only rolls are taken, past the server's
  256 KiB nothing. **Capture never blocks a roll** (E18): the capture lines have a byte budget of their own, 128 KiB
  (`LIMITS.captureBytes`; the 400-line cap still applies). Filing a line over the budget drops the oldest lines of EARLIER
  sessions first (`s` below the table's session number, oldest session first, then oldest line; never this session's, never a
  line with no session), with one toast per page load that says how many went and that `npm run gm:after` files them into the
  vault (run it after each game: a session it has filed is safe in its note, and its lines are the ones that go first). Only when
  this session alone fills the budget is new capture
  text (typed, an accepted bargain's line, `L`) refused, with "Tonight's capture is full ... Export tonight's note, then clear the
  capture to file more. Rolls still work." A roll is never refused for this: it is not capture, and if the document is still past
  the hard line (256 KiB less a margin) the same oldest-first drop makes room for it. The page refetches the state on focus.

## The display (`#display`, `app/display-page.js`, `app/display.css`)

Full screen (no header, nav or banner) for an iPad signed in as the GM. Boot mounts
`B68DisplayPage.mount(container, { gm, db, figures, cast, isGM })` once the files settle (`db` is the resolved db) and
calls `unmount()` on leaving; anyone but the GM sees a message instead. The GM page's Menu (**Open the display page**) opens it.

The display offers **no way back** to the GM page (no link, hidden or not). Its sanitiser applies the same rules as the server's `checkSvg` (namespaced
elements, `<a>`, `xml:base`, backslashes, `image-set()` / `src()`, raster `data:` images only on `<image>` / `<feImage>`).

### How it polls (the request budget)

Workers Free allows 100,000 requests a day for the whole site (counted in UTC; after that the Worker refuses until the next day), and the
iPad stays on all night, so the display asks for one thing only: `GET /api/gm/display?seq=N&aseq=M&sseq=K` (the display, the ambient and the
transcriber's part; each comes back as `unchanged` when it is current, see Endpoints). The beat (`Pure.POLL`, `Pure.createPoller` in
`app/display-page.js`):

| when | every |
|---|---|
| anything is moving | **4 s** |
| nothing has changed for **2 hours** (not the display, the ambient settings, nor the transcriber's `want` and `session`), until the next change | **15 s** |
| offline (three failures in a row) or signed out | 10 s, and never faster than the beat above |
| the page is hidden (a background tab) | **60 s**, and never faster than any of the above |

A change is seen by the first look after it, so after two quiet hours the first push can take up to 15 s to appear, and then the 4 s beat is
back. Coming back to the page, or the network coming back, looks at once. A hidden page keeps looking because the transcriber's part rides on
this poll: the GM's **Stop listening** has to reach a microphone left open in a background tab. The adapter's own poll of characters, the
campaign and the cast (`cf.js`, HOSTING.md) is 4 s in front and 60 s hidden (it was 20 s).

An iPad on all day costs about 21,600 requests at the 4 s beat, 5,760 at the 15 s beat, and about 1,440 for its status reports (once a
minute while idle and visible; every 10 s while the mic is open). Before (display every 2 s, the transcriber's own GET every 4 s, its report
every 10 s) that was about 73,000 a day: with a laptop or two open it could trip the cap in the middle of a session. Now it is about 23,000
on a day when something changes at least every two hours, and about 8,500 on a day of nothing.

**Signed out.** When the Access sign-in ends, the adapter refuses every call from then on (until the page is reloaded) and the corner says
"Not signed in as the GM". Nobody touches an iPad on the table's stand for hours, so after **10 minutes** signed out the page reloads itself
(`Pure.createReloader`): the reload asks Access again, which signs the iPad in silently while the single sign-on session is still good, and
otherwise shows its sign-in page, which a person must see anyway. It reloads **at most once per 30 minutes**: the time of the last reload is
kept in `localStorage` and `sessionStorage` (`b68.display.reload`), so a page that comes back still signed out (a person must sign in, or the
email is not allowed) tries again in half an hour and not in a loop; where neither can be written it never reloads. Checks: the poller and the
reloader in `checks/runtime/display.test.mjs` (fake clock), and in a browser, with the time jumped, `checks/runtime/display-role.e2e.mjs`.

### Ambient scenes (`app/ambient/`, the iPad panel `I`)

When nothing is spotlit the display plays an **ambient scene** underneath: `blank` means "the ambient plays", and the new
kind `dark` is lights out (true black). Scenes are same-origin pages in `app/ambient/`, framed with
`sandbox="allow-scripts allow-same-origin"` and served with `X-Frame-Options: SAMEORIGIN` and a no-network CSP (`app/_headers`).
URLs are built from the registry (`Pure.AMBIENT_SCENES`) and have **no `.html`**: the asset server 307s `x.html` → `x`, and the
service worker never caches a redirect. The registry ids, in picker order:

| id | file | scene |
|---|---|---|
| `harvest` | `second-harvest` | The lair: the crew at home in Second Harvest |
| `watch` | `watch-feed` | City Watch monitors; always `?api=off`, told heat and wanted by `postMessage` |
| `duskwall` | `duskwall-after-dark` | The crew on a rooftop in the rain |
| `boneyard` | `boneyard-dawn` | The Boneyard at dawn: the Flensing Yard inside the leviathan, Brackley and Skinner |
| `undertow` | `undertow` | Mira's club in the drained baths: oil-wheel light, go-go cages, the deep end, Mira at the bar |
| `vet` | `grunts-vet` | Grunt's: steel table, one bulb, LARGE ANIMALS · NO BIRDS |
| `tram` | `night-tram` | Across a tram carriage, Crowfoot sliding past, a next-stop board |
| `lurker` | `lurker-press` | The Lurker going to press: a new front page every ten seconds or so |
| `cards` | `calling-cards` | Faction cards dealt onto baize. **Built locally, never committed** (the art is the book's) |
| `pells` | `pells-provisions` | A Daggerite grocer in Charhollow at night |
| `wanted` | `wanted-wall` | Crew posters on wet brick: one per Wanted Level, curfew bills at Heat 4+; told heat and wanted like `watch` |
| `meeting` | `planning-meeting` | The crew round the table in the lair over a generic map; they take turns talking |
| `credits` | `opening-credits` | A 90-second title sequence cut to the theme; **pin only**, plays once and holds on the title card |
| `board`, `exploded` | `planning-board`, `score-exploded` | The score scenes |
| `testcard` | `test-card` | Please stand by (pin only) |

The scenes from `boneyard` on are built by `tools/ambient/scenes/*.js` (see `tools/ambient/README.md`); their figures move now
and then (a few hard-cut frames: a drag on a cigarette, a glance, a sip). `tools/ambient/redress.js` re-dressed Booker in his suit in
`harvest`, `watch` and `duskwall` and gave Alfie his cigarette there.

- **Rotation.** Auto (default: every scene but the score scenes and the test card, in picker order, every 7 min, cross-faded), Pin (one
  scene), or Off. A playlist holds 1–16 scenes. A playlist the GM already saved keeps its scenes: tick the new ones in the panel. **Next scene** skips.
  A covered scene is kept for 30 s, then its frame is removed (a hidden frame gets no `visibilitychange` and would animate all night),
  and reloaded when the spotlight clears. A scene that has not loaded in 20 s is benched for 10 min.
- **The theme.** A scene marked `music: true` (the credits) may ask the display for `Pure.AMBIENT_MUSIC` (`app/media/theme.mp3`,
  **gitignored**: someone's recording, kept on the GM's PC and deployed from disk) with a same-origin `b68:music` message (`play`,
  `fade`). An iPad plays sound only after a tap, so the first tap on the display unlocks it; until then a **Tap for sound** chip shows.
  The display tells the scene where the music is (`{ state: 'playing', t }` each second, `blocked`, or `none` with no file) and the
  scene runs its cuts from that. Another scene, a spotlight or lights out stops it. `/media/` bypasses the service worker. To replay
  the credits, pin another scene and pin them again. Episode line and cast: the top of `tools/ambient/scenes/credits.js`.
  While the credits are up, a **Theme:** line in the display's corner says what is happening, large enough to read across the table:
  `no file on the server (app/media/theme.mp3)` (the display asks the server with a HEAD request before it tries to play, because an
  iPad does not preload audio and refuses a missing file with the same error as a locked one), `tap the screen for sound`,
  `playing · 0:42`, `the iPad would not play it`, or `the file would not play`; the line goes with the credits. The iPad panel on the
  GM page checks the file too (`Theme for the credits: on the server` / `NO FILE on the server`); whether the iPad is playing it only
  the iPad's own line shows (the display never writes to the server). The theme plays through one plain `<audio>` element started
  inside the tap (no Web Audio: iOS mutes an AudioContext with the ring/silent switch and leaves it `interrupted` after a call or a
  lock, while an `<audio>` plays on). Only an event the browser counts as a gesture is used (a finger's `pointerdown` is not one on
  iOS; its `pointerup`, `touchend` and `click` are). A tap on the display at any time before the credits unlocks the theme until
  the page reloads; otherwise the credits wait with **Tap for sound**. iOS ignores `audio.volume`, so on the iPad the fade is a
  stop where the fade would have ended; a PC fades.
- **Heat and wanted.** The GM page sends the campaign's crew heat and wanted (debounced 2 s) while the ambient is not off. The page
  has to have been opened as the GM in that page load; the iPad panel also corrects a stale value when it opens. The display passes
  them (`b68:crew`) to every scene with `needs: 'crew'` (`Pure.ambientCrewScenes()`: `watch`, `wanted`) when it loads and on each change.
- **Score scenes.** **Set as score scene** (Location panel, player layer only) renders the board (`plan`, board theme) and the exploded
  site (`iso`, blueprint) from the current roll at the revealed bands, through the same gate and hidden-name scan as Show on iPad.
  A plan that names a hidden room is redrawn as `rings`; a leaking iso is refused. Bands beyond public ask first. Only the place name and
  district go with it (`target` is always empty). It **never updates on its own**: press it again after revealing more. The shells
  (`planning-board`, `score-exploded`) hold no data; they post `b68:ready` and the display answers with `b68:score` (both svgs
  re-sanitised, four crew polaroids drawn with the figure kit, `Pure.POLAROIDS`).
- **Figures that move.** A figure's frames are versions of its moving parts; the one not shown is `visibility:hidden` (WebKit keeps
  its renderer, so a cut is a repaint), every id is unique per frame, and nothing a shown part uses (a clip, mask, gradient, filter)
  sits in a hidden version. `ambient-frames.test.mjs` (in `check:ambient`) walks every figure and frame to prove it. The planning
  meeting is four composited layers (the room and crew, the lamp's light, the dark, the smoke) so the smoke never redraws a figure.
- **Checks.** `check:ambient` (assets, shells, frames), `check:display-ambient` (e2e), plus the ambient cases in
  `checks/api/gm.mjs`, `display-role.mjs`, `display.test.mjs`, `gm-page.test.mjs` and `gm-nosecrets.test.mjs`. The e2e checks take
  `PW_CHANNEL=msedge` when Playwright's own Chromium is not installed.
- **Deploy.** `npm run deploy` (SETUP.md, "Updating the app") applies the migrations and refuses to ship without
  `app/media/theme.mp3` and `app/ambient/calling-cards.html` on disk: both are gitignored, and the asset upload takes whatever
  is on disk. The cards are built on the deploying PC (`node tools/ambient/scenes/cards.js`, from `tools/ambient/cards/*.jpg`);
  without the file the `cards` scene 404s and `check:ambient` prints SKIP. **Handouts too:** the deploy uploads `app/media/handouts/`
  as it is on disk (git-ignored, like the cards), so the deploying checkout (the clean worktree: copy it in from the GM's PC with the
  other media) must hold it; `npm run gm:handouts` must have been run on that PC first (see Handouts).
- **Decisions** (Alex, 15/10/2026; the plan as written is `docs/history/AMBIENT-PLAN.md`). Rotation is a playlist plus pin (auto
  every 7 minutes, cross-faded; pin one; skip). The score scenes are live from the current location roll, player layer only, and
  never update on their own. **Clear** goes back to the ambient; **Lights out** is true black. Heat and wanted come from the
  campaign by themselves.
- **Secrecy.** The score maps are the only route from a roll to the players' screen, and they pass every gate Show on iPad
  uses: the page's own player-layer render, the hidden-name scan, a confirm for bands beyond public, `checkSvg` on the server and
  `sanitiseSvg` on the iPad. The ambient document is never in `/api/export`; a player and the display sign-in get 403 on
  `/api/gm/ambient` before the body is read, and the display reads the document only through `GET /api/gm/display`.
- **Open items.** Thermals: `watch-feed` is a 2.2 MB svg animated at about 30 fps; if the iPad runs hot over a long session, the
  knob is a frame rate in the scenes (regenerate them). The four static scenes (`second-harvest`, `watch-feed`,
  `duskwall-after-dark`, `test-card`) have no generator here: `tools/ambient/redress.js` patches small things (a suit, a
  cigarette), anything bigger means asking the design tool again. The score scenes' polaroids are a fixed list (`Pure.POLAROIDS`): move it to the campaign document when the roster
  changes. Offline, a scene never played before shows blank and the watchdog skips it.

### The display sign-in (`DISPLAY_EMAILS`)

A third role, `display`, so the iPad never holds a GM session. An email in `DISPLAY_EMAILS` (comma-separated, case-insensitive,
like `GM_EMAILS`; the GM wins if an email is in both) gets exactly six calls: `GET /api/me`, `GET /api/gm/display`, and the transcriber's `POST /api/gm/stt/token`, `GET` and `PATCH /api/gm/stt` and `POST /api/gm/transcript` (Listening; the display page no longer calls `GET /api/gm/stt`, its read of the display carries `want` and `session`, but the call stays allowed for a display page of an older build).
Everything else, any method, known route or not, is the same 403 ("this is the table display sign-in: it can only show
the display") from `functions/api/_middleware.js` before the body is read or the database touched, so a route added later is
refused by default. It is never recorded in `members`, never listed as a player, and `PUT /api/gm/display` stays GM only.
With `DISPLAY_EMAILS` unset the role does not exist. Check: `npm run check:display-role`.

**To turn it on** (Alex's steps, not done by code): pick an email for the iPad, add it to the Cloudflare Access allow policy,
then `npx wrangler secret put DISPLAY_EMAILS` and sign the iPad in with that email. `scripts/deploy.sh` does not manage this secret.
The display page's NPC view reads `npcs`, which this role cannot; it falls back to the pushed title and caption.

## Handouts (`npm run gm:handouts`, the iPad panel `I`)

The prepared props (the images the vault holds for the table) as a list the GM can show directly, and that Claude can suggest.
- **Images** are git-ignored static files in `app/media/handouts/` (like the calling cards: art that is not ours to publish; deployed from
  disk, never committed). `npm run gm:handouts` copies the web images (png, jpg, gif, webp, svg) from the vault's handouts folder
  (`Wiki/Games/Blades in the Dark/Campaigns/Group/handouts`, or `.../props`, or the same two under `Projects/`; `-- --src "<folder in the vault>"` for
  another) and names anything else (pdf, tiff...) as skipped. Each image is copied under a **content-hash name** (the first 16 hex of the
  sha256 of its bytes, plus its extension), never its vault file name, so a player cannot guess a URL; the manifest's `file` is that name and the
  title stays in the manifest only. Hashed files no longer in the list are removed (a changed image leaves its old file behind otherwise); other
  files in the folder are left alone. Run it on the deploying PC before `npm run deploy`. It also writes a private copy of the list to `gm-private/handouts-manifest.json`.
- **Manifest** is the pack part `handouts` (`npm run gm:pack`, `lib/handouts-export.mjs`): `{ v: 1, rel, items: [{ id, title, file, when? }] }`.
  `title` is the caption of the embed in a note beside the images (`![[file.png|Caption]]`), else the heading above the embed, else the
  file name; `when` is a line straight after the embed that starts `When:` or `Cue:`. Nothing is invented. No images: no part. gm:pack warns when
  images are in the vault but not yet in `app/media/handouts/`.
- **GM page.** The iPad panel (`I`) has a Handouts box under the score scene: thumbnail, title, cue, **Show on iPad** and **Clear iPad** on each,
  and a *Title on the iPad* tick (this page only). Show sends `{ kind: 'handout', title, file, showTitle }` and nothing else: the iPad never
  receives the manifest, the cue or the other entries. The server checks `file` as a plain image file name.
- **iPad.** `handout` draws the image fitted to the screen on black (a small prop is enlarged, a large one shrunk); a tap shows or hides the title
  caption; a file that was not deployed says so on the screen instead of showing nothing.
- **Claude suggests.** `B68GmPage.suggestHandout(id, why)` puts *Show handout: <title>?* in the Rack (with the reason, **Show** and **Dismiss**);
  an id not in the pack is refused (returns false), a repeat replaces the offer, at most three are held. Show posts the same display as the list and
  drops the offer. The Mystery keeper is what calls it: its tick answer may carry `handout: { id, why }` (see *Stall, the Showrunner and the Mystery keeper*).
  The page offers a handout once: not again while the offer is up, and not after it was shown (from the offer or the list) or dismissed (kept 12 hours in
  this browser, so a reload does not bring it back). Claude only suggests; the list always shows every handout, and your tap is what shows one.
- **In the prefix.** `gm:pack` adds a small `handouts.md` block to the assist prefix (id, title and cue per handout; no file names), with the other
  stable blocks ahead of the never-reveal list and prep. No handouts part, no block.
- **Checks.** `checks/runtime/gm-handouts.test.mjs` (in `check:runtime`) and `check:handouts-e2e` (`gm-handouts.e2e.mjs`, browser; writes two tiny
  images into `app/media/handouts/` for the run and removes them).

## Listening: the table iPad's transcriber (`app/stt.js`, the iPad panel `I`)

The iPad sits in the middle of the table, so it hears everyone; it replaces the laptop's mic in Obsidian
(`Tools/blades-68-transcriber.md`, kept as the fallback). The path, and who holds what:

1. **Start listening** (iPad panel, `I`): GM state in `gm_stt` (`want: on`, the session number, speaker names).
2. **The iPad** (`#display`) learns what the GM wants from its display poll: `GET /api/gm/display` carries `stt: { seq, want, session }`
   (see Endpoints and "How it polls"), and `display-page.js` hands each change to `B68Stt.feed()`. The transcriber makes no request of its own
   for it; only against a server whose display answers carry no `stt` (an older build) does it fall back to `GET /api/gm/stt` every 4 s. While
   `want` is on and it is not listening, it shows **Tap to start listening**: iPad Safari opens the mic only on a tap. The page's
   `Permissions-Policy` allows the microphone for this origin only (`microphone=(self)`, `worker/app.js`). It tells the server its state
   (`PATCH /api/gm/stt`, `status`) at once when the state changes, every 10 s while the mic is open and once a minute otherwise while the page
   is visible (a hidden page says nothing); the GM page shows how long ago from it, and calls the iPad silent after 40 s while it should be
   listening. **Stop listening** reaches the iPad with its next look (4 s; 15 s after two quiet hours; a minute in a hidden tab).
3. The mic goes to Deepgram's live API (`nova-3`, speaker labels) as 16 kHz 16-bit PCM over a WebSocket. It opens with
   a short-lived token from `POST /api/gm/stt/token`, which the Worker mints with its secret `DEEPGRAM_API_KEY` (never
   sent to a browser). The token rides the handshake as a subprotocol pair, `bearer` then `token`; whichever works is
   remembered on the iPad. `npm run check:stt-live` (with the key in `DEEPGRAM_API_KEY`) says which one Deepgram accepts:
   on 16/10/2026 it was `bearer` (`token` is refused with 1006).
4. Finished words are merged into lines (same speaker within 4 s of audio), as the vault transcriber does. They are
   posted to `POST /api/gm/transcript` every 3 s with their own ids, so a resend is skipped. A dropped connection
   reconnects with a new token and files a `reconnected` mark (Deepgram renumbers speakers). Stop, leaving `#display`
   or 6 hours stops it. While it listens, **● Listening** shows in the iPad's corner for the table to see.
5. **Into the vault, by itself:** the PC's background copier (`scripts/gm-transcript.mjs --watch`) looks at `gm_stt`
   once a minute (one query). While `want` is on, or lines are waiting, it copies new lines every 10 s into
   `Sessions/b68g-sNN-transcript.md`, in the vault transcriber's format, with names from **Who is who**, and sets
   `copier: { at, last }` in `gm_stt` at most once a minute (and after any pass that copied lines once listening is
   off), so the panel can say the PC is copying. The session is the one stamped when listening started; with none
   (the table's counter at 0), the session note dated for that night (before 06:00 counts as the night before), else
   the highest-numbered note. A line three minutes old or more that is already in the note (same minute, same words:
   the other PC copied it) is not added again. It never writes
   into a transcript the Obsidian transcriber made (no `source: ipad`); those lines go to `b68g-sNN-transcript-ipad.md`
   instead. Append only; the ledger's `transcript.last` remembers the last line filed. Lines the PC missed (off, asleep)
   wait on the server and land on its next look. Two PCs on one vault (desk and laptop, through Obsidian Sync): the
   heartbeat names its host, and a copier stands back while another host has beaten in the last 3 minutes, then takes
   over from that host's `last`. One copier per PC (`gm-private/transcript.lock`); its log is
   `gm-private/transcript-watch.log`. By hand: `npm run gm:transcript` (one pass), `-- --follow` (every 10 s, in a
   terminal), `-- --prune` (delete filed lines from the server).

The panel shows the iPad's last report (state, lines sent, how long ago), the newest eight lines (tap a speaker to name
them), the speaker names, and whether the PC is copying.

**After the game, in one command:** `npm run gm:after` shows the plan; `npm run gm:after -- --yes` does it
(`scripts/gm-after.mjs`). It works out last night's session (the note dated last night, or `--session N`), copies any
transcript lines still on the server, runs `gm:pull` for that session, sets the two transcripts side by side (lines,
first and last time, unnamed speakers), and reports the table's session counter against the vault (`--counter N` sets
it). `--yes --prune` then clears the server's copy of the lines the vault has. Stop listening first: with listening
still on it leaves the transcript alone.
With `--yes`, `gm:after` also runs the **Night Shift** (step 3c): on the PC, Claude reads the session's transcript from the vault
and the local pack's assist prefix and drafts the night's paperwork (a table of every roll with its acting character,
position, effect, dots, whether it was pushed and the result; a session log; possible XP triggers; a feedback card; group-chat
highlights; a "previously on"; a prep skeleton). Sorters read the transcript an hour at a time, then a writer drafts from their
notes. The GM app's own roll records come first: after `gm:pull` (step 3) the Night Shift reads the cards filed under "Rolled at the
table" in the session note and treats them as authoritative for whatever they state. The app only records what the console knows
when an outcome card is filed (a "4/5" or "1-3" card gives the result band, and the line carries the Position and the selected PC
in brackets, e.g. "A 4/5 (risky, Name): ..."; an effect would be added if the console ever has one), never dots, so the speech
rolls fill the rest: a spoken roll is matched to an app card within 2 minutes (and by character when the card names one), and the
speech never overwrites a field the app stated. An app card with no spoken match, and a spoken roll with no card, each keep a row;
every row says its source (app, speech or app+speech). The XP section is split: desperate and zero-dot rolls are computed by code
from that merged table, and the writer adds only the judgement-based triggers from the transcript, both still candidates. It
files the lot under one heading, `## Night Shift draft`, at the end of the session note. A note that already has the
heading is skipped before anything is spent; `--nightshift-force` replaces only that block. XP is never marked: the draft lists
candidates and says the GM marks them. It needs `B68_ANTHROPIC_KEY` (without it the step is skipped with a one-line note and the
rest runs as usual); `--no-nightshift` skips it, `--nightshift-cap <$>` stops it cleanly at a spend (default $3; nothing is filed
if it stops), and `--nightshift-mode single` tries one call over the whole transcript instead. The plan (no `--yes`) spends
nothing. Check: `checks/runtime/gm-nightshift.test.mjs` (mocked client, no network).
Endpoints are GM only. The table display sign-in (`DISPLAY_EMAILS`) may get a token, post lines and report its status,
but not read the transcript; the display read it gets carries `want` and `session` and never a line, a name or a report
(`checks/api/display-role.mjs` posts lines with a marker and looks for it in every shape of that read). The transcript is never in `/api/export`. Migration `0007_gm_stt.sql`. Checks:
`checks/runtime/stt.test.mjs`, `checks/runtime/gm-stt.e2e.mjs` (fake mic, fake Deepgram socket).

**Setup, once:** `npx wrangler secret put DEEPGRAM_API_KEY` (a key with Member permission or above), then
`npm run check:stt-live`. On the PC that goes to the table (it needs the repo, `npm install` and `npx wrangler login`,
not the Deepgram key), `npm run gm:transcript -- --install` writes a hidden launcher
(`b68-transcript.vbs`) into the Windows Startup folder and starts the copier; it starts at every sign-in after that.
`-- --uninstall` stops it and removes the launcher. It runs the repo's checked-out copy of the script.

## Claude at the table (the box, `app/gm/assist-panel.js`, `functions/api/gm/assist.js`)

**The box** is the Claude panel at the bottom right of the GM page on a laptop; key **A** opens and closes it. It needs
**Listening** on (the iPad transcriber above), because it reads that transcript. About once a minute it asks a cheap
seat whether anything at the table needs a second look, wakes other seats only when the answer is yes, and shows at most
one card per five minutes. Quiet is the normal state. Tonight's spend is counted from the log against a **cap**
(`ASSIST_CAP_USD`, default $20): the budget ladder drops the optional seats at 60% and keeps only the core ones at 85%,
and at the cap nothing runs. The box says so when it is off. With the box off, no key, or the cap reached, the console
works exactly as it does without it.

**The Fixer fits the console's own draws.** When you tap a Position on the console (and the box is on, Listening is on and the cap is not reached), the console draws its 1-3 and its 4/5 card once, from the pack's own tables, and sends both with the Position to the Fixer. The Fixer keeps what each draw says happens and fits it to the scene, and writes the 6, the crit and a Devil's Bargain; the answer appears in the **Rack** strip under the card. Tapping 1-3 or 4/5 then shows that very draw (never a re-roll), so the card and the fitted line agree; a late answer still lands in the Rack. A different Position (or Scene, District, PC, NPC or Threat once a Position is set) re-draws and re-fits; **Clear** on the Rack drops them. A used draw is not served twice. The draws are page state only: a reload forgets them and the next tap rolls as it always did. The Dots chip beside the Position switch goes with the fit when it is set: the request carries `dots` (0 to 4) and the Fixer's turn says *Dots: N*; with no dots set the request and the turn are as before. The fit endpoint needs `draws: { low, mid }` and answers 400 without them (and 400 for a `dots` that is not a whole number from 0 to 4). Every seat call's log row records its seconds and stop reason; a refusal is logged and shows nothing. The replay script takes the same draws: `--fixer-at HH:MM,... [--draws-file f.json | --draws-pack pack.json --draws-seed N] --position risky`.

**Voice, and Another.** When an NPC is on stage (put on stage in the NPC tab or the cast page), the page sends that NPC's name with each tick; the server holds no scene, so the page is the only thing that knows. With a name, the Voice seat wakes when the Tripwire hears an NPC change and again on every tick, about each minute, after Ref and within the usual gates (one in flight, a short cooldown, and it stops at 85% of the night's cap). With no NPC on stage Voice never runs. Its two lines, in the NPC's own register from their How to play block, appear in the **Rack** under the console card, labelled with the NPC's name; a line already shown in the last ten minutes is dropped, and they never take the one-card-per-five-minutes slot. **Another** asks the `voice_plus` seat (Opus, medium effort) for one more line for the same NPC and moment, told which lines were already shown; it goes through `POST /api/gm/assist/another { npc, shown }`, with the same cap and busy answers as the Fixer, and stays available until the cap. With the box off, Listening off, the cap reached or on a phone nothing runs and nothing shows; **Clear** drops the lines. If several NPCs are on stage the page names the first in the cast list. The replay script takes `--voice-at HH:MM[=NPC],... [--another N]` (a moment with no name stays silent and makes no call) and writes `lines.md`.

**Stall, the Showrunner and the Mystery keeper.** Three more seats join the Tap. **Stall** wakes when the Tripwire hears the table idle, off-topic or going round in circles (at most every 5 minutes): if the table really is stalled it offers one complication or one clue, and the offer appears in the **Rack** under Voice (with its kind and a **Clear** button), never in the card stream. The **Showrunner** is checked about every 10 minutes on the last 20 minutes of talk but speaks only for a clear pacing problem (a character not heard for the whole stretch, a scene with no roll for the whole stretch, or within 30 minutes of a planned close when the prep gives an end time); otherwise it returns `speak: false` and nothing shows. The **Mystery keeper** wakes when the Tripwire hears a clue, a secret or a theory (at most every 15 minutes), reads the last 15 minutes plus what it reported known earlier, and names the one clue to work in next; that clue must come from the **Must land** list in tonight's prep and the seat names the entry it took, and a card that names none is dropped. The seat may also suggest a handout from the handouts list in its context (`handout_id`, only when the talk shows the table has just reached the moment the handout's cue describes): the Worker checks the id against the live `handouts` pack part (a small read, only when the seat named one) and drops one that is not there, and a valid one comes back as a separate `handout` field of the tick answer, never taking the card slot; the page puts it in the Rack as *Show handout?*. The Worker does not hold the prep, so it cannot check the wording against the list: the seat's instructions carry the rule and the replay script checks it. The Showrunner's and Mystery's notes are ordinary cards behind Ref and Clerk, so the one-card-per-five-minutes gap covers them and Clerk; **Ref has priority**: a rule slip is never held back by one of those cards (only by an earlier Ref card), while they wait five minutes after any card. A card the gap holds back is dropped, not queued (a Ref slip waits up to 4 minutes, and a later quiet tick releases it). Budget: the Showrunner and Mystery stop at 60% of the night's cap, Stall and Voice at 85%, and Ref, the Ledger, the Fixer and Another run to the cap; with the box off, Listening off, the cap reached or on a phone none of them runs and nothing shows. Known limits, left for gate tuning: the Tripwire's `stall` flag was tightened (it now means the table has stopped or is going in circles, not normal planning, rules talk or banter during action; on a replay of a long planning stretch it fell from 44 minutes in 97 to 5), so a few false flags can still reach Stall, which filters them at a small cost, and a table that has gone truly silent never wakes Stall because there is no talk to tick on (it would need a synthesised silence flag). The replay script takes `--tap-sim --from HH:MM --to HH:MM` (the whole table agent through the real endpoint, one tick a minute) and `--turn-at seat@HH:MM,...` (one seat at chosen minutes; checks the Mystery entry against the prefix's Must land section).

**Why the prefix is a file.** Every seat reads the same long reference text (the rules digest, the cast, each NPC card's How to play block, the player-to-character table and tonight's
prep, up to ~90k tokens; the table comes from `player:` on the PC notes or the git-ignored `gm-private/players.json`, which wins). The Worker runs on Workers Free, where a request gets 10 ms of CPU: waiting on Claude or D1 is
free, but reading, parsing and re-sending that text on every tick is not. So the GM's PC uploads the text once to
Anthropic's Files API as a plain-text file, the pushed `assist` part holds only `{ file_id, hash, extra }`, and each seat
call names the file. Nothing campaign-specific is in git, in D1 or in the Worker.

**Pushing the `assist` part.** `npm run gm:pack` builds it (the pack file on the PC keeps the text); `gm:push` uploads the
text when it changed since the last upload, remembers the file in `gm-private/assist-file.json`, swaps the small part into
D1, then deletes the file it replaced. A dry run uploads and deletes nothing and says what it would do. **Pushing `assist`
needs `B68_ANTHROPIC_KEY`** (a user environment variable, deliberately not `ANTHROPIC_API_KEY`); without it that part is
refused and the others still go. If the box shows **re-push the assist part**, the stored part is still the old text form
or the file was deleted: run the pack and push again.

**The gate replay.** Before a live night, `node scripts/gm-assist-gate.mjs --transcript <iPad transcript note> --prefix-from <pack.json, or vault> [--assist-prep <vault note>] --session-label s02 --fixer-at HH:MM,... --voice-at HH:MM=NPC,... --expect-ref HH:MM,~HH:MM --max-spend 15 --out gm-private/gate-s02` replays a finished session through the whole table agent (the real endpoint on an in-memory database and a virtual clock, every seat on) and runs the Fixer and Voice at the moments you name, under one spend cap; it stops cleanly at the cap and reports what ran. `--from` and `--to` narrow it to a window, and `--dry-run` makes no calls and estimates the spend (the prefix size is counted with the free token counter when a key is set). It writes `gate.md` (a PASS, FAIL or NEEDS-ALEX line per criterion, every card that would have shown as a numbered tick-box list with cards per 30 minutes, the known slips caught within 2 minutes, the Fixer's seconds with each moment's two draws beside the fitted lines, Voice lines, refusals and cut-offs per seat) and `gate.json`. The report quotes the table, so `--out` must sit under `gm-private/`. Mark the card checklist in `gate.md` on your phone: tick `[x]` if the card was real (a true slip or a useful card), leave `[ ]` if it was false, set `[-]` to skip one. Then `node scripts/gm-assist-gate.mjs --marks gm-private/gate-s02/gate.md` (no API calls) recomputes false cards per 30 minutes, rewrites that criterion's PASS or FAIL line and a Marks section in place, and keeps your marks; run it again after any change. It refuses a checklist with nothing ticked unless you add `--all-false`. A replay of the hold-out session (s03) is read, never tuned on. CPU is read from Cloudflare, not from this script.

**The gatekeeper (nothing reaches the players' screen unchecked).** `POST /api/gm/assist/gatekeeper { kind, text, cites? }` (GM only; kind is
portrait, prop, wire, board or card; text at most 1500 characters) asks one Sonnet seat to check an item against three things: the
never-reveal list, the GM's rule (no decided outcomes, no player character narrated) and the item's shape. It answers `{ verdict: pass | block,
reasons, revealed, rule, cites_bad }`. It never decides: your tap is still needed either way, and anything it cannot judge (no assist part, a
refusal, a cut-off or an error) comes back as `block` with `unknown: true`. It runs to the spend cap like Ref, one at a time. The never-reveal
list is its own `never-reveal.md` block in the assist prefix, built by `gm:pack` from the vault: each NPC note's "Knows / doesn't know" section
and any secret-style heading or callout, then tonight's prep note's "Must land" entries that are not yet ticked (a ticked box counts as landed)
and its own secret-style sections. The pack warns when it finds none. A page cite the gatekeeper thinks is wrong is flagged in `cites_bad` and
never blocks. Ref cards are not sent through it automatically; the Screen work picks which cards to check. Nothing on the console calls it yet.
`node scripts/gm-assist-replay.mjs --context <block files> --gatekeeper-file <json list of { kind, text }>` runs it over sample items.
