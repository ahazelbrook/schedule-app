// The public code carries no GM table text (GM.md, "Secrecy rules"). Five checks:
//   (a) app/gm/**, app/gm-page.js, app/display-page.js and scripts/** (.mjs/.js/.cjs/.sh) name none of the campaign's
//       or the setting's proper nouns (a built-in short list, plus the faction, district, NPC and PC names of the real
//       pack when it is on this machine);
//   (b) the same JavaScript files hold no string literal over 220 characters outside comments (a table pasted in);
//   (c) when the real pack exists, no string of 25+ characters from it appears in any public file under app/,
//       functions/, checks/ or scripts/. Strings the pack shares with app/content.js (the rulebook's public
//       character-creation text, already shipped to every player) are exempt.
//   (d) the GM page's pure guards: only a player-layer map reaches the display, keys, pack validation, the note, patches.
//   (e) when the pack has the npc part: app/gm/npc.js and app/gm/figure-map.js name no faction of npc.T / npc.F (the
//       figure map's faction palette lives in the pack for exactly that reason).
// The pack: $B68_PACK if set (it must then load), else gm-private/b68-gm-pack.json (git-ignored) when present.
// The vault readers (scripts/gm-pack.mjs, gm-parity.mjs, gm-sync.mjs, scripts/lib/**) get no exemption: they find
// the vault's tables by page path, code-fence, heading and frontmatter key, never by a table's content, so they need
// no name and no table text. If one ever must name a vault page by a proper noun, allow that one string by hash
// (as ALLOW below does), never the whole file.
// Nothing from the real pack is printed: a hit names the file, the line and a masked form of the text.
//   node checks/runtime/gm-nosecrets.test.mjs          B68_PACK=<pack.json> node checks/runtime/gm-nosecrets.test.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const read = (f) => fs.readFileSync(f, 'utf8');
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); }
}
const mask = (s) => s.length <= 4 ? '*'.repeat(s.length) : s.slice(0, 2) + '*'.repeat(Math.min(12, s.length - 3)) + s.slice(-1) + ' (' + s.length + ' chars)';
const lineOf = (text, i) => text.slice(0, i).split('\n').length;
const hashOf = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'gm-private', '.wrangler', '.git'].includes(e.name)) walk(f, out); }
    else out.push(f);
  }
  return out;
}

/* the scanned GM files */
const APP_GM_FILES = [...walk(path.join(ROOT, 'app', 'gm')).filter((f) => /\.m?js$/.test(f)), path.join(ROOT, 'app', 'gm-page.js'), path.join(ROOT, 'app', 'display-page.js')].filter((f) => fs.existsSync(f));
const SCRIPT_JS = walk(path.join(ROOT, 'scripts')).filter((f) => /\.(m?js|cjs)$/.test(f));
const SCRIPT_TEXT = walk(path.join(ROOT, 'scripts')).filter((f) => /\.(m?js|cjs|sh)$/.test(f));
const NAME_FILES = APP_GM_FILES.concat(SCRIPT_TEXT);      // (a)
const LITERAL_FILES = APP_GM_FILES.concat(SCRIPT_JS);     // (b)

/* the real pack, if this machine has one ($B68_PACK overrides; when set it must load) */
const PACK_PATH = process.env.B68_PACK ? path.resolve(process.env.B68_PACK) : path.join(ROOT, 'gm-private', 'b68-gm-pack.json');
let PACK = null, PACK_ERR = null;
if (fs.existsSync(PACK_PATH)) { try { PACK = JSON.parse(read(PACK_PATH)); if (!PACK || !PACK.parts) throw new Error('no parts'); } catch (e) { PACK = null; PACK_ERR = e.message; } }
else if (process.env.B68_PACK) PACK_ERR = 'not found';
console.log('pack: ' + (PACK ? (process.env.B68_PACK ? '$B68_PACK' : 'gm-private/b68-gm-pack.json') + ', parts ' + Object.keys(PACK.parts).join(' ') : 'none' + (PACK_ERR ? ' (' + PACK_ERR + ')' : '')));
if (PACK_ERR) await test('the pack loads', async () => { throw new Error(PACK_PATH + ': ' + PACK_ERR); });

/* ---------- (a) proper nouns ---------- */
const BUILT_IN = ['Doskvol', 'Blueraker', 'Limmerfield', 'Blackthorn', 'Duskwall'];
function packNames(pk) {
  const out = new Set(), add = (v) => { const s = typeof v === 'string' ? v.trim() : ''; if (s.length >= 4) out.add(s); };
  const parts = (pk && pk.parts) || {}, T = (parts.location && parts.location.T) || {}, camp = parts.campaign || {};
  const first = (row) => (Array.isArray(row) ? row[0] : row && typeof row === 'object' ? row.name || row.faction : row);
  for (const k of ['faction', 'district']) { const t = T[k]; if (Array.isArray(t)) t.forEach((r) => add(first(r))); else if (t && typeof t === 'object') Object.keys(t).forEach(add); }
  for (const n of camp.npcs || []) add(n && n.name);
  for (const p of camp.pcs || []) add(p && p.name);
  for (const s of camp.standing || []) add(first(s));
  const nT = (parts.npc && parts.npc.T) || {};
  if (Array.isArray(nT.faction)) nT.faction.forEach((r) => add(first(r)));
  if (nT.factionDetail && typeof nT.factionDetail === 'object') Object.keys(nT.factionDetail).forEach(add);
  return [...out];
}
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

await test('(a) the GM files and public scripts name no campaign or setting proper noun' + (PACK ? ' (built-in list and the real pack)' : ' (built-in list; no real pack here)'), async () => {
  if (!NAME_FILES.length) throw new Error('no GM files found');
  const names = [...new Set(BUILT_IN.concat(PACK ? packNames(PACK) : []))];
  const hits = [];
  for (const f of NAME_FILES) {
    const text = read(f);
    for (const n of names) {
      const re = new RegExp('(^|[^A-Za-z0-9_])' + reEsc(n) + '(?![A-Za-z0-9_])', 'g');
      let m; while ((m = re.exec(text))) hits.push(rel(f) + ':' + lineOf(text, m.index + m[1].length) + ' ' + (BUILT_IN.includes(n) ? n : mask(n)));
    }
  }
  if (hits.length) throw new Error(hits.length + ' hit(s):\n  ' + hits.slice(0, 20).join('\n  '));
  console.log('     ' + NAME_FILES.length + ' files, ' + names.length + ' names');
});

/* ---------- (b) long string literals outside comments ---------- */
/* A small JavaScript lexer: comments, '…', "…", `…${…}…` (nested), and regex literals (told from division by the
   token before them). Returns every string literal (template chunks separately) with its offset and raw length. */
const REGEX_AFTER = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^']);
const REGEX_WORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'new', 'delete', 'void', 'throw', 'instanceof', 'yield', 'await']);
export function literals(src) {
  const out = [], n = src.length, stack = [];
  let i = 0, prev = '', word = '';
  const isId = (c) => /[A-Za-z0-9_$]/.test(c);
  function str(q) {                                   // i at the opening quote
    const start = i; i++;
    while (i < n && src[i] !== q) { if (src[i] === '\\') i++; else if (src[i] === '\n') break; i++; }
    out.push({ at: start, len: i - start - 1 }); i++; prev = 'str';
  }
  function tmpl() {                                   // i just after ` or after the } closing a ${…}
    let start = i;
    while (i < n) {
      const c = src[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { out.push({ at: start, len: i - start }); i++; prev = 'str'; return; }
      if (c === '$' && src[i + 1] === '{') { out.push({ at: start, len: i - start }); i += 2; stack.push(0); prev = '{'; return; }
      i++;
    }
  }
  function regex() {
    i++; let cls = false;
    while (i < n) { const c = src[i]; if (c === '\\') { i += 2; continue; } if (c === '\n') break; if (cls) { if (c === ']') cls = false; } else if (c === '[') cls = true; else if (c === '/') break; i++; }
    i++; while (i < n && /[a-z]/i.test(src[i])) i++; prev = 'regex';
  }
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'" || c === '"') { str(c); word = ''; continue; }
    if (c === '`') { i++; tmpl(); word = ''; continue; }
    if (stack.length && (c === '{')) { stack[stack.length - 1]++; prev = '{'; i++; continue; }
    if (stack.length && c === '}') { if (stack[stack.length - 1] === 0) { stack.pop(); i++; tmpl(); continue; } stack[stack.length - 1]--; prev = '}'; i++; continue; }
    if (c === '/') { if (prev === '' || REGEX_AFTER.has(prev) || (prev === 'word' && REGEX_WORDS.has(word))) { regex(); continue; } prev = '/'; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (isId(c)) { const s = i; while (i < n && isId(src[i])) i++; word = src.slice(s, i); prev = /^[0-9]/.test(word) ? 'num' : 'word'; continue; }
    if (c === ')' || c === ']') { prev = c === ')' ? ')' : ']'; i++; continue; }
    prev = c; i++;
  }
  return out;
}

await test('(b) the GM files and scripts hold no string literal over 220 characters outside comments', async () => {
  // the lexer itself, on a sample
  const sample = "var a = 'x'.repeat(2); /* '" + 'y'.repeat(300) + "' */ // '" + 'z'.repeat(300) + "'\nvar r = /'[^']*'/g, b = `t${ { k: 'v' }.k }u`, c = 4 / 2 / 1;";
  const lits = literals(sample).map((l) => l.len);
  if (JSON.stringify(lits) !== JSON.stringify([1, 1, 1, 1])) throw new Error('the lexer is wrong on the sample: ' + JSON.stringify(lits));
  const long = literals("var s = '" + 'q'.repeat(230) + "';");
  if (!(long.length === 1 && long[0].len === 230)) throw new Error('the lexer missed a long literal');
  const hits = [];
  for (const f of LITERAL_FILES) {
    const text = read(f);
    for (const l of literals(text)) if (l.len > 220) hits.push(rel(f) + ':' + lineOf(text, l.at) + ' (' + l.len + ' chars)');
  }
  if (hits.length) throw new Error(hits.length + ' long literal(s):\n  ' + hits.join('\n  '));
  console.log('     ' + LITERAL_FILES.length + ' files (' + SCRIPT_JS.length + ' under scripts/)');
});

/* ---------- (c) no pack text in public files ---------- */
/* Public on purpose, so not a leak. By file: app/maps/map-kit.js is the design system's vendored map kit, whose catalogue
   names every printed room and target type of the book (it needs them to draw); it holds no campaign text. By string
   (first 16 hex of the SHA-256, so the text itself is not in this file; a hit prints its hash):
     book vocabulary in app/gm/location.js: the four band labels, a target-type name and the service-route regex
       (also in the invented fixture, which copies the regex);
     a cast description that is also public seed data (app/figures/npcs.js, checks/api/npcs.mjs), shown to players
       once the GM reveals that NPC.
   By source: any pack string that app/content.js already holds (compared after normalising both sides: JS escapes
   undone, curly quotes and apostrophes straightened, runs of whitespace collapsed). content.js is the rulebook's
   character-creation text and ships to every player, so such a string is public already (the npc part repeats some
   of it: vice purveyors, heritage entries, a Hull look). The exemption is by string, not by file: content.js itself
   is still scanned for every other pack string, and a table string not in content.js fails wherever it is pasted.
   Each part's `src` (the vault file path, a hash and a timestamp: provenance, not table text) is not collected. */
const VENDORED = new Set(['app/maps/map-kit.js']);
const normPublic = (s) => String(s).replace(/\\(['"`\\])/g, '$1').replace(/\\n/g, ' ')
  .replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const CONTENT_JS = path.join(ROOT, 'app', 'content.js');

/* every pack string of MIN+ characters, in the forms it could take when pasted into a file: as is, JSON-escaped,
   and with its apostrophes escaped for a single-quoted JS literal. Returns Map(form -> original). */
function packStrings(pk, MIN) {
  const forms = new Map();
  (function collect(v, key) {
    if (key === 'src') return;
    if (typeof v === 'string') {
      const s = v.trim(); if (s.length < MIN) return;
      for (const f of [s, JSON.stringify(s).slice(1, -1), s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")]) if (!forms.has(f)) forms.set(f, s);
    }
    else if (Array.isArray(v)) v.forEach((x) => collect(x));
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) { collect(k); collect(v[k], k); }
  })(pk.parts);
  return forms;
}
/* scan texts for pack strings: [{ name, text }] -> hits (masked) */
function packScan(texts, forms, MIN, exempt) {
  const byPrefix = new Map();
  for (const f of forms.keys()) { const k = f.slice(0, MIN); if (!byPrefix.has(k)) byPrefix.set(k, []); byPrefix.get(k).push(f); }
  const hits = [];
  for (const { name, text } of texts) {
    for (let i = 0; i + MIN <= text.length; i++) {
      const cand = byPrefix.get(text.substr(i, MIN)); if (!cand) continue;
      for (const f of cand) if (text.startsWith(f, i)) {
        const s = forms.get(f);
        if (!ALLOW.has(hashOf(s)) && !exempt.has(s)) hits.push(name + ':' + lineOf(text, i) + ' ' + mask(s) + ' #' + hashOf(s));
        break;
      }
    }
  }
  return hits;
}
const ALLOW = new Set([
  '5505f366fcfd2394', 'b32ed6feb419d144', '56978126c0c719f4',   // band labels (location.js fallback)
  'c94db93d10cfb1de',                                         // a target-type name (location.js)
  'c2a6a317f2250f9b',                                         // the service-route regex (location.js, the fixture)
  '92dc34bec130c877'                                          // a public cast seed description (npcs.js, npcs.mjs)
]);

await test('(c) no string of 25+ characters from the real pack appears in a public file under app/, functions/, checks/ or scripts/', async () => {
  if (!PACK) { console.log('     skipped: no pack on this machine (gm-private/b68-gm-pack.json, or set B68_PACK)'); return; }
  const MIN = 25, forms = packStrings(PACK, MIN);
  const originals = new Set(forms.values());
  // public already: in app/content.js after normalising
  const content = fs.existsSync(CONTENT_JS) ? normPublic(read(CONTENT_JS)) : '';
  const exempt = new Set([...originals].filter((s) => content && content.includes(normPublic(s))));
  // the scanner itself, on texts made here (nothing is printed): a non-exempt pack string planted in a fake npc.js
  // is caught, in each pasted form; an exempt one is not
  const probe = [...originals].find((s) => !exempt.has(s) && !ALLOW.has(hashOf(s)) && /'/.test(s)) || [...originals].find((s) => !exempt.has(s) && !ALLOW.has(hashOf(s)));
  if (probe) {
    for (const form of [probe, JSON.stringify(probe).slice(1, -1), probe.replace(/\\/g, '\\\\').replace(/'/g, "\\'")]) {
      if (packScan([{ name: 'probe', text: "var x = '" + form + "';\n" }], forms, MIN, exempt).length !== 1) throw new Error('self-test: a planted pack string was not caught');
    }
  }
  const ex1 = [...exempt][0];
  if (ex1 && packScan([{ name: 'probe', text: 'var y = "' + ex1 + '";' }], forms, MIN, exempt).length) throw new Error('self-test: an exempt string was flagged');
  const TEXT = /\.(m?js|cjs|css|html?|json|md|txt|svg|webmanifest|sql|toml|sh)$/i;
  const files = ['app', 'functions', 'checks', 'scripts'].flatMap((d) => walk(path.join(ROOT, d))).filter((f) => TEXT.test(f) && !VENDORED.has(rel(f)));
  let bytes = 0;
  const texts = files.map((f) => { const text = read(f); bytes += text.length; return { name: rel(f), text }; });
  const hits = packScan(texts, forms, MIN, exempt);
  if (hits.length) throw new Error(hits.length + ' hit(s):\n  ' + [...new Set(hits)].slice(0, 30).join('\n  '));
  console.log('     ' + originals.size + ' pack strings (' + exempt.size + ' exempt: already public in app/content.js), ' + files.length + ' files (' + files.filter((f) => rel(f).startsWith('scripts/')).length + ' under scripts/), ' + Math.round(bytes / 1024) + ' KiB scanned');
});

/* ---------- (e) the NPC and figure-map modules name no faction of the npc part ---------- */
function npcFactions(pk) {
  const out = new Set(), add = (v) => { const s = typeof v === 'string' ? v.trim() : ''; if (s.length >= 4) out.add(s); };
  const npc = (pk && pk.parts && pk.parts.npc) || {}, T = npc.T || {}, F = npc.F;
  if (Array.isArray(T.faction)) T.faction.forEach((r) => add(Array.isArray(r) ? r[0] : r && typeof r === 'object' ? r.name : r));
  if (T.factionDetail && typeof T.factionDetail === 'object') Object.keys(T.factionDetail).forEach(add);
  // F: any map keyed by faction (palette, halo, ...): its keys; any row naming a faction: that name
  (function walkF(v) {
    if (Array.isArray(v)) return v.forEach(walkF);
    if (!v || typeof v !== 'object') return;
    for (const k of Object.keys(v)) {
      if (/^(faction|factions|palette|halo|halos|colours?|colors?)$/i.test(k) && v[k] && typeof v[k] === 'object' && !Array.isArray(v[k])) Object.keys(v[k]).forEach(add);
      if (/^faction$/i.test(k) && typeof v[k] === 'string') add(v[k]);
      walkF(v[k]);
    }
  })(F);
  return [...out];
}
await test('(e) app/gm/npc.js and app/gm/figure-map.js name no faction of the pack\'s npc.T / npc.F', async () => {
  if (!PACK || !PACK.parts.npc) { console.log('     skipped: the pack has no npc part'); return; }
  const files = ['npc.js', 'figure-map.js'].map((f) => path.join(ROOT, 'app', 'gm', f));
  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length) throw new Error('missing: ' + missing.map(rel).join(', '));
  const names = npcFactions(PACK);
  if (!names.length) throw new Error('no faction names found in the npc part (has its shape changed?)');
  const hits = [];
  for (const f of files) {
    const text = read(f);
    for (const n of names) {
      const re = new RegExp('(^|[^A-Za-z0-9_])' + reEsc(n) + '(?![A-Za-z0-9_])', 'g');
      let m; while ((m = re.exec(text))) hits.push(rel(f) + ':' + lineOf(text, m.index + m[1].length) + ' ' + mask(n));
    }
  }
  if (hits.length) throw new Error(hits.length + ' hit(s):\n  ' + hits.slice(0, 20).join('\n  '));
  console.log('     ' + files.length + ' files, ' + names.length + ' faction names' + (PACK.parts.npc.F ? '' : ' (npc.F is empty in this pack)'));
});

/* ---------- (d) the GM page's own guards (app/gm-page.js, pure helpers) ---------- */
const { createRequire } = await import('node:module');
const GP = createRequire(import.meta.url)(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const assertEq = (a, b, msg) => { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || 'not equal') + ': got ' + A + ' want ' + B); };

await test('(d) only a player-layer render goes to the display: GM layer refused, the layer forced, the gate refuses any other svg', async () => {
  const calls = [];
  const render = (roll, o) => { calls.push(o); return { svg: '<svg data-layer="' + o.layer + '"></svg>', warnings: [] }; };
  const roll = { name: 'Invented Mill', district: 'Nowhere' };
  let err = null; try { GP.playerDisplay(roll, { layer: 'gm', view: 'plan' }, render); } catch (e) { err = e; }
  if (!err || calls.length) throw new Error('a GM-layer request was rendered for the display');
  const d = GP.playerDisplay(roll, { layer: 'player', view: 'plan', theme: 'casefile', reveal: { public: true, working: true, secure: false } }, render);
  assertEq([calls[0].layer, calls[0].reveal, calls[0].view, d.kind, d.title], ['player', ['public', 'working'], 'plan', 'svg', 'Invented Mill'], 'player render');
  if (!/surveyed: public, working/.test(d.caption)) throw new Error('caption: ' + d.caption);
  const gate = GP.makeGate();
  if (gate.allows({ kind: 'svg', svg: d.svg })) throw new Error('the gate passed an svg it did not mark');
  gate.mark(d.svg);
  if (!gate.allows({ kind: 'svg', svg: d.svg })) throw new Error('the gate refused a marked player svg');
  if (gate.allows({ kind: 'svg', svg: '<svg data-layer="gm"></svg>' })) throw new Error('the gate passed a GM svg');
  if (!gate.allows({ kind: 'blank' }) || !gate.allows({ kind: 'npc', npcId: 'x' }) || !gate.allows({ kind: 'text', text: 'x' })) throw new Error('other kinds should pass');
});

await test('(d) keys: never while typing (Esc only) or with a modifier; 1-9, N B T, P X M, L, H; S and E reserved', async () => {
  const k = (key, x = {}) => GP.keyAction({ key, ...x });
  assertEq([k('1'), k('9'), k('0')], [{ type: 'button', n: 1 }, { type: 'button', n: 9 }, null], 'digits');
  assertEq([k('n').panel, k('B').panel, k('t').panel, k('s').type, k('E').type], ['npc', 'location', 'rules', 'reserved', 'reserved'], 'panels');
  assertEq([k('p').bucket, k('x').bucket, k('M').bucket, k('l').type, k('h').type], ['n', 'x', 'm', 'last', 'blank'], 'capture');
  assertEq([k('1', { typing: true }), k('h', { typing: true }), k('Escape', { typing: true })], [null, null, { type: 'esc' }], 'typing');
  assertEq([k('1', { ctrlKey: true }), k('h', { metaKey: true }), k('p', { altKey: true })], [null, null, null], 'modifiers');
});

await test('(d) the pack file is validated before upload; the note has the four headings and the session number', async () => {
  const good = { format: 1, exportedAt: '2026-10-10T00:00:00Z', parts: { console: { src: { file: 'x' }, T: { a: 1 } }, location: { src: {}, T: { b: 2 }, extra: {} }, campaign: { src: {}, pcs: [] } } };
  const v = GP.validatePack(good);
  assertEq([v.ok, v.parts.map((p) => p.name)], [true, ['console', 'location', 'campaign']], 'good pack');
  assertEq(GP.partRequests(good)[1], { part: 'location', src: {}, body: { T: { b: 2 }, extra: {} } }, 'one request per part, src apart');
  for (const bad of [null, { format: 2, parts: good.parts }, { format: 1, parts: { console: good.parts.console } }, { format: 1, parts: { console: { T: 1 }, location: good.parts.location } }, { format: 1, parts: { ...good.parts, Bad_Name: {} } }]) {
    if (GP.validatePack(bad).ok) throw new Error('accepted ' + JSON.stringify(bad).slice(0, 80));
  }
  const doc = { capture: { a: { bucket: 'n', text: 'Invented Name', at: '2026-10-17T10:00:00Z' }, b: { bucket: 'r', text: 'Rolled thing', at: '2026-10-17T10:01:00Z' } }, con: { owed: { k1: { text: 'A favour', src: 'Pip, 17/10/2026' } }, used: { k2: 'The goose' } } };
  const x = GP.exportNote(doc, { session: 3, now: new Date('2026-10-17T12:00:00Z') });
  assertEq(x.filename, 'b68g-s03-notes.md', 'filename');
  const heads = x.text.split('\n').filter((l) => l.startsWith('## '));
  assertEq(heads, ['## Names', '## Loose ends', '## Moments', '## Rolled at the table', '## Bargains accepted', '## Callbacks used'], 'headings');
  if (!/# Session 3/.test(x.text) || !/- Invented Name/.test(x.text) || !/- A favour \(Pip, 17\/10\/2026\)/.test(x.text) || !/- The goose/.test(x.text)) throw new Error('note body:\n' + x.text);
});

await test('(d) state patches: the server merge (null deletes), pending patches fold, capped maps drop the oldest', async () => {
  assertEq(GP.applyPatch({ a: { b: 1, c: 2 }, l: [1] }, { a: { c: null, d: 3 }, l: [2] }), { a: { b: 1, d: 3 }, l: [2] }, 'applyPatch');
  const p1 = { cap: { x: { t: 1 } }, live: { pos: 'risky' } }, p2 = { cap: { y: { t: 2 }, x: null }, live: { scene: 'a' } };
  const base = { cap: { z: { t: 0 } } };
  assertEq(GP.applyPatch(base, GP.mergePatch(p1, p2)), GP.applyPatch(GP.applyPatch(base, p1), p2), 'fold equals sequence');
  const m = {}; for (let i = 0; i < 5; i++) m['h' + i] = { at: '2026-10-17T10:0' + i + ':00Z' };
  const p = GP.addCapped(m, 'h9', { at: '2026-10-17T11:00:00Z' }, 5);
  assertEq(Object.keys(p).sort(), ['h0', 'h9'], 'one added, the oldest dropped'); assertEq(p.h0, null);
});

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
