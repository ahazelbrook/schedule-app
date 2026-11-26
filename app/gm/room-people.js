/* gm/room-people.js: quick-draw people and their figure (RK17 of the room key build, with RK18 folded in; setting room.tables, bundle room-tables).

   Plain script, UMD: window.B68GmRoomPeople in the browser, module.exports under Node. ES5. GM page only: nothing here is sent, stored, filed or drawn on the
   iPad or a phone, and a quick card is NOT an NPC (nothing here posts to /api/npcs: Keep, RK19, is what files one: room-keep.js draws its button on the
   card, row() asks it). It defines its module when it loads and reads the others (B68Figure, B68Ui, B68GmRoomKeep) only when called.

   A SLOT is { role, seed } from room-roll.js: the slot's seed was drawn on the people stream (the roll's seed, the roomKey and "people"), so a hand-written thing
   never moves a person and Reroll the room never changes one. Everything a card holds is a pure function of the slot, the two tables and `masked`:
     the figure first   B68Figure.extra({ role, seed, masked }): the kit picks the sex from the seed, so the name is drawn to match it, never the other way round
     the name           nameFem or nameMasc, then family, from the npc part's tables (T.nameAmb is not used: the figure is a man or a woman)
     the look           build and standout from the npc tables; hair (colour and style) and any facial hair are READ FROM THE DRAWN FIGURE, so the words always agree with the
                        picture, and a standout that says anything about hair, a beard or glasses the figure lacks is left out of the draw; what they wear is the role's own
                        look line (the rooms part's roles), so a waiter is in a waiter's clothes. A woman never has facial hair (the kit draws none)
     at a ball          only the GUESTS are masked (guest-f, guest-m, noble: ball.js says "the guests wear masks"), never a waiter, guard or cleaner
     in a room          html() / cards() give two people of one role in a room different spoken lines and clothes (the next one of the role's, in order, when an earlier
                        person of the room already has it): deterministic, since a room's people never move
     a manner, a want (goal, then the errand they are on), a tell (T.tell), one line (the role's own lines)
     face and pose      the role's `face` and `pose`, carried for Keep's Tell and Signature (RK19); the card does not show them
   Each field is its own fork of the slot's seed (mulberry32 of FNV-1a of seed|role|field), so one table changing length moves no other field, and no slot reads
   another. The npc generator's gen.roll is not called (it has no role hint and needs a fresh repeat-guard memory). A role the roles part has no entry for, a pack with
   no npc part, or no figure kit gives a plain card, never an error; a role the kit does not know is drawn by the kit as a resident (its own rule).

   API
     card(slot, ctx) -> card | null     ONE person from their slot alone. For a ROOM, Keep (RK19) and anything else that must match what the room shows uses cards(roomSlots)[i], NOT
                                        card(slot): a lone card() gives a second same-role person different text (line, clothes) from what the room shows
       slot = { id?, role, seed }
       ctx  = { npc?: the npc part's T, T?: the rooms part's T (its roles), K?: the figure kit, masked?: bool (the guests wear masks), roomKey?, page?: a host that may give
                npc() , T() and masked(room) , room? }
       card = { id, role, label, seed, sex: 'fem' | 'masc', masked, plain: bool (no roles entry), name, first, family, build, hair, standout, wearing, manner, goal, errand,
                tell, line, face, pose, look (text), want (text), kicker (the line under the name: role, manner, masked), spec (the kit's figure spec, named), known: bool (the kit has the role) }
     portrait(card, ctx) -> svg markup | ''        K.portrait(spec, { lod: 'lo' }), remembered by person, its size stripped as the page does
     items(slots, ctx) -> markup | ''              the li's of html() alone
     cards(slots, ctx) -> [card]                   a room's people together (ids p1, p2 by place), with the same-role line and clothes made different; what html() draws
     html(slots, ctx) -> markup | ''               the Who's-here list of the quick cards (ul.rr-ppl, one li[data-rr-slot][data-role] a person); '' for no slot (the caller's own list says so)
     rng(seed, role, field) -> () -> [0, 1)        a field's stream, for tests   FIELDS   GUESTS (the roles a ball masks)   hairWords(spec)   factsOf(spec) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmRoomPeople = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var FIELDS = ['first', 'family', 'build', 'standout', 'manner', 'goal', 'errand', 'tell', 'look', 'line', 'sex'];
  /* two memos: the figures (small) and the pictures (a lo portrait is about 135 KB of SVG, so 48 of them hold about 6 MB: three sites of 16 people, kept small for a memory-starved PC); each first in, first out */
  var SPEC_MAX = 400, PIC_MAX = 48, specs = {}, specOrder = [], pics = {}, picOrder = [];
  /* a ball masks its guests, never the staff: the roles the kit dresses as a guest (guest-f, guest-m, and the noble it draws as one) */
  var GUESTS = ['guest-f', 'guest-m', 'noble'];

  /* the kit's own hair and facial hair ids, and its colour tokens, in plain words (short neutral labels, no book text) */
  var HAIR_COL = { 'cloth-black': 'black', 'ink-900': 'black', 'cloth-chocolate': 'dark brown', 'cloth-brown': 'brown', 'cloth-tobacco': 'light brown', 'cloth-rust': 'red', 'cloth-ochre': 'blond',
    'cloth-camel': 'sandy', 'cloth-tan': 'sandy', 'ink-300': 'grey', 'ink-150': 'white', 'cloth-ash': 'ash grey' };
  var HAIR_STYLE = { 'bowl-bob': 'in a bowl bob', bob: 'in a bob', flip: 'in a flip', 'mod-mop': 'in a mod mop', pixie: 'in a pixie cut', 'slick-back': 'slicked back', pompadour: 'in a pompadour',
    'long-straight': 'long and straight', ponytail: 'in a ponytail', bun: 'in a bun', short: 'cut short', 'side-part': 'parted at the side', crew: 'in a crew cut', buzz: 'in a buzz cut',
    flattop: 'in a flat-top', receding: 'receding', balding: 'balding', afro: 'in an afro', beehive: 'in a beehive' };
  var FACIAL = { moustache: 'a moustache', pencil: 'a pencil moustache', goatee: 'a goatee', 'beard-short': 'a short beard', 'beard-full': 'a full beard', chops: 'mutton chops', stubble: 'stubble',
    'five-oclock': 'a five o’clock shadow' };
  /* a standout that talks about the head, the hair, a beard or glasses is the figure's business, not the table's: such a line is left out of the draw (glasses stay when the figure wears some) */
  var HEADISH = /\b(bald|balding|shav(?:e|ed|en)|hairs?|haired|beard(?:ed)?|moustache|mustache|whiskers?|stubble|sideburns|chops|goatee|afro|curls?|curly|braids?|plaits?|ponytail|fringe|quiff|wig|bun|bob|crop(?:ped)?|buzz|tonsure|mohican|mohawk|locks|dreadlocks|parting|bangs|head)\b/i;
  var GLASSES = /\b(spectacles?|glasses|monocle|eye ?patch|goggles|lenses|shades|pince-nez)\b/i;

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
  function remember(box, order, max, key, make) {
    if (has(box, key)) return box[key];
    var v = make();
    box[key] = v; order.push(key);
    if (order.length > max) delete box[order.shift()];
    return v;
  }
  function figureOf(K, role, seed, masked) {
    if (!K) return null;
    return remember(specs, specOrder, SPEC_MAX, role + '|' + seed + '|' + (masked ? 1 : 0), function () {
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

  /* ---------- what the figure says (so the words agree with the picture) ---------- */
  function hairWords(spec) {
    var h = isObj(spec) && isObj(spec.hair) ? spec.hair : (isObj(spec) && typeof spec.hair === 'string' ? { style: spec.hair } : null);
    if (!h || !str(h.style)) return '';
    var style = str(h.style);
    if (style === 'bald') return 'a bald head';
    var col = has(HAIR_COL, str(h.color)) ? HAIR_COL[str(h.color)] : '';
    if (h.grey && col && col !== 'grey' && col !== 'white') col = 'greying ' + col;
    var how = has(HAIR_STYLE, style) ? HAIR_STYLE[style] : 'styled ' + style.replace(/-/g, ' ');
    return (col ? col + ' ' : '') + 'hair' + (/^an? |^in /.test(how) ? ' ' : ', ') + how;
  }
  function facialWords(spec) {
    var f = isObj(spec) && isObj(spec.face) && isObj(spec.face.facialHair) ? str(spec.face.facialHair.type) : '';
    return f ? (has(FACIAL, f) ? FACIAL[f] : 'a ' + f.replace(/-/g, ' ')) : '';
  }
  function factsOf(spec) {
    var f = isObj(spec) && isObj(spec.face) ? spec.face : {};
    return { hair: hairWords(spec), facial: facialWords(spec), glasses: !!f.eyewear, masculine: isObj(spec) && spec.figure !== 'fem' };
  }
  /* the standouts the figure does not contradict */
  function standouts(arr, spec) {
    var wearsGlasses = !!(isObj(spec) && isObj(spec.face) && spec.face.eyewear);
    return arr.filter(function (s) { return !HEADISH.test(s) && !(isObj(spec) && !wearsGlasses && GLASSES.test(s)); });
  }
  /* a pick that steps on, in the list's order, past what an earlier person of the room already has */
  function pickAway(arr, seed, role, field, avoid) {
    if (!arr.length) return '';
    var i = Math.floor(rng(seed, role, field)() * arr.length), k;
    for (k = 0; k < arr.length; k++) if (list(avoid).indexOf(arr[(i + k) % arr.length]) < 0) return arr[(i + k) % arr.length];
    return arr[i];
  }

  /* ---------- the card ---------- */
  function card(slot, ctx) {
    if (!isObj(slot)) return null;
    var role = str(slot.role).trim(), seed = slot.seed;
    if (!role) return null;
    var N = npcOf(ctx), roles = rolesOf(ctx), entry = roles && has(roles, role) && isObj(roles[role]) ? roles[role] : null;
    var K = kitOf(ctx), masked = maskedOf(ctx) && GUESTS.indexOf(role.toLowerCase()) >= 0, base = figureOf(K, role, seed, masked), lab = labelOf(K, role);
    var sex = base ? (base.figure === 'fem' ? 'fem' : 'masc') : rng(seed, role, 'sex')() < 0.5 ? 'fem' : 'masc';
    var avoid = isObj(ctx) && isObj(ctx.avoid) ? ctx.avoid : {}, fx = factsOf(base);
    var first = N ? pick(words(sex === 'fem' ? N.nameFem : N.nameMasc), seed, role, 'first') : '';
    var family = N ? pick(words(N.family), seed, role, 'family') : '';
    var c = { id: str(slot.id), role: role, label: lab.label, known: lab.known, seed: seed, sex: sex, masked: masked, plain: !entry,
      first: first, family: family, name: [first, family].filter(Boolean).join(' '),
      build: N ? pick(words(N.build), seed, role, 'build') : '', hair: fx.hair, facial: fx.masculine ? fx.facial : '',
      standout: N ? pick(standouts(words(N.standout), base), seed, role, 'standout') : '', wearing: entry ? pickAway(words(entry.looks), seed, role, 'look', avoid.wearing) : '',
      manner: N ? pick(words(N.manner), seed, role, 'manner') : '', goal: N ? pick(words(N.goal), seed, role, 'goal') : '',
      errand: N ? pick(words(N.errand), seed, role, 'errand') : '', tell: N ? pick(words(N.tell), seed, role, 'tell') : '',
      line: entry ? pickAway(words(entry.lines), seed, role, 'line', avoid.line) : '', face: entry ? str(entry.face).trim() : '', pose: entry ? str(entry.pose).trim() : '' };
    var look = [], bits = [c.hair, c.facial].filter(Boolean).join(' and ');
    if (c.build || bits) look.push(stop(c.build ? cap(c.build) + (bits ? ', with ' + bits : '') : 'With ' + bits));
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
    /* the key holds the name: the picture's <title> is the person's name, so a pack pushed again with other names draws again */
    return remember(pics, picOrder, PIC_MAX, id + '|' + c.role + '|' + c.seed + '|' + (c.masked ? 1 : 0) + '|' + str(c.name), function () {
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
    function line(k, text, pre) { return text ? '<span class="rv-prole rr-p' + k + '">' + (pre ? '<strong>' + esc(pre) + '</strong> ' : '') + esc(text) + '</span>' : ''; }
    return '<li class="npc rr-slot rv-p nocast' + (ctx && ctx.kit ? ' krv-p' : '') + '" data-rr-slot="' + esc(c.id) + '" data-role="' + esc(c.role) + '" data-sex="' + c.sex + '"' + (c.masked ? ' data-masked="true"' : '') + '>' +
      '<span class="rv-face" aria-hidden="true">' + (svg || '<span class="rv-ini">' + esc(initials(who)) + '</span>') + '</span>' +
      '<span class="rv-pn"><span><b>' + esc(who) + '</b> <small class="rv-prole rr-ptag">' + (keptTag(c, ctx) ? 'kept' : 'quick') + '</small></span>' +
      line('role', c.kicker) + line('look', c.look) + line('want', c.want) + line('tell', c.tell ? stop(cap(c.tell)) : '', 'Tell:') + (c.line ? '<span class="rv-prole rr-pline">“' + esc(c.line) + '”</span>' : '') + keepOf(c, ctx) + '</span></li>';
  }
  /* RK19: Keep (gm/room-keep.js), or Kept and Show on iPad, on the card; '' when that file is not there or the card has no writer */
  function keepOf(c, ctx) { var Kp = mod('B68GmRoomKeep', './room-keep.js'); try { return Kp && !Kp.stub && typeof Kp.html === 'function' ? str(Kp.html(c, ctx)) : ''; } catch (e) { return ''; } }
  function keptTag(c, ctx) { var Kp = mod('B68GmRoomKeep', './room-keep.js'); try { return !!(Kp && !Kp.stub && typeof Kp.keptOf === 'function' && Kp.keptOf(ctx, c.id)); } catch (e) { return false; } }      /* a kept person is tagged "kept", not "quick" */
  /* a room's people together: each person's line and clothes steer clear of what an earlier person of the same role in the room already has */
  function cards(slots, ctx) {
    var used = {}, base = isObj(ctx) ? ctx : {};
    return list(slots).map(function (s, i) {
      if (!isObj(s)) return null;
      var role = str(s.role).trim(), u = used[role] = used[role] || { line: [], wearing: [] };
      var c = card(Object.assign({}, s, { id: str(s.id) || 'p' + (i + 1) }), Object.assign({}, base, { avoid: u }));
      if (c) { if (c.line) u.line.push(c.line); if (c.wearing) u.wearing.push(c.wearing); }
      return c;
    }).filter(Boolean);
  }
  /* the list items alone (the rolled card's slotItems, the one place the slots' markup comes from, hands them to the card and to the Blade tap) */
  function items(slots, ctx) { return cards(slots, ctx).map(function (c) { return row(c, ctx); }).join(''); }
  function html(slots, ctx) {
    var h = items(slots, ctx);
    return h ? '<ul class="rv-ppl rr-ppl' + (isObj(ctx) && ctx.kit ? ' krv-ppl' : '') + '">' + h + '</ul>' : '';
  }

  return { card: card, cards: cards, portrait: portrait, items: items, html: html, rng: rng, FIELDS: FIELDS, GUESTS: GUESTS, hairWords: hairWords, factsOf: factsOf };
});
