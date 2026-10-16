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

### 0. The iPad display: reported bugs (branch: ambient)

- [ ] P1 · The planning-meeting scene lags on the iPad (3.1 MB svg, 550 motion groups, 8 filters / 12 feTurbulence, a
      24 fps loop rewriting transforms). Fix in the generator (tools/ambient), regenerate. · M
- [ ] P1 · The opening-credits theme is silent on the iPad (file missing on the server / audio unlock / WebAudio and the
      mute switch). Diagnose, fix, and make the display SAY which it is. · S-M
- [ ] P1 · Figures' heads sometimes disappear (the motion merge leaves a frame with no version of a part, or a clip path
      inside a hidden group that WebKit will not resolve). Fix in motion.js, regenerate, prove with a frame walk. · M

### 1. The GM page: quick access (branch: gm-page)

Keep: the Position switch; the four Situations and the composed card; single-letter keys; the one-window laptop layout;
Find; the location glance card and its secrecy gate; the rail; capture; the beat pill.

- [ ] A1 P1 · The result card is the last thing in the console column, below the fold at 1280×900. Card under the four
      buttons; Scene controls folded behind a labelled one-line disclosure at every width; single tables under "More
      tables"; scroll the card into view on a roll. · M
- [ ] A2 P1 · Focus hides the roll: keys 1-4 still roll but the card is display:none. A roll leaves Focus. · S
- [ ] A3 P1 · Phone: the first screen is the site header, H1, pack note and four admin buttons. The app layout (44 px
      bar + menu) at every width. · M
- [ ] A4 P1 · Phone: ten segments, five visible, no scroll. Two rows. · S
- [ ] A5 P2 · Classic 3×3 breaks words mid-syllable at 1280. · S
- [ ] A6 P2 · Tab key hints hidden between 1100 and 1439 px. · S
- [ ] A8 P2 · "GM ONLY" badge on every fold of an all-GM page; mark what PLAYERS SEE instead. · S
- [ ] A9 P2 · "Put on stage" navigates away mid-scene; stage from the GM page. · S-M
- [ ] A10 P2 · Keys vs typing: R/T focus the pane's find box; H needs Shift or a double tap. · S
- [ ] A12 P2 · A location roll draws the rings map at once. · S
- [ ] A13-A18, A20, A21 P3 · Labelled scene chips; toasts above the capture input; the Situations|Classic toggle,
      Display link, Export and Forget into the Menu; "GM screen"; larger labels; Listening pill only once used; map
      View/Theme folded. · S each
- [ ] A7 P2 · One "Now in" district that the console, Street, Location and NPC default to (if time; else wave 2). · M
- [ ] A11 P2 · Rules search results inside the GM screen pane, not a new tab (if time; else wave 2). · M
- [ ] A19 P3 · Engagement factors as three-chip segments (if time; else wave 2). · S

### 2. The generators (branch: generators; pure modules only)

Keep: seeded replay with mem-before; the second seed stream for situation sections; the lead box / Or rows / one actions
row; the location Say built only from player-safe fields; the NPC figure ladder; read-aloud first on street scenes.

- [ ] B2 P1 · "Someone" with a chosen friend answers as a different friend half the time, and its Contact and Or
      reaction disagree two thirds of the time. Honour the chosen NPC; one person per card. · S-M (compose version bump)
- [ ] B4 P2 · The 4/5 and 1-3 cards carry a twin of their lead (28% / 19% of rolls, often contradicting it). Plan the Or
      rows after the lead's kind. · M (compose version bump)
- [ ] B10 P2 · Two bargains shown, one Accepted button. · S
- [ ] B11 P3 · Pay the price "roll twice more": extras get no Collected action. · S
- [ ] B8 P2 · Sparse pack: "Someone in undefined", throws on a missing T.spend / T.say3. Neutral fallbacks and a key
      check at pack time. · S
- [ ] B9 P2 · location.js throws with no faction dossiers. · S
- [ ] B14 P3 · NPC "Quality NaN" when a tier is a string; silent figure failures. · S
- [ ] B19 P3 · Stale district / pc / npc choices survive a pack change. · S
- [ ] B3 P2 · The 4/5 and 1-3 lead is a bare category word ("Harm"); the usable example sits under More. Lead = kind —
      example; Earlier labels too. · S
- [ ] B5 P2 · With a threat set, the drawn complication is demoted under the spend sentence. · S
- [ ] B6 P2 · Location Flags fire on every roll (ring-skips, district rule). Skips to the Plan hint, the rule's text
      shown, Flags kept for the rare cases. · S
- [ ] B7 P2 · Pin/Copy are mostly repeated coaching lines (1200-1800 chars vs the 1500 cap). Mark them `coach`; the
      page folds them (wave 2) and Pin/Copy/L skip them. · S
- [ ] B12, B13, B16, B17, B18, B21 P3 · Author notes on cards; "Smash — -1d"; doubled "Level"; dead veteran guard;
      "Result: 4/5" chip on every section; the secure band called "the target" when the ★ is elsewhere. · S each
- [ ] Idea 2 · A position/severity chip on the Situations card. · S
- [ ] Idea 7 · Location: a one-sentence plan under Say. · S
- B20 · Controlled 1-3 strictly alternates Worse position / Lost opportunity: vault behaviour, parity; note only.

### 3. The players' side (branch: players)

Keep: one visual language; Night as legible as Paper; the returning player's one-tap Home; the sheet's phone order
and 44 px pips; Push/Desperate writing their own cost; the offline queue; role-aware table; revealed-only cast.

- [ ] C1 P1 · The roll verdict lands below the fold; a second tap on Roll pays stress again. Scroll to the verdict,
      lock the options, "Roll again (pays again)"; then a fixed bottom roll sheet on phones. · S then M
- [ ] C2 P1 · The on-stage banner (262 px for two NPCs) covers the roll panel and comes back on every stage change.
      A one-line strip on phones, auto-expanded 8 s. · S-M
- [ ] C3 P1 · "Remove" (deletes the character) sits 8 px from Print with a 4 s double-tap "confirm". To the foot, a real
      confirm naming the character. · S
- [ ] C4 P2 · The phone sheet opens on 770 px of identity text; Stress starts at y 771; page 6171 px tall. An "About"
      fold, a sticky vitals strip with jump anchors, play-first order. · M
- [ ] C5 P2 · Every tap rebuilds 722 KB of figure svg + thumbnail data URI the phone never shows (313 ms at 4× CPU).
      Lazy figure, Blob thumb. · S-M
- [ ] C6 P2 · Play controls 19-27 px tall; the table page has no phone hit areas. 40 px everywhere. · S
- [ ] C7 P2 · Offline, the sheet says "Saved" while the change is queued; the cue is off screen. Truthful status and
      an "Offline · N waiting" pill. · S
- [ ] C8 P2 · The table page for a player: a dead Schedule box first, the log 2400 px down. Hide the schedule without
      dates, collapse it for the GM, phone order clocks · log · players · crew (summary row) · schedule. · S-M
- [ ] C9 P2 · iPhone zooms on focus (13 px inputs). 16 px at phone widths; touch-action: manipulation. · S
- [ ] C10 P2 · No "?" rules link on Harm, Armor, Load, Position/Effect, Resist, XP. · S
- [ ] C12 P3 · Code-speak strings ("the files", "Filed", "no store", "Unowned", "Indulge -1/-3"). · S
- [ ] C13 P3 · Back is a button, a crumb or absent; "Open sheet" twice on Home. · S
- [ ] C14 P3 · The Home status line is 10.5 px; --ink-faint at 3.3:1; no Night/Paper switch. · S
- [ ] C15 P3 · Cast: after Hide nothing says who is on stage; phone detail figure 62vh before the text. · S
- [ ] C16 P3 · Typing debounce not flushed on pagehide; a refused save leaves optimistic marks; play.log unbounded;
      a remote snapshot dropped during an in-flight save. · S each, careful
- [ ] C17 P3 · "Plan dates" nags on Home while the schedule is parked. · S

### 4. Engineering (branch: engineering)

Keep: optimistic write loops with 409; role gates before the body is read; RS256 JWT with pinned alg and JWKS cache;
the display path failing closed (checkSvg + sanitiseSvg agree; markdown.js fuzzed clean); the offline queue design;
additive secrets on deploy; schema.sql = migrations.

- [ ] E1 P1 · A stalled request freezes the poller and the save queue for good while the header says online (no
      timeout in cf.js api()). AbortController timeouts; adapter test. · S
- [ ] E6 P2 · A player's tap after a sign-out is rejected before queueing and lost on reload. Queue it. · S
- [ ] E2 + C11 P2 · The service worker is network-first with no timeout: dead venue wifi blocks launch though a cache
      exists. Race with a timeout; bump the cache. · S
- [ ] Lazy loading, phase 1 + 3 P2 · 2.3 MB of JS and 230 KB of CSS load synchronously for every player on every route.
      routes.js bundles per route; index.html keeps the core; the SW still precaches everything; a build id, `?v=`
      on bundles, and an "Updated: reload" chip. · M
- [ ] E7, E8 P2 · Deploy from Windows: `.gitattributes` (LF), "run from Git Bash"; the script checks the two gitignored
      files (theme.mp3, calling-cards.html), lists the five secrets present/missing, refuses a dirty tree, prints a
      receipt. · S
- [ ] E9 P3 · display.test and gm-location.test not in check:runtime; the two 500-seed sweeps make npm test 3× slower
      (B68_SWEEP); a check:e2e-all script. · S
- [ ] E10 P3 · Seven stale doc claims (migrations count, microphone, claude.gm calls, display's "two calls", kind
      `cards`...). · S
- [ ] E11 P3 · The vault path hard-coded six times in package.json (B68_VAULT). · S
- [ ] Docs consolidation · PLAN, RESEARCH, AMBIENT-PLAN, DEPLOY-PROMPT, ROADMAP to docs/history/; SCHEDULE.md marked
      parked; DEPLOY.md folded into SETUP.md; README leads with the four commands a non-programmer needs. · S
- [ ] E12 P3 · A Content-Security-Policy, report-only first. · S
- [ ] E13 P3 · A failed JWKS refetch after the 1 h TTL makes every call 401 until Cloudflare answers; keep stale keys. · S

## Wave 2 (after the wave-1 merges)

- [ ] B7 / B15 / B14 page side · Fold coaching lines on the card; Pin/Copy/L skip them; Earlier chips name the NPC and
      show the time and position; a figure fallback note on the NPC card. · S
- [ ] E5 P2 · After Access expires mid-session the GM saver parks every later patch for good and the toast says the
      opposite. Treat 401 as pending-until-sign-in, say "reload to sign in, notes kept", resend. · S-M
- [ ] E18 P3 · Capture alone can hit the 240 KiB soft cap, after which every roll is refused; cap by bytes, drop the
      oldest. · S
- [ ] E17 P3 · Dead weight: SITUATIONS_DEFAULT's no-Situations branch, the Classic layout fallback (decide after a few
      sessions on the new layout). · S
- [ ] E3 P2 · Two players ticking different clocks within ~4 s lose one (the campaign PATCH sends the whole array). A
      per-clock operation applied inside the server's write loop and mirrored in cf.js. · M (contract change)
- [ ] E4 P2 · Workers Free budget: an always-on iPad polls display every 2 s and stt every 4 s (≈65k requests/day);
      with two laptops open the daily cap can trip mid-session. Display 4 s, stt carried in the display GET, slow to 30 s
      after an hour without change, hidden tabs 60 s. · S
- [ ] E14 P3 · The display never leaves "denied"; reload once after 10 min. · S
- [ ] Lazy loading phase 2 · The figure kit (688 KB) loaded after first paint; the three top-level captures become
      lookups. · M
- [ ] A7 / A11 / A19 if not done in wave 1.
- [ ] Ideas from review B · Re-roll one row of a card (per-section seeds exist); a "Tonight" strip of every roll beyond
      the five, exported into the note; "Make them an NPC" on a Face/Reaction card; "Use the street" chaining Street →
      Location → NPC. · M
- [ ] E16 P3 · One app/util.js for the twelve copies of esc/isObj/clone (adopt per touched module). · M

## Later or parked

- Scheduling (phases 2, 3, 6 of docs/history/ROADMAP.md): November/December.
- E11 · The seven hidden NPCs' names and look lines are in the public repo (`app/figures/npcs.js`, migration 0003).
  Decision for Alex: seed them from gm-private instead, or make the repo private.
- E12 · Make the CSP enforcing once the report-only header shows nothing for a few sessions.
- Vendored map kit bug: the player layer titles a plan/section level after a hidden room (worked around in the page).

## Questions for Alex

1. The NPC seed in the public repo (above): keep as is, seed privately, or make the repo private?
2. Classic view and Classic layout: keep them as fallbacks for a few sessions, or remove them now?
3. The phone roll panel as a bottom sheet (C1) changes how the sheet feels: happy to try it for a session?

## Done

- 67a1e0d · TODO: the first cut of this list.
