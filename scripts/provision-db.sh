#!/usr/bin/env bash
#
# Provision a fresh database for the backend + rtc-server.
#
# Does the one-time setup that a Render deploy does NOT do on its own:
#   1. pushes the app schema      → DATABASE_URL
#   2. pushes the rtc schema       → RTC_DATABASE_URL
#   3. creates the realm + owner   → DATABASE_URL (the backend refuses to boot without it)
#
# Reads connection strings straight from the environment and never sources
# ./.env, so the URL you pass is the URL that gets used (the root `db:*` scripts
# source .env and would clobber an override — that's the trap this avoids).
#
# Usage:
#   DATABASE_URL=postgresql://user:pw@host/toddle_compose \
#   RTC_DATABASE_URL=postgresql://user:pw@host/toddle_compose_rtc \
#   REALM_OWNER_EMAIL=owner@toddle.app \
#   REALM_OWNER_PASSWORD='<strong-pw>' \
#     bash scripts/provision-db.sh [-y]
#
# Optional env (defaults shown):
#   REALM_ID=realm_toddle  REALM_NAME=Toddle  REALM_OWNER_NAME=Owner
#
#   DATABASE_URL_DIRECT / RTC_DATABASE_URL_DIRECT
#     Used for the schema-push steps instead of DATABASE_URL / RTC_DATABASE_URL.
#     REQUIRED when your normal URL goes through a connection pooler that can't
#     run DDL — e.g. Supabase's transaction pooler (host …pooler…:6543,
#     ?pgbouncer=true). Pass the DIRECT connection there (port 5432). The realm
#     init in step 3 still uses DATABASE_URL (plain queries work through a pooler).
#
# Flags:
#   -y / --yes   skip the confirmation prompt (for CI / non-interactive use)
#
# Run from a host that can reach the database — use the EXTERNAL connection
# URLs for a Render Postgres (internal hostnames only resolve inside Render).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# --- required env ---------------------------------------------------------
missing=0
require() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    echo "  ✗ $name is required but not set" >&2
    missing=1
  fi
}
require DATABASE_URL
require RTC_DATABASE_URL
require REALM_OWNER_EMAIL
require REALM_OWNER_PASSWORD
if [ "$missing" -ne 0 ]; then
  echo >&2
  echo "Set the missing variables and re-run. See the header of this script for usage." >&2
  exit 2
fi

# --- defaults -------------------------------------------------------------
export REALM_ID="${REALM_ID:-realm_toddle}"
export REALM_NAME="${REALM_NAME:-Toddle}"
export REALM_OWNER_NAME="${REALM_OWNER_NAME:-Owner}"
export DATABASE_URL RTC_DATABASE_URL REALM_OWNER_EMAIL REALM_OWNER_PASSWORD

# Schema push needs a DDL-capable connection; fall back to the runtime URL when
# no direct URL is given (fine for direct Postgres, wrong for a pooler).
APP_PUSH_URL="${DATABASE_URL_DIRECT:-$DATABASE_URL}"
RTC_PUSH_URL="${RTC_DATABASE_URL_DIRECT:-$RTC_DATABASE_URL}"

# Mask the password in any URL before printing.
mask() { printf '%s' "$1" | sed -E 's#(://[^:/@]+:)[^@]+@#\1****@#'; }

echo "About to provision:"
echo "  app DB  (push): $(mask "$APP_PUSH_URL")"
echo "  rtc DB  (push): $(mask "$RTC_PUSH_URL")"
echo "  app DB  (init): $(mask "$DATABASE_URL")"
echo "  realm         : $REALM_ID ($REALM_NAME), owner $REALM_OWNER_EMAIL"
if printf '%s' "$APP_PUSH_URL" | grep -qiE 'pgbouncer=true|:6543'; then
  echo
  echo "  ⚠ the app push URL looks like a pooler — schema push may fail. Pass" >&2
  echo "    DATABASE_URL_DIRECT with the direct (port 5432) connection instead." >&2
fi
echo

if [ "$ASSUME_YES" -ne 0 ]; then
  : # non-interactive, proceed
elif [ -t 0 ]; then
  read -r -p "Proceed? [y/N] " reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
else
  echo "Non-interactive shell and -y not given; aborting for safety." >&2
  exit 1
fi

# --- 1. app schema --------------------------------------------------------
echo "==> [1/3] pushing app schema"
DATABASE_URL="$APP_PUSH_URL" pnpm --filter @app/database exec prisma db push

# --- 2. rtc schema --------------------------------------------------------
# The rtc datasource reads env("RTC_DATABASE_URL").
echo "==> [2/3] pushing rtc schema"
RTC_DATABASE_URL="$RTC_PUSH_URL" pnpm --filter @app/rtc-database exec prisma db push

# --- 3. realm + owner -----------------------------------------------------
echo "==> [3/3] creating realm + owner → DATABASE_URL"
pnpm --filter @app/database run init

echo
echo "✓ Provisioning complete. Redeploy/restart the backend; the realm lookup will now succeed."
