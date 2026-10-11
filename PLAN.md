# Plan: the Blades '68 crew app

Date: 2026-10-09. Companion to `RESEARCH.md`.

## Status

This is the original product plan. Much of it was superseded; the rest of the file is kept
as written. What was actually built:

- **Stack.** Not Next.js, Postgres and Discord login. The app is a plain HTML/JS page in
  `app/` with no build step, running as a claude.ai artifact or on Cloudflare Pages +
  Functions + D1 behind Cloudflare Access (Google or an emailed code). See `DEPLOY.md` for
  why, and the root `README.md` for the real layout.
- **Data.** Characters are documents in a `characters` collection (`app/CONTRACT.md`); the
  crew, clocks, session, log and schedule live in one shared campaign document
  (`CAMPAIGN.md`, `SCHEDULE.md`). There are no users, memberships or scheduling tables as in
  §3.
- **Track 1, the creator (A to E).** A single-page creator was built first, as §7 suggested,
  and is what `app/` runs today (sixteen steps, the figure kit vendored). The creator is now
  being redone separately as "v3"; creator features in Track 1 are out of scope for this
  repository's current work.
- **Rulebook content (§1.3).** Transcribed: the twelve playbooks' creation content in
  `app/content.js`, the six crew playbooks in `app/crews.js`. The full rulebook text is not
  kept in the repository.
- **Crew line-up (`/crew`).** The creator page shows the crew line-up at true height. The
  RSVP board became part of the schedule box on the table page: every filed character at
  true height, in colour for "in", a silhouette for "out", grey for no answer.
- **Dossier page, printable.** Each living sheet has a Print button (one character), and the
  season print (`#print`, "Print the season" on the table page) prints the crew and every
  character in one document.
- **Crew creation (the "Phase J" in §5).** Built: the six crew playbooks and a full crew
  sheet on the table page.
- **Track 2, scheduling.**
  - F. Availability: no ICS busy-feed import. Cloudflare Access sits in front of every URL
    and nothing polls feeds (the Worker could run a cron, but nothing is set up for it). Instead the GM proposes
    dates and each person marks yes / maybe / no, with a free-text note for absences.
  - G. Scheduler: no `proposeSlots` or cron. The GM adds dates by hand or "Add the next
    three" from a cadence; the grid marks the best date (most yes, then whoever missed most
    lately, then most maybe, then soonest) and any that meet the quorum. The GM confirms.
  - H. Calendar out: a per-session `.ics` download and a Google Calendar link. No webcal
    feed (a calendar app cannot sign in through Access) and no email invites.
  - I. RSVP and reminders: In / Can't make it on the next-session card, the RSVP board,
    attendance recorded when the GM starts a session, and the "missed N" streak used in the
    best-date tie-break. No Discord webhook and no T-3d / T-1d push or email: the card nudges
    ("Are you in?") within 3 days, and the GM copies a reminder or a date poll as plain text
    for the group chat.

A private scheduling app for one Blades '68 table, where the front door is a video-game style character creator. A player's profile *is* their character: pick a playbook, build the figure, dress it, fill in the rulebook's character creation sheet, and get a mugshot and a place in the crew line-up. Scheduling (availability, the next score, RSVPs, reminders) hangs off the crew.

Every drawing is produced by the **figure kit v2** from the Blades '68 Design System (`https://claude.ai/artifact/9Ud97s5QUvRk1ufsStUvTr`), so the app looks like the rulebook: no outlines, shape-and-light, grain, 60s wardrobe, true scale. The UI uses the design system's tokens, fonts and components (PosterTitle, Kicker, RulesTable, AbilityCard, RatingDots, SheetField, Track, Stamp, ChapterPlate).

## 0. Honest framing

This is a hobby build. The scheduler alone is 54 to 76 focused hours; the creator roughly doubles it. The creator is also the part players will actually enjoy, so it is built first and shipped on its own before any scheduling exists.

## 1. Experience

### 1.1 The creator, screen by screen

Layout is the console character-creator pattern: the figure stands live on the left (or on top, on a phone), redrawn on every change, with a step rail across the top and the current step's options on the right. Each step is one of the rulebook's registers: poster type for the big choices, sheet components for the small ones. A "Random" button on every step seeds a sensible figure so a player never faces an empty mannequin.

| Step | What the player does | Kit / DS pieces | Notes |
|---|---|---|---|
| 1. Playbook | Flick through eight playbook covers: poster word, descriptor kicker, "Core playbook ONE of EIGHT", the figure silhouetted in that playbook's scheme. Pick one. | `PosterTitle`, `Kicker`, `K.render(..., {scheme, silhouette})`, `duo-*` tokens | Sets the scheme, halo colour, ID prefix, starting action dots and a default wardrobe preset. Operative, Radical, Hit Squad and Utopians have no duotone in the system; they get `ink` until you supply their pages. |
| 2. Build | Masc/fem, silhouette (`rect`, `invtri`, `column`, `pear`, `oval`, `hourglass`, `lanky`, `slim`, `lean`), height slider shown against the crew's true-height line-up, `heads`, `build`, skin (9 presets), age. | `K.lineup` chart, `RatingDots`-style steppers | Height against Booker (6'5") and Alfie (5'5") is the joke. Keep it visible. |
| 3. Face | Head shape, eyes, brows, nose, mouth, expression (13), marks, facial hair, makeup, eyewear. | `K.portrait` at hi detail | Portrait preview switches on for this step. |
| 4. Hair & hat | 20 hairstyles, colour, grey, 9 hats. | | |
| 5. Outfit | Ten slots (base, mid, outer, neck, bottom, dress, legs, feet, waist, hands). Each slot: garment type, `cloth-*` swatch, optional pattern. "Playbook kit" presets (the Hound's trench and tie, the Veteran's tactical jacket). | Swatch grid from the wardrobe palette | Palette discipline is enforced softly: the UI shows "dominant / secondary / accent" and warns past three colours. |
| 6. Props & company | 19 props, 2 companions. Picking a prop auto-sets the arm pose it needs (cigarette → `smoke`, briefcase → `carry`). | | Kit warnings are surfaced inline, never silently dropped. |
| 7. Attitude | Stance, per-arm pose, head tilt and yaw, stoop. | | |
| 8. Dossier | The rulebook's character creation sheet: name, alias, look, heritage, background, vice, action ratings, one special ability, friend and rival, items, crew. | `SheetField`, `RatingDots`, `AbilityCard`, `ContactRow`, `CheckItem`, `TriggerList` | Content comes from `content/playbooks/<name>.json`, transcribed from the book (see 1.3). |
| 9. Mugshot | `K.portrait` with the ID plate (`HND-968-0312`), halo in the playbook colour, a `Stamp`. "Join the crew" adds the figure to the line-up. | `Stamp`, `StatBadge` | Download SVG / PNG for Discord avatars. |

### 1.2 After the creator

- **Crew line-up** (`/crew`): everyone at true height on the chart, GM included. This page becomes the RSVP board later: a figure steps forward for "in", goes to silhouette for "out", greys for "no answer".
- **Dossier page** per character: portrait, sheet, the choices as a printed playbook spread. Printable.
- **Re-tailor**: any step can be reopened; the spec is versioned so an old figure still renders after kit upgrades.

### 1.3 Rulebook content

The design system holds only the "Choose a Playbook" table and the crew sheets. For step 8 the app needs, per playbook: the descriptor line, starting action ratings, the special abilities list (name, text, prompt), heritage/background/vice lists, starting items, friends and rivals. That is a one-time transcription from the rulebook pages (Characters chapter, pp. 10 to 85) into JSON. Estimate 30 to 45 minutes per playbook. Crew creation can be transcribed from `assets/sources/Blades 68 crew sheets.pdf`, which has a text layer.

Needed from you before Phase C: the character creation pages as PDF or images, or the vault notes under `Wiki/Games/Blades in the Dark/`. Also the ID prefixes for the six playbooks the system doesn't name (only HND and PAL are canon).

## 2. Architecture

```
Browser
  Next.js 15 (App Router, TypeScript), React 18, Tailwind for layout only
  Design system: tokens.css, fonts, components/bundle.js   (vendored from the DS artifact)
  Figure kit: figures/figure-kit.js (UMD, window.B68Figure), cast.js (canon PCs/NPCs)
  Creator state: one spec object (kit v2 schema) + one sheet object, in a reducer; autosaved
        |
  Server actions + Drizzle -> Postgres (Neon)        Node also runs the kit: SSR of SVG for
        |                                            share cards, PNG via resvg for Discord
  Auth.js (Discord login)   Resend (email)   Discord webhook   Cron (feeds, scheduler, reminders)
```

Why:

- **The kit is synchronous and pure.** `K.render(spec)` returns SVG in a few ms, so live preview is just React state. No canvas, no WebGL, no asset pipeline.
- **Vendor, don't link.** Copy `figure-kit.js`, `cast.js`, `tokens.css`, `components/bundle.js`, `bundle.css` and the fonts into `/vendor/b68/` with the DS version noted. Upgrading is a copy plus a visual regression run.
- **Generic option pickers.** `K.options()` returns every registered name by kind, and `CATALOG.md` is generated from the same registry. Steps 2 to 7 are one `SlotPicker` component driven by that registry, not 29 hand-built screens. Part descriptions in the catalogue become tooltips.
- **Spec is the source of truth.** `characters.spec` (jsonb) is a verbatim kit v2 spec; `characters.sheet` (jsonb) holds the rulebook choices. Rendering is derived, never stored except as a cached PNG.

## 3. Data model

```
users          id, discordId, email, displayName, timezone
campaigns      id, name, gmUserId, cadence, sessionMinutes, quorum, countryForHolidays,
               preferredWindows JSON, anchorDate, autoConfirm, discordWebhookUrl
memberships    campaignId, userId, role, required, missedStreak, missedTotal
characters     id, userId, campaignId, playbook, name, alias, code (XXX-968-NNNN),
               spec JSONB (kit v2), sheet JSONB (rulebook choices), kitVersion,
               portraitPngUrl, createdAt, updatedAt
content        playbooks JSON (from the rulebook), crews JSON (from the crew sheets)   -- files, not DB
-- scheduling tables unchanged:
calendar_feeds, busy_blocks, overrides, sessions, rsvps, notifications
```

## 4. Phases and effort

Focused hours for one person using Claude Code for the typing. Multiply by about 1.5 if coding by hand.

### Track 1: the creator (ship this first)

| Phase | Deliverable | Hours |
|---|---|---|
| A. Shell | Next.js app, DS tokens/fonts/components vendored, kit loaded, Discord login, deploy. Playbook carousel (step 1) with scheme-coloured silhouettes. | 10 to 14 |
| B. Figure creator | Generic `SlotPicker` over `K.options()`; steps 2 to 7; live figure and portrait; random; kit warnings inline; autosave spec to DB. | 18 to 26 |
| C. Dossier | Playbook content JSON schema + loader; step 8 with sheet components; validation (one ability, dots within budget). Excludes the transcription itself. | 10 to 14 |
| D. Mugshot, crew, export | Step 9 with ID plate and stamp; `/crew` line-up; per-character dossier page; SVG/PNG export; share card. | 8 to 12 |
| E. Polish | Phone layout (preview on top, option strip below), motion tokens for step transitions, empty states, printable dossier. | 8 to 12 |
| **Creator total** | | **54 to 78** |
| Content transcription (you) | Eight playbooks into JSON | 4 to 6 |

### Track 2: scheduling (unchanged from the earlier plan, re-skinned)

| Phase | Deliverable | Hours |
|---|---|---|
| F. Availability | ICS secret-URL feeds, busy block cache, overrides ("downtime"), per-player week view. | 12 to 16 |
| G. Scheduler | Pure `proposeSlots` with tests, cron, GM proposal view ("the next score"). | 8 to 12 |
| H. Calendar out | Session ICS, webcal feed, Add-to-Google link, email invite with `.ics`. | 6 to 8 |
| I. RSVP and reminders | Line-up as RSVP board, Discord webhook with the crew image, T−3d/T−1d nudges, missed-streak fairness. | 10 to 14 |
| **Scheduling total** | | **36 to 50** |

**Everything: 90 to 128 hours.** The creator is usable after Phase D (about 46 to 66 hours). Google OAuth two-way sync stays optional, for the same verification reasons as before: use ICS feeds and email invites in the MVP.

## 5. Risks and decisions

- **Rulebook content is the gate for step 8.** Everything else can be built from what the design system already holds. Build A, B and D first; C waits on the transcription.
- **Mobile is the hard screen.** Nine steps and ten outfit slots on a phone need a strict two-pane layout. Design that before Phase B, not during E.
- **Kit upgrades.** Pin the kit version in `characters.kitVersion` and keep a visual regression page that renders every saved character side by side after any vendor copy.
- **Rights.** The kit, tokens and fonts come from your own design system. The rulebook text in `content/` is yours to transcribe for a private table. Keep the app private (Discord login, invite link only).
- **Canon.** New named PCs are canon decisions. Offer an "export spec to cast.json" button so a finished character can be added to the design system's cast by hand.
- **Scope creep.** Crew creation (six crew types, claims grid, cohorts) is a natural Phase J. Leave it until the table has used the creator for a month.

## 6. Repository layout

The original proposal, not built. The real layout is in the root `README.md`.

```
/app
  /(creator)/new/[step]      nine steps, one route each, shared layout with the live figure
  /crew                      line-up, later the RSVP board
  /character/[id]            dossier page
  /(gm)/campaign             scheduling dashboard (Track 2)
  /api/render/[id].png       SSR portrait for Discord and share cards
  /api/cron/*                feeds, scheduler, reminders (Track 2)
/vendor/b68                  figure-kit.js, cast.js, tokens.css, components bundle, fonts, DS version
/content/playbooks/*.json    transcribed rulebook data
/content/crews/*.json
/lib/creator                 spec reducer, SlotPicker registry, presets per playbook, random()
/lib/scheduler               proposeSlots.ts + tests (Track 2)
/lib/calendar, /lib/notify   Track 2
/tests                       vitest; a render-every-character regression page
```

## 7. First week

1. **Prototype the creator as a single-page artifact first** (one day). The design system already ships a `FigurePlayground`; a creator is that playground with a step rail and option pickers instead of a JSON textarea. No backend, state in the URL. Put it in front of two players and watch them. This settles the mobile layout and the step order before any Next.js code exists.
2. Phase A: vendor the DS, playbook carousel, deploy.
3. Send me the character creation pages so the playbook JSON can be drafted while B is in progress.
