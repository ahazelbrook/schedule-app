#!/usr/bin/env node
// Copy what the table iPad heard (GM.md "Listening") into the GM's vault, as it comes, so Claude and Blade can read the
// transcript mid-session. Runs on the GM's PC with the GM's own `wrangler login`, like gm-sync.mjs.
//
//   npm run gm:transcript                 one pass: every line not yet in the vault
//   npm run gm:transcript -- --follow     keep going, a pass every 10 s (Ctrl+C stops it)
//   node scripts/gm-transcript.mjs [--follow] [--every <s>] [--session <N>] [--vault <path>] [--dry-run] [--prune]
//
// Where: Sessions/b68g-sNN-transcript.md for the line's session (the session the GM page stamped when listening started;
// else --session, else the highest-numbered session note). The note is created the first time, in the vault
// transcriber's format: frontmatter with `speakers:`, a header callout, `## Transcript`, then lines appended as
//   - **[HH:MM] Name:** text        (Melbourne time; Name from the GM page's "Who is who", else S0, S1...)
//   *[HH:MM] — reconnected*        (Deepgram renumbers speakers after a reconnect)
// A transcript note the vault's own transcriber made (no `source: ipad`) is never written into: the iPad's lines then
// go to b68g-sNN-transcript-ipad.md, so the two never interleave. Append only: nothing in a note is changed but the
// `speakers:` lines of a note this script made. The ledger (gm-private/sync-ledger.json, `transcript`) remembers the
// last line filed. --prune then deletes the filed lines from the server. Nothing here prints the transcript's text.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { asD1, wranglerExec, readWranglerToml } from './lib/d1.mjs';
import { SESSIONS, abs, readNote, createNote, appendNote, editNote, sessionNotes, highestNote, hhmm, dmy } from './lib/vault.mjs';
import { loadLedger, campaignLedger, saveLedger } from './lib/ledger.mjs';
import { readLines, loadStt, pruneLines } from '../functions/_lib/stt.js';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const o = { follow: false, every: 10, dryRun: false, prune: false };
  const need = (i, f) => { if (i >= argv.length || argv[i].startsWith('--')) throw new Error(f + ' needs a value'); return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--follow') o.follow = true;
    else if (a === '--every') { o.every = Number(need(++i, a)); if (!(o.every >= 3)) throw new Error('--every takes seconds, 3 or more'); }
    else if (a === '--session') { o.session = String(need(++i, a)); if (!/^[0-9]+(\.[0-9]+)?$/.test(o.session)) throw new Error('--session takes a session number'); }
    else if (a === '--vault') o.vault = need(++i, a);
    else if (a === '--dry-run' || a === '-n') o.dryRun = true;
    else if (a === '--prune') o.prune = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  return o;
}

const noteName = (s, ipad) => 'b68g-s' + (/^\d+$/.test(s) ? s.padStart(2, '0') : s) + '-transcript' + (ipad ? '-ipad' : '') + '.md';
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
export function speakerName(speakers, sp) { return sp === null || sp === undefined ? '?' : clean(speakers && speakers[String(sp)]) || 'S' + sp; }
export function lineOf(l, speakers) {
  const t = hhmm(l.at) || '--:--';
  if (l.kind === 'mark') return '*[' + t + '] — ' + (clean(l.text) || 'reconnected') + '*';
  return '- **[' + t + '] ' + speakerName(speakers, l.speaker) + ':** ' + clean(l.text);
}
function speakersYaml(speakers) {
  const keys = Object.keys(speakers || {}).filter((k) => clean(speakers[k])).sort((a, b) => a - b);
  return keys.length ? ['speakers:'].concat(keys.map((k) => '  S' + k + ': ' + JSON.stringify(clean(speakers[k])))) : ['speakers: {}'];
}
export function newNote(session, speakers, at) {
  const day = dmy(at) || '';
  return ['---', 'wiki: log', 'created: ' + day, 'updated: ' + day, 'campaign: group', 'session: ' + session, 'date: ' + day, 'status: recording', 'source: ipad']
    .concat(speakersYaml(speakers), ['tags:', '  - wiki/games', '  - wiki/blades-in-the-dark', '  - wiki/b68-group', '  - wiki/b68-transcript', '---', '',
      '# Blades \'68 — Group, session ' + session + ' — live transcript (table iPad)', '',
      'Session log: [[b68g-s' + (/^\d+$/.test(session) ? session.padStart(2, '0') : session) + ']]', '',
      '> [!info] Raw live speech-to-text from the table iPad (Deepgram), copied here every few seconds by `npm run gm:transcript -- --follow`.',
      '> Expect mishearings, especially of invented names. Speaker numbers are Deepgram\'s guesses: names come from the GM page\'s "Who is who" at the time',
      '> a line was copied, and a `— reconnected` line means the numbers may have changed. Append-only: read from the bottom for the current state.', '',
      '## Transcript', '']).join('\n');
}
/** The `speakers:` block of a note this script made, replaced (frontmatter only). null when there is nothing to change. */
export function withSpeakers(text, speakers) {
  const m = /^(---\r?\n[\s\S]*?)(^speakers:.*\r?\n(?:^[ \t]+.*\r?\n)*)([\s\S]*?^---)/m.exec(text);
  if (!m) return null;
  const eol = text.includes('\r\n') ? '\r\n' : '\n', block = speakersYaml(speakers).join(eol) + eol;
  return block === m[2] ? null : text.slice(0, m.index) + m[1] + block + m[3] + text.slice(m.index + m[0].length);
}

/**
 * One pass. ctx: { vault, db, campaign, ledger (campaign part), session, dryRun, prune, now, print }. Returns { filed, notes }.
 */
export async function pass(ctx) {
  const t = ctx.ledger.transcript = ctx.ledger.transcript || { last: 0, speakers: {} };
  const ctl = (await loadStt(ctx.db, ctx.campaign)).doc;
  const speakers = ctl.speakers || {};
  let filed = 0; const notes = new Set();
  for (;;) {
    const { lines } = await readLines(ctx.db, ctx.campaign, { after: t.last });
    if (!lines.length) break;
    const fallback = ctx.session || ctl.session || (() => { const h = highestNote(sessionNotes(ctx.vault)); return h.note ? String(h.note.num) : '0'; })();
    /* runs of consecutive lines for one session, in order; the ledger moves on after each run lands, so a failure
       part-way never copies a run twice */
    const runs = [];
    for (const l of lines) { const s = clean(l.session) || fallback; if (!runs.length || runs[runs.length - 1].s !== s) runs.push({ s, list: [] }); runs[runs.length - 1].list.push(l); }
    for (const { s, list } of runs) {
      let name = noteName(s, false), rel = SESSIONS + '/' + name, note = readNote(abs(ctx.vault, rel));
      if (note && !/^source:\s*ipad\s*$/m.test(note.text.split(/^---\s*$/m)[1] || '')) { name = noteName(s, true); rel = SESSIONS + '/' + name; note = readNote(abs(ctx.vault, rel)); }
      const body = list.map((l) => lineOf(l, speakers));
      if (!ctx.dryRun) {
        if (!note) createNote(ctx.vault, rel, newNote(s, speakers, list[0].at) + body.join('\n') + '\n');
        else appendNote(ctx.vault, rel, body);
        t.last = list[list.length - 1].seq;
        if (note && JSON.stringify(t.speakers) !== JSON.stringify(speakers)) { try { editNote(ctx.vault, rel, (n) => withSpeakers(n.text, speakers)); } catch (_) { /* the next pass tries again */ } }
      }
      filed += list.length; notes.add(name);
    }
    if (ctx.dryRun) break;
  }
  if (!ctx.dryRun) t.speakers = speakers;
  if (ctx.prune && !ctx.dryRun && t.last > 0) await pruneLines(ctx.db, ctx.campaign, t.last);
  return { filed, notes: [...notes] };
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (o.help) { console.log('node scripts/gm-transcript.mjs [--follow] [--every <s>] [--session <N>] [--vault <path>] [--dry-run] [--prune]'); return; }
  if (!o.vault || !fs.existsSync(abs(o.vault, SESSIONS))) { console.error('vault not found (or it has no ' + SESSIONS + '): pass --vault "<path>"'); process.exit(2); }
  const toml = readWranglerToml(REPO), privateDir = path.join(REPO, 'gm-private');
  const db = asD1(wranglerExec({ root: REPO, database: toml.database }));
  const ledger = loadLedger(privateDir), camp = campaignLedger(ledger, toml.campaign);
  const stamp = () => new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Melbourne', hour12: false });
  let stop = false;
  process.on('SIGINT', () => { stop = true; console.log('\nstopping after this pass'); });
  if (o.follow) console.log('Copying the iPad\'s transcript into the vault every ' + o.every + ' s. Ctrl+C stops.');
  do {
    try {
      const r = await pass({ vault: o.vault, db, campaign: toml.campaign, ledger: camp, session: o.session, dryRun: o.dryRun, prune: o.prune });
      if (!o.dryRun) saveLedger(privateDir, ledger);
      if (r.filed || !o.follow) console.log(stamp() + '  ' + (o.dryRun ? 'would copy ' : 'copied ') + r.filed + ' line' + (r.filed === 1 ? '' : 's') + (r.notes.length ? ' into ' + r.notes.join(', ') : ''));
    } catch (e) {
      if (!o.dryRun) { try { saveLedger(privateDir, ledger); } catch (_) {} }   /* what did land is remembered */
      const why = e.kind === 'auth' ? 'not logged in to Cloudflare: run `npx wrangler login`' : e.kind === 'offline' ? 'offline or Cloudflare unreachable' : e.code === 'RACE' ? 'Obsidian was saving the note: next pass' : e.message;
      console.log(stamp() + '  skipped a pass: ' + why);
      if (!o.follow) process.exit(2);
    }
    if (o.follow && !stop) await new Promise((r) => setTimeout(r, o.every * 1000));
  } while (o.follow && !stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
