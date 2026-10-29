// The public code carries no GM table text (GM.md, "Secrecy rules"). Five checks:
//   (a) app/gm/**, app/gm-page.js, app/display-page.js and scripts/** (.mjs/.js/.cjs/.sh) name none of the campaign's
//       or the setting's proper nouns (a built-in short list, plus the faction, district, NPC and PC names of the real
//       pack when it is on this machine);
//   (b) the same JavaScript files hold no string literal over 220 characters outside comments (a table pasted in);
//   (c) when the real pack exists, no string of 25+ characters from it appears in any public file under app/,
//       functions/, checks/ or scripts/. Strings the pack shares with app/content.js (the rulebook's public
//       character-creation text, already shipped to every player) are exempt.
//   (d) the GM page's pure guards: only a player-layer map reaches the display, keys, pack validation, the note, patches.
//   (f) when the pack has the scenes part, and the score part: app/gm/scenes.js and app/gm/score.js hold none of their text
//       (districts, streets, landmarks, notables, factions, rumours; operations, seeds, assets, twists, threats, the pay lines);
//   (e) when the pack has the npc part: app/gm/npc.js and app/gm/figure-map.js name no faction of npc.T / npc.F (the
//       figure map's faction palette lives in the pack for exactly that reason);
//   (h) the location glance's one-sentence plan (it names the target room and its locks) is GM only: it is in no player summary,
//       and the page reads it in the glance card alone.
//   (m) the players' tokens (M3): crew markers and visible pinned clocks on the player copy, in shown rooms only, behind one gate that fails closed.
//   (n) single rooms (M4 step 5, map kit 0.9): a room opened on its own, alone in a closed band or on top of a band, shows that room and no
//       hidden room's name, tint, wall, door or fixture; the player copy is renumbered 1..k so it never says how many rooms are shut; the
//       markers follow the same rule as the kit (band OR own entry), keyed on the room's name.
//   (o) the players' mission (VV6): over a sweep of nights the PATCH body holds no GM-ONLY marker of the section 5 fixture, a marker put in a player-safe field is
//       stopped by the screen (with controls), and the mission reaches the players through one write and the gate, never the display push.
//   (i) the chase strip (the Chase panel): a hidden opposing clock, the roll lines and GM notes never reach the svg sent to the iPad,
//       over a fuzzed set of invented chases, and the page sends a chase only through chaseDisplay (map kit 0.6's B68Map.chase; until
//       the vendored kit has it, checks/runtime/fixtures/chase-kit-stub.js stands in).
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
  for (const d of (parts.scenes && parts.scenes.T && parts.scenes.T.district) || []) { add(d.n); (d.landmarks || []).forEach(add); (d.notables || []).forEach((n) => add(n && n[0])); }
  return [...out];
}
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* The GM approved this one ambient scene label on 22/10/2026 and it stays as it is. Allowlisted by the full label string
   as it appears in the source, in exactly these two files: the same word anywhere else still fails. */
const LABEL_ALLOW = {
  'app/gm-page.js': ['label: "Grunt\'s"'],
  'app/display-page.js': ['label: "Grunt\'s"'],
};
function allowedRanges(f, text) {
  const out = [];
  for (const s of LABEL_ALLOW[rel(f)] || []) { let i = -1; while ((i = text.indexOf(s, i + 1)) >= 0) out.push([i, i + s.length]); }
  return out;
}

await test('(a) the GM files and public scripts name no campaign or setting proper noun' + (PACK ? ' (built-in list and the real pack)' : ' (built-in list; no real pack here)'), async () => {
  if (!NAME_FILES.length) throw new Error('no GM files found');
  const names = [...new Set(BUILT_IN.concat(PACK ? packNames(PACK) : []))];
  const hits = [];
  for (const f of NAME_FILES) {
    const text = read(f), ok = allowedRanges(f, text);
    for (const n of names) {
      const re = new RegExp('(^|[^A-Za-z0-9_])' + reEsc(n) + '(?![A-Za-z0-9_])', 'g');
      let m; while ((m = re.exec(text))) if (!ok.some(([s, e]) => m.index >= s && m.index < e)) hits.push(rel(f) + ':' + lineOf(text, m.index + m[1].length) + ' ' + (BUILT_IN.includes(n) ? n : mask(n)));
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
  /* the prep part: its note text and task lines are scanned; its vault paths, note titles and the link map's page names are
     provenance, like a part's src (a page name such as a tool's file name is in the code as a path, and is no secret) */
  const parts = { ...pk.parts };
  if (parts.prep && typeof parts.prep === 'object') parts.prep = { notes: (parts.prep.notes || []).map((n) => ({ blocks: (n && n.blocks || []).map((b) => ({ src: b && b.src, tasks: b && b.tasks })) })) };
  (function collect(v, key) {
    if (key === 'src') return;
    if (typeof v === 'string') {
      const s = v.trim(); if (s.length < MIN) return;
      for (const f of [s, JSON.stringify(s).slice(1, -1), s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")]) if (!forms.has(f)) forms.set(f, s);
    }
    else if (Array.isArray(v)) v.forEach((x) => collect(x));
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) { collect(k); collect(v[k], k); }
  })(parts);
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
        if (!ALLOW.has(hashOf(s)) && !(ALLOW_IN[hashOf(s)] || []).includes(name) && !exempt.has(s)) hits.push(name + ':' + lineOf(text, i) + ' ' + mask(s) + ' #' + hashOf(s));
        break;
      }
    }
  }
  return hits;
}
/* Allowed in named files only (by hash, then file): a generic building-circulation phrase (one of the location module's keys) that the
   location module needs as a key to match the vault's table. Approved by the GM 22/10/2026; anywhere else it still fails. */
const ALLOW_IN = {
  'ad71d7c6ebf8a5f8': ['app/gm/location.js', 'checks/runtime/gm-location.test.mjs'],
};
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

/* ---------- (f) the scenes and score modules hold none of their parts' table text ---------- */
// Everything the two parts carry (districts, streets, landmarks, notables, factions, rumours; the crews' seeds and pay lines, the
// operations, assets, twists, threats, scopes) lives in the pack. The modules hold arithmetic, labels and card layout only.
function sceneStrings(pk) {
  const out = new Set(), add = (v) => { const s = typeof v === 'string' ? v.trim() : ''; if (s.length >= 4) out.add(s); };
  const parts = (pk && pk.parts) || {}, sT = (parts.scenes && parts.scenes.T) || {};
  for (const d of sT.district || []) {
    add(d.n); add(d.streets); add(d.buildings); add(d.factions); add(d.special);
    for (const k of ['named', 'scene', 'landmarks']) (d[k] || []).forEach(add);
    (d.notables || []).forEach((n) => (n || []).forEach(add));
  }
  for (const k of ['streetType', 'streetSound', 'streetSmell', 'streetObstacle', 'buildingCommon', 'buildingRare', 'rumour', 'faction']) (sT[k] || []).forEach(add);
  for (const k of Object.keys(sT.weather || {})) { add(k); (sT.weather[k] || []).forEach(add); }
  (sT.ratingLabels || []).forEach(add);
  return [...out];
}
// the score part: every phrase its tables hold (twelve characters or more: the short ones are vocabulary the module uses, such as the asset kinds), and the names it is keyed by
function scoreStrings(pk) {
  const out = new Set(), add = (v, n) => { const s = typeof v === 'string' ? v.trim() : ''; if (s.length >= n) out.add(s); };
  const T = (pk && pk.parts && pk.parts.score && pk.parts.score.T) || {};
  (function walk(v) { if (typeof v === 'string') add(v, 12); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.keys(v).forEach((k) => walk(v[k])); })(T);
  for (const m of [T.crew, T.op, T.holding, T.districtRule]) Object.keys(m || {}).forEach((k) => add(k, 4));
  return [...out];
}
function noTableText(file, strings, label) {
  const text = read(path.join(ROOT, 'app', 'gm', file)), hits = [];
  for (const n of strings) {
    const re = new RegExp('(^|[^A-Za-z0-9_])' + reEsc(n) + '(?![A-Za-z0-9_])', 'g');
    let m; while ((m = re.exec(text))) hits.push('app/gm/' + file + ':' + lineOf(text, m.index + m[1].length) + ' ' + mask(n));
  }
  if (hits.length) throw new Error(hits.length + ' hit(s) in ' + label + ':\n  ' + hits.slice(0, 20).join('\n  '));
  console.log('     ' + file + ': ' + strings.length + ' strings');
}
await test('(f) app/gm/scenes.js holds no text of the pack\'s scenes part', async () => {
  if (!PACK || !PACK.parts.scenes) { console.log('     skipped: the pack has no scenes part'); return; }
  const strings = sceneStrings(PACK);
  if (strings.length < 100) throw new Error('only ' + strings.length + ' strings found in the scenes part (has its shape changed?)');
  noTableText('scenes.js', strings, 'the scenes module');
});
await test('(f) app/gm/score.js holds no text of the pack\'s score part', async () => {
  if (!PACK || !PACK.parts.score) { console.log('     skipped: the pack has no score part'); return; }
  const strings = scoreStrings(PACK);
  if (strings.length < 100) throw new Error('only ' + strings.length + ' strings found in the score part (has its shape changed?)');
  noTableText('score.js', strings, 'the score module');
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

await test('(d) keys: never while typing (Esc only) or with a modifier; 1-4 (5-9 nothing), N B S T J, P X M, L, H twice or Shift+H', async () => {
  const k = (key, x = {}) => GP.keyAction({ key, ...x });
  assertEq([k('1'), k('4'), k('9'), k('0')], [{ type: 'situation', n: 1 }, { type: 'situation', n: 4 }, null, { type: 'clear' }], 'digits (0 clears the iPad to ambient; 5-9 do nothing)');
  assertEq([k('i').panel, k('0', { typing: true }), k('i', { ctrlKey: true })], ['ipad', null, null], 'the iPad panel key');
  assertEq([k('n').panel, k('B').panel, k('t').panel, k('s').panel, k('j').panel, k('E'), k('e')], ['npc', 'location', 'rules', 'scenes', 'score', null, null], 'panels (J is Score; E went with Engage)');
  assertEq([k('p').bucket, k('x').bucket, k('M').bucket, k('l').type, k('h').type, k('H').type], ['n', 'x', 'm', 'last', 'blank-tap', 'blank'], 'capture, and the blank key');
  assertEq([k('1', { typing: true }), k('h', { typing: true }), k('Escape', { typing: true })], [null, null, { type: 'esc' }], 'typing');
  assertEq([k('1', { ctrlKey: true }), k('h', { metaKey: true }), k('p', { altKey: true })], [null, null, null], 'modifiers');
});

/* ---------- (g) the score scene: the one new route from a roll to the players' screen ---------- */
const SCORE_ROLLS = JSON.parse(read(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'score-rolls.json')));
const MAPKIT = createRequire(import.meta.url)(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
const mapRender = MAPKIT.render.bind(MAPKIT);
const { checkSvg } = await import((await import('node:url')).pathToFileURL(path.join(ROOT, 'functions', '_lib', 'gm.js')).href);

await test('(g) a score scene is only ever built from a player-layer render made here: a GM-layer request renders nothing', async () => {
  const calls = [];
  const spy = (roll, o) => { calls.push(o); return mapRender(roll, o); };
  for (const map of [{ layer: 'gm' }, { layer: 'GM', view: 'plan' }, {}, null, { layer: undefined, reveal: { public: true } }]) {
    let err = null; try { GP.scoreScene(SCORE_ROLLS.clean, map, spy); } catch (e) { err = e; }
    if (!err) throw new Error('a request on ' + JSON.stringify(map) + ' was accepted');
  }
  if (calls.length) throw new Error('a refused request still rendered: ' + JSON.stringify(calls));
  const s = GP.scoreScene(SCORE_ROLLS.clean, { layer: 'player', reveal: { public: true } }, spy);
  if (!calls.length || calls.some((c) => c.layer !== 'player')) throw new Error('every render must be the player layer: ' + JSON.stringify(calls.map((c) => c.layer)));
  assertEq(calls.map((c) => c.reveal.join()), ['public', 'public'], 'reveal is the public band only');
  assertEq(Object.keys(s.score).sort(), ['board', 'district', 'iso', 'name', 'reveal', 'target', 'view'], 'the fields that go out');
  assertEq([s.score.name, s.score.district, s.score.target], ['Plain Hall', 'Elsewhere', ''], 'the place name and district; the target is never sent');
});

await test('(g) a leaking plan falls back to rings; a leaking iso falls back to rings; leaking rings are refused; the hidden name is on neither svg', async () => {
  /* the kit (0.5+) titles floors generically and never names a hidden room; this renderer names one on the plan, as kit 0.2 did */
  const leaky = SCORE_ROLLS.leaky, hidden = 'server room';
  const naming = (roll, o) => { const r = mapRender(roll, o); return o.view === 'plan' || o.view === 'iso' ? Object.assign({}, r, { svg: r.svg.replace('</svg>', '<text>Server room</text></svg>') }) : r; };
  if (!GP.leaks(naming(leaky, { view: 'plan', theme: 'board', layer: 'player', reveal: ['public'], width: 1600 }).svg, leaky, ['public']).includes(hidden)) throw new Error('self-test: the plan should name the hidden room');
  for (const v of ['plan', 'section', 'iso', 'rings']) if (GP.leaks(mapRender(leaky, { view: v, layer: 'player', reveal: ['public'] }).svg, leaky, ['public']).length) throw new Error('the kit\'s own ' + v + ' names a hidden room');
  const s = GP.scoreScene(leaky, { layer: 'player', reveal: { public: true } }, naming);
  assertEq([s.view, s.score.view, s.rings], ['rings', 'rings', true], 'rings instead of the plan');
  for (const [k, svg] of [['board', s.score.board], ['iso', s.score.iso]]) {
    if (GP.leaks(svg, leaky, ['public']).length) throw new Error(k + ' names a hidden room');
    if (svg.toLowerCase().includes(hidden)) throw new Error(k + ' prints the hidden room name');
    checkSvg(svg);
  }
  const isoLeak = (roll, o) => ({ svg: o.view === 'iso' ? '<svg><text>Server room</text></svg>' : mapRender(roll, o).svg });
  const fb = GP.scoreScene(leaky, { layer: 'player', reveal: { public: true } }, isoLeak);
  if (!fb.isoRings || GP.leaks(fb.score.iso, leaky, ['public']).length || fb.score.iso.toLowerCase().includes(hidden)) throw new Error('a leaking iso was not redrawn as clean rings');
  const allLeak = () => ({ svg: '<svg><text>Server room</text></svg>' });
  let err = null; try { GP.scoreScene(leaky, { layer: 'player', reveal: { public: true } }, allLeak); } catch (e) { err = e; }
  if (!err || !err.leak || err.message !== GP.LEAK_MSG) throw new Error('rings that leak were not refused: ' + (err && err.message));
  const open = GP.scoreScene(leaky, { layer: 'player', reveal: { public: true, working: true, controlled: true, secure: true } }, mapRender);
  assertEq([open.view, open.rings], ['plan', false], 'revealed: the plan stands');
});

await test('(g) the gate: a score patch passes only with both svgs marked from a player render; a GM-layer svg, one svg, or an unmarked svg is refused', async () => {
  const gate = GP.makeGate();
  const gmSvg = mapRender(SCORE_ROLLS.clean, { view: 'plan', theme: 'board', layer: 'gm', reveal: ['public'], width: 1600 }).svg;
  const s = GP.scoreScene(SCORE_ROLLS.clean, { layer: 'player', reveal: { public: true } }, mapRender);
  if (gate.allowsAmbient({ score: s.score })) throw new Error('an unmarked score passed');
  gate.mark(s.board); if (gate.allowsAmbient({ score: s.score })) throw new Error('a score with one marked svg passed');
  gate.mark(s.iso); if (!gate.allowsAmbient({ score: s.score })) throw new Error('a marked score was refused');
  if (gate.allowsAmbient({ score: Object.assign({}, s.score, { board: gmSvg }) })) throw new Error('a GM-layer board passed the gate');
  if (gate.allowsAmbient({ score: Object.assign({}, s.score, { iso: gmSvg }) })) throw new Error('a GM-layer iso passed the gate');
  if (!gate.allowsAmbient({ score: null }) || !gate.allowsAmbient({ mode: 'off' })) throw new Error('clearing the score and the other keys pass');
  if (gate.allowsAmbient({ score: { board: s.board } })) throw new Error('an iso-less score passed');
});

await test('(g) the page source: a score is written only as the built score or null, and patchAmbient runs the gate', async () => {
  const src = read(path.join(ROOT, 'app', 'gm-page.js'));
  const uses = src.match(/patchAmbient\(\{ score:/g) || [];
  if (uses.length !== 2) throw new Error('expected exactly the set (built.score) and the clear (null) writes, found ' + uses.length);
  if (!/patchAmbient\(\{ score: built\.score \}\)/.test(src) || !/patchAmbient\(\{ score: null \}\)/.test(src)) throw new Error('a score write that is neither the built score nor null');
  if (!/if \(!gate\.allowsAmbient\(p\)\)/.test(src)) throw new Error('patchAmbient no longer runs the gate');
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

/* ---------- (h) the glance card's plan: GM only ---------- */
// glance().plan is one sentence under Say that names the target room, its band and the locks in the way. It is a GM secret: it sits
// outside the Say box, and no route to the players (the street description, the map, the score scene) may carry it.
await test('(h) the location plan names the target and is GM only: never in the player summary at any reveal, never in what the iPad is sent, and the page reads it in one place', async () => {
  const L = createRequire(import.meta.url)(path.join(ROOT, 'app', 'gm', 'location.js'));
  const fx = JSON.parse(read(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'location-pack.json')));
  const pk = { T: fx.T, extra: fx.extra };
  let n = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const roll = L.generate(pk, {}, { seed, mem: {} }), g = L.glance(roll, pk, ['public']);
    if (typeof g.plan !== 'string' || !g.plan) throw new Error('seed ' + seed + ': the glance has no plan (has its shape changed?)');
    const secret = g.plan.slice(g.plan.indexOf('; ') + 2);       // "the target, <room> (<band>), is behind N locks.": what the front door line does not say
    if (secret.length < 15 || !secret.includes(roll.targetRoom)) throw new Error('seed ' + seed + ': the plan\'s target clause is not what this check expects: ' + secret);
    for (const reveal of [['public'], ['public', 'working'], ['public', 'working', 'controlled', 'secure']]) {
      const ps = L.playerSummary(roll, reveal), all = JSON.stringify(ps);
      if (all.includes(g.plan) || all.includes(secret)) throw new Error('seed ' + seed + ' reveal ' + reveal.join('+') + ': the plan reached the player summary');
      if (/\b(is behind \d+ locks?|has no lock in the way)\b/.test(all)) throw new Error('seed ' + seed + ': lock counts reached the player summary');
    }
    n++;
  }
  // the page: .plan is read inside glanceHtml and nowhere else; every push to the iPad is built from the player summary, a player render or typed text
  const src = read(path.join(ROOT, 'app', 'gm-page.js'));
  const from = src.indexOf('function glanceHtml'), to = src.indexOf('function foldsHtml');
  if (from < 0 || to < from) throw new Error('glanceHtml not found');
  const outside = (src.slice(0, from) + src.slice(to)).match(/\.plan\b/g) || [];
  if (outside.length) throw new Error('the plan is read outside the glance card ' + outside.length + ' time(s)');
  if (!/function pushText[\s\S]*?playerSummary\([\s\S]*?pushDisplay\(/.test(src)) throw new Error('pushText no longer builds the street description from playerSummary');
  const push = src.slice(src.indexOf('function pushText'), src.indexOf('function blankIpad'));
  if (/glance|\.plan|\.say\b/.test(push)) throw new Error('pushText reads the glance card');
  console.log('     ' + n + ' fixture rolls × 3 reveals');
});

/* ---------- (j) map kit 0.7 on the iPad: every view (the street too), every theme (the plate too), time and weather ---------- */
await test('(j) the iPad copy of a map, in every view, theme, time and weather the panel offers: the player layer at the iPad\'s size, no hidden room, threat, hidden target, watcher or back route, and the server takes it', async () => {
  const req = createRequire(import.meta.url), LOC = req(path.join(ROOT, 'app', 'gm', 'location.js'));
  const pk = JSON.parse(read(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'location-pack.json')));
  const lower = (s) => String(s || '').trim().toLowerCase();
  let n = 0;
  for (const seed of [3, 29, 83]) {
    const roll = LOC.generate(pk.body || pk, {}, { seed });
    for (const reveal of [{ public: true }, { public: true, working: true }]) {
      const shown = GP.revealList({ layer: 'player', reveal });
      const open = new Set(roll.rooms.filter((r) => shown.includes(r.band)).map((r) => lower(r.name)));
      const secrets = roll.rooms.filter((r) => !shown.includes(r.band)).map((r) => lower(r.name)).filter((x) => !open.has(x) && !GP.LEVEL_TITLES.includes(x))
        .concat([lower(roll.physThreatName), lower(roll.socThreatName), lower(roll.watcher).replace(/,.*$/, ''), lower(roll.vectors[2] && roll.vectors[2].how).replace(/\s+—.*$|\..*$/, '')])
        .concat(shown.includes(roll.targetBand) ? [] : [lower(roll.targetRoom)]).filter((x) => x.length >= 4);
      const combos = [];
      for (const view of GP.VIEWS) for (const theme of GP.THEMES) combos.push({ view, theme });
      for (const theme of GP.THEMES) for (const [time, weather] of [['Night', 'rolled'], ['Bluetime', 'snow'], ['', 'fog']]) combos.push({ view: 'street', theme, time, weather });
      for (const view of ['iso', 'plan', 'rings']) for (const [time, weather] of [['Night', ''], ['', 'none'], ['Night', 'rain']]) combos.push({ view, theme: 'plate', time, weather });
      for (const c of combos) {
        const calls = [], spy = (r, o) => { calls.push(o); return mapRender(r, o); };
        const d = GP.playerDisplay(roll, Object.assign({ layer: 'player', reveal }, c), spy);
        if (calls.length !== 1 || calls[0].layer !== 'player' || calls[0].layout !== 'ipad') throw new Error('not one player render at the iPad\'s size: ' + JSON.stringify(calls));
        const text = ' ' + GP.svgText(d.svg) + ' ';
        for (const s of secrets) if (text.includes(s)) throw new Error('seed ' + seed + ' ' + JSON.stringify(c) + ' reveal ' + shown.join(',') + ': the iPad copy prints "' + s + '"');
        checkSvg(d.svg);
        n++;
      }
    }
  }
  if (n < 150) throw new Error('only ' + n + ' renders checked');
  const gmCopy = GP.svgText(mapRender(LOC.generate(pk.body || pk, {}, { seed: 3 }), { view: 'iso', layer: 'gm', reveal: GP.BANDS }).svg);
  const r3 = LOC.generate(pk.body || pk, {}, { seed: 3 });
  if (!gmCopy.includes(lower(r3.rooms.filter((r) => r.band === 'secure')[0].name))) throw new Error('self-test: the GM copy should name the secure room (is the check still testing anything?)');
});

/* ---------- (k) the leak scan reads the whole svg, and every GM-only string of a roll (the secrecy review of 23/10/2026) ---------- */
await test('(k) the leak scan reads the whole svg source (attributes, ids, comments, title, desc; entities decoded) and looks for loot, locks, the hidden ways in and the watcher as well as names', () => {
  const roll = { name: 'Invented Works', district: 'Nowhere', targetRoom: 'Vault', targetBand: 'secure', watcher: 'Mags Invented, a watcher',
    physThreatName: 'Two bruisers', socThreatName: 'The night clerk', obstacle: 'A loose floor hazard',
    rooms: [{ name: 'Lobby', band: 'public', loot: 'a jade figurine', obstacle: 'A wired alarm' }, { name: 'Server room', band: 'working' }, { name: 'Vault', band: 'secure', isTarget: true }],
    items: ['a jade figurine', 'a ledger of debts'],
    vectors: [{ n: 'The front', how: 'Pell Road — a wide lane.', know: 'free' }, { n: 'The service side', how: 'In through the coal cellar.', know: 'costs a question' }, { n: 'The back route', how: 'Gutter stairs — there is always one.', know: "can't be known from outside" }] };
  const R = ['public'];
  const wrap = (inner) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' + inner + '</svg>';
  for (const [svg, want] of [
    [wrap('<g aria-label="Server room"/>'), 'server room'], [wrap('<g id="b68m-server-room"/>'), 'server room'], [wrap('<!-- Server room -->'), 'server room'],
    [wrap('<title>The vault</title>'), 'vault'], [wrap('<desc>Server&#32;room</desc>'), 'server room'], [wrap('<g data-x="Server&#x20;room"/>'), 'server room'],
    [wrap('<text>Watching: Mags Invented.</text>'), 'mags invented'], [wrap('<text>a jade figurine</text>'), 'a jade figurine'], [wrap('<g aria-label="A wired alarm"/>'), 'a wired alarm'],
    [wrap('<text>A loose floor hazard</text>'), 'a loose floor hazard'], [wrap('<text>Gutter stairs</text>'), 'gutter stairs'], [wrap('<text>In through the coal cellar</text>'), 'in through the coal cellar'],
    [wrap('<text>a ledger of debts</text>'), 'a ledger of debts'], [wrap('<text>Two bruisers</text>'), 'two bruisers']]) {
    const hit = GP.leaks(svg, roll, R);
    if (!hit.includes(want)) throw new Error('missed "' + want + '" in ' + svg + ' (found ' + JSON.stringify(hit) + ')');
  }
  // whole words only, public things are not secrets, and a revealed room is fair game
  for (const svg of [wrap('<text>Lobby</text><text>Pell Road — a wide lane.</text><text>Basement</text>'), wrap('<text>Server roomette</text><g id="xvault"/>'), wrap('<g id="b68m-ic-camera" class="ov-lock ov-loot"/>')]) {
    const hit = GP.leaks(svg, roll, R); if (hit.length) throw new Error('false positive ' + JSON.stringify(hit) + ' in ' + svg);
  }
  if (GP.leaks(wrap('<text>Server room</text>'), roll, ['public', 'working']).length) throw new Error('a revealed room is not a secret');
  // the chase scan reads the source too: a hidden clock in an attribute is caught
  const CG = createRequire(import.meta.url)(path.join(ROOT, 'app', 'gm', 'chase.js'));
  const fakeG = Object.assign({}, CG, { playerCopy: (c) => c, secrets: () => ['hidden quill clock'], title: () => 't', caption: () => 'c', SVG_MAX: 1e6 });
  let err = null; try { GP.chaseDisplay({ id: 'c1' }, () => ({ svg: wrap('<g aria-label="Hidden Quill Clock"/>') }), fakeG); } catch (e) { err = e; }
  if (!err || !err.leak) throw new Error('a chase secret in an attribute was not caught');
});

await test('(k) no false positives on today\'s kit: the panel\'s options over 30 invented rolls at four reveals (the reviewer\'s roll set: seeds 7919 × 1–30)', async () => {
  const req = createRequire(import.meta.url), LOC = req(path.join(ROOT, 'app', 'gm', 'location.js'));
  const pk = JSON.parse(read(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'location-pack.json')));
  let n = 0, t = 0; const hits = [];
  for (let s = 1; s <= 30; s++) {
    const roll = LOC.generate(pk.body || pk, {}, { seed: s * 7919 });
    for (const reveal of [{ public: true }, { public: true, working: true }, { public: true, controlled: true }, { public: true, working: true, controlled: true, secure: true }]) {
      const R = GP.revealList({ layer: 'player', reveal });
      for (const view of GP.VIEWS) {
        const o = GP.mapOpts({ view, theme: GP.THEMES[(t++) % GP.THEMES.length] }, 'player', R, GP.IPAD_MAP);
        const h = GP.leaks(mapRender(roll, o).svg, roll, R); n++;
        if (h.length) hits.push(s + ' ' + view + '/' + o.theme + ' ' + R.join(',') + ': ' + h.join(' | '));
      }
      if (s % 5 === 0) { const sc = GP.scoreScene(roll, { layer: 'player', reveal }, mapRender); n += 2; if (sc.rings || sc.isoRings) hits.push(s + ' score scene fell back to rings at ' + R.join(',')); }
    }
  }
  if (hits.length) throw new Error(hits.length + ' of ' + n + ' renders flagged: ' + hits.slice(0, 4).join(' ; '));
  if (n < 600) throw new Error('only ' + n + ' renders');
});

/* ---------- (i) the chase strip: what the Chase panel sends to the iPad ---------- */
await test('(i) a hidden opposing clock, roll lines and GM notes never reach the chase strip sent to the iPad (200 invented chases), and the page sends a chase only through chaseDisplay', async () => {
  const req = createRequire(import.meta.url), CG = req(path.join(ROOT, 'app', 'gm', 'chase.js'));
  const kit = req(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
  req(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'chase-kit-stub.js'))(kit);        // a no-op once the kit has its own chase strip
  let s = 7; const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return s / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const WORDS = ['tram', 'kiosk', 'smoke', 'canal', 'barrier', 'rooftop', 'lantern', 'gutter', 'siren', 'crate', 'arcade', 'ramp'];
  const word = () => pick(WORDS) + Math.floor(rnd() * 900 + 100);
  let n = 0;
  for (let i = 0; i < 200; i++) {
    const src = CG.source('ground', pick(CG.GROUNDS).value, 'Invented ' + word());
    const hiddenName = 'Hidden ' + word() + ' ' + word();
    let c = kit.chaseNew(CG.startArgs({ name: 'Chase ' + word(), clockName: 'Run ' + word(), size: pick([4, 6, 8]), opp: 'hidden', oppName: hiddenName, oppSize: pick([4, 6, 8]), themToken: 'suv' }, src, 1000 + i));
    const rolls = [];
    for (let t = 0; t < 6 && CG.leg(c); t++) {
      const roll = 'Pc' + word() + ' · Prowl · ' + pick(['risky', 'desperate']) + '/standard · ' + Math.floor(rnd() * 6 + 1);
      rolls.push(roll.toLowerCase());
      c = kit.chaseTick(c, CG.tickArgs(c, { ticks: pick([1, 2, 3]), caption: 'Past the ' + word(), roll, between: rnd() < 0.3 ? 'A flashback to the ' + word() : '', level: pick(CG.LEVELS), time: pick(CG.TIMES) }));
      if (rnd() < 0.4) c = CG.oppose(c, 1);
    }
    c.panels[0].gm = 'GM only ' + word(); c.gm = 'GM only ' + word();
    const d = GP.chaseDisplay(c, kit.chase.bind(kit), CG), text = GP.svgText(d.svg);
    for (const secret of [hiddenName.toLowerCase(), c.panels[0].gm.toLowerCase(), c.gm.toLowerCase()].concat(rolls)) if (text.includes(secret)) throw new Error('chase ' + i + ': the pushed strip holds "' + secret + '"');
    if (/hidden|prowl/i.test(d.caption + ' ' + d.title)) throw new Error('chase ' + i + ': the title or caption names a secret: ' + d.title + ' / ' + d.caption);
    checkSvg(d.svg);
    const gm = GP.svgText(kit.chase(c, { layer: 'gm', layout: 'ipad', rolls: true }).svg);
    if (!gm.includes(hiddenName.toLowerCase()) || !gm.includes(rolls[0])) throw new Error('chase ' + i + ': the GM copy should have the hidden clock and the roll lines (is the check still testing anything?)');
    n++;
  }
  // the page: the chase push is built by chaseDisplay and marked at the gate in one function; nothing else in the panel sends an svg
  const src = read(path.join(ROOT, 'app', 'gm-page.js'));
  const from = src.indexOf('function chDoc()'), to = src.indexOf('function B68slug');
  if (from < 0 || to < from) throw new Error('the Chase panel code was not found');
  const panel = src.slice(from, to);
  if ((panel.match(/pushDisplay\(/g) || []).length !== 1 || (panel.match(/chaseDisplay\(/g) || []).length !== 1 || !/chaseDisplay\([\s\S]*?gate\.mark\(d\.svg\)[\s\S]*?pushDisplay\(\{ kind: 'svg', title: d\.title, caption: d\.caption, svg: d\.svg \}(\)|, \{\s*chase: true)/.test(panel)) throw new Error('the Chase panel sends something other than chaseDisplay\'s svg');
  if (/rolls: true/.test(src.slice(src.indexOf('function chaseDisplay'), src.indexOf('P.chaseDisplay')))) throw new Error('chaseDisplay asks for the roll lines');
  console.log('     ' + n + ' invented chases, map kit ' + kit.VERSION);
});

/* ---------- (m) the players' tokens (M3): crew markers and visible pinned clocks on the player copy, nothing else ---------- */
// The player copy of an authored site gains PC markers and the pinned clocks the players may see, in rooms the player copy shows.
// One pure builder (playerTokens) takes only the crew/pin maps, the revealed rooms, the clocks with their visibility and the PCs'
// names; one gate (tokenScreen, inside playerDisplay) refuses the whole set when any label or svg holds a hidden name. Every
// negative case below runs next to a positive control in the same setup, so a pipeline that never drew a token cannot pass.
const TK_ROLL = { name: 'Invented Works', district: 'Nowhere', target: 'Apartment building', targetRoom: 'Basement', targetBand: 'secure',
  physThreatName: 'Old Mags', socThreatName: 'Mr Vane', watcher: 'Tilly Frost, night porter',
  rooms: [{ name: 'Lobby', band: 'public' }, { name: 'Reception', band: 'public' }, { name: 'Break room', band: 'working' }, { name: 'Filing room', band: 'working' }, { name: 'Server room', band: 'controlled' }, { name: 'Basement', band: 'secure', isTarget: true }],
  vectors: [], skips: [] };
const TK_MAP = (extra) => ({ layer: 'player', view: 'rings', theme: 'rulebook', reveal: { public: true }, ...(extra || {}) });
const TK_CLOCKS = [{ id: 'c1', size: 6, filled: 2, hidden: false }, { id: 'c2', size: 4, filled: 1, hidden: true }];
const TK_PCS = [{ id: 'pc1', name: 'Cass Fenn' }, { id: 'pc2', name: 'Dov Ketch' }];
const tokCount = (svg) => (String(svg).match(/#fffdf6/g) || []).length;       // a token's own background: one per token
const stripIds = (s) => String(s).replace(/b68m\d+-/g, 'b68m-');

await test('(m) the builder: PC markers and visible pinned clocks in shown rooms only; a hidden clock is dropped whole; one token per room; labels are PC names only', async () => {
  const shown = ['Lobby', 'Reception'];
  const t = GP.playerTokens({ crew: { pc1: 'Lobby', pc2: 'Server room' }, pins: { c1: 'Lobby', c2: 'Reception' } }, shown, TK_CLOCKS, TK_PCS);
  assertEq(t.map((x) => [x.room, x.label]), [['Lobby', 'Cass Fenn']], 'the PC and the visible clock share Lobby; Dov is in a room the players cannot see; the hidden clock is dropped');
  if (!/<path d="M/.test(t[0].svg) || !t[0].svg.includes('>CF<')) throw new Error('positive control: the pill and the pie are drawn: ' + t[0].svg);
  const visible = GP.playerTokens({ crew: {}, pins: { c2: 'Reception' } }, shown, [{ ...TK_CLOCKS[1], hidden: false }], TK_PCS);
  assertEq(visible.map((x) => x.room), ['Reception'], 'positive control: the same pin with the clock visible draws one token');
  assertEq(GP.playerTokens({ crew: {}, pins: { c2: 'Reception' } }, shown, TK_CLOCKS, TK_PCS), [], 'the hidden clock alone draws nothing, not a blank token');
  assertEq(GP.playerTokens({ crew: { pc1: 'Lobby' } }, shown, TK_CLOCKS, [{ id: 'pc9', name: 'Nobody' }]), [], 'a crew id the table does not have draws nothing');
  const five = GP.playerTokens({ crew: { a: 'Lobby', b: 'Lobby', c: 'Lobby', d: 'Lobby', e: 'Lobby' }, pins: {} }, shown, [], 'abcde'.split('').map((id) => ({ id, name: 'Pc ' + id.toUpperCase() })));
  assertEq([five.length, five[0].label], [1, 'Pc A, Pc B, Pc C +2'], 'five PCs in a room: one token, three names and a count');
  if (!five[0].svg.includes('>+2<')) throw new Error('the +N pill');
  const esc = GP.playerTokens({ crew: { x: 'Lobby' } }, shown, [], [{ id: 'x', name: '<b>"&' }]);
  if (/<b>/.test(esc[0].svg) || !esc[0].svg.includes('&lt;')) throw new Error('a name is escaped in the svg');
  assertEq(GP.playerTokens({ crew: { pc1: 'Lobby', pc2: 'Lobby' }, pins: { c1: 'Lobby' } }, shown, TK_CLOCKS, TK_PCS), GP.playerTokens({ pins: { c1: 'Lobby' }, crew: { pc2: 'Lobby', pc1: 'Lobby' } }, shown, TK_CLOCKS.slice().reverse(), TK_PCS), 'the same markers whatever the order of keys');
});

await test('(m) the builder is blind: lens, people, play, danger and timeline passed with the placement never appear; and the call site picks { crew, pins } only', async () => {
  const poison = { crew: { pc1: 'Lobby' }, pins: { c1: 'Lobby' }, lens: 'POISONLENS', people: [{ label: 'POISONPERSON' }], play: { people: [{ label: 'POISONPLAY' }] }, danger: true, t: 99, open: ['POISONOPEN'], dawn: { at: 'POISONDAWN' } };
  const t = GP.playerTokens(poison, ['Lobby'], [{ ...TK_CLOCKS[0], lens: 'POISONLENS', people: 'POISONPERSON', name: 'POISONCLOCKNAME' }], [{ ...TK_PCS[0], play: 'POISONPLAY', notes: 'POISONNOTES' }]);
  if (t.length !== 1) throw new Error('positive control: one token');
  const all = JSON.stringify(t);
  if (/POISON|#d11/.test(all)) throw new Error('a field that is not a crew or pin map, a PC name or a clock\'s size/filled reached a token: ' + all);
  const src = read(path.join(ROOT, 'app', 'gm-page.js'));
  const sig = src.match(/function playerTokens\(([^)]*)\)/);
  if (!sig || sig[1].replace(/\s/g, '') !== "placed,shown,clocks,pcs,mark") throw new Error('playerTokens\' parameters changed: ' + (sig && sig[1]));
  const body = src.slice(src.indexOf('function playerTokens('), src.indexOf('function tokenHidden('));
  if (/\.lens|\.people|\bplay\b|\.stops|\.events|\.disguises/.test(body.replace(/\/\*[\s\S]*?\*\//g, ''))) throw new Error('playerTokens reads something it must never see');
  const set = src.slice(src.indexOf('function playerTokenSet('), src.indexOf('/* ---- the strip ---- */'));
  if (!/placed = \{ crew: isObj\(st\.crew\) \? st\.crew : \{\}, pins: isObj\(st\.pins\) \? st\.pins : \{\} \}/.test(set) || !/ballDoc\(rs\.name\)/.test(set)) throw new Error('the call site no longer picks { crew, pins } from ballDoc');
  if (/S\.doc\.ball|runCache|runTokens|runApply|runModel/.test(set)) throw new Error('the player set reads the raw ball, the GM cache or the GM token builder');
  const display = src.slice(src.indexOf('function playerDisplay('), src.indexOf('P.playerDisplay'));
  if (/runCache|runTokens|runApply/.test(display)) throw new Error('playerDisplay touches the GM drawing path');
});

await test('(m) an NPC name, a hidden room, a threat or the watcher in a label refuses every marker (the map still goes), each next to a clean control', async () => {
  const rooms = ['Lobby', 'Reception'], hide = ['Odette Marsh', 'Cook'];
  const tokensFor = (name) => GP.playerTokens({ crew: { x: 'Lobby', y: 'Reception' }, pins: {} }, rooms, [], [{ id: 'x', name }, { id: 'y', name: 'Dov Ketch' }]);
  const draw = (name, extra) => GP.playerDisplay(TK_ROLL, TK_MAP(extra), mapRender, { tokens: tokensFor(name), hide });
  const control = draw('Cass Fenn');
  if (control.tokens !== 2 || control.tokensRefused || tokCount(control.svg) !== 2) throw new Error('positive control: two markers drawn (' + control.tokens + ', ' + tokCount(control.svg) + ')');
  const bare = GP.playerDisplay(TK_ROLL, TK_MAP(), mapRender);
  for (const [what, name] of [['an NPC (play.people label)', 'Odette Marsh'], ['an NPC in other case and spacing', ' ODETTE   marsh '], ['a disguise label', 'Cook'], ['a hidden room', 'Server room'], ['a hidden room in a name', 'Ada of the Filing Room'], ['the physical threat', 'Old Mags'], ['the social threat', 'Mr Vane'], ['the watcher', 'Tilly Frost'], ['the watcher, whole', 'Tilly Frost, night porter']]) {
    const d = draw(name);
    if (d.tokens !== 0 || !d.tokensRefused) throw new Error(what + ': the markers were not refused (' + d.tokens + ')');
    if (tokCount(d.svg) !== 0) throw new Error(what + ': a token is on the map');
    if (GP.svgText(d.svg).includes(name.trim().toLowerCase().replace(/\s+/g, ' '))) throw new Error(what + ': the name is on the map');
    assertEq(stripIds(d.svg), stripIds(bare.svg), what + ': the map goes without markers, exactly as it would have with none');
    checkSvg(d.svg);
  }
  // one bad marker refuses the whole set, the clean one included
  const two = GP.playerTokens({ crew: { x: 'Lobby', y: 'Reception' }, pins: {} }, rooms, [], [{ id: 'x', name: 'Cass Fenn' }, { id: 'y', name: 'Odette Marsh' }]);
  const d2 = GP.playerDisplay(TK_ROLL, TK_MAP(), mapRender, { tokens: two, hide });
  if (d2.tokens !== 0 || tokCount(d2.svg) !== 0 || !d2.tokensRefused) throw new Error('the clean marker went out beside a bad one');
  // a hidden name in the token svg itself (not the label), or a token that is not exactly { room, label, svg }
  const sneaky = [{ room: 'Lobby', label: 'Cass Fenn', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 600"><title>Server room</title><rect width="540" height="600" fill="#fffdf6"/></svg>' }];
  if (GP.playerDisplay(TK_ROLL, TK_MAP(), mapRender, { tokens: sneaky, hide }).tokens !== 0) throw new Error('a hidden name in the token svg went out');
  if (GP.playerDisplay(TK_ROLL, TK_MAP(), mapRender, { tokens: [{ ...two[0], extra: 'x' }], hide }).tokens !== 0) throw new Error('a token with an extra field went out');
  if (GP.playerDisplay(TK_ROLL, TK_MAP(), mapRender, { tokens: [{ room: 'Lobby', label: 1, svg: sneaky[0].svg }], hide }).tokens !== 0) throw new Error('a token with a non-string label went out');
  // the names that are revealed are not secrets: a PC called like a shown room is fine
  if (draw('Reception').tokens !== 2) throw new Error('a shown room\'s name is not a secret');
  const open = GP.playerDisplay(TK_ROLL, TK_MAP({ reveal: { public: true, controlled: true } }), mapRender, { tokens: tokensFor('Server room'), hide: [] });
  if (open.tokens !== 2) throw new Error('once the band is revealed the name is fair game');
  if (GP.scoreScene.length !== 3) throw new Error('scoreScene takes a new argument: it must never carry tokens');
});

await test('(m) a hidden clock is never drawn, and a marker in a room the players cannot see is never drawn (a positive control beside each)', async () => {
  const scene = (tk, extra) => GP.playerDisplay(TK_ROLL, TK_MAP(extra), mapRender, tk);
  const hiddenOnly = GP.playerTokens({ crew: {}, pins: { c1: 'Lobby', c2: 'Reception' } }, ['Lobby', 'Reception'], TK_CLOCKS, TK_PCS);
  assertEq(hiddenOnly.map((t) => t.room), ['Lobby'], 'the visible pin draws, the hidden one does not');
  const d = scene({ tokens: hiddenOnly, hide: [] });
  if (d.tokens !== 1 || tokCount(d.svg) !== 1) throw new Error('positive control: the visible clock\'s pie is on the map');
  // the same markers placed in rooms that are not revealed: the builder drops them, and so does the screen and the kit even when handed them
  const unseen = GP.playerTokens({ crew: { pc1: 'Server room', pc2: 'Break room' }, pins: { c1: 'Basement' } }, ['Lobby', 'Reception'], TK_CLOCKS, TK_PCS);
  assertEq(unseen, [], 'the builder draws nothing in rooms the players cannot see');
  const forced = [{ room: 'Server room', label: 'Cass Fenn', svg: GP.runTokenSvg({ pills: [{ t: 'CF', c: '#111111' }] }) }, { room: 'Lobby', label: 'Dov Ketch', svg: GP.runTokenSvg({ pills: [{ t: 'DK', c: '#111111' }] }) }];
  const f = scene({ tokens: forced, hide: [] });
  if (f.tokens !== 1 || tokCount(f.svg) !== 1 || /Cass Fenn/i.test(GP.svgText(f.svg)) || !/dov ketch/i.test(GP.svgText(f.svg))) throw new Error('the screen did not drop the token in the unrevealed room, or lost the one in Lobby: ' + f.tokens + ' ' + tokCount(f.svg));
  const o = GP.mapOpts({ view: 'rings', theme: 'rulebook' }, 'player', ['public'], GP.IPAD_MAP);
  if (tokCount(mapRender(TK_ROLL, { ...o, tokens: forced }).svg) !== 1 || tokCount(mapRender(TK_ROLL, o).svg) !== 0) throw new Error('the kit itself drops a token in an unrevealed room (kit ' + MAPKIT.VERSION + ')');
  const all = scene({ tokens: forced, hide: [] }, { reveal: { public: true, controlled: true } });
  if (all.tokens !== 2 || tokCount(all.svg) !== 2) throw new Error('positive control: reveal the band and the token in Server room draws');
});

await test('(m) with nothing to show, the player copy is byte-identical to today\'s: no tokens key, the same render calls', async () => {
  const calls = [];
  const spy = (roll, o) => { calls.push(o); return mapRender(roll, o); };
  const base = GP.playerDisplay(TK_ROLL, TK_MAP(), spy), baseCalls = calls.length;
  const hidden = GP.playerTokens({ crew: { pc1: 'Server room' }, pins: { c2: 'Lobby' } }, ['Lobby', 'Reception'], TK_CLOCKS, TK_PCS);
  for (const tk of [undefined, { tokens: [], hide: ['Odette Marsh'] }, { tokens: hidden, hide: [] }, { tokens: [{ room: 'Server room', label: 'Cass Fenn', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 600"/>' }], hide: [] }]) {
    calls.length = 0;
    const d = GP.playerDisplay(TK_ROLL, TK_MAP(), spy, tk);
    assertEq(stripIds(d.svg), stripIds(base.svg), 'the same bytes');
    assertEq([d.title, d.caption, d.reveal, d.tokens], [base.title, base.caption, base.reveal, 0], 'the same fields');
    if (calls.length !== baseCalls || calls.some((x) => 'tokens' in x)) throw new Error('the render options changed: ' + JSON.stringify(calls.map((x) => Object.keys(x))));
  }
  // and the failure paths are the old ones: a leaking iso is redrawn as rings, rings that leak are refused
  const seen = [];
  const isoLeaks = (roll, o) => { seen.push(o.view); return o.view === 'iso' ? { svg: '<svg><text>Server room</text></svg>' } : mapRender(roll, o); };
  GP.playerDisplay(TK_ROLL, TK_MAP({ view: 'iso' }), isoLeaks, { tokens: [], hide: [] });
  assertEq(seen, ['iso', 'rings'], 'the old fallback');
  let err = null;
  try { GP.playerDisplay(TK_ROLL, TK_MAP(), () => ({ svg: '<svg><text>Server room</text></svg>' }), { tokens: hidden, hide: [] }); } catch (e) { err = e; }
  if (!err || !err.leak) throw new Error('a map that leaks by itself is still refused');
});

await test('(m) a map that only leaks WITH its markers goes without them; a clean pair draws both', async () => {
  const mk = GP.playerTokens({ crew: { pc1: 'Lobby' }, pins: {} }, ['Lobby'], [], TK_PCS);
  const calls = [];
  const leakWithTokens = (roll, o) => { calls.push(!!o.tokens); const r = mapRender(roll, o); return o.tokens ? { ...r, svg: r.svg.replace('</svg>', '<text>Server room</text></svg>') } : r; };
  const d = GP.playerDisplay(TK_ROLL, TK_MAP(), leakWithTokens, { tokens: mk, hide: [] });
  assertEq(calls, [true, false], 'first with the markers, then without');
  if (d.tokens !== 0 || !d.tokensRefused || tokCount(d.svg) !== 0 || GP.leaks(d.svg, TK_ROLL, ['public']).length) throw new Error('not dropped cleanly');
  const ok = GP.playerDisplay(TK_ROLL, TK_MAP(), mapRender, { tokens: mk, hide: [] });
  if (ok.tokens !== 1 || ok.tokensRefused) throw new Error('positive control');
});

await test('(m) the real kit, 30 invented rolls at four reveals: markers appear in shown rooms only, hidden clocks never, every copy clean and accepted by the server\'s svg check', async () => {
  const req = createRequire(import.meta.url), LOC = req(path.join(ROOT, 'app', 'gm', 'location.js'));
  const pk = JSON.parse(read(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'location-pack.json')));
  let n = 0, drawn = 0;
  const bad = [];
  for (let s = 1; s <= 30; s++) {
    const roll = LOC.generate(pk.body || pk, {}, { seed: s * 7919 });
    for (const reveal of [{ public: true }, { public: true, working: true }, { public: true, controlled: true }, { public: true, working: true, controlled: true, secure: true }]) {
      const map = { layer: 'player', view: ['iso', 'rings', 'plan', 'section'][s % 4], theme: 'rulebook', reveal }, R = GP.revealList(map);
      const names = roll.rooms.map((r) => r.name), seenRooms = roll.rooms.filter((r) => R.includes(r.band)).map((r) => r.name);
      const lab = (i) => 'Zq' + String.fromCharCode(97 + i) + 'pc';
      const crew = {}, pcs = names.map((nm, i) => { crew['z' + i] = nm; return { id: 'z' + i, name: lab(i) }; });
      const pins = { c1: names[0], c2: names[names.length - 1] };
      const clocks = [{ id: 'c1', size: 6, filled: 3, hidden: false }, { id: 'c2', size: 4, filled: 1, hidden: true }];
      const tokens = GP.playerTokens({ crew, pins }, seenRooms, clocks, pcs);
      if (tokens.some((t) => !seenRooms.includes(t.room))) bad.push(s + ': a token in a room that is not shown');
      let d;
      try { d = GP.playerDisplay(roll, map, mapRender, { tokens, hide: ['Odette Marsh'] }); } catch (e) { bad.push(s + ' ' + map.view + ': ' + e.message); continue; }
      n++;
      if (d.tokensRefused) bad.push(s + ' ' + R.join(',') + ': refused');
      const text = GP.svgText(d.svg);
      names.forEach((nm, i) => { if (!seenRooms.includes(nm) && text.includes(lab(i).toLowerCase())) bad.push(s + ': the marker of a hidden room is on the copy'); });
      if (GP.leaks(d.svg, roll, R).length) bad.push(s + ': leaks');
      try { checkSvg(d.svg); } catch (e) { bad.push(s + ': checkSvg ' + e.message); }
      drawn += tokCount(d.svg);
      if (d.tokens && !tokCount(d.svg)) bad.push(s + ' ' + map.view + ': none drawn although ' + d.tokens + ' were handed over');
    }
  }
  if (bad.length) throw new Error(bad.length + ' problems: ' + bad.slice(0, 4).join(' ; '));
  if (n < 100 || drawn < 100) throw new Error('only ' + n + ' copies and ' + drawn + ' markers: the check is not testing anything');
  console.log('     ' + n + ' player copies, ' + drawn + ' markers drawn');
});

/* ---------- (m) VV8: the target's marker on the player layer (design 5.3, H6) ---------- */
// B.targetInView is the one rule (the target, at the published ball.t, in an open room, at a public event or with a PC); playerTokens draws it
// through the same tokenScreen as the crew. Each negative runs beside a positive control.
const VV8_B = createRequire(import.meta.url)(path.join(ROOT, 'app', 'gm', 'ball.js'));
const VV8_PLAY = JSON.parse(read(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'pelican-play-v2.json')));
const VV8_TARGET = VV8_PLAY.people.filter((p) => p.target === true || p.kind === 'target')[0];
const vv8Crew = (room, extra) => ({ pc1: { room, disguise: 'guest', ...(extra || {}) } });
const vv8 = (t, crew, open, over, play) => VV8_B.targetInView(play || VV8_PLAY, { site: 'Invented Works', t, crew: crew || {}, over: over || {}, open: open || [] }, open || []);
const VV8_ALL = ['Showroom', 'Cocktail lounge', 'Private card rooms', 'Security control room', 'Underground counting room', 'Luxury penthouse'];

await test('(m) VV8 the marker comes and goes with the time: at a public event, with a PC in his room, and neither', () => {
  assertEq(VV8_TARGET.label, 'Odette Marsh', 'the fixture\'s target');
  assertEq(vv8(60, {}, VV8_ALL), { room: 'Showroom', label: 'Odette Marsh' }, 'the public event is on (22:00) in his room, no PC anywhere');
  assertEq(vv8(100, {}, VV8_ALL), null, 'positive-control pair: 22:40, no event, no PC in his room');
  assertEq(vv8(100, vv8Crew('Showroom'), VV8_ALL), { room: 'Showroom', label: 'Odette Marsh' }, 'a PC is in his room');
  assertEq(vv8(100, vv8Crew('Cocktail lounge'), VV8_ALL), null, 'a PC in another room');
  assertEq(vv8(150, vv8Crew('Private card rooms'), VV8_ALL), { room: 'Private card rooms', label: 'Odette Marsh' }, '23:30 he has moved: the marker moved with him');
  assertEq(vv8(150, vv8Crew('Showroom'), VV8_ALL), null, '... and the PC left behind sees nothing');
  assertEq(vv8(75, {}, VV8_ALL), null, 'the event is over at 22:15');
  assertEq(vv8(0, {}, VV8_ALL), null, 'before the event');
});

await test('(m) VV8 the marker never shows in a room that is not open (each beside its open control)', () => {
  assertEq(vv8(60, {}, ['Showroom']).room, 'Showroom', 'control: Showroom open');
  assertEq(vv8(60, {}, ['Cocktail lounge', 'Private card rooms']), null, 'his room closed, others open');
  assertEq(vv8(60, {}, []), null, 'nothing open');
  assertEq(vv8(150, vv8Crew('Private card rooms'), ['Showroom']), null, 'a PC with him in a closed room');
  const drawn = GP.playerTokens({ crew: {}, pins: {} }, ['Showroom'], [], [], { room: 'Private card rooms', label: 'Odette Marsh' });
  assertEq(drawn, [], 'playerTokens: a mark in a room it was not told is open draws nothing');
  assertEq(GP.playerTokens({ crew: {}, pins: {} }, ['Showroom'], [], [], { room: 'Showroom', label: 'Odette Marsh' }).map((x) => [x.room, x.label]), [['Showroom', 'Odette Marsh']], 'control: open');
});

await test('(m) VV8 only the target: a non-target person in view gets no marker (positive control beside it)', () => {
  // Pip Quill (staff) is in the Cocktail lounge from 21:00 with a PC; the target is in the Showroom
  assertEq(vv8(10, vv8Crew('Cocktail lounge'), VV8_ALL), null, 'a staff member and a PC in the Cocktail lounge, the target elsewhere: no marker');
  assertEq(vv8(10, vv8Crew('Showroom'), VV8_ALL), { room: 'Showroom', label: 'Odette Marsh' }, 'control: the target with a PC does get one');
  const m = vv8(10, vv8Crew('Showroom'), VV8_ALL);
  assertEq(Object.keys(m).sort(), ['label', 'room'], 'only a room and a label');
  const toks = GP.playerTokens({ crew: { pc1: 'Showroom' }, pins: {} }, ['Showroom'], [], [{ id: 'pc1', name: 'Cass Fenn', icon: '' }], m);
  const all = JSON.stringify(toks);
  for (const n of ['Wren', 'Tully', 'Pip', 'Quill', 'GM-ONLY']) if (all.includes(n)) throw new Error('a non-target name reached the marker: ' + n);
  assertEq(toks.map((x) => [x.room, x.label]), [['Showroom', 'Odette Marsh, Cass Fenn']], 'one token per room: the target first, then the PC');
  if (!toks[0].svg.includes('>OM<') || !toks[0].svg.includes('>CF<')) throw new Error('both pills drawn');
  const rich = GP.playerTokens({ crew: {}, pins: {} }, ['Showroom'], [], [], { room: 'Showroom', label: 'Odette Marsh', look: 'POISONLOOK', note: 'POISONNOTE', wary: true });
  if (rich.length !== 1 || /POISON|wary/.test(JSON.stringify(rich))) throw new Error('an extra key on the mark reached the token');
});

await test('(m) VV8 the marker follows a Lockdown (over.at) and disappears on Target is down (over.gone)', () => {
  assertEq(vv8(100, vv8Crew('Showroom'), VV8_ALL), { room: 'Showroom', label: 'Odette Marsh' }, 'control: before');
  assertEq(vv8(100, vv8Crew('Showroom'), VV8_ALL, { od: { at: 'Cocktail lounge' } }), null, 'locked into the Cocktail lounge: gone from the Showroom');
  assertEq(vv8(100, vv8Crew('Cocktail lounge'), VV8_ALL, { od: { at: 'Cocktail lounge' } }), { room: 'Cocktail lounge', label: 'Odette Marsh' }, 'and there with a PC: shown there');
  assertEq(vv8(100, vv8Crew('Cocktail lounge'), ['Showroom'], { od: { at: 'Cocktail lounge' } }), null, 'the lockdown room closed: nothing');
  assertEq(vv8(60, vv8Crew('Showroom'), VV8_ALL, { od: { gone: true } }), null, 'Target is down: nobody to show, even at a public event with a PC');
  assertEq(vv8(60, vv8Crew('Showroom'), VV8_ALL, { od: { gone: false } }) !== null, true, 'control: gone:false is not gone');
});

await test('(m) VV8 v1 is unchanged: a v1 play gives no marker, and playerTokens without a mark is as before', () => {
  assertEq(VV8_B.targetInView({ v: 1, clock: { start: '21:00', end: '01:00' } }, { t: 60, crew: { pc1: 'Showroom' } }, VV8_ALL), null, 'v1 play');
  assertEq(VV8_B.targetInView(null, {}, []), null, 'no play');
  assertEq(VV8_B.targetInView(VV8_PLAY, null, VV8_ALL), null, 'no state: t 0, nothing on');
  const four = GP.playerTokens({ crew: { pc1: 'Lobby' }, pins: {} }, ['Lobby'], [], TK_PCS);
  if (four.length !== 1) throw new Error('control: one token');
  assertEq(GP.playerTokens({ crew: { pc1: 'Lobby' }, pins: {} }, ['Lobby'], [], TK_PCS, null), four, 'a null mark is no mark');
  assertEq(GP.playerTokens({ crew: { pc1: 'Lobby' }, pins: {} }, ['Lobby'], [], TK_PCS, { room: 'Lobby' }), four, 'a mark without a label draws nothing');
});

await test('(m) VV8 the gate: the target\'s label passes only when the page allows it, any other person still refuses the set; icons are glyphs; the page wiring', async () => {
  const roll = { ...TK_ROLL, rooms: [{ name: 'Showroom', band: 'public' }, { name: 'Cocktail lounge', band: 'public' }, { name: 'Private card rooms', band: 'controlled' }], targetRoom: 'Private card rooms', targetBand: 'controlled' };
  const mk = GP.playerTokens({ crew: { pc1: 'Showroom' }, pins: {} }, ['Showroom', 'Cocktail lounge'], [], [{ id: 'pc1', name: 'Cass Fenn', icon: '🎭' }], { room: 'Showroom', label: 'Odette Marsh' });
  if (!mk[0].svg.includes('🎭')) throw new Error('the costume icon is on the pill');
  const others = ['Wren Tully', 'Pip Quill', 'Guest'];       // the deny list the page builds, with the target's label taken out
  const ok = GP.playerDisplay(roll, TK_MAP(), mapRender, { tokens: mk, hide: others });
  if (ok.tokens !== 1 || ok.tokensRefused || tokCount(ok.svg) !== 1) throw new Error('control: the marker is drawn (' + ok.tokens + ')');
  const bad = GP.playerDisplay(roll, TK_MAP(), mapRender, { tokens: mk, hide: ['Odette Marsh'].concat(others) });
  if (bad.tokens !== 0 || !bad.tokensRefused) throw new Error('with the target on the deny list the set is refused');
  const other = GP.playerTokens({ crew: {}, pins: {} }, ['Showroom'], [], [], { room: 'Showroom', label: 'Wren Tully' });
  const refused = GP.playerDisplay(roll, TK_MAP(), mapRender, { tokens: other, hide: others });
  if (refused.tokens !== 0 || !refused.tokensRefused) throw new Error('a non-target label on a mark is refused by the gate');
  const src = read(path.join(ROOT, 'app', 'gm-page.js'));
  const deny = src.slice(src.indexOf('function tokenDeny('), src.indexOf('RUN_ICONS'));
  if (/p\.kind === 'target' && fold\(p\.label\) === ok/.test(deny)) { /* ok */ } else throw new Error('tokenDeny exempts something other than the target');
  const set = src.slice(src.indexOf('function playerTokenSet('), src.indexOf('/* ---- the strip ---- */'));
  if (!/targetMark\(rs, st, shown\)/.test(set) || !/P\.playerTokens\(placed, shown, clocks, pcs, mark\)/.test(set) || !/tokenDeny\(rs\.play, mark \? mark\.label : ''\)/.test(set)) throw new Error('the player set does not build the marker through playerTokens and the deny list');
  if (!/rs\.B\.targetInView\(rs\.play, st, shown\)/.test(src)) throw new Error('the marker is not B.targetInView at the published ball');
  if (/\bpeek\b|S\.rvPeek|shownT/.test(set)) throw new Error('the player set reads a peek');
});

await test('(m) VV8 a hidden target gets no marker (the page checks hiddenSecretNames); costume glyphs are emoji-presentation, an unknown icon draws none', () => {
  const src = read(path.join(ROOT, 'app', 'gm-page.js'));
  const tm = src.slice(src.indexOf('function targetMark('), src.indexOf('function playerTokenSet('));
  if (!tm.includes("hiddenSecretNames().some(function (n) { return fold(n) === f; }) ? null : m")) throw new Error("targetMark does not drop a hidden NPC's name");
  const pill = (i) => GP.runTokenSvg({ pills: [{ t: 'CF', c: '#111111', i }], pies: [] });
  const known = pill('🎭');
  if (!known.includes('🎭️') || !/fill="#fff"/.test(known) || !/font-family="[^"]*Emoji/.test(known)) throw new Error('control: a known glyph is drawn with U+FE0F, a fill and an emoji font');
  for (const bad of ['G', 'xx', '', undefined, '<b>']) if (/font-size="44"/.test(pill(bad))) throw new Error('an unknown icon drew something: ' + bad);
  assertEq(pill('G').includes('>G<'), false, 'and not a letter');
});

/* ---------- (n) single rooms (M4 step 5; map kit 0.9 "room:<name>" reveal entries) ---------- */
// An invented site made of the kit's own catalogue room names, so the kit really draws every room (floor tint, walls, doors, fixtures).
// Each negative case runs next to a positive control in the same setup: the opened room IS on the copy.
const RM_ROLL = { name: 'Invented Pelican', district: 'Nowhere', target: 'Casino', targetRoom: 'Luxury penthouse', targetBand: 'secure',
  physThreatName: 'Old Mags', socThreatName: 'Mr Vane', watcher: 'Tilly Frost, night porter',
  rooms: [{ name: 'Showroom', band: 'public' }, { name: 'Cocktail lounge', band: 'public' }, { name: 'Security control room', band: 'working' },
    { name: 'Underground counting room', band: 'working' }, { name: 'Private card rooms', band: 'controlled' }, { name: 'Luxury penthouse', band: 'secure', isTarget: true }],
  vectors: [], skips: [] };
const RM_NAMES = RM_ROLL.rooms.map((r) => r.name.toLowerCase());
const RM_MAP = (extra) => ({ layer: 'player', view: 'iso', theme: 'rulebook', reveal: { public: true }, ...(extra || {}) });
const roomIds = (svg) => [...new Set((String(svg).match(/data-room="r(\d+)"/g) || []).map((s) => +s.slice(12, -1)))].sort((a, b) => a - b);
const namesIn = (svg) => { const t = GP.svgText(svg), src = String(svg).toLowerCase(); return { text: RM_NAMES.filter((n) => t.includes(n)), source: RM_NAMES.filter((n) => src.includes(n)) }; };
const knownCount = (map) => { const e = GP.revealEntries(map); return RM_ROLL.rooms.filter((r) => GP.roomShown(r, e)).length; };

await test('(n) the one rule: a room is shown when its band is revealed OR it has its own room entry; open names count only on the player layer; junk means no rooms', () => {
  const room = { name: 'Private card rooms', band: 'controlled' };
  assertEq([GP.roomShown(room, ['public']), GP.roomShown(room, ['public', 'controlled']), GP.roomShown(room, ['public', 'room:Private card rooms'])], [false, true, true], 'band, entry, neither');
  assertEq([GP.roomShown(room, ['public', 'room:private card rooms']), GP.roomShown(room, ['public', 'room:Private card']), GP.roomShown(room, ['room:Private card rooms2'])], [false, false, false], 'the entry is the exact name');
  assertEq([GP.roomShown(null, ['public']), GP.roomShown(room, null), GP.roomShown({ name: 'X' }, ['public'])], [false, false, false], 'not a room, not a list');
  assertEq(GP.revealEntries({ layer: 'player', reveal: { public: true, working: true }, open: ['Showroom', 'Showroom', 7, '', null, 'Private card rooms'] }), ['public', 'working', 'room:Showroom', 'room:Private card rooms'], 'bands then rooms; duplicates and junk dropped');
  assertEq(GP.revealEntries({ layer: 'gm', reveal: { public: true, working: true }, open: ['Private card rooms'] }), ['public'], 'the GM layer reveals nothing beyond public, rooms included');
  assertEq([GP.revealEntries({ layer: 'player', reveal: { public: true } }), GP.revealEntries({ layer: 'player', reveal: { public: true }, open: 'Showroom' }), GP.revealEntries({ layer: 'player', reveal: { public: true }, open: { 0: 'Showroom' } })], [['public'], ['public'], ['public']], 'an absent or malformed field is no rooms');
  assertEq([GP.revealList({ layer: 'player', reveal: { public: true }, open: ['Private card rooms'] }), GP.entryRooms(['public', 'room:A', 'room:B c']), GP.entryBands(['public', 'room:A', 'working'])], [['public'], ['A', 'B c'], ['public', 'working']], 'revealList stays bands only (the street text and the score scene use it)');
  const o = GP.mapOpts({ view: 'iso', theme: 'rulebook', open: ['Private card rooms'] }, 'player', ['public'], GP.IPAD_MAP);
  assertEq(o.reveal, ['public', 'room:Private card rooms'], 'mapOpts hands the kit the room entries beside the bands');
  assertEq(GP.mapOpts({ view: 'iso', theme: 'rulebook', open: ['Private card rooms'] }, 'gm', ['public'], GP.IPAD_MAP).reveal, ['public'], 'not on the GM layer');
  assertEq(GP.mapOpts({ view: 'iso', theme: 'rulebook' }, 'player', ['public'], GP.IPAD_MAP).reveal, ['public'], 'no field, the same list as ever');
});

await test('(n) a room opened alone in a closed band: that room is on the copy (positive control), no hidden room\'s name, tint, wall, door or fixture is, and the rooms are numbered 1..k', async () => {
  let n = 0;
  for (const view of GP.VIEWS.filter((v) => v !== 'street')) for (const theme of ['rulebook', 'blueprint', 'plate']) for (const open of [['Private card rooms'], ['Luxury penthouse'], ['Underground counting room']]) {
    const map = RM_MAP({ view, theme, open }), want = open[0].toLowerCase();
    const calls = [], spy = (r, o) => { calls.push(o); return mapRender(r, o); };
    const d = GP.playerDisplay(RM_ROLL, map, spy);
    if (calls.length !== 1 || calls[0].layout !== 'ipad' || JSON.stringify(calls[0].reveal) !== JSON.stringify(['public', 'room:' + open[0]])) throw new Error('the kit was not handed the room entry: ' + JSON.stringify(calls.map((c) => c.reveal)));
    assertEq(d.reveal, ['public', 'room:' + open[0]], 'the display\'s reveal');
    const seen = namesIn(d.svg), where = view + '/' + theme + '/' + open[0];
    if (!seen.text.includes(want)) throw new Error(where + ': positive control: the opened room is not on the copy');
    for (const nm of RM_NAMES) if (!['showroom', 'cocktail lounge', want].includes(nm) && (seen.text.includes(nm) || seen.source.includes(nm))) throw new Error(where + ': the copy holds the hidden room "' + nm + '"');
    for (const s of [RM_ROLL.physThreatName, RM_ROLL.socThreatName, 'Tilly Frost']) if (GP.svgText(d.svg).includes(s.toLowerCase())) throw new Error(where + ': prints ' + s);
    // numbers: the crew knows k rooms and the copy numbers them r0..r(k-1); a gap, or a number above k, would say how many are shut
    const k = knownCount(map), ids = roomIds(d.svg);
    if (k !== 3) throw new Error('self-test: three rooms are known');
    if (!ids.length || ids.some((i) => i >= k)) throw new Error(where + ': a data-room id above k=' + k + ': ' + ids.join(','));
    if (ids.length < 3) throw new Error(where + ': positive control: all three known rooms are numbered (' + ids.join(',') + ')');
    if (GP.leaks(d.svg, RM_ROLL, GP.revealEntries(map)).length) throw new Error(where + ': the page\'s own scan finds a leak');
    checkSvg(d.svg);
    n++;
  }
  if (n < 30) throw new Error('only ' + n + ' copies checked');
  // the same room opened alone is a different copy from the band-only copy, and the GM copy still has every room and the book's numbers
  const bare = GP.playerDisplay(RM_ROLL, RM_MAP(), mapRender), one = GP.playerDisplay(RM_ROLL, RM_MAP({ open: ['Private card rooms'] }), mapRender);
  if (one.svg === bare.svg || roomIds(bare.svg).join() !== '0,1') throw new Error('opening a room changed nothing, or the band-only copy is not r0,r1');
  const gm = mapRender(RM_ROLL, { view: 'iso', layer: 'gm', reveal: ['public'], layout: 'ipad' }).svg;
  if (roomIds(gm).join() !== '0,1,2,3,4,5' || namesIn(gm).text.length !== 6) throw new Error('self-test: the GM copy should have all six rooms, numbered as the book numbers them');
});

await test('(n) a room opened on top of a band: the band and that room show, the rest does not; ids stay below k, and the caption names only what is open', async () => {
  const map = RM_MAP({ reveal: { public: true, working: true }, open: ['Private card rooms'] });
  // the street view is the public street whatever is open (kit 0.9): it must not name a shut room, and it is not asked to show the opened one
  const street = GP.playerDisplay(RM_ROLL, { ...map, view: 'street' }, mapRender);
  for (const nm of ['security control room', 'underground counting room', 'private card rooms', 'luxury penthouse']) if (namesIn(street.svg).text.includes(nm) || namesIn(street.svg).source.includes(nm)) throw new Error('street: names "' + nm + '"');
  for (const view of GP.VIEWS.filter((v) => v !== 'street')) {
    const d = GP.playerDisplay(RM_ROLL, { ...map, view }, mapRender), seen = namesIn(d.svg);
    for (const nm of ['showroom', 'cocktail lounge', 'security control room', 'underground counting room', 'private card rooms']) if (!seen.text.includes(nm)) throw new Error(view + ': positive control: "' + nm + '" should be on the copy');
    if (seen.text.includes('luxury penthouse') || seen.source.includes('luxury penthouse')) throw new Error(view + ': the secure band\'s room is on the copy');
    const k = knownCount(map), ids = roomIds(d.svg);
    if (k !== 5 || ids.some((i) => i >= k)) throw new Error(view + ': ids ' + ids.join(',') + ' for k=' + k);
    assertEq(d.reveal, ['public', 'working', 'room:Private card rooms']);
    assertEq(d.caption, 'Nowhere · surveyed: public, working + Private card rooms');
    checkSvg(d.svg);
  }
  // the target opened on its own is the GM's call: it draws, and the page's scan does not take its own name for a leak
  const t = GP.playerDisplay(RM_ROLL, RM_MAP({ open: ['Luxury penthouse'] }), mapRender);
  if (!namesIn(t.svg).text.includes('luxury penthouse')) throw new Error('the target opened alone is not drawn (refused as a leak?)');
  assertEq(GP.hiddenNames(RM_ROLL, ['public', 'room:Luxury penthouse']).includes('luxury penthouse'), false, 'an opened target is not a hidden name');
  assertEq(GP.hiddenNames(RM_ROLL, ['public']).includes('luxury penthouse'), true, 'positive control: a shut target is');
  assertEq(GP.hiddenNames(RM_ROLL, ['public', 'room:Private card rooms']).includes('private card rooms'), false, 'an opened room is not a hidden name');
  assertEq(GP.hiddenNames(RM_ROLL, ['public', 'room:Private card rooms']).includes('security control room'), true, 'its sibling in the same band is still hidden');
  // a name that is no room of the roll opens nothing (the kit names it in warnings) and leaks nothing
  const ghost = GP.playerDisplay(RM_ROLL, RM_MAP({ open: ['No such room'] }), mapRender);
  assertEq(namesIn(ghost.svg).text, ['showroom', 'cocktail lounge'], 'a stale name opens nothing');
});

await test('(n) a hidden room cannot be reached by the count: 1..k numbering for every combination of band and single room, over 40 rolls of the real generator', async () => {
  const req = createRequire(import.meta.url), LOC = req(path.join(ROOT, 'app', 'gm', 'location.js'));
  const pk = JSON.parse(read(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'location-pack.json')));
  let n = 0;
  const bad = [];
  for (let s = 1; s <= 40; s++) {
    const roll = LOC.generate(pk.body || pk, {}, { seed: s * 104729 });
    const names = [...new Set(roll.rooms.map((r) => r.name))];
    const open = [names[(s * 3) % names.length], names[(s * 5 + 1) % names.length]].filter((x, i, a) => a.indexOf(x) === i);
    for (const reveal of [{ public: true }, { public: true, working: true }]) for (const o of [[open[0]], open]) {
      const map = { layer: 'player', view: ['iso', 'plan', 'rings', 'section'][s % 4], theme: 'rulebook', reveal, open: o }, E = GP.revealEntries(map);
      let d; try { d = GP.playerDisplay(roll, map, mapRender); } catch (e) { bad.push(s + ': ' + e.message); continue; }
      const k = new Set(roll.rooms.filter((r) => GP.roomShown(r, E)).map((r) => r.name)).size, ids = roomIds(d.svg);
      // a room the kit draws without furniture has no data-room: the ids are a subset of 0..k-1, never above
      if (ids.some((i) => i >= roll.rooms.filter((r) => GP.roomShown(r, E)).length)) bad.push(s + ' ' + E.join('|') + ': id above k (' + ids.join(',') + ', k=' + k + ')');
      const text = GP.svgText(d.svg), src = d.svg.toLowerCase();
      for (const r of roll.rooms) if (!GP.roomShown(r, E) && !roll.rooms.some((x) => x.name === r.name && GP.roomShown(x, E)) && !GP.LEVEL_TITLES.includes(r.name.toLowerCase()) && (text.includes(r.name.toLowerCase()) && r.name.length > 5)) bad.push(s + ': the hidden "' + r.name + '" is on the copy');
      if (GP.leaks(d.svg, roll, E).length) bad.push(s + ' ' + E.join('|') + ': leaks');
      if (!o.every((x) => text.includes(x.toLowerCase()))) bad.push(s + ': an opened room is not on the copy');
      void src; n++;
    }
  }
  if (bad.length) throw new Error(bad.length + ' problems: ' + bad.slice(0, 4).join(' ; '));
  if (n < 150) throw new Error('only ' + n + ' copies');
  console.log('     ' + n + ' player copies with single rooms');
});

await test('(n) markers follow the kit\'s rule, keyed on the room\'s NAME: a PC in a room opened alone is drawn; a PC in an unopened sibling is not (a positive control beside each)', async () => {
  const pcs = [{ id: 'pc1', name: 'Cass Fenn' }, { id: 'pc2', name: 'Dov Ketch' }];
  const E = ['public', 'room:Private card rooms'];
  const shown = RM_ROLL.rooms.filter((r) => GP.roomShown(r, E)).map((r) => r.name);
  assertEq(shown, ['Showroom', 'Cocktail lounge', 'Private card rooms'], 'the shown rooms are the band and the opened room');
  const tokens = GP.playerTokens({ crew: { pc1: 'Private card rooms', pc2: 'Luxury penthouse' }, pins: {} }, shown, [], pcs);
  assertEq(tokens.map((t) => t.room), ['Private card rooms'], 'the builder keeps the PC in the opened room and drops the one in a room that is shut');
  const scr = GP.tokenScreen(tokens, RM_ROLL, E, []);
  assertEq(scr.tokens.map((t) => t.room), ['Private card rooms'], 'the screen keeps it');
  // forced past the builder: the screen drops a marker in an unopened sibling of the opened room's band, and keeps the one in the opened room
  const forced = ['Private card rooms', 'Security control room', 'Luxury penthouse'].map((room, i) => ({ room, label: i ? 'Dov Ketch' : 'Cass Fenn', svg: GP.runTokenSvg({ pills: [{ t: i ? 'DK' : 'CF', c: '#111111' }] }) }));
  assertEq(GP.tokenScreen(forced, RM_ROLL, E, []).tokens.map((t) => t.room), ['Private card rooms'], 'only the opened room keeps its marker');
  assertEq(GP.tokenScreen(forced, RM_ROLL, ['public', 'controlled'], []).tokens.map((t) => t.room), ['Private card rooms'], 'positive control: the band does the same');
  assertEq(GP.tokenScreen(forced, RM_ROLL, ['public'], []).tokens, [], 'and with neither, none is kept');
  // the drawn copy
  const mk = (open, tk) => GP.playerDisplay(RM_ROLL, RM_MAP({ open }), mapRender, tk);
  const d = mk(['Private card rooms'], { tokens: tokens, hide: [] });
  if (d.tokens !== 1 || tokCount(d.svg) !== 1 || !GP.svgText(d.svg).includes('cass fenn')) throw new Error('the marker in the opened room is not drawn (' + d.tokens + ', ' + tokCount(d.svg) + ')');
  const f = mk(['Private card rooms'], { tokens: forced, hide: [] });
  if (f.tokens !== 1 || tokCount(f.svg) !== 1 || /dov ketch/i.test(GP.svgText(f.svg))) throw new Error('a marker in a sibling that is not open was drawn');
  const none = mk([], { tokens: forced, hide: [] });
  if (none.tokens !== 0 || tokCount(none.svg) !== 0) throw new Error('with no room open, a marker in a closed band was drawn');
  // a hidden name in an opened room's marker is still refused: the opened room's own name is not a secret, a sibling's is
  const sib = [{ room: 'Private card rooms', label: 'Security control room', svg: GP.runTokenSvg({ pills: [{ t: 'SC', c: '#111111' }] }) }];
  const own = [{ room: 'Private card rooms', label: 'Private card rooms', svg: GP.runTokenSvg({ pills: [{ t: 'PC', c: '#111111' }] }) }];
  if (mk(['Private card rooms'], { tokens: sib, hide: [] }).tokens !== 0) throw new Error('a sibling\'s name on a marker went out');
  if (mk(['Private card rooms'], { tokens: own, hide: [] }).tokens !== 1) throw new Error('the opened room\'s own name is not a secret');
  // the page source: one rule everywhere
  const src = read(path.join(ROOT, 'app', 'gm-page.js'));
  for (const fn of ['hiddenNames', 'tokenHidden', 'tokenScreen', 'playerTokenSet']) {
    const from = src.indexOf('function ' + fn + '('); const body = src.slice(from, src.indexOf('\n  }\n', from)).replace(/\/\*[\s\S]*?\*\//g, '');
    if (!/roomShown\(/.test(body)) throw new Error(fn + ' no longer decides "shown" with roomShown');
    if (/reveal\.indexOf\((r|room)\.band\)/.test(body)) throw new Error(fn + ' still tests a band alone');
  }
});

/* ---------- (o) the players' mission (VV6; design 5.7): the PATCH body holds only what a player may read ----------
   The section 5 fixture marks every GM-ONLY string "GM-ONLY-...". A controller (the real mission-publish.js, the real ball.js, the page's own whole-word
   test) is driven over a sweep of nights; every body it would PATCH is collected. None holds a marker. Positive controls: the fixture holds the markers, the
   bodies hold the player-safe words, and a marker put into a player-safe field is stopped by the screen (and is in the payload when nothing screens it). */
const MBALL = createRequire(import.meta.url)(path.join(ROOT, 'app', 'gm', 'ball.js'));
const MPUB = createRequire(import.meta.url)(path.join(ROOT, 'app', 'gm', 'mission-publish.js'));
const MFX = JSON.parse(read(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'pelican-play-v2.json')));
const MROOMS = MFX.zones.flatMap((z) => z.rooms);
const mplay = (mut) => { const p = JSON.parse(JSON.stringify(MFX)); if (mut) mut(p); return MBALL.checkPlay(p, MROOMS).play; };
const MT = (hhmm) => MBALL.minuteOf(hhmm, '21:00');
const MPCS = [{ id: 'pc_a', name: 'Ana Quill', owner: 'u1' }, { id: 'pc_b', name: 'Bo Tarn', owner: 'u2' }];
const MARKERS = [...new Set(JSON.stringify(MFX).match(/GM-ONLY-[A-Z0-9-]+/g))];
/* run one night through the real controller: returns every body it sent, and what it refused */
async function mnight(play, states, deny) {
  const bodies = [], timers = []; let clock = 0, cur = null;
  const ctl = MPUB.create({
    ball: MBALL, source: () => ({ play, state: cur.state, clocks: cur.clocks || [{ name: 'Fuse', filled: 2, hidden: false }], pcs: MPCS, open: cur.open || MROOMS,
      deny: () => ({ names: (deny && deny.names) || [], secrets: Array.isArray(play.secret) ? play.secret : [] }) }),
    send: async (m) => { bodies.push(JSON.stringify({ mission: m })); return true; }, stored: () => null, namesHit: GP.namesHit,
    toast() {}, delay: (fn, ms) => { const h = { fn, at: clock + ms }; timers.push(h); return h; }, cancel: (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); },
  });
  const refused = [];
  ctl.onPublished((e) => { if (e.refused) refused.push(e.refused); });
  for (const s of states) {
    cur = s; ctl.changed();
    const due = timers.splice(0); clock += 800; due.forEach((t) => t.fn());
    for (let i = 0; i < 8; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
  return { bodies, refused };
}
const msweep = () => {
  const told = [{}, { I1: 'crew' }, { I1: 'crew', I2: ['pc_a'], I3: 'crew', I4: ['pc_b'] }, { I1: ['pc_a'], I2: 'crew', I3: 'crew', I4: 'crew' }];
  const heard = [{}, { A: { pc_a: 90 } }, { A: { pc_a: 90, pc_b: 95 }, B: { pc_a: 100, pc_b: 100 } }];
  const crews = [{ pc_a: { room: 'Showroom', disguise: 'guard' }, pc_b: { room: MROOMS[2], disguise: 'cook' } },
    { pc_a: { room: 'Private card rooms', disguise: 'guest', noticed: true, blown: ['cook'], items: ['key'] }, pc_b: { room: 'Luxury penthouse', disguise: 'guard', busy: MT('23:00') } }];
  const out = []; let n = 0;
  for (const t of told) for (const h of heard) for (const c of crews) for (const tt of [0, 45, 75, 150, 215, 225]) {
    out.push({ state: { v: 2, site: 'The Pelican Rooms', start: 45, t: tt, crew: c, told: t, heard: h, steps: n % 2 ? { A: [true, false] } : {}, ways: n % 3 === 0 ? { B: 'done' } : {}, over: n % 5 === 0 ? { od: { delay: 30 }, iv: { gone: true } } : {} }, clocks: [{ name: 'Fuse', filled: n % 7, hidden: n % 11 === 0 }] });
    n++;
  }
  return out;
};

await test('(o) the section 5 fixture holds the markers in its GM-only fields (positive control: the sweep below would see one)', () => {
  if (MARKERS.length < 30) throw new Error('only ' + MARKERS.length + ' markers in the fixture');
  const play = mplay();
  if (!JSON.stringify(play).includes('GM-ONLY')) throw new Error('the checked play dropped the markers');
  const safe = JSON.stringify(MBALL.missionFor(MBALL.playerView(play, { crew: {}, told: {} }, MROOMS), { crew: {}, told: {} }, 0, MPCS));
  if (safe.includes('GM-ONLY')) throw new Error('control: an empty night already leaks');
});

await test('(o) over 100+ nights (every beat, told, heard, carried, costume, tick, alarm), no body the controller PATCHes holds a GM-ONLY marker; the player-safe words do reach it', async () => {
  const states = msweep(), { bodies, refused } = await mnight(mplay(), states, { names: [] });
  if (states.length < 100) throw new Error('only ' + states.length + ' states');
  if (bodies.length < 50) throw new Error('only ' + bodies.length + ' bodies were sent');
  if (refused.length) throw new Error('the screen refused a clean night: ' + JSON.stringify(refused[0]));
  const all = bodies.join('\n');
  MARKERS.forEach((m) => { if (all.includes(m)) throw new Error('a marker reached the PATCH body: ' + m); });
  ['The Last Hand', 'Going Up', 'The speeches', 'A brass key', 'She never leaves a table while she\'s winning.', 'Late, at the cards', 'The programme: speeches at ten', 'Ana Quill'].forEach((w) => {
    if (!all.includes(w)) throw new Error('positive control: "' + w + '" never reached a body, so the sweep proved nothing about it');
  });
  if (all.includes('Odette Marsh')) throw new Error('the target\'s name went out');
});

await test('(o) a marker put into a player-safe field is stopped by the screen, one marker per field kind, and is in the payload when nothing screens it (the control)', async () => {
  const fields = {
    'an event pub': (p, m) => { p.events[0].pub = 'On now: ' + m; },
    'an intel text': (p, m) => { p.intel[0].text = 'They say ' + m; },
    'a way\'s public name': (p, m) => { p.ways[0].pubName = m; },
    'a lead line': (p, m) => { p.ways[0].lead.line = m + ' is the word'; },
    'a way\'s window': (p, m) => { p.ways[1].window.pub = m; },
    'a zone label': (p, m) => { p.zones[0].label = m; },
    'a disguise label': (p, m) => { p.disguises[0].label = m; },
    'an item label': (p, m) => { p.items[0].label = m; },
    'an alarm line': (p, m) => { p.alarm.pub[2] = m; },
    'the clock label': (p, m) => { p.clock.label = m; },
  };
  const hot = { v: 2, site: 'x', start: 0, t: MT('22:00'), crew: { pc_a: { room: 'Showroom', disguise: 'guest', items: ['key'] }, pc_b: { room: 'Cocktail lounge', disguise: 'guest' } },
    told: { I1: 'crew', I2: 'crew' }, heard: { A: { pc_a: 10, pc_b: 10 }, B: { pc_a: 10 } }, steps: {} };
  const night = [{ state: hot, clocks: [{ name: 'Fuse', filled: 3, hidden: false }] }];
  let ran = 0;
  for (const [what, set] of Object.entries(fields)) {
    const play = mplay((p) => { set(p, 'GM-ONLY-SECRET-1'); });
    /* the control: the engine alone puts it in the mission, so the screen is what stands between */
    const raw = JSON.stringify(MPUB.buildMission(MBALL, { play, state: hot, clocks: night[0].clocks, pcs: MPCS, open: MROOMS }, 1));
    if (!raw.includes('GM-ONLY-SECRET-1')) throw new Error('control: ' + what + ' did not carry the marker to the mission (the test would prove nothing)');
    const r = await mnight(play, night, { names: [] });
    if (r.bodies.join('').includes('GM-ONLY')) throw new Error(what + ': a marker was PATCHed');
    if (r.bodies.length !== 0 || r.refused.length !== 1 || r.refused[0].kind !== 'secret') throw new Error(what + ': not refused as a secret word (' + JSON.stringify(r.refused) + ', ' + r.bodies.length + ' sent)');
    ran++;
  }
  /* and the hidden NPC / clock names (the page's hiddenSecretNames) in a mission string */
  for (const [what, set] of Object.entries({ 'an event pub': fields['an event pub'], 'an intel text': fields['an intel text'], 'a zone label': fields['a zone label'] })) {
    const play = mplay((p) => { set(p, 'Maren Holt'); });
    const r = await mnight(play, night, { names: ['Maren Holt'] });
    if (r.bodies.length || !r.refused.length || r.refused[0].name !== 'Maren Holt') throw new Error(what + ': a hidden NPC\'s name was not stopped');
    const clean = await mnight(mplay((p) => { set(p, 'Maren Holts'); }), night, { names: ['Maren Holt'] });
    if (clean.bodies.length !== 1) throw new Error(what + ': control: a longer word is not the name, so it goes (' + clean.bodies.length + ')');
    ran++;
  }
  if (ran < 13) throw new Error('only ' + ran + ' variants ran');
});

await test('(o) the page\'s mission path reaches the players through one write and the gate: no display push, no cards on the display route, the overlay by showOverlay', () => {
  const mod = read(path.join(ROOT, 'app', 'gm', 'mission-publish.js')).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const bad of [/pushDisplay/, /setDisplay/, /patchAmbient/, /fetch\(/, /innerHTML/, /\.display\(/]) if (bad.test(mod)) throw new Error('mission-publish.js uses ' + bad);
  const src = read(path.join(ROOT, 'app', 'gm-page.js')), from = src.indexOf('the players\' mission (app/gm/mission-publish.js'), to = src.indexOf('the heat / wanted sync: campaign(doc) feeds it');
  if (from < 0 || to < from) throw new Error('the mission block is not where it was');
  const block = src.slice(from, to).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const bad of [/pushDisplay\(/, /setDisplay/, /patchAmbient\(/, /gate\.mark/]) if (bad.test(block)) throw new Error('the mission block uses ' + bad);
  if (!/overlay: function \(o\) \{ return S === me \? showOverlay\(o\)/.test(block)) throw new Error('the overlay no longer goes through showOverlay (the gate)');
  if (!/a\.publishMission\(m\)/.test(block)) throw new Error('the mission no longer goes out through the api\'s publishMission');
  const boot = read(path.join(ROOT, 'app', 'boot.js')), pm = boot.slice(boot.indexOf('publishMission: function'), boot.indexOf('publishMission: function') + 500);
  if (!/campRef\.update\(\{ mission:/.test(pm)) throw new Error('boot.js publishMission is not a campaign update');
  const server = read(path.join(ROOT, 'functions', 'api', 'gm', 'display.js')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  if (/\bcards\b/.test(server)) throw new Error('the display route mentions cards');
});

/* ---------- (o) VV9: what the band and each card may NOT hold, from the fixture's own fields (design 5.7 item 5) ----------
   VV6's tests above prove no GM-ONLY marker reaches a PATCH. These add the other half of the rule: the band holds nothing that is for a phone card,
   and a card holds nothing that only the other PC heard, was told or carries. The lists come from the fixture and the night's state
   (fixtures/gm/mission-secrecy-lib.mjs), never from the mission under test, so they cannot agree with a leak. Asserted on the real PATCH body
   AND on what the server's cleanMission keeps of it. Every rule runs beside a positive control: the string IS delivered to its owner. */
const URLM = await import('node:url');
const SEC = await import(URLM.pathToFileURL(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'mission-secrecy-lib.mjs')).href);
const { cleanMission: SRV_CLEAN } = await import(URLM.pathToFileURL(path.join(ROOT, 'functions', '_lib', 'campaign.js')).href);
const FXN = SEC.loadFixture();
const vv9crews = [
  { pc_a: { room: 'Cocktail lounge', disguise: 'guest' }, pc_b: { room: 'Cocktail lounge', disguise: 'cook' } },
  { pc_a: { room: 'Security control room', disguise: 'guard' }, pc_b: { room: 'Showroom', disguise: 'guest' } },
];
const vv9heard = [{}, { A: { pc_a: 90 } }, { A: { pc_b: 95 } }, { A: { pc_a: 90 }, B: { pc_b: 95 } }, { A: { pc_b: 95 }, B: { pc_a: 100 } }, { A: { pc_a: 90, pc_b: 95 }, B: { pc_a: 100 } }];
const vv9told = [{}, { I1: ['pc_a'], I3: ['pc_b'] }, { I1: ['pc_b'], I2: ['pc_a'], I3: ['pc_a'] }, { I1: 'crew', I2: ['pc_b'], I3: 'crew' }, { I2: 'crew', I4: ['pc_a'] }];
function vv9states() {
  const out = []; let n = 0;
  for (const heard of vv9heard) for (const told of vv9told) for (let it = 0; it < 3; it++) for (const crewBase of vv9crews) for (const tt of [0, 45, 75, 120, 135, 150, 215]) {
    const crew = JSON.parse(JSON.stringify(crewBase));
    if (it === 1) crew.pc_a.items = ['key'];
    if (it === 2) crew.pc_b.items = ['key'];
    out.push({ v: 2, site: 'x', start: 45, t: tt, crew, told, heard, steps: n % 2 ? { A: [true, false], B: [false, false] } : {}, ways: {}, over: {} });
    n++;
  }
  return out;
}
const vv9has = SEC.has;
const vv9check = (m, st, label, tally) => SEC.checkMission(FXN, m, st, label, tally);

await test('(o) VV9 the lists are sound before they are used: the pool is non-empty, disjoint from the band\'s own words, and no marker is in it', () => {
  const pool = SEC.cardPool(FXN), vocab = SEC.bandVocabulary(FXN);
  if (pool.length < 15) throw new Error('only ' + pool.length + ' card-only strings');
  for (const p of pool) for (const v of vocab) if (v.toLowerCase().includes(p.toLowerCase())) throw new Error('"' + p + '" is inside the band\'s own word "' + v + '"');
  for (const m of SEC.markers(FXN)) if (pool.some((p) => p.includes(m))) throw new Error('a marker is in the pool');
  if (SEC.markers(FXN).length < 30) throw new Error('markers');
  for (const must of ['The Last Hand', 'A brass key', 'Late, at the cards', 'Make her lose']) if (!pool.includes(must)) throw new Error('the pool lacks ' + must);
});

await test('(o) VV9 over 1200+ nights: the band holds no card-only string and no later step; a card holds nothing only the other PC heard, was told or carries; each owner\'s own strings are there; on the PATCH body and on what cleanMission keeps', async () => {
  const states = vv9states(), tally = { negBand: 0, negCard: 0, pos: 0, seen: new Set() }, cleanTally = { negBand: 0, negCard: 0, pos: 0, seen: new Set() }, pool = SEC.cardPool(FXN), reached = new Set();
  let bodies = 0;
  for (const st of states) {
    const r = await mnight(mplay(), [{ state: st, clocks: [{ name: 'Fuse', filled: 2, hidden: false }] }], { names: [] });
    if (r.refused.length) throw new Error('the screen refused a clean night: ' + JSON.stringify(r.refused[0]));
    if (r.bodies.length !== 1) throw new Error('expected one body, got ' + r.bodies.length);
    bodies++;
    const m = JSON.parse(r.bodies[0]).mission, label = 'night ' + bodies + ' (t=' + st.t + ')';
    vv9check(m, st, 'PATCH body, ' + label, tally);
    { const cards = JSON.stringify(m.cards); pool.forEach((p) => { if (vv9has(cards, p)) reached.add(p); }); }
    const kept = SRV_CLEAN(JSON.parse(JSON.stringify(m)));
    vv9check(kept, st, 'cleanMission, ' + label, cleanTally);
  }
  if (bodies < 1200) throw new Error('only ' + bodies + ' nights');
  for (const t of [tally, cleanTally]) if (t.negBand < 20000 || t.negCard < 20000 || t.pos < 1500) throw new Error('the sweep checked too little: ' + JSON.stringify({ negBand: t.negBand, negCard: t.negCard, pos: t.pos }));
  /* the pool WAS delivered to cards somewhere in the sweep, so "the band holds none of it" is not a pass because nothing ever carried it */
  const missing = pool.filter((p) => !reached.has(p));
  if (missing.length) throw new Error('never delivered to a card in the sweep: ' + JSON.stringify(missing));
  const delivered = (set, s) => [...set].some((x) => vv9has(x, s));
  for (const must of ['The Last Hand', 'She never leaves a table while she\'s winning.', 'Late, at the cards', 'After midnight, upstairs', 'A brass key', 'The programme: speeches at ten, fireworks at midnight', 'A trapdoor opens between the counting room and the showroom at eleven'])
    if (!delivered(tally.seen, must)) throw new Error('control: "' + must + '" was never expected on a card, so no rule about it ran');
  if (tally.seen.size !== cleanTally.seen.size) throw new Error('cleanMission changed what a card delivers: ' + tally.seen.size + ' vs ' + cleanTally.seen.size);
});

await test('(o) VV9 the screen reaches every string of the mission: for each leaf of two built missions (band, cards and card ids), a hidden name put there is refused at exactly that path', () => {
  /* two nights between them fill every string field: one while a public event is on (the band's Now), one while a guard watches a PC and a route is open */
  const crew = (busy) => ({ pc_a: { room: 'Security control room', disguise: 'guard', items: ['key'], busy: busy }, pc_b: { room: 'Cocktail lounge', disguise: 'cook' } });
  const sts = [65, 135].map((t) => ({ v: 2, site: 'x', start: 45, t: MT('21:00') + t, crew: crew(MT('23:45')), told: { I1: 'crew', I2: ['pc_a'], I3: ['pc_b'] }, heard: { A: { pc_a: 90, pc_b: 95 }, B: { pc_b: 100 } }, steps: { A: [true, false] }, ways: {}, over: {} }));
  const clocks = [{ name: 'Fuse', filled: 3, hidden: false }];
  const shape = (p) => p.filter((x) => typeof x !== 'number').join('.');
  const covered = new Set(), deny = { names: ['Zed Qwerty'], secrets: [] };
  let n = 0;
  for (const st of sts) {
    const built = MPUB.buildMission(MBALL, { play: mplay(), state: st, clocks, pcs: MPCS, open: MROOMS }, 1);
    if (!built) throw new Error('control: the rich night built no mission');
    if (MPUB.screenMission(built, deny, GP.namesHit) !== null) throw new Error('control: the unmodified mission is refused');
    const leaves = [];
    const walkLeaves = (v, p) => {
      if (typeof v === 'string') { if (v) leaves.push({ p: p, id: false }); }
      else if (Array.isArray(v)) v.forEach((x, i) => walkLeaves(x, p.concat(i)));
      else if (v && typeof v === 'object') Object.keys(v).forEach((k) => { if (p.length === 1 && p[0] === 'cards') leaves.push({ p: p.concat(k), id: true }); walkLeaves(v[k], p.concat(k)); });
    };
    walkLeaves(built, []);
    leaves.filter((l) => !l.id).forEach((l) => covered.add(shape(l.p).replace(/^cards\.[^.]+\./, 'card.')));
    for (const l of leaves) {
      const m = JSON.parse(JSON.stringify(built));
      if (l.id) {                                         /* a card id: rename the key */
        m.cards['Zed Qwerty'] = m.cards[l.p[1]]; delete m.cards[l.p[1]];
        const hit = MPUB.screenMission(m, deny, GP.namesHit);
        if (!hit || hit.path !== 'mission.cards.Zed Qwerty') throw new Error('a card id was not screened: ' + JSON.stringify(hit));
        n++; continue;
      }
      let o = m;
      for (let i = 0; i < l.p.length - 1; i++) o = o[l.p[i]];
      o[l.p[l.p.length - 1]] = 'Zed Qwerty';
      const hit = MPUB.screenMission(m, deny, GP.namesHit), at = 'mission.' + l.p.join('.');
      if (!hit || hit.path !== at || hit.kind !== 'name') throw new Error('a hidden name at ' + at + ' was not stopped there: ' + JSON.stringify(hit));
      n++;
    }
  }
  const want = ['hud.time', 'hud.label', 'hud.now.text', 'hud.now.until', 'hud.next.text', 'hud.next.at', 'hud.night.marks.icon', 'hud.night.marks.text', 'hud.alarm.name', 'hud.alarm.text', 'hud.crew.name', 'hud.crew.costume', 'hud.crew.icon', 'hud.crew.room',
    'card.name', 'card.owner', 'card.costume', 'card.icon', 'card.room', 'card.pos', 'card.warn.who', 'card.warn.look', 'card.warn.sees', 'card.zones.controlled', 'card.zones.risky', 'card.items', 'card.leads.name', 'card.leads.line',
    'card.leads.heard', 'card.leads.window', 'card.leads.next', 'card.know', 'card.next.text', 'card.next.at', 'card.paths.text', 'card.paths.until', 'card.busy'];
  for (const w of want) if (!covered.has(w)) throw new Error('control: the rich nights never fill ' + w + ' (filled: ' + [...covered].join(' ') + '), so the screen is not proved over it');
  if (n < 90) throw new Error('only ' + n + ' leaves were tried');
});

await test('(o) VV9 the display route\'s only mission read is mission.seq and mission.hud: no statement can select the cards', () => {
  const lib = read(path.join(ROOT, 'functions', '_lib', 'campaign.js')), from = lib.indexOf('export async function loadMissionPart');
  if (from < 0) throw new Error('loadMissionPart moved');
  const body = lib.slice(from, lib.indexOf('\n}\n', from)).replace(/\/\*[\s\S]*?\*\//g, '');
  const paths = body.match(/\$\.mission[A-Za-z0-9_.]*/g) || [];
  if (!paths.length || paths.some((p) => p !== '$.mission.seq' && p !== '$.mission.hud')) throw new Error('loadMissionPart reads ' + JSON.stringify(paths));
  if (/cards/.test(body)) throw new Error('loadMissionPart mentions cards');
  for (const f of ['ambient.js', 'state.js']) {
    const p = path.join(ROOT, 'functions', 'api', 'gm', f);
    if (fs.existsSync(p) && /mission/.test(read(p).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) throw new Error(f + ' reads the mission');
  }
});

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
