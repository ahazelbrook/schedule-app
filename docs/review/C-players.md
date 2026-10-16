# C. Player-facing review (Home, living sheet, table page, cast, rules)

Reviewer notes, full version. Repo untouched (git status clean). Everything below was measured on real pages:
a 390x844 touch viewport (DSF 2, with the Worker's viewport meta, served from a tiny static server that puts the Worker's
page head in front of index.html), the stubbed `window.claude` from app/checks/e2e.js (player = u_pat, campaign seeded), and
for the offline run a scratch copy of the app + Worker under `wrangler dev` (player = pat@example.test) in the scratchpad.
My own screenshots: `.../scratchpad/shots/players/` (names quoted below). Scripts: `.../scratchpad/scripts/`.

Severity: P1 = bug or misleading at the table · P2 = slows a player down · P3 = polish. Effort S/M/L. Risk = what could break.

---------------------------------------------------------------------------------------------------------------------------

## 1. Keep (works well; do not redesign)

- One visual language across Home, sheet, table, cast, rules: paper boxes, black bands, condensed caps labels, orange accent.
  The Night theme is just as legible (phone shots d1-*.png, t1-table-top-dark.png). Contrast: ink on card 17.7 (light) / 13.0
  (Night); ink-soft 7.5 / 8.7; accent on card 5.0 / 4.5; alarm 6.9 / 4.8. Only "faint" text is weak (see C14).
- Home for a returning player is right: "Welcome back, Pat", one big card (figure, name, playbook, a live status line
  "Stress 5/9 · 1 harm · xp 2/8") and "Open sheet" as the first and only primary button, at y=330 of 844 (h1-*.png). One tap to the sheet.
  Session-started and dates nudges are actionable. New player, returning player, GM-before-table and GM states are distinct.
- The phone sheet is already phone-first: the order Stress, Harm, Actions, Items, Keys, Session; the figure box gives way to a
  mugshot thumbnail; every action name is a 44px button; pips/XP boxes/diamonds have invisible 44px hit areas (tracker.css:375-394);
  no horizontal overflow at 360 or 390 in either theme (Home, sheet, table, cast checked; rules at 390).
- Marking stress is one tap on a 26px pip (hit area 25x44) or "Mark +2"; the count "6 / 9" sits beside the track; pushing and a
  desperate roll write their own cost (+2 Stress, +1 attribute xp) and log the roll; Resist is a separate Apply step; a key hit
  gives its once-per-session xp by itself; End of session and Downtime panels do the arithmetic and log it.
- Saves are per tap with no Save button; "Join session N" ties the sheet to the table; read-only sheets say whose they are.
- The offline queue works: with the browser offline, two taps queued as "1 change waiting" and landed on the server after
  reconnecting (offline1.mjs run: server stress 2 -> 6).
- Table page: role-aware (GM-only controls are removed, hidden clocks are filtered), the players box shows everyone's stress and
  "YOU", shared clocks are big and legible, the log shows who and when.
- Cast page for players: revealed NPCs only, no gmNotes (cast-page.js:44-53), "N met" wording, a friendly empty state.
- Rules page on a phone: 16px search input, live results with highlighted snippets, breadcrumbs, 16px body text, tables fit,
  offline from IndexedDB, "?" links open a pre-filled search and Back returns to the sheet (r1-*.png).

---------------------------------------------------------------------------------------------------------------------------

## 2. Findings

### P1

**C1 · P1 · Roll: the result is below the fold, and a second tap on "Roll" pays again**
Evidence: tracker.js:979-1003 (`roll`), tracker.js:794 (`rollScroll` is set when a panel *opens*, never after a roll), tracker.js:638
(the action roll's button is always "Roll"; resist :644 and fortune :649 already switch to "Roll again").
Measured at 390x844: after tapping Skirmish, the panel's Roll button sits at y=804-831; after Roll the dice, the SUCCESS word and the
"Applied: +2 Stress" line are at y=854-984, i.e. off-screen (s2-roll-result.png shows the panel ending at the Roll button). A player
sees nothing happen and taps Roll again: with Push + Desperate on, stress went 2 -> 4 -> 6, Prowess xp 1 -> 2 and the log got two
lines (sheet3.js). With Push on and stress at 8 the second tap is refused instead ("Cannot push"), still no result shown.
Change: (a) after a roll set `cur.ui.rollScroll = true` (also in `resistapply`) so the result block scrolls into view; (b) after a
roll lock Push / Assist / Bargain (show them as "spent") and relabel the button "Roll again (pay again)" so a repeat is deliberate;
(c) better: put the result *above* the options, directly under the header, so the verdict and the Roll button never move; on phones
make the panel a fixed bottom sheet (see section 3). Effort S for (a)+(b), M for (c). Risk: tracker UI state only; no document shape change.

**C2 · P1 · The "on stage" banner covers the roll panel and a third of a phone**
Evidence: cast.css:92 (`position: fixed; bottom: 0; max-height: 58vh`), cast.css:133 (48vh at <=560px), cast-page.js:140-165.
Measured (stage1.js, two NPCs on stage, player on the sheet): the banner is 262px of 844 (31%); after tapping an action the panel is
scrolled with `scrollIntoView({block:'nearest'})`, which ignores the fixed banner, so the panel's body and Roll button (804-831) are
*under* the banner (top 582); only the orange panel header peeks out (st1-roll-with-banner.png). `--cp-stage-h` pads the page's end
but not scroll targets. "Hide" is remembered only until `scene.at` changes, and every put-on / take-off / clear changes it, so the
banner returns over the sheet each time the GM moves the stage, mid-roll. Tapping a banner portrait leaves the sheet for #cast/<id>.
Change: (a) `#dossier .ds-roll, #dossier .ds-roll-res { scroll-margin-bottom: calc(var(--cp-stage-h, 0px) + 12px) }`; (b) on phones
show the banner as a one-line strip (round portrait thumbs + names, ~56px, tap to expand to what it is today), auto-expanded for
~8 s when the stage changes, so the reveal still lands; (c) never open the full view on the sheet screen. Effort S (a), M (b).
Risk: none to data; keep `b68.stage.dismissed` semantics.

**C3 · P1 · "Remove" (irreversible) sits in the main button row; two taps delete the character for good**
Evidence: tracker.js:282-286 (Back, Edit figure, Print, Remove in one row, 8px between Print and Remove, all 27px tall, `Remove`
only turns red on :hover, i.e. never on a phone), tracker.js:836 (first tap changes the label to "Click again to remove" for 4 s, the
second tap deletes; no native confirm, no name), boot.js:268 (`ref.delete()`, toast "Removed from the files."),
functions/_lib/characters.js:92 (`SET deleted = 1, doc = '{}'`: the body is wiped, no undo). Reproduced: two taps 200 ms apart on
Remove removed the character with no dialog (remove1.js).
Change: take Remove out of the header row; put it last on the sheet under a "Danger" line (or a "More" disclosure with Print and
Edit figure), use `window.confirm('Remove Aldo Crane for good? This cannot be undone.')`, and show it only to the owner/GM.
Effort S. Risk: none (UI only).

### P2

**C4 · P2 · The phone sheet opens on ~770px of identity text; no play control is on the first screen**
Evidence (sheet1.js, 390x844): page header 125px + `.ds-head` 514px (title, thumb, 4 buttons, Name/Alias/Crew/File, Look, Wearing,
Heritage, Background) + table bar 89px; Stress starts at y=771 (73px of it visible), Harm 930, Actions 1259 (804px tall), Items 2077
(691px), Keys 2782, Session 3228, Special abilities 3772 (826px), XP 4915, Downtime 5184, Stacks & bank 5373, Clocks 5603, Notes
5745, Log 5920; page 6171px = 7.3 screens, and the header scrolls away so Home/Table/Rules need a scroll back to the top. Nothing at
the top says how hurt you are (the Home card does, the sheet does not). Same on a laptop: the 440px figure pushes Stress to the fold.
Change (phones, <=760px): (1) fold Name/Alias/Crew/File/Look/Wearing/Heritage/Background into one closed "About Aldo" row (the thumb
and name stay); (2) header row = Back · Print · "..." (Edit figure, Remove); (3) a sticky one-line vitals strip under the header:
"Stress 6/9 · Harm 1 · XP 3/8 · Load 2/3", each chip a jump link to its box (anchors only); (4) reorder: Stress, Harm, Actions, XP,
Load (show carried items + "Edit loadout"), Downtime, Session, Keys, Stacks, then the rest. Effort M. Risk: tracker.js/css only;
the `play` shape is untouched. Do not break print (phone rules are screen-only already).

**C5 · P2 · Every tap rebuilds the whole sheet, 94% of it figure data a phone never shows**
Evidence: tracker.js:775-790 (`render()` replaces `#dossier.innerHTML` on every click; `figureSvg()` at :296 re-draws the 420px
figure every time; the thumbnail data URI at :303 is re-parsed). The sheet is 722 KB of HTML / 2,497 nodes; 363 KB is the Figure box
SVG (`display:none` on phones, tracker.css:368) and 310 KB is the thumbnail `src` data URI. Timing of tap -> render + layout
(sheet3/sheet5.js): 76 ms (1x CPU), 313 ms (4x throttle), ~500 ms (6x). With the figure and thumb blanked: 13 ms and 53 ms,
html 48 KB. On a mid-range phone every pip tap costs a third of a second; quick taps (3 stress in a row) queue.
Change: do not build the Figure box when `matchMedia('(max-width:760px)')` matches (draw it lazily if the viewport grows, and in
`printFigure` for print); keep the thumbnail out of the re-render (a Blob URL kept in `cur.ui`, or render the header once and
patch only the status text). Further: re-render only the box that changed. Effort S (figure+thumb), M (per-box). Risk: low; test print.

**C6 · P2 · The play-critical controls are 19-27px tall; the table page has no phone hit areas at all**
Evidence (targets1.js, CSS px): Roll 56x27; Position/Effect chips ...x20; Push/Assist/Bargain rows 26px; Resist chip 53x19;
Fortune 70x24; Mark +1/+2 77x27 (and "Mark +2" wraps alone onto a second line, s2-stress-tapped.png); Armor/Heavy squares 15x15
with no hit area (`.ds-sq` is not in tracker.css:379-380); healing clock segments 20x20; Load quiet/loud chip 70x20; Item rows 25px;
header Back/Print/Remove 27px; roll "x" 26x20 (hit area ok). Home links 28px. Table page (campaign.css has no phone block): heat
boxes 21x21, vault diamonds 17x17, Log 48x27, Open 56x27. CONTRACT.md says the roll is 44px: that is the action *name*, not the Roll button.
Change: in the existing <=760px block give `.btn.sm, .chip.sm, .ds-rtog, .ds-item, .ds-sq, .ds-resist` a 44px hit area using the same
`::before` trick (or `min-height: 40px` where layout allows), and port the pattern to `#table-page` pips/diamonds/segments.
Put "Mark +1 / +2" first and "Indulge" after them (marking is far more frequent in play). Effort S. Risk: rows get taller (page longer).

**C7 · P2 · Offline: the sheet says "Saved" while the change is only queued; the offline cue is off-screen**
Evidence: runtime/cf.js:685 (`if (offlineNow()) resolve()`: the save promise resolves as soon as it is queued), tracker.js:229-236
(any resolve shows "Saved"). offline1.mjs (wrangler dev, browser offline, player scrolled to Stress): sheet status "Saved",
`B68Runtime.status = { online:false, pending:1 }`, the header chip "Offline · 1 change waiting" exists but is not in view
(`whoamiInView:false`); the only on-screen signal was a red toast "Files offline: Failed to fetch" that showed for ~6 s, about 3 s
after going offline, and never again (offline2.mjs sampled 20 s). After reconnecting the change landed, so nothing is lost; the GM
just sees stale data and the player is told "Saved".
Change: drive the sheet's status from `B68Runtime.status`: "Saved on this phone · will sync when you have signal (1)" while offline
or `pending > 0`; add a small fixed pill (top right, above the banner z-index) "Offline · 2 waiting" on every screen; reword the toast
(see C12). Effort S. Risk: none; listens to the existing `b68:runtime` event.

**C8 · P2 · Table page, player on a phone: dead schedule box first, crew sheet in the middle, log last**
Evidence (table1.js, 390x844, no dates, crew sheet not chosen): header 153-308, Session 322 (127px), Schedule 463 (155px), Shared
clocks 632 (218px), Players 863 (388px), crew pick 1265, The crew 1439 (953px generic; ~4,100px with a full crew sheet,
crewsheet-dealers-phone.png), Campaign log 2407 on a 2,724px page (~5,500 with a full crew sheet). The Schedule box for a player
says "No session is set yet. Mark the dates you can make below; the GM confirms one." and under it "No dates proposed yet. The
GM adds them here." (schedule.js:303, :330): it invites an action that does not exist. For the GM the same box is a form +
cadence + quorum + attendance, 600-900px above the clocks. The "PLAYER" chip (campaign.js:303, campaign.css:20) looks like a button.
Change: (1) players: do not draw the Schedule box unless `schedule.next` or open options exist; GM: a one-line collapsed row
"Schedule · nothing planned [Open]" (remember the choice like `b68.nextOpen`; `#t/schedule` and "Plan dates" open it); (2) Session
box: one line for players ("Session 3 · in play"); the "Each player ends the session on their own sheet" hint belongs in the
sheet's End-session panel, which already says it; (3) phone order: clocks, log (latest 3 + "all N"), players, crew (folded behind a
summary row Tier · Hold · Rep · Heat · Wanted · Stacks, expands to the sheet), schedule last; (4) drop the PLAYER chip for players.
Effort S for (1)(2)(4), M for (3). Risk: campaign.js/schedule.js render only; document untouched.

**C9 · P2 · iPhone zoom-on-focus and double-tap zoom (likely; not testable here)**
Evidence: the sheet's inputs are 13-13.5px (tracker.css `.ds-in` 13.5px, `.ds-hin` 13px, `.ds-ta`, `.ds-sel`), the table's `.tp-in`/`.tp-ta`
13.5px; only the Home name field and the Rules search are 16px (index.html:137, rules.css:27). iOS Safari zooms the page on focusing
any control under 16px, so tapping a harm line or the log line would zoom the whole sheet. No `touch-action: manipulation` anywhere
(grep), so quick double taps on adjacent pips can trigger double-tap zoom on iOS. Needs a check on an actual iPhone.
Change: `@media (max-width:760px) { #dossier :is(input,textarea,select), #table-page :is(input,textarea,select) { font-size: 16px } }`
and `#dossier button, #table-page button { touch-action: manipulation }`. Effort S. Risk: fields a few px taller.

**C10 · P2 · Harm is free text only, and only Stress/Downtime/Clocks have a "?" link**
Evidence: tracker.js harm box (no `rl()` call; `rl()` used for stress, trauma, clocks, the downtime buttons: 7 links in all, rules1.js
listed them). Marking a consequence = tap a line, keyboard, type, dismiss (s2-harm-typed.png); the level effects are not shown;
Harm, Armor, Load, Position/Effect, Push, Resist, XP, Keys have no link. rules.js KEYWORDS (:31) falls back to the word itself, so
`rl('harm')` already works.
Change: add `rl()` to Harm, Armor, Load, the roll panel (position, effect, resist) and XP; optionally a row of quick-fill chips under
Harm ("Bruised", "Cracked rib", "Concussion", ...) that write the same plain text strings. Effort S (links), M (chips). Risk: none to
the document shape (strings, as today).

**C11 · P2 (unmeasured) · The service worker is network-first with no timeout**
Evidence: sw.js:57-81: every same-origin GET (about 45 shell files) goes to the network first and falls back to the cache only when
`fetch` rejects. With bar or basement Wi-Fi that is "up but dead" the launch waits for the browser's own failure. Offline start is
fine (instant, tested by checks/runtime/offline.e2e.mjs); slow or stalled is the gap. I did not measure it.
Change: race the fetch against a ~3 s timer when a cached copy exists (cache wins, update in the background); keep network-first
when there is no copy. Bump `CACHE` ("b68-shell-v14") and run `npm run check:runtime` (pwa.test.mjs). Effort S-M. Risk: medium (shell
vs API version skew for one launch; the API is versioned by the adapter, the shell reloads on the next visit).

### P3

**C12 · P3 · Wording that assumes the code ("files", "filed", "store", "Failed to fetch")**
Player-visible examples with replacements:
- "Opening the files…" (boot.js:1012) -> "Opening the table…".
- Home section "The files" and its note "Yours are saved to your account · everyone with the link sees the shared files"
  (index.html roster block; boot.js:1179) -> "Everyone's characters" / "Yours are saved to your account. Everyone at the table can see all
  characters."; link "Everyone's files" (boot.js homeBack) -> "Everyone's characters".
- "Filed Aldo Crane. Opening the sheet." (boot.js:865), "Updated the file for X." (:874), "Removed from the files." (:268), "Filing it
  opens your living sheet." (:990) -> "Saved…", "Updated X.", "Removed X.", "Saving it opens your sheet."
- Empty states: "No one is on file yet. Finish the dossier and file the character from the last step…" (boot.js:626); "No characters are
  filed yet. Each player files theirs from the creator…" (campaign.js:393); "Nobody has filed yet." (boot.js:978, GM); "No filed
  character left to pay" (crewsheet.js:380).
- "Not saved: no store" / "(no store)" (tracker.js:232, :624; campaign.js:170) -> "Not saved: this view cannot save."
- "Files offline: Failed to fetch" (boot.js onSnapshot error toasts) -> "No signal. Changes are kept on this phone and sync when you are back." Also it fires
  for a *refused* queued change ("a change saved while offline was not accepted: HTTP 403").
- "The table needs the shared files. Open this page where the files are available (the published artifact or the hosted site)…" (boot.js:322,
  cast-page.js:196, season.js:234) -> "The table is not available in this view."
- "Unowned" group in the players box (campaign.js) -> "No player yet"; "Indulge -1 / -3" on the Stress box -> "Clear 1 / Clear 3 (vice)".
- Home lead for a new player "Make your character, then mark the dates you can play." (boot.js:989) mentions dates when there are none.
Effort S (strings only). Risk: the checks assert some of these strings (app/checks/e2e.js, campaign.js, table.js); update them with the text.

**C13 · P3 · Inconsistencies**
- "PLAYER" role chip drawn like a button (campaign.css:20) but not tappable; "Up to date" is bare mono text.
- Back: a `.btn` in the sheet's button row, a `.btn` at top-left on Rules, an underlined caps crumb on the cast, nothing on the table.
- Destructive vs neutral: Remove has the same style as Print (C3). Pressed chips are black-filled in the light theme, light-filled in Night (fine, but "selected" is the only cue).
- Home navigation is underlined text links (28px) while the header uses `.btn`; two buttons on Home do the same thing one under the other
  ("Open sheet" in the card and "Open the sheet" in the "Session 3 has started" nudge); that nudge could say "Join session 3" and open the sheet already joined.
- Native checkbox for Mastery and Strictures vs the custom squares everywhere else; Print and "Print the season" are in the primary rows on phones where they are rarely used.
- Home repeats the player's own card in "The files" below the big card.
Effort S each.

**C14 · P3 · Contrast, size, theme switch**
- `--ink-faint` (#8e8880) on the light card is 3.3:1 (placeholders, the small x buttons, the "0" load mark); Night accent text on card is
  4.48:1 and Night `--ok` 4.19:1 (PROJECT tag, friend marks); the roll header's mono subtitle (on-accent at 85%) is 4.05:1; the Home
  status line "Stress 5/9 · 1 harm · xp 2/8" is 10.5px mono in accent, the one place state is shown at a glance. Labels are 10px caps.
  Raise the status line to 12-13px and ink; nudge ink-faint to ~#76706a, Night accent text to ~#ea7a30.
- Night follows `prefers-color-scheme` only; the tokens already have `[data-theme="dark"|"light"]` but nothing sets it. A small
  Night/Paper switch (footer or Home links, stored in localStorage) helps a player at a dim table whose OS is in light mode. Effort S.

**C15 · P3 · Cast page for players**
- After "Hide" nothing on any screen says who is on stage; the grid badge ("On stage") is GM-only (cast-page.js card()); the detail kicker says "on stage" only if you open it.
  Add the badge for players and a small "On stage: Grunt, Brackley" chip in the header that re-opens the banner.
- Phone detail page: a 62vh figure comes before the name and description (06-phone-phone-detail.png); put name + description first or cap the figure at ~40vh.
- The description in the card is clamped to 4 lines on phones; fine, but the detail link is only the title/portrait (no "Read more").

**C16 · P3 · Small robustness items**
- Debounced typing (400 ms) is not flushed on `pagehide`/`visibilitychange` (only blur/`change` and sheet close flush it): the last keystrokes before locking the phone can be lost. Add a flush on `pagehide` (S).
- boot.js:259-262: `latest`/`cache` are updated before the write; if a write is refused the sheet keeps showing the unsaved marks and a later save does not resend them (the next poll then redraws the server's truth). Roll back `latest` on failure or resend (S).
- `play.log` grows with every roll, is sent whole in each roll's patch, and is the last box on the phone; show the latest 20 with "Show all" (S).
- `T.update` (tracker.js:1172) drops a remote snapshot that arrives while a save is in flight (kept in `cur.doc`, not in `cur.play`); a GM edit in that <1 s window is not shown until the next change (S, rare).
- The deadlock bursts and the "x" removers are icon-only (title text only on hover); the Key box band says "Deadlocks", which helps.

**C17 · P3 (GM side, but it is the same parked feature) · The nags**
Home for the GM shows "No dates proposed. [Plan dates]" forever while dates live in Google Calendar (boot.js:977) and set-up step 2
"Plan the first session" (boot.js:959); the table's schedule box is a 600-900px form (C8). Hide the nudge unless the GM has used the
schedule once (e.g. `schedule.cadence` or any option ever existed), or add a "Not using the schedule" switch. Effort S.

---------------------------------------------------------------------------------------------------------------------------

## 3. Proposed player's phone flow

Today (390x844, measured):
0. Icon -> Home ("Opening the files…") -> "Welcome back" card.
1. Tap **Open sheet** -> the sheet opens at the top: ~770px of identity, then "Join session 3". Stress is 73px into view.
2. Tap **Join session 3**.
3. Swipe ~620px -> Stress. Tap a pip (1 tap): "4 / 9". (Mark +1/+2: 27px buttons.)
4. Roll: swipe ~500px to Actions (12 rows). Tap **Skirmish** -> the panel opens at the *end* of the list (under the banner if NPCs are
   on stage). Tap **Desperate**, tap **Roll** (27px). The verdict is below the fold: swipe to read it. Tap Roll again by mistake = pays again.
5. Consequence: **Resist** (19px chip) -> **Roll** -> **Apply +4 Stress** (3 taps + a swipe), or Harm: swipe back up ~330px, tap a
   line, type "Cracked ribs", dismiss the keyboard.
Total about 8-10 taps, 4-5 swipes, typing, and two screens of scrolling past things you do not need.

Proposed (maps to C-numbers):
0. Same (Home is good). Optional: when the player owns exactly one character show a second "Open sheet" at the bottom of the screen (thumb zone).
1. **Open sheet** -> compact header (name, thumb, "...") and a sticky **vitals strip** "Stress 4/9 · Harm 1 · XP 3/8 · Load 2/3" (C4);
   Join bar if the table is ahead. Stress and Harm are on the first screen without scrolling.
2. **Mark +1 / +2** (44px, first in the row) or a pip: the strip updates (C6).
3. Tap an action -> a **bottom roll sheet** (fixed, above the stage banner, ~60% height): the dice count and a big **Roll** first, the
   verdict and "Applied +2 Stress" right under it, options (push, assist, bargain, position, effect) below; the sheet stays open with
   "Roll again" (C1, C2).
4. Under a partial/failure verdict a **consequence row**: [Resist] [Harm 1] [Harm 2] [Harm 3]. Resist rolls in the same sheet and Apply is one
   tap; a Harm button jumps to that line, focuses it and offers the quick-fill chips (C10).
Total: Open sheet (1) -> [Join (2)] -> action (3) -> Roll (4) -> Resist (5) -> Roll (6) -> Apply (7), no swipes.

---------------------------------------------------------------------------------------------------------------------------

## 4. What I could not verify

- iOS Safari/PWA behaviour (zoom on focus, double-tap zoom, keyboard over the fixed banner, standalone chrome): flagged from CSS only.
  Android with the keyboard open: a fixed banner of up to 48vh plus the keyboard may leave a sliver for the input; not tested.
- Real device CPU: 4x/6x throttling is a proxy.
- Network-first launch on a slow or stalled network: not measured.
- The GM's side of the schedule and the display were not reviewed beyond what shares the player's screens.

## 5. Screenshots I made (scratchpad/shots/players/)

s1-sheet-open-top / s1-home-new-player (sheet top, new-player Home) · s2-roll-open / s2-roll-result (Roll off-screen) · s2-stress-tapped ·
s2-harm-typed · s3-roll-result-visible · st1-roll-with-banner / st1-sheet-with-banner / st1-cast-after-hide (banner) ·
t1-table-top-light / -dark / t1-table-full-light (table page) · h1-one-char-session-ahead / h1-two-chars (Home) ·
o1-offline-stress-viewport / o1-offline-top (offline) · r1-rules-* (rules) · d1-* (Night theme sheet: stress/harm, roll, resist, keys, end of session, items).
