/* gm/site.js — THE SITE: the Score place's whole score, the GM page's half of it (the GM night rebuild, N3; design section 4, Score).

   Plain script, UMD: window.B68GmSite in the browser, module.exports under Node (checks/runtime/gm-site.test.mjs). GM page only. The Run view (gm/run-view.js)
   draws the site; this module gives it the parts that belong to other controllers, and routes every data-site control back to them:
     the ONE alarm readout   the site alarm clock (the table clock the play names) and the security level on one line, a popover with the beat and the steps
     the map toolbar         Spotted · Flashback · Pin · Montage (Montage glows while the score is past its budget), then the stage group (gm/stage.js)
     the room states         dark / blueprint / seen and staged, for the board's tints, the map's labels and each room card's Players' map control
     the people              each room card's Who's here rows (gm/spotlight.js): Spotlight, Introduce, Card, the expressions, Take it down
     If it goes wrong        the room's lines (gm/stamp.js goesWrong), each with "→ the Roll" (page.setThreat), and the note without them
     the site line           for a card with no v2 night: the alarm readout (stepped by hand) and the stage group, so neither is lost with the old box
     the Costume engine      shows or hides the Disguise select of a v1 site's Run the site strip (this device only, localStorage; hidden by default)
   Nothing here writes a document of its own: every write is a controller's, through the page.

   create(page) -> site
     page: { esc(s), toast(msg, bad), rerender(),
             stage(), security(), spot(), knowledge(), beats() -> { spotted, flashback, threat }     the controllers, or null
             play() -> the v2 play | null      clock(name) -> the table clock | null      rooms() -> [{ name, band }] the roll's rooms (a run only)
             npcs() -> [npc]   card(names) -> bool there is a card   face(npcId) -> HTML | ''   roomMd(room) -> the room's prep Markdown
             scoreOver() -> bool    montageOpen() -> bool    montage(view) -> opens or shuts it    dawn()    introduce(npcId)    setThreat(text) -> bool
             lineShown() -> bool the site line is on screen }
     site: alarm(open, attr) alarmPop(gm) tools() stage(gm) states() seg(room) people(room, here) wrong(room) noteMd(md) act(action, el, view)
           costume() setCostume(on) applyCostume() line() mapMarks(svg, model, sel) lineAlarm()
   Pure: noteMd(md) -> the Markdown without its one-line "If it goes wrong: …" lines         COSTUME_KEY */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmSite = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var COSTUME_KEY = 'b68.gm.costume', MARKS = ['rv-mk-dark', 'rv-mk-blueprint', 'rv-mk-seen', 'rv-mk-staged', 'rv-mk-sel'];
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc0(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function req(name, path) { if (W && W[name]) return W[name]; try { return require(path); } catch (e) { return null; } }

  /* a line "If it goes wrong: …" (a bullet, a quote or bold marks around the label are fine) with text after the label: the card shows it as an action line */
  var WRONG = /^\s*(?:>\s*)*(?:[-*+]\s+)?(?:\*\*|__)?\s*if it goes wrong\b\s*(?:\*\*|__)?\s*[:–—-]?\s*(?:\*\*|__)?\s*(.*)$/i;
  function noteMd(md) {
    var fence = null;
    return str(md).split(/\r?\n/).filter(function (l) {
      var f = /^ {0,3}(`{3,}|~{3,})/.exec(l);
      if (f) { if (!fence) fence = f[1].charAt(0); else if (f[1].charAt(0) === fence) fence = null; return true; }
      if (fence) return true;
      var m = WRONG.exec(l);
      return !(m && str(m[1]).replace(/[*_`~=\s]+/g, '') !== '');
    }).join('\n');
  }

  function create(page) {
    page = page || {};
    var lineAlarm = false, escOff = null;
    var Se = req('B68GmSecurity', './security.js'), St = req('B68GmStage', './stage.js'), Sp = req('B68GmSpotlight', './spotlight.js'), Stamp = req('B68GmStamp', './stamp.js');
    function get(k) { try { return typeof page[k] === 'function' ? page[k]() : null; } catch (e) { return null; } }
    function esc(s) { return typeof page.esc === 'function' ? page.esc(s) : esc0(s); }
    function toast(m, bad) { if (typeof page.toast === 'function') page.toast(m, !!bad); }
    function redraw() { if (typeof page.rerender === 'function') page.rerender(); }

    /* ---- the ONE alarm ---- */
    function alarmInfo() {
      var sec = get('security'), v = sec ? sec.view() : null; if (!v || !Se) return null;
      var play = get('play'), al = isObj(play) && isObj(play.alarm) ? play.alarm : null, name = al ? str(al.clock).trim() : '';
      var ck = name && typeof page.clock === 'function' ? page.clock(name) : null, beats = al && Array.isArray(al.beats) ? al.beats : [];
      return { v: v, clock: name, beat: v.site && v.filled > 0 ? str(beats[v.filled - 1]) : '', missing: al && !ck ? name : '' };
    }
    function alarm(open, attr) { var a = alarmInfo(); return a ? Se.readoutHtml(a.v, { open: !!open, attr: attr, clock: a.clock }, esc) : ''; }
    function alarmPop(gm) { var a = alarmInfo(); return a ? Se.popHtml(a.v, { clock: a.clock, beat: a.beat, missing: a.missing, gm: !!gm }, esc) : ''; }

    /* ---- the map toolbar ---- */
    function tools() {
      var b = get('beats') || {}, h = '';
      if (b.spotted && b.spotted.on()) h += '<button type="button" class="rv-btn sm" data-site="spotted"' + (b.spotted.busy() ? ' disabled' : '') + ' title="The Spotted beat: the sting on the iPad, the alarm ticks once (on the map it zooms to the crew’s room and fills from the eyes)">Spotted</button>';
      if (b.flashback && b.flashback.on()) {
        var up = !!b.flashback.up(), pin = str(b.flashback.pinned());
        h += '<button type="button" class="rv-btn sm rv-tog" data-site="flashback" aria-pressed="' + up + '" title="' + (up ? 'Back from the flashback' : 'Sepia, grain and “Earlier…” on the iPad until you tap again or say “Blade, back”') + '">' + (up ? 'Back' : 'Flashback') + '</button>';
        h += '<button type="button" class="rv-btn sm rv-tog" data-site="pin" aria-pressed="' + !!pin + '" title="' + (pin ? 'The pin is on ' + esc(pin) + ': tap to take it up' : 'Drop a pin on the crew’s room, where the flashback pays off (GM only)') + '">Pin</button>';
      }
      if (typeof page.montage === 'function') {
        var over = !!get('scoreOver'), open = !!get('montageOpen');
        h += '<button type="button" class="rv-btn sm rv-tog rv-montage' + (over ? ' glow' : '') + '" data-site="montage" aria-pressed="' + open + '" title="' + (over ? 'The score is past its budget: s' : 'S') + 'plit the iPad into a panel per character">Montage</button>';
      }
      return h;
    }
    function stage() { var s = get('stage'); return s && St ? St.groupHtml(s.view(), esc) : ''; }

    /* ---- the rooms ---- */
    function states() {
      var k = get('knowledge'), s = get('stage'), rooms = get('rooms') || [], ks = k && k.active() ? k.states() : {}, staged = s ? s.staged() : [], out = {};
      rooms.forEach(function (r) { var n = isObj(r) ? str(r.name) : ''; if (n && !out[n]) out[n] = { k: ks[n] || '', staged: staged.indexOf(n) >= 0, band: str(r.band) }; });
      return out;
    }
    function seg(room) { var k = get('knowledge'), s = get('stage'); return k && k.active() ? k.seg(room, !!(s && s.isStaged(room))) : ''; }
    /* first: this is the top card, so whoever is held on the iPad shows here too (with Take it down) when they are not one of this room's people */
    function people(room, here, first) {
      var sp = get('spot'); if (!sp || !Sp || !sp.view().on) return '';
      var npcs = get('npcs') || [], rows = Sp.peopleFor({ here: here, md: typeof page.roomMd === 'function' ? page.roomMd(room) : '', npcs: npcs, extra: sp.extras(room) }), held = sp.held();
      if (first && held && !rows.some(function (r) { return r.id === held; })) {
        var n = npcs.filter(function (x) { return x && x.id === held; })[0];
        if (n) rows.unshift({ id: str(n.id), name: str(n.name), alias: str(n.alias), role: 'held on the iPad', kind: '', revealed: n.revealed === true, here: false, moving: null, added: false });
      }
      return Sp.rowsHtml(rows, sp.view(), { room: room, introduce: true,
        face: function (r) { return r.id && typeof page.face === 'function' ? page.face(r.id) : ''; },
        card: function (r) { return typeof page.card === 'function' && !!page.card([r.name, r.alias].filter(Boolean)); } }, esc);
    }
    function wrong(room) {
      if (!Stamp || typeof Stamp.goesWrong !== 'function' || typeof page.roomMd !== 'function') return [];
      try { return Stamp.goesWrong(page.roomMd(room)).map(str).filter(Boolean); } catch (e) { return []; }
    }

    /* ---- every data-site control ---- */
    function act(a, el, view) {
      var at = function (k) { return el && typeof el.getAttribute === 'function' ? str(el.getAttribute(k)) : ''; };
      var s = get('stage'), sec = get('security'), sp = get('spot'), k = get('knowledge'), b = get('beats') || {};
      switch (a) {
        case 'alarm': lineAlarm = !lineAlarm; redraw(); break;
        case 'sec-up': if (sec) sec.step(1); redraw(); break;
        case 'sec-down': if (sec) sec.step(-1); redraw(); break;
        case 'spotted': if (b.spotted) Promise.resolve(b.spotted.run()).then(redraw, redraw); redraw(); break;
        case 'flashback': if (b.flashback) b.flashback.toggle(); break;
        case 'pin': if (b.flashback) b.flashback.pin(); break;
        case 'montage': if (typeof page.montage === 'function') page.montage(view || null); break;
        case 'send': if (s) s.send(); break;
        case 'freeze': if (s) s.freeze(); break;
        case 'blank': if (s) s.blank(); break;
        case 'kn': {
          var room = at('data-room'), want = at('data-k'); if (!k || !room) break;
          if (want === 'seen') {
            if (s && s.isStaged(room)) s.unstage(room);                                   /* a staged room tapped again: unstaged */
            else if (k.stateOf(room) !== 'seen') { if (s && s.canStage(room) && s.view().on) s.stage(room); else k.set(room, 'seen'); }      /* Seen stages it; Send opens it */
          } else { if (s && s.isStaged(room)) s.unstage(room); k.set(room, want); }        /* Dark and Blueprint at once */
          redraw(); break;
        }
        case 'intel': if (k) k.intel(at('data-group')); redraw(); break;
        case 'spot': { if (!sp) break; var id = at('data-id'); if (sp.held() === id) sp.narrator(); else Promise.resolve(sp.spotlight(id)).then(function (r) { if (r && r.ok && r.say) toast(r.say); }); break; }
        case 'down': if (sp) sp.narrator(); break;
        case 'expr': if (sp) sp.express(at('data-expr')); break;
        case 'sig': if (sp) sp.signature(); break;
        case 'intro': if (typeof page.introduce === 'function') page.introduce(at('data-id')); break;
        case 'card': { var nm = at('data-name'), al = at('data-alias'); if (view && typeof view.showNpc === 'function') view.showNpc([nm, al].filter(Boolean), nm); break; }
        case 'who-x': if (sp) sp.remove(at('data-room'), at('data-id')); break;
        case 'who-add': {
          var inp = el && el.querySelector ? el.querySelector('input') : null, v = inp ? str(inp.value).trim() : '';
          if (sp && v && sp.add(at('data-room'), v)) { if (inp) inp.value = ''; }
          break;
        }
        case 'threat': {
          var t = at('data-text');
          if (t && typeof page.setThreat === 'function' && page.setThreat(t)) toast('The Roll’s threat: ' + t);
          else if (t) toast('The Roll is not on this page.', true);
          break;
        }
        case 'costume': setCostume(!costume()); redraw(); break;
      }
    }

    /* ---- the Costume engine: the v1 strip's Disguise select, shown or hidden (this device only) ---- */
    function store() { try { return W && W.localStorage ? W.localStorage : null; } catch (e) { return null; } }
    function costume() { var s = store(); try { return !!s && s.getItem(COSTUME_KEY) === '1'; } catch (e) { return false; } }
    function applyCostume() { var d = W && W.document, b = d && d.body; if (b && b.classList) { if (costume()) b.classList.add('gm-show-costume'); else b.classList.remove('gm-show-costume'); } }
    function setCostume(on) { var s = store(); try { if (s) { if (on) s.setItem(COSTUME_KEY, '1'); else s.removeItem(COSTUME_KEY); } } catch (e) { /* this device only anyway */ } applyCostume(); toast(on ? 'Costume engine: the Disguise select shows in a v1 site’s Run the site strip.' : 'Costume engine: the Disguise select is put away.'); }

    /* ---- the site line: the site has no v2 night (a rolled location, a v1 site), so the readout and the stage live here ---- */
    function line() {
      var a = alarmInfo(), sg = stage(), kind = get('siteKind');
      if (!a && !sg) return '';
      var h = '<div class="rv-siteline" role="group" aria-label="The site"><div class="rv-headwrap"><div class="rv-head">';
      if (a) h += Se.readoutHtml(a.v, { open: lineAlarm, attr: 'data-gm="site" data-site="alarm"', clock: a.clock }, esc);
      h += sg.replace(/ data-site="/g, ' data-gm="site" data-site="');
      if (kind === 'v1') h += '<button type="button" class="rv-btn sm rv-tog" data-gm="site" data-site="costume" aria-pressed="' + costume() + '" title="The Disguise select in the Run the site strip (Location)">Costume engine: ' + (costume() ? 'shown' : 'hidden') + '</button>';
      h += '</div>' + (a && lineAlarm ? Se.popHtml(a.v, { clock: a.clock, beat: a.beat, missing: a.missing, gm: true }, esc) : '') + '</div></div>';
      return h;
    }

    /* ---- the Run map: the room labels carry the room's state (the map kit's room-label groups, by the number badge) ---- */
    function mapMarks(svg, model, sel) {
      if (!svg || typeof svg.querySelectorAll !== 'function' || !isObj(model) || !Array.isArray(model.rooms)) return 0;
      var st = states(), byN = {}, n = 0;
      model.rooms.forEach(function (r) { if (isObj(r) && str(r.name) && r.n != null) byN[String(r.n)] = str(r.name); });
      Array.prototype.forEach.call(svg.querySelectorAll('.room-label'), function (g) {
        var t = g.querySelector('text'), name = t ? byN[str(t.textContent).trim()] || '' : '';
        MARKS.forEach(function (c) { g.classList.remove(c); });
        if (!name) return;
        var s = st[name];
        if (s && s.k) g.classList.add('rv-mk-' + s.k);
        if (s && s.staged) g.classList.add('rv-mk-staged');
        if (sel && sel === name) g.classList.add('rv-mk-sel');
        n++;
      });
      return n;
    }

    function register() {
      var E = W && W.B68GmEsc; if (!E || typeof E.register !== 'function' || escOff) return;
      escOff = E.register('site.alarm', { priority: 70, isOpen: function () { return lineAlarm && !!get('lineShown'); }, close: function () { lineAlarm = false; redraw(); } });
    }
    register(); applyCostume();
    return { alarm: alarm, alarmPop: alarmPop, tools: tools, stage: stage, states: states, seg: seg, people: people, wrong: wrong, noteMd: noteMd, act: act,
      costume: costume, setCostume: setCostume, applyCostume: applyCostume, line: line, mapMarks: mapMarks, lineAlarm: function () { return lineAlarm; },
      destroy: function () { if (escOff) { escOff(); escOff = null; } } };
  }

  return { create: create, noteMd: noteMd, COSTUME_KEY: COSTUME_KEY };
});
