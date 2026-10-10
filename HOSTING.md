# Hosted build contract: Cloudflare Pages + Access + D1

The page in `app/` is unchanged. It reaches storage, identity and downloads through
`window.claude.use(name)`. Inside the claude.ai artifact that object is provided by the
platform. In the hosted build `app/runtime/cf.js` defines it (only when it is missing) on
top of a small JSON API served by Cloudflare Pages Functions in `functions/`, with the data
in a D1 database and sign-in handled by Cloudflare Access in front of the whole site.

Ownership this round: **backend** owns `functions/`, `schema.sql`, `wrangler.toml`,
`checks/api/`; **adapter** owns `app/runtime/cf.js`, the one `<script>` line in
`app/index.html` that loads it before `boot.js`, and `checks/runtime/`. Nobody edits the
other `app/*.js` files.

## Identity

Cloudflare Access protects every path of the site (the page and `/api/*`). Access adds the
`Cf-Access-Jwt-Assertion` header (an RS256 JWT) to each request. The API verifies it against
the team's JWKS at `https://<ACCESS_TEAM>.cloudflareaccess.com/cdn-cgi/access/certs`
(cached in memory for an hour) and requires `aud` to contain `ACCESS_AUD`, `iss` to be
`https://<ACCESS_TEAM>.cloudflareaccess.com`, and `exp` in the future. Claims used: `email`
(the user id everywhere), `sub`, and `name` when present. A request with an invalid or
missing token is `401 {"error":"not signed in"}`.

Roles: `gm` when the email is in `GM_EMAILS` (comma-separated, case-insensitive), else
`player`. Players read every character and write the ones they own (`doc.owner === email`)
plus new ones. GMs write and delete any.

Development: when the binding `DEV_USER` is set (an email) and there is no Access header,
that email is the user. Never set `DEV_USER` in production. Only while `DEV_USER` is set, a
request may name another user with an `X-Dev-User: <email>` header (the checks use it to act
as a player and as the GM against one server); without `DEV_USER` the header is ignored. A
request that carries an Access header is always verified, even with `DEV_USER` set.

Environment / bindings: `DB` (D1), `ACCESS_TEAM`, `ACCESS_AUD`, `GM_EMAILS`, `DEV_USER`
(dev only), `CAMPAIGN` (default `default`).

## Database (`schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  campaign TEXT NOT NULL DEFAULT 'default',
  owner TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS characters_campaign_updated ON characters (campaign, updated_at);
```

`doc` is the character document JSON exactly as the page writes it (`v: 2`, `sheet`,
`play`, `owner`, `createdAt`, `updatedAt`). `owner`, `created_at`, `updated_at` are mirrored
from it for queries. A delete keeps the row as a tombstone (`deleted = 1`, `doc = '{}'`,
`updated_at = now`) so pollers learn about it.

## API (all JSON; errors are `{ "error": "message" }` with 400 / 401 / 403 / 404)

- `GET /api/me` → `{ "id": email, "email", "name", "role": "gm" | "player", "campaign" }`
- `GET /api/characters` → `{ "now": ISO, "docs": [ { "id", "doc", "updatedAt", "deleted": false } ] }`,
  every live character of the campaign, newest `updated_at` first, at most 500.
- `GET /api/characters?since=<ISO>` → same shape, every row (tombstones included, with
  `"deleted": true` and `"doc": null`) whose `updated_at > since`. `now` is the server time to
  use as the next `since`; it is reported 2 s behind the clock so a write committed during a
  poll is never missed, which means a recent row can arrive in two consecutive polls (apply
  rows idempotently). A `since` that does not parse as a date is 400.
- `GET /api/characters/:id` → `{ "id", "doc" }`; 404 when missing or deleted.
- `PUT /api/characters/:id` body = whole doc → create or replace. The server stamps
  `doc.updatedAt = now`; on create it stamps `doc.createdAt` if missing and forces
  `doc.owner = me.id` when the caller is a player; on replace a player must own the existing
  row and the stored `owner` is kept. Returns `{ "id", "doc" }`.
- `PATCH /api/characters/:id` body = partial doc → deep merge into the stored doc (plain
  objects merge recursively, arrays and scalars replace, `null` deletes the key), same
  permission rule, same stamping. Returns `{ "id", "doc" }`.
- `DELETE /api/characters/:id` → tombstone. Returns `{ "ok": true }`.
- Ids: `[A-Za-z0-9_-]{1,80}`. Bodies over 256 KiB are refused with 413.
- Writes are read-modify-write with an optimistic check on `updated_at`, retried a few times,
  so concurrent PATCHes to different fields all land; if a row keeps changing the API answers
  `409 {"error": ...}` and the client should retry. Other methods are 405; unknown `/api/*`
  paths are a JSON 404. Every API response carries `Cache-Control: no-store`.
- `GET /api/members` → `{ "members": [ { "id": email, "name", "role" } ] }`: everyone who has
  called `/api/me` (the API upserts a `members` table on each `/api/me`:
  `members(email PRIMARY KEY, name, role, last_seen)`), so the GM table can show names.

## Adapter (`app/runtime/cf.js`)

Loaded before `boot.js`. If `window.claude` already exists it does nothing. Otherwise:

```js
window.claude = { use: function (name) { /* -> Promise */ } };
```

- `use('user')`: calls `/api/me` once; on 401 or network failure resolves `null` (the page
  then shows "not signed in · filing unavailable"). Resolves an object with `id()`, `me()`
  (`{ id, name, email }`), `can(name)` (`true` for `data.write`), `isOwner()` and `canEdit()`
  (`role === 'gm'`), `profiles(ids)` (from `/api/members`, cached: `{ [id]: { name } }`).
- `use('db')`: `null` when `/api/me` failed. Otherwise `{ collection(name) }` for
  `characters` only. `collection().doc(id)` → `{ id, get(), set(doc), update(patch), delete(),
  onSnapshot(cb, err) }`; `collection().orderBy(field, dir).limit(n).where(f, op, v)` chain
  (applied client-side on the cache) with `onSnapshot(cb, err)` and `get()`.
  Snapshots: a document snapshot is `{ id, exists, data() }`; a query snapshot is
  `{ docs: [documentSnapshot] }`. `onSnapshot` returns an unsubscribe function and fires
  once with the current cache as soon as the first full load has happened.
- One poller feeds every listener: a full `GET /api/characters` at start, then
  `?since=` every 4 s while the page is visible and every 20 s when hidden, plus an
  immediate poll after each own write; a write also updates the cache optimistically so the
  sheet never waits on the network. Network errors are retried on the next tick and surfaced
  once through the `err` callbacks.
- `use('downloads')`: `{ save({ filename, data }) }` → Blob + anchor click, resolves.
- Anything else resolves `null`.
- `window.B68Runtime = { kind: 'cloudflare', me }` once `/api/me` has answered, for debugging.

## Local development and checks

```
npm install            # wrangler (devDependency at the repository root)
npm run db:local       # = npx wrangler d1 execute DB --local --file schema.sql (optional)
npm run dev            # = npx wrangler pages dev app --binding DEV_USER=gm@example.test --binding GM_EMAILS=gm@example.test --port 8788
npm run check:api      # checks/api/jwt.mjs, then checks/api/flow.mjs (starts its own servers)
```

`npm run dev` takes the D1 binding from `wrangler.toml`, so it shares the local database
that `db:local` writes. Adding `--d1 DB` also works but gives a separate, empty local
database; the API creates its tables on first use either way.

`checks/api/` holds a node script that drives the local server with `fetch` through the
whole flow (me, create, list, since, patch, delete, player vs gm permissions, bad token) and
a JWT verification test with a generated RSA key. `checks/runtime/` holds the adapter's unit
test with a mocked `fetch`, and `app/checks/e2e.js` can be pointed at
`http://127.0.0.1:8788` with the `window.claude` stub disabled for the real end-to-end run.
