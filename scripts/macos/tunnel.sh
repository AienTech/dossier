#!/bin/bash
# An account-free HTTPS address for the local HireMe app. OAuth stays enabled.
set -eu

LABEL="me.hireme.tunnel"
DOMAIN="gui/$(id -u)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/HireMe-tunnel.log"
CLOUDFLARED="/opt/homebrew/bin/cloudflared"

show_address() {
  if [[ -f "$LOG" ]]; then
    sed -nE 's/.*(https:\/\/[a-z0-9-]+\.trycloudflare\.com).*/\1/p' "$LOG" | tail -1
  fi
}

case "${1:-status}" in
  start)
    if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      show_address
      exit 0
    fi
    if [[ ! -x "$CLOUDFLARED" ]]; then
      echo "Install cloudflared first: brew install cloudflared" >&2
      exit 1
    fi
    curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:3000/api/health
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    : > "$LOG"
    /usr/bin/python3 - "$PLIST" "$CLOUDFLARED" "$LOG" "$LABEL" <<'PY'
import plistlib
import sys
from pathlib import Path
plist, binary, log, label = sys.argv[1:]
Path(plist).write_bytes(plistlib.dumps({
    "Label": label,
    "ProgramArguments": [binary, "tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:3000", "--protocol", "http2"],
    "RunAtLoad": True,
    "KeepAlive": True,
    "ThrottleInterval": 30,
    "StandardOutPath": log,
    "StandardErrorPath": log,
}))
PY
    launchctl bootstrap "$DOMAIN" "$PLIST"
    echo "Tunnel starting. Run this script with status to get its HTTPS address."
    ;;
  status)
    if ! launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
      echo "HireMe tunnel is stopped."
      exit 1
    fi
    show_address
    ;;
  stop)
    launchctl bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
    rm -f "$PLIST"
    echo "HireMe tunnel stopped; automatic startup disabled."
    ;;
  *)
    echo "Usage: $0 start|status|stop" >&2
    exit 1
    ;;
esac
