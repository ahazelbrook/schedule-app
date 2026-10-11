# Shared helpers for scripts/deploy.sh and scripts/access-emails.sh (POSIX sh; sourced, not run).
# Expects ROOT (the repository root) to be set by the caller.

CF_API=https://api.cloudflare.com/client/v4
case ${B68_DRY_RUN:-0} in '' | 0 | no | false) DRY=0 ;; *) DRY=1 ;; esac

TMP=$(mktemp -d "${TMPDIR:-/tmp}/b68-deploy.XXXXXX")
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM
RESP=$TMP/resp.json

say()  { printf '%s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die()  { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

j() { node "$ROOT/scripts/lib/cf.mjs" "$@"; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but not installed"; }

# wrangler from this repository (npm install), never a global one; stdin closed so it never waits
# on a prompt (non-interactive wrangler takes its default answers: yes to migrations).
WRANGLER_BIN=$ROOT/node_modules/.bin/wrangler
wr() {
  [ -x "$WRANGLER_BIN" ] || die "wrangler is missing: run 'npm install' in $ROOT first"
  WRANGLER_SEND_METRICS=false "$WRANGLER_BIN" "$@" </dev/null
}
# a wrangler command that changes something: printed (not run) in a dry run
wr_change() {
  if [ "$DRY" = 1 ]; then say "DRY-RUN  wrangler $*"; return 0; fi
  wr "$@"
}

# api METHOD PATH [BODY_FILE]: one Cloudflare API call with CLOUDFLARE_API_TOKEN. The answer is left in
# $RESP; returns non-zero (with the API's errors on stderr) unless it says success. In a dry run the call
# is printed with its body and a canned answer is used instead.
api() {
  _m=$1 _p=$2 _b=${3:-}
  if [ "$DRY" = 1 ]; then
    say "DRY-RUN  $_m $CF_API$_p"
    [ -n "$_b" ] && sed 's/^/           /' "$_b" && echo
    j dry "$_m" "$_p" "$_b" >"$RESP"
    return 0
  fi
  if [ -n "$_b" ]; then
    _code=$(curl -sS -X "$_m" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' \
      --data-binary "@$_b" -o "$RESP" -w '%{http_code}' "$CF_API$_p") || { echo '{}' >"$RESP"; return 1; }
  else
    _code=$(curl -sS -X "$_m" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -o "$RESP" -w '%{http_code}' "$CF_API$_p") || { echo '{}' >"$RESP"; return 1; }
  fi
  if ! j ok <"$RESP" 2>"$TMP/api-err"; then
    printf '  %s %s -> HTTP %s: %s\n' "$_m" "$_p" "$_code" "$(cat "$TMP/api-err")" >&2
    return 1
  fi
  return 0
}

# GET every page of a list into $RESP as one {"success":true,"result":[...]}.
api_list() {
  _path=$1
  api GET "$_path" || return 1
  _pages=$(j pages <"$RESP")
  [ "$_pages" -gt 1 ] 2>/dev/null || return 0
  cp "$RESP" "$TMP/list-1.json"
  _i=2
  while [ "$_i" -le "$_pages" ]; do
    case $_path in *\?*) _sep='&' ;; *) _sep='?' ;; esac
    api GET "$_path${_sep}page=$_i" || return 1
    cp "$RESP" "$TMP/list-$_i.json"
    _i=$((_i + 1))
  done
  node -e '
    const fs = require("fs"); const all = [];
    for (const f of process.argv.slice(1)) all.push(...(JSON.parse(fs.readFileSync(f, "utf8")).result || []));
    process.stdout.write(JSON.stringify({ success: true, result: all }));
  ' "$TMP"/list-*.json >"$RESP"
  rm -f "$TMP"/list-*.json
}

# Who is calling: sets AUTH (token|oauth) and CLOUDFLARE_ACCOUNT_ID (exported for wrangler).
resolve_auth() {
  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
    AUTH=token
    export CLOUDFLARE_API_TOKEN
  else
    AUTH=oauth
  fi
  if [ "$DRY" = 1 ]; then
    : "${CLOUDFLARE_ACCOUNT_ID:=dry-run-account-id}"
    export CLOUDFLARE_ACCOUNT_ID
    say "auth: $AUTH (dry run: not checked), account $CLOUDFLARE_ACCOUNT_ID"
    return 0
  fi
  if [ "$AUTH" = token ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
    # a token (user- or account-owned) is checked directly; whoami would need User Details Read
    if api GET /user/tokens/verify 2>/dev/null || api GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/tokens/verify"; then
      export CLOUDFLARE_ACCOUNT_ID
      say "auth: token, account $CLOUDFLARE_ACCOUNT_ID"
      return 0
    fi
    die "CLOUDFLARE_API_TOKEN was refused by Cloudflare (or does not belong to account $CLOUDFLARE_ACCOUNT_ID)"
  fi
  if ! wr whoami --json >"$TMP/whoami.json" 2>"$TMP/whoami.err"; then
    if [ "$AUTH" = token ]; then
      die "set CLOUDFLARE_ACCOUNT_ID too (the account id from the dashboard): $(tail -n 3 "$TMP/whoami.err")"
    fi
    die "wrangler is not signed in. Run:  npx wrangler login   (a browser window opens; allow it), then run this again."
  fi
  if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
    j accounts <"$TMP/whoami.json" >"$TMP/accounts.txt"
    _n=$(wc -l <"$TMP/accounts.txt" | tr -d ' ')
    if [ "$_n" = 1 ]; then
      CLOUDFLARE_ACCOUNT_ID=$(cut -f1 "$TMP/accounts.txt")
    elif [ "$_n" = 0 ]; then
      die "set CLOUDFLARE_ACCOUNT_ID (the account id from the dashboard's Overview page): this login lists no account"
    else
      say "This login can use several Cloudflare accounts:"; sed 's/^/  /' "$TMP/accounts.txt"
      die "set CLOUDFLARE_ACCOUNT_ID to the one that holds the zone, then run this again"
    fi
  fi
  export CLOUDFLARE_ACCOUNT_ID
  say "auth: $AUTH, account $CLOUDFLARE_ACCOUNT_ID"
}

# Host and zone: the host must be a subdomain of the zone, and never the zone itself or www.
resolve_host() {
  HOST=$(printf '%s' "${B68_HOST:-blades.fieldguide.help}" | tr 'A-Z' 'a-z' | sed 's#^https\{0,1\}://##; s#/.*$##')
  case $HOST in *[!a-z0-9.-]* | .* | *. | *..* | '') die "B68_HOST is not a hostname: $HOST" ;; esac
  ZONE=${B68_ZONE:-$(printf '%s' "$HOST" | awk -F. '{ print $(NF-1) "." $NF }')}
  case $HOST in
    "$ZONE" | "www.$ZONE") die "refusing to deploy to $HOST: the zone apex and www are not this app's (use a subdomain such as blades.$ZONE)" ;;
    *."$ZONE") ;;
    *) die "B68_HOST ($HOST) is not inside B68_ZONE ($ZONE)" ;;
  esac
}

# The Access application's name and its allow policy's name for this host.
APP_NAME=${B68_ACCESS_APP_NAME:-Blades 68}
policy_name() { printf 'Blades 68 players (%s)' "$HOST"; }
