// A3 (switch ai.batch): the after-the-night pipeline. A recording in gm-private goes to a TRANSCRIBER, an injected function that returns a
// pre-recorded-API-shaped answer ({ results: { utterances: [{ speaker, start, end, transcript }] } }); the answer becomes a speaker-labelled
// transcript note in gm-private/batch. This file has NO network code: the live driver is not built here (see scripts/gm-batch-stt.mjs).
import fs from 'node:fs';
import path from 'node:path';

const MAX_TEXT = 4000;
export function clock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60, p = (n) => String(n).padStart(2, '0');
  return h ? h + ':' + p(m) + ':' + p(r) : p(m) + ':' + p(r);
}
/* answer -> [{ speaker, start, text }]; adjacent utterances of one speaker are joined; junk is skipped; a speaker that is not a whole number is -1 (S?). */
export function utterances(answer) {
  const list = answer && answer.results && Array.isArray(answer.results.utterances) ? answer.results.utterances : [];
  const out = [];
  for (const u of list) {
    if (!u || typeof u !== 'object') continue;
    const text = typeof u.transcript === 'string' ? u.transcript.trim().slice(0, MAX_TEXT) : '';
    if (!text) continue;
    const speaker = Number.isInteger(u.speaker) && u.speaker >= 0 ? u.speaker : -1, start = Number.isFinite(u.start) ? u.start : 0;
    const last = out[out.length - 1];
    if (last && last.speaker === speaker) last.text += ' ' + text; else out.push({ speaker, start, text });
  }
  return out;
}
export function label(speaker, names) {
  const n = names && typeof names === 'object' ? names[speaker] : '';
  return typeof n === 'string' && n.trim() ? n.trim() : speaker >= 0 ? 'S' + speaker : 'S?';
}
export function formatNote(list, { source = '', names = {}, date = '' } = {}) {
  const speakers = [...new Set(list.map((u) => u.speaker))].sort((a, b) => a - b);
  const head = ['---', 'source: batch', 'recording: ' + JSON.stringify(path.basename(String(source)))];
  if (date) head.push('date: ' + date);
  head.push('speakers:', ...speakers.map((s) => '  - ' + label(s, names)), '---', '', '## Transcript', '');
  return head.concat(list.map((u) => '- **[' + clock(u.start) + '] ' + label(u.speaker, names) + ':** ' + u.text)).join('\n') + '\n';
}
/* runBatch({ file, transcriber, outDir, names?, date? }) -> { out, lines, speakers }. The transcriber is required: no default, so nothing live can run by accident. */
export async function runBatch({ file, transcriber, outDir, names, date } = {}) {
  if (typeof transcriber !== 'function') throw new Error('A transcriber is required (none is built in).');
  if (!file || !fs.existsSync(file)) throw new Error('No recording at ' + file);
  if (!outDir) throw new Error('No output folder.');
  const list = utterances(await transcriber(file));
  if (!list.length) throw new Error('The transcriber returned no speech.');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, path.basename(file).replace(/\.[^.]+$/, '') + '.transcript.md');
  fs.writeFileSync(out, formatNote(list, { source: file, names, date }), 'utf8');
  return { out, lines: list.length, speakers: new Set(list.map((u) => u.speaker)).size };
}
