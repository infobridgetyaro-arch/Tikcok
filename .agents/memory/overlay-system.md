---
name: Overlay system field sync
description: Adding a new overlay field requires changes in 5 places — miss one and the field silently defaults or breaks the stream.
---

When adding a new overlay field:

1. **`artifacts/api-server/src/schema.ts`** — add Zod field with `.default()`
2. **`artifacts/bintunet/src/types/schema.ts`** — mirror as TypeScript type
3. **`artifacts/api-server/src/storage.ts`** — add default in `createStream` object (TS will error if missing)
4. **`artifacts/api-server/src/stream-manager.ts`** — use in `buildOverlayFilter` and/or `buildFFmpegArgs`; also update `hasOverlayText` condition if needed
5. **`artifacts/bintunet/src/components/overlay-admin.tsx`** — add to `OverlayDraft` type, `buildDraft`, and the UI section

**Why:** The system uses `(stream as any).newField` casts in stream-manager because StreamConfig type is inferred from Zod; storage.ts uses concrete types so TypeScript flags missing fields there directly.

**How to apply:** The storage.ts error is the most reliable signal — if you add a field to schema.ts but not storage.ts, TS will fail with "missing N properties from type StreamConfig".

Textfile hot-reload: text-only changes (channel name, headline, ticker, ltName, ltTitle, messageText, subBox count) update without stream restart via `writeOverlayTextFiles`. Structural changes (style, position, color, enable/disable) go through `applyOverlayChanges` which gracefully restarts the encoder (~3–5s gap).
