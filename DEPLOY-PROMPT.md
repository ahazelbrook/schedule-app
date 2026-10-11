# Deploy prompt for a local Claude session

Paste everything below the line into a Claude session on your own computer (one that can use a
terminal and your browser). First replace the two placeholders: `<GM_EMAIL>` (yours; several
GMs comma-separated) and `<PLAYER_EMAILS>` (the players, comma-separated). Keep the real
addresses out of the repository: they only go on the command line and into the Cloudflare
dashboard.

---

Deploy the Blades '68 table app to **https://blades.fieldguide.help** as a Cloudflare Worker
behind Cloudflare Access, following `SETUP.md` in the repository. Work in a terminal on this
computer and in my browser; I am signed in to the Cloudflare dashboard there.

- GM email(s): `<GM_EMAIL>`
- Player emails: `<PLAYER_EMAILS>`
- Sign-in: Cloudflare Access **One-time PIN** (a code sent by email) only. Google is not wanted
  yet.

Hard rules:

- `fieldguide.help` already serves another site. Never change the apex, `www`, or any DNS
  record. The only thing created in that zone is the Worker's custom domain for
  `blades.fieldguide.help`, which the deploy makes by itself. If the script says the host is
  already in use, stop and ask me; do not delete or edit records to make room.
- Never set `DEV_USER` anywhere except a local `npm run dev`. Never put secrets or the email
  addresses into files in the repository.
- Ask me before anything that costs money or that cannot be undone (deleting a database, a
  Worker or an Access application). Nothing in this procedure should need either.

Steps:

1. **Get the code.** Check `git`, `node` (20 or newer) and `npm` are installed. Clone the
   private repository `ahazelbrook/schedule-app` from GitHub (with `gh repo clone` if the
   GitHub CLI is signed in, otherwise `git clone` over HTTPS with my credentials), `cd` into it
   and check out the branch I name (the default branch once the deploy work is merged). Run
   `npm install`. Read `SETUP.md`, then `scripts/deploy.sh --help`.
2. **Optional sanity check.** `npm test` (plain node, no browser; it starts local servers on
   ports 8788 and 8789, so nothing else may use them). Everything should pass.
3. **Sign in to Cloudflare.** Run `npx wrangler login`. It opens a browser tab: help me
   approve it. Then `npx wrangler whoami`. If it lists more than one account, use the one that
   holds `fieldguide.help` and export `CLOUDFLARE_ACCOUNT_ID=<its id>` for the next commands.
4. **Dry run.**
   `B68_DRY_RUN=1 B68_GM_EMAILS='<GM_EMAIL>' B68_PLAYER_EMAILS='<PLAYER_EMAILS>' scripts/deploy.sh`
   prints every step and changes nothing. Read it; it should name `blades.fieldguide.help`
   only.
5. **First run.**
   `B68_GM_EMAILS='<GM_EMAIL>' B68_PLAYER_EMAILS='<PLAYER_EMAILS>' scripts/deploy.sh < /dev/null`
   checks the host is free, creates the D1 database `blades68` (or finds it), writes its id
   into `wrangler.toml`, applies the migrations, and then stops (exit code 3) at Cloudflare
   Access with numbered dashboard steps. Nothing is deployed yet.
6. **Access in the dashboard.** Follow the printed steps in my browser
   (<https://one.dash.cloudflare.com>; also `SETUP.md`, step 3):
   - If Zero Trust asks for a team name and plan the first time, ask me for the team name and
     choose the **Free** plan.
   - Make sure **One-time PIN** is a login method.
   - **Access → Applications → Add an application → Self-hosted**: name `Blades 68`, session
     1 month, public hostname subdomain `blades` + domain `fieldguide.help`, path empty.
   - An **Allow** policy named `Blades 68 players (blades.fieldguide.help)` including the
     **Emails** above (the GM's and the players').
   - Login methods: only **One-time PIN**, with **Instant Auth** on. Save.
   - Copy the application's **Application Audience (AUD) Tag**, and the **team name** (the
     part before `.cloudflareaccess.com` in the team domain, under Settings).
7. **Finish.**
   `B68_ACCESS_TEAM=<team> B68_ACCESS_AUD=<aud> B68_GM_EMAILS='<GM_EMAIL>' B68_PLAYER_EMAILS='<PLAYER_EMAILS>' scripts/deploy.sh --finish < /dev/null`
   uploads the Worker with its secrets, attaches `blades.fieldguide.help`, and checks from
   outside that `/` and `/api/me` redirect a signed-out visitor to
   `<team>.cloudflareaccess.com`. It must end without an error.
8. **Verify, with me.**
   - `curl -sI https://blades.fieldguide.help/` answers a 302 whose `location` is on
     `<team>.cloudflareaccess.com`.
   - In the browser, open `https://blades.fieldguide.help`, enter the GM email, and I type the
     code from my inbox. The app opens; the header says **Signed in as … · GM**, and the table
     page (`https://blades.fieldguide.help/#t`) shows the GM controls.
   - In a private window, an address that is not on the list gets no code / is refused.
   - Narrow the window to phone width (or use the browser's device mode): the page fits the
     screen, no sideways scrolling.
   - `https://fieldguide.help` and `https://www.fieldguide.help` still show what they showed
     before.
9. **Keep the result.** `wrangler.toml` now names the database (and the host). Commit that
   change on a new branch and push it, or show me the diff if pushing is not set up.
10. **Report** the address, the team name, what was created (Worker `blades68`, D1 `blades68`,
    the Access application and policy), and anything that did not go as written here.

If something goes wrong:

- `wrangler is not signed in`: run `npx wrangler login` again.
- The check in step 7 says **200 without signing in**: the Access application does not cover
  `blades.fieldguide.help` (check its public hostname), fix it in the dashboard, run step 7
  again.
- Signed in, but the app says **not signed in · filing unavailable**: the team name or AUD tag
  given in step 7 is wrong. Copy them again and rerun step 7 (it only replaces the secrets and
  redeploys).
- To go back to the previous version of the Worker: `npx wrangler deployments list`, then
  `npx wrangler rollback`.
- Later, adding or removing a player: `SETUP.md`, "Adding and removing players".
