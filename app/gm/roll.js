/* gm/roll.js — THE ROLL (the GM night rebuild, N4; design section 5): the left column of Personal, Planning and Score.

   One card, top to bottom:
     Position [Controlled] [Risky] [Desperate], and under it the size of a consequence at that position
     Effect   [Limited] [Standard] [Great]
     If it goes wrong: one line (the console's Threat on screen and the stamp's line: one field, one value, prefilled from the room; a two-row
     textarea so it shows whole in the column, never more than one line)
     Stamp it on the iPad  ->  while up: ● On the iPad, Take it down (Esc), Clean (no card), and Stamp again once what is set has changed
     They rolled [1 Before] [2 4/5] [3 1–3] [4 Someone] (keys 1-4), with the Dots (0-4) small beside the heading
   Under the card the result card (the consequence at full size for the stamped position sits under its header, with Reduce; its actions row adds
   Pay the price and Harm & resist), Blade's Rack folded under it, and the folds: Scene (Now in, the scene, the district, who it aims at, the NPC),
   Earlier, More tables. Focus (F) collapses the column to #gm-mini: the position, then the four keys.

   Plain script, UMD: window.B68GmRoll in the browser, module.exports under Node (checks/runtime/gm-roll.test.mjs). PURE: HTML strings from plain values,
   every string through esc(); no DOM, no state, no network. gm-page.js owns the data (con.live in the GM state, the stamp controller, the console), every
   data-gm action and the painting. The column is section.gm-console: the one block N1b places, whole, in a place's left column (its parts are found by
   id under the page root, so it can move).

   API
     shell() -> the column's inner HTML, every id gm-page.js fills, in order
     posHtml(positions, cur) -> #gm-pos: three radios (data-gm="pos"). positions: the console's [{ value, label, severity, ticks, harm }]
     sizeText(p) -> "severity · ticks · harm n"      sizeLine(positions, cur) -> the line under Position ('' when the pack has no size for it)
     effHtml(cur) -> #gm-eff: three radios (data-gm="eff")
     dotsHtml(dots) -> #gm-dots: 0-4 (data-gm="dots"; a second tap clears; null = unset)
     stampHtml(v) -> #gm-stamp. v = { on, active: { position, effect, text } | null, stale }
     lineNote(room) -> the note under the line while it is the room's own ('' for none)
     buttonsHtml(sits) -> #gm-buttons: four .gm-btn with keys 1-4 (sits: con.situations())
     miniHtml(sits, pos, eff, up) -> #gm-mini (Focus): the position (and the effect, and whether the stamp is up), then the four keys
     sizerHtml(z) -> the strip under the result card's header (z: the stamp view's sizer) | ''
     quickActs() -> Pay the price and Harm & resist, for the actions row of a 4/5 or a 1–3 card
     rackSummary(r) -> the Blade fold's summary text. r = { fitted: position | '', pending, voice: name | '' }
     EFFECTS, cap(s), esc(s) */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmRoll = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EFFECTS = ['limited', 'standard', 'great'];
  var CLASS = { controlled: 'is-ctl', risky: 'is-risky', desperate: 'is-desp' };

  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cap(s) { s = str(s); return s.charAt(0).toUpperCase() + s.slice(1); }

  function shell() {
    return '<div class="gm-rl" id="gm-rl" role="group" aria-labelledby="gm-rl-h">' +
      '<p class="gm-rl-h" id="gm-rl-h">The roll</p>' +
      '<div class="seg gm-rl-seg gm-pos" id="gm-pos" role="radiogroup" aria-label="Position"></div>' +
      '<p class="gm-rl-size" id="gm-pos-size"></p>' +
      '<div class="seg gm-rl-seg gm-eff" id="gm-eff" role="radiogroup" aria-label="Effect"></div>' +
      '<div class="gm-rl-line"><label class="gm-lab" for="gm-c-threat">If it goes wrong</label>' +
        /* a textarea so a whole line shows in a narrow column; it is still one line (Enter stamps it, gm-page.js rollBind) */
        '<div class="gm-rl-in"><textarea id="gm-c-threat" data-ctl="threat" rows="2" maxlength="100" autocomplete="off" spellcheck="false" placeholder="One line the players see before the dice"></textarea>' +
        '<button type="button" class="gm-rl-x" data-gm="line-clear" title="Clear the line" aria-label="Clear the line">×</button></div>' +
        '<p class="gm-rl-note" id="gm-line-note" hidden></p></div>' +
      '<div class="gm-stamp" id="gm-stamp"></div>' +
      '<div class="gm-rl-they"><span class="gm-lab" id="gm-they-l">They rolled</span>' +
        '<span class="gm-rl-dots"><span class="gm-lab" id="gm-dots-l" title="The dice in the pool: L files it with the roll (tap again to clear)">Dots</span>' +
        '<span class="gm-dots" id="gm-dots" role="radiogroup" aria-labelledby="gm-dots-l"></span></span></div>' +
      '<div class="gm-buttons" id="gm-buttons" role="group" aria-labelledby="gm-they-l"></div>' +
      '</div>' +
      '<div class="gm-cardbox" id="gm-card" aria-live="polite"></div>' +
      '<details class="gm-rl-fold gm-rackf" id="gm-rackf" open hidden><summary><span class="gm-lab">Blade</span><span class="gm-rl-sum" id="gm-rack-sum"></span></summary>' +
        '<div class="gm-rack" id="gm-rack" aria-live="polite"></div></details>' +
      /* the Scene button sits in a plain div: a <button> as a direct grid item of the scrolling column collapses to its min-height once the column
         overflows (Chromium sizes the track from the button's min-height, not its wrapped content) */
      '<div class="gm-rl-scene"><button type="button" class="gm-scene gm-rl-fb" id="gm-scene" data-gm="scene" aria-expanded="false" aria-controls="gm-scenebox" title="Now in, the scene, the district, who it aims at, the NPC">' +
        '<span class="gm-lab">Scene</span><span class="gm-scene-chips" id="gm-scene-chips"></span></button></div>' +
      '<div class="gm-scenebox gm-rl-panel" id="gm-scenebox" hidden>' +
        '<label class="gm-nowline" for="gm-now-s"><span class="gm-lab">Now in</span><select data-now id="gm-now-s"></select></label>' +
        '<div class="gm-controls" id="gm-controls"></div></div>' +
      '<div class="gm-rl-fbs">' +
        '<button type="button" class="gm-rl-fb" id="gm-earlier-b" data-gm="fold" data-rlfold="earlier" aria-expanded="false" aria-controls="gm-earlier">' +
          '<span class="gm-lab">Earlier</span><span class="gm-rl-n" id="gm-earlier-n"></span></button>' +
        '<button type="button" class="gm-rl-fb" id="gm-singles-b" data-gm="fold" data-rlfold="singles" aria-expanded="false" aria-controls="gm-singles"><span class="gm-lab">More tables</span></button></div>' +
      '<div class="gm-earlier gm-rl-panel" id="gm-earlier" hidden></div>' +
      '<div class="gm-singles gm-rl-panel" id="gm-singles" hidden></div>' +
      '<div class="gm-mini" id="gm-mini" role="group" aria-label="The roll"></div>';
  }

  function sizeText(p) { return p ? [str(p.severity), str(p.ticks), p.harm != null && p.harm !== '' ? 'harm ' + str(p.harm) : ''].filter(Boolean).join(' · ') : ''; }
  function find(positions, cur) { var l = Array.isArray(positions) ? positions : []; for (var i = 0; i < l.length; i++) if (l[i] && l[i].value === cur) return l[i]; return null; }
  function sizeLine(positions, cur) { return sizeText(find(positions, cur)); }
  function posHtml(positions, cur) {
    return (Array.isArray(positions) ? positions : []).map(function (p) {
      var v = str(p.value), lab = cap(p.label || v), sz = sizeText(p);
      return '<button type="button" class="chip gm-posb ' + (CLASS[v] || '') + '" role="radio" aria-checked="' + (v === cur) + '" data-gm="pos" data-v="' + esc(v) + '"' +
        (sz ? ' title="' + esc(lab + ': ' + sz) + '"' : '') + '>' + esc(lab) + '</button>';
    }).join('');
  }
  function effHtml(cur) {
    return EFFECTS.map(function (e) { return '<button type="button" class="chip gm-effb" role="radio" aria-checked="' + (e === cur) + '" data-gm="eff" data-v="' + e + '">' + cap(e) + '</button>'; }).join('');
  }
  function dotsHtml(dots) {
    return [0, 1, 2, 3, 4].map(function (n) { return '<button type="button" class="chip sm gm-dotb" role="radio" aria-checked="' + (dots === n) + '" data-gm="dots" data-v="' + n + '" aria-label="' + n + (n === 1 ? ' dot' : ' dots') + '">' + n + '</button>'; }).join('');
  }
  function stampHtml(v) {
    v = v || {};
    if (!v.on) return '';
    var a = v.active;
    if (!a) return '<button type="button" class="btn primary gm-stampb" data-gm="stamp" ' +
      'title="The position, the effect and the line, as an action report on the iPad before the dice. Enter in the line does it too">Stamp it on the iPad</button>';
    return '<p class="gm-rl-up" role="status"><span class="gm-dot on" aria-hidden="true"></span><b>On the iPad</b><span>' + esc(cap(a.position) + ', ' + a.effect) + '</span>' +
        (v.stale ? '<span class="gm-rl-chg">changed here</span>' : '') + '</p>' +
      '<div class="gm-rl-acts">' +
        (v.stale ? '<button type="button" class="btn sm primary" data-gm="stamp" title="Puts what is set now on the iPad in its place">Stamp again</button>' : '') +
        '<button type="button" class="btn sm" data-gm="stamp-down" title="Takes the action report off the iPad">Take it down <kbd>Esc</kbd></button>' +
        '<button type="button" class="chip sm" data-gm="stamp-clean" title="Take the card down; the roll needs no consequence">Clean (no card)</button></div>';
  }
  function lineNote(room) { return str(room) ? 'From the room: ' + esc(room) : ''; }
  function buttonsHtml(sits) {
    return (Array.isArray(sits) ? sits : []).map(function (b) {
      return '<button type="button" class="gm-btn gm-sbtn" data-gm="situation" data-n="' + esc(b.key) + '" data-sit="' + esc(b.id) + '" title="' + esc(b.hint || b.label) + '"><kbd>' + esc(b.key) + '</kbd><b>' + esc(b.label) + '</b></button>';
    }).join('');
  }
  function miniHtml(sits, pos, eff, up) {
    var p = str(pos), head = p ? '<p class="gm-mini-pos ' + (CLASS[p] || '') + (up ? ' up' : '') + '" title="' + esc('Position: ' + p + (eff ? ', ' + eff : '') + (up ? '. Stamped on the iPad' : '') + '. F shows the whole roll') + '">' +
      '<b>' + esc(cap(p)) + '</b>' + (eff ? '<small>' + esc(eff) + '</small>' : '') + (up ? '<small class="gm-mini-up">● iPad</small>' : '') + '</p>' : '';
    return head + (Array.isArray(sits) ? sits : []).map(function (b) { return '<button type="button" data-gm="situation" data-n="' + esc(b.key) + '" title="' + esc(b.label) + '">' + esc(b.key) + '<small>' + esc(str(b.label).slice(0, 8)) + '</small></button>'; }).join('');
  }
  function sizerHtml(z) {
    if (!z) return '';
    var res = z.result === '45' ? 'a 4/5' : 'a 1–3', h = '';
    h += '<p class="gm-sz-k">' + (z.reduced ? 'Reduced to <b>' + esc(z.shown) + '</b> (stamped ' + esc(z.stamped) + ')' : 'Full size for <b>' + esc(z.stamped) + '</b>') + ' · ' + res + '</p>';
    h += '<p class="gm-sz-t">' + (z.size ? esc(sizeText({ severity: z.size.severity, ticks: z.size.ticks, harm: z.size.harm })) : 'The pack has no size for ' + esc(z.shown) + '.') + '</p>';
    var lines = Array.isArray(z.lines) ? z.lines : [], text = str(z.text), rest = lines.filter(function (l) { return l !== text; });
    if (text) h += '<p class="gm-sz-l"><span class="gm-lab">If it goes wrong</span>' + esc(text) + '</p>';
    if (rest.length) h += '<div class="gm-sz-or"><span class="gm-lab">' + (text ? 'Or, from the room' : 'From the room') + '</span><ul>' + rest.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></div>';
    if (!text && !rest.length) h += '<p class="gm-dim">No "If it goes wrong" line for this room.</p>';
    h += '<div class="gm-sz-acts">' + (z.reduced ? '<button type="button" class="btn sm" data-gm="sz-restore">Restore full size</button>'
      : z.canReduce ? '<button type="button" class="btn sm' + (z.armed ? ' primary' : '') + '" data-gm="sz-reduce" title="Needs a second tap">' + (z.armed ? 'Tap again to reduce one step' : 'Reduce') + '</button>' : '') +
      '<button type="button" class="chip sm" data-gm="sz-done" title="Puts this strip away">Done</button></div>';
    return h;
  }
  function quickActs() {
    return '<button type="button" class="btn sm" data-gm="qt" data-n="4" title="Pay the price: its line on this card, else a roll of its table">Pay the price</button>' +
      '<button type="button" class="btn sm" data-gm="qt" data-n="7" title="Harm &amp; resist: its line on this card, else a roll of its table">Harm &amp; resist</button>';
  }
  function rackSummary(r) {
    r = r || {};
    var bits = [];
    if (r.pending) bits.push('fitting…'); else if (r.fitted) bits.push('fitted for ' + str(r.fitted));
    if (r.voice) bits.push('Voice: ' + str(r.voice));
    return bits.join(' · ');
  }

  return { EFFECTS: EFFECTS.slice(), cap: cap, esc: esc, shell: shell, posHtml: posHtml, sizeText: sizeText, sizeLine: sizeLine, effHtml: effHtml, dotsHtml: dotsHtml,
    stampHtml: stampHtml, lineNote: lineNote, buttonsHtml: buttonsHtml, miniHtml: miniHtml, sizerHtml: sizerHtml, quickActs: quickActs, rackSummary: rackSummary };
});
