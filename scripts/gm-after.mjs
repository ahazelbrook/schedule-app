#!/usr/bin/env node
// After the game, in one command (GM.md "After the game"). Run on the GM's PC with the GM's own `wrangler login`.
//
//   npm run gm:after                         the plan: what each step would do; writes nothing
//   npm run gm:after -- --yes                do it
//   node scripts/gm-after.mjs [--session <N>] [--yes] [--prune] [--counter <N>] [--vault <path>]
//
//   1. Which session: --session N; else the session note dated for last night (its `date:` is tonight or yesterday,
//      Melbourne); else the highest-numbered b68g-sNN.md. Every step below files into that session.
//   2. The transcript: copy whatever the table iPad heard that is not in the vault yet (gm-transcript.mjs's pass; lines the
//      other PC copied are not copied twice).
//   3. The pull: gm-sync.mjs pull --session N (captures, pins, bargains, Prep ticks and beat times, NPCs made in the app).
//   3b. Claude's notes: the night's shown Ref rule slips and Clerk notes, read from the assist log (gm_assist_log) through the same
//      database access as the rest, appended under "## Claude's notes" in the session note (append only; a line already there,
//      by its ^b68-a<row> id, is not added twice) and marked filed so the GM page can say "saved to history". Vault side only.
//   4. The two transcripts side by side: the laptop's (Obsidian transcriber, b68g-sNN-transcript.md) and the iPad's
//      (-transcript-ipad.md, or the iPad's own note when it is the only one): lines, first and last time, speakers named.
//   5. --prune: delete the copied lines from the server (only lines the vault has; only with --yes).
//   6. The session counter on the table (campaign `session.number`): reported against the vault; --counter N sets it
//      (with --yes), so the next game's captures and transcript carry the right number.
// Exit: 0 fine, 1 something refused (the pull's report says what), 2 stopped (login, network, no vault).
// Nothing here prints the transcript's or the captures' text.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { asD1, wranglerExec, readWranglerToml } from './lib/d1.mjs';
import { SESSIONS, abs, readNote, sessionNotes, highestNote, noteDates, nightOf, dmy, hhmm, toLines, fromLines, headings, insertBlock, blockId, hasBlock, editNote } from './lib/vault.mjs';
import { nightCards, markFiled } from '../functions/_lib/assist/cards.js';
import { loadLedger, campaignLedger, saveLedger } from './lib/ledger.mjs';
import { pass, probe } from './gm-transcript.mjs';
import { run as syncRun } from './gm-sync.mjs';
import { loadCampaignRow, campaignDoc, writeCampaign } from '../functions/_lib/campaign.js';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const o = { yes: false, prune: false };
  const need = (i, f) => { if (i >= argv.length || argv[i].startsWith('--')) throw new Error(f + ' needs a value'); return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes') o.yes = true;
    else if (a === '--prune') o.prune = true;
    else if (a === '--vault') o.vault = need(++i, a);
    else if (a === '--session') { const s = Number(need(++i, a)); if (!(s > 0)) throw new Error('--session needs a session number'); o.session = s; }
    else if (a === '--counter') { const s = Number(need(++i, a)); if (!(Number.isInteger(s) && s >= 0 && s <= 9999)) throw new Error('--counter takes a whole number'); o.counter = s; }
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  if (o.prune && !o.yes) throw new Error('--prune deletes lines from the server: it needs --yes');
  return o;
}

/** Last night's session: { note, why } from --session, the note dated tonight or yesterday, or the highest note. */
export function whichSession(vault, session, now) {
  const notes = sessionNotes(vault);
  if (session != null) { const n = notes.find((x) => x.num === session); return n ? { note: n, why: '--session ' + session } : { error: 'no note for session ' + session + ' in ' + SESSIONS }; }
  const dates = noteDates(vault, notes);
  for (const day of [...new Set([nightOf(now), dmy(new Date(now - 86400000))])]) {
    const hits = notes.filter((n) => dates.get(n.name) === day);
    if (hits.length === 1) return { note: hits[0], why: 'dated ' + day };
    if (hits.length > 1) return { error: 'two session notes are dated ' + day + ': ' + hits.map((h) => h.name).join(', ') + ' (pass --session N)' };
  }
  const h = highestNote(notes);
  return h.note ? { note: h.note, why: 'no note is dated last night: the highest-numbered note' } : { error: h.error };
}

/** A transcript note's shape: { lines, first, last, speakers: [names], unnamed: [S0...] } or null when missing. */
export function transcriptStats(text) {
  if (text == null) return null;
  const times = [], named = new Set(), unnamed = new Set();
  for (const raw of String(text).split('\n')) {
    const m = /^- \*\*\[([0-9:]{5})\] (.*?):\*\* /.exec(raw.replace(/\r$/, ''));
    if (!m) continue;
    times.push(m[1]);
    (/^S\d+$|^\?$/.test(m[2]) ? unnamed : named).add(m[2]);
  }
  return { lines: times.length, first: times[0] || '', last: times[times.length - 1] || '', speakers: [...named].sort(), unnamed: [...unnamed].sort() };
}

export const CLAUDE_NOTES = 'Claude\'s notes';
const one = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/**
 * The night's shown Ref rule slips and Clerk notes (from the assist log, read through the same db as the rest of this script)
 * as session-note lines: "- **22:14** Rule slip: ... (said 22:10; rule and page) ^b68-a<row>". Rows logged under this session, or
 * under none on this session's night. Ledger updates are not here (the GM files those with "Note it"). -> [{ row, bid, line }]
 */
export async function claudeNoteLines(db, campaign, { vault, note, N, now }) {
  const date = noteDates(vault, [note]).get(note.name) || null;
  const { cards } = await nightCards(db, campaign, { since: new Date(now - 4 * 86400000).toISOString(), now, all: true });
  return cards.filter((c) => (c.seat === 'ref' || c.seat === 'clerk') && (c.session ? c.session === String(N) : !!date && nightOf(c.at) === date)).map((c) => {
    const t = hhmm(c.at), d = c.detail, bits = [];
    if (c.seat === 'ref') { if (d && d.said_at) bits.push('said ' + one(d.said_at)); if (d && d.rule) bits.push(one(d.rule)); }
    const bid = blockId('a' + c.row);
    return { row: c.row, seat: c.seat, bid, line: '- ' + (t ? '**' + t + '** ' : '') + (c.seat === 'ref' ? 'Rule slip: ' : 'Clerk: ') + one(c.text) + (bits.length ? ' (' + bits.join('; ') + ')' : '') + ' ^' + bid };
  });
}

/** Append the lines not already in the note under "## Claude's notes" (made at the end when absent). Never touches anything else. */
export function addClaudeNotes(vault, rel, items) {
  return editNote(vault, rel, (note) => {
    const fresh = items.filter((x) => !hasBlock(note.text, x.bid));
    if (!fresh.length) return null;
    const lines = toLines(note.text), at = headings(lines)[CLAUDE_NOTES];
    if (at && at.length > 1) { const e = new Error('heading twice: ## ' + CLAUDE_NOTES); e.code = 'REFUSED'; throw e; }
    if (at) insertBlock(lines, at[0], fresh.map((x) => x.line), { list: true, eol: note.eol });
    else {
      while (lines.length && lines[lines.length - 1].replace(/\r$/, '').trim() === '') lines.pop();
      lines.push(...['', '## ' + CLAUDE_NOTES, '', ...fresh.map((x) => x.line)].map((l) => (note.eol === '\r\n' ? l + '\r' : l)), '');
    }
    return fromLines(lines);
  });
}

/** One run. opts: parseArgs() output plus, for tests, { db, exec, now, print, privateDir, campaign, host }. Returns { code }. */
export async function run(opts) {
  const print = opts.print || ((s) => process.stdout.write(s + '\n'));
  const now = opts.now || Date.now();
  const toml = opts.campaign ? { campaign: opts.campaign } : readWranglerToml(REPO);
  const campaign = opts.campaign || toml.campaign;
  const privateDir = opts.privateDir || path.join(REPO, 'gm-private');
  const say = (h, lines) => { print(''); print(h); for (const l of [].concat(lines || [])) print('  ' + l); };
  if (!opts.vault || !fs.existsSync(abs(opts.vault, SESSIONS))) { print('vault not found (or it has no ' + SESSIONS + '): pass --vault "<path>"'); return { code: 2 }; }
  const exec = opts.exec || wranglerExec({ root: REPO, database: toml.database });
  const db = opts.db || asD1(exec);
  print(opts.yes ? 'After the game: doing it.' : 'After the game: the plan (nothing is written; run again with --yes to do it).');

  // 1. the session
  const w = whichSession(opts.vault, opts.session, now);
  if (w.error) { say('1. Session', ['stopped: ' + w.error]); return { code: 2 }; }
  const N = w.note.num, label = w.note.name.replace(/\.md$/, '');
  say('1. Session ' + N + ' (' + label + ', ' + w.why + ')');

  // 2. the transcript still on the server
  let code = 0;
  try {
    const ledger = loadLedger(privateDir), camp = campaignLedger(ledger, campaign);
    const t = camp.transcript = camp.transcript || { last: 0, speakers: {} };
    const p = await probe(db, campaign);
    const host = opts.host || (await import('node:os')).hostname();
    if (p.copier.host && p.copier.host !== host && p.copier.last > t.last) t.last = p.copier.last;   // the other PC copied these
    const waiting = Math.max(0, p.top - t.last);
    if (p.want === 'on') say('2. Transcript', ['listening is still ON: press Stop listening on the GM page first, then run this again.']);
    else {
      const r = await pass({ vault: opts.vault, db, campaign, ledger: camp, session: opts.session != null ? String(N) : undefined, dryRun: !opts.yes, prune: false, now: () => now });
      if (opts.yes) saveLedger(privateDir, ledger);
      say('2. Transcript', [waiting ? (opts.yes ? 'copied ' : 'would copy ') + r.filed + ' line' + (r.filed === 1 ? '' : 's') + (r.notes.length ? ' into ' + r.notes.join(', ') : '') + (r.filed < waiting ? ' (' + (waiting - r.filed) + ' already in the vault)' : '') : 'nothing waiting on the server: the PC copied it all during the game']);
      if (opts.prune) {
        if (t.last > 0) { const { pruneLines } = await import('../functions/_lib/stt.js'); await pruneLines(db, campaign, t.last); print('  pruned the server\'s copy of lines 1-' + t.last + ' (they are in the vault)'); }
      } else if (p.top) print('  ' + p.top + ' line' + (p.top === 1 ? '' : 's') + ' still kept on the server: --yes --prune clears them once you are happy with the notes');
    }
  } catch (e) {
    say('2. Transcript', ['stopped: ' + (e.kind === 'auth' ? 'not logged in to Cloudflare: run `npx wrangler login`' : e.kind === 'offline' ? 'offline or Cloudflare unreachable' : e.message) + '. Nothing was written.']);
    return { code: 2 };
  }

  // 3. the pull
  print(''); print('3. Pull: captures, pins, bargains, Prep ticks and beats, NPCs into session ' + N);
  const pulled = await syncRun({ mode: 'pull', dryRun: !opts.yes, yes: false, baseline: false, only: null, vault: opts.vault, session: N, campaign, exec: opts.syncExec || exec, now, privateDir, root: opts.root, print: (l) => print('  ' + l) });
  if (pulled.code === 2) return { code: 2 };
  if (pulled.code === 1) code = 1;

  // 3b. Claude's notes: the shown Ref slips and Clerk notes from the assist log, into the session note (append only)
  try {
    const items = await claudeNoteLines(db, campaign, { vault: opts.vault, note: w.note, N, now });
    if (!items.length) say('3b. Claude\'s notes', ['no Ref slips or Clerk notes in the assist log for session ' + N]);
    else {
      const text = (readNote(abs(opts.vault, w.note.rel)) || { text: '' }).text;
      const fresh = items.filter((x) => !hasBlock(text, x.bid));
      const r = items.filter((x) => x.seat === 'ref').length;
      const what = items.length + ' (' + r + ' rule slip' + (r === 1 ? '' : 's') + ', ' + (items.length - r) + ' clerk note' + (items.length - r === 1 ? '' : 's') + ')';
      if (!opts.yes) say('3b. Claude\'s notes', [(fresh.length ? 'would add ' + fresh.length + ' of ' + what : 'all ' + what + ' are already in the note') + ' under "## ' + CLAUDE_NOTES + '" in ' + label]);
      else {
        if (fresh.length) addClaudeNotes(opts.vault, w.note.rel, items);
        const marked = await markFiled(db, campaign, items.map((x) => x.row));
        say('3b. Claude\'s notes', [(fresh.length ? 'added ' + fresh.length + ' of ' + what : 'all ' + what + ' were already in the note') + ' under "## ' + CLAUDE_NOTES + '" in ' + label + (marked ? '; the box now shows them as saved to history' : '')]);
      }
    }
  } catch (e) {
    say('3b. Claude\'s notes', ['could not file them: ' + e.message + '. Nothing else was affected.']);
    code = 1;
  }

  // 4. the two transcripts
  const dir = SESSIONS + '/', pad = /^\d+$/.test(String(N)) ? String(N).padStart(2, '0') : String(N);
  const rd = (rel) => { try { const r = readNote(abs(opts.vault, rel)); return r ? r.text : null; } catch (_) { return null; } };
  const lap = rd(dir + 'b68g-s' + pad + '-transcript.md'), ipad = rd(dir + 'b68g-s' + pad + '-transcript-ipad.md');
  const lapIsIpad = lap != null && /^source:\s*ipad\s*$/m.test(lap.split(/^---\s*$/m)[1] || '');
  const rows = [];
  const row = (name, st) => rows.push(name + ': ' + (!st ? 'none' : st.lines + ' lines' + (st.lines ? ', ' + st.first + '-' + st.last : '') + (st.speakers.length ? '; named: ' + st.speakers.length : '') + (st.unnamed.length ? '; unnamed: ' + st.unnamed.join(', ') : '')));
  if (lapIsIpad) { row('the laptop (Obsidian transcriber)', null); row('the iPad', transcriptStats(lap)); }
  else { row('the laptop (Obsidian transcriber)', transcriptStats(lap)); row('the iPad', transcriptStats(ipad)); }
  const ip = transcriptStats(lapIsIpad ? lap : ipad);
  if (ip && ip.unnamed.length) rows.push('the iPad\'s unnamed speakers stay S0, S1...: rename them in the note if you know who they were');
  say('4. Transcripts for session ' + N, rows);

  // 5. (with step 2)  6. the counter
  try {
    const doc = campaignDoc(await loadCampaignRow(db, campaign)), cur = Math.floor(+(doc.session && doc.session.number) || 0);
    const top = highestNote(sessionNotes(opts.vault)), vaultTop = top.note ? top.note.num : 0;
    const lines = ['the table says session ' + cur + '; the vault\'s highest note is session ' + vaultTop + (cur === vaultTop ? ' (in step)' : '')];
    if (opts.counter != null && opts.counter !== cur) {
      if (opts.yes) {
        await writeCampaign(db, campaign, (c) => ({ ...c, session: { ...(c.session || {}), number: opts.counter } }));
        lines.push('set the table\'s counter to ' + opts.counter);
      } else lines.push('would set the table\'s counter to ' + opts.counter);
    } else if (cur !== vaultTop) lines.push('to line them up: --yes --counter ' + vaultTop + ' (or press Start session on the table at the start of the next game)');
    say('5. Session counter', lines);
  } catch (e) { say('5. Session counter', ['could not read it: ' + e.message]); }

  say('Then', ['In Claude Code: ask Blade to "log tonight\'s session" from ' + label + ' and its transcript.',
    'In the GM page: iPad tab > Who is who: clear the speaker names before next game.']);
  return { code };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (o.help) { console.log('node scripts/gm-after.mjs [--session <N>] [--yes] [--prune] [--counter <N>] [--vault <path>]'); process.exit(0); }
  run(o).then(({ code }) => process.exit(code), (e) => { console.error('gm-after failed: ' + (e && e.stack || e)); process.exit(2); });
}
