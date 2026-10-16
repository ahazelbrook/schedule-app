/* gm/console.js — the GM console's nine rollers, as pure logic (no DOM, no storage, no network).
   A port of the vault's Dataview module (Tools/views/gm-console/view.js, 06/10/2026). The tables are NOT in this
   file: they arrive from the GM pack (part `console`, field `T`), and the campaign context from part `campaign`.
   Plain script, UMD: window.B68GmConsole in the browser, module.exports under Node.

   ---------------------------------------------------------------------------------------------------------------
   API (the UI author reads only this block)
   ---------------------------------------------------------------------------------------------------------------
   const con = B68GmConsole.create({ T, campaign, state, mem, seed })
       T         pack.parts.console.T (required). B68GmConsole.check(T) lists the keys a pack is missing (below).
       campaign  pack.parts.campaign: { pcs, callbacks, cast, standing, owed, npcs, names } (any may be missing)
       state     optional console state (see "State and intents"): table-side changes laid over the campaign
       mem       optional repeat-guard memory, a plain JSON object; default {} (kept by the instance)
       seed      optional number: makes the instance's *fresh* seeds a reproducible stream (tests); default random

   con.buttons      [{ n: 1..9, id, label, hint }] in key order:
                    1 devilsBargain · 2 complication · 3 consequence · 4 payThePrice · 5 reaction
                    6 callback · 7 harm · 8 contact · 9 face
   con.controls     [{ id, label, type: 'select'|'text', row: 0|1|2, options?: [{ label, value }], placeholder? }]
                    ids: pos, result, scene, district (row 0) · pc, npc (row 1) · threat (row 2, text)
                    Options come from T and the campaign (scenes, districts, PCs, friends/rivals, faction standing).
                    Rebuilt by setCampaign().
   con.defaults()   the starting controls: { pos: 'risky', scene: '', district: '', pc: '', result: '', npc: '', threat: '' }
   con.roll(id, ui, { seed, mem })  -> { lines, meta, seed, replay }
       id     a button id, or its number 1..9 (an unknown id rolls devilsBargain, as the vault did)
       ui     the controls (merged over defaults()). A district, PC or NPC the pack no longer holds reads as "any"
              (and is dropped from replay.ui). Optional extra: ui.dots = { '<pc name>': { insight, prowess,
              resolve } } overrides the attribute dots the pack carries (campaign.pcs[i].insight/prowess/resolve,
              read from the character sheets' frontmatter when the pack was built). Harm & resist and the
              Consequence resist row use them; feed live sheets here if the app has them.
       seed   uint32; omit for a fresh one. The returned `seed` + `replay.mem` + `replay.ui` redraw the same card.
       mem    the repeat-guard memory to use and MUTATE (default: the instance's). Serialise it to keep the guard
              across reloads. replay.mem is a deep copy of mem as it was BEFORE this roll: to redraw a card from
              history, call roll(replay.id, replay.ui, { seed: replay.seed, mem: clone(replay.mem) }).
     lines: the card body, in order. Each item is one of
       { kind: 'want', md, small? }   the headline (the vault's accent box). `small` = a muted second line
       { kind: 'read', md }           guidance / secondary prose
       { kind: 'grid', rows: [{ k, md }] }   a key/value block (k is a short label, md is markdown)
       All md is markdown (**bold**, *italic*, `code`, [[wikilink]] to an NPC page); never HTML.
     meta: { id, n, title, sub, chips: [string], text, all: [string], label, actions: [{ label, intent }], ...extra }
       title/sub   the card's headline and its small subtitle
       chips       the sticky controls worth showing on this card ("Aim: X", "Threat: …", "District: …", "Result: …")
       text, all   plain-text first line and every line (for "L files last roll" and history labels)
       label       the vault's history label ("Title: first line…")
       actions     buttons the card offers; pressing one hands its `intent` to applyIntent (they never re-roll)
       extra       per button: bargain {kind, anchor, cat} · d66 · reaction {pool, dice, best, crit, result}
                   · contact {name, pc, dice, result} · face {npc: page name | null, name}
     Classic output is the vault's, byte for byte, for a well-formed pack: nothing below changes what roll() returns.
   con.annotate(res) -> { lines, meta, seed, replay, detail }   the same roll, read for the table (a NEW object; `res`
       is untouched). Situations use it for every section; a page may use it on a classic card too:
       · lines carry `coach: true` on the recurring guidance lines (fold them; Pin / Copy may skip them)
       · a Consequence leads "**kind** — example" (the example row folded into it; a threat's spend sentence is its
         `small`); the Harm example without a scene is this level's entry; a Complication with a threat leads with the
         drawn complication and the spend sentence as its `small`
       · one "Accepted" action per bargain shown (a printed district bargain plus its Or); one "Collected" per
         bargain that came due (Pay the price 66 "roll twice more" included); author notes ("[flagged for …]",
         "[TODO: …]") dropped
       · meta.all / text / label are rebuilt from the new lines (text = the lead line without its `small`)
       · detail: { coach: [], kind?, example?, level?, draw?, bargains?, due?, result? } what the roll drew
   con.setCampaign(campaign, state)  swap the campaign (and/or console state); rebuilds con.controls
   con.mem()        the instance's repeat-guard memory (the live object)
   con.check()      B68GmConsole.check(T) for this instance's tables

   B68GmConsole.check(T) -> [string]   the table keys a pack is missing or has empty ('district', 'spend.Harm',
       'say3.<reaction>', 'scene.<scene>.harm', …), for the page to show when a pack is loaded. Empty = the pack is
       complete. Every roller falls back to a neutral word or line for a missing key rather than throwing (an old or
       sparse pack still rolls); create() itself needs only T.severity and T.scene.

   State and intents. Nothing here writes anywhere; a card's action returns an intent, and the UI keeps the result
   in GM state. The console state is a plain object of maps (merge-friendly for PATCH /api/gm/state):
       { live: {controls}, owed: { key: { text, src } }, struck: { key: text }, used: { key: text } }
         owed    bargains accepted at the table (added to the pack's `owed`)
         struck  bargains collected (Pay the price 61-62): removes any owed line that starts with the text
         used    callbacks used (removes the pack callback with that text)
   Intents: { type: 'threatSpent' } · { type: 'bargainOwed', key, text, who, capture: { bucket: 'x', text } }
            · { type: 'bargainCollected', key, text } · { type: 'callbackUsed', key, text }
   B68GmConsole.intentPatch(intent, { date })  -> the patch for that intent (date 'DD/MM/YYYY', default today)
   B68GmConsole.applyIntent(state, intent, { date }) -> a NEW state (patch deep-merged; the input is untouched)
   B68GmConsole.campaignWith(campaign, state)  -> the campaign with owed/struck/used applied (create() does this)
   An intent's `capture` (bargainOwed only) is the line the vault also filed under Loose ends (bucket 'x').

   Helpers: B68GmConsole.seedRng(a) (mulberry32, as the vault) · resistOdds(n) · poolRoll(n, rng) · plain(md)
            · LIVE0 · BUTTONS (ids and labels only) · SITUATIONS · SITUATION_ID · COMPOSE_VERSION · check(T)
   ---------------------------------------------------------------------------------------------------------------
   SITUATIONS (composed cards; phase 2). Classic (everything above) is untouched: situations are a layer that runs
   classic rolls as sections, each read through annotate(). Nothing below changes what con.roll() returns.
   ---------------------------------------------------------------------------------------------------------------
   con.situations()  -> [{ id, label, key, hint }]: before (key 1, Devil's Bargain) · fourfive (2, a 4/5) ·
                        onetothree (3, a 1-3) · someone (4). Keys 1-4 in Situations; Classic keeps 1-9.
   con.positions     [{ value: 'controlled'|'risky'|'desperate', label, severity, ticks, harm }] for the big 3-way
                        Position switch (severity / ticks / harm level come from T.severity).
   con.situationControls   con.controls without Result (the button is the result): pos, scene, district, pc, npc, threat.
                        Rebuilt by setCampaign(), like con.controls.
   con.situationDefaults() the starting controls for Situations (con.defaults() minus result).
   con.situation(id, ui, { seed, mem, composeVersion }) -> { lines, meta, sections, seed, replay }
       id     a situation id, or its number 1..4 (an unknown id rolls 'before')
       ui     the controls (as roll(); any ui.result is ignored: the situation decides it). ui.dots works as in roll().
       seed   uint32 for the whole card; omit for a fresh one. mem the repeat-guard memory, MUTATED, default the
              instance's. Same rules as roll(): replay.mem is a deep copy BEFORE the card.
       composeVersion  the version a stored card was composed with (con.replay passes it; absent = 1). When it is not
              the current COMPOSE_VERSION the card is redrawn with the CURRENT composition and meta.recomposed =
              { from, to } says so (the Or rows may differ from what was shown; the lead's seed is the same).
       sections  ordered; sections[0] is the LEAD (render it as the lead box), the rest are at most three "Or" entries
                 (render each as a one-line `lead`, opening to its full lines). Each section:
                 { id: classic button id, role: 'lead'|'or', slot: 0..3, title, lead: one plain line (<= 120 chars),
                   sub, chips (no "Result:" chip; the lead's start with the position chip), lines, actions, meta,
                   detail (all from annotate()), seed, replay: { id, seed, mem, ui } }
                 replay is a classic roll: con.roll(id, ui, { seed, mem }); the section equals con.annotate() of it.
       lines  every section's lines flattened in order (a plain fallback; the page should render `sections`)
       actions  meta.actions is the merged list from every section (duplicates dropped; each carries `from`, the
                section id). Pressing one hands its `intent` to applyIntent as always.
       meta   { id: 'situation', situation: <situation id>, n: 1..4, composeVersion, title, sub, chips (the position
              chip "risky → 2 winds · harm 2" first), position: { pos, severity, ticks, harm }, text (the lead's line),
              all (every section's lines as text), label, actions, sections: [{ id, role, slot, title, seed }],
              recomposed? { from, to }, plus the first bargain / d66 / reaction / contact / face extras among the
              sections }
       replay { id: 'situation', situation, seed, mem, ui, composeVersion }: con.replay(replay) redraws the whole card.
   con.replay(replay) redraws a stored card: id 'situation' -> situation(), anything else -> roll(). It clones
                      replay.mem for you and passes replay.composeVersion through (absent = 1).
   Section seeds come from a second mulberry32 stream started from the card's seed (one draw per SLOT, four draws
   always, in a fixed order, whether or not the slot is filled: a section's seed never depends on which others
   appear), and mem runs through the sections in order. Slot 0 is the lead; the Or rows are planned AFTER the lead is
   drawn (its kind decides them) and keep their slots.
   STORE COMPOSED CARDS AND HISTORY UNDER THE ID 'situation' (B68GmConsole.SITUATION_ID), NEVER 'console': code from
   before this change redraws any unknown id as a Devil's Bargain, so a rollback would misread them. Store
   replay.composeVersion with them and pass it back, so an older card is redrawn as "recomposed" rather than silently.
   Which sections appear: before = Devil's Bargain. fourfive = Consequence (4/5) · Or Complication (4/5, with the
   clock ticks) — or, when the lead IS a Complication, Or Pay the price (4/5) instead · Or Callback (only if callbacks
   are on file) · Or NPC reaction (only if the NPC control is set).
   onetothree = Consequence (1-3) · Or Pay the price · Or Harm & resist — dropped when the lead IS Harm (it carries
   Resist already; a Callback takes the slot if any are on file) · Or NPC reaction (NPC set).
   someone = NPC control empty: Face · Or NPC reaction (2d). A friend: Contact, aimed at that friend's PC and at that
   friend (ui.contact, a hint only situations set): the Contact card is the reaction, so no Or row. A rival or
   faction: NPC reaction with that pool. B68GmConsole.SITUATIONS and COMPOSE_VERSION are exported too.
   COMPOSE_VERSION history: 1 the first composition · 2 the Or rows planned after the lead, Contact aimed at the
   chosen friend (no Or reaction), sections read through annotate().
   --------------------------------------------------------------------------------------------------------------- */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.B68GmConsole = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // --- Seeded random: mulberry32, exactly the vault's __seed --------------------------------------------------
  function seedRng(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Resistance: cost = 6 - highest die; two 6s clear 1 stress; 0 dice = 2d keep the lowest, no crit (BitD p.32).
  function resistOdds(n) {
    var dice = n < 1 ? 2 : Math.min(n, 6);
    var total = 0, free = 0, count = 0;
    function roll(left, hi, lo, sixes) {
      if (!left) {
        count++;
        var cost;
        if (n < 1) cost = 6 - lo;
        else cost = sixes >= 2 ? -1 : 6 - hi;
        total += cost;
        if (cost <= 0) free++;
        return;
      }
      for (var f = 1; f <= 6; f++) roll(left - 1, Math.max(hi, f), Math.min(lo, f), sixes + (f === 6 ? 1 : 0));
    }
    roll(dice, 0, 7, 0);
    return { avg: total / count, free: free / count };
  }
  // A pool roll: 0d = 2d keep lowest, no crit.
  function poolRoll(n, rng) {
    var dice = [];
    for (var i = 0; i < (n < 1 ? 2 : n); i++) dice.push(1 + Math.floor(rng() * 6));
    var best = n < 1 ? Math.min.apply(null, dice) : Math.max.apply(null, dice);
    var crit = n >= 1 && dice.filter(function (x) { return x === 6; }).length >= 2;
    return { dice: dice, best: best, crit: crit, idx: crit ? 0 : best === 6 ? 1 : best >= 4 ? 2 : 3 };
  }

  // The vault's capture text: markup out, whitespace collapsed.
  function plain(s) {
    return String(s)
      .replace(/<small>|<\/small>|<br>/g, ' ')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  var clone = function (o) { return JSON.parse(JSON.stringify(o == null ? {} : o)); };
  var isObj = function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v); };
  var has = function (a) { return Array.isArray(a) && a.length > 0; };
  var str = function (v, d) { return v == null ? d : String(v); };
  function deepMerge(target, patch) {
    var out = isObj(target) ? Object.assign({}, target) : {};
    Object.keys(patch || {}).forEach(function (k) {
      var v = patch[k];
      if (v === null || v === undefined) delete out[k];
      else if (isObj(v)) out[k] = deepMerge(out[k], v);
      else out[k] = v;
    });
    return out;
  }
  // FNV-1a: a short stable key for a line of text (map keys in GM state).
  function keyOf(s) {
    var h = 0x811c9dc5;
    s = String(s);
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return 'k' + (h >>> 0).toString(16).padStart(8, '0');
  }
  function todayDMY(d) {
    d = d || new Date();
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  }

  // --- Campaign shapes (the pack mirrors view.js readPCs / pipeList / readNPCs / readNames) --------------------
  var bare = function (s) { return String(s).replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2').trim(); };
  var rawList = function (v) { return v == null ? [] : (Array.isArray(v) ? v : [v]).map(function (x) { return String(x); }).filter(Boolean); };
  // "what | where" strings or { text, src } objects -> { text, src }
  function pipe(x) {
    if (isObj(x)) return { text: String(x.text == null ? '' : x.text).trim(), src: String(x.src == null ? '' : x.src).trim() };
    var s = String(x), i = s.indexOf('|');
    return i < 0 ? { text: s.trim(), src: '' } : { text: s.slice(0, i).trim(), src: s.slice(i + 1).trim() };
  }
  var rawOf = function (x) { return x.src ? x.text + ' | ' + x.src : x.text; };
  function pipeList(v) { return (Array.isArray(v) ? v : []).map(pipe).filter(function (x) { return x.text; }); }

  function campaignWith(campaign, state) {
    var c = Object.assign({}, campaign || {});
    var s = isObj(state) ? state : {};
    var used = Object.keys(s.used || {}).map(function (k) { return String(s.used[k]); });
    var struck = Object.keys(s.struck || {}).map(function (k) { return String(s.struck[k]); });
    c.callbacks = pipeList(c.callbacks).filter(function (x) { return used.indexOf(x.text.trim()) < 0; });
    var owed = pipeList(c.owed).concat(Object.keys(s.owed || {}).map(function (k) { return pipe(s.owed[k]); }));
    c.owed = owed.filter(function (x) { return x.text && !struck.some(function (t) { return rawOf(x).indexOf(t) === 0; }); });
    return c;
  }

  // --- Intents ------------------------------------------------------------------------------------------------
  function intentPatch(intent, opts) {
    var i = intent || {}, o = opts || {};
    var p = {};
    if (i.type === 'threatSpent') p.live = { threat: '' };
    else if (i.type === 'bargainOwed') {
      var date = o.date || todayDMY(o.now);
      p.owed = {}; p.owed[i.key || keyOf(i.text)] = { text: String(i.text), src: (i.who || 'the crew') + ', ' + date };
    } else if (i.type === 'bargainCollected') { p.struck = {}; p.struck[i.key || keyOf(i.text)] = String(i.text); }
    else if (i.type === 'callbackUsed') { p.used = {}; p.used[i.key || keyOf(i.text)] = String(i.text); }
    else throw new Error('B68GmConsole: unknown intent ' + JSON.stringify(i.type));
    return p;
  }
  function applyIntent(state, intent, opts) { return deepMerge(isObj(state) ? clone(state) : {}, intentPatch(intent, opts)); }

  // --- Buttons ------------------------------------------------------------------------------------------------
  var BUTTONS = [
    { n: 1, id: 'devilsBargain', label: "Devil's Bargain", hint: 'this roll is boring: give them something to want' },
    { n: 2, id: 'complication',  label: 'Complication',    hint: "they rolled 4/5 and I've got nothing" },
    { n: 3, id: 'consequence',   label: 'Consequence',     hint: 'what kind of consequence is this, actually?' },
    { n: 4, id: 'payThePrice',   label: 'Pay the price',   hint: "they failed and I don't know what no means" },
    { n: 5, id: 'reaction',      label: 'NPC reaction',    hint: 'how does this stranger take it?' },
    { n: 6, id: 'callback',      label: 'Callback',        hint: 'who from earlier could walk in right now?' },
    { n: 7, id: 'harm',          label: 'Harm & resist',   hint: 'how bad is it, and can they afford to resist?' },
    { n: 8, id: 'contact',       label: 'Contact',         hint: "they're reaching for a contact: always a crumb, never silence" },
    { n: 9, id: 'face',          label: 'Face',            hint: 'who is this person? A name, now' }
  ];
  var LIVE0 = { pos: 'risky', scene: '', district: '', pc: '', result: '', npc: '', threat: '' };

  // --- Situations (composed cards): the id the page must file them under, and the compose version ----------------
  var SITUATION_ID = 'situation';
  var COMPOSE_VERSION = 2;
  var SITUATIONS = [
    { id: 'before',     label: 'Before',  key: 1, hint: "before the roll: a Devil's Bargain to offer" },
    { id: 'fourfive',   label: '4/5',     key: 2, hint: 'they rolled a 4 or 5: a consequence, or a complication' },
    { id: 'onetothree', label: '1–3',     key: 3, hint: 'they rolled 1-3: a consequence, the price, the harm' },
    { id: 'someone',    label: 'Someone', key: 4, hint: 'a stranger, a friend or a rival turns up: who, and how they take it' }
  ];
  var LEAD_MAX = 120;
  var cut = function (t) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > LEAD_MAX ? t.slice(0, LEAD_MAX - 1) + '…' : t; };

  // --- Neutral fallbacks for a sparse pack (never table text; a well-formed pack never reaches them) --------------
  var POSITIONS = ['controlled', 'risky', 'desperate'];
  var SEV0 = { sev: 'moderate', ticks: '1 tick', menu: 'what fits the position', lvl: 2 };
  var REACT0 = [['Critical', 'they go further than asked'], ['Yes', 'they do it'], ['Yes, but', 'a price or a condition'], ['No', 'not now, not for free']];
  var SAY0 = ['The answer first', 'then the price', 'then one detail'];
  var CONS0 = ['Complication', 'New trouble arrives.', 'Something gets in the way.'];
  var PRICE0 = [11, 66, 'The obvious price: name it, then move on.'];
  var DBF0 = ['faction', '**{f}** hears of it.'];
  var DBG0 = ['collateral', 'Something nearby breaks.'];
  var SRC0 = ['A bystander', 'whoever is nearest'];
  var SHAPE0 = ['Something goes wrong', 'the obvious thing'];
  function sevNorm(sv) {
    sv = Array.isArray(sv) ? sv : [];
    return { sev: str(sv[0], SEV0.sev), ticks: str(sv[1], SEV0.ticks), menu: str(sv[2], SEV0.menu), lvl: Number(sv[3]) || SEV0.lvl };
  }

  // The keys a pack must carry for every roller to draw from its tables (what check() reports as missing).
  // A list counts only when it has entries and no hole; a keyed table only when every key a roller reaches is there.
  function full(a, n) {
    if (!Array.isArray(a) || a.length < (n || 1)) return false;
    for (var i = 0; i < a.length; i++) if (a[i] == null || a[i] === '') return false;
    return true;
  }
  function check(T) {
    var miss = [];
    if (!isObj(T)) return ['T'];
    var need = function (k, okay) { if (!okay) miss.push(k); };
    var rows = function (v) { return Array.isArray(v) ? v.filter(Array.isArray) : []; };
    need('severity', isObj(T.severity));
    POSITIONS.forEach(function (p) { need('severity.' + p, isObj(T.severity) && full(T.severity[p], 4)); });
    need('scene', isObj(T.scene) && Object.keys(T.scene).length > 0);
    Object.keys(isObj(T.scene) ? T.scene : {}).forEach(function (k) {
      var s = T.scene[k];
      need('scene.' + k + '.label', isObj(s) && s.label != null && s.label !== '');
      need('scene.' + k + '.comp', isObj(s) && full(s.comp));
      ['reduced', 'lost', 'worse', 'resist'].forEach(function (f) { need('scene.' + k + '.' + f, isObj(s) && s[f] != null && s[f] !== ''); });
      need('scene.' + k + '.harm', isObj(s) && full(s.harm, 3) && [0, 1, 2].every(function (i) { return full(s.harm[i]); }));
      need('dbScene.' + k, isObj(T.dbScene) && full(T.dbScene[k]));
    });
    need('allowed', isObj(T.allowed));
    POSITIONS.forEach(function (p) { ['45', '13'].forEach(function (r) { need('allowed.' + p + '.' + r, isObj(T.allowed) && isObj(T.allowed[p]) && full(T.allowed[p][r])); }); });
    need('consequence', full(T.consequence));
    need('spend', isObj(T.spend));
    rows(T.consequence).forEach(function (c) { need('spend.' + c[0], isObj(T.spend) && !!T.spend[c[0]]); });
    need('price', full(T.price));
    need('reaction', full(T.reaction, 4));
    need('say3', isObj(T.say3)); need('crumb', isObj(T.crumb));
    rows(T.reaction).forEach(function (r) {
      need('say3.' + r[0], isObj(T.say3) && full(T.say3[r[0]], 3));
      need('crumb.' + r[0], isObj(T.crumb) && !!T.crumb[r[0]]);
    });
    ['crumbBits', 'compSource', 'compShape', 'faction', 'district', 'clock', 'db', 'dbFaction'].forEach(function (k) { need(k, full(T[k])); });
    need('aim', isObj(T.aim)); need('aimCat', isObj(T.aimCat));
    ['wont', 'friend', 'rival', 'extra'].forEach(function (h) { need('aim.' + h, isObj(T.aim) && full(T.aim[h])); need('aimCat.' + h, isObj(T.aimCat) && h in T.aimCat); });
    // every category a bargain row or an aim hook names must have its text
    need('cat', isObj(T.cat) && Object.keys(T.cat).length > 0);
    var cats = [];
    rows(T.db).concat(rows(T.dbFaction)).forEach(function (r) { cats.push(r[0]); });
    Object.keys(isObj(T.dbScene) ? T.dbScene : {}).forEach(function (k) { rows(T.dbScene[k]).forEach(function (r) { cats.push(r[0]); }); });
    Object.keys(isObj(T.aimCat) ? T.aimCat : {}).forEach(function (h) { if (T.aimCat[h]) cats.push(T.aimCat[h]); });
    cats.filter(function (c, i, a) { return c != null && c !== '' && a.indexOf(c) === i; }).forEach(function (c) { need('cat.' + c, isObj(T.cat) && !!T.cat[c]); });
    return miss;
  }

  function create(options) {
    var o = options || {};
    var T = o.T;
    if (!T || !T.severity || !T.scene) throw new Error('B68GmConsole.create: T (the pack part console.T) is required');
    var instMem = isObj(o.mem) ? o.mem : {};
    var seedSrc = typeof o.seed === 'number' ? seedRng(o.seed) : null;
    var newSeed = function () { return ((seedSrc ? seedSrc() : Math.random()) * 4294967296) >>> 0; };

    // Campaign, derived once per setCampaign
    var PCS, CALLBACKS, CAST, STANDING, OWED, NPCS, NAMES;
    var con = {};

    function load(campaign, state) {
      var c = campaignWith(campaign, state);
      PCS = (Array.isArray(c.pcs) ? c.pcs : []).filter(Boolean).map(function (p) {
        var name = String(p.name || p.character || '');
        return {
          name: name, first: String(p.first || name.split(' ')[0]), playbook: String(p.playbook || ''),
          insight: Number(p.insight) || 0, prowess: Number(p.prowess) || 0, resolve: Number(p.resolve) || 0,
          wont: rawList(p.wont).map(bare), vice: rawList(p.vice).map(bare),
          friend: rawList(p.friend).map(bare), rival: rawList(p.rival).map(bare), extra: rawList(p.extra).map(bare)
        };
      }).filter(function (p) { return p.name; });
      CALLBACKS = c.callbacks;
      CAST = pipeList(c.cast);
      STANDING = (Array.isArray(c.standing) ? c.standing : []).map(function (x) {
        if (isObj(x) && 'faction' in x) return { faction: String(x.faction), status: parseInt(String(x.status).replace('−', '-'), 10) || 0 };
        var q = pipe(x);
        return { faction: q.text, status: parseInt(String(q.src).replace('−', '-'), 10) || 0 };
      }).filter(function (x) { return x.faction; });
      OWED = c.owed;
      NPCS = (Array.isArray(c.npcs) ? c.npcs : []).filter(function (n) { return n && n.name; }).map(function (n) {
        return { name: String(n.name), role: String(n.role || ''), faction: bare(n.faction || ''), district: String(n.district || ''),
                 glance: String(n.glance || ''), say: rawList(n.say), playedBy: String(n.playedBy || ''), mannerism: String(n.mannerism || '') };
      });
      var nm = isObj(c.names) ? c.names : {};
      var first = rawList(nm.first), family = rawList(nm.family);
      // No names in the pack: one invented placeholder each (the vault's six fallback names are its own text).
      NAMES = first.length && family.length ? { first: first, family: family } : { first: ['Nameless'], family: ['Stranger'] };
      con.controls = buildControls();
      con.situationControls = con.controls.filter(function (c) { return c.id !== 'result'; });
    }

    function buildControls() {
      var opt = function (label, value) { return { label: label, value: value }; };
      var npc = [opt('someone neutral, 2d', '')];
      PCS.forEach(function (p) {
        p.friend.forEach(function (f) { npc.push(opt(f + ' (' + p.first + "'s friend), 3d", 'friend:' + f)); });
        p.rival.forEach(function (r) { npc.push(opt(r + ' (' + p.first + "'s rival), 1d", 'rival:' + r)); });
      });
      STANDING.forEach(function (s) {
        npc.push(opt(s.faction + ' (' + (s.status >= 0 ? '+' : '') + s.status + '), ' + Math.max(0, s.status + 2) + 'd', 'fac:' + s.faction));
      });
      return [
        { id: 'pos', label: 'Position', type: 'select', row: 0, options: POSITIONS.map(function (p) { return opt(p, p); }) },
        { id: 'result', label: 'Result', type: 'select', row: 0, options: [opt('either', ''), opt('4/5', '45'), opt('1–3', '13')] },
        { id: 'scene', label: 'Scene', type: 'select', row: 0,
          options: [opt('any', '')].concat(Object.keys(T.scene).map(function (k) { return opt(String(isObj(T.scene[k]) && T.scene[k].label != null ? T.scene[k].label : k).toLowerCase(), k); })) },
        { id: 'district', label: 'District', type: 'select', row: 0, options: [opt('any', '')].concat((T.district || []).map(function (d) { return opt(d, d); })) },
        { id: 'pc', label: 'Aim at', type: 'select', row: 1, options: [opt('anyone', '')].concat(PCS.map(function (p) { return opt(p.first, p.name); })) },
        { id: 'npc', label: 'NPC is', type: 'select', row: 1, options: npc },
        { id: 'threat', label: 'Threat on screen', type: 'text', row: 2, placeholder: 'the danger everyone can see: a consequence or a bargain spends it' }
      ];
    }
    // Is this NPC control value one the campaign holds? (friend:/rival: on a sheet, fac: on the board)
    function npcKnown(v) {
      if (v.indexOf('friend:') === 0) return PCS.some(function (p) { return p.friend.indexOf(v.slice(7)) >= 0; });
      if (v.indexOf('rival:') === 0) return PCS.some(function (p) { return p.rival.indexOf(v.slice(6)) >= 0; });
      if (v.indexOf('fac:') === 0) return STANDING.some(function (s) { return s.faction === v.slice(4); });
      return false;
    }

    // --- Per-roll state (set by roll(); the rollers below read it, exactly as view.js's UI / MEM / Math.random) --
    // D is the roll's detail: what it drew, which lines are coaching (annotate() reads it; the card never shows it).
    var UI, MEM, R, DOTS, out, D;
    var DETAILS = typeof WeakMap === 'function' ? new WeakMap() : null;
    var rnd = function () { return R(); };
    var pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
    var pickOr = function (a, fallback) { return has(a) ? pick(a) : fallback; };
    var d6 = function () { return 1 + Math.floor(rnd() * 6); };
    function fresh(key, list, keyFn) {
      keyFn = keyFn || function (x) { return x; };
      var used = MEM[key] || (MEM[key] = []);
      var pool = list.filter(function (x) { return used.indexOf(keyFn(x)) < 0; });
      var from = pool.length ? pool : list;
      var choice = from[Math.floor(rnd() * from.length)];
      var winSize = Math.max(1, Math.min(20, Math.floor(list.length / 2)));
      used.push(keyFn(choice));
      if (used.length > winSize) used.shift();
      return choice;
    }
    // fresh() over a list the pack may not hold: the fallback, with no draw, when it is missing or empty.
    function freshOr(key, list, fallback, keyFn) { return has(list) ? fresh(key, list, keyFn) : fallback; }
    function weighted(items) {          // [[weight, value], ...]
      var total = items.reduce(function (s, x) { return s + x[0]; }, 0);
      var r = rnd() * total;
      for (var i = 0; i < items.length; i++) { if ((r -= items[i][0]) < 0) return items[i][1]; }
      return items[items.length - 1][1];
    }
    var castNames = function () { return CAST.map(function (c) { return c.text; }); };
    function fill(s) {
      var facs = castNames().length ? castNames() : T.faction;
      return String(s).replace(/\{faction\}|\{f\}/g, function () { return freshOr('faction', facs, 'a faction'); })
              .replace(/\{district\}/g, function () { return UI.district || freshOr('district', T.district, 'the district'); })
              .replace(/\{clock\}/g, function () { return freshOr('clock', T.clock, 'a clock'); });
    }

    var sceneOf = function () { return UI.scene ? T.scene[UI.scene] : null; };
    var scLabel = function (sc) { return String(sc && sc.label != null ? sc.label : UI.scene).toLowerCase(); };
    var sevOf = function () { return sevNorm(T.severity[UI.pos]); };
    var pcOf = function () { return PCS.find(function (p) { return p.name === UI.pc; }) || null; };
    var threat = function () { return (UI.threat || '').trim(); };
    var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
    var resLabel = function (r) { return r === '45' ? '4/5' : r === '13' ? '1–3' : ''; };
    var dotsOf = function (p, attr) {
      var d = DOTS && DOTS[p.name];
      return d && d[attr] != null && isFinite(Number(d[attr])) ? Number(d[attr]) : (Number(p[attr]) || 0);
    };
    var attrOf = function (sc) { return sc && sc.resist ? String(sc.resist) : 'prowess'; };
    // A scene's harm name for a level: the printed palette, or a neutral word when the pack has none.
    function harmName(sc, lvl) { var row = sc && Array.isArray(sc.harm) ? sc.harm[lvl - 1] : null; return has(row) ? pick(row) : 'harm'; }
    var spendOf = function (kind) { return isObj(T.spend) && T.spend[kind] ? String(T.spend[kind]) : '**{t}** lands.'; };
    var catOf = function (key, dflt) { return (isObj(T.cat) && key != null && T.cat[key]) || dflt; };
    function reactOf(idx) {
      var row = has(T.reaction) ? T.reaction[idx] : null;
      return Array.isArray(row) ? [str(row[0], REACT0[idx][0]), str(row[1], REACT0[idx][1])] : REACT0[idx];
    }
    function say3Of(name) { var s = isObj(T.say3) ? T.say3[name] : null; return Array.isArray(s) && s.length >= 3 ? s : SAY0; }

    // --- Card output (replaces head / say / grid / actions / dv.el) ---
    function chips(which) {
      var c = [];
      if (which.indexOf('aim') >= 0 && pcOf()) c.push('Aim: ' + pcOf().first);
      if (which.indexOf('threat') >= 0 && threat()) c.push('Threat: ' + (threat().length > 40 ? threat().slice(0, 38) + '…' : threat()));
      if (which.indexOf('district') >= 0 && UI.district) c.push('District: ' + UI.district);
      if (which.indexOf('result') >= 0 && UI.result) c.push('Result: ' + resLabel(UI.result));
      return c;
    }
    function head(title, sub, chipSet) {
      out = { title: title, sub: sub || '', chips: chips(chipSet || 'aim threat district result'), lines: [], all: [], actions: [], extra: {} };
    }
    function say(md, cls, small) {
      out.all.push(plain(small ? md + ' ' + small : md));
      var item = { kind: cls === 'read' ? 'read' : 'want', md: md };
      if (small) item.small = small;
      out.lines.push(item);
    }
    // A recurring guidance line: the same card as say(md, 'read'); annotate() marks it coach: true.
    function coach(md) { say(md, 'read'); D.coach.push(out.lines.length - 1); }
    function grid(rows) {
      out.lines.push({ kind: 'grid', rows: rows.map(function (r) { out.all.push(r[0] + ': ' + plain(r[1])); return { k: r[0], md: r[1] }; }) });
    }
    function action(label, intent) { out.actions.push({ label: label, intent: intent }); }
    function spentButton() { if (threat()) action('Threat spent: clear it', { type: 'threatSpent' }); }

    function resistRows(attr) {
      if (!PCS.length) return [['Resist', '**' + cap(attr) + '**: stress costs 6 − highest die; two 6s clear 1']];
      var who = pcOf() ? [pcOf()] : PCS;
      var lines = who.map(function (p) {
        var n = dotsOf(p, attr), od = resistOdds(n);
        var dice = n < 1 ? '0d (2d keep lowest)' : n + 'd';
        return '**' + p.first + '** ' + dice + ' → ~' + od.avg.toFixed(1) + ' stress, free ' + Math.round(od.free * 100) + '%';
      });
      return [['Resist', '**' + cap(attr) + '** · ' + lines.join(' · ')]];
    }

    // ---- 1 Devil's Bargain ----
    function composeBargain() {
      var t = threat();
      if (t) return { line: 'Whatever you roll, the threat lands anyway: **' + t + '**.', cat: 'the danger you telegraphed, landing regardless (name its cost from the seven, BitD p.21)', anchor: 'the threat on screen', kind: 'threat', short: t };

      // A scene's bargain list weighs in whenever the pack names one (as the vault did, even an empty one); an empty
      // or broken list, drawn, reads as the generic bargain below instead of throwing.
      var pc = pcOf(), sc = UI.scene && isObj(T.dbScene) ? T.dbScene[UI.scene] : null;
      var hooksOf = function (p) { return ['wont', 'friend', 'rival', 'extra'].filter(function (h) { return p[h].length; }); };
      var pool = [];
      if (pc && hooksOf(pc).length) pool.push([5, 'pc']);   // aiming means it: their own lines lead
      if (sc) pool.push([2, 'scene']);
      if (CAST.length) pool.push([2, 'cast']);
      if (CALLBACKS.length) pool.push([1, 'callback']);
      var kind = pool.length ? weighted(pool) : 'generic';

      if (kind === 'pc') {
        var h = fresh('aimHook:' + pc.name, hooksOf(pc));
        var x = pick(pc[h]);
        var tpl = pickOr(isObj(T.aim) ? T.aim[h] : null, 'It costs **{x}**.');
        return { line: String(tpl).replace('{x}', x), cat: catOf(isObj(T.aimCat) ? T.aimCat[h] : null, "the player's own price"),
                 anchor: pc.first + "'s sheet: " + (h === 'wont' ? "their Won't" : h === 'extra' ? 'a bargain they wrote' : h), kind: kind, short: x };
      }
      if (kind === 'scene' && has(sc)) {
        var s = fresh('dbScene:' + UI.scene, sc, function (y) { return y[1]; });
        var sl = fill(str(s[1], ''));
        return { line: sl, cat: catOf(s[0], str(s[0], 'a price')), anchor: 'the ' + scLabel(T.scene[UI.scene]) + ' itself', kind: kind, short: sl };
      }
      if (kind === 'cast') {
        var fac = fresh('castFac', CAST, function (y) { return y.text; });
        var f = freshOr('dbFaction', T.dbFaction, DBF0, function (y) { return y[1]; });
        var fl = fill(str(f[1], '').replace(/\{f\}/g, fac.text));
        return { line: fl, cat: catOf(f[0], str(f[0], 'a price')), anchor: 'on the board: ' + fac.text + (fac.src ? ' (' + fac.src + ')' : ''), kind: kind, short: fl };
      }
      if (kind === 'callback') {
        var cb = fresh('callback', CALLBACKS, function (y) { return y.text; });
        return { line: 'Whatever you roll, this comes with it: **' + cb.text + '**', cat: 'a complication already in play', anchor: 'already in play: ' + (cb.src || 'the board'), kind: kind, short: cb.text };
      }
      var g = freshOr('dbGeneric', T.db, DBG0, function (y) { return y[1]; });
      var gl = fill(str(g[1], ''));
      return { line: gl, cat: catOf(g[0], str(g[0], 'a price')), anchor: 'generic: nothing on screen to hang it on', kind: 'generic', short: gl };
    }

    function devilsBargain() {
      var pc = pcOf();
      var dd = isObj(T.dbDistrict) ? T.dbDistrict : {};
      var pd = UI.district && isObj(dd[UI.district]) ? dd[UI.district] : null;
      var printed = pd && (Array.isArray(pd.scenes) ? pd.scenes : []).indexOf(UI.scene) >= 0 ? pd : null;
      // The arsenal row is a fight-only offer (the Veteran's), so the Veteran is only looked for in a fight.
      var veteran = UI.scene === 'fight'
        ? (pc ? (/veteran/i.test(pc.playbook) ? pc : null) : PCS.find(function (p) { return /veteran/i.test(p.playbook); }) || null)
        : null;
      var b = composeBargain();

      head("Devil's Bargain", UI.pos + ' · BitD p.21' + (printed ? ' · ' + UI.district : ''), 'aim threat district');
      var lead, who = pc ? pc.first : 'the crew';
      if (printed) {
        var ptext = str(printed.text, ''), ppage = str(printed.page, '');
        lead = UI.district + ' (' + ppage + '): ' + plain(ptext);
        say('**Want +1d?** Printed for **' + UI.district + '** (' + ppage + '): ' + ptext);
        grid([['Or', '**Want +1d?** ' + b.line], ['Category', b.cat], ['Anchor', b.anchor]]);
        D.bargains = [{ text: lead, label: ptext, who: who }, { text: plain(b.line), label: b.short, who: who }];
      } else {
        lead = plain(b.line);
        say('**Want +1d?** ' + b.line);
        grid([['Category', b.cat], ['Anchor', b.anchor]]);
        D.bargains = [{ text: lead, label: b.short, who: who }];
      }
      if (veteran && T.arsenal != null) grid([['Or, for ' + veteran.first, String(T.arsenal)]]);

      coach('**Say it before the dice.** +1d if accepted. It happens *whatever the roll*. They can refuse ' +
            'or counter-offer. **Never with a push.** Priced at about one push (2 stress).');
      if (b.kind === 'threat') spentButton();
      action('Accepted: they owe it', { type: 'bargainOwed', key: keyOf(lead), text: lead, who: who,
                                        capture: { bucket: 'x', text: 'Bargain owed (' + who + '): ' + lead } });
      out.extra.bargain = { kind: printed ? 'printed' : b.kind, anchor: b.anchor, cat: b.cat };
    }

    // ---- 2 Complication ----
    function complication() {
      var sv = sevOf();
      var sc = sceneOf();
      head('Complication', UI.pos + ' → ' + sv.sev + (sc ? ' · ' + scLabel(sc) : ' · oracle-tables §3'));
      if (threat()) { D.spend = spendOf('Complication').replace('{t}', threat()); say(D.spend); }
      if (sc) {
        var c = freshOr('comp:' + UI.scene, sc.comp, 'something gets in the way');
        D.drawAt = out.lines.length;
        say(c, threat() ? 'read' : 'want');
        grid([['Severity', '**' + sv.sev + '**: ' + sv.ticks + " on a clock if you'd rather tick than narrate"]]);
      } else {
        var s = freshOr('compSource', T.compSource, SRC0, function (x) { return x[0]; });
        var sh = freshOr('compShape', T.compShape, SHAPE0, function (x) { return x[0]; });
        D.drawAt = out.lines.length;
        say('**' + s[0] + ': ' + String(sh[0]).toLowerCase() + '.**', threat() ? 'read' : 'want', s[1] + '; ' + sh[1]);
        grid([['Source', '**' + s[0] + '**: ' + s[1]], ['Shape', '**' + sh[0] + '**: ' + sh[1]],
              ['Severity', '**' + sv.sev + '**: ' + sv.ticks + " on a clock if you'd rather tick than narrate"]]);
      }
      coach('At ' + UI.pos + ': ' + sv.menu + ". **Don't negate a success.** If they cornered the enemy on a 4/5, " +
            'the enemy stays cornered.');
      if (threat()) spentButton();
    }

    // ---- 3 Consequence ----
    function consequence() {
      var sv = sevOf();
      var sc = sceneOf();
      var al = isObj(T.allowed) && isObj(T.allowed[UI.pos]) ? T.allowed[UI.pos] : {};
      var a45 = has(al['45']) ? al['45'] : [], a13 = has(al['13']) ? al['13'] : [];
      // (either result: the vault's concat, kept as it was, so a pack with no 1-3 list still reads the same)
      var allow = UI.result ? (UI.result === '45' ? a45 : a13)
        : (has(al['45']) ? al['45'].concat(al['13']) : a13).filter(function (x, i, a) { return a.indexOf(x) === i; });
      var rows0 = has(T.consequence) ? T.consequence : [CONS0];
      if (!allow.length) allow = rows0.map(function (x) { return x[0]; });
      var list = rows0.filter(function (x) { return allow.indexOf(x[0]) >= 0; });
      if (!list.length) list = rows0;
      var c = fresh('cons:' + UI.pos + UI.result, list, function (x) { return x[0]; });
      var kind = str(c[0], CONS0[0]);
      head('Consequence', UI.pos + (UI.result ? ' ' + resLabel(UI.result) : '') + ' → ' + sv.sev + (sc ? ' · ' + scLabel(sc) : '') + ' · BitD p.23, p.30–31');

      if (threat()) { D.spend = spendOf(kind).replace('{t}', threat()); say(D.spend, 'want', kind); }
      else say('**' + kind + '**');

      var hl = UI.pos === 'controlled' ? '1 (lesser)' : String(sv.lvl);
      var example = '*' + str(c[2], '') + '*';
      if (sc) {
        if (kind === 'Reduced effect') example = str(sc.reduced, example);
        else if (kind === 'Lost opportunity') example = str(sc.lost, example);
        else if (kind === 'Worse position') example = str(sc.worse, example);
        else if (kind === 'Complication') example = freshOr('comp:' + UI.scene, sc.comp, example);
        else if (kind === 'Harm') example = 'Level ' + hl + ': **' + harmName(sc, sv.lvl) + '**';
      } else if (kind === 'Harm') {
        example = 'Level ' + hl + ': ' + str(c[2], '');
      }
      D.kind = kind; D.example = example; D.row = c; D.level = hl; D.lvl = sv.lvl; D.scene = !!sc;
      var rows = [['What it is', str(c[1], '')], ['Like', example],
                  ['Severity', '**' + sv.sev + '** · a complication here is worth **' + sv.ticks + '**'],
                  ['Fits', UI.pos + (UI.result ? ' ' + resLabel(UI.result) : '') + ': ' + allow.join(' · ')]];
      if (kind === 'Harm') rows.push.apply(rows, resistRows(attrOf(sc)));
      else rows.push(['Resist', "Prowess if it's physical · Insight if it's a trick · Resolve if it's nerve. Cost 6 − highest die"]);
      grid(rows);
      coach(threat()
        ? "**You telegraphed it; now it lands.** That's why it doesn't feel invented after a bad roll."
        : '**Telegraph first.** Type the danger in *Threat on screen* before the roll, then a 4/5 spends the thing everyone already saw.');
      spentButton();
    }

    // ---- 4 Pay the price ----
    function priceRow(r) {
      if (!has(T.price)) return PRICE0;
      return T.price.find(function (x) { return r >= x[0] && r <= x[1]; }) || T.price[T.price.length - 1];
    }
    function priceText(row) {
      var lvl = sevOf().lvl;
      if (row[0] === 51) return '**Harm, level ' + (UI.pos === 'controlled' ? '1 (lesser)' : lvl) + '** (' + UI.pos + ').' +
        (sceneOf() ? ' Like: **' + harmName(sceneOf(), lvl) + '**.' : '');
      if (row[0] === 61) {
        if (OWED.length) { var ow = fresh('owed', OWED, function (x) { return x.text; }); D.due.push(ow); return "**A devil's bargain comes due:** " + ow.text + (ow.src ? ' *(' + ow.src + ')*' : ''); }
        return str(row[2], '') + ' *No bargains on file. Read it as something they did earlier coming back.*';
      }
      return str(row[2], '');
    }
    function payThePrice() {
      var r = d6() * 10 + d6();
      var row = priceRow(r);
      D.due = [];
      head('Pay the price', 'd66 → ' + r + ' · ' + UI.pos + (UI.result ? ' ' + resLabel(UI.result) : '') + ' · oracle-tables §9');
      out.extra.d66 = r;
      if (row[0] === 66) {
        say(str(row[2], ''));
        var extra = [];
        while (extra.length < 2) { var r2 = d6() * 10 + d6(); if (r2 !== 66) extra.push([r2, priceRow(r2)]); }
        grid(extra.map(function (e) { return ['d66 ' + e[0], priceText(e[1])]; }));
        row = null;
      } else {
        say(priceText(row));
        if (row[0] === 21 && UI.result === '13') {
          grid([['Flag', "On a 1–3, *reduced effect* isn't on BitD's failure list (p.23). Read it as **they get nothing usable**, or roll again. `[flagged for Alex]`"]]);
        }
      }
      if (threat()) say('Make it come from **' + threat() + '**.', 'read');
      coach('**Reach for this third, not first.** Draw the obvious conclusion, then pick between two ' +
            'options, *then* roll here. **Adapt, don\'t read out.**');
      if (row && row[0] === 61 && OWED.length) {
        var shown = out.all[0] || '';
        var o2 = OWED.find(function (x) { return shown.indexOf(plain(x.text).slice(0, 30)) >= 0; });
        if (o2) action('Collected: strike it off', { type: 'bargainCollected', key: keyOf(o2.text), text: o2.text });
      }
    }

    // ---- 5 NPC reaction ----
    function reaction() {
      var pool = 2, who = 'someone neutral';
      var v = UI.npc || '';
      if (v.indexOf('friend:') === 0) { pool = 3; who = v.slice(7) + ', a friend'; }
      else if (v.indexOf('rival:') === 0) { pool = 1; who = v.slice(6) + ', a rival'; }
      else if (v.indexOf('fac:') === 0) {
        var s = STANDING.find(function (x) { return x.faction === v.slice(4); });
        pool = Math.max(0, (s ? s.status : 0) + 2);
        who = v.slice(4) + ' (status ' + (s && s.status >= 0 ? '+' : '') + (s ? s.status : 0) + ')';
      }
      var r = poolRoll(pool, rnd);
      var res = reactOf(r.idx);
      head('NPC reaction', who + ' · ' + pool + 'd' + (pool < 1 ? ' (2d keep lowest)' : '') + ' · Alone in the Dark', 'aim');
      say('**' + res[0] + '**: ' + res[1]);
      var s3 = say3Of(res[0]);
      var rows = [['Say it', '**' + s3[0] + '** · *' + s3[1] + '* · *' + s3[2] + '*. Three sentences, then stop and look at the player']];
      var nm = v.indexOf(':') >= 0 && v.indexOf('fac:') !== 0 ? v.slice(v.indexOf(':') + 1) : '';
      var card = nm ? NPCS.find(function (n) { return n.name.toLowerCase() === nm.toLowerCase(); }) : null;
      var pr = card ? playRow(card) : null;
      if (pr) rows.push(pr);
      rows.push(['Roll', '[' + r.dice.join(' ') + '] → ' + (r.crit ? '**critical**' : r.best)],
                ['Pool', 'Set it in **NPC is**: 3d friend · 2d neutral · 1d rival · faction status +2d (from the board\'s `standing:`)']);
      grid(rows);
      coach('On *Conditional*, the price should cost the crew something the **players** care about. ' +
            'Stacks is the boring answer. If the players reached for this person, **give them a crumb, never silence**.');
      D.result = res[0];
      out.extra.reaction = { pool: pool, dice: r.dice, best: r.best, crit: r.crit, result: res[0], npc: card ? card.name : null };
    }
    function playRow(n) {
      if (!n || (!n.playedBy && !n.mannerism)) return null;
      var bits = [];
      if (n.playedBy) bits.push('played by **' + n.playedBy + '**');
      if (n.mannerism) bits.push(n.mannerism);
      return ['Play', bits.join(' · ')];
    }

    // ---- 6 Callback ----
    function callback() {
      var sv = sevOf();
      head('Callback', UI.pos + ' → ' + sv.sev + ' · trouble already in play');
      if (!CALLBACKS.length) {
        say('**No callbacks on file.** Add lines to the `callbacks:` property of **b68g-factions** ' +
            '(`what happens | where it comes from`), rebuild the GM pack, and they\'ll turn up here.');
        return;
      }
      var pc = pcOf();
      var list = CALLBACKS;
      if (pc) {
        var names = [pc.first].concat(pc.friend, pc.rival).map(function (s) { return s.toLowerCase(); });
        var mine = CALLBACKS.filter(function (c) { return names.some(function (n) { return (c.text + ' ' + c.src).toLowerCase().indexOf(n) >= 0; }); });
        if (mine.length) list = mine;
      }
      var c = fresh('callback' + (pc ? ':' + pc.name : ''), list, function (x) { return x.text; });
      say(c.text);
      grid([['Comes from', c.src || '–'], ['Severity', '**' + sv.sev + '**: ' + sv.ticks + ' if it ticks a clock']]);
      coach('**The cheapest complication is one they already caused.** A name they know beats a stranger.');
      action('Used: retire it from the board', { type: 'callbackUsed', key: keyOf(c.text), text: c.text });
    }

    // ---- 7 Harm & resist ----
    function harm() {
      var sv = sevOf();
      var sc = sceneOf();
      var hl = UI.pos === 'controlled' ? '1 (lesser)' : String(sv.lvl);
      head('Harm & resist', UI.pos + ' → level ' + hl + (sc ? ' · ' + scLabel(sc) : ''));
      // No scene: the vault's fixed three are the fight palette's first column; read from T, not repeated here.
      var fh = isObj(T.scene.fight) ? T.scene.fight.harm : null;
      var dflt = Array.isArray(fh) ? fh.map(function (h) { return has(h) ? h[0] : 'harm'; }) : ['harm', 'harm', 'harm'];
      var name = sc ? harmName(sc, sv.lvl) : str(dflt[sv.lvl - 1], 'harm');
      say((threat() ? '**' + threat() + '**: ' : '') + 'level ' + hl + ': **' + name + '**');
      grid([['Level', '**' + sv.lvl + '** (' + sv.sev + ') · controlled 1 · risky 2 · desperate 3 · level 4 is mortal']]
        .concat(resistRows(attrOf(sc)),
          [['Armour', '**Armour** (3 load) or a hull: **−1 level to all physical harm, every time.** **Light armour** (2 load) negates one instance. Total armour by choice to resist one instance fully (p.153)'],
           ['Hard mode', '**One resistance roll per consequence.** Say before they roll whether resisting reduces it a level or avoids it']]));
      coach("**'68: harm has no in-score penalty** (p.152). Write it down and keep playing; it bites in the " +
            "aftermath's harm-complication roll (p.192).");
      spentButton();
    }

    // ---- 8 Contact ----
    function contact() {
      var pc = pcOf();
      var pairs = [];
      (pc ? [pc] : PCS).forEach(function (p) { p.friend.forEach(function (f) { pairs.push([p, f]); }); });
      head('Contact', 'the friend answers · never silence', 'aim');
      if (!pairs.length) {
        say('**No friends on the sheets.** Add `friends:` to a character sheet, rebuild the GM pack, and they\'ll answer here.');
        return;
      }
      // ui.contact (a hint only situations set): the friend the GM chose answers, no draw
      var hint = String(UI.contact || '').toLowerCase();
      var mine = hint ? pairs.filter(function (x) { return String(x[1]).toLowerCase() === hint; }) : [];
      var pf = mine.length ? mine[0] : fresh('contact', pairs, function (x) { return x[1]; }), p = pf[0], f = pf[1];
      var r = poolRoll(3, rnd);
      var res = reactOf(r.idx)[0];
      var bit = freshOr('crumbBit', T.crumbBits, 'something small but real');
      var crumb = (isObj(T.crumb) && T.crumb[res] != null ? String(T.crumb[res]) : '**a crumb**: {c}').replace('{c}', bit);
      say('**' + f + '** (' + p.first + "'s friend): " + crumb);
      var rows = [['Roll', '3d friend [' + r.dice.join(' ') + '] → **' + res + '**']];
      var s3 = say3Of(res);
      rows.unshift(['Say it', '**' + s3[0] + '** · *' + s3[1] + '* · *' + s3[2] + '*']);
      var pr = playRow(NPCS.find(function (n) { return n.name.toLowerCase() === String(f).toLowerCase(); }));
      if (pr) rows.unshift(pr);
      if (r.best === 6) rows.push(['And', '**Tick one open clock** this contact could move, once (Find a Buyer, say).']);
      rows.push(['+1d', f + ' can also help a downtime roll as a friend (+1d).']);
      grid(rows);
      coach("**Session 1's lesson:** the players reached for a contact three times and got silence three times. A crumb keeps the thread alive.");
      D.result = res;
      out.extra.contact = { name: f, pc: p.name, dice: r.dice, result: res };
    }

    // ---- 9 Face ----
    function face() {
      var cast = castNames().map(function (s) { return s.toLowerCase(); });
      var contacts = [];
      PCS.forEach(function (p) { contacts.push.apply(contacts, p.friend.concat(p.rival).map(function (s) { return s.toLowerCase(); })); });
      var pool = [];
      NPCS.forEach(function (n) {
        var w = 0;
        if (UI.district && n.district && n.district.toLowerCase() === UI.district.toLowerCase()) w += 3;
        if (n.faction && cast.some(function (c) { return c === n.faction.toLowerCase(); })) w += 2;
        if (contacts.indexOf(n.name.toLowerCase()) >= 0) w += 1;
        if (w) pool.push([w, n]);
      });
      head('Face', (UI.district ? UI.district + ' · ' : '') + 'someone with a name', 'district');
      if (pool.length && d6() > 1) {
        var n = weighted(pool);
        var line = n.say.length ? pick(n.say) : '';
        say('**' + n.name + '**' + (n.role ? ': ' + n.role : ''));
        if (line) say('*' + line + '*', 'read');
        var rows = [];
        if (n.glance) rows.push(['Look', n.glance]);
        var pr = playRow(n);
        if (pr) rows.push(pr);
        rows.push(['Page', '[[' + n.name + ']]' + (n.faction ? ' · ' + n.faction : '') + (n.district ? ' · ' + n.district : '')]);
        grid(rows);
        out.extra.face = { npc: n.name, name: n.name };
      } else {
        var nm = pick(NAMES.first) + ' ' + pick(NAMES.family);
        var fac = castNames().length ? fresh('faceFac', castNames()) : '';
        say('**' + nm + '**' + (fac ? ', with ' + fac : ''));
        grid([['Names', "'68 p.18 / p.434, via the NPC generator"],
              ['Want more?', '`N` opens the NPC generator in the side panel.']]);
        out.extra.face = { npc: null, name: nm };
      }
      coach('**Name the opposition.** A named rider gets angry when his mate dies; an anonymous one doesn\'t (s01, lesson 4).');
    }

    var FN = { devilsBargain: devilsBargain, complication: complication, consequence: consequence, payThePrice: payThePrice,
               reaction: reaction, callback: callback, harm: harm, contact: contact, face: face };

    // The controls, cleaned: an unknown position / result / scene reads as the default; a district, PC or NPC the
    // pack no longer holds reads as "any" (a stale control from an older pack never labels a stranger a friend).
    // A district is checked against T.district only when the pack has that list (check() reports it when it does not).
    function sanitise(ui) {
      var u = Object.assign({}, LIVE0, isObj(ui) ? ui : {});
      Object.keys(LIVE0).forEach(function (k) { u[k] = u[k] == null ? '' : String(u[k]); });
      if (!T.severity[u.pos]) u.pos = LIVE0.pos;
      if (u.result !== '45' && u.result !== '13') u.result = '';
      if (u.scene && !T.scene[u.scene]) u.scene = '';
      if (u.district && has(T.district) && T.district.indexOf(u.district) < 0) u.district = '';
      if (u.pc && !PCS.some(function (p) { return p.name === u.pc; })) u.pc = '';
      if (u.npc && !npcKnown(u.npc)) u.npc = '';
      u.threat = u.threat.trim();
      if ('contact' in u) { u.contact = u.contact == null ? '' : String(u.contact); if (!u.contact) delete u.contact; }
      return u;
    }

    con.buttons = BUTTONS.map(function (b) { return Object.assign({}, b); });
    con.defaults = function () { return Object.assign({}, LIVE0); };
    con.mem = function () { return instMem; };
    con.check = function () { return check(T); };
    con.setCampaign = function (campaign, state) { load(campaign, state); return con; };
    con.roll = function (id, ui, ro) {
      var r = ro || {};
      var b = BUTTONS.find(function (x) { return x.id === id || x.n === Number(id); });
      var fnId = b ? b.id : 'devilsBargain';
      var seed = r.seed == null || !isFinite(Number(r.seed)) ? newSeed() : Number(r.seed) >>> 0;
      var mem = isObj(r.mem) ? r.mem : instMem;
      var memBefore = clone(mem);
      var u = sanitise(ui);
      UI = u; MEM = mem; R = seedRng(seed); DOTS = isObj(ui) && isObj(ui.dots) ? ui.dots : null; D = { coach: [] };
      try { FN[fnId](); }
      finally { UI = null; MEM = null; R = null; DOTS = null; }
      var o2 = out, d = D; out = null; D = null;
      var t = (o2.all[0] || '').replace(/\s+/g, ' ');
      var meta = Object.assign({ id: fnId, n: BUTTONS.find(function (x) { return x.id === fnId; }).n,
        title: o2.title, sub: o2.sub, chips: o2.chips, text: o2.all[0] || '', all: o2.all,
        label: o2.title + ': ' + (t.length > 38 ? t.slice(0, 36) + '…' : t), actions: o2.actions }, o2.extra);
      var replayUi = Object.assign({}, u);
      if (isObj(ui) && isObj(ui.dots)) replayUi.dots = clone(ui.dots);
      var result = { lines: o2.lines, meta: meta, seed: seed, replay: { id: fnId, seed: seed, mem: memBefore, ui: replayUi } };
      if (DETAILS) DETAILS.set(result, d);
      return result;
    };

    // --- annotate(): the roll read for the table. Classic output above is never touched; this returns a new object.
    var AUTHOR_TAG = /\s*`?\[(?:flagged for [^\]]*|TODO:?[^\]]*)\]`?/gi;
    var untag = function (s) { return String(s).replace(AUTHOR_TAG, ''); };
    function copyLine(l) {
      if (l.kind === 'grid') return { kind: 'grid', rows: (l.rows || []).map(function (r) { return { k: untag(r.k), md: untag(r.md) }; }) };
      var o = { kind: l.kind, md: untag(l.md) };
      if (l.small != null) o.small = untag(l.small);
      return o;
    }
    function textOf(lines) {
      var all = [];
      lines.forEach(function (l) {
        if (l.kind === 'grid') l.rows.forEach(function (r) { all.push(r.k + ': ' + plain(r.md)); });
        else all.push(plain(l.small ? l.md + ' ' + l.small : l.md));
      });
      return all;
    }
    var short = function (t, n) { t = plain(t); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
    // The Harm row without a scene lists one example per level ("Level 1 X · Level 2 Y · …"): this level's entry.
    function levelExample(d) {
      var parts = String(d.row && d.row[2] || '').split(' · ');
      var re = new RegExp('^Level ' + d.lvl + '\\b\\s*:?\\s*');
      var hit = parts.map(function (p) { return p.trim(); }).find(function (p) { return re.test(p); });
      if (!hit) return null;
      var name = hit.replace(re, '').replace(/[.\s]+$/, '');
      return name ? 'Level ' + d.level + ': **' + name + '**' : null;
    }
    function annotate(res) {
      var d = DETAILS && res ? DETAILS.get(res) : null;
      var lines = (res && res.lines || []).map(copyLine);
      var meta = clone(res && res.meta);
      var detail = { coach: [] };
      if (d) {
        d.coach.forEach(function (i) { if (lines[i]) lines[i].coach = true; });
        if (meta.id === 'consequence' && d.kind) {
          var ex = d.example;
          if (d.kind === 'Harm' && !d.scene) ex = levelExample(d) || ex;
          var want = { kind: 'want', md: '**' + d.kind + '** — ' + ex };
          if (d.spend) want.small = d.spend;
          lines[0] = want;
          lines.forEach(function (l) { if (l.kind === 'grid') l.rows = l.rows.filter(function (r) { return r.k !== 'Like'; }); });
          detail.kind = d.kind; detail.example = plain(ex); detail.level = d.level;
        }
        if (meta.id === 'complication' && d.drawAt != null && lines[d.drawAt]) {
          var draw = lines[d.drawAt];
          detail.draw = plain(draw.md);
          if (d.spend) {                       // a threat: the drawn complication leads, the spend sentence under it
            lines.splice(d.drawAt, 1);
            lines[0] = { kind: 'want', md: draw.md, small: d.spend };
          }
        }
        if (d.bargains && d.bargains.length > 1) {
          meta.actions = meta.actions.filter(function (a) { return a.intent.type !== 'bargainOwed'; }).concat(d.bargains.map(function (b) {
            return { label: 'Accepted: ' + short(b.label, 28), intent: { type: 'bargainOwed', key: keyOf(b.text), text: b.text, who: b.who,
                     capture: { bucket: 'x', text: 'Bargain owed (' + b.who + '): ' + b.text } } };
          }));
          detail.bargains = d.bargains.map(function (b) { return b.text; });
        }
        if (d.due) {                         // Pay the price: every bargain that came due (the 66's extras included)
          var have = meta.actions.filter(function (a) { return a.intent.type === 'bargainCollected'; });
          d.due.forEach(function (ow) {
            if (have.some(function (a) { return a.intent.text === ow.text; })) return;
            var a = { label: 'Collected: strike it off', intent: { type: 'bargainCollected', key: keyOf(ow.text), text: ow.text } };
            meta.actions.push(a); have.push(a);
          });
          if (have.length > 1) have.forEach(function (a) { a.label = 'Collected: ' + short(a.intent.text, 28); });
          detail.due = d.due.map(function (ow) { return ow.text; });
        }
        if (d.result) detail.result = d.result;
      }
      // where the coaching lines sit in the NEW lines (a threat's complication moves its draw up)
      lines.forEach(function (l, i) { if (l.coach) detail.coach.push(i); });
      meta.all = textOf(lines);
      meta.text = lines.length ? (lines[0].kind === 'grid' ? meta.all[0] : plain(lines[0].md)) : '';
      var t = meta.text.replace(/\s+/g, ' ');
      meta.label = meta.title + ': ' + (t.length > 38 ? t.slice(0, 36) + '…' : t);
      return { lines: lines, meta: meta, seed: res.seed, replay: res.replay, detail: detail };
    }
    con.annotate = annotate;

    // --- Situations: composed cards. Each section is a classic con.roll() read through annotate(). -------------------
    var sec = function (id, role, result, extraUi) { return { id: id, role: role, result: result, ui: extraUi || null }; };
    function leadFor(sid, u) {
      var npc = u.npc || '';
      if (sid === 'before') return sec('devilsBargain', 'lead', '');
      if (sid === 'fourfive') return sec('consequence', 'lead', '45');
      if (sid === 'onetothree') return sec('consequence', 'lead', '13');
      if (npc.indexOf('friend:') === 0) {                                      // the chosen friend answers
        var friend = npc.slice(7), owner = PCS.find(function (pc) { return pc.friend.indexOf(friend) >= 0; });
        return sec('contact', 'lead', '', owner ? { pc: owner.name, contact: friend } : { contact: friend });
      }
      if (npc) return sec('reaction', 'lead', '');                             // a rival or a faction: that pool
      return sec('face', 'lead', '');                                          // nobody set: a name, then 2d
    }
    // The Or rows by slot (1..3), decided once the lead is drawn: never a twin of the lead's kind.
    function orsFor(sid, u, lead) {
      var npc = u.npc || '', kind = lead && lead.kind || '';
      if (sid === 'fourfive') return [
        kind === 'Complication' ? sec('payThePrice', 'or', '45') : sec('complication', 'or', '45'),
        CALLBACKS.length ? sec('callback', 'or', '45') : null,
        npc ? sec('reaction', 'or', '45') : null];
      if (sid === 'onetothree') return [
        sec('payThePrice', 'or', '13'),
        kind === 'Harm' ? (CALLBACKS.length ? sec('callback', 'or', '13') : null) : sec('harm', 'or', '13'),
        npc ? sec('reaction', 'or', '13') : null];
      if (sid === 'someone' && !npc) return [sec('reaction', 'or', '')];
      return [];
    }

    con.situations = function () { return SITUATIONS.map(function (x) { return Object.assign({}, x); }); };
    con.positions = POSITIONS.filter(function (k) { return T.severity[k]; }).map(function (k) {
      var sv = sevNorm(T.severity[k]);
      return { value: k, label: k, severity: sv.sev, ticks: sv.ticks, harm: k === 'controlled' ? '1 (lesser)' : String(sv.lvl) };
    });
    con.situationDefaults = function () { var d = Object.assign({}, LIVE0); delete d.result; return d; };
    con.situation = function (id, ui, ro) {
      var r = ro || {};
      var sit = SITUATIONS.find(function (x) { return x.id === id || x.key === Number(id); }) || SITUATIONS[0];
      var seed = r.seed == null || !isFinite(Number(r.seed)) ? newSeed() : Number(r.seed) >>> 0;
      var mem = isObj(r.mem) ? r.mem : instMem;
      var memBefore = clone(mem);
      var u = sanitise(ui); u.result = ''; delete u.contact;
      var dots = isObj(ui) && isObj(ui.dots) ? ui.dots : null;
      // Section seeds: a second mulberry32 stream from the card's seed, four draws always (one per slot), so a
      // section's seed never depends on which others appear.
      var r2 = seedRng(seed);
      var seeds = [0, 1, 2, 3].map(function () { return (r2() * 4294967296) >>> 0; });
      var sv = sevNorm(T.severity[u.pos]);
      var harmLvl = u.pos === 'controlled' ? '1 (lesser)' : String(sv.lvl);
      var posChip = u.pos + ' → ' + sv.ticks + ' · harm ' + harmLvl;

      function section(p, slot) {
        var su = Object.assign({}, u, p.ui || {}, { result: p.result });
        if (dots) su.dots = dots;
        var c = con.roll(p.id, su, { seed: seeds[slot], mem: mem });
        var a = annotate(c);
        var ch = a.meta.chips.filter(function (x) { return x.indexOf('Result: ') !== 0; });
        if (p.role === 'lead') ch.unshift(posChip);
        return { id: p.id, role: p.role, slot: slot, title: a.meta.title, lead: cut(a.meta.text), sub: a.meta.sub, chips: ch,
                 lines: a.lines, actions: a.meta.actions, meta: a.meta, detail: a.detail, seed: seeds[slot], replay: c.replay };
      }
      var sections = [section(leadFor(sit.id, u), 0)];
      orsFor(sit.id, u, sections[0].detail).forEach(function (p, i) { if (p) sections.push(section(p, i + 1)); });

      var actions = [], seen = {}, chips = [], lines = [], all = [];
      sections.forEach(function (s) {
        s.actions.forEach(function (a) {
          var k = JSON.stringify(a.intent);
          if (seen[k]) return;
          seen[k] = 1; actions.push({ label: a.label, intent: a.intent, from: s.id });
        });
        s.chips.forEach(function (c) { if (chips.indexOf(c) < 0) chips.push(c); });
        Array.prototype.push.apply(lines, s.lines);
        Array.prototype.push.apply(all, s.meta.all);
      });
      var title = { before: 'Before the roll', fourfive: 'A 4/5', onetothree: 'A 1–3', someone: 'Someone' }[sit.id];
      var text = sections[0].meta.text;
      var t = text.replace(/\s+/g, ' ');
      var meta = { id: SITUATION_ID, situation: sit.id, n: sit.key, composeVersion: COMPOSE_VERSION, title: title,
        sub: u.pos + ' → ' + sv.sev, chips: chips, position: { pos: u.pos, severity: sv.sev, ticks: sv.ticks, harm: harmLvl },
        text: text, all: all, label: title + ': ' + (t.length > 38 ? t.slice(0, 36) + '…' : t), actions: actions,
        sections: sections.map(function (s) { return { id: s.id, role: s.role, slot: s.slot, title: s.title, seed: s.seed }; }) };
      ['bargain', 'd66', 'reaction', 'contact', 'face'].forEach(function (k) {
        for (var i = 0; i < sections.length; i++) if (k in sections[i].meta) { meta[k] = sections[i].meta[k]; break; }
      });
      var from = r.composeVersion == null ? null : (Number(r.composeVersion) || 1);
      if (from != null && from !== COMPOSE_VERSION) meta.recomposed = { from: from, to: COMPOSE_VERSION };
      var replayUi = Object.assign({}, u);
      if (dots) replayUi.dots = clone(dots);
      return { lines: lines, meta: meta, sections: sections, seed: seed,
               replay: { id: SITUATION_ID, situation: sit.id, seed: seed, mem: memBefore, ui: replayUi, composeVersion: COMPOSE_VERSION } };
    };
    con.replay = function (rp) {
      var x = rp || {};
      if (x.id === SITUATION_ID) return con.situation(x.situation, x.ui, { seed: x.seed, mem: clone(x.mem), composeVersion: x.composeVersion == null ? 1 : x.composeVersion });
      return con.roll(x.id, x.ui, { seed: x.seed, mem: clone(x.mem) });
    };

    load(o.campaign, o.state);
    return con;
  }

  return {
    create: create, applyIntent: applyIntent, intentPatch: intentPatch, campaignWith: campaignWith, check: check,
    seedRng: seedRng, resistOdds: resistOdds, poolRoll: poolRoll, plain: plain, keyOf: keyOf,
    SITUATION_ID: SITUATION_ID, COMPOSE_VERSION: COMPOSE_VERSION, SITUATIONS: SITUATIONS.map(function (x) { return Object.assign({}, x); }),
    LIVE0: Object.assign({}, LIVE0), BUTTONS: BUTTONS.map(function (b) { return { n: b.n, id: b.id, label: b.label }; })
  };
});
