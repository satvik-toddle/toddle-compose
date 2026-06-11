#!/usr/bin/env bash
#
# One-command dev bootstrap. Brings up everything a developer needs, in order:
#   0. Pre-flight: make sure Docker is installed, the Compose plugin exists, and
#      the daemon is running — guiding (and optionally installing) when it isn't.
#   1. Start the Postgres container (pulls the image if missing, waits for healthy).
#   2. Sync the Prisma schema to both databases (app + RTC).
#   3. Bootstrap the realm/owner (db:init) and demo cast (db:seed) — both idempotent.
#   4. Start backend + rtc-server + frontend together.
#
# Usage:  pnpm dev   (or  npm run dev)
# Escape hatches:
#   SKIP_DB_SETUP=1 pnpm dev   # skip schema push + init + seed (DB already prepared)
#   FRESH_DB=1 pnpm dev        # wipe the Postgres data volume first (clean slate)
#                              # (shortcut: pnpm db:fresh)
#   pnpm dev:services          # just the three app servers, no Docker / DB setup
#
# NOTE: Postgres data lives in the named Docker volume `toddle_compose_pgdata`, which
# survives `docker compose down` and even deleting the container — so old rows reappear
# on the next boot. Use FRESH_DB=1 (or `pnpm db:nuke`) to actually drop the data.
set -euo pipefail

# Repo root = parent of this script's dir, regardless of where it's invoked from.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ---- pretty output --------------------------------------------------------
if [ -t 1 ]; then
  C_CYAN=$'\033[36m'; C_GREEN=$'\033[32m'; C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_CYAN=''; C_GREEN=''; C_RED=''; C_YELLOW=''; C_DIM=''; C_OFF=''
fi
note() { printf '%s▶ %s%s\n' "$C_CYAN" "$1" "$C_OFF"; }
ok()   { printf '%s✓ %s%s\n' "$C_GREEN" "$1" "$C_OFF"; }
warn() { printf '%s! %s%s\n' "$C_YELLOW" "$1" "$C_OFF"; }
err()  { printf '%s✗ %s%s\n' "$C_RED" "$1" "$C_OFF" >&2; }
step() { printf '\n%s── %s ──%s\n' "$C_DIM" "$1" "$C_OFF"; }

# Ask a yes/no question. Returns 0 for yes. Auto-"no" when not on a TTY so the
# script never hangs in CI / non-interactive shells.
confirm() {
  local prompt="$1"
  if [ ! -t 0 ]; then
    warn "Non-interactive shell — assuming \"no\" for: $prompt"
    return 1
  fi
  local reply
  printf '%s%s [y/N] %s' "$C_YELLOW" "$prompt" "$C_OFF"
  read -r reply
  [[ "$reply" =~ ^[Yy]([Ee][Ss])?$ ]]
}

is_macos() { [ "$(uname -s)" = "Darwin" ]; }

# ===========================================================================
# 0. PRE-FLIGHT: Docker must be installed, with Compose, and running.
# ===========================================================================
step "Checking Docker"

# --- 0a. Is the `docker` CLI installed at all? -----------------------------
if ! command -v docker >/dev/null 2>&1; then
  err "Docker is not installed (no 'docker' command on PATH)."
  echo
  if is_macos; then
    echo "  Docker Desktop is the recommended engine on macOS."
    echo "    • Homebrew:  ${C_DIM}brew install --cask docker${C_OFF}   (needs your password)"
    echo "    • Manual:    ${C_DIM}https://www.docker.com/products/docker-desktop/${C_OFF}"
    echo
    if command -v brew >/dev/null 2>&1 && confirm "Install Docker Desktop now with Homebrew?"; then
      note "Running: brew install --cask docker  (you may be prompted for your password)"
      if brew install --cask docker; then
        ok "Docker Desktop installed."
      else
        err "Homebrew install failed. Install manually, then re-run 'pnpm dev'."
        exit 1
      fi
    else
      err "Install Docker, then re-run 'pnpm dev'."
      exit 1
    fi
  else
    echo "  Install Docker Engine for your distro: ${C_DIM}https://docs.docker.com/engine/install/${C_OFF}"
    err "Install Docker, then re-run 'pnpm dev'."
    exit 1
  fi
else
  ok "Docker CLI found: $(docker --version 2>/dev/null || echo 'unknown version')"
fi

# --- 0b. Is the Compose v2 plugin present? ---------------------------------
# (Homebrew's bare `docker` formula ships WITHOUT compose; Docker Desktop bundles it.)
if ! docker compose version >/dev/null 2>&1; then
  err "The Docker Compose plugin is missing ('docker compose' is not available)."
  echo
  if is_macos && command -v brew >/dev/null 2>&1; then
    echo "  Install the plugin and link it so the Docker CLI can find it:"
    echo "    ${C_DIM}brew install docker-compose${C_OFF}"
    echo "    ${C_DIM}mkdir -p ~/.docker/cli-plugins${C_OFF}"
    echo "    ${C_DIM}ln -sf \$(brew --prefix)/lib/docker/cli-plugins/docker-compose ~/.docker/cli-plugins/docker-compose${C_OFF}"
    echo
    if confirm "Install & link the Compose plugin now with Homebrew?"; then
      brew install docker-compose
      mkdir -p ~/.docker/cli-plugins
      ln -sf "$(brew --prefix)/lib/docker/cli-plugins/docker-compose" ~/.docker/cli-plugins/docker-compose
      if docker compose version >/dev/null 2>&1; then
        ok "Compose plugin ready: $(docker compose version)"
      else
        err "Compose still not detected. If you use Docker Desktop, just relaunch it (it bundles Compose)."
        exit 1
      fi
    else
      err "Install the Compose plugin, then re-run 'pnpm dev'."
      exit 1
    fi
  else
    err "Install the Docker Compose plugin, then re-run 'pnpm dev': https://docs.docker.com/compose/install/"
    exit 1
  fi
else
  ok "Docker Compose found: $(docker compose version 2>/dev/null | head -1)"
fi

# --- 0c. Is the daemon actually running? -----------------------------------
if ! docker info >/dev/null 2>&1; then
  warn "Docker is installed but the daemon isn't running."
  if is_macos && [ -d "/Applications/Docker.app" ]; then
    note "Launching Docker Desktop and waiting for the daemon…"
    open -a Docker
    printf '  '
    for _ in $(seq 1 90); do      # up to ~3 minutes
      if docker info >/dev/null 2>&1; then printf '\n'; break; fi
      printf '.'; sleep 2
    done
    if ! docker info >/dev/null 2>&1; then
      printf '\n'
      err "Daemon did not come up within ~3 min. Open Docker Desktop manually, then re-run 'pnpm dev'."
      exit 1
    fi
    ok "Docker daemon is up."
  else
    err "Start your Docker engine (open Docker Desktop), then re-run 'pnpm dev'."
    exit 1
  fi
else
  ok "Docker daemon is running."
fi

# ===========================================================================
# 1. POSTGRES CONTAINER
# ===========================================================================
step "Database container"
# FRESH_DB=1 → drop the Postgres container AND its data volume first, for a truly
# clean slate. Without this the named volume (toddle_compose_pgdata) persists across
# `docker compose down` and container deletion, so previous data survives reboots.
if [ "${FRESH_DB:-}" = "1" ]; then
  warn "FRESH_DB=1 — removing the Postgres container and its data volume…"
  docker compose down -v --remove-orphans || true
  ok "Old database volume removed — starting from a clean slate"
fi
# 'up -d --wait' pulls postgres:16 on first run if it isn't cached, then blocks
# until the container's healthcheck (pg_isready) passes.
note "Starting Postgres (toddle-compose-postgres)…"
docker compose up -d --wait postgres
ok "Postgres is healthy on localhost:5432"

# ===========================================================================
# 2-3. SCHEMA + SEED  (idempotent — safe on every boot)
# ===========================================================================
if [ "${SKIP_DB_SETUP:-}" = "1" ]; then
  step "Database setup (skipped)"
  warn "SKIP_DB_SETUP=1 — not pushing schema / init / seed"
else
  step "Database setup"
  # Load .env so the Prisma CLIs and seed scripts see DATABASE_URL / REALM_* etc.
  set -a; . ./.env; set +a

  note "Syncing Prisma schema to both databases…"
  pnpm --filter @app/database exec prisma db push
  pnpm --filter @app/rtc-database exec prisma db push

  note "Bootstrapping realm/owner + demo cast…"
  pnpm --filter @app/database run init
  pnpm --filter @app/database run seed
  ok "Database ready"
fi

# ===========================================================================
# 4. APP SERVERS
# ===========================================================================
step "Starting services"
note "backend → :4000   rtc → :4001/:4002   frontend → :5173"
exec pnpm run dev:services
