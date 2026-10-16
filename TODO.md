# TODO: the fresh-eyes review (16 Oct 2026)

The central list for the review-and-improve pass. Update it as items land (move them to **Done** with the commit), so
the state survives a session running out. Severity: **P1** wrong or misleading at the table · **P2** slows the GM or a
player down · **P3** polish. Effort: S (under an hour) · M (an evening) · L (a weekend). Never deploy on a game day
(next: Sat 17 Oct 2026).

## 0. Reported bugs on the iPad display (in progress)

- [ ] P1 · The planning-meeting ambient scene lags on the iPad (3.1 MB svg, 550 motion groups, 8 filters / 12
      feTurbulence, a 24 fps loop rewriting transforms). Fix in the generator, regenerate. · M
- [ ] P1 · The opening-credits theme is silent on the iPad (audio unlock / file missing / WebAudio and the mute
      switch: diagnose, fix, and make the display SAY which it is). · S-M
- [ ] P1 · Figures' heads sometimes disappear in the ambient scenes (the motion merge leaves a frame with no version
      of a part, or a clip path inside a hidden variant group, which WebKit will not resolve). Fix in motion.js,
      regenerate, prove with a frame walk. · M

## 1. The GM page: quick access to what the GM needs (review A in progress)

First impressions to confirm or refute:
- [ ] P2 · The result card lands BELOW every control in the console column, under the fold on a laptop. Put the card
      first (or fold the scene controls once set, as the phone already does). · M
- [ ] P3 · "GM ONLY" badge on every fold of the location card is noise on an all-GM page; mark what players can see. · S
- [ ] P2 · Phone: the first screen is header + pack note + Display / Export / Update pack / Forget before any control.
      Move those into the menu, as the laptop bar does. · S
- [ ] P3 · Side tabs mix reading (Prep, Screen), generators (Location, Street, Engage, NPC) and output (Cards, iPad);
      "Screen" next to "Display" and "iPad". Group and name them. · S
- [ ] P3 · 10 px labels and 12.5 px mono at arm's length: a larger laptop type scale. · S

## 2. The generators (review B in progress)

## 3. The players' side (review C in progress)

- [ ] P3 · `app/checks/crewsheet.js` read-only expectation is stale: it does not allow the "The cast" link. · S

## 4. Engineering: performance, robustness, security, docs (review E in progress)

- [ ] P2 · 2.3 MB of JS loads synchronously on every page for everyone (figure kit 676 KB, map kit 252 KB, gm-page
      196 KB, display 76 KB...). Lazy-load per route, keep "no build step". · M
- [ ] P3 · 16 root docs, several historical (PLAN, RESEARCH, AMBIENT-PLAN, DEPLOY-PROMPT, SCHEDULE...). Consolidate. · S

## Done
