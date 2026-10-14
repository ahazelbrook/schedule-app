// The sync's database layer (SYNC.md). One small interface, two implementations:
//
//   exec.batch(sql)  -> [{ results: [row...], meta: { changes } }, ...]   one entry per statement in `sql`
//
//   wranglerExec(...)  the live D1 through the GM's own `wrangler login` (`wrangler d1 execute <db> --remote --json`).
//                      No new secret, no API token: wrangler holds the OAuth login.
//   memoryExec(...)    an in-memory SQLite (node:sqlite) with the repo's schema.sql: the tests' fake. Same interface,
//                      same SQL, same literal binding, same command-size cap.
//
// `wrangler d1 execute --command` takes no bound parameters, so values are written into the SQL as SQLite literals by
// bindSql() ('...' with '' doubled; SQLite has no backslash escapes). `--file` is never used: on --remote it runs D1's
// import, which takes the database offline while it runs.
//
// asD1(exec) wraps either one in the shape of a Workers D1 binding (prepare().bind().first()/all()/run()), so the
// server's own helpers (functions/_lib/gm.js, npcs.js) run unchanged against it.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export class D1Error extends Error {
  constructor(message, kind = 'sql', detail) {
    super(message);
    this.kind = kind;          // 'auth' | 'offline' | 'sql' | 'size' | 'unknown'
    this.detail = detail;
  }
}

// One --command travels as a single argument on the command line. Windows caps a whole command line at 32767 UTF-16
// units, and node escapes every " (and \ before one) when it builds it, so the cost of a character is counted that way.
export const MAX_COMMAND_COST = 28000;
export const charCost = (c) => (c === '"' || c === '\\' ? 2 : 1);
export function commandCost(sql) {
  let n = 0;
  for (let i = 0; i < sql.length; i++) n += charCost(sql[i]);
  return n;
}
export function checkCommand(sql) {
  const cost = commandCost(sql);
  if (cost > MAX_COMMAND_COST) throw new D1Error('statement too large for one command (' + cost + ' > ' + MAX_COMMAND_COST + ')', 'size');
  return sql;
}

/** A SQLite literal for a JS value. Strings are quoted ('' doubled); a NUL is refused. */
export function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new D1Error('not a finite number: ' + v);
    return String(v);
  }
  if (typeof v === 'bigint') return v.toString();
  if (typeof v !== 'string') throw new D1Error('cannot bind a ' + typeof v);
  if (v.indexOf('\u0000') >= 0) throw new D1Error('a string holds a NUL character');
  return "'" + v.replace(/'/g, "''") + "'";
}

/** Replace ?N (and bare ?) placeholders outside quoted text with literals of `params`. */
export function bindSql(sql, params = []) {
  let out = '', i = 0, next = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const q = c; let j = i + 1;
      while (j < sql.length) { if (sql[j] === q) { if (sql[j + 1] === q) { j += 2; continue; } break; } j++; }
      out += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '-' && sql[i + 1] === '-') { const e = sql.indexOf('\n', i); const j = e < 0 ? sql.length : e; out += sql.slice(i, j); i = j; continue; }
    if (c === '?') {
      let j = i + 1; while (j < sql.length && /[0-9]/.test(sql[j])) j++;
      const n = j > i + 1 ? parseInt(sql.slice(i + 1, j), 10) - 1 : next;
      next = n + 1;
      if (n < 0 || n >= params.length) throw new D1Error('no value for placeholder ' + sql.slice(i, j));
      out += literal(params[n]); i = j; continue;
    }
    out += c; i++;
  }
  return out;
}

/** Split a script on ; outside quotes and comments (for the in-memory engine; D1 takes the script whole). */
export function splitStatements(sql) {
  const out = []; let cur = '', i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      const q = c; let j = i + 1;
      while (j < sql.length) { if (sql[j] === q) { if (sql[j + 1] === q) { j += 2; continue; } break; } j++; }
      cur += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '-' && sql[i + 1] === '-') { const e = sql.indexOf('\n', i); i = e < 0 ? sql.length : e; continue; }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** database_name and the CAMPAIGN var from wrangler.toml (plain regexes: the file is ours and simple). */
export function readWranglerToml(root) {
  const text = fs.readFileSync(path.join(root, 'wrangler.toml'), 'utf8');
  const db = /^\s*database_name\s*=\s*"([^"]+)"/m.exec(text);
  const camp = /^\s*CAMPAIGN\s*=\s*"([^"]+)"/m.exec(text);
  return { database: db ? db[1] : 'blades68', campaign: camp ? camp[1] : 'default' };
}

function classify(text) {
  const t = String(text || '');
  if (/not (?:logged in|authenticated)|wrangler login|authentication error|\b10000\b|invalid (?:api )?token|oauth/i.test(t)) return 'auth';
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network|getaddrinfo|offline/i.test(t)) return 'offline';
  if (/SQLITE|syntax error|no such (?:table|column)|constraint/i.test(t)) return 'sql';
  return 'unknown';
}

/**
 * The live D1, through the repo's own wrangler (node_modules/wrangler/bin/wrangler.js run by this node, no shell, so
 * no cmd.exe quoting and no .cmd shim on Windows). `remote` is always true here: the sync has no local mode.
 * `spawnImpl` is injectable for tests of the error handling.
 */
export function wranglerExec({ root, database, timeoutMs = 120000, spawnImpl = spawn } = {}) {
  const bin = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  let calls = 0;
  return {
    kind: 'wrangler',
    get calls() { return calls; },
    batch(sql) {
      checkCommand(sql);
      calls++;
      if (!fs.existsSync(bin)) return Promise.reject(new D1Error('wrangler is not installed (npm install)', 'unknown'));
      return new Promise((resolve, reject) => {
        const child = spawnImpl(process.execPath, [bin, 'd1', 'execute', database, '--remote', '--json', '--command=' + sql], {
          cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
        });
        let out = '', err = '', done = false;
        const timer = setTimeout(() => { if (!done) { done = true; try { child.kill(); } catch (_) {} reject(new D1Error('wrangler timed out', 'offline')); } }, timeoutMs);
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err += d; });
        child.on('error', (e) => { if (done) return; done = true; clearTimeout(timer); reject(new D1Error('could not start wrangler: ' + e.message, 'unknown')); });
        child.on('close', (code) => {
          if (done) return; done = true; clearTimeout(timer);
          let parsed = null;
          const s = out.indexOf('['), o = out.indexOf('{');
          const start = s < 0 ? o : o < 0 ? s : Math.min(s, o);
          if (start >= 0) { try { parsed = JSON.parse(out.slice(start)); } catch (_) { parsed = null; } }
          if (code === 0 && Array.isArray(parsed)) {
            const bad = parsed.find((r) => r && r.success === false);
            if (bad) return reject(new D1Error('D1 refused a statement', 'sql'));
            return resolve(parsed.map((r) => ({ results: (r && r.results) || [], meta: (r && r.meta) || {} })));
          }
          const e = parsed && parsed.error;
          const text = e ? [e.text].concat((e.notes || []).map((n) => n.text)).join(' ') : (err || out).slice(0, 600);
          reject(new D1Error('wrangler: ' + text.replace(/\s+/g, ' ').trim().slice(0, 400), classify(text + ' ' + err)));
        });
      });
    },
  };
}

/**
 * The tests' fake: SQLite in memory with the repo's schema. `failOn(callIndex, sql)` may return an Error to throw
 * instead of running a call (a dropped connection mid-push).
 */
export async function memoryExec({ schemaFile, failOn } = {}) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  if (schemaFile) db.exec(fs.readFileSync(schemaFile, 'utf8'));
  let calls = 0;
  const log = [];
  return {
    kind: 'memory',
    db,
    log,
    get calls() { return calls; },
    async batch(sql) {
      checkCommand(sql);
      const n = calls++;
      log.push(sql);
      const f = failOn && failOn(n, sql);
      if (f) throw f;
      const out = [];
      db.exec('SAVEPOINT b');   // D1 runs a --command script as one unit
      try {
        for (const st of splitStatements(sql)) {
          const p = db.prepare(st);
          if (/^\s*(select|with|pragma)\b/i.test(st) || /\breturning\b/i.test(st)) {
            out.push({ results: p.all().map((r) => ({ ...r })), meta: { changes: 0 } });
          } else {
            const r = p.run();
            out.push({ results: [], meta: { changes: Number(r.changes) } });
          }
        }
        db.exec('RELEASE b');
      } catch (e) {
        db.exec('ROLLBACK TO b'); db.exec('RELEASE b');
        throw new D1Error('memory: ' + e.message, 'sql');
      }
      return out;
    },
  };
}

/** A Workers-D1-shaped facade over exec (prepare/bind/first/all/run), for the server's own helpers. */
export function asD1(exec) {
  return {
    prepare(sql) {
      let params = [];
      const stmt = {
        bind(...p) { params = p; return stmt; },
        async first(col) {
          const [r] = await exec.batch(bindSql(sql, params));
          const row = (r && r.results && r.results[0]) || null;
          return row && col ? row[col] : row;
        },
        async all() { const [r] = await exec.batch(bindSql(sql, params)); return { results: (r && r.results) || [], meta: (r && r.meta) || {} }; },
        async run() { const [r] = await exec.batch(bindSql(sql, params)); return { success: true, meta: (r && r.meta) || {} }; },
      };
      return stmt;
    },
  };
}
