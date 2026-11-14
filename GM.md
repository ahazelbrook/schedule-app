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
| `PUT /api/gm/display` | `{ kind, title?, caption?, svg \| npcId \| text \| md \| file, showTitle?, ifSeq? }` → `{ seq, display, updatedAt }`; `seq` goes up by one on every PUT. With `ifSeq` (a whole number) it lands only while the display is still at that `seq`, else 409 and nothing changes (live reveal, see Location). |
| `GET /api/gm/display` (ambient) | also carries `ambient: { seq, doc, updatedAt }`. `?seq=N&aseq=M` → `{ seq, unchanged: true, ambient: { seq, unchanged: true } }` while both are current; otherwise the full display, with `ambient` `{ seq, unchanged: true }` when only M is current. `?seq=N` alone is the old answer. |
| `GET /api/gm/display` (transcriber) | also carries `stt: { seq, want, session }`: whether the GM wants the iPad listening (`on` / `off`) and the session number to stamp on its lines, and **nothing else**: never a speaker name, the iPad's own report, the PC's heartbeat or a transcript line, whoever asks. Its `seq` is made from those two values alone, so the iPad's reports (which rewrite the control document every minute) never move it. `?seq=N&aseq=M&sseq=K` → `{ seq, unchanged: true, ambient: { seq, unchanged: true }, stt: { seq, unchanged: true } }` while all three are current; otherwise the full display, each part `{ seq, unchanged: true }` when its number is the one given and in full when not. Without `sseq` (a display page from before the transcriber rode along) there is no `stt` and the answers are the ones above. Why: one request where the display and the transcriber used to make two (see "The display", how it polls). |
| `GET /api/gm/ambient` | `{ seq, doc, updatedAt }` (`0`, `{}`, `null` until written). GM only; the display sign-in is refused (it reads the doc through the display). |
| `PATCH /api/gm/ambient` | top-level merge (`null` deletes, `skip: true` bumps a counter) → `{ seq, doc, updatedAt }`. Keys: `mode` auto/pin/off, `scene`, `playlist` (1–16 distinct ids), `intervalMin` 3–30, `skip`, `crew { heat 0–9, wanted 0–4 }`, `score { name, district, target, reveal, view plan/rings, board, iso }` (both svgs through `checkSvg`; the server sets `at`), `overlay` and `auto` (see Overlays), `layer` and `layers` (see The show contract), `polaroids` (KS12.5: `[{ id, cap }]`, at most 8, `null` deletes; 400 when malformed, 413 over 8; sent alone in its own PATCH). Stored doc at most 1.4 MiB, in `gm_ambient` (migration 0006). |

- **Pack.** Part names `[a-z0-9-]{1,32}`; at most 24 parts; `body` a JSON object (or a string holding one), at most
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
  a side panel with **Prep (R)**, **GM screen (T)**, **Location (B)**, **Street (S)**, **Score (J)**, **Chase (C)**, **NPC (N)**, **Downtime (D)**, **Cards (O)** and **iPad (I)** | the capture bar at the foot (buckets, the input, **File**, "N filed", **File last roll**). There is no right column: the state rail is the **drawer's** Table tab (below). 600–1100 px: two columns. Phone: the same bar as the laptop, 44 px
  (`’68 GM · Session · iPad: … · Menu`), then a Console | Prep | Location | Street | Score | Chase / NPC | Downtime | Cards | GM screen | iPad | State
  bar in two full rows of six (every segment in reach, nothing to drag sideways), both stuck to the top; the Position switch first,
  **Now in** (its select moves into the Scene line here) and the Scene line, the situations a 2 × 2 grid, the other controls behind the
  Scene line, capture on a floating button. After a
  roll the card is scrolled into view by the least scroll that shows it (the whole card when it fits, else its lead box; the
  console column on a laptop, the page on a phone), so Position stays on screen when there is room: a roll is never below the fold.
- **The app layout** (`body.gm-app`, 16/10/2026; the only layout, at every width, since 18/10: the "Classic layout" switch and
  the `b68.gm.layout` preference went): the window is the page. While the tools are open the
  site header and footer give way to **the band** (`app/gm/band.js`, the GM night rebuild, 06/11/2026): one black header, two rows,
  never scrolling, and nothing is inserted between it and the work any more. Row 1 is where you are: the mark and the session, the six
  **places** of the night (Before, Opening, Personal, Planning, Score, Aftermath: each phase with its minutes against its budget, amber at
  80% and red once over; the place on screen is mustard, the night's phase has an orange bar and a dot), **Between**, the save mark,
  **Find**, **Crew** (the drawer) and the **Menu** (a dot on it when the pack is old or an offline copy). A tap on a phase's chip enters
  that phase. Row 2 is what is live: the clock and the curfew, the running beat (**Next ▸**), the **iPad tray** (see The iPad tray below: what is live
  on the iPad in one line, **Send (n)** while rooms are staged, **Clear** `0`, **Blank** and the autopilot pill), the mic (**Listening** with ON AIR, REC and the light state, only once the transcriber has
  ever been set up), the cue (STANDBY, **GO**, **Bypass**, and a ⋯ with Back, Start again, what comes next and the last cue), the quiet
  line's badge, and **PANIC**, always last. At the curfew row 2 turns red with **Call the Aftermath**, **Keep running** and **Snooze 10
  min**; after a PANIC it is red with WORK LIGHT UP and **Resume**. The **Menu** is housekeeping only: the pack's export date, the **Pack
  check** (only when the pack lacks something), **Open the display page (for the iPad)**, Update pack, Export tonight's note, Clear
  tonight's capture (it confirms), the capture bar, Live sync, the site's pages and, last and set apart, Forget GM data (on a
  phone, Find and Crew are lines in it too). Long words in the band end in an ellipsis and carry their whole text in a tooltip. Below
  1100 px the band sticks to the top and the places scroll sideways; on a phone row 1 is the mark, the places and the Menu and row 2 the
  iPad, GO and PANIC. When the Access session has ended row 2 turns red with **Signed out: reload to sign in. Your notes are kept on
  this device.** (see Saving).
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
    starts a download). Every word must match; title matches first. With the switch `spine.find` on, each heading below a
    section's own (a room, a scene, a way) and each heading in a transclusion is an entry of its own, "Section › Heading", and
    choosing it lands on that heading. `↑` `↓` choose, `Enter` jumps
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
  - **Blade guesses who is who**: inside **Who is who**, **Blade, guess** asks Blade at once who each unnamed speaker number is
    (any number with at least 3 lines on the current connection). While Listening is on and Blade is on, Blade also looks by itself,
    at most every 3 minutes, once an unnamed number has about 8 lines. A guess shows as a chip under the boxes, like **S2 Quinn?
    (says "I" as Dara)**: tap it to name the speaker (it is the same save as typing the name), or tap **x** to dismiss it, and
    that same guess does not come back. Nothing is ever applied without your tap, a guess is never sent to the iPad or the phones,
    and it can only be a player's name or yours from the players list (see below). A guess only appears when Blade is set up and
    under 85% of tonight's cap.
  - **Update pack asks first** when the file would lose prep the app has (a part gone, a prep note gone or much
    shorter): the button reads **Upload anyway** and confirms (the same guard as `gm:pack` and `gm:push`, SYNC.md). A part the app
    retired on purpose (`engagement`, Engage's) is not a loss, in either guard (`RETIRED_PARTS`).
- **The drawer** (the band's **Crew**, key `W`, Esc or × shuts it): one right-edge panel, shut by default and remembered per browser (`b68.gm.drawer`). Under 600 px it is a full-screen sheet, opened by the **State** segment. Three tabs. **Table**: what the right column used to carry (crew heat, wanted, rep, stacks and vault from the table, read only; table clocks; the pack's world clocks; bargains owed with **Collect**; pins; who is on stage). **Crew**: the Run view's crew lines (room, moved, busy, items) while a v2 night is running, then the live crew sheet. **Players**: one sub-tab per character, each the live sheet. The sheets are same-origin frames of the app's own routes (`#t`, `#c/<id>`), **one frame at most**: made when its tab opens, taken down (src blank, then the node) when the tab or the drawer closes. They open **read only** (`?ro=1` on the app URL makes boot.js treat the viewer as unable to write) until you press **Edit**, which reloads the frame without it; leaving the tab or closing the drawer goes back to read only. The worker now sends `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'` (it was DENY / 'none').
- **Keys** (only on `#gm`; never while typing, never with Ctrl/Alt/Cmd but `Ctrl+K`): `1`–`4` roll a situation (`5`–`9` do nothing: the single tables have no keys), `R` `B` `N` `S` `J` `C` `D` `O` `T` `I` switch the panel
  (Prep, Location, NPC, Street scene, Score, Chase, Downtime, Cards, GM screen, iPad; `R` and `T` also put the cursor in that pane's find box, so typing
  lands there and not on the shortcuts), `F` Focus, `W` the drawer (open or shut), `/` or `Ctrl+K` Find, `P` `X` `M` open capture as Name / Loose end / Moment (Enter files, Esc leaves), `L` files
  the last roll under "Rolled at the table", `Shift+H`, or `H` twice within a second, blanks the screen until any key or tap (one stray `H` does
  nothing; the first alone says how, once per page load), `0` clears the iPad to its ambient scene (the tray's **Clear**),
  `Ctrl+←` / `Ctrl+→` look at the place before or after (never a phase change), `Space` and `PageDown` are GO. **Esc** does one thing per
  press (`app/gm/esc.js`): it closes the topmost open thing (Find, the Menu, a popover in the band, the Blade panel sliding over the page,
  the drawer, a sheet, a Run view pop-up or peek), else leaves the field you are typing in, else takes the stamp down, else it is
  **PANIC**. While something is open no other key fires behind it, except its own: `W` shuts the drawer, `A` the Blade panel, `Ctrl+K` Find. With the kit and stage settings on, a few keys are new or differ (`Shift+A` is Pitch now, `Delete` dismisses a focused card, `C` `S` `J` `O` open the four put-away views): see "The kit and stage: five settings", Keys.
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
- **Now in** (the district every tool starts from, 18/10/2026). One select, in the Roll's Scene fold at every width (the band has no
  copy since 06/11/2026), kept in the GM state as `now: { district }` (`''`: anywhere). The console's **District**, the Street scene's, the
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
  **iso** map at once (the controls go to iso / GM, the theme stays; Draw is for another view, theme or layer). Iso is the view the table
  plays with (the map kit's ROADMAP, decision 17/10); it was rings until map kit 0.7 came into the app (22/10/2026).
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
    line, **Show on iPad**, **Set as score scene** and **Take it down** together, never in a fold; then the map; under it
    **View & theme** (a fold, presentation only: View iso, rings, plan, section or **street**, the street outside the building; Theme
    rulebook, blueprint, casefile, board or **plate**, the lit plate; **Time** as rolled, at Bluetime or at Night; **Weather** as the
    theme does (the plate draws the roll's, the others only on the street when asked), the roll's, none, rain, fog or snow; the fold's
    line names what is set) and Download SVG / note (.md) / canvas under Downloads. The page asks the kit through one function,
    `P.mapOpts`, so the preview, the iPad and the downloads draw the same controls. **Show on iPad** is enabled only on the player layer, and
    the code renders the player layer itself and refuses any other svg (`gate` in `gm-page.js`; tested in
    `gm-nosecrets.test.mjs`, `gm-page.test.mjs` and `gm.e2e.mjs`). The street description goes to the iPad as plain
    text through the `playerSummary` whitelist only (the gate passes non-svg kinds), so `playerSummary` and `pushText`
    are secrecy-critical.
- **Reveal.** Every new roll and every replay starts with the public band only. The ticks count only while Layer is
  Player (on the GM layer the street description and everything else use public only), and sending anything beyond public
  to the iPad asks first, naming the bands.
- **The iPad's copy.** Show on iPad renders the player layer at the iPad's size (`P.IPAD_MAP`: 1366 px wide, a 16 px type floor;
  map kit 0.8's `layout: "ipad"` replaces it in that one place), whatever the preview's width.
- **Live reveal** (Alex, 22/10/2026: the iPad is the only player screen, and the GM opens bands and it updates at once; tightened
  after the secrecy review of 23/10/2026). Show on iPad starts it: the page keeps what actually went up (`S.mapOn`: the roll, the
  bands, the view, theme, time and weather, and the display `seq` the server answered). While that roll is the card, Layer is Player
  and nothing else has been pushed, the Reveal legend says **Live on the iPad** (only while the iPad holds exactly the ticked bands;
  **Sending to the iPad…** while a copy is on its way), and ticking a band sends the player copy again at once:
  - **Asking.** A copy that would show any band the iPad does not have asks first, naming all of them, whichever box was ticked
    ("opening the working band shows it to the players now"). Closing one does not ask. A no takes the new bands off the ticks.
  - **What goes.** The copy is drawn in the view, theme, time and weather Show on iPad sent (changing them only redraws the preview),
    through the same render, hidden-name scan and gate. It is sent with `ifSeq` (the `seq` of the last push): if anything has gone
    to the display since, from this page or another device, the server answers 409, nothing changes there, and live reveal stops
    with a toast.
  - **A copy that cannot be made safely.** When it would open a band, nothing goes and the band stays shut. When it would close one,
    the iPad is cleared (as Take it down), since it must not keep showing that band, and the toast says so.
  - **What ends it.** Layer to GM, another roll (or an Earlier, a saved site, an authored site), or any other push (Clear, Lights
    out, an NPC, a handout, the clocks, the chase strip…) ends it at once; back on the player layer it is not live until Show on iPad.
  - **One push at a time.** Every push from the GM page goes through one queue: one PUT in flight, a newer push replaces one still
    waiting (it is never sent), so the last thing the GM set is what ends on the iPad, however fast the boxes are ticked.
  The score scene does not follow (below); when it shows other bands than the ticks, the map box says so. Checks:
  `gm-page.test.mjs` (9m–9t: 9p–9t are the review's repros R1–R4), `gm-nosecrets.test.mjs` (j, k), `checks/api/gm.mjs` (ifSeq),
  `gm-maps.e2e.mjs` (`npm run check:gm-maps`: the GM page and the iPad at 1366 × 1024 against a local Worker; `GM_SHOTS=<dir>`
  keeps its screenshots).
- **Open one room** (M4 step 5; map kit 0.9). Under the band ticks, **Open one room** lists each room of a run whose band is not ticked, with
  **Open for the players** (and **Close** once it is open). It is there for a **run** only (an authored site with a `play` block): the open
  rooms live in that site's `ball.open`, a list of room names, so another site's list is never this one's (a different site starts with none). The list is run state like the crew and the pins: reopening the
  same site resets the bands to public but keeps the rooms opened, which is safe because a reopen ends live reveal and Show on iPad asks by room name.
  Absent or malformed means no rooms, so old rows load as they were. Like the bands it counts only while Layer is Player. It goes through
  the same path as a band: the map kit gets `room:<name>` beside the bands, the page's own scan and token screen use the kit's rule (a room is
  shown when its band is revealed **or** it has its own entry; `roomShown`), and while the map is live on the iPad the change is sent by
  `liveReveal` with `ifSeq`. **Opening asks first** ("opening the room X shows it to the players now"; Show on iPad says "the room X,
  opened on its own"), a no takes the room back off `ball.open`, and **closing does not ask**. A change to `ball.open` on another device
  re-sends on refetch, as a moved marker does.
  - **What it shows.** That room only: its name, floor tint, walls, doors and fixtures, and any PC marker or visible clock pinned in it
    (markers are keyed on the room's name, so a marker in a room opened alone inside a shut band is drawn, and one in its unopened sibling is
    not). The player copy numbers the rooms the crew knows 1 to k (in the drawing, the key and the `data-room` ids), so the numbers never say
    how many rooms are shut; its band shows as "partly surveyed" with only the known rooms. The caption names the opened room.
  - **What it does not show.** Not its band, not the rooms beside it, not the passages or corridors (they follow their band: a room opened
    alone stands in the cover with no passage drawn to it), not any shut room's name, and not how many there are. The street view stays the
    public street. It does not reach the **street text** (Say box and Push text), the **score scene** (its `reveal` is bands only: the server
    refuses anything else) or the **glance and fold hints** ("players see it"): those stay band-only, so a room opened alone is not marked
    there. A name that is no room of the roll opens nothing. Opening the **target** room on its own is the GM's call and is allowed.
  - Checks: `gm-nosecrets.test.mjs` (n: a room alone in a closed band, a room on top of a band, the no-id-above-k count, the marker rule),
    `gm-page.test.mjs` (S6a-S6f), `gm-run.e2e.mjs` and `gm-maps.e2e.mjs` (opening, the marker, closing, on the iPad).
- **Hidden names.** Map kit 0.2 titled a `plan` or `section` level of the player layer after the room on it, even when that room was
  hidden. From 0.5 (vendored: 0.7.1, 22/10/2026) every floor is titled generically ("Basement", "Ground floor", "Upper floor", "Top
  floor") and a hidden room's name is not in the player file at all. The page still scans every player render for the names of hidden
  rooms, both threats and a hidden target (and, since 23/10/2026, every loot, lock and obstacle phrase, the loot list, the watcher and
  how the service side and the back route get in, whatever is revealed; the kit draws those as icons, never words), in the whole svg
  source (attributes, ids, comments, `<title>`, `<desc>`, entities decoded, whole words), and refuses to send one that holds a name ("This view would name a hidden room: use Rings
  or Iso, or reveal more bands"); an iso that names one is redrawn as rings first (PR #53; the score scene's exploded site likewise,
  `isoRings`), and refused only when the rings name one too. 0.7.1 never names a hidden room in a floor title, so both stay as defence
  in depth. The in-page Player draw shows the same warning and the Player SVG download is refused. The kit's four
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
    leg or move of the opposing clock sends it again, as **Clocks on the iPad** does. "On the iPad" is the display seq the server
    answered when the strip went up, not its title: each re-send goes with `ifSeq`, so it lands only while nothing else has gone to
    the display since. A push from another device in between is a 409: nothing is overwritten, the strip stops following and a toast
    says so. Anything else this page pushes, or ending the chase, ends it at once; Show on iPad starts it again (`gm-page.test.mjs` 19g).
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
  - **the prep notes' visual language** (27/10/2026, so a glance says what a line is for): `> [!example] SEE` as a picture
    card (italic, an eye mark): what the table is shown, never the rules; a code span that is one `{brace}` (`` `{+1d}` ``,
    `` `{Heat +2}` ``) as a blue rule chip, shown without its braces: the mechanical consequence; `==clue==` (the mustard
    highlight): what must land; `> [!warning]`: don't; `> [!gm]` as a dashed GM ONLY box: a secret; `> [!rule]` as a blue
    box: mechanics that need more than a chip; and a bullet that opens with a bold word sets the word as a label (the GM's
    action: **Hand**, **Ask**, **Wait**), except inside SAY;
  - links: `[[#Heading]]` scrolls; an NPC, PC or faction opens a peek card from the pack's campaign part (an NPC in the app's
    cast gets Show on iPad and Put on stage); the peek, and the **Card** button in the cast list (N), show the NPC's whole card
    from the pack's campaign part (`cards`, built from the vault card with its provenance stripped); another prep note opens it, at the heading the link names; a note carried in as a
    transclusion scrolls to the heading the link names inside it (`[[pockets#B. The swan job]]` lands on B, not on the note's
    first transclusion), else to the transclusion; the open note by its own name scrolls here rather than leaving for Obsidian;
    anything else opens in Obsidian (`obsidian://open`). A jump lands under the sticky bars (`scroll-margin-top` on the sections,
    the headings and the transclusions: 140 px on a phone, 8 px in the laptop layout);
  - **Pin** on a section keeps it, live, at the top of the rail (three at most, `prep.pins`); **Wide** hides the console (on a laptop, **Focus** shrinks it to its keys instead);
  - an embedded **score card** (the exporter's `score` on the block) gets a **Site** strip under its header: see **Score sites** below;
  - **Find in the note** (the box in the bar; `R` puts the cursor there): every word somewhere in a section's heading or text keeps
    its chip in the section list, Enter goes to the first match, Esc leaves the box. With `spine.find` on, Enter goes to the
    next heading that matches (a room, a scene, a way), in the note's order and round again, and a toast says which ("2 of 5").
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
- **Authored sites** (23/10/2026; the plan is the vault page `Projects/blades-68-authored-sites.md`). A hand-built location, assigned
  to a score card from the vault instead of rolled, that reveals band by band like any roll.
  - **The source.** A location note in the vault's `Locations/` holds one fenced block, ` ```json b68-site `: `{ base?: { seed, ui,
    mem }, patch: { rooms: [{ name, band, detail?, isTarget? }], ...any other roll field }, map?: { view, theme } }`. A room may also carry `w` (a whole number, 2 to 12: its size in the plan) and `lvl` (-1 below ground, 0 street, 1 upstairs, 2 roof), which win over the kit's catalogue for that room; anything else is ignored. The front way in (`patch.vectors[0]`) may name a street-floor `room` with a wall to the street, and the map lands the front door on it (otherwise the widest, shallowest street room takes it). This is an app-side change to the vendored map kit (`B68Map` 0.9.0, `app/kits.json` notes it): the design system's map kit should take it upstream, and a kit update must keep it until then (`checks/runtime/map-kit-room.test.mjs`). A score card in
    `Campaigns/Group/Scores/` binds to it with `site: "[[<note name>]]"`. **Each room's `detail` reaches the players** once its band is
    revealed and the street description is sent (`playerSummary`): write what anyone in the room sees, never GM notes.
  - **The pack.** `scripts/lib/authored-export.mjs`, called by the location part's builder: `location.authored = { v: 1, sites: { <note
    name>: { name, rel, base?, patch, map? } }, bind: { <score key>: <note name> } }`, or no key. Inside the location part because the
    server keeps at most 24 parts. A bad block is skipped with a warning; at most 24 sites, 60 KB a block, 40 rooms.
  - **The roll.** `P.authoredRoll(L, pack, site)`: the base (the generator's roll from `base`, or from a seed made of the name) with
    the patch laid over it, so the card, the folds, the map, Show on iPad and its hidden-name check and the score scene take it
    unchanged. The base's skips go unless the patch has its own; the card's three ways in are each the patch's over the base's; a way
    in or target naming a replaced room names none. The roll carries `auth: <name>`.
  - **On the page.** A bound card's Prep strip shows the site, **authored**, and **Open map** (a roll saved for the same score stays
    reachable: Open the roll, Clear the roll). Open map makes the Location card `{ hid, auth, label, at }` (no seed), in the view and
    theme the block asks for (else iso, rulebook), GM layer, public band only. `P.locKey(card)` and `P.rollKey(roll)` (`a:<name>`,
    else the seed) say whether the roll on screen is the card's. The save row says the vault binds it. A roll after it replaces the
    card whole (`replacePatch`), so no `auth` survives. `gm:pull` never sees one: authored cards are not in `sites`.
  - **The vault keeps the binding.** A score card whose `site:` names an authored site keeps it: `gm:pull` still files a roll saved
    for that score, but does not move the link (`sync-sites.mjs`, a skip in the report).
  - **Checks:** `gm-authored.test.mjs` (the exporter, the roll, the keys, a leak scan at every reveal), `gm-page.test.mjs` (S4),
    `gm-sites.test.mjs` (the binding kept).
  - **The play block** (`play`, optional, GM-only; never in the roll, so never on the iPad). Inside the same `b68-site` JSON:
    `{ v: 1, clock: { start, end, step?, label? }, floors?, routes?, people?, disguises?, events?, clocks? }`. `app/gm/ball.js`
    `checkPlay` runs at gm:pack and drops what fails with a warning (an unknown room, a bad time, a `with` loop). Times are `HH:MM`
    and one earlier than `clock.start` is the next morning (00:15 follows 23:30). `floors` only names levels; the map kit decides which
    floor a room sits on.
  - **The view.** `ballView(play, state, floorOf)` is pure. `state` is the `ball` object of the GM state doc (`t` minutes from
    `clock.start`, `lens` a disguise id, `crew`, `open`, `pins`); `floorOf` is room name -> level from `B68Map.floors(roll)`. It returns
    `{ minute, label, people: [{ id, label, kind, room, note, moving }], rooms: { <name>: { lvl, people, crew, pinned, lens: { pos, danger } | null,
    open } }, next: [{ at, label, room }], routes }`. A person follows their own stops, or their `with` person; the note shown is the person's own, never the leader's; `moving` shows in the 5
    minutes before a stop. `lens.pos` is controlled, risky, desperate or unknown (a room on no floor); `danger` is true when the person a
    disguise `sees` stands in the room (free text, matched by id, label or a whole word of the label). `next` is the next three events
    and target stops after `t`.
  - **Run the site** (`app/gm-page.js`, the Location card). When the card is an authored site with a `play` block (never a rolled one),
    a strip sits above the map: floor tabs (All, then each level by number, named by `play.floors` else the kit's title), the time (a
    scrubber from `clock.start` to `clock.end` with a tick per event and a dot per window of the target, -15 and +15, **Left** and **Right** for 5
    minutes while the strip has the focus, **Next window**, and the time in big type), a Disguise select, the crew (tap a PC chip, then a
    room chip; the room they are in takes them off) and the table's clocks (tap one, then a room: **Pin to room**). Beside the map:
    **At** the time, **Next** and **Routes** (arrows for both ways, up and down; an eye for watched, a key for needs). `t` is only what the
    GM set: the wall clock is never read. The map's tokens go through the kit's `tokens` option, **one per room** (initials pills by kind,
    the lens chip C, R, D or ?, a red ring when the person the disguise sees through is there, a pie per pinned clock), on the **GM layer
    only** (the people, the lens and the timeline never leave it; the players' copy has its own, smaller tokens: see below). A floor tab passes the kit's `floor` (iso, plan and section;
    rings draws every floor). While the slider moves, the clock and the side update at once and the state and map follow after 200 ms of
    quiet; each drawn (view, theme, floor, tokens) is kept (24), so going back costs nothing. A run draws itself when the panel opens.
  - **The players' copy of a run** (M3; design 4.7 and 4.10). Show on iPad and live reveal gain two things from the run, in rooms the player copy
    shows (a revealed band) and nowhere else: a marker for each PC placed in `ball.crew` and a pie for each pinned table clock the players can
    see (`hidden` is not set; a hidden clock is dropped whole, not drawn blank). One token per room; its label is the PCs' names only (three, then
    `+N`); a pie carries no words. Never: a person, the lens or a danger ring, the timeline, NPC positions, a clock's name. One small pure builder,
    `playerTokens(placed, shown, clocks, pcs)` (`placed` is `{ crew, pins }` only; it never receives `play`, the lens or the people), separate
    from the GM token builder. `playerDisplay(roll, map, render, { tokens, hide })` is the one door: `tokenScreen` checks the shape
    (`{ room, label, svg }`), drops a token in a room that is not shown (the kit drops it too), and scans every label and svg with the hidden-name
    scan, whose deny list is the map's own hidden names plus the play's people and disguise labels and the names of hidden clocks (`hide`, built
    from `play` by the page and used for nothing else). Any hit **fails closed**: no marker goes out, the map still does, and the GM gets one red
    toast per set (the preview says so too). A map that only leaks with its markers is redrawn without them before it is refused. With nothing to
    show (empty `crew` and `pins`, markers only in hidden rooms, only hidden clocks, another site's `ball`), the render options carry no `tokens`
    key and the copy is byte-identical to a run with no ball. The score scene never carries markers. **Live:** `S.mapOn` gains `tok` (the
    request that landed) and `tokQ` (the latest queued), both the signature of the requested markers before the screen; a change to `ball`
    (here, or from another device on refetch), to the table's clocks (a tick, a clock hidden or shown) or to a filed character's name re-sends
    through `liveReveal` (same render, scan, gate and queue, `ifSeq`; a 409 ends live reveal as for bands). A time scrub, a hidden pin or a poll
    with nothing new sends nothing. The Layer switch still ends live reveal (so a marker moves live only while Layer is Player). The player
    preview in the map box shows the same markers and never reads or writes the GM layer's drawn-map cache. Checks: `gm-nosecrets.test.mjs` (m),
    `gm-page.test.mjs` (S5e, S5g-S5j) and `gm-maps.e2e.mjs` (a marker moved reaching the iPad).
  - **`ball` in the GM state** (GM-only, never on the display): `{ site, t, floor: <level> | "all", lens, crew: { <pc id>: room }, pins: { <table clock id>: room }, open?, dawn? }`.
    It belongs to the site named in `site`: another site's `ball` reads as empty and the first write replaces it whole. `crew` and `pins`
    are written with a replace patch, so a removed key goes (`open` is the list of rooms opened alone for the players (M4 step 5, "Open one room" above), written only by that action and kept as it is by every other write; `dawn` is written by the False dawn button as `{ at }`, set by a replace of the whole `ball` like the rest, and kept by every other write). Checks:
    `gm-page.test.mjs` (S5) and `gm-run.e2e.mjs` (a real Worker and browser: floors, midnight, disguise, PC, pin, reload, and the iPad payload).
- **State.** The GM state document holds `con` (the console state: `live` controls, `owed`, `struck`, `used`), `loc`
  (`ui`, `map`), `mem` (the repeat guards), `cards` (the current card per tool as `{ id, seed, ui, mem }`, `mem` a JSON
  string of the guard before the roll, and for the console `con`, a JSON string of the bargains and callbacks as they were,
  so a reload or an Earlier click redraws exactly the same card even after a callback was used or a bargain collected),
  `hist` (five per tool), `npc` (`ui`: the NPC pickers), `npcgen` (`{ seed, mem, at, s?, ui? }` per generated NPC id: the
  roll that made them, `ui` only when a picker was set), `sc` (`ui`: the Score panel's choices; its cards are `cards.score` /
  `hist.score` / `mem.score`, see Score (J)), `dt` (`ui`: the Downtime panel's choices; its cards are `cards.downtime` /
  `hist.downtime` / `mem.downtime`, see Downtime (D)), `ball` (Run the site: `{ site, t, floor, lens, crew, pins }`, see Authored sites), `pins` (50, text), `capture` (400, and 128 KiB: `{ id, bucket: n|x|m|r, text, at, s? }`),
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

## The kits (`app/kits.json`, `npm run kits`)

The design system's two kits are vendored: the map kit in `app/maps/map-kit.js` (`B68Map`, 1.0.0: single-room reveal, `room:<name>`, and the grand map below) and the figure kit in
`app/figures/figure-kit.js` (`B68Figure`, 3.0.1, which carries the arm blend `tools/ambient/motion.js` uses, so the app no longer patches it). `app/kits.json` records each one's file, version, size, sha256, where it came from
and when; `npm run kits` prints it and says whether the files still match. To update one, download the kit from the design system
(or build it) and run `node scripts/kits.mjs maps <map-kit.js> --source "<where it came from>"` (or `figures`): it checks the file
loads and is that kit, refuses an older version unless `--older`, copies it in and rewrites the entry. `checks/runtime/kits.test.mjs`
(in `check:runtime`) fails when a file does not match its entry, when a kit is missing from the `routes.js` bundles (the service
worker precaches what they list, so that is what keeps a kit offline) and when the map kit lacks what the GM page asks of it. A new
kit reaches the table only with a deploy, which stays Alex's call and never on a session day.

### Map kit 1.0, the grand map (switch `map.kit1`, default off)

Kit 1.0 is built app-side in the vendored kit (`src/grand.js` inside `app/maps/map-kit.js`, with hook lines in render, layout, model,
parts, iso and themes; a TODO there says what to port to the design system). It draws only when an authored site's patch says
`kit: 1` AND the switch is on (the GM page then passes `kit1: true` to every map it renders: the map panel, Run the site, Show on
iPad, the score scene). Without both, every byte is 0.9's: `checks/runtime/map-kit1.test.mjs` compares 204 renders against hashes
taken from 0.9 itself, both ways. The switch is the registry's `map.kit1` (`app/features.js`: GM only, stage Maps, Saturday
"try"), read live from the GM state document through `B68Features.valueOf`; All off turns it off, and a flip redraws the map on screen.

The fields, in the site's `patch` (feet; x runs along the front, left to right as you face the building; y runs back from the front):

```text
kit: 1
build.style    "palazzo": parapet and cornice, arched windows, a rusticated base; no pitched roof or chimney
build.front    "canal" | "street" (default street)
build.floors   { "-1".."2": { x, y, w, d, h } }   each floor's footprint, h its storey height (8 to 40; default 14, basement 11)
build.core     [x, y, w, d]                       the stairs-and-lift core, on every floor it fits
build.stair    { room, to }                       a grand branching stair in that room, up to floor `to`
build.faces    [{ kind, room }]                   kind: water-door | water-steps | boats | loading-door
rooms[i].lvl   -1..2;  rooms[i].at  [x, y, w, d]  where the room stands on its floor
rooms[i].span  2                                  double height: it rises through the floor above
rooms[i].ring  "<spanning room>"                  on the floor above it: a gallery round its void
rooms[i].gallery  4..20 (default 8);  rooms[i].scale  "grand" | "service"
```

A floor whose every room has `at` (inside the footprint, none overlapping) is drawn as authored; what no room covers is passage (and
a warning). Otherwise the floor is laid out in its footprint as 0.9 lays one out, and says why. Every bad field is a warning on the
map, never a guess. The **section** is the iPad's score view (every room a cell, front on the left); the **iso** is the planning board
and the print. Secrecy is 0.9's: the layout never depends on the reveal, a player copy only leaves pieces out, a void is known with
the gallery round it (else the room under it), and the chandelier and double height show only once the crew knows that room.
One shape to avoid for now: a lone room on floor 1. `B68Map.floors` (Run the site's floor lens) still folds it onto the street
floor as 0.9 does, while kit 1.0 draws it upstairs; give floor 1 two rooms or more.

## The display (`#display`, `app/display-page.js`, `app/display.css`)

Full screen (no header, nav or banner) for an iPad signed in as the GM. Boot mounts
`B68DisplayPage.mount(container, { gm, db, figures, cast, isGM })` once the files settle (`db` is the resolved db) and
calls `unmount()` on leaving; anyone but the GM sees a message instead. The GM page's Menu (**Open the display page**) opens it.

The display offers **no way back** to the GM page (no link, hidden or not). Its sanitiser applies the same rules as the server's `checkSvg` (namespaced
elements, `<a>`, `xml:base`, backslashes, `image-set()` / `src()`, raster `data:` images only on `<image>` / `<feImage>`).

**Nothing is drawn over a map** (22/10/2026). An `svg` display that names itself (a `<title>` as the root's first element child:
every map-kit map and chase strip, whose own key prints the place, the district and the surveyed bands) gets no caption; one that does
not (the GM page's clocks picture) gets its title and caption in a bar under the drawing, and the drawing is fitted to the space above
it. Every map frame also stops above the corner status line. The title and caption still reach a screen reader (`aria-label`). The
Full screen button and the Add to Home Screen hint are controls, not captions: they come up on a touch and go after 7 s idle (the hint
only until Got it). `gm-maps.e2e.mjs` checks, at 1366 × 1024 and 1024 × 1366, that no caption and no status line meets the drawn
box of a map, a street, a chase strip or an untitled svg. A handout keeps its own caption rule (`showTitle`).

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
| `veil` | `sunrise-ball-opening` | The Sunrise Ball's opening (s04), 30 s and silent: a crane down to the Velvet Veil and the gondola queue, Ironclad at the water door, through the glass to the chandelier, the title; **pin only**, pinned after the engagement roll while the GM narrates, plays once and holds on the title |
| `board`, `exploded` | `planning-board`, `score-exploded` | The score scenes |
| `testcard` | `test-card` | Please stand by (pin only) |
| `landing` | `night-landing` | The landing: guests arriving by boat at a grand lit building at night, a flashbulb now and then; extras only, no text. Held still, one composed frame and no flash. Not in the default rotation: pin it, or tick it into a playlist |

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
  district go with it (`target` is always empty). It **never updates on its own**: press it again after revealing more (the
  Location panel's map box says when its bands are not the ones ticked). The shells
  (`planning-board`, `score-exploded`) hold no data; they post `b68:ready` and the display answers with `b68:score` (both svgs
  re-sanitised, and the crew polaroids drawn with the figure kit from the ambient document's `polaroids` list: `night.who` sends it while a session is open, and with no list there are none).
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
  cigarette), anything bigger means asking the design tool again. The score scenes' polaroids are not in the code: they come from the ambient document's `polaroids` list, which Start the night (`night.who`) sends from who is playing. Offline, a scene never played before shows blank and the watchdog skips it.

### Overlays (the ambient document's `overlay` and `auto`; `showOverlay` / `clearOverlay` on the GM page)

Something laid over the iPad **without replacing what is up**: the map, a handout, a spotlight or the ambient scene underneath stays put and needs no "return to what was up". It rides the ambient document, so it arrives on the display's existing poll with no new request.
- **`overlay`** (`PATCH /api/gm/ambient`; `null` removes it): `{ id (at most 40), kind clock|npc|fx|text, ms 1000-180000, auto? }` plus `clock { clockId }`, `npc { npcId }`, `fx { fx: 'dawn' }` or `text { text (at most 120) }`. Malformed is 400, too long 413. A fresh object is built, so any other field is dropped; the server sets `at`.
  - **A clock is named by its id, and the overlay follows the clock.** The caller sends `clockId` and nothing of the clock, and **only the id is stored** (`at,clockId,id,kind,ms`, plus `auto`). **When it is set** the server checks the campaign's clocks (`assertOverlayClock`, functions/_lib/campaign.js; the `clocks` array is cut out in SQL, one read by primary key): **400 unless that clock exists, is not `hidden` and has a name**; a hidden clock, a missing one, a removed one and a nameless one read in the same words (`overlay.clockId must be a clock the players can see`), and a refusal stores nothing, even the keys beside it. **When it is read** (`joinOverlayClock`, below) the display GET attaches the clock's name (at most 60), size and its LIVE fill, so the card on the iPad follows the clock as it is ticked and **vanishes if the clock is hidden or removed**, whether or not the GM page is open. A name, size or fill sent beside the id is dropped.
  - An `npc` overlay is **400 unless that NPC's row is live, in this campaign and `revealed: true`** (`assertRevealedNpc`, functions/_lib/npcs.js): a hidden NPC reads exactly like a missing one, and a refusal stores nothing. **The stored overlay carries the NPC's id and nothing of the NPC** (`at,id,kind,ms,npcId`, plus `auto` when the autopilot sent it): the name is joined on the way out, below.
  - **`auto: true`** (on the overlay, or in the patch beside an overlay, which marks it) says the autopilot sent it. The server refuses it with **409 while the display is in lights out**, and the display GET leaves it out while the display is `dark`. A GM-pressed overlay (the dawn) carries no such mark and is allowed over black.
  - Overlay ids are opaque: the GM page makes them from a per-load random prefix and a counter (`o1b2c-7`, the autopilot's `a9x4k-3`), never from a name or an id of the thing shown.
- **`auto`** (true, false or null): the small AUTO chip in the iPad's top-left corner. Nothing else.
- **On the display** (`Pure.cleanOverlay`, `overlayStep`, `dawnPhases`, `overlayCard`; `.dp-overlay` over the stages, under the status and buttons): the page validates again and shows nothing that does not pass. Each id shows once, for its `ms` **from the moment the server set it** (`at`), and goes at `overlay: null` or a new id (a cleared id can be shown afresh). **Expiry is the server's**: `GET /api/gm/display` leaves the overlay out of its answer once the server's clock passes `at + ms` (response only: nothing is written, `seq` does not move, and `GET /api/gm/ambient` still holds it), and while it runs adds `age`, the whole ms since `at` by the server's clock. A display that reloads mid-overlay therefore carries on: a card for the rest of its ms, the dawn straight into the phase it has reached (a hold is white at once, never the warm start again) and out at the same end; one that reloads after the end shows nothing. The iPad's own clock and the GM page never decide any of this. Because the page learns of an overlay at its next poll (4 s), a dawn first seen late starts late in its phases (past the 2 s ramp it opens in the hold) and still ends on time. Clock, NPC and text cards take the right-hand 34% (the left edge is never left of 66%); the clock is an svg built node by node, all text is `textContent`. **The NPC card is joined at read time, on the server** (`joinOverlayNpc`, functions/_lib/npcs.js, run by `GET /api/gm/display` after the expiry check, only when the overlay is an npc one: one read of the NPC row by primary key). While that NPC is live, in this campaign and `revealed: true`, the overlay in the answer gains `npc`: exactly `name`, `alias`, `role`, `faction` and the figure's `spec` (each copied by name; never the description, gmNotes, tags or the revealed flag; and of the spec only the figure's drawing keys, `FIGURE_SPEC_KEYS`, so a label such as its name or plate, or any key added to a spec, is stripped); otherwise the overlay is left out of the answer. The page draws the card from `overlay.npc` and reads nothing of the cast for it, so the table's display-only sign-in, which cannot read `npcs`, draws a revealed NPC's card, and an NPC hidden after the overlay was stored goes at the display's next poll. **A clock overlay is joined the same way** (`joinOverlayClock`, functions/_lib/campaign.js: one read of the campaign's `clocks` by primary key, only while a clock overlay is up): the answer carries the clock's name, size and live fill while it is present and not hidden, and leaves the overlay out otherwise, which also drops a clock overlay of the old shape (a name and no `clockId`) without reading anything or rendering it. **The overlay rides on its own.** Every answer that carries the ambient part (all but the oldest `?seq`-only call) has a small top-level `overlay` (the joined object, or `null`), made on each poll from the stored overlay alone: the ambient row's `overlay` is cut out in SQL (`loadAmbientLite`), so the rest of the ambient document, which can hold a megabyte of score maps, is neither read nor parsed on a poll that finds it unchanged. The big ambient part therefore stays changed-only (`{ seq, unchanged: true }` while its seq is current); a hidden NPC or clock, the end of an overlay and a fill that moves all reach a display whose ambient seq is current through this field. The display applies it after the display part of the answer (so it already knows whether it is dark); the same overlay is also inside `ambient.doc` whenever that goes out in full (an older display reads it from there). The page redraws a clock card in place when the same id arrives with another fill. Measured on `wrangler dev` (50 warm requests, a clock overlay up, a score scene of two 135 KB maps): median 1.0 ms and max 3.0 ms of Worker CPU, against 4.7 and 6.8 ms when the whole ambient part was resent every poll. Nothing is written. **Lights out:** the page draws no `auto` overlay and no AUTO chip over a `dark` spotlight (it takes one down the moment the lights go out, and it stays gone when they return), and the server leaves one out of the answer while dark. The dawn covers the whole frame: 0-2 s warm to white, a white hold with a faint lamp glow, a 2 s fade at the end (a quarter of a very short run each way), no text. Under `prefers-reduced-motion` it is white at once for the whole `ms` and then straight back.
- **The false dawn** (Run the site): a **False dawn** button on the strip and on any `fx: 'dawn'` event in the Next list. It asks first ("The iPad goes white for 30 seconds"; a no sends nothing), then `showOverlay({ kind: 'fx', fx: 'dawn', ms: 30000 })`, and records `ball.dawn = { at }` (GM state only) once the iPad took it. It never fires by itself: the clock, Next window and the scrub send nothing.
- **The GM page**: `showOverlay(o)` (an id is made when none is given; a new id is what shows it afresh) and `clearOverlay()` go through the page's `patchAmbient`, so the gate runs (`overlayOk`: exactly these shapes, no stray field, no svg). The iPad panel names what was sent ("Overlay sent: dawn · 30 s") and has **Clear overlay**. **Never put model text or prep text in an overlay**: only what the GM chose.
- **A text overlay** is free text, so it is scanned twice. `gate.allowsAmbient` on the GM page refuses one that names a hidden clock or a hidden NPC (name or alias) as a whole word in any case ("Vex" is hit by "vex said", not by "Vexing"; Unicode-aware, regex characters escaped, a failing name source fails closed). **The server scans too**: `PATCH /api/gm/ambient` answers 400 (`overlay.text names something the players must not see`, storing nothing) when the text of a `text` overlay hits, by the same rule (`namesHit`, functions/_lib/gm.js, held to the page's by a test on shared cases), any hidden clock's name or any name or alias of an NPC who is not revealed. The names are read only on such a PATCH, in one batch of two statements (`loadHiddenNames`: the clocks cut out with json_extract, and the NPCs that are not revealed); the display's poll never reads them. Clocks and NPCs go by id and are checked by the server at set time and joined at read time.
- Checks: `checks/api/gm.mjs` (every field, the clock-by-id refusals with positive controls, lights out, the NPC join and its hidden / deleted drop), `checks/runtime/display.test.mjs` (the view model), `gm-page.test.mjs` (9j2, 9j3: the shapes, the text scan), `npm run check:display-overlay` (every kind in a browser, the dawn's phases, reloads mid-dawn, mid-card and after expiry, reduced motion, the display-only sign-in drawing a revealed NPC), `gm-run.e2e.mjs` (the False dawn button).

### The show contract (suite W0.3: `functions/_lib/show.js`, `show-vet.js`, `app/gm/show.js`, `app/display/shows.js`, `show-beats.js`, `layers.js`; look book `app/lookbook.html`)

What the table display can be told to show beyond the four overlays above. It reuses the overlay's rails (the ambient document, the server's clock, the join on every poll) and adds one registry and a set of lasting layers. No switch: nothing sends any of it until a later bundle (or the console) does.

- **Brief beats are overlay kinds.** `{ id, kind, ms 1000-180000, payload }` with `kind` one of `stamp { word (24), tone? ink|orange|blue|red }`, `spotted { text? (60), level? 1-3 }`, `keyturn { label (60), pc? (60) }`, `title { text (80), sub? (120) }`, `wanted { level 0-4, heat? 0-9, siren? }`, `ring { text? (60) }`, `rolodex { npcIds [1-12] }` `spotlight { npcId }` and `report { position, effect, text? (100) }` (the action report card, B09). The payload is rebuilt from named keys on write and again on every read; a stray key is dropped.
- **Secrecy.** `rolodex` and `spotlight` are joined to their NPC rows like an `npc` overlay: **revealed NPCs only**. A hidden, missing or deleted NPC is dropped when the beat is written (none left: 400, the same words for every cause) and dropped again on every poll, so an NPC hidden afterwards leaves the card in place (the page redraws the same id when its served payload changes) and the last one takes the beat off. Free text in any payload or layer is scanned for hidden names (400), by the server and by `gate.allowsAmbient`.
- **Lasting layers** sit in the ambient document's `layers` and stay until cleared: `band.phase pb|plan|score|after`, `band.security 0-4`, `band.faces [<=3 of { npcId } | { pcId }]`, `band.onair true`, `scene.filter flashback`, `scene.layout montage`, `scene.mode start|aftermath`, `data.countdown { to (epoch ms), label? (40) }`, `data.credits [npcId <=30]`, `data.previously [npcId <=12]`. One path at a time: `PATCH /api/gm/ambient { layer: { path, value } }` (`value: null` clears that path); `{ layers: null }` clears all. Faces, credits and previously are joined to revealed NPCs the same way (a layer left empty is left out); a `pcId` face passes as it is.
- **The GET.** The display GET carries a top-level `layers` (joined) beside `overlay`, **only while any layer is set**: with nothing up the answer is byte-identical to before and costs the same statements. `loadAmbientLite` still parses the document once (one `json_extract` with two paths). A beat that names no NPC adds no read; a rolodex or a layer that names NPCs adds ONE batched `IN` read for all of them. Expiry is the overlay's own: left out once the server's clock passes `at + ms`, nothing written.
- **Once by id.** `PATCH` accepts `ifNotOverlay: "<id>"` beside an overlay with that id: it lands only while that id is not already running, so two GM pages firing the same command show it once and the clock does not restart. A layer set to what it already is (or cleared when it is not set) writes nothing and does not move `seq`. The GM page's `show(kind, payload, { ms, key })` makes the id from a hash of `key` (a cue, a beat of the run sheet); with no key each call is its own show. `layer(path, value)` and `clearShow({ layers })` complete the three commands (`B68GmPage.show / layer / clearShow`, through `patchAmbient`, so the gate runs).
- **The data channel to HTML scenes is postMessage, not the query string.** A scene is an iframe at a fixed, cached URL; changing the URL for a countdown or the credits would reload it. The display posts `{ type: 'b68:data', phase, security, onair, filter, layout, mode, countdown { to (the iPad's own clock), label } | null, faces [{ name, role } | { pcId }], credits [{ name, role }], previously [{ name, role }] }` to the frames when a scene loads, when it posts `b68:ready`, and whenever a layer changes. Names and roles of revealed NPCs only: no id, spec or note.
- **On the display.** Beats are full-frame nodes in `.dp-overlay` built by `B68Shows` (kind -> `{ label, fixture, clean, render }`; a kind may name a `bundle` to load first); `Pure.cleanOverlay` accepts a registered kind and runs the kind's own `clean` on the served payload. Layers set `data-band-*` / `data-scene-*` on the display root, draw a slim status strip, and the flashback look is CSS on the ambient floor. New work draws from `app/tokens.css` (paper, ink, orange, rules blue, six faction slots, a type scale in vmin for 1.5 m; `app/tokens.js` carries the same values).
- **The look book.** `app/lookbook.html` (GM only: it asks `/api/me` and draws nothing for anyone else; not linked) shows a 1024 x 768 frame per registered kind with its fixture, and one for the layers. A later bundle that adds a kind registers it with `B68Shows` (with its `fixture`) and lists its renderer file in the `lookbook` bundle in `app/routes.js`.
- Checks: `checks/runtime/show-contract.test.mjs` (the handlers on in-memory D1: every kind and layer, the joins, the write-time drops and the read-time re-join, expiry, once-by-id, statement counts), `show-client.test.mjs` (registry, renderers, layers and the channel, the GM commands and the gate, tokens parity), `show-contract.e2e.mjs` (every kind on the GM display and the iPad sign-in within a poll, a hidden NPC, the layers to a scene frame, the look book; port 9050).

### The iPad: the tray, the iPad view and the band (the night rebuild, N5: `app/gm/ipad-tray.js`, `app/display/layers.js`, `app/display/shows.css`)

- **One way on, one way off.** Every tool's iPad button reads **Show on iPad**; a tool showing something it put up offers **Take it down** beside it. Rooms are staged, then sent.
- **The tray** (the top bar, at every width; `B68GmIpadTray.create(host).mount(el)`): what is live on the iPad in one line (a tap opens the iPad view), **Send (n)** while rooms are staged, **Clear** (`0`), **Blank** and the autopilot pill. **Clear** takes everything down to the ambient scene through each tool's own take-down (the report card, a held face, the flashback, the montage, the hard start, the overlay, then the stage); the band's phase, the PC faces and security stay, and so do the ambient mode and the score scene. **Blank** is true black until the next send. On a phone the tray is the live dot and Clear.
- **The iPad view (`I`)**: what is live across the top (the overlay with its own Take it down, what else is up, the autopilot), then **Listening**, the **Scenes** (the ambient mode and scenes, the score scene, the handouts) and the **Settings** (see Everything on, the Settings and the GM seams). It has no Clear or Lights out of its own: those are the tray's.
- **The band on the iPad** is one strip across the top with a fixed slot per lasting layer (ON AIR or the countdown, the phase, the crew, security), so no combination overlaps, at 1024 x 768 or stood up; lights out leaves only the lamp. The band beside the map sits under it and is cut to fit (the ways, the rooms, a smaller clock, then the clock's label). While an overlay is up, the words of the band beside the map stand down under it; a side card (a held face, a clock, a line) takes the band's column under its clock in landscape and the band along the foot in portrait, and a card taller than that room is drawn whole and smaller.
- **The look book** has two band cards: everything on, and the hard start's faces.
- Checks: `gm-ipad-tray.test.mjs`, `gm-page.test.mjs` (the iPad panel tests), `ipad-band.e2e.mjs` (every layer at four iPad sizes, a held face, lights out; port 8655; `BAND_SHOTS=<dir>` keeps its pictures).

### The Aftermath show (suite 1.6, switch `spine.aftermath`: `app/gm/aftermath.js`, `app/display/aftermath.js` + `.css`, `functions/_lib/show-aftermath.js`, `app/sheet/commend.js`)

The Run Sheet's Aftermath as a stepped show: payout, tithe, heat, status, harm, unwind, xp, credits. Off by default; with it off the Menu has no entry and a phone makes no extra call.
- **Steering.** Menu -> Aftermath show opens a panel (Next, Back, Skip, End now). Start sets `band.phase after` and `scene.mode aftermath`; each step is its own overlay (`aftermath { step, n, stacks, tithe, kept, exposure, mods, heat, after, siren, wanted, lines[<=6 x 80], who, line, secs }`, or `credits { npcIds [<=30] }`). A step held past 150 s is sent again before the 180 s beat ends; the xp step is not. The time boxes add up to 10:45 (the Run Sheet allows 12:00).
- **Numbers and words.** The GM confirms every number in the panel, beside the matching entry of the rules part (the `B68Rules` corpus, read at runtime); nothing from a rulebook is in the repo. The only constants are the Run Sheet card's: heat choices 0, 2, 4, 6 and the siren at 9 (then the wanted level goes up one).
- **Secrecy.** `credits` is joined to revealed NPCs only, like the rolodex; every line is scanned for hidden names, lists included (the GM page's `B68Show.texts` and the Worker's `showTexts` both walk arrays). The credits are the revealed NPCs first seen tonight, on stage now, or ticked by hand.
- **Phones.** Step 7 writes a public `commend` row to the docs store (`{ v: 1, secs: 90, until }`, no text) and deletes it on the way out. A phone with the switch on loads `sheet/commend.js` (a lazy bundle), reads that one kind (live poke plus a 20 s poll) and, while the row stands and its own clock agrees, puts "Did you earn xp tonight?" at the top of the sheet's **Now card** (`sheet/now.js`, the night rebuild: one card for whatever is due, in the order commendations, the Debrief, the absent packet, a key that can be turned, the mission card; the rest behind "+n more"; the opportunity board, a read packet and an answered Debrief wait in the "Between sessions" fold at the sheet's end) with a countdown; its button opens the sheet's own End of session panel, where the player ticks the triggers.
- **The Debrief.** A step skipped or not reached is filed in `night.aftermath.data.pending` ("status,harm") for 1.7.
- Checks: `checks/runtime/gm-aftermath.test.mjs`, `aftermath-secrecy.test.mjs`, `aftermath.e2e.mjs` (`npm run check:aftermath`).

### The players' mission (`app/gm/mission-publish.js`, `B68GmMission`; the wiring in `gm-page.js` is the block "the players' mission")

What a v2 night shows the players: the iPad's band (`mission.hud`) and one card per PC (`mission.cards`, read by phones from the campaign document). The page publishes it; the server cleans it again (`cleanMission`, functions/_lib/campaign.js) and refuses a hidden name (422).
- **Where to read it.** `buildMission` (the blind builder: `ball.playerView`, then `ball.missionFor`, at `ball.t`), `screenMission` (every string against the deny list; fails closed) and `publishMission` (inside `create`: build, compare with the last one sent, screen, send) are all in `mission-publish.js`. `PATCH { mission }` goes out through `api.publishMission` (boot.js, `campRef.update`); the adapter replaces a mission whole (a deep merge would keep a card the page dropped).
- **What triggers it.** A change to the ball (`ballSet`: `t`, `crew`, `heard`, `steps`, `told`, `open`, items, blown, busy ...), the table's alarm clock (`noteClocks`: its fill or visibility) or the filed characters, **800 ms** after the last one. The mission is rebuilt and compared with the last one sent; the same mission is not sent again (a floor tab, a lens). It publishes only a **v2 play block with a v2 ball** (`ball.v === 2`, with a time). A v1 night is Run the site as it was.
- **The time is `ball.t`.** A peek (the slider while it moves, `S.runT`) is page-local: it never writes the ball and never publishes.
- **The filed PCs.** A card for each PC that is in `ball.crew` (on the job) and is a filed character (`api.characters()`, with `owner`), keyed by its document id; the phone matches it to the signed-in player by `owner`. At most 8 cards (the server's cap).
- **The alarm.** `state.alarm` is built from the table clock named by `play.alarm.clock` (its filled segments; `visible: false` when that clock is hidden, so no alarm is on the players' screens).
- **The screen.** Deny list: the map's hidden names (`tokenHidden`: hidden rooms, threats, the watcher), the hidden NPCs and clocks (`hiddenSecretNames`) and `play.secret`. The people's and costumes' labels are not on it (a card names its own costume). A hit sends nothing and says which name and where. A hidden **NPC** gets a notice with **Reveal <name> and send** (asks, writes `revealed: true` to the cast document, publishes again); a hidden clock, a secret word or a room the players cannot see gets a toast. A PC standing in a room the players cannot see is not a refusal: the card's `room` (and the room at the end of a told window's time) is blanked until the room is opened.
- **In the Run view** (the block marked VV6 in `gm-page.js`): the Players chip (`setPlayersChip`), **End the night** in Run's menu, a **Players** view, and `runPublish`, which calls `landed(from, to, 'next')` only for a beat forward (Back, jump, start and a peek never do).
- **Hooks** (`B68GmPage.mission()`, or `missionHooks()` inside the page; null before the page is ready): `onPublished(fn) -> off` (fn gets `{ ok, ended?, time, at, seq, refused?, error? }`), `status()` (`{ ok, time, at, seq, text }`, text is `Players: HH:MM ✓`), `last()`, `publishNow()`, `endNight()` (asks; `PATCH { mission: null }`; publishing stays off until the ball's `start` changes), `landed(from, to, how)` (an 8 s text overlay of a public event's `pub`, at most 120 characters, through `showOverlay` and the gate, only for `how === 'next'` going forward onto the event) and `renderPlayersView(el, mission?)` (the band and each card from the last published mission, text only).
- Checks: `checks/runtime/gm-mission.test.mjs` (the module), `gm-page.test.mjs` section VV6 (the page), `gm-mission.e2e.mjs` (the real Run view: the chip, Next and Back, a peek, the Players view, the overlay, End the night), `gm-nosecrets.test.mjs` section (o) (no GM-ONLY marker reaches a PATCH body; a marker in a player-safe field is stopped), `adapter.test.mjs` (a mission replaces whole).

### Autopilot (`app/gm/autopilot.js`, the driver in `gm-page.js`; design 6)

Blade directs the iPad with overlays until the GM takes over. **On by default.** `B68GmAutopilot.create({ now, idPrefix })` is a pure state machine (`event(e)`, `tick(now)`, `state()`, `note(entry)`): no DOM, no timers, no clock of its own. It answers an event with at most one action, `{ do: 'set', overlay }` or `{ do: 'clear', id }`; the page carries it out as a quiet `PATCH /api/gm/ambient` (no toast on a refusal; every overlay it sends is `auto: true` and rides with `auto: true`, so the AUTO chip comes with the first one). The overlay holds an id only (`clockId` or `npcId`): the server names a clock and joins an NPC's card, and refuses a hidden one.
- **Events the page feeds it.** A table clock made visible or whose fill moved (from `campaign(doc)`; the first look is the baseline, a reveal of a hidden clock is the GM's own act and not a trigger, more than three at once is a resync; settled for a second so the save has landed before the server reads the fill). Voice's lines for the NPC on stage (the page's own stage decides who; Voice's `who` is model text and is never looked up) when that NPC is revealed and has a portrait. The GM's pushes (`pushDisplay`'s success and another page's `b68:display`): npc, handout, rule and lights out clear what is showing; lights out and a rules entry are guards until the next push; a handout holds it back 30 s, a map push (live reveal) 15 s. The false dawn (`runDawn`), the page being hidden or shown, Take over, Hand back, Switch off and on. A subject that is no longer one the players may see (a clock hidden or removed, an NPC no longer revealed) clears its overlay at once.
- **Durations.** A clock 8 s; each further change in that time is a NEW overlay (the display shows an id once) with 8 s from now, up to 20 s in all. An NPC while they are on the transcript plus 20 s, at least 10 s, at most 3 minutes (one overlay with a 3-minute backstop, which the autopilot clears itself). Time's up clears the overlay it set, then a 15 s cooldown. At most one waits per kind (the newest wins), a waiter older than 60 s is dropped, and priority is dawn, then NPC, then clock. Nothing preempts what is showing. The dawn is the GM's: it goes even on Hold, the autopilot lays nothing over it, and it never clears it (it reads the document again before every clear and only clears the id it set).
- **Take over / Hand back.** The Auto / GM badge in the top bar (its tooltip is the action; hidden on a phone), the Blade panel's header button and the iPad tab's Autopilot line (with Switch off / on) all call the same function. Take over clears what it put up, writes `auto: false` and holds (nothing queues on Hold); Hand back writes `auto: true`. Hold and Off are remembered on this device for 12 h across a reload. A toast, once per page load, on the first overlay it sends. Closing the page takes down its own overlay and the chip. `0` still clears the iPad to ambient.
- **`ap.log`.** The GM state keeps the last 20 autopilot lines (`ap.log`: `{ at, do, kind, key, why }`, ids and words only, never a name) for `gm:after`.
- **Secrecy, as tested requirements.** A clock overlay carries a clock id and the server refuses a hidden or missing one; overlay ids are opaque; an NPC overlay is joined at read time and dropped when the NPC is not revealed; nothing autopilot-driven lights a blacked-out screen (the controller holds it, the server refuses it with 409, the display never draws it); a text overlay naming a hidden clock or NPC is refused by the gate. Never shown: a hidden clock, a hidden NPC, anything from the prep, any model-written text, a handout (a handout cue only offers an idea card in the panel).
- Checks: `checks/runtime/gm-autopilot.test.mjs` (every transition and guard on a fake clock), `checks/runtime/gm-autopilot.e2e.mjs` (a clock tick shows and goes, the cooldown, extension, Take over from the panel and Hand back from the bar, the dawn kept, hidden clock and NPC, the display-only NPC card, lights out, and the display-only sign-in's expiry of a 1.5 s overlay).

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

## Run the job (v2: `app/gm/run-view.js`, `app/gm/ball.js`, `app/gm/mission-publish.js`)

The Run tab (key **G**) runs a v2 play block (`play.v === 2`) on an authored site. A v1 site keeps Location's Run the site strip (see below).

**The tab.**
- **Start the night.** Pick the engagement result (Crit, 6, 4/5 or 1-3, from `play.clock.starts`). That sets `ball.start` and `ball.t`. Nothing publishes before the night starts.
- **The countdown** (switch `map.countdown`). A play may name a countdown, `clock.countdown: { at: "HH:MM", label }`, after the start and inside the clock. The header then shows it beside the alarm as a pie and `label n/N`: N is the beats from the clock's start to `at`, n the beats gone, so each beat forward is a tick and a later engagement start begins part-filled. Full at `at`, and it stays full. GM only: no player view carries it.
- **The beat.** A beat is `play.clock.beat` minutes (5 to 60, default 15). Left and Right step one beat back or forward (never before the start, never past the last beat). Shift+Right jumps to the next thing that happens: an event, a stop, a route window or a way window. Esc closes a peek.
- **The timer.** A countdown per beat sits in the Run header once the night has started (never before Start the night), and it starts paused (`ball.timer`). Its length is `play.clock.real` minutes when the play has it, else 6 minutes (a GM default); the box beside it sets another (1 to 120 minutes). **Start**/**Pause**, **+1 min**, **+5 min** and **Reset** (back to the full length, paused) drive it. At zero, running and not peeking, it steps one beat the normal way (it publishes like Next) and restarts; on the last beat it stops. A manual step or jump restarts it too, running or paused as it was. The iPad band shows it big where the clock goes (amber under a minute, red at zero, Paused), corrected for the iPad's clock; phones show a small line under NOW.
- **Peek.** Tapping a square on the beat track previews that time in a dashed frame, on this page only, with **Back to now** (or Esc). It never writes `ball.t` and never publishes.
- **The board.** Room cards grouped by floor. Tap a room to select it: its PCs, NPCs, routes and marks. To move a PC, tap the PC, then the room, or drag the PC's chip onto the room (`ball.crew`). "Noticed" clears when the room changes.
- **Views.** Board, Map (the site's map with the fog) and Players (the mission as last published).
- **This beat.** The beat's buttons, including the alarm buttons (below).
- **The crew.** The PCs on the job, each with its position (controlled, risky or desperate) and the reason.
- **The job.** Heard by buttons per way and PC; a press records the time the PC heard (`ball.heard`).
- **Intel.** Tell and Tell the crew record what the crew has been told (`ball.told`).
- **The pacing line** shows where the night sits against its clock.

**Publishing.** Any change to the ball, the alarm clock or the filed PCs publishes 800 ms later, at `ball.t` and nothing else. The mission is built blind (`playerView`, then `missionFor`), screened against hidden names and secret words, and sent as `PATCH { mission }`. The header chip reads **Players: HH:MM ✓** after a publish lands. A screen hit sends nothing and says where: a hidden NPC offers **Reveal <name> and send** (it asks first); other hits show a toast. Next onto a public event puts that event's text on the iPad for 8 s. Back, jumps, start and peeks never do. The server cleans the mission again, refuses a hidden name (422) and refuses a player's write (403).

**End the night.** Run's menu → **End the night** (it asks). That sends `PATCH { mission: null }`, clearing the players' mission. Publishing stays off until the night's start changes.

**Reset the night.** Once the night has started, a quiet **Reset the night** button sits in the Run header, after the Players chip and away from the beat buttons (not on the iPad or the phones). It asks first. On a yes it clears the players' mission (`PATCH { mission: null }`, so the band and every card go), then takes the ball back to unstarted: only `site`, `floor` and `open` stay, and the clock, crew, heard, steps, ways, told, delays and alarm keys go. Start the night is offered again, and picking the same result a second time publishes again (unlike End the night). The table clocks, the map's open rooms, the Location card and the NPC cast are not touched. If the mission write fails it says so and the ball still resets (press End the night to try again); if the ball write fails nothing else changes. Use it to rehearse a night from different starts, or when the wrong engagement result was picked.

**What reaches whom.**

| Who | Sees |
|---|---|
| The GM page | Everything. |
| The iPad (the band beside the map, its own poll part `?hseq=N`) | The time, now, next, the night's squares, the alarm's player label and line, the crew's costumes, and the target's marker on the map while he is in view in an open room. Never the cards. |
| Each phone | Its own PC's card only. The campaign document holds every card and each phone renders only its owner's. Soft privacy, by design. |

GM-only: every event label, a way's name, people other than the target and the watcher who sees through your costume, notes, wary lines, steps past the next, and secret words.

**The v1 fallback.** A v1 play keeps Location's **Run the site** strip unchanged. If the Run view misbehaves, Location (B) still has the map, the fog and **Show on iPad**.

**Gaps.**
- **Alarm buttons.** Each threshold in `play.alarm.at` shows a button once the alarm clock's fill reaches it, and stays until acted on. Skip the next private stop is disabled when the target has no private stop left.
- **Skip the next private stop.** Drops the target's next future private stop from his route (stored as a skip in `ball.over`). Never a public stop.
- **Lockdown.** Holds the target in the room named by `play.alarm.lockdown.room`, or in the room he is in when none is named. A toast says so if he is nowhere to hold.
- **Running late.** +15 or +30 adds that many minutes to the target's stops from now on. Clear removes it.

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
- **Claude suggests.** `B68GmPage.suggestHandout(id, why)` puts *Show handout: <title>?* in the box as an idea card (with the reason, **Show** and **Dismiss**);
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
   **Names reset with the session:** a PATCH that sets a `session` different from the stored one starts **Who is who** empty (Deepgram numbers speakers per connection); names sent in the same PATCH stay.
   **Clear names** in the fold resets them mid-session (after a reconnect), and the lines list shows only the current session's newest 5 lines (a shut **More** fold holds the 25 before).
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

## Everything on, the Settings and the GM seams (suite W0.2, W0.5; the night rebuild N0: `app/features.js`, `app/gm/settings.js`, `app/sheet/flags.js`, `app/gm/tools.js`, `app/gm/workshop.js`, `app/cue-verbs.js`)

Every feature the suite built is on, always. The Switchboard and the Workshop drawer are gone (N0). The choices that are modes rather than features are **settings**: three at first, seventeen rows now (the list is under "The Settings, in the iPad view" below).

- **The registry is `app/features.js`.** A line is `{ id, label, surface, stage, default: false, doc, saturday, setting?, legacy? }`; `surface` is `gm`, `display` or `phone`. `valueOf(doc, id)` is `true` for every line that is not a setting, whatever a document holds; a setting (`setting: true`: `phoneCards`, `fx.off`, `room.music` at first, and every row added since) reads its stored value. `phoneCards` keeps its old top-level key in the GM state as a fallback. `saturday` is the old plan's wish for the first night: history only, nothing reads it.
- **Where the values live.** The GM state document's `features` (`{ id: bool }`) holds the settings (and still holds any switch the Switchboard wrote: those values are left exactly as they are, unread, so a rollback to the build with the Switchboard finds them as they were). The GM page copies the display and phone settings into the campaign document's `features` (`publishMap`, settings only). Only the GM can write that key (a player's PATCH is 403); a PATCH is cleaned against the registry (a GM-only or unknown id, or a value that is not a boolean, is dropped); a whole-document PUT keeps what is stored.
- **What a phone and the iPad are told** is made on every read by the Worker, through the registry (`functions/_lib/features.js`, `Features.publicView`): every display and phone line ON, a setting as stored, never a GM-only id. The campaign GET (for everyone, the GM's own devices too) and the campaign write answers carry it as `features`; the iPad gets it as a top-level `features` in every display poll that sends `hseq` (the same statement as the mission part, no extra D1 call). So the first request after a deploy sees every feature on, whether or not the GM page has been opened. A feature asks `B68Flags.on(id)`, or `B68Flags.subscribe`s and redraws. No reload.
- **The Settings, in the iPad view** (`app/gm/settings.js`, drawn into the iPad view's Settings section, `ctl.render(box)`; N0 kept them in a Menu sheet until the night rebuild's N5 moved them, and the Menu has no Settings line now): **Scenes** moving / held still (`fx.off`), **Music** scene themes / heat music (`room.music`), **Phones** sheet only / mission cards (`phoneCards`), **Mirror for phones** off / on (the GM state's `mirror`), **Band** off / on (`display.band`), **Players' screen** classic / map first (`stage.players`), then the five kit rows **Desk**, **Stage**, **Phone sheet**, **Start the night** and **Pitches** (`kit.desk`, `kit.stage`, `kit.phone`, `night.who`, `blade.pitches`: see "The kit and stage: five settings" below), then **Map fills the screen**, **People on the map**, **Room lights**, **Cut to the room** (`map.fill`, `map.people`, `map.lights`, `map.room`), **Handouts on phones** (`phone.handouts`) and **Furniture depth** flat / solid (`map.shade`): see "The map, the players' screen and handouts: seven more settings" below. Seventeen rows in all. A change takes effect at once: the GM state, then the campaign copy, then the page's redraw (phone cards also republish the mission). `heal()` runs on each campaign arrival and rewrites the campaign copy of the settings only when it differs from the GM state's.
- **Where the Workshop's five went.** Phone mission cards and the screen mirror: Settings (the bar's and the iPad tab's mirror buttons and the Run menu's Phone cards line stay put away). The costume engine (the Run strip's Disguise select) stays put away until it has a toggle of its own. The uncued co-GM box and the Screen props show in the Blade panel, as before the Workshop. `app/gm/workshop.js` is now only the right-edge sheet the Menu's tools open in (`sheet(root, id, title)`).
- **The tool registry (`app/gm/tools.js`, `B68GmTools`).** Every tab is a tool `{ id, label, key, phases, workshop }`; the phases are `pb`, `plan`, `score`, `after` (the ids `night.phase` stores). `setFilter({ on, phase, all })` is what the phase rail drives; off, or `all`, shows every tab. The tab on screen is always kept. A tool registered with a `mount(box, host)` gets a tab and a pane. (`workshop: true` is a leftover: nothing registers one now.)
- **The cue-verb registry (`app/cue-verbs.js`, `B68CueVerbs`).** A new spoken command registers `{ id, words, actionTypes, parse(ctx) }`; `cue.js` asks it for any command word it does not know. Every declared action type must also be in `hands.js` `CUE_TYPES`, or the Worker drops it (`checks/runtime/gm-cue-verbs.test.mjs` holds each verb to that).

Checks: `checks/runtime/features.test.mjs`, `gm-tools.test.mjs`, `gm-cue-verbs.test.mjs`, `checks/api/features.mjs` (port 8951) and `checks/runtime/gm-seams.e2e.mjs` (port 8952; `--snapshot <dir>` records the page's markup and screenshots at 1280 and 390 px, to compare with another tree).

## The demo night (`npm run demo:night`: `scripts/demo-night.mjs`, `scripts/demo-night-shots.mjs`)

A local Worker holding one complete, invented night, for looking at the app and for design checks: every pack part the GM page reads (the Pelican Rooms as an authored v2 site drawn with map kit 1, a prep note with start, curfew, a run order through the four phases, the place sections, a `## Rooms` section, eight cues and a security line), the fixture rules, the Dovetail Crew and its three PCs (one per player), the invented cast (revealed and hidden), table and world clocks, the Run view's night started, and docs rows (a front page, opportunity posts, a debrief, a quiet-line message, an absent packet). It runs as the e2e checks do: migrations into a state folder, `wrangler dev` on loopback with `DEV_USER`, no model.

- `npm run demo:night` boots on port 8890 with a fresh temp state and prints the URLs (the GM page, the display, the look book, the cast, and a player's sheet: the dev Worker honours `X-Dev-User` on loopback). `-- --port <n>` another port; `-- --state <dir>` keeps the state between runs (`--reseed` seeds it again).
- `-- --shots <dir>` seeds, takes the screenshots listed in `scripts/demo-night-shots.mjs` (Playwright: `PW_MODULE`, and `PW_CHANNEL=msedge` on Windows) and exits; `--only <name,...>` takes some. Each scenario is `{ name, size, route, as, setup, ready, steps }`; add yours there.

## The stamp, the sizer and the strict cue grammar (suite B09: `app/gm/stamp.js`, `app/gm/cue-grammar.js`; switches `spine.stamp`, `spine.sizer`, `ai.grammar`, all off by default)

- **Stamp (`spine.stamp`).** A Stamp row under Position: tap a position, then an effect (the second tap stamps), with a one-line consequence in the box. The `report` card goes up on the iPad (laid again every 170 s, because the server holds a beat for three minutes) until a 4/5 or a 1-3 is marked, Clean, or Esc; Esc only takes down the stamp's own overlay and never touches a layer. The stamp is logged to `night.log`. Nothing goes to a phone.
- **Sizer (`spine.sizer`).** Marking a 4/5 or a 1-3 on a stamped roll offers the consequence at full size for the stamped position: the size is the console's own Position table from the pack, and the lines are the room's `If it goes wrong` lines in the prep note's `## Rooms` section (a bullet or paragraph beginning `If it goes wrong`, or a bare label with bullets under it). "This room" is the room most of the crew are in. Reduce arms on the first tap and reduces one position on the second (within six seconds); Restore puts the full size back.
- **Cue grammar (`ai.grammar`).** Registers stamp (`Blade, risky, standard, the guard turns`), reveal, go (`go to planning`), flashback, back, introduce, spotlight, all as one cue action type `cue_do` (`functions/_lib/assist/hands.js` CUE_DO_VERBS). Every fired cue shows a five-second toast with Undo; a cue that does not parse shows "Didn't catch that" and does nothing. Verbs exist only while the switch is on (`enabled` in `app/cue-verbs.js`; `phrases` lets a verb take a built-in word such as "reveal"). Introduce and spotlight refuse a hidden NPC; reveal is the GM's own way to change that. "Off the record" and "back on" are A6's (ON AIR), not cue verbs. "Name them" is not built: the plan does not say what it does.

## The cue stack (suite 4.1, switch `room.cues`: `app/gm/cue-stack.js`; off by default)

- **Writing cues.** A prep note's own `## Cues` section (outside code fences and outside a transcluded section; the prep part already carries the note's Markdown). One numbered line per cue, one kind each: `1. scene: <ambient scene id>`, `2. show: title: <text> | <sub>` (also `ring`, `spotted`, `stamp`), `3. sound: <text>`, `4. reveal: <NPC name>`, `5. phase: pb|plan|score|after`, `6. light: <text>`, `7. practical: <text>`. An optional `safe: <scene id>` line names the scene Esc sends the iPad to (default `testcard`). A line that is not a cue is ignored.
- **Running them.** The band's second row shows the next cue as STANDBY (its ⋯ holds Back, Start again, what comes next and the last cue fired). **Space** (with the focus on the page, not on another control), **PageDown** (a Bluetooth page-turner) or the GO button fires it; **Bypass** skips it without firing; **Back** puts the last one in standby again (it undoes nothing on the iPad); **Start again** clears the stack. One 500 ms lock is shared by GO, Bypass and Back, whichever way they arrive, so two GOs inside 500 ms fire once. A cue fires only when the GM presses GO or says "Blade, go"; nothing fires on a phone, and Blade the model never fires one (the spoken verb is parsed by the page and sent as a parsed `cue_do` verb `fire`; the model's own lane has no `cue_do`).
- **By hand.** `light`, `sound` and `practical` cues have no channel in the app: GO shows and logs them and moves on. The room's lamps and any practical sound are the GM's.
- **"Blade, go."** Fires only the cue in standby. With nothing in standby it does nothing but say so. `go planning` (and the other phases) is still the cue grammar's, while `ai.grammar` is on.
- **PANIC (the band's last button, or Esc).** The button, or an Esc with nothing open, no field and no stamp up (Esc closes those first, one per press: see Keys), clears every beat, layer and spotlight on the iPad and pins the safe scene (which plays no music, so the theme stops with its scene), all in parallel, with or without cues in the note; the band's second row turns red with WORK LIGHT UP. GO is refused until **Resume**, which puts the previous scene back. The position and the panic live in the GM state document (`cues`), so a reload or a second GM page follows.
- **Tests.** `npm run check:cue-stack` (unit, in `check:runtime`) and `npm run check:cue-stack-e2e` (port 9040).
- **`music:` cues (M1).** `7. music: action` (also `tension`, `calm` or `hanging around`, `auto`, `off`): GO sets the laptop's music exactly as a tap on that mood in the band's music popover would (a mood holds until Auto; `off` fades it out). See "The music" below.

## The music (M1: `app/gm/music.js`; the laptop's playlists that Blade cuts between)

The room's music plays from the **GM laptop** to the speaker chosen here (the Bluetooth speaker), never from the iPad (the iPad cannot set a volume, needs a tap first, and its Bluetooth is busy with the mic). The iPad keeps its own sound (`theme.mp3` under the Opening credits, `app/display/room-audio.js`); the iPad view's Settings row "Music" is about that sound only.

- **The library: Before › The room › Music** (also in Find). At the top, the same playback controls as the band's popover (▶/❚❚, Next track, the moods, Auto, Stop, the volume, what is playing): the way in whenever the band's pill is hidden. Three playlists: **Hanging around** (`calm`), **Tension** and **Action**. **Add tracks** opens a picker for many files at once (mp3, m4a, aac, ogg, wav, flac); dropping files on a playlist adds them too (a file dropped anywhere else in the tool is caught, never opened by the tab). Each track is kept in IndexedDB `b68-gm-music` **in this browser on this laptop only**: never uploaded, never in the pack, never precached, never in git. Each playlist shows `n tracks · m min`; × removes one; **Clear** asks first. The page asks the browser once to keep the files (`navigator.storage.persist()`) and shows the storage used. Keep the originals: a browser that clears its site data clears them too.
- **The output.** "This laptop's default output", then the named outputs (pair the speaker first; Find speakers lists them again). **Test** plays 3 s on it (the first track, or a soft chord). The choices live in localStorage `b68.gm.music` = `{ sink, vol, auto, mood }`.
- **The band.** A pill beside the mic in row 2: `♪ Tension`, an **A** while on Auto, ▶ while playing or ❚❚ while paused. A tap opens its popover (Esc closes it, priority 70; so does a tap on a mood, Auto or Stop, since an open popover holds the page's keys): **▶ Play / ❚❚ Pause**, **Next track**, the one segmented control **Hanging around · Tension · Action · Auto · Stop**, the volume (default 60), what is playing, and **Library…**. Hidden under 1100 px (a tablet or a phone is not the player) and while the curfew is due (row 2 needs the room for Call the Aftermath); the music plays on, and the Music tool (The room, Find) has every control.
- **It never starts by itself.** The first Play is a GM tap (▶, a mood, Auto, or GO on a `music:` cue). After a reload it waits, paused, until one.
- **The player.** Two `<audio>` elements on the chosen output, crossfaded. Each playlist is a shuffle bag (no repeats until all have played; never the same track twice running). A track's end goes to the next of the same mood (2 s crossfade); a mood change crossfades in 4 s. An empty playlist falls back (Action → Tension → Hanging around; Tension → Hanging around → Action; Hanging around → Tension → Action); with no tracks at all it is silent and the pill says where to add them.
- **Auto: when Blade cuts** (`moodOf`, every rule unit-tested with a fake clock):
  - the Score is **Tension**; any other phase, or none, is **Hanging around**;
  - **Action**, in the Score only, while the site's ONE alarm is at its top two levels or a chase runs, and when the alarm gains a tick (Spotted) or a Desperate 1–3 is marked; it holds 90 s after the last of these, then back to Tension;
  - a site alarm the GM keeps **hidden** from the players is never a trigger (the room would hear what the GM hid);
  - stepping up is at once; stepping down waits until 60 s after the last cut (no flapping);
  - while another page is open over the GM page (Rules, the cast, the table, Home), the music keeps the night it last read: the work light stays up for it, and the Score does not step down;
  - a tapped mood holds until **Auto** is tapped; the night is still followed underneath, so Auto takes over at once. **Stop** fades out.
- **PANIC** fades the music to silence in 1 s while the work light is up (the tracks keep their place); **Resume** brings it back. While the **Opening credits** run on the iPad (they play the theme), the laptop music fades down; it comes back by itself after their 90 s even if they stay pinned on the title card, and at once on Clear, anything shown on the iPad, a place tapped on the band, or **Bring the music back** in the music popover (the pill reads `Quiet: credits` meanwhile). Pinning them again ducks again. Only a pin the page sees arrive ducks: a GM page loaded or reloaded while the credits are already pinned plays its music.
- **Not built (M1):** the dip for "Blade" (the GM page reads the transcript only on the cue lane's poll, seconds late) and the voice verb "Blade, music action". Both are on the list for after the first night.
- **Tests.** `checks/runtime/music.test.mjs` (in `check:runtime`) and `checks/runtime/music.e2e.mjs` (its own demo night, port 8601; in `check:e2e-all`): `npm run check:music` runs both.

## The Shortcuts card (K1: `app/gm/shortcuts.js`)

One card, GM laptop only, for a glance at the table: the keys, the "Blade, …" lines (said with Listening and Co-GM on, or typed in the Blade panel's Ask box, which works with Co-GM off), the clocks, the music, the prep note's cue lines, and Esc and PANIC. It opens in the right-edge sheet (`B68GmWorkshop.sheet(root, 'shortcuts', …)`, nearly the laptop's width, four stacks of sections; two under 1250 px, one on a phone): **`?`** (Shift+/; `keyAction` type `shortcuts`, never while typing, never behind an open box; `?` again shuts it), **Find** ("Shortcuts", "keys", "commands", "help") and the **Menu**'s Shortcuts line. Esc shuts it through the sheet's own `B68GmEsc` entry; nothing is stored or sent.

- **The card is one array** (`SECTIONS`): the renderer draws it and `checks/runtime/gm-shortcuts.test.mjs` (in `check:runtime`) holds every row to the code. Every "Blade, …" example and typed `/command` goes through `app/cue.js` with the verbs the page registers (the strict grammar, then the cue stack's "go"), comes out as the verb the card says, and passes the Worker's `validateActions` as a parsed cue; "off the record" and "back on" are the iPad's own (`B68OnAir.detect`) and the cue lane does nothing with them. Every cue line parses under `## Cues` as its kind. Every key on the card is one the key handler handles, and every key `keyAction` handles is on the card. The lines it says do not work do not: **"Blade, music …" has no verb today**, so the card says to tap the pill or use a `music:` cue line; when a music verb lands that test fails until the card gets the line. A new verb, key or cue kind means a row here.
- **E2E.** `checks/runtime/gm-shortcuts.e2e.mjs` (its own demo night, port 8765; in `check:e2e-all`): `?` opens it at 1366 and 1536 with nothing overflowing or clipped, the page's keys wait behind it, `?` and Esc shut it (no PANIC), Find and the Menu open it, a `?` typed in a field or behind the drawer, the Menu or Find is theirs, the phone's Menu opens it full width, the iPad's page never has it.

## The kit and stage: five settings (the kit and stage build: `app/features.js`, `app/gm/settings.js`, `app/ui/`, `app/gm/kit/`, `app/display/kit/`, `app/sheet/kit/`)

The build changes how the app is made and how it reads, not what it does: one set of parts (`app/ui/`, see `app/README.md`), a calmer desk, the iPad as a stage, a four-screen sheet on a phone, a roster for the night and a Blade that pitches. It is **five settings, every one off until chosen**. It adds no migration, no Durable Object change and no change to the shape of a stored document: what it writes are new optional keys that the earlier code ignores (see "Rolling back").

| Setting | Settings row (the two choices) | What it turns on | Who follows, and when |
|---|---|---|---|
| `kit.desk` | **Desk**: Old desk / New desk | The GM page rebuilt from the kit: the band, the Roll, the Blade panel, the Run view and the shell (tabs, Menu, Find, drawer, capture bar, toasts, dialogs). Four views are put away. | This page, at once |
| `kit.stage` | **Stage**: Old iPad / New iPad | The iPad as a stage: no chrome over the art, the crew across the top, one plate for words, the roll in beats, clocks with names, the NPC over the dimmed scene, the map full-bleed. | The iPad, on its next poll (a few seconds) |
| `kit.phone` | **Phone sheet**: Old sheet / Four screens | On a phone the sheet is four screens, Now · Sheet · Crew · Notes, behind a bar at the foot. Wide screens and print are unchanged. | A phone, on its next campaign arrival |
| `night.who` | **Start the night**: Off / On | A Start the night button in Before that asks who is playing; the Roll, the iPad and the send-to lists follow the players who are there. | This page, at once |
| `blade.pitches` | **Pitches**: Stall and Meanwhile / Pitches | Blade pitches up to three ideas at a time, in place of the Stall and Meanwhile cards. | This page, at once (turning it off unhooks it without a reload) |

The five are independent: any one can be on with the others off. `night.who` and `blade.pitches` also work on the old desk (their parts carry their own scope, `data-ui-scope`).

### Turning a setting on

1. Open the GM page (`#gm`) on the laptop, signed in as the GM.
2. Press **`I`** (the iPad view; Find, `Ctrl+K`, also lists it under "settings"). The **Settings** section sits under Listening, beside the Scenes (one column under 1100 px), and the Players' screen row and then the five kit rows come after Band.
3. Tap the right-hand choice on a row (New desk, New iPad, Four screens, On, Pitches). A toast says what changed and the button reads pressed. The left-hand choice turns it off again.

That is the only place a setting is changed. **A change made in the laptop's own Settings is instant on that page; the iPad follows on its next poll and a phone on its next campaign arrival.** A change made on *another* device (a second GM page) reaches an open GM page only when its window regains focus or its tab becomes visible: **there is no GM-state poll**. So on a game night, flip settings from the laptop that is running the night.

To see everything on without touching a live night, run the demo night with all five on: `npm run demo:night -- --kit all` (or name them: `--kit desk,stage,phone,who,pitches`; `--kit none` writes all five off; leaving `--kit` out writes nothing). The look book (`app/lookbook.html`, GM only, opened by address) draws every part and every stage piece in both themes with no setting at all.

The desk, the stage and the phone sheet are painted by a flag on the page, `data-kit` on `<html>` (`app/ui/kit-flag.js`, `B68Kit`): `desk` on `#gm`, `stage` on `#display`, `phone` on a live sheet (`#c/<id>`). The attribute flips at once and the kit's own files arrive a moment after it (a failed fetch is asked again at most every 30 seconds). The browser remembers which tokens are on (localStorage `b68.kit`), so a reload paints them before the setting is read; with every setting off the key is never written. The first time a page paints a kit token its old stylesheets move into a cascade layer and **stay there until the page is reloaded**, even if the setting is turned off meanwhile (the same look), so a reload is the clean way back to the old desk.

### What "off" means

Off is the app as at Deploy 35: the same markup, the same styles, the same requests and the same stored data. With every setting off a page fetches what it always did **plus one file on every route, `ui/kit-flag.js`** (the one deliberate new request), and the iPad view's Settings show five more rows. No kit bundle is fetched and no `b68.kit` key is written. `checks/runtime/kit-off.e2e.mjs` holds this against a baseline taken from Deploy 35 (`app/README.md`, "The harness").

There is **one disclosed difference with every setting off**: the score scenes' crew polaroids. They used to be a fixed list in the public code; the list left the code (it named the crew), so a score scene now shows polaroids only for the list that Start the night (`night.who`) sends. With it off the scenes show none. The harness cannot see this (the polaroids are drawn inside the scene's frame).

### The new desk (`kit.desk`)

Every control the old desk has is still reachable (moved is fine, gone is not), and every `id`, `data-*` hook and old class name stays on the new markup, so the old handlers and checks still find them. The desk is Paper (the light theme) by default, even on a dark device, unless Night was chosen in the footer switch. Nothing on it is smaller than 12 px, bar the known misses under "The skin and trim".

- **The band** is two rows. Row 1, where you are: the mark, the session chip, the who chip (`N playing`, filled by `night.who`), the phase tabs (an underline; the place on screen is underlined, the night's phase has a dot), **Blade** (key `A`, with the count of cards waiting), the Listening chip, the curfew, the clock and **PANIC** (the one Danger on the page). Row 2, what is live: the iPad's state as one chip with **Clear** (`0`) inside it, **Send (n)** while rooms are staged, a quiet **Blank**, the autopilot, the beat, the music and the quiet line; then the cue unit (STANDBY and the cue, **GO**, a quiet **Next**, `⋯`); then Find, Crew and the Menu. **GO** is the band's one Primary (`Space` or `PgDn` as before). That Next is the cue stack's Bypass; the beat's own Next reads "Next beat".
- **Status** is one dot by the tools (the save state, signed out, the pack's warnings), with a word beside it when something is wrong and the full text as its tooltip. Signed out, a refused save and an old pack also raise a toast.
- **The Roll** is one card: Who (chips), Position and Effect (two full-width controls, with the size under Position), "If it goes wrong", and **STAMP** (the card's one Primary) with a quiet **Fit** beside it. The four *They rolled* keys are rows with the outcome's colour as the left edge. The Fixer's words, order and timing are untouched; its answer is one row per outcome with the lead in bold, the rest as points and the cost as a chip in the outcome's colour. While a stamp is up its one line (On the iPad, who, position and effect, Take it down) is pinned above the Blade fold. Voice and Another sit in the Rack as a card.
- **The Blade panel** has compact cards: the kind as one word and a colour edge, two lines at 14 px when folded, the whole card on a click or Enter. Every card has an **X**; a quiet **Clear all** dismisses the cards that have nothing to press and are not pinned or kept. An idea card fades out of *this page's* list after 90 seconds in view (it dims for the last 8; no mark is sent, so a reload brings it back), and never fades while pinned, kept, open, under the pointer, focused, an Ask answer, or holding something to press. The right-edge tab and the Now zone are hidden (the band's Blade button replaces the tab), the Ask box moves to the foot of the panel, and the Screen section (Make the prop, Wire, Case board) is put away (Draw them is still on an NPC card). A rule or Stop card that arrives while the panel is shut goes to the toast stack, with Open.
- **The Run view** has a one-line head (the site's title, the beat, the clocks as chips with meters, the Players chip, `⋯`), Board · Map · Players as tabs, the map tools quiet, and **Send (n)** in sight while rooms are staged. Rooms are rows by floor with a swatch for what the crew knows (dark, blueprint, seen; staged), one line of what is there and the PCs' heads. The right side is one inspector for the selected room; the other rooms a PC is in are "The crew is also in" buttons. **Who's here** lists the room's people with one visible action each (Spotlight, or On the iPad while held), and Introduce, Card and × are behind the row's `⋯`. The stage group's state line (LIVE, FROZEN, BLANK) and Freeze are in `⋯`, under "The map on the iPad".
- **The shell.** The view row is Tabs. The Menu is rebuilt from parts; Find, the drawer, the capture bar and the Focus button are dressed in place (the shell adds kit classes to the page's own nodes and records them, so turning the setting off takes each away). The Menu stays dark in Paper and in Night. Three confirms that are the last thing their handler does use the kit's Dialog: Clear tonight's capture, Remove a card (Opportunities) and Clear a beat's start time (Prep); Cancel is the default on the first two. The other confirms stay native.
- **Put away.** Four views leave the view row, and the chip row under 1100 px: **Chase, Street, Score generator and Opportunities**. They are not gone: `C`, `S`, `J` and `O`, and Find, still open them. One shows in the row (a dashed underline) only while it is the view on screen; opened in a place that does not list it, it is a "brought here" view with its `×`, as any other place's extra view is. A place's first visit opens its first view that is not put away (Planning opens on Intel).
- **The skin and trim.** Panes no other desk file rebuilt (Prep, Rules, Cast, Downtime, the iPad view, the Location roller, Settings, the Before and After places, the Between desks) keep their markup; `app/ui/desk-skin.css` alone changes how they look. Every rule in it is zero weight (`:where(:root[data-kit~="desk"]) :where(...)`), so a rebuilt pane or a part always wins over it: it is the kit's floor, and shows wherever nothing newer speaks. It sets: nothing under 12 px, and the desk's type steps (12, 14, 16); mono only for keys, times and code; flat shadows (an inset line or a ring stays); a calm hover (the sunk ground, never orange); and the three ranks on the old controls (**Standard** flat with a hairline, **Quiet** text until hover, and the old `.primary` as an ink fill, never orange: the orange Primary stays the rebuilt panes' own, STAMP and GO). A pressed old button that is not `.primary` (the Cast pane's "Off stage", for one) has its own on look: the sunk ground, an ink border and an orange underline. Half of the sheet is generated from the old sheets (`node checks/runtime/kit-skin.e2e.mjs --write` rewrites it, and the check fails if it goes stale); the other half is written by hand. **Known misses:** the front page's newspaper preview keeps two 11 px lines (its type is a style a script builds, a picture of a printed handout), and the drawer's Crew and Players sheets stay at about 8.5 px with their old shadows (they are separate documents in frames, which a desk sheet cannot reach; they need `kit.phone`'s CSS).

The acceptance numbers the harness measures on the demo night are: 25 or fewer boxed controls on the Run view at 1366 x 768, nothing under 12 px on the GM page, four or more Blade cards visible at once with the panel open, and on the iPad text at 3.3% of the screen's height or more with 4.5:1 contrast on a plate (`kit-accept`; it reports them, and fails on a miss only when run with `KIT_ACCEPT_HARD=1`).

### The new stage (`kit.stage`)

The iPad is the one shared screen, read from 1 to 1.5 m: text at about 3.3% of the screen's height or more, 4.5:1 contrast on a plate, no continuous motion, and every timed overlay carries a timer and can be cleared. Every server string goes in as text (`textContent`) and the page makes no outside request.

- **Chrome off.** The Full screen button, the status line and the Home Screen hint leave the art. A fault shows as one dot in the bottom-left corner (red for offline or not signed in, amber for retrying); a tap on that corner brings the chrome back for 5 seconds.
- **The crew across the top.** Top left, the night's clock (only when the GM turned the clock on) and **NEXT**. Top right, a head per PC playing: an initial, a Stress ring with the number, and the full name in at most two lines. The acting PC (picked in the Roll's Who, or while its stamp is up) is drawn larger in the accent colour; the change is a cut. The heads come from the mission the iPad is already sent (a night running in the Run view); with `night.who` on they are the players who are here. At most three PC faces carry a ring (the faces layer holds at most three), so a fourth PC has a head and a full name and no ring. The Band row (`display.band`, the old strip across the top) does not gate them: the heads and the clock read the mission and the faces layer's state, and only the old strip checks that row (read from the code, not run with the row off).
- **One plate** for anything written over the art: a lower third inside the inner 90%, with a timer where there is one. The wire's bulletins and the map's caption use it. While a plate is up the foot-of-screen places (last roll, docked clocks) stand down.
- **The roll as beats.** See the next section.
- **Clocks with names.** A shown table clock grows to the centre for about 2 seconds (its name and "3 of 8"), then docks on a plate at the foot right. A tick grows it again with the new segments in red, then docks. The site's alarm clock docks in the same place; when it fills, the iPad cuts to a red field naming it, and cuts back. A hidden clock is never sent, so it is never drawn.
- **The NPC.** A pushed NPC stands over the dimmed scene (the scene holds still) with a nameplate: role and place, the name, one line and a faction stripe. Spotlight shows a timed "who is speaking" bar in the lower third.
- **The map** fills the screen, and the band beside it becomes one lower-third plate (the clock, Now, Next, the crew and their rooms, the ways found, the beats, the countdown and the alarm). A drawing with a caption keeps the caption's plate.
- **Three transitions, one meaning each:** a scene change is a push, a reveal on the live map is a wipe, and the alarm filling is a hard cut and a flash. Everything else, and every change under reduced motion, is a cut.
- **Idle** is the ambient scene held still, the four places (clock, crew, last roll, docked clocks) and the lower plate. Nothing on it moves.
- **PANIC** also takes the idle places and the plate down (the root carries `data-stage-safe` while the safe scene is up), so no clock, head, docked clock or last roll is left on the work-light screen.

### The roll on the iPad (`kit.stage`)

The dice stay on the table; the iPad marks the result and never rolls. With `kit.stage` on, the stamp becomes a short sequence:

1. **Stakes.** Press **STAMP** in the Roll (Who, Position, Effect and the "If it goes wrong" line set). The iPad shows a plate: the chosen Who's name ("<name> goes for it"), "If it goes wrong:" and the line, with the position and effect (RISKY, STANDARD) at the side. The stamp carries `who` only with the setting on.
2. **Result.** Mark what the table rolled: key `2` (4/5) or `3` (1-3), or **Clean** in the Roll. The result lands as a rubber stamp in plain words (Clean: "You do it."; a 4/5: "You do it. It costs."; a 1-3: "It goes wrong."), in the outcome's colour and with its word, on a timed plate for 8 seconds. There are no numbers and no rules text. While a result is up the Roll's button reads "Stamp it on the iPad", and Clean reads "Clean: You do it." over the stakes.
3. **Cost.** After a 4/5 or a 1-3 the Roll shows a **Cost on the iPad** field. Nothing goes until you press Enter in it; the cost then lands under the result for 10 seconds (at most 60 characters). A cost that names a hidden NPC is refused: "The cost did not go to the iPad. It is still in the field."
4. **Last roll.** When the beat folds, the iPad keeps a small chip at the foot left: "Last roll · <name> · It costs". It lives in that page's memory only: a reload, or the setting going off, clears it.

**Take it down, Esc, Clean, another show taking over, Blank and PANIC all end the sequence**, and a result or cost still on its way when you take the stamp down is taken straight back off, so nothing lays itself again. A new stamp replaces whatever beat was up. With the setting off the stamp is today's: the card stays up until a mark, Clean or Esc.

### The four-screen sheet (`kit.phone`)

At 760 px and under (a phone), with the setting on, a player's live sheet is four short screens behind a bar at the foot: **Now** (stress, keys, harm, and the top four actions with "All twelve >"), **Sheet** (actions, abilities, triggers, items, stacks, vice, strictures, contacts and the mission), **Crew** (the cohort, the clocks, the session, downtime and the between-sessions fold, with a link to the crew sheet) and **Notes** (memories, notes and the log). The sheet draws exactly what it draws today; the kit only marks each box with its screen and hides the others, so every id and handler is where it was. The top bar (Back, the status, the vitals) shows on every screen, and a vitals jump to a box on another screen moves to that screen first. A roll started from Now opens over Now.

Which screen opens: **Now while a session is open at the table** (started, not ended), otherwise **Sheet**; after that, the last screen the player used on that phone (kept per sheet in localStorage `b68.sheetTab`, the last 12 sheets, written only when a screen is picked). A session that *starts* while the sheet is open moves it to Now, except while a field has focus or a panel is open: then the move is held, and made on a later draw only if the player left the field with no tap, key or scroll (the keyboard's Done) within 10 seconds. A session that ends moves nothing. Wide screens and print are unchanged, and turning the setting off puts the long page back at once. It makes no request.

### Pitches (`blade.pitches`)

Blade pitches up to three ideas at a time, each a different kind (Direction, Complication, Clue, NPC move, Cutaway): a line of 16 words or fewer, why now, and the prep item it leans on. They replace the Stall and Meanwhile cards while the setting is on. **A pitch is a model call**: it runs on the Worker's pitch seat and spends from the night's cap with the other seats (the Worker's rules are in "Claude at the table", *Pitches*). It rides the same Blade tick as the other seats. **Pitch now does not need Listening on:** the Worker does not check it for Pitch now; it reads the last four minutes of talk (none, if Listening has been off). The pitches that come by themselves ride the ticks Listening makes. A pitch never acts: nothing from one reaches the iPad, a phone or the display, and nothing is written.

- **The cards.** Every answer that carries pitches is **one set** in the Blade panel (`A`): a head (Pitches, the time, why Blade spoke: the scene changed, the table stalled, the table went quiet, a few minutes on, you asked) and up to three compact cards, each with its kind as a word and an edge (a different line style for each kind, no colour), the whole line at 14 px and the why-now in small type. Enter, or a click on a line, opens the set (the why-nows whole, and what each leans on in tonight's prep). A set is one panel card, under the Idea filter, with one pip; it is never sent to the server and is gone on a reload. On the old desk it is today's idea card (the panel's own classes); on the new desk it is the kit card.
- **Keep and X.** **Keep** pins a pitch past the fade. **X** dismisses it; with a pitch focused, `Delete` or `Backspace` is its X and the focus moves to the next pitch. An unkept pitch goes when its set fades, 90 seconds in view (the panel open, the page visible), dimming for the last 8. A dismissed line is remembered so Blade does not repeat it (the next request carries the last 12 lines shown or dismissed). Keep files nothing (no Moment).
- **Pitch now.** A **Pitch** button in the panel's head, and **`Shift+A`**, ask for a set at once. Either opens the panel and **never closes it**, so the answer is in view and the next Esc closes the panel, not PANIC. The button is busy ("Pitching...") while it waits, and a second press gets the same request, not another. A 429 (Blade is busy, or tonight's cap is reached), no key on the server, or a network failure each say so in one line under the head. With the setting off, `Shift+A` is just `A`.
- **The Rack.** The Blade fold under the Roll (`#gm-rackf`) shows the newest pitch still in the panel (kind, time, the line, the why-now), or "Blade is pitching..." while Pitch now waits. When the Rack holds only a pitch, its heading carries a one-line summary so it reads without opening the fold.
- **Off.** With the setting off the page makes today's tick (no pitch fields), draws no pitch markup and loads no pitch file. Turning it off mid-session takes the sets, the button and the Rack's pitch down without a reload.

### Keys: what is new or changed

Every key on the Shortcuts card (`?`) works as it did; the harness presses each one with the kit off and on and compares them (`kit-keys`, `app/README.md`). **Blade stays on `A`** (`B` is still the Location roller). What is new, or differs with a setting on:

| Key | What | Setting |
|---|---|---|
| `Shift+A` | Pitch now; opens the Blade panel and never closes it. A row on the Shortcuts card ("Shift A"); with the setting off it is `A` | `blade.pitches` |
| `Delete` / `Backspace` on a focused card | The card's **X**; the focus moves to the next card. Not while typing. It is not on the Shortcuts card (the X's tooltip says "(Delete)") | `kit.desk` (Blade cards), `blade.pitches` (pitches) |
| `A` | Opens the Blade panel as before. The right-edge tab is hidden, so the band's Blade button does the same, and gets the focus back when the panel closes | `kit.desk` |
| `C` `S` `J` `O` | Still open Chase, Street, Score generator and Opportunities, though their tabs are put away | `kit.desk` |
| `Ctrl+Left` / `Ctrl+Right` | Look at the place before or after, as before; a place's first view skips the four put-away views | `kit.desk` |
| `Left` / `Right` / `Shift+Right` on the site | The beat steps as before. The Run view's one-room inspector does not draw the second room card where the old view toggled Heard (the beat's own write is unchanged) | `kit.desk` |
| `Left` / `Right` / `Home` / `End` on a tab row | Move along the tabs, wrapping, and select the tab | `kit.desk`, `kit.phone` |
| `Enter` in Start the night's Session field | Starts (or carries on) the session. `Esc` closes the sheet | `night.who` |
| `Esc` and `0` | As before; with `kit.stage` on they also take the iPad's crew-faces layer down (the acting mark with it) | `kit.stage` |
| `Ctrl+K` | Opens Find as before, except that it waits behind the kit's plain dialog (the fallback used where the browser has no modal dialog) | `kit.desk` |

The kit's own parts take the usual keys: a dialog confirms on Enter and cancels on Esc or a click outside (a text box in a prompt takes `Ctrl+Enter`), and a menu moves with the arrow keys, Home and End, picks with Enter or Space, and closes on Tab or Esc. A cue toast's **Undo** runs once however many times Enter is pressed on it.

### Toasts

With `kit.desk` on, every message the page says goes through one stack, bottom right (a cue's Undo and its Yes or Cancel question too). The policy:

- **Real failures stay** until you press X: a server, save or network failure, a refused or lost write, a draw that broke, signed out. A line the rules do not know also stays (the safe side).
- **At most two of the page's errors stay at once.** A third puts the oldest away, except a "Not saved" line, which keeps its place (its write is still not on the server).
- **Routine hints fade** after about six seconds: a "do this first", "nothing to ...", "not on this page", "needs the hosted app". News fades on its own timer (5 seconds), and the same line replaces itself instead of piling up. Preflight is one toast whatever its count. "Signed out" is said once, by the band.
- **A cue's question never queues.** The Undo toast fades with the stack's timer; the Yes or Cancel question stays for its time with a timer bar, then answers no. If a cue toast cannot show at once it is taken back and the cue grammar draws its old centred toast instead (the same buttons, the same 15 seconds).
- Turning the setting off dismisses every toast the kit put in the stack. A toast takes no Esc (PANIC wins); its X always works.

### Esc and PANIC

**Unchanged.** Esc does one thing per press, from the top: the topmost open thing closes, else a focused field is left, else the stamp is taken down, else PANIC. The kit adds no document-level Escape listener and `app/gm/esc.js` is not edited: everything the kit opens closes through `B68GmEsc`, a kit dialog at priority 100, a popover or menu at 70 and the Start the night sheet at 45, and a toast takes none. PANIC is the band's one Danger button; with `kit.stage` on it also clears the idle stage (above).

### Rolling back

Turning the five rows off is the quick way back to Deploy 35's behaviour, with no deploy and no rollback (a reload takes the old desk's sheets out of the cascade layer). A code rollback is `npx wrangler rollback <the version before the release>`: the release script prints that line, with the D1 bookmark, at its end (`ROLLBACK: npx wrangler rollback <version id>   (D1 bookmark <bookmark>)`) and writes it to the release log. The build makes no D1 migration and no Durable Object change, so a rollback is only the Worker.

What the build writes is all optional and new, so the earlier code leaves each unread or drops it:

- the GM state's `features` (the five booleans), and the campaign document's copy of the display and phone settings (`kit.stage`, `kit.phone`);
- `session.present` on the campaign document, the roster (`night.who`): an entry counts only while it matches the session's start, so an older release leaves it inert;
- the ambient document's `polaroids` list while a session is open (`night.who`; End writes null), and `acting: true` on one PC face of the faces layer (`kit.stage`; Deploy 35's Worker drops the key);
- three optional fields on the stamp's `report` show, `who`, `result` and `cost` (`kit.stage`; Deploy 35's Worker builds a report from the fields it knows and drops the rest);
- in the browser only: `b68.kit` (which kit tokens are on), `b68.sheetTab` (a phone's last screen per sheet) and `b68.ks14.faces` (a flag the GM page sets so it can clear the faces it wrote).

Pitches write nothing of their own: the Worker logs the seat's call as an ordinary row with seat `pitch` in the existing log table, and the log's reload restore, `gm:after` and the spend sum read that row without error.

**If you roll back.** The rollback drill played a whole night locally with all five settings on (Start the night with two of three, the roll with who, a result and a cost, pitches, the phone's four screens, End the night) and then ran Deploy 35's code against that state: the GM page, the iPad and a phone loaded with no console or page errors, in the mid-night, ended-night and settings-off states, and with the worst-case values written into the store first. No key or document shape the build writes trips the earlier code. **One thing to know:** the five settings stay ON in the stored state after a rollback, and the earlier desk has no rows to turn them off. When the new code is deployed again they come back on. So if the new desk still works when you decide to roll back, turn the five off first; otherwise check Settings straight after rolling forward. A rollback also leaves the browser-only keys behind (`b68.kit` and the rest); the earlier code never reads them.

## Start the night (KS11, setting `night.who`, off by default: `app/gm/kit/who.js`, `app/ui/desk-who.css`, the night-who bundle)

To turn it on: the iPad view (`I`) > Settings > **Start the night** > On (see "The kit and stage: five settings", above). With the setting on, **Before** (the first place in the band) leads with one Primary, **Start the night**, and its own Next: Opening becomes a Standard button. It opens a sheet (the right-edge sheet; Esc shuts it through `B68GmEsc`) with every filed character as a toggle row with the player's name. The ticks come from the open session's roster, else the answers for the next session (everyone but a no), else everyone. The session number is the table's counter plus one, editable, with the Prep note's number beside it when the two differ. The open session's own number reads **Carry on session N**.

- **Start** writes what the table page's Start session writes (the session, the next session's answers as its attendance, the log line "Session N started"), plus the roster and session N's attendance from the ticks, through the page's `startSession` (`app/boot.js`). It logs "Session N started · 2 playing" in the night log, moves listening's session to N when it is already on, and goes to the Opening. Carry on keeps the start time, rewrites the roster and logs nothing on the table.
- **The roster** is `session.present` (CAMPAIGN.md): character id to the session's `startedAt`. Read it only through `B68GmWho.roster(doc)`: an entry counts only while its stamp is the session's own start, so a Start from the table page or an older release leaves it inert, and no roster means everyone. The table page's normalize keeps it, so a whole-document write (a log line removed) keeps it too.
- **Who is here (KS12.7).** Once the setting is on, the band has a chip beside the session chip, "2 playing" (`#gm-bar-who`). It opens the same sheet, titled **Who is here**: tick a late arrival, untick a player who has gone, and press **Carry on session N** (keep the session number). The Roll's Who chips, the iPad, the cards and the told lists follow at once, with no reload. A PC in the pack that no filed character matches by name counts as playing, and the sheet says so ("Not filed: ...").
- **What follows the roster (KS12).** No roster means everyone, as before. The reader is `B68GmWho` (`present()`, `isPresent()`, `only(list)`, `split(list)`, `away()`, `onChange()`); nothing else reads `session.present`. (1) **The Roll**: the Who chips are the PCs playing. (2) **The iPad**: the mission (`hud.crew` and the cards), the band's faces, the player tokens, key turns and the montage take the characters playing only; nothing of an absent PC is sent. (3) **The Run view's told lists**: the players here, Tell the crew (it reaches the players here), then a closed "Not here (n)" fold with the others, still a tap away. (4) **The score scenes' polaroids**: the ambient document's optional `polaroids` list (`[{ id, cap }]`, at most 8; the server's `cleanPolaroids` answers 400 for a malformed list and 413 for more than 8), sent in a PATCH of its own while a session is open; End writes null, and a page that finds a list left by a night that has ended clears it once. The display draws a polaroid only for an id its cast canon has a figure for. (5) **The absent packet**'s page opens with the absent players ticked (an untick stays). The Debrief's "send to phones" stays unfiltered, on purpose: it is a between-sessions card.
- **After** shows one line, "Session 5 · started 19:42 · 2 playing", and its End the night also ends the session (`endSession`, the table's End).
- The Run view's own control, which only sets the in-story clock, reads **Start the clock** while the setting is on.
- **Checks.** `checks/runtime/night-who.test.mjs` (the table page's own Start and End on a fake page give the same document, plus the roster; the roster through a whole-document write) and `checks/runtime/night-who.e2e.mjs` (two of three fixture characters started and read back; the session number traced to the band, listening, the iPad's GET, a capture line, After and the export; the setting off as before).

## The map, the players' screen and handouts: seven more settings (`app/features.js`, `app/gm/settings.js`, `app/gm-page.js`, `app/maps/map-kit.js`)

Seven settings came after the kit and stage. **Every one is off until chosen**, and with one off the app is as it was (for the map rows the same options reach the map kit, so the same map comes back). They are turned on where every setting is: the iPad view (`I`) > Settings (see "Turning a setting on" above).

| Setting | Settings row (the two choices) | What it turns on | Surface |
|---|---|---|---|
| `map.fill` | **Map fills the screen**: Off / On | The players' map on the iPad or a TV is drawn to fill that screen, with the key as a strip (the map kit's stage layout). A Shared screen choice beside the map says iPad (4:3) or TV (16:9). | GM |
| `map.people` | **People on the map**: Off / On | The Run view hands the map kit its people: the crew and the cast where the night places them on this screen, the crew alone (in rooms the players know) on the shared screen, and a crowd that suits the place. | GM |
| `map.lights` | **Room lights**: Off / On | A False dawn event of the play block lights its room on the map while it runs. | GM |
| `map.room` | **Cut to the room**: Off / On | Each room the players know gets Cut to room in the Run view: that room alone as a stage set on the shared screen, through the same checks as the map. Back to the map puts the map up again. | GM |
| `stage.players` | **Players' screen**: Classic / Map first | The shared screen shows the map and what the GM sends, nothing else: no scene band or plate, no time, no Now or Next, no crew status. The clocks the GM made visible sit as dials in a corner. A new scene replaces what is showing. | Display |
| `phone.handouts` | **Handouts on phones**: Off / On | Each handout in the GM page's list can be sent to one player or to everyone. It stays in a Handouts list on that player's sheet, to open full screen any time, until the GM takes it back. Off: no Send to, no Handouts button, no request and nothing stored. | Phone |
| `map.shade` | **Furniture depth**: Flat / Solid | Every map the GM page draws (this screen, the shared screen, a room cut to, the planning board and the exploded site) asks the map kit for furniture as low solids with a short cast shadow (`shade: true`, map kit 1.2). | GM |

- **Where the rows sit.** Players' screen is the sixth row, straight after Band (after the five rows of the first build, so none of those moved). The four map rows follow Pitches, then Handouts on phones, and Furniture depth is last.
- **The map kit in the app** is `app/maps/map-kit.js`, a vendored copy; `app/kits.json` records its version (1.2.0) beside the figure kit's (3.1.0).
- **Furniture depth and the size cap.** `P.shadeOpt()` in `app/gm-page.js` is `{ shade: true }` while the setting is on and `{}` while it is off, so off does not even pass the key. A map too large for its cap is drawn again without the shade before anything else is given up: the shade is the first step down every size ladder.
- **Checks.** `checks/runtime/map-scene.test.mjs`, `players-intro.test.mjs`, `players-screen.test.mjs`, `handouts.test.mjs`, `players-board.test.mjs`, `map-shade.test.mjs` and `map-shade-kit.test.mjs` run in `npm run check:runtime`. The browser checks are `map-scene.e2e.mjs`, `players-screen.e2e.mjs`, `players-intro.e2e.mjs`, `players-board.e2e.mjs`, `phone-handouts.e2e.mjs`, `map-shade.e2e.mjs` and `map-shade-paint.e2e.mjs`. `kit-off.e2e.mjs` holds the five kit settings' off state to the page as it was (it was written before these seven).

## Live sync (`functions/_lib/live.js`, `worker/live.js`, `functions/api/live.js`)

A page hears of a change at once, instead of on its next poll. **The poll stays the source of truth**: a page with no socket behaves exactly as it did before, and a poke that never arrives costs only time.

- **A poke is a nudge, never data.** It is exactly `{ "k": <kind>, "t": <ms> }`: a kind and a time. A page that hears it runs its existing poll at once. Nothing a player must not see can ride in it.
- **The socket.** `GET /api/live` upgrades to a WebSocket behind the same Access and role checks as every API call (no sign-in is 401; no upgrade header is 426; the table display may open it too). One Durable Object per campaign, `LiveHub`, holds the sockets with no storage and no timers. The route sets the socket's role from the signed-in caller, never from anything the client sends. `ping` is answered with `pong` without waking the object.
- **Who hears which kinds.**

| Kind | Sent when | Heard by |
|---|---|---|
| `characters`, `campaign`, `npcs` | one of those writes succeeds (including the Screen's portrait-add) | phones and GM pages |
| `display`, `ambient` | one of those writes succeeds | the iPad and GM pages |
| `stt` | the transcriber's control document actually changes (a heartbeat that says the same thing pokes nothing) | the iPad and GM pages |
| `cue` | a transcript post holds a line with `cue: true` | GM pages |
| `screen` | the stored display changes while the phones' mirror is on, and when the mirror switch flips (MM1) | phones |

- **After the write, never in the way.** A poke goes out through `waitUntil` once the write has succeeded, so a refused write (403, 409) pokes nothing, and a failed or silent object is logged and dropped: the answer is never delayed.
- **The switch: Menu → Live sync.** On by default. It is the key `live` in the GM state (`PATCH /api/gm/state { live: false }`), so there is no migration and **no deploy is needed**, which matters on game day. Only an explicit `false` is off. It rides in answers every client already gets: `live` in the data poll (`GET /api/characters`) and in `GET /api/gm/display` (the seq-only call is unchanged).
- **What off does.** The server closes every open socket with code 1000 when the switch flips to off (and only then, never on other GM state writes); `/api/live` answers 503 while it is off, so a page that reconnects stays on its poll; every page sees `live: false` in its next poll and goes back to the fast poll. Turned on again, pages reopen their sockets. With the switch off, or the object down, the console works exactly as it does without live sync.

**The client half (`app/runtime/cf.js`, `B68Live`).** One socket per page, shared by whoever listens: `B68Live.on(kinds, fn)`.
- **Opens** only after a poll answer said `live: true`, while the page is visible, online and signed in; at the same origin (`wss://<host>/api/live`). A hidden page closes it; visible again it reopens and polls at once.
- **Phones and the GM page** (the data poll): a poke for `characters`, `campaign` or `npcs` runs the poll now. The poll is 15 s while the socket is *healthy* and 4 s otherwise. Healthy is all three: a poke or pong in the last 60 s; each own write came back as a poke within 5 s; no poll brought back a change no poke announced (judged 2 s later; the first poll after a reconnect is not judged). Failing any holds the poll at 4 s for a minute.
- **The iPad** (`app/display-page.js`): a `display`, `ambient` or `stt` poke makes its poll run now (`poller.poke()`). Its 4 s beat, the transcriber's `want` and the 2-hour idle drop are unchanged.
- **The GM page's cue lane**: a `cue` poke reads the transcript at once; the 2 s poll stays as the fallback.
- **Ping** every 30 s (`ping`/`pong`); no pong in 10 s, or no hello in 10 s, closes it.
- **One connect gate.** Every path that can open a socket (a poll answer, the retry timer, a page becoming visible, a new listener) goes through one gate. It refuses before `nextTryAt`. Every close that was not the page's own (a drop, a missed pong, a missing hello, a 1000, a refused upgrade, **including a socket that opened and got its hello**) moves the backoff on a step: 1, 2, 5, 10, then 30 s. The backoff starts over at 1 s only after a socket has stayed open for 60 s (not on open, not on hello). Hello may trigger one poll (itself held to one per 500 ms) but never a connect.
- **Circuit breaker.** It counts unplanned failures only (a close the page did not ask for, a missed pong or hello, a refused connect), at most 20 per page per rolling hour. Planned closes (a hidden page, the switch off, the last listener leaving) and the reconnects after them never count, so locking and unlocking a phone cannot trip it. A socket that stays open for 60 s clears the count. Past the limit, live sync stays off on that page until a reload; the 4 s poll carries on and nothing is shown.
- **A page coming back visible** reopens only through the gate, only if the last poll answer said `live: true` and a 1000 close is not holding it; otherwise it polls, and the answer decides.
- **Off.** A server close with 1000 means the switch went off: the page stays closed until a poll that started after the close says `live: true`. A close before the socket ever opened (a 503, an expired Access session: a browser cannot tell them apart) waits for its backoff step AND a fresh `live: true` answer, so it costs one connect per step, never one per poll, and shows nothing.
- **Service worker.** A socket is not a fetch, so `sw.js` never sees it; the code ships in `runtime/cf.js`, which is in the core bundle the worker already files.

Checks: `checks/api/live.mjs` (every write path, the role header, the object down, the switch) and `checks/api/display-role.mjs` (real sockets under `wrangler dev`: each role hears only its kinds, the switch closes them); `checks/runtime/adapter.test.mjs` (the client's rules with a fake WebSocket); `checks/runtime/live-clients.e2e.mjs` (real pages: latency, the 15 s poll, a killed socket, a silent socket, the switch, the iPad's beat).

## The store (W0.6: `functions/api/docs.js`, `functions/_lib/docs.js`, `migrations/0009_docs.sql`)

One small table, `docs(campaign_id, kind, owner, scope, json, updated_at)`, keyed on the first three, for the suite's per-campaign documents. `kind` is `[a-z][a-z0-9-]{0,31}`; `owner` is a player's own id (their email, as `characters.owner`) or, for a GM row that belongs to the campaign, `_`; `scope` is `gm`, `player` or `public`. `json` is an object or an array, at most 64 KiB (counted in bytes; 413 over). Not part of `/api/export`.

- `GET /api/docs?kind=&owner=&since=&limit=` -> `{ docs: [{ kind, owner, scope, updatedAt, json }], more }`, newest first, 100 rows unless `limit` (at most 200). `PUT /api/docs { kind, owner?, scope?, json }` replaces one row. `DELETE /api/docs?kind=&owner=` removes one (404 when absent).
- **GM:** reads and writes every row. A new row's scope is `gm` unless the write names one; a later write that names none keeps the stored one.
- **Player:** reads `public` rows and `player` rows whose owner is their own id (a `gm` row on their own key is invisible to them). Writes only kinds `opportunity`, `debrief` and `quiet`, only as themselves (leave `owner` out), always scope `player`. The upsert is guarded in SQL: a row the GM has set to `gm` or `public` is never replaced by a player (403). Another owner, another kind or a wider scope is 403.
- **Display:** `GET` only, `public` rows only (the SQL adds it; the allow-list in `auth.js` and the middleware let nothing else through). A row the caller may not read is absent, never 403.
- **`since`** is exclusive and a row's time only moves forward for that row: two rows written in the same millisecond can share a time, so a poller should re-read by kind (the rows are small), or ask for a little before the newest time it has seen.
- **Poke:** a write or delete pokes the LiveHub with kind `docs` (heard by every role; `{ k: "docs", t }`, no data) unless it touched only GM-scope rows. No Durable Object class change: `docs` is one more entry in `KINDS` (`functions/_lib/live.js`).

Check: `checks/api/docs.mjs` (the role matrix for the GM, the display and players A and B, the 64 KiB cap, the pokes, and that 0009 is additive and leaves the old code's schema alone).

## The phones' table screen (MM1: `functions/api/table/screen.js`, `functions/_lib/table-screen.js`, the sheet's Table button)

A player's phone can show what the iPad is showing, **when that is a map (`svg`) or a handout, and never anything else**. It is a copy of the stored display, so it cannot carry more than the GM's gate let through to the iPad.

- **The switch: *Mirror for phones*,** in the iPad view's Settings (the night rebuild moved it there from the top bar and the iPad tab). On by default; it is the key `mirror` in the GM state (`PATCH /api/gm/state { mirror: false }`), so there is no migration and **no deploy is needed**. Only an explicit `false` is off. It sits in the same state row as `live`, which the data poll already reads, so it adds no read.
- **The poll.** `GET /api/characters` (and `?since=`) gains `screenSeq`: the display's seq while the mirror is on and the display is an `svg` or a `handout`, otherwise 0. It is one statement with the stamp and the switches (still 3 D1 calls); the display's `kind` is read in SQL only while the mirror is on, and the svg never reaches the poll. A GM state write that leaves `mirror` alone moves nothing a phone sees.
- **The picture.** `GET /api/table/screen` (a player, the GM or the display sign-in; the same rule for all three): `{ seq, kind: 'svg', svg, title?, caption? }`, `{ seq, kind: 'handout', file, title? }` or `{ seq, kind: 'none' }`. The svg is the stored string itself (`json_extract`, no parse in the Worker). `file` is the plain image name the iPad uses; the page loads `media/handouts/<file>`, which the static server gives to every signed-in member, and the route takes no parameter, so no other path can be asked for. A handout's title comes only when the iPad shows it (`showTitle`).
- **Hidden geometry stays hidden.** A site's reveal (bands, single rooms, the unsurveyed cover) is baked into the svg bytes by the map kit at render time (`app/maps/map-kit.js`, "player cover": the file never holds a hidden room's edge), and the display stores only kind, title, caption and that svg (`cleanDisplay`), so no reveal state or mask lives in a separate field, an overlay or the display page's CSS (`display.css` has one rule for a map: its size). The phone's `<img>` therefore shows what the iPad paints; `table-screen.e2e.mjs` renders an invented site at a partial reveal both ways and compares the pixels (only the lettering face differs, an `<img>` has no web fonts).
- **Fails closed.** Blank (the ambient scene), lights out (`dark`), an NPC, text, a rule, cards, the switch off, nothing stored, a malformed row, a file name that is not a plain image name and a hit on the hidden-name scan all answer `{ seq, kind: 'none' }`.
- **The hidden-name scan** (belt and braces: the display already passed the GM page's gate): `namesHit` over the title, caption and the svg (as written, entity-decoded, as its text, and as its text with tags removed, so a name split over `<tspan>`s is found; a handout's file name with `-`, `_` and `.` read as spaces) against every hidden NPC's name and alias and every hidden clock's name. A hit **refuses** the whole screen rather than redacting it. A single pattern over the names' longest words keeps it cheap (about 2 ms in node for a 590 KiB map and 40 names; `namesHit` runs only for a candidate).
- **The poke.** `screen` goes to phones after any successful `PUT /api/gm/display` while the mirror is on, and when the switch flips; the phones' data poller listens for it (`cf.js`, MD2) and polls at once, so the Table button's dot lights, and an open viewer clears on lights out, within about a second even while live sync has slowed the poll to 15 s. (The ticket asked for pokes only when the new display is a map or a handout; the rest are included so a viewer never keeps showing a map after the GM has put the lights out. A poke is a kind and a time, so it carries nothing.) A refused write (403, 409) pokes nothing.
- **On the phone.** The sheet's sticky bar has a *Table* button; a dot says `screenSeq` has moved since the player last looked (`localStorage` `b68.table.seen`, a convenience only). It opens a full-screen, dark viewer on the page body: the map is an `<img>` from a blob URL (it cannot run script), the handout an `<img>` of its static path, the title and caption go in as text, the zoom is the browser's own pinch-zoom (no script), × and Esc close it. It makes no request of its own: it asks again only when `screenSeq` moves while it is open (a move to 0 shows *Nothing on the table screen*). `window.claude.table` (`screen()`, `screenSeq()`, `onScreenSeq(cb)`) in `app/runtime/cf.js`; `api.screen` in `app/CONTRACT.md`.

Checks: `checks/api/table-screen.mjs` (every kind, the switch, byte-identity, the scan with positive controls, the pokes), `checks/runtime/table-screen.e2e.mjs` (a phone, a real Worker), the adapter and GM page tests.

## Claude at the table (the box, `app/gm/assist-panel.js`, `functions/api/gm/assist.js`)

**The panel.** On a laptop, Blade lives in a side panel. A 44 px tab sits on the right edge, between the top bar and
the capture bar, and shows the portrait, the unread count and up to five coloured pips (one per card kind). Click it,
or press **A**, and a 400 px panel slides in over the page (min 360 px, max a third of the width; no slide under
reduced motion). **Esc** closes it, though not while you're typing in it. At 1600 px or wider, **Pin** docks it as a
fourth column beside the console instead. The pin isn't remembered across a reload. Top to bottom: the header (state,
spend, seat health, pin, close), *Now*, the Ask bar, the feed with its filter chips, and the Tools drawer (Fit it, the
Screen and the Ledger). Inside the panel, **J**/**K** move between cards, **Enter** folds or unfolds one and **U**
undoes the newest action (a no-op until the co-GM lands). Outside the panel, J and the other keys do what they always
did. It's hidden on phones.

**The header's dots and meter.** Three dots, T R V, show the Tripwire, Ref and Voice. Each has its own shape, a letter and a
spoken text, so colour is never the only signal: a **filled green disc** means the seat ran in the last 10 minutes; an **empty
grey ring** means it is asleep (it was not woken, is on its cooldown or is held by the spend ladder, which is normal, not a
fault); an **amber tilted square** means it was skipped as still running on two ticks in a row, so a call is stuck. A dashed ring means
no tick has answered yet. There is no reset button: the stuck call's lease lapses by itself and the next tick frees the seat. When
that happens one quiet line appears under the header (*Blade freed a stuck seat (Ref). It is working again.*) until the next tick.
The five-cell meter beside the spend fills in fifths of tonight's cap and turns mustard from 60% and red from 85% (its spoken
label says the percentage). A **warn** card is also read out at once (an assertive live region outside the panel, so it is
spoken with the panel closed); every other card is announced politely as it joins the feed. Closing the panel puts the focus back
on the Blade tab. Every colour pair in the header is checked at 3:1 (shapes) or 4.5:1 (text) in the light theme, the dark theme
and the OS dark preference.

**The card.** Every card is one component. Folded it is a single 44 px line: the colour bar, a glyph, the kind's word, the
headline and the time. Tap it and it opens to the headline, up to five bullets, **SAY** (a rust band), **GM ONLY** (dashed),
the page cite and, on a Ref slip, what it checked, then the actions: Keep, Got it, Undo (a done card) and More. More shows
the detail inside the card, at most 40% of the panel's height, and scrolls there; a card is never taller than the panel.
*Now* holds the newest unread card, open and one type step larger, until it has been in view for 1.5 s (it is then marked
read) or a newer card arrives. With the panel closed, only a **rule** or **warn** card slides a one-line strip out of the
tab for 8 s (the kind and the headline, never the bullets, SAY or GM ONLY); every other kind only adds a pip. An Ask Blade
answer is a card too, open at the top of the feed. The page can add its own cards with `ctl.addCard` (the co-GM, autopilot,
warnings); those are not in the server's log, so a reload forgets them. Model text is always shown as text (bold and
italic only); only *More* is rendered as Markdown, through `B68Markdown`, with headings stripped. `gm-assist-cards.e2e.mjs`
checks all of this in a real browser.

**The box** (the panel's engine, still called that below) needs
**Listening** on (the iPad transcriber above), because it reads that transcript. About once a minute it asks a cheap
seat whether anything at the table needs a second look, wakes other seats only when the answer is yes, and shows at most
one card per five minutes. Quiet is the normal state. Tonight's spend is counted from the log against a **cap**
(`ASSIST_CAP_USD`, default $30): the budget ladder drops the optional seats at 60% and keeps only the core ones at 85%,
and at the cap nothing runs. The box says so when it is off. With the box off, no key, or the cap reached, the console
works exactly as it does without it.

**One card shape.** Every card in a tick answer, a Fit it answer and `GET /cards` also carries the glance fields:
`kind` (rule, note, idea or say), a `headline` (at most 90 characters), `bullets`, and for a Ref card its page `cite`
(a short string) and its `check`. Ask Blade has its own fields (below). The older fields (`text`, `detail` and each
seat's own) are unchanged. A row logged before this restores as its seat's kind, with `headline` = `text`. Stall keeps
its own `kind` (complication or clue), because the console reads it.

**Leases and deadlines.** The Worker tracks which seat has a call out as a *lease*: a token and an expiry per seat, in the isolate's memory (no database write). A seat holds its lease while its call is out and releases it when the call ends, and a leased seat is not started a second time. If a request is cancelled before it can release (the page gave up), the lease lapses on its own after its ttl (45 s for the tick's seats, 27 s for the Tripwire, 60 s for the Fixer, Another, the gatekeeper, Portrait and Wire, 90 s for Prop and Ask Blade) and the next tick *reaps* it and carries on, so one stuck call can no longer silence a seat for the night. Every Claude call also has a **deadline**, shorter than the page's own wait: 12 s for the Tripwire, 30 s for each tick seat (they run side by side, so a slow Voice does not hold Ref's card), 45 s for the Fixer, Another, the gatekeeper, Portrait and Wire, 75 s for Prop and Ask Blade; the page waits 55 s for a tick. A call that hits its deadline shows nothing and is logged with `timeout: 1`. Each request's work is also handed to the platform (`waitUntil`), so if the page does give up the log rows are still written and the leases still released (the platform allows up to 30 seconds after the response is sent or the client disconnects, shared by everything handed to `waitUntil` in that request; a tick's worst case, 12 s then 30 s, is inside that). The tick's answer carries `health: { skipped, reaped, ran }` (which seats did not run and why, which leases were reaped, and which seats' calls came back with an answer; `ran` is what lets the panel tell a seat that ran from one that was simply not woken), and the Tripwire's log row records `skipped`.

**The Fixer fits the console's own draws.** When you tap a Position on the console (and the box is on, Listening is on and the cap is not reached), the console draws its 1-3 and its 4/5 card once, from the pack's own tables, and sends both with the Position to the Fixer. The Fixer keeps what each draw says happens and fits it to the scene, and writes the 6, the crit and a Devil's Bargain; the answer appears in the **Rack** strip under the card. Tapping 1-3 or 4/5 then shows that very draw (never a re-roll), so the card and the fitted line agree; a late answer still lands in the Rack. A different Position (or Scene, District, PC, NPC or Threat once a Position is set) re-draws and re-fits; **Clear** on the Rack drops them. A used draw is not served twice. The draws are page state only: a reload forgets them and the next tap rolls as it always did. The Dots chip beside the Position switch goes with the fit when it is set: the request carries `dots` (0 to 4) and the Fixer's turn says *Dots: N*; with no dots set the request and the turn are as before. The fit endpoint needs `draws: { low, mid }` and answers 400 without them (and 400 for a `dots` that is not a whole number from 0 to 4). Every seat call's log row records its seconds and stop reason; a refusal is logged and shows nothing. The replay script takes the same draws: `--fixer-at HH:MM,... [--draws-file f.json | --draws-pack pack.json --draws-seed N] --position risky`.

**Voice, and Another.** When an NPC is on stage (put on stage in the NPC tab or the cast page), the page sends that NPC's name with each tick; the server holds no scene, so the page is the only thing that knows. With a name, the Voice seat wakes when the Tripwire hears an NPC change and again on every tick, about each minute, after Ref and within the usual gates (one in flight, a short cooldown, and it stops at 85% of the night's cap). With no NPC on stage Voice never runs. Its two lines, in the NPC's own register from their How to play block, appear in the **Rack** under the console card, labelled with the NPC's name; a line already shown in the last ten minutes is dropped, and they never take the one-card-per-five-minutes slot. **Another** asks the `voice_plus` seat (Opus, medium effort) for one more line for the same NPC and moment, told which lines were already shown; it goes through `POST /api/gm/assist/another { npc, shown }`, with the same cap and busy answers as the Fixer, and stays available until the cap. With the box off, Listening off, the cap reached or on a phone nothing runs and nothing shows; **Clear** drops the lines. If several NPCs are on stage the page names the first in the cast list. The replay script takes `--voice-at HH:MM[=NPC],... [--another N]` (a moment with no name stays silent and makes no call) and writes `lines.md`.

**Stall, the Showrunner and the Mystery keeper.** Three more seats join the Tap. **Stall** wakes when the Tripwire hears the table idle, off-topic or going round in circles (at most every 5 minutes): if the table really is stalled it offers one complication or one clue, and the offer appears in the box as an idea card (with its kind as a chip and **Clear**); the Rack holds only the Fixer and Voice. The **Showrunner** is checked about every 10 minutes on the last 20 minutes of talk but speaks only for a clear pacing problem (a character not heard for the whole stretch, a scene with no roll for the whole stretch, or within 30 minutes of a planned close when the prep gives an end time); otherwise it returns `speak: false` and nothing shows. The **Mystery keeper** wakes when the Tripwire hears a clue, a secret or a theory (at most every 15 minutes), reads the last 15 minutes plus what it reported known earlier, and names the one clue to work in next; that clue must come from the **Must land** list in tonight's prep and the seat names the entry it took, and a card that names none is dropped. The seat may also suggest a handout from the handouts list in its context (`handout_id`, only when the talk shows the table has just reached the moment the handout's cue describes): the Worker checks the id against the live `handouts` pack part (a small read, only when the seat named one) and drops one that is not there, and a valid one comes back as a separate `handout` field of the tick answer, never taking the card slot; the page puts it in the box as an idea card, *Show handout?*. The Worker does not hold the prep, so it cannot check the wording against the list: the seat's instructions carry the rule and the replay script checks it. The Showrunner's and Mystery's notes are ordinary cards behind Ref and Clerk, so the one-card-per-five-minutes gap covers them and Clerk; **Ref has priority**: a rule slip is never held back by one of those cards (only by an earlier Ref card), while they wait five minutes after any card. A card the gap holds back is dropped, not queued (a Ref slip waits up to 4 minutes, and a later quiet tick releases it). Budget: the Showrunner and Mystery stop at 60% of the night's cap, Stall and Voice at 85%, and Ref, the Ledger, the Fixer and Another run to the cap; with the box off, Listening off, the cap reached or on a phone none of them runs and nothing shows. Known limits, left for gate tuning: the Tripwire's `stall` flag was tightened (it now means the table has stopped or is going in circles, not normal planning, rules talk or banter during action; on a replay of a long planning stretch it fell from 44 minutes in 97 to 5), so a few false flags can still reach Stall, which filters them at a small cost, and a table that has gone truly silent wakes Stall through the code-side silence flag (see the next paragraph). The replay script takes `--tap-sim --from HH:MM --to HH:MM` (the whole table agent through the real endpoint, one tick a minute) and `--turn-at seat@HH:MM,...` (one seat at chosen minutes; checks the Mystery entry against the prefix's Must land section).

**The Scribe, Meanwhile, and silence.** Two seats and one code-side flag join the Tap. **The Scribe** keeps a rolling *story so far*: about every five minutes of new talk it folds the latest stretch into one running summary (a cheap seat, low effort), fixing speaker labels and misheard names against the cast only when they clearly match. The story is capped at 8,000 characters (about 2,000 tokens); the Worker trims the oldest lines if a reply runs over, and keeps the old story if a reply would wipe it. It lives on the Scribe's own row in the log (no migration), a new session starts a new story, and nothing from it shows. The **Showrunner, the Mystery keeper, Meanwhile and Ask Blade** get it with their instructions, after the cached prefix, so they can look past their last 15-20 minutes; the prefix itself never holds it. The Scribe stops at 85% of the night's cap. **Meanwhile** wakes when the Tripwire hears a scene change (at most every 20 minutes, dropped at 60%) and offers ONE faction cutaway as an idea card in the box (with **Clear**): what a faction is doing off-screen in response to what the crew just did, tied to that faction's clock, which it names with a *suggested* tick (0 to 2). It never ticks anything: the clock is yours. It reads the table's open clocks from the campaign document (names and fill only, at most a dozen, only when it wakes) and a `factions.md` block in the prefix. **Pack:** `gm:pack` builds `factions.md` from the Group campaign's faction board (the note with "faction" in its name, or `"factions"` in `gm-private/assist-config.json`): each faction's name, tier, standing and clocks from the board's Faction/Tier/Status and Faction/Goal/Clock tables, a line each; it sits with the stable blocks, ahead of never-reveal and prep, and the 90k-token warning still counts it. **Silence:** a table that has gone quiet gives the Tripwire nothing to flag, so when Listening is on, the iPad reports it is listening, and no line has arrived for 4 minutes (up to 30; then the table has packed up), code raises the stall flag itself and Stall runs without the Tripwire, under its usual 5-minute cooldown, the 85% cut-off and the cap. Listening off, a stopped or errored iPad, or a paused box (the page stops ticking) raise nothing. Known limits: the Night Shift does not read the story yet (it reads the whole transcript); the Meanwhile cutaway is only as good as the faction board's clocks; the gate script (`gm-assist-gate.mjs`) does not enable the Scribe or Meanwhile, `gm-assist-replay.mjs --tap-sim --tap-seats tripwire,scribe,meanwhile,...` does (see `--force-flag`, `--clocks-file`, `--prefix-file`), and writes `story.md` and `meanwhile.md`.

**Pitches (setting `blade.pitches`, off by default; `functions/_lib/assist/pitch.js`).** With the setting on, Blade pitches up to three ideas at a time, each a different kind (a direction, a complication, a clue, an NPC move, a cutaway): a line under 16 words, why now, and the prep item it leans on. They take the place of **Stall and Meanwhile**, which do not wake while the setting is on. The Worker reads no settings, so the page says so: every tick carries `pitch: true` and `seen` (the last 12 lines shown or dismissed, which Blade must not repeat), and the GM's **Pitch now** sends `pitchNow: true`. The seat (Sonnet, low) wakes on a scene change, a stall, the quiet table (in place of Stall), and a tick with talk after 6 minutes without a pitch. It waits 4 minutes between runs; Pitch now skips the wait. It reads the last four minutes, the story so far, the open clocks and who is on stage. It runs to 85% of the night's cap, so past Meanwhile's 60%; Pitch now runs to the cap and answers 429 at the cap or while a pitch call is in flight. A set comes back as the tick's `pitch` field, never as a card. Its log row is never `shown`, so the card gap, the reload restore and `gm:after` all leave it alone, and a pitch never acts: nothing reaches the iPad or a phone. With the setting off, the request and every wake are as before. `scripts/gm-assist-e2e.mjs --fake --pitches` runs the plumbing at no cost over `checks/runtime/fixtures/gm/pitch-night-transcript.md`.

**Why the prefix is a file.** Every seat reads the same long reference text (the rules digest, the cast, each NPC card's How to play block, the player-to-character table and tonight's
prep, up to ~90k tokens; the table comes from `player:` on the PC notes or the git-ignored `gm-private/players.json`, which wins). The Worker runs on Workers Free, where a request gets 10 ms of CPU: waiting on Claude or D1 is
free, but reading, parsing and re-sending that text on every tick is not. So the GM's PC uploads the text once to
Anthropic's Files API as a plain-text file, the pushed `assist` part holds only `{ file_id, hash, extra, roster }`, and each seat
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
never blocks. The Screen (next section) sends every item through it; a Ref card is sent only when it carries a page cite (see "The cite flag").
`node scripts/gm-assist-replay.mjs --context <block files> --gatekeeper-file <json list of { kind, text }>` runs it over sample items.

**Ref's two checks and the `rolled` tick.** Ref checks every roll in its window twice: (a) order, position and effect stated before the dice, and (b) resist,
a resistance roll offered after any consequence (harm, a complication, a worse position, a lost opportunity). A missing position or a missing resistance
offer is a slip, not a style choice; silence stays the normal answer otherwise. Its answer carries `check` (order, resist, harm, cost, house or other),
which the card keeps when it is one of those and drops otherwise; the card line is under 12 words. House rules are not in the repo: they reach Ref through
the assist part's `extra.ref`, appended to its instructions. The Editor also drops a Ref card that repeats an earlier one: the same `check` as a Ref card shown in the last 10 minutes with the said-at times within 3 minutes of each other (or, when either has no said-at, the same check within 4 minutes), whatever the rule text; `other` is excluded, so two different catch-all slips both show. The card seats' one-line fields (Clerk, Stall's offer, Showrunner's advice, Mystery's
`push_next`, Meanwhile's cutaway) ask for one sentence, under 12 words, the point first.

- **The tick body takes `rolled: true`** (anything that is not a boolean is a 400). It adds the flag `rolled`, which wakes Ref (`WAKES.ref`); `rolled` is not a
  Tripwire flag. The Tripwire's own 45 s gap does not apply to a rolled tick (one at a time still does), so it reads any new talk and Ref looks.
- **A rolled-only tick** (nothing new to read, or the Tripwire busy) skips the Tripwire and wakes Ref alone: no Showrunner, Scribe or Voice. It still obeys
  the cap, the ladder, Ref's 60 s gap and the leases (a held Ref is reported in `health.skipped`). It returns the cursor it was given, so the talk the
  Tripwire has not read is read by the next ordinary tick, and with no talk in the window it makes no call. It logs no Tripwire row, so no follow-through
  comes after it. A rolled tick that did run the Tripwire logs `rolled` on that row and is followed through once, like `roll_talk`.
- **The page sends it** 40 s after the GM taps a 4/5 or 1-3 result in the console, or files a roll with L. One is pending at a time and a newer result
  restarts the 40 s. If a tick is in flight when it falls due it retries every 3 s rather than dropping. It does nothing when the page is hidden, on a
  phone, paused, capped or with Listening off, and the regular minute restarts after it.
- **`downtime`** is a Tripwire flag (a vice indulged, a downtime action or roll, recovery or healing being worked out right now) that wakes Ref.
- **Replay and gate** take `--extra-file <seat>=<path>` (repeatable), handed to the endpoint as the assist part's `extra.<seat>`, so a replay can give Ref
  the same checklist the live part carries. The file's text is never printed. The replay does not send `rolled`.
- **`/act` cue mode** (C4c): `mode: 'cue'` with `cueLineId` (the transcript row id of the line holding the wake word, which must be among the lines read) means the GM said "Blade, ...". With `parsed` (the page's own parse, 1-8 actions: `clock_add` with `filled`, `clock_tick`, `npc_add` (an empty name only with `needsName`), `capture`, `undo`, `rename`) there is no model call, no key and no gate and it costs nothing: the Worker validates the actions (the quote must start on the cue line), keys them from `cueLineId` and the action's index, and writes one hands row (`card.out.cue`). Without `parsed` the `hands` seat reads the cue. Every survivor is mode `act`. A key already in tonight's hands rows comes back mode `seen` (a second GM page posting the same cue loses a single atomic claim); a window request gets `seen` only if it sends `seenOk: true`, so a page from before the deploy never re-applies one.

## Co-GM by cue (`app/cue.js`, `app/gm/cogm.js` cueNext, the cue lane in `app/gm-page.js`)

Say **"Blade, ..."** at the start of a sentence, followed by a command, and Blade does it. The **Co-GM switch** in the box's header means **cue only**: it reads the
transcript every 2 s and acts on nothing else. A second switch, **Also listen for uncued decisions (offers only)**, appears under it, is OFF whenever Co-GM is turned
on, and when on lets the old windows of talk run, but what they find is only ever a yellow card with Do it. With Co-GM off the lane does nothing and the console is as
it was (no polling, no `/act`). Listening going off switches Co-GM off. The night's cap does not: parsed cues cost nothing and still land; only the uncued windows
stop, and a cue that needs the model (a cut-off command) gets a grey card, "I couldn't finish that one tonight". Undo and rename act on what *this page* made, so with
two pages open only a page that has something to undo or rename posts the cue (a page with nothing says so quietly).

| Say | Blade does |
|---|---|
| "Blade, make a six clock called Escape" (and mark two) | a **hidden** clock, with two marked if you said so |
| "Blade, tick Escape (two)", "fill Escape", "clear two on Escape" | moves it; "tick that" means the clock Blade last made or ticked in the last 10 minutes |
| "Blade, new NPC called Wexley, a bouncer" | a **hidden** NPC. With no name it rolls one with the NPC generator and the card says *name rolled* (Rename is on the card) |
| "Blade, note ...", "loose end ...", "name ..." | files a moment, a loose end or a name in the capture bar |
| "Blade, call him Big Sal", "rename that to ..." | renames the last NPC or clock Blade made tonight |
| "Blade, undo", "scratch that" | undoes Blade's newest action that is still done |

Also accepted, because Deepgram writes what it hears: **"the Escape clock"** or **"Escape clock"** for Escape; **"tick the clock"** = "tick that" (the last clock, else it asks which); the **past and -ing forms** right after the wake word ("Blade. Created NPC called Wexley", "Blade, ticked Escape"); **"Blade at an NPC ..."** and **"Blade, status six segment clock. Called Quillmoth"** (misheard "add" and "start a"; only that exact shape); and **"called Name"** in the next sentence of the same line. Anything looser stays silent.

**Typed.** In the Ask bar (laptop only: the box is hidden on a phone), text starting **"Blade,"** or **"/"** is a command, not a question: it never goes to Ask. Slash forms:
`/tick Quillmoth 2` = "Blade, tick Quillmoth 2"; `/clock 6 Quillmoth` = "Blade, make a 6 clock called Quillmoth"; `/npc Pembrake, a nervous lamp salesman` = "Blade, new NPC called Pembrake, a nervous lamp
salesman" (`/npc` alone rolls a name); `/note ...`; `/undo`. Any other slash shows a grey card and sends nothing. The mapping lives in one place (`fromTyped` in `app/cue.js`). A typed
command works with Co-GM on **or off** (you typed it on purpose) and at the night's cap (a parsed command costs $0). It is posted to the transcript as a line tagged `conn: 'typed'`
(speaker empty), so the quote check in `/act` reads it exactly as it reads a heard line, then it goes through the cue lane (a card, Undo, all as for speech). The poll skips typed
lines, so a command never runs twice and is never joined to the next spoken line.

**What happens.** A cue is parsed on the page at once, against the live table, and posted with `POST /act` mode `cue` (the page sends no key; the Worker makes it from the
cue line's row id, so two GM pages that hear the same cue act once and the other gets `seen`). A cut-off command ("Blade, make a six") waits for one more line, up to 6 s,
and joins it whatever its speaker label. Still cut off, it goes to the Worker without `parsed` and the hands seat reads it. At most one cue call every 2 s. A **Working...**
card shows at once; if there is no answer in 10 s it says **Didn't land: say it again** (the cue is never retried, because a retry would come back `seen`; a late answer is
still used). The result pops the 8 s strip, even with the panel closed.

**The cards.** Green: done, with Undo (a compare-and-swap: a clock or NPC that changed since is refused, and **Undo anyway** is offered), and Rename, Show players or Reveal
and show (each asks first). Yellow: the cue needs something, with a button for each answer (which clock, 4/6/8 segments, "No clock called X: make one?"), or a cue more than
60 s old when a hidden page comes back, with Do it. Grey: *Heard "Blade, ...": I can't do that yet.* (anything that would show the players something, or touch a sheet).
A yellow or grey card is never posted until you tap a button.

**Secrecy.** Everything a cue makes starts hidden (clocks `hidden: true`, NPCs `revealed: false`). A cue never reveals anything, never pushes to the iPad and never touches a
sheet: the only ways out are the Show players and Reveal and show buttons on a card, which ask first. Ticking a clock the players can already see moves it for them, as a
tap would (Undo covers it). Anyone at the table can say "Blade", so tell them: Blade only takes
orders from the GM, and a stray cue costs one tap of Undo.

## The Screen (the box's four buttons, `app/gm/assist-panel.js` and the cards `syncCards` makes in `app/gm-page.js`)

**GM-initiated, and nothing reaches the iPad until you tap Show.** Four buttons sit in the box under *Fit it*. Each makes one item that appears as an
idea card in the box (not the Rack) with a **Checking…** chip; the gatekeeper checks it automatically, and **Show** is disabled until the verdict is back.
A **Blocked** item shows its reasons (what it would reveal, which rule it breaks) and a **Not checked** one (the gatekeeper errored, refused, was
cut off, was busy twice, or the cap is reached) says so: Show then asks you to confirm. Your tap decides either way, and a confirm you refuse changes
nothing. Dismiss drops the card and sends nothing. On a phone the box is hidden and none of this runs.
- **Draw them** (`POST /api/gm/assist/portrait { name?, vocab }`; seat `portrait`, Sonnet 5.5, medium). Draws the NPC you just described from the last five
  minutes of talk (type a name in the box to say who). The page sends the figure kit's own names (`vocab`, built from the loaded kit) and the seat
  answers with a figure spec; the page runs it through `B68GmNpc.cleanSpec` (drops every name the kit does not know, stamps it, renders it, and
  strips props, patterns, hat and eyewear in turn on warnings) and draws the preview on its card. A drawing the kit still warns about is never offered.
  **Add (hidden NPC)** saves it through `POST /api/gm/assist/portrait-add`, which runs `checkNpc`/`writeNpc` with `revealed: false` forced on the
  server; showing it to the players is the normal reveal flow (stage it from the cast). A portrait has no Show button.
- **Make the prop** (`POST /api/gm/assist/prop { ask? }`; seat `prop`, Opus 5.5, medium, 8k output). A short in-world document (a case file, a telegram, a
  memo) from the moment, or from your one-line ask. Plain text of at most 1200 characters (a longer one is refused, never cut, so the gatekeeper
  reads all of it); **Show** sends it as an ordinary `text` display. The `svg` kind is not used: the gatekeeper reads text.
- **Wire** (`POST /api/gm/assist/wire`; seat `wire`, Sonnet 5.5, low). One in-world headline or bulletin of at most 240 characters. **Show on the wire**
  adds it to the ambient document's `wire` (at most six `{ id, text }`; `PATCH /api/gm/ambient { wire: [...] | null }`). The display lays the bulletins
  over whichever ambient scene is playing, one at a time (14 s on, 36 s off, round the list), in a strip in the ambient layer: a spotlight hides it,
  as does lights out, ambient off or a hidden page. A card in the box lists the wire as it stands on the iPad, each bulletin with a **Clear** button.
- **Case board** (`POST /api/gm/assist/board`; no seat, no model, no key, no spend, any tier). Built in code from the Mystery keeper's latest `known`
  and `theories` in tonight's log (what the players said aloud): the theory text only, never the seat's own `supported` verdict, its who or its
  `push_next`. It still goes through the gatekeeper before Show. Empty (no Mystery report yet) says so.

**The ladder.** Wire stops at 60% of tonight's cap, Portrait and Prop at 85%, all three at the cap (a 429; the box words a ladder cut-off as "the budget
has dropped that" and pauses nothing, and only the cap pauses the box). The Case board always builds. The gatekeeper runs to the cap like Ref, so at the
cap an item's check is "not checked". One model call of these runs at a time (429 busy). Every call logs `secs` and `stop` like the other seats; a refusal or
a cut-off is logged (`refusal: 1`, `truncated: 1`) and shows nothing. The Worker passes only the typed line, the kit's vocabulary (up to 5000 characters), the
last five minutes of talk and the item itself; the prefix stays a file id. Portrait's instructions ask for a static caption (no actions, never "you"): the
first live check let a narrated nod through, and the gatekeeper blocked it.

**The cite flag.** When a tick brings a Ref card with a page cite ("p. 12", "pp. 30-31"), the box checks it in the background through the gatekeeper
(`kind: card`, the card text and its rule, the cites). A cite the gatekeeper cannot match gets a small **cite?** flag on the card; it never blocks or
hides anything, and a check that cannot run (cap, busy, error) leaves no flag. Cards with no page cite cost nothing.

`node scripts/gm-assist-replay.mjs --transcript <note> --context <prefix file> --screen-at "portrait@20:17=Name,prop@21:23=ask,wire@22:10,board=a | b" --max-spend 2 --out gm-private/assist-replay/screen`
runs the Screen seats at chosen minutes with the endpoint's own turns, gates every item, and writes `screen.md` (the items and verdicts: it quotes the table,
so `--out` must sit under `gm-private/`), `screen.json`, `portrait-N.svg` and `summary.txt` (counts and money). `board=` takes the lines to build the board from.

## Ask Blade (the question field at the top of the box, `app/gm/assist-panel.js`)

**Type a question or a request mid-session and get an answer.** The field sits at the top of the box, above the cards. Enter asks (Shift+Enter is a new line;
the page's `A` key ignores typing in it, and Escape in it only leaves the field), and the answer appears under the field with the question beside it: "give
me an epilogue for the night", "pitch me three complications for this heist", "what would the faction boss do now?". **Keep** (a star) files
`Blade, ask (HH:MM): question -> answer` in the capture bar as a Moment (cut to the bar's 500 characters); **×** drops the answer. The last ten answers come
back after a reload. **GM's eyes only:** nothing here is sent to the iPad or the display, and nothing is gated, because nothing goes to the players. Because
you are the only reader, Blade may draw on hidden prep, and its instructions ask it to put anything from the never-reveal list in the **secret** field (shown as "(secret)" in the plain text) so it is
not read out by accident. A scene it writes frames the moment and ends on a question or choice for the players, and never decides what a player character
does, thinks or feels. New colour offered for ideas is labelled as new.

`POST /api/gm/assist/whois {}` -> `{ whois: { "<n>": { name, why } }, spend }` (GM only; the **Blade, guess** button in Who is who). Seat `whois`: Haiku 5.5, medium effort, 4k output, no cached prefix (it reads the
roster and the talk only, so it cannot leak prep), a JSON list of `{ speaker, name, why }`. It reads the last 120 lines of the newest connection (speaker numbers restart on every connection) and answers for unnamed numbers with at least 3 lines.
The Worker keeps an answer only when the number was asked about and the name is a player's name or the GM's from the assist part's `roster`: a name that is not on it is dropped, a name given to two numbers is dropped for both, and `why` is plain text of at most 80 characters.
A suggestion only: nothing is applied, and it is never written to the listening document (the table display can read that); a tap in the page is the ordinary `PATCH /api/gm/stt { speakers }`. Not a Core seat, so it stops at 85% of the cap (429 "cap reached"); one at a time and not within 10 s of the last guess (429).
The tick runs the same seat by itself (flag `tick`, 3-minute cooldown) once an unnamed number has 8 lines among the last 120, and adds the same `whois` to its answer. Each call is logged like any seat (seat `whois`, `shown: 0`). With no `roster` in the part there is no call: `{ whois: {}, warnings }`.
The roster is `{ players: { "<character>": "<player>" }, gm }` beside the file id in the pushed part: the players come from the same table as the prefix (`player:` on the PC notes, or `gm-private/players.json`), and the GM's own name from `"gm": "<name>"` in `gm-private/assist-config.json` (without it the players can be named but not the GM; `gm:pack` warns).

`POST /api/gm/assist/ask { q }` -> `{ answer: { q, at, kind, headline, bullets, say, secret, more, text } | null, spend }` (GM only; `q` is one line of at most 600 characters, else a 400 before the
database or the key are touched). Seat `ask`: Opus 5.5, medium effort, 8k output, a JSON schema (`kind` rule/say/idea/npc/recap/other, `headline`, `bullets`, `say`, `secret`, `more`) so a panel can fold it. The Worker clips each field in code (headline 90 characters, 5 bullets of 120, say 600, secret 300, more 900); `text` is their plain rendering (the secret marked "(secret)"), at most 4000 characters, and is what the history, `gm:after` and the restore path read. An old row without the fields comes back as `{ headline: text }`. It reads, after
the cached prefix: tonight's **story so far** (the Scribe's, so an epilogue knows the whole night), the **last 10 minutes** of talk, and the **last two
exchanges** of the last 45 minutes, leaving out any you dismissed (so "make it darker" works). The Worker passes only those; the prefix stays a file id. It runs to **85% of the night's cap**
like Portrait and Prop (the box greys the button; a 429 says the cap is reached or the ladder has dropped it), one at a time, with no cooldown. A refusal, a
cut-off or an empty reply gives `answer: null` and "Blade had nothing to say to that just now", and your question stays in the field. Every ask is logged (seat
`ask`, `q`, the kept text; the cost counts against the cap). **Cost:** the first ask of the hour (or after a quiet spell) writes the prefix cache
at twice the input rate, so a cold ask costs noticeably more than the next one, which reads it back. With the box off, no key, the cap reached or on a phone, the
console works exactly as it does without it.

## The cast photo and the lair (suite 3.8 and 5.4: `app/gm/castphoto.js`, `app/gm/lair.js`, `app/display/castphoto.js`, `app/display/lair.js`, `app/display/lair-draw.js`, `functions/_lib/show-castphoto.js`; switches `face.castphoto`, `between.lair`, both off by default)

- **Cast photo** (Menu, then Cast photo). One true-height line-up of an arc's recurring cast: every NPC tagged `recurring` or `major`, or the list you choose for the arc (a GM-scope row of the docs store, kind `castphoto`, owner = the arc's slug). Met NPCs are drawn and captioned; an NPC the crew has not met is a silhouette at their true height, captioned `?`. **Put it on the iPad** sends the `castphoto` show kind for three minutes (the overlay cap, 180 s). **Print (A4)** opens the print dialog for the arc's end. Secrecy: the server joins ids to revealed NPCs only; the rest travel as a bare list of heights in inches (`sil`), never an id, a name or a drawing.
- **The lair** (Menu, then The lair). The crew's base as map kit 1.0's section, drawn the same way on this screen and on the iPad. Layers come from the crew sheet every time: the base upgrades (Lounge and quarters, Van, Workshop, Vault, Secure, Hidden, Boat) each add a room or a face, each cohort a room on the first floor, each piece of flair a room in the attic; the other upgrades are named in the caption. The sheet has no flair field, so you type it here (docs row kind `lair`, owner `_`, scope gm; a `crew.flair` list is read when one exists). **Hold back** keeps a layer off the iPad. The map kit gained one line: a room may name its own `arch`, so a room the catalogue does not know is drawn furnished (no catalogue room has one, so every other map is byte for byte as before).
- **The iPad fetches the map kit only when a lair is first put up** (the `lair` bundle; the show kind is registered with `bundle: 'lair'`). Both kinds appear in the look book.
- **Idle.** An overlay is capped at 180 s, so neither stays up on its own: put it up again, or clear it. A lasting layer for the cast photo is the next step if the table wants it to idle.

## Pacing post-mortem and the distinctness linter

- **`npm run gm:pacing -- --night <file.json>`** prints actual against planned minutes per phase and per room from a saved copy of the night (`night.log` and the phase times); `--yes` files it under "## Pacing post-mortem" in the session note (`--session N`, `--force` to replace). A log line "Room: <name> (8m)" marks a room. It reads a file only: no network, no model.
- **`npm run check:cast-distinct`** renders every NPC at 64 px and warns on a silhouette overlap or the same outer colour plus hat. Warnings only. Check: `checks/runtime/gm-pacing.test.mjs`.
