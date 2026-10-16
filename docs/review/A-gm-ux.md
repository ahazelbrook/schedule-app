# A · GM page: UX / information-architecture review (fresh eyes, read-only)

Reviewed: `GM.md` ("The page" ... "Saving"), `app/gm-page.js` (layout, bar, console, location, street, engage, NPC, prep, cards, screen, rail, capture, keys), `app/gm.css`, the API header of `app/gm/console.js`, and the e2e screenshots under `scratchpad/shots/{gm,npc,scenes,prep}`. Branch `ccr-e0dcd379-q104ac` = `origin/main`. Nothing was edited.

The yardstick is the owner's own: *quick access to information that is clearly labelled and easy to see*, judged at three moments: (A) a player rolls 1–3 and everyone looks at the GM; (B) the crew walks into a new district; (C) the GM needs a rule mid-argument.

---

## 1. Keep (works; do not break)

1. **The Position switch**: big, always on screen, the active state black with the orange underline, severity · winds · harm printed on it. It is the one control that matters at moment A. (`renderPos`, gm.css `.gm-posb`.)
2. **The four Situations as moments in the roll** (`1 Before · 2 4/5 · 3 1–3 · 4 Someone`) with the composed card: one big lead line, chips, `More`, at most three `Or` rows, one merged actions row. The card design is right; only its placement is wrong (A1).
3. **Single-letter keys that work from anywhere**, shown as `kbd` in the design language; `Esc` leaves inputs; `L` files the last roll; `0` clears the iPad; `H` blanks the laptop. (`keyAction` gm-page.js:405–431.)
4. **The one-window laptop layout**: three independent scrollers, the slim black bar (session · saved · stale pack · what the iPad shows · listening · Clear → ambient · Lights out), capture fixed at the foot. A long prep note never carries the console away.
5. **Find (`Ctrl+K`, `/`)** over prep, the GM screen, NPCs, PCs, factions, clocks, callbacks and tonight's capture, with `↑ ↓ Enter`.
6. **The location glance card**: name, place line, the orange **Say** box with its own *Street description on iPad* button, Whose / Bands / Target / Flags; folds closed by default and remembered per device. The secrecy gate on what goes to the iPad.
7. **The street-scene card**: read-aloud paragraphs first, ratings chips, the GM grid under, *Read-aloud to the iPad* sends only the paragraphs. Moment B is already a two-tap flow here.
8. **The state rail**: crew numbers, table and world clocks, bargains owed with **Collect**, pins, on stage; pinned prep sections live at the top; empty boxes one line.
9. **Capture** with `P X M L`, the mustard-ruled bar, *File last roll*; **Earlier** (five per tool) with exact replay from the seed.
10. **The beat in the bar with Next beat**, and the pack's typographic language throughout (paper boxes, black bands, Archivo Condensed caps, orange accent, kbd keys). Consistent and legible at reading distance.

---

## 2. Findings, prioritised

Severity: **P1** blocks or misleads at the table · **P2** slows the GM down · **P3** polish. Effort S/M/L.

### P1

**A1 · The result card is the last thing in the console column: below the fold at 1280×900.**
Evidence: `layout()` gm-page.js ~992–1004 orders the column `conhead → pos → scene → mini → controls → buttons → singles → cardbox → earlier`; `.gm-col` is a plain grid with no `order` (gm.css ~55); nothing scrolls to the card after a roll (`stamp()` / `drawConsoleCard()` ~1290–1340, no `scrollIntoView`). Screenshot `gm/01c-gm-situation.png`: after pressing `4` the card header "4 SOMEONE" sits at y≈790 of 900 and the lead box is cut off. At moment A the GM presses `3`, everyone waits, and the thing to read is off-screen; the console column scrolls on its own so the pointer must be over it.
Change (the phone already has this pattern, so it fits):
- S stopgap: in `stamp()`, `$q('#gm-card').scrollIntoView({ block: 'start' })` inside the console scroller.
- M, the real fix: on the laptop keep **Position** and the **four buttons** on top, collapse Scene / District / Aim at / NPC is / Threat behind the existing `#gm-scene` chip line (`display:none` above 600 px today, gm.css ~61; make `.scene-open` work at every width and give the chips their labels, see A13), move **Single tables** under the card as a one-line `More tables +` details, and put `.gm-cardbox` right under the buttons (CSS `order` or DOM order). At 1280×900 the lead line then lands around y≈420.
Risk: low. `gm-page.test.mjs:384–386` and `gm.e2e.mjs:136` count `[data-ctl]` elements, not visibility; `gm.e2e.mjs:347` already expects the controls folded on the phone.

**A2 · Focus hides the roll: keys 1–4 roll into an invisible box.**
Evidence: gm.css laptop block `body.gm-app #gm-root.focus .gm-console > :not(.gm-mini) { display: none }` hides `#gm-card`; the mini keys (`renderButtons`, `#gm-mini`) and `keyAction` still roll (`rollSituation` → `stamp` → `drawConsoleCard`, no `toggleFocus`, no toast). `prep/prep-wide.png` shows Focus with the four keys and no card. The GM reading prep in Focus presses `3`: nothing visible happens; the reflex is to press again, which rolls twice (two Earlier entries, the repeat guard spent) and the second roll is what they finally see after `F`.
Change (S): in `stamp()`, when `S.prepWide` is on, leave Focus (`toggleFocus()`) so the card appears, or render the card as a sheet over the side pane (`.gm-card` HTML in a fixed panel beside the keys; `F` or `Esc` closes). Risk: none; Focus is a per-device preference.

**A3 (phone) · The first screen is admin, not play.**
Evidence: `gm/03a-phone-situation.png` at 360 px: site header (home · table · rules · GM · signed in) → "GM TOOLS / The console" H1 → the stale-pack note → **Display · Export tonight's note · Update pack · Forget GM data** (four full-width buttons) → the segbar → "Console · Situations|Classic" → Position at ≈1100 device px, a screen and a half down. The sticky segbar helps only after the first scroll. `.gm-head` is built in `layout()` and only hidden by `body.gm-app` at ≥1100 px (gm.css laptop block).
Change (M): extend the app layout to the phone: hide the site header and `.gm-head`, a 44 px bar (`’68 GM · Session · Saved · iPad dot · ⋯`) whose `⋯` holds Display / Export / Update pack / Forget / Classic layout, the segbar directly under it. S alternative: keep the site header, drop the H1 and the four buttons into a `⋯` menu.

**A4 (phone) · Ten segments, five visible, nothing to scroll them.**
Evidence: `.seg` is `inline-flex` with no `overflow-x` (index.html:261); `.gm-segbar .chip { flex: 1 1 0; min-width: 0 }` cannot shrink below the text, so the bar overflows the viewport: `03a-phone-situation.png` shows `CONSOLE … ENGAGE`, `03-phone.png` shows `ENGAGE … STATE` only because Playwright's click scrolled it (gm.e2e.mjs:348). A thumb has no affordance and the rest (NPC, Cards, Screen, iPad, State) is reachable only by dragging the page sideways.
Change (S): `overflow-x: auto; scrollbar-width: none` with a right-edge fade is the minimum. Better (S–M): `Console · Prep · Tools · Screen · State`, where `Tools` opens a second row (`Location · Street · Engage · NPC · Cards · iPad`) only while a tool is selected.

### P2

**A5 · Classic 3×3 breaks words mid-syllable at 1280.**
Evidence: `gm/01b-gm-classic.png`: "DEVIL' S BARG AIN", "COMP LICATI ON", "CALLB ACK", "HARM & RESIS T". gm.css `.gm-buttons { repeat(3, …) }`, `.gm-btn b { overflow-wrap: anywhere }`; the laptop console is `clamp(300px, 26vw, 400px)` = 333 px at 1280, so each label gets ~50 px.
Change (S): `body.gm-app #gm-root[data-view="classic"] .gm-buttons { grid-template-columns: repeat(2, 1fr) }` below 1440, or stack the `kbd` above the label (`grid-template-columns: 1fr`) and `overflow-wrap: normal`.

**A6 · Tab key hints vanish on the common laptop widths.**
Evidence: gm.css `@media (min-width:1100px) and (max-width:1439px) { body.gm-app .gm-tab kbd { display:none } }`; `gm/01-gm-console.png` (1280: no keys on the tabs) vs `prep/prep-desktop.png` (1440: keys shown). `R` Prep, `B` Location, `T` Screen, `O` Cards are not mnemonic, so without the hints they cannot be learned at the table.
Change (S): take the **iPad** tab out of the row (the bar's `iPad: …` pill already opens that panel, key `I` stays) and tighten tab padding so the `kbd` fit at 1280; where a key is the label's initial (`S E N I`) underline that letter instead of a `kbd`. Optional, with muscle-memory risk for the owner: `G` for the GM screen and `C` for Cards are free.

**A7 · Four district pickers (moment B).**
Evidence: the console's `district` control (`con.live`, `renderControls`), Street `scn.ui.district` (`renderScenes` ~1654), Location `loc.ui.district` (`renderLocation`), NPC `npc.ui.district` (`renderNpcGen` ~1830). Walking into a new district means setting it up to four times, and they disagree silently (`01c`: console "any"; `scenes-desktop.png`: Street "Cobb Hill").
Change (M): one **Now in** district in the top bar (stored where the console's lives today), each tool's picker defaulting to "as the console" with a per-tool override. Replay is untouched: every stored roll keeps the resolved `ui`.

**A8 · "GM ONLY" on everything says nothing; what the players can see is the information.**
Evidence: `glanceHtml` ~1400 and `foldsHtml` ~1410 put `.gm-badge` on the glance and on every fold (`f.gm`); `gm/02-gm-location.png` shows eight orange GM ONLY badges in one card, while the only player-safe facts are a dashed band border with a `title` tooltip (`.gm-gband.shown`) and the Say box. The page is entirely GM-only.
Change (S): drop the fold and glance badges (keep the `.gm-secret` orange rule if wanted); add a mustard **PLAYERS SEE** chip on shown bands, on the Say box and on anything that has gone to the iPad; reword the empty state ("The card marks what the players can see"). Risk: `gm.e2e.mjs:220` asserts `/GM only/` in `#gm-loc .gm-loccard`; update it.

**A9 · "Put on stage" leaves the GM page mid-scene.**
Evidence: `renderNpcs` ~1760 and `prepPeek` ~1990: `<a class="btn sm" href="#cast/…">Put on stage</a>` navigates to the cast page; the console, rail and capture go.
Change (S): `target="_blank" rel="noopener"` as the rules search already does; (M) stage from here by writing `scene.npcs[id]` through the campaign API, with the rail's **On stage** box as the feedback.

**A10 · Single-letter keys meet the typing reflex (moment C).**
Evidence: `keyAction` 405–431: `h` blanks the laptop, `t` opens Screen without focusing *Find on the screen*. The natural "press `T`, type `heat`" blanks the screen on `h`, unblanks on `e`, opens Screen again on `t`.
Change (S): panel keys for Prep and Screen focus their find box (typing lands there); make blank `Shift+H` or require a second `H` within a second. `/` stays the universal "type here".

**A11 · The full rules search opens a new tab.**
Evidence: `renderRules` ~2060: "Search the rules (opens a new tab)", `W.open('#rules?q=…', '_blank')`, and the twelve term chips with `target=_blank`. Mid-argument the GM leaves the console; the GM screen sections cover the common cases but not the long tail.
Change (M): put the rules index into Find (`Ctrl+K`) and render a hit in the Screen pane (the display already renders rule `md`; `B68Rules` is loaded on the page). Keep the new-tab path as the fallback.

**A12 · A location roll does not draw the map.**
Evidence: `renderLocation`: the map box sits under nine folds and needs **Draw**; `rollLocation` sets `S.map = null`. At moment B the GM rolls, then scrolls past the folds to press Draw.
Change (S): draw the GM-layer `rings` view on roll when the Location tab is open (keep Draw for view/theme/layer changes). Risk: render time of the 1400 px svg; measure once.

### P3

**A13 · The Scene line's chips lose their labels.** `renderChips` ~1230 shows values only ("3" for the threat text, "anyone"): `03a-phone-situation.png` reads "SCENE 3". Print `Threat: 3`, `Aim: anyone` for text controls and non-default selects (S). Needed by A1 too.

**A14 · Toasts cover the capture input.** `.toast { bottom: 14px; left: 50% }` (index.html:186); `01-gm-console.png`, `02-gm-location.png`, `prep/screen-desktop.png` show "On the iPad: …" over the input and the File button. `body.gm-app .toast { bottom: 72px }` or top-centre under the bar (S).

**A15 · The Situations | Classic toggle** is a per-device preference taking the first 50 px of the most valuable column (`viewToggle`, `.gm-conhead`). Move it to the Menu as "Console: Situations / Classic" (S).

**A16 · Three screen words.** The **Screen** tab (the GM screen), the bar's **Display** link (opens `#display`, which is for the iPad), the **iPad** tab, and *Show on iPad* everywhere. Rename the tab **GM screen**, move **Display** into the Menu as "Open the display page (for the iPad)" (S).

**A17 · Type sizes at reading distance.** `.gm-lab` 10 px condensed (gm.css:15); `.gm-posb small` 10 px mono in the laptop block, which carries the severity/winds/harm the GM actually reads; `.gm-btn small` 11 px soft ink; `.gm-read` 13 px soft; `.gm-chip` 10.5 px. Labels to 11 px, `.gm-posb small` to 11.5 px and full ink on the active position, `.gm-read` to 14 px ink, chips 11.5 px (S). Test the Position row at 333 px.

**A18 · Duplicates and a destructive button in the always-visible bar.** *Export tonight's note* is in the capture bar and the Menu; **Clear** (confirm-guarded, `clearCapture`) sits at the far right of the capture bar. Move both to the Menu; the bar keeps buckets · input · File · "N filed" · File last roll (S).

**A19 · Engagement factors as a select labelled with two opposite statements** ("THE PLAN IS NEAT / IT LEANS ON TOO MANY PEOPLE" with the value "+1d", `renderEngagement` ~1712, `scenes/engagement-desktop.png`). A three-chip `.seg` per factor, `−1d leans on too many people · — · +1d the plan is neat`, says which is which (S).

**A20 · "Not listening" pill when the transcriber was never set up** (`renderBar`): show it only once `want` has ever been on, or hide it unless the iPad has reported (S).

**A21 · Map View / Theme ahead of Layer / Reveal.** The GM needs Layer, Reveal and Show on iPad at the table; View and Theme are presentation. Fold View/Theme under the map, keep the iPad row where GM.md wants it (S).

---

## 3. Target layout

### Laptop (≥ 1100 px; 1280×900 is the case to design for)

- **Bar (46 px)**: `’68 GM · Session 4 · Saved · [Pack 5 days old] · [● Titles 3/5 min · Next beat] · … · Find Ctrl K · iPad: ambient · [Listening, only when set up] · Clear → ambient 0 · Lights out · Menu`. Menu: Export tonight's note, Update pack, Open the display page (iPad), Console view (Situations/Classic), Classic layout, the site's pages, Forget GM data.
- **Console column (left, 333–400 px), top to bottom, nothing else above the card**:
  1. **Position** (always).
  2. `Scene · Cobb Hill · Aim: anyone · Threat: 3` one-line disclosure, closed (opens the five controls).
  3. The **four Situation buttons** (2×2) — in Classic, the nine in two columns below 1440.
  4. **The card** (lead line visible without scrolling), then **Earlier**.
  5. `More tables +` (the nine singles), closed.
- **Side panel tabs, grouped and named**: READ `Prep R` · `GM screen T` | ROLL `Location B` · `Street S` · `Engage E` · `NPC N` | TABLE `Cards O`. The iPad panel opens from the bar's pill (key `I`), not from the row. `Focus F` stays at the right; a roll in Focus brings the card back (A2).
- **Rail**: as now (pinned prep, crew, clocks, bargains owed, pins, on stage).
- **Foot**: buckets `P X M L` · input · File · "N filed" · File last roll. Toasts above it.

### Phone (< 600 px)

- No site header, no "The console" H1: a 44 px bar (`’68 GM · S4 · ● iPad · ⋯`), then the sticky segbar `Console · Prep · Tools · Screen · State` (Tools opens a second row: Location · Street · Engage · NPC · Cards · iPad).
- Console: Position → Scene line with labelled chips → four buttons → card → Earlier → More tables. A roll scrolls the card header to just under the sticky bar. Capture stays on the mustard FAB.

---

## 4. Dead weight in play (hide behind the Menu or a fold)

- Update pack · Forget GM data on this device · Classic layout (already in the laptop Menu; top-level on the phone).
- The **Display** link (setup, not play).
- **Export tonight's note** (end of the night; appears twice).
- The **Situations | Classic** toggle (per-device preference).
- The **Downloads** fold's SVG / note / canvas (after the game).
- The NPC tab's "The cast page" link; "Put on stage" if it keeps leaving the page.
- The Crew box's sentence "Session N · read-only here; change it on the table" (the bar shows the session; a link to the table belongs in the Menu).
- The "Not listening" pill until the transcriber exists.
- The **Single tables** row (fold under the card).
- The **full rules search** block under the GM screen (keep, behind `Full rules ▾`), and the map's View / Theme selects (fold under the map).

---

## Appendix · evidence index

| Ref | Where |
|---|---|
| Console column order | `app/gm-page.js` `layout()` ~992–1004 |
| No scroll after a roll | `stamp()` ~1290, `drawConsoleCard()` ~1327 |
| Focus hides everything but keys | `app/gm.css` laptop block, `#gm-root.focus .gm-console > :not(.gm-mini)` |
| Key map | `keyAction` `app/gm-page.js:405–431` |
| Tab kbd hidden 1100–1439 | `app/gm.css` `@media (min-width:1100px) and (max-width:1439px)` |
| Phone segbar overflow | `app/index.html:261` `.seg`; `app/gm.css` phone block `.gm-segbar .chip` |
| Phone header actions | `layout()` `.gm-head` / `.gm-acts`; hidden only by `body.gm-app` |
| GM-only badges | `glanceHtml` ~1400, `foldsHtml` ~1410; `gm.e2e.mjs:220` asserts the text |
| Put on stage navigates | `renderNpcs` ~1760, `prepPeek` ~1990 |
| Rules search new tab | `renderRules` ~2060 |
| Toast position | `app/index.html:186` |
| Four district pickers | console `con.live.district`; `scn.ui`, `loc.ui`, `npc.ui` |
| Shots | `scratchpad/shots/gm/01c-gm-situation.png`, `01b-gm-classic.png`, `02-gm-location.png`, `03-phone.png`, `03a-phone-situation.png`, `prep/prep-wide.png`, `prep/screen-desktop.png`, `scenes/engagement-desktop.png` |
