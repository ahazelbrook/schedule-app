/* B68GmScore — the score generator, as pure logic: the outline of a heist for the GM to run (a client, a target, an operation, a
   place, why now, a twist, the ways in, the pay), rolled for inspiration when the players are lost, have a rough idea, or an NPC
   asks for a favour. No DOM, no storage, no network, NO TABLE TEXT: every word a card shows comes from the pack's tables (part
   `score`: T), from the campaign (part `campaign`) or from the GM's choices; this file adds only connecting words and neutral
   fallbacks. Plain script, UMD: window.B68GmScore in the browser, module.exports under Node. ES5 on purpose (older iPads).

   There is no vault twin to keep in parity (the machinery is designed here); the vault page only holds the tables.

   Every SECTION of a roll draws from its own seeded mulberry32 stream, seedRng(fnv(seed + ':' + section + ':' + bump)), and its
   repeat guard lives under keys that start with the section's name. So one row can be rolled again (bump + 1) without any other
   section's draw moving, and a row's pick never changes another row's pool. Sections, in the order a roll reads them (a later
   one may read an earlier one):
     crew     the crew type and Tier (no draw: the GM's choice, else the table's)
     lead     about 40%: a crew opportunity seed that fits the GM's choices becomes the pitch
     job      the GM's, else one of the seed's operations, else the crew's favoured ones about 60%, else any
     client   when the GM set it (an NPC, a faction, a kind, nobody); otherwise drawn AFTER the target
     target   the GM's; an enemy; someone on bad terms; the client's rivals about 70%; else weighted toward a winnable Tier
     client   (on any) a faction against the target about 40%, a client kind about 45%, nobody about 15%
     asset    an asset kind the job suits, then a noun phrase from that kind
     site     one of the target's holdings about 50%, else a building type for the asset kind; the district; the obvious way in
     why      urgency (some rows carry a danger clock)
     twist    one of the twist lists' entries, its {tokens} read against the campaign
     threat   one physical and one social threat
     pay      the dice, the scope, who pays
     extra    a Called Shot and its value, what it costs even if it goes well, what it also earns, a danger clock
   Target weights, by the target's Tier less the crew's: 1 or less 3, 2 is 2, 3 is 1, 4 or more 0.3; a faction the crew's sheet
   names as an enemy is worth the larger of three times that and 6, one on bad terms the larger of twice that and 4.

   ---------------------------------------------------------------------------------------------------------------
   API (the UI author reads only this block)
   ---------------------------------------------------------------------------------------------------------------
   const gen = B68GmScore.create({ T, campaign, mem })
       T         pack.parts.score.T (required). The tables; the schema is the design page's ("The table schema"):
                 crew { <type>: { p, ops[], seeds[{ t, ops[], enemy, kind? }], enemyPhrase, pays[], note[{ ability, minGap, say }] } }
                 op { <name>: { verb ("... {A} ..."), def, kinds[], ways[], loud, clock[] } }, asset { <kind>: [phrase] },
                 site { <kind>: [building type] }, why [[text, clock, size]], twist [[list, [entry]]], client [[list, [entry]]],
                 approach [[name, gloss]], calledShot [[entry] x3: the lists are worth 1, 2 and 3 stacks], scope [[threshold, text]],
                 physThreat / socThreat [[name, text]], faction [[name, tier, "S"|"W"]]; optional: holding, vector, cost, earns,
                 districtRule, and loc (laid over by `npm run gm:pack` from the location part: factionDetail, factionThumb,
                 district[], gaz { <district>: { factions[], notables[] } }, targetNames[]). Faction and district names are matched
                 across tables without case, a leading "the" or punctuation.
       campaign  pack.parts.campaign: crew { type, tier, enemies[], abilities[] } (or null), standing [{ faction, status }],
                 pcs [{ first, friend[], rival[] }], npcs [{ name }]. Everything is optional.
       mem       optional repeat-guard memory ({ key: [a short hash of each recent pick] }), kept by the instance between rolls
   gen.setCampaign(campaign)               swap the campaign
   gen.mem()                               the instance's live repeat-guard memory

   gen.controls(ctx, ui) -> [select specs]  ctx = { crew: { type, tier, enemies[], abilities[] }, npcs: [{ key, group, name,
       faction, district, role, want }], nowIn }; ui (optional) is the panel's current choices, so the Job group follows a crew
       the GM picked. A spec is { id, label, type: 'select', groups: [{ label, options: [{ value, label }] }], options: [every
       option, flat] }; a group with label '' is not an optgroup. In this order:
         client    "Who's asking": any '', nobody '-', then each NPC group as ctx.npcs gives it ('npc:<key>'), Factions
                   ('fac:<name>'), Kinds ('kind:<list name>')
         target    any '', 'enemy' (only when the crew has enemies), 'foe' (only when the campaign's standing holds a status of -1
                   or worse for a faction the tables know), then the factions with their Tier ('fac:<name>')
         job       any '', the crew's favoured operations, all operations (by name)
         district  '' where the target is, 'now' Now in: <ctx.nowIn>, '*' anywhere, then the location part's district names
         crew      '' the table's crew, then the crew types
         tier      '' the table's Tier, then 0-6
   gen.defaults(ctx)                       { client: '', who: null, target: '', job: '', district: '', crew: '', tier: '', nowIn: '' }
   gen.cleanUi(ui)                         the choices with anything the tables do not hold dropped:
       client    '' | '-' | 'npc:<key>' (with who) | 'fac:<name>' | 'kind:<list>'
       who       an NPC client's { name, faction, district, role, want }, the strings the page resolved when it was picked, so a
                 replay never depends on a list that changed (null unless client is 'npc:...')
       target    '' | 'enemy' | 'foe' | 'fac:<name>'      job   '' | an operation
       district  '' | '*' | 'now' | a district            crew  '' | a crew type      tier  '' | 0-6
       nowIn     the district Now in is, in the location part's spelling, or '' (used for 'now', and when no district lists the target)
   gen.roll({ seed, mem, ui, bump }) -> { score, card, seed, replay, memAfter }
       seed    uint32; omitted: a fresh random one
       mem     the repeat-guard memory to use and MUTATE (default: the instance's); memAfter is that object
       ui      the choices above; bump  { <section>: n } how many times each section was rolled again (default none)
       replay  { seed, mem, ui, bump }: mem is a deep copy of the memory as it was BEFORE this roll, ui the choices as cleaned with
               crew and tier resolved (so a replay does not follow the table), bump a copy. gen.replay(replay) redraws it.
   gen.replay(replay)                      the same score and card
   gen.reroll(replay, row)                 the same seed, a deep copy of replay.mem, the same ui, bump[row] + 1. The result is a roll:
                                           its replay.mem is the same as replay's, its replay.bump has the one change. Rows: 'lead'
                                           (or 'pitch'), 'client', 'job', 'target', 'site' (or 'where'), 'why', 'twist', 'pay'.
                                           Everything that reads the row follows (a new target brings a new place, new friends of
                                           the target, new pay); nothing before it in the order above moves. The new stream can land
                                           on the same pick (the guard looks at earlier rolls, not at this one).
   score   the roll as data: { crew, seed (the lead seed or null), pitch, objective, op, client { type: 'npc'|'faction'|'kind'|
           'nobody', name, faction, ... }, target { name, tier, hold, boss, enemy, foe }, asset, site { type, place, district },
           ways[], why, twist, threats, pay { dice, zero, total, scope, payer }, shot { text, value }, cost, earns, clock { name,
           size }, engage { gap, factor, notes[], district }, rule, locks { client, lead, job, target } }; op.book is op.def with the crew's
           enemy phrase read as the target; a faction client carries atOdds (it is in the target's against list)
   card    { lines, meta }   the shapes of the other generators' cards:
       lines   { kind:'chips', id:'chips', chips }
               { kind:'want', id:'lead', md, reroll:true }                           the pitch
               { kind:'grid', id:'score', rows:[{ k, md, id, reroll }] }            Who's asking, The job, Target, Where, Why now,
                                                                                     Twist, Ways in, Pays (reroll false on Ways in,
                                                                                     and on a row that cannot move: the GM fixed it,
                                                                                     or the tables leave one choice, as a seed that
                                                                                     names a single operation does)
               { kind:'grid', id:'cloud', title:'The cloud', collapsed:true, rows } By the book (the operation's definition, the
                                                                                     crew's enemy phrase read as the target), In the
                                                                                     way, Their friends, Right now, Secret, Clock,
                                                                                     Engagement, Called Shot, Even if it goes well,
                                                                                     Also earns, District (a row the tables cannot
                                                                                     fill is left out)
               md is markdown (**bold**, *italic*), never HTML; the page escapes.
       meta    { id:'score', title ("<operation> · <target>"), sub ("Tier <roman> · <district> · <n> stacks, <scope>"), chips, text
               (the pitch), all [plain lines for Copy, Pin and L], label (short, for Earlier and L) }

   Helpers on B68GmScore (each takes the `score` of a roll):
     cardEntry(score)   { from: 'GM', client, target: "<name> (<roman>)", type, note, payout: "<n> stacks" }: the Cards panel's
                        index card, every field 120 characters at most
     siteHints(score)   { target: <building type>, district, faction: <the target>, approach: <the first way in> } (Location's pickers)
     npcHints(score)    { faction, district } (the NPC generator's pickers): the client's faction, else the target's when nobody asks
     clockOf(score)     { name, size }: the danger clock
   B68GmScore.check(T) -> [string]   the table keys a pack is missing or has empty ('crew', 'op.<name>.verb', 'asset.<kind>',
       'crew.<type>.ops.<name>' for an operation that is not in T.op, 'op.<name>.kinds.<kind>' for a kind that is not in T.asset,
       …), for the page to show when a pack is loaded. Empty = the pack is complete. T.loc, T.holding, T.vector, T.cost, T.earns
       and T.districtRule are optional.
   Also: B68GmScore.seedRng(a), fnv(s), fkey(name), plain(md), ROWS (row -> section).
   --------------------------------------------------------------------------------------------------------------- */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.B68GmScore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --- Seeded random: mulberry32, as the other generators ----------------------------------------------------------------
  function seedRng(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function fnv(s) {
    var h = 0x811c9dc5; s = String(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  }
  var clone = function (o) { return JSON.parse(JSON.stringify(o == null ? {} : o)); };
  var isObj = function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v); };
  var str = function (v) { return typeof v === 'string' ? v : v == null ? '' : String(v); };
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var arr = function (a) { return Array.isArray(a) ? a : []; };
  var strs = function (a) { return arr(a).map(str).map(function (x) { return x.trim(); }).filter(Boolean); };
  var ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI'];
  var cap = function (t) { t = str(t); return t.charAt(0).toUpperCase() + t.slice(1); };
  var numeric = function (v) { return typeof v === 'number' ? isFinite(v) : typeof v === 'string' && v.trim() !== '' && isFinite(Number(v)); };
  var tierOf = function (v) { return numeric(v) ? Math.max(0, Math.min(6, Math.round(Number(v)))) : null; };
  var romanOf = function (t) { return t === null || t === undefined || t === '' ? '?' : ROMAN[t] || String(t); };
  var holdWord = function (h) { h = str(h); return h === 'S' ? 'strong' : h === 'W' ? 'weak' : h.toLowerCase(); };
  var signed = function (n) { return n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0'; };
  var stacks = function (n) { return n + (n === 1 ? ' stack' : ' stacks'); };
  // a faction (or district) name as the tables compare it: no case, no leading "the", no punctuation
  function fkey(s) { return str(s).toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ''); }
  // the same name as words, to find a name inside a sentence
  function words(s) { return ' ' + str(s).toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim() + ' '; }
  function plain(s) { return str(s).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\s+/g, ' ').trim(); }
  // text cut at a word to n characters at most, ending in an ellipsis
  function cut(s, n) {
    s = str(s).replace(/\s+/g, ' ').trim();
    if (s.length <= n) return s;
    var c = s.slice(0, n - 1), sp = c.lastIndexOf(' ');
    return (sp > n * 0.5 ? c.slice(0, sp) : c).replace(/[\s,;:.·–—-]+$/, '') + '…';
  }
  // a name read after "'s" ("Harbour Board's"), and in mid-sentence ("the Brass Lantern")
  var possessive = function (n) { n = str(n); return /s$/i.test(n) ? n + "'" : n + "'s"; };
  var midName = function (n) { return str(n).replace(/^The\s+/, 'the '); };
  // a row of markdown with no words in it (only markers and separators)
  var blank = function (md) { return !str(md).replace(/[\s*:·]+/g, ''); };

  // The rows that can be rolled again, and the section each one is (the pitch is the lead; "where" is the site)
  var ROWS = { lead: 'lead', pitch: 'lead', client: 'client', job: 'job', target: 'target', site: 'site', where: 'site', why: 'why', twist: 'twist', pay: 'pay' };
  var SECTIONS = ['lead', 'job', 'client', 'target', 'asset', 'site', 'why', 'twist', 'threat', 'pay', 'extra'];

  // --- check(): the keys a roll reads, reported when missing or empty -----------------------------------------------------
  function check(T) {
    if (!isObj(T)) return ['T'];
    var miss = [], need = function (k, ok) { if (!ok) miss.push(k); };
    var filled = function (x) { return x != null && String(x).trim() !== ''; };
    var rows = function (a, ok) { return Array.isArray(a) && a.length > 0 && a.every(ok || filled); };
    var pair = function (x) { return Array.isArray(x) && filled(x[0]) && filled(x[1]); };
    var ops = isObj(T.op) ? Object.keys(T.op) : [];
    var kinds = isObj(T.asset) ? Object.keys(T.asset) : [];
    // crew: the favoured operations and the seeds' operations must be operations the tables define
    need('crew', isObj(T.crew) && Object.keys(T.crew).length > 0);
    Object.keys(isObj(T.crew) ? T.crew : {}).forEach(function (type) {
      var c = T.crew[type], at = 'crew.' + type;
      if (!isObj(c)) { miss.push(at); return; }
      need(at + '.ops', rows(c.ops));
      arr(c.ops).forEach(function (o) { if (ops.indexOf(o) < 0) miss.push(at + '.ops.' + o); });
      if (c.seeds !== undefined) {
        need(at + '.seeds', Array.isArray(c.seeds) && c.seeds.every(function (s) { return isObj(s) && filled(s.t); }));
        arr(c.seeds).forEach(function (s, i) {
          if (!isObj(s)) return;
          arr(s.ops).forEach(function (o) { if (ops.indexOf(o) < 0) miss.push(at + '.seeds.' + i + '.ops.' + o); });
          if (filled(s.kind) && kinds.indexOf(s.kind) < 0) miss.push(at + '.seeds.' + i + '.kind.' + s.kind);
        });
      }
    });
    need('op', ops.length > 0);
    ops.forEach(function (name) {
      var o = T.op[name], at = 'op.' + name;
      if (!isObj(o)) { miss.push(at); return; }
      need(at + '.verb', typeof o.verb === 'string' && (o.verb.match(/\{A\}/g) || []).length === 1);
      need(at + '.def', filled(o.def));
      need(at + '.kinds', rows(o.kinds));
      arr(o.kinds).forEach(function (k) { if (kinds.indexOf(k) < 0) miss.push(at + '.kinds.' + k); });
      need(at + '.ways', rows(o.ways));
    });
    need('asset', kinds.length > 0);
    kinds.forEach(function (k) { need('asset.' + k, rows(T.asset[k])); });
    need('site', isObj(T.site) && Object.keys(T.site).length > 0);
    // a kind some operation uses needs buildings to put it in
    var used = {}; ops.forEach(function (n) { if (isObj(T.op[n])) arr(T.op[n].kinds).forEach(function (k) { used[k] = true; }); });
    Object.keys(used).forEach(function (k) { if (isObj(T.site) && !rows(T.site[k])) miss.push('site.' + k); });
    need('why', rows(T.why, function (w) { return Array.isArray(w) && filled(w[0]); }));
    need('twist', rows(T.twist, function (t) { return Array.isArray(t) && filled(t[0]) && rows(t[1]); }));
    need('client', rows(T.client, function (t) { return Array.isArray(t) && filled(t[0]) && rows(t[1]); }));
    need('approach', rows(T.approach, pair));
    need('calledShot', rows(T.calledShot, function (l) { return rows(l); }));
    need('scope', rows(T.scope, function (s) { return Array.isArray(s) && numeric(s[0]) && filled(s[1]); }));
    need('physThreat', rows(T.physThreat, pair));
    need('socThreat', rows(T.socThreat, pair));
    need('faction', rows(T.faction, function (f) { return Array.isArray(f) && filled(f[0]) && numeric(f[1]); }));
    // the optional tables, when present, must be shaped (a half-written one is worse than none)
    if (T.vector !== undefined) need('vector', isObj(T.vector) && Object.keys(T.vector).every(function (k) { return rows(T.vector[k]); }));
    if (T.cost !== undefined) need('cost', rows(T.cost));
    if (T.earns !== undefined) need('earns', rows(T.earns));
    if (T.holding !== undefined) need('holding', isObj(T.holding) && Object.keys(T.holding).every(function (k) { return rows(T.holding[k], function (h) { return Array.isArray(h) && filled(h[0]) && filled(h[1]); }); }));
    return miss;
  }

  // --- The tables, indexed once ---------------------------------------------------------------------------------------------
  function model(T) {
    var M = { T: T };
    M.fac = arr(T.faction).filter(function (r) { return Array.isArray(r) && str(r[0]).trim(); })
      .map(function (r) { return { name: str(r[0]), tier: tierOf(r[1]), hold: str(r[2]), key: fkey(r[0]) }; });
    M.facBy = {}; M.fac.forEach(function (f) { if (!has(M.facBy, f.key)) M.facBy[f.key] = f; });
    M.crewKeys = Object.keys(isObj(T.crew) ? T.crew : {});
    M.opKeys = Object.keys(isObj(T.op) ? T.op : {});
    var L = isObj(T.loc) ? T.loc : {};
    M.dossier = {};
    Object.keys(isObj(L.factionDetail) ? L.factionDetail : {}).forEach(function (k) { if (isObj(L.factionDetail[k])) M.dossier[fkey(k)] = L.factionDetail[k]; });
    M.districts = strs(L.district);
    if (!M.districts.length && isObj(L.gaz)) M.districts = Object.keys(L.gaz);
    M.gaz = {};
    M.districts.forEach(function (d) {
      var g = isObj(L.gaz) ? L.gaz[d] : null;
      if (!isObj(g)) return;
      var fs = Array.isArray(g.factions) ? g.factions : str(g.factions).split(',');
      M.gaz[fkey(d)] = { factions: fs.map(fkey).filter(Boolean), notables: strs(g.notables) };
    });
    M.holding = {};
    Object.keys(isObj(T.holding) ? T.holding : {}).forEach(function (k) { M.holding[fkey(k)] = arr(T.holding[k]).filter(function (h) { return Array.isArray(h) && str(h[0]).trim() && str(h[1]).trim(); }); });
    M.rule = {};
    Object.keys(isObj(T.districtRule) ? T.districtRule : {}).forEach(function (k) { if (isObj(T.districtRule[k])) M.rule[fkey(k)] = T.districtRule[k]; });
    M.targetNames = strs(L.targetNames);
    // who is against whom, read from the dossiers: a faction's "against" text names its rivals, and a rival names it back
    M.against = {};
    M.fac.forEach(function (f) { M.against[f.key] = []; });
    M.fac.forEach(function (f) {
      var d = M.dossier[f.key], txt = d ? words(d.against) : '';
      if (!txt.trim()) return;
      M.fac.forEach(function (g) {
        if (g.key === f.key || txt.indexOf(words(g.name)) < 0) return;
        if (M.against[f.key].indexOf(g) < 0) M.against[f.key].push(g);
        if (M.against[g.key].indexOf(f) < 0) M.against[g.key].push(f);
      });
    });
    return M;
  }
  // a crew type as the tables spell it, however a sheet spells it (case, spaces, punctuation)
  var crewKeyOf = function (M, k) { var q = fkey(k); return q ? M.crewKeys.filter(function (c) { return fkey(c) === q; })[0] || '' : ''; };
  var clientList = function (M, name) { return arr(M.T.client).filter(function (c) { return Array.isArray(c) && str(c[0]) === name; })[0] || null; };
  function distOf(M, name) { var k = fkey(name); return k ? M.districts.filter(function (d) { return fkey(d) === k; })[0] || '' : ''; }
  function facOf(M, name) { return M.facBy[fkey(name)] || null; }
  function targetDistricts(M, f) { return M.districts.filter(function (d) { var g = M.gaz[fkey(d)]; return g && g.factions.indexOf(f.key) >= 0; }); }
  // the factions the crew's sheet names as enemies, and the ones the board has on bad terms, as the tables know them
  function crewEnemies(M, crew) { var out = []; strs(crew && crew.enemies).forEach(function (n) { var f = facOf(M, n); if (f && out.indexOf(f) < 0) out.push(f); }); return out; }
  function standingFoes(M, campaign) {
    var out = [];
    arr(campaign.standing).forEach(function (s) {
      if (!isObj(s) || !(Number(s.status) <= -1)) return;
      var f = facOf(M, s.faction); if (f && out.indexOf(f) < 0) out.push(f);
    });
    return out;
  }

  // --- The GM's choices --------------------------------------------------------------------------------------------------------
  var NONE = '-', ANY_DISTRICT = '*', NOW = 'now';
  function cleanUi(M, ui) {
    ui = isObj(ui) ? ui : {};
    var s = function (v, n) { return typeof v === 'string' ? v.trim().slice(0, n || 200) : ''; };
    var out = { client: '', who: null, target: '', job: '', district: '', crew: '', tier: '', nowIn: '' };
    var c = s(ui.client), f;
    if (c === NONE) out.client = NONE;
    else if (c.indexOf('npc:') === 0 && isObj(ui.who) && s(ui.who.name)) {
      out.client = c; out.who = { name: s(ui.who.name, 120), faction: s(ui.who.faction, 120), district: s(ui.who.district, 120), role: s(ui.who.role, 160), want: s(ui.who.want, 300) };
    } else if (c.indexOf('fac:') === 0) { f = facOf(M, c.slice(4)); if (f) out.client = 'fac:' + f.name; }
    else if (c.indexOf('kind:') === 0) { var k = clientList(M, c.slice(5)); if (k) out.client = 'kind:' + str(k[0]); }
    var t = s(ui.target);
    if (t === 'enemy' || t === 'foe') out.target = t;
    else if (t.indexOf('fac:') === 0) { f = facOf(M, t.slice(4)); if (f) out.target = 'fac:' + f.name; }
    var j = s(ui.job); if (M.opKeys.indexOf(j) >= 0) out.job = j;
    var d = s(ui.district);
    if (d === ANY_DISTRICT || d === NOW) out.district = d; else if (d) out.district = distOf(M, d);
    out.crew = crewKeyOf(M, s(ui.crew));
    if (numeric(ui.tier) && Number(ui.tier) === Math.floor(Number(ui.tier)) && Number(ui.tier) >= 0 && Number(ui.tier) <= 6) out.tier = Number(ui.tier);
    out.nowIn = distOf(M, s(ui.nowIn));
    return out;
  }
  function cleanBump(b) {
    var out = {};
    if (isObj(b)) SECTIONS.forEach(function (k) { var n = Math.floor(Number(b[k])); if (n > 0 && isFinite(n)) out[k] = Math.min(n, 9999); });
    return out;
  }

  // --- The controls ----------------------------------------------------------------------------------------------------------------
  function sortedFacs(M) { return M.fac.slice().sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; }); }
  function nameList(a, n) { a = a.map(function (x) { return x.name || x; }); return a.slice(0, n).join(', ') + (a.length > n ? ', …' : ''); }
  function controlsOf(M, campaign, ctx, ui) {
    ctx = isObj(ctx) ? ctx : {}; ui = isObj(ui) ? ui : {};
    var T = M.T, cc = isObj(ctx.crew) ? ctx.crew : {}, cp = isObj(campaign.crew) ? campaign.crew : {};
    var dType = crewKeyOf(M, cc.type) || crewKeyOf(M, cp.type) || M.crewKeys[0] || '';
    var type = crewKeyOf(M, ui.crew) || dType, crewT = isObj(T.crew[type]) ? T.crew[type] : {};
    var dTier = tierOf(cc.tier) !== null ? tierOf(cc.tier) : tierOf(cp.tier) !== null ? tierOf(cp.tier) : 0;
    var opt = function (v, l) { return { value: v, label: l === undefined ? v : l }; };
    var group = function (label, options) { return { label: label, options: options }; };
    var build = function (id, label, groups) {
      groups = groups.filter(function (g) { return g.options.length; });
      return { id: id, label: label, type: 'select', groups: groups, options: [].concat.apply([], groups.map(function (g) { return g.options; })) };
    };
    var facOpts = function () { return sortedFacs(M).map(function (f) { return opt('fac:' + f.name, f.name + ' · Tier ' + romanOf(f.tier)); }); };
    // NPCs in the groups the page gave them (first appearance sets the order), each key once
    var gs = [], by = {}, seen = {};
    arr(ctx.npcs).forEach(function (n) {
      if (!isObj(n) || !str(n.key) || !str(n.name).trim() || seen[n.key]) return;
      seen[n.key] = true;
      var g = str(n.group) || 'NPCs';
      if (!by[g]) { by[g] = group(g, []); gs.push(by[g]); }
      var tail = str(n.faction).trim() || str(n.role).trim();
      by[g].options.push(opt('npc:' + n.key, str(n.name).trim() + (tail ? ' (' + tail + ')' : '')));
    });
    var client = build('client', "Who's asking", [group('', [opt('', 'any'), opt(NONE, 'nobody')])].concat(gs, [
      group('Factions', facOpts()),
      group('Kinds', arr(T.client).filter(Array.isArray).map(function (c) { return opt('kind:' + str(c[0]), str(c[0])); }))]));
    var enemyNames = strs(cc.enemies).length ? strs(cc.enemies) : strs(cp.enemies), foes = standingFoes(M, campaign), tg = [opt('', 'any')];
    if (enemyNames.length) tg.push(opt('enemy', cap(str(crewT.enemyPhrase).trim() || 'enemies') + ' (' + nameList(enemyNames, 4) + ')'));
    if (foes.length) tg.push(opt('foe', 'On bad terms (' + nameList(foes, 3) + ')'));
    var target = build('target', 'Target', [group('', tg), group('Factions', facOpts())]);
    var job = build('job', 'Job', [group('', [opt('', 'any')]),
      group('Favoured by ' + type, strs(crewT.ops).filter(function (o) { return M.opKeys.indexOf(o) >= 0; }).map(function (o) { return opt(o); })),
      group('All operations', M.opKeys.map(function (o) { return opt(o); }))]);
    var district = build('district', 'Where', [group('', [opt('', 'Where the target is'), opt(NOW, 'Now in: ' + (str(ctx.nowIn).trim() || 'anywhere')), opt(ANY_DISTRICT, 'Anywhere')]),
      group('Districts', M.districts.map(function (d) { return opt(d); }))]);
    var crew = build('crew', 'Crew', [group('', [opt('', dType + ' (the crew)')]), group('Crews', M.crewKeys.map(function (k) { return opt(k); }))]);
    var tiers = []; for (var i = 0; i <= 6; i++) tiers.push(opt(String(i), 'Tier ' + romanOf(i)));
    var tier = build('tier', 'Tier', [group('', [opt('', 'Tier ' + romanOf(dTier) + ' (the crew)')]), group('Tiers', tiers)]);
    return [client, target, job, district, crew, tier];
  }

  // --- Text helpers ------------------------------------------------------------------------------------------------------------
  // the table's phrase with its {district} read against the place the score is in
  function fillDistrict(t, district) { return str(t).replace(/\{district\}/g, function () { return district || 'the district'; }); }
  // the seed's text with the crew's enemy phrase (any case) replaced by the target: a leading "The" is lower-cased mid-sentence
  function swapEnemy(text, phrase, name) {
    phrase = str(phrase).trim(); if (!phrase) return str(text);
    var re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'gi');
    return str(text).replace(re, function (m, off, whole) {
      var before = whole.slice(0, off), start = !before.trim() || /[.!?:]["')\]]*\s*$/.test(before) || /\n\s*$/.test(before);
      return start ? cap(name) : midName(name);
    });
  }
  function endStop(t) { return str(t).replace(/[\s.!?]+$/, '') + '.'; }
  // the scope as a phrase after "n stacks,": no full stop, and a lower-case start unless the word opens with two capitals
  function shortScope(t) {
    var c = cut(plain(t).split(/ — |: |\. | \(/)[0], 40).replace(/[.\s]+$/, '');
    return /^[A-Z]{2}/.test(c) ? c : c.charAt(0).toLowerCase() + c.slice(1);
  }

  // --- The roll ------------------------------------------------------------------------------------------------------------------------
  function generate(M, campaign, o) {
    var T = M.T, seed = o.seed, mem = o.mem, ui = o.ui, bump = o.bump, streams = {};
    // one stream per section; the guard keys of a section all start with its name
    function sec(name) {
      if (streams[name]) return streams[name];
      var rnd = seedRng(fnv(seed + ':' + name + ':' + (bump[name] || 0)));
      var used = function (key) { if (!Array.isArray(mem[key])) mem[key] = []; return mem[key]; };
      // the guard keeps a short hash of each recent pick, not its text: the GM notes keep the memory of six cards
      var h = function (v) { return fnv(v).toString(36); };
      var note = function (key, pool, v) { var u = used(key), w = Math.max(1, Math.min(20, Math.floor(pool.length / 2))); u.push(v); while (u.length > w) u.shift(); };
      var s = {
        r: rnd,
        pick: function (a) { return a[Math.floor(rnd() * a.length)]; },
        // a draw that avoids the last few picks under this key (the vault generators' fresh())
        fresh: function (key, pool, keyFn) {
          if (!pool.length) return undefined;
          keyFn = keyFn || function (x) { return x; };
          var u = used(key), open = pool.filter(function (x) { return u.indexOf(h(keyFn(x))) < 0; }), from = open.length ? open : pool;
          var choice = from[Math.floor(rnd() * from.length)];
          note(key, pool, h(keyFn(choice)));
          return choice;
        },
        // the same, each candidate worth its weight
        weighted: function (key, pool, wFn, keyFn) {
          if (!pool.length) return undefined;
          keyFn = keyFn || function (x) { return x; };
          var u = used(key), open = pool.filter(function (x) { return u.indexOf(h(keyFn(x))) < 0; }), from = open.length ? open : pool;
          var ws = from.map(function (x) { return Math.max(0, +wFn(x) || 0); }), tot = ws.reduce(function (a, b) { return a + b; }, 0), choice = null;
          if (tot > 0) { var r = rnd() * tot; for (var i = 0; i < from.length && !choice; i++) { r -= ws[i]; if (r < 0) choice = from[i]; } }
          choice = choice || from[Math.floor(rnd() * from.length)];
          note(key, pool, h(keyFn(choice)));
          return choice;
        }
      };
      return (streams[name] = s);
    }
    var byName = function (f) { return f.name; };

    // 1. the crew: the GM's choice, else the table's, else the first the tables hold
    var cp = isObj(campaign.crew) ? campaign.crew : {};
    var crewType = crewKeyOf(M, ui.crew) || crewKeyOf(M, cp.type) || M.crewKeys[0] || '';
    var crewT = isObj(T.crew[crewType]) ? T.crew[crewType] : {};
    var tier = ui.tier !== '' ? ui.tier : tierOf(cp.tier) !== null ? tierOf(cp.tier) : 0;
    var enemies = crewEnemies(M, cp), foes = standingFoes(M, campaign), abilities = strs(cp.abilities);
    var crew = { type: crewType, tier: tier, enemies: strs(cp.enemies), abilities: abilities };
    var isEnemy = function (f) { return enemies.indexOf(f) >= 0; }, isFoe = function (f) { return foes.indexOf(f) >= 0; };

    // what the GM set
    var lockJob = ui.job, tl = ui.target, cl = ui.client;
    var lockTarget = tl.indexOf('fac:') === 0 ? facOf(M, tl.slice(4)) : null;
    var validOps = function (a) { return strs(a).filter(function (n) { return M.opKeys.indexOf(n) >= 0; }); };

    // 2. lead: about 40%, a crew seed that fits what the GM set becomes the pitch
    var Ld = sec('lead'), roll1 = Ld.r(), lead = null;
    var fits = function (sd) {
      if (!isObj(sd) || !str(sd.t).trim()) return false;
      var sops = validOps(sd.ops);
      if (strs(sd.ops).length && !sops.length) return false;
      if (lockJob && sops.length && sops.indexOf(lockJob) < 0) return false;
      if (str(sd.kind).trim() && !arr(T.asset[sd.kind]).length) return false;
      if (sd.enemy && !(enemies.length || lockTarget || (tl === 'foe' && foes.length))) return false;
      return true;
    };
    var seeds = arr(crewT.seeds).filter(fits);
    if (roll1 < 0.4 && seeds.length) lead = Ld.fresh('lead', seeds, function (sd) { return str(sd.t); });

    // 3. the job: the GM's, the seed's, the crew's favoured about 60%, any
    var Jb = sec('job'), job;
    if (lockJob) job = lockJob;
    else if (lead && validOps(lead.ops).length) job = Jb.fresh('job.seed', validOps(lead.ops));
    else {
      var fav = validOps(crewT.ops), r3 = Jb.r();
      job = fav.length && r3 < 0.6 ? Jb.fresh('job.fav', fav) : Jb.fresh('job', M.opKeys);
    }
    var op = isObj(T.op[job]) ? T.op[job] : {};

    // 4. the client, when the GM set one
    var Cl = sec('client'), client = null;
    var facClient = function (f) { return { type: 'faction', name: f.name, faction: f.name, fac: f }; };
    var kindClient = function (name) {
      var k = clientList(M, name), entry = k ? Cl.fresh('client.k.' + name, strs(k[1])) : '';
      return entry ? { type: 'kind', name: entry, kind: str(k[0]) } : null;
    };
    if (cl === NONE) client = { type: 'nobody', name: '' };
    else if (cl.indexOf('npc:') === 0 && ui.who) {
      var nf = facOf(M, ui.who.faction);
      client = { type: 'npc', name: ui.who.name, faction: ui.who.faction || (nf ? nf.name : ''), fac: nf, role: ui.who.role, district: ui.who.district, want: ui.who.want };
    } else if (cl.indexOf('fac:') === 0 && facOf(M, cl.slice(4))) client = facClient(facOf(M, cl.slice(4)));
    else if (cl.indexOf('kind:') === 0) client = kindClient(cl.slice(5));
    var lockClient = !!client && client.type !== 'kind';

    // 5. the target: the GM's; an enemy; someone on bad terms; the client's rivals about 70%; else a winnable Tier
    var Tg = sec('target'), target = null;
    if (lockTarget) target = lockTarget;
    else if (tl === 'enemy' && enemies.length) target = Tg.fresh('target.enemy', enemies, byName);
    else if (tl === 'foe' && foes.length) target = Tg.fresh('target.foe', foes, byName);
    else if (lead && lead.enemy && enemies.length) target = Tg.fresh('target.enemy', enemies, byName);
    var tPool = lockTarget ? 1 : tl === 'enemy' && enemies.length ? enemies.length : tl === 'foe' && foes.length ? foes.length : lead && lead.enemy && enemies.length ? enemies.length : M.fac.length;
    if (!target) {
      var rivals = client && client.fac ? M.against[client.fac.key] || [] : [], r5 = rivals.length ? Tg.r() : 1;
      if (r5 < 0.7) target = Tg.fresh('target.rival', rivals, byName);
      else {
        var pool = M.fac.filter(function (f) { return !(client && client.fac === f); });
        target = Tg.weighted('target', pool.length ? pool : M.fac, function (f) {
          var gap = (f.tier === null ? 2 : f.tier) - tier, w = gap <= 1 ? 3 : gap === 2 ? 2 : gap === 3 ? 1 : 0.3;
          return isEnemy(f) ? Math.max(w * 3, 6) : isFoe(f) ? Math.max(w * 2, 4) : w;
        }, byName);
      }
    }
    var dos = M.dossier[target.key] || {};
    var tgt = { name: target.name, tier: target.tier, hold: target.hold, boss: str(dos.boss).trim(), enemy: isEnemy(target), foe: isFoe(target) };

    // 6. the client, on any: a faction against the target about 40%, a kind about 45%, nobody about 15%
    if (!client) {
      var r6 = Cl.r(), against = (M.against[target.key] || []).filter(function (f) { return f !== target; }), lists = arr(T.client).filter(Array.isArray);
      if (r6 < 0.4 && against.length) client = facClient(Cl.fresh('client.fac', against, byName));
      else if (r6 < 0.85) { var kl = Cl.fresh('client.list', lists, function (c) { return str(c[0]); }); client = kl ? kindClient(str(kl[0])) : null; }
      if (!client) client = { type: 'nobody', name: '' };
    }

    // 7. the asset: a kind the job suits, then a noun phrase from it
    var As = sec('asset');
    var kinds = (lead && str(lead.kind).trim() ? [lead.kind] : strs(op.kinds)).filter(function (k) { return arr(T.asset[k]).length; });
    if (!kinds.length) kinds = Object.keys(T.asset).filter(function (k) { return arr(T.asset[k]).length; });
    var kind = str(As.fresh('asset.kind', kinds)), phrase = kind ? str(As.fresh('asset.' + kind, strs(T.asset[kind]))) : '';

    // 8. the site: a holding about 50%, else a building for the kind; the district; the obvious way in
    var Si = sec('site'), pickD = ui.district;
    var namedD = pickD === NOW ? ui.nowIn : pickD && pickD !== ANY_DISTRICT ? pickD : '';      // Now in is a pick too, when it is a district the tables hold
    var holds = (M.holding[target.key] || []).filter(function (h) { return !namedD || !str(h[2]).trim() || fkey(h[2]) === fkey(namedD); });
    var r8 = Si.r(), hold = holds.length && r8 < 0.5 ? Si.fresh('site.holding', holds, function (h) { return str(h[0]); }) : null;
    var btype, place = '';
    if (hold) { place = str(hold[0]).trim(); btype = str(hold[1]).trim(); }
    else {
      var types = strs(T.site && T.site[kind]); if (!types.length) types = M.targetNames;
      btype = str(Si.fresh('site.type.' + kind, types));
    }
    var district = '';
    if (namedD) district = namedD;
    else if (hold && distOf(M, hold[2])) district = distOf(M, hold[2]);
    else if (pickD === ANY_DISTRICT) district = str(Si.fresh('site.district', M.districts));
    else {
      var ds = targetDistricts(M, target);
      district = ds.length ? str(ds.length === 1 ? ds[0] : Si.fresh('site.district', ds)) : ui.nowIn || str(Si.fresh('site.district', M.districts));
    }
    var ways = strs(op.ways), vecList = ways.length ? strs(T.vector && T.vector[ways[0]]) : [];
    var vector = vecList.length ? str(Si.fresh('site.vector', vecList)) : '';
    var glossOf = function (a) { var g = arr(T.approach).filter(function (x) { return Array.isArray(x) && fkey(x[0]) === fkey(a); })[0]; return g ? str(g[1]).trim() : ''; };
    var wayRows = ways.map(function (a, i) { return { approach: a, say: i === 0 && vector ? vector : glossOf(a), obvious: i === 0 && !!vector }; });
    var rule = M.rule[fkey(district)] || null;

    // 9. why now
    var Wy = sec('why'), wy = Wy.fresh('why', arr(T.why).filter(Array.isArray), function (w) { return str(w[0]); }) || ['', '', 0];

    // 10. the twist, its tokens read against the campaign
    var Tw = sec('twist'), twPool = [];
    arr(T.twist).forEach(function (l) { if (Array.isArray(l)) strs(l[1]).forEach(function (e) { twPool.push({ list: str(l[0]), text: e }); }); });
    var tw = Tw.fresh('twist', twPool, function (x) { return x.text; }) || { list: '', text: '' };
    var pcs = arr(campaign.pcs).filter(function (p) { return isObj(p) && (str(p.first).trim() || str(p.name).trim()); });
    var first = function (p) { return str(p.first).trim() || str(p.name).trim().split(' ')[0]; };
    var twistText = fillDistrict(tw.text, district).replace(/\{(pcFriend|pcRival|purveyor|notable|npc)\}/g, function (m, tok) {
      var k, cand, p;
      if (tok === 'pcFriend' || tok === 'pcRival') {
        k = tok === 'pcFriend' ? 'friend' : 'rival';
        cand = pcs.filter(function (x) { return strs(x[k]).length; });
        if (!cand.length) return "a PC's " + k;
        p = Tw.pick(cand); return Tw.pick(strs(p[k])) + ', ' + first(p) + "'s " + k;
      }
      if (tok === 'purveyor') return pcs.length ? first(Tw.pick(pcs)) + "'s vice purveyor" : "a PC's vice purveyor";
      if (tok === 'notable') { var g = M.gaz[fkey(district)], nl = g ? g.notables : []; return nl.length ? str(Tw.pick(nl)).split(' (')[0].trim() : 'a city notable'; }
      var ns = arr(campaign.npcs).filter(function (n) { return isObj(n) && str(n.name).trim(); });
      return ns.length ? str(Tw.pick(ns).name).trim() : 'someone the crew knows';
    }).replace(/\{[A-Za-z]+\}/g, '').replace(/\s+/g, ' ').trim();

    // 11. the threats, the pay, the extras
    var Th = sec('threat');
    var phys = Th.fresh('threat.phys', arr(T.physThreat).filter(Array.isArray), function (x) { return str(x[0]); }) || ['', ''];
    var soc = Th.fresh('threat.soc', arr(T.socThreat).filter(Array.isArray), function (x) { return str(x[0]); }) || ['', ''];
    var Py = sec('pay'), zero = tier <= 0, dice = [], nd = zero ? 2 : tier;
    for (var d = 0; d < nd; d++) dice.push(1 + Math.floor(Py.r() * 6));
    var kept = zero ? Math.min.apply(null, dice) : Math.max.apply(null, dice);
    var tTier = target.tier === null ? 0 : target.tier, dPay = rule && numeric(rule.pay) ? Math.round(Number(rule.pay)) : 0;
    var total = Math.max(0, kept + tTier + dPay);
    var scopes = arr(T.scope).filter(function (s) { return Array.isArray(s) && numeric(s[0]); }).sort(function (a, b) { return Number(b[0]) - Number(a[0]); });
    var scope = scopes.filter(function (s) { return Number(s[0]) <= total; })[0] || scopes[scopes.length - 1] || [0, ''];
    var payer;
    if (client.type !== 'nobody') payer = { type: 'client', text: client.name };
    else {
      var pays = strs(crewT.pays), line = pays.length ? str(Py.fresh('pay.payer', pays)) : '';
      payer = line ? { type: 'line', text: line } : { type: 'seized', text: 'seized from the target' };
    }
    var Ex = sec('extra'), shots = arr(T.calledShot).filter(function (l) { return strs(l).length; });
    var si = shots.length ? Math.floor(Ex.r() * shots.length) : 0, shotText = shots.length ? str(Ex.fresh('extra.shot.' + si, strs(shots[si]))) : '';
    var shot = { text: shotText, value: 1 + Math.min(2, Math.floor(si * 3 / Math.max(1, shots.length))) };
    var cost = strs(T.cost).length ? str(Ex.fresh('extra.cost', strs(T.cost))) : '', earns = strs(T.earns).length ? str(Ex.fresh('extra.earns', strs(T.earns))) : '';
    var wc = str(wy[1]).trim(), wsize = Math.floor(Number(wy[2]));
    var clockName = wc || (strs(op.clock).length ? str(Ex.fresh('extra.clock', strs(op.clock))) : 'Danger');
    var clock = { name: clockName, size: wc && wsize > 0 ? Math.min(12, wsize) : total >= 8 ? 8 : total >= 6 ? 6 : 4 };

    // the engagement: the Tier factor, the crew's abilities that apply at this gap, the district's modifier
    var gap = target.tier === null ? 0 : target.tier - tier, ab = abilities.map(fkey);
    var notes = arr(crewT.note).filter(function (x) { return isObj(x) && str(x.say).trim() && ab.indexOf(fkey(x.ability)) >= 0 && gap >= (numeric(x.minGap) ? Number(x.minGap) : 0); })
      .map(function (x) { return str(x.say).trim(); });
    var engage = { gap: gap, factor: gap > 0 ? -1 : gap < 0 ? 1 : 0, notes: notes, district: rule && numeric(rule.engage) ? Math.round(Number(rule.engage)) : 0 };

    // the objective and the pitch
    var objective = str(op.verb).replace('{A}', function () { var a = fillDistrict(phrase, district); return possessive(midName(target.name)) + (a ? ' ' + a : ''); }).trim();
    var pitch = lead ? swapEnemy(str(lead.t), crewT.enemyPhrase, target.name).trim()
      : client.type === 'nobody' ? "**Nobody's asking.** You've seen a way to " + endStop(objective)
      : '**' + cap(client.name) + '** wants you to ' + endStop(objective);
    var cc = { type: client.type, name: client.name };
    ['kind', 'faction', 'role', 'district', 'want'].forEach(function (k) { if (client[k]) cc[k] = client[k]; });
    if (client.fac) { cc.tier = client.fac.tier; cc.hold = client.fac.hold; }
    if (client.type === 'faction') cc.atOdds = (M.against[target.key] || []).indexOf(client.fac) >= 0;
    return {
      crew: crew, seed: lead ? { t: str(lead.t), enemy: !!lead.enemy, kind: str(lead.kind) } : null, pitch: pitch, objective: objective,
      op: { name: job, verb: str(op.verb), def: str(op.def), book: swapEnemy(str(op.def), crewT.enemyPhrase, target.name).trim(), loud: !!op.loud, ways: ways },
      client: cc, target: tgt, asset: { kind: kind, phrase: phrase },
      site: { type: btype, place: place, district: district }, vector: vector, ways: wayRows,
      why: { text: fillDistrict(wy[0], district), clock: wc, size: wsize > 0 ? wsize : 0 }, twist: { list: tw.list, text: twistText },
      threats: { phys: { name: str(phys[0]), text: str(phys[1]) }, soc: { name: str(soc[0]), text: str(soc[1]) } },
      pay: { dice: dice, zero: zero, kept: kept, tier: tTier, district: dPay, total: total, scope: str(scope[1]), scopeShort: shortScope(scope[1]), payer: payer },
      shot: shot, cost: cost, earns: earns, clock: clock, engage: engage,
      rule: rule ? { say: str(rule.say).trim(), pay: dPay, engage: engage.district, heat: numeric(rule.heat) ? Math.round(Number(rule.heat)) : 0 } : null,
      dossier: { friends: str(dos.with).trim(), now: str(dos.now).trim(), secret: str(dos.secret).trim() },
      // rows that cannot be rolled again: the GM fixed them, or the table (a seed's single operation, one enemy) leaves one choice
      locks: { client: lockClient, lead: !seeds.length, job: !!lockJob || (lead ? validOps(lead.ops).length === 1 : M.opKeys.length < 2), target: tPool < 2 }
    };
  }

  // --- The card ------------------------------------------------------------------------------------------------------------------------
  function clientMd(s) {
    var c = s.client;
    if (c.type === 'nobody') return "Nobody's asking";
    if (c.type === 'kind') return cap(c.name) + (c.kind ? ' *(' + c.kind + ')*' : '');
    var tail = c.type === 'npc' ? [c.role, c.faction].filter(Boolean).join(' · ') : 'Tier ' + romanOf(c.tier) + (c.hold ? ' ' + holdWord(c.hold) : '');
    return '**' + c.name + '**' + (tail ? ' (' + tail + ')' : '') + (c.type === 'npc' && c.want ? ' — *wants ' + c.want.replace(/\*+/g, '') + '*' : '') + (c.atOdds ? ' · at odds with the target' : '');
  }
  function payMd(s) {
    var p = s.pay, dice = p.dice.length + 'd [' + p.dice.join(' ') + ']' + (p.zero ? ' keep lowest' : '') + ' → ' + p.kept;
    var plus = ', + Tier ' + romanOf(s.target.tier) + (p.district ? ', ' + signed(p.district) + ' district' : '');
    return '**' + stacks(p.total) + '** · ' + dice + plus + ' · ' + (p.payer.type === 'client' ? 'paid by ' : p.payer.type === 'line' ? 'paid through ' : '') + p.payer.text;
  }
  function cardOf(s) {
    var w = s.site, where = w.place ? w.place + ' (' + w.type + ')' : w.type, th = s.threats, e = s.engage, d = s.dossier;
    var wayMd = s.ways.map(function (x, i) {
      if (i === 0 && x.obvious) return '**Obvious:** ' + x.say + ' *(' + x.approach + ')*';
      return (i ? 'or ' : '') + '**' + x.approach + '**' + (x.say ? ': ' + x.say : '');
    }).join(' · ');
    var aim = s.asset.phrase ? ' · aim at their *' + fillDistrict(s.asset.phrase, w.district).replace(/\*+/g, '') + '*' : '';
    var rows = [
      { k: "Who's asking", md: clientMd(s), id: 'client', reroll: !s.locks.client },
      { k: 'The job', md: '**' + s.op.name + '**' + aim, id: 'job', reroll: !s.locks.job },
      { k: 'Target', md: '**' + s.target.name + '** · Tier ' + romanOf(s.target.tier) + (s.target.hold ? ' ' + holdWord(s.target.hold) : '') + (s.target.boss ? ' · ' + s.target.boss : ''), id: 'target', reroll: !s.locks.target },
      { k: 'Where', md: where + (w.district ? ' · ' + w.district : ''), id: 'site', reroll: true },
      { k: 'Why now', md: s.why.text, id: 'why', reroll: true },
      { k: 'Twist', md: cap(s.twist.text) + (s.twist.text && s.twist.list ? ' *(' + s.twist.list.toLowerCase().replace(/\*+/g, '') + ')*' : ''), id: 'twist', reroll: true },
      { k: 'Ways in', md: wayMd, id: 'ways', reroll: false },
      { k: 'Pays', md: payMd(s), id: 'pay', reroll: true }
    ].filter(function (r) { return !blank(r.md); });
    // a penalty and the ability that answers it read as "−1d — but ..."; a bonus or an even match just lists the notes
    var engMd = 'Tier **' + (e.factor > 0 ? '+1d' : e.factor < 0 ? '−1d' : '0') + '** (' + romanOf(s.target.tier) + ' against ' + romanOf(s.crew.tier) + ')' +
      (e.notes.length ? (e.factor < 0 ? ' — but ' : ' · ') + e.notes.join(' · ') : '') + (e.district ? ' · District **' + signed(e.district) + 'd**' : '');
    var cloud = [
      { k: 'By the book', md: s.op.book, id: 'def' },
      { k: 'In the way', md: ['*' + th.phys.name + '*: ' + th.phys.text, '*' + th.soc.name + '*: ' + th.soc.text].filter(function (x) { return !blank(x); }).join(' · '), id: 'threat' },
      { k: 'Their friends', md: d.friends, id: 'friends' },
      { k: 'Right now', md: d.now, id: 'now' },
      { k: 'Secret', md: d.secret ? '*' + d.secret.replace(/\*+/g, '') + '*' : '', id: 'secret' },
      { k: 'Clock', md: '**' + s.clock.name + '** · ' + s.clock.size + ' segments', id: 'clock' },
      { k: 'Engagement', md: engMd, id: 'engage' },
      { k: 'Called Shot', md: s.shot.text ? s.shot.text + ' — **+' + stacks(s.shot.value) + '**, −' + s.shot.value + ' if they fail it' : '', id: 'shot' },
      { k: 'Even if it goes well', md: s.cost, id: 'cost' },
      { k: 'Also earns', md: s.earns, id: 'earns' },
      { k: 'District', md: s.rule ? [s.rule.say, s.rule.heat ? 'heat ' + signed(s.rule.heat) : ''].filter(Boolean).join(' · ') : '', id: 'district' }
    ].filter(function (r) { return !blank(r.md); });
    cloud.forEach(function (r) { r.reroll = false; });
    var title = s.op.name + ' · ' + s.target.name;
    var sub = ['Tier ' + romanOf(s.target.tier), w.district, stacks(s.pay.total) + (s.pay.scopeShort ? ', ' + s.pay.scopeShort : '')].filter(Boolean).join(' · ');
    var chips = [s.op.name, 'Tier ' + romanOf(s.target.tier), stacks(s.pay.total), s.op.loud ? 'loud' : 'quiet'];
    var lines = [
      { kind: 'chips', id: 'chips', chips: chips },
      { kind: 'want', id: 'lead', md: s.pitch, reroll: !s.locks.lead },
      { kind: 'grid', id: 'score', rows: rows }
    ];
    if (cloud.length) lines.push({ kind: 'grid', id: 'cloud', title: 'The cloud', collapsed: true, rows: cloud });
    var all = [title, sub, plain(s.pitch)].concat(rows.concat(cloud).map(function (r) { return r.k + ': ' + plain(r.md); }));
    return { lines: lines, meta: { id: 'score', title: title, sub: sub, chips: chips, text: plain(s.pitch), all: all, label: cut(title, 60) } };
  }

  // --- The helpers the page uses on a score ------------------------------------------------------------------------------
  function cardEntry(s) {
    var n = function (t) { return cut(t, 120); };
    return { from: 'GM', client: s.client.type === 'nobody' ? '' : n(s.client.name), target: n(s.target.name + ' (' + romanOf(s.target.tier) + ')'), type: n(s.op.name),
      note: n(s.seed ? plain(s.pitch) : endStop(cap(s.objective))), payout: n(stacks(s.pay.total)) };
  }
  function siteHints(s) { return { target: s.site.type, district: s.site.district, faction: s.target.name, approach: s.op.ways[0] || '' }; }
  function npcHints(s) {
    var c = s.client;
    return { faction: c.type === 'faction' || c.type === 'npc' ? str(c.faction) : c.type === 'nobody' ? s.target.name : '', district: s.site.district };
  }
  function clockOf(s) { return { name: s.clock.name, size: s.clock.size }; }

  // --- create() ---------------------------------------------------------------------------------------------------------------------
  function create(cfg) {
    cfg = cfg || {};
    var T = cfg.T;
    if (!isObj(T) || !isObj(T.crew) || !isObj(T.op) || !isObj(T.asset) || !Array.isArray(T.faction)) throw new Error("B68GmScore.create: cfg.T (the pack's score.T) is required");
    var M = model(T), campaign = isObj(cfg.campaign) ? cfg.campaign : {}, MEM = isObj(cfg.mem) ? cfg.mem : {};
    if (!M.opKeys.length || !M.fac.length || !M.crewKeys.length) throw new Error("B68GmScore.create: cfg.T (the pack's score.T) needs crew, op and faction tables");
    function roll(o) {
      o = o || {};
      var seed = o.seed != null ? o.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
      var mem = isObj(o.mem) ? o.mem : MEM, before = clone(mem), ui = cleanUi(M, o.ui), bump = cleanBump(o.bump);
      var score = generate(M, campaign, { seed: seed, mem: mem, ui: ui, bump: bump });
      var rui = clone(ui); rui.crew = score.crew.type; rui.tier = score.crew.tier;       // a replay does not follow the table
      return { score: score, card: cardOf(score), seed: seed, replay: { seed: seed, mem: before, ui: rui, bump: clone(bump) }, memAfter: mem };
    }
    function replay(r) { return roll({ seed: r.seed, mem: clone(r.mem), ui: r.ui, bump: r.bump }); }
    // the text a row shows on a card (the pitch is the want line)
    var rowText = function (card, id) {
      var out = '';
      card.lines.forEach(function (l) { if (l.id === id) out = l.md; (l.rows || []).forEach(function (x) { if (x.id === id) out = x.md; }); });
      return out;
    };
    // ↻: the section's bump + 1. A new stream can land on the pick it replaces (the guard looks at earlier rolls, not this one), and a
    // button that seems to do nothing is worse than a second bump, so the bump goes up again (never more than MORE times) until the
    // row reads differently; the replay records the bump it reached, so it redraws exactly.
    var MORE = 12;
    function reroll(r, row) {
      var sec = has(ROWS, row) ? ROWS[row] : '';
      if (!sec) throw new Error('B68GmScore.reroll: unknown row "' + row + '"');
      var was = rowText(replay(r).card, sec), base = cleanBump(r.bump), first = null;
      for (var k = 1; k <= MORE; k++) {
        var bump = clone(base); bump[sec] = (base[sec] || 0) + k;
        var res = roll({ seed: r.seed, mem: clone(r.mem), ui: r.ui, bump: bump });
        if (!first) first = res;
        if (rowText(res.card, sec) !== was) return res;
      }
      return first;
    }
    return {
      roll: roll, replay: replay, reroll: reroll,
      controls: function (ctx, ui) { return controlsOf(M, campaign, ctx, ui); },
      defaults: function () { return { client: '', who: null, target: '', job: '', district: '', crew: '', tier: '', nowIn: '' }; },
      cleanUi: function (ui) { return cleanUi(M, ui); },
      setCampaign: function (c) { campaign = isObj(c) ? c : {}; },
      mem: function () { return MEM; }
    };
  }

  return { create: create, check: check, seedRng: seedRng, fnv: fnv, fkey: fkey, plain: plain, cardEntry: cardEntry, siteHints: siteHints, npcHints: npcHints, clockOf: clockOf, ROWS: ROWS, ID: 'score' };
});
