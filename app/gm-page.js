/* gm-page.js — the GM's page (#gm, GM.md): the console (the four Situations; the nine single tables fold under the card), the location generator
   with its map, the cast as a list to push to the iPad, the state rail (crew, clocks, bargains owed, pins, who is on stage) and
   the capture bar. S opens the street scene roller beside the location generator (a side panel), and
   D the downtime cards (personal business: a scene prompt per activity a PC takes, an overindulgence's cost), and
   A the Blade side panel (gm/assist-panel.js: the table agent's cards, Ask, the Fixer and the Screen; a tab on the right edge; laptop only).
   Hosted build only (window.claude.gm); in the claude.ai artifact, or for a player, the page says so and does nothing.

   window.B68GmPage (boot.js):
     open(root, api)   draw into `root` (boot calls it when the mode becomes `gm`)
     close()           flush the pending state write, drop listeners
     campaign(doc)     the campaign document changed (crew, clocks, session, scene)
     characters()      the filed characters changed (the Downtime panel reads api.characters() again)
     purge()           forget every GM pack cached in this browser (boot calls it when the viewer is not the GM)
   api = { ready() -> Promise, isGM() -> bool, me() -> id, gm() -> window.claude.gm | null, db() -> db | null,
           campaign() -> doc | null, saveFile(name, data), copy(text, okMessage),
           characters() -> [slim PC], addClock(clock) -> Promise (both optional: the Downtime panel) }

   Where things live. The pack (the generators' tables, GM-only text) comes from GET /api/gm/pack and is cached in
   IndexedDB only (db `b68-gm`, store `kv`, key `pack:<userId>`): never localStorage, the artifact db or Cache Storage.
   The GM state document (GET/PATCH /api/gm/state) holds the live controls, the current card per tool as replay info
   ({seed, ui, mem-before}, never the card), the last five rolls per tool, pins, capture and the console's bargains;
   patches are maps (null deletes), debounced 800 ms. `b68.gm.sticky` in localStorage mirrors the live controls and the
   current cards (replay info only) so a reload draws at once, and keeps two kinds of change that have not gone: `parked` (a patch
   the server refused: never resent) and `pending` (what could not be sent because the Access session ended: sent once on the next
   open). Capture has a byte budget of its own; a roll is never refused for it. Nothing from capture is written to the campaign log.

   Safety. Pack text and cards reach the page through B68Markdown.render (which escapes all HTML) or esc(); there is no
   eval. Only a player-layer map render, made here, can be sent to the display (`gate`, checks/runtime/gm-nosecrets
   and gm.e2e.mjs test it). The pure helpers are exported for Node as module.exports._pure. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmPage = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  /* =====================================================================================================================
     Pure helpers (no DOM)
     ===================================================================================================================== */
  var P = {};
  /* captureBytes: what the capture lines may take of the state document (E18), well under the soft cap so a roll always has room */
  var LIMITS = P.LIMITS = { hist: 5, pins: 50, capture: 400, captureText: 500, captureBytes: 128 * 1024, stateSoft: 240 * 1024, stateCap: 256 * 1024, debounce: 800, staleDays: 3, partBytes: 900 * 1024, parts: 12 };
  var BANDS = P.BANDS = ['public', 'working', 'controlled', 'secure'];
  var BUCKETS = P.BUCKETS = [
    { k: 'n', label: 'Name', head: 'Names', key: 'P' },
    { k: 'x', label: 'Loose end', head: 'Loose ends', key: 'X' },
    { k: 'm', label: 'Moment', head: 'Moments', key: 'M' },
    { k: 'r', label: 'Rolled', head: 'Rolled at the table', key: 'L' }
  ];
  /* the map's controls (GM.md, "Location"): iso first, the view the table plays with (map kit ROADMAP, decision 17/10); the street
     outside (kit 0.5) and the lit plate (kit 0.7). Time and weather are the kit's: '' leaves them to the roll (the plate draws the
     roll's weather, the other themes draw it on the street only when asked) */
  var VIEWS = P.VIEWS = ['iso', 'rings', 'plan', 'section', 'street'], THEMES = P.THEMES = ['rulebook', 'blueprint', 'casefile', 'board', 'plate'];
  P.TIMES = [['', 'As rolled'], ['Bluetime', 'At Bluetime'], ['Night', 'At Night']];
  P.WEATHERS = [['', 'As the theme does'], ['rolled', "The roll's"], ['none', 'None'], ['rain', 'Rain'], ['fog', 'Fog'], ['snow', 'Snow']];
  P.MAP0 = { view: 'iso', theme: 'rulebook', layer: 'gm', time: '', weather: '', reveal: { public: true } };
  /* The iPad's copy of a map: the display page shows it at 1366 x 1024 (landscape). Map kit 0.8's layout "ipad" is drawn for that:
     1366 px wide, the type floor 16 px, the key beside the drawing (the street, which has no layouts, takes its width from it). */
  P.IPAD_MAP = { layout: 'ipad' };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nowIso() { return new Date().toISOString(); }
  function uid(p) { return p + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36); }
  function slug(s) { return str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'roll'; }
  P.isObj = isObj; P.clone = clone; P.esc = esc; P.slug = slug;

  /* the server's PATCH: plain objects merge, arrays and scalars replace, null deletes (GM.md) */
  function applyPatch(doc, patch) {
    var out = isObj(doc) ? clone(doc) : {};
    Object.keys(patch || {}).forEach(function (k) {
      var v = patch[k];
      if (v === null || v === undefined) delete out[k];
      else if (isObj(v)) out[k] = applyPatch(isObj(out[k]) ? out[k] : {}, v);
      else out[k] = clone(v);
    });
    return out;
  }
  /* two pending patches as one: sending the result equals sending a, then b (a key nulled and then set to an object is
     sent as the object; ids here are never reused, so that case does not arise) */
  function mergePatch(a, b) {
    var out = isObj(a) ? clone(a) : {};
    Object.keys(b || {}).forEach(function (k) {
      var v = b[k];
      if (isObj(v) && isObj(out[k])) out[k] = mergePatch(out[k], v);
      else out[k] = v === undefined ? null : clone(v);
    });
    return out;
  }
  /* the patch that makes `old` become exactly `now` under the server's merge: now's values, and null for every key only `old` has
     (a plain merge would keep them: a stored card that was a table roll (phys) would stay one under an app roll's seed) */
  function replacePatch(old, now) {
    var o = isObj(old) ? old : {}, n = isObj(now) ? now : {}, out = {};
    Object.keys(o).forEach(function (k) { if (!(k in n)) out[k] = null; });
    Object.keys(n).forEach(function (k) { out[k] = isObj(n[k]) && isObj(o[k]) ? replacePatch(o[k], n[k]) : clone(n[k]); });
    return out;
  }
  P.applyPatch = applyPatch; P.mergePatch = mergePatch; P.replacePatch = replacePatch;

  /* entries of a map { id: { at } } newest first */
  function newest(map) {
    return Object.keys(isObj(map) ? map : {}).filter(function (k) { return isObj(map[k]); })
      .map(function (k) { return Object.assign({ _id: k }, map[k]); })
      .sort(function (a, b) { return str(a.at) < str(b.at) ? 1 : str(a.at) > str(b.at) ? -1 : (a._id < b._id ? 1 : -1); });
  }
  P.newest = newest;
  /* the patch that adds `entry` under `id` to `map` and drops the oldest past `max` */
  function addCapped(map, id, entry, max) {
    var p = {}; p[id] = entry;
    var after = Object.assign({}, isObj(map) ? map : {}); after[id] = entry;
    newest(after).slice(max).forEach(function (e) { p[e._id] = null; });
    return p;
  }
  P.addCapped = addCapped;

  /* the pack file (npm run gm:pack, format 1) -> { ok, errors, parts: [{ name, bytes, src }], exportedAt } */
  var PART_RE = /^[a-z0-9-]{1,32}$/;
  function bytesOf(s) { try { return new TextEncoder().encode(s).length; } catch (e) { return unescape(encodeURIComponent(s)).length; } }
  function validatePack(pk) {
    var errors = [], parts = [];
    if (!isObj(pk)) return { ok: false, errors: ['That file is not a GM pack (not a JSON object).'], parts: parts, exportedAt: null };
    if (pk.format !== 1) errors.push('Unknown pack format ' + JSON.stringify(pk.format) + ': expected 1. Rebuild it with npm run gm:pack.');
    var ps = isObj(pk.parts) ? pk.parts : null;
    if (!ps) errors.push('The pack has no parts.');
    else {
      ['console', 'location'].forEach(function (n) {
        if (!isObj(ps[n])) errors.push('The pack has no ' + n + ' part.');
        else if (!isObj(ps[n].T)) errors.push('The ' + n + ' part has no tables (T).');
      });
      var names = Object.keys(ps);
      if (names.length > LIMITS.parts) errors.push('Too many parts (' + names.length + ', at most ' + LIMITS.parts + ').');
      names.forEach(function (n) {
        if (!PART_RE.test(n)) { errors.push('Part name ' + JSON.stringify(n) + ' is not allowed.'); return; }
        if (!isObj(ps[n])) { errors.push('Part ' + n + ' is not an object.'); return; }
        var body = partBody(ps[n]), b = bytesOf(JSON.stringify(body));
        if (b > LIMITS.partBytes) errors.push('Part ' + n + ' is too large (' + Math.round(b / 1024) + ' KiB, at most 900).');
        parts.push({ name: n, bytes: b, src: isObj(ps[n].src) ? ps[n].src : {} });
      });
    }
    return { ok: !errors.length, errors: errors, parts: parts, exportedAt: typeof pk.exportedAt === 'string' ? pk.exportedAt : null };
  }
  function partBody(part) { var b = {}; Object.keys(part || {}).forEach(function (k) { if (k !== 'src') b[k] = part[k]; }); return b; }
  /* one POST /api/gm/pack per part */
  function partRequests(pk) { return Object.keys(pk.parts).map(function (n) { return { part: n, src: isObj(pk.parts[n].src) ? pk.parts[n].src : {}, body: partBody(pk.parts[n]) }; }); }
  /* the assist part is pushed from the PC (gm:sync uploads its prefix to Anthropic and pushes only a file id). A local pack keeps the text, so the
     in-app upload leaves that part alone: the server refuses the text form, and the good small part there must not be replaced or removed. */
  function skippedParts(pk) { var a = pk && isObj(pk.parts) ? pk.parts.assist : null; return isObj(a) && typeof a.prefix === 'string' ? ['assist'] : []; }
  P.validatePack = validatePack; P.partBody = partBody; P.partRequests = partRequests; P.skippedParts = skippedParts;

  /* the bands the player layer reveals: public, plus what the GM ticked, and only while Layer is Player (on the GM layer
     the ticks are kept but nothing beyond public counts) */
  function revealList(map) {
    if (!isObj(map) || map.layer !== 'player') return ['public'];
    var r = isObj(map.reveal) ? map.reveal : {};
    return BANDS.filter(function (b) { return b === 'public' || r[b] === true; });
  }
  P.revealList = revealList;
  /* Single rooms (M4 step 5; map kit 0.9, "room:<name>" entries). `open` is the run's ball.open: a list of room NAMES the GM opened for
     the players on their own. mapUi() carries it in the map controls; like the bands it counts only while Layer is Player, and an absent
     or malformed list means no rooms. Names are kept exactly as the roll gives them (the kit and the token path both match on the NAME,
     never on a data-room id: from 0.9 the player copy renumbers its rooms). A name that is no room of the roll opens nothing. */
  function cleanRooms(v) {
    var out = [];
    (Array.isArray(v) ? v : []).forEach(function (n) { if (typeof n === 'string' && n && out.indexOf(n) < 0 && out.length < 80) out.push(n); });
    return out;
  }
  function openRooms(map) { return isObj(map) && map.layer === 'player' ? cleanRooms(map.open) : []; }
  /* what the player copy is drawn at: the revealed bands, then one "room:<name>" for each room opened on its own */
  function revealEntries(map) { return revealList(map).concat(openRooms(map).map(function (n) { return 'room:' + n; })); }
  /* THE rule, the kit's: a room is shown when its band is revealed OR it has its own room entry. Every place that decides what the
     players can see from a reveal list (the hidden-name scan, the token screen, the markers' rooms) uses this one function. */
  function roomShown(room, reveal) {
    if (!isObj(room) || !Array.isArray(reveal)) return false;
    return reveal.indexOf(room.band) >= 0 || (typeof room.name === 'string' && reveal.indexOf('room:' + room.name) >= 0);
  }
  /* the room names and the bands in a reveal list (the "room:" entries, and the rest) */
  function entryRooms(reveal) { return (Array.isArray(reveal) ? reveal : []).filter(function (e) { return typeof e === 'string' && e.indexOf('room:') === 0; }).map(function (e) { return e.slice(5); }); }
  /* the names in `names` that are rooms of this roll, in their order */
  function rollRoomsOf(roll, names) {
    var have = {}; (roll && Array.isArray(roll.rooms) ? roll.rooms : []).forEach(function (r) { if (isObj(r) && typeof r.name === 'string') have[r.name] = 1; });
    return (Array.isArray(names) ? names : []).filter(function (n) { return have[n] === 1; });
  }
  function entryBands(reveal) { return (Array.isArray(reveal) ? reveal : []).filter(function (e) { return typeof e === 'string' && e.indexOf('room:') !== 0; }); }
  P.rollRoomsOf = rollRoomsOf; P.cleanRooms = cleanRooms; P.revealEntries = revealEntries; P.roomShown = roomShown; P.entryRooms = entryRooms; P.entryBands = entryBands;
  /* the map kit's options for these controls: view and theme from the known lists (else the defaults), time and weather only when set.
     On the player layer the rooms the GM opened on their own (map.open) go to the kit as "room:<name>" beside the bands. */
  function mapOpts(map, layer, reveal, size) {
    var m = isObj(map) ? map : {}, o = { view: VIEWS.indexOf(m.view) >= 0 ? m.view : P.MAP0.view, theme: THEMES.indexOf(m.theme) >= 0 ? m.theme : P.MAP0.theme, layer: layer, reveal: reveal };
    if (layer === 'player' && Array.isArray(reveal)) {
      var more = cleanRooms(m.open).map(function (n) { return 'room:' + n; }).filter(function (e) { return reveal.indexOf(e) < 0; });
      if (more.length) o.reveal = reveal.concat(more);
    }
    if (m.time === 'Bluetime' || m.time === 'Night') o.time = m.time;
    var w = m.weather;
    if (w === 'rolled') o.weather = true; else if (w === 'none') o.weather = false; else if (w === 'rain' || w === 'fog' || w === 'snow') o.weather = w;
    return Object.assign(o, size || { width: 1400 });
  }
  P.mapOpts = mapOpts;
  P.REVEAL0 = { public: true, working: false, controlled: false, secure: false };   /* every new roll and replay starts here */

  function decodeEntities(s) {
    return str(s).replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, function (m, e) {
      if (e.charAt(0) === '#') { var n = e.charAt(1).toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch (x) { return ' '; } }
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[e.toLowerCase()];
    });
  }
  /* An SVG's visible text: tags out (so a name split over <tspan>s joins up), XML entities decoded, whitespace collapsed,
     lower case. */
  function svgText(svg) { return decodeEntities(str(svg).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').toLowerCase(); }
  /* one way of writing a string for the scan: lower case, curly quotes straight, odd spaces plain, dashes one dash, spaces collapsed */
  function fold(s) { return str(s).toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[    ]/g, ' ').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim(); }
  /* Where the scan looks (the secrecy review of 23/10/2026): the visible text, AND the whole source with entities decoded and tags
     kept (attributes, ids, classes, comments, <title>, <desc>), AND that source with - and _ read as spaces (an id like
     "b68m-server-room"). Each starts and ends with a space, for the whole-word test. */
  function svgHays(svg) {
    var src = fold(decodeEntities(svg));
    return [' ' + fold(svgText(svg)) + ' ', ' ' + src + ' ', ' ' + src.replace(/[-_]+/g, ' ') + ' '];
  }
  function wholeWord(h, n) {
    var i = -1;
    while ((i = h.indexOf(n, i + 1)) >= 0) { if (!/[a-z0-9]/.test(h.charAt(i - 1)) && !/[a-z0-9]/.test(h.charAt(i + n.length))) return true; }
    return false;
  }
  /* What the players must not read on a map with these bands revealed: every room in a hidden band, both threats, and
     the target room while its band is hidden; and, whatever is revealed (the kit draws them as icons on the player layer, never as
     words): every room's loot and lock or obstacle, the loot list, the roll's obstacle, the watcher (whole, and their name), and how
     the service side and the back route get in (a way the crew has to ask about or cannot know from outside: its words, and the
     place before the dash). Loot, locks and the obstacle count only as phrases (two words or more), so a one-word lock never meets
     an icon's name. A name that is also a revealed room's name is not a secret, and neither is one of the map kit's own floor
     titles (P.LEVEL_TITLES): from kit 0.5 every floor of the player layer is titled generically ("Basement", "Ground floor"...),
     never after a room, so a hidden room that happens to be called "Basement" adds nothing the title of that floor does not
     already say. */
  P.LEVEL_TITLES = ['basement', 'ground floor', 'upper floor', 'top floor'];
  function hiddenNames(roll, reveal) {
    var rooms = roll && Array.isArray(roll.rooms) ? roll.rooms : [], shown = {}, out = [];
    P.LEVEL_TITLES.forEach(function (t) { shown[t] = 1; });
    rooms.forEach(function (r) { if (r && roomShown(r, reveal)) shown[fold(r.name)] = 1; });
    function add(n) { n = fold(n).replace(/[.,;:!]+$/, ''); if (n.length >= 3 && !shown[n] && out.indexOf(n) < 0) out.push(n); }
    function phrase(n) { n = fold(n); if (/\s/.test(n) && n.length >= 5) add(n); }
    rooms.forEach(function (r) { if (r && !roomShown(r, reveal)) add(r.name); });
    if (!roll) return out;
    add(roll.physThreatName); add(roll.socThreatName); if (roll.targetRoom && reveal.indexOf(roll.targetBand) < 0 && reveal.indexOf('room:' + roll.targetRoom) < 0) add(roll.targetRoom);
    rooms.forEach(function (r) { if (isObj(r)) { if (typeof r.loot === 'string') phrase(r.loot); if (typeof r.obstacle === 'string') phrase(r.obstacle); } });
    (Array.isArray(roll.items) ? roll.items : []).forEach(function (x) { if (typeof x === 'string') phrase(x); });
    if (typeof roll.obstacle === 'string') phrase(roll.obstacle);
    if (roll.watcher) { add(roll.watcher); add(str(roll.watcher).split(/,|\s[—-]\s/)[0]); }
    (Array.isArray(roll.vectors) ? roll.vectors : []).forEach(function (v, i) {
      if (!isObj(v) || i === 0 || !/question|can't be known|cannot be known/i.test(str(v.know))) return;
      if (v.how) { add(v.how); var head = str(v.how).split(/\s[—–-]\s/)[0]; if (head !== str(v.how)) add(head); }
      if (v.room) add(v.room);
    });
    return out;
  }
  /* the hidden names the svg holds anywhere (whole words, any case), [] when it is clean */
  function leaks(svg, roll, reveal) {
    var H = svgHays(svg);
    return hiddenNames(roll, reveal).filter(function (n) { return H.some(function (h) { return wholeWord(h, n); }); });
  }
  P.svgHays = svgHays; P.fold = fold;
  P.svgText = svgText; P.hiddenNames = hiddenNames; P.leaks = leaks;
  P.LEAK_MSG = 'This view would name a hidden room: use Rings or Iso, or reveal more bands.';
  /* The only way a map reaches the display: the PLAYER layer, rendered here from the roll, whatever the controls say.
     Refuses outright when the controls are on the GM layer, so a GM render can never be pushed by accident, and refuses a
     player render that prints a hidden name (the map kit titles a plan or section level after the room it holds, hidden
     or not: a kit bug, GM.md). */
  function playerDisplay(roll, map, render, tk) {
    if (!isObj(map) || map.layer !== 'player') throw new Error('Only the player layer can go to the iPad. Switch Layer to Player first.');
    if (!roll || typeof render !== 'function') throw new Error('Roll a location first.');
    var reveal = revealEntries(map);       /* the bands, and "room:<name>" for each room opened on its own (the kit's 0.9 reveal) */
    var o = mapOpts(map, 'player', reveal, P.IPAD_MAP);
    /* M3: the crew markers and visible pinned clocks of the run (tk = { tokens, hide }, from playerTokens) go through tokenScreen here,
       the one door; with none left, `o` is exactly what it was before tokens existed (no `tokens` key at all) */
    var scr = isObj(tk) ? tokenScreen(tk.tokens, roll, reveal, tk.hide) : { tokens: [], refused: [] };
    /* a clean render of these options, or null: defence in depth (PR #53) an iso that names a hidden room is redrawn as rings in the
       same look; anything else, or rings that leak too, is not clean */
    function clean(opts) {
      var r = render(roll, opts);
      if (leaks(r.svg, roll, reveal).length && opts.view === 'iso') { var r2 = render(roll, Object.assign({}, opts, { view: 'rings' })); if (!leaks(r2.svg, roll, reveal).length) r = r2; }
      return leaks(r.svg, roll, reveal).length ? null : r;
    }
    var used = scr.tokens, r = used.length ? clean(Object.assign({}, o, { tokens: used })) : null, dropped = false;
    if (!r) { if (used.length) { dropped = true; used = []; } r = clean(o); }      /* a map that only leaks WITH its markers goes without them */
    if (!r) { var e = new Error(P.LEAK_MSG); e.leak = true; throw e; }
    var capRooms = rollRoomsOf(roll, entryRooms(reveal));       /* only rooms this roll has: a name left over from a site edit opens nothing and is not captioned */
    return { kind: 'svg', title: str(roll.name).slice(0, 200), caption: (roll.district ? roll.district + ' · ' : '') + 'surveyed: ' + entryBands(reveal).join(', ') + (capRooms.length ? ' + ' + capRooms.join(', ') : ''), svg: r.svg, warnings: r.warnings || [], reveal: reveal,
      tokens: used.length, tokensRefused: scr.refused.length > 0 || dropped };
  }
  P.playerDisplay = playerDisplay;
  /* The only way a chase strip reaches the display (the Chase panel, GM.md "Chase"): the PLAYER layer at the iPad's size, drawn here
     from the chase's player copy (B68GmChase.playerCopy: no roll line, no GM note, no hidden opposing clock), never with the roll lines,
     then scanned for every secret of the whole chase (B68GmChase.secrets) and held to the server's 600 KiB. render: B68Map.chase;
     G: B68GmChase. Throws (e.leak, e.big) rather than send anything doubtful. */
  P.CHASE_LEAK_MSG = 'This strip would show the players a roll line, a GM note or a hidden clock, so it was not sent.';
  function chaseDisplay(chase, render, G) {
    if (!G || !isObj(chase)) throw new Error('Start a chase first.');
    if (typeof render !== 'function') throw new Error('The map kit here has no chase strip (it needs map kit 0.6).');
    var r = render(G.playerCopy(chase), { layer: 'player', layout: 'ipad', theme: 'rulebook' }), svg = str(r && r.svg);
    var H = svgHays(svg), t = ' ' + svgText(svg) + ' ', hits = G.secrets(chase).filter(function (s) { var f = fold(s); return t.indexOf(s) >= 0 || (f && H.some(function (h) { return h.indexOf(f) >= 0; })); });
    if (hits.length) { var e = new Error(P.CHASE_LEAK_MSG); e.leak = true; e.hits = hits; throw e; }
    var b = bytesOf(svg);
    if (b > G.SVG_MAX) { var e2 = new Error('The strip is too large for the iPad (' + Math.round(b / 1024) + ' KiB, at most ' + Math.round(G.SVG_MAX / 1024) + '). End this chase and carry on in a new one.'); e2.big = true; throw e2; }
    return { kind: 'svg', title: G.title(chase), caption: G.caption(chase).slice(0, 2000), svg: svg, warnings: (r && r.warnings) || [] };
  }
  P.chaseDisplay = chaseDisplay;
  /* the street description for the iPad, as plain text (markdown markers out: the display shows text as it is) */
  function plainText(md) {
    return str(md).split('\n').map(function (l) {
      return l.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/^\s*>\s?/, '').replace(/^\s*[-*+]\s+/, '• ')
        .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').replace(/\*([^*\n]+)\*/g, '$1').replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1$2')
        .replace(/`([^`]+)`/g, '$1').replace(/\s+$/, '');
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  P.plainText = plainText;

  /* ---------- console replay: a card is redrawn with the bargains and callbacks as they were when it was rolled ---------- */
  function conSnapshot(con) { var c = isObj(con) ? con : {}; return JSON.stringify({ owed: c.owed || {}, struck: c.struck || {}, used: c.used || {} }); }
  /* What an Earlier chip says (B15): the module's own label, with the NPC a Someone card is about up front (the Face, the Contact,
     or the NPC a reaction is for) when the label lacks the name, and a Devil's Bargain without its leading bold "Want +1d?" token. */
  function earlierLabel(res) {
    var m = res && res.meta || {}, lead = res && res.sections && res.sections[0], label = str(m.label);
    if (!label) return label;
    var kind = lead ? lead.id : m.id, first = ((lead ? lead.lines : res && res.lines) || [])[0];
    if (kind === 'devilsBargain' && first && first.kind !== 'grid') {
      var rest = plainMd(str(first.md).replace(/^\*\*[^*]+\*\*\s*/, ''));
      if (rest) return str(m.title) + ': ' + shortLabel(rest, 44);
    }
    var who = kind === 'face' ? m.face && m.face.name : kind === 'contact' ? m.contact && m.contact.name : kind === 'reaction' ? m.reaction && m.reaction.npc : '';
    who = str(who).trim();
    if (who && label.toLowerCase().indexOf(who.toLowerCase()) < 0) {
      var i = label.indexOf(': ');
      label = i < 0 ? who + ' — ' + label : label.slice(0, i + 2) + who + ' — ' + label.slice(i + 2);
    }
    return label;
  }
  P.earlierLabel = earlierLabel;
  /* the history / current-card entry for a console roll: replay info only, never the card */
  function consoleEntry(res, con) {
    var rp = res.replay;
    return { id: rp.id, seed: rp.seed, ui: rp.ui, mem: JSON.stringify(rp.mem), con: conSnapshot(con), label: earlierLabel(res), at: nowIso() };
  }
  /* redraw an entry: its own snapshot of the console state (entries from before snapshots use `fallback`), its own memory */
  function replayConsoleEntry(C, T, campaign, e, fallback) {
    if (!C || !T || !isObj(e)) return null;
    var mem = {}, state = fallback || {};
    try { mem = JSON.parse(e.mem || '{}'); } catch (x) {}
    if (typeof e.con === 'string') { try { state = JSON.parse(e.con); } catch (x) {} }
    try { return C.create({ T: T, campaign: campaign || {}, state: state, mem: {} }).roll(e.id, e.ui || {}, { seed: e.seed, mem: mem }); } catch (x) { return null; }
  }
  P.conSnapshot = conSnapshot; P.consoleEntry = consoleEntry; P.replayConsoleEntry = replayConsoleEntry;

  /* ---------- saving the GM state ---------- */
  function bytes(o) { var s; try { s = typeof o === 'string' ? o : JSON.stringify(o); } catch (e) { return 0; } return bytesOf(s || ''); }
  P.bytes = bytes;
  /* Is it worth retrying a failed write? A network error, a conflict (409), a rate limit (429) or a server error (5xx) is;
     any other 4xx (malformed, too large, forbidden) will fail the same way again. A 401 is neither: see signedOut. */
  function retryable(e) { var s = e && e.status; return !s || s === 409 || s === 429 || s >= 500; }
  /* The Cloudflare Access session ended: a 401, or the adapter's own signed-out error (code 'signed_out', which it gives to every call
     after the first 401). Nothing sent will work until the page is reloaded and signed in again. */
  function signedOut(e) { return !!e && (e.status === 401 || e.code === 'signed_out'); }
  P.retryable = retryable; P.signedOut = signedOut;
  /* The write queue for one page session. add() folds a patch into the pending one and saves after `debounce` ms; one
     write is in flight at a time, and whatever was added meanwhile goes as soon as it lands (even after the page closed:
     the session flushes itself, it does not look at whether the page is still open). A retryable failure puts the patch
     back and retries with backoff; any other is parked (kept for the sticky copy, never resent) so later patches still
     save. A signed-out failure (signedOut) is neither: the saver goes on HOLD (`hold`): the patch goes back to pending, nothing more is
     sent (not by flush, not by the beacon), no retry is scheduled, and later patches keep merging into the pending copy.
     unsent() is that copy (the write in flight too): the page keeps it in the sticky copy and resends it on the next open.
     o = { send(patch) -> Promise<{ doc, updatedAt }>, beacon?(patch) -> Promise, saved(r, pendingAfter),
     changed(state), delay(fn, ms) -> handle, cancel(handle), debounce } */
  function makeSaver(o) {
    var st = { pending: null, flying: [], writing: false, parked: null, hold: false, error: '', retryMs: 0, timer: null };
    function changed() { if (o.changed) { try { o.changed(st); } catch (e) {} } }
    function schedule(ms) { if (st.timer !== null) o.cancel(st.timer); st.timer = o.delay(function () { st.timer = null; flush(); }, ms); }
    function add(p) { st.pending = st.pending ? mergePatch(st.pending, p) : clone(p); if (!st.hold) schedule(o.debounce); changed(); }
    function holdOn(p) { st.pending = st.pending ? mergePatch(p, st.pending) : p; st.hold = true; st.error = 'signed out'; }
    function landed(p) { var i = st.flying.indexOf(p); if (i >= 0) st.flying.splice(i, 1); }
    /* what has not gone: the writes in flight, then the pending patch, as one patch */
    function unsent() { var all = st.flying.concat(st.pending ? [st.pending] : []); return all.length ? all.reduce(function (a, b) { return a ? mergePatch(a, b) : clone(b); }, null) : null; }
    function flush() {
      if (st.timer !== null) { o.cancel(st.timer); st.timer = null; }
      if (st.hold || st.writing || !st.pending) return Promise.resolve();
      var p = st.pending; st.pending = null; st.flying.push(p); st.writing = true; changed();
      return Promise.resolve().then(function () { return o.send(p); }).then(function (r) {
        st.writing = false; landed(p); st.retryMs = 0; if (!st.parked) st.error = '';
        if (o.saved) { try { o.saved(r, st.pending); } catch (e) {} }
        changed();
        if (st.pending) return flush();
      }, function (e) {
        st.writing = false; landed(p);
        if (signedOut(e)) holdOn(p);
        else if (retryable(e)) {
          st.pending = st.pending ? mergePatch(p, st.pending) : p;
          st.retryMs = Math.min(30000, st.retryMs ? st.retryMs * 2 : 2500);
          st.error = 'retrying'; schedule(st.retryMs);
        } else {
          st.parked = st.parked ? mergePatch(st.parked, p) : p;
          st.error = (e && e.message) || 'refused';
          if (st.pending) { changed(); return flush(); }
        }
        changed();
      });
    }
    /* the page is going away: send what is pending now, with keepalive, even if a write is in flight */
    function beacon() {
      if (st.timer !== null) { o.cancel(st.timer); st.timer = null; }
      if (st.hold) return Promise.resolve();
      if (!st.pending || !o.beacon) return flush();
      var p = st.pending; st.pending = null; st.flying.push(p);
      return Promise.resolve().then(function () { return o.beacon(p); }).then(function (r) { landed(p); if (r && o.saved) { try { o.saved(r, st.pending); } catch (e) {} } changed(); },
        function (e) { landed(p); if (signedOut(e)) { holdOn(p); changed(); } else st.pending = st.pending ? mergePatch(p, st.pending) : p; });
    }
    return { add: add, flush: flush, beacon: beacon, unsent: unsent, state: function () { return st; } };
  }
  P.makeSaver = makeSaver;
  /* the display gate: an svg goes out only if playerDisplay made it; every other kind passes */
  function makeGate(hiddenNames) {
    var ok = [];
    return {
      mark: function (svg) { ok.push(svg); if (ok.length > 8) ok.shift(); return svg; },
      allows: function (d) { return isObj(d) && (d.kind !== 'svg' || (typeof d.svg === 'string' && ok.indexOf(d.svg) >= 0)); },
      /* an ambient patch: a score (the only thing in it that carries a map) goes only if BOTH its svgs were marked; null clears */
      allowsAmbient: function (p) {
        if (!isObj(p)) return false;
        /* an overlay goes out only in the shape overlayOk() knows (no stray fields, no svg, no markup); auto is a boolean */
        if ('overlay' in p && p.overlay !== null && !overlayOk(p.overlay)) return false;
        /* a text overlay is free text that nothing else scans: refused when it names a hidden clock or a hidden NPC (whole word, any case). A clock
           overlay carries an id, never a name, and an npc one an id: the server resolves both and refuses a hidden one. */
        if (isObj(p.overlay) && p.overlay.kind === 'text' && typeof hiddenNames === 'function') {
          var hn = []; try { hn = hiddenNames() || []; } catch (e) { return false; }
          if (namesHit(p.overlay.text, hn)) return false;
        }
        if ('auto' in p && p.auto !== null && typeof p.auto !== 'boolean') return false;
        if (!('score' in p) || p.score === null) return true;
        return isObj(p.score) && typeof p.score.board === 'string' && typeof p.score.iso === 'string' && ok.indexOf(p.score.board) >= 0 && ok.indexOf(p.score.iso) >= 0;
      }
    };
  }
  P.makeGate = makeGate;
  /* namesHit(text, names) -> true when the text holds any of the names as a whole word, any case ("Vex" is hit by "vex said" and not by "Vexing").
     Whole word is Unicode-aware (letters, digits and _ are word characters), spaces in a name match any run of spaces, and a name's own regex
     characters are escaped. Names under two characters are not scanned. Both sides are folded with NFKC first (full-width letters, ligatures
     and the like read as the plain letters), as the server's namesHit does. */
  function nfkc(s) { return /[^\x00-\x7f]/.test(s) ? s.normalize('NFKC') : s; }
  function namesHit(text, names) {
    var raw = typeof text === 'string' ? text : '';
    var texts = [raw], folded = nfkc(raw); if (folded !== raw) texts.push(folded);     /* the raw text always counts: folding can only add hits, never remove one */
    return (Array.isArray(names) ? names : []).some(function (n0) {
      if (typeof n0 !== 'string') return false;
      var forms = [n0], fn = nfkc(n0); if (fn !== n0) forms.push(fn);
      return forms.some(function (n1) {
        var n = n1.replace(/\s+/g, ' ').trim();
        if (n.length < 2) return false;
        var src = n.split(' ').map(function (w) { return w.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }).join('\\s+');
        try { var re = new RegExp('(?:^|[^\\p{L}\\p{N}_])' + src + '(?![\\p{L}\\p{N}_])', 'iu'); return texts.some(function (t) { return re.test(t); }); } catch (e) { return true; }
      });
    });
  }
  P.namesHit = namesHit;

  /* ---------- overlays (GM.md, "Overlays"): something laid over the iPad without replacing what is up ----------
     overlayOk(o): true for exactly the shapes /api/gm/ambient takes: { id (at most 40), kind clock|npc|fx|text, ms 1000-180000, auto? } plus
     clock { clockId }, npc { npcId }, fx { fx: 'dawn' }, text { text (at most 120) }, and no other field. A clock is named by its id: the SERVER
     resolves the name, size and fill, and refuses a hidden or missing clock. What goes in the text is the caller's: only what the GM chose,
     never model text or prep text. */
  var OV_FIELDS = { clock: ['clockId'], npc: ['npcId'], fx: ['fx'], text: ['text'] };
  function wholeBetween(v, lo, hi) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= lo && v <= hi; }
  function overlayOk(o) {
    if (!isObj(o) || !Object.prototype.hasOwnProperty.call(OV_FIELDS, o.kind)) return false;
    var allowed = ['id', 'kind', 'ms', 'auto'].concat(OV_FIELDS[o.kind]);
    if (Object.keys(o).some(function (k) { return allowed.indexOf(k) < 0; })) return false;
    if ('auto' in o && typeof o.auto !== 'boolean') return false;
    if (typeof o.id !== 'string' || !o.id.trim() || o.id.length > 40 || !wholeBetween(o.ms, 1000, 180000)) return false;
    if (o.kind === 'clock') return typeof o.clockId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(o.clockId);
    if (o.kind === 'npc') return typeof o.npcId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(o.npcId);
    if (o.kind === 'fx') return o.fx === 'dawn';
    return typeof o.text === 'string' && !!o.text.trim() && o.text.length <= 120;
  }
  P.overlayOk = overlayOk;
  /* a short line for the iPad panel: what the document holds (the display takes it away by itself after its ms) */
  /* a clock overlay holds its id only (the server joins the clock when the display reads it): the line takes the clock from the table's own
     clocks, clockOf(id) -> { name, size, filled } | null (the GM page's copy; the GM may see every clock) */
  function overlayLine(o, clockOf) {
    if (!isObj(o) || !Object.prototype.hasOwnProperty.call(OV_FIELDS, o.kind)) return '';
    var ck = o.kind === 'clock' && typeof clockOf === 'function' ? clockOf(o.clockId) : null;
    var what = o.kind === 'fx' ? 'dawn' : o.kind === 'clock' ? (ck ? 'clock ' + str(ck.name) + ' ' + ck.filled + '/' + ck.size : 'a table clock') : o.kind === 'npc' ? 'an NPC card' : 'a line of text';
    return what + ' · ' + Math.round((Number(o.ms) || 0) / 1000) + ' s';
  }
  P.overlayLine = overlayLine;

  /* ---------- the iPad panel: the ambient scenes, the crew sync, the score scene (GM.md, "Ambient scenes") ---------- */
  /* The scenes the picker offers (ids mirror Pure.AMBIENT_SCENES in display-page.js and AMBIENT_SCENES in functions/_lib/gm.js). */
  P.IPAD_SCENES = [
    { id: 'harvest', label: 'The lair' }, { id: 'watch', label: 'City Watch feed' }, { id: 'duskwall', label: 'The city after dark' },
    { id: 'boneyard', label: 'The Boneyard at dawn' }, { id: 'undertow', label: 'The Undertow' },
    { id: 'vet', label: "Grunt's" }, { id: 'tram', label: 'Night tram' }, { id: 'lurker', label: 'The Lurker press room' },
    { id: 'cards', label: 'Calling cards' }, { id: 'pells', label: "Pell's Provisions" }, { id: 'wanted', label: 'Wanted wall' },
    { id: 'meeting', label: 'The planning meeting' }, { id: 'credits', label: 'Opening credits', pinOnly: true },
    { id: 'board', label: 'Planning board', needs: 'score' }, { id: 'exploded', label: 'Score site, exploded', needs: 'score' },
    { id: 'testcard', label: 'Please stand by', pinOnly: true }
  ];
  P.IPAD_INTERVALS = [4, 7, 10, 15];
  P.IPAD_INTERVAL_DEFAULT = 7;
  P.CREW_DEBOUNCE = 2000;
  function clampN(v, lo, hi) { return Math.min(hi, Math.max(lo, Math.round(v))); }
  /* the crew heat / wanted a campaign (or ambient) document holds, as whole numbers clamped to 0-9 / 0-4; null when it holds no
     number for either */
  function crewOf(doc) {
    var c = isObj(doc) && isObj(doc.crew) ? doc.crew : null; if (!c) return null;
    var h = typeof c.heat === 'number' && isFinite(c.heat), w = typeof c.wanted === 'number' && isFinite(c.wanted);
    if (!h && !w) return null;
    return { heat: clampN(h ? c.heat : 0, 0, 9), wanted: clampN(w ? c.wanted : 0, 0, 4) };
  }
  function sameCrew(a, b) { return !!a && !!b && a.heat === b.heat && a.wanted === b.wanted; }
  P.crewOf = crewOf; P.sameCrew = sameCrew;
  /* The heat / wanted sync. note(campaignDoc) says what the table holds; when it differs from what the server holds (`lastSent`,
     learned from a send or adopted from the ambient document) and the ambient is not off, a send follows after `ms` of quiet
     (restarted only when the target moves). One request in flight; a failure toasts once (until the next success) and the next
     change retries. adopt(serverCrew, true) takes the server's value as the truth and corrects a stale one at once.
     o = { send(crew) -> Promise, mode() -> 'auto' | 'pin' | 'off' | undefined, delay(fn, ms) -> handle, cancel(handle), toast(msg),
           sent(response, crew), ms } */
  function makeCrewSync(o) {
    var st = { lastSent: null, target: null, pending: null, timer: null, inflight: false, toasted: false }, ms = o.ms == null ? P.CREW_DEBOUNCE : o.ms;
    function clear() { if (st.timer !== null) { o.cancel(st.timer); st.timer = null; } st.pending = null; }
    function wanted() { return !!st.target && !sameCrew(st.target, st.lastSent) && o.mode() !== 'off'; }
    function evaluate(now) {
      if (!wanted()) { clear(); return; }
      if (now) { clear(); fire(); return; }
      if (st.timer !== null && sameCrew(st.pending, st.target)) return;      /* already counting down to this value */
      clear(); st.pending = st.target;
      st.timer = o.delay(function () { st.timer = null; st.pending = null; fire(); }, ms);
    }
    function fire() {
      if (st.inflight || !wanted()) return;
      var crew = { heat: st.target.heat, wanted: st.target.wanted };
      st.inflight = true;
      Promise.resolve().then(function () { return o.send(crew); }).then(function (r) {
        st.inflight = false; st.lastSent = crew; st.toasted = false;
        if (o.sent) { try { o.sent(r, crew); } catch (e) {} }
        evaluate(false);
      }, function (e) {
        st.inflight = false;
        if (!st.toasted) { st.toasted = true; if (o.toast) o.toast('Could not send heat and wanted to the iPad: ' + (e && e.message || 'failed') + '. It will try again on the next change.'); }
      });
    }
    return {
      note: function (campDoc) { st.target = crewOf(campDoc); evaluate(false); },
      adopt: function (serverCrew, fix) { st.lastSent = crewOf({ crew: serverCrew }); if (fix) evaluate(true); else evaluate(false); },
      state: function () { return st; }
    };
  }
  P.makeCrewSync = makeCrewSync;

  /* "On the iPad now": the last display kind and title this page pushed or read */
  function displayLine(d) {
    if (!isObj(d)) return '';
    var t = str(d.title).slice(0, 80);
    if (d.kind === 'dark') return 'Lights out' + (t ? ' · ' + t : '');
    if (d.kind === 'svg') return 'Map' + (t ? ' · ' + t : '');
    if (d.kind === 'npc') return 'NPC' + (t ? ' · ' + t : '');
    if (d.kind === 'text') return 'Text' + (t ? ' · ' + t : '');
    if (d.kind === 'rule') return 'Rule' + (t ? ' · ' + t : '');
    if (d.kind === 'handout') return 'Handout' + (t ? ' · ' + t : '');
    if (d.kind === 'cards') return 'Cards' + (Array.isArray(d.cards) ? ' · ' + d.cards.length : '') + (d.mode === 'spread' ? ', spread' : '');
    return 'Nothing spotlit: the ambient plays';
  }
  P.displayLine = displayLine;
  /* Handouts (GM.md "Handouts"): the pack's `handouts` part is the list [{ id, title, file, when? }] (private; the images are static files in
     media/handouts/). The iPad is sent one item only: { kind: 'handout', title, file, showTitle }, never the list. */
  var HANDOUT_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,78}\.(?:png|jpe?g|gif|webp|svg)$/i;
  P.HANDOUT_DIR = 'media/handouts/';
  P.handoutList = function (body) {
    var seen = {};
    return (isObj(body) && Array.isArray(body.items) ? body.items : []).filter(function (x) {
      if (!isObj(x) || typeof x.id !== 'string' || !x.id || seen[x.id] || typeof x.file !== 'string' || !HANDOUT_FILE.test(x.file) || x.file.indexOf('..') >= 0) return false;
      seen[x.id] = 1; return true;
    }).map(function (x) { return { id: x.id, title: str(x.title).trim().slice(0, 200) || x.file, file: x.file, when: str(x.when).trim().slice(0, 200) }; });
  };
  P.handoutDisplay = function (item, showTitle) { return { kind: 'handout', title: str(item.title).slice(0, 2000), file: item.file, showTitle: showTitle === true }; };
  function scoreLine(score) {
    if (!isObj(score)) return '';
    var at = Date.parse(str(score.at)), when = '';
    if (at) { var d = new Date(at); when = pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
    return [str(score.name) || 'Unnamed', (Array.isArray(score.reveal) ? score.reveal : []).map(str).join(', ') || 'public', when].filter(Boolean).join(' · ');
  }
  P.scoreLine = scoreLine;
  /* ipadView(doc) -> what the panel draws from the server's ambient document (null or {} before there is one) */
  function ipadView(doc, clockOf) {
    var d = isObj(doc) ? doc : {}, score = isObj(d.score) ? d.score : null;
    var mode = d.mode === 'pin' || d.mode === 'off' ? d.mode : 'auto';
    var scene = typeof d.scene === 'string' ? d.scene : null;
    var iv = Math.round(Number(d.intervalMin)); if (!(iv >= 3 && iv <= 30)) iv = P.IPAD_INTERVAL_DEFAULT;
    var intervals = P.IPAD_INTERVALS.slice(); if (intervals.indexOf(iv) < 0) { intervals.push(iv); intervals.sort(function (a, b) { return a - b; }); }
    return {
      overlayLine: overlayLine(d.overlay, clockOf), auto: d.auto === true,
      mode: mode, scene: scene, intervalMin: iv, intervals: intervals, hasScore: !!score, scoreLine: scoreLine(score),
      tiles: P.IPAD_SCENES.map(function (s) {
        var noScore = s.needs === 'score' && !score;
        return { id: s.id, label: s.label, disabled: noScore, pressed: mode === 'pin' && scene === s.id, note: noScore ? 'needs a score scene' : s.pinOnly ? 'pin only' : '' };
      })
    };
  }
  P.ipadView = ipadView;
  /* the theme the credits play (display-page.js Pure.AMBIENT_MUSIC), and the panel's line about it */
  P.THEME_URL = 'media/theme.mp3';
  P.themeType = function (contentType) { var ct = String(contentType || '').toLowerCase().trim(); return !ct || /^audio\//.test(ct) || /^application\/octet-stream/.test(ct); };
  P.themeLine = function (state, http) {
    if (state === 'ok') return 'Theme for the credits: on the server.';
    if (state === 'none') return 'Theme for the credits: NO FILE on the server' + (http && http !== 404 ? ' (HTTP ' + http + ')' : '') + '. The credits run silent. Copy app/media/theme.mp3 into the deploying checkout and deploy again.';
    return 'Theme for the credits: not checked yet.';
  };

  /* The score scene (Location panel, "Set as score scene"): the board and the exploded site, rendered HERE from the roll on the
     PLAYER layer at the revealed bands, run through the same hidden-name scan as Show on iPad. The board is the plan on the board
     theme; if that names a hidden room it is redrawn as rings (clean) and `rings` is true; a leaking iso is likewise redrawn as
     rings (`isoRings` true); if the rings leak too, this throws (e.leak). Only player-safe fields go out: the place name and district. The target stays '' (the legend does not
     print it, and the target room is the secret). */
  function scoreScene(roll, map, render) {
    if (!isObj(map) || map.layer !== 'player') throw new Error('Only the player layer can be a score scene. Switch Layer to Player first.');
    if (!roll || typeof render !== 'function') throw new Error('Roll a location first.');
    var reveal = revealList(map);
    function leak() { var e = new Error(P.LEAK_MSG); e.leak = true; return e; }
    var board = render(roll, { view: 'plan', theme: 'board', layer: 'player', reveal: reveal, width: 1600 }), view = 'plan';
    if (leaks(board.svg, roll, reveal).length) {
      board = render(roll, { view: 'rings', theme: 'board', layer: 'player', reveal: reveal, width: 1600 }); view = 'rings';
      if (leaks(board.svg, roll, reveal).length) throw leak();
    }
    var iso = render(roll, { view: 'iso', theme: 'blueprint', legend: false, layer: 'player', reveal: reveal, width: 1600 });
    var isoRings = false;
    if (leaks(iso.svg, roll, reveal).length) {
      iso = render(roll, { view: 'rings', theme: 'blueprint', legend: false, layer: 'player', reveal: reveal, width: 1600 }); isoRings = true;
      if (leaks(iso.svg, roll, reveal).length) throw leak();
    }
    return {
      reveal: reveal, view: view, rings: view === 'rings', isoRings: isoRings, board: board.svg, iso: iso.svg,
      score: { name: str(roll.name).slice(0, 200), district: str(roll.district).slice(0, 200), target: '', reveal: reveal, view: view, board: board.svg, iso: iso.svg }
    };
  }
  P.scoreScene = scoreScene;

  /* Score sites (GM.md, "Score sites"): a location roll saved against a score card of the prep part. GM state
     sites: { <score key>: { seed, ui, mem, name, district, label, map: { view, theme }, at } }; the replay recipe is the one
     cards.location holds, so the same map redraws on any device; the sync files it into the vault (SYNC.md). */
  var SITE_MAX = P.SITE_MAX = 24;
  var SITE_PICKS = P.SITE_PICKS = ['target', 'district', 'faction', 'approach'];
  /* a name as a picker compares it: no case, no leading "the", no punctuation (Now in's rule) */
  function pickKey(s) { return str(s).toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ''); }
  /* the site entry for the location card on screen: its replay info (cards.location) and the roll's place, the score's label, the map's
     view and theme (the sync draws the vault's copy that way). null without a card or a roll. */
  function siteEntry(card, roll, label, map) {
    if (!isObj(card) || typeof card.seed !== 'number' || !roll) return null;
    var m = isObj(map) ? map : {};
    return {
      seed: card.seed, ui: clone(isObj(card.ui) ? card.ui : {}), mem: typeof card.mem === 'string' ? card.mem : JSON.stringify(isObj(card.mem) ? card.mem : {}),
      name: str(roll.name).slice(0, 120), district: str(roll.district).slice(0, 60), label: str(label).slice(0, 120),
      map: { view: VIEWS.indexOf(m.view) >= 0 ? m.view : P.MAP0.view, theme: THEMES.indexOf(m.theme) >= 0 ? m.theme : P.MAP0.theme }, at: nowIso()
    };
  }
  P.siteEntry = siteEntry;
  /* the Location pickers for a score card's site hints: each matched to its control's options by pickKey; a hint the tool lacks
     rolls on any and is reported. No district hint rolls on any (NOW_ANY), not on Now in: the site is wherever the score is.
     controls: B68GmLocation.controls(pack).controls. -> { ui: { target, district, approach, faction }, missed: [[key, value]] } */
  function siteUi(controls, hints) {
    var ui = {}, missed = [], h = isObj(hints) ? hints : {};
    (Array.isArray(controls) ? controls : []).forEach(function (c) {
      if (!isObj(c) || SITE_PICKS.indexOf(c.key) < 0) return;
      var none = c.key === 'district' ? '*' : '', want = str(h[c.key]).trim();
      if (!want) { ui[c.key] = none; return; }
      var hit = (Array.isArray(c.options) ? c.options : []).filter(function (o) { return isObj(o) && str(o.value) && pickKey(o.value) === pickKey(want); })[0];
      if (hit) ui[c.key] = str(hit.value); else { ui[c.key] = none; missed.push([c.key, want]); }
    });
    return { ui: ui, missed: missed };
  }
  P.siteUi = siteUi;
  /* the saved sites (only entries that can replay), and the keys whose site is this location card */
  function sitesIn(doc) {
    var s = isObj(doc) && isObj(doc.sites) ? doc.sites : {}, out = {};
    Object.keys(s).forEach(function (k) { if (isObj(s[k]) && typeof s[k].seed === 'number') out[k] = s[k]; });
    return out;
  }
  function siteKeysOf(sites, card) { return isObj(card) && typeof card.seed === 'number' ? Object.keys(sites).filter(function (k) { return sites[k].seed === card.seed; }) : []; }
  /* "Warehouse · Dockside · The Goose Guild · Stealth": a card's hints as one line */
  function hintLine(site) { var s = isObj(site) ? site : {}; return SITE_PICKS.map(function (k) { return str(s[k]).trim(); }).filter(Boolean).join(' · '); }
  P.sitesIn = sitesIn; P.siteKeysOf = siteKeysOf; P.hintLine = hintLine;
  /* Authored sites (GM.md, "Authored sites"): a hand-built location from the vault, in the location part's `authored`
     ({ v, sites: { <name>: { name, rel, base?, patch, map? } }, bind: { <score key>: <name> } }; scripts/lib/authored-export.mjs).
     Its roll is the base (the generator's roll from base.seed, or from a seed made of the name) with the patch laid over it, so
     every tool that takes a roll (the card, the map, Show on iPad and its hidden-name check, the score scene) takes it unchanged.
     A location card names one as { auth: <name> } in place of a seed. */
  function authoredOf(pk) {
    var a = isObj(pk) && isObj(pk.authored) ? pk.authored : null;
    return { sites: a && isObj(a.sites) ? a.sites : {}, bind: a && isObj(a.bind) ? a.bind : {} };
  }
  function nameSeed(s) { var h = 2166136261; s = str(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) || 1; }
  function authoredRoll(L, pk, site) {
    if (!L || !isObj(site) || !isObj(site.patch) || !Array.isArray(site.patch.rooms) || !site.patch.rooms.length) return null;
    var b = isObj(site.base) ? site.base : null, mem = {};
    if (b) { try { mem = JSON.parse(b.mem || '{}'); } catch (x) { mem = {}; } }
    var base; try { base = L.generate(pk, b && isObj(b.ui) ? b.ui : {}, { seed: b && typeof b.seed === 'number' ? b.seed : nameSeed(site.name), mem: isObj(mem) ? mem : {} }); } catch (x) { return null; }
    var roll = Object.assign({}, base, clone(site.patch)), names = {};
    roll.rooms.forEach(function (r) { if (isObj(r)) names[str(r.name)] = 1; });
    if (!site.patch.name) roll.name = str(site.name);
    if (!Array.isArray(site.patch.areas)) roll.areas = Object.keys(names);
    /* the base's skips name the base's rooms, which the patch's replace: they go unless the patch has its own. The card reads three
       ways in (front, service side, back route): each is the patch's laid over the base's, and one naming a replaced room names none */
    if (!Array.isArray(site.patch.skips)) roll.skips = [];
    var bv = Array.isArray(base.vectors) ? base.vectors : [], pv = Array.isArray(site.patch.vectors) ? site.patch.vectors : [];
    roll.vectors = [0, 1, 2].map(function (i) {
      var v = Object.assign({}, isObj(bv[i]) ? bv[i] : {}, isObj(pv[i]) ? clone(pv[i]) : {});
      if (v.room && !names[str(v.room)]) v.room = null;
      return v;
    }).concat(pv.slice(3).map(function (v) { return clone(v); }));
    if (!site.patch.targetRoom) {
      var t = roll.rooms.filter(function (r) { return isObj(r) && r.isTarget; })[0];
      if (t) { roll.targetRoom = str(t.name); roll.targetBand = t.band; } else if (!names[str(roll.targetRoom)]) { roll.targetRoom = ''; }
    }
    roll.auth = str(site.name);
    return roll;
  }
  /* a location card's identity, and a roll's: an authored site's name, else its seed */
  function locKey(c) { return isObj(c) ? (c.auth ? 'a:' + str(c.auth) : c.seed) : undefined; }
  function rollKey(r) { return isObj(r) ? (r.auth ? 'a:' + str(r.auth) : r.seed) : undefined; }
  P.authoredOf = authoredOf; P.authoredRoll = authoredRoll; P.locKey = locKey; P.rollKey = rollKey; P.nameSeed = nameSeed;
  /* Run the site's token (see "Run the site" below): pure, so it is checked on its own */
  var RUN_KIND = { target: '#8a5a00', guard: '#1f4e79', staff: '#4a6b3a', rival: '#7a2e6e', ally: '#1d7f6e', contact: '#5d5d5d' };
  var RUN_POS = { controlled: '#2a7f3f', risky: '#b87a00', desperate: '#b3261e', unknown: '#6b6b6b' };
  var RUN_LETTER = { controlled: 'C', risky: 'R', desperate: 'D', unknown: '?' };
  function runInitials(label) {
    var out = '';
    str(label).trim().split(/\s+/).filter(Boolean).slice(0, 2).forEach(function (w) { out += Array.from(w)[0].toUpperCase(); });
    return out || '?';
  }
  /* the combined token for one room, as the svg the kit nests (viewBox 540 x 600): up to four initials pills (the last "+N" when
     more), a red ring when danger, the lens chip (C, R, D or ?) and a small pie for each pinned clock.
     o: { pills: [{ t, c }], pies: [{ f, s }], lens: pos | null, danger: bool } */
  function runTokenSvg(o) {
    o = o || {};
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 600"><rect x="20" y="20" width="500" height="560" rx="44" fill="#fffdf6" stroke="' + (o.danger ? '#d11' : '#1a1a1a') + '" stroke-width="' + (o.danger ? 40 : 14) + '"/>';
    (Array.isArray(o.pills) ? o.pills : []).slice(0, 4).forEach(function (p, i) {
      var x = 50 + (i % 2) * 235, y = 60 + Math.floor(i / 2) * 150;
      s += '<rect x="' + x + '" y="' + y + '" width="220" height="130" rx="34" fill="' + esc(p.c) + '"/><text x="' + (x + 110) + '" y="' + (y + 90) + '" text-anchor="middle" font-size="84" font-weight="700" fill="#fff">' + esc(p.t) + '</text>';
    });
    (Array.isArray(o.pies) ? o.pies : []).slice(0, 3).forEach(function (p, i) {
      var cx = 100 + i * 120, cy = 480, r = 48, size = +p.s > 0 ? +p.s : 0, f = size ? Math.max(0, Math.min(1, (+p.f || 0) / size)) : 0;
      s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#fff" stroke="#1a1a1a" stroke-width="10"/>';
      if (f >= 1) s += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#1a1a1a"/>';
      else if (f > 0) { var a = f * 2 * Math.PI; s += '<path d="M' + cx + ' ' + cy + ' L' + cx + ' ' + (cy - r) + ' A' + r + ' ' + r + ' 0 ' + (f > 0.5 ? 1 : 0) + ' 1 ' + (cx + r * Math.sin(a)).toFixed(1) + ' ' + (cy - r * Math.cos(a)).toFixed(1) + ' Z" fill="#1a1a1a"/>'; }
    });
    if (o.lens) s += '<circle cx="450" cy="480" r="62" fill="' + (RUN_POS[o.lens] || RUN_POS.unknown) + '"/><text x="450" y="510" text-anchor="middle" font-size="86" font-weight="700" fill="#fff">' + esc(RUN_LETTER[o.lens] || '?') + '</text>';
    return s + '</svg>';
  }
  P.runTokenSvg = runTokenSvg; P.runInitials = runInitials;

  /* ---------- the players' tokens (M3; design 4.7 and 4.10) ----------
     The PLAYER copy of an authored site carries two things from the run, in rooms the player copy shows and nowhere else: a marker
     for each PC the GM placed, and the pinned table clocks the players may see (never a hidden one). No person, no lens, no timeline,
     no danger ring, and no clock name. playerTokens is the ONE builder and is deliberately blind: it takes the two placement maps
     ({ crew, pins }, picked by the caller), the names of the rooms the players can see, the clocks with their visibility and the PCs'
     ids and names. It never receives the play block, the lens or the people, so it cannot draw them.
     A token is { room, label, svg }: one per room (so none hides another), the label the PCs' names only. */
  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function playerTokens(placed, shown, clocks, pcs) {
    var crew = isObj(placed) && isObj(placed.crew) ? placed.crew : {}, pins = isObj(placed) && isObj(placed.pins) ? placed.pins : {};
    var open = Object.create(null), byRoom = Object.create(null);
    (Array.isArray(shown) ? shown : []).forEach(function (n) { if (typeof n === 'string' && n) open[n] = true; });
    function slot(room) { return byRoom[room] || (byRoom[room] = { names: [], pies: [] }); }
    (Array.isArray(pcs) ? pcs : []).forEach(function (c) {
      if (!isObj(c) || typeof c.id !== 'string' || !c.id || !hasOwn(crew, c.id)) return;
      var room = crew[c.id], name = str(c.name).trim();
      if (typeof room === 'string' && open[room] && name) slot(room).names.push(name);
    });
    (Array.isArray(clocks) ? clocks : []).forEach(function (c) {
      if (!isObj(c) || c.hidden || typeof c.id !== 'string' || !c.id || !hasOwn(pins, c.id)) return;
      var room = pins[c.id];
      if (typeof room === 'string' && open[room]) slot(room).pies.push({ f: +c.filled || 0, s: +c.size || 0 });
    });
    return Object.keys(byRoom).sort().map(function (room) {
      var s = byRoom[room], pills = s.names.map(function (n) { return { t: runInitials(n), c: '#111111' }; });
      if (pills.length > 4) pills = pills.slice(0, 3).concat([{ t: '+' + (pills.length - 3), c: '#333333' }]);
      var label = s.names.slice(0, 3).join(', ') + (s.names.length > 3 ? ' +' + (s.names.length - 3) : '');
      return { room: room, label: shortLabel(label, 30), svg: runTokenSvg({ pills: pills, pies: s.pies.slice(0, 3) }) };
    });
  }
  /* what no marker label may carry, on top of the hidden names of the map itself: the play's people and disguises (labels as the GM
     wrote them, matched whole) and the names of hidden clocks. These come from the page and feed ONLY this deny list. */
  function tokenHidden(roll, reveal, hide) {
    var out = hiddenNames(roll, reveal), rooms = roll && Array.isArray(roll.rooms) ? roll.rooms : [], shown = {};
    P.LEVEL_TITLES.forEach(function (t) { shown[t] = 1; });
    rooms.forEach(function (r) { if (r && roomShown(r, reveal)) shown[fold(r.name)] = 1; });
    (Array.isArray(hide) ? hide : []).forEach(function (n) { n = fold(n).replace(/[.,;:!]+$/, ''); if (n.length >= 3 && !shown[n] && out.indexOf(n) < 0) out.push(n); });
    return out;
  }
  /* The gate every marker passes before it is drawn on a player copy. A token that is not exactly { room, label, svg } as strings, or
     any hidden name in any label or svg, refuses the WHOLE set (fail closed: -> { tokens: [], refused: [what] }); a token in a room the
     player copy does not show is just dropped (the kit drops it too). */
  function tokenScreen(tokens, roll, reveal, hide) {
    var list = Array.isArray(tokens) ? tokens : [];
    if (!list.length) return { tokens: [], refused: [] };
    if (list.some(function (t) { return !isObj(t) || Object.keys(t).sort().join() !== 'label,room,svg' || typeof t.room !== 'string' || typeof t.label !== 'string' || typeof t.svg !== 'string'; })) return { tokens: [], refused: ['(shape)'] };
    var rooms = roll && Array.isArray(roll.rooms) ? roll.rooms : [];
    var kept = list.filter(function (t) { return rooms.some(function (r) { return isObj(r) && r.name === t.room && roomShown(r, reveal); }); });
    var names = tokenHidden(roll, reveal, hide), hits = [];
    kept.forEach(function (t) {
      var H = svgHays(t.svg).concat(svgHays('<text>' + esc(t.label) + '</text>'));
      names.forEach(function (n) { if (hits.indexOf(n) < 0 && H.some(function (h) { return wholeWord(h, n); })) hits.push(n); });
    });
    return hits.length ? { tokens: [], refused: hits } : { tokens: kept, refused: [] };
  }
  /* the identity of a requested set of markers (and of the deny list it was screened against): what live reveal compares */
  function tokenSig(tokens, hide) { return tokens.length ? JSON.stringify([tokens.map(function (t) { return [t.room, t.label, t.svg]; }), hide || []]) : ''; }
  P.TOKEN_LEAK_MSG = 'The crew markers would have shown the players a name they must not see, so the map went without them.';
  P.playerTokens = playerTokens; P.tokenScreen = tokenScreen; P.tokenSig = tokenSig; P.tokenHidden = tokenHidden;

  /* a key press on #gm -> an action, or null. ev: { key, ctrlKey, altKey, metaKey, typing }
     1-4 roll a situation; 5-9 do nothing (the nine single tables have no keys: More tables, under the card). Blanking the
     laptop takes Shift+H (`blank`), or a plain H twice within a second (`blank-tap`): a stray key never blacks it out. */
  function keyAction(ev) {
    if (!ev || ev.ctrlKey || ev.altKey || ev.metaKey) return null;
    var k = str(ev.key);
    if (ev.typing) return k === 'Escape' ? { type: 'esc' } : null;
    if (/^[1-4]$/.test(k)) return { type: 'situation', n: +k };
    if (/^[5-9]$/.test(k)) return null;
    if (k === 'H') return { type: 'blank' };
    if (k === 'h') return { type: 'blank-tap' };
    switch (k.toLowerCase()) {
      case 'n': return { type: 'panel', panel: 'npc' };
      case 'b': return { type: 'panel', panel: 'location' };
      case 't': return { type: 'panel', panel: 'rules' };
      case 's': return { type: 'panel', panel: 'scenes' };
      case 'j': return { type: 'panel', panel: 'score' };
      case 'c': return { type: 'panel', panel: 'chase' };
      case 'd': return { type: 'panel', panel: 'downtime' };
      case 'p': return { type: 'capture', bucket: 'n' };
      case 'x': return { type: 'capture', bucket: 'x' };
      case 'm': return { type: 'capture', bucket: 'm' };
      case 'l': return { type: 'last' };
      case 'a': return { type: 'assist' };
      case 'u': return { type: 'undo' };
      case 'i': return { type: 'panel', panel: 'ipad' };
      case 'r': return { type: 'panel', panel: 'prep' };
      case 'o': return { type: 'panel', panel: 'cards' };
      case 'f': return { type: 'focus' };
      case '/': return { type: 'find' };
      case '0': return { type: 'clear' };
      case 'escape': return { type: 'esc' };
    }
    return null;
  }
  P.keyAction = keyAction;

  function pad2(n) { n = Math.max(0, Math.floor(+n || 0)); return n < 10 ? '0' + n : String(n); }
  function dmy(d) { d = d instanceof Date ? d : new Date(d); if (isNaN(d)) return ''; return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear(); }
  function ageDays(iso, now) { var t = Date.parse(iso || ''); if (!t) return null; return ((now == null ? Date.now() : +now) - t) / 86400000; }
  P.dmy = dmy; P.ageDays = ageDays; P.pad2 = pad2;

  /* "Export tonight's note": the capture under four headings, then the bargains and callbacks (doc = GM state) */
  function exportNote(doc, opts) {
    var o = opts || {}, n = Math.max(0, Math.floor(+o.session || 0)), d = doc || {};
    var cap = newest(d.capture).reverse();
    var out = ['# Session ' + n + ': notes from the table', '', '*Exported ' + dmy(o.now || new Date()) + ' from the GM page.*', ''];
    BUCKETS.forEach(function (b) {
      out.push('## ' + b.head, '');
      var list = cap.filter(function (e) { return e.bucket === b.k && str(e.text).trim(); });
      if (!list.length) out.push('- (none)');
      list.forEach(function (e) { out.push('- ' + str(e.text).replace(/\s+/g, ' ').trim()); });
      out.push('');
    });
    var con = isObj(d.con) ? d.con : {};
    var owed = Object.keys(isObj(con.owed) ? con.owed : {}).map(function (k) { var x = con.owed[k]; return isObj(x) ? str(x.text) + (x.src ? ' (' + str(x.src) + ')' : '') : str(x); }).filter(Boolean);
    var struck = Object.keys(isObj(con.struck) ? con.struck : {}).map(function (k) { return str(con.struck[k]); }).filter(Boolean);
    var used = Object.keys(isObj(con.used) ? con.used : {}).map(function (k) { return str(con.used[k]); }).filter(Boolean);
    out.push('## Bargains accepted', '');
    if (!owed.length) out.push('- (none)'); owed.forEach(function (t) { out.push('- ' + t); });
    if (struck.length) { out.push('', '## Bargains collected', ''); struck.forEach(function (t) { out.push('- ' + t); }); }
    out.push('', '## Callbacks used', '');
    if (!used.length) out.push('- (none)'); used.forEach(function (t) { out.push('- ' + t); });
    out.push('');
    return { filename: 'b68g-s' + pad2(n) + '-notes.md', text: out.join('\n') };
  }
  P.exportNote = exportNote;

  /* a console roll as plain text (Copy, "L files last roll") */
  function plainMd(s) { return str(s).replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/`([^`]+)`/g, '$1').replace(/\s+/g, ' ').trim(); }
  function consolePlain(res) {
    var m = res && res.meta || {}, out = [str(m.title) + (m.sub ? ' (' + str(m.sub) + ')' : '')];
    (res && res.lines || []).forEach(function (l) {
      if (l.kind === 'grid') (l.rows || []).forEach(function (r) { out.push(str(r.k) + ': ' + plainMd(r.md)); });
      else out.push(plainMd(l.md) + (l.small ? ' ' + plainMd(l.small) : ''));
    });
    return out.join('\n');
  }
  P.plainMd = plainMd; P.consolePlain = consolePlain;
  function stripSize(svg) { return str(svg).replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1').replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1'); }
  P.stripSize = stripSize;

  /* ---------- Find (Ctrl+K or /): one search over what the GM page holds ----------
     index: [{ kind, title, sub, text, go }]. Every word must be somewhere in title, sub or text; the title matching comes
     first. Curly and straight apostrophes are one. */
  function foldQ(s) { return str(s).toLowerCase().replace(/[’‘]/g, "'"); }
  function snippet(text, words) {
    var t = str(text).replace(/\s+/g, ' ').trim(), lo = foldQ(t), at = -1;
    (words || []).forEach(function (w) { var k = lo.indexOf(w); if (k >= 0 && (at < 0 || k < at)) at = k; });
    if (at < 0) return t.length > 110 ? t.slice(0, 110) + '…' : t;
    var a = Math.max(0, at - 40), b = Math.min(t.length, at + 90);
    return (a ? '…' : '') + t.slice(a, b) + (b < t.length ? '…' : '');
  }
  function findHits(index, q, max) {
    var words = foldQ(q).split(/\s+/).filter(Boolean), out = []; if (!words.length) return out;
    (index || []).forEach(function (e, i) {
      if (!isObj(e)) return;
      var t = foldQ(e.title), all = t + ' ' + foldQ(e.sub) + ' ' + foldQ(e.text);
      if (!words.every(function (w) { return all.indexOf(w) >= 0; })) return;
      var score = t.indexOf(words.join(' ')) === 0 ? 4 : words.every(function (w) { return t.indexOf(w) >= 0; }) ? 3 : words.some(function (w) { return t.indexOf(w) >= 0; }) ? 2 : 1;
      out.push({ e: e, score: score, i: i });
    });
    out.sort(function (a, b) { return b.score - a.score || a.i - b.i; });
    return out.slice(0, max || 40).map(function (h) { return Object.assign({}, h.e, { snip: h.score >= 3 && !str(h.e.text).trim() ? '' : snippet(h.e.text, words) }); });
  }
  /* Markdown as words for Find: callout and quote markers, task boxes, table pipes and rules out, then plainMd */
  function findText(mdSrc) {
    return plainMd(str(mdSrc).replace(/^[ \t]*(?:>[ \t]?)+/gm, '').replace(/\[![\w-]+\][-+]?/g, '').replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\][ \t]*/gm, '')
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '').replace(/^[ \t]*\|?[ \t:|-]*-{3,}[ \t:|-]*$/gm, ' ').replace(/\|/g, ' ').replace(/^[ \t]*[-*+][ \t]+/gm, '').replace(/\^[\w-]+$/gm, ''));
  }
  /* a label cut at a word, its trailing punctuation dropped */
  function shortLabel(t, n) { t = str(t).replace(/\s+/g, ' ').trim(); if (t.length <= n) return t; var c = t.slice(0, n + 1), sp = c.lastIndexOf(' '); return (sp > n * 0.5 ? c.slice(0, sp) : c).replace(/[\s,;:.·–—-]+$/, '') + '…'; }
  P.findHits = findHits; P.snippet = snippet; P.findText = findText; P.shortLabel = shortLabel;

  /* the table clocks the players may see, drawn for the iPad (a hidden clock never goes): an svg, or null with none to show */
  function fx(v) { return String(Math.round(v * 10) / 10); }
  function clocksSvg(clocks) {
    var list = (Array.isArray(clocks) ? clocks : []).filter(function (c) { return isObj(c) && !c.hidden; }).slice(0, 8);
    if (!list.length) return null;
    var cols = list.length <= 3 ? list.length : list.length === 4 ? 2 : list.length <= 6 ? 3 : 4, rows = Math.ceil(list.length / cols);
    var W0 = 1600, H0 = 900, cw = W0 / cols, ch = H0 / rows, r = Math.min(cw * 0.3, ch * 0.28), big = cols > 3 || rows > 1 ? 40 : 52;
    var out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W0 + ' ' + H0 + '"><rect width="' + W0 + '" height="' + H0 + '" fill="#15120e"/>';
    list.forEach(function (c, i) {
      var n = Math.max(2, Math.min(12, Math.floor(+c.size || 4))), f = Math.max(0, Math.min(n, Math.floor(+c.filled || 0)));
      var cx = cw * (i % cols) + cw / 2, cy = ch * Math.floor(i / cols) + ch * 0.42;
      out += '<g>';
      for (var k = 0; k < n; k++) {
        var a0 = k / n * 2 * Math.PI - Math.PI / 2, a1 = (k + 1) / n * 2 * Math.PI - Math.PI / 2;
        out += '<path d="M' + fx(cx) + ' ' + fx(cy) + 'L' + fx(cx + r * Math.cos(a0)) + ' ' + fx(cy + r * Math.sin(a0)) + 'A' + fx(r) + ' ' + fx(r) + ' 0 0 1 ' + fx(cx + r * Math.cos(a1)) + ' ' + fx(cy + r * Math.sin(a1)) +
          'Z" fill="' + (k < f ? '#d8a93b' : '#2b251d') + '" stroke="#f3ead8" stroke-width="5" stroke-linejoin="round"/>';
      }
      var name = str(c.name || 'Clock').replace(/\s+/g, ' ').trim();
      out += '<text x="' + fx(cx) + '" y="' + fx(cy + r + big + 14) + '" text-anchor="middle" font-family="Georgia, serif" font-size="' + big + '" fill="#f3ead8">' + esc(name.length > 34 ? name.slice(0, 33) + '…' : name) + '</text>' +
        '<text x="' + fx(cx) + '" y="' + fx(cy + r + big * 2 + 18) + '" text-anchor="middle" font-family="monospace" font-size="' + Math.round(big * 0.62) + '" fill="#bfb39c">' + f + ' / ' + n + '</text></g>';
    });
    return out + '</svg>';
  }
  P.clocksSvg = clocksSvg;

  /* the pack guard (scripts/lib/pack-guard.mjs, the same rules): what a new pack would lose against the one the page has.
     before / after: { <part>: body }. -> [what, ...] */
  var RETIRED_PARTS = P.RETIRED_PARTS = ['engagement'];        /* parts the app dropped on purpose (Engage, replaced by Score 17/10/2026): not a loss */
  function packLosses(before, after) {
    var out = [], kib = function (n) { return (n / 1024).toFixed(1) + ' KiB'; }, size = function (v) { return bytesOf(JSON.stringify(v)); };
    var base = function (rel) { return str(rel).split('/').pop().replace(/\.md$/i, ''); };
    var notesOf = function (b) { var m = {}; (isObj(b) && Array.isArray(b.notes) ? b.notes : []).forEach(function (n) { if (isObj(n)) m[str(n.rel || n.id)] = (Array.isArray(n.blocks) ? n.blocks : []).reduce(function (k, x) { return k + (isObj(x) ? str(x.src).length : 0); }, 0); }); return m; };
    Object.keys(isObj(before) ? before : {}).forEach(function (name) {
      var old = before[name]; if (old == null || RETIRED_PARTS.indexOf(name) >= 0) return;
      var now = isObj(after) ? after[name] : undefined;
      if (now == null) { out.push('the ' + name + ' part is gone' + (name === 'prep' ? ' (no note has gm_prep: true now)' : name === 'screen' ? ' (no note has gm_screen: true now)' : '')); return; }
      var b0 = size(old), b1 = size(now);
      if (b0 >= 2048 && b1 < b0 * 0.75) out.push('the ' + name + ' part shrank from ' + kib(b0) + ' to ' + kib(b1));
      if (name !== 'prep') return;
      var n0 = notesOf(old), n1 = notesOf(now);
      Object.keys(n0).forEach(function (rel) {
        if (!Object.prototype.hasOwnProperty.call(n1, rel)) out.push('prep note ' + base(rel) + ' is gone (its gm_prep: true is missing, or it moved)');
        else if (n0[rel] >= 1000 && n1[rel] < n0[rel] * 0.75) out.push('prep note ' + base(rel) + ' shrank from ' + n0[rel] + ' to ' + n1[rel] + ' characters');
      });
    });
    return out;
  }
  P.packLosses = packLosses;
  /* what uploading pk would lose against the pack the page has; a part the upload skips (see skippedParts) is not a loss */
  function importLosses(have, pk) {
    if (!have || !isObj(have.parts)) return [];
    var before = {}, after = {};
    Object.keys(have.parts).forEach(function (n) { var x = have.parts[n]; if (x && isObj(x.body)) before[n] = x.body; });
    Object.keys(pk.parts).forEach(function (n) { after[n] = partBody(pk.parts[n]); });
    skippedParts(pk).forEach(function (n) { delete before[n]; delete after[n]; });
    return packLosses(before, after);
  }
  P.importLosses = importLosses;

  /* The tables a pack lacks, by each module's own check(T) (console, location, npc, scenes, score, downtime), for the preview and the
     load to show as WARNINGS (never errors: the upload still works, and every roller falls back to a neutral word for a missing table;
     the downtime cards to the built-in tables). mods: { B68GmConsole, ..., B68DowntimeTables }; parts: { <part>: body }.
     -> [{ part, missing: [path] }]. A downtime part is laid over the built-in tables (app/downtime-tables.js, the third name), so it is
     checked laid over them: check(T, part's T). A part the pack lacks, a module or base tables not loaded and a check that throws say
     nothing. */
  var CHECKED = [['console', 'B68GmConsole'], ['location', 'B68GmLocation'], ['npc', 'B68GmNpc'], ['scenes', 'B68GmScenes'], ['score', 'B68GmScore'], ['downtime', 'B68GmDowntime', 'B68DowntimeTables']];
  function packWarnings(mods, parts) {
    var out = [];
    CHECKED.forEach(function (c) {
      var M = mods && mods[c[1]], body = parts && parts[c[0]], base = c[2] ? mods && mods[c[2]] : null;
      if (!M || typeof M.check !== 'function' || !isObj(body) || (c[2] && !(isObj(base) && isObj(base.T)))) return;
      var miss; try { miss = c[2] ? M.check(base.T, body.T) : M.check(body.T); } catch (e) { return; }
      miss = (Array.isArray(miss) ? miss : []).map(str).filter(Boolean);
      if (miss.length) out.push({ part: c[0], missing: miss });
    });
    return out;
  }
  /* "console: district, spend.Harm (+3 more)", one line per part, for a toast or a list */
  function packWarnLines(warns, n) {
    var k = n || 6;
    return (warns || []).map(function (w) { return w.part + ': ' + w.missing.slice(0, k).join(', ') + (w.missing.length > k ? ' (+' + (w.missing.length - k) + ' more)' : ''); });
  }
  P.packWarnings = packWarnings; P.packWarnLines = packWarnLines;

  /* ---------- Situations: the session on a capture, and the composed card ---------- */
  /* the session number the campaign document holds (a whole number >= 1), or undefined */
  function sessionOf(doc) {
    var n = isObj(doc) && isObj(doc.session) ? Math.floor(+doc.session.number) : NaN;
    return isFinite(n) && n >= 1 && n <= 9999 ? n : undefined;
  }
  P.sessionOf = sessionOf;
  /* one capture entry: id, bucket, text, at, and `s` (the session it was filed in, numbers only, absent when unknown) so
     the sync can file the line in the right session note */
  function captureEntry(id, bucket, text, at, doc) {
    var e = { id: id, bucket: bucket, text: text, at: at }, s = sessionOf(doc);
    if (s !== undefined) e.s = s;
    return e;
  }
  P.captureEntry = captureEntry;
  /* ---------- capture within a byte budget (E18): capture never blocks a roll ----------
     Capture used to grow to the state document's soft cap, after which rolls were refused mid-session. Now capture has its own byte
     budget (LIMITS.captureBytes). Over it, the oldest lines of EARLIER sessions (`s` a number below this session's) go first, oldest
     session first; this session's lines never go, nor a line with no session (nothing shows it is earlier). Only when this session
     alone is over the budget is new capture text refused. A roll is not capture: it is never refused for this. */
  function captureSize(id, e) { return bytes(e) + bytesOf(id) + 6; }       /* a line as the document counts it: its JSON, its key, the punctuation */
  function earlierLines(map, session) {
    if (typeof session !== 'number') return [];
    var m = isObj(map) ? map : {};
    return Object.keys(m).filter(function (k) { return isObj(m[k]) && typeof m[k].s === 'number' && m[k].s < session; })
      .sort(function (a, b) { var x = m[a], y = m[b]; return x.s - y.s || (str(x.at) < str(y.at) ? -1 : str(x.at) > str(y.at) ? 1 : a < b ? -1 : 1); });
  }
  /* the ids of earlier sessions' lines to drop to free `need` bytes (all of them when that is not enough) */
  function capShed(map, need, session) {
    var out = [], freed = 0;
    earlierLines(map, session).forEach(function (k) { if (freed < need) { out.push(k); freed += captureSize(k, map[k]); } });
    return out;
  }
  /* The patch that files one line: the 400-line cap as before, then the byte budget. -> { patch, dropped: [id], refused, bytes }
     (`patch` null when refused: this session alone is over the budget, so the line is not filed and nothing is dropped for it) */
  function capturePlan(map, id, entry, session, max) {
    var budget = max == null ? LIMITS.captureBytes : max, p = addCapped(map, id, entry, LIMITS.capture), cur = Object.assign({}, isObj(map) ? map : {}), dropped = [];
    cur[id] = entry;
    Object.keys(p).forEach(function (k) { if (p[k] === null) delete cur[k]; });
    var total = Object.keys(cur).reduce(function (n, k) { return n + captureSize(k, cur[k]); }, 0);
    if (total > budget) {
      var list = earlierLines(cur, session);                               /* the new line is this session's: never in it */
      for (var i = 0; i < list.length && total > budget; i++) { total -= captureSize(list[i], cur[list[i]]); p[list[i]] = null; dropped.push(list[i]); }
    }
    return total > budget ? { patch: null, dropped: [], refused: true, bytes: total } : { patch: p, dropped: dropped, refused: false, bytes: total };
  }
  P.capturePlan = capturePlan; P.capShed = capShed; P.captureSize = captureSize;
  /* the history / current-card entry for a composed card (id 'situation', never 'console'): replay info only */
  function situationEntry(res, con) {
    var rp = res.replay;
    return { id: rp.id, situation: rp.situation, seed: rp.seed, ui: rp.ui, mem: JSON.stringify(rp.mem), con: conSnapshot(con), composeVersion: rp.composeVersion, label: earlierLabel(res), at: nowIso() };
  }
  /* an entry stored before the composition was versioned has no composeVersion: the console reads that as version 1 and says it
     redrew the card (meta.recomposed), so the card never silently changes */
  function replaySituationEntry(C, T, campaign, e, fallback) {
    if (!C || !T || !isObj(e) || e.id !== 'situation') return null;
    var mem = {}, state = fallback || {};
    try { mem = JSON.parse(e.mem || '{}'); } catch (x) {}
    if (typeof e.con === 'string') { try { state = JSON.parse(e.con); } catch (x) {} }
    try { return C.create({ T: T, campaign: campaign || {}, state: state, mem: {} }).replay({ id: 'situation', situation: e.situation, seed: e.seed, ui: e.ui || {}, mem: mem, composeVersion: e.composeVersion }); } catch (x) { return null; }
  }
  P.situationEntry = situationEntry; P.replaySituationEntry = replaySituationEntry;
  /* a composed card as plain text (Copy, Pin, "L files last roll"): the position chip on the title line, no coaching lines, and a
     lead's first line only for what the lead does not already say (the spend sentence under it) */
  function situationPlain(res) {
    var m = res && res.meta || {}, chip = m.chips && m.chips[0] ? str(m.chips[0]) : '', sub = chip || str(m.sub);
    var out = [str(m.title) + (sub ? ' (' + sub + ')' : '')];
    (res && res.sections || []).forEach(function (s, i) {
      out.push((i ? 'Or ' : '') + str(s.title) + ': ' + plainMd(s.lead));
      (s.lines || []).forEach(function (l, j) {
        if (l.coach) return;
        if (l.kind === 'grid') { (l.rows || []).forEach(function (r) { out.push('  ' + str(r.k) + ': ' + plainMd(r.md)); }); return; }
        if (j === 0 && leadIsLine(s)) { if (l.small) out.push('  ' + plainMd(l.small)); return; }
        out.push('  ' + plainMd(l.md) + (l.small ? ' ' + plainMd(l.small) : ''));
      });
    });
    return out.join('\n');
  }
  /* the section's first line is exactly its lead (not a cut-down version of it): the card shows the lead once */
  function leadIsLine(s) {
    var l = s && s.lines && s.lines[0];
    return !!l && l.kind !== 'grid' && plainMd(l.md) === plainMd(s.lead);
  }
  P.situationPlain = situationPlain; P.leadIsLine = leadIsLine;
  /* the text of a pre-rolled draw as the Fixer reads it (the card as plain text, clipped under the server's 1500-character limit),
     and the signature of the controls a draw depends on: a pre-rolled draw is only replayed under the controls it was drawn for */
  var DRAW_CLIP = 1200;
  function drawTextOf(res) { var t = situationPlain(res).replace(/\n{3,}/g, '\n\n').trim(); return t.length > DRAW_CLIP ? t.slice(0, DRAW_CLIP - 1) + '…' : t; }
  function preSig(ui) { var u = isObj(ui) ? ui : {}; return JSON.stringify(Object.keys(u).sort().map(function (k) { return [k, u[k]]; })); }
  P.drawTextOf = drawTextOf; P.preSig = preSig; P.DRAW_CLIP = DRAW_CLIP;
  /* a roll's one-line text for "L" (the title and the lead) */
  /* An outcome card (A 4/5, A 1–3) is filed with what the console had set when it was drawn, in brackets after the title:
     "A 4/5 (risky, 2d, Bo): ...". Only fields the console holds: the Position, the dots if the GM set them, and the PC if one was selected (there is no effect
     control, so none is written). The Night Shift reads the bracket back; every other card keeps the plain "Title: text". */
  function lastText(res, dots) {
    var m = res && res.meta || {}, sit = m.id === 'situation' && res.sections && res.sections[0];
    var title = str(m.title), bits = [];
    if (sit && (m.situation === 'fourfive' || m.situation === 'onetothree')) {
      var ui = res.replay && res.replay.ui || {}, pos = m.position && m.position.pos;
      if (pos) bits.push(str(pos));
      if (Number.isInteger(dots) && dots >= 0 && dots <= 4) bits.push(dots + 'd');     /* the dots the GM set for this roll, only when set (zero is 0d) */
      if (ui.pc) bits.push(str(ui.pc).replace(/[(),:]/g, ' ').replace(/\s+/g, ' ').trim());
    }
    if (bits.length) title += ' (' + bits.join(', ') + ')';
    return sit ? title + ': ' + plainMd(res.sections[0].lead) : title + ': ' + plainMd(m.text);
  }
  P.lastText = lastText;
  /* classic lines -> html (`mdf` renders markdown: the page passes B68Markdown) */
  function linesHtml(lines, mdf) {
    var h = '';
    (lines || []).forEach(function (l) {
      if (l.kind === 'want') h += '<div class="gm-want">' + mdf(l.md) + (l.small ? '<div class="gm-small">' + mdf(l.small) + '</div>' : '') + '</div>';
      else if (l.kind === 'read') h += '<div class="gm-read">' + mdf(l.md) + '</div>';
      else if (l.kind === 'grid') h += '<dl class="gm-grid">' + (l.rows || []).map(function (r) { return '<dt>' + esc(r.k) + '</dt><dd>' + mdf(r.md) + '</dd>'; }).join('') + '</dl>';
    });
    return h;
  }
  function chipsHtml(chips) { return chips && chips.length ? '<p class="gm-chips">' + chips.map(function (c) { return '<span class="gm-chip">' + esc(c) + '</span>'; }).join('') + '</p>' : ''; }
  /* the merged actions (one row, each with its index into meta.actions) and Pin / Copy */
  function actsHtml(m, tool) {
    return '<div class="gm-card-acts">' + (m.actions || []).map(function (a, i) { return '<button type="button" class="btn sm primary" data-gm="intent" data-i="' + i + '">' + esc(a.label) + '</button>'; }).join('') +
      '<button type="button" class="btn sm" data-gm="pin" data-tool="' + esc(tool) + '">Pin</button><button type="button" class="btn sm" data-gm="copy" data-tool="' + esc(tool) + '">Copy</button></div>';
  }
  /* The classic card (a single table), exactly as before. */
  function classicCardHtml(res, mdf) {
    var m = res.meta || {};
    return '<article class="gm-card" data-tool="console"><header class="gm-card-h"><kbd class="gm-card-n">' + esc(m.n) + '</kbd><div><h3>' + esc(m.title) + '</h3>' + (m.sub ? '<p class="gm-sub">' + esc(m.sub) + '</p>' : '') + '</div></header>' +
      chipsHtml(m.chips) + linesHtml(res.lines, mdf) + actsHtml(m, 'console') + '</article>';
  }
  /* The coaching lines of a section ("Say it before the dice...": recurring guidance, flagged `coach` by the console) fold under a
     closed "Why", so a card reads as the draw and its numbers and the reasons are one tap away. */
  function whyHtml(lines, mdf) {
    return lines.length ? '<details class="gm-why"><summary>Why</summary><div class="gm-why-b">' + linesHtml(lines, mdf) + '</div></details>' : '';
  }
  function splitCoach(lines) {
    var plain = [], coach = [];
    (lines || []).forEach(function (l) { (l && l.coach ? coach : plain).push(l); });
    return { plain: plain, coach: coach };
  }
  /* The composed card: the LEAD box (big line, the spend sentence under it, chips, its own lines under "More"), then at most three
     one-line "Or" rows that open to their full section, then ONE merged actions row. */
  function situationCardHtml(res, mdf) {
    var m = res.meta || {}, secs = res.sections || [];
    var h = '<article class="gm-card gm-sit" data-tool="situation" data-sit="' + esc(m.situation) + '"><header class="gm-card-h"><kbd class="gm-card-n">' + esc(m.n) + '</kbd><div><h3>' + esc(m.title) + '</h3>' + (m.sub ? '<p class="gm-sub">' + esc(m.sub) + '</p>' : '') + '</div></header>';
    if (isObj(m.recomposed)) h += '<p class="gm-quiet" role="note">Redrawn with the current tables</p>';
    if (!secs.length) return h + linesHtml(res.lines, mdf) + actsHtml(m, 'situation') + '</article>';
    var lead = secs[0], ll = lead.lines || [], skip = leadIsLine(lead), cut = splitCoach(ll.slice(skip ? 1 : 0));
    /* the lead's first line IS the lead box (its `small`, a threat's spend sentence, sits under it); a lead cut at 120 characters keeps its full line under More */
    var small = ll[0] && ll[0].small ? '<div class="gm-lead-s">' + mdf(ll[0].small) + '</div>' : '';
    if (!skip && ll[0] && ll[0].small) cut.plain = cut.plain.map(function (l) { return l === ll[0] ? Object.assign({}, l, { small: '' }) : l; });
    var why = whyHtml(cut.coach, mdf);
    h += '<section class="gm-lead" data-sec="' + esc(lead.id) + '"><p class="gm-lead-k">' + esc(lead.title) + '</p><p class="gm-lead-t">' + esc(lead.lead) + '</p>' + small + chipsHtml(lead.chips) +
      (cut.plain.length ? '<details class="gm-more"><summary>More</summary><div class="gm-more-b">' + linesHtml(cut.plain, mdf) + why + '</div></details>' : why) + '</section>';
    secs.slice(1, 4).forEach(function (s) {
      var c = splitCoach(s.lines);
      h += '<details class="gm-or" data-sec="' + esc(s.id) + '"><summary><span class="gm-or-k">Or</span><span class="gm-or-t"><b>' + esc(s.title) + '</b> ' + esc(s.lead) + '</span></summary><div class="gm-or-b">' +
        (s.sub ? '<p class="gm-sub">' + esc(s.sub) + '</p>' : '') + chipsHtml(s.chips) + linesHtml(c.plain, mdf) + whyHtml(c.coach, mdf) + '</div></details>';
    });
    return h + actsHtml(m, 'situation') + '</article>';
  }
  P.linesHtml = linesHtml; P.classicCardHtml = classicCardHtml; P.situationCardHtml = situationCardHtml;

  if (!W || !W.document) return { _pure: P };

  /* =====================================================================================================================
     The page
     ===================================================================================================================== */
  var document = W.document;
  var IDB = 'b68-gm', STORE = 'kv', STICKY = 'b68.gm.sticky', PREP_NOTE = 'b68.gm.prepNote', PREP_WIDE = 'b68.gm.prepWide';
  /* what the bar says when the Access session has ended (the saver is on hold; GM.md "Saving"), and the error a request that meets the sign-in page gets */
  var SIGNED_OUT_MSG = 'Signed out: reload to sign in. Your notes are kept on this device.', SIGNED_OUT_ERR = 'signed out: reload the page to sign in again';
  /* The app layout (gm.css): the window is the page, a slim top bar in place of the site header, and on a laptop the columns
     scroll on their own with capture at the foot. body.gm-app turns it on while the tools are open; the loading and import
     screens keep the site header. */
  function setApp(on) { if (document.body) document.body.classList.toggle('gm-app', !!on); }
  var S = null;                  /* the open page; null when closed */
  var camp = null;               /* the latest campaign document from boot */
  var gate = makeGate(hiddenSecretNames);
  var lastSaver = null;          /* the newest session's saver: pagehide sends what it still holds */
  var keptApi = null;            /* the page api of the last open() that found the GM: the heat sync outlives the page (campaign() keeps arriving) */
  /* The ambient document as the server holds it (the truth), what the iPad was last told to spotlight, and the panel's state.
     Module-level, not in S: the heat / wanted sync keeps running while the page is closed. */
  var AM = { doc: null, seq: null, updatedAt: null, shown: null, loaded: false, busy: 0, error: '', displayRead: false };
  /* the display queue (pushDisplay): the push in flight and the one waiting behind it */
  var DQ = { busy: null, next: null };
  /* The theme the opening credits play, app/media/theme.mp3: gitignored, so it is on the server only when the deploying PC had it.
     The panel asks the server (HEAD, same origin) when it opens, and says so, because a silent iPad is otherwise a mystery. */
  var THEME = { state: 'unknown', http: 0, at: 0, busy: false };

  function toast(msg, bad) { var A = W.B68; if (A && A.toast) A.toast(msg, !!bad); }
  function errText(e) { return e && e.message || String(e || 'unknown error'); }
  function md(s) { var R = W.B68Markdown; return R && R.render ? R.render(str(s)) : '<p>' + esc(s) + '</p>'; }
  function gmApi() { return S && S.api && S.api.gm ? S.api.gm() : (W.claude && W.claude.gm) || null; }
  function $q(sel) { return S && S.root ? S.root.querySelector(sel) : null; }
  function part(name) { var p = S && S.pack && S.pack.parts && S.pack.parts[name]; return p ? p.body : null; }

  /* ---------- IndexedDB (the pack cache) ---------- */
  function idbOpen() {
    return new Promise(function (res, rej) {
      if (!W.indexedDB) { rej(new Error('no IndexedDB')); return; }
      var r; try { r = W.indexedDB.open(IDB, 1); } catch (e) { rej(e); return; }
      r.onupgradeneeded = function () { try { r.result.createObjectStore(STORE); } catch (e) {} };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('IndexedDB failed')); };
      r.onblocked = function () { rej(new Error('IndexedDB blocked')); };
    });
  }
  function idbDo(mode, fn) {
    return idbOpen().then(function (db) {
      return new Promise(function (res, rej) {
        var out, tx; try { tx = db.transaction(STORE, mode); out = fn(tx.objectStore(STORE)); } catch (e) { db.close(); rej(e); return; }
        tx.oncomplete = function () { db.close(); res(out && 'result' in out ? out.result : out); };
        tx.onerror = tx.onabort = function () { db.close(); rej(tx.error || new Error('IndexedDB transaction failed')); };
      });
    });
  }
  var kvGet = function (k) { return idbDo('readonly', function (s) { return s.get(k); }); };
  var kvSet = function (k, v) { return idbDo('readwrite', function (s) { s.put(v, k); }); };
  var kvDel = function (k) { return idbDo('readwrite', function (s) { s.delete(k); }); };
  /* every pack:* key, whoever cached it; the database is only opened if it exists (no empty database for a player) */
  function purge() {
    keptApi = null; AM.doc = null; AM.shown = null; AM.loaded = false; AM.seq = null;
    try { W.localStorage.removeItem(STICKY); } catch (e) {}
    if (!W.indexedDB) return Promise.resolve(0);
    var exists = typeof W.indexedDB.databases === 'function'
      ? Promise.resolve().then(function () { return W.indexedDB.databases(); }).then(function (l) { return (l || []).some(function (d) { return d && d.name === IDB; }); }, function () { return true; })
      : Promise.resolve(true);
    return exists.then(function (yes) {
      if (!yes) return 0;
      return idbDo('readwrite', function (s) {
        var n = { result: 0 }, cur = s.openCursor();
        cur.onsuccess = function () { var c = cur.result; if (!c) return; if (String(c.key).indexOf('pack:') === 0) { c.delete(); n.result++; } c.continue(); };
        return n;
      });
    }).catch(function () { return 0; });
  }

  /* ---------- sticky (localStorage): live controls and current cards (replay info only), and any refused patch ---------- */
  function readSticky() { try { var s = JSON.parse(W.localStorage.getItem(STICKY) || 'null'); return isObj(s) && s.v === 1 && s.user === S.me ? s : null; } catch (e) { return null; } }
  /* `parked` is a patch the server REFUSED (kept, never resent). `pending` is what has not gone because the Access session ended
     (E5), or was resent after a reload and not yet answered: it is sent once on the next open. They are never the same thing. */
  function writeSticky() {
    if (!S) return;
    var st = S.saver ? S.saver.state() : null, parked = st ? st.parked : null, pending = null;
    if (S.carriedParked) parked = parked ? mergePatch(S.carriedParked, parked) : S.carriedParked;
    if (S.saver && (st.hold || S.resent)) { pending = S.saver.unsent(); if (!pending) S.resent = false; }
    try { W.localStorage.setItem(STICKY, JSON.stringify({ v: 1, user: S.me, live: (S.doc.con || {}).live || {}, cards: S.doc.cards || {}, now: isObj(S.doc.now) ? S.doc.now : undefined, parked: parked || undefined, pending: pending || undefined, at: nowIso() })); } catch (e) {}
  }
  /* a closed session met the sign-out (its write was in flight when the page was left): only its unsent changes go into the sticky copy,
     never its live controls or cards (a newer session may be open) */
  function keepPending(me) {
    try {
      var u = me.saver && me.saver.unsent(), s = JSON.parse(W.localStorage.getItem(STICKY) || 'null');
      if (!isObj(s) || s.v !== 1 || s.user !== me.me) { if (!u) return; s = { v: 1, user: me.me, live: {}, cards: {} }; }
      var carried = isObj(s.pending) ? s.pending : null;
      s.pending = u ? (carried ? mergePatch(carried, u) : u) : (carried || undefined);
      W.localStorage.setItem(STICKY, JSON.stringify(s));
    } catch (e) {}
  }

  /* ---------- the GM state document ---------- */
  var HARD = LIMITS.stateCap - 4096;          /* the server's cap less a margin for its own keys */
  /* every change goes through here: sized in bytes; refused past the soft cap (a roll, `force`, may go up to the hard cap) */
  function patch(p, opts) {
    if (!S || !S.saver) return false;
    var next = applyPatch(S.doc, p), b = bytes(next), force = !!(opts && opts.force);
    /* A roll is never refused for want of room (E18): past the hard line the oldest lines of EARLIER sessions' capture make it (never
       this session's). The nulls ride in the same patch, so the server frees them as it takes the roll. */
    for (var guard = 0; force && b > HARD && guard < 4; guard++) {
      var shed = capShed(next.capture, b - HARD, sessionOf(camp));
      if (!shed.length) break;
      var nulls = {}; shed.forEach(function (k) { nulls[k] = null; });
      p = mergePatch(p, { capture: nulls }); next = applyPatch(S.doc, p); b = bytes(next);
      capDropped(shed.length);
    }
    if (b > (force ? HARD : LIMITS.stateSoft)) { toast('The GM notes are full (' + Math.round(b / 1024) + ' of 256 KiB). Export tonight’s note and clear the capture first.', true); return false; }
    S.doc = next;
    S.saver.add(p);
    writeSticky();
    if (guard) renderCapture();
    return true;
  }
  /* one toast per page load when capture lines of earlier sessions were dropped to keep the notes small (E18) */
  var capDroppedToasted = false;
  /* -> true when it said so (the caller must not cover that toast with its own) */
  function capDropped(n) {
    if (!n || capDroppedToasted) return false;
    capDroppedToasted = true;
    toast('Dropped ' + n + ' old capture line' + (n === 1 ? '' : 's') + ' from earlier sessions to keep the notes small. npm run gm:after files them into the vault: run it after each game.', true);
    return true;
  }
  var CAP_FULL = 'Tonight’s capture is full: this session alone has filled its ' + (LIMITS.captureBytes / 1024) + ' KiB. Export tonight’s note, then clear the capture to file more. Rolls still work.';
  /* one saver per page session: it keeps flushing after close() until what was pending has gone */
  function makeSessionSaver(me) {
    return makeSaver({
      debounce: LIMITS.debounce,
      delay: function (fn, ms) { return setTimeout(fn, ms); }, cancel: function (h) { clearTimeout(h); },
      send: function (p) { var g = gmApi() || (W.claude && W.claude.gm); if (!g) return Promise.reject(new Error('the GM tools are not available')); return g.patchState(p); },
      /* pagehide / hidden tab: a keepalive request outlives the page (64 KiB at most; bigger goes the normal way) */
      beacon: function (p) {
        var body = JSON.stringify(p);
        if (bytesOf(body) > 60000 || typeof W.fetch !== 'function') { var g = W.claude && W.claude.gm; return g ? g.patchState(p) : Promise.reject(new Error('no gm')); }
        return W.fetch('/api/gm/state', { method: 'PATCH', keepalive: true, credentials: 'same-origin', cache: 'no-store', redirect: 'manual', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: body })
          .then(function (res) {
            /* the sign-in page instead of the API (a 401, or Access's redirect, which `redirect: 'manual'` shows as an opaque one) is the sign-out */
            if (res.status === 401 || res.type === 'opaqueredirect' || res.redirected) { var so = new Error(SIGNED_OUT_ERR); so.status = 401; so.code = 'signed_out'; throw so; }
            if (!res.ok) { var e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
            return res.json();
          });
      },
      saved: function (r, pendingAfter) {
        if (!r || !isObj(r.doc)) return;
        me.updatedAt = r.updatedAt || me.updatedAt;
        me.doc = pendingAfter ? applyPatch(r.doc, pendingAfter) : r.doc;
      },
      changed: function (st) {
        if (S !== me) { if (st.hold) keepPending(me); return; }
        syncSave();
        if (st.hold && !me.holdToasted) { me.holdToasted = true; toast(SIGNED_OUT_MSG, true); }
        if (st.hold || me.resent) writeSticky();
        if (st.parked && !me.parkedToasted) { me.parkedToasted = true; toast('Not saved: the server refused a change (' + st.error + '). It is kept on this device; later changes still save.', true); writeSticky(); }
      }
    });
  }
  function flush() { return S && S.saver ? S.saver.flush() : Promise.resolve(); }
  function busy() { var st = S && S.saver ? S.saver.state() : null; return !!(st && (st.pending || st.writing)); }
  function syncSave() {
    if (!S || !S.root || !S.saver) return;
    var st = S.saver.state();
    [].forEach.call(S.root.querySelectorAll('.gm-save'), function (n) {
      n.textContent = st.hold ? 'Signed out' : st.parked ? 'Not saved' : st.error === 'retrying' ? 'Offline: retrying' : st.writing || st.pending ? 'Saving…' : S.updatedAt ? 'Saved' : '';
      n.classList.toggle('bad', !!st.hold || !!st.parked || st.error === 'retrying');
      if (st.hold) n.title = SIGNED_OUT_MSG; else if (st.parked) n.title = 'The server refused a change: ' + st.error;
    });
    /* signed out: a plain message across the bar (a full-width second row of it, so it never squeezes the bar's buttons) */
    var bar = $q('.gm-bar'), msg = $q('#gm-signed');
    if (bar) bar.classList.toggle('out', !!st.hold);
    if (msg) { msg.hidden = !st.hold; if (st.hold) msg.removeAttribute('hidden'); else msg.setAttribute('hidden', ''); }
    var rt = S.root.querySelector && S.root.querySelector('#gm-root');
    if (rt && rt.style && rt.style.setProperty && bar && bar.getBoundingClientRect) { var bh = Math.round(bar.getBoundingClientRect().height); if (bh > 0) rt.style.setProperty('--gm-bar-h', bh + 'px'); }
  }
  /* another device changed the state: take it when nothing of ours is waiting */
  function refetch() {
    if (!S || S.status !== 'ready' || busy()) return;
    var g = gmApi(), me = S; if (!g) return;
    Promise.resolve().then(function () { return g.state(); }).then(function (r) {
      if (S !== me || busy() || !r || !isObj(r.doc)) return;
      if (r.updatedAt && r.updatedAt === me.updatedAt) return;
      me.doc = r.doc; me.updatedAt = r.updatedAt; adoptMem(); redrawAll(); writeSticky();
      liveTokens();       /* another device moved a marker or a pin (M3) */
    }).catch(function () {});
  }
  function live() { var c = S.doc.con; return isObj(c) && isObj(c.live) ? c.live : {}; }

  /* ---------- Now in: the one district the tools start from ----------
     GM state `now: { district }`, set in the top bar (on a phone, in the Scene line). The console's District, the Street scene's,
     the Location's and the NPC generator's pickers each lead with "Now in: …", which follows it; picking a district there is that
     tool's own and stays through a change of Now in; "any" keeps a tool on any. A tool's stored choice is '' (never set: it
     follows), NOW_ANY ('*': any) or a district name (its own). A roll stores the district it resolved to in its own `ui`, so
     Earlier and a replay never move when Now in does. Each tool has its own list (its pack part's), so a name is matched without
     case, a leading "the" or punctuation, and a tool whose list lacks it rolls on any. (The Score panel's Where is the exception: it
     defaults to where the target is, and offers Now in as one of its choices.) */
  var NOW_ANY = '*';
  function dkey(s) { return str(s).toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ''); }
  function nowDistrict() { return S && S.doc && isObj(S.doc.now) ? str(S.doc.now.district).trim() : ''; }
  function uiOf(k) { var d = S.doc[k]; return isObj(d) && isObj(d.ui) ? d.ui : {}; }
  /* each tool's district picker: its control (the options are the tool's own list), where its choice is kept, and its select */
  var DIST = {
    con: { sel: '#gm-c-district', ctl: function () { return ctlList().filter(function (c) { return c.id === 'district'; })[0]; }, raw: function () { return live().district; } },
    loc: { sel: '#gm-l-district', ctl: function () { var L = W.B68GmLocation, pk = part('location'); try { return L && pk ? L.controls(pk).controls.filter(function (x) { return x.key === 'district'; })[0] : null; } catch (e) { return null; } }, raw: function () { return uiOf('loc').district; } },
    scn: { sel: '#gm-s-sel', ctl: function () { var sc = scnInst(); return sc ? sc.controls.filter(function (x) { return x.id === 'sel'; })[0] : null; }, raw: function () { return uiOf('scn').sel; } },
    npc: { sel: '#gm-n-district', ctl: function () { var g = npcgInst(); return g ? g.controls.filter(function (x) { return x.id === 'district'; })[0] : null; }, raw: function () { return uiOf('npc').district; } }
  };
  function distOpts(t) { var c = DIST[t].ctl(); return c && Array.isArray(c.options) ? c.options : []; }
  function distNames(t) { return distOpts(t).map(function (o) { return str(o.value); }).filter(Boolean); }
  /* the tool's own spelling of Now in, '' when its list does not hold it */
  function nowIn(names) { var k = dkey(nowDistrict()); return k ? names.filter(function (n) { return dkey(n) === k; })[0] || '' : ''; }
  /* the district a tool rolls on: its own pick, else Now in (when its list holds it), else any */
  function distFor(t) { var v = str(DIST[t].raw()); return v === NOW_ANY ? '' : v ? v : nowIn(distNames(t)); }
  /* a picker's options: Now in first (it follows), then any (this tool's own, kept), then the districts */
  function distOptionsHtml(t) {
    var opts = distOpts(t), raw = str(DIST[t].raw()), now = nowDistrict(), mine = nowIn(distNames(t)), any = opts.filter(function (o) { return str(o.value) === ''; })[0];
    var list = [{ value: '', label: 'Now in: ' + (!now ? 'anywhere' : mine ? mine : 'any (no ' + now + ' here)') }, { value: NOW_ANY, label: any ? str(any.label) : 'any' }].concat(opts.filter(function (o) { return str(o.value) !== ''; }));
    if (raw && raw !== NOW_ANY && !list.some(function (o) { return str(o.value) === raw; })) list.push({ value: raw, label: raw });
    return list.map(function (o) { return '<option value="' + esc(o.value) + '"' + (str(o.value) === raw ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('');
  }
  /* the bar's list: every tool's districts once (alphabetical), and a Now in the packs no longer hold, so the select tells the truth */
  function nowNames() {
    var out = [], seen = {}, cur = nowDistrict();
    Object.keys(DIST).forEach(function (t) { distNames(t).forEach(function (n) { var k = dkey(n); if (k && !seen[k]) { seen[k] = 1; out.push(n); } }); });
    out.sort(function (a, b) { return dkey(a) < dkey(b) ? -1 : dkey(a) > dkey(b) ? 1 : 0; });
    if (cur && !seen[dkey(cur)]) out.push(cur);
    return out;
  }
  /* the Now in selects (the bar's and the phone's Scene line's) are redrawn only when what they show changed: a redraw would
     close a list that is open */
  function renderNow(force) {
    if (!S || S.status !== 'ready' || !S.root) return;
    var names = nowNames(), cur = nowDistrict(), k = dkey(cur), sig = JSON.stringify([names, cur]);
    [].forEach.call(S.root.querySelectorAll('select[data-now]'), function (sel) {
      if (force || sel.__sig !== sig) {
        sel.innerHTML = '<option value=""' + (cur ? '' : ' selected') + '>anywhere</option>' + names.map(function (n) { return '<option value="' + esc(n) + '"' + (k && dkey(n) === k ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
        sel.__sig = sig;
      }
      var box = sel.closest ? sel.closest('.gm-now, .gm-nowline') : null; if (box) { box.hidden = !names.length; if (names.length) box.removeAttribute('hidden'); else box.setAttribute('hidden', ''); }
    });
  }
  /* the four pickers' first choice names Now in: redrawn in place (never the panes), and the Scene line's chips follow */
  function syncDistricts() {
    Object.keys(DIST).forEach(function (t) { var el = $q(DIST[t].sel); if (!el) return; var html = distOptionsHtml(t); if (el.__opts !== html || el.value !== str(DIST[t].raw())) { el.innerHTML = html; el.__opts = html; } });
    renderChips();
  }
  function setNow(v) {
    v = str(v).trim().slice(0, 120); if (v === nowDistrict()) return;
    patch({ now: { district: v } }); renderNow(); syncDistricts(); scMaybeRedraw();
  }
  function adoptMem() {
    var m = isObj(S.doc.mem) ? S.doc.mem : {};
    if (S.con) { var cm = S.con.mem(); Object.keys(cm).forEach(function (k) { delete cm[k]; }); Object.assign(cm, clone(m.console || {})); }
    S.locMem = clone(m.location || {}); S.scnMem = clone(m.scenes || {}); S.npcMem = clone(m.npc || {}); S.dtMem = clone(m.downtime || {}); S.scMem = clone(m.score || {});
    if (S.con) { try { S.con.setCampaign(part('campaign') || {}, S.doc.con || {}); } catch (e) {} }
  }

  /* ---------- the pack: IndexedDB copy, then the server's index, fetching only changed parts ---------- */
  function parseBody(b) { if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return null; } } return isObj(b) ? b : null; }
  function syncPack() {
    var key = 'pack:' + S.me, g = gmApi(), me = S;
    return kvGet(key).catch(function () { return null; }).then(function (cached) {
      if (S !== me) return 'closed';
      me.pack = isObj(cached) && isObj(cached.parts) ? cached : null;
      return Promise.resolve().then(function () { return g.pack(); }).then(function (idx) {
        var parts = isObj(idx && idx.parts) ? idx.parts : {}, names = Object.keys(parts);
        if (!names.length) { me.pack = null; kvDel(key).catch(function () {}); return 'nopack'; }
        var have = me.pack ? me.pack.parts : {}, next = {}, chain = Promise.resolve();
        names.forEach(function (n) {
          if (have[n] && have[n].version === parts[n].version && isObj(have[n].body)) { next[n] = have[n]; return; }
          chain = chain.then(function () { return g.packPart(n); }).then(function (r) {
            var body = parseBody(r && r.body); if (!body) throw new Error('part ' + n + ' arrived empty');
            next[n] = { version: r.version, src: isObj(r.src) ? r.src : {}, body: body };
          });
        });
        return chain.then(function () {
          me.pack = { version: idx.version, parts: next, savedAt: nowIso() };
          return kvSet(key, me.pack).catch(function () {}).then(function () { return 'ready'; });
        }, function (e) {
          /* a part would not download: carry on with the copy on this device (it stays as it was) */
          if (e && e.status === 403) return 'forbidden';
          if (me.pack && Object.keys(me.pack.parts || {}).length) { me.offline = true; return 'ready'; }
          throw e;
        });
      }, function (e) {
        if (e && e.status === 403) return 'forbidden';
        if (me.pack) { me.offline = true; return 'ready'; }
        throw e;
      });
    });
  }

  /* ---------- open / close ---------- */
  function open(rootEl, api) {
    close();
    S = { root: rootEl, api: api, me: null, status: 'loading', doc: {}, updatedAt: null, saver: null, carriedParked: null,
      pack: null, con: null, conRes: null, conErr: '', locRoll: null, locMem: {}, locErr: '', map: null, panel: 'location', seg: 'console', scn: null, scnRoll: null, scnMem: {}, scnErr: '',
      sc: null, scRoll: null, scMem: {}, scErr: '', scSig: null, scCtxSig: '', scBusy: {},
      dt: null, dtDists: null, dtRoll: null, dtSig: null, dtMem: {}, dtErr: '', dtNote: '', dtBusy: {},
      arm: 'n', last: null, npcs: {}, npcUnsub: null, sceneOpen: false, capOpen: false, pinOpen: null, figMemo: {}, importing: null, shown: 'console' };
    try { S.panel = W.localStorage.getItem('b68.gm.panel') || 'location'; S.prepWide = W.localStorage.getItem(PREP_WIDE) === '1'; } catch (e) {}
    if (SIDE.indexOf(S.panel) < 0) S.panel = 'location';
    S.saver = lastSaver = makeSessionSaver(S);
    wire(rootEl);
    screen('<p class="gm-wait" role="status">Opening the GM tools…</p>');
    var me = S;
    Promise.resolve().then(function () { return api && api.ready ? api.ready() : null; }).then(function () {
      if (S !== me) return;
      if (!gmApi()) { screen(note('GM tools are available on the hosted app.', 'Open the hosted site, signed in as the GM, to use the console, the location generator and the iPad display.')); me.status = 'off'; return; }
      if (!(api.isGM && api.isGM())) { if (api.roleKnown && api.roleKnown()) purge(); screen(note('GM only.', 'This page holds the GM’s tools. Sign in as the GM to use it.')); me.status = 'off'; return; }
      me.me = (api.me && api.me()) || 'gm';
      keptApi = api;
      camp = api.campaign ? api.campaign() : camp;
      return load();
    }).catch(function (e) { if (S === me) screen(note('The GM tools could not open.', errText(e), true)); });
  }
  function load() {
    var me = S, g = gmApi();
    screen('<p class="gm-wait" role="status">Loading the GM pack…</p>');
    var sticky = readSticky();
    var st = Promise.resolve().then(function () { return g.state(); }).then(function (r) { return r; }, function (e) { return { failed: e }; });
    return Promise.all([syncPack(), st]).then(function (res) {
      if (S !== me) return;
      var r = res[1];
      if (r && isObj(r.doc)) { me.doc = r.doc; me.updatedAt = r.updatedAt || null; }
      else if (sticky) { me.doc = { con: { live: sticky.live || {} }, cards: sticky.cards || {} }; if (isObj(sticky.now)) me.doc.now = sticky.now; toast('The GM notes are offline: showing this device’s last copy.', true); }
      if (sticky && isObj(sticky.parked)) me.carriedParked = sticky.parked;   /* a change the server refused earlier stays on this device */
      if (sticky && isObj(sticky.pending) && Object.keys(sticky.pending).length) me.stickyPending = sticky.pending;   /* sent by start() (resendPending) */
      if (res[0] === 'forbidden') { purge(); screen(note('GM only.', 'The server says this account is not the GM.')); me.status = 'off'; return; }
      if (res[0] === 'nopack' || !me.pack) { me.status = 'import'; importScreen(false); return; }
      start();
    }).catch(function (e) { if (S === me) screen(note('The GM pack could not load.', errText(e) + '. Check the connection and open the page again.', true) + '<p><button type="button" class="btn sm" data-gm="retry">Try again</button></p>'); });
  }
  function close() {
    if (!S) return;
    var me = S;
    if (me.saver) me.saver.flush();          /* session-scoped: anything added while a write is in flight still goes */
    if (me.npcUnsub) { try { me.npcUnsub(); } catch (e) {} }
    if (me.prepTimer) { W.clearInterval(me.prepTimer); me.prepTimer = null; }
    if (me.sttTimer) { W.clearInterval(me.sttTimer); me.sttTimer = null; }
    if (me.cogm) { cogmStop(me); me.cogm = null; }
    if (me.assist) { try { me.assist.destroy(); } catch (e) {} me.assist = null; }
    apUnmount(me);
    S = null;
    setApp(false);
    if (me.root) { me.root.innerHTML = ''; }
    unblank();
  }

  /* ---------- screens ---------- */
  function screen(html) { if (!S || !S.root) return; setApp(false); S.root.innerHTML = '<div class="gm gm-screen">' + html + '</div>'; }
  function note(title, body, bad) { return '<div class="gm-head"><div class="gm-title"><p class="gm-kick">GM tools</p><h1 class="gm-h" tabindex="-1">' + esc(title) + '</h1></div></div><p class="gm-note' + (bad ? ' bad' : '') + '">' + esc(body) + '</p>'; }

  function importScreen(cancellable) {
    S.status = 'import'; S.importing = null;
    screen('<div class="gm-head"><div class="gm-title"><p class="gm-kick">GM tools</p><h1 class="gm-h" tabindex="-1">Import the GM pack</h1></div></div>' +
      '<div class="gm-import">' +
      '<p>The generators’ tables are GM-only and never part of the app. ' + 'Build the pack on the GM’s PC with <code>npm run gm:pack</code> (it writes <code>gm-private/b68-gm-pack.json</code>), then choose that file here. ' + 'It is uploaded to the server, where only the GM can read it, and kept on this device.</p>' +
      '<p><label class="btn primary gm-pick">Choose b68-gm-pack.json<input type="file" id="gm-file" accept="application/json,.json" class="gm-file"></label>' + (cancellable ? ' <button type="button" class="btn" data-gm="cancel-import">Cancel</button>' : '') + '</p>' +
      '<div id="gm-prev" class="gm-prev" aria-live="polite"></div></div>');
  }
  function previewPack(pk, name) {
    var v = validatePack(pk), box = $q('#gm-prev'); if (!box) return;
    S.importing = v.ok ? pk : null;
    /* the guard: what this file would lose against the pack the page has (16/10: an old note from Sync dropped the prep) */
    var losses = v.ok ? importLosses(S.pack, pk) : [];
    S.importLosses = losses;
    /* the tables the file lacks, by each module's own check: a warning (the upload still works) */
    var warns = [];
    if (v.ok) { var bodies = {}; Object.keys(pk.parts).forEach(function (n) { if (isObj(pk.parts[n])) bodies[n] = partBody(pk.parts[n]); }); warns = packWarnings(modMap(), bodies); }
    var rows = v.parts.map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td class="num">' + (p.bytes / 1024).toFixed(1) + ' KiB</td><td>' + esc(p.src && p.src.exportedAt ? dmy(p.src.exportedAt) : '') + '</td></tr>'; }).join('');
    box.innerHTML = '<h2>' + esc(name || 'The pack') + '</h2>' +
      (v.exportedAt ? '<p class="gm-dim">Exported ' + esc(dmy(v.exportedAt)) + ' · ' + v.parts.length + ' part' + (v.parts.length === 1 ? '' : 's') + '</p>' : '') +
      (rows ? '<table class="gm-tbl"><thead><tr><th>Part</th><th class="num">Size</th><th>Exported</th></tr></thead><tbody>' + rows + '</tbody></table>' : '') +
      (v.errors.length ? '<ul class="gm-errs">' + v.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' : '') +
      packWarnHtml(warns) +
      (losses.length ? '<div class="gm-note bad gm-losses"><p><b>This pack would lose prep the app has now:</b></p><ul>' + losses.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' +
        '<p>Usually Obsidian Sync brought back an old copy of a note. Restore it (Obsidian: right-click the note › Open version history), run <code>npm run gm:pack</code>, then choose the new file.</p></div>' : '') +
      '<p class="gm-up"><button type="button" class="btn ' + (losses.length ? 'bad' : 'primary') + '" data-gm="upload"' + (v.ok ? '' : ' disabled') + '>' + (losses.length ? 'Upload anyway' : 'Upload ' + v.parts.length + ' part' + (v.parts.length === 1 ? '' : 's')) + '</button> <progress id="gm-prog" max="' + Math.max(1, v.parts.length) + '" value="0" hidden></progress> <span id="gm-upmsg" class="gm-dim" role="status"></span></p>';
  }
  /* the pack check as a list: a warning, never an error (the rollers use a neutral word for a table the pack lacks) */
  function modMap() { return { B68GmConsole: W.B68GmConsole, B68GmLocation: W.B68GmLocation, B68GmNpc: W.B68GmNpc, B68GmScenes: W.B68GmScenes, B68GmScore: W.B68GmScore, B68GmDowntime: W.B68GmDowntime, B68DowntimeTables: W.B68DowntimeTables }; }
  function packWarnHtml(warns) {
    if (!warns.length) return '';
    var n = warns.reduce(function (k, w) { return k + w.missing.length; }, 0);
    return '<div class="gm-note warn gm-warns" role="status"><p><b>' + n + ' table entr' + (n === 1 ? 'y is' : 'ies are') + ' missing.</b> This is a warning, not an error: the upload works, and a roll that needs one uses a neutral word.</p><ul>' +
      warns.map(function (w) { return '<li><b>' + esc(w.part) + '</b>: ' + esc(w.missing.slice(0, 12).join(', ')) + (w.missing.length > 12 ? ' (+' + (w.missing.length - 12) + ' more)' : '') + '</li>'; }).join('') + '</ul></div>';
  }
  /* the loaded pack's check: the Menu keeps the list, and a toast says so once per page load (per distinct list) */
  var packWarnSeen = '';
  function checkPack() {
    var bodies = {}; Object.keys(S.pack && S.pack.parts || {}).forEach(function (n) { var b = S.pack.parts[n] && S.pack.parts[n].body; if (isObj(b)) bodies[n] = b; });
    S.packWarn = packWarnings(modMap(), bodies);
    renderPackWarn();
    var sig = JSON.stringify(S.packWarn);
    if (S.packWarn.length && sig !== packWarnSeen) {
      packWarnSeen = sig;
      var n = S.packWarn.reduce(function (k, w) { return k + w.missing.length; }, 0);
      toast('The pack is missing ' + n + ' table entr' + (n === 1 ? 'y' : 'ies') + ' (' + S.packWarn.map(function (w) { return w.part; }).join(', ') + '): rolls use a neutral word for them. The Menu lists them.');
    }
  }
  function renderPackWarn() {
    var box = $q('#gm-menu-warn'); if (!box) return;
    var w = S.packWarn || [];
    box.hidden = !w.length; if (w.length) box.removeAttribute('hidden'); else box.setAttribute('hidden', '');
    box.innerHTML = w.length ? '<b>Pack check</b> <span class="gm-dim">a warning: rolls use a neutral word for these</span><ul>' + w.map(function (x) { return '<li><b>' + esc(x.part) + '</b>: ' + esc(x.missing.slice(0, 8).join(', ')) + (x.missing.length > 8 ? ' (+' + (x.missing.length - 8) + ' more)' : '') + '</li>'; }).join('') + '</ul>' : '';
  }
  function upload() {
    var pk = S && S.importing, g = gmApi(); if (!pk || !g) return;
    if (S.importLosses && S.importLosses.length && !W.confirm('This pack would lose prep the app has now:\n- ' + S.importLosses.join('\n- ') + '\n\nUpload it anyway?')) return;
    var skipped = skippedParts(pk), reqs = partRequests(pk).filter(function (rq) { return skipped.indexOf(rq.part) < 0; }), prog = $q('#gm-prog'), msg = $q('#gm-upmsg'), btn = $q('[data-gm="upload"]'), me = S, done = {}, packVersion = null, i = 0;
    if (btn) btn.disabled = true; if (prog) prog.hidden = false;
    var chain = Promise.resolve();
    reqs.forEach(function (rq) {
      chain = chain.then(function () {
        if (msg) msg.textContent = 'Uploading ' + rq.part + ' (' + (i + 1) + ' of ' + reqs.length + ')…';
        return g.importPart(rq);
      }).then(function (r) {
        i++; if (prog) prog.value = i;
        done[rq.part] = { version: r && r.version, src: rq.src, body: rq.body }; packVersion = r && r.packVersion || packVersion;
      });
    });
    /* parts on the server that the new file no longer has are removed, so the server holds exactly this pack */
    chain = chain.then(function () { return g.pack(); }).then(function (idx) {
      var extra = Object.keys(isObj(idx && idx.parts) ? idx.parts : {}).filter(function (n) { return !done[n] && skipped.indexOf(n) < 0; }), c2 = Promise.resolve();
      extra.forEach(function (n) { c2 = c2.then(function () { return g.removePart(n); }).then(function (r) { packVersion = r && r.packVersion || packVersion; }); });
      return c2.then(function () { if (!extra.length && idx && idx.version) packVersion = idx.version; });
    });
    chain.then(function () {
      if (S !== me) return;
      me.pack = { version: packVersion, parts: done, savedAt: nowIso() };
      return kvSet('pack:' + me.me, me.pack).catch(function () {}).then(function () { if (S !== me) return; toast('GM pack imported: ' + reqs.length + ' parts.' + (skipped.length ? ' ' + skipped.join(', ') + ' skipped: push it from the PC (gm:sync).' : '')); me.importing = null; start(); });
    }).catch(function (e) {
      if (S !== me) return;
      if (msg) msg.textContent = 'Stopped after ' + i + ' of ' + reqs.length + ': ' + errText(e);
      if (btn) btn.disabled = false;
    });
  }
  function readPackFile(file) {
    if (!file) return;
    var rd = new FileReader();
    rd.onerror = function () { toast('Could not read ' + (file.name || 'the file') + '.', true); };
    rd.onload = function () { var pk; try { pk = JSON.parse(String(rd.result)); } catch (e) { pk = '__bad'; } if (!S) return; if (pk === '__bad') { var b = $q('#gm-prev'); if (b) b.innerHTML = '<ul class="gm-errs"><li>That file is not JSON.</li></ul>'; S.importing = null; return; } previewPack(pk, file.name); };
    rd.readAsText(file);
  }
  function forget() {
    var unsent = S && S.saver ? S.saver.unsent() : null;
    if (!S || !W.confirm('Forget the GM pack and the GM notes cached on this device? The server keeps its copy; the page reloads it next time.' + (unsent ? '\n\nChanges not yet saved to the server (' + (S.saver.state().hold ? 'you are signed out' : 'still sending') + ') would be lost with it.' : ''))) return;
    var me = S;
    Promise.all([kvDel('pack:' + me.me).catch(function () {}), Promise.resolve().then(function () { try { W.localStorage.removeItem(STICKY); } catch (e) {} })]).then(function () {
      if (S !== me) return;
      me.pack = null; me.status = 'off';
      screen(note('GM data forgotten on this device.', 'The pack and the GM notes cached here are gone. Load them again from the server when you need them.') + '<p><button type="button" class="btn sm primary" data-gm="retry">Load again</button></p>');
      toast('GM data forgotten on this device.');
    });
  }

  /* ---------- start: the console instance, the generator, the layout ---------- */
  /* What an earlier visit could not send because the Access session had ended (E5), found in the sticky copy by load(): drawn into the
     page now (before the console is built from the state) and sent once. It stays in the sticky copy until the server has answered
     (a failure there holds it again; a refusal parks it, as any refused patch). Called by start(), so a visit that goes no further
     than the import screen leaves it where it is. */
  function resendPending() {
    var p = S.stickyPending; if (!p || S.resent) return;
    S.stickyPending = null; S.resent = true;
    S.doc = applyPatch(S.doc, p);
    S.saver.add(p); S.saver.flush();
  }
  /* Engage went on 17/10/2026: the controls, the current card and the history it stored in the notes are dropped (once; nothing else reads them) */
  function dropEngage() {
    var d = S.doc, c = isObj(d.cards) ? d.cards : {}, h = isObj(d.hist) ? d.hist : {}, p = {};
    if (d.eng !== undefined) p.eng = null;
    if (c.engagement !== undefined) p.cards = { engagement: null };
    if (h.engagement !== undefined) p.hist = { engagement: null };
    if (Object.keys(p).length) patch(p, { force: true });
  }
  function start() {
    resendPending();
    dropEngage();
    var cp = part('console'), C = W.B68GmConsole, m = isObj(S.doc.mem) ? S.doc.mem : {};
    S.con = null; S.conErr = '';
    if (!C || !cp || !isObj(cp.T)) S.conErr = !C ? 'The console module is missing.' : 'The pack has no console part. Update the pack.';
    else { try { S.con = C.create({ T: cp.T, campaign: part('campaign') || {}, state: S.doc.con || {}, mem: clone(m.console || {}) }); } catch (e) { S.conErr = 'The console could not start: ' + errText(e); } }
    S.locMem = clone(m.location || {}); S.locErr = ''; S.scnMem = clone(m.scenes || {}); S.scn = null; S.npcg = null; S.npcMem = clone(m.npc || {}); S.npcRoll = null;
    S.dt = null; S.dtDists = null; S.dtRoll = null; S.dtSig = null; S.dtMem = clone(m.downtime || {});
    S.sc = null; S.scRoll = null; S.scSig = null; S.scCtxSig = ''; S.scErr = ''; S.scMem = clone(m.score || {});
    if (!W.B68GmLocation) S.locErr = 'The location module is missing.'; else if (!part('location') || !isObj(part('location').T)) S.locErr = 'The pack has no location part. Update the pack.';
    S.status = 'ready'; S.prepKey = null;
    mountAssist();
    layout(); mountCogm(); redrawAll(); subscribeNpcs(); checkPack(); apMount();
    /* listening: every 5 s while the iPad tab is open, every 15 s otherwise (the top bar shows it) */
    if (!S.sttTimer && typeof W.setInterval === 'function') { var mine2 = S, n2 = 0; S.sttTimer = W.setInterval(function () { n2++; if (S === mine2 && S.status === 'ready' && !document.hidden) { if (S.panel === 'ipad' || n2 % 3 === 0) loadStt(); renderBeat(); } }, 5000); }
    if (!S.prepTimer && typeof W.setInterval === 'function') { var mine = S; S.prepTimer = W.setInterval(function () { if (S === mine && S.status === 'ready' && prepRunning()) { var pb = $q('#gm-prep'); if (pb && S.panel === 'prep') decoratePrep(pb); decoratePrep($q('#gm-rail')); } }, 15000); }
    if (S.panel === 'ipad') loadAmbient(); else loadShown();
    loadStt();
  }
  /* the top bar: what the iPad shows, read once (GET /api/gm/display only: the heat sync waits for the iPad tab, as before) */
  /* Claude at the table (app/gm/assist-panel.js): the Blade side panel (a tab on the right edge). It lives in the site's .wrap beside this page, made here and
     destroyed in close(), so only the GM's ready page has it. Its Ledger updates have no state of their own to change: "Note it" files
     the text in the capture bar as a Moment, nothing else is written. A phone gets no box (the CSS hides it, and it does not poll). */
  function mountAssist() {
    var g = gmApi(), A = W.B68GmAssist, me = S;
    if (me.assist) { try { me.assist.destroy(); } catch (e) {} me.assist = null; }
    if (!A || !g || typeof g.assistTick !== 'function' || typeof g.stt !== 'function') return;
    try { me.assist = A.create({ gm: g, draws: function (position) { return S === me ? drawsFor(position) : null; }, onTyped: function (text) { return S === me ? cogmTyped(me, text) : null; }, onAutopilot: function () { if (S === me) apToggle(); }, onStage: function () { return S === me ? onStageName() : ''; }, onVoice: function (v) { if (S === me) setVoice(v); }, onStall: function (v) { if (S === me) setStall(v); }, onMeanwhile: function (v) { if (S === me) setMeanwhile(v); }, onHandout: function (h) { if (S === me) offerHandoutFromBox(h); }, dots: function () { return S === me && S.dots != null ? S.dots : null; }, onNote: function (text) { return S === me && !!addCapture('m', text, true); },
      screen: { vocab: screenVocab, cleanSpec: screenCleanSpec }, onScreen: function (item) { if (S === me) setScreenItem(item); } }); } catch (e) { me.assist = null; }
  }

  /* ---------- the co-GM (app/gm/cogm.js, design 5.1-5.6; POST /api/gm/assist/act is its Worker side) ----------
     The switch is in the Blade panel's header and starts OFF on every load (nothing is stored). ON MEANS CUE ONLY (C4d): while it is on and Listening is on, every 2 s this
     reads the new transcript lines (after a cursor that starts at the newest line, so old talk is never replayed) and a line holding "Blade, ..." is the cue lane's:
     parsed at once (app/cue.js, against the live table), joined with the next line if it is cut off, and sent with POST /act mode 'cue'. A second switch, "Also listen for
     uncued decisions (offers only)", is OFF; only with it on does a line that matches the pre-filter send its window (at most one call every 8 s), and what comes
     back from a window is only ever offered, never acted on. A cue's actions are applied with confirmed: true (the cue is the GM's tap). What comes back is applied through the GM's own write paths:
       clock_add   a hidden danger clock through the table's clockOps add (api.addClock); Undo takes it out if it is as it was left
       clock_tick  one clockOps { id, filled }; Undo sets it back only while it still holds what was set
       npc_add     a cast doc with revealed: false and the tag cogm, written as fileNpc writes one; Undo tags it undone (never a delete)
       capture     the capture bar; Undo removes that line
     An 'offer' (the seat was unsure, or the live table disagrees: a clock with the same name, a fill that moved, the iPad following the clocks) is a yellow card
     with Do it. Nothing here writes a player's sheet, and nothing reaches the display or the ambient document except Reveal and show on an NPC card, which asks first
     and goes through pushDisplay's gate. The answer's `key` is used as given; a key seen tonight is never applied twice. The answer has no health: absorb and
     healthStep are not called. Model text (name, look, quote) is only ever set with textContent (cards) or stored as plain text. */
  function mountCogm() {
    var me = S, C = W.B68GmCogm, g = gmApi(), ctl = me.assist;
    if (me.cogm) cogmStop(me);
    me.cogm = null;
    if (!C || !ctl || typeof ctl.cogmSwitch !== 'function' || !g || typeof g.assistAct !== 'function' || typeof g.transcript !== 'function' || typeof g.stt !== 'function') return;
    var cm = { C: C, st: C.newState(), on: false, starting: false, busy: false, winBusy: false, epoch: 0, timer: null, sw: null, n: 0, recs: {}, plans: {}, acts: {}, cards: {}, mine: {}, doing: {}, noted: {},
      uncued: false, order: [], undone: {}, lastMade: '', lastClock: null, working: {} };
    cm.sw = ctl.cogmSwitch({ onChange: function (want) { cogmSet(me, want); }, onAlso: function (v) { cm.uncued = !!v && cm.on; if (cm.uncued) C.catchUp(cm.st); } });
    if (cm.sw) me.cogm = cm;
  }
  function cogmStop(me) {
    var cm = me && me.cogm; if (!cm) return;
    cm.on = false; cm.uncued = false; cm.epoch++; if (cm.timer) { W.clearInterval(cm.timer); cm.timer = null; }
    Object.keys(cm.working).forEach(function (k) { W.clearTimeout(cm.working[k]); if (me.assist) me.assist.removeCard(k); }); cm.working = {};
  }
  function cogmOff(me, why) {
    var cm = me.cogm; if (!cm) return;
    cogmStop(me);
    if (cm.sw) cm.sw.set(false, why || '');
  }
  function cogmSet(me, want) {
    var cm = me.cogm; if (!cm || S !== me) return;
    if (!want) { cogmOff(me, ''); return; }
    if (cm.on || cm.starting) return;
    var g = gmApi(); cm.starting = true;
    Promise.all([Promise.resolve().then(function () { return g.stt(); }), Promise.resolve().then(function () { return g.transcript({ tail: 1 }); })]).then(function (r) {
      cm.starting = false;
      if (S !== me || me.cogm !== cm) return;
      var listening = !!(r[0] && isObj(r[0].doc) && r[0].doc.want === 'on'), box = cm.sw.box();
      if (!listening) { cm.sw.set(false, 'Off: Listening is off'); toast('Turn Listening on first: Co-GM acts on what the table says.', true); return; }
      if (box.key === 'off') toast('Blade is off tonight (the cap): cues still work, but one that needs the model will not land.', true);
      cm.C.start(cm.st, r[1] && Number.isInteger(r[1].last) ? r[1].last : 0);
      cm.on = true; cm.n = 0; cm.sw.set(true);
      cm.timer = W.setInterval(function () { cogmStep(me); }, cm.C.TIMING.poll);
      toast('Co-GM is on. It acts on “Blade, …”; every card has Undo.');
    }, function (e) { cm.starting = false; if (S === me && me.cogm === cm) { cm.sw.set(false, 'Off'); toast('Could not turn Co-GM on: ' + errText(e), true); } });
  }
  /* one poll: read, note matches, send at most one window. The box going off (Listening off, the cap, not set up) switches co-GM off and says so. */
  function cogmStep(me) {
    var cm = me.cogm; if (!cm || !cm.on || S !== me || cm.busy) return;
    if (document.hidden) { if (!cm.st.away) cm.st.away = Date.now(); return; }          /* a cue heard while this page was away may be stale when it comes back */
    var box = cm.sw.box();
    /* the box is off when its night's cap is reached (the header says Off). Listening is asked of the server here every 6th poll, not read from the panel's last tick, which can be a minute old. "Not set up" does not matter: the hands need no briefing. */
    /* At the cap the cue lane keeps going: a parsed cue costs $0 and needs no gate. Only the uncued windows stop, and a cue that needs the model gets a grey card (cogmCuePost). */
    cm.capped = box.key === 'off';
    var g = gmApi(), C = cm.C, epoch = cm.epoch, check = (cm.n++ % Math.max(1, C.TIMING.sttEvery)) === Math.max(1, C.TIMING.sttEvery) - 1;
    cm.busy = true;
    Promise.all([Promise.resolve().then(function () { return g.transcript({ after: cm.st.readAfter }); }), check ? Promise.resolve().then(function () { return g.stt(); }).then(null, function () { return null; }) : null]).then(function (r) {
      if (S !== me || cm.epoch !== epoch) return;
      if (r[1] && isObj(r[1].doc) && r[1].doc.want !== 'on') { cogmOff(me, 'Off: Listening is off'); toast('Co-GM switched itself off: Listening is off.', true); return; }
      C.ingest(cm.st, r[0] && r[0].lines, r[0] && r[0].last, Date.now(), cogmLive(me));
      cm.st.away = 0;
      cogmCues(me, epoch);
      /* uncued windows only with the second switch on, and never while one is in flight: a slow window must not hold a cue back */
      var w = cm.uncued && !cm.capped && !cm.winBusy ? C.nextWindow(cm.st, Date.now()) : null;
      if (w) { cm.winBusy = true; return cogmSend(me, w, epoch).then(function () { cm.winBusy = false; }, function () { cm.winBusy = false; }); }
    }).then(null, function () {}).then(function () { cm.busy = false; });
  }
  /* ---------- the cue lane (C4d; design 1.3 to 1.5) ---------- */
  function cogmCues(me, epoch) {
    var cm = me.cogm, C = cm.C, job, guard = 0;
    while (guard++ < 8 && (job = C.cueNext(cm.st, Date.now(), cogmLive(me)))) cogmRunJob(me, job, epoch);
  }
  function cogmRunJob(me, job, epoch) {
    if (job.kind === 'card') cogmCueCard(me, job);
    else if (job.kind === 'stale') cogmCueStale(me, job);
    else if (!cogmHasTarget(me, job)) cogmNoTarget(me, job);
    else return cogmCuePost(me, job, epoch);
  }
  /* ---------- typed commands (C4f): "Blade, ..." or "/tick ..." in the Ask bar ----------
     The same trust boundary as a spoken cue: the mapped sentence is POSTed to the transcript as a line tagged conn 'typed' (speaker null; the iPad's lines carry its own conn and a
     speaker number), read back by its id for its seq, then run through cueNext/cogmCuePost: POST /act in cue mode, whose quote check reads that row. The poll never runs a typed row
     (cogm.js ingest skips conn 'typed'), so it works with co-GM on or off, and a parsed one acts at the cap ($0). -> Promise<{ ok }> */
  function cogmTyped(me, text) {
    var cm = me.cogm, g = gmApi(), Q = W.B68Cue, ctl = me.assist;
    if (!cm || !g || !Q || typeof Q.fromTyped !== 'function' || typeof g.addTranscript !== 'function') return Promise.resolve({ ok: false });
    var t = Q.fromTyped(text); if (!t) return Promise.resolve({ ok: false });
    if (t.unknown) {
      if (ctl) ctl.addCard({ id: 'cogm|typed|' + Date.now().toString(36), seat: 'cogm', kind: 'note', headline: 'I don’t know the command ' + cm.C.plain(t.unknown, 30) + '.', bullets: ['Try /tick, /clock, /npc, /note or /undo, or start with “Blade,”.'], ackLabel: 'Got it ×' });
      return Promise.resolve({ ok: true });
    }
    var id = 'typed-' + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36), at = new Date().toISOString();
    return Promise.resolve().then(function () { return g.addTranscript([{ id: id, at: at, session: '', conn: 'typed', speaker: null, kind: 'line', text: t.text, cue: true }]); })
      .then(function () { return g.transcript({ tail: 20 }); })
      .then(function (r) {
        var row = ((r && r.lines) || []).filter(function (l) { return l && l.id === id; })[0];
        if (!row || !Number.isInteger(row.seq)) throw new Error('the typed line was not stored');
        if (S !== me || me.cogm !== cm) return { ok: false };
        var st = cm.C.newState(), box = cm.sw && cm.sw.box ? cm.sw.box() : null;
        cm.capped = !!box && box.key === 'off';
        st.cues.push({ seq: row.seq, id: id, at: at, text: t.text, seenAt: 0, late: false });
        var job = cm.C.cueNext(st, Date.now(), cogmLive(me));
        if (!job) return { ok: false };
        cogmRunJob(me, job, cm.epoch);
        return { ok: true };
      }).then(null, function (e) { toast('Could not send that command: ' + errText(e), true); return { ok: false }; });
  }
  /* Undo and rename act on what THIS page made, so a page with nothing to act on posts nothing: the Worker's claim would go to a page that applies it zero times. */
  function cogmUndoTarget(cm) { for (var i = cm.order.length - 1; i >= 0; i--) if (!cm.undone[cm.order[i]] && cm.recs[cm.order[i]] && cm.acts[cm.order[i]]) return cm.order[i]; return ''; }
  function cogmRenameTarget(cm) { var k = cm.lastMade; return k && cm.recs[k] && !cm.undone[k] ? k : ''; }
  function cogmHasTarget(me, job) {
    var cm = me.cogm, p = Array.isArray(job.parsed) ? job.parsed : [];
    if (p.some(function (a) { return a && a.type === 'undo'; })) return !!cogmUndoTarget(cm);
    if (p.some(function (a) { return a && a.type === 'rename'; })) return !!cogmRenameTarget(cm);
    return true;
  }
  function cogmNoTarget(me, job) {
    var ctl = me.assist, undo = (job.parsed || []).some(function (a) { return a && a.type === 'undo'; }); if (!ctl) return;
    ctl.addCard({ id: cogmCueId(job, 't'), seat: 'cogm', kind: 'note', headline: undo ? 'Nothing of mine to undo here.' : 'Nothing of mine to rename here.', bodyLabel: 'Heard', body: cogmQuoteBody(job), ackLabel: 'Got it ×' });
  }
  function cogmHhmm(iso) { var d = new Date(iso); if (isNaN(d.getTime())) d = new Date(); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function cogmQuoteBody(job) { return 'Heard ' + cogmHhmm(job.cue.at) + ': “' + str(job.quote).replace(/\s+/g, ' ').trim() + '”'; }
  function cogmCueId(job, tag) { return 'cogm|cue|' + (tag || 'c') + '|' + job.cueLineId; }
  /* a grey or yellow card for a cue that is not acted on: nothing is posted */
  function cogmCueCard(me, job) {
    var cm = me.cogm, C = cm.C, ctl = me.assist, res = job.res, id = cogmCueId(job, 'n'), q = C.plain(res.quote, 90);
    if (!ctl) return;
    var spec = { id: id, seat: 'cogm', kind: 'note', strip: true, bodyLabel: 'Heard', body: cogmQuoteBody(job), ackLabel: 'Got it ×', open: true };
    var act = function (a) { return function () { ctl.removeCard(id); return cogmCuePost(me, Object.assign({}, job, { kind: 'post', parsed: [Object.assign({ quote: res.quote }, a)] }), cm.epoch); }; };
    if (res.refused) {
      spec.headline = res.refused === 'nochange' ? 'Heard “' + q + '”: nothing to change.' : 'Heard “' + q + '”: I can’t do that yet.';
    } else if (res.missing === 'which') {
      var by = res.draft && Number.isFinite(res.draft.by) ? res.draft.by : 1;
      spec.kind = 'idea'; spec.headline = 'Which clock? “' + q + '”'; spec.bullets = ['Tap the one you meant.'];
      spec.actions = (res.candidates || []).slice(0, 6).map(function (c, i) { return { id: 'c' + i, label: C.plain(c.name, 38), run: act({ type: 'clock_tick', clock_id: c.id, clock_name: c.name, by: by }) }; });
    } else if (res.missing === 'size') {
      var d = res.draft || {};
      spec.kind = 'idea'; spec.headline = 'How big is “' + C.plain(d.name, 60) + '”?'; spec.bullets = ['A clock needs 4, 6 or 8 segments.'];
      spec.actions = (res.candidates || [4, 6, 8]).map(function (n) { return { id: 's' + n, label: String(n), run: act(Object.assign({ type: 'clock_add', name: d.name, size: n, hidden: true }, d.filled > 0 ? { filled: Math.min(d.filled, n) } : {})) }; });
    } else if (res.missing === 'clock') {
      spec.kind = 'idea'; spec.headline = 'No clock called “' + C.plain(res.name, 60) + '”: make one?'; spec.bullets = ['Pick its size.'];
      spec.actions = [4, 6, 8].map(function (n) { return { id: 'm' + n, label: 'Make it ' + n, run: act({ type: 'clock_add', name: res.name, size: n, hidden: true }) }; });
    } else {
      var what = res.missing === 'name' ? 'a name' : res.missing === 'amount' ? 'how many' : res.missing === 'text' ? 'the words' : 'more';
      spec.kind = 'idea'; spec.headline = 'Heard “' + q + '”: I need ' + what + '. Say it again.';
    }
    ctl.addCard(spec);
  }
  /* a cue that waited in a hidden page: it is stale, so it is a yellow card that acts only when tapped */
  function cogmCueStale(me, job) {
    var cm = me.cogm, C = cm.C, ctl = me.assist, id = cogmCueId(job, 's'); if (!ctl) return;
    ctl.addCard({ id: id, seat: 'cogm', kind: 'idea', strip: true, headline: 'Old cue: “' + C.plain(job.quote, 90) + '”', bullets: ['Heard while this page was hidden. Do it now?'], bodyLabel: 'Heard', body: cogmQuoteBody(job),
      actions: [{ id: 'do', label: 'Do it', primary: true, run: function () { ctl.removeCard(id); return cogmCuePost(me, Object.assign({}, job, { kind: 'post' }), cm.epoch); } }], ackLabel: 'Skip', open: true });
  }
  /* post the cue and show "working…" at once. NEVER retried: if the Worker logged it but the answer is lost, a retry comes back 'seen'. A late answer is still used. */
  function cogmCuePost(me, job, epoch) {
    var cm = me.cogm, C = cm.C, g = gmApi(), ctl = me.assist, wid = cogmCueId(job, 'w'); if (!cm || !g) return Promise.resolve();
    if (!job.parsed && cm.capped) {          /* at the night's cap the model is off: only a parsed cue can land */
      if (ctl) ctl.addCard({ id: cogmCueId(job, 'n'), seat: 'cogm', kind: 'note', strip: true, headline: 'Heard “' + C.plain(job.quote, 90) + '”: I couldn’t finish that one tonight.', bodyLabel: 'Heard', body: cogmQuoteBody(job), ackLabel: 'Got it ×' });
      return Promise.resolve();
    }
    if (ctl) ctl.addCard({ id: wid, seat: 'cogm', kind: 'note', strip: true, headline: 'Working…', bodyLabel: 'Heard', body: cogmQuoteBody(job), open: true });
    cm.working[wid] = W.setTimeout(function () {
      delete cm.working[wid];
      if (S === me && me.assist) me.assist.updateCard(wid, { kind: 'warn', headline: 'Didn’t land: say it again', bullets: [], strip: true });
    }, C.TIMING.cueAnswer);
    var body = { from: job.from, to: job.to, state: C.buildState(cogmLive(me), onStageName()), mode: 'cue', cueLineId: job.cueLineId, seenOk: true };
    if (job.parsed) body.parsed = job.parsed;
    return Promise.resolve().then(function () { return g.assistAct(body); }).then(function (res) {
      if (S !== me || cm.epoch !== epoch) return;
      if (cm.working[wid]) { W.clearTimeout(cm.working[wid]); delete cm.working[wid]; }
      return cogmCueAnswer(me, job, res, wid);
    }, function (e) {
      if (S !== me || cm.epoch !== epoch) return;
      if (cm.working[wid]) { W.clearTimeout(cm.working[wid]); delete cm.working[wid]; }
      if (me.assist) me.assist.updateCard(wid, { kind: 'warn', headline: 'Didn’t land: say it again', bullets: [C.plain(errText(e), 120)], strip: true });
    });
  }
  function cogmCueAnswer(me, job, res, wid) {
    var cm = me.cogm, C = cm.C, ctl = me.assist, chain = Promise.resolve(), acts = isObj(res) && Array.isArray(res.actions) ? res.actions : [];
    var fresh = acts.filter(function (a) { return isObj(a) && a.mode !== 'seen'; });
    if (!fresh.length) {
      if (!ctl) return chain;
      if (acts.length) { ctl.removeCard(wid); return chain; }                      /* another page has it: that page shows the card */
      var why = isObj(res) && Array.isArray(res.dropped) && res.dropped[0] ? res.dropped[0].why : '';
      ctl.updateCard(wid, { kind: 'note', headline: why === 'already known' ? 'Already known: nothing added.' : 'Heard “' + C.plain(job.quote, 80) + '”: nothing to do.', bullets: why && why !== 'already known' ? [C.plain(why, 100)] : [], strip: true });
      return chain;
    }
    if (ctl) ctl.removeCard(wid);
    fresh.forEach(function (a) {
      if (!a.at) a.at = cogmHhmm(job.cue.at);
      chain = chain.then(function () { return S === me ? cogmCueOne(me, a) : null; }).then(null, function () {});
    });
    return chain;
  }
  /* the Rolled name (E3): the NPC generator's own draw, with a repeat-guard copy so the console's memory is not disturbed */
  function cogmRollName(me) {
    var g = npcgInst(); if (!g) return '';
    try { var roll = g.roll({ mem: clone(S.npcMem || {}), ui: {} }); return str(roll && roll.npc && roll.npc.name).replace(/\s+/g, ' ').trim().slice(0, 80); } catch (e) { return ''; }
  }
  function cogmCueNote(me, a, text) {
    var ctl = me.assist; if (!ctl) return;
    ctl.addCard({ id: 'cogm|' + a.key, seat: 'cogm', kind: 'note', strip: true, headline: me.cogm.C.plain(text, 160), bodyLabel: 'Heard', body: me.cogm.C.heard(a), ackLabel: 'Got it ×' });
  }
  /* one action of a cue's answer */
  function cogmCueOne(me, a) {
    var cm = me.cogm, C = cm.C;
    if (!isObj(a) || typeof a.key !== 'string' || !a.key || C.seen(cm.st, a.key)) return null;
    if (a.type === 'undo') { C.mark(cm.st, a.key, 'applied'); return cogmCueUndo(me, a); }
    if (a.type === 'rename') { C.mark(cm.st, a.key, 'applied'); return cogmCueRename(me, a); }
    if (a.type === 'npc_add' && a.needsName) {
      var rolled = cogmRollName(me);
      if (!rolled) { C.mark(cm.st, a.key, 'dropped'); cogmCueNote(me, a, 'Heard a new NPC with no name, and I could not roll one. Say it again with a name.'); return null; }
      a = Object.assign({}, a, { name: rolled, nameRolled: true });
    }
    return cogmOne(me, a, { cue: true });
  }
  /* "Blade, undo": the newest thing Blade did tonight that is still done, with the same compare-and-swap as its card's Undo */
  function cogmCueUndo(me, a) {
    var cm = me.cogm, C = cm.C, ctl = me.assist, key = '';
    for (var i = cm.order.length - 1; i >= 0; i--) if (!cm.undone[cm.order[i]] && cm.recs[cm.order[i]] && cm.acts[cm.order[i]]) { key = cm.order[i]; break; }
    if (!key) { cogmCueNote(me, a, 'Nothing to undo.'); return null; }
    var target = cm.acts[key], head = C.headline(cm.plans[key], true);
    return cogmUndo(me, target, false).then(function () {
      if (ctl) ctl.updateCard(cogmCardId(target), { bullets: [], actions: [], undone: true });          /* the panel marks a card undone itself only when ITS Undo ran */
      cogmCueNote(me, a, 'Undid: ' + head);
    }, function () { /* the CAS refused: the card already says so and asks first */ cogmCueNote(me, a, 'Not undone: it changed since. Open its card to undo it anyway.'); });
  }
  /* "Blade, call him Big Sal": the last NPC or clock Blade made tonight, through the existing write paths */
  function cogmCueRename(me, a) {
    var cm = me.cogm, key = cm.lastMade;
    if (!key || !cm.recs[key] || cm.undone[key]) { cogmCueNote(me, a, 'Nothing to rename: Blade has made no NPC or clock tonight.'); return null; }
    return cogmRenameTo(me, cm.acts[key], str(a.name)).then(function (ok) { if (ok) cogmCueNote(me, a, 'Renamed: ' + cm.C.plain(a.name, 80)); }, function (e) { cogmCueNote(me, a, 'Could not rename: ' + errText(e)); });
  }
  function cogmSend(me, w, epoch) {
    var cm = me.cogm, g = gmApi(), C = cm.C;
    return Promise.resolve().then(function () { return g.assistAct({ from: w.from, to: w.to, state: C.buildState(cogmLive(me), onStageName()), seenOk: true }); }).then(function (res) {
      if (S !== me || cm.epoch !== epoch) return;
      C.windowSent(cm.st, w, Date.now());        /* the handled cursor moves only on an answer */
      return cogmApply(me, res);
    }, function (e) {
      if (S !== me || cm.epoch !== epoch) return;
      C.windowFailed(cm.st, w, Date.now(), !!(e && e.status === 429));      /* a 429 (cooldown or busy) leaves the window to go again after 8 s */
    });
  }
  /* the table as the planner needs it, read now */
  function cogmLive(me) {
    var cm = me.cogm;
    return {
      clocks: tableClocks().filter(function (c) { return str(c.id); }).map(function (c) { return { id: str(c.id), name: str(c.name), size: +c.size || 4, filled: +c.filled || 0, hidden: c.hidden === true }; }),
      mineClocks: Object.keys(cm.mine).map(function (k) { return cm.mine[k]; }),
      npcs: Object.keys(me.npcs || {}).map(function (id) { var d = me.npcs[id]; return { id: id, name: str(d.name), tags: Array.isArray(d.tags) ? d.tags : [], revealed: d.revealed === true, description: str(d.description), role: str(d.role) }; }),
      pcs: dtPcs().map(function (c) { return { id: str(c.id), name: pcName(c) }; }),
      ipadClocks: !!me.clOn,
      /* "tick that": the clock Blade last made or ticked, only within the last 10 minutes (cue.js is given the id; the rule is the page's) */
      lastClock: cm.lastClock && Date.now() - cm.lastClock.at <= 600000 ? cm.lastClock.id : ''
    };
  }
  function cogmApply(me, res) {
    var cm = me.cogm, C = cm.C, chain = Promise.resolve();
    if (!isObj(res)) return chain;
    (Array.isArray(res.actions) ? res.actions : []).forEach(function (a) { chain = chain.then(function () { return S === me ? cogmOne(me, a) : null; }).then(null, function () {}); });
    (Array.isArray(res.dropped) ? res.dropped : []).forEach(function (d) {
      if (!isObj(d) || d.why !== 'already known' || !str(d.name).trim()) return;
      var k = C.norm(d.name); if (cm.noted[k]) return; cm.noted[k] = true;
      if (S === me && me.assist) me.assist.addCard({ id: 'cogm|known|' + k, kind: 'note', seat: 'cogm', headline: 'Already known: ' + C.plain(d.name, 80), body: 'Heard a name that is already in the cast or at the table, so nothing was added.', bodyLabel: 'Co-GM' });
    });
    return chain;
  }
  function cogmNewId(type) { return (type === 'npc_add' ? 'npc_cogm_' : 'c_') + Date.now().toString(36) + Math.floor(Math.random() * 1679616).toString(36); }
  function cogmOne(me, a, opts) {
    var cm = me.cogm, C = cm.C, cue = !!(opts && opts.cue);
    if (!isObj(a) || typeof a.key !== 'string' || !a.key) return null;
    if (C.seen(cm.st, a.key)) return null;                     /* a window sent twice, or a decision heard twice: the key is the server's, used as given */
    /* a cue is the GM's own tap, so it is applied confirmed; a window is never more than an offer (the second switch: "offers only") */
    var plan = C.planApply(a, cogmLive(me), { id: cogmNewId(a.type) }, cue ? { confirmed: true } : undefined);
    if (plan.op === 'drop') {
      C.mark(cm.st, a.key, 'dropped');
      if (cue && plan.why !== 'seen') cogmCueNote(me, a, plan.why === 'no change' ? 'Nothing to change.' : plan.why === 'already known' ? 'Already known: ' + C.plain(plan.name, 80) + '.' : 'Not done: ' + plan.why + '.');
      return null;
    }
    cm.acts[a.key] = a;
    if (!cue && plan.op === 'do') { plan.op = 'offer'; plan.why = 'Heard without “Blade”: tap Do it to act on it'; }
    if (plan.op === 'offer') { C.mark(cm.st, a.key, 'offered'); cogmOffer(me, a, plan); return null; }
    C.mark(cm.st, a.key, 'applied');                           /* before the write: a second copy arriving while it is in flight finds the key */
    return cogmDo(me, a, plan, false, cue);
  }
  function cogmCardId(a) { return 'cogm|' + a.key; }
  /* a yellow card: what Blade would do, why it is asking, and Do it */
  function cogmOffer(me, a, plan) {
    var cm = me.cogm, C = cm.C, ctl = me.assist; if (!ctl) return;
    var id = cogmCardId(a), spec = { id: id, kind: 'idea', seat: 'cogm', headline: C.headline(plan, false), bullets: [C.plain(plan.why, 150)], body: C.heard(a), bodyLabel: 'Heard',
      actions: [{ id: 'do', label: 'Do it', primary: true, run: function () { return cogmDoIt(me, a); } }], ackLabel: 'Skip', open: true };
    if (cm.cards[a.key]) ctl.updateCard(id, Object.assign({}, spec, { undo: null })); else cm.cards[a.key] = ctl.addCard(spec);
  }
  function cogmDoIt(me, a) {
    var cm = me.cogm; if (!cm || S !== me || cm.doing[a.key]) return Promise.resolve();
    cm.doing[a.key] = true;
    var plan = cm.C.planApply(a, cogmLive(me), { id: cogmNewId(a.type) }, { confirmed: true });
    if (plan.op === 'drop') {
      delete cm.doing[a.key]; toast('Not done: ' + plan.why + '.', true);
      if (me.assist) me.assist.updateCard(cogmCardId(a), { kind: 'note', headline: 'Not done: ' + cm.C.plain(plan.why, 100), bullets: [], actions: [] });
      return Promise.resolve();
    }
    cm.C.mark(cm.st, a.key, 'applied');
    return cogmDo(me, a, plan, true).then(function () { delete cm.doing[a.key]; }, function () { delete cm.doing[a.key]; });
  }
  /* the writes. Each resolves when the table has been changed and the green card is up; a failure becomes (or stays) an offer with a reason. */
  function cogmWrite(me, plan) {
    var api = me.api;
    if (plan.type === 'clock_add') {
      if (!api || typeof api.addClock !== 'function') return Promise.reject(new Error('The table is not available here.'));
      return Promise.resolve().then(function () { return api.addClock(plan.clock); }).then(function (r) { if (r === false) throw new Error('The clock was not added.'); me.cogm.mine[plan.id] = plan.clock.name; });
    }
    if (plan.type === 'clock_tick') {
      if (!api || typeof api.clockOps !== 'function') return Promise.reject(new Error('The table is not available here.'));
      return Promise.resolve().then(function () { return api.clockOps([{ id: plan.id, filled: plan.to }]); });
    }
    if (plan.type === 'npc_add') {
      var ref = npcRef(plan.id); if (!ref) return Promise.reject(new Error('The cast is not available here.'));
      return Promise.resolve().then(function () { return ref.set(clone(plan.doc)); });
    }
    var ok = addCapture(plan.bucket, plan.text, true);
    if (!ok) return Promise.reject(new Error('The capture bar refused it.'));
    plan.capId = S.capId;
    return Promise.resolve();
  }
  function cogmDo(me, a, plan, viaButton, cue) {
    var cm = me.cogm, C = cm.C, ctl = me.assist;
    return cogmWrite(me, plan).then(function () {
      if (S !== me || !me.assist) return;
      var rec = C.recordOf(plan); if (plan.type === 'capture') rec.id = plan.capId;
      cm.recs[a.key] = rec; cm.plans[a.key] = plan; cm.acts[a.key] = a;
      if (cm.order.indexOf(a.key) < 0) cm.order.push(a.key);
      if (plan.type === 'clock_add' || plan.type === 'npc_add') cm.lastMade = a.key;
      if (plan.type === 'clock_add' || plan.type === 'clock_tick') cm.lastClock = { id: plan.id, at: Date.now() };
      var id = cogmCardId(a), spec = { kind: 'done', headline: C.headline(plan, true), bullets: [], body: C.heard(a), bodyLabel: 'Heard', actions: cogmButtons(me, a), ackLabel: 'Got it ×',
        undo: function () { return cogmUndo(me, a, false); } };
      if (cue === true) spec.strip = true;                       /* a cue's result slides the strip out even with the panel closed */
      if (cm.cards[a.key]) ctl.updateCard(id, spec); else cm.cards[a.key] = ctl.addCard(Object.assign({ id: id, seat: 'cogm' }, spec));
    }, function (e) {
      if (S !== me) return;
      if (viaButton) { toast('Could not do it: ' + errText(e), true); return; }
      C.mark(cm.st, a.key, 'offered');
      cogmOffer(me, a, Object.assign({}, plan, { op: 'offer', why: 'Could not do it: ' + errText(e) }));
    });
  }
  /* the buttons on a green card: a clock can be shown or hidden and renamed; an NPC can be drawn, or revealed and shown (each asks, and uses the existing paths) */
  function cogmButtons(me, a) {
    var cm = me.cogm, rec = cm.recs[a.key], plan = cm.plans[a.key], btns = [];
    if (!rec || !plan) return btns;
    if (plan.type === 'clock_add') {
      var hid = rec.snap.hidden;
      btns.push({ id: 'vis', label: hid ? 'Show players' : 'Hide', title: hid ? 'Hidden from the players now' : 'Visible to the players now', run: function () { return cogmClockVis(me, a); } });
      btns.push({ id: 'rename', label: 'Rename', run: function () { return cogmClockRename(me, a); } });
    } else if (plan.type === 'npc_add') {
      btns.push({ id: 'rename', label: 'Rename', run: function () { return cogmNpcRename(me, a); } });
      btns.push({ id: 'portrait', label: 'Draw portrait', run: function () { return cogmPortrait(me, plan); } });
      btns.push({ id: 'reveal', label: 'Reveal and show', title: 'Asks first, then shows them on the iPad', run: function () { return cogmReveal(me, plan); } });
    }
    return btns;
  }
  function cogmRefresh(me, a) {
    var cm = me.cogm, ctl = me.assist; if (!ctl || !cm.cards[a.key]) return;
    ctl.updateCard(cogmCardId(a), { headline: cm.C.headline(cm.plans[a.key], true), actions: cogmButtons(me, a) });
  }
  function cogmClockVis(me, a) {
    var cm = me.cogm, rec = cm.recs[a.key], plan = cm.plans[a.key]; if (!rec || !plan || !me.api || typeof me.api.clockOps !== 'function') return Promise.resolve();
    var show = rec.snap.hidden === true;
    if (show && !W.confirm('Show “' + plan.clock.name + '” to the players? It appears on their table page' + (me.clOn ? ' and on the iPad, which is following the clocks.' : '.'))) return Promise.resolve();
    return Promise.resolve().then(function () { return me.api.clockOps([{ id: rec.id, hidden: !show }]); }).then(function () { cm.C.noteEdit(rec, { hidden: !show }); cogmRefresh(me, a); }, function (e) { toast('Could not change the clock: ' + errText(e), true); });
  }
  function cogmClockRename(me, a) {
    var cm = me.cogm, rec = cm.recs[a.key], plan = cm.plans[a.key]; if (!rec || !plan || !me.api || typeof me.api.clockOps !== 'function') return Promise.resolve();
    var nn = W.prompt ? W.prompt('Rename the clock', plan.clock.name) : null; nn = str(nn).replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!nn || nn === plan.clock.name) return Promise.resolve();
    return cogmRenameTo(me, a, nn).then(null, function (e) { toast('Could not rename the clock: ' + errText(e), true); });
  }
  function cogmNpcRename(me, a) {
    var cm = me.cogm, rec = cm.recs[a.key], plan = cm.plans[a.key]; if (!rec || !plan) return Promise.resolve();
    var nn = W.prompt ? W.prompt('Rename the NPC', plan.name) : null; nn = str(nn).replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!nn || nn === plan.name) return Promise.resolve();
    return cogmRenameTo(me, a, nn).then(null, function (e) { toast('Could not rename the NPC: ' + errText(e), true); });
  }
  /* the one rename: the card's Rename button and "Blade, call him ..." both come here. The clock goes through clockOps, the NPC through its cast doc (existing paths). The undo
     snapshot follows the rename, so a renamed thing can still be undone. -> Promise<true> when it was renamed */
  function cogmRenameTo(me, a, name) {
    var cm = me.cogm, C = cm.C, rec = cm.recs[a.key], plan = cm.plans[a.key], nn = str(name).replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!rec || !plan || !nn) return Promise.resolve(false);
    if (plan.type === 'clock_add') {
      if (!me.api || typeof me.api.clockOps !== 'function') return Promise.reject(new Error('The table is not available here.'));
      return Promise.resolve().then(function () { return me.api.clockOps([{ id: rec.id, name: nn }]); }).then(function () {
        C.noteEdit(rec, { name: nn }); plan.clock.name = nn; cm.mine[rec.id] = nn; cogmRefresh(me, a); return true;
      });
    }
    if (plan.type === 'npc_add') {
      var ref = npcRef(rec.id); if (!ref) return Promise.reject(new Error('The cast is not available here.'));
      var taken = (cogmLive(me).npcs || []).some(function (n) { return n.id !== rec.id && C.norm(n.name) === C.norm(nn) && n.tags.indexOf('undone') < 0; });
      if (taken) return Promise.reject(new Error('“' + nn + '” is already in the cast'));
      return Promise.resolve().then(function () { return ref.update({ name: nn }); }).then(function () {
        C.noteEdit(rec, { name: nn }); plan.name = nn; plan.doc.name = nn; plan.rolled = false; cogmRefresh(me, a); return true;
      });
    }
    return Promise.resolve(false);
  }
  /* Draw portrait is the Blade panel's own Screen path (portrait seat, then the gatekeeper); the picture goes to the Rack and nothing is shown until Show there */
  function cogmPortrait(me, plan) {
    var ctl = me.assist; if (!ctl || typeof ctl.screenMake !== 'function') return Promise.resolve();
    if (typeof ctl.canScreen === 'function' && !ctl.canScreen('portrait')) { toast('Blade cannot draw right now.', true); return Promise.resolve(); }
    return Promise.resolve(ctl.screenMake('portrait', { name: plan.doc.name })).then(function () { toast('Drawing ' + plan.doc.name + ': it will appear in the Rack.'); }, function () {});
  }
  /* the only way a co-GM NPC reaches the players: a tap, a confirm, revealed: true, then the display's own gated push */
  function cogmReveal(me, plan) {
    var ref = npcRef(plan.id); if (!ref) { toast('The cast is not available here.', true); return Promise.resolve(); }
    if (!W.confirm(plan.doc.name + ' is hidden from the players. Reveal them and show them on the iPad?')) return Promise.resolve();
    return Promise.resolve().then(function () { return ref.update({ revealed: true, firstSeen: nowIso() }); }).then(function () {
      return pushDisplay({ kind: 'npc', npcId: plan.id, title: str(plan.doc.name).slice(0, 2000) });
    }).then(function () { toast('On the iPad: ' + plan.doc.name + '.'); }, function (e) { if (!e || !e.superseded) toast('Could not reveal and show them: ' + errText(e), true); });
  }
  /* Undo: a compare-and-swap. The object is read fresh; if it is not as the co-GM left it the undo is REFUSED (the promise rejects, so the panel does not
     mark the card undone) and the card asks first. `viaButton` is the "Undo anyway" button: it forces, and marks the card itself. */
  function cogmLiveFor(me, rec) {
    if (rec.type === 'clock_add' || rec.type === 'clock_tick') return Promise.resolve({ clock: tableClocks().filter(function (c) { return c.id === rec.id; })[0] || null });
    if (rec.type === 'capture') { var e = isObj(S.doc.capture) ? S.doc.capture[rec.id] : null; return Promise.resolve({ capture: isObj(e) ? str(e.text) : null }); }
    var ref = npcRef(rec.id);
    return Promise.resolve().then(function () { return ref && typeof ref.get === 'function' ? ref.get() : null; }).then(function (snap) {
      var d = snap && snap.exists ? snap.data() : (me.npcs && me.npcs[rec.id]) || null;
      return { npc: d };
    });
  }
  function cogmUndoWrite(me, rec, w) {
    var api = me.api;
    if (rec.type === 'clock_add' || rec.type === 'clock_tick') {
      if (!api || typeof api.clockOps !== 'function') return Promise.reject(new Error('The table is not available here.'));
      return Promise.resolve().then(function () { return api.clockOps([w]); }).then(function () { if (rec.type === 'clock_add') delete me.cogm.mine[rec.id]; });
    }
    if (rec.type === 'capture') { var p = {}; p[rec.id] = null; patch({ capture: p }, { force: true }); renderCapture(); return Promise.resolve(); }
    var ref = npcRef(rec.id); if (!ref) return Promise.reject(new Error('The cast is not available here.'));
    return Promise.resolve().then(function () { return ref.update(clone(w)); });
  }
  function cogmUndo(me, a, viaButton) {
    var cm = me.cogm, C = cm.C, rec = cm.recs[a.key], ctl = me.assist;
    if (!rec) return Promise.resolve();
    return cogmLiveFor(me, rec).then(function (live) {
      var u = C.planUndo(rec, live, viaButton === true);
      if (!u.ok) {
        var msg = 'Changed since: now ' + u.now + ', was ' + u.was + '.';
        if (ctl) ctl.updateCard(cogmCardId(a), { bullets: [C.plain(msg, 150)], actions: cogmButtons(me, a).concat([{ id: 'force', label: 'Undo anyway', run: function () { return cogmUndo(me, a, true); } }]) });
        toast('Not undone: it changed since. Open the card to undo it anyway.', true);
        throw new Error('changed');
      }
      return (u.noop ? Promise.resolve() : cogmUndoWrite(me, rec, u.write)).then(function () {
        cm.undone[a.key] = true;                               /* "Blade, undo" looks for the newest thing that is not undone yet */
        if (viaButton && ctl) ctl.updateCard(cogmCardId(a), { bullets: [], actions: [], undone: true });
        else if (ctl) ctl.updateCard(cogmCardId(a), { bullets: [], actions: [] });
      });
    });
  }
  function loadShown() {
    var g = gmApi(), me = S; if (!g || typeof g.display !== 'function' || AM.displayRead) return;
    Promise.resolve().then(function () { return g.display(); }).then(function (r) {
      if (r && isObj(r.display)) { AM.displayRead = true; apSeed(!AM.shown, r.display.kind); AM.shown = AM.shown || { kind: str(r.display.kind), title: str(r.display.title) }; }
      if (S === me) renderBar();
    }, function () {});
  }
  function layout() {
    var segs = [['console', 'Console'], ['prep', 'Prep'], ['location', 'Location'], ['scenes', 'Street'], ['score', 'Score'], ['chase', 'Chase'], ['npc', 'NPC'], ['downtime', 'Downtime'], ['cards', 'Cards'], ['rules', 'GM screen'], ['ipad', 'iPad'], ['state', 'State']];
    S.root.innerHTML = '<div class="gm" id="gm-root" data-seg="' + esc(S.seg) + '" data-panel="' + esc(S.panel) + '">' + barHtml() +
      '<div class="seg gm-segbar" role="tablist" aria-label="Show">' + segs.map(function (s) { return '<button type="button" class="chip" role="tab" data-gm="seg" data-seg="' + s[0] + '">' + s[1] + '</button>'; }).join('') + '</div>' +
      '<div class="gm-main">' +
      /* the console column, top to bottom: Position, the Scene line (its controls fold under it), the four buttons, the card,
         Earlier, and the nine single tables folded under "More tables". Nothing sits above the card but what rolls it. */
      '<section class="gm-col gm-console" aria-label="Console">' +
      '<div class="gm-pos" id="gm-pos" role="radiogroup" aria-label="Position"></div>' +
      /* the Scene button sits in a plain div: a <button> as a direct grid item of the scrolling column collapses to its min-height once
         the column overflows (Chromium sizes the track from the button's min-height, not its wrapped content) */
      '<div class="gm-scenebox" id="gm-scenebox">' + '<label class="gm-nowline" for="gm-now-s"><span class="gm-lab">Now in</span><select data-now id="gm-now-s"></select></label>' +
      '<button type="button" class="gm-scene" id="gm-scene" data-gm="scene" aria-expanded="false" aria-controls="gm-controls"' + ' title="Scene, district, who it aims at, the NPC, the threat on screen">' + '<span class="gm-lab">Scene</span><span class="gm-scene-chips" id="gm-scene-chips"></span></button></div>' +
      '<div class="gm-mini" id="gm-mini" role="group" aria-label="Roll"></div><div class="gm-controls" id="gm-controls"></div>' + '<div class="gm-buttons" id="gm-buttons"></div><div class="gm-cardbox" id="gm-card" aria-live="polite"></div><div class="gm-rack" id="gm-rack" aria-live="polite"></div>' + '<div class="gm-earlier" id="gm-earlier"></div>' +
      '<details class="gm-singles" id="gm-singles"></details></section>' +
      '<section class="gm-col gm-side" aria-label="Side panel"><div class="gm-tabrow"><div class="gm-tabs" role="tablist" aria-label="Side panel">' +
      [['prep', 'Prep', 'R'], ['rules', 'GM screen', 'T'], ['location', 'Location', 'B'], ['scenes', 'Street', 'S'], ['score', 'Score', 'J'], ['chase', 'Chase', 'C'], ['npc', 'NPC', 'N'], ['downtime', 'Downtime', 'D'], ['cards', 'Cards', 'O'], ['ipad', 'iPad', 'I']].map(function (t) { return '<button type="button" class="gm-tab" role="tab" data-gm="panel" data-panel="' + t[0] + '">' + t[1] + ' <kbd>' + t[2] + '</kbd></button>'; }).join('') +
      '</div><button type="button" class="gm-focusbtn" data-gm="focus" aria-pressed="false" title="Shrinks the console to its keys, to read (F)">Focus <kbd>F</kbd></button></div>' + '<div class="gm-pane" data-pane="prep" id="gm-prep"></div>' + '<div class="gm-pane" data-pane="location" id="gm-loc"></div><div class="gm-pane" data-pane="scenes" id="gm-scn"></div>' + '<div class="gm-pane" data-pane="score" id="gm-score"></div><div class="gm-pane" data-pane="chase" id="gm-chase"></div>' + '<div class="gm-pane" data-pane="npc" id="gm-npc"></div><div class="gm-pane" data-pane="downtime" id="gm-dt"></div>' + '<div class="gm-pane" data-pane="cards" id="gm-cards"></div><div class="gm-pane" data-pane="rules" id="gm-rules"></div><div class="gm-pane" data-pane="ipad" id="gm-ipad"></div></section>' +
      '<aside class="gm-col gm-rail" id="gm-rail" aria-label="State"></aside></div>' +
      '<div class="gm-foot" id="gm-foot"></div>' +
      '<button type="button" class="gm-fab" data-gm="capopen" aria-expanded="false" aria-controls="gm-foot">Capture</button>' +
      '<div class="gm-find" id="gm-find" hidden><div class="gm-find-box" role="dialog" aria-label="Find"><label class="sr" for="gm-find-q">Find</label>' +
      '<input type="search" id="gm-find-q" autocomplete="off" spellcheck="false" placeholder="Find a name, a rule, a scene, a line you filed…">' +
      '<ol class="gm-find-list" id="gm-find-list"></ol><p class="gm-find-help"><kbd>↑</kbd> <kbd>↓</kbd> choose · <kbd>Enter</kbd> go (or copy) · <kbd>Esc</kbd> close</p></div></div></div>';
    renderRules();
    setApp(true);
    if (S.assist && typeof S.assist.relayout === 'function') S.assist.relayout();   /* the Blade panel sits between this bar and the capture bar */
  }
  /* the top bar of the app layout (every width): the session, saving, what the iPad shows, listening (once the transcriber has
     ever been used), Clear and Lights out, and a menu with what is not play: the display page, the note, the capture, the pack,
     the site's pages, Forget. On a phone the bar is ’68 GM · Session · iPad · Menu (gm.css) */
  function barHtml() {
    return '<div class="gm-bar"><a class="gm-bar-mark" href="#" title="Home">’68 <b>GM</b></a><span class="gm-bar-sess" id="gm-bar-sess"></span>' +
      '<label class="gm-now" title="The district the tools start from: the console, Street, Location and NPC pickers follow it until you pick one there">' +
      '<span class="gm-nowk">Now in</span><select data-now id="gm-now" aria-label="Now in: the district the tools start from"></select></label>' +
      '<span class="gm-save" role="status"></span><span class="gm-bar-exp" id="gm-bar-exp"></span>' +
      '<span class="gm-beatbar" id="gm-bar-beat" hidden><button type="button" class="gm-pill gm-beat" data-gm="beat-go" id="gm-bar-beatgo" title="The beat running (the Prep tab’s run order)"></button>' +
      '<button type="button" class="gm-bb" data-gm="beat-next" title="Start the next beat in the run order">Next beat</button></span><span class="gm-grow"></span>' +
      '<button type="button" class="gm-bb" data-gm="find-open" title="Find anything: prep, the screen, NPCs, clocks, what you filed (Ctrl+K or /)">Find <kbd>Ctrl K</kbd></button>' +
      '<button type="button" class="gm-pill" data-gm="panel" data-panel="ipad" id="gm-bar-ipad" title="What the players see (the iPad tab)"></button>' +
      '<button type="button" class="gm-pill gm-ap" data-gm="aptoggle" id="gm-bar-ap" data-ap="auto" hidden></button>' +
      '<button type="button" class="gm-pill" data-gm="panel" data-panel="ipad" id="gm-bar-stt" title="The transcriber (the iPad tab)" hidden></button>' +
      '<button type="button" class="gm-bb" data-gm="blankipad" title="Back to the ambient scene">Clear → ambient <kbd>0</kbd></button>' + '<button type="button" class="gm-bb" data-gm="darkipad" title="True black until you push something">Lights out</button>' +
      '<span class="gm-menu"><button type="button" class="gm-bb" data-gm="menu" aria-expanded="false" aria-haspopup="true">Menu</button><span class="gm-menu-list" hidden>' +
      '<p class="gm-menu-h"><span><b>GM tools</b> · The console</span><span class="gm-exp" id="gm-menu-exp"></span></p>' + '<div class="gm-menu-warn" id="gm-menu-warn" hidden></div>' +
      '<a href="#display" title="The players’ screen: open this on the iPad">Open the display page (for the iPad)</a>' +
      '<button type="button" data-gm="note">Export tonight’s note</button><button type="button" data-gm="clearcap">Clear tonight’s capture</button><button type="button" data-gm="update">Update pack</button>' +
      '<button type="button" data-gm="livesync" id="gm-menu-live" title="Live sync: a page hears of a change at once instead of on its next poll. Off sends every page back to polling; no deploy needed"></button>' +
      '<a href="#t">The table</a><a href="#rules">Rules</a><a href="#cast">The cast</a><a href="#">Home</a>' +
      '<button type="button" class="bad" data-gm="forget">Forget GM data on this device</button></span></span>' +
      '<div class="gm-signed" id="gm-signed" role="alert" hidden>' + esc(SIGNED_OUT_MSG) + '</div></div>';
  }
  function menuOpen(on) {
    var m = $q('.gm-menu-list'), b = $q('[data-gm="menu"]'); if (!m) return;
    if (on) { renderLiveItem(); m.removeAttribute('hidden'); } else m.setAttribute('hidden', ''); if (b) b.setAttribute('aria-expanded', String(!!on));
  }
  /* Live sync (design 2.5): the GM state's `live`, on unless it is an explicit false. The server puts it in the data poll's answer and the
     display's, so every page follows it within one poll; only this menu item sets it. */
  function liveOn() { return !(S && S.doc && S.doc.live === false); }
  function renderLiveItem() {
    var b = $q('#gm-menu-live'); if (b) b.textContent = 'Live sync: ' + (liveOn() ? 'on (turn off)' : 'off (turn on)');
  }
  function toggleLive() {
    var next = !liveOn();
    if (!patch({ live: next }, { force: true })) return;
    if (S.saver && S.saver.flush) S.saver.flush();
    renderLiveItem();
    toast(next ? 'Live sync is on: pages hear of a change at once.' : 'Live sync is off: every page is back to polling within a few seconds.');
  }
  /* the bar's live parts: the session, what is on the iPad, listening */
  function renderBar() {
    if (!S || !S.root) return;
    var s = $q('#gm-bar-sess'), sn = isObj(camp) && isObj(camp.session) ? +camp.session.number || 0 : 0, pn = sn ? '' : prepNoteSession();
    if (s) { s.textContent = sn ? 'Session ' + sn : pn ? 'Session ' + pn + ' (prep)' : 'Session 0'; s.title = sn ? '' : pn ? 'The table’s session counter is 0: this is the open Prep note’s session' : ''; }
    renderBeat(); renderNow();
    var ip = $q('#gm-bar-ipad');
    if (ip) {
      var shown = AM.shown ? (AM.shown.kind === 'blank' || !AM.shown.kind ? 'ambient' : displayLine(AM.shown)) : 'not known yet';
      ip.innerHTML = '<span class="gm-dot' + (AM.shown && AM.shown.kind && AM.shown.kind !== 'blank' ? ' on' : '') + '"></span>iPad: ' + esc(shown);
      ip.title = 'What the players see: ' + (AM.shown ? displayLine(AM.shown) : 'not known yet') + '. Opens the iPad tab.';
    }
    apPaint();
    var sp = $q('#gm-bar-stt'); if (!sp) return;
    var d = STT.doc, on = !!(d && d.want === 'on'), st = d && isObj(d.status) ? d.status : {}, age = st.at ? (Date.now() - Date.parse(st.at)) / 1000 : null;
    var pc = d && isObj(d.copier) && d.copier.at ? (Date.now() - Date.parse(d.copier.at)) / 1000 : null;
    var text = !on ? 'Not listening' : st.state === 'listening' && age !== null && age < 40 ? 'Listening' + (pc !== null && pc < 180 ? ' · PC copying' : ' · PC not copying') : 'Listening: waiting for the iPad';
    var warn = on && !(st.state === 'listening' && age !== null && age < 40 && pc !== null && pc < 180);
    sp.innerHTML = '<span class="gm-dot' + (on ? warn ? ' warn' : ' on' : '') + '"></span>' + esc(text);
    sp.classList.toggle('warn', warn);
    /* the pill only once the transcriber has ever been set up (the stt document written), or while it is on */
    var show = STT.loaded && (!!STT.at || on);
    sp.hidden = !show; if (show) sp.removeAttribute('hidden'); else sp.setAttribute('hidden', '');
  }
  /* the open Prep note's session ('' without one): the bar's stand-in while the table's counter is 0 */
  function prepNoteSession() {
    var pk = part('prep'), B = W.B68GmPrep; if (!pk || !B) return '';
    var id = prepNoteId(pk), n = B.notes(pk).filter(function (x) { return x.id === id; })[0];
    return n && /^\d+(\.\d+)?$/.test(str(n.session).trim()) ? str(n.session).trim() : '';
  }
  /* the beat running in the Prep tab's run order (the newest started), with its time against the row's budget */
  function runningBeat() {
    var b = prepDoc().beats, best = null; if (!isObj(b)) return null;
    Object.keys(b).forEach(function (k) { if (isObj(b[k]) && (!best || str(b[k].at) > best.at)) best = { key: k, at: str(b[k].at), label: str(b[k].label) }; });
    return best;
  }
  function beatButton(key) { return key ? $q('#gm-prep [data-beat="' + str(key).replace(/"/g, '') + '"]') : null; }
  function nextBeatButton(btn) {
    if (!btn || !S.root) return null;
    var all = [].slice.call(S.root.querySelectorAll('#gm-prep .pp-beat')), i = all.indexOf(btn);
    for (var j = i + 1; i >= 0 && j < all.length; j++) if (all[j].getAttribute('aria-pressed') !== 'true') return all[j];
    return null;
  }
  function renderBeat() {
    var box = $q('#gm-bar-beat'), go = $q('#gm-bar-beatgo'); if (!box || !go) return;
    var r = S && S.doc ? runningBeat() : null; if (!r) { box.hidden = true; return; }
    var btn = beatButton(r.key), tr = btn && btn.closest ? btn.closest('tr') : null, min = tr ? +tr.getAttribute('data-min') || 0 : 0;
    var m = Math.max(0, Math.floor((Date.now() - Date.parse(r.at)) / 60000)), over = min ? m / min : 0;
    go.innerHTML = '<span class="gm-dot on"></span>' + esc(shortLabel(r.label, 40)) + ' · <b>' + m + (min ? ' / ' + min : '') + ' min</b>';
    go.className = 'gm-pill gm-beat' + (over >= 1.5 ? ' late' : over >= 1 ? ' due' : '');
    go.title = 'Running since ' + hm(r.at) + (min ? ', budget ' + min + ' min' : '') + '. Opens it in the Prep tab.';
    var nx = $q('[data-gm="beat-next"]'); if (nx) nx.hidden = !nextBeatButton(btn);
    box.hidden = false;
  }
  function beatGo() {
    var r = runningBeat(), btn = r && beatButton(r.key); setPanel('prep');
    if (btn) { var tr = btn.closest ? btn.closest('tr') : btn; try { tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {} flash(tr); }
  }
  function beatNext() {
    var r = runningBeat(), nx = nextBeatButton(r && beatButton(r.key));
    if (!nx) { toast('No beat after this one in the run order.', true); return; }
    prepBeat(nx); toast('Started: ' + str(nx.getAttribute('data-label')).slice(0, 60) + '.');
  }
  function flash(el) { if (!el || !el.classList) return; el.classList.add('gm-flash'); setTimeout(function () { if (el.classList) el.classList.remove('gm-flash'); }, 1700); }

  /* ---------- Find (Ctrl+K or /): an overlay over the page ---------- */
  function findIndex() {
    var out = [], c = part('campaign') || {}, lc = function (x) { return str(x).toLowerCase(); }, known = {}, v = S.prepView;
    if (v && v.note) {
      Object.keys(v.secs || {}).forEach(function (id) { var x = v.secs[id]; out.push({ kind: 'Prep', title: x.head || v.note.title, text: findText(x.src), go: { t: 'prep', id: id } }); });
      (v.note.blocks || []).forEach(function (b) { if (isObj(b) && b.k === 'embed') out.push({ kind: 'Prep', title: str(b.from).split('/').pop().replace(/\.md$/i, '') + (b.heading ? ' › ' + b.heading : ''), text: findText(b.src), go: { t: 'embed', from: str(b.from) } }); });
    }
    screenSections().forEach(function (x) { out.push({ kind: 'Screen', title: x.title, text: findText(x.md), go: { t: 'screen', id: x.id } }); });
    (c.npcs || []).forEach(function (n) { if (!isObj(n) || !n.name) return; known[lc(n.name)] = 1; out.push({ kind: 'NPC', title: n.name, sub: [n.role, n.faction, n.district].filter(Boolean).join(' · '), text: [n.glance, n.mannerism, (Array.isArray(n.say) ? n.say : []).join(' '), n.playedBy ? 'played by ' + n.playedBy : ''].join(' '), go: { t: 'npc', name: n.name } }); });
    Object.keys(S.npcs || {}).forEach(function (id) { var n = S.npcs[id]; if (!isObj(n) || !n.name || known[lc(n.name)]) return; out.push({ kind: 'NPC (app)', title: n.name, sub: [n.role, n.faction].filter(Boolean).join(' · '), text: str(n.description), go: { t: 'npcapp' } }); });
    (c.pcs || []).forEach(function (x) { if (isObj(x) && x.name) out.push({ kind: 'PC', title: x.name, sub: x.playbook, text: [].concat(x.friend || [], x.rival || [], x.vice || []).join(' '), go: { t: 'pc', name: x.file || x.name } }); });
    (c.standing || []).forEach(function (x) { if (isObj(x) && x.faction) out.push({ kind: 'Faction', title: x.faction, sub: 'status with the crew ' + (x.status > 0 ? '+' : '') + (+x.status || 0), go: { t: 'faction', name: B68slug(x.faction) } }); });
    (Array.isArray(camp && camp.clocks) ? camp.clocks : []).forEach(function (k) { if (isObj(k)) out.push({ kind: 'Table clock', title: k.name || 'Clock', sub: (+k.filled || 0) + '/' + (+k.size || 0) + (k.hidden ? ' · hidden from players' : ''), go: { t: 'rail' } }); });
    (c.clocks || []).forEach(function (k) { if (isObj(k)) out.push({ kind: 'World clock', title: k.goal || k.name, sub: [k.faction, (+k.filled || 0) + '/' + (+k.segments || 0)].filter(Boolean).join(' · '), text: [k.name, k.district].join(' '), go: { t: 'rail' } }); });
    (c.callbacks || []).forEach(function (x) { if (isObj(x) && x.text) out.push({ kind: 'Callback', title: x.text, sub: x.src, go: null }); });
    (c.cast || []).forEach(function (x) { if (isObj(x) && x.text) out.push({ kind: 'Cast', title: x.text, sub: x.src, go: null }); });
    var chc = chCur(), CG = W.B68GmChase; if (chc && CG) CG.findEntries(chc).forEach(function (x) { out.push({ kind: x.kind, title: x.title, sub: x.sub, text: x.text, go: { t: 'chase' } }); });
    newest(S.doc.capture).forEach(function (e) { var b = BUCKETS.filter(function (x) { return x.k === e.bucket; })[0]; if (str(e.text).trim()) out.push({ kind: (b ? b.label : 'Filed') + ' · filed', title: e.text, sub: hm(e.at), go: null }); });
    return out;
  }
  function findOn() { return !!(S && S.findIdx); }
  function findOpen() {
    var f = $q('#gm-find'), q = $q('#gm-find-q'); if (!f || !q) return;
    S.findIdx = findIndex(); f.hidden = false; f.removeAttribute('hidden'); q.focus(); try { q.select(); } catch (e) {}
    findRender(q.value);
    /* the rules, when this device holds a copy: read behind the box, then the list is drawn again with them */
    var R = rulesApi(), me = S;
    if (R && typeof R.load === 'function') Promise.resolve().then(function () { return R.load(true); }).then(function (c) { var fq = $q('#gm-find-q'); if (c && S === me && findOn() && fq && fq.value.trim()) findRender(fq.value); }, function () {});
  }
  function findClose() { var f = $q('#gm-find'), q = $q('#gm-find-q'); if (f) { f.hidden = true; f.setAttribute('hidden', ''); } if (q && document.activeElement === q) q.blur(); S.findIdx = null; }
  function findRender(q) {
    var list = $q('#gm-find-list'); if (!list) return;
    var hits = S.findHits = findHits(S.findIdx || [], q, 30).concat(rulesFindHits(q)); S.findSel = 0;
    list.innerHTML = !str(q).trim() ? '<li class="gm-find-none">Prep, the screen, the rules, NPCs, PCs, factions, clocks, callbacks, the chase, and what you filed tonight.</li>'
      : !hits.length ? '<li class="gm-find-none">Nothing matches “' + esc(q) + '”.</li>'
      : hits.map(function (h, i) {
        return '<li><button type="button" class="gm-find-hit" data-gm="find-go" data-i="' + i + '" aria-selected="' + (i === 0) + '"><span class="gm-find-kind">' + esc(h.kind) + '</span><b>' + esc(h.title) + '</b>' +
          (h.sub ? ' <small>' + esc(h.sub) + '</small>' : '') + (h.snipHtml ? '<span class="gm-find-snip">' + h.snipHtml + '</span>' : h.snip ? '<span class="gm-find-snip">' + esc(h.snip) + '</span>' : '') + '</button></li>';
      }).join('');
  }
  function findMove(d) {
    var hs = S.findHits || []; if (!hs.length) return;
    S.findSel = ((S.findSel || 0) + d + hs.length) % hs.length;
    [].forEach.call(S.root.querySelectorAll('.gm-find-hit'), function (b, i) { b.setAttribute('aria-selected', String(i === S.findSel)); if (i === S.findSel) { try { b.scrollIntoView({ block: 'nearest' }); } catch (e) {} } });
  }
  function linkFor(kind, name) {
    var pk = part('prep'), links = pk && isObj(pk.links) ? pk.links : {}, want = B68slug(name);
    return Object.keys(links).map(function (k) { return links[k]; }).filter(function (L) { return isObj(L) && L.k === kind && B68slug(L.name) === want; })[0] || { name: name, rel: '' };
  }
  function findGo(i) {
    var h = S.findHits && S.findHits[i]; if (!h) return;
    var g = h.go;
    if (!g) { if (S.api && S.api.copy) S.api.copy(str(h.title), 'Copied.'); return; }
    findClose();
    if (g.t === 'prep') { prepGo(g.id); flash($q('#' + g.id)); }
    else if (g.t === 'embed') { setPanel('prep'); var em = $q('#gm-prep .pp-embed[data-from="' + g.from.replace(/"/g, '') + '"]'); if (em) { try { em.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) {} flash(em); } }
    else if (g.t === 'screen') { setPanel('rules'); var fq = $q('#gm-gs-q'); if (fq && fq.value) { fq.value = ''; filterScreen(''); } screenJump(g.id); flash($q('#gm-rules [data-gs="' + str(g.id).replace(/"/g, '') + '"]')); }
    else if (g.t === 'npc' || g.t === 'pc' || g.t === 'faction') {
      if (!$q('#gm-prep-peek')) { toast(h.kind + ': ' + h.title + (h.sub ? ' (' + h.sub + ')' : ''), false); return; }
      setPanel('prep'); prepPeek(g.t, linkFor(g.t, g.name));
    }
    else if (g.t === 'npcapp') setPanel('npc');
    else if (g.t === 'chase') { setPanel('chase'); if (isPhone()) { S.seg = 'side'; syncPanels(); } }
    else if (g.t === 'rule') { setPanel('rules'); if (isPhone()) { S.seg = 'side'; syncPanels(); } rulesSearch(g.q, g.id); }
    else if (g.t === 'rail') { if (isPhone()) { S.seg = 'state'; syncPanels(); } flash($q('#gm-rail .gm-clocks')); }
  }

  /* the table clocks to the iPad (an svg made here; the server checks it like any map). While the iPad shows them, a change
     to a clock on the table sends them again. As the chase strip: S.clOn = { seq } is the display seq the server answered when
     Show on iPad put them up; a change sends them again with ifSeq, so it lands only while nothing else has gone to the display
     since (another device's push in between is a 409: they stop following and the page says so). Anything else this page pushes
     ends it (pushDisplay), whatever its title. resend: a follow-up. */
  function tableClocks() { return Array.isArray(camp && camp.clocks) ? camp.clocks.filter(isObj) : []; }
  function endClocks() { if (S && S.clOn) { S.clOn = null; clearTimeout(S.clocksT); } }
  function clocksToIpad(quiet, resend) {
    var svg = clocksSvg(tableClocks()); if (!svg) { if (!quiet) toast('No clock the players can see.', true); return; }
    gate.mark(svg);
    var me = S;
    if (!resend) endClocks();
    pushDisplay({ kind: 'svg', title: 'Clocks', caption: 'The table clocks', svg: svg }, {
      clocks: true,
      prepare: resend ? function (body) { return S === me && S.clOn ? Object.assign({}, body, { ifSeq: S.clOn.seq }) : null; } : null,
      done: function (r) { if (S === me && typeof r.seq === 'number' && (!resend || S.clOn)) S.clOn = { seq: r.seq, svg: svg }; },
      fail: function () { if (S === me && resend) endClocks(); }
    }).then(function () { if (!quiet) toast('On the iPad: the clocks. They follow the table while they are up.'); }, function (e) {
      if (e.superseded) return;
      if (resend && e.status === 409) toast('Something else is on the iPad now, so the clocks were not sent and no longer follow the table. Show on iPad sends them again.', true);
      else toast('Could not send the clocks: ' + errText(e) + (resend ? '. They no longer follow the table: Show on iPad sends them again.' : ''), true);
    });
  }

  function redrawAll() {
    if (!S || S.status !== 'ready' || !$q('#gm-root')) return;
    syncHead(); renderBar(); syncPanels(); renderConsole(); renderPrep(); renderRules(); renderLocation(); renderScenes(); renderNpcs(); renderScore(); renderChase(); renderDowntime(); renderCards(); renderIpad(); renderRail(); renderCapture(); syncSave();
  }
  /* the pack's export date: in the Menu in full, in the bar only when stale or an offline copy */
  function syncHead() {
    var e = $q('#gm-menu-exp'); if (!e) return;
    var cp = S.pack && S.pack.parts && (S.pack.parts.campaign || S.pack.parts.console), at = cp && cp.src && cp.src.exportedAt;
    var age = ageDays(at);
    e.textContent = at ? 'Campaign data exported ' + dmy(at) + (age != null && age > LIMITS.staleDays ? ' · ' + Math.floor(age) + ' days old: rebuild the pack' : '') + (S.offline ? ' · offline copy' : '') : 'Campaign data: no export date';
    e.classList.toggle('stale', age != null && age > LIMITS.staleDays);
    var be = $q('#gm-bar-exp');
    if (be) be.textContent = (at && age != null && age > LIMITS.staleDays ? 'Pack ' + Math.floor(age) + ' days old' : '') + (S.offline ? (at && age > LIMITS.staleDays ? ' · ' : '') + 'offline copy' : '');
  }
  function syncPanels() {
    var r = $q('#gm-root'); if (!r) return;
    r.setAttribute('data-seg', S.seg); r.setAttribute('data-panel', S.panel);
    r.querySelectorAll('[data-gm="seg"]').forEach(function (b) { var on = b.getAttribute('data-seg') === (S.seg === 'side' ? S.panel : S.seg); b.setAttribute('aria-selected', String(on)); b.setAttribute('aria-pressed', String(on)); });
    r.querySelectorAll('[data-gm="panel"]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-panel') === S.panel)); });
    r.querySelectorAll('.gm-pane').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== S.panel; });
    var sc = $q('#gm-scene'); if (sc) sc.setAttribute('aria-expanded', String(!!S.sceneOpen)); r.classList.toggle('scene-open', !!S.sceneOpen);
    var fab = $q('.gm-fab'); if (fab) fab.setAttribute('aria-expanded', String(!!S.capOpen)); r.classList.toggle('cap-open', !!S.capOpen);
    r.classList.toggle('prep-wide', S.panel === 'prep' && !!S.prepWide);
    r.classList.toggle('focus', !!S.prepWide);       /* the laptop layout: Focus (or Prep's Wide) shrinks the console on every tab */
    r.querySelectorAll('[data-gm="prep-wide"], [data-gm="focus"]').forEach(function (b) { b.setAttribute('aria-pressed', String(!!S.prepWide)); });
  }
  function setPanel(p) {
    S.panel = p; if (S.seg !== 'console' && S.seg !== 'state') S.seg = 'side';
    try { W.localStorage.setItem('b68.gm.panel', p); } catch (e) {}
    syncPanels();
    if (p === 'ipad') { loadAmbient(); loadStt(); }
    if (p === 'chase') renderChase();      /* the start form offers the Location roll or Street scene made since it was drawn */
    spy(p);
  }

  /* ---------- the console: the four Situations, the nine single tables under More tables ----------
     A console part without the situations layer (a pack from before them) draws a note where the four buttons go; its single
     tables still roll. */
  function hasSit() { return !!(S && S.con && typeof S.con.situation === 'function' && Array.isArray(S.con.situationControls) && typeof S.con.situations === 'function'); }
  function ctlList() { return !S.con ? [] : hasSit() ? S.con.situationControls.filter(function (c) { return c.id !== 'pos'; }) : S.con.controls; }
  /* the live controls, with the district resolved (Now in, a pick of this tool's, or any): what a roll stores in its own ui */
  function uiNow() { var u = clone(Object.assign(hasSit() ? S.con.situationDefaults() : S.con.defaults(), live())); u.district = distFor('con'); return u; }
  function renderControls() {
    var box = $q('#gm-controls'), chips = $q('#gm-scene-chips'); if (!box) return;
    if (!S.con) { box.innerHTML = ''; if (chips) chips.textContent = ''; return; }
    var lv = uiNow(), rows = {};
    ctlList().forEach(function (c) { (rows[c.row] = rows[c.row] || []).push(c); });
    var html = Object.keys(rows).sort().map(function (r) {
      return '<div class="gm-row">' + rows[r].map(function (c) {
        var id = 'gm-c-' + esc(c.id), v = str(lv[c.id]);
        if (c.type === 'text') return '<label class="gm-field wide" for="' + id + '"><span class="gm-lab">' + esc(c.label) + '</span><input type="text" id="' + id + '" data-ctl="' + esc(c.id) + '" value="' + esc(v) + '" placeholder="' + esc(c.placeholder || '') + '" autocomplete="off"></label>';
        return '<label class="gm-field" for="' + id + '"><span class="gm-lab">' + esc(c.label) + '</span><select id="' + id + '" data-ctl="' + esc(c.id) + '">' +
          (c.id === 'district' ? distOptionsHtml('con') : (c.options || []).map(function (o) { return '<option value="' + esc(o.value) + '"' + (str(o.value) === v ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('')) + '</select></label>';
      }).join('') + '</div>';
    }).join('');
    box.innerHTML = html;
    renderChips();
  }
  /* the Scene line's chips: every control with its label ("District: any · Threat: 3"), since the line is all that shows until
     the disclosure opens; an empty text control says nothing */
  function chipLabel(l) { return str(l).replace(/ on screen$/i, '').replace(/^Aim at$/i, 'Aim').replace(/^NPC is$/i, 'NPC'); }
  function renderChips() {
    var chips = $q('#gm-scene-chips'); if (!chips || !S.con) return;
    var lv = uiNow(), bits = [];
    ctlList().forEach(function (c) {
      var v = str(lv[c.id]), o = (c.options || []).filter(function (x) { return str(x.value) === v; })[0];
      var shown = o ? str(o.label) : v.length > 28 ? v.slice(0, 26) + '…' : v;
      if (!shown && c.type === 'text') return;
      bits.push('<span class="gm-chip"><span class="gm-chip-k">' + esc(chipLabel(c.label)) + ':</span> ' + esc(shown || 'any') + '</span>');
    });
    chips.innerHTML = bits.join('') || '<span class="gm-dim">any</span>';
  }
  function setLive(id, value) { var l = {}; l[id] = value; patch({ con: { live: l } }); renderChips(); if (id !== 'pos' && S && S.pre) schedulePre(1500); }
  /* the big three-way Position switch (always on screen, the phone too) */
  function renderPos() {
    var box = $q('#gm-pos'); if (!box) return;
    if (!hasSit()) { box.innerHTML = ''; return; }
    var cur = str(uiNow().pos);
    box.innerHTML = '<span class="gm-lab">Position</span><div class="gm-posb-row">' + S.con.positions.map(function (p) {
      return '<button type="button" class="gm-posb" role="radio" aria-checked="' + (p.value === cur) + '" data-gm="pos" data-v="' + esc(p.value) + '"><b>' + esc(p.label) + '</b><small>' + esc(p.severity + ' · ' + p.ticks) + '</small><small>harm ' + esc(p.harm) + '</small></button>';
    }).join('') + '</div><div class="gm-dots" role="radiogroup" aria-label="Dots"><span class="gm-lab">Dots</span>' + [0, 1, 2, 3, 4].map(function (d) {
      return '<button type="button" class="gm-dotb" role="radio" aria-checked="' + (S.dots === d) + '" data-gm="dots" data-v="' + d + '">' + d + '</button>';
    }).join('') + '</div>';
  }
  function renderButtons() {
    var box = $q('#gm-buttons'); if (!box) return;
    var mini = $q('#gm-mini');
    if (mini) mini.innerHTML = !hasSit() ? '' : S.con.situations().map(function (b) { return '<button type="button" data-gm="situation" data-n="' + b.key + '" title="' + esc(b.label) + '">' + b.key + '<small>' + esc(str(b.label).slice(0, 8)) + '</small></button>'; }).join('');
    if (!S.con) { box.innerHTML = '<p class="gm-note bad">' + esc(S.conErr || 'The console is not available.') + '</p>'; return; }
    if (!hasSit()) { box.innerHTML = '<p class="gm-note bad">The pack’s console has no Situations: update the pack. The single tables are under More tables.</p>'; return; }
    box.innerHTML = S.con.situations().map(function (b) {
      return '<button type="button" class="gm-btn gm-sbtn" data-gm="situation" data-n="' + b.key + '" data-sit="' + esc(b.id) + '" title="' + esc(b.hint || '') + '"><kbd>' + b.key + '</kbd><b>' + esc(b.label) + '</b><small>' + esc(b.hint || '') + '</small></button>';
    }).join('');
  }
  /* the nine single tables (no keys), folded under "More tables" below the card and Earlier; the fold keeps its state across a redraw */
  function renderSingles() {
    var box = $q('#gm-singles'); if (!box) return;
    if (!S.con) { box.innerHTML = ''; return; }
    var open = !!box.open;
    box.innerHTML = '<summary><span class="gm-lab">More tables</span><span class="gm-dim">the nine single tables</span></summary><div class="gm-singles-b">' + S.con.buttons.map(function (b) {
      return '<button type="button" class="chip sm" data-gm="roll" data-n="' + b.n + '" title="' + esc(b.hint || '') + '">' + esc(b.label) + '</button>';
    }).join('') + '</div>';
    if (open) box.open = true;
  }
  function renderConsole() { renderPos(); renderControls(); renderButtons(); renderSingles(); drawConsoleCard(); renderRack(); }
  function setDots(v) { if (!S) return; var n = Number(v); S.dots = (Number.isInteger(n) && n >= 0 && n <= 4 && S.dots !== n) ? n : null; renderPos(); }     /* tap again clears */
  function setPos(v) { setLive('pos', v); renderPos(); schedulePre(); }
  /* a roll is never invisible: Focus (which hides the card) goes, said once per page load, and the card's header is scrolled
     into view in the console column */
  var focusLeftToasted = false;
  function stamp(kind, res) {
    S.conRes = res; S.shown = kind; S.last = { text: lastText(res, S.dots) }; drawConsoleCard(res);
    if (res && res.meta && (res.meta.situation === 'fourfive' || res.meta.situation === 'onetothree') && S.dots != null) { S.dots = null; renderPos(); }     /* the roll is resolved: the dots reset, like the pre-rolled draws */
    if (S.prepWide) { toggleFocus(); if (!focusLeftToasted) { focusLeftToasted = true; toast('Focus off so the card shows. F brings it back.'); } }
    showCard();
  }
  /* the card into view in its scroller (the console column on a laptop, the page on a phone), by the least scroll that shows
     it: the whole card when it fits, else its lead box (the header just above it), so the Position switch stays on screen
     whenever there is room; nothing moves when the card is on screen already. The sticky bars and the phone's capture
     button are allowed for through scroll-margins. A side panel's card (Downtime) goes the same way in its own pane, its part to
     read first being the cost box of an overindulgence, else its lead box. parts: the selectors tried in turn for that part. */
  function showCard() { showIn($q('#gm-card'), $q('.gm-console'), ['.gm-lead', '.gm-card-h']); }
  function showIn(box, col, parts) {
    if (!box || typeof box.scrollIntoView !== 'function' || typeof box.getBoundingClientRect !== 'function') return;
    var r = box.getBoundingClientRect(), top = 0, bottom = +W.innerHeight || 0, c;
    try {
      if (col && W.getComputedStyle && /auto|scroll/.test(W.getComputedStyle(col).overflowY)) { c = col.getBoundingClientRect(); top = c.top; bottom = c.bottom; }
      else if (W.getComputedStyle) { var cs = W.getComputedStyle(box); top += parseFloat(cs.scrollMarginTop) || 0; bottom -= parseFloat(cs.scrollMarginBottom) || 0; }
    } catch (e) {}
    if (r.top >= top && r.bottom <= bottom) return;
    var target = r.height <= bottom - top ? box : null;
    (parts || []).forEach(function (s) { if (!target) target = box.querySelector(s); });
    target = target || box;
    var smooth = true; try { smooth = !(W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
    try { target.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' }); } catch (e) { try { target.scrollIntoView(); } catch (x) {} }
  }
  function rollConsole(n) {
    if (!S || !S.con) return;
    var res; try { res = S.con.roll(n, uiNow()); } catch (e) { toast('The roll failed: ' + errText(e), true); return; }
    var entry = consoleEntry(res, S.doc.con);    /* with the bargains and callbacks as they are now, for an exact redraw */
    var hid = uid('h'), hist = isObj(S.doc.hist) && isObj(S.doc.hist.console) ? S.doc.hist.console : {};
    var ok = patch({ cards: { console: Object.assign({ hid: hid }, entry) }, mem: { console: clone(S.con.mem()) }, hist: { console: addCapped(hist, hid, entry, LIMITS.hist) } }, { force: true });
    if (!ok) return;
    stamp('console', res);
  }
  /* a situation: a composed card, stored and replayed under its own id 'situation', never 'console' (old code would redraw
     an unknown console id as a Devil's Bargain) */
  function rollSituation(n) {
    if (!S || !hasSit()) return;
    var ui = uiNow(), use = takePre(n, ui);       /* a 1-3 or 4/5 the console already drew for this Position: replayed, never re-rolled */
    var res; try { res = use ? S.con.situation(n, ui, preRoll(use)) : S.con.situation(n, ui); } catch (e) { toast('The roll failed: ' + errText(e), true); return; }
    var entry = situationEntry(res, S.doc.con);
    var hid = uid('h'), hist = isObj(S.doc.hist) && isObj(S.doc.hist.situation) ? S.doc.hist.situation : {};
    var ok = patch({ cards: { situation: Object.assign({ hid: hid }, entry) }, mem: { console: clone(S.con.mem()) }, hist: { situation: addCapped(hist, hid, entry, LIMITS.hist) } }, { force: true });
    if (!ok) return;
    if (use) preUsed(use, res);
    stamp('situation', res);
    if (res && res.meta && (res.meta.situation === 'fourfive' || res.meta.situation === 'onetothree')) assistRolled();     /* a 4/5 or a 1-3 result; Before (a Devil's Bargain) and Someone are not rolls */
  }

  /* ---------- Claude at the table: the console's own 1-3 and 4/5 draws, pre-rolled for the Position ----------
     When the GM sets Position (or a control the draw reads, once a Position has been set), the console rolls its 1-3 and 4/5 cards
     ONCE with its own function (con.situation) and keeps each one's seed and the memory it was drawn from. It sends the two
     cards' text to the Fixer (POST /api/gm/assist/fit). Tapping 1-3 or 4/5 later replays that very draw (same seed, same memory),
     so the card and the fitted line cannot differ; changing Position re-rolls and re-fits; Clear on the Rack drops both.
     The draws live in this page's state only (a reload forgets them and the next roll draws as it always did). Nothing is pre-rolled,
     and no fit call is made, when the box cannot fit (a phone, no box, the cap reached) or Listening is off. The Fixer's answer
     shows in the Rack under the card; it never replaces the card, and a late answer still lands there. */
  var PRE_KINDS = [['low', 'onetothree'], ['mid', 'fourfive']];
  var PRE_MS = 500, FIT_RETRY_MS = 11000;
  var preTok = 0;
  function newSeedNow() { return (Math.random() * 4294967296) >>> 0; }
  function sitIdOf(n) { var x = S.con.situations().filter(function (b) { return b.id === n || b.key === Number(n); })[0]; return x ? x.id : ''; }
  function preReset() {
    if (!S) return;
    if (S.preTimer) { W.clearTimeout(S.preTimer); S.preTimer = null; }
    if (S.preRetry) { W.clearTimeout(S.preRetry); S.preRetry = null; }
    S.pre = null; S.rack = null; S.fitTok = ++preTok;     /* a late answer for the old draws is dropped */
  }
  /* roll the pair for the controls as they are now; returns { pre, fresh } (the pair already held is kept while the controls and its draws are unchanged) */
  function preroll() {
    if (!S || !hasSit()) return null;
    var ui = uiNow(), sig = preSig(ui), cur = S.pre;
    if (cur && cur.sig === sig && PRE_KINDS.every(function (k) { return !cur.kinds[k[1]].used; })) return { pre: cur, fresh: false };
    var memBefore = clone(S.con.mem()), pre = { tok: ++preTok, sig: sig, pos: str(ui.pos), mem: memBefore, kinds: {}, text: {}, stale: false };
    try {
      PRE_KINDS.forEach(function (k) {
        var seed = newSeedNow();
        pre.kinds[k[1]] = { seed: seed, used: false };
        pre.text[k[0]] = drawTextOf(S.con.situation(k[1], ui, { seed: seed, mem: clone(memBefore) }));   /* a copy of the memory: the console's own stays as it was */
      });
    } catch (e) { return null; }
    return { pre: pre, fresh: true };
  }
  /* Position (or a control) changed: after a short pause, re-roll the pair and ask the Fixer to fit it. A box that cannot fit leaves the console as it was. */
  function schedulePre(ms) {
    if (!S || !hasSit()) return;
    var me = S;
    if (me.preTimer) W.clearTimeout(me.preTimer);
    me.preTimer = W.setTimeout(function () {
      me.preTimer = null;
      if (S !== me) return;
      var a = me.assist;
      if (!a || typeof a.canFit !== 'function' || typeof a.autoFit !== 'function' || !a.canFit()) { preReset(); renderRack(); return; }
      var r = preroll(); if (!r) return;
      if (!r.fresh && r.pre.fitted) return;                 /* the same Position again, draws unused and already fitted: nothing to do */
      if (me.preRetry) { W.clearTimeout(me.preRetry); me.preRetry = null; }
      me.pre = r.pre; me.fitTok = r.pre.tok; if (r.fresh) me.rack = null; renderRack();
      r.pre.fitted = true;
      fitPre(r.pre, 0);
    }, ms == null ? PRE_MS : ms);
  }
  function fitPre(pre, tries) {
    var me = S, tok = pre.tok;
    me.assist.autoFit(Object.assign({ position: pre.pos, draws: { low: pre.text.low, mid: pre.text.mid } }, me.dots != null ? { dots: me.dots } : {}), function () {
      if (S === me && me.fitTok === tok) { me.rack = { tok: tok, pre: pre, status: 'pending', card: null }; renderRack(); }
    }).then(function (r) {
      if (S !== me || me.fitTok !== tok) return;             /* the Position moved on, or the Rack was cleared: this answer is for draws that are gone */
      if (r && r.card) { me.rack = { tok: tok, pre: pre, status: 'ready', card: r.card }; renderRack(); return; }
      if (r && r.error === 'busy' && !tries) { me.preRetry = W.setTimeout(function () { me.preRetry = null; if (S === me && me.fitTok === tok) fitPre(pre, 1); }, FIT_RETRY_MS); return; }
      me.rack = null;                                       /* Listening off, the cap, a failure: nothing shows, and draws never fitted are dropped so the roll is a plain one */
      if (me.pre === pre) me.pre = null;
      renderRack();
    }, function () { if (S === me && me.fitTok === tok) { me.rack = null; if (me.pre === pre) me.pre = null; renderRack(); } });
  }
  /* the pair held for these controls, if the button pressed has an unused draw in it (otherwise the roll is a plain one) */
  function takePre(n, ui) {
    var pre = S.pre; if (!pre) return null;
    var kind = sitIdOf(n); if (!pre.kinds[kind]) return null;
    if (pre.sig !== preSig(ui)) { preReset(); renderRack(); return null; }   /* the controls moved under the draws (the Now district, say): roll afresh */
    return pre.kinds[kind].used ? null : { pre: pre, kind: kind };
  }
  /* the roll options that replay the draw: its seed, and the console's memory set back to what it was when the draw was made */
  function preRoll(use) {
    var live = S.con.mem(); Object.keys(live).forEach(function (k) { delete live[k]; }); Object.assign(live, clone(use.pre.mem));
    return { seed: use.pre.kinds[use.kind].seed, mem: live };
  }
  function preUsed(use, res) {
    var pre = use.pre, key = use.kind === 'onetothree' ? 'low' : 'mid';
    pre.kinds[use.kind].used = true;
    if (drawTextOf(res) !== pre.text[key]) pre.stale = true;     /* the console's state moved since the draw (a bargain collected, say): the Rack says so */
    if (PRE_KINDS.every(function (k) { return pre.kinds[k[1]].used; }) && S.pre === pre) S.pre = null;
    renderRack();
  }
  function rackClear() { preReset(); if (S) { S.dots = null; renderPos(); } renderRack(); }
  /* the box's own "Fit it" form asks for draws too: the console's pair for that Position (the Position follows the form, quietly) */
  function drawsFor(position) {
    if (!S || !hasSit() || S.con.positions.every(function (p) { return p.value !== position; })) return null;
    if (str(uiNow().pos) !== position) { setLive('pos', position); renderPos(); }
    var r = preroll(); if (!r) return null;
    if (r.fresh) { S.pre = r.pre; S.rack = null; S.fitTok = r.pre.tok; renderRack(); }
    return { low: r.pre.text.low, mid: r.pre.text.mid };
  }
  var RACK_ROWS = [['1–3', 'one_three'], ['4–5', 'four_five'], ['6', 'six'], ['Crit', 'crit'], ['Bargain', 'bargain']];
  function renderRack() {
    var box = $q('#gm-rack'); if (!box) return;
    var r = S && S.rack, vo = S && S.voice;
    var vh = vo ? voiceHtml(vo) : '';      /* the Rack keeps the roll's own: the Fixer and Voice. What else Blade suggests is a card in the box (P4) */
    syncCards();
    if (!r) { box.innerHTML = vh; return; }
    var pre = r.pre, used = { one_three: pre && pre.kinds.onetothree.used, four_five: pre && pre.kinds.fourfive.used };
    var h = '<div class="gm-rack-h"><span class="gm-lab">Rack</span><span class="gm-dim">Blade, fitted to the scene · ' + esc(pre.pos) + '</span>' +
      '<button type="button" class="chip sm" data-gm="rackclear" title="Drops the fitted lines and the draws held for this Position">Clear</button></div>';
    if (r.status === 'pending') h += '<p class="gm-dim gm-rack-w">Fitting…</p>';
    else {
      var c = isObj(r.card) ? r.card : {};
      if (str(c.read)) h += '<p class="gm-rack-read">' + esc(str(c.read)) + '</p>';
      h += '<ol class="gm-rack-lines">' + RACK_ROWS.filter(function (x) { return str(c[x[1]]).trim(); }).map(function (x) {
        return '<li' + (used[x[1]] ? ' class="hit"' : '') + '><b>' + esc(x[0]) + '</b><span>' + esc(str(c[x[1]]).trim()) + '</span></li>'; }).join('') + '</ol>';
      if (pre && pre.stale) h += '<p class="gm-dim gm-rack-w">The card was drawn before something changed here; the lines above may not match it.</p>';
    }
    box.innerHTML = h + vh;
  }
  /* ---------- Voice: the NPC on stage, in the Rack ----------
     The page sends the on-stage NPC's name with each tick (the first NPC the campaign's scene has on stage; the server cannot tell
     who is on stage, it holds no scene). Voice's two lines arrive in the tick answer; Another asks for one more (POST /gm/assist/another).
     Nothing here exists with the box off, Listening off, the cap reached or on a phone: those never produce a tick answer. */
  function stageNames() { return npcList().filter(function (x) { return staged(x.id); }).map(function (x) { return str(x.doc.name).replace(/\s+/g, ' ').trim(); }).filter(Boolean); }
  function onStageName() { var n = stageNames(); return n.length ? n[0].slice(0, 80) : ''; }
  function setVoice(v) {
    if (!S) return;
    if (!isObj(v) || !Array.isArray(v.lines) || !v.lines.length) { if (v === null && S.voice) { S.voice = null; renderRack(); } return; }
    var lines = v.lines.map(function (l) { return str(l).trim(); }).filter(Boolean); if (!lines.length) return;
    S.voice = { who: str(v.who).trim() || 'NPC', want: str(v.want).trim(), lines: lines, at: str(v.at), busy: false, error: '' };
    renderRack();
    apNpcSpoke();
  }
  /* Stall: when the Tripwire hears the table idle or going round in circles, one offer (a complication or a clue) lands as an idea card in the box. Like Voice it needs Listening on and the cap not reached, and it stays until the GM clears it or the next offer replaces it. */
  function setStall(v) {
    if (!S) return;
    if (!isObj(v) || !str(v.offer).trim()) { if (v === null && S.stall) { S.stall = null; renderRack(); } return; }
    S.stall = { kind: str(v.kind) === 'clue' ? 'Clue' : 'Complication', offer: str(v.offer).trim(), why: str(v.why).trim(), at: str(v.at) };
    renderRack();
  }
  /* Meanwhile: on a scene change, one faction cutaway the GM can narrate (what a faction is doing off-screen), with the clock it moves and a
     suggested tick. It only suggests: nothing here ticks a clock. Like Stall it lands as an idea card in the box, needs Listening on and the cap not reached,
     and stays until Clear or the next cutaway. */
  function setMeanwhile(v) {
    if (!S) return;
    if (!isObj(v) || !str(v.cutaway).trim()) { if (v === null && S.meanwhile) { S.meanwhile = null; renderRack(); } return; }
    var t = +v.ticks;
    S.meanwhile = { faction: str(v.faction).trim(), cutaway: str(v.cutaway).trim(), clock: str(v.clock).trim(), ticks: t === 1 || t === 2 ? t : 0, why: str(v.why).trim(), at: str(v.at) };
    renderRack();
  }
  function voiceHtml(vo) {
    var a = S && S.assist, can = !!(a && typeof a.canAnother === 'function' && a.canAnother());
    return '<div class="gm-voice"><div class="gm-rack-h"><span class="gm-lab">Voice</span><span class="gm-dim"><b>' + esc(vo.who) + '</b>' + (vo.want ? ' · ' + esc(vo.want) : '') + '</span>' +
      '<button type="button" class="chip sm" data-gm="voiceclear" title="Drops these lines">Clear</button></div>' +
      '<ol class="gm-rack-lines gm-voice-lines">' + vo.lines.map(function (l) { return '<li><b>' + esc(vo.who.split(' ')[0]) + '</b><span>' + esc(l) + '</span></li>'; }).join('') + '</ol>' +
      (vo.error ? '<p class="gm-dim gm-rack-w" role="status">' + esc(vo.error) + '</p>' : '') +
      (can ? '<button type="button" class="chip sm gm-another" data-gm="another"' + (vo.busy ? ' disabled' : '') + ' title="One more line for this NPC, different from these">' + (vo.busy ? 'Another…' : 'Another') + '</button>' : '') + '</div>';
  }
  function voiceAnother() {
    var me = S, vo = me && me.voice, a = me && me.assist;
    if (!vo || vo.busy || !a || typeof a.another !== 'function') return;
    vo.busy = true; vo.error = ''; renderRack();
    a.another({ npc: vo.who, shown: vo.lines.slice(-6) }).then(function (r) {
      if (S !== me || me.voice !== vo) return;
      vo.busy = false;
      if (r && r.voice && Array.isArray(r.voice.lines)) r.voice.lines.forEach(function (l) { l = str(l).trim(); if (l && vo.lines.indexOf(l) < 0) vo.lines.push(l); });
      else if (r && r.error === 'cap') me.voice = null;                       /* the cap: nothing shows */
      else if (r && r.error === 'busy') vo.error = 'Busy: try Another again in a moment.';
      else vo.error = 'Nothing new just now.';
      renderRack();
    }, function () { if (S === me && me.voice === vo) { vo.busy = false; vo.error = 'Nothing new just now.'; renderRack(); } });
  }
  /* ---------- The Screen: what Blade made on a button, previewed as a card in the box (GM.md, "The Screen"; P4) ----------
     The box (gm/assist-panel.js) makes the item and the gatekeeper checks it; this page shows it and does the rest. Nothing reaches the iPad
     until the GM taps Show on its card: a prop or the case board goes out as a text display, a wire bulletin joins the ambient document's `wire`
     (the iPad lays it over the ambient scenes; Clear takes it off), and a portrait is only saved (Add: a HIDDEN app NPC, revealed false; showing
     it is the normal reveal flow). A block, or an item that was not checked, asks for a confirm first: the tap decides either way. */
  var SC_LABEL = { portrait: 'Portrait', prop: 'Prop', wire: 'Wire', board: 'Case board' };
  var VOCAB_KEYS = [['shape', 'shapes'], ['skin', 'skins'], ['arms (pose)', 'armPoses'], ['head.shape', 'head'], ['eyes', 'eyes'], ['brows', 'brows'], ['nose', 'nose'], ['mouth', 'mouth'],
    ['expression', 'expression'], ['ears', 'ears'], ['facialHair.type', 'facialHair'], ['eyewear.type', 'eyewear'], ['hair.style', 'hair'], ['hat.type', 'hat'], ['outfit.base', 'top'], ['outfit.mid', 'mid'],
    ['outfit.outer', 'outer'], ['outfit.neck', 'neckwear'], ['outfit.bottom', 'bottom'], ['outfit.dress', 'dress'], ['outfit.legs', 'legwear'], ['outfit.feet', 'footwear'], ['outfit.waist', 'belt'],
    ['outfit.hands', 'gloves'], ['props[].type', 'prop'], ['colour (any colour field)', 'cloth']];
  /* the figure kit's names as plain text for the portrait seat (the kit's own vocabulary; nothing of the campaign) */
  function screenVocab() {
    var K = W.B68Figure; if (!K || typeof K.options !== 'function') return '';
    var O = K.options(), names = function (v) { return Array.isArray(v) ? v : isObj(v) ? Object.keys(v) : []; };
    return VOCAB_KEYS.map(function (r) { var n = names(O[r[1]]); return n.length ? r[0] + ': ' + n.join(', ') : ''; }).filter(Boolean).join('\n');
  }
  function screenCleanSpec(spec, name) {
    var N = W.B68GmNpc, K = W.B68Figure;
    if (!N || typeof N.cleanSpec !== 'function' || !K) return null;
    try { return N.cleanSpec(spec, { K: K, name: name }); } catch (e) { return { ok: false, spec: {}, notes: [], warnings: [errText(e)] }; }
  }
  function screenItem(id) { return S && S.screenItems ? S.screenItems.filter(function (x) { return x.id === id; })[0] || null : null; }
  /* an item from the box: new, or the same one again once the gatekeeper has answered */
  function setScreenItem(item) {
    if (!S || !isObj(item) || typeof item.id !== 'string') return;
    S.screenItems = S.screenItems || [];
    var cur = screenItem(item.id);
    if (cur) Object.keys(item).forEach(function (k) { cur[k] = item[k]; });
    else {
      cur = Object.assign({ shown: false, added: null, svg: '' }, item);
      S.screenItems.push(cur);
      if (S.screenItems.length > 4) S.screenItems.shift();
    }
    if (cur.kind === 'portrait' && !cur.svg && isObj(cur.spec) && W.B68Figure && W.B68Figure.portrait) {
      try { var sp = clone(cur.spec); sp.id = 'gm-screen'; cur.svg = stripSize(W.B68Figure.portrait(sp, { lod: 'lo' }).svg); } catch (e) { cur.svg = ''; }
    }
    renderRack();
  }
  function gateOk(it) { var g = isObj(it.gate) ? it.gate : {}; return !!g.checked && g.verdict === 'pass'; }
  function wireList() { return AM.doc && Array.isArray(AM.doc.wire) ? AM.doc.wire.filter(function (x) { return isObj(x) && typeof x.id === 'string' && typeof x.text === 'string'; }) : []; }
  /* the gatekeeper's verdict as a chip (text and tone) and as the bullets that explain it; the card shows them, the tap still decides */
  function gateChip(it) {
    if (it.status !== 'ready') return { text: 'Checking…', tone: 'wait' };
    var g = isObj(it.gate) ? it.gate : {};
    return gateOk(it) ? { text: 'Checked: clear', tone: 'ok' } : g.checked ? { text: 'Blocked', tone: 'bad' } : { text: 'Not checked', tone: 'unk' };
  }
  function gateBullets(it, full) {
    if (it.status !== 'ready') return [];
    var g = isObj(it.gate) ? it.gate : {}, why = [], tail = [];
    if (!gateOk(it)) {
      why = (g.reasons || []).concat((g.revealed || []).map(function (x) { return 'Reveals: ' + x; })).concat((g.rule || []).map(function (x) { return 'Rule: ' + x; }));
      if (!why.length) why = ['Not checked.'];
      tail.push('Show asks you to confirm. Your tap decides.');
    }
    if (g.cites_bad && g.cites_bad.length) tail.push('Check these page cites: ' + g.cites_bad.join('; '));
    return full ? why.concat(tail) : why.slice(0, 5 - tail.length).concat(tail);
  }
  function screenShow(id) {
    var me = S, it = screenItem(id); if (!it || it.status !== 'ready' || it.kind === 'portrait') return;
    var g = isObj(it.gate) ? it.gate : {};
    if (!gateOk(it)) {
      var why = g.checked ? 'The gatekeeper blocked this' + (g.reasons && g.reasons.length ? ': ' + g.reasons.join(' ') : '.') : 'The gatekeeper did not check this.';
      if (!W.confirm(why + '\n\nShow it to the players anyway?')) return;
    }
    if (it.kind === 'wire') { screenWire(it); return; }
    pushDisplay({ kind: 'text', title: str(it.title), text: str(it.text) }).then(function () {
      if (S === me) { it.shown = true; renderRack(); }
      toast('On the iPad: ' + (it.title || SC_LABEL[it.kind]) + '.');
    }, function (e) { toast('Could not send to the iPad: ' + errText(e), true); });
  }
  function screenWire(it) {
    var me = S;
    (AM.loaded ? Promise.resolve() : loadAmbient()).then(function () {
      var list = wireList().filter(function (x) { return x.id !== it.id; }).map(function (x) { return { id: x.id, text: x.text }; }).concat([{ id: it.id, text: it.text }]).slice(-6);
      return patchAmbient({ wire: list });
    }).then(function (r) {
      if (r && S === me) { it.shown = true; toast('On the iPad wire.'); }
      if (S === me) renderRack();
    });
  }
  function wireClear(id) {
    var me = S, list = wireList().filter(function (x) { return x.id !== id; }).map(function (x) { return { id: x.id, text: x.text }; });
    patchAmbient({ wire: list.length ? list : null }).then(function (r) {
      var it = screenItem(id); if (r && it) it.shown = false;
      if (S === me) renderRack();
    });
  }
  function screenAdd(id) {
    var me = S, it = screenItem(id), g = gmApi();
    if (!it || it.kind !== 'portrait' || it.added) return;
    if (!g || typeof g.assistPortraitAdd !== 'function') { toast('Saving an NPC needs the hosted app.', true); return; }
    var name = str(it.name).trim() || 'Unnamed NPC';
    Promise.resolve().then(function () { return g.assistPortraitAdd({ name: name, description: str(it.description), spec: it.spec }); }).then(function (r) {
      if (S === me) { it.added = r && r.id || true; renderRack(); }
      toast('Saved ' + name + ' as a hidden NPC.');
    }, function (e) { toast('Could not save the NPC: ' + errText(e), true); });
  }

  function replayConsole(e) {
    var cp = part('console');
    if (!S.con || !cp || !isObj(e)) return null;
    return replayConsoleEntry(W.B68GmConsole, cp.T, part('campaign') || {}, e, S.doc.con || {});
  }
  function replaySituation(e) {
    var cp = part('console');
    if (!hasSit() || !cp || !isObj(e)) return null;
    return replaySituationEntry(W.B68GmConsole, cp.T, part('campaign') || {}, e, S.doc.con || {});
  }
  /* which stored card the console shows: the newer of the situation card and a single table (cards.console, which also holds
     rolls from before the Situations) */
  function pickShown() {
    var c = isObj(S.doc.cards) ? S.doc.cards : {};
    if (c.situation && (!c.console || str(c.situation.at) >= str(c.console.at))) return 'situation';
    return c.console ? 'console' : 'situation';
  }
  function drawConsoleCard(res) {
    var box = $q('#gm-card'); if (!box) return;
    var cards = isObj(S.doc.cards) ? S.doc.cards : {};
    if (!res) {
      var kind = pickShown(), cur = cards[kind];
      res = cur ? (kind === 'situation' ? replaySituation(cur) : replayConsole(cur)) : null; S.conRes = res; S.shown = kind;
      if (res && !S.last) S.last = { text: lastText(res) };
    }
    box.innerHTML = res ? (res.sections ? situationCardHtml(res, md) : classicCardHtml(res, md)) : S.con ? '<p class="gm-empty">Press a button, or a number key <kbd>1</kbd>–<kbd>4</kbd>.</p>' : '';
    var er = $q('#gm-earlier'); if (!er) return;
    var h = isObj(S.doc.hist) ? S.doc.hist : {}, list = [];
    ['situation', 'console'].forEach(function (t) { newest(h[t]).forEach(function (x) { x._tool = t; list.push(x); }); });
    list.sort(function (a, b) { return str(a.at) < str(b.at) ? 1 : str(a.at) > str(b.at) ? -1 : 0; });
    list = list.slice(0, LIMITS.hist);
    er.innerHTML = list.length ? '<span class="gm-lab">Earlier:</span>' + list.map(function (x) { return earlierChip(x, x._tool, cards[x._tool] && cards[x._tool].hid === x._id && S.shown === x._tool); }).join('') : '';
  }
  /* an Earlier chip names what the card is; under it, small, the time it was rolled and its position (also the title, for a label
     the chip has to cut) */
  function earlierChip(x, tool, current) {
    var when = [hm(x.at), isObj(x.ui) ? str(x.ui.pos) : ''].filter(Boolean).join(' · '), label = str(x.label || x.id);
    return '<button type="button" class="chip txt sm gm-ech" data-gm="replay" data-tool="' + esc(tool) + '" data-h="' + esc(x._id) + '"' + (current ? ' aria-current="true"' : '') + ' title="' + esc(label + (when ? ' (' + when + ')' : '')) + '">' +
      '<span class="gm-ech-t">' + esc(label) + '</span>' + (when ? '<small class="gm-ech-s">' + esc(when) + '</small>' : '') + '</button>';
  }
  function doIntent(i) {
    var res = S.conRes, a = res && res.meta && res.meta.actions && res.meta.actions[i], C = W.B68GmConsole; if (!a || !C) return;
    var it = a.intent, p; try { p = C.intentPatch(it, { date: dmy(new Date()) }); } catch (e) { toast(errText(e), true); return; }
    patch({ con: p });
    var filed = !(it.capture && it.capture.text) || addCapture(it.capture.bucket || 'x', it.capture.text, true);   /* a refused line, or lines dropped to make room, say so: that toast is not covered by this one */
    try { S.con.setCampaign(part('campaign') || {}, S.doc.con || {}); } catch (e) {}
    if (filed === true) toast(a.label.replace(/:.*$/, '') + '.');
    renderControls(); renderPos(); renderRail();
  }

  /* ---------- the location generator ---------- */
  function locUi() { var u = Object.assign(W.B68GmLocation ? W.B68GmLocation.defaults() : {}, uiOf('loc')); u.district = distFor('loc'); return u; }
  function mapUi() { var l = isObj(S.doc.loc) && isObj(S.doc.loc.map) ? S.doc.loc.map : {}; var m = Object.assign(clone(P.MAP0), l); m.reveal = Object.assign({}, P.MAP0.reveal, isObj(l.reveal) ? l.reveal : {}); m.open = openNow(); return m; }
  /* the rooms the GM opened on their own for this card: the run's ball.open (M4 step 5). Only an authored site with a play block has a
     ball (runSite), and the ball is scoped to the site, so another site's rooms are never this one's. [] without one. */
  function openNow() { var rs = runSite(); return rs ? cleanRooms(ballDoc(rs.name).open) : []; }
  function replayLocation(e) {
    var L = W.B68GmLocation, pk = part('location'); if (!L || !pk || !isObj(e)) return null;
    if (e.auth) return authoredRoll(L, pk, authoredOf(pk).sites[str(e.auth)]);
    var mem = {}; try { mem = JSON.parse(e.mem || '{}'); } catch (x) {}
    try { return L.generate(pk, e.ui || {}, { seed: e.seed, mem: mem }); } catch (x) { return null; }
  }
  function rollLocation() {
    var L = W.B68GmLocation, pk = part('location'); if (!L || !pk) return;
    var opts = locUi(), before = JSON.stringify(S.locMem), roll;
    try { roll = L.generate(pk, opts, { mem: S.locMem }); } catch (e) { toast('The location roll failed: ' + errText(e), true); return; }
    var entry = { seed: roll.seed, ui: opts, mem: before, label: str(roll.name) + (roll.district ? ' · ' + roll.district : ''), at: nowIso() };
    var hid = uid('h'), hist = isObj(S.doc.hist) && isObj(S.doc.hist.location) ? S.doc.hist.location : {};
    /* a new site starts from the public band only, on the GM layer, as rings: the map draws at once (Draw stays for another
       view, theme or layer; the theme is kept) */
    /* replaces the stored card: an authored card's `auth` must not survive a roll */
    patch({ cards: { location: replacePatch(isObj(S.doc.cards) ? S.doc.cards.location : null, Object.assign({ hid: hid }, entry)) }, mem: { location: clone(S.locMem) }, hist: { location: addCapped(hist, hid, entry, LIMITS.hist) }, loc: { map: { reveal: clone(P.REVEAL0), view: P.MAP0.view, layer: 'gm' } } }, { force: true });
    S.locRoll = roll; S.map = null; S.last = { text: 'Location: ' + entry.label };
    renderLocation(true);
    if (W.B68Map && W.B68Map.render) drawMap(true);
  }
  function renderLocation(fresh) {
    var box = $q('#gm-loc'), L = W.B68GmLocation, pk = part('location'); if (!box) return;
    if (S.locErr || !L || !pk) { box.innerHTML = '<p class="gm-note bad">' + esc(S.locErr || 'The location generator is not available.') + '</p>'; return; }
    var cur = isObj(S.doc.cards) ? S.doc.cards.location : null;
    if (!fresh && cur && (!S.locRoll || rollKey(S.locRoll) !== locKey(cur))) { S.locRoll = replayLocation(cur); S.map = null; resetReveal(); }
    var c = L.controls(pk), ui = locUi(), mu = mapUi(), roll = S.locRoll;
    var h = '<div class="gm-loc-ctl">' + c.controls.map(function (x) {
      var id = 'gm-l-' + esc(x.key);
      if (x.kind === 'toggle') return '<label class="gm-check" for="' + id + '"><input type="checkbox" id="' + id + '" data-loc="' + esc(x.key) + '"' + (ui[x.key] ? ' checked' : '') + '> <span>' + esc(x.label) + '</span></label>';
      return '<label class="gm-field" for="' + id + '"><span class="gm-lab">' + esc(x.label) + '</span><select id="' + id + '" data-loc="' + esc(x.key) + '">' + (x.key === 'district' ? distOptionsHtml('loc') : (x.options || []).map(function (o) { return '<option value="' + esc(o.value) + '"' + (str(o.value) === str(ui[x.key]) ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('')) + '</select></label>';
    }).join('') + '<button type="button" class="btn primary gm-roll" data-gm="locroll">Roll a location</button></div>';
    if (roll) {
      h += '<article class="gm-card gm-loccard" data-tool="location">' + glanceHtml(L, roll, pk, revealList(mu)) + foldsHtml(L, roll, pk, revealList(mu)) +
        '<div class="gm-card-acts"><button type="button" class="btn sm" data-gm="pin" data-tool="location" title="Pins the glance card">Pin</button>' + '<button type="button" class="btn sm" data-gm="copy" data-tool="location" title="Copies the whole card">Copy</button></div></article>';
      h += siteRowHtml(cur);
      /* the iPad controls (Layer, Reveal, the warning, Show on iPad, Set as score scene) stay visible together: never in a fold;
         View and Theme (presentation) fold under the map */
      h += '<section class="gm-mapbox" aria-label="Map"><h4>Map</h4><div class="gm-map-ctl">' +
        '<div class="gm-field"><span class="gm-lab">Layer</span><div class="seg" role="group" aria-label="Layer">' + [['gm', 'GM'], ['player', 'Player']].map(function (o) { return '<button type="button" class="chip" data-gm="layer" data-v="' + o[0] + '" aria-pressed="' + (mu.layer === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div></div>' +
        '<fieldset class="gm-reveal"><legend class="gm-lab">Reveal to the players: ' + esc(revealText(mu)) + liveChip(mu) + '</legend>' + BANDS.map(function (b) { return '<label class="gm-check"><input type="checkbox" data-reveal="' + b + '"' + (b === 'public' || mu.reveal[b] ? ' checked' : '') + (b === 'public' ? ' disabled' : '') + '> <span>' + b + '</span></label>'; }).join('') + roomsHtml(mu, roll) + '</fieldset>' +
        '<button type="button" class="btn primary" data-gm="draw">Draw</button></div>' +
        '<p class="gm-warn" id="gm-mapwarn" role="status"></p>' +
        '<div class="gm-map-acts"><button type="button" class="btn sm primary" data-gm="ipad"' + (mu.layer === 'player' ? '' : ' disabled title="Switch Layer to Player: only the player layer goes to the iPad"') + '>Show on iPad</button>' +
        '<button type="button" class="btn sm" data-gm="scorescene"' + (mu.layer === 'player' ? '' : ' disabled title="Switch Layer to Player: only the player layer goes to the iPad"') + (mu.layer === 'player' ? ' title="The planning board and the exploded site on the iPad, from this roll at these bands"' : '') + '>Set as score scene</button>' +
        '<button type="button" class="btn sm" data-gm="blankipad" title="Back to the ambient scene (0)">Clear → ambient</button></div>' +
        (sceneBehind(mu) ? '<p class="gm-dim gm-scene-behind">The score scene shows ' + esc(sceneBehind(mu).join(', ')) + ': press Set as score scene to bring it up to date.</p>' : '') +
        runBox(runSite()) +
        '<details class="gm-more gm-mapopts"' + (foldOpen('mapopts') ? ' open' : '') + ' data-fold="mapopts"><summary>View &amp; theme <span class="gm-dim">' + esc(mapLine(mu)) + '</span></summary>' + '<div class="gm-map-ctl">' + sel('view', 'View', VIEWS, mu.view) + sel('theme', 'Theme', THEMES, mu.theme) + sel('time', 'Time', P.TIMES, mu.time) + sel('weather', 'Weather', P.WEATHERS, mu.weather) + '</div></details>' +
        '<details class="gm-more gm-dl"' + (foldOpen('dl') ? ' open' : '') + ' data-fold="dl"><summary>Downloads</summary><div class="gm-map-acts">' + '<button type="button" class="btn sm" data-gm="dlsvg">Download SVG</button><button type="button" class="btn sm" data-gm="dlnote">Download note (.md)</button>' + '<button type="button" class="btn sm" data-gm="dlcanvas">Download canvas</button></div></details>' + '</section>';
    } else h += '<p class="gm-empty">Choose what you know (or leave it on any) and roll. The card marks what the players can see.</p>' + '<p><button type="button" class="btn sm" data-gm="blankipad" title="Back to the ambient scene (0)">Clear → ambient</button></p>';
    var hist = newest(isObj(S.doc.hist) ? S.doc.hist.location : null).slice(0, LIMITS.hist);
    if (hist.length) h += '<div class="gm-earlier"><span class="gm-lab">Earlier:</span>' + hist.map(function (x) { return earlierChip(x, 'location', cur && cur.hid === x._id); }).join('') + '</div>';
    box.innerHTML = h;
    runPaint();
    if (!S.map && runSite() && W.B68Map && W.B68Map.render) drawMap(true);     /* a run draws itself: its people are on the map */
    else if (S.map) showMap();
  }
  /* the glance card: place, whose, the bands, the target, the one line to say aloud. The whole page is GM-only, so nothing says
     so; a mustard "Players see" chip marks what the players can see: a revealed band, and the Say box once the street description
     has gone to the iPad (S.locSent, this roll's seed). The street button sends playerSummary (never this card) through pushText */
  var SEEN = '<span class="gm-seen">Players see</span>';
  function glanceHtml(L, roll, pk, reveal) {
    var g; try { g = L.glance(roll, pk, reveal); } catch (e) { return '<p class="gm-note bad">The card could not be drawn: ' + esc(errText(e)) + '</p>'; }
    var bands = g.bands.map(function (b) {
      return '<li class="gm-gband' + (b.shown ? ' shown' : '') + '"><b>' + esc(b.short) + '</b> ' + b.count + (b.locks ? ' <small>' + b.locks + (b.locks === 1 ? ' lock' : ' locks') + '</small>' : '') + (b.target ? ' <span class="gm-star" aria-label="target">★</span>' : '') + (b.shown ? ' ' + SEEN : '') + '</li>';
    }).join('');
    return '<section class="gm-glance gm-secret" data-sec="glance"><div class="gm-glance-h"><h3 class="gm-locname">' + esc(g.title) + '</h3></div>' +
      '<p class="gm-glance-place">' + esc(g.place) + '</p>' +
      '<div class="gm-say"><span class="gm-lab">Say' + (S.locSent === rollKey(roll) ? ' ' + SEEN : '') + '</span><p>“' + esc(g.say) + '”</p><button type="button" class="btn sm" data-gm="pushtext">Street description on iPad</button></div>' +
      /* the plan names the target room and its locks: GM only. It sits outside the Say box on purpose (that box is what the players
         see once the street description is sent), and no push (pushText, the score scene, Show on iPad) ever reads it */
      (g.plan ? '<p class="gm-plan"><span class="gm-lab">Plan</span> ' + esc(g.plan) + '</p>' : '') +
      '<dl class="gm-grid gm-glance-dl"><dt>Whose</dt><dd>' + esc(g.whose) + ' · Security <b>' + esc(g.security) + '</b></dd>' +
      '<dt>Bands</dt><dd><ol class="gm-gbands">' + bands + '</ol></dd>' +
      '<dt>Target</dt><dd>★ <b>' + esc(g.target.room) + '</b> (' + esc(String(g.target.band).toLowerCase()) + ') — ' + esc(g.target.what) + '</dd>' +
      (g.rule ? '<dt>Rule</dt><dd>' + esc(g.rule) + '</dd>' : '') +
      (g.flags.length ? '<dt>Flags</dt><dd>' + g.flags.map(function (f) { return '<span class="gm-flag">! ' + esc(f) + '</span>'; }).join(' ') + '</dd>' : '') + '</dl></section>';
  }
  function foldsHtml(L, roll, pk, reveal) {
    var F = []; try { F = L.folds(roll, pk, reveal); } catch (e) { F = []; }
    return F.map(function (f) {
      var seen = /^band-/.test(str(f.id)) && reveal.indexOf(str(f.id).slice(5)) >= 0;
      return '<details class="gm-lfold' + (f.gm ? ' gm-secret' : '') + '" data-fold="' + esc(f.id) + '"' + (foldOpen(f.id) ? ' open' : '') + '><summary><span class="gm-lfold-t">' + esc(f.title) + '</span>' + (f.hint ? '<span class="gm-lfold-h">' + esc(f.hint) + '</span>' : '') + (seen ? SEEN : '') + '</summary><div class="gm-lfold-b">' + md((f.lines || []).join('\n')) + '</div></details>';
    }).join('');
  }
  /* which location folds are open: this device only (localStorage), fold ids only, never table text */
  var FOLD_KEY = 'b68.gm.locfold';
  function foldState() { try { var a = JSON.parse(W.localStorage.getItem(FOLD_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function foldOpen(id) { return foldState().indexOf(id) >= 0; }
  function onToggle(ev) {
    var d = ev.target; if (!d || !d.getAttribute) return;
    if (d.hasAttribute('data-sttfold')) { STT.fold = !!d.open; return; }   /* "Who is who": kept open or shut across the 5 s refresh */
    if (!d.hasAttribute('data-fold')) return;
    var id = d.getAttribute('data-fold'), a = foldState().filter(function (x) { return x !== id && /^[a-z-]{1,24}$/.test(x); });
    if (d.open) a.push(id);
    try { W.localStorage.setItem(FOLD_KEY, JSON.stringify(a.slice(-20))); } catch (e) {}
  }
  function sel(key, label, list, v) { return '<label class="gm-field" for="gm-m-' + key + '"><span class="gm-lab">' + label + '</span><select id="gm-m-' + key + '" data-map="' + key + '">' + list.map(function (o) { var val = Array.isArray(o) ? o[0] : o, txt = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(val) + '"' + (val === str(v) ? ' selected' : '') + '>' + esc(txt) + '</option>'; }).join('') + '</select></label>'; }
  /* the fold's summary: view · theme, and the time and weather when they are set */
  function mapLine(mu) { var a = [mu.view, mu.theme], tl = P.TIMES.filter(function (x) { return x[0] && x[0] === mu.time; })[0], wl = P.WEATHERS.filter(function (x) { return x[0] && x[0] === mu.weather; })[0]; if (tl) a.push(tl[1].toLowerCase()); if (wl) a.push(wl[0] === 'rolled' ? "the roll's weather" : wl[0] === 'none' ? 'no weather' : wl[1].toLowerCase()); return a.join(' · '); }
  function drawMap(quiet) {
    var K = W.B68Map; if (!S.locRoll) { if (!quiet) toast('Roll a location first.', true); return; }
    if (!K || !K.render) { if (!quiet) toast('The map kit is missing.', true); return; }
    var mu = mapUi(), r, o = mapOpts(mu, mu.layer === 'player' ? 'player' : 'gm', revealEntries(mu)), sig = runApply(o);     /* a run: the GM layer only, with its tokens */
    /* the player layer's preview shows the markers the iPad copy would carry (the same builder and gate; never the GM cache above) */
    var held = false;
    if (mu.layer === 'player') {
      var pts = playerTokenSet(revealEntries(mu));
      if (pts.tokens.length) { var scr = P.tokenScreen(pts.tokens, S.locRoll, revealEntries(mu), pts.hide); held = scr.refused.length > 0; if (scr.tokens.length) o.tokens = scr.tokens; }
    }
    if (sig && S.map && S.map.sig === sig) return;                  /* nobody moved: the map on screen is this one */
    if (sig && S.runCache && S.runCache.map[sig]) r = S.runCache.map[sig];
    else {
      try { r = K.render(S.locRoll, o); } catch (e) { if (!quiet) toast('The map could not be drawn: ' + errText(e), true); return; }
      if (sig) { var rc = S.runCache = S.runCache || { map: {}, keys: [] }; rc.map[sig] = r; rc.keys.push(sig); while (rc.keys.length > RUN_CACHE_MAX) delete rc.map[rc.keys.shift()]; }
    }
    S.map = { svg: r.svg, warnings: r.warnings || [], layer: mu.layer === 'player' ? 'player' : 'gm', view: mu.view, theme: mu.theme, time: mu.time, weather: mu.weather, sig: sig, held: held };
    S.map.leak = S.map.layer === 'player' && leaks(r.svg, S.locRoll, revealEntries(mu)).length > 0;
    showMap();
  }
  function showMap() {
    var box = $q('#gm-map'), w = $q('#gm-mapwarn'); if (!box || !S.map) return;
    box.innerHTML = stripSize(S.map.svg);     /* the map kit's own output from our roll; it escapes its text */
    box.setAttribute('data-layer', S.map.layer);
    box.classList.toggle('gm-leak', !!S.map.leak);
    if (w) w.classList.toggle('bad', !!S.map.leak);
    if (w) w.textContent = (S.map.leak ? 'Not for the iPad: ' + P.LEAK_MSG + ' ' : '') + (S.map.held ? P.TOKEN_LEAK_MSG + ' ' : '') + (S.map.layer === 'gm' ? 'GM layer: everything shows. ' : 'Player layer. ') + (S.map.warnings.length ? S.map.warnings.length + ' map note' + (S.map.warnings.length === 1 ? '' : 's') + ': ' + S.map.warnings.slice(0, 2).map(function (x) { return typeof x === 'string' ? x : x && (x.message || x.msg || JSON.stringify(x)); }).join(' · ') + (S.map.warnings.length > 2 ? ' …' : '') : '');
  }
  /* a change to the map controls redraws a map already on screen, so what shows always matches the controls */
  function setMap(k, v) {
    var p = { loc: { map: {} } }; p.loc.map[k] = v; patch(p); if (S.map) drawMap();
    var sum = $q('.gm-mapopts summary .gm-dim'); if (sum) sum.textContent = mapLine(mapUi());     /* the fold's line, without redrawing the panel */
  }
  /* ---------- Run the site (GM.md, "Authored sites"; design 4.6) ----------
     An authored card whose site has a `play` block gets a strip above the map: floor tabs, the evening's clock, the disguise,
     the crew and the table clocks. Everything lives in the GM state's `ball` (scoped to the site by `ball.site`; written with a
     replace patch, so a removed crew or pin goes), and the map's tokens (ONE per room, so none hides another) are drawn on the GM
     layer only: playerDisplay, Show on iPad, live reveal and the score scene never pass through here. The clock `t` is whatever the
     GM set (minutes from play.clock.start); the wall clock is never read. */

  var RUN_CACHE_MAX = 24;
  /* the authored site on the card, with a usable play block: { name, play, B }, else null (a rolled site never has one) */
  function runSite() {
    var B = W.B68GmBall, cur = S && isObj(S.doc.cards) ? S.doc.cards.location : null;
    if (!B || !S.locRoll || !isObj(cur) || !cur.auth || rollKey(S.locRoll) !== locKey(cur)) return null;
    var site = authoredOf(part('location')).sites[str(cur.auth)];
    if (!isObj(site) || !isObj(site.play) || !isObj(site.play.clock)) return null;
    return { name: str(cur.auth), play: site.play, B: B };
  }
  function ballDoc(name) { return isObj(S.doc.ball) && S.doc.ball.site === name ? S.doc.ball : {}; }
  /* write the changes to `ball` as a replace patch (a key set to null goes). Another site's state is replaced whole */
  function ballSet(name, change, quiet) {
    var old = isObj(S.doc.ball) ? S.doc.ball : null, base = old && old.site === name ? clone(old) : {};
    base.site = name;
    Object.keys(change).forEach(function (k) { if (change[k] === null || change[k] === undefined) delete base[k]; else base[k] = change[k]; });
    var ok = patch({ ball: replacePatch(old, base) });
    if (ok && !quiet) liveTokens();         /* a marker or a pin moved, or a room opened or closed: while the map is live on the iPad, it follows (M3, M4 step 5) */
    return ok;
  }
  /* the levels of the roll, by number, with the names the play gives them; and room name -> level */
  function runFloors(rs) {
    var key = rollKey(S.locRoll) + '|' + rs.name;
    if (S.runFl && S.runFl.key === key) return S.runFl;
    var out = { key: key, list: [], floorOf: {} }, K = W.B68Map, names = isObj(rs.play.floors) ? rs.play.floors : {};
    try {
      (K && K.floors ? K.floors(S.locRoll) : []).forEach(function (f) {
        var lvl = Number(f.lvl); if (isNaN(lvl)) return;
        out.list.push({ lvl: lvl, name: str(names[String(lvl)]) || str(f.title) || 'Floor ' + lvl });
        (f.rooms || []).forEach(function (r) { out.floorOf[str(r.name)] = lvl; });
      });
    } catch (e) { out = { key: key, list: [], floorOf: {} }; }
    out.list.sort(function (a, b) { return a.lvl - b.lvl; });
    S.runFl = out; return out;
  }
  function runSpan(rs) { var n = rs.B.minuteOf(rs.play.clock.end, rs.play.clock.start); return n > 0 ? n : 1440; }
  /* everything the strip and the map need at the time on screen (S.runT while the slider is being dragged, else the state's t) */
  function runModel(rs) {
    var st = ballDoc(rs.name), span = runSpan(rs), fl = runFloors(rs);
    var t = S.runT != null ? S.runT : +st.t; if (!isFinite(t)) t = 0; t = Math.max(0, Math.min(span, Math.round(t)));
    var floor = st.floor === 'all' || st.floor == null ? 'all' : Number(st.floor);
    if (floor !== 'all' && !fl.list.some(function (f) { return f.lvl === floor; })) floor = 'all';
    var view = rs.B.ballView(rs.play, Object.assign({}, st, { t: t }), fl.floorOf);
    return view ? { st: st, t: t, span: span, fl: fl, floor: floor, view: view } : null;
  }
  /* the windows: each target person's own stops, in minutes from the start */
  function runWindows(rs) {
    var out = [];
    (Array.isArray(rs.play.people) ? rs.play.people : []).forEach(function (p) {
      if (!isObj(p) || p.kind !== 'target') return;
      (Array.isArray(p.stops) ? p.stops : []).forEach(function (s) { var t = rs.B.minuteOf(s.at, rs.play.clock.start); if (!isNaN(t)) out.push({ t: t, at: str(s.at), room: str(s.room), who: str(p.label) }); });
    });
    return out.sort(function (a, b) { return a.t - b.t; });
  }
  /* one token per room that holds someone, a crew marker or a pinned clock, on the selected floor (crew ids the table no longer has are skipped) */
  function runTokens(m) {
    var out = [], pcs = {}, byId = {}, clocks = {};
    dtPcs().forEach(function (c) { pcs[str(c.id)] = pcName(c); });
    m.view.people.forEach(function (p) { byId[p.id] = p; });
    tableClocks().forEach(function (c) { if (str(c.id)) clocks[str(c.id)] = c; });
    Object.keys(m.view.rooms).sort().forEach(function (name) {
      var r = m.view.rooms[name];
      if (r.lvl === null || (m.floor !== 'all' && r.lvl !== m.floor)) return;
      var pills = [];
      r.crew.forEach(function (id) { if (pcs[id]) pills.push({ t: runInitials(pcs[id]), c: '#111111' }); });
      r.people.forEach(function (id) { var p = byId[id]; if (p) pills.push({ t: runInitials(p.label), c: RUN_KIND[p.kind] || '#5d5d5d' }); });
      var pies = r.pinned.map(function (id) { return clocks[id]; }).filter(Boolean).map(function (c) { return { f: +c.filled || 0, s: +c.size || 0 }; });
      if (!pills.length && !pies.length) return;
      if (pills.length > 4) pills = pills.slice(0, 3).concat([{ t: '+' + (pills.length - 3), c: '#333333' }]);
      out.push({ room: name, label: '', svg: runTokenSvg({ pills: pills, pies: pies, lens: r.lens ? r.lens.pos : null, danger: !!(r.lens && r.lens.danger) }) });
    });
    return out;
  }
  /* the GM layer's map options for a run: tokens, and the floor (rings draws every floor, the street none) -> a key that names this
     drawing, or '' when this map is not a run (a player layer, a rolled site) */
  function runApply(o) {
    var rs = o.layer === 'gm' ? runSite() : null; if (!rs) return '';
    var m = runModel(rs); if (!m) return '';
    var toks = runTokens(m);
    o.tokens = toks;
    if (m.floor !== 'all' && (o.view === 'iso' || o.view === 'plan' || o.view === 'section')) o.floor = m.floor;
    return JSON.stringify([rollKey(S.locRoll), o.view, o.theme, o.time, o.weather, o.floor, toks.map(function (t) { return t.room + '|' + t.svg; })]);
  }
  /* Names the markers on a player copy must never carry: the play's people and disguises (whole labels) and the names of hidden clocks.
     This is the ONLY use of `play.people` on the player path: it feeds tokenScreen's deny list and nothing is drawn from it. */
  function tokenDeny(play) {
    var out = [];
    (Array.isArray(play && play.people) ? play.people : []).forEach(function (p) { if (isObj(p) && str(p.label).trim()) out.push(str(p.label)); });
    (Array.isArray(play && play.disguises) ? play.disguises : []).forEach(function (d) { if (isObj(d) && str(d.label).trim()) out.push(str(d.label)); });
    tableClocks().forEach(function (c) { if (c.hidden && str(c.name).trim()) out.push(str(c.name)); });
    return out;
  }
  /* The player copy's markers for the card on screen, at these revealed bands (M3): { tokens, hide, sig }, empty when the card is not a
     run, or when the ball (read through ballDoc: another site's crew is never this one's) places nothing. Only { crew, pins } are
     picked from the ball. `sig` names the request (before the screen) so live reveal compares one thing. Never touches the GM layer's
     drawn-map cache (S.runCache). */
  function playerTokenSet(reveal) {
    var none = { tokens: [], hide: [], sig: '' }, rs = runSite(); if (!rs || !S.locRoll) return none;
    var st = ballDoc(rs.name), placed = { crew: isObj(st.crew) ? st.crew : {}, pins: isObj(st.pins) ? st.pins : {} };
    if (!Object.keys(placed.crew).length && !Object.keys(placed.pins).length) return none;
    var shown = (Array.isArray(S.locRoll.rooms) ? S.locRoll.rooms : []).filter(function (r) { return roomShown(r, reveal); }).map(function (r) { return str(r.name); });
    var pcs = dtPcs().map(function (c) { return { id: str(c.id), name: pcName(c) }; });
    var clocks = tableClocks().filter(function (c) { return str(c.id); }).map(function (c) { return { id: str(c.id), size: c.size, filled: c.filled, hidden: !!c.hidden }; });
    var tokens = P.playerTokens(placed, shown, clocks, pcs), hide = tokenDeny(rs.play);
    return { tokens: tokens, hide: hide, sig: P.tokenSig(tokens, hide) };
  }

  /* ---- the strip ---- */
  function runChip(label, attrs, on, cls) { return '<button type="button" class="chip sm' + (cls ? ' ' + cls : '') + '"' + attrs + (on === undefined ? '' : ' aria-pressed="' + (!!on) + '"') + '>' + label + '</button>'; }
  function runTimeHtml(rs, m) {
    var B = rs.B, start = rs.play.clock.start, pct = function (x) { return (Math.max(0, Math.min(m.span, x)) / m.span * 100).toFixed(2); }, ticks = '';
    (Array.isArray(rs.play.events) ? rs.play.events : []).forEach(function (e) { var t = B.minuteOf(e.at, start); if (!isNaN(t) && t <= m.span) ticks += '<i class="gm-run-tick' + (e.fx ? ' fx' : '') + '" style="left:' + pct(t) + '%" title="' + esc(str(e.at) + ' ' + str(e.label)) + '"></i>'; });
    runWindows(rs).forEach(function (w) { if (w.t <= m.span) ticks += '<i class="gm-run-dot" style="left:' + pct(w.t) + '%" title="' + esc(w.at + ' ' + w.who + ' in ' + w.room) + '"></i>'; });
    return '<div class="gm-run-time"><output class="gm-run-clock" id="gm-run-clock" aria-live="off">' + esc(m.view.label) + '</output>' +
      '<div class="gm-run-scrub"><div class="gm-run-btns">' + runChip('−15', ' data-gm="run-step" data-d="-15" aria-label="15 minutes earlier"') + runChip('+15', ' data-gm="run-step" data-d="15" aria-label="15 minutes later"') + runChip('Next window', ' data-gm="run-next"') + runChip('False dawn', ' data-gm="run-dawn" title="Whites out the iPad for 30 seconds; asks first"') + '</div>' +
      '<input type="range" id="gm-run-t" data-run="t" min="0" max="' + m.span + '" step="1" value="' + m.t + '" aria-label="Time of night, from ' + esc(start) + ' to ' + esc(rs.play.clock.end) + '">' +
      '<div class="gm-run-track" aria-hidden="true">' + ticks + '</div></div></div>';
  }
  function runBox(rs) {
    var plain = '<div class="gm-map" id="gm-map"></div>', m = rs ? runModel(rs) : null; if (!m) return plain;
    var label = str(rs.play.clock.label);
    return '<div class="gm-runzone" id="gm-runzone"><section class="gm-run" id="gm-run" tabindex="0" aria-label="Run the site' + (label ? ': ' + esc(label) : '') + '. Left and Right move the time by 5 minutes.">' +
      '<div class="gm-run-h"><b>Run the site</b>' + (label ? ' <span class="gm-dim">' + esc(label) + '</span>' : '') + ' <span class="gm-dim" id="gm-run-note"></span></div>' +
      '<div class="seg gm-run-tabs" id="gm-run-tabs" role="group" aria-label="Floor"></div>' + runTimeHtml(rs, m) + '<div class="gm-run-place" id="gm-run-place"></div></section>' +
      '<div class="gm-runbody">' + plain + '<aside class="gm-run-side" id="gm-run-side" aria-label="The site at this time"></aside></div><div class="gm-run-rooms" id="gm-run-rooms"></div></div>';
  }
  function runMarks(r) { return (r.people.length ? r.people.length + ' in' : '') + (r.crew.length ? (r.people.length ? ', ' : '') + r.crew.length + ' crew' : ''); }
  /* the parts that change with the time or a placement: redrawn in place (never the slider, which would drop the drag or the focus) */
  function runPaint() {
    /* the tabs, chips and select are replaced: the focus follows to the same control (else the strip), so Left and Right keep working */
    var a = document.activeElement, zone = $q('#gm-runzone'), sel = '';
    if (a && zone && zone !== a && zone.contains(a) && a.getAttribute) {
      if (a.id) sel = '#' + a.id;
      else if (a.getAttribute('data-gm')) { sel = '[data-gm="' + a.getAttribute('data-gm') + '"]'; ['data-v', 'data-id', 'data-room'].forEach(function (k) { if (a.hasAttribute(k)) sel += '[' + k + '="' + str(a.getAttribute(k)).replace(/"/g, '') + '"]'; }); }
    }
    runPaintParts();
    if (sel && zone && !zone.contains(document.activeElement)) { var n = null; try { n = zone.querySelector(sel); } catch (e) { n = null; } n = n || $q('#gm-run'); if (n && n.focus) { try { n.focus({ preventScroll: true }); } catch (e) { n.focus(); } } }
  }
  function runPaintParts() {
    var rs = runSite(), tabs = $q('#gm-run-tabs'); if (!rs || !tabs) return;
    var m = runModel(rs); if (!m) return;
    var v = m.view, st = m.st, arm = S.runArm, pcs = dtPcs(), clocks = tableClocks().filter(function (c) { return str(c.id); });
    tabs.innerHTML = runChip('All', ' data-gm="run-floor" data-v="all"', m.floor === 'all') + m.fl.list.map(function (f) { return runChip(esc(f.name), ' data-gm="run-floor" data-v="' + f.lvl + '"', m.floor === f.lvl); }).join('');
    var place = '', lensId = str(st.lens), disg = Array.isArray(rs.play.disguises) ? rs.play.disguises : [];
    if (disg.length) place += '<label class="gm-field" for="gm-run-lens"><span class="gm-lab">Disguise</span><select id="gm-run-lens" data-run="lens"><option value="">No disguise</option>' + disg.map(function (d) { return '<option value="' + esc(d.id) + '"' + (d.id === lensId ? ' selected' : '') + '>' + esc(d.label) + '</option>'; }).join('') + '</select></label>';
    var crew = isObj(st.crew) ? st.crew : {};
    place += '<div class="gm-run-row"><span class="gm-lab">Crew</span>' + (pcs.length ? pcs.map(function (c) { var id = str(c.id), at = str(crew[id]); return runChip(esc(pcName(c)) + (at ? ' <small>' + esc(at) + '</small>' : ''), ' data-gm="run-pc" data-id="' + esc(id) + '"', !!(arm && arm.kind === 'pc' && arm.id === id)); }).join('') : '<span class="gm-dim">No characters filed.</span>') + '</div>';
    var pins = isObj(st.pins) ? st.pins : {};
    if (clocks.length) place += '<div class="gm-run-row"><span class="gm-lab">Clocks</span>' + clocks.map(function (c) { var id = str(c.id), at = str(pins[id]); return runChip(esc(str(c.name) || 'Clock') + ' ' + (+c.filled || 0) + '/' + (+c.size || 0) + (at ? ' <small>' + esc(at) + '</small>' : ''), ' data-gm="run-clock" data-id="' + esc(id) + '" title="Pin to room"', !!(arm && arm.kind === 'clock' && arm.id === id)); }).join('') + '</div>';
    if (arm) place += '<p class="gm-run-arm" role="status">' + (arm.kind === 'pc' ? 'Tap a room to put that crew member there (the room they are in takes them off).' : 'Pin to room: tap a room (the room it is pinned to unpins it).') + ' <button type="button" class="chip sm" data-gm="run-disarm">Cancel</button></p>';
    var note = $q('#gm-run-note'); if (note) note.textContent = mapUi().layer === 'player' ? 'The players see the crew and any clock they can see, in rooms they can see. People show on the GM layer.' : '';
    $q('#gm-run-place').innerHTML = place;
    /* the rooms (this floor, or all): the lens colours them */
    var names = Object.keys(v.rooms).filter(function (n) { return v.rooms[n].lvl !== null && (m.floor === 'all' || v.rooms[n].lvl === m.floor); })
      .sort(function (a, b) { return v.rooms[a].lvl - v.rooms[b].lvl || (a < b ? -1 : 1); });
    $q('#gm-run-rooms').innerHTML = '<span class="gm-lab">Rooms</span>' + names.map(function (n) {
      var r = v.rooms[n], cls = 'gm-run-room' + (r.lens ? ' pos-' + r.lens.pos : '') + (r.lens && r.lens.danger ? ' danger' : '');
      return runChip(esc(n) + (runMarks(r) ? ' <small>' + esc(runMarks(r)) + '</small>' : '') + (r.lens ? ' <small>' + esc(RUN_LETTER[r.lens.pos]) + (r.lens.danger ? ' !' : '') + '</small>' : ''), ' data-gm="run-room" data-room="' + esc(n) + '"', undefined, cls);
    }).join('');
    /* beside the map: where everyone is, what is next, the routes */
    var side = '<h5>At ' + esc(v.label) + '</h5><ul class="gm-run-people">' + (v.people.length ? v.people.map(function (p) {
      return '<li><b>' + esc(p.label) + '</b> <small>' + esc(p.kind) + '</small> ' + (p.room ? esc(p.room) : '<span class="gm-dim">not here yet</span>') + (p.note ? ' · ' + esc(p.note) : '') + (p.moving ? ' <span class="gm-run-moving">→ ' + esc(p.moving.to) + ' in ' + p.moving.inMin + ' min</span>' : '') + '</li>';
    }).join('') : '<li class="gm-dim">Nobody on the list.</li>') + '</ul>';
    side += '<h5>Next</h5><p class="gm-chips">' + (v.next.length ? v.next.map(function (n) { var txt = esc(n.at) + ' ' + esc(n.label) + (n.room ? ' · ' + esc(n.room) : ''); return n.fx === 'dawn' ? runChip(txt + ' · False dawn', ' data-gm="run-dawn" title="Whites out the iPad for 30 seconds; asks first"') : '<span class="chip sm">' + txt + '</span>'; }).join('') : '<span class="gm-dim">Nothing more tonight.</span>') + '</p>';
    var MARK = { both: '↕', up: '↑', down: '↓' };
    side += '<h5>Routes</h5><p class="gm-chips">' + (v.routes.length ? v.routes.map(function (r) {
      return '<span class="chip sm" title="' + esc(str(r.via)) + '">' + esc(r.from) + ' ' + (MARK[r.dir] || '↕') + ' ' + esc(r.to) + (r.watched ? ' 👁' : '') + (r.needs ? ' 🔑 ' + esc(typeof r.needs === 'string' ? r.needs : '') : '') + '</span>';
    }).join('') : '<span class="gm-dim">No routes.</span>') + '</p>';
    $q('#gm-run-side').innerHTML = side;
  }
  /* the table or the filed characters changed (a clock ticked, a PC arrived): the strip and the pies follow; a poll never closes the Disguise select */
  function runStale() {
    if (!S || !runSite()) return;
    var a = document.activeElement; if (!(a && a.id === 'gm-run-lens')) runPaint();
    runDraw(true);
    liveTokens();         /* a clock ticked or went hidden, a PC was renamed: the markers on the iPad follow (M3) */
  }
  function runClock() {
    var rs = runSite(); if (!rs) return;
    var m = runModel(rs); if (!m) return;
    var c = $q('#gm-run-clock'), s = $q('#gm-run-t');
    if (c) c.textContent = m.view.label;
    if (s && +s.value !== m.t) s.value = m.t;
  }
  /* the map again, with the tokens as they are now (debounced for the slider: a render is 10 to 25 ms, and only the tokens change) */
  function runDraw(soon) {
    clearTimeout(S.runDt);
    if (!soon) { if (S.locRoll && W.B68Map && W.B68Map.render) drawMap(true); return; }
    var me = S; S.runDt = setTimeout(function () { if (S === me && S.locRoll && W.B68Map && W.B68Map.render) drawMap(true); }, 200);
  }
  function runCommit() {
    clearTimeout(S.runTm);
    var rs = runSite(); if (!rs || S.runT == null) { S.runT = null; return; }
    var t = S.runT; S.runT = null; ballSet(rs.name, { t: t }); runDraw(); runPaint();
  }
  /* the slider while it moves: the clock and the side at once, the state and the map after 200 ms of quiet (or on release) */
  function runScrub(v) {
    var rs = runSite(); if (!rs) return;
    S.runT = Math.max(0, Math.min(runSpan(rs), Math.round(+v) || 0));
    runClock(); runPaint(); clearTimeout(S.runTm);
    var me = S; S.runTm = setTimeout(function () { if (S === me) runCommit(); }, 200);
  }
  function runGo(t) {
    var rs = runSite(); if (!rs) return false;
    var m = runModel(rs); if (!m) return false;
    clearTimeout(S.runTm); S.runT = null;
    ballSet(rs.name, { t: Math.max(0, Math.min(m.span, Math.round(t))) });
    runClock(); runPaint(); runDraw(true); return true;
  }
  /* The false dawn (design 4.9): never by itself, only this tap, and only after a yes. It records ball.dawn once the iPad took it. */
  function runDawn() {
    var rs = runSite(); if (!rs) return Promise.resolve(null);
    if (!W.confirm('The iPad goes white for 30 seconds. Go ahead?')) return Promise.resolve(null);
    apEvent({ type: 'dawn', ms: 30000 });       /* the dawn is the GM's own and takes the slot: the autopilot lays nothing over it and clears nothing of it */
    return showOverlay({ kind: 'fx', fx: 'dawn', ms: 30000 }).then(function (r) {
      if (r && runSite()) ballSet(rs.name, { dawn: { at: new Date().toISOString() } });
      return r;
    });
  }
  function runStep(d) { var rs = runSite(), m = rs && runModel(rs); return m ? runGo(m.t + d) : false; }
  function runNext() {
    var rs = runSite(), m = rs && runModel(rs); if (!m) return;
    var w = runWindows(rs).filter(function (x) { return x.t > m.t && x.t <= m.span; })[0];
    if (!w) { toast('No more windows tonight.'); return; }
    runGo(w.t);
  }
  function runSetFloor(v) {
    var rs = runSite(); if (!rs) return;
    ballSet(rs.name, { floor: v === 'all' ? 'all' : Number(v) });
    runPaint(); runDraw();
  }
  function runSetLens(v) {
    var rs = runSite(); if (!rs) return;
    ballSet(rs.name, { lens: v || null });
    runPaint(); runDraw();
  }
  /* tap a crew member or a table clock, then a room: placed there, or taken off when it is already there */
  function runArm(kind, id) {
    if (S.runArm && S.runArm.kind === kind && S.runArm.id === id) S.runArm = null; else S.runArm = { kind: kind, id: id };
    runPaint();
  }
  function runRoom(room) {
    var rs = runSite(), a = S.runArm; if (!rs || !a) return;
    var st = ballDoc(rs.name), key = a.kind === 'pc' ? 'crew' : 'pins', cur = clone(isObj(st[key]) ? st[key] : {}), ch = {};
    if (cur[a.id] === room) delete cur[a.id]; else cur[a.id] = room;
    ch[key] = Object.keys(cur).length ? cur : null;
    ballSet(rs.name, ch);
    S.runArm = null; runPaint(); runDraw();
  }
  /* Left and Right move the time 5 minutes while the focus is in the strip (not in the Disguise select, which uses them itself) */
  function runKey(ev) {
    var tg = ev.target;
    if ((ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') || ev.ctrlKey || ev.altKey || ev.metaKey || !tg || !tg.closest || str(tg.tagName).toUpperCase() === 'SELECT' || !tg.closest('.gm-runzone')) return false;
    if (runStep(ev.key === 'ArrowRight' ? 5 : -5)) { ev.preventDefault(); return true; }
    return false;
  }

  /* Every push to the iPad from this page goes through one queue (the secrecy review of 23/10/2026, R2): one PUT in flight at a
     time, and a push made while one is in flight waits; a newer one replaces a push still waiting (it is refused with
     e.superseded and never sent), so the last thing the GM set is what ends on the iPad. Anything but the map ends live reveal the
     moment it is asked for, and anything but the chase strip stops the strip following the chase. opts: map (a Location map push:
     Show on iPad or live reveal), chase (the Chase panel's strip), prepare(d) (called just before the PUT:
     the body to send, or null to drop it), done(r) and fail(e) (called before the next push starts, so the next one's prepare sees
     what this one changed). */
  function pushDisplay(d, opts) {
    var g = gmApi(); if (!g) return Promise.reject(new Error('The display needs the hosted app.'));
    if (!gate.allows(d)) return Promise.reject(new Error('Only a player-layer map made on this page can go to the iPad.'));
    opts = opts || {};
    if (!opts.map) endLive();
    if (!opts.chase) endChase();
    if (!opts.clocks) endClocks();
    return new Promise(function (res, rej) {
      if (DQ.next) { var old = DQ.next; DQ.next = null; old.rej(superseded()); }
      DQ.next = { g: g, d: d, opts: opts, res: res, rej: rej };
      pumpDisplay();
    });
  }
  function superseded() { var e = new Error('A newer push replaced this one before it was sent.'); e.superseded = true; return e; }
  function pumpDisplay() {
    if (DQ.busy || !DQ.next) return;
    var job = DQ.next, body = job.d; DQ.next = null;
    if (job.opts.prepare) { try { body = job.opts.prepare(job.d); } catch (e) { body = null; } }
    if (!body) { job.rej(superseded()); pumpDisplay(); return; }
    DQ.busy = job; paintLive();
    Promise.resolve().then(function () { return job.g.setDisplay(body); }).then(function (r) {
      DQ.busy = null;
      try { if (job.opts.done) job.opts.done(r || {}); } catch (e) {}
      noteShown(job.d, job.opts); job.res(r); pumpDisplay(); paintLive();
    }, function (e) {
      DQ.busy = null;
      try { if (job.opts.fail) job.opts.fail(e); } catch (x) {}
      job.rej(e); pumpDisplay(); paintLive();
    });
  }
  /* more than the public band is going to the players: say which, and ask */
  function confirmReveal(reveal, what) {
    var more = entryBands(reveal).filter(function (b) { return b !== 'public'; }), rooms = entryRooms(reveal), say = [];
    if (more.length) say.push('the ' + more.join(', ') + ' band' + (more.length === 1 ? '' : 's') + ' as well as public');
    if (rooms.length) say.push((rooms.length === 1 ? 'the room ' : 'the rooms ') + rooms.join(', ') + ', opened on ' + (rooms.length === 1 ? 'its' : 'their') + ' own');
    return !say.length || W.confirm(what + ' will show the players ' + say.join(' and ') + '. Go ahead?');
  }
  function resetReveal() {
    var r = mapUi().reveal;
    if (BANDS.some(function (b) { return !!r[b] !== !!P.REVEAL0[b]; })) patch({ loc: { map: { reveal: clone(P.REVEAL0) } } });
  }
  function showOnIpad() {
    var mu = mapUi(), d, tk = playerTokenSet(revealEntries(mu));
    try { d = playerDisplay(S.locRoll, mu, W.B68Map && W.B68Map.render, tk); } catch (e) { toast(errText(e), true); return; }
    if (!confirmReveal(d.reveal, 'This map')) return;
    gate.mark(d.svg);
    var me = S, key = rollKey(S.locRoll), on = { key: key, reveal: d.reveal.slice(), view: mu.view, theme: mu.theme, time: mu.time, weather: mu.weather, title: d.title, tok: tk.sig, tokQ: tk.sig, tokToast: d.tokensRefused ? tk.sig : null };
    endLive();            /* nothing is live until this map has landed */
    pushDisplay({ kind: 'svg', title: d.title, caption: d.caption, svg: d.svg }, {
      map: true,
      done: function (r) { if (S === me && S.locRoll && rollKey(S.locRoll) === key && mapUi().layer === 'player' && typeof r.seq === 'number') S.mapOn = Object.assign(on, { seq: r.seq }); }
    }).then(function () {
      if (S === me) renderLocation();
      toast('On the iPad: ' + d.title + ' (' + d.caption + '). Bands you open or close now go to the iPad at once.');
      if (d.tokensRefused) toast(P.TOKEN_LEAK_MSG, true);
      if (S === me) liveTokens();          /* a marker moved while this was on its way */
    }, function (e) { if (!e.superseded) toast('Could not send to the iPad: ' + errText(e), true); });
  }
  /* Live reveal (GM.md, "Location"; Alex, 22/10/2026: the GM opens bands and the iPad updates at once; the secrecy review of
     23/10/2026). S.mapOn is what Show on iPad (or the last live push) actually put on the iPad: the roll's key, the bands, the view,
     theme, time and weather, and the display seq the server answered. It is live while that roll is the card, Layer is Player and
     nothing else has been pushed: Layer to GM, another roll, or any other push ends it (endLive), and only Show on iPad starts it.
     A tick that would send any band the iPad does not have asks for all of them by name, whichever box fired; a no puts the ticks
     back to what the iPad shows. The copy goes in the view, theme, time and weather Show on iPad sent, through the same render, scan
     and gate, and only if the display is still at S.mapOn.seq (PUT ifSeq: another device's push, the chase strip or anything else
     since is never overwritten; a 409 ends live reveal). A copy that cannot be made safely: when it would open a band, nothing goes
     and the band stays shut; when it would close one, the iPad is cleared (it must not keep showing that band) and the page says so.
     The score scene does not follow (Alex, 15/10/2026: it never updates on its own); the map box says when it is behind. */
  function endLive() { if (S && S.mapOn) { S.mapOn = null; paintLive(); } }
  /* M3: the markers on the iPad follow the run. S.mapOn.tok is the request that last landed and .tokQ the latest one queued (both the
     sig of the requested markers, before the screen, so a refused set does not ask again on every poll). Called after every change
     to the ball (here or from another device, refetch), the table's clocks and the filed characters; a change goes through liveReveal,
     hence the same render, scan, gate and queue, with ifSeq. */
  function liveTokens() {
    if (!S || !mapOnIpad()) return;
    var on = S.mapOn, want = revealEntries(mapUi()), ask = playerTokenSet(want).sig;
    /* the markers asked for, and the ROOMS asked for (a room opened or closed here or on another device, M4 step 5). Bands are not compared
       here: a band ticked on another device never re-sent before and does not now (the ticks send through the box that was ticked) */
    var haveRooms = entryRooms(on.revQ === undefined ? on.reveal : on.revQ);
    if (ask === (on.tokQ === undefined ? on.tok || '' : on.tokQ) && sameBands(entryRooms(want), haveRooms)) return;
    liveReveal();
  }
  function mapOnIpad() {
    if (!S || !S.mapOn) return false;
    if (!S.locRoll || rollKey(S.locRoll) !== S.mapOn.key || mapUi().layer !== 'player') { S.mapOn = null; return false; }
    return true;
  }
  function sameBands(a, b) { return a.length === b.length && a.every(function (x) { return b.indexOf(x) >= 0; }); }
  function liveBusy() { return !!((DQ.busy && DQ.busy.opts.live) || (DQ.next && DQ.next.opts.live)); }
  /* the chip in the Reveal legend: Live only while the iPad holds exactly the ticked bands and nothing is on its way */
  function liveChip(mu) {
    if (!mapOnIpad() || mu.layer !== 'player') return '';
    if (liveBusy()) return ' <span class="gm-sending">Sending to the iPad…</span>';
    return sameBands(revealEntries(mu), S.mapOn.reveal) ? ' <span class="gm-live">Live on the iPad</span>' : '';
  }
  /* "Open one room" (M4 step 5), under the band ticks, for a run (an authored site with a play block: that is where ball.open lives).
     Each room whose band is not ticked gets Open for the players; a room already opened on its own gets Close. Room names go in
     through esc() and are read back from the roll by name, never by position. */
  function roomsHtml(mu, roll) {
    var rs = runSite(); if (!rs || !roll || !Array.isArray(roll.rooms)) return '';
    var open = cleanRooms(ballDoc(rs.name).open), seen = {}, rows = '';
    roll.rooms.forEach(function (r) {
      if (!isObj(r) || typeof r.name !== 'string' || !r.name || seen[r.name]) return; seen[r.name] = 1;
      var bandOpen = r.band === 'public' || mu.reveal[r.band] === true, on = open.indexOf(r.name) >= 0;
      if (bandOpen && !on) return;           /* its band already shows it */
      rows += '<li class="gm-roomrow"><span class="gm-roomname">' + esc(r.name) + '</span> <small class="gm-dim">' + esc(str(r.band)) + (on && bandOpen ? ', its band is open too' : on ? ', open' : '') + '</small> ' +
        (on ? '<button type="button" class="btn sm" data-gm="room-close" data-room="' + esc(r.name) + '">Close</button>'
          : '<button type="button" class="btn sm" data-gm="room-open" data-room="' + esc(r.name) + '" title="Shows the players this room only: not its band, not the rooms beside it">Open for the players</button>') + '</li>';
    });
    if (!rows) return '';
    /* a band whose every room is now open on its own, with the band itself still shut: the rooms are all there, but its passages are not */
    var allOpen = BANDS.filter(function (b) {
      if (b === 'public' || mu.reveal[b] === true) return false;
      var names = []; roll.rooms.forEach(function (r) { if (isObj(r) && r.band === b && typeof r.name === 'string' && names.indexOf(r.name) < 0) names.push(r.name); });
      return names.length > 0 && names.every(function (n) { return open.indexOf(n) >= 0; });
    });
    var hint = allOpen.length ? '<p class="gm-dim gm-roomhint" data-roomhint="' + esc(allOpen.join(' ')) + '">All the ' + esc(allOpen.join(' and ')) + ' rooms are open: tick the band to show its passages too.</p>' : '';
    return '<details class="gm-more gm-rooms"' + (foldOpen('rooms') ? ' open' : '') + ' data-fold="rooms"><summary>Open one room' + (open.length ? ' <span class="gm-dim">' + open.length + ' open</span>' : '') + '</summary>' +
      '<ul class="gm-roomlist">' + rows + '</ul>' + hint + '<p class="gm-dim">Only that room, with its crew markers: not its band, not the rooms beside it, not how many are shut. ' +
      'Goes out with the map (at once while it is live on the iPad), and only while Layer is Player.</p></details>';
  }
  /* open or close one room for the players: the run's ball.open. The change goes out through liveReveal (ballSet -> liveTokens), which asks
     first, exactly as for a band; a no puts the room back. */
  function roomOpen(name, on) {
    var rs = runSite(); if (!rs || !S.locRoll || !Array.isArray(S.locRoll.rooms)) return;
    if (!S.locRoll.rooms.some(function (r) { return isObj(r) && r.name === name; })) return;
    var cur = cleanRooms(ballDoc(rs.name).open), has = cur.indexOf(name) >= 0;
    if (on === has) return;
    var next = on ? cur.concat([name]) : cur.filter(function (n) { return n !== name; });
    ballSet(rs.name, { open: next.length ? next : null });
    if (S.map) drawMap(); renderLocation();
  }
  /* the Reveal legend's words: the bands, then the rooms opened on their own */
  function revealText(mu) {
    if (mu.layer !== 'player') return 'public only while Layer is GM';
    var e = revealEntries(mu), rooms = entryRooms(e);
    return entryBands(e).join(', ') + (rooms.length ? ' + ' + rooms.join(', ') : '');
  }
  function paintLive() {
    var lg = $q('.gm-reveal legend'); if (!lg || !S || !S.doc) return;
    var mu = mapUi();
    lg.innerHTML = 'Reveal to the players: ' + esc(revealText(mu)) + liveChip(mu);
  }
  /* the ticks back to what the iPad shows */
  function ticksTo(bands) { var rv = {}; BANDS.forEach(function (b) { if (b !== 'public') rv[b] = bands.indexOf(b) >= 0; }); patch({ loc: { map: { reveal: rv } } }); }
  /* a no (or a copy that cannot be made): the new bands come off the ticks; if a push is on its way with other bands, the state
     left goes after it, so the iPad ends on what the ticks say */
  function dropBands(want, more) {
    var moreRooms = entryRooms(more), rs = moreRooms.length ? runSite() : null;
    ticksTo(entryBands(want).filter(function (b) { return entryBands(more).indexOf(b) < 0; }));
    /* a room that was asked for and refused comes back off the ball's open list (quietly: this is the answer, not a new request) */
    if (rs) { var keep = cleanRooms(ballDoc(rs.name).open).filter(function (n) { return moreRooms.indexOf(n) < 0; }); ballSet(rs.name, { open: keep.length ? keep : null }, true); }
    if (liveBusy()) liveReveal();
  }
  /* bands and rooms of a reveal list, in words: "the working band", "the working and secure bands", "the room Kitchens" */
  function bandWords(l) {
    var b = entryBands(l), r = entryRooms(l), out = [];
    if (b.length) out.push(b.length === 1 ? 'the ' + b[0] + ' band' : 'the ' + b.slice(0, -1).join(', ') + ' and ' + b[b.length - 1] + ' bands');
    if (r.length) out.push(r.length === 1 ? 'the room ' + r[0] : 'the rooms ' + r.slice(0, -1).join(', ') + ' and ' + r[r.length - 1]);
    return out.join(' and ');
  }
  function liveReveal() {
    if (!mapOnIpad()) return;
    var on = S.mapOn, mu = mapUi(), want = revealEntries(mu), tk = playerTokenSet(want);
    if (sameBands(want, on.reveal) && tk.sig === (on.tok || '') && !liveBusy()) return;
    var more = want.filter(function (b) { return on.reveal.indexOf(b) < 0; }), fewer = on.reveal.filter(function (b) { return want.indexOf(b) < 0; });
    if (more.length && !W.confirm('The map is on the iPad: ' + (more.length === 1 ? 'opening ' + bandWords(more) + ' shows it' : 'this shows the players ' + bandWords(more)) + (more.length === 1 ? ' to the players now' : ' now') + '. Go ahead?')) { dropBands(want, more); return; }
    var spec = { layer: 'player', reveal: mu.reveal, open: mu.open, view: on.view, theme: on.theme, time: on.time, weather: on.weather }, d;
    try { d = playerDisplay(S.locRoll, spec, W.B68Map && W.B68Map.render, tk); } catch (e) {
      on.tokQ = tk.sig;       /* not asked again until something changes */
      if (!fewer.length) { toast('Not sent: ' + errText(e) + ' The iPad still shows ' + entryBands(on.reveal).join(', ') + (entryRooms(on.reveal).length ? ' + ' + entryRooms(on.reveal).join(', ') : '') + '.', true); dropBands(want, more); return; }
      endLive();
      pushDisplay({ kind: 'blank' }).then(function () { toast('The iPad was cleared: without ' + bandWords(fewer) + ' this map would name a hidden room, so it could not be sent. Show it again from another view.', true); },
        function (e2) { if (!e2.superseded) toast('Could not clear the iPad: ' + errText(e2) + '. It may still show ' + bandWords(fewer) + ': press Clear → ambient.', true); });
      return;
    }
    gate.mark(d.svg);
    var me = S, key = on.key, sent = d.reveal.slice(), sig = tk.sig;
    on.tokQ = sig;        /* the markers asked for, so a poll with nothing new asks for nothing */
    on.revQ = sent;       /* and the reveal asked for (bands and rooms), likewise */
    pushDisplay({ kind: 'svg', title: d.title, caption: d.caption, svg: d.svg }, {
      map: true, live: true,
      prepare: function (body) { return S === me && S.mapOn && S.mapOn.key === key ? Object.assign({}, body, { ifSeq: S.mapOn.seq }) : null; },
      done: function (r) { if (S === me && S.mapOn && S.mapOn.key === key && typeof r.seq === 'number') { S.mapOn.seq = r.seq; S.mapOn.reveal = sent; S.mapOn.tok = sig; } },
      fail: function () { if (S === me) endLive(); }
    }).then(function () {
      toast('On the iPad now: ' + d.caption + '.');
      /* a refused set of markers says so once per set (the map itself went) */
      if (d.tokensRefused && S === me && S.mapOn && S.mapOn.key === key && S.mapOn.tokToast !== sig) { S.mapOn.tokToast = sig; toast(P.TOKEN_LEAK_MSG, true); }
    }, function (e) {
      if (e.superseded) return;
      if (e.status === 409) toast('Something else is on the iPad now, so the map was not sent and live reveal has stopped. Show on iPad starts it again.', true);
      else toast('Could not update the iPad: ' + errText(e) + '. Live reveal has stopped: Show on iPad starts it again.', true);
    });
  }
  /* the score scene's bands, when one is set from this roll's place and they are not the bands ticked now (it never follows on its own) */
  function sceneBehind(mu) {
    var sc = AM.doc && isObj(AM.doc.score) ? AM.doc.score : null; if (!sc || !S.locRoll || str(sc.name) !== str(S.locRoll.name).slice(0, 200)) return null;
    var now = revealList(mu), was = Array.isArray(sc.reveal) ? sc.reveal : [];
    return now.join(',') === was.join(',') ? null : was;
  }
  function pushText() {
    var L = W.B68GmLocation; if (!L || !S.locRoll) return;
    var reveal = revealList(mapUi()), ps;      /* public only, unless Layer is Player and the GM ticked more */
    if (!confirmReveal(reveal, 'The street description')) return;
    try { ps = L.playerSummary(S.locRoll, reveal); } catch (e) { toast(errText(e), true); return; }
    var me = S, seed = rollKey(S.locRoll);
    pushDisplay({ kind: 'text', title: plainText(ps.title).slice(0, 2000), caption: str(S.locRoll.district || ''), text: plainText(ps.text).slice(0, 2000) }).then(function () {
      toast('On the iPad: the street description.');
      if (S === me && S.locRoll && rollKey(S.locRoll) === seed) { S.locSent = seed; renderLocation(); }   /* the Say box: Players see */
    }, function (e) { toast('Could not send to the iPad: ' + errText(e), true); });
  }
  /* Clear -> ambient: nothing spotlit, the ambient scene plays. Lights out: true black. */
  function blankIpad() { pushDisplay({ kind: 'blank' }).then(function () { toast('Cleared: the iPad plays the ambient scene.'); }, function (e) { toast('Could not clear the iPad: ' + errText(e), true); }); }
  function darkIpad() { pushDisplay({ kind: 'dark' }).then(function () { toast('Lights out on the iPad.'); }, function (e) { toast('Could not turn the lights out: ' + errText(e), true); }); }

  /* ---------- score sites (GM.md, "Score sites"): a location roll saved against a score card; the Prep tab's site strip ----------
     The scores are the prep part's embedded score cards (gm/prep.js scores()). S.siteFor is the score the save row points at on
     this page: the one whose Roll a site or Open map brought the GM here, else none. Saving is always a press. */
  function scoreList() { var pk = part('prep'), B = W.B68GmPrep; try { return pk && B && B.scores ? B.scores(pk) : []; } catch (e) { return []; } }
  function scoreOf(key) { return scoreList().filter(function (s) { return s.key === key; })[0] || null; }
  function siteLabel(key) { var s = scoreOf(key), x = sitesIn(S.doc)[key]; return s ? s.label : x && x.label ? x.label : key; }
  function siteRowHtml(cur) {
    if (isObj(cur) && cur.auth) return '<section class="gm-siterow" id="gm-siterow" aria-label="Site for a score"><p class="gm-dim gm-site-is">Authored in the vault: <b>' + esc(cur.auth) + '</b>. A score card takes it with <code>site:</code> in Obsidian, not from here.</p></section>';
    var list = scoreList(); if (!list.length) return '';
    var sites = sitesIn(S.doc), mine = siteKeysOf(sites, cur), pick = S.siteFor && list.some(function (s) { return s.key === S.siteFor; }) ? S.siteFor : mine[0] || '';
    var sc = list.filter(function (s) { return s.key === pick; })[0], same = sc && mine.indexOf(sc.key) >= 0;
    var opts = '<option value="">Choose a score…</option>' + list.map(function (s) {
      var x = sites[s.key], note = !x ? '' : mine.indexOf(s.key) >= 0 ? ' · this site' : ' · has a site';
      return '<option value="' + esc(s.key) + '"' + (s.key === pick ? ' selected' : '') + '>' + esc(s.label + note) + '</option>';
    }).join('');
    return '<section class="gm-siterow" id="gm-siterow" aria-label="Site for a score"><label class="gm-field" for="gm-site-pick"><span class="gm-lab">Site for a score</span><select id="gm-site-pick" data-site="pick">' + opts + '</select></label>' +
      '<button type="button" class="btn sm' + (sc && !same ? ' primary' : '') + '" data-gm="sitesave"' + (sc && !same ? '' : ' disabled') + '>' + (same ? 'Saved as its site' : sc ? 'Save as the site for ' + esc(sc.label) : 'Save as the site') + '</button>' +
      (mine.length ? '<p class="gm-dim gm-site-is">This roll is the site for ' + esc(mine.map(siteLabel).join(', ')) + '.</p>' : '') + '</section>';
  }
  function saveSite() {
    var key = S.siteFor || str(($q('#gm-site-pick') || {}).value), sc = scoreOf(key), cur = isObj(S.doc.cards) ? S.doc.cards.location : null;
    if (!S.locRoll || !isObj(cur)) { toast('Roll a location first.', true); return; }
    if (!sc) { toast('Choose the score this site is for.', true); return; }
    var sites = sitesIn(S.doc), old = sites[key];
    if (old && old.seed === cur.seed) { toast('This roll is already the site for ' + sc.label + '.'); return; }
    if (!old && Object.keys(sites).length >= SITE_MAX) { toast(SITE_MAX + ' sites are saved already. Clear the site of a played score (its strip in Prep) first.', true); return; }
    if (old && !W.confirm('Replace the site saved for ' + sc.label + ' (' + (old.name || 'a saved roll') + ')? The vault keeps a location note the sync already filed.')) return;
    var e = siteEntry(cur, S.locRoll, sc.label, mapUi()); if (!e) { toast('Roll a location first.', true); return; }
    var p = { sites: {} }; p.sites[key] = replacePatch(isObj(S.doc.sites) ? S.doc.sites[key] : null, e);
    if (!patch(p)) return;
    S.siteFor = key;
    toast('Saved: ' + (e.name || 'this roll') + ' is the site for ' + sc.label + '.');
    renderLocation(); decoratePrep($q('#gm-prep'));
  }
  /* a panel opened by a button: as its key does (the phone shows the side panel) */
  function showPanel(p) { setPanel(p); if (isPhone()) { S.seg = 'side'; syncPanels(); } }
  /* Open map: the saved roll becomes the Location card, on the GM layer in the view and theme it was saved with, public band only */
  function openSite(key) {
    var x = sitesIn(S.doc)[key]; if (!x) return;
    var cur = { hid: uid('h'), seed: x.seed, ui: clone(isObj(x.ui) ? x.ui : {}), mem: typeof x.mem === 'string' ? x.mem : '{}', label: str(x.name) + (x.district ? ' · ' + x.district : ''), at: nowIso() };
    var m = isObj(x.map) ? x.map : {};
    patch({ cards: { location: replacePatch(isObj(S.doc.cards) ? S.doc.cards.location : null, cur) }, loc: { map: { reveal: clone(P.REVEAL0), view: VIEWS.indexOf(m.view) >= 0 ? m.view : P.MAP0.view, theme: THEMES.indexOf(m.theme) >= 0 ? m.theme : P.MAP0.theme, layer: 'gm' } } }, { force: true });
    S.locRoll = null; S.map = null; S.siteFor = key; S.last = { text: 'Location: ' + cur.label };
    showPanel('location');
    renderLocation();
    if (S.locRoll && W.B68Map && W.B68Map.render) drawMap(true);
    if (!S.locRoll) toast('That site would not redraw: the location tables are missing.', true);
    else if (x.name && str(S.locRoll.name) !== str(x.name)) toast('The location tables have changed since this site was saved: this is its seed on the new tables (' + str(S.locRoll.name) + '), not ' + x.name + '.', true);
  }
  /* Open map on an authored site (the card's site: in the vault): it becomes the Location card, { auth } in place of a seed, on the
     GM layer, public band only, in the view and theme its note asks for (else iso, rulebook). Reveal the bands from there as ever */
  function openAuthored(key) {
    var A = authoredOf(part('location')), name = str(A.bind[key]), site = name ? A.sites[name] : null;
    if (!isObj(site)) { toast('That authored site is not in the pack any more. Update the pack.', true); return; }
    var dist = isObj(site.patch) ? str(site.patch.district) : '', m = isObj(site.map) ? site.map : {};
    var cur = { hid: uid('h'), auth: name, label: name + (dist ? ' · ' + dist : ''), at: nowIso() };
    patch({ cards: { location: replacePatch(isObj(S.doc.cards) ? S.doc.cards.location : null, cur) }, loc: { map: { reveal: clone(P.REVEAL0), view: VIEWS.indexOf(m.view) >= 0 ? m.view : 'iso', theme: THEMES.indexOf(m.theme) >= 0 ? m.theme : 'rulebook', layer: 'gm' } } }, { force: true });
    S.locRoll = null; S.map = null; S.siteFor = key; S.last = { text: 'Location: ' + cur.label };
    showPanel('location');
    renderLocation();
    if (S.locRoll && W.B68Map && W.B68Map.render) drawMap(true);
    if (!S.locRoll) toast('That authored site would not draw: check its b68-site block in Obsidian.', true);
  }
  /* Roll a site / Roll another: the Location pickers from the card's hints, then a roll; the save row points at the score */
  function rollSite(key) {
    var L = W.B68GmLocation, pk = part('location'), sc = scoreOf(key); if (!L || !pk || !sc) { if (!sc) toast('That score is not in the pack any more.', true); return; }
    var r; try { r = siteUi(L.controls(pk).controls, sc.site); } catch (e) { r = { ui: {}, missed: [] }; }
    patch({ loc: { ui: r.ui } });
    S.siteFor = key;
    showPanel('location');
    rollLocation();
    if (r.missed.length) toast('Not in the generator, so rolled on any: ' + r.missed.map(function (m) { return m[0] + ' “' + m[1] + '”'; }).join(', ') + '. Fix the card’s site_ properties in Obsidian.', true);
  }
  function clearSite(key) {
    var x = sitesIn(S.doc)[key]; if (!x) return;
    if (!W.confirm('Clear the site saved for ' + siteLabel(key) + ' (' + (x.name || 'a saved roll') + ')? A location note the sync already filed stays in the vault.')) return;
    var p = { sites: {} }; p.sites[key] = null;
    if (!patch(p, { force: true })) return;
    toast('Cleared the site for ' + siteLabel(key) + '.');
    renderLocation(); decoratePrep($q('#gm-prep'));
  }
  /* the strip in each embedded score card (the slot gm/prep.js leaves): redrawn only when its site changed */
  function decorateSites(el) {
    if (!el || !el.querySelectorAll) return;
    var slots = el.querySelectorAll('.pp-site[data-score]'); if (!slots.length) return;
    var sites = sitesIn(S.doc), A = authoredOf(part('location')), byKey = {}; scoreList().forEach(function (s) { byKey[s.key] = s; });
    [].forEach.call(slots, function (slot) {
      var key = slot.getAttribute('data-score'), sc = byKey[key] || { key: key, label: key, site: {} }, x = sites[key], k = esc(key);
      var a = A.bind[key] && isObj(A.sites[A.bind[key]]) ? str(A.bind[key]) : '';
      var sig = JSON.stringify([x ? [x.seed, x.name, x.district, x.at] : null, a, hintLine(sc.site)]);
      if (slot.getAttribute('data-sig') === sig) return;
      slot.setAttribute('data-sig', sig); slot.classList.toggle('has', !!x || !!a);
      /* an authored site (the card's site: in the vault) comes first; a roll saved for the same score stays reachable */
      slot.innerHTML = a
        ? '<span class="gm-lab">Site</span><span class="pp-site-t"><b>' + esc(a) + '</b> <span class="gm-dim">· authored' + (x ? ' · a saved roll too: ' + esc(x.name || 'saved') : '') + '</span></span>' +
          '<span class="pp-site-acts"><button type="button" class="btn sm primary" data-gm="siteauth" data-score="' + k + '">Open map</button>' +
          (x ? '<button type="button" class="btn sm" data-gm="siteopen" data-score="' + k + '">Open the roll</button><button type="button" class="btn sm" data-gm="siteclear" data-score="' + k + '">Clear the roll</button>' : '') + '</span>'
        : x
        ? '<span class="gm-lab">Site</span><span class="pp-site-t"><b>' + esc(x.name || 'saved') + '</b>' + (x.district ? ' <span class="gm-dim">· ' + esc(x.district) + '</span>' : '') + '</span>' +
          '<span class="pp-site-acts"><button type="button" class="btn sm primary" data-gm="siteopen" data-score="' + k + '">Open map</button><button type="button" class="btn sm" data-gm="siteroll" data-score="' + k + '">Roll another</button><button type="button" class="btn sm" data-gm="siteclear" data-score="' + k + '">Clear</button></span>'
        : '<span class="gm-lab">Site</span><span class="pp-site-t gm-dim">None yet' + (hintLine(sc.site) ? ' · ' + esc(hintLine(sc.site)) : '') + '</span>' +
          '<span class="pp-site-acts"><button type="button" class="btn sm" data-gm="siteroll" data-score="' + k + '">Roll a site</button></span>';
    });
  }

  /* ---------- the iPad panel (I): the ambient scenes. The server's document is the truth ---------- */
  function noteShown(d, opts) { if (isObj(d)) { AM.shown = { kind: str(d.kind), title: str(d.title) }; renderIpad(); apPush(d, opts); } }
  function adoptAmbient(r) {
    if (!isObj(r) || !isObj(r.doc)) return false;
    if (typeof r.seq === 'number' && typeof AM.seq === 'number' && r.seq < AM.seq) return false;     /* an older answer landing late */
    AM.doc = r.doc; AM.seq = typeof r.seq === 'number' ? r.seq : AM.seq; AM.updatedAt = r.updatedAt || null; AM.loaded = true; AM.error = '';
    apSync();
    return true;
  }
  /* GET the ambient document (and, the first time, what the iPad shows). Also corrects a stale crew once the truth is known. */
  function loadAmbient() {
    var g = gmApi(); if (!g || typeof g.ambient !== 'function') return Promise.resolve();
    var me = S, first = !AM.displayRead;
    return Promise.resolve().then(function () { return Promise.all([g.ambient(), first && typeof g.display === 'function' ? g.display().then(function (r) { return r; }, function () { return null; }) : null]); }).then(function (res) {
      if (adoptAmbient(res[0])) { crewSync.note(camp); crewSync.adopt(AM.doc.crew, true); }
      var dr = res[1];
      if (dr && isObj(dr.display)) { AM.displayRead = true; apSeed(!AM.shown, dr.display.kind); AM.shown = AM.shown || { kind: str(dr.display.kind), title: str(dr.display.title) }; }
      if (S === me) renderIpad();
    }, function (e) {
      AM.error = errText(e);
      if (S === me) { renderIpad(); toast('Could not read the iPad settings: ' + AM.error, true); }
    });
  }
  /* PATCH the ambient document; the response is drawn (a refused change is a toast and the panel keeps the server's value) */
  function patchAmbient(p) {
    var g = gmApi(); if (!g || typeof g.patchAmbient !== 'function') { toast('The iPad settings need the hosted app.', true); return Promise.resolve(null); }
    if (!gate.allowsAmbient(p)) { toast('Only a player-layer score made on this page can go to the iPad.', true); return Promise.resolve(null); }
    AM.busy++; renderIpad();
    return Promise.resolve().then(function () { return g.patchAmbient(p); }).then(function (r) {
      AM.busy--; if (adoptAmbient(r)) crewSync.adopt(AM.doc.crew, false); renderIpad(); return r;
    }, function (e) {
      AM.busy--; renderIpad(); toast('Could not change the iPad: ' + errText(e), true); return null;
    });
  }
  /* Lay something over the iPad without replacing what is up (the false dawn; the autopilot). The patch goes through patchAmbient, so the
     gate runs; a hidden NPC is refused by the server too. An id is made when none is given: a new id is what shows it afresh. */
  /* An overlay id is opaque: a random prefix drawn once per page load and a counter, never built from a clock's or an NPC's id or name. The prefix
     is why a reloaded page's first id is not one the display has already seen (the display shows each id once). */
  var OV_PREFIX = 'o' + Math.random().toString(36).slice(2, 7) + '-', ovCount = 0;
  function newOverlayId() { return OV_PREFIX + (++ovCount); }
  function showOverlay(o) {
    if (!isObj(o)) return Promise.resolve(null);
    var ov = Object.assign({}, o); if (ov.id === undefined) ov.id = newOverlayId();
    if (!overlayOk(ov)) { toast('That overlay is not one the iPad can show.', true); return Promise.resolve(null); }
    return patchAmbient({ overlay: ov });
  }
  function clearOverlay() { return patchAmbient({ overlay: null }); }

  /* ---------- the iPad autopilot (design 6; GM.md "Autopilot") ----------
     B68GmAutopilot (gm/autopilot.js) is the pure controller; this block is its driver, and the only place it touches the page. It feeds the
     controller what happened (a visible table clock changed, a revealed NPC with a portrait spoke, the GM pushed something, lights out, the page
     hid or showed, Take over / Hand back), and carries out the one action it answers with: the overlay to set or the one to clear. Output goes
     through the ambient document as a QUIET patch (no toast on a refusal; the controller's log, S.doc.ap.log, keeps the last 20 lines for
     gm:after). Every overlay it sends carries `auto: true`: the server refuses it while the display is in lights out, and the display never draws it
     over black. A clock goes by its id and an NPC by its id: the server names them (and refuses a hidden clock or NPC), so no name leaves this page. */
  var AP_KEY = 'b68.gm.autopilot', AP_TTL = 12 * 3600 * 1000, AP_SETTLE_MS = 1000, AP_PROBE_MS = 15000;
  var apToasted = false;                    /* the first-time toast: once per page load */
  function apSavedMode() { try { var m = JSON.parse(W.localStorage.getItem(AP_KEY) || 'null'); if (isObj(m) && (m.mode === 'hold' || m.mode === 'off') && Date.now() - m.at < AP_TTL) return m.mode; } catch (e) {} return ''; }
  function apSaveMode(mode) { try { if (mode === 'hold' || mode === 'off') W.localStorage.setItem(AP_KEY, JSON.stringify({ mode: mode, at: Date.now() })); else W.localStorage.removeItem(AP_KEY); } catch (e) {} }
  function apClockMap() {
    var out = {};
    tableClocks().forEach(function (c) { var id = str(c.id); if (id) out[id] = { filled: +c.filled || 0, hidden: !!c.hidden }; });
    return out;
  }
  function apMount() {
    var me = S, A = W.B68GmAutopilot;
    if (me.ap) { apPaint(); return; }          /* start() runs again after a pack import on the same page: the running controller (and what it is showing) stays */
    if (!A) return;
    var core = A.create({ now: function () { return Date.now(); }, idPrefix: 'a' + Math.random().toString(36).slice(2, 7) + '-' });
    var prev = isObj(me.doc.ap) && Array.isArray(me.doc.ap.log) ? me.doc.ap.log.filter(isObj).slice(-A.DURATIONS.logMax) : [];
    var ap = me.ap = { core: core, q: Promise.resolve(), sets: 0, clocks: apClockMap(), settle: {}, probeAt: 0, logKey: '0:', prev: prev, cat: '' };   /* '0:' is apLog's key for an empty log: a controller with nothing to say writes nothing (an empty ap.log on the first tick pushed the GM's pending save back by a debounce) */
    var saved = apSavedMode();
    if (saved === 'hold') core.event({ type: 'takeover' }); else if (saved === 'off') core.event({ type: 'off' });
    if (document.hidden) core.event({ type: 'visible', visible: false });
    if (AM.shown && (AM.shown.kind === 'dark' || AM.shown.kind === 'rule')) core.event({ type: 'push', kind: AM.shown.kind });
    ap.cat = apCat();
    ap.timer = typeof W.setInterval === 'function' ? W.setInterval(function () { if (S === me) apTick(); }, 1000) : null;
    apPaint();      /* nothing is written to the document on open: the AUTO chip comes with the first overlay (auto: true rides in the same patch) */
  }
  /* closing the page: the autopilot stops, the AUTO chip goes, and an overlay it put up is taken off */
  function apUnmount(me) {
    var ap = me && me.ap; if (!ap) return;
    if (ap.timer && typeof W.clearInterval === 'function') { W.clearInterval(ap.timer); ap.timer = null; }
    Object.keys(ap.settle).forEach(function (k) { clearTimeout(ap.settle[k]); });
    var g = (keptApi && keptApi.gm && keptApi.gm()) || (W.claude && W.claude.gm), st = ap.core.state(), p = {};
    if (AM.doc && AM.doc.auto === true) p.auto = null;
    if (st.showing && AM.doc && isObj(AM.doc.overlay) && AM.doc.overlay.id === st.showing.id) p.overlay = null;
    me.ap = null;
    if (AM.doc) { if ('auto' in p) delete AM.doc.auto; if ('overlay' in p) delete AM.doc.overlay; }
    if (Object.keys(p).length && g && typeof g.patchAmbient === 'function') { try { Promise.resolve(g.patchAmbient(p)).then(null, function () {}); } catch (e) {} }
  }
  function apCat() { var m = S && S.ap ? S.ap.core.state().mode : ''; return m === 'hold' || m === 'off' ? m : 'on'; }
  function apEvent(e) {
    var ap = S && S.ap; if (!ap) return;
    var a = ap.core.event(e);
    if (a) apRun(a);
    var cat = apCat();
    if (cat !== ap.cat) { ap.cat = cat; apSaveMode(cat); apAuto(); }
    apPaint(); apLog();
  }
  function apTick() {
    var ap = S && S.ap; if (!ap) return;
    var a = ap.core.tick(Date.now());
    if (a) apRun(a);
    apProbe(); apPaint(); apLog();
  }
  /* held back by lights out or a rules entry with something waiting: look at what the iPad really shows now and then (another device may have changed it) */
  function apProbe() {
    var ap = S && S.ap, g = gmApi(); if (!ap || !g || typeof g.display !== 'function') return;
    var st = ap.core.state(), t = Date.now();
    if (!(st.guards.lights || st.guards.rule) || !Object.keys(st.pending).length || t - ap.probeAt < AP_PROBE_MS) return;
    ap.probeAt = t;
    var me = S;
    Promise.resolve().then(function () { return g.display(); }).then(function (r) {
      if (S !== me || !r || !isObj(r.display)) return;
      var k = str(r.display.kind);
      apEvent({ type: 'push', kind: k === 'dark' || k === 'rule' ? k : 'blank' });
    }, function () {});
  }
  function apWhy(e) { return e && e.status ? 'HTTP ' + e.status : 'no answer'; }
  /* a quiet ambient patch (no busy state, no toast): the autopilot's own writes */
  function apPatch(p) {
    var g = gmApi();
    if (!g || typeof g.patchAmbient !== 'function') return Promise.reject(new Error('the GM tools are not available'));
    if (!gate.allowsAmbient(p)) return Promise.reject(new Error('the gate refused that overlay'));
    return Promise.resolve().then(function () { return g.patchAmbient(p); }).then(function (r) {
      if (adoptAmbient(r)) crewSync.adopt(AM.doc.crew, false);
      renderIpad(); return r;
    });
  }
  function apRun(a) {
    var me = S, ap = me && me.ap; if (!ap || !a) return;
    if (a.do === 'set') ap.sets++;
    ap.q = ap.q.then(function () {
      if (S !== me || me.ap !== ap) { if (a.do === 'set') ap.sets--; return; }
      if (a.do === 'clear') {
        /* only what is ours: the GM's dawn (perhaps pressed on another device), or an overlay already cleared, is left alone. The document is read
           again first rather than trusting this page's copy; the write that follows carries ifOverlay (our overlay's id), so the server clears
           only while that overlay is still the stored one: a dawn set in the few tens of ms between the read and the write is not cleared. */
        var g = gmApi();
        return Promise.resolve().then(function () { return g && typeof g.ambient === 'function' ? g.ambient() : null; }).then(function (r) {
          if (r) adoptAmbient(r);
          var cur = r && isObj(r.doc) && isObj(r.doc.overlay) ? r.doc.overlay : (r ? null : (AM.doc && isObj(AM.doc.overlay) ? AM.doc.overlay : null));
          if (!cur || cur.id !== a.id) return;
          return apPatch({ overlay: null, ifOverlay: a.id });
        }).then(null, function (e) { ap.core.note({ do: 'refused', kind: 'clear', why: apWhy(e) }); apLog(); });
      }
      var ov = a.overlay;
      return apPatch({ overlay: ov, auto: true }).then(function () {
        ap.sets--;
        if (!apToasted) { apToasted = true; toast('Blade is directing the iPad’s overlays (Auto). Take over any time from the top bar.'); }
        apSync();
      }, function (e) {
        ap.sets--;
        ap.core.note({ do: 'refused', kind: ov.kind, key: ov.clockId || ov.npcId || '', why: apWhy(e) });
        if (e && e.status === 409) apEvent({ type: 'push', kind: 'dark' });      /* the server says lights out: hold back until it lifts */
        apEvent({ type: 'replaced' });
      });
    });
  }
  /* the document's overlay is no longer the one the controller is showing (the GM cleared it, a dawn replaced it): it lets go */
  function apSync() {
    var ap = S && S.ap; if (!ap || ap.sets > 0 || !AM.loaded) return;
    var st = ap.core.state(); if (st.mode !== 'showing' || !st.showing) return;
    var o = AM.doc && isObj(AM.doc.overlay) ? AM.doc.overlay : null;
    if (!o || o.id !== st.showing.id) apEvent({ type: 'replaced' });
  }
  function apAuto() {
    var ap = S && S.ap; if (!ap) return;
    var want = apCat() === 'on';
    if (AM.loaded && AM.doc && (want ? AM.doc.auto === true : AM.doc.auto !== true)) return;
    ap.q = ap.q.then(function () { return apPatch({ auto: want }).then(null, function () {}); });
  }
  function apLog() {
    var ap = S && S.ap; if (!ap) return;
    var cl = ap.core.state().log, last = cl[cl.length - 1], key = cl.length + ':' + (last ? last.at + last.do + last.why : '');
    if (key === ap.logKey) return;
    ap.logKey = key;
    patch({ ap: { log: ap.prev.concat(cl).slice(-20) } });
  }
  function apView() {
    var ap = S && S.ap; if (!ap) return null;
    var m = ap.core.state().mode;
    /* the top bar is crowded, so its pill is the badge alone (Auto, GM, Off); the action is its tooltip and accessible name, and the Blade panel's header and the iPad tab spell it out */
    if (m === 'hold') return { mode: 'hold', badge: 'GM', action: 'Hand back', bar: 'GM', title: 'Hand back: you are directing the iPad. Hand it back to Blade to bring the overlays back.' };
    if (m === 'off') return { mode: 'off', badge: 'Off', action: 'Switch on', bar: 'Auto off', title: 'Switch on: the autopilot is off. Switch it on to let Blade lay clocks and NPCs over the iPad.' };
    return { mode: 'auto', badge: 'Auto', action: 'Take over', bar: 'Auto', title: 'Take over: Blade is laying clocks and NPCs over the iPad. Take over stops it and takes down what it put up.' };
  }
  function apPaint() {
    var v = apView(), b = $q('#gm-bar-ap');
    if (b) { b.hidden = !v; if (v) { b.textContent = v.bar; b.title = v.title; b.setAttribute('aria-label', v.title); b.setAttribute('data-ap', v.mode); } }
    if (S && S.assist && typeof S.assist.setAutopilot === 'function') S.assist.setAutopilot(v ? { label: v.badge + ' · ' + v.action, title: v.title } : null);
    var ln = $q('#gm-ipad-ap');
    if (ln) { ln.hidden = !v; if (v) { var m = ln.querySelector('[data-ap-badge]'), t = ln.querySelector('[data-gm="aptoggle"]'); if (m) m.textContent = v.badge; if (t) t.textContent = v.action; var o = ln.querySelector('[data-gm="apoff"]'); if (o) o.hidden = v.mode === 'off'; } }
  }
  /* Take over (or Hand back, or Switch on): the top bar's pill, the Blade panel's header and the iPad tab all call this */
  function apToggle() {
    var ap = S && S.ap; if (!ap) return;
    var m = ap.core.state().mode;
    apEvent({ type: m === 'hold' ? 'handback' : m === 'off' ? 'on' : 'takeover' });
    toast(m === 'hold' ? 'Handed back: Blade is directing the iPad again.' : m === 'off' ? 'The autopilot is on.' : 'You have the iPad. Blade will not lay anything over it until you hand it back.');
  }
  function apSwitchOff() { var ap = S && S.ap; if (ap) { apEvent({ type: 'off' }); toast('The autopilot is off.'); } }
  /* the table's clocks changed (campaign(doc)): the first look is the baseline; after that, a clock made visible or a visible one whose fill moved is an
     event (settled for a second first, so the save has landed when the server reads it), one that turned hidden or went is a "gone". A reveal
     is the GM's own act and not a trigger. More than three moving at once is a resync, not a play. */
  function apClocksFeed() {
    var ap = S && S.ap; if (!ap) return;
    if (!isObj(camp) || !Array.isArray(camp.clocks)) { ap.clocks = null; return; }
    var now = apClockMap(), prev = ap.clocks; ap.clocks = now;
    if (!prev) return;
    var changed = [], gone = [];
    Object.keys(now).forEach(function (id) {
      var n = now[id], p = prev[id];
      if (n.hidden) { if (p && !p.hidden) gone.push(id); return; }
      if (!p) changed.push(id); else if (!p.hidden && n.filled !== p.filled) changed.push(id);
    });
    Object.keys(prev).forEach(function (id) { if (!now[id] && !prev[id].hidden) gone.push(id); });
    if (changed.length + gone.length > 3) return;
    gone.forEach(function (id) { clearTimeout(ap.settle[id]); delete ap.settle[id]; apEvent({ type: 'gone', kind: 'clock', key: id }); });
    changed.forEach(function (id) {
      clearTimeout(ap.settle[id]);
      var me = S;
      ap.settle[id] = setTimeout(function () {
        if (S !== me || !me.ap) return;
        delete ap.settle[id];
        var c = tableClocks().filter(function (x) { return str(x.id) === id; })[0];
        apEvent({ type: 'clock', clockId: id, visible: !!c && !c.hidden });
      }, AP_SETTLE_MS);
    });
  }
  /* a subject the controller shows or holds is no longer one the players may see: a hidden clock, an NPC no longer revealed */
  function apSubjects() {
    var ap = S && S.ap; if (!ap) return;
    var st = ap.core.state(), items = [];
    if (st.showing) items.push({ kind: st.showing.kind, key: st.showing.key, showing: true });
    Object.keys(st.pending).forEach(function (k) { items.push({ kind: k, key: st.pending[k].key }); });
    items.forEach(function (x) {
      var ok = true;
      if (x.kind === 'npc') { var d = isObj(S.npcs) ? S.npcs[x.key] : null; ok = isObj(d) && d.revealed === true && (x.showing || staged(x.key)); }
      else if (x.kind === 'clock') { var c = tableClocks().filter(function (y) { return str(y.id) === x.key; })[0]; ok = !!c && !c.hidden; }
      if (!ok) apEvent({ type: 'gone', kind: x.kind, key: x.key });
    });
  }
  /* Voice's lines arrived for the NPC on stage: the page's own stage decides who (Voice's `who` is model text and is never looked up) */
  function apNpcSpoke() {
    var ap = S && S.ap; if (!ap) return;
    var who = npcList().filter(function (x) { return staged(x.id) && str(x.doc.name).replace(/\s+/g, ' ').trim(); })[0];
    if (!who) return;
    apEvent({ type: 'npc', npcId: who.id, staged: true, revealed: who.doc.revealed === true, portrait: isObj(who.doc.spec) && Object.keys(who.doc.spec).length > 0 });
  }
  /* the GM put something on the iPad (pushDisplay's success, or another page's b68:display): the controller's manualPush(kind) */
  function apPush(d, opts) {
    if (!S || !S.ap || !isObj(d)) return;
    var k = str(d.kind);
    if (k === 'svg') k = opts && opts.map ? 'live' : 'map';       /* a map on the iPad opens a live reveal: the 15 s guard */
    apEvent({ type: 'push', kind: k });
  }
  /* what the iPad showed when this page first read it: lights out and a rules entry are guards from the start (nothing else is news) */
  function apSeed(first, kind) { if (first && (kind === 'dark' || kind === 'rule')) apEvent({ type: 'push', kind: kind }); }
  /* names the players must not meet: hidden NPCs (name and alias) and hidden clocks. A text overlay naming one is refused (makeGate). */
  function hiddenSecretNames() {
    var out = [];
    if (S && isObj(S.npcs)) Object.keys(S.npcs).forEach(function (id) { var d = S.npcs[id]; if (isObj(d) && d.revealed !== true) { if (str(d.name).trim()) out.push(d.name); if (str(d.alias).trim()) out.push(d.alias); } });
    tableClocks().forEach(function (c) { if (c.hidden && str(c.name).trim()) out.push(c.name); });
    return out;
  }
  /* the heat / wanted sync: campaign(doc) feeds it (see makeCrewSync) */
  var crewSync = makeCrewSync({
    send: function (crew) { var g = (keptApi && keptApi.gm && keptApi.gm()) || (W.claude && W.claude.gm); if (!g || typeof g.patchAmbient !== 'function') return Promise.reject(new Error('the GM tools are not available')); return g.patchAmbient({ crew: crew }); },
    mode: function () { return AM.doc && isObj(AM.doc) ? AM.doc.mode : undefined; },
    delay: function (fn, ms) { return setTimeout(fn, ms); }, cancel: function (h) { clearTimeout(h); },
    toast: function (m) { toast(m, true); },
    sent: function (r) { if (adoptAmbient(r)) renderIpad(); }
  });
  function renderIpad() {
    var box = $q('#gm-ipad'); if (!box) return;
    var v = ipadView(AM.doc, function (id) { var c = tableClocks().filter(function (x) { return str(x.id) === id; })[0]; return c ? { name: c.name, size: c.size, filled: c.filled } : null; }), busy = AM.busy > 0, off = !AM.loaded;
    function seg(k, label) { return '<button type="button" class="chip" data-gm="ambmode" data-v="' + k + '" aria-pressed="' + (v.mode === k) + '"' + (off || busy ? ' disabled' : '') + '>' + label + '</button>'; }
    var h = '<section class="gm-box gm-ipad-now"><h3 class="gm-band">On the iPad now</h3><p class="gm-ipad-line" id="gm-ipad-now">' + (AM.shown ? esc(displayLine(AM.shown)) : '<span class="gm-dim">Not known yet: push something, or clear it.</span>') + '</p>' +
      (v.overlayLine ? '<p class="gm-ipad-line" id="gm-ipad-overlay">Overlay sent: ' + esc(v.overlayLine) + (v.auto ? ' · AUTO' : '') + '</p>' : '') +
      '<p class="gm-ipad-line" id="gm-ipad-ap" hidden>Autopilot: <b data-ap-badge></b> <button type="button" class="btn sm" data-gm="aptoggle"></button> ' +
      '<button type="button" class="btn sm" data-gm="apoff" title="Blade stops laying anything over the iPad until you switch it on">Switch off</button></p>' +
      '<div class="gm-ipad-acts"><button type="button" class="btn primary" data-gm="blankipad" title="Back to the ambient scene">Clear → ambient <kbd>0</kbd></button>' +
      '<button type="button" class="btn" data-gm="darkipad" title="True black until you push something">Lights out</button>' +
      '<button type="button" class="btn" data-gm="clearoverlay"' + (busy ? ' disabled' : '') + ' title="Take the overlay (a clock, an NPC, a line or the dawn) off the iPad; what is under it stays">Clear overlay</button></div></section>';
    h += '<section class="gm-box gm-ipad-amb"><h3 class="gm-band">Ambient scenes</h3><div class="gm-ipad-body">';
    if (!AM.loaded) h += '<p class="gm-dim" role="status">' + (AM.error ? 'Could not read the settings: ' + esc(AM.error) : 'Loading the iPad settings…') + '</p>' + (AM.error ? '<p><button type="button" class="btn sm" data-gm="ambretry">Try again</button></p>' : '');
    h += '<div class="gm-field"><span class="gm-lab">When nothing is spotlit</span><div class="seg" role="group" aria-label="Ambient mode">' + seg('off', 'Off') + seg('auto', 'Auto') + seg('pin', 'Pin') + '</div></div>' +
      '<div class="gm-field"><span class="gm-lab">Scene' + (v.mode === 'pin' ? '' : ' (tap one to pin it)') + '</span><div class="gm-ipad-tiles" role="group" aria-label="Scenes">' + v.tiles.map(function (s) {
        return '<button type="button" class="gm-ipad-tile" data-gm="ambscene" data-id="' + esc(s.id) + '" aria-pressed="' + s.pressed + '"' + (s.disabled || off || busy ? ' disabled' : '') + '><b>' + esc(s.label) + '</b>' + (s.note ? '<small>' + esc(s.note) + '</small>' : '') + '</button>';
      }).join('') + '</div></div>' +
      '<div class="gm-row"><label class="gm-field" for="gm-amb-int"><span class="gm-lab">Auto changes every</span><select id="gm-amb-int" data-ambint="1"' + (off || busy ? ' disabled' : '') + '>' + v.intervals.map(function (n) { return '<option value="' + n + '"' + (n === v.intervalMin ? ' selected' : '') + '>' + n + ' min</option>'; }).join('') + '</select></label>' +
      '<button type="button" class="btn" data-gm="ambskip"' + (off || busy || v.mode !== 'auto' ? ' disabled' : '') + ' title="Auto mode only">Next scene</button></div>' +
      '<p class="gm-dim gm-ipad-theme" id="gm-ipad-theme" role="status">' + esc(P.themeLine(THEME.state, THEME.http)) + '</p></div></section>';
    h += '<section class="gm-box gm-ipad-score"><h3 class="gm-band">Score scene</h3><div class="gm-ipad-body"><p class="gm-ipad-line" id="gm-ipad-score">' + (v.hasScore ? esc(v.scoreLine) : '<span class="gm-dim">None set. Use Set as score scene in the Location panel.</span>') + '</p>' +
      '<button type="button" class="btn sm" data-gm="clearscore"' + (!v.hasScore || off || busy ? ' disabled' : '') + '>Clear score</button></div></section>';
    box.innerHTML = '<div id="gm-stt"></div>' + h + handoutsHtml();
    renderStt(true);
    renderBar();
    probeTheme();
  }
  /* ---------- Handouts: the list in the iPad tab, and the Rack's "Show handout?" offer ---------- */
  function handouts() { return P.handoutList(part('handouts')); }
  function handoutById(id) { return handouts().filter(function (x) { return x.id === id; })[0] || null; }
  function handoutsHtml() {
    var list = handouts(), me = S, tt = !!(me && me.hoTitle);
    var h = '<section class="gm-box gm-ipad-handouts"><h3 class="gm-band">Handouts' + (list.length ? ' <span class="gm-dim">' + list.length + '</span>' : '') + '</h3><div class="gm-ipad-body">';
    if (!list.length) return h + '<p class="gm-dim">' + (part('handouts') ? 'The handouts part has nothing to show.' : 'No handouts in the pack. Put the prop images in the vault, run npm run gm:handouts and npm run gm:pack, then Update pack.') + '</p></div></section>';
    h += '<div class="gm-ipad-acts"><label class="gm-check"><input type="checkbox" data-hotitle="1"' + (tt ? ' checked' : '') + '> Title on the iPad</label>' +
      '<button type="button" class="btn sm" data-gm="blankipad" title="Back to the ambient scene">Clear iPad</button></div><ul class="gm-handouts">';
    list.forEach(function (x) {
      h += '<li class="gm-handout" data-ho="' + esc(x.id) + '"><img class="gm-handout-thumb" src="' + esc(P.HANDOUT_DIR + x.file) + '" alt="" loading="lazy" decoding="async" width="72" height="72">' +
        '<div class="gm-handout-t"><b>' + esc(x.title) + '</b>' + (x.when ? '<span class="gm-dim">' + esc(x.when) + '</span>' : '') +
        '<div class="gm-ipad-acts"><button type="button" class="btn sm primary" data-gm="ho-show" data-id="' + esc(x.id) + '">Show on iPad</button>' +
        '<button type="button" class="btn sm" data-gm="blankipad">Clear iPad</button></div></div></li>';
    });
    return h + '</ul></div></section>';
  }
  function showHandout(id) {
    var x = handoutById(id); if (!x) { toast('That handout is not in the pack any more.', true); return Promise.resolve(false); }
    return pushDisplay(P.handoutDisplay(x, !!(S && S.hoTitle))).then(function () { hoDone(x.id); toast('On the iPad: ' + x.title + '.'); return true; }, function (e) { toast('Could not send the handout: ' + errText(e), true); return false; });
  }
  /* handouts shown or dismissed tonight (kept 12 h in localStorage so a reload does not offer them again): the box's suggestions skip these */
  var HO_KEY = 'b68.gm.hodone', HO_TTL = 12 * 3600 * 1000;
  function hoRead() { try { var m = JSON.parse(W.localStorage.getItem(HO_KEY) || '{}'), out = {}, t = Date.now(); if (isObj(m)) Object.keys(m).forEach(function (k) { if (typeof m[k] === 'number' && t - m[k] < HO_TTL) out[k] = m[k]; }); return out; } catch (e) { return {}; } }
  function hoDone(id) { if (!S) return; S.hoSeen = S.hoSeen || hoRead(); S.hoSeen[id] = Date.now(); try { W.localStorage.setItem(HO_KEY, JSON.stringify(S.hoSeen)); } catch (e) {} }
  function hoIsDone(id) { if (!S) return false; S.hoSeen = S.hoSeen || hoRead(); return !!S.hoSeen[id]; }
  /* a tick answer's handout ({ id, why }): offered in the Rack once; not again while the offer is up, or after it was shown or dismissed tonight */
  function offerHandoutFromBox(h) {
    if (!S || !isObj(h) || typeof h.id !== 'string') return false;
    if (hoIsDone(h.id) || (S.offers || []).some(function (y) { return y.id === h.id; })) return false;
    return suggestHandout(h.id, h.why);
  }
  /* Claude suggests: a "Show handout: <title>?" item in the Rack (the Mystery keeper's tick answer reaches it through offerHandoutFromBox). One offer per handout; a repeat replaces it. */
  function suggestHandout(id, why) {
    var x = S && handoutById(String(id)); if (!x) return false;
    var o = { id: x.id, title: x.title, why: str(why).trim().slice(0, 300) };
    S.offers = (S.offers || []).filter(function (y) { return y.id !== x.id; }).concat([o]).slice(-3);
    renderRack(); return true;
  }
  function dropOffer(id) { if (S && S.offers) { S.offers = S.offers.filter(function (y) { return y.id !== id; }); renderRack(); } }
  /* ---------- Blade suggests: Stall, Meanwhile, handout offers and Screen items are cards in the box (P4; design 3.6 and D6) ----------
     The page keeps the state it always kept (S.stall, S.meanwhile, S.offers, S.screenItems, the ambient wire) and the handlers that act on it.
     syncCards() shows that state as idea cards in the box (ctl.addCard / updateCard / removeCard), and runs from renderRack, so every place that
     changed the state and called renderRack still works. A card's buttons call the SAME functions the Rack's did (showHandout, screenShow with its
     gatekeeper verdict and confirm, screenAdd, wireClear): there is no second path to the iPad, and the panel sends nothing itself. Got it is the
     card's Clear / Dismiss and runs the page's own work (hoDone for a handout, dropping the state). The Rack keeps the Fixer and Voice only. */
  function sentences(t) { var m = str(t).replace(/\s+/g, ' ').trim().match(/[^.!?]+(?:[.!?]+["')\]]*|$)\s*/g) || []; return m.map(function (x) { return x.trim(); }).filter(Boolean); }
  function stallSpec(st) {
    var sp = { kind: 'idea', seat: 'stall', headline: st.offer, bullets: st.why ? [st.why] : [], chips: [{ text: st.kind }], ackLabel: 'Clear', onAck: function () { if (S) S.stall = null; } };
    if (st.offer.length > 140) sp.more = st.offer;
    return sp;
  }
  function meanwhileSpec(m) {
    var ss = sentences(m.cutaway), first = ss[0] || m.cutaway, rest = ss.slice(1);
    var tick = m.clock ? 'Clock: ' + m.clock + ' · suggest ' + (m.ticks ? '+' + m.ticks + ' (your call)' : 'no tick') + (m.why ? ' · ' + m.why : '') : '';
    var room = tick ? 3 : 4, bl = rest.slice(0, room); if (tick) bl.push(tick);
    var sp = { kind: 'idea', seat: 'meanwhile', headline: first, bullets: bl, chips: [{ text: m.faction || 'a faction' }], ackLabel: 'Clear', onAck: function () { if (S) S.meanwhile = null; } };
    if (first.length > 140 || rest.length > room) sp.more = m.cutaway;
    return sp;
  }
  function offerSpec(o) {
    return { kind: 'idea', seat: 'handout', headline: 'Show handout: ' + o.title + '?', bullets: o.why ? [o.why] : [], open: true, ackLabel: 'Dismiss',
      actions: [{ id: 'show', label: 'Show', primary: true, title: 'Puts it on the iPad', run: function () { return showHandout(o.id).then(function (ok) { if (ok) dropOffer(o.id); }); } }],
      onAck: function () { hoDone(o.id); if (S && S.offers) S.offers = S.offers.filter(function (y) { return y.id !== o.id; }); } };
  }
  function screenSpec(it) {
    var id = it.id, port = it.kind === 'portrait', wire = it.kind === 'wire';
    var head = port ? 'Portrait: ' + (it.name || 'Unnamed') : wire ? 'Wire: ' + str(it.text).replace(/\s+/g, ' ').trim() : (SC_LABEL[it.kind] || it.kind) + (it.title ? ': ' + it.title : '');
    var chips = [gateChip(it)], bullets = [], actions = [];
    if (port && it.notes && it.notes.length) bullets.push(it.notes.join('; '));
    var notes = bullets.slice(), all = notes.concat(gateBullets(it, true));
    bullets = bullets.concat(gateBullets(it));
    if (port) {
      if (it.added) { chips.push({ text: 'Saved (hidden)', tone: 'ok' }); bullets.push('Saved as a hidden NPC. Reveal it from the cast when you want it shown.'); }
      else actions.push({ id: 'add', label: 'Add (hidden NPC)', primary: true, title: 'Saves a hidden NPC; nothing is shown', run: function () { return screenAdd(id); } });
    } else if (wire && it.shown) actions.push({ id: 'wireclear', label: 'Clear from the iPad', run: function () { return wireClear(id); } });
    else {
      actions.push({ id: 'show', label: 'Show' + (wire ? ' on the wire' : ' on iPad'), primary: true, disabled: it.status !== 'ready', run: function () { return screenShow(id); } });
      if (it.shown && !wire) chips.push({ text: 'On the iPad', tone: 'ok' });
    }
    var sp = { kind: 'idea', seat: 'screen', headline: head, chips: chips, bullets: bullets.slice(0, 5), actions: actions, open: true, ackLabel: 'Dismiss',
      body: port ? str(it.description) : str(it.text), bodyLabel: port ? 'Description' : wire ? 'Wire bulletin' : 'Will show on the iPad',
      onAck: function () { if (S && S.screenItems) S.screenItems = S.screenItems.filter(function (x) { return x.id !== id; }); } };
    if (all.length > 5 || all.some(function (x) { return x.length > 160; })) sp.more = all.map(function (x) { return '- ' + x; }).join('\n');      /* the card cuts a long verdict: the whole of it is under More, the GM's decision needs every line */
    if (port && it.svg) { sp.figKey = id + '|' + it.svg.length; sp.figure = function () { var d = W.document.createElement('div'); d.className = 'gm-screen-fig'; d.innerHTML = it.svg; return d; }; }   /* the figure kit's own drawing of the cleaned spec; it escapes its text */
    else { sp.figKey = ''; sp.figure = null; }
    return sp;
  }
  /* what is on the iPad's wire now: one card (Clear per bulletin), so a bulletin from an earlier load can still be taken off */
  function wireSig(w) { return JSON.stringify(w.map(function (x) { return [x.id, x.text]; })); }
  function wireSpec(w) {
    return { kind: 'note', seat: 'screen', headline: 'Wire on the iPad: ' + w.length + ' of 6', body: w.map(function (x, i) { return (i + 1) + '. ' + x.text; }).join('\n'), bodyLabel: 'On the wire', open: true, ackLabel: 'Hide',
      actions: w.map(function (x, i) { return { id: 'wc' + i, label: 'Clear ' + (i + 1), title: x.text.slice(0, 100), run: function () { return wireClear(x.id); } }; }),
      onAck: function () { if (S) S.wireAck = wireSig(w); } };
  }
  function syncCards() {
    var ctl = S && S.assist; if (!S || !ctl || typeof ctl.addCard !== 'function') return;
    if (S.pcCtl !== ctl) { S.pc = {}; S.pcCtl = ctl; }
    var pc = S.pc, want = {};
    if (S.stall) want.stall = { idn: S.stall.at + '|' + S.stall.offer, spec: stallSpec(S.stall) };
    if (S.meanwhile) want.meanwhile = { idn: S.meanwhile.at + '|' + S.meanwhile.cutaway, spec: meanwhileSpec(S.meanwhile) };
    (S.offers || []).forEach(function (o) { want['offer|' + o.id] = { idn: o.id + '|' + o.why, spec: offerSpec(o) }; });
    (S.screenItems || []).forEach(function (it) { want['sc|' + it.id] = { idn: it.id, spec: screenSpec(it) }; });
    var wl = wireList(); if (wl.length && S.wireAck !== wireSig(wl)) want.wire = { idn: 'wire', spec: wireSpec(wl) };
    Object.keys(pc).forEach(function (k) { if (!want[k]) { ctl.removeCard(pc[k].id); delete pc[k]; } });
    Object.keys(want).forEach(function (k) {
      var x = want[k], sig = JSON.stringify(x.spec), cur = pc[k];
      if (cur && cur.idn !== x.idn) { ctl.removeCard(cur.id); cur = null; delete pc[k]; }      /* a new offer in place of the last one is a new arrival, not an edit */
      if (cur && cur.sig !== sig) { if (ctl.updateCard(cur.id, x.spec)) cur.sig = sig; else { cur = null; delete pc[k]; } }
      if (!cur) { var id = ctl.addCard(x.spec); if (id) pc[k] = { id: id, idn: x.idn, sig: sig }; }
    });
  }
  /* is app/media/theme.mp3 on the server? asked once a minute at most, on the hosted app only; the answer goes into the panel's line */
  function probeTheme() {
    if (THEME.busy || Date.now() - THEME.at < 60000 || typeof W.fetch !== 'function' || !gmApi()) return;
    THEME.busy = true;
    var me = S;
    Promise.resolve().then(function () { return W.fetch(P.THEME_URL, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' }); }).then(function (r) {
      THEME.state = r && r.ok && P.themeType(r.headers && r.headers.get ? r.headers.get('Content-Type') : '') ? 'ok' : 'none'; THEME.http = r ? r.status : 0; THEME.at = Date.now();
    }, function () { THEME.state = 'unknown'; THEME.http = 0; THEME.at = Date.now() - 50000; /* ask again soon */ }).then(function () {
      THEME.busy = false;
      var p = S === me ? $q('#gm-ipad-theme') : null;
      if (p) p.textContent = P.themeLine(THEME.state, THEME.http);
    });
  }

  /* ---------- Listening: the table iPad's transcriber (app/stt.js, GM.md "Listening") ----------
     GET/PATCH /api/gm/stt: want on | off, the session, speaker names, and the iPad's own report; the newest lines from
     GET /api/gm/transcript?tail=. Read every 5 s while the iPad panel is open. The vault copy is the PC's job
     (the background copier, npm run gm:transcript -- --install; GM.md "Listening"). */
  var STT = { doc: null, tail: [], error: '', loaded: false, at: null };   /* at: when the document was last written (null: never set up) */
  var STT_LABEL = { idle: 'Not listening', starting: 'Starting…', listening: 'Listening', reconnecting: 'Reconnecting…', stopped: 'Stopped', error: 'Stopped by an error' };
  function loadStt() {
    var g = gmApi(); if (!g || typeof g.stt !== 'function') return;
    Promise.all([g.stt(), g.transcript({ tail: 8 }).then(function (r) { return r; }, function () { return null; })]).then(function (res) {
      STT.doc = res[0] && res[0].doc || null; STT.at = res[0] && res[0].updatedAt || null; STT.tail = res[1] && Array.isArray(res[1].lines) ? res[1].lines : STT.tail; STT.error = ''; STT.loaded = true; renderStt(); renderBar();
    }, function (e) { STT.error = errText(e); STT.loaded = true; renderStt(); renderBar(); });
  }
  function sttPatch(p) {
    var g = gmApi(); if (!g || typeof g.patchStt !== 'function') { toast('Listening needs the hosted app.', true); return; }
    Promise.resolve().then(function () { return g.patchStt(p); }).then(function (r) { STT.doc = r && r.doc || STT.doc; STT.at = r && r.updatedAt || STT.at || nowIso(); renderStt(true); renderBar(); }, function (e) { toast('Could not change listening: ' + errText(e), true); });
  }
  function sttName(doc, sp) { var n = doc && isObj(doc.speakers) ? doc.speakers[String(sp)] : ''; return sp === null || sp === undefined ? '?' : n || 'S' + sp; }
  function renderStt(force) {
    var box = $q('#gm-stt'); if (!box) return;
    var act = document.activeElement;
    if (!force && act && box.contains(act) && act.hasAttribute && act.hasAttribute('data-sttspk')) return;   /* not while a name is being typed */
    var d = STT.doc || { want: 'off', speakers: {}, status: { state: 'idle' } }, st = isObj(d.status) ? d.status : { state: 'idle' }, on = d.want === 'on';
    var age = st.at ? Math.max(0, Math.round((Date.now() - Date.parse(st.at)) / 1000)) : null;
    var line = !STT.loaded ? 'Loading…' : STT.error ? 'Could not read listening: ' + STT.error
      : on && (st.state === 'idle' || st.state === 'stopped' || st.state === 'error') ? 'Waiting for the iPad: tap “Tap to start listening” on it.'
      : (STT_LABEL[st.state] || st.state) + (st.lines ? ' · ' + st.lines + ' lines sent' : '') + (age !== null ? ' · ' + (age < 60 ? age + ' s' : Math.round(age / 60) + ' min') + ' ago' : '');
    var stale = on && st.state === 'listening' && age !== null && age > 40;
    var seen = STT.tail.reduce(function (m, l) { return typeof l.speaker === 'number' && l.speaker > m ? l.speaker : m; }, -1);
    var nums = []; for (var i = 0; i <= Math.max(4, seen, Math.max.apply(null, Object.keys(isObj(d.speakers) ? d.speakers : {}).map(Number).concat([-1]))); i++) nums.push(i);
    box.innerHTML = '<section class="gm-box gm-stt"><h3 class="gm-band">Listening' + (on ? ' <span class="gm-stt-on">● on</span>' : '') + '</h3><div class="gm-ipad-body">' +
      '<p class="gm-ipad-line' + (stale || st.state === 'error' ? ' bad' : '') + '" role="status">' + esc(line) + (stale ? ' No word from the iPad for a while: is the display open?' : '') + '</p>' +
      (st.error && st.state !== 'listening' ? '<p class="gm-note bad">' + esc(st.error) + '</p>' : '') +
      '<div class="gm-ipad-acts">' + (on ? '<button type="button" class="btn" data-gm="stt-off">Stop listening</button>'
        : '<button type="button" class="btn primary" data-gm="stt-on" title="The iPad shows a button: tap it once to open the mic">Start listening</button>') + '</div>' +
      '<details class="gm-fold" data-sttfold="1"' + ((STT.fold === undefined ? on : STT.fold) ? ' open' : '') + '><summary>Who is who</summary><div class="gm-stt-spk">' + nums.map(function (n) {
        return '<label class="gm-field" for="gm-stt-s' + n + '"><span class="gm-lab">S' + n + '</span><input type="text" id="gm-stt-s' + n + '" data-sttspk="' + n + '" maxlength="60" autocomplete="off" placeholder="Name (Character)" value="' + esc(isObj(d.speakers) ? d.speakers[String(n)] || '' : '') + '"></label>';
      }).join('') + '</div><p class="gm-dim">Numbers are Deepgram’s guesses and restart after a reconnect. Names apply to lines the PC copies from now on. Tap a name in the lines below to set it.</p></details>' +
      (STT.tail.length ? '<ol class="gm-stt-tail">' + STT.tail.map(function (l) {
        return '<li>' + (l.kind === 'mark' ? '<i>— ' + esc(l.text || 'reconnected') + ' —</i>' : (typeof l.speaker === 'number' ? '<button type="button" class="gm-lab gm-stt-who" data-gm="stt-name" data-sp="' + l.speaker + '" title="Name this speaker">' + esc(sttName(d, l.speaker)) + '</button>' : '<span class="gm-lab">' + esc(sttName(d, l.speaker)) + '</span>') + ' ' + esc(l.text)) + '</li>';
      }).join('') + '</ol>' : '') +
      sttCopier(d, on) + '</div></section>';
  }
  /* the PC's heartbeat: fresh within 3 minutes while listening is on */
  function sttCopier(d, on) {
    var at = isObj(d.copier) && d.copier.at ? Date.parse(d.copier.at) : NaN;
    var age = isNaN(at) ? null : Math.max(0, Math.round((Date.now() - at) / 1000));
    if (on && age !== null && age < 180) return '<p class="gm-dim gm-stt-pc" role="status">Into the vault: the PC is copying (' + (age < 60 ? age + ' s' : Math.round(age / 60) + ' min') + ' ago).</p>';
    if (on && STT.loaded && !STT.error) return '<p class="gm-note gm-stt-pc" role="status">Into the vault: waiting for the PC (it looks once a minute). Lines keep on the server till then; if this stays, is the PC on and awake?</p>';
    return '<p class="gm-dim gm-stt-pc">Into the vault: the PC copies new lines by itself while listening is on.</p>';
  }
  function setScoreScene() {
    if (!S || !S.locRoll) { toast('Roll a location first.', true); return; }
    var built;
    try { built = scoreScene(S.locRoll, mapUi(), W.B68Map && W.B68Map.render); } catch (e) { toast(errText(e), true); return; }
    if (!confirmReveal(built.reveal, 'This score scene')) return;
    gate.mark(built.board); gate.mark(built.iso);
    patchAmbient({ score: built.score }).then(function (r) {
      if (r) toast(built.rings ? 'Score scene set. The plan would name a hidden room, so the board uses rings.' : 'Score scene set: ' + built.score.name + '.');
    });
  }
  function save(name, data) { if (S.api && S.api.saveFile) S.api.saveFile(name, data); }

  var SIDE = ['prep', 'location', 'scenes', 'score', 'chase', 'npc', 'downtime', 'cards', 'rules', 'ipad'];
  /* ---------- the street scene roller (S): a side panel ---------- */
  function genLinesHtml(lines) {
    return (lines || []).map(function (l) { return l.kind === 'chips' ? chipsHtml(l.chips) : linesHtml([l], md); }).join('');
  }
  function earlierHtml(tool, cur) {
    var hist = newest(isObj(S.doc.hist) ? S.doc.hist[tool] : null).slice(0, LIMITS.hist);
    return hist.length ? '<div class="gm-earlier"><span class="gm-lab">Earlier:</span>' + hist.map(function (x) { return earlierChip(x, tool, cur && cur.hid === x._id); }).join('') + '</div>' : '';
  }
  function selectHtml(id, attr, key, label, options, value, inner) {
    return '<label class="gm-field" for="' + id + '"><span class="gm-lab">' + esc(label) + '</span><select id="' + id + '" ' + attr + '="' + esc(key) + '">' + (inner != null ? inner : options.map(function (o) {
      return '<option value="' + esc(o.value) + '"' + (str(o.value) === str(value) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('')) + '</select></label>';
  }

  function scnInst() {
    if (S.scn) return S.scn;
    var M = W.B68GmScenes, pk = part('scenes');
    if (!M) { S.scnErr = 'The street scene module is missing.'; return null; }
    if (!pk || !isObj(pk.T)) { S.scnErr = 'The pack has no scenes part. Update the pack.'; return null; }
    try { S.scn = M.create({ T: pk.T }); S.scnErr = ''; } catch (e) { S.scnErr = 'The street scenes could not start: ' + errText(e); }
    return S.scn;
  }
  function scnUi() { var sc = scnInst(), u = Object.assign(sc ? sc.defaults() : {}, uiOf('scn')); if (sc) u.sel = distFor('scn'); return u; }
  function replayScenes(e) {
    var sc = scnInst(); if (!sc || !isObj(e)) return null;
    var mem = {}; try { mem = JSON.parse(e.mem || '{}'); } catch (x) {}
    try { return sc.roll(e.ui || {}, { seed: e.seed, mem: mem }); } catch (x) { return null; }
  }
  function rollScenes() {
    var sc = scnInst(); if (!sc) { renderScenes(); return; }
    var ui = scnUi(), before = JSON.stringify(S.scnMem), roll;
    try { roll = sc.roll(ui, { mem: S.scnMem }); } catch (e) { toast('The street scene failed: ' + errText(e), true); return; }
    var entry = { seed: roll.seed, ui: ui, mem: before, label: str(roll.meta.label), at: nowIso() };
    var hid = uid('h'), hist = isObj(S.doc.hist) && isObj(S.doc.hist.scenes) ? S.doc.hist.scenes : {};
    patch({ cards: { scenes: Object.assign({ hid: hid }, entry) }, mem: { scenes: clone(S.scnMem) }, hist: { scenes: addCapped(hist, hid, entry, LIMITS.hist) } }, { force: true });
    S.scnRoll = roll; S.last = { text: 'Street scene: ' + entry.label };
    renderScenes(true);
  }
  function renderScenes(fresh) {
    var box = $q('#gm-scn'); if (!box) return;
    var sc = scnInst();
    if (!sc) { box.innerHTML = '<p class="gm-note bad">' + esc(S.scnErr || 'The street scenes are not available.') + '</p>'; return; }
    var cur = isObj(S.doc.cards) ? S.doc.cards.scenes : null;
    if (!fresh && cur && (!S.scnRoll || S.scnRoll.seed !== cur.seed)) S.scnRoll = replayScenes(cur);
    var ui = scnUi(), roll = S.scnRoll;
    var h = '<div class="gm-loc-ctl">' + sc.controls.map(function (x) { return selectHtml('gm-s-' + x.id, 'data-scn', x.id, x.label, x.options, ui[x.id], x.id === 'sel' ? distOptionsHtml('scn') : null); }).join('') +
      '<button type="button" class="btn primary gm-roll" data-gm="scnroll">Roll a street scene</button></div>';
    if (roll) {
      var m = roll.meta;
      h += '<article class="gm-card gm-scncard" data-tool="scenes"><header class="gm-card-h"><div><h3>' + esc(m.title) + '</h3><p class="gm-sub">' + esc(m.sub) + '</p></div></header>' + genLinesHtml(roll.lines) +
        '<div class="gm-card-acts"><button type="button" class="btn sm" data-gm="pin" data-tool="scenes">Pin</button><button type="button" class="btn sm" data-gm="copy" data-tool="scenes">Copy</button>' +
        '<button type="button" class="btn sm" data-gm="scnipad" title="Only the three read-aloud paragraphs go to the iPad">Read-aloud to the iPad</button></div></article>';
    } else h += '<p class="gm-empty">Pick a district, or leave it on anywhere, and roll. The grid under the read-aloud is for you, not the table.</p>';
    box.innerHTML = h + earlierHtml('scenes', cur);
  }
  /* what the crew could see and hear: the three read-aloud paragraphs, never the notable, the rumour or the rule */
  function scenesToIpad() {
    var r = S.scnRoll; if (!r) return;
    var read = r.lines.filter(function (l) { return l.kind === 'read'; }).map(function (l) { return plainMd(l.md); });
    pushDisplay({ kind: 'text', title: plainMd(r.meta.title).slice(0, 2000), caption: plainMd(r.meta.sub).slice(0, 2000), text: read.join('\n\n').slice(0, 2000) })
      .then(function () { toast('On the iPad: ' + plainMd(r.meta.title) + '.'); }, function (e) { toast('Could not send to the iPad: ' + errText(e), true); });
  }

  /* ---------- Score (J): the outline of a heist, rolled for inspiration (app/gm/score.js; GM.md "Score (J)") ----------
     For the GM only: nothing in this section goes to the iPad (the Cards panel is the one road to the players, through its own Show
     buttons). The instance is built once per start() from the pack's `score` part and its campaign part. The panel's choices are GM
     state `sc: { ui }` (client, who (the NPC who asks, as this page resolved them when they were picked), target, job, district, crew,
     tier). A card is `cards.score` { hid, seed, ui, mem (JSON: the repeat guard BEFORE the roll), bump, label, at, started? } (five
     in hist.score; the live guard is mem.score), so a reload or an Earlier click redraws the same card. A reroll (the small ↻ on a
     row) keeps the card's seed, memory and choices, raises one section's bump and replaces the card and its Earlier entry in place;
     a clock the card started stays under `started`, by name. The crew is the live campaign document's (type, Tier), else the pack's
     crew sheet, unless the GM picks another in the panel. */
  function scAvail() { var pk = part('score'); return !!(W.B68GmScore && pk && isObj(pk.T)); }
  function scInst() {
    if (S.sc) return S.sc;
    var M = W.B68GmScore, pk = part('score');
    if (!M) { S.scErr = 'The score generator module is missing.'; return null; }
    if (!pk || !isObj(pk.T)) { S.scErr = 'The pack has no score part. Update the pack.'; return null; }
    try { S.sc = M.create({ T: pk.T, campaign: part('campaign') || {} }); S.scErr = ''; } catch (e) { S.scErr = 'The score generator could not start: ' + errText(e); }
    return S.sc;
  }
  function scCard() { return isObj(S.doc.cards) && isObj(S.doc.cards.score) ? S.doc.cards.score : null; }
  function scHist() { return isObj(S.doc.hist) && isObj(S.doc.hist.score) ? S.doc.hist.score : {}; }
  function scSig(c) { return isObj(c) ? JSON.stringify([c.hid, c.seed, c.ui, c.bump]) : null; }
  function scReplayOf(e) {
    var mem = {}; try { mem = JSON.parse(e.mem || '{}'); } catch (x) {}
    return { seed: e.seed, mem: isObj(mem) ? mem : {}, ui: isObj(e.ui) ? e.ui : {}, bump: isObj(e.bump) ? e.bump : {} };
  }
  function replayScore(e) {
    var g = scInst(); if (!g || !isObj(e)) return null;
    try { return g.replay(scReplayOf(e)); } catch (x) { return null; }
  }
  /* the crew the table has: the live campaign document's type and Tier first, then the pack's crew sheet; its enemies and abilities are the sheet's */
  function scCrew() {
    var live = isObj(camp) && isObj(camp.crew) ? camp.crew : null, sheet = (part('campaign') || {}).crew;
    sheet = isObj(sheet) ? sheet : {};
    var num = function (v) { return typeof v === 'number' && isFinite(v); }, t = live && num(live.tier) ? live.tier : num(sheet.tier) ? sheet.tier : 0;
    return { type: str(live && live.type).trim() || str(sheet.type).trim(), tier: Math.max(0, Math.min(6, Math.round(t))),
      enemies: Array.isArray(sheet.enemies) ? sheet.enemies : [], abilities: Array.isArray(sheet.abilities) ? sheet.abilities : [] };
  }
  /* Now in as the score tables spell it ('' while it is anywhere, or not a district they hold), and what the Where picker says of it */
  function scNowIn() { var T = scAvail() ? part('score').T : {}; return nowIn(T.loc && Array.isArray(T.loc.district) ? T.loc.district.map(str) : []); }
  function scNowLabel() { var now = nowDistrict(); return !now ? '' : scNowIn() || 'any (no ' + now + ' here)'; }
  /* the NPC who asks, as a score keeps them: strings, so a replay never depends on a list that changed */
  function scWho(n) { return { name: str(n.name).slice(0, 120), faction: str(n.faction).slice(0, 120), district: str(n.district).slice(0, 120), role: str(n.role).slice(0, 160), want: str(n.want).slice(0, 300) }; }
  function scFromRoll(o) { return { key: 'roll-' + slug(o.name), name: str(o.name), faction: str(o.faction), district: str(o.district), role: str(o.profession), want: str(o.goal) }; }
  /* a cast NPC: what the cast doc says, filled in from the pack's campaign NPCs and the last NPC roll when they have the same name */
  function scFromDoc(id, d) {
    var nm = str(d.name).trim(), same = function (n) { return isObj(n) && str(n.name).trim().toLowerCase() === nm.toLowerCase(); };
    var pk = (Array.isArray((part('campaign') || {}).npcs) ? part('campaign').npcs : []).filter(same)[0] || {}, rn = S.npcRoll && S.npcRoll.roll && same(S.npcRoll.roll.npc) ? S.npcRoll.roll.npc : {};
    return { key: 'app-' + id, name: nm, faction: str(d.faction).trim() || str(pk.faction).trim() || str(rn.faction), district: str(pk.district).trim() || str(rn.district),
      role: str(d.role).trim() || str(pk.role).trim() || str(rn.profession), want: str(rn.goal) };
  }
  /* the NPCs the Who's asking picker offers, each once: on stage, the last NPC roll, the cast, then the campaign's own */
  function scNpcs() {
    var out = [], seen = {}, add = function (n, group) { var k = str(n.name).trim().toLowerCase(); if (!k || seen[k]) return; seen[k] = true; out.push(Object.assign({ group: group }, n)); };
    npcList().forEach(function (x) { if (staged(x.id)) add(scFromDoc(x.id, x.doc), 'On stage'); });
    var rn = S.npcRoll && S.npcRoll.roll && S.npcRoll.roll.npc; if (rn) add(scFromRoll(rn), 'Last NPC roll');
    npcList().forEach(function (x) { add(scFromDoc(x.id, x.doc), 'The cast'); });
    (Array.isArray((part('campaign') || {}).npcs) ? part('campaign').npcs : []).forEach(function (n) {
      if (isObj(n)) add({ key: 'pack-' + slug(n.name), name: n.name, faction: n.faction, district: n.district, role: n.role, want: '' }, 'Campaign NPCs');
    });
    var u = uiOf('sc');      /* the NPC picked earlier, who is in none of the lists now, stays pickable */
    if (str(u.client).indexOf('npc:') === 0 && isObj(u.who) && str(u.who.name).trim() && !out.some(function (n) { return 'npc:' + n.key === u.client; })) out.unshift(Object.assign({ key: str(u.client).slice(4), group: 'Picked' }, scWho(u.who)));
    return out;
  }
  function scCtx() { var c = scCrew(); return { crew: { type: c.type, tier: c.tier, enemies: c.enemies, abilities: c.abilities }, npcs: scNpcs(), nowIn: scNowLabel() }; }
  function scCtxSig(ctx) { return JSON.stringify([ctx.crew.type, ctx.crew.tier, ctx.nowIn, ctx.npcs.map(function (n) { return [n.key, n.group, n.name, n.faction, n.role]; })]); }
  /* the panel's choices as the selects show them (what the tables hold) */
  function scPanelUi() {
    var g = scInst(), u = uiOf('sc'); if (!g) return {};
    var c = g.cleanUi({ client: u.client, who: u.who, target: u.target, job: u.job, district: u.district, crew: u.crew, tier: u.tier });
    return { client: c.client, target: c.target, job: c.job, district: c.district, crew: c.crew, tier: c.tier === '' ? '' : String(c.tier) };
  }
  /* what a roll reads: the panel's choices with the crew and its Tier resolved, and Now in as the tables spell it */
  function scRollUi() {
    var g = scInst(), u = uiOf('sc'), c = scCrew(), k = g.cleanUi({ crew: u.crew, tier: u.tier });
    return { client: str(u.client), who: isObj(u.who) ? u.who : null, target: str(u.target), job: str(u.job), district: str(u.district),
      crew: k.crew || c.type, tier: k.tier === '' ? c.tier : k.tier, nowIn: scNowIn() };
  }
  function scEntry(roll) {
    var e = { seed: roll.seed, ui: clone(roll.replay.ui), mem: JSON.stringify(roll.replay.mem), label: str(roll.card.meta.label), at: nowIso() };
    if (Object.keys(roll.replay.bump).length) e.bump = clone(roll.replay.bump);
    return e;
  }
  function rollScore() {
    var g = scInst(); if (!g) { renderScore(); return; }
    var roll;
    try { roll = g.roll({ mem: S.scMem, ui: scRollUi() }); } catch (e) { toast('The score roll failed: ' + errText(e), true); return; }
    var entry = scEntry(roll), hid = uid('h'), card = Object.assign({ hid: hid }, entry);
    /* the new card REPLACES the stored one: nothing of the old (a clock it started) carries over */
    var ok = patch({ cards: { score: replacePatch(scCard(), card) }, mem: { score: clone(S.scMem) }, hist: { score: addCapped(scHist(), hid, entry, LIMITS.hist) } }, { force: true });
    if (!ok) return;
    S.scRoll = roll; S.scSig = scSig(card); S.last = { text: 'Score: ' + entry.label };
    renderScore(true);
    showIn($q('#gm-score-card'), $q('#gm-score'), ['.gm-want', '.gm-card-h']);
  }
  function scLatest(hid) { var n = newest(scHist())[0]; return !!n && n._id === hid; }
  /* ↻ on a row: the same card with one section rolled again (its seed, memory and choices stay; the bump and the label change, in the
     card and in its Earlier entry). The live repeat guard takes the reroll's picks when this is the newest card. */
  function scBump(row) {
    var g = scInst(), cur = scCard(); if (!g || !cur) return;
    var res;
    try { res = g.reroll(scReplayOf(cur), row); } catch (e) { toast('That row could not be rolled again: ' + errText(e), true); return; }
    var label = str(res.card.meta.label), old = scHist()[cur.hid], p = { cards: { score: { bump: replacePatch(cur.bump, res.replay.bump), label: label } } };
    if (isObj(old)) { p.hist = { score: {} }; p.hist.score[cur.hid] = { bump: replacePatch(old.bump, res.replay.bump), label: label }; }
    if (scLatest(cur.hid)) { S.scMem = clone(res.memAfter); p.mem = { score: clone(S.scMem) }; }
    if (!patch(p, { force: true })) return;
    S.scRoll = res; S.scSig = scSig(scCard()); S.last = { text: 'Score: ' + label };
    renderScore(true);
  }
  /* To Cards: the planning meeting's index card, onto the Cards panel (shown to the players only from there, by its own buttons) */
  function scToCards() {
    var r = S.scRoll, M = W.B68GmScore; if (!r || !M) return;
    var list = oppList();
    if (list.length >= OPP_MAX) { toast('The Cards panel holds ' + OPP_MAX + ' cards already: remove one there first.', true); return; }
    var e = M.cardEntry(r.score), id = uid('o'), x = {};
    x[id] = { from: e.from, client: e.client, target: e.target, type: e.type, note: e.note, payout: e.payout, order: list.length ? (+list[list.length - 1].order || 0) + 1 : 1, at: nowIso() };
    if (!patch({ opps: { list: x } })) return;
    renderCards(true);
    toast('On the Cards panel: ' + [e.type, e.target].filter(Boolean).join(' · ') + '. Show it from there.');
  }
  /* Roll the site: the Location pickers from the score (the way Score sites does it), then a roll there */
  function scRollSite() {
    var r = S.scRoll, M = W.B68GmScore, L = W.B68GmLocation, pk = part('location'); if (!r || !M) return;
    if (!L || !pk) { toast('The location generator is not available.', true); return; }
    var x; try { x = siteUi(L.controls(pk).controls, M.siteHints(r.score)); } catch (e) { x = { ui: {}, missed: [] }; }
    patch({ loc: { ui: x.ui } });
    showPanel('location');
    rollLocation();
    if (x.missed.length) toast('Not in the generator, so rolled on any: ' + x.missed.map(function (m) { return m[0] + ' “' + m[1] + '”'; }).join(', ') + '.', true);
  }
  /* A face: the NPC pickers from the score (the client's faction, or the target's when nobody asks, and the district) */
  function scFace() {
    var r = S.scRoll, M = W.B68GmScore, g = npcgInst(); if (!r || !M) return;
    if (!g) { toast('The NPC generator is not available.', true); return; }
    var h = M.npcHints(r.score), ui = g.cleanUi({ faction: h.faction, district: h.district });
    if (!ui.district) ui.district = NOW_ANY;        /* not a district the NPC tables hold: any, not whatever Now in is */
    patch({ npc: { ui: ui } });
    showPanel('npc'); renderNpcGen();
    var got = [ui.faction, ui.district !== NOW_ANY ? ui.district : ''].filter(Boolean);
    toast(got.length ? 'For a face: ' + got.join(', ') + '. Change either before you roll.' : 'The NPC tables hold neither the faction nor the district of this score: rolling on any.');
  }
  /* Start the clock: onto the table's clocks, hidden, a danger clock (as Downtime does it); the card keeps its id under `started` by name */
  function scClock() {
    var cur = scCard(), r = S.scRoll, M = W.B68GmScore; if (!cur || !r || !M) return;
    var ck = M.clockOf(r.score), name = str(ck.name), hid = cur.hid, key = hid + '|' + name, me = S;
    if (!name || (isObj(cur.started) && Object.prototype.hasOwnProperty.call(cur.started, name)) || S.scBusy[key]) return;
    if (!S.api || typeof S.api.addClock !== 'function') { toast('The table is not available here: start the clock on the table page.', true); return; }
    var clock = { id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: name, size: +ck.size || 4, filled: 0, kind: 'danger', hidden: true };
    S.scBusy[key] = true;
    var b = $q('#gm-score [data-gm="scoreclock"]'); if (b) b.disabled = true;
    Promise.resolve().then(function () { return S.api.addClock(clock); }).then(function () {
      delete me.scBusy[key]; if (S !== me) return;
      var st = {}, p = {}; st[name] = clock.id;
      var c = scCard(); if (c && c.hid === hid) p.cards = { score: { started: st } };
      if (isObj(scHist()[hid])) { p.hist = { score: {} }; p.hist.score[hid] = { started: clone(st) }; }
      if (p.cards || p.hist) patch(p, { force: true });
      toast('Clock started, hidden from the players: ' + name + '. Show it from the table page.');
      renderScore();
    }, function (e) {
      delete me.scBusy[key]; if (S !== me) return;
      toast('Could not start the clock: ' + errText(e), true);
      renderScore();
    });
  }
  /* an NPC asks: they are the client, and the score rolls (A job for them, on the NPC card; Job, beside a name in the rail) */
  function scAsk(n) {
    if (!n || !str(n.name).trim()) return;
    patch({ sc: { ui: { client: 'npc:' + n.key, who: replacePatch(uiOf('sc').who, scWho(n)) } } });
    showPanel('score');
    rollScore();
  }
  /* a picker changed: kept in the notes (a choice shapes the next roll, never the card on screen); the NPC who asks is kept with it */
  function scSetUi(key, value) {
    value = str(value);
    var u = {};
    u[key] = value;
    if (key === 'client') {
      if (value.indexOf('npc:') === 0) {
        var n = scNpcs().filter(function (x) { return 'npc:' + x.key === value; })[0];
        if (!n) return;                                 /* the NPC already kept with it: nothing changed */
        u.who = replacePatch(uiOf('sc').who, scWho(n));
      } else u.who = null;
    }
    patch({ sc: { ui: u } });
    if (key === 'crew') renderScore();                  /* the Job picker's favoured group follows the crew */
  }
  /* the crew, an NPC on stage or a roll in the NPC tab changed: the pickers follow (never from under a list the GM has open) */
  function scMaybeRedraw() {
    if (!S || S.status !== 'ready' || !S.scCtxSig || !scAvail() || !scInst()) return;       /* nothing to follow until the panel has been drawn once */
    var sig = scCtxSig(scCtx());
    if (sig === S.scCtxSig) return;
    var a = document.activeElement, box = $q('#gm-score');
    if (a && box && box.contains(a) && str(a.tagName).toUpperCase() === 'SELECT') return;
    renderScore();
  }

  function scSelect(c, value) {
    var inner = c.groups.map(function (g) {
      var o = g.options.map(function (x) { return '<option value="' + esc(x.value) + '"' + (str(x.value) === str(value) ? ' selected' : '') + '>' + esc(x.label) + '</option>'; }).join('');
      return g.label ? '<optgroup label="' + esc(g.label) + '">' + o + '</optgroup>' : o;
    }).join('');
    return selectHtml('gm-sc-' + c.id, 'data-scui', c.id, c.label, c.options, value, inner);
  }
  function scBumpBtn(row, label) {
    return '<button type="button" class="gm-bump" data-gm="scorebump" data-row="' + esc(row) + '" aria-label="Reroll ' + esc(label) + '" title="Roll ' + esc(label) + ' again">↻</button>';
  }
  function scGridHtml(rows) {
    return '<dl class="gm-grid gm-sc-grid">' + rows.map(function (r) {
      return '<dt>' + esc(r.k) + '</dt><dd><div class="gm-sc-md">' + md(r.md) + '</div>' + (r.reroll ? scBumpBtn(r.id, str(r.k).toLowerCase()) : '') + '</dd>';
    }).join('') + '</dl>';
  }
  function scCardHtml(roll, cur) {
    var m = roll.card.meta, s = roll.score, M = W.B68GmScore, ck = M.clockOf(s), started = cur && isObj(cur.started) ? cur.started : {}, done = Object.prototype.hasOwnProperty.call(started, ck.name);
    var h = '<article class="gm-card gm-sccard" data-tool="score"><header class="gm-card-h"><div><h3>' + esc(m.title) + '</h3><p class="gm-sub">' + esc(m.sub) + '</p></div></header>';
    roll.card.lines.forEach(function (l) {
      if (l.kind === 'chips') h += chipsHtml(l.chips);
      else if (l.kind === 'want') h += '<div class="gm-want gm-sc-want">' + md(l.md) + (l.reroll ? scBumpBtn('lead', 'pitch') : '') + '</div>';
      else if (l.kind === 'grid' && l.collapsed) h += '<details class="gm-fold gm-sc-cloud" data-fold="sccloud"' + (foldOpen('sccloud') ? ' open' : '') + '><summary>' + esc(l.title) + '</summary>' + scGridHtml(l.rows) + '</details>';
      else if (l.kind === 'grid') h += scGridHtml(l.rows);
    });
    return h + '<div class="gm-card-acts">' +
      '<button type="button" class="btn sm primary" data-gm="scorecards" title="Onto the Cards panel as an opportunity card; the players see it only from there">To Cards</button>' +
      '<button type="button" class="btn sm" data-gm="scoresite" title="Location, with its pickers set from this score, and a roll">Roll the site</button>' +
      (s.client.type === 'npc' ? '' : '<button type="button" class="btn sm" data-gm="scoreface" title="NPC, with the faction and district set from this score">A face</button>') +
      '<button type="button" class="btn sm" data-gm="scoreclock"' + (done ? ' disabled title="On the table, hidden from the players: show it from the table page"' : ' title="Onto the table’s clocks, hidden from the players"') + '>' + esc(done ? 'Clock started: ' + ck.name : 'Start the clock') + '</button>' +
      '<button type="button" class="btn sm" data-gm="pin" data-tool="score">Pin</button><button type="button" class="btn sm" data-gm="copy" data-tool="score">Copy</button></div></article>';
  }
  function renderScore(fresh) {
    var box = $q('#gm-score'); if (!box) return;
    var g = scInst();
    if (!g) { box.innerHTML = '<p class="gm-note bad">' + esc(S.scErr || 'The score generator is not available.') + '</p>'; return; }
    var cur = scCard();
    if (!fresh && cur && S.scSig !== scSig(cur)) { S.scRoll = replayScore(cur); S.scSig = scSig(cur); }
    if (!cur) { S.scRoll = null; S.scSig = null; }
    var ctx = scCtx(), ui = scPanelUi(), roll = S.scRoll;
    S.scCtxSig = scCtxSig(ctx);
    var h = '<div class="gm-loc-ctl gm-sc-ctl">' + g.controls(ctx, ui).map(function (c) { return scSelect(c, ui[c.id]); }).join('') + '<button type="button" class="btn primary gm-roll" data-gm="scoreroll">Roll a score</button></div>';
    h += roll ? '<div class="gm-cardbox" id="gm-score-card">' + scCardHtml(roll, cur) + '</div>'
      : '<p class="gm-empty">Roll with everything on any when the table is lost, or set the target, the job or who is asking when they have a rough idea. Nothing here goes to the iPad: To Cards is the way to the players.</p>';
    box.innerHTML = h + earlierHtml('score', cur);
  }

  /* ---------- Downtime (D): personal business, one card per activity a PC takes (app/gm/downtime.js; GM.md "Downtime (D)") ----------
     The built-in tables (app/downtime-tables.js: original writing, no book text), or a pack part `downtime` laid over them; this page
     names nothing of the setting (districts, purveyors and contacts come from those tables and the sheets). Everyone rolls physical
     dice: a tap on the result IS the roll. Who: the PCs from the live sheets (api.characters(), slim copies, read on every draw) or
     anyone; picking one prefills the vice and purveyor (panel state in dt.ui, never written to the sheet), and their own clocks and
     contacts fill the Project and Contact selects. A card is { hid, seed, ui, mem, label, at, started? } under cards.downtime (five
     in hist.downtime): `ui` holds the RESOLVED strings (the PC's name, the vice, the purveyor line, the contact line, the project's
     name, the district), so a reload or an Earlier click redraws the same card after a sheet changes, and `mem` is the repeat guard
     before the roll (the guard itself is mem.downtime). Indulge vice is the house rule the Morning After: the card asks for the
     morning's d100 (rolled at the table and typed in, or "Roll one"), then shows the Benefit or the Mishap it lands on and a second
     from the same band, and the GM keeps one. The d100, Keep, Another, Change and "Overindulged?" all redraw the SAME card (its seed
     and memory: the module keeps the scene above as it was); once a d100 is in, its two cards go into the repeat guard
     (dt.remember) so the next card deals others. A clock a card suggests goes onto the table's clocks, hidden (api.addClock), and
     the card keeps its id under `started`. Nothing here goes to the iPad: the prompts and hooks are the GM's. */
  var DT_BANDS = [['13', '1–3'], ['45', '4/5'], ['6', '6'], ['crit', 'Crit']];
  var DT_NONE = '*';      /* the Project and Contact selects' "none of the sheet's"; '' follows the sheet */
  var DT_Q = '<button type="button" class="gm-q" data-gm="dt-rule" title="The rules on overindulging, in the GM screen" aria-label="The rules on overindulging, in the GM screen">?</button>';
  /* the instance, built once per start(): the built-in tables (B68DowntimeTables, loaded before the module) with the pack's downtime
     part laid over them; S.dtDists is the district list those tables draw from (Now in is matched against it) */
  function dtInst() {
    if (S.dt) return S.dt;
    var M = W.B68GmDowntime, book = W.B68DowntimeTables, pk = part('downtime'), vices = W.B68Content && Array.isArray(W.B68Content.VICES) ? W.B68Content.VICES : [];
    if (!M || typeof M.create !== 'function') { S.dtErr = 'The downtime module is missing.'; return null; }
    if (!isObj(book) || !isObj(book.T)) { S.dtErr = 'The downtime tables are missing.'; return null; }
    var pack = pk && isObj(pk.T) ? pk.T : undefined, dists = function (t) { return isObj(t) && Array.isArray(t.districts) ? t.districts.map(str) : null; };
    var cfg = function (over) { return { T: book.T, places: isObj(book.PLACES) ? book.PLACES : undefined, pack: over, vices: vices }; };
    S.dtNote = '';
    try { S.dt = M.create(cfg(pack)); S.dtErr = ''; S.dtDists = dists(pack) || dists(book.T) || []; }
    catch (e) {
      /* a pack part that lacks tables: the built-in ones (the Menu's Pack check names what the part lacks) */
      try { S.dt = M.create(cfg(undefined)); S.dtErr = ''; S.dtDists = dists(book.T) || []; if (pack) S.dtNote = 'The pack’s downtime part lacks tables, so these cards use the built-in ones.'; }
      catch (x) { S.dtErr = 'The downtime cards could not start: ' + errText(x); }
    }
    return S.dt;
  }
  function dtUi() {
    var u = isObj(S.doc.dt) && isObj(S.doc.dt.ui) ? S.doc.dt.ui : {};
    return { who: str(u.who), act: str(u.act), vice: str(u.vice), purveyor: str(u.purveyor), project: str(u.project), contact: str(u.contact) };
  }
  function dtActOf(dt, v) { return dt.ACTS.some(function (a) { return a.id === v; }) ? v : dt.ACTS[0].id; }
  function dtCard() { return isObj(S.doc.cards) && isObj(S.doc.cards.downtime) ? S.doc.cards.downtime : null; }
  function dtHist() { return isObj(S.doc.hist) && isObj(S.doc.hist.downtime) ? S.doc.hist.downtime : {}; }
  function dtSig(c) { return isObj(c) ? JSON.stringify([c.hid, c.seed, c.ui]) : null; }
  /* the PCs: api.characters() (slim copies of the filed characters), read afresh on every draw */
  function dtPcs() { var a = []; try { a = S.api && typeof S.api.characters === 'function' ? S.api.characters() : []; } catch (e) { a = []; } return (Array.isArray(a) ? a : []).filter(function (c) { return isObj(c) && str(c.id); }); }
  function dtPc(pcs) { var id = dtUi().who; return id ? pcs.filter(function (c) { return str(c.id) === id; })[0] || null : null; }
  function pcName(c) { return str(c && c.name).trim() || str(c && c.alias).trim() || 'Unnamed'; }
  function dtFold(s) { return str(s).toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, ' ').trim(); }
  /* the module's own name for the vice a sheet holds ('' when it is none of the seven: the card picks one) */
  function dtViceOf(dt, v) { var k = dtFold(v); return k ? dt.VICES.filter(function (x) { return dtFold(x) === k; })[0] || '' : ''; }
  /* the book's spelling (B68Content.VICES) for a vice's label; the module's name stays the value */
  function dtViceLabel(v) { var b = (W.B68Content && Array.isArray(W.B68Content.VICES) ? W.B68Content.VICES : []).filter(function (x) { return isObj(x) && dtFold(x.name) === dtFold(v); })[0]; return b ? str(b.name) : v; }
  function dtClocks(pc) { return pc && Array.isArray(pc.clocks) ? pc.clocks.filter(function (c) { return isObj(c) && str(c.name).trim(); }) : []; }
  /* the project a card is for: the clock picked here, else the PC's first clock still open (else their first); '' for none */
  function dtProject(pc) {
    var v = dtUi().project, list = dtClocks(pc); if (v === DT_NONE) return '';
    if (v && list.some(function (c) { return str(c.name).trim() === v; })) return v;
    var open = list.filter(function (c) { return +c.filled < +c.size; })[0] || list[0];
    return open ? str(open.name).trim() : '';
  }
  /* "Sam, a nosy neighbour": the line a contact is on the sheet, as the card takes it */
  function contactLine(c) { return str(c.name).trim() + (str(c.role).trim() ? ', ' + str(c.role).trim() : ''); }
  /* the sheet's contacts, a friend or a rival first */
  function dtContacts(pc) {
    var l = pc && Array.isArray(pc.contacts) ? pc.contacts.filter(function (c) { return isObj(c) && str(c.name).trim(); }) : [], rel = function (c) { return c.kind === 'friend' || c.kind === 'rival'; };
    return l.filter(rel).concat(l.filter(function (c) { return !rel(c); }));
  }
  function dtContact(pc) {
    var v = dtUi().contact, list = dtContacts(pc); if (v === DT_NONE) return null;
    return (v && list.filter(function (c) { return contactLine(c) === v; })[0]) || list[0] || null;
  }
  /* Now in, as the other tools take it: the tables' own spelling when their list holds the district (S.dtDists, set by dtInst()), else
     as the bar has it (a downtime card reads a district as words in a sentence, never as a table key); '' while Now in is anywhere (the
     card picks one) */
  function dtDistrict() {
    var now = nowDistrict(); if (!now) return '';
    return nowIn(S.dtDists || []) || now;
  }
  /* what a tap rolls: the panel's choices resolved to the strings the card keeps */
  function dtRollUi(dt, v) {
    var u = dtUi(), pc = dtPc(dtPcs()), act = dtActOf(dt, u.act), ui = { act: act, who: pc ? pcName(pc) : '', district: dtDistrict() };
    if (act === 'indulge') { ui.vice = dtViceOf(dt, u.vice); ui.purveyor = u.purveyor.trim(); ui.res = v === 'over' ? 'over' : ''; }
    else if (act === 'train') ui.attr = v;
    else if (act === 'contact') { var c = dtContact(pc); ui.contact = c ? contactLine(c) : ''; ui.rel = v === 'rival' ? 'rival' : 'friend'; }
    else { ui.res = v; if (act === 'project') ui.project = dtProject(pc); }
    return ui;
  }
  function replayDowntime(e) {
    var dt = dtInst(); if (!dt || !isObj(e)) return null;
    var mem = {}; try { mem = JSON.parse(e.mem || '{}'); } catch (x) {}
    try { return dt.roll(isObj(e.ui) ? e.ui : {}, { seed: e.seed, mem: isObj(mem) ? mem : {} }); } catch (x) { return null; }
  }
  function rollDowntime(v) {
    var dt = dtInst(); if (!dt) { renderDowntime(); return; }
    /* the purveyor as the field holds it now: a tap on a phone may not blur the field first, so its change has not fired (a select's has) */
    var pin = dtActOf(dt, dtUi().act) === 'indulge' ? $q('#gm-dt-purveyor') : null;
    if (pin && str(pin.value).slice(0, 200) !== dtUi().purveyor) patch({ dt: { ui: { purveyor: str(pin.value).slice(0, 200) } } });
    var ui = dtRollUi(dt, v), roll;
    try { roll = dt.roll(ui, { mem: S.dtMem }); } catch (e) { toast('The downtime card failed: ' + errText(e), true); return; }
    var entry = { seed: roll.seed, ui: clone(roll.replay.ui), mem: JSON.stringify(roll.replay.mem), label: str(roll.meta.label), at: nowIso() };
    var hid = uid('h'), card = Object.assign({ hid: hid }, entry);
    /* the new card REPLACES the stored one: nothing of the old (a clock it started) carries over */
    var ok = patch({ cards: { downtime: replacePatch(dtCard(), card) }, mem: { downtime: clone(S.dtMem) }, hist: { downtime: addCapped(dtHist(), hid, entry, LIMITS.hist) } }, { force: true });
    if (!ok) return;
    S.dtRoll = roll; S.dtSig = dtSig(card); S.last = { text: 'Downtime: ' + entry.label };
    renderDowntime(true);
    showIn($q('#gm-dt-card'), $q('#gm-dt'), ['.gm-dt-morning', '.gm-want', '.gm-card-h']);
  }
  /* The SAME card redrawn with one choice changed (the morning's d100, Keep, Another, "Overindulged?"): its own seed and memory, so
     the scene above stays as it was (the module draws the morning last). Only the choice, and the label that names it, change in the
     stored card and its Earlier entry; the hid, seed, memory and time stay. Once a d100 is in, the morning's two cards go into the
     repeat guard (never the card's own memory: a replay must not move). */
  function dtRedraw(change) {
    var cur = dtCard(), dt = dtInst(); if (!cur || !dt) return null;
    var roll = replayDowntime(Object.assign({}, cur, { ui: Object.assign({}, isObj(cur.ui) ? cur.ui : {}, change) }));
    if (!roll) { toast('That card could not be redrawn.', true); return null; }
    var x = { ui: clone(roll.replay.ui), label: str(roll.meta.label) }, p = { cards: { downtime: x } };
    if (isObj(dtHist()[cur.hid])) { p.hist = { downtime: {} }; p.hist.downtime[cur.hid] = clone(x); }
    if (typeof dt.remember === 'function' && dt.remember(roll, S.dtMem)) p.mem = { downtime: clone(S.dtMem) };
    if (!patch(p, { force: true })) return null;
    S.dtRoll = roll; S.dtSig = dtSig(dtCard()); S.last = { text: 'Downtime: ' + x.label };
    renderDowntime(true);
    return roll;
  }
  /* the morning's d100: the number typed on the card (a percentile 00 is 100), or one the page rolls; a new number deals afresh */
  function dtD100(v) {
    var M = W.B68GmDowntime, n = M && typeof M.d100 === 'function' ? M.d100(v) : '';
    if (!n) { toast('A d100 is 1 to 100 (00 is 100).', true); var f = $q('#gm-dt-d100'); if (f) { try { f.focus(); f.select(); } catch (e) {} } return; }
    if (dtRedraw({ d100: n, keep: '', deal: '' })) showIn($q('#gm-dt-card .gm-dt-morning'), $q('#gm-dt'), ['.gm-dt-mcard', '.gm-dt-mh']);
  }
  function dtD100Roll() { dtD100(String(1 + Math.floor(Math.random() * 100))); }
  /* Keep: the card the GM reads (a second tap puts both back); Another: the next card from the band; Change: type the d100 again */
  function dtKeep(v) { var c = dtCard(), k = c && isObj(c.ui) ? str(c.ui.keep) : ''; dtRedraw({ keep: k === v ? '' : v }); }
  function dtDeal() { var c = dtCard(), n = c && isObj(c.ui) ? +c.ui.deal || 0 : 0; dtRedraw({ deal: String(n + 1), keep: '' }); }
  function dtD100Clear() { if (dtRedraw({ d100: '', keep: '', deal: '' })) { var f = $q('#gm-dt-d100'); if (f) { try { f.focus(); } catch (e) {} } } }
  /* a PC chip: their vice and purveyor from the sheet into the panel (never back into the sheet); the Project and Contact selects go
     back to following their sheet. A tap on the chip already picked fills them from the sheet again. */
  function dtSetWho(id) {
    var dt = dtInst(); if (!dt) return;
    var pc = id ? dtPcs().filter(function (c) { return str(c.id) === id; })[0] || null : null;
    patch({ dt: { ui: { who: pc ? str(pc.id) : '', vice: pc ? dtViceOf(dt, pc.vice) : '', purveyor: pc ? str(pc.purveyor).slice(0, 200) : '', project: '', contact: '' } } });
    renderDowntime();
  }
  function dtSetAct(v) { var dt = dtInst(); if (!dt) return; patch({ dt: { ui: { act: dtActOf(dt, v) } } }); renderDowntime(); }
  function dtField(k, v) {
    var u = {}; u[k] = str(v).slice(0, 200); if (dtUi()[k] === u[k]) return;
    patch({ dt: { ui: u } });
    if (k === 'contact') renderDowntime();      /* the Friend or Rival button the sheet names follows the contact */
  }
  /* "Start a clock: …": onto the table's clocks (boot's addClock: a clockOps add, as the table page adds one), hidden from the players,
     a danger clock; the card keeps its id so the button stays done after a reload and on its Earlier entry */
  function dtClock(i) {
    var cur = dtCard(), a = S.dtRoll && S.dtRoll.meta && S.dtRoll.meta.actions ? S.dtRoll.meta.actions[i] : null, it = a && a.intent;
    if (!cur || !isObj(it) || it.type !== 'clock') return;
    var name = str(it.name), hid = cur.hid, key = hid + '|' + name, me = S;
    if (!name || (isObj(cur.started) && Object.prototype.hasOwnProperty.call(cur.started, name)) || S.dtBusy[key]) return;
    if (!S.api || typeof S.api.addClock !== 'function') { toast('The table is not available here: start the clock on the table page.', true); return; }
    var clock = { id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: name, size: +it.size || 4, filled: 0, kind: 'danger', hidden: true };
    S.dtBusy[key] = true;
    var b = $q('#gm-dt [data-gm="dt-clock"][data-i="' + (+i) + '"]'); if (b) b.disabled = true;
    Promise.resolve().then(function () { return S.api.addClock(clock); }).then(function () {
      delete me.dtBusy[key]; if (S !== me) return;
      var st = {}, p = {}; st[name] = clock.id;
      var c = dtCard(); if (c && c.hid === hid) p.cards = { downtime: { started: st } };
      if (isObj(dtHist()[hid])) { p.hist = { downtime: {} }; p.hist.downtime[hid] = { started: clone(st) }; }
      if (p.cards || p.hist) patch(p, { force: true });
      toast('Clock started, hidden from the players: ' + name + '. Show it from the table page.');
      renderDowntime();
    }, function (e) {
      delete me.dtBusy[key]; if (S !== me) return;
      toast('Could not start the clock: ' + errText(e), true);
      renderDowntime();
    });
  }
  /* the "?" by Overindulged: the rules entry on overindulging, in the GM screen pane (its own search; the entry opens when a hit's title
     is about indulging, else the list) */
  function dtRule() {
    setPanel('rules'); if (isPhone()) { S.seg = 'side'; syncPanels(); }
    rulesSearch('overindulge', null, function (x) { return /indulg/i.test(str(x.title)); });
  }
  /* the filed characters changed (boot, on each collection snapshot): the Who chips and the selects follow. Players tick their sheets all
     session, so the panel is drawn again only when what it shows changed (the slim copies), and never from under a list the GM has open
     (the next change catches up) */
  function charactersChanged() {
    if (!S || S.status !== 'ready' || JSON.stringify(dtPcs()) === S.dtPcSig) return;
    runStale();
    var a = document.activeElement, box = $q('#gm-dt');
    if (a && box && box.contains(a) && str(a.tagName).toUpperCase() === 'SELECT') return;
    renderDowntime();
  }

  /* the activity's ONE row of buttons (a tap rolls the card at once), with what it needs above it; the button that made the card on
     screen stays marked while it is this PC's card for this activity */
  function dtRowHtml(dt, act, u, pc, roll) {
    var on = roll && roll.replay ? roll.replay.ui : null, who = pc ? pcName(pc) : '', mine = !!on && on.act === act && on.who === who;
    var btn = function (k, v, label, cls, extra, pressed) {
      var p = pressed == null ? mine && str(on[k]) === v : pressed;
      return '<button type="button" class="chip gm-dtb' + (cls ? ' ' + cls : '') + '" data-gm="dt-roll" data-k="' + k + '" data-v="' + esc(v) + '" aria-pressed="' + p + '"' + (extra || '') + '>' + label + '</button>';
    };
    var row = function (label, btns) { return '<div class="gm-field wide gm-dt-row" role="group" aria-label="' + esc(label) + '"><span class="gm-lab">' + esc(label) + ':</span><div class="gm-dt-btns">' + btns + '</div></div>'; };
    if (act === 'indulge') {
      return '<div class="gm-row gm-dt-fields"><label class="gm-field gm-dt-vice" for="gm-dt-vice"><span class="gm-lab">Vice</span><select id="gm-dt-vice" data-dtf="vice"><option value=""' + (u.vice ? '' : ' selected') + '>any (the card picks one)</option>' +
        dt.VICES.map(function (v) { return '<option value="' + esc(v) + '"' + (v === u.vice ? ' selected' : '') + '>' + esc(dtViceLabel(v)) + '</option>'; }).join('') + '</select></label>' +
        '<label class="gm-field gm-dt-pur" for="gm-dt-purveyor"><span class="gm-lab">Purveyor</span><input type="text" id="gm-dt-purveyor" data-dtf="purveyor" maxlength="200" autocomplete="off" value="' + esc(u.purveyor) + '"' +
        ' placeholder="' + (pc ? 'Name, place, district' : 'any: a stock host and place') + '" title="Filled from the sheet. A change here is for these cards only: the sheet keeps its own."></label></div>' +
        row('Rolled at the table', btn('res', 'in', 'Indulged', 'gm-dtb-in', '', mine && str(on.res) !== 'over') + btn('res', 'over', 'Overindulged', 'gm-dtb-over', '', mine && str(on.res) === 'over'));
    }
    if (act === 'train') return row('Which xp track', dt.ATTRS.map(function (a) { return btn('attr', a, esc(a)); }).join(''));
    if (act === 'contact') {
      var list = dtContacts(pc), c = dtContact(pc), sel = c ? contactLine(c) : DT_NONE;
      return (list.length ? '<label class="gm-field wide" for="gm-dt-contact"><span class="gm-lab">Contact</span><select id="gm-dt-contact" data-dtf="contact">' + list.map(function (x) {
        var l = contactLine(x); return '<option value="' + esc(l) + '"' + (l === sel ? ' selected' : '') + '>' + esc(l + (x.kind ? ' (' + x.kind + ')' : '')) + '</option>';
      }).join('') + '<option value="' + DT_NONE + '"' + (sel === DT_NONE ? ' selected' : '') + '>someone else (an old friend or rival)</option></select></label>'
        : pc ? '<p class="gm-dim">No contacts on ' + esc(who) + '’s sheet: the card brings an old friend or an old rival.</p>' : '') +
        row('Play them as', ['friend', 'rival'].map(function (r) {
          var sheet = !!c && c.kind === r;
          return btn('rel', r, '<b>' + (r === 'friend' ? 'Friend' : 'Rival') + '</b>' + (sheet ? '<small>on the sheet</small>' : ''), sheet ? 'gm-dtb-sheet' : '', sheet ? ' title="' + esc(str(c.name).trim() + ' is ' + who + '’s ' + r + ' on the sheet') + '"' : '');
        }).join(''));
    }
    var clocks = act === 'project' ? dtClocks(pc) : [], proj = act === 'project' ? dtProject(pc) : '';
    return (act !== 'project' ? '' : clocks.length ? '<label class="gm-field wide" for="gm-dt-project"><span class="gm-lab">Project clock</span><select id="gm-dt-project" data-dtf="project">' + clocks.map(function (x) {
      var n = str(x.name).trim(); return '<option value="' + esc(n) + '"' + (n === proj ? ' selected' : '') + '>' + esc(n + ' · ' + (+x.filled || 0) + '/' + (+x.size || 0)) + '</option>';
    }).join('') + '<option value="' + DT_NONE + '"' + (proj ? '' : ' selected') + '>another project</option></select></label>'
      : pc ? '<p class="gm-dim">No clocks on ' + esc(who) + '’s sheet: the card says “the project”.</p>' : '') +
      row('Rolled at the table', DT_BANDS.map(function (b) { return btn('res', b[0], esc(b[1]), b[0] === 'crit' ? '' : 'gm-dtb-num'); }).join(''));
  }
  /* the morning after (Indulge vice): before the d100, a box to type it in (or "Roll one"); after it, the card it lands on and the
     second from its band, each with Keep (the other folds to its title; a second tap unfolds it), Another on the second card while
     neither is kept, and Change in the heading to type the number again. A Mishap's cost sits under it, in the alarm colour. */
  function dtMorningHtml(mo) {
    var over = mo.table === 'mishap';
    var h = '<div class="gm-dt-morning' + (over ? ' gm-dt-bad' : '') + '" role="group" aria-label="The morning after"><p class="gm-dt-mh"><span class="gm-lab">The morning after · ' + (over ? 'Mishaps' : 'Benefits') +
      (mo.n ? ' · ' + esc(String(mo.n)) + (mo.band ? ' · ' + esc(mo.band) : '') : '') + '</span>' + (over ? DT_Q : '') +
      (mo.n ? '<button type="button" class="btn sm gm-dt-redo" data-gm="dt-d100-clear" title="Type the d100 again">Change</button>' : '') + '</p>';
    if (!mo.n) {
      return h + '<div class="gm-dt-d100row"><label class="gm-field" for="gm-dt-d100"><span class="gm-lab">d100</span>' +
        '<input type="text" id="gm-dt-d100" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" placeholder="1–100" aria-describedby="gm-dt-d100h"></label>' +
        '<button type="button" class="btn primary" data-gm="dt-d100">Read it</button>' +
        '<button type="button" class="btn" data-gm="dt-d100-roll" title="No dice to hand? The page rolls one">Roll one</button></div>' +
        '<p class="gm-dim" id="gm-dt-d100h">Roll high: the higher, the ' + (over ? 'lighter the Mishap' : 'better the Benefit') + '. 00 is 100. You get the card it lands on and one more from its band.</p></div>';
    }
    return h + mo.cards.map(function (c) {
      var kept = mo.keep === c.which, off = !!mo.keep && !kept;
      return '<div class="gm-want gm-dt-mcard' + (c.which === 'alt' ? ' gm-dt-alt' : '') + (kept ? ' gm-dt-kept' : '') + (off ? ' gm-dt-off' : '') + '" data-which="' + c.which + '">' +
        '<p class="gm-dt-mt"><span class="gm-dt-mn">' + (c.which === 'alt' ? 'Or ' : '') + esc(c.range) + '</span> <b>' + esc(c.title) + '</b></p>' +
        (off ? '' : md(c.md) + (c.play ? '<div class="gm-small">' + md('**Play it:** ' + c.play) + '</div>' : '') +
          (c.cost ? '<div class="gm-small gm-dt-mcost">' + md('**Cost: ' + c.cost.title + '.** ' + c.cost.mech) + '</div>' : '') +
          (c.source ? '<div class="gm-small">' + md('*A new source to find: ' + c.source + '.*') + '</div>' : '')) +
        '<p class="gm-dt-macts"><button type="button" class="btn sm' + (kept ? ' primary' : '') + '" data-gm="dt-keep" data-v="' + c.which + '" aria-pressed="' + kept + '">' + (kept ? 'Kept' : off ? 'Use this one' : 'Keep this') + '</button>' +
        (c.which === 'alt' && !mo.keep ? '<button type="button" class="btn sm" data-gm="dt-deal" title="Another card from the same band">Another</button>' : '') + '</p></div>';
    }).join('') + '</div>';
  }
  /* the card: the existing card's parts (header, chips, the lead box with its small line, the grid, one actions row with Pin and Copy).
     Indulge vice adds the morning after under the scene (its own box, above), then a small "Overindulged?" (or "Not overindulged?")
     that turns the same card to the other table, with a "?" for the rules. With no table in the pack, the morning is one line that
     says where the tables are. */
  function dtCardHtml(roll, cur) {
    var m = roll.meta || {}, over = roll.over, mo = roll.morning, started = cur && isObj(cur.started) ? cur.started : {};
    var h = '<article class="gm-card gm-dtcard" data-tool="downtime"><header class="gm-card-h"><div><h3>' + esc(m.title) + '</h3><p class="gm-sub">' + esc(m.sub) + '</p></div></header>' + chipsHtml(m.chips);
    (roll.lines || []).forEach(function (l) {
      if ((l.id === 'morning' || l.id === 'morning2') && mo && mo.has) return;     /* the morning box draws them */
      h += linesHtml([l], md);
      if (l.id !== 'lead' || !over) return;
      if (mo && mo.has) h += dtMorningHtml(mo);
      h += '<p class="gm-dt-flip"><button type="button" class="btn sm" data-gm="dt-over" data-v="' + (over.shown ? 'in' : 'over') + '" title="The same card ' + (over.shown ? 'as a night that did not overindulge' : 'overindulged') +
        ': the scene above stays">' + (over.shown ? 'Not overindulged?' : 'Overindulged?') + '</button>' + DT_Q + '</p>';
    });
    return h + '<div class="gm-card-acts">' + (m.actions || []).map(function (a, i) {
      var name = isObj(a.intent) ? str(a.intent.name) : '', done = !!name && Object.prototype.hasOwnProperty.call(started, name);
      return '<button type="button" class="btn sm primary" data-gm="dt-clock" data-i="' + i + '"' + (done ? ' disabled title="On the table, hidden from the players: show it from the table page"' : ' title="Onto the table’s clocks, hidden from the players"') + '>' + esc(done ? 'Clock started: ' + name : a.label) + '</button>';
    }).join('') + '<button type="button" class="btn sm" data-gm="pin" data-tool="downtime">Pin</button><button type="button" class="btn sm" data-gm="copy" data-tool="downtime">Copy</button></div></article>';
  }
  function renderDowntime(fresh) {
    var box = $q('#gm-dt'); if (!box) return;
    var dt = dtInst();
    if (!dt) { box.innerHTML = '<p class="gm-note bad">' + esc(S.dtErr || 'The downtime cards are not available.') + '</p>'; return; }
    /* a redraw while the purveyor is being typed keeps the typing (the characters can land at any time) */
    var pin = $q('#gm-dt-purveyor'), keep = pin && document.activeElement === pin ? { v: pin.value, a: pin.selectionStart, b: pin.selectionEnd } : null;
    var cur = dtCard();
    if (!fresh && cur && S.dtSig !== dtSig(cur)) { S.dtRoll = replayDowntime(cur); S.dtSig = dtSig(cur); }
    var u = dtUi(), pcs = dtPcs(), pc = dtPc(pcs), act = dtActOf(dt, u.act), roll = S.dtRoll;
    S.dtPcSig = JSON.stringify(pcs);
    var h = '<section class="gm-box gm-dtbox"><h3 class="gm-band">Downtime · personal business</h3><div class="gm-dt-ctl">' +
      '<div class="gm-field wide"><span class="gm-lab" id="gm-dt-wl">Who</span><div class="gm-dt-chips" role="group" aria-labelledby="gm-dt-wl">' +
      pcs.map(function (c) { return '<button type="button" class="chip gm-dt-who" data-gm="dt-who" data-id="' + esc(c.id) + '" aria-pressed="' + (!!pc && pc.id === c.id) + '"' + (c.playbookName ? ' title="' + esc(c.playbookName) + '"' : '') + '>' + esc(pcName(c)) + '</button>'; }).join('') +
      '<button type="button" class="chip gm-dt-who" data-gm="dt-who" data-id="" aria-pressed="' + !pc + '">anyone</button></div>' +
      (pcs.length ? '' : '<p class="gm-dim">No characters are filed yet: a card uses a stock host and place.</p>') + '</div>' +
      '<div class="gm-field wide"><span class="gm-lab" id="gm-dt-al">Activity</span><div class="gm-dt-chips gm-dt-acts" role="group" aria-labelledby="gm-dt-al">' +
      /* a phone shows the module's short labels (two rows, not four: the row of buttons stays on the first screen); the label is the name */
      dt.ACTS.map(function (a) { return '<button type="button" class="chip" data-gm="dt-act" data-v="' + esc(a.id) + '" data-short="' + esc(a.short || a.label) + '" aria-label="' + esc(a.label) + '" aria-pressed="' + (a.id === act) + '"><span class="gm-dt-l">' + esc(a.label) + '</span></button>'; }).join('') + '</div></div>' +
      dtRowHtml(dt, act, u, pc, roll) + '</div></section>';
    if (S.dtNote) h += '<p class="gm-note">' + esc(S.dtNote) + '</p>';
    h += roll ? '<div class="gm-cardbox" id="gm-dt-card">' + dtCardHtml(roll, cur) + '</div>'
      : '<p class="gm-empty">Pick who and what they did, then tap what the dice said: a scene to frame, a question for the player and a hook. Nothing here goes to the iPad.</p>';
    box.innerHTML = h + earlierHtml('downtime', cur);
    if (keep) { var p2 = $q('#gm-dt-purveyor'); if (p2) { p2.value = keep.v; try { p2.focus(); p2.setSelectionRange(keep.a, keep.b); } catch (e) {} } }
  }

  /* ---------- the NPC tab: the app's cast ---------- */
  function subscribeNpcs() {
    if (S.npcUnsub) return;
    var db = S.api && S.api.db ? S.api.db() : null, me = S; if (!db) return;
    try {
      S.npcUnsub = db.collection('npcs').onSnapshot(function (snap) {
        if (S !== me) return;
        var m = {}; (snap && snap.docs || []).forEach(function (d) { var x = d && typeof d.data === 'function' ? d.data() : null; if (isObj(x)) m[d.id] = x; });
        me.npcs = m; renderNpcs(); renderRail(); apSubjects();
      }, function () {});
    } catch (e) { S.npcUnsub = null; }
  }
  function npcList() { return Object.keys(S.npcs).map(function (id) { return { id: id, doc: S.npcs[id] }; }).sort(function (a, b) { return str(a.doc.name).toLowerCase() < str(b.doc.name).toLowerCase() ? -1 : 1; }); }
  function renderNpcs() {
    var box = $q('#gm-npc'); if (!box) return;
    var list = npcList();
    box.innerHTML = '<div id="gm-npcgen"></div><h3 class="gm-band">The cast</h3>' +
      (list.length ? '<ul class="gm-npcs">' + list.map(function (x) {
        var d = x.doc, rev = d.revealed === true;
        return '<li class="gm-npcrow" data-id="' + esc(x.id) + '"><div class="gm-thumb" data-fig="' + esc(x.id) + '" aria-hidden="true"></div><div class="gm-npcmeta"><b>' + esc(d.name || 'Unnamed') + '</b><small>' + esc([d.role, d.faction].filter(Boolean).join(' · ')) + '</small>' + (rev ? '' : '<span class="gm-badge">Hidden</span>') + '</div>' +
          '<div class="gm-npcacts"><button type="button" class="btn sm" data-gm="npcipad" data-id="' + esc(x.id) + '">Show on iPad</button>' + stageHtml(x.id, staged(x.id)) + '</div></li>';
      }).join('') + '</ul>' : '<p class="gm-empty">' + (S.api && S.api.db && S.api.db() ? 'No NPCs in the cast yet. Add them on the cast page.' : 'The cast is not available here.') + '</p>') +
      '<p><a class="hm-link" href="#cast">The cast page</a></p>';
    renderNpcGen();
    scMaybeRedraw();
    var K = W.B68Figure; if (!K || !K.portrait) return;
    var holders = [].slice.call(box.querySelectorAll('[data-fig]')), i = 0, me = S;
    (function next() {
      if (S !== me || i >= holders.length) return;
      var h = holders[i++], id = h.getAttribute('data-fig'), d = me.npcs[id];
      if (d && isObj(d.spec)) {
        var key = JSON.stringify(d.spec), hit = me.figMemo[id];
        if (!hit || hit.key !== key) { var svg = ''; try { var s = clone(d.spec); s.id = 'gm-' + slug(id); svg = stripSize(K.portrait(s, { lod: 'lo' }).svg); } catch (e) { svg = ''; } hit = me.figMemo[id] = { key: key, svg: svg }; }
        h.innerHTML = hit.svg;     /* the figure kit's render of a spec, as the cast page does */
      }
      setTimeout(next, 0);
    })();
  }
  /* ---------- the stage, from here (the cast page's own document shape: campaign.scene = { npcs: { id: true | false }, at }) ----------
     Put on stage reveals a hidden NPC first (after a confirm), as the cast page does, so no player ever sees a scene naming an NPC
     they were not sent; the rail's On stage box (fed by the campaign document) is the feedback. A small link opens the cast. */
  function staged(id) { var sc = isObj(camp) && isObj(camp.scene) && isObj(camp.scene.npcs) ? camp.scene.npcs : {}; return sc[id] === true; }
  function stageHtml(id, on) {
    return '<button type="button" class="btn sm' + (on ? '' : ' primary') + '" data-gm="npcstage" data-id="' + esc(id) + '" aria-pressed="' + on + '">' + (on ? 'Off stage' : 'Put on stage') + '</button>' +
      '<a class="gm-npclink" href="#cast/' + encodeURIComponent(id) + '">open in the cast</a>';
  }
  function npcRef(id) { var db = S.api && S.api.db ? S.api.db() : null; try { return db ? db.collection('npcs').doc(id) : null; } catch (e) { return null; } }
  function stageNpc(id) {
    var d = S.npcs[id], api = S.api; if (!d) return;
    if (!api || typeof api.saveScene !== 'function') { toast('The stage needs the table: open them in the cast.', true); return; }
    var on = !staged(id), me = S, name = d.name || 'The NPC';
    if (on && d.revealed !== true && !W.confirm(name + ' is hidden from the players. Putting them on stage reveals them to everyone. Go ahead?')) return;
    var pre = Promise.resolve();
    if (on && (d.revealed !== true || !d.firstSeen)) {
      var ref = npcRef(id); if (!ref) { toast('The cast is not available here.', true); return; }
      var p = { revealed: true, firstSeen: d.firstSeen || nowIso() };
      pre = typeof ref.update === 'function' ? Promise.resolve().then(function () { return ref.update(clone(p)); }) : Promise.resolve().then(function () { return ref.set(Object.assign({}, clone(d), clone(p))); });
    }
    pre.then(function () { var o = {}; o[id] = on; return api.saveScene({ npcs: o, at: nowIso() }); })
      .then(function () { if (S === me) toast(on ? name + ' is on stage.' : name + ' is off the stage.'); }, function (e) { toast('Could not change the stage for ' + name + ': ' + errText(e), true); });
  }

  /* ---------- the NPC generator: a roll is a seed and the repeat-guard memory, so it replays after a reload ---------- */
  function npcgInst() {
    if (S.npcg) return S.npcg;
    var M = W.B68GmNpc, pk = part('npc');
    if (!M) { S.npcgErr = 'The NPC generator module is missing.'; return null; }
    if (!pk || !isObj(pk.T)) { S.npcgErr = 'The pack has no npc part. Update the pack.'; return null; }
    try { S.npcg = M.create({ T: pk.T, cast: pk.cast || [], F: pk.F || null, campaign: part('campaign') || {}, mem: clone(S.npcMem) }); S.npcgErr = ''; } catch (e) { S.npcgErr = 'The NPC generator could not start: ' + errText(e); }
    return S.npcg;
  }
  /* the figure for a roll: drawn once per roll and kept, since the kit's render checks are the slow part. `note` is the one line
     under the portrait (the module's own `fig.note`: what was stripped, a stock figure, or why there is none); when the kit itself
     throws (not loaded, or it fails on the spec) there is no portrait and the note says why, never a silent blank. */
  function npcWithFigure(g, roll) {
    var K = W.B68Figure, fig = null, svg = '', note = '';
    try { fig = g.figure(roll.npc, { K: K }); } catch (e) { fig = null; note = 'No portrait: ' + errText(e) + '.'; }
    if (fig) {
      note = str(fig.note);
      if (!fig.failed && fig.spec && K && K.portrait) {
        try { var sp = clone(fig.spec); sp.id = 'gm-npcg'; svg = stripSize(K.portrait(sp, { lod: 'lo' }).svg); } catch (e) { svg = ''; note = 'No portrait: ' + errText(e) + '.'; }
      } else if (!fig.failed && !(K && K.portrait)) note = 'No portrait: the figure kit is not loaded.';
    }
    return { roll: roll, fig: fig, svg: svg, note: note };
  }
  function replayNpc(e) {
    var g = npcgInst(); if (!g || !isObj(e)) return null;
    var mem = {}; try { mem = JSON.parse(e.mem || '{}'); } catch (x) {}
    try { return npcWithFigure(g, g.roll({ seed: e.seed, mem: mem, ui: isObj(e.ui) ? e.ui : {} })); } catch (x) { return null; }
  }
  /* the GM's choices (faction, district, place), kept in npc.ui; anything the pack does not hold reads as any */
  function npcUi() { var g = npcgInst(); return g ? g.cleanUi(Object.assign({}, uiOf('npc'), { district: distFor('npc') })) : {}; }
  /* the current location card's roll, redrawn from its seed when this tab has not drawn it yet */
  function locationNow() {
    var cur = isObj(S.doc.cards) ? S.doc.cards.location : null;
    if (S.locRoll && (!cur || rollKey(S.locRoll) === locKey(cur))) return S.locRoll;
    return cur ? replayLocation(cur) : null;
  }
  /* the location card's building, district and owner into the NPC choices, so the roll fits the scene */
  function npcFromLocation() {
    var g = npcgInst(), lr = locationNow(); if (!g) return;
    if (!lr) { toast('Roll a location first.', true); return; }
    var ui = g.cleanUi({ faction: str(lr.faction), district: str(lr.district), place: str(lr.target) });
    patch({ npc: { ui: ui } });
    var got = [ui.place, ui.district, ui.faction].filter(Boolean);
    toast(got.length ? 'From the location: ' + got.join(', ') + '. Change any of them before you roll.' : 'The NPC tables know none of the location\'s building, district or owner.');
    renderNpcGen();
  }
  function rollNpc() {
    var g = npcgInst(); if (!g) { renderNpcGen(); return; }
    var roll;
    try { roll = g.roll({ mem: S.npcMem, ui: npcUi() }); } catch (e) { toast('The NPC roll failed: ' + errText(e), true); return; }
    var entry = { seed: roll.seed, ui: clone(roll.replay.ui), mem: JSON.stringify(roll.replay.mem), label: str(roll.card.meta.label), at: nowIso() };
    var hid = uid('h'), hist = isObj(S.doc.hist) && isObj(S.doc.hist.npc) ? S.doc.hist.npc : {};
    patch({ cards: { npc: Object.assign({ hid: hid }, entry) }, mem: { npc: clone(S.npcMem) }, hist: { npc: addCapped(hist, hid, entry, LIMITS.hist) } }, { force: true });
    S.npcRoll = npcWithFigure(g, roll); S.last = { text: 'NPC: ' + entry.label };
    renderNpcGen(true);
  }
  /* in the cast already: a generated doc with this name (so the button does not file the same roll twice) */
  function npcInCast(name) {
    return Object.keys(S.npcs).some(function (id) { var d = S.npcs[id]; return isObj(d) && str(d.name) === str(name) && Array.isArray(d.tags) && d.tags.indexOf('generated') >= 0; });
  }
  function npcGenLinesHtml(lines) {
    return (lines || []).map(function (l) {
      if (l.kind === 'chips') return chipsHtml(l.chips);
      if (l.kind === 'grid' && l.title) {
        return l.collapsed ? '<details class="gm-fold"><summary>' + esc(l.title) + '</summary>' + linesHtml([l], md) + '</details>' : '<h4 class="gm-gridh">' + esc(l.title) + '</h4>' + linesHtml([l], md);
      }
      return linesHtml([l], md);
    }).join('');
  }
  function renderNpcGen(fresh) {
    var box = $q('#gm-npcgen'); if (!box) return;
    var g = npcgInst();
    if (!g) { box.innerHTML = '<p class="gm-note bad">' + esc(S.npcgErr || 'The NPC generator is not available.') + '</p>'; return; }
    var cur = isObj(S.doc.cards) ? S.doc.cards.npc : null;
    if (!fresh && cur && (!S.npcRoll || S.npcRoll.roll.seed !== cur.seed)) S.npcRoll = replayNpc(cur);
    var ui = npcUi(), hasLoc = isObj(S.doc.cards) && isObj(S.doc.cards.location);
    var r = S.npcRoll, h = '<div class="gm-loc-ctl">' + g.controls.map(function (x) { return selectHtml('gm-n-' + x.id, 'data-npcui', x.id, x.label, x.options, ui[x.id], x.id === 'district' ? distOptionsHtml('npc') : null); }).join('') +
      (hasLoc ? '<button type="button" class="btn" data-gm="npcloc" title="Sets the faction, district and place from the location card">Use the location</button>' : '') +
      '<button type="button" class="btn primary gm-roll" data-gm="npcroll">Roll an NPC</button></div>';
    if (r) {
      var c = r.roll.card, m = c.meta, inCast = npcInCast(r.roll.npc.name);
      h += '<article class="gm-card gm-npccard" data-tool="npc"><header class="gm-card-h">' + (r.svg ? '<div class="gm-thumb gm-npcfig" aria-hidden="true">' + r.svg + '</div>' : '') + '<div><h3>' + esc(m.title) + '</h3><p class="gm-sub">' + esc(m.sub) + '</p></div></header>' +
        (m.figureNote ? '<p class="gm-note">' + esc(m.figureNote) + '</p>' : '') + (r.note ? '<p class="gm-note gm-fignote">' + esc(r.note) + '</p>' : '') +
        npcGenLinesHtml(c.lines) +
        '<div class="gm-card-acts"><button type="button" class="btn sm primary" data-gm="npcfile"' + (inCast ? ' disabled' : '') + ' title="Adds them to the cast, hidden from the players">' + (inCast ? 'In the cast' : 'Add to the cast') + '</button>' +
        (scAvail() ? '<button type="button" class="btn sm" data-gm="npcjob" title="The Score tab, with them as the client, and a roll">A job for them</button>' : '') +
        '<button type="button" class="btn sm" data-gm="pin" data-tool="npc">Pin</button><button type="button" class="btn sm" data-gm="copy" data-tool="npc">Copy</button></div></article>';
    } else h += '<p class="gm-empty">Roll for a face on the street: who they are, what they want, how to play them. ' +
      'Pick a faction, district or place to fit the scene, or leave them on any. They stay in this tab until you add them to the cast.</p>';
    box.innerHTML = h + earlierHtml('npc', cur);
    scMaybeRedraw();
  }
  /* the roll into the cast: a hidden doc, plus the roll's seed in the GM state so the vault note can be rebuilt from it (SYNC.md) */
  function fileNpc() {
    var r = S.npcRoll, g = S.npcg, db = S.api && S.api.db ? S.api.db() : null; if (!r || !g) return;
    if (npcInCast(r.roll.npc.name)) { toast('They are in the cast already.'); return; }
    var col = null; try { col = db && db.collection('npcs'); } catch (e) { col = null; }
    if (!col) { toast('The cast is not available here.', true); return; }
    var id = 'npc_' + slug(r.roll.npc.name) + '_' + Date.now().toString(36), doc = g.castDoc(r.roll.npc, r.fig && r.fig.spec ? r.fig.spec : {}), me = S;
    var n = isObj(camp) && isObj(camp.session) ? +camp.session.number || 0 : 0, e = {}, b = $q('[data-gm="npcfile"]'); if (b) b.disabled = true;
    Promise.resolve().then(function () { return col.doc(id).set(clone(doc)); }).then(function () {
      if (S !== me) return;
      e[id] = clone(g.stateEntry(r.roll, { at: nowIso(), s: n }));
      e[id].mem = JSON.stringify(e[id].mem);
      patch({ npcgen: e }, { force: true });
      toast(doc.name + ' is in the cast, hidden.'); renderNpcGen();
    }, function (x) { toast('Could not add them to the cast: ' + errText(x), true); if (S === me) renderNpcGen(); });
  }
  function npcToIpad(id) {
    var d = S.npcs[id]; if (!d) return;
    if (d.revealed !== true && !W.confirm((d.name || 'This NPC') + ' is hidden from the players. Show them on the iPad anyway?')) return;
    pushDisplay({ kind: 'npc', npcId: id, title: str(d.name).slice(0, 2000) }).then(function () { toast('On the iPad: ' + (d.name || 'the NPC') + '.'); }, function (e) { toast('Could not send to the iPad: ' + errText(e), true); });
  }

  /* ---------- the Prep tab (gm/prep.js; GM.md "Prep"): the prep notes from the pack, ticks and beats in the GM state ---------- */
  function prepDoc() { return isObj(S.doc.prep) ? S.doc.prep : {}; }
  function prepSession() { return isObj(camp) && isObj(camp.session) ? +camp.session.number || 0 : 0; }
  function prepNoteId(pk) {
    var list = W.B68GmPrep.notes(pk), id = null;
    try { id = W.localStorage.getItem(PREP_NOTE); } catch (e) {}
    return list.some(function (n) { return n.id === id; }) ? id : list[0] ? list[0].id : null;
  }
  function prepRunning() { var b = prepDoc().beats; return isObj(b) && Object.keys(b).some(function (k) { return isObj(b[k]); }); }
  function hm(iso) { var d = new Date(iso); return isNaN(d) ? '' : pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function renderPrep(force) {
    var box = $q('#gm-prep'); if (!box) return;
    var B = W.B68GmPrep, M = W.B68Markdown, pk = part('prep');
    if (!B || !M) { box.innerHTML = '<p class="gm-note bad">The prep module is missing.</p>'; S.prepKey = null; return; }
    if (!pk) { box.innerHTML = '<p class="gm-empty">No prep notes in the pack yet. In Obsidian, add the property <code>gm_prep: true</code> to a session note, then run <code>npm run gm:pack</code> and push the pack (or Update pack).</p>'; S.prepKey = null; return; }
    var meta = S.pack.parts.prep, id = prepNoteId(pk), key = str(meta.version) + '|' + id;
    if (force || S.prepKey !== key || !box.querySelector('.pp-doc')) {
      var exp = meta.src && meta.src.exportedAt, age = ageDays(exp);
      var v = B.view(pk, id, { M: M, exportedAt: exp ? dmy(exp) + ' ' + hm(exp) : '' }), list = B.notes(pk);
      S.prepView = v; S.prepKey = key; S.prepTasks = {};
      (v.note ? v.note.blocks : []).forEach(function (b) { (b.tasks || []).forEach(function (t) { if (t && t.a) S.prepTasks[t.a] = { rel: b.from, t: t.t, d: !!t.d }; }); });
      box.innerHTML = '<div class="pp-bar">' +
        (list.length > 1 ? '<label class="gm-field pp-pick" for="gm-prep-note"><span class="gm-lab">Note</span><select id="gm-prep-note">' + list.map(function (n) { return '<option value="' + esc(n.id) + '"' + (n.id === id ? ' selected' : '') + '>' + esc(n.title) + '</option>'; }).join('') + '</select></label>' : '') +
        '<label class="gm-field pp-find" for="gm-prep-q"><span class="sr">Find in the note</span>' + '<input type="search" id="gm-prep-q" autocomplete="off" spellcheck="false" placeholder="Find in the note… (R)" title="Filters the sections; Enter goes to the first"></label>' +
        '<nav class="pp-rail" aria-label="Sections">' + v.rail.map(function (r) { return '<button type="button" class="chip sm" data-gm="prep-go" data-id="' + esc(r.id) + '">' + esc(r.text) + '</button>'; }).join('') + '</nav>' +
        '<button type="button" class="btn sm pp-widebtn" data-gm="prep-wide" aria-pressed="' + !!S.prepWide + '" title="Hide the console while you read">Wide</button></div>' +
        (age != null && age > 1 ? '<p class="gm-note pp-stale">Exported ' + Math.floor(age) + ' day' + (age >= 2 ? 's' : '') + ' ago. Edits made in Obsidian since then are not here: run <code>npm run gm:pack</code> and push the pack.</p>' : '') +
        '<div class="pp-peek" id="gm-prep-peek" hidden></div><article class="pp-doc">' + v.html + '</article>';
    }
    decoratePrep(box);
  }
  function decoratePrep(el) {
    if (!el || !W.B68GmPrep) return;
    var p = prepDoc(), pins = isObj(p.pins) ? p.pins : {};
    W.B68GmPrep.decorate(el, { ticks: p.ticks, cells: p.cells, beats: p.beats });
    el.querySelectorAll('.pp-pin').forEach(function (b) { var on = isObj(pins[b.getAttribute('data-sec')]); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Pinned' : 'Pin'; });
    decorateSites(el);
  }
  function prepRedecorate() { decoratePrep($q('#gm-prep')); renderRail(); renderBeat(); }
  /* the note's find box: every word somewhere in a section's heading or text keeps its chip in the rail; Enter goes to the first */
  function prepSectionEl(id) { try { return $q('#gm-prep [id="' + str(id).replace(/"/g, '') + '"]'); } catch (e) { return null; } }
  function prepFilter(q) {
    var words = foldQ(q).split(/\s+/).filter(Boolean), first = null;
    [].forEach.call(S.root.querySelectorAll('#gm-prep .pp-rail [data-gm="prep-go"]'), function (c) {
      var sec = prepSectionEl(c.getAttribute('data-id')), t = foldQ(c.textContent + ' ' + (sec ? sec.textContent : ''));
      var hit = words.every(function (w) { return t.indexOf(w) >= 0; });
      c.hidden = !hit; if (hit) { c.removeAttribute('hidden'); if (!first) first = c; } else c.setAttribute('hidden', '');
    });
    return first;
  }
  function prepFindGo() {
    var q = $q('#gm-prep-q'), first = prepFilter(q ? q.value : ''); if (!first) { toast('Nothing in the note matches.', true); return; }
    var id = first.getAttribute('data-id'); prepGo(id); flash(prepSectionEl(id));
  }
  function prepTick(a) {
    var info = S.prepTasks && S.prepTasks[a]; if (!info) return;
    if (info.d) { toast('Ticked in the note already.'); return; }
    var t = {}, on = isObj(prepDoc().ticks) && isObj(prepDoc().ticks[a]);
    t[a] = on ? null : { at: nowIso(), s: prepSession(), rel: info.rel, t: str(info.t).slice(0, 200) };
    if (patch({ prep: { ticks: t } })) prepRedecorate();
  }
  function prepCell(td) {
    var k = td.getAttribute('data-cell'), c = {}, on = isObj(prepDoc().cells) && isObj(prepDoc().cells[k]);
    c[k] = on ? null : { at: nowIso(), s: prepSession(), label: str(td.getAttribute('data-label')).slice(0, 200) };
    if (patch({ prep: { cells: c } })) prepRedecorate();
  }
  function prepBeat(b) {
    var k = b.getAttribute('data-beat'), on = isObj(prepDoc().beats) && isObj(prepDoc().beats[k]), x = {};
    if (on && !W.confirm('Clear this beat’s start time?')) return;
    x[k] = on ? null : { at: nowIso(), s: prepSession(), label: str(b.getAttribute('data-label')).slice(0, 200) };
    if (patch({ prep: { beats: x } })) prepRedecorate();
  }
  function prepPin(sec) {
    var pins = isObj(prepDoc().pins) ? prepDoc().pins : {}, x = {};
    if (isObj(pins[sec])) x[sec] = null;
    else { if (Object.keys(pins).filter(function (k) { return isObj(pins[k]); }).length >= 3) { toast('Three sections are pinned already: unpin one first.', true); return; } x[sec] = { at: nowIso(), note: prepNoteId(part('prep')) }; }
    if (patch({ prep: { pins: x } })) prepRedecorate();
  }
  /* the pinned sections, live (their boxes tick here as in the tab), at the top of the rail */
  function prepPinsHtml() {
    var pk = part('prep'), B = W.B68GmPrep, pins = prepDoc().pins; if (!pk || !B || !isObj(pins)) return '';
    return Object.keys(pins).filter(function (k) { return isObj(pins[k]); }).map(function (sec) {
      var noteId = str(pins[sec].note), v = S.prepView && S.prepView.note && S.prepView.note.id === noteId ? S.prepView : B.view(pk, noteId, { M: W.B68Markdown }), s = v.secs[sec];
      if (!s) return '';
      return '<section class="gm-box pp-pinbox" data-sec="' + esc(sec) + '"><h3 class="gm-band">' + esc(s.head || 'Prep') + '<button type="button" class="gm-x" data-gm="prep-pin" data-sec="' + esc(sec) + '" aria-label="Unpin">×</button></h3>' +
        '<div class="pp-doc pp-mini">' + B.section(pk, noteId, sec, { M: W.B68Markdown, view: v }) + '</div></section>';
    }).join('');
  }
  function prepGo(id) {
    var el = id ? $q('#' + id) : null; if (!el) return;
    if (S.panel !== 'prep') setPanel('prep');
    try { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); }
  }
  /* the element a heading's words name in the Prep tab: a section (its ## heading), else a heading inside a section or a transclusion;
     within `scope` (one transclusion) when given. Matched by slug, as the ids are made (gm/prep.js). */
  function prepHeadingEl(text, scope) {
    var want = W.B68GmPrep.slug(text), root = scope || $q('#gm-prep'); if (!root || !want) return null;
    var sec = scope ? null : $q('#gm-prep [id="pp-' + want + '"]'); if (sec) return sec;
    return root.querySelector(['h2', 'h3', 'h4', 'h5', 'h6'].map(function (t) { return t + '[id$="--' + want + '"]'; }).join(', '));
  }
  function prepScroll(el) { if (!el) return; try { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { el.scrollIntoView(); } }
  /* a link in a prep note: a heading here, a peek card for an NPC, PC or faction, another prep note (at the heading it names), a
     transclusion in this one (at the heading it names), this note by its own name (at the heading), or Obsidian */
  function prepLink(href) {
    var B = W.B68GmPrep, pk = part('prep'), l = B && B.link(href); if (!l || !pk) return;
    if (l.type === 'top') { var d = $q('#gm-prep'); if (d) d.scrollIntoView(); return; }
    if (l.type === 'heading') { var hit = prepHeadingEl(l.text); if (hit) prepScroll(hit); else toast('That heading is not in this note.', true); return; }
    var L = isObj(pk.links) ? pk.links[l.key] : null; if (!L) return;
    var frag = l.frag && l.frag.charAt(0) !== '^' ? l.frag : '';
    if (l.kind === 'note') {
      var other = B.notes(pk).filter(function (n) { var full = (pk.notes || []).filter(function (x) { return x.id === n.id; })[0]; return full && full.rel === L.rel; })[0];
      if (other && other.id !== prepNoteId(pk)) {
        try { W.localStorage.setItem(PREP_NOTE, other.id); } catch (e) {}
        renderPrep(true); if (frag) prepScroll(prepHeadingEl(frag)); return;
      }
      if (other) { var here = frag ? prepHeadingEl(frag) : null; if (here) prepScroll(here); else { var top = $q('#gm-prep'); if (top) top.scrollIntoView(); } return; }
      var embs = S.root ? [].slice.call(S.root.querySelectorAll('#gm-prep .pp-embed[data-from="' + str(L.rel).replace(/"/g, '') + '"]')) : [];
      if (embs.length) {
        var inside = null; if (frag) embs.some(function (e) { inside = prepHeadingEl(frag, e); return !!inside; });
        prepScroll(inside || embs[0]); return;
      }
    }
    if (l.kind === 'npc' || l.kind === 'pc' || l.kind === 'faction') { prepPeek(l.kind, L); return; }
    W.location.href = B.obsidianUri(pk, L.rel);
  }
  function prepPeek(kind, L) {
    var box = $q('#gm-prep-peek'), pk = part('prep'), c = part('campaign') || {}, lc = function (s) { return str(s).toLowerCase(); }, h = '', acts = '';
    if (!box) return;
    if (kind === 'npc') {
      var n = (c.npcs || []).filter(function (x) { return lc(x.name) === lc(L.name); })[0] || { name: L.name };
      var appId = Object.keys(S.npcs || {}).filter(function (id) { return lc(S.npcs[id] && S.npcs[id].name) === lc(L.name); })[0];
      h = '<p class="gm-kick">NPC</p><h3>' + esc(n.name) + '</h3><p class="gm-sub">' + esc([n.role, n.faction, n.district].filter(Boolean).join(' · ')) + '</p>' +
        (n.glance ? '<p>' + esc(n.glance) + '</p>' : '') + (n.mannerism ? '<p class="gm-dim">' + esc(n.mannerism) + '</p>' : '') +
        (Array.isArray(n.say) && n.say.length ? '<blockquote class="pp-sayline">' + n.say.slice(0, 2).map(esc).join('<br>') + '</blockquote>' : '');
      if (appId) acts += '<button type="button" class="btn sm" data-gm="npcipad" data-id="' + esc(appId) + '">Show on iPad</button>' + stageHtml(appId, staged(appId));
    } else if (kind === 'pc') {
      var p = (c.pcs || []).filter(function (x) { return lc(x.file) === lc(L.name) || lc(x.name) === lc(L.name); })[0] || { name: L.name };
      h = '<p class="gm-kick">PC</p><h3>' + esc(p.name) + '</h3><p class="gm-sub">' + esc(p.playbook || '') + '</p>' +
        [['Friends', p.friend], ['Rival', p.rival], ['Vice', p.vice]].filter(function (r) { return Array.isArray(r[1]) && r[1].length; }).map(function (r) { return '<p><span class="gm-lab">' + r[0] + '</span> ' + esc(r[1].join(', ')) + '</p>'; }).join('');
    } else {
      var bare = lc(L.name).replace(/^b68g?-/, '').replace(/^the-/, ''), st = (c.standing || []).filter(function (s) { return B68slug(s.faction).replace(/^the-/, '') === bare; })[0];
      h = '<p class="gm-kick">Faction</p><h3>' + esc(st ? st.faction : L.name) + '</h3>' + (st ? '<p><span class="gm-lab">Status with the crew</span> ' + esc((st.status > 0 ? '+' : '') + st.status) + '</p>' : '<p class="gm-dim">No status recorded on the board.</p>');
    }
    box.innerHTML = '<div class="pp-peekcard">' + h + '<p class="pp-acts">' + acts + '<a class="btn sm" href="' + esc(W.B68GmPrep.obsidianUri(pk, L.rel)) + '">Open in Obsidian</a><button type="button" class="btn sm" data-gm="prep-peekx">Close</button></p></div>';
    box.hidden = false;
    try { box.scrollIntoView({ block: 'nearest' }); } catch (e) {}
  }
  /* ---------- the Cards panel: the planning meeting's opportunity cards, typed onto the card here, shown on the iPad ----------
     GM state `opps`: { list: { id: { from, client, target, type, note, payout, order, at } }, interval }. Only what the GM typed
     goes out, and only when they press a Show button (display kind `cards`, checked by the server). */
  var OPP_ROWS = [['from', 'From'], ['client', 'Client'], ['target', 'Target'], ['type', 'Type'], ['note', ''], ['payout', 'Payout']], OPP_MAX = 8;
  function oppDoc() { return isObj(S.doc.opps) ? S.doc.opps : {}; }
  function oppList() {
    var l = isObj(oppDoc().list) ? oppDoc().list : {};
    return Object.keys(l).filter(function (k) { return isObj(l[k]); }).map(function (k) { return Object.assign({ _id: k }, l[k]); })
      .sort(function (a, b) { return (+a.order || 0) - (+b.order || 0) || (a._id < b._id ? -1 : 1); });
  }
  function renderCards(force) {
    var box = $q('#gm-cards'); if (!box) return;
    var act = document.activeElement;
    if (!force && act && box.contains(act) && act.classList && act.classList.contains('oc-in')) return;   /* not while typing on a card */
    var list = oppList(), iv = Math.floor(+oppDoc().interval || 0), pcs = (part('campaign') || {}).pcs || [];
    var names = pcs.map(function (p) { return str(p.first || p.name); }).filter(Boolean).concat(['GM']);
    var h = '<div class="gm-cardsbar"><button type="button" class="btn sm primary" data-gm="opp-add"' + (list.length >= OPP_MAX ? ' disabled' : '') + '>Add a card</button>' +
      '<button type="button" class="btn sm" data-gm="opp-show" data-mode="carousel"' + (list.length ? '' : ' disabled') + '>Show on iPad</button>' +
      '<button type="button" class="btn sm" data-gm="opp-show" data-mode="spread"' + (list.length ? '' : ' disabled') + '>Spread on iPad</button>' +
      '<label class="gm-field" for="gm-opp-iv"><span class="gm-lab">Turns</span><select id="gm-opp-iv">' + [[0, 'when tapped'], [8, 'every 8 s'], [12, 'every 12 s'], [20, 'every 20 s']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === iv ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label></div>' +
      '<datalist id="gm-opp-from">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>';
    if (!list.length) h += '<p class="gm-empty">One card per pitch at the planning meeting: each player’s, then yours. Type on the card, then Show on iPad. Each card names a client, a target or an operation type (the others stay blank).</p>';
    h += '<div class="gm-opps">' + list.map(function (c, i) {
      return '<div class="gm-opp"><div class="oc-card oc-edit"><div class="oc-row oc-head"><span class="oc-lab"></span><span class="oc-colon"></span><span class="oc-val oc-title">Opportunity ' + (i + 1) + '</span></div>' +
        OPP_ROWS.map(function (r) {
          return '<label class="oc-row"><span class="oc-lab">' + esc(r[1]) + '</span><span class="oc-colon">:</span><span class="oc-val"><input class="oc-in" type="text" maxlength="120" autocomplete="off" data-opp="' + esc(c._id) + '" data-f="' + r[0] + '" value="' + esc(c[r[0]]) + '"' +
            (r[0] === 'from' ? ' list="gm-opp-from"' : '') + ' aria-label="' + esc(r[1] || 'Note') + '"></span></label>';
        }).join('') + '</div><div class="gm-opp-acts"><button type="button" class="btn sm" data-gm="opp-one" data-id="' + esc(c._id) + '">Show this one</button>' +
        '<button type="button" class="btn sm" data-gm="opp-move" data-id="' + esc(c._id) + '" data-d="-1"' + (i ? '' : ' disabled') + ' aria-label="Move up">↑</button><button type="button" class="btn sm" data-gm="opp-move" data-id="' + esc(c._id) + '" data-d="1"' + (i < list.length - 1 ? '' : ' disabled') + ' aria-label="Move down">↓</button>' +
        '<button type="button" class="btn sm" data-gm="opp-del" data-id="' + esc(c._id) + '">Remove</button></div></div>';
    }).join('') + '</div>';
    box.innerHTML = h;
  }
  function oppAdd() {
    var list = oppList(); if (list.length >= OPP_MAX) return;
    var id = uid('o'), x = {}; x[id] = { from: '', client: '', target: '', type: '', note: '', payout: '', order: list.length ? (+list[list.length - 1].order || 0) + 1 : 1, at: nowIso() };
    if (patch({ opps: { list: x } })) { renderCards(true); var f = $q('[data-opp="' + id + '"][data-f="from"]'); if (f) f.focus(); }
  }
  function oppMove(id, d) {
    var list = oppList(), i = list.map(function (c) { return c._id; }).indexOf(id), j = i + d; if (i < 0 || j < 0 || j >= list.length) return;
    var x = {}; x[list[i]._id] = { order: +list[j].order || j }; x[list[j]._id] = { order: +list[i].order || i };
    if (x[list[i]._id].order === x[list[j]._id].order) { x[list[i]._id].order = j; x[list[j]._id].order = i; }
    if (patch({ opps: { list: x } })) renderCards(true);
  }
  function oppDel(id) {
    var c = oppList().filter(function (o) { return o._id === id; })[0]; if (!c) return;
    if ((c.from || c.client || c.target || c.type || c.note || c.payout) && !W.confirm('Remove this card?')) return;
    var x = {}; x[id] = null; if (patch({ opps: { list: x } }, { force: true })) renderCards(true);
  }
  function oppShow(mode, oneId) {
    var list = oppList(); if (oneId) list = list.filter(function (c) { return c._id === oneId; });
    if (!list.length) { toast('Add a card first.', true); return; }
    var cards = list.slice(0, OPP_MAX).map(function (c) { var o = {}; OPP_ROWS.forEach(function (r) { o[r[0]] = str(c[r[0]]).replace(/\s+/g, ' ').trim().slice(0, 120); }); return o; });
    var d = { kind: 'cards', title: 'Opportunities', cards: cards, mode: mode === 'spread' ? 'spread' : 'carousel', interval: oneId ? 0 : Math.floor(+oppDoc().interval || 0), start: 0 };
    pushDisplay(d).then(function () { toast('On the iPad: ' + (oneId ? 'one card' : cards.length + ' cards' + (d.mode === 'spread' ? ', spread out' : '')) + '.'); }, function (e) { toast('Could not send to the iPad: ' + errText(e), true); });
  }
  /* ---------- the Chase panel (C): a chase strip that grows on the iPad as the chase clock fills (GM.md "Chase") ----------
     B68GmChase (gm/chase.js) builds what the map kit is given; the kit (0.6: B68Map.chaseNew, chaseTick, chase) keeps and draws the chase.
     GM state `chase: { current, past: { <id>: chase }, ui: { level, time } }`. One roll is one panel as wide as the segments it filled;
     drawn in play, never ahead. Only the player copy, drawn here at the iPad's size, goes to the iPad (chaseDisplay), and while it is
     up every change sends it again, as the table clocks do. S.chForm holds the start form and S.chOn the chase on the iPad (this page). */
  function chDoc() { return isObj(S.doc.chase) ? S.doc.chase : {}; }
  function chCur() { var c = chDoc().current; return isObj(c) && Array.isArray(c.panels) && Array.isArray(c.clocks) ? c : null; }
  function chUi() { var u = isObj(chDoc().ui) ? chDoc().ui : {}, G = W.B68GmChase, cur = chCur(); return { level: G && G.LEVELS.indexOf(u.level) >= 0 ? u.level : 'street', time: u.time === 'Night' || u.time === 'Bluetime' ? u.time : cur && cur.time === 'Night' ? 'Night' : 'Bluetime' }; }
  function chKit() { var K = W.B68Map; return K && typeof K.chase === 'function' && typeof K.chaseNew === 'function' && typeof K.chaseTick === 'function' ? K : null; }
  function chTokens() { var K = chKit(), o = null; try { o = K && typeof K.chaseOptions === 'function' ? K.chaseOptions() : null; } catch (e) { o = null; } return o && Array.isArray(o.tokens) && o.tokens.length ? o.tokens.map(str) : W.B68GmChase.TOKENS; }
  function chForm() {
    if (!S.chForm) S.chForm = { from: '', ground: 'corridor', name: '', clockName: '', size: 6, opp: 'none', oppName: '', oppSize: 4, crewToken: 'autopod', themToken: 'watch-car', legName: '', legSize: 4 };
    if (!S.chForm.picked) S.chForm.from = S.locRoll ? 'location' : S.scnRoll ? 'scene' : 'ground';     /* what is on screen, until the GM picks */
    if (S.chForm.from === 'location' && !S.locRoll) S.chForm.from = S.scnRoll ? 'scene' : 'ground';
    if (S.chForm.from === 'scene' && !S.scnRoll) S.chForm.from = S.locRoll ? 'location' : 'ground';
    return S.chForm;
  }
  function chSeg(name, list, v, dis) {
    return '<div class="seg" role="group" aria-label="' + esc(name) + '">' + list.map(function (o) { var val = Array.isArray(o) ? o[0] : o, lab = Array.isArray(o) ? o[1] : o; return '<button type="button" class="chip" data-gm="ch-set" data-k="' + esc(name) + '" data-v="' + esc(val) + '" aria-pressed="' + (str(val) === str(v)) + '"' + (dis && dis(val) ? ' disabled' : '') + '>' + esc(lab) + '</button>'; }).join('') + '</div>';
  }
  function chTokOpts(v, none) { return (none ? '<option value=""' + (v ? '' : ' selected') + '>nobody</option>' : '') + chTokens().map(function (t) { return '<option value="' + esc(t) + '"' + (t === v ? ' selected' : '') + '>' + esc(t.replace(/-/g, ' ')) + '</option>'; }).join(''); }
  function chPastHtml() {
    var past = newest(Object.keys(isObj(chDoc().past) ? chDoc().past : {}).reduce(function (m, k) { var x = chDoc().past[k]; if (isObj(x)) m[k] = Object.assign({}, x, { at: x.endedAt }); return m; }, {}));
    if (!past.length) return '';
    return '<details class="gm-more gm-ch-past"' + (foldOpen('chpast') ? ' open' : '') + ' data-fold="chpast"><summary>Past chases <span class="gm-dim">' + past.length + '</span></summary><ul class="gm-ch-pastl">' +
      past.map(function (x) { return '<li><b>' + esc(x.name || 'Chase') + '</b> <span class="gm-dim">' + esc([x.district, (Array.isArray(x.panels) ? x.panels.length : 0) + ' panels', W.B68GmChase.OUTCOMES[x.outcome] || '', x.endedAt ? dmy(x.endedAt) + ' ' + hm(x.endedAt) : ''].filter(Boolean).join(' · ')) + '</span></li>'; }).join('') + '</ul></details>';
  }
  var CH_SPLIT = 'A split crew shares one clock: one Lose the Tail clock for everyone (p.262–263).';
  /* the racing clocks (BitD p.16): what the full clocks mean, said once they are */
  function chRaceHtml(cur) {
    var o = W.B68GmChase.outcome(cur);
    if (o.tie) return '<p class="gm-note warn gm-ch-race">Both clocks filled on the same tick: they escape, but the pursuers are outside the lair (BitD p.16). End chase offers it.</p>';
    if (o.against && !o.crew) return '<p class="gm-note warn gm-ch-race">The opposing clock is full: they were caught, unless you say otherwise.</p>';
    return '';
  }
  /* End chase's outcome: the racing clocks' suggestion, unless the GM picked one since the last change (S.chOutcome, this page) */
  function chOutcomeOpts(cur) {
    var G = W.B68GmChase, sug = G.outcome(cur).suggest, v = S.chOutcome !== undefined ? S.chOutcome : sug;
    return [['', 'How it ended: not said']].concat(Object.keys(G.OUTCOMES).map(function (k) { return [k, G.OUTCOMES[k]]; })).map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + esc(o[1]) + (o[0] && o[0] === sug ? ' (the clocks)' : '') + '</option>'; }).join('');
  }
  /* the controls are drawn again only on a forced redraw (a press here) or when nothing in the pane is being typed in */
  function renderChase(force) {
    var box = $q('#gm-chase'), G = W.B68GmChase; if (!box) return;
    var act = document.activeElement;
    if (!force && act && box.contains(act) && /^(input|textarea)$/i.test(act.tagName || '')) return;
    if (!G) { box.innerHTML = '<p class="gm-note bad">The chase module is missing.</p>'; return; }
    var K = chKit(), cur = chCur(), h = '';
    if (!K) h += '<p class="gm-note warn">The chase strip needs map kit 0.6; this build has ' + esc(W.B68Map && W.B68Map.VERSION || 'none') + '. Update the app to draw chases.</p>';
    if (!cur) {
      var f = chForm(), loc = S.locRoll, scn = S.scnRoll && S.scnRoll.scene;
      var froms = [['location', 'Location' + (loc ? ': ' + shortLabel(loc.namedStreet || loc.name, 26) : '')], ['scene', 'Street scene' + (scn ? ': ' + shortLabel(scn.street, 26) : '')], ['ground', 'A street type']];
      h += '<section class="gm-ch-start" aria-label="Start a chase"><h3 class="gm-band">Start a chase</h3>' +
        '<div class="gm-field wide"><span class="gm-lab">The street</span>' + chSeg('from', froms, f.from, function (v) { return v === 'location' ? !loc : v === 'scene' ? !scn : false; }) + '</div>' +
        (f.from === 'ground' ? selectHtml('gm-ch-ground', 'data-chf', 'ground', 'Street type', G.GROUNDS, f.ground) : '') +
        '<label class="gm-field wide" for="gm-ch-name"><span class="gm-lab">Name</span><input type="text" id="gm-ch-name" data-chf="name" maxlength="80" autocomplete="off" placeholder="The chase" value="' + esc(f.name) + '"></label>' +
        '<div class="gm-ch-row"><label class="gm-field" for="gm-ch-clock"><span class="gm-lab">The crew’s clock</span>' + '<input type="text" id="gm-ch-clock" data-chf="clockName" maxlength="60" autocomplete="off" placeholder="Get away" value="' + esc(f.clockName) + '"></label>' + chSeg('size', G.SIZES, f.size) + '</div>' +
        '<p class="gm-dim gm-ch-help">' + CH_SPLIT + '</p>' +
        '<div class="gm-ch-row"><div class="gm-field"><span class="gm-lab">Opposing clock</span>' + chSeg('opp', [['none', 'None'], ['shown', 'Shown'], ['hidden', 'Hidden']], f.opp) + '</div>' +
        (f.opp !== 'none' ? '<label class="gm-field" for="gm-ch-opp"><span class="gm-lab">Its name' + (f.opp === 'hidden' ? ' (GM only)' : '') + '</span><input type="text" id="gm-ch-opp" data-chf="oppName" maxlength="60" autocomplete="off" placeholder="They close in" value="' + esc(f.oppName) + '"></label>' + chSeg('oppSize', G.SIZES, f.oppSize) : '') + '</div>' +
        '<div class="gm-ch-row">' + selectHtml('gm-ch-crewtok', 'data-chf', 'crewToken', 'The crew in', [], '', chTokOpts(f.crewToken)) + selectHtml('gm-ch-themtok', 'data-chf', 'themToken', 'After them', [], '', chTokOpts(f.themToken, true)) + '</div>' +
        '<p><button type="button" class="btn primary gm-roll" data-gm="ch-start"' + (K ? '' : ' disabled') + '>Start the chase</button></p>' +
        '<p class="gm-empty">Each roll that ticks the clock draws one panel, as wide as the segments it filled. Nothing is drawn ahead.</p></section>';
    } else {
      var ks = G.clocks(cur), lg = G.leg(cur), op = G.opposing(cur), u = chUi(), st = cur.street || {};
      h += '<section class="gm-ch-play" aria-label="The chase"><header class="gm-card-h"><div><h3>' + esc(G.title(cur)) + '</h3><p class="gm-sub">' + esc([cur.district, st.named || st.type || (G.GROUNDS.filter(function (g) { return g.value === st.ground; })[0] || {}).label, cur.time].filter(Boolean).join(' · ')) + '</p></div></header>' +
        '<ul class="gm-clocks gm-ch-clocks">' + ks.map(function (k) {
          var sub = [k.side === 'crew' ? (lg && lg.id === k.id ? 'in play' : k.full ? 'done' : 'next') : 'against', k.hidden ? 'hidden from players' : ''].filter(Boolean).join(' · ');
          if (!op || k.id !== op.id) return clockLi(k.name, k.filled, k.size, sub);
          /* the opposing clock: its own −1 / +1 on its row */
          /* the opposing clock: −1 takes one back; +1, +2, +3 tick it by the consequence (a danger clock, BitD p.16) */
          return clockLi(k.name, k.filled, k.size, sub).replace(/<span class="gm-clockn">[^<]*<\/span><\/li>$/, '<span class="gm-ch-oppb"><button type="button" class="btn sm" data-gm="ch-opp" data-d="-1" aria-label="' + esc(k.name) + ': take one back"' + (k.filled ? '' : ' disabled') + '>−1</button>' +
            '<b class="gm-clockn">' + k.filled + '/' + k.size + '</b>' + [1, 2, 3].map(function (n) { return '<button type="button" class="btn sm" data-gm="ch-opp" data-d="' + n + '" title="A consequence ticks it ' + n + '" aria-label="' + esc(k.name) + ': up ' + n + '"' + (k.full ? ' disabled' : '') + '>+' + n + '</button>'; }).join('') + '</span></li>');
        }).join('') + '</ul>' + chRaceHtml(cur) + '<p class="gm-dim gm-ch-help">' + CH_SPLIT + '</p>' +
        '<div class="gm-ch-tick">' +
        '<label class="gm-field wide" for="gm-ch-cap"><span class="gm-lab">What happened</span><input type="text" id="gm-ch-cap" maxlength="160" autocomplete="off" placeholder="The caption under the panel"></label>' +
        '<label class="gm-field wide" for="gm-ch-roll"><span class="gm-lab">Roll (GM only)</span>' + '<input type="text" id="gm-ch-roll" maxlength="160" autocomplete="off" placeholder="driver · Finesse · position/effect · dice" value="' + esc(G.ROLL_DEFAULT) + '"></label>' +
        '<label class="gm-field wide" for="gm-ch-between"><span class="gm-lab">Between ticks (one per line)</span>' + '<textarea id="gm-ch-between" rows="2" maxlength="900" placeholder="A flashback, a fail before this roll…"></textarea></label>' +
        '<div class="gm-ch-row"><div class="gm-field"><span class="gm-lab">Level</span>' + chSeg('level', G.LEVELS, u.level) + '</div><div class="gm-field"><span class="gm-lab">Time</span>' + chSeg('time', G.TIMES, u.time) + '</div></div>' +
        (lg ? '<p class="gm-ch-leg"><span class="gm-lab">Ticks ' + esc(lg.name) + ' · ' + (lg.size - lg.filled) + ' to go</span></p>' : '<p class="gm-note warn">The crew’s clock is full. Add a leg, or end the chase.</p>') +
        '<div class="gm-ch-ticks">' + [[1, 'Limited'], [2, 'Standard'], [3, 'Great']].map(function (t) { return '<button type="button" class="btn primary gm-ch-plus" data-gm="ch-tick" data-n="' + t[0] + '"' + (lg && K ? '' : ' disabled') + '><b>+' + t[0] + '</b><small>' + t[1] + '</small></button>'; }).join('') + '</div></div>' +
        '<div class="gm-map-acts"><button type="button" class="btn sm primary" data-gm="ch-ipad"' + (K ? '' : ' disabled') + ' title="The player copy at the iPad’s size: no roll lines, no hidden clock. It follows the chase while it is up">Show on iPad</button>' +
        '<button type="button" class="btn sm" data-gm="blankipad" title="Back to the ambient scene (0)">Clear → ambient</button>' +
        '<button type="button" class="btn sm" data-gm="ch-undo"' + (cur.panels.length ? '' : ' disabled') + '>Undo last panel</button>' +
        '<label class="gm-field gm-ch-outf" for="gm-ch-outcome"><span class="sr">How it ended</span><select id="gm-ch-outcome" data-choutcome>' + chOutcomeOpts(cur) + '</select></label>' +
        '<button type="button" class="btn sm bad" data-gm="ch-end">End chase</button></div>' +
        '<details class="gm-more gm-ch-legf"' + (lg ? '' : ' open') + '><summary>Add a leg</summary>' + '<div class="gm-ch-row"><label class="gm-field" for="gm-ch-legname"><span class="gm-lab">Name</span><input type="text" id="gm-ch-legname" maxlength="60" autocomplete="off" placeholder="Land the barge"></label>' +
        chSeg('legSize', G.SIZES, chForm().legSize) + '<button type="button" class="btn sm" data-gm="ch-leg">Add the leg</button></div></details>' +
        '<p class="gm-warn" id="gm-ch-warn" role="status"></p><div class="gm-ch-strip" id="gm-ch-strip" data-layer="gm"></div></section>';
    }
    box.innerHTML = h + chPastHtml();
    if (cur && K) chDraw();
  }
  /* the GM copy in the panel: every clock, the roll lines */
  function chDraw() {
    var el = $q('#gm-ch-strip'), w = $q('#gm-ch-warn'), K = chKit(), cur = chCur(); if (!el || !K || !cur) return;
    var r; try { r = K.chase(cur, { layer: 'gm', layout: isPhone() ? 'phone' : 'ipad', theme: 'rulebook', rolls: true }); } catch (e) { el.innerHTML = ''; if (w) { w.textContent = 'The strip could not be drawn: ' + errText(e); w.classList.add('bad'); } return; }
    el.innerHTML = stripSize(r.svg);       /* the kit's own output from our chase; it escapes its text */
    var warns = (r.warnings || []).map(function (x) { return typeof x === 'string' ? x : x && (x.message || x.msg) || ''; }).filter(Boolean);
    if (w) { w.classList.remove('bad'); w.textContent = 'GM copy: every clock and the roll lines. ' + (cur.panels.length ? cur.panels.length + ' panel' + (cur.panels.length === 1 ? '' : 's') + '. ' : 'No panel yet: the first roll draws one. ') + (warns.length ? warns.length + ' kit note' + (warns.length === 1 ? '' : 's') + ': ' + warns.slice(0, 2).join(' · ') : ''); }
  }
  /* a changed chase: stored whole (replacePatch: a key the new one lacks goes), the panel redrawn, the iPad sent it again when it shows it */
  function chSave(next, extra) {
    var p = { chase: { current: replacePatch(chDoc().current, next) } };
    if (extra) p.chase = Object.assign(p.chase, extra);
    if (!patch(p, { force: true })) return false;
    S.chOutcome = undefined; renderChase(true); chResend();
    return true;
  }
  /* the kit's warnings, if it hands them back on the chase object, are said once and not stored */
  function chClean(c) { var w = c && Array.isArray(c.warnings) ? c.warnings : null; if (w) { delete c.warnings; if (w.length) toast('Map kit: ' + w.slice(0, 2).map(function (x) { return typeof x === 'string' ? x : x && x.message || ''; }).join(' · '), true); } return c; }
  function chStart() {
    var G = W.B68GmChase, K = chKit(), f = chForm(); if (!G || !K) { toast('The chase strip needs map kit 0.6.', true); return; }
    if (chCur()) { toast('A chase is running: end it first.', true); return; }
    var src = f.from === 'location' && S.locRoll ? G.source('location', S.locRoll) : f.from === 'scene' && S.scnRoll ? G.source('scene', S.scnRoll.scene, S.scnRoll.meta && S.scnRoll.meta.title) : G.source('ground', f.ground, nowDistrict());
    var args = G.startArgs(f, src, Math.floor(Math.random() * 4294967296)), ch;
    try { ch = chClean(K.chaseNew(args)); } catch (e) { toast('The chase could not start: ' + errText(e), true); return; }
    if (!isObj(ch)) { toast('The chase could not start.', true); return; }
    if (!ch.id) ch.id = uid('ch');
    if (!Array.isArray(ch.clocks) || !ch.clocks.length) ch.clocks = args.clocks;
    if (!Array.isArray(ch.cast)) ch.cast = args.cast;
    if (!Array.isArray(ch.panels)) ch.panels = [];
    if (!patch({ chase: { current: ch, ui: { level: 'street', time: ch.time === 'Night' ? 'Night' : 'Bluetime' } } }, { force: true })) return;
    S.chForm = null; S.last = { text: 'Chase: ' + G.title(ch) };
    renderChase(true);
    toast('Chase started: ' + G.title(ch) + '. Each tick draws a panel.');
  }
  function chTick(n) {
    var G = W.B68GmChase, K = chKit(), cur = chCur(); if (!G || !K || !cur) return;
    var val = function (id) { var el = $q(id); return el ? el.value : ''; }, u = chUi();
    var a = G.tickArgs(cur, { ticks: n, caption: val('#gm-ch-cap'), roll: val('#gm-ch-roll'), between: val('#gm-ch-between'), level: u.level, time: u.time });
    if (a.error) { toast(a.error, true); return; }
    var asked = a.clamped; delete a.clamped;
    var next; try { next = chClean(K.chaseTick(cur, a)); } catch (e) { toast('The tick failed: ' + errText(e), true); return; }
    if (!isObj(next) || !Array.isArray(next.panels)) { toast('The tick failed.', true); return; }
    if (!chSave(next)) return;
    S.last = { text: 'Chase: ' + (a.caption || G.title(next)) + ' (+' + a.ticks + ')' };
    toast(asked ? 'Only ' + a.ticks + ' left on that leg: ticked ' + a.ticks + ', not ' + asked + '.' : 'Panel ' + next.panels.length + ' drawn (+' + a.ticks + ').', !!asked);
  }
  function chUndo() {
    var G = W.B68GmChase, cur = chCur(); if (!G || !cur || !cur.panels.length) return;
    if (chSave(G.undo(cur))) toast('Took back panel ' + cur.panels.length + '.');
  }
  function chOppose(d) { var G = W.B68GmChase, cur = chCur(); if (G && cur) chSave(G.oppose(cur, d)); }
  function chLeg() {
    var G = W.B68GmChase, cur = chCur(), nm = $q('#gm-ch-legname'); if (!G || !cur) return;
    var next = G.addLeg(cur, nm ? nm.value : '', chForm().legSize), k = next.clocks[next.clocks.length - 1];
    if (chSave(next)) toast('Leg added: ' + k.name + ' (' + k.size + ').');
  }
  function chEnd() {
    var G = W.B68GmChase, cur = chCur(); if (!G || !cur) return;
    var how = S.chOutcome !== undefined ? S.chOutcome : G.outcome(cur).suggest, said = G.OUTCOMES[how] || '';
    if (!W.confirm('End the chase “' + G.title(cur) + '”' + (said ? ': ' + said : '') + '? It moves to Past chases.')) return;
    var plan = G.endPlan(chDoc().past, cur, nowIso(), how);
    if (!patch({ chase: { current: null, past: plan.patch } }, { force: true })) return;
    endChase(); S.chOutcome = undefined; renderChase(true);
    toast('Chase ended: ' + G.title(cur) + (said ? ': ' + said : '') + '.' + (plan.dropped.length ? ' Kept the last ' + G.PAST_MAX + ' chases: dropped ' + plan.dropped.length + ' older (' + plan.dropped.slice(0, 3).join(', ') + ').' : ''), !!plan.dropped.length);
  }
  function chSet(k, v) {
    var f = chForm();
    if (k === 'level' || k === 'time') { var u = {}; u[k] = v; patch({ chase: { ui: u } }); keepDrafts(function () { renderChase(true); }); return; }
    f[k] = k === 'size' || k === 'oppSize' || k === 'legSize' ? +v : v;
    if (k === 'from') f.picked = true;
    keepDrafts(function () { renderChase(true); });
  }
  /* what is typed in the tick box survives a redraw from one of the switches */
  function keepDrafts(fn) {
    var ids = ['#gm-ch-cap', '#gm-ch-roll', '#gm-ch-between', '#gm-ch-legname'], kept = ids.map(function (i) { var el = $q(i); return el ? el.value : null; });
    fn();
    ids.forEach(function (i, n) { var el = $q(i); if (el && kept[n] !== null) el.value = kept[n]; });
  }
  /* The strip on the iPad (the secrecy review of 23/10/2026, as live reveal): S.chOn = { id, seq } is the chase Show on iPad put up and
     the display seq the server answered. Every change sends it again with ifSeq, so it lands only while nothing else has gone to the
     display since: a push from another device in between is a 409, the strip stops following and the page says so. Anything else
     this page pushes ends it at once (pushDisplay), whatever its title; ending the chase ends it too. resend: a follow-up. */
  function endChase() { if (S && S.chOn) { S.chOn = null; clearTimeout(S.chT); } }
  function chShow(quiet, resend) {
    var G = W.B68GmChase, K = chKit(), cur = chCur(), d;
    if (!cur) { if (!quiet) toast('Start a chase first.', true); return; }
    try { d = chaseDisplay(cur, K && K.chase.bind(K), G); } catch (e) { endChase(); toast(errText(e), true); return; }
    gate.mark(d.svg);
    var me = S, id = cur.id;
    if (!resend) endChase();          /* nothing follows until this strip has landed */
    pushDisplay({ kind: 'svg', title: d.title, caption: d.caption, svg: d.svg }, {
      chase: true,
      prepare: resend ? function (body) { return S === me && S.chOn && S.chOn.id === id ? Object.assign({}, body, { ifSeq: S.chOn.seq }) : null; } : null,
      done: function (r) { if (S === me && typeof r.seq === 'number' && (!resend || (S.chOn && S.chOn.id === id))) S.chOn = { id: id, seq: r.seq }; },
      fail: function () { if (S === me && resend) endChase(); }
    }).then(function () {
      if (!quiet) toast('On the iPad: ' + d.title + '. It follows the chase while it is up.');
    }, function (e) {
      if (e.superseded) return;
      if (resend && e.status === 409) toast('Something else is on the iPad now, so the chase was not sent and the strip no longer follows it. Show on iPad sends it again.', true);
      else toast('Could not send the chase: ' + errText(e) + (resend ? '. The strip no longer follows the chase: Show on iPad sends it again.' : ''), true);
    });
  }
  function chOnIpad() { var cur = chCur(); return !!(cur && S.chOn && S.chOn.id === cur.id); }
  function chResend() {
    if (!chOnIpad()) return;
    var me = S; clearTimeout(S.chT);
    S.chT = setTimeout(function () { if (S === me && chOnIpad()) chShow(true, true); }, 300);
  }
  function B68slug(s) { return str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

  /* ---------- the Screen tab (T): the GM screen from the pack's `screen` part, then the full rules search ----------
     The part (scripts/lib/screen-export.mjs) is the vault note with gm_screen: true, cut at its ## headings. Jump chips,
     a filter over the sections' text, and Show on iPad (a 'rule' display, as the rules page sends). Drawn once per part
     version, so the filter and the scroll survive a redraw. */
  var RULE_TERMS = ['position and effect', 'resistance', 'devil’s bargain', 'harm', 'heat', 'engagement roll', 'flashback', 'stress', 'trauma', 'clocks', 'teamwork', 'gather information'];
  function screenSections() { var sc = part('screen'); return isObj(sc) && Array.isArray(sc.sections) ? sc.sections.filter(function (s) { return isObj(s) && s.id && s.md; }) : []; }
  function renderRules() {
    var box = $q('#gm-rules'); if (!box) return;
    var sc = part('screen'), list = screenSections(), p = S.pack && S.pack.parts && S.pack.parts.screen;
    var key = list.length ? 'v:' + (p && p.version || (p && p.src && p.src.blockSha) || list.length) : 'none';
    if (box.getAttribute('data-gs') === key && box.firstChild) return;
    box.setAttribute('data-gs', key);
    var R = W.B68Rules, on = !!(R && R.available && R.available()), h = '';
    if (list.length) {
      h += '<div class="gs"><div class="gs-top"><label class="gm-field wide" for="gm-gs-q"><span class="gm-lab">Find on the screen</span>' +
        '<input type="search" id="gm-gs-q" autocomplete="off" placeholder="armour, heat, a district…"></label>' +
        '<p class="gm-chips gs-jump">' + list.map(function (s) { return '<button type="button" class="chip sm" data-gm="gs-jump" data-id="' + esc(s.id) + '">' + esc(s.title) + '</button>'; }).join('') +
        (on ? '<button type="button" class="chip sm gs-jump-rules" data-gm="gs-rules">The full rules</button>' : '') + '</p></div>' +
        (sc.intro ? '<div class="gs-intro pp-doc">' + md(sc.intro) + '</div>' : '') +
        list.map(function (s) {
          return '<section class="gs-sec" id="gs-' + esc(s.id) + '" data-gs="' + esc(s.id) + '"><h3 class="gs-h"><span>' + esc(s.title) + '</span>' +
            '<button type="button" class="btn sm" data-gm="gs-ipad" data-id="' + esc(s.id) + '" title="Show this section on the iPad">Show on iPad</button></h3><div class="gs-body pp-doc">' + md(s.md) + '</div></section>';
        }).join('') + '<p class="gm-dim gs-none" hidden><span>Nothing on the screen matches.</span>' + (on ? ' <button type="button" class="btn sm" data-gm="rq-find">Search the full rules</button>' : '') + '</p></div>';
    } else h += '<p class="gm-note">No GM screen in the pack yet. It comes from the vault note with <code>gm_screen: true</code>: run <code>npm run gm:pack</code>, then push the pack.</p>';
    h += '<section class="gs-rules"><h3 class="gm-band">The full rules</h3>' + (on ? '<form class="gm-rulesq" data-gm-form="rules"><label class="gm-field wide" for="gm-rq"><span class="gm-lab">Search the rules</span>' + '<input type="search" id="gm-rq" autocomplete="off" placeholder="push yourself, gambits…"></label><button type="submit" class="btn primary">Search</button></form>' +
      '<p class="gm-chips">' + RULE_TERMS.map(function (t) { return '<button type="button" class="chip sm" data-gm="rq" data-q="' + esc(t) + '">' + esc(t) + '</button>'; }).join('') + '</p><div class="gs-hits" id="gm-rq-hits" aria-live="polite"></div>' : '<p class="gm-note">The rules are not available here.</p>') + '</section>';
    box.innerHTML = h;
    var rq = $q('#gm-rq'); if (rq && S.rq) { rq.value = S.rq.q; if (!S.rq.busy) drawRq(); }      /* a rebuilt pane keeps the search it showed */
  }
  /* ---------- the full rules, searched in the pane ----------
     B68Rules is the rules page's own search over the rules this device holds. The hits are listed (title, book and chapter, a
     snippet); one opens in place with Show on iPad (a `rule` display, exactly what the rules page sends) and its twins from the
     other books; "Open in the Rules page" (a new tab) is the way out, and the whole answer when the module cannot search.
     S.rq = { q, hits, total, open: entry | null, empty, busy, err } (this page load only). */
  var RQ_N = 12;
  function rulesApi() { var R = W.B68Rules; return R && typeof R.hits === 'function' && typeof R.entry === 'function' ? R : null; }
  function rulesPage(q) { return '#rules?q=' + encodeURIComponent(q); }
  /* a snippet from the rules module is escaped text with <mark> round the matched words: anything else in it is dropped */
  function snipHtml(s) { return str(s).replace(/<(\/?)mark>|<[^>]*>?/g, function (m, c) { return c === undefined ? '' : m; }); }
  /* openId: the entry to open once the hits are in; or best(hit) -> bool: the first hit it takes opens (the Downtime card's "?"), else the list */
  function rulesSearch(q, openId, best) {
    q = str(q).trim(); if (!q) return;
    var R = rulesApi(), box = $q('#gm-rq-hits'), rq = $q('#gm-rq'); if (rq && rq.value !== q) rq.value = q;
    if (!R || !box) { try { W.open(rulesPage(q), '_blank', 'noopener'); } catch (e) {} return; }
    var me = S, mine = S.rq = { q: q, hits: [], total: 0, open: null, empty: false, busy: true, err: '' };
    drawRq();
    Promise.resolve().then(function () { return R.load ? R.load() : null; }).then(function (c) {
      if (S !== me || S.rq !== mine) return;
      var r = {}; try { r = R.hits(q, RQ_N) || {}; } catch (e) { mine.err = errText(e); }
      mine.hits = Array.isArray(r.hits) ? r.hits : []; mine.total = Math.max(+r.total || 0, mine.hits.length);
      mine.empty = !!(c && Array.isArray(c.entries) && !c.entries.length); mine.busy = false;
      var top = !openId && typeof best === 'function' && !mine.err ? mine.hits.filter(function (x) { return isObj(x) && best(x); })[0] : null;
      if (openId && !mine.err) rulesOpen(openId); else if (top) rulesOpen(top.id); else drawRq(true);
    }, function (e) { if (S !== me || S.rq !== mine) return; mine.busy = false; mine.err = errText(e); drawRq(true); });
  }
  function drawRq(scroll) {
    var box = $q('#gm-rq-hits'), s = S && S.rq; if (!box || !s) return;
    var link = function (href, label) { return '<a class="chip sm gs-out" target="_blank" rel="noopener" href="' + esc(href) + '">' + label + ' ↗</a>'; };
    var h;
    if (s.busy) h = '<p class="gm-dim" role="status">Searching the rules…</p>';
    else if (s.err) h = '<p class="gm-note bad">The rules could not be searched: ' + esc(s.err) + '</p><p>' + link(rulesPage(s.q), 'Open in the Rules page') + '</p>';
    else if (s.open) {
      var o = s.open;
      h = '<div class="gs-hitbar"><button type="button" class="btn sm" data-gm="rq-back">← Results for “' + esc(shortLabel(s.q, 28)) + '”</button>' + link(o.href, 'Open in the Rules page') + '</div>' +
        '<section class="gs-sec gs-entry"><h3 class="gs-h"><span>' + esc(o.title) + (o.caption ? ' <small>' + esc(o.caption) + '</small>' : '') + '</span>' +
        '<button type="button" class="btn sm" data-gm="rq-ipad" title="Show this entry on the iPad">Show on iPad</button></h3><div class="gs-body pp-doc">' + md(o.md) + '</div></section>' +
        (Array.isArray(o.also) && o.also.length ? '<p class="gs-also"><span class="gm-lab">Also</span>' + o.also.map(function (a) { return '<button type="button" class="chip sm" data-gm="rq-open" data-id="' + esc(a.id) + '">' + esc(a.label) + '</button>'; }).join('') + '</p>' : '');
    } else if (!s.hits.length) {
      h = '<p class="gm-note">' + (s.empty ? 'No rules are imported yet: the GM imports them on the Rules page.' : 'Nothing in the rules matches “' + esc(s.q) + '”.') + '</p><p>' + link(s.empty ? '#rules' : rulesPage(s.q), 'Open in the Rules page') + '</p>';
    } else {
      h = '<div class="gs-hitbar"><span class="gm-lab">' + (s.total > s.hits.length ? s.hits.length + ' of ' + s.total : s.total) + ' for “' + esc(shortLabel(s.q, 28)) + '”</span>' + link(rulesPage(s.q), 'Open in the Rules page') + '</div>' +
        '<ol class="gs-hitlist">' + s.hits.map(function (x) {
          return '<li><button type="button" class="gs-hit" data-gm="rq-open" data-id="' + esc(x.id) + '"><span class="gs-hit-t">' + (x.titleHtml ? snipHtml(x.titleHtml) : esc(x.title)) + '</span><span class="gs-hit-c">' + esc(x.caption) + '</span>' +
            (x.snip ? '<span class="gs-hit-s">' + snipHtml(x.snip) + '</span>' : '') + '</button></li>';
        }).join('') + '</ol>';
    }
    box.innerHTML = h;
    if (scroll) rulesIntoView();
  }
  /* the search box with its results under it, at the top of the pane (a pane that scrolls on its own, or the page under the phone's bars) */
  function rulesIntoView() {
    var sec = $q('.gs-rules'); if (!sec || typeof sec.scrollIntoView !== 'function') return;
    var smooth = true; try { smooth = !(W.matchMedia && W.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) {}
    try { sec.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' }); } catch (e) { try { sec.scrollIntoView(); } catch (x) {} }
  }
  function rulesOpen(id) {
    var R = rulesApi(), s = S.rq; if (!R || !s) return;
    var x = null; try { x = R.entry(str(id)); } catch (e) { x = null; }
    if (!x) { toast('That entry is not in the rules this device holds.', true); return; }
    s.open = x; drawRq(true);
  }
  function rulesToIpad() {
    var o = S.rq && S.rq.open; if (!o) return;
    pushDisplay({ kind: 'rule', title: str(o.title).slice(0, 2000), caption: str(o.caption).slice(0, 2000), md: str(o.md).slice(0, 40000) || '—' })
      .then(function () { toast('On the iPad: ' + o.title + '.'); }, function (e) { toast('Could not send to the iPad: ' + errText(e), true); });
  }
  /* rules for Find, from the copy this device holds (Find never starts a download): a few hits, each opening in the GM screen pane */
  function rulesFindHits(q) {
    var R = rulesApi(), t = str(q).trim(); if (!R || t.length < 2) return [];
    var r = null; try { r = R.hits(t, 6); } catch (e) { return []; }
    return (r && Array.isArray(r.hits) ? r.hits : []).map(function (x) { return { kind: 'Rules', title: x.title, sub: x.caption, snipHtml: snipHtml(x.snip), go: { t: 'rule', id: x.id, q: t } }; });
  }
  /* every word of the query somewhere in a section's title or text */
  function filterScreen(q) {
    var box = $q('#gm-rules'); if (!box) return;
    var words = str(q).toLowerCase().split(/\s+/).filter(Boolean), shown = 0;
    box.querySelectorAll('.gs .gs-sec').forEach(function (sec) {
      var t = sec.textContent.toLowerCase(), hit = words.every(function (w) { return t.indexOf(w) >= 0; });
      sec.hidden = !hit; if (hit) shown++;
      var chip = box.querySelector('[data-gm="gs-jump"][data-id="' + sec.getAttribute('data-gs') + '"]'); if (chip) chip.hidden = !hit;
    });
    var none = box.querySelector('.gs-none');
    if (none) { none.hidden = shown > 0; var rb = none.querySelector('[data-gm="rq-find"]'); if (rb) rb.textContent = 'Search the full rules for “' + shortLabel(q, 30) + '”'; }
  }
  /* Enter in "Find on the screen": the first section that still shows, or, with none left, the full rules for the same words */
  function screenFindGo() {
    var q = $q('#gm-gs-q'), v = q ? str(q.value).trim() : ''; if (!v) return;
    var first = [].filter.call(S.root.querySelectorAll('#gm-rules .gs .gs-sec'), function (s) { return !s.hidden; })[0];
    if (first) { screenJump(first.getAttribute('data-gs')); flash(first); } else rulesSearch(v);
  }
  function screenJump(id) { var sec = $q('#gm-rules [data-gs="' + str(id).replace(/"/g, '') + '"]'); if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  function screenToIpad(id) {
    var s = screenSections().filter(function (x) { return x.id === id; })[0]; if (!s) return;
    pushDisplay({ kind: 'rule', title: s.title.slice(0, 2000), caption: 'GM screen', md: s.md.slice(0, 40000) })
      .then(function () { toast('On the iPad: ' + s.title + '.'); }, function (e) { toast('Could not send to the iPad: ' + errText(e), true); });
  }

  /* ---------- the rail ---------- */
  function renderRail() {
    var box = $q('#gm-rail'); if (!box) return;
    var d = isObj(camp) ? camp : {}, crew = isObj(d.crew) ? d.crew : {}, h = prepPinsHtml();
    function stat(k, v, max) { return '<div class="gm-stat"><dt>' + k + '</dt><dd>' + (v == null ? '—' : esc(v) + (max ? '<small>/' + max + '</small>' : '')) + '</dd></div>'; }
    h += '<section class="gm-box"><h3 class="gm-band">Crew' + (crew.name ? ': ' + esc(crew.name) : '') + '</h3><dl class="gm-stats">' + stat('Heat', +crew.heat || 0, 9) + stat('Wanted', +crew.wanted || 0, 4) + stat('Rep', +crew.rep || 0, 12) + stat('Stacks', +crew.stacks || 0) + stat('Vault', +crew.vault || 0, 16) + '</dl>' +
      '<p class="gm-dim">Session ' + esc(isObj(d.session) ? +d.session.number || 0 : 0) + ' · read-only here; change it on <a href="#t">the table</a>.</p></section>';
    var tc = Array.isArray(d.clocks) ? d.clocks : [];
    function none(title) { return '<section class="gm-box gm-box-empty"><h3 class="gm-band">' + title + ' <small>· none</small></h3></section>'; }
    h += tc.length ? '<section class="gm-box"><h3 class="gm-band">Table clocks</h3><ul class="gm-clocks">' + tc.map(function (c) { return clockLi(c.name, c.filled, c.size, c.hidden ? 'hidden from players' : c.kind); }).join('') + '</ul>' +
      (tc.some(function (c) { return isObj(c) && !c.hidden; }) ? '<p class="gm-clockacts"><button type="button" class="btn sm" data-gm="clocks-ipad" title="The clocks the players may see, on the iPad; they follow the table while up">Show on iPad</button></p>' : '') + '</section>' : none('Table clocks');
    var wc = (part('campaign') || {}).clocks; wc = Array.isArray(wc) ? wc : [];
    h += wc.length ? '<section class="gm-box"><h3 class="gm-band">World clocks <small>(pack)</small></h3><ul class="gm-clocks">' + wc.map(function (c) { return clockLi(c.goal || c.name, c.filled, c.segments || c.size, [c.faction, c.tier != null && c.tier !== '' ? 'Tier ' + c.tier : ''].filter(Boolean).join(' · ')); }).join('') + '</ul></section>' : none('World clocks');
    var owed = []; try { owed = W.B68GmConsole ? W.B68GmConsole.campaignWith(part('campaign') || {}, S.doc.con || {}).owed : []; } catch (e) { owed = []; }
    h += owed.length ? '<section class="gm-box"><h3 class="gm-band">Bargains owed</h3><ul class="gm-owed">' + owed.map(function (o, i) { return '<li><span>' + esc(o.text) + (o.src ? ' <small>' + esc(o.src) + '</small>' : '') + '</span><button type="button" class="btn sm" data-gm="collect" data-i="' + i + '">Collect</button></li>'; }).join('') + '</ul></section>' : none('Bargains owed');
    S.owed = owed;
    var pins = newest(S.doc.pins);
    h += '<section class="gm-box"><h3 class="gm-band">Pins <small>' + pins.length + '/' + LIMITS.pins + '</small></h3>' + (pins.length ? '<ul class="gm-pins">' + pins.map(function (p) {
      var open = S.pinOpen === p._id;
      return '<li><div class="gm-pinrow"><button type="button" class="chip txt sm" data-gm="pinopen" data-id="' + esc(p._id) + '" aria-expanded="' + open + '">' + esc(p.label || p.title || 'Pinned') + '</button><button type="button" class="gm-x" data-gm="unpin" data-id="' + esc(p._id) + '" aria-label="Unpin">×</button></div>' + (open ? '<pre class="gm-pintext">' + esc(p.text || '') + '</pre>' : '') + '</li>';
    }).join('') + '</ul>' : '<p class="gm-dim">Pin a card to keep it here.</p>') + '</section>';
    var sc = isObj(d.scene) && isObj(d.scene.npcs) ? d.scene.npcs : {}, staged = Object.keys(sc).filter(function (id) { return sc[id] === true; });
    h += '<section class="gm-box"><h3 class="gm-band">On stage</h3><p class="gm-chips">' + (staged.length ? staged.map(function (id) {
      var n = S.npcs[id], nm = n && n.name || id;
      return '<span class="gm-onstage"><a class="chip sm" href="#cast/' + encodeURIComponent(id) + '">' + esc(nm) + '</a>' + (n && scAvail() ? '<button type="button" class="chip sm gm-sc-job" data-gm="scorestage" data-id="' + esc(id) + '" aria-label="A job for ' + esc(nm) + '" title="A job for them: the Score tab, with them as the client, and a roll">Job</button>' : '') + '</span>';
    }).join('') : '<a class="chip sm" href="#cast">Nobody: the cast</a>') + '</p></section>';
    box.innerHTML = h;
    if (box.querySelector('.pp-pinbox')) decoratePrep(box);
  }
  function clockLi(name, filled, size, sub) {
    var n = Math.max(1, Math.min(12, Math.floor(+size || 4))), f = Math.max(0, Math.min(n, Math.floor(+filled || 0))), seg = '';
    for (var i = 0; i < n; i++) seg += '<i' + (i < f ? ' class="on"' : '') + '></i>';
    return '<li><span class="gm-clockname">' + esc(name || 'Clock') + (sub ? ' <small>' + esc(sub) + '</small>' : '') + '</span><span class="gm-clock" aria-label="' + f + ' of ' + n + '">' + seg + '</span><span class="gm-clockn">' + f + '/' + n + '</span></li>';
  }

  /* ---------- capture ---------- */
  function renderCapture() {
    var box = $q('#gm-foot'); if (!box) return;
    var inp = $q('#gm-cap-in'), keep = inp && W.document.activeElement === inp ? inp.value : null;
    var all = newest(S.doc.capture);
    box.innerHTML = '<div class="gm-cap"><div class="seg gm-capb" role="group" aria-label="File as">' + BUCKETS.map(function (b) { return '<button type="button" class="chip sm" data-gm="arm" data-b="' + b.k + '" aria-pressed="' + (S.arm === b.k) + '">' + esc(b.label) + ' <kbd>' + b.key + '</kbd></button>'; }).join('') + '</div>' +
      '<form class="gm-capf" data-gm-form="capture"><label class="sr" for="gm-cap-in">Capture</label><input type="text" id="gm-cap-in" maxlength="' + LIMITS.captureText + '" autocomplete="off" placeholder="' + esc(placeholder(S.arm)) + '"><button type="submit" class="btn primary">File</button></form>' +
      '<div class="gm-capacts"><span class="gm-dim">' + all.length + ' filed</span><button type="button" class="btn sm" data-gm="last" title="L">File last roll</button></div></div>' +
      (all.length ? '<ol class="gm-caplist">' + all.slice(0, 3).map(function (e) { var b = BUCKETS.filter(function (x) { return x.k === e.bucket; })[0]; return '<li><span class="gm-lab">' + esc(b ? b.label : e.bucket) + '</span> ' + esc(e.text) + '</li>'; }).join('') + '</ol>' : '');
    if (keep !== null) { var i = $q('#gm-cap-in'); if (i) { i.value = keep; i.focus(); } }
  }
  function placeholder(b) { return b === 'n' ? 'A name you just made up…' : b === 'x' ? 'A thread left hanging…' : b === 'm' ? 'A moment worth remembering…' : 'A roll worth keeping…'; }
  function arm(b, focus) {
    S.arm = b;
    var r = $q('#gm-root'); if (r) r.querySelectorAll('[data-gm="arm"]').forEach(function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-b') === b)); });
    var i = $q('#gm-cap-in'); if (i) i.placeholder = placeholder(b);
    if (focus) { if (!S.capOpen && isPhone()) { S.capOpen = true; syncPanels(); } if (i) { try { i.focus(); } catch (e) {} } }
  }
  function addCapture(bucket, text, quiet) {
    text = str(text).replace(/\s+/g, ' ').trim().slice(0, LIMITS.captureText); if (!text) return false;
    var id = uid('c'), entry = captureEntry(id, bucket, text, nowIso(), camp);
    /* capture has a byte budget of its own (E18): earlier sessions' oldest lines make room; a session that alone fills it files no more text */
    var plan = capturePlan(S.doc.capture, id, entry, sessionOf(camp));
    if (plan.refused) { toast(CAP_FULL, true); return false; }
    if (!patch({ capture: plan.patch })) return false;
    S.capId = id;       /* the line just filed, for the co-GM's Undo */
    var said = capDropped(plan.dropped.length);       /* a toast has one line: "Filed under ..." must not cover what was dropped */
    renderCapture();
    if (!quiet && !said) { var b = BUCKETS.filter(function (x) { return x.k === bucket; })[0]; toast('Filed under ' + (b ? b.head : bucket) + '.'); }
    return said ? 'said' : true;     /* 'said': filed, and the toast already up must stand */
  }
  function fileLast() { if (!S.last) { toast('Nothing rolled yet.', true); return; } if (addCapture('r', S.last.text)) assistRolled(); }
  /* a console result tapped or a roll filed (L): the Blade panel sends one tick 40 s later so Ref looks at that roll (assist-panel.js, rolled) */
  function assistRolled() { if (S && S.assist && typeof S.assist.rolled === 'function') { try { S.assist.rolled(); } catch (e) {} } }
  /* in the Menu (and the old header): the capture bar keeps only File and File last roll */
  function clearCapture() {
    var all = newest(S.doc.capture); if (!all.length) { toast('Nothing filed tonight.'); return; }
    if (!W.confirm('Clear all ' + all.length + ' captured lines? Export tonight’s note first if you want them.')) return;
    var p = {}; all.forEach(function (e) { p[e._id] = null; }); patch({ capture: p }, { force: true }); renderCapture();
  }
  function exportTonight() {
    var n = isObj(camp) && isObj(camp.session) ? +camp.session.number || 0 : 0, x = exportNote(S.doc, { session: n });
    save(x.filename, x.text);
  }

  /* ---------- pins and copy ---------- */
  function cardFor(tool) {
    if (tool === 'console' || tool === 'situation') { var r = S.conRes; return r ? { label: str(r.meta.label), title: str(r.meta.title), text: r.sections ? situationPlain(r) : consolePlain(r) } : null; }
    if (tool === 'scenes' || tool === 'downtime') { var g = tool === 'scenes' ? S.scnRoll : S.dtRoll; return g ? { label: str(g.meta.label), title: str(g.meta.title), text: g.meta.all.join('\n') } : null; }
    if (tool === 'score') { var sr = S.scRoll; return sr ? { label: str(sr.card.meta.label), title: str(sr.card.meta.title), text: sr.card.meta.all.join('\n') } : null; }
    if (tool === 'npc') { var nr = S.npcRoll; return nr ? { label: str(nr.roll.card.meta.label), title: str(nr.roll.card.meta.title), text: nr.roll.card.meta.all.join('\n') } : null; }
    var L = W.B68GmLocation, roll = S.locRoll; if (!L || !roll) return null;
    var lines = []; try { lines = L.cardLines(roll, part('location')); } catch (e) {}
    return { label: str(roll.name) + (roll.district ? ' · ' + roll.district : ''), title: str(roll.name), text: lines.map(plainMd).join('\n') };
  }
  /* a pinned location is its glance card (the whole card ran past the pin's 1500 characters); Copy keeps the whole card */
  function pinFor(tool) {
    var L = W.B68GmLocation, roll = S.locRoll;
    if (tool !== 'location' || !L || !roll || !L.glanceLines) return cardFor(tool);
    var lines = []; try { lines = L.glanceLines(roll, part('location'), revealList(mapUi())); } catch (e) { return cardFor(tool); }
    return { label: str(roll.name) + (roll.district ? ' · ' + roll.district : ''), title: str(roll.name), text: lines.map(plainMd).join('\n') };
  }
  function pin(tool) {
    var c = pinFor(tool); if (!c) return;
    var id = uid('p'), e = { tool: tool, label: c.label.slice(0, 120), title: c.title.slice(0, 120), text: c.text.slice(0, 1500), at: nowIso() };
    if (patch({ pins: addCapped(S.doc.pins, id, e, LIMITS.pins) })) { toast('Pinned.'); renderRail(); }
  }
  function copy(tool) { var c = cardFor(tool); if (c && S.api && S.api.copy) S.api.copy(c.text, 'Copied.'); }

  /* ---------- blank screen ---------- */
  var blankEl = null;
  function blank() {
    if (blankEl) return;
    blankEl = document.createElement('div'); blankEl.className = 'gm-blank'; blankEl.setAttribute('role', 'presentation'); blankEl.tabIndex = -1;
    blankEl.addEventListener('pointerdown', function (ev) { ev.preventDefault(); unblank(); });
    blankEl.addEventListener('click', function (ev) { ev.preventDefault(); unblank(); });
    document.body.appendChild(blankEl); try { blankEl.focus(); } catch (e) {}
  }
  function unblank() { if (blankEl && blankEl.parentNode) blankEl.parentNode.removeChild(blankEl); blankEl = null; }
  /* a plain H: the second within a second blanks; the first alone says how (once per page load) */
  var blankHinted = false;
  function blankTap() {
    var now = Date.now();
    if (S.blankAt && now - S.blankAt < 1000) { S.blankAt = 0; blank(); return; }
    S.blankAt = now;
    if (!blankHinted) { blankHinted = true; toast('H again within a second (or Shift+H) blanks the laptop.'); }
  }
  /* a panel opened by its key: Prep and the GM screen take the typing into their find box, so letters land there and not on
     the shortcuts */
  function focusPane(panel) {
    var q = panel === 'prep' ? $q('#gm-prep-q') : panel === 'rules' ? $q('#gm-gs-q') : null; if (!q) return;
    try { q.focus(); q.select(); } catch (e) {}
  }
  function isPhone() { try { return W.matchMedia && W.matchMedia('(max-width: 599px)').matches; } catch (e) { return false; } }

  /* ---------- events ---------- */
  function typing(t) { if (!t || t === document.body) return false; var n = (t.tagName || '').toLowerCase(); return n === 'input' || n === 'textarea' || n === 'select' || !!t.isContentEditable; }
  function onKey(ev) {
    if (blankEl) { ev.preventDefault(); ev.stopPropagation(); unblank(); return; }
    if (!S || S.status !== 'ready' || document.body.dataset.mode !== 'gm') return;
    var dlg = document.querySelector('dialog[open]'); if (dlg) return;
    /* with the focus inside the Blade panel, J and K move between its cards and U undoes: the panel's own keys, not Score or anything else */
    var pel = S.assist && typeof S.assist.el === 'function' ? S.assist.el() : null;
    if (pel && ev.target && pel.contains && pel.contains(ev.target) && !ev.ctrlKey && !ev.metaKey && !ev.altKey && /^[jku]$/i.test(str(ev.key))) return;
    /* a focused task box or tick cell in the Prep tab: Space or Enter ticks it */
    var tg = ev.target;
    if ((ev.key === ' ' || ev.key === 'Enter') && tg && tg.matches && S.root.contains(tg) && tg.matches('.rl-task[data-task], td[data-cell]')) {
      ev.preventDefault(); if (tg.hasAttribute('data-task')) prepTick(tg.getAttribute('data-task')); else prepCell(tg); return;
    }
    /* Find: Ctrl+K (or Cmd+K) anywhere opens and shuts it; while open, its own keys only */
    if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && str(ev.key).toLowerCase() === 'k') { ev.preventDefault(); if (findOn()) findClose(); else findOpen(); return; }
    if (findOn()) {
      if (ev.key === 'Escape') { ev.preventDefault(); findClose(); return; }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); findMove(ev.key === 'ArrowDown' ? 1 : -1); return; }
      if (ev.key === 'Enter' && tg && tg.id === 'gm-find-q') { ev.preventDefault(); findGo(S.findSel || 0); }
      return;
    }
    /* a speaker's name: Enter saves it (the change event); the note's find box: Enter goes to the first match */
    if (ev.key === 'Enter' && tg && tg.hasAttribute && tg.hasAttribute('data-sttspk')) { ev.preventDefault(); tg.blur(); return; }
    if (ev.key === 'Enter' && tg && tg.id === 'gm-prep-q') { ev.preventDefault(); prepFindGo(); return; }
    if (ev.key === 'Enter' && tg && tg.id === 'gm-gs-q') { ev.preventDefault(); screenFindGo(); return; }
    if (ev.key === 'Enter' && tg && tg.id === 'gm-dt-d100') { ev.preventDefault(); dtD100(tg.value); return; }     /* the morning's d100 */
    var ml = $q('.gm-menu-list'); if (ml && !ml.hasAttribute('hidden') && ev.key === 'Escape') { menuOpen(false); var mb = $q('[data-gm="menu"]'); if (mb) mb.focus(); ev.preventDefault(); return; }
    if (runKey(ev)) return;
    var a = keyAction({ key: ev.key, ctrlKey: ev.ctrlKey, altKey: ev.altKey, metaKey: ev.metaKey, typing: typing(ev.target) });
    if (!a) return;
    if (a.type === 'esc') { var t = ev.target; if (t && t.blur && typing(t)) { t.blur(); ev.preventDefault(); } else if (S.assist && S.assist.isOpen()) { S.assist.close(); ev.preventDefault(); } return; }
    if (a.type === 'reserved') return;
    ev.preventDefault();
    if (a.type === 'situation') rollSituation(a.n);
    else if (a.type === 'panel') { setPanel(a.panel); if (isPhone()) { S.seg = 'side'; syncPanels(); } else focusPane(a.panel); }
    else if (a.type === 'capture') arm(a.bucket, true);
    else if (a.type === 'last') fileLast();
    else if (a.type === 'blank') blank();
    else if (a.type === 'blank-tap') blankTap();
    else if (a.type === 'clear') blankIpad();
    else if (a.type === 'focus') toggleFocus();
    else if (a.type === 'find') findOpen();
    else if (a.type === 'assist') { if (S.assist) S.assist.toggle(); else toast('Blade is not available on this page.', true); }
    else if (a.type === 'undo') { if (S.assist && typeof S.assist.undoNewest === 'function') S.assist.undoNewest(); }
  }
  function toggleFocus() { S.prepWide = !S.prepWide; try { W.localStorage.setItem(PREP_WIDE, S.prepWide ? '1' : '0'); } catch (e) {} syncPanels(); }
  function onClick(ev) {
    if (!S || !ev.target.closest) return;
    /* the Prep tab: a link in a note, a task box, a tick-column cell (no data-gm: they come from the renderer) */
    var pl = ev.target.closest('a[href^="#pp:"]'); if (pl && S.root.contains(pl)) { ev.preventDefault(); prepLink(pl.getAttribute('href')); return; }
    var pt = ev.target.closest('.rl-task[data-task]'); if (pt && S.root.contains(pt)) { ev.preventDefault(); prepTick(pt.getAttribute('data-task')); return; }
    var pc = ev.target.closest('td[data-cell]'); if (pc && S.root.contains(pc)) { prepCell(pc); return; }
    if (ev.target.id === 'gm-find') { findClose(); return; }      /* a click on the dimmed page around Find shuts it */
    var inMenu = ev.target.closest('.gm-menu');
    if (!inMenu || ev.target.closest('.gm-menu-list')) menuOpen(false);   /* a click outside the menu, or on one of its items: it closes */
    var b = ev.target.closest('[data-gm]'); if (!b || !S.root.contains(b)) return;
    var a = b.getAttribute('data-gm');
    switch (a) {
      case 'menu': { var ml2 = $q('.gm-menu-list'); menuOpen(!!(ml2 && ml2.hasAttribute('hidden'))); break; }
      case 'focus': toggleFocus(); break;
      case 'find-open': findOpen(); break;
      case 'find-go': findGo(+b.getAttribute('data-i')); break;
      case 'beat-go': beatGo(); break;
      case 'beat-next': beatNext(); break;
      case 'clocks-ipad': clocksToIpad(false); break;
      case 'ch-set': chSet(b.getAttribute('data-k'), b.getAttribute('data-v')); break;
      case 'ch-start': chStart(); break;
      case 'ch-tick': chTick(+b.getAttribute('data-n')); break;
      case 'ch-undo': chUndo(); break;
      case 'ch-opp': chOppose(+b.getAttribute('data-d')); break;
      case 'ch-leg': chLeg(); break;
      case 'ch-end': chEnd(); break;
      case 'ch-ipad': chShow(false); break;
      case 'stt-name': { var spn = b.getAttribute('data-sp'); STT.fold = true; renderStt(true); var si = $q('#gm-stt-s' + spn); if (si) { si.focus(); try { si.select(); } catch (e) {} } break; }
      case 'retry': load(); break;
      case 'upload': upload(); break;
      case 'cancel-import': start(); break;
      case 'update': importScreen(true); break;
      case 'forget': forget(); break;
      case 'note': exportTonight(); break;
      case 'seg': { var sg = b.getAttribute('data-seg'); if (SIDE.indexOf(sg) >= 0) { S.seg = 'side'; setPanel(sg); } else { S.seg = sg; syncPanels(); } break; }
      case 'panel': setPanel(b.getAttribute('data-panel')); break;
      case 'scene': S.sceneOpen = !S.sceneOpen; syncPanels(); break;
      case 'capopen': S.capOpen = !S.capOpen; syncPanels(); if (S.capOpen) { var ci = $q('#gm-cap-in'); if (ci) ci.focus(); } break;
      case 'roll': rollConsole(+b.getAttribute('data-n')); break;
      case 'situation': rollSituation(+b.getAttribute('data-n')); break;
      case 'pos': setPos(b.getAttribute('data-v')); break;
      case 'dots': setDots(b.getAttribute('data-v')); break;
      case 'rackclear': rackClear(); break;
      case 'voiceclear': S.voice = null; renderRack(); break;
      case 'ho-show': showHandout(b.getAttribute('data-id')); break;
      case 'another': voiceAnother(); break;
      case 'intent': doIntent(+b.getAttribute('data-i')); break;
      case 'replay': {
        var tool = b.getAttribute('data-tool'), e = newest(isObj(S.doc.hist) ? S.doc.hist[tool] : null).filter(function (x) { return x._id === b.getAttribute('data-h'); })[0]; if (!e) break;
        var cur = {}; Object.keys(e).forEach(function (k) { if (k !== '_id') cur[k] = e[k]; }); cur.hid = e._id;
        cur.at = nowIso();      /* the current card now: after a reload the newest of the two still shows */
        var cp = { cards: {} }; cp.cards[tool] = replacePatch(isObj(S.doc.cards) ? S.doc.cards[tool] : null, cur); patch(cp, { force: true });   /* replaces the stored card: no key of the card it was survives */
        if (tool === 'console' || tool === 'situation') { S.conRes = null; drawConsoleCard(); }
        else if (tool === 'scenes') { S.scnRoll = null; renderScenes(); }
        else if (tool === 'npc') { S.npcRoll = null; renderNpcGen(); }
        else if (tool === 'downtime') { S.dtRoll = null; S.dtSig = null; renderDowntime(); }
        else if (tool === 'score') { S.scRoll = null; S.scSig = null; renderScore(); }
        else { S.locRoll = null; S.map = null; renderLocation(); }
        break;
      }
      case 'stt-on': sttPatch({ want: 'on', session: String(isObj(camp) && isObj(camp.session) ? +camp.session.number || '' : '') }); break;
      case 'stt-off': sttPatch({ want: 'off' }); break;
      case 'opp-add': oppAdd(); break;
      case 'opp-show': oppShow(b.getAttribute('data-mode')); break;
      case 'opp-one': oppShow('carousel', b.getAttribute('data-id')); break;
      case 'opp-move': oppMove(b.getAttribute('data-id'), +b.getAttribute('data-d')); break;
      case 'opp-del': oppDel(b.getAttribute('data-id')); break;
      case 'prep-go': prepGo(b.getAttribute('data-id')); break;
      case 'prep-pin': prepPin(b.getAttribute('data-sec')); break;
      case 'prep-beat': prepBeat(b); break;
      case 'prep-wide': toggleFocus(); break;
      case 'prep-peekx': { var pk2 = $q('#gm-prep-peek'); if (pk2) { pk2.hidden = true; pk2.innerHTML = ''; } break; }
      case 'pin': pin(b.getAttribute('data-tool')); break;
      case 'gs-jump': screenJump(b.getAttribute('data-id')); break;
      case 'gs-ipad': screenToIpad(b.getAttribute('data-id')); break;
      case 'rq': rulesSearch(b.getAttribute('data-q')); break;
      case 'rq-find': { var gq = $q('#gm-gs-q'); if (gq) rulesSearch(gq.value); break; }
      case 'rq-open': rulesOpen(b.getAttribute('data-id')); break;
      case 'rq-back': if (S.rq) { S.rq.open = null; drawRq(true); } break;
      case 'rq-ipad': rulesToIpad(); break;
      case 'gs-rules': { rulesIntoView(); var rbx = $q('#gm-rq'); if (rbx) { try { rbx.focus(); } catch (e) {} } break; }
      case 'copy': copy(b.getAttribute('data-tool')); break;
      case 'locroll': rollLocation(); break;
      case 'scnroll': rollScenes(); break;
      case 'npcroll': rollNpc(); break;
      case 'npcloc': npcFromLocation(); break;
      case 'npcfile': fileNpc(); break;
      case 'scnipad': scenesToIpad(); break;
      case 'scoreroll': rollScore(); break;
      case 'scorebump': scBump(str(b.getAttribute('data-row'))); break;
      case 'scorecards': scToCards(); break;
      case 'scoresite': scRollSite(); break;
      case 'scoreface': scFace(); break;
      case 'scoreclock': scClock(); break;
      case 'npcjob': { var jr = S.npcRoll; if (jr) scAsk(scFromRoll(jr.roll.npc)); break; }
      case 'scorestage': { var jd = S.npcs[b.getAttribute('data-id')]; if (jd) scAsk(scFromDoc(b.getAttribute('data-id'), jd)); break; }
      case 'dt-who': dtSetWho(str(b.getAttribute('data-id'))); break;
      case 'dt-act': dtSetAct(b.getAttribute('data-v')); break;
      case 'dt-roll': rollDowntime(str(b.getAttribute('data-v'))); break;
      case 'dt-over': dtRedraw({ res: b.getAttribute('data-v') === 'in' ? '' : 'over', keep: '', deal: '' }); break;
      case 'dt-d100': { var df = $q('#gm-dt-d100'); dtD100(df ? df.value : ''); break; }
      case 'dt-d100-roll': dtD100Roll(); break;
      case 'dt-d100-clear': dtD100Clear(); break;
      case 'dt-keep': dtKeep(str(b.getAttribute('data-v'))); break;
      case 'dt-deal': dtDeal(); break;
      case 'dt-clock': dtClock(+b.getAttribute('data-i')); break;
      case 'dt-rule': dtRule(); break;
      case 'layer': setMap('layer', b.getAttribute('data-v')); if (b.getAttribute('data-v') !== 'player') endLive(); renderLocation(); break;
      case 'draw': drawMap(); break;
      case 'room-open': roomOpen(str(b.getAttribute('data-room')), true); break;
      case 'room-close': roomOpen(str(b.getAttribute('data-room')), false); break;
      case 'run-floor': runSetFloor(str(b.getAttribute('data-v'))); break;
      case 'run-step': runStep(+b.getAttribute('data-d') || 0); break;
      case 'run-next': runNext(); break;
      case 'run-dawn': runDawn(); break;
      case 'run-pc': runArm('pc', str(b.getAttribute('data-id'))); break;
      case 'run-clock': runArm('clock', str(b.getAttribute('data-id'))); break;
      case 'run-room': runRoom(str(b.getAttribute('data-room'))); break;
      case 'run-disarm': S.runArm = null; runPaint(); break;
      case 'ipad': showOnIpad(); break;
      case 'pushtext': pushText(); break;
      case 'blankipad': blankIpad(); break;
      case 'darkipad': darkIpad(); break;
      case 'scorescene': setScoreScene(); break;
      case 'sitesave': saveSite(); break;
      case 'siteopen': openSite(str(b.getAttribute('data-score'))); break;
      case 'siteauth': openAuthored(str(b.getAttribute('data-score'))); break;
      case 'siteroll': rollSite(str(b.getAttribute('data-score'))); break;
      case 'siteclear': clearSite(str(b.getAttribute('data-score'))); break;
      case 'ambretry': loadAmbient(); break;
      case 'ambmode': { var am = b.getAttribute('data-v'); if (am === 'pin') patchAmbient({ mode: 'pin', scene: AM.doc && ipadView(AM.doc).scene || 'harvest' }); else patchAmbient({ mode: am }); break; }
      case 'ambscene': patchAmbient({ mode: 'pin', scene: b.getAttribute('data-id') }); break;
      case 'ambskip': patchAmbient({ skip: true }); break;
      case 'clearoverlay': clearOverlay(); break;
      case 'aptoggle': apToggle(); break;
      case 'apoff': apSwitchOff(); break;
      case 'clearscore': patchAmbient({ score: null }); break;
      case 'dlsvg': if (!S.map) toast('Draw the map first.', true); else if (S.map.layer === 'player' && S.map.leak) toast(P.LEAK_MSG, true); else save(slug(S.locRoll && S.locRoll.name) + '-' + S.map.view + '-' + S.map.theme + '-' + S.map.layer + '.svg', S.map.svg); break;
      case 'dlnote': if (S.locRoll && W.B68GmLocation) save(slug(S.locRoll.name) + '.md', W.B68GmLocation.noteBody(S.locRoll, { date: dmy(new Date()) })); break;
      case 'dlcanvas': if (S.locRoll && W.B68GmLocation) save(slug(S.locRoll.name) + '.canvas', W.B68GmLocation.canvas(S.locRoll, part('location'))); break;
      case 'npcipad': npcToIpad(b.getAttribute('data-id')); break;
      case 'npcstage': stageNpc(b.getAttribute('data-id')); break;
      case 'collect': { var o = S.owed && S.owed[+b.getAttribute('data-i')]; if (!o || !W.B68GmConsole) break; patch({ con: W.B68GmConsole.intentPatch({ type: 'bargainCollected', key: W.B68GmConsole.keyOf(o.text), text: o.text }) }); try { S.con && S.con.setCampaign(part('campaign') || {}, S.doc.con || {}); } catch (x) {} toast('Collected.'); renderRail(); break; }
      case 'pinopen': S.pinOpen = S.pinOpen === b.getAttribute('data-id') ? null : b.getAttribute('data-id'); renderRail(); break;
      case 'unpin': { var up = {}; up[b.getAttribute('data-id')] = null; patch({ pins: up }, { force: true }); renderRail(); break; }
      case 'arm': arm(b.getAttribute('data-b'), true); break;
      case 'last': fileLast(); break;
      case 'clearcap': clearCapture(); break;
      case 'livesync': toggleLive(); break;
    }
  }
  function onChange(ev) {
    var t = ev.target; if (!S || !t) return;
    if (t.id === 'gm-file') { readPackFile(t.files && t.files[0]); return; }
    if (t.hasAttribute && t.hasAttribute('data-now')) { setNow(t.value); try { t.blur(); } catch (e) {} return; }      /* the keys work again at once */
    if (t.hasAttribute && t.hasAttribute('data-opp')) {      /* a card's line: saved when the field is left (the change event), not per key */
      if (ev.type === 'change') { var ol = {}, ox = {}; ox[t.getAttribute('data-f')] = str(t.value).slice(0, 120); ol[t.getAttribute('data-opp')] = ox; patch({ opps: { list: ol } }); }
      return;
    }
    if (t.hasAttribute && t.hasAttribute('data-sttspk')) {   /* a speaker's name: saved when the field is left */
      if (ev.type === 'change') { var sp = {}; sp[t.getAttribute('data-sttspk')] = str(t.value).trim().slice(0, 60) || null; sttPatch({ speakers: sp }); }
      return;
    }
    if (t.hasAttribute && t.hasAttribute('data-run')) {      /* Run the site: the slider (released: the state and the map now) and the Disguise select */
      if (t.getAttribute('data-run') === 't') { if (ev.type === 'change') runCommit(); } else if (ev.type === 'change') runSetLens(t.value);
      return;
    }
    if (t.hasAttribute && t.hasAttribute('data-hotitle')) { S.hoTitle = !!t.checked; return; }      /* this page only: the next Show on iPad carries the title caption */
    if (t.hasAttribute && t.hasAttribute('data-choutcome')) { S.chOutcome = str(t.value); return; }
    if (t.hasAttribute && t.hasAttribute('data-chf')) { chForm()[t.getAttribute('data-chf')] = str(t.value).slice(0, 80); if (t.tagName === 'SELECT') renderChase(true); return; }
    if (t.id === 'gm-opp-iv') { if (ev.type === 'change') patch({ opps: { interval: Math.floor(+t.value) || 0 } }); return; }
    if (t.id === 'gm-prep-note') { if (ev.type === 'change') { try { W.localStorage.setItem(PREP_NOTE, t.value); } catch (e) {} renderPrep(true); } return; }
    if (t.hasAttribute('data-ctl')) { if (ev.type === 'change' || t.tagName === 'SELECT') setLive(t.getAttribute('data-ctl'), t.value); return; }
    if (ev.type !== 'change') return;
    if (t.hasAttribute('data-ambint')) { patchAmbient({ intervalMin: Math.round(+t.value) }); return; }
    if (t.hasAttribute('data-site')) { S.siteFor = str(t.value); renderLocation(); return; }     /* the save row's score: this page only */
    if (t.hasAttribute('data-loc')) { var l = {}; l[t.getAttribute('data-loc')] = t.type === 'checkbox' ? t.checked : t.value; patch({ loc: { ui: l } }); }
    else if (t.hasAttribute('data-map')) setMap(t.getAttribute('data-map'), t.value);
    else if (t.hasAttribute('data-scn')) { var sc = {}; sc[t.getAttribute('data-scn')] = t.value; patch({ scn: { ui: sc } }); }
    else if (t.hasAttribute('data-scui')) scSetUi(t.getAttribute('data-scui'), t.value);
    else if (t.hasAttribute('data-npcui')) { var nu = {}; nu[t.getAttribute('data-npcui')] = t.value; patch({ npc: { ui: nu } }); }
    else if (t.hasAttribute('data-dtf')) dtField(t.getAttribute('data-dtf'), t.value);
    else if (t.hasAttribute('data-reveal')) {
      var rb = t.getAttribute('data-reveal'), rv = {}; rv[rb] = t.checked; patch({ loc: { map: { reveal: rv } } });
      liveReveal();       /* while the map is live on the iPad: asks for new bands, sends, or puts the ticks back */
      if (S.map) drawMap(); renderLocation();
    }
  }
  /* the outline of a long tab (Prep, Screen): the section being read is marked in its list */
  var spyQueued = false;
  function onScroll(ev) {
    var t = ev.target; if (!S || !t || !t.id || (t.id !== 'gm-prep' && t.id !== 'gm-rules')) return;
    if (spyQueued) return; spyQueued = true;
    (W.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () { spyQueued = false; spy(S && S.panel); });
  }
  function spy(panel) {
    if (!S || !S.root || (panel !== 'prep' && panel !== 'rules')) return;
    var pane = $q(panel === 'prep' ? '#gm-prep' : '#gm-rules'); if (!pane) return;
    var chips = [].slice.call(pane.querySelectorAll(panel === 'prep' ? '.pp-rail [data-gm="prep-go"]' : '.gs-jump [data-gm="gs-jump"]')); if (!chips.length) return;
    var top = pane.getBoundingClientRect().top, cur = null;
    chips.forEach(function (c) {
      var id = c.getAttribute('data-id'), sec = null;
      try { sec = panel === 'prep' ? pane.querySelector('#' + (W.CSS && W.CSS.escape ? W.CSS.escape(id) : id)) : pane.querySelector('[data-gs="' + str(id).replace(/"/g, '') + '"]'); } catch (e) { sec = null; }
      if (sec && !sec.hidden && sec.getBoundingClientRect().top - top <= 90) cur = c;
    });
    if (!cur && pane.scrollTop < 40) cur = null;
    chips.forEach(function (c) { if (c === cur) c.setAttribute('aria-current', 'true'); else c.removeAttribute('aria-current'); });
  }
  function onSubmit(ev) {
    var f = ev.target; if (!S || !f || !f.getAttribute) return;
    var k = f.getAttribute('data-gm-form'); if (!k) return;
    ev.preventDefault();
    if (k === 'capture') { var i = $q('#gm-cap-in'); if (i && addCapture(S.arm, i.value)) { i = $q('#gm-cap-in'); if (i) { i.value = ''; i.focus(); } } }
    else if (k === 'rules') { var q = $q('#gm-rq'); if (q && q.value.trim()) rulesSearch(q.value); }
  }
  function wire(el) {
    if (!el.__gm) { el.__gm = true; el.addEventListener('click', onClick); el.addEventListener('change', onChange); el.addEventListener('input', function (ev) { if (ev.target && ev.target.getAttribute && ev.target.getAttribute('data-run') === 't') { runScrub(ev.target.value); return; } if (ev.target && ev.target.id === 'gm-find-q') { findRender(ev.target.value); return; } if (ev.target && ev.target.hasAttribute && ev.target.hasAttribute('data-chf')) { chForm()[ev.target.getAttribute('data-chf')] = str(ev.target.value).slice(0, 80); return; } if (ev.target && ev.target.id === 'gm-gs-q') { filterScreen(ev.target.value); return; } if (ev.target && ev.target.id === 'gm-prep-q') { prepFilter(ev.target.value); return; } if (ev.target && ev.target.id === 'gm-dt-purveyor') { clearTimeout(wire.dt); var pv = ev.target; wire.dt = setTimeout(function () { if (S) dtField('purveyor', pv.value); }, 500); return; } if (ev.target && ev.target.type === 'text' && ev.target.hasAttribute('data-ctl')) { clearTimeout(wire.t); var t = ev.target; wire.t = setTimeout(function () { if (S) { var l = {}; l[t.getAttribute('data-ctl')] = t.value; patch({ con: { live: l } }); } }, 500); } }); el.addEventListener('submit', onSubmit); el.addEventListener('toggle', onToggle, true); el.addEventListener('scroll', onScroll, true); }
    if (!wire.global) {
      wire.global = true;
      document.addEventListener('keydown', onKey, true);
      W.addEventListener('focus', function () { refetch(); if (S && S.status === 'ready' && S.panel === 'ipad') loadAmbient(); });
      /* leaving or hiding the tab: what is pending goes now, as a keepalive request (also from a session already closed) */
      document.addEventListener('visibilitychange', function () { apEvent({ type: 'visible', visible: !document.hidden }); if (document.hidden) { if (lastSaver) lastSaver.beacon(); } else if (S) { refetch(); if (S.status === 'ready' && S.panel === 'ipad') loadAmbient(); } });
      W.addEventListener('pagehide', function () { if (lastSaver) lastSaver.beacon(); });
      /* a push from another page (the rules page's Show on iPad) keeps "On the iPad now" true */
      W.addEventListener('b68:display', function (ev) { if (ev && isObj(ev.detail)) noteShown(ev.detail); });
    }
  }

  /* the table changed: redraw the rail, and keep the iPad's heat / wanted in step (only once the GM has opened this page: the
     campaign document reaches every signed-in person, and only the GM may write the ambient) */
  function campaign(doc) {
    var before = isObj(camp) && isObj(camp.scene) ? JSON.stringify(camp.scene.npcs || {}) : '';
    camp = isObj(doc) ? doc : null;
    if (S && S.status === 'ready') {
      renderRail(); renderBar(); scMaybeRedraw(); runStale();
      apClocksFeed(); apSubjects();
      /* the stage changed: the NPC tab's buttons follow */
      if ((isObj(camp) && isObj(camp.scene) ? JSON.stringify(camp.scene.npcs || {}) : '') !== before) {
        [].forEach.call(S.root.querySelectorAll('[data-gm="npcstage"]'), function (b) { var on = staged(b.getAttribute('data-id')); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Off stage' : 'Put on stage'; b.classList.toggle('primary', !on); });
      }
      if (S.clOn) {
        var me = S; clearTimeout(S.clocksT);
        S.clocksT = setTimeout(function () { if (S !== me || !S.clOn) return; var svg = clocksSvg(tableClocks()); if (svg && svg !== S.clOn.svg) clocksToIpad(true, true); }, 700);
      }
    }
    var api = (S && S.api) || keptApi;
    if (api && api.isGM && api.isGM() === true && keptApi) crewSync.note(camp);
  }

  return {
    open: open, close: close, campaign: campaign, characters: charactersChanged, purge: purge,
    available: function () { return !!(W.claude && W.claude.gm); },
    _pure: P,
    /* for checks (gm.e2e.mjs): the current roll, and the display gate */
    _state: function () { return S ? { status: S.status, locRoll: S.locRoll, map: S.map && { layer: S.map.layer, svg: S.map.svg }, panel: S.panel, seg: S.seg, doc: S.doc, runCacheN: S.runCache ? S.runCache.keys.length : 0 } : null; },
    _pushDisplay: function (d) { return pushDisplay(d); },
    /* "Claude suggests" (a later step calls this): a Show handout? item in the Rack. Returns false for an id the pack does not hold. */
    suggestHandout: function (id, why) { return suggestHandout(id, why); },
    /* overlays on the iPad (the false dawn, the autopilot): showOverlay({ kind, ms, ... }) and clearOverlay(), through the ambient document */
    showOverlay: showOverlay, clearOverlay: clearOverlay,
    _ambient: function () { return { doc: AM.doc, shown: AM.shown, loaded: AM.loaded, crew: crewSync.state().lastSent }; },
    /* the autopilot's controller state, for checks (the page's own log is S.doc.ap.log), and Voice's lines as the box would hand them over */
    _autopilot: function () { return S && S.ap ? S.ap.core.state() : null; },
    _voice: function (v) { if (S) setVoice(v); }
  };
});
