# BintuNet Controller

A live-streaming controller dashboard for managing RTMP streams, multi-platform relay, HLS encoding, donations, and gifts.

## Stack

- **Frontend**: React + Vite + Tailwind CSS + shadcn/ui (port 5000)
- **Backend**: Express + TypeScript API server (port 8080)
- **Monorepo**: pnpm workspaces (`artifacts/bintunet`, `artifacts/api-server`)

## How to run

Both workflows start automatically:

| Workflow | Command | Port |
|---|---|---|
| Start application | `PORT=5000 BASE_PATH=/ pnpm --filter @workspace/bintunet run dev` | 5000 |
| Start API Server | `PORT=8080 pnpm --filter @workspace/api-server run dev` | 8080 |

Install dependencies first (already done): `pnpm install`

## Login

Default dashboard password: `bintunet` (set via `BINTUNET_PASSWORD` env var)

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | ✅ Yes | Set as a Replit secret |
| `BINTUNET_PASSWORD` | ✅ Yes | Dashboard login password (default: `bintunet`) |
| `REDIS_URL` | Optional | Upstash Redis for multi-node HA mode |
| `YOUTUBE_API_KEY` | Optional | Live viewer/subscriber count polling |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `CDN_BASE_URL` | Optional | Cloudflare R2 for HLS CDN |
| `VPS_ROLE` | Optional | `primary` or `backup` (default: `primary`) |
| `HLS_ENABLED` | Optional | `true` to enable HLS encoder (default: `false`) |

See `.env.example` for full reference.

## User preferences
