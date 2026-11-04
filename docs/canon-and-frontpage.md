# The canon queue, the front page and the absent packet (suite B31)

Three small features that share one idea: **Claude Code drafts into the vault, you edit in Obsidian, the app only renders or files**. Nothing here calls a model. The drafting commands (`/blade canon`, `/blade front page`) live in the vault's skill, outside this repo; this page is the contract they write to.

| Ticket | Switch | Surface | Where |
|---|---|---|---|
| A4 canon queue | `ai.canon` | GM | `app/gm/canon.js`, `scripts/gm-canon-apply.mjs`, `scripts/lib/canon.mjs` |
| 5.2 front page | `between.frontpage` | GM | `app/gm/frontpage.js` |
| 5.7 absent packet | `between.absent` | phone | `app/gm/absent.js` (send), `app/sheet/absent.js` (read) |

All three switches are off by default. The script and the note formats do not read the switches; the in-app panels do.

## 1. The canon queue note

`/blade canon` reads the night and writes one note of proposals as task-list lines. You tick the ones to keep (on a phone, in Obsidian). Frontmatter and any other text are ignored.

```markdown
---
b68: canon-queue
session: 4
---
# Canon queue, session 4

## Proposals
- [ ] GM-ONLY npc [[Mabel Quist]]: Owes the ferry guild a favour she has not told anyone about. ^c1
- [x] PLAYER-SAFE npc [[Mara Quill]]: Runs the ticket office at the Pelican Rooms.
- [x] GM-ONLY faction [[The Kestrel Club]]: Moved a watcher onto the east gate.
- [x] PLAYER-SAFE players [[Mabel Quist]]: The crew now owes her a dinner.
```

One line, left to right:

- `[x]` or `[X]` is ticked. `[ ]`, `[-]`, `[/]` and anything else is **not** ticked and writes nothing.
- **Scope**: `GM-ONLY` or `PLAYER-SAFE` (any case, optional square brackets). A missing or unknown scope is **GM-ONLY**: the format fails closed.
- **Kind**: `npc`, `faction` or `players` (something a player added at the table; it files on the note it is about, NPC first, then faction).
- **Target**: `[[Note name]]`, the NPC card in `NPCs/` (a ` (NPC)` suffix is allowed) or the faction note in `Factions/`. An alias or heading in the link is ignored.
- **Text**: one line after the colon, at most 400 characters.
- **Id**: an optional trailing `^id` (letters, digits, hyphens). Without one the id is a hash of scope, kind, target and text, so the same line has the same id on every run.

A line the reader cannot parse is skipped with a note in the report. It is never guessed at.

### Applying it

```
npm run gm:canon-apply -- --queue "<the queue note>"          # the plan, writes nothing
npm run gm:canon-apply -- --queue "<the queue note>" --yes    # do it
```

No model and no network except the same authenticated NPC write `gm:sync` uses (the GM's own `wrangler login`), and that only with `--yes` and only when a ticked player-safe NPC line needs it. For each **ticked** line:

1. **The vault.** One line is filed under `## Canon` on the target note (the heading is made at the end of the note when missing): `- 04/11/2026 · GM-only · text ^b68-canon-<id>`. A line whose block id is already in the note is skipped, so running it again changes nothing. The queue note is never written.
2. **The cast page.** A `PLAYER-SAFE` line on an NPC is also added to that NPC's `description` in the app, which the cast page shows, but **only once the NPC has been revealed**. Before that the players cannot see the NPC and the vault owns the description (a later `gm:sync push` would overwrite it), so the line is reported as *held*; run the script again after the reveal. A `GM-ONLY` line is never part of any push, whatever the target.

Unticked lines write nothing, anywhere. Faction lines go to the faction note only (there is no faction on the cast page). Exit 0 fine, 1 something refused, 2 stopped.

The in-app **Canon queue** (Menu, with `ai.canon` on) is a read-only preview: paste the note and it counts the ticked lines and says which are GM-only.

## 2. The front page note

`/blade front page` drafts it from the transcript, the captures and the Aftermath data. You edit it in Obsidian, then paste it into Menu, **Front page** (switch `between.frontpage`), which saves it as a GM-only row (`docs` kind `frontpage`), draws it in a newspaper look, prints it, and puts its headline on the iPad (a `title` show, 12 seconds).

```markdown
---
b68: frontpage
masthead: The Pelican Post
issue: No. 214
date: Saturday 7 November
---
# BANK JOB "A DISGRACE", SAY WITNESSES
> Police hunt a gang after the Pelican Rooms vault stands open at dawn.

## Account
A slanted telling of the score, one paragraph per block, at most six.

Paragraphs are separated by a blank line.

## Name
Ms. Mara Quil was seen leaving by the kitchen door.

## Hook
A reward notice for a woman in a green coat is pinned beside the story.

## GM notes
Anything under a heading the app does not know is dropped: never drawn, printed, shown or sent.
```

- Frontmatter: `masthead`, `issue`, `date` (all optional).
- `# ` is the headline (the first one), a `> ` line right under it is the standfirst.
- Sections, case-insensitive: `Account`, `Name` (the misspelt player-character name; `Misspelt name` also works) and `Hook`. Every other heading is ignored.
- A note needs a headline and an account to be saved. A missing name or hook is allowed and reported.
- Limits: headline 120, standfirst 240, six account paragraphs of 600, name 200, hook 240 characters.

Deferred: a full-screen render of the page on the iPad. The iPad gets the headline beat; the whole page prints.

## 3. The absent-player packet

Menu, **Absent packet** (switch `between.absent`, surface `phone`). Tick who is absent, type exactly three recap lines, send. Each ticked player gets one row in the docs store: `kind: packet`, `owner: <that player>`, `scope: player`. The store shows it to that player and the GM only.

```jsonc
{
  "v": 1,
  "at": 1793000000000,                       // ms, when it was sent
  "front": { "masthead": "...", "issue": "...", "date": "...", "headline": "...", "standfirst": "...",
             "account": ["..."], "name": "...", "hook": "..." },   // null with no saved front page
  "previously": {
    "faces": [{ "name": "Mara Quill", "role": "Ticket clerk" }],   // revealed NPCs only, at most 6
    "lines": ["...", "...", "..."]                                  // exactly three, 160 characters each: about 90 seconds read aloud
  },
  "changes": ["Stress 2 to 4", "Insight xp 1 to 3", "New harm: Level 1: Bruised ribs"],   // at most 12
  "first": false,
  "snap": { /* their own sheet at send time, for the next diff */ }
}
```

- **Changes** are a plain-language diff of the player's *own* character (owner = that player) since the packet last went to them: stress, the four xp tracks, harm, coin in the bank, stash, abilities and items. The first packet has no earlier copy, so it carries only lines you add by hand. The Menu panel has a box for those.
- **Faces** come from NPCs that are revealed (or have a first-seen time). A hidden NPC never reaches a phone.
- Nothing is pushed: the phone shows a strip, "While you were away", on the sheet and the player opens it. The phone draws everything with `textContent`.
- The packet is a normal docs row, so it counts against the 64 KiB row cap (it is far under) and a new send replaces the old one.
