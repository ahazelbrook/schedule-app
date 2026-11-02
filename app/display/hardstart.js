/* B68HardStart: the hard start on the table display (suite ticket 1.2, switch spine.start). A cold open for the night that runs itself.

   It is drawn from the lasting layers of the show contract (app/display/layers.js), so the server, the contract and the ambient files are untouched:
     scene.mode  'start'                       the hard start is up (absent: nothing here draws)
     data.countdown { to, label? }              the station clock counts down to `to` (the iPad's own clock: layers.message() has already taken the skew off)
     data.credits   [{ name, role }]            the opening credits (revealed NPCs only: the server joins and drops hidden ones)
     data.previously [{ name, role }]           "Previously on": the first three, as faces with BLANK name plates
     band.faces     [{ name, role }]            the faces whose plates are shown: one tap by the GM reveals one

   The phases follow from the clock alone, so a reloaded iPad lands in the right one and two iPads agree:
     card        before `to`: the test card with a station clock counting down
     fuse        from `to`, for FUSE_MS (4 seconds at most): a fuse burns across the frame
     credits     the credits roll for creditsMs(n)  (skipped when there are none)
     previously  three faces, plates blank until revealed; stays until the GM ends the hard start
     cold        nothing drawn: the cold open follows (no scoring here)
   GO is the GM laying data.countdown.to = now, so "at zero" and "on GO" are the same path.

   Pure parts (phaseAt, creditsMs, clockText, plates) need no DOM and are also exported for node. attach(container, { layers, now }) draws; it does nothing
   (and keeps nothing on the page) until the layers say scene.mode is start. Every string reaches the page by textContent. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68HardStart = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var FUSE_MS = 3600, CREDITS_MIN = 3000, CREDITS_MAX = 20000, CREDIT_ROW_MS = 1100, FACES = 3;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function creditsMs(n) { n = Math.max(0, Math.floor(Number(n) || 0)); return n ? Math.min(CREDITS_MAX, Math.max(CREDITS_MIN, 2500 + n * CREDIT_ROW_MS)) : 0; }

  /* phaseAt(st, t) -> { phase, left?, p?, e? }. st: B68Layers.clean's shape, with countdown.to already in the iPad's clock. */
  function phaseAt(st, t) {
    if (!isObj(st) || st.mode !== 'start') return { phase: null };
    var cd = isObj(st.countdown) && typeof st.countdown.to === 'number' ? st.countdown : null;
    if (!cd) return { phase: 'card', left: null };
    var left = cd.to - t;
    if (left > 0) return { phase: 'card', left: left };
    var e = -left;
    if (e < FUSE_MS) return { phase: 'fuse', p: e / FUSE_MS };
    e -= FUSE_MS;
    var cm = creditsMs(list(st.credits).length);
    if (e < cm) return { phase: 'credits', p: e / cm, ms: cm };
    e -= cm;
    return list(st.previously).length ? { phase: 'previously', e: e } : { phase: 'cold' };
  }
  /* "4:07", "0:09", "1:02:03" (counts up to the whole second, so it reads 0:01 until the last moment) */
  function clockText(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    function two(n) { return (n < 10 ? '0' : '') + n; }
    return h ? h + ':' + two(m) + ':' + two(r) : m + ':' + two(r);
  }
  /* the three plates: { name, role, revealed }. A plate is revealed when band.faces holds a face with the same name and role. */
  function plates(st) {
    var shown = list(st && st.faces);
    return list(st && st.previously).slice(0, FACES).map(function (p) {
      var name = isObj(p) && typeof p.name === 'string' ? p.name : '', role = isObj(p) && typeof p.role === 'string' ? p.role : '';
      var rv = shown.some(function (f) { return isObj(f) && f.name === name && (f.role || '') === role; });
      return { name: name, role: role, revealed: rv };
    });
  }

  function attach(container, opts) {
    var doc = container.ownerDocument || root.document, L = opts && opts.layers, now = opts && typeof opts.now === 'function' ? opts.now : Date.now;
    var node = null, key = '', clockEl = null, dead = false, timer = null;

    function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null && text !== '') e.textContent = text; return e; }
    function silhouette() {
      var NS = 'http://www.w3.org/2000/svg', s = doc.createElementNS(NS, 'svg');
      s.setAttribute('viewBox', '0 0 100 120'); s.setAttribute('class', 'dp-hs-sil'); s.setAttribute('aria-hidden', 'true');
      var h = doc.createElementNS(NS, 'circle'); h.setAttribute('cx', '50'); h.setAttribute('cy', '42'); h.setAttribute('r', '24'); s.appendChild(h);
      var b = doc.createElementNS(NS, 'path'); b.setAttribute('d', 'M6 120 C6 84 28 72 50 72 C72 72 94 84 94 120 Z'); s.appendChild(b);
      return s;
    }
    function build(ph, st) {
      var n = el('div', 'dp-hs dp-hs-' + ph.phase); n.setAttribute('data-hs', ph.phase); n.setAttribute('aria-hidden', 'true'); clockEl = null;
      if (ph.phase === 'card') {
        var plate = el('div', 'dp-hs-plate');
        plate.appendChild(el('p', 'dp-hs-kicker', 'Please stand by'));
        if (ph.left !== null) { clockEl = el('p', 'dp-hs-clock', clockText(ph.left)); plate.appendChild(clockEl); }
        plate.appendChild(el('p', 'dp-hs-label', (isObj(st.countdown) && st.countdown.label) || 'Station clock'));
        n.appendChild(plate);
      } else if (ph.phase === 'fuse') {
        var tr = el('div', 'dp-hs-track'), burn = el('div', 'dp-hs-burn'); burn.style.animationDuration = FUSE_MS + 'ms';
        burn.style.animationDelay = '-' + Math.round(ph.p * FUSE_MS) + 'ms';
        tr.appendChild(burn); tr.appendChild(el('span', 'dp-hs-spark')); n.appendChild(tr);
      } else if (ph.phase === 'credits') {
        var roll = el('div', 'dp-hs-roll'); roll.style.animationDuration = ph.ms + 'ms'; roll.style.animationDelay = '-' + Math.round(ph.p * ph.ms) + 'ms';
        roll.appendChild(el('p', 'dp-hs-kicker', 'Starring'));
        list(st.credits).forEach(function (c) {
          if (!isObj(c) || !c.name) return;
          var row = el('div', 'dp-hs-credit'); row.appendChild(el('span', 'dp-hs-cname', c.name)); if (c.role) row.appendChild(el('span', 'dp-hs-crole', c.role)); roll.appendChild(row);
        });
        n.appendChild(roll);
      } else if (ph.phase === 'previously') {
        n.appendChild(el('p', 'dp-hs-kicker', 'Previously on'));
        var row3 = el('div', 'dp-hs-faces');
        plates(st).forEach(function (p) {
          var f = el('div', 'dp-hs-face' + (p.revealed ? ' dp-hs-revealed' : '')); f.appendChild(silhouette());
          var pl = el('div', 'dp-hs-name');
          if (p.revealed) { pl.appendChild(el('span', 'dp-hs-pname', p.name)); if (p.role) pl.appendChild(el('span', 'dp-hs-prole', p.role)); }
          f.appendChild(pl); row3.appendChild(f);
        });
        n.appendChild(row3);
      }
      return n;
    }
    /* what the node shows: one key per phase (and, in "previously", per set of revealed plates) so it is rebuilt only when it changes */
    function keyOf(ph, st) { return ph.phase + (ph.phase === 'previously' ? ':' + plates(st).map(function (p) { return p.revealed ? p.name + '|' + p.role : '-'; }).join(',') : ph.phase === 'card' ? ':' + (ph.left === null) : ''); }
    function drop() { if (node && node.parentNode) node.parentNode.removeChild(node); node = null; key = ''; clockEl = null; }
    function update() {
      if (dead || !L) return;
      var st = L.state(), m = L.message(), t = now();
      var withClock = Object.assign({}, st, { countdown: m && m.countdown ? m.countdown : st.countdown });
      var ph = phaseAt(withClock, t);
      if (!ph.phase || ph.phase === 'cold') { drop(); return; }
      var k = keyOf(ph, withClock);
      if (k !== key || !node) { drop(); node = build(ph, withClock); key = k; container.appendChild(node); }
      if (clockEl && ph.left !== null) clockEl.textContent = clockText(ph.left);
    }
    timer = root.setInterval ? root.setInterval(update, 250) : null;
    return {
      apply: update, update: update, phase: function () { var st = L.state(), m = L.message(); return phaseAt(Object.assign({}, st, { countdown: m && m.countdown ? m.countdown : st.countdown }), now()); },
      destroy: function () { dead = true; if (timer !== null && root.clearInterval) root.clearInterval(timer); drop(); }
    };
  }

  return { attach: attach, phaseAt: phaseAt, creditsMs: creditsMs, clockText: clockText, plates: plates, FUSE_MS: FUSE_MS, FACES: FACES };
});
