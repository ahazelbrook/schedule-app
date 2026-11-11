/* ui/ui.js: the UI kit helper (B68Ui), the kit and stage build (KS02.3). In the kit-ui bundle (app/routes.js): fetched only while a kit setting is
   on (or by the look book). It only defines B68Ui when it loads; it reads nothing else, and does nothing until it is called.

   THE CONTRACT (frozen 11/11; later bundles build on it, so it only grows):
     B68Ui.button(o) -> string     a ui-btn. o.rank: 'primary' | 'standard' (default) | 'quiet' | 'danger'. o.type defaults to 'button'
                                   ('submit' and 'reset' pass through). o.pressed true/false -> aria-pressed; o.disabled; o.busy -> aria-busy;
                                   o.key -> a key hint inside (aria-hidden; see "Reading a label" below)
     B68Ui.link(o)                 an <a> that looks like a button (KS02b): same ranks as button. o.href is validated: http, https, mailto, obsidian,
                                   a relative path or #... pass; anything else (javascript:, data:, ...) is dropped with a warning and the link
                                   is left without an href. o.target '_blank' adds rel="noopener noreferrer"; o.download; o.disabled ->
                                   aria-disabled, no href, tabindex -1; o.key as on button
     B68Ui.seg(o)                  a segmented pick-one: o.items [button-like {label, value, cls, data, attrs, disabled, key}], o.value (the one on),
                                   o.label (the group's name, for screen readers)
     B68Ui.tabs(o)                 a tab row, an underline: o.items [{label, value, selected, controls, ...}], o.value, o.label
     B68Ui.chip(o)                 o.tone 'plain' | 'accent' | 'alarm' | 'rules' | 'ok' | 'caution'; o.dot (true, or a dot tone); o.button -> a toggle
     B68Ui.card(o)                 o.label (the heading), o.meta, o.body (text), o.edge (below), o.heading (2-6, 0 = none; 3), o.tag ('div' | 'section' |
                                   'article' | 'li'), o.kids [descriptors], o.slot (a name), o.actions [button options]
     B68Ui.row(o)                  o.label (the name), o.sub, o.lead (initials, or {initials, tone}), o.action (ONE visible button; rank 'quiet' by default),
                                   o.more [button options] behind the more button (a ui-menu, opened by the overlay kit: data-ui-more),
                                   o.selected, o.edge, o.open (the menu drawn open: the look book)
     B68Ui.menu(o)                 a standalone menu (KS02b; B68Ui.row draws the same menu behind its more button): o.items [{ label, key, data, cls, id,
                                   disabled, rank: 'danger' }] as role="menuitem" buttons, the key hint at the right edge; o.label (aria-label).
                                   Class ui-menu ui-menu--static: it sits in the flow, where the row's one is a popover. Opening, closing and
                                   arrow keys are the overlay kit's (KS03), not this file's
     B68Ui.field(o)                o.label, o.kind 'text' (default) | 'number' | 'search' | 'time' | 'range' | 'select' | 'textarea' | 'check' | 'switch'
                                   (check and switch are checkboxes: o.checked, and the label sits beside the control; switch carries role="switch"),
                                   o.value, o.options [{value, label} or strings], o.placeholder, o.hint, o.disabled, o.required, o.min, o.max,
                                   o.step (number, time, range). Hooks go on the control
     B68Ui.meter(o)                o.kind 'pips' (default) | 'clock', o.value, o.max (1-12), o.label (named for screen readers), o.show (the
                                   count as text), o.tone 'ink' | 'accent' | 'alarm'
     B68Ui.key(o)                  a key hint: <kbd class="ui-key">
     B68Ui.dot(o)                  a status dot: o.tone 'live' | 'ok' | 'alarm' | 'idle' | 'caution'; with o.label a word beside it, else o.title names it
     B68Ui.bottombar(o)            (KS17) a phone's bottom bar: <nav class="ui-bottombar" aria-label=o.label> round one tab row (the Tabs part: o.items,
                                   o.value; class ui-tabs ui-bottombar-tabs). o.fixed -> ui-bottombar--fixed: fixed to the foot of the screen, its
                                   padding clear of the home indicator (env(safe-area-inset-bottom)). The hooks go on the nav
   HOOKS (KS02b). Every part takes ONE options object (a string in its place means { label: string }) and returns an ESCAPED markup string. Every part also takes
   the hooks, passed through untouched: o.id; o.cls (the old class names to keep: a string or a list); o.data ({ 'band-place': 'run' } ->
   data-band-place="run"; a camelCase key is kebab-cased the way dataset does: bandPlace and dataBandPlace both give data-band-place; a key that is
   still not lower-case letters, digits, '.', '_' or '-' is dropped); o.attrs (aria-*, role, name, value, tabindex, hidden, for, form, placeholder,
   autocomplete, inputmode, min, max, step, rows, maxlength, lang, dir, spellcheck; anything else is dropped); o.title (the tooltip, on every
   part); o.hidden. A hidden of false or 'false' (in o.hidden or in attrs) leaves the attribute off. A hook that is dropped (a bad id, class,
   attribute or data key) is reported once per distinct value with console.warn('B68Ui: dropped ...'), so a mistake shows in the console. Every string is text: there is NO raw-markup option. Nesting goes through descriptors, { part: 'chip', label: 'Live' },
   and a slot, { part: 'slot', name: 'body' } -> <div class="ui-slot" data-ui-slot="body">, which the caller fills itself.
     B68Ui.part(desc) -> string    one descriptor ({ part: 'button' | ... | 'slot', ...options })
     B68Ui.node(name, o, doc) -> Element   the same part built as DOM nodes (createElement and text nodes, no markup sink): for the iPad display,
                                   where every server string goes in as text. doc defaults to the page's document
     B68Ui.fill(root, { name: text }) -> root   sets the textContent of each [data-ui-slot="name"] under root
     B68Ui.wireTabs(root) -> root  (KS02b) ONE delegated keydown listener on root for every tablist under it, added once per root (a second call does
                                   nothing): Left/Right (Up/Down on an aria-orientation="vertical" list), Home and End move focus to the next
                                   enabled tab, wrap round, set the roving tabindex and click() it, so the caller's own click handler selects it
                                   (the WAI-ARIA tabs pattern, automatic activation). It never listens on Escape. If your click handler redraws
                                   the row, put focus back on the selected tab there. Call it on a container, not on document. Roots may nest: a tablist
                                   is answered by the NEAREST wired root above it only, so a tab never activates twice
     B68Ui.guardBusy(root) -> root (KS02b) ONE capture-phase listener on root, added once per root: a click, or an Enter or Space press, on a
                                   button or link with aria-busy="true" is cancelled before any handler under root sees it. The helper only emits
                                   markup, so a handler that is bound ABOVE root, or in a capture listener on document, must still check
                                   aria-busy itself. Use this guard rather than pointer-events: the sheet leaves a busy button clickable on
                                   purpose, because with pointer-events: none a real mouse click lands on the container beneath (a backdrop,
                                   a row-select handler) and fires that instead
     B68Ui.esc(s) -> string        & < > " ' as entities
     B68Ui.PARTS                   the manifest, app/ui/parts.json mirrored here (that file is in no bundle, so it is not precached):
                                   { version, radii, parts: [{ name, fn, class, variants, states, do, dont, examples: [{ caption, opts }] }] }.
                                   The examples are the look book's fixtures. kit-ui.test.mjs keeps the two copies equal
   data-ui-scope (KS02b). The kit's tokens and parts apply under `:root[data-kit]` (a kit page) and inside any container carrying the attribute
   data-ui-scope, and nowhere else. A screen whose kit is off that draws B68Ui parts (night.who's sheet, blade.pitches' cards) puts data-ui-scope on
   the root of what it draws: the tokens are defined there and the parts are styled under it, Paper by default (data-ui-theme="night" on the scope for
   Night), so a part is never drawn with undefined --ui-* values and never restyles an old .btn outside it. On a kit page a scope inherits the page's
   theme and density. The helper only emits markup: the caller sets the attribute (the kit-ui bundle must be loaded: B68Load.need('kit-ui')).
   READING A LABEL (KS02b). A button, link, seg option, tab or menu item with a key hint draws <span class="ui-label">Send</span><kbd class="ui-key"
   aria-hidden="true" data-ui-key="S"></kbd>: the hint's letter is painted by CSS (::before), so textContent of the whole button is "Send", never
   "SendS", and (btn.querySelector('.ui-label') || btn).textContent is the label either way. Without a key the button is just its text, as before.
   Edges (card, row): 'accent' 'alarm' 'rules' 'ok' 'caution' 'ink', 'faction-1' to 'faction-6', 'out-deal' 'out-mid' 'out-low' 'out-six'
   'out-crit' (the Fixer's outcomes: for outcomes alone).
   This file is the one place in the kit that builds a button element: it writes the tag as '<' + tag, and the ratchet
   (checks/runtime/kit-ratchet.test.mjs) keeps every other kit file at zero hand-built buttons. ES5, window.B68Ui in the browser,
   module.exports under Node. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68Ui = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var BTN = 'button', SVGNS = 'http://www.w3.org/2000/svg', MORE = '⋯';
  var ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  var RANKS = { primary: 1, standard: 1, quiet: 1, danger: 1 };
  var TYPES = { button: 1, submit: 1, reset: 1 };
  var TONES = { plain: 1, accent: 1, alarm: 1, rules: 1, ok: 1, caution: 1 };
  var DOTS = { live: 1, ok: 1, alarm: 1, idle: 1, caution: 1 };
  var EDGES = /^(accent|alarm|rules|ok|caution|ink|faction-[1-6]|out-(deal|mid|low|six|crit))$/;
  var ATTR_OK = /^(aria-[a-z]+|role|name|value|tabindex|hidden|for|form|placeholder|autocomplete|inputmode|min|max|step|rows|maxlength|lang|dir|spellcheck)$/;
  var DATA_OK = /^data-[a-z0-9][a-z0-9._-]*$/;
  var CLASS_OK = /^-?[A-Za-z_][A-Za-z0-9_-]*$/;
  var ID_OK = /^[A-Za-z][A-Za-z0-9_:.-]*$/;
  var SLOT_OK = /^[a-z0-9][a-z0-9_-]*$/;
  var INPUTS = { text: 1, number: 1, search: 1, time: 1, range: 1 };
  var BOXES = { check: 1, 'switch': 1 };
  var HREF_SCHEME = /^[a-z][a-z0-9+.\-]*:/i, HREF_OK = /^(https?|mailto|obsidian):/i;
  var BUSY = 'button[aria-busy="true"],a[aria-busy="true"],[role="button"][aria-busy="true"]';
  var WIRED_TABS = '__b68UiTabs', WIRED_BUSY = '__b68UiBusy';
  var VOID = { input: 1 };

  /* ---------- the manifest (app/ui/parts.json, mirrored: kit-ui.test.mjs keeps them equal) ---------- */
  var MID = '·';
  var PARTS = {
    version: 1,
    radii: { control: '2px', pill: '999px' },
    parts: [
      { name: 'Button', fn: 'button', 'class': 'ui-btn', variants: ['primary', 'standard', 'quiet', 'danger'],
        states: ['hover', 'focus-visible', 'pressed', 'disabled', 'busy'],
        'do': 'One Primary per region. Say what happens: Show on iPad, Take it down.',
        dont: 'Two Primaries side by side. A hard shadow on anything but the Primary.',
        examples: [
          { caption: 'Primary', opts: { label: 'Stamp it on the iPad', rank: 'primary' } },
          { caption: 'Standard', opts: { label: 'Take it down' } },
          { caption: 'Quiet', opts: { label: 'Fit', rank: 'quiet' } },
          { caption: 'Danger', opts: { label: 'PANIC', rank: 'danger' } },
          { caption: 'With its key', opts: { label: 'Send', key: 'S' } }
        ] },
      { name: 'Link', fn: 'link', 'class': 'ui-btn', variants: ['primary', 'standard', 'quiet', 'danger'], states: ['hover', 'focus-visible', 'disabled'],
        'do': 'A way out to another page or file, with the look of a button. Same ranks as a button.',
        dont: 'A link for an action on this page: that is a Button. A link that is not http, https, mailto, obsidian or a relative path.',
        examples: [
          { caption: 'Standard', opts: { label: 'Open in Obsidian', href: 'obsidian://open?vault=Demo&file=Pelican%20Rooms' } },
          { caption: 'Primary', opts: { label: 'Open the plate', href: '#plate', rank: 'primary' } },
          { caption: 'Quiet', opts: { label: 'Rules page', href: 'rules.html', rank: 'quiet', target: '_blank' } },
          { caption: 'Disabled', opts: { label: 'Not yet', href: '#later', disabled: true } }
        ] },
      { name: 'Segmented', fn: 'seg', 'class': 'ui-seg', variants: [], states: ['hover', 'focus-visible', 'pressed', 'disabled'],
        'do': 'Pick one of a few, every option in sight.',
        dont: 'More than four options. Places to go: those are Tabs.',
        examples: [
          { caption: 'Position', opts: { label: 'Position', value: 'risky',
            items: [{ label: 'Controlled', value: 'controlled' }, { label: 'Risky', value: 'risky' }, { label: 'Desperate', value: 'desperate' }] } },
          { caption: 'Map look', opts: { label: 'Map look', value: 'seen',
            items: [{ label: 'Dark', value: 'dark' }, { label: 'Blueprint', value: 'blueprint' }, { label: 'Seen', value: 'seen' }] } }
        ] },
      { name: 'Tabs', fn: 'tabs', 'class': 'ui-tabs', variants: [], states: ['hover', 'focus-visible', 'selected'],
        'do': 'Places on one surface: an underline, never a box.',
        dont: 'Actions in a tab row.',
        examples: [
          { caption: 'Places', opts: { label: 'Places', value: 'board',
            items: [{ label: 'Board', value: 'board' }, { label: 'Map', value: 'map' }, { label: 'Players', value: 'players' }, { label: 'Cast', value: 'cast' }] } }
        ] },
      { name: 'Chip', fn: 'chip', 'class': 'ui-chip', variants: ['plain', 'accent', 'alarm', 'rules', 'ok', 'caution'], states: ['hover', 'focus-visible', 'pressed'],
        'do': 'Status and small toggles, always with a word.',
        dont: 'Colour with no word. A chip as the main action.',
        examples: [
          { caption: 'Live', opts: { label: 'On the iPad', tone: 'accent', dot: true } },
          { caption: 'Alarm', opts: { label: 'Alarm 4/6', tone: 'alarm' } },
          { caption: 'Plain', opts: { label: 'Last tram 3/8' } },
          { caption: 'Rules', opts: { label: 'Rules', tone: 'rules' } },
          { caption: 'Ok', opts: { label: 'Phones in', tone: 'ok', dot: true } },
          { caption: 'Caution', opts: { label: 'Heat 3', tone: 'caution' } },
          { caption: 'Toggle', opts: { label: 'Nell', button: true, pressed: true } }
        ] },
      { name: 'Card', fn: 'card', 'class': 'ui-card', variants: ['edge'], states: [],
        'do': 'One thing, with a colour edge that means one thing.',
        dont: 'Cards inside cards. An edge colour as decoration.',
        examples: [
          { caption: 'Accent edge', opts: { label: 'The Pelican Rooms', meta: 'Tonight', edge: 'accent',
            body: 'A ledger fetched from the quiet side of the hall.', actions: [{ label: 'Show on iPad' }] } },
          { caption: 'Faction edge', opts: { label: 'Mabel Quist', meta: 'Fixer', edge: 'faction-2', body: 'Counts the room twice.' } },
          { caption: 'Outcome edge', opts: { label: '4/5', meta: 'Partial', edge: 'out-mid', body: 'You get it, and the floor manager saw you.',
            kids: [{ part: 'chip', label: 'Heat +1', tone: 'caution' }] } }
        ] },
      { name: 'Row', fn: 'row', 'class': 'ui-row', variants: ['selected', 'edge'], states: ['hover', 'focus-visible'],
        'do': 'A list is rows: one visible action, the rest behind the more button.',
        dont: 'A wall of buttons on every row.',
        examples: [
          { caption: 'Row', opts: { label: 'Mabel Quist', sub: 'Fixer ' + MID + ' counts the room twice', lead: 'MQ',
            action: { label: 'Spotlight' }, more: [{ label: 'Introduce' }, { label: 'Show on iPad' }] } },
          { caption: 'Selected', opts: { label: 'Dov Kessler', sub: 'Desk sergeant ' + MID + ' owes the house', lead: 'DK', selected: true,
            action: { label: 'Spotlight', rank: 'standard' }, more: [{ label: 'Introduce' }] } },
          { caption: 'More, open', opts: { id: 'lb-row-ada', label: 'Ada Vell', sub: 'Croupier', lead: 'AV', open: true,
            action: { label: 'Spotlight' }, more: [{ label: 'Introduce' }, { label: 'Show on iPad' }, { label: 'Hide', rank: 'danger' }] } }
        ] },
      { name: 'Menu', fn: 'menu', 'class': 'ui-menu', variants: [], states: ['hover', 'focus-visible'],
        'do': 'A short list of verbs, the key hint at the right edge. One danger item at most, last.',
        dont: 'A menu of places: those are Tabs. A menu as the first thing a screen shows.',
        examples: [
          { caption: 'With keys', opts: { label: 'Mabel Quist', items: [{ label: 'Introduce', key: 'I' }, { label: 'Show on iPad', key: 'S' },
            { label: 'Spotlight' }, { label: 'Hide', rank: 'danger' }] } },
          { caption: 'With a disabled item', opts: { label: 'Phones', items: [{ label: 'Send', key: 'Enter' }, { label: 'Clear', disabled: true }] } }
        ] },
      { name: 'Field', fn: 'field', 'class': 'ui-field', variants: ['text', 'select', 'textarea', 'check', 'switch', 'time', 'range'], states: ['focus-visible', 'disabled'],
        'do': 'A label above every input; a hint below when it helps.',
        dont: 'A placeholder as the only label.',
        examples: [
          { caption: 'Text', opts: { label: 'Note', placeholder: 'A line for tonight', hint: 'Only you see this.' } },
          { caption: 'Select', opts: { label: 'Position', kind: 'select', value: 'risky',
            options: [{ value: 'controlled', label: 'Controlled' }, { value: 'risky', label: 'Risky' }, { value: 'desperate', label: 'Desperate' }] } },
          { caption: 'Text area', opts: { label: 'Prep line', kind: 'textarea', value: 'Lotte Brand waits by the cloakroom.' } },
          { caption: 'Disabled', opts: { label: 'Session', value: '4', kind: 'number', disabled: true } },
          { caption: 'Check', opts: { label: 'Phones in', kind: 'check', checked: true, hint: 'Counts as in until they leave.' } },
          { caption: 'Switch', opts: { label: 'Rain on the glass', kind: 'switch', checked: true } },
          { caption: 'Time', opts: { label: 'Doors', kind: 'time', value: '19:30' } },
          { caption: 'Range', opts: { label: 'Volume', kind: 'range', value: 40, min: 0, max: 100, step: 5 } }
        ] },
      { name: 'Meter', fn: 'meter', 'class': 'ui-meter', variants: ['pips', 'clock'], states: [],
        'do': 'Pips for short counts, a clock for clocks. Say the count.',
        dont: 'A meter with no name.',
        examples: [
          { caption: 'Pips', opts: { kind: 'pips', label: 'Stress', value: 3, max: 6 } },
          { caption: 'Clock', opts: { kind: 'clock', label: 'Last tram', value: 3, max: 8, show: true } },
          { caption: 'Alarm clock', opts: { kind: 'clock', label: 'Alarm', value: 4, max: 6, tone: 'alarm', show: true } },
          { caption: 'Four', opts: { kind: 'clock', label: 'Cloakroom', value: 1, max: 4, tone: 'accent', show: true } }
        ] },
      { name: 'Key hint', fn: 'key', 'class': 'ui-key', variants: [], states: [],
        'do': 'Show the shortcut beside what it does.',
        dont: 'A key that is not on the shortcuts card.',
        examples: [{ caption: 'Esc', opts: { label: 'Esc' } }, { caption: 'R', opts: { label: 'R' } }, { caption: 'A', opts: { label: 'A' } }] },
      { name: 'Status dot', fn: 'dot', 'class': 'ui-dot', variants: ['live', 'ok', 'alarm', 'idle', 'caution'], states: [],
        'do': 'A dot beside a word: live, ok, alarm, idle.',
        dont: 'A dot alone with no word or title.',
        examples: [
          { caption: 'Live', opts: { tone: 'live', label: 'On the iPad' } },
          { caption: 'Ok', opts: { tone: 'ok', label: 'Phones in' } },
          { caption: 'Alarm', opts: { tone: 'alarm', label: 'Signed out' } },
          { caption: 'Idle', opts: { tone: 'idle', label: 'Asleep' } },
          { caption: 'Caution', opts: { tone: 'caution', label: 'Slow line' } }
        ] },
      { name: 'Bottom bar', fn: 'bottombar', 'class': 'ui-bottombar', variants: ['fixed'], states: ['hover', 'focus-visible', 'pressed'],
        'do': 'A phone\'s few screens, one word each, the one shown marked. Fixed to the foot, clear of the home indicator.',
        dont: 'More than five places. An action in the bar: it only moves between screens.',
        examples: [
          { caption: 'Now', opts: { label: 'Sheet screens', value: 'now', items: [{ label: 'Now', value: 'now' }, { label: 'Sheet', value: 'sheet' },
            { label: 'Crew', value: 'crew' }, { label: 'Notes', value: 'notes' }] } },
          { caption: 'Notes', opts: { label: 'Sheet screens', value: 'notes', items: [{ label: 'Now', value: 'now' }, { label: 'Sheet', value: 'sheet' },
            { label: 'Crew', value: 'crew' }, { label: 'Notes', value: 'notes' }] } }
        ] }
    ]
  };

  /* ---------- text, attributes and the tree ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ENT[c]; }); }
  function str(v) { return v == null ? '' : String(v); }
  function norm(o) { return typeof o === 'string' || typeof o === 'number' ? { label: String(o) } : (o && typeof o === 'object' ? o : {}); }
  function txt(s) { return { x: str(s) }; }
  function el(t, a, c, ns) { return { t: t, a: a || [], c: c || [], n: ns || '' }; }
  /* one attribute in, replacing an earlier one of the same name; null, undefined and false leave it out */
  function put(a, k, v) {
    for (var i = 0; i < a.length; i++) if (a[i][0] === k) { a.splice(i, 1); break; }
    if (v === null || v === undefined || v === false) return a;
    a.push([k, v === true ? true : String(v)]);
    return a;
  }
  /* a dropped hook is reported once per distinct (kind, value), so a mistake shows in the console without a flood (at most 200 are kept) */
  var warned = {}, warnedN = 0;
  function warn(kind, what) {
    var k = kind + ' ' + String(what).slice(0, 60);
    if (warned[k] || warnedN >= 200) return;
    warned[k] = 1; warnedN++;
    try { if (typeof console !== 'undefined' && console && typeof console.warn === 'function') console.warn('B68Ui: dropped ' + kind + ' ' + JSON.stringify(String(what).slice(0, 60))); } catch (e) { /* a console that throws is no reason to stop drawing */ }
  }
  function classes(own, cls) {
    var out = own.slice(), more = Array.isArray(cls) ? cls : str(cls).split(/\s+/);
    more.forEach(function (c) {
      c = str(c);
      if (!c) return;
      if (!CLASS_OK.test(c)) warn('class', c);
      else if (out.indexOf(c) < 0) out.push(c);
    });
    return out.join(' ');
  }
  /* a data key as the attribute name, dataset's way (fooBar and dataFooBar give data-foo-bar); 'data-x' and 'x' pass as they were */
  function dataName(k) {
    k = str(k);
    if (k.indexOf('data-') === 0) return k;
    if (/^data[A-Z]/.test(k)) k = k.slice(4);
    return 'data-' + k.replace(/[A-Z]/g, function (c) { return '-' + c.toLowerCase(); }).replace(/^-/, '');
  }
  function falsy(v) { return v === false || v === 'false'; }
  /* the hooks every part takes: id, data-*, the allowed attributes, title, hidden */
  function hooks(a, o) {
    if (o.id != null) { if (ID_OK.test(str(o.id))) put(a, 'id', o.id); else warn('id', o.id); }
    if (o.title != null && o.title !== '') put(a, 'title', o.title);
    var d = o.data && typeof o.data === 'object' ? o.data : {};
    Object.keys(d).forEach(function (k) {
      var n = dataName(k);
      if (DATA_OK.test(n)) put(a, n, d[k] === true ? '' : d[k]); else warn('data key', k);
    });
    var x = o.attrs && typeof o.attrs === 'object' ? o.attrs : {};
    Object.keys(x).forEach(function (k) {
      if (!ATTR_OK.test(k)) warn('attribute', k);
      else if (!(k === 'hidden' && falsy(x[k]))) put(a, k, x[k]);
    });
    if (o.hidden === true) put(a, 'hidden', true);
    return a;
  }
  function edge(own, o) { if (EDGES.test(str(o.edge))) own.push('ui-edge-' + o.edge); return own; }

  function html(n) {
    if (n.x !== undefined) return esc(n.x);
    var s = '<' + n.t;
    n.a.forEach(function (p) { s += p[1] === true ? ' ' + p[0] : ' ' + p[0] + '="' + esc(p[1]) + '"'; });
    s += '>';
    if (VOID[n.t]) return s;
    for (var i = 0; i < n.c.length; i++) s += html(n.c[i]);
    return s + '</' + n.t + '>';
  }
  function dom(n, doc) {
    if (n.x !== undefined) return doc.createTextNode(n.x);
    var e = n.n === 'svg' ? doc.createElementNS(SVGNS, n.t) : doc.createElement(n.t);
    n.a.forEach(function (p) { e.setAttribute(p[0], p[1] === true ? '' : p[1]); });
    n.c.forEach(function (c) { e.appendChild(dom(c, doc)); });
    return e;
  }

  /* ---------- the parts, as trees ---------- */
  var T = {};
  /* a control's label and its key hint. With a hint the label sits in <span class="ui-label"> and the letter is painted by CSS from data-ui-key, so
     the control's own textContent stays the label (KS02b). With no hint it is the bare text node, as before */
  function labelKids(label, key) {
    if (key == null || key === '') return [txt(label)];
    return [el('span', [['class', 'ui-label']], [txt(label)]), el('kbd', [['class', 'ui-key'], ['aria-hidden', 'true'], ['data-ui-key', str(key)]])];
  }
  T.button = function (o) {
    var rank = RANKS[o.rank] ? o.rank : 'standard';
    var a = [['type', TYPES[o.type] ? o.type : 'button'], ['class', classes(['ui-btn', 'ui-btn--' + rank], o.cls)]];
    hooks(a, o);
    if (o.pressed === true || o.pressed === false) put(a, 'aria-pressed', String(o.pressed));
    if (o.busy) put(a, 'aria-busy', 'true');
    if (o.disabled) put(a, 'disabled', true);
    return el(BTN, a, labelKids(o.label, o.key));
  };
  /* an <a> that looks like a button: the same ranks; the href is checked (http, https, mailto, obsidian, relative, #...) */
  function safeHref(h) {
    /* the FINAL value first: C0 controls (tab and newline among them) out, then trimmed (trim also takes Unicode space and the BOM), and only
       then judged, so what is tested is exactly what is emitted. A backslash is dropped outright (a browser reads \host as //host) */
    var v = str(h).replace(/[\u0000-\u001f\u007f]/g, '').trim();
    if (!v || v.indexOf('\\') >= 0) return '';
    var c = v.replace(/[\s\u0000- \u007f-\u009f­​-‏⁠﻿]/g, '');     /* belt and braces: no invisible can hide a scheme */
    if (HREF_SCHEME.test(c) && !HREF_OK.test(c)) return '';
    return v;
  }
  T.link = function (o) {
    var rank = RANKS[o.rank] ? o.rank : 'standard';
    var a = [['class', classes(['ui-btn', 'ui-btn--' + rank], o.cls)]];
    var href = safeHref(o.href);
    if (o.href != null && o.href !== '' && !href) warn('href', o.href);
    if (href && !o.disabled) put(a, 'href', href);
    hooks(a, o);
    if (o.disabled) { put(a, 'role', 'link'); put(a, 'aria-disabled', 'true'); put(a, 'tabindex', '-1'); }
    if (o.target === '_blank') { put(a, 'target', '_blank'); put(a, 'rel', 'noopener noreferrer'); }
    if (o.download === true) put(a, 'download', true);
    else if (typeof o.download === 'string' && o.download) put(a, 'download', o.download);
    return el('a', a, labelKids(o.label, o.key));
  };
  /* a button inside a group part (seg, tabs, menu): the item's own hooks, the part's classes */
  function item(it, own) {
    var a = [['type', 'button'], ['class', classes(own, it.cls)]];
    hooks(a, it);
    if (it.value != null) put(a, 'value', it.value);
    return { a: a, c: labelKids(it.label, it.key) };
  }
  function picked(o, it) { return o.value !== undefined && o.value !== null ? it.value != null && String(it.value) === String(o.value) : false; }
  T.seg = function (o) {
    var a = hooks([['class', classes(['ui-seg'], o.cls)], ['role', 'group']], o);
    if (o.label) put(a, 'aria-label', o.label);
    var c = (Array.isArray(o.items) ? o.items : []).map(function (it) {
      it = norm(it);
      var b = item(it, ['ui-seg-opt']);
      if (!b.a.some(function (p) { return p[0] === 'aria-pressed'; })) put(b.a, 'aria-pressed', picked(o, it) || it.pressed === true ? 'true' : 'false');
      if (it.disabled) put(b.a, 'disabled', true);
      return el(BTN, b.a, b.c);
    });
    return el('div', a, c);
  };
  T.tabs = function (o) {
    var a = hooks([['class', classes(['ui-tabs'], o.cls)], ['role', 'tablist']], o);
    if (o.label) put(a, 'aria-label', o.label);
    var c = (Array.isArray(o.items) ? o.items : []).map(function (it) {
      it = norm(it);
      var on = picked(o, it) || it.selected === true;
      var b = item(it, ['ui-tab']);
      if (!b.a.some(function (p) { return p[0] === 'role'; })) put(b.a, 'role', 'tab');
      put(b.a, 'aria-selected', on ? 'true' : 'false');
      if (!b.a.some(function (p) { return p[0] === 'tabindex'; })) put(b.a, 'tabindex', on ? '0' : '-1');
      if (it.controls != null && ID_OK.test(str(it.controls))) put(b.a, 'aria-controls', it.controls);
      if (it.disabled) put(b.a, 'disabled', true);
      return el(BTN, b.a, b.c);
    });
    return el('div', a, c);
  };
  T.dot = function (o) {
    var tone = DOTS[o.tone] ? o.tone : 'idle';
    var d = el('span', [['class', 'ui-dot ui-dot--' + tone]]);
    if (o.label == null || o.label === '') {
      d.a = hooks([['class', classes(['ui-dot', 'ui-dot--' + tone], o.cls)], ['role', 'img']], o);
      put(d.a, 'aria-label', o.title || tone);
      return d;
    }
    put(d.a, 'aria-hidden', 'true');
    return el('span', hooks([['class', classes(['ui-status', 'ui-status--' + tone], o.cls)]], o), [d, txt(o.label)]);
  };
  T.chip = function (o) {
    var tone = TONES[o.tone] ? o.tone : 'plain';
    var own = ['ui-chip', 'ui-chip--' + tone], tag = o.button ? BTN : 'span';
    var a = o.button ? [['type', 'button'], ['class', classes(own, o.cls)]] : [['class', classes(own, o.cls)]];
    hooks(a, o);
    if (o.button && (o.pressed === true || o.pressed === false)) put(a, 'aria-pressed', String(o.pressed));
    if (o.button && o.disabled) put(a, 'disabled', true);
    var c = [];
    if (o.dot) {
      var dt = DOTS[o.dot] ? o.dot : ({ accent: 'live', alarm: 'alarm', ok: 'ok', caution: 'caution' })[tone] || 'idle';
      c.push(el('span', [['class', 'ui-dot ui-dot--' + dt], ['aria-hidden', 'true']]));
    }
    c.push(txt(o.label));
    return el(tag, a, c);
  };
  T.key = function (o) { return el('kbd', hooks([['class', classes(['ui-key'], o.cls)]], o), [txt(o.label)]); };
  T.slot = function (o) {
    var name = str(o.name || o.label);
    var tag = { div: 1, span: 1, p: 1, ul: 1, ol: 1 }[o.tag] ? o.tag : 'div';
    return el(tag, hooks([['class', classes(['ui-slot'], o.cls)]].concat(SLOT_OK.test(name) ? [['data-ui-slot', name]] : []), o));
  };
  function kids(list) {
    return (Array.isArray(list) ? list : []).map(function (d) {
      d = norm(d);
      var f = T[d.part];
      return typeof f === 'function' ? f(d) : null;
    }).filter(Boolean);
  }
  function actions(list, cls) {
    var b = (Array.isArray(list) ? list : []).map(function (x) { return T.button(norm(x)); });
    return b.length ? [el('div', [['class', cls]], b)] : [];
  }
  T.card = function (o) {
    var tag = { div: 1, section: 1, article: 1, li: 1 }[o.tag] ? o.tag : 'div';
    var a = hooks([['class', classes(edge(['ui-card'], o), o.cls)]], o);
    var c = [];
    var h = o.heading === 0 ? 'p' : 'h' + (o.heading >= 2 && o.heading <= 6 ? Math.floor(o.heading) : 3);
    if (o.label != null && o.label !== '' || o.meta != null && o.meta !== '') {
      var head = [];
      if (o.label != null && o.label !== '') head.push(el(h, [['class', 'ui-card-title']], [txt(o.label)]));
      if (o.meta != null && o.meta !== '') head.push(el('span', [['class', 'ui-card-meta']], [txt(o.meta)]));
      c.push(el('div', [['class', 'ui-card-head']], head));
    }
    if (o.body != null && o.body !== '') c.push(el('p', [['class', 'ui-card-body']], [txt(o.body)]));
    c = c.concat(kids(o.kids));
    if (o.slot) c.push(T.slot({ name: o.slot, cls: 'ui-card-body' }));
    c = c.concat(actions(o.actions, 'ui-card-acts'));
    return el(tag, a, c);
  };
  T.row = function (o) {
    var own = edge(['ui-row'], o);
    if (o.selected) own.push('is-selected');
    var a = hooks([['class', classes(own, o.cls)]], o);
    if (o.selected && !a.some(function (p) { return p[0] === 'aria-current'; })) put(a, 'aria-current', 'true');
    var c = [];
    var lead = o.lead && typeof o.lead === 'object' ? o.lead : { initials: o.lead };
    if (lead.initials != null && lead.initials !== '') {
      var lc = ['ui-row-lead'];
      if (EDGES.test(str(lead.tone))) lc.push('ui-edge-' + lead.tone);
      c.push(el('span', [['class', lc.join(' ')], ['aria-hidden', 'true']], [txt(str(lead.initials).slice(0, 3))]));
    }
    var t = [el('span', [['class', 'ui-row-title']], [txt(o.label)])];
    if (o.sub != null && o.sub !== '') t.push(el('span', [['class', 'ui-row-sub']], [txt(o.sub)]));
    c.push(el('div', [['class', 'ui-row-text']], t));
    var acts = [];
    if (o.action) { var ac = norm(o.action); acts.push(T.button(RANKS[ac.rank] ? ac : merge(ac, { rank: 'quiet' }))); }
    var more = Array.isArray(o.more) ? o.more : [], menuId = o.id != null && ID_OK.test(str(o.id)) ? o.id + '-more' : '';
    if (more.length) {
      var mb = T.button({ label: MORE, rank: 'quiet', cls: 'ui-row-more', title: o.moreLabel || 'More',
        attrs: { 'aria-label': o.moreLabel || 'More', 'aria-haspopup': 'menu', 'aria-expanded': o.open ? 'true' : 'false' }, data: { 'ui-more': true } });
      if (menuId) put(mb.a, 'aria-controls', menuId);
      acts.push(mb);
    }
    if (acts.length) c.push(el('div', [['class', 'ui-row-acts']], acts));
    if (more.length) {
      var ma = [['class', 'ui-menu'], ['role', 'menu']];
      if (menuId) put(ma, 'id', menuId);
      if (!o.open) put(ma, 'hidden', true);
      c.push(el('div', ma, menuItems(more)));
    }
    return el('div', a, c);
  };
  /* the menu items, for the row's menu and the standalone one: { label, key, data, cls, id, disabled, rank: 'danger' } */
  function menuItems(list) {
    return list.map(function (m) {
      m = norm(m);
      var b = item(m, ['ui-menu-item'].concat(m.rank === 'danger' ? ['ui-menu-item--danger'] : []));
      put(b.a, 'role', 'menuitem');
      if (m.disabled) put(b.a, 'disabled', true);
      return el(BTN, b.a, b.c);
    });
  }
  T.menu = function (o) {
    var a = hooks([['class', classes(['ui-menu', 'ui-menu--static'], o.cls)], ['role', 'menu']], o);
    if (o.label) put(a, 'aria-label', o.label);
    return el('div', a, menuItems(Array.isArray(o.items) ? o.items : []));
  };
  function merge(a, b) { var o = {}; Object.keys(a).forEach(function (k) { o[k] = a[k]; }); Object.keys(b).forEach(function (k) { o[k] = b[k]; }); return o; }
  T.field = function (o) {
    var kind = o.kind === 'select' || o.kind === 'textarea' || BOXES[o.kind] ? o.kind : INPUTS[o.kind] ? o.kind : 'text';
    var a, ctl;
    if (kind === 'select') {
      a = hooks([['class', classes(['ui-field-input'], o.cls)]], o);
      ctl = el('select', a, (Array.isArray(o.options) ? o.options : []).map(function (op) {
        op = typeof op === 'object' && op ? op : { value: op, label: op };
        var v = str(op.value != null ? op.value : op.label);
        var oa = [['value', v]];
        if (o.value != null && String(o.value) === v) put(oa, 'selected', true);
        return el('option', oa, [txt(op.label != null ? op.label : v)]);
      }));
    } else if (kind === 'textarea') {
      a = hooks([['class', classes(['ui-field-input'], o.cls)]], o);
      ctl = el('textarea', a, [txt(o.value)]);
    } else {
      a = [['class', classes(['ui-field-input'], o.cls)], ['type', BOXES[kind] ? 'checkbox' : kind]];
      hooks(a, o);
      if (o.value != null && typeof o.value !== 'boolean') put(a, 'value', o.value);
      if (kind === 'switch') put(a, 'role', 'switch');
      if (BOXES[kind] && (o.checked === true || o.value === true)) put(a, 'checked', true);
      if (kind === 'number' || kind === 'time' || kind === 'range') ['min', 'max', 'step'].forEach(function (k) { if (o[k] != null && o[k] !== '') put(a, k, o[k]); });
      ctl = el('input', a);
    }
    if (o.placeholder != null && o.placeholder !== '' && kind !== 'select' && !BOXES[kind]) put(a, 'placeholder', o.placeholder);
    if (o.disabled) put(a, 'disabled', true);
    if (o.required) put(a, 'required', true);
    var c = [el('span', [['class', 'ui-field-label']], [txt(o.label)]), ctl];
    if (o.hint != null && o.hint !== '') c.push(el('span', [['class', 'ui-field-hint']], [txt(o.hint)]));
    if (BOXES[kind]) c = [ctl, c[0]].concat(c.slice(2));     /* the box first, its words beside it, the hint under them */
    var more = BOXES[kind] ? ' ui-field--' + kind : kind === 'range' ? ' ui-field--range' : '';
    return el('label', [['class', 'ui-field' + more + (o.disabled ? ' is-disabled' : '')]], c);
  };
  function num(v, lo, hi, dflt) { v = Math.floor(Number(v)); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt; }
  function fix(n) { return String(Math.round(n * 100) / 100); }
  T.meter = function (o) {
    var kind = o.kind === 'clock' ? 'clock' : 'pips';
    var max = num(o.max, 1, 12, 4), val = num(o.value, 0, max, 0);
    var tone = { accent: 1, alarm: 1 }[o.tone] ? o.tone : 'ink';
    var a = hooks([['class', classes(['ui-meter', 'ui-meter--' + kind, 'ui-meter--' + tone], o.cls)], ['role', 'img']], o);
    put(a, 'aria-label', (o.label ? str(o.label) + ': ' : '') + val + ' of ' + max);
    var c = [];
    if (kind === 'pips') {
      for (var i = 0; i < max; i++) c.push(el('span', [['class', i < val ? 'ui-pip is-on' : 'ui-pip']]));
    } else {
      var segs = [];
      if (max === 1) segs.push(el('circle', [['class', val ? 'ui-wedge is-on' : 'ui-wedge'], ['cx', '16'], ['cy', '16'], ['r', '14']], [], 'svg'));
      else for (var j = 0; j < max; j++) {
        var a0 = (j / max) * 2 * Math.PI - Math.PI / 2, a1 = ((j + 1) / max) * 2 * Math.PI - Math.PI / 2;
        var d = 'M16 16L' + fix(16 + 14 * Math.cos(a0)) + ' ' + fix(16 + 14 * Math.sin(a0)) + 'A14 14 0 0 1 ' + fix(16 + 14 * Math.cos(a1)) + ' ' + fix(16 + 14 * Math.sin(a1)) + 'Z';
        segs.push(el('path', [['class', j < val ? 'ui-wedge is-on' : 'ui-wedge'], ['d', d]], [], 'svg'));
      }
      segs.push(el('circle', [['class', 'ui-clock-rim'], ['cx', '16'], ['cy', '16'], ['r', '14']], [], 'svg'));
      c.push(el('svg', [['class', 'ui-clock'], ['viewBox', '0 0 32 32'], ['aria-hidden', 'true'], ['focusable', 'false']], segs, 'svg'));
    }
    if (o.show) c.push(el('span', [['class', 'ui-meter-text']], [txt((o.label ? str(o.label) + ' ' : '') + val + '/' + max)]));
    return el('span', a, c);
  };

  /* ---------- the public helper ---------- */
  /* the phone's bottom bar (KS17): a nav holding one tab row (the Tabs part, so B68Ui.wireTabs moves along it); o.fixed sticks it to the foot */
  T.bottombar = function (o) {
    var a = hooks([['class', classes(o.fixed ? ['ui-bottombar', 'ui-bottombar--fixed'] : ['ui-bottombar'], o.cls)]], o);
    if (o.label) put(a, 'aria-label', o.label);
    return el('nav', a, [T.tabs({ items: o.items, value: o.value, cls: 'ui-bottombar-tabs' })]);
  };

  var FNS = ['button', 'seg', 'tabs', 'chip', 'card', 'row', 'field', 'meter', 'key', 'dot', 'link', 'menu', 'bottombar'];
  var M = { VERSION: 1, PARTS: PARTS, FNS: FNS.slice(), esc: esc };
  FNS.forEach(function (n) { M[n] = function (o) { return html(T[n](norm(o))); }; });
  M.part = function (d) { d = norm(d); var f = T[d.part]; return typeof f === 'function' ? html(f(d)) : ''; };
  M.node = function (name, o, doc) {
    var f = T[name]; if (typeof f !== 'function') return null;
    doc = doc || (W && W.document);
    return doc ? dom(f(norm(o)), doc) : null;
  };
  M.fill = function (rootEl, map) {
    if (!rootEl || !map || typeof rootEl.querySelector !== 'function') return rootEl;
    Object.keys(map).forEach(function (k) {
      if (!SLOT_OK.test(k)) return;
      var s = rootEl.querySelector('[data-ui-slot="' + k + '"]');
      if (s) s.textContent = str(map[k]);
    });
    return rootEl;
  };

  /* ---------- the two delegated guards (KS02b): each is added once per root, never per control ---------- */
  function enabledTabs(list) {
    return Array.prototype.slice.call(list.querySelectorAll('[role="tab"]')).filter(function (t) {
      return !t.disabled && t.getAttribute('aria-disabled') !== 'true';
    });
  }
  function onTabKey(e) {
    var k = e.key;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !k) return;
    var t = e.target && typeof e.target.closest === 'function' ? e.target.closest('[role="tab"]') : null;
    var list = t && t.closest('[role="tablist"]');
    if (!list) return;
    if (e.currentTarget) {          /* nested wired roots: only the nearest one above this tablist answers */
      var own = list;
      while (own && !own[WIRED_TABS]) own = own.parentNode;
      if (own && own !== e.currentTarget) return;
    }
    var vertical = list.getAttribute('aria-orientation') === 'vertical';
    var prev = vertical ? 'ArrowUp' : 'ArrowLeft', next = vertical ? 'ArrowDown' : 'ArrowRight';
    if (k !== prev && k !== next && k !== 'Home' && k !== 'End') return;
    var tabs = enabledTabs(list), i = tabs.indexOf(t);
    if (i < 0) return;
    var to = k === 'Home' ? 0 : k === 'End' ? tabs.length - 1 : k === next ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length;
    e.preventDefault();
    if (tabs[to] === t) return;
    tabs.forEach(function (x) { x.setAttribute('tabindex', x === tabs[to] ? '0' : '-1'); });
    tabs[to].focus();
    tabs[to].click();
  }
  M.wireTabs = function (rootEl) {
    if (!rootEl || typeof rootEl.addEventListener !== 'function' || rootEl[WIRED_TABS]) return rootEl;
    rootEl[WIRED_TABS] = true;
    rootEl.addEventListener('keydown', onTabKey);
    return rootEl;
  };
  function onBusy(e) {
    var t = e.target && typeof e.target.closest === 'function' ? e.target.closest(BUSY) : null;
    if (!t) return;
    if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault(); e.stopPropagation();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
  }
  M.guardBusy = function (rootEl) {
    if (!rootEl || typeof rootEl.addEventListener !== 'function' || rootEl[WIRED_BUSY]) return rootEl;
    rootEl[WIRED_BUSY] = true;
    rootEl.addEventListener('click', onBusy, true);
    rootEl.addEventListener('keydown', onBusy, true);
    return rootEl;
  };
  return M;
});
