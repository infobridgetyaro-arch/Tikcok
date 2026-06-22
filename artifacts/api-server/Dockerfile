# BintuNet API Server — Production Docker Image
#
# Build:  docker build -f artifacts/api-server/Dockerfile -t bintunet-api .
# Run:    docker run -e PORT=8080 -e SESSION_SECRET=xxx -p 8080:8080 bintunet-api

FROM node:24-bookworm-slim AS base

# ── System tools: ffmpeg, streamlink, yt-dlp ──────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      python3-venv \
      curl \
      ca-certificates \
    && python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --quiet --upgrade pip \
    && /opt/venv/bin/pip install --quiet streamlink yt-dlp \
    && ln -sf /opt/venv/bin/streamlink /usr/local/bin/streamlink \
    && ln -sf /opt/venv/bin/yt-dlp    /usr/local/bin/yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

RUN npm install -g pnpm@10 --silent

# ── Workspace setup ─────────────────────────────────────────────────────────
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy only the package manifests first (for layer caching)
COPY artifacts/api-server/package.json   ./artifacts/api-server/
COPY lib/api-zod/package.json            ./lib/api-zod/
COPY lib/db/package.json                 ./lib/db/   2>/dev/null || true
COPY lib/api-spec/package.json           ./lib/api-spec/  2>/dev/null || true
COPY lib/api-client-react/package.json   ./lib/api-client-react/  2>/dev/null || true

RUN pnpm install --frozen-lockfile

# ── Source code ─────────────────────────────────────────────────────────────
COPY lib/                          ./lib/
COPY artifacts/api-server/         ./artifacts/api-server/
COPY scripts/                      ./scripts/

# ── Pre-built frontend (built in CI before docker build) ────────────────────
# If artifacts/bintunet/dist exists (CI built it), copy it in
COPY artifacts/bintunet/dist/      ./artifacts/bintunet/dist/  2>/dev/null || true

# ── Build API server ─────────────────────────────────────────────────────────
RUN pnpm --filter @workspace/api-server run build

# ── Runtime directories ──────────────────────────────────────────────────────
RUN mkdir -p /app/uploads /tmp/hls \
    && touch /app/uploads/.gitkeep

# ── Health check ─────────────────────────────────────────────────────────────
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -sf http://localhost:8080/api/health || exit 1

CMD ["node", "--enable-source-maps", "./artifacts/api-server/dist/index.mjs"]
