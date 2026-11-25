/* gm/room-tables.js: the pack's `rooms` part: get(name, T), create(T), validate(T) and check(T) (RK12 of the room key build; setting room.tables, bundle room-tables).

   Plain script, UMD: window.B68GmRoomTables in the browser, module.exports under Node (scripts/lib/rooms-export.mjs require()s this same file, so the exporter and
   the page apply ONE set of rules). ES5. Pure: no DOM, no storage, no network, no module state. GM only: the part is served by /api/gm/pack alone (GM only), and no phone,
   the display or the campaign document ever carries it. room-notes.js (normRoom) and room-things.js (the limits, the tags, slug) are read when called, never at load.

   The part is { v: 1, T } and T is { rooms, roles, aliases }:
     rooms    { <normRoom>: { name, themes[], band, say[3], people[{ role, w }], things[10] } }
              thing = { name, line, look, roll, danger, states[], tags[] }: the shape room-things.js's clean() gives, without its slug
     roles    { <role>: { lines[3], looks[2], pose, face } }
     aliases  { <normRoom>: <normRoom> }  a name that is not a room's own key, and the room it means

   get(name, T) -> room | null     the room (a copy: the caller may keep it) whose key, or whose alias, is normRoom(name); null when the table has none.
                                   The caller says "No table for <room>" (ruling 6): there is NO fallback to a theme's items, here or anywhere.
   keyOf(name, T) -> key | null    the key get() found
   role(id, T) -> role | null      a role's lines, looks, pose and face (a copy)
   create(T) -> { get, keyOf, role, keys, check }   the same, with T held
   validate(T, opts) -> { errors[], warnings[], problems[{ room, level, msg }] }
       Fails on: a room with other than 10 things or 3 says; a field over its limit; an unknown tag or role; fewer than 5 tags across a room's things; more than 2 weapons;
       fewer than 2 clues; no escape and no cover; a duplicate thing name in a room (by slug: "A broom" and "The broom" are one thing to roomstate).
       opts.roles: the role ids the figure kit knows (an unknown role fails; without it only a role with no entry in T.roles fails).
       opts.knownRoom(name) -> bool: a room name the map kit does not know is a warning.
   check(T) -> [string]            validate(T).errors, one short line each (the CHECKED loop in gm-page.js shows them as "rooms: ..."); [] while room-notes.js
                                   or room-things.js is not loaded (it says nothing, as the other modules do)
   LIMITS, BANDS */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmRoomTables = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var BANDS = ['public', 'working', 'controlled', 'secure'];
  var LIMITS = { say: 300, says: 3, things: 10, people: 5, minTags: 5, maxWeapons: 2, minClues: 2, roleLine: 120, roleLines: 3, roleLook: 80, roleLooks: 2, themes: 8 };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function own(o, k) { return isObj(o) && Object.prototype.hasOwnProperty.call(o, k); }
  function listOf(v) { return Array.isArray(v) ? v : []; }
  function copy(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  /* the modules this one reads, when called */
  function mod(name, file) {
    if (root && root[name]) return root[name];
    if (typeof require === 'function') { try { return require(file); } catch (e) { /* not under Node */ } }
    return null;
  }
  function Rooms() { return mod('B68GmRooms', './room-notes.js'); }
  function Things() { return mod('B68GmRoomThings', './room-things.js'); }
  function normRoom(s) { var R = Rooms(); return R && typeof R.normRoom === 'function' ? R.normRoom(s) : ''; }
  function tableOf(T) { return isObj(T) ? T : {}; }

  /* ---------- reading ---------- */
  function keyOf(name, T) {
    var t = tableOf(T), k = normRoom(name);
    if (!k) return null;
    if (own(t.rooms, k)) return k;
    if (own(t.aliases, k) && own(t.rooms, str(t.aliases[k]))) return str(t.aliases[k]);
    return null;
  }
  function get(name, T) {
    var k = keyOf(name, T);
    return k === null ? null : copy(tableOf(T).rooms[k]);
  }
  function role(id, T) {
    var t = tableOf(T), k = str(id).trim();
    return k && own(t.roles, k) ? copy(t.roles[k]) : null;
  }

  /* ---------- the rules ---------- */
  function checkThing(t, i, L, TAGS, push) {
    var w = 'thing ' + (i + 1) + (isObj(t) && str(t.name) ? ' (' + str(t.name) + ')' : '');
    if (!isObj(t)) { push(w + ' is not an object'); return; }
    if (!str(t.name).trim()) push(w + ' has no name');
    ['name', 'line', 'look', 'roll', 'danger'].forEach(function (f) {
      if (t[f] != null && typeof t[f] !== 'string') push(w + ': ' + f + ' is not text');
      else if (str(t[f]).length > L[f]) push(w + ': ' + f + ' is ' + str(t[f]).length + ' characters (at most ' + L[f] + ')');
    });
    if (!str(t.look).trim()) push(w + ' has no closer look');
    var sts = listOf(t.states), tgs = listOf(t.tags);
    if (t.states != null && !Array.isArray(t.states)) push(w + ': states is not a list');
    if (t.tags != null && !Array.isArray(t.tags)) push(w + ': tags is not a list');
    if (sts.length && (sts.length < 2 || sts.length > L.states)) push(w + ': ' + sts.length + ' states (2 to ' + L.states + ', or none)');
    sts.forEach(function (s) { if (!str(s).trim() || str(s).length > L.state) push(w + ': a state is empty or over ' + L.state + ' characters'); });
    if (!tgs.length || tgs.length > L.tags) push(w + ': ' + tgs.length + ' tags (1 to ' + L.tags + ')');
    tgs.forEach(function (g) { if (TAGS.indexOf(g) < 0) push(w + ': unknown tag "' + str(g) + '"'); });
  }

  function checkRoom(key, r, ctx, push) {
    var Th = ctx.Things, L = Th.LIMITS, TAGS = Th.TAGS;
    if (!isObj(r)) { push('is not an object'); return; }
    if (!str(r.name).trim()) push('has no name');
    else if (normRoom(r.name) !== key) push('its key "' + key + '" is not normRoom of its name');
    if (BANDS.indexOf(r.band) < 0) push('band "' + str(r.band) + '" is not one of ' + BANDS.join(', '));
    if (!Array.isArray(r.themes) || r.themes.length > LIMITS.themes || !r.themes.every(function (x) { return typeof x === 'string' && x.trim(); })) push('themes is not a short list of names');
    var says = listOf(r.say);
    if (!Array.isArray(r.say) || says.length !== LIMITS.says) push(says.length + ' say lines (exactly ' + LIMITS.says + ')');
    says.forEach(function (s, i) {
      if (typeof s !== 'string' || !s.trim()) push('say ' + (i + 1) + ' is empty');
      else if (s.length > LIMITS.say) push('say ' + (i + 1) + ' is ' + s.length + ' characters (at most ' + LIMITS.say + ')');
    });
    var people = listOf(r.people);
    if (!Array.isArray(r.people) || !people.length || people.length > LIMITS.people) push(people.length + ' people entries (1 to ' + LIMITS.people + ')');
    people.forEach(function (p) {
      if (!isObj(p) || typeof p.role !== 'string' || !p.role) { push('a people entry has no role'); return; }
      if (!(typeof p.w === 'number' && isFinite(p.w) && p.w >= 1 && Math.floor(p.w) === p.w)) push('role ' + p.role + ' has no whole weight of 1 or more');
      if (p.role === 'nobody') return;
      if (ctx.roles && ctx.roles.indexOf(p.role) < 0) push('unknown role "' + p.role + '"');
      else if (!own(ctx.T.roles, p.role)) push('role "' + p.role + '" has no entry in the roles');
    });
    var things = listOf(r.things);
    if (!Array.isArray(r.things) || things.length !== LIMITS.things) push(things.length + ' things (exactly ' + LIMITS.things + ')');
    var seen = {}, count = {}, distinct = 0;
    things.forEach(function (t, i) {
      checkThing(t, i, L, TAGS, push);
      if (!isObj(t)) return;
      var sl = Th.slug(str(t.name));
      if (sl) {
        if (own(seen, sl)) push('"' + str(t.name) + '" repeats "' + seen[sl] + '" (the same thing once articles are dropped)');
        else seen[sl] = str(t.name);
      }
      listOf(t.tags).forEach(function (g) {
        if (TAGS.indexOf(g) < 0) return;
        if (!own(count, g)) { count[g] = 0; distinct++; }
        count[g]++;
      });
    });
    if (things.length === LIMITS.things) {
      if (distinct < LIMITS.minTags) push('only ' + distinct + ' different tags across its things (at least ' + LIMITS.minTags + ')');
      if ((count.clue || 0) < LIMITS.minClues) push((count.clue || 0) + ' clues (at least ' + LIMITS.minClues + ')');
      if (!(count.escape || count.cover)) push('no escape and no cover');
      if ((count.weapon || 0) > LIMITS.maxWeapons) push(count.weapon + ' weapons (at most ' + LIMITS.maxWeapons + ')');
    }
  }

  function checkRole(o, push) {
    if (!isObj(o)) { push('is not an object'); return; }
    var lines = listOf(o.lines), looks = listOf(o.looks);
    if (!Array.isArray(o.lines) || lines.length !== LIMITS.roleLines) push(lines.length + ' lines (exactly ' + LIMITS.roleLines + ')');
    lines.forEach(function (s, i) { if (typeof s !== 'string' || !s.trim() || s.length > LIMITS.roleLine) push('line ' + (i + 1) + ' is empty or over ' + LIMITS.roleLine + ' characters'); });
    if (!Array.isArray(o.looks) || looks.length !== LIMITS.roleLooks) push(looks.length + ' looks (exactly ' + LIMITS.roleLooks + ')');
    looks.forEach(function (s, i) { if (typeof s !== 'string' || !s.trim() || s.length > LIMITS.roleLook) push('look ' + (i + 1) + ' is empty or over ' + LIMITS.roleLook + ' characters'); });
    if (typeof o.pose !== 'string' || !o.pose.trim()) push('has no pose');
    if (typeof o.face !== 'string' || !o.face.trim()) push('has no face');
  }

  function finish(problems) {
    var errors = [], warnings = [];
    problems.forEach(function (p) { (p.level === 'error' ? errors : warnings).push((p.room ? p.room + ': ' : '') + p.msg); });
    return { errors: errors, warnings: warnings, problems: problems };
  }

  function validate(T, opts) {
    var o = isObj(opts) ? opts : {}, problems = [], Th = Things(), R = Rooms();
    function add(level, room, msg) { problems.push({ room: room, level: level, msg: msg }); }
    if (!Th || !R) return finish(problems);
    if (!isObj(T) || !isObj(T.rooms) || !isObj(T.roles) || !isObj(T.aliases)) {
      add('error', '', 'the part needs T.rooms, T.roles and T.aliases (objects)');
      return finish(problems);
    }
    var ctx = { Things: Th, roles: Array.isArray(o.roles) ? o.roles : null, T: T };
    Object.keys(T.rooms).forEach(function (key) {
      var r = T.rooms[key], label = isObj(r) && str(r.name) ? str(r.name) : key;
      checkRoom(key, r, ctx, function (msg) { add('error', label, msg); });
      if (typeof o.knownRoom === 'function' && isObj(r) && str(r.name)) {
        var known = true;
        try { known = !!o.knownRoom(r.name); } catch (e) { known = true; }
        if (!known) add('warning', label, 'the map kit does not know this room name');
      }
    });
    Object.keys(T.roles).forEach(function (id) {
      checkRole(T.roles[id], function (msg) { add('error', 'role ' + id, msg); });
      if (ctx.roles && ctx.roles.indexOf(id) < 0) add('error', 'role ' + id, 'not a role the figure kit knows');
    });
    Object.keys(T.aliases).forEach(function (a) {
      var to = T.aliases[a];
      if (own(T.rooms, a)) add('error', 'alias ' + a, 'is a room of its own: an alias may not shadow a room');
      else if (typeof to !== 'string' || !own(T.rooms, to)) add('error', 'alias ' + a, 'points at "' + str(to) + '", which is not a room');
      else if (normRoom(a) !== a) add('error', 'alias ' + a, 'is not normRoom of itself');
    });
    return finish(problems);
  }

  function check(T) {
    try { return validate(T).errors; } catch (e) { return []; }
  }

  function create(T) {
    return {
      get: function (name) { return get(name, T); },
      keyOf: function (name) { return keyOf(name, T); },
      role: function (id) { return role(id, T); },
      keys: function () { return isObj(tableOf(T).rooms) ? Object.keys(T.rooms) : []; },
      check: function () { return check(T); }
    };
  }

  return { create: create, get: get, keyOf: keyOf, role: role, validate: validate, check: check, LIMITS: LIMITS, BANDS: BANDS };
});
