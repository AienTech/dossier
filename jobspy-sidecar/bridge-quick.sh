#!/usr/bin/env bash
# Ephemeral cloud bridge: Cloudflare quick tunnel (URL changes every restart).
# Prefer ./bridge.sh (named tunnel) for a stable hostname.
#
# Optional: if VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID are set, updates
# Production HIREME_FREEHIRE_URL automatically when the URL changes.

set -euo pipefail
cd "$(dirname "$0")"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing $1." >&2
    exit 1
  }
}

need cloudflared
need curl

TOKEN_FILE="${CLOUDFLARED_CONFIG_DIR:-$HOME/.cloudflared}/hireme-jobspy.bridge-token"
mkdir -p "$(dirname "$TOKEN_FILE")"
if [ -z "${JOBSPY_BRIDGE_TOKEN:-}" ]; then
  if [ -f "$TOKEN_FILE" ]; then
    JOBSPY_BRIDGE_TOKEN="$(tr -d '\n' <"$TOKEN_FILE")"
  else
    JOBSPY_BRIDGE_TOKEN="$(openssl rand -hex 24)"
    printf '%s' "$JOBSPY_BRIDGE_TOKEN" >"$TOKEN_FILE"
    chmod 600 "$TOKEN_FILE" 2>/dev/null || true
  fi
fi
export JOBSPY_BRIDGE_TOKEN
export JOBSPY_BRIDGE=1
export JOBSPY_HOST="${JOBSPY_HOST:-127.0.0.1}"

if ! curl -fsS "http://127.0.0.1:8787/health" >/dev/null 2>&1; then
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
  python main.py &
  for _ in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:8787/health" >/dev/null 2>&1 && break
    sleep 0.5
  done
fi

LOG="$(mktemp)"
cloudflared tunnel --url "http://127.0.0.1:8787" >"$LOG" 2>&1 &
CF_PID=$!

URL=""
for _ in $(seq 1 40); do
  URL="$(rg -o 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | head -1 || true)"
  if [ -n "$URL" ]; then
    break
  fi
  sleep 0.5
done

if [ -z "$URL" ]; then
  echo "Could not read quick-tunnel URL. cloudflared log:" >&2
  cat "$LOG" >&2
  kill "$CF_PID" 2>/dev/null || true
  exit 1
fi

echo
echo "Quick tunnel (temporary): $URL"
echo "JOBSPY_BRIDGE_TOKEN=$JOBSPY_BRIDGE_TOKEN"
echo
echo "Set on Vercel Production (or let this script patch if VERCEL_* are set):"
echo "  HIREME_FREEHIRE_URL=$URL"
echo "  HIREME_DISCOVERER=on"
echo "  HIREME_DISCOVERER_TOKEN=$JOBSPY_BRIDGE_TOKEN"
echo

if command -v vercel >/dev/null 2>&1 && [ -n "${VERCEL_TOKEN:-}" ]; then
  echo "Updating Vercel Production HIREME_FREEHIRE_URL…"
  # Remove old value then add (vercel env add is interactive without --force patterns).
  printf '%s' "$URL" | vercel env add HIREME_FREEHIRE_URL production --force --token "$VERCEL_TOKEN" 2>/dev/null \
    || echo "Could not auto-update env; set HIREME_FREEHIRE_URL manually to $URL" >&2
  printf 'on' | vercel env add HIREME_DISCOVERER production --force --token "$VERCEL_TOKEN" 2>/dev/null || true
  printf '%s' "$JOBSPY_BRIDGE_TOKEN" | vercel env add HIREME_DISCOVERER_TOKEN production --force --token "$VERCEL_TOKEN" 2>/dev/null || true
  echo "Redeploy HireMe so the new env is picked up."
fi

echo "Keeping tunnel open (pid $CF_PID). Ctrl+C to stop."
trap 'kill "$CF_PID" 2>/dev/null || true; rm -f "$LOG"' EXIT
wait "$CF_PID"
