# GM sync: the app and the Obsidian vault

`scripts/gm-sync.mjs` moves what happened at the table from the GM page (D1) into the GM's Obsidian vault, and the
vault's prepared material (NPC look lines and figure specs, the GM pack) back to D1. It runs on the GM's own PC, with
the GM's own `wrangler login`; nothing about it is deployed, and no table text enters git (the code carries logic and
labels only; the tests use the invented vault in `checks/runtime/fixtures/vault/`).

```
npm run gm:pull              # after a game: app -> vault (writes the vault)
npm run gm:pull -- --dry-run # the same, writing nothing: what it would file, and where
npm run gm:push              # vault -> D1: prints the plan, writes nothing
npm run gm:push -- --yes     # ... and writes it
npm run gm:sync              # both (pull, then push; push still needs --yes)

node scripts/gm-sync.mjs [pull|push|both] [--dry-run] [--yes] [--vault <path>] [--campaign <id>]
                         [--session <N>] [--baseline] [--only notes|npcs|pack] [--pack <file>] [--private <dir>]
```

Exit code 0: done. 1: something was refused or is in conflict (read the report). 2: stopped before writing (not logged
in, offline, no vault) or mid-push (what landed is in the ledger; run it again).

## Pull: app -> vault

| From the app | Goes to | Format | Duplicate guard |
|---|---|---|---|
| Capture `P` `X` `M` and `L` rolls | `Sessions/b68g-sNN.md`, under `## Names`, `## Loose ends`, `## Moments`, `## Rolled at the table` | the GM station's line, `- **HH:MM** text ^b68-<id>` (Melbourne time); the template's lone `-` is replaced | the block id anywhere in any session note |
| Pins | the same note, `## Pinned` (added after Rolled at the table) | a collapsed `> [!quote]-` callout, then `^b68-<id>` on its own line | same |
| Bargains owed, collected; callbacks used | the same note, `## Bargains and callbacks` (added after Pinned) | `- **Owed:** text (who, date) ^b68-owed-<key>`, `**Collected:**`, `**Callback used:**` | same. Blade copies them to the board at close; the sync never writes `b68g-factions.md` |
| An NPC made in the app with no card | a new `NPCs/<Name>.md` | the vault NPC generator's Save format (replayed through `app/gm/npc.js` from the GM state's `npcgen[id]` (seed, memory and the roll's faction / district / place choices) and the local pack; without those, the same skeleton with `[TODO]`s), tagged `wiki/needs-review` with a `review_note`; a faction dossier line as the generator's Save adds it; one `Wiki/log.md` entry per run that creates cards | the name is checked across the whole vault first: a note outside `NPCs/` with it -> `<Name> (NPC).md` |
| A reveal | the card's `## In play` | `- **DD/MM/YYYY (app):** revealed to the table. ^b68-rev-<id>` | the block id in the card |
| GM notes | the card's `## In play` | each new version as a collapsed `> [!note]-` callout, `^b68-gmn-<id>-<hash>` | same |
| A task box ticked in the Prep tab (`prep.ticks`) | that box, in its own note: `- [ ]` becomes `- [x]` | one character; nothing else in the note changes | the ledger's `ticked`: a box the GM unticks by hand afterwards is not ticked again |
| A tick whose box is gone (reworded, moved under another heading, or the same task twice) | the session note, `## At the table (app)` (added after Bargains, Pinned or Rolled at the table) | `- **HH:MM** Ticked at the table: text (not found in <note>) ^b68-tick-<anchor>` | the block id, as above |
| A beat started, a tick-column cell ticked (`prep.beats`, `prep.cells`) | the same heading | `- **HH:MM** Beat started: label ^b68-beat-<key>`, `Ticked at the table: label ^b68-cell-<key>` | same |

**Prep.** A tick only ever ticks: the sync never unticks a box, and a box already ticked in the note is left as it is. The
box is found by its anchor (`scripts/lib/prep.mjs`): a hash of the note's path, the heading the task sits under, its text
and how many identical tasks come before it under that heading, so it survives edits elsewhere and a renamed note title.
It is never guessed onto another line. The notes a tick may edit are fixed in code (`assertPrepWritable`): the group
campaign's folder and its `Sessions/`, never a transcript, the faction board, `Characters/` or `Clocks/`.

**Which session note.** A capture or pin carries `s`, the session number the page stamps on it: `s: 2` ->
`b68g-s02.md` (or `b68g-s2.md`), `s: 1.5` -> `b68g-s1.5.md`. Entries without `s` (the table's counter was 0, or older
lines) go to `--session N` when given; else to the session note whose frontmatter `date:` (DD/MM/YYYY) is the night the
entry was made (before 06:00 counts as the night before), so a session 3 note made the next day cannot take session 2's
lines; else, and the bargains, to the highest-numbered `b68g-sNN.md`, as the station does (interludes like
`b68g-s1.5.md` are never chosen that way). Prep ticks' and beats' lines under `## At the table (app)` follow the same
rule. The transcript copier (`gm-transcript.mjs`) does too.

**When it refuses** (writes nothing to that note or card, reports it, and carries on with the others): the note is
missing; a session note lacks one of the four headings; any of the six headings appears twice; a card has no
`## In play` (or two); the file is not valid UTF-8; Obsidian saved the file twice while the sync was writing it.
A line the ledger says was filed but is no longer in any note was removed by hand: it is not filed again.

**How it writes.** Read, edit in memory, write a temp file beside the note, check the note's mtime and size are
unchanged, rename over it (Obsidian saving mid-run: redo the edit on the fresh copy, once). The BOM, every line's
own ending (CRLF, LF or mixed) and all Unicode are kept; only the inserted lines are new. New files are created with
a hard link from the temp file, so an existing file is never replaced. Nothing is ever deleted from the vault. A
second run with nothing new leaves every file byte-identical. Writable paths are fixed in code (`assertWritable`):
session notes, `NPCs/*.md`, `Factions/*.md` (append), `Wiki/log.md` (append).

## Push: vault -> D1 (only with `--yes`)

**NPCs** (rows matched to cards by the ledger's path, else by name):

| Field | Owner |
|---|---|
| `name` | the vault (the card's file name, less ` (NPC)`) |
| `description` | the vault's "At a glance" look line until the NPC is first revealed (`revealed` or `firstSeen`), then the app's |
| `spec` | three-way merge of `NPCs/figures/<Name>.json` (its `spec`) against the ledger's last-synced copy: vault changed -> pushed; app changed -> kept, reported; both -> neither written, the app's copy saved in `gm-private/sync-conflicts/`, a conflict reported |
| `role`, `faction`, `revealed`, `firstSeen`, `gmNotes`, `tags` | the app's; never pushed (a faction that differs from the card is reported) |

With no ledger entry for an NPC, every difference is a conflict and nothing is written. `--baseline` records the app's
current values as the last-synced copy (for a first run, once the conflicts are understood); the next push then writes
the vault's side of every vault-owned field that differs. Writes go through the server's own `checkNpc` / `writeNpc`
(optimistic `updated_at` check), so a change made in the app during the sync is not overwritten: it is reported.

**The pack.** `gm-private/b68-gm-pack.json` (`npm run gm:pack`) part by part through the server's `cleanPart`. A part
whose version and `src` match the server's is skipped. A changed part is written in pieces to a staging table
`gm_sync_stage` (created on first use) and swapped into `gm_pack` by one statement that runs only when every piece is
there; a failure part-way leaves the old part in place. The stored part is read back and its hash checked against the
version, as the API computes it. A part on the server that the file lacks is left alone and reported.

**The pack guard** (`scripts/lib/pack-guard.mjs`, 17/10/2026). On 16/10 Obsidian Sync put an old copy of
`b68g-s02.md` back: no `gm_prep: true`, 26 000 characters shorter, so the next pack had no prep at all. Now:
`npm run gm:pack` compares the new pack with the file already there, and the push compares each changed part with the
server's (sizes from the index; the prep notes from the server's prep part). A part gone (gm:pack only: the push leaves
missing parts alone), a part under 75% of its size, or a prep note gone or under 75% of its length is a loss: gm:pack
writes nothing and exits 1; the push refuses and pushes nothing of the pack. `--allow-shrink` overrides either, for a
loss that is meant. The GM page's **Update pack** runs the same rules against the pack it holds and asks before
uploading.
## Auth and the database

`wrangler d1 execute <database_name> --remote --json --command=<sql>` with the repo's own wrangler, started by node
directly (no shell). The database name and campaign come from `wrangler.toml`. Not logged in or offline: the run reads
D1 before writing anything, so it stops with nothing written (`npx wrangler login` fixes the first). `--command` takes
no bound parameters, so values become SQLite literals (`scripts/lib/d1.mjs` `bindSql`). `--file` is never used (on
`--remote` it runs D1's import, which blocks the database). One command is kept under ~28 000 characters (the Windows
command-line limit, counting node's escaping), so a pack piece is about 13-25 KB.

## Memory: `gm-private/` (git-ignored)

- `sync-ledger.json`: per campaign, the block ids filed and where, each NPC's card path and last-synced fields, the
  pack versions pushed. Lost or unreadable: treated as empty (an unreadable one is kept beside the new one).
- `sync-log.jsonl`: one line per run, counts, block ids, NPC ids and session note names. No table text, no NPC names.
- `sync-conflicts/`: app copies of figure specs that conflicted.

## Files

| File | Role |
|---|---|
| `scripts/gm-sync.mjs` | CLI and `run()` (exported for the tests) |
| `scripts/lib/d1.mjs` | wrangler exec, the in-memory fake (`node:sqlite` + `schema.sql`), literals, the D1-binding facade |
| `scripts/lib/vault.mjs` | vault paths, read/insert/write with line endings kept, the station's filing rule, block ids |
| `scripts/lib/sync-notes.mjs` | pull: session notes (the core) |
| `scripts/lib/sync-npc.mjs` | pull and push: NPC cards and fields (optional: loaded only if present) |
| `scripts/lib/sync-pack.mjs` | push: the pack (optional: loaded only if present) |
| `scripts/lib/sync-prep.mjs`, `prep.mjs` | pull: the Prep tab's ticks, beats and cells (optional); the line scan and anchors it shares with the exporter |
| `scripts/lib/ledger.mjs`, `report.mjs` | the ledger, the log, the printout |
| `checks/runtime/gm-sync.test.mjs` | `node checks/runtime/gm-sync.test.mjs` |
