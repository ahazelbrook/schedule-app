/* gm/glance-crew.js: the crew at a glance (gm.glance, RK20 of the room key build).
   In the gm-glance bundle (app/routes.js), fetched only while its setting is on. READ-ONLY and GM-ONLY: it draws into the GM page's rail (#gm-rail, the drawer's Table tab) and
   nowhere else; it is never named in a phone's or the display's bundle (gm-glance-crew.test.mjs checks that), and it writes nothing (no patch, no save, no request).
   Plain script, UMD: window.B68GmGlanceCrew in the browser, module.exports under Node. ES5, as the files beside it.

   create(host) -> { html(), sig(), model(), sync(root) }
     host: { campaign() -> the campaign document | null, pcs() -> the slim characters (app/boot.js: each has a lazy, non-enumerable `glance` = { play, facts }),
             crews() -> window.B68Crews | null, need(bundleId) -> Promise (B68Load.need), again() -> the rail is drawn again (the crews bundle came in) }
     html()  the panel: <section class="gm-box gl-crew" id="gl-crew" data-sig="...">; one panel carries the crew and every PC.
     sig()   a short hash of what html() would show (a stress tick changes it; nothing else does).
     sync(root)  swaps #gl-crew under root for a fresh one when sig() has moved; true when it swapped.
   Pure builders, for the tests: crewModel(crew, ctx), pcModel(pc), html(model), hash(s).

   What it shows. Per PC: Stress (Drain for a Hull) n/max, harm by level (the player's own words), deadlocked keys (the '68 trauma), xp n/8, stacks.
   The crew: type, preferred operations, upgrades, cohorts, claims, project clocks, Heat, Wanted, Rep, Stacks, Vault. Mechanics are numbers and short labels only. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmGlanceCrew = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HARM = { 4: 'Mortal', 3: 'Critical', 2: 'Major', 1: 'Passing' };
  var MAX_PCS = 8;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function num(v, lo, hi) { v = Math.floor(+v); if (!isFinite(v)) v = 0; return Math.max(lo, Math.min(hi, v)); }
  function esc(s) { return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function cap(s) { s = str(s).trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function hash(s) { var h = 5381, i; s = str(s); for (i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }

  /* ---------- a PC ---------- */
  function pcModel(pc) {
    var g = isObj(pc) && isObj(pc.glance) ? pc.glance : null, f = g && isObj(g.facts) ? g.facts : null, p = g && isObj(g.play) ? g.play : {};
    var m = { id: str(pc && pc.id), name: str(pc && pc.name).trim() || str(pc && pc.alias).trim() || 'Unnamed', playbook: str(pc && pc.playbookName).trim() || cap(str(pc && pc.playbook).replace(/-/g, ' ')),
      fresh: !f || f.fresh === true, stressName: 'Stress', stress: null, stressMax: 9, full: false, harm: [], locks: [], xp: null, xpMax: 8, stacks: 0 };
    if (!f || f.fresh === true) return m;
    m.stressName = str(f.stressName) || 'Stress';
    m.stressMax = num(f.stressMax, 1, 99) || 9;
    if (typeof f.stress === 'number') { m.stress = num(f.stress, 0, 99); m.full = m.stress >= m.stressMax; }
    if (typeof f.xp === 'number') m.xp = num(f.xp, 0, 99);
    m.stacks = num(f.stacks, 0, 999);
    var hull = m.stressName === 'Drain', hm = isObj(p.harm) ? p.harm : {};
    [4, 3, 2, 1].forEach(function (lv) {
      var v = hm['l' + lv];
      (Array.isArray(v) ? v : [v]).forEach(function (t) {
        t = str(t).replace(/\s+/g, ' ').trim();
        if (t && m.harm.length < 8) m.harm.push({ lv: lv, name: lv === 4 && hull ? 'Destroyed' : HARM[lv], text: t.slice(0, 80) });
      });
    });
    (Array.isArray(p.keys) ? p.keys : []).forEach(function (k) {
      if (!isObj(k) || !(k.deadlock || k.glitch) || m.locks.length >= 6) return;
      var nm = str(k.name).replace(/\s+/g, ' ').trim().slice(0, 40) || 'A key';
      if (k.deadlock) { var dir = k.deadlock === 'up' ? 'up' : 'down'; m.locks.push({ kind: 'deadlock', name: nm, dir: dir, word: str(k[dir]).replace(/\s+/g, ' ').trim().slice(0, 80) }); }
      else m.locks.push({ kind: 'glitch', name: nm, dir: '', word: typeof k.glitch === 'string' ? k.glitch.replace(/\s+/g, ' ').trim().slice(0, 80) : '' });
    });
    return m;
  }

  /* ---------- the crew ---------- */
  function recOf(Crews, crew) {
    var id = (str(crew.playbook).trim() || str(crew.type).trim()).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return id && Crews && isObj(Crews.byId) ? Crews.byId[id] || null : null;
  }
  function cellsOf(r) {
    if (!r) return [];
    var sp = r.special || {};
    if (r.claims && Array.isArray(r.claims.cells)) return r.claims.cells;
    if (sp.product && Array.isArray(sp.product.rows)) return [].concat.apply([], sp.product.rows.map(function (x) { return x.cells || []; }));
    if (Array.isArray(sp.circles)) return [].concat.apply([], sp.circles.map(function (x) { return x.cells || []; }));
    return [];
  }
  function upgradesOf(r) { var u = r && r.upgrades || {}; return [].concat(u.crew || [], u.training || [], u.base || [], u.items || [], u.cohorts || []); }
  function group(names) {
    var order = [], n = {};
    names.forEach(function (x) { if (!n[x]) { n[x] = 0; order.push(x); } n[x]++; });
    return order.map(function (x) { return n[x] > 1 ? x + ' ×' + n[x] : x; });
  }
  function claimsOf(crew, r) {
    var c = crew.claims, held = [];
    if (isObj(c)) {
      var cells = cellsOf(r), by = {}; cells.forEach(function (x) { by[x.id] = x; });
      Object.keys(c).forEach(function (id) { if (c[id] === true && !(by[id] && by[id].base)) held.push(by[id] ? str(by[id].name) || 'Claim' : 'Claim'); });
    } else if (Array.isArray(c)) c.forEach(function (x) { if (isObj(x) && x.held !== false && str(x.name).trim()) held.push(str(x.name).trim()); });
    (Array.isArray(crew.legacyClaims) ? crew.legacyClaims : []).forEach(function (x) { if (isObj(x) && x.held && str(x.name).trim()) held.push(str(x.name).trim()); });
    return { n: held.length, names: group(held) };
  }
  function crewModel(crew, ctx) {
    crew = isObj(crew) ? crew : {}; ctx = ctx || {};
    var r = recOf(ctx.Crews, crew), m = { name: str(crew.name).trim(), type: r ? str(r.name) : cap(str(crew.playbook).trim() || str(crew.type).trim()), known: !!r,
      tier: crew.tier == null || crew.tier === '' ? null : num(crew.tier, 0, 9), hold: str(crew.hold).trim(),
      heat: num(crew.heat, 0, 99), wanted: num(crew.wanted, 0, 99), rep: num(crew.rep, 0, 99), stacks: num(crew.stacks, 0, 999), vault: num(crew.vault, 0, 99),
      session: ctx.session == null ? null : num(ctx.session, 0, 9999), ops: [], grounds: { label: '', list: [] }, upgrades: [], cohorts: [], claims: { n: 0, names: [] }, projects: [] };
    if (r && isObj(r.preferred)) {
      m.ops = (Array.isArray(r.preferred.ops) ? r.preferred.ops : []).map(str).filter(Boolean);
      m.grounds.label = str(r.preferred.label).trim();
    }
    m.grounds.list = (Array.isArray(crew.preferred) ? crew.preferred : []).map(function (x) { return str(x).replace(/\s+/g, ' ').trim().slice(0, 60); }).filter(Boolean);
    var up = isObj(crew.upgrades) ? crew.upgrades : {};
    if (r) {
      upgradesOf(r).forEach(function (u) { var n = num(up[u.name], 0, 9); if (n > 0) m.upgrades.push((u.boxes || 1) > 1 ? u.name + ' ' + Math.min(n, u.boxes) + '/' + u.boxes : u.name); });
    } else Object.keys(up).forEach(function (k) { var n = num(up[k], 0, 9); if (n > 0) m.upgrades.push(n > 1 ? k + ' ' + n : k); });
    (Array.isArray(crew.cohorts) ? crew.cohorts : []).forEach(function (c) {
      if (!isObj(c)) return;
      var nm = str(c.name).replace(/\s+/g, ' ').trim().slice(0, 40), ty = str(c.type).replace(/\s+/g, ' ').trim().slice(0, 30), h = str(c.harm);
      if (!nm && !ty) return;
      m.cohorts.push({ name: nm || cap(ty), type: nm ? ty : '', harm: h === 'weak' || h === 'impaired' || h === 'broken' ? h : '', armor: c.armor === true });
    });
    m.claims = claimsOf(crew, r);
    (Array.isArray(ctx.clocks) ? ctx.clocks : []).forEach(function (c) {
      if (isObj(c) && str(c.kind) === 'project' && str(c.name).trim() && m.projects.length < 6) m.projects.push({ name: str(c.name).replace(/\s+/g, ' ').trim().slice(0, 50), size: num(c.size, 1, 12) || 4, filled: num(c.filled, 0, 12), hidden: c.hidden === true });
    });
    return m;
  }

  /* ---------- the markup ---------- */
  function stat(k, v, max) { return '<div class="gm-stat"><dt>' + k + '</dt><dd>' + esc(v) + (max ? '<small>/' + max + '</small>' : '') + '</dd></div>'; }
  function row(label, inner) { return '<div class="gl-crew-row"><dt>' + label + '</dt><dd>' + inner + '</dd></div>'; }
  function none(s) { return '<span class="gm-dim">' + (s || 'none') + '</span>'; }
  function items(list) { return '<span class="gl-crew-list">' + list.map(function (x) { return '<span class="gl-crew-it">' + x + '</span>'; }).join('') + '</span>'; }
  function pips(filled, size) {
    var f = Math.min(filled, size), s = '', i;
    for (i = 0; i < size; i++) s += '<i' + (i < f ? ' class="on"' : '') + '></i>';
    return '<span class="gm-clock" aria-label="' + f + ' of ' + size + '">' + s + '</span>';
  }
  function crewHtml(m) {
    var typeBits = [m.type ? '<b class="gl-crew-type-n">' + esc(m.type) + '</b>' : '<span class="gm-dim">No crew type chosen yet</span>'];
    if (m.tier != null) typeBits.push('Tier ' + m.tier);
    if (m.hold) typeBits.push(esc(m.hold) + ' hold');
    var h = '<h3 class="gm-band">Crew' + (m.name ? ': ' + esc(m.name) : '') + '</h3><p class="gl-crew-type">' + typeBits.join(' · ') + '</p>' +
      '<dl class="gm-stats gl-crew-stats">' + stat('Heat', m.heat, 9) + stat('Wanted', m.wanted, 4) + stat('Rep', m.rep, 12) + stat('Stacks', m.stacks) + stat('Vault', m.vault, 16) + '</dl><dl class="gl-crew-rows">';
    var ops = m.ops.length ? items(m.ops.map(esc)) : '';
    if (m.grounds.list.length) ops += '<span class="gl-crew-grounds">' + esc(m.grounds.label || 'Grounds') + ': ' + m.grounds.list.map(esc).join(' · ') + '</span>';
    h += row('Preferred ops', ops || none(m.known ? 'none set' : 'not known'));
    h += row('Upgrades', m.upgrades.length ? items(m.upgrades.map(esc)) : none());
    h += row('Cohorts', m.cohorts.length ? items(m.cohorts.map(function (c) { return esc(c.name) + (c.type ? ' <small>' + esc(c.type) + '</small>' : '') + (c.harm ? ' <b class="gl-flag">' + c.harm + '</b>' : '') + (c.armor ? ' <small>armor</small>' : ''); })) : none());
    h += row('Claims', m.claims.n ? '<b>' + m.claims.n + ' held</b> ' + items(m.claims.names.map(esc)) : none());
    h += row('Projects', m.projects.length ? '<ul class="gl-crew-proj">' + m.projects.map(function (c) {
      return '<li><span class="gl-crew-pn">' + esc(c.name) + (c.hidden ? ' <small>hidden from players</small>' : '') + '</span>' + pips(c.filled, c.size) + '<span class="gm-clockn">' + Math.min(c.filled, c.size) + '/' + c.size + '</span></li>';
    }).join('') + '</ul>' : none('no project clocks'));
    return h + '</dl>';
  }
  function pcHtml(p) {
    var hot = p.full || p.locks.length > 0 || p.harm.some(function (x) { return x.lv >= 3; });
    var h = '<li class="gl-crew-pc' + (hot ? ' is-hot' : '') + '" data-pc="' + esc(p.id) + '"><div class="gl-pc-head"><b class="gl-pc-name">' + esc(p.name) + '</b>' + (p.playbook ? ' <span class="gl-pc-pb">' + esc(p.playbook) + '</span>' : '') + '</div>';
    if (p.fresh) return h + '<div class="gl-pc-line">' + none('new sheet, nothing filed yet') + '</div></li>';
    h += '<div class="gl-pc-line gl-pc-vitals"><span class="gl-v' + (p.full ? ' is-full' : '') + '"><span class="gl-vk">' + esc(p.stressName) + '</span> <b>' + (p.stress == null ? '—' : p.stress + '/' + p.stressMax) + '</b>' + (p.full ? ' <b class="gl-flag">full</b>' : '') + '</span>' +
      '<span class="gl-v"><span class="gl-vk">XP</span> <b>' + (p.xp == null ? '—' : p.xp + '/' + p.xpMax) + '</b></span>' +
      '<span class="gl-v"><span class="gl-vk">Stacks</span> <b>' + p.stacks + '</b></span>' +
      '<span class="gl-pc-harm">' + (p.harm.length ? p.harm.map(function (x) { return '<span class="gl-h gl-h' + x.lv + '"><b>' + x.lv + ' ' + x.name + '</b> ' + esc(x.text) + '</span>'; }).join('') : none('No harm')) + '</span></div>';
    [['deadlock', 'Deadlocks'], ['glitch', 'Glitches']].forEach(function (g) {
      var l = p.locks.filter(function (x) { return x.kind === g[0]; });
      if (l.length) h += '<div class="gl-pc-line gl-pc-locks"><span class="gl-vk">' + g[1] + '</span> ' + l.map(function (x) { return '<span class="gl-lock">' + esc(x.name) + (x.dir ? ' <b>' + (x.dir === 'up' ? '▲ intensified' : '▼ reversed') + '</b>' : '') + (x.word ? ' ' + esc(x.word) : '') + '</span>'; }).join(' · ') + '</div>';
    });
    return h + '</li>';
  }
  function html(model) {
    var c = model.crew, pcs = model.pcs.slice(0, MAX_PCS), s = hash(JSON.stringify(model));
    return '<section class="gm-box gl-crew" id="gl-crew" data-sig="' + s + '" aria-label="The crew at a glance">' + crewHtml(c) +
      '<h4 class="gl-crew-sub">Scoundrels <small>' + model.pcs.length + '</small></h4>' +
      (pcs.length ? '<ul class="gl-crew-pcs">' + pcs.map(pcHtml).join('') + '</ul>' + (model.pcs.length > pcs.length ? '<p class="gm-dim">+' + (model.pcs.length - pcs.length) + ' more on the Players tab</p>' : '') : '<p class="gm-dim">No characters filed yet.</p>') +
      '<p class="gm-dim">Session ' + (c.session == null ? 0 : c.session) + ' · read-only here; change it on <a href="#t">the table</a>.</p></section>';
  }

  /* ---------- the instance ---------- */
  function create(host) {
    host = host || {};
    var asked = false;
    function model() {
      var camp = host.campaign ? host.campaign() : null, Crews = typeof host.crews === 'function' ? host.crews() : null, pcs = [];
      camp = isObj(camp) ? camp : {};
      if (!Crews && !asked && typeof host.need === 'function') {
        asked = true;
        try { host.need('crews').then(function () { if (typeof host.again === 'function') host.again(); }, function () {}); } catch (e) {}
      }
      try { pcs = typeof host.pcs === 'function' ? host.pcs() : []; } catch (e) { pcs = []; }
      return { crew: crewModel(camp.crew, { Crews: Crews, clocks: camp.clocks, session: isObj(camp.session) ? camp.session.number : null }),
        pcs: (Array.isArray(pcs) ? pcs : []).filter(function (x) { return isObj(x) && str(x.id); }).map(pcModel) };
    }
    return {
      model: model,
      html: function () { return html(model()); },
      sig: function () { return hash(JSON.stringify(model())); },
      sync: function (rootEl) {
        var el = rootEl && rootEl.querySelector ? rootEl.querySelector('#gl-crew') : null; if (!el) return false;
        var m = model(), s = hash(JSON.stringify(m)); if (el.getAttribute('data-sig') === s) return false;
        el.outerHTML = html(m); return true;
      }
    };
  }

  return { create: create, crewModel: crewModel, pcModel: pcModel, html: html, hash: hash };
});
