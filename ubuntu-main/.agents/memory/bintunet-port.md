---
name: BintuNet port decisions
description: Key architectural choices made when porting BintuNet Controller into the pnpm monorepo
---

## Decisions

- **No OpenAPI / codegen** — direct fetch calls with TypeScript types in `artifacts/bintunet/src/types/schema.ts`. `@shared/schema` imports were replaced with `@/types/schema`.
- **No database** — pure in-memory storage (`artifacts/api-server/src/storage.ts`). No `DATABASE_URL` needed.
- **WebSocket** — `ws` library; server created with `http.createServer(app)` in `index.ts`; routes registered via `registerBintunetRoutes(httpServer, app)`. The `/ws` path must appear in the `[[services]] paths` array in `artifact.toml` or the proxy won't route WS connections.
- **Session auth** — `express-session` + `memorystore`; admin password hardcoded as `"bintunet"` in `bintunet-routes.ts`.
- **`zod` must be in api-server `dependencies`** — it imports `zod` in `schema.ts` and esbuild won't bundle it unless it's listed there.
- **Tailwind v4** — bintunet uses `@import "tailwindcss"` (v4 style). CSS variables for colors must use HSL triplets (no `hsl()` wrapper). The template ships with `red` placeholders that must all be replaced.
- **Frontend deps** — `hls.js` and `react-icons` must be installed in the `bintunet` package (`pnpm add hls.js react-icons` inside `artifacts/bintunet`).
- **Logo uploads** — stored under `artifacts/api-server/uploads/`; multer config in `bintunet-routes.ts`.

**Why:** The original app had no DB or codegen. Keeping the same pattern avoids unnecessary complexity and stays faithful to the original architecture.

**How to apply:** When adding features to BintuNet, keep changes in `bintunet-routes.ts` (routes) and `stream-manager.ts` (FFmpeg). Prefer in-memory updates over DB migrations. If WebSocket messages stop working, check the artifact.toml paths array first.
