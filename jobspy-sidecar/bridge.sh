#!/usr/bin/env bash
# Persistent cloud bridge: named Cloudflare tunnel → local JobSpy sidecar.
# Hostname stays the same across restarts (unlike quick tunnels).
#
# Prerequisites:
#   brew install cloudflared
#   A domain on Cloudflare
#
# First-time setup (once):
#   export BRIDGE_HOSTNAME=jobspy.example.com   # hostname you will route
#   ./bridge.sh setup
#
# Daily:
#   export JOBSPY_BRIDGE_TOKEN=…                # same value as HIREME_DISCOVERER_TOKEN on Vercel
#   ./bridge.sh
#
# Vercel Production (set once with the stable hostname):
#   HIREME_FREEHIRE_URL=https://jobspy.example.com
#   HIREME_DISCOVERER=on
#   HIREME_DISCOVERER_TOKEN=<same as JOBSPY_BRIDGE_TOKEN>

set -euo pipefail
cd "$(dirname "$0")"

TUNNEL_NAME="${TUNNEL_NAME:-hireme-jobspy}"
CONFIG_DIR="${CLOUDFLARED_CONFIG_DIR:-$HOME/.cloudflared}"
CONFIG_FILE="${CONFIG_DIR}/${TUNNEL_NAME}.yml"
TOKEN_FILE="${CONFIG_DIR}/${TUNNEL_NAME}.bridge-token"
BRIDGE_HOSTNAME="${BRIDGE_HOSTNAME:-}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing $1. Install cloudflared with: brew install cloudflared" >&2
    exit 1
  }
}

ensure_token() {
  if [ -n "${JOBSPY_BRIDGE_TOKEN:-}" ]; then
    printf '%s' "$JOBSPY_BRIDGE_TOKEN" >"$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE" 2>/dev/null || true
    return
  fi
  if [ -f "$TOKEN_FILE" ]; then
    JOBSPY_BRIDGE_TOKEN="$(tr -d '\n' <"$TOKEN_FILE")"
    export JOBSPY_BRIDGE_TOKEN
    return
  fi
  JOBSPY_BRIDGE_TOKEN="$(openssl rand -hex 24)"
  mkdir -p "$CONFIG_DIR"
  printf '%s' "$JOBSPY_BRIDGE_TOKEN" >"$TOKEN_FILE"
  chmod 600 "$TOKEN_FILE" 2>/dev/null || true
  export JOBSPY_BRIDGE_TOKEN
  echo "Generated JOBSPY_BRIDGE_TOKEN (saved in $TOKEN_FILE)."
}

start_sidecar() {
  if curl -fsS "http://127.0.0.1:8787/health" >/dev/null 2>&1; then
    echo "Sidecar already answering on :8787."
    return
  fi
  if [ ! -d .venv ]; then
    python3 -m venv .venv
    # shellcheck disable=SC1091
    source .venv/bin/activate
    pip install -r requirements.txt
  else
    # shellcheck disable=SC1091
    source .venv/bin/activate
  fi
  [ -f companies.yml ] || cp companies.example.yml companies.yml
  export JOBSPY_BRIDGE=1
  export JOBSPY_BRIDGE_TOKEN
  export JOBSPY_HOST="${JOBSPY_HOST:-127.0.0.1}"
  echo "Starting JobSpy sidecar on http://127.0.0.1:8787 …"
  python main.py &
  SIDECAR_PID=$!
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:8787/health" >/dev/null 2>&1; then
      echo "Sidecar ready (pid $SIDECAR_PID)."
      return
    fi
    sleep 0.5
  done
  echo "Sidecar did not become healthy." >&2
  exit 1
}

setup() {
  need cloudflared
  if [ -z "$BRIDGE_HOSTNAME" ]; then
    echo "Set BRIDGE_HOSTNAME to the stable hostname, e.g.:" >&2
    echo "  export BRIDGE_HOSTNAME=jobspy.example.com" >&2
    echo "  ./bridge.sh setup" >&2
    exit 1
  fi
  mkdir -p "$CONFIG_DIR"
  echo "Logging into Cloudflare (browser)…"
  cloudflared tunnel login
  if ! cloudflared tunnel list 2>/dev/null | grep -q "$TUNNEL_NAME"; then
    cloudflared tunnel create "$TUNNEL_NAME"
  else
    echo "Tunnel $TUNNEL_NAME already exists."
  fi
  cloudflared tunnel route dns "$TUNNEL_NAME" "$BRIDGE_HOSTNAME" || true
  CREDENTIALS="$(ls "$CONFIG_DIR"/*-"$TUNNEL_NAME".json 2>/dev/null | head -1 || true)"
  if [ -z "$CREDENTIALS" ]; then
    # Newer cloudflared stores as <tunnel-id>.json; resolve via tunnel info.
    TUNNEL_ID="$(cloudflared tunnel list | awk -v n="$TUNNEL_NAME" '$2==n {print $1; exit}')"
    CREDENTIALS="${CONFIG_DIR}/${TUNNEL_ID}.json"
  fi
  cat >"$CONFIG_FILE" <<EOF
tunnel: ${TUNNEL_NAME}
credentials-file: ${CREDENTIALS}
ingress:
  - hostname: ${BRIDGE_HOSTNAME}
    service: http://127.0.0.1:8787
  - service: http_status:404
EOF
  echo
  echo "Named tunnel configured."
  echo "Config: $CONFIG_FILE"
  echo
  echo "Set these on Vercel (Production), once:"
  echo "  HIREME_FREEHIRE_URL=https://${BRIDGE_HOSTNAME}"
  echo "  HIREME_DISCOVERER=on"
  echo "  HIREME_DISCOVERER_TOKEN=<run ./bridge.sh once to generate, or set JOBSPY_BRIDGE_TOKEN>"
  echo
  echo "Then: ./bridge.sh"
}

run() {
  need cloudflared
  ensure_token
  if [ ! -f "$CONFIG_FILE" ]; then
    echo "No named tunnel config at $CONFIG_FILE." >&2
    echo "Run: BRIDGE_HOSTNAME=jobspy.example.com ./bridge.sh setup" >&2
    echo "Or for a one-shot URL: ./bridge-quick.sh" >&2
    exit 1
  fi
  HOSTNAME_LINE="$(awk -F': ' '/hostname:/{print $2; exit}' "$CONFIG_FILE" || true)"
  start_sidecar
  echo
  echo "Stable URL: https://${HOSTNAME_LINE:-<see config>}"
  echo "Token file: $TOKEN_FILE"
  echo "Keep this process running while the Mac bridges to Vercel."
  echo
  exec cloudflared tunnel --config "$CONFIG_FILE" run "$TUNNEL_NAME"
}

case "${1:-run}" in
  setup) setup ;;
  run|"") run ;;
  *)
    echo "Usage: ./bridge.sh [setup|run]" >&2
    exit 1
    ;;
esac
