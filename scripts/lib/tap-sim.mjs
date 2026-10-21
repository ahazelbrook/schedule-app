// The table agent over a window of a transcript, through the REAL endpoint (functions/api/gm/assist.js) on an in-memory D1 with a
// virtual clock: one tick per transcript minute. Shared by scripts/gm-assist-replay.mjs (--tap-sim) and scripts/gm-assist-gate.mjs.
// Generic: it holds no table text. The caller supplies the transcript, the seat registry and a `callHook` that makes (or fakes,
// or refuses) each seat call.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callSeat } from '../../functions/_lib/assist/claude.js';

// Lines look like "- **[HH:MM] Name:** text". Anything else (reconnect markers, headings) is skipped.
export const LINE = /^- \*\*\[(\d\d):(\d\d)\] ([^:*]+):\*\* (.*)$/;

export const stamp = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
export const toMin = (hhmm) => { const [h, m] = String(hhmm).replace(/^~/, '').split(':').map(Number); return h * 60 + m; };

/** Transcript text -> Map(minute -> [{ speaker, text }]). */
export function parseMinutes(text) {
  const all = new Map();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = LINE.exec(raw);
    if (!m) continue;
    const t = Number(m[1]) * 60 + Number(m[2]);
    if (!all.has(t)) all.set(t, []);
    all.get(t).push({ speaker: m[3].trim(), text: m[4] });
  }
  return all;
}

/** The "[HH:MM] Name: text" lines of the minutes from..to, joined (the form the seats' turns use). */
export function talkFor(allMinutes, from, to) {
  return [...allMinutes.keys()].filter((t) => t >= from && t <= to).sort((a, b) => a - b)
    .flatMap((t) => allMinutes.get(t).map((l) => `[${stamp(t)}] ${l.speaker}: ${l.text}`)).join('\n');
}

/** Which seat an instruction text belongs to. */
export const seatOf = (registry, ins) => Object.keys(registry).find((k) => ins && ins.startsWith(registry[k].instructions));

/** The stand-in for a call the caller will not make. */
export const SKIPPED = () => ({ json: null, text: '', usage: {}, cost: 0, stop: 'skipped', secs: 0 });

/**
 * Run the Tap. opts:
 *   client       passed through to the handler (the real one, or a mock)
 *   registry     seat registry (SEATS, maybe with --set overrides)
 *   allMinutes   parseMinutes() of the whole transcript (talk before fromT is loaded as lead-in)
 *   fromT, toT   minutes of the window
 *   lead         minutes of talk loaded before fromT (default 20, for the Showrunner)
 *   enabled      Set of seats that really call (others are skipped for free)
 *   cap          the endpoint's own nightly cap in dollars (its budget ladder drops seats as spend nears it)
 *   callHook     async (seat, args, atHHMM, client) -> callSeat-shaped result; called only for enabled seats
 *   shouldStop   () -> '' | reason, checked before every tick
 *   day, offset  the date and UTC offset the lines are stamped with (an AEDT Saturday by default)
 * -> { ticks, shown, stopped (reason or ''), stoppedAt (HH:MM or '') }
 */
export async function runTapSim({ client, registry, allMinutes, fromT, toT, lead = 20, enabled, cap = 20, callHook, shouldStop = () => '', day = '2026-10-17', offset = '+11:00' }) {
  const { memoryExec, asD1 } = await import('./d1.mjs');
  const { cleanLines, addLines } = await import('../../functions/_lib/stt.js');
  const { makeHandler } = await import('../../functions/api/gm/assist.js');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const exec = await memoryExec({ schemaFile: path.join(root, 'schema.sql') });
  const db = asD1(exec);
  const iso = (t, sec) => new Date(`${day}T${stamp(t)}:${String(sec).padStart(2, '0')}${offset}`).toISOString();
  const names = [...new Set([...allMinutes.values()].flat().map((l) => l.speaker))].slice(0, 60);
  const sp = Object.fromEntries(names.map((n, i) => [String(i), n]));
  await db.prepare('INSERT INTO gm_stt (campaign, updated_at, doc) VALUES (?1, ?2, ?3)').bind('c', iso(fromT, 0), JSON.stringify({ want: 'on', session: '2', speakers: sp })).run();
  await db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?1)").bind(JSON.stringify({ file_id: 'file_sim000001' })).run();
  let seq = 0;
  const feed = async (t) => {
    const ls = allMinutes.get(t) || [];
    const batch = ls.map((l, i) => ({ id: 'sim' + (++seq), at: iso(t, Math.min(58, Math.floor(i * 58 / Math.max(1, ls.length)))), session: '2', conn: 'sim', speaker: Math.min(63, names.indexOf(l.speaker)), text: l.text }));
    for (let i = 0; i < batch.length; i += 50) await addLines(db, 'c', cleanLines({ lines: batch.slice(i, i + 50) }));
  };
  const virt = { t: 0, real0: 0, hhmm: '' };
  const call = async (cl, a) => {
    const seat = seatOf(registry, a.instructions);
    if (!enabled.has(seat)) return SKIPPED();
    return callHook(seat, a, virt.hhmm, cl);
  };
  const handler = makeHandler({ clientFor: () => client, now: () => virt.t + (Date.now() - virt.real0), call, seats: registry });
  const env = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sim', ASSIST_CAP_USD: String(cap) };
  for (let t = fromT - lead; t < fromT; t++) await feed(t);
  const ticks = [], shown = [];
  let after = null, lastId = 0, stopped = '', stoppedAt = '';
  for (let t = fromT; t <= toT; t++) {
    const why = shouldStop();
    if (why) { stopped = why; stoppedAt = stamp(t); break; }
    await feed(t);
    virt.t = Date.parse(iso(t, 59)); virt.real0 = Date.now(); virt.hhmm = stamp(t);
    const res = await handler({ request: new Request('https://sim.example.test/api/gm/assist/tick', { method: 'POST', body: JSON.stringify(after === null ? {} : { after }), headers: { 'Content-Type': 'application/json' } }), env, data: { me: { role: 'gm', id: 'gm@example.test' } } });
    const b = JSON.parse(await res.text());
    after = b.last;
    const rows = exec.db.prepare('SELECT id, seat, card FROM gm_assist_log WHERE id > ? ORDER BY id').all(lastId).map((r) => ({ ...r }));
    if (rows.length) lastId = rows[rows.length - 1].id;
    const called = rows.filter((r) => r.seat !== 'editor' && !/"stop":"skipped"/.test(r.card || '')).map((r) => r.seat);
    const card = (b.cards || [])[0] || null;
    if (card) shown.push({ t, seat: card.seat, text: card.text });
    const mrow = rows.find((r) => r.seat === 'mystery');
    ticks.push({ at: stamp(t), flags: b.flags || [], called, card, stall: b.stall || null, mysteryRow: mrow || null, errors: b.errors || [], spend: b.spend && b.spend.tonight });
  }
  return { ticks, shown, stopped, stoppedAt };
}

export { callSeat };
