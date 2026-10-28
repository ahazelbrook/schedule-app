#!/usr/bin/env node
// Before a push, and on game-day morning: what the assist part would carry, from the local pack and the upload state.
//
//   npm run gm:preflight [-- --remote] [--pack <file>] [--private <dir>] [--campaign <id>] [--today DD/MM/YYYY]
//
// Prints: the prep note (and whether it is dated before today), its Must land count, the never-reveal entries, the handouts
// that have cues, the prefix's token count, the Files API file's age (assist-file.json has no timestamp, so its mtime is used and
// the output says so), and whether the next push would upload a new file. With --remote it also reads the live part versions from
// D1 (one read-only SELECT of part, version) and says whether the live assist part is the one a push of the local pack would
// leave. It never writes: not to D1, not to Anthropic, not to the vault. Exit 0 fine, 1 the part would be refused, 2 stopped.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { asD1, wranglerExec, readWranglerToml, bindSql } from './lib/d1.mjs';
import { cleanPart, shortHash } from '../functions/_lib/gm.js';
import { readState, sha256, STATE_NAME } from './lib/assist-file.mjs';
import { prepProblem, resolvePrep, prepCandidates, dateKey, todayKey } from './lib/assist-prep.mjs';
import { readConfig, TOKEN_WARN, NEVER_NAME } from './lib/assist-export.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clip = (s, n) => { const t = String(s).replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

export function parseArgs(argv) {
  const o = { remote: false };
  const need = (i, f) => { if (i >= argv.length || argv[i].startsWith('--')) throw new Error(f + ' needs a value'); return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--remote') o.remote = true;
    else if (a === '--vault') o.vault = need(++i, a);
    else if (a === '--pack') o.packFile = need(++i, a);
    else if (a === '--private') o.privateDir = need(++i, a);
    else if (a === '--campaign') o.campaign = need(++i, a);
    else if (a === '--today') { o.today = need(++i, a); if (dateKey(o.today) === null) throw new Error('--today takes DD/MM/YYYY'); }
    else if (a === '--help' || a === '-h') o.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  return o;
}

/** The never-reveal block of a prefix -> { npc: [name], clues: [first line], sections: [title] }. */
export function neverEntries(prefix) {
  const m = new RegExp('<context name="' + NEVER_NAME.replace('.', '\\.') + '">\\n([\\s\\S]*?)\\n</context>').exec(String(prefix || ''));
  const out = { npc: [], clues: [], sections: [], found: !!m };
  if (!m) return out;
  let area = '';
  let inClues = false;
  for (const l of m[1].split('\n')) {
    const h2 = /^## (.*)$/.exec(l), h3 = /^### (.*)$/.exec(l);
    if (h2) { area = /^What the NPCs hold/.test(h2[1]) ? 'npc' : /^Tonight/.test(h2[1]) ? 'tonight' : ''; inClues = false; continue; }
    if (h3) {
      if (area === 'npc') out.npc.push(h3[1].trim());
      else if (area === 'tonight') { inClues = /^Clues not yet landed/.test(h3[1]); if (!inClues) out.sections.push(h3[1].trim()); }
      continue;
    }
    if (area === 'tonight' && inClues && /^- /.test(l)) out.clues.push(l.slice(2));
  }
  return out;
}

const age = (ms) => { const h = Math.floor(ms / 3600000); return h < 48 ? h + ' hours' : Math.floor(h / 24) + ' days'; };

/** One run. opts: parseArgs() output plus, for tests, { exec, now (ms), root }. -> { lines, code } */
export async function preflight(opts = {}) {
  const root = opts.root || REPO, now = opts.now || Date.now();
  const privateDir = opts.privateDir || path.join(root, 'gm-private');
  const packFile = opts.packFile || path.join(privateDir, 'b68-gm-pack.json');
  const stateFile = path.join(privateDir, STATE_NAME);
  const lines = [];
  const say = (s) => lines.push(s);
  let code = 0;

  let pk;
  try { pk = JSON.parse(fs.readFileSync(packFile, 'utf8')); } catch (_) { pk = null; }
  if (!isObj(pk) || !isObj(pk.parts)) { say('no readable pack at ' + packFile + ' (npm run gm:pack builds it)'); return { lines, code: 2 }; }
  const part = pk.parts.assist;
  if (!isObj(part)) { say('the pack has no assist part (no rules, cast or prep note was found): nothing to push'); return { lines, code: 1 }; }
  const src = isObj(part.src) ? part.src : {}, prefix = typeof part.prefix === 'string' ? part.prefix : '';
  const today = opts.today ? dateKey(opts.today) : todayKey(new Date(now));

  say('assist part, from ' + path.relative(root, packFile).split(path.sep).join('/'));
  // prep note
  const prepKey = typeof src.prep === 'string' && src.prep ? src.prep : '';
  say('prep note:    ' + (prepKey ? prepKey : 'NONE'));
  if (prepKey && opts.vault) {
    const c = prepCandidates(opts.vault).find((x) => x.rel === prepKey);
    if (c && c.date) say('prep date:    ' + c.date + (c.key !== null && c.key < today ? '   BEFORE TODAY: this is not the next night' : ''));
  }
  say('must land:    ' + (Number.isInteger(src.mustLand) ? src.mustLand + ' unlanded, ' + (src.mustLandLanded || 0) + ' ticked' : 'not recorded (the pack was built before the stats existed: rebuild it)'));
  // would the vault pick something else now?
  if (opts.vault) {
    let cfg = {};
    try { cfg = readConfig(path.join(privateDir, 'assist-config.json')); } catch (_) { cfg = {}; }
    const pick = resolvePrep({ vault: opts.vault, config: cfg, today });
    if (pick && pick.rel !== prepKey) say('  NOTE: the vault now picks ' + pick.rel + ' (' + pick.how + '); the pack was built with ' + (prepKey || 'no prep') + ': run npm run gm:pack');
  }
  // never-reveal
  const nv = neverEntries(prefix);
  say('never-reveal: ' + (nv.found ? nv.npc.length + ' NPC note(s), ' + (Number.isInteger(src.mustLand) ? src.mustLand : nv.clues.length) + ' unlanded clue(s), ' + nv.sections.length + ' secret section(s) from the prep note' : 'NONE in the prefix'));
  for (const n of nv.npc) say('  npc   ' + n);
  for (const c of nv.clues) say('  clue  ' + clip(c, 90));   // a clue that runs over several lines lists each line
  for (const s of nv.sections) say('  prep  ' + s);
  // handouts
  const ho = isObj(pk.parts.handouts) && Array.isArray(pk.parts.handouts.items) ? pk.parts.handouts.items : [];
  const cued = ho.filter((h) => h && typeof h.when === 'string' && h.when);
  say('handouts:     ' + ho.length + ' in the pack, ' + cued.length + ' with a cue' + (Number.isInteger(src.handouts) ? ', ' + src.handouts + ' listed in the prefix' : ', none listed in the prefix'));
  for (const h of cued) say('  ' + h.id + ' | ' + clip(h.when, 80));
  // tokens and the file
  const tokens = Number.isInteger(src.tokens) ? src.tokens : null;
  say('prefix:       ' + (tokens === null ? 'tokens not recorded' : 'about ' + tokens + ' tokens' + (tokens > TOKEN_WARN ? '   OVER ' + TOKEN_WARN + ': trim the prep or the cast' : '')));
  const state = readState(stateFile);
  const hash = prefix ? sha256(prefix) : '';
  if (!state) say('file:         no upload state (' + STATE_NAME + ' in ' + path.relative(root, privateDir).split(path.sep).join('/') + '): the next push uploads the prefix');
  else {
    let mt = 0; try { mt = fs.statSync(stateFile).mtimeMs; } catch (_) { /* below */ }
    say('file:         id ...' + state.file_id.slice(-6) + ', ' + (mt ? age(now - mt) + ' old (' + STATE_NAME + ' has no timestamp: its modified time is used)' : 'age unknown'));
    say('               ' + (hash && state.hash === hash ? 'the prefix is unchanged since that upload: a push reuses the file' : 'the prefix has changed since that upload: the next push uploads a new file'));
  }
  // would a push be accepted?
  const why = prepProblem(src);
  if (why) { say('PUSH GUARD:   a push would be REFUSED: ' + why); code = 1; } else say('push guard:   ok (prep note and Must land present)');

  // live versions
  if (opts.remote) {
    const toml = fs.existsSync(path.join(root, 'wrangler.toml')) ? readWranglerToml(root) : { database: 'blades68', campaign: 'default' };
    const campaign = opts.campaign || toml.campaign;
    try {
      const exec = opts.exec || wranglerExec({ root, database: toml.database });
      const [r] = await exec.batch(bindSql('SELECT part, version FROM gm_pack WHERE campaign = ?1', [campaign]));
      const live = new Map(((r && r.results) || []).map((x) => [x.part, x.version]));
      const liveV = live.get('assist');
      say('live (D1):    ' + live.size + ' part(s); assist ' + (liveV ? 'v' + liveV : 'not there'));
      if (state && hash && state.hash === hash) {
        const body = { file_id: state.file_id, hash, ...(isObj(part.extra) ? { extra: part.extra } : {}) };
        const c = cleanPart({ part: 'assist', src, body });
        const localV = await shortHash(c.body);
        say('               local would leave v' + localV + ': ' + (liveV === localV ? 'MATCHES the live assist part' : 'DIFFERS from the live assist part'));
      } else {
        say('               the next push uploads a new file, so its version will differ from the live assist part' + (liveV ? ' (v' + liveV + ')' : ''));
      }
    } catch (e) {
      say('live (D1):    could not read: ' + (e && e.message || e) + (e && e.kind === 'auth' ? ' (npx wrangler login)' : ''));
      code = Math.max(code, 2);
    }
  }
  return { lines, code };
}

const USAGE = 'node scripts/gm-preflight.mjs [--vault <dir>] [--remote] [--pack <file>] [--private <dir>] [--campaign <id>] [--today DD/MM/YYYY]';
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { console.error(e.message); console.error(USAGE); process.exit(2); }
  if (o.help) { console.log(USAGE); process.exit(0); }
  preflight(o).then(({ lines, code }) => { for (const l of lines) console.log(l); process.exit(code); }, (e) => { console.error('gm-preflight failed: ' + (e && e.stack || e)); process.exit(2); });
}
