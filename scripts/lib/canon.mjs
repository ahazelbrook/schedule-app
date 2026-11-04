// The canon queue's applier (suite ticket A4, switch ai.canon). No model, no network except the existing authenticated NPC write
// (functions/_lib/npcs.js writeNpc through the same wrangler D1 layer gm-sync uses), and that only with --yes.
//
//   applyCanon({ vault, queue, yes, now, root, campaign, exec?, db?, print? }) -> { report, code }
//
// The queue note is READ, never written (the sync's path rule would refuse it anyway). For every TICKED line (x or X):
//   - the target note is found: npc -> Wiki/.../NPCs/<Name>.md (a " (NPC)" suffix is allowed), faction -> .../Factions/<Name>.md,
//     players -> the NPC card of that name, else the faction note. No note, or two notes with the name -> refused, nothing written;
//   - one line is filed under that note's "## Canon" heading: "- DD/MM/YYYY · GM-only|Player-safe · text ^b68-canon-<id>". A line whose
//     block id is already in the note is not added twice, so running the script again changes nothing;
//   - a PLAYER-SAFE npc line is also appended to that NPC's `description` in the app (the cast page reads it), but ONLY when the NPC has
//     been revealed: before that the players cannot see the NPC at all, and the vault owns the description until then (gm-sync would
//     overwrite it). A line held back for that reason is reported as held; run the script again after the reveal.
//   A GM-ONLY line is never part of any push. An unticked line, [-] and [/] write nothing.
// Without --yes nothing is written anywhere: the report is the plan. Nothing here prints the text of a line, only counts and note names.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { asD1, wranglerExec, readWranglerToml } from './d1.mjs';
import { FACTIONS, abs, readNote, toLines, headings, insertBlock, blockId, hasBlock, editNote, npcCards, dmy, bare } from './vault.mjs';
import { readNpcs } from './sync-npc.mjs';
import { checkNpc, parseNpc, writeNpc } from '../../functions/_lib/npcs.js';
import { HttpError } from '../../functions/_lib/http.js';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const Canon = require(path.join(REPO, 'app', 'gm', 'canon.js'));
export const DESC_MAX = 2000;   // functions/_lib/npcs.js TEXT.description

const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();

function factionCards(vault) {
  let names = [];
  try { names = fs.readdirSync(abs(vault, FACTIONS)); } catch (_) { return []; }
  return names.filter((n) => n.toLowerCase().endsWith('.md')).map((n) => ({ base: n.slice(0, -3), name: n.slice(0, -3), rel: FACTIONS + '/' + n }));
}

/** The note a line files on: { card, isNpc } or { error }. */
export function resolveTarget(vault, item, cache) {
  const npcs = cache.npcs || (cache.npcs = npcCards(vault)), facs = cache.facs || (cache.facs = factionCards(vault));
  const find = (cards) => cards.filter((c) => norm(c.name) === norm(item.target) || norm(c.base) === norm(item.target));
  const order = item.kind === 'npc' ? [['npc', npcs]] : item.kind === 'faction' ? [['faction', facs]] : [['npc', npcs], ['faction', facs]];
  for (const [what, cards] of order) {
    const hits = find(cards);
    if (hits.length > 1) return { error: 'two ' + what + ' notes are called "' + item.target + '"' };
    if (hits.length === 1) return { card: hits[0], isNpc: what === 'npc' };
  }
  return { error: 'no ' + (item.kind === 'players' ? 'NPC or faction' : item.kind) + ' note called "' + item.target + '"' };
}

export const canonLine = (item, today) => '- ' + today + ' · ' + (item.scope === 'player' ? 'Player-safe' : 'GM-only') + ' · ' + item.text + ' ^' + blockId('canon-' + item.id);

/** Add the lines under "## Canon" (made at the end of the note when missing). Lines whose block id is already there are skipped. -> new text or null. */
export function addCanonLines(note, entries) {
  const todo = entries.filter((e) => !hasBlock(note.text, blockId('canon-' + e.id)));
  if (!todo.length) return null;
  const lines = toLines(note.text), cr = note.eol === '\r\n' ? '\r' : '';
  let h = headings(lines).Canon;
  if (!h) {
    while (lines.length && bare(lines[lines.length - 1]).trim() === '') lines.pop();
    lines.push(cr, '## Canon' + cr, cr);
    h = headings(lines).Canon;
  }
  insertBlock(lines, h[0], todo.map((e) => e.line), { list: true, eol: note.eol });
  let t = lines.join('\n');
  if (!t.endsWith('\n')) t += note.eol;
  return t;
}

export async function applyCanon(opts) {
  const print = opts.print || ((s) => process.stdout.write(s + '\n'));
  const root = opts.root || REPO;
  const report = { ticked: 0, unticked: 0, filed: [], already: [], held: [], pushed: [], planned: [], refused: [], warnings: [], notes: [] };
  const done = (code) => { for (const l of format(report, opts)) print(l); return { report, code }; };
  if (!opts.vault || !fs.existsSync(opts.vault)) { report.refused.push('vault not found: pass --vault "<path to the vault>"'); return done(2); }
  if (!opts.queue) { report.refused.push('name the queue note: --queue "<path to the queue note>"'); return done(2); }
  const qfile = path.isAbsolute(opts.queue) ? opts.queue : path.resolve(opts.vault, opts.queue);
  let q; try { q = readNote(qfile); } catch (e) { report.refused.push('could not read the queue note: ' + e.message); return done(2); }
  if (!q) { report.refused.push('no queue note at ' + qfile); return done(2); }

  const parsed = Canon.parseQueue(q.text);
  parsed.warnings.forEach((w) => report.warnings.push('line ' + w.line + ': ' + w.msg));
  const sum = Canon.summary(parsed.items);
  report.ticked = sum.ticked; report.unticked = sum.unticked;
  const today = dmy(new Date(opts.now || Date.now()));
  const cache = {}, byNote = new Map(), casts = [];
  for (const it of parsed.items) {
    if (!it.done) continue;
    const r = resolveTarget(opts.vault, it, cache);
    if (r.error) { report.refused.push('line ' + it.line + ': ' + r.error); continue; }
    const g = byNote.get(r.card.rel) || { card: r.card, entries: [] };
    g.entries.push({ id: it.id, line: canonLine(it, today), item: it });
    byNote.set(r.card.rel, g);
    if (it.scope === 'player' && r.isNpc) casts.push({ item: it, card: r.card });
  }

  // the cast page: player-safe NPC lines only; the app is read first (read-only) so the plan can say what would be held
  let db = null, rows = null;
  if (casts.length && (opts.db || opts.exec || opts.yes)) {
    try {
      const toml = fs.existsSync(path.join(root, 'wrangler.toml')) ? readWranglerToml(root) : { database: 'blades68', campaign: 'default' };
      db = opts.db || asD1(opts.exec || wranglerExec({ root, database: toml.database }));
      opts.campaign = opts.campaign || toml.campaign;
      rows = await readNpcs(db, opts.campaign);
    } catch (e) { report.refused.push('could not read the cast from the app (nothing was written to the app): ' + e.message); casts.length = 0; }
  }

  for (const g of byNote.values()) {
    const fresh = g.entries.filter((e) => { const n = readNote(abs(opts.vault, g.card.rel)); return !(n && hasBlock(n.text, blockId('canon-' + e.id))); });
    g.entries.filter((e) => !fresh.includes(e)).forEach((e) => report.already.push(g.card.base + ' ^' + e.id));
    if (!fresh.length) continue;
    if (!opts.yes) { fresh.forEach((e) => report.planned.push('file on ' + g.card.base + ' (' + (e.item.scope === 'player' ? 'player-safe' : 'GM-only') + ')')); continue; }
    try {
      editNote(opts.vault, g.card.rel, (note) => addCanonLines(note, fresh));
      fresh.forEach((e) => report.filed.push(g.card.base + ' ^' + e.id));
    } catch (e) { report.refused.push(g.card.base + ': ' + e.message); }
  }

  for (const c of casts) {
    if (!rows) { if (!opts.yes) report.planned.push('cast page: check ' + c.card.base + ' in the app and add the line if it is revealed (the plan does not read the app)'); continue; }
    const row = rows.find((r) => norm(r.doc.name) === norm(c.card.name));
    if (!row) { report.held.push(c.card.base + ': no such NPC in the app yet; filed in the vault only'); continue; }
    const revealed = row.doc.revealed === true || !!row.doc.firstSeen;
    if (!revealed) { report.held.push(c.card.base + ': not revealed yet, so nothing goes to the cast page; run this again after the reveal'); continue; }
    const cur = String(row.doc.description || '');
    if (cur.includes(c.item.text)) { report.already.push(c.card.base + ' cast ^' + c.item.id); continue; }
    const next = cur ? cur.replace(/\s+$/, '') + ' ' + c.item.text : c.item.text;
    if (next.length > DESC_MAX) { report.refused.push(c.card.base + ': the description would pass ' + DESC_MAX + ' characters; trim it in the app first'); continue; }
    if (!opts.yes) { report.planned.push('cast page: add a line to ' + c.card.base); continue; }
    try {
      await writeNpc(db, opts.campaign, row.id, (cu, now) => {
        if (!cu || cu.deleted) throw new HttpError(409, 'deleted in the app during the run');
        const d = parseNpc(cu);
        if (!(d.revealed === true || d.firstSeen)) throw new HttpError(409, 'no longer revealed');
        const base = String(d.description || '');
        const text = base.includes(c.item.text) ? base : (base ? base.replace(/\s+$/, '') + ' ' + c.item.text : c.item.text);
        return { ...checkNpc({ ...d, description: text }), createdAt: cu.created_at, updatedAt: now };
      });
      report.pushed.push(c.card.base + ' ^' + c.item.id);
    } catch (e) { report.refused.push(c.card.base + ' (cast page): ' + e.message); }
  }
  return done(report.refused.length ? 1 : 0);
}

export function format(r, opts) {
  const out = [];
  out.push('Canon queue: ' + r.ticked + ' ticked, ' + r.unticked + ' left unticked (nothing written for those)' + (opts && opts.yes ? '' : '. PLAN ONLY: nothing was written (add --yes)'));
  if (r.filed.length) out.push('Filed in the vault: ' + r.filed.length);
  if (r.already.length) out.push('Already filed, skipped: ' + r.already.length);
  if (r.pushed.length) out.push('Added to the cast page: ' + r.pushed.length);
  r.planned.forEach((p) => out.push('  would ' + p));
  r.held.forEach((h) => out.push('  held: ' + h));
  r.warnings.forEach((w) => out.push('  note: ' + w));
  r.refused.forEach((x) => out.push('  REFUSED: ' + x));
  return out;
}
