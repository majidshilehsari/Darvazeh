#!/bin/bash
set -euo pipefail
umask 077
# The public port is fixed; never expose the panel backend directly.
export PORT=8081
# Optional emergency bypass: retain the original WS-to-Xray path.
if [ "${MONITOR_ENABLED:-1}" != "1" ]; then
  sed 's/127.0.0.1:10001/127.0.0.1:10000/g' /etc/nginx/nginx.conf > /tmp/darvazeh-nginx.conf
else
  cp /etc/nginx/nginx.conf /tmp/darvazeh-nginx.conf
fi
python3 /app/server.py &
PANEL=$!
nginx -c /tmp/darvazeh-nginx.conf -g 'daemon off;' &
EDGE=$!
trap 'kill "$PANEL" "$EDGE" 2>/dev/null || true; wait || true' EXIT
trap 'exit 0' TERM INT
wait -n "$PANEL" "$EDGE"
exit 1
