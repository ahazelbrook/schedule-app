# Plan: a private Roll Call for one Blades in the Dark table

Date: 2026-10-09
Companion to `RESEARCH.md`. This is the plan if we build instead of paying $48/year for Roll Call.

## 0. Honest framing

For one table of 4 to 6 people, the build is a hobby project, not a cost saving. The MVP below is roughly 50 to 70 focused hours, which is several years of Roll Call subscription. Build it because you want to own it, extend it with Blades-specific features, or enjoy it. Nothing in the plan assumes it will be sold.

## 1. What we are cloning

The behaviour that matters, taken from Roll Call's feature list:

1. One campaign with a cadence (weekly / biweekly / monthly) and preferred play windows (e.g. Sunday 18:00 to 22:00, Tuesday 19:00 to 23:00), a session length, and a quorum.
2. Players' busy time comes from their Google Calendar automatically. They can also block out vacations and mark "maybe".
3. Each cycle the app finds the best slot, proposes it to the GM (or auto-confirms), and the session lands on everyone's calendar.
4. RSVP tracking with reminders and nagging over Discord and email.
5. Holiday avoidance and a fairness rule so the same player is not always the one left out.

Everything else Roll Call has (multi-campaign billing, SMS, 18-player tiers, Android app) is out of scope.

## 2. The decision that shapes everything: how to touch Google Calendar

Google Calendar scopes are "sensitive". An OAuth app that requests them must either pass Google's verification (privacy policy page, homepage, justification, usually one to four weeks of back and forth) or stay in "Testing" status, where every player's refresh token expires after 7 days and they have to re-consent weekly. A Workspace "internal" app avoids this but only for users inside one Workspace org, which a friend group is not.

Recommendation: **do not use Google OAuth in the MVP.** Use the two mechanisms Google Calendar already exposes without any app review:

| Direction | Mechanism | Cost to player | Caveat |
|---|---|---|---|
| Read busy time | Each player pastes the "Secret address in iCal format" of their calendar(s) into the app once. The app fetches the ICS feed on a schedule and stores only busy intervals, never titles. | 2 minutes, once | The secret URL exposes full event details to the server, so store only start/end and let players revoke by resetting the URL in Google. Google serves the feed with some delay (minutes to a few hours). |
| Write sessions | (a) a per-campaign `webcal://` subscription feed each player adds once, plus (b) a one-click "Add to Google Calendar" link per session, plus (c) an email with a `.ics` invite attached (`METHOD:REQUEST`), which Gmail renders with Yes/No/Maybe buttons. | 1 minute, once | Google refreshes subscribed feeds slowly (hours), so the email invite is what makes the session show up promptly. |

Two-way OAuth sync (read free/busy via the API, write events directly with attendees, read RSVP status back from the event) becomes Phase 7, an optional upgrade once the core works and if the weekly re-consent or verification process is worth it.

## 3. Architecture

Single deployable Next.js app plus a scheduled job. Deliberately boring.

```
Browser (GM dashboard, player availability page)
        |
   Next.js 15 (App Router, TypeScript, server actions, Tailwind)
        |                       \
   Postgres (Neon free tier)     Cron (Vercel Cron, hourly)
   via Drizzle ORM                 - refresh ICS feeds
        |                          - run scheduler for upcoming cycle
   Integrations                    - send reminders / nudges
     - ICS fetch + parse (node-ical)
     - ICS generation (ics)
     - Email (Resend, free tier)
     - Discord (webhook for announcements; bot with slash commands later)
     - Holidays (date-holidays)
     - Auth.js with Discord provider (no Google OAuth needed)
```

Why these choices:

- **Next.js on Vercel**: zero ops, free hobby tier, cron built in. The only state is Postgres.
- **Neon Postgres + Drizzle**: free tier is plenty for 6 users; Drizzle keeps migrations as plain SQL. (Alternative: SQLite on a Fly.io volume if you prefer one container and no external DB. Same code, swap the driver.)
- **Discord login**: the group is almost certainly on Discord already, Discord OAuth needs no verification, and it gives the Discord user ID we need to ping people by name.
- **Resend**: 3,000 emails/month free, supports `.ics` attachments, simple API.
- **date-holidays**: public holidays per country/region without an API key.

Running cost: $0/month on free tiers. Optional domain ~$12/year.

## 4. Data model

```
users            id, discordId, email, displayName, timezone
campaigns        id, name, gmUserId, cadence (weekly|biweekly|monthly),
                 sessionMinutes, quorum, countryForHolidays,
                 preferredWindows JSON [{weekday, startHHMM, endHHMM}],
                 anchorDate (first session), autoConfirm bool, discordWebhookUrl
memberships      campaignId, userId, role (gm|player), required bool,
                 missedStreak int, missedTotal int
calendar_feeds   id, userId, label, secretIcsUrl (encrypted), lastFetchedAt, lastError
busy_blocks      id, userId, feedId, startUtc, endUtc        -- cache rebuilt on each fetch
overrides        id, userId, startUtc, endUtc, status (busy|maybe|free), note
sessions         id, campaignId, cycleIndex, startUtc, endUtc,
                 status (proposed|confirmed|cancelled|played),
                 proposedAlternatives JSON, icsUid
rsvps            sessionId, userId, status (yes|no|maybe|none), respondedAt
notifications    id, sessionId, userId, channel, kind, sentAt    -- idempotency log
```

## 5. The scheduler

Pure function, no I/O, so it is unit-testable: `proposeSlots(campaign, members, busy, overrides, holidays, now) -> Candidate[]`.

1. **Cycle window**: from the last confirmed session plus the cadence, take the surrounding period (for weekly: that week; biweekly: that fortnight; monthly: that month).
2. **Candidates**: every start time at 30 minute steps inside each preferred window where the full session length fits. For weekly that is typically 10 to 30 candidates.
3. **Per-player availability** for a candidate: `free` if no busy block or busy override overlaps; `maybe` if only a maybe override overlaps; else `busy`.
4. **Hard filters**: GM must be free; required players must be free; free count must reach quorum.
5. **Score** (higher wins):
   - +10 per free player, +4 per maybe
   - +3 per free player whose `missedStreak` ≥ 1 (fairness)
   - −15 if the day is a public holiday or the eve of one
   - −2 per 30 minutes away from the window's canonical start (keeps the "usual" slot sticky)
   - tie-break: earlier date
6. **Output**: top 3 candidates with the per-player breakdown. If `autoConfirm` and the best candidate has everyone free, confirm it; otherwise post the proposal to the GM (web + Discord) and wait.

Edge cases to handle explicitly: no candidate meets quorum (propose skipping the cycle and notify), player with no feed and no overrides (treat as "unknown", counts as maybe), DST transitions (store UTC, compute windows in the campaign's timezone with `date-fns-tz`).

## 6. Phases and effort

Effort is focused developer hours for one person using Claude Code or similar for the typing; expect roughly 1.5x if coding by hand. Calendar time assumes evenings and weekends.

| Phase | Deliverable | Hours | Depends on |
|---|---|---|---|
| 0. Skeleton | Next.js + Drizzle + Neon + Auth.js (Discord) + deploy to Vercel. Login works. | 4 to 6 | – |
| 1. Campaign & roster | GM creates campaign, sets cadence/windows/quorum/holiday region. Invite link. Players join, set timezone. | 6 to 8 | 0 |
| 2. Availability | Player pastes ICS secret URL; hourly fetch into `busy_blocks`; override UI (block dates, mark maybe); "my availability" week view; feed health shown to GM. | 12 to 16 | 1 |
| 3. Scheduler | Pure `proposeSlots` with tests; cron runs it per cycle; GM sees top 3 with breakdown; confirm / pick alternative / skip cycle. | 8 to 12 | 2 |
| 4. Calendar out | Session ICS generation; per-campaign webcal feed; "Add to Google Calendar" link; email invite with `.ics` via Resend on confirm and on change. | 6 to 8 | 3 |
| 5. RSVP & reminders | RSVP page (one-click from email/Discord); Discord webhook announces proposal and confirmation; reminders at T−3d and T−1d; nag non-responders; update `missedStreak` after session. | 10 to 14 | 4 |
| 6. Polish | Mobile layout, GM dashboard (next session, RSVP grid, feed status), cancel/reschedule flow, session history, error handling, basic observability. | 8 to 12 | 5 |
| **MVP total** | | **54 to 76** | |
| 7. Google OAuth (optional) | Google provider, free/busy API instead of ICS, write events with attendees, read RSVP from event, OAuth verification submission. | 12 to 20 + weeks of waiting | 6 |
| 8. Discord bot (optional) | Slash commands: `/rsvp`, `/availability`, `/next`, ephemeral replies, DM reminders instead of channel pings. | 8 to 12 | 5 |
| 9. Blades extras (optional) | Session recap field in the confirmation email, downtime/clock reminder in the T−1d message, "who's got the next score" prompt. | 4 to 8 | 5 |

Usable after Phase 4 (~35 to 50 hours): the group has a self-scheduling calendar without reminders. Full Roll Call parity for one table after Phase 6.

## 7. Repository layout

```
/app                 Next.js routes
  /(gm)/campaign     dashboard, settings, proposals
  /(player)          availability, rsvp
  /api/cron/*        refresh-feeds, run-scheduler, send-reminders (Vercel Cron)
  /api/feed/[token]  webcal ICS feed
/lib
  /scheduler         proposeSlots.ts + tests   (pure)
  /calendar          icsFetch.ts, icsBuild.ts, gcalLink.ts
  /notify            email.ts, discord.ts, templates/
  /db                schema.ts, migrations/
/tests               vitest
```

## 8. Risks and mitigations

- **ICS secret URLs are powerful credentials.** Encrypt at rest, show only the label in the UI, store busy intervals not event bodies, document how to reset the URL in Google.
- **ICS feed lag.** Google can take hours to reflect changes. Mitigate with a "refresh now" button and by running the scheduler 7+ days before the cycle, then re-checking at T−3d.
- **Time zones.** One player abroad will find every bug. Store UTC, render in the viewer's timezone, test DST boundaries in the scheduler suite.
- **Cron on Vercel hobby** runs at most once per day per job unless on Pro. Use a single hourly job on Pro, or run the cron from a free GitHub Actions schedule hitting the endpoint, or host on Fly.io where cron is unrestricted. Decide in Phase 0.
- **Scope creep.** The optional phases are tempting. Ship Phase 6 and use it for two cycles before starting any of them.

## 9. First week

1. Phase 0 in one sitting: scaffold, Discord login, deploy, invite yourself.
2. Write `proposeSlots` and its tests before any availability UI, using hand-written fixtures. The scheduler is the only interesting code; get it right first.
3. Paste your own ICS URL, confirm busy blocks match your calendar, then invite one player.
