# BintuNet - Live Stream Control Panel

## Overview
BintuNet is a modern, mobile-friendly web UI for controlling live-streaming using FFmpeg. It enables users to restream TikTok live content to YouTube and Facebook simultaneously.

## Tech Stack
- **Frontend**: React + TypeScript + Tailwind CSS + Shadcn/UI + hls.js (preview)
- **Backend**: Express.js with TypeScript
- **Real-time**: WebSocket for log streaming and status updates
- **Auth**: Session-based with hardcoded password ("bintunet")
- **Storage**: In-memory (streams are transient processes)
- **TikTok Extraction**: Custom direct API extraction (no yt-dlp/streamlink dependency)

## Project Structure
```
client/src/
  App.tsx              - Main app with auth routing
  pages/
    login.tsx          - Password login page
    dashboard.tsx      - Main stream management dashboard
  components/
    stream-card.tsx    - Individual stream configuration/control card
    live-preview.tsx   - HLS.js live preview video player
  hooks/
    use-auth.ts        - Authentication hook
    use-websocket.ts   - WebSocket connection hook
server/
  index.ts             - Express server setup
  routes.ts            - API routes + WebSocket setup
  storage.ts           - In-memory stream storage
  stream-manager.ts    - FFmpeg process management (uses tiktok-extractor)
  tiktok-extractor.ts  - Direct TikTok API stream URL extraction (multiple fallbacks)
shared/
  schema.ts            - Shared types and Zod schemas
```

## Key Features
- Login with password "bintunet"
- Multiple simultaneous streams (unlimited)
- TikTok → YouTube/Facebook restreaming
- Live preview video player (HLS.js) to verify TikTok user is live
- Real-time log output via WebSocket
- Mute/unmute during live stream (sends silent audio, no connection drop)
- Auto-restart on failure (toggle)
- Mobile/Desktop layout ratio selection
- Quality (best/720p/480p) and FPS (20/25/30) selection
- Sky-blue theme
- **Broadcast Overlay (Al Jazeera style)**:
  - Channel logo (upload PNG/JPG, position in any corner, adjustable size)
  - Logo animations: pulse, breathe, fade-in, flash (FFmpeg colorchannelmixer alpha)
  - Lower-third banner with channel name + headline/subscriber count
  - Scrolling ticker text at bottom (configurable speed and colors)
  - Mini overlay preview in the UI with CSS animation previews
  - All rendered via FFmpeg filters (drawtext, overlay, drawbox)
  - **Live Adjust**: All overlay settings editable while streaming (auto FFmpeg restart with 1.5s debounce)
  - **YouTube Live Count**: Optional auto-updating viewer/subscriber count via YouTube Data API v3 (textfile+reload=1)
  - Text overlay uses FFmpeg textfile with reload=1 for dynamic updates without restart

## Invite Link System
- Admin clicks "Invite" button in the dashboard header to get a shareable link
- Link format: `/join?token=<hex_token>` — token persists until admin regenerates it
- `/join` page: verifies token via `POST /api/invite/claim`, auto-logs user in, redirects to dashboard
- Admin can regenerate the token (invalidating old links) via the Invite modal
- API: `GET /api/invite` (admin), `POST /api/invite/regenerate` (admin), `POST /api/invite/claim` (public)

## Camera Source
- Accepts local device paths (`/dev/video0`, `0`, `video=USB Camera`) OR RTSP/HTTP URLs
- RTSP/HTTP URLs (e.g. `rtsp://192.168.x.x:4747/video`) are treated as network stream inputs
- Camera guide in UI covers: USB webcam, DroidCam (Android), EpocCam (iOS), IP/RTSP cameras, OBS Virtual Camera

## TikTok Stream Extraction
Uses multiple fallback methods (no external tools like yt-dlp/streamlink):
1. Scrape room ID from TikTok profile page
2. Fallback: TikTok live detail API
3. Fetch stream URLs via webcast API (aid=1988)
4. Fallback: alternate webcast API (aid=1233)
5. Last resort: scrape FLV/HLS URLs from page HTML

## API Endpoints
- POST /api/auth/login - Login with password
- GET /api/auth/check - Check auth status
- POST /api/auth/logout - Logout
- GET /api/streams - List all streams
- POST /api/streams - Create new stream
- PATCH /api/streams/:id - Update stream config
- DELETE /api/streams/:id - Delete stream
- POST /api/streams/:id/start - Start streaming
- POST /api/streams/:id/stop - Stop streaming
- POST /api/streams/:id/restart - Restart streaming
- POST /api/streams/:id/mute - Toggle mute
- GET /api/streams/:id/preview - Get HLS/FLV preview URLs for a stream
- GET /api/preview/:username - Get preview URLs by TikTok username
- POST /api/upload/logo - Upload channel logo image (multipart, field: "logo")
- GET /api/streams/:id/live-count - Get cached YouTube live viewer count

## Project Structure (additions)
```
server/
  youtube-counter.ts   - YouTube Data API live count fetcher with textfile polling
tmp_overlay/           - Runtime temp files for FFmpeg textfile reload (headline/ticker per stream)
```

## WebSocket
- Path: /ws
- Messages: { type: "log"|"status", streamId: string, data: any }
