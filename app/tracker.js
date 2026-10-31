/* tracker.js — the living character sheet. Owned by the tracker module. Sets window.B68Tracker.
   Everything on the printed playbook sheet becomes a live control; the whole `play` object is saved
   through api.save({ play }) on every change (immediately for clicks, debounced for typing).
   Round 3: the four paranormal playbooks (ghost, vampire, time travelers) and a printable layout.
   Round 4: dice at the table — action, resistance and fortune rolls from the Actions box, logged to play.log.
   Round 5: the Session box (start / end of session, end-of-session xp) and the Downtime box (indulge vice, recover,
   long-term project, train), each with an inline panel in the roll panel's style.
   Later: the character's name as the title; read only on someone else's sheet (api.canWrite per document); the table's
   session (api.table) with Join session N; on phones the boxes in play order, a mugshot thumbnail, wider touch targets. */
(function () {
  'use strict';
  var T = window.B68Tracker = {};
  var CT = window.B68Content || { PLAYBOOKS: [], byId: {}, ACTIONS: [], STANDARD_ITEMS: [], VICES: [] };
  /* The figure kit is not in the first load (routes.js 'figures'; MB0: drawing the thumbnail was most of a warm open's cost on a phone).
     Until it arrives the thumbnail is a placeholder (this character's last thumbnail from localStorage, else a silhouette) and the
     desk's Figure box says it is drawing; onKit() swaps the real one in, in place: the same <img>, the same box, once. */
  var K = null;
  function kit() { return K || (K = window.B68Figure || null); }
  var SIL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><rect width="240" height="240" fill="#d8d1c2"/><circle cx="120" cy="90" r="42" fill="#a39a88"/><path d="M34 240c0-54 36-86 86-86s86 32 86 86z" fill="#a39a88"/></svg>');
  var THUMBS = 'b68.thumbs.v1', THUMBS_KEEP = 6;
  function readThumb(id) { try { var o = JSON.parse(localStorage.getItem(THUMBS) || 'null'); var e = o && o.by && o.by[id || '']; return e && typeof e.u === 'string' ? e.u : ''; } catch (e) { return ''; } }
  function writeThumb(id, key, uri) {
    try {
      var o = JSON.parse(localStorage.getItem(THUMBS) || 'null'); if (!o || typeof o !== 'object' || !o.by || !Array.isArray(o.order)) o = { order: [], by: {} };
      id = id || ''; o.order = o.order.filter(function (x) { return x !== id; }); o.order.unshift(id); o.by[id] = { k: key.length + ':' + key.slice(0, 40), u: uri };
      o.order.slice(THUMBS_KEEP).forEach(function (x) { delete o.by[x]; }); o.order = o.order.slice(0, THUMBS_KEEP);
      localStorage.setItem(THUMBS, JSON.stringify(o));
    } catch (e) { /* private window, quota: the silhouette is the placeholder */ }
  }
  /* the drawn thumbnail is a 200 KB SVG: what is remembered is a small picture of it (160 px), made when the browser is idle, so
     six characters never crowd the draft the creator keeps in the same storage */
  function storeThumb(id, key, uri) {
    var later = window.requestIdleCallback || function (f) { return setTimeout(f, 200); };
    later(function () {
      try {
        var im = new Image();
        im.onload = function () { try { var c = document.createElement('canvas'); c.width = 160; c.height = 160; c.getContext('2d').drawImage(im, 0, 0, 160, 160); writeThumb(id, key, c.toDataURL('image/webp', 0.8)); } catch (e) {} };
        im.src = uri;
      } catch (e) {}
    });
  }
  var kitHooked = false;
  /* the kit arrived: the thumbnail on a phone, the figure on a desk, each redrawn in its own node and nothing else touched */
  function onKit() {
    if (!cur || cur.ui.static) return;
    try {
      if (narrow()) { if (cur.doc.spec) thumb(cur.doc); }
      else if (cur.ui.figNode) { figureSvg(cur.doc); cur.ui.figNode.innerHTML = cur.ui.svg || '<div class="ds-dim">' + esc(cur.ui.svgWarn || 'No figure yet.') + '</div>'; }
    } catch (e) { if (window.console) console.error(e); }
  }
  function B() { return window.B68 || {}; }

  /* ---------- helpers (prefer window.B68's, fall back locally) ---------- */
  /* a small "?" link to the rules wiki (rules.js), drawn only on the hosted build, which has the rules */
  function rl(term) { var R = window.B68Rules; return R && R.help ? R.help(term) : ''; }
  function esc(s) { if (B().esc) return B().esc(s); return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function el(tag, cls, html) { if (B().el) return B().el(tag, cls, html); var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function clamp(n, a, b) { n = +n || 0; return n < a ? a : n > b ? b : n; }
  function pbOf(id) { return CT.byId[id] || null; }
  function isHull(pb) { return !!(pb && pb.hull); }
  function isGhost(pb) { return !!(pb && pb.ghost); }
  function isVamp(pb) { return !!(pb && pb.vampire); }
  function isTT(pb) { return !!(pb && pb.timetraveler); }
  function isPara(pb) { return !!(pb && pb.paranormal); }
  function glitchy(pb) { return isGhost(pb) || isTT(pb); } /* keys are struck out with a named irregularity / glitch, never a deadlock */
  function stressMax(pb) { return pb && pb.stressMax ? +pb.stressMax : isHull(pb) ? 10 : 9; }
  function stressName(pb) { return pb && pb.stressName ? pb.stressName : isHull(pb) ? 'Drain' : 'Stress'; }
  function glitchName(pb) { return isTT(pb) ? 'Temporal glitch' : (pb && pb.deadlockName) || 'Echo irregularity'; }
  function glitchList(pb) { return isTT(pb) ? (pb.glitches || []) : (pb && pb.deadlocks) || []; }
  function glitchCount(play) { return play.keys.filter(function (k) { return k.glitch; }).length; }
  function alluvMax(pb) { return pb && pb.alluvium && pb.alluvium.max ? +pb.alluvium.max : 9; }
  function alluvStart(pb) { return pb && pb.alluvium && pb.alluvium.start != null ? +pb.alluvium.start : 4; }
  function missionOf(pb, name) { return ((pb && pb.missions) || []).filter(function (m) { return m.name === name; })[0] || null; }
  var ACTS = []; (CT.ACTIONS || []).forEach(function (g) { g[1].forEach(function (a) { ACTS.push(a); }); });
  var ATTRS = (CT.ACTIONS || []).map(function (g) { return g[0]; });
  function attrOf(action) { var r = null; (CT.ACTIONS || []).forEach(function (g) { if (g[1].indexOf(action) >= 0) r = g[0]; }); return r; }
  var MULTI = { 'Echo Pet': 2, 'Frame Upgrade': 3, 'Advanced Sparkmind': 2 };
  function abilityMax(pb, name) { var a = pb && pb.abilities ? pb.abilities.filter(function (x) { return x[0] === name; })[0] : null; return (a && +a[2]) || MULTI[name] || 1; }
  /* the highest rating an action may reach right now */
  function dotMax(play, pb, action) {
    if (isVamp(pb) && play.darkMajesty && attrOf(action) === play.darkMajesty) return 5;
    if (isTT(pb)) return 4;
    return play.mastery ? 4 : 3;
  }
  var AUTOMATON = ['Automaton', 'You are a soul powering a robotic body. Human-like strength and senses; built-in armor that doesn’t count for load; you start with no keys; you may be repaired if damaged or destroyed. Whenever you would take Stress, take Drain instead. Choose two frame features.'];
  var FIXED = { hull: AUTOMATON };

  var BURST = (function () { var pts = []; for (var i = 0; i < 32; i++) { var a = i * Math.PI / 16, r = i % 2 ? 11 : 15; pts.push((16 + r * Math.cos(a)).toFixed(1) + ',' + (16 + r * Math.sin(a)).toFixed(1)); } return '<svg viewBox="0 0 32 32" aria-hidden="true"><polygon points="' + pts.join(' ') + '"/></svg>'; })();
  function listText(v, sep) { return Array.isArray(v) ? v.filter(Boolean).join(sep || ', ') : String(v == null ? '' : v); }
  function keyParts(k) { var m = String(k || '').match(/^(.*?)\s*\(\s*▼\s*(.*?)\s*▲\s*(.*?)\s*\)\s*$/); return m ? { name: m[1].trim(), down: m[2].trim(), up: m[3].trim() } : { name: String(k || '').trim(), down: '', up: '' }; }
  function cohortExpert(pb) { var m = pb && pb.cohort && pb.cohort.text ? pb.cohort.text.match(/\((Expert[^)]*)\)/) : null; return m ? m[1] : ''; }
  /* a typed answer to a numbered prompt: "2" or a (prefix of a) name; returns the index or -1 */
  function pickIndex(names, v) {
    v = String(v == null ? '' : v).trim(); if (!v) return -1;
    if (/^\d+$/.test(v)) { var n = +v; return n >= 1 && n <= names.length ? n - 1 : -1; }
    var lv = v.toLowerCase(), i;
    for (i = 0; i < names.length; i++) if (String(names[i]).toLowerCase() === lv) return i;
    for (i = 0; i < names.length; i++) if (String(names[i]).toLowerCase().indexOf(lv) === 0) return i;
    return -1;
  }
  function numbered(names) { return names.map(function (n, i) { return (i + 1) + '. ' + n; }).join('\n'); }

  /* ---------- dice (round 4) ----------
     Standard Forged in the Dark reading: d6 per die, read the single highest; 6 success, 4–5 partial, 1–3 failure,
     two or more 6s a critical. Zero dice: roll 2d6 and take the LOWEST (no critical possible).
     T._rng is the only source of randomness so tests can replace it with a deterministic 0..1 function. */
  T._rng = Math.random;
  function d6() { var r = +T._rng(); if (!(r >= 0)) r = 0; return 1 + Math.min(5, Math.floor(r * 6)); }
  function readDice(dice, low) {
    var v = low ? Math.min.apply(null, dice) : Math.max.apply(null, dice), sixes = dice.filter(function (x) { return x === 6; }).length;
    var crit = !low && sixes >= 2;
    return { value: v, crit: crit, reading: crit ? 'critical' : v === 6 ? 'success' : v >= 4 ? 'partial' : 'failure' };
  }
  function rollDice(n) { n = Math.max(0, n | 0); var low = n === 0, k = low ? 2 : n, dice = []; for (var i = 0; i < k; i++) dice.push(d6()); var r = readDice(dice, low); r.dice = dice; r.low = low; r.n = n; return r; }
  var OUTCOMES = {
    controlled: { critical: 'You do it with increased effect.', success: 'You do it.', partial: 'You hesitate: withdraw and try a different approach, or do it with a minor consequence.', failure: 'You falter: press on by seizing a risky opportunity, or withdraw and try a different approach.' },
    risky: { critical: 'You do it with increased effect.', success: 'You do it.', partial: 'You do it, but there’s a consequence: harm, a complication, reduced effect or a worse position.', failure: 'Things go badly: harm, a complication, a lost opportunity or a worse position.' },
    desperate: { critical: 'You do it with increased effect.', success: 'You do it.', partial: 'You do it, but there’s a consequence: severe harm, a serious complication or reduced effect.', failure: 'It’s the worst outcome: severe harm, a serious complication or a lost opportunity.' }
  };
  var POSITIONS = ['controlled', 'risky', 'desperate'], EFFECTS = ['limited', 'standard', 'great'];
  function attrRating(play, attr) { var g = (CT.ACTIONS || []).filter(function (x) { return x[0] === attr; })[0]; return g ? g[1].filter(function (a) { return (play.dots[a] || 0) > 0; }).length : 0; }
  function resistDice(play, pb, attr) { return attrRating(play, attr) + (isVamp(pb) && play.darkMajesty === attr ? 1 : 0); }
  /* what happens when the stress track overflows, by playbook: shown when a push would take it past the last box */
  function overflowRule(pb) { return isHull(pb) ? 'the On Program rule applies' : isGhost(pb) ? 'you are fully drained: an echo irregularity' : isTT(pb) ? 'Instability is full: a temporal glitch' : 'the trauma rule applies'; }
  var PIPS = { 1: [[18, 18]], 2: [[9, 9], [27, 27]], 3: [[9, 9], [18, 18], [27, 27]], 4: [[9, 9], [27, 9], [9, 27], [27, 27]], 5: [[9, 9], [27, 9], [18, 18], [9, 27], [27, 27]], 6: [[9, 9], [9, 18], [9, 27], [27, 9], [27, 18], [27, 27]] };
  function dieSvg(v, cls, size) {
    var pts = PIPS[v] || [], h = '';
    for (var i = 0; i < pts.length; i++) h += '<circle cx="' + pts[i][0] + '" cy="' + pts[i][1] + '" r="3.4"/>';
    return '<svg class="ds-die' + (cls ? ' ' + cls : '') + '" viewBox="0 0 36 36"' + (size ? ' width="' + size + '" height="' + size + '"' : '') + ' role="img" aria-label="die ' + v + '"><rect x="2" y="2" width="32" height="32" rx="6"/>' + h + '</svg>';
  }
  function diceSvgs(r) { return '<div class="ds-dice" aria-label="dice ' + r.dice.join(', ') + '">' + r.dice.map(function (d) { return dieSvg(d, (d === r.value ? 'hi' : '') + (d === 6 ? ' six' : '')); }).join('') + '</div>'; }
  function capWord(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  /* ---------- sessions and downtime (round 5) ---------- */
  function memoriesDone(play) { return !!(play.memories && play.memories.length) && play.memories.every(function (m) { return (m.filled || 0) >= (m.size || 8); }); }
  /* the end-of-session xp triggers, exactly as the XP box lists them */
  function sessionTriggers(play, pb) {
    if (isPara(pb) && pb.xpTriggers && pb.xpTriggers.length) return pb.xpTriggers.slice();
    var first = pb && pb.xp ? 'You ' + pb.xp.replace(/^address/, 'addressed').replace(/^obey orders, or address/, 'obeyed orders, or addressed') + '.' : 'You addressed a challenge in your playbook’s way.';
    if (isHull(pb) && memoriesDone(play)) first = 'You worked to free yourself from your owning faction and controller, or addressed a challenge with your humanity.';
    return [first, 'You struggled with issues stemming from a deadlock.'];
  }
  function trigLabel(t) { return String(t).replace(/^You\s+/, '').replace(/\.\s*$/, ''); }
  /* indulging vice rolls the lowest attribute rating */
  function lowestAttr(play) { var best = null; ATTRS.forEach(function (a) { var n = attrRating(play, a); if (!best || n < best.n) best = { attr: a, n: n }; }); return best || { attr: '', n: 0 }; }
  /* clock ticks from a downtime roll: 1–3 one, 4–5 two, 6 three, critical five */
  function ticksFor(res) { return res.crit ? 5 : res.value >= 6 ? 3 : res.value >= 4 ? 2 : 1; }
  /* a full healing clock steps every harm down a level: 3 → 2, 2 → 1, 1 cleared. Level 4 (mortal) is not healed by a clock. */
  function stepHarm(hm) {
    function two(a) { a = a.filter(function (x) { return x; }); while (a.length < 2) a.push(''); return a.slice(0, 2); }
    return { l4: hm.l4 || '', l3: '', l2: two([hm.l3 || '']), l1: two([(hm.l2 || [])[0] || '', (hm.l2 || [])[1] || '']) };
  }
  function harmCount(hm) { return [hm.l3, hm.l2[0], hm.l2[1], hm.l1[0], hm.l1[1]].filter(function (x) { return x; }).length; }

  /* ---------- the play object ---------- */
  function blankPlay() {
    var dots = {}; ACTS.forEach(function (a) { dots[a] = 0; });
    return { v: 1, crew: '', stress: 0, xp: { playbook: 0, insight: 0, prowess: 0, resolve: 0 }, dots: dots, abilities: [], abilityTicks: {}, frame: [],
      keys: [], roboticDeadlocks: [], harm: { l1: ['', ''], l2: ['', ''], l3: '', l4: '' }, healing: 0, armor: { armor: false, heavy: false }, resource: [false, false],
      stacks: 0, bank: 0, items: [], extraItems: [], loadLimit: 'quiet', cohort: { name: '', type: '', edges: '', flaws: '', abilities: '', harm: null, armor: false },
      contacts: [], vice: '', purveyor: '', clocks: [], memories: [], suspicion: 0, mastery: false, notes: '', log: [],
      /* paranormal playbooks */
      alluvium: 0, strictures: [], darkMajesty: null, mission: null, ghostItems: '', enemies: '', feeding: '', telltale: '', echoAbilities: '',
      /* round 5: sessions and downtime */
      session: 0, keyHitSession: {}, trainedThisDowntime: false, xpHold: 0 };
  }
  function blankMission(name, answers) { var a = Array.isArray(answers) ? answers.slice(0, 4).map(function (x) { return String(x == null ? '' : x); }) : []; while (a.length < 4) a.push(''); return { name: name || '', answers: a, details: [] }; }
  function initialPlay(sheet, playbookId) {
    sheet = sheet || {}; var pb = pbOf(playbookId || sheet.playbook); var p = blankPlay();
    var d = sheet.dots || {}; ACTS.forEach(function (a) { p.dots[a] = clamp(d[a], 0, 4); });
    if (pb && pb.hull) p.abilities.push('Automaton');
    if (pb && pb.fixedAbility) p.abilities.push(pb.fixedAbility[0]);
    [sheet.ability, sheet.ability2, sheet.customAbility].forEach(function (a) { if (a && p.abilities.indexOf(a) < 0) p.abilities.push(a); });
    p.frame = (sheet.frame || []).slice();
    var keys = (sheet.keys || []).concat(sheet.customKey ? [sheet.customKey] : []), locks = sheet.keyLocks || {};
    keys.slice(0, 4).forEach(function (k) {
      var ps = keyParts(k); ps.hits = 0; ps.deadlock = null; ps.glitch = null;
      if (sheet.deadlockKey === k && sheet.deadlockMode) ps.deadlock = sheet.deadlockMode === '▲' ? 'up' : 'down';
      if (isVamp(pb)) { var l = locks[k] != null ? locks[k] : locks[ps.name]; ps.deadlock = l === 'up' || l === '▲' ? 'up' : 'down'; } /* vampire: every key starts deadlocked */
      p.keys.push(ps);
    });
    if (!isGhost(pb) && !isTT(pb)) {
      var sc = sheet.contacts || {};
      ((pb && pb.contacts) || []).forEach(function (c) { p.contacts.push({ name: c[0], role: c[1], kind: sc[c[0]] === 'friend' || sc[c[0]] === 'rival' ? sc[c[0]] : null }); });
      Object.keys(sc).forEach(function (n) { if (!p.contacts.some(function (c) { return c.name === n; })) p.contacts.push({ name: n, role: '', kind: sc[n] || null }); });
      if (sheet.contactCustom) p.contacts.push({ name: sheet.contactCustom, role: '', kind: /rival/i.test(sheet.contactCustom) ? 'rival' : 'friend' });
    }
    if (!isHull(pb) && !isPara(pb)) { p.vice = sheet.vice || ''; p.purveyor = sheet.purveyor || ''; }
    p.items = isGhost(pb) ? [] : (sheet.items || []).slice();
    if (pb && pb.cohort) p.cohort = { name: sheet.cohortName || '', type: [sheet.cohortType, sheet.cohortHousing].filter(Boolean).join(' · '), edges: sheet.cohortEdges || '', flaws: sheet.cohortFlaws || '', abilities: cohortExpert(pb), harm: null, armor: false };
    if (isHull(pb)) p.memories = (pb.memories || []).map(function (q) { return { name: q, size: 8, filled: 0, text: '' }; });
    if (isGhost(pb)) { p.ghostItems = String(sheet.ghostItems || ''); p.enemies = String(sheet.enemies || ''); }
    if (isVamp(pb)) {
      p.strictures = ['Dayfire'].concat([].concat(sheet.stricture || []).map(function (s) { return String(s || '').trim(); })).filter(function (s, i, a) { return s && a.indexOf(s) === i; });
      p.feeding = String(sheet.feeding || ''); p.telltale = String(sheet.telltale || ''); p.echoAbilities = String(sheet.echoAbilities || '');
    }
    if (isTT(pb)) { p.alluvium = alluvStart(pb); p.mission = blankMission(sheet.mission, sheet.missionAnswers); p.bank = 0; }
    return p;
  }
  T.initialPlay = initialPlay;
  /* fill in anything an older or partial play is missing */
  function normalize(play, sheet, pbId) {
    var base = play && typeof play === 'object' ? clone(play) : initialPlay(sheet, pbId); var b = blankPlay(), pb = pbOf(pbId);
    /* playbook-specific defaults first, so a v:2 doc filed before round 3 gets its real starting values */
    if (isTT(pb)) {
      if (base.alluvium == null) base.alluvium = alluvStart(pb);
      if (!base.mission || typeof base.mission !== 'object') base.mission = blankMission(sheet && sheet.mission, sheet && sheet.missionAnswers);
      if (!Array.isArray(base.mission.answers)) base.mission.answers = []; while (base.mission.answers.length < 4) base.mission.answers.push('');
      if (!Array.isArray(base.mission.details)) base.mission.details = [];
    }
    if (isVamp(pb)) { if (!Array.isArray(base.strictures)) base.strictures = []; if (base.strictures.indexOf('Dayfire') < 0) base.strictures.unshift('Dayfire'); }
    Object.keys(b).forEach(function (k) { if (base[k] === undefined || base[k] === null) base[k] = b[k]; });
    ACTS.forEach(function (a) { base.dots[a] = clamp(base.dots[a], 0, 5); });
    ['playbook', 'insight', 'prowess', 'resolve'].forEach(function (k) { base.xp[k] = clamp(base.xp[k], 0, k === 'playbook' ? 8 : 6); });
    base.stress = clamp(base.stress, 0, stressMax(pb));
    base.alluvium = clamp(base.alluvium, 0, alluvMax(pb));
    if (!Array.isArray(base.contacts)) { var arr = []; Object.keys(base.contacts).forEach(function (n) { arr.push({ name: n, role: '', kind: base.contacts[n] }); }); base.contacts = arr; }
    if (!Array.isArray(base.harm.l1)) base.harm.l1 = [String(base.harm.l1 || ''), '']; if (!Array.isArray(base.harm.l2)) base.harm.l2 = [String(base.harm.l2 || ''), ''];
    if (!Array.isArray(base.keys)) base.keys = [];
    base.keys.forEach(function (k) { if (k.deadlock === undefined) k.deadlock = null; if (k.glitch === undefined) k.glitch = null; if (!k.hits) k.hits = 0; });
    if (isHull(pb) && !base.memories.length) base.memories = (pb.memories || []).map(function (q) { return { name: q, size: 8, filled: 0, text: '' }; });
    if (isTT(pb)) base.bank = 0;
    base.session = Math.max(0, Math.floor(+base.session || 0));
    if (typeof base.keyHitSession !== 'object' || Array.isArray(base.keyHitSession)) base.keyHitSession = {};
    base.trainedThisDowntime = !!base.trainedThisDowntime;
    base.xpHold = clamp(Math.floor(+base.xpHold || 0), 0, 99);
    return base;
  }

  /* ---------- paths ---------- */
  function getPath(o, path) { var ps = path.split('.'); for (var i = 0; i < ps.length; i++) { if (o == null) return undefined; o = o[ps[i]]; } return o; }
  function setPath(o, path, v) { var ps = path.split('.'); for (var i = 0; i < ps.length - 1; i++) { if (o[ps[i]] == null || typeof o[ps[i]] !== 'object') o[ps[i]] = {}; o = o[ps[i]]; } o[ps[ps.length - 1]] = v; }

  /* ---------- state ---------- */
  var cur = null; /* { doc, api, play, pb, root, ui, timer, saving, status, ownerName } */
  var SAVE_DELAY = 400;
  function readOnly() { return !!(cur && cur.api && cur.api.canWrite === false); }
  /* someone else's sheet: filed with an owner who is not the viewer */
  function foreign() { var o = cur && cur.doc && cur.doc.owner; return !!o && o !== (cur.api && cur.api.me); }
  function roLabel() { return 'Read only' + (foreign() ? ' · ' + (cur.ownerName || 'another player') + '’s character' : ''); }
  /* "Saved" only when the runtime says nothing is waiting: the hosted runtime (runtime/cf.js) resolves a save as soon as it is
     queued while offline, and window.B68Runtime.status = { online, pending } says what is still on this device */
  function savedMsg() {
    var R = window.B68Runtime, s = R && R.status, n = s ? Math.max(0, Math.floor(+s.pending || 0)) : 0;
    return n ? 'Saved on this phone · will sync (' + n + ')' : 'Saved';
  }
  /* the status line as it should read after a re-render: the last one set, never a made-up "Saved" */
  function statusNow() {
    var s = cur.status || { msg: '' };
    if (readOnly() && !s.bad && !s.transient) return { msg: roLabel() };
    if (!readOnly() && /^Read only/.test(s.msg)) return { msg: savedMsg() };
    return s;
  }
  function setStatus(msg, bad, transient) {
    if (!cur) return; cur.status = { msg: msg, bad: !!bad, transient: !!transient };
    var s = cur.root.querySelector('#ds-status');
    if (s) { s.textContent = msg; s.className = 'ds-status' + (bad ? ' bad' : ''); }
    if (cur.statusT) clearTimeout(cur.statusT);
    if (transient) cur.statusT = setTimeout(function () { if (cur) setStatus(readOnly() ? roLabel() : cur.timer || cur.saving ? 'Saving…' : savedMsg()); }, 2400);
  }
  /* the runtime's queue moved (b68:runtime): a "Saved…" line follows it (queued → synced, or the other way) */
  function onRuntime() {
    if (!cur || readOnly() || cur.timer || cur.saving) return;
    var s = cur.status || {}; if (s.bad || s.transient || !/^Saved/.test(s.msg || '')) return;
    var m = savedMsg(); if (m !== s.msg) setStatus(m);
  }
  function note(msg) { setStatus(msg, false, true); }
  /* the owner's name for "Read only · Sam’s character", when the runtime can name people */
  function askOwner() {
    var c = cur, o = c && c.doc.owner, pf = c && c.api && c.api.profiles;
    if (!foreign() || typeof pf !== 'function' || c.ownerAsked === o) return; c.ownerAsked = o;
    Promise.resolve().then(function () { return pf([o]); }).then(function (m) {
      var n = m && m[o]; if (cur !== c || !n || c.doc.owner !== o) return;
      c.ownerName = String(n); if (readOnly() && !(c.status && (c.status.bad || c.status.transient))) setStatus(roLabel());
    }, function () {});
  }
  /* ---------- saving (robustness, C16) ----------
     cur.server: the play as the store last had it (opened, a remote snapshot applied, or a save it accepted).
     cur.base:   cur.server when this run of local changes began (the first change after everything had landed).
     cur.remote: a snapshot that arrived while a save was in flight or typing waited; merged once everything has landed: a field
                 changed here since cur.base keeps this sheet's value, every other field takes the snapshot's.
     cur.refused: a save the store refused (4xx): once everything has landed the sheet goes back to cur.server, so no mark the
                 store does not have stays on screen. */
  var LOG_MAX = 200;   /* play.log keeps the newest 200 entries (the campaign log's cap) */
  function capLog(p) { if (p && Array.isArray(p.log) && p.log.length > LOG_MAX) p.log = p.log.slice(0, LOG_MAX); }
  function addLog(p, entry) { p.log = [entry].concat(Array.isArray(p.log) ? p.log : []); capLog(p); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function refusal(e) { var s = e && +e.status; return s >= 400 && s < 500 && s !== 401 && s !== 408 && s !== 409 && s !== 429; }   /* refused, not "not now" */
  function begin(c) { if (!c.base) c.base = clone(c.server || c.play); }
  function flushSave() {
    if (!cur) return; if (cur.timer) { clearTimeout(cur.timer); cur.timer = null; }
    if (readOnly()) { setStatus(roLabel()); return; }
    if (!cur.api || typeof cur.api.save !== 'function') { setStatus('Not saved: this view cannot save'); return; }
    var c = cur; begin(c); capLog(c.play);
    var snap = clone(c.play); c.saving++; setStatus('Saving…'); var p;
    try { p = c.api.save({ play: snap }); } catch (e) { c.saving--; setStatus('Could not save: ' + (e && e.message || e), true); settle(c); return; }
    Promise.resolve(p).then(function () {
      if (cur !== c) return; c.saving--; if (!c.refused) c.server = snap;
      if (!c.saving && !c.timer) { setStatus(savedMsg()); settle(c); }
    }, function (e) {
      if (cur !== c) return; c.saving--;
      var why = e && e.message || e || 'unknown error';
      if (refusal(e)) { c.refused = String(why); setStatus('Not saved (' + why + '): undone', true); }
      else setStatus('Could not save: ' + why, true);
      if (!c.saving && !c.timer) settle(c);
    });
  }
  function scheduleSave() { if (!cur) return; begin(cur); if (cur.timer) clearTimeout(cur.timer); setStatus('Saving…'); cur.timer = setTimeout(function () { cur.timer = null; flushSave(); }, SAVE_DELAY); }
  /* everything this sheet sent has landed: undo a refused change, or merge what arrived meanwhile */
  function settle(c) {
    if (cur !== c || c.saving || c.timer) return;
    var remote = c.remote, refused = c.refused; c.remote = null; c.refused = false;
    if (refused) { var f = captureFocus(), back = clone(c.server); if (f && f.path) setPath(back, f.path, f.value); c.play = back; c.base = null; render(); return; }
    if (remote) applyRemote(remote, c.base);
    c.base = null;
  }
  /* a snapshot of this sheet from the store (T.update, or one held while a save was in flight). `base`: the play before this
     sheet's own unsaved run; a field changed since then keeps this sheet's value. Never clobbers the field being typed in. */
  function applyRemote(doc, base) {
    var c = cur, focus = captureFocus(), incoming = normalize(doc.play, doc.sheet, doc.playbook), out = incoming;
    if (base) { out = {}; Object.keys(incoming).forEach(function (k) { out[k] = same(c.play[k], base[k]) ? incoming[k] : c.play[k]; }); Object.keys(c.play).forEach(function (k) { if (!(k in out)) out[k] = c.play[k]; }); }
    var head = function (d) { return [d.name, d.alias, d.code, d.owner, d.playbook, d.spec, d.sheet]; }, moved = !same(head(doc), head(c.doc));
    if (doc.owner !== c.doc.owner) c.ownerName = null;
    c.doc = doc; c.pb = pbOf(doc.playbook) || c.pb; c.server = clone(out);
    if (focus && focus.path) setPath(out, focus.path, focus.value);
    if (moved || !same(out, c.play)) { c.play = out; render(); }
  }
  /* the page is going away or into the background (a phone locked mid-word): typing that waits for its debounce goes out now */
  function onHide(e) { if (!cur || !cur.timer || (e && e.type === 'visibilitychange' && document.visibilityState !== 'hidden')) return; clearTimeout(cur.timer); cur.timer = null; flushSave(); }
  /* a click changed play: redraw and save at once */
  function commit() { if (!cur) return; render(); flushSave(); }

  /* ---------- small renderers ---------- */
  function box(title, body, right, cls, after) { return '<section class="ds-box' + (cls ? ' ' + cls : '') + '"><div class="ds-band"><h3 class="ds-bt">' + title + '</h3>' + (right ? '<span class="ds-band-r">' + right + '</span>' : '') + '</div><div class="ds-body">' + body + '</div>' + (after || '') + '</section>'; }
  /* a keyed slot is a comment anchor and the nodes after it (no wrapper element, so the layout and every selector stay as they were).
     render() replaces a slot's nodes only when its markup changed */
  function slotMark(name) { return '<!--s:' + name + '-->'; }
  function syncStatus() {
    var s = cur.ui.static ? null : cur.root.querySelector('#ds-status'); if (!s) return;
    var st = statusNow(), c = 'ds-status' + (st.bad ? ' bad' : ''); if (s.textContent !== st.msg) s.textContent = st.msg; if (s.className !== c) s.className = c;
  }
  function pipRow(n, filled, act, extra, cls) { var h = '<span class="ds-pips">'; for (var i = 1; i <= n; i++) h += '<button type="button" class="' + (cls || 'ds-pip') + (i <= filled ? ' on' : '') + '" data-act="' + act + '" data-n="' + i + '"' + (extra || '') + ' aria-label="' + act + ' ' + i + '"></button>'; return h + '</span>'; }
  function clockSvg(size, filled, r, act, extra) {
    var cx = r, cy = r, R = r - 2, h = '', n = clamp(size, 2, 12);
    for (var i = 0; i < n; i++) {
      var a0 = -Math.PI / 2 + i * 2 * Math.PI / n, a1 = a0 + 2 * Math.PI / n;
      var x0 = (cx + R * Math.cos(a0)).toFixed(2), y0 = (cy + R * Math.sin(a0)).toFixed(2), x1 = (cx + R * Math.cos(a1)).toFixed(2), y1 = (cy + R * Math.sin(a1)).toFixed(2);
      var big = n === 2 ? 1 : 0;
      h += '<path class="ds-seg' + (i < filled ? ' on' : '') + '" data-act="' + act + '" data-n="' + (i + 1) + '"' + (extra || '') + ' d="M' + cx + ' ' + cy + ' L' + x0 + ' ' + y0 + ' A' + R + ' ' + R + ' 0 ' + big + ' 1 ' + x1 + ' ' + y1 + ' Z"><title>' + (i + 1) + ' / ' + n + '</title></path>';
    }
    return '<svg class="ds-clock" viewBox="0 0 ' + 2 * r + ' ' + 2 * r + '" width="' + 2 * r + '" height="' + 2 * r + '" role="img" aria-label="clock ' + filled + ' of ' + n + '">' + h + '<circle class="ds-clock-rim" cx="' + cx + '" cy="' + cy + '" r="' + R + '"/></svg>';
  }
  function input(path, value, ph, cls) { return '<input type="text" class="ds-in' + (cls ? ' ' + cls : '') + '" data-path="' + esc(path) + '" value="' + esc(value) + '" placeholder="' + esc(ph || '') + '">'; }
  function textarea(path, value, ph, cls) { return '<textarea class="ds-ta' + (cls ? ' ' + cls : '') + '" data-path="' + esc(path) + '" placeholder="' + esc(ph || '') + '">' + esc(value) + '</textarea>'; }
  function diamonds(n, filled, act, dis) { var h = ''; for (var i = 1; i <= n; i++) h += '<button type="button" class="ds-dia' + (i <= filled ? ' on' : '') + '" data-act="' + act + '" data-n="' + i + '"' + (dis ? ' disabled' : '') + ' aria-label="' + act + ' ' + i + '"></button>'; return h; }
  function sq(on, act, extra) { return '<button type="button" class="ds-sq' + (on ? ' on' : '') + '" data-act="' + act + '"' + (extra || '') + '></button>'; }

  /* ---------- sections ---------- */
  function header(doc, play, pb, sheet) {
    var alt = '';
    if (isHull(pb)) alt = '<div><span class="ds-lab">Owning faction</span>' + esc(sheet.owning || '—') + (sheet.heritageDetail ? '<div class="ds-dim">' + esc(sheet.heritageDetail) + '</div>' : '') + '</div>';
    else {
      alt = '<div><span class="ds-lab">Heritage</span>' + esc(sheet.heritage || '—') + (sheet.heritageDetail ? '<div class="ds-dim">' + esc(sheet.heritageDetail) + '</div>' : '') + '</div>';
      if (pb && pb.altBackground) alt += '<div><span class="ds-lab">' + esc(pb.altBackground.label) + '</span>' + esc(listText(sheet.alt, ' · ') || '—') + (sheet.backgroundDetail ? '<div class="ds-dim">' + esc(sheet.backgroundDetail) + '</div>' : '') + '</div>';
      else alt += '<div><span class="ds-lab">Background</span>' + esc(sheet.background || '—') + (sheet.backgroundDetail ? '<div class="ds-dim">' + esc(sheet.backgroundDetail) + '</div>' : '') + '</div>';
    }
    if (pb && pb.backing) alt += '<div><span class="ds-lab">Backing faction</span>' + esc(sheet.backing || '—') + (sheet.mission ? '<div class="ds-dim">Mission: ' + esc(sheet.mission) + '</div>' : '') + '</div>';
    if (pb && pb.veteran) alt += '<div><span class="ds-lab">Damage</span>' + esc(sheet.damage || '—') + '</div><div><span class="ds-lab">Something that helps</span>' + esc(sheet.helps || '—') + '</div>';
    var ro = readOnly(), st = statusNow(), live = !cur.ui.static, name = doc.name || sheet.name || 'Unknown';
    var th = live && narrow() ? thumbTag(doc, pb) : ''; /* phones only; the season print has its own figure slot */
    var desc = (pb && pb.subtitle ? esc(pb.subtitle) + ' · ' : '') + esc(pb ? pb.descriptor : '');
    /* the wrappers (.ds-idrow, .ds-bar, .ds-about) only group on a phone: on a desk and in print they are display: contents,
       so the head's grid is what it was. On a phone the bar (Back, the status, Print, "…" and the vitals) sticks to the top
       and the identity folds into one closed "About" row. */
    var mbtn = live ? missionButton() : '';
    return '<div class="ds-head">' +
      '<div class="ds-idrow">' +
        '<div class="ds-title"><h2 class="ds-name">' + esc(name) + '</h2><div class="ds-pb">' + esc(pb ? pb.name : doc.playbookName || 'Subject') + '</div><div class="ds-desc">' + desc + '</div></div>' + th +
      '</div>' +
      '<div class="ds-bar">' +
        '<div class="ds-nav' + (mbtn ? ' ds-nav-m' : '') + '">' +
          '<button type="button" class="btn sm" data-act="back" data-always="1">← Back</button>' +
          (live ? tableButton() : '') +
          mbtn +
          '<button type="button" class="btn sm ds-wide" data-act="edit"' + (ro ? ' disabled' : '') + '>Edit figure</button>' +
          '<button type="button" class="btn sm" data-act="print" data-always="1">Print</button>' +
          (live ? moreMenu(name) : '') +
          (live ? '<span class="ds-status" id="ds-status"></span>' : '<span class="ds-status' + (st.bad ? ' bad' : '') + '" id="ds-status">' + esc(st.msg) + '</span>') +   /* a live sheet's status text is written by syncStatus, never part of the compared markup */
        '</div>' +
        (live ? slotMark('vitals') : '') +   /* its own slot (see render) */
      '</div>' +
      (live ? '<button type="button" class="ds-about-t" data-act="about" data-always="1" aria-expanded="' + !!cur.ui.about + '" aria-controls="ds-about"><span>About ' + esc(name) + '</span><span class="ds-chev" aria-hidden="true">' + (cur.ui.about ? '▴' : '▾') + '</span></button>' : '') +
      '<div class="ds-about' + (cur.ui.about ? ' open' : '') + '"' + (live ? ' id="ds-about"' : '') + '>' + (live && desc ? '<p class="ds-desc">' + desc + '</p>' : '') +
        '<div class="ds-ident">' +
          '<div><span class="ds-lab">' + (isHull(pb) ? 'Designation' : 'Name') + '</span><b>' + esc(name) + '</b></div>' +
          '<div><span class="ds-lab">Alias</span>' + esc(doc.alias || sheet.alias || '—') + '</div>' +
          '<div><span class="ds-lab">Crew</span>' + input('crew', play.crew, 'Your crew') + '</div>' +
          '<div><span class="ds-lab">Code</span><span class="mono">' + esc(doc.code || '') + '</span></div>' +
        '</div>' +
        '<div class="ds-bio">' +
          '<div><span class="ds-lab">Look</span>' + esc(sheet.look || '—') + '</div>' +
          '<div><span class="ds-lab">Wearing</span>' + esc(listText(sheet.wearing) || '—') + '</div>' + alt +
        '</div>' +
      '</div>' +
      '<div class="ds-printfig' + (isGhost(pb) ? ' ghostly' : '') + '" aria-hidden="true"></div>' + /* filled only while printing (see beforeprint) */
    '</div>';
  }
  /* "…": Edit figure (on a phone; a desk has it in the row) and, at its foot, Remove, for the character's owner and the GM only */
  function canRemove() {
    if (!cur || cur.ui.static || readOnly() || !cur.api || typeof cur.api.remove !== 'function') return false;
    if (B().isGM === true) return true;
    var o = cur.doc && cur.doc.owner, me = cur.api.me || null;
    return o ? o === me : !me;   /* an unowned sheet: only where nobody is signed in (a copy of one's own) */
  }
  function moreMenu(name) {
    var ro = readOnly(), rm = canRemove(), open = !!cur.ui.more; if (ro && !rm) return '';
    return '<span class="ds-more"><button type="button" class="btn sm ds-morebtn' + (rm ? '' : ' ds-narrow') + '" data-act="more" data-always="1" aria-haspopup="menu" aria-expanded="' + open + '" aria-label="More" title="More">…</button>' +
      (open ? '<span class="ds-menu" role="menu">' + (ro ? '' : '<button type="button" class="ds-mi ds-narrow" role="menuitem" data-act="edit">Edit figure</button>') +
        (rm ? '<button type="button" class="ds-mi ds-mi-rm" role="menuitem" data-act="remove">Remove ' + esc(name) + '…</button>' : '') + '</span>' : '') + '</span>';
  }
  /* a sticky line on a phone: Stress 6/9 · Harm 1 · XP 3/8 · Load 2/3, each a jump to its box */
  function harmLines(hm) { var n = 0, worst = ''; [['l4', 4], ['l3', 3], ['l2', 2], ['l1', 1]].forEach(function (k) { [].concat(hm[k[0]]).forEach(function (t) { t = String(t == null ? '' : t).trim(); if (!t) return; n++; if (!worst) worst = k[1] + ': ' + t; }); }); return { n: n, worst: worst }; }
  function vitals(play, pb) {
    var sm = stressMax(pb), hl = harmLines(play.harm), ld = loadNow(play, pb), parts = [
      ['ds-stressbox', stressName(pb), play.stress + '/' + sm, play.stress >= sm, stressName(pb) + ' ' + play.stress + ' of ' + sm],
      ['ds-harmbox', isHull(pb) ? 'Damage' : 'Harm', String(hl.n), /^[34]:/.test(hl.worst), hl.n ? hl.n + ' harm, worst level ' + hl.worst : 'No harm'],
      ['ds-xpbox', 'XP', play.xp.playbook + '/8' + (play.xpHold ? ' +' + play.xpHold : ''), play.xp.playbook >= 8, 'Playbook xp ' + play.xp.playbook + ' of 8' + (play.xpHold ? ', ' + play.xpHold + ' unspent' : '')]];
    if (ld) parts.push(['ds-itembox', 'Load', ld.total + '/' + ld.limit, ld.total > ld.limit, 'Load ' + ld.total + ' of ' + ld.limit]);
    return '<div class="ds-vitals" style="--n:' + parts.length + '">' + parts.map(function (x) { return '<button type="button" class="ds-vit' + (x[3] ? ' hot' : '') + '" data-act="jump" data-to="' + x[0] + '" data-always="1" title="' + esc(x[4]) + '" aria-label="' + esc(x[4]) + ': go to the box"><span>' + esc(x[1]) + '</span> <b class="mono">' + esc(x[2]) + '</b></button>'; }).join('') + '</div>';
  }
  /* the figure: drawn only where it is shown (a desk's Figure box, and print), and only when its spec changed */
  function figKey(doc) { var k; try { k = JSON.stringify(doc.spec || null); } catch (e) { k = ''; } return (cur.ui.mug ? 'm' : 'f') + k; }
  function figureSvg(doc) {
    var key = figKey(doc); if (cur.ui.svgKey === key) return;
    var K = kit(), svg = '', warn = '';
    if (!K && doc.spec) { cur.ui.svg = ''; cur.ui.svgWarn = ''; return; }   /* not drawn yet: svgKey stays unset so the kit's arrival draws it */
    try { if (K && doc.spec) { var r = cur.ui.mug ? K.portrait(doc.spec) : K.render(doc.spec, { height: 420 }); svg = r && r.svg || ''; } } catch (e) { warn = 'The kit could not draw this figure: ' + e.message; }
    cur.ui.svg = svg; cur.ui.svgWarn = warn; cur.ui.svgKey = key;
  }
  /* the phone's mugshot thumbnail beside the name: an <img> of the portrait, so its SVG ids never meet the Figure box's;
     drawn once per figure, and the same <img> node is carried from one render to the next (see render) */
  function thumb(doc) {
    var key; try { key = JSON.stringify(doc.spec || null); } catch (e) { key = ''; }
    var u = cur.ui, K = kit(), same = u.thumbKey === key;
    if (same && (u.thumbDone || !K)) return u.thumb;   /* drawn (or tried) with the kit, or no kit yet and the placeholder is up */
    u.thumbKey = key; u.thumb = ''; u.thumbDone = false;
    if (K && doc.spec) {
      u.thumbDone = true;
      try { var r = K.portrait(doc.spec, { width: 240, height: 240, chart: false, plate: false, suffix: '-t', lod: 'lo' }), s = r && r.svg || ''; if (s) { if (s.indexOf('xmlns=') < 0) s = s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"'); u.thumb = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s); storeThumb(doc.id, key, u.thumb); } } catch (e) {}
    } else if (doc.spec) u.thumb = readThumb(doc.id) || SIL;   /* placeholder: the key is set but the thumbnail is not done */
    if (same && u.thumbNode && u.thumb) u.thumbNode.src = u.thumb;   /* placeholder -> the real one: the same <img>, once */
    return u.thumb;
  }
  function thumbTag(doc, pb) {
    var src = thumb(doc), u = cur.ui; if (!src) return '';
    /* the markup holds only a marker; fillMarkers puts the one cached <img> in (so the markup is the same on every render) */
    var cls = 'ds-thumb' + (isGhost(pb) ? ' ghostly' : ''), sig = u.thumbKey + '|' + cls;
    if (u.thumbSig !== sig) { u.thumbSig = sig; u.thumbVer = (u.thumbVer || 0) + 1; u.thumbNode = null; u.thumbCls = cls; }
    return '<i data-tslot="' + u.thumbVer + '"></i>';
  }
  /* the cached big nodes (the figure, the thumbnail) go where their markers are: moved, never rebuilt, while the figure is the same */
  function fillMarkers(scope) {
    var u = cur.ui, ms = scope.querySelectorAll('i[data-fslot], i[data-tslot]');
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i], n;
      if (m.hasAttribute('data-fslot')) {
        if (!u.figNode) { u.figNode = el('div', u.figCls, u.svg || '<div class="ds-dim">' + esc(u.svgWarn || (kit() ? 'No figure yet.' : 'Drawing the figure…')) + '</div>'); u.figNode.setAttribute('data-k', 'fig'); }
        n = u.figNode;
      } else {
        if (!u.thumbNode) { u.thumbNode = document.createElement('img'); u.thumbNode.className = u.thumbCls; u.thumbNode.setAttribute('data-k', 'thumb'); u.thumbNode.src = u.thumb; u.thumbNode.alt = ''; u.thumbNode.setAttribute('aria-hidden', 'true'); }
        n = u.thumbNode;
      }
      m.parentNode.replaceChild(n, m);
    }
  }
  function figure(doc, pb) {
    var cls = 'ds-art' + (cur.ui.mug ? ' mug' : '') + (isGhost(pb) ? ' ghostly' : ''), art;
    if (narrow() && !cur.ui.static) art = '<div class="' + cls + '"></div>';   /* a phone shows the thumbnail instead (tracker.css) */
    else if (cur.ui.static) { figureSvg(doc); art = '<div class="' + cls + '" data-k="fig">' + (cur.ui.svg || '<div class="ds-dim">' + esc(cur.ui.svgWarn || 'No figure yet.') + '</div>') + '</div>'; }
    else {
      /* a live desk: a marker, and the cached node (360 KB of SVG) for the figure as drawn; a new node only when the figure or its look changes */
      figureSvg(doc); var u = cur.ui, sig = figKey(doc) + '|' + cls;
      if (u.figSig !== sig) { u.figSig = sig; u.figVer = (u.figVer || 0) + 1; u.figNode = null; u.figCls = cls; }
      art = '<i data-fslot="' + u.figVer + '"></i>';
    }
    return box('Figure', art,
      '<span class="seg"><button type="button" class="chip sm" data-act="view" data-v="fig" data-always="1" aria-pressed="' + (!cur.ui.mug) + '">Figure</button><button type="button" class="chip sm" data-act="view" data-v="mug" data-always="1" aria-pressed="' + (!!cur.ui.mug) + '">Mugshot</button></span>', 'ds-figbox');
  }
  function stress(play, pb) {
    var hull = isHull(pb), n = stressMax(pb), name = stressName(pb), ghost = isGhost(pb), vamp = isVamp(pb), tt = isTT(pb);
    var h = '<div class="ds-stress">' + pipRow(n, play.stress, 'stress', '', 'ds-sbox') + '<span class="mono ds-count">' + play.stress + ' / ' + n + '</span></div>';
    var tools;
    if (hull) tools = '<button type="button" class="btn sm" data-act="stressd" data-d="-5">Recharge −5</button>';
    else if (ghost) tools = '<button type="button" class="btn sm" data-act="consume"' + (play.stress > 0 ? '' : ' disabled') + '>Consume (clear half)</button>';
    else if (vamp) tools = '<button type="button" class="btn sm" data-act="feed">Feed</button>';
    else if (tt) tools = '<button type="button" class="btn sm" data-act="restabilize"' + (play.alluvium > 0 ? '' : ' disabled') + '>Restabilize (−5, uses one ' + esc(pb.alluviumName || 'canister') + ')</button>';
    else tools = '<button type="button" class="btn sm" data-act="stressd" data-d="-1" title="Indulge your vice: clear 1 ' + esc(name) + '">Clear 1</button><button type="button" class="btn sm" data-act="stressd" data-d="-3" title="Indulge your vice: clear 3 ' + esc(name) + '">Clear 3</button>';
    /* marking is the frequent thing in play: Mark first, the vice (or its replacement) after */
    h += '<div class="row ds-tools ds-markrow"><button type="button" class="btn sm" data-act="stressd" data-d="1">Mark +1</button><button type="button" class="btn sm" data-act="stressd" data-d="2">Mark +2</button><span class="ds-gap"></span>' + tools + '</div>';
    if (tt) {
      var an = pb.alluviumName || 'canister', am = alluvMax(pb);
      h += '<div class="ds-alluv"><span class="ds-lab">Alluvium</span>' + pipRow(am, play.alluvium, 'alluvium', '', 'ds-pip ds-vial') + '<span class="mono ds-count">' + play.alluvium + ' ' + esc(an) + (play.alluvium === 1 ? '' : 's') + ' left</span></div>' +
        '<p class="hint">Click a circle to set how many ' + esc(an) + 's you hold; alluvium is rare and illegal, but more can be found.</p>';
    }
    if (hull) h += '<p class="hint">Whenever you would take Stress, take Drain. At your last Drain box you go On Program immediately and deadlock a key (or mark a robotic deadlock).</p>';
    else if (isPara(pb) && pb.need) h += '<p class="hint">' + esc(pb.need) + '</p>';
    if (vamp) h += '<div class="ds-feedrow"><div><span class="ds-lab">How do you feed?</span>' + input('feeding', play.feeding, 'Feeding') + '</div><div><span class="ds-lab">Telltale sign on your victims</span>' + input('telltale', play.telltale, 'Telltale') + '</div></div>';
    if (play.stress >= n) {
      if (hull) h += '';
      else if (ghost) h += '<p class="hint ds-warn">Fully drained: strike out a key with an echo irregularity.</p>';
      else if (tt) h += '<p class="hint ds-warn">Instability is full: strike out a key with a temporal glitch.</p>';
      else if (vamp) h += '<p class="hint ds-warn">Stress is full: trauma. Another deadlock overwhelms you — level 3 harm “Incapacitated” until you feed enough to recover.</p>';
      else h += '<p class="hint ds-warn">Stress is full: trauma' + rl('trauma') + '. Deadlock a key.</p>';
    }
    return box(esc(name) + rl('stress'), h, '', 'ds-stressbox');
  }
  function keys(play, pb) {
    var hull = isHull(pb), g = glitchy(pb), vamp = isVamp(pb), tt = isTT(pb), h = '', gname = glitchName(pb), glist = glitchList(pb);
    var used = play.keys.map(function (k) { return k.glitch; }).filter(Boolean);
    if (hull) h += '<p class="hint">You start with no keys; memories can restore them. If you have no keys when you would deadlock, mark a robotic deadlock instead.</p>';
    if (isGhost(pb)) h += '<p class="hint">You cannot turn keys. When fully drained, strike a key out with an echo irregularity instead of a deadlock.</p>';
    if (tt) h += '<p class="hint">When Instability is full, strike a key out with a temporal glitch. Each glitch adds a line to your mission details.</p>';
    if (vamp) h += '<p class="hint">Your deadlocks are maxed out: every key starts deadlocked. A further deadlock overwhelms you — level 3 harm “Incapacitated” until you feed enough to recover.</p>';
    play.keys.forEach(function (k, i) {
      var dl = k.deadlock, gl = k.glitch, struck = !!(dl || gl), side;
      if (g) {
        side = gl ? '<span class="ds-burst on" title="Permanent — hard mode">' + esc(gl) + '</span><span class="ds-perm">Permanent — hard mode</span><button type="button" class="ds-x" data-act="unglitch" data-i="' + i + '" title="Undo (GM)">undo (GM)</button>'
          : '<button type="button" class="ds-burst' + (cur.ui.glitchPick === i ? ' picking' : '') + '" data-act="glitchpick" data-i="' + i + '" title="Strike out: ' + esc(gname.toLowerCase()) + '" aria-expanded="' + (cur.ui.glitchPick === i) + '">' + BURST + '<span>✕</span></button>';
      } else {
        side = dl ? '<span class="ds-burst on" title="Permanent — hard mode">' + (dl === 'up' ? '▲ ' + esc(k.up || 'intensified') : '▼ ' + esc(k.down || 'reversed')) + '</span><span class="ds-perm">Permanent — hard mode</span><button type="button" class="ds-x" data-act="undeadlock" data-i="' + i + '" title="Undo deadlock (GM)">undo (GM)</button>'
          : '<span class="ds-burstgrp"><button type="button" class="ds-burst" data-act="deadlock" data-i="' + i + '" data-dir="down" title="Deadlock: reversed">' + BURST + '<span>▼</span></button><button type="button" class="ds-burst" data-act="deadlock" data-i="' + i + '" data-dir="up" title="Deadlock: intensified">' + BURST + '<span>▲</span></button></span>';
      }
      h += '<div class="ds-key' + (struck ? ' locked' : '') + (gl ? ' glitched' : '') + '">' +
        '<div class="ds-key-main">' + input('keys.' + i + '.name', k.name, 'Key', 'ds-key-name') +
          '<span class="ds-key-dl"><span class="ds-arrow">▼</span>' + input('keys.' + i + '.down', k.down, 'reversed', 'ds-key-word') + '<span class="ds-arrow">▲</span>' + input('keys.' + i + '.up', k.up, 'intensified', 'ds-key-word') + '</span></div>' +
        '<div class="ds-key-side">' + pipRow(3, k.hits, 'keyhit', ' data-i="' + i + '"') + (play.keyHitSession && play.keyHitSession[i] ? '<span class="ds-hitnow" title="Hit this session: no more xp from this key until the session ends">hit this session</span>' : '') + side +
          '<button type="button" class="ds-x" data-act="rmkey" data-i="' + i + '" title="Remove key">×</button>' +
        '</div>';
      if (g && !gl && cur.ui.glitchPick === i) {
        h += '<div class="ds-glpick"><span class="ds-lab">' + esc(gname) + ' for ' + esc(k.name || 'this key') + ' — permanent</span><div class="row">' +
          glist.map(function (n) { return '<button type="button" class="chip sm" data-act="glitch" data-i="' + i + '" data-v="' + esc(n) + '"' + (used.indexOf(n) >= 0 ? ' disabled title="Already taken"' : '') + '>' + esc(n) + '</button>'; }).join('') +
          '<button type="button" class="chip sm none" data-act="glitchcancel">Cancel</button></div></div>';
      }
      h += '</div>';
    });
    if (play.keys.length < 4) {
      var opts = '<option value="">Add a key…</option>'; ((pb && pb.keys) || []).forEach(function (k) { if (!play.keys.some(function (x) { return x.name === keyParts(k).name; })) opts += '<option value="' + esc(k) + '">' + esc(k) + '</option>'; });
      opts += '<option value="*">Write your own</option>';
      h += '<div class="row ds-addrow"><select class="ds-sel" data-change="addkey">' + opts + '</select></div>';
    }
    if (hull) {
      h += '<div class="ds-lab" style="margin-top:8px">Robotic deadlocks</div><div class="row">';
      (pb.roboticDeadlocks || []).forEach(function (r) { h += '<button type="button" class="chip sm" data-act="robo" data-v="' + esc(r) + '" aria-pressed="' + (play.roboticDeadlocks.indexOf(r) >= 0) + '">' + esc(r) + '</button>'; });
      h += '</div>';
    }
    if (tt) {
      var gc = glitchCount(play);
      h += '<div class="ds-glcount' + (gc >= 4 ? ' full' : '') + '"><b>Temporal glitches: ' + gc + ' / 4</b>' + (gc >= 4 ? '<div class="ds-gone">You disappear from this time period after the next score.</div>' : '<span class="ds-dim">at four, you disappear after the next score</span>') + '</div>';
    }
    return box('Keys', h, '<span class="ds-dlhead">' + (tt ? 'Temporal glitches' : isGhost(pb) ? 'Echo irregularities' : 'Deadlocks') + '</span>', 'ds-keybox');
  }
  function harm(play, pb) {
    var hull = isHull(pb), hm = play.harm, pbr = pb && pb.resource && !hull ? pb.resource : null, blank = !!(pb && pb.resource === null && !hull);
    var h = '<div class="ds-harm">' +
      '<div class="ds-hrow"><span class="ds-hl">4. ' + (hull ? 'Destroyed' : 'Mortal') + '</span>' + input('harm.l4', hm.l4, '', 'ds-hin') + '</div>' +
      '<div class="ds-hrow"><span class="ds-hl">3. Critical</span>' + input('harm.l3', hm.l3, '', 'ds-hin') + '</div>' +
      '<div class="ds-hrow two"><span class="ds-hl">2. Major</span>' + input('harm.l2.0', hm.l2[0], '', 'ds-hin') + '<span class="ds-hl">2. Major</span>' + input('harm.l2.1', hm.l2[1], '', 'ds-hin') + '</div>' +
      '<div class="ds-hrow two"><span class="ds-hl">1. Passing</span>' + input('harm.l1.0', hm.l1[0], '', 'ds-hin') + '<span class="ds-hl">1. Passing</span>' + input('harm.l1.1', hm.l1[1], '', 'ds-hin') + '</div>' +
    '</div>';
    var side = '<div class="ds-side"><div class="ds-heal"><span class="ds-lab">' + (hull ? 'Repair' : 'Healing') + '</span>' + clockSvg(4, play.healing, 22, 'heal') + (isVamp(pb) ? '<span class="ds-dim">feeding only</span>' : '') + '</div>' +
      '<div class="ds-res"><span class="ds-lab">Resources</span>' +
        '<div class="ds-resrow"><span>Armor' + rl('armor') + '</span><span class="ds-boxes">' + sq(play.armor.armor, 'armor', ' data-k="armor"') + '</span></div>' +
        '<div class="ds-resrow"><span>Heavy</span><span class="ds-boxes">' + sq(play.armor.heavy, 'armor', ' data-k="heavy"') + '</span></div>' +
        (pbr ? '<div class="ds-resrow"><span>' + esc(pbr.charAt(0).toUpperCase() + pbr.slice(1)) + '</span><span class="ds-boxes">' + sq(play.resource[0], 'resource', ' data-k="0"') + sq(play.resource[1], 'resource', ' data-k="1"') + '</span></div>' : '') +
        (blank ? '<div class="ds-resrow"><span class="ds-blankres" aria-label="unlabelled resource"></span><span class="ds-boxes">' + sq(play.resource[0], 'resource', ' data-k="0"') + sq(play.resource[1], 'resource', ' data-k="1"') + '</span></div>' : '') +
        (hull ? '<div class="ds-dim">Built-in frame armor; it never counts for load.</div>' : '') +
      '</div></div>';
    return box((hull ? 'Damage' : 'Harm') + rl('harm'), '<div class="ds-harmgrid">' + h + side + '</div>', '', 'ds-harmbox');
  }
  function cohort(play, pb) {
    if (!pb || !pb.cohort) return '';
    var c = play.cohort, h = '<div class="ds-cohort">' +
      '<div class="ds-corow"><div><span class="ds-lab">Name</span>' + input('cohort.name', c.name, 'Name') + '</div><div><span class="ds-lab">Type</span>' + input('cohort.type', c.type, (pb.cohort.types || []).slice(0, 3).join(', ')) + '</div></div>' +
      '<div class="ds-corow"><div><span class="ds-lab">Edges</span>' + input('cohort.edges', c.edges, 'e.g. Fearless, Loyal') + '</div><div><span class="ds-lab">Flaws</span>' + input('cohort.flaws', c.flaws, 'e.g. Wild, Savage') + '</div></div>' +
      '<div><span class="ds-lab">Abilities</span>' + input('cohort.abilities', c.abilities, cohortExpert(pb)) + '</div>' +
      '<div class="row ds-cohs">' + ['weak', 'impaired', 'broken'].map(function (s) { return '<button type="button" class="ds-coh' + (c.harm === s ? ' on' : '') + '" data-act="coharm" data-v="' + s + '"><span class="ds-cohpip"></span>' + s.charAt(0).toUpperCase() + s.slice(1) + '</button>'; }).join('') +
        '<button type="button" class="ds-coh' + (c.armor ? ' on' : '') + '" data-act="coarmor"><span class="ds-cohsq"></span>Armor</button></div>' +
    '</div>';
    return box(esc(pb.cohort.label), h, '<span class="ds-dim">Cohort (' + esc(cohortExpert(pb) || 'Expert') + ')</span>');
  }
  function abilities(play, pb, sheet) {
    var hull = isHull(pb), vamp = isVamp(pb), tt = isTT(pb), list = [], h = '', versText = 'Choose a special ability from another source.';
    if (pb) {
      if (hull) list.push({ n: AUTOMATON[0], t: AUTOMATON[1], fixed: true });
      if (pb.fixedAbility) list.push({ n: pb.fixedAbility[0], t: pb.fixedAbility[1], fixed: true });
      pb.abilities.forEach(function (a) { if (a[0] === 'Versatile') { versText = a[1] || versText; return; } list.push({ n: a[0], t: a[1] }); });
    }
    var names = list.map(function (a) { return a.n; });
    list.forEach(function (a) {
      var max = abilityMax(pb, a.n), owned = play.abilities.indexOf(a.n) >= 0, ticks = owned ? Math.max(1, play.abilityTicks[a.n] || 1) : 0;
      var circles = '';
      for (var i = 1; i <= max; i++) circles += '<button type="button" class="ds-circ' + (i <= ticks ? ' on' : '') + (a.fixed ? ' fixed' : '') + '" data-act="ability" data-n="' + esc(a.n) + '" data-i="' + i + '"' + (a.fixed ? ' disabled' : '') + ' aria-label="' + esc(a.n) + ' ' + i + '"></button>';
      var extra = a.n === 'Dark Majesty' && owned && play.darkMajesty ? ' <span class="ds-dm">' + esc(play.darkMajesty) + ' actions may reach 5</span>' : '';
      h += '<div class="ds-ab' + (owned ? ' on' : '') + '"><span class="ds-circs">' + circles + '</span><div><b>' + esc(a.n) + ':</b> ' + esc(a.t) + extra + '</div></div>';
    });
    var customs = play.abilities.filter(function (n) { return names.indexOf(n) < 0 && n !== 'Versatile'; });
    var vOn = customs.length > 0 || play.abilities.indexOf('Versatile') >= 0;
    var vc = ''; for (var i = 1; i <= 3; i++) vc += '<span class="ds-circ' + (i <= customs.length ? ' on' : '') + ' fixed"></span>';
    h += '<div class="ds-ab' + (vOn ? ' on' : '') + '"><span class="ds-circs">' + vc + '</span><div><b>Versatile:</b> ' + esc(versText) + (tt ? ' <span class="ds-dim">Each time you gain clarity, add one from another playbook, reflecting your former life.</span>' : '') +
      customs.map(function (n) { return '<div class="ds-custom">' + esc(n) + ' <button type="button" class="ds-x" data-act="rmability" data-n="' + esc(n) + '" title="Remove">×</button></div>'; }).join('') +
      '<div class="row ds-addrow">' + input('', '', 'Name and rule text from another playbook', 'ds-grow ds-newab') + '<button type="button" class="btn sm" data-act="addability">Add</button></div></div></div>';
    if (hull) {
      h += '<div class="ds-lab ds-sub">Frame features</div><div class="ds-frame">';
      (pb.frame || []).forEach(function (f) { var on = play.frame.indexOf(f[0]) >= 0; h += '<button type="button" class="ds-feat' + (on ? ' on' : '') + '" data-act="frame" data-n="' + esc(f[0]) + '" aria-pressed="' + on + '"><span class="ds-sq' + (on ? ' on' : '') + '"></span><span><b>' + esc(f[0]) + '</b> <span class="ds-dim">' + esc(f[1]) + '</span></span></button>'; });
      h += '</div>';
    }
    if (vamp) h += '<div class="ds-lab ds-sub">Echo special abilities</div>' + (pb.echoAbilitiesRule ? '<p class="hint">' + esc(pb.echoAbilitiesRule) + '</p>' : '') + textarea('echoAbilities', play.echoAbilities, 'Anything carried over from your time as a ghost', 'sm');
    return box(hull ? 'Hull traits' : isPara(pb) ? 'Traits' : 'Special abilities', h, '<span class="ds-xpmini">xp ' + pipRow(8, play.xp.playbook, 'xp', ' data-k="playbook"', 'ds-xbox') + '</span>', 'ds-abbox');
  }
  /* the xp holding bar: earned xp waits here, a mark per xp, until a track box spends it */
  function holdBar(play) {
    var n = play.xpHold || 0, m = '';
    for (var i = 0; i < Math.min(n, 12); i++) m += '<span class="ds-hmark"></span>';
    return '<div class="row ds-hold"><span class="ds-lab">Unspent xp</span><span class="ds-hmarks" aria-hidden="true">' + m + (n > 12 ? '<span class="ds-hmore">+' + (n - 12) + '</span>' : '') + '</span><span class="mono ds-count">' + n + ' to spend</span>' +
      '<button type="button" class="btn sm" data-act="xphold" data-v="-1" aria-label="Take 1 xp off the bar"' + (n > 0 ? '' : ' disabled') + '>−</button><button type="button" class="btn sm" data-act="xphold" data-v="1" aria-label="Add 1 xp to the bar">+ Add xp</button></div>' +
      '<p class="hint">' + (n ? 'Earned xp lands here. Tap a box on any track to spend it.' : 'Nothing to spend. Xp you earn in play lands here, or add it by hand.') + '</p>';
  }
  function triggers(play, pb) {
    var hull = isHull(pb), tt = isTT(pb);
    var h = holdBar(play) + '<ul class="ds-trig">' +
      '<li>Every time you roll a <b>desperate action</b> or a <b>zero-dot action</b>, earn xp (2 if both).</li>' +
      '<li>Once per session when you <b>hit a key</b>, earn 1 xp and mark the key.</li>' +
      '<li class="ds-trig-h">At the end of each session, mark 1 xp (or 2 xp if you really smashed it) if:</li>';
    sessionTriggers(play, pb).forEach(function (t) { h += '<li>' + (isPara(pb) ? esc(t) : esc(t).replace(/a deadlock\.$/, 'a <b>deadlock</b>.')) + '</li>'; });
    h += '</ul>';
    if (hull) h += '<p class="hint">Whenever you would mark playbook xp, you can tick a memory clock instead. When all four memories are complete, the first trigger becomes: you worked to free yourself from your owning faction and controller, or addressed a challenge with your humanity.</p>';
    if (tt && pb.advance) h += '<p class="hint">' + esc(pb.advance) + '</p>';
    var full = play.xp.playbook >= 8;
    h += '<div class="row ds-tools"><span class="ds-lab">Playbook xp</span>' + pipRow(8, play.xp.playbook, 'xp', ' data-k="playbook"', 'ds-xbox') + '<span class="mono ds-count">' + play.xp.playbook + ' / 8</span></div>';
    if (full) h += tt ? '<div class="ds-advance"><button type="button" class="btn sm primary" data-act="clarity">Gain clarity</button><span class="hint ds-warn">Playbook track full: a new trait, a versatile ability, a temporal glitch and a mission detail.</span></div>'
      : '<p class="hint ds-warn">Playbook track full: pick a new special ability above (8 xp are spent when you do).</p>';
    return box('XP' + rl('xp'), h, '', 'ds-xpbox');
  }
  /* ---------- the Session box and the end-of-session panel (round 5) ---------- */
  /* the table's session (api.table, CONTRACT.md): { session, inPlay } or null when there is no table */
  function tableNow() {
    var a = cur && cur.api; if (!a || typeof a.table !== 'function') return null;
    try { var t = a.table(); return t && typeof t === 'object' ? { session: Math.max(0, Math.floor(+t.session || 0)), inPlay: !!t.inPlay } : null; } catch (e) { return null; }
  }
  function tableLine(t) { return !t.session ? 'Table: no session started yet' : 'Table: session ' + t.session + (t.inPlay ? ' · in play' : ' · ended'); }
  /* the session End of session closes: the table's when there is one */
  function endNo(play) { var t = tableNow(); return t ? t.session : play.session || 0; }
  /* what comes after downtime: the manual start, or joining the table's next session */
  function nextStart(play) { return tableNow() ? 'join the next session when the GM starts it' : 'Start session ' + ((play.session || 0) + 1); }
  /* under the header while a table exists: where the table is, and Join when it is ahead of this sheet */
  function tableBar(play) {
    var t = tableNow(); if (!t || !t.session) return '';
    var n = play.session || 0, ahead = t.session > n;
    return '<div class="ds-tablebar' + (ahead ? ' ahead' : '') + '"><span class="ds-tbline"><b>' + esc(tableLine(t)) + '</b>' + (ahead ? '<span class="ds-dim">' + (n ? 'This sheet is on session ' + n + '.' : 'This sheet has not joined a session yet.') + '</span>' : '') + '</span>' +
      (ahead ? '<button type="button" class="btn sm primary" data-act="sessjoin">Join session ' + t.session + '</button>' : '') + '</div>';
  }
  function session(play, pb) {
    var n = play.session || 0, e = cur.ui.endSess, hits = Object.keys(play.keyHitSession || {}).length, t = tableNow(), en = endNo(play);
    var note = t ? tableLine(t) + '.' + (t.session > n ? ' Join it from the top of the sheet.' : '') + (!t.session ? ' The GM starts sessions on the table page.' : '') : n ? 'Session ' + n + ' is the current session.' : 'No session started yet.';
    var h = '<div class="ds-sess"><span class="ds-sessno"><span class="ds-lab">Session</span><b class="mono">' + n + '</b></span>' +
      '<span class="ds-dim ds-sessnote">' + esc(note) + (hits ? ' Keys hit this session: ' + hits + '.' : '') + (play.trainedThisDowntime ? ' Trained this downtime.' : '') + '</span>' +
      '<span class="ds-sessbtns">' + (t ? '' : '<button type="button" class="btn sm" data-act="sessstart">Start session ' + (n + 1) + '</button>') +
      '<button type="button" class="btn sm primary" data-act="endopen" aria-expanded="' + !!e + '"' + (t && !en ? ' disabled title="No session has started at the table"' : '') + '>End session' + (t && en ? ' ' + en : '') + '</button></span></div>';
    return box('Session', h, '', 'ds-sessbox', endPanel(play, pb));
  }
  /* what "Mark xp" would do: the whole total goes on the bar, nothing lost */
  function endPlan(play, pb, e) {
    var total = e.vals.reduce(function (t, v) { return t + v; }, 0), hold = play.xpHold || 0;
    return { total: total, hold: hold, after: Math.min(99, hold + total) };
  }
  function advancePointer(pb) { return isTT(pb) ? 'Gain clarity in the XP box.' : 'pick a new ' + (isHull(pb) ? 'trait in the Hull traits box' : isPara(pb) ? 'trait in the Traits box' : 'special ability in the Special abilities box') + ' (8 xp are spent when you do).'; }
  function endPanel(play, pb) {
    var e = cur.ui.endSess; if (!e) return '';
    var trig = sessionTriggers(play, pb), n = endNo(play), done = !!e.result, plan = endPlan(play, pb, e), hits = Object.keys(play.keyHitSession || {}).length;
    var h = '<p class="hint">Mark 1 xp for each trigger that happened this session, 2 if you really smashed it.</p><div class="ds-endtrig">';
    trig.forEach(function (t, i) {
      h += '<div class="ds-endrow"><span>' + esc(t) + '</span><span class="seg">' + [0, 1, 2].map(function (v) { return '<button type="button" class="chip sm" data-act="endval" data-i="' + i + '" data-v="' + v + '" aria-pressed="' + (e.vals[i] === v) + '"' + (done ? ' disabled' : '') + ' aria-label="' + esc(trigLabel(t)) + ': ' + v + ' xp">' + v + '</button>'; }).join('') + '</span></div>';
    });
    h += '</div>';
    var where = !plan.total ? 'nothing to mark' : 'on the bar: ' + plan.hold + ' → ' + plan.after + ' to spend';
    if (!done) {
      h += '<div class="ds-roll-go"><span class="ds-roll-n"><b class="ds-roll-big mono">+' + plan.total + ' xp</b><span class="ds-dim">' + esc(where) + '</span></span>' +
        '<button type="button" class="btn sm primary" data-act="endmark">' + (plan.total ? 'Mark xp' : 'End without xp') + '</button></div>';
      h += '<p class="hint">Ends session ' + n + (n !== (play.session || 0) ? ', the table’s (this sheet is on ' + (play.session || 0) + ')' : '') + ': logs it' + (hits ? ' and clears this session’s key hits (' + hits + ' key' + (hits === 1 ? '' : 's') + ')' : '') + '. Key hits and desperate or zero-dot rolls went on the bar as they happened.</p>';
    } else {
      h += '<div class="ds-roll-res"><div class="ds-roll-applied"><span class="ds-lab">Applied</span>' + esc(e.result.lines.join(' · ')) + '</div>';
      h += '<p class="hint">Spend it on any track in the XP box.</p>';
      h += '<p class="hint">Downtime next: use the Downtime box, then ' + esc(nextStart(play)) + '.</p></div>';
    }
    return '<div class="ds-roll ds-endp" tabindex="-1" role="region" aria-label="End of session"><div class="ds-roll-h"><span class="ds-roll-t">End of session · <b>' + n + '</b></span><span class="ds-roll-sub">' + trig.length + ' triggers · 0, 1 or 2 xp each</span><button type="button" class="ds-x ds-roll-x" data-act="panelclose" data-always="1" aria-label="Close the end of session panel" title="Close (Esc)">×</button></div><div class="ds-roll-body">' + h + '</div>' + panelFoot() + '</div>';
  }

  /* ---------- the Downtime box (round 5): one activity panel at a time, in the roll panel's style ---------- */
  var DT_NAMES = { indulge: 'Indulge vice', recover: 'Recover', project: 'Long-term project', train: 'Train' };
  var DT_HELP = { indulge: 'indulge vice', recover: 'recover', project: 'long-term project', train: 'train' };
  function dtName(kind, pb) { return kind === 'recover' && isHull(pb) ? 'Repair' : DT_NAMES[kind] || kind; }
  function coreVice(pb) { return !!pb && !isHull(pb) && !isPara(pb); }
  function downtime(play, pb) {
    var t = cur.ui.dt, vamp = isVamp(pb), hull = isHull(pb);
    function b(kind) { var open = !!(t && t.kind === kind); return '<button type="button" class="btn sm ds-dtbtn" data-act="dtopen" data-k="' + kind + '" data-always="1" aria-expanded="' + open + '">' + esc(dtName(kind, pb)) + '</button>' + rl(DT_HELP[kind]); }
    var h = '<div class="row ds-dtbtns">' + (coreVice(pb) ? b('indulge') : '') + (vamp ? '' : b('recover')) + b('project') + b('train') + '</div>';
    if (hull) h += '<p class="hint">No vice: <b>Recharge −5</b> in the Drain box clears Drain.</p>';
    else if (isGhost(pb)) h += '<p class="hint">No vice: <b>Consume</b> in the Drain box clears half your Drain.</p>';
    else if (vamp) h += '<p class="hint">Feeding is your vice and your only healing: <b>Feed</b> in the Stress box clears Stress by the highest die and marks 4 healing. You cannot Recover by being treated.</p>';
    else if (isTT(pb)) h += '<p class="hint">No vice: <b>Restabilize</b> in the Instability box clears 5 and uses one ' + esc(pb.alluviumName || 'canister') + '.</p>';
    h += '<p class="hint">Two activities per downtime is the usual pace. Each one rolls, marks the sheet and logs the roll. <span class="ds-dim">Personal business</span>' + rl('personal business') + '</p>';
    return box('Downtime', h, play.trainedThisDowntime ? '<span class="ds-dim">trained this downtime</span>' : '', 'ds-dtbox', dtPanel(play, pb));
  }
  function actionChips(play, sel) {
    return '<div class="ds-actchips">' + (CT.ACTIONS || []).map(function (g) { return '<span class="seg">' + g[1].map(function (a) { return '<button type="button" class="chip sm" data-act="dtopt" data-k="action" data-v="' + esc(a) + '" data-always="1" aria-pressed="' + (sel === a) + '">' + esc(a) + ' ' + (play.dots[a] || 0) + '</button>'; }).join('') + '</span>'; }).join('') + '</div>';
  }
  function diceGo(n, note, label, again) { return '<div class="ds-roll-go"><span class="ds-roll-n"><b class="ds-roll-big mono">' + n + 'd</b><span class="ds-dim">' + note + (n === 0 ? ' · roll 2d, take the lowest' : '') + '</span></span><button type="button" class="btn sm primary" data-act="dtroll" data-always="1">' + (again ? 'Roll again' : label || 'Roll') + '</button></div>'; }
  function dtDice(play, pb, t) {
    if (t.kind === 'indulge') return lowestAttr(play).n;
    if (t.kind === 'recover' && t.who === 'healer') return t.n;
    return play.dots[t.action] || 0;
  }
  function dtPanel(play, pb) {
    var t = cur.ui.dt; if (!t) return '';
    var sn = stressName(pb), h = '', sub = '', ro = noSave();
    if (t.kind === 'indulge') {
      var lo = lowestAttr(play);
      sub = 'lowest attribute · ' + esc(lo.attr) + ' ' + lo.n;
      h += '<p class="hint">Roll your lowest attribute rating and clear ' + esc(sn) + ' equal to the highest die. Clearing more than you have is overindulging.' + (play.vice ? ' Vice: <b>' + esc(play.vice) + '</b>' + (play.purveyor ? ' · ' + esc(play.purveyor) : '') + '.' : '') + '</p>';
      h += diceGo(lo.n, esc(lo.attr) + ' rating · ' + esc(sn) + ' ' + play.stress + ' / ' + stressMax(pb), 'Roll', !!t.result);
    } else if (t.kind === 'recover') {
      var cn = isHull(pb) ? 'Repair' : 'Healing';
      sub = cn.toLowerCase() + ' clock ' + play.healing + ' / 4';
      h += '<div class="ds-roll-row"><span class="ds-lab">Treated by</span><span class="seg"><button type="button" class="chip sm" data-act="dtopt" data-k="who" data-v="self" data-always="1" aria-pressed="' + (t.who === 'self') + '">Yourself</button><button type="button" class="chip sm" data-act="dtopt" data-k="who" data-v="healer" data-always="1" aria-pressed="' + (t.who === 'healer') + '">' + (isHull(pb) ? 'A mechanic' : 'A healer') + '</button></span></div>';
      if (t.who === 'self') h += '<div class="ds-roll-row ds-actrow"><span class="ds-lab">Action</span>' + actionChips(play, t.action) + '</div>';
      else h += '<div class="ds-roll-row"><span class="ds-lab">Dice</span><span class="seg">' + [0, 1, 2, 3, 4].map(function (i) { return '<button type="button" class="chip sm" data-act="dtopt" data-k="n" data-v="' + i + '" data-always="1" aria-pressed="' + (t.n === i) + '">' + i + 'd</button>'; }).join('') + '</span><span class="ds-dim">their quality or rating</span></div>';
      h += '<div class="ds-dtclock">' + clockSvg(4, play.healing, 18, 'none') + '<p class="hint">Ticks: 1–3 one, 4–5 two, 6 three, critical five. A full clock steps every harm down a level (3 → 2, 2 → 1, 1 cleared) and extra ticks carry over.' + (harmCount(play.harm) ? '' : ' You have no harm to heal right now.') + '</p></div>';
      h += diceGo(dtDice(play, pb, t), t.who === 'self' ? esc(t.action) + ' rating' : 'the healer’s dice', 'Roll', !!t.result);
    } else if (t.kind === 'project') {
      sub = play.clocks.length + ' clock' + (play.clocks.length === 1 ? '' : 's');
      h += '<div class="ds-roll-row"><span class="ds-lab">Clock</span><span class="ds-actchips">' + play.clocks.map(function (c, i) { var full = c.filled >= c.size; return '<button type="button" class="chip sm txt" data-act="dtopt" data-k="clock" data-v="' + i + '" data-always="1" aria-pressed="' + (String(t.clock) === String(i)) + '"' + (full ? ' disabled title="Complete"' : '') + '>' + esc(c.name || 'Clock ' + (i + 1)) + ' · ' + c.filled + '/' + c.size + '</button>'; }).join('') +
        '<button type="button" class="chip sm none" data-act="dtopt" data-k="clock" data-v="new" data-always="1" aria-pressed="' + (t.clock === 'new') + '">New clock</button></span></div>';
      if (t.clock === 'new') h += '<div class="ds-roll-row"><span class="ds-lab">New</span><input type="text" class="ds-in ds-grow ds-newproj" data-ui="dtname" data-always="1" value="' + esc(t.newName || '') + '" placeholder="What is the project?"><span class="seg">' + [4, 6, 8].map(function (n) { return '<button type="button" class="chip sm" data-act="dtopt" data-k="size" data-v="' + n + '" data-always="1" aria-pressed="' + (t.size === n) + '">' + n + '</button>'; }).join('') + '</span></div>';
      h += '<div class="ds-roll-row ds-actrow"><span class="ds-lab">Action</span>' + actionChips(play, t.action) + '</div>';
      h += '<p class="hint">Ticks: 1–3 one, 4–5 two, 6 three, critical five.</p>';
      h += diceGo(dtDice(play, pb, t), esc(t.action) + ' rating', 'Roll', !!t.result);
    } else {
      sub = 'once per downtime';
      h += '<p class="hint">Mark 1 xp on the bar, to spend on any track. Once per downtime; ' + (tableNow() ? 'joining the next session' : 'Start session') + ' clears it.</p>';
      var blocked = play.trainedThisDowntime && !(t.result && t.result.saved);
      if (!t.result) h += '<div class="ds-roll-go"><span class="ds-roll-n"><b class="ds-roll-big mono">+1 xp</b><span class="ds-dim">on the bar: ' + (play.xpHold || 0) + ' → ' + Math.min(99, (play.xpHold || 0) + 1) + ' to spend</span></span><button type="button" class="btn sm primary" data-act="dttrain"' + (blocked || ro ? ' disabled' : '') + '>Mark 1 xp</button></div>';
      if (blocked) h += '<p class="hint ds-warn ds-trained">Already trained this downtime: ' + esc(capWord(nextStart(play))) + ' clears it.</p>';
      if (ro && !t.result) h += '<p class="hint">Not saved (' + notSavedWhy() + '): training writes nothing here.</p>';
    }
    if (t.result && t.kind !== 'train') h += dtResult(t, pb);
    else if (t.result) h += '<div class="ds-roll-res"><div class="ds-roll-applied"><span class="ds-lab">Applied</span>' + esc(t.result.applied.join(' · ')) + '</div></div>';
    return '<div class="ds-roll ds-dt" tabindex="-1" role="region" aria-label="Downtime"><div class="ds-roll-h"><span class="ds-roll-t">Downtime · <b>' + esc(dtName(t.kind, pb)) + '</b></span><span class="ds-roll-sub">' + sub + '</span><button type="button" class="ds-x ds-roll-x" data-act="panelclose" data-always="1" aria-label="Close the downtime panel" title="Close (Esc)">×</button></div><div class="ds-roll-body">' + h + '</div>' + panelFoot() + '</div>';
  }
  function dtResult(t, pb) {
    var res = t.result, h = '<div class="ds-roll-res">' + diceSvgs(res);
    h += '<div class="ds-roll-read"><span class="ds-roll-word ' + (res.cls || res.reading) + '">' + esc(res.big) + '</span><span class="ds-roll-why">' + esc(res.why) + '</span></div>';
    if (res.over) h += '<p class="ds-over">Overindulge: tell the GM.</p>';
    if (res.low) h += '<p class="hint">Zero dice: the lowest of two is read, so no critical is possible.</p>';
    h += '<div class="ds-roll-applied"><span class="ds-lab">' + (res.saved ? 'Applied' : 'Not saved (' + esc(res.savedWhy || '') + ')') + '</span>' + esc(res.applied.join(' · ')) + '</div>';
    return h + '</div>';
  }
  function actions(play, pb) {
    var vamp = isVamp(pb), tt = isTT(pb), h = '<div class="ds-attrs">', roll = cur.ui.roll, mark = cur.ui.mark;
    (CT.ACTIONS || []).forEach(function (g) {
      var attr = g[0], key = attr.toLowerCase(), rating = g[1].filter(function (a) { return (play.dots[a] || 0) > 0; }).length, xp = play.xp[key] || 0;
      var majesty = vamp && play.darkMajesty === attr, resisting = (roll && roll.kind === 'resist' && roll.attr === attr) || (mark && !mark.action && mark.resist && mark.resist.attr === attr);
      h += '<div class="ds-attr"><div class="ds-attr-h"><span class="ds-attr-n">' + esc(attr) + '</span><span class="ds-rating mono">' + rating + '</span>' + (majesty ? '<span class="ds-dm">Dark Majesty</span>' : '') +
        '<button type="button" class="chip sm ds-resist" data-act="resistopen" data-attr="' + esc(attr) + '" data-always="1" aria-expanded="' + !!resisting + '" title="Resistance roll: ' + resistDice(play, pb, attr) + 'd">Resist</button>' +
        '<span class="ds-xpmini">xp ' + pipRow(6, xp, 'xp', ' data-k="' + key + '"', 'ds-xbox') + '</span></div>';
      if (xp >= 6) {
        if (cur.ui.advance === key) h += '<div class="ds-advance"><span class="ds-lab">Add a dot to</span>' + g[1].map(function (a) { var v = play.dots[a] || 0, max = dotMax(play, pb, a); return '<button type="button" class="chip sm" data-act="advdot" data-k="' + key + '" data-a="' + esc(a) + '"' + (v >= max ? ' disabled' : '') + '>' + esc(a) + ' ' + v + '→' + (v + 1) + '</button>'; }).join('') + '<button type="button" class="chip sm none" data-act="advcancel">Later</button></div>';
        else h += '<div class="ds-advance"><button type="button" class="btn sm primary" data-act="advance" data-k="' + key + '">Advance: +1 dot</button></div>';
      }
      g[1].forEach(function (a) {
        var v = play.dots[a] || 0, pr = pb && pb.printed ? (pb.printed[a] || 0) : 0, pips = '', max = dotMax(play, pb, a), shown = vamp ? 5 : 4;
        for (var i = 1; i <= shown; i++) pips += '<button type="button" class="ds-pip' + (i <= v ? ' on' : '') + (i <= pr ? ' printed' : '') + (i === 4 ? ' mastery' : '') + (i === 5 ? ' majesty' : '') + '" data-act="dot" data-a="' + esc(a) + '" data-n="' + i + '"' + (i > max ? ' disabled' : '') + ' aria-label="' + esc(a) + ' ' + i + '"></button>';
        var open = (roll && roll.kind === 'action' && roll.action === a) || (mark && mark.action === a);
        h += '<div class="ds-act"><span class="ds-pips">' + pips + '</span><button type="button" class="ds-act-n ds-actbtn' + (open ? ' open' : '') + '" data-act="rollopen" data-a="' + esc(a) + '" data-always="1" aria-expanded="' + !!open + '" title="' + esc(a) + ': ' + v + 'd, mark the roll">' + esc(a) + '</button></div>';
      });
      h += '</div>';
    });
    h += '</div>';
    if (tt) h += '<p class="hint">In play your actions may reach 4 (the limit of 3 was for creation only).</p>';
    else h += '<div class="row ds-tools"><label class="ds-check"><input type="checkbox" data-change="mastery"' + (play.mastery ? ' checked' : '') + '> Mastery (crew upgrade: ratings up to 4)</label>' + (vamp ? '<span class="ds-dim">Dark Majesty: one attribute up to 5.</span>' : '') + '</div>';
    h += '<p class="hint ds-rollhint">Tap an action for its dice and to mark the roll; Resist works out the ' + esc(stressName(pb)) + ' of a resistance; Fortune rolls any number of dice in the app.</p>';
    return box('Actions', h, '<span class="ds-dim">attribute = actions rated 1+</span><button type="button" class="chip sm ds-fortune" data-act="fortopen" data-always="1" aria-expanded="' + !!(roll && roll.kind === 'fortune') + '">Fortune</button>', 'ds-actbox', markPanel(play, pb) + rollPanel(play, pb));
  }
  /* ---------- the mark strip: everyone rolls physical dice, so tapping an action shows the dice count (dots, plus Push /
     Assist / Bargain, a die each) and one row to mark what happened: Resist (the helper below), the harm line to write on,
     +1 stress. Push marks its 2 stress here as it is tapped (and gives it back when untapped), as the in-app roll does when it
     rolls; an assist is paid by the crewmate who helps, on their own sheet; a Devil's Bargain costs no stress. The in-app roll
     stays behind "Roll in the app". One panel at a time, like the others. ---------- */
  function noSave() { return readOnly() || !cur.api || typeof cur.api.save !== 'function'; }
  function notSavedWhy() { return readOnly() ? 'read only' : 'this view cannot save'; }
  function markDice(play, m) { return (play.dots[m.action] || 0) + (m.push ? 1 : 0) + (m.assist ? 1 : 0) + (m.bargain ? 1 : 0); }
  /* ---------- the abilities strip (MU2): in the mark and roll panels, folded, the sheet's own abilities and the crew's with one
     line each; a tap opens the text. Display only: nothing here decides what applies. The crew's come from api.crewAbilities()
     (boot reads them from the campaign document every player already receives): null = not known yet, [] = none taken. ---------- */
  function ownAbilities(play, pb) {
    var text = {};
    if (pb) {
      if (isHull(pb)) text[AUTOMATON[0]] = AUTOMATON[1];
      if (pb.fixedAbility) text[pb.fixedAbility[0]] = pb.fixedAbility[1];
      (pb.abilities || []).forEach(function (a) { text[a[0]] = a[1] || ''; });
    }
    return (play.abilities || []).map(function (n) { return { n: n, t: text[n] || '' }; });
  }
  function crewAbilitiesNow() {
    var a = cur && cur.api; if (!a || typeof a.crewAbilities !== 'function') return null;
    try { var l = a.crewAbilities(); return Array.isArray(l) ? l.map(function (x) { return { n: String(x && x.name || ''), t: String(x && x.text || '') }; }).filter(function (x) { return x.n; }) : null; } catch (e) { return null; }
  }
  function abGroup(key, label, list) {
    var h = '<div class="ds-abgrp"><div class="ds-lab">' + label + '</div>';
    if (!list.length) return h + '<p class="ds-dim ds-abnone">None taken yet.</p></div>';
    list.forEach(function (a) {
      var k = key + ':' + a.n, on = !!(cur.ui.abOpen && cur.ui.abOpen[k]);
      h += '<button type="button" class="ds-abi' + (on ? ' open' : '') + '" data-act="abitem" data-k="' + esc(k) + '" data-always="1" aria-expanded="' + on + '"><b class="ds-abi-n">' + esc(a.n) + '</b>' + (a.t ? '<span class="ds-abi-t">' + esc(a.t) + '</span>' : '') + '</button>';
    });
    return h + '</div>';
  }
  function abStrip(play, pb) {
    var mine = ownAbilities(play, pb), crew = crewAbilitiesNow(), open = !!cur.ui.abStrip;
    var sum = 'Abilities · yours ' + mine.length + (crew ? ' · the crew’s ' + crew.length : '');
    var h = '<div class="ds-abstrip' + (open ? ' open' : '') + '"><button type="button" class="ds-abstrip-t" data-act="abstrip" data-always="1" aria-expanded="' + open + '"><span>' + esc(sum) + '</span><span class="ds-abstrip-c" aria-hidden="true">' + (open ? '−' : '+') + '</span></button>';
    if (open) h += '<div class="ds-abstrip-b">' + abGroup('p', 'Yours', mine) + (crew ? abGroup('c', 'The crew’s', crew) : '<p class="ds-dim ds-abnone">The crew’s abilities are not available here.</p>') + '</div>';
    return h + '</div>';
  }
  function markPanel(play, pb) {
    var m = cur.ui.mark; if (!m) return '';
    var sn = stressName(pb), sm = stressMax(pb), h = '', title, sub;
    if (m.action) {
      var dots = play.dots[m.action] || 0, attr = attrOf(m.action) || '', total = markDice(play, m), pushBlocked = !m.push && play.stress + 2 > sm;
      var parts = [dots + ' dot' + (dots === 1 ? '' : 's')]; if (m.push) parts.push('push'); if (m.assist) parts.push('assist'); if (m.bargain) parts.push('bargain');
      title = esc(m.action) + ' · <b>' + total + 'd</b>'; sub = esc(attr) + ' · ' + esc(parts.join(' + ')) + (total === 0 ? ' · roll 2d, take the lowest' : '');
      function tg(k, label, note, tip, dis) { return '<button type="button" class="chip sm ds-mtog" data-act="markopt" data-k="' + k + '" aria-pressed="' + !!m[k] + '" title="' + tip + '"' + (dis ? ' disabled' : '') + '><span>' + label + ' +1d</span><small>' + note + '</small></button>'; }
      h += '<div class="ds-mark-row ds-mrow-dice"><span class="ds-lab">Dice</span><span class="ds-mark-opts">' +
        tg('push', 'Push', '2 ' + esc(sn), 'Push yourself: +1d, and 2 ' + esc(sn) + ' marked on this sheet', pushBlocked) +
        tg('assist', 'Assist', 'helper: 1 ' + esc(sn), 'A crewmate assists: +1d; they mark 1 ' + esc(sn) + ' on their own sheet') +
        tg('bargain', 'Bargain', 'the GM’s price', 'Devil’s Bargain: +1d; the GM names the price') + '</span></div>';
      if (pushBlocked) h += '<p class="hint ds-warn">Pushing would take ' + esc(sn) + ' past ' + sm + ': ' + esc(overflowRule(pb)) + '. Mark it by hand if you push anyway.</p>';
      h += '<div class="ds-mark-row ds-mrow-then"><span class="ds-lab">Then</span><span class="ds-mark-cons">' +
        '<button type="button" class="btn sm' + (m.resist ? ' primary' : '') + '" data-act="markresist" data-always="1" aria-expanded="' + !!m.resist + '" title="Resist the consequence: roll an attribute, tap the highest die">Resist</button>' +
        [1, 2, 3].map(function (l) { return '<button type="button" class="btn sm" data-act="markharm" data-l="' + l + '" data-always="1" title="Write it on a level ' + l + ' harm line">Harm ' + l + '</button>'; }).join('') +
        '<button type="button" class="btn sm ds-plus1" data-act="stressd" data-d="1" title="Mark 1 ' + esc(sn) + '">+1 <span>' + esc(sn) + '</span></button></span></div>';
      if (m.push) h += '<div class="ds-roll-applied"><span class="ds-lab">Marked</span>+2 ' + esc(sn) + ' (push) <span class="ds-dim">' + play.stress + ' / ' + sm + '</span></div>';
    } else { title = 'Resist · <b>' + esc(m.resist.attr) + '</b>'; sub = resistDice(play, pb, m.resist.attr) + 'd · physical dice'; }
    if (m.resist) h += resistHelper(play, pb, m);
    h += abStrip(play, pb);
    /* the in-app roll, second; Close ends the strip (on a phone it is a bottom sheet, so the × is not the only way out) */
    h += '<div class="ds-mark-foot">' + (m.action
      ? '<button type="button" class="chip sm txt" data-act="rollapp" data-a="' + esc(m.action) + '" data-always="1">Roll in the app</button>'
      : '<button type="button" class="chip sm txt" data-act="resistapp" data-attr="' + esc(m.resist.attr) + '" data-always="1">Roll in the app</button>') +
      '<button type="button" class="btn sm ds-mark-close" data-act="panelclose" data-always="1">Close</button></div>';
    return '<div class="ds-roll ds-mark" tabindex="-1" role="region" aria-label="' + (m.action ? 'Mark the roll' : 'Resist') + '"><div class="ds-roll-h"><span class="ds-roll-t">' + title + '</span><span class="ds-roll-sub">' + sub + '</span><button type="button" class="ds-x ds-roll-x" data-act="panelclose" data-always="1" aria-label="Close" title="Close (Esc)">×</button></div><div class="ds-roll-body">' + h + '</div></div>';
  }
  /* the resist helper: the attribute (the action's by default), the dice to roll, then the player taps the highest die (the lowest with
     0 dice) or "two sixes"; the cost is applied and logged exactly as the in-app resistance roll applies and logs it */
  function resistHelper(play, pb, m) {
    var r = m.resist, n = resistDice(play, pb, r.attr), sn = stressName(pb), ro = noSave(), res = r.result, low = n === 0, h = '<div class="ds-rhelp">';
    h += '<div class="ds-mark-row ds-rattr"><span class="ds-lab">Resist with' + rl('resistance roll') + '</span><span class="seg">' + ATTRS.map(function (a) { return '<button type="button" class="chip sm" data-act="markrattr" data-v="' + esc(a) + '" data-always="1" aria-pressed="' + (r.attr === a) + '"' + (res ? ' disabled' : '') + '>' + esc(a) + ' ' + resistDice(play, pb, a) + 'd</button>'; }).join('') + '</span></div>';
    if (!res) {
      h += '<p class="hint">Roll <b>' + n + 'd</b>' + (low ? ' (no rating: roll 2d and take the lowest)' : '') + ' and tap the ' + (low ? 'lowest' : 'highest') + ' die: ' + esc(sn) + ' cost is 6 minus the die' + (low ? '.' : '; two sixes clear 1 ' + esc(sn) + ' instead.') + '</p>';
      h += '<div class="ds-mark-row"><span class="ds-lab">' + (low ? 'Lowest die' : 'Highest die') + '</span><span class="ds-mark-dice">' +
        [1, 2, 3, 4, 5, 6].map(function (v) { return '<button type="button" class="ds-dieb" data-act="markrdie" data-v="' + v + '"' + (ro ? ' disabled' : '') + ' aria-label="' + (low ? 'lowest' : 'highest') + ' die ' + v + ': ' + (6 - v ? '+' + (6 - v) : 'no') + ' ' + esc(sn) + '">' + dieSvg(v, '', 34) + '<small>' + (6 - v ? '+' + (6 - v) : '0') + '</small></button>'; }).join('') +
        (low ? '' : '<button type="button" class="ds-dieb ds-dieb-crit" data-act="markrdie" data-v="crit"' + (ro ? ' disabled' : '') + ' aria-label="two sixes: clear 1 ' + esc(sn) + '">' + dieSvg(6, 'six', 34) + dieSvg(6, 'six', 34) + '<small>−1</small></button>') + '</span></div>';
      if (ro) h += '<p class="hint">Not saved (' + notSavedWhy() + '): mark it by hand.</p>';
    } else {
      var cost = res.crit ? -1 : 6 - res.value;
      h += '<div class="ds-roll-res">' + diceSvgs(res) + '<div class="ds-roll-read"><span class="ds-roll-word ' + res.reading + '">' + (res.crit ? 'Critical' : (res.low ? 'lowest ' : 'highest ') + res.value) + '</span><span class="ds-roll-why">' + (res.crit ? 'clear 1 ' + esc(sn) : cost === 0 ? 'no ' + esc(sn) + ' at all' : '6 − ' + res.value + ' = ' + cost + ' ' + esc(sn)) + '</span></div>' +
        '<div class="ds-roll-applied"><span class="ds-lab">Applied</span>' + esc(res.applied.join(' · ')) + '</div><div class="row"><button type="button" class="btn sm" data-act="markrdone" data-always="1">Done</button></div></div>';
    }
    return h + '</div>';
  }
  /* the cost of a resistance roll, applied and logged; shared by the in-app roll's Apply and the helper's die taps */
  function applyResist(attr, res) {
    var p = cur.play, pb = cur.pb, sn = stressName(pb), sm = stressMax(pb), cost = res.crit ? -1 : 6 - res.value, before = p.stress;
    p.stress = clamp(before + cost, 0, sm);
    var what = res.crit ? 'clear 1 ' + sn : cost + ' ' + sn;
    res.applied = [(res.crit ? '−' + (before - p.stress) : '+' + (p.stress - before)) + ' ' + sn + ' (' + p.stress + ' / ' + sm + ')' + (cost > 0 && before + cost > sm ? ' — track full: ' + overflowRule(pb) : '')];
    addLog(p, { at: new Date().toISOString(), kind: 'roll', text: 'Resist ' + attr + ' ' + res.n + 'd' + (res.low ? ' (2d take lowest)' : '') + ' · ' + res.dice.join(',') + ' → ' + (res.crit ? 'critical, ' : '') + what });
  }
  function rollPanel(play, pb) {
    var r = cur.ui.roll; if (!r) return '';
    var sn = stressName(pb), sm = stressMax(pb), h = '', title, sub = '';
    if (r.kind === 'action') {
      var dots = play.dots[r.action] || 0, attr = attrOf(r.action) || '', total = dots + (r.push ? 1 : 0) + (r.assist ? 1 : 0) + (r.bargain ? 1 : 0);
      var pushBlocked = !r.push && play.stress + 2 > sm, rolled = !!r.result;
      title = 'Roll · <b>' + esc(r.action) + '</b>'; sub = esc(attr) + ' · ' + dots + ' dot' + (dots === 1 ? '' : 's');
      function tog(k, label, note, dis) { return '<button type="button" class="ds-rtog" data-act="rollopt" data-k="' + k + '" data-always="1" aria-pressed="' + !!r[k] + '"' + (dis ? ' disabled' : '') + '><span class="ds-sq' + (r[k] ? ' on' : '') + '"></span><span><b>' + label + '</b> <span class="ds-dim">' + note + '</span></span></button>'; }
      /* the dice and the Roll button first, the verdict right under them (so neither moves when the result lands), the options after;
         once rolled, the paid-for options lock and a second roll is asked for by name */
      var parts = [dots + ' dot' + (dots === 1 ? '' : 's')]; if (r.push) parts.push('push'); if (r.assist) parts.push('assist'); if (r.bargain) parts.push('bargain');
      /* a second roll pays its costs again (push); with nothing to pay it is just "Roll again" */
      h += '<div class="ds-roll-go"><span class="ds-roll-n"><b class="ds-roll-big mono">' + total + 'd</b><span class="ds-dim">' + esc(parts.join(' + ')) + (total === 0 ? ' · roll 2d, take the lowest' : '') + '</span></span><button type="button" class="btn sm primary" data-act="roll" data-always="1">' + (rolled ? (r.push ? 'Roll again (pays again)' : 'Roll again') : 'Roll') + '</button></div>';
      if (rolled) h += rollResult(r, pb);
      var prepaid = !!(r.paid && r.paid.push);
      h += '<div class="ds-roll-opts">' + tog('push', 'Push yourself', '+1d · 2 ' + esc(sn) + (prepaid ? ' · marked already' : rolled && r.push ? ' · paid' : ''), pushBlocked || rolled || prepaid) + tog('assist', 'Assist', '+1d · a crewmate takes 1 ' + esc(sn), rolled) + tog('bargain', 'Devil’s Bargain', '+1d · the GM names a price', rolled) + '</div>';
      if (pushBlocked) h += '<p class="hint ds-warn">Pushing would take ' + esc(sn) + ' past ' + sm + ': ' + esc(overflowRule(pb)) + '. Mark it by hand if you push anyway.</p>';
      h += '<div class="ds-roll-row"><span class="ds-lab">Position' + rl('position') + '</span><span class="seg">' + POSITIONS.map(function (p) { return '<button type="button" class="chip sm" data-act="rollpos" data-v="' + p + '" data-always="1" aria-pressed="' + (r.position === p) + '"' + (rolled ? ' disabled' : '') + '>' + capWord(p) + '</button>'; }).join('') + '</span>' + (r.position === 'desperate' || !dots ? '<span class="ds-dim">' + (r.position === 'desperate' ? 'earns ' + (dots ? 1 : 2) : 'zero-dot: earns 1') + ' xp</span>' : '') + '</div>';
      h += '<div class="ds-roll-row"><span class="ds-lab">Effect' + rl('effect') + '</span><span class="seg">' + EFFECTS.map(function (p) { return '<button type="button" class="chip sm" data-act="rolleff" data-v="' + p + '" data-always="1" aria-pressed="' + (r.effect === p) + '"' + (rolled ? ' disabled' : '') + '>' + capWord(p) + '</button>'; }).join('') + '</span><span class="ds-dim">for the fiction only</span></div>';
      if (rolled) h += '<p class="hint">The options stay as rolled. For a different roll, close this and tap the action again.</p>';
    } else if (r.kind === 'resist') {
      var n = resistDice(play, pb, r.attr), dm = isVamp(pb) && play.darkMajesty === r.attr;
      title = 'Resist · <b>' + esc(r.attr) + '</b>'; sub = n + 'd · ' + attrRating(play, r.attr) + ' action' + (attrRating(play, r.attr) === 1 ? '' : 's') + ' rated 1+' + (dm ? ' + 1 Dark Majesty' : '');
      h += '<p class="hint">Resist a consequence' + rl('resistance roll') + ': ' + esc(sn) + ' cost is 6 minus the highest die; a critical clears 1 ' + esc(sn) + ' instead.' + (n === 0 ? ' No rating: roll 2d and take the lowest.' : '') + '</p>';
      h += '<div class="ds-roll-go"><span class="ds-roll-n"><b class="ds-roll-big mono">' + n + 'd</b><span class="ds-dim">' + (n === 0 ? 'roll 2d, take the lowest' : esc(r.attr) + ' rating') + '</span></span><button type="button" class="btn sm primary" data-act="roll" data-always="1">' + (r.result ? 'Roll again' : 'Roll') + '</button></div>';
      if (r.result) h += rollResult(r, pb);
    } else {
      title = 'Fortune roll'; sub = 'any number of dice';
      h += '<div class="ds-roll-row"><span class="ds-lab">Dice</span><span class="seg">' + [0, 1, 2, 3, 4, 5, 6].map(function (i) { return '<button type="button" class="chip sm" data-act="fortn" data-n="' + i + '" data-always="1" aria-pressed="' + (r.n === i) + '">' + i + 'd</button>'; }).join('') + '</span></div>';
      h += '<div class="ds-roll-go"><span class="ds-roll-n"><b class="ds-roll-big mono">' + r.n + 'd</b><span class="ds-dim">' + (r.n === 0 ? 'roll 2d, take the lowest' : 'read the highest die') + '</span></span><button type="button" class="btn sm primary" data-act="roll" data-always="1">' + (r.result ? 'Roll again' : 'Roll') + '</button></div>';
      if (r.result) h += rollResult(r, pb);
    }
    h += abStrip(play, pb);
    return '<div class="ds-roll" tabindex="-1" role="region" aria-label="Roll"><div class="ds-roll-h"><span class="ds-roll-t">' + title + '</span><span class="ds-roll-sub">' + sub + '</span><button type="button" class="ds-x ds-roll-x" data-act="rollclose" data-always="1" aria-label="Close the roll panel" title="Close (Esc)">×</button></div><div class="ds-roll-body">' + h + '</div>' + panelFoot() + '</div>';
  }
  /* the phone's bottom sheet ends in a Close button (hidden on a desk, where the panel sits inline with its ×) */
  function panelFoot() { return '<div class="ds-roll-foot"><button type="button" class="btn sm" data-act="panelclose" data-always="1">Close</button></div>'; }
  function rollResult(r, pb) {
    var res = r.result, sn = stressName(pb), word = res.reading, h = '<div class="ds-roll-res">' + diceSvgs(res);
    if (r.kind === 'resist') {
      var cost = res.crit ? -1 : 6 - res.value;
      h += '<div class="ds-roll-read"><span class="ds-roll-word ' + word + '">' + (res.crit ? 'Critical' : (res.low ? 'lowest ' : 'highest ') + res.value) + '</span><span class="ds-roll-why">' + (res.crit ? 'clear 1 ' + esc(sn) : cost === 0 ? 'no ' + esc(sn) + ' at all' : '6 − ' + res.value + ' = ' + cost + ' ' + esc(sn)) + '</span></div>';
      if (res.applied) h += '<div class="ds-roll-applied"><span class="ds-lab">Applied</span>' + esc(res.applied.join(' · ')) + '</div>';
      else h += '<div class="row ds-roll-apply"><button type="button" class="btn sm" data-act="resistapply"' + (noSave() ? ' disabled' : '') + '>Apply ' + (res.crit ? '−1' : '+' + cost) + ' ' + esc(sn) + '</button>' + (noSave() ? '<span class="ds-dim">not saved (' + notSavedWhy() + '): mark it by hand</span>' : '') + '</div>';
    } else {
      var why = r.kind === 'action' ? OUTCOMES[r.position][word] : word === 'critical' ? 'Exceptional result.' : word === 'success' ? 'Good result.' : word === 'partial' ? 'Mixed result.' : 'Bad result.';
      h += '<div class="ds-roll-read"><span class="ds-roll-word ' + word + '">' + capWord(word) + '</span><span class="ds-roll-why">' + (r.kind === 'action' ? capWord(r.position) + ', ' + r.effect + ' effect · ' : '') + esc(why) + '</span></div>';
      if (res.low) h += '<p class="hint">Zero dice: the lowest of two is read, so no critical is possible.' + (r.kind === 'action' ? ' A zero-dot action earns 1 xp, even with a push or help.' : '') + '</p>';
      if (res.applied && res.applied.length) h += '<div class="ds-roll-applied"><span class="ds-lab">' + (res.saved ? 'Applied' : 'Not saved (' + esc(res.savedWhy || '') + ')') + '</span>' + esc(res.applied.join(' · ')) + '</div>';
      else if (!res.saved) h += '<div class="ds-roll-applied"><span class="ds-lab">Not saved (' + esc(res.savedWhy || '') + ')</span><span class="ds-dim">the roll was not logged</span></div>';
      else h += '<div class="ds-roll-applied"><span class="ds-lab">Logged</span><span class="ds-dim">nothing else to mark</span></div>';
    }
    return h + '</div>';
  }
  function stacks(play, pb) {
    var hull = isHull(pb), tt = isTT(pb), canBank = !hull || play.abilities.indexOf('A Room of Your Own') >= 0;
    var h = '<div class="ds-stackrow"><span class="ds-lab">Stacks</span><span class="ds-dias">' + diamonds(4, play.stacks, 'stacks') + '</span><span class="mono ds-count">' + play.stacks + '</span></div>';
    if (tt) { h += '<p class="hint">No bank: a time traveler keeps only what they carry. A carried stack takes a load slot.</p>'; return box('Stacks', h, '', 'ds-stackbox'); }
    h += '<div class="ds-bank"><span class="ds-lab">Bank' + (hull ? ' <span class="ds-dim">*requires A Room of Your Own</span>' : '') + '</span>';
    for (var r = 0; r < 4; r++) { h += '<span class="ds-dias">'; for (var i = 1; i <= 10; i++) { var n = r * 10 + i; h += '<button type="button" class="ds-dia' + (n <= play.bank ? ' on' : '') + '" data-act="bank" data-n="' + n + '"' + (canBank ? '' : ' disabled') + ' aria-label="bank ' + n + '"></button>'; } h += '</span>'; }
    h += '<span class="mono ds-count">' + play.bank + ' / 40</span></div>';
    if (!canBank) h += '<p class="hint">Hulls cannot put stacks into bank without the trait A Room of Your Own.</p>';
    h += '<div class="row ds-tools"><button type="button" class="btn sm" data-act="tobank" data-n="1"' + (canBank && play.stacks > 0 && play.bank < 40 ? '' : ' disabled') + '>Bank a stack</button><button type="button" class="btn sm" data-act="frombank" data-n="1"' + (play.bank > 0 && play.stacks < 4 ? '' : ' disabled') + '>Draw a stack</button></div>';
    return box('Stacks & bank', h, '', 'ds-stackbox');
  }
  function itemLoad(play, pb, name) { var all = ((pb && pb.items) || []).concat(CT.STANDARD_ITEMS || [], (play.extraItems || []).map(function (x) { return [x.name, x.load]; })); var it = all.filter(function (i) { return i[0] === name; })[0]; return it ? +it[1] || 0 : 0; }
  function loadBonus(play) { var b = 0; if (play.abilities.indexOf('Walking Arsenal') >= 0) b += 2; if (play.abilities.indexOf('Retractable Arsenal') >= 0) b += 2; return b; }
  /* what is carried against the limit (null for a ghost, who carries no load) */
  function loadNow(play, pb) {
    if (isGhost(pb)) return null;
    var carried = play.items.reduce(function (t, n) { return t + itemLoad(play, pb, n); }, 0);
    return { carried: carried, total: carried + play.stacks, limit: (play.loadLimit === 'loud' ? 6 : 3) + loadBonus(play) };
  }
  function items(play, pb) {
    if (isGhost(pb)) return box('Items (with you in ghost form)', (pb.itemsRule ? '<p class="hint">' + esc(pb.itemsRule) + '</p>' : '') + textarea('ghostItems', play.ghostItems, 'Whatever came with you'), '', 'ds-itembox');
    var hull = isHull(pb), ld = loadNow(play, pb), carried = ld.carried, total = ld.total, limit = ld.limit, over = total > limit, editing = !!cur.ui.loadout;
    function row(it, extra) { var on = play.items.indexOf(it[0]) >= 0, l = +it[1] || 0, lb = ''; for (var i = 0; i < l; i++) lb += '<span class="ds-ld"></span>'; return '<button type="button" class="ds-item' + (on ? ' on' : '') + '" data-act="item" data-n="' + esc(it[0]) + '" aria-pressed="' + on + '"><span class="ds-sq' + (on ? ' on' : '') + '"></span><span class="ds-item-n">' + esc(it[0]) + '</span><span class="ds-lds">' + (l ? lb : '<span class="ds-dim">0</span>') + '</span></button>' + (extra || ''); }
    var h = '<div class="ds-loadhead"><span class="seg"><button type="button" class="chip sm" data-act="limit" data-v="quiet" aria-pressed="' + (play.loadLimit !== 'loud') + '">◇ ' + (3 + loadBonus(play)) + ' quiet</button><button type="button" class="chip sm" data-act="limit" data-v="loud" aria-pressed="' + (play.loadLimit === 'loud') + '">◆ ' + (6 + loadBonus(play)) + ' loud</button></span>' +
      '<span class="budget' + (over ? ' bad' : '') + '">' + total + ' / ' + limit + ' load</span>' + rl('load') + '</div>' +
      '<p class="hint">' + carried + ' from items' + (play.stacks ? ' + ' + play.stacks + ' from stacks carried' : '') + (hull ? '. Frame armor is free.' : '. A carried stack takes a load slot.') + '</p>';
    /* a phone shows what is carried and folds the rest of the list behind "Edit loadout" (tracker.css); a desk shows it all */
    h += '<div class="row ds-loadedit">' + (play.items.length ? '' : '<span class="hint">Nothing carried yet.</span>') + '<button type="button" class="btn sm" data-act="loadout" data-always="1" aria-expanded="' + editing + '">' + (editing ? 'Done' : 'Edit loadout') + '</button></div>';
    h += '<div class="ds-items ds-pbitems">' + ((pb && pb.items) || []).map(function (it) { return row(it); }).join('') + '</div>';
    h += '<div class="ds-items">' + (CT.STANDARD_ITEMS || []).map(function (it) { return row(it); }).join('') + '</div>';
    if (play.extraItems.length) h += '<div class="ds-items">' + play.extraItems.map(function (x) { return row([x.name, x.load], '<button type="button" class="ds-x" data-act="rmitem" data-n="' + esc(x.name) + '" title="Remove">×</button>'); }).join('') + '</div>';
    h += '<div class="row ds-addrow">' + input('', '', 'Another item', 'ds-grow ds-newitem') + '<input type="number" class="ds-in ds-num ds-newload" min="0" max="6" value="1" aria-label="load"><button type="button" class="btn sm" data-act="additem">Add</button></div>';
    return box('Items', h, '', 'ds-itembox' + (editing ? ' ds-editing' : ''));
  }
  function contacts(play, pb) {
    if (isGhost(pb)) return box('Enemies & Rivals', (pb.friendsRule ? '<p class="hint">' + esc(pb.friendsRule) + '</p>' : '') + textarea('enemies', play.enemies, 'Who wants you gone, and who you haunt'));
    var h = '';
    if (isTT(pb) && pb.friendsRule) h += '<p class="hint">' + esc(pb.friendsRule) + '</p>';
    h += '<div class="ds-contacts">';
    play.contacts.forEach(function (c, i) {
      h += '<div class="ds-contact"><button type="button" class="ds-cdot' + (c.kind ? ' ' + c.kind : '') + '" data-act="contact" data-i="' + i + '" title="' + (c.kind === 'friend' ? '▲ friend' : c.kind === 'rival' ? '▼ rival' : 'neither') + '">' + (c.kind === 'friend' ? '▲' : c.kind === 'rival' ? '▼' : '△') + '</button>' +
        '<span class="ds-cname">' + esc(c.name) + (c.role ? ', <span class="ds-dim">' + esc(c.role) + '</span>' : '') + '</span><span class="ds-cst">' + (c.kind === 'friend' ? 'friend' : c.kind === 'rival' ? 'rival' : '') + '</span>' +
        '<button type="button" class="ds-x" data-act="rmcontact" data-i="' + i + '" title="Remove">×</button></div>';
    });
    h += '</div><div class="row ds-addrow">' + input('', '', 'Name', 'ds-grow ds-newcname') + input('', '', 'what they do', 'ds-grow ds-newcrole') + '<button type="button" class="btn sm" data-act="addcontact">Add</button></div>';
    var title = pb && pb.contactsLabel ? esc(pb.contactsLabel) : isHull(pb) ? 'Contacts' : pb && pb.id === 'hound' ? 'Shady friends' : pb && pb.id === 'intellectual' ? 'Brilliant friends' : pb && pb.veteran ? 'Difficult friends' : 'Friends & rivals';
    return box(title, h, '<span class="ds-dim">click the mark to cycle</span>');
  }
  function vice(play, pb) {
    if (isHull(pb) || isPara(pb)) return '';
    var opts = '<option value="">—</option>'; (CT.VICES || []).forEach(function (v) { opts += '<option value="' + esc(v.name) + '"' + (play.vice === v.name ? ' selected' : '') + '>' + esc(v.name) + '</option>'; });
    if (play.vice && !(CT.VICES || []).some(function (v) { return v.name === play.vice; })) opts += '<option value="' + esc(play.vice) + '" selected>' + esc(play.vice) + '</option>';
    return box('Vice / hookup', '<div class="ds-vice"><select class="ds-sel" data-change="vice">' + opts + '</select>' + input('purveyor', play.purveyor, 'Purveyor: name, place, district') + '</div>');
  }
  function strictures(play, pb) {
    if (!isVamp(pb)) return '';
    var listed = (pb.strictures || []).map(function (s) { return s[0]; });
    var h = (pb.stricturesRule ? '<p class="hint">' + esc(pb.stricturesRule) + '</p>' : '') + '<div class="ds-strics">';
    (pb.strictures || []).forEach(function (s) {
      var on = play.strictures.indexOf(s[0]) >= 0, fixed = s[0] === 'Dayfire';
      h += '<label class="ds-stric' + (on ? ' on' : '') + '"><input type="checkbox" data-change="stricture" data-n="' + esc(s[0]) + '"' + (on ? ' checked' : '') + (fixed ? ' disabled' : '') + '><span><b>' + esc(s[0]) + (fixed ? ' <span class="ds-dim">(always)</span>' : '') + '</b> ' + esc(s[1]) + '</span></label>';
    });
    play.strictures.forEach(function (s) { if (listed.indexOf(s) < 0) h += '<label class="ds-stric on"><input type="checkbox" data-change="stricture" data-n="' + esc(s) + '" checked><span><b>' + esc(s) + '</b></span></label>'; });
    h += '</div>';
    return box('Strictures', h, '<span class="ds-dim">' + play.strictures.length + ' / 6</span>');
  }
  function mission(play, pb) {
    if (!isTT(pb)) return '';
    var m = play.mission, def = missionOf(pb, m.name), h = '';
    if (!m.name) {
      var opts = '<option value="">Choose the mission…</option>'; (pb.missions || []).forEach(function (x) { opts += '<option value="' + esc(x.name) + '">' + esc(x.name) + '</option>'; });
      h += '<div class="row"><select class="ds-sel" data-change="mission">' + opts + '</select></div>';
    } else h += '<div class="ds-mname"><b>' + esc(m.name) + '</b>' + (def ? '<div class="ds-dim">' + esc(def.text) + '</div>' : '') + '</div>';
    var qs = def ? def.questions : ['', '', '', ''];
    h += '<div class="ds-mq">' + qs.map(function (q, i) { return '<div><span class="ds-lab">' + esc(q || 'Question ' + (i + 1)) + '</span>' + input('mission.answers.' + i, m.answers[i] || '', 'Answer') + '</div>'; }).join('') + '</div>';
    h += '<div class="ds-lab ds-sub">Details of the mission</div><p class="hint">Each temporal glitch and each gain of clarity adds a line: note down a new detail as your mind clears.</p>';
    h += '<div class="ds-details">' + m.details.map(function (d, i) { return '<div class="ds-detail"><span class="mono ds-dim">' + (i + 1) + '</span>' + input('mission.details.' + i, d, 'A new detail of your mission') + '<button type="button" class="ds-x" data-act="rmdetail" data-i="' + i + '" title="Remove">×</button></div>'; }).join('') + '</div>';
    h += '<div class="row ds-addrow"><button type="button" class="btn sm" data-act="adddetail">Add detail</button></div>';
    return box('Mission', h, pb.subtitle ? '<span class="ds-dim">' + esc(pb.subtitle) + '</span>' : '');
  }
  function clocks(play, pb) {
    var h = '<div class="ds-clocks">';
    play.clocks.forEach(function (c, i) {
      h += '<div class="ds-clockrow">' + clockSvg(c.size, c.filled, 26, 'clock', ' data-i="' + i + '"') + '<div class="ds-clockmeta">' + input('clocks.' + i + '.name', c.name, 'What is this clock for?') + '<span class="ds-dim mono">' + c.filled + ' / ' + c.size + '</span></div><button type="button" class="ds-x" data-act="rmclock" data-i="' + i + '" title="Remove">×</button></div>';
    });
    if (!play.clocks.length) h += '<p class="hint">Long-term projects, healing, the GM’s dangers: add a clock and click its segments.</p>';
    h += '</div><div class="row ds-addrow">' + input('', '', 'New clock', 'ds-grow ds-newclock') + '<span class="seg">' + [4, 6, 8].map(function (n) { return '<button type="button" class="chip sm" data-act="addclock" data-n="' + n + '">' + n + '</button>'; }).join('') + '</span></div>';
    return box('Clocks' + rl('clocks'), h);
  }
  function memories(play, pb) {
    if (!isHull(pb)) return '';
    var h = '<p class="hint">Whenever you would mark playbook xp, you can tick a memory clock instead. When the clock is full, fill in the memory: you also remember one key, a human contact, and a special ability from another playbook.</p><div class="ds-mems">';
    play.memories.forEach(function (m, i) {
      h += '<div class="ds-mem' + (m.filled >= m.size ? ' full' : '') + '"><div class="ds-mem-h"><b>' + esc(m.name) + '</b>' + clockSvg(m.size || 8, m.filled, 22, 'memory', ' data-i="' + i + '"') + '</div>' + input('memories.' + i + '.text', m.text || '', m.filled >= (m.size || 8) ? 'Write the memory' : 'Fill the clock, then write the memory') + '</div>';
    });
    h += '</div><div class="ds-susp"><span class="ds-lab">Suspicion</span>' + clockSvg(4, play.suspicion, 22, 'suspicion') + '<span class="hint">Each downtime you skip going On Program, tick it. When full, your owning faction takes steps.</span></div>';
    return box('Human memories', h);
  }
  function notes(play) { return box('Notes', '<textarea class="ds-ta" data-path="notes" placeholder="Anything the sheet has no box for">' + esc(play.notes) + '</textarea>'); }
  function log(play) {
    var h = '<div class="row ds-addrow">' + input('', '', 'What happened this session?', 'ds-grow ds-newlog') + '<button type="button" class="btn sm" data-act="log">Log</button></div><ol class="ds-log">';
    (play.log || []).forEach(function (e, i) {
      var d = '', roll = e.kind === 'roll'; try { d = new Date(e.at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (x) { d = String(e.at || '').slice(0, 10); }
      h += '<li' + (roll ? ' class="roll"' : '') + '><span class="mono ds-logd">' + esc(d) + '</span><span class="ds-logt' + (roll ? ' mono' : '') + '">' + (roll ? '<span class="ds-logdie" aria-hidden="true">' + dieSvg(6, '', 14) + '</span>' : '') + esc(e.text) + '</span><button type="button" class="ds-x" data-act="rmlog" data-i="' + i + '" title="Remove">×</button></li>';
    });
    h += '</ol>' + (!(play.log || []).length ? '<p class="hint">Nothing logged yet.</p>' : '');
    return box('Session log', h, '<span class="ds-dim">newest first</span>', 'ds-logbox');
  }

  /* ---------- render ---------- */
  /* a phone (the screen rules in tracker.css): the figure is not drawn, the thumbnail is; crossing 760px draws again */
  var MQ = null; try { MQ = window.matchMedia ? window.matchMedia('screen and (max-width: 760px)') : null; } catch (e) { MQ = null; }
  function narrow() { return !!(MQ && MQ.matches); }
  var printing = false;
  if (MQ) { var onMq = function () { if (cur && !cur.ui.static && !printing) render(); }; try { if (MQ.addEventListener) MQ.addEventListener('change', onMq); else if (MQ.addListener) MQ.addListener(onMq); } catch (e) {} }
  /* the sheet as [slot name, markup] pairs, in the order they are drawn (head first: it holds the vitals' slot) */
  var COLS = { c1: ['figure', 'stress', 'keys', 'strictures', 'harm', 'cohort', 'vice'], c2: ['abilities', 'contacts', 'triggers', 'session', 'downtime', 'mission', 'memories'], c3: ['stacks', 'actions', 'items'], c4: ['clocks', 'notes', 'log'] };
  var ORDER = ['head', 'vitals', 'bar', 'figure', 'stress', 'keys', 'strictures', 'harm', 'cohort', 'vice', 'abilities', 'contacts', 'triggers', 'session', 'downtime', 'mission', 'memories', 'stacks', 'actions', 'items', 'clocks', 'notes', 'log'];
  /* one slot's markup (null for a slot this sheet has none of) */
  function buildPart(name) {
    var doc = cur.doc, play = cur.play, pb = cur.pb, sheet = doc.sheet || {};
    switch (name) {
      case 'head': return header(doc, play, pb, sheet);
      case 'vitals': return cur.ui.static ? null : vitals(play, pb);
      case 'bar': return tableBar(play);
      case 'figure': return figure(doc, pb);
      case 'stress': return stress(play, pb); case 'keys': return keys(play, pb); case 'strictures': return strictures(play, pb); case 'harm': return harm(play, pb);
      case 'cohort': return cohort(play, pb); case 'vice': return vice(play, pb); case 'abilities': return abilities(play, pb, sheet); case 'contacts': return contacts(play, pb);
      case 'triggers': return triggers(play, pb); case 'session': return session(play, pb); case 'downtime': return downtime(play, pb); case 'mission': return mission(play, pb);
      case 'memories': return memories(play, pb); case 'stacks': return stacks(play, pb); case 'actions': return actions(play, pb); case 'items': return items(play, pb);
      case 'clocks': return clocks(play, pb); case 'notes': return notes(play); case 'log': return log(play);
    }
    return null;
  }
  function buildParts() { return ORDER.map(function (n) { return [n, buildPart(n)]; }); }
  /* a field was typed in: the DOM already shows the text, so its slot's remembered markup is brought up to date without touching the DOM */
  function syncTyped(t) {
    var name = null; if (!cur.slots) return;
    Object.keys(cur.slots).forEach(function (k) { if (!name && cur.slots[k].nodes.some(function (n) { return n === t || (n.contains && n.contains(t)); })) name = k; });
    if (!name) return;
    var str = buildPart(name); if (str != null) cur.slots[name].last = (readOnly() ? '1' : '0') + str;   /* one box, not the sheet */
  }
  function fillSlot(sl, str, ro) {
    var tpl = document.createElement('template'); tpl.innerHTML = str; var frag = tpl.content;
    fillMarkers(frag);
    if (ro === '1') frag.querySelectorAll('button, input, textarea, select').forEach(function (n) { if (!n.dataset.always) n.disabled = true; });
    var nodes = Array.prototype.slice.call(frag.childNodes), p = sl.anchor.parentNode;
    sl.nodes.forEach(function (n) { if (n.parentNode === p) p.removeChild(n); });
    p.insertBefore(frag, sl.anchor.nextSibling); sl.nodes = nodes;
  }
  function anchorsIn(scope, into) {
    var w = document.createTreeWalker(scope, 128), n;
    while ((n = w.nextNode())) { if (n.data.slice(0, 2) === 's:') into[n.data.slice(2)] = { anchor: n, nodes: [], last: null }; }
  }
  function render() {
    if (!cur) return; var play = cur.play, pb = cur.pb;
    var focus = captureFocus(), a0 = document.activeElement;
    /* each box is a keyed slot (a comment anchor and its nodes, no wrapper element). The sheet is built as strings, as it always
       was; only a slot whose string differs from the last one drawn is replaced, so a tap redraws its box (and the vitals)
       and nothing else, and a poll that brings back what the sheet already shows changes nothing */
    var parts = buildParts();
    var oldPanel = cur.root.querySelector('.ds-roll'), keepTop = oldPanel ? oldPanel.scrollTop : 0;   /* a redrawn panel starts at the top: put it back where it was */
    if (!cur.slots || !cur.slots.head || cur.root.firstChild !== cur.slots.head.anchor || !cur.slots.head.anchor.parentNode) {
      cur.root.innerHTML = slotMark('head') + slotMark('bar') + '<div class="ds-grid">' + Object.keys(COLS).map(function (c) { return '<div class="ds-col ds-' + c + '">' + COLS[c].map(slotMark).join('') + '</div>'; }).join('') + '</div>';
      cur.slots = {}; anchorsIn(cur.root, cur.slots);
    }
    var ro = readOnly() ? '1' : '0';
    parts.forEach(function (p) {
      var name = p[0], str = p[1], sl = cur.slots[name]; if (!sl || str == null) return;
      var key = ro + str; if (sl.last === key) return;
      fillSlot(sl, str, ro); sl.last = key;
      /* the vitals slot lives inside the head's markup: a new head has a new, empty one */
      if (name === 'head') { delete cur.slots.vitals; var vs = {}; sl.nodes.forEach(function (n) { if (n.nodeType === 1) anchorsIn(n, vs); }); if (vs.vitals) cur.slots.vitals = vs.vitals; }
    });
    syncStatus();
    if (printing) printFigure(true);
    var open = anyPanel();
    var rcls = 'dossier ds' + (cur.ui.static ? ' ds-static' : ' ds-live') + (readOnly() ? ' ds-ro' : '') + (pb && pb.id ? ' ds-pb-' + pb.id : '') + (open ? ' ds-panel-open' : '');
    if (cur.root.className !== rcls) cur.root.className = rcls;
    askOwner();
    if (focus && !(a0 && a0.isConnected)) restoreFocus(focus);
    /* the roll panel: bring it (or, after a roll, its verdict) into view, and keep keyboard focus inside the sheet so Esc closes it.
       On a phone the panel is a fixed bottom sheet (tracker.css): it is in view by itself, only its verdict may need a scroll inside it */
    var panel = open ? cur.root.querySelector('.ds-roll') : null;
    if (panel && oldPanel && keepTop && !cur.ui.rollScroll && panel !== oldPanel && panel.className === oldPanel.className && panel.getAttribute('aria-label') === oldPanel.getAttribute('aria-label')) panel.scrollTop = keepTop;   /* the same panel redrawn, not another one opened */
    if (panel && cur.ui.abScroll) { cur.ui.abScroll = false; var strip = panel.querySelector('.ds-abstrip.open'); if (strip) { try { strip.scrollIntoView({ block: 'nearest' }); } catch (e) {} } }
    if (panel) {
      if (cur.ui.rollScroll) {
        var want = cur.ui.rollScroll, fixed = false; cur.ui.rollScroll = false;
        try { fixed = getComputedStyle(panel).position === 'fixed'; } catch (e) {}
        var tgt = want === 'res' ? panel.querySelector('.ds-roll-res') || panel : panel;
        if (!(fixed && tgt === panel)) { try { tgt.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) {} }
      }
      var a = document.activeElement; if (!a || a === document.body || !cur.root.contains(a)) { try { panel.focus({ preventScroll: true }); } catch (e) {} }
    }
  }
  function captureFocus() {
    if (!cur) return null; var a = document.activeElement; if (!a || !cur.root.contains(a)) return null;
    var tag = a.tagName; if (tag !== 'INPUT' && tag !== 'TEXTAREA') return null;
    return { path: a.dataset.path || null, cls: a.className, value: a.value, s: a.selectionStart, e: a.selectionEnd };
  }
  function restoreFocus(f) {
    if (!f || !cur) return; var n = null;
    if (f.path) n = cur.root.querySelector('[data-path="' + f.path.replace(/"/g, '\\"') + '"]');
    else { var cls = f.cls.split(' ').filter(function (c) { return /^ds-new/.test(c); })[0]; if (cls) n = cur.root.querySelector('.' + cls); }
    if (!n) return; if (!f.path) n.value = f.value;
    try { n.focus({ preventScroll: true }); if (f.s != null) n.setSelectionRange(f.s, f.e); } catch (e) {}
  }

  /* ---------- actions ---------- */
  function toggleTrack(curV, n) { return curV === n ? n - 1 : n; }
  /* xp on the bar pays for a raised track (cost > 0) and takes back a lowered one (cost < 0); false when the bar is short */
  function spendHold(cost) {
    var p = cur.play, h = p.xpHold || 0;
    if (cost > 0 && h < cost) { note(h ? 'Only ' + h + ' xp on the bar' : 'No xp on the bar: add it first, then tap the track'); render(); return false; }
    p.xpHold = clamp(h - cost, 0, 99); return true;
  }
  function spendForAbility(name, what) {
    var p = cur.play;
    if (p.xp.playbook >= 8) { if (!window.confirm('Spend 8 playbook xp on ' + what + '?')) return false; p.xp.playbook -= 8; note('8 xp spent on ' + name); return true; }
    return window.confirm('You have ' + p.xp.playbook + ' / 8 playbook xp. Add ' + what + ' anyway (GM)?');
  }
  /* Dark Majesty: which attribute's actions may reach 5; null when cancelled */
  function askMajesty() {
    var v = window.prompt('Dark Majesty: choose Insight, Prowess or Resolve. Actions under that attribute may reach rating 5, and its resistance rating gains +1.\n' + numbered(ATTRS), ATTRS[1] || 'Prowess');
    if (v == null) return null; var i = pickIndex(ATTRS, v); if (i < 0) { note('Not an attribute: Insight, Prowess or Resolve'); return null; } return ATTRS[i];
  }
  /* a new vampiric trait adds a stricture; cancelling leaves it to the Strictures box */
  function askStricture() {
    var p = cur.play, pb = cur.pb, left = (pb.strictures || []).map(function (s) { return s[0]; }).filter(function (n) { return p.strictures.indexOf(n) < 0; });
    if (!left.length) return;
    var v = window.prompt('A new vampiric trait adds a stricture. Which one?\n' + numbered(left.map(function (n) { var s = pb.strictures.filter(function (x) { return x[0] === n; })[0]; return n + ' — ' + (s ? s[1] : ''); })), '1');
    if (v == null) { note('No stricture added: tick one in the Strictures box'); return; }
    var i = pickIndex(left, v); if (i < 0) { note('No such stricture: tick one in the Strictures box'); return; }
    p.strictures.push(left[i]); note('Stricture added: ' + left[i]);
  }
  var ACTIONS = {
    back: function () { if (cur.api && cur.api.back) cur.api.back(); },
    tablescreen: function (d, btn) { openTableScreen(btn); },
    missionscreen: function (d, btn) { openMissionScreen(btn); },
    edit: function () { if (cur.api && cur.api.edit) cur.api.edit(); },
    print: function () { printFigure(true); try { window.print(); } catch (e) { note('Printing is not available here'); } },
    /* Remove deletes the character for everyone, for good: it sits at the foot of "…", for the owner and the GM, behind a
       confirm that names the character */
    remove: function () {
      if (!canRemove()) return;
      var name = cur.doc.name || (cur.doc.sheet && cur.doc.sheet.name) || 'this character';
      if (!window.confirm('Remove ' + name + ' for good? The sheet and everything on it are deleted for everyone at the table. This cannot be undone.')) return;
      var p; try { p = cur.api.remove(); } catch (e) { setStatus('Could not remove: ' + e.message, true); return; }
      setStatus('Removing…'); Promise.resolve(p).then(null, function (e) { if (cur) setStatus('Could not remove: ' + (e && e.message || e), true); });
    },
    more: function () { cur.ui.more = !cur.ui.more; render(); var mi = cur.ui.more && cur.root.querySelector('.ds-menu .ds-mi'); if (mi && mi.offsetParent) try { mi.focus({ preventScroll: true }); } catch (e) {} },
    about: function () { cur.ui.about = !cur.ui.about; render(); },
    loadout: function () { cur.ui.loadout = !cur.ui.loadout; render(); },
    /* the vitals: scroll the box to just under the sticky bar */
    jump: function (d) {
      if (['ds-stressbox', 'ds-harmbox', 'ds-xpbox', 'ds-itembox'].indexOf(d.to) < 0) return;
      var b = cur.root.querySelector('.ds-grid .' + d.to); if (!b) return;
      var bar = cur.root.querySelector('.ds-bar'), off = 0;
      try { if (bar && getComputedStyle(bar).position === 'sticky') off = bar.getBoundingClientRect().height; } catch (e) {}
      var y = Math.max(0, b.getBoundingClientRect().top + (window.pageYOffset || 0) - off - 8);
      try { window.scrollTo({ top: y, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, y); }
      var h = b.querySelector('.ds-bt'); if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (e) {} }
    },
    view: function (d) { cur.ui.mug = d.v === 'mug'; render(); },
    stress: function (d) { cur.play.stress = toggleTrack(cur.play.stress, +d.n); commit(); },
    stressd: function (d) { cur.play.stress = clamp(cur.play.stress + (+d.d), 0, stressMax(cur.pb)); commit(); },
    /* ghost: possess a victim and consume their life essence: clear half the Drain, rounded down */
    consume: function () { var half = Math.floor(cur.play.stress / 2); if (!half) { note('Nothing to clear'); return; } cur.play.stress -= half; note('Consumed: ' + half + ' Drain cleared'); commit(); },
    /* vampire: hunt prey; clear Stress equal to the highest die, mark 4 ticks on the healing clock */
    feed: function () {
      var v = window.prompt('Feed: what was the highest die on the Hunt roll? (1–6) That much Stress is cleared and the healing clock gains 4 ticks.', '6');
      if (v == null) return; var d = parseInt(String(v).trim(), 10); if (!(d >= 1 && d <= 6)) { note('Enter a number from 1 to 6'); return; }
      var before = cur.play.stress; cur.play.stress = Math.max(0, before - d); cur.play.healing = Math.min(4, (cur.play.healing || 0) + 4);
      note('Fed: ' + (before - cur.play.stress) + ' Stress cleared, healing +4'); commit();
    },
    /* time traveler: spend one canister / vial of alluvium, clear 5 Instability */
    restabilize: function () { if (!(cur.play.alluvium > 0)) { note('No alluvium left'); return; } cur.play.alluvium--; cur.play.stress = Math.max(0, cur.play.stress - 5); note('Restabilized: one ' + ((cur.pb && cur.pb.alluviumName) || 'canister') + ' used'); commit(); },
    alluvium: function (d) { cur.play.alluvium = clamp(toggleTrack(cur.play.alluvium, +d.n), 0, alluvMax(cur.pb)); commit(); },
    /* once per session per key: the first hit this session puts 1 xp on the bar and sets play.keyHitSession[i]; End session clears it */
    keyhit: function (d) {
      var p = cur.play, i = +d.i, k = p.keys[i]; if (!k) return; var n = +d.n, hs = p.keyHitSession || {};
      if (n > (k.hits || 0)) {
        k.hits = n;
        if (hs[i]) note('Already hit this session: no more xp from this key until the session ends');
        else {
          var nh = Object.assign({}, hs); nh[i] = true; p.keyHitSession = nh;
          p.xpHold = clamp((p.xpHold || 0) + 1, 0, 99); note('Key hit: +1 xp on the bar');
        }
      } else k.hits = n - 1;
      commit();
    },
    deadlock: function (d) { var k = cur.play.keys[+d.i]; if (!k) return; var word = d.dir === 'up' ? k.up : k.down; if (!window.confirm('Deadlock ' + (k.name || 'this key') + ' as ' + (d.dir === 'up' ? '▲ ' : '▼ ') + (word || d.dir) + '? Hard mode: this is permanent.')) return; k.deadlock = d.dir; commit(); },
    undeadlock: function (d) { var k = cur.play.keys[+d.i]; if (!k) return; if (!window.confirm('GM override: clear the permanent deadlock on ' + (k.name || 'this key') + '?')) return; k.deadlock = null; commit(); },
    /* ghost / time traveler: strike a key out with a named irregularity or glitch */
    glitchpick: function (d) { var i = +d.i; cur.ui.glitchPick = cur.ui.glitchPick === i ? null : i; render(); },
    glitchcancel: function () { cur.ui.glitchPick = null; render(); },
    glitch: function (d) {
      var k = cur.play.keys[+d.i], pb = cur.pb; if (!k || k.glitch) return; var gname = glitchName(pb);
      if (!window.confirm('Strike out ' + (k.name || 'this key') + ' with the ' + gname.toLowerCase() + ' “' + d.v + '”? Hard mode: this is permanent.')) return;
      k.glitch = d.v; cur.ui.glitchPick = null;
      if (isTT(pb)) { cur.play.mission.details.push(''); var n = glitchCount(cur.play); note(n >= 4 ? 'Four glitches: you disappear after the next score' : gname + ' ' + n + ' / 4: note a new mission detail'); }
      else note(gname + ': ' + d.v);
      commit();
    },
    unglitch: function (d) { var k = cur.play.keys[+d.i]; if (!k) return; if (!window.confirm('GM override: clear the permanent ' + glitchName(cur.pb).toLowerCase() + ' “' + k.glitch + '” on ' + (k.name || 'this key') + '?')) return; k.glitch = null; commit(); },
    rmkey: function (d) { var k = cur.play.keys[+d.i]; if (!k) return; var struck = k.deadlock || k.glitch; if (struck && !window.confirm('This key is struck out. Remove it anyway?')) return; if (!struck && (k.name || k.hits) && !window.confirm('Remove the key ' + (k.name || '') + '?')) return; cur.play.keys.splice(+d.i, 1); if (cur.ui.glitchPick != null) cur.ui.glitchPick = null;
      var hs = cur.play.keyHitSession || {}, nh = {}, ri = +d.i; Object.keys(hs).forEach(function (x) { var j = +x; if (j < ri) nh[j] = hs[x]; else if (j > ri) nh[j - 1] = hs[x]; }); cur.play.keyHitSession = nh; /* indices follow the keys */
      commit(); },
    robo: function (d) { var a = cur.play.roboticDeadlocks, i = a.indexOf(d.v); if (i >= 0) { if (!window.confirm('GM override: clear the robotic deadlock ' + d.v + '?')) return; a.splice(i, 1); } else { if (!window.confirm('Mark the robotic deadlock ' + d.v + '? Hard mode: this is permanent.')) return; a.push(d.v); } commit(); },
    heal: function (d) { cur.play.healing = toggleTrack(cur.play.healing, +d.n); commit(); },
    armor: function (d) { cur.play.armor[d.k] = !cur.play.armor[d.k]; commit(); },
    resource: function (d) { cur.play.resource[+d.k] = !cur.play.resource[+d.k]; commit(); },
    coharm: function (d) { cur.play.cohort.harm = cur.play.cohort.harm === d.v ? null : d.v; commit(); },
    coarmor: function () { cur.play.cohort.armor = !cur.play.cohort.armor; commit(); },
    ability: function (d) {
      var p = cur.play, pb = cur.pb, name = d.n, i = +d.i, max = abilityMax(pb, name), owned = p.abilities.indexOf(name) >= 0, ticks = owned ? Math.max(1, p.abilityTicks[name] || 1) : 0;
      if (i === ticks + 1) {
        if (isTT(pb) && !owned && p.xp.playbook >= 8) return ACTIONS.clarity({ trait: name }); /* a full track means clarity, not a bare purchase */
        var dm = null; if (name === 'Dark Majesty' && !owned) { dm = askMajesty(); if (!dm) return; }
        if (!spendForAbility(name, ticks ? 'another circle of ' + name : name)) return;
        if (!owned) p.abilities.push(name); if (max > 1) p.abilityTicks[name] = ticks + 1;
        if (dm) p.darkMajesty = dm;
        if (isVamp(pb) && !owned && name !== 'Versatile') askStricture();
        commit();
      }
      else if (i === ticks) { if (!window.confirm(ticks > 1 ? 'Remove a circle from ' + name + '? (GM)' : 'Remove ' + name + '? (GM)')) return; if (ticks > 1) p.abilityTicks[name] = ticks - 1; else { p.abilities.splice(p.abilities.indexOf(name), 1); delete p.abilityTicks[name]; if (name === 'Dark Majesty') p.darkMajesty = null; } commit(); }
    },
    addability: function (d, n) { var inp = cur.root.querySelector('.ds-newab'); var v = inp && inp.value.trim(); if (!v) { if (inp) inp.focus(); return; } if (cur.play.abilities.indexOf(v) >= 0) return; if (!spendForAbility(v, 'the ability “' + v + '”')) return; cur.play.abilities.push(v); commit(); },
    rmability: function (d) { if (!window.confirm('Remove ' + d.n + '?')) return; var i = cur.play.abilities.indexOf(d.n); if (i >= 0) cur.play.abilities.splice(i, 1); commit(); },
    /* time traveler advancement: every step is asked before anything changes, so cancelling leaves play untouched */
    clarity: function (d) {
      var p = cur.play, pb = cur.pb; if (!isTT(pb)) return;
      var paid = p.xp.playbook >= 8;
      if (paid ? !window.confirm('Gain clarity: spend 8 playbook xp? You choose a new Time Traveler trait and a versatile ability from another playbook, take a temporal glitch, and note a new detail of your mission. Cancel at any step and nothing changes.')
               : !window.confirm('You have ' + p.xp.playbook + ' / 8 playbook xp. Gain clarity anyway (GM)?')) return;
      function cancelled() { note('Clarity cancelled: nothing changed'); }
      /* 1. a new Time Traveler trait */
      var traits = (pb.abilities || []).map(function (a) { return a[0]; }).filter(function (n) { return p.abilities.indexOf(n) < 0; }), trait = null;
      if (d && d.trait && traits.indexOf(d.trait) >= 0) trait = d.trait;
      else if (traits.length) {
        var tv = window.prompt('1 of 4 — Choose a new Time Traveler trait:\n' + numbered(traits), '1'); if (tv == null) return cancelled();
        var ti = pickIndex(traits, tv); if (ti < 0) { note('No such trait: nothing changed'); return; } trait = traits[ti];
      }
      /* 2. a versatile ability from another playbook */
      var vers = window.prompt('2 of 4 — A versatile ability from another playbook, reflecting your former life (name and rule text). Leave empty to skip.', ''); if (vers == null) return cancelled(); vers = vers.trim();
      /* 3. a temporal glitch on a key */
      var open = []; p.keys.forEach(function (k, i) { if (!k.glitch) open.push(i); }); var ki = null, gl = null;
      if (open.length) {
        var kv = window.prompt('3 of 4 — Take a temporal glitch. Strike out which key?\n' + numbered(open.map(function (i) { return p.keys[i].name || 'unnamed key'; })), '1'); if (kv == null) return cancelled();
        var kx = pickIndex(open.map(function (i) { return p.keys[i].name || 'unnamed key'; }), kv); if (kx < 0) { note('No such key: nothing changed'); return; } ki = open[kx];
        var used = p.keys.map(function (k) { return k.glitch; }).filter(Boolean), gls = glitchList(pb).filter(function (g) { return used.indexOf(g) < 0; });
        if (gls.length) { var gv = window.prompt('Which temporal glitch for ' + (p.keys[ki].name || 'that key') + '? Hard mode: permanent.\n' + numbered(gls), '1'); if (gv == null) return cancelled(); var gi = pickIndex(gls, gv); if (gi < 0) { note('No such glitch: nothing changed'); return; } gl = gls[gi]; }
        else { gl = window.prompt('Every listed glitch is taken. Name this one:', ''); if (gl == null) return cancelled(); gl = gl.trim() || 'Temporal glitch'; }
      }
      /* 4. a new detail of the mission */
      var det = window.prompt('4 of 4 — Note down a new detail of your mission.', ''); if (det == null) return cancelled();
      /* apply */
      if (paid) p.xp.playbook -= 8;
      if (trait) p.abilities.push(trait);
      if (vers && p.abilities.indexOf(vers) < 0) p.abilities.push(vers);
      if (ki != null) p.keys[ki].glitch = gl;
      if (!p.mission) p.mission = blankMission('', []);
      p.mission.details.push(det.trim());
      var n = glitchCount(p); note(n >= 4 ? 'Clarity gained; four glitches: you disappear after the next score' : 'Clarity gained' + (trait ? ': ' + trait : '')); commit();
    },
    adddetail: function () { if (!cur.play.mission) cur.play.mission = blankMission('', []); cur.play.mission.details.push(''); commit(); var ins = cur.root.querySelectorAll('.ds-detail .ds-in'); if (ins.length) ins[ins.length - 1].focus(); },
    rmdetail: function (d) { var m = cur.play.mission, i = +d.i; if (!m || !(i >= 0 && i < m.details.length)) return; if (m.details[i] && !window.confirm('Remove this mission detail?')) return; m.details.splice(i, 1); commit(); },
    frame: function (d) { var a = cur.play.frame, i = a.indexOf(d.n); if (i >= 0) { if (!window.confirm('Remove the frame feature ' + d.n + '?')) return; a.splice(i, 1); } else { if (!window.confirm('Add the frame feature ' + d.n + '? (Frame Upgrade grants two.)')) return; a.push(d.n); } commit(); },
    /* a track box spends from the bar; lowering a track puts the difference back */
    xp: function (d) { var k = d.k, max = k === 'playbook' ? 8 : 6, old = cur.play.xp[k] || 0, v = clamp(toggleTrack(old, +d.n), 0, max); if (!spendHold(v - old)) return; cur.play.xp[k] = v; if (cur.ui.advance === k && v < 6) cur.ui.advance = null; commit(); },
    xphold: function (d) { var p = cur.play, h = p.xpHold || 0, v = clamp(h + (+d.v < 0 ? -1 : 1), 0, 99); if (v === h) return; p.xpHold = v; note(v > h ? '+1 xp on the bar (' + v + ' to spend)' : '1 xp off the bar (' + v + ' to spend)'); commit(); },
    advance: function (d) { cur.ui.advance = d.k; render(); },
    advcancel: function () { cur.ui.advance = null; render(); },
    advdot: function (d) { var max = dotMax(cur.play, cur.pb, d.a); if ((cur.play.dots[d.a] || 0) >= max) return; cur.play.dots[d.a] = (cur.play.dots[d.a] || 0) + 1; cur.play.xp[d.k] = 0; cur.ui.advance = null; note(d.a + ' is now ' + cur.play.dots[d.a]); commit(); },
    dot: function (d) { var n = +d.n, max = dotMax(cur.play, cur.pb, d.a); if (n > max) return; cur.play.dots[d.a] = toggleTrack(cur.play.dots[d.a] || 0, n); commit(); },
    stacks: function (d) { cur.play.stacks = toggleTrack(cur.play.stacks, +d.n); commit(); },
    bank: function (d) { cur.play.bank = toggleTrack(cur.play.bank, +d.n); commit(); },
    tobank: function () { if (cur.play.stacks > 0 && cur.play.bank < 40) { cur.play.stacks--; cur.play.bank++; commit(); } },
    frombank: function () { if (cur.play.bank > 0 && cur.play.stacks < 4) { cur.play.bank--; cur.play.stacks++; commit(); } },
    item: function (d) { var a = cur.play.items, i = a.indexOf(d.n); if (i >= 0) a.splice(i, 1); else a.push(d.n); commit(); },
    limit: function (d) { cur.play.loadLimit = d.v === 'loud' ? 'loud' : 'quiet'; commit(); },
    additem: function () { var ni = cur.root.querySelector('.ds-newitem'), nl = cur.root.querySelector('.ds-newload'); var v = ni && ni.value.trim(); if (!v) { if (ni) ni.focus(); return; } if (itemLoad(cur.play, cur.pb, v) || (cur.pb && cur.pb.items.concat(CT.STANDARD_ITEMS).some(function (x) { return x[0] === v; }))) { note('That item is already on the list'); return; } cur.play.extraItems.push({ name: v, load: clamp(nl ? nl.value : 1, 0, 6) }); if (cur.play.items.indexOf(v) < 0) cur.play.items.push(v); commit(); },
    rmitem: function (d) { cur.play.extraItems = cur.play.extraItems.filter(function (x) { return x.name !== d.n; }); var i = cur.play.items.indexOf(d.n); if (i >= 0) cur.play.items.splice(i, 1); commit(); },
    contact: function (d) { var c = cur.play.contacts[+d.i]; if (!c) return; c.kind = !c.kind ? 'friend' : c.kind === 'friend' ? 'rival' : null; commit(); },
    rmcontact: function (d) { var c = cur.play.contacts[+d.i]; if (!c) return; if (!window.confirm('Remove ' + c.name + '?')) return; cur.play.contacts.splice(+d.i, 1); commit(); },
    addcontact: function () { var n = cur.root.querySelector('.ds-newcname'), r = cur.root.querySelector('.ds-newcrole'); var v = n && n.value.trim(); if (!v) { if (n) n.focus(); return; } cur.play.contacts.push({ name: v, role: r ? r.value.trim() : '', kind: 'friend' }); commit(); },
    clock: function (d) { var c = cur.play.clocks[+d.i]; if (!c) return; c.filled = toggleTrack(c.filled, +d.n); commit(); },
    rmclock: function (d) { var c = cur.play.clocks[+d.i]; if (!c) return; if ((c.name || c.filled) && !window.confirm('Remove the clock ' + (c.name || '') + '?')) return; cur.play.clocks.splice(+d.i, 1); commit(); },
    addclock: function (d) { var n = cur.root.querySelector('.ds-newclock'); cur.play.clocks.push({ name: n ? n.value.trim() : '', size: +d.n || 4, filled: 0 }); commit(); },
    memory: function (d) { var m = cur.play.memories[+d.i]; if (!m) return; var old = m.filled || 0, v = clamp(toggleTrack(old, +d.n), 0, m.size || 8); if (!spendHold(v - old)) return; m.filled = v; commit(); },
    suspicion: function (d) { cur.play.suspicion = toggleTrack(cur.play.suspicion, +d.n); commit(); },
    log: function () { var n = cur.root.querySelector('.ds-newlog'); var v = n && n.value.trim(); if (!v) { if (n) n.focus(); return; } addLog(cur.play, { at: new Date().toISOString(), kind: 'note', text: v }); commit(); },
    rmlog: function (d) { if (!window.confirm('Remove this log entry?')) return; cur.play.log.splice(+d.i, 1); commit(); },
    /* ---- dice (round 4): the roll panel. Every control here carries data-always, so a read-only viewer can roll; nothing is written for them. ---- */
    /* an action opens the mark strip (physical dice); the Resist chip opens the resist helper; the in-app rolls sit behind "Roll in the app" */
    rollopen: function (d) { var m = cur.ui.mark; if (m && m.action === d.a) { cur.ui.mark = null; render(); return; } closePanels(); cur.ui.mark = { action: d.a, push: false, assist: false, bargain: false, resist: null }; cur.ui.rollScroll = true; render(); },
    resistopen: function (d) { var m = cur.ui.mark; if (m && !m.action && m.resist && m.resist.attr === d.attr) { cur.ui.mark = null; render(); return; } closePanels(); cur.ui.mark = { action: null, resist: { attr: d.attr, result: null } }; cur.ui.rollScroll = true; render(); },
    fortopen: function () { var r = cur.ui.roll; if (r && r.kind === 'fortune') { cur.ui.roll = null; render(); return; } closePanels(); cur.ui.roll = { kind: 'fortune', n: 2, result: null }; cur.ui.rollScroll = true; render(); },
    rollclose: function () { cur.ui.roll = null; render(); },
    abstrip: function () { cur.ui.abStrip = !cur.ui.abStrip; cur.ui.abScroll = cur.ui.abStrip; render(); },
    abitem: function (d) { var o = cur.ui.abOpen || (cur.ui.abOpen = {}); if (o[d.k]) delete o[d.k]; else o[d.k] = true; render(); },
    rollopt: function (d) { var r = cur.ui.roll; if (!r || r.kind !== 'action' || r.result) return; if (r.paid && r.paid[d.k]) return; if (d.k === 'push' && !r.push && cur.play.stress + 2 > stressMax(cur.pb)) return; r[d.k] = !r[d.k]; r.result = null; render(); },
    /* after a roll its options are locked: the verdict stands for what was rolled */
    rollpos: function (d) { var r = cur.ui.roll; if (!r || r.kind !== 'action' || r.result || POSITIONS.indexOf(d.v) < 0) return; r.position = d.v; render(); },
    rolleff: function (d) { var r = cur.ui.roll; if (!r || r.kind !== 'action' || r.result || EFFECTS.indexOf(d.v) < 0) return; r.effect = d.v; render(); },
    fortn: function (d) { var r = cur.ui.roll; if (!r || r.kind !== 'fortune') return; r.n = clamp(d.n, 0, 6); r.result = null; render(); },
    roll: function () {
      var r = cur.ui.roll, p = cur.play, pb = cur.pb; if (!r) return;
      var ro = noSave(), res;
      if (r.kind === 'action') {
        var dots = p.dots[r.action] || 0, attr = attrOf(r.action) || '', key = attr.toLowerCase(), sm = stressMax(pb), sn = stressName(pb);
        if (r.push && p.stress + 2 > sm) { r.push = false; note('Cannot push: ' + sn + ' would pass ' + sm); render(); return; }
        res = rollDice(dots + (r.push ? 1 : 0) + (r.assist ? 1 : 0) + (r.bargain ? 1 : 0));
        var flags = []; if (r.push) flags.push('push'); if (r.assist) flags.push('assist'); if (r.bargain) flags.push('bargain');
        res.text = r.action + ' ' + res.n + 'd' + (flags.length ? ' (' + flags.join(', ') + ')' : res.low ? ' (2d take lowest)' : '') + ' · ' + r.position + ' · ' + res.dice.join(',') + ' → ' + res.reading;
        /* consequences: listed first, written only when the sheet can be saved */
        var plan = [];
        /* a push marked in the strip is paid already, for this first roll; a roll after it pays again */
        if (r.push && !(r.paid && r.paid.push)) plan.push({ text: '+2 ' + sn, run: function () { p.stress = clamp(p.stress + 2, 0, sm); return '+2 ' + sn + ' (' + p.stress + ' / ' + sm + ')'; } });
        if (r.paid) r.paid.push = false;
        /* desperate, zero-dot (the action's own rating, whatever dice were added), or both: xp on the bar */
        var why = []; if (r.position === 'desperate') why.push('desperate'); if (!dots) why.push('zero-dot');
        var earn = why.length; if (earn) plan.push({ text: '+' + earn + ' xp to the bar (' + why.join(', ') + ')', run: function () { p.xpHold = clamp((p.xpHold || 0) + earn, 0, 99); return '+' + earn + ' xp on the bar (' + p.xpHold + ' to spend)'; } });
        res.saved = !ro; res.savedWhy = ro ? notSavedWhy() : '';
        res.applied = plan.map(function (x) { return ro ? x.text : x.run(); });
      } else if (r.kind === 'resist') {
        res = rollDice(resistDice(p, pb, r.attr)); res.applied = null; res.saved = false;
      } else {
        res = rollDice(r.n);
        res.text = 'Fortune ' + res.n + 'd' + (res.low ? ' (2d take lowest)' : '') + ' · ' + res.dice.join(',') + ' → ' + res.reading;
        res.saved = !ro; res.savedWhy = ro ? notSavedWhy() : ''; res.applied = [];
      }
      r.result = res; cur.ui.rollScroll = 'res';   /* the verdict comes into view, wherever the panel sits */
      if (res.text && !ro) { addLog(p, { at: new Date().toISOString(), kind: 'roll', text: res.text }); commit(); } else render();
    },
    /* ---- sessions (round 5) ---- */
    sessstart: function () { if (tableNow()) return; startSession((cur.play.session || 0) + 1); },
    /* the table is ahead of this sheet: catch up to its session with the same start */
    sessjoin: function () { var t = tableNow(); if (!t || t.session <= (cur.play.session || 0)) return; startSession(t.session); },
    endopen: function () {
      if (cur.ui.endSess) { cur.ui.endSess = null; render(); return; }
      if (tableNow() && !endNo(cur.play)) return; /* nothing has started at the table */
      closePanels(); cur.ui.endSess = { vals: sessionTriggers(cur.play, cur.pb).map(function () { return 0; }), result: null }; cur.ui.rollScroll = true; render();
    },
    endval: function (d) { var e = cur.ui.endSess, i = +d.i; if (!e || e.result || !(i >= 0 && i < e.vals.length)) return; e.vals[i] = clamp(d.v, 0, 2); render(); },
    endmark: function () {
      var e = cur.ui.endSess, p = cur.play, pb = cur.pb; if (!e || e.result || noSave()) return;
      var plan = endPlan(p, pb, e), n = endNo(p), trig = sessionTriggers(p, pb), lines = [], hits = Object.keys(p.keyHitSession || {}).length;
      if (n !== (p.session || 0)) p.session = n; /* the table's session is the one that ended */
      p.xpHold = plan.after; lines.push('+' + plan.total + ' xp on the bar (' + p.xpHold + ' to spend)');
      p.keyHitSession = {}; if (hits) lines.push('key hits cleared');
      var names = []; e.vals.forEach(function (v, i) { if (v && trig[i]) names.push(trigLabel(trig[i]) + (v === 2 ? ' ×2' : '')); });
      var text = 'Session ' + n + ' ended: +' + plan.total + ' xp' + (names.length ? ' (' + names.join('; ') + ')' : '');
      addLog(p, { at: new Date().toISOString(), kind: 'note', text: text });
      e.result = { lines: lines };
      note('Session ' + n + ' ended'); commit();
    },
    panelclose: function () { closePanels(); render(); },
    /* ---- downtime (round 5): rolls stay live for read-only viewers, who get "not saved" and no writes ---- */
    dtopen: function (d) {
      var k = d.k, p = cur.play, pb = cur.pb; if (!DT_NAMES[k]) return;
      if ((k === 'indulge' && !coreVice(pb)) || (k === 'recover' && isVamp(pb))) return;
      if (cur.ui.dt && cur.ui.dt.kind === k) { cur.ui.dt = null; render(); return; }
      closePanels();
      var open = -1; p.clocks.forEach(function (c, i) { if (open < 0 && c.filled < c.size) open = i; });
      var def = k === 'project' ? 'Study' : 'Tinker';
      cur.ui.dt = { kind: k, who: 'self', action: ACTS.indexOf(def) >= 0 ? def : ACTS[0], n: 2, clock: open >= 0 ? open : 'new', newName: '', size: 8, result: null };
      cur.ui.rollScroll = true; render();
    },
    dtopt: function (d) {
      var t = cur.ui.dt; if (!t) return; var k = d.k, v = d.v;
      if (k === 'who') t.who = v === 'healer' ? 'healer' : 'self';
      else if (k === 'action') { if (ACTS.indexOf(v) < 0) return; t.action = v; }
      else if (k === 'n') t.n = clamp(v, 0, 4);
      else if (k === 'clock') { if (v === 'new') t.clock = 'new'; else if (+v >= 0 && +v < cur.play.clocks.length) t.clock = +v; else return; }
      else if (k === 'size') { if ([4, 6, 8].indexOf(+v) < 0) return; t.size = +v; }
      else return;
      t.result = null; render();
    },
    dtroll: function () {
      var t = cur.ui.dt, p = cur.play, pb = cur.pb; if (!t || t.kind === 'train') return;
      if ((t.kind === 'indulge' && !coreVice(pb)) || (t.kind === 'recover' && isVamp(pb))) return;
      var c = null, newClock = t.kind === 'project' && t.clock === 'new';
      if (t.kind === 'project') { c = newClock ? { name: String(t.newName || '').trim() || 'Long-term project', size: t.size || 8, filled: 0 } : p.clocks[+t.clock]; if (!c) { note('Choose a clock'); return; } if (c.filled >= c.size) { note('That clock is complete'); return; } }
      var ro = noSave(), res = rollDice(dtDice(p, pb, t)), dice = res.dice.join(','), nd = res.n + 'd' + (res.low ? ' (2d take lowest)' : ''), applied = [], apply;
      if (t.kind === 'indulge') {
        var sn = stressName(pb), clear = res.value, before = p.stress, after = Math.max(0, before - clear);
        res.over = clear > before; res.cls = res.over ? 'failure' : 'success';
        res.big = 'Clear ' + clear; res.why = (res.low ? 'lowest ' : 'highest die ') + res.value + ' · ' + sn + ' ' + before + ' → ' + after + (res.over ? ': more than you had' : '');
        res.text = 'Indulge vice ' + nd + ' · ' + dice + ' → clear ' + clear + ' ' + sn + (res.over ? ', overindulge' : '') + ' (' + before + ' → ' + after + ')';
        applied.push('−' + (before - after) + ' ' + sn + ' (' + after + ' / ' + stressMax(pb) + ')'); if (res.over) applied.push('overindulged: tell the GM');
        apply = function () { p.stress = after; };
      } else if (t.kind === 'recover') {
        var ticks = ticksFor(res), h0 = p.healing || 0, total = h0 + ticks, fills = 0, hm = p.harm, cn = isHull(pb) ? 'repair' : 'healing';
        while (total >= 4) { total -= 4; fills++; hm = stepHarm(hm); }
        var who = t.who === 'healer' ? (isHull(pb) ? 'a mechanic' : 'a healer') : t.action;
        res.big = '+' + ticks + ' tick' + (ticks === 1 ? '' : 's'); res.cls = res.reading;
        res.why = capWord(res.reading) + ' · ' + cn + ' ' + h0 + ' → ' + total + ' / 4' + (fills ? ' · the clock filled' + (fills > 1 ? ' ' + fills + ' times' : '') + ': every harm steps down a level' : '');
        res.text = dtName('recover', pb) + ' (' + who + ') ' + nd + ' · ' + dice + ' → ' + res.reading + ', +' + ticks + ' ' + cn + (fills ? ', clock filled: harm steps down' : '') + ' (' + total + ' / 4)';
        applied.push('+' + ticks + ' ' + cn + ' (' + total + ' / 4)'); if (fills) applied.push('harm stepped down' + (fills > 1 ? ' ×' + fills : ''));
        apply = function () { p.healing = total; if (fills) p.harm = hm; };
      } else {
        var tk = ticksFor(res), f1 = Math.min(c.size, c.filled + tk), done = f1 >= c.size;
        res.big = '+' + tk + ' tick' + (tk === 1 ? '' : 's'); res.cls = res.reading;
        res.why = capWord(res.reading) + ' · ' + c.name + ' ' + c.filled + ' → ' + f1 + ' / ' + c.size + (done ? ': complete' : '');
        res.text = 'Long-term project “' + c.name + '” (' + t.action + ') ' + nd + ' · ' + dice + ' → ' + res.reading + ', +' + tk + ' (' + f1 + ' / ' + c.size + ')' + (done ? ', complete' : '');
        applied.push((newClock ? 'new clock ' : '') + '“' + c.name + '” ' + f1 + ' / ' + c.size + (done ? ' — complete' : ''));
        apply = function () {
          var nc = Object.assign({}, c, { filled: f1 });
          if (newClock) { p.clocks = p.clocks.concat([nc]); t.clock = p.clocks.length - 1; t.newName = ''; }
          else { var ci = +t.clock; p.clocks = p.clocks.map(function (x, i) { return i === ci ? nc : x; }); }
        };
      }
      res.saved = !ro; res.savedWhy = ro ? notSavedWhy() : ''; res.applied = applied; t.result = res;
      if (!ro) { apply(); addLog(p, { at: new Date().toISOString(), kind: 'roll', text: res.text }); commit(); } else render();
    },
    dttrain: function () {
      var t = cur.ui.dt, p = cur.play; if (!t || t.kind !== 'train' || noSave()) return;
      if (p.trainedThisDowntime) { note('Already trained this downtime'); render(); return; }
      p.xpHold = clamp((p.xpHold || 0) + 1, 0, 99); p.trainedThisDowntime = true;
      t.result = { saved: true, applied: ['+1 xp on the bar (' + p.xpHold + ' to spend)'] };
      addLog(p, { at: new Date().toISOString(), kind: 'roll', text: 'Train · +1 xp on the bar' });
      commit();
    },
    resistapply: function () {
      var r = cur.ui.roll; if (!r || r.kind !== 'resist' || !r.result || r.result.applied) return;
      applyResist(r.attr, r.result); cur.ui.rollScroll = 'res'; commit();
    },
    /* ---- the mark strip (physical dice) ---- */
    rollapp: function (d) {
      var m = cur.ui.mark, from = m && m.action === d.a ? m : null; closePanels();
      cur.ui.roll = { kind: 'action', action: d.a, push: !!(from && from.push), assist: !!(from && from.assist), bargain: !!(from && from.bargain), paid: { push: !!(from && from.push) }, position: 'risky', effect: 'standard', result: null };
      cur.ui.rollScroll = true; render();
    },
    resistapp: function (d) { closePanels(); cur.ui.roll = { kind: 'resist', attr: d.attr, result: null }; cur.ui.rollScroll = true; render(); },
    /* Push marks its 2 stress as it is tapped (and gives it back when untapped); Assist and a Devil's Bargain add a die and
       cost this sheet nothing (the crewmate who assists marks their own stress) */
    markopt: function (d) {
      var m = cur.ui.mark, p = cur.play, pb = cur.pb; if (!m || !m.action) return;
      var k = d.k, sn = stressName(pb), sm = stressMax(pb), on = !m[k];
      if (k === 'push') { if (on && p.stress + 2 > sm) { note('Cannot push: ' + sn + ' would pass ' + sm); return; } p.stress = clamp(p.stress + (on ? 2 : -2), 0, sm); }
      else if (k !== 'assist' && k !== 'bargain') return;
      m[k] = on;
      if (k === 'push') commit(); else render();
    },
    /* Harm N: the first empty line of that level, scrolled into view and focused for typing. A full level moves the harm up a
       level, as the rules do. On a phone the strip (a bottom sheet) closes first, so it never sits over the line being typed. */
    markharm: function (d) {
      var l = clamp(d.l, 1, 4), lv = { 1: ['harm.l1.0', 'harm.l1.1'], 2: ['harm.l2.0', 'harm.l2.1'], 3: ['harm.l3'], 4: ['harm.l4'] };
      var empty = function (s) { var v = getPath(cur.play, s); return !String(v == null ? '' : v).trim(); };
      var at = l; while (at < 4 && !lv[at].some(empty)) at++;
      if (!lv[at].some(empty)) at = l;
      var path = lv[at].filter(empty)[0] || lv[at][0], panel = cur.root.querySelector('.ds-mark'), sheet = false;
      try { sheet = !!panel && getComputedStyle(panel).position === 'fixed'; } catch (e) {}
      if (sheet) { cur.ui.mark = null; render(); }
      var target = cur.root.querySelector('[data-path="' + path + '"]'), boxEl = cur.root.querySelector('.ds-harmbox');
      if (!target) return;
      try { (boxEl || target).scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (e) {}
      try { target.focus({ preventScroll: true }); } catch (e) {}
      if (at !== l) note('Level ' + l + ' is full: the harm moves up to level ' + at);
    },
    markresist: function () { var m = cur.ui.mark; if (!m || !m.action) return; m.resist = m.resist ? null : { attr: attrOf(m.action) || ATTRS[0], result: null }; render(); },
    markrattr: function (d) { var m = cur.ui.mark; if (!m || !m.resist || m.resist.result || ATTRS.indexOf(d.v) < 0) return; m.resist.attr = d.v; render(); },
    /* the highest die (the lowest with 0 dice), or two sixes: the same reading and cost as the in-app roll, applied and logged */
    markrdie: function (d) {
      var m = cur.ui.mark, p = cur.play, pb = cur.pb; if (!m || !m.resist || m.resist.result || noSave()) return;
      var n = resistDice(p, pb, m.resist.attr), low = n === 0, res;
      if (d.v === 'crit') { if (low) return; res = { n: n, dice: [6, 6], value: 6, crit: true, low: false, reading: 'critical' }; }
      else { var v = clamp(d.v, 1, 6); if (v !== +d.v) return; res = { n: n, dice: [v], value: v, crit: false, low: low, reading: v === 6 ? 'success' : v >= 4 ? 'partial' : 'failure' }; }
      applyResist(m.resist.attr, res); m.resist.result = res; commit();
    },
    markrdone: function () { var m = cur.ui.mark; if (!m) return; if (m.action) m.resist = null; else cur.ui.mark = null; render(); }
  };
  /* a new session on this sheet (Start session, or Join the table's): clears the downtime and per-session flags, logs it */
  function startSession(n) {
    var p = cur.play;
    p.session = n; p.trainedThisDowntime = false;
    if (Object.keys(p.keyHitSession || {}).length) p.keyHitSession = {};
    addLog(p, { at: new Date().toISOString(), kind: 'note', text: 'Session ' + n + ' started' });
    cur.ui.endSess = null; if (cur.ui.dt && cur.ui.dt.kind === 'train') cur.ui.dt.result = null;
    note('Session ' + n + ' started'); commit();
  }
  /* roll-panel controls stay live for read-only viewers (they write nothing); everything else is gated */
  var RO_OK = { back: 1, tablescreen: 1, missionscreen: 1, view: 1, print: 1, rollopen: 1, resistopen: 1, fortopen: 1, rollclose: 1, abstrip: 1, abitem: 1, rollopt: 1, rollpos: 1, rolleff: 1, fortn: 1, roll: 1, panelclose: 1, dtopen: 1, dtopt: 1, dtroll: 1, rollapp: 1, resistapp: 1, markharm: 1, markresist: 1, markrattr: 1, markrdone: 1, more: 1, about: 1, loadout: 1, jump: 1 };
  /* one panel at a time: the mark strip, a roll, a downtime activity or the end of session */
  function anyPanel() { return !!(cur && (cur.ui.mark || cur.ui.roll || cur.ui.dt || cur.ui.endSess)); }
  function closePanels() { if (!cur) return; cur.ui.mark = null; cur.ui.roll = null; cur.ui.dt = null; cur.ui.endSess = null; }
  var CHANGES = {
    addkey: function (sel) { var v = sel.value; sel.value = ''; if (!v || cur.play.keys.length >= 4) return; var k = v === '*' ? { name: '', down: '', up: '' } : keyParts(v); k.hits = 0; k.deadlock = null; k.glitch = null; cur.play.keys.push(k); commit(); if (v === '*') { var last = cur.root.querySelectorAll('.ds-key-name'); if (last.length) last[last.length - 1].focus(); } },
    mastery: function (inp) { cur.play.mastery = !!inp.checked; commit(); },
    vice: function (sel) { cur.play.vice = sel.value; commit(); },
    stricture: function (inp) { var n = inp.dataset.n, a = cur.play.strictures, i = a.indexOf(n); if (n === 'Dayfire') { inp.checked = true; return; } if (inp.checked) { if (i < 0) a.push(n); } else if (i >= 0) a.splice(i, 1); commit(); },
    mission: function (sel) { var v = sel.value; if (!v) return; if (!cur.play.mission) cur.play.mission = blankMission('', []); cur.play.mission.name = v; commit(); }
  };
  function onClick(e) {
    if (!cur) return; var t = e.target && e.target.closest ? e.target.closest('[data-act]') : null; if (!t || !cur.root.contains(t)) return;
    if (t.disabled) return; var act = t.getAttribute('data-act'); var fn = ACTIONS[act]; if (!fn) return;
    if (readOnly() && !RO_OK[act]) return;
    var d = {}; for (var i = 0; i < t.attributes.length; i++) { var a = t.attributes[i]; if (a.name.indexOf('data-') === 0) d[a.name.slice(5)] = a.value; }
    var menu = act !== 'more' && cur.ui.more; if (menu) cur.ui.more = false;   /* any other control (a menu item too) closes "…" */
    try { fn(d, t); } catch (err) { setStatus('Something went wrong: ' + err.message, true); if (window.console) console.error(err); }
    if (menu && cur && cur.root.querySelector('.ds-menu')) render();
  }
  /* a tap anywhere outside "…" closes it */
  function onDocClick(e) { if (!cur || !cur.ui.more) return; var t = e.target; if (t && t.closest && t.closest('.ds-more')) return; cur.ui.more = false; render(); }
  function onInput(e) {
    if (!cur) return; var t = e.target;
    if (t && t.dataset && t.dataset.ui === 'dtname' && cur.ui.dt) { cur.ui.dt.newName = t.value; return; } /* the downtime panel's new-clock name: panel state, never saved by itself */
    if (readOnly()) return; if (!t || !t.dataset || !t.dataset.path || !cur.root.contains(t)) return;
    setPath(cur.play, t.dataset.path, t.value); scheduleSave(); syncTyped(t);
    /* a harm line is typed, not tapped: the vitals' Harm count follows it without redrawing the sheet around the field */
    if (t.dataset.path.indexOf('harm.') === 0) { var vs = cur.slots && cur.slots.vitals; if (vs) { var vh = vitals(cur.play, cur.pb), ro = readOnly() ? '1' : '0'; fillSlot(vs, vh, ro); vs.last = ro + vh; } }
  }
  function onChange(e) {
    if (!cur) return; var t = e.target; if (!t || !cur.root.contains(t)) return;
    if (t.dataset && t.dataset.change && CHANGES[t.dataset.change]) { if (readOnly()) return; try { CHANGES[t.dataset.change](t); } catch (err) { setStatus('Something went wrong: ' + err.message, true); } return; }
    if (t.dataset && t.dataset.path && cur.timer) { clearTimeout(cur.timer); cur.timer = null; flushSave(); }
  }
  function onDocKey(e) {
    if (!cur || (e.key !== 'Escape' && e.key !== 'Esc')) return;
    if (mv) { closeMissionScreen(); return; }
    if (tv) { closeTableScreen(); return; }
    if (cur.ui.more) { cur.ui.more = false; render(); var mb = cur.root.querySelector('.ds-morebtn'); if (mb) try { mb.focus({ preventScroll: true }); } catch (x) {} return; }
    if (!anyPanel()) return; closePanels(); render();
  }
  function onKey(e) { if (!cur || e.key !== 'Enter') return; var t = e.target; if (!t || t.tagName !== 'INPUT' || !cur.root.contains(t)) return; var map = { 'ds-newlog': 'log', 'ds-newclock': 'addclock', 'ds-newcname': 'addcontact', 'ds-newcrole': 'addcontact', 'ds-newitem': 'additem', 'ds-newab': 'addability' }; var cls = Object.keys(map).filter(function (c) { return t.classList.contains(c); })[0]; if (!cls) return; e.preventDefault(); if (readOnly()) return; ACTIONS[map[cls]]({ n: 4 }, t); }

  /* the small figure at the top right of the printed sheet exists only while printing, so the big SVG is never in the DOM twice */
  /* a phone never drew the figure: it is drawn here, once, for the page that prints */
  function printFigure(on) { if (!cur || cur.ui.static) return; var f = cur.root.querySelector('.ds-printfig'); if (!f) return; if (on) figureSvg(cur.doc); f.innerHTML = on ? (cur.ui.svg || '') : ''; }
  if (window.addEventListener) { window.addEventListener('beforeprint', function () { printing = true; printFigure(true); }); window.addEventListener('afterprint', function () { printing = false; printFigure(false); }); }

  /* ---------- the table screen (MM1, design 2.4) ----------
     api.screen (boot.js, from the hosted runtime's window.claude.table) is { seq(), load(), on(cb) }, or null where the runtime has none (then
     there is no Table button). seq() is the display's seq while the iPad shows a map or a handout and the GM's mirror is on, else 0: the data
     poll brings it and nothing here polls. The button carries a dot while seq() is something this phone has not looked at. The viewer is a
     full-screen layer on the page body, outside the sheet, so a redraw of the sheet never touches it. The picture is an <img> (a blob URL for a
     map, so it cannot run script; the static handout path for a handout), the zoom is the browser's own pinch-zoom, and × closes it. It asks
     the server again only when seq() moves while it is open. Everything the server sends is put in as text. */
  var SEEN_KEY = 'b68.table.seen', HANDOUT_DIR = 'media/handouts/', HANDOUT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,78}\.(?:png|jpe?g|gif|webp|svg)$/i;
  var tv = null, tvSeen = null;
  function screenApi() { var a = cur && cur.api && cur.api.screen; return a && typeof a.seq === 'function' && typeof a.load === 'function' ? a : null; }
  function seenSeq() { if (tvSeen === null) { try { tvSeen = Math.max(0, Math.floor(+localStorage.getItem(SEEN_KEY) || 0)); } catch (e) { tvSeen = 0; } } return tvSeen; }
  function setSeen(n) { tvSeen = Math.max(0, Math.floor(+n || 0)); try { localStorage.setItem(SEEN_KEY, String(tvSeen)); } catch (e) {} }
  function screenNew() { var sc = screenApi(); if (!sc) return false; var s = 0; try { s = Math.floor(+sc.seq() || 0); } catch (e) {} return s > 0 && s !== seenSeq(); }
  function tableButtonBody(nw) { return 'Table' + (nw ? '<span class="ds-tdot" aria-hidden="true"></span>' : ''); }
  function tableButton() {
    if (!screenApi()) return '';
    var nw = screenNew();
    return '<button type="button" class="btn sm ds-tablebtn' + (nw ? ' new' : '') + '" data-act="tablescreen" data-always="1" aria-haspopup="dialog" aria-label="' + (nw ? 'Table screen, changed' : 'Table screen') +
      '" title="What the iPad is showing, when it is a map or a handout">' + tableButtonBody(nw) + '</button>';
  }
  /* the dot alone: the button's contents are replaced, the sheet is not redrawn */
  function refreshTableDot() {
    if (!cur || !cur.root) return; var b = cur.root.querySelector('.ds-tablebtn'); if (!b) return;
    var nw = screenNew();
    b.classList.toggle('new', nw); b.setAttribute('aria-label', nw ? 'Table screen, changed' : 'Table screen'); b.innerHTML = tableButtonBody(nw);
  }
  function onScreenSeq() { if (!cur) return; refreshTableDot(); if (tv) loadTableScreen(); }
  function closeTableScreen(restore) {
    if (!tv) return; var v = tv; tv = null;
    if (v.url) { try { URL.revokeObjectURL(v.url); } catch (e) {} }
    if (v.el.parentNode) v.el.parentNode.removeChild(v.el);
    /* the sheet may have redrawn its head since: focus goes to the button that is there now */
    var back = (cur && cur.root && cur.root.querySelector && cur.root.querySelector('.ds-tablebtn')) || v.from;
    if (restore !== false && back && back.focus && document.body.contains(back)) { try { back.focus({ preventScroll: true }); } catch (e) {} }
    if (restore !== false && cur) missionSync();   /* a card that changed under the viewer opens now */
  }
  function openTableScreen(from) {
    var sc = screenApi(); if (!sc || tv) return;
    var el = document.createElement('div'); el.className = 'ds-tv'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'The table screen');
    el.innerHTML = '<div class="ds-tv-top"><button type="button" class="ds-tv-x" aria-label="Close the table screen">×</button><span class="ds-tv-h">The table screen</span></div>' +
      '<div class="ds-tv-stage" aria-live="polite"></div><p class="ds-tv-cap" hidden></p>';
    var x = el.querySelector('.ds-tv-x'); x.addEventListener('click', function () { closeTableScreen(); });
    tv = { el: el, stage: el.querySelector('.ds-tv-stage'), cap: el.querySelector('.ds-tv-cap'), from: from || null, url: '', token: 0 };
    document.body.appendChild(el);
    try { x.focus({ preventScroll: true }); } catch (e) {}
    try { setSeen(sc.seq()); } catch (e) {}   /* looking now: the dot goes */
    refreshTableDot();
    loadTableScreen();
  }
  function tableMessage(v, text, retry) {
    v.stage.textContent = ''; v.cap.hidden = true; v.cap.textContent = '';
    var p = document.createElement('p'); p.className = 'ds-tv-none'; p.textContent = text; v.stage.appendChild(p);
    if (retry) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm ds-tv-retry'; b.textContent = 'Try again'; b.addEventListener('click', function () { if (tv === v) loadTableScreen(); }); v.stage.appendChild(b); }
  }
  function loadTableScreen() {
    var sc = screenApi(), v = tv; if (!sc || !v) return;
    var token = ++v.token;
    var p; try { p = sc.load(); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function (r) { if (tv === v && token === v.token) showTableScreen(v, r); }, function (e) {
      if (tv === v && token === v.token) tableMessage(v, e && e.network ? 'No signal. Try again when you are back online.' : 'Could not load the table screen.', true);
    });
  }
  function showTableScreen(v, r) {
    r = r && typeof r === 'object' ? r : {};
    if (Number.isInteger(r.seq) && r.seq > 0) { setSeen(r.seq); refreshTableDot(); }   /* looked at, whatever the answer: a refused screen leaves no dot behind */
    if (v.url) { try { URL.revokeObjectURL(v.url); } catch (e) {} v.url = ''; }
    var src = '';
    if (r.kind === 'svg' && typeof r.svg === 'string' && /^<svg[\s>\/]/i.test(r.svg)) {
      var s = r.svg, head = /^<svg[^>]*>/i.exec(s);
      if (head && !/\sxmlns\s*=/i.test(head[0])) s = s.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');   /* an <img> needs the namespace */
      try { v.url = URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' })); src = v.url; } catch (e) { src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s); }
    } else if (r.kind === 'handout' && typeof r.file === 'string' && HANDOUT_RE.test(r.file) && r.file.indexOf('..') < 0) {
      src = HANDOUT_DIR + encodeURIComponent(r.file);
    }
    if (!src) { tableMessage(v, 'Nothing on the table screen right now. When the iPad shows a map or a handout, it appears here.', false); return; }
    var title = typeof r.title === 'string' ? r.title : '', cap = typeof r.caption === 'string' ? r.caption : '';
    v.stage.textContent = '';
    var img = document.createElement('img'); img.className = 'ds-tv-img'; img.alt = title || 'The table screen'; img.decoding = 'async'; img.draggable = false;
    img.onerror = function () { if (tv === v) tableMessage(v, 'This picture could not be loaded.', true); };
    img.src = src; v.stage.appendChild(img);
    v.cap.textContent = '';
    if (title) { var b = document.createElement('b'); b.textContent = title; v.cap.appendChild(b); }
    if (cap) { if (title) v.cap.appendChild(document.createTextNode(' · ')); v.cap.appendChild(document.createTextNode(cap)); }
    v.cap.hidden = !(title || cap);
  }

  /* ---------- the mission card (VV7, design 5.4) ----------
     api.mission() (boot.js) is { time, now, pcs: [{ id, name, card }] } for the characters THIS player owns that have a card in the campaign
     document's mission, or null (then there is no Mission button). The page holds that document already and hears its poke, so nothing here
     asks for anything: boot calls T.refresh() when the document moves. When a card of theirs differs from the one they last opened (a hash
     per character in localStorage; nothing for changes elsewhere in the mission) the card opens by itself, on the sheet or on entering it;
     the dot on the button (and in the switcher) is for a card that changed while another layer was open over it. The viewer is a full-screen layer
     on the page body like the Table viewer, redrawn in place when the document moves. It is not a feed: no sound, no vibration, no animation,
     no live region. Everything the document holds is put in as text. */
  var MSEEN_KEY = 'b68.mission.seen', mv = null, mSeen = null;
  var mAsk = {}, mAskT = null;   /* the Move row's pending ask per character { room, at }, and the one timer that drops it */
  function missionData() {
    var f = cur && cur.api && cur.api.mission; if (typeof f !== 'function') return null;
    var m = null; try { m = f(); } catch (e) { m = null; }
    return m && Array.isArray(m.pcs) && m.pcs.length ? m : null;
  }
  /* the dot's fingerprint is the card's STABLE fields: inMin counts down every beat, so a publish that only moves countdowns lights nothing */
  function stableCard(card) {
    if (!card || typeof card !== 'object') return card;
    var o = {}; Object.keys(card).forEach(function (k) { o[k] = card[k]; });
    if (Array.isArray(o.next)) o.next = o.next.map(function (n) { if (!n || typeof n !== 'object') return n; var q = {}; Object.keys(n).forEach(function (k) { if (k !== 'inMin') q[k] = n[k]; }); return q; });
    return o;
  }
  function cardHash(card) { var s = JSON.stringify(stableCard(card)) || '', h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return s.length + ':' + h; }
  function mSeenMap() {
    if (mSeen === null) { try { var o = JSON.parse(localStorage.getItem(MSEEN_KEY) || 'null'); mSeen = o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { mSeen = {}; } }
    return mSeen;
  }
  function markMissionSeen(pc) { mSeenMap()[pc.id] = cardHash(pc.card); try { localStorage.setItem(MSEEN_KEY, JSON.stringify(mSeen)); } catch (e) {} }
  function pcNew(pc) { return mSeenMap()[pc.id] !== cardHash(pc.card); }
  function missionNew(m) { return !!m && m.pcs.some(pcNew); }
  function missionButtonBody(nw) { return 'Mission' + (nw ? '<span class="ds-tdot" aria-hidden="true"></span>' : ''); }
  function missionButton() {
    var m = missionData(); if (!m) return '';
    var nw = missionNew(m);
    return '<button type="button" class="btn sm ds-missionbtn' + (nw ? ' new' : '') + '" data-act="missionscreen" data-always="1" aria-haspopup="dialog" aria-label="' + (nw ? 'Mission card, changed' : 'Mission card') +
      '" title="Where you are, what you can hear and what you know">' + missionButtonBody(nw) + '</button>';
  }
  function refreshMissionDot() {
    if (!cur || !cur.root) return; var b = cur.root.querySelector('.ds-missionbtn'); if (!b) return;
    var nw = missionNew(missionData());
    b.classList.toggle('new', nw); b.setAttribute('aria-label', nw ? 'Mission card, changed' : 'Mission card'); b.innerHTML = missionButtonBody(nw);
  }
  function onNet() { if (mv) paintMission(); }   /* online/offline: the Move row hides or shows */
  function closeMissionScreen(restore) {
    window.removeEventListener('online', onNet); window.removeEventListener('offline', onNet);
    if (mAskT) { clearTimeout(mAskT); mAskT = null; }   /* the "Asked for" timer goes with the viewer */
    if (!mv) return; var v = mv; mv = null;
    if (v.el.parentNode) v.el.parentNode.removeChild(v.el);
    var back = (cur && cur.root && cur.root.querySelector && cur.root.querySelector('.ds-missionbtn')) || v.from;
    if (restore !== false && back && back.focus && document.body.contains(back)) { try { back.focus({ preventScroll: true }); } catch (e) {} }
  }
  function mAdd(parent, tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; parent.appendChild(n); return n; }
  function strs(a) { return (Array.isArray(a) ? a : []).filter(function (x) { return typeof x === 'string' && x.trim(); }).map(function (x) { return x.trim(); }); }
  function inWords(n) { n = Math.floor(+n); if (!(n >= 0)) return ''; if (n < 60) return 'in ' + n + ' min'; var h = Math.floor(n / 60), r = n % 60; return 'in ' + h + ' h' + (r ? ' ' + (r < 10 ? '0' : '') + r : ''); }
  function cueLine(o) {   /* { text, where, until | at, inMin } as one line of plain words */
    if (!o || typeof o !== 'object') return typeof o === 'string' ? o : '';
    var bits = [typeof o.text === 'string' ? o.text : ''];
    if (typeof o.where === 'string' && o.where) bits.push(o.where);
    if (typeof o.until === 'string' && o.until) bits.push('until ' + o.until);
    if (typeof o.at === 'string' && o.at) bits.push(o.at + (o.inMin != null && inWords(o.inMin) ? ', ' + inWords(o.inMin) : ''));
    else if (o.inMin != null && inWords(o.inMin)) bits.push(inWords(o.inMin));
    return bits.filter(Boolean).join(' · ');
  }
  /* an ask is live until the card shows that room (the GM moved them) or 30 s pass */
  function missionAsk(pc, room) {
    var ask = mAsk[pc.id]; if (!ask) return null;
    if (room === ask.room || Date.now() - ask.at > 30000) { delete mAsk[pc.id]; return null; }
    return ask;
  }
  /* the Move row (ticket C): one button per open room; a tap only asks (requestMove writes moveReq), the GM page decides */
  function missionMove(body, v, m, pc, room) {
    var groups = (Array.isArray(m.rooms) ? m.rooms : []).filter(function (g) { return g && Array.isArray(g.rooms) && g.rooms.length; });
    if (!groups.length || navigator.onLine === false || readOnly() || typeof cur.api.requestMove !== 'function') { delete mAsk[pc.id]; return; }   /* hidden: no stale "Asked for" */
    var sec = mAdd(body, 'div', 'ds-mv-sec ds-mv-move'); mAdd(sec, 'h3', 'ds-mv-h', 'Move');
    groups.forEach(function (g) {
      if (typeof g.zone === 'string' && g.zone) mAdd(sec, 'div', 'ds-mv-zone', g.zone);
      var row = mAdd(sec, 'div', 'ds-mv-btns');
      g.rooms.forEach(function (r) {
        if (typeof r !== 'string' || !r) return;
        var at = room === r, b = mAdd(row, 'button', 'btn sm ds-mv-go' + (at ? ' here' : ''), at ? r + ' (here)' : r);
        b.type = 'button'; b.dataset.room = r; b.setAttribute('aria-pressed', String(at)); if (at) b.disabled = true;
        b.addEventListener('click', function () {
          if (mv !== v) return;
          var ask = mAsk[pc.id] = { room: r, at: Date.now() };
          var fail = function (e) { if (mAsk[pc.id] === ask) delete mAsk[pc.id]; setStatus('Could not ask to move: ' + (e && e.message || e), true); if (mv === v) paintMission(); };
          try { var p = cur.api.requestMove(pc.id, r); if (p && typeof p.then === 'function') p.then(null, fail); } catch (e) { fail(e); }
          paintMission();
        });
      });
    });
    var ask = missionAsk(pc, room);
    if (mAskT) { clearTimeout(mAskT); mAskT = null; }
    if (ask) {
      mAdd(sec, 'p', 'ds-mv-p ds-mv-asked', 'Asked for ' + ask.room);
      mAskT = setTimeout(function () { mAskT = null; if (mv === v) paintMission(); }, Math.max(0, ask.at + 30000 - Date.now()) + 50);   /* one timer: repaint when it expires */
    }
  }
  function paintMission() {
    var v = mv; if (!v) return;
    var m = missionData(); if (!m) { closeMissionScreen(); return; }
    var pc = m.pcs.filter(function (p) { return p.id === v.pc; })[0]; if (!pc) { pc = m.pcs[0]; v.pc = pc.id; }
    var key = m.pcs.map(function (p) { return p.id; }).join('|');
    if (key !== v.swKey) {   /* the switcher is rebuilt only when the list of characters changes, so a redraw never takes a tap's focus away */
      v.swKey = key; v.sw.textContent = '';
      if (m.pcs.length > 1) m.pcs.forEach(function (p) {
        var b = mAdd(v.sw, 'button', 'btn sm ds-mv-pc', ''); b.type = 'button'; b.dataset.pc = p.id;
        b.addEventListener('click', function () { if (mv !== v) return; v.pc = p.id; v.body.scrollTop = 0; paintMission(); });
      });
      v.sw.hidden = m.pcs.length < 2;
    }
    Array.prototype.forEach.call(v.sw.children, function (b) {
      var p = m.pcs.filter(function (q) { return q.id === b.dataset.pc; })[0]; if (!p) return;
      b.textContent = (p.card && typeof p.card.name === 'string' && p.card.name) || p.name || 'Character';
      if (p.id !== pc.id && pcNew(p)) { var d = document.createElement('span'); d.className = 'ds-tdot'; d.setAttribute('aria-hidden', 'true'); b.appendChild(d); }
      b.setAttribute('aria-pressed', String(p.id === pc.id));
    });
    var c = pc.card && typeof pc.card === 'object' ? pc.card : {}, body = v.body, keep = body.scrollTop;
    body.textContent = '';
    var who = (typeof c.name === 'string' && c.name) || pc.name || 'Your character', room = typeof c.room === 'string' ? c.room : '';
    var head = mAdd(body, 'div', 'ds-mv-head'); mAdd(head, 'h2', 'ds-mv-name', who);
    if (m.showTime && m.time) mAdd(head, 'span', 'ds-mv-time', m.time);   /* the clock only when the GM turned it on */
    var st = mAdd(body, 'div', 'ds-mv-status');
    mAdd(st, 'div', 'ds-mv-room', 'You are in'); mAdd(st, 'div', 'ds-mv-word', room || 'Not placed yet');
    if (typeof c.busy === 'string' && c.busy) mAdd(st, 'div', 'ds-mv-room', 'Busy until ' + c.busy);
    if (typeof c.costumeLine === 'string' && c.costumeLine) { var cs = mAdd(body, 'div', 'ds-mv-sec'); mAdd(cs, 'h3', 'ds-mv-h', 'Costume here'); mAdd(cs, 'p', 'ds-mv-p', c.costumeLine); }
    var here = strs(c.here);
    if (here.length) { var hs = mAdd(body, 'div', 'ds-mv-sec'); mAdd(hs, 'h3', 'ds-mv-h', 'In this room'); here.forEach(function (t) { mAdd(hs, 'p', 'ds-mv-p', t); }); }
    missionMove(body, v, m, pc, room);
    var leads = (Array.isArray(c.leads) ? c.leads : []).filter(function (l) { return l && typeof l === 'object'; });
    if (leads.length) {
      var open = leads.filter(function (l) { return !l.done; }), done = leads.filter(function (l) { return l.done; });
      var ls = mAdd(body, 'div', 'ds-mv-sec'); mAdd(ls, 'h3', 'ds-mv-h', 'Leads');
      open.concat(done).forEach(function (l) {
        var li = mAdd(ls, 'div', 'ds-mv-lead' + (l.done ? ' done' : ''));
        var f = function (cls, text) { if (typeof text === 'string' && text) mAdd(li, 'p', 'ds-mv-p ' + cls, text); };
        f('ds-mv-ln', typeof l.name === 'string' ? l.name : ''); f('', typeof l.line === 'string' ? '“' + l.line + '”' : '');
        f('ds-mv-meta', typeof l.heard === 'string' && l.heard ? 'Heard ' + l.heard : ''); f('ds-mv-meta', typeof l.window === 'string' && l.window ? l.window : '');
        f('ds-mv-meta', typeof l.next === 'string' && l.next && !l.done ? 'Next: ' + l.next : '');
      });
    }
    var items = strs(c.items);
    if (items.length) { var it = mAdd(body, 'div', 'ds-mv-sec'); mAdd(it, 'h3', 'ds-mv-h', 'You carry'); mAdd(it, 'p', 'ds-mv-p', items.join(' · ')); }
    var paths = (Array.isArray(c.paths) ? c.paths : []).map(cueLine).filter(Boolean);
    if (paths.length) { var ps = mAdd(body, 'div', 'ds-mv-sec'); mAdd(ps, 'h3', 'ds-mv-h', 'Ways through now'); paths.forEach(function (t) { mAdd(ps, 'p', 'ds-mv-p', t); }); }
    var know = strs(c.know);
    if (know.length) { var ks = mAdd(body, 'div', 'ds-mv-sec'); mAdd(ks, 'h3', 'ds-mv-h', 'You know'); know.forEach(function (t) { mAdd(ks, 'p', 'ds-mv-p', t); }); }
    var now = (Array.isArray(m.now) ? m.now : []).map(cueLine).filter(Boolean), next = (Array.isArray(c.next) ? c.next : []).map(cueLine).filter(Boolean);
    if (now.length || next.length) {
      var ns = mAdd(body, 'div', 'ds-mv-sec ds-mv-nn');
      now.forEach(function (t) { var p = mAdd(ns, 'p', 'ds-mv-p'); mAdd(p, 'b', null, 'NOW '); p.appendChild(document.createTextNode(t)); });
      next.forEach(function (t) { var p = mAdd(ns, 'p', 'ds-mv-p'); mAdd(p, 'b', null, 'NEXT '); p.appendChild(document.createTextNode(t)); });
    }
    body.scrollTop = keep;
    markMissionSeen(pc); refreshMissionDot();   /* looking at it now: its dot goes */
  }
  function openMissionScreen(from, pcId) {
    var m = missionData(); if (!m || mv) return;
    var el = document.createElement('div'); el.className = 'ds-mv'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Your mission card');
    var top = mAdd(el, 'div', 'ds-mv-top'), x = mAdd(top, 'button', 'ds-mv-x', '×'); x.type = 'button'; x.setAttribute('aria-label', 'Close the mission card');
    mAdd(top, 'span', 'ds-mv-hh', 'Mission');
    var sw = mAdd(el, 'div', 'ds-mv-sw'); sw.hidden = true;
    var body = mAdd(el, 'div', 'ds-mv-body');
    x.addEventListener('click', function () { closeMissionScreen(); });
    var mine = (pcId && m.pcs.filter(function (p) { return p.id === pcId; })[0]) || m.pcs.filter(function (p) { return cur && cur.doc && p.id === cur.doc.id; })[0] || m.pcs[0];   /* the asked-for character, else this sheet's if it has a card, else the first */
    window.addEventListener('online', onNet); window.addEventListener('offline', onNet);
    mv = { el: el, body: body, sw: sw, swKey: '', pc: mine.id, from: from || null };
    document.body.appendChild(el);
    try { x.focus({ preventScroll: true }); } catch (e) {}
    paintMission();
  }
  /* the campaign document moved (boot calls T.refresh), or the sheet just opened: redraw the open viewer in place, or open it on a card that
     changed (paintMission marks it seen, so a reload does not open it again), else just the button's dot */
  function missionSync() {
    if (mv) { paintMission(); return; }
    var m = missionData(), nw = m ? m.pcs.filter(pcNew) : [], p = nw.filter(function (q) { return cur && cur.doc && q.id === cur.doc.id; })[0] || nw[0];   /* this sheet's character first */
    var other = !!document.querySelector('[aria-modal="true"]:not(.ds-mv)');   /* another full-screen layer is up (the Table viewer, ...): no second dialog, the dot says so; it opens on the next sync once that layer is gone */
    if (p && cur && !other) openMissionScreen(null, p.id); else refreshMissionDot();
  }

  /* ---------- API ---------- */
  T.open = function (doc, api) {
    var root = document.getElementById('dossier'); if (!root) return;
    if (cur) T.close();
    doc = doc || {}; cur = { doc: doc, api: api || {}, pb: pbOf(doc.playbook), root: root, ui: { mug: false, advance: null, glitchPick: null, svg: '', svgWarn: '', mark: null, roll: null, rollScroll: false, dt: null, endSess: null, more: false, about: false, loadout: false }, timer: null, saving: 0 };
    cur.play = normalize(doc.play, doc.sheet, doc.playbook); cur.server = clone(cur.play);
    cur.status = { msg: readOnly() ? roLabel() : savedMsg() }; /* as stored (or still queued on this device) */
    root.addEventListener('click', onClick); root.addEventListener('input', onInput); root.addEventListener('change', onChange); root.addEventListener('keydown', onKey);
    document.addEventListener('keydown', onDocKey); document.addEventListener('click', onDocClick);
    window.addEventListener('b68:runtime', onRuntime); window.addEventListener('pagehide', onHide); document.addEventListener('visibilitychange', onHide);
    render();
    var sc = screenApi(); if (sc && typeof sc.on === 'function') { try { cur.screenOff = sc.on(onScreenSeq); } catch (e) {} }   /* the Table button's dot, and an open viewer, follow screenSeq */
    if (!kitHooked && window.B68Load && typeof window.B68Load.onFigures === 'function') { kitHooked = true; window.B68Load.onFigures(onKit); }
    missionSync();   /* a card that changed while the player was on the home screen opens now */
    if (!doc.play && !readOnly()) flushSave(); /* a doc filed without a play object gets one */
  };
  T.update = function (doc) {
    if (!cur || !doc) return; if (doc.id && cur.doc.id && doc.id !== cur.doc.id) return;
    /* our own change is on its way: hold the snapshot (the newest one) and merge it once everything has landed (settle) */
    if (cur.timer || cur.saving) { cur.doc = Object.assign({}, cur.doc, doc, { play: cur.play }); cur.remote = doc; return; }
    applyRemote(doc, null);
  };
  T.close = function () {
    if (!cur) return; var c = cur;
    if (c.timer) { clearTimeout(c.timer); c.timer = null; flushSave(); } /* typed text still waiting goes out before the sheet closes */
    cur = null; if (c.statusT) clearTimeout(c.statusT);
    if (c.screenOff) { try { c.screenOff(); } catch (e) {} c.screenOff = null; }
    closeTableScreen(false); closeMissionScreen(false);
    c.root.removeEventListener('click', onClick); c.root.removeEventListener('input', onInput); c.root.removeEventListener('change', onChange); c.root.removeEventListener('keydown', onKey);
    document.removeEventListener('keydown', onDocKey); document.removeEventListener('click', onDocClick);
    window.removeEventListener('b68:runtime', onRuntime); window.removeEventListener('pagehide', onHide); document.removeEventListener('visibilitychange', onHide);
    c.root.innerHTML = ''; c.root.className = 'dossier';
  };
  /* something the sheet reads from outside its document changed (the table's session, api.table): redraw */
  T.refresh = function () { if (cur) { render(); missionSync(); } };
  T.isOpen = function () { return !!cur; };
  T.play = function () { return cur ? clone(cur.play) : null; };
  /* a read-only copy of a sheet in another root (the season print): the markup the live sheet prints for someone who
     may write (so the marks print at full strength), in a root made inert, with no listeners and no saves. The figure is
     drawn once, in the small print slot (.ds-printfig), and the Figure box is left empty, so its SVG ids never appear
     twice in one root. The open sheet, if any, is untouched. */
  T.renderStatic = function (root, doc) {
    if (!root) return null;
    doc = doc || {}; var live = cur;
    cur = { doc: doc, api: { canWrite: null }, pb: pbOf(doc.playbook), root: root, ui: { static: true, mug: false, advance: null, glitchPick: null, svg: '', svgWarn: '', mark: null, roll: null, rollScroll: false, dt: null, endSess: null, more: false, about: false, loadout: false }, timer: null, saving: 0 };
    try {
      cur.play = normalize(doc.play, doc.sheet, doc.playbook);
      render();
      var f = root.querySelector('.ds-printfig'), art = root.querySelector('.ds-figbox .ds-art');
      if (f && cur.ui.svg) { f.innerHTML = cur.ui.svg; if (art) art.innerHTML = ''; }
      root.setAttribute('inert', '');
    } finally { cur = live; }
    return root;
  };
})();
