/* features.js — the switchboard's registry (suite ticket W0.2, no switch of its own).

   Every new feature of the suite ships behind a switch, default OFF. This file is the one list of them: the GM page's Menu -> Switchboard draws it, the
   Worker reads it to know which ids a phone or the iPad may be told, and the tests read it. Pure: no DOM, no clock, no network.

   Window.B68Features, and module.exports under Node (functions/_lib/features.js imports it for the Worker).

   A switch: { id, label, surface, stage, default: false, doc, saturday, legacy? }
     id         letters, digits, dots and dashes ("spine.rail", "phoneCards"); the id is the key everywhere
     label      the Switchboard's line            doc   one line on what it does
     surface    'gm'       GM-only: lives in the GM state document (`features`), never copied anywhere a player can read
                'display'  the iPad: copied into the campaign document's `features`
                'phone'    a player's phone: copied into the campaign document's `features`
     stage      the Switchboard's group (STAGES)
     default    always false: nothing is on until the GM turns it on, and All off puts everything back
     saturday   what it should be on Saturday: 'on', 'try' (the GM's call on Friday) or 'off'
     legacy     (optional) a top-level key of the GM state document that held this switch before the registry (phoneCards); read as a fallback and kept in step on a write

   Where the values live
     GM state document    features: { <id>: true | false }      every switch, whatever its surface (the source of truth)
     campaign document    features: { <id>: true | false }      the display and phone switches only, a complete map; written by the GM page (the server cleans it again)
   A value is ON only when it is exactly true; absent, false or anything else is off.

   How a surface reads
     the GM page    valueOf(S.doc, id), live, on every use (it is the only writer of its state document)
     a phone        B68Flags.apply(campaignDoc) on every campaign arrival (app/sheet/flags.js, hooked in boot.js), then B68Flags.on(id)
     the iPad       B68Flags.apply(answer) on every display poll (the answer's `features`), then B68Flags.on(id)

   API
     STAGES SURFACES SATURDAY
     register(def) -> def        add a switch (a later ticket adds its line to SWITCHES below; tests use register/unregister)
     unregister(id) -> bool      reset()
     get(id) list() byStage() -> [{ stage: {id,label}, switches }]      idsFor(surface) -> [id]      publicIds() -> display and phone ids
     valueOf(stateDoc, id) -> bool                                       values(stateDoc) -> { id: bool }
     publicMap(stateDoc) -> { id: bool }   the display and phone switches, complete (what the campaign document should hold)
     patchFor(stateDoc, id, on) -> a GM state patch                      patchAllOff(stateDoc) -> a GM state patch
     cleanPublic(raw) -> { id: bool }      only display and phone ids that are registered, only booleans: a GM-only or unknown id is dropped
     sameOn(a, b) -> bool                  the two maps turn on the same switches (absent is off) */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68Features = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SURFACES = ['gm', 'display', 'phone'];
  var SATURDAY = ['on', 'try', 'off'];
  /* the groups the Switchboard draws, in order (the plan's stages; `existing` is what the app already had behind a toggle) */
  var STAGES = [
    { id: 'existing', label: 'Already in the app' },
    { id: 'spine', label: 'Stage 1: the spine' },
    { id: 'map', label: 'Stage 2: the maps' },
    { id: 'face', label: 'Stage 3: the figures' },
    { id: 'room', label: 'Stage 4: the room' },
    { id: 'ai', label: 'Blade (AI)' },
    { id: 'between', label: 'Stage 5: between sessions' },
    { id: 'fx', label: 'Effects' }
  ];
  var ID_RE = /^[A-Za-z][A-Za-z0-9.-]{0,39}$/;

  /* THE SWITCHES. A ticket adds its own line here, default false. Keep the order: it is the order of the Switchboard. */
  var SWITCHES = [
    { id: 'phoneCards', label: 'Phone mission cards', surface: 'phone', stage: 'existing', default: false, saturday: 'off', legacy: 'phoneCards',
      doc: 'Phones show a mission card and a Move row while a night runs. Off: phones are character sheets only and the published mission carries no cards (the iPad is unchanged).' },
    { id: 'spine.rail', label: 'Phase rail', surface: 'gm', stage: 'spine', default: false, saturday: 'on',
      doc: 'Four phases across the page header, tap to move between them, time against budget; drives the tool filter ("All tools" overrides) and lights the iPad band. Off: the header and tabs as before.' },
    { id: 'spine.curfew', label: 'Curfew', surface: 'gm', stage: 'spine', default: false, saturday: 'on',
      doc: 'A warning thirty minutes before the curfew, then a full-width "Call the Aftermath" that moves to the Aftermath; can be snoozed once for ten minutes. Off: no curfew bar.' },
    { id: 'spine.workshop', label: 'Workshop drawer, first cuts', surface: 'gm', stage: 'spine', default: false, saturday: 'on',
      doc: 'Phone cards, the costume select, the screen mirror, the uncued co-GM and the Screen props move behind Menu then Workshop. Off: they stay where they were.' },
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
    { id: 'fx.off', label: 'Hold scenes still', surface: 'display', stage: 'fx', default: false, saturday: 'try',
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
    { id: 'room.music', label: 'Heat-state music', surface: 'display', stage: 'room', default: false, saturday: 'off',
      doc: 'The engine only: ambient, tension, alert, evasion and resolved follow the security level and heat, a change lands on the bar from the track tempo, a flashback muffles it. Ships with one layer per state from today’s track. Off: the scene themes play as before.' },
    { id: 'map.kit1', label: 'The grand map (map kit 1.0)', surface: 'gm', stage: 'map', default: false, saturday: 'try',
      doc: 'A site whose block says kit: 1 draws with map kit 1.0: floors of their own, double-height rooms, its faces, a grand stair, the palazzo section. Off: every map as before.' }
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
    if (d.legacy !== undefined) { if (!ID_RE.test(str(d.legacy))) throw new Error('switch ' + id + ': legacy key'); out.legacy = str(d.legacy); }
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

  function valueOf(doc, id) {
    var s = get(id); if (!s || !isObj(doc)) return false;
    if (isObj(doc.features) && typeof doc.features[id] === 'boolean') return doc.features[id];
    return !!s.legacy && doc[s.legacy] === true;
  }
  function values(doc) { var o = {}; list.forEach(function (s) { o[s.id] = valueOf(doc, s.id); }); return o; }
  function publicMap(doc) { var o = {}; list.forEach(function (s) { if (s.surface !== 'gm') o[s.id] = valueOf(doc, s.id); }); return o; }

  /* publishMap(stateDoc, current) -> what the GM page writes into the campaign document: the phone switch with a legacy key exactly as before, every other display or
     phone switch only while it is ON, and a plain false only for one the document already holds (so turning it off lands). With everything off the document is
     byte-for-byte what it was before the suite: absent means off. `current` is the campaign document's features. */
  function publishMap(doc, current) {
    var o = {}, cur = isObj(current) ? current : {};
    list.forEach(function (s) {
      if (s.surface === 'gm') return;
      var v = valueOf(doc, s.id);
      if (s.legacy || v) o[s.id] = v; else if (has(cur, s.id)) o[s.id] = false;
    });
    return o;
  }

  function patchFor(doc, id, on) {
    var s = get(id); if (!s) throw new Error('unknown switch: ' + str(id));
    var f = {}, p = { features: f };
    f[id] = on === true;
    if (s.legacy) p[s.legacy] = on === true;
    return p;
  }
  function patchAllOff() {
    var f = {}, p = { features: f };
    list.forEach(function (s) { f[s.id] = false; if (s.legacy) p[s.legacy] = false; });
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

  return { STAGES: STAGES, SURFACES: SURFACES, SATURDAY: SATURDAY, register: register, unregister: unregister, reset: reset, get: get, list: all, byStage: byStage,
    idsFor: idsFor, publicIds: publicIds, valueOf: valueOf, values: values, publicMap: publicMap, publishMap: publishMap, patchFor: patchFor, patchAllOff: patchAllOff,
    cleanPublic: cleanPublic, sameOn: sameOn };
});
