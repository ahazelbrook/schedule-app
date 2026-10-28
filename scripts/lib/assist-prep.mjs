// Which prep note the assist part carries, and whether a built assist part is fit to push (design 2.5).
//
//   resolvePrep({ vault, assistPrep, config, today }) -> { rel, how, date, skipped } | null
//     how: 'cli' (--assist-prep), 'config' ("prep" in assist-config.json; packs built earlier say 'named', read as 'cli'), 'date' (the gm_prep: true session note with the soonest
//     date on or after today), or 'past' (every dated one is behind us: the newest). Null when there is nothing to pick.
//   prepProblem(src) -> '' when the assist part has prep with Must land entries, else why it must not be pushed.
//
// On 23/10/2026 the assist part was pushed with no prep note named; the only sign was a warning. This is the pick and the refusal.

import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './vault.mjs';

const readText = (f) => fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const truthy = (v) => /^(true|yes|1)$/i.test(String(v == null ? '' : v).trim());   // the same rule as lib/prep-export.mjs

/** "07/11/2026" (DD/MM/YYYY) or "2026-11-07" -> 20261107, or null. Never new Date(string): that reads 07/11 as July. */
export function dateKey(s) {
  const t = String(s == null ? '' : s).trim().replace(/^["']|["']$/g, '');
  let y, m, d, x;
  if ((x = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t))) { d = +x[1]; m = +x[2]; y = +x[3]; }
  else if ((x = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(t))) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return y * 10000 + m * 100 + d;
}

/** Today as a date key, in the local calendar. */
export function todayKey(now = new Date()) { return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate(); }

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  const fm = {};
  if (!m) return fm;
  for (const l of m[1].split('\n')) {
    const k = /^([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(l);
    if (k) fm[k[1]] = k[2].replace(/^(["'])(.*)\1$/, '$2').trim();
  }
  return fm;
}

/** Every gm_prep: true note under Campaigns/<campaign>/Sessions -> [{ rel, key, date }] (key null when the date is missing or unreadable). */
export function prepCandidates(vault) {
  const camps = path.join(vault, ...ROOT.split('/'), 'Campaigns');
  const out = [];
  if (!fs.existsSync(camps)) return out;
  for (const c of fs.readdirSync(camps, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
    const dir = path.join(camps, c, 'Sessions');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name).sort()) {
      let fm;
      try { fm = frontmatter(readText(path.join(dir, f))); } catch (_) { continue; }
      if (!truthy(fm.gm_prep)) continue;
      out.push({ rel: [ROOT, 'Campaigns', c, 'Sessions', f].join('/'), key: dateKey(fm.date), date: fm.date || '' });
    }
  }
  return out;
}

export function resolvePrep({ vault, assistPrep = '', config = {}, today = todayKey() } = {}) {
  const named = assistPrep || (config && config.prep) || '';
  if (named) {
    // a named note's date, when the vault knows it as a prep note: a prep from the config (not the command line) is checked against it at push time
    const known = prepCandidates(vault).find((c) => c.rel === named);
    return { rel: named, how: assistPrep ? 'cli' : 'config', date: known ? known.date : '', skipped: [] };
  }
  const all = prepCandidates(vault);
  const dated = all.filter((c) => c.key !== null), skipped = all.filter((c) => c.key === null).map((c) => c.rel);
  if (!dated.length) return null;
  const by = (a, b) => a.key - b.key || a.rel.localeCompare(b.rel);
  const ahead = dated.filter((c) => c.key >= today).sort(by);
  // tonight's prep: the SOONEST note dated on or after today, else the newest past one
  const pick = ahead.length ? ahead[0] : dated.sort(by)[dated.length - 1];
  return { rel: pick.rel, how: ahead.length ? 'date' : 'past', date: pick.date, skipped, ahead: ahead.length };
}

/**
 * Why an assist part (its `src`) must not be pushed, or ''. It needs a prep note and at least one unlanded Must land entry.
 * A pack built before the stats existed has neither: it is treated as having no prep.
 */
export function prepProblem(src, today = todayKey()) {
  const s = src && typeof src === 'object' ? src : {};
  const fix = 'Name tonight\'s note with --assist-prep <vault path> (or "prep" in gm-private/assist-config.json), give it a "## Must land" list, run npm run gm:pack, then push again. To push without prep on purpose: --allow-no-prep.';
  if (typeof s.prep !== 'string' || !s.prep) {
    return 'the assist part was built with no prep note, so the seats would run without tonight\'s Must land list and secrets (a pack built before 28/10/2026 also reads this way: rebuild it). ' + fix;
  }
  if (!Number.isInteger(s.mustLand) || s.mustLand < 1) {
    return 'the prep note ' + path.basename(s.prep) + ' has no unlanded "Must land" entries' + (s.mustLandLanded ? ' (' + s.mustLandLanded + ' already ticked)' : '') + ', so the never-reveal list holds none of tonight\'s clues. ' + fix;
  }
  // dated before today: a played night's note, not tonight's. Only a prep passed on the command line (--assist-prep: 'cli', or 'named' in packs built earlier) is exempt.
  if (s.prepBy && s.prepBy !== 'cli' && s.prepBy !== 'named' && Number.isInteger(s.prepDate) && s.prepDate < today) {
    const how = s.prepBy === 'config' ? 'named in assist-config.json' : 'picked by date';
    return 'the prep note ' + path.basename(s.prep) + ' was ' + how + ' and is dated before today, so it is not tonight\'s note. ' +
      'Point "prep" in gm-private/assist-config.json at the next session note, remove the key to pick by date, or pass --assist-prep <vault path> on purpose; run npm run gm:pack, then push again. To push anyway: --allow-no-prep.';
  }
  return '';
}
