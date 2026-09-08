#!/bin/bash
# Quick smoke test for freellm-hub
set -e
cd /vol1/1000/Docker/freellm-hub

pkill -9 -f 'tsx.*src/index' 2>/dev/null || true
sleep 1

# Start server
nohup npx tsx src/index.ts > /tmp/hub.log 2>&1 &
SERVER_PID=$!
trap "kill -9 $SERVER_PID 2>/dev/null" EXIT

# Wait for ready
for i in 1 2 3 4 5; do
  if curl -m 1 -s http://127.0.0.1:3030/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "=== Server log (head) ==="
head -5 /tmp/hub.log

echo ""
echo "=== /health ==="
curl -m 3 -sw "[HTTP %{http_code}]\n" http://127.0.0.1:3030/health

echo "=== /v1/ping ==="
curl -m 3 -sw "[HTTP %{http_code}]\n" http://127.0.0.1:3030/v1/ping

echo "=== /v1/models ==="
curl -m 3 -sw "[HTTP %{http_code}]\n" http://127.0.0.1:3030/v1/models

echo "=== /nope (404) ==="
curl -m 3 -sw "[HTTP %{http_code}]\n" http://127.0.0.1:3030/nope

echo ""
echo "=== ✅ All curls completed ==="
