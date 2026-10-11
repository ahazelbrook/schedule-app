// JSON and config helpers for scripts/deploy.sh and scripts/access-emails.sh (node instead of jq).
//   node scripts/lib/cf.mjs <command> [args...]      JSON input, when a command reads one, on stdin
// Every command prints plain text for the shell; a non-zero exit means "no" or "bad input".

import { readFileSync, writeFileSync } from 'node:fs';
import { promises as dns } from 'node:dns';

const [cmd, ...args] = process.argv.slice(2);
const out = (s) => process.stdout.write(s === undefined || s === null ? '' : String(s) + '\n');
const fail = (msg, code = 1) => { if (msg) process.stderr.write(msg + '\n'); process.exit(code); };
function stdinJson() {
  const text = readFileSync(0, 'utf8');
  try { return JSON.parse(text); } catch (_) { fail('not JSON: ' + text.slice(0, 300)); }
}
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

/** "a@x, B@x ,," -> ['a@x', 'b@x'], lower-cased, de-duplicated; exits 2 on anything that is not an email. */
function emailList(...lists) {
  const seen = new Set();
  for (const l of lists) {
    for (const raw of String(l || '').split(/[,\s]+/)) {
      const e = raw.trim().toLowerCase();
      if (!e) continue;
      if (!EMAIL_RE.test(e)) fail('not an email address: "' + raw + '"', 2);
      seen.add(e);
    }
  }
  return [...seen];
}

function at(obj, path) {
  let v = obj;
  for (const k of path.split('.').filter(Boolean)) v = v == null ? undefined : v[k];
  return v;
}

const appHosts = (a) => [a.domain, ...(Array.isArray(a.self_hosted_domains) ? a.self_hosted_domains : []),
  ...(Array.isArray(a.destinations) ? a.destinations.map((d) => d && d.uri) : [])]
  .filter(Boolean).map((h) => String(h).toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, ''));

const policyEmails = (p) => (Array.isArray(p.include) ? p.include : [])
  .map((r) => r && r.email && r.email.email).filter(Boolean).map((e) => String(e).toLowerCase());

const commands = {
  // the API answered success: true (prints the API's errors otherwise)
  ok() {
    const r = stdinJson();
    if (r && r.success === true) return;
    const errs = (r && r.errors) || [];
    fail(errs.length ? errs.map((e) => (e.code ? e.code + ': ' : '') + e.message).join('\n') : JSON.stringify(r).slice(0, 500));
  },
  // the value at a dotted path (strings bare, anything else as JSON; nothing when missing)
  get([path]) {
    const v = at(stdinJson(), path || '');
    if (v === undefined || v === null) return;
    out(typeof v === 'string' ? v : JSON.stringify(v));
  },
  // the number of pages in a list answer (result_info.total_pages, 1 when absent)
  pages() {
    const info = stdinJson().result_info || {};
    out(Number(info.total_pages) > 1 ? Number(info.total_pages) : 1);
  },
  emails(lists) { out(emailList(...lists).join(',')); },
  // `wrangler whoami --json` -> one "id<TAB>name" line per account
  accounts() {
    const w = stdinJson();
    for (const a of (w && w.accounts) || []) out(a.id + '\t' + a.name);
  },
  // `wrangler d1 list --json` -> the uuid of the database with this name
  'd1-id'([name]) {
    const list = stdinJson();
    const db = (Array.isArray(list) ? list : (list.result || [])).find((d) => d && d.name === name);
    if (db) out(db.uuid || db.id);
  },
  // `wrangler secret list --format json` -> exit 0 when a secret of that name exists
  'has-secret'([name]) {
    let list = [];
    try { list = JSON.parse(readFileSync(0, 'utf8')); } catch (_) { process.exit(1); }
    process.exit(Array.isArray(list) && list.some((s) => s && s.name === name) ? 0 : 1);
  },
  // identity providers -> "ids=<comma list>" and "missing=<types>" for the wanted kinds (otp, google)
  idps([want]) {
    const list = stdinJson().result || [];
    const kinds = String(want || 'otp').split(',').map((s) => s.trim()).filter(Boolean);
    const types = { otp: ['onetimepin'], google: ['google', 'google-apps'] };
    const ids = [], missing = [];
    for (const k of kinds) {
      const hit = list.find((p) => (types[k] || [k]).includes(p.type));
      if (hit) ids.push(hit.id); else missing.push(k);
    }
    out('ids=' + ids.join(','));
    out('missing=' + missing.join(','));
    out('available=' + list.map((p) => p.type + ':' + (p.name || '')).join(','));
  },
  // Access organization -> the team name (<team>.cloudflareaccess.com)
  team() {
    const d = String(at(stdinJson(), 'result.auth_domain') || '');
    const m = d.match(/^([a-z0-9-]+)\.cloudflareaccess\.com$/i);
    if (m) out(m[1].toLowerCase());
  },
  // apps list -> the id of the self-hosted app that covers exactly this host
  'find-app'([host]) {
    const h = String(host).toLowerCase();
    const app = (stdinJson().result || []).find((a) => (a.type === 'self_hosted' || !a.type) && appHosts(a).includes(h));
    if (app) out(app.id);
  },
  // apps list -> any app on this host or under it with a path (to report, never to edit)
  'other-apps'([host]) {
    const h = String(host).toLowerCase();
    for (const a of stdinJson().result || []) {
      const hosts = appHosts(a);
      if (!hosts.includes(h) && hosts.some((x) => x === h || x.startsWith(h + '/'))) out(a.name + ' (' + hosts.join(' ') + ')');
    }
  },
  // one app -> "<policy id> <reusable|app>" for its first allow policy
  'allow-policy'() {
    const app = stdinJson().result || {};
    const p = (app.policies || []).find((x) => x && x.decision === 'allow');
    if (p) out(p.id + ' ' + (p.reusable === false ? 'app' : 'reusable'));
  },
  // policies list -> the id of the reusable policy with this name
  'find-policy'([name]) {
    const p = (stdinJson().result || []).find((x) => x && x.name === name);
    if (p) out(p.id);
  },
  'policy-emails'() { for (const e of policyEmails(stdinJson().result || {})) out(e); },
  // the allow policy body for these emails
  'policy-body'([name, emails, session]) {
    out(JSON.stringify({
      name,
      decision: 'allow',
      include: emailList(emails).map((email) => ({ email: { email } })),
      exclude: [],
      require: [],
      session_duration: session || '720h',
    }));
  },
  // an existing policy (stdin) with emails added or removed; every other rule kept
  'policy-edit'([op, emails]) {
    const p = stdinJson().result || {};
    const change = new Set(emailList(emails));
    let include = Array.isArray(p.include) ? p.include.slice() : [];
    if (op === 'add') {
      const have = new Set(policyEmails(p));
      for (const e of change) if (!have.has(e)) include.push({ email: { email: e } });
    } else if (op === 'remove') {
      include = include.filter((r) => !(r && r.email && change.has(String(r.email.email).toLowerCase())));
    } else if (op === 'set') {
      include = include.filter((r) => !(r && r.email)).concat([...change].map((email) => ({ email: { email } })));
    } else fail('policy-edit add|remove|set');
    if (!include.length) fail('refusing to leave the policy with nobody in it', 2);
    const body = { name: p.name, decision: p.decision || 'allow', include, exclude: p.exclude || [], require: p.require || [] };
    if (p.session_duration) body.session_duration = p.session_duration;
    if (p.precedence !== undefined && p.reusable === false) body.precedence = p.precedence;
    out(JSON.stringify(body));
  },
  // the self-hosted application body
  'app-body'([name, host, session, idps, policyId]) {
    const body = {
      name,
      type: 'self_hosted',
      domain: host,
      session_duration: session || '720h',
      app_launcher_visible: false,
      auto_redirect_to_identity: String(idps || '').split(',').filter(Boolean).length === 1,
      http_only_cookie_attribute: true,
      same_site_cookie_attribute: 'lax',
      enable_binding_cookie: false,
      options_preflight_bypass: false,
      policies: [{ id: policyId, precedence: 1 }],
    };
    const ids = String(idps || '').split(',').filter(Boolean);
    if (ids.length) body.allowed_idps = ids;
    out(JSON.stringify(body));
  },
  // workers custom domains list -> the Worker (service) serving this hostname
  'domain-service'([host]) {
    const d = (stdinJson().result || []).find((x) => x && String(x.hostname).toLowerCase() === String(host).toLowerCase());
    if (d) out(d.service || '?');
  },
  // zones list -> the zone id
  'zone-id'([name]) {
    const z = (stdinJson().result || []).find((x) => x && x.name === name);
    if (z) out(z.id);
  },
  // dns records list -> "TYPE content" lines for exactly this name
  'dns-records'([host]) {
    for (const r of stdinJson().result || []) if (String(r.name).toLowerCase() === String(host).toLowerCase()) out(r.type + ' ' + r.content);
  },
  // public DNS: addresses or CNAMEs for the host (empty when it does not resolve)
  async resolve([host]) {
    const found = [];
    for (const fn of ['resolveCname', 'resolve4', 'resolve6']) {
      try { (await dns[fn](host)).forEach((a) => found.push(a)); } catch (_) {}
    }
    if (found.length) out(found.join(' '));
  },
  // the JSON for `wrangler deploy --secrets-file` from the environment
  'secrets-json'(names) {
    const o = {};
    for (const n of names) {
      if (!process.env[n]) fail('missing ' + n, 2);
      o[n] = process.env[n];
    }
    out(JSON.stringify(o));
  },
  // wrangler.toml: set database_id and the custom-domain route; "changed" / "unchanged" ("--check": no write)
  'toml-set'([file, dbid, host, check]) {
    const before = readFileSync(file, 'utf8');
    let after = before;
    if (dbid) after = after.replace(/^(database_id\s*=\s*)"[^"]*"/m, '$1"' + dbid + '"');
    if (host) after = after.replace(/(\{\s*pattern\s*=\s*)"[^"]*"(\s*,\s*custom_domain\s*=\s*true\s*\})/, '$1"' + host + '"$2');
    if (dbid && !after.includes('database_id = "' + dbid + '"')) fail('could not set database_id in ' + file, 2);
    if (host && !after.includes('pattern = "' + host + '"')) fail('could not set the route in ' + file, 2);
    if (after !== before && check !== '--check') writeFileSync(file, after);
    out(after === before ? 'unchanged' : 'changed');
  },
  // wrangler.toml: the current database_id and route host
  'toml-get'([file, key]) {
    const t = readFileSync(file, 'utf8');
    const m = key === 'host' ? t.match(/\{\s*pattern\s*=\s*"([^"]*)"\s*,\s*custom_domain\s*=\s*true/) : t.match(/^database_id\s*=\s*"([^"]*)"/m);
    if (m) out(m[1]);
  },
  // a canned answer for B68_DRY_RUN (no network)
  dry([method, path, bodyFile]) {
    const p = String(path).split('?')[0];
    let body = {};
    try { if (bodyFile) body = JSON.parse(readFileSync(bodyFile, 'utf8')); } catch (_) {}
    let result = [];
    if (/\/access\/organizations$/.test(p)) result = { auth_domain: 'your-team.cloudflareaccess.com', name: 'your-team' };
    else if (/\/access\/identity_providers$/.test(p)) result = [{ id: 'dry-run-otp-idp', type: 'onetimepin', name: 'One-time PIN' }];
    else if (/\/zones$/.test(p)) result = [{ id: 'dry-run-zone-id', name: (String(path).match(/name=([^&]+)/) || [])[1] || 'zone' }];
    else if (method === 'POST' || method === 'PUT') result = { ...body, id: 'dry-run-' + (p.includes('/policies') ? 'policy' : 'app') + '-id', aud: 'dry-run-aud-tag' };
    else if (/\/access\/apps\/[^/]+$/.test(p)) result = { id: 'dry-run-app-id', aud: 'dry-run-aud-tag', policies: [{ id: 'dry-run-policy-id', decision: 'allow', reusable: true }] };
    else if (/\/access\/policies\/[^/]+$/.test(p)) result = { id: 'dry-run-policy-id', name: 'Blades 68 players (dry run)', decision: 'allow', reusable: true, session_duration: '720h', include: [{ email: { email: 'gm@example.com' } }], exclude: [], require: [] };
    out(JSON.stringify({ success: true, errors: [], messages: [], result, result_info: { total_pages: 1 } }));
  },
};

const fn = commands[cmd];
if (!fn) fail('usage: node scripts/lib/cf.mjs <' + Object.keys(commands).join('|') + '> ...', 64);
await fn(args);
