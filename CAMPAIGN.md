# Campaign layer contract (Phase 2)

One shared page for the whole table: the crew, shared clocks, the session number, and who is
playing. It works in both runtimes: inside the claude.ai artifact (its own `db`) and on the
Cloudflare build (through `/api/campaign` and `app/runtime/cf.js`).

Ownership: **server + adapter** owns `functions/`, `schema.sql`, `app/runtime/cf.js`,
`checks/api/`, `checks/runtime/`, and the API/Adapter sections of `HOSTING.md`. **page**
owns `app/campaign.js` (new), `app/campaign.css` (new), `app/boot.js`, `app/index.html`,
`app/checks/campaign.js` (new). Nobody else edits `tracker.js`, `steps.js`, `core.js`,
`content.js`, `zoom.js`.

## The document

Collection `campaign`, document id `main` (one per campaign; on Cloudflare the campaign is
`env.CAMPAIGN`). Shape, `v: 1`:

```js
{
  v: 1,
  session: { number: 0, startedAt: null | ISO, endedAt: null | ISO },
  crew: {
    name: '', type: '', lair: '', notes: '',
    tier: 0,              // 0..6
    hold: 'weak',         // 'weak' | 'strong'
    rep: 0,               // 0..12
    turf: 0,              // 0..6, each claimed turf reduces the rep needed by 1
    heat: 0,              // 0..9
    wanted: 0,            // 0..4
    vault: 0,             // crew stacks, 0..16 (4 rows of 4)
    claims: [ { name: '', held: false } ],
    cohorts: [ { name: '', type: '', edges: '', flaws: '', harm: null | 'weak' | 'impaired' | 'broken', armor: false } ],
    factions: [ { name: '', status: 0 } ]   // -3..+3
  },
  clocks: [ { id: 'c_xxx', name: '', size: 4 | 6 | 8 | 10 | 12, filled: 0, kind: 'danger' | 'project' | 'faction' | 'other', hidden: false } ],   // see *Clocks*
  log: [ { at: ISO, by: 'u_or_email', text: '' } ],   // newest first, at most 200
  updatedAt: ISO
}
```

`hidden` clocks are shown only to the GM in the page (and in a player's backup they are left
out, see *Backups*). This is presentation only: anyone with access can read the document, so it
is not a secret.

The standard Forged in the Dark crew tracks are used (tier, hold, rep 12, heat 9, wanted 4).
This round predates the crew playbooks; the crew-type specifics were added later (see *Crew
playbooks* and *Crew sheet*).

## Permissions

- GM (`user.canEdit()` true on Cloudflare; the artifact owner, `user.isOwner()`, in the
  artifact) writes everything.
- The crew sheet is shared by the whole table: players may change anything under `crew`
  (including arrays growing or shrinking), fill clocks (`clocks.<i>.filled`, see *Clocks*) and append to
  `log`. GM-only: `session`, the structure of `clocks` (add, remove, rename, resize, kind,
  hidden), rewriting or removing old log entries (a `PUT`), and any other top-level key. The
  page does not show GM-only controls (`data-gm`) to players or read-only viewers at all, rather
  than showing them disabled; a GM-only text field (a clock's name) still shows its value,
  disabled, and where that leaves a player nothing the box says who does it ("The GM starts
  sessions."). The API enforces it on Cloudflare by
  comparing the stored document with the merged result (`403 "only the GM can change that"`).
- Appending to the log is commutative: in a `PATCH` (anyone), `log` lists entries to add, not
  a replacement, so two people appending from the same stale copy both land. An entry
  identical to a stored one (same `at` + `by` + `text`) is skipped; one with the same `at` +
  `by` but other text is a rewrite: `403` for a player, ignored for the GM. The result is
  sorted by `at`, newest first, and trimmed to 200. Sending only the new entry
  (`{ log: [entry] }`) is enough; sending the whole log with the entry in front also works.
- A missing document reads as the default above (every field present, `session.number` 0).
  The first write creates it.

## Clocks

Every clock has an `id`. The page names a new clock `c_<time><random>`; a clock stored without one (a document from
before ids, a hand edit, a restored file) is named `c_<i>` by its place among the clocks, and a repeated id gets `_`
added until it is unique. The page names them so when it reads them, and the server stores those names on its next
write of the document (any write), so the stored shape only gains ids, which the previous release reads as before.

A change to a clock is an operation on that one clock, `clockOps` in a `PATCH`, applied in order to the clocks as
stored. The server applies them inside its write loop, which re-reads the row on every attempt, so changes to
different clocks commute: two players ticking different clocks within a poll of each other both land, and a player's
tick survives the GM renaming, resizing, hiding, adding or removing other clocks.

```js
{ clockOps: [
  { id: 'c_x', filled: 3 },                                            // a tick (a wedge, the − / +): the fill, kept within 0..size
  { id: 'c_x', name: 'Bluecoats', size: 8, kind: 'faction', hidden: true },   // the GM: these fields (a smaller size takes the fill down)
  { add: { id: 'c_y', name: '', size: 4, filled: 0, kind: 'danger', hidden: false } },   // the GM: append it, once per id
  { remove: 'c_x' }                                                    // the GM: take it out
] }
```

- An op for a clock that is not there does nothing (a tick never brings back a clock the GM removed), and an op
  applied twice gives what it gave once (the offline queue may send one again).
- The same clock from two devices: the fill is a value, not a step, so the write the server takes last wins on that
  clock. Two phones that both tick it from 3 leave it at 4 (one tick, not two); the other clocks never move.
- Who may do what is judged on the result, by the rule above: a player's ops may only change `filled` (403 otherwise).
  `hidden` stays presentation only, so a player may fill a hidden clock through the API, as before.
- The page sends ops only to a store that says it takes them (the campaign ref's `clockOps: true`: the hosted
  adapter, HOSTING.md); anywhere else (the artifact's own db) it sends the whole `clocks` array as before. The GM page's
  Downtime panel adds a clock a card suggests the same way, hidden and of kind `danger` (boot.js `addTableClock`, GM.md).
- The previous release sends a tick as the whole `clocks` array, copied from the document as that page last read it
  with one fill changed. For one release the server still takes it under the old rule (a player may only change
  `filled`, the same clocks, else 403), plus one: a player's array that changes the fill of more than one clock was
  copied before another device's tick, so it is refused (`412 "the clocks changed on another device, try again"`)
  rather than allowed to undo that tick; the adapter drops it and reloads the table. A whole array from the GM still
  replaces the clocks. Once no page of the previous release is left, this path can go.

## Who is on stage

`scene = { npcs: { <npcId>: true | false }, at: ISO }` is a GM-only top-level key (a map, as the convention asks for anything
several people might write). `checkShape` validates its shape (400), and a player's change to it is 403, like any other key outside
the player rules. It says which NPCs the table is looking at; the page shows them in a banner on every screen. See CAST.md.

## Crew playbooks

The six Blades '68 crew playbooks (Dealers, Hit Squad, Militants, Racers, Shadows, Utopians)
are transcribed into `app/crews.js` (`window.B68Crews`). The generic crew panel is replaced
by a full crew sheet driven by that data (done: *Crew sheet* below); `crew` gains `playbook`,
`abilities`, `upgrades`, `claims` as a map, `xp`, `contacts` and the per-crew extras. The
server treats `crew` as opaque JSON.

## API (Cloudflare)

- `GET /api/campaign` → `{ "doc": {...}, "updatedAt": ISO }` (the default doc and
  `updatedAt: null` when missing).
- `PUT /api/campaign` body = whole doc (GM only) → stored, `updatedAt` stamped by the server.
- `PATCH /api/campaign` body = partial doc, same deep merge as characters (objects merge,
  arrays and scalars replace, null deletes), except `log`, whose entries are added as above
  (`log` must be an array of objects, else 400), and `clockOps`, applied to the clocks after the
  merge (see *Clocks*; a malformed one is `400 "clockOps: …"`); player rule above checked against the
  merged result. A player's whole `clocks` array that changes more than one clock's fill is 412
  (*Clocks*). Returns `{ doc, updatedAt }`.
- In `PUT` and `PATCH`, `crew` and `session` must be plain objects when present (`400
  "crew must be an object"` / `"session must be an object"`; `null` to delete them counts).
  `clockOps` in a `PUT` is 400. Every write stores every clock with an id (*Clocks*).
- `GET /api/characters` and `?since=` responses gain `"campaignUpdatedAt": ISO | null` so the
  adapter knows when to refetch the campaign without a second poll.
- Table: `campaigns(id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, doc TEXT NOT NULL)`.
  Body cap 256 KiB. `log` is trimmed to 200 entries by the server.

## Adapter (`cf.js`)

`collection('campaign').doc('main')` → `get()`, `set()` (PUT), `update()` (PATCH),
`onSnapshot()`, and `clockOps: true` (its `update()` takes `clockOps`). The snapshot is
`{ id: 'main', exists: true, data() }` (always exists, the default doc when missing). It is refreshed
when a poll's `campaignUpdatedAt` differs from the cached one, and immediately after its own writes,
with optimistic local merge as for characters (`clockOps` applied by clock id exactly as the server
applies them, ids named the same way). Any other `campaign` doc id, and `collection('campaign')`
queries, return empty.

## Page

- A third mode `body[data-mode="table"]`, reached from a new "The table" button in the header
  (next to "Back to the creator") and the hash `#t`. It hides `.studio`, `.crew`, `.roster`,
  `#dossier`, and shows `section#table-page`.
- Contents: the header (crew name, tier and hold, the cast and "Print the season" buttons, see *Season
  print*, and the viewer's role as plain words with a dot, never a boxed label that looks like a button);
  the session as one line ("Session 3 · in play"; "not started yet" or "ended 12 Oct" otherwise, with
  "The GM starts sessions." / "The GM starts the next one." for a player then; the GM's buttons "Start
  session N+1" and "End session" follow it, wrapping below on a narrow screen); shared clocks (add,
  rename, resize, fill by clicking segments or by the − / + beside the count, kind chips, hidden toggle
  for the GM, delete with confirm); the campaign log (append a line, newest first; each line shows
  when and who together before the text; the latest three, "All N" shows the rest); the players: each
  member with their characters (from the existing roster, "No owner yet" for a character without one),
  each character's stress line and an "open" link; the crew (name, type, lair, tier, hold, rep with turf,
  heat, wanted, vault diamonds, claims, cohorts, faction statuses −3..+3; now the full crew sheet,
  below); and the schedule (SCHEDULE.md).
- Layout: the page's DOM order is the phone's reading order: the session line, shared clocks, the log,
  the players (column B), then the crew and the schedule (column A). Up to 760 px the crew sits behind
  a summary row (Tier · Hold · Rep · Heat · Wanted · Stacks, the sheet's own numbers) that unfolds the
  whole crew sheet; it starts unfolded only while the crew has neither a name nor a playbook (the table
  is being set up). Up to 900 px it is one column in that order; on a wider screen column B is on the
  left and column A on the right, or, once the full crew sheet is chosen, one column with column B's
  boxes side by side above the sheet. Print still starts with the crew and prints every log line. The
  schedule is `#tp-schedule`: a player gets the box only while a next session or an open date exists
  (a link to `#t/schedule` shows the box with a plain "Nothing is planned yet" note); the GM gets one
  line, "Schedule · no dates · Plan dates", that opens it, and the box opens by itself while dates exist
  (the `#t/schedule` route and Home's schedule links open it too; its "Close" folds it back). What is
  folded or unfolded (the crew summary, the log's "All", the schedule line) is page state: it redraws,
  it never writes, and read-only viewers may use it.
- Touch (screens up to 760 px, or a coarse pointer): every control on the page is at least 40 px tall.
  Buttons, chips and text fields grow; the small marks (tier, rep, heat, wanted, the vault, stacks, the
  crew sheet's pills, cubes, ability circles, upgrade boxes and contact dots) keep their size and get an invisible
  `::before` hit area, 40 px tall and as wide as their pitch, in rows at least 40 px tall, so neighbours never take
  each other's taps (checked by `app/checks/campaign.js` and `crewsheet.js`). The shared clocks are drawn 104 px wide, with a − / + beside the count (one write,
  `{ id, filled }` for that clock, the same op a wedge makes; players may use it).
- Words: the page speaks of characters and saving, never of "files" or "filing" ("No characters yet.", "No owner
  yet" for a character without a player, "Saved Aldo Crane.", "Removed."); with no database it says "The table is
  not available in this view." Home's "Session 3 has started at the table" nudge is a "Join session 3" button: it
  opens the player's sheet scrolled to its own Join bar (the sheet's Join writes `play.session`, as before).
- Saves go through `doc.update(patch)` with only the changed top-level fields of `crew`,
  `session`, `log`, the changed `schedule` leaves, and the clock changes as `clockOps` (the whole `clocks` array to a
  store without them, see *Clocks*); the page never writes on open.
- Starting a session sets `session = { number: n + 1, startedAt: now, endedAt: null }` and
  appends a log line. It does not change characters; their own Session box stays per sheet.
  In the same write it updates the schedule: `next` goes when it is within 12 h, its answers
  becoming that session's attendance, and dates before now + 12 h leave the grid (SCHEDULE.md).
- Read-only viewers (`can('data.write') === false`) see everything disabled except "Print the
  season", "The cast", Open, the phone's "Show the six crew playbooks" and the page-state folds (the crew
  summary row, the log's "All"); GM-only controls are not shown.
- Same visual language as the sheet (bands, boxes, pips, accent orange), phone width 390px
  without horizontal scroll, light and dark, print hides buttons.
- Theme: the page follows the device (light is Paper, dark is Night) until someone picks one with the small Auto /
  Paper / Night switch in the footer. The choice is kept in this browser (`localStorage` key `b68.theme`: `light` or
  `dark`; Auto removes it; a blocked store means the choice lasts for the visit) and a tiny inline script at the top
  of `index.html` applies it as `html[data-theme]` before anything paints, so Night never flashes paper. Text colours
  are 4.5:1 or better on the card: `--ink-faint` on Paper (`#6a645e`), and `--accent` (`#e8742a`), `--ink-faint`
  (`#9a948c`) and `--ok` (`#7d9e78`) on Night (checked by `app/checks/e2e.js`).

## Crew sheet

`app/crewsheet.js` + `app/crewsheet.css` replace the generic crew panel through `B68Campaign.setCrewPanel`, driven
by `app/crews.js`. campaign.js still owns the document, the saves (one write per click, typing debounced, only the
changed `crew` fields) and the gating (read-only: everything disabled; `data-gm` controls not shown to players). A
crew panel may give an act its own permission (`PERM: { act: 'all' | 'gm' }`; 'any' by default).
Checked by `app/checks/crewsheet.js`.

- **No playbook yet** (`crew.playbook` null): six crew covers above the generic panel. Anyone may choose (confirm).
  Up to 760 px the covers fold behind "Show the six crew playbooks" (page state, never written; read-only viewers may
  unfold them too).
  Choosing seeds the printed state: the record's `pre` upgrades, the starting cohort (added unless one of that type
  exists), pre-held cells (BASE; Dealers' first Distribution turf), abilities printed marked (Racers' Stunt Riders),
  the Utopians' first circle. Name, tier, hold, rep, heat, wanted, cohorts, factions and notes are kept; `lair` fills
  an empty `base`; a generic `claims` list moves to `crew.legacyClaims` (listed as text, clearable).
- **Changing the playbook** is GM only, with a warning; abilities, upgrades, claims, contacts, versatile write-ins
  and `special` are cleared, the common tracks stay.
- **Shape** (added to `crew`): `playbook`, `reputation` (or the record's `extraHeader` key, `cause` for Militants),
  `base`, `wardBoss`, `preferred: ['', …]`, `anger`, `stacks`, `xp`, `claims: { cellId: bool }`,
  `abilities: { name: n }`, `versatile: ['']`, `contacts: { name: 'friend' | 'rival' | null }`,
  `upgrades: { name: n }`, `special: { units, productKind, stunts: { name: bool }, edges: [], flaws: [],
  circles: { id: { marked, tally, truths: [] } } }`, `legacyClaims`, `advancePaid: { characterId: bool }`. `type`
  is set to the playbook name and `turf` to the derived turf count. Because a PATCH merges objects, a cleared map
  entry is written as `false` / `0` / `null`, never removed. campaign.js keeps a `claims` map as a map.
- **Claims**: a cell is claimable when held or joined by a connector bar to a held cell. Dealers' product follows
  the arrows: a cell opens once an arrow source is held; cells with no arrow in (Local Supplier, Local Fiends,
  Branding, the turfs) are open from the start. Utopians' cells open with their circle. Unclaimable cells are dimmed
  and disabled for players; the GM can claim them after a confirm. BASE is fixed.
- **Rep and turf** (the base Blades rule, which '68 inherits; BitD *Development* and *Turf*): rep fills left to
  right. Each held turf cell marks one rep pip from the right ("1 less rep to develop"), at most 6 turf, which are
  the six grey pips; with On the Side of the Oppressed each Wanted Level counts as turf too. Rep can be marked up to
  12 − turf. When it is full a *Develop* box appears under the track: with weak hold, *Strengthen the hold* makes it
  strong and resets rep to 0; with strong hold, *Go up to Tier N* costs new Tier × 8 stacks (half with Benefactor),
  taken from the crew's stacks and then its vaults, and resets rep to 0 with the hold weak. Turf marks stay either
  way. The button is off while the crew cannot pay; rep simply stays full. The tier and hold pips still work by hand.
- **Vaults**: 4 + 8 cubes, locked until the Vault upgrade's first box (first group) and second box (second group).
- **Utopians**: descending to a circle needs the one before; leaving a circle leaves the deeper ones. Grouped
  abilities are locked until their circle is reached. Truth words: up to the circle's `count`.
- **Crew xp**: the record's `xpMax` ovals; "End session: mark crew xp" scores each trigger 0/1/2 (page state, no
  write) and "Mark crew xp" adds the total in one write, capped. When crew xp is full, the crew advance shows the
  footer rule; the GM's "Pay each PC Tier+2 to bank" adds Tier+2 to every filed character's `play.bank` (capped at
  40) not yet paid for this advance, then resets crew xp to 0 and clears `advancePaid`. A player pays only their own
  characters (recorded in `advancePaid`, so nobody is paid twice); anyone may reset crew xp. Time travelers keep no
  bank and are skipped; a Hull is paid only with A Room of Your Own. Character writes go through
  `B68.updateCharacter(id, patch)` (boot.js; also on the table api): `patch.play` is merged over the stored play and
  only the changed play fields are sent, the same delta path as the sheet's own saves.

## Season print

`#print` (or `B68Season.open()`, or `B68.openPrint()`) opens one printable document of the whole campaign. In the page
it is the "Print the season" button in the table page's header, which stays enabled for players and read-only viewers
(printing writes nothing). It is the docs/history/DEPLOY.md phase 4 "print of every character and the crew at the end of a season". Files: `app/season.js`,
`app/season.css`, `app/checks/season.js`; boot.js adds the `print` mode (`body[data-mode="print"]` shows only
`section#season`) and the route.

- **Pages**, each starting a new printed page: the cover (crew name, crew playbook and tagline in its duotone, tier and
  hold, the season: session count from `session.number`, first and last session dates from the log's
  "Session N started / ended" lines and `session.startedAt / endedAt`, the date printed, the number on file, the
  line-up of every filed character at true height as boot draws it, ghosts vapour, and a contents list); the crew (the
  crew sheet as the table page draws it, the shared clocks, hidden ones only for the GM, and the whole campaign log,
  newest first, with authors' names when the runtime has `user.profiles`); then one page per filed character, ordered
  by playbook in rulebook order (the core playbooks, then the paranormal four) and then by name.
- **Reads only.** It waits for the files to settle, reads `characters` (the whole collection with `get()`, not the
  roster's 60) and `campaign/main` once, and never writes. A character filed without `play` is printed from
  `B68Tracker.initialPlay`, as boot would file it; nothing is saved.
- **Same look, no copied CSS.** The crew page and each sheet are drawn by their own modules
  (`B68Campaign.crewSheet.render(crew, ctx)`, `B68Tracker.renderStatic(root, doc)`, both small additive APIs) into a
  shadow root that carries every stylesheet of the page, with the root's own id (`#table-page`, `#dossier`) inside
  it. The existing `#table-page` / `#dossier` rules, print block included, style the copies unchanged, and the ids
  never collide with the live page's (`document.getElementById('dossier')` is still the live sheet). `season.css`
  reaches into the copies only through `:host` rules.
- **Read-only copies** are inert (nothing focuses or acts; no listeners are attached) but keep the markup a writer's
  sheet prints, so the marks print at full strength rather than faded as disabled controls. Text fields become plain
  text in the field's own box, so long text wraps and grows instead of being clipped by an input or a fixed-height
  notes box (a deliberate difference from the single-sheet print).
- **Print layout decisions.** Each sheet prints as its own Print does (two pages for a full sheet), with two
  differences for legibility: harm lines take the box's full width (as on a phone) and key words never split. The
  crew sheet prints in one column: in two columns, as the table page prints today, the claims map is squeezed to
  slivers. Clocks sit in columns.
- **Screen.** A paper preview of the same pages under a sticky toolbar (Back, Print; it never prints). The paper is
  always the light paper, also in the night theme, so the preview reads as what will print; the desk and toolbar
  follow the theme. The sheets use their screen layouts, so the preview works at phone width (390 px, no horizontal
  scroll).
- **Back** returns where the print was opened from (`history.back()`: the table, a sheet, the creator). Opened cold at
  `#print`, Back goes to the creator and clears the hash.
- Checked by `app/checks/season.js` (PDFs in A4 and Letter in `app/checks/out/season-*.pdf`, pages as PNG beside them).

## Backups

boot.js's "Download all (JSON)" and "Restore (JSON)" in the files section (the format started in `app/CONTRACT.md`,
round 4) carry this document too. Checked by `app/checks/table.js`.

- **Download all** writes `{ v: 1, exportedAt, characters: [doc], campaign }`. `campaign` is `{ id: 'main', doc,
  updatedAt, view: 'gm' | 'player' }`, the document as the page last read it, and is left out while none is stored
  (on the hosted build the default document, `updatedAt` null, counts as none). For anyone but the GM, `doc.clocks`
  leaves out the hidden clocks and `view` is `'player'`, so a player's file shows no more than the page does.
  `v` stays 1: older files are the same without `campaign`.
- **Download everything** (hosted build, GM only) saves `GET /api/export` as it came (HOSTING.md): every character,
  the document and the members.
- **Restore** reads three shapes: `v: 1` without `campaign` (character-only files from before), `v: 1` with it, and
  the `/api/export` file (no `v`; `characters` as `{ id, doc, updatedAt }`, which is unwrapped; `members` ignored;
  its `campaign` with `updatedAt` null is the default document and is skipped). Characters are filed as new
  documents as before, by anyone who can write. The document is restored only when the viewer is the GM and
  confirms (the confirm names a player's copy, which has no hidden clocks); it goes through
  `collection('campaign').doc('main').set()` after `B68Campaign.normalize`, with a fresh `updatedAt`, so on the
  hosted build it is the GM-only `PUT` and the server's rules still apply. A player's restore files the characters
  and says the table was left. The toast says what landed: "Restored 3 characters and the table." Restoring
  replaces the whole document, schedule answers included; ids in it (log authors, schedule answers) are the ids of
  the runtime that saved it.
