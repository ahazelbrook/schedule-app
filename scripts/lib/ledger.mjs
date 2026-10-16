// The sync's memory (SYNC.md), in the git-ignored gm-private/:
//   sync-ledger.json   per campaign: what was filed where (block ids), each NPC's last-synced copy of the fields the
//                      two sides share (the base of the three-way merge), and the pack part versions last pushed.
//   sync-log.jsonl     one line per run: counts and ids only, never table text.
// A missing or unreadable ledger is "lost": the NPC merge then reports every difference as a conflict and overwrites
// nothing. An unreadable file is kept beside the new one (never deleted).

import fs from 'node:fs';
import path from 'node:path';

export const LEDGER = 'sync-ledger.json';
export const SYNC_LOG = 'sync-log.jsonl';

export function emptyCampaign() { return { filed: {}, npcs: {}, pack: {}, ticked: {}, sites: {} }; }

/** { data, lost: bool, bad: bool } */
export function loadLedger(dir) {
  const file = path.join(dir, LEDGER);
  if (!fs.existsSync(file)) return { data: { version: 1, campaigns: {} }, lost: true, bad: false };
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!d || typeof d !== 'object' || d.version !== 1 || typeof d.campaigns !== 'object') throw new Error('shape');
    return { data: d, lost: false, bad: false };
  } catch (_) {
    return { data: { version: 1, campaigns: {} }, lost: true, bad: true };
  }
}

export function campaignLedger(ledger, campaign) {
  const c = ledger.data.campaigns[campaign] || (ledger.data.campaigns[campaign] = emptyCampaign());
  c.filed = c.filed || {}; c.npcs = c.npcs || {}; c.pack = c.pack || {}; c.ticked = c.ticked || {}; c.sites = c.sites || {};
  return c;
}

/** Write the ledger: temp + rename. An unreadable old file is moved aside first, not overwritten. */
export function saveLedger(dir, ledger, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, LEDGER);
  if (ledger.bad && fs.existsSync(file)) {
    fs.renameSync(file, path.join(dir, 'sync-ledger.unreadable-' + now.toISOString().replace(/[:.]/g, '-') + '.json'));
    ledger.bad = false;
  }
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(ledger.data, null, 1) + '\n');
  fs.renameSync(tmp, file);
}

/** Append one run to sync-log.jsonl. `entry` must hold counts, ids, note file names and flags only. */
export function appendLog(dir, entry) {
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, SYNC_LOG), JSON.stringify(entry) + '\n');
}
