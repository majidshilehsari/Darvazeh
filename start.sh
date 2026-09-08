#!/bin/bash
set -euo pipefail
# The public port is fixed; never expose the panel backend directly.
export PORT=8081
python3 /app/server.py &
PANEL=$!
nginx -g 'daemon off;' &
EDGE=$!
trap 'kill "$PANEL" "$EDGE" 2>/dev/null || true; wait || true' EXIT
trap 'exit 0' TERM INT
wait -n "$PANEL" "$EDGE"
exit 1
