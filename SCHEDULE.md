# Schedule contract (Phase 3, last part)

When is the next session, who can make it, and a one-tap way to say so. It lives in the shared
campaign document (`campaign/main`, see CAMPAIGN.md) under a new top-level key `schedule`, so
it works in both runtimes with no new collection, and the hosted build gets it through the
existing `/api/campaign` and adapter.

No email, push or calendar feeds: Cloudflare Access sits in front of every URL, so a calendar
app cannot subscribe to a feed, and Pages has no cron. Instead each person adds the confirmed
session to their own calendar (an `.ics` file or a Google Calendar link), and the app shows the
next session at the top of every screen.

## The document

```js
schedule: {
  options: {                     // candidate dates the GM proposes, keyed by id ('o_' + base36)
    o_xxx: { at: ISO, minutes: 240, note: '' }   // `at` is a UTC instant
  },
  avail: {                       // each person's answers, keyed by user id (email on Cloudflare,
    <userId>: {                  //   user.id() in the artifact)
      o_xxx: 'yes' | 'maybe' | 'no',
      note: ''                   // optional free text ("away the week of the 20th")
    }
  },
  next: null | { at: ISO, minutes: 240, place: '', note: '', confirmedAt: ISO },
  rsvp: {                        // answers for `next`, keyed by user id
    <userId>: { at: ISO, v: 'in' | 'out' }   // `at` = the next.at this answer was for
  },
  cadence: null | { weeks: 1..4, weekday: 0..6, time: 'HH:MM', minutes: 240 },   // GM
  quorum: 0..12                  // GM: how many "yes" make a date workable (0 = everyone known)
}
```

Maps, not arrays, everywhere a person writes, so concurrent PATCHes from different people merge
(objects merge recursively; `null` deletes a key). An RSVP whose `at` differs from `next.at` is
stale (the GM moved the session) and reads as no answer.

A missing `schedule` reads as `{ options: {}, avail: {}, next: null, rsvp: {}, cadence: null,
quorum: 0 }`. `defaultCampaign()` (server) and `defaults()` (page) gain that key.

## Permissions

- GM: everything under `schedule`.
- Player (anyone else who can write): only their own keys, `schedule.avail.<me>.*` and
  `schedule.rsvp.<me>.*` (`<me>` = the caller's id). Adding, moving or removing options,
  confirming `next`, cadence and quorum are GM only.
- On Cloudflare the API enforces it in `playerMayWrite(before, after, meId)`: the changed-paths
  check gains `['schedule', 'avail', me, <any>]`, `['schedule', 'avail', me]` (whole own entry
  set or deleted) and the same two for `rsvp`. Any other change under `schedule` is
  `403 "only the GM can change that"`. `schedule`, when present in a body, must be a plain
  object (400 `"schedule must be an object"`, like `crew` and `session`).
- In the artifact the page enforces the same rule (the artifact db has no server rules).

## Page

- **Next-session card**, shown at the top of the app in every mode (creator, sheet, table)
  whenever `schedule.next` is in the future or started less than `minutes` ago: the day, date
  and time in the viewer's locale, place, a countdown ("in 6 days", "tonight", "now"), the
  RSVP tally with names, the viewer's own In / Can't make it buttons, and "Add to calendar"
  (an `.ics` download through `downloads`, plus a Google Calendar link). One line on a phone
  when collapsed. Hidden when there is no next session.
- **Schedule box on the table page**, above the clocks:
  - The confirmed next session (GM: set or change date/time, length, place, note; clear it).
  - The availability grid: one column per open option (future ones, soonest first), one row
    per known person (members on Cloudflare; on the artifact, the owners of filed characters,
    everyone who has answered, and the viewer). Each cell is yes / maybe / no / blank; the
    viewer taps their own row's cells to cycle. Column footers count yes and maybe; the best
    option (most yes, then most maybe, then soonest) and any meeting the quorum are marked.
    Each person's note shows under their name.
  - GM: add an option (date + time + length), "Add the next three" from the cadence, remove
    an option, "Confirm" an option (sets `next` from it, logs "Next session: <date>",
    and removes options at or before it), cadence and quorum settings.
  - Past options (`at` older than 12 h) are hidden and the GM can "Clear past dates".
- Starting a session (session bar) clears `next` when it is within 12 h of now and drops the
  past options, in the same write.
- Times: stored as UTC instants; entered and shown in the viewer's local time.
- `.ics`: one VEVENT, `UID` = `b68-<at>@blades68`, `DTSTART`/`DTEND` in UTC, summary
  "Blades '68 · <crew name or 'session'>", location = place, description = note.

## Schedule page (decisions)

`app/schedule.js` + `app/schedule.css`; checked by `app/checks/schedule.js` (four people sharing one stubbed db).

- boot.js subscribes to `campaign/main` once, as soon as the files settle, in every mode; the table page attaches to
  that subscription while it is open (leaving the table no longer unsubscribes). Nothing is written on open.
- Saves carry only the changed schedule leaves (`{schedule:{avail:{<me>:{o_x:'yes'}}}}`), a removed key as `null`.
  campaign.js strips everything but `avail.<me>` / `rsvp.<me>` from a player's schedule delta.
- People known: the viewer, owners of filed characters, everyone in `avail` / `rsvp`. Names through `profiles`,
  else "Someone" ("You" for the viewer). The GM is only listed once they answer or own a character.
- Best option: most yes, then most maybe, then soonest, and only once someone has said yes or maybe. Quorum 0 means
  every known person.
- Confirm, "Remove" and "Clear past dates" also drop everyone's answers for the removed options (GM writes). Confirm
  keeps the previous `next.place`. Setting or moving `next` by hand logs "Next session: …" / "Next session moved to
  …"; changing only place / note / length logs nothing. Clearing `next` clears `rsvp`.
- Starting a session clears `next` (and `rsvp`) when `next.at` is within 12 h of now, and drops the options before
  now + 12 h (not only those older than 12 h), so tonight's date leaves the grid.
- The RSVP buttons are on the card only; the table box shows the tally with names. Read-only viewers can still
  download the `.ics` / open the Google Calendar link (not a write).
- Countdown: "in N min" (under an hour), "tonight" (same day, 17:00 or later) / "today", "tomorrow", "in N days" (up
  to 20), "in N weeks", "now" while it runs. The card hides once `at + minutes` has passed.
- The card is collapsed by default on screens up to 760 px (one line) and open on wider ones; the choice is remembered
  per browser (`localStorage b68.nextOpen`).
