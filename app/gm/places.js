/* gm/places.js — the places of the night (the GM night rebuild, N1b; design sections 2, 3, 4 and 8). The night is the navigation.

   Six places in the order the evening runs, Before · Opening · Personal · Planning · Score · Aftermath, and Between for the days between
   sessions. Each place has a LEFT COLUMN (the Roll where people roll: Personal, Planning, Score; the place's own controls in Before, Opening and
   the Aftermath; a slim list of the desks Between) and a VIEW SWITCHER: the place's own views first, then the four views every place has,
   Prep (R), Rules (T), Cast (N) and iPad (I). Below 1100 px the switcher is a chip row under the band and the left column is a segment.

   A VIEW is one row of VIEWS below, the one table of views and tools:
     pane    an existing pane of the page (prep rules npc ipad run location scenes score chase downtime cards), shown and hidden in place by
             the page (host.showPane): never rebuilt here. A pane view may scroll to an anchor (iPad scenes) or to Prep's heading (Titles).
     tool    a tool drawn inline: the tool registry's controller (W.B68GmTools.get(id) -> { open(), close?(), mounted?() }) opened into a
             container bound with W.B68GmWorkshop.inline(id, el, { title: false, onClose }) (N2). Without them the view says what the tool
             is and opens its right-edge sheet (host.sheetOpen(id)). An extra view's tool also closes on Esc (gm/esc.js through the inline host).
     built   a view made here from those: Tonight (the note, its Before sections, the run order), The room (four tools), Desks (Between).
   TOOLS COME TO YOU. openView(id) shows a view in the CURRENT place. A view the place does not list joins the end of its switcher as an
   extra view, with a × to drop it, for as long as the GM stays; a tool the place already lays out (its left column, The room, the board
   inside Opportunities, a desk) is shown where it is instead of a second copy. A key or Find never sends the GM to another place.
   THE NIGHT. goPlace(id) on a phase place enters that phase as the rail did (the night controller's enter: its log, the iPad's band and the
   Score's title card follow), unless { navigateOnly: true }. Before, Opening and Between never change the phase. When the phase changes any
   other way (a `phase:` cue, "Blade, go to …", the curfew, another GM device), the page follows it to that place, unless the GM is in
   Between. callAftermath() enters the Aftermath, goes there and starts the show (the curfew's Call the Aftermath: design seam 7).
   ARRIVING. A place shows the view the GM last had there (its first view the first time). Prep is the exception: read while the place
   changes, Prep stays and turns to the new place's section, so the notes follow the night.
   PREP AT THE SECTION. Opening Prep from another view, or changing place while Prep shows, scrolls to the first ## heading of the open note
   that holds one of the place's words (DEF[].words); none matches: the top.
   MEMORY. The place, each place's last view and the extra view live in localStorage (b68.gm.places), never in a stored document, so a
   rollback finds nothing new. On load: the place the GM left if the night's phase is the one it was then; else the night's phase place
   (a phase entered elsewhere while this page was shut wins); else Before.

   Window.B68GmPlaces, and module.exports under Node (the pure part; create() needs the page's DOM).
   PURE
     list() -> [{ id, label, phase|null }]    the six, in night order          between() -> { id: 'between', label: 'Between', phase: null }
     place(id) -> { id, label, phase, left, leftLabel, views: [{ id, label }], words, about } | null     view(id) -> a VIEWS row | null
     viewsOf(placeId) -> [view id]  own then pinned      lists(placeId, viewId) -> bool      forPhase(phase) -> place id | ''
     step(placeId, dir) -> the place before (-1) or after (+1), Between after the Aftermath; the ends stay put
     prepTarget(placeId, headings, words?) -> the index of the first heading holding one of the place's words (or of `words`), or -1
     placeOfText(text) -> the first place (night order) whose words a run-order beat names, or ''
     roomsOf(note) -> the ### headings under the note's own "## Rooms"
     facts(note, Night, CueStack) -> { title, start, curfew, cues, rooms, rows: [{ beat, place, min }], budgets }
     findEntries(extra) -> Find's rows for every place ("Go to Planning") and every view and tool; extra: registered tools with a mount
     homeOf(viewId) -> the place that lays a view or tool out first ('' for the pinned)       restore(stored, phase) -> { place, views, extra }
     KEY PLACES BETWEEN PINNED VIEWS DESKS LEFT_TOOL
   DOM
     create(host) -> { mount(), sync(), goPlace(id, o), openView(id, o), dropExtra(), callAftermath(), stepPlace(dir), rolled(),
                       currentPlace(), currentView(), findEntries(), destroy(), _state() }
       host: { root() -> #gm-root, phase() -> the night's phase id | '', enter(phase) -> bool (the night controller, as the rail),
               showPane(id) (the page's pane switch: S.panel, the panes' hidden flags, a pane's first-show work), seg(which) ('console' |
               'side': the phone's one column), prepNote() -> the open note | null, prepNotes() -> [{ id, title }], setPrepNote(id),
               prepSecs() -> [{ id, head, html() }] the open note's ## sections, decorate(el) (ticks, cells), crew() -> [{ id, name, stress,
               harm: [1-4], locks, turn: [key names] }], sheetOpen(id) -> bool, exportTonight(), endNight() -> Promise, recording() -> bool,
               stopRecording(), toast(msg, bad),
               nightTimes() -> { startAt, curfewAt } (the night's own, "HH:MM" | null), setTime(key, hhmm), usePrep(key) (the Tonight box's fields) }
       Every host function is optional: a missing one costs only its own feature. The page calls mount() after each layout() (and once its
       panes are drawn) and sync() from its pane switch, which runs on every state arrival. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmPlaces = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var KEY = 'b68.gm.places';
  var PLACES = [
    { id: 'before', label: 'Before', phase: null },
    { id: 'opening', label: 'Opening', phase: null },
    { id: 'pb', label: 'Personal', phase: 'pb' },
    { id: 'plan', label: 'Planning', phase: 'plan' },
    { id: 'score', label: 'Score', phase: 'score' },
    { id: 'after', label: 'Aftermath', phase: 'after' }
  ];
  var BETWEEN = { id: 'between', label: 'Between', phase: null };
  var PINNED = ['prep', 'rules', 'npc', 'ipad'];

  /* each place: its left column (roll: the console; own: drawn here; slim: Between's desk list), its own views (an id, or [id, label] where the
     place names one its own way), the words its Prep heading is found by, and a line for Find */
  var DEF = {
    before: { left: 'own', leftLabel: 'Preflight', views: ['tonight', 'room', 'print', 'ipadscenes'], words: ['before the night', 'tonight', 'index'], about: 'until the Opening: preflight, the room, print' },
    opening: { left: 'own', leftLabel: 'Hard start', views: ['titles', 'frontpage'], words: ['titles', 'open'], about: 'the hard start, Previously on, the titles' },
    pb: { left: 'roll', views: ['downtime', ['debrief', 'Debrief replies'], 'trouble'], words: ['downtime', 'personal'], about: 'personal business: downtime, vices, the morning after' },
    plan: { left: 'roll', views: ['cards', 'corkboard', 'run', 'score'], words: ['briefing', 'planning', 'gather information', 'engagement'], about: 'opportunities, intel, the site, the engagement roll' },
    score: { left: 'roll', views: ['run', 'chase', 'scenes', 'location'], words: ['score', 'rooms', 'must land'], about: 'the site, the chase, the street' },
    after: { left: 'own', leftLabel: 'The crew', short: 'Crew', views: ['aftermath', 'downtime'], words: ['close', 'aftermath', 'payout'], about: 'the show, the debrief, end the night' },
    between: { left: 'slim', leftLabel: 'Desks', views: ['desks'], words: ['index'], about: 'the days between sessions: the desks' }
  };
  /* the left column's tool, where the place draws one there */
  var LEFT_TOOL = { before: 'preflight', opening: 'hardstart' };

  /* THE ONE TABLE of views and tools. label: the switcher's; short: a phone chip's; title: Find's when the label alone is not enough; key: the
     key that opens it from anywhere (design section 8); words: what Find matches besides the title; desc: what a tool is, said on its desk and
     wherever it cannot be drawn; act: the fallback button of a tool that acts rather than opens */
  var VIEWS = {
    prep: { label: 'Prep', key: 'R', pane: 'prep', words: 'prep note session outline sections run order' },
    rules: { label: 'Rules', key: 'T', pane: 'rules', words: 'rules gm screen reference position effect' },
    npc: { label: 'Cast', key: 'N', pane: 'npc', words: 'cast npc npcs people generator introduce card show' },
    ipad: { label: 'iPad', key: 'I', pane: 'ipad', words: 'ipad display listening transcript who is who handouts ambient settings' },
    run: { label: 'The site', short: 'Site', key: 'G', pane: 'run', words: 'site run map rooms knowledge engagement alarm countdown staging' },
    location: { label: 'Location roller', short: 'Roller', key: 'B', pane: 'location', words: 'location roller roll building improv site picker map' },
    scenes: { label: 'Street', key: 'S', pane: 'scenes', words: 'street scene read aloud' },
    score: { label: 'Score generator', short: 'Score gen', key: 'J', pane: 'score', words: 'score generator heist job planner client target' },
    chase: { label: 'Chase', key: 'C', pane: 'chase', words: 'chase pursuit strip' },
    downtime: { label: 'Downtime', key: 'D', pane: 'downtime', words: 'downtime vice morning after activities' },
    cards: { label: 'Opportunities', short: 'Opps', key: 'O', pane: 'cards', slot: { tool: 'board', sel: '#gm-opps-players' }, words: 'opportunities opportunity cards pitches board posts players' },
    tonight: { label: 'Tonight', build: 'tonight', words: 'tonight session note run order start curfew cues before the night' },
    room: { label: 'The room', short: 'Room', tools: ['practical', 'phone', 'light', 'record'], words: 'the room practical speaker ringing phone light relay record' },
    ipadscenes: { label: 'iPad scenes', short: 'Scenes', pane: 'ipad', anchor: ['#gm-ipad .gm-ipad-scenes', '#gm-ipad [data-ipad-sec="scenes"]', '#gm-ipad-scenes', '#gm-ipad .gm-ipad-amb'], words: 'ipad scenes ambient playlist theme' },
    titles: { label: 'Titles', pane: 'prep', prepWords: ['titles', 'open'], words: 'titles opening previously on' },
    desks: { label: 'Desks', build: 'desks', words: 'desks between sessions' },
    preflight: { label: 'Preflight', tool: 'preflight', words: 'preflight checks ready sound files sign in pack', desc: 'Is the room ready: the iPad sound, its files, the transcriber, the sign-in and the pack, green or red, each red with its fix.' },
    hardstart: { label: 'Hard start', tool: 'hardstart', words: 'hard start cold open countdown faces previously', desc: 'The cold open on the iPad: the station clock, the fuse, the credits and three faces to name.' },
    print: { label: 'Print', tool: 'print', words: 'print calling cards standees blueprint', desc: 'Calling cards for the revealed cast, tent standees, the blueprint of the rooms the crew knows.' },
    frontpage: { label: 'Front page', tool: 'frontpage', words: 'front page newspaper headline', desc: 'Paste the front page note: the newspaper to print, the headline to show on the iPad.' },
    debrief: { label: 'Debrief', tool: 'debrief', words: 'debrief replies phones send', desc: 'The Aftermath steps not reached go to each phone the next morning; the replies come back here.' },
    trouble: { label: 'Trouble desk', short: 'Trouble', tool: 'trouble', words: 'trouble desk rumours checks', desc: 'The trouble checks table by table, drafts kept or dropped, and the next rumour on the iPad.' },
    board: { label: 'Opportunity board', tool: 'board', words: 'opportunity board posts collect close players pitches', desc: 'What the players posted from their phones: pick one, show the board on the iPad, close it.' },
    corkboard: { label: 'Intel', title: 'Intel (the corkboard)', tool: 'corkboard', words: 'intel corkboard polaroids mugshots planning board', desc: 'The site on cork: a Polaroid for each fact told, mugshots on their posts. Print it A4 or A3.' },
    montage: { label: 'Montage', tool: 'montage', words: 'montage panels split', desc: 'The iPad split into a panel per character, for a score past its budget.' },
    aftermath: { label: 'The show', title: 'The Aftermath show', tool: 'aftermath', words: 'aftermath show payout heat steps credits xp', desc: 'The eight steps of the Aftermath, steered from here; the iPad follows.' },
    castphoto: { label: 'Cast photo', tool: 'castphoto', words: 'cast photo line up arc', desc: 'A true-height line-up of the cast for the end of an arc: on the iPad, or printed.' },
    absent: { label: 'Absent packet', tool: 'absent', words: 'absent packet missed player', desc: 'One page for a player who missed the night: the front page, the faces, what changed on their sheet.' },
    canon: { label: 'Canon queue', tool: 'canon', words: 'canon queue facts check', desc: 'Paste the canon queue and check the ticked lines before the laptop script files them.' },
    lair: { label: 'The lair', tool: 'lair', words: 'lair base cutaway crew upgrades', desc: 'The crew’s base as a cut-away, growing with each upgrade, on the iPad.' },
    practical: { label: 'Practical speaker', tool: 'practical', words: 'practical speaker sound output test', desc: 'The laptop’s second output, for sounds in the room: choose it and test it.' },
    phone: { label: 'Ringing phone', tool: 'phone', words: 'ringing phone recordings ring answer', desc: 'Recordings kept on this laptop: ring the phone, answer with one, hang up.' },
    light: { label: 'Light relay', tool: 'light', words: 'light relay light alarm rim lights', desc: 'The rim lights, through the relay on this laptop. Light alarm flashes them for 3 s.', act: 'Light alarm (3 s)' },
    record: { label: 'Record the night', tool: 'record', words: 'record recording the night batch', desc: 'Records the table on this laptop only, never uploaded; it is transcribed after the night.', act: 'Record the night' }
  };
  /* Between's desks, in the order the week needs them; Generators opens the three generator panes */
  var DESKS = [
    { id: 'frontpage' }, { id: 'absent' }, { id: 'canon' }, { id: 'debrief', label: 'Debrief replies' }, { id: 'board' }, { id: 'lair' },
    { id: 'castphoto' }, { id: 'trouble' }, { id: 'print' },
    { id: 'gen', label: 'Generators', desc: 'An NPC, a score or a location, rolled for the week’s prep.', panes: [['npc', 'NPC'], ['score', 'Score'], ['location', 'Location']] }
  ];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function fold(s) { return str(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  /* ---------- the places ---------- */
  var ORDER = PLACES.map(function (p) { return p.id; }).concat([BETWEEN.id]);
  function list() { return PLACES.map(function (p) { return { id: p.id, label: p.label, phase: p.phase }; }); }
  function between() { return { id: BETWEEN.id, label: BETWEEN.label, phase: null }; }
  function base(id) { return id === BETWEEN.id ? BETWEEN : PLACES.filter(function (p) { return p.id === id; })[0] || null; }
  function isPlace(id) { return !!base(id); }
  function placeLabel(id) { var b = base(id); return b ? b.label : ''; }
  function ownOf(id) {
    var d = has(DEF, id) ? DEF[id] : null; if (!d) return [];
    return d.views.map(function (v) { var k = Array.isArray(v) ? v[0] : v; return { id: k, label: (Array.isArray(v) && v[1]) || (VIEWS[k] ? VIEWS[k].label : k) }; });
  }
  function place(id) {
    var b = base(id), d = b ? DEF[id] : null; if (!d) return null;
    return { id: b.id, label: b.label, phase: b.phase, left: d.left, leftLabel: d.leftLabel || 'The Roll', views: ownOf(id), words: d.words.slice(), about: d.about };
  }
  function view(id) { return has(VIEWS, id) ? VIEWS[id] : null; }
  function viewsOf(id) { return ownOf(id).map(function (v) { return v.id; }).concat(PINNED); }
  function lists(placeId, viewId) { return viewsOf(placeId).indexOf(viewId) >= 0; }
  function forPhase(phase) { var p = PLACES.filter(function (x) { return x.phase && x.phase === phase; })[0]; return p ? p.id : ''; }
  function step(id, dir) {
    var i = ORDER.indexOf(id); if (i < 0) return 'before';
    return ORDER[Math.max(0, Math.min(ORDER.length - 1, i + (dir < 0 ? -1 : 1)))];
  }
  /* a place's word at the start of a word of the text: "Open" finds "Open" and "Opening", never "Reopen" */
  function holds(text, w) { var t = ' ' + fold(text) + ' ', k = fold(w); return !!k && t.indexOf(' ' + k) >= 0; }
  function prepTarget(placeId, heads, wordList) {
    var ws = Array.isArray(wordList) ? wordList : has(DEF, placeId) ? DEF[placeId].words : [];
    if (!ws.length || !Array.isArray(heads)) return -1;
    for (var i = 0; i < heads.length; i++) for (var j = 0; j < ws.length; j++) if (holds(heads[i], ws[j])) return i;
    return -1;
  }
  function placeOfText(text) {
    for (var i = 0; i < PLACES.length; i++) { var ws = DEF[PLACES[i].id].words; for (var j = 0; j < ws.length; j++) if (ws[j] !== 'index' && holds(text, ws[j])) return PLACES[i].id; }
    return '';
  }

  /* ---------- the open prep note, as Before reads it ---------- */
  var FENCE = /^ {0,3}(`{3,}|~{3,})/;
  function ownMd(note) { return (isObj(note) && Array.isArray(note.blocks) ? note.blocks : []).filter(function (b) { return isObj(b) && b.k !== 'embed'; }).map(function (b) { return str(b.src); }).join('\n'); }
  function roomsOf(note) {
    var out = [], inRooms = false, fence = null;
    ownMd(note).replace(/\r\n?/g, '\n').split('\n').forEach(function (ln) {
      var f = FENCE.exec(ln);
      if (fence) { if (f && f[1].charAt(0) === fence.charAt(0) && f[1].length >= fence.length) fence = null; return; }
      if (f) { fence = f[1]; return; }
      var h2 = /^ {0,3}## +(.+?)[ \t#]*$/.exec(ln);
      if (h2) { inRooms = /^rooms\b/i.test(h2[1].trim()); return; }
      var h3 = /^ {0,3}### +(.+?)[ \t#]*$/.exec(ln);
      if (inRooms && h3 && out.indexOf(h3[1].trim()) < 0) out.push(h3[1].trim());
    });
    return out;
  }
  function facts(note, Night, Cues) {
    var out = { title: isObj(note) ? str(note.title) : '', start: null, curfew: null, cues: 0, rooms: 0, rows: [], budgets: {} };
    if (!isObj(note)) return out;
    if (Night && typeof Night.parsePrep === 'function') {
      try {
        var p = Night.parsePrep(note);
        out.start = p.start || null; out.curfew = p.curfew || null; out.budgets = isObj(p.budgets) ? p.budgets : {};
        out.rows = (Array.isArray(p.rows) ? p.rows : []).map(function (r) { return { beat: str(r.beat), place: forPhase(r.phase) || placeOfText(r.beat), min: r.min || null }; });
      } catch (e) { /* a note the parser cannot read: no numbers */ }
    }
    if (Cues && typeof Cues.parse === 'function') { try { out.cues = (Cues.parse(note).cues || []).length; } catch (e) { out.cues = 0; } }
    out.rooms = roomsOf(note).length;
    return out;
  }

  /* ---------- Find ---------- */
  function homeOf(id) {
    if (PINNED.indexOf(id) >= 0) return '';
    for (var i = 0; i < ORDER.length; i++) {
      var k = ORDER[i];
      if (LEFT_TOOL[k] === id) return k;
      if (ownOf(k).some(function (v) { var row = VIEWS[v.id]; return v.id === id || (row && ((row.tools && row.tools.indexOf(id) >= 0) || (row.slot && row.slot.tool === id))); })) return k;
    }
    return DESKS.some(function (x) { return x.id === id; }) ? BETWEEN.id : '';
  }
  function findEntries(extra) {
    var out = [];
    ORDER.forEach(function (id) {
      var p = base(id), d = DEF[id];
      out.push({ kind: 'Place', title: 'Go to ' + p.label, sub: d.about, text: [p.label, id === 'pb' ? 'personal business' : '', d.words.join(' ')].join(' '), go: { t: 'place', id: id } });
    });
    Object.keys(VIEWS).forEach(function (id) {
      var v = VIEWS[id], home = homeOf(id);
      out.push({ kind: v.tool ? 'Tool' : 'View', title: v.title || v.label, sub: (PINNED.indexOf(id) >= 0 ? 'every place' : home ? placeLabel(home) : 'opens where you are') + (v.key ? ' · ' + v.key : ''), text: v.words, go: { t: 'view', id: id } });
    });
    (Array.isArray(extra) ? extra : []).forEach(function (t) { if (isObj(t) && t.id && !has(VIEWS, t.id)) out.push({ kind: 'Tool', title: str(t.label) || str(t.id), sub: '', text: str(t.words), go: { t: 'view', id: str(t.id) } }); });
    return out;
  }

  /* ---------- memory ---------- */
  function restore(stored, phase) {
    var s = isObj(stored) ? stored : {}, views = {}, ph = str(phase);
    if (isObj(s.views)) Object.keys(s.views).forEach(function (k) { if (isPlace(k) && has(VIEWS, s.views[k])) views[k] = s.views[k]; });
    var pl = isPlace(s.place) && str(s.phase) === ph ? s.place : forPhase(ph) || 'before';
    var ex = isObj(s.extra) && s.extra.place === pl && has(VIEWS, s.extra.view) && !lists(pl, s.extra.view) ? s.extra.view : '';
    Object.keys(views).forEach(function (k) { if (!lists(k, views[k]) && !(k === pl && views[k] === ex)) delete views[k]; });
    return { place: pl, views: views, extra: ex };
  }

  /* =====================================================================================================================
     DOM: the controller one GM page holds
     ===================================================================================================================== */
  function create(host) {
    host = host || {};
    var st = { place: 'before', views: {}, extra: '', prior: '', desk: '', rollHere: false, phase: '', els: null, bound: {}, busy: 0, sigs: {}, gone: false, escOff: null, flashT: null };
    function call(name) { var f = host[name]; if (typeof f !== 'function') return undefined; try { return f.apply(host, [].slice.call(arguments, 1)); } catch (e) { if (W && W.console) W.console.error('places: ' + name, e); return undefined; } }
    function phaseNow() { return str(call('phase') || ''); }
    function toast(m, bad) { call('toast', m, bad); }
    function store() { try { return W && W.localStorage ? W.localStorage : null; } catch (e) { return null; } }
    function readStore() { var s = store(); try { var raw = s ? s.getItem(KEY) : null; return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
    function writeStore() {
      var s = store(); if (!s) return;
      try { s.setItem(KEY, JSON.stringify({ v: 1, place: st.place, phase: phaseNow(), views: st.views, extra: st.extra ? { place: st.place, view: st.extra } : null })); } catch (e) { /* private mode: the place is not kept */ }
    }
    (function init() { var r = restore(readStore(), phaseNow()); st.place = r.place; st.views = r.views; st.extra = r.extra; st.phase = phaseNow(); })();

    function current() { var v = st.views[st.place]; return v && (lists(st.place, v) || v === st.extra) ? v : ownOf(st.place)[0].id; }
    /* a tool registered with a mount of its own (gm/tools.js): a view drawn by its mount */
    function extraTool(id) { var T = W && W.B68GmTools; if (!T || typeof T.extras !== 'function') return null; try { return T.extras().filter(function (t) { return t && t.id === id; })[0] || null; } catch (e) { return null; } }
    function known(id) { return has(VIEWS, id) || !!extraTool(id); }
    function labelIn(id) { var own = ownOf(st.place).filter(function (v) { return v.id === id; })[0]; if (own) return own.label; if (VIEWS[id]) return VIEWS[id].label; var x = extraTool(id); return x ? str(x.label) || id : id; }

    /* ---- the elements layout() made: found again after every relayout ---- */
    function rootEl() { var r = call('root'); return r && typeof r.querySelector === 'function' ? r : null; }
    function els() {
      var r = rootEl(); if (!r) return null;
      if (st.els && st.els.root === r) return st.els;
      st.els = { root: r, row: r.querySelector('.gm-views'), chips: r.querySelector('.gm-vchips'), left: r.querySelector('#gm-left'), head: r.querySelector('#gm-vhead'), pane: r.querySelector('#gm-vpane') };
      Object.keys(st.bound).forEach(function (id) { var Wk = inlineHost(); if (Wk) { try { Wk.inline(id, null); } catch (e) { /* gone with the old page */ } } });
      st.bound = {}; st.sigs = {};          /* a relayout replaced the containers: nothing is bound any more */
      if (!r.__places) { r.__places = true; r.addEventListener('click', onClick); r.addEventListener('change', onChange); r.addEventListener('keydown', onKeyIn); }
      return st.els;
    }

    /* ---- the tool registry (N2) and the inline host: the shell's only way into a tool ---- */
    function toolCtl(id) {
      var T = W && W.B68GmTools, t = null;
      try { t = T && typeof T.get === 'function' ? T.get(id) : null; } catch (e) { t = null; }
      return t && typeof t.open === 'function' ? t : null;
    }
    function inlineHost() { var Wk = W && W.B68GmWorkshop; return Wk && typeof Wk.inline === 'function' ? Wk : null; }
    /* a tool into a container of the place: bound, then drawn by its own open(). escToo: Esc closes it (an extra view, which the GM brought in) */
    function bindTool(id, box, where, escToo) {
      if (!box) return false;
      var ctl = toolCtl(id), Wk = inlineHost(), drawn = false;
      if (ctl && Wk) {
        try {
          if (Wk.inline(id, box, { title: false, esc: !!escToo, onClose: function () { toolAsksClose(id, where); } })) {
            st.bound[id] = { el: box, where: where };
            drawn = ctl.open() !== false;
          }
        } catch (e) { if (W && W.console) W.console.error('places: ' + id + ' could not be drawn here', e); }
        if (drawn) return true;
        if (st.bound[id]) unbindTool(id);
      }
      box.innerHTML = fallbackHtml(id);
      return false;
    }
    /* unbound, unless something else has bound the same tool since (a tool is in one place at a time: the last to bind it has it) */
    function unbindTool(id) {
      var b = st.bound[id]; delete st.bound[id];
      var Wk = inlineHost(), mine = !!(b && b.el && b.el.querySelector && b.el.querySelector('[data-inline="' + id + '"]'));
      if (Wk && mine) { try { Wk.inline(id, null); } catch (e) { /* already gone */ } }
      if (b && b.el && b.el.innerHTML) b.el.innerHTML = '';
    }
    function unbindWhere(where, keep) { Object.keys(st.bound).forEach(function (id) { if (st.bound[id].where === where && (!keep || keep.indexOf(id) < 0)) unbindTool(id); }); }
    /* where a tool cannot be drawn inline: what it is, and its right-edge sheet */
    function fallbackHtml(id) {
      var v = VIEWS[id] || {};
      return '<div class="gm-vfall"><p class="gm-dim">' + esc(v.desc || '') + '</p><button type="button" class="btn sm" data-pv-open="' + esc(id) + '">' + esc(v.act || 'Open ' + (v.label || id)) + '</button></div>';
    }
    /* a tool drawn inline asked to close (its own Close): an extra view is dropped, a desk goes back to the desks; a place's own view stays */
    function toolAsksClose(id, where) {
      if (where !== 'view') return;
      if (st.extra && current() === st.extra) { dropExtra(); return; }
      if (st.place === 'between' && st.desk) { st.desk = ''; render({ jump: true }); }
    }

    /* ---- the root's attributes: which place, which left column ---- */
    function leftKind() { var k = DEF[st.place].left; return st.rollHere && k !== 'roll' ? 'roll' : k; }
    function paintRoot(e) {
      e.root.setAttribute('data-place', st.place);
      e.root.setAttribute('data-left', leftKind());
      if (e.root.classList) e.root.classList.toggle('roll-here', !!st.rollHere);
    }

    /* ---- the view switcher (a laptop) and the chip row (below 1100 px) ---- */
    function tabHtml(id, label, on, extra, pin) {
      var v = VIEWS[id] || {}, k = v.key ? ' <kbd>' + v.key + '</kbd>' : '';
      var t = '<button type="button" class="gm-vt' + (pin ? ' gm-vt-pin' : '') + (extra ? ' gm-vt-extra' : '') + (!pin && label.length > 9 ? ' gm-vt-long' : '') + '" role="tab" data-pv="' + esc(id) + '" aria-selected="' + on + '"' +
        (v.key ? ' aria-keyshortcuts="' + v.key + '"' : '') + ' title="' + esc((v.title || label) + (v.key ? ' (' + v.key + ')' : '') + (extra ? ': brought here from another place' : '')) + '"><span class="gm-vt-l">' + esc(label) + '</span>' + k + '</button>';
      return extra ? '<span class="gm-vt-xw">' + t + '<button type="button" class="gm-vt-x" data-pvx="' + esc(id) + '" aria-label="' + esc('Drop ' + label + ' from ' + placeLabel(st.place)) + '" title="Drop it from this place">×</button></span>' : t;
    }
    function chipHtml(id, label, on, extra) {
      var v = VIEWS[id] || {};
      var t = '<button type="button" class="chip gm-vc' + (extra ? ' gm-vc-extra' : '') + '" role="tab" data-pv="' + esc(id) + '" aria-selected="' + on + '" title="' + esc(label) + '">' + esc(v.short || label) + '</button>';
      return extra ? '<span class="gm-vc-xw">' + t + '<button type="button" class="chip gm-vc-x" data-pvx="' + esc(id) + '" aria-label="' + esc('Drop ' + label + ' from ' + placeLabel(st.place)) + '">×</button></span>' : t;
    }
    function paintRow(e) {
      var cur = current(), own = ownOf(st.place), ex = st.extra, d = DEF[st.place];
      if (e.row) {
        var h = own.map(function (v) { return tabHtml(v.id, v.label, cur === v.id); }).join('') + (ex ? tabHtml(ex, labelIn(ex), cur === ex, true) : '') +
          '<span class="gm-vsep" aria-hidden="true"></span>' + PINNED.map(function (id) { return tabHtml(id, VIEWS[id].label, cur === id, false, true); }).join('');
        if (st.sigs.row !== h) { st.sigs.row = h; e.row.innerHTML = h; e.row.setAttribute('aria-label', placeLabel(st.place) + ': views'); }
      }
      if (e.chips) {
        var roll = leftKind() === 'roll', seg = segNow() === 'console';
        var left = d.left === 'slim' ? '' : '<button type="button" class="chip gm-vc gm-vc-left" role="tab" data-gm="seg" data-seg="console" aria-selected="' + seg + '" title="' + esc(roll ? 'The Roll' : d.leftLabel) + '">' + esc(roll ? 'Roll' : d.short || d.leftLabel) + '</button>';
        var c = '<div class="gm-vc-own">' + left + own.map(function (v) { return chipHtml(v.id, v.label, !seg && cur === v.id); }).join('') + (ex ? chipHtml(ex, labelIn(ex), !seg && cur === ex, true) : '') + '</div>' +
          '<div class="gm-vc-pin">' + PINNED.map(function (id) { return chipHtml(id, VIEWS[id].label, !seg && cur === id); }).join('') +
          '<button type="button" class="chip gm-vc gm-vc-drawer" data-gm="seg" data-seg="state" title="Clocks and crew: the drawer (W)">Clocks</button></div>';
        if (st.sigs.chips !== c) { st.sigs.chips = c; e.chips.innerHTML = c; e.chips.setAttribute('aria-label', placeLabel(st.place) + ': views'); }
      }
    }
    function segNow() { var r = rootEl(); return r ? str(r.getAttribute('data-seg')) : ''; }

    /* ---- the left column ---- */
    function crewHtml() {
      var pcs = call('crew') || [];
      if (!pcs.length) return '<p class="gm-dim">No characters filed for this table yet.</p>';
      return '<ul class="gm-crew">' + pcs.map(function (c) {
        var bits = [];
        if (typeof c.stress === 'number') bits.push('<span class="gm-crew-k">Stress</span> ' + c.stress + '/9');
        if (c.harm && c.harm.length) bits.push('<span class="gm-crew-k">Harm</span> ' + c.harm.join(', '));
        if (c.locks) bits.push('<span class="gm-crew-k">Deadlocked</span> ' + c.locks);
        return '<li class="gm-crew-pc"><b class="gm-crew-n">' + esc(c.name || 'Unnamed') + '</b><span class="gm-crew-st">' + (bits.join(' · ') || '<span class="gm-dim">nothing marked</span>') + '</span>' +
          (c.turn && c.turn.length ? '<span class="gm-crew-turn" title="Three hits: the player can turn it before a roll">Can turn: ' + esc(c.turn.join(', ')) + '</span>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    function factsNow() { return facts(call('prepNote'), W && W.B68GmNight, W && W.B68GmCueStack); }
    /* one time field: the night's own time (or the note's, until the GM sets one), and the note's under it while the two differ */
    function timeHtml(key, label, mine, noteAt) {
      var shown = mine || noteAt || '', differs = !!mine && mine !== noteAt;
      return '<div class="gm-tn-time"><label class="gm-lab">' + label + '<input type="time" class="gm-tn-input" data-tn-time="' + key + '" value="' + esc(shown) + '"></label>' +
        (differs ? '<span class="gm-dim gm-tn-from">' + (noteAt ? 'from the prep note: ' + esc(noteAt) : 'the prep note has none') + '</span><button type="button" class="btn sm" data-tn-prep="' + key + '">Use the prep’s</button>'
          : (shown ? '' : '<span class="gm-dim gm-tn-from">no ' + label.toLowerCase() + ' line in the note</span>')) + '</div>';
    }
    function factsHtml(f) {
      if (!f.title) return '<p class="gm-dim">No prep note in the pack: Tonight reads the open note’s start, curfew, cues and rooms.</p>';
      var t = call('nightTimes') || {};
      return '<p class="gm-tn-title">' + esc(f.title) + '</p>' + timeHtml('startAt', 'Start', t.startAt, f.start) + timeHtml('curfewAt', 'Curfew', t.curfewAt, f.curfew) +
        '<p class="gm-tn-line"><b>' + f.cues + '</b> cue' + (f.cues === 1 ? '' : 's') + ' · <b>' + f.rooms + '</b> room' + (f.rooms === 1 ? '' : 's') + '</p>';
    }
    function leftHtml() {
      var id = st.place;
      if (id === 'before') return '<section class="gm-box gm-lbox"><h3 class="gm-band">Preflight</h3><div class="gm-lbody gm-ltool" data-left-tool="preflight"></div></section>' +
        '<section class="gm-box gm-lbox"><h3 class="gm-band">Tonight</h3><div class="gm-lbody" data-left-slot="facts"></div></section>';
      if (id === 'opening') return '<section class="gm-box gm-lbox"><h3 class="gm-band">Hard start</h3><div class="gm-lbody gm-ltool" data-left-tool="hardstart"></div></section>' +
        '<p class="gm-dim gm-lnote">Personal business ends the Opening: the next place in the band, or a <code>phase:</code> cue.</p>';
      if (id === 'after') return '<section class="gm-box gm-lbox"><h3 class="gm-band">The crew</h3><div class="gm-lbody" data-left-slot="crew"></div></section>' +
        '<div class="gm-lacts"><button type="button" class="btn" data-pv="debrief" title="The steps not reached go to each phone as a card the next morning">Debrief: send to phones</button>' +
        '<button type="button" class="btn" data-pv="castphoto" title="The cast line-up, at the end of an arc">Cast photo</button>' +
        '<button type="button" class="btn primary" data-pv-end="1" title="Exports tonight’s note, stops the recording, then ends the night for the players (it asks first)">End the night</button></div>';
      if (id === 'between') return '<nav class="gm-desklist" aria-label="Desks">' + DESKS.map(function (d) {
        var on = st.desk === d.id || st.desk.indexOf(d.id + ':') === 0;
        return '<button type="button" class="gm-desklink" data-desk="' + d.id + '"' + (on ? ' aria-current="true"' : '') + '>' + esc(d.label || (VIEWS[d.id] || {}).label || d.id) + '</button>';
      }).join('') + '</nav>';
      return '';
    }
    function paintLeft(e) {
      if (!e.left) return;
      var d = DEF[st.place], tool = LEFT_TOOL[st.place] || '';
      if (d.left === 'roll') { unbindWhere('left'); if (e.left.innerHTML) e.left.innerHTML = ''; st.sigs.left = ''; e.left.hidden = true; return; }
      e.left.hidden = false;
      e.left.setAttribute('aria-label', placeLabel(st.place) + ': ' + d.leftLabel);
      var shell = st.place + '|' + st.desk + '|' + (st.rollHere ? 'roll' : 'own');
      if (st.sigs.left !== shell) {
        unbindWhere('left');
        st.sigs.left = shell; st.sigs.slot = '';
        e.left.innerHTML = st.rollHere ? '<button type="button" class="gm-left-back" data-left-back="1" title="Back to ' + esc(d.leftLabel) + ' (the Roll stays a key away: 1 to 4)">◂ ' + esc(d.leftLabel) + '</button>' : leftHtml();
        if (tool && !st.rollHere) bindTool(tool, e.left.querySelector('[data-left-tool]'), 'left');
      }
      if (!st.rollHere) {
        var slot = e.left.querySelector('[data-left-slot]');
        if (slot) { var h = slot.getAttribute('data-left-slot') === 'facts' ? factsHtml(factsNow()) : crewHtml(); if (st.sigs.slot !== h) { st.sigs.slot = h; slot.innerHTML = h; } }
      }
    }

    /* ---- the strip over a view: Between's open desk ---- */
    function deskOf(id) { var k = str(id).split(':')[0]; return DESKS.filter(function (d) { return d.id === k; })[0] || null; }
    function deskTitle(id) {
      var d = deskOf(id); if (!d) return '';
      var pane = str(id).split(':')[1];
      return pane ? (d.panes.filter(function (p) { return p[0] === pane; }).map(function (p) { return p[1] + ' generator'; })[0] || d.label) : d.label || (VIEWS[d.id] || {}).label || d.id;
    }
    function paintHead(e) {
      if (!e.head) return;
      var on = st.place === 'between' && current() === 'desks' && !!deskOf(st.desk);
      var h = on ? '<button type="button" class="btn sm gm-vhead-back" data-pv-desks="1">← Desks</button><span class="gm-vhead-t">' + esc(deskTitle(st.desk)) + '</span>' : '';
      if (st.sigs.head !== h) { st.sigs.head = h; e.head.innerHTML = h; }
      e.head.hidden = !h;
    }

    /* ---- the view ---- */
    function deskGrid() {
      return '<div class="gm-desks">' + DESKS.map(function (d) {
        var v = VIEWS[d.id] || {}, label = d.label || v.label || d.id;
        if (d.panes) return '<div class="gm-desk gm-desk-gen"><b class="gm-desk-t">' + esc(label) + '</b><span class="gm-desk-d">' + esc(d.desc) + '</span><span class="gm-desk-acts">' +
          d.panes.map(function (p) { return '<button type="button" class="btn sm" data-desk="gen:' + p[0] + '">' + esc(p[1]) + '</button>'; }).join('') + '</span></div>';
        return '<button type="button" class="gm-desk" data-desk="' + d.id + '"><b class="gm-desk-t">' + esc(label) + '</b><span class="gm-desk-d">' + esc(v.desc || '') + '</span></button>';
      }).join('') + '</div>';
    }
    function tonightHtml() {
      var f = factsNow(), notes = call('prepNotes') || [], note = call('prepNote'), secs = call('prepSecs') || [];
      if (!note) return '<p class="gm-empty">No prep notes in the pack yet. In Obsidian, add the property <code>gm_prep: true</code> to a session note, then run <code>npm run gm:pack</code> and push the pack (or Update pack).</p>';
      var pick = notes.length > 1 ? '<label class="gm-field gm-tn-pick"><span class="gm-lab">The night’s note</span><select data-pv-note="1">' + notes.map(function (n) { return '<option value="' + esc(n.id) + '"' + (n.id === note.id ? ' selected' : '') + '>' + esc(n.title) + '</option>'; }).join('') + '</select></label>'
        : '<p class="gm-tn-title">' + esc(note.title) + '</p>';
      /* tonight's times: the GM's own (the Tonight box) where set, else the note's; the note's in brackets while they differ */
      var nt = call('nightTimes') || {}, tm = function (word, mine, noteAt, none) {
        var shown = mine || noteAt; if (!shown) return none;
        return word + ' <b>' + esc(shown) + '</b>' + (mine && noteAt && mine !== noteAt ? ' <span class="gm-dim">(the note: ' + esc(noteAt) + ')</span>' : '');
      };
      var times = '<p class="gm-tn-line">' + [tm('Start', nt.startAt, f.start, 'No <code>start:</code> line'), tm('curfew', nt.curfewAt, f.curfew, 'no <code>curfew:</code> line'), '<b>' + f.cues + '</b> cue' + (f.cues === 1 ? '' : 's'), '<b>' + f.rooms + '</b> room' + (f.rooms === 1 ? '' : 's')].join(' · ') + '</p>';
      var rows = f.rows.length ? '<table class="gm-tbl gm-tn-run"><thead><tr><th>#</th><th>Beat</th><th>Place</th><th class="num">Min</th></tr></thead><tbody>' + f.rows.map(function (r, i) {
        return '<tr><td>' + (i + 1) + '</td><td>' + esc(r.beat) + '</td><td>' + esc(placeLabel(r.place) || '—') + '</td><td class="num">' + (r.min || '') + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="gm-dim">No run order in the note: a table with a <code>#</code> column and an About, Time, Budget or Length column.</p>';
      var mine = secs.filter(function (s) { return holds(s.head, 'before the night') || holds(s.head, 'tonight'); });
      var secHtml = mine.length ? mine.map(function (s) {
        var body = ''; try { body = s.html(); } catch (e) { body = ''; }
        return '<section class="gm-box gm-tn-sec" data-sec="' + esc(s.id) + '"><h3 class="gm-band">' + esc(s.head) + '</h3><div class="pp-doc gm-tn-doc">' + body + '</div></section>';
      }).join('') : '<section class="gm-box gm-tn-sec"><h3 class="gm-band">Before the night</h3><p class="gm-dim">The note has no “Before the night” or “Tonight” section: Prep holds the whole note.</p></section>';
      return '<div class="gm-tonight"><section class="gm-box gm-tn-note"><h3 class="gm-band">The night’s note</h3><div class="gm-tn-body">' + pick + times + rows +
        '<p class="gm-tn-acts"><button type="button" class="btn sm" data-pv="prep">The whole note in Prep <kbd>R</kbd></button></p></div></section><div class="gm-tn-secs">' + secHtml + '</div></div>';
    }
    function tonightSig() { var n = call('prepNote'), nt = call('nightTimes') || {}; return JSON.stringify([n ? n.id : '', (call('prepSecs') || []).map(function (s) { return s.id; }), factsNow(), nt.startAt || '', nt.curfewAt || '']); }
    function fillPane(e, id) {
      var v = VIEWS[id], x = !v ? extraTool(id) : null;
      unbindWhere('view', v && v.tool ? [v.tool] : v && v.tools ? v.tools : []);
      var sig = 'v|' + id;
      if (v && v.tool) {
        if (st.sigs.pane !== sig || !st.bound[v.tool]) { st.sigs.pane = sig; e.pane.innerHTML = '<div class="gm-vtool" data-vtool="' + esc(v.tool) + '"></div>'; bindTool(v.tool, e.pane.querySelector('[data-vtool]'), 'view', id === st.extra); }
        return;
      }
      if (v && v.tools) {
        if (st.sigs.pane !== sig || v.tools.some(function (t) { return !st.bound[t]; })) {
          st.sigs.pane = sig;
          e.pane.innerHTML = '<div class="gm-vgrid">' + v.tools.map(function (t) { return '<section class="gm-box gm-vcell" data-vcell="' + t + '"><h3 class="gm-band">' + esc(VIEWS[t].label) + '</h3><div class="gm-vcell-body" data-vtool="' + t + '"></div></section>'; }).join('') + '</div>';
          v.tools.forEach(function (t) { bindTool(t, e.pane.querySelector('[data-vtool="' + t + '"]'), 'view'); });
        }
        return;
      }
      if (v && v.build === 'tonight') { var ts = 'tonight|' + tonightSig(); if (st.sigs.pane !== ts) { st.sigs.pane = ts; e.pane.innerHTML = tonightHtml(); decorate(e.pane); } return; }
      if (v && v.build === 'desks') { if (st.sigs.pane !== 'desks') { st.sigs.pane = 'desks'; e.pane.innerHTML = deskGrid(); } return; }
      if (x) {
        st.sigs.pane = 'x|' + id; e.pane.innerHTML = '<div class="gm-vtool" data-vtool="' + esc(id) + '"></div>';
        try { x.mount(e.pane.querySelector('[data-vtool]'), { toast: toast }); } catch (err) { e.pane.textContent = (str(x.label) || id) + ' could not open: ' + str(err && err.message); }
      }
    }
    function decorate(el) { if (el) call('decorate', el); }
    function toTop(el) { if (!el) return; try { el.scrollTop = 0; } catch (e) { /* not a scroller */ } }
    function into(el) { if (el && typeof el.scrollIntoView === 'function') { try { el.scrollIntoView({ block: 'start' }); } catch (e) { el.scrollIntoView(); } } }
    function prepAt(wordList) {
      var r = rootEl(), pane = r && r.querySelector('#gm-prep'); if (!pane) return;
      var secs = call('prepSecs') || [], i = prepTarget(st.place, secs.map(function (s) { return s.head; }), wordList);
      var el = i >= 0 ? pane.querySelector('[id="' + str(secs[i].id).replace(/"/g, '') + '"]') : null;
      if (el) into(el); else toTop(pane);
    }
    function anchorTo(sels) {
      var r = rootEl(); if (!r) return;
      for (var i = 0; i < sels.length; i++) { var el = null; try { el = r.querySelector(sels[i]); } catch (e) { el = null; } if (el) { into(el); return; } }
    }
    function showDesk(e) {
      var d = deskOf(st.desk); if (!d) { st.desk = ''; return false; }
      if (!e.pane) return false;
      var pane = st.desk.indexOf(':') > 0 ? st.desk.split(':')[1] : '';
      if (pane) { unbindWhere('view'); st.sigs.pane = ''; call('showPane', pane); return true; }
      var sig = 'desk|' + d.id;
      if (st.sigs.pane !== sig || !st.bound[d.id]) { unbindWhere('view', [d.id]); st.sigs.pane = sig; e.pane.innerHTML = '<div class="gm-vtool" data-vtool="' + d.id + '"></div>'; bindTool(d.id, e.pane.querySelector('[data-vtool]'), 'view'); }
      call('showPane', 'view');
      return true;
    }
    function showView(o) {
      var e = els(); if (!e) return;
      var id = current(), v = VIEWS[id];
      if (id === 'desks' && st.desk && showDesk(e)) return;
      if (v && v.pane) {
        unbindWhere('view', v.slot ? [v.slot.tool] : []);
        st.sigs.pane = '';
        call('showPane', v.pane);
        if (v.slot) { var box = e.root.querySelector(v.slot.sel); if (box && !(st.bound[v.slot.tool] && st.bound[v.slot.tool].el === box)) bindTool(v.slot.tool, box, 'view'); }
        if (o && o.jump && v.pane === 'prep') prepAt(v.prepWords);
        if (o && o.jump && v.anchor) anchorTo(v.anchor);
        return;
      }
      if (e.pane) { fillPane(e, id); call('showPane', 'view'); if (o && o.jump) toTop(e.pane); }
    }
    function render(o) {
      var e = els(); if (!e) return;
      st.busy++;
      try { paintRoot(e); paintLeft(e); paintHead(e); showView(o || {}); paintRow(e); } finally { st.busy--; }
    }

    /* ---- the contract: the band (N1a), the keys, Find ---- */
    function leave() {
      if (st.extra) { if (st.views[st.place] === st.extra) st.views[st.place] = st.prior || ''; st.extra = ''; st.prior = ''; }
      st.desk = ''; st.rollHere = false;
    }
    function goPlace(id, o) {
      o = o || {};
      if (!isPlace(id)) return false;
      var p = base(id), moved = id !== st.place, reading = current() === 'prep' && id !== 'between';   /* Prep stays with the GM through the night; Between opens at its desks */
      if (moved) { leave(); st.place = id; if (reading) st.views[id] = 'prep'; }
      if (p.phase && !o.navigateOnly && phaseNow() !== p.phase) { st.busy++; try { call('enter', p.phase); } finally { st.busy--; } }
      st.phase = phaseNow();
      writeStore();
      render({ jump: moved });
      if (moved) call('seg', 'side');
      return true;
    }
    /* where a place already lays a tool out: its left column, a view of its own that holds it, Between's desk */
    function holder(pl, id) {
      if (LEFT_TOOL[pl] === id) return { left: true };
      var own = ownOf(pl).filter(function (v) { var row = VIEWS[v.id]; return v.id !== id && row && ((row.tools && row.tools.indexOf(id) >= 0) || (row.slot && row.slot.tool === id)); })[0];
      if (own) return { view: own.id };
      if (pl === 'between' && !lists(pl, id)) { if (deskOf(id)) return { desk: id }; if (id === 'score' || id === 'location') return { desk: 'gen:' + id }; }
      return null;
    }
    function openView(id, o) {
      o = o || {};
      var asked = str(id); id = asked;
      if (id === 'console') { if (DEF[st.place].left === 'slim') return false; call('seg', 'console'); return true; }
      if (id === 'view') return true;
      if (!known(id)) return false;
      var was = current(), h = holder(st.place, id);
      if (h && h.left) { if (st.rollHere) { st.rollHere = false; render(); } call('seg', 'console'); flash(rootEl() && rootEl().querySelector('#gm-left')); return true; }
      if (h && h.desk) { st.views.between = 'desks'; st.desk = h.desk; writeStore(); render({ jump: true }); call('seg', 'side'); return true; }
      if (h && h.view) id = h.view;
      if (!lists(st.place, id) && st.extra !== id) { if (current() !== st.extra || !st.extra) st.prior = was; st.extra = id; }
      st.views[st.place] = id;
      if (st.place === 'between' && (id !== 'desks' || o.row)) st.desk = '';
      writeStore();
      render({ jump: o.jump !== false && (was !== id || !!o.again) });
      call('seg', 'side');
      if (h && h.view) { var r = rootEl(), cell = r && r.querySelector('[data-vcell="' + asked.replace(/"/g, '') + '"]'); if (!cell && VIEWS[id].slot && r) cell = r.querySelector(VIEWS[id].slot.sel); flash(cell); }
      return true;
    }
    function dropExtra() {
      if (!st.extra) return false;
      var showing = current() === st.extra;
      st.extra = '';
      if (showing) st.views[st.place] = st.prior || '';
      st.prior = '';
      writeStore();
      render({ jump: showing });
      return true;
    }
    function stepPlace(dir) { return goPlace(step(st.place, dir), { navigateOnly: true }); }
    /* the curfew's Call the Aftermath: the phase, the place, the show, started */
    function callAftermath() {
      if (phaseNow() !== 'after') { st.busy++; try { call('enter', 'after'); } finally { st.busy--; } }
      goPlace('after', { navigateOnly: true });
      openView('aftermath');
      return startShow();
    }
    function startShow() {
      var ctl = toolCtl('aftermath');
      if (ctl && typeof ctl.start === 'function') { try { ctl.start(); return true; } catch (e) { /* the button, below */ } }
      var r = rootEl(), boxes = [];
      if (st.bound.aftermath && st.bound.aftermath.el) boxes.push(st.bound.aftermath.el);
      var sh = r && r.querySelector('#gm-sheet-aftermath');
      if (!boxes.length && !(sh && !sh.hidden)) { call('sheetOpen', 'aftermath'); sh = r && r.querySelector('#gm-sheet-aftermath'); }
      if (sh && !sh.hidden) boxes.push(sh);
      for (var i = 0; i < boxes.length; i++) {
        var bs = boxes[i].querySelectorAll ? boxes[i].querySelectorAll('button') : [];
        for (var j = 0; j < bs.length; j++) if (/^\s*Start the Aftermath\s*$/i.test(str(bs[j].textContent))) { bs[j].click(); return true; }
      }
      return false;       /* started already (it resumes at its step), or not here: the GM sees the show and steers */
    }
    /* a roll (the page's card stamp calls this) in a place whose left column is its own: the Roll comes into the column for the rest of the stay,
       with a strip back to the column on top */
    function rolled() {
      if (st.gone || DEF[st.place].left !== 'own' || st.rollHere) return;
      st.rollHere = true; render();
    }
    function flash(el) {
      if (!el || !el.classList) return;
      el.classList.add('gm-flash');
      if (st.flashT && W && W.clearTimeout) W.clearTimeout(st.flashT);
      st.flashT = W && W.setTimeout ? W.setTimeout(function () { if (el.classList) el.classList.remove('gm-flash'); }, 1700) : null;
    }

    /* ---- sync: on every state arrival and every pane switch. Follows the night; keeps the switcher and the left column true ---- */
    function sync() {
      if (st.gone || st.busy) return;
      var e = els(); if (!e) return;
      var ph = phaseNow();
      if (ph !== st.phase) {
        st.phase = ph;
        var to = forPhase(ph);
        if (to && to !== st.place && st.place !== 'between') { goPlace(to, { navigateOnly: true }); return; }
        writeStore();
      }
      st.busy++;
      try {
        paintRoot(e); paintLeft(e); paintHead(e); paintRow(e);
        if (current() === 'tonight' && e.pane && !e.pane.hidden) {
          if (st.sigs.pane !== 'tonight|' + tonightSig() && !focusIn(e.pane)) fillPane(e, 'tonight'); else decorate(e.pane);
        }
      } finally { st.busy--; }
    }
    function focusIn(el) { var d = W && W.document, a = d && d.activeElement; return !!(a && a !== d.body && el.contains && el.contains(a)); }

    /* ---- events inside the page (the page's own click handler leaves these alone: none carries data-gm) ---- */
    function onClick(ev) {
      var t = ev.target; if (!t || !t.closest) return;
      var b, row;
      if ((b = t.closest('[data-tn-prep]'))) { ev.preventDefault(); call('usePrep', b.getAttribute('data-tn-prep')); st.sigs.slot = ''; later(function () { render(); }); return; }
      if ((b = t.closest('[data-pvx]'))) { ev.preventDefault(); dropExtra(); return; }
      if ((b = t.closest('[data-pv]'))) {
        ev.preventDefault();
        var id = b.getAttribute('data-pv'); row = !!b.closest('.gm-views, .gm-vchips');
        openView(id, { row: row, again: row && id === 'prep' && current() === 'prep' });
        return;
      }
      if ((b = t.closest('[data-desk]'))) { ev.preventDefault(); st.views.between = 'desks'; st.desk = b.getAttribute('data-desk'); writeStore(); render({ jump: true }); call('seg', 'side'); return; }
      if ((b = t.closest('[data-pv-desks]'))) { ev.preventDefault(); st.desk = ''; render({ jump: true }); return; }
      if ((b = t.closest('[data-pv-open]'))) { ev.preventDefault(); if (!call('sheetOpen', b.getAttribute('data-pv-open'))) toast('That tool could not open here.', true); return; }
      if ((b = t.closest('[data-left-back]'))) { ev.preventDefault(); st.rollHere = false; render(); return; }
      if ((b = t.closest('[data-pv-end]'))) { ev.preventDefault(); endNight(); return; }
      if (t.closest('.rl-task[data-task], td[data-cell]') && t.closest('#gm-vpane')) later(redecorate);
    }
    function onChange(ev) {
      var t = ev.target;
      var key = t && t.getAttribute ? t.getAttribute('data-tn-time') : '';
      if (key) {      /* the Tonight box: a time written to the night; an emptied field puts the note's back */
        if (t.value) call('setTime', key, t.value); else call('usePrep', key);
        st.sigs.slot = ''; later(function () { render(); var n = els(), f = n && n.left && n.left.querySelector('[data-tn-time="' + key + '"]'); if (f && f.focus && !focusIn(n.left)) { try { f.focus(); } catch (x) {} } });
        return;
      }
      if (!t || !t.getAttribute || !t.getAttribute('data-pv-note')) return;
      call('setPrepNote', t.value); st.sigs.pane = ''; st.sigs.slot = '';
      later(function () { render(); });
    }
    function onKeyIn(ev) { if ((ev.key === ' ' || ev.key === 'Enter') && ev.target && ev.target.closest && ev.target.closest('#gm-vpane')) later(redecorate); }
    function redecorate() { var e = els(); if (e && e.pane) decorate(e.pane); }
    function later(fn) { if (W && typeof W.setTimeout === 'function') W.setTimeout(function () { if (!st.gone) fn(); }, 0); else fn(); }
    function endNight() {
      call('exportTonight');      /* first: harmless, and it keeps the click's activation for the save picker */
      /* the mission's End the night asks first; the recording stops only once the GM has said yes (a No leaves the night running and recording) */
      Promise.resolve(call('endNight')).then(function (r) { if (r && r.skipped === 'declined') return; if (call('recording')) call('stopRecording'); }, function () {});
    }

    /* Esc (gm/esc.js): an open desk is an in-view panel; Esc goes back to the desks */
    (function escape() {
      var E = W && W.B68GmEsc; if (!E || typeof E.register !== 'function') return;
      try { st.escOff = E.register('places.desk', { priority: 40, isOpen: function () { return !st.gone && st.place === 'between' && current() === 'desks' && !!st.desk; }, close: function () { st.desk = ''; render({ jump: true }); } }); } catch (e) { st.escOff = null; }
    })();

    function mount() { st.els = null; if (!els()) return; st.phase = phaseNow(); render({ jump: true }); }
    function destroy() {
      st.gone = true;
      Object.keys(st.bound).forEach(unbindTool);
      if (st.escOff) { try { st.escOff(); } catch (e) { /* gone */ } }
      if (st.flashT && W && W.clearTimeout) W.clearTimeout(st.flashT);
    }

    return {
      mount: mount, sync: sync, goPlace: goPlace, openView: openView, dropExtra: dropExtra, callAftermath: callAftermath, stepPlace: stepPlace, rolled: rolled,
      currentPlace: function () { return st.place; }, currentView: function () { return current(); },
      findEntries: function () { var T = W && W.B68GmTools, ex = []; try { ex = T && typeof T.extras === 'function' ? T.extras() : []; } catch (e) { ex = []; } return findEntries(ex); },
      destroy: destroy,
      _state: function () { return { place: st.place, view: current(), extra: st.extra, desk: st.desk, rollHere: st.rollHere, phase: st.phase, views: JSON.parse(JSON.stringify(st.views)), bound: Object.keys(st.bound).sort() }; }
    };
  }

  return { KEY: KEY, PLACES: PLACES, BETWEEN: BETWEEN, PINNED: PINNED, VIEWS: VIEWS, DESKS: DESKS, LEFT_TOOL: LEFT_TOOL,
    list: list, between: between, place: place, view: view, viewsOf: viewsOf, lists: lists, forPhase: forPhase, step: step, prepTarget: prepTarget,
    placeOfText: placeOfText, roomsOf: roomsOf, facts: facts, findEntries: findEntries, homeOf: homeOf, restore: restore, create: create };
});
