/* sheet/claims.js — claims and status on the crew sheet (suite ticket 5.5, switch between.claims).

   Window.B68Claims, and module.exports under Node. A lazy bundle (routes.js 'claims'): boot.js fetches it only while the switch is on and calls start() / stop() from
   every campaign arrival; the GM bundle carries it too, because the crew sheet also renders on the GM page, where the switch is read from the GM state document
   (valueOf) rather than from the phone's flags. With the switch off nothing here is called, and the crew sheet's HTML is exactly what it was.

   WHAT IT DOES. Two hooks in app/crewsheet.js, one line each.
     The claim track: above the claims map, one box per claim cell in the playbook's own order. A held cell lights its box. The cells the sheet itself marks as
       turf, as a one-off target, or (for the Utopians) the circles with a printed threshold are drawn larger and carry their name: they are the thresholds, and they
       light when held (or, for a circle, when it has been marked). The count is "held of claimable". No number here comes from a rulebook: every threshold is a
       cell or a circle the playbook data (app/crews.js) already carries. A playbook with no such cell shows the plain track with no marks.
     The faction cards: each faction the crew has dealt with is a business card (name, then a ladder of seven rungs from -3 to +3 with the current rung lit). At -3 the
       card carries a WAR stamp. The rungs are the sheet's existing status chips (act crew.factionstatus), so choosing one writes the same field as before.

   API: start() stop() active(ctx) -> bool   track(cells, circles, opts?) -> html   cards(list, ctx) -> html   styleText()
   pure (Node tests): summarise(cells) -> { held, total, marks: [{ id, name, kind, lit }] }   rung(status) -> 0..6 | -1   isWar(status) -> bool */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68Claims = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var SWITCH = 'between.claims', RUNGS = [-3, -2, -1, 0, 1, 2, 3];
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function rung(status) { return typeof status === 'number' && status >= -3 && status <= 3 && Math.floor(status) === status ? status + 3 : -1; }
  function isWar(status) { return status === -3; }

  /* cells: [{ id, name, base?, special?, oneOff?, turf?, held }]; the base is printed held and is not a claim, so it is left out */
  function summarise(cells) {
    var list = (Array.isArray(cells) ? cells : []).filter(function (c) { return isObj(c) && !c.base; }), marks = [], held = 0;
    list.forEach(function (c) {
      if (c.held === true) held++;
      var kind = c.oneOff ? 'target' : c.turf ? 'turf' : '';
      if (kind) marks.push({ id: String(c.id), name: String(c.name || ''), kind: kind, lit: c.held === true });
    });
    return { held: held, total: list.length, marks: marks };
  }

  /* the track as HTML. cells as summarise(); circles: [{ name, threshold, marked }] (Utopians) */
  function track(cells, circles) {
    var list = (Array.isArray(cells) ? cells : []).filter(function (c) { return isObj(c) && !c.base; }), s = summarise(cells);
    if (!list.length && !(Array.isArray(circles) && circles.length)) return '';
    var h = '<div class="b68-ct" role="group" aria-label="Claim track"><div class="b68-ct-row">';
    list.forEach(function (c) {
      var kind = c.oneOff ? ' b68-ct-target' : c.turf ? ' b68-ct-turf' : '';
      h += '<i class="b68-ct-box' + (c.held === true ? ' on' : '') + kind + '" title="' + esc(c.name) + (c.held === true ? ' (held)' : '') + '"></i>';
    });
    h += '</div><p class="b68-ct-line"><b>' + s.held + '</b> of ' + s.total + ' claims held</p>';
    if (s.marks.length) {
      h += '<ul class="b68-ct-marks">';
      s.marks.forEach(function (m) { h += '<li class="b68-ct-mark ' + m.kind + (m.lit ? ' lit' : '') + '"><span class="b68-ct-lamp"></span>' + esc(m.name) + (m.kind === 'target' ? ' (target)' : ' (turf)') + '</li>'; });
      h += '</ul>';
    }
    (Array.isArray(circles) ? circles : []).forEach(function (c) {
      if (!isObj(c) || !c.threshold) return;
      h += '<ul class="b68-ct-marks"><li class="b68-ct-mark circle' + (c.marked ? ' lit' : '') + '"><span class="b68-ct-lamp"></span>' + esc(c.name) + ': ' + esc(String(c.threshold).replace(/^([^:]+:)\s*/, '$1 ')) + '</li></ul>';
    });
    return h + '</div>';
  }

  /* the faction cards as HTML; ctx is the crew sheet's (input, chip). Each rung is the sheet's own status chip. */
  function cards(list, ctx) {
    var h = '<div class="b68-fc-list">';
    (Array.isArray(list) ? list : []).forEach(function (f, i) {
      var st = isObj(f) ? f.status : 0, war = isWar(st);
      h += '<div class="b68-fc' + (war ? ' war' : '') + '" data-status="' + esc(Number(st)) + '">' +
        '<div class="b68-fc-name">' + ctx.input('crew.factions.' + i + '.name', f.name, 'Faction', { label: 'Faction ' + (i + 1) }) + '<button type="button" class="tp-x" data-act="crew.factionrm" data-i="' + i + '" title="Remove the faction" aria-label="Remove the faction">×</button></div>' +
        '<span class="seg tp-status7 b68-fc-ladder">' + RUNGS.map(function (v) { return ctx.chip(v > 0 ? '+' + v : v < 0 ? '−' + (-v) : '0', 'crew.factionstatus', st === v, ' data-i="' + i + '" data-v="' + v + '"', { cls: v < 0 ? 'neg' : v > 0 ? 'pos' : '' }); }).join('') + '</span>' +
        (war ? '<b class="b68-fc-war" aria-label="At war">WAR</b>' : '') + '</div>';
    });
    if (!(Array.isArray(list) && list.length)) h += '<p class="hint">No faction cards yet: −3 at war, 0 neutral, +3 allies.</p>';
    return h + '</div>';
  }

  function styleText() {
    return '.b68-ct{margin:6px 0 10px}.b68-ct-row{display:flex;flex-wrap:wrap;gap:3px}.b68-ct-box{width:16px;height:16px;border:2px solid #444;border-radius:3px;background:transparent;display:inline-block}' +
      '.b68-ct-box.on{background:#d8a31a;border-color:#8a6406}.b68-ct-box.b68-ct-target{border-radius:50%;border-style:double}.b68-ct-box.b68-ct-turf{transform:rotate(45deg) scale(.85)}' +
      '.b68-ct-line{margin:4px 0;font-size:13px}.b68-ct-marks{list-style:none;margin:2px 0;padding:0;display:flex;flex-wrap:wrap;gap:4px 12px;font-size:13px}' +
      '.b68-ct-mark{display:flex;gap:5px;align-items:center;opacity:.65}.b68-ct-mark.lit{opacity:1;font-weight:700}.b68-ct-lamp{width:10px;height:10px;border-radius:50%;border:2px solid #444;display:inline-block}' +
      '.b68-ct-mark.lit .b68-ct-lamp{background:#d8a31a;border-color:#8a6406;box-shadow:0 0 6px #d8a31a}' +
      '.b68-fc-list{display:grid;gap:8px}.b68-fc{position:relative;border:2px solid #333;border-radius:6px;padding:6px 8px;background:#f6f1e3;color:#111;overflow:hidden}' +
      '.b68-fc-name{display:flex;gap:6px;align-items:center}.b68-fc-name .tp-in{flex:1 1 auto}.b68-fc-ladder{margin-top:4px}' +
      '.b68-fc.war{border-color:#a8210f}.b68-fc-war{position:absolute;right:10px;top:8px;border:3px solid #a8210f;color:#a8210f;padding:0 8px;font:900 18px/1.3 system-ui,sans-serif;letter-spacing:.12em;transform:rotate(-8deg);opacity:.88;pointer-events:none;background:rgba(255,255,255,.55)}';
  }
  function ensureStyle() {
    var d = W && W.document;
    if (!d || typeof d.createElement !== 'function' || !d.head || (d.getElementById && d.getElementById('b68-claims-css'))) return;
    var s = d.createElement('style'); s.id = 'b68-claims-css'; s.textContent = styleText(); d.head.appendChild(s);
  }

  var started = false;
  function start() { started = true; }
  function stop() {
    started = false;
    var d = W && W.document, s = d && d.getElementById ? d.getElementById('b68-claims-css') : null;
    if (s && s.parentNode) s.parentNode.removeChild(s);
  }
  /* on the GM page the switch is read from the state document (valueOf); on a phone the flags told start() */
  function gmOn() {
    var P = W && W.B68GmPage, f = P && typeof P.aftermath === 'function' ? P.aftermath() : null;
    return !!(f && W.B68Features && W.B68Features.valueOf(f.doc, SWITCH));
  }
  function active(ctx) {
    var on = (started && !!(W && W.B68Flags && W.B68Flags.on(SWITCH))) || (isObj(ctx) && ctx.isGM === true && gmOn());
    if (on) ensureStyle();
    return on;
  }

  return { SWITCH: SWITCH, RUNGS: RUNGS, start: start, stop: stop, active: active, track: track, cards: cards, styleText: styleText, summarise: summarise, rung: rung, isWar: isWar, _started: function () { return started; } };
});
