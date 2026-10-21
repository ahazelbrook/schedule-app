/* B68GmLocation — the Blades '68 score location generator, ported from the vault.
 *
 * Pure logic. No DOM, no Obsidian/Dataview, no storage, no network. It reads its
 * tables from arguments; the tables themselves (the GM pack's `location` part) are
 * private and never live in this file.
 *
 * Source: the vault page Tools/blades-68-location-generator.md (generate() and its
 * helpers, rendering and note builder). The seeded rng is the vault's mulberry32 and
 * the rng calls are made in the vault's order, so the same { seed, mem, opts } over
 * the same tables replays the same roll.
 *
 * Load: <script src="gm/location.js"> exposes window.B68GmLocation; in Node,
 * require() returns the same object.
 *
 * ---------------------------------------------------------------------------
 * API
 *
 * pack     the GM pack's `location` part: { T, extra }
 *            T      the generator's tables (theme, targetType, district, gaz, faction, ...)
 *            extra  { BAND_RANGE, ROMAN, SERVICE_RE: {"$re": source, "flags": "i"},
 *                     CANVAS_BAND, RING_R, NODE_W, NODE_H, VECTOR_R, RING_WIDEN }
 *
 * generate(pack, opts, run) -> roll
 *   opts   the generator's own controls (all optional; "" or null means "any"):
 *            target    a key of T.targetType      (hard seed: what kind of building)
 *            district  a name from T.district     (hard seed: where)
 *            approach  a name from T.approach     (soft seed: score type, moves the target)
 *            faction   a name from T.faction      (soft seed: who owns it, weights the district)
 *            mix       boolean: mix a second theme (p.418)
 *   run    { seed, mem } or { rng, mem }
 *            seed  uint32. Omitted: a random one is drawn. It is recorded on the roll
 *                  as roll.seed (the map kit also uses it as the layout seed).
 *            mem   the recency memory object ({ key: [recent values] }). MUTATED IN
 *                  PLACE, exactly like the vault's window.__b68locMem, so the caller
 *                  keeps it between rolls. To replay a roll, store { seed, opts } and a
 *                  deep copy of mem taken BEFORE the roll, then call generate again.
 *            rng   alternative to seed: a () => [0,1) function (e.g. B68GmRng.seed(n)).
 *                  roll.seed is then null unless run.seed is also given.
 *   The roll is exactly the object the vault's generate() returns (the map kit reads
 *   it unchanged), plus one extra field, `seed`. It is a schema 2 roll (roll.schema = 2):
 *   the service side carries `room`, the back route `room`, `level` and `means` (the map
 *   kit's INTEGRATION.md §3). The front carries none.
 *
 * controls(pack) -> { controls: [ { key, label, kind: "select"|"toggle", options? } ],
 *                     defaults: { target:"", district:"", approach:"", faction:"", mix:false } }
 *   Option lists in the vault's order. A select's options are { value, label }, with
 *   { value: "", label: "any" } first.
 * defaults() -> the default opts.
 *
 * cardSections(roll, pack?) -> [ { id, title, gm, lines: [markdown] } ]
 *   The card, in the vault's reading order. `gm: true` sections are GM-only secrets
 *   (everything except the heading, the street description and the facade) so the UI
 *   can hide them. Pass `pack` to add the faction dossier, which needs the tables.
 * cardLines(roll, pack?) -> [markdown line]   the sections flattened, "## title" headings
 *   between them. GM-only headings read "## [GM] title" so a plain-text reader can tell.
 *
 * glance(roll, pack?, reveal = ["public"]) -> { title, place, say, plan, whose, security,
 *     bands: [{ band, short, count, locks, target, shown }], target: { room, band, what, locks },
 *     rule, skips, flags }
 *   The console's at-a-glance card. GM-only as a whole; `say` alone is player-safe (it is
 *   the start of playerSummary's outside description). `plan` is one plain sentence for
 *   under Say, built only from what the glance and the player summary already show: the
 *   front (street and its obstacle), the target's room and band, and target.locks, the
 *   locks in the bands down to the target's. `rule` is the district rule's first sentence
 *   (at most 110 characters; "" when the district has none). `skips` counts the ring-skips:
 *   they sit in the Plan fold's hint, not in the flags. `flags` are only what is not true of
 *   every roll: off their turf, a low tier holding a prize, a target outside its printed
 *   district, a Paranormal approach where the rating is low. glanceLines() is the same as
 *   markdown (what Pin stores), with a Plan line and, when there is one, a Rule line.
 * folds(roll, pack?, reveal = ["public"]) -> [ { id, title, hint, gm: true, lines } ]
 *   Everything else, one fold each: read aloud, ways in, one per band, opposition, block,
 *   plan, reference. Wording is shortened here, never in generate().
 *
 * playerSummary(roll, reveal = ["public"]) -> { title, place, facade, outside, front,
 *                                                rooms: [{ name, band, detail }], lines, text }
 *   ONLY what the crew could see from the street plus the rooms in the revealed bands:
 *   the name, district, street, time and weather, the outside description, the facade
 *   (style and colours), the front way in, and the name and printed description of each
 *   room in a revealed band. Never: other rooms, threats, the target, obstacles, loot,
 *   faction, rumour, the service side or back route, setup/answer pairings, skips, ratings.
 *
 * describe(roll) -> { outside, inside }       the two read-aloud paragraphs
 * noteBody(roll, { date?, frontmatter? }) -> markdown for a session log / saved note
 *   (the vault's "Save this one" builder). `date` is "DD/MM/YYYY" (default: today).
 *   frontmatter: false drops the YAML block and the "Rolled from" footer.
 * canvas(roll, pack) -> JSON string of an Obsidian .canvas (the vault's "Save the plan"),
 *   with ids derived from roll.seed so the same roll gives the same file.
 * check(T) -> [string]   the table keys a pack is missing or has empty ('rumour', 'theme.<name>.areas',
 *   'gaz.<district>', 'weather.Night', …), for the page to show when a pack is loaded. Empty = the pack is
 *   complete. Pass pack.T (a whole part { T, extra } is accepted too). Optional: a target type's alt / mix /
 *   district / landmark / note / forceRoom (reported only when one points at nothing: a theme the pack lacks, a
 *   district not in its list, an area past the theme's), a theme's bandNote, a district's special, a style's
 *   geometry (a default applies), factionThumb. factionDetail is reported only when the pack has none at all (the
 *   rumour then names a faction without a dossier line).
 * seedRng(seed) -> () => [0,1)               the vault's mulberry32
 * ------------------------------------------------------------------------- */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.B68GmLocation = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // --- Seeded rng: the vault's __seed (mulberry32) ---------------------------
  function seedRng(a) {
    a = a | 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var cap = function (t) { return t.charAt(0).toUpperCase() + t.slice(1); };

  // extra.SERVICE_RE is stored as { "$re": source, "flags": "i" }.
  function reviveRe(v) {
    if (v instanceof RegExp) return v;
    if (v && typeof v === "object" && typeof v.$re === "string") {
      var fl = String(v.flags || "").replace(/[gy]/g, "");
      return new RegExp(v.$re, fl);
    }
    return /dock|closet|elevator|stair|fire escape|garage|roof|basement|maintenance|waste|cellar|kitchen|service|coolant|hydraulic/i;
  }

  var DEFAULT_EXTRA = {
    BAND_RANGE: { public: [2, 3], working: [3, 4], controlled: [2, 3], secure: [1, 2] },
    ROMAN: ["0", "I", "II", "III", "IV", "V", "VI"],
    CANVAS_BAND: { public: "4", working: "3", controlled: "2", secure: "1" },
    RING_R: { public: 1180, working: 840, controlled: 520, secure: 220 },
    NODE_W: 280, NODE_H: 140, VECTOR_R: 1560, RING_WIDEN: 1.45,
    // The vault's T.circulationWay, for a pack exported before it existed: where each back-route
    // entry comes in ([level, means], map kit schema 2). [interpretation], the kit's own reading of
    // the same words. A pack whose T carries circulationWay uses that instead.
    CIRCULATION_WAY: {
      "circular stairs and ladders": ["upper", "spiral-stair"],
      "a secret door": ["street", "secret-door"],
      "catwalks": ["upper", "catwalk"],
      "skylights": ["roof", "skylight"],
      "a balcony": ["upper", "balcony"],
      "a cellar": ["below", "cellar"]
    },
    // The vault's T.serviceWay: the four printed "also" rooms whose names are themselves a way in
    // ([level, means]). The service side through one of them names no room; it says the floor and
    // the means, as the kit has always read those words. [interpretation], like CIRCULATION_WAY.
    SERVICE_WAY: {
      "Rooftop": ["roof", "roof-hatch"],
      "Roof terrace": ["roof", "roof-hatch"],
      "Basement": ["below", "cellar"],
      "Fire escape": ["upper", "fire-escape"]
    }
  };

  function extraOf(pack) {
    var e = (pack && pack.extra) || {};
    var out = {};
    for (var k in DEFAULT_EXTRA) out[k] = e[k] != null ? e[k] : DEFAULT_EXTRA[k];
    out.SERVICE_RE = reviveRe(e.SERVICE_RE);
    return out;
  }

  function clean(v) { return v === "" || v === undefined ? null : v; }

  function defaults() { return { target: "", district: "", approach: "", faction: "", mix: false }; }

  // --- check(): the keys generate() and the renderers read, reported when missing or empty ----------
  function check(T) {
    var isObj = function (v) { return v !== null && typeof v === "object" && !Array.isArray(v); };
    if (isObj(T) && isObj(T.T) && !("theme" in T)) T = T.T;          // a whole part { T, extra }
    if (!isObj(T)) return ["T"];
    var miss = [], need = function (k, ok) { if (!ok) miss.push(k); };
    var filled = function (x) { return x != null && x !== ""; };
    var list = function (a, ok, n) { return Array.isArray(a) && a.length >= (n || 1) && a.every(ok || filled); };
    var row = function (n) { return function (x) { return Array.isArray(x) && x.length >= n && x.slice(0, n).every(filled); }; };
    var arr = function (a) { return Array.isArray(a) ? a : []; };
    ["targetNames", "themeNames", "bandOrder", "furnishing", "itemRare", "itemCommon", "circulation", "streetType",
      "streetObstacle", "blockUse", "props", "buildingRare", "buildingCommon", "colour", "style", "condition", "volume",
      "detail", "streetDesc", "streetSound", "streetSmell", "rumour"].forEach(function (k) { need(k, list(T[k])); });
    need("physThreat", list(T.physThreat, row(2)));
    need("socThreat", list(T.socThreat, row(2)));
    need("faction", list(T.faction, row(3)));
    need("district", list(T.district, row(5)));
    need("approach", list(T.approach, function (a) {
      return isObj(a) && ["n", "gambit", "seat", "target", "why"].every(function (k) { return filled(a[k]); });
    }));
    need("weather", isObj(T.weather));
    ["Bluetime", "Night"].forEach(function (t) { need("weather." + t, isObj(T.weather) && list(T.weather[t])); });
    need("geometry", isObj(T.geometry));
    var bands = arr(T.bandOrder);
    need("bandLabel", isObj(T.bandLabel));
    bands.forEach(function (b) { need("bandLabel." + b, isObj(T.bandLabel) && filled(T.bandLabel[b])); });
    // the themes: every one the theme list, a target type (its theme, alt, mix) or the Paranormal approach names
    var themes = [];
    var addTheme = function (n) { if (filled(n) && themes.indexOf(n) < 0) themes.push(n); };
    arr(T.themeNames).forEach(addTheme);
    need("targetType", isObj(T.targetType));
    var districts = arr(T.district).map(function (d) { return Array.isArray(d) ? d[0] : null; });
    // every row the table holds, seed-only ones (Market, Autodrome) too
    arr(T.targetNames).concat(isObj(T.targetType) ? Object.keys(T.targetType).filter(function (k) { return arr(T.targetNames).indexOf(k) < 0; }) : []).forEach(function (n) {
      var tt = isObj(T.targetType) ? T.targetType[n] : null, at = "targetType." + n;
      if (!isObj(tt) || !filled(tt.theme)) { miss.push(at); return; }
      [tt.theme, tt.alt, tt.mix].forEach(addTheme);
      if (filled(tt.district) && districts.indexOf(tt.district) < 0) miss.push(at + ".district");
      var src = isObj(T.theme) ? T.theme[tt.theme] : null;
      if (tt.forceRoom !== undefined && !(isObj(src) && Array.isArray(src.areas) && filled(src.areas[tt.forceRoom]))) miss.push(at + ".forceRoom");
    });
    if (arr(T.approach).some(function (a) { return isObj(a) && a.n === "Paranormal"; })) addTheme("Anomalous Zone");
    need("theme", isObj(T.theme));
    themes.forEach(function (n) {
      var th = isObj(T.theme) ? T.theme[n] : null, at = "theme." + n;
      if (!isObj(th)) { miss.push(at); return; }
      need(at + ".areas", list(th.areas));
      need(at + ".bands", Array.isArray(th.bands) && th.bands.length === arr(th.areas).length &&
        th.bands.every(function (b) { return bands.indexOf(b) >= 0; }));
      need(at + ".alsoRooms", Array.isArray(th.alsoRooms) &&
        th.alsoRooms.every(function (x) { return Array.isArray(x) && filled(x[0]) && bands.indexOf(x[1]) >= 0; }));
      need(at + ".obstacles", list(th.obstacles));
      need(at + ".items", list(th.items));
      need(at + ".impressions", list(th.impressions, null, 2));
      need(at + ".also", filled(th.also));
      need(at + ".p", filled(th.p));
    });
    // the gazetteer: one entry per district, with the lists a roll picks from
    need("gaz", isObj(T.gaz));
    districts.forEach(function (d) {
      if (!filled(d)) return;
      var g = isObj(T.gaz) ? T.gaz[d] : null, at = "gaz." + d;
      if (!isObj(g)) { miss.push(at); return; }
      ["named", "landmarks", "notables"].forEach(function (k) { need(at + "." + k, list(g[k])); });
    });
    need("factionDetail", isObj(T.factionDetail) && Object.keys(T.factionDetail).length > 0);
    return miss;
  }

  // --- The generator ----------------------------------------------------------
  function generate(pack, opts, run) {
    if (!pack || !pack.T) throw new Error("B68GmLocation.generate: pack.T is required");
    var T = pack.T, X = extraOf(pack);
    opts = opts || {};
    var SEED = {
      target: clean(opts.target), district: clean(opts.district),
      faction: clean(opts.faction), approach: clean(opts.approach)
    };
    var mixOn = !!opts.mix;

    var rnd, seedUsed = null, MEM;
    if (typeof run === "function") { rnd = run; MEM = arguments[3] || {}; }
    else {
      run = run || {};
      MEM = run.mem || {};
      if (typeof run.rng === "function") { rnd = run.rng; seedUsed = run.seed != null ? run.seed >>> 0 : null; }
      else {
        seedUsed = run.seed != null ? (run.seed >>> 0) : ((Math.random() * 4294967296) >>> 0);
        rnd = seedRng(seedUsed);
      }
    }

    var pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
    var oneIn = function (n) { return Math.floor(rnd() * n) === 0; };

    // n distinct entries, without repeats.
    function pickN(a, n) {
      var c = a.slice(), out = [];
      n = Math.min(n, c.length);
      while (out.length < n) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]);
      return out;
    }

    // Recency memory (the vault's fresh / freshN, cap 20).
    function fresh(key, list, keyFn) {
      keyFn = keyFn || function (x) { return x; };
      var used = (MEM[key] = MEM[key] || []);
      var pool = list.filter(function (x) { return used.indexOf(keyFn(x)) < 0; });
      var from = pool.length ? pool : list;
      var choice = from[Math.floor(rnd() * from.length)];
      var winSize = Math.max(1, Math.min(20, Math.floor(list.length / 2)));
      used.push(keyFn(choice));
      if (used.length > winSize) used.shift();
      return choice;
    }
    function freshN(key, list, n, keyFn) {
      if (n <= 0 || !list.length) return [];
      var first = fresh(key, list, keyFn);
      var rest = pickN(list.filter(function (x) { return x !== first; }), n - 1);
      return [first].concat(rest);
    }

    var facKey = function (n) { return n.toLowerCase().replace(/^the /, ""); };
    var onTurf = function (dist, fac) {
      return ((T.gaz[dist] || {}).factions || "").toLowerCase().indexOf(facKey(fac)) >= 0;
    };
    var onTurfAnywhere = function (fac) { return T.district.some(function (d) { return onTurf(d[0], fac); }); };

    // A printed Area reads "Name. Description." — the name is the first sentence.
    function splitRoom(s) {
      var i = s.indexOf(". ");
      return i < 0
        ? { name: s.replace(/\.\s*$/, ""), detail: "" }
        : { name: s.slice(0, i), detail: s.slice(i + 2) };
    }

    function roomPool(themeName, mixLabel) {
      var t = T.theme[themeName], out = [];
      t.areas.forEach(function (a, i) {
        var r = splitRoom(a);
        out.push({ name: r.name, detail: r.detail, band: t.bands[i], printed: true, mix: mixLabel });
      });
      t.alsoRooms.forEach(function (nb) {
        out.push({ name: nb[0], detail: "", band: nb[1], printed: false, mix: mixLabel });
      });
      return out;
    }

    function chooseRooms(pool, want) {
      var byBand = {}, desired = {};
      T.bandOrder.forEach(function (b) { byBand[b] = pool.filter(function (r) { return r.band === b; }); });
      T.bandOrder.forEach(function (b) {
        var lo = X.BAND_RANGE[b][0], hi = X.BAND_RANGE[b][1];
        desired[b] = Math.min(lo + Math.floor(rnd() * (hi - lo + 1)), byBand[b].length);
      });
      var total = function () { return T.bandOrder.reduce(function (s, b) { return s + desired[b]; }, 0); };
      var g, moved, i, b;
      var up = ["controlled", "working", "public", "secure"];
      for (g = 0; g < 60 && total() < want; g++) {
        moved = false;
        for (i = 0; i < up.length; i++) {
          b = up[i];
          if (total() >= want) break;
          if (desired[b] < byBand[b].length) { desired[b]++; moved = true; }
        }
        if (!moved) break;
      }
      var down = ["public", "working", "controlled", "secure"];
      for (g = 0; g < 60 && total() > want; g++) {
        moved = false;
        for (i = 0; i < down.length; i++) {
          b = down[i];
          if (total() <= want) break;
          if (desired[b] > 1) { desired[b]--; moved = true; }
        }
        if (!moved) break;
      }
      var out = [];
      T.bandOrder.forEach(function (bb) { out.push.apply(out, pickN(byBand[bb], desired[bb])); });
      return out;
    }

    var o = {};

    // --- Seed 1 (hard): what kind of building ----------------------------------
    o.target = (SEED.target && T.targetType[SEED.target]) ? SEED.target : fresh("target", T.targetNames);
    var tt = T.targetType[o.target];
    o.targetNote = tt.note || "";

    // --- Seed 4 (soft): the Approach --------------------------------------------
    o.approach = SEED.approach
      ? (T.approach.find(function (a) { return a.n === SEED.approach; }) || fresh("approach", T.approach, function (a) { return a.n; }))
      : fresh("approach", T.approach, function (a) { return a.n; });
    o.approachName = o.approach.n;

    // --- Seed 3 (soft): who owns it ---------------------------------------------
    var f = SEED.faction
      ? (T.faction.find(function (x) { return x[0] === SEED.faction; }) || fresh("faction", T.faction, function (x) { return x[0]; }))
      : fresh("faction", T.faction, function (x) { return x[0]; });
    o.faction = f[0]; o.factionTier = f[1]; o.factionHold = f[2] === "S" ? "strong" : "weak";

    // --- Seed 2 (hard): where ----------------------------------------------------
    var dName;
    o.districtClash = false;
    if (SEED.district) {
      dName = SEED.district;
      if (tt.district && tt.district !== SEED.district) o.districtClash = true;
    } else if (tt.district) dName = tt.district;
    else {
      var turf = T.district.filter(function (dd) { return onTurf(dd[0], o.faction); });
      dName = (SEED.faction && turf.length && !oneIn(4))
        ? pick(turf)[0]
        : fresh("district", T.district, function (x) { return x[0]; })[0];
    }
    var d = T.district.find(function (x) { return x[0] === dName; }) || pick(T.district);
    o.district = d[0];
    o.wealth = d[1]; o.security = d[2]; o.criminal = d[3]; o.paranormal = d[4];
    var g = T.gaz[o.district];
    o.gaz = g;

    // --- Theme, and the mix -------------------------------------------------------
    o.themeName = tt.alt && (o.wealth === "Very high" || o.wealth === "High") ? tt.alt : tt.theme;

    var mixName = tt.mix || null;
    if (!mixName && o.approachName === "Paranormal") mixName = "Anomalous Zone";
    if (!mixName && mixOn) mixName = pick(T.themeNames.filter(function (n) { return n !== o.themeName; }));
    o.mixName = mixName && mixName !== o.themeName ? mixName : null;

    var th = T.theme[o.themeName];
    o.themePage = th.p;
    o.also = th.also;
    o.bandNote = th.bandNote || "";

    // --- The rooms ---------------------------------------------------------------
    var pool = roomPool(o.themeName, null);
    if (o.mixName) pool = pool.concat(roomPool(o.mixName, o.mixName));

    var want = 8 + Math.floor(rnd() * 3);
    if (o.mixName) want += 2;
    want = Math.min(want, pool.length);
    o.rooms = chooseRooms(pool, want);

    if (tt.forceRoom !== undefined) {
      var src = T.theme[tt.theme];
      var fr = splitRoom(src.areas[tt.forceRoom]);
      if (!o.rooms.some(function (x) { return x.name === fr.name; })) {
        o.rooms.push({ name: fr.name, detail: fr.detail, band: src.bands[tt.forceRoom],
          printed: true, mix: null, forced: true });
        while (o.rooms.length > want) {
          var counts = {};
          o.rooms.forEach(function (x) { counts[x.band] = (counts[x.band] || 0) + 1; });
          var fattest = T.bandOrder.slice()
            .sort(function (a, b) { return (counts[b] || 0) - (counts[a] || 0); })[0];
          var victim = o.rooms.findIndex(function (x) { return !x.forced && x.band === fattest; });
          if (victim < 0) break;
          o.rooms.splice(victim, 1);
        }
      }
    }

    o.rooms.sort(function (a, b) { return T.bandOrder.indexOf(a.band) - T.bandOrder.indexOf(b.band); });

    // "Also" rooms print no description, so they take a furnishing triplet.
    var bare = o.rooms.filter(function (r) { return !r.detail; });
    var dress = freshN("furnish", T.furnishing, bare.length);
    bare.forEach(function (r, i) { r.detail = cap(dress[i] || pick(T.furnishing)) + "."; });

    // --- Obstacles, in the deep bands -----------------------------------------------
    var deep = o.rooms.filter(function (r) { return r.band === "controlled" || r.band === "secure"; });
    var nObs = Math.max(1, Math.min(deep.length, 2 + Math.floor(rnd() * 3)));
    var obsList = pickN(th.obstacles, nObs);
    pickN(deep, nObs).forEach(function (r, i) { r.obstacle = obsList[i]; });

    // --- Setup and punchline ---------------------------------------------------------
    var pairPool = o.rooms.filter(function (r) { return r.band === "public" || r.band === "working"; });
    o.rooms.filter(function (x) { return x.obstacle; }).forEach(function (r) {
      if (!pairPool.length) return;
      var p = pairPool.splice(Math.floor(rnd() * pairPool.length), 1)[0];
      r.pairedWith = p.name;
      p.holdsAnswerTo = r.name;
    });

    // --- Where the target sits ---------------------------------------------------------
    o.targetWhat = o.approach.target;
    o.targetWhy = o.approach.why;
    var seat = null;
    if (o.approachName === "Paranormal") {
      var anom = o.rooms.filter(function (r) { return r.mix === "Anomalous Zone"; });
      if (anom.length) seat = pick(anom);
    }
    if (!seat) {
      var order = [o.approach.seat].concat(T.bandOrder.filter(function (x) { return x !== o.approach.seat; }));
      for (var oi = 0; oi < order.length; oi++) {
        var c = o.rooms.filter(function (r) { return r.band === order[oi]; });
        if (c.length) { seat = pick(c); break; }
      }
    }
    if (seat) { seat.isTarget = true; o.targetRoom = seat.name; o.targetBand = seat.band; }

    // --- Featured and scenic -----------------------------------------------------------
    o.rooms.forEach(function (r) { r.featured = !!(r.obstacle || r.isTarget); });
    var nFeatured = Math.max(2, Math.round(o.rooms.length / 2));
    var shortfall = nFeatured - o.rooms.filter(function (r) { return r.featured; }).length;
    if (shortfall > 0) pickN(o.rooms.filter(function (x) { return !x.featured; }), shortfall)
      .forEach(function (r) { r.featured = true; });

    var featured = o.rooms.filter(function (r) { return r.featured; });
    var loot = freshN("item", th.items, featured.length);
    featured.forEach(function (r, i) {
      r.loot = loot[i] || (oneIn(3) ? pick(T.itemRare) : pick(T.itemCommon));
    });

    // --- Circulation -------------------------------------------------------------------
    o.circulation = pickN(T.circulation, oneIn(2) ? 2 : 1);
    pickN(o.rooms, o.circulation.length).forEach(function (r, i) { r.connects = o.circulation[i]; });

    // --- Ring 1: the district ------------------------------------------------------------
    o.namedStreet = pick(g.named);
    o.landmark = pick(g.landmarks);
    o.watcher = pick(g.notables);
    o.districtStreets = g.streets;
    o.districtBuildings = g.buildings;
    o.districtFactions = g.factions;
    o.special = g.special || "";

    // --- Ring 2: three ways in -------------------------------------------------------------
    o.streetType = fresh("streetType", T.streetType);
    o.streetObstacle = pick(T.streetObstacle);
    var svcAll = th.alsoRooms.filter(function (nb) { return nb[1] === "working" || nb[1] === "controlled"; });
    var svcPref = svcAll.filter(function (nb) { return X.SERVICE_RE.test(nb[0]); });
    var svc = svcPref.length ? pick(svcPref) : (svcAll.length ? pick(svcAll) : null);
    // The back route's entry is drawn here rather than inside the list below: the same one
    // draw, in the same place in the rng order, so a replayed roll is the same roll.
    var back = pick(T.circulation);
    o.vectors = [
      { n: "The front", how: o.namedStreet + " — " + o.streetType + ".",
        cost: "Outside: " + o.streetObstacle.toLowerCase() + ".", know: "free" },
      { n: "The service side",
        how: svc ? "In through the " + svc[0].toLowerCase() + "."
                 : "[TODO: " + o.themeName + " prints no staff-side room on its \"also\" line.]",
        cost: "Staff use it, so someone is always near it.", know: "costs a question" },
      { n: "The back route", how: cap(back) + " — there is always one.",
        cost: "It costs something: noise, time, or a favour.", know: "can't be known from outside" }
    ];
    o.threshold = o.vectors[0].n;
    // Schema 2 (the map kit's INTEGRATION.md §3): where each way in lands, in fields, so a map
    // never has to read the words. Nothing here draws from the rng.
    //   front         needs nothing
    //   service side  room: the room its words are built from, when this roll has that room;
    //                 null when it doesn't (the kit then lands it by its words' floor, as before).
    //                 A room whose name is a way in (serviceWay: Rooftop, Basement...) is a level
    //                 and a means instead, with room null.
    //   back route    room: null; level and means from the circulation table, beside each entry
    var svcWay = svc ? (T.serviceWay || X.SERVICE_WAY)[svc[0]] : null;
    var svcRoom = svc && !svcWay ? (o.rooms.find(function (r) { return r.name === svc[0]; }) || null) : null;
    o.vectors[1].room = svcRoom ? svcRoom.name : null;
    if (svcWay) { o.vectors[1].level = svcWay[0]; o.vectors[1].means = svcWay[1]; }
    var way = (T.circulationWay || X.CIRCULATION_WAY)[back];
    o.vectors[2].room = null;
    if (way) { o.vectors[2].level = way[0]; o.vectors[2].means = way[1]; }
    o.schema = 2;

    // --- Ring 3: the block --------------------------------------------------------------------
    o.blockUse = fresh("blockUse", T.blockUse);
    o.props = pickN(T.props, 3);
    o.neighbours = [
      oneIn(3) ? pick(T.buildingRare) : pick(T.buildingCommon),
      oneIn(3) ? pick(T.buildingRare) : pick(T.buildingCommon)
    ];
    o.neighbour = o.neighbours[0];

    // --- The shell -------------------------------------------------------------------------------
    o.colour = fresh("colour", T.colour);
    o.style = fresh("style", T.style);
    o.styleName = o.style.split(".")[0];

    // --- The plan ----------------------------------------------------------------------------------
    o.geometry = T.geometry[o.styleName] || { rings: "hard", skips: 0, note: "" };
    var depthOf = function (r) { return T.bandOrder.indexOf(r.band); };
    o.skips = [];
    o.rooms.filter(function (x) { return x.connects; }).forEach(function (r) {
      var far = o.rooms
        .filter(function (x) { return x !== r && Math.abs(depthOf(x) - depthOf(r)) >= 2; })
        .sort(function (a, b) { return Math.abs(depthOf(b) - depthOf(r)) - Math.abs(depthOf(a) - depthOf(r)); });
      var near = o.rooms.filter(function (x) { return x !== r && Math.abs(depthOf(x) - depthOf(r)) === 1; });
      var dest = far.length ? far[0] : (near.length ? pick(near) : null);
      if (dest) o.skips.push({ from: r.name, to: dest.name, via: r.connects });
    });
    for (var si = 0; si < o.geometry.skips; si++) {
      var a = pick(o.rooms), b2 = pick(o.rooms);
      if (a === b2 || Math.abs(depthOf(a) - depthOf(b2)) < 2) continue;
      if (o.skips.some(function (s) { return s.from === a.name && s.to === b2.name; })) continue;
      o.skips.push({ from: a.name, to: b2.name,
        via: o.geometry.rings === "spine" ? "the drop ceiling"
           : o.geometry.rings === "blurred" ? "a passage on no plan"
           : "a doorway with no door in it" });
    }
    o.condition = fresh("condition", T.condition);
    o.volume = fresh("volume", T.volume);
    o.impressions = pickN(th.impressions, 2);
    o.detail = pick(T.detail);
    o.timeOfDay = oneIn(2) ? "Bluetime" : "Night";
    o.weather = pick(T.weather[o.timeOfDay]);
    o.streetDesc = pick(T.streetDesc);
    o.streetSound = pick(T.streetSound);
    o.streetSmell = pick(T.streetSmell);

    // --- Both threats ---------------------------------------------------------------------------------
    var ph = pick(T.physThreat), so = pick(T.socThreat);
    o.physThreatName = ph[0]; o.physThreatText = ph[1];
    o.socThreatName = so[0]; o.socThreatText = so[1];

    // --- The name ----------------------------------------------------------------------------------------
    var streetWord = o.namedStreet.replace(/^the /i, "");
    var targetWord = o.target.replace(/\b\w/g, function (ch) { return ch.toUpperCase(); });
    o.name = (tt.landmark && !o.districtClash) ? tt.landmark : streetWord + " " + targetWord;

    // --- Rumour, with %F% resolved -----------------------------------------------------------------------
    // One draw either way: a faction with a dossier when the pack prints any, else any faction (an old pack with no
    // dossiers names the faction and leaves the rest to the table, rather than throwing).
    var FD = T.factionDetail || {};
    var detailed = T.faction.filter(function (x) { return FD[x[0]]; });
    var rf = pick(detailed.length ? detailed : T.faction)[0], rd = FD[rf] || null;
    o.rumour = fresh("rumour", T.rumour)
      .replace("%F%'s allies", function () { return rd ? rf + " run with " + rd.with + "." : rf + "'s allies"; })
      .replace("%F%'s enemies", function () { return rd ? rf + " are up against " + rd.against + "." : rf + "'s enemies"; })
      .replace("%F%'s goals", function () { return rd ? rf + ": " + rd.now : rf + "'s goals"; })
      .replace("%F%'s quirk or situation", function () { return rd ? rf + " — " + rd.secret : rf + "'s situation"; });

    // --- Tensions --------------------------------------------------------------------------------------------
    o.tensions = [];
    if (onTurfAnywhere(o.faction) && !onTurf(o.district, o.faction))
      o.tensions.push("**Off their turf.** The gazetteer puts " + o.faction + " elsewhere — operations against them here count as hostile turf for Heat (p.391).");
    var HIGH_VALUE = ["Bank", "Casino", "Precinct station", "Mansion",
      "Electroplasmic substation", "Office building"];
    if (o.factionTier <= 2 && HIGH_VALUE.indexOf(o.target) >= 0)
      o.tensions.push("**Tier " + X.ROMAN[o.factionTier] + " holding a " + o.target.toLowerCase() + ".** A premise, not an error — they front it, squat it, or are about to lose it.");
    if (o.targetNote) o.tensions.push("**" + o.target + ".** " + o.targetNote);
    if (o.districtClash)
      o.tensions.push("**" + o.target + " outside " + tt.district + ".** " +
        (tt.landmark ? "*" + tt.landmark + "* is a printed landmark of " + tt.district
                     : "The printed version sits in " + tt.district) +
        " — this one is somewhere else, so it doesn't carry that name.");
    if (o.approachName === "Paranormal" && /low/i.test(o.paranormal))
      o.tensions.push("**Paranormal " + o.paranormal.toLowerCase() + " here** — whatever this is, it is hidden or imported.");

    // --- Fields the map kit and older renderers read ------------------------------------------------------------
    o.areas = o.rooms.map(function (r) { return r.name + (r.mix ? " *(" + r.mix + ")*" : ""); });
    o.items = featured.map(function (r) { return r.loot; }).filter(Boolean).slice(0, 4);
    o.obstacle = (o.rooms.find(function (r) { return r.obstacle; }) || {}).obstacle || pick(th.obstacles);
    o.threatKind = "Physical";
    o.threatName = ph[0];
    o.threatText = ph[1];

    // Not in the vault's roll: recorded so the roll can be replayed.
    o.seed = seedUsed;
    return o;
  }

  // --- Controls -------------------------------------------------------------------
  function controls(pack) {
    var T = pack.T;
    var sel = function (key, label, list) {
      return { key: key, label: label, kind: "select",
        options: [{ value: "", label: "any" }].concat(list.map(function (v) { return { value: v, label: v }; })) };
    };
    return {
      controls: [
        sel("target", "Target", Object.keys(T.targetType).sort()),   // seed-only rows (Market, Autodrome) can be chosen
        sel("district", "District", T.district.map(function (d) { return d[0]; })),
        sel("approach", "Approach", T.approach.map(function (a) { return a.n; })),
        sel("faction", "Faction", T.faction.map(function (f) { return f[0]; }).slice().sort()),
        { key: "mix", label: "Mix a second theme", kind: "toggle" }
      ],
      defaults: defaults()
    };
  }

  // --- Rendering (the vault's card, DOM-free) --------------------------------------
  function heading(o) { return o.mixName ? o.themeName + " × " + o.mixName : o.themeName; }

  // Author notes the vault leaves for itself ("[TODO: …]") are not for the table: the card says what to do instead.
  // The roll keeps the vault's text (generate() is the vault's, byte for byte); only what is shown changes.
  var NO_DOSSIER = "no dossier or thumbnail is printed for this faction: play them from the tier and the hold.";
  var NO_STAFF_DOOR = "No staff door is printed for this kind of place: invent one (a yard gate, a hatch, a delivery door).";
  var isNote = function (t) { return /^\s*\[TODO\b/i.test(String(t)); };
  // a way in as the card shows it: the service side's author note becomes the neutral line
  function howOf(v, i) { return isNote(v.how) ? (i === 1 ? NO_STAFF_DOOR : "Not printed: invent one at the table.") : v.how; }

  // A band's full label, true to this roll: the ★ band says so, and a label that calls another band "the target" (the
  // pack's Secure line, when the approach seated the target elsewhere) says where the ★ is this time instead.
  function bandTitle(full, band, o, shortOf) {
    if (band === o.targetBand) return full + " ★";
    if (o.targetBand && /\bthe target\b/i.test(full)) return full.replace(/\bthe target\b/i, "the target, usually") + " (★ in " + shortOf(o.targetBand) + " this time)";
    return full;
  }
  var shortOfLabels = function (labels) { return function (b) { return String(labels[b] || b).split(" — ")[0]; }; };

  function place(o) {
    return heading(o) + " · " + o.styleName + " · " + o.district + " · " +
      o.timeOfDay + ", " + o.weather + " · " + o.namedStreet;
  }

  function describe(o) {
    var outside = "You come at it down " + o.streetType + " — " + o.streetDesc + ". " +
      "The block is " + o.blockUse.toLowerCase() + "; next door, " + o.neighbours[0] + " and " +
      o.neighbours[1] + ". On the street: " + o.props.join(", ") + ". " +
      cap(o.streetSound) + ", " + o.streetSmell + ".";
    var inside = o.style + " Done throughout in " + o.colour + ". The place is " +
      o.condition + ", " + o.volume + ". Inside: " + o.impressions[0] + ", " +
      o.impressions[1] + ", " + o.detail + ".";
    return { outside: outside, inside: inside };
  }

  function ratings(o) {
    return ["Wealth " + o.wealth, "Security " + o.security,
      "Criminal " + o.criminal, "Paranormal " + o.paranormal];
  }

  function rows(o) {
    return [
      ["Threat", "*Physical* — **" + o.physThreatName + ".** " + o.physThreatText],
      ["Threat", "*Social* — **" + o.socThreatName + ".** " + o.socThreatText],
      ["Word out", o.rumour],
      ["Also here", "*" + o.also + "*"]
    ];
  }

  function roomTags(o, r, bold) {
    var bits = [];
    if (r.isTarget) bits.push((bold ? "**The target**" : "The target") + " — " + o.targetWhat);
    if (r.obstacle) bits.push("In the way: " + r.obstacle);
    if (r.loot) bits.push("Worth taking: " + cap(r.loot));
    if (r.connects) bits.push("Out via " + r.connects);
    if (r.pairedWith) bits.push("Answered back in " + r.pairedWith);
    if (r.holdsAnswerTo) bits.push("Holds the answer to " + r.holdsAnswerTo);
    return bits;
  }

  function roomLines(pack, o) {
    var T = pack.T, lines = [];
    T.bandOrder.forEach(function (band) {
      var inBand = o.rooms.filter(function (r) { return r.band === band; });
      if (!inBand.length) return;
      lines.push("### " + bandTitle(T.bandLabel[band], band, o, shortOfLabels(T.bandLabel)) + " (" + inBand.length + ")");
      inBand.forEach(function (r) {
        lines.push("- **" + r.name + "**" + (r.mix ? " *(" + r.mix + ")*" : "") + " — " + r.detail);
        roomTags(o, r).forEach(function (t) { lines.push("  - " + t); });
      });
    });
    return lines;
  }

  function cardSections(roll, pack) {
    var o = roll, S = [];
    var dsc = describe(o);
    var X = pack ? extraOf(pack) : DEFAULT_EXTRA;
    var sec = function (id, title, gm, lines) { S.push({ id: id, title: title, gm: gm, lines: lines }); };

    sec("head", o.name, false, [
      "*" + o.district + " · " + o.timeOfDay + ", " + o.weather + " · " + o.namedStreet + "*"
    ]);
    sec("outside", "From the street", false, [dsc.outside]);
    sec("building", "The building", true, [
      "*" + heading(o) + " · " + o.styleName + "*", "", dsc.inside
    ]);

    var ways = [];
    o.vectors.forEach(function (v, i) {
      ways.push("- **" + v.n + ".** " + cap(howOf(v, i)) + " " + v.cost + " *(" + v.know + ")*");
    });
    sec("ways", "The way in — " + o.approachName + ": " + o.approach.gambit, true, ways);

    sec("ratings", "Ratings", true, [ratings(o).concat([o.rooms.length + " rooms"]).map(function (c) { return "`" + c + "`"; }).join(" · ")]);

    if (o.tensions.length) sec("tensions", "Seed tensions", true, o.tensions.map(function (t) { return "- " + t; }));

    var rl = ["The target is **" + o.targetRoom + "** — " + o.targetWhat + ", in the " +
      o.targetBand + " band. " + o.targetWhy, ""];
    rl = rl.concat(roomLines(pack || { T: { bandOrder: ["public", "working", "controlled", "secure"],
      bandLabel: { public: "Public — anyone can be here", working: "Working — staff only; you need a reason",
        controlled: "Controlled — access-controlled; most locks are here", secure: "Secure — the target" } } }, o));
    if (o.bandNote) rl.push("", "*" + o.bandNote + "*");
    sec("rooms", "Rooms", true, rl);

    var whose = ["**" + o.faction + "** — Tier " + X.ROMAN[o.factionTier] + ", " + o.factionHold + " hold"];
    if (pack && pack.T) {
      var dd = (pack.T.factionDetail || {})[o.faction], th = (pack.T.factionThumb || {})[o.faction];
      if (dd) {
        whose.push("- **Now:** " + dd.now, "- **With:** " + dd.with, "- **Against:** " + dd.against, "- **Secret:** " + dd.secret);
      } else if (th) whose.push("- **" + th.cat + ":** " + th.thumb);
      else whose.push("- **Detail:** " + cap(NO_DOSSIER));
    }
    sec("whose", "Whose", true, whose);

    sec("trouble", "Trouble", true, rows(o).map(function (r) { return "- **" + r[0] + "** — " + r[1]; })
      .concat(o.special ? ["- **Rule here** — " + o.special] : []));

    var planLines = ["*" + o.styleName + ".* " + o.geometry.note];
    if (o.skips.length) planLines.push("", "**Skips a ring:** " +
      o.skips.map(function (s) { return s.via + " — " + s.from + " → " + s.to; }).join("; ") + ".");
    sec("plan", "The plan", true, planLines);

    sec("block", "On the block", true, [
      "Nearby: " + o.landmark + ". Watching: " + o.watcher + ". Ways between floors: " + o.circulation.join(", ") + "."
    ]);
    return S;
  }

  function cardLines(roll, pack) {
    var out = [];
    cardSections(roll, pack).forEach(function (s, i) {
      if (i === 0) { out.push("# " + s.title); }
      else { out.push("", "## " + (s.gm ? "[GM] " : "") + s.title); }
      out.push.apply(out, s.lines);
    });
    return out;
  }

  // --- The panel: a glance card and folds (15/10/2026) --------------------------------
  // The console's own layout. It reads the roll and never changes it (Copy, the note,
  // the canvas and the map kit still read the full card). Every fold is GM-only.
  var BAND_ORDER0 = ["public", "working", "controlled", "secure"];
  var BAND_LABEL0 = { public: "Public — anyone can be here", working: "Working — staff only; you need a reason",
    controlled: "Controlled — access-controlled; most locks are here", secure: "Secure — the target" };

  function bandsOf(pack) {
    var T = (pack && pack.T) || {};
    var order = T.bandOrder || BAND_ORDER0, label = T.bandLabel || BAND_LABEL0;
    return order.map(function (b) {
      var full = label[b] || cap(b);
      return { band: b, short: full.split(" — ")[0] || cap(b), full: full };
    });
  }

  function plural(n, one) { return n + " " + one + (n === 1 ? "" : "s"); }

  // The tension that only explains the generator (the target type's note) goes to Reference.
  function realTensions(o) {
    var noteLine = o.targetNote ? "**" + o.target + ".** " + o.targetNote : null;
    return o.tensions.filter(function (t) { return t !== noteLine; });
  }

  function shortFlag(t) {
    if (t.indexOf("**Off their turf.**") === 0) return "Off their turf: hostile for Heat";
    if (/^\*\*Tier [0IVX]+ holding/.test(t)) return t.replace(/^\*\*(.+?)\.\*\*.*$/, "$1") + ": a premise";
    if (/^\*\*Paranormal /.test(t)) return t.replace(/^\*\*(.+?)\*\*.*$/, "$1") + ": hidden or imported";
    return t.replace(/^\*\*(.+?)\.?\*\*.*$/, "$1");
  }

  // A band note that is a table cue (it says to call it at the table) stays in the band
  // fold of the room it names; the rest of the band notes are design rationale.
  function bandCue(o, inBand) {
    if (!o.bandNote || !/at the table/i.test(o.bandNote)) return "";
    var note = o.bandNote.toLowerCase();
    return inBand.some(function (r) { return r.name.length >= 3 && note.indexOf(r.name.toLowerCase()) >= 0; }) ? o.bandNote : "";
  }

  function wayName(v) { return cap(v.n.replace(/^the /i, "")); }

  function glance(roll, pack, reveal) {
    var o = roll, X = pack ? extraOf(pack) : DEFAULT_EXTRA;
    reveal = Array.isArray(reveal) && reveal.length ? reveal : ["public"];
    var bands = bandsOf(pack).map(function (b) {
      var inBand = o.rooms.filter(function (r) { return r.band === b.band; });
      return { band: b.band, short: b.short, count: inBand.length,
        locks: inBand.filter(function (r) { return r.obstacle; }).length,
        target: inBand.some(function (r) { return r.isTarget; }),
        shown: reveal.indexOf(b.band) >= 0 };
    }).filter(function (b) { return b.count > 0; });
    // Flags are only what is not true of every roll (B6): off their turf, a low tier holding a prize, a target outside
    // its printed district, a Paranormal approach on a low rating. The district rule shows its own text (`rule`); the
    // ring-skips live in the Plan fold's hint, since nearly every roll has one.
    var flags = realTensions(o).map(shortFlag);
    var targetBand = (bands.find(function (b) { return b.band === o.targetBand; }) || {}).short || o.targetBand;
    // the locks in the bands from the street down to the target's band (the ones the glance's band row counts)
    var deep = bands.map(function (b) { return b.band; }).indexOf(o.targetBand);
    var locks = bands.filter(function (b, i) { return i <= deep; }).reduce(function (n, b) { return n + b.locks; }, 0);
    var tb = String(targetBand).toLowerCase();
    return {
      title: o.name,
      place: o.district + " · " + o.timeOfDay + ", " + o.weather + " · " + o.namedStreet,
      // Built only from fields playerSummary already shows (the start of the outside description).
      say: "You come at it down " + o.streetType + " — " + o.streetDesc + ".",
      // One sentence of plan (idea 7), from what the glance and the player summary already show: the front (its street
      // and the obstacle outside), the target's room and band, the locks on the way down.
      plan: "Front door on " + o.namedStreet + " (outside: " + String(o.streetObstacle).toLowerCase().replace(/[.\s]+$/, "") + "); the target, " +
        o.targetRoom + " (" + tb + "), " + (locks ? "is behind " + plural(locks, "lock") : "has no lock in the way") + ".",
      whose: o.faction + " · Tier " + X.ROMAN[o.factionTier] + ", " + o.factionHold + " hold",
      security: o.security,
      bands: bands,
      target: { room: o.targetRoom, band: targetBand, what: o.targetWhat, locks: locks },
      rule: o.special ? shortRule(o.special) : "",
      skips: o.skips.length,
      flags: flags
    };
  }
  // The district rule, shortened for the glance: its first sentence, at most 110 characters.
  function shortRule(t) {
    var s = String(t).replace(/\s+/g, " ").trim();
    var m = s.match(/^.*?[.!?](?=\s|$)/);
    s = m ? m[0] : s;
    return s.length > 110 ? s.slice(0, 109) + "…" : s;
  }

  function glanceLines(roll, pack, reveal) {
    var g = glance(roll, pack, reveal);
    var lines = ["# " + g.title, "*" + g.place + "*", "",
      "**Say:** “" + g.say + "”",
      "**Whose:** " + g.whose + " · Security " + g.security,
      "**Bands:** " + g.bands.map(function (b) {
        return b.short + " " + b.count + (b.locks ? " (" + plural(b.locks, "lock") + ")" : "") + (b.target ? " ★" : "");
      }).join(" > "),
      "**Target:** ★ " + g.target.room + " (" + g.target.band.toLowerCase() + ") — " + g.target.what,
      "**Plan:** " + g.plan];
    if (g.rule) lines.push("**Rule:** " + g.rule);
    if (g.flags.length) lines.push("**Flags:** " + g.flags.join(" · "));
    return lines;
  }

  function roomChips(o, r) {
    var bits = [];
    if (r.isTarget) bits.push("**★ target:** " + o.targetWhat);
    if (r.obstacle) bits.push("**lock:** " + r.obstacle);
    if (r.loot) bits.push("**take:** " + cap(r.loot));
    if (r.connects) bits.push("**exit:** " + r.connects);
    if (r.pairedWith) bits.push("**answer in:** " + r.pairedWith);
    if (r.holdsAnswerTo) bits.push("**answers:** " + r.holdsAnswerTo);
    return bits;
  }

  // -> [ { id, title, hint, gm: true, lines: [markdown] } ], in reading order.
  function folds(roll, pack, reveal) {
    var o = roll, F = [], X = pack ? extraOf(pack) : DEFAULT_EXTRA;
    reveal = Array.isArray(reveal) && reveal.length ? reveal : ["public"];
    var dsc = describe(o), B = bandsOf(pack);
    var fold = function (id, title, hint, lines) { F.push({ id: id, title: title, hint: hint, gm: true, lines: lines }); };

    fold("read", "Read aloud", "street, then inside", [
      "*From the street*", "", dsc.outside, "",
      "*Inside — " + heading(o) + "* · read aloud, never sent to the iPad", "", dsc.inside
    ]);

    var v = o.vectors;
    var backHow = cap(v[2].how).replace(/\s+—\s+there is always one\.$/, ".");
    fold("ways", "Ways in (" + v.length + ")", o.approachName, [
      "**" + o.approachName + "** — " + o.approach.gambit + ".", "",
      "- **" + wayName(v[0]) + "** — " + cap(v[0].how) + " " + v[0].cost + " · *" + v[0].know + "*",
      "- **" + wayName(v[1]) + "** — " + cap(howOf(v[1], 1)) + " · *" + v[1].know + "*",
      "- **" + wayName(v[2]) + "** — " + backHow + " · *" + v[2].know + "*"
    ]);

    B.forEach(function (b) {
      var inBand = o.rooms.filter(function (r) { return r.band === b.band; });
      if (!inBand.length) return;
      var locks = inBand.filter(function (r) { return r.obstacle; }).length;
      var hint = [];
      if (locks) hint.push(plural(locks, "lock"));
      if (inBand.some(function (r) { return r.isTarget; })) hint.push("★ target");
      if (reveal.indexOf(b.band) >= 0) hint.push("players see it");
      var lines = [];
      var cue = bandCue(o, inBand);
      if (cue) lines.push("*" + cue + "*", "");
      inBand.forEach(function (r) {
        lines.push("- **" + (r.isTarget ? "★ " : "") + r.name + "**" + (r.mix ? " *(" + r.mix + ")*" : "") + " — " + r.detail);
        var chips = roomChips(o, r);
        if (chips.length) lines.push("  - " + chips.join(" · "));
      });
      fold("band-" + b.band, b.short + " (" + inBand.length + ")", hint.join(" · "), lines);
    });

    var opp = [
      "- **Physical** — **" + o.physThreatName + ".** " + o.physThreatText,
      "- **Social** — **" + o.socThreatName + ".** " + o.socThreatText, "",
      "**" + o.faction + "** — Tier " + X.ROMAN[o.factionTier] + ", " + o.factionHold + " hold"
    ];
    if (pack && pack.T) {
      var dd = (pack.T.factionDetail || {})[o.faction], th = (pack.T.factionThumb || {})[o.faction];
      if (dd) opp.push("- **Now:** " + dd.now, "- **With:** " + dd.with, "- **Against:** " + dd.against, "- **Secret:** " + dd.secret);
      else if (th) opp.push("- **" + th.cat + ":** " + th.thumb);
      else opp.push("- **Detail:** " + cap(NO_DOSSIER));
    }
    fold("opp", "Opposition", o.physThreatName + " · " + o.socThreatName + " · dossier", opp);

    var blk = ["- **Nearby** — " + o.landmark, "- **Watching** — " + o.watcher, "- **Word out** — " + o.rumour];
    if (o.special) blk.push("- **Rule here** — " + o.special);
    fold("block", "Block & word out", o.special ? "rumour · district rule" : "rumour", blk);

    fold("plan", "Plan & routes", o.styleName + " · " + plural(o.skips.length, "skip"),
      o.skips.length
        ? ["**Skips a ring** — the links to plan around:"].concat(o.skips.map(function (s) { return "- *" + s.via + "* — " + s.from + " → " + s.to; }))
        : ["No link skips a ring. Each room's **exit:** shows the ways between floors."]);

    var ref = [
      "**Ratings** — " + ratings(o).map(function (c) { return "`" + c + "`"; }).join(" · "),
      "**Bands** — " + B.map(function (b) { return bandTitle(b.full, b.band, o, function (x) { return (B.find(function (y) { return y.band === x; }) || { short: x }).short; }); }).join(" · "),
      "**Why the target is there** — " + o.targetWhy
    ];
    if (o.bandNote) ref.push("**Band note** — *" + o.bandNote + "*");
    if (o.targetNote) ref.push("**" + o.target + "** — " + o.targetNote);
    realTensions(o).forEach(function (t) { ref.push("**Flag** — " + t.replace(/^\*\*(.+?)\*\*\s*/, "$1 ")); });
    ref.push("**Also here** — *" + o.also + "*");
    if (o.geometry.note) ref.push("**The plan** — " + o.styleName + ". " + o.geometry.note);
    ref.push("**Ways in, always** — " + wayName(v[1]) + ": " + v[1].cost + " " + wayName(v[2]) + ": there is always one. " + v[2].cost);
    fold("ref", "Reference", "ratings · notes · also here", ref.map(function (l) { return "- " + l; }));
    return F;
  }

  // --- What the crew can see ---------------------------------------------------------
  function playerSummary(roll, reveal) {
    var o = roll;
    reveal = Array.isArray(reveal) && reveal.length ? reveal : ["public"];
    var rooms = o.rooms
      .filter(function (r) { return reveal.indexOf(r.band) >= 0; })
      .map(function (r) { return { name: r.name, band: r.band, detail: r.detail }; });
    var dsc = describe(o);
    var facade = o.style + " Its colours are " + o.colour + ".";
    var front = o.vectors[0].how + " " + o.vectors[0].cost;
    var placeLine = o.district + " · " + o.timeOfDay + ", " + o.weather + " · " + o.namedStreet;
    var lines = ["# " + o.name, "*" + placeLine + "*", "", dsc.outside, "", facade, "", "**The front.** " + cap(front)];
    if (rooms.length) {
      lines.push("", "## What you can see");
      rooms.forEach(function (r) { lines.push("- **" + r.name + "** — " + r.detail); });
    }
    return { title: o.name, place: placeLine, facade: facade, outside: dsc.outside, front: front,
      rooms: rooms, lines: lines, text: lines.join("\n") };
  }

  // --- The saved note (the vault's "Save this one") --------------------------------------
  function noteBody(roll, nopts) {
    var o = roll; nopts = nopts || {};
    var pack = nopts.pack || null;
    var X = pack ? extraOf(pack) : DEFAULT_EXTRA;
    var BAND_ORDER = ["public", "working", "controlled", "secure"];
    var BAND_LABEL = (pack && pack.T && pack.T.bandLabel) || {
      public: "Public — anyone can be here", working: "Working — staff only; you need a reason",
      controlled: "Controlled — access-controlled; most locks are here", secure: "Secure — the target" };
    BAND_ORDER = (pack && pack.T && pack.T.bandOrder) || BAND_ORDER;
    var today = nopts.date;
    if (!today) {
      var n = new Date(), pad = function (x) { return String(x).padStart(2, "0"); };
      today = pad(n.getDate()) + "/" + pad(n.getMonth() + 1) + "/" + n.getFullYear();
    }
    var dsc = describe(o);
    var withFm = nopts.frontmatter !== false;
    var fm = withFm ? [
      "---", "wiki: entity", "campaign: group", "created: " + today, "updated: " + today,
      "theme: " + o.themeName, "district: " + o.district,
      "faction: " + o.faction, "style: " + o.styleName,
      "target: " + o.target, "approach: " + o.approachName, "rooms: " + o.rooms.length,
      "tags:", "  - wiki/games", "  - wiki/blades-in-the-dark", "  - wiki/location",
      "---", ""
    ].join("\n") : "";

    var roomsMd = "";
    BAND_ORDER.forEach(function (band) {
      var inBand = o.rooms.filter(function (r) { return r.band === band; });
      if (!inBand.length) return;
      roomsMd += "### " + bandTitle(BAND_LABEL[band], band, o, shortOfLabels(BAND_LABEL)) + "\n\n";
      inBand.forEach(function (r) {
        roomsMd += "- **" + r.name + "**" + (r.mix ? " *(" + r.mix + ")*" : "") + " — " + r.detail + "\n";
        roomTags(o, r, true).forEach(function (b) { roomsMd += "    - " + b + "\n"; });
      });
      roomsMd += "\n";
    });

    return fm +
      "# " + o.name + "\n\n" +
      "*" + place(o) + "*\n\n" +
      "> [!quote] At a glance\n> " + dsc.inside + "\n>\n> " + dsc.outside + "\n\n" +
      ratings(o).map(function (c) { return "`" + c + "`"; }).join(" · ") + "\n\n" +
      (o.tensions.length
        ? "> [!warning] Seed tensions\n" + o.tensions.map(function (t) { return "> - " + t; }).join("\n") + "\n\n"
        : "") +
      "## The way in\n\n**" + o.approachName + "** — " + o.approach.gambit + ".\n\n" +
      o.vectors.map(function (v, i) { return "- **" + v.n + ".** " + cap(howOf(v, i)) + " " + v.cost + " *(" + v.know + ")*"; }).join("\n") +
      "\n\n## Rooms\n\n" +
      "The target is **" + o.targetRoom + "** — " + o.targetWhat + ", in the " +
      o.targetBand + " band. " + o.targetWhy + "\n\n" +
      roomsMd +
      (o.bandNote ? "*" + o.bandNote + "*\n\n" : "") +
      "## Trouble\n\n" +
      rows(o).map(function (r) { return "- **" + r[0] + "** — " + r[1]; }).join("\n") + "\n" +
      "- **Whose** — " + o.faction + ", Tier " + X.ROMAN[o.factionTier] + ", " + o.factionHold + " hold\n" +
      (o.special ? "- **Rule here** — " + o.special + "\n" : "") +
      "- **On the block** — Nearby: " + o.landmark + ". Watching: " + o.watcher + ". " +
      "Ways between floors: " + o.circulation.join(", ") + ".\n" +
      "- **The plan** — " + o.styleName + ". " + o.geometry.note + "\n" +
      (o.skips.length
        ? "- **Skips a ring** — " + o.skips.map(function (s) { return "*" + s.via + "*, " + s.from + " → " + s.to; }).join("; ") + "\n"
        : "") +
      "\n## In play\n\n*Which score used it, what the crew took, what they left behind.*\n" +
      (withFm
        ? "\n---\n\nRolled from [[blades-68-location-generator]]. Tables: *Blades '68* v1.0.1 " +
          o.themePage + " and p.419–433; districts p.388–417; factions p.342.\n"
        : "");
  }

  // --- The plan as a canvas (the vault's "Save the plan") -------------------------------------
  function canvas(roll, pack) {
    var o = roll, T = pack.T, X = extraOf(pack);
    var idRng = seedRng(((o.seed || 0) ^ 0x9e3779b9) >>> 0);
    var cid = function () {
      var s = "";
      for (var i = 0; i < 16; i++) s += "0123456789abcdef"[Math.floor(idRng() * 16)];
      return s;
    };
    var nodes = [], edges = [], byRoom = {};
    var put = function (x, y, colour, text, w, h) {
      var id = cid();
      var n = { id: id, type: "text",
        x: Math.round(x - (w || X.NODE_W) / 2), y: Math.round(y - (h || X.NODE_H) / 2),
        width: w || X.NODE_W, height: h || X.NODE_H, text: text };
      if (colour) n.color = colour;
      nodes.push(n);
      return id;
    };
    var link = function (from, to, label, colour) {
      if (!from || !to || from === to) return;
      var e = { id: cid(), fromNode: from, toNode: to, toEnd: "arrow" };
      if (label) e.label = label;
      if (colour) e.color = colour;
      edges.push(e);
    };
    T.bandOrder.forEach(function (band) {
      var inBand = o.rooms.filter(function (r) { return r.band === band; });
      if (!inBand.length) return;
      var R = X.RING_R[band], off = T.bandOrder.indexOf(band) * 0.6;
      inBand.forEach(function (r, i) {
        var a = off + (i * 2 * Math.PI) / inBand.length;
        var bits = [];
        if (r.isTarget) bits.push("**★ The target** — " + o.targetWhat);
        if (r.obstacle) bits.push("In the way: " + r.obstacle);
        if (r.loot) bits.push("Worth taking: " + cap(r.loot));
        byRoom[r.name] = put(Math.cos(a) * R * X.RING_WIDEN, Math.sin(a) * R, X.CANVAS_BAND[band],
          ["**" + r.name + "**" + (r.mix ? " *(" + r.mix + ")*" : ""), r.detail || "", bits.join("\n")]
            .filter(Boolean).join("\n\n"));
      });
    });
    var shallowest = T.bandOrder.find(function (b) { return o.rooms.some(function (r) { return r.band === b; }); });
    var doors = o.rooms.filter(function (r) { return r.band === shallowest; });
    o.vectors.forEach(function (v, i) {
      var a = -Math.PI / 2 + (i - 1) * 0.55;
      var id = put(Math.cos(a) * X.VECTOR_R * X.RING_WIDEN, Math.sin(a) * X.VECTOR_R, "6",
        "**" + v.n + "**\n\n" + cap(howOf(v, i)) + " " + v.cost + "\n\n*" + v.know + "*");
      link(id, byRoom[(doors[i % doors.length] || {}).name], v.know, "6");
    });
    o.rooms.filter(function (x) { return x.holdsAnswerTo; }).forEach(function (r) {
      link(byRoom[r.name], byRoom[r.holdsAnswerTo], "answers", "3");
    });
    o.skips.forEach(function (s) { link(byRoom[s.from], byRoom[s.to], s.via, "1"); });
    put(-2300, -1400, null, [
      "# " + o.name,
      "*" + o.themeName + " · " + o.styleName + " · " + o.district + " · " + o.approachName + "*", "",
      "**The plan.** " + o.geometry.note, "",
      "**Rings, outside in** — public, working, controlled, secure.", "",
      "**Purple** — a way in. **Yellow** — an earlier room that answers a lock deeper in. " +
      "**Red** — a link that skips a ring, and the only line worth planning around.", "",
      "*Geometry is `[interpretation]`; the building style it hangs off is printed, '68 p.430–431.*"
    ].join("\n"), 660, 500);
    return JSON.stringify({ nodes: nodes, edges: edges }, null, 2);
  }

  return {
    generate: generate, controls: controls, defaults: defaults,
    cardSections: cardSections, cardLines: cardLines, playerSummary: playerSummary,
    glance: glance, glanceLines: glanceLines, folds: folds,
    describe: describe, noteBody: noteBody, canvas: canvas, seedRng: seedRng, check: check,
    _reviveRe: reviveRe
  };
});
