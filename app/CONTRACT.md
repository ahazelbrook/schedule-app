# Creator v2 contract (read before editing anything)

Three modules are being built in parallel. Each owns its own files. Do not edit files you do not own.

| Module | Owns | Globals it defines |
|---|---|---|
| zoom | `zoom.js` (new) | `window.B68Zoom` |
| tracker (the living character sheet) | `tracker.js`, `tracker.css` (new) | `window.B68Tracker` |
| filing (boot/steps/markup) | `boot.js`, `steps.js`, `index.html` | `window.B68` additions |

Script order in index.html (already set; MS2 moved figure-kit.js and cast.js out into the `figures` bundle that B68Load fetches after the first render, so index.html now starts at content.js): figure-kit.js, cast.js, content.js, core.js, **zoom.js**, steps.js, **tracker.js**, boot.js. (Later rounds added modules; the order today is content.js, core.js, zoom.js, steps.js, tracker.js, schedule.js, campaign.js, crews.js, crewsheet.js, season.js, runtime/cf.js, boot.js.) `tracker.css` is linked in the head. The page has a `<section id="dossier" hidden>` placed before `main.studio`; it is the tracker's render root. `body[data-mode="sheet"]` hides `.studio` and `.crew` and shows `#dossier` (CSS for that lives in index.html, owned by filing).

Existing globals: `window.B68Figure` (kit, `K`), `window.B68Cast`, `window.B68Content` (`CT`: PLAYBOOKS, byId, ACTIONS = [[attr, [actions]]...], STANDARD_ITEMS = [[name, load]...], VICES, LOOK...), `window.B68` (`A`: S {spec, sheet, step, view, dirty}, helpers `$ el esc clone slug feet toast pbOf renderSpec draw drawLineup showStep blankSheet validate sheetMarkdown dotsTotal attrRating loadTotal`). Read core.js, steps.js, content.js and boot.js for the details; they are short.

## The character document

Collection `characters` in the artifact db (`claude.use('db')`). Doc id: `slug(name) + '-' + Date.now().toString(36)`.

```js
{
  v: 2,
  name, alias, code,            // strings
  playbook: 'hound',            // playbook id (CT.byId key)
  playbookName: 'Hound',
  spec: {...},                  // figure spec (kit v2)
  sheet: {...},                 // the creator's creation-time choices (A.S.sheet shape, see core.js blankSheet)
  play: {...},                  // the living sheet, owned by tracker.js (shape below)
  owner: 'u_...' | null,        // user id from claude.use('user').id(); null when unknown
  createdAt: ISO, updatedAt: ISO
}
```

### `play` — the living sheet (tracker owns the shape; filing only calls `B68Tracker.initialPlay`)

```js
{
  stress: 0,                    // 0..9 (Hull: drain 0..10)
  xp: { playbook: 0, insight: 0, prowess: 0, resolve: 0 },   // caps 8 / 6 / 6 / 6
  dots: { Hunt: 1, ... },       // current action ratings, 0..4; seeded from sheet.dots
  abilities: ['Hound’s Instincts'],  // names owned now (sheet ability + fixed ones); advances add more; custom strings allowed
  abilityTicks: { 'Echo Pet': 1 },   // for abilities with more than one circle
  keys: [ { name: 'Sardonic', down: 'Grim', up: 'Witty', hits: 0, deadlock: null | 'down' | 'up' } ],  // up to 4; Veteran starts with one deadlocked
  harm: { l1: ['', ''], l2: ['', ''], l3: '', l4: '' },      // text per box, '' = empty
  healing: 0,                   // 0..4 clock
  armor: { armor: false, heavy: false },   // armor boxes used this score
  resource: [false, false],     // the playbook special resource (tenacity / training / research...) two boxes
  stacks: 0, bank: 0,           // 0..4, 0..40
  items: ['Binoculars'],        // carried this score (checked boxes)
  loadLimit: 'quiet' | 'loud',  // 3 / 6
  cohort: { name: '', type: '', edges: '', flaws: '', abilities: '', harm: null | 'weak' | 'impaired' | 'broken', armor: false },
  contacts: { 'Vanden, a lazy Bluecoat': 'friend' | 'rival' },
  vice: '', purveyor: '',
  clocks: [ { name: 'Long-term project', size: 4|6|8, filled: 0 } ],
  memories: [ { name: '', size: 8, filled: 0 } ],   // Hull only
  notes: '',
  log: [ { at: ISO, text: 'Session 3: ...' } ]
}
```

### Tracker API (`window.B68Tracker`)

```js
B68Tracker.initialPlay(sheet, playbookId)   // -> play, derived from the creation choices; pure, no DOM
B68Tracker.open(doc, api)                   // render the sheet for doc {id, ...fields} into #dossier
B68Tracker.update(doc)                      // a newer snapshot of the same doc arrived (another viewer changed it): re-render without losing focus in a text field being edited
B68Tracker.close()                          // clear #dossier
B68Tracker.isOpen()                         // bool
B68Tracker.play()                           // a copy of the open sheet's play, or null (added later)
B68Tracker.renderStatic(root, doc)          // a read-only, listener-free copy of a sheet in another root (the season print; added later)
B68Tracker.refresh()                        // something the sheet reads outside its doc changed (api.table): re-render, keeping focus and the status line (added later)
// api = {
//   save(patch) -> Promise          // shallow-merge patch into the doc: patch is { play: {...whole play...} } or { name, alias, ... }; filing writes updatedAt
//                                   //   (filing sends only the changed play fields as an update, falling back to a whole set)
//   edit()                          // load this character into the creator (filing switches mode)
//   back()                          // the previous view in this tab (history.back()), else Home; the button reads "← Back"
//   remove() -> Promise             // delete (after the tracker's own confirm; offered to the owner and the GM, B68.isGM)
//   me: 'u_..' | null,              // viewer id
//   canWrite: true | false | null   // null = unknown, keep controls enabled and let a refused save decide. Per document, read on
//                                   //   every check (boot passes a getter): false when the viewer cannot write at all, or is a
//                                   //   player and doc.owner is someone else; the GM, the owner and an unowned doc get the viewer's
//                                   //   global value. On someone else's sheet the status reads "Read only · Sam’s character".
//   profiles(ids) -> Promise<{ id: name }> | null   // optional: names the owner in that status ("another player" without it)
//   screen: { seq() -> n, load() -> Promise<answer>, on(cb) -> unsubscribe } | null
//                                   // optional (MM1): the phones' copy of the iPad's map or handout (the hosted runtime's window.claude.table).
//                                   //   null (the artifact, file://) draws no Table button. seq() is the data poll's screenSeq (0: nothing to show);
//                                   //   load() is GET /api/table/screen; on(cb) hears every change of seq. The sheet's Table button carries a dot while
//                                   //   seq() is a number this phone has not looked at (localStorage `b68.table.seen`), and opens a full-screen viewer.
//   table() -> { session, inPlay } | null           // optional: the table's session (campaign/main, CAMPAIGN.md): session = session.number,
//                                   //   inPlay = started and not ended; null when there is no started table (no db, no document, or the
//                                   //   hosted default that was never written). Boot calls B68Tracker.refresh() whenever it changes.
//   crewAbilities() -> [{ name, text }] | null      // optional: the crew's taken special abilities, for the roll panel's abilities strip
//                                   //   (display only). null = not known yet (no table, or crews.js still loading); [] = none taken.
// }
```

Saving, in the tracker (no shape change): typing waits 400 ms but is sent at once on `pagehide` and on `visibilitychange` to
hidden; a snapshot (`update`) that arrives while a save is in flight or typing waits is held and merged once everything has
landed (a field this sheet changed meanwhile keeps its value, every other field takes the snapshot's); a save the store
refuses (a 4xx other than 401 / 408 / 409 / 429) puts the sheet back to the store's copy once everything has landed, with
"Not saved (reason): undone"; `play.log` keeps the newest 200 entries.

With `api.table()` the sheet follows the table instead of its own counter: a bar under the header reads "Table: session N ·
in play" (or "· ended"), and when the table is ahead of `play.session` it carries the one primary **Join session N**, which
sets `play.session = N` and runs the Start session logic (clears `trainedThisDowntime` and `keyHitSession`, logs `Session N
started`). End of session closes the table's session N (and sets `play.session = N` when the sheet was elsewhere). The manual
"Start session N+1" button exists only when `table()` is missing or returns null; at table session 0 End session waits for the GM.

The sheet's title is the character's name; the playbook and its descriptor sit small under it. Box titles are `h3.ds-bt`
inside `.ds-band`. On phones (screen ≤ 760px) the boxes leave their columns and run Stress, Harm, Actions, XP, Items (what is
carried; the rest of the list behind "Edit loadout"), Downtime, Session, Keys, Stacks, then the rest; the Figure box gives way to a
mugshot thumbnail beside the name (`img.ds-thumb`, a data URI, so its SVG ids never meet the Figure box's). The figure is drawn
only where it is shown (a desk's Figure box, and the print slot on `beforeprint`), and the figure and thumbnail nodes are carried
from one render to the next, so a tap does not rebuild them. On the live sheet (`#dossier.ds-live`; a season copy is `ds-static`)
the identity folds into a closed "About" row and a sticky bar holds ← Back, the status, Print, "…" (Edit figure, and Remove at its
foot) and the vitals "Stress 6/9 · Harm 1 · XP 3/8 · Load 2/3", each a jump to its box. Remove is never in the button row: it is
under "…" on every screen, for the character's owner and the GM only, behind a confirm that names the character. Pips, xp
boxes, diamonds and × get invisible `::before` hit areas (44px tall where the row has room, as wide as their pitch so
neighbours never take each other's taps), the other play controls are at least 40px tall on touch, fields are 16px, and each
action's button is 44px tall. Print is unchanged by all of this (the phone rules are `screen` only).
The status line reads the hosted runtime's queue: "Saved on this phone · will sync (N)" while `window.B68Runtime.status.pending`
is N > 0 (it follows the `b68:runtime` event), "Saved" once nothing waits. Harm, Armor, Load, Position / Effect, Resist and XP
carry a "?" rules link, like Stress, where the rules API exists.

### Filing API (`window.B68` additions, boot.js)

```js
A.setMode('create' | 'sheet')     // toggles body[data-mode]; closes the tracker when leaving sheet mode
A.openCharacter(docId)            // subscribes to characters/<id> and opens the tracker; sets location.hash = '#c/' + id
A.fileCharacter()                 // create or update (S.sheet.docId) the doc; then openCharacter(id)
// added in later rounds:
A.setMode('table' | 'print')      // the table page (CAMPAIGN.md) and the season print
A.openTable()  A.openPrint()      // switch mode and set the hash
A.setMode('home')                 // the start page (#home): who you are decides what it offers; it holds the files and backups
A.goHome()                        // Home, as a new history entry
A.updateCharacter(id, patch)      // write another character's play fields through the same delta path (crew advance)
```

Hash routes: no hash = Home; `#new` a blank creator (asks first when an unfiled draft is there, then becomes `#create`);
`#create` the creator as it is; `#s<base64url>` loads a shared character into the creator; `#c/<docId>` opens a sheet;
`#t` the table page; `#t/schedule` the table scrolled to its schedule box (`#tp-schedule`, or `.tp-schedbox`); `#print`
the season print.

Navigation: every mode switch pushes one history entry (`A.setMode(m)` sets the mode's hash; a hash change routes back
into the same modes without pushing again). Each entry the page makes carries `history.state = { b68: depth }`, depth 0
being the entry the visit started on. Back (the sheet's `api.back`, the print's Back) is `history.back()` when the previous
entry is the app's (depth > 0), else Home replacing the current entry. The header shows the view's name under the
wordmark (which links Home), sets `document.title`, and moves focus to that name on each switch; the nav is Home · The
table · Your sheet (the last only when the viewer owns exactly one character).

Drafts: without `claude.hot` the creator's unfiled character (a playbook chosen, no `docId`) is kept in localStorage
`b68.draft` as `{ v: 1, spec, sheet, step, dirty, at }` (written 400 ms after the last change; cleared on filing, a new
character or Discard) and restored on load; Home offers it as "Continue your draft".

## House rules to respect
- Hard mode: a deadlock is permanent. Show it as such; no "clear deadlock" control beyond an admin-ish undo with confirm.
- Hull: Drain (10) instead of Stress; no keys, no vice, memory clocks instead; built-in armor; cannot bank without "A Room of Your Own".
- Veteran: Military Discipline fixed; one key starts deadlocked; 8 dots. Hull: Automaton fixed; 6 dots.
- Stacks replace coin; one stack = one load slot when carried.
- Printed tracks: stress 9; playbook xp 8; attribute xp 6 each; stacks 4; bank 40 (4 rows of 10); harm 4 Mortal / 3 Critical / 2 Major ×2 / 1 Passing ×2; healing clock 4; resources Armor 1 + special resource 2; keys 4 rows each with 3 hit pips and a deadlock burst; cohort Weak / Impaired / Broken / Armor; items: load 3 quiet / 6 loud.
- Advancement: 8 playbook xp -> a new special ability (or tick on multi-circle ability); 6 attribute xp -> +1 dot in that attribute's actions (max 3, Mastery 4).

## Design
Paper/night themes, tokens in index.html `:root`. Fonts: Archivo Compressed (display, `--font-display`), Archivo Condensed (`--font-cond`), GT America (`--font-body`), Space Mono (`--font-mono`). Reuse the existing classes where sensible: `.btn .btn.sm .btn.primary .chip .chip.txt .label .hint .field .row .seg .mono .stamp`. Rulebook feel: boxes, pips, diamonds, orange accent `var(--accent)`, rules `var(--rule)`. Phone width must work (16px gutters, no horizontal scroll).

## Checking
`node --check file.js` for syntax. Headless render: Playwright at `/opt/node-tools/node_modules/playwright`, Chromium already installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); the scripts in `checks/` (for example `checks/e2e.js`) open `file://.../app/index.html` with a stubbed `window.claude`, collect console errors and take screenshots into `checks/out/`. The fonts are vendored in `fonts/`, so they load on file:// too. Without a stub, `window.claude` does not exist on file:// (`runtime/cf.js` stays off there), so db/user/downloads resolve to nothing: your code must still work (hide or disable, never throw).

---

# Round 3: paranormal playbooks + printable sheet (read this whole section)

`content.js` now carries `CT.PARANORMAL` (four records, also in `CT.byId`): `ghost`, `vampire`, `timetraveler` (era `future`), `timepast` (era `past`). `CT.LOCKED` is now `[]`. `CT.GENERIC_KEYS` is the 15-key list printed on the Ghost sheet (used by all four). Read the four records in content.js before coding: every flag below is on them.

Record flags: `paranormal: true`; one of `ghost: true` / `vampire: true` / `timetraveler: true` (+ `era`); `section: "Paranormal playbook"`; `subtitle` (Time Traveler only: "From the future" / "From the past"); `stressName` ("Drain" / "Stress" / "Instability") and `stressMax` (10 / 12 / 9); `need` (the rule text that replaces vice); `fixedAbility` (always owned, like Military Discipline); `abilities` (a third element `3` on Versatile = three circles); `xpTriggers` (end-of-session list for the sheet); `dots` is the TOTAL dots including `printed` (ghost 7, vampire 9, time traveler 9 with no printed dots and max 3 per action at creation); `resource: null` (no special resource row: Armor + two blank boxes); `friendsNeeded` (ghost 0, vampire 2, TT 0); `contacts` (vampire: dark servants, label `contactsLabel`); `items` playbook list (ghost: none, `itemsRule` free text).
- Ghost: `deadlockName: "Echo irregularity"`, `deadlocks` list of six. Keys are struck out with an irregularity instead of a deadlock. No vice, no friends, no bank restriction (stacks + bank exist), no load limit (free text items). "Enemies & Rivals" free text.
- Vampire: `deadlocksMaxed: true`, `keysNeeded: 4` (all four keys start deadlocked, direction chosen per key), `strictures` (six, `[name, text]`, Dayfire always on), `stricturesRule`, `maxDot: 5` (Dark Majesty: one attribute's actions may reach 5), `echoAbilitiesRule`. Stress 12; feeding is the vice (clear Stress by the highest die, +4 healing ticks).
- Time Traveler: `glitches` (six temporal glitches), `alluvium: { start: 4, max: 9 }`, `alluviumName` ("canister" / "vial"), `bank: false` (stacks only, no bank), `missions` (two, each `{ name, text, questions[4] }`), `dotsRule`, `advance` text. Instability 9; restabilize clears 5 and uses one alluvium. Four glitches = gone after the next score.

## Sheet fields the creator writes (filing/steps owns; tracker reads them in `initialPlay`)
Common to all four: `playbook`, `name`, `alias`, `heritage`, `heritageDetail`, `background`, `backgroundDetail`, `dots`, `ability` (one chosen trait beyond the fixed one; `customAbility` for Versatile text), `keys[]` (strings from `GENERIC_KEYS`) + `customKey`, `items[]`, `look`, `wearing`, `wearingNote`.
- ghost: `ghostItems` (string), `enemies` (string). No `vice`/`purveyor`, no `contacts`.
- vampire: exactly 4 keys (incl. customKey); `keyLocks: { [keyString]: 'down' | 'up' }` (which way each starts deadlocked); `stricture` (one stricture name beyond Dayfire, chosen because the creation trait is a new vampiric trait; omit when the trait is Versatile); `contacts` (dark servants: 2 friends required, rivals allowed); `feeding`, `telltale`, `echoAbilities` (strings). No `vice`/`purveyor`.
- timetraveler / timepast: `mission` (mission name), `missionAnswers: ['', '', '', '']`; 2–4 keys; no `contacts`, no `vice`.

## `play` additions (tracker owns; `initialPlay` seeds them)
- `stress` is reused for Drain / Instability with max `pb.stressMax`; label `pb.stressName`. Vampire stress max 12.
- `keys[]`: `{ name, down, up, hits, deadlock: null | 'down' | 'up', glitch: null | string }`. Ghost and Time Traveler never set `deadlock`; they set `glitch` (an echo irregularity / temporal glitch name) which strikes the key out. Vampire keys start with `deadlock` set from `sheet.keyLocks`.
- `alluvium: 4` (Time Traveler, 0..9). `strictures: ['Dayfire', ...]` (Vampire). `darkMajesty: null | 'Insight' | 'Prowess' | 'Resolve'`.
- `mission: { name, answers: [4 strings], details: [strings] }` (Time Traveler; a detail is added on each glitch).
- `ghostItems`, `enemies` (Ghost strings); `feeding`, `telltale`, `echoAbilities` (Vampire strings). All editable on the living sheet.
- `bank` stays 0 and hidden for Time Traveler.

## Printing (tracker owns)
`tracker.css` gets an `@media print` block that prints `#dossier` alone on white, letter/A4 portrait, no buttons, and a "Print" button in the sheet header calls `window.print()`. `index.html` already hides `.studio .crew .roster .rail` in sheet mode; the print block only needs to hide `#rail`, `header`, `.btn` and the mugshot toggle, and make the figure column small.

## Figure looks (core.js, filing owns)
`A.LOOKS` needs entries for `ghost`, `vampire`, `timetraveler`, `timepast`. Ghost figures render with `.ghostly` on `#art` / lineup / roster thumbs (CSS in index.html: `opacity:.72; filter: blur(.35px) saturate(1.4)`) so the vapour reads.

---

# Round 4: dice at the table, the GM table view, backups

Ownership as before: tracker = `tracker.js`, `tracker.css`; filing = `boot.js`, `steps.js`, `index.html`. Nobody edits content.js / core.js / zoom.js this round.

## Dice (tracker)
Forged in the Dark rules, assumed standard: action roll = d6 per action dot (0 dots: roll 2d6 and take the LOWEST); +1d for pushing yourself (costs 2 Stress, or Drain / Instability for the variant playbooks), +1d for an assist, +1d for a Devil's Bargain; read the single highest die: 6 success, 4–5 partial, 1–3 failure, two or more 6s a critical. Position controlled / risky / desperate; a desperate roll marks 1 xp in the action's attribute. Resistance roll = d6 per attribute rating (count of actions rated 1+ in that attribute; 0 → 2d take lowest), Stress cost = 6 − highest die, a critical clears 1 Stress instead. Fortune roll = any number of dice, same reading. Vampire Dark Majesty +1 resistance dot in that attribute applies to resistance rolls.
`play.log[]` entries gain an optional `kind: 'roll' | 'note'` and rolls are logged as `{ at, kind: 'roll', text: 'Skirmish 3d (push) · risky · 6,4,2 → success' }`. `window.B68Tracker._rng` may be replaced by tests with a deterministic function returning 0..1.
(Later: the table rolls physical dice. Tapping an action opens the **mark strip**: "Skirmish · 2d", Push / Assist / Bargain (+1d each; Push marks its 2 Stress at once and gives it back when untapped; an assist is paid by the helper on their own sheet), then Resist · Harm 1 · Harm 2 · Harm 3 · +1 Stress. Resist opens a helper: the attribute (the action's by default), its dice, and the player taps the highest die (or two sixes); the cost is applied and logged as the in-app resistance roll logs it (`Resist Prowess 2d · 4 → 2 Stress`). The in-app roll is behind "Roll in the app"; after a roll its options are locked and the button reads "Roll again (pays again)" when the roll pushed. On phones the strip and the roll panels are bottom sheets standing on the on-stage banner (`--cp-stage-h`). No `play` field changed.)

## GM table and backups (filing)
`A.roster` (array of docs, as subscribed today) stays the source. The "Your files" section gets a view toggle Cards / Table; the table has one row per character with name, playbook, stress label and value (pb.stressName), worst harm text, healing, playbook xp, load, struck keys count, updatedAt; clicking a row opens the sheet. Backup: "Download all (JSON)" writes `{ v: 1, exportedAt, characters: [docs] }` through the downloads capability (hidden when unavailable); "Restore (JSON)" takes a file input and files each character as a NEW doc (new id, owner = me, createdAt now) so nothing is overwritten. (Later: the file also carries the table's campaign document as `campaign`, a player's copy without hidden clocks; Restore also reads the hosted `/api/export` file and restores the campaign document for the GM only, after a confirm; the hosted GM gets "Download everything". See CAMPAIGN.md, *Backups*.)

---

# Round 5: end of session and downtime (tracker)

Tracker owns `tracker.js`, `tracker.css`, `checks/session.js`. Both new boxes sit in column 2 after the XP box, are table tools (hidden in print), and open inline panels in the roll panel's style; only one panel (roll, downtime activity, end of session) is open at a time, and Esc closes it.

## `play` additions (defaulted in `normalize`, so older documents open unchanged)
- `session: 0` — the current session number. "Start session N+1" increments it, clears `trainedThisDowntime` (and any `keyHitSession` left over), and logs `{ at, kind: 'note', text: 'Session N started' }`.
- `keyHitSession: { [keyIndex]: true }` — the sheet had no per-session flag, so this is new. The first key hit on a key in a session marks 1 playbook xp and sets the flag; another hit on the same key that session marks the pip but gives no xp ("once per session", read per key). Removing a key re-indexes the flags. End session sets it to `{}` (boot's delta falls back to a full set when an object loses keys).
- `trainedThisDowntime: false` — Train sets it; Start session clears it.

## End of session
The panel lists the same end-of-session triggers as the XP box: `pb.xpTriggers` for the paranormal four; for the core playbooks "You <pb.xp, past tense>." and "You struggled with issues stemming from a deadlock." (Hull with all four memories complete: the first line becomes "You worked to free yourself from your owning faction and controller, or addressed a challenge with your humanity."). Each trigger 0 / 1 / 2. "Mark xp" adds the total to `xp.playbook` capped at 8 and says how many were lost; at 8 it points at the advance (Special abilities / Traits / Hull traits box; Time Traveler: Gain clarity). Hull may send the xp to one memory clock instead (up to its free segments; the rest spills into playbook xp). Then `keyHitSession = {}` and one note: `Session N ended: +X xp (trigger; trigger ×2)` plus ` · K to memory M` / ` · L lost to the cap`. One save. Read-only: the Session buttons are disabled.

## Downtime (each activity: one `kind: 'roll'` log entry, one save; read-only viewers roll but nothing is written, "Not saved (read only)")
- Indulge vice (core playbooks only, not Hull): dice = the lowest attribute rating (0 → 2d take lowest); clear Stress equal to the read die; more than current Stress → "Overindulge: tell the GM", Stress 0. Log `Indulge vice 1d · 4 → clear 4 Stress (5 → 1)` (`, overindulge` when it applies). Hull / Ghost / Vampire / Time Traveler get no button and a line naming Recharge −5 / Consume / Feed / Restabilize.
- Recover (Hull: "Repair", treated by "a mechanic"): yourself with a chosen action's rating, or a healer with 0–4 dice. Ticks: 1–3 one, 4–5 two, 6 three, critical five. When the 4-segment clock fills, every harm steps down (level 3 → 2, 2 → 1, 1 cleared; level 4 is not healed by the clock) and the overflow stays on the clock (it can fill more than once). Vampire has no Recover: feeding is its only healing. Log `Recover (a healer) 2d · 5,3 → partial, +2 healing, clock filled: harm steps down (0 / 4)`.
- Long-term project: one of `play.clocks` (complete ones are shown but cannot be chosen) or a new clock (name + 4 / 6 / 8, default 8, created on the roll), a chosen action, same tick table, capped at the clock size. Log `Long-term project “Name” (Hunt) 2d · 6,1 → success, +3 (3 / 6)` (`, complete` when full).
- Train: +1 xp in Insight, Prowess, Resolve or playbook (a full track cannot be chosen), once per downtime (`trainedThisDowntime`). Log `Train Prowess · +1 xp (1 / 6)`.

---

# Display name (runtime/cf.js; PATCH /api/me)

Optional runtime API, hosted build only, beside `use()`. A person may change their own display name, never another's:

```js
window.claude.profile = {
  setName(name) -> Promise<{ id, email, name, role, campaign }>   // PATCH /api/me { name }; '' or null clears it
}
```

The server trims the name, collapses runs of whitespace, and accepts 1-40 characters with no control characters and no `<` or `>`
(otherwise the promise rejects with `Error(message)` and `.status` 400; `.network = true` while offline: it is a plain call, never
queued). The answer is the same shape as `GET /api/me`, `name` being what is now shown (the chosen name, else the sign-in
name). On success the adapter updates `window.B68Runtime.me.name`, `user.me()` and the cached member names; a page that already
drew the old name (the header, `A.myName`) redraws it itself. Characters store their owner by id, so a rename shows everywhere
that resolves names through `user.profiles()`.

---

# The rules wiki (rules.js, markdown.js; RULES.md)

Optional runtime API, hosted build only (`runtime/cf.js`). Without it (the claude.ai artifact, `file://`) the Rules page says
"Rules are available on the hosted app" and the "?" links and Rules buttons are not drawn. It sits beside `use()`:

```js
window.claude.rules = {
  list({ version? }) -> Promise<{ version, updatedAt, count, books: { b68, bitd, house }, entries: [ { book, slug, title, trail, keys, body, ord, src, updatedAt } ] }
                               | { version, updatedAt, count, unchanged: true }>   // GET /api/rules[?v=<version>]; any signed-in member
  import({ book: 'b68' | 'bitd', entries: [ { slug, title, trail, keys?, body, ord, src } ], replace, part, of }) -> Promise<{ ok, book, received, part, of, replaced, count, version }>   // GM
  saveHouse(slug, { title, body, trail?, keys?, ord? }) -> Promise<{ entry, version }>   // GM, PUT /api/rules/house/:slug
  deleteHouse(slug) -> Promise<{ ok, version }>                                          // GM, DELETE
}
```

Errors reject with `Error(message)` and `.status` (403 for a player's write, 413 over a size cap, 400 malformed); a network
failure rejects with `.network = true`. The page caches the corpus itself (IndexedDB `b68-rules`, key `corpus:<user id>`),
sends the cached `version` to get a cheap `unchanged`, and falls back to the cache when the network is down.

`window.B68Rules` (rules.js): `available()`, `help(term)` (HTML for a "?" link to `#rules?q=<term>`, `''` when unavailable;
tracker.js, crewsheet.js and campaign.js use it), `open(root, api)`, `route()`, `close()`, and for the GM page's rules search and Find
`load(cacheOnly)` (the corpus with the page closed: memory, this device's copy, then the server), `hits(q, n)` (`{ total, hits }`: the best n,
each a plain row with its snippet) and `entry(id)` (one entry's Markdown as the players may see it). boot.js owns the `rules` mode
(`body[data-mode="rules"]`, `#rules-page`), the `#rules` hash routes (`#rules`, `#rules?q=<words>`, `#rules?edit=<slug>`,
`#rules/<book>/<slug>`), the Rules button in the header and the link on Home; `A.openRules()`. `window.B68Markdown`
(markdown.js): `render(src, { resolve, headingOffset })`, `parseFrontmatter`, `splitFile`, `plain`, `safeUrl`, `esc`. The
renderer escapes all raw HTML and only links http, https and relative addresses.
# Round 6: the cast (NPCs)

Owner: `cast-page.js`, `cast.css` (new), `figures/npcs.js` (data); the server and adapter side is in `functions/` and `runtime/cf.js`.
The whole contract is in `CAST.md`; this is the part the page and the runtimes share.

## Collection `npcs` (artifact db, and `cf.js`)

```js
db.collection('npcs')            // where / orderBy / limit / get() / onSnapshot(cb, err) -> { docs: [snap], size, empty, forEach }
db.collection('npcs').doc(id)    // get() / set(doc) / update(patch) / delete() / onSnapshot(cb, err) -> { id, exists, data(), metadata }
// doc: { name, alias, role, faction, description, spec /* figure kit v2 */, revealed, firstSeen, tags, gmNotes }
```

- The same interface as `characters`, on the hosted build (`cf.js`: cached beside the characters, refetched only when the characters
  poll's `npcsUpdatedAt` moved, writes through the ordered offline queue, GM only) and in the artifact (the db's own collection;
  `update` where the runtime has it, else `set`). The page never assumes either: when `collection('npcs')` is missing or throws it
  says the cast needs the shared files.
- **Secrecy.** Hosted: the server sends a player only revealed NPCs, never `gmNotes`. Artifact: the collection is shared, so hiding is
  presentation only (`cast-page.js` filters on `revealed` and drops `gmNotes` for anyone but the GM).
- `campaign/main` gains `scene = { npcs: { <id>: true | false }, at }` (GM only). Boot saves it through `campaignSave({ scene })` (changed leaves
  only, like `schedule`) and `campaign.js` `normalize` keeps it.

## `window.B68CastPage` (boot.js calls it)

```js
B68CastPage.init(api)         // once the files settle: api = { db(), me(), isGM(), canWrite(), saveScene(scene) -> Promise, back() }
B68CastPage.campaign(doc)     // every campaign/main snapshot (the scene), and null when there is none
B68CastPage.open(hash)  .route(hash)  .close()   // the `cast` mode (#cast, #cast/<id>, #cast/<id>/edit, #cast/new)
```

`body[data-mode="cast"]` shows `section#cast-page`; `aside#stageBanner` is outside every mode and shows who is on stage on every screen.
Boot adds the mode (`MODES`, `setMode`, `route`, the hash) and "The cast" on Home and the table page; nothing else of the creator is touched.

