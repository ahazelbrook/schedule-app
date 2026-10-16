# Hosted build contract: a Cloudflare Worker + Access + D1

The page in `app/` is unchanged. It reaches storage, identity and downloads through
`window.claude.use(name)`. Inside the claude.ai artifact that object is provided by the
platform. In the hosted build `app/runtime/cf.js` defines it (only when it is missing) on
top of a small JSON API, with the data in a D1 database and sign-in handled by Cloudflare
Access in front of the whole host. One Cloudflare Worker (`blades68`) serves both the page
and the API on one custom domain, by default `https://blades.fieldguide.help`.

Ownership: **backend** owns `worker/`, `functions/`, `schema.sql`, `migrations/`,
`wrangler.toml`, `scripts/`, `checks/api/`; **adapter** owns `app/runtime/cf.js`, the one
`<script>` line in `app/index.html` that loads it before `boot.js`, and `checks/runtime/`.

## The Worker (`worker/`, `wrangler.toml`)

- **Static assets.** Every file in `app/` is served as it is by Cloudflare's asset server
  (`[assets] directory = "./app"`, binding `ASSETS`), except what `app/.assetsignore` leaves
  out (`app/checks/` and the `.md` files). `/index.html` answers a redirect to `/`, a path
  with no file a plain 404 (no single-page fallback: the app routes with `#` hashes).
- **Worker first** (`run_worker_first`) for `/api`, `/api/*`, `/` and `/index.html`; any path
  without a file also reaches the Worker, which hands it back to the asset server.
- **The API.** `worker/app.js` maps `/api/*` onto the handlers in `functions/api/` exactly as
  Pages Functions routed them (`me.js`, `members.js`, `export.js`, `campaign.js`,
  `characters/index.js`, `characters/[id].js`, and `[[path]].js` for every other path, a
  trailing slash allowed) and calls them with a Pages-style context (`request`, `env`,
  `params`, `data`, `next`, `waitUntil`, `passThroughOnException`, `functionPath`). The
  middleware `functions/api/_middleware.js` runs first for every API path, so an unknown path
  without a token is a 401, then a JSON 404. The handlers and `functions/_lib/` are unchanged.
- **The page.** `app/index.html` starts with `<title>`: inside the artifact the platform wraps
  it in its own document. The Worker answers `/` with
  `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width, initial-scale=1, viewport-fit=cover">`
  in front of the file (only for a `200` HTML answer; a `304` or redirect passes through, and
  the asset's `ETag` is kept since the same file always gets the same head). Without it a phone
  lays the page out 980 px wide in quirks mode. The service worker caches the page as served,
  so the offline copy has the same head. `cf.js` also adds the viewport meta when it is missing.
- **Headers.** The page: `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`,
  `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'` (only that: a
  fuller CSP would need care with the page's inline styles) and a `Permissions-Policy` that
  turns off camera, microphone, geolocation and payment. Every API answer: `Cache-Control:
  no-store`, `nosniff`, `Referrer-Policy: same-origin`, `X-B68-Build: <build>`. Other files keep
  the asset server's headers.
- **Only the custom domain.** `workers_dev = false` and `preview_urls = false`: a
  `*.workers.dev` address would skip Access (the API would still refuse it without a token,
  the page would not). The route is `{ pattern = "<host>", custom_domain = true }`; deploying
  creates the one proxied DNS record and certificate for that hostname and touches nothing else
  in the zone. `scripts/deploy.sh` refuses the zone apex and `www`.

## Identity

Cloudflare Access protects every path of the site (the page and `/api/*`). Access adds the
`Cf-Access-Jwt-Assertion` header (an RS256 JWT) to each request. The API verifies it against
the team's JWKS at `https://<ACCESS_TEAM>.cloudflareaccess.com/cdn-cgi/access/certs`
(cached in memory for an hour) and requires `aud` to contain `ACCESS_AUD`, `iss` to be
`https://<ACCESS_TEAM>.cloudflareaccess.com`, and `exp` in the future. Claims used: `email`
(the user id everywhere), `sub`, and `name` when present. A request with an invalid or
missing token is `401 {"error":"not signed in","reason":"..."}`. `reason` is a short fixed phrase from the token check (`no token`,
`expired`, `wrong audience`, `wrong issuer`, `unknown kid`, `bad signature`, `access not configured` when `ACCESS_TEAM` or
`ACCESS_AUD` is empty); it is never the token. The page shows it beside "Not signed in" (`B68Runtime.signedOutWhy`, set in
`app/runtime/cf.js`; when Access answered with its login page instead of JSON the page says so).

Roles: `gm` when the email is in `GM_EMAILS` (comma-separated, case-insensitive); `display`
when it is in `DISPLAY_EMAILS` (optional, the table iPad's own sign-in: it may only
`GET /api/me` and `GET /api/gm/display`, everything else is 403; GM wins if an email is in both;
GM.md); else `player`. Players read every character and write the ones they own (`doc.owner === email`)
plus new ones. GMs write and delete any.

Development: when the binding `DEV_USER` is set (an email) and there is no Access header,
that email is the user. Never set `DEV_USER` in production: `wrangler.toml` never names it
(`npm run dev` and the checks pass it with `--var`), `checks/api/worker.mjs` and
`scripts/deploy.sh` refuse a config that sets it, the deploy deletes a `DEV_USER` secret, and
the Worker drops it for any request whose `Host` is not `localhost`, `127.0.0.1` or `[::1]`
(`[dev] host = "localhost"` in `wrangler.toml` keeps that origin under `wrangler dev`), so a
stray binding in production still means "Access token required". Only while `DEV_USER` is set, a
request may name another user with an `X-Dev-User: <email>` header (the checks use it to act
as a player and as the GM against one server); without `DEV_USER` the header is ignored. A
request that carries an Access header is always verified, even with `DEV_USER` set.

Environment / bindings: `DB` (D1), `ASSETS` (the files in `app/`), the secrets `ACCESS_TEAM`,
`ACCESS_AUD`, `GM_EMAILS` (set by `scripts/deploy.sh`), `DEV_USER` (local only), and the var
`CAMPAIGN` (default `default`).

## Database (`schema.sql`, `migrations/`)

`schema.sql` is the whole schema as it stands; `migrations/` holds the same statements as
numbered D1 migrations (`0001_init.sql` to `0006_gm_ambient.sql`), applied with `npx wrangler d1 migrations apply DB
--remote` (the deploy script does it) or `npm run db:local`. A later change goes in a new
numbered file and in `schema.sql`; `checks/api/worker.mjs` fails when the two differ. The API
also creates the tables lazily, so a fresh database works either way.

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

- `GET /api/me` → `{ "id": email, "email", "name", "role": "gm" | "player" | "display", "campaign", "build" }`; `name` is the
  display name the person chose, else the one from the Access claim. `build` is the Worker's build stamp (`app/routes.js`
  `B68_BUILD`, bundled into the Worker by `functions/api/me.js`; `'dev'` outside a deploy), and every API answer carries it
  as the `X-B68-Build` header too, so a page left open learns that a deploy happened (see *Adapter*, `status.newBuild`).
- `PATCH /api/me` `{ "name" }` → the same shape: sets the caller's own display name (`members.name_override`, migration
  `0005_member_name.sql`; 1 to 40 characters, no control characters or `<` `>`; `""` or `null` clears it back to the
  Access-derived name). The sign-in upsert never touches the override, nobody can set another person's, and the
  `display` role is refused. In the page: `window.claude.profile.setName(name)`.
- `GET /api/characters` → `{ "now": ISO, "docs": [ { "id", "doc", "updatedAt", "deleted": false } ], "campaignUpdatedAt": ISO | null }`,
  every live character of the campaign, newest `updated_at` first, at most 500.
  `campaignUpdatedAt` is the stored campaign document's `updatedAt` (`null` when none), so a
  poller knows when to refetch `/api/campaign` without polling it too. `npcsUpdatedAt` does the same for `/api/npcs`
  (the newest change of any NPC row, `null` when none; CAST.md).
- `GET /api/characters?since=<ISO>` → same shape (with `campaignUpdatedAt`), every row (tombstones included, with
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
- `GET /api/campaign` → `{ "doc", "updatedAt" }`: the shared campaign document of this
  deployment (see CAMPAIGN.md; stored in `campaigns(id TEXT PRIMARY KEY, updated_at, doc)`,
  `id` = `CAMPAIGN`). While none is stored it answers the default document
  (`functions/_lib/campaign.js`, `defaultCampaign()`) and `"updatedAt": null`.
- `PUT /api/campaign` body = whole doc, GM only (a player gets `403 {"error":"only the GM can
  change that"}`) → `{ "doc", "updatedAt" }`. The first write creates the row.
- `PATCH /api/campaign` body = partial doc, the same deep merge as characters except for
  `log` → `{ "doc", "updatedAt" }`. `log` in a PATCH is a list of entries to add (an array of
  objects, else 400): an entry already stored (same `at` + `by` + `text`) is skipped, one with
  the same `at` + `by` but other text is a rewrite (403 for a player, ignored for the GM), the
  rest are added, the log is sorted by `at` newest first and trimmed to 200. So appends from a
  stale copy commute, and old entries change only through PUT. For a player the merged result
  is compared with the stored document (or the default one): anything under `crew` (the crew
  sheet is shared by the table; arrays there may change length) and `clocks.<i>.filled` with
  the same number of clocks are allowed. Any other change (`session`, adding/removing/renaming/
  resizing a clock, its kind or `hidden`, any other key) is
  `403 {"error":"only the GM can change that"}`. `updatedAt` in a body is ignored.
- Schedule (SCHEDULE.md): the document has a `schedule` key (`options`, `avail`, `next`, `rsvp`,
  `cadence`, `quorum`, and `attendance` once the GM records one; a stored document without it
  reads as the default one, and the player rule compares against that default, so a first
  write works). A player may additionally change their
  own answers: `schedule.avail.<id>` (the whole entry, set or deleted with `null`, or any key in
  it, including `note`) and `schedule.rsvp.<id>`, where `<id>` is their own id (lower-cased
  email). Another person's entry, `options`, `next`, `cadence`, `quorum`, `attendance` and any
  other key under `schedule` are `403 {"error":"only the GM can change that"}` for a player; the GM may change
  all of it. Per-person maps merge, so concurrent PATCHes from different people all land.
- In PUT and PATCH, `crew`, `session` and `schedule` must be plain objects when present (`null`
  included): otherwise `400 {"error":"crew must be an object"}` / `"session must be an object"` /
  `"schedule must be an object"`.
- For both campaign writes the server stamps `doc.updatedAt`, keeps the newest 200 `log`
  entries, refuses a document over 256 KiB with 413, and uses the same optimistic `updated_at`
  check and retries as characters (409 when it keeps changing). Other methods are 405.
- `GET /api/members` → `{ "members": [ { "id": email, "name", "role" } ] }`: everyone who has
  called `/api/me` (the API upserts a `members` table on each `/api/me`:
  `members(email PRIMARY KEY, name, role, last_seen, name_override)`; the `name` returned is `COALESCE(name_override, name)`),
  so the GM table can show names. The `display` role is never recorded.
- `GET /api/export` (GM only; a player gets `403 {"error":"only the GM can export"}`; other
  methods 405; the page's "Download everything" button, shown to the GM on the hosted build,
  fetches it through `B68Runtime.exportAll()` and saves it as it came; opening the address in a
  signed-in browser also works) → a backup of this deployment's campaign as a download:
  `{ "exportedAt": ISO, "campaign": { "id", "doc", "updatedAt" }, "characters": [ { "id", "doc",
  "updatedAt" } ], "npcs": [ { "id", "doc", "updatedAt" } ], "members": [ { "id", "name", "role" } ] }`. `campaign.doc` is the stored
  campaign document (the default one, `updatedAt` null, when none is stored); `characters` is
  every live character row of the campaign (not capped at 500, tombstones left out). The
  response carries `Content-Disposition: attachment; filename="blades68-<campaign>-<YYYY-MM-DD>.json"`
  and `Cache-Control: no-store`. The page's "Restore (JSON)" reads this file as well as its own
  "Download all" file (CAMPAIGN.md, *Backups*): the characters are filed as new documents and the
  campaign document is restored by the GM only, after a confirm, through
  `collection('campaign').doc('main').set()` (the `PUT` above).

- The rules wiki (RULES.md; table `rules(campaign, book, slug, title, trail, keys, body, ord, src, updated_at)`, primary key
  `(campaign, book, slug)`, `book` one of `b68`, `bitd`, `house`; `migrations/0002_rules.sql`). Never part of `/api/export`.
  - `GET /api/rules` (any signed-in member) -> `{ "version", "updatedAt", "count", "books": { b68, bitd, house }, "entries": [ {
    "book", "slug", "title", "trail", "keys", "body", "ord", "src", "updatedAt" } ] }`, every book, ordered by book then `ord`.
    `version` changes with every import, edit and delete; `GET /api/rules?v=<version>` answers `{ version, updatedAt, count,
    "unchanged": true }` without the entries while it still matches.
  - `POST /api/rules/import` (GM) body `{ "book": "b68" | "bitd", "entries": [ { "slug", "title", "trail", "keys"?, "body",
    "ord", "src" } ], "replace": true | false, "part"?: n, "of"?: n }` -> `{ ok, book, received, part, of, replaced, count,
    version }`. The first chunk with `replace` (no `part`, or `part` 1) deletes the book's rows in the same D1 `batch()` as its
    inserts; every other chunk adds (an entry with a slug already stored replaces it, so a chunk sent twice is harmless).
    Caps (`functions/_lib/rules.js`, `LIMITS`): 1 MiB of JSON per request, 40 entries per request (the Workers Free plan allows 50 D1 queries per request), 120 KiB of markdown per
    entry, 4000 entries and 8 MiB of text per book, title 200, trail / keys / src 600, slug `[a-z0-9][a-z0-9_-]{0,119}`; a
    malformed body is 400, a size over a cap 413, a player 403 (checked before the body is read). `house` is not importable.
  - `PUT /api/rules/house/:slug` (GM) body `{ title, body, trail?, keys?, ord? }` -> `{ entry, version }`; `DELETE` ->
    `{ ok, version }` (404 when missing). At most 300 house rules. A player gets 403 for both.
- `/api/npcs` and `/api/npcs/:id` (the cast, CAST.md): `GET` lists or reads NPC documents (the GM gets all, a player only the
  revealed ones without `gmNotes`); `POST` (a new id), `PUT`, `PATCH` and `DELETE` are GM only (403 for a player) and validate the
  document (400 / 413). Table `npcs(id, campaign, created_at, updated_at, deleted, doc)` (migration `0003_npcs.sql`, which also
  seeds seven hidden NPCs). The campaign document's `scene` (who is on stage) is GM only.

### GM tools (`/api/gm/*`, GM.md)

GM only, on every method of every `/api/gm/*` path: anyone else gets `403 {"error":"only the GM can use the GM tools"}`
before the body is read (no token: 401, as everywhere). Never part of `/api/export`. Full contract in GM.md.

- `GET /api/gm/pack` → the pack index `{ version, parts: { name: { version, src, updatedAt, bytes } } }` (`?v=` → `unchanged`);
  `GET ?part=name` → `{ part, version, src, updatedAt, body }` (`&v=` → `unchanged`, no body); `POST { part, src, body }` stores
  one part (name `[a-z0-9-]{1,32}`, body a JSON object ≤ 900 KiB, src ≤ 2 KiB, at most 12 parts; the same body and src again is
  `unchanged` and writes nothing); `DELETE ?part=name`. Table `gm_pack(campaign, part, version, src, updated_at, body)`, primary
  key `(campaign, part)`, `version` = 12 hex digits of SHA-256 of the body, `updated_at` in ms (migration `0004_gm.sql`).
- `GET /api/gm/state` → `{ doc, updatedAt }`; `PATCH` deep-merges (maps merge, null deletes, arrays replace; ≤ 256 KiB). Stored as
  the `campaigns` row `<CAMPAIGN>#gm`, which `/api/campaign` and `/api/export` never read.
- `GET /api/gm/display` → `{ seq, display, updatedAt }` (`?seq=N` → `{ seq, unchanged: true }`); `PUT { kind, title, caption,
  svg | npcId | text }` bumps `seq`. `kind` ∈ `blank | dark | svg | npc | text` (blank: the ambient scene plays; dark: lights out); the svg (≤ 600 KiB, starts `<svg`) is refused (400) with
  scripts, `foreignObject`, HTML elements (namespaced too), `<a>`, `xml:base`, `javascript:`, `on…=` attributes, backslashes in
  attribute values, `image-set()`/`src()`, any `url()` other than `#fragment`, or any `href`/`src` other than `#fragment` (a raster
  `data:image/` only on `<image>`/`<feImage>`); GM.md has the full list. Table `gm_display(campaign, seq, updated_at, doc)`.
  The GET also carries `ambient: { seq, doc, updatedAt }` (`&aseq=M` → `{ seq, unchanged: true }` while current).
- `GET /api/gm/ambient` → `{ seq, doc, updatedAt }`; `PATCH` merges the top level (null deletes, `skip: true` bumps a counter): mode,
  scene, playlist, intervalMin, crew heat/wanted, and the score scene (`board`/`iso` svgs through the same check as the display). GM only:
  the display sign-in reads it through the display. Table `gm_ambient(campaign, seq, updated_at, doc)` (migration `0006_gm_ambient.sql`).
- `GET /api/characters` carries nothing about the GM tools (the GM page refetches its state on focus instead).

## Lazy bundles (`app/routes.js`)

`index.html` loads only the core, which `routes.js` lists as `BUNDLES.core` (`checks/runtime/pwa.test.mjs`
keeps the two equal): the creator, the sheet, Home with its next-session card (`schedule.js`), the rules
wiki (every sheet draws its "?" links while it renders, and the Rules button shows when it is there), the
cast (its "on stage" banner shows on every screen during a scene), `runtime/cf.js`, `routes.js` and
`boot.js`. The other bundles load with their route: `table` and `print` (the same files: campaign.css,
crewsheet.css, season.css, campaign.js, crews.js, crewsheet.js, season.js, since the table's "Print the
season" button calls `B68Season` straight from campaign.js), `gm` (gm.css, prep.css, maps/map-kit.js,
gm/*.js, gm-page.js) and `display` (display.css, stt.js, display-page.js).

`window.B68Load.need(name)` appends the bundle's `<link>` and `<script>` tags once each and resolves when
every file has loaded; it rejects on the first that fails, and that file is forgotten so the next `need`
tries again. URLs are relative, exactly like the static tags, so the claude.ai artifact and the `file://`
checks resolve them unchanged; a stamped build adds `?v=<build>`. Scripts fetch in parallel and run in
the order `index.html` gave them (crewsheet.js registers itself with `B68Campaign` as it runs), and a
stylesheet goes in at its place in `CSS_ORDER` (index.html's old order, before the inline `<style>`), so
the cascade is the same whichever routes have opened. `B68Load.done(name)` says whether a bundle is in;
`B68Load.files()` lists every file of every bundle for `sw.js`. `boot.js`'s route starters (`startTable`,
`startPrint`, `startGm`, `startDisplay`; `openSchedule` waits for the table's) fetch their bundle on first
use, show "Loading …" in the route's panel (the reason there when it fails), and run again when it is in.
A viewer known not to be the GM still gets the GM pack purge (`gm-page.js` `purge`), for which the GM
bundle is fetched only when the browser holds the pack's IndexedDB database or the sticky copy.

`routes.js` also holds the build stamp, `B68_BUILD`: `'dev'` in the repository (`checks/api/worker.mjs`
refuses a committed stamp), stamped by `scripts/deploy.sh` for the upload as `<date>-<commit>` and put
back afterwards. The page, its bundle URLs, the service worker's cache name and `/api/me` all read it
from this one file. A page left open across a deploy keeps the files it has; a route opened for the
first time after the deploy fetches the new build's files, and the header's "Updated: reload" chip
(the `X-B68-Build` header against the page's build) says a reload is due.

Measured on cold loads against `wrangler dev` (a fresh browser, the service worker blocked so only the
page's own requests count; decoded bytes of JS + CSS, gzip estimate in brackets): before, every route
fetched 39 files, 2.54 MB (707 kB); now Home and a sheet fetch 19 files, 1.48 MB (398 kB), the table 26
files, 1.71 MB (463 kB), the GM page 30 files, 2.21 MB (612 kB). On the first visit after a deploy the
service worker still precaches everything in the background, after the page is up.

## Adapter (`app/runtime/cf.js`)

Loaded before `routes.js` and `boot.js`. If `window.claude` already exists it does nothing. Otherwise:

```js
window.claude = { use: function (name) { /* -> Promise */ } };
```

- `use('user')`: calls `/api/me` once; on 401 (or a redirect / non-JSON answer: Access asking to
  sign in) resolves `null` (the page then shows "not signed in · filing unavailable"). On a
  network failure it also resolves `null`, unless this browser holds a snapshot of the last
  signed-in user: then the page starts offline as that user (see *Offline* below).
  Otherwise resolves an object with `id()`, `me()` (`{ id, name, email }`), `can(name)` (`true` for `data.write`), `isOwner()` and `canEdit()`
  (`role === 'gm'`), `profiles(ids)` (from `/api/members`, cached: `{ [id]: { name } }`).
- `use('db')`: `null` when `use('user')` is. Otherwise `{ collection(name) }` for
  `characters` and `campaign`. `collection().doc(id)` → `{ id, get(), set(doc), update(patch), delete(),
  onSnapshot(cb, err) }`; `collection().orderBy(field, dir).limit(n).where(f, op, v)` chain
  (applied client-side on the cache) with `onSnapshot(cb, err)` and `get()`.
  Snapshots: a document snapshot is `{ id, exists, data() }`; a query snapshot is
  `{ docs: [documentSnapshot] }`. `onSnapshot` returns an unsubscribe function and fires
  once with the current cache as soon as the first full load has happened.
- `collection('campaign').doc('main')` → `{ id, get(), set(doc) (PUT), update(patch) (PATCH),
  onSnapshot(cb, err) }`. Its snapshot is always `{ id: 'main', exists: true, data() }` (the
  default document while none is stored). The cached copy is refetched (`GET /api/campaign`)
  when a poll's `campaignUpdatedAt` differs from the cached `updatedAt`; own writes merge
  optimistically with the server's rule (deep merge, log entries added and deduplicated,
  newest `at` first, at most 200) and then take the server's answer; a
  rejected write (e.g. 403) refetches, which rolls the optimistic change back. Campaign
  listeners hear only campaign changes (first snapshot once loaded, then only when the document
  actually changed), character listeners only character changes. Any other `campaign` doc id
  never exists and refuses writes; `collection('campaign')` queries are always empty.
- `collection('npcs')` is the characters collection's interface (`doc(id)` with `get / set / update / delete / onSnapshot`, and the
  `where / orderBy / limit` chain over the cache), for the cast (CAST.md). It is cached beside the characters and refetched
  (`GET /api/npcs`, the whole list) only when a poll's `npcsUpdatedAt` differs from the cached stamp, and only while someone listens.
  Writes use the same queue; a player's write is refused at once (403) without a request.
- One poller feeds every listener (characters, campaign and npcs; it runs while any exists): a full `GET /api/characters` at start, then
  `?since=` every 4 s while the page is visible and every 20 s when hidden, plus an
  immediate poll after each own write; a write also updates the cache optimistically so the
  sheet never waits on the network. Network errors are retried on the next tick and surfaced
  once through the `err` callbacks (not after an offline start, which the header shows). A request
  with no answer in 15 s (a read) or 25 s (a write) is abandoned (`AbortController`) and counts as a
  network error (`network: true`, `timeout: true`, "no answer from the server in 15 s"), so a
  connection that is up but dead never holds the poller or the write queue: the status goes offline,
  the next tick polls again, and a stalled write is retried like any other network failure.
- `use('downloads')`: `{ save({ filename, data }) }` → Blob + anchor click, resolves.
- Anything else resolves `null`.
- `window.claude.rules` (hosted build only; `list`, `import`, `saveHouse`, `deleteHouse`, see `app/CONTRACT.md`): plain calls
  on the rules API above.
- `window.claude.gm` (hosted build only; `pack`, `packPart`, `importPart`, `removePart`, `state`, `patchState`, `display`,
  `setDisplay`, see GM.md): plain calls on the GM API above. Never queued, never in the offline snapshot or localStorage.
- `window.B68Runtime = { kind: 'cloudflare', me, status, exportAll }` once `/api/me` has answered (or the
  page started offline). `exportAll()` → Promise of the `GET /api/export` answer (rejects with
  the API's error, `status` 403 for a player); boot.js shows "Download everything" only when it
  exists and the viewer is the GM. `status = { online, pending, lastSync, newBuild }`: `online` is false while the
  network is unreachable or after an offline start until `/api/me` answers again, `pending` is
  the number of queued writes, `lastSync` the ISO time of the last successful poll or flushed
  write (after an offline start, the snapshot's), `newBuild` the server's build when it differs
  from this page's (`window.B68_BUILD` from `routes.js` against the `X-B68-Build` header of any
  API answer, or `/api/me`'s `build`; `null` while they agree or either is unknown). Every change dispatches the `window` event
  `b68:runtime` (`detail` = the status); `boot.js` `whoami()` turns it into "Offline · N changes
  waiting" / "Saving N changes…" after "Signed in as …", and into an "Updated: reload" chip
  (a reload) when `newBuild` is set.

### Offline (hosted build only)

- **Snapshot.** After each successful load or poll (throttled to one write every 2 s, and on
  `pagehide` / hidden) the adapter stores `{ me, syncedAt, docs, stamps, campaign: { doc,
  updatedAt }, members }` in localStorage under `b68.cf.<email>#<campaign>`, and
  `b68.cf.last = { key, id }` names the last signed-in user. Every storage access is wrapped:
  with storage blocked or full the page works as before, only without offline start.
- **Offline start.** When `/api/me` fails with a network error (fetch rejected) and the last
  user's snapshot exists, `use('user')` resolves that user, `use('db')` serves the snapshot
  (listeners fire with it at once, `metadata.fromCache` true, `get()`s answer from it), and
  the poller asks `/api/me` again each tick and on `online` events. When it answers: a
  different account or signed out ends the session as a sign-out does (one `err`, polling
  stops, writes reject); the same user gets a full load, a campaign refetch, and listeners are
  notified. A 401 or redirect at start never starts offline.
- **Write queue.** Every write (`set`, `update`, `delete`, campaign `set`/`update`) applies to
  the cache at once and is appended to `b68.cf.<email>#<campaign>#queue` (`{ qid, kind, id,
  method, path, body }`), then sent in order, one at a time. Its promise resolves when the
  server accepts it, or as soon as it is queued while offline, and rejects when the server
  refuses it while the caller still waits (the old behaviour). A network error, a 5xx, or a
  409 after the two retries keeps it and everything after it, retried on the next poll, on
  `online`, every poll interval, and at the next start (queued writes are re-applied to the
  restored cache; all of them are idempotent). A 400/403/404/413 for an already-resolved
  queued write drops it, resyncs (full load, or campaign refetch) and reports one error
  (`code: 'dropped'`) through the `err` callbacks; the rest go on. A 401 or redirect stops
  flushing and keeps the queue for that user's next visit; a write made after that is still
  queued (kept for the same user's next visit, never sent or seen by another account on the
  browser) and its promise rejects with the signed-out message, so the page tells the person to
  reload and sign in rather than report a save that has not happened. Snapshots carry
  `metadata.hasPendingWrites: true` while a queued write for that document exists.
- **Folding.** A PATCH right behind a PATCH to the same document (not yet being sent, created by
  this tab) is merged into it only when one merged PATCH is provably the same as the two in a
  row under the server's merge for any stored document: anything at the top level except an
  object over a non-object, and below it no `null` and no object over a non-object; campaign
  `log` lists concatenate; campaign patches fold for the GM only (a player's are checked field
  by field, so one refused change would sink both). Otherwise they stay separate, in order.
- **Several tabs** of one user share the stored queue: a tab claims an entry in storage before
  sending it (30 s claim), removes it when answered, skips entries another tab has claimed,
  and forgets entries another tab finished.

### Installable (hosted build only)

On activation `cf.js` adds `<link rel="manifest" href="manifest.webmanifest"
crossorigin="use-credentials">` (Access needs the cookie for the manifest too), `<meta
name="theme-color" content="#14110e">`, `<link rel="icon">` and `<link rel="apple-touch-icon">`
(`icons/`), the `apple-mobile-web-app-*` / `mobile-web-app-capable` metas, and registers
`sw.js` with scope `./` after `load`. `index.html` is unchanged, and inside the artifact (or
from `file://`) none of this happens. Icons: Stacey's silhouette mugshot from the figure kit,
in ink on an alarm-red halo on paper with "68", regenerated by `npm run icons`
(`checks/runtime/icons.mjs`, Playwright); the maskable one keeps the mark inside the 80% safe
circle.

`app/sw.js` (cache `b68-shell-<build>`: it `importScripts('routes.js')` and names the cache after `B68_BUILD`, so
every deploy drops the previous cache on activation, and the changed import is what makes the browser install the new
worker; `cf.js` registers it with `updateViaCache: 'none'` so that import is fetched fresh on each update check. A
deploy that skips the stamp, a plain `npx wrangler deploy`, keeps `b68-shell-dev`: still network first, so pages get the
new files, but the cache is not renewed in one go):

- Ignores (does not intercept) non-GET requests, other origins, `/api/*`, `/cdn-cgi/*` and `/media/*`.
- Every other request is network first: the network's answer is returned as it is (a redirect
  from Access included) and, when it is `200`, same-origin (`basic`) and not redirected,
  stored. When fetch itself fails the cached copy answers at once; a navigation falls back
  to the cached page. When the cache holds the file and the network has not answered within
  4 s (a navigation) or 8 s (anything else: a venue's wifi that is up but dead), the cached
  copy answers and the network's answer, when it comes, still refreshes the cache for next
  time; a file the cache lacks waits for the network however long it takes. The page is stored
  under the scope URL (`/`), whether it was asked for as `/`, `/index.html` or `/?…`; any other
  file under its path alone, so `boot.js?v=<build>` finds the precached `boot.js`.
- Install precaches the app shell (`SHELL`: the page, its fonts, the manifest and icons, then every
  file of every bundle in `routes.js`, the core first, so each route still works offline;
  `checks/runtime/pwa.test.mjs` fails when `index.html` or a bundle names a file the list lacks), one
  file at a time so a failure does not stop the install, then `skipWaiting`; activate deletes older
  `b68-shell-*` caches and `clients.claim`s. A worker that cannot import `routes.js` fails to install,
  and the previous one keeps serving its complete cache.

Checks: `npm run check:runtime` runs the adapter's unit test (mocked fetch and localStorage, offline
cases included) and `checks/runtime/pwa.test.mjs` (manifest, icons, precache list, the
service worker's rules in a fake worker scope). `npm run check:offline` starts its own
`wrangler dev` on port 8790 and drives Chromium through install, offline reload (the cached
page keeps the Worker's doctype: standards mode online and offline), an offline tick and its
sync on reconnect. `npm run check:phone` opens the page in a 390 x 844 mobile Chromium
(`isMobile`) on its own server (port 8792) and asserts `innerWidth` 390, standards mode, one
viewport meta and no horizontal overflow.

## Local development and checks

```
npm install            # wrangler (a dependency in package.json at the repository root)
npm run db:local       # = npx wrangler d1 migrations apply DB --local (optional)
npm run dev            # = npx wrangler dev --port 8788 --ip 127.0.0.1 --var DEV_USER:gm@example.test --var GM_EMAILS:gm@example.test
npm run build          # = npx wrangler deploy --dry-run --outdir .wrangler/dist (bundles, uploads nothing)
npm test               # = npm run check:runtime && npm run check:api (no browser)
npm run check:api      # checks/api/jwt.mjs, worker.mjs, flow.mjs (own servers on 8788 and 8789), then rules.mjs (8794), npcs.mjs (8841), gm.mjs (8843)
npm run check:gm-api   # checks/api/gm.mjs alone: the GM tools' API (own server on 8843)
npm run check:runtime  # checks/runtime/adapter.test.mjs, pwa.test.mjs and markdown.test.mjs (plain node)
npm run check:offline  # checks/runtime/offline.e2e.mjs (own server on 8790, Chromium)
npm run check:schedule # checks/runtime/schedule.e2e.mjs (own server on 8791, Chromium)
npm run check:phone    # checks/runtime/phone.e2e.mjs (own server on 8792, mobile Chromium)
npm run check:rules    # checks/runtime/rules.e2e.mjs (own server on 8795, Chromium): the rules wiki, see RULES.md
npm run check:e2e      # app/checks/e2e.js against the stubbed runtime
```

The Chromium checks need `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (and Playwright at
`/opt/node-tools/node_modules/playwright`, or `PW_MODULE`).

`npm run dev` takes the D1 binding from `wrangler.toml` and keeps its local data in
`.wrangler/state`, the same local database that `db:local` writes; the API creates its tables
on first use either way. Each check starts its own `wrangler dev` with a throwaway
`--persist-to` directory and stops only the process group it started.

`checks/api/` holds a node script that drives the local server with `fetch` through the
whole flow (me, create, list, since, patch, delete, player vs gm permissions, bad token), a
JWT verification test with a generated RSA key, and `worker.mjs`: the router against the
Pages file layout, the DEV_USER guard, the page head and headers, and the deploy config
(assets, `run_worker_first`, `workers_dev = false`, no secrets or DEV_USER in
`wrangler.toml`, migrations equal to `schema.sql`); `name.mjs` and `display-role.mjs` cover the display name and the display
role, `gm.mjs` the GM-only API. `checks/runtime/` holds the adapter's unit
test with a mocked `fetch`, the PWA test, the offline and schedule end-to-end runs and the
icon builder. `app/checks/e2e.js` runs against `npm run dev` with
`E2E_URL=http://127.0.0.1:8788` (no `window.claude` stub then) for the real end-to-end run.
