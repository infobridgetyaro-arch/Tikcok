#!/usr/bin/env bash
set -e

# Clear any stale process holding port 5000 from a previous run
fuser -k 5000/tcp 2>/dev/null || true

# Start the Vite frontend (foreground)
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/bintunet run dev
