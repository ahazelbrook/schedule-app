# The cast: NPC portraits and "on stage" (Phase 4)

The GM keeps a gallery of NPCs drawn in the rulebook style, reveals them when the crew meets them, and puts one "on stage"
so every open screen shows who is in the room. It works on the hosted build (a `npcs` table in D1) and in the claude.ai
artifact (a plain `npcs` collection in its db). The figures come from the figure kit (`app/figures/figure-kit.js`);
the creator's steps are not used or touched.

Files: `app/cast-page.js` + `app/cast.css` (the page and the banner), `app/figures/npcs.js` (the seven starting NPCs as
data), `functions/_lib/npcs.js` + `functions/api/npcs/` (the API), `migrations/0003_npcs.sql`, the `npcs` collection in
`app/runtime/cf.js`. Checked by `checks/api/npcs.mjs`, `checks/runtime/adapter.test.mjs` and `checks/runtime/cast.e2e.mjs`
(`npm run check:cast`).

## The data

An NPC is one document in the `npcs` collection (D1 table `npcs`: `id, campaign, created_at, updated_at, deleted, doc`):

```js
{
  name: 'Grunt',            // required, at most 80 characters
  alias: '', role: '', faction: '',   // at most 80 each; shown under the name as "role · faction"
  description: '',          // at most 2000: what the players read
  spec: { ... },            // a figure kit v2 spec (at most 32 KB); K.portrait draws the mugshot, K.render the full figure
  revealed: false,          // true: the players can see this NPC
  firstSeen: null,          // ISO time, set the first time the NPC is revealed or put on stage
  tags: [],                 // at most 20 short strings
  gmNotes: ''               // at most 8000; never sent to a player
}
```

The server adds `createdAt` and `updatedAt`. Unknown fields are refused (400), so a typo never disappears quietly. Ids look
like `npc_brackley` (the seeds) or `npc_<name>_<time>` (made in the page).

`campaign.scene = { npcs: { <npcId>: true | false }, at: ISO }` in the shared campaign document says who is on stage. It is a
map, as the campaign document's convention asks for anything several people might write, and an NPC leaves it as `false`
(a PATCH merges, so a removal is written, not left out). `at` is bumped by every change of the stage; it is what a player's
"Hide" is keyed to. Without a `scene`, nobody is on stage. A scene stays until the GM clears it.

The seven starting NPCs (Brackley, Grunt, Karla, Major Fellows, Mira, Skinner, Zam) are inserted by the migration with
`INSERT OR IGNORE`, hidden, in the campaign `default` (`wrangler.toml` `CAMPAIGN`). Their descriptions are the GM's own words,
verbatim. The artifact has no migrations, so there the GM gets "Add the starting NPCs" when the cast is empty, which loads
the same documents from `app/figures/npcs.js` on that click only. The page never loads that file for everyone (it holds
hidden NPCs), and the hosted build does not publish it at all (`app/.assetsignore`), so a hosted deployment whose campaign is
not `default` adds them by hand or by copying the migration's rows. `checks/api/npcs.mjs` keeps the migration and that file
identical.

## Who sees what

| | GM | player |
|---|---|---|
| `GET /api/npcs`, `GET /api/npcs/:id` | every live NPC, `gmNotes` included | only revealed ones, **without** `gmNotes`; a hidden NPC answers 404 like a missing one |
| `POST`, `PUT`, `PATCH`, `DELETE` | yes (the doc is validated) | 403 on every one, before the body is read |
| `GET /api/export` | the file carries `npcs`: all of them, hidden ones and notes | 403 (the whole endpoint is GM only) |
| `campaign.scene` | writes it | reads it; any change is 403 (`playerMayWrite`: it is not one of the player paths) |

Hidden NPCs and `gmNotes` are filtered on the server, in the query, and again on each parsed document; a player's browser is
never sent them. This is real secrecy on the hosted build. **In the artifact it is presentation only**: the collection is
shared, so anyone with the artifact open could read a hidden NPC's document (as with hidden clocks). The page still hides them,
but do not put anything in an artifact's `gmNotes` you would mind a player finding.

The banner only shows an NPC the viewer would see in the cast: one that is revealed and still exists. Hiding or deleting an NPC
who is on stage takes them off the stage too (the GM's page writes both; a player's page would not show them anyway).

## API (Cloudflare)

- `GET /api/npcs` → `{ now, docs: [ { id, doc, updatedAt } ], npcsUpdatedAt }`, newest change first, at most 300.
- `POST /api/npcs` body = doc → `{ id, doc }` (GM; the server makes the id).
- `GET /api/npcs/:id` → `{ id, doc }`; `PUT` whole doc (creates, or replaces; a deleted id is free again) → `{ id, doc }`;
  `PATCH` partial doc, deep merge (objects merge, arrays and scalars replace, null removes a key), then validated → `{ id, doc }`;
  `DELETE` → tombstone, `{ ok: true }`. 400 for a bad id or doc, 413 over the size caps, 404 for a missing one.
- `GET /api/characters` (and `?since=`) carry `npcsUpdatedAt`: the newest `updated_at` of any NPC row, tombstones and hidden
  rows included, so the adapter knows when to refetch `/api/npcs` without a second poll. It tells a player only *when* the GM last
  touched the cast, never what changed.
- `PATCH /api/campaign` accepts `scene`: it must be an object whose `npcs` maps at most 100 ids to true / false / null and whose
  `at` is a time or null (400 otherwise); only the GM may change it.

## Adapter (`cf.js`) and the artifact

`db.collection('npcs')` has the characters collection's interface: `where` / `orderBy` / `limit` over the cached list,
`get()`, `onSnapshot()`, and `doc(id)` with `get()`, `set()` (PUT), `update()` (PATCH), `delete()`, `onSnapshot()`. Snapshots
are `{ id, exists, data(), metadata }`; a query snapshot is `{ docs, size, empty, forEach }`.

- The cast is cached beside the characters and shares the poller. Each characters poll reports `npcsUpdatedAt`; **only when it
  differs from the stamp of the cached copy does the poll go on to `GET /api/npcs`**, and nothing is fetched while no one
  listens to `npcs`. A quiet table therefore costs no extra request. The page itself only subscribes when someone opens the cast
  or the stage names an NPC.
- Writes go through the same ordered, offline-surviving queue as everything else (kind `npc`): applied to the cache at once,
  sent in order, retried while the network is out, a refused one dropped and the cast resynced. A player's write is refused
  immediately in the adapter (403, nothing is sent), as the server would.
- The last loaded cast is kept in the offline snapshot, so a phone that starts offline still shows it.
- In the artifact there is no `cf.js`: the same collection is the artifact db's, written by the GM's page (`user.canEdit()`),
  with the hiding done by the page. If a runtime has no db, or throws on the collection, the cast page says it needs the shared
  files and nothing else breaks.

## The page

Routes: `#cast` (the grid), `#cast/<id>` (one NPC), `#cast/<id>/edit` and `#cast/new` (GM). Entry points: "The cast" on Home
(every variant) and on the table page. Back and Forward work as everywhere else.

- **The grid.** A mugshot (`K.portrait`) per NPC with name, alias, role · faction and the description. The GM also sees a
  Hidden / Revealed / On stage badge, filters (All, Revealed, Hidden, On stage), and per card **On stage** (off stage when it
  is), **Reveal / Hide** and **Edit**; plus New NPC and Clear stage. Two columns on a phone.
- **One NPC.** The full figure (`K.render`) as tall as the screen allows, the name in poster type and the description large:
  made to be shown on a laptop to the table. The GM adds the same three controls and the GM notes.
- **The editor (GM).** Name, alias, role, faction, description, tags (commas), GM notes, Revealed. The figure: **Start from**
  one of the archetypes in `figures/cast.js` (or a blank figure), **paste a spec** (the textarea is always the current spec;
  edit it and press Use this spec), or adjust with dropdowns that are generated from `K.options()` (figure, height, age, shape,
  build, skin, body, head, eyes, brows, nose, mouth, expression, facial hair, eyewear, hair and colour, hat, stance, both arms,
  nine clothing slots with a colour each, and props). A live mugshot and full figure show beside it, with the kit's warnings.
  Save writes the whole document (PUT); Delete asks first. Nothing in the character creator (`steps.js`) is used.
- **On stage.** The GM's **On stage** button reveals the NPC (`revealed: true`, `firstSeen` set when empty) and then writes
  `campaign.scene`, in that order, so no player is ever told about an NPC they were not sent. Several NPCs can be on stage.
  **Clear stage** (the cast page, and the banner) sets every entry to false.
- **The banner.** A sheet fixed to the foot of every screen (not in print): the portrait, name, role and description of each
  NPC on stage, for everyone, within one poll (about 4 s). Tapping the portrait opens the large view. A player can **Hide** it;
  that is remembered in this browser (`localStorage` `b68.stage.dismissed` = the scene's `at`), so it stays hidden through a
  reload and **comes back when the stage changes**. The GM can hide it too, and has Clear stage on it.

## How to show an NPC at the table

1. Open **The cast** (Home, or the table page) and find them. They are dashed and marked Hidden until you reveal them.
2. Press **On stage**. They are revealed, and within a few seconds every player's screen shows their portrait and description
   at the foot of the page. Open **their name** to put the big figure on the laptop for the table.
3. Put someone else on stage and the banner returns for anyone who hid it. **Clear stage** when the scene is over; they stay
   revealed, so the players keep them in their cast.
4. **Reveal** and **Hide** change whether the players can see an NPC at all, without touching the stage (hiding one who is on
   stage also takes them off).

## Limits and notes

- The kit has no part for some of what the descriptions mention, so a few details are approximated in the seven specs
  (below); the GM can change any of them in the editor, or paste a spec drawn with the Blades '68 figures skill:
  - Brackley: the kit's only moustache is a chevron, so the "walrus" is as heavy as it gets; the patches are shown by an
    M65 field jacket with the epaulettes off; the barge is flies round his head; the duplicate record is a ledger in his hand.
  - Grunt: no marks on arms, so the "map of old bites" is only the rolled sleeves on bare, heavy forearms.
  - Karla: glasses cannot be worn pushed up into the hair and there is no pen, so she has neither; the folders are one folder in her hand.
  - Major Fellows: the Watch tunic in khaki stands in for an army uniform; the fountain pen is not drawn, the folder is a book.
  - Mira: keys at her belt are a brass chain belt; the club, the bar and the baths are not drawn (figures stand on a plain ground).
  - Skinner: no seated pose and no knife (the hands are held together), so the jumper (a cable knit) and the bony frame carry him.
  - Zam: no sitting on a bonnet, and a jacket cannot have rolled sleeves, so the oversized suit jacket (ease 0.12) stands for
    "a man's jacket"; the odd shoes are red plimsolls; the keys are a chain belt.
- Roles and factions are only filled where the description says something (Brackley "Barge man", Fellows "Army officer", Mira "Owner" /
  "The Undertow"); the rest are left for the GM. No `gmNotes` are seeded.
- Backups: "Download everything" (hosted, GM) includes `npcs`; **Restore does not read them yet**. To move a cast to another copy,
  paste the specs and descriptions in, or apply the migration there and copy the rows.
- Not done (Phase 4 in ROADMAP.md): a log line when an NPC appears, and a cast page in the season print.
- Deploying: `scripts/deploy.sh` applies `migrations/0003_npcs.sql` (the table and the seven rows). The service worker cache name
  is bumped, so installed phones pick up the new page on their next visit online.
