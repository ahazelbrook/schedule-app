/* gm/room-people.js: quick-draw people and their figure (RK17 of the room key build, with RK18 folded in; setting room.tables, bundle room-tables).

   Plain script, UMD: window.B68GmRoomPeople in the browser, module.exports under Node. ES5. GM page only: nothing here is sent, stored, filed or drawn on the
   iPad or a phone, and a quick card is NOT an NPC (nothing here posts to /api/npcs: Keep, RK19, is what files one). It defines its module when it loads and
   reads the others (B68Figure, B68Ui) only when called.

   A SLOT is { role, seed } from room-roll.js: the slot's seed was drawn on the people stream (the roll's seed, the roomKey and "people"), so a hand-written thing
   never moves a person and Reroll the room never changes one. Everything a card holds is a pure function of the slot, the two tables and `masked`:
     the figure first   B68Figure.extra({ role, seed, masked }): the kit picks the sex from the seed, so the name is drawn to match it, never the other way round
     the name           nameFem or nameMasc, then family, from the npc part's tables (T.nameAmb is not used: the figure is a man or a woman)
     the look           build, hair and standout from the npc tables; what they wear is the role's own look line (the rooms part's roles), so a waiter is in a waiter's clothes
     a manner, a want (goal, then the errand they are on), a tell (T.tell), one line (the role's own lines)
     face and pose      the role's `face` and `pose`, carried for Keep's Tell and Signature (RK19); the card does not show them
   Each field is its own fork of the slot's seed (mulberry32 of FNV-1a of seed|role|field), so one table changing length moves no other field, and no slot reads
   another. The npc generator's gen.roll is not called (it has no role hint and needs a fresh repeat-guard memory). A role the roles part has no entry for, a pack with
   no npc part, or no figure kit gives a plain card, never an error; a role the kit does not know is drawn by the kit as a resident (its own rule).

   API
     card(slot, ctx) -> card | null
       slot = { id?, role, seed }
       ctx  = { npc?: the npc part's T, T?: the rooms part's T (its roles), K?: the figure kit, masked?: bool (the guests wear masks), roomKey?, page?: a host that may give
                npc() , T() and masked(room) , room? }
       card = { id, role, label, seed, sex: 'fem' | 'masc', masked, plain: bool (no roles entry), name, first, family, build, hair, standout, wearing, manner, goal, errand,
                tell, line, face, pose, look (text), want (text), kicker (the line under the name: role, manner, masked), spec (the kit's figure spec, named), known: bool (the kit has the role) }
     portrait(card, ctx) -> svg markup | ''        K.portrait(spec, { lod: 'lo' }), remembered by person, its size stripped as the page does
     html(slots, ctx) -> markup | ''               the Who's-here list of the quick cards (ul.rr-ppl, one li[data-rr-slot][data-role] a person); '' for no slot (the caller's own list says so)
     rng(seed, role, field) -> () -> [0, 1)        a field's stream, for tests   ROLE_MAX   FIELDS */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmRoomPeople = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var FIELDS = ['first', 'family', 'build', 'hair', 'standout', 'manner', 'goal', 'errand', 'tell', 'look', 'line', 'sex'];
  var MEMO_MAX = 120, memo = {}, memoOrder = [];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function has(o, k) { return isObj(o) && Object.prototype.hasOwnProperty.call(o, k); }
  function words(v) { return list(v).filter(function (s) { return typeof s === 'string' && s.trim(); }).map(function (s) { return s.trim(); }); }
  function esc0(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function mod(name, file) {
    if (root && root[name]) return root[name];
    if (file && typeof require === 'function') { try { return require(file); } catch (e) { /* not under Node */ } }
    return null;
  }
  function esc(s) { var U = root && root.B68Ui; return U && typeof U.esc === 'function' ? U.esc(s) : esc0(s); }
  function cap(s) { s = str(s).trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function low(s) { s = str(s).trim(); return s && !/^[A-Z][A-Z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function stop(s) { s = str(s).trim(); return s && !/[.!?…”"]$/.test(s) ? s + '.' : s; }

  /* ---------- the streams: one fork a field ---------- */
  function fnv(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function rng(seed, role, field) { return mulberry32(fnv(str(seed) + '|' + str(role) + '|' + str(field))); }
  function pick(arr, seed, role, field) { return arr.length ? arr[Math.floor(rng(seed, role, field)() * arr.length)] : ''; }

  /* ---------- what a card reads ---------- */
  function hostOf(ctx) { return isObj(ctx) && isObj(ctx.page) ? ctx.page : null; }
  function ask(ctx, k, a) { var h = hostOf(ctx); try { return h && typeof h[k] === 'function' ? h[k](a) : null; } catch (e) { return null; } }
  function npcOf(ctx) { var t = isObj(ctx) && isObj(ctx.npc) ? ctx.npc : ask(ctx, 'npc'); return isObj(t) ? t : null; }
  function rolesOf(ctx) { var t = isObj(ctx) && isObj(ctx.T) ? ctx.T : ask(ctx, 'T'); return isObj(t) && isObj(t.roles) ? t.roles : null; }
  function kitOf(ctx) { var K = isObj(ctx) && has(ctx, 'K') ? ctx.K : mod('B68Figure', '../figures/figure-kit.js'); return K && typeof K.extra === 'function' ? K : null; }      /* ctx.K: null says there is no kit */
  function maskedOf(ctx) { return !!(isObj(ctx) && (ctx.masked === true || (typeof ctx.masked !== 'boolean' && ask(ctx, 'masked', isObj(ctx) ? str(ctx.room) : '') === true))); }
  function slugOf(s) { return str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

  /* the kit's figure for a slot, remembered (the kit's own render checks are the slow part) */
  function remember(key, make) {
    if (has(memo, key)) return memo[key];
    var v = make();
    memo[key] = v; memoOrder.push(key);
    if (memoOrder.length > MEMO_MAX) delete memo[memoOrder.shift()];
    return v;
  }
  function figureOf(K, role, seed, masked) {
    if (!K) return null;
    return remember('f|' + role + '|' + seed + '|' + (masked ? 1 : 0), function () {
      var spec = null;
      try { spec = K.extra({ role: role, seed: seed, masked: masked }); } catch (e) { spec = null; }
      return isObj(spec) ? spec : null;
    });
  }
  function labelOf(K, role) {
    var rows = []; try { rows = K && typeof K.roles === 'function' ? list(K.roles()) : []; } catch (e) { rows = []; }
    for (var i = 0; i < rows.length; i++) if (isObj(rows[i]) && rows[i].id === role) return { label: str(rows[i].label) || cap(role), known: true };
    return { label: cap(role.replace(/[-_]+/g, ' ')), known: false };
  }

  /* ---------- the card ---------- */
  function card(slot, ctx) {
    if (!isObj(slot)) return null;
    var role = str(slot.role).trim(), seed = slot.seed;
    if (!role) return null;
    var N = npcOf(ctx), roles = rolesOf(ctx), entry = roles && has(roles, role) && isObj(roles[role]) ? roles[role] : null;
    var K = kitOf(ctx), masked = maskedOf(ctx), base = figureOf(K, role, seed, masked), lab = labelOf(K, role);
    var sex = base ? (base.figure === 'fem' ? 'fem' : 'masc') : rng(seed, role, 'sex')() < 0.5 ? 'fem' : 'masc';
    var first = N ? pick(words(sex === 'fem' ? N.nameFem : N.nameMasc), seed, role, 'first') : '';
    var family = N ? pick(words(N.family), seed, role, 'family') : '';
    var c = { id: str(slot.id), role: role, label: lab.label, known: lab.known, seed: seed, sex: sex, masked: masked, plain: !entry,
      first: first, family: family, name: [first, family].filter(Boolean).join(' '),
      build: N ? pick(words(N.build), seed, role, 'build') : '', hair: N ? pick(words(N.hair), seed, role, 'hair') : '',
      standout: N ? pick(words(N.standout), seed, role, 'standout') : '', wearing: entry ? pick(words(entry.looks), seed, role, 'look') : '',
      manner: N ? pick(words(N.manner), seed, role, 'manner') : '', goal: N ? pick(words(N.goal), seed, role, 'goal') : '',
      errand: N ? pick(words(N.errand), seed, role, 'errand') : '', tell: N ? pick(words(N.tell), seed, role, 'tell') : '',
      line: entry ? pick(words(entry.lines), seed, role, 'line') : '', face: entry ? str(entry.face).trim() : '', pose: entry ? str(entry.pose).trim() : '' };
    var look = [];
    if (c.build || c.hair) look.push(stop(c.build ? cap(c.build) + (c.hair ? ', with ' + c.hair : '') : 'With ' + c.hair));
    if (c.standout) look.push(stop(cap(c.standout)));
    if (c.wearing) look.push(stop(cap(c.wearing)));
    c.look = look.join(' ');
    c.want = [c.goal ? 'Wants ' + low(c.goal) + '.' : '', c.errand ? 'Right now: ' + low(c.errand) + '.' : ''].filter(Boolean).join(' ');
    c.kicker = [c.name ? c.label : '', c.name ? low(c.manner) : '', c.masked ? 'masked' : ''].filter(Boolean).join(' · ');
    c.spec = base ? JSON.parse(JSON.stringify(base)) : null;
    if (c.spec && c.name) c.spec.name = c.name;
    return c;
  }

  function stripSize(svg) { return str(svg).replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1').replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1'); }
  function portrait(c, ctx) {
    var K = kitOf(ctx);
    if (!isObj(c) || !isObj(c.spec) || !K || typeof K.portrait !== 'function') return '';
    var id = 'rq-' + (slugOf(isObj(ctx) ? ctx.roomKey : '') || 'x') + '-' + (slugOf(c.id) || slugOf(c.seed));
    return remember('p|' + id + '|' + c.role + '|' + c.seed + '|' + (c.masked ? 1 : 0), function () {
      var sp = JSON.parse(JSON.stringify(c.spec)), svg = '';
      sp.id = id;
      try { svg = stripSize(K.portrait(sp, { lod: 'lo' }).svg); } catch (e) { svg = ''; }
      return svg;
    });
  }

  /* ---------- the markup (the Run view's own Who's-here row classes: rv-ppl, rv-p, rv-face, rv-pn, rv-prole; no stylesheet) ---------- */
  function initials(s) { var o = ''; str(s).trim().split(/\s+/).filter(Boolean).slice(0, 2).forEach(function (w) { o += Array.from(w)[0].toUpperCase(); }); return o || '?'; }
  function row(c, ctx) {
    var svg = portrait(c, ctx), who = c.name || c.label;
    function line(k, text, pre) { return text ? '<span class="rv-prole rr-p' + k + '">' + (pre ? '<b>' + esc(pre) + '</b> ' : '') + esc(text) + '</span>' : ''; }
    return '<li class="npc rr-slot rv-p nocast' + (ctx && ctx.kit ? ' krv-p' : '') + '" data-rr-slot="' + esc(c.id) + '" data-role="' + esc(c.role) + '" data-sex="' + c.sex + '"' + (c.masked ? ' data-masked="true"' : '') + '>' +
      '<span class="rv-face" aria-hidden="true">' + (svg || '<span class="rv-ini">' + esc(initials(who)) + '</span>') + '</span>' +
      '<span class="rv-pn"><span><b>' + esc(who) + '</b> <small class="rv-prole rr-ptag">quick</small></span>' +
      line('role', c.kicker) + line('look', c.look) + line('want', c.want) + line('tell', c.tell ? stop(cap(c.tell)) : '', 'Tell:') + (c.line ? '<span class="rv-prole rr-pline">“' + esc(c.line) + '”</span>' : '') + '</span></li>';
  }
  function html(slots, ctx) {
    var rows = list(slots).map(function (s, i) { return isObj(s) ? card(Object.assign ? Object.assign({}, s, { id: str(s.id) || 'p' + (i + 1) }) : s, ctx) : null; }).filter(Boolean);
    if (!rows.length) return '';
    var kit = !!(isObj(ctx) && ctx.kit);
    return '<ul class="rv-ppl rr-ppl' + (kit ? ' krv-ppl' : '') + '">' + rows.map(function (c) { return row(c, ctx); }).join('') + '</ul>';
  }

  return { card: card, portrait: portrait, html: html, rng: rng, FIELDS: FIELDS };
});
