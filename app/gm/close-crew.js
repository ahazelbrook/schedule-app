/* gm/close-crew.js: the close writes heat and Wanted back (close.crew, RK07 of the room key build). In the close-crew bundle (app/routes.js), fetched only
   while its setting is on. Plain script, UMD: window.B68GmCloseCrew in the browser, module.exports under Node. ES5, as the files beside it.

   WHAT IT ADDS to the Aftermath (app/gm/aftermath.js calls it through host.closeCrew(), which is null while the setting is off, so the show is what it was):
     Heat (RK07.1, 07.2)   the Modifiers number becomes labelled ticks plus a free house add-on (+ or -, with its own label), and a "rule: heat" chip that opens
                           the rules' own text (B68Rules at runtime: no book text here, only short labels and numbers). Next on the heat step writes the
                           crew's heat and Wanted to the campaign document, once: absolute values, guarded by crewWritten.
     Status (RK07.3)       a picker over the factions already on the crew sheet (crew.factions), a change of -3 to +3 each, logged in the night log and sent to
                           the iPad as status lines. crew.factions is NEVER written (Gate 0 ruling 4: the array replaces whole and would race the crew sheet).
     Tithe (RK07.4)        what the crew keeps, split over the PCs: shown here and logged. No player's sheet is written.
     Xp (RK07.5)           each PC's playbook trigger and the crew's triggers as ticks, on the GM's side. The phones' commend card is unchanged.
     Open (RK07.6)         free lines (questions the night left open), kept in night.aftermath.data.open only, never the campaign log.

   THE WRITE. The campaign PATCH deep-merges `crew` (functions/api/campaign.js, http.js deepMerge), so { crew: { heat, wanted } } changes those two fields
   and nothing else of the crew sheet; the server's own read-modify-write loop is the optimistic guard. heat = heatOutcome(...).after;
   wanted = min(4, wanted + wantedUp) ('68: at 9 or more, gain a Wanted level and clear Heat; the excess does not carry over).
   ONCE: night.aftermath.data.crewWritten holds { from, to, at } as a JSON string (the night's aftermath data is a flat bag of strings, numbers and booleans,
   gm/night.js cleanData). `from` is the heat and Wanted before the close. The run's own numbers never change after the write, so Back and Next again send the
   same absolute values. A fresh Start is a new close (a second score adds to the first); while the crew still holds `to`, the earlier close is kept as
   lastClose and the heat step offers "Redo that close", which starts again from its `from` (so correcting it never adds the heat twice).

   PURE (Node tests)
     REASONS KEYS HOUSE_MAX OPEN_MAX
     reasonsOf(text) -> [id]               modsOf(data) -> -6..6 (ticks + house)          target(data, heatOutcome) -> { from, to, siren }
     packWritten(w) -> string              parseWritten(text) -> { from, to, at } | null   seed(crewNow, data) -> { heat, wanted, written } (written: the string kept, or '')
     picksOf(text) -> [{ name, d }]        packPicks(list) -> string                       pickLines(picks) -> ['Name +1']
     split(stacks, tithe, n) -> { kept, n, each, over }          openOf(text) -> [line]    packOpen(text) -> string
     xpList(pcs, crewType, Content, Crews) -> [{ key, who, line }]                         clean(key, value) -> the stored value
     begin(d, crewNow, prev)   set(data, patch)   payload(stepId, data, pl) -> pl          onNext(stepId, run, x, ctx) -> Promise
   PAGE
     feed(o, ctx)              gm-page.js aftermathFeed's branch: adds writeCrew, factions, crewType and pcs to the feed (ctx: { camp, api, pcs() })
     writer(api) -> fn(crew)   PATCH { crew: { heat, wanted } } through the page's store (api.db(): the queued, optimistic adapter the table uses)
     paintHeat(form, st, ui)   paintStatus(form, st, ui)   paintTithe(form, st, ui)   paintXp(form, st, ui)   paintOpen(box, st, ui)
       ui: { el, btn, set(patch), heatOutcome, rules: B68Rules | null, factions(), pcs(), crewType(), Content, Crews } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmCloseCrew = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* heat reasons: short neutral labels and the numbers they add. The rules' own words open from the chip */
  var REASONS = [
    { id: 'profile', label: 'High-profile target', n: 1 },
    { id: 'turf', label: 'Hostile turf', n: 1 },
    { id: 'war', label: 'At war', n: 1 },
    { id: 'killing', label: 'A killing', n: 2 }
  ];
  /* the night's aftermath data keys this file adds (aftermath.js DATA_KEYS has the rest); 12 + 7 is inside night.js's 24 */
  var KEYS = ['heatWhy', 'house', 'houseWhy', 'crewWritten', 'lastClose', 'picks', 'open', 'xpTicks'];
  var HOUSE_MAX = 6, OPEN_MAX = 200, PICKS_MAX = 6, LABEL_MAX = 40;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function int(v, lo, hi, d) { if (v === '' || v == null) return d; var n = Math.floor(+v); return isFinite(n) && n >= lo && n <= hi ? n : d; }
  function clamp(v, lo, hi) { var n = Math.floor(+v); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0; }
  function one(s, n) { s = str(s).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).trim() : s; }
  function signed(n) { return n > 0 ? '+' + n : n < 0 ? '−' + (-n) : '0'; }
  function reason(id) { for (var i = 0; i < REASONS.length; i++) if (REASONS[i].id === id) return REASONS[i]; return null; }

  /* ---------- heat ---------- */
  function reasonsOf(text) {
    var seen = {};
    return str(text).split(',').map(function (x) { return x.trim(); }).filter(function (id) { if (!reason(id) || seen[id]) return false; seen[id] = true; return true; });
  }
  function modsOf(data) {
    var d = isObj(data) ? data : {}, n = 0;
    reasonsOf(d.heatWhy).forEach(function (id) { n += reason(id).n; });
    return clamp(n + (d.house === '' || d.house == null ? 0 : clamp(d.house, -HOUSE_MAX, HOUSE_MAX)), -6, 6);
  }
  /* from: the numbers before the close (the run's own, which the crew sheet seeded); to: what the crew is written */
  function target(data, heatOutcome) {
    var d = isObj(data) ? data : {}, heat = int(d.heat, 0, 9, 0), wanted = int(d.wanted, 0, 4, 0);
    var out = heatOutcome(heat, d.exposure, d.mods);
    return { from: { heat: heat, wanted: wanted }, to: { heat: out.after, wanted: Math.min(4, wanted + out.wantedUp) }, siren: out.siren === true };
  }
  function crewPair(c) { return isObj(c) ? { heat: int(c.heat, 0, 9, -1), wanted: int(c.wanted, 0, 4, -1) } : null; }
  function okPair(p) { return !!p && p.heat >= 0 && p.wanted >= 0; }
  function samePair(a, b) { return okPair(a) && okPair(b) && a.heat === b.heat && a.wanted === b.wanted; }
  /* the heat step's inputs a close was written with (exposure, modifiers, the reasons ticked, the house add-on), so Same score and Redo give them back whole */
  function inputsOf(d) {
    d = isObj(d) ? d : {};
    return { x: int(d.exposure, 0, 6, 0), m: int(d.mods, -6, 6, 0), h: reasonsOf(d.heatWhy).join(','), a: d.house === '' || d.house == null ? 0 : clamp(d.house, -HOUSE_MAX, HOUSE_MAX) };
  }
  function packWritten(w) {
    var o = { from: { heat: w.from.heat, wanted: w.from.wanted }, to: { heat: w.to.heat, wanted: w.to.wanted }, at: Math.floor(+w.at) || 0 };
    if (isObj(w.inputs)) o.in = inputsOf({ exposure: w.inputs.x, mods: w.inputs.m, heatWhy: w.inputs.h, house: w.inputs.a });
    return JSON.stringify(o);
  }
  function parseWritten(text) {
    var j = null; try { j = JSON.parse(str(text)); } catch (e) { j = null; }
    if (!isObj(j)) return null;
    var f = crewPair(j.from), t = crewPair(j.to);
    if (!okPair(f) || !okPair(t)) return null;
    var w = { from: f, to: t, at: int(j.at, 0, 8.64e15, 0) };
    if (isObj(j.in)) w.inputs = inputsOf({ exposure: j.in.x, mods: j.in.m, heatWhy: j.in.h, house: j.in.a });
    return w;
  }
  /* the run's heat step put back to a written close: the numbers before it and the inputs it was written with, so Next writes its `to` again */
  function restore(d, w) {
    d.heat = w.from.heat; d.wanted = w.from.wanted;
    if (!w.inputs) return d;
    d.exposure = w.inputs.x; d.mods = w.inputs.m;
    if (w.inputs.h) d.heatWhy = w.inputs.h; else delete d.heatWhy;
    if (w.inputs.a) d.house = w.inputs.a; else delete d.house;
    return d;
  }
  /* the earlier close tonight that a fresh Start must ask about: its stored string while the crew still holds what it wrote, else '' (the crew moved since) */
  function earlier(crewNow, data) {
    var t = isObj(data) ? str(data.crewWritten) : '', w = parseWritten(t);
    return w && samePair(crewPair(crewNow), w.to) ? t : '';
  }
  function seed(crewNow, data) {
    var t = earlier(crewNow, data), w = parseWritten(t), now = crewPair(crewNow);
    if (w) return { heat: w.from.heat, wanted: w.from.wanted, written: t };
    return { heat: okPair(now) ? now.heat : 0, wanted: okPair(now) ? now.wanted : 0, written: '' };
  }

  /* ---------- status by faction ---------- */
  function picksOf(text) {
    var j = null; try { j = JSON.parse(str(text) || '[]'); } catch (e) { j = null; }
    var out = [], seen = {};
    (Array.isArray(j) ? j : []).forEach(function (p) {
      if (!Array.isArray(p) || out.length >= PICKS_MAX) return;
      var name = one(p[0], LABEL_MAX), d = int(p[1], -3, 3, 0), k = name.toLowerCase();
      if (!name || !d || seen[k]) return;
      seen[k] = true; out.push({ name: name, d: d });
    });
    return out;
  }
  /* the stored picks: a JSON list of [name, change], the zeros dropped, cut to fit the night's 200 characters */
  function packPicks(list) {
    var out = [];
    picksOf(JSON.stringify((Array.isArray(list) ? list : []).map(function (p) { return isObj(p) ? [p.name, p.d] : p; }))).forEach(function (p) {
      var next = out.concat([[p.name, p.d]]);
      if (JSON.stringify(next).length <= OPEN_MAX) out = next;
    });
    return out.length ? JSON.stringify(out) : '';
  }
  function pickLines(picks) { return (Array.isArray(picks) ? picks : []).map(function (p) { return p.name + ' ' + signed(p.d); }); }

  /* ---------- the payout split ---------- */
  function split(stacks, tithe, n) {
    var kept = Math.max(0, int(stacks, 0, 99, 0) - int(tithe, 0, 99, 0)), k = int(n, 0, 12, 0);
    var each = k ? Math.floor(kept / k) : 0;
    return { kept: kept, n: k, each: each, over: k ? kept - each * k : kept };
  }
  function splitLine(s) {
    if (!s.n) return 'Kept ' + s.kept + ' stacks. No PCs to split them over.';
    return 'Kept ' + s.kept + ' stacks: ' + s.each + ' each for ' + s.n + ' PC' + (s.n === 1 ? '' : 's') + (s.over ? ', ' + s.over + ' left over.' : '.');
  }

  /* ---------- open lines ---------- */
  function openOf(text) { return str(text).split('|').map(function (x) { return one(x, 80); }).filter(Boolean); }
  function packOpen(text) {
    var out = '';
    str(text).split(/\r?\n|\|/).map(function (x) { return one(x, 80); }).filter(Boolean).forEach(function (l) { var next = out ? out + ' | ' + l : l; if (next.length <= OPEN_MAX) out = next; });
    return out;
  }

  /* ---------- xp ---------- */
  function pcName(p) { return one(p && (p.name || p.alias), 40) || 'Unnamed'; }
  function xpList(pcs, crewType, Content, Crews) {
    var out = [], byId = Content && isObj(Content.byId) ? Content.byId : {};
    (Array.isArray(pcs) ? pcs : []).forEach(function (p) {
      if (!isObj(p) || !str(p.id)) return;
      var pb = byId[str(p.playbook)], line = pb && str(pb.xp) ? 'You addressed a challenge with ' + str(pb.xp).replace(/^address a challenge with /i, '') : '';
      out.push({ key: 'p:' + one(p.id, 40), who: pcName(p) + (pb && pb.name ? ' (' + str(pb.name) + ')' : ''), line: line || 'No playbook trigger on file.' });
    });
    var crews = Crews && Array.isArray(Crews.CREWS) ? Crews.CREWS : [], t = str(crewType).toLowerCase().trim(), crew = null;
    crews.forEach(function (c) { if (isObj(c) && t && (str(c.id).toLowerCase() === t || str(c.name).toLowerCase() === t)) crew = c; });
    if (crew && Array.isArray(crew.xpTriggers)) crew.xpTriggers.forEach(function (line, i) { out.push({ key: 'c:' + i, who: 'The crew', line: str(line) }); });
    return out;
  }
  function ticksOf(text) { return str(text).split(',').map(function (x) { return x.trim(); }).filter(Boolean); }

  /* ---------- the data the GM types ---------- */
  function clean(k, v) {
    if (k === 'heatWhy') return reasonsOf(v).join(',');
    if (k === 'house') return clamp(v, -HOUSE_MAX, HOUSE_MAX);
    if (k === 'houseWhy') return one(v, LABEL_MAX);
    if (k === 'picks') return packPicks(Array.isArray(v) ? v : picksOf(v));
    if (k === 'open') return packOpen(v);
    if (k === 'xpTicks') { var out = ''; ticksOf(v).forEach(function (t) { var n = out ? out + ',' + t : t; if (n.length <= OPEN_MAX) out = n; }); return out; }
    return undefined;     /* crewWritten is never typed: only onNext writes it */
  }
  /* start(how): d is the new run's data, seeded from the crew sheet; prev is the night's aftermath data from the run before, if any.
     When the crew still holds what an earlier close tonight wrote, Start asks (the overseer's ruling at Gate 2):
       'same'  Same score: that close again, with its numbers and every input it had (its stacks, picks, Open lines ...). Next writes its `to` again.
       'new'   A new score: a fresh close from the crew as it stands; the earlier one is kept as lastClose, and the heat step's Redo puts it back.
     With no earlier close, how is ignored and it is a new close. */
  var NOT_CARRIED = ['pos', 'pending', 'lastClose'];
  function begin(d, crewNow, prev, how) {
    var p = isObj(prev) ? prev : {}, t = earlier(crewNow, p), w = parseWritten(t), now = crewPair(crewNow);
    if (w && how === 'same') {
      Object.keys(p).forEach(function (k) { if (NOT_CARRIED.indexOf(k) < 0) d[k] = p[k]; });
      restore(d, w); d.crewWritten = t;
      return d;
    }
    d.heat = okPair(now) ? now.heat : 0; d.wanted = okPair(now) ? now.wanted : 0;
    if (w) d.lastClose = t;
    if (str(p.open)) d.open = packOpen(p.open);      /* the night's open lines outlive a restart of the show */
    return d;
  }
  function set(data, patch) {
    var ticks = false, last = parseWritten(data.lastClose);
    if (patch.redo === true && last) { restore(data, last); data.crewWritten = data.lastClose; delete data.lastClose; }      /* Redo that close: its numbers and inputs */
    KEYS.forEach(function (k) {
      if (!(k in patch) || k === 'crewWritten' || k === 'lastClose') return;
      data[k] = clean(k, patch[k]);
      if (k === 'heatWhy' || k === 'house') ticks = true;
    });
    if (ticks) data.mods = modsOf(data);
    return data;
  }
  /* a patch of GM-only fields alone (they change nothing the iPad draws), so the step is not sent again for it */
  var QUIET = ['open', 'xpTicks', 'houseWhy'];
  function quiet(patch) { var k = isObj(patch) ? Object.keys(patch) : []; return k.length > 0 && k.every(function (x) { return QUIET.indexOf(x) >= 0; }); }
  /* the status step's iPad lines: the picks first, then what the GM typed (aftermath.js lines()), six at most */
  function payload(id, data, pl) {
    if (id !== 'status' || !pl || !isObj(pl.payload)) return pl;
    var picks = pickLines(picksOf(isObj(data) ? data.picks : ''));
    if (!picks.length) return pl;
    var l = picks.concat(Array.isArray(pl.payload.lines) ? pl.payload.lines : []).slice(0, 6);
    var p = {}; Object.keys(pl.payload).forEach(function (k) { p[k] = pl.payload[k]; }); p.lines = l;
    return { kind: pl.kind, payload: p };
  }
  function writtenLine(w) {
    return 'Crew written: Heat ' + w.from.heat + ' → ' + w.to.heat + ', Wanted ' + w.from.wanted + ' → ' + w.to.wanted;
  }
  function picksLine(picks) { return 'Status: ' + pickLines(picks).join(', '); }
  function xpLine(data, list) {
    var on = ticksOf(data && data.xpTicks), names = [], crewN = 0, crewAll = 0;
    list.forEach(function (x) { if (x.key.charAt(0) === 'c') { crewAll++; if (on.indexOf(x.key) >= 0) crewN++; } else if (on.indexOf(x.key) >= 0) names.push(x.who.replace(/ \(.*\)$/, '')); });
    if (!names.length && !crewN) return '';
    return 'Xp: ' + (names.length ? names.join(', ') : 'no PC') + (crewAll ? '; crew ' + crewN + ' of ' + crewAll : '');
  }
  /* a line into the night log, once: the same text already logged is not logged again (Back and Next) */
  function logOnce(night, text) {
    if (!night || !text || typeof night.stamp !== 'function') return;
    var N = typeof night.night === 'function' ? night.night() : null, log = N && isObj(N.log) ? N.log : {}, t = one(text, 80);
    for (var k in log) if (Object.prototype.hasOwnProperty.call(log, k) && isObj(log[k]) && one(log[k].text, 80) === t) return;
    night.stamp(t);
  }
  function pcsOf(x) { var a = x && typeof x.pcs === 'function' ? x.pcs() : []; return Array.isArray(a) ? a : []; }
  /* Next was pressed on a step (the step is done): the heat step writes the crew, the tithe, status and xp steps log. x is host.closeCrew()'s answer;
     ctx: { heatOutcome, now(), toast(msg, bad), night() } */
  function onNext(id, run, x, ctx) {
    var d = run.data, night = ctx.night();
    if (id === 'heat') {
      var t = target(d, ctx.heatOutcome), at = ctx.now();
      return Promise.resolve().then(function () { return x.write(t.to); }).then(function () {
        d.crewWritten = packWritten({ from: t.from, to: t.to, at: at, inputs: { x: d.exposure, m: d.mods, h: d.heatWhy, a: d.house } });
        logOnce(night, writtenLine(t));
      }, function (e) {
        ctx.toast('Could not write heat and Wanted to the crew: ' + (e && e.message || e) + '. Back, then Next, tries again.', true);
      });
    }
    if (id === 'tithe') logOnce(night, splitLine(split(d.stacks, d.tithe, pcsOf(x).length)));
    if (id === 'status') { var p = picksOf(d.picks); if (p.length) logOnce(night, picksLine(p)); }
    if (id === 'xp') logOnce(night, xpLine(d, xpList(pcsOf(x), typeof x.crewType === 'function' ? x.crewType() : '', x.Content, x.Crews)));
    return Promise.resolve();
  }

  /* ---------- the page ---------- */
  function writer(api) {
    return function (crew) {
      var db = api && typeof api.db === 'function' ? api.db() : null, ref = null;
      try { ref = db ? db.collection('campaign').doc('main') : null; } catch (e) { ref = null; }
      if (!ref || typeof ref.update !== 'function') return Promise.reject(new Error('the table is not available here'));
      var h = int(crew && crew.heat, 0, 9, -1), w = int(crew && crew.wanted, 0, 4, -1);
      if (h < 0 || w < 0) return Promise.reject(new Error('not a heat and Wanted'));
      return Promise.resolve().then(function () { return ref.update({ crew: { heat: h, wanted: w } }); });
    };
  }
  /* gm-page.js aftermathFeed, while the setting is on: what the close needs of the page. The PCs are tonight's (session.present) when the table has them */
  function feed(o, ctx) {
    var camp = isObj(ctx && ctx.camp) ? ctx.camp : {}, crew = isObj(camp.crew) ? camp.crew : {};
    var present = isObj(camp.session) && Array.isArray(camp.session.present) ? camp.session.present.map(str) : [];
    o.writeCrew = writer(ctx && ctx.api);
    o.factions = (Array.isArray(crew.factions) ? crew.factions : []).filter(function (f) { return isObj(f) && one(f.name, LABEL_MAX); })
      .map(function (f) { return { name: one(f.name, LABEL_MAX), status: clamp(f.status, -3, 3) }; });
    o.crewType = str(crew.type);
    o.pcs = function () {
      var all = []; try { all = ctx && typeof ctx.pcs === 'function' ? ctx.pcs() : []; } catch (e) { all = []; }
      all = (Array.isArray(all) ? all : []).filter(function (c) { return isObj(c) && str(c.id); }).map(function (c) { return { id: str(c.id), name: str(c.name), alias: str(c.alias), playbook: str(c.playbook) }; });
      var here = all.filter(function (c) { return present.indexOf(c.id) >= 0; });
      return here.length ? here : all;
    };
    return o;
  }

  /* the panel's extras, drawn into the Aftermath's own form (aftermath.js paint). Every string goes in as text */
  function chip(ui, label, on, fn) { var b = ui.btn(label, fn, 'chip'); b.setAttribute('aria-pressed', String(!!on)); return b; }
  function row(ui, label, minW) {
    var r = ui.el('div', 'seg cc-row'); r.style.flexWrap = 'wrap'; r.style.gap = '6px'; r.style.alignItems = 'center';
    if (label) { var s = ui.el('span', 'gm-lab', label + ' '); if (minW) s.style.minWidth = minW; r.appendChild(s); }
    return r;
  }
  function ruleChip(ui, term) {
    var txt = ui.el('p', 'gm-dim cc-rule-text'), open = false;
    txt.hidden = true;
    var b = ui.btn('▶ rule: ' + term, function () {
      open = !open; b.setAttribute('aria-expanded', String(open)); txt.hidden = !open;
      if (!open || txt.textContent) return;
      txt.textContent = 'Loading…';
      var R = ui.rules;
      if (!R || typeof R.hits !== 'function' || typeof R.entry !== 'function') { txt.textContent = 'The rules are not available here.'; return; }
      Promise.resolve().then(function () { return typeof R.load === 'function' ? R.load() : null; }).then(function () {
        var h = R.hits(term, 1), first = h && h.hits && h.hits[0], e = first ? R.entry(first.id) : null;
        txt.textContent = e && str(e.md) ? (str(e.title) ? str(e.title) + ': ' : '') + str(e.md).replace(/\s+/g, ' ').trim().slice(0, 900) : 'No rule called “' + term + '” in the rules this device holds.';
      }).then(null, function () { txt.textContent = 'The rules could not load.'; });
    }, 'chip cc-rule-chip');
    b.setAttribute('aria-expanded', 'false');
    /* the rule chips' own blue (prep.css --pp-file), outlined: never the accent, which is PANIC's and the Primary's */
    b.style.background = 'transparent'; b.style.borderColor = 'var(--pp-file, currentColor)'; b.style.color = 'var(--pp-file, inherit)'; b.style.boxShadow = 'none';
    return { chip: b, text: txt };
  }
  /* the line beside Next on the heat step: exactly what Next will write (target()), and the earlier write when it differs */
  function writeLine(data, heatOutcome) {
    var d = isObj(data) ? data : {}, t = target(d, heatOutcome), w = parseWritten(d.crewWritten);
    var s = 'Next writes the crew: Heat ' + t.from.heat + ' → ' + t.to.heat + ' · Wanted ' + t.from.wanted + ' → ' + t.to.wanted;
    if (!w) return s;
    if (samePair(w.from, t.from) && samePair(w.to, t.to)) return s + ' (written already: the same numbers again)';
    return s + ' (written earlier: Heat ' + w.from.heat + ' → ' + w.to.heat + ' · Wanted ' + w.from.wanted + ' → ' + w.to.wanted + ')';
  }
  function paintHeat(form, st, ui) {
    var d = st.data, on = reasonsOf(d.heatWhy), r = row(ui, 'Heat reasons'), rule = ruleChip(ui, 'heat');
    REASONS.forEach(function (x) {
      var has = on.indexOf(x.id) >= 0;
      r.appendChild(chip(ui, x.label + ' +' + x.n, has, function () { var next = has ? on.filter(function (i) { return i !== x.id; }) : on.concat([x.id]); ui.set({ heatWhy: next.join(',') }); }));
    });
    r.appendChild(rule.chip);
    form.appendChild(r);
    form.appendChild(rule.text);
    var h = row(ui, 'House add-on');
    var lab = ui.el('input'); lab.type = 'text'; lab.className = 'cc-house-why'; lab.placeholder = 'What for (e.g. explosives)'; lab.value = str(d.houseWhy); lab.maxLength = LABEL_MAX; lab.style.width = '16em'; lab.style.flex = 'none';
    lab.setAttribute('aria-label', 'House add-on: what for');
    lab.addEventListener('change', function () { ui.set({ houseWhy: lab.value }); });
    var n = ui.el('input'); n.type = 'number'; n.className = 'cc-house'; n.min = -HOUSE_MAX; n.max = HOUSE_MAX; n.inputMode = 'numeric'; n.style.width = '5em'; n.style.flex = 'none';
    n.value = d.house === undefined ? '' : String(d.house); n.setAttribute('aria-label', 'House add-on: + or −');
    n.addEventListener('change', function () { ui.set({ house: n.value }); });
    h.appendChild(lab); h.appendChild(n);
    h.appendChild(ui.el('span', 'gm-dim cc-mods', 'Modifiers ' + signed(int(d.mods, -6, 6, 0)) + ' (ticks and add-on, at most ±6)'));
    form.appendChild(h);
    var last = parseWritten(d.crewWritten) ? null : parseWritten(d.lastClose);
    if (last) {
      var lr = row(ui, '');
      lr.appendChild(ui.el('span', 'gm-dim cc-last', 'A close earlier tonight wrote Heat ' + last.from.heat + ' → ' + last.to.heat + ', Wanted ' + last.from.wanted + ' → ' + last.to.wanted + '. This is a new close; to correct that one instead:'));
      lr.appendChild(ui.btn('Redo that close', function () { ui.set({ redo: true }); }, 'cc-redo'));
      form.appendChild(lr);
    }
  }
  function paintStatus(form, st, ui) {
    var picks = picksOf(st.data.picks), fs = ui.factions();
    var box = ui.el('div', 'cc-factions'); box.style.display = 'grid'; box.style.gap = '6px';
    box.appendChild(ui.el('span', 'gm-lab', 'Status by faction (shown and logged; change the crew sheet itself there)'));
    if (!fs.length) box.appendChild(ui.el('p', 'gm-dim', 'No factions on the crew sheet yet.'));
    fs.forEach(function (f) {
      var cur = 0; picks.forEach(function (p) { if (p.name.toLowerCase() === f.name.toLowerCase()) cur = p.d; });
      var r = row(ui, f.name + ' (' + signed(f.status) + ')', '16em');
      [-3, -2, -1, 0, 1, 2, 3].forEach(function (v) {
        r.appendChild(chip(ui, signed(v), cur === v, function () {
          var next = picks.filter(function (p) { return p.name.toLowerCase() !== f.name.toLowerCase(); });
          if (v) next.push({ name: f.name, d: v });
          ui.set({ picks: next });
        }));
      });
      if (cur) r.appendChild(ui.el('span', 'gm-dim', ' → ' + signed(clamp(f.status + cur, -3, 3))));
      box.appendChild(r);
    });
    form.appendChild(box);
  }
  function paintTithe(form, st, ui) {
    form.appendChild(ui.el('p', 'gm-dim cc-split', splitLine(split(st.data.stacks, st.data.tithe, ui.pcs().length)) + ' Shown here and logged; no sheet is changed.'));
  }
  function paintXp(form, st, ui) {
    if (!ui.Crews && typeof ui.need === 'function') ui.need('crews');      /* the crews bundle (routes.js): the crew's triggers list once it is in */
    var list = xpList(ui.pcs(), ui.crewType(), ui.Content, ui.Crews), on = ticksOf(st.data.xpTicks);
    var box = ui.el('div', 'cc-xp'); box.style.display = 'grid'; box.style.gap = '4px';
    if (!list.length) box.appendChild(ui.el('p', 'gm-dim', 'No PCs filed.'));
    list.forEach(function (x) {
      var lab = ui.el('label', 'cc-xp-row'), cb = ui.el('input'); cb.type = 'checkbox'; cb.checked = on.indexOf(x.key) >= 0;
      cb.addEventListener('change', function () { var next = on.filter(function (k) { return k !== x.key; }); if (cb.checked) next.push(x.key); ui.set({ xpTicks: next.join(',') }); });
      lab.appendChild(cb); lab.appendChild(ui.el('span', '', ' ' + x.who + ': ' + x.line));
      box.appendChild(lab);
    });
    form.appendChild(box);
  }
  function paintOpen(box, st, ui) {
    var wrap = ui.el('label', 'cc-open'), ta = ui.el('textarea');
    wrap.style.display = 'grid';
    wrap.appendChild(ui.el('span', 'gm-lab', 'Open (GM only, kept with the night): one per line'));
    ta.rows = 2; ta.value = openOf(st.data.open).join('\n'); ta.placeholder = 'A question the night left open';
    ta.addEventListener('change', function () { ui.set({ open: ta.value }); });
    wrap.appendChild(ta);
    wrap.appendChild(ui.el('span', 'gm-dim', str(st.data.open).length + ' of ' + OPEN_MAX + ' characters'));
    box.appendChild(wrap);
  }

  return {
    REASONS: REASONS, KEYS: KEYS, HOUSE_MAX: HOUSE_MAX, OPEN_MAX: OPEN_MAX,
    reasonsOf: reasonsOf, modsOf: modsOf, target: target, packWritten: packWritten, parseWritten: parseWritten, seed: seed,
    picksOf: picksOf, packPicks: packPicks, pickLines: pickLines, split: split, splitLine: splitLine, openOf: openOf, packOpen: packOpen,
    xpList: xpList, clean: clean, earlier: earlier, restore: restore, inputsOf: inputsOf, writeLine: writeLine, begin: begin, set: set, quiet: quiet, payload: payload, onNext: onNext, writtenLine: writtenLine,
    feed: feed, writer: writer, paintHeat: paintHeat, paintStatus: paintStatus, paintTithe: paintTithe, paintXp: paintXp, paintOpen: paintOpen
  };
});
