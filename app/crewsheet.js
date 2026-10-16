/* crewsheet.js — the full Blades '68 crew sheet on the table page, driven by the six transcribed crew playbooks in
   crews.js (window.B68Crews). Registers itself through B68Campaign.setCrewPanel({ render, acts, enter }), so campaign.js
   keeps owning the document, the saves (one write per click, typing debounced) and the read-only / GM gating.

   With no crew playbook chosen it shows a picker (six covers; folded behind "Show the six crew playbooks" on a phone)
   above the generic crew panel; choosing seeds the
   playbook's printed state (pre-marked upgrades, the starting cohort, BASE and other pre-held cells, Stunt Riders,
   the Utopians' first circle) and keeps the common tracks. The GM can change the playbook later.

   Data (crew.*): playbook, name, reputation | cause, base, wardBoss, notes, preferred [..], anger, rep, hold, tier,
   heat, wanted, stacks, vault, xp, claims { cellId: bool }, abilities { name: n }, versatile [..],
   contacts { name: 'friend' | 'rival' | null }, upgrades { name: n }, cohorts [..], factions [..],
   special { units, productKind, stunts { name: bool }, edges [..], flaws [..], circles { id: { marked, tally, truths } } },
   legacyClaims [{ name, held }] (the generic panel's list), advancePaid { characterId: bool }, turf (derived).
   Maps never drop keys (a PATCH merges objects): a cleared entry is written as false / 0 / null. */
(function () {
  'use strict';
  var M = window.B68Campaign, CR = window.B68Crews;
  if (!M || typeof M.setCrewPanel !== 'function' || !CR) return;
  var G = M.genericCrewPanel, COMMON = CR.COMMON;

  /* ---------- helpers ---------- */
  /* a small "?" link to the rules wiki (rules.js), drawn only on the hosted build, which has the rules */
  function rl(term) { var R = window.B68Rules; return R && R.help ? R.help(term) : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function clamp(n, a, b) { n = Math.round(+n || 0); return n < a ? a : n > b ? b : n; }
  function toggleTrack(cur, n) { return cur === n ? n - 1 : n; }
  function wipe(map, v) { var o = {}; if (isObj(map)) Object.keys(map).forEach(function (k) { o[k] = v; }); return o; }
  function A() { return window.B68 || {}; }
  function toast(msg, bad) { if (A().toast) try { A().toast(msg, bad); } catch (e) {} }
  /* bold the numbers that carry the rule, as the sheet prints them */
  function rich(t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }).replace(/(?:[+\-−]\d+d?|\d+)(?: (?:bonus stacks|stacks?|Rep|rep|Heat|heat|scale|units?|ticks|lives))?/g, '<b>$&</b>');
  }
  var ORD = ['one', 'two', 'three', 'four', 'five', 'six'];
  var LOOK = {
    'dealers': { duo: ['#e8c33c', '#4a2410'], special: 'The product instead of a claims map: supply, demand, distribution and 30 units. Starts with one turf and a Hustlers cohort.' },
    'hit-squad': { duo: ['#e58a80', '#2a1416'], special: 'Hunting grounds, a Legendary and an Elusive Target. Starts with a Muscle cohort and Prowess training.' },
    'militants': { duo: ['#ef8a4a', '#1e2633'], special: 'The cause and two enemies of the cause; Critical Strike. Starts with a Muscle cohort and Resolve training.' },
    'racers': { duo: ['#f2ede1', '#7c2618'], special: 'Signature stunts, vehicle edges and flaws; Stunt Riders already marked. Starts with Vehicles and a Workshop.' },
    'shadows': { duo: ['#a9bfd3', '#151a22'], special: 'Hunting grounds, Checkmate and a Critical Move. Starts with an Infiltrators cohort and a Hidden base.' },
    'utopians': { duo: ['#d6c8f2', '#33244f'], special: 'Four circles to descend, each with truths of the Vision. Starts with an Eggheads cohort and Resolve training.' }
  };

  /* ---------- the record ---------- */
  function rec(crew) { return crew && crew.playbook && CR.byId[crew.playbook] || null; }
  function sp(r) { return r && r.special || {}; }
  function cellsOf(r) {
    if (!r) return [];
    if (r.claims) return r.claims.cells;
    if (sp(r).product) return [].concat.apply([], sp(r).product.rows.map(function (x) { return x.cells; }));
    if (sp(r).circles) return [].concat.apply([], sp(r).circles.map(function (x) { return x.cells; }));
    return [];
  }
  function cellOf(r, id) { return cellsOf(r).filter(function (c) { return c.id === id; })[0] || null; }
  function circleOfCell(r, id) { return (sp(r).circles || []).filter(function (c) { return c.cells.some(function (x) { return x.id === id; }); })[0] || null; }
  function claimsOf(crew) { return isObj(crew.claims) ? crew.claims : {}; }
  function held(crew, id) { return claimsOf(crew)[id] === true; }
  function circState(crew, circ) { var s = isObj(crew.special) && isObj(crew.special.circles) ? crew.special.circles[circ.id] : null; return isObj(s) ? s : null; }
  function circMarked(crew, circ) { var s = circState(crew, circ); return s ? !!s.marked : !!circ.marked; }
  function claimable(crew, r, c) {
    if (c.base || held(crew, c.id)) return true;
    var circ = circleOfCell(r, c.id); if (circ) return circMarked(crew, circ);
    if (sp(r).product) { var src = c.linkedFrom || []; return !src.length || src.some(function (s) { return held(crew, s); }); }
    return (c.links || []).some(function (s) { return held(crew, s); });
  }
  function abilityList(r) { return (r && r.abilities || []).map(function (a) { return { name: a[0], text: a[1], max: a[2] || 1, meta: a[3] || {} }; }); }
  function abilityOf(r, name) { return abilityList(r).filter(function (a) { return a.name === name; })[0] || null; }
  function abilityN(crew, name) { return isObj(crew.abilities) ? clamp(crew.abilities[name], 0, 9) : 0; }
  function abilityLocked(crew, r, a) {
    if (!a.meta.group) return false;
    var circ = (sp(r).circles || []).filter(function (c) { return c.id === a.meta.group; })[0];
    return circ ? !circMarked(crew, circ) : false;
  }
  function upgradeList(r) { var u = r && r.upgrades || {}; return [].concat(u.crew || [], u.training || [], u.base || [], u.items || [], u.cohorts || []); }
  function upgradeOf(r, name) { return upgradeList(r).filter(function (u) { return u.name === name; })[0] || null; }
  function upN(crew, name, max) { return isObj(crew.upgrades) ? clamp(crew.upgrades[name], 0, max || 9) : 0; }
  function sum(a) { return a.reduce(function (t, v) { return t + v; }, 0); }
  var VAULTS = COMMON.vaults.groups;   /* [4, 8] */
  function vaultCap(crew, r) { var u = upgradeOf(r, 'Vault'), n = u ? upN(crew, 'Vault', u.boxes) : 0; return sum(VAULTS.slice(0, n)); }
  function turfCount(crew, r) {
    var n = cellsOf(r).filter(function (c) { return c.turf && held(crew, c.id); }).length;
    if (abilityN(crew, 'On the Side of the Oppressed') > 0) n += clamp(crew.wanted, 0, 4);
    return Math.min(n, COMMON.rep.turfMax);
  }
  function repMax(crew, r) { return COMMON.rep.pips - turfCount(crew, r); }
  /* developing (the base rule, which '68 inherits): a full rep track makes a weak hold strong, or, with strong hold,
     buys the next Tier for new Tier x 8 stacks (half with Benefactor); either way rep resets and turf marks stay */
  function tierCost(crew, tier) { var c = (tier + 1) * 8; return abilityN(crew, 'Benefactor') > 0 ? Math.ceil(c / 2) : c; }
  function funds(crew, r) { return clamp(crew.stacks, 0, COMMON.stacks.pips) + Math.min(clamp(crew.vault, 0, 16), vaultCap(crew, r)); }
  function xpMax(r) { return r && r.xpMax || 10; }
  function strs(a, n) { a = Array.isArray(a) ? a.slice() : []; while (a.length < n) a.push(''); return a.map(function (x) { return typeof x === 'string' ? x : x == null ? '' : String(x); }); }

  /* ---------- choosing (or changing) the crew playbook: one write ---------- */
  function seed(crew, r) {
    var old = crew.claims;
    if (Array.isArray(old) && old.length) {
      var leg = Array.isArray(crew.legacyClaims) ? crew.legacyClaims : [];
      crew.legacyClaims = leg.concat(old.filter(isObj).map(function (x) { return { name: String(x.name || ''), held: !!x.held }; }).filter(function (x) { return x.name; }));
    }
    if (!crew.base && crew.lair) crew.base = crew.lair;
    crew.playbook = r.id; crew.type = r.name;
    var claims = wipe(isObj(old) ? old : null, false);
    cellsOf(r).forEach(function (c) { if (c.pre) claims[c.id] = true; });
    crew.claims = claims;
    var ab = wipe(crew.abilities, 0); abilityList(r).forEach(function (a) { if (a.meta.marked) ab[a.name] = a.meta.marked; }); crew.abilities = ab;
    crew.versatile = [];
    crew.contacts = wipe(crew.contacts, null);
    var up = wipe(crew.upgrades, 0); upgradeList(r).forEach(function (u) { if (u.pre) up[u.name] = u.pre; }); crew.upgrades = up;
    crew.preferred = strs(crew.preferred, Math.max(2, r.preferred.writeIns));
    var os = isObj(crew.special) ? crew.special : {}, circles = {};
    if (isObj(os.circles)) Object.keys(os.circles).forEach(function (k) { circles[k] = { marked: false, tally: '', truths: [] }; });
    (sp(r).circles || []).forEach(function (c) { circles[c.id] = { marked: !!c.marked, tally: '', truths: [] }; });
    crew.special = { units: 0, productKind: null, stunts: wipe(os.stunts, false), edges: [], flaws: [], circles: circles };
    if (r.cohortStart) {
      var type = r.cohortStart.replace(/\s*cohort$/i, '');
      if (!Array.isArray(crew.cohorts)) crew.cohorts = [];
      if (!crew.cohorts.some(function (c) { return String(c.type || '').toLowerCase() === type.toLowerCase(); })) crew.cohorts.push({ name: '', type: type, edges: '', flaws: '', harm: null, armor: false });
    }
    crew.anger = clamp(crew.anger, 0, COMMON.anger.segments); crew.stacks = clamp(crew.stacks, 0, COMMON.stacks.pips); crew.xp = clamp(crew.xp, 0, xpMax(r));
    crew.vault = Math.min(clamp(crew.vault, 0, 16), vaultCap(crew, r));
    crew.turf = turfCount(crew, r); crew.rep = Math.min(clamp(crew.rep, 0, 12), repMax(crew, r));
  }

  /* ---------- renderers ---------- */
  function pill(cls, on, act, n, o) {
    o = o || {};
    return '<button type="button" class="cs-pill ' + cls + (on ? ' on' : '') + '" data-act="' + act + '" data-n="' + n + '"' + (o.extra || '') + (o.dis ? ' disabled' : '') + (o.title ? ' title="' + esc(o.title) + '"' : '') + ' aria-label="' + esc((o.label || act) + ' ' + n) + '" aria-pressed="' + !!on + '"></button>';
  }
  function circ(on, act, extra, label, o) {
    o = o || {};
    return '<button type="button" class="cs-circ' + (on ? ' on' : '') + (o.plus ? ' plus' : '') + (o.sq ? ' sq' : '') + '" data-act="' + act + '"' + (extra || '') + (o.dis ? ' disabled' : '') + (o.title ? ' title="' + esc(o.title) + '"' : '') + ' aria-label="' + esc(label) + '" aria-pressed="' + !!on + '">' + (o.plus ? '<span aria-hidden="true">+</span>' : '') + '</button>';
  }
  var CUBE = '<svg viewBox="0 0 16 17" aria-hidden="true"><path class="t" d="M8 1 15 4.6 8 8.2 1 4.6Z"/><path class="l" d="M1 4.6 8 8.2 8 16 1 12.4Z"/><path class="r" d="M15 4.6 8 8.2 8 16 15 12.4Z"/></svg>';
  function cube(on, act, n, o) {
    o = o || {};
    return '<button type="button" class="cs-cube' + (on ? ' on' : '') + (o.locked ? ' locked' : '') + '" data-act="' + act + '" data-n="' + n + '"' + (o.dis ? ' disabled' : '') + (o.title ? ' title="' + esc(o.title) + '"' : '') + ' aria-label="' + esc((o.label || act) + ' ' + n) + '" aria-pressed="' + !!on + '">' + CUBE + '</button>';
  }
  function panel(title, body, o) {
    o = o || {};
    return '<section class="cs-panel' + (o.cls ? ' ' + o.cls : '') + '"><div class="cs-ph"><h4>' + title + '</h4>' + (o.right ? '<span class="cs-phr">' + o.right + '</span>' : '') + '</div>' + body + '</section>';
  }

  /* the crew-playbook picker */
  function picker(crew, ctx, changing) {
    var r0 = rec(crew), fold = !changing && ctx.draft('cs.pick') !== 'open';   /* on a phone the covers start folded */
    var h = '<p class="hint">' + (changing ? '<b class="bad">Changing the crew playbook clears its abilities, upgrades, claims, contacts and extras.</b> Name, reputation, base, ward boss, anger, rep, hold, tier, heat, wanted level, stacks, vaults, crew xp, cohorts, factions and notes stay.'
      : 'Pick the crew playbook the table plays. It sets the claims map, special abilities, contacts, upgrades and starting cohort; anyone at the table may choose. Until then the generic crew tracks below stand in.') + '</p>' +
      (changing ? '' : '<button type="button" class="btn sm cs-pickt" data-act="crew.cspick" data-always="1" aria-expanded="' + !fold + '" aria-controls="cs-covers">' + (fold ? 'Show the six crew playbooks' : 'Hide the crew playbooks') + '</button>') +
      '<div class="cs-covers" id="' + (changing ? 'cs-covers-chg' : 'cs-covers') + '">';
    CR.CREWS.forEach(function (r, i) {
      var lk = LOOK[r.id] || { duo: ['#f2ede1', '#14110e'], special: '' }, on = r0 && r0.id === r.id;
      h += '<div class="cs-cover' + (on ? ' on' : '') + '" style="--duo-a:' + lk.duo[0] + ';--duo-b:' + lk.duo[1] + '" data-id="' + r.id + '"><div class="cs-cword">' + esc(r.name) + '<small>' + esc(r.tagline) + '</small></div>' +
        '<p class="cs-cspec">' + esc(lk.special) + '</p><div class="cs-cfoot"><span><span class="lt">Crew playbook</span> ' + ORD[i] + ' <span class="lt">of</span> six</span>' +
        '<button type="button" class="btn sm" data-act="crew.cschoose" data-id="' + r.id + '"' + (changing ? ' data-gm="1"' : '') + (on ? ' disabled' : '') + '>' + (on ? 'Current' : 'Choose') + '</button></div></div>';
    });
    h += '</div>';
    if (changing) h += '<div class="cs-row"><button type="button" class="btn sm" data-act="crew.cschange" data-v="close">Keep ' + esc(r0 ? r0.name : 'the playbook') + '</button></div>';
    return ctx.box(changing ? 'Change the crew playbook' : 'Choose the crew playbook', h, '<span class="tp-dim">' + (changing ? 'GM only' : 'six crew playbooks') + '</span>', 'cs-pickbox' + (fold ? ' cs-fold' : ''));
  }

  function header(crew, r, ctx) {
    var f = function (label, path, val, ph) { return '<label class="cs-f"><span class="cs-fl">' + esc(label) + '</span>' + ctx.input(path, val, ph, { label: label }) + '</label>'; };
    var second = r.repLabel ? f(r.repLabel, 'crew.reputation', crew.reputation || '', 'How the street sees you') : '';
    (r.extraHeader || []).forEach(function (x) { second += f(x.label, 'crew.' + x.key, crew[x.key] || '', 'What you fight for'); });
    var p = r.preferred, pref = strs(crew.preferred, p.writeIns), wi = '';
    for (var i = 0; i < p.writeIns; i++) wi += ctx.input('crew.preferred.' + i, pref[i], p.writeIns > 1 ? 'Enemy ' + (i + 1) : 'Where?', { label: p.label + (p.writeIns > 1 ? ' ' + (i + 1) : ''), cls: 'cs-wi' });
    var anger = clamp(crew.anger, 0, COMMON.anger.segments);
    return '<div class="cs-hdr"><div class="cs-fields">' + f('Name', 'crew.name', crew.name || '', 'What does the street call you?') + second +
      f('Base', 'crew.base', crew.base || '', 'Where you hole up') + f('Ward boss', 'crew.wardBoss', crew.wardBoss || '', 'Who runs your ward') + '</div>' +
      '<div class="cs-anger"><span class="cs-angerbox">' + ctx.clockSvg(COMMON.anger.segments, anger, 22, 'crew.anger') + '</span><span class="cs-fl">' + esc(COMMON.anger.label) + '</span></div>' +
      '<div class="cs-pref"><div class="cs-prefh"><span class="cs-fl">' + esc(p.label) + '</span>' + (wi ? '<span class="cs-wis">' + wi + '</span>' : '') +
      '<span class="cs-ops">' + (p.opsPrefix ? esc(p.opsPrefix) + ' ' : '') + esc(p.ops.join('—')) + '</span></div>' +
      '<p class="cs-rule">' + esc(p.rule) + (p.extra ? ' ' + esc(p.extra) : '') + '</p></div></div>';
  }

  function tracks(crew, r) {
    var turf = turfCount(crew, r), max = COMMON.rep.pips - turf, rep = Math.min(clamp(crew.rep, 0, 12), max), h = '';
    var reps = '';
    for (var i = 1; i <= COMMON.rep.pips; i++) {
      if (i > max) reps += pill('turfp', true, 'crew.rep', i, { dis: true, label: 'Turf', title: 'Turf: one less rep to develop' });
      else reps += pill(i <= COMMON.rep.accentedPips ? 'acc' : 'gry', i <= rep, 'crew.rep', i, { label: 'Rep' });
    }
    var hold = crew.hold === 'strong' ? 'strong' : 'weak', tier = clamp(crew.tier, 0, 6), tiers = '';
    for (var t = 1; t <= COMMON.tier.pips; t++) tiers += '<button type="button" class="cs-tier' + (t <= tier ? ' on' : '') + '" data-act="crew.tier" data-n="' + t + '" aria-label="Tier ' + t + '" aria-pressed="' + (t <= tier) + '"></button>';
    h += '<div class="cs-bars">' +
      '<div class="cs-bar cs-repbar"><span class="cs-bl">' + esc(COMMON.rep.label) + '</span><span class="cs-pills">' + reps + '</span><span class="cs-bend">' + esc(COMMON.rep.turfLabel) + '</span></div>' +
      '<div class="cs-bar cs-holdbar"><span class="cs-bl">' + esc(COMMON.hold.label) + '</span><span class="cs-bseg">Weak</span>' + pill('acc', hold === 'weak', 'crew.hold', 1, { extra: ' data-v="weak"', label: 'Weak hold' }) +
        '<span class="cs-bseg">Strong</span>' + pill('acc', hold === 'strong', 'crew.hold', 2, { extra: ' data-v="strong"', label: 'Strong hold' }) +
        '<span class="cs-bl cs-bl2">' + esc(COMMON.tier.label) + '</span><span class="cs-tiers">' + tiers + (tier > COMMON.tier.pips ? '<b class="mono">' + tier + '</b>' : '') + '</span></div></div>';
    var full = max > 0 && rep >= max, oppressed = abilityN(crew, 'On the Side of the Oppressed') > 0;
    h += '<p class="hint cs-turfhint">Rep <b class="mono">' + rep + ' / ' + max + '</b>' + (turf ? ' · <b class="mono">' + turf + '</b> turf' : '') +
      ' · rep fills from the left; each held turf (at most ' + COMMON.rep.turfMax + ', the grey pips) marks a pip from the right, so 1 less rep to develop' +
      (oppressed ? ' (each Wanted Level counts as turf: On the Side of the Oppressed)' : '') + '.</p>';
    if (full) {
      var cost = tierCost(crew, tier), have = funds(crew, r), top = tier >= 6;
      h += '<div class="cs-develop"><p><b class="cs-repfull">Rep is full.</b> ' + (hold === 'weak'
          ? 'With weak hold, developing makes the hold strong and resets rep to 0 (turf stays).</p><div class="cs-row"><button type="button" class="btn sm primary" data-act="crew.develop">Strengthen the hold</button></div>'
          : top ? 'The crew is at the top Tier.</p>'
          : 'With strong hold, the crew can go up to Tier ' + (tier + 1) + ' for <b class="mono">' + cost + '</b> stacks (new Tier × 8' + (abilityN(crew, 'Benefactor') > 0 ? ', halved by Benefactor' : '') + '). Rep resets to 0, turf stays and the hold becomes weak. The crew has <b class="mono">' + have + '</b> (stacks and vaults).</p>' +
            '<div class="cs-row"><button type="button" class="btn sm primary" data-act="crew.develop"' + (have < cost ? ' disabled' : '') + '>Go up to Tier ' + (tier + 1) + ' (' + cost + ' stacks)</button>' +
            (have < cost ? '<span class="hint">' + (cost - have) + ' more stacks needed. Rep stays full meanwhile (12 is the max).</span>' : '') + '</div>') + '</div>';
    }
    return h;
  }

  function cellHtml(crew, r, c, gm) {
    if (c.base) return '<div class="cs-cell base held" data-id="' + c.id + '"><span class="cs-basew">Base</span></div>';
    var on = held(crew, c.id), ok = claimable(crew, r, c);
    var cls = 'cs-cell' + (on ? ' held' : '') + (c.special ? ' sp' : '') + (c.oneOff ? ' one' : '') + (c.outline === 'double' ? ' dbl' : '') + (c.turf ? ' turf' : '') + (!ok ? ' far' : '');
    return '<button type="button" class="' + cls + '" data-act="crew.claim" data-id="' + c.id + '"' + (!ok && !gm ? ' disabled' : '') + ' aria-pressed="' + on + '" title="' + esc(on ? 'Held: click to give it up' : ok ? 'Claim ' + c.name : 'Not connected to a held claim' + (gm ? ' (GM: click to override)' : '')) + '">' +
      '<span class="cs-ch"><span class="cs-cn">' + esc(c.name) + '</span><span class="cs-mark' + (c.special ? ' sq' : '') + (on ? ' on' : '') + '"></span></span>' +
      '<span class="cs-cb">' + (c.text ? '<span>' + rich(c.text) + '</span>' : '') + (c.oneOffLabel ? '<i class="cs-oo">One-off opportunity</i>' : '') + '</span></button>';
  }
  function claimsMap(crew, r, ctx) {
    var g = r.claims, by = {}, h = '<div class="cs-scroll"><div class="cs-map">';
    g.cells.forEach(function (c) { by[c.id] = c; });
    for (var i = 0; i < g.rows; i++) for (var j = 0; j < g.cols; j++) {
      var c = g.cells[i * g.cols + j];
      h += '<div class="cs-slot" style="grid-row:' + (2 * i + 1) + ';grid-column:' + (2 * j + 1) + '">' + cellHtml(crew, r, c, ctx.isGM) + '</div>';
      var right = j < g.cols - 1 ? g.cells[i * g.cols + j + 1] : null, below = i < g.rows - 1 ? g.cells[(i + 1) * g.cols + j] : null;
      if (right && c.links.indexOf(right.id) >= 0) h += '<span class="cs-hbar' + (held(crew, c.id) && held(crew, right.id) ? ' on' : '') + '" style="grid-row:' + (2 * i + 1) + ';grid-column:' + (2 * j + 2) + '"></span>';
      if (below && c.links.indexOf(below.id) >= 0) h += '<span class="cs-vbar' + (held(crew, c.id) && held(crew, below.id) ? ' on' : '') + '" style="grid-row:' + (2 * i + 2) + ';grid-column:' + (2 * j + 1) + '"></span>';
    }
    return h + '</div></div>';
  }
  function legacy(crew) {
    var l = Array.isArray(crew.legacyClaims) ? crew.legacyClaims.filter(isObj) : [];
    if (!l.length) return '';
    return '<div class="cs-legacy"><span class="cs-fl">From the old crew panel</span><ul>' + l.map(function (x) { return '<li>' + esc(x.name) + (x.held ? ' <span class="tp-dim">(held)</span>' : '') + '</li>'; }).join('') + '</ul>' +
      '<button type="button" class="tp-x" data-act="crew.legacyclear" title="Clear the old list" aria-label="Clear the old claims list">clear</button></div>';
  }
  function claimsPanel(crew, r, ctx) {
    var n = cellsOf(r).filter(function (c) { return held(crew, c.id); }).length;
    return panel('Claims', '<p class="hint">Claim a cell joined by a bar to one you hold; dimmed cells are not connected yet' + (ctx.isGM ? ' (as GM you can claim them anyway)' : '') + '. Orange cells are special; the outlined ones are one-off targets.</p>' + claimsMap(crew, r, ctx) + legacy(crew),
      { cls: 'cs-claims', right: '<span class="tp-dim">' + n + ' held</span>' });
  }

  function productPanel(crew, r, ctx) {
    var P = sp(r).product, s = isObj(crew.special) ? crew.special : {}, units = clamp(s.units, 0, P.unitsMax), kind = s.productKind || null;
    var kinds = '<span class="cs-kinds">' + P.kinds.map(function (k) { return ctx.chip(esc(k), 'crew.kind', kind === k, ' data-v="' + esc(k) + '"'); }).join('') + '</span>';
    var u = '<span class="cs-units">';
    for (var i = 1; i <= P.unitsMax; i++) u += '<button type="button" class="cs-unit' + (i <= units ? ' on' : '') + '" data-act="crew.units" data-n="' + i + '" aria-label="Units ' + i + '" aria-pressed="' + (i <= units) + '"></button>' + (i % 5 === 0 && i < P.unitsMax ? '<span class="cs-ugap"></span>' : '');
    u += '</span>';
    var all = {}, pos = {};
    P.rows.forEach(function (row, ri) { row.cells.forEach(function (c, ci) { all[c.id] = c; pos[c.id] = [ri, ci]; }); });
    var h = '<div class="cs-scroll"><div class="cs-map cs-prod">';
    P.rows.forEach(function (row, ri) {
      h += '<span class="cs-rowlab" style="grid-row:' + (2 * ri + 1) + ';grid-column:1">' + esc(row.label) + '</span>';
      row.cells.forEach(function (c, ci) {
        h += '<div class="cs-slot" style="grid-row:' + (2 * ri + 2) + ';grid-column:' + (2 * ci + 1) + '">' + cellHtml(crew, r, c, ctx.isGM) + '</div>';
        (c.links || []).forEach(function (to) {
          var p = pos[to]; if (!p) return;
          if (p[0] === ri && Math.abs(p[1] - ci) === 1) h += '<span class="cs-arr ' + (p[1] > ci ? 'r' : 'l') + '" style="grid-row:' + (2 * ri + 2) + ';grid-column:' + (2 * Math.min(ci, p[1]) + 2) + '"></span>';
          else if (p[1] === ci && Math.abs(p[0] - ri) === 1) h += '<span class="cs-arr ' + (p[0] > ri ? 'd' : 'u') + '" style="grid-row:' + (2 * Math.max(ri, p[0]) + 1) + ';grid-column:' + (2 * ci + 1) + '"></span>';
        });
      });
    });
    h += '</div></div>';
    return panel(esc(P.label), '<div class="cs-prodtop"><span class="cs-fl">Product</span>' + kinds + '</div><div class="cs-prodtop"><span class="cs-fl cs-ul">Units <b class="mono">' + units + '</b></span>' + u + '</div>' +
      '<p class="hint">Follow the arrows: a cell opens once the cell its arrow comes from is held; cells with no arrow in are open from the start. Distribution turf counts as turf on the rep track.</p>' + h + legacy(crew), { cls: 'cs-claims cs-product' });
  }

  function circlesPanel(crew, r, ctx) {
    var C = sp(r).circles, h = '';
    C.forEach(function (c, i) {
      var st = circState(crew, c) || { marked: !!c.marked, tally: '', truths: [] }, on = circMarked(crew, c), prevOn = i === 0 || circMarked(crew, C[i - 1]);
      var truths = Array.isArray(st.truths) ? st.truths : [], full = truths.length >= c.truths.count;
      h += '<div class="cs-circle' + (on ? ' on' : ' off') + '" data-c="' + c.id + '"><div class="cs-circh">' +
        circ(on, 'crew.circle', ' data-id="' + c.id + '"', c.name, { dis: i === 0 || (!on && !prevOn), title: i === 0 ? 'Printed marked: the crew starts here' : !on && !prevOn ? 'Reach the circle before it first' : on ? 'Leave this circle' : 'Descend to this circle' }) +
        '<span class="cs-circn">' + esc(c.name) + '</span>' + (c.threshold ? '<span class="cs-thr">' + rich(c.threshold).replace(/^([^:]+:)/, '<b>$1</b>') + '</span>' : '') +
        (c.tally ? '<label class="cs-tally">' + ctx.input('crew.special.circles.' + c.id + '.tally', st.tally || '', c.tally, { label: c.tally + ' tally', cls: 'cs-tallyin' }) + '</label>' : '') + '</div>' +
        '<div class="cs-truths"><i>' + esc(c.truths.rule) + ':</i> ' + c.truths.words.map(function (w) {
          var picked = truths.indexOf(w) >= 0;
          return '<button type="button" class="cs-word' + (picked ? ' on' : '') + '" data-act="crew.truth" data-c="' + c.id + '" data-v="' + esc(w) + '" aria-pressed="' + picked + '"' + (!picked && full ? ' disabled title="' + c.truths.count + ' chosen: unpick one first"' : '') + '>' + esc(w) + '</button>';
        }).join('<span class="cs-dash">—</span>') + ' <span class="tp-dim mono">' + truths.length + '/' + c.truths.count + '</span></div>' +
        '<div class="cs-scroll"><div class="cs-crow">' + c.cells.map(function (x) { return cellHtml(crew, r, x, ctx.isGM); }).join('') + '</div></div></div>';
    });
    return panel('The circles', '<p class="hint">Descend circle by circle once its threshold is met: its cells open to claim and its special abilities unlock.</p>' + h + legacy(crew), { cls: 'cs-claims cs-circles' });
  }

  function stuntsPanel(crew, r) {
    var S = sp(r).stunts, st = isObj(crew.special) && isObj(crew.special.stunts) ? crew.special.stunts : {}, n = S.list.filter(function (x) { return st[x[0]] === true; }).length;
    var max = abilityN(crew, 'Stunt Riders');
    return panel(esc(S.label), '<p class="hint"><i>' + esc(S.rule) + '.</i> Stunt Riders masters one more each time it is taken.</p><div class="cs-stunts">' + S.list.map(function (x) {
      var on = st[x[0]] === true;
      return '<button type="button" class="cs-opt' + (on ? ' on' : '') + '" data-act="crew.stunt" data-k="' + esc(x[0]) + '" aria-pressed="' + on + '"><span class="cs-circ' + (on ? ' on' : '') + '"></span><span><b>' + esc(x[0]) + ':</b> ' + esc(x[1]) + '</span></button>';
    }).join('') + '</div>', { cls: 'cs-stuntbox', right: '<span class="tp-dim mono' + (n > max ? ' bad' : '') + '">' + n + ' signature · Stunt Riders ' + max + '</span>' });
  }
  function vehiclePanel(crew, r) {
    var s = isObj(crew.special) ? crew.special : {};
    function list(key, rows, title) {
      var picked = Array.isArray(s[key]) ? s[key] : [];
      return panel(title, '<div class="cs-veh">' + rows.map(function (x) {
        var on = picked.indexOf(x[0]) >= 0;
        return '<button type="button" class="cs-opt' + (on ? ' on' : '') + '" data-act="crew.' + (key === 'edges' ? 'edge' : 'flaw') + '" data-k="' + esc(x[0]) + '" aria-pressed="' + on + '"><span class="cs-sqm' + (on ? ' on' : '') + '"></span><span><b>' + esc(x[0]) + ':</b> ' + esc(x[1]) + '</span></button>';
      }).join('') + '</div>', { cls: 'cs-vehbox' });
    }
    return '<div class="cs-two">' + list('edges', sp(r).vehicleEdges, 'Vehicle edges') + list('flaws', sp(r).vehicleFlaws, 'Vehicle flaws') + '</div><p class="hint">For Custom Ride: 1–2 vehicle edges and an equal number of flaws.</p>';
  }

  function heatRow(crew, r) {
    var heat = clamp(crew.heat, 0, 9), wanted = clamp(crew.wanted, 0, 4), stacks = clamp(crew.stacks, 0, COMMON.stacks.pips), cap = vaultCap(crew, r), vault = Math.min(clamp(crew.vault, 0, 16), cap);
    var hp = '', wp = '', sc = '', vc = '', i;
    for (i = 1; i <= COMMON.heat.pips; i++) hp += pill('acc', i <= heat, 'crew.heat', i, { label: 'Heat' });
    for (i = 1; i <= COMMON.wantedLevel.pips; i++) wp += pill('want', i <= wanted, 'crew.wanted', i, { label: 'Wanted level' });
    for (i = 1; i <= COMMON.stacks.pips; i++) sc += cube(i <= stacks, 'crew.stacks', i, { label: 'Stacks' });
    var n = 0;
    VAULTS.forEach(function (g, gi) {
      vc += '<span class="cs-vgroup' + (n + g > cap ? ' locked' : '') + '">';
      for (var k = 1; k <= g; k++) { n++; vc += cube(n <= vault, 'crew.vault', n, { locked: n > cap, dis: n > cap, label: 'Vault', title: n > cap ? 'Needs the Vault upgrade (' + (gi + 1) + ' box' + (gi ? 'es' : '') + ')' : '' }); }
      vc += '</span>';
    });
    return '<div class="cs-bars cs-heatrow"><div class="cs-bar"><span class="cs-bl">' + esc(COMMON.heat.label) + rl('heat') + '</span><span class="cs-pills">' + hp + '</span><span class="cs-bl cs-bl2">' + esc(COMMON.wantedLevel.label) + rl('wanted level') + '</span><span class="cs-pills">' + wp + '</span></div>' +
      '<div class="cs-bar cs-stackbar"><span class="cs-bl">' + esc(COMMON.stacks.label) + rl('stacks') + '</span><span class="cs-bend cs-vl">' + esc(COMMON.vaults.label) + '</span><span class="cs-cubes">' + sc + '</span><span class="cs-vaults">' + vc + '</span></div></div>' +
      '<p class="hint">Heat <b class="mono">' + heat + '/9</b> · wanted level <b class="mono">' + wanted + '</b> · stacks <b class="mono">' + stacks + '</b> · vaults <b class="mono">' + vault + '/' + cap + '</b>' + (cap < 12 ? ' (the Vault upgrade opens ' + (cap ? 'the second group' : 'the first group, then the second') + ')' : '') + '</p>';
  }

  function abilitiesPanel(crew, r, ctx) {
    var xp = clamp(crew.xp, 0, xpMax(r)), ov = '';
    for (var i = 1; i <= xpMax(r); i++) ov += pill('xpo', i <= xp, 'crew.xp', i, { label: 'Crew xp' });
    function one(a) {
      var n = abilityN(crew, a.name), locked = abilityLocked(crew, r, a), c = '';
      for (var k = 1; k <= a.max; k++) c += circ(k <= n, 'crew.ability', ' data-k="' + esc(a.name) + '" data-n="' + k + '"', a.name + ' ' + k, { plus: a.meta.plus === k, dis: locked, title: locked ? 'Locked until the crew descends to that circle' : '' });
      var ver = '';
      if (a.name === 'Versatile' && n > 0) { var vs = strs(crew.versatile, n); for (var j = 0; j < n; j++) ver += ctx.input('crew.versatile.' + j, vs[j], 'Ability ' + (j + 1) + ': name and crew', { label: 'Versatile ability ' + (j + 1), cls: 'cs-verin' }); }
      return '<div class="cs-ab' + (n ? ' on' : '') + (locked ? ' locked' : '') + '"><span class="cs-circs">' + c + '</span><div><b>' + esc(a.name) + ':</b> ' + rich(a.text) + (ver ? '<div class="cs-vers">' + ver + '</div>' : '') + '</div></div>';
    }
    var list = abilityList(r), body;
    if (r.abilityGroups) {
      body = '<div class="cs-abcols"><div>' + list.filter(function (a) { return !a.meta.group; }).map(one).join('') + '</div><div>' +
        r.abilityGroups.map(function (g) { var circle = (sp(r).circles || []).filter(function (c) { return c.id === g.id; })[0], open = circle ? circMarked(crew, circle) : true; return '<div class="cs-abgroup' + (open ? '' : ' locked') + '"><span class="cs-abgh">' + esc(g.label) + (open ? '' : ' <i>locked</i>') + '</span>' + list.filter(function (a) { return a.meta.group === g.id; }).map(one).join('') + '</div>'; }).join('') + '</div></div>';
    } else {
      var half = Math.ceil(list.length / 2);
      body = '<div class="cs-abcols"><div>' + list.slice(0, half).map(one).join('') + '</div><div>' + list.slice(half).map(one).join('') + '</div></div>';
    }
    return panel('Special abilities', body, { cls: 'cs-abbox', right: '<span class="cs-xpl">XP</span><span class="cs-pills cs-xpo">' + ov + '</span>' });
  }

  function contactsPanel(crew, r) {
    var cs = isObj(crew.contacts) ? crew.contacts : {};
    return panel('Contacts', '<div class="cs-contacts">' + r.contacts.map(function (c) {
      var k = cs[c[0]] === 'friend' || cs[c[0]] === 'rival' ? cs[c[0]] : null;
      return '<div class="cs-contact"><button type="button" class="cs-cdot' + (k ? ' ' + k : '') + '" data-act="crew.contact" data-k="' + esc(c[0]) + '" title="' + (k === 'friend' ? '▲ friend' : k === 'rival' ? '▼ rival' : 'neither: click to cycle') + '" aria-label="' + esc(c[0]) + ': ' + (k || 'neither') + '">' + (k === 'friend' ? '▲' : k === 'rival' ? '▼' : '▷') + '</button><span>' + esc(c[0]) + ', <span class="tp-dim">' + esc(c[1]) + '</span></span>' + (k ? '<span class="cs-cst">' + k + '</span>' : '') + '</div>';
    }).join('') + '</div>', { right: '<span class="tp-dim">click the mark: friend ▲, rival ▼, neither</span>' });
  }

  /* xp, the end-of-session panel and the crew advance */
  function endState(ctx) { var e = ctx.draft('cs.end'); return isObj(e) ? e : null; }
  function bankable(d) {
    var pb = A().CT && A().CT.byId ? A().CT.byId[d.playbook] : null, p = isObj(d.play) ? d.play : {};
    if (pb && pb.timetraveler) return false;   /* no bank at all */
    if (pb && pb.hull && (p.abilities || []).indexOf('A Room of Your Own') < 0) return false;
    return true;
  }
  function roster() { var r = A().roster; return Array.isArray(r) ? r : []; }
  function payees(crew, ctx, mineOnly) {
    var paid = isObj(crew.advancePaid) ? crew.advancePaid : {};
    return roster().filter(function (d) { return d && d.id && bankable(d) && paid[d.id] !== true && (!mineOnly || (ctx.me && d.owner === ctx.me)); });
  }
  function bankOf(d) { return clamp(isObj(d.play) ? d.play.bank : 0, 0, 40); }
  function xpPanel(crew, r, ctx) {
    var e = endState(ctx), xp = clamp(crew.xp, 0, xpMax(r)), h = '<p class="cs-xpi">' + esc(COMMON.xpIntro) + '</p><ul class="cs-trig">' + r.xpTriggers.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
    h += '<div class="cs-row"><span class="cs-fl">Crew xp</span><b class="mono">' + xp + ' / ' + xpMax(r) + '</b><span class="cs-gap"></span><button type="button" class="btn sm primary" data-act="crew.csend" aria-expanded="' + !!e + '">End session: mark crew xp</button></div>';
    if (e) {
      var vals = r.xpTriggers.map(function (t, i) { return clamp(e.vals && e.vals[i], 0, 2); }), total = sum(vals), add = Math.min(total, xpMax(r) - xp);
      var b = '<p class="hint">Mark 1 xp for each trigger the crew hit this session, 2 if you really smashed it.</p><div class="cs-endtrig">' + r.xpTriggers.map(function (t, i) {
        return '<div class="cs-endrow"><span>' + esc(t) + '</span><span class="seg">' + [0, 1, 2].map(function (v) { return ctx.chip(String(v), 'crew.csendval', vals[i] === v, ' data-i="' + i + '" data-v="' + v + '"' + (e.done ? ' disabled' : '')); }).join('') + '</span></div>';
      }).join('') + '</div>';
      if (!e.done) b += '<div class="cs-endgo"><b class="cs-big mono">+' + total + ' xp</b><span class="tp-dim">crew xp ' + xp + ' → ' + (xp + add) + ' / ' + xpMax(r) + (total > add ? ' · ' + (total - add) + ' lost to the cap' : '') + '</span><button type="button" class="btn sm primary" data-act="crew.csendmark"' + (total ? '' : ' disabled') + '>Mark crew xp</button></div>';
      else b += '<div class="cs-endgo"><span class="cs-fl">Applied</span><span class="mono">+' + e.done.added + ' crew xp' + (e.done.lost ? ' · ' + e.done.lost + ' lost to the cap' : '') + '</span></div>';
      h += '<div class="cs-endp" role="region" aria-label="End of session: crew xp"><div class="cs-endh"><span>End of session · crew xp</span><button type="button" class="tp-x" data-act="crew.csend" data-v="close" aria-label="Close the crew xp panel" title="Close">×</button></div><div class="cs-endb">' + b + '</div></div>';
    }
    if (xp >= xpMax(r)) {
      var tier = clamp(crew.tier, 0, 6), amt = tier + 2, all = payees(crew, ctx, false), mine = payees(crew, ctx, true);
      var paid = isObj(crew.advancePaid) ? Object.keys(crew.advancePaid).filter(function (k) { return crew.advancePaid[k] === true; }).length : 0;
      var list = (ctx.isGM ? all : mine).map(function (d) { var b0 = bankOf(d); return '<li>' + esc(d.name || 'Unnamed') + ' <span class="mono tp-dim">bank ' + b0 + ' → ' + Math.min(40, b0 + amt) + '</span></li>'; }).join('');
      h += '<div class="cs-adv"><div class="cs-advh">Crew advance</div><p><b>' + esc(COMMON.footer) + '</b>: Tier ' + tier + ' + 2 = <b class="mono">' + amt + '</b> into each bank (capped at 40).</p>' +
        (list ? '<ul class="cs-payees">' + list + '</ul>' : '<p class="hint">' + (ctx.isGM ? 'No character left to pay' : 'None of your characters is left to pay') + (paid ? ' (' + paid + ' paid already).' : '.') + ' Time travelers keep no bank; a Hull needs A Room of Your Own.</p>') +
        '<div class="cs-row">' + (ctx.isGM ? '<button type="button" class="btn sm primary" data-act="crew.cspayall" data-gm="1">Pay each PC Tier+2 to bank</button>'
          : '<button type="button" class="btn sm primary" data-act="crew.cspaymine"' + (mine.length ? '' : ' disabled') + '>Pay my characters Tier+2</button>') +
        '<button type="button" class="btn sm" data-act="crew.csxpreset">Reset crew xp to 0</button></div>' +
        '<p class="hint">' + (ctx.isGM ? 'Pays every character not yet paid for this advance, then resets crew xp to 0.' : 'Players pay their own characters; the GM’s button pays everyone and resets crew xp.') + '</p></div>';
    }
    return panel('Crew xp', h + '<p class="cs-foot">' + esc(COMMON.footer) + '</p>', { cls: 'cs-xpbox' });
  }

  function upgradesPanel(crew, r) {
    function up(u) {
      var n = upN(crew, u.name, u.boxes), b = '';
      for (var i = 1; i <= u.boxes; i++) b += '<button type="button" class="cs-box' + (i <= n ? ' on' : '') + '" data-act="crew.upgrade" data-k="' + esc(u.name) + '" data-n="' + i + '" aria-label="' + esc(u.name) + ' ' + i + '" aria-pressed="' + (i <= n) + '"></button>';
      return '<div class="cs-up' + (n ? ' on' : '') + '"><span class="cs-boxes' + (u.linked ? ' linked' : '') + '">' + b + '</span><span>' + esc(u.name) + '</span></div>';
    }
    var U = r.upgrades, costs = r.upgradeCosts || COMMON.upgradeCosts;
    var h = '<div class="cs-upcrew">' + U.crew.map(up).join('') + '</div><div class="cs-upcols">' +
      '<div><span class="cs-uph">Training Facilities</span>' + U.training.map(up).join('') + '</div>' +
      '<div><span class="cs-uph">Upgrade Base</span>' + U.base.map(up).join('') + '</div>' +
      '<div><span class="cs-uph">Upgrade Items</span>' + U.items.map(up).join('') + '</div>' +
      '<div><span class="cs-uph">Cohorts</span>' + U.cohorts.map(up).join('') + '<span class="cs-costh">Upgrade costs</span><span class="cs-cost">New Cohort: ' + costs.newCohort + '</span><span class="cs-cost">Add Type: ' + costs.addType + '</span></div></div>';
    return panel('Crew upgrades', h, { cls: 'cs-upbox' });
  }

  function cohortsPanel(crew, r, ctx) {
    var HARMS = ['weak', 'impaired', 'broken'], list = Array.isArray(crew.cohorts) ? crew.cohorts : [], costs = r.upgradeCosts || COMMON.upgradeCosts, h = '<div class="tp-list">';
    list.forEach(function (c, i) {
      var p = 'crew.cohorts.' + i + '.';
      h += '<div class="tp-cohort"><div class="tp-corow">' + ctx.input(p + 'name', c.name, 'Name', { label: 'Cohort name' }) + ctx.input(p + 'type', c.type, 'Gang or expert type', { label: 'Cohort type' }) + '</div>' +
        '<div class="tp-corow">' + ctx.input(p + 'edges', c.edges, 'Edges', { label: 'Edges' }) + ctx.input(p + 'flaws', c.flaws, 'Flaws', { label: 'Flaws' }) + '</div>' +
        '<div class="tp-cohs">' + HARMS.map(function (s) { return '<button type="button" class="tp-coh' + (c.harm === s ? ' on' : '') + '" data-act="crew.cohortharm" data-i="' + i + '" data-v="' + s + '" aria-pressed="' + (c.harm === s) + '"><span class="tp-cohpip"></span>' + s.charAt(0).toUpperCase() + s.slice(1) + '</button>'; }).join('') +
        '<button type="button" class="tp-coh' + (c.armor ? ' on' : '') + '" data-act="crew.cohortarmor" data-i="' + i + '" aria-pressed="' + !!c.armor + '"><span class="tp-cohsq"></span>Armor</button>' +
        '<button type="button" class="tp-x" data-act="crew.cohortrm" data-i="' + i + '" title="Remove the cohort" aria-label="Remove the cohort">×</button></div></div>';
    });
    if (!list.length) h += '<p class="hint">No cohorts. Gangs and experts the crew runs go here.</p>';
    h += '</div><p class="hint">Upgrade costs: a new cohort ' + costs.newCohort + ' upgrades, adding a type ' + costs.addType + '.</p>';
    return panel('Cohorts', h, { right: '<button type="button" class="btn sm" data-act="crew.cohortadd">Add cohort</button>' });
  }
  function factionsPanel(crew, ctx) {
    var list = Array.isArray(crew.factions) ? crew.factions : [], h = '<div class="tp-list">';
    list.forEach(function (f, i) {
      h += '<div class="tp-faction">' + ctx.input('crew.factions.' + i + '.name', f.name, 'Faction', { label: 'Faction ' + (i + 1) }) + '<span class="seg tp-status7">' + [-3, -2, -1, 0, 1, 2, 3].map(function (v) { return ctx.chip(v > 0 ? '+' + v : v < 0 ? '−' + (-v) : '0', 'crew.factionstatus', f.status === v, ' data-i="' + i + '" data-v="' + v + '"', { cls: v < 0 ? 'neg' : v > 0 ? 'pos' : '' }); }).join('') + '</span><button type="button" class="tp-x" data-act="crew.factionrm" data-i="' + i + '" title="Remove the faction" aria-label="Remove the faction">×</button></div>';
    });
    if (!list.length) h += '<p class="hint">No faction statuses yet: −3 at war, 0 neutral, +3 allies.</p>';
    return panel('Factions', h + '</div>', { right: '<button type="button" class="btn sm" data-act="crew.factionadd">Add faction</button>' });
  }

  /* ---------- the panel ---------- */
  var live = null;   /* the crew object campaign.js renders (its own document copy), for text-path parents */
  function render(crew, ctx) {
    live = crew;
    var r = rec(crew);
    if (!r) return picker(crew, ctx, false) + G.render(crew, ctx);
    var changing = ctx.isGM && ctx.draft('cs.change') === 'open';
    var lk = LOOK[r.id] || { duo: ['#f2ede1', '#14110e'] };
    var claims = r.claims ? claimsPanel(crew, r, ctx) : sp(r).product ? productPanel(crew, r, ctx) : sp(r).circles ? circlesPanel(crew, r, ctx) : '';
    var h = (changing ? picker(crew, ctx, true) : '') +
      '<div class="cs-mast" style="--duo-a:' + lk.duo[0] + ';--duo-b:' + lk.duo[1] + '"><div class="cs-masth"><span class="cs-kick">Crew sheet</span><h3 class="cs-pbname">' + esc(r.name) + '</h3></div><span class="cs-tag">' + esc(r.tagline) + '</span>' +
      (ctx.isGM ? '<button type="button" class="btn sm cs-chg" data-act="crew.cschange" data-gm="1" aria-expanded="' + changing + '">Change playbook</button>' : '') + '</div>' +
      '<div class="cs-cols"><div class="cs-left">' + header(crew, r, ctx) + tracks(crew, r) + claims + (sp(r).stunts ? stuntsPanel(crew, r) : '') + heatRow(crew, r) + '</div>' +
      '<div class="cs-right">' + abilitiesPanel(crew, r, ctx) + contactsPanel(crew, r) + xpPanel(crew, r, ctx) + upgradesPanel(crew, r) + (sp(r).vehicleEdges ? vehiclePanel(crew, r) : '') + '</div></div>' +
      '<div class="cs-bottom">' + cohortsPanel(crew, r, ctx) + factionsPanel(crew, ctx) + panel('Crew notes', ctx.textarea('crew.notes', crew.notes || '', 'Debts, plans, the crew’s mark…', { label: 'Crew notes' })) + '</div>';
    return '<section class="tp-box tp-crewbox cs-sheet" data-playbook="' + r.id + '"><div class="tp-band"><span>The crew · ' + esc(r.name) + '</span><span class="tp-band-r"><span class="tp-dim">shared by the whole table</span></span></div><div class="tp-body cs-body">' + h + '</div></section>';
  }

  /* typing into a text field whose parent object or list does not exist yet (an older crew): create it first, so
     campaign.js's own debounced save can set the value */
  document.addEventListener('input', function (e) {
    var t = e.target; if (!live || !t || !t.dataset || !t.dataset.path || t.dataset.path.indexOf('crew.') !== 0) return;
    var root = document.getElementById('table-page'); if (!root || !root.contains(t)) return;
    var ps = t.dataset.path.split('.'), o = live;
    for (var i = 1; i < ps.length - 1; i++) {
      var k = ps[i], nextIdx = /^\d+$/.test(ps[i + 1]);
      if (o[k] == null || typeof o[k] !== 'object') o[k] = nextIdx ? [] : {};
      o = o[k];
      if (Array.isArray(o) && nextIdx) while (o.length < +ps[i + 1]) o.push('');
    }
  }, true);

  function special(crew) { if (!isObj(crew.special)) crew.special = {}; return crew.special; }
  function claimMap(crew) {
    if (!isObj(crew.claims)) {
      if (Array.isArray(crew.claims) && crew.claims.length) crew.legacyClaims = (Array.isArray(crew.legacyClaims) ? crew.legacyClaims : []).concat(crew.claims.filter(isObj).map(function (x) { return { name: String(x.name || ''), held: !!x.held }; }).filter(function (x) { return x.name; }));
      crew.claims = {};
    }
    return crew.claims;
  }
  function settle(crew, r) {   /* derived fields that follow a change, in the same write */
    crew.turf = turfCount(crew, r);
    var max = repMax(crew, r); if (clamp(crew.rep, 0, 12) > max) crew.rep = max;
    var cap = vaultCap(crew, r); if (clamp(crew.vault, 0, 16) > cap) crew.vault = cap;
  }
  function pay(list, crew) {
    var amt = clamp(crew.tier, 0, 6) + 2, up = A().updateCharacter;
    if (typeof up !== 'function') { toast('Paying banks needs saved characters, which this view does not have.', true); return 0; }
    var n = 0;
    list.forEach(function (d) {
      var nb = Math.min(40, bankOf(d) + amt);
      if (!crew.advancePaid || !isObj(crew.advancePaid)) crew.advancePaid = {};
      crew.advancePaid[d.id] = true; n++;
      if (nb === bankOf(d)) return;
      Promise.resolve().then(function () { return up(d.id, { play: { bank: nb } }); }).catch(function () {});
    });
    if (n) toast('Paid ' + amt + ' into ' + n + ' bank' + (n === 1 ? '' : 's') + '.');
    return n;
  }

  var mine = {
    develop: function (d, crew, ctx, r) {
      var max = repMax(crew, r), tier = clamp(crew.tier, 0, 6); if (!(max > 0 && clamp(crew.rep, 0, 12) >= max)) return;
      if (crew.hold !== 'strong') {
        if (!ctx.confirm('Develop the crew: the hold becomes strong and rep resets to 0 (turf stays)?')) return;
        crew.hold = 'strong'; crew.rep = 0; ctx.commit(); toast('The hold is strong. Rep is back to 0.'); return;
      }
      var cost = tierCost(crew, tier); if (tier >= 6 || funds(crew, r) < cost) return;
      if (!ctx.confirm('Go up to Tier ' + (tier + 1) + ' for ' + cost + ' stacks? Rep resets to 0, turf stays and the hold becomes weak.')) return;
      var st = clamp(crew.stacks, 0, COMMON.stacks.pips), fromSt = Math.min(st, cost);
      crew.stacks = st - fromSt; crew.vault = Math.min(clamp(crew.vault, 0, 16), vaultCap(crew, r)) - (cost - fromSt);
      crew.tier = tier + 1; crew.hold = 'weak'; crew.rep = 0; ctx.commit(); toast('The crew is Tier ' + crew.tier + '. Hold is weak; rep is back to 0.');
    },
    tier: function (d, crew, ctx) { var n = clamp(d.n, 1, COMMON.tier.pips); crew.tier = toggleTrack(clamp(crew.tier, 0, 6), n); ctx.commit(); },
    rep: function (d, crew, ctx, r) { var max = repMax(crew, r), n = +d.n; if (!(n >= 1 && n <= max)) return; crew.rep = toggleTrack(Math.min(clamp(crew.rep, 0, 12), max), n); ctx.commit(); },
    wanted: function (d, crew, ctx, r) { crew.wanted = toggleTrack(clamp(crew.wanted, 0, 4), clamp(d.n, 1, 4)); settle(crew, r); ctx.commit(); },
    vault: function (d, crew, ctx, r) { var cap = vaultCap(crew, r), n = +d.n; if (!(n >= 1 && n <= cap)) return; crew.vault = toggleTrack(Math.min(clamp(crew.vault, 0, 16), cap), n); ctx.commit(); }
  };
  var acts = {
    /* tracks shared with the generic panel: the generic rule until a playbook is chosen */
    cschoose: function (d, crew, ctx) {
      var r = CR.byId[d.id], r0 = rec(crew); if (!r || (r0 && r0.id === r.id)) return;
      if (r0) {
        if (!ctx.isGM) return;
        if (!ctx.confirm('Change the crew playbook from ' + r0.name + ' to ' + r.name + '?\n\nThe ' + r0.name + ' abilities, upgrades, claims, contacts and extras are cleared. Name, reputation, base, ward boss, anger, rep, hold, tier, heat, wanted level, stacks, vaults, crew xp, cohorts, factions and notes stay.')) return;
      } else if (!ctx.confirm('Make the crew ' + r.name + '? This sets up the ' + r.name + ' crew sheet for the whole table; name, tier, hold, rep, heat, cohorts, factions and notes are kept.')) return;
      seed(crew, r); ctx.setDraft('cs.change', ''); ctx.commit();
    },
    cspick: function (d, crew, ctx) { ctx.setDraft('cs.pick', ctx.draft('cs.pick') === 'open' ? '' : 'open'); ctx.commit(); },   /* page state only: show or fold the covers */
    cschange: function (d, crew, ctx) { if (!ctx.isGM) return; ctx.setDraft('cs.change', d.v === 'close' || ctx.draft('cs.change') === 'open' ? '' : 'open'); ctx.commit(); },
    anger: function (d, crew, ctx) { crew.anger = toggleTrack(clamp(crew.anger, 0, COMMON.anger.segments), clamp(d.n, 1, COMMON.anger.segments)); ctx.commit(); },
    stacks: function (d, crew, ctx) { crew.stacks = toggleTrack(clamp(crew.stacks, 0, COMMON.stacks.pips), clamp(d.n, 1, COMMON.stacks.pips)); ctx.commit(); },
    xp: function (d, crew, ctx) { var r = rec(crew); if (!r) return; crew.xp = toggleTrack(clamp(crew.xp, 0, xpMax(r)), clamp(d.n, 1, xpMax(r))); ctx.commit(); },
    ability: function (d, crew, ctx) {
      var r = rec(crew), a = r && abilityOf(r, d.k); if (!a || abilityLocked(crew, r, a)) return;
      var n = clamp(d.n, 1, a.max); if (!isObj(crew.abilities)) crew.abilities = {};
      var v = toggleTrack(abilityN(crew, a.name), n); crew.abilities[a.name] = v;
      if (a.name === 'Versatile') crew.versatile = strs(crew.versatile, v);
      settle(crew, r); ctx.commit();
    },
    contact: function (d, crew, ctx) {
      var r = rec(crew); if (!r || !r.contacts.some(function (c) { return c[0] === d.k; })) return;
      if (!isObj(crew.contacts)) crew.contacts = {};
      var k = crew.contacts[d.k]; crew.contacts[d.k] = k === 'friend' ? 'rival' : k === 'rival' ? null : 'friend'; ctx.commit();
    },
    upgrade: function (d, crew, ctx) {
      var r = rec(crew), u = r && upgradeOf(r, d.k); if (!u) return;
      if (!isObj(crew.upgrades)) crew.upgrades = {};
      crew.upgrades[u.name] = toggleTrack(upN(crew, u.name, u.boxes), clamp(d.n, 1, u.boxes)); settle(crew, r); ctx.commit();
    },
    claim: function (d, crew, ctx) {
      var r = rec(crew), c = r && cellOf(r, d.id); if (!c || c.base) return;
      var map = claimMap(crew);
      if (map[c.id] === true) map[c.id] = false;
      else {
        if (!claimable(crew, r, c)) { if (!ctx.isGM) return; if (!ctx.confirm('“' + c.name + '” is not connected to a held claim. Claim it anyway (GM override)?')) return; }
        map[c.id] = true;
      }
      settle(crew, r); ctx.commit();
    },
    circle: function (d, crew, ctx) {
      var r = rec(crew), C = sp(r).circles || [], i = -1;
      C.forEach(function (c, k) { if (c.id === d.id) i = k; });
      if (i <= 0) return;
      var on = circMarked(crew, C[i]); if (!on && !circMarked(crew, C[i - 1])) return;
      var s = special(crew); if (!isObj(s.circles)) s.circles = {};
      /* descending marks this circle; leaving it also leaves every deeper circle */
      C.forEach(function (c, k) {
        if (k < i || (!on && k > i)) return;
        if (!isObj(s.circles[c.id])) s.circles[c.id] = { marked: !!c.marked, tally: '', truths: [] };
        s.circles[c.id].marked = !on;
      });
      settle(crew, r); ctx.commit();
    },
    truth: function (d, crew, ctx) {
      var r = rec(crew), c = (sp(r).circles || []).filter(function (x) { return x.id === d.c; })[0]; if (!c || c.truths.words.indexOf(d.v) < 0) return;
      var s = special(crew); if (!isObj(s.circles)) s.circles = {};
      var st = isObj(s.circles[c.id]) ? s.circles[c.id] : (s.circles[c.id] = { marked: !!c.marked, tally: '', truths: [] });
      var t = Array.isArray(st.truths) ? st.truths.slice() : [], at = t.indexOf(d.v);
      if (at >= 0) t.splice(at, 1); else { if (t.length >= c.truths.count) return; t.push(d.v); }
      st.truths = t; ctx.commit();
    },
    units: function (d, crew, ctx) { var r = rec(crew), P = sp(r).product; if (!P) return; var s = special(crew); s.units = toggleTrack(clamp(s.units, 0, P.unitsMax), clamp(d.n, 1, P.unitsMax)); ctx.commit(); },
    kind: function (d, crew, ctx) { var r = rec(crew), P = sp(r).product; if (!P || P.kinds.indexOf(d.v) < 0) return; var s = special(crew); s.productKind = s.productKind === d.v ? null : d.v; ctx.commit(); },
    stunt: function (d, crew, ctx) { var r = rec(crew), S = sp(r).stunts; if (!S || !S.list.some(function (x) { return x[0] === d.k; })) return; var s = special(crew); if (!isObj(s.stunts)) s.stunts = {}; s.stunts[d.k] = s.stunts[d.k] !== true; ctx.commit(); },
    edge: function (d, crew, ctx) { listToggle(crew, 'edges', 'vehicleEdges', d.k) && ctx.commit(); },
    flaw: function (d, crew, ctx) { listToggle(crew, 'flaws', 'vehicleFlaws', d.k) && ctx.commit(); },
    legacyclear: function (d, crew, ctx) { if (!Array.isArray(crew.legacyClaims) || !crew.legacyClaims.length) return; if (!ctx.confirm('Clear the old claims list from the generic crew panel?')) return; crew.legacyClaims = []; ctx.commit(); },
    /* end of session: a page-only panel (drafts), then one write */
    csend: function (d, crew, ctx) { var r = rec(crew); if (!r) return; ctx.setDraft('cs.end', d.v === 'close' || endState(ctx) ? null : { vals: r.xpTriggers.map(function () { return 0; }), done: null }); ctx.commit(); },
    csendval: function (d, crew, ctx) { var e = endState(ctx); if (!e || e.done) return; e.vals = (e.vals || []).slice(); e.vals[+d.i] = clamp(d.v, 0, 2); ctx.setDraft('cs.end', e); ctx.commit(); },
    csendmark: function (d, crew, ctx) {
      var r = rec(crew), e = endState(ctx); if (!r || !e || e.done) return;
      var total = sum(r.xpTriggers.map(function (t, i) { return clamp(e.vals && e.vals[i], 0, 2); })); if (!total) return;
      var xp = clamp(crew.xp, 0, xpMax(r)), add = Math.min(total, xpMax(r) - xp);
      crew.xp = xp + add; ctx.setDraft('cs.end', { vals: e.vals, done: { added: add, lost: total - add } }); ctx.commit();
    },
    cspayall: function (d, crew, ctx) {
      var r = rec(crew); if (!r || !ctx.isGM || clamp(crew.xp, 0, 99) < xpMax(r)) return;
      var list = payees(crew, ctx, false), amt = clamp(crew.tier, 0, 6) + 2;
      if (!ctx.confirm('Crew advance: pay ' + amt + ' (Tier+2) into the bank of ' + list.length + ' character' + (list.length === 1 ? '' : 's') + ' and reset crew xp to 0?')) return;
      pay(list, crew); crew.xp = 0; crew.advancePaid = wipe(crew.advancePaid, false); ctx.setDraft('cs.end', null); ctx.commit();
    },
    cspaymine: function (d, crew, ctx) {
      var r = rec(crew); if (!r || clamp(crew.xp, 0, 99) < xpMax(r)) return;
      var list = payees(crew, ctx, true); if (!list.length) return;
      pay(list, crew); ctx.commit();
    },
    csxpreset: function (d, crew, ctx) {
      var r = rec(crew); if (!r || !clamp(crew.xp, 0, 99)) return;
      if (!ctx.confirm('Reset crew xp to 0?' + (payees(crew, ctx, false).length ? ' Characters not yet paid for this advance will not be paid.' : ''))) return;
      crew.xp = 0; crew.advancePaid = wipe(crew.advancePaid, false); ctx.setDraft('cs.end', null); ctx.commit();
    }
  };
  function listToggle(crew, key, recKey, name) {
    var r = rec(crew), rows = sp(r)[recKey]; if (!rows || !rows.some(function (x) { return x[0] === name; })) return false;
    var s = special(crew), l = Array.isArray(s[key]) ? s[key].slice() : [], at = l.indexOf(name);
    if (at >= 0) l.splice(at, 1); else l.push(name);
    s[key] = l; return true;
  }
  ['tier', 'develop', 'hold', 'rep', 'turf', 'heat', 'wanted', 'vault', 'claimadd', 'claimheld', 'claimrm'].forEach(function (k) {
    acts[k] = function (d, crew, ctx, t) {
      var r = rec(crew);
      if (!r) return G.acts[k] ? G.acts[k](d, crew, ctx, t) : undefined;
      if (mine[k]) return mine[k](d, crew, ctx, r);
      if (k === 'hold' || k === 'heat') return G.acts[k](d, crew, ctx, t);
    };
  });
  ['cohortadd', 'cohortharm', 'cohortarmor', 'cohortrm', 'factionadd', 'factionstatus', 'factionrm'].forEach(function (k) { acts[k] = function (d, crew, ctx, t) { return G.acts[k](d, crew, ctx, t); }; });

  /* the numbers on the phone's summary row (campaign.js): the ones the sheet itself shows (turf and the Vault upgrade change them) */
  function summary(crew) {
    var r = rec(crew); if (!r) return null;
    var max = repMax(crew, r);
    return { tier: clamp(crew.tier, 0, 6), hold: crew.hold === 'strong' ? 'strong' : 'weak', rep: Math.min(clamp(crew.rep, 0, 12), max), repMax: max,
      heat: clamp(crew.heat, 0, COMMON.heat.pips), wanted: clamp(crew.wanted, 0, COMMON.wantedLevel.pips), stacks: clamp(crew.stacks, 0, COMMON.stacks.pips), vault: Math.min(clamp(crew.vault, 0, 16), vaultCap(crew, r)) };
  }
  M.setCrewPanel({ render: render, acts: acts, enter: {}, PERM: { cspick: 'all' }, summary: summary });
  M.crewSheet = { seed: seed, turfCount: turfCount, claimable: claimable, vaultCap: vaultCap,
    /* the crew sheet's markup for a copy outside the table page (the season print): ctx as campaign.js builds it; the
       live panel's text-path parent stays the table's own crew */
    render: function (crew, ctx) { var keep = live; try { return render(crew, ctx); } finally { live = keep; } },
    look: function (id) { var lk = LOOK[id]; return lk ? { duo: lk.duo.slice(), special: lk.special } : null; } };
})();
