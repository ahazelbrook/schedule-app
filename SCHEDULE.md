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
  quorum: 0..12,                 // GM: how many "yes" make a date workable (0 = everyone known)
  attendance: {                  // GM: who came to which session, keyed by session number
    '<sessionNumber>': { <userId>: true | false }   // true = was there, false = missed it, absent = not recorded
  }
}
```

Maps, not arrays, everywhere a person writes, so concurrent PATCHes from different people merge
(objects merge recursively; `null` deletes a key). An RSVP whose `at` differs from `next.at` is
stale (the GM moved the session) and reads as no answer.

A missing `schedule` reads as `{ options: {}, avail: {}, next: null, rsvp: {}, cadence: null,
quorum: 0 }`. `defaultCampaign()` (server) and `defaults()` (page) gain that key. A missing `attendance` reads as `{}`
(the page's `defaults()` carries it; the server needs no default for it, see Permissions). Only the newest 20 sessions
are kept: a write that records a session deletes the older keys with `null`.

## Permissions

- GM: everything under `schedule`.
- Player (anyone else who can write): only their own keys, `schedule.avail.<me>.*` and
  `schedule.rsvp.<me>.*` (`<me>` = the caller's id). Adding, moving or removing options,
  confirming `next`, cadence, quorum and `attendance` are GM only.
- On Cloudflare the API enforces it in `playerMayWrite(before, after, meId)`: the changed-paths
  check gains `['schedule', 'avail', me, <any>]`, `['schedule', 'avail', me]` (whole own entry
  set or deleted) and the same two for `rsvp`. Any other change under `schedule` is
  `403 "only the GM can change that"` (so `schedule.attendance` needs no rule of its own: a player writing it is 403). `schedule`, when present in a body, must be a plain
  object (400 `"schedule must be an object"`, like `crew` and `session`).
- In the artifact the page enforces the same rule (the artifact db has no server rules).

## Page

- **Next-session card**, shown at the top of the app in every mode (creator, sheet, table; not the season print)
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
    option (most yes, then the larger total missed streak among the yes people, then most maybe,
    then soonest) and any meeting the quorum are marked. Each person's note shows under their
    name, and "missed N" beside it when their missed streak is 1 or more.
  - The RSVP board: while `next` is set, the crew line-up at true height (every filed character)
    under the next session. A character whose owner answered "in" stands in full colour with an
    accent mark at the feet, "out" is a silhouette, no answer is greyed; every character of an
    owner follows that owner's answer. Names under the figures; people who answered but own no
    character are chips underneath.
  - GM: "Copy reminder" (when `next` is set) and "Copy date poll" (when dates are open): plain
    text for the group chat, copied to the clipboard.
  - GM: the latest session's attendance, one chip per known person, to correct.
  - GM: add an option (date + time + length), "Add the next three" from the cadence, remove
    an option, "Confirm" an option (sets `next` from it, logs "Next session: <date>",
    and removes options at or before it), cadence and quorum settings.
  - Past options (`at` older than 12 h) are hidden and the GM can "Clear past dates".
- Starting session N (session bar) clears `next` when it is within 12 h of now, records the
  answers for it as `attendance[N]` (in -> true, out -> false, no answer -> not recorded), and
  drops the past options, in the same write.
- The next-session card nudges the viewer when `next` is less than 3 days off and they have not
  answered: accent styling and "Are you in?" with the buttons, shown even when the card is
  collapsed on a phone.
- Times: stored as UTC instants; entered and shown in the viewer's local time.
- `.ics`: one VEVENT, `UID` = `b68-<at>@blades68`, `DTSTART`/`DTEND` in UTC, summary
  "Blades '68 · <crew name or 'session'>", location = place, description = note.

## Schedule page (decisions)

`app/schedule.js` + `app/schedule.css`; checked by `app/checks/schedule.js` (four people sharing one stubbed db),
by `npm run check:schedule` (`checks/runtime/schedule.e2e.mjs`: a GM and a player against a real local server) and by
the schedule steps in `npm run check:api` (the own-keys rule and GM-only `attendance`).

- boot.js subscribes to `campaign/main` once, as soon as the files settle, in every mode; the table page attaches to
  that subscription while it is open (leaving the table no longer unsubscribes). Nothing is written on open.
- Saves carry only the changed schedule leaves (`{schedule:{avail:{<me>:{o_x:'yes'}}}}`), a removed key as `null`.
  campaign.js strips everything but `avail.<me>` / `rsvp.<me>` from a player's schedule delta.
- People known: the viewer, owners of filed characters, everyone in `avail` / `rsvp`. Names through `profiles`,
  else "Someone" ("You" for the viewer). The GM is only listed once they answer or own a character.
- Best option: most yes, then the larger total missed streak among the yes people (the date that brings back whoever
  missed most wins a tie), then most maybe, then soonest, and only once someone has said yes or maybe. Quorum 0 means
  every known person.
- Missed streak: the number of most recent recorded sessions in a row where the person is `false`; sessions with no
  entry for them are skipped (not recorded is neither there nor missed). "missed N" shows beside the name when N ≥ 1.
- Attendance: recorded only when starting a session consumes `next` (within 12 h) and someone answered; a session with
  no entries is not stored. The GM corrects the latest session (the started one, or a later recorded one) with a chip
  per known person cycling was there -> missed it -> not recorded; each tap writes the one leaf. Players never write it:
  campaign.js strips it from a player's delta like every other key but `avail.<me>` / `rsvp.<me>`.
- The RSVP board draws the line-up (`B68Figure.lineup`, low detail) only when the filed characters change (id, name,
  playbook, spec); an answer only re-colours the kept SVG (SVG filters for the silhouette and the grey) and the names.
  The SVG node is kept in schedule.js and put back after each table render (`B68Schedule.mountBoard`). Order: the
  viewer's characters first, then by owner name, then character name, unowned last. On a phone the chart scales down
  to the box width; only whole-foot marks are labelled. The chart stays light in dark mode, as in the creator.
- Copy reminder: `Blades '68 · Sat 17 Oct, 19:00 – 23:00 at Gail's. <note.> In: Alex, Pat. Out: Sam. No answer yet:
  Vic. <link>`; "In: nobody yet." when empty, empty Out / No answer parts left out, names sorted. Copy date poll: a
  first line `Blades '68 · which dates can you make?`, then one line per open date `Sat 14 Nov, 19:00 · 1 yes, 0
  maybe` (`(best so far)` on the best), then `No answer yet: …` (nobody who answered any open date) and `Mark your
  dates: <link>`. The GM who copies is never listed as not answered. Times in the viewer's locale and time zone. The
  link is `location.origin + location.pathname` only when served over http(s) and not framed (the artifact's frame URL
  is no link to share); otherwise left out. `navigator.clipboard.writeText`, else the text selected in a read-only
  textarea and `document.execCommand('copy')`; the box shows what was copied, with a confirmation.
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
