// /api/gm/transcript (GM.md "Listening"): the lines the table iPad heard. Never part of /api/export.
//   GET ?after=N  -> { lines, last }   the lines with seq > N, oldest first (500 at most); GM only
//   GET ?tail=N   -> { lines, last }   the newest N (50 at most), oldest first; GM only
//   POST { lines } -> { added, last } the iPad's finished lines (50 at most); GM or the table display sign-in.
//                     A line whose id is already stored is skipped, so a resend after a dropped answer is harmless.
//   DELETE ?through=N -> { removed }  forget the lines up to seq N (the PC has filed them); GM only
// line: { id, at (ISO), session, conn, speaker (number or null), kind: line | mark, text }

import { getDb } from '../../_lib/db.js';
import { json, methodNotAllowed, readJsonObject, campaignOf, HttpError } from '../../_lib/http.js';
import { requireListener, cleanLines, addLines, readLines, pruneLines } from '../../_lib/stt.js';
import { pokeLive } from '../../_lib/live.js';

const METHODS = ['GET', 'POST', 'DELETE'];
const int = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 0 ? n : null; };

export async function onRequest({ request, env, data, waitUntil }) {
  const role = requireListener(data, true);
  const method = request.method;
  if (!METHODS.includes(method)) return methodNotAllowed(METHODS);
  if (method !== 'POST' && role !== 'gm') throw new HttpError(403, 'only the GM can read the transcript');
  const db = await getDb(env), campaign = campaignOf(env), q = new URL(request.url).searchParams;
  if (method === 'POST') {
    const raw = await readJsonObject(request, 160 * 1024);
    const out = await addLines(db, campaign, cleanLines(raw));
    // a cued line (C4b): the GM pages' cue lane reads at once. cleanLines drops the `cue` flag (it is not stored), so ask the raw body.
    if (raw.lines.some((l) => l && l.cue === true)) pokeLive({ env, waitUntil }, ['cue']);
    return json(out);
  }
  if (method === 'DELETE') {
    const through = int(q.get('through'));
    if (through === null) throw new HttpError(400, 'through must be a seq');
    return json(await pruneLines(db, campaign, through));
  }
  const tail = q.has('tail') ? int(q.get('tail')) : null, after = q.has('after') ? int(q.get('after')) : 0;
  if ((q.has('tail') && tail === null) || after === null) throw new HttpError(400, 'after and tail must be whole numbers');
  return json(await readLines(db, campaign, { after, tail: tail || 0 }));
}
