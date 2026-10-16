# GM tools: the API and the secrecy contract

The `#gm` page (the console with its four Situations, the location generator, street scenes, the engagement roll and the
downtime cards) and the `#display` page (an iPad signed in as the GM) run on three GM-only endpoints. The generators' tables hold '68
text and GM-only secrets, so they never enter git (the downtime cards' tables are original writing, so they are in git, in
`app/downtime-tables.js`): the GM builds a **pack** from the vault on their own PC (`npm run gm:pack`, into the git-ignored
`gm-private/`) and uploads it, from the browser or with `npm run gm:push -- --only pack --yes` (see `SYNC.md`, which also
moves what happened at the table back into the vault). Code: `functions/_lib/gm.js`, `functions/api/gm/*.js`; tables in
`migrations/0004_gm.sql`. The pack parts are `console`, `location`, `campaign`, `npc`, `scenes`, `engagement`, `prep`,
`screen` and `downtime` (the last three optional; `scripts/gm-pack.mjs` lists what each holds). The `downtime` part carries the
house rule's Good Mornings (`T.good`, from the vault note with `gm_downtime: true`) and is laid over the Downtime panel's built-in
tables (see Downtime (D) below).

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
| `PUT /api/gm/display` | `{ kind, title?, caption?, svg \| npcId \| text \| md }` → `{ seq, display, updatedAt }`; `seq` goes up by one on every PUT. |
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
- **Display.** `kind` is `blank`, `dark`, `svg`, `npc`, `text`, `rule` or `cards` (1 to 8 opportunity cards, see Cards below); other keys are dropped. `title`, `caption`,
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
  (`B68GmConsole`, `B68GmLocation`, `B68GmNpc`, `B68GmScenes`, `B68GmEngagement`: `check(T)`; `B68GmDowntime`: `check(T, part)`, the part laid
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
  a side panel with **Prep (R)**, **GM screen (T)**, **Location (B)**, **Street (S)**, **Engage (E)**, **NPC (N)**, **Downtime (D)**, **Cards (O)** and **iPad (I)** | the state rail (crew heat, wanted, rep, stacks and
  vault from the table, read only; table clocks; the pack's world clocks; bargains owed with **Collect**; pins; who is on
  stage) | the capture bar at the foot (buckets, the input, **File**, "N filed", **File last roll**). 600–1100 px: two columns, the rail below. Phone: the same bar as the laptop, 44 px
  (`’68 GM · Session · iPad: … · Menu`), then a Console | Prep | Location | Street | Engage | NPC / Downtime | Cards | GM screen | iPad | State
  bar in two full rows, six then five (every segment in reach, nothing to drag sideways), both stuck to the top; the Position switch first,
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
  Location, Street, Engage, NPC, Downtime | Cards, iPad). Prep and the GM screen show their sections as an outline beside the text, the one
  being read marked. **Focus** (`F`, or the button by the tabs) shrinks the console to its keys on any tab (it replaces Prep's
  Wide, and shares its setting, `b68.gm.prepWide`); a roll made in Focus leaves Focus so the card shows (a toast says so, once
  per page load). Empty rail boxes are one line. Below 1100 px the page scrolls under the sticky bar. `body.gm-app` turns it
  on while the tools are open; the loading and import screens keep the site header.
- **Table aids** (17/10/2026):
  - **Find** (`Ctrl+K`, `/`, or **Find** in the bar): one box over the open Prep note (its sections and transclusions),
    the GM screen, the pack's NPCs, PCs, factions and world clocks, the cast's NPCs made in the app, the table clocks,
    callbacks, and tonight's capture lines, and a few entries of the rules (from the copy this device already holds: Find never
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
    shorter): the button reads **Upload anyway** and confirms (the same guard as `gm:pack` and `gm:push`, SYNC.md).
- **Keys** (only on `#gm`; never while typing, never with Ctrl/Alt/Cmd but `Ctrl+K`): `1`–`4` roll a situation (`5`–`9` do nothing: the single tables have no keys), `R` `B` `N` `S` `E` `D` `O` `T` `I` switch the panel
  (Prep, Location, NPC, Street scene, Engagement, Downtime, Cards, GM screen, iPad; `R` and `T` also put the cursor in that pane's find box, so typing
  lands there and not on the shortcuts), `F` Focus, `/` or `Ctrl+K` Find, `P` `X` `M` open capture as Name / Loose end / Moment (Enter files, Esc leaves), `L` files
  the last roll under "Rolled at the table", `Shift+H`, or `H` twice within a second, blanks the screen until any key or tap (one stray `H` does
  nothing; the first alone says how, once per page load), `0` clears the iPad to its ambient scene (the same as **Clear → ambient**).
- **Situations.** The console is the four Situations, one mode only (the Classic nine-button view, its toggle, the `b68.gm.view`
  preference and the `SITUATIONS_DEFAULT` switch went on 18/10/2026): four buttons, each a moment in the roll: `1` **Before** (a Devil's
  Bargain), `2` **4/5**, `3` **1–3**, `4` **Someone**. A large three-way **Position** switch (controlled / risky / desperate, with what
  it means for severity, winds and harm) sits above them, always on screen; the other controls (scene, district, PC, NPC,
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
  Checks: `gm-page.test.mjs` (12a–12f), `gm.e2e.mjs`, `gm-scenes.e2e.mjs`, `gm-npc-panel.e2e.mjs`.
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
  3 / Loud 6) and three chips per factor (**+1d** carrying the factor's plus statement, **0**, **−1d** its minus statement, so
  which is which reads at a glance); the card shows the pool before a roll, **Roll engagement** rolls it in the app
  (a 0d pool rolls two and keeps the lowest) and the card gives the position, the dice and the closing "cut to the first
  obstacle" line. **Everyone rolls physical dice**, so under Roll engagement sits a row **Rolled at the table: highest die**
  with the buttons `1 2 3 4 5 6` and **Crit (two 6s)** (disabled under 2d): the GM rolls the pool, taps the highest die, and
  gets the card the app's roll would give for that result (position, how, the closing line; the Roll row says "Rolled at the
  table"). A 0d pool rolls two dice and keeps the LOWEST, so its row reads **Rolled at the table: lowest die** and has no crit.
  Both file a card under `cards.scenes` / `cards.engagement` (an app roll `{ hid, seed, ui, label, at }`, a table roll
  `{ hid, id: 'engagement', ui, phys: { best, crit }, label, at }` with no seed and a label ending "table 4" / "table crit" /
  "table low 2"; the street scene keeps its repeat-guard in `mem.scenes`, the engagement roll has none), five Earlier per tool, Pin, Copy and `L`. A reload
  or an Earlier click redraws the same card (from the seed, or from the result called at the table). A stored card is replaced, never merged:
  the way of rolling it does not use is sent as null, so a table roll never keeps an old seed nor an app roll an old `phys`.
  Changing an engagement control drops the stored roll (the Earlier row
  keeps it) and shows the pool again; the controls live in `eng.ui` and `scn.ui`. Parity with the vault pages:
  `node scripts/gm-parity.mjs --scenes --engagement` (see the header of that script for the one deliberate difference).
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
  and the panel uses the built-in tables with a note. **The Good Mornings come only from that part**: `npm run gm:pack` builds it from the
  vault note with `gm_downtime: true` (the house rule *the Morning After*: its "## The Good Morning" tables; `scripts/lib/downtime-export.mjs`).
  They are drawn from a zine that is for personal use, so they never go into this public repo; with no part, a 6 says where the table is.
  - **Who**: a chip per PC from the live sheets (boot's `characters()`: a slim copy of each filed character, never the figure spec, read on
    every draw and again when the characters snapshot changes) and **anyone**. Picking a PC prefills the vice (a select of the seven, theirs
    picked) and the purveyor (a text field) from their sheet; an edit is panel state (`dt.ui`), never written to the sheet.
  - **Activity**: chips in the module's order (Indulge vice, Recover, Long-term project, Train, Friend or rival, Lay low, Acquire; a phone shows
    the module's short labels). Then the activity's ONE row of buttons, each rolling the card at once (everyone rolls physical dice: the tap on
    the result is the roll): for Indulge vice, under the Vice and Purveyor, the vice roll's result **1–3** **4/5** **6** **Crit** (after any
    stacks spent on it: the house rule the Morning After, where a 6 leaves one Good Morning and a crit two) and **Overindulged** (on a phone
    the results fill the first row and Overindulged sits under them at the left, clear of the Capture button); "Rolled at the table:" **1–3**
    **4/5** **6** **Crit** for Recover, Lay low, Acquire and Long-term project (which also gets a select of the PC's own clocks, the first still open picked, or
    another project); **Insight** **Prowess** **Resolve** **Playbook** for Train; **Friend** / **Rival** under a select of the PC's contacts (a
    friend or a rival first), the relation the sheet gives that contact marked "on the sheet". The button that made the card on screen stays
    marked.
  - **The card** is the usual card (title and sub, chips, the lead box with its small line, the grid, one actions row with Pin and Copy). A
    6 puts one **Good Morning** box under the scene (the line, then its kind), a crit two. An overindulgence puts its six options, in the
    book's order (**Attract trouble · Bad decision · Bender · Brag · Brawl · Tapped**, the drawn or picked one pressed), right above the cost
    box, in the alarm colour: it is what the GM reads first. Tapping another option switches it on the SAME card (its seed and memory: the
    scene above never moves; only `ui.pick` and the label that names it change). A **?** beside Overindulged opens the rules on overindulging
    in the GM screen pane (its rules search for "overindulge"; the first hit about indulging opens). An indulgence that was not one carries a
    small **Overindulged?** that turns the same card into one, and one whose result was not tapped a small **Rolled** row (1–3 · 4/5 · 6 ·
    Crit) that adds it to the same card. The module draws the six options, then the Good Mornings, after everything else, so neither moves the
    scene; the first four options are drawn as first shipped, so an older card replays the same (`lost` keeps its id; the book calls it Bender).
  - **Start a clock: <name> (4)** (a clock the card suggests) puts it on the table's clocks through boot's `addClock` (an `add` op where the
    store takes `clockOps`, else the whole array: CAMPAIGN.md "Clocks"): `{ id: 'c_…', name, size, filled: 0, kind: 'danger', hidden: true }`,
    with the toast "Clock started, hidden from the players: <name>. Show it from the table page." The rail's Table clocks shows it. The card
    keeps the clock's id (`started`), so its button stays done after a reload and on its Earlier entry.
  - After a roll the card is scrolled into view as the console's is (when it is taller than the pane: its cost box, else its lead). `L` files
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
  roll that made them, `ui` only when a picker was set), `dt` (`ui`: the Downtime panel's choices; its cards are `cards.downtime` /
  `hist.downtime` / `mem.downtime`, see Downtime (D)), `pins` (50, text), `capture` (400, and 128 KiB: `{ id, bucket: n|x|m|r, text, at, s? }`),
  `prep` (`ticks`, `cells`, `beats`, `pins`: the Prep tab), `opps` (the Cards panel), `sites` (Score sites) and `now` (`{ district }`: Now in). Capture never touches
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
  without the file the `cards` scene 404s and `check:ambient` prints SKIP.
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
Endpoints are GM only. The table display sign-in (`DISPLAY_EMAILS`) may get a token, post lines and report its status,
but not read the transcript; the display read it gets carries `want` and `session` and never a line, a name or a report
(`checks/api/display-role.mjs` posts lines with a marker and looks for it in every shape of that read). The transcript is never in `/api/export`. Migration `0007_gm_stt.sql`. Checks:
`checks/runtime/stt.test.mjs`, `checks/runtime/gm-stt.e2e.mjs` (fake mic, fake Deepgram socket).

**Setup, once:** `npx wrangler secret put DEEPGRAM_API_KEY` (a key with Member permission or above), then
`npm run check:stt-live`. On the PC that goes to the table (it needs the repo, `npm install` and `npx wrangler login`,
not the Deepgram key), `npm run gm:transcript -- --install` writes a hidden launcher
(`b68-transcript.vbs`) into the Windows Startup folder and starts the copier; it starts at every sign-in after that.
`-- --uninstall` stops it and removes the launcher. It runs the repo's checked-out copy of the script.
