/* gm-page.js — the GM's page (#gm, GM.md): the console (the four Situations; the nine single tables fold under the card), the location generator
   with its map, the cast as a list to push to the iPad, the state rail (crew, clocks, bargains owed, pins, who is on stage) and
   the capture bar. S opens the street scene roller beside the location generator (a side panel), and
   D the downtime cards (personal business: a scene prompt per activity a PC takes, an overindulgence's cost).
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
  var VIEWS = ['rings', 'plan', 'iso', 'section'], THEMES = ['rulebook', 'blueprint', 'casefile', 'board'];
  P.MAP0 = { view: 'rings', theme: 'rulebook', layer: 'gm', reveal: { public: true } };

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
  P.validatePack = validatePack; P.partBody = partBody; P.partRequests = partRequests;

  /* the bands the player layer reveals: public, plus what the GM ticked, and only while Layer is Player (on the GM layer
     the ticks are kept but nothing beyond public counts) */
  function revealList(map) {
    if (!isObj(map) || map.layer !== 'player') return ['public'];
    var r = isObj(map.reveal) ? map.reveal : {};
    return BANDS.filter(function (b) { return b === 'public' || r[b] === true; });
  }
  P.revealList = revealList;
  P.REVEAL0 = { public: true, working: false, controlled: false, secure: false };   /* every new roll and replay starts here */

  /* An SVG's visible text: tags out (so a name split over <tspan>s joins up), XML entities decoded, whitespace collapsed,
     lower case. */
  function svgText(svg) {
    return str(svg).replace(/<[^>]*>/g, ' ').replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, function (m, e) {
      if (e.charAt(0) === '#') { var n = e.charAt(1).toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch (x) { return ' '; } }
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
    }).replace(/\s+/g, ' ').toLowerCase();
  }
  /* What the players must not read on a map with these bands revealed: every room in a hidden band, both threats, and
     the target room while its band is hidden. A name that is also a revealed room's name is not a secret. */
  function hiddenNames(roll, reveal) {
    var rooms = roll && Array.isArray(roll.rooms) ? roll.rooms : [], shown = {}, out = [];
    rooms.forEach(function (r) { if (r && reveal.indexOf(r.band) >= 0) shown[str(r.name).trim().toLowerCase()] = 1; });
    function add(n) { n = str(n).trim().toLowerCase(); if (n.length >= 3 && !shown[n] && out.indexOf(n) < 0) out.push(n); }
    rooms.forEach(function (r) { if (r && reveal.indexOf(r.band) < 0) add(r.name); });
    if (roll) { add(roll.physThreatName); add(roll.socThreatName); if (roll.targetRoom && reveal.indexOf(roll.targetBand) < 0) add(roll.targetRoom); }
    return out;
  }
  /* the hidden names the svg prints (whole words, any case), [] when it is clean */
  function leaks(svg, roll, reveal) {
    var t = ' ' + svgText(svg) + ' ';
    return hiddenNames(roll, reveal).filter(function (n) {
      var i = -1;
      while ((i = t.indexOf(n, i + 1)) >= 0) { if (!/[a-z0-9]/.test(t.charAt(i - 1)) && !/[a-z0-9]/.test(t.charAt(i + n.length))) return true; }
      return false;
    });
  }
  P.svgText = svgText; P.hiddenNames = hiddenNames; P.leaks = leaks;
  P.LEAK_MSG = 'This view would name a hidden room: use Rings or Iso, or reveal more bands.';
  /* The only way a map reaches the display: the PLAYER layer, rendered here from the roll, whatever the controls say.
     Refuses outright when the controls are on the GM layer, so a GM render can never be pushed by accident, and refuses a
     player render that prints a hidden name (the map kit titles a plan or section level after the room it holds, hidden
     or not: a kit bug, GM.md). */
  function playerDisplay(roll, map, render) {
    if (!isObj(map) || map.layer !== 'player') throw new Error('Only the player layer can go to the iPad. Switch Layer to Player first.');
    if (!roll || typeof render !== 'function') throw new Error('Roll a location first.');
    var reveal = revealList(map);
    var r = render(roll, { view: VIEWS.indexOf(map.view) >= 0 ? map.view : 'rings', theme: THEMES.indexOf(map.theme) >= 0 ? map.theme : 'rulebook', layer: 'player', reveal: reveal, width: 1400 });
    if (leaks(r.svg, roll, reveal).length) { var e = new Error(P.LEAK_MSG); e.leak = true; throw e; }
    return { kind: 'svg', title: str(roll.name).slice(0, 200), caption: (roll.district ? roll.district + ' · ' : '') + 'surveyed: ' + reveal.join(', '), svg: r.svg, warnings: r.warnings || [], reveal: reveal };
  }
  P.playerDisplay = playerDisplay;
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
  function makeGate() {
    var ok = [];
    return {
      mark: function (svg) { ok.push(svg); if (ok.length > 8) ok.shift(); return svg; },
      allows: function (d) { return isObj(d) && (d.kind !== 'svg' || (typeof d.svg === 'string' && ok.indexOf(d.svg) >= 0)); },
      /* an ambient patch: a score (the only thing in it that carries a map) goes only if BOTH its svgs were marked; null clears */
      allowsAmbient: function (p) {
        if (!isObj(p)) return false;
        if (!('score' in p) || p.score === null) return true;
        return isObj(p.score) && typeof p.score.board === 'string' && typeof p.score.iso === 'string' && ok.indexOf(p.score.board) >= 0 && ok.indexOf(p.score.iso) >= 0;
      }
    };
  }
  P.makeGate = makeGate;

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
    if (d.kind === 'cards') return 'Cards' + (Array.isArray(d.cards) ? ' · ' + d.cards.length : '') + (d.mode === 'spread' ? ', spread' : '');
    return 'Nothing spotlit: the ambient plays';
  }
  P.displayLine = displayLine;
  function scoreLine(score) {
    if (!isObj(score)) return '';
    var at = Date.parse(str(score.at)), when = '';
    if (at) { var d = new Date(at); when = pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
    return [str(score.name) || 'Unnamed', (Array.isArray(score.reveal) ? score.reveal : []).map(str).join(', ') || 'public', when].filter(Boolean).join(' · ');
  }
  P.scoreLine = scoreLine;
  /* ipadView(doc) -> what the panel draws from the server's ambient document (null or {} before there is one) */
  function ipadView(doc) {
    var d = isObj(doc) ? doc : {}, score = isObj(d.score) ? d.score : null;
    var mode = d.mode === 'pin' || d.mode === 'off' ? d.mode : 'auto';
    var scene = typeof d.scene === 'string' ? d.scene : null;
    var iv = Math.round(Number(d.intervalMin)); if (!(iv >= 3 && iv <= 30)) iv = P.IPAD_INTERVAL_DEFAULT;
    var intervals = P.IPAD_INTERVALS.slice(); if (intervals.indexOf(iv) < 0) { intervals.push(iv); intervals.sort(function (a, b) { return a - b; }); }
    return {
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
     theme; if that names a hidden room it is redrawn as rings (clean) and `rings` is true; the iso never falls back: if it leaks,
     this throws (e.leak). Only player-safe fields go out: the place name and district. The target stays '' (the legend does not
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
    if (leaks(iso.svg, roll, reveal).length) throw leak();
    return {
      reveal: reveal, view: view, rings: view === 'rings', board: board.svg, iso: iso.svg,
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
      map: { view: VIEWS.indexOf(m.view) >= 0 ? m.view : 'rings', theme: THEMES.indexOf(m.theme) >= 0 ? m.theme : 'rulebook' }, at: nowIso()
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
      case 'd': return { type: 'panel', panel: 'downtime' };
      case 'p': return { type: 'capture', bucket: 'n' };
      case 'x': return { type: 'capture', bucket: 'x' };
      case 'm': return { type: 'capture', bucket: 'm' };
      case 'l': return { type: 'last' };
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
  /* a roll's one-line text for "L" (the title and the lead) */
  function lastText(res) {
    var m = res && res.meta || {};
    return m.id === 'situation' && res.sections && res.sections[0] ? str(m.title) + ': ' + plainMd(res.sections[0].lead) : str(m.title) + ': ' + plainMd(m.text);
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
  var gate = makeGate();
  var lastSaver = null;          /* the newest session's saver: pagehide sends what it still holds */
  var keptApi = null;            /* the page api of the last open() that found the GM: the heat sync outlives the page (campaign() keeps arriving) */
  /* The ambient document as the server holds it (the truth), what the iPad was last told to spotlight, and the panel's state.
     Module-level, not in S: the heat / wanted sync keeps running while the page is closed. */
  var AM = { doc: null, seq: null, updatedAt: null, shown: null, loaded: false, busy: 0, error: '', displayRead: false };
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
    }).catch(function () {});
  }
  function live() { var c = S.doc.con; return isObj(c) && isObj(c.live) ? c.live : {}; }

  /* ---------- Now in: the one district the tools start from ----------
     GM state `now: { district }`, set in the top bar (on a phone, in the Scene line). The console's District, the Street scene's,
     the Location's and the NPC generator's pickers each lead with "Now in: …", which follows it; picking a district there is that
     tool's own and stays through a change of Now in; "any" keeps a tool on any. A tool's stored choice is '' (never set: it
     follows), NOW_ANY ('*': any) or a district name (its own). A roll stores the district it resolved to in its own `ui`, so
     Earlier and a replay never move when Now in does. Each tool has its own list (its pack part's), so a name is matched without
     case, a leading "the" or punctuation, and a tool whose list lacks it rolls on any. */
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
    var losses = [];
    if (v.ok && S.pack && isObj(S.pack.parts)) {
      var before = {}, after = {};
      Object.keys(S.pack.parts).forEach(function (n) { var x = S.pack.parts[n]; if (x && isObj(x.body)) before[n] = x.body; });
      Object.keys(pk.parts).forEach(function (n) { after[n] = partBody(pk.parts[n]); });
      losses = packLosses(before, after);
    }
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
    var reqs = partRequests(pk), prog = $q('#gm-prog'), msg = $q('#gm-upmsg'), btn = $q('[data-gm="upload"]'), me = S, done = {}, packVersion = null, i = 0;
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
      var extra = Object.keys(isObj(idx && idx.parts) ? idx.parts : {}).filter(function (n) { return !done[n]; }), c2 = Promise.resolve();
      extra.forEach(function (n) { c2 = c2.then(function () { return g.removePart(n); }).then(function (r) { packVersion = r && r.packVersion || packVersion; }); });
      return c2.then(function () { if (!extra.length && idx && idx.version) packVersion = idx.version; });
    });
    chain.then(function () {
      if (S !== me) return;
      me.pack = { version: packVersion, parts: done, savedAt: nowIso() };
      return kvSet('pack:' + me.me, me.pack).catch(function () {}).then(function () { if (S !== me) return; toast('GM pack imported: ' + reqs.length + ' parts.'); me.importing = null; start(); });
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
    layout(); redrawAll(); subscribeNpcs(); checkPack();
    /* listening: every 5 s while the iPad tab is open, every 15 s otherwise (the top bar shows it) */
    if (!S.sttTimer && typeof W.setInterval === 'function') { var mine2 = S, n2 = 0; S.sttTimer = W.setInterval(function () { n2++; if (S === mine2 && S.status === 'ready' && !document.hidden) { if (S.panel === 'ipad' || n2 % 3 === 0) loadStt(); renderBeat(); } }, 5000); }
    if (!S.prepTimer && typeof W.setInterval === 'function') { var mine = S; S.prepTimer = W.setInterval(function () { if (S === mine && S.status === 'ready' && prepRunning()) { var pb = $q('#gm-prep'); if (pb && S.panel === 'prep') decoratePrep(pb); decoratePrep($q('#gm-rail')); } }, 15000); }
    if (S.panel === 'ipad') loadAmbient(); else loadShown();
    loadStt();
  }
  /* the top bar: what the iPad shows, read once (GET /api/gm/display only: the heat sync waits for the iPad tab, as before) */
  function loadShown() {
    var g = gmApi(), me = S; if (!g || typeof g.display !== 'function' || AM.displayRead) return;
    Promise.resolve().then(function () { return g.display(); }).then(function (r) {
      if (r && isObj(r.display)) { AM.displayRead = true; AM.shown = AM.shown || { kind: str(r.display.kind), title: str(r.display.title) }; }
      if (S === me) renderBar();
    }, function () {});
  }
  function layout() {
    var segs = [['console', 'Console'], ['prep', 'Prep'], ['location', 'Location'], ['scenes', 'Street'], ['score', 'Score'], ['npc', 'NPC'], ['downtime', 'Downtime'], ['cards', 'Cards'], ['rules', 'GM screen'], ['ipad', 'iPad'], ['state', 'State']];
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
      '<div class="gm-mini" id="gm-mini" role="group" aria-label="Roll"></div><div class="gm-controls" id="gm-controls"></div>' + '<div class="gm-buttons" id="gm-buttons"></div><div class="gm-cardbox" id="gm-card" aria-live="polite"></div>' + '<div class="gm-earlier" id="gm-earlier"></div>' +
      '<details class="gm-singles" id="gm-singles"></details></section>' +
      '<section class="gm-col gm-side" aria-label="Side panel"><div class="gm-tabrow"><div class="gm-tabs" role="tablist" aria-label="Side panel">' +
      [['prep', 'Prep', 'R'], ['rules', 'GM screen', 'T'], ['location', 'Location', 'B'], ['scenes', 'Street', 'S'], ['score', 'Score', 'J'], ['npc', 'NPC', 'N'], ['downtime', 'Downtime', 'D'], ['cards', 'Cards', 'O'], ['ipad', 'iPad', 'I']].map(function (t) { return '<button type="button" class="gm-tab" role="tab" data-gm="panel" data-panel="' + t[0] + '">' + t[1] + ' <kbd>' + t[2] + '</kbd></button>'; }).join('') +
      '</div><button type="button" class="gm-focusbtn" data-gm="focus" aria-pressed="false" title="Shrinks the console to its keys, to read (F)">Focus <kbd>F</kbd></button></div>' + '<div class="gm-pane" data-pane="prep" id="gm-prep"></div>' + '<div class="gm-pane" data-pane="location" id="gm-loc"></div><div class="gm-pane" data-pane="scenes" id="gm-scn"></div><div class="gm-pane" data-pane="score" id="gm-score"></div>' + '<div class="gm-pane" data-pane="npc" id="gm-npc"></div><div class="gm-pane" data-pane="downtime" id="gm-dt"></div>' + '<div class="gm-pane" data-pane="cards" id="gm-cards"></div><div class="gm-pane" data-pane="rules" id="gm-rules"></div><div class="gm-pane" data-pane="ipad" id="gm-ipad"></div></section>' +
      '<aside class="gm-col gm-rail" id="gm-rail" aria-label="State"></aside></div>' +
      '<div class="gm-foot" id="gm-foot"></div>' +
      '<button type="button" class="gm-fab" data-gm="capopen" aria-expanded="false" aria-controls="gm-foot">Capture</button>' +
      '<div class="gm-find" id="gm-find" hidden><div class="gm-find-box" role="dialog" aria-label="Find"><label class="sr" for="gm-find-q">Find</label>' +
      '<input type="search" id="gm-find-q" autocomplete="off" spellcheck="false" placeholder="Find a name, a rule, a scene, a line you filed…">' +
      '<ol class="gm-find-list" id="gm-find-list"></ol><p class="gm-find-help"><kbd>↑</kbd> <kbd>↓</kbd> choose · <kbd>Enter</kbd> go (or copy) · <kbd>Esc</kbd> close</p></div></div></div>';
    renderRules();
    setApp(true);
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
      '<button type="button" class="gm-pill" data-gm="panel" data-panel="ipad" id="gm-bar-stt" title="The transcriber (the iPad tab)" hidden></button>' +
      '<button type="button" class="gm-bb" data-gm="blankipad" title="Back to the ambient scene">Clear → ambient <kbd>0</kbd></button>' + '<button type="button" class="gm-bb" data-gm="darkipad" title="True black until you push something">Lights out</button>' +
      '<span class="gm-menu"><button type="button" class="gm-bb" data-gm="menu" aria-expanded="false" aria-haspopup="true">Menu</button><span class="gm-menu-list" hidden>' +
      '<p class="gm-menu-h"><span><b>GM tools</b> · The console</span><span class="gm-exp" id="gm-menu-exp"></span></p>' + '<div class="gm-menu-warn" id="gm-menu-warn" hidden></div>' +
      '<a href="#display" title="The players’ screen: open this on the iPad">Open the display page (for the iPad)</a>' +
      '<button type="button" data-gm="note">Export tonight’s note</button><button type="button" data-gm="clearcap">Clear tonight’s capture</button><button type="button" data-gm="update">Update pack</button>' +
      '<a href="#t">The table</a><a href="#rules">Rules</a><a href="#cast">The cast</a><a href="#">Home</a>' +
      '<button type="button" class="bad" data-gm="forget">Forget GM data on this device</button></span></span>' +
      '<div class="gm-signed" id="gm-signed" role="alert" hidden>' + esc(SIGNED_OUT_MSG) + '</div></div>';
  }
  function menuOpen(on) {
    var m = $q('.gm-menu-list'), b = $q('[data-gm="menu"]'); if (!m) return;
    if (on) m.removeAttribute('hidden'); else m.setAttribute('hidden', ''); if (b) b.setAttribute('aria-expanded', String(!!on));
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
    list.innerHTML = !str(q).trim() ? '<li class="gm-find-none">Prep, the screen, the rules, NPCs, PCs, factions, clocks, callbacks, and what you filed tonight.</li>'
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
    else if (g.t === 'rule') { setPanel('rules'); if (isPhone()) { S.seg = 'side'; syncPanels(); } rulesSearch(g.q, g.id); }
    else if (g.t === 'rail') { if (isPhone()) { S.seg = 'state'; syncPanels(); } flash($q('#gm-rail .gm-clocks')); }
  }

  /* the table clocks to the iPad (an svg made here; the server checks it like any map). While the iPad shows them, a change
     to a clock on the table sends them again. */
  function tableClocks() { return Array.isArray(camp && camp.clocks) ? camp.clocks.filter(isObj) : []; }
  function clocksToIpad(quiet) {
    var svg = clocksSvg(tableClocks()); if (!svg) { if (!quiet) toast('No clock the players can see.', true); return; }
    gate.mark(svg); S.clocksSvg = svg;
    pushDisplay({ kind: 'svg', title: 'Clocks', caption: 'The table clocks', svg: svg }).then(function () { if (!quiet) toast('On the iPad: the clocks. They follow the table while they are up.'); }, function (e) { toast('Could not send the clocks: ' + errText(e), true); });
  }

  function redrawAll() {
    if (!S || S.status !== 'ready' || !$q('#gm-root')) return;
    syncHead(); renderBar(); syncPanels(); renderConsole(); renderPrep(); renderRules(); renderLocation(); renderScenes(); renderNpcs(); renderScore(); renderDowntime(); renderCards(); renderIpad(); renderRail(); renderCapture(); syncSave();
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
  function setLive(id, value) { var l = {}; l[id] = value; patch({ con: { live: l } }); renderChips(); }
  /* the big three-way Position switch (always on screen, the phone too) */
  function renderPos() {
    var box = $q('#gm-pos'); if (!box) return;
    if (!hasSit()) { box.innerHTML = ''; return; }
    var cur = str(uiNow().pos);
    box.innerHTML = '<span class="gm-lab">Position</span><div class="gm-posb-row">' + S.con.positions.map(function (p) {
      return '<button type="button" class="gm-posb" role="radio" aria-checked="' + (p.value === cur) + '" data-gm="pos" data-v="' + esc(p.value) + '"><b>' + esc(p.label) + '</b><small>' + esc(p.severity + ' · ' + p.ticks) + '</small><small>harm ' + esc(p.harm) + '</small></button>';
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
  function renderConsole() { renderPos(); renderControls(); renderButtons(); renderSingles(); drawConsoleCard(); }
  function setPos(v) { setLive('pos', v); renderPos(); }
  /* a roll is never invisible: Focus (which hides the card) goes, said once per page load, and the card's header is scrolled
     into view in the console column */
  var focusLeftToasted = false;
  function stamp(kind, res) {
    S.conRes = res; S.shown = kind; S.last = { text: lastText(res) }; drawConsoleCard(res);
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
    var res; try { res = S.con.situation(n, uiNow()); } catch (e) { toast('The roll failed: ' + errText(e), true); return; }
    var entry = situationEntry(res, S.doc.con);
    var hid = uid('h'), hist = isObj(S.doc.hist) && isObj(S.doc.hist.situation) ? S.doc.hist.situation : {};
    var ok = patch({ cards: { situation: Object.assign({ hid: hid }, entry) }, mem: { console: clone(S.con.mem()) }, hist: { situation: addCapped(hist, hid, entry, LIMITS.hist) } }, { force: true });
    if (!ok) return;
    stamp('situation', res);
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
  function mapUi() { var l = isObj(S.doc.loc) && isObj(S.doc.loc.map) ? S.doc.loc.map : {}; var m = Object.assign(clone(P.MAP0), l); m.reveal = Object.assign({}, P.MAP0.reveal, isObj(l.reveal) ? l.reveal : {}); return m; }
  function replayLocation(e) {
    var L = W.B68GmLocation, pk = part('location'); if (!L || !pk || !isObj(e)) return null;
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
    patch({ cards: { location: Object.assign({ hid: hid }, entry) }, mem: { location: clone(S.locMem) }, hist: { location: addCapped(hist, hid, entry, LIMITS.hist) }, loc: { map: { reveal: clone(P.REVEAL0), view: 'rings', layer: 'gm' } } }, { force: true });
    S.locRoll = roll; S.map = null; S.last = { text: 'Location: ' + entry.label };
    renderLocation(true);
    if (W.B68Map && W.B68Map.render) drawMap(true);
  }
  function renderLocation(fresh) {
    var box = $q('#gm-loc'), L = W.B68GmLocation, pk = part('location'); if (!box) return;
    if (S.locErr || !L || !pk) { box.innerHTML = '<p class="gm-note bad">' + esc(S.locErr || 'The location generator is not available.') + '</p>'; return; }
    var cur = isObj(S.doc.cards) ? S.doc.cards.location : null;
    if (!fresh && cur && (!S.locRoll || S.locRoll.seed !== cur.seed)) { S.locRoll = replayLocation(cur); S.map = null; resetReveal(); }
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
        '<fieldset class="gm-reveal"><legend class="gm-lab">Reveal to the players: ' + esc(mu.layer === 'player' ? revealList(mu).join(', ') : 'public only while Layer is GM') + '</legend>' + BANDS.map(function (b) { return '<label class="gm-check"><input type="checkbox" data-reveal="' + b + '"' + (b === 'public' || mu.reveal[b] ? ' checked' : '') + (b === 'public' ? ' disabled' : '') + '> <span>' + b + '</span></label>'; }).join('') + '</fieldset>' +
        '<button type="button" class="btn primary" data-gm="draw">Draw</button></div>' +
        '<p class="gm-warn" id="gm-mapwarn" role="status"></p>' +
        '<div class="gm-map-acts"><button type="button" class="btn sm primary" data-gm="ipad"' + (mu.layer === 'player' ? '' : ' disabled title="Switch Layer to Player: only the player layer goes to the iPad"') + '>Show on iPad</button>' +
        '<button type="button" class="btn sm" data-gm="scorescene"' + (mu.layer === 'player' ? '' : ' disabled title="Switch Layer to Player: only the player layer goes to the iPad"') + (mu.layer === 'player' ? ' title="The planning board and the exploded site on the iPad, from this roll at these bands"' : '') + '>Set as score scene</button>' +
        '<button type="button" class="btn sm" data-gm="blankipad" title="Back to the ambient scene (0)">Clear → ambient</button></div>' +
        '<div class="gm-map" id="gm-map"></div>' +
        '<details class="gm-more gm-mapopts"' + (foldOpen('mapopts') ? ' open' : '') + ' data-fold="mapopts"><summary>View &amp; theme <span class="gm-dim">' + esc(mu.view + ' · ' + mu.theme) + '</span></summary>' + '<div class="gm-map-ctl">' + sel('view', 'View', VIEWS, mu.view) + sel('theme', 'Theme', THEMES, mu.theme) + '</div></details>' +
        '<details class="gm-more gm-dl"' + (foldOpen('dl') ? ' open' : '') + ' data-fold="dl"><summary>Downloads</summary><div class="gm-map-acts">' + '<button type="button" class="btn sm" data-gm="dlsvg">Download SVG</button><button type="button" class="btn sm" data-gm="dlnote">Download note (.md)</button>' + '<button type="button" class="btn sm" data-gm="dlcanvas">Download canvas</button></div></details>' + '</section>';
    } else h += '<p class="gm-empty">Choose what you know (or leave it on any) and roll. The card marks what the players can see.</p>' + '<p><button type="button" class="btn sm" data-gm="blankipad" title="Back to the ambient scene (0)">Clear → ambient</button></p>';
    var hist = newest(isObj(S.doc.hist) ? S.doc.hist.location : null).slice(0, LIMITS.hist);
    if (hist.length) h += '<div class="gm-earlier"><span class="gm-lab">Earlier:</span>' + hist.map(function (x) { return earlierChip(x, 'location', cur && cur.hid === x._id); }).join('') + '</div>';
    box.innerHTML = h;
    if (S.map) showMap();
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
      '<div class="gm-say"><span class="gm-lab">Say' + (S.locSent === roll.seed ? ' ' + SEEN : '') + '</span><p>“' + esc(g.say) + '”</p><button type="button" class="btn sm" data-gm="pushtext">Street description on iPad</button></div>' +
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
  function sel(key, label, list, v) { return '<label class="gm-field" for="gm-m-' + key + '"><span class="gm-lab">' + label + '</span><select id="gm-m-' + key + '" data-map="' + key + '">' + list.map(function (o) { return '<option value="' + o + '"' + (o === v ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select></label>'; }
  function drawMap(quiet) {
    var K = W.B68Map; if (!S.locRoll) { if (!quiet) toast('Roll a location first.', true); return; }
    if (!K || !K.render) { if (!quiet) toast('The map kit is missing.', true); return; }
    var mu = mapUi(), r;
    try { r = K.render(S.locRoll, { view: mu.view, theme: mu.theme, layer: mu.layer === 'player' ? 'player' : 'gm', reveal: revealList(mu), width: 1400 }); } catch (e) { if (!quiet) toast('The map could not be drawn: ' + errText(e), true); return; }
    S.map = { svg: r.svg, warnings: r.warnings || [], layer: mu.layer === 'player' ? 'player' : 'gm', view: mu.view, theme: mu.theme };
    S.map.leak = S.map.layer === 'player' && leaks(r.svg, S.locRoll, revealList(mu)).length > 0;
    showMap();
  }
  function showMap() {
    var box = $q('#gm-map'), w = $q('#gm-mapwarn'); if (!box || !S.map) return;
    box.innerHTML = stripSize(S.map.svg);     /* the map kit's own output from our roll; it escapes its text */
    box.setAttribute('data-layer', S.map.layer);
    box.classList.toggle('gm-leak', !!S.map.leak);
    if (w) w.classList.toggle('bad', !!S.map.leak);
    if (w) w.textContent = (S.map.leak ? 'Not for the iPad: ' + P.LEAK_MSG + ' ' : '') + (S.map.layer === 'gm' ? 'GM layer: everything shows. ' : 'Player layer. ') + (S.map.warnings.length ? S.map.warnings.length + ' map note' + (S.map.warnings.length === 1 ? '' : 's') + ': ' + S.map.warnings.slice(0, 2).map(function (x) { return typeof x === 'string' ? x : x && (x.message || x.msg || JSON.stringify(x)); }).join(' · ') + (S.map.warnings.length > 2 ? ' …' : '') : '');
  }
  /* a change to the map controls redraws a map already on screen, so what shows always matches the controls */
  function setMap(k, v) { var p = { loc: { map: {} } }; p.loc.map[k] = v; patch(p); if (S.map) drawMap(); }
  function pushDisplay(d) {
    var g = gmApi(); if (!g) return Promise.reject(new Error('The display needs the hosted app.'));
    if (!gate.allows(d)) return Promise.reject(new Error('Only a player-layer map made on this page can go to the iPad.'));
    return Promise.resolve().then(function () { return g.setDisplay(d); }).then(function (r) { noteShown(d); return r; });
  }
  /* more than the public band is going to the players: say which, and ask */
  function confirmReveal(reveal, what) {
    var more = reveal.filter(function (b) { return b !== 'public'; });
    return !more.length || W.confirm(what + ' will show the players the ' + more.join(', ') + ' band' + (more.length === 1 ? '' : 's') + ' as well as public. Go ahead?');
  }
  function resetReveal() {
    var r = mapUi().reveal;
    if (BANDS.some(function (b) { return !!r[b] !== !!P.REVEAL0[b]; })) patch({ loc: { map: { reveal: clone(P.REVEAL0) } } });
  }
  function showOnIpad() {
    var mu = mapUi(), d;
    try { d = playerDisplay(S.locRoll, mu, W.B68Map && W.B68Map.render); } catch (e) { toast(errText(e), true); return; }
    if (!confirmReveal(d.reveal, 'This map')) return;
    gate.mark(d.svg);
    var send = { kind: 'svg', title: d.title, caption: d.caption, svg: d.svg };
    pushDisplay(send).then(function () { toast('On the iPad: ' + d.title + ' (' + d.caption + ').'); }, function (e) { toast('Could not send to the iPad: ' + errText(e), true); });
  }
  function pushText() {
    var L = W.B68GmLocation; if (!L || !S.locRoll) return;
    var reveal = revealList(mapUi()), ps;      /* public only, unless Layer is Player and the GM ticked more */
    if (!confirmReveal(reveal, 'The street description')) return;
    try { ps = L.playerSummary(S.locRoll, reveal); } catch (e) { toast(errText(e), true); return; }
    var me = S, seed = S.locRoll.seed;
    pushDisplay({ kind: 'text', title: plainText(ps.title).slice(0, 2000), caption: str(S.locRoll.district || ''), text: plainText(ps.text).slice(0, 2000) }).then(function () {
      toast('On the iPad: the street description.');
      if (S === me && S.locRoll && S.locRoll.seed === seed) { S.locSent = seed; renderLocation(); }   /* the Say box: Players see */
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
    patch({ cards: { location: replacePatch(isObj(S.doc.cards) ? S.doc.cards.location : null, cur) }, loc: { map: { reveal: clone(P.REVEAL0), view: VIEWS.indexOf(m.view) >= 0 ? m.view : 'rings', theme: THEMES.indexOf(m.theme) >= 0 ? m.theme : 'rulebook', layer: 'gm' } } }, { force: true });
    S.locRoll = null; S.map = null; S.siteFor = key; S.last = { text: 'Location: ' + cur.label };
    showPanel('location');
    renderLocation();
    if (S.locRoll && W.B68Map && W.B68Map.render) drawMap(true);
    if (!S.locRoll) toast('That site would not redraw: the location tables are missing.', true);
    else if (x.name && str(S.locRoll.name) !== str(x.name)) toast('The location tables have changed since this site was saved: this is its seed on the new tables (' + str(S.locRoll.name) + '), not ' + x.name + '.', true);
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
    var sites = sitesIn(S.doc), byKey = {}; scoreList().forEach(function (s) { byKey[s.key] = s; });
    [].forEach.call(slots, function (slot) {
      var key = slot.getAttribute('data-score'), sc = byKey[key] || { key: key, label: key, site: {} }, x = sites[key], k = esc(key);
      var sig = JSON.stringify([x ? [x.seed, x.name, x.district, x.at] : null, hintLine(sc.site)]);
      if (slot.getAttribute('data-sig') === sig) return;
      slot.setAttribute('data-sig', sig); slot.classList.toggle('has', !!x);
      slot.innerHTML = x
        ? '<span class="gm-lab">Site</span><span class="pp-site-t"><b>' + esc(x.name || 'saved') + '</b>' + (x.district ? ' <span class="gm-dim">· ' + esc(x.district) + '</span>' : '') + '</span>' +
          '<span class="pp-site-acts"><button type="button" class="btn sm primary" data-gm="siteopen" data-score="' + k + '">Open map</button><button type="button" class="btn sm" data-gm="siteroll" data-score="' + k + '">Roll another</button><button type="button" class="btn sm" data-gm="siteclear" data-score="' + k + '">Clear</button></span>'
        : '<span class="gm-lab">Site</span><span class="pp-site-t gm-dim">None yet' + (hintLine(sc.site) ? ' · ' + esc(hintLine(sc.site)) : '') + '</span>' +
          '<span class="pp-site-acts"><button type="button" class="btn sm" data-gm="siteroll" data-score="' + k + '">Roll a site</button></span>';
    });
  }

  /* ---------- the iPad panel (I): the ambient scenes. The server's document is the truth ---------- */
  function noteShown(d) { if (isObj(d)) { AM.shown = { kind: str(d.kind), title: str(d.title) }; renderIpad(); } }
  function adoptAmbient(r) {
    if (!isObj(r) || !isObj(r.doc)) return false;
    if (typeof r.seq === 'number' && typeof AM.seq === 'number' && r.seq < AM.seq) return false;     /* an older answer landing late */
    AM.doc = r.doc; AM.seq = typeof r.seq === 'number' ? r.seq : AM.seq; AM.updatedAt = r.updatedAt || null; AM.loaded = true; AM.error = '';
    return true;
  }
  /* GET the ambient document (and, the first time, what the iPad shows). Also corrects a stale crew once the truth is known. */
  function loadAmbient() {
    var g = gmApi(); if (!g || typeof g.ambient !== 'function') return Promise.resolve();
    var me = S, first = !AM.displayRead;
    return Promise.resolve().then(function () { return Promise.all([g.ambient(), first && typeof g.display === 'function' ? g.display().then(function (r) { return r; }, function () { return null; }) : null]); }).then(function (res) {
      if (adoptAmbient(res[0])) { crewSync.note(camp); crewSync.adopt(AM.doc.crew, true); }
      var dr = res[1];
      if (dr && isObj(dr.display)) { AM.displayRead = true; AM.shown = AM.shown || { kind: str(dr.display.kind), title: str(dr.display.title) }; }
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
    var v = ipadView(AM.doc), busy = AM.busy > 0, off = !AM.loaded;
    function seg(k, label) { return '<button type="button" class="chip" data-gm="ambmode" data-v="' + k + '" aria-pressed="' + (v.mode === k) + '"' + (off || busy ? ' disabled' : '') + '>' + label + '</button>'; }
    var h = '<section class="gm-box gm-ipad-now"><h3 class="gm-band">On the iPad now</h3><p class="gm-ipad-line" id="gm-ipad-now">' + (AM.shown ? esc(displayLine(AM.shown)) : '<span class="gm-dim">Not known yet: push something, or clear it.</span>') + '</p>' +
      '<div class="gm-ipad-acts"><button type="button" class="btn primary" data-gm="blankipad" title="Back to the ambient scene">Clear → ambient <kbd>0</kbd></button>' +
      '<button type="button" class="btn" data-gm="darkipad" title="True black until you push something">Lights out</button></div></section>';
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
    box.innerHTML = '<div id="gm-stt"></div>' + h;
    renderStt(true);
    renderBar();
    probeTheme();
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

  var SIDE = ['prep', 'location', 'scenes', 'score', 'npc', 'downtime', 'cards', 'rules', 'ipad'];
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
        me.npcs = m; renderNpcs(); renderRail();
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
    if (S.locRoll && (!cur || S.locRoll.seed === cur.seed)) return S.locRoll;
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
    var said = capDropped(plan.dropped.length);       /* a toast has one line: "Filed under ..." must not cover what was dropped */
    renderCapture();
    if (!quiet && !said) { var b = BUCKETS.filter(function (x) { return x.k === bucket; })[0]; toast('Filed under ' + (b ? b.head : bucket) + '.'); }
    return said ? 'said' : true;     /* 'said': filed, and the toast already up must stand */
  }
  function fileLast() { if (!S.last) { toast('Nothing rolled yet.', true); return; } addCapture('r', S.last.text); }
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
    var a = keyAction({ key: ev.key, ctrlKey: ev.ctrlKey, altKey: ev.altKey, metaKey: ev.metaKey, typing: typing(ev.target) });
    if (!a) return;
    if (a.type === 'esc') { var t = ev.target; if (t && t.blur && typing(t)) { t.blur(); ev.preventDefault(); } return; }
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
      case 'layer': setMap('layer', b.getAttribute('data-v')); renderLocation(); break;
      case 'draw': drawMap(); break;
      case 'ipad': showOnIpad(); break;
      case 'pushtext': pushText(); break;
      case 'blankipad': blankIpad(); break;
      case 'darkipad': darkIpad(); break;
      case 'scorescene': setScoreScene(); break;
      case 'sitesave': saveSite(); break;
      case 'siteopen': openSite(str(b.getAttribute('data-score'))); break;
      case 'siteroll': rollSite(str(b.getAttribute('data-score'))); break;
      case 'siteclear': clearSite(str(b.getAttribute('data-score'))); break;
      case 'ambretry': loadAmbient(); break;
      case 'ambmode': { var am = b.getAttribute('data-v'); if (am === 'pin') patchAmbient({ mode: 'pin', scene: AM.doc && ipadView(AM.doc).scene || 'harvest' }); else patchAmbient({ mode: am }); break; }
      case 'ambscene': patchAmbient({ mode: 'pin', scene: b.getAttribute('data-id') }); break;
      case 'ambskip': patchAmbient({ skip: true }); break;
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
    else if (t.hasAttribute('data-reveal')) { var rv = {}; rv[t.getAttribute('data-reveal')] = t.checked; patch({ loc: { map: { reveal: rv } } }); if (S.map) drawMap(); renderLocation(); }
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
    if (!el.__gm) { el.__gm = true; el.addEventListener('click', onClick); el.addEventListener('change', onChange); el.addEventListener('input', function (ev) { if (ev.target && ev.target.id === 'gm-find-q') { findRender(ev.target.value); return; } if (ev.target && ev.target.id === 'gm-gs-q') { filterScreen(ev.target.value); return; } if (ev.target && ev.target.id === 'gm-prep-q') { prepFilter(ev.target.value); return; } if (ev.target && ev.target.id === 'gm-dt-purveyor') { clearTimeout(wire.dt); var pv = ev.target; wire.dt = setTimeout(function () { if (S) dtField('purveyor', pv.value); }, 500); return; } if (ev.target && ev.target.type === 'text' && ev.target.hasAttribute('data-ctl')) { clearTimeout(wire.t); var t = ev.target; wire.t = setTimeout(function () { if (S) { var l = {}; l[t.getAttribute('data-ctl')] = t.value; patch({ con: { live: l } }); } }, 500); } }); el.addEventListener('submit', onSubmit); el.addEventListener('toggle', onToggle, true); el.addEventListener('scroll', onScroll, true); }
    if (!wire.global) {
      wire.global = true;
      document.addEventListener('keydown', onKey, true);
      W.addEventListener('focus', function () { refetch(); if (S && S.status === 'ready' && S.panel === 'ipad') loadAmbient(); });
      /* leaving or hiding the tab: what is pending goes now, as a keepalive request (also from a session already closed) */
      document.addEventListener('visibilitychange', function () { if (document.hidden) { if (lastSaver) lastSaver.beacon(); } else if (S) { refetch(); if (S.status === 'ready' && S.panel === 'ipad') loadAmbient(); } });
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
      renderRail(); renderBar(); scMaybeRedraw();
      /* the stage changed: the NPC tab's buttons follow */
      if ((isObj(camp) && isObj(camp.scene) ? JSON.stringify(camp.scene.npcs || {}) : '') !== before) {
        [].forEach.call(S.root.querySelectorAll('[data-gm="npcstage"]'), function (b) { var on = staged(b.getAttribute('data-id')); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Off stage' : 'Put on stage'; b.classList.toggle('primary', !on); });
      }
      if (S.clocksSvg && AM.shown && AM.shown.kind === 'svg' && AM.shown.title === 'Clocks') {
        var me = S; clearTimeout(S.clocksT);
        S.clocksT = setTimeout(function () { if (S !== me || !AM.shown || AM.shown.title !== 'Clocks') return; var svg = clocksSvg(tableClocks()); if (svg && svg !== S.clocksSvg) clocksToIpad(true); }, 700);
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
    _state: function () { return S ? { status: S.status, locRoll: S.locRoll, map: S.map && { layer: S.map.layer }, panel: S.panel, seg: S.seg, doc: S.doc } : null; },
    _pushDisplay: function (d) { return pushDisplay(d); },
    _ambient: function () { return { doc: AM.doc, shown: AM.shown, loaded: AM.loaded, crew: crewSync.state().lastSent }; }
  };
});
