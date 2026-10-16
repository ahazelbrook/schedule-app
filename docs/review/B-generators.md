# B — The generators: logic, robustness, table-readiness (read-only review, 16/10/2026)

Repo /home/user/schedule-app @ 7fce4b9. Files: app/gm/console.js, location.js, npc.js, figure-map.js, scenes.js,
engagement.js, app/gm-page.js, GM.md. Evidence from the fixture packs (checks/runtime/fixtures/gm) via throwaway
scripts in ../gen-review/{console,location,npc,misc}.cjs and the screenshots in ../shots. All unit tests pass
(gm-logic, gm-npc, gm-scenes, gm-engagement, gm-location, gm-figure, gm-page).

## 1. Keep

- Seeded mulberry32 everywhere, `replay = { id, seed, mem-before, ui }` as the single replay shape, and the
  Situations layer's second seed stream with four fixed draws so a section's seed never depends on which other
  sections appear (console.js 777-779). Exact-replay and byte-identical-classic tests back it.
- `fresh()` with the half-list window (max 20) as the repeat guard in every generator; scenes.js keys the notable
  guard by name so it survives a JSON clone (the documented one deliberate parity difference).
- The Situations composition itself: lead box, at most three one-line "Or" rows, ONE merged actions row with
  duplicates dropped, intents instead of writes (`applyIntent` returns a new state), and the accepted bargain filed
  under Loose ends automatically.
- The threat-on-screen plumbing: telegraph before the roll, spend on a 4/5, "Threat spent: clear it" merged once.
- Location glance: the Say line is built only from `playerSummary` fields; bands with lock counts and the ★; folds
  with hints; the hidden-name leak scan; `wording shortened in folds only, never in generate()`.
- NPC: "How to play them: do this, don't say it", cast anchors with Borrow/Never, the distinct-initials guard, the
  figure retry ladder that *says* when it fell back, "Use the location".
- Street scene: read-aloud first, GM grid second, only the read-aloud goes to the iPad. Engagement: the pool shown
  before rolling, 0d = 2 keep lowest, the "cut to the middle" line.
- Sparse-pack honesty: "The pack has no scenes part. Update the pack."; `[TODO]` strings rather than silence.

## 2. Findings (prioritised)

Replay column: "none" = text/presentation only; "SIT" = changes what a stored Situations card redraws as (bump
COMPOSE_VERSION; Classic and vault parity untouched, Situations do not exist in the vault); "PARITY" = would change
classic draws (do not do lightly).

### B1 · P1 · The result is below the fold on the laptop
- Evidence: shots/gm/01b-gm-classic.png and 01c-gm-situation.png (1280x900): after a roll the card header ("7 HARM &
  RESIST", "4 SOMEONE / FACE") is the last thing visible; the lead line is off screen. DOM order in `layout()`
  (gm-page.js ~1002): mini, controls, buttons, singles, cardbox, earlier. `stamp()` (1288) draws the card and never
  scrolls; the only scrollIntoView calls are Find/Prep/peek.
- Proposal: on the laptop layout render the card first in the console column once one exists (CSS `order` on
  `.gm-cardbox`, or move `#gm-card` above `#gm-buttons`), and/or shrink buttons to the mini row after a roll;
  minimum: `scrollIntoView({ block: 'start' })` in `stamp()`. Effort S. Replay none.

### B2 · P1 · "Someone" with a chosen friend answers as a different friend, and its two rolls disagree
- Evidence: `planFor()` 757-760 hands contact() only `{ pc: owner.name }`; contact() 621-624 draws
  `fresh('contact', pairs)` over ALL that PC's friends. Fixture (Pip: Marge Teacup, Old Bert), 2000 cards with
  `npc = friend:Marge Teacup`: the Contact lead is another friend 1000 times (50 %); Contact result != Or NPC
  reaction result 1290 times (65 %) — e.g. lead "Marge … for a price" + Or "Grumpy: no" for the same person.
  GM.md documents the first half as known; at the table it reads as the wrong answer.
- Proposal: a hint the classic ui never sets (`ui.contact = 'Marge Teacup'`) that contact() honours by filtering
  pairs; and make the Or reaction either read the Contact's dice (`res`) or be dropped for a friend (the Contact card
  already is the reaction). Effort S/M. Replay SIT.

### B3 · P2 · The 4/5 and 1–3 lead line is a bare category word
- Evidence: 2000/2000 fixture 4/5 cards lead with "Harm", "Reduced effect", "Complication"… (consequence() 480:
  `say('**' + c[0] + '**')` is the headline; `meta.text = all[0]`). The actionable "Like: The soup is lukewarm" /
  "Level 3: Fight sprain A" sits under More. The Earlier chip is "A 4/5: Harm".
- Proposal: compose the section lead as `kind — example` (and `label` the same) in `con.situation()`; or put the
  example into the want line's `small`. Effort S. Replay none (labels of old history chips change on redraw).

### B4 · P2 · Duplicate and contradictory sections on one card
- Evidence (fixture, 2000 cards each): 4/5 lead is "Complication" while an Or Complication row shows a different
  complication: 561 (28 %). 1–3 lead is "Harm" while Or Harm & resist shows: 375 (19 %), with a DIFFERENT harm name
  227 of those (both pick from `sc.harm[lvl-1]` independently: "Fight bruise A" vs "Fight bruise B"). `planFor()`
  744-751 is fixed before the lead is known.
- Proposal: plan the Or rows after the lead's kind: lead Complication → no Or Complication (promote Callback /
  Pay the price); lead Harm → no Or Harm (the lead already carries Resist). Seeds stay per slot. Effort M. Replay SIT.

### B5 · P2 · With a threat set, the table draw is demoted under the spend sentence
- Evidence: complication() 459-463: the want line becomes "the dog is waking up becomes a muddle." and the drawn
  complication ("Pillow 1") is a dim `read` line; the Or row shows only the spend sentence. Consequence lead reads
  "the dog is waking up bonks them. Harm" with the example buried.
- Proposal: keep the draw as the want line, the spend sentence as `small` ("spends: the dog is waking up").
  Effort S. Replay none.

### B6 · P2 · Location "Flags" fire on every roll
- Evidence: glance() 696-699 adds "N ring-skips (…)" whenever `o.skips.length` and "District rule" whenever
  `o.special`; every room with `connects` yields a skip (location.js 400-407) and most districts have a rule:
  1500/1500 fixture rolls carry flags; screenshot 02 shows "! 1 ring-skip (pell21 stairs)" as the only flag. A
  flag that is always on is not a flag.
- Proposal: ring-skips to the Plan hint (already "Vexa17 style · 2 skips") and the band rows; show the rule TEXT
  (shortened) instead of the words "District rule"; keep Flags for off turf / tier / clash / paranormal. Effort S.

### B7 · P2 · Pin and Copy text is mostly repeated coaching, and pins get cut
- Evidence: `situationPlain()` (gm-page 598-609) includes every `read` line; fixture 4/5 cards are 1200-1800 chars
  (a 4-section card 1799) against the 1500-char pin cap (`pin()` ~2170). Every Consequence card repeats "Telegraph
  first…", every Pay the price "Reach for this third…", every Contact "Session 1's lesson…", every Bargain "Say it
  before the dice…"; in Classic they are on screen on every card.
- Proposal: mark these lines in console.js (`coach: true`, or kind `'coach'`): the page folds them under "Why"
  (or hides after N views per device) and Pin/Copy/L skip them; pin = title + lead + Or leads + grid rows. Effort S.
  Replay none.

### B8 · P2 · console.js on an old or sparse pack: "undefined" in text, or a throw
- Evidence (gen-review/console.cjs): empty `T.district` → bargain "Someone in undefined saw the spoon." (fill()
  384-388, fresh() on an empty list returns undefined); missing `T.spend[kind]` → TypeError in consequence() 480;
  missing `T.say3[result]` → TypeError in reaction() 554. `validatePack()` (gm-page 103-125) only checks that the
  console/location parts and their `T` exist. The page toasts "The roll failed" — the GM gets nothing.
- Proposal: `fill()` falls back to a neutral word; `T.spend[c[0]] || '**{t}** lands.'`; default say3 triple; a
  pack-time table check listing the missing keys. Effort S. Replay none (same draws).

### B9 · P2 · location.js throws when no faction has a dossier
- Evidence: rumour code 449: `pick(detailed)[0]` with `detailed = []` → "Cannot read properties of undefined";
  reproduced with `T.factionDetail = {}`. Real packs have dossiers, so this is an old-pack risk only.
- Proposal: `detailed.length ? pick(detailed) : pick(T.faction)` keeps the one draw (parity safe). Effort S.

### B10 · P2 · Two bargains on the card, one "Accepted" button
- Evidence: devilsBargain() 433-445 with a printed district bargain shows the printed line plus "Or: …", but
  `action('Accepted: they owe it', { text: lead })` files only the printed one; the Or (often the threat line) cannot
  be filed. Proposal: one action per bargain, labelled with the first words. Effort S. Replay none.

### B11 · P3 · Pay the price 66 → "roll twice more" loses the Collected button
- Evidence: payThePrice() 536 sets `row = null` on 66, and 547 checks `row && row[0] === 61`; fixture seeds 116 and
  266 show "d66 61: A devil's bargain comes due: …" with no action. Proposal: scan the extras. Effort S.

### B12 · P3 · Vault author notes on the table card
- "`[flagged for Alex]`" (payThePrice 543, on 21 at 1–3); "[TODO: Fixture Manor prints no staff-side room…]" (ways
  in, location 392, when a theme has no working/controlled also-room); "[TODO: neither a dossier nor a thumbnail…]"
  (575/581 opposition fold). Proposal: neutral wording ("No staff door is printed: invent one"). Effort S.

### B13 · P3 · Engagement title shows a negative pool
- "Smash — -1d" (engagement.js head() 89 `pool + 'd'`); the Roll row then correctly says "0d — rolled 2, kept the
  lowest". Proposal: `Math.max(0, pool) + 'd'` and "(2d, keep lowest)" when ≤ 0. Effort S.

### B14 · P3 · NPC: NaN quality on a string tier; silent portrait failure
- npc.js 457 `f[1] + drift`: a pack whose tier is "3" gives "Quality NaN — roll NaNd" (reproduced). `Number(f[1])`.
- gm-page `npcWithFigure()` 1778-1783 swallows a figure/portrait throw: no portrait and no note (the fallback note
  only covers the archetype rung). Fixture + kit: 0 fallbacks in 300 rolls, so the path is rarely seen. Effort S.

### B15 · P3 · Earlier chips do not identify the card
- Labels: "Someone: Helpful: they get on with it" (no NPC name), "Before the roll: Want +1d? Whatever you roll,
  this co…" (10 of 38 chars on "Want +1d? "), "A 4/5: Harm". Entries carry `at` and `ui.pos` but the chip shows
  neither. Proposal: strip the prefix, include who/example, show "21:14 · risky" on the chip. Effort S.

### B16 · P3 · Harm example doubles "Level" without a scene
- consequence() 495-497: "Like: Level 2: Level 1 Bump · Level 2 Bruise · Level 3 Sprain." (c[2] appended whole).
  Take the entry for `lvl` when c[2] splits on " · ". Effort S.

### B17 · P3 · Dead guard in devilsBargain()
- 424-427 computes `veteran` for scene '' as well, but 441 prints the arsenal row only for 'fight'. Either show it
  on any-scene or drop the branch. Effort S.

### B18 · P3 · Redundant chips in Situations
- "Result: 4/5" on every section of a card titled "A 4/5" (chips() 406); each section's `sub` repeats the position.
  Drop the result chip in situations. Effort S.

### B19 · P3 · Stale controls survive a pack change
- sanitise() 697-704 checks pos/result/scene only: "District: Gone Town" from an old pack stays as a chip and in
  `{district}` text; a `friend:X` no longer on a sheet still rolls 3d and labels X "a friend". Effort S.

### B20 · P3 · Predictable alternation on short lists (note only)
- fresh() window = floor(n/2): controlled 1–3 allows two kinds, so Consequence strictly alternates Worse position /
  Lost opportunity. Vault behaviour; changing it breaks parity.

### B21 · P3 · The Secure band is labelled "the target" while ★ sits elsewhere
- The approach seats the target in public/working too (fixture: 501/1500 public via Talk/Fast). The glance uses the
  short label, so only the Reference fold's full labels contradict the ★. Effort S.

## 3. Ideas without new vault tables

1. **A "say this" line on every console card**: the lead becomes the example/dialogue (B3, B5); the category is the
   small kicker. For Reaction the `say3` triple is already that line; for Face the NPC's say line; for Harm
   "<name>, level N".
2. **Severity on the card**: a chip "risky → 2 winds · harm 2" (from `con.positions`) so a pinned/Earlier card keeps
   its position; the Position switch shows it now but the card does not travel with it.
3. **Current district across generators**: `con.live.district` already exists; Street scene, Location and NPC each
   keep their own. One "District" in the GM state (bar chip) that pre-fills all four, with "Use the street" /
   "Use the location" buttons (the latter exists) — chaining Street → Location → NPC in three clicks.
4. **Re-roll just this line**: section seeds are already per slot; a per-section "↻" that overrides that slot's
   seed (`replay.seeds = { consequence: n }`) re-rolls one row without touching the others. Compose version bump.
5. **Tonight**: every roll already lands in `hist` (5) and `L` captures one; a running strip of tonight's labels
   (title · lead · time · position, ~60 bytes each) exported into tonight's note.
6. **Someone → full NPC**: a "Make them an NPC" button on a Face/Reaction card opening N with the district/faction
   (the Use-the-location pattern), filing the generated card back as the Face's page.
7. **Location: a plan in one sentence** under Say: "Front via <street>; target <room> in <band> behind <n> locks;
   back route <circulation>" — all fields already on the roll.
8. **NPC header carries the die pool**: Quality/attitude chips up beside the role line (they sit between the play
   grid and Levers now); the look + want lines are the "say this".
9. **Coaching lines hide after N views** per device (localStorage count) or a "Coach" toggle (B7).
