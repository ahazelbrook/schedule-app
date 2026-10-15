/* gm-page.js — the GM's page (#gm, GM.md): the console (four Situations, or the nine Classic rollers), the location generator
   with its map, the cast as a list to push to the iPad, the state rail (crew, clocks, bargains owed, pins, who is on stage) and
   the capture bar. S opens the street scene roller and E the engagement roll, beside the location generator (side panels).
   Hosted build only (window.claude.gm); in the claude.ai artifact, or for a player, the page says so and does nothing.

   window.B68GmPage (boot.js):
     open(root, api)   draw into `root` (boot calls it when the mode becomes `gm`)
     close()           flush the pending state write, drop listeners
     campaign(doc)     the campaign document changed (crew, clocks, session, scene)
     purge()           forget every GM pack cached in this browser (boot calls it when the viewer is not the GM)
   api = { ready() -> Promise, isGM() -> bool, me() -> id, gm() -> window.claude.gm | null, db() -> db | null,
           campaign() -> doc | null, saveFile(name, data), copy(text, okMessage) }

   Where things live. The pack (the generators' tables, GM-only text) comes from GET /api/gm/pack and is cached in
   IndexedDB only (db `b68-gm`, store `kv`, key `pack:<userId>`): never localStorage, the artifact db or Cache Storage.
   The GM state document (GET/PATCH /api/gm/state) holds the live controls, the current card per tool as replay info
   ({seed, ui, mem-before}, never the card), the last five rolls per tool, pins, capture and the console's bargains;
   patches are maps (null deletes), debounced 800 ms. `b68.gm.sticky` in localStorage mirrors the live controls and the
   current cards (replay info only) so a reload draws at once. Nothing from capture is written to the campaign log.

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

  /* Release switch. true: the console opens on the four Situations, with a Situations | Classic toggle in its header.
     false: no toggle and no Situations, only the nine-button Classic console (the safe release, GM.md). */
  var SITUATIONS_DEFAULT = true;

  /* =====================================================================================================================
     Pure helpers (no DOM)
     ===================================================================================================================== */
  var P = {};
  var LIMITS = P.LIMITS = { hist: 5, pins: 50, capture: 400, captureText: 500, stateSoft: 240 * 1024, stateCap: 256 * 1024, debounce: 800, staleDays: 3, partBytes: 900 * 1024, parts: 12 };
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
  P.applyPatch = applyPatch; P.mergePatch = mergePatch;

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
  /* the history / current-card entry for a console roll: replay info only, never the card */
  function consoleEntry(res, con) {
    var rp = res.replay;
    return { id: rp.id, seed: rp.seed, ui: rp.ui, mem: JSON.stringify(rp.mem), con: conSnapshot(con), label: str(res.meta && res.meta.label), at: nowIso() };
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
     any other 4xx (malformed, too large, forbidden) will fail the same way again. */
  function retryable(e) { var s = e && e.status; return !s || s === 409 || s === 429 || s >= 500; }
  P.retryable = retryable;
  /* The write queue for one page session. add() folds a patch into the pending one and saves after `debounce` ms; one
     write is in flight at a time, and whatever was added meanwhile goes as soon as it lands (even after the page closed:
     the session flushes itself, it does not look at whether the page is still open). A retryable failure puts the patch
     back and retries with backoff; any other is parked (kept for the sticky copy, never resent) so later patches still
     save. o = { send(patch) -> Promise<{ doc, updatedAt }>, beacon?(patch) -> Promise, saved(r, pendingAfter),
     changed(state), delay(fn, ms) -> handle, cancel(handle), debounce } */
  function makeSaver(o) {
    var st = { pending: null, writing: false, parked: null, error: '', retryMs: 0, timer: null };
    function changed() { if (o.changed) { try { o.changed(st); } catch (e) {} } }
    function schedule(ms) { if (st.timer !== null) o.cancel(st.timer); st.timer = o.delay(function () { st.timer = null; flush(); }, ms); }
    function add(p) { st.pending = st.pending ? mergePatch(st.pending, p) : clone(p); schedule(o.debounce); changed(); }
    function flush() {
      if (st.timer !== null) { o.cancel(st.timer); st.timer = null; }
      if (st.writing || !st.pending) return Promise.resolve();
      var p = st.pending; st.pending = null; st.writing = true; changed();
      return Promise.resolve().then(function () { return o.send(p); }).then(function (r) {
        st.writing = false; st.retryMs = 0; if (!st.parked) st.error = '';
        if (o.saved) { try { o.saved(r, st.pending); } catch (e) {} }
        changed();
        if (st.pending) return flush();
      }, function (e) {
        st.writing = false;
        if (retryable(e)) {
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
      if (!st.pending || !o.beacon) return flush();
      var p = st.pending; st.pending = null;
      return Promise.resolve().then(function () { return o.beacon(p); }).then(function (r) { if (r && o.saved) { try { o.saved(r, st.pending); } catch (e) {} } },
        function () { st.pending = st.pending ? mergePatch(p, st.pending) : p; });
    }
    return { add: add, flush: flush, beacon: beacon, state: function () { return st; } };
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

  /* ---------- the iPad panel: the ambient scenes, the crew sync, the score scene (AMBIENT-PLAN.md) ---------- */
  /* The scenes the picker offers (ids mirror Pure.AMBIENT_SCENES in display-page.js and AMBIENT_SCENES in functions/_lib/gm.js). */
  P.IPAD_SCENES = [
    { id: 'harvest', label: 'The lair' }, { id: 'watch', label: 'City Watch feed' }, { id: 'duskwall', label: 'The city after dark' },
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

  /* a key press on #gm -> an action, or null. ev: { key, ctrlKey, altKey, metaKey, typing, view }
     view 'situations': 1-4 roll a situation (5-9 do nothing); anything else (Classic): 1-9 roll a single table */
  function keyAction(ev) {
    if (!ev || ev.ctrlKey || ev.altKey || ev.metaKey) return null;
    var k = str(ev.key);
    if (ev.typing) return k === 'Escape' ? { type: 'esc' } : null;
    if (ev.view === 'situations') { if (/^[1-4]$/.test(k)) return { type: 'situation', n: +k }; if (/^[5-9]$/.test(k)) return null; }
    else if (/^[1-9]$/.test(k)) return { type: 'button', n: +k };
    switch (k.toLowerCase()) {
      case 'n': return { type: 'panel', panel: 'npc' };
      case 'b': return { type: 'panel', panel: 'location' };
      case 't': return { type: 'panel', panel: 'rules' };
      case 's': return { type: 'panel', panel: 'scenes' };
      case 'e': return { type: 'panel', panel: 'engagement' };
      case 'p': return { type: 'capture', bucket: 'n' };
      case 'x': return { type: 'capture', bucket: 'x' };
      case 'm': return { type: 'capture', bucket: 'm' };
      case 'l': return { type: 'last' };
      case 'h': return { type: 'blank' };
      case 'i': return { type: 'panel', panel: 'ipad' };
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

  /* ---------- Situations: which console shows, the session on a capture, and the composed card ---------- */
  P.SITUATIONS_DEFAULT = SITUATIONS_DEFAULT;
  var VIEW_KEY = 'b68.gm.view';
  P.VIEW_KEY = VIEW_KEY;
  /* 'situations' or 'classic'. `stored` is what this device remembered; the switch off (or a console without the
     situations layer) is always Classic, whatever was remembered. */
  function conView(stored, hasSituations, flag) {
    if (!(flag === undefined ? SITUATIONS_DEFAULT : flag) || !hasSituations) return 'classic';
    return stored === 'classic' ? 'classic' : 'situations';
  }
  P.conView = conView;
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
  /* the history / current-card entry for a composed card (id 'situation', never 'console'): replay info only */
  function situationEntry(res, con) {
    var rp = res.replay;
    return { id: rp.id, situation: rp.situation, seed: rp.seed, ui: rp.ui, mem: JSON.stringify(rp.mem), con: conSnapshot(con), label: str(res.meta && res.meta.label), at: nowIso() };
  }
  function replaySituationEntry(C, T, campaign, e, fallback) {
    if (!C || !T || !isObj(e) || e.id !== 'situation') return null;
    var mem = {}, state = fallback || {};
    try { mem = JSON.parse(e.mem || '{}'); } catch (x) {}
    if (typeof e.con === 'string') { try { state = JSON.parse(e.con); } catch (x) {} }
    try { return C.create({ T: T, campaign: campaign || {}, state: state, mem: {} }).replay({ id: 'situation', situation: e.situation, seed: e.seed, ui: e.ui || {}, mem: mem }); } catch (x) { return null; }
  }
  P.situationEntry = situationEntry; P.replaySituationEntry = replaySituationEntry;
  /* a composed card as plain text (Copy, Pin, "L files last roll") */
  function situationPlain(res) {
    var m = res && res.meta || {}, out = [str(m.title) + (m.sub ? ' (' + str(m.sub) + ')' : '')];
    (res && res.sections || []).forEach(function (s, i) {
      out.push((i ? 'Or ' : '') + str(s.title) + ': ' + plainMd(s.lead));
      (s.lines || []).forEach(function (l) {
        if (l.kind === 'grid') (l.rows || []).forEach(function (r) { out.push('  ' + str(r.k) + ': ' + plainMd(r.md)); });
        else out.push('  ' + plainMd(l.md) + (l.small ? ' ' + plainMd(l.small) : ''));
      });
    });
    return out.join('\n');
  }
  P.situationPlain = situationPlain;
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
  /* The composed card: the LEAD box (big line, chips, its own lines under "More"), then at most three one-line "Or"
     rows that open to their full section, then ONE merged actions row. */
  function situationCardHtml(res, mdf) {
    var m = res.meta || {}, secs = res.sections || [];
    var h = '<article class="gm-card gm-sit" data-tool="situation" data-sit="' + esc(m.situation) + '"><header class="gm-card-h"><kbd class="gm-card-n">' + esc(m.n) + '</kbd><div><h3>' + esc(m.title) + '</h3>' + (m.sub ? '<p class="gm-sub">' + esc(m.sub) + '</p>' : '') + '</div></header>';
    if (!secs.length) return h + linesHtml(res.lines, mdf) + actsHtml(m, 'situation') + '</article>';
    var lead = secs[0];
    h += '<section class="gm-lead" data-sec="' + esc(lead.id) + '"><p class="gm-lead-k">' + esc(lead.title) + '</p><p class="gm-lead-t">' + esc(lead.lead) + '</p>' + chipsHtml(lead.chips) +
      ((lead.lines || []).length ? '<details class="gm-more"><summary>More</summary><div class="gm-more-b">' + linesHtml(lead.lines, mdf) + '</div></details>' : '') + '</section>';
    secs.slice(1, 4).forEach(function (s) {
      h += '<details class="gm-or" data-sec="' + esc(s.id) + '"><summary><span class="gm-or-k">Or</span><span class="gm-or-t"><b>' + esc(s.title) + '</b> ' + esc(s.lead) + '</span></summary><div class="gm-or-b">' +
        (s.sub ? '<p class="gm-sub">' + esc(s.sub) + '</p>' : '') + chipsHtml(s.chips) + linesHtml(s.lines, mdf) + '</div></details>';
    });
    return h + actsHtml(m, 'situation') + '</article>';
  }
  P.linesHtml = linesHtml; P.classicCardHtml = classicCardHtml; P.situationCardHtml = situationCardHtml;

  if (!W || !W.document) return { _pure: P };

  /* =====================================================================================================================
     The page
     ===================================================================================================================== */
  var document = W.document;
  var IDB = 'b68-gm', STORE = 'kv', STICKY = 'b68.gm.sticky';
  var S = null;                  /* the open page; null when closed */
  var camp = null;               /* the latest campaign document from boot */
  var gate = makeGate();
  var lastSaver = null;          /* the newest session's saver: pagehide sends what it still holds */
  var keptApi = null;            /* the page api of the last open() that found the GM: the heat sync outlives the page (campaign() keeps arriving) */
  /* The ambient document as the server holds it (the truth), what the iPad was last told to spotlight, and the panel's state.
     Module-level, not in S: the heat / wanted sync keeps running while the page is closed. */
  var AM = { doc: null, seq: null, updatedAt: null, shown: null, loaded: false, busy: 0, error: '', displayRead: false };

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
  function writeSticky() {
    if (!S) return;
    var parked = S.saver ? S.saver.state().parked : null;
    if (S.carriedParked) parked = parked ? mergePatch(S.carriedParked, parked) : S.carriedParked;
    try { W.localStorage.setItem(STICKY, JSON.stringify({ v: 1, user: S.me, live: (S.doc.con || {}).live || {}, cards: S.doc.cards || {}, parked: parked || undefined, at: nowIso() })); } catch (e) {}
  }

  /* ---------- the GM state document ---------- */
  var HARD = LIMITS.stateCap - 4096;          /* the server's cap less a margin for its own keys */
  /* every change goes through here: sized in bytes; refused past the soft cap (a roll, `force`, may go up to the hard cap) */
  function patch(p, opts) {
    if (!S || !S.saver) return false;
    var next = applyPatch(S.doc, p), b = bytes(next), force = !!(opts && opts.force);
    if (b > (force ? HARD : LIMITS.stateSoft)) { toast('The GM notes are full (' + Math.round(b / 1024) + ' of 256 KiB). Export tonight’s note and clear the capture first.', true); return false; }
    S.doc = next;
    S.saver.add(p);
    writeSticky();
    return true;
  }
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
          .then(function (res) { if (!res.ok) { var e = new Error('HTTP ' + res.status); e.status = res.status; throw e; } return res.json(); });
      },
      saved: function (r, pendingAfter) {
        if (!r || !isObj(r.doc)) return;
        me.updatedAt = r.updatedAt || me.updatedAt;
        me.doc = pendingAfter ? applyPatch(r.doc, pendingAfter) : r.doc;
      },
      changed: function (st) {
        if (S !== me) return;
        syncSave();
        if (st.parked && !me.parkedToasted) { me.parkedToasted = true; toast('Not saved: the server refused a change (' + st.error + '). It is kept on this device; later changes still save.', true); writeSticky(); }
      }
    });
  }
  function flush() { return S && S.saver ? S.saver.flush() : Promise.resolve(); }
  function busy() { var st = S && S.saver ? S.saver.state() : null; return !!(st && (st.pending || st.writing)); }
  function syncSave() {
    var n = $q('#gm-save'); if (!n || !S.saver) return;
    var st = S.saver.state();
    n.textContent = st.parked ? 'Not saved' : st.error === 'retrying' ? 'Offline: retrying' : st.writing || st.pending ? 'Saving…' : S.updatedAt ? 'Saved' : '';
    n.classList.toggle('bad', !!st.parked || st.error === 'retrying');
    if (st.parked) n.title = 'The server refused a change: ' + st.error;
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
  function adoptMem() {
    var m = isObj(S.doc.mem) ? S.doc.mem : {};
    if (S.con) { var cm = S.con.mem(); Object.keys(cm).forEach(function (k) { delete cm[k]; }); Object.assign(cm, clone(m.console || {})); }
    S.locMem = clone(m.location || {}); S.scnMem = clone(m.scenes || {}); S.npcMem = clone(m.npc || {});
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
      pack: null, con: null, conRes: null, conErr: '', locRoll: null, locMem: {}, locErr: '', map: null, panel: 'location', seg: 'console', scn: null, scnRoll: null, scnMem: {}, scnErr: '', eng: null, engRoll: null, engErr: '',
      arm: 'n', last: null, npcs: {}, npcUnsub: null, sceneOpen: false, capOpen: false, pinOpen: null, figMemo: {}, importing: null, view: 'classic', shown: 'console' };
    try { S.panel = W.localStorage.getItem('b68.gm.panel') || 'location'; } catch (e) {}
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
      else if (sticky) { me.doc = { con: { live: sticky.live || {} }, cards: sticky.cards || {} }; toast('The GM notes are offline: showing this device’s last copy.', true); }
      if (sticky && isObj(sticky.parked)) me.carriedParked = sticky.parked;   /* a change the server refused earlier stays on this device */
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
    S = null;
    if (me.root) { me.root.innerHTML = ''; }
    unblank();
  }

  /* ---------- screens ---------- */
  function screen(html) { if (!S || !S.root) return; S.root.innerHTML = '<div class="gm gm-screen">' + html + '</div>'; }
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
    var rows = v.parts.map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td class="num">' + (p.bytes / 1024).toFixed(1) + ' KiB</td><td>' + esc(p.src && p.src.exportedAt ? dmy(p.src.exportedAt) : '') + '</td></tr>'; }).join('');
    box.innerHTML = '<h2>' + esc(name || 'The pack') + '</h2>' +
      (v.exportedAt ? '<p class="gm-dim">Exported ' + esc(dmy(v.exportedAt)) + ' · ' + v.parts.length + ' part' + (v.parts.length === 1 ? '' : 's') + '</p>' : '') +
      (rows ? '<table class="gm-tbl"><thead><tr><th>Part</th><th class="num">Size</th><th>Exported</th></tr></thead><tbody>' + rows + '</tbody></table>' : '') +
      (v.errors.length ? '<ul class="gm-errs">' + v.errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>' : '') +
      '<p class="gm-up"><button type="button" class="btn primary" data-gm="upload"' + (v.ok ? '' : ' disabled') + '>Upload ' + v.parts.length + ' part' + (v.parts.length === 1 ? '' : 's') + '</button> <progress id="gm-prog" max="' + Math.max(1, v.parts.length) + '" value="0" hidden></progress> <span id="gm-upmsg" class="gm-dim" role="status"></span></p>';
  }
  function upload() {
    var pk = S && S.importing, g = gmApi(); if (!pk || !g) return;
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
    if (!S || !W.confirm('Forget the GM pack and the GM notes cached on this device? The server keeps its copy; the page reloads it next time.')) return;
    var me = S;
    Promise.all([kvDel('pack:' + me.me).catch(function () {}), Promise.resolve().then(function () { try { W.localStorage.removeItem(STICKY); } catch (e) {} })]).then(function () {
      if (S !== me) return;
      me.pack = null; me.status = 'off';
      screen(note('GM data forgotten on this device.', 'The pack and the GM notes cached here are gone. Load them again from the server when you need them.') + '<p><button type="button" class="btn sm primary" data-gm="retry">Load again</button></p>');
      toast('GM data forgotten on this device.');
    });
  }

  /* ---------- start: the console instance, the generator, the layout ---------- */
  function start() {
    var cp = part('console'), C = W.B68GmConsole, m = isObj(S.doc.mem) ? S.doc.mem : {};
    S.con = null; S.conErr = '';
    if (!C || !cp || !isObj(cp.T)) S.conErr = !C ? 'The console module is missing.' : 'The pack has no console part. Update the pack.';
    else { try { S.con = C.create({ T: cp.T, campaign: part('campaign') || {}, state: S.doc.con || {}, mem: clone(m.console || {}) }); } catch (e) { S.conErr = 'The console could not start: ' + errText(e); } }
    S.view = conView(storedView(), hasSit());
    S.locMem = clone(m.location || {}); S.locErr = ''; S.scnMem = clone(m.scenes || {}); S.scn = null; S.eng = null; S.npcg = null; S.npcMem = clone(m.npc || {}); S.npcRoll = null;
    if (!W.B68GmLocation) S.locErr = 'The location module is missing.'; else if (!part('location') || !isObj(part('location').T)) S.locErr = 'The pack has no location part. Update the pack.';
    S.status = 'ready';
    layout(); redrawAll(); subscribeNpcs();
    if (S.panel === 'ipad') loadAmbient();
  }
  function layout() {
    var segs = [['console', 'Console'], ['location', 'Location'], ['scenes', 'Street'], ['engagement', 'Engage'], ['npc', 'NPC'], ['ipad', 'iPad'], ['state', 'State']];
    S.root.innerHTML = '<div class="gm" id="gm-root" data-seg="' + esc(S.seg) + '" data-panel="' + esc(S.panel) + '" data-view="' + esc(S.view) + '">' +
      '<div class="gm-head"><div class="gm-title"><p class="gm-kick">GM tools <span id="gm-save" class="gm-save" role="status"></span></p>' + '<h1 class="gm-h" tabindex="-1">The console</h1><p class="gm-exp" id="gm-exp"></p></div>' +
      '<div class="gm-acts"><a class="btn sm primary" href="#display" id="gm-display" title="The players’ screen: open this on the iPad">Display</a>' + '<button type="button" class="btn sm" data-gm="note">Export tonight’s note</button><button type="button" class="btn sm" data-gm="update">Update pack</button>' + '<button type="button" class="btn sm" data-gm="forget">Forget GM data on this device</button></div></div>' +
      '<div class="seg gm-segbar" role="tablist" aria-label="Show">' + segs.map(function (s) { return '<button type="button" class="chip" role="tab" data-gm="seg" data-seg="' + s[0] + '">' + s[1] + '</button>'; }).join('') + '</div>' +
      '<div class="gm-main">' +
      '<section class="gm-col gm-console" aria-label="Console">' + '<div class="gm-conhead"><h2 class="gm-conh">Console</h2>' + viewToggle() + '</div>' +
      '<div class="gm-pos" id="gm-pos" role="radiogroup" aria-label="Position"></div>' +
      '<button type="button" class="gm-scene" id="gm-scene" data-gm="scene" aria-expanded="false" aria-controls="gm-controls"><span class="gm-lab">Scene</span>' + '<span class="gm-scene-chips" id="gm-scene-chips"></span></button>' +
      '<div class="gm-controls" id="gm-controls"></div><div class="gm-buttons" id="gm-buttons"></div><div class="gm-singles" id="gm-singles"></div><div class="gm-cardbox" id="gm-card" aria-live="polite"></div>' + '<div class="gm-earlier" id="gm-earlier"></div></section>' +
      '<section class="gm-col gm-side" aria-label="Side panel"><div class="gm-tabs" role="tablist" aria-label="Side panel">' +
      [['location', 'Location', 'B'], ['scenes', 'Street', 'S'], ['engagement', 'Engage', 'E'], ['npc', 'NPC', 'N'], ['rules', 'Rules', 'T'], ['ipad', 'iPad', 'I']].map(function (t) { return '<button type="button" class="gm-tab" role="tab" data-gm="panel" data-panel="' + t[0] + '">' + t[1] + ' <kbd>' + t[2] + '</kbd></button>'; }).join('') +
      '</div><div class="gm-pane" data-pane="location" id="gm-loc"></div><div class="gm-pane" data-pane="scenes" id="gm-scn"></div><div class="gm-pane" data-pane="engagement" id="gm-eng"></div>' + '<div class="gm-pane" data-pane="npc" id="gm-npc"></div><div class="gm-pane" data-pane="rules" id="gm-rules"></div><div class="gm-pane" data-pane="ipad" id="gm-ipad"></div></section>' +
      '<aside class="gm-col gm-rail" id="gm-rail" aria-label="State"></aside></div>' +
      '<div class="gm-foot" id="gm-foot"></div>' +
      '<button type="button" class="gm-fab" data-gm="capopen" aria-expanded="false" aria-controls="gm-foot">Capture</button></div>';
    renderRules();
  }
  /* the one-tap Situations | Classic toggle in the console header; none while the release switch is off */
  function viewToggle() {
    if (!SITUATIONS_DEFAULT || !hasSit()) return '';
    return '<div class="seg gm-viewseg" role="group" aria-label="Console view">' + [['situations', 'Situations'], ['classic', 'Classic']].map(function (o) {
      return '<button type="button" class="chip" data-gm="view" data-v="' + o[0] + '" aria-pressed="' + (S.view === o[0]) + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }
  function redrawAll() {
    if (!S || S.status !== 'ready' || !$q('#gm-root')) return;
    syncHead(); syncPanels(); renderView(); renderLocation(); renderScenes(); renderEngagement(); renderNpcs(); renderIpad(); renderRail(); renderCapture(); syncSave();
  }
  function syncHead() {
    var e = $q('#gm-exp'); if (!e) return;
    var cp = S.pack && S.pack.parts && (S.pack.parts.campaign || S.pack.parts.console), at = cp && cp.src && cp.src.exportedAt;
    var age = ageDays(at);
    e.textContent = at ? 'Campaign data exported ' + dmy(at) + (age != null && age > LIMITS.staleDays ? ' · ' + Math.floor(age) + ' days old: rebuild the pack' : '') + (S.offline ? ' · offline copy' : '') : 'Campaign data: no export date';
    e.classList.toggle('stale', age != null && age > LIMITS.staleDays);
  }
  function syncPanels() {
    var r = $q('#gm-root'); if (!r) return;
    r.setAttribute('data-seg', S.seg); r.setAttribute('data-panel', S.panel);
    r.querySelectorAll('[data-gm="seg"]').forEach(function (b) { var on = b.getAttribute('data-seg') === (S.seg === 'side' ? S.panel : S.seg); b.setAttribute('aria-selected', String(on)); b.setAttribute('aria-pressed', String(on)); });
    r.querySelectorAll('[data-gm="panel"]').forEach(function (b) { b.setAttribute('aria-selected', String(b.getAttribute('data-panel') === S.panel)); });
    r.querySelectorAll('.gm-pane').forEach(function (p) { p.hidden = p.getAttribute('data-pane') !== S.panel; });
    var sc = $q('#gm-scene'); if (sc) sc.setAttribute('aria-expanded', String(!!S.sceneOpen)); r.classList.toggle('scene-open', !!S.sceneOpen);
    var fab = $q('.gm-fab'); if (fab) fab.setAttribute('aria-expanded', String(!!S.capOpen)); r.classList.toggle('cap-open', !!S.capOpen);
  }
  function setPanel(p) {
    S.panel = p; if (S.seg !== 'console' && S.seg !== 'state') S.seg = 'side';
    try { W.localStorage.setItem('b68.gm.panel', p); } catch (e) {}
    syncPanels();
    if (p === 'ipad') loadAmbient();
  }

  /* ---------- the console: Situations (the default) or Classic (the nine single tables) ---------- */
  function hasSit() { return !!(S && S.con && typeof S.con.situation === 'function' && Array.isArray(S.con.situationControls) && typeof S.con.situations === 'function'); }
  function storedView() { try { return W.localStorage.getItem(VIEW_KEY); } catch (e) { return null; } }
  function sit() { return S.view === 'situations'; }
  function ctlList() { return !S.con ? [] : sit() ? S.con.situationControls.filter(function (c) { return c.id !== 'pos'; }) : S.con.controls; }
  function uiNow() { return clone(Object.assign(sit() ? S.con.situationDefaults() : S.con.defaults(), live())); }
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
          (c.options || []).map(function (o) { return '<option value="' + esc(o.value) + '"' + (str(o.value) === v ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select></label>';
      }).join('') + '</div>';
    }).join('');
    box.innerHTML = html;
    renderChips();
  }
  /* the Scene line's chips: what the controls are set to (the phone shows only this until the disclosure opens) */
  function renderChips() {
    var chips = $q('#gm-scene-chips'); if (!chips || !S.con) return;
    var lv = uiNow(), bits = [];
    ctlList().forEach(function (c) {
      var v = str(lv[c.id]); if (!v) return;
      var o = (c.options || []).filter(function (x) { return str(x.value) === v; })[0];
      bits.push('<span class="gm-chip">' + esc(o ? o.label : v.length > 28 ? v.slice(0, 26) + '…' : v) + '</span>');
    });
    chips.innerHTML = bits.join('') || '<span class="gm-dim">any</span>';
  }
  function setLive(id, value) { var l = {}; l[id] = value; patch({ con: { live: l } }); renderChips(); }
  /* the big three-way Position switch (Situations only; always on screen, the phone too) */
  function renderPos() {
    var box = $q('#gm-pos'); if (!box) return;
    if (!S.con || !sit()) { box.innerHTML = ''; return; }
    var cur = str(uiNow().pos);
    box.innerHTML = '<span class="gm-lab">Position</span><div class="gm-posb-row">' + S.con.positions.map(function (p) {
      return '<button type="button" class="gm-posb" role="radio" aria-checked="' + (p.value === cur) + '" data-gm="pos" data-v="' + esc(p.value) + '"><b>' + esc(p.label) + '</b><small>' + esc(p.severity + ' · ' + p.ticks) + '</small><small>harm ' + esc(p.harm) + '</small></button>';
    }).join('') + '</div>';
  }
  function renderButtons() {
    var box = $q('#gm-buttons'); if (!box) return;
    if (!S.con) { box.innerHTML = '<p class="gm-note bad">' + esc(S.conErr || 'The console is not available.') + '</p>'; return; }
    if (sit()) {
      box.innerHTML = S.con.situations().map(function (b) {
        return '<button type="button" class="gm-btn gm-sbtn" data-gm="situation" data-n="' + b.key + '" data-sit="' + esc(b.id) + '" title="' + esc(b.hint || '') + '"><kbd>' + b.key + '</kbd><b>' + esc(b.label) + '</b><small>' + esc(b.hint || '') + '</small></button>';
      }).join('');
      return;
    }
    box.innerHTML = S.con.buttons.map(function (b) {
      return '<button type="button" class="gm-btn" data-gm="roll" data-n="' + b.n + '" title="' + esc(b.hint || '') + '"><kbd>' + b.n + '</kbd><b>' + esc(b.label) + '</b><small>' + esc(b.hint || '') + '</small></button>';
    }).join('');
  }
  /* the nine classic rollers as a small row under the Situations (no keys) */
  function renderSingles() {
    var box = $q('#gm-singles'); if (!box) return;
    if (!S.con || !sit()) { box.innerHTML = ''; return; }
    box.innerHTML = '<span class="gm-lab">Single tables</span><div class="gm-singles-b">' + S.con.buttons.map(function (b) {
      return '<button type="button" class="chip sm" data-gm="roll" data-n="' + b.n + '" title="' + esc(b.hint || '') + '">' + esc(b.label) + '</button>';
    }).join('') + '</div>';
  }
  /* Situations | Classic: redraw everything that depends on it */
  function renderView() {
    var r = $q('#gm-root'); if (!r) return;
    r.setAttribute('data-view', S.view);
    r.querySelectorAll('[data-gm="view"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === S.view)); });
    renderPos(); renderControls(); renderButtons(); renderSingles(); drawConsoleCard();
  }
  function setView(v) {
    v = conView(v, hasSit()); if (v === S.view) return;
    S.view = v; S.conRes = null;
    try { W.localStorage.setItem(VIEW_KEY, v); } catch (e) {}
    renderView();
  }
  function setPos(v) { setLive('pos', v); renderPos(); }
  function stamp(kind, res) { S.conRes = res; S.shown = kind; S.last = { text: lastText(res) }; drawConsoleCard(res); }
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
  /* which stored card the console shows: Classic its own; Situations the newer of the situation card and a single table */
  function pickShown() {
    var c = isObj(S.doc.cards) ? S.doc.cards : {};
    if (!sit()) return 'console';
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
    box.innerHTML = res ? (res.sections ? situationCardHtml(res, md) : classicCardHtml(res, md)) : S.con ? (sit() ? '<p class="gm-empty">Press a button, or a number key <kbd>1</kbd>–<kbd>4</kbd>.</p>' : '<p class="gm-empty">Press a button, or a number key <kbd>1</kbd>–<kbd>9</kbd>.</p>') : '';
    var er = $q('#gm-earlier'); if (!er) return;
    var h = isObj(S.doc.hist) ? S.doc.hist : {}, list = [];
    (sit() ? ['situation', 'console'] : ['console']).forEach(function (t) { newest(h[t]).forEach(function (x) { x._tool = t; list.push(x); }); });
    list.sort(function (a, b) { return str(a.at) < str(b.at) ? 1 : str(a.at) > str(b.at) ? -1 : 0; });
    list = list.slice(0, LIMITS.hist);
    er.innerHTML = list.length ? '<span class="gm-lab">Earlier:</span>' + list.map(function (x) { return '<button type="button" class="chip txt sm" data-gm="replay" data-tool="' + x._tool + '" data-h="' + esc(x._id) + '"' + (cards[x._tool] && cards[x._tool].hid === x._id && S.shown === x._tool ? ' aria-current="true"' : '') + '>' + esc(x.label || x.id) + '</button>'; }).join('') : '';
  }
  function doIntent(i) {
    var res = S.conRes, a = res && res.meta && res.meta.actions && res.meta.actions[i], C = W.B68GmConsole; if (!a || !C) return;
    var it = a.intent, p; try { p = C.intentPatch(it, { date: dmy(new Date()) }); } catch (e) { toast(errText(e), true); return; }
    patch({ con: p });
    if (it.capture && it.capture.text) addCapture(it.capture.bucket || 'x', it.capture.text, true);
    try { S.con.setCampaign(part('campaign') || {}, S.doc.con || {}); } catch (e) {}
    toast(a.label.replace(/:.*$/, '') + '.');
    renderControls(); renderPos(); renderRail();
  }

  /* ---------- the location generator ---------- */
  function locUi() { var l = isObj(S.doc.loc) && isObj(S.doc.loc.ui) ? S.doc.loc.ui : {}; return Object.assign(W.B68GmLocation ? W.B68GmLocation.defaults() : {}, l); }
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
    patch({ cards: { location: Object.assign({ hid: hid }, entry) }, mem: { location: clone(S.locMem) }, hist: { location: addCapped(hist, hid, entry, LIMITS.hist) }, loc: { map: { reveal: clone(P.REVEAL0) } } }, { force: true });
    S.locRoll = roll; S.map = null; S.last = { text: 'Location: ' + entry.label };
    renderLocation(true);
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
      return '<label class="gm-field" for="' + id + '"><span class="gm-lab">' + esc(x.label) + '</span><select id="' + id + '" data-loc="' + esc(x.key) + '">' + (x.options || []).map(function (o) { return '<option value="' + esc(o.value) + '"' + (str(o.value) === str(ui[x.key]) ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select></label>';
    }).join('') + '<button type="button" class="btn primary gm-roll" data-gm="locroll">Roll a location</button></div>';
    if (roll) {
      h += '<article class="gm-card gm-loccard" data-tool="location">' + glanceHtml(L, roll, pk, revealList(mu)) + foldsHtml(L, roll, pk, revealList(mu)) +
        '<div class="gm-card-acts"><button type="button" class="btn sm" data-gm="pin" data-tool="location" title="Pins the glance card">Pin</button>' + '<button type="button" class="btn sm" data-gm="copy" data-tool="location" title="Copies the whole card">Copy</button></div></article>';
      /* the iPad controls (Layer, Reveal, the warning, Show on iPad, Set as score scene) stay visible together: never in a fold */
      h += '<section class="gm-mapbox" aria-label="Map"><h4>Map</h4><div class="gm-map-ctl">' +
        sel('view', 'View', VIEWS, mu.view) + sel('theme', 'Theme', THEMES, mu.theme) +
        '<div class="gm-field"><span class="gm-lab">Layer</span><div class="seg" role="group" aria-label="Layer">' + [['gm', 'GM'], ['player', 'Player']].map(function (o) { return '<button type="button" class="chip" data-gm="layer" data-v="' + o[0] + '" aria-pressed="' + (mu.layer === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div></div>' +
        '<fieldset class="gm-reveal"><legend class="gm-lab">Reveal to the players: ' + esc(mu.layer === 'player' ? revealList(mu).join(', ') : 'public only while Layer is GM') + '</legend>' + BANDS.map(function (b) { return '<label class="gm-check"><input type="checkbox" data-reveal="' + b + '"' + (b === 'public' || mu.reveal[b] ? ' checked' : '') + (b === 'public' ? ' disabled' : '') + '> <span>' + b + '</span></label>'; }).join('') + '</fieldset>' +
        '<button type="button" class="btn primary" data-gm="draw">Draw</button></div>' +
        '<p class="gm-warn" id="gm-mapwarn" role="status"></p>' +
        '<div class="gm-map-acts"><button type="button" class="btn sm primary" data-gm="ipad"' + (mu.layer === 'player' ? '' : ' disabled title="Switch Layer to Player: only the player layer goes to the iPad"') + '>Show on iPad</button>' +
        '<button type="button" class="btn sm" data-gm="scorescene"' + (mu.layer === 'player' ? '' : ' disabled title="Switch Layer to Player: only the player layer goes to the iPad"') + (mu.layer === 'player' ? ' title="The planning board and the exploded site on the iPad, from this roll at these bands"' : '') + '>Set as score scene</button>' +
        '<button type="button" class="btn sm" data-gm="blankipad" title="Back to the ambient scene (0)">Clear → ambient</button></div>' +
        '<div class="gm-map" id="gm-map"></div>' +
        '<details class="gm-more gm-dl"' + (foldOpen('dl') ? ' open' : '') + ' data-fold="dl"><summary>Downloads</summary><div class="gm-map-acts">' + '<button type="button" class="btn sm" data-gm="dlsvg">Download SVG</button><button type="button" class="btn sm" data-gm="dlnote">Download note (.md)</button>' + '<button type="button" class="btn sm" data-gm="dlcanvas">Download canvas</button></div></details>' + '</section>';
    } else h += '<p class="gm-empty">Choose what you know (or leave it on any) and roll. The card marks what is GM only.</p>' + '<p><button type="button" class="btn sm" data-gm="blankipad" title="Back to the ambient scene (0)">Clear → ambient</button></p>';
    var hist = newest(isObj(S.doc.hist) ? S.doc.hist.location : null).slice(0, LIMITS.hist);
    if (hist.length) h += '<div class="gm-earlier"><span class="gm-lab">Earlier:</span>' + hist.map(function (x) { return '<button type="button" class="chip txt sm" data-gm="replay" data-tool="location" data-h="' + esc(x._id) + '"' + (cur && cur.hid === x._id ? ' aria-current="true"' : '') + '>' + esc(x.label) + '</button>'; }).join('') + '</div>';
    box.innerHTML = h;
    if (S.map) showMap();
  }
  /* the glance card: place, whose, the bands, the target, the one line to say aloud. GM-only as a whole; the street
     button sends playerSummary (never this card) through pushText */
  function glanceHtml(L, roll, pk, reveal) {
    var g; try { g = L.glance(roll, pk, reveal); } catch (e) { return '<p class="gm-note bad">The card could not be drawn: ' + esc(errText(e)) + '</p>'; }
    var bands = g.bands.map(function (b) {
      return '<li class="gm-gband' + (b.shown ? ' shown' : '') + '"' + (b.shown ? ' title="The players can see this band"' : '') + '><b>' + esc(b.short) + '</b> ' + b.count + (b.locks ? ' <small>' + b.locks + (b.locks === 1 ? ' lock' : ' locks') + '</small>' : '') + (b.target ? ' <span class="gm-star" aria-label="target">★</span>' : '') + '</li>';
    }).join('');
    return '<section class="gm-glance gm-secret" data-sec="glance"><div class="gm-glance-h"><h3 class="gm-locname">' + esc(g.title) + '</h3><span class="gm-badge">GM only</span></div>' +
      '<p class="gm-glance-place">' + esc(g.place) + '</p>' +
      '<div class="gm-say"><span class="gm-lab">Say</span><p>“' + esc(g.say) + '”</p><button type="button" class="btn sm" data-gm="pushtext">Street description on iPad</button></div>' +
      '<dl class="gm-grid gm-glance-dl"><dt>Whose</dt><dd>' + esc(g.whose) + ' · Security <b>' + esc(g.security) + '</b></dd>' +
      '<dt>Bands</dt><dd><ol class="gm-gbands">' + bands + '</ol></dd>' +
      '<dt>Target</dt><dd>★ <b>' + esc(g.target.room) + '</b> (' + esc(String(g.target.band).toLowerCase()) + ') — ' + esc(g.target.what) + '</dd>' +
      (g.flags.length ? '<dt>Flags</dt><dd>' + g.flags.map(function (f) { return '<span class="gm-flag">! ' + esc(f) + '</span>'; }).join(' ') + '</dd>' : '') + '</dl></section>';
  }
  function foldsHtml(L, roll, pk, reveal) {
    var F = []; try { F = L.folds(roll, pk, reveal); } catch (e) { F = []; }
    return F.map(function (f) {
      return '<details class="gm-lfold' + (f.gm ? ' gm-secret' : '') + '" data-fold="' + esc(f.id) + '"' + (foldOpen(f.id) ? ' open' : '') + '><summary><span class="gm-lfold-t">' + esc(f.title) + '</span>' + (f.hint ? '<span class="gm-lfold-h">' + esc(f.hint) + '</span>' : '') + (f.gm ? '<span class="gm-badge">GM only</span>' : '') + '</summary><div class="gm-lfold-b">' + md((f.lines || []).join('\n')) + '</div></details>';
    }).join('');
  }
  /* which location folds are open: this device only (localStorage), fold ids only, never table text */
  var FOLD_KEY = 'b68.gm.locfold';
  function foldState() { try { var a = JSON.parse(W.localStorage.getItem(FOLD_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function foldOpen(id) { return foldState().indexOf(id) >= 0; }
  function onToggle(ev) {
    var d = ev.target; if (!d || !d.getAttribute || !d.hasAttribute('data-fold')) return;
    var id = d.getAttribute('data-fold'), a = foldState().filter(function (x) { return x !== id && /^[a-z-]{1,24}$/.test(x); });
    if (d.open) a.push(id);
    try { W.localStorage.setItem(FOLD_KEY, JSON.stringify(a.slice(-20))); } catch (e) {}
  }
  function sel(key, label, list, v) { return '<label class="gm-field" for="gm-m-' + key + '"><span class="gm-lab">' + label + '</span><select id="gm-m-' + key + '" data-map="' + key + '">' + list.map(function (o) { return '<option value="' + o + '"' + (o === v ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select></label>'; }
  function drawMap() {
    var K = W.B68Map; if (!S.locRoll) { toast('Roll a location first.', true); return; }
    if (!K || !K.render) { toast('The map kit is missing.', true); return; }
    var mu = mapUi(), r;
    try { r = K.render(S.locRoll, { view: mu.view, theme: mu.theme, layer: mu.layer === 'player' ? 'player' : 'gm', reveal: revealList(mu), width: 1400 }); } catch (e) { toast('The map could not be drawn: ' + errText(e), true); return; }
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
    pushDisplay({ kind: 'text', title: plainText(ps.title).slice(0, 2000), caption: str(S.locRoll.district || ''), text: plainText(ps.text).slice(0, 2000) }).then(function () { toast('On the iPad: the street description.'); }, function (e) { toast('Could not send to the iPad: ' + errText(e), true); });
  }
  /* Clear -> ambient: nothing spotlit, the ambient scene plays. Lights out: true black. */
  function blankIpad() { pushDisplay({ kind: 'blank' }).then(function () { toast('Cleared: the iPad plays the ambient scene.'); }, function (e) { toast('Could not clear the iPad: ' + errText(e), true); }); }
  function darkIpad() { pushDisplay({ kind: 'dark' }).then(function () { toast('Lights out on the iPad.'); }, function (e) { toast('Could not turn the lights out: ' + errText(e), true); }); }

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
      '<button type="button" class="btn" data-gm="ambskip"' + (off || busy || v.mode !== 'auto' ? ' disabled' : '') + ' title="Auto mode only">Next scene</button></div></div></section>';
    h += '<section class="gm-box gm-ipad-score"><h3 class="gm-band">Score scene</h3><div class="gm-ipad-body"><p class="gm-ipad-line" id="gm-ipad-score">' + (v.hasScore ? esc(v.scoreLine) : '<span class="gm-dim">None set. Use Set as score scene in the Location panel.</span>') + '</p>' +
      '<button type="button" class="btn sm" data-gm="clearscore"' + (!v.hasScore || off || busy ? ' disabled' : '') + '>Clear score</button></div></section>';
    box.innerHTML = h;
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

  var SIDE = ['location', 'scenes', 'engagement', 'npc', 'rules', 'ipad'];
  /* ---------- the street scene roller (S) and the engagement roll (E): side panels ---------- */
  function genLinesHtml(lines) {
    return (lines || []).map(function (l) { return l.kind === 'chips' ? chipsHtml(l.chips) : linesHtml([l], md); }).join('');
  }
  function earlierHtml(tool, cur) {
    var hist = newest(isObj(S.doc.hist) ? S.doc.hist[tool] : null).slice(0, LIMITS.hist);
    return hist.length ? '<div class="gm-earlier"><span class="gm-lab">Earlier:</span>' + hist.map(function (x) {
      return '<button type="button" class="chip txt sm" data-gm="replay" data-tool="' + esc(tool) + '" data-h="' + esc(x._id) + '"' + (cur && cur.hid === x._id ? ' aria-current="true"' : '') + '>' + esc(x.label) + '</button>';
    }).join('') + '</div>' : '';
  }
  function selectHtml(id, attr, key, label, options, value) {
    return '<label class="gm-field" for="' + id + '"><span class="gm-lab">' + esc(label) + '</span><select id="' + id + '" ' + attr + '="' + esc(key) + '">' + options.map(function (o) {
      return '<option value="' + esc(o.value) + '"' + (str(o.value) === str(value) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('') + '</select></label>';
  }

  function scnInst() {
    if (S.scn) return S.scn;
    var M = W.B68GmScenes, pk = part('scenes');
    if (!M) { S.scnErr = 'The street scene module is missing.'; return null; }
    if (!pk || !isObj(pk.T)) { S.scnErr = 'The pack has no scenes part. Update the pack.'; return null; }
    try { S.scn = M.create({ T: pk.T }); S.scnErr = ''; } catch (e) { S.scnErr = 'The street scenes could not start: ' + errText(e); }
    return S.scn;
  }
  function scnUi() { var l = isObj(S.doc.scn) && isObj(S.doc.scn.ui) ? S.doc.scn.ui : {}, sc = scnInst(); return Object.assign(sc ? sc.defaults() : {}, l); }
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
    var h = '<div class="gm-loc-ctl">' + sc.controls.map(function (x) { return selectHtml('gm-s-' + x.id, 'data-scn', x.id, x.label, x.options, ui[x.id]); }).join('') +
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

  function engInst() {
    if (S.eng) return S.eng;
    var M = W.B68GmEngagement, pk = part('engagement');
    if (!M) { S.engErr = 'The engagement module is missing.'; return null; }
    if (!pk || !isObj(pk.T)) { S.engErr = 'The pack has no engagement part. Update the pack.'; return null; }
    try { S.eng = M.create({ T: pk.T }); S.engErr = ''; } catch (e) { S.engErr = 'The engagement roll could not start: ' + errText(e); }
    return S.eng;
  }
  function engUi() {
    var l = isObj(S.doc.eng) && isObj(S.doc.eng.ui) ? S.doc.eng.ui : {}, en = engInst(), d = en ? en.defaults() : { mods: {} };
    return { approach: l.approach || d.approach, load: l.load || d.load, mods: Object.assign({}, d.mods, isObj(l.mods) ? l.mods : {}) };
  }
  function replayEngagement(e) {
    var en = engInst(); if (!en || !isObj(e)) return null;
    try { return en.roll(e.ui || {}, { seed: e.seed }); } catch (x) { return null; }
  }
  function rollEngagement() {
    var en = engInst(); if (!en) { renderEngagement(); return; }
    var roll;
    try { roll = en.roll(engUi(), {}); } catch (e) { toast('The engagement roll failed: ' + errText(e), true); return; }
    var entry = { seed: roll.seed, ui: roll.replay.ui, label: str(roll.meta.title) + ' · ' + str(roll.position).split(' — ')[0], at: nowIso() };
    var hid = uid('h'), hist = isObj(S.doc.hist) && isObj(S.doc.hist.engagement) ? S.doc.hist.engagement : {};
    patch({ cards: { engagement: Object.assign({ hid: hid }, entry) }, hist: { engagement: addCapped(hist, hid, entry, LIMITS.hist) } }, { force: true });
    S.engRoll = roll; S.last = { text: 'Engagement: ' + entry.label };
    renderEngagement(true);
  }
  /* a control changed: the roll on screen no longer matches, so it goes (the Earlier row keeps it) and the pool is shown again */
  function setEngagement(key, value, mod) {
    var u = {};
    if (mod) { u.mods = {}; u.mods[key] = +value || 0; } else u[key] = value;
    patch({ eng: { ui: u }, cards: { engagement: null } });
    S.engRoll = null; renderEngagement();
  }
  function renderEngagement(fresh) {
    var box = $q('#gm-eng'); if (!box) return;
    var en = engInst();
    if (!en) { box.innerHTML = '<p class="gm-note bad">' + esc(S.engErr || 'The engagement roll is not available.') + '</p>'; return; }
    var cur = isObj(S.doc.cards) ? S.doc.cards.engagement : null;
    if (!fresh && cur && (!S.engRoll || S.engRoll.seed !== cur.seed)) S.engRoll = replayEngagement(cur);
    var ui = engUi(), roll = S.engRoll, c = roll || en.card(ui);
    var TRI = [{ value: 0, label: '—' }, { value: 1, label: '+1d' }, { value: -1, label: '−1d' }];
    var h = '<div class="gm-loc-ctl">' + en.controls.map(function (x) {
      if (x.type === 'tri') return '<label class="gm-field wide" for="gm-e-' + esc(x.id) + '"><span class="gm-lab">' + esc(x.label) + '</span><select id="gm-e-' + esc(x.id) + '" data-engmod="' + esc(x.id) + '">' + TRI.map(function (o) {
        return '<option value="' + o.value + '"' + (+ui.mods[x.id] === o.value ? ' selected' : '') + '>' + o.label + '</option>';
      }).join('') + '</select></label>';
      return selectHtml('gm-e-' + x.id, 'data-eng', x.id, x.label, x.options, ui[x.id]);
    }).join('') + '<button type="button" class="btn primary gm-roll" data-gm="engroll">Roll engagement</button></div>';
    h += '<article class="gm-card gm-engcard" data-tool="engagement"><header class="gm-card-h"><div><h3>' + esc(c.meta.title) + '</h3><p class="gm-sub">' + esc(c.meta.sub) + '</p></div></header>' + chipsHtml(roll ? c.meta.chips : []) + genLinesHtml(c.lines) +
      (roll ? '<div class="gm-card-acts"><button type="button" class="btn sm" data-gm="pin" data-tool="engagement">Pin</button><button type="button" class="btn sm" data-gm="copy" data-tool="engagement">Copy</button></div>' : '') + '</article>';
    box.innerHTML = h + earlierHtml('engagement', cur);
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
          '<div class="gm-npcacts"><button type="button" class="btn sm" data-gm="npcipad" data-id="' + esc(x.id) + '">Show on iPad</button><a class="btn sm" href="#cast/' + encodeURIComponent(x.id) + '" title="The cast page: put them on stage from there">Put on stage</a></div></li>';
      }).join('') + '</ul>' : '<p class="gm-empty">' + (S.api && S.api.db && S.api.db() ? 'No NPCs in the cast yet. Add them on the cast page.' : 'The cast is not available here.') + '</p>') +
      '<p><a class="hm-link" href="#cast">The cast page</a></p>';
    renderNpcGen();
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
  /* ---------- the NPC generator: a roll is a seed and the repeat-guard memory, so it replays after a reload ---------- */
  function npcgInst() {
    if (S.npcg) return S.npcg;
    var M = W.B68GmNpc, pk = part('npc');
    if (!M) { S.npcgErr = 'The NPC generator module is missing.'; return null; }
    if (!pk || !isObj(pk.T)) { S.npcgErr = 'The pack has no npc part. Update the pack.'; return null; }
    try { S.npcg = M.create({ T: pk.T, cast: pk.cast || [], F: pk.F || null, campaign: part('campaign') || {}, mem: clone(S.npcMem) }); S.npcgErr = ''; } catch (e) { S.npcgErr = 'The NPC generator could not start: ' + errText(e); }
    return S.npcg;
  }
  /* the figure for a roll: drawn once per roll and kept, since the kit's render checks are the slow part */
  function npcWithFigure(g, roll) {
    var K = W.B68Figure, fig = null, svg = '';
    try { fig = g.figure(roll.npc, { K: K }); } catch (e) { fig = null; }
    if (fig && fig.spec && K && K.portrait) { try { var sp = clone(fig.spec); sp.id = 'gm-npcg'; svg = stripSize(K.portrait(sp, { lod: 'lo' }).svg); } catch (e) { svg = ''; } }
    return { roll: roll, fig: fig, svg: svg };
  }
  function replayNpc(e) {
    var g = npcgInst(); if (!g || !isObj(e)) return null;
    var mem = {}; try { mem = JSON.parse(e.mem || '{}'); } catch (x) {}
    try { return npcWithFigure(g, g.roll({ seed: e.seed, mem: mem })); } catch (x) { return null; }
  }
  function rollNpc() {
    var g = npcgInst(); if (!g) { renderNpcGen(); return; }
    var roll;
    try { roll = g.roll({ mem: S.npcMem }); } catch (e) { toast('The NPC roll failed: ' + errText(e), true); return; }
    var entry = { seed: roll.seed, mem: JSON.stringify(roll.replay.mem), label: str(roll.card.meta.label), at: nowIso() };
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
    var r = S.npcRoll, h = '<div class="gm-loc-ctl"><button type="button" class="btn primary gm-roll" data-gm="npcroll">Roll an NPC</button></div>';
    if (r) {
      var c = r.roll.card, m = c.meta, inCast = npcInCast(r.roll.npc.name);
      h += '<article class="gm-card gm-npccard" data-tool="npc"><header class="gm-card-h">' + (r.svg ? '<div class="gm-thumb gm-npcfig" aria-hidden="true">' + r.svg + '</div>' : '') + '<div><h3>' + esc(m.title) + '</h3><p class="gm-sub">' + esc(m.sub) + '</p></div></header>' +
        (m.figureNote ? '<p class="gm-note">' + esc(m.figureNote) + '</p>' : '') + (r.fig && r.fig.fallback ? '<p class="gm-note">The portrait is the nearest of the stock figures (the generated one would not draw).</p>' : '') +
        npcGenLinesHtml(c.lines) +
        '<div class="gm-card-acts"><button type="button" class="btn sm primary" data-gm="npcfile"' + (inCast ? ' disabled' : '') + ' title="Adds them to the cast, hidden from the players">' + (inCast ? 'In the cast' : 'Add to the cast') + '</button>' +
        '<button type="button" class="btn sm" data-gm="pin" data-tool="npc">Pin</button><button type="button" class="btn sm" data-gm="copy" data-tool="npc">Copy</button></div></article>';
    } else h += '<p class="gm-empty">Roll for a face on the street: who they are, what they want, how to play them. They stay in this tab until you add them to the cast.</p>';
    box.innerHTML = h + earlierHtml('npc', cur);
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

  /* ---------- the Rules tab ---------- */
  var RULE_TERMS = ['position and effect', 'resistance', 'devil’s bargain', 'harm', 'heat', 'engagement roll', 'flashback', 'stress', 'trauma', 'clocks', 'teamwork', 'gather information'];
  function renderRules() {
    var box = $q('#gm-rules'); if (!box) return;
    var R = W.B68Rules, on = !!(R && R.available && R.available());
    box.innerHTML = on ? '<form class="gm-rulesq" data-gm-form="rules"><label class="gm-field wide" for="gm-rq"><span class="gm-lab">Search the rules (opens a new tab)</span>' + '<input type="search" id="gm-rq" autocomplete="off" placeholder="push yourself, gambits…"></label><button type="submit" class="btn primary">Search</button></form>' +
      '<p class="gm-chips">' + RULE_TERMS.map(function (t) { return '<a class="chip sm" target="_blank" rel="noopener" href="#rules?q=' + encodeURIComponent(t) + '">' + esc(t) + '</a>'; }).join('') + '</p>' : '<p class="gm-note">The rules are not available here.</p>';
  }

  /* ---------- the rail ---------- */
  function renderRail() {
    var box = $q('#gm-rail'); if (!box) return;
    var d = isObj(camp) ? camp : {}, crew = isObj(d.crew) ? d.crew : {}, h = '';
    function stat(k, v, max) { return '<div class="gm-stat"><dt>' + k + '</dt><dd>' + (v == null ? '—' : esc(v) + (max ? '<small>/' + max + '</small>' : '')) + '</dd></div>'; }
    h += '<section class="gm-box"><h3 class="gm-band">Crew' + (crew.name ? ': ' + esc(crew.name) : '') + '</h3><dl class="gm-stats">' + stat('Heat', +crew.heat || 0, 9) + stat('Wanted', +crew.wanted || 0, 4) + stat('Rep', +crew.rep || 0, 12) + stat('Stacks', +crew.stacks || 0) + stat('Vault', +crew.vault || 0, 16) + '</dl>' +
      '<p class="gm-dim">Session ' + esc(isObj(d.session) ? +d.session.number || 0 : 0) + ' · read-only here; change it on <a href="#t">the table</a>.</p></section>';
    var tc = Array.isArray(d.clocks) ? d.clocks : [];
    h += '<section class="gm-box"><h3 class="gm-band">Table clocks</h3>' + (tc.length ? '<ul class="gm-clocks">' + tc.map(function (c) { return clockLi(c.name, c.filled, c.size, c.hidden ? 'hidden from players' : c.kind); }).join('') + '</ul>' : '<p class="gm-dim">None on the table.</p>') + '</section>';
    var wc = (part('campaign') || {}).clocks; wc = Array.isArray(wc) ? wc : [];
    h += '<section class="gm-box"><h3 class="gm-band">World clocks <small>(pack)</small></h3>' + (wc.length ? '<ul class="gm-clocks">' + wc.map(function (c) { return clockLi(c.goal || c.name, c.filled, c.segments || c.size, [c.faction, c.tier != null && c.tier !== '' ? 'Tier ' + c.tier : ''].filter(Boolean).join(' · ')); }).join('') + '</ul>' : '<p class="gm-dim">None in the pack.</p>') + '</section>';
    var owed = []; try { owed = W.B68GmConsole ? W.B68GmConsole.campaignWith(part('campaign') || {}, S.doc.con || {}).owed : []; } catch (e) { owed = []; }
    h += '<section class="gm-box"><h3 class="gm-band">Bargains owed</h3>' + (owed.length ? '<ul class="gm-owed">' + owed.map(function (o, i) { return '<li><span>' + esc(o.text) + (o.src ? ' <small>' + esc(o.src) + '</small>' : '') + '</span><button type="button" class="btn sm" data-gm="collect" data-i="' + i + '">Collect</button></li>'; }).join('') + '</ul>' : '<p class="gm-dim">Nothing owed.</p>') + '</section>';
    S.owed = owed;
    var pins = newest(S.doc.pins);
    h += '<section class="gm-box"><h3 class="gm-band">Pins <small>' + pins.length + '/' + LIMITS.pins + '</small></h3>' + (pins.length ? '<ul class="gm-pins">' + pins.map(function (p) {
      var open = S.pinOpen === p._id;
      return '<li><div class="gm-pinrow"><button type="button" class="chip txt sm" data-gm="pinopen" data-id="' + esc(p._id) + '" aria-expanded="' + open + '">' + esc(p.label || p.title || 'Pinned') + '</button><button type="button" class="gm-x" data-gm="unpin" data-id="' + esc(p._id) + '" aria-label="Unpin">×</button></div>' + (open ? '<pre class="gm-pintext">' + esc(p.text || '') + '</pre>' : '') + '</li>';
    }).join('') + '</ul>' : '<p class="gm-dim">Pin a card to keep it here.</p>') + '</section>';
    var sc = isObj(d.scene) && isObj(d.scene.npcs) ? d.scene.npcs : {}, staged = Object.keys(sc).filter(function (id) { return sc[id] === true; });
    h += '<section class="gm-box"><h3 class="gm-band">On stage</h3><p class="gm-chips">' + (staged.length ? staged.map(function (id) { var n = S.npcs[id]; return '<a class="chip sm" href="#cast/' + encodeURIComponent(id) + '">' + esc(n && n.name || id) + '</a>'; }).join('') : '<a class="chip sm" href="#cast">Nobody: the cast</a>') + '</p></section>';
    box.innerHTML = h;
  }
  function clockLi(name, filled, size, sub) {
    var n = Math.max(1, Math.min(12, Math.floor(+size || 4))), f = Math.max(0, Math.min(n, Math.floor(+filled || 0))), seg = '';
    for (var i = 0; i < n; i++) seg += '<i' + (i < f ? ' class="on"' : '') + '></i>';
    return '<li><span class="gm-clockname">' + esc(name || 'Clock') + (sub ? ' <small>' + esc(sub) + '</small>' : '') + '</span><span class="gm-clock" aria-label="' + f + ' of ' + n + '">' + seg + '</span><span class="gm-clockn">' + f + '/' + n + '</span></li>';
  }

  /* ---------- capture ---------- */
  function renderCapture() {
    var box = $q('#gm-foot'); if (!box) return;
    var keep = W.document.activeElement && W.document.activeElement.id === 'gm-cap-in' ? $q('#gm-cap-in').value : null;
    var all = newest(S.doc.capture);
    box.innerHTML = '<div class="gm-cap"><div class="seg gm-capb" role="group" aria-label="File as">' + BUCKETS.map(function (b) { return '<button type="button" class="chip sm" data-gm="arm" data-b="' + b.k + '" aria-pressed="' + (S.arm === b.k) + '">' + esc(b.label) + ' <kbd>' + b.key + '</kbd></button>'; }).join('') + '</div>' +
      '<form class="gm-capf" data-gm-form="capture"><label class="sr" for="gm-cap-in">Capture</label><input type="text" id="gm-cap-in" maxlength="' + LIMITS.captureText + '" autocomplete="off" placeholder="' + esc(placeholder(S.arm)) + '"><button type="submit" class="btn primary">File</button></form>' +
      '<div class="gm-capacts"><span class="gm-dim">' + all.length + ' filed</span><button type="button" class="btn sm" data-gm="last" title="L">File last roll</button>' + '<button type="button" class="btn sm" data-gm="note">Export tonight’s note</button><button type="button" class="btn sm" data-gm="clearcap"' + (all.length ? '' : ' disabled') + '>Clear</button></div></div>' +
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
    if (!patch({ capture: addCapped(S.doc.capture, id, entry, LIMITS.capture) })) return false;
    renderCapture();
    if (!quiet) { var b = BUCKETS.filter(function (x) { return x.k === bucket; })[0]; toast('Filed under ' + (b ? b.head : bucket) + '.'); }
    return true;
  }
  function fileLast() { if (!S.last) { toast('Nothing rolled yet.', true); return; } addCapture('r', S.last.text); }
  function clearCapture() {
    var all = newest(S.doc.capture); if (!all.length) return;
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
    if (tool === 'scenes' || tool === 'engagement') { var g = tool === 'scenes' ? S.scnRoll : S.engRoll; return g ? { label: str(g.meta.label), title: str(g.meta.title), text: g.meta.all.join('\n') } : null; }
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
  function isPhone() { try { return W.matchMedia && W.matchMedia('(max-width: 599px)').matches; } catch (e) { return false; } }

  /* ---------- events ---------- */
  function typing(t) { if (!t || t === document.body) return false; var n = (t.tagName || '').toLowerCase(); return n === 'input' || n === 'textarea' || n === 'select' || !!t.isContentEditable; }
  function onKey(ev) {
    if (blankEl) { ev.preventDefault(); ev.stopPropagation(); unblank(); return; }
    if (!S || S.status !== 'ready' || document.body.dataset.mode !== 'gm') return;
    var dlg = document.querySelector('dialog[open]'); if (dlg) return;
    var a = keyAction({ key: ev.key, ctrlKey: ev.ctrlKey, altKey: ev.altKey, metaKey: ev.metaKey, typing: typing(ev.target), view: S.view });
    if (!a) return;
    if (a.type === 'esc') { var t = ev.target; if (t && t.blur && typing(t)) { t.blur(); ev.preventDefault(); } return; }
    if (a.type === 'reserved') return;
    ev.preventDefault();
    if (a.type === 'button') rollConsole(a.n);
    else if (a.type === 'situation') rollSituation(a.n);
    else if (a.type === 'panel') { setPanel(a.panel); if (isPhone()) { S.seg = 'side'; syncPanels(); } }
    else if (a.type === 'capture') arm(a.bucket, true);
    else if (a.type === 'last') fileLast();
    else if (a.type === 'blank') blank();
    else if (a.type === 'clear') blankIpad();
  }
  function onClick(ev) {
    var b = ev.target.closest && ev.target.closest('[data-gm]'); if (!b || !S || !S.root.contains(b)) return;
    var a = b.getAttribute('data-gm');
    switch (a) {
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
      case 'view': setView(b.getAttribute('data-v')); break;
      case 'intent': doIntent(+b.getAttribute('data-i')); break;
      case 'replay': {
        var tool = b.getAttribute('data-tool'), e = newest(isObj(S.doc.hist) ? S.doc.hist[tool] : null).filter(function (x) { return x._id === b.getAttribute('data-h'); })[0]; if (!e) break;
        var cur = {}; Object.keys(e).forEach(function (k) { if (k !== '_id') cur[k] = e[k]; }); cur.hid = e._id;
        cur.at = nowIso();      /* the current card now: after a reload the newest of the two still shows */
        var cp = { cards: {} }; cp.cards[tool] = cur; patch(cp, { force: true });
        if (tool === 'console' || tool === 'situation') { S.conRes = null; drawConsoleCard(); }
        else if (tool === 'scenes') { S.scnRoll = null; renderScenes(); }
        else if (tool === 'npc') { S.npcRoll = null; renderNpcGen(); }
        else if (tool === 'engagement') { S.engRoll = null; patch({ eng: { ui: clone(e.ui || {}) } }); renderEngagement(); }
        else { S.locRoll = null; S.map = null; renderLocation(); }
        break;
      }
      case 'pin': pin(b.getAttribute('data-tool')); break;
      case 'copy': copy(b.getAttribute('data-tool')); break;
      case 'locroll': rollLocation(); break;
      case 'scnroll': rollScenes(); break;
      case 'npcroll': rollNpc(); break;
      case 'npcfile': fileNpc(); break;
      case 'scnipad': scenesToIpad(); break;
      case 'engroll': rollEngagement(); break;
      case 'layer': setMap('layer', b.getAttribute('data-v')); renderLocation(); break;
      case 'draw': drawMap(); break;
      case 'ipad': showOnIpad(); break;
      case 'pushtext': pushText(); break;
      case 'blankipad': blankIpad(); break;
      case 'darkipad': darkIpad(); break;
      case 'scorescene': setScoreScene(); break;
      case 'ambretry': loadAmbient(); break;
      case 'ambmode': { var am = b.getAttribute('data-v'); if (am === 'pin') patchAmbient({ mode: 'pin', scene: AM.doc && ipadView(AM.doc).scene || 'harvest' }); else patchAmbient({ mode: am }); break; }
      case 'ambscene': patchAmbient({ mode: 'pin', scene: b.getAttribute('data-id') }); break;
      case 'ambskip': patchAmbient({ skip: true }); break;
      case 'clearscore': patchAmbient({ score: null }); break;
      case 'dlsvg': if (!S.map) toast('Draw the map first.', true); else if (S.map.layer === 'player' && S.map.leak) toast(P.LEAK_MSG, true); else save(slug(S.locRoll && S.locRoll.name) + '-' + S.map.view + '-' + S.map.theme + '-' + S.map.layer + '.svg', S.map.svg); break;
      case 'dlnote': if (S.locRoll && W.B68GmLocation) save(slug(S.locRoll.name) + '.md', W.B68GmLocation.noteBody(S.locRoll, { date: dmy(new Date()) })); break;
      case 'dlcanvas': if (S.locRoll && W.B68GmLocation) save(slug(S.locRoll.name) + '.canvas', W.B68GmLocation.canvas(S.locRoll, part('location'))); break;
      case 'npcipad': npcToIpad(b.getAttribute('data-id')); break;
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
    if (t.hasAttribute('data-ctl')) { if (ev.type === 'change' || t.tagName === 'SELECT') setLive(t.getAttribute('data-ctl'), t.value); return; }
    if (ev.type !== 'change') return;
    if (t.hasAttribute('data-ambint')) { patchAmbient({ intervalMin: Math.round(+t.value) }); return; }
    if (t.hasAttribute('data-loc')) { var l = {}; l[t.getAttribute('data-loc')] = t.type === 'checkbox' ? t.checked : t.value; patch({ loc: { ui: l } }); }
    else if (t.hasAttribute('data-map')) setMap(t.getAttribute('data-map'), t.value);
    else if (t.hasAttribute('data-scn')) { var sc = {}; sc[t.getAttribute('data-scn')] = t.value; patch({ scn: { ui: sc } }); }
    else if (t.hasAttribute('data-eng')) setEngagement(t.getAttribute('data-eng'), t.value, false);
    else if (t.hasAttribute('data-engmod')) setEngagement(t.getAttribute('data-engmod'), t.value, true);
    else if (t.hasAttribute('data-reveal')) { var rv = {}; rv[t.getAttribute('data-reveal')] = t.checked; patch({ loc: { map: { reveal: rv } } }); if (S.map) drawMap(); renderLocation(); }
  }
  function onSubmit(ev) {
    var f = ev.target; if (!S || !f || !f.getAttribute) return;
    var k = f.getAttribute('data-gm-form'); if (!k) return;
    ev.preventDefault();
    if (k === 'capture') { var i = $q('#gm-cap-in'); if (i && addCapture(S.arm, i.value)) { i = $q('#gm-cap-in'); if (i) { i.value = ''; i.focus(); } } }
    else if (k === 'rules') { var q = $q('#gm-rq'); if (q && q.value.trim()) { try { W.open('#rules?q=' + encodeURIComponent(q.value.trim()), '_blank', 'noopener'); } catch (e) {} } }
  }
  function wire(el) {
    if (!el.__gm) { el.__gm = true; el.addEventListener('click', onClick); el.addEventListener('change', onChange); el.addEventListener('input', function (ev) { if (ev.target && ev.target.type === 'text' && ev.target.hasAttribute('data-ctl')) { clearTimeout(wire.t); var t = ev.target; wire.t = setTimeout(function () { if (S) { var l = {}; l[t.getAttribute('data-ctl')] = t.value; patch({ con: { live: l } }); } }, 500); } }); el.addEventListener('submit', onSubmit); el.addEventListener('toggle', onToggle, true); }
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
    camp = isObj(doc) ? doc : null;
    if (S && S.status === 'ready') renderRail();
    var api = (S && S.api) || keptApi;
    if (api && api.isGM && api.isGM() === true && keptApi) crewSync.note(camp);
  }

  return {
    open: open, close: close, campaign: campaign, purge: purge,
    available: function () { return !!(W.claude && W.claude.gm); },
    _pure: P,
    /* for checks (gm.e2e.mjs): the current roll, and the display gate */
    _state: function () { return S ? { status: S.status, locRoll: S.locRoll, map: S.map && { layer: S.map.layer }, panel: S.panel, seg: S.seg, view: S.view } : null; },
    _pushDisplay: function (d) { return pushDisplay(d); },
    _ambient: function () { return { doc: AM.doc, shown: AM.shown, loaded: AM.loaded, crew: crewSync.state().lastSent }; }
  };
});
