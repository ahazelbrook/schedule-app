# Build vs. buy: scheduling a Blades in the Dark group

Date: 2026-10-05
Question: do we need to build a scheduling app with Google Calendar integration, or does something already do the job?

## Short answer

Do not build yet. **Roll Call (rollcall.camp)** already does exactly what was asked for: it is purpose-built for recurring TTRPG campaigns, it reads each player's busy time from Google Calendar (and Apple Calendar) so nobody has to fill in a poll, it picks a slot for each cycle on a weekly / biweekly / monthly cadence, it writes confirmed sessions back to everyone's calendar, and it nags people over Discord, email and push. Only the GM pays ($2 to $6 per month), players are free, and there is a 30 day trial with no card.

If paying is a dealbreaker, **Can We Play? (canweplay.games)** is the best free option. It is a persistent, no-poll group availability calendar with ICS subscription into Google Calendar, but it does not read players' calendars and has no visible reminders.

If the group already lives in Discord and wants to stay there, **Sesh** (free tier) or **Apollo** (free tier) cover RSVPs, reminders and recurring events, with calendar sync behind a premium tier.

## What was required

1. Schedule a recurring TTRPG session for one group.
2. Google Calendar integration, ideally two-way: know when people are busy, and put the confirmed session on their calendars.
3. Low friction for players, since the GM is the one who cares.

## Candidates evaluated

### Tier 1: purpose-built for recurring TTRPG groups

| Product | Model | Google Calendar | Recurring | RSVP / reminders | Discord | Price | Notes |
|---|---|---|---|---|---|---|---|
| **Roll Call** (rollcall.camp) | Players connect calendars; app finds slot per cycle | **Two-way**: reads busy times, writes confirmed sessions | Weekly / biweekly / monthly, auto-finds a slot each cycle | Yes: email, Discord, push, SMS on Pro | Yes, bot with reminders and public nudging | Starter $2/mo (1 campaign, 6 players, read-only sync); Regular $4/mo (3 campaigns, 10 players, read/write sync); Pro $6/mo (unlimited, 18 players, SMS). 30 day trial, no card. Players free. | Also dodges holidays, lets players block vacations, has "fairness" rotation so the same player is not always the one missing. Web, Android app, Discord app. Closed source, small vendor ("The Floor Is Lava"). |
| **Can We Play?** (canweplay.games) | Persistent group calendar; players mark dates available / maybe / unavailable with notes | **One-way out**: ICS subscription feed for confirmed sessions | Yes, "set up your game once, no new poll every session" | Ranked candidate dates; no reminders mentioned anywhere on site | Login via Discord or Google only, no bot | Free, ad-free | Date-level, not time-level, availability. Co-GM support. Very little public info about who runs it or how long it will be around. |
| **Tabletop Time** (tabletoptime.us) | Poll-style voting on proposed slots with quorum and waitlist | **Export only**: .ics / Google Calendar link on finalization | "Campaign mode" groups candidate dates by shared availability | Live vote tally pinned by bot; reminders via bot | Yes, Discord and Telegram bots | Free hosted; open source (CC-BY-NC-SA), self-hostable via Docker | GitHub mels0n/tabletop_scheduler: 8 stars, ~500 commits, Next.js + Prisma + SQLite. No login needed to vote. No calendar reading. |
| Game Night HQ | "Coming soon" | n/a | n/a | n/a | n/a | n/a | Not shippable yet. |
| WhenItWorks | One-off poll | None by design | No | No | No | Free | Explicitly avoids calendar sync. Not a fit. |

### Tier 2: Discord event bots

| Product | Google Calendar | Recurring | Availability finding | Price |
|---|---|---|---|---|
| **Sesh** (sesh.fyi) | Free: 1 outbound sync per user. Premium: two-way sync, 5 per user. ICS feed via `/link`. | Premium only | "Time Finder" polls (beta), timezone-aware | Premium $6.99/mo per server (annual) |
| **Apollo** (apollo.fyi) | Free: manual. Premium: automatic sync. | Free: 5 active recurring events. Premium: unlimited. | Polls only | Premium $7.99/mo or $69.99/yr |
| Raid-Helper | Similar | Yes | Signup roles | MMO-raid oriented, overkill for a 4 to 6 person table |
| DisCal / CalendarBot / PyScheduler | Google Calendar bridge bots | Varies | No | Free / self-host, hobby-grade |

Bots are good at RSVP and reminders but weak at the hard part, which is discovering when people are free. Their free tiers put the Google Calendar sync behind a paywall that costs more than Roll Call.

### Tier 3: generic group polls

| Product | Fit |
|---|---|
| Doodle | Free plan is now 1 active poll, 10 slots, ads for everyone, no reminders. Pro is $11/seat/mo. Calendar-aware but priced for business. Not worth it for a game group. |
| When2meet / LettuceMeet | Free, no account, grid availability. No recurrence, no calendar sync. Fine for one session, painful every week. |
| Rallly | Free, open source, ad-free poll. No recurrence, no calendar sync. |
| Cal.com / Calendly | 1:1 booking tools, not group availability. Wrong shape. |

Community advice (r/rpg, Substack posts) converges on: always have the next session booked before the current one ends, send a real calendar invite, and use a poll only for the exceptions. That matches what Roll Call and Can We Play? automate.

## Recommendation

1. **Start a Roll Call trial this week.** Create the Blades campaign, invite the players, have each connect Google Calendar. The Regular tier ($4/mo) is the one that matches the ask because it has read/write sync; Starter is read-only. Run it for two scheduling cycles.
2. **Fallback if the group refuses to connect calendars or you want $0:** Can We Play?, with each player subscribing to the ICS feed in Google Calendar. Add a Sesh or Apollo free-tier event in Discord for reminders if you need them.
3. **Build only if** after the trial you hit one of these gaps, none of which any product above covers:
   - You want availability inferred from calendars *and* a Discord-native voting flow in one tool, for free.
   - You need Blades-specific features bolted onto scheduling (downtime tracking, clock reminders, session recaps emailed with the invite).
   - You want to own the data and self-host, and Tabletop Time's poll model is not enough. In that case fork Tabletop Time (already Next.js + Prisma, Dockerised) and add Google Calendar free/busy reading rather than starting from zero.

## Risks with the recommendation

- Roll Call is a small, closed-source vendor. Export is limited to what lands in your calendar. If it shuts down you lose the availability history, not the sessions.
- Can We Play? has no visible maintainer, pricing or roadmap. Treat it as "free until it isn't".
- Google Calendar busy-time reading means players grant calendar read access to a third party. Some players will decline; Roll Call falls back to manual blocking for them.

## Sources

- Roll Call: https://rollcall.camp/ and https://rollcall.camp/pricing
- Can We Play?: https://canweplay.games/
- Tabletop Time: https://tabletoptime.us/features and https://github.com/mels0n/tabletop_scheduler
- Sesh manual and premium: https://sesh.fyi/manual/ and https://sesh.fyi/premium/
- Apollo: https://apollo.fyi/ and https://apollo.fyi/premium
- Doodle free limits: https://www.usecarly.com/blog/doodle-pricing/ and https://rallly.co/blog/is-doodle-still-free
- Poll tool comparison: https://calclear.app/blog/when2meet-vs-doodle
- Discord bot roundup: https://dev.to/ravendev/best-discord-bots-for-gaming-team-scheduling-2026-h4b
- Scheduling practice: https://jacke.substack.com/p/how-to-schedule-ttrpg-sessions-that
