/* gm/aftermath.js — the Aftermath show (suite ticket 1.6, switch spine.aftermath): the GM's side. Plain script, UMD: window.B68GmAftermath in the browser,
   module.exports under Node. Nothing here touches the clock or the network on its own: the host passes both (the page's host is built at the bottom).

   WHAT IT DOES. The Run Sheet's Aftermath, steered from the GM page with Next, Back and Skip, and drawn on the iPad as `scene.mode = 'aftermath'` plus one
   show kind per step (app/display/aftermath.js):
     1 payout  2 tithe  3 heat  4 status  5 harm  6 unwind  7 xp  8 credits
   Step 7 also writes a public `commend` row to the docs store for 90 seconds (the phones show the xp triggers while it stands; app/sheet/commend.js) and
   deletes it on the way out. Step 8 is every REVEALED NPC met tonight (firstSeen tonight, on stage now, or ticked by hand); the Worker joins the ids to
   revealed NPCs again, so a hidden one cannot reach the iPad whatever this page sends.
   A step not reached, or skipped, is recorded for the Debrief (1.7) in night.aftermath.data.pending ("status,harm"); finishing or stopping early files
   every step that is not done.

   THE RULES. Wording and numbers come from the rules part at runtime and are never in this file: each step shows the GM the matching rules entry
   (host.rules(term), the B68Rules corpus the GM page already loads) beside the number boxes, and the number the GM confirms is what the iPad is told. The only
   constants here are the ones the Run Sheet card gives: the heat choices 0, 2, 4, 6, and the siren at 9.

   BUDGET. The eight steps' time boxes (secs below) add up to 10 min 45 s, inside the Run Sheet's 12 minutes (the test holds it). Every step can be skipped.
   An iPad beat lasts at most 180 s, so a step held longer is sent again before it ends (tick(), every 10 s from the panel); the xp step is not sent again.

   PURE API (also for Node tests)
     STEPS  SECS_TOTAL  HOLD_MS  RESEND_MS  XP_SECS  EXPOSURE
     heatOutcome(heat, exposure, mods) -> { total, after, siren, wantedUp }
     lines(text) -> up to 6 lines of up to 80 characters (separated by | or a new line)
     payloadFor(stepId, data, ctx) -> { kind, payload } | null     ctx: { npcIds }
     commendDoc(nowMs) -> the docs row body for step 7           met(npcs, sinceMs, picks) -> [npc id] of revealed NPCs met tonight
     pendingFor(done) -> ['status', ...] the steps not done (the Debrief's list)
   create(host) -> controller. host: { enabled() -> bool, show(kind, payload, { ms, key }) -> Promise, layer(path, value) -> Promise, clearShow({ layers: false }) -> Promise,
     night() -> the B68GmNight controller | null, docs: { put(row) -> Promise, del(kind, owner) -> Promise }, npcs() -> [{ id, name, role, revealed, firstSeen, staged }],
     crew() -> { heat, wanted, vault }, since() -> ms the night began (optional), rules(term) -> Promise<string> (optional), now() -> ms, toast(msg, bad) }
     start() next() back() skip() go(i) finish() stop()   -> Promise<bool>
     set(patch)           the numbers and lines the GM typed -> re-sends the step on screen        pick(npcId, on)   credits: tick or untick an NPC
     tick()               re-send the step when it has been up for RESEND_MS                       state() -> the panel's model       resume()   pick up a run in the night document
   sync(root) takes down a stale Menu entry (N2: no Menu line any more); open(root) opens the panel (a sheet, or inline once the shell binds it). */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmAftermath = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var SWITCH = 'spine.aftermath';
  /* the eight steps and their time boxes in seconds (10 min 45 s in all); `term` is what the rules part is searched for */
  var STEPS = [
    { id: 'payout', label: 'Payout', secs: 60, term: 'payoff' },
    { id: 'tithe', label: 'Tithe', secs: 45, term: 'tithe' },
    { id: 'heat', label: 'Heat', secs: 120, term: 'heat' },
    { id: 'status', label: 'Status changes', secs: 90, term: 'faction status' },
    { id: 'harm', label: 'Harm complications', secs: 90, term: 'harm' },
    { id: 'unwind', label: 'Unwind', secs: 60, term: 'downtime' },
    { id: 'xp', label: 'Commendations', secs: 90, term: 'experience' },
    { id: 'credits', label: 'End credits', secs: 90, term: '' }
  ];
  var SECS_TOTAL = STEPS.reduce(function (t, s) { return t + s.secs; }, 0);
  var HOLD_MS = 180000, RESEND_MS = 150000, XP_SECS = 90;
  var EXPOSURE = [0, 2, 4, 6];
  var DOC_KIND = 'commend', DOC_OWNER = '_';

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function int(v, lo, hi, d) { var n = Math.floor(+v); return isFinite(n) && n >= lo && n <= hi ? n : d; }
  function clamp(v, lo, hi) { var n = Math.floor(+v); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0; }
  function stepIndex(id) { for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === id) return i; return -1; }

  /* ---------- pure ---------- */
  function heatOutcome(heat, exposure, mods) {
    var total = Math.max(0, int(heat, 0, 9, 0) + int(exposure, 0, 6, 0) + int(mods, -6, 6, 0));
    var siren = total >= 9;
    return { total: total, after: siren ? 0 : total, siren: siren, wantedUp: siren ? 1 : 0 };
  }
  function lines(text) {
    return str(text).split(/\r?\n|\|/).map(function (x) { return x.replace(/\s+/g, ' ').trim(); }).filter(Boolean).slice(0, 6).map(function (x) { return x.length > 80 ? x.slice(0, 80).trim() : x; });
  }
  function put(o, k, v) { if (v !== undefined && v !== '') o[k] = v; return o; }
  /* the show kind and payload for a step, from the numbers the GM confirmed. null when there is nothing to send (credits with nobody to credit). */
  function payloadFor(id, data, ctx) {
    var d = isObj(data) ? data : {}, i = stepIndex(id);
    if (i < 0) return null;
    var n = i + 1, p;
    if (id === 'payout') return { kind: 'aftermath', payload: { step: 'payout', n: n, stacks: int(d.stacks, 0, 99, 0) } };
    if (id === 'tithe') { var stacks = int(d.stacks, 0, 99, 0), tithe = int(d.tithe, 0, 99, 0); return { kind: 'aftermath', payload: { step: 'tithe', n: n, tithe: tithe, kept: Math.max(0, stacks - tithe) } }; }
    if (id === 'heat') {
      var heat = int(d.heat, 0, 9, 0), exp = int(d.exposure, 0, 6, 0), mods = int(d.mods, -6, 6, 0), out = heatOutcome(heat, exp, mods), w = int(d.wanted, 0, 4, 0);
      p = { step: 'heat', n: n, exposure: exp, heat: heat, after: out.after, wanted: Math.min(4, w + out.wantedUp) };
      if (mods) p.mods = mods;
      if (out.siren) p.siren = true;
      return { kind: 'aftermath', payload: p };
    }
    if (id === 'status' || id === 'harm') { p = { step: id, n: n }; var l = lines(d[id]); if (l.length) p.lines = l; return { kind: 'aftermath', payload: p }; }
    if (id === 'unwind') { p = { step: 'unwind', n: n }; put(p, 'who', str(d.who).replace(/\s+/g, ' ').trim().slice(0, 60)); put(p, 'line', str(d.line).replace(/\s+/g, ' ').trim().slice(0, 120)); return { kind: 'aftermath', payload: p }; }
    if (id === 'xp') return { kind: 'aftermath', payload: { step: 'xp', n: n, secs: XP_SECS } };
    if (id === 'credits') { var ids = ctx && Array.isArray(ctx.npcIds) ? ctx.npcIds.slice(0, 30) : []; return ids.length ? { kind: 'credits', payload: { npcIds: ids } } : null; }
    return null;
  }
  /* the row step 7 writes: public, text-free, with the time it ends (the phone also bounds the window by its own clock, so a stale row cannot hold the card up) */
  function commendDoc(nowMs) { return { kind: DOC_KIND, owner: DOC_OWNER, scope: 'public', json: { v: 1, secs: XP_SECS, until: Math.floor(nowMs) + XP_SECS * 1000 } }; }
  /* the revealed NPCs met tonight: revealed, and (first seen since the night began | on stage now | ticked by hand); an unticked-by-hand NPC (false) is out. A hidden NPC is never in. */
  function met(npcs, sinceMs, picks) {
    var pk = isObj(picks) ? picks : {}, out = [];
    (Array.isArray(npcs) ? npcs : []).forEach(function (n) {
      if (!isObj(n) || n.revealed !== true || !n.id || !str(n.name).trim() || pk[n.id] === false) return;
      var seen = Date.parse(str(n.firstSeen));
      if (pk[n.id] === true || n.staged === true || (isFinite(seen) && seen >= sinceMs)) out.push(n.id);
    });
    return out;
  }
  function pendingFor(done) { var d = isObj(done) ? done : {}; return STEPS.filter(function (s) { return d[s.id] !== true; }).map(function (s) { return s.id; }); }

  /* ---------- the controller ---------- */
  var DATA_KEYS = ['stacks', 'tithe', 'exposure', 'mods', 'heat', 'wanted', 'status', 'harm', 'who', 'line'];
  function create(host) {
    host = host || {};
    var run = null;       /* { i, startedAt, seq, sentAt, done: {id: true}, data: {}, picks: {}, msg } while a run is open */
    function now() { return typeof host.now === 'function' ? host.now() : Date.now(); }
    function toast(m, bad) { if (typeof host.toast === 'function') host.toast(m, bad); }
    function on() { return typeof host.enabled === 'function' ? host.enabled() === true : false; }
    function fail(e) { toast('The Aftermath could not do that: ' + (e && e.message || e), true); return false; }
    function night() { return typeof host.night === 'function' ? host.night() : null; }
    function sinceMs() {
      if (typeof host.since === 'function') { var s = host.since(); if (typeof s === 'number' && isFinite(s)) return s; }
      return now() - 8 * 3600 * 1000;
    }
    function persist() {
      var n = night(); if (!n || !run) return;
      var data = {};
      DATA_KEYS.forEach(function (k) { if (run.data[k] !== undefined && run.data[k] !== '') data[k] = run.data[k]; });
      data.pos = run.i; data.pending = pendingFor(run.done).join(',');
      n.setAfter(run.i >= 0 && run.i < STEPS.length ? STEPS[run.i].id : 'done', data);
    }
    function npcIds() { return met(typeof host.npcs === 'function' ? host.npcs() : [], sinceMs(), run && run.picks); }
    function send() {
      if (!run || run.i < 0 || run.i >= STEPS.length) return Promise.resolve(false);
      var s = STEPS[run.i], pl = payloadFor(s.id, run.data, { npcIds: npcIds() });
      run.msg = '';
      if (!pl) { run.msg = 'No revealed NPC met tonight: nothing to credit.'; return Promise.resolve(false); }
      run.seq++; run.sentAt = now();
      var ms = s.id === 'xp' ? XP_SECS * 1000 : HOLD_MS;
      return Promise.resolve(host.show(pl.kind, pl.payload, { ms: ms, key: 'aft:' + run.startedAt + ':' + s.id + ':' + run.seq })).then(function (r) { return r !== null; }, fail);
    }
    function leave() {       /* the step on screen is going: the commendations stop with step 7 */
      if (run && run.i >= 0 && STEPS[run.i] && STEPS[run.i].id === 'xp' && host.docs) return Promise.resolve(host.docs.del(DOC_KIND, DOC_OWNER)).then(function () {}, function () {});
      return Promise.resolve();
    }
    function enter() {
      var p = Promise.resolve();
      if (run.i >= 0 && STEPS[run.i] && STEPS[run.i].id === 'xp' && host.docs) p = Promise.resolve(host.docs.put(commendDoc(now()))).then(function () {}, fail);
      return p.then(function () { persist(); return send(); });
    }
    function go(j) {
      if (!run) return Promise.resolve(false);
      if (j >= STEPS.length) return finish();
      j = Math.max(0, j);
      return leave().then(function () { run.i = j; return enter(); }).then(function () { return true; });
    }
    function start() {
      if (!on()) { toast('The Aftermath show is switched off (Menu, Switchboard).', true); return Promise.resolve(false); }
      if (run) return Promise.resolve(false);
      var c = typeof host.crew === 'function' ? host.crew() : null, d = {};
      if (isObj(c)) { d.heat = int(c.heat, 0, 9, 0); d.wanted = int(c.wanted, 0, 4, 0); }
      run = { i: -1, startedAt: now(), seq: 0, sentAt: 0, done: {}, data: d, picks: {}, msg: '' };
      var n = night(); if (n && n.phase() !== 'after') n.enter('after');
      return Promise.resolve(host.layer('band.phase', 'after')).then(function () { return host.layer('scene.mode', 'aftermath'); }).then(function () { return go(0); }, fail);
    }
    function next() { if (!run || run.i < 0) return Promise.resolve(false); run.done[STEPS[run.i].id] = true; return go(run.i + 1); }
    function skip() { if (!run || run.i < 0) return Promise.resolve(false); delete run.done[STEPS[run.i].id]; return go(run.i + 1); }
    function back() { if (!run || run.i <= 0) return Promise.resolve(false); delete run.done[STEPS[run.i - 1].id]; return go(run.i - 1); }
    function finish() {
      if (!run) return Promise.resolve(false);
      return leave().then(function () { return host.clearShow({ layers: false }); }).then(function () { return host.layer('scene.mode', null); }).then(function () {
        var pending = pendingFor(run.done), n = night();
        if (n) { var data = {}; DATA_KEYS.forEach(function (k) { if (run.data[k] !== undefined && run.data[k] !== '') data[k] = run.data[k]; }); data.pending = pending.join(','); data.pos = STEPS.length; n.setAfter('done', data); }
        if (pending.length) toast('Not done, filed for the Debrief: ' + pending.join(', ') + '.');
        run = null;
        return true;
      }, fail);
    }
    function set(patch) {
      if (!run || !isObj(patch)) return Promise.resolve(false);
      DATA_KEYS.forEach(function (k) {
        if (!(k in patch)) return;
        var v = patch[k];
        run.data[k] = (k === 'status' || k === 'harm' || k === 'who' || k === 'line') ? str(v).slice(0, 200) : clamp(v, k === 'mods' ? -6 : 0, k === 'wanted' ? 4 : k === 'heat' ? 9 : k === 'exposure' ? 6 : k === 'mods' ? 6 : 99);
      });
      persist();
      return run.i >= 0 ? send() : Promise.resolve(false);
    }
    function pick(id, onOff) { if (!run || !id) return; run.picks[id] = onOff === true; if (run.i === STEPS.length - 1) send(); }
    function tick() {
      if (!run || run.i < 0 || !run.sentAt || STEPS[run.i].id === 'xp') return Promise.resolve(false);
      return now() - run.sentAt >= RESEND_MS ? send() : Promise.resolve(false);
    }
    /* a run in the night document (the page was reloaded mid-show) comes back at its step; the phones' row and the iPad's beat are left as they are until the next send */
    function resume() {
      if (run) return true;
      var n = night(), a = n && typeof n.night === 'function' ? n.night().aftermath : null;
      if (!a || !isObj(a.data) || a.step === '' || a.step === 'done' || stepIndex(a.step) < 0) return false;
      var d = {}; DATA_KEYS.forEach(function (k) { if (a.data[k] !== undefined) d[k] = a.data[k]; });
      var done = {}; STEPS.forEach(function (s, i) { if (i < stepIndex(a.step)) done[s.id] = true; });
      var pend = str(a.data.pending).split(',').filter(Boolean); pend.forEach(function (id) { delete done[id]; });
      run = { i: stepIndex(a.step), startedAt: now(), seq: 0, sentAt: 0, done: done, data: d, picks: {}, msg: '' };
      return true;
    }
    function state() {
      var open = !!run, i = open ? run.i : -1;
      return {
        enabled: on(), open: open, i: i, step: i >= 0 && i < STEPS.length ? STEPS[i] : null, steps: STEPS,
        done: open ? JSON.parse(JSON.stringify(run.done)) : {}, pending: open ? pendingFor(run.done) : [],
        data: open ? JSON.parse(JSON.stringify(run.data)) : {}, msg: open ? run.msg : '', secsTotal: SECS_TOTAL,
        credits: open ? npcIds() : [], outcome: open ? heatOutcome(run.data.heat, run.data.exposure, run.data.mods) : null,
        sentAt: open ? run.sentAt : 0, startedAt: open ? run.startedAt : 0
      };
    }
    return { start: start, next: next, back: back, skip: skip, go: go, finish: finish, stop: finish, set: set, pick: pick, tick: tick, resume: resume, state: state, now: now };
  }

  /* ---------- the page (browser only): the Menu entry and the panel ---------- */
  function jfetch(method, path, body) {
    var opts = { method: method, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return W.fetch('/api' + path, opts).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) { j = null; } throw new Error((j && j.error) || 'HTTP ' + res.status); });
      return res.json();
    });
  }
  function rulesText(term) {
    var R = W.B68Rules;
    if (!term || !R || typeof R.load !== 'function' || typeof R.hits !== 'function' || typeof R.entry !== 'function') return Promise.resolve('');
    return Promise.resolve(R.load()).then(function () {
      var h = R.hits(term, 1), first = h && h.hits && h.hits[0], e = first ? R.entry(first.id) : null;
      return e && typeof e.md === 'string' ? e.md.replace(/\s+/g, ' ').trim().slice(0, 420) : '';
    }).then(null, function () { return ''; });
  }

  var ctl = null, page = null;
  function feed() { var P = W.B68GmPage; return P && typeof P.aftermath === 'function' ? P.aftermath() : null; }
  function controller() {
    if (ctl) return ctl;
    var P = W.B68GmPage;
    ctl = create({
      enabled: function () { var f = feed(); return !!(f && W.B68Features && W.B68Features.valueOf(f.doc, SWITCH)); },
      show: function (k, p, o) { return P.show(k, p, o); },
      layer: function (path, v) { return P.layer(path, v); },
      clearShow: function (o) { return P.clearShow(o); },
      night: function () { var f = feed(); return f ? f.night : null; },
      docs: { put: function (row) { return jfetch('PUT', '/docs', row); }, del: function (kind, owner) { return jfetch('DELETE', '/docs?kind=' + encodeURIComponent(kind) + '&owner=' + encodeURIComponent(owner)); } },
      npcs: function () { var f = feed(); return f ? f.npcs : []; },
      crew: function () { var f = feed(); return f ? f.crew : null; },
      since: function () {
        /* the night began at its earliest phase before the Aftermath, else at the hard start (HH:MM today); else the host's default (8 hours back) */
        var f = feed(), n = f && f.night && typeof f.night.night === 'function' ? f.night.night() : null, t = Infinity;
        if (n) {
          Object.keys(n.phases).forEach(function (k) { var s = n.phases[k].start; if (k !== 'after' && s && s < t) t = s; });
          var N = W.B68GmNight, hard = N && n.startAt ? N.clockMs(n.startAt, Date.now()) : null;
          if (hard && hard < t) t = hard;
        }
        return isFinite(t) ? t : undefined;
      },
      rules: rulesText,
      toast: function (m, bad) { var f = feed(); if (f && typeof f.toast === 'function') f.toast(m, bad); else if (W.console) W.console.log(m); }
    });
    return ctl;
  }

  function el(tag, cls, text) { var e = W.document.createElement(tag); if (cls) e.className = cls; if (text != null && text !== '') e.textContent = text; return e; }
  function btn(label, fn, cls) { var b = el('button', 'btn sm' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function mmss(s) { return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

  var timer = null;
  function stopTick(box) { if (timer) { W.clearInterval(timer); timer = null; } if (box) box.__aft = false; }
  function paint(box, sh) {
    var c = controller();
    if (!box.__aft) {                  /* a live panel keeps its own ticking while it is open (inline: until the shell unbinds it) */
      box.__aft = true;
      timer = W.setInterval(function () { if (!box.isConnected) { stopTick(box); return; } c.tick(); }, 10000);
      if (sh && typeof sh.onUnbind === 'function') sh.onUnbind(function () { stopTick(box); });
    }
    var st = c.state();
    box.textContent = '';
    box.appendChild(el('p', 'gm-dim', 'The Aftermath, eight steps, about ' + mmss(st.secsTotal) + ' (the Run Sheet allows 12:00). Steer from here; the iPad follows. Every step can be skipped.'));
    if (!st.enabled) { box.appendChild(el('p', 'gm-empty', 'Switched off. Turn on Aftermath show in Menu, Switchboard.')); return; }
    if (!st.open) {
      var go = btn('Start the Aftermath', function () { c.resume(); c.start().then(function () { paint(box); }); }, 'primary');
      box.appendChild(go);
      return;
    }
    var rail = el('ol', 'gm-aft-steps');
    st.steps.forEach(function (s, i) {
      var li = el('li', '', s.label + ' (' + mmss(s.secs) + ')' + (st.done[s.id] ? ' ✓' : st.i === i ? ' ←' : ''));
      li.style.listStyle = 'none';
      if (st.i === i) li.style.fontWeight = '900';
      rail.appendChild(li);
    });
    rail.style.padding = '0'; rail.style.margin = '0';
    box.appendChild(rail);
    var s = st.step;
    if (s) {
      box.appendChild(el('h3', '', (st.i + 1) + '. ' + s.label));
      var form = el('div', 'gm-aft-form'); form.style.display = 'grid'; form.style.gap = '8px';
      var field = function (key, label, kind, extra) {
        var wrap = el('label', ''), inp;
        wrap.appendChild(el('span', 'gm-lab', label + ' '));
        if (kind === 'num') { inp = el('input'); inp.type = 'number'; inp.min = extra && extra.min !== undefined ? extra.min : 0; inp.max = extra && extra.max !== undefined ? extra.max : 99; inp.inputMode = 'numeric'; inp.value = st.data[key] === undefined ? '' : String(st.data[key]); }
        else if (kind === 'area') { inp = el('textarea'); inp.rows = 3; inp.value = str(st.data[key]); inp.placeholder = 'One per line'; }
        else { inp = el('input'); inp.type = 'text'; inp.value = str(st.data[key]); }
        inp.addEventListener('change', function () { var p = {}; p[key] = inp.value; c.set(p).then(function () { paint(box); }); });
        wrap.appendChild(inp); form.appendChild(wrap);
      };
      if (s.id === 'payout') field('stacks', 'Stacks', 'num');
      if (s.id === 'tithe') { field('stacks', 'Payout (stacks)', 'num'); field('tithe', 'Tithe (stacks)', 'num'); }
      if (s.id === 'heat') {
        field('heat', 'Heat now (0 to 9)', 'num', { max: 9 }); field('wanted', 'Wanted level (0 to 4)', 'num', { max: 4 });
        var seg = el('div', 'seg'); seg.appendChild(el('span', 'gm-lab', 'Exposure '));
        EXPOSURE.forEach(function (x) { var b = btn(String(x), function () { c.set({ exposure: x }).then(function () { paint(box); }); }, 'chip'); b.setAttribute('aria-pressed', String(st.data.exposure === x)); seg.appendChild(b); });
        form.appendChild(seg);
        field('mods', 'Modifiers (+ or −)', 'num', { min: -6, max: 6 });
        var o = st.outcome; form.appendChild(el('p', 'gm-dim', 'Heat ' + o.total + (o.siren ? ': the siren, then WANTED goes up one.' : '. No siren.')));
      }
      if (s.id === 'status') field('status', 'Status changes', 'area');
      if (s.id === 'harm') field('harm', 'Harm complications', 'area');
      if (s.id === 'unwind') { field('who', 'Whose turn to decide', 'text'); field('line', 'A line (optional)', 'text'); }
      if (s.id === 'xp') form.appendChild(el('p', 'gm-dim', 'Phones show the xp triggers for 90 seconds. Moving on takes them down.'));
      if (s.id === 'credits') {
        var f = feed(), ids = st.credits, all = f ? f.npcs.filter(function (n) { return n.revealed === true; }) : [];
        form.appendChild(el('p', 'gm-dim', all.length ? 'Revealed NPCs met tonight are ticked. Tick or untick; hidden NPCs are never listed.' : 'No revealed NPCs.'));
        all.forEach(function (n) {
          var lab = el('label', ''), cb = el('input'); cb.type = 'checkbox'; cb.checked = ids.indexOf(n.id) >= 0;
          cb.addEventListener('change', function () { c.pick(n.id, cb.checked); paint(box); });
          lab.appendChild(cb); lab.appendChild(el('span', '', ' ' + n.name + (n.role ? ' (' + n.role + ')' : ''))); form.appendChild(lab);
        });
      }
      box.appendChild(form);
      if (st.msg) box.appendChild(el('p', 'gm-warn', st.msg));
      var aid = el('p', 'gm-dim gm-aft-rules'); box.appendChild(aid);
      rulesText(s.term).then(function (t) { aid.textContent = t ? 'From the rules: ' + t : ''; });
    }
    var row = el('div', 'seg');
    row.appendChild(btn('Back', function () { c.back().then(function () { paint(box); }); }));
    row.appendChild(btn('Skip', function () { c.skip().then(function () { paint(box); }); }));
    row.appendChild(btn(st.i === st.steps.length - 1 ? 'Finish' : 'Next', function () { c.next().then(function () { paint(box); }); }, 'primary'));
    row.appendChild(btn('End now', function () { c.finish().then(function () { paint(box); }); }));
    box.appendChild(row);
    if (st.pending.length) box.appendChild(el('p', 'gm-dim', 'Not done yet (goes to the Debrief if left): ' + st.pending.join(', ') + '.'));
  }

  /* the Menu entry: present only while the switch is on, so with it off the Menu is what it was. The page calls sync() when the Menu opens. */
  /* N2: the Menu line is gone (the shell places this tool, B68GmTools.get('aftermath').open()); sync() only takes down a line an older page drew, and says false. */
  function sync(rootEl) {
    var cur = rootEl && typeof rootEl.querySelector === 'function' ? rootEl.querySelector('#gm-menu-aftermath') : null;
    if (cur && cur.parentNode) cur.parentNode.removeChild(cur);
    return false;
  }
  function open(rootEl) {
    var Wk = W.B68GmWorkshop; if (!Wk || typeof Wk.sheet !== 'function') return null;
    var sh = Wk.sheet(rootEl, 'aftermath', 'Aftermath');
    if (!sh) return null;
    controller().resume();
    paint(sh.body, sh); sh.open();
    return sh;
  }

  return { STEPS: STEPS, SECS_TOTAL: SECS_TOTAL, HOLD_MS: HOLD_MS, RESEND_MS: RESEND_MS, XP_SECS: XP_SECS, EXPOSURE: EXPOSURE, SWITCH: SWITCH, DOC_KIND: DOC_KIND,
    heatOutcome: heatOutcome, lines: lines, payloadFor: payloadFor, commendDoc: commendDoc, met: met, pendingFor: pendingFor, create: create, sync: sync, open: open };
});
