/* The look book's loader (app/lookbook.html, suite F6). GM only: it asks /api/me and draws nothing for anyone else. The page is not linked from the
   app; the GM opens it by address. Its scripts are the `lookbook` bundle (app/routes.js): a later bundle that adds a show kind lists its
   renderer file there; the kit's look book files are the `kit-lookbook` bundle. This file is external (not inline) so the page stays clean under the report-only CSP (script-src 'self'). */
(function () {
  'use strict';
  var root = document.getElementById('lookbook');
  function denied() {
    root.textContent = '';
    var d = document.createElement('p'); d.className = 'lb-denied'; d.textContent = 'GM only.'; root.appendChild(d);
  }
  /* the kit and stage build: the UI kit and the new stage's files (the kit-lookbook bundle, routes.js), with every kit's token on this
     page's <html> (this page has no kit flag: it shows every kit). A kit that fails to load leaves the look book as it was */
  function kit() {
    return window.B68Load.need('kit-lookbook').then(function () { document.documentElement.setAttribute('data-kit', 'desk stage phone'); }, function () {});
  }
  function addScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = function () { reject(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  /* ---------- the UI kit's section (KS02): every token and every part from the manifest (B68Ui.PARTS), Paper and Night side by side
     (data-ui-theme on each column), in desk or distance density (data-density on the section). The controls are kit parts. A preset for
     pictures: lookbook.html#kit=night,distance (any of both, paper, night; desk, distance). ---------- */
  var COLOURS = [
    ['Ground and ink', ['surface', 'raised', 'sunk', 'ink', 'ink-soft', 'ink-faint', 'on-ink', 'line']],
    ['Signals', ['accent', 'on-accent', 'accent-ink', 'rules', 'on-rules', 'alarm', 'on-alarm', 'ok', 'caution', 'focus', 'shadow']]
  ];
  var OUTS = [['deal', 'Deal'], ['mid', '4/5'], ['low', '1-3'], ['six', '6'], ['crit', 'Crit']];
  var TYPES = ['label', 'body', 'lead', 'title', 'display'];
  var MOTION = ['quick', 'base', 'slow', 'cut'];
  var LAYERS = ['base', 'sticky', 'popover', 'dialog', 'toast', 'alarm'];
  /* how the look book shows each state of a part (hover and focus by the demo classes, which take the same rules) */
  var STATE = { hover: { cls: 'ui-demo-hover' }, 'focus-visible': { cls: 'ui-demo-focus' }, pressed: { pressed: true }, disabled: { disabled: true }, busy: { busy: true } };

  function css() {
    var r = [
      '.lb-kit { padding: 8px 20px 24px; }',
      '.lb-kit-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; padding: 8px 0 16px; }',
      '.lb-kit-bar h2 { margin: 0 12px 0 0; font: 900 28px/1.1 var(--ui-font-cond); text-transform: uppercase; letter-spacing: .04em; }',
      '.lb-kit-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 0; border: var(--ui-rule); }',
      '.lb-kit[data-density="distance"] .lb-kit-cols { grid-template-columns: minmax(0, 1fr); }',
      '.lb-kit[data-lb-theme="paper"] [data-ui-theme="night"], .lb-kit[data-lb-theme="night"] [data-ui-theme="paper"] { display: none; }',
      '.lb-kit-col { min-width: 0; padding: var(--ui-space-5) var(--ui-space-5) var(--ui-space-6); background: var(--ui-surface); color: var(--ui-ink); }',
      '.lb-kit-col > h3 { margin: 0 0 var(--ui-space-4); font: 900 var(--ui-type-title)/1 var(--ui-font-cond); text-transform: uppercase; letter-spacing: .02em; }',
      '.lb-kit-col > h4 { margin: var(--ui-space-6) 0 var(--ui-space-3); color: var(--ui-ink-soft); font: 700 var(--ui-type-label)/1.3 var(--ui-font-text);',
      '  letter-spacing: .16em; text-transform: uppercase; }',
      '.lb-kit-col > h4 b { color: var(--ui-ink); }',
      '.lb-kit-col p.lb-dd { margin: calc(-1 * var(--ui-space-2)) 0 var(--ui-space-3); color: var(--ui-ink-soft); font: 400 var(--ui-type-label)/1.4 var(--ui-font-text); }',
      '.lb-kit-col code { font: 400 var(--ui-type-label)/1.3 var(--ui-font-mono); color: var(--ui-ink-soft); overflow-wrap: anywhere; }',
      '.lb-ex { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--ui-space-4) var(--ui-space-4); }',
      '.lb-ex.lb-wide { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 18em), 1fr)); align-items: start; }',
      '.lb-kit[data-density="distance"] .lb-ex.lb-wide { grid-template-columns: repeat(auto-fill, minmax(min(100%, 32em), 1fr)); }',
      '.lb-wide .lb-fig, .lb-wide .lb-fig > div { width: 100%; min-width: 0; }',
      '.lb-ex.lb-list { display: grid; gap: 0; }',
      '.lb-ex + .lb-ex { margin-top: var(--ui-space-5); }',
      '.lb-fig { display: grid; gap: var(--ui-space-1); justify-items: start; margin: 0; min-width: 0; }',
      '.lb-list .lb-fig { justify-items: stretch; }',
      '.lb-list .lb-fig.lb-open { padding-bottom: 9em; }',
      '.lb-fig figcaption { color: var(--ui-ink-faint); font: 400 var(--ui-type-label)/1.3 var(--ui-font-mono); }',
      '.lb-grid { display: grid; justify-content: start; grid-template-columns: auto repeat(3, max-content); gap: var(--ui-space-3) var(--ui-space-4); align-items: center; overflow-x: auto; padding: 6px; }',
      '.lb-grid > span { color: var(--ui-ink-faint); font: 400 var(--ui-type-label)/1.3 var(--ui-font-mono); }',
      '.lb-sws { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 15em), 1fr)); gap: var(--ui-space-2) var(--ui-space-3); }',
      '.lb-sw { display: grid; grid-template-columns: 2.4rem 1fr; gap: 0 var(--ui-space-2); align-items: center; min-width: 0; }',
      '.lb-sw > span:first-child { grid-row: span 2; display: grid; place-items: center; width: 2.4rem; height: 2.4rem; border: var(--ui-hairline);',
      '  border-radius: var(--ui-radius); font: 700 12px/1 var(--ui-font-text); }',
      '.lb-sw .lb-v { color: var(--ui-ink-faint); font: 400 var(--ui-type-label)/1.2 var(--ui-font-mono); }',
      '.lb-type { display: grid; gap: var(--ui-space-2); }',
      '.lb-type p { margin: 0; display: flex; align-items: baseline; gap: var(--ui-space-3); }',
      '.lb-type p span:first-child { font-family: var(--ui-font-text); font-weight: 700; line-height: 1.05; }',
      '.lb-space { display: grid; gap: var(--ui-space-1); }',
      '.lb-space p { margin: 0; display: grid; grid-template-columns: 7em auto 1fr; gap: var(--ui-space-2); align-items: center; }',
      '.lb-space i { display: block; height: .9em; background: var(--ui-ink); }',
      '.lb-shapes { display: flex; flex-wrap: wrap; gap: var(--ui-space-4); }',
      '.lb-shapes span { display: grid; place-items: center; min-width: 6.5em; height: 3em; padding: 0 var(--ui-space-3); background: var(--ui-raised);',
      '  font: 400 var(--ui-type-label)/1.2 var(--ui-font-mono); color: var(--ui-ink-soft); }',
      '.lb-shapes .lb-hair { border: var(--ui-hairline); } .lb-shapes .lb-rule { border: var(--ui-rule); }',
      '.lb-shapes .lb-r { border: var(--ui-rule); border-radius: var(--ui-radius); } .lb-shapes .lb-pill { border: var(--ui-hairline); border-radius: var(--ui-radius-pill); }',
      '.lb-shapes .lb-shadow { border: 2px solid var(--ui-ink); background: var(--ui-accent); color: var(--ui-on-accent); box-shadow: 4px 4px 0 var(--ui-shadow); }',
      '.lb-kv { display: flex; flex-wrap: wrap; gap: var(--ui-space-2) var(--ui-space-5); margin: 0; padding: 0; list-style: none; }',
      '.lb-kv li { font: 400 var(--ui-type-label)/1.3 var(--ui-font-mono); color: var(--ui-ink-soft); } .lb-kv b { color: var(--ui-ink); font-weight: 700; }'
    ];
    COLOURS.forEach(function (g) { g[1].forEach(function (n) { r.push('.lb-c-' + n + ' { background: var(--ui-' + n + '); }'); }); });
    OUTS.forEach(function (o) { r.push('.lb-c-out-' + o[0] + ' { background: var(--ui-out-' + o[0] + '); color: var(--ui-out-' + o[0] + '-ink); }'); });
    [1, 2, 3, 4, 5, 6].forEach(function (n) { r.push('.lb-c-faction-' + n + ' { background: var(--ui-faction-' + n + '); color: var(--ui-faction-' + n + '-ink); }'); });
    TYPES.forEach(function (t) { r.push('.lb-t-' + t + ' { font-size: var(--ui-type-' + t + '); }'); });
    [1, 2, 3, 4, 5, 6].forEach(function (n) { r.push('.lb-s-' + n + ' { width: var(--ui-space-' + n + '); }'); });
    var s = document.createElement('style'); s.id = 'lb-kit-css'; s.textContent = r.join('\n');
    document.head.appendChild(s);
  }

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  /* a second copy of an example (the Night column) gets its own ids */
  function reid(v, suffix) {
    if (Array.isArray(v)) return v.map(function (x) { return reid(x, suffix); });
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).forEach(function (k) { o[k] = k === 'id' ? v[k] + suffix : reid(v[k], suffix); }); return o; }
    return v;
  }
  function addCls(o, c) { o.cls = (o.cls ? o.cls + ' ' : '') + c; return o; }
  /* the options that show one state on an example: on a group part, on its first item */
  function withState(fn, opts, st) {
    var o = clone(opts), add = STATE[st]; if (!add) return null;
    if (fn === 'seg' && st === 'pressed') return null;     /* the example itself shows the one that is on */
    var t = o;
    if (Array.isArray(o.items) && o.items.length) {
      t = o.items.filter(function (it) { return String(it.value) !== String(o.value); })[0] || o.items[0];
    }
    if (fn === 'field' && st === 'focus-visible') { addCls(o, 'ui-demo-focus'); return o; }
    if (fn === 'row' && st === 'focus-visible') { addCls(o, 'ui-demo-hover'); if (o.action) addCls(o.action, 'ui-demo-focus'); return o; }
    if (fn === 'chip' && !o.button) { o.button = true; }
    Object.keys(add).forEach(function (k) { if (k === 'cls') addCls(t, add[k]); else t[k] = add[k]; });
    return o;
  }
  function fig(markup, caption, extra) {
    return '<figure class="lb-fig' + (extra ? ' ' + extra : '') + '"><div>' + markup + '</div><figcaption>' + B().esc(caption) + '</figcaption></figure>';
  }
  function B() { return window.B68Ui; }

  function tokens() {
    var U = B(), h = '';
    COLOURS.forEach(function (g) {
      h += '<h4><b>Colour</b>: ' + U.esc(g[0].toLowerCase()) + '</h4><div class="lb-sws">';
      g[1].forEach(function (n) { h += '<div class="lb-sw"><span class="lb-c-' + n + '"></span><code>--ui-' + n + '</code><span class="lb-v" data-lb-bg="' + n + '"></span></div>'; });
      h += '</div>';
    });
    h += '<h4><b>Colour</b>: the Fixer\'s five outcomes, for outcomes alone</h4><div class="lb-sws">';
    OUTS.forEach(function (o) { h += '<div class="lb-sw"><span class="lb-c-out-' + o[0] + '">' + U.esc(o[1]) + '</span><code>--ui-out-' + o[0] + '</code><span class="lb-v">and -ink</span></div>'; });
    h += '</div><h4><b>Colour</b>: the six faction slots</h4><div class="lb-sws">';
    [1, 2, 3, 4, 5, 6].forEach(function (n) { h += '<div class="lb-sw"><span class="lb-c-faction-' + n + '">' + n + '</span><code>--ui-faction-' + n + '</code><span class="lb-v">and -ink</span></div>'; });
    h += '</div><h4><b>Type</b>: one scale</h4><div class="lb-type">';
    TYPES.forEach(function (t) { h += '<p><span class="lb-t-' + t + '">' + U.esc(t.charAt(0).toUpperCase() + t.slice(1)) + '</span><code>--ui-type-' + t + ' <b data-lb-tok="--ui-type-' + t + '"></b></code></p>'; });
    h += '</div><h4><b>Space</b>: one scale</h4><div class="lb-space">';
    [1, 2, 3, 4, 5, 6].forEach(function (n) { h += '<p><code>--ui-space-' + n + '</code><i class="lb-s-' + n + '"></i><code data-lb-tok="--ui-space-' + n + '"></code></p>'; });
    h += '</div><h4><b>Borders, radii, elevation</b></h4><div class="lb-shapes"><span class="lb-hair">hairline</span><span class="lb-rule">rule</span>' +
      '<span class="lb-r">radius <b data-lb-tok="--ui-radius"></b></span><span class="lb-pill">pill</span><span class="lb-shadow">Primary only</span></div>';
    h += '<h4><b>Motion</b>: reduced motion is a cut</h4><ul class="lb-kv">';
    MOTION.forEach(function (m) { h += '<li>' + m + ' <b data-lb-tok="--ui-motion-' + m + '"></b></li>'; });
    h += '</ul><h4><b>Layers</b>: today\'s ladder</h4><ul class="lb-kv">';
    LAYERS.forEach(function (l) { h += '<li>' + l + ' <b data-lb-tok="--ui-layer-' + l + '"></b></li>'; });
    return h + '</ul>';
  }

  function parts(suffix) {
    var U = B(), h = '';
    U.PARTS.parts.forEach(function (p) {
      var ex = reid(p.examples, suffix);
      var wide = { card: 'lb-wide', row: 'lb-list', field: 'lb-wide', tabs: 'lb-wide' }[p.fn] || '';
      h += '<h4><b>' + U.esc(p.name) + '</b>: <code>.' + U.esc(p['class']) + '</code></h4><p class="lb-dd">Do: ' + U.esc(p['do']) + ' Don\'t: ' + U.esc(p.dont) + '</p>';
      h += '<div class="lb-ex ' + wide + '" data-lb-part="' + U.esc(p.fn) + '">';
      ex.forEach(function (e) { h += fig(U[p.fn](e.opts), e.caption, e.opts.open ? 'lb-open' : ''); });
      h += '</div>';
      if (p.fn === 'button') {
        h += '<h4><b>Button</b>: every rank in every state</h4>';
        var all = ['rest'].concat(p.states);
        /* two grids of three states each, so the matrix fits a column at distance density too */
        [all.slice(0, 3), all.slice(3)].forEach(function (cols) {
          h += '<div class="lb-grid"><span></span>';
          cols.forEach(function (c) { h += '<span>' + U.esc(c) + '</span>'; });
          p.variants.forEach(function (rank) {
            h += '<span>' + U.esc(rank) + '</span>';
            cols.forEach(function (c) {
              var o = { label: ({ primary: 'Send', standard: 'Clear', quiet: 'Blank', danger: 'PANIC' })[rank] || rank, rank: rank };
              h += '<div>' + U.button(c === 'rest' ? o : withState('button', o, c)) + '</div>';
            });
          });
          h += '</div>';
        });
      } else if (p.states && p.states.length) {
        var base = ex[ex.length - 1].opts, sts = p.states.filter(function (s) { return STATE[s]; });
        if (p.fn === 'chip') base = { label: 'Ray', button: true, pressed: false };
        if (p.fn === 'row' || p.fn === 'field') base = ex[0].opts;
        if (sts.length) {
          h += '<div class="lb-ex ' + wide + '" data-lb-states="' + U.esc(p.fn) + '">';
          sts.forEach(function (s) { var o = withState(p.fn, reid(base, '-' + s), s); if (o) h += fig(U[p.fn](o), s); });
          h += '</div>';
        }
      }
    });
    return h;
  }

  function column(theme) {
    var name = theme === 'night' ? 'Night' : 'Paper', sfx = theme === 'night' ? '-n' : '';
    return '<div class="lb-kit-col" data-ui-theme="' + theme + '"><h3>The ’68 kit · ' + name + '</h3>' + tokens() + parts(sfx) + '</div>';
  }

  function preset() {
    var m = /kit=([a-z,]+)/.exec(String(location.hash || '')), out = { theme: 'both', density: 'desk' };
    if (m) m[1].split(',').forEach(function (v) {
      if (v === 'both' || v === 'paper' || v === 'night') out.theme = v;
      if (v === 'desk' || v === 'distance') out.density = v;
    });
    return out;
  }
  function bar(p) {
    var U = B();
    return '<div class="lb-kit-bar"><h2>The UI kit</h2>' +
      U.seg({ label: 'Theme', value: p.theme, cls: 'lb-kit-theme', items: [{ label: 'Both', value: 'both' }, { label: 'Paper', value: 'paper' }, { label: 'Night', value: 'night' }] }) +
      U.seg({ label: 'Density', value: p.density, cls: 'lb-kit-density', items: [{ label: 'Desk', value: 'desk' }, { label: 'Distance', value: 'distance' }] }) +
      U.chip({ label: U.PARTS.parts.length + ' parts, from app/ui/parts.json' }) + '</div>';
  }
  function hex(rgb) {
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || ''); if (!m) return rgb || '';
    return '#' + [m[1], m[2], m[3]].map(function (x) { return ('0' + Number(x).toString(16)).slice(-2); }).join('');
  }
  /* the values each column really resolves to, read back from the page */
  function readBack(sec) {
    Array.prototype.forEach.call(sec.querySelectorAll('[data-lb-tok]'), function (el) {
      el.textContent = getComputedStyle(el).getPropertyValue(el.getAttribute('data-lb-tok')).trim();
    });
    Array.prototype.forEach.call(sec.querySelectorAll('[data-lb-bg]'), function (el) {
      var sw = el.parentNode.firstChild; el.textContent = hex(getComputedStyle(sw).backgroundColor);
    });
  }
  function pick(sec, segCls, attr, value) {
    Array.prototype.forEach.call(sec.querySelectorAll('.' + segCls + ' .ui-seg-opt'), function (b) { b.setAttribute('aria-pressed', b.value === value ? 'true' : 'false'); });
    sec.setAttribute(attr, value);
    readBack(sec);
  }
  function kitSection(host) {
    var U = B();
    if (!U || !U.PARTS || document.documentElement.getAttribute('data-kit') === null) return;
    if (/[?&]frame=/.test(String(location.search || ''))) return;     /* a show card's own frame (lookbook.html?frame=<kind>): the show alone */
    css();
    var p = preset(), sec = document.createElement('section');
    sec.className = 'lb-kit'; sec.id = 'lb-kit';
    sec.setAttribute('data-lb-theme', p.theme); sec.setAttribute('data-density', p.density);
    sec.innerHTML = bar(p) + '<div class="lb-kit-cols">' + column('paper') + column('night') + '</div>';
    var head = host.querySelector('.lb-head');
    host.insertBefore(sec, head ? head.nextSibling : host.firstChild);
    sec.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.ui-seg-opt') : null; if (!b) return;
      if (b.closest('.lb-kit-theme')) pick(sec, 'lb-kit-theme', 'data-lb-theme', b.value);
      else if (b.closest('.lb-kit-density')) pick(sec, 'lb-kit-density', 'data-density', b.value);
    });
    readBack(sec);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { readBack(sec); });
  }

  /* ---------- the overlays (KS03), below the kit's parts: a dialog (a confirm with a danger button, a prompt), a menu flipped at the right edge of its
     box, the toast stack with five toasts (four shown, one waiting), and a tooltip with its key hint. Paper and Night side by side (data-ui-theme
     on each column); a preset for pictures: lookbook.html#ov=paper or #ov=night. Each demo is the real thing from app/ui/overlay.js, mounted in a
     box of its own (the menu and the stack are local, pinned and still: no timers, no outside click), so a picture shows what the page does. ---------- */
  function ovCss() {
    var s = document.createElement('style'); s.id = 'lb-ov-css';
    s.textContent = [
      '.lb-ov { padding: 8px 20px 24px; }',
      '.lb-ov-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; padding: 8px 0 16px; }',
      '.lb-ov-bar h2 { margin: 0 12px 0 0; font: 900 28px/1.1 var(--ui-font-cond); text-transform: uppercase; letter-spacing: .04em; }',
      '.lb-ov-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: 0; border: var(--ui-rule); }',
      '.lb-ov-col { min-width: 0; padding: var(--ui-space-5) var(--ui-space-5) var(--ui-space-6); background: var(--ui-surface); color: var(--ui-ink); }',
      '.lb-ov-col > h3 { margin: 0 0 var(--ui-space-4); font: 900 var(--ui-type-title)/1 var(--ui-font-cond); text-transform: uppercase; letter-spacing: .02em; }',
      '.lb-ov-col > h4 { margin: var(--ui-space-6) 0 var(--ui-space-3); color: var(--ui-ink-soft); font: 700 var(--ui-type-label)/1.3 var(--ui-font-text); letter-spacing: .16em; text-transform: uppercase; }',
      '.lb-ov-col > h4 b { color: var(--ui-ink); }',
      '.lb-ov-row { display: flex; flex-wrap: wrap; gap: var(--ui-space-5); align-items: flex-start; }',
      '.lb-ov-fig { display: grid; gap: var(--ui-space-2); margin: 0; min-width: 0; flex: 1 1 24em; }',
      '.lb-ov-fig figcaption { color: var(--ui-ink-faint); font: 400 var(--ui-type-label)/1.3 var(--ui-font-mono); }',
      '.lb-ov-box { position: relative; box-sizing: border-box; height: 15em; border: var(--ui-hairline); border-radius: var(--ui-radius); background: var(--ui-sunk); overflow: hidden; }',
      '.lb-ov-box.lb-ov-tall { height: 25em; }',
      '.lb-ov-anchor { position: absolute; right: var(--ui-space-3); top: var(--ui-space-3); }',
      '.lb-ov-low { position: absolute; left: var(--ui-space-3); bottom: var(--ui-space-3); }',
      '.lb-ov-tipbox { display: grid; justify-items: start; gap: var(--ui-space-2); padding: var(--ui-space-4) 0; }',
            '.lb-ov[data-lb-ov="paper"] [data-ui-theme="night"], .lb-ov[data-lb-ov="night"] [data-ui-theme="paper"] { display: none; }'
    ].join('\n');
    document.head.appendChild(s);
  }
  function ovFig(caption, node) {
    var f = document.createElement('figure'); f.className = 'lb-ov-fig';
    f.appendChild(node);
    var c = document.createElement('figcaption'); c.textContent = caption; f.appendChild(c);
    return f;
  }
  function ovHead(col, strong, rest) {
    var h = document.createElement('h4'), b = document.createElement('b');
    b.textContent = strong; h.appendChild(b); h.appendChild(document.createTextNode(': ' + rest)); col.appendChild(h);
  }
  function ovRow(col, figs) {
    var row = document.createElement('div'); row.className = 'lb-ov-row';
    figs.forEach(function (f) { row.appendChild(f); });
    col.appendChild(row);
  }
  function overlayColumn(theme, later) {
    var U = window.B68Ui, O = window.B68Overlay;
    var col = document.createElement('div'); col.className = 'lb-ov-col'; col.setAttribute('data-ui-theme', theme);
    var h3 = document.createElement('h3'); h3.textContent = 'The ’68 overlays · ' + (theme === 'night' ? 'Night' : 'Paper'); col.appendChild(h3);

    ovHead(col, 'Dialog', 'a native dialog; the danger button is never the default, Cancel is');
    ovRow(col, [
      ovFig('confirm, danger: Cancel has the focus', O.buildDialog('confirm', { title: 'Take the night down?', body: 'The iPad goes back to the idle scene and the phones are let go. The roster stays.', confirm: 'Take it down', danger: true }, 'div').root),
      ovFig('prompt: Enter saves, Esc or a click outside leaves', O.buildDialog('prompt', { title: 'Rename the scene', label: 'Name', value: 'The Pelican Rooms', hint: 'Only you see this.', confirm: 'Save' }, 'div').root)
    ]);

    ovHead(col, 'Popover and menu', 'anchored, and flipped where the screen ends');
    var box = document.createElement('div'); box.className = 'lb-ov-box';
    var anchor = U.node('button', { label: 'Actions', cls: 'lb-ov-anchor', attrs: { 'aria-haspopup': 'menu' } });
    box.appendChild(anchor);
    var low = document.createElement('div'); low.className = 'lb-ov-box';
    var anchor2 = U.node('button', { label: 'More', rank: 'quiet', cls: 'lb-ov-low', attrs: { 'aria-haspopup': 'menu' } });
    low.appendChild(anchor2);
    ovRow(col, [ovFig('at the right edge it takes the anchor’s right edge; Esc closes it through the page’s one Esc', box), ovFig('at the bottom it opens upward', low)]);
    var items = [{ label: 'Introduce', key: 'N' }, { label: 'Show on iPad', key: 'I' }, { label: 'Hide', rank: 'danger' }];
    later.push(function () {
      U.menu({ anchor: anchor, items: items, label: 'Actions', mount: box, absolute: true, bounds: box, pinned: true, focus: false }).open();
      U.menu({ anchor: anchor2, items: items, label: 'More', mount: low, absolute: true, bounds: low, pinned: true, focus: false }).open();
    });

    ovHead(col, 'Toast stack', 'one stack, bottom right, at most four; info fades (its timer shows) and can carry Undo; an error stays');
    var tb = document.createElement('div'); tb.className = 'lb-ov-box lb-ov-tall';
    ovRow(col, [ovFig('five toasts: four shown, one waiting', tb)]);
    later.push(function () {
      var st = O.stack({ mount: tb, absolute: true, still: true });
      st.add({ text: 'Sent to the iPad: The vault floor', undo: function () {} });
      st.add({ text: 'Roll saved to the log' });
      st.add({ text: 'The iPad did not answer. Try again.', tone: 'error' });
      st.add({ text: 'Phones in: Nell, Ray, Tam' });
      st.add({ text: 'Clock started (waits its turn)' });
    });

    ovHead(col, 'Tooltip', 'a title, on hover and on keyboard focus, with its key when there is one; never over its control');
    var tipbox = document.createElement('div'); tipbox.className = 'lb-ov-tipbox';
    tipbox.appendChild(U.node('button', { label: 'Show on iPad', title: 'Show on iPad', data: { 'tip-key': 'I' } }));
    tipbox.appendChild(O.tip.node('Show on iPad', 'I'));
    ovRow(col, [ovFig('the tooltip; hover or Tab to the real button above it', tipbox)]);
    return col;
  }
  function overlaySection(host) {
    var U = window.B68Ui, O = window.B68Overlay;
    if (!U || !O || !O.stack || document.documentElement.getAttribute('data-kit') === null) return;
    ovCss();
    var m = /ov=(paper|night)/.exec(String(location.hash || '')), later = [];
    var sec = document.createElement('section'); sec.className = 'lb-ov'; sec.id = 'lb-overlay'; sec.setAttribute('data-lb-ov', m ? m[1] : 'both');
    var bar = document.createElement('div'); bar.className = 'lb-ov-bar';
    var h2 = document.createElement('h2'); h2.textContent = 'The overlays'; bar.appendChild(h2); sec.appendChild(bar);
    var cols = document.createElement('div'); cols.className = 'lb-ov-cols';
    cols.appendChild(overlayColumn('paper', later)); cols.appendChild(overlayColumn('night', later));
    sec.appendChild(cols);
    var after = host.querySelector('#lb-kit') || host.querySelector('.lb-head');
    host.insertBefore(sec, after ? after.nextSibling : host.firstChild);
    later.forEach(function (fn) { fn(); });   /* the menus and the stack are measured and placed once the section is in the page */
  }

  fetch('api/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (me) {
      if (!me || me.role !== 'gm') return denied();
      return addScript('routes.js')
        .then(function () { return window.B68Load.need('lookbook'); })
        .then(kit)
        .then(function () { window.B68Lookbook.run(root); kitSection(root); overlaySection(root); });
    })
    .catch(denied);
})();
