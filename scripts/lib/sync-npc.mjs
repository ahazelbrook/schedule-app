// NPC sync (SYNC.md), separate from the session-note pull so that half can ship alone.
//
// Pull (app -> vault)
//   - an NPC made in the app with no card: a new NPCs/<Name>.md in the vault NPC generator's Save format (replayed
//     through app/gm/npc.js from the GM state's npcgen[id] and the local pack when both exist; otherwise the same
//     skeleton with [TODO]s), tagged wiki/needs-review. The name is checked across the whole vault first: a note
//     outside NPCs/ with that name -> "<Name> (NPC).md". Faction dossier line appended as the generator's Save does.
//   - reveals and GM notes -> the card's "## In play": a dated line ^b68-rev-<id>; each new version of the GM notes a
//     collapsed callout ^b68-gmn-<id>-<hash>.
// Push (vault -> D1), field ownership as in design D:
//   name: the vault wins. description: the vault's "At a glance" look line until the NPC is first revealed, then the
//   app's. spec: three-way merge of NPCs/figures/<Name>.json against the ledger's last-synced copy; both changed ->
//   neither written, the app's copy kept in gm-private/sync-conflicts/, a conflict reported. role, faction, revealed,
//   gmNotes: the app's, never pushed. No ledger entry -> every difference is a conflict and nothing is overwritten
//   (--baseline takes the app's current values as the last-synced copy).
// Writes go through the server's own checkNpc / writeNpc (optimistic updated_at check), D1 only with --yes.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import {
  NPCS, FIGURES, FACTIONS, LOG, abs, readNote, toLines, fromLines, headings, insertBlock, blockId, hasBlock, editNote,
  createNote, npcCards, basenames, safeName, facSlug, dmy, bare,
} from './vault.mjs';
import { checkNpc, parseNpc, writeNpc } from '../../functions/_lib/npcs.js';
import { HttpError } from '../../functions/_lib/http.js';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (isObj(v)) return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
class Refusal extends Error {}

export async function readNpcs(db, campaign) {
  const { results } = await db.prepare('SELECT id, created_at, updated_at, deleted, doc FROM npcs WHERE campaign = ?1 AND deleted = 0 ORDER BY id').bind(campaign).all();
  return (results || []).map((r) => ({ id: r.id, row: r, doc: parseNpc(r) })).filter((r) => typeof r.doc.name === 'string' && r.doc.name.trim());
}

// ---------- reading a card ----------
export function cardFields(text) {
  const lines = toLines(text).map(bare);
  let description = null, faction = null;
  const g = lines.findIndex((l) => /^>\s*\[!quote\][-+]?\s*At a glance\s*$/i.test(l.trim()));
  if (g >= 0 && /^>\s?\S/.test(lines[g + 1] || '')) description = lines[g + 1].replace(/^>\s?/, '').trim();
  if (lines[0] === '---') {
    for (let i = 1; i < lines.length && lines[i] !== '---'; i++) {
      const m = /^faction:\s*(.*)$/.exec(lines[i]);
      if (m) faction = m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return { description, faction };
}
function figureSpec(vault, base) {
  const f = abs(vault, FIGURES + '/' + base + '.json');
  if (!fs.existsSync(f)) return { spec: undefined };
  try { const o = JSON.parse(fs.readFileSync(f, 'utf8')); return { spec: isObj(o) && isObj(o.spec) ? o.spec : o }; }
  catch (_) { return { spec: undefined, bad: true }; }
}

// ---------- the card for a new NPC ----------
const yv = (s) => { s = String(s == null ? '' : s); return !s || /^[A-Za-z0-9][\w '.,()&-]*$/.test(s) ? s : JSON.stringify(s); };
const REVIEW = (d) => JSON.stringify('Made in the GM app and filed by the sync on ' + d + '. Check the look line and fill the [TODO]s from the table.');

function withReview(text, today) {
  const lines = toLines(text);
  if (bare(lines[0]) !== '---') return text;
  let end = 1; while (end < lines.length && bare(lines[end]) !== '---') end++;
  const t = lines.findIndex((l, i) => i < end && bare(l) === 'tags:');
  if (t >= 0) {
    let j = t + 1; while (j < end && /^\s+- /.test(bare(lines[j]))) j++;
    if (!lines.slice(t, j).some((l) => bare(l).trim() === '- wiki/needs-review')) { lines.splice(j, 0, '  - wiki/needs-review'); end++; }
  }
  if (!lines.slice(0, end).some((l) => /^review_note:/.test(bare(l)))) lines.splice(end, 0, 'review_note: ' + REVIEW(today));
  return fromLines(lines);
}
function withPortrait(text, fname, vault) {
  if (!fs.existsSync(abs(vault, FIGURES + '/' + fname + '.svg'))) return text;
  const lines = toLines(text), h = lines.findIndex((l) => /^# /.test(bare(l)));
  if (h < 0) return text;
  lines.splice(h + 1, 0, '', '![[' + fname + '.svg|160]]');
  return fromLines(lines);
}

/** The generator-format card from the app's fields alone (no roll on record). */
export function fallbackCard(doc, today) {
  const look = String(doc.description || '').replace(/\s+/g, ' ').trim();
  return [
    '---', 'wiki: entity', 'created: ' + today, 'updated: ' + today, 'quality:', 'district:',
    doc.faction ? 'faction: ' + yv(doc.faction) : 'faction:', 'attitude:', 'played_by:', 'campaign: group',
    'tags:', '  - wiki/games', '  - wiki/blades-in-the-dark', '  - wiki/npc', '  - wiki/needs-review',
    'review_note: ' + REVIEW(today), '---', '',
    '# ' + doc.name.trim() + (doc.alias ? ' "' + doc.alias.replace(/"/g, "'") + '"' : ''), '',
    '*' + (doc.role ? doc.role : '[TODO: profession, rank and faction]') + '*', '',
    '> [!quote] At a glance', '> ' + (look || '[TODO: the look line]'), '', '## Say it out loud', '',
    '*Write these before they speak. Twelve words or fewer each, and the obvious thing, not the clever one.*', '',
    '> ""', '', '> ""', '', '## Levers', '', '- [TODO: leverage, quirk, trouble: not on record in the app]', '',
    "## What they're said to be", '', '- ', '- ', '', '## In play', '',
    '*What they wanted from the crew, what they got, what they owe.*', '', '---', '',
    'Made in the GM app; filed into the vault by the sync (no generator roll on record).', '',
  ].join('\n');
}

/** app/gm/npc.js and the local pack, when both exist: { M, inst } or null with a reason. */
export function loadGenerator(root, packFile) {
  try {
    const file = path.join(root, 'app', 'gm', 'npc.js');
    if (!fs.existsSync(file)) return { why: 'app/gm/npc.js is not in this build' };
    if (!packFile || !fs.existsSync(packFile)) return { why: 'no local pack (npm run gm:pack)' };
    const M = createRequire(import.meta.url)(file);
    const pk = JSON.parse(fs.readFileSync(packFile, 'utf8'));
    const parts = (pk && pk.parts) || {};
    if (!isObj(parts.npc)) return { why: 'the pack has no npc part' };
    const inst = M.create({ T: parts.npc.T, cast: parts.npc.cast, F: parts.npc.F, campaign: parts.campaign || {} });
    return { M, inst };
  } catch (e) { return { why: 'npc.js would not load (' + String(e && e.message || e).slice(0, 80) + ')' }; }
}
function replay(gen, rec, doc, today) {
  if (!gen || !gen.inst || !isObj(rec)) return null;
  let mem = rec.mem;
  if (typeof mem === 'string') { try { mem = JSON.parse(mem); } catch (_) { mem = {}; } }
  const r = gen.inst.roll({ seed: rec.seed, mem: mem || {}, ui: isObj(rec.ui) ? rec.ui : {} });
  const npc = r && r.npc;
  if (!npc || String(npc.name || '').trim() !== doc.name.trim()) return null;
  const nb = gen.inst.noteBody || gen.M.noteBody;
  return { npc, text: nb.call(gen.inst, npc, { date: today }) };
}

// ---------- In play ----------
function inPlay(text, eol, row, ctx, skipNotes) {
  const { ledger, report } = ctx, id = row.id, doc = row.doc, today = dmy(new Date(ctx.now));
  const lines = toLines(text), H = headings(lines);
  if (!H['In play']) throw new Refusal('no ## In play section');
  if (H['In play'].length > 1) throw new Refusal('## In play twice');
  const list = [], callouts = [], what = [];
  if (doc.revealed === true) {
    const bid = blockId('rev-' + id);
    if (hasBlock(text, bid)) report.skip({ kind: 'reveal', id }, 'already in the vault');
    else if (ledger.filed[bid]) report.skip({ kind: 'reveal', id }, 'removed from the card since it was filed');
    else { list.push('- **' + (dmy(doc.firstSeen || ctx.now) || today) + ' (app):** revealed to the table. ^' + bid); what.push({ kind: 'reveal', bid }); }
  }
  const g = String(doc.gmNotes || '').trim();
  if (g) {
    const bid = blockId('gmn-' + id + '-' + sha(g).slice(0, 8));
    if (skipNotes || hasBlock(text, bid)) { if (!skipNotes) report.skip({ kind: 'gmnotes', id }, 'already in the vault'); else what.push({ kind: 'gmnotes', bid, silent: true }); }
    else if (ledger.filed[bid]) report.skip({ kind: 'gmnotes', id }, 'removed from the card since it was filed');
    else {
      const body = g.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).map((l) => (l ? '> ' + l : '>'));
      callouts.push(['> [!note]- ' + (dmy(row.row && row.row.updated_at) || today) + ': GM notes from the app'].concat(body, ['', '^' + bid]));
      what.push({ kind: 'gmnotes', bid });
    }
  }
  if (list.length) insertBlock(lines, headings(lines)['In play'][0], list, { list: true, eol });
  for (const c of callouts) insertBlock(lines, headings(lines)['In play'][0], c, { eol });
  return { text: fromLines(lines), what };
}

// ---------- pull ----------
export async function pullNpcs(ctx, injected) {
  const { vault, rows, ledger, report } = ctx;
  if (!rows) return;
  const today = dmy(new Date(ctx.now));
  const cards = npcCards(vault);
  let names = null, gen;
  const created = [];
  const npcgen = isObj(ctx.doc && ctx.doc.npcgen) ? ctx.doc.npcgen : {};
  const at = new Date(ctx.now).toISOString();

  for (const row of rows) {
    const { id, doc } = row;
    const L = ledger.npcs[id];
    let card = L && L.path ? cards.find((c) => c.rel === L.path) : null;
    if (!card) card = cards.find((c) => c.name.toLowerCase() === doc.name.trim().toLowerCase()) || null;
    if (!card && L && L.path) { report.skip({ kind: 'npc', id }, 'card renamed or removed since the last sync (not recreated)'); continue; }

    if (!card) {
      // a new NPC from the app
      const safe = safeName(doc.name);
      if (!safe) { report.refuse(id, 'the name has no characters a file name can hold', []); continue; }
      names = names || basenames(vault);
      let fname = safe;
      const here = names.get(safe.toLowerCase()) || [];
      if (here.length) fname = safe + ' (NPC)';
      if ((names.get(fname.toLowerCase()) || []).length) { report.refuse(id, 'both names are taken in the vault (with and without " (NPC)")', [], safe); continue; }
      const rel = NPCS + '/' + fname + '.md';
      if (gen === undefined) gen = injected ? { M: injected, inst: injected.create ? injected.create({}) : injected } : loadGenerator(ctx.root, ctx.packFile || path.join(ctx.privateDir, 'b68-gm-pack.json'));
      let r = null, from;
      try { r = replay(gen, npcgen[id], doc, today); } catch (e) { r = null; }
      if (r) from = 'from its generator roll';
      else from = 'from the app fields (' + (gen && gen.why ? gen.why : npcgen[id] ? 'the replay did not match' : 'no roll on record') + ')';
      let text = r ? withReview(r.text, today) : fallbackCard(doc, today);
      text = withPortrait(text, fname, vault);
      let ip;
      try { ip = inPlay(text, '\n', row, ctx, !!r); } catch (e) { if (e instanceof Refusal) { report.refuse(id, 'new card: ' + e.message, [], safe); continue; } throw e; }
      if (!ctx.dryRun) {
        try { createNote(vault, rel, ip.text); }
        catch (e) { if (e.code === 'EXISTS') { report.refuse(id, 'a file appeared with that name mid-run', [], fname); continue; } throw e; }
        ledger.npcs[id] = { path: rel, created: true, base: { name: doc.name, description: doc.description || '', spec: canon(isObj(doc.spec) ? doc.spec : {}) } };
        for (const w of ip.what) ledger.filed[w.bid] = { note: 'npc:' + id, at };
      }
      names.set(fname.toLowerCase(), [rel]);
      report.created.push({ id, rel, fname, from });
      created.push(fname);
      for (const w of ip.what) if (!w.silent) report.file({ kind: w.kind, id, bid: w.bid }, fname, ctx.dryRun);
      if (r && r.npc && r.npc.faction) dossier(ctx, r.npc, fname);
      continue;
    }

    // an existing card: reveals and GM notes
    try {
      let what = [];
      const edit = (note) => { const x = inPlay(note.text, note.eol, row, ctx, false); what = x.what; return x.text; };
      if (ctx.dryRun) { const n = readNote(abs(vault, card.rel)); if (n) edit(n); }
      else {
        editNote(vault, card.rel, edit);
        for (const w of what) ledger.filed[w.bid] = { note: 'npc:' + id, at };
        ledger.npcs[id] = { ...(ledger.npcs[id] || {}), path: card.rel };
      }
      for (const w of what) report.file({ kind: w.kind, id, bid: w.bid }, card.base, ctx.dryRun);
    } catch (e) {
      if (e instanceof Refusal || e.code === 'RACE' || e.code === 'NOT_UTF8') report.refuse(id, e.message, [], card.base);
      else throw e;
    }
  }
  if (created.length && !ctx.dryRun) logCreated(ctx, created, today);
}

function dossier(ctx, npc, fname) {
  const { vault, report } = ctx;
  const rel = FACTIONS + '/' + facSlug(npc.faction) + '.md';
  const note = readNote(abs(vault, rel));
  if (!note) { report.note('no dossier for the new card\'s faction (' + facSlug(npc.faction) + '.md): not created, add it by hand'); return; }
  const H = headings(toLines(note.text)), last = Object.entries(H).flatMap(([k, v]) => v.map((i) => [i, k])).sort((a, b) => a[0] - b[0]).pop();
  if (!last || last[1] !== "Who we've met") { report.note(facSlug(npc.faction) + ".md: \"## Who we've met\" is not its last section; line not added"); return; }
  if (note.text.includes('[[' + fname + ']]')) return;
  const line = '- [[' + fname + ']] — ' + [npc.profession, [npc.rank, npc.faction].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (!ctx.dryRun) editNote(vault, rel, (n) => n.text + (n.text.endsWith('\n') || !n.text ? '' : n.eol) + line + n.eol);
  report.note((ctx.dryRun ? 'would add' : 'added') + ' the new card to ' + facSlug(npc.faction) + '.md');
}

function logCreated(ctx, created, today) {
  const { vault } = ctx;
  if (!readNote(abs(vault, LOG))) { ctx.report.note('Wiki/log.md not found: no log entry written'); return; }
  editNote(vault, LOG, (n) => {
    const e = n.eol, t = n.text;
    const lead = t.endsWith(e + e) ? '' : t.endsWith('\n') ? e : e + e;
    return t + lead + '## [' + today + '] sync | GM app: ' + created.length + ' new NPC card' + (created.length > 1 ? 's' : '') + e +
      '- Created ' + created.map((n) => '[[' + n + ']]').join(', ') + ' from NPCs made in the GM app, tagged `wiki/needs-review`. Filed by `npm run gm:sync`.' + e;
  });
}

// ---------- push ----------
export async function pushNpcs(ctx) {
  const { vault, rows, ledger, report, db, campaign } = ctx;
  if (!rows) return;
  const cards = npcCards(vault);
  const createdNow = new Set(report.created.map((c) => c.id));
  for (const row of rows) {
    const { id, doc } = row;
    if (createdNow.has(id)) continue;
    const L0 = ledger.npcs[id];
    const card = (L0 && L0.path ? cards.find((c) => c.rel === L0.path) : null) || cards.find((c) => c.name.toLowerCase() === doc.name.trim().toLowerCase());
    if (!card) continue;
    const note = readNote(abs(vault, card.rel));
    if (!note) continue;
    const f = cardFields(note.text), fig = figureSpec(vault, card.base);
    if (fig.bad) report.note(card.base + ': figures/' + card.base + '.json is not valid JSON; spec skipped');
    const vaultV = { name: card.name, description: f.description, spec: fig.spec };
    const app = { name: doc.name, description: doc.description || '', spec: isObj(doc.spec) ? doc.spec : {} };
    const L = ledger.npcs[id] = { ...(L0 || {}), path: card.rel };
    const base = L.base = { ...(L.base || {}) };
    if (ctx.baseline) {
      for (const k of ['name', 'description']) if (base[k] === undefined) base[k] = app[k];
      if (base.spec === undefined) base.spec = canon(app.spec);
    }
    if (f.faction !== null && (f.faction || '') !== (doc.faction || '')) report.note(card.base + ': faction differs between card and app (the app owns it; not pushed)');
    const plan = {};

    if (vaultV.name !== app.name) {
      if (base.name === undefined) report.conflict(id, 'name', 'vault and app differ and there is no last-synced copy (--baseline to start from the app)');
      else { plan.name = vaultV.name; if (app.name !== base.name) report.note(card.base + ': renamed in the app too; the vault wins'); }
    } else base.name = app.name;

    const revealed = doc.revealed === true || !!doc.firstSeen;
    if (vaultV.description !== null && vaultV.description !== app.description) {
      if (revealed) { /* the app's since the first reveal */ }
      else if (base.description === undefined) report.conflict(id, 'description', 'vault and app differ and there is no last-synced copy');
      else plan.description = vaultV.description;
    } else if (vaultV.description !== null) base.description = app.description;

    if (vaultV.spec !== undefined) {
      const V = canon(vaultV.spec), A = canon(app.spec), B = base.spec;
      if (V === A) base.spec = V;
      else if (B === undefined) report.conflict(id, 'spec', 'vault and app differ and there is no last-synced copy');
      else if (A === B) plan.spec = vaultV.spec;
      else if (V === B) report.note(card.base + ': figure edited in the app only; kept there, the vault file is unchanged');
      else {
        report.conflict(id, 'spec', 'changed in both the vault and the app: neither written; the app copy is in gm-private/sync-conflicts/');
        if (!ctx.dryRun) {
          const dir = path.join(ctx.privateDir, 'sync-conflicts');
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, id + '-spec-app-' + sha(A).slice(0, 8) + '.json'), JSON.stringify(app.spec, null, 1) + '\n');
        }
      }
    }

    const fields = Object.keys(plan);
    if (!fields.length) continue;
    const what = 'NPC ' + card.base + ': ' + fields.join(', ');
    if (ctx.dryRun || !ctx.yes) { report.planned.push({ id, what }); continue; }
    try {
      await writeNpc(db, campaign, id, (cur, now) => {
        if (!cur || cur.deleted) throw new HttpError(409, 'deleted in the app during the sync');
        const d = parseNpc(cur);
        for (const k of fields) if (canon(k === 'spec' ? (isObj(d.spec) ? d.spec : {}) : d[k] || '') !== canon(app[k])) throw new HttpError(409, 'changed in the app during the sync');
        if ('description' in plan && (d.revealed === true || d.firstSeen)) throw new HttpError(409, 'revealed during the sync');
        return { ...checkNpc({ ...d, ...plan }), createdAt: cur.created_at, updatedAt: now };
      });
      for (const k of fields) base[k] = k === 'spec' ? canon(plan.spec) : plan[k];
      report.pushed.push({ id, what });
    } catch (e) {
      if (e instanceof HttpError) report.conflict(id, fields.join(','), e.message + '; run the sync again');
      else throw e;
    }
  }
}
