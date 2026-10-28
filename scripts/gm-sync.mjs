#!/usr/bin/env node
// Two-way sync between the GM page (D1) and Alex's Obsidian vault. Full contract: SYNC.md.
//
//   node scripts/gm-sync.mjs [pull|push|both] [--dry-run] [--yes] [--vault <path>] [--campaign <id>]
//                            [--session <N>] [--baseline] [--only notes|npcs|pack|sites] [--pack <file>] [--private <dir>] [--allow-shrink] [--allow-no-prep]
//
//   pull   app -> vault: capture lines, L rolls, pins, bargains and callbacks into the session note; NPCs made in the
//          app as new NPC cards; reveals and GM notes into a card's "## In play"; the Prep tab's ticks into their task
//          boxes ([ ] -> [x], never back) and its beat times under "## At the table (app)"; the sites saved against score
//          cards as location notes and maps in Locations/, linked from the card's site:. Writes the vault unless --dry-run.
//   push   vault -> D1: NPC name / description / figure spec (field ownership + three-way merge), the GM pack parts
//          (staged in pieces, swapped in with one statement). Writes D1 ONLY with --yes; otherwise a plan. A pack that
//          would lose prep against the server's is refused (lib/pack-guard.mjs) unless --allow-shrink; an assist part with
//          no prep note or no Must land entries is refused (lib/assist-prep.mjs) unless --allow-no-prep.
//   both   pull, then push (the default).
//
// Auth: the GM's own `wrangler login` (wrangler d1 execute <db> --remote --json). Not logged in or offline: the run
// stops before it writes anything. Exit: 0 fine, 1 something refused / in conflict, 2 stopped.
//
// The pull of session notes (lib/sync-notes.mjs) is the core. NPCs (lib/sync-npc.mjs) and the pack
// (lib/sync-pack.mjs) and the Prep tab (lib/sync-prep.mjs) and the score sites (lib/sync-sites.mjs) are loaded only if
// present, so the core ships on its own.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { asD1, wranglerExec, readWranglerToml } from './lib/d1.mjs';
import { SESSIONS, abs } from './lib/vault.mjs';
import { loadLedger, campaignLedger, saveLedger, appendLog } from './lib/ledger.mjs';
import { newReport, formatReport, logEntry } from './lib/report.mjs';
import { pullNotes } from './lib/sync-notes.mjs';
import { loadState } from '../functions/_lib/gm.js';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function optional(file) {
  const url = new URL('./lib/' + file, import.meta.url);
  if (!fs.existsSync(fileURLToPath(url))) return null;
  return import(url.href);
}

export function parseArgs(argv) {
  const o = { mode: 'both', dryRun: false, yes: false, baseline: false, only: null, allowShrink: false, allowNoPrep: false };
  const need = (i, f) => { if (i >= argv.length || argv[i].startsWith('--')) throw new Error(f + ' needs a value'); return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'pull' || a === 'push' || a === 'both') o.mode = a;
    else if (a === '--dry-run' || a === '-n') o.dryRun = true;
    else if (a === '--yes') o.yes = true;
    else if (a === '--baseline') o.baseline = true;
    else if (a === '--allow-shrink') o.allowShrink = true;
    else if (a === '--allow-no-prep') o.allowNoPrep = true;
    else if (a === '--vault') o.vault = need(++i, a);
    else if (a === '--campaign') o.campaign = need(++i, a);
    else if (a === '--pack') o.packFile = need(++i, a);
    else if (a === '--private') o.privateDir = need(++i, a);
    else if (a === '--session') { const s = Number(need(++i, a)); if (!(s > 0)) throw new Error('--session needs a session number'); o.session = s; }
    else if (a === '--only') { const v = need(++i, a); if (!['notes', 'npcs', 'pack', 'sites'].includes(v)) throw new Error('--only takes notes, npcs, pack or sites'); o.only = v; }
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  return o;
}

/**
 * One run. opts: parseArgs() output plus, for tests, { exec (the d1 layer), now, print, root, npcModule }.
 * Returns { report, code }.
 */
export async function run(opts) {
  const root = opts.root || REPO;
  const print = opts.print || ((s) => process.stdout.write(s + '\n'));
  const toml = fs.existsSync(path.join(root, 'wrangler.toml')) ? readWranglerToml(root) : { database: 'blades68', campaign: 'default' };
  const campaign = opts.campaign || toml.campaign;
  const privateDir = opts.privateDir || path.join(root, 'gm-private');
  const o = { ...opts, campaign, root, privateDir, now: opts.now || Date.now() };
  const report = newReport();
  const done = (code) => {
    for (const l of formatReport(report, o)) print(l);
    try { appendLog(privateDir, logEntry(report, o)); } catch (e) { print('(could not append the sync log: ' + e.message + ')'); }
    return { report, code };
  };

  if (!o.vault || !fs.existsSync(o.vault) || !fs.existsSync(abs(o.vault, SESSIONS))) {
    report.errors.push('vault not found (or it has no ' + SESSIONS + '): pass --vault "<path to the vault>"');
    return done(2);
  }
  const exec = opts.exec || wranglerExec({ root, database: toml.database });
  const db = asD1(exec);
  const ledger = loadLedger(privateDir);
  const camp = campaignLedger(ledger, campaign);
  if (ledger.lost) report.note(ledger.bad ? 'the ledger was unreadable: treated as lost (kept beside the new one)' : 'no ledger yet: NPC differences are reported as conflicts and nothing is overwritten (see --baseline)');

  const want = (part) => !o.only || o.only === part;
  const npcMod = want('npcs') ? (opts.npcSync || await optional('sync-npc.mjs')) : null;
  const packMod = want('pack') && o.mode !== 'pull' ? (opts.packSync || await optional('sync-pack.mjs')) : null;
  const prepMod = want('notes') && o.mode !== 'push' ? (opts.prepSync || await optional('sync-prep.mjs')) : null;
  const siteMod = want('sites') && o.mode !== 'push' ? (opts.siteSync || await optional('sync-sites.mjs')) : null;
  if (want('npcs') && !npcMod) report.note('NPC sync is not installed in this build (lib/sync-npc.mjs): skipped');
  if (want('pack') && o.mode !== 'pull' && !packMod) report.note('pack push is not installed in this build (lib/sync-pack.mjs): skipped');

  // Read everything from D1 first: a login or network failure stops the run before anything is written.
  let state = null, rows = null;
  try {
    if (o.mode !== 'push' && want('notes')) state = await loadState(db, campaign);
    if (npcMod) { rows = await npcMod.readNpcs(db, campaign); if (!state) state = await loadState(db, campaign); }
    if (siteMod && !state) state = await loadState(db, campaign);
  } catch (e) {
    report.errors.push((e.kind === 'auth' ? 'not logged in to Cloudflare: run `npx wrangler login`, then try again. ' : e.kind === 'offline' ? 'offline or Cloudflare unreachable. ' : '') + 'Nothing was written. (' + e.message + ')');
    return done(2);
  }

  const ctx = { ...o, exec, db, doc: state ? state.doc : {}, rows, ledger: camp, ledgerLost: ledger.lost, report };
  try {
    if (o.mode !== 'push') {
      if (want('notes')) pullNotes(ctx);
      if (prepMod) prepMod.pullPrep(ctx);
      if (npcMod) await npcMod.pullNpcs(ctx, opts.npcModule);
      if (siteMod) siteMod.pullSites(ctx, opts.siteKit);
    }
    if (o.mode !== 'pull') {
      if (npcMod) await npcMod.pushNpcs(ctx);
      if (packMod) await packMod.pushPack(ctx);
    }
  } catch (e) {
    report.errors.push((e.kind === 'auth' ? 'Cloudflare login lost mid-run. ' : e.kind === 'offline' ? 'connection lost mid-run. ' : '') + e.message + '. What was written before this is recorded in the ledger.');
    if (!o.dryRun) { try { saveLedger(privateDir, ledger, new Date(o.now)); } catch (_) {} }
    return done(2);
  }
  if (!o.dryRun) saveLedger(privateDir, ledger, new Date(o.now));
  return done(report.refused.length || report.conflicts.length ? 1 : 0);
}

const USAGE = [
  'node scripts/gm-sync.mjs [pull|push|both] [--dry-run] [--yes] [--vault <path>] [--campaign <id>]',
  '                         [--session <N>] [--baseline] [--only notes|npcs|pack|sites] [--pack <file>] [--private <dir>] [--allow-shrink] [--allow-no-prep]',
  'pull writes the vault unless --dry-run; push writes D1 only with --yes. See SYNC.md.',
];

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); console.error(USAGE.join('\n')); process.exit(2); }
  if (o.help) { console.log(USAGE.join('\n')); process.exit(0); }
  run(o).then(({ code }) => process.exit(code), (e) => { console.error('gm-sync failed: ' + (e && e.stack || e)); process.exit(2); });
}
