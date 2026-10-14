/* GM figure map: turns a generated NPC into a figure kit v2 spec. window.B68GmFigureMap / module.exports. Pure, no DOM.

   API
     map(npc, F, rngFn, K)                -> { spec, notes }
     fallbackArchetype(npc, K, Cast, F)   -> spec  (nearest archetype in Cast.npcs, name/id/plate/code swapped)
     strip(spec, level)                   -> spec copy; level 1 props, 2 + patterns, 3 + hat + eyewear
     fit(npc, F, rngFn, K, Cast)          -> { spec, notes, warnings, tries, fallback }   (the whole ladder)
     check(spec, K)                       -> warnings[]  (render + portrait warnings, de-duplicated)
     parts: { splitWears, plateFor, codeFor, idFor, lookup, hash }   (small helpers)

   npc: the fields of the vault generator's generate() object (all optional; nothing throws):
     name, alias, presentation, heritage, profession, district, faction, rank, quality, isHull, chassis,
     build, featuresLook (or features), hairLook (or hair), mannerLook (or manner), standout, register,
     wears ("garment, accessory"; or garment + accessory given separately), ageCues (optional word) or age (number).
   K: the figure kit (B68Figure). Every part name is checked against K.options() and unknown ones are dropped with a
   note. Without K nothing is validated (notes say so).
   rngFn: () => [0,1). map() draws exactly 64 numbers in one fixed batch up front, so a seed always gives the same spec
   and the number of draws never depends on what F contains. If omitted, a stream seeded from the NPC's name is used.

   THE F CONTRACT (all of F is data; nothing here names a faction or a word, F supplies them)
   Every table below is an object { "<key>": <entry> }. A field's word is looked up in this order, case-insensitive:
     1 exact key  2 an entry's `match` list holds the word exactly  3 a key that is a substring of the word (longest
     key first) or a word that is a substring of a key  4 an entry's `match` keyword that is a substring of the word.
   So "a heavy coat" can be matched by the key "coat" or by match:["coat","parka"]. Keys starting with "_" are
   ignored. No match: the field falls to F.defaults[<table>] (same entry shape) and then to code defaults (random,
   from the kit's own part lists, picked with the seeded rng), and a note "no match: <table> "<word>"" is recorded.
   Value forms inside an entry: a string; an array of strings = a seeded choice among them (invalid names are
   filtered first); a two-number array on a numeric key (age, heightIn, heads, build, tilt, yaw, stoop) = a seeded
   range; fem / masc sub-objects are merged over the entry when the figure is fem / masc.

   table          npc field(s)               entry keys
   faction        faction                    halo (token), code (3-letter prefix for XXX-968-NNNN), palette [main, second,
                                              accent] (cloth-* tokens), hat, plus any outfit slot (outer, base, mid, ...)
                                              and props, applied at the lowest priority; match
   presentation   presentation ("Hull" too)  figure: "fem" | "masc" | ["fem","masc"] (a choice), shape
   heritage       heritage                   skin: [kit skins], hairColor: [tokens]
   rank           rank                       age: [lo, hi]
   ageCues        ageCues                    age: [lo, hi], stoop
   build          build (the word/phrase)    shape, build (number, or [lo, hi]), heightIn [lo, hi], heads, body {type, belly, ...}
   features       featuresLook               head, eyes, brows, nose, mouth, ears, ageStyle ("lines"|"weathered"), marks [..]
   manner         mannerLook                 stance, weight ("R"|"L"), arms {R, L} (each a string or choice), expression,
                                              brows, mouth, tilt, yaw, stoop
   hair           hairLook                   style, color, facialHair (type string, or null), facialColor
   standout       standout                   eyewear (string/choice), marks [..], props [..], hairStyle, facialHair, ageStyle, body
   register       register                   outfit slots: a base outfit for the register (any of the slots below)
   garment        wears (part before ", ")   outfit slots, hat, props
   accessory      wears (part after ", ")    outfit slots, hat, props
   chassis        chassis (Hulls)            palette, eyewear, hat, any outfit slot (first matching entry only)
   archetypes     (fallback only)            array of { id, match: { presentation: [..], profession: [..], register: [..],
                                              faction: [..], build: [..], wears: [..] } } ; id is a B68Cast.npcs id
   defaults       -                          baseline pieces: skin [..], age [lo,hi], heightIn [lo,hi], heads, shape, build,
                                              palette [tokens, 3+ = pool when no faction], neutrals [tokens, shirt colours],
                                              hairColor [..], hairStyle {masc:[..], fem:[..]}, face {head, eyes, brows,
                                              nose, mouth, expression}, outfit {slots}, femFacialHair (bool, default false),
                                              plus the table names above (defaults.build, defaults.hair, ...) as the entry used
                                              on a miss.
   Outfit slot values (garment, accessory, register, faction, chassis, defaults.outfit):
     slots: base mid outer neck bottom dress legs feet waist hands; each is "type", ["type", ...] (choice),
     { type, color?, pattern?, cut?, sleeves?, open?, ... } or an array of those. null removes a slot.
     color may be a token or a role: "main" | "second" | "accent" (palette[0], [1], [2]); absent = the slot's usual role.
     hat: "type" | {type, color} | choice list. props: ["book", {type:"cane"}, ...] (props appear only if F lists them).
     Priority, low to high: code defaults < defaults.outfit < faction < register < garment < accessory; of dress vs
     base+bottom, whichever comes from the higher layer wins.
   Face parts, hair, hats, eyewear, marks, props, patterns are checked against K.options(); colours must be a
   cloth-*, brand or matter token or #rrggbb. */
(function (root) {
  "use strict";

  /* ---------- small utilities ---------- */
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function isObj(v) { return v && typeof v === "object" && !Array.isArray(v); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function str(v) { return v == null ? "" : String(v).trim(); }
  function low(v) { return str(v).toLowerCase(); }
  function isNum(v) { return typeof v === "number" && isFinite(v); }
  function isRange(v) { return Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function round(v, n) { var m = Math.pow(10, n || 0); return Math.round(v * m) / m; }

  /* ---------- the fixed draw table: 64 numbers, always drawn, in this order ---------- */
  var SLOT_NAMES = ["figure", "skin", "age", "height", "heads", "build", "shape", "hairStyle", "hairColor", "facial", "hat", "eyewear",
    "mark1", "mark2", "prop1", "prop2", "propSide", "stance", "weight", "armR", "armL", "head", "eyes", "brows", "nose", "mouth",
    "expression", "tilt", "yaw", "stoop", "palette", "palette2", "palette3", "outer", "base", "bottom", "dress", "feet", "neck", "mid",
    "legs", "hands", "waist", "pattern", "outerOn", "neckOn", "dressOn", "ears", "ageStyle", "hullShape", "femHair", "mascHair",
    "baseColor", "feetColor", "hatOn", "bodyBelly", "jaw", "gen1", "gen2", "gen3", "gen4", "gen5", "gen6", "gen7"];
  var SLOT = {}; SLOT_NAMES.forEach(function (n, i) { SLOT[n] = i; });
  var NSLOTS = SLOT_NAMES.length; // 64

  var SLOT_KIND = { base: "top", mid: "mid", outer: "outer", neck: "neckwear", bottom: "bottom", dress: "dress", legs: "legwear", feet: "footwear", waist: "belt", hands: "gloves" };
  var SLOTS = ["base", "mid", "outer", "neck", "bottom", "dress", "legs", "feet", "waist", "hands"];
  var COLOUR_KEYS = ["color", "color2", "grey", "frame", "lens", "lips", "band", "shaftColor", "buttonColor", "cuff", "pocketSquare", "browColor", "eyeColor"];
  var PROP_ARM = { book: "hold", glass: "hold", newspaper: "hold", briefcase: "carry", suitcase: "carry", satchel: "carry", cane: "carry", umbrella: "carry", cigarette: "smoke", pipe: "smoke" };
  var FALLBACK_COLOURS = ["cloth-charcoal", "cloth-navy", "cloth-olive", "cloth-brown", "cloth-rust", "cloth-teal", "cloth-mustard", "cloth-plum", "cloth-forest", "cloth-tobacco", "cloth-oxblood", "cloth-petrol", "cloth-denim", "cloth-khaki", "cloth-sage"];
  var NEUTRALS = ["cloth-cream", "cloth-white", "cloth-stone", "cloth-ash", "cloth-black"];
  var DARKS = ["cloth-black", "cloth-chocolate", "cloth-brown", "cloth-charcoal"];
  var HAIR_COLOURS = ["cloth-black", "cloth-chocolate", "cloth-brown", "cloth-ochre", "cloth-rust", "cloth-charcoal", "cloth-tan"];
  var CODE_HAIR = {
    masc: ["short", "crew", "buzz", "side-part", "slick-back", "flattop", "receding", "mod-mop", "pompadour", "balding"],
    fem: ["bob", "flip", "pixie", "long-straight", "ponytail", "bun", "short", "bowl-bob", "side-part", "mod-mop"]
  };
  var CODE_OUTFIT = {
    masc: { base: ["shirt", "tee", "knit", "polo", "turtleneck"], bottom: ["trousers", "jeans", "slacks", "cargo-trousers"], feet: ["oxfords", "loafers", "chelsea-boots", "combat-boots", "sneakers"], outer: ["blazer", "suit-jacket", "field-jacket", "leather-jacket", "peacoat", "trench"] },
    fem: { base: ["blouse", "shell", "knit", "turtleneck", "tee"], bottom: ["a-line-skirt", "pencil-skirt", "trousers", "slacks", "jeans"], feet: ["heels", "mary-janes", "chelsea-boots", "loafers", "go-go-boots"], outer: ["blazer", "peacoat", "leather-jacket", "cape-coat", "trench"], dress: ["shift-dress", "a-line-dress"] }
  };

  /* ---------- kit option helpers ---------- */
  function mkOpts(K) {
    var raw = null;
    try { raw = K && typeof K.options === "function" ? K.options() : null; } catch (e) { raw = null; }
    var tok = null;
    try { tok = K && K.tokens ? K.tokens : null; } catch (e2) { tok = null; }
    var colourSet = null;
    if (tok) { colourSet = {}; ["CLOTH", "BRAND", "MATTER"].forEach(function (k) { Object.keys(tok[k] || {}).forEach(function (n) { colourSet[n] = 1; }); }); }
    function list(kind) {
      if (!raw || raw[kind] == null) return null;
      var v = raw[kind];
      return Array.isArray(v) ? v : Object.keys(v);
    }
    return {
      has: !!raw,
      list: list,
      valid: function (kind, name) { var l = list(kind); return !l || l.indexOf(name) >= 0; },
      colour: function (c) {
        if (typeof c !== "string") return false;
        if (/^#[0-9a-f]{6}$/i.test(c)) return true;
        if (colourSet) return !!colourSet[c];
        return /^(cloth|ink|paper|signal|caution|file|covert|alarm|swing|slate|leather|metal|wood)-/.test(c);
      },
      skins: function () { return list("skins") || ["porcelain", "fair", "olive", "tan", "brown", "deep", "ebony", "flushed", "pale"]; }
    };
  }

  /* ---------- table lookup ---------- */
  function lookup(table, word) {
    var w = low(word);
    if (!w || !isObj(table)) return null;
    var keys = Object.keys(table).filter(function (k) { return k.charAt(0) !== "_" && isObj(table[k]); });
    var i, k, e, m;
    for (i = 0; i < keys.length; i++) if (low(keys[i]) === w) return { key: keys[i], entry: table[keys[i]], how: "exact" };
    for (i = 0; i < keys.length; i++) {
      e = table[keys[i]]; m = e.match;
      if (m != null && [].concat(m).some(function (x) { return low(x) === w; })) return { key: keys[i], entry: e, how: "match" };
    }
    var byLen = keys.slice().sort(function (a, b) { return b.length - a.length || (a < b ? -1 : 1); });
    for (i = 0; i < byLen.length; i++) {
      k = low(byLen[i]);
      if (k.length >= 3 && w.indexOf(k) >= 0) return { key: byLen[i], entry: table[byLen[i]], how: "substring" };
    }
    for (i = 0; i < byLen.length; i++) {
      k = low(byLen[i]);
      if (w.length >= 4 && k.indexOf(w) >= 0) return { key: byLen[i], entry: table[byLen[i]], how: "substring" };
    }
    for (i = 0; i < byLen.length; i++) {
      m = table[byLen[i]].match;
      if (m != null && [].concat(m).some(function (x) { x = low(x); return x.length >= 3 && w.indexOf(x) >= 0; })) return { key: byLen[i], entry: table[byLen[i]], how: "keyword" };
    }
    return null;
  }

  /* ---------- names, ids, codes ---------- */
  function splitWears(npc) {
    var g = str(npc.garment), a = str(npc.accessory);
    if (g || a) return { garment: g, accessory: a };
    var w = str(npc.wears);
    var i = w.indexOf(",");
    return i < 0 ? { garment: w, accessory: "" } : { garment: w.slice(0, i).trim(), accessory: w.slice(i + 1).trim() };
  }
  function cleanName(n) { return str(n).replace(/["“”]/g, "").replace(/\s+/g, " "); }
  function plateFor(npc) {
    var n = cleanName(npc && npc.name);
    if (!n) return "";
    var p = n.split(" ");
    if (p.length < 2 || npc.isHull || /\d/.test(n)) return n;
    var sur = p[p.length - 1], ini = p[0].charAt(0).toUpperCase();
    return sur + " · " + ini + ".";
  }
  function idFor(npc) {
    var s = cleanName(npc && npc.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return s || "npc";
  }
  function codeFor(npc, prefix) {
    var pre = str(prefix).toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    if (pre.length < 2) pre = "NPC";
    var n = hash(cleanName(npc && npc.name) + "|" + str(npc && npc.faction)) % 10000;
    return pre + "-968-" + ("000" + n).slice(-4);
  }

  /* ---------- the mapper ---------- */
  function map(npc, F, rngFn, K) {
    var notes = [];
    try { return build(npc || {}, isObj(F) ? F : {}, rngFn, K, notes); }
    catch (e) {
      notes.push("figure map error: " + (e && e.message ? e.message : e) + "; used a plain baseline");
      return { spec: baseline(npc || {}), notes: notes };
    }
  }

  function baseline(npc) {
    return { id: idFor(npc), name: cleanName(npc.name) || "NPC", plate: plateFor(npc), code: codeFor(npc, ""), halo: "ink-500", heightIn: 68, shape: "lean", build: 1, skin: "fair", age: 38,
      pose: { stance: "square", arms: { R: "down", L: "down" } }, head: { shape: "oval" }, face: { eyes: "almond", brows: "straight", nose: "straight", mouth: "neutral", expression: "neutral" },
      hair: { style: "short", color: "cloth-chocolate" },
      outfit: { base: { type: "shirt", color: "cloth-cream" }, bottom: { type: "trousers", color: "cloth-charcoal" }, feet: { type: "oxfords", color: "cloth-black" } }, props: [] };
  }

  function build(npc, F, rngFn, K, notes) {
    var OPT = mkOpts(K);
    if (!OPT.has) notes.push("no kit supplied: part names were not validated");
    var rng = typeof rngFn === "function" ? rngFn : mulberry32(hash(str(npc.name) + "|" + str(npc.faction)));
    var D = []; for (var di = 0; di < NSLOTS; di++) D.push(rng());
    function r(name) { var i = SLOT[name]; return D[i == null ? hash(name) % NSLOTS : i]; }
    function pickOf(list, name) { return list.length ? list[Math.min(list.length - 1, Math.floor(r(name) * list.length))] : undefined; }
    function note(s) { if (notes.indexOf(s) < 0) notes.push(s); }

    var defaults = isObj(F.defaults) ? F.defaults : {};
    var isHull = !!npc.isHull || low(npc.presentation) === "hull";

    /* choose a value from an entry field: string, choice list, or range */
    function pickVal(v, name, kind) {
      if (v == null) return undefined;
      if (Array.isArray(v)) {
        var l = v.filter(function (x) { return x != null && (kind ? OPT.valid(kind, x) : true); });
        if (!l.length) { note("dropped unknown " + (kind || name) + " " + JSON.stringify(v)); return undefined; }
        return pickOf(l, name);
      }
      if (kind && !OPT.valid(kind, v)) { note("dropped unknown " + kind + ' "' + v + '"'); return undefined; }
      return v;
    }
    function numVal(v, name, lo, hi, dp) {
      if (v == null) return undefined;
      var x = isRange(v) ? v[0] + (v[1] - v[0]) * r(name) : Array.isArray(v) ? pickOf(v.filter(isNum), name) : v;
      if (!isNum(x)) return undefined;
      return round(clamp(x, lo, hi), dp || 0);
    }
    function sub(entry, fig) { // merge fem/masc sub-objects over an entry
      if (!isObj(entry)) return entry;
      var o = Object.assign({}, entry); delete o.fem; delete o.masc;
      var add = fig && isObj(entry[fig]) ? entry[fig] : null;
      return add ? Object.assign(o, add) : o;
    }
    var matched = {};
    function find(tableName, word, fig) {
      var t = F[tableName], w = str(word), hit = null;
      if (w && t) hit = lookup(t, w);
      if (hit) { matched[tableName] = hit.key; return sub(hit.entry, fig); }
      if (w) note('no match: ' + tableName + ' "' + w + '"');
      var dflt = isObj(defaults[tableName]) ? defaults[tableName] : null;
      return dflt ? sub(dflt, fig) : null;
    }

    /* ---- figure ---- */
    var presEntry = find("presentation", npc.presentation, null) || {};
    var figure = pickVal(presEntry.figure, "figure");
    if (figure !== "fem" && figure !== "masc") {
      var pw = low(npc.presentation);
      figure = /^fem/.test(pw) ? "fem" : /^masc/.test(pw) ? "masc" : r("figure") < 0.5 ? "masc" : "fem";
      if (presEntry.figure != null) note('figure "' + presEntry.figure + '" is not fem or masc; chose ' + figure);
    }
    var fig = figure;

    /* ---- faction, palette, halo ---- */
    var facEntry = null, facName = str(npc.faction);
    if (facName) facEntry = find("faction", facName, fig);
    else facEntry = null;
    var pal = [];
    var rawPal = facEntry && Array.isArray(facEntry.palette) ? facEntry.palette : Array.isArray(defaults.palette) && facName ? defaults.palette.slice(0, 3) : null;
    if (rawPal) rawPal.forEach(function (c) { if (OPT.colour(c)) pal.push(c); else note('dropped unknown colour "' + c + '" in palette'); });
    if (!pal.length) { // no faction (or no usable palette): a seeded three from the pool
      var pool = (Array.isArray(defaults.palette) && defaults.palette.length >= 3 ? defaults.palette : FALLBACK_COLOURS).filter(function (c) { return OPT.colour(c); });
      if (pool.length < 3) pool = FALLBACK_COLOURS.slice();
      var a = Math.floor(r("palette") * pool.length), b = Math.floor(r("palette2") * (pool.length - 1)), c3 = Math.floor(r("palette3") * (pool.length - 2));
      var rest = pool.slice(); var p1 = rest.splice(a, 1)[0]; var p2 = rest.splice(b, 1)[0]; var p3 = rest.splice(c3, 1)[0];
      pal = [p1, p2, p3];
    }
    var ROLE = { main: pal[0], second: pal[1] || pal[0], accent: pal[2] || pal[1] || pal[0] };
    var halo = facEntry && facEntry.halo != null ? facEntry.halo : defaults.halo;
    if (!OPT.colour(halo)) { if (halo) note('dropped unknown halo "' + halo + '"'); halo = "ink-500"; }

    /* ---- age, skin ---- */
    var rankEntry = str(npc.rank) ? find("rank", npc.rank, fig) : null;
    var ageEntry = str(npc.ageCues) ? find("ageCues", npc.ageCues, fig) : null;
    var age;
    if (isNum(npc.age)) age = Math.round(clamp(npc.age, 3, 95));
    else {
      var ar = (ageEntry && ageEntry.age) || (rankEntry && rankEntry.age) || defaults.age || [24, 60];
      age = numVal(ar, "age", 3, 95) || 38;
    }
    var herEntry = isHull ? null : find("heritage", npc.heritage, fig);
    var skinList = (herEntry && herEntry.skin) || defaults.skin || OPT.skins();
    var skin = pickVal([].concat(skinList), "skin", "skins");
    if (!skin) skin = pickOf(OPT.skins(), "skin");

    /* ---- build, shape, height ---- */
    var buildWord = str(npc.build);
    var bEntry = isHull ? null : find("build", buildWord, fig);
    var hullBase = isHull && isObj(F.hull) ? sub(F.hull, fig) : null;
    var bSrc = bEntry || hullBase || {};
    var shapeFromPres = presEntry.shape;
    var shape = pickVal(bSrc.shape != null ? bSrc.shape : shapeFromPres != null ? shapeFromPres : defaults.shape, "shape", "shapes");
    if (!shape) { var sl = OPT.list("shapes") || ["lean", "rect", "invtri", "column", "pear", "oval", "hourglass", "lanky", "slim"]; shape = pickOf(sl, isHull ? "hullShape" : "shape"); }
    var heightRange = bSrc.heightIn != null ? bSrc.heightIn : defaults.heightIn != null ? defaults.heightIn : (fig === "fem" ? [61, 70] : [66, 76]);
    var heightIn = numVal(heightRange, "height", 48, 90) || 68;
    var heads = numVal(bSrc.heads != null ? bSrc.heads : defaults.heads != null ? defaults.heads : [7.1, 7.8], "heads", 5.5, 9, 2);
    var buildN = numVal(bSrc.build != null ? bSrc.build : defaults.build != null ? defaults.build : [0.92, 1.12], "build", 0.6, 1.6, 2);
    var body = {};
    if (isObj(bSrc.body)) {
      Object.keys(bSrc.body).forEach(function (k) {
        var v = bSrc.body[k];
        if (k === "type") { var t = pickVal(v, "build", "body"); if (t) body.type = t; }
        else if (k === "bigLeg") { if (v === "R" || v === "L") body.bigLeg = v; }
        else if (k === "belly") { var bv = numVal(v, "bodyBelly", 0, 1.5, 2); if (bv != null) body.belly = bv; }
        else if (["shoulders", "chest", "waist", "hips", "neck", "arms", "legs", "hands", "feet"].indexOf(k) >= 0) { var nv = numVal(v, "bodyBelly", 0.5, 2, 2); if (nv != null) body[k] = nv; }
      });
    }

    /* ---- face ---- */
    var feat = isHull ? null : find("features", npc.featuresLook || npc.features, fig);
    var fd = isObj(defaults.face) ? defaults.face : {};
    feat = feat || {};
    function facePart(key, kind, slot) {
      var v = pickVal(feat[key] != null ? feat[key] : fd[key], slot, kind);
      if (v == null) { var l = OPT.list(kind); if (l) v = pickOf(l, slot); }
      return v;
    }
    var head = facePart("head", "head", "head");
    var face = {
      eyes: facePart("eyes", "eyes", "eyes") || "almond", brows: null, nose: facePart("nose", "nose", "nose") || "straight", mouth: null, expression: null
    };
    var mEntry = isHull ? null : find("manner", npc.mannerLook || npc.manner, fig);
    mEntry = mEntry || {};
    face.brows = pickVal(mEntry.brows != null ? mEntry.brows : feat.brows != null ? feat.brows : fd.brows, "brows", "brows") || pickOf(OPT.list("brows") || ["straight"], "brows");
    face.mouth = pickVal(mEntry.mouth != null ? mEntry.mouth : feat.mouth != null ? feat.mouth : fd.mouth, "mouth", "mouth") || pickOf(OPT.list("mouth") || ["neutral"], "mouth");
    face.expression = pickVal(mEntry.expression != null ? mEntry.expression : fd.expression, "expression", "expression") || "neutral";
    var ears = pickVal(feat.ears, "ears", "ears");
    if (ears) face.ears = ears;

    var soEntry = isHull ? null : find("standout", npc.standout, fig);
    soEntry = soEntry || {};

    var ageStyle = pickVal(soEntry.ageStyle != null ? soEntry.ageStyle : feat.ageStyle, "ageStyle", "age");
    if (!ageStyle) ageStyle = age >= 56 ? "weathered" : age >= 42 ? "lines" : null;
    if (ageStyle) face.ageStyle = ageStyle;

    var markList = [].concat(feat.marks || [], soEntry.marks || []).filter(function (m) { return m != null; });
    var marks = [];
    markList.forEach(function (m) {
      var t = typeof m === "string" ? m : m && m.type;
      if (!OPT.valid("mark", t)) { note('dropped unknown mark "' + t + '"'); return; }
      if (marks.length < 2 && !marks.some(function (x) { return x.type === t; })) marks.push(isObj(m) ? clone(m) : { type: t });
    });
    if (marks.length) face.marks = marks;

    /* ---- hair, facial hair, hat ---- */
    var hEntry = isHull ? null : find("hair", npc.hairLook || npc.hair, fig);
    hEntry = hEntry || {};
    var hairStyleSrc = soEntry.hairStyle != null ? soEntry.hairStyle : hEntry.style != null ? hEntry.style : (defaults.hairStyle && (defaults.hairStyle[fig] || (Array.isArray(defaults.hairStyle) ? defaults.hairStyle : null)));
    var hairStyle = pickVal(hairStyleSrc, "hairStyle", "hair");
    if (!hairStyle) { hairStyle = pickVal(CODE_HAIR[fig], fig === "fem" ? "femHair" : "mascHair", "hair") || "short"; }
    var hairColorSrc = hEntry.color != null ? hEntry.color : herEntry && herEntry.hairColor != null ? herEntry.hairColor : defaults.hairColor != null ? defaults.hairColor : HAIR_COLOURS;
    var hairColor = pickVal([].concat(hairColorSrc).filter(function (c) { return OPT.colour(c); }), "hairColor");
    if (!hairColor) hairColor = pickOf(HAIR_COLOURS, "hairColor");
    var greyTok = age >= 48 ? "cloth-white" : null;
    var hair = { style: hairStyle, color: hairColor };
    if (greyTok) hair.grey = greyTok;
    var fhSrc = soEntry.facialHair !== undefined ? soEntry.facialHair : hEntry.facialHair;
    var fhType = fhSrc == null ? null : pickVal(isObj(fhSrc) ? fhSrc.type : fhSrc, "facial", "facialHair");
    if (fhType && fig === "fem" && !defaults.femFacialHair) { note('dropped facial hair "' + fhType + '" on a fem figure'); fhType = null; }
    if (fhType) {
      var fc = hEntry.facialColor && OPT.colour(hEntry.facialColor) ? hEntry.facialColor : hairColor;
      face.facialHair = { type: fhType, color: fc };
      if (greyTok) face.facialHair.grey = greyTok;
    }
    var ew = pickVal(soEntry.eyewear, "eyewear", "eyewear");
    if (ew) face.eyewear = { type: ew };

    /* ---- chassis (hulls) ---- */
    var chEntry = null;
    if (isHull && str(npc.chassis)) {
      var chHit = F.chassis ? lookup(F.chassis, npc.chassis) : null;
      if (chHit) chEntry = sub(chHit.entry, fig); else note('no match: chassis "' + str(npc.chassis) + '"');
      if (chEntry && chEntry.eyewear) { var cew = pickVal(chEntry.eyewear, "eyewear", "eyewear"); if (cew) face.eyewear = { type: cew }; }
    }

    /* ---- pose ---- */
    var stance = pickVal(mEntry.stance, "stance") || pickOf(["square", "easy", "easy", "wide"], "stance");
    if (["square", "easy", "wide"].indexOf(stance) < 0) { note('dropped unknown stance "' + stance + '"'); stance = "square"; }
    var pose = { stance: stance };
    var weight = pickVal(mEntry.weight, "weight");
    if (stance === "easy") pose.weight = weight === "R" || weight === "L" ? weight : r("weight") < 0.5 ? "R" : "L";
    var armsSrc = mEntry.arms;
    if (typeof armsSrc === "string") armsSrc = { R: armsSrc, L: armsSrc };
    var armDefaults = [["down", "down"], ["down", "pocket"], ["pocket", "pocket"], ["down", "hip"], ["hip", "down"], ["cross", "cross"], ["behind", "behind"], ["pocket", "down"]];
    var ad = pickOf(armDefaults, "armR");
    var arms = {
      R: pickVal(isObj(armsSrc) ? armsSrc.R : undefined, "armR", "armPoses") || ad[0],
      L: pickVal(isObj(armsSrc) ? armsSrc.L : undefined, "armL", "armPoses") || ad[1]
    };
    if (arms.R === "cross" || arms.L === "cross") arms.R = arms.L = "cross";
    pose.arms = arms;
    pose.head = {
      tilt: Math.round(numVal(mEntry.tilt != null ? mEntry.tilt : [-4, 4], "tilt", -10, 10) || 0),
      yaw: Math.round(numVal(mEntry.yaw != null ? mEntry.yaw : [-12, 12], "yaw", -25, 25) || 0)
    };
    var stoopSrc = mEntry.stoop != null ? mEntry.stoop : ageEntry && ageEntry.stoop != null ? ageEntry.stoop : age >= 68 ? [0.15, 0.35] : null;
    var stoop = stoopSrc == null ? undefined : numVal(stoopSrc, "stoop", 0, 1, 2);
    if (stoop) pose.stoop = stoop;

    /* ---- outfit ---- */
    var facSlots = facEntry || {};
    var regEntry = isHull ? null : find("register", npc.register, fig);
    var wears = splitWears(npc);
    var garEntry = wears.garment ? find("garment", wears.garment, fig) : (isHull ? null : find("garment", "", fig));
    var accEntry = wears.accessory ? find("accessory", wears.accessory, fig) : null;
    var layers = [
      { name: "code", def: codeOutfit(fig) },
      { name: "defaults", def: isObj(defaults.outfit) ? sub(defaults.outfit, fig) : {} },
      { name: "faction", def: facSlots },
      { name: "chassis", def: chEntry || {} },
      { name: "register", def: regEntry || {} },
      { name: "garment", def: garEntry || {} },
      { name: "accessory", def: accEntry || {} }
    ];
    function codeOutfit(f) {
      var c = CODE_OUTFIT[f] || CODE_OUTFIT.masc, o = {};
      if (f === "fem" && r("dressOn") < 0.3) { o.dress = c.dress; o.feet = c.feet; }
      else { o.base = c.base; o.bottom = c.bottom; o.feet = c.feet; }
      if (r("outerOn") < 0.4) o.outer = c.outer;
      return o;
    }
    var chosen = {}, from = {};
    layers.forEach(function (L, li) {
      SLOTS.forEach(function (s) {
        if (L.def[s] === undefined) return;
        if (L.def[s] === null) { delete chosen[s]; delete from[s]; return; }
        chosen[s] = L.def[s]; from[s] = li;
      });
    });
    // dress against base + bottom: the higher layer wins
    if (chosen.dress != null) {
      var tops = Math.max(from.base == null ? -1 : from.base, from.bottom == null ? -1 : from.bottom);
      if (from.dress >= tops) { delete chosen.base; delete chosen.bottom; } else delete chosen.dress;
    }
    var hasOuter = chosen.outer != null;
    var hasDress = chosen.dress != null;
    function roleColour(c, slot) {
      if (c == null) return null;
      if (ROLE[c]) return ROLE[c];
      if (OPT.colour(c)) return c;
      note('dropped unknown colour "' + c + '"');
      return null;
    }
    var defaultRole = {
      base: hasOuter ? null : "main", mid: "accent", outer: "main", neck: "accent", bottom: "second", dress: "main", legs: null, feet: null, waist: null, hands: null
    };
    var neutral = pickOf(NEUTRALS, "baseColor");
    var darkFeet = pickOf(DARKS, "feetColor");
    function cleanPiece(def, slot) {
      var kind = SLOT_KIND[slot];
      var o = typeof def === "string" ? { type: def } : isObj(def) ? def : null;
      if (!o) return null;
      var out = {};
      Object.keys(o).forEach(function (k) {
        var v = o[k];
        if (k === "type") return;
        if (COLOUR_KEYS.indexOf(k) >= 0) { var cc = roleColour(v, slot); if (cc) out[k] = cc; }
        else if (k === "pattern") {
          var pt = typeof v === "string" ? v : v && v.type;
          if (!OPT.valid("textile", pt)) { note('dropped unknown pattern "' + pt + '"'); return; }
          var pp = { type: pt };
          if (isObj(v)) Object.keys(v).forEach(function (pk) { if (pk === "type") return; if (COLOUR_KEYS.indexOf(pk) >= 0) { var pc = roleColour(v[pk], slot); if (pc) pp[pk] = pc; } else pp[pk] = clone(v[pk]); });
          out.pattern = pp;
        } else out[k] = clone(v);
      });
      out.type = o.type;
      return out;
    }
    function choosePiece(val, slot) {
      var cands = [].concat(val).map(function (d) { return typeof d === "string" ? { type: d } : d; }).filter(function (d) {
        if (!isObj(d) || typeof d.type !== "string") return false;
        if (!OPT.valid(SLOT_KIND[slot], d.type)) { note("dropped unknown " + SLOT_KIND[slot] + ' "' + d.type + '"'); return false; }
        return true;
      });
      if (!cands.length) return null;
      var p = cleanPiece(pickOf(cands, slot), slot);
      if (p && p.color == null) {
        var role = defaultRole[slot];
        if (slot === "base" && hasOuter) p.color = neutral;
        else if (slot === "feet" || slot === "legs" || slot === "hands") p.color = darkFeet;
        else if (slot === "waist") p.color = "leather-black";
        else if (role) p.color = ROLE[role];
        else p.color = ROLE.main;
      }
      return p;
    }
    var outfit = {};
    SLOTS.forEach(function (s) { if (chosen[s] != null) { var p = choosePiece(chosen[s], s); if (p) outfit[s] = p; } });
    if (!outfit.dress && !outfit.bottom) outfit.bottom = { type: pickOf(CODE_OUTFIT[fig].bottom.filter(function (t) { return OPT.valid("bottom", t); }), "bottom") || "trousers", color: ROLE.second };
    if (!outfit.dress && !outfit.base) outfit.base = { type: pickOf(CODE_OUTFIT[fig].base.filter(function (t) { return OPT.valid("top", t); }), "base") || "tee", color: hasOuter ? neutral : ROLE.main };
    if (!outfit.feet) outfit.feet = { type: pickOf(CODE_OUTFIT[fig].feet.filter(function (t) { return OPT.valid("footwear", t); }), "feet") || "oxfords", color: darkFeet };

    if (outfit.outer && outfit.waist && outfit.outer.belt === undefined) outfit.outer.belt = false; // a worn belt replaces the jacket's own
    if (outfit.waist && !outfit.outer && outfit.base && outfit.base.tucked === undefined) outfit.base.tucked = true; // so the belt shows

    // hat: accessory > garment > register > chassis > faction
    var hatDef;
    [facSlots, chEntry || {}, regEntry || {}, garEntry || {}, accEntry || {}].forEach(function (L) { if (L.hat !== undefined) hatDef = L.hat; });
    if (hatDef != null) {
      var hc = [].concat(hatDef).map(function (d) { return typeof d === "string" ? { type: d } : d; }).filter(function (d) {
        if (!isObj(d) || !d.type) return false;
        if (!OPT.valid("hat", d.type)) { note('dropped unknown hat "' + d.type + '"'); return false; }
        return true;
      });
      if (hc.length) {
        var hp = pickOf(hc, "hat"), hcol = hp.color != null ? roleColour(hp.color) : null;
        hair.hat = { type: hp.type, color: hcol || (pal.length > 2 ? ROLE.accent : ROLE.main) };
      }
    }

    /* ---- props: only what F lists ---- */
    var propDefs = [];
    [facSlots, chEntry || {}, soEntry, garEntry || {}, accEntry || {}].forEach(function (L) { if (L.props != null) propDefs = propDefs.concat(L.props); });
    var props = [], armUsed = {}, sideDraw = r("propSide");
    propDefs.forEach(function (d, i) {
      var p = typeof d === "string" ? { type: d } : isObj(d) ? clone(d) : null;
      if (!p || !p.type) return;
      if (!OPT.valid("prop", p.type)) { note('dropped unknown prop "' + p.type + '"'); return; }
      if (props.some(function (x) { return x.type === p.type; })) return;
      if (props.length >= 3) return;
      var need = PROP_ARM[p.type];
      if (need) {
        var side = p.side === "R" || p.side === "L" ? p.side : (sideDraw + i * 0.5) % 1 < 0.5 ? "R" : "L";
        if (armUsed[side]) side = side === "R" ? "L" : "R";
        if (armUsed[side]) { note('dropped prop "' + p.type + '": both arms busy'); return; }
        armUsed[side] = 1;
        if (pose.arms.R === "cross") pose.arms.R = pose.arms.L = "down";
        pose.arms[side] = need;
        if (p.type === "book") p.side = side;
      }
      if (p.color != null) { var pc = roleColour(p.color); if (pc) p.color = pc; else delete p.color; }
      props.push(p);
    });

    /* ---- identity ---- */
    var spec = {
      id: idFor(npc), name: cleanName(npc.name) || "NPC", plate: plateFor(npc),
      code: codeFor(npc, facEntry && facEntry.code), halo: halo, heightIn: heightIn
    };
    if (fig === "fem") spec.figure = "fem";
    spec.shape = shape;
    if (heads != null) spec.heads = heads;
    if (buildN != null) spec.build = buildN;
    spec.skin = skin; spec.age = age;
    if (Object.keys(body).length) spec.body = body;
    spec.pose = pose;
    spec.head = { shape: head || "oval" };
    var jaw = numVal(feat.jaw, "jaw", 0.7, 1.4, 2); if (jaw) spec.head.jaw = jaw;
    spec.face = face;
    spec.hair = hair;
    spec.outfit = outfit;
    spec.props = props;
    if (isHull) note("Hull: drawn as a human figure (the kit has no Hull parts)");
    return { spec: spec, notes: notes };
  }

  /* ---------- retry ladder ---------- */
  function strip(spec, level) {
    var s = clone(spec) || {};
    level = level | 0;
    if (level >= 1) s.props = [];
    if (level >= 2 && s.outfit) Object.keys(s.outfit).forEach(function (k) { if (s.outfit[k]) delete s.outfit[k].pattern; });
    if (level >= 3) {
      if (s.hair) delete s.hair.hat;
      if (s.face) delete s.face.eyewear;
    }
    return s;
  }
  function check(spec, K) {
    var w = [];
    try { (K.render(spec, { height: 320 }).warnings || []).forEach(function (x) { w.push(x); }); } catch (e) { w.push("render threw: " + (e && e.message)); }
    try { (K.portrait(spec).warnings || []).forEach(function (x) { if (w.indexOf(x) < 0) w.push(x); }); } catch (e2) { w.push("portrait threw: " + (e2 && e2.message)); }
    return w;
  }

  /* ---------- nearest archetype ---------- */
  function fallbackArchetype(npc, K, Cast, F) {
    npc = npc || {}; F = isObj(F) ? F : {};
    var list = (Cast && Cast.npcs) || [];
    if (!list.length) return baseline(npc);
    var haystack = {
      presentation: low(npc.presentation), profession: low(npc.profession), register: low(npc.register), faction: low(npc.faction),
      build: low(npc.build), wears: low(npc.wears || [npc.garment, npc.accessory].filter(Boolean).join(", "))
    };
    var presHit = F.presentation && str(npc.presentation) ? lookup(F.presentation, npc.presentation) : null;
    var wantFig = presHit && typeof presHit.entry.figure === "string" ? presHit.entry.figure : /^fem/.test(haystack.presentation) ? "fem" : /^masc/.test(haystack.presentation) ? "masc" : null;
    var buildHit = F.build && str(npc.build) ? lookup(F.build, npc.build) : null;
    var wantShape = buildHit ? [].concat(buildHit.entry.shape || [])[0] : null;
    var rules = Array.isArray(F.archetypes) ? F.archetypes : [];
    var best = null, bestScore = -1;
    list.forEach(function (a, i) {
      var score = 0;
      var rule = rules.filter(function (x) { return x && x.id === a.id; })[0];
      if (rule && isObj(rule.match)) Object.keys(rule.match).forEach(function (field) {
        var hs = haystack[field] || "";
        if (!hs) return;
        [].concat(rule.match[field]).forEach(function (kw) { kw = low(kw); if (kw && hs.indexOf(kw) >= 0) score += 3; });
      });
      var afig = a.figure === "fem" ? "fem" : "masc";
      if (wantFig) score += afig === wantFig ? 2 : -4;
      if (wantShape && a.shape === wantShape) score += 1;
      score += (hash(str(npc.name) + "|" + a.id) % 1000) / 100000; // stable tie-break
      if (score > bestScore) { bestScore = score; best = a; }
    });
    var out = clone(best);
    delete out.notes;
    out.id = idFor(npc); out.name = cleanName(npc.name) || best.name; out.plate = plateFor(npc) || out.name;
    var facHit = F.faction && str(npc.faction) ? lookup(F.faction, npc.faction) : null;
    out.code = codeFor(npc, facHit && facHit.entry.code);
    if (facHit && facHit.entry.halo && (!K || mkOpts(K).colour(facHit.entry.halo))) out.halo = facHit.entry.halo;
    return out;
  }

  /* ---------- the whole ladder ---------- */
  function fit(npc, F, rngFn, K, Cast) {
    var m = map(npc, F, rngFn, K), spec = m.spec, notes = m.notes, tries = 0, w;
    if (!K) return { spec: spec, notes: notes, warnings: [], tries: 0, fallback: false };
    w = check(spec, K);
    while (w.length && tries < 3) {
      tries++;
      var cand = strip(m.spec, tries);
      var cw = check(cand, K);
      spec = cand; w = cw;
    }
    if (w.length) {
      var fb = fallbackArchetype(npc, K, Cast, F), fw = check(fb, K);
      notes.push("fell back to an archetype after " + tries + " retries: " + w.slice(0, 2).join("; "));
      return { spec: fb, notes: notes, warnings: fw, tries: tries, fallback: true };
    }
    if (tries) notes.push("retry level " + tries + " cleared the warnings");
    return { spec: spec, notes: notes, warnings: [], tries: tries, fallback: false };
  }

  var api = { map: map, fallbackArchetype: fallbackArchetype, strip: strip, fit: fit, check: check, parts: { splitWears: splitWears, plateFor: plateFor, codeFor: codeFor, idFor: idFor, lookup: lookup, hash: hash }, version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.B68GmFigureMap = api;
})(typeof window !== "undefined" ? window : globalThis);
