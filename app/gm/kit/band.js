/* gm/kit/band.js: the band on the new desk (kit.desk, KS05 of the kit and stage build). In the kit-desk bundle: fetched only while the setting is
   on. It defines B68KitBand when it loads and reads other modules only when it is called (the kit's load-order rule), so it may arrive before the
   GM page's own bundle.

   The band (app/gm/band.js) asks this file at a few points, one line each, and runs its old code whenever on() is false:
     mount     skeleton(o) in place of its own: the same ids, data-* hooks and old class names, laid out as the design's two rows; then wire()
     update    places(nav, chips) paints the phase tabs; the wire's update() follows the Blade panel's count
     the tray  gm/ipad-tray.js asks tray() to build its parts (the same part nodes, classes and data-tray hooks) when its slot is in this band
     the cue   gm/cue-stack.js asks cueHtml() for its face when its slot is in this band (the same data-cs hooks; the ⋯ popover is its own)
   Row 1, where you are: the mark, the session chip, the who chip (#gm-bar-who: empty and hidden until night.who fills it, KS12), the phase tabs
     (an underline; the place on screen is selected, the night's phase has a dot), the Blade button (key A: the panel's own toggle, with the count
     of waiting cards and the pips of the hidden right-edge tab, #as-launch, KS07), the Listening chip, the curfew, the clock and PANIC (the one
     Danger on the page).
   Row 2, what is live: the iPad's state as one chip with Clear (0) inside it, Send (n) while rooms are staged, a quiet Blank (true black on the
     iPad), the autopilot, the curfew's buttons when it is due, the beat, the music and the quiet line; then the cue unit: STANDBY with the cue,
     GO (the band's one Primary, Space or PgDn), a quiet Next (the cue stack's Bypass) and ⋯; then the save state, Find, Crew and the Menu.
   Both rows are dark in Paper and in Night (data-ui-theme="night"), as the mock and today's band are.

   start() follows B68Kit: when the desk turns on (its bundle here) or off, every live band (B68GmBand.live()) draws the other skeleton and asks
   the page to paint its parts again (band.follow()).
   API (window.B68KitBand; module.exports under Node)
     on() -> bool                 the desk is on, its bundle is here, and the UI kit is here
     skeleton(o) -> string        o: { menu (the page's Menu lines, markup it built), signed (text) }
     places(nav, chips)           the phase tabs into the band's nav (chips: B68GmBand.chips())
     wire(el, host) -> { update(), destroy() }    the Blade button: its click, and the count, pips and state copied from #as-launch
     tray(slot, doc, box, part) -> bool           the iPad tray's parts, when slot is in a kit band; false leaves it to the tray
     cueHtml(v, c) -> string      v: the cue stack's view(); c: { more, label(cue), manual: { kind: 1 }, pop (its ⋯ popover, markup it built) }
     inBand(node) -> bool         node sits in a kit band
     start()                      once, when the file loads in a page */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root && root.document && !root.B68KitBand) { root.B68KitBand = M; M.start(); }
})(typeof window !== 'undefined' ? window : null, function (W) {
  'use strict';

  var MID = ' · ', X = '✕', ELL = '⋯';
  var PIP = { rule: 1, warn: 1, done: 1, idea: 1, say: 1, note: 1 };
  var listening = false, packToasted = false;      /* the pack's toast: once per load (the dot, its word and the Menu's dot stay) */

  function str(v) { return v == null ? '' : String(v); }
  function req(name) { try { return typeof require === 'function' ? require(name) : null; } catch (e) { return null; } }
  function Ui() { return (W && W.B68Ui) || req('../../ui/ui.js'); }
  function on() {
    var K = W && W.B68Kit, U = W && W.B68Ui;
    return !!(K && typeof K.ready === 'function' && K.ready('desk') && U && typeof U.node === 'function');
  }
  function inBand(n) { return !!(n && typeof n.closest === 'function' && n.closest('.kband-r')); }
  function later(fn) { if (W && typeof W.setTimeout === 'function') W.setTimeout(fn, 0); else fn(); }

  /* ---------- the skeleton: every id, data-* hook and old class of band.js skeleton(), in the design's two rows ---------- */
  var T = {
    home: 'Home', sess: 'The session: the table’s counter', who: 'Who is here',
    blade: 'Blade (A): the panel, with the cards waiting', stt: 'The mic: listening (opens the iPad view)',
    panic: 'PANIC: the safe scene on the iPad, its sound down, and the work light (Esc, when nothing is open)',
    call: 'End the score: the night moves to the Aftermath and its show starts', keep: 'Dismiss this for tonight; Next works as normal',
    snooze: 'Ask again in ten minutes (once)', beat: 'The beat running (the Prep run order)', beatNext: 'Start the next beat in the run order',
    find: 'Find anything: prep, the screen, NPCs, clocks, what you filed (Ctrl+K or /)',
    crew: 'Clocks and the crew: the table, the crew sheet and each character’s sheet (W)'
  };
  function skeleton(o) {
    o = o || {};
    var U = Ui();
    var r1 = '<div class="gm-band-r gm-band-r1 kband-r kband-r1" role="group" aria-label="Where you are" data-ui-theme="night">' +
      '<a class="gm-band-mark kband-mark" href="#" title="' + T.home + '">’68 <b>GM</b></a>' +
      U.chip({ id: 'gm-bar-sess', cls: 'gm-bar-sess kband-sess', title: T.sess }) +
      U.chip({ button: true, id: 'gm-bar-who', cls: 'kband-who', title: T.who }) +
      '<nav class="gm-band-places kband-places" aria-label="Places of the night" data-band-places></nav>' +
      '<span class="gm-band-grow"></span>' +
      '<span class="kband-bladebox">' +
        U.button({ label: 'Blade', key: 'A', cls: 'kband-blade', data: { band: 'blade' }, title: T.blade, attrs: { 'aria-controls': 'as-panel', 'aria-expanded': 'false' } }) +
        '<span class="kband-count" data-band-count hidden></span><span class="kband-pips" data-band-pips aria-hidden="true"></span></span>' +
      '<span class="gm-band-sep gm-band-sep-mic kband-sep-mic" aria-hidden="true"></span>' +
      '<span class="gm-band-mic kband-mic">' + U.chip({ button: true, id: 'gm-bar-stt', cls: 'gm-pill', data: { gm: 'ipadview' }, title: T.stt, hidden: true }) + '</span>' +
      '<span class="gm-band-clock kband-clock"><small data-band-curfew></small><b data-band-clock></b></span>' +
      U.button({ label: 'PANIC', rank: 'danger', key: 'Esc', cls: 'gm-band-panic kband-panic', data: { band: 'panic' }, title: T.panic }) +      /* the hint only: Esc stays the page's own (B68GmEsc first) */
      '</div>';
    var r2 = '<div class="gm-band-r gm-band-r2 kband-r kband-r2" role="group" aria-label="What is live" data-alarm="" data-ui-theme="night">' +
      '<span class="gm-band-tray kband-tray" id="gm-bar-tray" data-band-slot="tray"></span>' +
      '<span class="gm-band-due kband-due" data-band-due hidden>' +
        U.button({ label: 'Call the Aftermath', cls: 'gm-band-call', data: { band: 'call' }, title: T.call }) +
        U.button({ label: 'Keep running', rank: 'quiet', cls: 'gm-band-soft', data: { band: 'keep' }, title: T.keep }) +
        U.button({ label: 'Snooze 10 min', rank: 'quiet', cls: 'gm-band-soft', data: { band: 'snooze' }, title: T.snooze }) + '</span>' +
      '<span class="gm-beatbar kband-beat" id="gm-bar-beat" hidden>' +
        U.chip({ button: true, id: 'gm-bar-beatgo', cls: 'gm-pill gm-beat', data: { gm: 'beat-go' }, title: T.beat }) +
        U.button({ label: 'Next beat ›', rank: 'quiet', cls: 'gm-bb gm-bb-ghost gm-band-next', data: { gm: 'beat-next' }, title: T.beatNext }) + '</span>' +
      '<span class="gm-band-music kband-music" data-band-slot="music"></span>' +
      '<span class="gm-band-quiet kband-quiet" data-band-slot="quiet"></span>' +
      '<span class="gm-band-grow"></span>' +
      '<span class="gm-band-cue kband-cue" id="gm-cuebar" data-band-slot="cue" role="group" aria-label="Cue stack"></span>' +
      '<span class="gm-band-sep kband-sep" aria-hidden="true"></span>' +
      '<span class="kband-tools">' +
        '<span class="kband-status" data-band-status tabindex="0" hidden></span>' +
        '<span class="gm-save kband-save" role="status"></span>' +
        U.button({ label: 'Find', rank: 'quiet', cls: 'gm-bb gm-bb-ghost gm-band-find', data: { gm: 'find-open' }, title: T.find }) +
        U.button({ label: 'Crew', rank: 'quiet', id: 'gm-bar-drawer', cls: 'gm-bb gm-bb-ghost gm-dwbtn', data: { gm: 'drawer' }, title: T.crew,
          attrs: { 'aria-expanded': 'false', 'aria-controls': 'gm-drawer' } }) +
        '<span class="gm-menu kband-menu">' +
          U.button({ label: 'Menu', rank: 'quiet', cls: 'gm-bb gm-bb-ghost gm-band-menu', data: { gm: 'menu' }, attrs: { 'aria-expanded': 'false', 'aria-haspopup': 'true' } }) +
          '<i class="gm-band-mdot kband-mdot" id="gm-bar-exp" hidden></i>' +
          '<span class="gm-menu-list" hidden>' + str(o.menu) + '</span></span>' +
      '</span>' +
      '<div class="gm-signed kband-signed" id="gm-signed" role="alert" hidden>' + U.esc(o.signed) + '</div>' +
      '</div>';
    return r1 + r2;
  }

  /* ---------- the phase tabs: B68Ui's Tabs, each keeping the old chip's hooks and its two parts (the name, the minutes) ---------- */
  function places(nav, chips) {
    var U = Ui(), doc = nav && nav.ownerDocument; if (!U || !doc) return;
    var list = Array.isArray(chips) ? chips : [];
    var row = U.node('tabs', { label: 'Places of the night', cls: 'kband-tabs', items: list.map(function (c) {
      return { label: c.label, value: c.id, selected: !!c.selected, title: c.title,
        cls: ['gm-place', 'kband-place'].concat(c.between ? ['gm-place-btw'] : []),
        data: { 'band-place': c.id, state: c.phase ? c.state : null, tone: c.tone || null },
        attrs: { 'aria-current': c.selected ? 'true' : 'false', tabindex: '0' } };
    }) }, doc);
    var tabs = row ? row.children : [];
    for (var i = 0; i < tabs.length && i < list.length; i++) {
      var b = tabs[i], n = doc.createElement('span'), t = doc.createElement('span');
      n.className = 'gm-place-n'; n.textContent = str(list[i].label);
      t.className = 'gm-place-t'; t.textContent = str(list[i].text);
      while (b.firstChild) b.removeChild(b.firstChild);
      b.appendChild(n); b.appendChild(t);
    }
    while (nav.firstChild) nav.removeChild(nav.firstChild);
    if (row) nav.appendChild(row);
  }

  /* ---------- the Blade button: the panel's own toggle (as key A), and what the hidden tab says ---------- */
  function wire(el, host) {
    var doc = el && el.ownerDocument, dead = false, watched = null, obs = null;
    if (!doc) return { update: function () {}, destroy: function () {} };
    function q(sel) { return el.querySelector(sel); }
    function launch() { return doc.getElementById('as-launch'); }
    function paint() {
      if (dead) return;
      var l = launch(), b = q('[data-band="blade"]'), cnt = q('[data-band-count]'), pp = q('[data-band-pips]'); if (!b) return;
      var lc = l && l.querySelector('#as-count'), n = lc && !lc.hidden ? str(lc.textContent).trim() : '';
      if (cnt) { if (cnt.textContent !== n) cnt.textContent = n; cnt.hidden = !n; }
      var exp = l ? str(l.getAttribute('aria-expanded')) === 'true' : false;
      if (b.getAttribute('aria-expanded') !== String(exp)) b.setAttribute('aria-expanded', String(exp));
      if (exp && held.pack) toastOn('pack', false);      /* the panel opened: the pack's toast leaves its foot (the dot keeps the warning) */
      var lab = l ? str(l.getAttribute('aria-label')) : '';
      if (lab && b.getAttribute('aria-label') !== lab) b.setAttribute('aria-label', lab);
      if (pp) {
        var kinds = l ? [].slice.call(l.querySelectorAll('.as-pip')).map(function (i) { return str(i.getAttribute('data-kind')); }).filter(function (k) { return PIP[k]; }) : [];
        if (pp.getAttribute('data-sig') !== kinds.join(',')) {
          pp.setAttribute('data-sig', kinds.join(','));
          while (pp.firstChild) pp.removeChild(pp.firstChild);
          kinds.forEach(function (k) { var i = doc.createElement('i'); i.className = 'kband-pip'; i.setAttribute('data-kind', k); pp.appendChild(i); });
        }
      }
    }
    function watch() {
      var l = launch(); if (l === watched) return;
      if (obs) { try { obs.disconnect(); } catch (e) {} obs = null; }
      watched = l;
      var MO = W && W.MutationObserver;
      if (l && typeof MO === 'function') {
        obs = new MO(paint);
        obs.observe(l, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'aria-label', 'aria-expanded', 'data-kind'] });
      }
    }
    function onClick(ev) {
      var t = ev && ev.target, b = t && t.closest ? t.closest('[data-band="blade"]') : null;
      if (!b || !el.contains(b) || dead) return;
      var l = launch();
      if (l && typeof l.click === 'function') l.click();      /* the tab's own data-as="toggle": what key A does (S.assist.toggle) */
      else if (host && typeof host.toast === 'function') host.toast('Blade is not available on this page.', true);
      paint();
    }
    /* KS05.3: the save state, signed out and the pack's warnings as one status dot (with a word beside it when something is wrong), and a toast
       for what needs a decision (the overlay kit's B68Ui.toast, KS03). Without the toast stack the old lines stay as they were. The page keeps
       painting .gm-save, #gm-signed, #gm-band.out, #gm-bar-exp and #gm-menu-warn: this reads them. */
    var U = Ui(), r2 = q('.kband-r2'), stEl = q('[data-band-status]'), toasts = !!(U && typeof U.toast === 'function' && r2 && stEl);
    var held = {}, stSig = '', bandObs = null;
    if (toasts) { r2.setAttribute('data-band-toasts', ''); stEl.hidden = false; stEl.removeAttribute('hidden'); }
    function toastOn(key, on, o) {
      if (!on) { if (held[key]) { try { held[key].dismiss(); } catch (e) {} held[key] = null; } return; }
      if (held[key]) return;
      try { held[key] = U.toast(Object.assign({ key: 'kband-' + key }, o)); } catch (e) { held[key] = null; }
    }
    function status() {
      if (dead || !toasts) return;
      var save = q('.gm-save'), exp = q('#gm-bar-exp'), warn = q('#gm-menu-warn'), sig = q('#gm-signed');
      var sv = save ? str(save.textContent).trim() : '', bad = !!(save && save.classList.contains('bad')), out = !!(el.classList && el.classList.contains('out'));
      var pack = exp && !exp.hidden ? str(exp.getAttribute('aria-label') || '') : '', check = !!(warn && !warn.hidden);
      var outMsg = sig ? str(sig.textContent).trim() : 'Signed out';
      var tone = out || bad ? 'alarm' : pack || check ? 'caution' : sv === 'Saved' ? 'ok' : sv ? 'live' : 'idle';
      var word = out ? 'Signed out' : bad ? sv : pack ? (/offline/i.test(pack) && !/days/.test(pack) ? 'Offline copy' : 'Old pack') : check ? 'Pack check' : '';      /* the whole is in the title and the toast */
      var lines = [out ? outMsg : bad ? sv + (save && save.title ? ': ' + save.title : '') : sv || 'Nothing to save yet'];
      if (pack) lines.push(pack + ': the Menu says more');
      if (check) lines.push('Pack check: rolls use a neutral word for some table entries. The Menu lists them.');
      var key = JSON.stringify([tone, word, lines]);
      if (key !== stSig) {
        stSig = key;
        stEl.innerHTML = U.dot({ tone: tone, label: word, title: lines.join('. ') });
        stEl.setAttribute('data-tone', tone); stEl.setAttribute('title', lines.join('. ')); stEl.setAttribute('aria-label', lines.join('. '));
      }
      toastOn('out', out, { text: outMsg, tone: 'error', undo: { label: 'Reload', fn: function () { try { W.location.reload(); } catch (e) {} } } });
      toastOn('save', bad && !out, { text: sv + (save && save.title ? ': ' + save.title : ''), tone: 'error' });
      /* the pack's toast fades (an info toast's own time), once per load, and never over an open Blade panel (its Ask box and Tools sit where the
         stack is): the dot, its word and the Menu's dot carry the warning after it */
      var l = launch(), panel = !!(l && str(l.getAttribute('aria-expanded')) === 'true');
      if (pack && !packToasted && !panel) {
        packToasted = true;
        try { held.pack = U.toast({ key: 'kband-pack', text: pack + ': the Menu says more (Update pack).', tone: 'info',
          undo: { label: 'Menu', fn: function () { var m = q('[data-gm="menu"]'); if (m && typeof m.click === 'function') m.click(); } } }); } catch (e) { held.pack = null; }
      } else if (held.pack && (!pack || panel)) toastOn('pack', false);
    }
    /* KS12's who chip (night.who): "S9 · 4 playing" in one chip, so the seven places keep their room at 1366 px. The session chip steps aside;
       its words stay the page's (renderBar), the who chip's stay KS12's: this only copies the short session onto the who chip (CSS draws it) */
    function who() {
      if (dead) return;
      var r1 = q('.kband-r1'), s = q('#gm-bar-sess'), w = q('#gm-bar-who'); if (!r1 || !s || !w) return;
      var st = str(s.textContent).trim(), short = st && str(w.textContent).trim() ? st.replace(/^Session\s+(\d+)/, 'S$1') : '';
      if (short) {
        if (w.getAttribute('data-sess') !== short) w.setAttribute('data-sess', short);
        if (!r1.hasAttribute('data-band-who')) r1.setAttribute('data-band-who', '');
      } else {
        if (w.hasAttribute('data-sess')) w.removeAttribute('data-sess');
        if (r1.hasAttribute('data-band-who')) r1.removeAttribute('data-band-who');
      }
    }
    function both() { status(); who(); }
    if (W && typeof W.MutationObserver === 'function') {
      bandObs = new W.MutationObserver(both);
      bandObs.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'hidden', 'aria-label', 'title'] });
    }
    el.addEventListener('click', onClick);
    watch(); paint(); both();
    return {
      update: function () { if (!dead) { watch(); paint(); both(); } },
      destroy: function () {
        dead = true; el.removeEventListener('click', onClick);
        if (obs) { try { obs.disconnect(); } catch (e) {} } obs = null; watched = null;
        if (bandObs) { try { bandObs.disconnect(); } catch (e) {} } bandObs = null;
        Object.keys(held).forEach(function (k) { if (held[k]) { try { held[k].dismiss(); } catch (e) {} } }); held = {};
        if (r2) r2.removeAttribute('data-band-toasts');
      }
    };
  }

  /* ---------- the iPad tray as one chip with Clear inside, a quiet Blank (gm/ipad-tray.js keeps painting the same part nodes) ---------- */
  function tray(slot, doc, box, part) {
    if (!on() || !inBand(slot) || !doc || !box || !part) return false;
    var U = Ui();
    var mk = function (name, o) { return U.node(name, o, doc); };
    box.className = 'gm-tray kband-traybox';
    var chip = doc.createElement('span'); chip.className = 'kband-ipad';
    part.live = mk('chip', { button: true, cls: 'gm-tray-live kband-ipad-live', data: { tray: 'open' } });
    while (part.live.firstChild) part.live.removeChild(part.live.firstChild);
    part.dot = doc.createElement('span'); part.dot.className = 'gm-dot';
    var lbl = doc.createElement('span'); lbl.className = 'gm-tray-lbl'; lbl.textContent = 'iPad'; lbl.setAttribute('aria-hidden', 'true');
    part.text = doc.createElement('span'); part.text.className = 'gm-tray-text';
    part.live.appendChild(part.dot); part.live.appendChild(lbl); part.live.appendChild(part.text);
    part.clear = mk('button', { label: X, key: '0', rank: 'quiet', cls: 'gm-bb gm-tray-clear kband-clear', data: { tray: 'clear' },
      title: 'Clear (0): everything down to the ambient scene. The phase, the PC faces and security stay', attrs: { 'aria-label': 'Clear the iPad (0)' } });
    chip.appendChild(part.live); chip.appendChild(part.clear);
    box.appendChild(chip);
    part.send = mk('button', { label: 'Send ', cls: 'gm-bb gm-tray-send', data: { tray: 'send' } });
    part.count = doc.createElement('b'); part.count.textContent = '0'; part.send.appendChild(part.count);
    box.appendChild(part.send);
    part.blank = mk('button', { label: 'Blank', rank: 'quiet', cls: 'gm-bb gm-tray-blank', data: { tray: 'blank' }, title: 'True black on the iPad until the next send' });
    box.appendChild(part.blank);
    part.ap = mk('chip', { button: true, cls: 'gm-pill gm-ap gm-tray-ap', data: { tray: 'ap' } });
    box.appendChild(part.ap);
    return true;
  }

  /* ---------- the cue unit: STANDBY and the cue, GO, a quiet Next (Bypass), ⋯ ---------- */
  function cueHtml(v, c) {
    var U = Ui(); v = v || {}; c = c || {};
    var more = c.more ? 'true' : 'false', pop = str(c.pop);
    var dots = U.button({ label: ELL, rank: 'quiet', cls: 'gm-cs-more kband-cs-more', data: { cs: 'more' }, title: 'Back, Start again, what comes next and the last cue fired',
      attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': more, 'aria-label': 'The cue stack: Back, Start again, what comes next' } });
    if (v.panic) {
      var say = 'The iPad is on the safe scene (' + str(v.safe) + ') and its sound is down. Put the work light on in the room.';
      return '<span class="kband-cue-what"><span class="gm-cs-tag gm-cs-alarm kband-cs-tag" role="alert">WORK LIGHT UP</span>' +
        '<span class="gm-cs-txt kband-cs-txt" title="' + U.esc(say) + '">' + U.esc(say) + '</span></span>' +
        U.button({ label: 'Resume', cls: 'gm-cs-resume', data: { cs: 'resume' }, title: 'Put the iPad’s scene back' });
    }
    var s = v.standby;
    if (s) {
      var lab = typeof c.label === 'function' ? str(c.label(s)) : str(s.text);
      var hand = c.manual && c.manual[s.kind] ? '<span class="gm-cs-hand kband-hand">' + MID + 'by hand</span>' : '';      /* in the line, so it gives way before it covers GO */
      return '<span class="kband-cue-what"><span class="kband-cs-head"><span class="gm-cs-tag kband-cs-tag"><span class="kband-cs-sb">STANDBY' + MID + '</span>#' + U.esc(s.n) + ' ' + U.esc(str(s.kind).toUpperCase()) + hand + '</span></span>' +
        U.button({ label: str(s.text) || lab, rank: 'quiet', cls: 'gm-cs-what kband-cs-what', data: { cs: 'more' }, title: lab, attrs: { 'aria-expanded': more } }) + '</span>' +
        U.button({ label: 'GO', rank: 'primary', key: 'Space', cls: 'gm-cs-go kband-go', data: { cs: 'go' }, title: 'Fire the cue in standby (Space or PgDn)' }) +
        U.button({ label: 'Next ›', rank: 'quiet', cls: 'gm-cs-soft kband-cs-next', data: { cs: 'bypass' }, title: 'Skip this cue without firing it: the next one stands by (Bypass)' }) +
        dots + pop;
    }
    return '<span class="kband-cue-what"><span class="gm-cs-tag gm-cs-idle kband-cs-tag">' + (v.total ? 'ALL DONE' : 'NO CUES') + '</span>' +
      '<span class="gm-cs-txt gm-cs-dim kband-cs-txt">' + (v.total ? 'Every cue fired or bypassed' : 'No Cues in this note') + '</span></span>' + dots + pop;
  }

  /* ---------- following the setting ---------- */
  function sync() {
    var B = W && W.B68GmBand; if (!B || typeof B.live !== 'function') return;
    B.live().forEach(function (b) { try { if (b && typeof b.follow === 'function') b.follow(); } catch (e) { /* one band failing never stops the rest */ } });
  }
  function start() {
    if (listening || !W || !W.B68Kit || typeof W.B68Kit.onChange !== 'function') return;
    listening = true;
    W.B68Kit.onChange(function (ev) { if (ev && ev.name === 'desk') later(sync); });
    later(sync);      /* no replay: a band drawn before this file arrived follows now */
  }

  return { on: on, inBand: inBand, skeleton: skeleton, places: places, wire: wire, tray: tray, cueHtml: cueHtml, start: start, sync: sync };
});
