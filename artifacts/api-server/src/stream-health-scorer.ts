/**
 * Stream Health Scorer — Production health scoring system (0–100)
 *
 * Each active stream gets a real-time health score computed from 5 components:
 *
 *  Component          Max pts   Triggers recovery
 *  ─────────────────  ───────   ──────────────────
 *  FFmpeg alive            30   ✓  (proc not in activeStreams)
 *  Bitrate stable          25   ✓  (deviation > 30% from target)
 *  FPS stable              20   ✓  (fps < 20 while target is 25–30)
 *  Low reconnect rate      15   ✓  (>= 5 reconnects in 10 minutes)
 *  No RTMP errors          10   ✓  (RTMP error in last 30s)
 *
 * Score < 50  → recovery triggered (via registered callback)
 * Score 50–79 → warning emitted
 * Score 80+   → healthy
 *
 * The scorer is intentionally stateless relative to the rest of the system —
 * stream-manager feeds it events and it emits recovery/warning callbacks.
 */

import { logger } from "./lib/logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export type HealthStatus = "excellent" | "good" | "warning" | "unstable" | "failed";

export interface StreamHealthSnapshot {
  streamId: string;
  score: number;
  status: HealthStatus;
  components: {
    ffmpegAlive: number;
    bitrateStable: number;
    fpsStable: number;
    reconnectRate: number;
    rtmpErrors: number;
  };
  metrics: {
    currentBitrateKbps: number;
    targetBitrateKbps: number;
    currentFps: number;
    reconnectCount: number;
    reconnectsInWindow: number;
    lastRtmpErrorAt: number | null;
    lastUpdatedAt: number;
  };
}

type RecoveryCallback = (streamId: string, score: number, snapshot: StreamHealthSnapshot) => void;
type WarningCallback = (streamId: string, score: number, snapshot: StreamHealthSnapshot) => void;

// ── Internal state per stream ─────────────────────────────────────────────────

interface StreamState {
  streamId: string;
  ffmpegAlive: boolean;
  targetBitrateKbps: number;
  bitrateHistory: { value: number; at: number }[];   // last 60s of samples
  fpsHistory: { value: number; at: number }[];
  reconnects: number[];                               // timestamps of each reconnect
  lastRtmpErrorAt: number | null;
  recoveryTriggeredAt: number | null;
  warningEmittedAt: number | null;
  registeredAt: number;   // when the stream was (re-)registered; gates startup grace
  lastRecomputeAt: number; // throttle metric-driven recomputes to RECOMPUTE_THROTTLE_MS
}

// ── Scoring constants ─────────────────────────────────────────────────────────

const MAX_SCORE = 100;
const RECOVERY_THRESHOLD = 50;
const WARNING_THRESHOLD = 80;

const BITRATE_WINDOW_MS = 30_000;          // measure bitrate stability over 30s
const FPS_WINDOW_MS = 15_000;             // fps stability over 15s
const RECONNECT_WINDOW_MS = 10 * 60_000; // count reconnects in last 10 min
const RTMP_ERROR_WINDOW_MS = 30_000;     // RTMP error cooldown

const BITRATE_DEVIATION_MAX = 0.30;      // > 30% deviation → 0 pts
const FPS_MIN_RATIO = 0.70;              // < 70% of target fps → 0 pts
const RECONNECT_MAX_IN_WINDOW = 5;       // >= 5 reconnects → 0 pts

// Throttle recompute() on high-frequency metric events (bitrate/fps arrive
// at 1–30 Hz from FFmpeg -stats output).  Priority events (ffmpegAlive,
// reconnect, rtmpError) always trigger an immediate recompute regardless.
const RECOMPUTE_THROTTLE_MS = 5_000; // at most one metric-driven recompute per 5s

// Component max scores
const PTS_FFMPEG    = 30;
const PTS_BITRATE   = 25;
const PTS_FPS       = 20;
const PTS_RECONNECT = 15;
const PTS_RTMP      = 10;

// Recovery cooldown: don't trigger recovery more than once per 30s
const RECOVERY_COOLDOWN_MS = 30_000;

// Startup grace period: don't score (or trigger recovery) until FFmpeg has had
// time to connect to the source and produce data. During this window a score
// of 0 is completely expected — FFmpeg is still negotiating the HLS playlist.
// 60 s covers slow HLS sources (streamlink can take 5-15 s to hand off, then
// FFmpeg needs time to buffer and begin encoding output frames).
const STARTUP_GRACE_MS = 60_000;

// ── Module state ──────────────────────────────────────────────────────────────

const states = new Map<string, StreamState>();
let onRecovery: RecoveryCallback = () => {};
let onWarning: WarningCallback = () => {};

export function initHealthScorer(
  recoveryFn: RecoveryCallback,
  warningFn: WarningCallback,
): void {
  onRecovery = recoveryFn;
  onWarning = warningFn;
}

// ── Stream lifecycle ──────────────────────────────────────────────────────────

export function scorerRegisterStream(streamId: string, targetBitrateKbps: number): void {
  states.set(streamId, {
    streamId,
    ffmpegAlive: false,
    targetBitrateKbps: targetBitrateKbps || 2500,
    bitrateHistory: [],
    fpsHistory: [],
    reconnects: [],
    lastRtmpErrorAt: null,
    recoveryTriggeredAt: null,
    warningEmittedAt: null,
    registeredAt: Date.now(),
    lastRecomputeAt: 0,
  });
  logger.debug({ streamId, targetBitrateKbps }, "[health] Stream registered");
}

export function scorerRemoveStream(streamId: string): void {
  states.delete(streamId);
}

// ── Feed events ───────────────────────────────────────────────────────────────

export function scorerSetFFmpegAlive(streamId: string, alive: boolean): void {
  const s = states.get(streamId);
  if (!s) return;
  s.ffmpegAlive = alive;
  recompute(streamId);
}

export function scorerRecordBitrate(streamId: string, bitrateKbps: number): void {
  const s = states.get(streamId);
  if (!s) return;
  const now = Date.now();
  s.bitrateHistory.push({ value: bitrateKbps, at: now });
  // Keep only last BITRATE_WINDOW_MS worth of samples
  const cutoff = now - BITRATE_WINDOW_MS;
  s.bitrateHistory = s.bitrateHistory.filter((e) => e.at >= cutoff);
  // Throttled: bitrate arrives at ~1 Hz from FFmpeg -stats; only recompute every 5s
  // to prevent hundreds of synchronous recovery-callback invocations per minute.
  recomputeThrottled(streamId, now);
}

export function scorerRecordFps(streamId: string, fps: number): void {
  const s = states.get(streamId);
  if (!s) return;
  const now = Date.now();
  s.fpsHistory.push({ value: fps, at: now });
  const cutoff = now - FPS_WINDOW_MS;
  s.fpsHistory = s.fpsHistory.filter((e) => e.at >= cutoff);
  // Throttled: same reasoning as scorerRecordBitrate above
  recomputeThrottled(streamId, now);
}

export function scorerRecordReconnect(streamId: string): void {
  const s = states.get(streamId);
  if (!s) return;
  const now = Date.now();
  s.reconnects.push(now);
  const cutoff = now - RECONNECT_WINDOW_MS;
  s.reconnects = s.reconnects.filter((t) => t >= cutoff);
  // Priority: reconnect events are infrequent and critical — always immediate
  recompute(streamId);
}

export function scorerRecordRtmpError(streamId: string): void {
  const s = states.get(streamId);
  if (!s) return;
  s.lastRtmpErrorAt = Date.now();
  // Priority: RTMP errors are critical — always immediate
  recompute(streamId);
}

// ── Scoring engine ────────────────────────────────────────────────────────────

// recomputeThrottled skips the full recompute if one ran recently (for metric
// events that arrive at high frequency from FFmpeg -stats lines).
function recomputeThrottled(streamId: string, now: number): void {
  const s = states.get(streamId);
  if (!s) return;
  if (now - s.lastRecomputeAt < RECOMPUTE_THROTTLE_MS) return;
  recompute(streamId);
}

function computeScore(s: StreamState): { score: number; components: StreamHealthSnapshot["components"] } {
  const now = Date.now();

  // ── Component 1: FFmpeg alive ─────────────────────────────────────────────
  const ptsFFmpeg = s.ffmpegAlive ? PTS_FFMPEG : 0;

  // ── Component 2: Bitrate stability ───────────────────────────────────────
  let ptsBitrate = PTS_BITRATE;
  if (s.bitrateHistory.length >= 3) {
    const values = s.bitrateHistory.map((e) => e.value);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const maxDev = Math.max(...values.map((v) => Math.abs(v - avg) / avg));
    if (maxDev > BITRATE_DEVIATION_MAX) {
      ptsBitrate = Math.round(PTS_BITRATE * Math.max(0, 1 - (maxDev - BITRATE_DEVIATION_MAX) * 2));
    }
    // Also penalise if bitrate is far below target
    const latest = values[values.length - 1];
    const targetDev = Math.abs(latest - s.targetBitrateKbps) / s.targetBitrateKbps;
    if (targetDev > 0.5) {
      ptsBitrate = Math.round(ptsBitrate * 0.5);
    }
  } else if (!s.ffmpegAlive) {
    ptsBitrate = 0;
  }

  // ── Component 3: FPS stability ────────────────────────────────────────────
  let ptsFps = PTS_FPS;
  if (s.fpsHistory.length >= 2) {
    const avgFps = s.fpsHistory.reduce((a, b) => a + b.value, 0) / s.fpsHistory.length;
    // Assume target is 30fps — we'll adjust score proportionally
    const targetFps = 25;
    const ratio = avgFps / targetFps;
    if (ratio < FPS_MIN_RATIO) {
      ptsFps = Math.round(PTS_FPS * Math.max(0, ratio / FPS_MIN_RATIO));
    }
  } else if (!s.ffmpegAlive) {
    ptsFps = 0;
  }

  // ── Component 4: Reconnect rate ────────────────────────────────────────────
  const reconnectsInWindow = s.reconnects.length;
  let ptsReconnect = PTS_RECONNECT;
  if (reconnectsInWindow >= RECONNECT_MAX_IN_WINDOW) {
    ptsReconnect = 0;
  } else if (reconnectsInWindow > 0) {
    ptsReconnect = Math.round(PTS_RECONNECT * (1 - reconnectsInWindow / RECONNECT_MAX_IN_WINDOW));
  }

  // ── Component 5: RTMP error-free ─────────────────────────────────────────
  let ptsRtmp = PTS_RTMP;
  if (s.lastRtmpErrorAt && (now - s.lastRtmpErrorAt) < RTMP_ERROR_WINDOW_MS) {
    ptsRtmp = 0;
  }

  const total = ptsFFmpeg + ptsBitrate + ptsFps + ptsReconnect + ptsRtmp;
  return {
    score: Math.max(0, Math.min(MAX_SCORE, total)),
    components: {
      ffmpegAlive: ptsFFmpeg,
      bitrateStable: ptsBitrate,
      fpsStable: ptsFps,
      reconnectRate: ptsReconnect,
      rtmpErrors: ptsRtmp,
    },
  };
}

function scoreToStatus(score: number): HealthStatus {
  if (score >= 90) return "excellent";
  if (score >= 80) return "good";
  if (score >= WARNING_THRESHOLD - 10) return "warning";
  if (score >= RECOVERY_THRESHOLD) return "unstable";
  return "failed";
}

function recompute(streamId: string): void {
  const s = states.get(streamId);
  if (!s) return;

  const now = Date.now();
  s.lastRecomputeAt = now; // stamp so throttled callers can skip

  // During the startup grace window, scoring is suppressed entirely.
  // FFmpeg needs time to negotiate the HLS playlist and produce output — a
  // score of 0 during this window is completely expected, not a failure.
  if (now - s.registeredAt < STARTUP_GRACE_MS) return;

  const { score, components } = computeScore(s);
  const status = scoreToStatus(score);

  const snapshot: StreamHealthSnapshot = {
    streamId,
    score,
    status,
    components,
    metrics: {
      currentBitrateKbps: s.bitrateHistory.length > 0
        ? s.bitrateHistory[s.bitrateHistory.length - 1].value
        : 0,
      targetBitrateKbps: s.targetBitrateKbps,
      currentFps: s.fpsHistory.length > 0
        ? s.fpsHistory[s.fpsHistory.length - 1].value
        : 0,
      reconnectCount: s.reconnects.filter(() => true).length,  // all-time via module state
      reconnectsInWindow: s.reconnects.length,
      lastRtmpErrorAt: s.lastRtmpErrorAt,
      lastUpdatedAt: now,
    },
  };

  // Emit warning
  if (score < WARNING_THRESHOLD && score >= RECOVERY_THRESHOLD) {
    const cooldown = 15_000;
    if (!s.warningEmittedAt || (now - s.warningEmittedAt) > cooldown) {
      s.warningEmittedAt = now;
      onWarning(streamId, score, snapshot);
    }
  }

  // Trigger recovery
  if (score < RECOVERY_THRESHOLD) {
    if (!s.recoveryTriggeredAt || (now - s.recoveryTriggeredAt) > RECOVERY_COOLDOWN_MS) {
      s.recoveryTriggeredAt = now;
      logger.warn({ streamId, score, status }, "[health] Score below threshold — triggering recovery");
      onRecovery(streamId, score, snapshot);
    }
  } else {
    // Reset warning/recovery state when score recovers
    if (s.recoveryTriggeredAt && score >= WARNING_THRESHOLD) {
      s.recoveryTriggeredAt = null;
      s.warningEmittedAt = null;
    }
  }
}

// ── Public reads ──────────────────────────────────────────────────────────────

export function getHealthSnapshot(streamId: string): StreamHealthSnapshot | null {
  const s = states.get(streamId);
  if (!s) return null;
  const { score, components } = computeScore(s);
  return {
    streamId,
    score,
    status: scoreToStatus(score),
    components,
    metrics: {
      currentBitrateKbps: s.bitrateHistory.length > 0 ? s.bitrateHistory[s.bitrateHistory.length - 1].value : 0,
      targetBitrateKbps: s.targetBitrateKbps,
      currentFps: s.fpsHistory.length > 0 ? s.fpsHistory[s.fpsHistory.length - 1].value : 0,
      reconnectCount: s.reconnects.length,
      reconnectsInWindow: s.reconnects.length,
      lastRtmpErrorAt: s.lastRtmpErrorAt,
      lastUpdatedAt: Date.now(),
    },
  };
}

export function getAllHealthSnapshots(): StreamHealthSnapshot[] {
  return [...states.keys()]
    .map((id) => getHealthSnapshot(id))
    .filter(Boolean) as StreamHealthSnapshot[];
}

export function getHealthScore(streamId: string): number {
  const snap = getHealthSnapshot(streamId);
  return snap?.score ?? 0;
}
