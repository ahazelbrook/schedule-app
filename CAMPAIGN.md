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
  clocks: [ { id: 'c_xxx', name: '', size: 4 | 6 | 8 | 10 | 12, filled: 0, kind: 'danger' | 'project' | 'faction' | 'other', hidden: false } ],
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
  (including arrays growing or shrinking), fill clocks (`clocks.<i>.filled`) and append to
  `log`. GM-only: `session`, the structure of `clocks` (add, remove, rename, resize, kind,
  hidden), rewriting or removing old log entries (a `PUT`), and any other top-level key. The
  page disables the GM-only controls for players; the API enforces it on Cloudflare by
  comparing the stored document with the merged result (`403 "only the GM can change that"`).
- Appending to the log is commutative: in a `PATCH` (anyone), `log` lists entries to add, not
  a replacement, so two people appending from the same stale copy both land. An entry
  identical to a stored one (same `at` + `by` + `text`) is skipped; one with the same `at` +
  `by` but other text is a rewrite: `403` for a player, ignored for the GM. The result is
  sorted by `at`, newest first, and trimmed to 200. Sending only the new entry
  (`{ log: [entry] }`) is enough; sending the whole log with the entry in front also works.
- A missing document reads as the default above (every field present, `session.number` 0).
  The first write creates it.

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
  (`log` must be an array of objects, else 400); player rule above checked against the
  merged result. Returns `{ doc, updatedAt }`.
- In `PUT` and `PATCH`, `crew` and `session` must be plain objects when present (`400
  "crew must be an object"` / `"session must be an object"`; `null` to delete them counts).
- `GET /api/characters` and `?since=` responses gain `"campaignUpdatedAt": ISO | null` so the
  adapter knows when to refetch the campaign without a second poll.
- Table: `campaigns(id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, doc TEXT NOT NULL)`.
  Body cap 256 KiB. `log` is trimmed to 200 entries by the server.

## Adapter (`cf.js`)

`collection('campaign').doc('main')` → `get()`, `set()` (PUT), `update()` (PATCH),
`onSnapshot()`. The snapshot is `{ id: 'main', exists: true, data() }` (always exists, the
default doc when missing). It is refreshed when a poll's `campaignUpdatedAt` differs from the
cached one, and immediately after its own writes, with optimistic local merge as for
characters. Any other `campaign` doc id, and `collection('campaign')` queries, return empty.

## Page

- A third mode `body[data-mode="table"]`, reached from a new "The table" button in the header
  (next to "Back to the creator") and the hash `#t`. It hides `.studio`, `.crew`, `.roster`,
  `#dossier`, and shows `section#table-page`.
- Contents, top to bottom: the header (crew name, tier and hold, the viewer's role, and a
  "Print the season" button, see *Season print*); the session bar (number, started time, GM
  buttons "Start session N+1" and "End session", a reminder line "Each player ends the
  session on their own sheet"); the crew panel (name, type, lair, tier, hold, rep with turf,
  heat, wanted, vault diamonds, claims, cohorts, faction statuses −3..+3; now the full crew
  sheet, below); the schedule box (SCHEDULE.md); shared clocks (add, rename, resize, fill by
  clicking segments, kind chips, hidden toggle for the GM, delete with confirm); the players:
  each member with their characters (from the existing roster), each character's stress
  line and an "open" link; and the campaign log (append a line, newest first).
- Saves go through `doc.update(patch)` with only the changed top-level fields of `crew`,
  `clocks`, `session`, `log` (and the changed `schedule` leaves); the page never writes on open.
- Starting a session sets `session = { number: n + 1, startedAt: now, endedAt: null }` and
  appends a log line. It does not change characters; their own Session box stays per sheet.
  In the same write it updates the schedule: `next` goes when it is within 12 h, its answers
  becoming that session's attendance, and dates before now + 12 h leave the grid (SCHEDULE.md).
- Read-only viewers (`can('data.write') === false`) see everything disabled except "Print the
  season".
- Same visual language as the sheet (bands, boxes, pips, accent orange), phone width 390px
  without horizontal scroll, light and dark, print hides buttons.

## Crew sheet

`app/crewsheet.js` + `app/crewsheet.css` replace the generic crew panel through `B68Campaign.setCrewPanel`, driven
by `app/crews.js`. campaign.js still owns the document, the saves (one write per click, typing debounced, only the
changed `crew` fields) and the gating (read-only: everything disabled; `data-gm` controls disabled for players).
Checked by `app/checks/crewsheet.js`.

- **No playbook yet** (`crew.playbook` null): six crew covers above the generic panel. Anyone may choose (confirm).
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
- **Rep and turf**: rep is how the crew levels up. It fills left to right like every track; once it is full the
  crew can spend stacks to go up a tier, and the hint under the track says so. Each held turf cell marks one rep pip
  from the right as turf ("1 less rep to tier up"); with On the Side of the Oppressed each Wanted Level counts too.
  Rep can be marked up to 12 − turf. Going up a tier is the GM's tier pips; rep and stacks are not changed for you.
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
(printing writes nothing). It is the DEPLOY.md phase 4 "print of every character and the crew at the end of a season". Files: `app/season.js`,
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
