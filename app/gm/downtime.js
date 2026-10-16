/* gm/downtime.js — personal business at the table (the downtime phase), as pure logic (no DOM, no storage, no network).
   One card per activity a PC takes: a scene prompt to frame it, a question for the player, and something to pull on
   later. Indulging a vice gives the scene at the PC's purveyor; an overindulgence adds what it costs (attract trouble,
   brag, lost, tapped: the mechanical line in bold) with a scene prompt under it, and a clock the GM can start.
   Everyone rolls physical dice: the page passes the result in (`res`), this file never rolls a die.

   The tables are not in this file (it names nothing of the setting: checks/runtime/gm-nosecrets.test.mjs): they are
   app/downtime-tables.js (B68DowntimeTables: original writing, public like content.js), which the GM bundle loads
   first. A pack part `downtime` may replace them later: any top-level key of its `T` replaces the table of that name,
   and a vice in `T.vice` replaces that vice's tables one by one (check(T) lists what is missing).

   Every draw comes from one seeded mulberry32 stream in a fixed order, and the repeat guard keeps INDICES (never the
   text), so { seed, mem, ui } redraws the same card and a stored memory stays small. The overindulgence's four
   options are drawn after everything else, whatever `res` and `pick` say, so ticking "Overindulged" or switching the
   option after a roll keeps the scene above it as it was.

   ---------------------------------------------------------------------------------------------------------------
   API
   ---------------------------------------------------------------------------------------------------------------
   const dt = B68GmDowntime.create({ T, pack, places, mem, vices, districts })
       T          the tables (default: window.B68DowntimeTables.T in the browser; required under Node)
       pack       optional: a pack part's tables, laid over T (see above)
       places     optional: { "<a purveyor line as printed>": [host, place] } (default: B68DowntimeTables.PLACES)
       mem        optional repeat-guard memory ({ key: [recent indices] }), kept by the instance between rolls
       vices      optional: B68Content.VICES ([{ name, purveyors: [line] }]): the book's purveyors, for Tapped's new source
       districts  optional: district names for {district} when nothing else gives one (default: T.districts)
   dt.ACTS        [{ id, label, short, res }]  res: 'over' (indulge) | 'band' (1-3 / 4/5 / 6 / crit) | 'attr' | 'rel'
   dt.VICES       the vice names, in the tables' order
   dt.defaults()  { act:'indulge', who:'', vice:'', purveyor:'', district:'', res:'', pick:'', attr:'', contact:'',
                    rel:'', project:'' }
   dt.roll(ui, { seed, mem }) -> { lines, meta, over, seed, replay }
       ui.act      'indulge' | 'recover' | 'project' | 'train' | 'contact' | 'heat' | 'acquire'
       ui.who      the PC's name ('' leaves it out)
       ui.vice     indulge: a vice name ('' = drawn); ui.purveyor the sheet's line ("Pat, bookmaker at the Old Track,
                   Eastside"; '' = a stock host and place for the vice)
       ui.district '' = the purveyor's district, else drawn
       ui.res      indulge: 'over' | '' · recover, project, heat, acquire: '13' | '45' | '6' | 'crit' ('' reads as 4/5,
                   with no ticks) · train: unused
       ui.pick     indulge: 'trouble' | 'brag' | 'lost' | 'tapped' ('' = drawn)
       ui.attr     train: 'Insight' | 'Prowess' | 'Resolve' | 'Playbook' ('' = drawn)
       ui.contact  contact: the sheet's line ("Sam, a nosy neighbour"); ui.rel 'friend' | 'rival' ('' = drawn)
       ui.project  project: the clock's name on the sheet ('' = "the project")
       seed        uint32; omit for a fresh one
       mem         the repeat-guard memory to use and MUTATE (default: the instance's)
       lines   [{ kind:'want', id:'lead', md, small }, ({ kind:'want', id:'over', md, small }), { kind:'grid',
               id:'more', rows:[{ k, md }] }]   md is markdown (bold and italics only), never HTML
       over    indulge only: { pick, shown, options:[{ id, title, mech, md, clock, source }] }  shown: res is 'over'
       meta    { id:'downtime', act, title, sub, chips, text, all, label, actions:[{ label, intent:{ type:'clock',
               name, size } }] }   all: the card as plain lines (Pin / Copy)
       replay  { id:'downtime', seed, mem, ui }   mem is a deep copy BEFORE this roll; dt.replay(replay) redraws it
   dt.mem()       the instance's live repeat-guard memory
   Helpers: B68GmDowntime.seedRng(a) · plain(md) · purveyor(line, districts, places) -> { host, place, district, near }
   B68GmDowntime.check(T, pack) -> [string]   the table keys T (with the pack laid over it) lacks or has empty.
   --------------------------------------------------------------------------------------------------------------- */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.B68GmDowntime = api;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  function seedRng(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var clone = function (o) { return JSON.parse(JSON.stringify(o == null ? {} : o)); };
  var isObj = function (v) { return v !== null && typeof v === 'object' && !Array.isArray(v); };
  var str = function (v) { return typeof v === 'string' ? v : v == null ? '' : String(v); };
  var cap = function (t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; };
  function plain(s) {
    return String(s).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\s+/g, ' ').trim();
  }

  /* the activities, in the order the panel shows them */
  var ACTS = [
    { id: 'indulge', label: 'Indulge vice', short: 'Vice', res: 'over' },
    { id: 'recover', label: 'Recover', short: 'Recover', res: 'band' },
    { id: 'project', label: 'Long-term project', short: 'Project', res: 'band' },
    { id: 'train', label: 'Train', short: 'Train', res: 'attr' },
    { id: 'contact', label: 'Friend or rival', short: 'Contact', res: 'rel' },
    { id: 'heat', label: 'Lay low', short: 'Lay low', res: 'band' },
    { id: 'acquire', label: 'Acquire', short: 'Acquire', res: 'band' }
  ];
  var ACT = {}; ACTS.forEach(function (a) { ACT[a.id] = a; });
  var BANDS = ['13', '45', '6', 'crit'];
  var BAND_LABEL = { '13': '1–3', '45': '4/5', '6': '6', 'crit': 'crit' };
  var TICKS = { '13': 1, '45': 2, '6': 3, 'crit': 5 };   /* the sheet's own: a downtime roll's clock ticks */
  var ATTRS = ['Insight', 'Prowess', 'Resolve', 'Playbook'];
  var KINDS = { friend: ['need', 'offer', 'news'], rival: ['move', 'truce', 'weak'] };
  var VICE_TABLES = ['places', 'hosts', 'lead', 'detail', 'ask', 'hook'];
  var OVER_IDS = ['trouble', 'brag', 'lost', 'tapped'];

  /* a purveyor line -> who you deal with and where. The book's lines come annotated (B68DowntimeTables.PLACES, matched on
     their first two parts, so a line copied without its district still matches); anything else is read as "Name, place,
     district" with the role words taken off ("bookmaker at the Old Track"). */
  var ROLE = /^(?:a |an |the )?(?:[\w'’-]+ )*?(?:bookmaker|librarian|president|dealer|handler|controller|leader|pilot|guide|owner|manager|chef|keeper|host)\s+(?:at|of|in)\s+/i;
  var ROLE_TAIL = /\s+(?:controller|handler|leader|owner|manager|keeper|host)$/i;
  function normName(s) { return str(s).toLowerCase().replace(/[’`]/g, "'").replace(/^the\s+/, '').replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function districtOf(s, districts) {
    var n = normName(s); if (!n) return '';
    for (var i = 0; i < districts.length; i++) if (normName(districts[i]) === n) return districts[i];
    return '';
  }
  /* the annotated lines by their first two parts, and by their first part alone (the first line to claim it keeps it) */
  function placeKey(parts) { return parts.slice(0, 2).map(normName).join(','); }
  function placesIndex(places) {
    var ix = {};
    if (isObj(places)) Object.keys(places).forEach(function (k) {
      var v = places[k], parts = str(k).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      if (!Array.isArray(v) || !v[0] || !v[1] || !parts.length) return;
      ix['2:' + placeKey(parts)] = [str(v[0]), str(v[1])];
      if (!ix['1:' + normName(parts[0])]) ix['1:' + normName(parts[0])] = [str(v[0]), str(v[1])];
    });
    return ix;
  }
  /* "Pat, bookmaker at the Old Track, Eastside" -> { host: 'Pat', place: 'the Old Track', district: 'Eastside' } (when Eastside
     is one of `districts`); `places` is an index from placesIndex() */
  function purveyor(line, districts, places) {
    var out = parsePurveyor(line, districts || [], places || {});
    if (out.near && normName(out.near) === normName(out.place)) out.near = '';
    return out;
  }
  function parsePurveyor(line, districts, ix) {
    var parts = str(line).split(',').map(function (x) { return x.trim(); }).filter(Boolean), out = { host: '', place: '', district: '', near: '' };
    if (!parts.length) return out;
    var known = ix['2:' + placeKey(parts)] || ix['1:' + normName(parts[0])] || null;
    if (parts.length > 1) { var d = districtOf(parts[parts.length - 1], districts); if (d) { out.district = d; parts.pop(); } }
    /* a third part that is not a district is still where it is ("above the city"): shown, never put into a sentence */
    if (!out.district && parts.length > 2) out.near = parts.pop();
    if (known) { out.host = known[0]; out.place = known[1]; return out; }
    if (/^family members?\b/i.test(parts[0])) { out.host = 'your family'; out.place = 'home'; return out; }
    var first = parts[0], at = /^(.+?)\s+at\s+(.+)$/i.exec(first);
    if (/[’']s\b/.test(first) && parts.length === 1) { out.host = first.split(/[’']s\b/)[0].trim(); out.place = first; return out; }
    if (at && parts.length === 1) { out.host = at[1].trim(); out.place = /^the\s/i.test(at[2]) || !/^[A-Z]/.test(at[2]) ? at[2].trim() : 'the ' + at[2].trim(); return out; }
    out.host = first;
    if (parts.length > 1) {
      var p = parts[1].replace(ROLE, '').replace(ROLE_TAIL, '').trim();
      if (p && !/^(?:a|an)\s/i.test(p) && /[A-Z]/.test(p.charAt(0))) out.place = /^the\s/i.test(p) || /[’']s\b/.test(p) ? p : 'the ' + p;
      else if (/^the\s/i.test(p)) out.place = p;
    }
    return out;
  }

  /* ---- the tables a roll reads: T, with a pack part's replacements laid over it ---------------------------------- */
  function merged(T, pack) {
    var out = clone(T);
    if (!isObj(pack)) return out;
    Object.keys(pack).forEach(function (k) {
      if (k === 'vice' && isObj(pack.vice)) {
        if (!isObj(out.vice)) out.vice = {};
        Object.keys(pack.vice).forEach(function (v) {
          if (!isObj(pack.vice[v])) return;
          var cur = isObj(out.vice[v]) ? out.vice[v] : (out.vice[v] = {});
          Object.keys(pack.vice[v]).forEach(function (t) { cur[t] = clone(pack.vice[v][t]); });
        });
      } else out[k] = clone(pack[k]);
    });
    return out;
  }
  function list(a) { return Array.isArray(a) && a.length > 0 && a.every(function (x) { return typeof x === 'string' && x.trim() !== ''; }); }
  /* the keys a roll reads, reported when missing or empty, in T with the pack's replacements laid over it */
  function check(T, pack) {
    if (!isObj(T)) return ['T'];
    if (pack != null && !isObj(pack)) return ['pack'];
    var M = merged(T, pack), miss = [], need = function (k, ok) { if (!ok) miss.push(k); };
    need('districts', list(M.districts));
    need('over', Array.isArray(M.over) && OVER_IDS.every(function (id) { return M.over.some(function (o) { return isObj(o) && o.id === id && !!o.title && !!o.mech; }); }));
    need('vice', isObj(M.vice) && Object.keys(M.vice).length > 0);
    Object.keys(isObj(M.vice) ? M.vice : {}).forEach(function (v) {
      var V = M.vice[v];
      VICE_TABLES.forEach(function (t) { need('vice.' + v + '.' + t, list(V && V[t])); });
      OVER_IDS.forEach(function (o) { need('vice.' + v + '.over.' + o, isObj(V && V.over) && list(V.over[o])); });
    });
    var R = M.recover || {};
    need('recover.healers', list(R.healers)); need('recover.cost', list(R.cost)); need('recover.detail', list(R.detail)); need('recover.ask', list(R.ask));
    BANDS.forEach(function (b) { need('recover.band.' + b, isObj(R.band) && list(R.band[b])); });
    var Pj = M.project || {};
    need('project.who', list(Pj.who)); need('project.ask', list(Pj.ask));
    BANDS.forEach(function (b) { need('project.band.' + b, isObj(Pj.band) && list(Pj.band[b])); });
    var Tr = M.train || {};
    need('train.who', list(Tr.who)); need('train.ask', list(Tr.ask));
    ATTRS.forEach(function (a) { need('train.attr.' + a, isObj(Tr.attr) && list(Tr.attr[a])); });
    var C = M.contact || {};
    need('contact.ask', list(C.ask));
    Object.keys(KINDS).forEach(function (rel) { KINDS[rel].forEach(function (k) { need('contact.' + rel + '.' + k, isObj(C[rel]) && list(C[rel][k])); }); });
    var H = M.heat || {};
    ['lead', 'cover', 'cost', 'ask'].forEach(function (k) { need('heat.' + k, list(H[k])); });
    BANDS.forEach(function (b) { need('heat.band.' + b, isObj(H.band) && typeof H.band[b] === 'string' && !!H.band[b]); });
    var A = M.acquire || {};
    need('acquire.seller', list(A.seller)); need('acquire.ask', list(A.ask));
    BANDS.forEach(function (b) { need('acquire.band.' + b, isObj(A.band) && list(A.band[b])); });
    return miss;
  }

  /* ---- filling a line ------------------------------------------------------------------------------------------- */
  function poss(v) { return /s$/i.test(v) ? v + "'" : v + "'s"; }
  function fill(t, ctx) {
    return str(t).replace(/\{([A-Za-z]+)('s)?\}/g, function (m, k, s) {
      var v = str(ctx[k.toLowerCase()]);
      if (!v) return '';
      if (s) v = poss(v);
      return /^[A-Z]/.test(k) ? cap(v) : v;
    });
  }
  /* "text || Clock name (6)" -> { text, clock: { name, size } | null } */
  function split(line, ctx) {
    var at = str(line).indexOf(' || ');
    var text = at < 0 ? line : line.slice(0, at), c = at < 0 ? '' : line.slice(at + 4).trim(), clock = null;
    if (c) {
      var m = /\((\d+)\)\s*$/.exec(c), size = m ? +m[1] : 4;
      if ([4, 6, 8].indexOf(size) < 0) size = 4;
      var name = fill(c.replace(/\s*\(\d+\)\s*$/, ''), ctx).trim();
      if (name) clock = { name: cap(name).slice(0, 80), size: size };
    }
    return { text: fill(text, ctx).trim(), clock: clock };
  }

  /* ---- the draws --------------------------------------------------------------------------------------------- */
  function drawer(rnd, MEM) {
    return {
      pick: function (a) { return a[Math.floor(rnd() * a.length)]; },
      /* a fresh entry of `a` under the repeat guard `key`: the last half of the list (at most 20) is kept out */
      fresh: function (key, a) {
        var used = Array.isArray(MEM[key]) ? MEM[key] : (MEM[key] = []);
        var pool = []; for (var i = 0; i < a.length; i++) if (used.indexOf(i) < 0) pool.push(i);
        var from = pool.length ? pool : a.map(function (x, j) { return j; });
        var idx = from[Math.floor(rnd() * from.length)];
        var win = Math.max(1, Math.min(20, Math.floor(a.length / 2)));
        used.push(idx); while (used.length > win) used.shift();
        return a[idx];
      }
    };
  }

  /* ---- create() ----------------------------------------------------------------------------------------------- */
  function create(cfg) {
    cfg = cfg || {};
    var book = W && W.B68DowntimeTables, base = cfg.T || (book && book.T);
    if (!isObj(base)) throw new Error('B68GmDowntime.create: the tables are required (app/downtime-tables.js)');
    var miss = check(base, cfg.pack);
    if (miss.length) throw new Error('B68GmDowntime.create: the tables lack ' + miss.slice(0, 5).join(', ') + (miss.length > 5 ? ' and ' + (miss.length - 5) + ' more' : ''));
    var T = merged(base, cfg.pack), ix = placesIndex(cfg.places || (book && book.PLACES));
    var MEM = isObj(cfg.mem) ? cfg.mem : {};
    var districts = list(cfg.districts) ? cfg.districts.slice() : T.districts.slice();
    var allDistricts = districts.concat(T.districts.filter(function (d) { return districts.indexOf(d) < 0; }));
    var VNAMES = Object.keys(T.vice);
    var books = (Array.isArray(cfg.vices) ? cfg.vices : []).filter(function (v) { return isObj(v) && v.name; });
    function viceKey(v) {
      var n = normName(v); if (!n) return '';
      for (var i = 0; i < VNAMES.length; i++) if (normName(VNAMES[i]) === n) return VNAMES[i];
      return '';
    }
    function bookPurveyors(vice) {
      var n = normName(vice), b = books.filter(function (x) { return normName(x.name) === n; })[0];
      return b && Array.isArray(b.purveyors) ? b.purveyors.filter(function (p) { return typeof p === 'string' && p.trim(); }) : [];
    }
    function defaults() { return { act: 'indulge', who: '', vice: '', purveyor: '', district: '', res: '', pick: '', attr: '', contact: '', rel: '', project: '' }; }
    function norm(ui) {
      var u = defaults(), x = isObj(ui) ? ui : {};
      Object.keys(u).forEach(function (k) { u[k] = str(x[k]).trim().slice(0, 200); });
      if (!ACT[u.act]) u.act = 'indulge';
      var r = ACT[u.act].res;
      if (r === 'over') { u.res = u.res === 'over' ? 'over' : ''; if (OVER_IDS.indexOf(u.pick) < 0) u.pick = ''; }
      else if (r === 'band') { if (BANDS.indexOf(u.res) < 0) u.res = ''; u.pick = ''; }
      else { u.res = ''; u.pick = ''; }
      if (ATTRS.indexOf(u.attr) < 0) u.attr = '';
      if (u.rel !== 'friend' && u.rel !== 'rival') u.rel = '';
      u.vice = viceKey(u.vice);   /* a vice the tables do not know reads as none: the roll draws one */
      return u;
    }

    /* ---- the activities ---- */
    function indulge(ui, R) {
      var vice = ui.vice || R.pick(VNAMES), V = T.vice[vice];
      var p = purveyor(ui.purveyor, allDistricts, ix);
      var host = p.host || R.fresh(vice + '.hosts', V.hosts), place = p.place || R.fresh(vice + '.places', V.places);
      var district = p.district || ui.district || R.pick(districts), near = p.district || p.near || district;
      var ctx = { host: host, place: place, district: district };
      var lead = split(R.fresh(vice + '.lead', V.lead), ctx), detail = fill(R.fresh(vice + '.detail', V.detail), ctx);
      var ask = fill(R.fresh(vice + '.ask', V.ask), ctx), hook = split(R.fresh(vice + '.hook', V.hook), ctx);
      /* the four options, always drawn and in this order (see the header) */
      var options = OVER_IDS.map(function (id) {
        var O = T.over.filter(function (o) { return o.id === id; })[0];
        var s = split(R.fresh(vice + '.over.' + id, V.over[id]), ctx), o = { id: id, title: O.title, mech: fill(O.mech, ctx), md: s.text, clock: s.clock, source: '' };
        if (id === 'tapped') {
          var mine = normName(ui.purveyor), others = bookPurveyors(vice).filter(function (x) { return normName(x) !== mine && purveyor(x, allDistricts, ix).host !== host; });
          if (others.length) o.source = R.pick(others);
        }
        return o;
      });
      var drawn = R.pick(OVER_IDS);
      var pick = ui.pick || drawn, shown = ui.res === 'over', opt = options.filter(function (o) { return o.id === pick; })[0];
      var where = '**' + cap(place) + '**' + (host && host !== place ? ' · ' + host : '') + (near ? ' · ' + near : '');
      var lines = [{ kind: 'want', id: 'lead', md: lead.text, small: detail }];
      if (shown) lines.push({ kind: 'want', id: 'over', md: '**Overindulged: ' + opt.title + '.** ' + opt.mech, small: opt.md + (opt.source ? ' *A new source to find: ' + opt.source + '.*' : '') });
      var rows = [{ k: 'Where', md: where }, { k: 'Ask', md: ask }, { k: 'Hook', md: hook.text }];
      lines.push({ kind: 'grid', id: 'more', rows: rows });
      var acts = [];
      if (shown && opt.clock) acts.push(opt.clock);
      if (hook.clock) acts.push(hook.clock);
      var chips = [shown ? 'Overindulged' : 'Indulged', vice];
      return {
        lines: lines, chips: chips, clocks: acts,
        title: (ui.who ? ui.who + ' · ' : '') + 'Indulge vice', sub: vice + ' · ' + cap(host === place ? place : host + ', ' + place) + (near ? ' · ' + near : ''),
        label: (ui.who ? ui.who + ' · ' : '') + vice + (shown ? ' · over: ' + opt.title : ''),
        over: { pick: pick, shown: shown, options: options }
      };
    }
    function band(ui) { return ui.res || '45'; }
    function bandChips(ui, extra) {
      var c = [ui.res ? BAND_LABEL[ui.res] : 'before the dice'];
      if (ui.res && extra) c.push(extra(TICKS[ui.res]));
      return c;
    }
    function recover(ui, R) {
      var X = T.recover, b = band(ui), district = ui.district || R.pick(districts);
      var hl = fill(R.fresh('recover.healers', X.healers), { district: district }), healer = hl.split(' — ')[0].trim();
      var ctx = { healer: healer, district: district };
      var lead = fill(R.fresh('recover.band.' + b, X.band[b]), ctx), detail = fill(R.fresh('recover.detail', X.detail), ctx);
      var cost = fill(R.fresh('recover.cost', X.cost), ctx), ask = fill(R.fresh('recover.ask', X.ask), ctx);
      return {
        lines: [{ kind: 'want', id: 'lead', md: lead, small: detail }, { kind: 'grid', id: 'more', rows: [{ k: 'Healer', md: cap(hl.replace(' — ', ': ')) }, { k: 'They want', md: cap(cost) + '.' }, { k: 'Ask', md: ask }] }],
        chips: bandChips(ui, function (n) { return 'healing +' + n; }), clocks: [],
        title: (ui.who ? ui.who + ' · ' : '') + 'Recover', sub: cap(healer), label: (ui.who ? ui.who + ' · ' : '') + 'Recover' + (ui.res ? ' ' + BAND_LABEL[ui.res] : '')
      };
    }
    function project(ui, R) {
      var X = T.project, b = band(ui), name = ui.project || 'the project';
      var who = R.fresh('project.who', X.who), lead = fill(R.fresh('project.band.' + b, X.band[b]), { project: name }), ask = R.fresh('project.ask', X.ask);
      return {
        lines: [{ kind: 'want', id: 'lead', md: lead, small: '' }, { kind: 'grid', id: 'more', rows: [{ k: 'Who', md: cap(who) }, { k: 'Ask', md: ask }] }],
        chips: bandChips(ui, function (n) { return '+' + n + ' on the clock'; }), clocks: [],
        title: (ui.who ? ui.who + ' · ' : '') + 'Project' + (ui.project ? ': ' + ui.project : ''), sub: ui.project ? 'Long-term project' : 'Long-term project · name it on the sheet',
        label: (ui.who ? ui.who + ' · ' : '') + 'Project' + (ui.res ? ' ' + BAND_LABEL[ui.res] : '')
      };
    }
    function train(ui, R) {
      var X = T.train, attr = ui.attr || R.pick(ATTRS), district = ui.district || R.pick(districts);
      var who = R.fresh('train.who', X.who), ctx = { who: who, district: district };
      var lead = fill(R.fresh('train.attr.' + attr, X.attr[attr]), ctx), ask = fill(R.fresh('train.ask', X.ask), ctx);
      return {
        lines: [{ kind: 'want', id: 'lead', md: lead, small: '' }, { kind: 'grid', id: 'more', rows: [{ k: 'Ask', md: ask }] }],
        chips: [attr, '+1 xp'], clocks: [],
        title: (ui.who ? ui.who + ' · ' : '') + 'Train', sub: 'With ' + who, label: (ui.who ? ui.who + ' · ' : '') + 'Train ' + attr
      };
    }
    function contact(ui, R) {
      var X = T.contact, rel = ui.rel || R.pick(['friend', 'rival']), kind = R.pick(KINDS[rel]);
      var line = ui.contact, name = str(line).split(',')[0].trim(), what = str(line).split(',').slice(1).join(',').trim();
      if (!name) name = rel === 'friend' ? 'an old friend' : 'an old rival';
      var district = ui.district || R.pick(districts), ctx = { contact: name, district: district };
      var lead = split(R.fresh('contact.' + rel + '.' + kind, X[rel][kind]), ctx), ask = fill(R.fresh('contact.ask', X.ask), ctx);
      var rows = [{ k: 'Ask', md: ask }];
      return {
        lines: [{ kind: 'want', id: 'lead', md: lead.text, small: '' }, { kind: 'grid', id: 'more', rows: rows }],
        chips: [rel === 'friend' ? 'Friend' : 'Rival'], clocks: lead.clock ? [lead.clock] : [],
        title: (ui.who ? ui.who + ' · ' : '') + (rel === 'friend' ? 'Friend' : 'Rival') + ': ' + cap(name), sub: what ? cap(what) : (rel === 'friend' ? 'A friend' : 'A rival') + ' calls',
        label: (ui.who ? ui.who + ' · ' : '') + cap(name)
      };
    }
    function heat(ui, R) {
      var X = T.heat, b = band(ui), district = ui.district || R.pick(districts);
      var ctx = { cover: R.fresh('heat.cover', X.cover), district: district };
      var lead = fill(R.fresh('heat.lead', X.lead), ctx), cost = fill(R.fresh('heat.cost', X.cost), ctx), ask = fill(R.fresh('heat.ask', X.ask), ctx);
      return {
        lines: [{ kind: 'want', id: 'lead', md: lead, small: ui.res ? X.band[b] : '' }, { kind: 'grid', id: 'more', rows: [{ k: 'Cost', md: cost }, { k: 'Ask', md: ask }] }],
        chips: bandChips(ui), clocks: [],
        title: (ui.who ? ui.who + ' · ' : '') + 'Lay low', sub: 'Cooling things down', label: (ui.who ? ui.who + ' · ' : '') + 'Lay low' + (ui.res ? ' ' + BAND_LABEL[ui.res] : '')
      };
    }
    function acquire(ui, R) {
      var X = T.acquire, b = band(ui), district = ui.district || R.pick(districts);
      var seller = fill(R.fresh('acquire.seller', X.seller), { district: district });
      var how = R.fresh('acquire.band.' + b, X.band[b]), ask = R.fresh('acquire.ask', X.ask);
      return {
        lines: [{ kind: 'want', id: 'lead', md: 'From ' + seller + '.', small: ui.res ? how : 'Roll, then tap the result for how it goes.' }, { kind: 'grid', id: 'more', rows: [{ k: 'Ask', md: ask }] }],
        chips: bandChips(ui), clocks: [],
        title: (ui.who ? ui.who + ' · ' : '') + 'Acquire', sub: 'Getting hold of something', label: (ui.who ? ui.who + ' · ' : '') + 'Acquire' + (ui.res ? ' ' + BAND_LABEL[ui.res] : '')
      };
    }
    var BUILD = { indulge: indulge, recover: recover, project: project, train: train, contact: contact, heat: heat, acquire: acquire };

    function roll(ui, run) {
      run = run || {};
      ui = norm(ui);
      var seed = run.seed != null ? run.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
      var mem = isObj(run.mem) ? run.mem : MEM;
      var before = clone(mem);
      var c = BUILD[ui.act](ui, drawer(seedRng(seed), mem));
      var actions = c.clocks.map(function (k) { return { label: 'Start a clock: ' + k.name + ' (' + k.size + ')', intent: { type: 'clock', name: k.name, size: k.size } }; });
      var all = [c.title, c.sub, c.chips.join(' · ')];
      c.lines.forEach(function (l) {
        if (l.kind === 'grid') l.rows.forEach(function (r) { all.push(r.k + ': ' + plain(r.md)); });
        else { all.push(plain(l.md)); if (l.small) all.push(plain(l.small)); }
      });
      var meta = { id: 'downtime', act: ui.act, title: c.title, sub: c.sub, chips: c.chips, text: plain(c.lines[0].md), all: all, label: c.label.slice(0, 80), actions: actions };
      var out = { lines: c.lines, meta: meta, seed: seed, replay: { id: 'downtime', seed: seed, mem: before, ui: ui } };
      if (c.over) out.over = c.over;
      return out;
    }
    return {
      ACTS: ACTS.map(function (a) { return { id: a.id, label: a.label, short: a.short, res: a.res }; }),
      VICES: VNAMES.slice(),
      ATTRS: ATTRS.slice(),
      defaults: defaults,
      roll: roll,
      replay: function (r) { return roll(r.ui, { seed: r.seed, mem: clone(r.mem) }); },
      mem: function () { return MEM; }
    };
  }

  return { create: create, check: check, seedRng: seedRng, plain: plain, ID: 'downtime', BANDS: BANDS.slice(), BAND_LABEL: clone(BAND_LABEL), TICKS: clone(TICKS),
    purveyor: function (line, districts, places) { return purveyor(line, districts, placesIndex(places)); } };
});
