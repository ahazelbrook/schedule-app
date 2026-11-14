/* features.js — the registry of the suite's features (suite ticket W0.2; the night rebuild, N0).

   EVERYTHING BUILT IS ON. The Switchboard is gone and nothing can turn a feature off any more. Three lines are SETTINGS, real choices the GM makes
   (Menu > Settings, gm/settings.js): phoneCards (Phones: sheet only / mission cards), fx.off (Scenes: moving / held still) and room.music
   (Music: scene themes / heat music). A setting reads its stored value exactly as before; every other line reads ON whatever a document holds.
   The values stored before stay where they are, untouched and unread, so a rollback to the build with the Switchboard finds them as they were.
   This file is the one list: the GM page reads it, the Worker reads it to know what a phone or the iPad is told, and the tests read it. Pure: no DOM,
   no clock, no network.

   Window.B68Features, and module.exports under Node (functions/_lib/features.js imports it for the Worker).

   A line: { id, label, surface, stage, default: false, doc, saturday, setting?, legacy? }
     id         letters, digits, dots and dashes ("spine.rail", "phoneCards"); the id is the key everywhere
     label      a name for it                     doc   one line on what it does
     surface    'gm'       GM-only: never copied anywhere a player can read
                'display'  the iPad: what it is told rides in the display poll's `features`
                'phone'    a player's phone: what it is told rides in the campaign document's `features`
     stage      the build stage it came from (STAGES); a label only
     default    false: what a SETTING reads while nothing is stored
     saturday   the suite plan's wish for the first night ('on', 'try' or 'off'): history only, nothing reads it
     setting    (optional) true for the three settings; any other line is always on
     legacy     (optional) a top-level key of the GM state document that held this setting before the registry (phoneCards); read as a fallback and kept in step on a write

   Where the values live (settings only; every other line is ON and its stored value, if any, is never read)
     GM state document    features: { <id>: true | false }      the source of truth for a setting (and phoneCards' old key beside it)
     campaign document    features: { <id>: true | false }      the display and phone settings, copied by the GM page (publishMap); the server cleans it again
   A setting is ON only when it is exactly true; absent, false or anything else is off.

   How a surface reads
     the GM page    valueOf(S.doc, id), live, on every use
     a phone        B68Flags.apply(campaignDoc) on every campaign arrival (app/sheet/flags.js, hooked in boot.js), then B68Flags.on(id)
     the iPad       B68Flags.apply(answer) on every display poll (the answer's `features`), then B68Flags.on(id)
     The Worker serves both through publicView: every display and phone line ON, a setting as stored. So a phone and the iPad see every feature ON
     from their first request, whether or not the GM page has been opened since the deploy.

   API
     STAGES SURFACES SATURDAY
     register(def) -> def        add a line (tests use register/unregister)                          unregister(id) -> bool      reset()
     get(id) list() byStage() -> [{ stage: {id,label}, switches }]      idsFor(surface) -> [id]      publicIds() -> display and phone ids
     settings() -> [line]        isSetting(id) -> bool
     valueOf(stateDoc, id) -> bool        true for every line but a setting; a setting reads the stored value     values(stateDoc) -> { id: bool }
     publicMap(stateDoc) -> { id: bool }  the display and phone lines, complete, as the GM page sees them
     publishMap(stateDoc, current) -> { id: bool }   what the GM page copies into the campaign document: the display and phone SETTINGS only
     publicView(raw) -> { id: bool }      what a phone or the iPad is told, from the campaign document's stored map: every display and phone line ON, a setting as stored (cleanPublic)
     patchFor(stateDoc, id, on) -> a GM state patch, for a setting (any other id throws: it cannot be turned off)      patchAllOff() -> every setting off
     cleanPublic(raw) -> { id: bool }     only display and phone ids that are registered, only booleans: a GM-only or unknown id is dropped (what may be STORED)
     sameOn(a, b) -> bool                 the two maps turn on the same ids (absent is off)
     sameSettings(a, b) -> bool           the two maps agree on every display and phone setting (absent is off) */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68Features = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SURFACES = ['gm', 'display', 'phone'];
  var SATURDAY = ['on', 'try', 'off'];
  /* the build stages, in order (`existing` is what the app already had behind a toggle): a label for each line, nothing else */
  var STAGES = [
    { id: 'existing', label: 'Already in the app' },
    { id: 'spine', label: 'Stage 1: the spine' },
    { id: 'map', label: 'Stage 2: the maps' },
    { id: 'face', label: 'Stage 3: the figures' },
    { id: 'room', label: 'Stage 4: the room' },
    { id: 'ai', label: 'Blade (AI)' },
    { id: 'between', label: 'Stage 5: between sessions' },
    { id: 'fx', label: 'Effects' },
    { id: 'kit', label: 'The kit and stage' }
  ];
  var ID_RE = /^[A-Za-z][A-Za-z0-9.-]{0,39}$/;

  /* THE LINES. Every one is ON except those marked setting: true. (spine.workshop, the Workshop drawer, is gone with the Workshop: its stored value
     is left where it is, and nothing reads it.) */
  var SWITCHES = [
    { id: 'phoneCards', label: 'Phone mission cards', surface: 'phone', stage: 'existing', default: false, saturday: 'off', setting: true, legacy: 'phoneCards',
      doc: 'Phones show a mission card and a Move row while a night runs. Off: phones are character sheets only and the published mission carries no cards (the iPad is unchanged).' },
    { id: 'spine.rail', label: 'Phase rail', surface: 'gm', stage: 'spine', default: false, saturday: 'on',
      doc: 'Four phases across the page header, tap to move between them, time against budget; drives the tool filter ("All tools" overrides) and lights the iPad band. Off: the header and tabs as before.' },
    { id: 'spine.curfew', label: 'Curfew', surface: 'gm', stage: 'spine', default: false, saturday: 'on',
      doc: 'A warning thirty minutes before the curfew, then a full-width "Call the Aftermath" that moves to the Aftermath; can be snoozed once for ten minutes. Off: no curfew bar.' },
    { id: 'spine.stamp', label: 'The stamp before the roll', surface: 'gm', stage: 'spine', default: false, saturday: 'on',
      doc: 'A Stamp row under Position: set position and effect, add a one-line threatened consequence, and an action report card goes up on the iPad until the result is marked or Esc. Also by cue ("Blade, risky, standard").' },
    { id: 'spine.sizer', label: 'The consequence sizer', surface: 'gm', stage: 'spine', default: false, saturday: 'on',
      doc: 'When a 4/5 or a 1-3 is marked on a stamped roll, the GM screen offers the consequence at full size for the stamped position, seeded from the room. Reducing it takes a second tap.' },
    { id: 'ai.grammar', label: 'A strict cue grammar, a toast and Undo', surface: 'gm', stage: 'ai', default: false, saturday: 'on',
      doc: 'Adds the stamp, reveal, go, flashback, back, introduce, spotlight cues; every fired cue shows a 5 second toast with Undo; a cue it cannot parse says "didn\u2019t catch that" and does nothing.' },
    { id: 'spine.start', label: 'Hard start', surface: 'display', stage: 'spine', default: false, saturday: 'on',
      doc: 'A timed cold open on the table display: a station clock counts down, then a fuse, the credits and three faces whose name plates the GM reveals one by one. Adds a Hard start line to the Menu. Off: none of it.' },
    { id: 'ai.onair', label: 'ON AIR lamp and off the record', surface: 'display', stage: 'ai', default: false, saturday: 'on',
      doc: 'An ON AIR lamp while the table display listens, and a spoken pause: "Blade, off the record" stops keeping what is heard for 5 minutes, "Blade, back on" resumes. The GM page mirrors the lamp and the countdown. Off: neither.' },
    { id: 'ai.batch', label: 'Record the night, transcribe after', surface: 'gm', stage: 'ai', default: false, saturday: 'off',
      doc: 'Menu then Record the night: records the table on this laptop only, never uploaded live, shown on the ON AIR lamp as REC. After the night a script turns the file into a transcript with speaker labels. Off: no recording line.' },
    { id: 'fx.pause', label: 'Pause hidden scenes', surface: 'display', stage: 'fx', default: false, saturday: 'on',
      doc: 'An ambient scene that is not on show (page hidden, covered or faded out) stops moving until it is. Off: scenes run as they always did.' },
    { id: 'fx.off', label: 'Hold scenes still', surface: 'display', stage: 'fx', default: false, saturday: 'try', setting: true,
      doc: 'Holds every ambient scene as a still picture, to save the battery and heat. On: no animation in the scenes. Off: scenes animate as they always did.' },
    { id: 'spine.keyturn', label: 'Turn the key', surface: 'phone', stage: 'spine', default: false, saturday: 'on',
      doc: 'A key with three hits offers "You can turn this key" on its sheet; turning it deadlocks the key, clears Stress, makes the next action roll an automatic critical, and lays a card over the iPad. Off: keys behave as before.' },
    { id: 'between.keys', label: 'The key cabinet', surface: 'phone', stage: 'between', default: false, saturday: 'try',
      doc: 'The sheet draws each key as a card that fills as it is hit; turned over, a card shows both deadlocks. Off: the keys box as before.' },
    { id: 'spine.aftermath', label: 'Aftermath show', surface: 'phone', stage: 'spine', default: false, saturday: 'on',
      doc: 'The Aftermath runs as a stepped show on the iPad (payout, tithe, heat, status, harm, unwind, xp, credits), steered from the GM page, and phones show the xp triggers for 90 seconds. Off: no Aftermath entry in the Menu, and phones make no extra calls.' },
    { id: 'ai.keyterms', label: 'Key terms for the transcriber', surface: 'gm', stage: 'ai', default: false, saturday: 'try',
      doc: 'When the table iPad opens its listening stream, it passes the names of the crew, the revealed cast, the factions and the districts, so they are heard more reliably. Off: the stream opens as before.' },
    { id: 'room.preflight', label: 'Preflight check', surface: 'display', stage: 'room', default: false, saturday: 'on',
      doc: 'Menu then Preflight: green or red for the iPad sound, files kept on each device, the transcriber, the Access session and the pack version, each red with a one-line fix. Read-only. Off: no menu item and the iPad reports nothing extra.' },
    { id: 'room.light', label: 'One light cue', surface: 'gm', stage: 'room', default: false, saturday: 'off',
      doc: 'A small relay on this laptop moves one light strip with the scene and flashes the rim lights once for 3 seconds on request, never faster than twice a second. The work light never changes. Off: nothing is sent.' },
    { id: 'face.rolodex', label: 'Rolodex lower third', surface: 'display', stage: 'face', default: false, saturday: 'on',
      doc: 'An Introduce button on a revealed character’s card in the cast list, and "Blade, introduce <name>", flip their card up as a lower third on the iPad for about 20 seconds: face, name, alias, role and faction. Off: the row of full-screen cards, as before.' },
    { id: 'face.pcstatus', label: 'PC status on the band', surface: 'gm', stage: 'face', default: false, saturday: 'try',
      doc: 'The faces on the iPad band are the player characters, each with Stress, a mark for each harm and a stamp for each deadlocked key, updated when a sheet changes. Off: the band shows no player characters.' },
    { id: 'spine.debrief', label: 'The Debrief', surface: 'phone', stage: 'spine', default: false, saturday: 'on',
      doc: 'Aftermath steps not reached become a Debrief card on each sheet the next morning, with downtime picks and xp prompts, kept as the player’s own row; unanswered ones take defaults after 48 hours; replies show on a GM panel. Off: no card, no panel.' },
    { id: 'between.quiet', label: 'The quiet line', surface: 'phone', stage: 'between', default: false, saturday: 'try',
      doc: 'A long press on the sheet header offers the X-card, pause, spotlight me and a secret note, sent only to the GM phone as a silent badge. Off: the header does nothing.' },
    { id: 'between.board', label: 'The opportunity board', surface: 'phone', stage: 'between', default: false, saturday: 'try',
      doc: 'Players post a client, a target or an operation from their sheet, kept as their own row; Menu then Opportunity board lists them, and the ones the GM posts go up on the iPad as a pinned board for the Planning phase. Unpicked cards carry over. Off: no strip on the sheet, no menu line.' },
    { id: 'between.claims', label: 'Claims and status', surface: 'phone', stage: 'between', default: false, saturday: 'try',
      doc: 'On the crew sheet the claims become a track that lights each claim held, with the turf and target cells marked as its thresholds; the factions sit as business cards on a -3 to +3 ladder, and a card at -3 carries a WAR stamp. Off: the claims map and the faction list as before.' },
    { id: 'print.cards', label: 'Calling cards and standees', surface: 'gm', stage: 'between', default: false, saturday: 'off',
      doc: 'Menu then Print: a calling card for every revealed NPC, ten to an A4 sheet, and an A4 tent standee for each NPC tagged major (silhouette or typed back). Print only. Off: no Print line for cards.' },
    { id: 'print.blueprint', label: 'Printed blueprint', surface: 'gm', stage: 'between', default: false, saturday: 'off',
      doc: 'Menu then Print: an A3 or A4 case-file plan of the rooms the players know, with a scale bar, a title block and a margin for a pencil. Print only. Off: no Print line for the blueprint.' },
    { id: 'room.practical', label: 'Practical speaker', surface: 'gm', stage: 'room', default: false, saturday: 'try',
      doc: 'Menu then Practical speaker: choose a second audio output on this laptop (Chrome or Edge) for in-world sounds such as a radio, a PA or a phone, with a Test button. Off: no line, and sounds play as before.' },
    { id: 'room.phone', label: 'The ringing phone', surface: 'gm', stage: 'room', default: false, saturday: 'try',
      doc: 'A ring on the iPad also rings the practical speaker; on your tap it plays a recording kept on this laptop and puts its caption on the iPad. Menu then Ringing phone. Off: a ring is the picture alone.' },
    { id: 'between.trouble', label: 'The Trouble desk', surface: 'gm', stage: 'between', default: false, saturday: 'off',
      doc: 'Menu then Trouble desk: walks the Aftermath trouble checks from the pack tables, keeps your written or pasted results as drafts, and approved ones make a front page and rumours you can put on the iPad one tap at a time. Off: no line.' },
    { id: 'ai.canon', label: 'The canon queue', surface: 'gm', stage: 'ai', default: false, saturday: 'try',
      doc: 'Menu then Canon queue: paste the queue note to see how many proposals are ticked and which are GM-only. Reads only; the ticked lines are filed by the laptop script gm:canon-apply, which uses no model. Off: no line.' },
    { id: 'between.frontpage', label: 'The front page', surface: 'gm', stage: 'between', default: false, saturday: 'off',
      doc: 'Menu then Front page: paste the front page note, see it drawn as a newspaper front page, print it, and put its headline on the iPad. Only the headline, standfirst, account, name and hook are used. Off: no line.' },
    { id: 'between.absent', label: 'The absent-player packet', surface: 'phone', stage: 'between', default: false, saturday: 'off',
      doc: 'Menu then Absent packet: for a player who missed the night, one page on their own phone with the front page, a three-line recap with the faces met, and the changes to their sheet. Nothing is pushed; they open it. Off: no line, no strip.' },
    { id: 'map.spotted', label: 'The Spotted beat', surface: 'gm', stage: 'map', default: false, saturday: 'try',
      doc: 'A Spotted button on the Run map: zoom to the room, a sting on the iPad, a yellow fill spreading from the eyes, the site’s alarm clock ticks once, then back. Off: no button.' },
    { id: 'map.flashback', label: 'The flashback filter', surface: 'display', stage: 'map', default: false, saturday: 'on',
      doc: 'The flashback look gains grain and an “Earlier…” caption on the iPad, until “Blade, back” or a tap; “Blade, flashback” can name the Stress cost; a Flashback button and a room Pin sit on the Run map. Off: the plain sepia as before.' },
    { id: 'map.threat', label: 'Threat on the map', surface: 'gm', stage: 'map', default: false, saturday: 'try',
      doc: 'When a stamp goes up, its threatened consequence drops a glyph (a guard turning, a door locking, an alarm, harm) on the crew’s room on the Run map, before the dice. It clears with the stamp. Off: nothing is drawn.' },
    { id: 'map.stage', label: 'Stage rooms, then send', surface: 'gm', stage: 'map', default: false, saturday: 'on',
      doc: 'Tap rooms to stage them: they show amber on this screen only. Send (or “Blade, reveal”) opens them for the players together; a LIVE badge says what the iPad shows; Freeze holds the iPad; Blank (also Esc) turns it black. Off: rooms open one at a time as before.' },
    { id: 'map.security', label: 'Security level', surface: 'gm', stage: 'map', default: false, saturday: 'try',
      doc: 'The alarm becomes a clock of four to six named levels (a prep security: line, or generic names). The iPad tints only when a full level is reached and shows its name for three seconds; this screen shows the next level. Off: the alarm as before.' },
    { id: 'face.spotlight', label: 'Stage bar and spotlight', surface: 'gm', stage: 'face', default: false, saturday: 'on',
      doc: 'A stage bar holds up to three people for the room, from its Who line. One tap holds a portrait on the iPad until Narrator clears it; a hidden person asks to be revealed first. Also by voice: spotlight and a name. Off: no bar.' },
    { id: 'room.cues', label: 'The cue stack', surface: 'gm', stage: 'room', default: false, saturday: 'try',
      doc: 'Numbered cues from the Cues section of the prep note: the next one waits as STANDBY, Space or a page-turner key fires it, Bypass skips it, Esc sends the iPad to the safe scene and raises the work light. "Blade, go" fires only the cue in standby. Off: no cue bar and no keys.' },
    { id: 'map.montage', label: 'Montage mode', surface: 'gm', stage: 'map', default: false, saturday: 'try',
      doc: 'Menu then Montage: one tap splits the iPad into two to four panels, one per player character, each with a figure, a place the players know and one line. A marked roll resolves its panel; one tap collapses it to a single scene. Off: no Montage line.' },
    { id: 'room.duck', label: 'A speech-safe mix', surface: 'display', stage: 'room', default: false, saturday: 'try',
      doc: 'When the iPad hears “Blade”, the music ducks by 12 dB for 6 seconds. Setup: point the speaker away from the puck. Only where the iPad lets the page change the volume; otherwise it says so and does nothing. Off: the music is never touched.' },
    { id: 'room.music', label: 'Heat-state music', surface: 'display', stage: 'room', default: false, saturday: 'off', setting: true,
      doc: 'The engine only: ambient, tension, alert, evasion and resolved follow the security level and heat, a change lands on the bar from the track tempo, a flashback muffles it. Ships with one layer per state from today’s track. Off: the scene themes play as before.' },
    { id: 'map.kit1', label: 'The grand map (map kit 1.0)', surface: 'gm', stage: 'map', default: false, saturday: 'try',
      doc: 'A site whose block says kit: 1 draws with map kit 1.0: floors of their own, double-height rooms, its faces, a grand stair, the palazzo section. Off: every map as before.' },
    { id: 'map.corkboard', label: 'The intel corkboard', surface: 'gm', stage: 'map', default: false, saturday: 'try',
      doc: 'Menu then Corkboard: the site on cork in the heist-board look, one Polaroid for each intel fact the crew has been told pinned to its room, and a mugshot for each revealed person on their post. Only revealed rooms and people appear. It prints on A4 or A3. Off: no Corkboard line.' },
    { id: 'face.castphoto', label: 'A cast photo per arc', surface: 'display', stage: 'face', default: false, saturday: 'off',
      doc: 'Menu then Cast photo: one true-height line-up of the recurring cast for an arc, anyone not yet met a silhouette, put on the iPad for up to three minutes and printed on A4 at the arc’s end. Off: no menu line.' },
    { id: 'between.lair', label: 'The lair that grows', surface: 'display', stage: 'between', default: false, saturday: 'off',
      doc: 'Menu then The lair: the crew’s base as a cut-away section on the iPad, a layer for each base upgrade, cohort and piece of flair read from the crew sheet, with extra flair you type. Off: no menu line.' },
    { id: 'face.expressions', label: 'Expressions and a signature pose', surface: 'display', stage: 'face', default: false, saturday: 'try',
      doc: 'The stage bar gains Neutral, Pleased, Hostile, Afraid and Their tell buttons for the person held on the iPad (the face swaps its eyes, brows and mouth), and a Signature button that plays their pose once. The tell and the pose come from lines in the person’s GM notes: Tell: smirk, Signature: lapel. Off: the portrait as drawn.' },
    { id: 'face.formats', label: 'Portrait formats', surface: 'display', stage: 'face', default: false, saturday: 'off',
      doc: 'A held person’s portrait can be a driver’s licence, a security badge, a mugshot with a placard, a society-page halftone or a passport, in a duotone of their faction’s colour, chosen by a Relation: line in their GM notes (resident, staff, suspect, society, foreign). Off: the plain portrait.' },
    { id: 'face.badge', label: 'A badge, a style and a motif', surface: 'display', stage: 'face', default: false, saturday: 'try',
      doc: 'A held person’s card gains a stable number and a faction glyph, the faction’s type and texture, and a three to six second motif made in the browser that plays when they appear, 12 dB down while the speech-safe mix is on. Needs a tap on the iPad first; the ring/silent switch mutes it. Off: the card as before.' },
    { id: 'map.knowledge', label: 'Dark, blueprint, seen', surface: 'gm', stage: 'map', default: false, saturday: 'try',
      doc: 'On a run, a panel under the Map heading shows every room as dark, blueprint (known from intel) or seen: tap a room, or its row, to cycle it; Intel sets a band or a floor of dark rooms to blueprint. The iPad draws a blueprint room as linework, with its name, and a dark room not at all. Off: rooms open and close as before.' },
    { id: 'map.title', label: 'The score title card', surface: 'gm', stage: 'map', default: false, saturday: 'off',
      doc: 'On GO into the Score phase the iPad puts up a six-second title card made from the site: its floor plan flies in, becomes the building, and the score’s name lands on the grid. It shows the outside only: no room and no name of one. Off: nothing is put up.' },
    { id: 'map.countdown', label: 'A countdown clock in the Run view', surface: 'gm', stage: 'map', default: false, saturday: 'on',
      doc: 'When the site’s play has a countdown (clock.countdown: a time and a name), the Run view’s header shows it as a pie beside the alarm, one segment filled for each beat since the clock’s start: each beat forward is a tick, and it is full at the countdown’s time. GM only. Off: no pie.' },
    { id: 'spine.find', label: 'Find lands on the heading', surface: 'gm', stage: 'spine', default: false, saturday: 'on',
      doc: 'Find (Ctrl+K) lists each room, scene and way of the prep note under its own heading, and Enter in the Prep tab’s find box goes to the next heading that matches, a room or a scene rather than the whole section. Off: both find whole sections, as before.' },
    /* the tech run (06/11): the strip across the top of the iPad got in the way, so it is a choice and starts off (absent reads off, so a campaign
       document that never stored it, and an older page that never writes it, both leave the band down) */
    { id: 'display.band', label: 'The band across the top of the iPad', surface: 'display', stage: 'spine', default: false, saturday: 'off', setting: true,
      doc: 'The strip across the top of the iPad: the ON AIR lamp, the phase, the crew’s first names with Stress and harm, and security. Off: no strip; the map and every scene take the whole screen and the lamp sits in its own corner.' },
    /* the kit and stage build (11/11): five settings, each off until chosen. Off is the app as it was: the same screens, requests and stored data */
    { id: 'kit.desk', label: 'The new desk', surface: 'gm', stage: 'kit', default: false, saturday: 'off', setting: true,
      doc: 'The GM page rebuilt with the UI kit: the band, the Roll, the Blade panel, the Run view and the shell, every other pane skinned to match. Off: the desk as it was.' },
    { id: 'kit.stage', label: 'The new stage', surface: 'display', stage: 'kit', default: false, saturday: 'off', setting: true,
      doc: 'The iPad as a stage: no chrome over the art, one plate for words, the crew across the top, the roll in beats, clocks with names, the NPC over the scene, the map full-bleed. Off: the iPad as it was.' },
    { id: 'kit.phone', label: 'The four-screen sheet', surface: 'phone', stage: 'kit', default: false, saturday: 'off', setting: true,
      doc: 'On a phone the sheet splits into four screens, Now, Sheet, Crew and Notes, with a bar at the foot. Wide screens and print are unchanged. Off: the one long sheet as it was.' },
    { id: 'night.who', label: 'Start the night', surface: 'gm', stage: 'kit', default: false, saturday: 'off', setting: true,
      doc: 'Before the night, Start the night asks who is playing; the Roll, the iPad and every send-to list follow the players who are there. Off: no button, and every filed character counts, as before.' },
    { id: 'blade.pitches', label: 'Blade pitches', surface: 'gm', stage: 'kit', default: false, saturday: 'off', setting: true,
      doc: 'Blade pitches up to three ideas at a time (a direction, a complication, a clue, an NPC move, a cutaway) in place of the Stall and Meanwhile cards. Off: Stall and Meanwhile as before.' },
    /* the map kit's new options (MK1, 13/11): four settings, each off until chosen. Off: the same options reach the map kit, so the same map comes back.
       The layout one is map.fill: map.stage is taken (Stage rooms, then send) */
    { id: 'map.fill', label: 'The map fills the shared screen', surface: 'gm', stage: 'map', default: false, saturday: 'try', setting: true,
      doc: 'The players’ map on the iPad or a TV is drawn to fill that screen, with the key as a strip (map kit stage layout); a Shared screen choice beside the map says iPad (4:3) or TV (16:9). Off: the iPad map as before.' },
    { id: 'map.people', label: 'People on the map', surface: 'gm', stage: 'map', default: false, saturday: 'try', setting: true,
      doc: 'The Run view hands the map kit its people: the crew and the cast where the night places them on this screen, the crew alone (in rooms the players know) on the shared screen, and a crowd that suits the place. Off: no people drawn.' },
    { id: 'map.lights', label: 'Rooms lit by the night’s events', surface: 'gm', stage: 'map', default: false, saturday: 'try', setting: true,
      doc: 'A False dawn event of the play block lights its room on the map while it runs. Off: every room as before.' },
    { id: 'map.room', label: 'Cut to the room', surface: 'gm', stage: 'map', default: false, saturday: 'try', setting: true,
      doc: 'Each room the players know gets Cut to room in the Run view: that room alone as a stage set on the shared screen, through the same checks as the map; Back to the map puts the map up again. Off: no control.' },
    /* the players' screen build (IP2, 13/11): one display setting, off until chosen. Off: the iPad, the GM page and the phones as they were */
    { id: 'stage.players', label: 'Players’ screen: map first', surface: 'display', stage: 'kit', default: false, saturday: 'off', setting: true,
      doc: 'The shared screen shows the map and what the GM sends, nothing else: no scene band or plate, no time, no Now or Next, no crew status; the clocks the GM made visible sit as dials in a corner; a new scene replaces what is showing. Off: the iPad as it was.' },
    /* the players' screen build (IP4, 13/11): one phone setting, off until chosen. Off: no Send to on the GM page, no Handouts on a phone, no request, nothing stored */
    { id: 'phone.handouts', label: 'Handouts on phones', surface: 'phone', stage: 'kit', default: false, saturday: 'off', setting: true,
      doc: 'Each handout in the GM page’s list can be sent to one player or to everyone; it stays in a Handouts list on that player’s sheet, to open full screen any time, until the GM takes it back. Off: no Send to, no Handouts button.' },
    /* the players' screen build (IP7, 14/11): the map kit's shade option, a GM setting, off until chosen. Off: the option is not passed, so the same map comes back */
    { id: 'map.shade', label: 'Furniture depth', surface: 'gm', stage: 'map', default: false, saturday: 'try', setting: true,
      doc: 'Every map the GM page draws (this screen, the shared screen, a room cut to, the planning board and the exploded site) asks the map kit for furniture as low solids with a short cast shadow (shade: true). A map over the iPad’s cap goes flat first. Off: flat furniture, as before.' }
  ];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  var list = [];
  function build(d) {
    if (!isObj(d)) throw new Error('a switch is an object');
    var id = str(d.id);
    if (!ID_RE.test(id)) throw new Error('switch id: letters, digits, dots and dashes: ' + id);
    if (SURFACES.indexOf(d.surface) < 0) throw new Error('switch ' + id + ': surface is gm, display or phone');
    if (d.default !== false) throw new Error('switch ' + id + ': the default is off (default: false)');
    if (!STAGES.some(function (s) { return s.id === d.stage; })) throw new Error('switch ' + id + ': unknown stage ' + str(d.stage));
    if (SATURDAY.indexOf(d.saturday) < 0) throw new Error('switch ' + id + ': saturday is on, try or off');
    var label = str(d.label).trim(), doc = str(d.doc).trim();
    if (!label || !doc) throw new Error('switch ' + id + ': a label and a line on what it does');
    var out = { id: id, label: label, surface: d.surface, stage: d.stage, default: false, doc: doc, saturday: d.saturday };
    if (d.setting !== undefined) { if (typeof d.setting !== 'boolean') throw new Error('switch ' + id + ': setting is true or false'); if (d.setting) out.setting = true; }
    if (d.legacy !== undefined) { if (!ID_RE.test(str(d.legacy))) throw new Error('switch ' + id + ': legacy key'); if (!out.setting) throw new Error('switch ' + id + ': only a setting keeps a legacy key'); out.legacy = str(d.legacy); }
    return out;
  }
  function seed() { list = SWITCHES.map(build); ids(); }
  function ids() { var seen = {}; list.forEach(function (s) { if (seen[s.id]) throw new Error('switch ' + s.id + ' is listed twice'); seen[s.id] = 1; }); }
  seed();

  function get(id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function register(def) {
    var s = build(def);
    if (get(s.id)) throw new Error('switch ' + s.id + ' is already registered');
    list.push(s);
    return s;
  }
  function unregister(id) { var s = get(id); if (!s) return false; list.splice(list.indexOf(s), 1); return true; }
  function reset() { seed(); }
  function all() { return list.slice(); }
  function byStage() {
    return STAGES.map(function (st) { return { stage: st, switches: list.filter(function (s) { return s.stage === st.id; }) }; }).filter(function (g) { return g.switches.length; });
  }
  function idsFor(surface) { return list.filter(function (s) { return s.surface === surface; }).map(function (s) { return s.id; }); }
  function publicIds() { return list.filter(function (s) { return s.surface !== 'gm'; }).map(function (s) { return s.id; }); }
  function settings() { return list.filter(function (s) { return s.setting === true; }); }
  function isSetting(id) { var s = get(id); return !!(s && s.setting === true); }

  /* everything built is on: a line that is not a setting reads true whatever is stored (or nothing at all); a setting reads its stored value, the
     legacy key as its fallback, exactly as the Switchboard read it. An id nobody registered is off. */
  function valueOf(doc, id) {
    var s = get(id); if (!s) return false;
    if (s.setting !== true) return true;
    if (!isObj(doc)) return false;
    if (isObj(doc.features) && typeof doc.features[id] === 'boolean') return doc.features[id];
    return !!s.legacy && doc[s.legacy] === true;
  }
  function values(doc) { var o = {}; list.forEach(function (s) { o[s.id] = valueOf(doc, s.id); }); return o; }
  function publicMap(doc) { var o = {}; list.forEach(function (s) { if (s.surface !== 'gm') o[s.id] = valueOf(doc, s.id); }); return o; }

  /* publishMap(stateDoc, current) -> what the GM page writes into the campaign document: the display and phone SETTINGS only (no other line is ever written,
     so the values stored before stay as they were): the one with a legacy key always, as before; any other only while it is ON, and a plain false only for
     one the document already holds (so turning it off lands). `current` is the campaign document's features. */
  function publishMap(doc, current) {
    var o = {}, cur = isObj(current) ? current : {};
    list.forEach(function (s) {
      if (s.surface === 'gm' || s.setting !== true) return;
      var v = valueOf(doc, s.id);
      if (s.legacy || v) o[s.id] = v; else if (has(cur, s.id)) o[s.id] = false;
    });
    return o;
  }
  /* publicView(raw) -> what a phone or the iPad is told, made from the campaign document's stored map on every read (functions/_lib/features.js): every display
     and phone line ON, a setting as stored (cleaned; absent stays absent, which reads off). Never a GM-only id. */
  function publicView(raw) {
    var stored = cleanPublic(raw), out = {};
    list.forEach(function (s) {
      if (s.surface === 'gm') return;
      if (s.setting !== true) out[s.id] = true;
      else if (has(stored, s.id)) out[s.id] = stored[s.id];
    });
    return out;
  }

  /* only a setting can change: the GM state patch for it (features and its legacy key) */
  function patchFor(doc, id, on) {
    var s = get(id); if (!s) throw new Error('unknown switch: ' + str(id));
    if (s.setting !== true) throw new Error(id + ' is always on: only a setting can change');
    var f = {}, p = { features: f };
    f[id] = on === true;
    if (s.legacy) p[s.legacy] = on === true;
    return p;
  }
  /* every setting back to off (nothing else can be turned off) */
  function patchAllOff() {
    var f = {}, p = { features: f };
    settings().forEach(function (s) { f[s.id] = false; if (s.legacy) p[s.legacy] = false; });
    return p;
  }

  function cleanPublic(raw) {
    var out = {};
    if (!isObj(raw)) return out;
    list.forEach(function (s) { if (s.surface !== 'gm' && has(raw, s.id) && typeof raw[s.id] === 'boolean') out[s.id] = raw[s.id]; });
    return out;
  }
  function sameOn(a, b) {
    a = isObj(a) ? a : {}; b = isObj(b) ? b : {};
    var k = {}; Object.keys(a).forEach(function (x) { k[x] = 1; }); Object.keys(b).forEach(function (x) { k[x] = 1; });
    return Object.keys(k).every(function (x) { return (a[x] === true) === (b[x] === true); });
  }
  function sameSettings(a, b) {
    a = isObj(a) ? a : {}; b = isObj(b) ? b : {};
    return settings().every(function (s) { return s.surface === 'gm' || (a[s.id] === true) === (b[s.id] === true); });
  }

  return { STAGES: STAGES, SURFACES: SURFACES, SATURDAY: SATURDAY, register: register, unregister: unregister, reset: reset, get: get, list: all, byStage: byStage,
    idsFor: idsFor, publicIds: publicIds, settings: settings, isSetting: isSetting, valueOf: valueOf, values: values, publicMap: publicMap, publishMap: publishMap,
    publicView: publicView, patchFor: patchFor, patchAllOff: patchAllOff, cleanPublic: cleanPublic, sameOn: sameOn, sameSettings: sameSettings };
});
