/* display/kit/stage.js: the new stage's frame (B68Stage), the kit and stage build, KS13 (S1, S3, S7, S10), behind the setting kit.stage.
   In the kit-stage and kit-lookbook bundles (app/routes.js): fetched only while the setting is on (or by the look book). It only defines
   B68Stage when it loads; it reads B68Ui and the page only when it is called. ES5, window.B68Stage in the browser, module.exports under Node.

   THE CONTRACT (KS14, KS15 and KS16 build on it; it only grows):
     B68Stage.plate(o, doc) -> plate | null    THE lower third: the one component for anything written over the art.
         o = { kicker, title, line, edge, timer, side }. Every string goes in as text (B68Ui.node and B68Ui.fill: no markup sink).
         edge   a B68Ui edge name ('accent' 'alarm' 'rules' 'ok' 'caution' 'ink' 'faction-1'..'faction-6' 'out-deal' 'out-mid' 'out-low'
                'out-six' 'out-crit'): a stripe down the plate's left side, meaning what it means everywhere in the kit
         timer  ms, or { ms, endsAt } (epoch ms on this iPad's clock; the caller corrects for the server's): the plate shows m:ss and a bar
                that steps once a second (no CSS animation), and takes itself down at 0
         side   a short word block on the right (KS15's RISKY / STANDARD)
         plate = { el, set(o), clear(), slot(name) -> the [data-ui-slot] element ('kicker' 'title' 'line' 'timer' 'bar' 'side'), onClear(fn) }
         Sizes (stage.css): every line at least 3.3% of the screen's height (kicker and timer 3.4vh, line 3.6vh, title 4.6vh, side 7vh);
         Paper or Night from the data-ui-theme it sits in; an opaque ground, 4.5:1 or better (kit-stage.e2e measures both).
         Where it sits is the caller's: frame.lower() and mapCaption() put it in the lower third inside the inner 90% (5% margins).
     B68Stage.mapCaption(vm, doc) -> element   the map's title and caption ({ title, caption }) as a plate in a dock that keeps the old hooks
         (dp-strip dp-capbar on the dock, dp-strip-title and dp-strip-cap on its lines), so svgStage still ends the drawing where it starts.
     B68Stage.attach(container, host) -> frame  called by display-page.js while B68Kit.ready('stage'); host = { later, clearLater, reduced,
         band() -> the band model, wireMs() -> how long a wire bulletin stands }.
         frame.slot(name)       the idle stage's places, empty until a bundle fills them: 'clock' (top left: KS14's clock and NEXT), 'crew'
                                (top right: KS14's heads), 'roll' (foot left: KS15's last-roll chip), 'clocks' (foot right: KS16's docked clocks)
         frame.lower(o | null)  a plate in the idle stage's lower third, one at a time (a new one replaces the old; null takes it down)
                                -> plate. THE PLATE WINS: while a lower plate is up, the foot slots stand down (both live in the lower third)
         frame.idle() -> bool   the blank stage (the ambient scene) is up
         frame.theme()          'paper' | 'night'
         display-page.js only:  next(vm) (what the next swap brings), swap(old, next, retire) -> true, mission(bandModel), destroy()
     B68Stage.TRANSITIONS = ['cut', 'push', 'wipe', 'alarm']: one meaning each (S7). The display root carries data-stage-tx="<name>" after each.
         push   scene change: a new push replaces another (the slide projector: the new slide shoves the old one off to the left)
         wipe   reveal: the live map updated in place (an svg with the same title as the svg it replaces: rooms or bands opened, markers moved)
         alarm  the site's alarm clock (the mission's hud.alarm) fills: a hard cut to a red field naming it, and a hard cut back. Not a swap:
                display-page.js's applyBand tells the frame. First sight of a full alarm (a reload, the setting turned on) does not fire it
         cut    no transition: the first stage, a redraw, a stage the frame has not seen, and EVERY change under reduced motion (no flash either)
     B68Stage.Pure = { pick, fmt, alarmFull, faultTone, themeOf }: no DOM, for node.

   S1, chrome off: the Full screen button, the status line and the Home Screen hint leave the art (stage.css). A fault shows as one dot in the
   bottom-left corner, red for offline or not signed in, amber for retrying, read from the old status dot's class (a MutationObserver: no new
   poll). The corner is always a target (a quiet B68Ui button, drawn only on a fault): a tap brings the chrome back for 5 seconds.
   S3, the scene caption is the wire: each bulletin the old strip shows (its node stays, hidden, with its hooks and role) is mirrored onto a
   lower plate with its timer. The map caption is mapCaption().
   S10, idle: the ambient scene (held still only by the Scenes setting since IP1, 13/11), the four slots, the lower plate. Nothing on it
   animates (kit-stage.e2e counts running animations in the page and in the scene frames).
   THE SAFE SCENE (KS16 review): while the safe scene (PANIC's test card, Pure.SAFE) is in the ambient layer, the root carries
   data-stage-safe and the idle places and the lower plate stand down (stage.css), so no clock, crew head, docked clock or last roll is left
   on the PANIC screen. Read from the ambient layer's iframes (a MutationObserver: no new poll); it is set the moment the test card's frame
   is made, before it has faded in.
   The stage's theme: data-ui-theme on the display root, 'night' unless the page's stored theme is Paper (data-theme="light"), and
   data-density="distance". Nothing here makes a request. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else if (root) root.B68Stage = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var CHROME_MS = 5000, TX_MS = 320, FLASH_MS = 420;
  var SLOTS = ['clock', 'crew', 'roll', 'clocks'];
  var TRANSITIONS = ['cut', 'push', 'wipe', 'alarm'];
  var EDGE_RE = /^(accent|alarm|rules|ok|caution|ink|faction-[1-6]|out-(deal|mid|low|six|crit))$/;
  var PLATE_SLOTS = ['kicker', 'title', 'line', 'timer', 'bar', 'side'];

  function U() { return W && W.B68Ui; }
  function txt(v, max) { return typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, max || 400) : ''; }
  function now() { return Date.now(); }

  /* ---------- Pure ---------- */
  var Pure = {};
  /* which transition a swap takes: prev = the view the frame last put up (null: it has not seen one), vm = the one coming */
  Pure.pick = function (prev, vm, hasOld, reduced) {
    if (!hasOld || reduced || !prev || !vm) return 'cut';
    if (prev.kind === 'svg' && vm.kind === 'svg' && prev.title && prev.title === vm.title) return 'wipe';
    return 'push';
  };
  /* m:ss, rounded up, so a plate never says 0:00 while it is still up */
  Pure.fmt = function (ms) {
    var s = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
    return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
  };
  /* the band model's alarm, as { key, full, name }; null when there is none */
  Pure.alarmFull = function (m) {
    var a = m && m.alarm;
    if (!a || typeof a !== 'object') return null;
    var size = Number(a.size) || 0, filled = Number(a.filled) || 0;
    return { key: String(a.name || '') + '|' + size, full: size > 0 && filled >= size, name: txt(a.name, 60) };
  };
  /* the old status dot's class -> the fault's tone: 'alarm' (no connection), 'caution' (stale), '' (nothing to say) */
  Pure.faultTone = function (cls) {
    cls = String(cls || '');
    return /(^|\s)dp-dot-bad(\s|$)/.test(cls) ? 'alarm' : /(^|\s)dp-dot-warn(\s|$)/.test(cls) ? 'caution' : '';
  };
  Pure.themeOf = function (pageTheme) { return pageTheme === 'light' ? 'paper' : 'night'; };
  Pure.SAFE = 'testcard';

  /* ---------- the plate ---------- */
  function plate(o, doc) {
    var B = U();
    doc = doc || (W && W.document);
    if (!B || !doc) return null;
    var kids = PLATE_SLOTS.map(function (n) { return { part: 'slot', name: n, tag: n === 'side' || n === 'bar' ? 'div' : 'p', cls: 'stage-plate-' + n }; });
    var el = B.node('card', { tag: 'div', heading: 0, cls: 'stage-plate', kids: kids }, doc);
    var tick = null, endsAt = 0, total = 0, clears = [], gone = false, api;
    function slot(n) { return el.querySelector('[data-ui-slot="' + n + '"]'); }
    var bar = slot('bar');
    if (bar) bar.setAttribute('aria-hidden', 'true');
    function stop() { if (tick !== null) { clearInterval(tick); tick = null; } }
    function paintTimer() {
      var left = Math.max(0, endsAt - now());
      B.fill(el, { timer: Pure.fmt(left) });
      if (bar) bar.style.setProperty('--stage-left', total > 0 ? (left / total).toFixed(3) : '0');
      if (left <= 0) api.clear();
    }
    function set(p) {
      p = p || {};
      B.fill(el, { kicker: txt(p.kicker, 120), title: txt(p.title, 300), line: txt(p.line, 300), side: txt(p.side, 24), timer: '' });
      var keep = String(el.className).split(/\s+/).filter(function (c) { return c && c.indexOf('ui-edge-') !== 0; });
      if (EDGE_RE.test(String(p.edge || ''))) keep.push('ui-edge-' + p.edge);
      el.className = keep.join(' ');
      if (txt(p.side, 24)) el.setAttribute('data-stage-side', ''); else el.removeAttribute('data-stage-side');
      stop();
      var t = p.timer, ms = typeof t === 'number' ? t : t && typeof t === 'object' ? Number(t.ms) : 0;
      if (ms > 0 && !gone) {
        total = ms; endsAt = t && typeof t === 'object' && Number(t.endsAt) > 0 ? Number(t.endsAt) : now() + ms;
        el.setAttribute('data-stage-timed', '');
        tick = setInterval(paintTimer, 1000);
        paintTimer();
      } else { el.removeAttribute('data-stage-timed'); total = 0; endsAt = 0; }
      return api;
    }
    api = {
      el: el, set: set, slot: slot,
      onClear: function (fn) { if (typeof fn === 'function') clears.push(fn); return api; },
      clear: function () {
        if (gone) return;
        gone = true; stop();
        if (el.parentNode) el.parentNode.removeChild(el);
        clears.splice(0).forEach(function (fn) { try { fn(); } catch (e) { /* the next one still runs */ } });
      }
    };
    set(o);
    return api;
  }

  /* the map's caption on a plate, in a dock that keeps the old strip's hooks */
  function mapCaption(vm, doc) {
    doc = doc || (W && W.document);
    var p = plate({ title: vm && vm.title, line: vm && vm.caption }, doc);
    if (!p) return null;
    var dock = doc.createElement('div');
    dock.className = 'dp-strip dp-capbar stage-dock stage-dock-map';
    p.slot('title').classList.add('dp-strip-title');
    p.slot('line').classList.add('dp-strip-cap');
    dock.appendChild(p.el);
    return dock;
  }

  /* ---------- the frame ---------- */
  function attach(container, host) {
    var B = U(), doc = container && container.ownerDocument;
    if (!B || !doc) return null;
    host = host || {};
    var later = typeof host.later === 'function' ? host.later : function (fn, ms) { return setTimeout(fn, ms); };
    var clearLater = typeof host.clearLater === 'function' ? host.clearLater : function (id) { clearTimeout(id); };
    var reduced = typeof host.reduced === 'function' ? host.reduced : function () { return false; };
    var offs = [], timers = [], dead = false, pending = null, shown = null, cur = null, alarm = null, chromeT = null, flashT = null;
    function after(fn, ms) { var id = later(function () { var i = timers.indexOf(id); if (i >= 0) timers.splice(i, 1); if (!dead) fn(); }, ms); timers.push(id); return id; }
    function cancel(id) { if (id === null) return; clearLater(id); var i = timers.indexOf(id); if (i >= 0) timers.splice(i, 1); }
    function listen(t, type, fn) { t.addEventListener(type, fn); offs.push(function () { t.removeEventListener(type, fn); }); }
    function observe(target, fn, opts) {
      if (!target || !W || typeof W.MutationObserver !== 'function') return;
      var mo = new W.MutationObserver(fn); mo.observe(target, opts);
      offs.push(function () { mo.disconnect(); });
    }

    /* the theme and the density, on the display root */
    var html = doc.documentElement;
    function theme() { return Pure.themeOf(html.getAttribute('data-theme')); }
    function paintTheme() { container.setAttribute('data-ui-theme', theme()); }
    container.setAttribute('data-density', 'distance');
    paintTheme();
    observe(html, paintTheme, { attributes: true, attributeFilter: ['data-theme'] });

    /* the frame: the idle stage's four places and its lower third, over the stages and under the overlays */
    var frame = doc.createElement('div'); frame.className = 'stage-frame';
    var idleBox = doc.createElement('div'); idleBox.className = 'stage-idle';
    var slots = {};
    SLOTS.forEach(function (n) { var e = B.node('slot', { name: n, cls: 'stage-slot stage-slot-' + n }, doc); slots[n] = e; idleBox.appendChild(e); });
    var lowerBox = doc.createElement('div'); lowerBox.className = 'stage-lower';
    idleBox.appendChild(lowerBox); frame.appendChild(idleBox);
    var stagesEl = container.querySelector('.dp-stages');
    if (stagesEl && stagesEl.parentNode === container) container.insertBefore(frame, stagesEl.nextSibling); else container.appendChild(frame);

    /* the alarm's flash: a red field with the alarm's name, over everything but the corner */
    var flashEl = doc.createElement('div'); flashEl.className = 'stage-flash'; flashEl.hidden = true; flashEl.setAttribute('aria-hidden', 'true');
    var flashWord = doc.createElement('p'); flashWord.className = 'stage-flash-word'; flashEl.appendChild(flashWord);
    container.appendChild(flashEl);

    /* S1: the corner. A quiet kit button, always a target; the dot inside is drawn only on a fault */
    var fault = B.node('button', { label: '', rank: 'quiet', cls: 'stage-fault', title: 'Connection and full screen',
      attrs: { 'aria-label': 'Show the connection and the full screen button' } }, doc);
    var dot = null, oldDot = container.querySelector('.dp-dot');
    container.appendChild(fault);
    function paintFault() {
      var tone = Pure.faultTone(oldDot && oldDot.className);
      fault.setAttribute('data-stage-fault', tone || 'none');
      var word = tone === 'alarm' ? 'No connection' : tone === 'caution' ? 'Connection trouble' : 'Connected';
      var nd = B.node('dot', { tone: tone || 'idle', title: word }, doc);
      if (dot && dot.parentNode) dot.parentNode.replaceChild(nd, dot); else fault.appendChild(nd);
      dot = nd;
    }
    paintFault();
    observe(oldDot, paintFault, { attributes: true, attributeFilter: ['class'] });
    function chrome() {
      container.classList.add('stage-chrome');
      cancel(chromeT);
      chromeT = after(function () { chromeT = null; container.classList.remove('stage-chrome'); }, CHROME_MS);
    }
    listen(fault, 'click', chrome);

    /* the lower plate: one at a time, and it wins over the foot slots */
    function lower(o, tag) {
      if (cur) { var c = cur; cur = null; c.clear(); }
      frame.classList.remove('stage-lower-on');
      if (!o || dead) return null;
      var p = plate(o, doc);
      if (!p) return null;
      p.el.setAttribute('role', 'status');
      if (tag) p.el.setAttribute('data-stage-caption', tag);
      lowerBox.appendChild(p.el); cur = p; frame.classList.add('stage-lower-on');
      p.onClear(function () { if (cur === p) { cur = null; frame.classList.remove('stage-lower-on'); } });
      return p;
    }

    /* S3: the scene caption is the wire. Its old node (hidden by stage.css) keeps toggling; each bulletin it shows goes on a lower plate */
    var wire = container.querySelector('.dp-wire'), wireUp = null;
    function wireSeen() {
      var t = wire && wire.classList.contains('dp-wire-on') ? txt(wire.textContent) : '';
      if (t) {
        if (!wireUp || wireUp.text !== t) {
          var ms = typeof host.wireMs === 'function' ? Number(host.wireMs()) || 0 : 0;
          wireUp = { text: t, plate: null };
          wireUp.plate = lower({ kicker: 'Wire', title: t, timer: ms }, 'wire');
        }
      } else if (wireUp) {
        if (wireUp.plate && wireUp.plate === cur) lower(null);
        wireUp = null;
      }
    }
    observe(wire, wireSeen, { attributes: true, attributeFilter: ['class'], childList: true, characterData: true, subtree: true });
    wireSeen();

    /* the safe scene (PANIC's test card) is in the ambient layer: the idle places stand down */
    var ambEl = container.querySelector('.dp-ambient');
    function safeSeen() {
      var on = !!ambEl && !!ambEl.querySelector('iframe[data-scene="' + Pure.SAFE + '"]');
      if (on) container.setAttribute('data-stage-safe', ''); else container.removeAttribute('data-stage-safe');
    }
    observe(ambEl, safeSeen, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-scene'] });
    safeSeen();

    /* idle: the blank stage is up */
    function setIdle(on) { container.classList.toggle('stage-idle-on', !!on); }
    var lastStage = stagesEl ? stagesEl.lastElementChild : null;
    setIdle(!!lastStage && lastStage.classList.contains('dp-blank'));

    /* S7: the swap. The display page has already put next in the stages and in its list; retire(old) takes a stage away for good */
    var gone = [];
    function retireOnce(retire, st) { if (!st || gone.indexOf(st) >= 0) return; gone.push(st); if (gone.length > 8) gone.shift(); retire(st); }
    function swap(old, next, retire) {
      var vm = pending; pending = null;
      var how = Pure.pick(shown, vm, !!old, reduced());
      shown = vm || null;
      setIdle(!!next && !!next.el && next.el.classList.contains('dp-blank'));
      container.setAttribute('data-stage-tx', how);
      if (how === 'cut') {
        next.el.classList.add('dp-in');
        if (old) { old.el.classList.remove('dp-in'); retireOnce(retire, old); }
        return true;
      }
      next.el.classList.add('dp-in', 'stage-in-' + how);
      old.el.classList.remove('dp-in'); old.el.classList.add('dp-out', 'stage-out-' + how);
      var run = { done: function () { var i = moving.indexOf(run); if (i >= 0) moving.splice(i, 1); next.el.classList.remove('stage-in-' + how); retireOnce(retire, old); } };
      moving.push(run);
      after(run.done, TX_MS + 60);
      return true;
    }
    var moving = [];      /* the swaps still moving: destroy() lands them at once, so no old stage is left behind */

    /* the alarm: the site's alarm clock fills */
    function flash(name) {
      container.setAttribute('data-stage-tx', 'alarm');
      if (reduced()) return;
      flashWord.textContent = name || 'Alarm';
      flashEl.hidden = false;
      cancel(flashT);
      flashT = after(function () { flashT = null; flashEl.hidden = true; }, FLASH_MS);
    }
    /* only the same alarm going from not full to full: a full alarm seen first (a reload, the setting turned on) is not a fill */
    function mission(m) {
      var a = Pure.alarmFull(m);
      if (a && a.full && alarm && !alarm.full && alarm.key === a.key) flash(a.name);
      alarm = a;
    }
    mission(typeof host.band === 'function' ? host.band() : null);

    return {
      slot: function (n) { return SLOTS.indexOf(n) >= 0 ? slots[n] : null; },
      lower: function (o) { return lower(o, ''); },
      idle: function () { return container.classList.contains('stage-idle-on'); },
      theme: theme,
      next: function (vm) { pending = vm && typeof vm === 'object' ? { kind: vm.kind, title: vm.title || '' } : null; },
      swap: swap,
      mission: mission,
      destroy: function () {
        if (dead) return;
        if (cur) { var c = cur; cur = null; c.clear(); }
        moving.slice().forEach(function (r) { r.done(); });
        dead = true;
        timers.splice(0).forEach(function (id) { clearLater(id); });
        offs.splice(0).forEach(function (f) { try { f(); } catch (e) { /* the rest still go */ } });
        [frame, flashEl, fault].forEach(function (e) { if (e.parentNode) e.parentNode.removeChild(e); });
        ['data-ui-theme', 'data-density', 'data-stage-tx', 'data-stage-safe'].forEach(function (a) { container.removeAttribute(a); });
        container.classList.remove('stage-chrome', 'stage-idle-on');
        Array.prototype.forEach.call(container.querySelectorAll('.stage-in-push, .stage-in-wipe, .stage-out-push, .stage-out-wipe'), function (e) {
          e.classList.remove('stage-in-push', 'stage-in-wipe', 'stage-out-push', 'stage-out-wipe');
        });
      }
    };
  }

  return { VERSION: 1, TRANSITIONS: TRANSITIONS.slice(), SLOTS: SLOTS.slice(), plate: plate, mapCaption: mapCaption, attach: attach, Pure: Pure };
});
