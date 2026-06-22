import { createServer } from "http";
import app from "./app";
import { registerBintunetRoutes } from "./bintunet-routes";
import { logger } from "./lib/logger";
import { hybridStorage } from "./state/redis-storage";
import { startHeartbeat } from "./state/heartbeat";
import { wsBus } from "./state/ws-bus";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const httpServer = createServer(app);

async function bootstrap() {
  // ── Load stream configs from Redis (if configured) ─────────────────────
  await hybridStorage.init();

  // ── Start Redis pub/sub WebSocket bus (multi-node WS fan-out) ──────────
  await wsBus.start();

  // ── Register all API + WebSocket routes ────────────────────────────────
  await registerBintunetRoutes(httpServer, app);

  // ── Start HTTP server ──────────────────────────────────────────────────
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(port, (err?: Error) => {
      if (err) reject(err);
      else resolve();
    });
  });

  logger.info({ port }, "Server listening");

  // ── Start heartbeat AFTER server is confirmed listening ─────────────────
  // Only the primary writes heartbeat; backup just runs failover-watcher.
  startHeartbeat();
}

bootstrap().catch((err) => {
  logger.error({ err }, "Bootstrap failed");
  process.exit(1);
});
