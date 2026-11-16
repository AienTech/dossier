#!/bin/sh
set -eu
case "${1:-web}" in
  web)
    export HIREME_RUNTIME=web
    cd /app
    node prepare-schema.mjs
    ;;
  worker)
    export HIREME_RUNTIME=worker
    # The same release lock protects both roles during a rolling update.
    cd /app
    node prepare-schema.mjs
    cd /app/tools
    node seed.mjs
    ;;
  *) echo "Expected web or worker." >&2; exit 1 ;;
esac
cd /app
if [ "$HIREME_RUNTIME" = "worker" ]; then
  exec node --import ./warm-worker.mjs server.js
fi
exec node server.js
