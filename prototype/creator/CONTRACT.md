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
