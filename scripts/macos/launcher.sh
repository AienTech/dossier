#!/bin/bash
# Starts the HireMe checkout for the Mac app (or the system browser when run
# by hand). The Mac app sets HIREME_NO_OPEN=1 and shows the site in its own
# window. The server runs in production (`yarn start`) so Turbopack/HMR cannot
# reload the WKWebView in a loop. A build runs when the checkout moved since
# the last one (git HEAD or local source changes). Dependency installs run when yarn.lock
# is newer than the install state.

set -u

NODE24="/opt/homebrew/opt/node@24/bin"
export PATH="$NODE24:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

HIREME_DIR="${HIREME_DIR:-$HOME/Documents/hireme}"
URL="http://127.0.0.1:3000"
LOG_DIR="$HOME/Library/Logs"
LOG_FILE="$LOG_DIR/HireMe.log"
SUPPORT_DIR="$HOME/Library/Application Support/HireMe"
PID_FILE="$SUPPORT_DIR/server.pid"
MODE_FILE="$SUPPORT_DIR/server.mode"
BUILD_STAMP="$SUPPORT_DIR/build.stamp"
PG_ISREADY="/opt/homebrew/opt/postgresql@18/bin/pg_isready"

mkdir -p "$LOG_DIR" "$SUPPORT_DIR"

alert() {
  osascript -e "display alert \"HireMe\" message \"$1\" as critical" >/dev/null 2>&1 || true
}

notify() {
  osascript -e "display notification \"$1\" with title \"HireMe\"" >/dev/null 2>&1 || true
}

server_up() {
  curl -fsS -o /dev/null --max-time 2 "$URL/api/health"
}

listener_pid() {
  lsof -nP -tiTCP:3000 -sTCP:LISTEN 2>/dev/null | head -1
}

# The Mac wrapper needs production. An old `yarn dev` on :3000 is what made the
# window flicker (HMR full-page reloads). Treat only a stamped production start
# as already good.
production_server_up() {
  server_up || return 1
  [[ -f "$MODE_FILE" ]] || return 1
  [[ "$(cat "$MODE_FILE" 2>/dev/null || true)" == "production" ]] || return 1
  return 0
}

stop_server() {
  local pid="" listener=""
  if [[ -f "$PID_FILE" ]]; then
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  fi
  listener="$(listener_pid || true)"
  if [[ -n "$pid" ]]; then
    kill "$pid" >/dev/null 2>&1 || true
    pkill -P "$pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$listener" ]]; then
    kill "$listener" >/dev/null 2>&1 || true
    pkill -P "$listener" >/dev/null 2>&1 || true
  fi
  rm -f "$PID_FILE" "$MODE_FILE"
}

open_app() {
  if [[ "${HIREME_NO_OPEN:-}" == "1" ]]; then
    return 0
  fi
  open "$URL"
}

ensure_node() {
  if [[ ! -x "$NODE24/node" ]]; then
    alert "Node 24 is not installed. HireMe needs it for sign-in. Install it with: brew install node@24"
    exit 1
  fi
  local version
  version="$("$NODE24/node" -v)"
  case "$version" in
    v24.*) ;;
    *)
      alert "HireMe needs Node 24 (found $version)."
      exit 1
      ;;
  esac
}

ensure_postgres() {
  if "$PG_ISREADY" -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
    return 0
  fi
  notify "Starting PostgreSQL…"
  brew services start postgresql@18 >>"$LOG_FILE" 2>&1 || true
  local i
  for i in $(seq 1 30); do
    if "$PG_ISREADY" -h 127.0.0.1 -p 5432 >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  alert "PostgreSQL did not start. The log is at $LOG_FILE."
  exit 1
}

ensure_dependencies() {
  local state="$HIREME_DIR/node_modules/.yarn-state.yml"
  if [[ ! -d "$HIREME_DIR/node_modules" || "$HIREME_DIR/yarn.lock" -nt "$state" ]]; then
    notify "Installing HireMe dependencies…"
    if ! yarn install >>"$LOG_FILE" 2>&1; then
      alert "Installing dependencies failed. The log is at $LOG_FILE."
      exit 1
    fi
  fi
}

# PDF rendering launches Playwright's headless Chromium. The install is a
# no-op once that browser is already in the user cache.
ensure_pdf_browser() {
  if ! node node_modules/playwright-core/cli.js install --only-shell chromium >>"$LOG_FILE" 2>&1; then
    alert "The PDF browser could not be installed. Downloads will fail until it is. The log is at $LOG_FILE."
  fi
}

checkout_stamp() {
  local head="" source_hash=""
  head="$(git -C "$HIREME_DIR" rev-parse HEAD 2>/dev/null || echo nogit)"
  # Include local edits and new source files, such as an MCP tool that has
  # not been committed yet. Generated builds, job files and secrets stay out.
  source_hash="$(
    cd "$HIREME_DIR" &&
      git ls-files -co --exclude-standard -z -- src prisma scripts package.json yarn.lock next.config.ts tsconfig.json |
      sort -zu |
      xargs -0 shasum -a 256 |
      shasum -a 256 |
      cut -d ' ' -f 1
  )"
  printf '%s:%s\n' "$head" "$source_hash"
}

needs_build() {
  [[ -f "$HIREME_DIR/.next/BUILD_ID" ]] || return 0
  [[ -f "$BUILD_STAMP" ]] || return 0
  [[ "$(cat "$BUILD_STAMP" 2>/dev/null || true)" == "$(checkout_stamp)" ]] || return 0
  return 1
}

# Match the production image: standalone needs .next/static and public beside
# server.js (see Dockerfile). `next start` warns and is the wrong entry for
# output: "standalone".
prepare_standalone() {
  local stand="$HIREME_DIR/.next/standalone"
  mkdir -p "$stand/.next"
  rm -rf "$stand/.next/static"
  cp -R "$HIREME_DIR/.next/static" "$stand/.next/static"
  if [[ -d "$HIREME_DIR/public" ]]; then
    rm -rf "$stand/public"
    cp -R "$HIREME_DIR/public" "$stand/public"
  fi
  # So the server reads the same .env as yarn start from the checkout root.
  ln -sfn "$HIREME_DIR/.env" "$stand/.env"
  if [[ -f "$HIREME_DIR/.env.local" ]]; then
    ln -sfn "$HIREME_DIR/.env.local" "$stand/.env.local"
  fi
}

ensure_build() {
  if ! needs_build; then
    prepare_standalone
    return 0
  fi
  notify "Building HireMe…"
  if ! yarn build >>"$LOG_FILE" 2>&1; then
    alert "Building HireMe failed. The log is at $LOG_FILE."
    exit 1
  fi
  prepare_standalone
  checkout_stamp >"$BUILD_STAMP"
}

start_server() {
  ensure_build
  notify "Starting HireMe…"
  # Bind to the same host the Mac window loads (127.0.0.1).
  (
    cd "$HIREME_DIR/.next/standalone"
    nohup env HOSTNAME=127.0.0.1 PORT=3000 node server.js >>"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
  )
  echo production >"$MODE_FILE"
  local i
  for i in $(seq 1 90); do
    if server_up; then
      return 0
    fi
    if ! kill -0 "$(cat "$PID_FILE")" >/dev/null 2>&1; then
      alert "HireMe stopped while starting. The log is at $LOG_FILE."
      exit 1
    fi
    sleep 1
  done
  alert "HireMe did not become ready. The log is at $LOG_FILE."
  exit 1
}

update_source() {
  cd "$HIREME_DIR"
  notify "Updating HireMe…"
  if ! git pull --ff-only >>"$LOG_FILE" 2>&1; then
    alert "The update could not fast-forward. Your local changes are untouched. The log is at $LOG_FILE."
    exit 1
  fi
  ensure_dependencies
  rm -f "$BUILD_STAMP"
  if server_up; then
    stop_server
    sleep 1
  fi
  start_server
  open_app
  notify "HireMe updated."
}

cd "$HIREME_DIR" 2>/dev/null || {
  alert "Couldn't find the HireMe project at $HIREME_DIR."
  exit 1
}

{
  echo "----- $(date) -----"
  echo "node: $("$NODE24/node" -v 2>/dev/null || echo missing)"
} >>"$LOG_FILE"

mode="${1:-open}"
case "$mode" in
  quit|stop)
    stop_server
    notify "HireMe stopped."
    exit 0
    ;;
  update)
    ensure_node
    ensure_postgres
    update_source
    exit 0
    ;;
esac

ensure_node

if production_server_up && ! needs_build; then
  open_app
  exit 0
fi

# Something else (often `yarn dev`) may already hold :3000 — replace it.
if server_up; then
  stop_server
  sleep 1
fi

ensure_postgres
ensure_dependencies
ensure_pdf_browser
start_server
open_app
notify "HireMe is ready."
