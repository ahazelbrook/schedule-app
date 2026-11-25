/* sheet/glance.js: the glance screen on a player's phone (phone.glance), RK31 of the room key build. In the phone-glance bundle (app/routes.js):
   boot.js fetches it only while the setting is on and only for a player, and calls start() / stop(). With the setting off this file is never
   fetched, window.B68SheetGlance does not exist, and tracker.js draws exactly today's sheet.

   WHAT IT IS (the design's §2). One screen that fits a phone with no scrolling, top to bottom:
     the top bar     the name and "Hound · crew" (a tap: About), Table with one badge, Quiet (when the quiet line is on), ⋯
     Stress          a big count, the track sized to the playbook (Drain 10, Stress 12, Instability 9), the deadlocks as four bursts (Glitches n/4,
                     Irregularities n); a full track turns the block red and offers the keys. A box tap is the sheet's own (tap n: n; tap the last: n−1)
     Harm            what it costs, in alarm red, a short label made here from the levels held; the rows by level (4 only when written). A tap: the
                     harm editor (six lines, healing, armour, the resource; Done is one change). The rule itself comes from the rules search
     Actions         all twelve, three columns, each attribute's header showing its resist dice. A tap on an action: today's roll strip; on an
                     attribute: today's resist helper. Dots are display only here
     Abilities       the ones owned (and the Hull's frame features, the Vampire's Dayfire) as chips, two rows, then "+n more". A tap: the text, from
                     the data the sheet already has (content.js)
     the foot        Full sheet, or the GM's event while it is due (commendations with their countdown, the Debrief, the packet, a key to turn, in
                     the Now card's order); the rest wait in Table
   It measures itself and steps down until it fits (c1, then c2, then one chip row). Large text (⋯ › Text size, kept per phone) may scroll.

   HOW (as sheet/kit/tabs.js does). Nothing is rebuilt: tracker.js draws today's sheet, and render() calls apply(root, ctx) after every draw.
   This file marks each of the sheet's parts with data-gl-off ("1": hidden; "panel": the box goes and its open panel, a fixed bottom sheet on a
   phone, stays) and keeps ONE node of its own, .gl, as the last child of #dossier. Its controls carry the sheet's own hooks (data-act: stress,
   rollopen, resistopen, keyhit, heal, armor, resource, quiet, tablescreen, missionscreen, print, edit, back, remove, sessjoin; data-b68 for the
   phone modules), so tracker.js's own handlers do the work. Everything hides outside the phone's media query (glance.css), so a desk and print
   are today's sheet. Full sheet opens RK32's page (B68SheetPage.open) when it is there, else today's sheet with a "Glance screen" bar.

   UNDO (client only, no stored key). A tap or an edit on the sheet is snapshotted first (a capture listener on #dossier); when the play changed,
   the Undo bar shows "Stress 6 → 7" for 6 s with its seconds and a ×, and ⋯ › Recent changes keeps the last 20. Undo puts the play back as
   it was, but never clears a deadlock, a glitch or a robotic deadlock (the GM's, as today). A deadlock taken from the keys sheet resets
   Stress to 0 (the design's §6), with Undo of the reset; the Hull and the paranormal playbooks are left as they are.

   ctx (tracker.js, one line): { slots, doc, play, pb, ro, gm, table, now (B68Now's ctx or null), own ([{ n, t }]), rm (may remove), commit(),
   act(name, data) (a sheet action by name) }. apply() returns true when it has the sheet, so the four-screen sheet (kit.phone) is not drawn.
   RK32's page: B68SheetPage.open(container, character, opts) -> truthy when it drew; falsy keeps today's sheet. character { doc, play, pb, own }
   are live getters (tracker.js applyRemote swaps the play object). opts { main (over 760 px, the main view), focus, play() (the live play),
   close() (back to the glance), fallback() (today's sheet: for a page that learns late that it has no sheet or map), record(label, before),
   commit(), act(name, data) }. B68SheetPage.update(character), if it exists, is called after every redraw while the page is up. A change
   made by clicking a [data-act] button is recorded by the capture listener: the page must not record() it too. The view is never kept:
   a phone always reopens on the glance.
   Window.B68SheetGlance, and module.exports under Node (checks/runtime/sheet-glance.test.mjs reads the pure parts). ES5. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68SheetGlance = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var KEEP = 20, BAR_MS = 6000, TEXT_KEY = 'b68.glance.text', REFIT_MS = 2000;
  var FOOT = ['commend', 'debrief', 'absent', 'keys'];
  var FOOT_WORDS = { commend: ['Commendations are open', 'Mark your xp ›'], debrief: ['The Debrief is open', 'Answer it ›'], absent: ['While you were away', 'Read it ›'], keys: ['A key can turn', 'Decide ›'] };
  var STEPS = [{ c: '', rows: 2 }, { c: 'gl-c1', rows: 2 }, { c: 'gl-c2', rows: 2 }, { c: 'gl-c2', rows: 1 }];
  var LV = [['l4', 4], ['l3', 3], ['l2', 2], ['l1', 1]];

  /* ---------- pure (Node) ---------- */
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function isHull(pb) { return !!(pb && pb.hull); }
  function isGhost(pb) { return !!(pb && pb.ghost); }
  function isVamp(pb) { return !!(pb && pb.vampire); }
  function isTT(pb) { return !!(pb && pb.timetraveler); }
  function stressMax(pb) { return pb && pb.stressMax ? +pb.stressMax : isHull(pb) ? 10 : 9; }
  function stressName(pb) { return pb && pb.stressName ? pb.stressName : isHull(pb) ? 'Drain' : 'Stress'; }
  function harmName(pb) { return isHull(pb) ? 'Damage' : 'Harm'; }
  function cap(s) { s = str(s); return s.charAt(0).toUpperCase() + s.slice(1); }

  /* the harm held, worst first: [[level, words]] */
  function harmList(hm) {
    var out = []; hm = isObj(hm) ? hm : {};
    LV.forEach(function (k) { [].concat(hm[k[0]]).forEach(function (t) { t = str(t).trim(); if (t) out.push([k[1], t]); }); });
    return out;
  }
  /* what the harm held costs, as a short neutral label (the rule itself is the rules search's): none, a cost, or Mortal */
  function cost(hm, pb) {
    var list = harmList(hm), hull = isHull(pb);
    if (!list.length) return { kind: 'none', dice: 0, text: hull ? 'No damage' : 'No harm' };
    var dice = list.reduce(function (t, h) { return t + h[0]; }, 0);
    if (list[0][0] === 4) return { kind: 'mortal', dice: dice, text: hull ? 'Destroyed: repair, fast' : 'Mortal: you die without help, fast' };
    return { kind: 'cost', dice: dice, text: 'Effect may drop · ' + dice + 'd complications after' };
  }
  function rating(play, attr, groups) {
    var g = (groups || []).filter(function (x) { return x[0] === attr; })[0];
    return g ? g[1].filter(function (a) { return (+((play.dots || {})[a]) || 0) > 0; }).length : 0;
  }
  function resistDice(play, pb, attr, groups) { return rating(play, attr, groups) + (isVamp(pb) && play.darkMajesty === attr ? 1 : 0); }
  /* the struck keys this playbook counts on the stress block: deadlocks (and the Hull's robotic ones), glitches, irregularities */
  function struck(play, pb) {
    var keys = Array.isArray(play.keys) ? play.keys : [];
    if (isTT(pb) || isGhost(pb)) return keys.filter(function (k) { return k && k.glitch; }).length;
    return keys.filter(function (k) { return k && k.deadlock; }).length + (isHull(pb) && Array.isArray(play.roboticDeadlocks) ? play.roboticDeadlocks.length : 0);
  }
  /* a deadlock resets Stress to 0 (the design's §6); the Hull and the paranormal playbooks keep their own rules */
  function resets(pb) { return !(pb && (pb.hull || pb.paranormal)); }
  function afterDeadlock(play, pb) {
    if (!resets(pb) || !isObj(play) || !(+play.stress > 0)) return null;
    var from = +play.stress; play.stress = 0; return { from: from, to: 0 };
  }
  /* rows a run of chip widths takes, flowed left to right */
  function rowsFor(ws, rowW, gap) {
    var rows = 0, x = 0;
    ws.forEach(function (w) { w = Math.min(w, rowW); if (!rows || x + gap + w > rowW + 0.5) { rows++; x = w; } else x += gap + w; });
    return rows;
  }
  /* how many chips show on `rows` rows, the rest behind "+n more" (moreW(n): that chip's width). All of them when they fit */
  function clampChips(ws, rowW, gap, rows, moreW) {
    if (!ws.length || rowsFor(ws, rowW, gap) <= rows) return ws.length;
    for (var k = ws.length - 1; k >= 1; k--) if (rowsFor(ws.slice(0, k).concat([moreW(ws.length - k)]), rowW, gap) <= rows) return k;
    return 0;
  }
  /* the first fit step that does not overflow (over(i) says whether step i overflows), else the last */
  /* where a refit starts: a ResizeObserver refit (ro) within REFIT_MS of a full fit only steps further down, never back up, so two
     layouts that each measure the other as fitting can never flip-flop; any other fit starts from the top */
  function refitFrom(ro, now, fitAt, step) { return ro === true && now - (fitAt || 0) < REFIT_MS ? step || 0 : 0; }
  function pickStep(over, from) { for (var i = from || 0; i < STEPS.length; i++) if (!over(i)) return i; return STEPS.length - 1; }

  /* the undo stack: the newest last, at most KEEP */
  function Undo(max) { this.max = max || KEEP; this.items = []; }
  Undo.prototype.push = function (label, before, at) { this.items.push({ label: str(label), before: before, at: at || Date.now() }); if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max); return this.items.length; };
  Undo.prototype.pop = function () { return this.items.pop() || null; };
  Undo.prototype.top = function () { return this.items[this.items.length - 1] || null; };
  Undo.prototype.list = function () { return this.items.slice().reverse(); };
  Undo.prototype.clear = function () { this.items = []; };

  /* a change made something permanent (a deadlock, a glitch, a robotic deadlock): it is the GM's to undo */
  function permanent(b, a) {
    var bk = Array.isArray(b.keys) ? b.keys : [], ak = Array.isArray(a.keys) ? a.keys : [];
    var newly = ak.some(function (k, i) { var o = bk[i]; return !!k && ((k.deadlock && !(o && o.deadlock)) || (k.glitch && !(o && o.glitch))); });
    return !!newly || (Array.isArray(a.roboticDeadlocks) ? a.roboticDeadlocks.length : 0) > (Array.isArray(b.roboticDeadlocks) ? b.roboticDeadlocks.length : 0);
  }
  /* what changed, in a few words ('' when nothing but the log moved) */
  function diffLabel(b, a, pb) {
    var parts = [], seen = {};
    function add(s) { if (!seen[s]) { seen[s] = 1; parts.push(s); } }
    if (b.stress !== a.stress) add(stressName(pb) + ' ' + b.stress + ' → ' + a.stress);
    if (!same(b.harm, a.harm)) add(harmName(pb) + ' updated');
    if (b.healing !== a.healing) add((isHull(pb) ? 'Repair ' : 'Healing ') + (b.healing || 0) + ' → ' + (a.healing || 0));
    if (!same(b.armor, a.armor)) add('Armour ' + (isObj(a.armor) && (a.armor.armor || a.armor.heavy) ? 'used' : 'ready'));
    if (!same(b.resource, a.resource)) add(pb && pb.resource && !isHull(pb) ? cap(pb.resource) : 'Resource');
    var bk = Array.isArray(b.keys) ? b.keys : [], ak = Array.isArray(a.keys) ? a.keys : [];
    ak.forEach(function (k, i) {
      var o = bk[i]; if (!k || !o) return;
      if (k.deadlock && !o.deadlock) add('Deadlocked ' + (str(k.name) || 'a key'));
      else if (k.glitch && !o.glitch) add(cap(str(k.glitch)) + ': ' + (str(k.name) || 'a key'));
      else if ((k.hits || 0) !== (o.hits || 0)) add((str(k.name) || 'Key') + ' ' + (o.hits || 0) + ' → ' + (k.hits || 0) + ' hits');
    });
    if (ak.length !== bk.length) add('Keys changed');
    if (b.alluvium !== a.alluvium) add(cap((pb && pb.alluviumName) || 'canister') + 's ' + b.alluvium + ' → ' + a.alluvium);
    if (b.xpHold !== a.xpHold) add('Unspent xp ' + (b.xpHold || 0) + ' → ' + (a.xpHold || 0));
    if (!same(b.xp, a.xp)) add('XP marked');
    if (!same(b.dots, a.dots)) add('Ratings changed');
    if (!same(b.abilities, a.abilities) || !same(b.frame, a.frame) || !same(b.abilityTicks, a.abilityTicks)) add('Abilities changed');
    if (!same(b.items, a.items) || b.loadLimit !== a.loadLimit || !same(b.extraItems, a.extraItems)) add('Load changed');
    if (b.stacks !== a.stacks || b.bank !== a.bank) add('Stacks changed');
    if (!same(b.roboticDeadlocks, a.roboticDeadlocks)) add('Robotic deadlocks changed');
    if (!parts.length) {
      var skip = { log: 1, keyHitSession: 1 }, keys = {};
      Object.keys(b).concat(Object.keys(a)).forEach(function (k) { keys[k] = 1; });
      if (Object.keys(keys).some(function (k) { return !skip[k] && !same(b[k], a[k]); })) add('Sheet changed');
    }
    return parts.length > 2 ? parts.slice(0, 2).join(' · ') + ' · …' : parts.join(' · ');
  }
  /* put a snapshot back into the live play object, in place; a deadlock, glitch or robotic deadlock held now stays */
  function restore(target, snapJson) {
    var snap = JSON.parse(snapJson), nowKeys = Array.isArray(target.keys) ? target.keys : [];
    (Array.isArray(snap.keys) ? snap.keys : []).forEach(function (k, i) {
      var n = nowKeys[i]; if (!k || !n || str(n.name) !== str(k.name)) return;
      if (n.deadlock && !k.deadlock) k.deadlock = n.deadlock;
      if (n.glitch && !k.glitch) k.glitch = n.glitch;
    });
    if (Array.isArray(target.roboticDeadlocks)) { snap.roboticDeadlocks = Array.isArray(snap.roboticDeadlocks) ? snap.roboticDeadlocks : []; target.roboticDeadlocks.forEach(function (r) { if (snap.roboticDeadlocks.indexOf(r) < 0) snap.roboticDeadlocks.push(r); }); }
    Object.keys(target).forEach(function (k) { if (!(k in snap)) delete target[k]; });
    Object.keys(snap).forEach(function (k) { target[k] = snap[k]; });
    return target;
  }
  /* the foot's strip: the first due item of the foot's kinds (the Now card's order); the rest wait in Table */
  function footSplit(list) {
    var strip = null, rest = [];
    (Array.isArray(list) ? list : []).forEach(function (it) { if (!strip && it && FOOT.indexOf(it.id) >= 0) strip = it; else if (it) rest.push(it); });
    return { strip: strip, rest: rest };
  }
  function ago(at, now) { var s = Math.max(0, Math.round((now - at) / 1000)); return s < 45 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'; }

  /* ---------- the markup ---------- */
  var BURST = (function () { var p = []; for (var i = 0; i < 16; i++) { var a = i * Math.PI / 8, r = i % 2 ? 4.5 : 9; p.push((10 + r * Math.cos(a)).toFixed(1) + ',' + (10 + r * Math.sin(a)).toFixed(1)); } return p.join(' '); })();
  function burst(on) { return '<svg class="gl-burst' + (on ? ' gl-on' : '') + '" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><polygon points="' + BURST + '"/></svg>'; }
  var SHEET_ICON = '<svg class="gl-ico" viewBox="0 0 28 20" aria-hidden="true" focusable="false"><rect x="1" y="1" width="26" height="18" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 6h8M5 10h8M5 14h6M17 5v10M21 5v10" stroke="currentColor" stroke-width="2"/></svg>';

  function fullWords(pb) {
    if (isTT(pb)) return 'Instability full: take a temporal glitch ›';
    if (isGhost(pb)) return 'Drain full: strike out a key ›';
    if (isHull(pb)) return 'Drain full: deadlock a key ›';
    if (isVamp(pb)) return 'Stress full: see your keys ›';
    return 'Stress full: you’re out of the action for a moment. Deadlock a key ›';
  }
  /* the same, in one line, for the most compact step */
  function shortFull(pb) { return isTT(pb) ? 'Instability full: a glitch ›' : isGhost(pb) ? 'Drain full: strike out a key ›' : isVamp(pb) ? 'Stress full: your keys ›' : stressName(pb) + ' full: deadlock a key ›'; }
  function stressHtml(c) {
    var play = c.play, pb = c.pb, n = stressMax(pb), s = Math.max(0, Math.min(n, +play.stress || 0)), full = s >= n, name = stressName(pb), h = '';
    var dc = struck(play, pb), side;
    if (isTT(pb)) side = '<button type="button" class="gl-dl" data-gl="keys" aria-label="Temporal glitches ' + dc + ' of 4: your keys"><span class="gl-lab">Glitches</span><b class="gl-mono">' + dc + '/4</b></button>';
    else if (isGhost(pb)) side = '<button type="button" class="gl-dl" data-gl="keys" aria-label="Echo irregularities ' + dc + ': your keys"><span class="gl-lab">Irregularities</span><b class="gl-mono">' + dc + '</b></button>';
    else side = '<button type="button" class="gl-dl" data-gl="keys" aria-label="Deadlocks ' + Math.min(dc, 4) + ' of 4: your keys"><span class="gl-lab">Deadlocks</span>' + [0, 1, 2, 3].map(function (i) { return burst(i < dc); }).join('') + '</button>';
    var can = '';
    if (isTT(pb)) { var an = (pb && pb.alluviumName) || 'canister', al = +play.alluvium || 0; can = '<span class="gl-can">' + esc(cap(an) + 's') + ' <b class="gl-mono">' + al + '</b></span>'; }
    h += '<section class="gl-blk gl-stress' + (full ? ' gl-full' : '') + '" aria-label="' + esc(name) + '">';
    if (full) h += '<button type="button" class="gl-fullbar" data-gl="keys">' + burst(true) + '<span class="gl-fw">' + esc(fullWords(pb)) + '</span><span class="gl-fw-s">' + esc(shortFull(pb)) + '</span></button>';
    else h += '<div class="gl-blkh"><span class="gl-lab">' + esc(name) + '</span><span class="gl-count gl-mono">' + s + '<span class="gl-of">/' + n + '</span></span>' + can + '<span class="gl-sp"></span>' + side + '</div>';
    h += '<div class="gl-track" style="--n:' + n + '">';
    for (var i = 1; i <= n; i++) h += '<button type="button" class="gl-sbox' + (i <= s ? ' gl-on' : '') + '" data-act="stress" data-n="' + i + '" aria-label="' + esc(name) + ' ' + i + (i <= s ? ', marked' : '') + '"></button>';
    return h + '</div></section>';
  }
  function harmHtml(c) {
    var pb = c.pb, hm = isObj(c.play.harm) ? c.play.harm : {}, list = harmList(hm), co = cost(hm, pb), name = harmName(pb);
    var l2 = [].concat(hm.l2 || ['', '']), l1 = [].concat(hm.l1 || ['', '']);
    function cell(t, ph) { t = str(t).trim(); return '<span class="gl-hcell' + (t ? '' : ' gl-empty') + '">' + esc(t || ph) + '</span>'; }
    function row(lv, cells, one, hot, extra) { return '<span class="gl-hrow' + (one ? ' gl-one' : '') + (hot ? ' gl-hot' : '') + (extra || '') + '"><span class="gl-lv">' + lv + '</span>' + cells + '</span>'; }
    var h = '<button type="button" class="gl-blk gl-harm" data-gl="harm" aria-label="' + esc(name + ': ' + (list.length ? list.map(function (x) { return 'level ' + x[0] + ' ' + x[1]; }).join(', ') + '. ' + co.text : co.text) + '. Tap to change.') + '">';
    h += '<span class="gl-blkh"><span class="gl-lab">' + esc(name) + '</span><span class="gl-cost gl-k-' + co.kind + '">' + esc(co.text) + '</span></span>';
    if (str(hm.l4).trim()) h += row(4, cell(hm.l4, ''), true, true, ' gl-mortal');
    h += row(3, cell(hm.l3, 'Critical —'), true, !!str(hm.l3).trim());
    h += row(2, cell(l2[0], 'Major —') + cell(l2[1], 'Major —'), false, !!(str(l2[0]).trim() || str(l2[1]).trim()));
    h += row(1, cell(l1[0], 'Passing —') + cell(l1[1], 'Passing —'), false, !!(str(l1[0]).trim() || str(l1[1]).trim()));
    if (list.length) h += '<span class="gl-hsum">' + esc(list.map(function (x) { return x[0] + ' ' + x[1]; }).join(' · ')) + '</span>';
    return h + '</button>';
  }
  function actsHtml(c) {
    var play = c.play, pb = c.pb, groups = c.groups, shown = isVamp(pb) ? 5 : 4, h = '<section class="gl-blk gl-acts" aria-label="Actions"><div class="gl-cols">';
    groups.forEach(function (g) {
      var r = resistDice(play, pb, g[0], groups);
      h += '<div class="gl-attr"><button type="button" class="gl-attrh" data-act="resistopen" data-attr="' + esc(g[0]) + '" data-always="1" aria-label="Resist with ' + esc(g[0]) + ', ' + r + ' dice"><span class="gl-lab">' + esc(g[0]) + '</span><span class="gl-rd gl-mono">' + r + 'd</span></button>';
      g[1].forEach(function (a) {
        var v = +((play.dots || {})[a]) || 0, d = '';
        for (var i = 1; i <= shown; i++) d += '<i class="gl-dot' + (i <= v ? ' gl-on' : '') + '"></i>';
        h += '<button type="button" class="gl-act' + (v ? '' : ' gl-zero') + '" data-act="rollopen" data-a="' + esc(a) + '" data-always="1" aria-label="' + esc(a) + ', ' + v + ' dot' + (v === 1 ? '' : 's') + ': roll"><b>' + esc(a) + '</b><span class="gl-dots' + (shown === 5 ? ' gl-five' : '') + '" aria-hidden="true">' + d + '</span></button>';
      });
      h += '</div>';
    });
    return h + '</div></section>';
  }
  /* the chips: the abilities owned, the Hull's frame features, the Vampire's Dayfire (always in play) */
  function abList(c) {
    var pb = c.pb, play = c.play, out = (Array.isArray(c.own) ? c.own : []).map(function (a) { return { n: str(a && a.n), t: str(a && a.t) }; });
    if (isHull(pb)) (Array.isArray(play.frame) ? play.frame : []).forEach(function (n) { var f = ((pb && pb.frame) || []).filter(function (x) { return x[0] === n; })[0]; out.push({ n: str(n), t: f ? str(f[1]) : '', kind: 'frame' }); });
    if (isVamp(pb)) { var s = ((pb && pb.strictures) || []).filter(function (x) { return x[0] === 'Dayfire'; })[0]; out.push({ n: 'Dayfire', t: s ? str(s[1]) : '', kind: 'pin' }); }
    return out.filter(function (a) { return a.n; });
  }
  function absHtml(list) {
    var h = '<section class="gl-blk gl-abs" aria-label="Your abilities"><div class="gl-blkh"><span class="gl-lab">Abilities</span></div><div class="gl-chips">';
    if (!list.length) h += '<span class="gl-faint">None taken yet</span>';
    list.forEach(function (a, i) { h += '<button type="button" class="gl-chip' + (a.kind ? ' gl-k-' + a.kind : '') + '" data-gl="ab" data-i="' + i + '">' + esc(a.n) + '</button>'; });
    if (list.length) h += '<button type="button" class="gl-chip gl-plus" data-gl="abs" hidden>+0 more</button>';
    return h + '</div></section>';
  }
  function topHtml(c) {
    var pb = c.pb, doc = c.doc || {}, name = str(doc.name || (doc.sheet && doc.sheet.name)) || 'Your character', crew = str(c.play.crew).trim();
    var sub = (pb ? pb.name : str(doc.playbookName) || 'Character') + (crew ? ' · ' + crew : '');
    var b = c.badge, h = '<div class="gl-top">';
    h += '<button type="button" class="gl-who" data-gl="about" aria-label="About ' + esc(name) + '"><b>' + esc(name) + '</b><span>' + esc(sub) + '</span></button>';
    h += '<button type="button" class="gl-tb" data-gl="table" aria-haspopup="dialog" aria-label="Table' + (b ? ', ' + b + ' new' : '') + '">Table' + (b ? '<span class="gl-badge gl-mono" aria-hidden="true">' + b + '</span>' : '') + '</button>';
    if (c.quiet) h += '<button type="button" class="gl-tb gl-quiet" data-act="quiet" aria-haspopup="dialog" title="Tell the GM quietly">Quiet</button>';
    return h + '<button type="button" class="gl-tb gl-more" data-gl="more" aria-haspopup="dialog" aria-label="More">⋯</button></div>';
  }
  function linesHtml(c) {
    var h = '';
    if (c.status && c.status.bad) h += '<p class="gl-line bad" role="alert">' + esc(c.status.msg) + '</p>';
    var t = c.table, n = +c.play.session || 0;
    if (t && t.session > n) h += '<div class="gl-line"><span>Table: session ' + t.session + (t.inPlay ? ' · in play' : '') + '. This sheet is on ' + (n || 'none') + '.</span><button type="button" class="gl-sbtn" data-act="sessjoin">Join</button></div>';
    return h;
  }
  /* an event item (sheet/now.js's shape) drawn in full: its title, line, the module's own markup and its buttons */
  function itemHtml(it) {
    var h = '<div class="gl-item" data-now="' + esc(it.id) + '"><b class="gl-item-t">' + esc(it.title) + '</b>';
    var ends = typeof it.ends === 'number' && isFinite(it.ends) && it.ends > 0 ? Math.floor(it.ends) : 0;
    if (str(it.line) || ends) h += '<p class="gl-item-l">' + esc(it.line) + (ends ? ' <span class="gl-mono" data-ends="' + ends + '"></span>' : '') + '</p>';
    if (str(it.html)) h += '<div class="gl-item-h">' + str(it.html) + '</div>';
    var a = (Array.isArray(it.actions) ? it.actions : []).filter(function (x) { return isObj(x) && str(x.label); });
    if (a.length) h += '<div class="gl-row">' + a.map(function (x) { return '<button type="button" class="gl-btn' + (x.primary ? ' gl-go' : '') + '" ' + str(x.attrs) + '>' + esc(x.label) + '</button>'; }).join('') + '</div>';
    return h + '</div>';
  }
  function primaryOf(it) { return (Array.isArray(it.actions) ? it.actions : []).filter(function (x) { return isObj(x) && x.primary && str(x.attrs); })[0] || null; }
  function footHtml(c, left) {
    var it = c.strip, h = '<div class="gl-foot">';
    if (!it) return h + '<button type="button" class="gl-primary" data-gl="full">' + SHEET_ICON + '<span>Full sheet</span></button></div>';
    var w = FOOT_WORDS[it.id] || [str(it.title), 'Open ›'], p = primaryOf(it), ends = typeof it.ends === 'number' && it.ends > 0 ? Math.floor(it.ends) : 0;
    var go = p && !str(it.html) ? str(p.attrs) : 'data-gl="event"';
    h += '<button type="button" class="gl-event" ' + go + '><span class="gl-ev-w"><b>' + esc(w[0]) + '</b><span>' + esc(w[1]) + '</span></span>' + (ends ? '<span class="gl-ev-clock gl-mono" data-ends="' + ends + '">' + esc(left(ends)) + '</span>' : '') + '</button>';
    var not = (Array.isArray(it.actions) ? it.actions : []).filter(function (x) { return isObj(x) && x.cls === 'ds-now-not'; })[0];
    if (not) h += '<button type="button" class="gl-not" ' + str(not.attrs) + '>Not now</button>';
    return h + '</div>';
  }

  /* ---------- the state ---------- */
  var st = { on: false, root: null, node: null, id: null, ctx: null, view: 'glance', sheet: null, undo: new Undo(KEEP), field: null,
    barT: null, parts: {}, abs: [], step: 0, glitchPick: null, harmDraft: null, obs: null, lg: false, wide: false, info: null, due: null };

  function doc() { return W && W.document; }
  function store() { try { return W && W.localStorage ? W.localStorage : null; } catch (e) { return null; } }
  function large() { var ls = store(); try { return !!ls && ls.getItem(TEXT_KEY) === 'large'; } catch (e) { return false; } }
  function setLarge(on) { var ls = store(); try { if (ls) { if (on) ls.setItem(TEXT_KEY, 'large'); else ls.removeItem(TEXT_KEY); } } catch (e) { /* private mode: this visit only */ } st.lg = !!on; }
  function narrow() { try { return !!(W.matchMedia && W.matchMedia('screen and (max-width: 760px)').matches); } catch (e) { return false; } }
  function snap() { return st.ctx ? JSON.stringify(st.ctx.play) : null; }
  function classicStatus(r) { var s = r && r.querySelector('#ds-status'); return s ? { msg: str(s.textContent).trim(), bad: s.classList.contains('bad') } : null; }
  function pageReal() { var P = W.B68SheetPage; return !!(P && !P.stub && typeof P.open === 'function'); }

  /* what the Table button counts: new on the iPad, a new mission card, fresh handouts, and events waiting behind the strip */
  function tableInfo(r, rest) {
    var tv = r.querySelector('.ds-tablebtn'), mb = r.querySelector('.ds-missionbtn'), H = W.B68Handouts, hs = null;
    if (H && typeof H.state === 'function') { try { hs = H.state(); } catch (e) { hs = null; } }
    var info = { tv: !!tv, tvNew: !!(tv && tv.classList.contains('new')), mission: !!mb, mNew: !!(mb && mb.classList.contains('new')), ho: !!(hs && hs.started), hoN: hs && hs.items ? hs.items.length : 0, hoNew: hs && hs.fresh ? +hs.fresh || 0 : 0, rest: rest || [] };
    info.badge = (info.tvNew ? 1 : 0) + (info.mNew ? 1 : 0) + info.hoNew + info.rest.length;
    return info;
  }

  /* ---------- marking today's sheet ---------- */
  function setA(n, k, v) { if (v == null) { if (n.hasAttribute(k)) n.removeAttribute(k); } else if (n.getAttribute(k) !== v) n.setAttribute(k, v); }
  function mark(c) {
    var slots = c.slots || {}, hide = st.view !== 'sheet';
    Object.keys(slots).forEach(function (name) {
      if (name === 'vitals') return;   /* inside the head, which goes whole */
      ((slots[name] && slots[name].nodes) || []).forEach(function (n) {
        if (!n || n.nodeType !== 1 || !n.parentNode) return;
        setA(n, 'data-gl-off', !hide ? null : n.querySelector('.ds-roll') ? 'panel' : '1');
      });
    });
    setA(st.root, 'data-gl', st.view);
  }
  function unmark(r) {
    if (!r) return;
    Array.prototype.forEach.call(r.querySelectorAll('[data-gl-off]'), function (n) { n.removeAttribute('data-gl-off'); });
    r.removeAttribute('data-gl');
  }

  /* ---------- drawing ---------- */
  function node() {
    var r = st.root, n = st.node;
    if (!n || n.parentNode !== r) {
      n = doc().createElement('div'); n.className = 'gl';
      n.innerHTML = '<div class="gl-screen" role="region" aria-label="Your sheet at a glance"><div class="gl-p-top"></div><div class="gl-p-lines"></div><div class="gl-body"><div class="gl-p-stress"></div><div class="gl-p-harm"></div><div class="gl-p-acts"></div><div class="gl-p-abs"></div></div><div class="gl-p-foot"></div></div>' +
        '<div class="gl-backbar"><button type="button" class="gl-primary" data-gl="glance"><span>‹ Glance screen</span></button><button type="button" class="gl-tb gl-more" data-gl="more" aria-haspopup="dialog" aria-label="More">⋯</button></div>' +
        '<div class="gl-page" hidden></div><div class="gl-layer"></div>' +
        '<div class="gl-undo" role="status" hidden><span class="gl-u-l"></span><span class="gl-u-s gl-mono" aria-hidden="true"></span><button type="button" class="gl-u-go" data-gl="undo">Undo</button><button type="button" class="gl-u-x" data-gl="undox" aria-label="Clear">×</button></div>';
      st.node = n; st.parts = {}; r.appendChild(n); wireNode(n); watch(n);
    } else if (n !== r.lastElementChild) r.appendChild(n);
    return n;
  }
  function part(name, html) {
    if (st.parts[name] === html) return false;
    var el = st.node.querySelector('.gl-p-' + name); if (!el) return false;
    el.innerHTML = html; st.parts[name] = html; return true;
  }
  function draw(c) {
    var n = node(), due = [];
    if (c.now && W.B68Now && typeof W.B68Now.due === 'function') { try { due = W.B68Now.due(c.now) || []; } catch (e) { due = []; } }
    var fs = footSplit(due), info = tableInfo(st.root, fs.rest);
    st.abs = abList(c); st.info = info; st.due = fs;
    var v = { doc: c.doc, play: c.play, pb: c.pb, groups: c.groups, own: c.own, badge: info.badge, quiet: !!st.root.querySelector('.ds-quietbtn'), status: classicStatus(st.root), table: c.table, strip: fs.strip };
    var moved = false;
    moved = part('top', topHtml(v)) || moved;
    moved = part('lines', linesHtml(v)) || moved;
    moved = part('stress', stressHtml(v)) || moved;
    moved = part('harm', harmHtml(v)) || moved;
    moved = part('acts', actsHtml(v)) || moved;
    moved = part('abs', absHtml(st.abs)) || moved;
    /* the countdown is written in place (B68Now.tick), never into the compared markup, so a ticking clock never redraws the foot */
    var fm = part('foot', footHtml(v, function () { return ''; })); if (fm) tickIn(st.node.querySelector('.gl-p-foot'));
    moved = fm || moved;
    if (n.classList.contains('gl-lg') !== !!st.lg) { n.classList.toggle('gl-lg', !!st.lg); moved = true; }
    n.querySelector('.gl-page').hidden = st.view !== 'page';
    if (moved) fit();
    drawSheet(false);
    /* RK32's page hears every redraw (a poll, a commit, an action) while it is up */
    if (st.view === 'page' && pageReal() && typeof W.B68SheetPage.update === 'function') { try { W.B68SheetPage.update(character()); } catch (e) { if (W.console) W.console.error(e); } }
  }

  /* ---------- fitting: c1, c2, then one chip row ---------- */
  function clampDom(rows) {
    var box = st.node.querySelector('.gl-chips'); if (!box) return;
    var chips = Array.prototype.slice.call(box.querySelectorAll('.gl-chip:not(.gl-plus)')), more = box.querySelector('.gl-chip.gl-plus'); if (!more) return;
    chips.forEach(function (ch) { ch.hidden = false; }); more.hidden = true;
    if (!chips.length || st.lg) return;
    var cs = W.getComputedStyle(box), gap = parseFloat(cs.columnGap || cs.gap) || 6, rowW = box.clientWidth;
    var ws = chips.map(function (ch) { return ch.getBoundingClientRect().width; });
    more.hidden = false; more.textContent = '+' + chips.length + ' more'; var mw = more.getBoundingClientRect().width; more.hidden = true;
    var k = clampChips(ws, rowW, gap, rows, function () { return mw; });
    if (k >= chips.length) return;
    chips.forEach(function (ch, i) { ch.hidden = i >= k; });
    more.hidden = false; more.textContent = '+' + (chips.length - k) + ' more';
  }
  function over() { var b = st.node.querySelector('.gl-body'); return !!b && b.scrollHeight > b.clientHeight + 1; }
  function setStep(i) { var n = st.node; STEPS.forEach(function (s) { if (s.c) n.classList.remove(s.c); }); if (STEPS[i].c) n.classList.add(STEPS[i].c); clampDom(STEPS[i].rows); }
  /* ro: a ResizeObserver refit. Within 2 s of a full fit it only steps further down, never back up, so two layouts that each measure
     the other as fitting (a part redrawn mid-change) can never flip-flop */
  function fit(ro) {
    var n = st.node; if (!n) return;
    var scr = n.querySelector('.gl-screen'), shown = false;
    var cs = null; try { cs = W.getComputedStyle(scr); shown = cs.display !== 'none'; } catch (e) { shown = false; }
    if (!shown) { setStep(0); return; }
    /* the bundle's stylesheet not in force yet (its link still loading): measure once it is, never before */
    if (cs.position !== 'fixed') { if (!st.fitT && (st.fitTries = (st.fitTries || 0) + 1) <= 60) st.fitT = W.setTimeout(function () { st.fitT = null; fit(); }, 100); return; }
    st.fitTries = 0;
    if (st.lg) { setStep(0); st.step = 0; n.classList.remove('gl-scroll'); n.setAttribute('data-step', 'lg'); return; }
    var from = refitFrom(ro, Date.now(), st.fitAt, st.step);
    if (ro !== true) st.fitAt = Date.now();
    st.step = pickStep(function (i) { setStep(i); return over(); }, from);
    setStep(st.step);
    /* the last step still overflows (a phone held sideways, under 760 px wide): the body scrolls, so nothing is out of reach */
    n.classList.toggle('gl-scroll', st.step === STEPS.length - 1 && over());
    n.setAttribute('data-step', String(st.step));
    st.fitSig = sizes();
  }
  /* what the fit measured: the body's room and each part's height. Anything that moves them later (a webfont, the stage banner, a part
     redrawn) fits again; a fit that changes nothing leaves the same sizes, so it never loops */
  function sizes() { var n = st.node; if (!n) return ''; return Array.prototype.map.call(n.querySelectorAll('.gl-body, .gl-screen > div, .gl-body > div'), function (e) { return Math.round(e.getBoundingClientRect().height); }).join(',') + '|' + Math.round(n.querySelector('.gl-chips') ? n.querySelector('.gl-chips').clientWidth : 0); }
  function watch(n) {
    if (typeof W.ResizeObserver !== 'function') return;
    if (!st.ro) st.ro = new W.ResizeObserver(function () { if (!active() || st.view === 'sheet' || st.lg || st.roT) return; st.roT = W.setTimeout(function () { st.roT = null; if (active() && sizes() !== st.fitSig) fit(true); }, 30); });
    st.ro.disconnect();
    Array.prototype.forEach.call(n.querySelectorAll('.gl-body, .gl-screen > div, .gl-body > div, .gl-chips'), function (e) { st.ro.observe(e); });
  }

  /* ---------- the bottom sheets ---------- */
  function sheetFrame(title, sub, body, live, foot) {
    return '<div class="gl-scrim" data-gl="close"></div><div class="gl-sheet" role="dialog" aria-modal="true" aria-labelledby="gl-sh-t" tabindex="-1">' +
      '<div class="gl-sh-h"><div class="gl-sh-tt"><h3 id="gl-sh-t">' + esc(title) + '</h3><small class="gl-sh-sub">' + esc(sub || '') + '</small></div><button type="button" class="gl-x" data-gl="close" aria-label="Close">×</button></div>' +
      '<div class="gl-sh-b">' + (body || '') + '<div class="gl-sh-live">' + (live || '') + '</div>' + (foot || '') + '</div></div>';
  }
  function rowBtn(label, sub, attrs, extra) { return '<button type="button" class="gl-li' + (extra || '') + '" ' + attrs + '><b>' + esc(label) + '</b>' + (sub ? '<span>' + esc(sub) + '</span>' : '') + '<i aria-hidden="true">›</i></button>'; }
  function keysLive(c) {
    var play = c.play, pb = c.pb, keys = Array.isArray(play.keys) ? play.keys : [], g = isTT(pb) || isGhost(pb), h = '', hs = play.keyHitSession || {}, sm = stressMax(pb);
    if ((+play.stress || 0) >= sm) h += '<p class="gl-alarm">' + esc(fullWords(pb).replace(/ ›$/, '')) + '</p>';
    if (!keys.length) h += '<p class="gl-faint">No keys on this sheet.</p>';
    var used = keys.map(function (k) { return k && k.glitch; }).filter(Boolean), glist = isTT(pb) ? ((pb && pb.glitches) || []) : ((pb && pb.deadlocks) || []);
    h += '<div class="gl-list">';
    keys.forEach(function (k, i) {
      if (!k) return;
      var hits = +k.hits || 0, dl = k.deadlock, gl = k.glitch, words = (k.down ? '▼ ' + k.down : '') + (k.down && k.up ? ' · ' : '') + (k.up ? '▲ ' + k.up : '');
      h += '<div class="gl-key' + (dl || gl ? ' gl-struck' : '') + '"><div class="gl-key-n"><b>' + esc(k.name || 'Key') + '</b><span>' + esc(words) + '</span>';
      if (dl) h += '<span class="gl-dead">Deadlocked: ' + esc(dl === 'up' ? (k.up || 'intensified') : (k.down || 'reversed')) + '</span>';
      else if (gl) h += '<span class="gl-dead">' + esc(gl) + '</span>';
      else h += '<span class="gl-hits">' + hits + ' of 3 hits' + (hs[i] ? ' · hit this session' : '') + '</span>';
      h += '</div>';
      if (!dl && !gl) {
        h += '<div class="gl-row">';
        h += '<button type="button" class="gl-btn" data-act="keyhit" data-i="' + i + '" data-n="' + Math.min(3, hits + 1) + '"' + (hits >= 3 ? ' disabled' : '') + '>Hit</button>';
        if (hits > 0) h += '<button type="button" class="gl-btn" data-act="keyhit" data-i="' + i + '" data-n="' + hits + '" aria-label="Take a hit off ' + esc(k.name || 'this key') + '">−</button>';
        if (g) h += '<button type="button" class="gl-btn" data-gl="gpick" data-i="' + i + '" aria-expanded="' + (st.glitchPick === i) + '">Strike out</button>';
        else if (!isVamp(pb)) h += '<button type="button" class="gl-btn" data-gl="deadlock" data-i="' + i + '" data-dir="down">▼ ' + esc(k.down || 'Reversed') + '</button><button type="button" class="gl-btn" data-gl="deadlock" data-i="' + i + '" data-dir="up">▲ ' + esc(k.up || 'Intensified') + '</button>';
        h += '</div>';
        if (g && st.glitchPick === i) h += '<div class="gl-row">' + glist.map(function (n) { return '<button type="button" class="gl-btn gl-sm" data-act="glitch" data-i="' + i + '" data-v="' + esc(n) + '"' + (used.indexOf(n) >= 0 ? ' disabled' : '') + '>' + esc(n) + '</button>'; }).join('') + '</div>';
      }
      h += '</div>';
    });
    h += '</div>';
    if (isHull(pb)) h += '<div class="gl-lab">Robotic deadlocks</div><div class="gl-row">' + ((pb && pb.roboticDeadlocks) || []).map(function (r) { return '<button type="button" class="gl-btn gl-sm" data-act="robo" data-v="' + esc(r) + '" aria-pressed="' + ((play.roboticDeadlocks || []).indexOf(r) >= 0) + '">' + esc(r) + '</button>'; }).join('') + '</div>';
    if (!g && struck(play, pb) >= 4) h += '<p class="gl-alarm">Four deadlocks: time to retire this character</p>';
    if (isTT(pb) && struck(play, pb) >= 4) h += '<p class="gl-alarm">Four glitches: you leave this time after the next score</p>';
    if (resets(pb)) h += '<p class="gl-faint">A deadlock is permanent; your ' + esc(stressName(pb)) + ' goes back to 0.</p>';
    return h + rowBtn('Edit your keys on the full sheet', '', 'data-gl="full" data-to="ds-keybox"');
  }
  function harmStatic(c) {
    var hm = st.harmDraft || {}, pb = c.pb, hull = isHull(pb);
    function inp(k, lv, ph) { return '<input type="text" class="gl-in" data-glh="' + k + '" value="' + esc(hm[k] || '') + '" placeholder="' + esc(ph) + '" aria-label="' + esc('Level ' + lv + ' ' + harmName(pb).toLowerCase()) + '" autocomplete="off">'; }
    var h = '<div class="gl-lab">4 · ' + (hull ? 'Destroyed' : 'Mortal') + '</div>' + inp('l4', 4, 'Only when it’s fatal');
    h += '<div class="gl-lab">3 · Critical</div>' + inp('l3', 3, '—');
    h += '<div class="gl-lab">2 · Major</div><div class="gl-two">' + inp('l2.0', 2, '—') + inp('l2.1', 2, '—') + '</div>';
    h += '<div class="gl-lab">1 · Passing</div><div class="gl-two">' + inp('l1.0', 1, '—') + inp('l1.1', 1, '—') + '</div>';
    return h;
  }
  function harmFoot() {
    return '<div class="gl-row gl-sh-foot"><button type="button" class="gl-btn gl-go" data-gl="harmdone">Done</button><button type="button" class="gl-btn" data-gl="close">Cancel</button>' + (rulesOn() ? '<button type="button" class="gl-btn" data-gl="rule">The rule</button>' : '') + '</div><div class="gl-rule" hidden></div>';
  }
  function harmLive(c) {
    var play = c.play, pb = c.pb, hull = isHull(pb), heal = +play.healing || 0, ar = isObj(play.armor) ? play.armor : {}, res = Array.isArray(play.resource) ? play.resource : [false, false];
    var co = cost(play.harm, pb), h = '<p class="gl-cost gl-k-' + co.kind + '">' + esc(co.text) + '</p>';
    h += '<div class="gl-lab">' + (hull ? 'Repair' : 'Healing') + ' clock ' + heal + '/4</div><div class="gl-row gl-segs">';
    for (var i = 1; i <= 4; i++) h += '<button type="button" class="gl-seg' + (i <= heal ? ' gl-on' : '') + '" data-act="heal" data-n="' + i + '" aria-label="' + (hull ? 'Repair' : 'Healing') + ' ' + i + (i <= heal ? ', marked' : '') + '"></button>';
    h += '</div><div class="gl-row">';
    h += '<button type="button" class="gl-btn" data-act="armor" data-k="armor" aria-pressed="' + !!ar.armor + '">Armour ' + (ar.armor ? 'used' : 'ready') + '</button>';
    h += '<button type="button" class="gl-btn" data-act="armor" data-k="heavy" aria-pressed="' + !!ar.heavy + '">Heavy ' + (ar.heavy ? 'used' : 'ready') + '</button>';
    var rname = pb && pb.resource && !hull ? cap(pb.resource) : pb && pb.resource === null && !hull ? 'Resource' : '';
    if (rname) [0, 1].forEach(function (k) { h += '<button type="button" class="gl-btn" data-act="resource" data-k="' + k + '" aria-pressed="' + !!res[k] + '">' + esc(rname) + ' ' + (k + 1) + ' ' + (res[k] ? 'used' : 'ready') + '</button>'; });
    return h + '</div>';
  }
  function tableLive() {
    var i = st.info || { rest: [] }, h = '<div class="gl-list">', t = st.ctx && st.ctx.table;
    if (t && t.session) h += '<p class="gl-faint">Table: session ' + t.session + (t.inPlay ? ' · in play' : ' · ended') + '</p>';
    if (i.tv) h += rowBtn('What the iPad shows', i.tvNew ? 'Changed' : '', 'data-act="tablescreen" data-always="1" aria-haspopup="dialog"', i.tvNew ? ' gl-new' : '');
    if (i.ho) h += rowBtn('Handouts', i.hoN + (i.hoNew ? ' · ' + i.hoNew + ' new' : ''), 'data-b68="handouts-open" data-always="1" aria-haspopup="dialog"', i.hoNew ? ' gl-new' : '');
    if (i.mission) h += rowBtn('Mission card', i.mNew ? 'Changed' : '', 'data-act="missionscreen" data-always="1" aria-haspopup="dialog"', i.mNew ? ' gl-new' : '');
    h += '</div>';
    if (i.rest.length) h += '<div class="gl-lab">Waiting</div>' + i.rest.map(itemHtml).join('');
    var bt = [];
    if (W.B68Now && typeof W.B68Now.between === 'function') { try { bt = W.B68Now.between(st.ctx && st.ctx.now) || []; } catch (e) { bt = []; } }
    if (bt.length) h += '<div class="gl-lab">Between sessions</div>' + bt.map(itemHtml).join('');
    if (!i.tv && !i.ho && !i.mission && !i.rest.length && !bt.length) h += '<p class="gl-faint">Nothing from the table yet.</p>';
    return h;
  }
  function moreLive() {
    var c = st.ctx, s = classicStatus(st.root), lg = !!st.lg, h = '';
    if (s && s.msg) h += '<p class="gl-faint' + (s.bad ? ' gl-alarm' : '') + '">' + esc(s.msg) + '</p>';
    h += '<div class="gl-row"><span class="gl-lab">Text size</span><button type="button" class="gl-btn" data-gl="text" data-v="normal" aria-pressed="' + !lg + '">Normal</button><button type="button" class="gl-btn" data-gl="text" data-v="large" aria-pressed="' + lg + '">Large</button></div>';
    var th = doc().documentElement.getAttribute('data-theme') || 'auto';
    h += '<div class="gl-row"><span class="gl-lab">Theme</span>' + [['auto', 'Auto'], ['light', 'Paper'], ['dark', 'Night']].map(function (x) { return '<button type="button" class="gl-btn" data-theme-set="' + x[0] + '" aria-pressed="' + (th === x[0]) + '">' + x[1] + '</button>'; }).join('') + '</div>';
    h += '<div class="gl-list">' + rowBtn('Recent changes', st.undo.items.length ? st.undo.items.length + ' on this phone' : 'none yet', 'data-gl="recent"');
    if (st.view === 'sheet') h += rowBtn('Glance screen', '', 'data-gl="glance"'); else h += rowBtn('Full sheet', '', 'data-gl="full"');
    h += rowBtn('Notes and log', '', 'data-gl="full" data-to="notes"');
    h += rowBtn('Print', '', 'data-act="print" data-always="1"') + rowBtn('Edit figure', '', 'data-act="edit"') + rowBtn('Back to your files', '', 'data-act="back" data-always="1"');
    if (c && c.rm) h += rowBtn('Remove ' + str((c.doc && c.doc.name) || 'this character') + '…', '', 'data-act="remove"', ' gl-warn');
    return h + '</div>';
  }
  function recentLive() {
    var list = st.undo.list(), now = Date.now();
    if (!list.length) return '<p class="gl-faint">Nothing yet. Each change you make on this phone is kept here (the last 20) until you close the sheet.</p>';
    return '<div class="gl-list">' + list.map(function (u, i) { return '<div class="gl-li gl-static"><b>' + esc(u.label) + '</b><span>' + esc(ago(u.at, now)) + '</span>' + (i === 0 ? '<button type="button" class="gl-btn" data-gl="undo">Undo</button>' : '') + '</div>'; }).join('') + '</div>';
  }
  function absLive() {
    return '<div class="gl-list">' + st.abs.map(function (a) { return '<div class="gl-li gl-static gl-abt"><b>' + esc(a.n) + '</b>' + (a.t ? '<span>' + esc(a.t) + '</span>' : '') + '</div>'; }).join('') + '</div>' + rowBtn('All your abilities on the full sheet', '', 'data-gl="full" data-to="ds-abbox"');
  }
  function aboutStatic() { var a = st.root.querySelector('.ds-about'); return '<div class="gl-about">' + (a ? a.innerHTML : '') + '</div>'; }
  /* what each sheet is: its title, the line under it, the part drawn once, and the part drawn again after every change */
  function sheetSpec(kind, arg) {
    var c = st.ctx, pb = c.pb;
    switch (kind) {
      case 'harm': return { title: harmName(pb), sub: (isHull(pb) ? 'Repair' : 'Healing') + ' clock ' + (+c.play.healing || 0) + '/4', body: harmStatic(c), live: harmLive(c), foot: harmFoot() };
      case 'keys': { var n = struck(c.play, pb); return { title: isTT(pb) ? 'Your keys and glitches' : isGhost(pb) ? 'Your keys and irregularities' : 'Your keys', sub: isTT(pb) ? n + ' of 4 glitches' : isGhost(pb) ? n + ' irregularities' : Math.min(n, 4) + ' of 4 deadlocked', body: '', live: keysLive(c) }; }
      case 'table': return { title: 'Table', sub: 'What the GM sends you', body: '', live: tableLive() };
      case 'more': return { title: 'More', sub: '', body: '', live: moreLive() };
      case 'recent': return { title: 'Recent changes', sub: 'The last ' + KEEP + ', on this phone', body: '', live: recentLive() };
      case 'abs': return { title: 'Your abilities', sub: st.abs.length + ' in all', body: '', live: absLive() };
      case 'ab': { var a = st.abs[+arg] || { n: '', t: '' }; return { title: a.n, sub: a.kind === 'pin' ? 'Always in play' : a.kind === 'frame' ? 'Frame feature' : 'Special ability', body: '<p class="gl-abtext">' + esc(a.t || 'No text on this sheet for it.') + '</p>', live: '' }; }
      case 'about': return { title: str((c.doc && c.doc.name) || 'About'), sub: pb ? pb.name : '', body: aboutStatic(), live: '' };
      case 'event': { var it = st.due && st.due.strip; return { title: it ? it.title : 'Nothing due', sub: '', body: '', live: it ? itemHtml(it) : '<p class="gl-faint">Nothing is due now.</p>' }; }
    }
    return null;
  }
  function tickIn(scope) { if (W.B68Now && typeof W.B68Now.tick === 'function') { try { W.B68Now.tick(scope); } catch (e) { /* no countdown */ } } }
  function drawSheet(open) {
    var layer = st.node && st.node.querySelector('.gl-layer'); if (!layer) return;
    if (!st.sheet) { if (layer.firstChild) layer.innerHTML = ''; return; }
    var sp = sheetSpec(st.sheet.kind, st.sheet.arg);
    if (!sp) { st.sheet = null; layer.innerHTML = ''; return; }
    if (open || !layer.querySelector('.gl-sheet')) {
      layer.innerHTML = sheetFrame(sp.title, sp.sub, sp.body, sp.live, sp.foot); st.sheet.live = sp.live;
      var s = layer.querySelector('.gl-sheet');
      try { s.focus({ preventScroll: true }); } catch (e) { /* no focus */ }
      tickIn(layer);
      return;
    }
    var sub = layer.querySelector('.gl-sh-sub'); if (sub && sub.textContent !== sp.sub) sub.textContent = sp.sub;
    if (st.sheet.live !== sp.live) { var lv = layer.querySelector('.gl-sh-live'); if (lv) lv.innerHTML = sp.live; st.sheet.live = sp.live; tickIn(layer); }
  }
  function draftOf(hm) { hm = isObj(hm) ? hm : {}; var l2 = [].concat(hm.l2 || []), l1 = [].concat(hm.l1 || []); return { l4: str(hm.l4), l3: str(hm.l3), 'l2.0': str(l2[0]), 'l2.1': str(l2[1]), 'l1.0': str(l1[0]), 'l1.1': str(l1[1]) }; }
  function openSheet(kind, arg, opener) {
    if (kind === 'harm') st.harmDraft = draftOf(st.ctx.play.harm);
    st.glitchPick = null;
    st.sheet = { kind: kind, arg: arg, opener: opener || null };
    drawSheet(true);
  }
  function closeSheet() {
    var o = st.sheet && st.sheet.opener; st.sheet = null; st.harmDraft = null; st.glitchPick = null; drawSheet(false);
    if (o && o.isConnected) { try { o.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
  }

  /* the rule, from the rules search at run time (never from this file) */
  function rulesOn() { var R = W.B68Rules; return !!(R && typeof R.available === 'function' && R.available() && typeof R.hits === 'function' && typeof R.entry === 'function' && typeof R.load === 'function'); }
  function showRule() {
    var R = W.B68Rules, box = st.node && st.node.querySelector('.gl-rule'); if (!box || !rulesOn()) return;
    box.hidden = false; box.textContent = 'Looking it up…'; try { box.scrollIntoView({ block: 'nearest' }); } catch (e) { /* old engine */ }
    Promise.resolve(R.load()).then(function () {
      var h = R.hits('harm', 1), first = h && h.hits && h.hits[0], e = first ? R.entry(first.id) : null, M = W.B68Markdown;
      if (!box.isConnected) return;
      if (!e) { box.textContent = 'Not in the rules here yet.'; return; }
      box.innerHTML = (M && typeof M.render === 'function' ? M.render(str(e.md)) : '<p>' + esc(e.md) + '</p>') + '<a class="gl-rlink" href="' + esc(e.href) + '">Open it in the rules ›</a>';
    }).then(null, function () { if (box.isConnected) box.textContent = 'The rules could not load here.'; });
  }

  /* ---------- undo ---------- */
  function hideBar() { if (st.barT) { W.clearInterval(st.barT); st.barT = null; } var u = st.node && st.node.querySelector('.gl-undo'); if (u) u.hidden = true; }
  function showBar(label, canUndo) {
    var u = st.node && st.node.querySelector('.gl-undo'); if (!u) return;
    u.querySelector('.gl-u-l').textContent = label; u.querySelector('.gl-u-go').hidden = !canUndo; u.hidden = false;
    var end = Date.now() + BAR_MS, sec = u.querySelector('.gl-u-s');
    if (st.barT) W.clearInterval(st.barT);
    function tick() { var s = Math.ceil((end - Date.now()) / 1000); if (s <= 0) { hideBar(); return; } var t = s + ' s'; if (sec.textContent !== t) sec.textContent = t; }
    tick(); st.barT = W.setInterval(tick, 250);
  }
  function record(label, before) {
    if (!label || before == null) return;
    st.undo.push(label, before);
    showBar(label, true);
  }
  function undo() {
    var e = st.undo.pop(), c = st.ctx; if (!e || !c) return;
    restore(c.play, e.before);
    if (typeof c.act === 'function') c.act('panelclose', {});
    c.commit();
    showBar('Undone: ' + e.label, false);
  }
  /* a tap or an edit anywhere on the sheet: after the sheet's own handler ran, what changed becomes an Undo entry */
  function settle(before) {
    if (!active() || before == null) return;
    var b; try { b = JSON.parse(before); } catch (e) { return; }
    var a = st.ctx.play, label = diffLabel(b, a, st.ctx.pb); if (!label) return;
    if (permanent(b, a)) { showBar(label + ' (permanent: the GM can undo it)', false); return; }
    record(label, before);
  }
  function harmFrom(l) {
    var c = st.ctx; if (!c) return;
    if (typeof c.act === 'function') c.act('panelclose', {});
    openSheet('harm', null, null);
    var lv = { 1: ['l1.0', 'l1.1'], 2: ['l2.0', 'l2.1'], 3: ['l3'], 4: ['l4'] }, d = st.harmDraft, at = Math.max(1, Math.min(4, l));
    function empty(k) { return !str(d[k]).trim(); }
    while (at < 4 && !lv[at].some(empty)) at++;
    var k = lv[at].filter(empty)[0] || lv[at][0], inp = st.node.querySelector('[data-glh="' + k + '"]');
    if (inp) { try { inp.focus(); } catch (x) { /* no focus */ } }
  }
  function onCapture(e) {
    if (!active()) return;
    var t = e.target && e.target.closest ? e.target : null; if (!t) return;
    /* the roll strip's "Harm n": on the glance it opens the harm editor at that level, not today's box (which is hidden) */
    var mh = t.closest('[data-act="markharm"]');
    if (mh && st.view !== 'sheet') { e.stopPropagation(); e.preventDefault(); harmFrom(+mh.getAttribute('data-l') || 1); return; }
    if (!t.closest('[data-act], [data-change]')) return;   /* this file's own controls (data-gl) record themselves */
    var before = snap(); W.setTimeout(function () { settle(before); }, 0);
  }
  function onFocusIn(e) { if (!active()) return; var t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !t.closest('.gl')) st.field = snap(); }
  function onChange(e) { if (!active()) return; var t = e.target; if (!t || !st.field || !t.closest || t.closest('.gl')) return; var before = st.field; st.field = null; W.setTimeout(function () { settle(before); st.field = snap(); }, 0); }

  /* ---------- the controls ---------- */
  function active() { return !!(st.on && st.root && st.ctx && st.node); }
  function deadlock(i, dir) {
    var c = st.ctx, k = c && c.play.keys && c.play.keys[i]; if (!k || k.deadlock) return;
    c.act('deadlock', { i: String(i), dir: dir });   /* the sheet's own: it asks (permanent) and saves */
    var now = st.ctx; k = now && now.play.keys && now.play.keys[i];
    if (!k || !k.deadlock) return;
    var before = snap(), r = afterDeadlock(now.play, now.pb);
    if (!r) { showBar('Deadlocked ' + (k.name || 'a key') + ' (permanent: the GM can undo it)', false); return; }
    now.commit();
    record('Deadlocked ' + (k.name || 'a key') + ': ' + stressName(now.pb) + ' ' + r.from + ' → 0', before);
  }
  function trimmed(hm) { hm = isObj(hm) ? hm : {}; function t(x) { return str(x).trim(); } return { l4: t(hm.l4), l3: t(hm.l3), l2: [].concat(hm.l2 || ['', '']).slice(0, 2).map(t), l1: [].concat(hm.l1 || ['', '']).slice(0, 2).map(t) }; }
  function harmDone() {
    var c = st.ctx, d = st.harmDraft; if (!c || !d) return;
    var hm = trimmed({ l4: d.l4, l3: d.l3, l2: [d['l2.0'], d['l2.1']], l1: [d['l1.0'], d['l1.1']] });
    closeSheet();
    if (same(trimmed(c.play.harm), hm)) return;
    var before = snap();
    c.play.harm = hm; c.commit();
    record(harmName(c.pb) + ' updated', before);
  }
  function setView(v, to) {
    st.view = v;   /* never remembered: a phone always reopens on the glance (review, 25/11) */
    closeSheet();
    if (st.ctx) mark(st.ctx);
    if (st.node) st.node.querySelector('.gl-page').hidden = v !== 'page';
    if (v === 'sheet') {
      var target = to === 'notes' ? st.root.querySelector('textarea[data-path="notes"]') : to ? st.root.querySelector('.ds-grid .' + to) : null;
      var box = target && target.closest ? target.closest('.ds-box') || target : null;
      try { if (box) box.scrollIntoView({ block: 'start' }); else W.scrollTo(0, 0); } catch (e) { /* old engine */ }
    } else fit();
  }
  /* the character RK32's page reads: live getters, so a play the sheet swapped (tracker.js applyRemote) is the one it reads and edits */
  function character() {
    var o = {};
    ['doc', 'play', 'pb', 'own'].forEach(function (k) { Object.defineProperty(o, k, { enumerable: true, get: function () { return st.ctx ? st.ctx[k] : null; } }); });
    return o;
  }
  function openFull(to, main) {
    var c = st.ctx; if (!c) return;
    if (pageReal()) {
      var box = st.node.querySelector('.gl-page'), ok = false;
      try {
        ok = !!W.B68SheetPage.open(box, character(), { main: !!main, focus: to || null, play: function () { return st.ctx ? st.ctx.play : null; },
          fallback: function () { if (st.view === 'page') setView('sheet', to || null); },
          close: function () { if (st.view === 'page') setView('glance'); }, record: function (label, before) { record(label, before); },
          commit: function () { if (st.ctx) st.ctx.commit(); }, act: function (n, d) { if (st.ctx) st.ctx.act(n, d || {}); } });
      } catch (e) { if (W.console) W.console.error(e); ok = false; }
      if (ok) { setView('page'); return; }
    }
    setView('sheet', to);
  }
  function onNodeClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-gl]') : null;
    if (!active()) return;
    if (!t || !st.node.contains(t)) {
      /* a row of Table, ⋯ or the event that is the sheet's own control: the layer goes once its handler has run */
      var own = e.target && e.target.closest ? e.target.closest('.gl-sheet [data-act], .gl-sheet [data-b68]') : null;
      if (own && st.sheet && /^(table|more|event)$/.test(st.sheet.kind)) W.setTimeout(function () { if (st.sheet) closeSheet(); }, 0);
      return;
    }
    var g = t.getAttribute('data-gl');
    switch (g) {
      case 'close': closeSheet(); return;
      case 'about': case 'table': case 'more': case 'recent': case 'abs': case 'keys': case 'harm': case 'event': openSheet(g, null, t); return;
      case 'ab': openSheet('ab', t.getAttribute('data-i'), t); return;
      case 'full': openFull(t.getAttribute('data-to') || null, false); return;
      case 'glance': setView('glance'); return;
      case 'undo': undo(); if (st.sheet && st.sheet.kind === 'recent') drawSheet(false); return;
      case 'undox': hideBar(); return;
      case 'text': setLarge(t.getAttribute('data-v') === 'large'); draw(st.ctx); fit(); drawSheet(false); return;
      case 'deadlock': deadlock(+t.getAttribute('data-i'), t.getAttribute('data-dir') === 'up' ? 'up' : 'down'); drawSheet(false); return;
      case 'gpick': { var i = +t.getAttribute('data-i'); st.glitchPick = st.glitchPick === i ? null : i; drawSheet(false); return; }
      case 'harmdone': harmDone(); return;
      case 'rule': showRule(); return;
    }
  }
  function onNodeInput(e) { var t = e.target; if (t && t.getAttribute && t.getAttribute('data-glh') && st.harmDraft) st.harmDraft[t.getAttribute('data-glh')] = t.value; }
  function onNodeKey(e) {
    if ((e.key === 'Escape' || e.key === 'Esc') && st.sheet) { e.stopPropagation(); closeSheet(); return; }
    if (e.key === 'Enter' && e.target && e.target.getAttribute && e.target.getAttribute('data-glh')) { e.preventDefault(); harmDone(); }
  }
  function wireNode(n) { n.addEventListener('click', onNodeClick); n.addEventListener('input', onNodeInput); n.addEventListener('keydown', onNodeKey); }
  function wireRoot(r) {
    if (r.__gl) return; r.__gl = true;
    r.addEventListener('click', onCapture, true);
    r.addEventListener('focusin', onFocusIn, true);
    r.addEventListener('change', onChange);
  }
  var resizeT = null;
  function refit() { if (active() && st.view !== 'sheet') fit(); }
  function onResize() { if (resizeT) return; resizeT = W.setTimeout(function () { resizeT = null; if (active() && st.view !== 'sheet') fit(); }, 120); }
  /* the webfonts arriving after the first fit change every width: fit again (once they are in, and on each later load) */
  function fontsHook() {
    var F = W.document && W.document.fonts; if (st.fontsHooked || !F) return; st.fontsHooked = true;
    try { if (F.ready && typeof F.ready.then === 'function') F.ready.then(refit, function () {}); if (typeof F.addEventListener === 'function') F.addEventListener('loadingdone', refit); } catch (e) { /* no font loading API */ }
  }
  /* the badge and the status line follow the sheet's own in-place writes (the Table and Mission dots, the save status) */
  function observe() {
    if (typeof W.MutationObserver !== 'function') return;
    if (!st.obs) st.obs = new W.MutationObserver(function () { if (active()) draw(st.ctx); });
    st.obs.disconnect();
    ['#ds-status', '.ds-tablebtn', '.ds-missionbtn'].forEach(function (s) { var x = st.root.querySelector(s); if (x) st.obs.observe(x, { attributes: true, childList: true, characterData: true, subtree: true }); });
  }

  /* ---------- the seam ---------- */
  function apply(rootEl, ctx) {
    if (!st.on || !rootEl || !isObj(ctx) || ctx.ro || ctx.gm || !isObj(ctx.play) || !W || !W.document) { if (st.root || st.node) teardown(); return false; }
    var id = str(ctx.doc && ctx.doc.id);
    if (st.root !== rootEl || st.id !== id || !st.node || st.node.parentNode !== rootEl) {
      var fresh = st.id !== id || !st.node || !st.node.parentNode;   /* another sheet, or this one opened again: a clean start */
      if (st.root && st.root !== rootEl) teardown();
      st.root = rootEl; st.id = id;
      if (fresh) { st.undo.clear(); st.sheet = null; st.wide = false; st.view = 'glance'; st.node = null; }
    }
    if (W.B68SheetTabs && typeof W.B68SheetTabs.current === 'function' && W.B68SheetTabs.current() && typeof W.B68SheetTabs.teardown === 'function') W.B68SheetTabs.teardown();
    st.lg = large();
    st.ctx = { slots: ctx.slots, doc: ctx.doc, play: ctx.play, pb: ctx.pb, table: ctx.table || null, now: ctx.now || null, own: ctx.own, rm: !!ctx.rm, commit: ctx.commit, act: ctx.act,
      groups: (W.B68Content && W.B68Content.ACTIONS) || [] };
    wireRoot(rootEl);
    fontsHook();
    node();
    if (st.view === 'page' && !pageReal()) st.view = 'glance';
    mark(st.ctx);
    draw(st.ctx);
    observe();
    if (!narrow() && pageReal() && st.view !== 'page' && !st.wide) { st.wide = true; openFull(null, true); }
    return true;
  }
  function teardown() {
    var r = st.root;
    if (st.obs) st.obs.disconnect();
    if (st.ro) st.ro.disconnect();
    hideBar();
    if (st.node && st.node.parentNode) st.node.parentNode.removeChild(st.node);
    unmark(r);
    st.node = null; st.parts = {}; st.sheet = null; st.ctx = null; st.root = null; st.id = null; st.view = 'glance'; st.wide = false; st.undo.clear();
  }
  function redraw() { var T = W && W.B68Tracker; if (T && typeof T.refresh === 'function') { try { T.refresh(); } catch (e) { if (W.console) W.console.error(e); } } }
  function start() {
    if (st.on) return null;
    st.on = true;
    if (W && W.addEventListener) W.addEventListener('resize', onResize);
    redraw();
    return null;
  }
  function stop() {
    if (!st.on) return null;
    st.on = false;
    if (W && W.removeEventListener) W.removeEventListener('resize', onResize);
    teardown(); redraw();
    return null;
  }

  return {
    start: start, stop: stop, apply: apply, teardown: teardown,
    state: function () { return { on: st.on, view: st.view, step: st.step, sheet: st.sheet ? st.sheet.kind : null, undo: st.undo.items.map(function (u) { return u.label; }), large: !!st.lg }; },
    Pure: { cost: cost, harmList: harmList, clampChips: clampChips, rowsFor: rowsFor, pickStep: pickStep, STEPS: STEPS, Undo: Undo, diffLabel: diffLabel, restore: restore, permanent: permanent,
      afterDeadlock: afterDeadlock, refitFrom: refitFrom, REFIT_MS: REFIT_MS, resets: resets, struck: struck, resistDice: resistDice, footSplit: footSplit, stressMax: stressMax, stressName: stressName, KEEP: KEEP, BAR_MS: BAR_MS, FOOT: FOOT }
  };
});
