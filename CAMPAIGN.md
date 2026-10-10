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

`hidden` clocks are shown only to the GM in the page. This is presentation only: anyone with
access can read the document, so it is not a secret.

The standard Forged in the Dark crew tracks are used (tier, hold, rep 12, heat 9, wanted 4)
because the Blades '68 crew playbook pages are not in the repository yet. Crew-type specifics
come later.

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
by a full crew sheet driven by that data in the next round; `crew` gains `playbook`,
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
- Contents, top to bottom: the session bar (number, started time, GM buttons "Start session
  N+1" and "End session", a reminder line "Each player ends the session on their own sheet");
  the crew panel (name, type, lair, tier, hold, rep with turf, heat, wanted, vault diamonds,
  claims, cohorts, faction statuses −3..+3); shared clocks (add, rename, resize, fill by
  clicking segments, kind chips, hidden toggle for the GM, delete with confirm); the players:
  each member with their characters (from the existing roster), each character's stress
  line and an "open" link; and the campaign log (append a line, newest first).
- Saves go through `doc.update(patch)` with only the changed top-level fields of `crew`,
  `clocks`, `session`, `log`; the page never writes on open.
- Starting a session sets `session = { number: n + 1, startedAt: now, endedAt: null }` and
  appends a log line. It does not change characters; their own Session box stays per sheet.
- Read-only viewers (`can('data.write') === false`) see everything disabled.
- Same visual language as the sheet (bands, boxes, pips, accent orange), phone width 390px
  without horizontal scroll, light and dark, print hides buttons.
