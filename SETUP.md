# Setting up the hosted app on Cloudflare

About 20 minutes, free plan throughout. At the end the app lives at
`https://blades.fieldguide.help`, only the people on your list can open it, and they sign in
with a code sent to their email (Cloudflare Access "one-time PIN"; Google can be added later).
The rest of `fieldguide.help` (the apex, `www` and every other record) is not touched: the
deploy adds one Worker custom domain for `blades.fieldguide.help` and nothing else.

What runs: one Cloudflare Worker, `blades68`, that serves the page in `app/` and the API in
`functions/` (see `HOSTING.md`), a D1 database `blades68`, and a Cloudflare Access application
in front of the host.

`DEPLOY-PROMPT.md` is the same procedure written as a prompt for a Claude session on your own
computer, which can run the commands and click through the dashboard with you.

You need: the Cloudflare account that holds `fieldguide.help`, Node.js 20 or newer, and this
repository (`ahazelbrook/schedule-app` on GitHub, cloned to your computer).

## 1. Install and sign in

```
cd schedule-app
npm install
npx wrangler login        # a browser window opens: sign in to Cloudflare and allow access
```

That sign-in covers the database, the Worker, its secrets and its custom domain. It does not
cover Cloudflare Access, which step 3 sets up in the dashboard (or the script does it, with an
API token: see *Deploying with an API token* below).

## 2. Run the deploy script

```
B68_GM_EMAILS=you@example.com \
B68_PLAYER_EMAILS=player1@example.com,player2@example.com \
scripts/deploy.sh
```

It checks the inputs and the Worker (`checks/api/worker.mjs`), refuses the apex and `www`,
checks that `blades.fieldguide.help` is not already in use, creates the D1 database `blades68`
when it is missing and writes its id (and the host) into `wrangler.toml`, and applies the
migrations. Then it stops at Access and prints the dashboard steps of step 3, with your emails
filled in. Nothing is served at the address until Access protects it.

Settings, all optional except the GM: `B68_HOST` (another subdomain; default
`blades.fieldguide.help`), `B68_IDPS` (`otp`, or `otp,google` once Google is set up),
`B68_SESSION` (default `720h`, 30 days), `CLOUDFLARE_ACCOUNT_ID` (when your login sees more
than one account), `B68_DRY_RUN=1` (print every change and API call, make none). The script
is safe to run again at any time. `scripts/deploy.sh --help` lists everything.

## 3. Cloudflare Access (dashboard)

1. Open <https://one.dash.cloudflare.com> and pick the account that holds `fieldguide.help`.
   The first time, Zero Trust asks for a **team name** (it becomes
   `<team>.cloudflareaccess.com`) and a plan: choose **Free** (up to 50 users).
2. **Settings → Authentication → Login methods** (newer dashboards: **Integrations → Identity
   providers**): **One-time PIN** should be listed. If not: **Add new → One-time PIN → Save**.
3. **Access → Applications → Add an application → Self-hosted**.
   - Application name: `Blades 68`
   - Session duration: **1 month**
   - Public hostname: subdomain `blades`, domain `fieldguide.help`, path empty (so the page
     and `/api/*` are both covered)
4. Policy (on the same page, or **Access → Policies → Add a policy** and then select it):
   name `Blades 68 players (blades.fieldguide.help)`, action **Allow**, include **Emails**:
   your address and each player's.
5. Login methods: untick **Accept all available identity providers**, tick **One-time PIN**
   only, and turn on **Instant Auth** so people go straight to the email-code page. **Save**.
6. Open the application again and copy its **Application Audience (AUD) Tag**.
7. The team name: **Settings → Custom Pages** (or **Settings → General**) shows the team
   domain; the team name is the part before `.cloudflareaccess.com`.

Then finish the deploy:

```
B68_ACCESS_TEAM=<team> B68_ACCESS_AUD=<aud tag> \
B68_GM_EMAILS=you@example.com B68_PLAYER_EMAILS=player1@example.com,player2@example.com \
scripts/deploy.sh --finish
```

(Run from a terminal without those two variables, the script also asks for them.) It checks
that the team exists, deletes a `DEV_USER` secret if one was ever set, uploads the Worker
with its secrets `ACCESS_TEAM`, `ACCESS_AUD` and `GM_EMAILS`, attaches
`blades.fieldguide.help`, and then checks from outside that `https://blades.fieldguide.help/`
and `/api/me` both send a signed-out visitor to the Access login. The first deploy can take a
minute or two while the certificate is issued; the script waits.

Commit `wrangler.toml` afterwards: it now names your database and host.

## 4. Check it

1. Open `https://blades.fieldguide.help`. The Access page asks for an email; enter yours and
   type the code it sends.
2. The app opens. The header says **Signed in as … · GM** for an address in `B68_GM_EMAILS`,
   and the table page (`#t`) shows the GM controls (start session, the schedule's confirm,
   **Download everything**).
3. A player's address shows **Signed in as …** without GM, and an address not on the list is
   refused by Access before it reaches the app.

## 5. Move the characters and the table across

1. Open the claude.ai artifact as its owner (the GM there), choose **Everyone**, and press
   **Download all (JSON)**. The file holds the characters and the table page (crew sheet,
   shared clocks, campaign log, session, schedule).
2. Open the new app, sign in as a GM (an address in `GM_EMAILS`), and press **Restore (JSON)**
   with that file. It asks before replacing the table; **OK** replaces it, **Cancel** restores
   the characters only.

Restored characters get new ids and are owned by whoever restores them. If players should
own their own characters, have each player restore their own file instead, or the GM can
keep them all (the GM can edit every character either way). A player's restore files their
characters and leaves the table alone: only the GM can restore the table. The availability and
RSVP answers in the schedule come across under the ids the artifact gave people, which are not
the email addresses the hosted app uses, so ask everyone to mark their dates again.

## 6. Adding and removing players

With the dashboard: **Zero Trust → Access → Applications → Blades 68 → Configure** (or **Access
→ Policies → Blades 68 players (…)**) → edit the **Emails** list → **Save**. A removed player
is signed out at their next request. Their characters stay.

With an API token (see below):

```
scripts/access-emails.sh list
scripts/access-emails.sh add newplayer@example.com
scripts/access-emails.sh remove oldplayer@example.com
```

GMs are the addresses in the Worker secret `GM_EMAILS`. To change them (this works with
`npx wrangler login`; with a token it also adds them to the Access list):

```
scripts/access-emails.sh gms you@example.com,co-gm@example.com
```

Roles follow at once; nobody signs in again.

## 7. Backups

- In the app: **Download all (JSON)** after each session. It holds the characters in the
  current filter (choose **Everyone** for all of them) and the table page's campaign document.
  A player's copy leaves out the clocks hidden from players.
- The GM also has **Download everything** next to it (hosted app only): the server's own
  export, `/api/export`, with every character (not only the newest 60 the files list shows),
  the campaign document and the member list.
- **Restore (JSON)** reads both files. Characters are filed as new copies (nothing is
  overwritten), by anyone who can write. The table is restored only by the GM and only after
  a confirm, and it replaces the whole table page as it is now.
- D1 keeps point-in-time history (**Time Travel**): 7 days on the free plan, 30 days on
  Workers Paid, so a bad edit can be rolled back within that window:

  ```
  npx wrangler d1 time-travel info blades68                       # the current bookmark
  npx wrangler d1 time-travel restore blades68 --timestamp=2026-10-11T19:00:00Z
  ```

  A restore replaces the whole database (characters and the table) as it was then. That
  window is why the download after each session still matters.
- A full SQL copy of the database at any time:
  `npx wrangler d1 export blades68 --remote --output blades68-backup.sql`.

## Updating the app

After pulling changes: `npx wrangler deploy` (or run `scripts/deploy.sh` again, which also
applies new migrations). The secrets stay as they are. Phones pick up the new version the next
time they open the app online.

## "Not signed in" on a device that has passed Access

The home screen's header says **Not signed in (reason)** when `/api/me` refuses a request Access let through. The reason is the
server's (`HOSTING.md`, Access section). What each one means:

| Reason | Meaning and fix |
|---|---|
| `access not configured` | `ACCESS_TEAM` or `ACCESS_AUD` is empty on the Worker, so every sign-in fails. `npx wrangler secret list` shows the names but not whether a value is blank. Re-set both: `ACCESS_TEAM` is the team name (the host `<team>.cloudflareaccess.com` in the Access login redirect) and `ACCESS_AUD` is the application's AUD tag (the `kid` in that same redirect, or Access > Applications > the app > Overview). Each `npx wrangler secret put` takes effect at once; no deploy. |
| `wrong audience` | The AUD secret is for a different Access application (an app re-created, or a second app for the host). Re-set `ACCESS_AUD`. |
| `wrong issuer` or `unknown kid` | `ACCESS_TEAM` is wrong. |
| `expired` | The Access session ended; Sign in starts again. |
| `no token` | Access let the request through without a token (a Bypass policy, or a path the application does not cover). |
| `Access answered with its sign-in page` | The browser holds no valid Access session. Sign in. |

**Sign in** on that header goes to `/cdn-cgi/access/logout?returnTo=<this site>`, which clears Access's cookie and comes back, so
Access asks again from scratch (a plain reload cannot fix a session Access has kept but the server will not accept).

## Adding Google sign-in later

1. **Zero Trust → Settings → Authentication → Login methods → Add new → Google**, and follow
   the on-screen steps (an OAuth client in Google Cloud Console; paste its client ID and
   secret).
2. **Access → Applications → Blades 68 → Configure → Login methods**: tick **Google** as well
   as One-time PIN, and turn **Instant Auth** off so people can choose. Save.

With a token, `B68_IDPS=otp,google scripts/deploy.sh` does step 2. The app needs no change:
it only reads the email that Access vouches for.

## Another host

Pick another subdomain of a zone in the account: `B68_HOST=games.fieldguide.help
scripts/deploy.sh` rewrites the route in `wrangler.toml`, and the Access application must cover
the new host (with a token the script creates one; in the dashboard, add a new application for
it as in step 3). The old custom domain stays attached until you remove it under **Workers &
Pages → blades68 → Settings → Domains & Routes**.

## Deploying with an API token (optional)

With a token, the script also creates or updates the Access application and its allow policy
itself, finds the team name and the AUD tag, and checks DNS through the API. Create it at
**My Profile → API Tokens → Create Token → Create Custom Token**:

| Scope | Permission | Why |
|---|---|---|
| Account | Workers Scripts: Edit | upload the Worker and its secrets |
| Account | D1: Edit | create the database, apply migrations |
| Account | Access: Apps and Policies: Edit | the Access application and its allow policy |
| Account | Access: Organizations, Identity Providers, and Groups: Read | the team name, the login methods |
| Account | Account Settings: Read | lets wrangler look up the account |
| Zone (`fieldguide.help` only) | Zone: Read | find the zone |
| Zone (`fieldguide.help` only) | Workers Routes: Edit | attach the custom domain |
| Zone (`fieldguide.help` only) | DNS: Edit | the custom domain's DNS record for the one hostname (the script itself only reads DNS) |

Account resources: the one account. Zone resources: **Specific zone → fieldguide.help**. Then:

```
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=<account id> \
B68_GM_EMAILS=you@example.com B68_PLAYER_EMAILS=player1@example.com,player2@example.com \
scripts/deploy.sh
```

The token can be deleted afterwards; `npx wrangler login` is enough for later deploys.

## On phones

The hosted app installs like an app, with its own icon and no browser bars. Open the address
once and sign in, then:

- **iPhone or iPad (Safari):** the Share button → **Add to Home Screen** → **Add**.
- **Android (Chrome):** the ⋮ menu → **Install app** (or **Add to Home screen**), or accept the
  install prompt.

It keeps working with no signal for what you have already seen: it opens with the sheets and
the table as they were the last time it was online, and you can tick boxes and edit as usual.
The header then says **Offline · N changes waiting**; the changes save by themselves, in order,
when the phone is back online. Signing in needs the network, and so does seeing what others
changed while you were offline. If a change made offline is refused (for example on a sheet
you cannot edit), the app says so and shows the saved version again.

## Running it locally

```
npm install
npm run db:local
npm run dev
```

Then open `http://127.0.0.1:8788`. Locally there is no Access in front, so the `DEV_USER`
variable in the `dev` script stands in for the signed-in person. It only works on a local
address: the deployed Worker ignores it.
