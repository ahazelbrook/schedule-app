// The kit harness's shared code (KS04): the layout fingerprint, the request log, the comparison and the helpers the kit checks use.
// Imported by scripts/demo-night-shots.mjs (which writes the files) and by checks/runtime/kit-off.e2e.mjs (which compares them).
// No dependency beyond node and the Playwright page it is handed.
//
// THE FINGERPRINT FILE  <scenario>-<width>.json, beside <scenario>-<width>.png   (the same names demo-night's shots already have)
//   { v: 1, scenario, width, height, at, styleKeys: [css property names], styles: [[value per styleKey], ...] (each distinct set once),
//     masks: [selector], exempt: [selector], els: [[key, tag, id, classes, x, y, w, h, styleIndex, flags], ...] }
//   key      the element's place in the page: parent key + "/" + (tag#id | tag.class.class:n), n counting siblings of the same tag and classes.
//            One element added or taken away does not renumber its cousins, so a difference stays one difference.
//   x y w h  the border box in page pixels (the scroll offset added), two decimals. Skipped: svg and canvas insides, script, style, template.
//   flags    "m" the element is inside a mask (time or chance decides it: its box and styles are not compared), "x" inside an exemption.
// THE REQUEST FILE  requests-<screen>.json   { v: 1, screen: "gm" | "display" | "phone" | "other", urls: ["METHOD /path?param&param", ...] }
//   every request the pages of that screen made over the whole run, de-duplicated and sorted; query values are dropped (a time or a cursor is not a request).

export const STYLE_KEYS = ['display', 'position', 'width', 'height', 'margin', 'padding', 'font-size', 'font-weight', 'line-height', 'color', 'background-color',
  'border', 'border-radius', 'box-shadow', 'opacity', 'z-index', 'overflow', 'visibility', 'transform'];

/* what the clock or chance decides: not compared for box or style (the element's place and classes still are) */
export const MASKS = ['#toastMsg', '#toastErr', '.gm-toast', '[data-kit-mask]'];
/* masks applied when two fingerprints are compared (a pattern on the element's key): what a first look at two baselines showed the clock or chance decides.
   Kept beside MASKS so a new one needs no new capture. Each is listed in kit-off's output. */
/* Row 2 of the band is live text (the clock, what the iPad shows, the cue, the quiet list): what a poll has told it moves everything after it sideways. Inside it, left and
   width are not compared (height, top, classes, ids, styles are). Each entry: a key pattern and the axes let go. */
export const LOOSE_AXES = [{ keys: 'gm-band-r2', axes: ['x'], styles: ['margin'], why: 'band row 2 holds live text; a poll moves the cells after it sideways (left only: widths are held, bar the beat pill below)' },
  { keys: 'gm-band-r2:\\d+/span#gm-bar-beat', axes: ['w'], why: 'the band\'s beat pill: its words are the running beat, live' },
  { keys: '#pp-run-order/div\\.rl-tablewrap:\\d+/table:\\d+/t(head|body):\\d+/tr', axes: ['x', 'w'], why: 'the run order\'s columns are as wide as the running beat\'s clock (mm:ss, live): the cells move sideways' }];
/* A masked key lets go of BOX AND STYLE ONLY, for the element its pattern matches and everything inside it. Existence, ids and classes are still compared: an element
   of a masked region that is taken away, added or reclassed is a difference (the review of KS04: a mask must never hide the band tray's Send, Clear, Blank, live pill
   or Auto, the Run view's players chip, the iPad line, a Tonight line or a Debrief card). Each entry: the key pattern and why. */
export const MASK_KEYS = [
  { keys: '#gm-ipad-now', why: 'the iPad line: what the iPad has been told, as the poll lands' },
  { keys: 'gm-tn-line', why: 'Tonight\'s lines count minutes to the clock' },
  { keys: '#gm-bar-tray', why: 'the band tray\'s live pill names what the iPad shows, as the poll lands (its width moves Send, Clear, Blank and Auto)' },
  { keys: 'gm-band-quiet', why: 'the quiet list: what the polls have filed' },
  { keys: 'rv-players', why: 'the Run view\'s players chip: presence arrives with the polls' },
  { keys: 'gm-debrief-card', why: 'a Debrief card\'s heading names the weekday' },
  { keys: 'span\\.pp-clock', why: 'a run-order beat\'s clock: mm:ss since the beat started, or the time it started' }
];
/* State classes: a class that the clock or a poll turns on and off. It is taken out of the element's key before two fingerprints are compared (so the element is
   still matched, and still has to exist), and that element's own box and style are let go. Nothing else about it is forgiven. Each entry: the class the element
   always carries, the classes dropped, why. */
export const STATE_CLASSES = [
  { on: 'pp-clock', drop: ['due', 'late'], why: 'a running beat turns due, then late, by the clock' }
];
/* Live slots: an element (the pattern matches ITS key) that a poll fills. The slot itself must exist on both sides. When it is empty on one side and filled on the
   other, what is inside it is let go (listed); when both sides have something inside, every element inside is compared as usual. So the quiet badge may not have
   arrived yet, but a quiet list that lost its Dismiss button is still a difference. */
export const LIVE_SLOTS = [
  { keys: 'span\\.gm-band-quiet:\\d+$', why: 'the quiet badge: the quiet line\'s own 8-second poll fills the slot (app/gm/quiet.js POLL_MS)' },
  { keys: 'p#gm-ipad-now$', why: 'the iPad line says "Not known yet" until the first ambient poll lands' }
];

/* THE EXEMPTIONS: where "off means today" is deliberately not true, each one named, each with its reason, each printed by kit-off. Adding one is one line here.
   An exemption finds its elements one of three ways: `selector` (a CSS selector, matched in the page at capture time: the element and everything inside it), `text` (a
   leaf element whose own text matches, matched at capture time) or `keys` (a pattern on the element's key, matched when two fingerprints are compared, so it needs no
   new capture and covers elements the baseline has and this run has not). An exempt element may be new, gone or changed: its box and styles are skipped, and the
   layout that new ones push down is allowed for (see compare). KS04.2 lists the first three and only these; later ones come with the ticket that discloses them. */
export const KIT_SETTING_KEYS = ['kit.desk', 'kit.stage', 'kit.phone', 'night.who', 'blade.pitches'];
export const EXEMPTIONS = [
  { name: 'the five new Settings rows', reason: 'KS01.1 added kit.desk, kit.stage, kit.phone, night.who and blade.pitches to the Settings of the iPad view',
    selector: KIT_SETTING_KEYS.map((k) => '#gm-ipad-settings [data-set-row="' + k + '"]').join(', ') },
  { name: 'the Settings intro line', reason: 'KS01.1 reworded app/gm/settings.js:139 ("These five are choices" to "These are choices")', selector: '#gm-ipad-settings > p.gm-dim' },
  { name: 'the Preflight file count', reason: 'it counts bundles: kit-flag.js made "0 of 107 kept" read 108', text: String.raw`\d+ of \d+ kept` },
  { name: 'the four map Settings rows', reason: 'MK1 added map.fill, map.people, map.lights and map.room (GM settings, off) to the Settings of the iPad view',
    selector: ['map.fill', 'map.people', 'map.lights', 'map.room'].map((k) => '#gm-ipad-settings [data-set-row="' + k + '"]').join(', ') },
  { name: 'the Players screen Settings row', reason: 'IP2 added stage.players (a display setting, off) to the Settings of the iPad view, the first row after the five rows of day 0',
    selector: '#gm-ipad-settings [data-set-row="stage.players"]' },
  { name: 'the Handouts on phones Settings row', reason: 'IP4 added phone.handouts (a phone setting, off) as the last row of the Settings of the iPad view',
    selector: '#gm-ipad-settings [data-set-row="phone.handouts"]' },
  { name: 'the eighteenth scene tile (The landing)', reason: 'IP8 added a new ambient scene, the landing, to the scene tiles of the iPad view: a deliberate visible addition with every setting off',
    selector: '.gm-ipad-tiles [data-gm="ambscene"][data-id="landing"]', pushes: false }      /* it fills the empty second slot of the last tile row at every width: nothing moves for it */
];
/* Not here: KS12's score-scene polaroids (disclosed in KS12's PR). They are drawn inside the score scene's iframe, which a fingerprint does not walk, and no baseline
   scenario shows a scene iframe, so an exemption for them would match nothing.
   Not here either: PA (prep actions, no setting). Its chips appear only where a prep note holds an action span, and the demo night's note holds none, so
   gm/prep-actions.js and .css are never fetched; its ✕ on the Prep person card and the Run view NPC card (and their CSS) exist only while a card is open,
   and no baseline scenario opens one. The Preflight file count it raises by two is the exemption above. */

/* In the page: walk the body and describe every element. Written as a string-free function so Playwright can serialise it. */
function inPage(arg) {
  const { styleKeys, masks, exemptions } = arg;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META']);
  const LEAF_ONLY = new Set(['svg', 'canvas']);
  const exs = exemptions.map((e) => ({ sel: e.selector || '', re: e.text ? new RegExp(e.text) : null }));
  const exOf = (c) => { for (let i = 0; i < exs.length; i++) { const e = exs[i]; if (e.sel) { try { if (c.matches(e.sel)) return i; } catch (x) { /* a bad selector matches nothing */ } } if (e.re && !c.children.length && (c.textContent || '').length < 80 && e.re.test(c.textContent || '')) return i; } return -1; };
  const sx = window.scrollX || 0, sy = window.scrollY || 0;
  const styles = [], styleIdx = new Map(), els = [];
  const r2 = (n) => Math.round(n * 100) / 100;
  const prop = (cs, p) => {
    if (p === 'border') return ['top', 'right', 'bottom', 'left'].map((s) => cs.getPropertyValue('border-' + s + '-width') + ' ' + cs.getPropertyValue('border-' + s + '-style') + ' ' + cs.getPropertyValue('border-' + s + '-color')).join(' | ');
    const v = cs.getPropertyValue(p);
    if (v !== '') return v;
    if (p === 'margin' || p === 'padding') return ['top', 'right', 'bottom', 'left'].map((s) => cs.getPropertyValue(p + '-' + s)).join(' ');
    if (p === 'border-radius') return ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((s) => cs.getPropertyValue('border-' + s + '-radius')).join(' ');
    return v;
  };
  const inside = (el, sels) => sels.some((s) => { try { return !!el.closest(s); } catch (e) { return false; } });
  function walk(el, parentKey, maskedUp, exemptUp) {      /* exemptUp: the letter of the exemption an ancestor is in, or '' */
    const counts = new Map();
    for (const c of el.children) {
      if (SKIP.has(c.tagName)) continue;
      const tag = c.tagName.toLowerCase();
      const cls = typeof c.className === 'string' ? c.className.trim().split(/\s+/).filter(Boolean).sort() : (c.getAttribute && (c.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).sort()) || [];
      const sig = c.id ? tag + '#' + c.id : tag + (cls.length ? '.' + cls.join('.') : '');
      const n = (counts.get(sig) || 0) + 1; counts.set(sig, n);
      const key = parentKey + '/' + sig + (c.id ? '' : ':' + n);
      const masked = maskedUp || inside(c, masks);
      const xi = exOf(c), ex = exemptUp || (xi >= 0 ? 'x' + String.fromCharCode(97 + xi) : '');
      const cs = getComputedStyle(c), r = c.getBoundingClientRect();
      const vals = styleKeys.map((p) => prop(cs, p)), sk = vals.join('\u0001');
      let si = styleIdx.get(sk); if (si === undefined) { si = styles.length; styleIdx.set(sk, si); styles.push(vals); }
      els.push([key, tag, c.id || '', cls.join(' '), r2(r.left + sx), r2(r.top + sy), r2(r.width), r2(r.height), si, (masked ? 'm' : '') + ex]);
      if (!LEAF_ONLY.has(tag)) walk(c, key, masked, ex);
    }
  }
  walk(document.body, 'body', false, '');
  return { styles, els, width: innerWidth, height: innerHeight, docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight };
}

/* A fingerprint of the page as it stands. Animations are stopped first (a running one moves a transform between two reads): by a style the test adds. */
export async function fingerprint(page, scenario, width, opts = {}) {
  const masks = MASKS.concat(opts.masks || []);
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' }).catch(() => {});
  await page.waitForTimeout(150);
  const r = await page.evaluate(inPage, { styleKeys: STYLE_KEYS, masks, exemptions: EXEMPTIONS });
  return { v: 1, scenario, width, height: r.height, at: new Date().toISOString(), styleKeys: STYLE_KEYS, masks, exempt: EXEMPTIONS.map((e) => e.name), styles: r.styles, els: r.els };
}

/* Two fingerprints, base and cur. Returns { diffs: [{ kind, key, detail }], exempted: ["<exemption name>: new|gone <key tail>"] }.
   ids and classes are exact (they are in the key: a change shows as a missing element and an extra one); a box moves by tol pixels at most; styles are exact.
   Exempt elements that cur has and base has not are listed and skipped, and the layout they push down is allowed for: an element at or below the first of them
   may sit lower by exactly the height the exempt rows add, and an ancestor of them may grow by it (so that one new row is not forty differences); rows with no
   box (a hidden pane) push nothing. Masks (MASKS, MASK_KEYS, STATE_CLASSES) let go of box and style only; LIVE_SLOTS let a slot's contents arrive or not, all
   or nothing; LOOSE_AXES let named axes go. Nothing else is forgiven. */
/* The keys again, with the state classes (STATE_CLASSES) taken out and the sibling numbers counted afresh: els in document order (a parent before its children,
   as the walk wrote them). Returns [els with new keys, Set of the new keys whose own class was a state class]. With no state class in a file nothing changes. */
/* an element's classes, the state classes taken out, sorted: what compare holds exact on every matched element */
function classesOf(e, rules) {
  let cls = e[3] ? e[3].split(' ') : [];
  for (const r of rules) if (cls.includes(r.on)) cls = cls.filter((c) => !r.drop.includes(c));
  return cls.sort().join(' ');
}
function rekey(els, rules) {
  /* pass 1: each element's own new signature; the sibling groups (parent + signature) a dropped class lands in are counted afresh, every other key is kept as written */
  const info = els.map((e) => {
    let cls = e[3] ? e[3].split(' ') : [], dropped = false;
    for (const r of rules) if (cls.includes(r.on)) { const n = cls.filter((c) => !r.drop.includes(c)); if (n.length !== cls.length) dropped = true; cls = n; }
    return { dropped, sig: e[2] ? e[1] + '#' + e[2] : e[1] + (cls.length ? '.' + cls.join('.') : '') };
  });
  if (!info.some((x) => x.dropped)) return [els, new Set()];
  const pk = (k) => k.slice(0, k.lastIndexOf('/'));
  const touched = new Set(); els.forEach((e, i) => { if (info[i].dropped) touched.add(pk(e[0]) + '\u0000' + info[i].sig); });
  const map = new Map(), counts = new Map(), out = [], stated = new Set();
  els.forEach((e, i) => {
    const k = e[0], op = pk(k), np = map.has(op) ? map.get(op) : op, sig = info[i].sig, group = op + '\u0000' + sig;
    let nk;
    if (touched.has(group)) { const n = (counts.get(group) || 0) + 1; counts.set(group, n); nk = np + '/' + sig + (e[2] ? '' : ':' + n); }
    else nk = np + k.slice(op.length);
    map.set(k, nk); out.push([nk].concat(e.slice(1)));
    if (info[i].dropped) stated.add(nk);
  });
  return [out, stated];
}

export function compare(base, cur, opts = {}) {
  const tol = opts.tol === undefined ? 1 : opts.tol;
  const diffs = [], exempted = [];
  const rules = opts.stateClasses || STATE_CLASSES;
  const [bEls, bStated] = rekey(base.els, rules), [cEls, cStated] = rekey(cur.els, rules);
  const B = new Map(bEls.map((e) => [e[0], e])), C = new Map(cEls.map((e) => [e[0], e]));
  const mk = (opts.maskKeys || MASK_KEYS).map((x) => new RegExp(typeof x === 'string' ? x : x.keys));
  const exs = (opts.exemptions || EXEMPTIONS), xk = exs.map((e) => (e.keys ? new RegExp(e.keys) : null));
  /* an element's flags: those captured, 'm' if a mask pattern matches its key or its own class was a state class, and an exemption whose `keys` pattern matches its key.
     'm' lets go of box and style only; 'x' (an exemption) also lets the element be new or gone. */
  const loose = (opts.looseAxes || LOOSE_AXES).map((l) => ({ re: new RegExp(l.keys), axes: l.axes, styles: l.styles }));
  const fl = (e) => { let f = (e[9] || '') + (mk.some((re) => re.test(e[0])) || bStated.has(e[0]) || cStated.has(e[0]) ? 'm' : ''); if (!/x/.test(f)) { const i = xk.findIndex((re) => re && re.test(e[0])); if (i >= 0) f += 'x' + String.fromCharCode(97 + i); } return f; };
  const nameOf = (e) => { const m = /x([a-z])/.exec(fl(e)); const x = m ? exs[m[1].charCodeAt(0) - 97] : null; return x ? x.name : 'an exemption'; };
  /* live slots empty on one side and filled on the other: the keys inside them are let go for existence (the slot is not) */
  const pollKeys = new Set();
  for (const s of (opts.liveSlots || LIVE_SLOTS)) {
    const re = new RegExp(s.keys);
    for (const k of new Set([...B.keys(), ...C.keys()])) {
      if (!re.test(k) || !B.has(k) || !C.has(k)) continue;
      const p = k + '/', inB = [...B.keys()].filter((x) => x.startsWith(p)), inC = [...C.keys()].filter((x) => x.startsWith(p));
      if ((inB.length === 0) !== (inC.length === 0)) { inB.concat(inC).forEach((x) => pollKeys.add(x)); exempted.push('a live slot a poll had ' + (inB.length ? 'filled only in the baseline' : 'filled only in this run') + ' (' + s.why + '): ' + k.split('/').slice(-2).join('/')); }
    }
  }
  /* new exempt elements (the new Settings rows): where they sit, only those with a box (a row in a hidden pane is 0x0 at the top of the page: it pushes nothing) */
  let firstY = Infinity, lastY = -Infinity;
  const newTops = [];
  for (const [k, e] of C) if (!B.has(k) && fl(e).includes('x')) {
    exempted.push(nameOf(e) + ': new ' + k.split('/').slice(-2).join('/'));
    const parent = k.slice(0, k.lastIndexOf('/'));
    const own = /x([a-z])/.exec(fl(e)), ex = own ? exs[own[1].charCodeAt(0) - 97] : null;      /* an exemption with pushes: false (an element in a slot that was empty) is new but moves nothing: it stays out of the span, so anything it did push is a difference */
    if ((!C.has(parent) || !fl(C.get(parent)).includes('x')) && e[6] > 0 && e[7] > 0 && !(ex && ex.pushes === false)) { firstY = Math.min(firstY, e[5]); lastY = Math.max(lastY, e[5] + e[7]); newTops.push(k); }
  }
  const pushed = newTops.length > 0;
  const ancestorOfNew = (k) => newTops.some((t) => t.startsWith(k + '/'));
  const plain = (b, c) => !(fl(b).includes('m') || fl(c).includes('m') || fl(b).includes('x') || fl(c).includes('x'));
  /* What the new rows add: the span they fill plus one gap (the space between two of them, as the row before the first one has). Every element below them in the
     same flow sits lower by exactly that amount, and only that amount is let go, only below the first row; an element moved by anything else is a difference.
     Height: only an ancestor of a new row may grow, and by that same amount. */
  let added = null;
  if (pushed) {
    const ys = newTops.map((k) => C.get(k)).sort((p, q) => p[5] - q[5]);
    let gap = Infinity; for (let i = 1; i < ys.length; i++) gap = Math.min(gap, ys[i][5] - (ys[i - 1][5] + ys[i - 1][7]));
    added = Math.round((lastY - firstY + (gap === Infinity || gap < 0 ? 0 : gap)) * 100) / 100;
    let n = 0; for (const [k, c] of C) { const b = B.get(k); if (b && plain(b, c) && b[5] >= firstY - tol && Math.abs(c[5] - b[5] - added) <= tol) n++; }
    exempted.push('pushed down by the new rows: ' + added + ' px, on ' + n + ' element(s) below them');
  }
  /* new exempt rows make a scrolled pane taller, so a page that scrolls an element into view comes to rest elsewhere: every element then sits lower or higher by the same amount.
     That one shared amount (seen on at least 8 elements) is let go, only when new exempt rows with a box exist; an element that moved by anything else is still a difference. */
  let shift = null;
  if (pushed) {
    const cnt = new Map();
    for (const [k, c] of C) { const b = B.get(k); if (!b || !plain(b, c)) continue; const d = Math.round((c[5] - b[5]) * 2) / 2; if (Math.abs(d) > tol && !(added !== null && Math.abs(d - added) <= tol && b[5] >= firstY - tol)) cnt.set(d, (cnt.get(d) || 0) + 1); }
    let best = 0; for (const [d, n] of cnt) if (n > best) { best = n; shift = d; }
    if (best < 8) shift = null; else exempted.push('the scroll position of a pane the new rows made taller: ' + shift + ' px on ' + best + ' elements');
  }
  for (const [k, b] of B) {
    if (!C.has(k)) { if (pollKeys.has(k)) continue; if (!fl(b).includes('x')) diffs.push({ kind: 'missing', key: k, detail: 'in the baseline, not in this run' }); else exempted.push(nameOf(b) + ': gone ' + k.split('/').slice(-2).join('/')); }
  }
  for (const [k, c] of C) {
    const b = B.get(k);
    if (!b) { if (pollKeys.has(k)) continue; if (!fl(c).includes('x')) diffs.push({ kind: 'extra', key: k, detail: 'in this run, not in the baseline (' + c[1] + (c[2] ? '#' + c[2] : '') + (c[3] ? '.' + c[3].replace(/ /g, '.') : '') + ')' }); continue; }
    /* classes are exact on every matched element, masked or not (a key with an id does not carry its classes): only an exemption or a state class lets one go */
    if (!fl(b).includes('x') && !fl(c).includes('x')) { const cb = classesOf(b, rules), cc = classesOf(c, rules); if (cb !== cc) diffs.push({ kind: 'class', key: k, detail: '"' + cb + '" -> "' + cc + '"' }); }
    if (!plain(b, c)) continue;
    const below = b[5] >= firstY - tol;
    const box = ['x', 'y', 'w', 'h'].map((n, i) => ({ n, b: b[4 + i], c: c[4 + i] }));
    const off = box.filter((q) => {
      const d = q.c - q.b;
      if (Math.abs(d) <= tol) return false;
      if (loose.some((l) => l.re.test(k) && l.axes.includes(q.n))) return false;
      if (shift !== null && q.n === 'y' && Math.abs(d - shift) <= tol) return false;
      if (added !== null && q.n === 'y' && below && Math.abs(d - added) <= tol) return false;                 /* pushed down by the new rows */
      if (added !== null && q.n === 'h' && ancestorOfNew(k) && Math.abs(d - added) <= tol) return false;     /* an ancestor of the new rows grew with them */
      return true;
    });
    if (off.length) diffs.push({ kind: 'box', key: k, detail: off.map((q) => q.n + ' ' + q.b + ' -> ' + q.c).join(', ') });
    const sb = base.styles[b[8]], sc = cur.styles[c[8]];
    const NOT_EXACT = new Set(['width', 'height'].concat(...loose.filter((l) => l.re.test(k)).map((l) => l.styles || [])));        /* computed width and height are the box, which is held to tol above (a sub-pixel of text is not a difference) */
    if (b[8] !== undefined && sb.join('\u0001') !== sc.join('\u0001')) {
      const ch = []; base.styleKeys.forEach((p, i) => { if (sb[i] !== sc[i] && !NOT_EXACT.has(p)) ch.push(p + ' ' + JSON.stringify(sb[i]) + ' -> ' + JSON.stringify(sc[i])); });
      if (ch.length) diffs.push({ kind: 'style', key: k, detail: ch.slice(0, 4).join('; ') });
    }
  }
  return { diffs, exempted };
}

/* ---------- the request log ---------- */
export function screenOf(route) { return /^#gm/.test(route) ? 'gm' : /^#display/.test(route) ? 'display' : /^#c\//.test(route) ? 'phone' : 'other'; }
export function normRequest(method, url) {
  let u; try { u = new URL(url); } catch (e) { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const q = [...new Set([...u.searchParams.keys()])].sort().join('&');
  return method + ' ' + u.pathname + (q ? '?' + q : '');
}
/* Starts logging a page's requests into set; returns nothing (the page's own listener ends with the page). */
export function logRequests(page, set) { page.on('request', (rq) => { const s = normRequest(rq.method(), rq.url()); if (s) set.add(s); }); }
export function requestFile(screen, set) { return { v: 1, screen, urls: [...set].sort() }; }

/* The five settings by their short names (the --kit flag and the checks use these), and how a run turns them on: the GM state's features map, and the
   campaign document's (the display and the phones read the campaign's, which the GM page copies; a demo night with no GM page open writes both). */
export const KIT_SHORT = { desk: 'kit.desk', stage: 'kit.stage', phone: 'kit.phone', who: 'night.who', pitches: 'blade.pitches' };
export function kitIds(list) {
  const out = [];
  for (const s of String(list || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    if (s === 'none') continue;
    if (s === 'all') { out.push(...Object.values(KIT_SHORT)); continue; }
    if (!KIT_SHORT[s]) throw new Error('--kit takes ' + Object.keys(KIT_SHORT).join(', ') + ' (all or none); got "' + s + '"');
    out.push(KIT_SHORT[s]);
  }
  return [...new Set(out)];
}
/* ---------- the clock ---------- */
/* The demo night's pages run on the real clock: the prep note starts at 19:30 and the curfew is 22:40, so a picture taken at 18:00 and one taken at 21:00 differ
   (BEFORE to 19:30, "209 min"). A fingerprint run therefore lives at a fixed time of day: a constant offset puts the time of day at HH:MM when the run starts, in the
   harness (vnow(): everything it writes with a time) and in every page (a Date that adds the same offset, from its first script). Time still runs at its own speed.
   Things the Worker stamps itself still carry the real time. --clock real turns it off; --fingerprint sets 20:00 unless told otherwise. */
export const CLOCK = { delta: 0, at: '' };
export function setClock(hhmm) {
  if (!hhmm || hhmm === 'real') { CLOCK.delta = 0; CLOCK.at = ''; return; }
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm); if (!m) throw new Error('--clock takes HH:MM or real');
  const d = new Date(); d.setHours(+m[1], +m[2], 0, 0); CLOCK.delta = d.getTime() - Date.now(); CLOCK.at = hhmm;
}
export const vnow = () => Date.now() + CLOCK.delta;
/* a Playwright init script (function and argument) that gives the page the same offset; null when the clock is real */
export function clockScript() {
  if (!CLOCK.delta) return null;
  return [function (delta) {
    const R = Date, now = () => R.now() + delta;
    function D(...a) { if (!new.target) return new R(now()).toString(); return a.length ? new R(...a) : new R(now()); }
    D.prototype = R.prototype; D.now = now; D.parse = R.parse; D.UTC = R.UTC; Object.setPrototypeOf(D, R);
    window.Date = D;
  }, CLOCK.delta];
}

/* ---------- running the demo night from a check ---------- */
/* the environment a child gets: the Anthropic keys taken out (no API call may happen from the harness; demo-night takes them out of the Worker's too) */
export function noKey() { const e = { ...process.env, CI: '1' }; delete e.B68_ANTHROPIC_KEY; delete e.ANTHROPIC_API_KEY; return e; }
/* Boots the demo night on port (a temp state folder, removed by stop()) and resolves once it says it is up: { stop, out(), base, state }. extra: more demo-night flags
   (--kit desk,stage ...). The Worker has the Anthropic keys taken out of its environment by demo-night itself. */
export async function startDemo(root, port, extra = []) {
  const { spawn, spawnSync } = await import('node:child_process'), fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const base = 'http://127.0.0.1:' + port;
  if (await fetch(base + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) throw new Error('port ' + port + ' is already in use');
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-kit-'));
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'demo-night.mjs'), '--port', String(port), '--state', state, ...extra], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: noKey() });
  let log = '';
  child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  const stop = async () => {
    if (child.pid) { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { try { child.kill('SIGKILL'); } catch (e2) { /* gone */ } } } }
    await sleep(800); try { fs.rmSync(state, { recursive: true, force: true }); } catch (e) { /* a lingering handle */ }
  };
  for (let i = 0; i < 240 && !/Ctrl\+C stops it/.test(log); i++) { await sleep(500); if (child.exitCode !== null) break; }
  if (!/Ctrl\+C stops it/.test(log)) { await stop(); throw new Error('the demo night did not come up:\n' + log.slice(-1500)); }
  return { stop, out: () => log, base, state };
}
/* The same, for a run that takes its own pictures and exits: scripts/demo-night.mjs --shots dir ...; resolves { status, out } when it ends (or at timeoutMs, killed). */
export async function runShots(root, port, dir, extra = [], timeoutMs = 2700000) {
  const { spawn, spawnSync } = await import('node:child_process'), path = await import('node:path');
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'demo-night.mjs'), '--port', String(port), '--shots', dir, ...extra], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: noKey() });
  let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
  const kill = () => { if (child.pid) { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { /* gone */ } } } };
  const timer = setTimeout(kill, timeoutMs);
  const status = await new Promise((res) => child.on('close', (c) => res(c)));
  clearTimeout(timer); kill();
  return { status, out };
}

/* ---------- two folders ---------- */
/* The new requests allowed with every setting off, each named with its reason (printed by kit-off): a file the page now fetches that makes
   nothing, listens to nothing, starts no timer, sends no request and writes no storage until its setting is on. */
const REQ = (p) => new RegExp('^GET /(app/)?' + p.replace(/[.]/g, '[.]') + '([?].*)?$');
export const ALLOWED_NEW_REQUESTS = [
  { name: 'kit-flag.js', reason: 'the kit flag\'s own file, the one deliberate new request of Gate 0', test: REQ('ui/kit-flag.js') },
  { name: 'the players\' screen files (display)', reason: 'IP2/IP3 (stage.players, off): display/players/players.js and intro.js only define B68PlayersScreen and B68PlayersIntro, attached by display-page.js only while the setting is on; ' +
      'players.css and intro.css only style .p2-* and .pi-* markup, which only those files make',
    test: (u) => ['display/players/players.js', 'display/players/players.css', 'display/players/intro.js', 'display/players/intro.css'].some((p) => REQ(p).test(u)) },
  { name: 'the players\' screen files (GM)', reason: 'IP2/IP3/IP6 (stage.players, off): gm/players-screen.js, players-intro.js and players-board.js only define their modules; ' +
      'gm-page.js calls them only behind b09On(\'stage.players\') (the queue\'s probe fetch and every listener start there)',
    test: (u) => ['gm/players-screen.js', 'gm/players-intro.js', 'gm/players-board.js'].some((p) => REQ(p).test(u)) }
];
export const allowedRequest = (u) => ALLOWED_NEW_REQUESTS.find((a) => a.test instanceof RegExp ? a.test.test(u) : a.test(u)) || null;
export const ALLOWED_NEW_REQUEST = { test: (u) => !!allowedRequest(u) };      /* the old name, kept for its callers */
/* Every <scenario>-<width>.json of base against cur, and every requests-<screen>.json.
   Returns { compared, absent: [files cur lacks], diffs: [{ file, kind, key, detail }], exempted: [{ file, note }], requests: { screen: { extra, missing, allowed } } }. */
export async function compareFolders(baseDir, curDir, opts = {}) {
  const fs = await import('node:fs'), path = await import('node:path');
  const rd = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  const out = { compared: 0, absent: [], diffs: [], exempted: [], requests: {} };
  for (const f of fs.readdirSync(baseDir).sort()) {
    if (!f.endsWith('.json') || f.startsWith('requests-') || f === 'baseline-meta.json') continue;
    if (opts.only && !opts.only.some((o) => f.startsWith(o))) continue;
    if (!fs.existsSync(path.join(curDir, f))) { out.absent.push(f); continue; }
    const r = compare(rd(path.join(baseDir, f)), rd(path.join(curDir, f)), opts);
    out.compared++;
    for (const d of r.diffs) out.diffs.push({ file: f, ...d });
    for (const n of r.exempted) out.exempted.push({ file: f, note: n });
  }
  for (const f of fs.readdirSync(baseDir).filter((x) => /^requests-.*\.json$/.test(x))) {
    const screen = f.slice(9, -5), b = new Set(rd(path.join(baseDir, f)).urls), cp = path.join(curDir, f);
    const c = new Set(fs.existsSync(cp) ? rd(cp).urls : []);
    const extra = [...c].filter((u) => !b.has(u)), allowed = extra.filter((u) => ALLOWED_NEW_REQUEST.test(u));
    out.requests[screen] = { extra: extra.filter((u) => !allowed.includes(u)), allowed, missing: [...b].filter((u) => !c.has(u)) };
  }
  for (const f of fs.readdirSync(curDir).filter((x) => /^requests-.*\.json$/.test(x))) {
    const screen = f.slice(9, -5);
    if (!out.requests[screen]) { const urls = rd(path.join(curDir, f)).urls; out.requests[screen] = { extra: urls.filter((u) => !ALLOWED_NEW_REQUEST.test(u)), allowed: urls.filter((u) => ALLOWED_NEW_REQUEST.test(u)), missing: [] }; }
  }
  return out;
}

export async function setKit(api, ids) {
  const features = {}; for (const id of Object.values(KIT_SHORT)) features[id] = ids.includes(id);
  for (const p of ['/gm/state', '/campaign']) { const r = await api('PATCH', p, { features }); if (r.status !== 200) throw new Error('PATCH ' + p + ' features: ' + r.status + ' ' + String(r.text || '').slice(0, 200)); }
}
