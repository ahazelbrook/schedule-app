#!/usr/bin/env node
// Parity check (local only): the vault's GM tools against their ports in app/gm/. Four modes:
//
//   node scripts/gm-parity.mjs [mode] [--vault <dir>] [--pack <pack.json>] [--seed <uint>] [--app <dir>]
//     --classic      (default) every classic console button x --n cards (default 40): view.js vs console.js roll()
//     --situations   every situation x position x --sn cards (default 20): each SECTION of a composed card
//                    (con.situation().sections[i].replay = { id, seed, mem, ui }) replayed through view.js with that
//                    section's seed, start memory and controls; its plain lines must equal the section's, and the
//                    memory view.js leaves behind must be the next section's start memory (or the card's end memory)
//     --npc          --nn rolls (default 300) of the vault NPC generator page's dataviewjs block vs npc.js: the npc
//                    object, noteBody() and the repeat-guard memory after the roll
//     --scenes       --scn rolls (default 300) of the vault district scene page's dataviewjs block vs scenes.js: the scene
//                    object, the read-aloud lines, the grid and ratings, and the repeat-guard memory after the roll
//                    (the notable repeat-guard is keyed by name on both sides; a copy of the page from before
//                    17/10/2026 keys it by the list, which never fires once the memory is JSON-cloned, and is patched)
//     --all          all four
//   --pack defaults to $B68_PACK, then gm-private/b68-gm-pack.json. --npc and --scenes need a pack with that part
//   (npm run gm:pack builds one). --app points at another app/ directory (a mutated copy, to prove a mode can fail).
//   Exit 0 = every compared case identical; 1 = any mismatch; 2 = a requested mode could not run (vault page, pack or
//   pack part missing). Prints counts, ids, seeds, field names and line indexes only, never table text.
//
// view.js runs in node:vm with stub dv / app / localStorage / DOM. Each case boots it fresh with a sticky entry
// { fn, seed, mem, ui } preloaded in localStorage, so its boot replays exactly that card; the card's plain lines
// arrive through input.onResult. The port rolls the same { seed, mem, ui } with the pack's console.T and campaign,
// and the two `all` arrays (and the repeat-guard memory after the roll) must match. Campaign pages are fed to
// view.js from the pack's campaign part, so both sides see the same campaign. The NPC page reads the real vault
// (cast page, PC sheets, NPC notes) through a stub app.vault, while the port reads the pack's campaign part: a stale
// pack shows up as an NPC mismatch.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes(k);
const VAULT = arg('--vault', process.env.B68_VAULT || 'C:/Vault/Hazel Second Brain');
const PACK = path.resolve(REPO, arg('--pack', process.env.B68_PACK || 'gm-private/b68-gm-pack.json'));
const APP = path.resolve(arg('--app', path.join(REPO, 'app')));
const N = Number(arg('--n', 40)), SN = Number(arg('--sn', 20)), NN = Number(arg('--nn', 300));
const SCN = Number(arg('--scn', 300));
const SEED = Number(arg('--seed', 20261017)) >>> 0;
const ALL = flag('--all');
const ALL_MODES = ['classic', 'situations', 'npc', 'scenes'];
const MODES = ALL ? ALL_MODES : ALL_MODES.filter((m) => flag('--' + m));
if (!MODES.length) MODES.push('classic');

const C = require(path.join(APP, 'gm', 'console.js'));
const ROOT = 'Wiki/Games/Blades in the Dark';
const VIEW = path.join(VAULT, ROOT, 'Tools/views/gm-console/view.js');
const NPC_PAGE = path.join(VAULT, ROOT, 'Tools/blades-68-npc-generator.md');
const clone = (x) => JSON.parse(JSON.stringify(x));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const firstDiff = (a, b) => { a = a || []; b = b || []; for (let k = 0; k < Math.max(a.length, b.length); k++) if (a[k] !== b[k]) return k; return -1; };

const results = [];          // { mode, cases, ok, extra: [[label, n, of]], fails: [...], cannot }
const pack = fs.existsSync(PACK) ? JSON.parse(fs.readFileSync(PACK, 'utf8')) : null;
const cannot = (mode, why) => results.push({ mode, cannot: why });

/* ============================== view.js (the console) in a vm ============================== */
let vaultCard = null, camp = null;
function setupConsole() {
  if (vaultCard) return true;
  if (!fs.existsSync(VIEW)) return 'no vault console module at ' + VIEW;
  if (!pack || !pack.parts || !pack.parts.console) return 'no pack (or no console part) at ' + PACK;
  const src = fs.readFileSync(VIEW, 'utf8').replace(/^\uFEFF/, '');
  camp = pack.parts.campaign || {};
  // --- stub vault pages from the pack's campaign part ---
  const GROUP = ROOT + '/Campaigns/Group';
  const pcPages = (camp.pcs || []).map(p => ({ file: { name: p.name, path: GROUP + '/Characters/' + p.name + '.md' }, character: p.name,
    status: 'active', playbook: p.playbook, insight: p.insight, prowess: p.prowess, resolve: p.resolve,
    wont_breaks: p.wont, vice: p.vice, friends: p.friend, rival: p.rival, bargains: p.extra }));
  const pipe = x => (x && typeof x === 'object') ? (x.src ? x.text + ' | ' + x.src : x.text) : String(x);
  const board = { callbacks: (camp.callbacks || []).map(pipe), cast: (camp.cast || []).map(pipe),
    standing: (camp.standing || []).map(s => s.faction + ' | ' + s.status), bargains_owed: (camp.owed || []).map(pipe) };
  const npcBody = n => [
    n.glance ? '> [!quote] At a glance\n> ' + n.glance : '',
    n.mannerism ? '> - **Mannerism** ' + n.mannerism : '',
    n.say && n.say.length ? '## Say it out loud\n' + n.say.map(s => '> ' + s).join('\n') + '\n## End' : ''
  ].join('\n\n');
  const npcPages = (camp.npcs || []).map(n => ({ file: { name: n.name, path: ROOT + '/NPCs/' + n.name + '.md' }, role: n.role,
    faction: n.faction, district: n.district, played_by: n.playedBy, campaign: 'group', __body: npcBody(n) }));
  const names = camp.names || { first: [], family: [] };
  const genSrc = 'T.nameMasc = ' + JSON.stringify(names.first || []) + ';\nT.family = ' + JSON.stringify(names.family || []) + ';\n';

  function el() {
    const e = { style: {}, value: '', isConnected: true, children: [],
      createEl(tag, o) { const c = el(); if (o && o.attr && o.attr.value != null) c.value = o.attr.value; if (o && o.value != null) c.value = o.value; e.children.push(c); return c; },
      empty() { e.children = []; }, setText() {}, appendChild() {} };
    return e;
  }
  const arr = a => ({ where: f => arr(a.filter(f)), array: () => a.slice() });

  vaultCard = async function (entry) {
    // Boot on a reaction card (it never touches the repeat-guard memory), wait for the NPC pages to load, then
    // press the button through input.api with Math.random stubbed so the new roll's seed is entry.seed.
    const boot = { fn: 'reaction', seed: 1, mem: entry.mem, ui: entry.ui };
    const store = new Map([['b68-sticky:parity', JSON.stringify({ live: entry.ui, cur: boot, hist: [] })]]);
    let last = null;
    const input = { host: 'parity', onResult: r => { last = r; } };
    const dv = {
      current: () => null,
      pages: q => arr(q.includes('/Characters') ? pcPages : q.includes('/NPCs') ? npcPages : []),
      page: () => board,
      io: { load: async p => { const n = npcPages.find(x => x.file.path === p); if (n) return n.__body; if (p.includes('npc-generator')) return genSrc; throw new Error('nf'); } },
      el: () => el(), container: el()
    };
    const ctx = { dv, input, console, localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
      document: { getElementById: () => true, head: el() }, app: {}, Notice: function () {} };
    vm.createContext(ctx);
    vm.runInContext('globalThis.Math = Object.assign(Object.create(Math), { random: () => globalThis.__next })', ctx);
    const wrapped = '(async function (dv, input) {\n' + src + '\n;return loading;\n})(dv, input)';
    const p = vm.runInContext(wrapped, ctx, { filename: 'view.js' });
    await p; await new Promise(r => setTimeout(r, 0));
    ctx.__next = entry.seed / 4294967296;
    last = null;
    input.api[entry.fn]();
    const st = JSON.parse(store.get('b68-sticky:parity'));
    const all = last ? last.all : null;
    // One more press of a button that leaves the memory alone: its entry holds the memory AFTER the roll above.
    input.api.reaction();
    const after = JSON.parse(store.get('b68-sticky:parity')).cur.mem;
    return { all, cur: st.cur, after };
  };
  return true;
}
// Three lines were reworded on purpose for the app (they told the GM to edit vault files / use the station): compare
// only their opening words.
const norm = a => (a || []).map(x => /^(No friends on the sheets|No callbacks on file|Want more[?]:)/.test(x) ? x.slice(0, 11) : x);
const pick = (a, r) => a[Math.floor(r() * a.length)];
const threats = ['', '', 'a placeholder threat on the table'];

/* ============================== --classic ============================== */
async function classic() {
  const ok = setupConsole(); if (ok !== true) return cannot('classic', ok);
  const con = C.create({ T: pack.parts.console.T, campaign: camp });
  const rng = C.seedRng(SEED);
  const opts = id => (con.controls.find(c => c.id === id).options || []).map(o => o.value);
  let cases = 0, okN = 0, memSame = 0;
  const fails = [];
  for (const b of con.buttons) {
    for (let i = 0; i < N; i++) {
      const ui = { pos: pick(opts('pos'), rng), result: pick(opts('result'), rng), scene: pick(opts('scene'), rng),
        district: pick(opts('district'), rng), pc: pick(opts('pc'), rng), npc: pick(opts('npc'), rng), threat: pick(threats, rng) };
      const seed = (rng() * 4294967296) >>> 0;
      const warm = {};       // a non-empty starting memory half the time, so the repeat guard is exercised
      if (i % 2) con.roll(b.id, ui, { seed: (seed ^ 0x5bd1e995) >>> 0, mem: warm });
      const v = await vaultCard({ fn: b.id, seed, mem: clone(warm), ui });
      const memP = clone(warm);
      const p = con.roll(b.id, ui, { seed, mem: memP });
      cases++;
      const A = norm(v.all), B = norm(p.meta.all);
      if (same(A, B)) okN++;
      else fails.push({ button: b.id, seed, ui: Object.keys(ui).filter(k => ui[k]).join(','), line: firstDiff(A, B), vaultLines: (v.all || []).length, portLines: B.length });
      // view.js stores the pre-roll memory in its entry; `after` is its memory after the roll
      if (same(p.replay.mem, v.cur.mem) && same(memP, v.after)) memSame++;
      else if (fails.length < 50) fails.push({ button: b.id, seed, memory: same(p.replay.mem, v.cur.mem) ? 'after the roll' : 'before the roll' });
    }
  }
  results.push({ mode: 'classic', cases, ok: okN, unit: 'cards (plain lines)', extra: [['repeat-guard memories identical', memSame, cases]], fails });
}

/* ============================== --situations ============================== */
async function situations() {
  const ok = setupConsole(); if (ok !== true) return cannot('situations', ok);
  const con = C.create({ T: pack.parts.console.T, campaign: camp });
  if (typeof con.situation !== 'function') return cannot('situations', 'console.js has no situation()');
  const rng = C.seedRng((SEED ^ 0x51a7) >>> 0);
  const opts = id => (con.situationControls.find(c => c.id === id).options || []).map(o => o.value);
  const sits = con.situations(), positions = con.positions.map(p => p.value);
  const friends = opts('npc').filter(v => v.indexOf('friend:') === 0);      // a quarter of the cards: a friend (Contact)
  let cards = 0, cardsOk = 0, sections = 0, secOk = 0, memOk = 0, seedOk = 0, replayOk = 0;
  const byId = {}, HINTED = 'contact (hinted: no vault equivalent, not compared)';
  const fails = [];
  for (const sit of sits) {
    for (const pos of positions) {
      for (let i = 0; i < SN; i++) {
        const ui = { pos, scene: pick(opts('scene'), rng), district: pick(opts('district'), rng), pc: pick(opts('pc'), rng),
          npc: i % 4 === 0 ? '' : i % 4 === 1 && friends.length ? pick(friends, rng) : pick(opts('npc'), rng), threat: pick(threats, rng) };
        const seed = (rng() * 4294967296) >>> 0;
        const mem = {};
        if (i % 2) con.situation(pick(sits, rng).id, ui, { seed: (seed ^ 0x5bd1e995) >>> 0, mem });   // warm memory
        const card = con.situation(sit.id, ui, { seed, mem });
        const endMem = clone(mem);
        cards++;
        // the card redraws exactly from its own replay entry
        if (same(con.replay(clone(card.replay)), card)) replayOk++;
        else fails.push({ situation: sit.id, pos, seed, what: 'card replay differs' });
        // section seeds: the second mulberry32 stream from the card's seed
        const r2 = C.seedRng(seed), stream = [0, 1, 2, 3].map(() => (r2() * 4294967296) >>> 0);
        let cardGood = true;
        for (let k = 0; k < card.sections.length; k++) {
          const s = card.sections[k], rp = s.replay;
          const slot = s.slot == null ? k : s.slot;                                   // compose v2: a section keeps its slot's draw
          sections++; byId[s.id] = (byId[s.id] || 0) + 1;
          if (s.seed === stream[slot] && rp.seed === s.seed && rp.id === s.id) seedOk++;
          else { cardGood = false; fails.push({ situation: sit.id, pos, seed, section: k, id: s.id, what: 'section seed is not stream draw ' + slot }); }
          // A Contact aimed at a chosen friend (ui.contact, compose v2) has no vault equivalent: view.js draws among all
          // that PC's friends, the port makes no such draw. So neither its lines nor its memory are compared (the vault
          // page is not run for it): it counts as passing in both tallies and is listed apart in the note.
          if (rp.ui && rp.ui.contact) { secOk++; memOk++; byId[HINTED] = (byId[HINTED] || 0) + 1; continue; }
          // The section's lines are the classic roll read through annotate(); view.js is compared with the classic roll
          // itself (the section's replay).
          const classic = con.roll(rp.id, clone(rp.ui), { seed: rp.seed, mem: clone(rp.mem) });
          const v = await vaultCard({ fn: rp.id, seed: rp.seed, mem: clone(rp.mem), ui: clone(rp.ui) });
          const A = norm(v.all), B = norm(classic.meta.all);
          if (same(A, B)) secOk++;
          else { cardGood = false; fails.push({ situation: sit.id, pos, seed, section: k, id: s.id, sectionSeed: rp.seed, line: firstDiff(A, B), vaultLines: (v.all || []).length, portLines: B.length }); }
          const next = k + 1 < card.sections.length ? card.sections[k + 1].replay.mem : endMem;
          if (same(v.cur.mem, rp.mem) && same(v.after, next)) memOk++;
          else { cardGood = false; fails.push({ situation: sit.id, pos, seed, section: k, id: s.id, what: 'memory ' + (same(v.cur.mem, rp.mem) ? 'after the section is not the next start' : 'before the section') }); }
        }
        if (cardGood) cardsOk++;
      }
    }
  }
  results.push({ mode: 'situations', cases: sections, ok: secOk, unit: 'sections (plain lines)',
    extra: [['cards with every section identical', cardsOk, cards], ['section memories chained', memOk, sections],
            ['section seeds from the card stream', seedOk, sections], ['cards redrawn from replay', replayOk, cards]],
    note: 'sections by roller: ' + Object.keys(byId).sort().map(k => k + ' ' + byId[k]).join(', '), fails });
}

/* ============================== --npc ============================== */
async function npc() {
  if (!fs.existsSync(NPC_PAGE)) return cannot('npc', 'no vault NPC generator page at ' + NPC_PAGE);
  if (!pack || !pack.parts || !pack.parts.npc) return cannot('npc', 'the pack at ' + PACK + ' has no npc part (build one with gm-pack.mjs)');
  const NPC = require(path.join(APP, 'gm', 'npc.js'));
  const text = fs.readFileSync(NPC_PAGE, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const open = text.match(/^```dataviewjs[ \t]*$/m);
  if (!open) return cannot('npc', 'no dataviewjs block on the NPC generator page');
  const start = open.index + open[0].length + 1;
  const block = text.slice(start, text.indexOf('\n```', start));
  const npcPart = pack.parts.npc, campN = pack.parts.campaign || {};
  // the vault files the page reads
  const listMd = d => fs.existsSync(path.join(VAULT, d)) ? fs.readdirSync(path.join(VAULT, d)).filter(f => f.endsWith('.md')).map(f => ({ path: d + '/' + f, basename: f.replace(/\.md$/, '') })) : [];
  const fmOf = p => { const t = fs.readFileSync(path.join(VAULT, p), 'utf8').replace(/\r\n?/g, '\n'); const m = t.match(/^---\n([\s\S]*?)\n---/); const o = {}; if (m) for (const l of m[1].split('\n')) { const k = l.match(/^(faction|played_by):\s*(.*)$/); if (k) o[k[1]] = k[2].replace(/^["']|["']$/g, '').trim() || undefined; } return o; };
  const files = [...listMd(ROOT + '/Campaigns/Group/Characters'), ...listMd(ROOT + '/NPCs')];
  const fmCache = new Map(files.filter(f => f.path.includes('/NPCs/')).map(f => [f, fmOf(f.path)]));
  const castFile = { path: ROOT + '/Tools/blades-68-npc-cast.md' };
  const castText = fs.readFileSync(path.join(VAULT, castFile.path), 'utf8');
  const el = () => ({ style: {}, children: [], createEl() { return el(); }, empty() {}, setText() {}, appendText() {}, setAttr() {}, createDiv() { return el(); } });
  async function vaultRoll(seed, mem) {
    const store = new Map([['b68-sticky:npc', JSON.stringify({ cur: { seed, mem, ui: {} }, hist: [] })]]);
    const dv = { container: el(), el: () => el(), current: () => null };
    const ctx = {
      dv, console, localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
      document: { getElementById: () => true, head: el() }, Notice: function () {}, window: {},
      app: {
        vault: { getAbstractFileByPath: p => p === castFile.path ? castFile : null, cachedRead: async () => castText,
          getMarkdownFiles: () => files, create: async () => ({}), append: async () => {}, createFolder: async () => {} },
        metadataCache: { getFileCache: f => ({ frontmatter: fmCache.get(f) || {} }) }, workspace: { getLeaf: () => ({ openFile() {} }) }
      }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    const wrapped = '(async function (dv, app, localStorage, document, window, Notice) {\n' + block +
      '\n;return { o: JSON.parse(JSON.stringify(current)), note: noteBody(current), memBefore: JSON.stringify(sticky.cur.mem), memAfter: JSON.stringify(MEM) };\n})(dv, app, localStorage, document, window, Notice)';
    return await vm.runInContext(wrapped, ctx, { filename: 'npc-generator.md' });
  }
  const gen = NPC.create({ T: npcPart.T, cast: npcPart.cast, campaign: campN, F: npcPart.F });
  const rng = C.seedRng((SEED ^ 0x0c0ffee) >>> 0);
  let okN = 0, noteOk = 0, memOk = 0, hulls = 0;
  const fails = [];
  for (let i = 0; i < NN; i++) {
    const seed = (rng() * 4294967296) >>> 0;
    const mem = {};
    if (i % 2) gen.roll({ seed: (seed ^ 0x5bd1e995) >>> 0, mem });          // a warm repeat-guard memory half the time
    const before = clone(mem);
    const v = await vaultRoll(seed, clone(before));
    const p = gen.roll({ seed, mem });
    const po = clone(p.npc);
    if (po.isHull) hulls++;
    if (same(v.o, po)) okN++;
    else fails.push({ i, seed, fields: [...new Set(Object.keys(v.o).concat(Object.keys(po)))].filter(k => !same(v.o[k], po[k])).slice(0, 8).join(',') });
    const dm = v.note.match(/created: (\S+)/);
    const pn = NPC.noteBody(p.npc, { date: dm ? dm[1] : undefined });
    if (v.note === pn) noteOk++;
    else { const a = v.note.split('\n'), b = pn.split('\n'); fails.push({ i, seed, note: 'line ' + firstDiff(a, b), vaultLines: a.length, portLines: b.length }); }
    if (same(JSON.parse(v.memBefore), before) && same(JSON.parse(v.memAfter), mem)) memOk++;
    else fails.push({ i, seed, memory: same(JSON.parse(v.memBefore), before) ? 'after the roll' : 'before the roll' });
  }
  results.push({ mode: 'npc', cases: NN, ok: okN, unit: 'npc objects (every field)',
    extra: [['saved notes identical', noteOk, NN], ['repeat-guard memories identical', memOk, NN]],
    note: hulls + ' Hulls among them' + (npcPart.F ? '' : '; the pack has no figure map (F), which the generator does not read'), fails });
}

/* ============================== the vault's page for the district scenes ============================== */
function pageBlock(file, mode) {
  if (!fs.existsSync(file)) return { cannot: 'no vault page at ' + file };
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const open = text.match(/^```dataviewjs[ \t]*$/m);
  if (!open) return { cannot: 'no dataviewjs block on the ' + mode + ' page' };
  const start = open.index + open[0].length + 1;
  return { block: text.slice(start, text.indexOf('\n```', start)) };
}
// a stub DOM that records every text the page hands to the screen, in order (empty() on any node starts a fresh card)
function recorder() {
  const log = [];
  const el = () => ({ style: {}, value: '', children: [], createEl(tag, o) { if (o && typeof o.text === 'string') log.push(o.text); return el(); },
    empty() { log.length = 0; }, setText() {}, appendText() {}, setAttr() {}, createDiv() { return el(); } });
  return { el, log };
}

/* ============================== --scenes ============================== */
async function scenes() {
  const page = pageBlock(path.join(VAULT, ROOT, 'Tools/blades-68-district-scenes.md'), 'district scenes');
  if (page.cannot) return cannot('scenes', page.cannot);
  if (!pack || !pack.parts || !pack.parts.scenes) return cannot('scenes', 'the pack at ' + PACK + ' has no scenes part (build one with gm-pack.mjs)');
  const SC = require(path.join(APP, 'gm', 'scenes.js'));
  // the notable repeat-guard is keyed by name, in the port and (since 17/10/2026) in the vault page. A copy of the page
  // from before that keys it by the list itself, which never fires after a sticky replay: patch that one call to match.
  const byName = 'fresh("notable-" + d.n, d.notables, x => x[0])', byList = 'fresh("notable-" + d.n, d.notables)';
  let block = page.block;
  if (!block.includes(byName)) {
    if (!block.includes(byList)) return cannot('scenes', 'the notable call in generate() was not found; update the parity script');
    block = block.replace(byList, byName);
  }
  const sc = SC.create({ T: pack.parts.scenes.T });
  async function vaultRoll(seed, mem, sel) {
    const store = new Map([['b68-sticky:district', JSON.stringify({ cur: { seed, mem, ui: { sel } }, hist: [] })]]);
    const { el } = recorder();
    const ctx = { dv: { container: el(), el: () => el() }, console, localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
      document: { getElementById: () => true, head: el() }, window: {} };
    ctx.window = ctx;
    vm.createContext(ctx);
    const wrapped = '(function (dv, localStorage, document, window) {\n' + block +
      '\n;return JSON.parse(JSON.stringify({ o: current, read: readAloud(current), rows: rows(current), ratings: ratings(current), memBefore: sticky.cur.mem, memAfter: MEM }));\n})(dv, localStorage, document, window)';
    return vm.runInContext(wrapped, ctx, { filename: 'district-scenes.md' });
  }
  const names = pack.parts.scenes.T.district.map(d => d.n);
  const rng = C.seedRng((SEED ^ 0x5ce4e5) >>> 0);
  let ok = 0, readOk = 0, rowsOk = 0, memOk = 0;
  const seenDistricts = new Set();
  const fails = [];
  for (let i = 0; i < SCN; i++) {
    const seed = (rng() * 4294967296) >>> 0;
    const sel = i % 3 === 0 ? names[(i / 3) % names.length] : '';          // a third of the cards in a chosen district
    const mem = {};
    if (i % 2) { sc.roll({ sel: '' }, { seed: (seed ^ 0x5bd1e995) >>> 0, mem }); sc.roll({ sel: '' }, { seed: (seed ^ 0x2545f491) >>> 0, mem: mem }); }
    const before = clone(mem);                                              // JSON-cloned, as a sticky replay does
    const v = await vaultRoll(seed, clone(before), sel);
    const p = sc.roll({ sel }, { seed, mem });
    const po = clone(p.scene);
    seenDistricts.add(po.d.n);
    if (same(v.o, po)) ok++; else fails.push({ i, seed, fields: [...new Set(Object.keys(v.o).concat(Object.keys(po)))].filter(k => !same(v.o[k], po[k])).join(',') });
    const lines = p.lines;
    const pRead = [lines[0].md, lines[1].md, lines[2].md];
    if (same(v.read, pRead)) readOk++; else fails.push({ i, seed, readAloud: 'line ' + firstDiff(v.read, pRead) });
    const pRows = lines.find(l => l.id === 'scene').rows.map(r => [r.k, r.md]);
    if (same(v.rows, pRows) && same(v.ratings, p.meta.chips)) rowsOk++; else fails.push({ i, seed, rows: same(v.rows, pRows) ? 'ratings' : 'row ' + firstDiff(v.rows.map(String), pRows.map(String)) });
    if (same(v.memBefore, before) && same(v.memAfter, mem)) memOk++; else fails.push({ i, seed, memory: same(v.memBefore, before) ? 'after the roll' : 'before the roll' });
  }
  results.push({ mode: 'scenes', cases: SCN, ok, unit: 'scene objects (every field)',
    extra: [['read-aloud triples identical', readOk, SCN], ['grids and ratings identical', rowsOk, SCN], ['repeat-guard memories identical', memOk, SCN]],
    note: seenDistricts.size + '/' + names.length + ' districts among them' + (block === page.block ? '' : '; an older vault page, patched to key the notable repeat-guard by name'), fails });
}

/* ============================== run and report ============================== */
for (const m of MODES) await ({ classic, situations, npc, scenes })[m]();
let bad = false, cant = false;
for (const r of results) {
  if (r.cannot) { cant = true; console.log(`${r.mode}: CANNOT RUN (${r.cannot})`); continue; }
  const extrasOk = r.extra.every(([, n, of]) => n === of);
  const pass = r.ok === r.cases && extrasOk && !r.fails.length;
  if (!pass) bad = true;
  console.log(`${r.mode}: ${pass ? 'PASS' : 'FAIL'}  ${r.ok}/${r.cases} ${r.unit} identical` +
    r.extra.map(([l, n, of]) => `, ${n}/${of} ${l}`).join(''));
  if (r.note) console.log('  ' + r.note);
  if (r.fails.length) {
    console.log(`  ${r.fails.length} mismatch(es); first: ` + JSON.stringify(r.fails[0]));
    for (const f of r.fails.slice(1, 4)) console.log('  also: ' + JSON.stringify(f));
  }
}
console.log(bad ? 'parity: FAIL' : cant ? 'parity: INCOMPLETE (a requested mode could not run)' : 'parity: PASS');
process.exit(bad ? 1 : cant ? 2 : 0);
