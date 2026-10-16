// Pack push (SYNC.md), separate from the session-note pull: the local gm-private/b68-gm-pack.json -> D1 gm_pack,
// the same rows the GM page's "Update pack" writes, validated by the server's own cleanPart().
//
// A part whose version (first 12 hex of SHA-256 of its JSON) and src match the server's is skipped. A changed part is
// written in pieces to a staging table (one wrangler command can carry ~28 000 characters on Windows), each piece
// appended in order under a guard on the piece count, then swapped into gm_pack by ONE statement that only runs when
// the staged byte length and piece count are complete. A push that fails part-way leaves the old part in place. The
// stored part is read back and its hash compared with the version, as the server would compute it.
// Parts the server holds that the file lacks are left alone and reported (the sync never deletes).
// The guard (lib/pack-guard.mjs): a part far smaller than the server's, or a prep note the server has that the file lacks
// or has much shorter, is refused and nothing in the pack is written, unless --allow-shrink.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { cleanPart, shortHash, packHeads, LIMITS } from '../../functions/_lib/gm.js';
import { bindSql, literal, charCost, MAX_COMMAND_COST } from './d1.mjs';
import { packLosses } from './pack-guard.mjs';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
export const STAGE_DDL = 'CREATE TABLE IF NOT EXISTS gm_sync_stage (token TEXT NOT NULL, campaign TEXT NOT NULL, part TEXT NOT NULL, ' +
  "n INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, body TEXT NOT NULL DEFAULT '', PRIMARY KEY (token, part))";
const APPEND = 'UPDATE gm_sync_stage SET body = body || ?1, n = n + 1 WHERE token = ?2 AND part = ?3 AND n = ?4';

/** Cut `text` into pieces whose APPEND statement fits one command (never splitting a surrogate pair). */
export function pieces(text, budget) {
  const room = (budget || MAX_COMMAND_COST) - 400;   // the statement around the literal
  const out = [];
  let start = 0;
  while (start < text.length) {
    let cost = 2, i = start;
    while (i < text.length) {
      const c = text[i], k = charCost(c) + (c === "'" ? 1 : 0);
      if (cost + k > room) break;
      cost += k; i++;
    }
    if (i < text.length && i > start && /[\uD800-\uDBFF]/.test(text[i - 1])) i--;
    if (i === start) throw new Error('piece budget too small');
    out.push(text.slice(start, i)); start = i;
  }
  return out.length ? out : [''];
}

function readPack(file) {
  if (!fs.existsSync(file)) return { error: 'no pack at ' + file + ' (npm run gm:pack builds it)' };
  let pk;
  try { pk = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return { error: 'the pack file is not valid JSON' }; }
  if (!isObj(pk) || pk.format !== 1 || !isObj(pk.parts)) return { error: 'not a format-1 GM pack' };
  const names = Object.keys(pk.parts);
  if (names.length > LIMITS.parts) return { error: 'the pack has ' + names.length + ' parts (at most ' + LIMITS.parts + ')' };
  return { parts: names.map((n) => { const p = pk.parts[n] || {}; const body = {}; for (const k of Object.keys(p)) if (k !== 'src') body[k] = p[k]; return { part: n, src: isObj(p.src) ? p.src : {}, body }; }) };
}

export async function pushPack(ctx) {
  const { exec, db, campaign, report, ledger } = ctx;
  const file = ctx.packFile || path.join(ctx.privateDir, 'b68-gm-pack.json');
  const pk = readPack(file);
  if (pk.error) { report.note('pack: ' + pk.error + '; nothing pushed'); return; }
  const heads = await packHeads(db, campaign);
  const byName = new Map(heads.map((h) => [h.part, h]));
  const todo = [];
  for (const raw of pk.parts) {
    let c;
    try { c = cleanPart(raw); } catch (e) { report.refuse('pack:' + raw.part, e.message, []); continue; }
    const version = await shortHash(c.body), h = byName.get(c.part);
    if (h && h.version === version && h.src === c.src) { report.skip({ kind: 'pack', id: c.part }, 'unchanged'); ledger.pack[c.part] = { version }; continue; }
    todo.push({ ...c, version });
  }
  for (const h of heads) if (!pk.parts.some((p) => p.part === h.part)) report.note('pack: the server has a part "' + h.part + '" the file lacks; left in place');
  if (!todo.length) return;
  /* the guard: sizes from the index; the server's prep notes from its body */
  const before = {}, after = {};
  for (const t of todo) {
    const h = byName.get(t.part); if (!h) continue;
    before[t.part] = h.bytes || 0; after[t.part] = t.bytes;
    if (t.part === 'prep') {
      const row = await db.prepare('SELECT body FROM gm_pack WHERE campaign = ?1 AND part = ?2').bind(campaign, 'prep').first();
      try { before.prep = row ? JSON.parse(row.body) : before.prep; after.prep = JSON.parse(t.body); } catch (_) { /* sizes only */ }
    }
  }
  const losses = packLosses(before, after, { missing: false });
  if (losses.length && !ctx.allowShrink) {
    for (const l of losses) report.refuse('pack:' + l.part, l.what + ': nothing in the pack was pushed. Restore the note (Obsidian: Open version history), run npm run gm:pack, push again; or push with --allow-shrink', []);
    return;
  }
  for (const l of losses) report.note('pack: allowed by --allow-shrink: ' + l.what);
  if (ctx.dryRun || !ctx.yes) {
    for (const t of todo) report.planned.push({ id: t.part, what: 'pack part ' + t.part + ' v' + t.version + ' (' + Math.ceil(t.bytes / 1024) + ' KiB, ' + pieces(t.body, ctx.pieceBudget).length + ' pieces)' });
    return;
  }
  await exec.batch(STAGE_DDL + ';' + bindSql('DELETE FROM gm_sync_stage WHERE created_at < ?1', [ctx.now - 86400000]));
  for (const t of todo) {
    const token = crypto.randomBytes(8).toString('hex'), list = pieces(t.body, ctx.pieceBudget), now = Date.now();
    await exec.batch(bindSql('INSERT INTO gm_sync_stage (token, campaign, part, n, created_at, body) VALUES (?1, ?2, ?3, 0, ?4, ?5)', [token, campaign, t.part, now, '']));
    for (let i = 0; i < list.length; i++) {
      const [r] = await exec.batch(bindSql(APPEND, [list[i], token, t.part, i]));
      if (!r || !r.meta || r.meta.changes !== 1) throw new Error('pack part ' + t.part + ': piece ' + (i + 1) + ' was not staged; the old part is still in place');
      report.chunks++;
    }
    const swap = 'INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) ' +
      'SELECT ' + [literal(campaign), literal(t.part), literal(t.version), literal(t.src), literal(now)].join(', ') + ', body FROM gm_sync_stage ' +
      'WHERE token = ' + literal(token) + ' AND part = ' + literal(t.part) + ' AND n = ' + list.length + ' AND length(CAST(body AS BLOB)) = ' + t.bytes + ' ' +
      'ON CONFLICT (campaign, part) DO UPDATE SET version = excluded.version, src = excluded.src, updated_at = excluded.updated_at, body = excluded.body';
    const [s] = await exec.batch(swap);
    if (!s || !s.meta || s.meta.changes !== 1) throw new Error('pack part ' + t.part + ': the staged copy was incomplete, not swapped in; the old part is still in place');
    await exec.batch(bindSql('DELETE FROM gm_sync_stage WHERE token = ?1', [token]));
    const back = await db.prepare('SELECT version, body FROM gm_pack WHERE campaign = ?1 AND part = ?2').bind(campaign, t.part).first();
    let check = null;
    try { check = back ? await shortHash(JSON.stringify(JSON.parse(back.body))) : null; } catch (_) { check = null; }
    if (!back || back.version !== t.version || check !== t.version) throw new Error('pack part ' + t.part + ': read-back does not match v' + t.version);
    ledger.pack[t.part] = { version: t.version };
    report.pushed.push({ id: t.part, what: 'pack part ' + t.part + ' v' + t.version + ' (' + list.length + ' pieces, read back and verified)' });
  }
}
