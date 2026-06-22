#!/usr/bin/env node
/**
 * failover-watcher.mjs — Backup VPS automatic stream recovery
 *
 * Run ONLY on the BACKUP VPS (set by PM2 in deploy workflow):
 *   pm2 start scripts/failover-watcher.mjs --name failover-watcher
 *
 * What it does:
 *   1. Connects to shared Redis (same instance as primary).
 *   2. Polls the primary heartbeat key every FAILOVER_POLL_MS (default: 5s).
 *   3. If heartbeat age > FAILOVER_TIMEOUT_MS (default: 15s), the primary is
 *      assumed to have crashed.
 *   4. Reads the list of stream IDs that were actively streaming on primary.
 *   5. Calls the local (backup) API to start each stream.
 *   6. Enters cooldown for 60s to prevent thrashing if primary flaps.
 *
 * Requirements:
 *   - REDIS_URL must point to the shared Redis instance
 *   - Local API must be running on PORT (default 8080)
 *   - BINTUNET_PASSWORD for API authentication
 *
 * Set in .env.production on backup VPS:
 *   VPS_ROLE=backup
 *   REDIS_URL=redis://...
 *   BINTUNET_PASSWORD=your_password
 *   FAILOVER_POLL_MS=5000
 *   FAILOVER_TIMEOUT_MS=15000
 *   PORT=8080
 */

import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL;
const POLL_MS = Number(process.env.FAILOVER_POLL_MS) || 5_000;
const TIMEOUT_MS = Number(process.env.FAILOVER_TIMEOUT_MS) || 15_000;
const COOLDOWN_MS = 60_000;
const API_PORT = process.env.PORT || "8080";
const API_BASE = `http://localhost:${API_PORT}`;
const PASSWORD = process.env.BINTUNET_PASSWORD || "bintunet";

const HEARTBEAT_KEY = "primary:heartbeat";
const ACTIVE_KEY = "primary:active_streams";

let sessionCookie = null;
let inCooldown = false;
let lastFailoverAt = 0;
let redis = null;

// ── Redis connection ───────────────────────────────────────────────────────
async function connectRedis() {
  if (!REDIS_URL) {
    console.error("[failover] REDIS_URL not set — failover watcher cannot run");
    process.exit(1);
  }

  redis = createClient({ url: REDIS_URL });
  redis.on("error", (err) => console.warn("[failover] Redis error:", err.message));
  await redis.connect();
  console.log("[failover] Connected to Redis");
}

// ── API authentication ─────────────────────────────────────────────────────
async function authenticate() {
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: PASSWORD }),
      });

      if (!res.ok) {
        console.warn(`[failover] Auth failed (${res.status}) — wrong password?`);
        await sleep(5000);
        continue;
      }

      // Extract session cookie from response
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        sessionCookie = setCookie.split(";")[0];
        console.log("[failover] Authenticated with local API");
        return true;
      }
    } catch (err) {
      console.warn(`[failover] Auth attempt ${attempt} failed: ${err.message}`);
      await sleep(3000 * attempt);
    }
  }

  console.error("[failover] Cannot authenticate — local API unreachable");
  return false;
}

// ── Check heartbeat age ────────────────────────────────────────────────────
async function getPrimaryAge() {
  const raw = await redis.get(HEARTBEAT_KEY);
  if (!raw) return Infinity; // key expired or never set
  return Date.now() - Number(raw);
}

// ── Get active stream IDs from Redis ──────────────────────────────────────
async function getActiveStreamIds() {
  const raw = await redis.get(ACTIVE_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

// ── Start a stream on backup via local API ─────────────────────────────────
async function startStreamOnBackup(streamId) {
  if (!sessionCookie) {
    const ok = await authenticate();
    if (!ok) return false;
  }

  try {
    const res = await fetch(`${API_BASE}/api/streams/${streamId}/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
    });

    if (res.status === 401) {
      // Session expired — re-auth and retry once
      sessionCookie = null;
      const ok = await authenticate();
      if (!ok) return false;
      return startStreamOnBackup(streamId);
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.warn(`[failover] Stream ${streamId} start failed (${res.status}): ${body.message || "unknown"}`);
      return false;
    }

    console.log(`[failover] ✅ Stream ${streamId} started on backup`);
    return true;
  } catch (err) {
    console.warn(`[failover] Stream ${streamId} start error: ${err.message}`);
    return false;
  }
}

// ── Main failover logic ────────────────────────────────────────────────────
async function doFailover() {
  if (inCooldown) return;

  const streamIds = await getActiveStreamIds();
  if (!streamIds.length) {
    console.log("[failover] Primary down but no active streams to recover");
    inCooldown = true;
    setTimeout(() => { inCooldown = false; }, COOLDOWN_MS);
    return;
  }

  console.log(`[failover] 🚨 PRIMARY DOWN — recovering ${streamIds.length} stream(s): ${streamIds.join(", ")}`);
  lastFailoverAt = Date.now();
  inCooldown = true;

  for (const id of streamIds) {
    await startStreamOnBackup(id);
    await sleep(2000); // stagger starts to avoid overwhelming backup
  }

  console.log(`[failover] Recovery complete. Cooldown for ${COOLDOWN_MS / 1000}s`);
  setTimeout(() => {
    inCooldown = false;
    console.log("[failover] Cooldown ended — resuming heartbeat monitoring");
  }, COOLDOWN_MS);
}

// ── Main poll loop ─────────────────────────────────────────────────────────
async function pollLoop() {
  console.log(`[failover] Polling primary heartbeat every ${POLL_MS / 1000}s (timeout: ${TIMEOUT_MS / 1000}s)`);

  while (true) {
    try {
      const age = await getPrimaryAge();

      if (age > TIMEOUT_MS) {
        console.warn(`[failover] ⚠️  Primary heartbeat stale (${Math.round(age / 1000)}s ago)`);
        await doFailover();
      } else {
        // Primary healthy — log occasionally
        if (Math.random() < 0.1) {
          console.log(`[failover] Primary healthy — last beat ${Math.round(age / 1000)}s ago`);
        }
      }
    } catch (err) {
      console.warn("[failover] Poll error:", err.message);
    }

    await sleep(POLL_MS);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Startup ────────────────────────────────────────────────────────────────
console.log("=".repeat(60));
console.log("[failover] BintuNet Failover Watcher");
console.log(`[failover] Redis: ${REDIS_URL ? "configured" : "NOT configured — exiting"}`);
console.log(`[failover] Local API: ${API_BASE}`);
console.log("=".repeat(60));

connectRedis()
  .then(() => authenticate())
  .then((ok) => {
    if (ok) return pollLoop();
    console.error("[failover] Cannot start — authentication failed");
    process.exit(1);
  })
  .catch((err) => {
    console.error("[failover] Fatal:", err);
    process.exit(1);
  });
