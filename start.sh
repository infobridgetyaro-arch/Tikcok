#!/usr/bin/env bash
# "Start application" is the Replit webview host.
# "artifacts/bintunet: web" already owns port 5000 — we just wait for it
# and stay alive so Replit knows the workflow is healthy.
echo "Waiting for Vite frontend on port 5000..."
until curl -sf http://localhost:5000/ >/dev/null 2>&1; do
  sleep 0.5
done
echo "Frontend is ready — BintuNet Controller is live on port 5000"
exec tail -f /dev/null
