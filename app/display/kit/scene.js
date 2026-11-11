/* display/kit/scene.js: the new stage: clocks, the NPC and the map (B68StageScene), the kit and stage build, KS16 (S5, S6, S8), behind the
   setting kit.stage. In the kit-stage and kit-lookbook bundles (app/routes.js): fetched only while the setting is on (or by the look book). It
   only defines B68StageScene when it loads; it reads B68Kit, B68Stage, B68Ui and B68FaceLook only when it is called. ES5, window.B68StageScene in
   the browser, module.exports under Node (checks/runtime/kit-stage-scene.e2e.mjs reads its Pure part).

   display-page.js hands four things to this file while on() (the setting on and this bundle in), one line each; with it off they run as before.
     S5  CLOCKS WITH NAMES   card(e, card, o, env, prev) on a `clock` overlay (a shown table clock, which the server joins to its name, size and
         LIVE fill; a hidden clock is never sent, so it is never drawn: the server leaves the overlay out and the page takes the node down).
         The clock grows to the centre (a big face, its name, "3 of 8") for about 2 seconds, then docks on a plate in the foot-right place
         (a small face, the name, "3 of 8"). When the same overlay comes back with more filled (the page redraws it in place; prev is the node
         it replaces), it grows again with the NEW segments in red, then docks. Fewer filled: the dock, redrawn, no grow.
         The node keeps the old card's hooks (dp-ov-card dp-ov-clock, data-ov-id, dp-ov-face, dp-ov-seg(-on), dp-ov-name, dp-ov-count).
         band() also docks the mission's alarm clock (the band's hud.alarm, which the iPad is already sent) in the idle stage's foot-right place
         (frame.slot('clocks')) and beside the map's plate; a tick draws its new segments red for about 2 seconds. It is there only while the
         server sends the mission.
     S6  THE NPC             npcStage(vm, seq, env): a pushed NPC (display kind `npc`): the figure stands over the DIMMED scene (the page leaves
         the scene uncovered for it), with a nameplate in the lower third: role and place (role · faction), the name, one line (the alias in
         quotes, or the description's first sentence) and a faction stripe (B68FaceLook.slotOf: one edge per faction, as the face looks).
         Hooks kept: dp-stage dp-npc, dp-npc-fig, dp-npc-txt, dp-kicker, dp-npc-name, dp-npc-alias or dp-npc-desc. Only a FOUND npc comes here:
         the server joins a revealed NPC only, so the display-only sign-in never has a hidden one to draw.
         card() on an `npc` overlay (SPOTLIGHT: the held portrait) and speak(p, env) on the `spotlight` beat: a timed "who's speaking" bar,
         the head and a plate (Speaking, the name, role · faction) with its timer and the faction stripe. The npc overlay keeps dp-ov-portrait,
         so the face looks (display/face-render.js, which the page runs after card()) still redraw the head.
     S8  THE MAP             band(frame, cur, m, env), called first in paintBand: the old band beside the map stays hidden; the map fills the
         screen (one that names itself, the map kit's maps: the class ks16-bleed; a captioned drawing keeps KS13's caption dock under it, with
         the band's plate beside the caption) and the band becomes one lower-third plate: the clock and the label, Now, Next, the crew and
         their rooms, the ways found, the night's beats, the GM's countdown on the side; the alarm docks beside it. True (handled) while on().
   Every string goes in as text (B68Ui.node, B68Ui.fill, textContent): no markup sink. Nothing here makes a request. Reduced motion: no grow
   animation (the big face is simply there for its 2 seconds, then the dock). Nothing moves once docked.
   API
     on() -> bool
     card(e, card, o, env, prev) -> bool      env: { document, reduced, later?, portrait(spec, id) -> node } (display-page.js beatEnv)
     npcStage(vm, seq, env) -> { el, destroy } | null      env: { document, figure(spec, id) -> node }
     speak(p, env) -> Node | null             the beat's env (document, reduced, ms, age, portrait)
     band(frame, cur, m, env) -> bool         frame: the stage frame; cur: the page's current stage ({ el }); m: the band model (or null);
                                              env: { document, band (the old band's node), container (the display root), skew() -> ms }
     Pure = { edge(faction), kicker(role, faction), oneLine(npc), count(filled, size), fresh(prev, filled, size), timer(tm, now, skew), bandWords(m) }
     GROW_MS */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else if (root) root.B68StageScene = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var GROW_MS = 2000;

  function txt(v, max) { return typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, max || 400) : ''; }
  function int(v, d) { v = Math.floor(Number(v)); return isFinite(v) ? v : d; }
  function on() { return !!(W && W.B68Kit && typeof W.B68Kit.ready === 'function' && W.B68Kit.ready('stage') && W.B68Stage && W.B68Ui); }
  function later(env, fn, ms) { return env && typeof env.later === 'function' ? env.later(fn, ms) : setTimeout(fn, ms); }

  function faceLook() { if (W && W.B68FaceLook) return W.B68FaceLook; try { return typeof require === 'function' ? require('../face-look.js') : null; } catch (e) { return null; } }

  /* ---------- Pure ---------- */
  var Pure = {};
  /* one stripe per faction: the six slots the face looks use (display/face-look.js), so a faction is one colour everywhere */
  Pure.edge = function (faction) {
    var FL = faceLook(), f = txt(faction, 200);
    if (!f || !FL || typeof FL.slotOf !== 'function') return '';
    var slot = FL.slotOf(f);
    return slot >= 1 && slot <= 6 ? 'faction-' + slot : '';
  };
  Pure.kicker = function (role, faction) { return [txt(role, 120), txt(faction, 120)].filter(Boolean).join(' · '); };
  /* the nameplate's one line: the alias in quotes, else the description's first sentence (cut at a word, 140 at most) */
  Pure.oneLine = function (n) {
    n = n || {};
    var a = txt(n.alias, 120);
    if (a) return { text: '“' + a + '”', alias: true };
    var d = txt(n.description, 2000);
    if (!d) return { text: '', alias: false };
    var m = d.match(/^.*?[.!?](?=\s|$)/), s = m ? m[0] : d;
    if (s.length > 140) { s = s.slice(0, 139); var sp = s.lastIndexOf(' '); s = (sp > 80 ? s.slice(0, sp) : s) + '…'; }
    return { text: s, alias: false };
  };
  Pure.count = function (filled, size) { return int(filled, 0) + ' of ' + int(size, 0); };
  /* the segments a tick filled: from the fill before to the fill now (none when it went down, or nothing was seen before) */
  Pure.fresh = function (prev, filled, size) {
    var out = [], p = prev === null || prev === undefined || prev === '' ? -1 : int(prev, -1), f = int(filled, 0), n = int(size, 0);
    if (p < 0 || f <= p) return out;
    for (var i = p; i < f && i < n; i++) out.push(i);
    return out;
  };
  /* the countdown as the old band shows it (display-page.js Pure.timerView): the server's time is now + skew */
  Pure.timer = function (tm, nowMs, skewMs) {
    var num = function (v) { return typeof v === 'number' && isFinite(v); };
    if (!tm || typeof tm !== 'object') return { text: '0:00', state: 'zero', left: 0 };
    var left = tm.paused === true || !num(tm.endsAt) ? (num(tm.left) ? tm.left : 0) : Math.ceil((tm.endsAt - (nowMs + (num(skewMs) ? skewMs : 0))) / 1000);
    left = Math.max(0, Math.min(7200, Math.floor(left) || 0));
    var r = left % 60;
    return { text: Math.floor(left / 60) + ':' + (r < 10 ? '0' : '') + r, state: tm.paused === true ? 'paused' : left <= 0 ? 'zero' : left < 60 ? 'warn' : 'run', left: left };
  };
  /* what the band's plate says, from the band model (display-page.js Pure.bandModel): what the old band shows, nothing more */
  Pure.bandWords = function (m) {
    if (!m || typeof m !== 'object') return null;
    var item = function (n, more) { return [n.text].concat(more).filter(Boolean).join(' · '); };
    var nowL = (m.now || []).map(function (n) { return item(n, [n.where, n.until]); });
    var nextL = (m.next || []).map(function (n) { return item(n, [n.where, n.at, n.inText]); });
    var soon = (m.next || []).some(function (n) { return n.soon; });
    var out = {
      kicker: [m.time, m.label].filter(Boolean).join(' · '),
      title: nowL.length ? 'Now: ' + nowL.join(' / ') : nextL.length ? (soon ? 'Next, soon: ' : 'Next: ') + nextL[0] : '',
      line: nowL.length && nextL.length ? (soon ? 'Next, soon: ' : 'Next: ') + nextL.join(' / ') : !nowL.length && nextL.length > 1 ? 'Then: ' + nextL.slice(1).join(' / ') : '',
      crew: (m.crew || []).map(function (c) { return [c.name, c.room].filter(Boolean).join(' · '); }).join(', '),
      ways: txt(m.ways, 80),
      night: m.night && m.night.squares && m.night.squares.length ? m.night : null,
      timer: m.timer || null,
      alarm: m.alarm || null
    };
    out.text = !!(out.kicker || out.title || out.line || out.crew || out.ways || out.night || out.timer);
    return out.text || out.alarm ? out : null;
  };

  /* ---------- a clock: the kit's meter, its wedges carrying the old card's hooks, the new ones marked ---------- */
  function face(doc, name, filled, size, fresh) {
    var m = W.B68Ui.node('meter', { kind: 'clock', label: name, value: filled, max: size, cls: 'ks16-face' }, doc);
    var svg = m.querySelector('svg');
    if (svg) svg.setAttribute('class', svg.getAttribute('class') + ' dp-ov-face');
    var w = m.querySelectorAll('.ui-wedge');
    for (var i = 0; i < w.length; i++) w[i].setAttribute('class', w[i].getAttribute('class') + ' dp-ov-seg' + (i < filled ? ' dp-ov-seg-on' : '') + (fresh.indexOf(i) >= 0 ? ' ks16-new' : ''));
    return m;
  }
  /* a clock on a plate: the face, its name, "n of m" */
  function clockPlate(doc, name, filled, size, fresh, cls) {
    var p = W.B68Stage.plate({ title: name, line: Pure.count(filled, size) }, doc);
    if (!p) return null;
    p.el.classList.add('ks16-clockplate');
    if (cls) p.el.classList.add(cls);
    p.slot('title').classList.add('dp-ov-name');
    p.slot('line').classList.add('dp-ov-count');
    p.el.insertBefore(face(doc, name, filled, size, fresh), p.el.firstChild);
    return p;
  }
  function clockCard(e, c, env, prev) {
    var doc = env.document || W.document, size = int(c.size, 0), filled = Math.max(0, Math.min(size, int(c.filled, 0))), name = txt(c.name, 120);
    if (size < 1 || size > 12) return false;
    var same = !!prev && typeof prev.getAttribute === 'function' && prev.getAttribute('data-ov-id') === e.getAttribute('data-ov-id') && prev.getAttribute('data-ks16-size') === String(size);
    var fresh = same ? Pure.fresh(prev.getAttribute('data-ks16-filled'), filled, size) : [];
    var grow = !same || fresh.length > 0;      /* a first sight grows; a redraw grows only for a tick */
    e.classList.add('ks16-clock');
    e.setAttribute('data-ks16-filled', String(filled));
    e.setAttribute('data-ks16-size', String(size));
    e.setAttribute('data-ks16-phase', grow ? 'grow' : 'dock');
    if (env.reduced) e.setAttribute('data-reduced', '1');
    if (grow) {
      var g = clockPlate(doc, name, filled, size, fresh, 'ks16-grow');
      if (g) { g.el.setAttribute('aria-hidden', 'true'); e.appendChild(g.el); }
      later(env, function () { e.setAttribute('data-ks16-phase', 'dock'); }, GROW_MS);
    }
    var d = clockPlate(doc, name, filled, size, [], 'ks16-dock');
    if (d) { d.el.setAttribute('role', 'status'); e.appendChild(d.el); }
    return true;
  }

  /* ---------- who's speaking: a head and a timed plate ---------- */
  function speakNode(n, c, ms, env, held) {
    var doc = env.document || W.document;
    var line = Pure.kicker(c.role, c.faction), alias = txt(c.alias, 120);
    if (alias) line = (line ? line + ' · ' : '') + '“' + alias + '”';
    var p = W.B68Stage.plate({ kicker: 'Speaking', title: c.name, line: line, edge: Pure.edge(c.faction), timer: ms > 0 ? { ms: ms, endsAt: Date.now() + ms } : 0 }, doc);
    if (!p) return null;
    p.el.classList.add('ks16-speakplate');
    p.slot('kicker').classList.add('dp-kicker');
    p.slot('title').classList.add('dp-ov-name');
    if (alias) p.slot('line').classList.add('dp-ov-alias');
    var row = doc.createElement('div'); row.className = 'ks16-speakrow';
    var head = doc.createElement('div'); head.className = (held ? 'dp-ov-portrait ' : '') + 'ks16-head'; head.setAttribute('aria-hidden', 'true');
    var drawn = null;
    if (c.spec && typeof env.portrait === 'function') { try { drawn = env.portrait(c.spec, 'ks16-' + String(c.npcId || 'npc').replace(/[^A-Za-z0-9_-]/g, '')); } catch (err) { drawn = null; } }
    if (drawn) head.appendChild(drawn);
    else { var mono = doc.createElement('p'); mono.className = 'ks16-mono'; mono.textContent = String(c.name).charAt(0); head.appendChild(mono); }
    row.appendChild(head); row.appendChild(p.el);
    n.appendChild(row);
    return p;
  }
  function npcCard(e, c, o, env) {
    if (!c.name) return false;
    var left = Number(o && o.ms) - (Number(o && o.age) || 0), npc = o && o.npc && typeof o.npc === 'object' ? o.npc : {};
    e.classList.add('ks16-speak');
    return !!speakNode(e, { name: c.name, alias: c.alias, role: npc.role, faction: npc.faction, spec: c.spec, npcId: o && o.npcId }, left > 0 ? left : 0, env, true);
  }
  function card(e, c, o, env, prev) {
    if (!on() || !e || !c || !o) return false;
    env = env || {};
    try {
      if (c.kind === 'clock') return clockCard(e, c, env, prev);
      if (c.kind === 'npc') return npcCard(e, c, o, env);
    } catch (err) { /* the page draws the old card */ }
    return false;
  }
  /* the spotlight beat: the same bar, for the beat's own time */
  function speak(p, env) {
    if (!on() || !p || !p.npc || !p.npc.name) return null;
    env = env || {};
    var doc = env.document || W.document;
    var n = doc.createElement('div');
    n.className = 'dp-show dp-show-spotlight ks16-speak ks16-beat';
    n.setAttribute('data-show', 'spotlight');
    if (env.reduced) n.setAttribute('data-reduced', '1');
    var left = Number(env.ms) - (Number(env.age) || 0);
    return speakNode(n, p.npc, left > 0 ? left : 0, env, false) ? n : null;
  }

  /* ---------- the NPC over the dimmed scene ---------- */
  function npcStage(vm, seq, env) {
    if (!on() || !vm || !vm.found || !vm.name) return null;
    env = env || {};
    var doc = env.document || W.document;
    var e = doc.createElement('div'); e.className = 'dp-stage dp-npc ks16-npc';
    var fig = null;
    if (vm.spec && typeof env.figure === 'function') { try { fig = env.figure(vm.spec, 'dp-npc-' + seq); } catch (err) { fig = null; } }
    if (fig) { var holder = doc.createElement('div'); holder.className = 'dp-npc-fig'; holder.setAttribute('aria-hidden', 'true'); holder.appendChild(fig); e.appendChild(holder); }
    else e.classList.add('dp-npc-nofig');
    var one = Pure.oneLine(vm);
    var p = W.B68Stage.plate({ kicker: vm.sub || '', title: vm.name, line: one.text, edge: Pure.edge(vm.faction) }, doc);
    if (!p) return null;
    p.el.classList.add('ks16-nameplate');
    p.slot('kicker').classList.add('dp-kicker');
    p.slot('title').classList.add('dp-npc-name');
    if (one.text) p.slot('line').classList.add(one.alias ? 'dp-npc-alias' : 'dp-npc-desc');
    var box = doc.createElement('div'); box.className = 'dp-npc-txt ks16-npcfoot';
    box.appendChild(p.el); e.appendChild(box);
    return { el: e, destroy: function () {} };
  }

  /* ---------- the band: a lower-third plate over the full-bleed map; the alarm docked ---------- */
  function squares(doc, night) {
    var row = doc.createElement('div'); row.className = 'ks16-squares'; row.setAttribute('role', 'img');
    row.setAttribute('aria-label', 'The night, ' + night.squares.length + ' beats' + (night.marks && night.marks.length ? ', ' + night.marks.map(function (k) { return k.text; }).filter(Boolean).join(', ') : ''));
    night.squares.forEach(function (q) {
      var sq = doc.createElement('span'); sq.className = 'ks16-sq ks16-sq-' + q.state;
      if (q.mark) { sq.classList.add('ks16-marked'); sq.textContent = q.mark.icon === 'star' ? '★' : '◆'; }
      row.appendChild(sq);
    });
    return row;
  }
  /* the alarm, docked in a place; redrawn only when its name, size or fill moves; a tick's new segments red for GROW_MS */
  function putAlarm(slot, doc, al, cls) {
    if (!slot) return;
    var old = slot.querySelector('.ks16-alarm'), size = al ? int(al.size, 0) : 0, filled = al ? int(al.filled, 0) : 0;
    var key = al && size >= 1 ? txt(al.name, 60) + '|' + size : '', sig = key ? key + '|' + filled : '';
    if (old && old.getAttribute('data-ks16-sig') === sig) return;
    var n = null;
    if (key) {
      var fresh = old && old.getAttribute('data-ks16-key') === key ? Pure.fresh(old.getAttribute('data-ks16-filled'), filled, size) : [];
      var p = clockPlate(doc, txt(al.name, 60), filled, size, fresh, cls);
      if (p) {
        n = p.el; n.classList.add('ks16-alarm');
        n.setAttribute('data-ks16-key', key); n.setAttribute('data-ks16-filled', String(filled)); n.setAttribute('data-ks16-sig', sig);
        if (fresh.length) { n.setAttribute('data-ks16-ticked', ''); setTimeout(function () { n.removeAttribute('data-ks16-ticked'); }, GROW_MS); }
      }
    }
    if (old && n) slot.replaceChild(n, old);
    else if (old) slot.removeChild(old);
    else if (n) slot.appendChild(n);
  }
  function stopTick(foot) { if (foot && foot.ks16Tick) { clearInterval(foot.ks16Tick); foot.ks16Tick = null; } }
  function mapFoot(el, m, env, doc) {
    var foot = el.querySelector('.ks16-mapfoot'), w = Pure.bandWords(m);
    if (!w) { if (foot) { stopTick(foot); foot.parentNode.removeChild(foot); } return; }
    if (!foot) {
      foot = doc.createElement('div'); foot.className = 'ks16-mapfoot';
      var dock = el.querySelector('.stage-dock');
      if (dock) { dock.classList.add('ks16-dockrow'); dock.insertBefore(foot, dock.firstChild); } else el.appendChild(foot);
    }
    var sig = JSON.stringify(m);
    if (foot.getAttribute('data-ks16-sig') === sig) return;
    foot.setAttribute('data-ks16-sig', sig);
    stopTick(foot);
    var oldPlate = foot.querySelector('.ks16-bandplate');
    if (w.text) {
      var skew = function () { return typeof env.skew === 'function' ? Number(env.skew()) || 0 : 0; };
      var p = W.B68Stage.plate({ kicker: w.kicker, title: w.title, line: w.line, side: w.timer ? Pure.timer(w.timer, Date.now(), skew()).text : '' }, doc);
      p.el.classList.add('ks16-bandplate');
      p.el.setAttribute('role', 'status');
      var before = p.slot('timer');
      var add = function (cls, t) { if (!t) return; var q = doc.createElement('p'); q.className = cls; q.textContent = t; p.el.insertBefore(q, before); };
      add('ks16-crew', w.crew); add('ks16-ways', w.ways);
      if (w.night) p.el.insertBefore(squares(doc, w.night), before);
      if (w.timer) {
        var side = p.slot('side'), tm = w.timer;
        side.classList.add('ks16-countdown');
        var paint = function () {
          if (!side.isConnected && foot.ks16Tick) { stopTick(foot); return; }
          var v = Pure.timer(tm, Date.now(), skew());
          side.textContent = v.state === 'paused' ? v.text + ' Paused' : v.text;
          side.setAttribute('data-ks16-timer', v.state);
        };
        paint();
        if (tm.paused !== true && typeof tm.endsAt === 'number') foot.ks16Tick = setInterval(paint, 1000);
      }
      if (oldPlate) foot.replaceChild(p.el, oldPlate); else foot.insertBefore(p.el, foot.firstChild);
    } else if (oldPlate) foot.removeChild(oldPlate);
    putAlarm(foot, doc, w.alarm, 'ks16-mapalarm');
  }
  function band(frame, cur, m, env) {
    if (!on()) return false;
    env = env || {};
    var doc = env.document || W.document;
    if (env.band && !env.band.hidden) env.band.hidden = true;
    if (env.container) env.container.classList.remove('dp-band-on');
    try {
      putAlarm(frame && typeof frame.slot === 'function' ? frame.slot('clocks') : null, doc, m && m.alarm, 'ks16-idlealarm');
      var el = cur && cur.el;
      if (el && el.classList && el.classList.contains('dp-map')) {
        if (!el.classList.contains('dp-map-capped')) el.classList.add('ks16-bleed');
        mapFoot(el, m, env, doc);
      }
    } catch (err) { /* the map stays as it is */ }
    return true;
  }

  return { VERSION: 1, GROW_MS: GROW_MS, on: on, card: card, speak: speak, npcStage: npcStage, band: band, Pure: Pure };
});
