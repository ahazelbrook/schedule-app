/* gm/console.js — the GM console's nine rollers, as pure logic (no DOM, no storage, no network).
   A port of the vault's Dataview module (Tools/views/gm-console/view.js, 06/10/2026). The tables are NOT in this
   file: they arrive from the GM pack (part `console`, field `T`), and the campaign context from part `campaign`.
   Plain script, UMD: window.B68GmConsole in the browser, module.exports under Node.

   ---------------------------------------------------------------------------------------------------------------
   API (the UI author reads only this block)
   ---------------------------------------------------------------------------------------------------------------
   const con = B68GmConsole.create({ T, campaign, state, mem, seed })
       T         pack.parts.console.T (required)
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
       ui     the controls (merged over defaults()). Optional extra: ui.dots = { '<pc name>': { insight, prowess,
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
   con.setCampaign(campaign, state)  swap the campaign (and/or console state); rebuilds con.controls
   con.mem()        the instance's repeat-guard memory (the live object)

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
            · LIVE0 · BUTTONS (ids and labels only)
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
        { id: 'pos', label: 'Position', type: 'select', row: 0, options: ['controlled', 'risky', 'desperate'].map(function (p) { return opt(p, p); }) },
        { id: 'result', label: 'Result', type: 'select', row: 0, options: [opt('either', ''), opt('4/5', '45'), opt('1–3', '13')] },
        { id: 'scene', label: 'Scene', type: 'select', row: 0,
          options: [opt('any', '')].concat(Object.keys(T.scene).map(function (k) { return opt(String(T.scene[k].label).toLowerCase(), k); })) },
        { id: 'district', label: 'District', type: 'select', row: 0, options: [opt('any', '')].concat((T.district || []).map(function (d) { return opt(d, d); })) },
        { id: 'pc', label: 'Aim at', type: 'select', row: 1, options: [opt('anyone', '')].concat(PCS.map(function (p) { return opt(p.first, p.name); })) },
        { id: 'npc', label: 'NPC is', type: 'select', row: 1, options: npc },
        { id: 'threat', label: 'Threat on screen', type: 'text', row: 2, placeholder: 'the danger everyone can see: a consequence or a bargain spends it' }
      ];
    }

    // --- Per-roll state (set by roll(); the rollers below read it, exactly as view.js's UI / MEM / Math.random) --
    var UI, MEM, R, DOTS, out;
    var rnd = function () { return R(); };
    var pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
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
    function weighted(items) {          // [[weight, value], ...]
      var total = items.reduce(function (s, x) { return s + x[0]; }, 0);
      var r = rnd() * total;
      for (var i = 0; i < items.length; i++) { if ((r -= items[i][0]) < 0) return items[i][1]; }
      return items[items.length - 1][1];
    }
    var castNames = function () { return CAST.map(function (c) { return c.text; }); };
    function fill(s) {
      var facs = castNames().length ? castNames() : T.faction;
      return s.replace(/\{faction\}|\{f\}/g, function () { return fresh('faction', facs); })
              .replace(/\{district\}/g, function () { return UI.district || fresh('district', T.district); })
              .replace(/\{clock\}/g, function () { return fresh('clock', T.clock); });
    }

    var sceneOf = function () { return UI.scene ? T.scene[UI.scene] : null; };
    var pcOf = function () { return PCS.find(function (p) { return p.name === UI.pc; }) || null; };
    var threat = function () { return (UI.threat || '').trim(); };
    var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1); };
    var resLabel = function (r) { return r === '45' ? '4/5' : r === '13' ? '1–3' : ''; };
    var dotsOf = function (p, attr) {
      var d = DOTS && DOTS[p.name];
      return d && d[attr] != null && isFinite(Number(d[attr])) ? Number(d[attr]) : p[attr];
    };

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
      if (t) return { line: 'Whatever you roll, the threat lands anyway: **' + t + '**.', cat: 'the danger you telegraphed, landing regardless (name its cost from the seven, BitD p.21)', anchor: 'the threat on screen', kind: 'threat' };

      var pc = pcOf(), sc = UI.scene ? T.dbScene[UI.scene] : null;
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
        return { line: pick(T.aim[h]).replace('{x}', x), cat: T.cat[T.aimCat[h]] || "the player's own price",
                 anchor: pc.first + "'s sheet: " + (h === 'wont' ? "their Won't" : h === 'extra' ? 'a bargain they wrote' : h), kind: kind };
      }
      if (kind === 'scene') {
        var s = fresh('dbScene:' + UI.scene, sc, function (y) { return y[1]; });
        return { line: fill(s[1]), cat: T.cat[s[0]], anchor: 'the ' + String(T.scene[UI.scene].label).toLowerCase() + ' itself', kind: kind };
      }
      if (kind === 'cast') {
        var fac = fresh('castFac', CAST, function (y) { return y.text; });
        var f = fresh('dbFaction', T.dbFaction, function (y) { return y[1]; });
        return { line: fill(f[1].replace(/\{f\}/g, fac.text)), cat: T.cat[f[0]], anchor: 'on the board: ' + fac.text + (fac.src ? ' (' + fac.src + ')' : ''), kind: kind };
      }
      if (kind === 'callback') {
        var cb = fresh('callback', CALLBACKS, function (y) { return y.text; });
        return { line: 'Whatever you roll, this comes with it: **' + cb.text + '**', cat: 'a complication already in play', anchor: 'already in play: ' + (cb.src || 'the board'), kind: kind };
      }
      var g = fresh('dbGeneric', T.db, function (y) { return y[1]; });
      return { line: fill(g[1]), cat: T.cat[g[0]], anchor: 'generic: nothing on screen to hang it on', kind: 'generic' };
    }

    function devilsBargain() {
      var pc = pcOf();
      var dd = T.dbDistrict || {};
      var printed = UI.district && dd[UI.district] && dd[UI.district].scenes.indexOf(UI.scene) >= 0 ? dd[UI.district] : null;
      var veteran = UI.scene === 'fight' || UI.scene === ''
        ? (pc ? (/veteran/i.test(pc.playbook) ? pc : null) : PCS.find(function (p) { return /veteran/i.test(p.playbook); }) || null)
        : null;
      var b = composeBargain();

      head("Devil's Bargain", UI.pos + ' · BitD p.21' + (printed ? ' · ' + UI.district : ''), 'aim threat district');
      var lead;
      if (printed) {
        lead = UI.district + ' (' + printed.page + '): ' + plain(printed.text);
        say('**Want +1d?** Printed for **' + UI.district + '** (' + printed.page + '): ' + printed.text);
        grid([['Or', '**Want +1d?** ' + b.line], ['Category', b.cat], ['Anchor', b.anchor]]);
      } else {
        lead = plain(b.line);
        say('**Want +1d?** ' + b.line);
        grid([['Category', b.cat], ['Anchor', b.anchor]]);
      }
      if (veteran && UI.scene === 'fight') grid([['Or, for ' + veteran.first, T.arsenal]]);

      say('**Say it before the dice.** +1d if accepted. It happens *whatever the roll*. They can refuse ' +
          'or counter-offer. **Never with a push.** Priced at about one push (2 stress).', 'read');
      if (b.kind === 'threat') spentButton();
      var who = pc ? pc.first : 'the crew';
      action('Accepted: they owe it', { type: 'bargainOwed', key: keyOf(lead), text: lead, who: who,
                                        capture: { bucket: 'x', text: 'Bargain owed (' + who + '): ' + lead } });
      out.extra.bargain = { kind: printed ? 'printed' : b.kind, anchor: b.anchor, cat: b.cat };
    }

    // ---- 2 Complication ----
    function complication() {
      var sv = T.severity[UI.pos], sev = sv[0], ticks = sv[1], menu = sv[2];
      var sc = sceneOf();
      head('Complication', UI.pos + ' → ' + sev + (sc ? ' · ' + String(sc.label).toLowerCase() : ' · oracle-tables §3'));
      if (threat()) say(T.spend['Complication'].replace('{t}', threat()));
      if (sc) {
        var c = fresh('comp:' + UI.scene, sc.comp);
        say(c, threat() ? 'read' : 'want');
        grid([['Severity', '**' + sev + '**: ' + ticks + " on a clock if you'd rather tick than narrate"]]);
      } else {
        var s = fresh('compSource', T.compSource, function (x) { return x[0]; });
        var sh = fresh('compShape', T.compShape, function (x) { return x[0]; });
        say('**' + s[0] + ': ' + sh[0].toLowerCase() + '.**', threat() ? 'read' : 'want', s[1] + '; ' + sh[1]);
        grid([['Source', '**' + s[0] + '**: ' + s[1]], ['Shape', '**' + sh[0] + '**: ' + sh[1]],
              ['Severity', '**' + sev + '**: ' + ticks + " on a clock if you'd rather tick than narrate"]]);
      }
      say('At ' + UI.pos + ': ' + menu + ". **Don't negate a success.** If they cornered the enemy on a 4/5, " +
          'the enemy stays cornered.', 'read');
      if (threat()) spentButton();
    }

    // ---- 3 Consequence ----
    function consequence() {
      var sv = T.severity[UI.pos], sev = sv[0], ticks = sv[1], lvl = sv[3];
      var sc = sceneOf();
      var al = T.allowed[UI.pos];
      var allow = UI.result ? al[UI.result]
        : al['45'].concat(al['13']).filter(function (x, i, a) { return a.indexOf(x) === i; });
      var c = fresh('cons:' + UI.pos + UI.result, T.consequence.filter(function (x) { return allow.indexOf(x[0]) >= 0; }), function (x) { return x[0]; });
      head('Consequence', UI.pos + (UI.result ? ' ' + resLabel(UI.result) : '') + ' → ' + sev + (sc ? ' · ' + String(sc.label).toLowerCase() : '') + ' · BitD p.23, p.30–31');

      if (threat()) say(T.spend[c[0]].replace('{t}', threat()), 'want', c[0]);
      else say('**' + c[0] + '**');

      var hl = UI.pos === 'controlled' ? '1 (lesser)' : String(lvl);
      var example = '*' + c[2] + '*';
      if (sc) {
        if (c[0] === 'Reduced effect') example = sc.reduced;
        else if (c[0] === 'Lost opportunity') example = sc.lost;
        else if (c[0] === 'Worse position') example = sc.worse;
        else if (c[0] === 'Complication') example = fresh('comp:' + UI.scene, sc.comp);
        else if (c[0] === 'Harm') example = 'Level ' + hl + ': **' + pick(sc.harm[lvl - 1]) + '**';
      } else if (c[0] === 'Harm') {
        example = 'Level ' + hl + ': ' + c[2];
      }
      var rows = [['What it is', c[1]], ['Like', example],
                  ['Severity', '**' + sev + '** · a complication here is worth **' + ticks + '**'],
                  ['Fits', UI.pos + (UI.result ? ' ' + resLabel(UI.result) : '') + ': ' + allow.join(' · ')]];
      if (c[0] === 'Harm') rows.push.apply(rows, resistRows(sc ? sc.resist : 'prowess'));
      else rows.push(['Resist', "Prowess if it's physical · Insight if it's a trick · Resolve if it's nerve. Cost 6 − highest die"]);
      grid(rows);
      say(threat()
        ? "**You telegraphed it; now it lands.** That's why it doesn't feel invented after a bad roll."
        : '**Telegraph first.** Type the danger in *Threat on screen* before the roll, then a 4/5 spends the thing everyone already saw.',
        'read');
      spentButton();
    }

    // ---- 4 Pay the price ----
    function priceRow(r) { return T.price.find(function (x) { return r >= x[0] && r <= x[1]; }) || T.price[T.price.length - 1]; }
    function priceText(row) {
      var lvl = T.severity[UI.pos][3];
      if (row[0] === 51) return '**Harm, level ' + (UI.pos === 'controlled' ? '1 (lesser)' : lvl) + '** (' + UI.pos + ').' +
        (sceneOf() ? ' Like: **' + pick(sceneOf().harm[lvl - 1]) + '**.' : '');
      if (row[0] === 61) {
        if (OWED.length) { var ow = fresh('owed', OWED, function (x) { return x.text; }); return "**A devil's bargain comes due:** " + ow.text + (ow.src ? ' *(' + ow.src + ')*' : ''); }
        return row[2] + ' *No bargains on file. Read it as something they did earlier coming back.*';
      }
      return row[2];
    }
    function payThePrice() {
      var r = d6() * 10 + d6();
      var row = priceRow(r);
      head('Pay the price', 'd66 → ' + r + ' · ' + UI.pos + (UI.result ? ' ' + resLabel(UI.result) : '') + ' · oracle-tables §9');
      out.extra.d66 = r;
      if (row[0] === 66) {
        say(row[2]);
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
      say('**Reach for this third, not first.** Draw the obvious conclusion, then pick between two ' +
          'options, *then* roll here. **Adapt, don\'t read out.**', 'read');
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
      var res = T.reaction[r.idx];
      head('NPC reaction', who + ' · ' + pool + 'd' + (pool < 1 ? ' (2d keep lowest)' : '') + ' · Alone in the Dark', 'aim');
      say('**' + res[0] + '**: ' + res[1]);
      var s3 = T.say3[res[0]];
      var rows = [['Say it', '**' + s3[0] + '** · *' + s3[1] + '* · *' + s3[2] + '*. Three sentences, then stop and look at the player']];
      var nm = v.indexOf(':') >= 0 && v.indexOf('fac:') !== 0 ? v.slice(v.indexOf(':') + 1) : '';
      var card = nm ? NPCS.find(function (n) { return n.name.toLowerCase() === nm.toLowerCase(); }) : null;
      var pr = card ? playRow(card) : null;
      if (pr) rows.push(pr);
      rows.push(['Roll', '[' + r.dice.join(' ') + '] → ' + (r.crit ? '**critical**' : r.best)],
                ['Pool', 'Set it in **NPC is**: 3d friend · 2d neutral · 1d rival · faction status +2d (from the board\'s `standing:`)']);
      grid(rows);
      say('On *Conditional*, the price should cost the crew something the **players** care about. ' +
          'Stacks is the boring answer. If the players reached for this person, **give them a crumb, never silence**.', 'read');
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
      var sv = T.severity[UI.pos], sev = sv[0], ticks = sv[1];
      head('Callback', UI.pos + ' → ' + sev + ' · trouble already in play');
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
      grid([['Comes from', c.src || '–'], ['Severity', '**' + sev + '**: ' + ticks + ' if it ticks a clock']]);
      say('**The cheapest complication is one they already caused.** A name they know beats a stranger.', 'read');
      action('Used: retire it from the board', { type: 'callbackUsed', key: keyOf(c.text), text: c.text });
    }

    // ---- 7 Harm & resist ----
    function harm() {
      var sv = T.severity[UI.pos], sev = sv[0], lvl = sv[3];
      var sc = sceneOf();
      var hl = UI.pos === 'controlled' ? '1 (lesser)' : String(lvl);
      head('Harm & resist', UI.pos + ' → level ' + hl + (sc ? ' · ' + String(sc.label).toLowerCase() : ''));
      // No scene: the vault's fixed three are the fight palette's first column; read from T, not repeated here.
      var dflt = T.scene.fight ? T.scene.fight.harm.map(function (h) { return h[0]; }) : ['harm', 'harm', 'harm'];
      var name = sc ? pick(sc.harm[lvl - 1]) : dflt[lvl - 1];
      say((threat() ? '**' + threat() + '**: ' : '') + 'level ' + hl + ': **' + name + '**');
      grid([['Level', '**' + lvl + '** (' + sev + ') · controlled 1 · risky 2 · desperate 3 · level 4 is mortal']]
        .concat(resistRows(sc ? sc.resist : 'prowess'),
          [['Armour', '**Armour** (3 load) or a hull: **−1 level to all physical harm, every time.** **Light armour** (2 load) negates one instance. Total armour by choice to resist one instance fully (p.153)'],
           ['Hard mode', '**One resistance roll per consequence.** Say before they roll whether resisting reduces it a level or avoids it']]));
      say("**'68: harm has no in-score penalty** (p.152). Write it down and keep playing; it bites in the " +
          "aftermath's harm-complication roll (p.192).", 'read');
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
      var pf = fresh('contact', pairs, function (x) { return x[1]; }), p = pf[0], f = pf[1];
      var r = poolRoll(3, rnd);
      var res = T.reaction[r.idx][0];
      var crumb = T.crumb[res].replace('{c}', fresh('crumbBit', T.crumbBits));
      say('**' + f + '** (' + p.first + "'s friend): " + crumb);
      var rows = [['Roll', '3d friend [' + r.dice.join(' ') + '] → **' + res + '**']];
      var s3 = T.say3[res];
      rows.unshift(['Say it', '**' + s3[0] + '** · *' + s3[1] + '* · *' + s3[2] + '*']);
      var pr = playRow(NPCS.find(function (n) { return n.name.toLowerCase() === String(f).toLowerCase(); }));
      if (pr) rows.unshift(pr);
      if (r.best === 6) rows.push(['And', '**Tick one open clock** this contact could move, once (Find a Buyer, say).']);
      rows.push(['+1d', f + ' can also help a downtime roll as a friend (+1d).']);
      grid(rows);
      say("**Session 1's lesson:** the players reached for a contact three times and got silence three times. A crumb keeps the thread alive.", 'read');
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
      say('**Name the opposition.** A named rider gets angry when his mate dies; an anonymous one doesn\'t (s01, lesson 4).', 'read');
    }

    var FN = { devilsBargain: devilsBargain, complication: complication, consequence: consequence, payThePrice: payThePrice,
               reaction: reaction, callback: callback, harm: harm, contact: contact, face: face };

    function sanitise(ui) {
      var u = Object.assign({}, LIVE0, isObj(ui) ? ui : {});
      Object.keys(LIVE0).forEach(function (k) { u[k] = u[k] == null ? '' : String(u[k]); });
      if (!T.severity[u.pos]) u.pos = LIVE0.pos;
      if (u.result !== '45' && u.result !== '13') u.result = '';
      if (u.scene && !T.scene[u.scene]) u.scene = '';
      u.threat = u.threat.trim();
      return u;
    }

    con.buttons = BUTTONS.map(function (b) { return Object.assign({}, b); });
    con.defaults = function () { return Object.assign({}, LIVE0); };
    con.mem = function () { return instMem; };
    con.setCampaign = function (campaign, state) { load(campaign, state); return con; };
    con.roll = function (id, ui, ro) {
      var r = ro || {};
      var b = BUTTONS.find(function (x) { return x.id === id || x.n === Number(id); });
      var fnId = b ? b.id : 'devilsBargain';
      var seed = r.seed == null || !isFinite(Number(r.seed)) ? newSeed() : Number(r.seed) >>> 0;
      var mem = isObj(r.mem) ? r.mem : instMem;
      var memBefore = clone(mem);
      var u = sanitise(ui);
      UI = u; MEM = mem; R = seedRng(seed); DOTS = isObj(ui) && isObj(ui.dots) ? ui.dots : null;
      try { FN[fnId](); }
      finally { UI = null; MEM = null; R = null; DOTS = null; }
      var o2 = out; out = null;
      var t = (o2.all[0] || '').replace(/\s+/g, ' ');
      var meta = Object.assign({ id: fnId, n: BUTTONS.find(function (x) { return x.id === fnId; }).n,
        title: o2.title, sub: o2.sub, chips: o2.chips, text: o2.all[0] || '', all: o2.all,
        label: o2.title + ': ' + (t.length > 38 ? t.slice(0, 36) + '…' : t), actions: o2.actions }, o2.extra);
      var replayUi = Object.assign({}, u);
      if (isObj(ui) && isObj(ui.dots)) replayUi.dots = clone(ui.dots);
      return { lines: o2.lines, meta: meta, seed: seed, replay: { id: fnId, seed: seed, mem: memBefore, ui: replayUi } };
    };

    load(o.campaign, o.state);
    return con;
  }

  return {
    create: create, applyIntent: applyIntent, intentPatch: intentPatch, campaignWith: campaignWith,
    seedRng: seedRng, resistOdds: resistOdds, poolRoll: poolRoll, plain: plain, keyOf: keyOf,
    LIVE0: Object.assign({}, LIVE0), BUTTONS: BUTTONS.map(function (b) { return { n: b.n, id: b.id, label: b.label }; })
  };
});
