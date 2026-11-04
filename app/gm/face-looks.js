/* gm/face-looks.js — the GM's half of the face looks: which names ride on a held spotlight (suite 3.2, 3.3; switches face.expressions and face.formats; the badge, 3.4, needs nothing here
   except that a renewed hold says so).

   Plain script, UMD: window.B68GmFaceLooks in the browser, module.exports under Node. GM side only. gm/spotlight.js asks it for the `look` to send with a held NPC's overlay; it
   reads the NPC's GM-only notes through the host and sends only NAMES from the fixed lists in display/face-look.js, never the notes themselves.

   THE NOTES. An NPC's gmNotes may hold lines the GM writes for them (the invented example):
     Tell: smirk — touches his cuff       -> the Tell button shows the `smirk` expression
     Signature: lapel                     -> the Signature button plays the `lapel` pose once
     Relation: resident                   -> the portrait format (licence for a resident, badge for staff, mugshot for a suspect, society page, passport)
   A person with no such line has no Tell, no Signature and no format: the button is off and says where to write it.

   create(host) -> controller
     host: { feature(id) -> bool, notes(npcId) -> the NPC's gmNotes string | '' }
     controller: initial(id) -> look | null      the look a spotlight starts with (the format, when face.formats is on; no expression: the face as drawn)
                 express(cur, id, name) -> { look } | { say }     name: neutral | pleased | hostile | afraid | tell
                 signature(cur, id) -> { look } | { say }        the pose goes in this one overlay only: cur is not changed
                 relay(cur) -> look | null                       the look for a renewed hold: the expression and format kept, the pose dropped, `re` set so the iPad does not replay the motif
                 view(id) -> { on, names, tell, signature } | null       html(v, esc) -> the buttons
   BUTTONS = [ [name, label] ... ] the five expression buttons. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmFaceLooks = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var BUTTONS = [['neutral', 'Neutral'], ['pleased', 'Pleased'], ['hostile', 'Hostile'], ['afraid', 'Afraid'], ['tell', 'Their tell']];
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function req(name, path) { if (root && root[name]) return root[name]; try { return require(path); } catch (e) { return null; } }

  function html(v, esc) {
    esc = esc || function (s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    if (!v || !v.on) return '';
    var h = '<div class="gm-bar-faces" role="group" aria-label="Expression of the person held">';
    BUTTONS.forEach(function (b) {
      var off = b[0] === 'tell' && !v.tell;
      h += '<button type="button" class="btn sm" data-b17="expr" data-expr="' + esc(b[0]) + '"' + (off ? ' disabled title="Write a line Tell: smirk in this person’s GM notes"' : '') + '>' + esc(b[1]) + '</button> ';
    });
    h += '<button type="button" class="btn sm" data-b17="sig"' + (v.signature ? '' : ' disabled title="Write a line Signature: lapel in this person’s GM notes"') + '>Signature</button></div>';
    return h;
  }

  function create(host) {
    host = host || {};
    var FL = req('B68FaceLook', '../display/face-look.js');
    function on(id) { return typeof host.feature === 'function' ? !!host.feature(id) : false; }
    function notes(id) { try { return FL ? FL.parseNotes(typeof host.notes === 'function' ? host.notes(id) : '') : { tell: '', signature: '', fmt: '' }; } catch (e) { return { tell: '', signature: '', fmt: '' }; } }
    function any() { return on('face.expressions') || on('face.formats') || on('face.badge'); }

    function initial(id) {
      if (!FL || !on('face.formats')) return null;
      var f = notes(id).fmt;
      return f ? { fmt: f } : null;
    }
    function express(cur, id, name) {
      if (!FL || !on('face.expressions')) return { say: '' };
      var expr = name;
      if (name === 'tell') {
        expr = notes(id).tell;
        if (!expr) return { say: 'No tell yet: write a line "Tell: smirk" in this person’s GM notes.' };
      }
      if (FL.EXPRS.indexOf(expr) < 0) return { say: '' };
      return { look: Object.assign({}, cur || {}, { expr: expr }) };
    }
    function signature(cur, id) {
      if (!FL || !on('face.expressions')) return { say: '' };
      var p = notes(id).signature;
      if (!p) return { say: 'No signature pose yet: write a line "Signature: lapel" in this person’s GM notes.' };
      return { look: Object.assign({}, cur || {}, { pose: p }) };
    }
    function relay(cur) {
      if (!any()) return null;
      var out = Object.assign({}, cur || {}); delete out.pose; out.re = true;
      return out;
    }
    function view(id) {
      if (!on('face.expressions')) return null;
      var n = notes(id);
      return { on: true, tell: n.tell, signature: n.signature };
    }
    return { initial: initial, express: express, signature: signature, relay: relay, view: view, html: html };
  }

  return { BUTTONS: BUTTONS, html: html, create: create };
});
