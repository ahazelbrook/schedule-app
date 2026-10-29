# RUN THE JOB (v2): state at 29/10/2026

**Built and merged (VV1 to VV10, PRs #108 to #117).** The Run tab's v2 view, publishing to the players, the iPad band,
the phone's Mission card, End the night, the alarm buttons and the server's cleanMission. Documented in GM.md, "Run the job (v2)".

**Still to do.**
- Tue 3/11: the release gate, then deploy, then the real level pushed as the location part.
- Wed 4/11: the smoke test. Three beats with two phones.
- Thu 5/11: last deploy.

**Known follow-ups.**
- A 9th card is dropped silently (the server caps cards at 8).
- The hud is served without a re-clean.
- Costume emoji to check on the iPad.
- An old GM page left open across the deploy prints "[object Object]" in the v1 strip for a v2 ball.

# RESUME HERE (updated 17 Oct 2026, morning AEDT)

**State.** `main` is live: Worker `47f70eaf`, deployed 17 Oct (a game day, on Alex's go-ahead), rollback
`npx wrangler rollback 656410da`. Every PR from #14 to #29 is merged and deployed. The vault keeps the deploy history
(its app plan page, "Status 17/10/2026"); `GM.md` describes every panel as it now stands.

**The Downtime panel (D) and the Morning After** (the vault's house rule, version 3; PRs #26, #27 and #29). Personal
business at the table: tap the PC, the activity, then the result. Indulge vice shows the night (a picture, then the line
the host says), then **the morning after**: the player's d100 on the **Benefits** (Indulged) or the **Mishaps**
(Overindulged), roll high on both. The card shows the entry the number lands on and one more from its band; **Keep**,
**Another** and **Change** let the GM choose. A Mishap names one of the book's six overindulgences as its cost. The two
tables come from the vault note into the private `downtime` pack part (`{ v: 2, T: { benefit, mishap } }`, 50 + 50,
zine-derived, so never in git). The vice scenes are original writing in `app/downtime-tables.js`. Checks:
`gm-downtime.test` (13), `gm-downtime-export.test` (4), `gm-page.test` 17a–17m (113), `gm.e2e` (237, laptop and phone).

**How the deploys went on 16–17 Oct** (every one worked this way):
1. A clean worktree of `origin/main`, with `node_modules` linked in and the git-ignored media copied from the GM's PC:
   `app/ambient/calling-cards.html`, `tools/ambient/cards/` and `app/media/theme.mp3`.
2. On that copy, unstamped: `npm run check:runtime`, then the API checks one by one (`checks/api/clocks.mjs` can't run
   on Windows: its setup chain breaks; the rest pass).
3. Stamp `var BUILD` in `app/routes.js` as `<UTC date>-<commit7>`, so open pages show "Updated: reload".
4. `npx wrangler deploy`; then check that every path answers 302 to Access.
5. A changed pack part goes up on its own: build the pack, write a file holding only that part, and run
   `npm run gm:push -- --only pack --pack <file> --yes` (the other parts stay as they are). Push the code first when a
   part's shape changes.
6. Remove the worktree (unlink `node_modules` first) and `git pull` main.
`npm run deploy` (scripts/deploy.sh, SETUP.md "Updating the app") is the route documented for Alex; it also re-uploads
the Access secrets and can rewrite the Access policy.

**Claude at the table (build in progress, branch `assist-files`, WP1 done).** The assist prefix now lives in Anthropic's
Files API: `gm:push` uploads it (needs `B68_ANTHROPIC_KEY`), the Worker holds only a file id, Ref runs at low effort and the
closer seat is retired. Resume with the next work package on the plan page; the `assist` part must be re-pushed after the
code is deployed (see GM.md, "Claude at the table").

**Then, in order:**
1. After tonight's session (17 Oct): `npm run gm:after` (a plan by default; `--yes` files the night into the vault),
   and see how the Downtime card played at the table.
2. Open items: a full pass on Safari and the real iPad; delete the stray `schedule-app` Worker in the Cloudflare
   dashboard; make the repo private (Alex); the NPC figure-map vault page; the vault district-scenes repeat-guard bug.
3. Optional ideas: re-roll one row, "Make them an NPC", chaining Street → Location → NPC; E16 util.js; lazy loading
   phase 2; move the vice scenes into the vault too (a pack part can already replace any table), if Alex wants to edit
   them there.

**How to start the next session:** "Read TODO.md on main and follow RESUME HERE."

---

# TODO: the fresh-eyes review (16 Oct 2026)

The central list for the review-and-improve pass. Update it as items land (move them to **Done** with the commit), so
the state survives a session running out. Severity: **P1** wrong or misleading at the table · **P2** slows the GM or a
player down · **P3** polish. Effort: S (under an hour) · M (an evening) · L (a weekend). Never deploy on a game day
(next: Sat 17 Oct 2026). The four review reports are not in the repo (they quote fixture text); their findings are
numbered here the same way (A = GM page, B = generators, C = players' side, E = engineering).

**How the work is organised.** Wave 1 runs as five branches at once, each on files the others do not touch, then
merges into `ccr-e0dcd379-q104ac` (draft PR #26). Wave 2 is the items that cross those file boundaries or depend on a
wave-1 merge. Everything merges only with the checks green (`npm test`, the e2e checks the branch touches).

## Wave 1 (in progress)

### 0. The iPad display: reported bugs (branch: ambient) · MERGED 16 Oct (9a356eb)

- [x] P1 · The planning-meeting scene lags on the iPad (3.1 MB svg, 550 motion groups, 8 filters / 12 feTurbulence, a
      24 fps loop rewriting transforms). Fix in the generator (tools/ambient), regenerate. · M
- [x] P1 · The opening-credits theme is silent on the iPad (file missing on the server / audio unlock / WebAudio and the
      mute switch). Diagnose, fix, and make the display SAY which it is. · S-M
- [x] P1 · Figures' heads sometimes disappear (the motion merge leaves a frame with no version of a part, or a clip path
      inside a hidden group that WebKit will not resolve). Fix in motion.js, regenerate, prove with a frame walk. · M

What was wrong, and what changed (measured in WebKit, the iPad's engine, since Chromium hides two of the three):
- **Lag.** Every cut (a figure changing pose) re-rendered the whole figure's grain filter (feTurbulence) on the main
  thread, `display:none` frames rebuilt their filters when shown, and the smoke repainted Alfie every tick. Now the
  figure grain is a small baked tile, hidden frames use `visibility:hidden`, and the scene is four composited layers
  like the tram. Whole scene: 531 → 209 ms CPU per second; a cut 236 → 90 ms; painting per tick 5.5 → 0.6 ms.
- **Heads.** 8 of the 11 scenes with moving figures had duplicate ids inside their figures (85 in the meeting: three
  hair masks sharing one id; the head clip was the union of all five head shapes). WebKit and Chromium resolve
  duplicates differently, so ears and shading went wrong or vanished on the iPad only. motion.js now gives every
  version its own id and refuses to build unless each frame extracted from the merged figure equals its own render;
  `checks/runtime/ambient-frames.test.mjs` walks every figure and frame (in `check:ambient` and `check:runtime`).
- **Theme.** It played through Web Audio, which the iPad's silent switch mutes; the unlock listened for pointerdown,
  which iOS does not count as a tap; and theme.mp3 is gitignored, so a deploy from another checkout ships none. Now one
  `<audio>` element, `play()` inside the tap, the corner of the iPad and the GM page's iPad panel say when the file is
  not on the server, and "Tap for sound" shows while the credits wait.
Not provable here: the real frame rate on the iPad, audio unlock with a finger and the silent switch. Check both at
the next session: pin the planning meeting for a minute, then pin the credits and tap once.

### 1. The GM page: quick access (branch: gm-page) · MERGED 16 Oct (f8c9d5f)

Keep: the Position switch; the four Situations and the composed card; single-letter keys; the one-window laptop layout;
Find; the location glance card and its secrecy gate; the rail; capture; the beat pill.

- [x] A1 P1 · The result card is the last thing in the console column, below the fold at 1280×900. Card under the four
      buttons; Scene controls folded behind a labelled one-line disclosure at every width; single tables under "More
      tables"; scroll the card into view on a roll. · M
- [x] A2 P1 · Focus hides the roll: keys 1-4 still roll but the card is display:none. A roll leaves Focus. · S
- [x] A3 P1 · Phone: the first screen is the site header, H1, pack note and four admin buttons. The app layout (44 px
      bar + menu) at every width. · M
- [x] A4 P1 · Phone: ten segments, five visible, no scroll. Two rows. · S
- [x] A5 P2 · Classic 3×3 breaks words mid-syllable at 1280. · S
- [x] A6 P2 · Tab key hints hidden between 1100 and 1439 px. · S
- [x] A8 P2 · "GM ONLY" badge on every fold of an all-GM page; mark what PLAYERS SEE instead. · S
- [x] A9 P2 · "Put on stage" navigates away mid-scene; stage from the GM page. · S-M
- [x] A10 P2 · Keys vs typing: R/T focus the pane's find box; H needs Shift or a double tap. · S
- [x] A12 P2 · A location roll draws the rings map at once. · S
- [x] A13-A18, A20, A21 P3 · Labelled scene chips; toasts above the capture input; the Situations|Classic toggle,
      Display link, Export and Forget into the Menu; "GM screen"; larger labels; Listening pill only once used; map
      View/Theme folded. · S each
- [x] A7 P2 · One "Now in" district that the console, Street, Location and NPC default to (done). · M
- [x] A11 P2 · Rules search results inside the GM screen pane, not a new tab (done). · M
- [x] A19 P3 · Engagement factors as three-chip segments (done). · S

Also landed: the Classic console view and Classic layout removed (one mode); rules entries in Find (Ctrl+K); the
Prep outline's find box one line tall. Checks on the branch: gm-page unit 68, gm.e2e 168, gm-scenes 34, gm-npc-panel
41, gm-prep 62, rules 96, the secrecy scan clean.

### 2. The generators (branch: generators; pure modules only) · MERGED 16 Oct (4d8a1df)

Keep: seeded replay with mem-before; the second seed stream for situation sections; the lead box / Or rows / one actions
row; the location Say built only from player-safe fields; the NPC figure ladder; read-aloud first on street scenes.

- [x] B2 P1 · "Someone" with a chosen friend answers as a different friend half the time, and its Contact and Or
      reaction disagree two thirds of the time. Honour the chosen NPC; one person per card. · S-M (compose version bump)
- [x] B4 P2 · The 4/5 and 1-3 cards carry a twin of their lead (28% / 19% of rolls, often contradicting it). Plan the Or
      rows after the lead's kind. · M (compose version bump)
- [x] B10 P2 · Two bargains shown, one Accepted button. · S
- [x] B11 P3 · Pay the price "roll twice more": extras get no Collected action. · S
- [x] B8 P2 · Sparse pack: "Someone in undefined", throws on a missing T.spend / T.say3. Neutral fallbacks and a key
      check at pack time. · S
- [x] B9 P2 · location.js throws with no faction dossiers. · S
- [x] B14 P3 · NPC "Quality NaN" when a tier is a string; silent figure failures. · S
- [x] B19 P3 · Stale district / pc / npc choices survive a pack change. · S
- [x] B3 P2 · The 4/5 and 1-3 lead is a bare category word ("Harm"); the usable example sits under More. Lead = kind —
      example; Earlier labels too. · S
- [x] B5 P2 · With a threat set, the drawn complication is demoted under the spend sentence. · S
- [x] B6 P2 · Location Flags fire on every roll (ring-skips, district rule). Skips to the Plan hint, the rule's text
      shown, Flags kept for the rare cases. · S
- [x] B7 P2 · Pin/Copy are mostly repeated coaching lines (1200-1800 chars vs the 1500 cap). Mark them `coach`; the
      page folds them (wave 2) and Pin/Copy/L skip them. · S
- [x] B12, B13, B16, B17, B18, B21 P3 · Author notes on cards; "Smash — -1d"; doubled "Level"; dead veteran guard;
      "Result: 4/5" chip on every section; the secure band called "the target" when the ★ is elsewhere. · S each
- [x] Idea 2 · A position/severity chip on the Situations card. · S
- [x] Idea 7 · Location: a one-sentence plan under Say. · S
- B20 · Controlled 1-3 strictly alternates Worse position / Lost opportunity: vault behaviour, parity; note only.

Proof: the nine classic rollers are byte-identical to main over 332,110 roll lines (9 buttons × 121 control
variants × 300 seeds, plus shared-memory runs); location, NPC and street rolls identical over 10,651 lines; sparse
packs: 150,336 rolls, no clean card changed. Stored digests keep this checked (gm-logic, gm-location, gm-npc,
gm-scenes). The vault parity script could not run here (it needs the vault): run `node scripts/gm-parity.mjs` on the
PC once after this lands.

### 3. The players' side (branches: players and players-table · both MERGED 16 Oct)

Keep: one visual language; Night as legible as Paper; the returning player's one-tap Home; the sheet's phone order
and 44 px pips; Push/Desperate writing their own cost; the offline queue; role-aware table; revealed-only cast.

- [x] C1 P1 · (Re-scoped 16 Oct: everyone rolls physical dice.) Tapping an action opens a compact "mark" strip at
      the foot of the phone: the dice count with Push / Assist / Bargain, then one row of consequence buttons
      (Resist · Harm 1 · Harm 2 · Harm 3 · +1 stress). Resist is a helper for a physical roll: tap the highest die and
      the stress is applied. The in-app roll stays reachable but secondary ("Roll in the app"), with its verdict
      scrolled into view, options locked after a roll and "Roll again (pays again)". · M
- [x] C2 P1 · The on-stage banner (262 px for two NPCs) covers the roll panel and comes back on every stage change.
      A one-line strip on phones, auto-expanded 8 s. · S-M
- [x] C3 P1 · "Remove" (deletes the character) sits 8 px from Print with a 4 s double-tap "confirm". To the foot, a real
      confirm naming the character. · S
- [x] C4 P2 · The phone sheet opens on 770 px of identity text; Stress starts at y 771; page 6171 px tall. An "About"
      fold, a sticky vitals strip with jump anchors, play-first order. · M
- [x] C5 P2 · Every tap rebuilds 722 KB of figure svg + thumbnail data URI the phone never shows (313 ms at 4× CPU).
      Lazy figure, Blob thumb. · S-M
- [x] C6 P2 · (the sheet: done in players; the table page: players-table) · Play controls 19-27 px tall; the table page has no phone hit areas. 40 px everywhere. · S
- [x] C7 P2 · Offline, the sheet says "Saved" while the change is queued; the cue is off screen. Truthful status and
      an "Offline · N waiting" pill. · S
- [x] C8 P2 · The table page for a player: a dead Schedule box first, the log 2400 px down. Hide the schedule without
      dates, collapse it for the GM, phone order clocks · log · players · crew (summary row) · schedule. · S-M
- [x] C9 P2 · iPhone zooms on focus (13 px inputs). 16 px at phone widths; touch-action: manipulation. · S
- [x] C10 P2 · No "?" rules link on Harm, Armor, Load, Position/Effect, Resist, XP. · S
- [x] C12 P3 · (the sheet's strings: done in players; Home and the table: players-table) · Code-speak strings ("the files", "Filed", "no store", "Unowned", "Indulge -1/-3"). · S
- [x] C13 P3 · Back is a button, a crumb or absent; "Open sheet" twice on Home. · S
- [x] C14 P3 · The Home status line is 10.5 px; --ink-faint at 3.3:1; no Night/Paper switch. · S
- [x] C15 P3 · Cast: after Hide nothing says who is on stage; phone detail figure 62vh before the text. · S
- [x] C16 P3 · Typing debounce not flushed on pagehide; a refused save leaves optimistic marks; play.log unbounded;
      a remote snapshot dropped during an in-flight save. · S each, careful
- [x] C17 P3 · "Plan dates" nags on Home while the schedule is parked. · S

Landed in `review/players`: the mark strip for physical dice (Push +2 stress; Assist +1 die, the HELPER pays its
stress, as the rules say; Bargain; Resist · Harm 1-3 · +1 stress), the resist helper (tap the highest die), the in-app
roll kept behind "Roll in the app" with its fixes, the one-line on-stage strip, 40 px controls and 16 px fields, the
first screen (vitals line, About fold, play-first order), the figure not drawn on phones (a tap rebuilds 52 KB, was
720 KB), Remove under "…" with a named confirm (owner and GM only), "Saved on this phone · will sync (N)", "?" links,
saving robustness (pagehide flush, refused saves undone, log capped at 200, crossing snapshots merged), the cast's
"On stage: ..." line after Hide. A table-page touch block the first agent wrote in campaign.css was taken out of
this branch (the table-page agent owns that file); its text is in `review/players-wip` (15fbac1) if wanted.

Landed in `review/players-table`: the table page for phones (clocks first with − / + steppers, the log's latest three,
the players, the crew behind a summary row, the schedule only when there is something to plan; the GM sees one line),
the Session box as one line, 40 px touch targets (95 on the table page, 82 on the crew sheet), plain words on Home and
the table, "Join session N", no schedule nags while there are no dates, the Home status line at 13 px, a Night / Paper
/ Auto switch in the footer applied before first paint, readable faint text (5.5:1) and Night accent (5.0:1).

### 4. Engineering (branch: engineering) · MERGED 16 Oct (0e8afca)

Keep: optimistic write loops with 409; role gates before the body is read; RS256 JWT with pinned alg and JWKS cache;
the display path failing closed (checkSvg + sanitiseSvg agree; markdown.js fuzzed clean); the offline queue design;
additive secrets on deploy; schema.sql = migrations.

- [x] E1 P1 · A stalled request freezes the poller and the save queue for good while the header says online (no
      timeout in cf.js api()). AbortController timeouts; adapter test. · S
- [x] E6 P2 · A player's tap after a sign-out is rejected before queueing and lost on reload. Queue it. · S
- [x] E2 + C11 P2 · The service worker is network-first with no timeout: dead venue wifi blocks launch though a cache
      exists. Race with a timeout; bump the cache. · S
- [x] Lazy loading, phase 1 + 3 P2 · 2.3 MB of JS and 230 KB of CSS load synchronously for every player on every route.
      routes.js bundles per route; index.html keeps the core; the SW still precaches everything; a build id, `?v=`
      on bundles, and an "Updated: reload" chip. · M
- [x] E7, E8 P2 · Deploy from Windows: `.gitattributes` (LF), "run from Git Bash"; the script checks the two gitignored
      files (theme.mp3, calling-cards.html), lists the five secrets present/missing, refuses a dirty tree, prints a
      receipt. · S
- [x] E9 P3 · display.test and gm-location.test not in check:runtime; the two 500-seed sweeps make npm test 3× slower
      (B68_SWEEP); a check:e2e-all script. · S
- [x] E10 P3 · Seven stale doc claims (migrations count, microphone, claude.gm calls, display's "two calls", kind
      `cards`...). · S
- [x] E11 P3 · The vault path hard-coded six times in package.json (B68_VAULT). · S
- [x] Docs consolidation · PLAN, RESEARCH, AMBIENT-PLAN, DEPLOY-PROMPT, ROADMAP to docs/history/; SCHEDULE.md marked
      parked; DEPLOY.md folded into SETUP.md; README leads with the four commands a non-programmer needs. · S
- [x] E12 P3 · A Content-Security-Policy, report-only first. · S
- [x] E13 P3 · A failed JWKS refetch after the 1 h TTL makes every call 401 until Cloudflare answers; keep stale keys. · S

Landed: request timeouts (a stalled poll or save no longer freezes the app); a write after a sign-out is queued;
the service worker answers from its cache when the network stalls (4 s pages, 8 s files); lazy route bundles (Home and
a sheet fetch 1.48 MB of JS and CSS instead of 2.54 MB; rules and cast stay in the core because every sheet uses them);
one build stamp (`app/routes.js`) shared by the page, the service worker and `/api/me`, with an "Updated: reload" chip;
the deploy script refuses a dirty tree or missing on-disk media, stamps the build and ends with a receipt
(`checks/api/deploy.mjs`); `.gitattributes` (LF); the sweeps at 100 seeds in `npm test` (`check:sweep` for 500);
`check:e2e-all` (all 26 browser checks); `B68_VAULT`; seven stale doc claims fixed; history docs in `docs/history/`;
the last good Access keys kept when a refresh fails; a full CSP sent as Report-Only.
Checks on the merge: `npm test` 580 pass; `check:e2e-all` 25 of 26 (the transcriber check fails the same four lines on
untouched main: the fake microphone does not work in this container).

**All six wave-1 branches merged (16 Oct).** On the combined branch: `npm test` 624 passed, 0 failed;
`npm run check:e2e-all` 25 of 26 (the transcriber check fails the same four lines on untouched main: the fake
microphone does not work in the build container). A race in the adapter test's poll count (a poll in flight at the
last unsubscribe landing after the count; 2 of 12 runs failed under heavy load, 0 of 12 after the fix) is fixed in
51b942d.

## Wave 2 (after the wave-1 merges)

- [x] Generators, page side (MERGED with `review/gm-wave2`):
      1. Situations card: show `sections[0].lines[0].small` under the lead (with a threat, the spend sentence); under
         More skip the lead's first line; fold `coach: true` lines under "Why" in every section.
      2. `situationPlain` (Pin/Copy/L): skip `coach` lines; put `meta.chips[0]` (the position chip) on the title line.
      3. `situationEntry` stores `composeVersion: rp.composeVersion`; `replaySituationEntry` passes it back; when
         `meta.recomposed` is set, one note line on the card.
      4. Pack warnings: in `previewPack` and at pack load, call each module's `check(T)` (console, location, npc,
         scenes, engagement) and show missing paths as warnings.
      5. Location glance: `g.plan` under Say (GM only, never to the iPad); a Rule row when `g.rule` is set.
      6. NPC portrait: show `fig.note`; no portrait when `fig.failed`; "No portrait: ..." when the kit throws.
      7. Earlier chips name the NPC and show the time and position (B15). · S-M
- [x] (MERGED, gm-wave2) E5 P2 · After Access expires mid-session the GM saver parks every later patch for good and the toast says the
      opposite. Treat 401 as pending-until-sign-in, say "reload to sign in, notes kept", resend. · S-M
- [x] (MERGED, gm-wave2) E18 P3 · Capture alone can hit the 240 KiB soft cap, after which every roll is refused; cap by bytes, drop the
      oldest. · S
- [x] E17 · Decided 16 Oct: the Classic console view and the Classic page layout go entirely (one mode). Done on the
      gm-page branch.
- [x] (MERGED e14c982) E3 P2 · Two players ticking different clocks within ~4 s lose one (the campaign PATCH sends the whole array). A
      per-clock operation applied inside the server's write loop and mirrored in cf.js. · M (contract change)
- [x] (MERGED 8b1faba) E4 P2 · Workers Free budget: an always-on iPad polls display every 2 s and stt every 4 s (≈65k requests/day);
      with two laptops open the daily cap can trip mid-session. Display 4 s, stt carried in the display GET, slow to 30 s
      after an hour without change, hidden tabs 60 s. · S
- [x] (MERGED 8b1faba) E14 P3 · The display never leaves "denied"; reload once after 10 min. · S
- [x] (MS2) Lazy loading phase 2 · The figure kit (now ~1 MB) is the `figures` bundle, loaded after the first render; the
      top-level captures became lookups (core.js shells, tracker/cast-page/schedule/season placeholders). Warm open on a mid-range
      phone measured before and after in the MS2 report. · M
- [x] (MERGED, gm-wave2) Physical dice on the GM page · The engagement roll: let the GM roll physically and tap the highest die instead
      of the app rolling (the pool is still computed by the app); the same for any GM-side roll. · S
- [ ] Ideas from review B · Re-roll one row of a card (per-section seeds exist); a "Tonight" strip of every roll beyond
      the five, exported into the note; "Make them an NPC" on a Face/Reaction card; "Use the street" chaining Street →
      Location → NPC. · M
- [x] (MERGED e14c982) Small leftovers from the players' work · "Files offline:" toast wording in boot.js (with its assertion in
      checks/runtime/display-role.e2e.mjs); "shared files" wording in cast-page.js, season.js and steps.js; season.css's
      own light-token copy of --ink-faint (#8e8880 → #6a645e); crew-sheet ability circles, upgrade boxes and contact dots
      at 40 px on touch. · S
- [x] (done 7e398a4, 9d9427b; one gm-page.js comment left) Docs sweep after the last merge · comments and docs still pointing at the moved docs (PLAN, AMBIENT-PLAN,
      ROADMAP, DEPLOY...) in app/season.js, app/gm-page.js, app/display-page.js, app/README.md (also: list routes.js),
      CAST.md, CAMPAIGN.md, functions/_lib/gm.js, functions/api/gm/ambient.js and display.js; AMBIENT-PLAN's decisions
      into GM.md. · S
- [x] (MERGED 1637354; live 17 Oct with PR #26) Downtime generator (Alex, 16 Oct): personal business at the table, the GM
      page's **D** panel. Indulge vice with the overindulgence's cost and a clock; Recover, Long-term project, Train, Friend
      or rival, Lay low, Acquire. `app/gm/downtime.js` (logic), `app/downtime-tables.js` (the writing), boot's
      `characters()` and `addClock()`. · M Since then (17 Oct) Indulge vice is the vault's house rule the Morning After:
      Good Mornings in PR #27, then the d100 of Benefits or Mishaps with two cards to choose from in PR #29 (RESUME HERE).
- [ ] E16 P3 · One app/util.js for the twelve copies of esc/isObj/clone (adopt per touched module). · M

## Later or parked

- Scheduling (phases 2, 3, 6 of docs/history/ROADMAP.md): November/December.
- E11 · The seven hidden NPCs' names and look lines are in the public repo (`app/figures/npcs.js`, migration 0003).
  Decided 16 Oct: leave as is.
- E12 · Make the CSP enforcing once the report-only header shows nothing for a few sessions.
- Vendored map kit bug: the player layer titles a plan/section level after a hidden room (worked around in the page).

## Decisions (16 Oct)

1. The NPC seed in the public repo: leave as is.
2. Classic view and Classic layout: removed; one mode.
3. The phone roll panel as a bottom sheet (C1): yes, try it. Then: everyone rolls physical dice, so the strip is for
   MARKING what happened (stress, harm, resist), and the in-app roll is secondary.

## Handover: how to pick this up in a new session

Everything is on GitHub, nothing lives only in a container.

- **This branch** `ccr-e0dcd379-q104ac` (draft PR #26) holds this list and `docs/review/` (the four review reports:
  A the GM page, B the generators, C the players' side, E engineering; their findings are numbered as above).
- **Wave-1 work branches on origin.** Each agent pushes its branch after every commit, so GitHub always holds the
  latest committed state. The first five agents ran on Fable and stopped at its usage limit (16 Oct, 06:00 UTC); six
  agents restarted on Opus/Sonnet from where each stopped (the players' work split in two):
  | branch | holds |
  |---|---|
  | `review/ambient` | section 0, the three iPad bugs · MERGED |
  | `review/generators` | section 2, the pure generator modules |
  | `review/gm-page` | section 1, the GM page (Classic removed; A7 and A11 last) |
  | `review/players` | section 3, the phone sheet: the mark strip and resist helper, the first screen, the cast banner |
  | `review/players-table` | section 3, the table page, Home, plain words, the Night/Paper switch |
  | `review/engineering` | section 4, timeouts, the service worker, lazy loading, the deploy receipt, docs |
  | `review/clocks` (+ `-wip`) | wave 2: clock ticks that never overwrite each other (E3) and the small players' leftovers |
  | `review/display-budget-wip` | wave 2: the iPad's polling budget (E4) and reload after sign-out (E14) |
  | `review/gm-wave2` | wave 2 on the GM page: the new generator fields on the cards, physical dice for the engagement roll, E5, E18 (started from the integration branch after generators and gm-page merged) |
  `review/*-wip` are snapshots of uncommitted work saved when the first agents stopped; ignore them once the
  matching branch has moved past them.
- **To resume:** `git fetch origin && git checkout ccr-e0dcd379-q104ac`, then for each work branch, in this order
  (ambient, generators, gm-page, players, players-table, engineering): read its log and diff, run the checks its section names
  (`npm test` plus the e2e checks: `check:gm`, `check:gm-scenes`, `check:cast`, `check:phone`, `check:offline`, the
  page checks in `app/checks/`, `check:ambient`, `check:display-ambient`), fix what is red, `git merge --no-ff` it
  into this branch, push. Conflicts to expect: `app/boot.js` and `app/index.html` (players-table vs engineering: strings
  and the theme switch vs the lazy-loading script list), `app/gm-page.js` and `checks/runtime/gm-page.test.mjs`
  (ambient's iPad-panel theme line vs the gm-page rewrite), `GM.md` (gm-page, ambient and engineering). A `-wip` snapshot
  that was never superseded means that agent did not finish: treat its diff as a draft, finish the section's items
  from it, and commit properly.
- **Then wave 2** (above), one branch per item group, same rules. Merge into main only with everything green, and
  never deploy on a game day.

## Done

- 67a1e0d · TODO: the first cut of this list.
- S1 · A stuck seat in the assist tick (branch sb-s1-leases). Cause: a tick cancelled mid-call when the page's timeout lapsed left two
  seats in the isolate's in-flight Set for the rest of the night, because `run()`'s `finally` never ran; the SDK client had no timeout, so
  a slow call could outlast the page. Fixed by leases (a token and an expiry per seat; a lapsed lease is reaped) and per-call deadlines
  (an AbortSignal, one retry), with the handler's work kept alive by `waitUntil`. The tick answer now carries `health: { skipped, reaped, ran }`.
