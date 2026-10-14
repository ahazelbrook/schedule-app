// One run's report (SYNC.md): what was filed, skipped and why, refused, conflicts, pages created, what went to D1.
// It holds kinds, ids, note file names and reasons. Entry text never enters it, so neither the printout nor
// gm-private/sync-log.jsonl can carry table text. NPC names appear only in `created` / NPC lines on screen
// (the card's file name), never in the log, which uses NPC ids.

const KIND = { capture: 'lines', pin: 'pins', owed: 'bargains', paid: 'bargains', used: 'callbacks', reveal: 'reveals', gmnotes: 'GM notes' };

export function newReport() {
  const r = {
    filed: [], skipped: [], refused: [], conflicts: [], created: [], pushed: [], planned: [], info: [], errors: [], chunks: 0,
    file(it, note, dry) { r.filed.push({ kind: it.kind, id: it.id, bid: it.bid, note, bucket: it.bucket, dry: !!dry }); },
    skip(it, why) { r.skipped.push({ kind: it.kind, id: it.id, why }); },
    refuse(target, why, list) { r.refused.push({ target, why, ids: (list || []).map((i) => i.id) }); },
    conflict(npcId, field, why) { r.conflicts.push({ npc: npcId, field, why }); },
    note(msg) { r.info.push(msg); },
  };
  return r;
}

const count = (arr, key) => arr.reduce((m, x) => { const k = key(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const fmt = (m) => Object.entries(m).map(([k, v]) => v + ' ' + k).join(', ');
const BUCKET = { n: 'Names', x: 'Loose ends', m: 'Moments', r: 'Rolled' };

/** The printout, as lines. */
export function formatReport(r, o) {
  const out = [];
  const mode = o.mode === 'both' ? 'pull + push' : o.mode;
  out.push('GM sync · campaign ' + o.campaign + ' · ' + mode + (o.dryRun ? ' · DRY RUN (nothing written)' : ''));
  if (r.errors.length) { out.push(''); for (const e of r.errors) out.push('STOPPED: ' + e); }
  if (o.mode !== 'push') {
    out.push('', 'Session notes (app -> vault)');
    const byNote = {};
    for (const f of r.filed.filter((x) => ['capture', 'pin', 'owed', 'paid', 'used'].includes(x.kind))) (byNote[f.note] = byNote[f.note] || []).push(f);
    for (const [note, list] of Object.entries(byNote)) {
      const caps = list.filter((x) => x.kind === 'capture');
      const parts = [];
      if (caps.length) parts.push(caps.length + ' lines (' + fmt(count(caps, (x) => BUCKET[x.bucket] || x.bucket)) + ')');
      const rest = count(list.filter((x) => x.kind !== 'capture'), (x) => KIND[x.kind]);
      if (Object.keys(rest).length) parts.push(fmt(rest));
      out.push('  ' + (o.dryRun ? 'would file into ' : 'filed into ') + note + ': ' + parts.join(', '));
    }
    if (!Object.keys(byNote).length) out.push('  nothing new to file');
    const sk = count(r.skipped.filter((x) => ['capture', 'pin', 'owed', 'paid', 'used'].includes(x.kind)), (x) => x.why);
    if (Object.keys(sk).length) out.push('  skipped: ' + Object.entries(sk).map(([k, v]) => v + ' ' + k).join(' · '));
  }
  const refused = r.refused;
  if (refused.length) {
    out.push('', 'REFUSED (nothing written there)');
    for (const x of refused) out.push('  ' + x.target + ': ' + x.why + (x.ids.length ? ' (' + x.ids.length + ' not filed: ' + x.ids.slice(0, 6).join(', ') + (x.ids.length > 6 ? ', ...' : '') + ')' : ''));
  }
  const npcLines = r.filed.filter((x) => x.kind === 'reveal' || x.kind === 'gmnotes');
  if (r.created.length || npcLines.length) {
    out.push('', 'NPC cards (app -> vault)');
    for (const c of r.created) out.push('  ' + (o.dryRun ? 'would create ' : 'created ') + c.rel + ' (tagged wiki/needs-review)' + (c.from ? ', ' + c.from : ''));
    for (const f of npcLines) out.push('  ' + (o.dryRun ? 'would add ' : 'added ') + KIND[f.kind] + ' to ' + f.note);
  }
  const npcSkips = r.skipped.filter((x) => x.kind === 'npc' || x.kind === 'reveal' || x.kind === 'gmnotes');
  if (npcSkips.length) out.push('  skipped: ' + Object.entries(count(npcSkips, (x) => x.why)).map(([k, v]) => v + ' ' + k).join(' · '));
  if (r.conflicts.length) {
    out.push('', 'CONFLICTS (neither side changed)');
    for (const c of r.conflicts) out.push('  ' + c.npc + ' ' + c.field + ': ' + c.why);
  }
  if (r.pushed.length || r.planned.length) {
    out.push('', 'D1 (vault -> app)');
    for (const p of r.pushed) out.push('  wrote ' + p.what);
    for (const p of r.planned) out.push('  would write ' + p.what);
    if (r.chunks) out.push('  ' + r.chunks + ' staged pieces written');
    if (r.planned.length && !o.dryRun && !o.yes) out.push('  Nothing was written to D1: run again with --yes to write.');
  }
  if (r.info.length) { out.push('', 'Notes'); for (const i of r.info) out.push('  ' + i); }
  return out;
}

/** The sync-log.jsonl line: counts, ids, note file names, flags. */
export function logEntry(r, o) {
  return {
    at: new Date(o.now || Date.now()).toISOString(), mode: o.mode, dryRun: !!o.dryRun, yes: !!o.yes, campaign: o.campaign,
    counts: {
      filed: r.filed.length, skipped: r.skipped.length, refused: r.refused.reduce((n, x) => n + Math.max(1, x.ids.length), 0),
      conflicts: r.conflicts.length, created: r.created.length, pushed: r.pushed.length, planned: r.planned.length, chunks: r.chunks, errors: r.errors.length,
    },
    filed: r.filed.map((f) => f.bid || f.id),
    notes: [...new Set(r.filed.filter((f) => /^b68g-s/.test(f.note || '')).map((f) => f.note))],
    refused: r.refused.map((x) => ({ target: /^b68g-s[0-9.]+(\.md)?$/.test(x.target) ? x.target : 'npc', why: x.why.replace(/[^\x20-\x7e]/g, '').slice(0, 80), ids: x.ids })),
    conflicts: r.conflicts.map((c) => ({ npc: c.npc, field: c.field })),
    created: r.created.map((c) => c.id),
    pushed: r.pushed.map((p) => p.id),
  };
}
