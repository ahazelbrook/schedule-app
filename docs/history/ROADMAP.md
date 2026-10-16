> **What landed since (16 Oct 2026):** phase 1, display names (`PATCH /api/me`, "Change name" on Home), phase 4, the cast (`CAST.md`), and phase 5, the rules wiki (`RULES.md`). Phases 2, 3 and 6, the scheduling work, are parked until November or December: the dates live in Google Calendar. Kept as the plan was written; the live docs are at the repository root.

# Roadmap: names, the season calendar, the cast, the rules

Date: 2026-10-13. Planning only. Nothing here is built yet. It follows on from `PLAN.md` (status section),
`SCHEDULE.md`, `CAMPAIGN.md` and `HOSTING.md`, and keeps their conventions: plain HTML/JS in `app/` with no
build step, one Cloudflare Worker with D1 behind Access, maps (not arrays) wherever more than one person
writes, the server enforcing who may write what, and Playwright and API checks for every change.

> **Revised 13 Oct.** The dates to the end of the year are already set in Google Calendar, so the scheduling
> work (phases 2, 3 and 6) is parked until November or December. Build order now: **5 (rules wiki)**, then
> **4 (the cast)**, then 1 (names). The rules for the BitD rulebook come from
> `C:\Vault\Hazel Second Brain\Wiki\Games\Blades in the Dark\Rules\Rulebook`, loaded through the in-browser
> importer, so the text still never enters git.

## What was asked, and what it means in this codebase

| Ask | Where it lands | Size |
|---|---|---|
| People can change their names ("hey" → "Isaac") | Names come from the Access token's `name` claim, which is empty for emailed-code logins, so `auth.js displayName()` falls back to the email's local part. `/api/me` overwrites `members.name` on every visit, so even a DB edit would not stick. | Small |
| A calendar of the sessions already organised to the end of the year | The schedule holds **one** confirmed session (`schedule.next`) plus proposed dates. The six real sessions live in Google Calendar ("Hazelbrook Fam", "Playing Blades '68": Sat 17 Oct, Fri 23 Oct, Sat 7 Nov, Sat 21 Nov, Fri 27 Nov, Fri 18 Dec, 7:30 to 10:30 pm Melbourne time). The data model needs a list of sessions, each with its own RSVPs. | Large (the riskiest change) |
| Borrow from the open-source scheduler (Tabletop Time) | It is CC BY-NC-SA 4.0 and built on Next.js/Prisma, so nothing ports directly, and ShareAlike would bind this repository. **Reimplement the ideas and copy no code.** | Spread over phases |
| NPC portraits with a short description ("show my players Grunt, and he is there") | The figure kit already draws anyone: `cast.js` has 12 archetype NPCs. What is missing is a place to keep NPCs, a way to make or edit one, and a way to show one to the table. | Medium to large |
| A rules wiki for both books | The full rules are markdown on your PC (`C:\Vault\Hazel Second Brain\.claude\skills\blade\references\`). The repo is **public**, so the text goes into D1 and never into git. | Medium to large |

## Order, and why

```
1 Names ──► 2 Season data model ──► 3 Season calendar + Google import ──► 6 RSVP extras (+ optional push)
                                    └─► 4 The cast (NPCs + "on stage")    └─► 5 Rules wiki
```

1. **Names first.** Small and independent, so it ships before Saturday's game. Every later screen (the calendar
   tallies, the RSVP board, "on stage") shows people's names, so fix those first.
2. **The season data model next, alone.** It changes the shape the next-session card, the RSVP board,
   attendance, the server rule, the adapter's merge and the installed phones' cached code all depend on. Do it
   in one focused phase with a compatibility mirror, between game nights, before any UI is built on it.
3. **The calendar on top of it,** plus getting the six Google Calendar dates in.
4. **The cast** after that. It is independent of scheduling but touches the same router, `boot.js` and
   `index.html`, so it runs after 3 rather than in parallel.
5. **The rules wiki.** It is independent, but it is gated on getting the markdown files from your PC (see
   Prerequisites), so it slots in once they are available. It could swap places with 4.
6. **RSVP extras** last. They are nice to have, they all build on 2 and 3, and the important ones (a maybe
   answer, cancel or move with a reason) are already folded into 2 and 3.

Each phase is its own branch and PR, merged only when `npm test`, `check:e2e`, `check:schedule`,
`check:phone` and the phase's own new checks are green. Deploy (`scripts/deploy.sh`) runs only after the
merge.

### Fitting it around game nights

| Window | Ship |
|---|---|
| Now to Fri 16 Oct | Phase 1 (names). Meanwhile set `next` to Sat 17 Oct by hand in the current app, so the card and RSVPs work this week. |
| Sat 24 Oct to Fri 6 Nov (the longest gap) | Phases 2 and 3 together. The data change goes out when no session is imminent. |
| Sun 8 Nov to Fri 20 Nov | Phase 4 (the cast), ready for Grunt on 21 Nov. |
| Sun 22 Nov onward | Phase 5 (rules), then 6. |

Never deploy on a game day. The service worker means phones keep the previous version until they reload, so
every data change must be readable by the previous release's code for one release (see Phase 2).

---

## Phase 1. Display names

**Goal:** everyone picks the name the table sees. The GM can rename anyone, including people who have not
signed in yet.

- **Data.** `campaign.people.<userId> = { name: '' }` in the shared campaign document, not a new D1 column.
  - It works in both runtimes (artifact and Worker), syncs through the existing poller and offline queue, and
    needs no migration.
  - The GM can pre-name an email before that person ever signs in.
  - Max 40 characters, trimmed, with no control characters.
- **Server.** `functions/_lib/campaign.js`, `playerMayChange`: allow `['people', me]` and
  `['people', me, 'name']` for a player. The GM may write anything. `people` must be a plain object (400
  otherwise, like `crew` and `schedule`). Add it to `defaultCampaign()` and the page's `defaults()`.
- **Names everywhere.** `boot.js profiles()` and `cf.js makeUser().profiles` check `campaign.people[id].name`
  first, then the member's token name, then the email's local part. One place, so the schedule, log, roster,
  RSVP board and players panel all follow.
- **UI.**
  - A "Your name" field on Home, plus a small "What should the table call you?" prompt on first visit while
    your name is still your email's local part.
  - The GM gets an edit pencil per person in the table page's players panel.
  - A rename appends a log line ("hey is now Isaac").
- **Checks.**
  - `flow.mjs`: a player sets their own name, but another person's is 403. The GM sets anyone's.
  - `campaign.js` page check: the name shows in the log, the schedule grid and the RSVP board.
  - `adapter.test.mjs`: profiles overlay.
- **Done when:** Isaac signs in, types "Isaac" once, and every screen says Isaac.

## Phase 2. The season data model (many sessions, one answer each)

**Goal:** the schedule holds every planned session, each with its own in / maybe / out, without breaking
anything that reads `next` today.

- **Data** (inside `campaign.schedule`, so no new table and no new endpoint):
  ```js
  sessions: {                 // GM only
    s_xxx: { at: ISO, minutes: 180, place: '', note: '', status: 'on' | 'cancelled', reason: '',
             src: null | 'gcal:<uid>', seq: 0 }       // seq bumps on any change, for the .ics SEQUENCE
  },
  going: {                    // each person's own answers, like `avail`
    <userId>: { s_xxx: 'in' | 'maybe' | 'out' }
  }
  ```
- **"Next" becomes derived:** the earliest `on` session whose end is still ahead. `upcoming()`, the card, the
  RSVP board and "Start session N" all read the derived value.
- **Compatibility for one release.**
  - `normalize()` turns an old `next` into a session, and old `rsvp` answers into `going`.
  - Every GM write that changes `sessions` also writes the derived `next`.
  - A player's answer for the next session also writes `rsvp.<me>`.
  - So phones still running the old cached page see the right next session. Remove the mirror in Phase 6.
- **Confirm many.** The availability grid's "Confirm" becomes "Lock in selected dates (N)" (Tabletop Time's
  campaign mode): pick several columns, and they all become sessions.
- **Attendance.** Starting session N uses the session within 12 h and records from `going` ('maybe' counts as
  not recorded). The missed-streak rule is unchanged.
- **Cancel or move.**
  - Cancel needs a reason, keeps the session visible and struck through, and logs a line.
  - Moving the time keeps the id and answers but bumps `seq`.
  - Answers stay, but the card asks "Still in for the new time?" until the person confirms.
- **Server.** `playerMayChange`: add `['schedule', 'going', me, …]`. `sessions`, `status` and everything else
  is GM only. Keep at most 60 sessions: past ones beyond the newest 20 are pruned the same way attendance is.
- **Files:** `app/schedule.js` (data half), `functions/_lib/campaign.js`, `app/runtime/cf.js` (only if the
  merge needs it; `mergeNull` already handles maps), `SCHEDULE.md` (contract v2 first, code second).
- **Checks.**
  - Extend `app/checks/schedule.js` with four people on one db: several sessions, cancel, move, the old-`next`
    upgrade, and an old-client read of the mirrored `next`.
  - Extend `check:schedule` (a GM and a player on a real server) and `flow.mjs` (the `going` own-keys rule, GM
    only for `sessions`).
- **Done when:** the six dates can be held at once, and every existing check still passes unchanged except
  where the contract deliberately moved.

## Phase 3. The season calendar and the Google Calendar dates

**Goal:** a "Season" screen showing every session to the end of the year, with your answer one tap away.

- **Route.** `#season`, linked from Home, the next-session card ("then Fri 23 Oct · 5 more this year") and the
  table page's schedule box.
- **Desktop:** a month grid (Oct, Nov, Dec) beside an agenda list. **Phone:** the agenda only, one card per
  session. Each card shows:
  - day, date, time, place, countdown, and a cancelled stripe and reason when cancelled;
  - the tally (in, maybe, out, no answer, by name);
  - your In / Maybe / Out buttons;
  - a small RSVP line-up: the existing board, reused at low detail;
  - for past sessions: the session number, attendance chips and the log lines from that night.
- **Calendar files.**
  - "Add all to my calendar" gives one `.ics` with every session: stable `UID` per session id, `SEQUENCE` =
    `seq`, `STATUS:CANCELLED` for cancelled ones, and `LOCATION` (Tabletop Time leaves that out).
  - A Google Calendar link per session.
  - The existing single-session `.ics` stays.
- **Getting the six dates in.** Two options; Phase 3 does A, and B is optional.
  - **A. One-off seed (recommended to start).** The GM's "Add sessions" form takes a date list (or a pasted
    block), prefilled from the cadence. The six dates are two minutes of typing. Alternatively a Claude session
    with the Google Calendar connector can read them and produce the list.
  - **B. Ongoing sync, Google Calendar as the source of truth for dates.**
    - Store the calendar's "Secret address in iCal format" as a Worker secret (`GCAL_ICS_URL`). Never put it in
      the campaign document, because every player can read that, and the address exposes the whole family
      calendar.
    - A Worker cron (`[triggers] crons = ["17 * * * *"]`) plus a GM "Sync now" button fetches it server side.
    - It keeps only events titled "Playing Blades '68" and upserts `sessions` by UID (`src: 'gcal:<uid>'`).
    - An event deleted in Google becomes `cancelled`.
    - RSVPs stay in the app. Writing answers back to Google needs OAuth app verification, so it is out of scope.
- **Checks:** a new `app/checks/season.js` (desktop, phone, dark, cancelled, past, read-only), `check:phone`
  extended to `#season`, an ICS unit test (folding, UID, SEQUENCE, CANCELLED), and for B, a sync unit test
  against a fixture ICS (title filter, upsert, delete → cancelled).

## Phase 4. The cast: NPC portraits and "on stage"

**Goal:** the GM keeps a gallery of NPCs drawn in the rulebook style, reveals them when the crew meets them,
and can put one "on stage" so every open screen shows "Grunt is here".

- **Storage.** A new D1 table `npcs (id, campaign, created_at, updated_at, deleted, doc)` (migration
  `0002_npcs.sql`) and `/api/npcs` (GET, PUT, PATCH, DELETE; writes are GM only).
  - **Unrevealed NPCs and `gmNotes` are left out of what players receive.** This is real secrecy, unlike
    hidden clocks, which are presentation only.
  - The adapter (`cf.js`) learns `collection('npcs')` with the same `since` polling. `/api/characters`
    reports `npcsUpdatedAt` next to `campaignUpdatedAt`, so it costs no extra request.
  - In the artifact runtime it is a plain collection, and hiding is presentation only (as with clocks).
- **NPC document:**
  `{ name, alias, role, faction, description, spec /* figure kit v2 */, revealed, firstSeen, tags, gmNotes }`.
- **Making one** (GM). This does **not** reuse the creator's steps, because the creator is being redone
  separately as v3 and should not be coupled to.
  - Start from one of the 12 cast archetypes (dock heavy, fence, watch sergeant…) or a blank figure.
  - A compact editor driven by `K.options()`: figure, height, build, skin, age, expression, hair and colour,
    facial hair, hat, eyewear, four outfit colours, props.
  - Or paste a spec. A Claude session using the Blades '68 figures skill can draw Grunt from your description
    and hand you the spec.
- **Players see:** "The cast" on the table page: revealed NPCs as mugshots (`K.portrait`), name, role and
  description. Tapping one shows the full figure at true height next to the crew.
- **On stage.**
  - `campaign.scene = { npcs: [ids], at }` (GM only). Revealing happens in the same write.
  - Every open screen in every mode shows a dismissible banner or overlay with the portrait and the
    description within one poll (about 4 s).
  - "Clear the stage" removes it.
  - It is logged ("Grunt appeared, session 4"), which sets `firstSeen`.
- **Print:** the season print gains a cast page of revealed NPCs.
- **Checks:**
  - `flow.mjs`: a player never receives an unrevealed NPC or `gmNotes`, and an NPC write is 403 for a player.
  - adapter tests for the new collection.
  - a new `app/checks/cast.js` (editor, gallery, stage banner on a second viewer, phone, dark, print).
- **Needs from you:** a rough description of Grunt (and any other NPCs you want seeded).

## Phase 5. The rules wiki

**Goal:** players look up any rule, or a key term such as Downtime, Personal business, Heat or Position &
effect, from anywhere in the app, offline included.

- **Getting the text in, with nothing in git.**
  - A GM-only "Import rules" screen. You pick the `references` folder in the browser on your PC
    (`<input webkitdirectory>`).
  - The page splits each markdown file at its headings into entries:
    `{ book: 'b68' | 'bitd' | 'house', slug, title, chapter, path, body, aliases }`.
  - It posts them in batches to `POST /api/rules/import` (GM only), which replaces that book's rows in a D1
    table `rules` (migration `0003_rules.sql`).
  - Re-run it whenever the notes change. No CLI is needed on Windows.
- **Reading.** `GET /api/rules` (signed in) returns the whole corpus once, a few hundred KB compressed.
  - The page builds a small in-memory search index: title and aliases first, then the body.
  - The corpus is cached for offline use like the rest of the app.
  - Route `#rules` and `#rules/<slug>`: a search box, a book switch (Blades '68 / Blades in the Dark / both),
    a chapter tree and a pinned Key terms list.
  - When both books define a term, the '68 entry shows first, with "Blades in the Dark says…" folded beneath
    it, because '68 is a hack of the base game.
- **Cross-links.** Small "?" chips open the entry in a side drawer without leaving the page:
  - on the sheet's Downtime box (each activity), stress, trauma, harm and xp triggers;
  - on the crew sheet's heat, wanted, claims and rep;
  - on the table page's clocks.
- **Rendering.** A small vendored markdown renderer plus sanitiser (MIT-licensed, version noted, like the
  figure kit), so there is still no build step.
- **House rules.** The GM can add or edit `house` entries in the app, and these show above both books.
- **Licensing.**
  - The Blades in the Dark SRD is CC BY 3.0: show its required credit line on the rules screen.
  - Blades '68 has no open licence: its text stays only in your D1, behind Access, and out of the repository
    and the backup JSON.
- **Checks:** splitter unit tests on fixture markdown (shaped like your files, with invented text); `flow.mjs`
  (import is GM only, read requires sign-in); `app/checks/rules.js` (search, a cross-link from the Downtime box,
  offline, phone, dark).
- **Needs from you:** see Prerequisites.

## Phase 6. RSVP and scheduling extras (ideas from Tabletop Time, Roll Call, Can We Play?)

These are pick-and-choose. In rough value order:

1. **Session health badges** (Tabletop Time's quorum levels): "On" (enough in), "At risk" (in + maybe below the
   quorum: the GM is warned on the card and the season screen), "Full table" (everyone in).
2. **Away dates** (Roll Call's holiday blocks): `schedule.away.<me> = [{ from, to, note }]`. Sessions in the
   range show you as away (amber, distinct from out). Proposed dates in the range are greyed for you, and the
   GM sees the clash before locking in a date.
3. **Victorian public holidays** greyed on the calendar and grid (a short static list per year).
4. **Hosting per session** (Tabletop Time's "can host"): "I can host" on a session. The GM picks the host, and
   the place fills in.
5. **Chase list:** per session, who has not answered, and "Copy reminder" for any session (today it works for
   the next session only). Plus "Copy the season", a summary of every date for the group chat.
6. **Season attendance table:** sessions × people, from the attendance already recorded.
7. **Remove the Phase 2 compatibility mirror** (`next` / `rsvp`) once every device has updated.
8. **Optional: push notifications** to installed phones: 3 days before, the day before, the afternoon of,
   a session cancelled or moved, new dates to vote on.
   - Web Push with VAPID keys (Worker secrets), a `push_subs` table, and the same cron as Phase 3B.
   - No mail service is needed. iPhones only get pushes when the app is added to the Home Screen.
   - Most valuable if the group-chat reminder is not already enough.

**Deliberately left out:** waitlists and seat limits (a table of three or four), magic links and accounts
(Access already does identity), writing RSVPs back to Google Calendar (OAuth verification), and Discord or
Telegram bots (say if the group lives in one, and a webhook post becomes a small Phase 6 item).

---

## Models and rough token use

**Opus 5.5** for the phases where a subtle mistake breaks something already working: the data contract, the
server write rules, the adapter and secrecy. **Sonnet 5.5** for well-specified UI on top of a settled
contract. **Fable 5.1** is not needed: it costs 2.5× Opus. Keep it in reserve only if Phase 2 gets stuck.
**Haiku 5.5** has no good fit here: the rules splitting is plain code, not a model job.

Figures are per phase in a Claude Code session. "Input" is mostly cached re-reads of the repository
(`tracker.js`, `boot.js` and `schedule.js` alone are about 70k tokens), and output is code, docs and checks.
The dollar figure is the API-equivalent cost at list prices (Opus 5.5: $4 / $20 per M; Sonnet 5.5: $2 / $10;
cache reads $0.20; about 90% of input cached). On a Pro or Max plan this is usage allowance rather than money,
so read it as relative size.

| Phase | Model (effort) | Input tokens | Output tokens | ≈ API $ | Sessions |
|---|---|---|---|---|---|
| 1. Names | Sonnet 5.5 (high) | 2–3 M | 30–50 k | $1–2 | 1 |
| 2. Season data model | **Opus 5.5 (xhigh)** | 6–9 M | 100–150 k | $6–9 | 1–2 |
| 3. Season calendar + import (A) | Sonnet 5.5 (high) | 5–8 M | 100–150 k | $3–5 | 1–2 |
| 3B. Google Calendar sync (optional) | Opus 5.5 (high) | 2–3 M | 30–50 k | $2–3 | 1 |
| 4. The cast: API, adapter, secrecy | **Opus 5.5 (high)** | 4–6 M | 60–90 k | $3–5 | 1 |
| 4. The cast: editor, gallery, stage | Sonnet 5.5 (high) | 5–7 M | 100–140 k | $3–4 | 1 |
| 5. Rules wiki | **Opus 5.5 (high)** for import, search and API; Sonnet 5.5 for UI | 7–10 M | 120–180 k | $5–8 | 2 |
| 6. RSVP extras 1–7 | Sonnet 5.5 (high) | 5–7 M | 90–130 k | $3–4 | 1–2 |
| 6.8 Push (optional) | Opus 5.5 (high) | 4–6 M | 60–90 k | $3–5 | 1 |
| Review pass per phase (`/code-review`) | Opus 5.5 | ~1–2 M each | ~10 k each | ~$1 each | |
| **Total, everything (with reviews)** | | **≈ 50–75 M** | **≈ 0.8–1.1 M** | **≈ $35–55** | **10–13** |
| **Core asks only (1–5, no 3B, with reviews)** | | **≈ 35–50 M** | **≈ 0.55–0.8 M** | **≈ $26–38** | **7–9** |

These are rough estimates (±50%). The biggest drivers are how many fix-and-recheck loops the Playwright checks
need, and whether a phase starts from a fresh session (cheaper: put the phase brief in the prompt rather than
re-reading this whole conversation).

## Prerequisites and open decisions

1. **The rules files (blocks Phase 5).** They are on your PC, and this cloud session cannot reach `C:\`. Either:
   - copy the `references` folder into a private Google Drive folder, so a session can read the structure
     through the Drive connector and design the splitter around it; or
   - run Phase 5 as a local Claude Code session on your PC.

   The import itself is done by you in the browser either way.
2. **Grunt (needed for Phase 4):** a rough description: build, age, clothes, manner, faction.
3. **Source of truth for dates (Phase 3).** Keep adding sessions in Google Calendar and let the app sync (3B),
   or move date-keeping into the app and use its "Add all to my calendar"? Recommendation: start with A, and
   add 3B only if you keep editing in Google.
4. **The public repository already contains Blades '68 text.** `app/content.js` and `app/crews.js` hold the
   transcribed playbooks. Consider making the repository private. The plan above keeps the full rules out of
   git either way.
5. **One person, two emails.** If a player signs in with a different email from the one on their calendar
   invite, Phase 1's `people` map can hold an alias so the sync (3B) matches them. This matters only with 3B.
