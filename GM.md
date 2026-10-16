# GM tools: the API and the secrecy contract

The `#gm` page (the console with its Situations and Classic views, the location generator, street scenes and the engagement
roll) and the `#display` page (an iPad signed in as the GM) run on three GM-only endpoints. The generators' tables hold '68
text and GM-only secrets, so they never enter git: the GM builds a **pack** from the vault on their own PC (`npm run
gm:pack`, into the git-ignored `gm-private/`) and uploads it, from the browser or with `npm run gm:push -- --only pack
--yes` (see `SYNC.md`, which also moves what happened at the table back into the vault). Code: `functions/_lib/gm.js`,
`functions/api/gm/*.js`; tables in `migrations/0004_gm.sql`. The pack parts are `console`, `location`, `campaign`, `npc`,
`scenes`, `engagement`, `prep` and `screen` (the last two optional; `scripts/gm-pack.mjs` lists what each holds).

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
| `GET /api/gm/ambient` | `{ seq, doc, updatedAt }` (`0`, `{}`, `null` until written). GM only; the display sign-in is refused (it reads the doc through the display). |
| `PATCH /api/gm/ambient` | top-level merge (`null` deletes, `skip: true` bumps a counter) → `{ seq, doc, updatedAt }`. Keys: `mode` auto/pin/off, `scene`, `playlist` (1–16 distinct ids), `intervalMin` 3–30, `skip`, `crew { heat 0–9, wanted 0–4 }`, `score { name, district, target, reveal, view plan/rings, board, iso }` (both svgs through `checkSvg`; the server sets `at`). Stored doc at most 1.4 MiB, in `gm_ambient` (migration 0006). |

- **Pack.** Part names `[a-z0-9-]{1,32}`; at most 12 parts; `body` a JSON object (or a string holding one), at most
  900 KiB as JSON; `src` an object, at most 2 KiB. A part's `version` is the first 12 hex digits of the SHA-256 of
  `JSON.stringify(body)`; the pack's `version` hashes every part's name, version and src (`'0'` when empty). Stored in
  `gm_pack(campaign, part, version, src, updated_at /* ms */, body)`.
- **State.** The `campaigns` row `<CAMPAIGN>#gm` (beside the campaign document; `/api/campaign` never reads it). Patch
  and stored document at most 256 KiB each; optimistic `updated_at` check with retries, 409 when it keeps colliding.
- **Display.** `kind` is `blank`, `dark`, `svg`, `npc`, `text` or `rule`; other keys are dropped. `title`, `caption`,
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
  a side panel with **Prep (R)**, **Location (B)**, **Street (S)**, **Engage (E)**, **NPC (N)**, **Cards (O)**, **Screen (T)** and **iPad (I)** | the state rail (crew heat, wanted, rep, stacks and
  vault from the table, read only; table clocks; the pack's world clocks; bargains owed with **Collect**; pins; who is on
  stage) | the capture bar at the foot. 600–1100 px: two columns, the rail below. Phone: a Console | Prep | Location | Street | Engage |
  NPC | Cards | Screen | iPad | State bar, the Position switch at the top, the situations a 2 × 2 grid (Classic: 3 × 3), the other controls behind a "Scene" line,
  capture on a floating button.
- **The laptop layout** (>= 1100 px, 16/10/2026): the window is the page. The site header and footer give way to a slim top
  bar (the session, Saved, a stale-pack note, **iPad:** what the players see, **Listening** with whether the PC is copying,
  **Clear → ambient**, **Lights out**, **Display**, and a **Menu** with Export tonight's note, Update pack, the site's pages,
  **Classic layout** and Forget GM data). The three columns each scroll on their own and capture sits fixed at the foot, so a
  long Prep note or the GM screen never carries the console or the rail away. The side tabs are one row (Prep, Screen |
  Location, Street, Engage, NPC | Cards, iPad). Prep and Screen show their sections as an outline beside the text, the one
  being read marked. **Focus** (`F`, or the button by the tabs) shrinks the console to its keys on any tab (it replaces Prep's
  Wide, and shares its setting, `b68.gm.prepWide`). Empty rail boxes are one line. **Classic layout** in the menu brings back
  the old page on this device (`b68.gm.layout` = classic); **Laptop layout** in the old header returns. `body.gm-app` turns it
  on while the tools are open; loading and import screens keep the site header.
- **Table aids** (17/10/2026):
  - **Find** (`Ctrl+K`, `/`, or **Find** in the bar): one box over the open Prep note (its sections and transclusions),
    the GM screen, the pack's NPCs, PCs, factions and world clocks, the cast's NPCs made in the app, the table clocks,
    callbacks, and tonight's capture lines. Every word must match; title matches first. `↑` `↓` choose, `Enter` jumps
    (an NPC, PC or faction opens its peek card in the Prep tab; a capture or callback is copied), `Esc` shuts it.
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
- **Keys** (only on `#gm`; never while typing, never with Ctrl/Alt/Cmd but `Ctrl+K`): `1`–`4` roll a situation (Classic: `1`–`9` roll a single table), `R` `B` `N` `S` `E` `O` `T` `I` switch the panel, `F` Focus, `/` or `Ctrl+K` Find
  (Prep, Location, NPC, Street scene, Engagement, Cards, Screen, iPad), `P` `X` `M` open capture as Name / Loose end / Moment (Enter files, Esc leaves), `L` files
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
  status, dial, mannerism, verb), the levers, and the faction's dossier folded away. Above the button three pickers, each on
  **any** by default: **Faction** (or none, unaffiliated), **District**, and **Place** (the pack's `npc.T.place`, a vault table
  keyed by the location generator's building types: the profession comes from the place's `work` list; with the faction on
  any, about half the affiliated rolls come from its `factions`; with the district on any, its `districts` when it has them).
  An older pack without `T.place` shows no Place picker. **Use the location** (shown once there is a location card) copies that
  card's building, district and owning faction into the pickers, each one the NPC tables do not hold going back to any. With
  every picker on any the draws are the vault generator's, unchanged. A roll is a seed, the repeat-guard memory and the
  choices, so a reload or an Earlier click (five kept) redraws the same NPC and the same portrait. The portrait comes from
  `app/gm/figure-map.js` (an NPC's fields to a figure kit spec, with a built-in map while the vault's
  `Tools/blades-68-npc-figure-map.md` page does not exist); if the kit will not draw it, the nearest stock figure is used and
  the card says so. **Add to the cast** files the NPC as a hidden cast doc (tag `generated`, the look as the description, the
  play notes as GM notes) and stores the roll's seed and memory under `npcgen[<npc id>]` in the GM state, so `npm run gm:pull`
  can rebuild the vault card from it (`SYNC.md`). Pin and Copy work as on the other cards. Under it, the app's cast with
  portraits: **Show on iPad** (a hidden NPC asks first) and **Put on stage** (opens the NPC on the cast page, which stages it).
  A roll uses the pack's campaign part, not the live cast, so a freshly filed NPC is avoided by name only after the next
  pack build and push; that keeps the replay identical to the sync's. Code: `app/gm-page.js`, `app/gm/npc.js`,
  `app/gm/figure-map.js`, `scripts/lib/sync-npc.mjs`. Check: `checks/runtime/gm-npc-panel.e2e.mjs`.
- **Screen** (`T`; on a phone the Screen segment). The GM screen: the vault note with `gm_screen: true` under the '68
  folder, which `npm run gm:pack` cuts at its `##` headings into the pack's `screen` part (`scripts/lib/screen-export.mjs`;
  text before the first `##` is an intro shown above them; a `## Related`, `## Provenance` or `## Sources` heading ends
  the cut; wikilinks become plain text). Book text, so it travels only in the pack, never in git. Jump chips per section,
  **Find on the screen** filters the sections by their words, **Show on iPad** sends one section as a `rule` display
  (caption "GM screen"). Under it, the full rules search, as the Rules tab had. Checks: `checks/runtime/gm-screen.test.mjs`,
  `checks/runtime/gm-prep.e2e.mjs` (the Screen part, invented text).
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
    cast gets Show on iPad and Put on stage); another prep note opens it; anything else opens in Obsidian (`obsidian://open`);
  - **Pin** on a section keeps it, live, at the top of the rail (three at most, `prep.pins`); **Wide** hides the console (on a laptop, **Focus** shrinks it to its keys instead).
  The header says when the part was exported and warns after a day. Prep text never goes to the iPad or to players; edits are
  made in Obsidian and reach the page with the next pack build and push. Checks: `checks/runtime/gm-prep.test.mjs`,
  `checks/runtime/gm-prep.e2e.mjs` (`PREP_PACK=<pack>` to look at a real pack locally).
- **Cards** (`O`): the planning meeting's opportunity cards, typed straight onto the book's ruled index card (From, Client,
  Target, Type, a free line, Payout; From suggests the PCs and GM). Up to eight, reordered with the arrows. **Show on iPad**
  sends them as a carousel (display kind `cards`; the Turns setting makes it turn by itself, or a tap on the right turns it,
  on the left goes back); **Spread on iPad** lays them all out; **Show this one** sends a single card. GM state `opps`:
  `{ list: { id: { from, client, target, type, note, payout, order, at } }, interval }`. Only typed text goes out, and only
  on a Show button; the server keeps the six lines of each card (120 characters each) and nothing else.
- **State.** The GM state document holds `con` (the console state: `live` controls, `owed`, `struck`, `used`), `loc`
  (`ui`, `map`), `mem` (the repeat guards), `cards` (the current card per tool as `{ id, seed, ui, mem }`, `mem` a JSON
  string of the guard before the roll, and for the console `con`, a JSON string of the bargains and callbacks as they were,
  so a reload or an Earlier click redraws exactly the same card even after a callback was used or a bargain collected),
  `hist` (five per tool), `npc` (`ui`: the NPC pickers), `npcgen` (`{ seed, mem, at, s?, ui? }` per generated NPC id: the
  roll that made them, `ui` only when a picker was set), `pins` (50, text), `capture` (400: `{ id, bucket: n|x|m|r, text, at, s? }`),
  `prep` (`ticks`, `cells`, `beats`, `pins`: the Prep tab) and `opps` (the Cards panel). Capture never touches
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
| `board`, `exploded` | `planning-board`, `score-exploded` | The score scenes |
| `testcard` | `test-card` | Please stand by (pin only) |

The eight scenes from `boneyard` on are built by `tools/ambient/scenes/*.js` (see `tools/ambient/README.md`); their figures move now
and then (a few hard-cut frames: a drag on a cigarette, a glance, a sip). `tools/ambient/redress.js` re-dressed Booker in his suit in
`harvest`, `watch` and `duskwall` and gave Alfie his cigarette there.

- **Rotation.** Auto (default: every scene but the score scenes and the test card, in picker order, every 7 min, cross-faded), Pin (one
  scene), or Off. A playlist holds 1–16 scenes. A playlist the GM already saved keeps its scenes: tick the new ones in the panel. **Next scene** skips.
  A covered scene is kept for 30 s, then its frame is removed (a hidden frame gets no `visibilitychange` and would animate all night),
  and reloaded when the spotlight clears. A scene that has not loaded in 20 s is benched for 10 min.
- **Heat and wanted.** The GM page sends the campaign's crew heat and wanted (debounced 2 s) while the ambient is not off. The page
  has to have been opened as the GM in that page load; the iPad panel also corrects a stale value when it opens. The display passes
  them (`b68:crew`) to every scene with `needs: 'crew'` (`Pure.ambientCrewScenes()`: `watch`, `wanted`) when it loads and on each change.
- **Score scenes.** **Set as score scene** (Location panel, player layer only) renders the board (`plan`, board theme) and the exploded
  site (`iso`, blueprint) from the current roll at the revealed bands, through the same gate and hidden-name scan as Show on iPad.
  A plan that names a hidden room is redrawn as `rings`; a leaking iso is refused. Bands beyond public ask first. Only the place name and
  district go with it (`target` is always empty). It **never updates on its own**: press it again after revealing more. The shells
  (`planning-board`, `score-exploded`) hold no data; they post `b68:ready` and the display answers with `b68:score` (both svgs
  re-sanitised, four crew polaroids drawn with the figure kit, `Pure.POLAROIDS`).
- **Checks.** `check:ambient` (assets), `ambient-shells.test.mjs`, `check:display-ambient` (e2e), plus the ambient cases in
  `checks/api/gm.mjs`, `display-role.mjs`, `display.test.mjs`, `gm-page.test.mjs` and `gm-nosecrets.test.mjs`. The e2e checks take
  `PW_CHANNEL=msedge` when Playwright's own Chromium is not installed.
- **Deploy.** `npx wrangler d1 migrations apply DB --remote` (0006) before `wrangler deploy`. Before a deploy, build the calling cards
  on the deploying PC (`node tools/ambient/scenes/cards.js`, needs `tools/ambient/cards/*.jpg`): the file is gitignored, and the
  asset upload takes whatever is on disk. Without it the `cards` scene 404s and `check:ambient` prints SKIP.

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

## Listening: the table iPad's transcriber (`app/stt.js`, the iPad panel `I`)

The iPad sits in the middle of the table, so it hears everyone; it replaces the laptop's mic in Obsidian
(`Tools/blades-68-transcriber.md`, kept as the fallback). The path, and who holds what:

1. **Start listening** (iPad panel, `I`): GM state in `gm_stt` (`want: on`, the session number, speaker names).
2. **The iPad** (`#display`) polls `GET /api/gm/stt` every 4 s. While `want` is on and it is not listening, it shows
   **Tap to start listening**: iPad Safari opens the mic only on a tap. The page's `Permissions-Policy` allows the
   microphone for this origin only (`microphone=(self)`, `worker/app.js`).
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
but not read the transcript. The transcript is never in `/api/export`. Migration `0007_gm_stt.sql`. Checks:
`checks/runtime/stt.test.mjs`, `checks/runtime/gm-stt.e2e.mjs` (fake mic, fake Deepgram socket).

**Setup, once:** `npx wrangler secret put DEEPGRAM_API_KEY` (a key with Member permission or above), then
`npm run check:stt-live`. On the PC that goes to the table (it needs the repo, `npm install` and `npx wrangler login`,
not the Deepgram key), `npm run gm:transcript -- --install` writes a hidden launcher
(`b68-transcript.vbs`) into the Windows Startup folder and starts the copier; it starts at every sign-in after that.
`-- --uninstall` stops it and removes the launcher. It runs the repo's checked-out copy of the script.
