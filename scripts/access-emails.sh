#!/bin/sh
# Who may open the app: the email list of its Cloudflare Access allow policy, and who is a GM.
#
#   scripts/access-emails.sh list                      the emails allowed in now
#   scripts/access-emails.sh add a@example.com ...     let these people in (players)
#   scripts/access-emails.sh remove a@example.com ...  take them out (their characters stay)
#   scripts/access-emails.sh set                       exactly B68_GM_EMAILS + B68_PLAYER_EMAILS
#   scripts/access-emails.sh gms a@example.com,b@...   set the GM list (Worker secret GM_EMAILS) and
#                                                      make sure they are allowed in
#
# The allow list is changed through the Cloudflare API and needs CLOUDFLARE_API_TOKEN with
# Access: Apps and Policies Edit (SETUP.md); without one the dashboard steps are printed instead.
# `gms` sets the secret with wrangler, so `npx wrangler login` is enough for that part.
# B68_HOST (default blades.fieldguide.help), CLOUDFLARE_ACCOUNT_ID and B68_DRY_RUN=1 work as in deploy.sh.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
. "$ROOT/scripts/lib/common.sh"

usage() { sed -n '2,/^set -eu/p' "$0" | sed '$d; s/^# \{0,1\}//'; }
[ $# -ge 1 ] || { usage; exit 64; }
OP=$1
shift
case $OP in
  -h | --help) usage; exit 0 ;;
  list) ;;
  add | remove) [ $# -ge 1 ] || die "$OP needs at least one email"; EMAILS=$(j emails "$@") || die "not an email address" ;;
  set) [ -n "${B68_GM_EMAILS:-}" ] || die "set B68_GM_EMAILS (and B68_PLAYER_EMAILS)"
       EMAILS=$(j emails "$B68_GM_EMAILS" "${B68_PLAYER_EMAILS:-}") || die "not an email address" ;;
  gms) [ $# -ge 1 ] || die "gms needs the GM emails"; GMS=$(j emails "$@") || die "not an email address"; EMAILS=$GMS ;;
  *) usage; exit 64 ;;
esac
need node
need curl
resolve_host
resolve_auth
ACC=$CLOUDFLARE_ACCOUNT_ID

if [ "$OP" = gms ]; then
  step "GM_EMAILS for the Worker"
  if [ "$DRY" = 1 ]; then
    say "DRY-RUN  printf '%s' '$GMS' | wrangler secret put GM_EMAILS"
  else
    printf '%s' "$GMS" | WRANGLER_SEND_METRICS=false "$WRANGLER_BIN" secret put GM_EMAILS
  fi
  say "GMs: $GMS (roles follow at once; nobody needs to sign in again)"
  OP=add
fi

if [ "$AUTH" != token ]; then
  case $OP in
    list) what="read the email list" ;;
    add) what="add $EMAILS to the email list" ;;
    remove) what="remove $EMAILS from the email list" ;;
    *) what="make the email list exactly: $EMAILS" ;;
  esac
  cat <<EOF

To $what in the dashboard:
 1. https://one.dash.cloudflare.com > Access > Applications > $APP_NAME ($HOST) > Configure
    (or Access > Policies > "$(policy_name)").
 2. Edit the Allow policy: under Include > Emails, $what.
 3. Save. A removed person is signed out at their next request; their characters stay.
(With CLOUDFLARE_API_TOKEN set, this script does it for you.)
EOF
  exit 0
fi

step "Access allow list for $HOST"
api_list "/accounts/$ACC/access/apps" || die "could not list Access applications (the token needs Access: Apps and Policies Edit)"
APP_ID=$(j find-app "$HOST" <"$RESP")
[ -n "$APP_ID" ] || [ "$DRY" = 1 ] || die "no Access application covers $HOST: run scripts/deploy.sh first"
APP_ID=${APP_ID:-dry-run-app-id}
api GET "/accounts/$ACC/access/apps/$APP_ID" || die "could not read the Access application"
set -- $(j allow-policy <"$RESP")
POLICY_ID=${1:-} KIND=${2:-reusable}
if [ -z "$POLICY_ID" ] && [ "$DRY" = 1 ]; then POLICY_ID=dry-run-policy-id; fi
[ -n "$POLICY_ID" ] || die "the Access application for $HOST has no Allow policy"
if [ "$KIND" = app ]; then P="/accounts/$ACC/access/apps/$APP_ID/policies/$POLICY_ID"; else P="/accounts/$ACC/access/policies/$POLICY_ID"; fi
api GET "$P" || die "could not read the allow policy"

if [ "$OP" = list ]; then
  j policy-emails <"$RESP"
  exit 0
fi
j policy-edit "$OP" "$EMAILS" <"$RESP" >"$TMP/policy.json" || die "not changed"
api PUT "$P" "$TMP/policy.json" || die "could not update the allow policy"
say "allowed now:"
j policy-emails <"$RESP" | sed 's/^/  /'
