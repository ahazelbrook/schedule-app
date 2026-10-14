#!/usr/bin/env node
// Parity check (local only): the vault's GM console module (Dataview, view.js) against app/gm/console.js.
//
//   node scripts/gm-parity.mjs [--vault "C:/Vault/Hazel Second Brain"] [--pack gm-private/b68-gm-pack.json] [--n 40]
//
// view.js runs in node:vm with stub dv / app / localStorage / DOM. Each case boots it fresh with a sticky entry
// { fn, seed, mem, ui } preloaded in localStorage, so its boot replays exactly that card; the card's plain lines
// arrive through input.onResult. The port rolls the same { seed, mem, ui } with the pack's console.T and campaign,
// and the two `all` arrays (and the repeat-guard memory after the roll) must match. Campaign pages are fed to
// view.js from the pack's campaign part, so both sides see the same campaign. Prints counts only, never table text.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const C = require(path.join(REPO, 'app', 'gm', 'console.js'));

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const VAULT = arg('--vault', process.env.B68_VAULT || 'C:/Vault/Hazel Second Brain');
const PACK = path.resolve(REPO, arg('--pack', 'gm-private/b68-gm-pack.json'));
const N = Number(arg('--n', 40));
const VIEW = path.join(VAULT, 'Wiki/Games/Blades in the Dark/Tools/views/gm-console/view.js');
if (!fs.existsSync(VIEW) || !fs.existsSync(PACK)) { console.log('SKIP parity: need ' + VIEW + ' and ' + PACK); process.exit(0); }

const src = fs.readFileSync(VIEW, 'utf8').replace(/^\uFEFF/, '');
const pack = JSON.parse(fs.readFileSync(PACK, 'utf8'));
const T = pack.parts.console.T;
const camp = pack.parts.campaign || {};

// --- stub vault pages from the pack's campaign part ---
const ROOT = 'Wiki/Games/Blades in the Dark';
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

async function vaultCard(entry) {
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
}

const con = C.create({ T, campaign: camp });
const pick = (a, r) => a[Math.floor(r() * a.length)];
const rng = C.seedRng(20261017);
const opts = id => (con.controls.find(c => c.id === id).options || []).map(o => o.value);
const threats = ['', '', 'a placeholder threat on the table'];

let cases = 0, same = 0, memSame = 0;
const fails = [];
for (const b of con.buttons) {
  for (let i = 0; i < N; i++) {
    const ui = { pos: pick(opts('pos'), rng), result: pick(opts('result'), rng), scene: pick(opts('scene'), rng),
      district: pick(opts('district'), rng), pc: pick(opts('pc'), rng), npc: pick(opts('npc'), rng), threat: pick(threats, rng) };
    const seed = (rng() * 4294967296) >>> 0;
    // a non-empty starting memory half the time, so the repeat guard is exercised
    const warm = {};
    if (i % 2) con.roll(b.id, ui, { seed: (seed ^ 0x5bd1e995) >>> 0, mem: warm });
    const entry = { fn: b.id, seed, mem: JSON.parse(JSON.stringify(warm)), ui, label: '' };
    const v = await vaultCard(entry);
    const memP = JSON.parse(JSON.stringify(warm));
    const p = con.roll(b.id, ui, { seed, mem: memP });
    cases++;
    // Three lines were reworded on purpose for the app (they told the GM to edit vault files / use the station):
    // compare only their opening words.
    const norm = a => (a || []).map(x => /^(No friends on the sheets|No callbacks on file|Want more[?]:)/.test(x) ? x.slice(0, 11) : x);
    const A = JSON.stringify(norm(v.all)), B = JSON.stringify(norm(p.meta.all));
    if (A !== B && process.env.DBG && fails.length < 2) console.log((v.all||[]).map(x=>x.slice(0,50)), p.meta.all.map(x=>x.slice(0,50)));
    if (A === B) same++; else if (fails.length < 5) fails.push({ button: b.id, seed, ui: Object.keys(ui).filter(k => ui[k]).join(','), firstDiff: (v.all || []).findIndex((x, k) => x !== p.meta.all[k]) });
    // view.js clones MEM into the entry before the roll, so the stored cur.mem is the pre-roll memory; compare
    // the port's post-roll memory against the vault's by replaying once more is not possible from outside, so
    // compare the pre-roll copies instead (they must be identical inputs) and the outputs above.
    if (JSON.stringify(p.replay.mem) === JSON.stringify(v.cur.mem) && JSON.stringify(memP) === JSON.stringify(v.after)) memSame++;
  }
}
console.log(`parity: ${same}/${cases} cards identical (plain lines), ${memSame}/${cases} repeat-guard memories identical (before and after the roll)`);
for (const f of fails) console.log('  DIFF ' + JSON.stringify(f));
process.exit(same === cases ? 0 : 1);
