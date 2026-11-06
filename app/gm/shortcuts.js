/* gm/shortcuts.js — the Shortcuts card (K1): one glance at the keys, the "Blade, …" lines, the clocks, the music, the cue lines and Esc.

   GM laptop only: the gm bundle loads it, so the iPad and the phones never fetch it, and nothing here is stored or sent anywhere.
   It opens in the right-edge sheet (B68GmWorkshop.sheet(root, 'shortcuts', 'Shortcuts'), like the Music tool), so Esc closes it through the sheet's
   B68GmEsc entry ('sheet-shortcuts', priority 50) and no page key fires behind it. The page opens it with ? (keyAction type 'shortcuts', never while
   typing or behind an open box), from Find (findEntry()) and from the Menu; ? again closes it.

   THE CARD IS ONE ARRAY: SECTIONS below. The renderer draws it and checks/runtime/gm-shortcuts.test.mjs reads the same rows and holds every one to the code:
     key   { k: 'key', keys: [label], does, hits: [{ key, ctrl?, shift?, act? | via? }] }
           every hit is a press the page really handles: `act` is what gm-page.js keyAction answers for it; `via` names a handler outside keyAction
           ('go' the cue stack's Space and PageDown, 'ctrl-k' Find's Ctrl+K, 'site' the site view's arrows, 'panel' the Blade panel's own keys,
           'find' Find's arrows and Enter); the test checks each against that handler
     say   { k: 'say', say: [example], does, how: 'both' | 'typed' | 'mic', want: { type, verb?, bucket? } | { onair }, typed? }
           a "Blade, …" line (or a typed /command): every example goes through the app's real parser (app/cue.js with the registered verbs,
           B68Cue.fromTyped for a /command, the iPad's B68OnAir.detect for 'mic') and must come out as `want`. `typed` is the same thing's /command
           (drawn after what it does, "or type /clock 6 Alarm"), held to the same `want`
     line  { k: 'line', line, does, want: { kind } | { safe } }     a prep note cue line: through B68GmCueStack.parse under "## Cues"
     term  { k: 'term', term, does, not? }                         a plain line; `not` lists "Blade, …" lines the card says do NOT work (the test checks they don't)
   A section's `col` (1-4) is the column it stands in on a laptop (the four stacks fold to two, then one, on a narrower screen).
   In an example, {braces} mark the part the GM fills in: drawn as <var>, and taken off (plain()) before the parser sees it, so the parser reads what the card shows.
   In a term, a does or a note: [[X]] draws a key, **x** bold, `x` code, {x} a fill-in.

   Window.B68GmShortcuts, and module.exports under Node.
   API
     SECTIONS              the card
     rows(kind?) -> [row]  every row (of a kind), in card order, each with its section id as `sec`
     plain(s) -> s         an example without its {braces}
     html() -> the card's markup          text() -> the card as plain text (what the test scans for any "Blade, …" it did not check)
     findEntry() -> { kind, title, sub, text }     Find's row ("Shortcuts", "keys", "commands", "help", …)
     make(host) -> { open(), close(), toggle(), isOpen() }      host: { root() -> #gm-root } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68GmShortcuts = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var SHEET = 'shortcuts', TITLE = 'Shortcuts', COLS = 4;

  var SECTIONS = [
    { id: 'keys', col: 1, title: 'Keys', note: 'This laptop. Never while you type, never behind an open box.', rows: [
      { k: 'key', keys: ['1', '2', '3', '4'], does: 'They rolled: Before · 4/5 · 1–3 · Someone',
        hits: [{ key: '1', act: { type: 'situation', n: 1 } }, { key: '2', act: { type: 'situation', n: 2 } }, { key: '3', act: { type: 'situation', n: 3 } }, { key: '4', act: { type: 'situation', n: 4 } }] },
      { k: 'key', keys: ['Space', 'PgDn'], does: 'GO: the cue in standby', hits: [{ key: ' ', via: 'go' }, { key: 'PageDown', via: 'go' }] },
      { k: 'key', keys: ['Ctrl K', '/'], does: 'Find anything', hits: [{ key: 'k', ctrl: true, via: 'ctrl-k' }, { key: '/', act: { type: 'find' } }] },
      { k: 'key', keys: ['?'], does: 'This card', hits: [{ key: '?', shift: true, act: { type: 'shortcuts' } }] },
      { k: 'key', keys: ['Ctrl ←', 'Ctrl →'], does: 'Look at the place before or after (the night stays put)',
        hits: [{ key: 'ArrowLeft', ctrl: true, act: { type: 'place', d: -1 } }, { key: 'ArrowRight', ctrl: true, act: { type: 'place', d: 1 } }] },
      { k: 'key', keys: ['R', 'T', 'N', 'I'], does: 'Prep · Rules · Cast · iPad',
        hits: [{ key: 'r', act: { type: 'panel', panel: 'prep' } }, { key: 't', act: { type: 'panel', panel: 'rules' } }, { key: 'n', act: { type: 'panel', panel: 'npc' } }, { key: 'i', act: { type: 'panel', panel: 'ipad' } }] },
      { k: 'key', keys: ['G', 'B', 'S', 'J'], does: 'The site · Location roller · Street · Score generator',
        hits: [{ key: 'g', act: { type: 'panel', panel: 'run' } }, { key: 'b', act: { type: 'panel', panel: 'location' } }, { key: 's', act: { type: 'panel', panel: 'scenes' } }, { key: 'j', act: { type: 'panel', panel: 'score' } }] },
      { k: 'key', keys: ['C', 'D', 'O'], does: 'Chase · Downtime · Opportunities',
        hits: [{ key: 'c', act: { type: 'panel', panel: 'chase' } }, { key: 'd', act: { type: 'panel', panel: 'downtime' } }, { key: 'o', act: { type: 'panel', panel: 'cards' } }] },
      { k: 'key', keys: ['F'], does: 'Focus: the Roll shrinks to its keys', hits: [{ key: 'f', act: { type: 'focus' } }] },
      { k: 'key', keys: ['W'], does: 'Crew: the drawer (clocks, crew, sheets)', hits: [{ key: 'w', act: { type: 'drawer' } }] },
      { k: 'key', keys: ['A'], does: 'The Blade panel', hits: [{ key: 'a', act: { type: 'assist' } }] },
      { k: 'key', keys: ['U'], does: 'Undo Blade’s newest action', hits: [{ key: 'u', act: { type: 'undo' } }] },
      { k: 'key', keys: ['P', 'X', 'M'], does: 'Capture a Name · Loose end · Moment (capture bar on, in the Menu)',
        hits: [{ key: 'p', act: { type: 'capture', bucket: 'n' } }, { key: 'x', act: { type: 'capture', bucket: 'x' } }, { key: 'm', act: { type: 'capture', bucket: 'm' } }] },
      { k: 'key', keys: ['L'], does: 'File the last roll (capture bar on)', hits: [{ key: 'l', act: { type: 'last' } }] }
    ] },
    { id: 'esc', col: 1, title: 'Esc and PANIC', rows: [
      { k: 'key', keys: ['Esc'], does: 'One thing per press: shuts the top box (this card too), else leaves the field, else takes the stamp down, else PANIC',
        hits: [{ key: 'Escape', act: { type: 'esc' } }] },
      { k: 'term', term: 'PANIC', does: 'The band’s last button: the iPad to the safe scene, sound and music down, and the band says WORK LIGHT UP (put the work light on). **Resume** puts it back.' },
      { k: 'key', keys: ['0'], does: 'Clear the iPad: back to the ambient scene', hits: [{ key: '0', act: { type: 'clear' } }] },
      { k: 'key', keys: ['Shift H', 'H H'], does: 'Blank this laptop; any key brings it back',
        hits: [{ key: 'H', shift: true, act: { type: 'blank' } }, { key: 'h', act: { type: 'blank-tap' } }] }
    ] },
    { id: 'music', col: 2, title: 'Music', rows: [
      { k: 'term', term: '♪ pill', does: 'Band, row 2. Tap it: **▶ Play / ❚❚ Pause** · **Next track** · Hanging around · Tension · Action · **Auto** · **Stop** · Volume. Nothing plays until you tap ▶.' },
      { k: 'term', term: 'Auto', does: 'Blade cuts by the night (Tension in the Score, Action when it heats up). A mood you tap holds until Auto.' },
      { k: 'term', term: 'The tracks', does: 'Before › The room › **Music** (or Find “music”): playlists, speaker, volume; the controls too, when the pill is hidden.' },
      { k: 'term', term: 'Not by voice', does: 'Blade has no music command: tap the pill, or put a `music:` cue line in the prep.', not: ['Blade, music tension', 'Blade, play the action music'] }
    ] },
    { id: 'clocks', col: 2, title: 'Clocks', note: 'Blade’s clocks start hidden from the players.', rows: [
      { k: 'say', say: ['Blade, make a {six} clock called {Alarm}'], does: 'A new danger clock on the table', how: 'both', want: { type: 'clock_add' }, typed: '/clock {6} {Alarm}' },
      { k: 'say', say: ['Blade, tick {Alarm}'], does: 'One segment', how: 'both', want: { type: 'clock_tick' }, typed: '/tick {Alarm}' },
      { k: 'say', say: ['Blade, tick {Alarm} {two}'], does: 'Two segments', how: 'both', want: { type: 'clock_tick' } },
      { k: 'say', say: ['Blade, tick that'], does: 'The clock Blade last made or ticked', how: 'both', want: { type: 'clock_tick' } },
      { k: 'say', say: ['Blade, fill {Alarm}'], does: 'Fill it', how: 'both', want: { type: 'clock_tick' } },
      { k: 'say', say: ['Blade, clear {two} on {Alarm}'], does: 'Take two off', how: 'both', want: { type: 'clock_tick' } },
      { k: 'term', term: 'By hand', does: '[[W]] › Crew › **Edit**: New clock, a size, **Add clock**; − and + tick it; **Hidden** shows or hides it.' },
      { k: 'term', term: 'On the iPad', does: '[[W]] › Table › **Show on iPad**: the clocks the players can see.' }
    ] },
    { id: 'blade', col: 3, title: '“Blade, …” on the iPad',
      note: '**Say it** with Listening on and Co-GM on (its switch is in the Blade panel, off at every load). **Type it** in the Blade panel’s Ask box ([[A]]) and press Enter: that works with Co-GM off.', rows: [
      { k: 'say', say: ['Blade, stamp {risky} {standard}'], does: 'The stamp on the iPad (a threat can follow a comma)', how: 'both', want: { type: 'cue_do', verb: 'stamp' } },
      { k: 'say', say: ['Blade, reveal {Mabel}'], does: 'Reveal a hidden NPC (it asks first)', how: 'both', want: { type: 'cue_do', verb: 'reveal' } },
      { k: 'say', say: ['Blade, reveal'], does: 'Send the staged rooms to the map', how: 'both', want: { type: 'cue_do', verb: 'reveal' } },
      { k: 'say', say: ['Blade, introduce {Mabel} and {Dov}'], does: 'Name cards for revealed NPCs', how: 'both', want: { type: 'cue_do', verb: 'introduce' } },
      { k: 'say', say: ['Blade, spotlight {Mabel}'], does: 'A revealed NPC’s portrait, held', how: 'both', want: { type: 'cue_do', verb: 'spotlight' } },
      { k: 'say', say: ['Blade, flashback'], does: 'The flashback look on the iPad', how: 'both', want: { type: 'cue_do', verb: 'flashback' } },
      { k: 'say', say: ['Blade, flashback {two}'], does: 'The same, and logs its Stress cost', how: 'both', want: { type: 'cue_do', verb: 'flashback' } },
      { k: 'say', say: ['Blade, back'], does: 'Flashback off', how: 'both', want: { type: 'cue_do', verb: 'back' } },
      { k: 'say', say: ['Blade, go to {planning}'], does: 'Move the night: personal · planning · score · aftermath', how: 'both', want: { type: 'cue_do', verb: 'go' } },
      { k: 'say', say: ['Blade, go'], does: 'GO: the cue in standby', how: 'both', want: { type: 'cue_do', verb: 'fire' } }
    ] },
    { id: 'box', col: 3, title: 'Keys inside a box', rows: [
      { k: 'key', keys: ['→', '←', 'Shift →'], does: 'The site: the next or last beat; the next thing that happens',
        hits: [{ key: 'ArrowRight', via: 'site' }, { key: 'ArrowLeft', via: 'site' }, { key: 'ArrowRight', shift: true, via: 'site' }] },
      { k: 'key', keys: ['J', 'K', 'U'], does: 'The Blade panel: move between its cards; undo',
        hits: [{ key: 'j', via: 'panel' }, { key: 'k', via: 'panel' }, { key: 'u', via: 'panel' }] },
      { k: 'key', keys: ['↑', '↓', 'Enter'], does: 'Find: pick a line; go there', hits: [{ key: 'ArrowUp', via: 'find' }, { key: 'ArrowDown', via: 'find' }, { key: 'Enter', via: 'find' }] }
    ] },
    { id: 'blade2', col: 4, title: '“Blade, …” the cast and notes', rows: [
      { k: 'say', say: ['Blade, new NPC called {Ada Vell}'], does: 'A hidden NPC in the cast (no name: one is rolled)', how: 'both', want: { type: 'npc_add' }, typed: '/npc {Ada Vell}' },
      { k: 'say', say: ['Blade, call her {Lotte Brand}'], does: 'Rename what Blade just made', how: 'both', want: { type: 'rename' } },
      { k: 'say', say: ['Blade, note {the guard took the bribe}'], does: 'A Moment in tonight’s capture', how: 'both', want: { type: 'capture', bucket: 'moment' }, typed: '/note {the bribe}' },
      { k: 'say', say: ['Blade, loose end {the ledger is missing}'], does: 'A Loose end', how: 'both', want: { type: 'capture', bucket: 'loose_end' } },
      { k: 'say', say: ['Blade, name {Dov Kessler}'], does: 'A Name', how: 'both', want: { type: 'capture', bucket: 'name' } },
      { k: 'say', say: ['Blade, {Nell} to the {cellar}'], does: 'Move a PC to a room of the site', how: 'both', want: { type: 'pc_move' } },
      { k: 'say', say: ['Blade, undo'], does: 'Undo Blade’s newest action', how: 'both', want: { type: 'undo' }, typed: '/undo' },
      { k: 'say', say: ['Blade, off the record'], does: 'The iPad keeps nothing it hears for 5 min (needs only Listening)', how: 'mic', want: { onair: 'off' } },
      { k: 'say', say: ['Blade, back on'], does: 'It keeps what it hears again', how: 'mic', want: { onair: 'on' } },
      { k: 'term', term: 'Won’t', does: 'Show anything else, or touch stress, harm, xp or coin: Blade says it can’t.', not: ['Blade, show the map', 'Blade, two stress to Nell'] }
    ] },
    { id: 'cues', col: 4, title: 'Cue lines (the prep note)', note: 'Under the note’s `## Cues`, one numbered line each. GO fires the next: Space, PgDn, the GO button, or “Blade, go”.', rows: [
      { k: 'line', line: '1. scene: {tram}', does: 'Pin an ambient scene on the iPad', want: { kind: 'scene' } },
      { k: 'line', line: '2. show: title: {The Pelican Rooms | A night out}', does: 'A beat: title, ring, spotted or stamp', want: { kind: 'show' } },
      { k: 'line', line: '3. reveal: {Mabel Quist}', does: 'Reveal a hidden NPC', want: { kind: 'reveal' } },
      { k: 'line', line: '4. phase: {score}', does: 'Move the night: pb · plan · score · after', want: { kind: 'phase' } },
      { k: 'line', line: '5. music: {tension}', does: 'action · tension · calm · auto · off', want: { kind: 'music' } },
      { k: 'line', line: '6. sound: {Band strikes up}', does: 'By hand: it tells you what to play', want: { kind: 'sound' } },
      { k: 'line', line: '7. light: {Lamps down, amber}', does: 'By hand: the lights', want: { kind: 'light' } },
      { k: 'line', line: '8. practical: {Three knocks}', does: 'By hand: the practical speaker', want: { kind: 'practical' } },
      { k: 'line', line: 'safe: {testcard}', does: 'Where PANIC sends the iPad', want: { safe: 'testcard' } }
    ] }
  ];

  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function plain(s) { return str(s).replace(/[{}]/g, ''); }
  /* an example: {x} is the GM's own part */
  function ex(s) { return esc(s).replace(/\{([^{}]*)\}/g, '<var>$1</var>'); }
  /* a term, a does or a note: [[X]] a key, **x** bold, `x` code, {x} the GM's own */
  function rich(s) {
    return esc(s).replace(/\[\[([^\]]+)\]\]/g, '<kbd>$1</kbd>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\{([^{}]*)\}/g, '<var>$1</var>');
  }
  function bare(s) { return str(s).replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/[{}]/g, ''); }

  function rows(kind) {
    var out = [];
    SECTIONS.forEach(function (s) { s.rows.forEach(function (r) { if (!kind || r.k === kind) out.push(Object.assign({ sec: s.id }, r)); }); });
    return out;
  }

  var HOW = { typed: 'type it', mic: 'say it to the iPad' };
  function rowHtml(r) {
    var dt, cls = 'gm-sc-row gm-sc-' + r.k;
    if (r.k === 'key') dt = r.keys.map(function (k) { return '<kbd>' + esc(k) + '</kbd>'; }).join(' ');
    else if (r.k === 'say') dt = r.say.map(function (s) { return '<span class="gm-sc-q' + (/^\//.test(s) ? ' gm-sc-typed' : '') + '">' + ex(s) + '</span>'; }).join(' ');
    else if (r.k === 'line') dt = '<code class="gm-sc-line">' + ex(r.line) + '</code>';
    else dt = '<span class="gm-sc-t">' + rich(r.term) + '</span>';
    var more = r.k === 'say' && HOW[r.how] ? ' <span class="gm-sc-how">' + HOW[r.how] + '</span>' : '';
    if (r.k === 'say' && r.typed) more += '<span class="gm-sc-or"> · or type <code class="gm-sc-typed">' + ex(r.typed) + '</code></span>';
    return '<div class="' + cls + '" data-sc-row="' + r.k + '"' + (r.k === 'say' ? ' data-how="' + esc(r.how) + '"' : '') + '><dt>' + dt + '</dt><dd>' + rich(r.does) + more + '</dd></div>';
  }
  function secHtml(s) {
    return '<section class="gm-box gm-sc-sec" data-sc-sec="' + s.id + '" aria-label="' + esc(bare(s.title)) + '"><h3 class="gm-band">' + esc(s.title) + '</h3>' +
      (s.note ? '<p class="gm-sc-note">' + rich(s.note) + '</p>' : '') +
      '<dl class="gm-sc-list">' + s.rows.map(rowHtml).join('') + '</dl></section>';
  }
  function html() {
    var cols = [];
    for (var c = 1; c <= COLS; c++) cols.push('<div class="gm-sc-col" data-sc-col="' + c + '">' + SECTIONS.filter(function (s) { return s.col === c; }).map(secHtml).join('') + '</div>');
    return '<div class="gm-sc" data-sc>' +
      '<p class="gm-sc-lead"><kbd>?</kbd> or <kbd>Esc</kbd> shuts this card; Find (“keys”) and the Menu open it too. <var>Italics</var> are yours to fill in.</p>' +
      '<div class="gm-sc-cols">' + cols.join('') + '</div></div>';
  }
  /* the card as plain text, every word the GM reads on it */
  function text() {
    return SECTIONS.map(function (s) {
      return [bare(s.title), bare(s.note || '')].concat(s.rows.map(function (r) {
        var head = r.k === 'key' ? r.keys.join(' ') : r.k === 'say' ? r.say.map(plain).join(' ') : r.k === 'line' ? plain(r.line) : bare(r.term);
        return head + ' — ' + bare(r.does) + (r.typed ? ' — or type ' + plain(r.typed) : '');
      })).join('\n');
    }).join('\n\n');
  }

  var WORDS = 'shortcuts keys keyboard commands help cheat sheet blade lines voice say type typed cue lines cues';
  function findEntry() { return { kind: 'Tool', title: TITLE, sub: 'keys, “Blade, …” lines, cue lines · ?', text: WORDS }; }

  /* ---------- the sheet (DOM) ---------- */
  function make(host) {
    host = host || {};
    function sheet() {
      var Wk = W && W.B68GmWorkshop, r = typeof host.root === 'function' ? host.root() : null;
      return Wk && r && typeof Wk.sheet === 'function' ? Wk.sheet(r, SHEET, TITLE) : null;
    }
    function isOpen() { var s = sheet(); return !!(s && s.isOpen()); }
    function open() {
      var s = sheet(); if (!s || !s.body) return false;
      if (!s.body.querySelector('[data-sc]')) s.body.innerHTML = html();
      s.open();
      try { s.body.scrollTop = 0; } catch (e) { /* not laid out */ }
      return true;
    }
    function close() { var s = sheet(); if (s && s.isOpen()) s.close(); }
    function toggle() { if (isOpen()) { close(); return false; } return open(); }
    return { open: open, close: close, toggle: toggle, isOpen: isOpen };
  }

  return { SHEET: SHEET, TITLE: TITLE, COLS: COLS, SECTIONS: SECTIONS, rows: rows, plain: plain, html: html, text: text, findEntry: findEntry, make: make };
});
