#!/bin/sh
# Deploy the Blades '68 app as a Cloudflare Worker behind Cloudflare Access (see SETUP.md).
#
#   B68_GM_EMAILS=gm@example.com B68_PLAYER_EMAILS=a@example.com,b@example.com scripts/deploy.sh
#   ... scripts/deploy.sh --finish     (after the Access dashboard steps, with B68_ACCESS_TEAM and B68_ACCESS_AUD)
#   B68_DRY_RUN=1 ... scripts/deploy.sh   prints every change and API call, makes none
#
# Safe to run again at any time: every step looks first and changes only what is missing or different.
#
# Sign-in for the script (one of):
#   npx wrangler login          browser sign-in; covers D1, the Worker, its secrets and the custom domain,
#                               but not Cloudflare Access: the script then prints the Access dashboard steps
#                               and continues with B68_ACCESS_TEAM / B68_ACCESS_AUD (asked for, or --finish)
#   CLOUDFLARE_API_TOKEN=...    an API token (permissions in SETUP.md); with the Access permissions the
#                               Access application and its allow policy are created or updated for you
#   CLOUDFLARE_ACCOUNT_ID=...   needed only when the login can see more than one account
#
# Settings (environment):
#   B68_GM_EMAILS        required: comma-separated GM emails (GMs can edit everything)
#   B68_PLAYER_EMAILS    the players' emails, comma-separated (the GMs are always allowed in too)
#   B68_HOST             default blades.fieldguide.help: a subdomain of a zone in the account, never the
#                        apex or www. Only this hostname is touched (one Worker custom domain).
#   B68_ZONE             default: the last two labels of B68_HOST
#   B68_ACCESS_TEAM      Zero Trust team name (<team>.cloudflareaccess.com); found through the API with a token
#   B68_ACCESS_AUD       the Access application's AUD tag; read through the API with a token
#   B68_IDPS             login methods for the app: otp (default, emailed code), or otp,google once Google is
#                        set up under Zero Trust (SETUP.md)
#   B68_SESSION          Access session length, default 720h (30 days)
#   B68_D1_NAME          default blades68
#   B68_SKIP_SMOKE=1     skip the final checks against https://<host>/
#   B68_DRY_RUN=1        print, do not change (wrangler.toml is left alone; the Worker is still bundled)
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
. "$ROOT/scripts/lib/common.sh"

FINISH=0
for a in "$@"; do
  case $a in
    --finish) FINISH=1 ;;
    -h | --help) sed -n '2,/^set -eu/p' "$0" | sed '$d; s/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $a (try --help)" ;;
  esac
done

D1_NAME=${B68_D1_NAME:-blades68}
SESSION=${B68_SESSION:-720h}
IDPS=${B68_IDPS:-otp}
CONFIG=$ROOT/wrangler.toml

# ---------------------------------------------------------------- inputs
step "Checking the inputs"
need node
need curl
[ -x "$WRANGLER_BIN" ] || die "run 'npm install' in $ROOT first (wrangler comes from package.json)"
resolve_host
[ -n "${B68_GM_EMAILS:-}" ] || die "set B68_GM_EMAILS (the GM's email; comma-separated for more than one)"
GM_EMAILS=$(j emails "$B68_GM_EMAILS") || die "B68_GM_EMAILS has an entry that is not an email address"
PLAYERS=$(j emails "${B68_PLAYER_EMAILS:-}") || die "B68_PLAYER_EMAILS has an entry that is not an email address"
ALLOWED=$(j emails "$GM_EMAILS" "$PLAYERS")
case $IDPS in otp | google | otp,google | google,otp) ;; *) die "B68_IDPS must be otp, google or otp,google" ;; esac
say "host:     https://$HOST  (zone $ZONE)"
say "GMs:      $GM_EMAILS"
say "allowed:  $ALLOWED"
say "sign-in:  $IDPS, sessions of $SESSION"
[ "$DRY" = 1 ] && say "DRY RUN: nothing will be changed"

# Production must never carry DEV_USER (it signs everyone in without Access); the Worker ignores it off
# loopback anyway, but the config is checked here and by checks/api/worker.mjs before anything ships.
if grep -v '^[[:space:]]*#' "$CONFIG" | grep -q 'DEV_USER'; then
  die "wrangler.toml sets DEV_USER: remove it (local development passes it with --var)"
fi
node "$ROOT/checks/api/worker.mjs" >"$TMP/worker-check.txt" 2>&1 || { cat "$TMP/worker-check.txt"; die "checks/api/worker.mjs failed: not deploying"; }
say "worker check: $(tail -n 1 "$TMP/worker-check.txt")"

# ---------------------------------------------------------------- sign-in
step "Signing in to Cloudflare"
resolve_auth
ACC=$CLOUDFLARE_ACCOUNT_ID

# ---------------------------------------------------------------- the host is free (or already ours)
step "Checking that $HOST is free for this Worker"
WORKER=$(sed -n 's/^name *= *"\(.*\)"/\1/p' "$CONFIG" | head -n 1)
OWNER=
if [ "$AUTH" = token ]; then
  api GET "/zones?name=$ZONE&account.id=$ACC" || die "could not list zones (the token needs Zone: Zone Read on $ZONE)"
  ZONE_ID=$(j zone-id "$ZONE" <"$RESP")
  [ -n "$ZONE_ID" ] || die "zone $ZONE is not in account $ACC"
  if api GET "/accounts/$ACC/workers/domains?hostname=$HOST"; then OWNER=$(j domain-service "$HOST" <"$RESP"); fi
  if [ -z "$OWNER" ] && api GET "/zones/$ZONE_ID/dns_records?name=$HOST"; then
    j dns-records "$HOST" <"$RESP" >"$TMP/dns.txt"
    if [ -s "$TMP/dns.txt" ]; then
      sed 's/^/  /' "$TMP/dns.txt"
      die "$HOST already has DNS records (above). This script never edits DNS: remove them in the dashboard if they are unused, or pick another B68_HOST"
    fi
  fi
elif [ "$DRY" = 0 ]; then
  # wrangler's sign-in cannot read DNS records: look the name up publicly instead
  RESOLVED=$(j resolve "$HOST" || true)
  if [ -n "$RESOLVED" ]; then
    if [ "${B68_HOST_IS_OURS:-0}" = 1 ]; then
      say "$HOST resolves ($RESOLVED); B68_HOST_IS_OURS=1 says it is this Worker's"
    elif [ "$(j toml-get "$CONFIG" host)" = "$HOST" ] && ! j toml-get "$CONFIG" database_id | grep -q '^00000000-'; then
      say "$HOST resolves ($RESOLVED); wrangler.toml already deploys there, so this is a redeploy"
    else
      say "$HOST already resolves: $RESOLVED"
      say "Deploying would point it at this Worker (wrangler replaces a conflicting record for that one name)."
      say "Check the DNS page of $ZONE in the dashboard that nothing uses $HOST. A wildcard record (*.$ZONE)"
      say "also makes it resolve, and is left alone. Then run again with B68_HOST_IS_OURS=1."
      die "$HOST is in use"
    fi
  fi
fi
[ -n "$OWNER" ] && [ "$OWNER" != "$WORKER" ] && die "$HOST is the custom domain of another Worker ($OWNER): not taking it over"
say "ok"

# ---------------------------------------------------------------- D1
step "D1 database $D1_NAME"
DB_ID=
if [ "$DRY" = 1 ]; then
  say "DRY-RUN  wrangler d1 list --json   (then: wrangler d1 create $D1_NAME, when it is missing)"
  DB_ID="<the id of $D1_NAME>"
else
  wr d1 list --json >"$TMP/d1.json" 2>"$TMP/d1.err" || { cat "$TMP/d1.err" >&2; die "could not list D1 databases"; }
  DB_ID=$(j d1-id "$D1_NAME" <"$TMP/d1.json")
  if [ -z "$DB_ID" ]; then
    say "creating $D1_NAME"
    wr d1 create "$D1_NAME" >"$TMP/d1create.txt" 2>&1 || { cat "$TMP/d1create.txt" >&2; die "could not create the D1 database"; }
    wr d1 list --json >"$TMP/d1.json"
    DB_ID=$(j d1-id "$D1_NAME" <"$TMP/d1.json")
    [ -n "$DB_ID" ] || die "created $D1_NAME but cannot find its id"
  fi
fi
say "database_id $DB_ID"

if [ "$DRY" = 1 ]; then
  say "DRY-RUN  wrangler.toml: database_id = $DB_ID, route pattern = \"$HOST\" (now: $(j toml-get "$CONFIG" database_id), \"$(j toml-get "$CONFIG" host)\")"
else
  CHANGED=$(j toml-set "$CONFIG" "$DB_ID" "$HOST")
  [ "$CHANGED" = changed ] && say "wrangler.toml updated (database_id and host): commit it"
fi

step "Applying migrations (remote)"
wr_change d1 migrations apply DB --remote

# ---------------------------------------------------------------- Access
step "Cloudflare Access for $HOST"
TEAM=$(printf '%s' "${B68_ACCESS_TEAM:-}" | tr 'A-Z' 'a-z' | sed 's#^https\{0,1\}://##; s#\.cloudflareaccess\.com.*$##')
AUD=$(printf '%s' "${B68_ACCESS_AUD:-}" | tr -d ' \t\r\n')
ACCESS_VIA_API=0

access_api() {
  # Access team (organization)
  if [ -z "$TEAM" ]; then
    api GET "/accounts/$ACC/access/organizations" || return 1
    TEAM=$(j team <"$RESP")
    [ -n "$TEAM" ] || { warn "Zero Trust is not set up on this account yet (no team name): see the dashboard steps"; return 1; }
  fi
  say "team: $TEAM"

  # login methods
  api GET "/accounts/$ACC/access/identity_providers" || return 1
  j idps "$IDPS" <"$RESP" >"$TMP/idps.txt"
  IDP_IDS=$(sed -n 's/^ids=//p' "$TMP/idps.txt")
  MISSING=$(sed -n 's/^missing=//p' "$TMP/idps.txt")
  say "login methods on the account: $(sed -n 's/^available=//p' "$TMP/idps.txt")"
  case ",$MISSING," in
    *,otp,*) warn "One-time PIN is not a login method yet: Zero Trust > Settings > Authentication > Login methods > Add new > One-time PIN (or Integrations > Identity providers). The app will accept every login method until then." ;;
  esac
  case ",$MISSING," in
    *,google,*) warn "Google is not set up as a login method yet (SETUP.md, 'Adding Google sign-in'). Using the others for now." ;;
  esac

  # the allow policy (reusable), by name
  POLICY=$(policy_name)
  j policy-body "$POLICY" "$ALLOWED" "$SESSION" >"$TMP/policy.json"
  APP_ID=
  api_list "/accounts/$ACC/access/apps" || return 1
  APP_ID=$(j find-app "$HOST" <"$RESP")
  j other-apps "$HOST" <"$RESP" >"$TMP/other-apps.txt"
  [ -s "$TMP/other-apps.txt" ] && warn "other Access apps under $HOST (left alone): $(tr '\n' ';' <"$TMP/other-apps.txt")"

  POLICY_ID= POLICY_KIND=reusable
  if [ -n "$APP_ID" ]; then
    api GET "/accounts/$ACC/access/apps/$APP_ID" || return 1
    set -- $(j allow-policy <"$RESP")
    POLICY_ID=${1:-} POLICY_KIND=${2:-reusable}
  fi
  if [ -z "$POLICY_ID" ]; then
    api_list "/accounts/$ACC/access/policies" || return 1
    POLICY_ID=$(j find-policy "$POLICY" <"$RESP")
  fi
  if [ -n "$POLICY_ID" ]; then
    # keep the policy's other rules; set its email list to exactly the GMs and players
    if [ "$POLICY_KIND" = app ]; then P="/accounts/$ACC/access/apps/$APP_ID/policies/$POLICY_ID"; else P="/accounts/$ACC/access/policies/$POLICY_ID"; fi
    api GET "$P" || return 1
    j policy-edit set "$ALLOWED" <"$RESP" >"$TMP/policy.json"
    api PUT "$P" "$TMP/policy.json" || return 1
    say "allow policy updated ($POLICY_ID)"
  else
    api POST "/accounts/$ACC/access/policies" "$TMP/policy.json" || return 1
    POLICY_ID=$(j get result.id <"$RESP")
    POLICY_KIND=reusable
    say "allow policy created ($POLICY_ID)"
  fi

  # the self-hosted application
  if [ "$POLICY_KIND" = reusable ]; then
    j app-body "$APP_NAME" "$HOST" "$SESSION" "$IDP_IDS" "$POLICY_ID" >"$TMP/app.json"
  else
    # an app-scoped policy stays attached as it is: send the app without a policies list
    j app-body "$APP_NAME" "$HOST" "$SESSION" "$IDP_IDS" "$POLICY_ID" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);delete o.policies;process.stdout.write(JSON.stringify(o))})' >"$TMP/app.json"
  fi
  if [ -n "$APP_ID" ]; then
    api PUT "/accounts/$ACC/access/apps/$APP_ID" "$TMP/app.json" || return 1
    say "Access application updated ($APP_ID)"
  else
    api POST "/accounts/$ACC/access/apps" "$TMP/app.json" || return 1
    APP_ID=$(j get result.id <"$RESP")
    say "Access application created ($APP_ID)"
  fi
  AUD=$(j get result.aud <"$RESP")
  [ -n "$AUD" ] || { api GET "/accounts/$ACC/access/apps/$APP_ID" && AUD=$(j get result.aud <"$RESP"); }
  [ -n "$AUD" ] || return 1
  ACCESS_VIA_API=1
}

dashboard_steps() {
  SUB=${HOST%."$ZONE"}
  cat <<EOF

Cloudflare Access is set up in the dashboard (wrangler's sign-in cannot do it). In a browser:

 1. Open https://one.dash.cloudflare.com and pick the account that holds $ZONE.
    The first time, Zero Trust asks for a team name (it becomes <team>.cloudflareaccess.com)
    and a plan: choose Free (up to 50 users).
 2. Login method: Settings > Authentication > Login methods (newer dashboards: Integrations >
    Identity providers). "One-time PIN" should be listed; if not: Add new > One-time PIN > Save.
 3. Access > Applications > Add an application > Self-hosted.
      Application name:  $APP_NAME
      Session duration:  1 month
      Public hostname:   subdomain "$SUB", domain "$ZONE", path empty
 4. Policy (on the same page, or Access > Policies > Add a policy, then select it):
      Name:     $(policy_name)
      Action:   Allow
      Include:  Emails, one per line:
$(printf '%s\n' "$ALLOWED" | tr ',' '\n' | sed 's/^/                /')
 5. Login methods: untick "Accept all available identity providers", tick only One-time PIN
    (and turn on "Instant Auth" so people go straight to the email-code page). Save.
 6. Open the application again (Access > Applications > $APP_NAME > Configure/Overview) and copy
    the "Application Audience (AUD) Tag".
 7. The team name: Settings > Custom Pages (or Settings > General) shows the team domain
    <team>.cloudflareaccess.com; the team name is the part before ".cloudflareaccess.com".

Then continue with:

  B68_ACCESS_TEAM=<team> B68_ACCESS_AUD=<aud tag> \\
  B68_GM_EMAILS=... B68_PLAYER_EMAILS=... scripts/deploy.sh --finish
EOF
}

if [ -n "$TEAM" ] && [ -n "$AUD" ]; then
  say "using B68_ACCESS_TEAM=$TEAM and B68_ACCESS_AUD from the environment"
  [ "$AUTH" = token ] && say "(the Access app is not checked or updated when both are given; scripts/access-emails.sh changes the list)"
elif [ "$AUTH" = token ] && [ "$FINISH" = 0 ]; then
  if access_api; then
    :
  else
    warn "the Access API calls failed (the token needs Access: Apps and Policies Edit and Access: Organizations, Identity Providers, and Groups Read)"
  fi
fi

if [ -z "$TEAM" ] || [ -z "$AUD" ]; then
  [ "$FINISH" = 1 ] || dashboard_steps
  if [ "$DRY" = 1 ]; then
    TEAM=${TEAM:-your-team} AUD=${AUD:-dry-run-aud-tag}
    say "DRY-RUN  would wait here for B68_ACCESS_TEAM and B68_ACCESS_AUD"
  elif [ -t 0 ]; then
    printf '\nTeam name (the <team> in <team>.cloudflareaccess.com): '
    read -r TEAM
    printf 'Application Audience (AUD) Tag: '
    read -r AUD
    TEAM=$(printf '%s' "$TEAM" | tr 'A-Z' 'a-z' | sed 's#^https\{0,1\}://##; s#\.cloudflareaccess\.com.*$##')
    AUD=$(printf '%s' "$AUD" | tr -d ' \t\r\n')
  else
    say ""
    say "Stopped before deploying: nothing is served at https://$HOST until Access protects it."
    exit 3
  fi
fi
case $TEAM in '' | *[!a-z0-9-]*) die "B68_ACCESS_TEAM is not a team name: '$TEAM'" ;; esac
case $AUD in '' | *[!0-9a-zA-Z-]*) die "B68_ACCESS_AUD does not look like an AUD tag: '$AUD'" ;; esac

# The team must exist: its signing keys are public.
if [ "$DRY" = 0 ]; then
  curl -fsS "https://$TEAM.cloudflareaccess.com/cdn-cgi/access/certs" -o "$TMP/certs.json" ||
    die "https://$TEAM.cloudflareaccess.com/cdn-cgi/access/certs does not answer: is the team name right?"
  KEYS=$(j get keys <"$TMP/certs.json")
  [ -n "$KEYS" ] && [ "$KEYS" != "[]" ] || die "team $TEAM publishes no signing keys"
  say "team $TEAM: signing keys found"
fi

# ---------------------------------------------------------------- secrets and deploy
step "Deploying the Worker to https://$HOST"
# DEV_USER must not exist as a secret either
if [ "$DRY" = 0 ] && wr secret list --format json >"$TMP/secrets.json" 2>/dev/null; then
  if j has-secret DEV_USER <"$TMP/secrets.json"; then
    say "deleting the DEV_USER secret (it must never be set in production)"
    wr secret delete DEV_USER >/dev/null || die "could not delete the DEV_USER secret: npx wrangler secret delete DEV_USER"
  fi
fi

# ACCESS_TEAM, ACCESS_AUD and GM_EMAILS go up as secrets in the same version as the code
# (wrangler deploy --secrets-file: like `wrangler secret put`, and it also works before the first deploy).
(umask 077 && ACCESS_TEAM=$TEAM ACCESS_AUD=$AUD GM_EMAILS=$GM_EMAILS j secrets-json ACCESS_TEAM ACCESS_AUD GM_EMAILS >"$TMP/secrets-upload.json")
if [ "$DRY" = 1 ]; then
  say "DRY-RUN  secrets: ACCESS_TEAM=$TEAM ACCESS_AUD=$AUD GM_EMAILS=$GM_EMAILS"
  say "DRY-RUN  wrangler deploy --secrets-file <temp file>"
  say "bundling for real (wrangler deploy --dry-run) to prove the Worker builds:"
  wr deploy --dry-run --outdir "$TMP/dist" 2>&1 | grep -v 'Proxy environment' | grep -v '^[[:space:]]*$' | sed 's/^/  /'
else
  wr deploy --secrets-file "$TMP/secrets-upload.json"
fi
rm -f "$TMP/secrets-upload.json"

# ---------------------------------------------------------------- smoke test
step "Checking https://$HOST from outside (not signed in)"
smoke() {
  # $1 = path. Access must answer before the Worker: a redirect to the team's login page (or a 401/403
  # from Access); a 200 here would mean the app is public.
  _url="https://$HOST$1"
  _i=0
  while :; do
    _out=$(curl -sS -o /dev/null -D "$TMP/h.txt" -w '%{http_code} %{redirect_url}' --max-time 20 "$_url" 2>"$TMP/curl.err" || true)
    _code=${_out%% *}
    case $_code in 000 | 52? | 404) ;; *) break ;; esac   # new custom domain: DNS and certificate still on their way
    _i=$((_i + 1))
    [ "$_i" -ge 36 ] && break
    sleep 5
  done
  _loc=${_out#* }
  case $_code in
    30[1-8])
      case $_loc in *.cloudflareaccess.com/* | "https://$HOST/cdn-cgi/access/"*) say "PASS $1 -> $_code to the Access login ($(printf '%s' "$_loc" | sed 's#\(https://[^/]*\).*#\1#'))"; return 0 ;; esac
      say "FAIL $1 -> $_code to $_loc (not Cloudflare Access)"; return 1 ;;
    401 | 403)
      if grep -qi 'cf-access\|cloudflareaccess' "$TMP/h.txt"; then say "PASS $1 -> $_code from Cloudflare Access"; return 0; fi
      say "FAIL $1 -> $_code, but not from Access"; return 1 ;;
    200) say "FAIL $1 -> 200 without signing in: Access is not protecting $HOST"; return 1 ;;
    *) say "FAIL $1 -> $_code $(cat "$TMP/curl.err")"; return 1 ;;
  esac
}
SMOKE_OK=1
if [ "$DRY" = 1 ]; then
  say "DRY-RUN  curl https://$HOST/ and https://$HOST/api/me: both must redirect to $TEAM.cloudflareaccess.com"
elif [ "${B68_SKIP_SMOKE:-0}" = 1 ]; then
  say "skipped (B68_SKIP_SMOKE=1)"
else
  smoke / || SMOKE_OK=0
  smoke /api/me || SMOKE_OK=0
fi

# ---------------------------------------------------------------- next steps
step "Next"
cat <<EOF
 1. Open https://$HOST in a browser. Cloudflare Access asks for an email and sends a code
    (one-time PIN). Sign in as a GM ($GM_EMAILS): the header says "Signed in as ... · GM".
 2. Move the characters and the table across from the claude.ai artifact: SETUP.md, step 4.
 3. Players open the same address and sign in with their own email. Phones: SETUP.md, "On phones".
 4. Add or remove a player later:  scripts/access-emails.sh add someone@example.com
    (with an API token; without one, SETUP.md "Adding and removing players" has the dashboard steps).
 5. Commit wrangler.toml if this run changed it (it now names the database and the host).
EOF
if [ "$SMOKE_OK" = 0 ]; then
  die "the check against https://$HOST failed (above): fix Access before sharing the address"
fi
