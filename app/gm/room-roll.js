/* gm/room-roll.js: the room roll (RK13 of the room key build; setting room.tables, bundle room-tables).

   Plain script, UMD: window.B68GmRoomRoll in the browser, module.exports under Node. ES5. Pure: no DOM, no storage, no network, no module
   state, and it never writes onto what it is given (a roll, a table, a room's things). GM only. It reads room-things.js (slug),
   room-state.js (roomKeys) and room-tables.js (get) when called, never at load: the room-tables bundle brings room-key first.

   THE REPLAY CONTRACT. location.js draws in the vault's order and nothing here draws inside generate() (before location.js:619): a room's
   draw forks its own rng after the site is rolled, so every saved site, Earlier chip and map layout replays unchanged. Three streams
   (Gate 0 ruling 5), each mulberry32 seeded from FNV-1a of  <rollKey>|<roomKey>|<stream>:
     say     which of the table's read-aloud lines
     things  one order of the table's things (a shuffle); the draw, Roll another and Swap all walk it
     people  the quick-draw slots
   rollKey is the page's rollKey(roll) (the seed, or 'a:' + an authored site's name), so two authored sites on one base seed differ.
   rr (Reroll the room) re-forks say and things ('|rr<n>' on their seed) and NEVER people: room-state's reroll keeps `kept`, which
   names a person slot, so the people a Keep filed must stay the people on the card. Hand-written things never move people either.

   key(rollKey, roomKey) -> seedKey             String(rollKey) + '|' + roomKey
   roll(table, seedKey, opts) -> draw           table: a room of the rooms part (room-tables get()), or null (no table)
     opts = { hand?: [thing]  the room note's things (RK08), shown first;
              say?, rr?, extra?: [slug], swaps?: { <slug>: <slug> }   room-state's read() shape: overrides only, never rolled text }
     draw = { table: bool       false: no table for this room; the caller says "No table for <room>" (ruling 6: no theme-item fallback)
              say: i | null     index into table.say
              things: [i]       the table's things shown, as indices into table.things, in the card's order
              shown: [{ src: 'note' | 'table', i, slug }]   every thing on the card in order: the note's first (i into opts.hand), then
                                                          the table's (i into table.things)
              people: [{ role, seed }]                    slots only (slot id 'p' + (n + 1)); RK17 makes the cards }
     The draw: the note's things come first, deduped by slug (room-things.js slug: case, punctuation, accents and a leading a/an/the/some
     ignored). A room with fewer than 3 is topped up from its table to DRAW (4) things; a table thing whose slug a note thing has is never
     drawn. A room with 3 or more note things draws none (so 3 stay 3). The table's things keep the mix (MIX): at least one clue, at least
     one escape or cover, at most one weapon, counted over everything shown; when the note's things make that impossible, the fewest
     misses. Shown in table order (the most obvious first). Then the overrides: a swap replaces its slug in place, extra adds at the end,
     say picks the line. An override naming a slug the table no longer has, or one already shown, is skipped.
     People by the table's band: public draws one person who is never `nobody`, then a second weighted draw where `nobody` means none;
     working, controlled and secure draw once, weighted, `nobody` meaning none (so 0 unless the People weights say otherwise).
   another(table, seedKey, opts) -> slug | null      Roll another: the first table thing in the things order not shown and not swapped
                                                      away that keeps the mix best; null when none is left. The caller stores it with
                                                      RS.addExtra.
   swap(table, seedKey, opts, i) -> { slug, to } | null   Swap shown[i]: step forward from its place in the things order (a note's
                                                      thing starts at the top) to the next table thing not shown that keeps the mix
                                                      best (swapping out the only clue, or the only way out or cover, gives one back
                                                      when the table has one left); slug is what shows now. The caller stores
                                                      RS.setSwap(rollKey, roomKey, slug, to), which collapses chains; a run of swaps
                                                      on one place comes round to its first thing again (which stores nothing).
     Both keep the weapon cap hard: a weapon never joins things that already hold one, so with only such a weapon left they give null.
   thingsOf(draw, table, hand) -> [thing]             the shown things themselves (copies), in order
   there(names) -> "There's a tall cupboard, a broom and a radio."   the app's line naming the things drawn (names only); '' for none
   site(roll, T, opts) -> { rollKey, order: [roomKey], rooms: { <roomKey>: { name, roomKey, draw } } } | null
     The same pass over any roll: a rolled site, or an authored one after authoredRoll (RK13.4), keyed by room name, every field of a
     room optional (an authored room may carry only its name). Writes nothing onto roll. opts = { state?(rollKey, roomKey) -> read,
     hand?(room, roomKey) -> [thing] }. null for a roll with no rollKey.
   rng(seedKey, stream, rr) -> () -> [0, 1)          the streams, for tests
   DRAW, MIX, SAY_MAX */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmRoomRoll = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var DRAW = 4, TOPUP = 3, SAY_MAX = 9;
  var MIX = { clue: 1, way: ['escape', 'cover'], weapon: 1 };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function listOf(v) { return Array.isArray(v) ? v : []; }
  function copy(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  /* the modules this one reads, when called */
  function mod(name, file) {
    if (root && root[name]) return root[name];
    if (typeof require === 'function') { try { return require(file); } catch (e) { /* not under Node */ } }
    return null;
  }
  function Things() { return mod('B68GmRoomThings', './room-things.js'); }
  function State() { return mod('B68GmRoomState', './room-state.js'); }
  function Tables() { return mod('B68GmRoomTables', './room-tables.js'); }
  function slug(name) { var Th = Things(); return Th ? Th.slug(str(name)) : ''; }

  /* ---------- the streams ---------- */
  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function rrOf(n) { return typeof n === 'number' && n % 1 === 0 && n > 0 ? n : 0; }
  function rng(seedKey, stream, rr) {
    var r = stream === 'people' ? 0 : rrOf(rr);
    return mulberry32(fnv(str(seedKey) + '|' + str(stream) + (r ? '|rr' + r : '')));
  }
  function key(rollKey, roomKey) { return str(rollKey) + '|' + str(roomKey); }

  /* ---------- the mix ---------- */
  function tagsOf(t) { return isObj(t) ? listOf(t.tags) : []; }
  /* how far a set of things is from the mix: a missing clue, a missing escape or cover, and each weapon past one counting twice (so a
     second weapon never comes in to bring a clue or a way out back) */
  function misses(set) {
    var clue = 0, way = 0, weapon = 0;
    set.forEach(function (t) {
      var g = tagsOf(t);
      if (g.indexOf('clue') >= 0) clue++;
      if (g.indexOf(MIX.way[0]) >= 0 || g.indexOf(MIX.way[1]) >= 0) way++;
      if (g.indexOf('weapon') >= 0) weapon++;
    });
    return (clue >= MIX.clue ? 0 : 1) + (way ? 0 : 1) + 2 * Math.max(0, weapon - MIX.weapon);
  }
  /* the first combination of n positions of order (lexicographic in order's positions) with the fewest misses alongside base */
  function pick(order, n, base, things) {
    if (n <= 0 || !order.length) return [];
    n = Math.min(n, order.length);
    var idx = [], best = null, bestMiss = Infinity, i, j;
    for (i = 0; i < n; i++) idx.push(i);
    for (;;) {
      var chosen = idx.map(function (p) { return order[p]; });
      var m = misses(base.concat(chosen.map(function (x) { return things[x]; })));
      if (m < bestMiss) { bestMiss = m; best = chosen; if (!m) break; }
      for (i = n - 1; i >= 0 && idx[i] === order.length - n + i; i--) { /* the last position that can still move on */ }
      if (i < 0) break;
      idx[i]++;
      for (j = i + 1; j < n; j++) idx[j] = idx[j - 1] + 1;
    }
    return best;
  }
  function armed(t) { return tagsOf(t).indexOf('weapon') >= 0; }
  /* of the candidates (table indices, in the order to try), the first whose adding to base misses least; a weapon never joins a set
     that already holds one (the cap is hard here: Roll another and Swap give null rather than a second weapon) */
  function first(cands, base, things) {
    var best = null, bestMiss = Infinity, cap = base.some(armed);
    cands.forEach(function (j) {
      if (cap && armed(things[j])) return;
      var m = misses(base.concat([things[j]]));
      if (m < bestMiss) { bestMiss = m; best = j; }
    });
    return best;
  }

  /* ---------- one room ---------- */
  function handOf(hand) {
    var out = [], seen = {};
    listOf(hand).forEach(function (t, i) {
      if (!isObj(t)) return;
      var s = slug(t.name);
      if (!s || has(seen, s)) return;
      seen[s] = true;
      out.push({ src: 'note', i: i, slug: s, t: t });
    });
    return out;
  }
  function tableThings(table) { return isObj(table) ? listOf(table.things) : []; }
  /* the things order: a shuffle of the table's indices from the things stream */
  function orderOf(table, seedKey, rr) {
    var n = tableThings(table).length, r = rng(seedKey, 'things', rr), out = [], i;
    for (i = 0; i < n; i++) out.push(i);
    for (i = n - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)), x = out[i]; out[i] = out[j]; out[j] = x; }
    return out;
  }
  function slugsOf(table) { return tableThings(table).map(function (t) { return isObj(t) ? slug(t.name) : ''; }); }

  function peopleOf(table, seedKey) {
    var list = listOf(table.people).filter(function (p) { return isObj(p) && typeof p.role === 'string' && p.role && typeof p.w === 'number' && p.w > 0; });
    var r = rng(seedKey, 'people'), out = [];
    function weighted(pool) {
      var total = 0, x, k;
      pool.forEach(function (p) { total += p.w; });
      if (!total) return null;
      x = r() * total;
      for (k = 0; k < pool.length; k++) { x -= pool[k].w; if (x < 0) return pool[k].role; }
      return pool[pool.length - 1].role;
    }
    function slot(role) { var s = Math.floor(r() * 4294967296) >>> 0; if (role && role !== 'nobody') out.push({ role: role, seed: s }); }
    var someone = list.filter(function (p) { return p.role !== 'nobody'; });
    if (table.band === 'public') { if (someone.length) slot(weighted(someone)); slot(weighted(list)); } else slot(weighted(list));
    return out;
  }

  /* the room's draw before its overrides, and what the overrides make of it */
  function work(table, seedKey, opts) {
    var o = isObj(opts) ? opts : {}, things = tableThings(table), slugs = slugsOf(table), hand = handOf(o.hand), rr = rrOf(o.rr);
    var handSlugs = hand.map(function (h) { return h.slug; });
    var order = orderOf(table, seedKey, rr).filter(function (j) { return isObj(things[j]) && slugs[j] && handSlugs.indexOf(slugs[j]) < 0; });
    var base = hand.map(function (h) { return h.t; });
    var drawn = pick(order, hand.length < TOPUP ? DRAW - hand.length : 0, base, things) || [];
    drawn.sort(function (a, b) { return a - b; });
    var shown = hand.map(function (h) { return { src: 'note', i: h.i, slug: h.slug }; })
      .concat(drawn.map(function (j) { return { src: 'table', i: j, slug: slugs[j] }; }));
    function usable(s) {
      var j = s ? slugs.indexOf(s) : -1;
      return j >= 0 && order.indexOf(j) >= 0 && !shown.some(function (e) { return e.slug === s; }) ? j : -1;
    }
    var swaps = isObj(o.swaps) ? o.swaps : {};
    shown.forEach(function (e, k) {
      var j = has(swaps, e.slug) ? usable(str(swaps[e.slug])) : -1;
      if (j >= 0) shown[k] = { src: 'table', i: j, slug: slugs[j] };
    });
    listOf(o.extra).forEach(function (s) {
      var j = usable(str(s));
      if (j >= 0) shown.push({ src: 'table', i: j, slug: slugs[j] });
    });
    var says = isObj(table) ? listOf(table.say) : [], r = rng(seedKey, 'say', rr), say = says.length ? Math.floor(r() * says.length) : null;
    if (typeof o.say === 'number' && o.say % 1 === 0 && o.say >= 0 && o.say < says.length && o.say <= SAY_MAX) say = o.say;
    return { things: things, slugs: slugs, hand: hand, order: order, shown: shown, say: say, swaps: swaps };
  }
  function thingAt(w, e) {
    if (e.src === 'table') return w.things[e.i];
    for (var k = 0; k < w.hand.length; k++) if (w.hand[k].i === e.i) return w.hand[k].t;
    return null;
  }

  function roll(table, seedKey, opts) {
    var t = isObj(table) ? table : null, w = work(t, seedKey, opts);
    return {
      table: !!t,
      say: w.say,
      things: w.shown.filter(function (e) { return e.src === 'table'; }).map(function (e) { return e.i; }),
      shown: w.shown.map(function (e) { return { src: e.src, i: e.i, slug: e.slug }; }),
      people: t ? peopleOf(t, seedKey) : []
    };
  }

  function another(table, seedKey, opts) {
    if (!isObj(table)) return null;
    var w = work(table, seedKey, opts), gone = Object.keys(w.swaps);
    var cur = w.shown.map(function (e) { return thingAt(w, e); });
    var shownSlugs = w.shown.map(function (e) { return e.slug; });
    var j = first(w.order.filter(function (x) { return shownSlugs.indexOf(w.slugs[x]) < 0 && gone.indexOf(w.slugs[x]) < 0; }), cur, w.things);
    return j === null ? null : w.slugs[j];
  }

  function swap(table, seedKey, opts, i) {
    if (!isObj(table) || typeof i !== 'number') return null;
    var w = work(table, seedKey, opts), e = w.shown[i];
    if (!e) return null;
    var rest = w.shown.filter(function (x, k) { return k !== i; }).map(function (x) { return thingAt(w, x); });
    var shownSlugs = w.shown.map(function (x) { return x.slug; });
    var n = w.order.length, at = e.src === 'table' ? w.order.indexOf(e.i) : -1, cands = [], k, j;
    for (k = 1; k <= n; k++) {
      j = w.order[(at + k + n) % n];
      if (shownSlugs.indexOf(w.slugs[j]) < 0 && cands.indexOf(j) < 0) cands.push(j);
    }
    var to = first(cands, rest, w.things);
    return to === null ? null : { slug: e.slug, to: w.slugs[to] };
  }

  function thingsOf(draw, table, hand) {
    var things = tableThings(table), h = listOf(hand);
    return listOf(draw && draw.shown).map(function (e) { return copy(e.src === 'note' ? h[e.i] : things[e.i]); }).filter(isObj);
  }

  /* "A tall cupboard" -> "a tall cupboard": a leading article goes to lower case, nothing else is touched */
  function spoken(name) {
    var s = str(name).trim(), m = /^(A|An|The|Some)(\s)/.exec(s);
    return m ? m[1].toLowerCase() + s.slice(m[1].length) : s;
  }
  function there(names) {
    var n = listOf(names).map(spoken).filter(Boolean);
    if (!n.length) return '';
    return "There's " + (n.length === 1 ? n[0] : n.slice(0, -1).join(', ') + ' and ' + n[n.length - 1]) + '.';
  }

  function rollKeyOf(r) { return isObj(r) ? (r.auth ? 'a:' + str(r.auth) : r.seed) : undefined; }
  function site(r, T, opts) {
    var o = isObj(opts) ? opts : {}, rk = rollKeyOf(r), S = State(), Tb = Tables();
    if (rk === undefined || rk === null || rk === '' || !S || !Tb) return null;
    var rooms = listOf(r.rooms), names = rooms.map(function (x) { return isObj(x) ? str(x.name) : ''; });
    var keys = S.roomKeys(names), out = { rollKey: rk, order: [], rooms: {} };
    names.forEach(function (name, n) {
      var rkey = keys[n];
      if (!rkey || has(out.rooms, rkey)) return;
      var st = typeof o.state === 'function' ? o.state(rk, rkey) : null;
      var hand = typeof o.hand === 'function' ? o.hand(copy(rooms[n]), rkey) : null;
      var ov = isObj(st) ? { say: st.say, rr: st.rr, extra: st.extra, swaps: st.swaps } : {};
      ov.hand = listOf(hand);
      out.order.push(rkey);
      out.rooms[rkey] = { name: name, roomKey: rkey, draw: roll(Tb.get(name, T), key(rk, rkey), ov) };
    });
    return out;
  }

  return { key: key, roll: roll, another: another, swap: swap, thingsOf: thingsOf, there: there, site: site, rng: rng,
    DRAW: DRAW, MIX: MIX, SAY_MAX: SAY_MAX };
});
