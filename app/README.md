# The page (`app/`)

The whole app as one static page with no build step: the character creator, the living
sheets, the table page, the schedule and the prints. It started as the single-page creator
prototype from `docs/history/PLAN.md` and is built on the Blades '68 Design System's figure kit 3. It
runs as a claude.ai artifact or on the hosted build (a Cloudflare Worker, see `HOSTING.md`);
storage, identity and downloads always go through `window.claude.use(...)`.

- `index.html` is the page: markup, theme tokens, the `@font-face` rules and the script
  order. It holds the header (wordmark, the view's name, Home · The table · Your sheet), Home
  (`#home`, with the "Characters" list and the backups), the creator studio and the crew line-up, the
  empty roots the modules render into (`#nextSession`, `#dossier`, `#table-page`, `#season`),
  the toast region, the restore preview dialog and, in the footer, the Auto / Paper / Night switch
  (an inline script at the top applies the saved choice before the first paint; CAMPAIGN.md, *Page*).
- `routes.js` says which files each route needs: index.html loads the core (the sheet, rules and cast every sheet uses),
  and `B68Load.need('table' | 'print' | 'gm' | 'display')` adds a route's bundle on first use, scripts in order. It also
  holds the build stamp (`B68_BUILD`, 'dev' in the repository; `npm run deploy` stamps it) that the service worker and
  `/api/me` share, which is how an open page knows to offer "Updated: reload".
- `content.js` is the rulebook's character creation content, transcribed from the
  Characters chapter and all twelve playbook sheets (eight core, plus Ghost/Echo, Vampire and
  the two Time Travelers).
- `core.js` holds state, the control factory and drawing; `steps.js` the sixteen creation
  steps; `boot.js` Home (the start page, drawn from the viewer's role, the table and their
  characters), the modes, hash routes and Back, the creator's draft, filing to the shared `characters` collection
  (field-level saves), the roster with its Cards / Table views, JSON backup and restore (the
  characters and the table's campaign document, with a preview before a restore writes; CAMPAIGN.md, *Backups*), the
  table and print modes, and the one subscription to the campaign document.
- `zoom.js` adds zoom and pan on the stage (wheel, drag, pinch, and a Face button that frames
  the head).
- `tracker.js` and `tracker.css` are the living character sheet: every track from the printed
  playbook sheet, action, resistance and fortune rolls, end of session and downtime, and a
  print stylesheet behind the Print button.
- `campaign.js` and `campaign.css` are the table page (`#t`): session bar, crew, shared
  clocks, players and the campaign log (`CAMPAIGN.md`). `crews.js` holds the six crew
  playbooks and `crewsheet.js` / `crewsheet.css` draw the full crew sheet on that page.
- `schedule.js` and `schedule.css` are the next-session card at the top of every mode and the
  schedule box on the table page: dates, the availability grid, the RSVP board, attendance,
  and the GM's copied reminder and date poll (`SCHEDULE.md`).
- `season.js` and `season.css` are the season print (`#print`): every filed character and the
  crew in one printable document, opened from "Print the season" on the table page.
- `cast-page.js` and `cast.css` are the cast (`#cast`, `#cast/<id>`, the GM's editor) and the "on stage" banner shown on every
  screen; `figures/npcs.js` holds the seven starting NPCs (`CAST.md`).
- `gm-page.js` and `gm.css` are the GM's page (`#gm`), and `display-page.js` and `display.css` the iPad's full-screen display
  (`#display`); both are hosted-build only (`GM.md`). `gm/` holds the pure logic behind them, one UMD module each, with no DOM,
  storage or table text (the tables arrive from the GM's pack): `console.js` (the console and its situations), `location.js`
  (the location generator and map data), `scenes.js` (street scenes), `score.js` (the score generator), `npc.js` with
  `figure-map.js` (the NPC generator and its figure map: the NPC tab on `#gm`, and the sync), `prep.js` (the Prep tab),
  `downtime.js` (the Downtime tab's cards), and `chase.js` (the Chase tab: what the map kit's chase strip is given, the clocks read back,
  and what the players may see of a chase). `downtime-tables.js` holds those cards' tables (`B68DowntimeTables`): original writing
  with no book text, public like `content.js`, and outside `gm/` because it names the setting; a pack part may be laid over them.
- `ambient/` holds the scenes the display plays when nothing is spotlit: four designer pages as delivered and two data-free
  score shells (`planning-board`, `score-exploded`) that draw what the display sends them. `_headers` lets only this origin frame
  them and blocks every network call from them (`GM.md`, "Ambient scenes").
- `runtime/cf.js` is the hosted build's `window.claude` adapter. It does nothing inside the
  artifact or from `file://`. `sw.js`, `manifest.webmanifest` and `icons/` make the hosted
  build installable and usable offline.
- `figures/` is the vendored figure kit and cast canon (figure kit 3.0.1), `maps/` the vendored map kit (0.7.1);
  `kits.json` records both (`npm run kits`; GM.md, "The kits"). `fonts/` holds the vendored fonts.
- `ui/`, `gm/kit/`, `display/kit/` and `sheet/kit/` are the kit and stage build: the shared UI kit (`B68Ui`, the tokens, `parts.json`) and what the GM page, the iPad and the phone sheet are rebuilt from, each behind one of five settings that start off ("The UI kit", below; `GM.md`, "The kit and stage").
- `CONTRACT.md` documents the character document, the `play` shape and the module APIs.
- `checks/` holds Playwright checks that stub the artifact runtime and open `../index.html`
  from `file://`: `e2e.js` walks Home → file → sheet → Back → Home's files → sheet, then each
  Home state (GM set-up, GM table, a new player, a returning player, read only, no runtime,
  the draft), `pn-e2e.js` creates each
  paranormal playbook, `trackerpn.js` exercises every sheet control, `trackercheck.js` the
  core sheet, `dice.js` the roll panel, `session.js` end of session and downtime, `table.js`
  the roster table and backups (both runtimes' formats, GM and player, the restore preview), `printcheck.js` renders the print PDFs, `campaign.js` the
  table page, `crewsheet.js` the crew sheet, `schedule.js` the schedule and `season.js` the
  season print. Run one with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node <name>.js`
  (from any directory); output goes to `checks/out/`, which is not committed.

Opened from `file://` the creator works, but there is no filing or saving. For the full app
run `npm run dev` at the repository root (see the root `README.md`).


## The UI kit (`app/ui/`) and the kit and stage build

The kit and stage build gave the app one set of parts and tokens, and rebuilt the GM page, the iPad and the phone sheet from them. All of it sits behind **five settings that start off** (`kit.desk`, `kit.stage`, `kit.phone`, `night.who`, `blade.pitches`). What each one does, and how to turn it on, is in `GM.md` ("The kit and stage: five settings"). This section is for whoever builds on it.

### What is where

- `ui/` is the shared kit: `tokens.css`, `parts.css`, `overlay.css`, `ui.js` (`B68Ui`), `overlay.js`, the manifest `parts.json`, and the desk's stylesheets (`desk-band.css`, `desk-roll.css`, `desk-blade.css`, `desk-run.css`, `desk-shell.css`, `desk-skin.css`, `desk-who.css`). `ui/kit-flag.js` (`B68Kit`) is the one kit file in the core bundle.
- `gm/kit/` is the desk's scripts (`band.js`, `roll.js`, `blade.js`, `run.js`, `shell.js`, `who.js`); `display/kit/` is the iPad's (`stage.js`, `band.js`, `roll.js`, `scene.js`, with their sheets); `sheet/kit/` is the phone's (`tabs.js`, `tabs.css`).
- `lookbook.html` and `lookbook-boot.js` draw every part from the manifest, Paper and Night side by side, desk or distance density (`lookbook.html#kit=night,distance`), with the stage's pieces.

### `B68Ui`: the contract

`B68Ui` (`ui/ui.js`) is the one helper every kit file builds markup with. Its contract is the comment block at the top of the file, and `kit-ui.test.mjs` holds the block, the manifest and the code to each other.

- **Parts.** `button`, `link`, `seg`, `tabs`, `chip`, `card`, `row`, `menu`, `field`, `meter`, `key`, `dot` and `bottombar`; the overlay kit (`ui/overlay.js`) adds `confirm`, `prompt`, `popover`, `openMenu`, `toast` and `tip`. Every part takes **one options object** (a string means `{ label }`) and returns **escaped markup**. There is no raw-markup option: nesting goes through descriptors and slots, and a label of `<img onerror>` comes out as text.
- **Hooks.** Every part also takes `id`, `cls` (the old class names to keep), `data` (`{ 'band-place': 'run' }` gives `data-band-place`), `attrs` (a short allow-list: `aria-*`, `role`, `name`, `value`, `tabindex`, ...), `title` and `hidden`. Anything else is dropped and reported once with `console.warn`. This is how new markup keeps every id, `data-*` hook and old class the old markup carried.
- **DOM nodes.** `B68Ui.node(name, opts, doc)` builds the same part with `createElement` and text nodes (no markup sink); the iPad uses it, because every server string there goes in as text. `B68Ui.fill(root, { slot: text })` sets slot text.
- **Behaviour helpers.** `wireTabs(root)` adds one delegated key listener per root (arrows, Home, End, roving tabindex; it never listens on Escape). `guardBusy(root)` cancels a click or Enter on an `aria-busy` button under that root.
- **Ranks.** A button is `primary`, `standard`, `quiet` or `danger`. One Primary per region; the hard shadow belongs to the Primary alone; PANIC is the one Danger on the GM page.
- **Scope.** The kit's tokens and parts apply under `:root[data-kit]` and inside any container carrying `data-ui-scope`, and nowhere else. A screen whose kit is off that still draws parts (`night.who`'s sheet, `blade.pitches`' cards) puts `data-ui-scope` on its root: the parts are then styled, Paper by default, and an old `.btn` outside it is never touched. Do not nest scopes.
- **Reading a label.** A button with a key hint draws `<span class="ui-label">Send</span><kbd data-ui-key="S">`: read the label from `.ui-label`.
- **Only `ui.js` builds a button tag** (it writes `'<' + tag`), so the ratchet can hold every other file at zero.

### `parts.json`

`ui/parts.json` is the manifest: for each part its name, function, class, variants, states, a **do** and a **don't**, and `examples` (a caption and the options that draw it). The look book draws the examples; a builder reads the manifest before writing markup, so no part is invented in place. The manifest is **mirrored inside `ui.js`** (`B68Ui.PARTS`) because `parts.json` is in no bundle (a bundle holds only `.js` and `.css`), so it is never fetched or precached; `kit-ui.test.mjs` keeps the two copies equal and checks that every part has a function, a class, do and don't text, and examples that draw in both themes and both densities. `app/kits.json` is a different file: the vendored map and figure kits.

### Tokens

`ui/tokens.css` defines the `--ui-*` tokens: surface, raised, sunk, ink (soft and faint), line, the one accent (orange), rules blue, alarm, ok, caution, the outcome colours (`--ui-out-*`, for outcomes alone) and the six faction colours; the type steps (label, body, lead, title, display), six space steps, two radii (`control` and `pill`), three motion times and the cut, and six named layers (`base`, `sticky`, `popover`, `dialog`, `toast`, `alarm`).

- **Themes are written once.** Every colour that changes with the theme is one `light-dark(<Paper>, <Night>)` line, and the theme is only `color-scheme`: the device's preference, a stored `data-theme` (`light` is Paper, `dark` is Night), or a local `data-ui-theme="paper"|"night"` on a container (the look book's columns, the iPad's own ground). Every colour is one the app already had (`kit-ui.test.mjs` checks it).
- **Density.** Pixels for the desk (the default); the iPad's own vmin steps for `data-density="distance"`, on `<html>` or any container.
- `app/tokens.css` (the older `--b68-*` tokens) must stay equal to `B68Tokens.vars()`: it is not edited by the kit.

### The layer rules

The kit's stylesheets are written so that a kit rule can never leak onto a screen that has the kit off, and so that they win over the old sheets without specificity tricks.

1. **Kit sheets are unlayered.** No `@layer`, no `!important`. **Every rule sits under `:root[data-kit~="desk"]` (or `stage`, `phone`), or on an own-prefix class that only kit markup carries** (`ui-*`, `kband-*`, `kr-*`, `kbl-*`, `kp-*`, `krv-*`, `kshell-*`, `who-*`, `ks15-*`, `ks16-*`), with the lightest selector that works and no `#gm-page` weight tricks. `ui/parts.css` and the token block use the zero-weight scope `:where(:root[data-kit], [data-ui-scope])`.
2. **The old sheets go into a layer while the kit is on.** The first time a page paints a kit token, `B68Load.layerOld()` (`routes.js`) turns each old `<link>` into `<style data-href>@import url(...) layer(old)</style>` in place, and wraps the inline block in `@layer old`. An unlayered kit rule beats a layered old rule at any specificity. With the kit off nothing changes, byte for byte. The page stays layered until it is reloaded, whatever is turned off meanwhile (the same look).
3. **Never edit an old sheet or the inline block to win the cascade.** Register every kit sheet in `routes.js` (`BUNDLES`, `CSS_ORDER`: the kit's sheets come after every old one) and let the loader load it.
4. **A kit rule may match an old class or a bare element only where a ticket says so** (the skin and trim of the panes the kit did not rebuild). Otherwise it targets `ui-*` markup.
5. **An old `!important` always wins**, even over a kit rule. To change what one guards (`[hidden]`, `display: none`), change the hook (an attribute or a class) in JS, not in CSS.
6. **Inline `style=""` and style text built in JS** (`zoom.js`, `sheet/claims.js`, `display/fx.js`) are unlayered. If a kit part must restyle one, that module emits its text inside `@layer old {}`.
7. With the kit on, the old sheets are `style[data-href]`, not `link`: a test that reads them selects `link[rel=stylesheet], style[data-href]`.
8. No character in U+0080 to U+009F in any stylesheet (mangled punctuation). The sizes the page reads in script (`--gm-bar-h`, `--dw-top`, `--as-top`, `--as-bot`) must still be set.

What holds these: `kit-ui.test.mjs` for `tokens.css` and `parts.css` (no `!important`, no `@layer`, every selector scoped), `kit-stage.e2e.mjs` and `kit-phone.e2e.mjs` for their sheets (every rule under their token), the ratchet for `!important` in every kit file, and `routes.js`'s own tests in `pwa.test.mjs`.

### The per-setting bundles: off means no new requests

`routes.js` has one bundle per setting, fetched only while that setting is on, so with every setting off a page fetches what it always did. Each brings `kit-ui` first (`DEPS`).

| Bundle | Files | Asked for by |
|---|---|---|
| `kit-ui` | `ui/tokens.css`, `parts.css`, `overlay.css`, `ui.js`, `overlay.js` | every other kit bundle |
| `kit-desk` | `ui/desk-*.css` (not `desk-who`), `gm/kit/band.js`, `roll.js`, `blade.js`, `run.js`, `shell.js` | the kit flag, when the `desk` token turns on |
| `kit-stage` | `display/kit/stage`, `band`, `roll`, `scene` (`.css` and `.js`) | the kit flag, for `stage` |
| `kit-phone` | `sheet/kit/tabs.css`, `tabs.js` | the kit flag, for `phone` |
| `night-who` | `ui/desk-who.css`, `gm/kit/who.js` | one `B68Load.need` line in `gm-page.js`, while `night.who` is on |
| `blade-pitches` | `gm/kit/blade.js` | one line in `gm-page.js`, while `blade.pitches` is on |
| `kit-lookbook` | `display/kit/*` | `lookbook-boot.js` |

`gm/kit/blade.js` is in two bundles (the desk's Blade panel and the pitch cards, which also show on the old desk); loaded twice, it starts once. The **one new request with every setting off is `ui/kit-flag.js`**, in the core bundle. `kit-flag.js` knows no setting ids: each route reads its own setting and hands over a yes or a no (`B68Kit.set('desk' | 'stage' | 'phone', on)`: `gm-page.js` on every draw, `display-page.js` on every poll, `tracker.js` on every sheet draw once the campaign has said). It sets `data-kit` on `<html>`, asks for the bundle, and keeps the tokens that are on in localStorage `b68.kit` (never written while every setting is off).

Rules for a kit file (`KIT-STANDING`, kept in the build's briefs, in short):

- **New code goes in new files.** `gm-page.js`, `display-page.js` and `tracker.js` get one-line branches only: setting on, call the kit file; off, the old code runs untouched. No handler is rewritten.
- **A kit file only defines its module when it loads, and reads other modules only when it is called** (a kit bundle can arrive before the route's own bundle). ES5 IIFE modules, `window.B68...` in the browser and `module.exports` under Node.
- **Hooks stay.** Every `id`, `data-*` attribute and old class stays on new markup. Keys stay: no new document-level Escape listener (everything that closes on Esc goes through `B68GmEsc`); a new key needs a line on the Shortcuts card.
- **No string literal over 220 characters** in `app/gm/**`, `gm-page.js`, `display-page.js` or `scripts/**` (`gm-nosecrets.test.mjs`). On the iPad every server string goes in with `textContent`, and the page makes no outside request.
- **Secrecy.** A hidden NPC, room, clock or GM-only line never reaches the display GET, a phone's GET or either DOM.
- **Motion.** Reduced motion means a cut; nothing moves on an idle screen; every timed overlay shows its timer and can be cleared.

### The ratchet (`checks/runtime/kit-ratchet.test.mjs`)

It counts five things the kit replaces, per file under `app/` (not `app/checks/`): a hand-built `<button`, an `!important`, an inline `style="`, a native `confirm(` and a native `prompt(`. Counts skip block comments (a string-aware strip, so `'audio/*'` does not open a fake comment). The baseline is `checks/runtime/kit-ratchet.baseline.json`.

- The check fails when **any count rises** anywhere (a file missing from the baseline counts as zero), and when a **kit file** (`app/ui/**`, or any file in a `kit/` folder) has **any** of the five. Later work may only lower the numbers.
- **It skips git-ignored files** under `app/` (`git ls-files --others --ignored --exclude-standard`): a generated file that is deployed from disk (such as `app/ambient/calling-cards.html`) is not source. Without git it counts everything on disk.
- `node checks/runtime/kit-ratchet.test.mjs --write` rewrites the baseline (sorted, so the same tree gives the same file) and **refuses when a count would rise**; `--write --allow-rise` is the override for a rise someone agreed. When a count has fallen the check says so: run `--write` to lock the gain in.

### The harness

The checks that prove the build, all run on the demo night (`npm run demo:night`; `-- --kit desk,stage,phone,who,pitches`, or `all`, turns settings on first, `none` writes all five off). They need Playwright: `PW_MODULE=<path to playwright>` (and `PW_CHANNEL=msedge` on Windows), and each is in `check:e2e-all`. Run browser checks one at a time.

- **`kit-off.e2e.mjs`: off means today.** Every demo-night scenario is run with the five settings written off and **fingerprinted** (`scripts/kit-fingerprint.mjs`: every element's id and classes exact, its box within 1 px, its computed styles equal), and held to a **baseline taken from Deploy 35** (`scripts/kit-baseline.mjs`: it checks that commit out in a worktree of its own, so the baseline cannot drift with the branch, and keeps it outside the repo; `KIT_BASELINE` names the folder; take it twice and `--compare` the two, they must agree). The requests each page makes are held to the baseline's too: any request the baseline did not make fails, except `ui/kit-flag.js`. The scenarios run at a fixed time of day, the harness's own clock, because the prep note's times would otherwise change the band by the hour. It also checks its own comparison (a button moved 3 px is one difference, an element gone is one), runs mutation tests on baseline copies (each must be caught), and runs the **mid-game round**: on a running page, each setting is turned on and off again from the Settings rows with no reload, then all five together, and the page must return to its all-off fingerprint, with `data-kit` and `b68.kit` back as they were. It skips, with a line saying so, when there is no baseline folder or no `PW_MODULE`. `KIT_OFF_SELF_ONLY=1` runs only the self-checks (seconds, no browser).
  - **The named exemptions** are `EXEMPTIONS` in `scripts/kit-fingerprint.mjs`, each with its reason and each printed: the five new Settings rows (by setting key, in `#gm-ipad-settings`), the Settings intro line (reworded), and the Preflight line that counts the files kept (the kit flag made it one bundle larger). Two narrower allowances are named in `kit-off.e2e.mjs` (`MID_REDRAW`: only a mid-game round that turned `kit.desk` off, only the Run view's elements that follow a lead heard in the meantime) and in `kit-fingerprint.mjs` (`MASKS`, `STATE_CLASSES`, `LIVE_SLOTS`, `LOOSE_AXES`: what time or chance decides; they let go of box and style, never of an element's existence, id or classes). The score scenes' polaroids are a disclosed difference that no exemption can name: they are drawn inside a scene's frame, which a fingerprint does not walk.
- **`kit-keys.e2e.mjs`: every key still works.** It reads the Shortcuts card's own rows (`app/gm/shortcuts.js`) and, for each key, in a fresh GM page of the demo night, sets the context the key needs, takes a snapshot, presses it, and keeps what changed: on the page (ids shown or hidden, aria and data states, where focus went, the hash, a toast's words) and on the server (what the GM state, the iPad's ambient document, the display and the campaign gained, lost or changed). It runs twice, with the five settings off and then all five on, and passes when (1) with the kit off every key was pressed and raised no page error, (2) every key but the few in `NO_EFFECT_OK` did something, and (3) the same key did the same thing with the kit on: the same server effect, the same writes while the page loads, the same page effect for every element both pages have. **A kit-off effect on an element the kit-on page does not have at all is a failure** (the hooks rule); new kit-only markup is a note. A **class check** also runs: every class a kit-off element carried must be on its kit-on counterpart. `KIT_KEYS_SELF_ONLY=1` runs only the comparison's self-checks; `KIT_KEYS_ONLY=<key labels>` presses some keys.
  - **The named exemptions** are `KEYS_EXEMPT` (and `CLASS_EXEMPT` for a class retired on purpose) in the file, each with its name, its reason and the PR that made the change, each printed with the hits that used it. Today: the Roll's pinned stamp line stays visible after leaving the Score; the right-edge Blade tab, the Now zone and the Screen section are put away (for `A` and `Shift+A`); the polaroid list is written when a session opens (`night.who`); the iPad band's faces layer is written on load and taken down by Esc and `0` (`kit.stage`); a place's first view skips the four put-away views, and those views' tabs come and go as one opens (`kit.desk`); a beat step in the Run view's one-room inspector has no second room card to toggle Heard in; and, as classes, the Roll's Position, Effect, Who, They rolled and Fit controls lose their old presentation classes. Nothing else is forgiven: a toast, the focus and the hash never are.
- **`kit-accept.e2e.mjs`: the acceptance numbers.** Measured in a real browser on the demo night: boxed controls on the Run view at 1366 x 768 (target 25 or fewer), the smallest text on the GM page (12 px or more), Blade cards visible at once (4 or more), and on the iPad the text's share of the screen height (3.3% or more) and the lowest text contrast (4.5:1 or more). It **reports** the numbers and passes if every page could be measured; `KIT_ACCEPT_HARD=1` turns the targets into failures; `KIT_ACCEPT_KIT=desk,stage,...` starts the demo night with those settings on, so a bundle can see its own numbers.
- **One suite per bundle**, each on its own ports (9400 to 9416 are the build's): `kit-band`, `kit-roll`, `kit-blade`, `kit-run`, `kit-shell`, `kit-skin` (a stub until the skin lands), `kit-stage`, `kit-stage-band`, `kit-stage-roll`, `kit-stage-scene`, `kit-phone`, `kit-pitch`, `night-who` and `night-roster`; and, with no browser, `kit-flag`, `kit-ui`, `kit-ratchet`, `kit-overlay`, `night-who.test`, `assist-pitch` and `kit-stage-roll.test`, all in `check:runtime`.

### How to add

- **A part.** Add its function to `ui/ui.js` and an entry to `PARTS` there **and** to `ui/parts.json` (same text: `kit-ui.test.mjs` fails if they differ): `name`, `fn`, `class`, `variants`, `states`, `do`, `dont` and at least one example. Style it in `ui/parts.css` under `:where(:root[data-kit], [data-ui-scope]) .ui-<name>`, from the tokens, with no `!important` and a `.ui-*` class. Give it a line in the contract block at the top of `ui.js` (a test checks the block names every part), build it as a node too if the iPad will use it, and the look book will draw it from the manifest. If a part you need is missing, add it to the kit first; never invent a one-off look in place.
- **A setting.** Add a line to `features.js` (`setting: true`, `default: false`, `saturday: 'off'`, a `doc` sentence) and a row to `ROWS` in `gm/settings.js` (two options, and the words said when it changes); add its short name to `KIT_SHORT` and its id to `KIT_SETTING_KEYS` in `scripts/kit-fingerprint.mjs` (the demo night's `--kit`, kit-off's exempt row and its mid-game rounds); register its bundle in `routes.js` (`BUNDLES`, `DEPS`, `CSS_ORDER`, one `B68Load.need` line or a kit-flag token) and its tests in `check:runtime` and `checks/e2e-all.mjs`; update the pins in `features.test.mjs`, `pwa.test.mjs` and `techrun-r2.test.mjs`. A route token (`desk`, `stage`, `phone`) also goes in `ui/kit-flag.js` (`NAMES` and `routeOf`) and the route calls `B68Kit.set`. With the setting off, nothing it adds may load, draw, request or store: `kit-off` will say so.
- **An exemption.** Only for a difference the build means to make, and only with its reason and the PR that makes it. For `kit-off`, add an entry to `EXEMPTIONS` in `scripts/kit-fingerprint.mjs` (`name`, `reason`, and one of `selector`, `text` or `keys`). For `kit-keys`, add an entry to `KEYS_EXEMPT` (`name`, `reason`, a `hit` pattern on the key's label, and what is let go: `off` for page lines only the kit-off page has, `on` for page lines only the kit-on page has, `loadOn` for writes only the kit-on page makes while it loads, `serverOn` for writes only the kit-on page makes on that key's press; several parts go in `parts`), or to `CLASS_EXEMPT` for a retired class; the file's self-checks must show the exemption lets only its own lines go. Keep it as narrow as the difference: a toast, the focus and the hash are never forgiven.
