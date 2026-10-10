# Creator v2 contract (read before editing anything)

Three modules are being built in parallel. Each owns its own files. Do not edit files you do not own.

| Module | Owns | Globals it defines |
|---|---|---|
| zoom | `zoom.js` (new) | `window.B68Zoom` |
| tracker (the living character sheet) | `tracker.js`, `tracker.css` (new) | `window.B68Tracker` |
| filing (boot/steps/markup) | `boot.js`, `steps.js`, `index.html` | `window.B68` additions |

Script order in index.html (already set): figure-kit.js, cast.js, content.js, core.js, **zoom.js**, steps.js, **tracker.js**, boot.js. `tracker.css` is linked in the head. The page has a `<section id="dossier" hidden>` placed before `main.studio`; it is the tracker's render root. `body[data-mode="sheet"]` hides `.studio` and `.crew` and shows `#dossier` (CSS for that lives in index.html, owned by filing).

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
// api = {
//   save(patch) -> Promise          // shallow-merge patch into the doc: patch is { play: {...whole play...} } or { name, alias, ... }; filing writes updatedAt
//   edit()                          // load this character into the creator (filing switches mode)
//   back()                          // return to the roster
//   remove() -> Promise             // delete (after the tracker's own confirm)
//   me: 'u_..' | null,              // viewer id
//   canWrite: true | false | null   // null = unknown, keep controls enabled and let a refused save decide
// }
```

### Filing API (`window.B68` additions, boot.js)

```js
A.setMode('create' | 'sheet')     // toggles body[data-mode]; closes the tracker when leaving sheet mode
A.openCharacter(docId)            // subscribes to characters/<id> and opens the tracker; sets location.hash = '#c/' + id
A.fileCharacter()                 // create or update (S.sheet.docId) the doc; then openCharacter(id)
```

Hash routes: `#c/<docId>` opens a sheet; `#s<base64url>` (existing) loads a character into the creator; no hash = creator.

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
`node --check file.js` for syntax. Headless render: Playwright at `/opt/node-tools/node_modules/playwright`, Chromium already installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); see `../shots/check.js` for a working example that opens `file://.../creator/index.html`, collects console errors and screenshots. Font 404s on file:// are expected (fonts live in the artifact). `window.claude` does not exist on file://, so db/user/downloads resolve to nothing: your code must still work (hide or disable, never throw).

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
