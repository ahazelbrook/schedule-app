#!/usr/bin/env node
// Copy what the table iPad heard (GM.md "Listening") into the GM's vault, as it comes, so Claude and Blade can read the
// transcript mid-session. Runs on the GM's PC with the GM's own `wrangler login`, like gm-sync.mjs.
//
//   npm run gm:transcript                 one pass: every line not yet in the vault
//   npm run gm:transcript -- --follow     keep going, a pass every 10 s (Ctrl+C stops it)
//   npm run gm:transcript -- --watch      in the background for good: one cheap look a minute, and a pass every 10 s
//                                         while the GM page has listening on (or lines are waiting). Logs to
//                                         gm-private/transcript-watch.log; tells the GM page it is alive (gm_stt `copier`)
//   npm run gm:transcript -- --install    start --watch now and at every Windows sign-in (a hidden launcher in the
//                                         Startup folder); --uninstall stops it and removes the launcher
//   node scripts/gm-transcript.mjs [--follow | --watch] [--every <s>] [--idle <s>] [--session <N>] [--vault <path>] [--dry-run] [--prune]
//
// One copier at a time (gm-private/transcript.lock): a --follow while the background one runs says so and stops.
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
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { asD1, wranglerExec, readWranglerToml } from './lib/d1.mjs';
import { SESSIONS, abs, readNote, createNote, appendNote, editNote, sessionNotes, highestNote, hhmm, dmy } from './lib/vault.mjs';
import { loadLedger, campaignLedger, saveLedger } from './lib/ledger.mjs';
import { readLines, loadStt, pruneLines } from '../functions/_lib/stt.js';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const o = { follow: false, watch: false, every: 10, idle: 60, dryRun: false, prune: false };
  const need = (i, f) => { if (i >= argv.length || argv[i].startsWith('--')) throw new Error(f + ' needs a value'); return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--follow') o.follow = true;
    else if (a === '--watch') o.watch = true;
    else if (a === '--install') o.install = true;
    else if (a === '--uninstall') o.uninstall = true;
    else if (a === '--every') { o.every = Number(need(++i, a)); if (!(o.every >= 3)) throw new Error('--every takes seconds, 3 or more'); }
    else if (a === '--idle') { o.idle = Number(need(++i, a)); if (!(o.idle >= 15)) throw new Error('--idle takes seconds, 15 or more'); }
    else if (a === '--session') { o.session = String(need(++i, a)); if (!/^[0-9]+(\.[0-9]+)?$/.test(o.session)) throw new Error('--session takes a session number'); }
    else if (a === '--vault') o.vault = need(++i, a);
    else if (a === '--dry-run' || a === '-n') o.dryRun = true;
    else if (a === '--prune') o.prune = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  if (o.follow && o.watch) throw new Error('--follow or --watch, not both');
  if (o.watch && o.dryRun) throw new Error('--watch has no dry run');
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
      '> [!info] Raw live speech-to-text from the table iPad (Deepgram), copied here every few seconds by the PC (`scripts/gm-transcript.mjs`, which runs by itself while listening is on).',
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

/* ---------- --watch: in the background, busy only while listening is on ---------- */

/** One cheap look (one query): does the GM page want listening, the newest line on the server, and the last copier. */
export async function probe(db, campaign) {
  const r = await db.prepare("SELECT json_extract(s.doc, '$.want') AS want, json_extract(s.doc, '$.copier.host') AS host, json_extract(s.doc, '$.copier.at') AS at," +
    " json_extract(s.doc, '$.copier.last') AS last, (SELECT MAX(seq) FROM gm_transcript WHERE campaign = ?1) AS top FROM (SELECT 1) LEFT JOIN gm_stt s ON s.campaign = ?1")
    .bind(campaign).first();
  return { want: r && r.want === 'on' ? 'on' : 'off', top: Number(r && r.top) || 0, copier: { host: (r && r.host) || '', at: (r && r.at) || '', last: Number(r && r.last) || 0 } };
}
/** Tell the GM page the PC is copying: gm_stt.doc.copier = { at, last, host }, set in place (the PATCH API never sets it). */
export async function beat(db, campaign, copier) {
  await db.prepare("UPDATE gm_stt SET doc = json_set(doc, '$.copier', json(?2)) WHERE campaign = ?1").bind(campaign, JSON.stringify(copier)).run();
}
export const OTHER_FRESH_MS = 180000;
/**
 * One --watch step: a pass only while listening is on or lines are waiting, a heartbeat at most once a minute while on.
 * Two PCs (desk and laptop) share one vault through Obsidian Sync: while another host has beaten in the last 3 minutes
 * this one stands back, and it never files below the other's `last` (those lines reach this vault by sync).
 * ctx as pass() plus { every, idle (s), now(), host, beatAt }. Returns pass()'s result with { want, wait (ms), other }.
 */
export async function watchStep(ctx) {
  const p = await probe(ctx.db, ctx.campaign);
  const now = ctx.now ? ctx.now() : Date.now();
  const host = ctx.host || os.hostname();
  const t = ctx.ledger.transcript = ctx.ledger.transcript || { last: 0, speakers: {} };
  const theirs = p.copier.host && p.copier.host !== host;
  if (theirs && now - Date.parse(p.copier.at) < OTHER_FRESH_MS) return { filed: 0, notes: [], want: p.want, wait: ctx.idle * 1000, other: p.copier.host };
  if (theirs && p.copier.last > t.last) t.last = p.copier.last;
  const r = p.want === 'on' || p.top > t.last ? await pass(ctx) : { filed: 0, notes: [] };
  if (p.want === 'on' && (r.filed || theirs || !ctx.beatAt || now - ctx.beatAt >= 60000)) {
    await beat(ctx.db, ctx.campaign, { at: new Date(now).toISOString(), last: t.last, host });
    ctx.beatAt = now;
  }
  return { ...r, want: p.want, wait: (p.want === 'on' || r.filed ? ctx.every : ctx.idle) * 1000, other: '' };
}

/** One copier at a time. -> 0 when this process holds the lock, else the pid that does. */
export function takeLock(dir) {
  const f = path.join(dir, 'transcript.lock');
  try {
    const pid = Number(fs.readFileSync(f, 'utf8'));
    if (pid && pid !== process.pid) { try { process.kill(pid, 0); return pid; } catch (_) { /* gone: a stale lock */ } }
  } catch (_) { /* no lock */ }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, String(process.pid));
  return 0;
}
function dropLock(dir) {
  const f = path.join(dir, 'transcript.lock');
  try { if (Number(fs.readFileSync(f, 'utf8')) === process.pid) fs.unlinkSync(f); } catch (_) {}
}

/* ---------- --install / --uninstall: a hidden launcher in the Windows Startup folder ---------- */

export const LAUNCHER = 'b68-transcript.vbs';
export function startupDir(env = process.env) { return path.join(env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'); }
/** The launcher: wscript runs node with no window (style 0) and does not wait. */
export function launcherText(node, script, vault) {
  const q = (s) => '""' + String(s).replace(/"/g, '') + '""';
  return ["' Blades '68 (schedule-app): copies the table iPad's transcript into the vault while listening is on.",
    "' Made by `npm run gm:transcript -- --install`; `-- --uninstall` removes it. Log: gm-private\\transcript-watch.log",
    'CreateObject("WScript.Shell").Run "' + q(node) + ' ' + q(script) + ' --watch --vault ' + q(vault) + '", 0, False', ''].join('\r\n');
}
function install(o, privateDir) {
  if (process.platform !== 'win32') { console.error('--install is for Windows: run --watch under your own service manager'); process.exit(2); }
  const file = path.join(startupDir(), LAUNCHER);
  fs.writeFileSync(file, launcherText(process.execPath, fileURLToPath(import.meta.url), path.resolve(o.vault)));
  const held = takeLock(privateDir);
  if (held) { console.log('Launcher written: ' + file + '\nThe background copier is already running (pid ' + held + ').'); return; }
  dropLock(privateDir);
  spawn('wscript.exe', [file], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  console.log('Launcher written: ' + file + '\nStarted the background copier. It starts by itself at every sign-in from now on.\nLog: ' + path.join(privateDir, 'transcript-watch.log'));
}
function uninstall(privateDir) {
  const file = path.join(startupDir(), LAUNCHER);
  if (fs.existsSync(file)) { fs.unlinkSync(file); console.log('Removed ' + file); } else console.log('No launcher in the Startup folder.');
  const held = takeLock(privateDir);
  if (held) { try { process.kill(held); console.log('Stopped the background copier (pid ' + held + ').'); } catch (e) { console.log('Could not stop pid ' + held + ': ' + e.message); } }
  dropLock(privateDir);
}

async function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
  if (o.help) { console.log('node scripts/gm-transcript.mjs [--follow | --watch | --install | --uninstall] [--every <s>] [--idle <s>] [--session <N>] [--vault <path>] [--dry-run] [--prune]'); return; }
  const privateDir = path.join(REPO, 'gm-private');
  if (o.uninstall) return uninstall(privateDir);
  if (!o.vault || !fs.existsSync(abs(o.vault, SESSIONS))) { console.error('vault not found (or it has no ' + SESSIONS + '): pass --vault "<path>"'); process.exit(2); }
  if (o.install) return install(o, privateDir);
  const toml = readWranglerToml(REPO);
  const db = asD1(wranglerExec({ root: REPO, database: toml.database }));
  const stamp = () => new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Melbourne', hour12: false });

  /* --watch has no console: it writes to a log, a repeated message once */
  const logFile = path.join(privateDir, 'transcript-watch.log');
  let said = '';
  const say = (msg, again) => {
    if (!o.watch) return console.log(stamp() + '  ' + msg);
    if (msg === said && !again) return;
    said = msg;
    try {
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > 256 * 1024) fs.renameSync(logFile, logFile + '.1');
      fs.appendFileSync(logFile, new Date().toISOString() + '  ' + msg + '\n');
    } catch (_) {}
  };
  const looping = o.follow || o.watch;
  if (looping && !o.dryRun) {
    const held = takeLock(privateDir);
    if (held) { if (o.follow) console.log('The background copier is already copying (pid ' + held + '): nothing to do.'); process.exit(0); }
    process.on('exit', () => dropLock(privateDir));
  }
  const ledger = loadLedger(privateDir), camp = campaignLedger(ledger, toml.campaign);
  let stop = false;
  process.on('SIGINT', () => { stop = true; console.log('\nstopping after this pass'); });
  if (o.follow) console.log('Copying the iPad\'s transcript into the vault every ' + o.every + ' s. Ctrl+C stops.');
  if (o.watch) say('watching (pid ' + process.pid + '): a look every ' + o.idle + ' s, a pass every ' + o.every + ' s while listening is on', true);
  const ctx = { vault: o.vault, db, campaign: toml.campaign, ledger: camp, session: o.session, dryRun: o.dryRun, prune: o.prune, every: o.every, idle: o.idle };
  let want = 'off', failing = false;
  do {
    let wait = o.every * 1000;
    try {
      const r = o.watch ? await watchStep(ctx) : await pass(ctx);
      if (!o.dryRun) saveLedger(privateDir, ledger);
      if (failing) { failing = false; say('working again: the last pass reached Cloudflare', true); }
      if (o.watch) { if (r.want !== want) say('listening ' + r.want, true); want = r.want; wait = r.wait; if (r.other) say('standing back: ' + r.other + ' is copying'); }
      if (r.filed || !looping) say((o.dryRun ? 'would copy ' : 'copied ') + r.filed + ' line' + (r.filed === 1 ? '' : 's') + (r.notes.length ? ' into ' + r.notes.join(', ') : ''), true);
      else if (o.watch && !r.other) said = '';
    } catch (e) {
      if (!o.dryRun) { try { saveLedger(privateDir, ledger); } catch (_) {} }   /* what did land is remembered */
      const why = e.kind === 'auth' ? 'not logged in to Cloudflare: run `npx wrangler login`' : e.kind === 'offline' ? 'offline or Cloudflare unreachable' : e.code === 'RACE' ? 'Obsidian was saving the note: next pass' : e.message;
      say('skipped a pass: ' + why);
      failing = true;
      if (!looping) process.exit(2);
      if (o.watch && e.code !== 'RACE') wait = o.idle * 1000;
    }
    if (looping && !stop) await new Promise((r) => setTimeout(r, wait));
  } while (looping && !stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
