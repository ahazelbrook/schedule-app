/* campaign.js — the shared table page (CAMPAIGN.md): the session bar, the crew panel, shared clocks, the players with
   their characters, and the campaign log. One document, campaign/main. Renders into section#table-page; boot.js owns
   the subscription and hands each snapshot to B68Campaign.update(data). Every change goes out through api.save(patch)
   carrying only what changed (clicks at once, typing debounced); nothing is written on open.

   Permissions: the GM writes everything. A player may edit the whole crew panel (the crew sheet is shared), fill
   clock segments and append to the log; the session buttons, clock structure (add, remove, rename, resize, kind,
   hidden) and removing old log lines stay with the GM. A GM-only control (data-gm) is not shown to players at all
   (a GM-only text field still shows its value, disabled); where that leaves a player nothing, a short line says who
   does it ("The GM starts sessions."). Read-only viewers see the rest disabled.

   Layout: the DOM order is the phone's reading order: the session line, then shared clocks, the campaign log (the
   latest three, "All" shows the rest), the players, the crew (behind a summary row on a phone: Tier, Hold, Rep, Heat,
   Wanted, Stacks) and last the schedule. On a wide screen campaign.css puts the first three in the left column and the
   crew and schedule in the right one. The schedule box (schedule.js, SCHEDULE.md) is #tp-schedule (the #t/schedule
   route opens and scrolls to it): a player sees it only while a next session or an open date exists; the GM sees a one
   line row ("Schedule · no dates · Plan dates") until there is something to plan or the row is opened. data-act
   "sched.*" goes to B68Schedule.acts, with its own PERM. A player may change only schedule.avail.<me> and
   schedule.rsvp.<me>; anything else under schedule is stripped from a player's delta, and schedule changes go out as
   the changed leaves only (null deletes a key). What is folded or unfolded (the crew, the log, the schedule) is page
   state only, never written (data-act "view*", open to read-only viewers too).

   The crew panel is self-contained (a render function and its own action table, data-act "crew.*"), so a full crew
   sheet can replace it later through B68Campaign.setCrewPanel({ render(crew, ctx), acts, enter }). */
(function () {
  'use strict';
  var M = window.B68Campaign = window.B68Campaign || {};

  /* ---------- small helpers ---------- */
  /* a small "?" link to the rules wiki (rules.js), drawn only on the hosted build, which has the rules */
  function rl(term) { var R = window.B68Rules; return R && R.help ? R.help(term) : ''; }
  function rulesLink() { var R = window.B68Rules; return R && R.available && R.available() ? '<a class="btn sm" href="#rules" title="The rulebooks, searchable">Rules</a>' : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(o) { return o === undefined ? undefined : JSON.parse(JSON.stringify(o)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function clamp(n, a, b) { n = Math.round(+n || 0); return n < a ? a : n > b ? b : n; }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function isoOrNull(v) { return typeof v === 'string' && v ? v : null; }
  function nowIso() { return new Date().toISOString(); }
  function sched() { var S = window.B68Schedule; return S && typeof S.normalize === 'function' ? S : null; }
  function toggleTrack(cur, n) { return cur === n ? n - 1 : n; }
  var SIZES = [4, 6, 8, 10, 12], KINDS = ['danger', 'project', 'faction', 'other'], HARMS = ['weak', 'impaired', 'broken'];
  var LOG_MAX = 200, SAVE_DELAY = 400;
  function newClockId() { return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function when(iso, withTime) {
    var t = Date.parse(iso || ''); if (!t) return '';
    try { var o = { day: 'numeric', month: 'short' }; if (withTime) { o.hour = '2-digit'; o.minute = '2-digit'; } if (new Date(t).getFullYear() !== new Date().getFullYear()) o.year = 'numeric'; return new Date(t).toLocaleString(undefined, o); } catch (e) { return String(iso).slice(0, 16).replace('T', ' '); }
  }

  /* ---------- the document: default shape, and a merge over it so missing or odd fields never crash ---------- */
  function defaults() {
    return {
      v: 1,
      session: { number: 0, startedAt: null, endedAt: null },
      crew: { name: '', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] },
      clocks: [],
      log: [],
      schedule: { options: {}, avail: {}, next: null, rsvp: {}, cadence: null, quorum: 0, attendance: {} },
      updatedAt: null
    };
  }
  function normSchedule(s) { var Sm = sched(); return Sm ? Sm.normalize(s) : isObj(s) ? Object.assign(defaults().schedule, clone(s)) : defaults().schedule; }
  /* schedule changes: the changed leaves, a removed key as null (a PATCH deletes it) */
  function diffObj(a, b) {
    if (same(a, b)) return undefined;
    if (isObj(a) && isObj(b)) {
      var out = {}, any = false;
      Object.keys(b).forEach(function (k) { var d = diffObj(a[k], b[k]); if (d !== undefined) { out[k] = d; any = true; } });
      Object.keys(a).forEach(function (k) { if (!Object.prototype.hasOwnProperty.call(b, k) && a[k] != null) { out[k] = null; any = true; } });
      return any ? out : undefined;
    }
    return b == null ? (a == null ? undefined : null) : clone(b);
  }
  function mergeNull(t, p) { Object.keys(p).forEach(function (k) { var v = p[k]; if (v === null) delete t[k]; else if (isObj(v) && isObj(t[k])) mergeNull(t[k], v); else t[k] = clone(v); }); return t; }
  /* a player may write only schedule.avail.<me> and schedule.rsvp.<me> (never attendance, options, next, …) */
  function ownSchedule(patch, me) {
    if (!isObj(patch) || !me) return undefined;
    var out = {}, any = false;
    ['avail', 'rsvp'].forEach(function (k) { if (isObj(patch[k]) && Object.prototype.hasOwnProperty.call(patch[k], me)) { out[k] = {}; out[k][me] = patch[k][me]; any = true; } });
    return any ? out : undefined;
  }
  function normCrew(c) {
    var d = defaults().crew; c = isObj(c) ? c : {};
    var out = Object.assign({}, clone(c));   /* unknown crew fields are kept (a later crew sheet may add its own) */
    ['name', 'type', 'lair', 'notes'].forEach(function (k) { out[k] = str(c[k]); });
    out.tier = clamp(c.tier, 0, 6); out.hold = c.hold === 'strong' ? 'strong' : 'weak';
    out.turf = clamp(c.turf, 0, 6); out.rep = clamp(c.rep, 0, 12);
    out.heat = clamp(c.heat, 0, 9); out.wanted = clamp(c.wanted, 0, 4); out.vault = clamp(c.vault, 0, 16);
    /* claims: the generic list of { name, held }, or the crew sheet's map { cellId: true | false } (crewsheet.js) */
    out.claims = isObj(c.claims) ? Object.keys(c.claims).reduce(function (m, k) { m[k] = c.claims[k] === true; return m; }, {}) : (Array.isArray(c.claims) ? c.claims : d.claims).filter(isObj).map(function (x) { return { name: str(x.name), held: !!x.held }; });
    out.cohorts = (Array.isArray(c.cohorts) ? c.cohorts : d.cohorts).filter(isObj).map(function (x) { return { name: str(x.name), type: str(x.type), edges: str(x.edges), flaws: str(x.flaws), harm: HARMS.indexOf(x.harm) >= 0 ? x.harm : null, armor: !!x.armor }; });
    out.factions = (Array.isArray(c.factions) ? c.factions : d.factions).filter(isObj).map(function (x) { return { name: str(x.name), status: clamp(x.status, -3, 3) }; });
    return out;
  }
  function nearestSize(n) { n = +n || 4; return SIZES.reduce(function (b, s) { return Math.abs(s - n) < Math.abs(b - n) ? s : b; }, 4); }
  function normalize(d) {
    d = isObj(d) ? d : {};
    var out = defaults(), s = isObj(d.session) ? d.session : {};
    out.session = { number: clamp(s.number, 0, 9999), startedAt: isoOrNull(s.startedAt), endedAt: isoOrNull(s.endedAt) };
    out.crew = normCrew(d.crew);
    var seen = {};
    out.clocks = (Array.isArray(d.clocks) ? d.clocks : []).filter(isObj).map(function (c, i) {
      var id = str(c.id) || 'c_' + i; while (seen[id]) id += '_'; seen[id] = true;
      var size = SIZES.indexOf(+c.size) >= 0 ? +c.size : nearestSize(c.size);
      return { id: id, name: str(c.name), size: size, filled: clamp(c.filled, 0, size), kind: KINDS.indexOf(c.kind) >= 0 ? c.kind : 'other', hidden: !!c.hidden };
    });
    out.log = (Array.isArray(d.log) ? d.log : []).filter(isObj).slice(0, LOG_MAX).map(function (e) { return { at: str(e.at), by: e.by == null ? null : str(e.by), text: str(e.text) }; });
    out.schedule = normSchedule(d.schedule);
    if (isObj(d.scene)) out.scene = clone(d.scene);   /* who is on stage (cast-page.js, CAST.md): the GM writes it; kept so a whole-document write never drops it */
    out.updatedAt = isoOrNull(d.updatedAt);
    if (d.v != null) out.v = d.v;
    return out;
  }
  M.defaults = defaults;
  M.normalize = normalize;

  /* paths: "crew.claims.0.name", or "clocks.#c_xyz.name" where "#id" picks the array element with that id */
  function seg(o, k) { if (o == null) return undefined; if (k.charAt(0) === '#' && Array.isArray(o)) { var id = k.slice(1); return o.filter(function (x) { return x && x.id === id; })[0]; } return o[k]; }
  function getPath(o, path) { var ps = path.split('.'); for (var i = 0; i < ps.length; i++) { o = seg(o, ps[i]); if (o === undefined) return undefined; } return o; }
  function setPath(o, path, v) { var ps = path.split('.'); for (var i = 0; i < ps.length - 1; i++) { o = seg(o, ps[i]); if (o == null || typeof o !== 'object') return false; } var last = ps[ps.length - 1]; if (Array.isArray(o) && !/^\d+$/.test(last)) return false; o[last] = v; return true; }

  /* ---------- state ---------- */
  var cur = null;   /* { api, root, doc, base, loaded, dirty, timer, saving, drafts, names, asked, statusT } */
  function ro() { return !!(cur && cur.api && cur.api.canWrite === false); }
  function gm() { return !!(cur && cur.api && cur.api.isGM === true) && !ro(); }
  function can(what) { return what === 'gm' ? gm() : !ro(); }
  function role() { return ro() ? 'Read only' : gm() ? 'GM' : 'Player'; }
  function roleCls() { return ro() ? ' ro' : gm() ? ' gm' : ''; }

  function setStatus(msg, bad, transient) {
    if (!cur) return; var s = cur.root.querySelector('#tp-status'); if (!s) return;
    s.textContent = msg; s.className = 'tp-status mono' + (bad ? ' bad' : '');
    if (cur.statusT) { clearTimeout(cur.statusT); cur.statusT = null; }
    if (transient) cur.statusT = setTimeout(function () { if (cur) setStatus(idleStatus()); }, 2400);
  }
  function idleStatus() { return ro() ? 'Read only' : cur.timer || cur.saving ? 'Saving…' : cur.everSaved ? 'Saved' : 'Up to date'; }

  /* what changed since the last known server state: session, clocks and log whole; crew field by field */
  /* Outside crew the server compares the stored document path by path, so a clock fill or a log append is built from
     the arrays exactly as stored (only `filled` changed / new entries in front); anything else sends the page's copy. */
  function fillOnly(rawC, bC, dC) {
    if (!Array.isArray(rawC) || rawC.length !== bC.length || dC.length !== bC.length || !rawC.every(isObj)) return null;
    for (var i = 0; i < dC.length; i++) { var x = Object.assign({}, dC[i], { filled: 0 }), y = Object.assign({}, bC[i], { filled: 0 }); if (!same(x, y)) return null; }
    return rawC.map(function (r, i) { var c = clone(r); if (dC[i].filled !== bC[i].filled) c.filled = dC[i].filled; return c; });
  }
  function appendOnly(rawL, bL, dL) {
    rawL = rawL == null ? [] : rawL;
    if (!Array.isArray(rawL) || !rawL.every(isObj) || rawL.length < bL.length) return null;
    for (var k = 1; k <= dL.length; k++) {
      var kept = dL.length - k; if (kept !== bL.length && dL.length < LOG_MAX) continue;   /* only the cap may drop old lines */
      if (same(dL.slice(k), bL.slice(0, kept))) return clone(dL.slice(0, k)).concat(clone(rawL)).slice(0, LOG_MAX);
    }
    return null;
  }
  function delta() {
    var out = {}, any = false, d = cur.doc, b = cur.base, raw = cur.raw || {};
    if (!same(d.session, b.session)) { out.session = clone(d.session); any = true; }
    if (!same(d.clocks, b.clocks)) { out.clocks = fillOnly(raw.clocks, b.clocks, d.clocks) || clone(d.clocks); any = true; }
    if (!same(d.log, b.log)) { var ap = appendOnly(raw.log, b.log, d.log); if (!ap) return { replace: true }; out.log = ap; any = true; }   /* a patch can only add log lines */
    var cd = {}, cany = false;
    Object.keys(d.crew).forEach(function (f) { if (!same(d.crew[f], b.crew[f])) { cd[f] = clone(d.crew[f]); cany = true; } });
    if (cany) { out.crew = cd; any = true; }
    if (!same(d.schedule, b.schedule)) {
      var sd = diffObj(b.schedule, d.schedule);
      if (sd && !gm()) sd = ownSchedule(sd, cur.api && cur.api.me);   /* the page enforces the player rule (the artifact db has none) */
      if (sd) { out.schedule = sd; any = true; }
    }
    return any ? out : null;
  }
  function flushSave() {
    if (!cur) return; if (cur.timer) { clearTimeout(cur.timer); cur.timer = null; }
    if (ro()) { setStatus('Read only'); return; }
    var patch = delta(); cur.dirty = {};
    if (!patch) { setStatus(idleStatus()); return; }
    if (!cur.api || typeof cur.api.save !== 'function') { setStatus('Not saved: this view cannot save.', true); return; }
    if (patch.replace) {
      /* removing or rewriting log lines: the GM writes the whole document (PUT); a patch never removes log entries */
      if (!gm() || typeof cur.api.replace !== 'function') { setStatus('Only the GM can change old log lines', true); return; }
      var whole = clone(cur.doc); cur.base = clone(cur.doc); cur.raw = clone(cur.doc); cur.saving++; setStatus('Saving…');
      var c0 = cur, p0;
      try { p0 = c0.api.replace(whole); } catch (e) { c0.saving--; setStatus('Could not save: ' + (e && e.message || e), true); return; }
      Promise.resolve(p0).then(function () { c0.saving--; c0.everSaved = true; if (cur === c0 && !c0.saving && !c0.timer) setStatus('Saved'); },
        function (e) { c0.saving--; if (cur === c0) setStatus('Could not save: ' + (e && e.message || e || 'unknown error'), true); });
      return;
    }
    cur.base = clone(cur.doc); cur.saving++; setStatus('Saving…');
    var raw = cur.raw = clone(cur.raw || {});   /* what the store holds once this lands, for the next delta before the echo */
    Object.keys(patch).forEach(function (k) { if (k === 'crew') raw.crew = Object.assign(isObj(raw.crew) ? raw.crew : {}, clone(patch.crew)); else if (k === 'schedule') raw.schedule = mergeNull(isObj(raw.schedule) ? raw.schedule : {}, patch.schedule); else raw[k] = clone(patch[k]); });
    var c = cur, p;
    try { p = c.api.save(patch); } catch (e) { c.saving--; setStatus('Could not save: ' + (e && e.message || e), true); return; }
    Promise.resolve(p).then(function () { c.saving--; c.everSaved = true; if (cur === c && !c.saving && !c.timer) setStatus('Saved'); },
      function (e) { c.saving--; if (cur === c) setStatus('Could not save: ' + (e && e.message || e || 'unknown error'), true); });
  }
  function scheduleSave() { if (!cur) return; if (cur.timer) clearTimeout(cur.timer); setStatus('Saving…'); cur.timer = setTimeout(function () { if (cur) { cur.timer = null; flushSave(); } }, SAVE_DELAY); }
  /* a click changed the document: redraw and save at once */
  function commit() { if (!cur) return; render(); flushSave(); }

  /* ---------- small renderers (shared with the crew panel through ctx) ---------- */
  function box(title, body, right, cls, id) { return '<section' + (id ? ' id="' + id + '"' : '') + ' class="tp-box' + (cls ? ' ' + cls : '') + '"><div class="tp-band"><span>' + title + '</span>' + (right ? '<span class="tp-band-r">' + right + '</span>' : '') + '</div><div class="tp-body">' + body + '</div></section>'; }
  /* o: { cls, dis, gm, extra, label } */
  function pips(n, filled, act, o) {
    o = o || {}; var h = '<span class="tp-pips' + (o.wrap ? ' ' + o.wrap : '') + '">';
    for (var i = 1; i <= n; i++) h += '<button type="button" class="' + (o.cls || 'tp-pip') + (i <= filled ? ' on' : '') + '" data-act="' + act + '" data-n="' + i + '"' + (o.extra || '') + (o.gm ? ' data-gm="1"' : '') + (o.dis ? ' disabled' : '') + ' aria-label="' + esc((o.label || act) + ' ' + i) + '" aria-pressed="' + (i <= filled) + '"></button>';
    return h + '</span>';
  }
  function input(path, value, ph, o) { o = o || {}; return '<input type="text" class="tp-in' + (o.cls ? ' ' + o.cls : '') + '" data-path="' + esc(path) + '" value="' + esc(value) + '" placeholder="' + esc(ph || '') + '"' + (o.gm ? ' data-gm="1"' : '') + (o.label ? ' aria-label="' + esc(o.label) + '"' : '') + '>'; }
  function draftInput(ui, ph, o) { o = o || {}; return '<input type="text" class="tp-in' + (o.cls ? ' ' + o.cls : '') + '" data-ui="' + esc(ui) + '" value="' + esc((cur && cur.drafts[ui]) || '') + '" placeholder="' + esc(ph || '') + '"' + (o.gm ? ' data-gm="1"' : '') + ' aria-label="' + esc(o.label || ph || '') + '">'; }
  function textarea(path, value, ph, o) { o = o || {}; return '<textarea class="tp-ta' + (o.cls ? ' ' + o.cls : '') + '" data-path="' + esc(path) + '" placeholder="' + esc(ph || '') + '"' + (o.gm ? ' data-gm="1"' : '') + (o.label ? ' aria-label="' + esc(o.label) + '"' : '') + '>' + esc(value) + '</textarea>'; }
  function chip(label, act, pressed, extra, o) { o = o || {}; return '<button type="button" class="chip sm' + (o.cls ? ' ' + o.cls : '') + '" data-act="' + act + '"' + (extra || '') + (pressed != null ? ' aria-pressed="' + !!pressed + '"' : '') + (o.gm ? ' data-gm="1"' : '') + (o.title ? ' title="' + esc(o.title) + '"' : '') + '>' + label + '</button>'; }
  function clockSvg(size, filled, r, act, extra) {
    var cx = r, cy = r, R = r - 2, h = '', n = clamp(size, 2, 12);
    for (var i = 0; i < n; i++) {
      var a0 = -Math.PI / 2 + i * 2 * Math.PI / n, a1 = a0 + 2 * Math.PI / n;
      var x0 = (cx + R * Math.cos(a0)).toFixed(2), y0 = (cy + R * Math.sin(a0)).toFixed(2), x1 = (cx + R * Math.cos(a1)).toFixed(2), y1 = (cy + R * Math.sin(a1)).toFixed(2);
      h += '<path class="tp-seg' + (i < filled ? ' on' : '') + '" data-act="' + act + '" data-n="' + (i + 1) + '"' + (extra || '') + ' d="M' + cx + ' ' + cy + ' L' + x0 + ' ' + y0 + ' A' + R + ' ' + R + ' 0 0 1 ' + x1 + ' ' + y1 + ' Z"><title>' + (i + 1) + ' / ' + n + '</title></path>';
    }
    return '<svg class="tp-clocksvg" viewBox="0 0 ' + 2 * r + ' ' + 2 * r + '" width="' + 2 * r + '" height="' + 2 * r + '" role="img" aria-label="clock ' + filled + ' of ' + n + '">' + h + '<circle class="tp-rim" cx="' + cx + '" cy="' + cy + '" r="' + R + '"/></svg>';
  }

  /* ---------- the crew panel: generic Forged in the Dark crew tracks. Self-contained so it can be swapped. ---------- */
  var GenericCrew = (function () {
    function track(label, body, note) { return '<div class="tp-track"><span class="tp-lab">' + label + '</span><div class="tp-trackv">' + body + (note ? '<span class="tp-dim mono">' + note + '</span>' : '') + '</div></div>'; }
    function render(crew, ctx) {
      if (!Array.isArray(crew.claims)) crew = Object.assign({}, crew, { claims: [] });   /* a crew-sheet claims map has no generic list */
      var h = '<div class="tp-ident">' +
        '<label><span class="tp-lab">Crew name</span>' + ctx.input('crew.name', crew.name, 'What does the street call you?') + '</label>' +
        '<label><span class="tp-lab">Crew type</span>' + ctx.input('crew.type', crew.type, 'Dealers, Racers, Shadows…') + '</label>' +
        '<label><span class="tp-lab">Lair</span>' + ctx.input('crew.lair', crew.lair, 'Where you hole up') + '</label></div>';
      var repMax = 12 - crew.turf, rep = Math.min(crew.rep, repMax);
      h += '<div class="tp-tracks">' +
        track('Tier', ctx.pips(6, crew.tier, 'crew.tier', { label: 'Tier' }) + '<span class="seg tp-hold">' + ['weak', 'strong'].map(function (v) { return ctx.chip(v === 'weak' ? 'Weak' : 'Strong', 'crew.hold', crew.hold === v, ' data-v="' + v + '"'); }).join('') + '</span>', 'tier ' + crew.tier + ' · ' + crew.hold + ' hold') +
        track('Rep', ctx.pips(repMax, rep, 'crew.rep', { cls: 'tp-sq', label: 'Rep' }), rep + ' / ' + repMax + (crew.turf ? ' · ' + crew.turf + ' turf' : '')) +
        track('Turf', ctx.pips(6, crew.turf, 'crew.turf', { cls: 'tp-sq tp-turf', label: 'Turf' }), 'each turf: 1 less rep to tier up') +
        track('Heat', ctx.pips(9, crew.heat, 'crew.heat', { cls: 'tp-sbox', label: 'Heat' }), crew.heat + ' / 9') +
        track('Wanted', ctx.pips(4, crew.wanted, 'crew.wanted', { cls: 'tp-sbox tp-want', label: 'Wanted level' }), 'level ' + crew.wanted) +
        track('Vault', ctx.pips(16, crew.vault, 'crew.vault', { cls: 'tp-dia', wrap: 'tp-vault', label: 'Vault stack' }), crew.vault + ' / 16 stacks') +
        '</div>';
      /* claims */
      h += '<div class="tp-sub"><div class="tp-subh"><span class="tp-lab">Claims</span><button type="button" class="btn sm" data-act="crew.claimadd">Add claim</button></div><div class="tp-list">';
      crew.claims.forEach(function (c, i) {
        h += '<div class="tp-claim"><button type="button" class="tp-sq' + (c.held ? ' on' : '') + '" data-act="crew.claimheld" data-i="' + i + '" aria-pressed="' + c.held + '" aria-label="Held"></button>' + ctx.input('crew.claims.' + i + '.name', c.name, 'The claim', { label: 'Claim ' + (i + 1) }) + '<button type="button" class="tp-x" data-act="crew.claimrm" data-i="' + i + '" title="Remove the claim" aria-label="Remove the claim">×</button></div>';
      });
      if (!crew.claims.length) h += '<p class="hint">No claims yet. Mark a claim held when the crew takes it.</p>';
      h += '</div></div>';
      /* cohorts */
      h += '<div class="tp-sub"><div class="tp-subh"><span class="tp-lab">Cohorts</span><button type="button" class="btn sm" data-act="crew.cohortadd">Add cohort</button></div><div class="tp-list">';
      crew.cohorts.forEach(function (c, i) {
        var p = 'crew.cohorts.' + i + '.';
        h += '<div class="tp-cohort"><div class="tp-corow">' + ctx.input(p + 'name', c.name, 'Name', { label: 'Cohort name' }) + ctx.input(p + 'type', c.type, 'Gang or expert type', { label: 'Cohort type' }) + '</div>' +
          '<div class="tp-corow">' + ctx.input(p + 'edges', c.edges, 'Edges', { label: 'Edges' }) + ctx.input(p + 'flaws', c.flaws, 'Flaws', { label: 'Flaws' }) + '</div>' +
          '<div class="tp-cohs">' + HARMS.map(function (s) { return '<button type="button" class="tp-coh' + (c.harm === s ? ' on' : '') + '" data-act="crew.cohortharm" data-i="' + i + '" data-v="' + s + '" aria-pressed="' + (c.harm === s) + '"><span class="tp-cohpip"></span>' + s.charAt(0).toUpperCase() + s.slice(1) + '</button>'; }).join('') +
          '<button type="button" class="tp-coh' + (c.armor ? ' on' : '') + '" data-act="crew.cohortarmor" data-i="' + i + '" aria-pressed="' + c.armor + '"><span class="tp-cohsq"></span>Armor</button>' +
          '<button type="button" class="tp-x" data-act="crew.cohortrm" data-i="' + i + '" title="Remove the cohort" aria-label="Remove the cohort">×</button></div></div>';
      });
      if (!crew.cohorts.length) h += '<p class="hint">No cohorts. Gangs and experts the crew runs go here.</p>';
      h += '</div></div>';
      /* factions */
      h += '<div class="tp-sub"><div class="tp-subh"><span class="tp-lab">Factions</span><button type="button" class="btn sm" data-act="crew.factionadd">Add faction</button></div><div class="tp-list">';
      crew.factions.forEach(function (f, i) {
        h += '<div class="tp-faction">' + ctx.input('crew.factions.' + i + '.name', f.name, 'Faction', { label: 'Faction ' + (i + 1) }) + '<span class="seg tp-status7">' + [-3, -2, -1, 0, 1, 2, 3].map(function (v) { return ctx.chip(v > 0 ? '+' + v : v < 0 ? '−' + (-v) : '0', 'crew.factionstatus', f.status === v, ' data-i="' + i + '" data-v="' + v + '"', { cls: v < 0 ? 'neg' : v > 0 ? 'pos' : '' }); }).join('') + '</span><button type="button" class="tp-x" data-act="crew.factionrm" data-i="' + i + '" title="Remove the faction" aria-label="Remove the faction">×</button></div>';
      });
      if (!crew.factions.length) h += '<p class="hint">No faction statuses yet: −3 at war, 0 neutral, +3 allies.</p>';
      h += '</div></div>';
      h += '<div class="tp-sub"><span class="tp-lab">Crew notes</span>' + ctx.textarea('crew.notes', crew.notes, 'Hunting grounds, upgrades, contacts, debts…', { label: 'Crew notes' }) + '</div>';
      return ctx.box('The crew', h, '<span class="tp-dim">shared by the whole table</span>', 'tp-crewbox');
    }
    function at(list, d) { return list[+d.i]; }
    var acts = {
      tier: function (d, crew, ctx) { crew.tier = toggleTrack(crew.tier, +d.n); ctx.commit(); },
      hold: function (d, crew, ctx) { if (crew.hold === d.v) return; crew.hold = d.v === 'strong' ? 'strong' : 'weak'; ctx.commit(); },
      rep: function (d, crew, ctx) { crew.rep = toggleTrack(Math.min(crew.rep, 12 - crew.turf), +d.n); ctx.commit(); },
      turf: function (d, crew, ctx) { crew.turf = toggleTrack(crew.turf, +d.n); crew.rep = Math.min(crew.rep, 12 - crew.turf); ctx.commit(); },
      heat: function (d, crew, ctx) { crew.heat = toggleTrack(crew.heat, +d.n); ctx.commit(); },
      wanted: function (d, crew, ctx) { crew.wanted = toggleTrack(crew.wanted, +d.n); ctx.commit(); },
      vault: function (d, crew, ctx) { crew.vault = toggleTrack(crew.vault, +d.n); ctx.commit(); },
      claimadd: function (d, crew, ctx) { crew.claims.push({ name: '', held: false }); ctx.commit(); ctx.focus('[data-path="crew.claims.' + (crew.claims.length - 1) + '.name"]'); },
      claimheld: function (d, crew, ctx) { var c = at(crew.claims, d); if (!c) return; c.held = !c.held; ctx.commit(); },
      claimrm: function (d, crew, ctx) { var c = at(crew.claims, d); if (!c) return; if (c.name && !ctx.confirm('Remove the claim ' + c.name + '?')) return; crew.claims.splice(+d.i, 1); ctx.commit(); },
      cohortadd: function (d, crew, ctx) { crew.cohorts.push({ name: '', type: '', edges: '', flaws: '', harm: null, armor: false }); ctx.commit(); ctx.focus('[data-path="crew.cohorts.' + (crew.cohorts.length - 1) + '.name"]'); },
      cohortharm: function (d, crew, ctx) { var c = at(crew.cohorts, d); if (!c) return; c.harm = c.harm === d.v ? null : (HARMS.indexOf(d.v) >= 0 ? d.v : null); ctx.commit(); },
      cohortarmor: function (d, crew, ctx) { var c = at(crew.cohorts, d); if (!c) return; c.armor = !c.armor; ctx.commit(); },
      cohortrm: function (d, crew, ctx) { var c = at(crew.cohorts, d); if (!c) return; if ((c.name || c.type) && !ctx.confirm('Remove the cohort ' + (c.name || c.type) + '?')) return; crew.cohorts.splice(+d.i, 1); ctx.commit(); },
      factionadd: function (d, crew, ctx) { crew.factions.push({ name: '', status: 0 }); ctx.commit(); ctx.focus('[data-path="crew.factions.' + (crew.factions.length - 1) + '.name"]'); },
      factionstatus: function (d, crew, ctx) { var f = at(crew.factions, d); if (!f) return; var v = clamp(d.v, -3, 3); if (f.status === v) return; f.status = v; ctx.commit(); },
      factionrm: function (d, crew, ctx) { var f = at(crew.factions, d); if (!f) return; if (f.name && !ctx.confirm('Remove the faction ' + f.name + '?')) return; crew.factions.splice(+d.i, 1); ctx.commit(); }
    };
    return { render: render, acts: acts, enter: {} };
  })();
  var crewPanel = GenericCrew;
  /* a later round swaps in a full crew sheet: { render(crew, ctx) -> html, acts: { name: fn(d, crew, ctx) }, enter: { ui: actName },
     PERM: { name: 'all' | 'gm' } (optional; a crew act is 'any' by default) } */
  M.setCrewPanel = function (panel) { crewPanel = panel && typeof panel.render === 'function' ? panel : GenericCrew; if (cur && cur.loaded) render(); };
  M.genericCrewPanel = GenericCrew;
  function crewCtx() {
    return {
      can: can, esc: esc, box: box, pips: pips, input: input, draftInput: draftInput, textarea: textarea, chip: chip, clockSvg: clockSvg,
      commit: commit, confirm: function (m) { return window.confirm(m); }, draft: function (k) { return (cur && cur.drafts[k]) || ''; }, setDraft: function (k, v) { if (cur) cur.drafts[k] = v; },
      focus: function (sel) { if (!cur) return; var n = cur.root.querySelector(sel); if (n && !n.disabled) { try { n.focus(); } catch (e) {} } },
      me: cur && cur.api ? cur.api.me : null, isGM: gm()
    };
  }

  /* ---------- the page sections ---------- */
  function head(doc) {
    var c = doc.crew;
    return '<header class="tp-head"><div class="tp-title"><span class="tp-kick">The table</span><h2 class="tp-crewname" id="tp-crewname">' + esc(c.name || 'An unnamed crew') + '</h2>' +
      '<span class="tp-subtitle">' + esc([c.type, 'Tier ' + c.tier + ' · ' + c.hold + ' hold', doc.session.number ? 'session ' + doc.session.number : ''].filter(Boolean).join(' · ')) + '</span></div>' +
      '<div class="tp-meta">' + rulesLink() + '<button type="button" class="btn sm" data-act="cast" data-always="1" title="The NPCs the table has met">The cast</button><button type="button" class="btn sm" data-act="print" data-always="1" title="Every character and the crew, one document">Print the season</button><span class="tp-role' + roleCls() + '">' + esc(role()) + '</span><span class="tp-status mono" id="tp-status" aria-live="polite"></span></div></header>';
  }
  /* the session, as one line: "Session 3 · in play" (the GM's two buttons follow it). Starting and ending are the GM's;
     what each player does at the end of a session is on their own sheet (its End session panel says so). */
  function sessionBar(doc) {
    var s = doc.session, running = s.number > 0 && !!s.startedAt && !s.endedAt;
    var state = !s.number ? '<span class="tp-sessstate">not started yet</span>' : running ? '<span class="tp-live">in play</span>' : '<span class="tp-sessstate">ended' + (s.endedAt ? ' ' + esc(when(s.endedAt)) : '') + '</span>';
    var since = running ? '<span class="tp-sessmore">since ' + esc(when(s.startedAt, true) || '—') + '</span>' : '';
    var hint = !gm() && !running ? '<span class="tp-sesshint">The GM starts ' + (s.number ? 'the next one' : 'sessions') + '.</span>' : '';
    var h = '<div class="tp-sess"><span class="tp-sessno"><span class="tp-lab">Session</span><b>' + (s.number || '—') + '</b></span>' + state + since + hint +
      (gm() ? '<div class="tp-sessbtns"><button type="button" class="btn sm primary" data-act="sessstart" data-gm="1">Start session ' + (s.number + 1) + '</button>' +
      '<button type="button" class="btn sm" data-act="sessend" data-gm="1"' + (running ? '' : ' disabled') + '>End session</button></div>' : '') + '</div>';
    return '<section class="tp-box tp-sessbox" aria-label="Session">' + h + '</section>';
  }
  function clocks(doc) {
    var list = doc.clocks.filter(function (c) { return gm() || !c.hidden; }), h = '<div class="tp-clocks">';
    list.forEach(function (c) {
      var idx = ' data-id="' + esc(c.id) + '"';
      h += '<div class="tp-clock' + (c.hidden ? ' hid' : '') + (c.filled >= c.size ? ' full' : '') + '"' + idx + '>' + clockSvg(c.size, c.filled, 34, 'clockfill', idx) +
        '<div class="tp-clockmeta">' + input('clocks.#' + c.id + '.name', c.name, 'What is this clock for?', { gm: true, label: 'Clock name' }) +
        '<div class="tp-clockline"><span class="tp-step"><button type="button" class="tp-stepb" data-act="clockstep" data-d="-1"' + idx + (c.filled <= 0 ? ' disabled' : '') + ' aria-label="Take one off">−</button><span class="mono">' + c.filled + ' / ' + c.size + '</span>' +
          '<button type="button" class="tp-stepb" data-act="clockstep" data-d="1"' + idx + (c.filled >= c.size ? ' disabled' : '') + ' aria-label="Fill one more">+</button></span><span class="tp-kind k-' + c.kind + '">' + esc(c.kind) + '</span>' + (c.hidden ? '<span class="tp-hidtag">hidden from players</span>' : '') + (c.filled >= c.size ? '<span class="tp-fulltag">full</span>' : '') + '</div>' +
        (gm() ? '<div class="tp-clocktools"><span class="seg">' + SIZES.map(function (n) { return chip(String(n), 'clocksize', c.size === n, idx + ' data-n="' + n + '"', { gm: true, title: n + ' segments' }); }).join('') + '</span>' +
          '<span class="seg">' + KINDS.map(function (k) { return chip(k, 'clockkind', c.kind === k, idx + ' data-v="' + k + '"', { gm: true }); }).join('') + '</span>' +
          chip('Hidden', 'clockhide', c.hidden, idx, { gm: true, title: 'Hide this clock from the players' }) +
          '<button type="button" class="tp-x" data-act="clockrm"' + idx + ' data-gm="1" title="Delete the clock" aria-label="Delete the clock">×</button></div>' : '') +
        '</div></div>';
    });
    if (!list.length) h += '<p class="hint">' + (gm() ? 'No shared clocks. Add the dangers, projects and faction clocks the whole table can see.' : 'No shared clocks yet.') + '</p>';
    h += '</div>';
    if (gm()) {
      var size = (cur && cur.drafts.clocksize) || 4, kind = (cur && cur.drafts.clockkind) || 'danger';
      h += '<div class="tp-addclock">' + draftInput('newclock', 'New clock', { cls: 'tp-grow', gm: true, label: 'New clock name' }) +
        '<span class="seg">' + SIZES.map(function (n) { return chip(String(n), 'newsize', size === n, ' data-n="' + n + '"', { gm: true }); }).join('') + '</span>' +
        '<span class="seg">' + KINDS.map(function (k) { return chip(k, 'newkind', kind === k, ' data-v="' + k + '"', { gm: true }); }).join('') + '</span>' +
        '<button type="button" class="btn sm" data-act="clockadd" data-gm="1">Add clock</button></div>';
    }
    var hiddenN = doc.clocks.filter(function (c) { return c.hidden; }).length;
    return box('Shared clocks' + rl('clocks'), h, '<span class="tp-dim">' + list.length + ' clock' + (list.length === 1 ? '' : 's') + (gm() && hiddenN ? ' · ' + hiddenN + ' hidden' : '') + '</span>', 'tp-clockbox');
  }
  function nameOf(id) {
    if (!id) return 'No owner yet';
    var n = cur && cur.names[id]; return n || id;
  }
  /* the schedule: everyone the page knows (owners of filed characters, everyone who answered, me) and their names */
  function schedPeople() {
    var ids = [], seen = {}, docs = [], s = cur.doc.schedule, me = cur.api.me || null;
    try { docs = (typeof cur.api.roster === 'function' ? cur.api.roster() : []) || []; } catch (e) { docs = []; }
    function add(id) { if (id && !seen[id]) { seen[id] = 1; ids.push(id); } }
    add(me); docs.forEach(function (d) { add(d.owner); }); Object.keys(s.avail).forEach(add); Object.keys(s.rsvp).forEach(add);
    return ids;
  }
  function schedName(id) { var Sm = sched(); return (cur && cur.names[id]) || (Sm && Sm.names[id]) || (id && cur && id === cur.api.me ? 'You' : 'Someone'); }
  function schedCtx() {
    var docs = [];
    try { docs = (typeof cur.api.roster === 'function' ? cur.api.roster() : []) || []; } catch (e) { docs = []; }
    return {
      sched: cur.doc.schedule, me: cur.api.me || null, isGM: gm(), ro: ro(), drafts: cur.drafts, people: schedPeople(), name: schedName,
      roster: docs, session: cur.doc.session.number,
      commit: commit, render: render, confirm: function (m) { return window.confirm(m); }, logLine: logLine,
      status: setStatus, focus: function (sel) { var n = cur && cur.root.querySelector(sel); if (n && !n.disabled) { try { n.focus(); } catch (e) {} } },
      find: function (sel) { return cur ? cur.root.querySelector(sel) : null; },
      esc: esc, box: schedBox, chip: chip
    };
  }
  /* the schedule's own box, with the GM's "Close" in its band (the GM can fold it back to one line) */
  function schedBox(title, body, right, cls, id) {
    return box(title, body, (right || '') + (gm() ? '<button type="button" class="chip sm tp-sclose" data-act="viewsched" data-always="1" aria-expanded="true">Close</button>' : ''), cls, id);
  }
  function scheduleBox(doc) { var Sm = sched(); if (!Sm || typeof Sm.box !== 'function') return ''; try { return Sm.box(doc, schedCtx()); } catch (e) { if (window.console) console.error(e); return box('Schedule', '<p class="hint bad">The schedule could not be drawn.</p>', '', 'tp-schedbox', 'tp-schedule'); } }

  /* ---------- the schedule: only while there is something to answer (players), one line until opened (the GM) ---------- */
  /* Scheduling is parked while the dates live elsewhere: a player sees the box only when a next session or an open
     date exists; the GM sees "Schedule · no dates · Plan dates" and opens it from there, or by #t/schedule. */
  function routeIsSchedule() { return /^#t\/schedule/.test(location.hash || ''); }
  function schedDated(doc) { var Sm = sched(); if (!Sm || !Sm.upcoming || !Sm.openOptions) return false; try { return !!(Sm.upcoming(doc.schedule) || Sm.openOptions(doc.schedule).length); } catch (e) { return false; } }
  function schedOpen(dated) { var v = cur.drafts['tp.sched']; return v === 'open' ? true : v === 'closed' ? false : dated; }
  function schedRow(doc, dated) {
    var Sm = sched(), s = doc.schedule, bits = [], n = Sm.upcoming(s), k = Sm.openOptions(s).length;
    if (n) bits.push('next ' + esc(Sm.fmtWhen(n.at)));
    if (k) bits.push(k + ' date' + (k === 1 ? '' : 's') + ' open');
    if (!bits.length) bits.push('no dates');
    return '<section class="tp-box tp-schedrow" id="tp-schedule" aria-label="Schedule"><span class="tp-lab">Schedule</span><span class="tp-schedsum">' + bits.join(' · ') + '</span>' +
      '<button type="button" class="btn sm" data-act="viewsched" data-always="1" aria-expanded="false">' + (dated ? 'Open' : 'Plan dates') + '</button></section>';
  }
  function scheduleSection(doc) {
    var Sm = sched(); if (!Sm || typeof Sm.box !== 'function') return '';
    var dated = schedDated(doc);
    if (!gm()) return dated || routeIsSchedule() ? scheduleBox(doc) : '';   /* a link to #t/schedule still shows a player what there is: nothing yet */
    return schedOpen(dated) ? scheduleBox(doc) : schedRow(doc, dated);
  }

  /* ---------- the crew: behind a summary row on a phone (campaign.css hides the sheet while it is folded) ---------- */
  /* Tier, Hold, Rep, Heat, Wanted, Stacks. The crew sheet gives its own numbers (turf and the vault upgrade change them). */
  function crewFacts(crew) {
    var f = crewPanel.summary ? crewPanel.summary(crew) : null; if (f) return f;
    var max = 12 - clamp(crew.turf, 0, 6);
    return { tier: crew.tier, hold: crew.hold, rep: Math.min(crew.rep, max), repMax: max, heat: crew.heat, wanted: crew.wanted, stacks: crew.vault, vault: 0 };
  }
  /* unfolded when the viewer chose so; until they choose, only while the crew is still to be set up (name, playbook) */
  function crewOpen(crew) { var v = cur.drafts['tp.crew']; return v === 'open' ? true : v === 'closed' ? false : !(crew.name || crew.playbook); }
  function crewSection(doc) {
    var c = doc.crew, f = crewFacts(c), open = crewOpen(c);
    function cell(label, val, extra, bad) { return '<span class="tp-cst' + (bad ? ' bad' : '') + '"><span class="tp-lab">' + label + '</span><b class="mono">' + val + '</b>' + (extra ? '<small>' + extra + '</small>' : '') + '</span>'; }
    var cells = cell('Tier', f.tier) + cell('Hold', f.hold === 'strong' ? 'Strong' : 'Weak') + cell('Rep', f.rep + '/' + f.repMax) + cell('Heat', f.heat + '/9', '', f.heat >= 7) + cell('Wanted', f.wanted + '/4', '', f.wanted >= 3) + cell('Stacks', f.stacks, f.vault ? '+' + f.vault + ' in vaults' : '');
    return '<div class="tp-crew' + (open ? '' : ' tp-fold') + '" id="tp-crew"><button type="button" class="tp-crewsum" data-act="viewcrew" data-always="1" aria-expanded="' + open + '" aria-controls="tp-crewbody">' +
      '<span class="tp-csh"><span>The crew' + (c.type ? ' · ' + esc(c.type) : '') + '</span><span class="tp-csgo">' + (open ? 'Fold the crew sheet' : 'Open the crew sheet') + '</span></span><span class="tp-csg">' + cells + '</span></button>' +
      '<div class="tp-crewbody" id="tp-crewbody">' + crewPanel.render(c, crewCtx()) + '</div></div>';
  }

  /* the status line without the stress bit already shown beside it */
  function rest(status, f) { var head = f.stressName + ' ' + f.stress + '/' + f.stressMax; status = String(status || ''); return status.indexOf(head) === 0 ? status.slice(head.length).replace(/^\s*·\s*/, '') : status; }
  function players() {
    var api = cur.api, docs = [];
    try { docs = (typeof api.roster === 'function' ? api.roster() : []) || []; } catch (e) { docs = []; }
    var me = api.me || null, groups = {}, order = [];
    docs.forEach(function (d) { var k = d.owner || ''; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(d); });
    order.sort(function (a, b) {
      if (!a !== !b) return a ? -1 : 1;                 /* "No owner yet" last */
      if (me && (a === me) !== (b === me)) return a === me ? -1 : 1;   /* you first */
      return nameOf(a).toLowerCase() < nameOf(b).toLowerCase() ? -1 : nameOf(a).toLowerCase() > nameOf(b).toLowerCase() ? 1 : 0;
    });
    var h = '';
    order.forEach(function (k) {
      var list = groups[k].slice().sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
      h += '<div class="tp-group" data-owner="' + esc(k || '') + '"><div class="tp-ghead"><b>' + esc(k ? nameOf(k) : 'No owner yet') + '</b>' + (k && k === me ? '<span class="tp-you">you</span>' : '') + '<span class="tp-dim mono">' + list.length + '</span></div><ul class="tp-chars">';
      list.forEach(function (d) {
        var facts = null, status = '';
        try { if (typeof api.playFacts === 'function') facts = api.playFacts(d); } catch (e) { facts = null; }
        try { if (typeof api.playStatus === 'function') status = api.playStatus(d); } catch (e) { status = ''; }
        var stress = facts && !facts.fresh && facts.stress != null ? '<span class="tp-k">' + esc(facts.stressName) + '</span><b class="mono' + (facts.stress >= facts.stressMax - 1 ? ' bad' : '') + '">' + facts.stress + '/' + facts.stressMax + '</b>' : '<span class="tp-dim">' + esc(status || 'new sheet') + '</span>';
        h += '<li class="tp-char" data-id="' + esc(d.id) + '"><span class="tp-cn"><b>' + esc(d.name || 'Unnamed') + '</b><small>' + esc([d.alias, d.playbookName || d.playbook].filter(Boolean).join(' · ')) + '</small></span>' +
          '<span class="tp-cs">' + stress + (facts && !facts.fresh && rest(status, facts) ? '<small class="tp-dim">' + esc(rest(status, facts)) + '</small>' : '') + '</span>' +
          '<button type="button" class="btn sm" data-act="open" data-id="' + esc(d.id) + '" data-always="1">Open</button></li>';
      });
      h += '</ul></div>';
    });
    if (!order.length) h = '<p class="hint">No characters yet. Each player makes theirs from Home; they appear here under their name.</p>';
    return box('The players', h, '<span class="tp-dim">' + docs.length + ' character' + (docs.length === 1 ? '' : 's') + '</span>', 'tp-playbox');
  }
  /* the log shows its latest three lines; "All" unfolds the rest (page state; every line is in the page, so print has them all) */
  var LOG_SHORT = 3;
  function logBox(doc) {
    var all = cur.drafts['tp.log'] === 'all', many = doc.log.length > LOG_SHORT;
    var h = '<div class="tp-addrow">' + draftInput('newlog', 'What happened? A line for the whole table', { cls: 'tp-grow', label: 'New log line' }) + '<button type="button" class="btn sm" data-act="logadd">Log</button></div><ol class="tp-log' + (many && !all ? ' tp-logshort' : '') + '">';
    doc.log.forEach(function (e, i) {
      h += '<li' + (i >= LOG_SHORT ? ' class="tp-logold"' : '') + '><span class="tp-logm"><span class="tp-logd mono">' + esc(when(e.at, true) || '—') + '</span>' + (e.by ? '<span class="tp-logby">' + esc(nameOf(e.by)) + '</span>' : '') + '</span><span class="tp-logt">' + esc(e.text) + '</span>' +
        (gm() ? '<button type="button" class="tp-x" data-act="logrm" data-i="' + i + '" data-gm="1" title="Remove this line" aria-label="Remove this line">×</button>' : '') + '</li>';
    });
    h += '</ol>' + (!doc.log.length ? '<p class="hint">Nothing logged yet. Session starts and ends are logged here too.</p>' : '');
    if (many) h += '<div class="tp-logmore"><button type="button" class="btn sm" data-act="viewlog" data-always="1" aria-expanded="' + all + '">' + (all ? 'Latest ' + LOG_SHORT + ' only' : 'All ' + doc.log.length) + '</button></div>';
    return box('Campaign log', h, '<span class="tp-dim">newest first' + (doc.log.length ? ' · ' + doc.log.length : '') + '</span>', 'tp-logbox');
  }

  /* names for owners and log authors, through api.profiles when the runtime has it; asked once per id */
  function askNames() {
    if (!cur || !cur.api || typeof cur.api.profiles !== 'function') return;
    var ids = {}, docs = [];
    try { docs = cur.api.roster() || []; } catch (e) { docs = []; }
    docs.forEach(function (d) { if (d.owner) ids[d.owner] = 1; });
    cur.doc.log.forEach(function (e) { if (e.by) ids[e.by] = 1; });
    Object.keys(cur.doc.schedule.avail).concat(Object.keys(cur.doc.schedule.rsvp), cur.api.me ? [cur.api.me] : []).forEach(function (id) { if (id) ids[id] = 1; });
    var want = Object.keys(ids).filter(function (id) { return !cur.asked[id]; }); if (!want.length) return;
    want.forEach(function (id) { cur.asked[id] = 1; });
    var c = cur;
    Promise.resolve().then(function () { return c.api.profiles(want); }).then(function (map) {
      if (cur !== c || !map || typeof map !== 'object') return; var any = false;
      Object.keys(map).forEach(function (id) { var v = map[id]; var n = typeof v === 'string' ? v : v && (v.name || v.email) || ''; if (n && c.names[id] !== n) { c.names[id] = n; any = true; } });
      if (any) render();
    }).catch(function () {});
  }

  /* ---------- render ---------- */
  function render() {
    if (!cur) return;
    if (!cur.loaded) { cur.root.className = 'tp'; cur.root.innerHTML = '<div class="tp-note">Reading the table…</div>'; return; }
    var focus = captureFocus(), doc = cur.doc, scroll = window.scrollY;
    var gridEl = cur.root.querySelector('.sc-scroll'), gridX = gridEl ? gridEl.scrollLeft : 0;   /* the availability grid keeps its sideways scroll */
    /* column B first: on a phone the page reads the session line, shared clocks, the log, the players, the crew and last
       the schedule (campaign.css sets column B on the left of a wide screen, the crew and schedule on the right) */
    var html = head(doc) + sessionBar(doc) +
      '<div class="tp-grid"><div class="tp-col tp-colB">' + clocks(doc) + logBox(doc) + players() + '</div>' +
      '<div class="tp-col tp-colA">' + crewSection(doc) + scheduleSection(doc) + '</div></div>';
    cur.root.innerHTML = html;
    var Sm = sched(); if (Sm && Sm.mountBoard) { try { Sm.mountBoard(cur.root); } catch (e) { if (window.console) console.error(e); } }   /* the kept line-up SVG goes back in */
    cur.root.className = 'tp' + (ro() ? ' tp-ro' : '') + (gm() ? ' tp-gm' : ' tp-player');
    /* GM-only controls are not shown to players or read-only viewers; a GM-only text field stays as its value */
    if (!gm()) cur.root.querySelectorAll('[data-gm]').forEach(function (n) { if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA') { n.disabled = true; n.title = n.title || 'Only the GM can change that'; } else n.parentNode.removeChild(n); });
    if (ro()) cur.root.querySelectorAll('button, input, textarea, select').forEach(function (n) { if (!n.dataset.always) n.disabled = true; });
    setStatus(idleStatus());
    if (gridX) { var g2 = cur.root.querySelector('.sc-scroll'); if (g2) g2.scrollLeft = gridX; }
    restoreFocus(focus);
    if (Math.abs(window.scrollY - scroll) > 2) { try { window.scrollTo(0, scroll); } catch (e) {} }
    askNames();
  }
  function captureFocus() {
    if (!cur) return null; var a = document.activeElement; if (!a || !cur.root.contains(a)) return null;
    if (a.tagName === 'BUTTON' && /^sched\.|^crew\.cspick$|^view(crew|log|sched)$|^clockstep$/.test(a.dataset.act || '')) return { btn: '[data-act="' + a.dataset.act + '"]' + (a.dataset.o ? '[data-o="' + a.dataset.o + '"]' : '') + (a.dataset.n ? '[data-n="' + a.dataset.n + '"]' : '') + (a.dataset.v ? '[data-v="' + a.dataset.v + '"]' : '') + (a.dataset.u ? '[data-u="' + a.dataset.u.replace(/["\\]/g, '\\$&') + '"]' : '') + (a.dataset.act === 'clockstep' ? '[data-id="' + String(a.dataset.id || '').replace(/["\\]/g, '\\$&') + '"][data-d="' + a.dataset.d + '"]' : '') };   /* a schedule cell or chip, a clock's − / +, or the covers' toggle keeps the keyboard focus */
    if (a.tagName !== 'INPUT' && a.tagName !== 'TEXTAREA' && a.tagName !== 'SELECT') return null;
    return { path: a.dataset.path || null, ui: a.dataset.ui || null, value: a.value, s: a.selectionStart, e: a.selectionEnd };
  }
  function restoreFocus(f) {
    if (!f || !cur) return; var n = null;
    if (f.btn) { n = cur.root.querySelector(f.btn); if (n && !n.disabled) { try { n.focus({ preventScroll: true }); } catch (e) {} } return; }
    if (f.path) n = cur.root.querySelector('[data-path="' + f.path.replace(/"/g, '\\"') + '"]');
    else if (f.ui) n = cur.root.querySelector('[data-ui="' + f.ui.replace(/"/g, '\\"') + '"]');
    if (!n || n.disabled) return; if (n.value !== f.value) n.value = f.value;
    try { n.focus({ preventScroll: true }); if (f.s != null && n.setSelectionRange) n.setSelectionRange(f.s, f.e); } catch (e) {}
  }

  /* ---------- actions (each says who may do it) ---------- */
  function byId(id) { return cur.doc.clocks.filter(function (c) { return c.id === id; })[0] || null; }
  function logLine(text) { cur.doc.log.unshift({ at: nowIso(), by: cur.api.me || null, text: text }); if (cur.doc.log.length > LOG_MAX) cur.doc.log.length = LOG_MAX; }
  var PERM = { sessstart: 'gm', sessend: 'gm', clockfill: 'any', clockstep: 'any', clocksize: 'gm', clockkind: 'gm', clockhide: 'gm', clockrm: 'gm', clockadd: 'gm', newsize: 'gm', newkind: 'gm', logadd: 'any', logrm: 'gm', open: 'all', print: 'all', cast: 'all', viewcrew: 'all', viewlog: 'all', viewsched: 'all' };
  var ACTS = {
    sessstart: function () {
      var n = cur.doc.session.number + 1, now = nowIso();
      cur.doc.session = { number: n, startedAt: now, endedAt: null };
      var Sm = sched(); if (Sm && Sm.onSessionStart) Sm.onSessionStart(cur.doc.schedule, Date.now(), n);   /* same write: next (its answers become session n's attendance) and the dates around now go */
      logLine('Session ' + n + ' started'); commit();
    },
    sessend: function () {
      var s = cur.doc.session; if (!s.number || s.endedAt) return;
      s.endedAt = nowIso(); logLine('Session ' + s.number + ' ended'); commit();
    },
    clockfill: function (d) { var c = byId(d.id); if (!c) return; c.filled = clamp(toggleTrack(c.filled, +d.n), 0, c.size); commit(); },
    clockstep: function (d) { var c = byId(d.id); if (!c) return; var n = clamp(c.filled + (+d.d < 0 ? -1 : 1), 0, c.size); if (n === c.filled) return; c.filled = n; commit(); },
    clocksize: function (d) { var c = byId(d.id); if (!c) return; var n = +d.n; if (SIZES.indexOf(n) < 0 || c.size === n) return; c.size = n; c.filled = Math.min(c.filled, n); commit(); },
    clockkind: function (d) { var c = byId(d.id); if (!c || KINDS.indexOf(d.v) < 0 || c.kind === d.v) return; c.kind = d.v; commit(); },
    clockhide: function (d) { var c = byId(d.id); if (!c) return; c.hidden = !c.hidden; commit(); },
    clockrm: function (d) { var c = byId(d.id); if (!c) return; if (!window.confirm('Delete the clock' + (c.name ? ' “' + c.name + '”' : '') + '? Everyone at the table loses it.')) return; cur.doc.clocks = cur.doc.clocks.filter(function (x) { return x.id !== c.id; }); commit(); },
    newsize: function (d) { cur.drafts.clocksize = +d.n || 4; render(); },
    newkind: function (d) { cur.drafts.clockkind = KINDS.indexOf(d.v) >= 0 ? d.v : 'danger'; render(); },
    clockadd: function () {
      var name = String(cur.drafts.newclock || '').trim();
      cur.doc.clocks.push({ id: newClockId(), name: name, size: cur.drafts.clocksize || 4, filled: 0, kind: cur.drafts.clockkind || 'danger', hidden: false });
      cur.drafts.newclock = ''; commit();
      if (!name) { var ins = cur.root.querySelectorAll('.tp-clock .tp-in'); if (ins.length) try { ins[ins.length - 1].focus(); } catch (e) {} }
    },
    logadd: function () {
      var v = String(cur.drafts.newlog || '').trim();
      if (!v) { var n = cur.root.querySelector('[data-ui="newlog"]'); if (n) n.focus(); return; }
      logLine(v); cur.drafts.newlog = ''; commit();
      var n2 = cur.root.querySelector('[data-ui="newlog"]'); if (n2) try { n2.focus(); } catch (e) {}
    },
    logrm: function (d) { var e = cur.doc.log[+d.i]; if (!e) return; if (!window.confirm('Remove this line from the log?\n' + e.text)) return; cur.doc.log.splice(+d.i, 1); commit(); },
    /* what is folded away is page state only: it redraws, it never saves (read-only viewers may unfold too) */
    viewcrew: function () { cur.drafts['tp.crew'] = crewOpen(cur.doc.crew) ? 'closed' : 'open'; render(); },
    viewlog: function () { cur.drafts['tp.log'] = cur.drafts['tp.log'] === 'all' ? '' : 'all'; render(); },
    viewsched: function () { cur.drafts['tp.sched'] = schedOpen(schedDated(cur.doc)) ? 'closed' : 'open'; render(); },
    open: function (d) { if (cur.api && typeof cur.api.openCharacter === 'function') cur.api.openCharacter(d.id); },
    print: function () { if (window.B68Season && typeof B68Season.open === 'function') B68Season.open(); },
    cast: function () { if (window.B68CastPage && typeof B68CastPage.open === 'function') location.hash = '#cast'; }
  };
  var ENTER = { newlog: 'logadd', newclock: 'clockadd' };
  function allowed(perm) { return perm === 'all' ? true : perm === 'gm' ? gm() : !ro(); }
  function attrs(t) { var d = {}; for (var i = 0; i < t.attributes.length; i++) { var a = t.attributes[i]; if (a.name.indexOf('data-') === 0) d[a.name.slice(5)] = a.value; } return d; }
  function run(act, d, t) {
    try {
      if (act.indexOf('sched.') === 0) { var Sm = sched(), nm = act.slice(6), sf = Sm && Sm.acts && Sm.acts[nm]; if (!sf || !allowed((Sm.PERM && Sm.PERM[nm]) || 'gm')) return; sf(d, schedCtx(), t); return; }
      if (act.indexOf('crew.') === 0) { var cn = act.slice(5), fn = crewPanel.acts && crewPanel.acts[cn]; if (!fn || !allowed((crewPanel.PERM && crewPanel.PERM[cn]) || 'any')) return; fn(d, cur.doc.crew, crewCtx(), t); return; }
      if (!ACTS[act] || !allowed(PERM[act] || 'gm')) return;
      ACTS[act](d, t);
    } catch (err) { setStatus('Something went wrong: ' + (err && err.message || err), true); if (window.console) console.error(err); }
  }
  function onClick(e) {
    if (!cur) return; var t = e.target && e.target.closest ? e.target.closest('[data-act]') : null; if (!t || !cur.root.contains(t)) return;
    if (t.disabled) return; run(t.getAttribute('data-act'), attrs(t), t);
  }
  function pathPerm(path) { return path.indexOf('crew.') === 0 ? 'any' : 'gm'; }
  function onInput(e) {
    if (!cur) return; var t = e.target; if (!t || !t.dataset || !cur.root.contains(t)) return;
    if (t.dataset.ui) { cur.drafts[t.dataset.ui] = t.value; return; }   /* drafts are page state, never saved by themselves */
    var path = t.dataset.path; if (!path || !allowed(pathPerm(path))) return;
    if (!setPath(cur.doc, path, t.value)) return;
    cur.dirty[path] = true;
    if (path === 'crew.name') { var h = cur.root.querySelector('#tp-crewname'); if (h) h.textContent = t.value || 'An unnamed crew'; }
    scheduleSave();
  }
  function onChange(e) {
    if (!cur) return; var t = e.target; if (!t || !t.dataset) return;
    var Sm = sched(), sa = t.dataset.ui && Sm && Sm.CHANGE ? Sm.CHANGE[t.dataset.ui] : null;
    if (sa) { cur.drafts[t.dataset.ui] = t.value; if (!t.disabled) run('sched.' + sa, attrs(t), t); return; }
    if (t.dataset.path && cur.timer) flushSave();
  }
  function onKey(e) {
    if (!cur || e.key !== 'Enter') return; var t = e.target; if (!t || t.tagName !== 'INPUT' || !cur.root.contains(t)) return;
    var Sm = sched(), ui = t.dataset.ui, act = ui ? ENTER[ui] || (crewPanel.enter && crewPanel.enter[ui] ? 'crew.' + crewPanel.enter[ui] : null) || (Sm && Sm.ENTER && Sm.ENTER[ui] ? 'sched.' + Sm.ENTER[ui] : null) : null;
    if (act) { e.preventDefault(); if (!t.disabled) run(act, attrs(t), t); return; }
    if (t.dataset.path && cur.timer) { e.preventDefault(); flushSave(); }
  }

  /* ---------- API ---------- */
  /* api = { save(patch) -> Promise, replace(wholeDoc) -> Promise (GM only: log removals), me, canWrite, isGM, roster(), openCharacter(id), playStatus(doc), playFacts(doc), profiles(ids) | null }
     patch: changed top-level fields of session / clocks / log, the changed crew fields, and the changed schedule leaves */
  M.open = function (api) {
    var root = document.getElementById('table-page'); if (!root) return;
    if (cur) M.close();
    cur = { api: api || {}, root: root, doc: normalize(null), base: normalize(null), raw: {}, loaded: false, dirty: {}, timer: null, saving: 0, drafts: {}, names: {}, asked: {}, statusT: null, everSaved: false };
    if (routeIsSchedule()) cur.drafts['tp.sched'] = 'open';
    root.addEventListener('click', onClick); root.addEventListener('input', onInput); root.addEventListener('change', onChange); root.addEventListener('keydown', onKey);
    window.addEventListener('hashchange', onHash);
    render();
  };
  /* #t/schedule (Home's "Plan dates", a link): the schedule opens, wherever it was folded */
  function onHash() { if (!cur || !routeIsSchedule()) return; cur.drafts['tp.sched'] = 'open'; if (cur.loaded) render(); }
  /* a snapshot arrived (first or newer): null / partial documents read as the default */
  M.update = function (data) {
    if (!cur) return;
    var incoming = normalize(data), focus = captureFocus();
    /* text still waiting to be saved, and the field being typed in, are never clobbered */
    Object.keys(cur.dirty).forEach(function (p) { var v = getPath(cur.doc, p); if (v !== undefined) setPath(incoming, p, v); });
    if (focus && focus.path) setPath(incoming, focus.path, focus.value);
    cur.raw = isObj(data) ? clone(data) : {}; cur.base = normalize(data); cur.doc = incoming; cur.loaded = true;
    render();
  };
  M.rosterChanged = function () { if (cur && cur.loaded) render(); };
  /* a plain note instead of the page (no store, read failed, loading) */
  M.notice = function (msg, bad) {
    var root = document.getElementById('table-page'); if (!root) return;
    if (cur) M.close();
    root.className = 'tp'; root.innerHTML = '<div class="tp-note' + (bad ? ' bad' : '') + '">' + esc(msg) + '</div>';
  };
  M.close = function () {
    if (!cur) return; var c = cur;
    if (c.timer) { clearTimeout(c.timer); c.timer = null; flushSave(); }   /* typed text still waiting goes out first */
    cur = null; if (c.statusT) clearTimeout(c.statusT);
    c.root.removeEventListener('click', onClick); c.root.removeEventListener('input', onInput); c.root.removeEventListener('change', onChange); c.root.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', onHash);
    c.root.innerHTML = ''; c.root.className = 'tp';
  };
  M.isOpen = function () { return !!cur; };
  M.doc = function () { return cur ? clone(cur.doc) : null; };
})();
