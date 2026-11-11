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
export const MASK_KEYS = ['#gm-ipad-now', 'gm-tn-line'];      /* the iPad's live line (what the iPad has been told, as the poll lands) and Tonight's lines (they count minutes to the real clock) */

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
  { name: 'the Preflight file count', reason: 'it counts bundles: kit-flag.js made "0 of 107 kept" read 108', text: String.raw`\d+ of \d+ kept` }
  /* , { name: 'score-scene polaroids', reason: 'KS12: with night.who off the score scenes show none (disclosed)', keys: 'dp-polaroid' } */
];

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
   may sit lower by up to the height the exempt rows add (so that one new row is not forty differences). Nothing else is forgiven. */
export function compare(base, cur, opts = {}) {
  const tol = opts.tol === undefined ? 1 : opts.tol;
  const diffs = [], exempted = [];
  const B = new Map(base.els.map((e) => [e[0], e])), C = new Map(cur.els.map((e) => [e[0], e]));
  const mk = (opts.maskKeys || MASK_KEYS).map((x) => new RegExp(x));
  const keyMasked = (k) => mk.some((re) => re.test(k));
  const exs = (opts.exemptions || EXEMPTIONS), xk = exs.map((e) => (e.keys ? new RegExp(e.keys) : null));
  /* an element's flags: those captured, 'm' if a mask pattern matches its key, and an exemption whose `keys` pattern matches its key */
  const fl = (e) => { let f = (e[9] || '') + (mk.some((re) => re.test(e[0])) ? 'm' : ''); if (!/x/.test(f)) { const i = xk.findIndex((re) => re && re.test(e[0])); if (i >= 0) f += 'x' + String.fromCharCode(97 + i); } return f; };
  const nameOf = (e) => { const m = /x([a-z])/.exec(fl(e)); const x = m ? exs[m[1].charCodeAt(0) - 97] : null; return x ? x.name : 'an exemption'; };
  let pushed = 0, firstY = Infinity, lastY = -Infinity;
  for (const [k, e] of C) if (!B.has(k) && fl(e).includes('x')) {
    exempted.push(nameOf(e) + ': new ' + k.split('/').slice(-2).join('/'));
    const parent = k.slice(0, k.lastIndexOf('/'));
    if (!C.has(parent) || !fl(C.get(parent)).includes('x')) { firstY = Math.min(firstY, e[5]); lastY = Math.max(lastY, e[5] + e[7]); }
  }
  if (lastY > -Infinity) pushed = lastY - firstY + 24;      /* the span the new rows fill, and the gaps between them */
  for (const [k, b] of B) {
    if (!C.has(k)) { if (keyMasked(k)) continue; if (!fl(b).includes('x')) diffs.push({ kind: 'missing', key: k, detail: 'in the baseline, not in this run' }); else exempted.push(nameOf(b) + ': gone ' + k.split('/').slice(-2).join('/')); }
  }
  for (const [k, c] of C) {
    const b = B.get(k);
    if (!b) { if (keyMasked(k)) continue; if (!fl(c).includes('x')) diffs.push({ kind: 'extra', key: k, detail: 'in this run, not in the baseline (' + c[1] + (c[2] ? '#' + c[2] : '') + (c[3] ? '.' + c[3].replace(/ /g, '.') : '') + ')' }); continue; }
    if (fl(b).includes('m') || fl(c).includes('m') || fl(b).includes('x') || fl(c).includes('x')) continue;
    const below = b[5] >= firstY - tol;
    const box = ['x', 'y', 'w', 'h'].map((n, i) => ({ n, b: b[4 + i], c: c[4 + i] }));
    const off = box.filter((q) => {
      const d = q.c - q.b;
      if (Math.abs(d) <= tol) return false;
      if (pushed && q.n === 'y' && below && d >= -tol && d <= pushed + tol) return false;           /* pushed down by the new rows */
      if (pushed && q.n === 'h' && d >= -tol && d <= pushed + tol) return false;                      /* an ancestor of the new rows grew with them */
      return true;
    });
    if (off.length) diffs.push({ kind: 'box', key: k, detail: off.map((q) => q.n + ' ' + q.b + ' -> ' + q.c).join(', ') });
    const sb = base.styles[b[8]], sc = cur.styles[c[8]];
    const NOT_EXACT = new Set(['width', 'height']);        /* computed width and height are the box, which is held to tol above (a sub-pixel of text is not a difference) */
    if (b[8] !== undefined && sb.join('\u0001') !== sc.join('\u0001')) {
      const ch = []; base.styleKeys.forEach((p, i) => { if (sb[i] !== sc[i] && !NOT_EXACT.has(p)) ch.push(p + ' ' + JSON.stringify(sb[i]) + ' -> ' + JSON.stringify(sc[i])); });
      if (ch.length && !(pushed && ch.every((s) => /^(width|height) /.test(s) && off.length === 0))) diffs.push({ kind: 'style', key: k, detail: ch.slice(0, 4).join('; ') });
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
export const ALLOWED_NEW_REQUEST = /^GET \/(app\/)?ui\/kit-flag\.js(\?.*)?$/;      /* the one deliberate new request (Gate 0): the kit flag's own file */
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
