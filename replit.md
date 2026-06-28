# BintuNet Controller

A live-stream restreaming dashboard that captures TikTok/YouTube/camera feeds and restreams them to YouTube and Facebook simultaneously via FFmpeg.

## Run & Operate

- **"Start API Server" workflow** — `PORT=8080 pnpm --filter @workspace/api-server run dev` (tsx watch, port 8080)
- **"Start application" workflow** — `PORT=5000 BASE_PATH=/ pnpm --filter @workspace/bintunet run dev` (Vite HMR, port 5000 → external 80)
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (only needed for deploy)
- `pnpm run typecheck` — full typecheck across all packages
- Admin password: `bintunet` (hardcoded in `artifacts/api-server/src/bintunet-routes.ts`)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + `ws` WebSocket server + `express-session` + `memorystore`
- No database — pure in-memory storage (`artifacts/api-server/src/storage.ts`)
- No OpenAPI codegen — direct fetch calls with TypeScript types
- Frontend: React + Vite + Tailwind v4 + shadcn/ui components
- Build: esbuild (CJS bundle for server)

## Where things live

- `artifacts/api-server/src/bintunet-routes.ts` — all API + WebSocket routes
- `artifacts/api-server/src/stream-manager.ts` — FFmpeg process management
- `artifacts/api-server/src/source-relay.ts` — **SourceRelay** self-healing pipe manager (TikTok/YouTube)
- `artifacts/api-server/src/storage.ts` — in-memory store for streams
- `artifacts/api-server/src/schema.ts` — StreamConfig zod schema (13 core fields, no overlay)
- `artifacts/api-server/src/tiktok-extractor.ts` — legacy TikTok HLS URL extraction (kept for reference)
- `artifacts/api-server/src/youtube-source.ts` — YouTube live URL resolution helpers
- `artifacts/bintunet/src/types/schema.ts` — shared TypeScript types (StreamConfig)
- `artifacts/bintunet/src/components/stream-card.tsx` — main per-stream control card
- `artifacts/bintunet/src/components/live-preview.tsx` — HLS live preview via hls.js

## Architecture decisions

- **No OpenAPI / codegen** — direct fetch + TypeScript types shared via `artifacts/bintunet/src/types/schema.ts`
- **In-memory storage** — no DB; streams lost on server restart (by design for this use-case)
- **WebSocket** — `ws` library on raw `http.createServer`; exposed at `/ws` path in artifact.toml
- **Session auth** — `express-session` + `memorystore`; password is `"bintunet"` (change in production)
- **No overlay** — overlay system was fully removed; FFmpeg does plain scale+pad+encode only
- **SourceRelay (self-healing pipe)** — TikTok and YouTube both use `sourceType="tiktok_pipe"` / `"youtube_pipe"`. `resolveInputUrl` returns `{ url: "pipe:0" }` immediately (no temp CDN URL). `SourceRelay` spawns `streamlink --stdout` and pipes to FFmpeg stdin via `.on('data')` (NOT `.pipe()` — to keep stdin open). When streamlink dies, relay respawns it with backoff; FFmpeg never disconnects from RTMP. See `source-relay.ts`.

## Product

Users log in with a password, then add multiple simultaneous streams. Each stream can capture from TikTok (via streamlink), YouTube live (via yt-dlp), or a camera device/RTSP URL. Streams rebroadcast to YouTube RTMP and optionally Facebook RTMP. Invite links allow additional users to access the dashboard without knowing the password.

## StreamConfig fields

`id`, `sourceType`, `tiktokUsername`, `youtubeSourceUrl`, `cameraDevice`, `youtubeStreamKey`, `facebookRtmpUrl`, `ratio`, `quality`, `fps`, `muted`, `autoRestart`, `status` — that's it, no overlay fields.

## Gotchas

- **FFmpeg must be installed on the server** for streaming to work
- **streamlink** must be installed for TikTok live preview
- **yt-dlp** must be installed for YouTube source mode
- The `/ws` WebSocket path is registered in both `artifact.toml` and handled in `index.ts` via `http.createServer`
- Session secret comes from `SESSION_SECRET` env var (falls back to a dev default)
- Express 5: `req.params.id` is typed `string | string[]` — use `String(req.params.id)` to pass as string

## User preferences

_Populate as you build._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
