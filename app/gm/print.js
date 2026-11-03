/* gm/print.js — Menu -> Print: the night's printed props (suite tickets 3.6 and 2.11; switches print.cards and print.blueprint).

   Window.B68GmPrint, and module.exports under Node. Print only: it reads the GM state and writes a page for the browser's print dialog. It
   changes no state, calls no server and no model.

   3.6  Calling cards and standees
     cards    an 85 x 55 mm card for every revealed NPC, ten to an A4 sheet (2 across, 5 down), in the calling-card look: name, alias, role, faction
     standee  an A4 tent for every NPC tagged "major": the cover identity on the front; the back is a silhouette, or the true identity the GM types
              in the sheet before printing (it is never stored, and a back is only ever what the GM typed)
     Only revealed NPCs are printed (the same pool as the hard start's credits), and only name, alias, role and faction.
   2.11 The printed blueprint
     An A3 or A4 case-file plan of the location, PLAYER layer only: the rooms the crew knows, drawn by the map kit's case-file theme (which carries the
     title block, a 25 ft scale bar and north), inside a page with a wide margin for the grease pencil. The render goes through the page's own player
     door (host.blueprint), which refuses anything that would name a hidden room.

   Pure: cardsOf(npcs) -> [card] · majorsOf(npcs) -> [card] · cardsHtml(cards) · standeeHtml(card, back) · blueprintHtml(d, size)
   make(host) -> ctl, host = { npcs() -> { id: npcDoc }, blueprint() -> { title, caption, svg } (throws when nothing safe can be drawn), print(html), root(), on(id), toast? }
     ctl.printCards() ctl.printStandee(id, backText) ctl.printBlueprint(size 'A3' | 'A4') ctl.open() ctl.toggle() ctl.render(box) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68GmPrint = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var PER_SHEET = 10;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* revealed NPCs with a name, in name order: only the four fields a player may read, and whether the NPC is tagged "major" */
  function cardsOf(npcs) {
    var out = [];
    Object.keys(isObj(npcs) ? npcs : {}).forEach(function (id) {
      var d = npcs[id];
      if (!isObj(d) || d.revealed !== true || !str(d.name).trim()) return;
      var tags = Array.isArray(d.tags) ? d.tags : [];
      out.push({ id: id, name: str(d.name).trim().slice(0, 80), alias: str(d.alias).trim().slice(0, 80), role: str(d.role).trim().slice(0, 80), faction: str(d.faction).trim().slice(0, 80),
        major: tags.some(function (t) { return str(t).trim().toLowerCase() === 'major'; }) });
    });
    out.sort(function (a, b) { var x = a.name.toLowerCase(), y = b.name.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; });
    return out;
  }
  function majorsOf(npcs) { return cardsOf(npcs).filter(function (c) { return c.major; }); }

  var CSS_BASE = '*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}body{font-family:Georgia,"Times New Roman",serif;color:#1c1a17;-webkit-print-color-adjust:exact;print-color-adjust:exact}';
  function page(title, css, body, size) {
    return '<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>@page{size:' + size + ';margin:0}' + CSS_BASE + css + '</style></head><body>' + body + '</body></html>';
  }

  /* ---- 3.6 the cards: 2 x 5 of 85 x 55 mm on an A4 sheet, 20 mm side margins and 11 mm top and bottom ---- */
  var CARD_CSS = '.sheet{width:210mm;height:297mm;padding:11mm 20mm;display:grid;grid-template-columns:85mm 85mm;grid-template-rows:repeat(5,55mm);page-break-after:always;overflow:hidden}' +
    '.sheet:last-child{page-break-after:auto}.card{width:85mm;height:55mm;padding:3mm;background:#f4ecd8;outline:.2mm dashed #b9ad92;outline-offset:-.2mm}' +
    '.card .in{height:100%;border:.5mm solid #3b3326;padding:1mm;display:flex}' +
    '.card .in2{flex:1;border:.2mm solid #3b3326;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:2mm}' +
    '.card .nm{font-size:17pt;line-height:1.1;font-variant:small-caps;letter-spacing:.04em}.card .al{font-style:italic;font-size:10pt;margin-top:1mm}' +
    '.card .rule{width:30mm;border-top:.3mm solid #3b3326;margin:2.5mm 0}.card .rl{font-size:9pt;letter-spacing:.12em;text-transform:uppercase}.card .fc{font-size:8pt;color:#5b5140;margin-top:1mm}';
  function cardHtml(c) {
    return '<div class="card"><div class="in"><div class="in2"><div class="nm">' + esc(c.name) + '</div>' + (c.alias ? '<div class="al">“' + esc(c.alias) + '”</div>' : '') +
      (c.role || c.faction ? '<div class="rule"></div>' : '') + (c.role ? '<div class="rl">' + esc(c.role) + '</div>' : '') + (c.faction ? '<div class="fc">' + esc(c.faction) + '</div>' : '') + '</div></div></div>';
  }
  function cardsHtml(cards) {
    var list = Array.isArray(cards) ? cards : [], sheets = [];
    for (var i = 0; i < list.length; i += PER_SHEET) sheets.push('<div class="sheet">' + list.slice(i, i + PER_SHEET).map(cardHtml).join('') + '</div>');
    return page('Calling cards', CARD_CSS, sheets.join(''), 'A4 portrait');
  }

  /* ---- 3.6 the tent standee: the A4 page folds in half; the top half is the back, upside down, so it reads right from the far side ---- */
  var SILHOUETTE = '<svg viewBox="0 0 100 160" width="60mm" height="96mm" aria-hidden="true"><circle cx="50" cy="38" r="22" fill="#1c1a17"/><path d="M12 158 C12 104 30 84 50 84 C70 84 88 104 88 158 Z" fill="#1c1a17"/></svg>';
  var STANDEE_CSS = '.half{width:210mm;height:148.5mm;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:12mm;background:#f4ecd8}' +
    '.half.back{transform:rotate(180deg);border-bottom:.3mm dashed #8a7e63;background:#e6dcc3}' +
    '.half .nm{font-size:44pt;font-variant:small-caps;letter-spacing:.04em;line-height:1.05}.half .al{font-style:italic;font-size:22pt;margin-top:4mm}' +
    '.half .rl{font-size:16pt;letter-spacing:.16em;text-transform:uppercase;margin-top:8mm}.half .tag{font-size:10pt;letter-spacing:.2em;text-transform:uppercase;color:#6b604a;margin-bottom:6mm}';
  function standeeHtml(card, backText) {
    var c = isObj(card) ? card : {}, b = str(backText).trim();
    var front = '<div class="half"><div class="nm">' + esc(c.name) + '</div>' + (c.alias ? '<div class="al">“' + esc(c.alias) + '”</div>' : '') + (c.role ? '<div class="rl">' + esc(c.role) + '</div>' : '') + '</div>';
    var back = '<div class="half back">' + (b ? '<div class="tag">Behind the face</div><div class="nm">' + esc(b) + '</div>' : SILHOUETTE) + '</div>';
    return page('Standee: ' + str(c.name), STANDEE_CSS, back + front, 'A4 portrait');
  }

  /* ---- 2.11 the blueprint: the plan, a title strip, and a ruled margin for the grease pencil ---- */
  var SIZES = { A3: { page: 'A3 landscape', w: 420, h: 297 }, A4: { page: 'A4 landscape', w: 297, h: 210 } };
  function blueprintHtml(d, size) {
    var key = SIZES[size] ? size : 'A4', s = SIZES[key], x = isObj(d) ? d : {};
    var css = '.bp{width:' + s.w + 'mm;height:' + s.h + 'mm;padding:8mm;display:grid;grid-template-columns:1fr 52mm;grid-template-rows:1fr auto;gap:4mm;overflow:hidden}' +
      '.plan{border:.4mm solid #1c1a17;display:flex;align-items:center;justify-content:center;overflow:hidden;min-height:0;min-width:0}.plan svg{max-width:100%;max-height:100%;width:auto;height:auto}' +
      '.pencil{border:.4mm solid #1c1a17;padding:2mm;font-size:8pt;letter-spacing:.14em;text-transform:uppercase;color:#6b604a;background:repeating-linear-gradient(transparent 0 7.5mm,#c9c0a8 7.5mm 7.7mm)}' +
      '.tb{grid-column:1 / span 2;border:.4mm solid #1c1a17;display:grid;grid-template-columns:2fr 3fr 1fr 1fr;font-size:9pt}.tb div{padding:1.5mm 2.5mm;border-right:.3mm solid #1c1a17}.tb div:last-child{border-right:0}' +
      '.tb b{display:block;font-size:6.5pt;letter-spacing:.14em;text-transform:uppercase;color:#6b604a;font-weight:400}';
    var body = '<div class="bp"><div class="plan">' + str(x.svg) + '</div><div class="pencil">Grease pencil</div>' +
      '<div class="tb"><div><b>Place</b>' + esc(x.title) + '</div><div><b>Known to the crew</b>' + esc(x.caption) + '</div><div><b>Sheet</b>Case file blueprint</div><div><b>Size</b>' + key + '</div></div></div>';
    return page('Blueprint: ' + str(x.title), css, body, s.page);
  }

  /* the browser's print dialog, from a hidden frame (nothing is opened or navigated) */
  function printFrame(html) {
    var d = W && W.document; if (!d || !d.body) return false;
    var f = d.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    d.body.appendChild(f);
    var fd = f.contentDocument || (f.contentWindow && f.contentWindow.document); if (!fd) { d.body.removeChild(f); return false; }
    fd.open(); fd.write(html); fd.close();
    setTimeout(function () {
      try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { /* the dialog is the browser's */ }
      setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 60000);
    }, 250);
    return true;
  }

  function make(host) {
    var h = host || {}, back = {};
    function say(m, bad) { if (typeof h.toast === 'function') h.toast(m, bad === true); }
    function out(html) { return typeof h.print === 'function' ? h.print(html) : printFrame(html); }
    function npcs() { return typeof h.npcs === 'function' ? h.npcs() : {}; }
    function on(id) { return typeof h.on === 'function' ? !!h.on(id) : true; }
    var ctl = {
      printCards: function () {
        var c = cardsOf(npcs()); if (!c.length) { say('No NPC has been revealed yet, so there are no cards.', true); return false; }
        return out(cardsHtml(c));
      },
      printStandee: function (id, text) {
        var c = majorsOf(npcs()).filter(function (x) { return x.id === id; })[0];
        if (!c) { say('Tag the NPC "major" and reveal them first.', true); return false; }
        return out(standeeHtml(c, text));
      },
      printBlueprint: function (sz) {
        var d; try { d = typeof h.blueprint === 'function' ? h.blueprint() : null; } catch (e) { say(e && e.message ? e.message : 'Nothing safe to print.', true); return false; }
        if (!d || !d.svg) { say('Roll a location first.', true); return false; }
        return out(blueprintHtml(d, sz === 'A3' ? 'A3' : 'A4'));
      }
    };
    function Sheet() { return W && W.B68GmWorkshop ? W.B68GmWorkshop : null; }
    function sheet() { var S = Sheet(), r = typeof h.root === 'function' ? h.root() : null; return S && r ? S.sheet(r, 'print', 'Print') : null; }
    ctl.render = function (box) {
      if (!box) return;
      var html = '';
      if (on('print.cards')) {
        var all = cardsOf(npcs()), maj = all.filter(function (c) { return c.major; });
        html += '<h3>Calling cards</h3><p class="gm-dim">' + all.length + ' revealed NPC' + (all.length === 1 ? '' : 's') + ', ten cards to an A4 sheet.</p>' +
          '<div class="gm-sb-row"><button type="button" class="btn sm primary" data-pr="cards"' + (all.length ? '' : ' disabled') + '>Print tonight’s cards</button></div>' +
          '<h3>Tent standees</h3>' + (maj.length ? '' : '<p class="gm-empty">No revealed NPC is tagged “major”.</p>') +
          maj.map(function (c) {
            return '<div class="gm-sb-row"><b>' + esc(c.name) + '</b> <label>Back: <input type="text" data-pr-back="' + esc(c.id) + '" value="' + esc(back[c.id] || '') + '" placeholder="blank = silhouette"></label> ' +
              '<button type="button" class="btn sm" data-pr-standee="' + esc(c.id) + '">Print standee</button></div>';
          }).join('');
      }
      if (on('print.blueprint')) {
        html += '<h3>Blueprint</h3><p class="gm-dim">The location on the player layer: only the rooms you have revealed.</p><div class="gm-sb-row">' +
          '<button type="button" class="btn sm primary" data-pr="bp-A4">Print A4</button> <button type="button" class="btn sm" data-pr="bp-A3">Print A3</button></div>';
      }
      box.innerHTML = html || '<p class="gm-empty">Both print switches are off.</p>';
      var sh = box.parentNode;
      if (sh && !sh.__pr) {
        sh.__pr = true;
        sh.addEventListener('input', function (ev) { var t = ev.target; if (t && t.hasAttribute && t.hasAttribute('data-pr-back')) back[t.getAttribute('data-pr-back')] = t.value; });
        sh.addEventListener('click', function (ev) {
          var t = ev.target && ev.target.closest ? ev.target.closest('[data-pr],[data-pr-standee]') : null; if (!t) return;
          var a = t.getAttribute('data-pr');
          if (t.hasAttribute('data-pr-standee')) { var id = t.getAttribute('data-pr-standee'); ctl.printStandee(id, back[id]); }
          else if (a === 'cards') ctl.printCards();
          else if (a === 'bp-A3') ctl.printBlueprint('A3');
          else if (a === 'bp-A4') ctl.printBlueprint('A4');
        });
      }
    };
    ctl.open = function () { var b = sheet(); if (!b) return false; ctl.render(b.body); b.open(); return true; };
    ctl.toggle = function () { var b = sheet(); if (b && b.isOpen()) { b.close(); return false; } return ctl.open(); };
    return ctl;
  }

  return { make: make, cardsOf: cardsOf, majorsOf: majorsOf, cardsHtml: cardsHtml, standeeHtml: standeeHtml, blueprintHtml: blueprintHtml, PER_SHEET: PER_SHEET };
});
