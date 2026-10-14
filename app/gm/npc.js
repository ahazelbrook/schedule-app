/* B68GmNpc — the NPC generator of the vault (Tools/blades-68-npc-generator.md), as pure logic.
   No DOM, no storage, no network, no table text: the tables arrive from the GM pack (part `npc`: T, cast, F) and the
   campaign context from part `campaign`. Plain script, UMD: window.B68GmNpc in the browser, module.exports under Node.

   generate() is ported statement for statement. The vault draws from one stream (Math.random, shadowed by a seeded
   mulberry32 while a roll replays), so here every draw comes from ONE seeded stream in the vault's order:
   the same { seed, mem } over the same tables and campaign gives the same NPC. (The vault's pickWeighted tests
   `r <= 0`; the console's tests `r < 0`. This file follows the generator.)

   ---------------------------------------------------------------------------------------------------------------
   API (the UI author reads only this block)
   ---------------------------------------------------------------------------------------------------------------
   const gen = B68GmNpc.create({ T, cast, campaign, F })
       T         pack.parts.npc.T          the generator's tables (required). T.telltaleHeritage is the heritage that rolls a
                                           telltale (the exporter lifts it from generate()). T.leverage[] is DATA here:
                                           { f, t: "...{v}...", lower?, head? } (the vault holds functions)
       cast      pack.parts.npc.cast       [{ n, status, pace, borrow, never }] anchor rows ([] = roll a status and dial)
       campaign  pack.parts.campaign       pcs[].file (character sheet file names) and npcs[].{name, faction, playedBy}
       F         pack.parts.npc.F          the figure map (or null). Passed untouched to the figure mapper.
       mem       optional repeat-guard memory ({ key: [recent values] }), kept by the instance between rolls
   gen.setCampaign(campaign)               swap the campaign (call it after the GM files a new NPC, see npcRecord)
   gen.mem()                               the instance's live repeat-guard memory

   gen.roll({ seed, mem }) -> { npc, card, seed, replay }
       seed    uint32; omitted: a fresh random one
       mem     the repeat-guard memory to use and MUTATE (default: the instance's)
       replay  { seed, mem, ui: {} }  mem is a deep copy of the memory as it was BEFORE this roll. To redraw a roll:
               gen.roll({ seed: replay.seed, mem: JSON.parse(JSON.stringify(replay.mem)) }). Same card, same npc.
       npc     the vault's own object: isHull, presentation, name, alias, heritage, familyWere, telltale, profession,
               district, faction, factionTier, factionHold, rank, quality, build, featuresLook, hairLook, mannerLook,
               standout, register, wears, chassis (Hull), tell, verb, cast (anchor row | null), status {n,d}, dial,
               traits [2], key, keyFlip, keyInt (or memory for a Hull), interest, quirk, goal, method, errand, vice,
               purveyor, threatKind, threat, leverage (text | null), attitude, attitudeDice
       card    { lines, meta }   (the shapes of B68GmConsole cards, plus `title` and `gm`)
         lines, in the vault's reading order:
           { kind:'read', id:'look',   md }            the look line (what the table could see)
           { kind:'read', id:'traits', md }            traits and interest
           { kind:'want', id:'want',   md }            goal, method, errand
           { kind:'grid', id:'play',   title, rows:[{k,md}] }   "How to play them": Cast, Status, Dial, Mannerism, Verb
           { kind:'chips', id:'chips', chips:[string] }          Quality N and the attitude
           { kind:'grid', id:'levers', title:'Levers', rows }     Leverage, Quirk, Key | Memory, Trouble, Vice, Roots
           { kind:'grid', id:'faction', title:<faction>, gm:true, collapsed:true, rows }   only when the faction has a
                                                       dossier in T.factionDetail (What, Turf, Who runs it, With,
                                                       Against, Right now, Secret, Page)
         meta: { id:'npc', title (name and "alias"), sub (the role line), chips, text, all:[plain lines], label,
                 isHull, figureNote (Hull only: "drawn as a human figure"), cast (anchor name | null) }
         md is markdown: **bold**, *italic*; never HTML.

   gen.figure(npc, { seed, K, map, archetypes })
                                   -> { spec, warnings, notes, tries, fallback }
       Builds a figure kit v2 spec for the NPC: its own random stream (seed defaults to a hash of the name), so the
       vault draws are never disturbed. K is the kit (window.B68Figure | require('../figures/figure-kit.js')).
       Contract with the figure map (app/gm/figure-map.js, package P3a), used when present:
           B68GmFigureMap.map(npc, F, rngFn, K) -> spec      (pure; rngFn is a () => [0,1) stream)
       `map` in opts overrides it (tests; `map: false` forces the internal map). When neither exists a conservative internal map is used: generic kit
       names only, picked from the stream, plus F.halo[faction] if F has it. In every case the identity fields
       (id, name, plate "Surname · F.", code, halo) are stamped last.
       Retry ladder: (1) names the kit does not know are dropped; the spec is rendered (render and portrait must both
       return no warnings); then (2) props stripped, (3) + textile patterns stripped, (4) + hat and eyewear stripped;
       then (5) the nearest archetype in B68Cast.npcs with the name swapped. `tries` counts the render checks made;
       `fallback` is true on (5). `warnings` is the kit's warnings for the FINAL spec (always [] unless even the
       archetype fails); `notes` says what was dropped or stripped. A Hull has no kit parts: it is drawn as a human
       figure, and the card's meta.figureNote says so.

   gen.noteBody(npc, { date, embed })    the saved NPC card, byte for byte the vault's format (date 'DD/MM/YYYY',
                                         default today). `embed` (optional) is one line, e.g. "![[Name.svg|160]]",
                                         placed after the role line (the portrait embed).
   gen.dossierLine(npc, { file })        "- [[<file>]] — profession, rank Faction\n" to append to the faction dossier,
                                         or null (no faction, or no dossier text in T.factionDetail). `file` is the
                                         saved note's basename (default safeName(name)).
   gen.dossier(npc, { date, file })      null | { slug, body, line }   slug is the dossier's file name without .md;
                                         body is the page to create if it does not exist (the vault's factionBody)
   gen.castDoc(npc, spec)                the hidden doc for POST /api/npcs: { name, alias, role:'', faction:'',
                                         description (the look line, plain), spec, revealed:false, firstSeen:null,
                                         tags:['generated'], gmNotes (how to play, levers, role: GM only) }
   gen.stateEntry(roll, { at, s })       the GM-state entry npcgen[id] = { seed, mem, at, s } that replays the roll
   gen.npcRecord(npc)                    the entry to push onto campaign.npcs once filed, so later rolls avoid its
                                         initial and its cast anchor: { name, role, faction, district, playedBy, ... }
   All of noteBody, dossierLine, dossier, castDoc, stateEntry, npcRecord are also on B68GmNpc itself (they need no
   tables except `dossier*`, which take T as opts.T). Also: B68GmNpc.seedRng(a), safeName(name), plateOf(npc).
   --------------------------------------------------------------------------------------------------------------- */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.B68GmNpc = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  // --- Seeded random: mulberry32, exactly the vault's __seed ----------------------------------------------------
  function seedRng(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var clone = function (o) { return JSON.parse(JSON.stringify(o == null ? {} : o)); };
  var isObj = function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v); };
  function fnv(s) {
    var h = 0x811c9dc5; s = String(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  function flat(a) { return [].concat.apply([], a); }
  function todayDMY(d) {
    d = d || new Date();
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  }
  var ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI'];
  var cap = function (t) { return t.charAt(0).toUpperCase() + t.slice(1); };
  var holdWord = function (h) { return h === 'S' ? 'Strong' : 'Weak'; };
  var facSlug = function (n) { return 'b68-' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
  var safeName = function (name) { return String(name).replace(/[\/:*?"<>|#^[\]]/g, '').trim() || 'Unnamed'; };
  function plain(s) {
    return String(s).replace(/<small>|<\/small>|<br>/g, ' ').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\s+/g, ' ').trim();
  }

  // --- Leverage shapes are data in the pack: { f, t: '...{v}...', lower?, head? } -------------------------------
  function applyLeverage(shape, v) {
    var x = String(v);
    if (shape.head) x = x.split(' — ')[0];
    if (shape.lower) x = x.toLowerCase();
    return shape.t.replace('{v}', function () { return x; });
  }

  // --- Pure card text (the vault's identity, role, describe, play, want, chips, rows) ---------------------------
  function identity(o) { return o.alias ? o.name + ' — "' + o.alias + '"' : o.name; }
  function role(o) {
    var fac = o.faction ? o.rank + ' ' + o.faction + ' (Tier ' + ROMAN[o.factionTier] + ', ' + holdWord(o.factionHold) + ')' : 'unaffiliated';
    return o.profession + ' · ' + fac + ' · ' + o.district;
  }
  function describe(o) {
    var look = o.isHull
      ? cap(o.chassis) + ' — wearing ' + o.wears + '.'
      : o.build + ', ' + o.featuresLook + ', ' + o.mannerLook + ' — with ' + o.hairLook + ', in ' + o.wears + ' *(' + o.register + ')*.' +
        ' ' + cap(o.standout) + '.';
    var read = o.traits[0] + ' and ' + o.traits[1].toLowerCase() + '. Into ' + o.interest.toLowerCase() + '.';
    return { look: look, read: read };
  }
  function play(o) {
    var r = [];
    if (o.cast) {
      var lc = function (t) { return t.charAt(0).toLowerCase() + t.slice(1); };
      r.push(['Cast', '**' + o.cast.n + '**. Borrow ' + lc(o.cast.borrow) + '. Never ' + lc(o.cast.never)]);
      r.push(['Status', o.status.n]);
    } else {
      r.push(['Status', o.status.n + ': ' + o.status.d]);
    }
    r.push(['Dial', o.dial]);
    r.push(['Mannerism', o.tell]);
    r.push(['Verb', '*' + o.verb + '*']);
    return r;
  }
  function want(o) { return 'Wants **' + o.goal + '**, by **' + o.method + '**. Right now: ' + o.errand.toLowerCase() + '.'; }
  function chips(o) {
    return ['Quality ' + o.quality + ' — roll ' + o.quality + 'd',
      o.attitude + ' — ' + o.attitudeDice.replace(/^roll /, '').replace(/ —.*$/, '')];
  }
  function rows(o) {
    var r = [];
    if (o.leverage) r.push(['Leverage', o.leverage]);
    r.push(['Quirk', o.quirk]);
    if (o.isHull) r.push(['Memory', 'A fragment of the life before — their people were ' + o.memory]);
    else r.push(['Key', '**' + o.key + '** → ' + o.keyFlip + ' *(flipped)* / ' + o.keyInt + ' *(intensified)*']);
    r.push(['Trouble', '*' + o.threatKind.replace(' threat', '') + '* — ' + o.threat]);
    if (!o.isHull) {
      r.push(['Vice', o.vice + ' — ' + o.purveyor]);
      r.push(['Roots', o.heritage + (o.telltale ? ' *(telltale: ' + o.telltale + ')*' : '') + ' — family were ' + o.familyWere]);
    }
    return r;
  }
  function factionRows(o, T) {
    var d = o.faction && T && T.factionDetail ? T.factionDetail[o.faction] : null;
    if (!d) return null;
    var r = [['What', d.what], ['Turf', d.turf], ['Who runs it', d.boss], ['With', d.with], ['Against', d.against], ['Right now', d.now]];
    if (d.secret) r.push(['Secret', '*' + d.secret + '*']);
    r.push(['Page', "*Blades '68* p." + d.p + ' · dossier: [[' + facSlug(o.faction) + ']]']);
    return r.filter(function (x) { return x[1] != null && x[1] !== ''; });
  }

  var PLAY_TITLE = "How to play them: do this, don't say it";
  var HULL_NOTE = 'Hull: the figure kit has no Hull parts, so the portrait is a human figure.';

  function cardOf(o, T) {
    var dsc = describe(o), ch = chips(o), pl = play(o), lv = rows(o), fr = factionRows(o, T);
    var kv = function (a) { return a.map(function (x) { return { k: x[0], md: x[1] }; }); };
    var lines = [
      { kind: 'read', id: 'look', md: dsc.look },
      { kind: 'read', id: 'traits', md: dsc.read },
      { kind: 'want', id: 'want', md: want(o) },
      { kind: 'grid', id: 'play', title: PLAY_TITLE, rows: kv(pl) },
      { kind: 'chips', id: 'chips', chips: ch },
      { kind: 'grid', id: 'levers', title: 'Levers', rows: kv(lv) }
    ];
    if (fr) lines.push({ kind: 'grid', id: 'faction', title: o.faction, gm: true, collapsed: true, rows: kv(fr) });
    var all = [identity(o), role(o), dsc.look, dsc.read, want(o)]
      .concat(pl.map(function (x) { return x[0] + ': ' + x[1]; }), ch, lv.map(function (x) { return x[0] + ': ' + x[1]; }))
      .map(plain);
    var meta = { id: 'npc', title: identity(o), sub: role(o), chips: ch, text: all[2], all: all, label: identity(o),
      isHull: !!o.isHull, cast: o.cast ? o.cast.n : null };
    if (o.isHull) meta.figureNote = HULL_NOTE;
    return { lines: lines, meta: meta };
  }

  // --- The saved note (the vault's noteBody) --------------------------------------------------------------------
  function noteBody(o, opts) {
    opts = opts || {};
    var today = opts.date || todayDMY(opts.now);
    var dsc = describe(o), ch = chips(o);
    var fm = [
      '---', 'wiki: entity', 'created: ' + today, 'updated: ' + today, 'quality: ' + o.quality, 'district: ' + o.district,
      o.faction ? 'faction: ' + o.faction : 'faction:', 'attitude: ' + o.attitude,
      o.cast ? 'played_by: ' + o.cast.n : 'played_by:', 'campaign: group',
      'tags:', '  - wiki/games', '  - wiki/blades-in-the-dark', '  - wiki/npc', '---', ''
    ].join('\n');
    return fm +
      '# ' + identity(o) + '\n\n' +
      '*' + role(o) + '*\n\n' +
      (opts.embed ? String(opts.embed) + '\n\n' : '') +
      '> [!quote] At a glance\n> ' + dsc.look + '\n> ' + dsc.read + '\n>\n> ' + want(o) + '\n\n' +
      '`' + ch[0] + '` · `' + ch[1] + '`\n\n' +
      '> [!example] How to play\n' +
      play(o).map(function (x) { return '> - **' + x[0] + '** ' + x[1]; }).join('\n') + '\n\n' +
      '## Say it out loud\n\n' +
      '*Write these before they speak. Twelve words or fewer each, and the obvious thing, ' +
      'not the clever one. One of them ends on a question to a PC by name.*\n\n' +
      '> ""\n\n> ""\n\n' +
      '## Levers\n\n' +
      rows(o).map(function (x) { return '- **' + x[0] + '** — ' + x[1]; }).join('\n') +
      "\n\n## What they're said to be\n\n" +
      "*Two things people say about them that don't agree. Fill these in the first time " +
      'they matter — contradictory reputations are more useful than a settled one.*\n\n- \n- \n' +
      '\n## In play\n\n*What they wanted from the crew, what they got, what they owe.*\n' +
      '\n---\n\nRolled from [[blades-68-npc-generator]]. Tables: *Blades \'68* v1.0.1 ' +
      'p.11–21 and p.432–435; *Blades in the Dark* pp.302–303.\n';
  }

  // --- The faction dossier (the vault's factionBody and the Save button's append) -------------------------------
  function dossierLine(o, opts) {
    opts = opts || {};
    if (!o.faction) return null;
    if (opts.T && !(opts.T.factionDetail && opts.T.factionDetail[o.faction])) return null;
    return '- [[' + (opts.file || safeName(o.name)) + ']] — ' + o.profession + ', ' + o.rank + ' ' + o.faction + '\n';
  }
  function dossierBody(o, opts) {
    opts = opts || {};
    var T = opts.T || {};
    var d = (T.factionDetail && T.factionDetail[o.faction]) || {};
    var today = opts.date || todayDMY(opts.now);
    return [
      '---', 'wiki: entity', 'created: ' + today, 'updated: ' + today, 'tier: ' + o.factionTier, 'hold: ' + holdWord(o.factionHold),
      'aliases:', '  - "' + o.faction + '"',
      'tags:', '  - wiki/games', '  - wiki/blades-in-the-dark', '  - wiki/faction', '---', ''
    ].join('\n') +
      '# ' + o.faction + '\n\n' +
      '*Tier ' + ROMAN[o.factionTier] + ', ' + holdWord(o.factionHold) + "* — *Blades '68* p." + (d.p || '?') + '\n\n' +
      (d.what ? '> [!quote] At a glance\n> ' + d.what + '\n>\n> **Right now:** ' + d.now + '\n\n' : '') +
      (d.turf ? '- **Turf** — ' + d.turf + '\n' : '') +
      (d.boss ? '- **Who runs it** — ' + d.boss + '\n' : '') +
      (d.with ? '- **With** — ' + d.with + '\n' : '') +
      (d.against ? '- **Against** — ' + d.against + '\n' : '') +
      (d.secret ? '- **Secret** — *' + d.secret + '*\n' : '') +
      '\n## Standing with the crew\n\n*Status, and what earned it. The live board is ' +
      '[[b68s-factions]]; this page is the dossier.*\n\n' +
      "\n## Who we've met\n\n" +
      '*Rolled NPCs from this faction, added automatically when saved.*\n\n';
  }
  function dossier(o, opts) {
    opts = opts || {};
    var T = opts.T || {};
    if (!o.faction || !(T.factionDetail && T.factionDetail[o.faction])) return null;
    return { slug: facSlug(o.faction), body: dossierBody(o, opts), line: dossierLine(o, opts) };
  }

  // --- The cast doc (hidden NPC for the app) --------------------------------------------------------------------
  function castDoc(o, spec) {
    var dsc = describe(o), ch = chips(o);
    var md = function (a) { return a.map(function (x) { return '- **' + x[0] + '** — ' + x[1]; }).join('\n'); };
    var notes = [
      '*' + role(o) + '*', '', want(o), dsc.read, '',
      '**How to play them** (do these, don\'t say them)',
      play(o).map(function (x) { return '- **' + x[0] + '** ' + x[1]; }).join('\n'), '',
      '**Levers**', md(rows(o)), '',
      '`' + ch[0] + '` · `' + ch[1] + '`'
    ];
    if (o.isHull) notes.push('', '*' + HULL_NOTE + '*');
    notes.push('', '*Rolled by the NPC generator.*');
    return {
      name: String(o.name).slice(0, 80), alias: o.alias ? String(o.alias).slice(0, 80) : '', role: '', faction: '',
      description: plain(dsc.look).slice(0, 2000), spec: spec || {}, revealed: false, firstSeen: null, tags: ['generated'],
      gmNotes: notes.join('\n').slice(0, 8000)
    };
  }
  function stateEntry(r, opts) {
    opts = opts || {};
    var e = { seed: r.seed >>> 0, mem: clone(r.replay.mem), at: opts.at || new Date().toISOString() };
    if (opts.s != null) e.s = opts.s;
    return e;
  }
  function npcRecord(o) {
    return { name: o.name, role: '', faction: o.faction || '', district: o.district, glance: '', say: [], playedBy: o.cast ? o.cast.n : '', mannerism: o.tell };
  }
  function plateOf(o) {
    if (o.isHull) return String(o.name);
    var parts = String(o.name).split(' ');
    var first = parts[0], last = parts.slice(1).join(' ');
    return last ? last + ' · ' + first.charAt(0).toUpperCase() + '.' : first;
  }

  // =============================================================================================================
  // The generator: generate() from the vault, on one seeded stream
  // =============================================================================================================
  function makeGenerate(T, CAST, campaign, rnd, MEM) {
    var POOL = {
      trait: flat(T.trait).concat(T.traitExtra),
      interest: flat(T.interest).concat(T.interestExtra),
      profession: flat(T.profession).concat(T.professionExtra),
      quirk: T.quirk.concat(T.quirkExtra)
    };
    var pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
    var d6 = function () { return 1 + Math.floor(rnd() * 6); };
    var oneIn = function (n) { return Math.floor(rnd() * n) === 0; };
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
    // Anchors already playing someone in this faction (campaign.npcs[].playedBy).
    function castTaken(faction) {
      if (!faction) return [];
      return (campaign.npcs || []).filter(function (n) { return n && n.faction === faction && n.playedBy; }).map(function (n) { return String(n.playedBy); });
    }
    // First letters already in the players' heads: every PC sheet (by file name) and every voiced NPC.
    function initialsInPlay() {
      var s = {};
      var add = function (base) { if (base) s[String(base).replace(/^The\s+/i, '').charAt(0).toUpperCase()] = true; };
      (campaign.pcs || []).forEach(function (p) { add(p.file || p.name); });
      (campaign.npcs || []).forEach(function (n) { if (n && n.playedBy) add(n.name); });
      return s;
    }
    function pickWeighted(list) {
      var r = rnd() * list.reduce(function (s, x) { return s + x.w; }, 0);
      for (var i = 0; i < list.length; i++) { r -= list[i].w; if (r <= 0) return list[i]; }
      return list[list.length - 1];
    }
    function pickN(a, n) {
      var c = a.slice(), out = [];
      while (out.length < n && c.length) out.push(c.splice(Math.floor(rnd() * c.length), 1)[0]);
      return out;
    }

    return function generate() {
      var o = {};
      o.isHull = oneIn(12);                        // about one NPC in twelve is a Hull

      // Presentation and name: 1-2 masculine, 3-4 feminine, 5-6 ambiguous
      if (o.isHull) {
        o.presentation = 'Hull';
        o.name = pick(T.hullDesig);
        o.alias = oneIn(3) ? fresh('alias', T.alias) : null;
      } else {
        var r = d6();
        o.presentation = r <= 2 ? 'masculine' : r <= 4 ? 'feminine' : 'ambiguous or concealed';
        var draw = function () { return r <= 2 ? fresh('nameMasc', T.nameMasc) : r <= 4 ? fresh('nameFem', T.nameFem) : fresh('nameAmb', T.nameAmb); };
        // Distinct initials: avoid the first letter of every PC and every NPC who already has a voice. Soft.
        var taken = initialsInPlay();
        var first = draw();
        for (var i = 0; i < 8 && taken[first[0].toUpperCase()]; i++) first = draw();
        o.name = first + ' ' + fresh('family', T.family);
        o.alias = oneIn(2) ? fresh('alias', T.alias) : null;
      }

      // Heritage: a Hull has no remembered past
      if (!o.isHull) {
        var h = pick(T.heritage);
        o.heritage = h.n;
        o.familyWere = pick(h.d);
        o.telltale = T.telltaleHeritage && h.n === T.telltaleHeritage ? pick(T.telltale) : null;
      }

      o.profession = fresh('profession', POOL.profession);
      o.district = fresh('district', T.district);

      // Faction. Quality tracks their faction's Tier, drifted one step either way.
      if (oneIn(3)) {
        o.faction = null;
        o.quality = 1 + Math.floor(rnd() * 2);
      } else {
        var f = fresh('faction', T.faction, function (x) { return x[0]; });
        o.faction = f[0]; o.factionTier = f[1]; o.factionHold = f[2];
        o.rank = fresh('rank', T.rank);
        var dr = d6();
        o.quality = Math.max(1, Math.min(6, f[1] + (dr <= 2 ? -1 : dr >= 5 ? 1 : 0)));
      }

      // Look
      if (o.isHull) {
        o.chassis = pickN(T.hullLook, 3).join(', ');
        o.wears = pick(T.hullWear);
      } else {
        o.build = fresh('build', T.build);
        o.featuresLook = fresh('features', T.features);
        // build and features can independently land on the same word: one extra draw breaks the collision
        if (o.featuresLook.toLowerCase() === o.build.toLowerCase()) {
          o.featuresLook = fresh('features', T.features);
        }
        o.hairLook = fresh('hair', T.hair);
        o.mannerLook = fresh('manner', T.manner);
        o.standout = fresh('standout', T.standout);
        var w = fresh('wearing', T.wearing, function (x) { return x.r; });
        o.register = w.r;
        // one defining garment, and usually one thing worn with it
        o.wears = pick(w.g) + (oneIn(3) ? '' : ', ' + pick(w.a));
      }

      // How to play them: Hulls too. A cast anchor brings its own status and pace.
      o.tell = fresh('tell', T.tell);
      o.verb = fresh('verb', T.verb);
      if (CAST.length) {
        var ctaken = castTaken(o.faction);
        var pool = CAST.filter(function (c) { return ctaken.indexOf(c.n) < 0; });
        o.cast = fresh('cast', pool.length ? pool : CAST, function (x) { return x.n; });
        o.status = { n: o.cast.status, d: '' };
        o.dial = 'Pace: ' + o.cast.pace.toLowerCase();
      } else {
        o.cast = null;
        o.status = pick(T.status);
        o.dial = fresh('dial', T.dial);
      }

      // Personality: two distinct traits
      var t1 = fresh('trait', POOL.trait);
      var t2 = fresh('trait', POOL.trait);
      for (var j = 0; j < 10 && t2 === t1; j++) t2 = fresh('trait', POOL.trait);
      o.traits = [t1, t2];
      if (o.isHull) {
        // No keys for a Hull: a memory clock is the equivalent handle
        o.memory = pick(pick(T.heritage).d);
      } else {
        var k = fresh('key', T.key, function (x) { return x[0]; });
        o.key = k[0]; o.keyFlip = k[1]; o.keyInt = k[2];
      }
      o.interest = fresh('interest', POOL.interest);
      o.quirk = fresh('quirk', POOL.quirk);
      o.goal = fresh('goal', T.goal);
      o.method = fresh('method', T.method);
      o.errand = fresh('errand', T.errand);

      if (!o.isHull) { var v = pick(T.vice); o.vice = v.n; o.purveyor = pick(v.p); }

      o.threatKind = oneIn(2) ? 'Physical threat' : 'Social threat';
      o.threat = o.threatKind === 'Physical threat' ? fresh('physThreat', T.physThreat) : fresh('socThreat', T.socThreat);

      // Leverage: a shape filled with a value this card has already rolled
      var shapes = T.leverage.filter(function (s) { return o[s.f]; });
      var shape = shapes.length ? fresh('leverage', shapes, function (x) { return x.f; }) : null;
      o.leverage = shape ? applyLeverage(shape, o[shape.f]) : null;

      var a = pickWeighted(T.attitude);
      o.attitude = a.n; o.attitudeDice = a.d;
      return o;
    };
  }

  // =============================================================================================================
  // Figures
  // =============================================================================================================
  function getKit(opts) {
    if (opts && opts.K) return opts.K;
    if (root && root.B68Figure) return root.B68Figure;
    try { if (typeof require === 'function') return require('../figures/figure-kit.js'); } catch (e) { /* none */ }
    return null;
  }
  function getArchetypes(opts) {
    if (opts && opts.archetypes) return opts.archetypes;
    if (root && root.B68Cast && root.B68Cast.npcs) return root.B68Cast.npcs;
    try { if (typeof require === 'function') return require('../figures/cast.js').npcs; } catch (e) { /* none */ }
    return [];
  }
  function getMapper(opts) {
    if (opts && typeof opts.map === 'function') return opts.map;
    if (opts && opts.map === false) return null;      /* force the conservative internal map */
    var m = root && root.B68GmFigureMap;
    if (!m) { try { if (typeof require === 'function') m = require('./figure-map.js'); } catch (e) { m = null; } }
    return m && typeof m.map === 'function' ? m.map : null;
  }

  // Which kit part kinds an outfit slot may hold.
  var SLOT_KINDS = { base: ['top'], mid: ['mid'], outer: ['outer'], neck: ['neckwear'], bottom: ['bottom'], dress: ['dress'],
    legs: ['legwear'], feet: ['footwear'], waist: ['belt'], hands: ['gloves'] };

  // Drop every name the kit does not know. Returns the notes (what was dropped).
  function dropUnknown(spec, O) {
    var notes = [];
    var has = function (list, v) { return Array.isArray(list) && list.indexOf(v) >= 0; };
    var typeOf = function (x) { return typeof x === 'string' ? x : x && x.type; };
    function chk(obj, key, list, label) {
      if (obj && obj[key] != null && !has(list, obj[key])) { notes.push('dropped ' + label + ' "' + obj[key] + '"'); delete obj[key]; }
    }
    function chkType(obj, key, list, label) {
      if (!obj || obj[key] == null) return;
      var t = typeOf(obj[key]);
      if (!has(list, t)) { notes.push('dropped ' + label + ' "' + t + '"'); delete obj[key]; }
    }
    if (spec.shape != null && !(O.shapes && Object.prototype.hasOwnProperty.call(O.shapes, spec.shape))) { notes.push('dropped shape "' + spec.shape + '"'); delete spec.shape; }
    chk(spec, 'skin', O.skins, 'skin');
    if (spec.body) chk(spec.body, 'type', O.body, 'body.type');
    if (spec.pose && isObj(spec.pose.arms)) ['R', 'L'].forEach(function (sd) {
      var v = spec.pose.arms[sd];
      if (v != null && !(O.armPoses && Object.prototype.hasOwnProperty.call(O.armPoses, v))) { notes.push('dropped pose.arms.' + sd + ' "' + v + '"'); spec.pose.arms[sd] = 'down'; }
    });
    if (spec.head) chk(spec.head, 'shape', O.head, 'head.shape');
    if (spec.face) {
      ['eyes', 'brows', 'nose', 'mouth', 'expression', 'ears'].forEach(function (k) { chk(spec.face, k, O[k], 'face.' + k); });
      chkType(spec.face, 'facialHair', O.facialHair, 'face.facialHair');
      chkType(spec.face, 'eyewear', O.eyewear, 'face.eyewear');
      chkType(spec.face, 'makeup', O.makeup, 'face.makeup');
      if (Array.isArray(spec.face.marks)) spec.face.marks = spec.face.marks.filter(function (m) {
        var ok = has(O.mark, typeOf(m)); if (!ok) notes.push('dropped face.marks "' + typeOf(m) + '"'); return ok;
      });
    }
    if (spec.hair) {
      if (typeof spec.hair === 'string') spec.hair = { style: spec.hair };
      chk(spec.hair, 'style', O.hair, 'hair.style');
      chkType(spec.hair, 'hat', O.hat, 'hair.hat');
    }
    if (spec.outfit) Object.keys(spec.outfit).forEach(function (slot) {
      var kinds = SLOT_KINDS[slot];
      if (!kinds) { notes.push('dropped outfit slot "' + slot + '"'); delete spec.outfit[slot]; return; }
      var names = flat(kinds.map(function (k) { return O[k] || []; }));
      var g = spec.outfit[slot];
      var t = typeOf(g);
      if (!has(names, t)) { notes.push('dropped outfit.' + slot + ' "' + t + '"'); delete spec.outfit[slot]; return; }
      if (isObj(g) && g.pattern != null && !has(O.textile, typeOf(g.pattern))) { notes.push('dropped outfit.' + slot + '.pattern'); delete g.pattern; }
    });
    if (Array.isArray(spec.props)) spec.props = spec.props.filter(function (p) {
      var ok = has(O.prop, typeOf(p)); if (!ok) notes.push('dropped prop "' + typeOf(p) + '"'); return ok;
    });
    if (spec.companion != null) chkType(spec, 'companion', O.companion, 'companion');
    return notes;
  }
  function stripProps(spec) { var had = Array.isArray(spec.props) && spec.props.length > 0 || !!spec.companion; spec.props = []; delete spec.companion; return had; }
  function stripPattern(spec) {
    var had = false;
    Object.keys(spec.outfit || {}).forEach(function (s) {
      var g = spec.outfit[s];
      if (isObj(g) && (g.pattern != null || g.block != null)) { delete g.pattern; delete g.block; had = true; }
    });
    return had;
  }
  function stripHat(spec) { var had = !!(spec.hair && spec.hair.hat); if (had) delete spec.hair.hat; return had; }
  function stripEyewear(spec) { var had = !!(spec.face && spec.face.eyewear); if (had) delete spec.face.eyewear; return had; }

  function stamp(spec, npc, seed) {
    spec.id = 'npc-' + String(npc.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    spec.name = npc.name;
    spec.plate = plateOf(npc);
    spec.code = 'NPC-968-' + String(seed % 10000).padStart(4, '0');
    return spec;
  }

  // A generic, conservative map: kit names only, drawn from the stream. F.halo[faction] sets the halo when present.
  function alpha(s) { return String(s).toLowerCase().replace(/[^a-z]/g, ''); }
  function kitMatch(phrase, names) {
    var p = alpha(phrase);
    for (var i = 0; i < (names || []).length; i++) {
      var a = alpha(names[i]), key = a.length > 4 ? a.slice(0, 4) : a;
      if (key.length >= 3 && p.indexOf(key) >= 0) return names[i];
    }
    return null;
  }
  function internalMap(npc, F, rng, K) {
    var O = K.options();
    var pickA = function (a) { return a[Math.floor(rng() * a.length)]; };
    var only = function (want, have) { var r = want.filter(function (x) { return have.indexOf(x) >= 0; }); return r.length ? r : have; };
    var fem = npc.presentation === 'feminine' ? true : npc.presentation === 'masculine' ? false : rng() < 0.5;
    var shapeNames = Object.keys(O.shapes || {});
    var cloth = O.cloth || [];
    var hairCols = only(['cloth-black', 'cloth-chocolate', 'cloth-brown', 'cloth-tobacco', 'cloth-ash', 'cloth-camel'], cloth);
    var spec = {
      figure: fem ? 'fem' : 'masc',
      heightIn: fem ? 59 + Math.floor(rng() * 11) : 63 + Math.floor(rng() * 13),
      shape: pickA(only(fem ? ['slim', 'hourglass', 'pear', 'oval', 'lean', 'column'] : ['lean', 'rect', 'invtri', 'column', 'oval', 'lanky'], shapeNames)),
      build: 0.9 + Math.floor(rng() * 5) * 0.06,
      skin: npc.isHull ? 'porcelain' : pickA(O.skins),
      age: 24 + Math.floor(rng() * 38),
      pose: { stance: pickA(['square', 'easy', 'wide']), weight: pickA(['R', 'L']),
        arms: { R: pickA(only(['down', 'pocket', 'hip', 'hold'], Object.keys(O.armPoses || {}))), L: pickA(only(['down', 'hip', 'behind'], Object.keys(O.armPoses || {}))) } },
      head: { shape: pickA(O.head) },
      face: { eyes: pickA(O.eyes), brows: pickA(O.brows), nose: pickA(O.nose), mouth: pickA(O.mouth),
        expression: pickA(only(['neutral', 'stern', 'smirk', 'tired', 'wary', 'smile', 'cool', 'amused'], O.expression)) },
      hair: { style: kitMatch(npc.hairLook || '', O.hair) || pickA(O.hair), color: pickA(hairCols) },
      outfit: {}, props: []
    };
    var fh = !fem && kitMatch(npc.hairLook || '', O.facialHair);
    if (fh) spec.face.facialHair = { type: fh, color: spec.hair.color };
    var look = String(npc.standout || '') + ' ' + String(npc.featuresLook || '');
    if (/glasses|monocle|spectacle/i.test(look)) spec.face.eyewear = { type: pickA(only(['round-wire', 'square-thick', 'browline'], O.eyewear)) };
    if (/scar/i.test(look)) spec.face.marks = [{ type: 'scar' }];
    var feet = { type: pickA(only(fem ? ['heels', 'mary-janes', 'loafers'] : ['oxfords', 'chelsea-boots', 'loafers'], O.footwear)), color: 'cloth-black' };
    if (fem && rng() < 0.5) {
      spec.outfit = { dress: { type: pickA(only(['shift-dress', 'a-line-dress'], O.dress)), color: pickA(cloth) }, feet: feet };
    } else {
      spec.outfit = {
        base: { type: pickA(only(['shirt', 'blouse', 'turtleneck', 'knit', 'polo'], O.top)), color: pickA(cloth) },
        bottom: { type: pickA(only(fem ? ['trousers', 'a-line-skirt', 'pencil-skirt'] : ['trousers', 'slacks', 'jeans'], O.bottom)), color: pickA(cloth) },
        feet: feet
      };
      if (rng() < 0.4) spec.outfit.outer = { type: pickA(only(['blazer', 'suit-jacket', 'peacoat', 'overcoat'], O.outer)), color: pickA(cloth) };
    }
    var h = F && F.halo && isObj(F.halo) ? (F.halo[npc.faction || ''] || F.halo['']) : null;
    spec.halo = typeof h === 'string' ? h : 'file-500';
    return spec;
  }

  function checkSpec(K, spec) {
    var w = [];
    var a = K.render(spec), b = K.portrait(spec);
    (a.warnings || []).forEach(function (x) { w.push('render: ' + x); });
    (b.warnings || []).forEach(function (x) { w.push('portrait: ' + x); });
    return w;
  }

  // The nearest archetype by figure, shape, height, skin and age.
  function nearestArchetype(spec, list, npc) {
    var fig = (spec && spec.figure) || (npc && npc.presentation === 'feminine' ? 'fem' : 'masc');
    var hIn = spec && isFinite(spec.heightIn) ? +spec.heightIn : null, age = spec && isFinite(spec.age) ? +spec.age : null;
    var best = null, bestScore = Infinity;
    list.forEach(function (a) {
      var s = (((a.figure || 'masc') === fig) ? 0 : 20) +
        (spec && spec.shape && a.shape === spec.shape ? 0 : 3) +
        (hIn ? Math.abs((a.heightIn || 68) - hIn) / 2 : 0) +
        (spec && spec.skin && a.skin === spec.skin ? 0 : 1) +
        (age ? Math.abs((a.age || 40) - age) / 10 : 0);
      if (s < bestScore) { bestScore = s; best = a; }
    });
    return best;
  }
  function fromArchetype(arch, npc, seed, spec) {
    var out = clone(arch);
    delete out.archetype; delete out.notes;
    if (npc.presentation === 'feminine' && !out.figure) out.figure = 'fem';
    stamp(out, npc, seed);
    if (spec && typeof spec.halo === 'string' && !out.halo) out.halo = spec.halo;
    if (!out.halo) out.halo = 'file-500';
    return out;
  }

  function figure(npc, F, opts) {
    opts = opts || {};
    var K = getKit(opts);
    if (!K) throw new Error('B68GmNpc.figure: the figure kit is not loaded (pass opts.K)');
    var seed = opts.seed != null ? opts.seed >>> 0 : fnv(npc.name);
    var rng = seedRng((seed ^ 0x9E3779B9) >>> 0);
    var O = K.options();
    var notes = [], tries = 0, spec = null;
    var mapper = getMapper(opts);
    try {
      spec = mapper ? mapper(npc, F || null, rng, K) : internalMap(npc, F || null, rng, K);
      if (isObj(spec) && isObj(spec.spec)) spec = spec.spec;     /* B68GmFigureMap.map returns { spec, notes }; a test's map may return the spec itself */
      if (!isObj(spec)) { notes.push('the map returned no spec'); spec = null; }
    } catch (e) { notes.push('the map threw: ' + (e && e.message || e)); spec = null; }

    var last = [];
    if (spec) {
      spec = clone(spec);
      notes = notes.concat(dropUnknown(spec, O));
      stamp(spec, npc, seed);
      if (!spec.halo) spec.halo = 'file-500';
      var ladder = [
        function () { return true; },
        function () { var h = stripProps(spec); if (h) notes.push('stripped props'); return h; },
        function () { var h = stripPattern(spec); if (h) notes.push('stripped patterns'); return h; },
        function () { var a = stripHat(spec), b = stripEyewear(spec); if (a) notes.push('stripped hat'); if (b) notes.push('stripped eyewear'); return a || b; }
      ];
      for (var i = 0; i < ladder.length; i++) {
        if (!ladder[i]()) continue;                    // nothing to strip at this rung: skip the render
        tries++;
        try { last = checkSpec(K, spec); } catch (e) { last = ['render threw: ' + (e && e.message || e)]; }
        if (!last.length) return { spec: spec, warnings: [], notes: notes, tries: tries, fallback: false };
      }
      if (last.length) notes.push('kit warnings: ' + last.slice(0, 3).join(' | ').slice(0, 300));
    }

    // Last rung: the nearest archetype, name swapped.
    var list = getArchetypes(opts);
    var arch = nearestArchetype(spec, list, npc);
    if (!arch) return { spec: spec || {}, warnings: last.length ? last : ['no figure spec and no archetypes'], notes: notes, tries: tries, fallback: true };
    var fb = fromArchetype(arch, npc, seed, spec);
    var w = [];
    try { w = checkSpec(K, fb); } catch (e) { w = ['render threw: ' + (e && e.message || e)]; }
    notes.push('fell back to an archetype');
    return { spec: fb, warnings: w, notes: notes, tries: tries, fallback: true };
  }

  // =============================================================================================================
  // create()
  // =============================================================================================================
  function create(cfg) {
    cfg = cfg || {};
    var T = cfg.T;
    if (!T || !Array.isArray(T.leverage) || !T.attitude) throw new Error('B68GmNpc.create: cfg.T (the pack\'s npc.T) is required');
    var CAST = Array.isArray(cfg.cast) ? cfg.cast : [];
    var F = cfg.F || null;
    var campaign = cfg.campaign || {};
    var MEM = isObj(cfg.mem) ? cfg.mem : {};

    function roll(o) {
      o = o || {};
      var seed = o.seed != null ? o.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
      var mem = isObj(o.mem) ? o.mem : MEM;
      var before = clone(mem);
      var npc = makeGenerate(T, CAST, campaign, seedRng(seed), mem)();
      return { npc: npc, card: cardOf(npc, T), seed: seed, replay: { seed: seed, mem: before, ui: {} } };
    }
    return {
      roll: roll,
      figure: function (npc, o) { return figure(npc, F, o); },
      setCampaign: function (c) { campaign = c || {}; },
      mem: function () { return MEM; },
      noteBody: noteBody,
      dossierLine: function (npc, o) { return dossierLine(npc, Object.assign({ T: T }, o)); },
      dossier: function (npc, o) { return dossier(npc, Object.assign({ T: T }, o)); },
      castDoc: castDoc,
      stateEntry: stateEntry,
      npcRecord: npcRecord
    };
  }

  return {
    create: create, seedRng: seedRng, safeName: safeName, plateOf: plateOf, facSlug: facSlug,
    noteBody: noteBody, dossierLine: dossierLine, dossier: dossier, castDoc: castDoc, stateEntry: stateEntry, npcRecord: npcRecord,
    figure: figure, fromArchetype: fromArchetype, nearestArchetype: nearestArchetype,
    applyLeverage: applyLeverage, describe: describe, play: play, rows: rows, role: role, identity: identity, plain: plain
  };
});
