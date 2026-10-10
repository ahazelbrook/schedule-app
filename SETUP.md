# Setting up the hosted app on Cloudflare

About 30 minutes, all in the Cloudflare dashboard, free plan throughout. At the end the app
lives at `https://<project>.pages.dev` (or your own domain), only people on your list can
open it, and they sign in with Google or with a code sent to their email.

You need: a Cloudflare account, and this repository on GitHub.

## 1. Create the database

1. Dashboard → **Storage & Databases** → **D1 SQL Database** → **Create**.
2. Name it `blades68`. Location: automatic.
3. Copy the **Database ID** it shows.
4. Open the database → **Console**, paste the contents of `schema.sql` from this repository,
   and run it.
5. In `wrangler.toml` at the repository root, replace the placeholder `database_id` with the
   ID from step 3 and commit.

## 2. Create the Pages project

1. Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Pick this repository and the branch you deploy from.
3. Build settings: framework preset **None**, build command empty, build output directory
   `app`. Root directory stays `/` (the API lives in `functions/` at the root).
4. **Save and deploy**. The first deploy gives you the `*.pages.dev` address.
5. Project → **Settings** → **Bindings**: confirm `DB` points at the `blades68` database
   (it comes from `wrangler.toml`; add it here if it is missing).

Every push to that branch now redeploys. Other branches get preview addresses.

## 3. Lock it down with Cloudflare Access

1. Dashboard → **Zero Trust**. The first time, pick a team name (this becomes
   `<team>.cloudflareaccess.com`) and the free plan (up to 50 users).
2. **Settings** → **Authentication** → **Login methods**:
   - **One-time PIN** is on by default: players type their email and get a code. Nothing to
     set up.
   - **Google** (optional, one click for players afterwards): add it and follow the
     on-screen steps to create an OAuth client in Google Cloud Console, then paste the
     client ID and secret.
3. **Access** → **Applications** → **Add an application** → **Self-hosted**.
   - Name: `Blades 68`.
   - Domain: your `<project>.pages.dev` address (and your custom domain, if any). Leave the
     path empty so the page and `/api/*` are both covered.
   - Policy: action **Allow**, include **Emails** and list each player's address and yours.
   - Login methods: the ones from step 2.
4. Open the application's **Overview** and copy the **Application Audience (AUD) Tag**.
5. Back in the Pages project → **Settings** → **Variables and Secrets**, add for
   Production (and Preview if you use it):

| Name | Value |
|---|---|
| `ACCESS_TEAM` | the team name from step 1, without `.cloudflareaccess.com` |
| `ACCESS_AUD` | the AUD tag from step 4 |
| `GM_EMAILS` | your email (comma-separated if there is more than one GM) |

Add them as type **Secret** in the dashboard, never in `wrangler.toml`, so nothing in the repository overrides them.

6. Redeploy (Deployments → the latest → **Retry deployment**) so the variables take effect.

Preview deployments: in the Pages project → **Settings** → **General**, turn on **Enable
access policy** for previews, or they are reachable without signing in.

## 4. Move the characters and the table across

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

## 5. Adding and removing players

Zero Trust → Access → Applications → `Blades 68` → the policy → edit the email list. A
removed player is signed out at their next request. Their characters stay.

## 6. Backups

- In the app: **Download all (JSON)** after each session. It holds the characters in the
  current filter (choose **Everyone** for all of them) and the table page's campaign document.
  A player's copy leaves out the clocks hidden from players.
- The GM also has **Download everything** next to it (hosted app only): the server's own
  export, `/api/export`, with every character (not only the newest 60 the files list shows),
  the campaign document and the member list.
- **Restore (JSON)** reads both files. Characters are filed as new copies (nothing is
  overwritten), by anyone who can write. The table is restored only by the GM and only after
  a confirm, and it replaces the whole table page as it is now.
- D1 keeps point-in-time history (**Time Travel** on the database page): 7 days on the free
  plan, 30 days on Workers Paid, so a bad edit can be rolled back within that window. That is
  why the download after each session still matters.

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
variable in the `dev` script stands in for the signed-in person.
