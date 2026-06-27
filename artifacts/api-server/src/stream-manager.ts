import { ChildProcess, spawn, exec } from "child_process";
import { storage } from "./storage";
import { logger } from "./lib/logger";
import { getTikTokStreamUrl } from "./tiktok-extractor";
import { getYouTubeStreamUrl, getYouTubeVideoDirectUrl, downloadYouTubeVideoToTemp, clearYtDownloadCache, normaliseYouTubeUrl, getYouTubeFFmpegCookieHeader, getYouTubeYtdlpPipeArgs } from "./youtube-source";
import { YTDLP_BIN } from "./lib/ytdlp";
import type { WebSocket } from "ws";
import type { StreamConfig } from "./schema";
import { OverlayRenderer, defaultOverlayState, type OverlayState } from "./overlay-renderer";
import path from "path";
import fs from "fs";
import { startHlsEncoder, stopHlsEncoder } from "./hls-encoder";
import {
  initHealthScorer,
  scorerRegisterStream,
  scorerRemoveStream,
  scorerSetFFmpegAlive,
  scorerRecordBitrate,
  scorerRecordFps,
  scorerRecordReconnect,
  scorerRecordRtmpError,
  getHealthSnapshot,
  getAllHealthSnapshots,
} from "./stream-health-scorer";
import {
  initFailover,
  triggerFailover as failoverTrigger,
  markSourceStable,
  markSourceFailed,
} from "./source-failover";
export { getHealthSnapshot, getAllHealthSnapshots };
export { setFailoverChain, getFailoverChain, getAllChains, removeFailoverChain, getCurrentSource, resetToPrimary, buildDefaultChain } from "./source-failover";

// ── Break Video Preload Cache ─────────────────────────────────────────────────
// Pre-resolves YouTube URLs in the background so Go Live starts instantly.
interface PreloadEntry {
  status: "loading" | "ready" | "error";
  resolvedUrl?: string;
  error?: string;
  startedAt: number;
}
const breakVideoPreloadCache = new Map<string, PreloadEntry>();

export function preloadBreakVideo(url: string): void {
  const existing = breakVideoPreloadCache.get(url);
  if (existing && existing.status !== "error") return; // already in-flight or ready
  breakVideoPreloadCache.set(url, { status: "loading", startedAt: Date.now() });

  const isHTTP = url.startsWith("http://") || url.startsWith("https://");
  if (!isHTTP || !/youtube\.com|youtu\.be/.test(url)) {
    breakVideoPreloadCache.set(url, { status: "ready", resolvedUrl: url, startedAt: Date.now() });
    return;
  }

  (async () => {
    try {
      const streamUrl = await getYouTubeStreamUrl(url);
      breakVideoPreloadCache.set(url, { status: "ready", resolvedUrl: streamUrl, startedAt: Date.now() });
      logger.info(`Break preload: live stream resolved for ${url}`);
      return;
    } catch {}
    try {
      const directUrl = await getYouTubeVideoDirectUrl(url);
      breakVideoPreloadCache.set(url, { status: "ready", resolvedUrl: directUrl, startedAt: Date.now() });
      logger.info(`Break preload: direct URL resolved for ${url}`);
      return;
    } catch (e: any) {
      if (e?.message?.includes("cookies")) {
        breakVideoPreloadCache.set(url, { status: "error", error: e.message, startedAt: Date.now() });
        logger.warn(`Break preload: ${e.message}`);
        return;
      }
      // Start downloading immediately in the background so it's ready by Go Live
      logger.info(`Break preload: starting background download for ${url}`);
      breakVideoPreloadCache.set(url, { status: "loading", startedAt: Date.now() });
      downloadYouTubeVideoToTemp(url, (m) => logger.info(`Break preload download: ${m}`))
        .then((filePath) => {
          breakVideoPreloadCache.set(url, { status: "ready", resolvedUrl: filePath, startedAt: Date.now() });
          logger.info(`Break preload: download complete → ${filePath}`);
        })
        .catch((dlErr: any) => {
          breakVideoPreloadCache.set(url, { status: "error", error: dlErr.message, startedAt: Date.now() });
          logger.warn(`Break preload download failed: ${dlErr.message}`);
        });
    }
  })().catch(() => {});
}

export function getBreakVideoPreloadStatus(url: string): PreloadEntry | null {
  return breakVideoPreloadCache.get(url) ?? null;
}

// ── MicAudioPipe ──────────────────────────────────────────────────────────────
// Maintains a continuous PCM16 mono 44100 Hz audio stream to FFmpeg pipe:5.
// Silence is written when no browser mic data is available; real PCM16 audio
// when the control-room operator has the mic enabled.
class MicAudioPipe {
  private buf: Buffer;
  private writePos = 0;
  private readPos = 0;
  private intervalId: NodeJS.Timeout | null = null;

  static readonly INTERVAL_MS = 50;
  // 50 ms of mono PCM16 at 44100 Hz = 44100 * 0.05 * 2 = 4410 bytes
  static readonly CHUNK_BYTES = Math.floor(44100 * 0.05) * 2;
  // 4-second ring buffer capacity
  static readonly CAPACITY = 44100 * 2 * 4;

  constructor() {
    this.buf = Buffer.alloc(MicAudioPipe.CAPACITY);
  }

  feed(pcm: Buffer) {
    const cap = MicAudioPipe.CAPACITY;
    // Drop oldest bytes when overflow would occur
    if (this.writePos - this.readPos + pcm.byteLength > cap) {
      this.readPos = this.writePos - cap + pcm.byteLength;
    }
    for (let i = 0; i < pcm.byteLength; i++) {
      this.buf[(this.writePos + i) % cap] = pcm[i];
    }
    this.writePos += pcm.byteLength;
  }

  startWritingTo(dest: NodeJS.WritableStream) {
    const chunkBytes = MicAudioPipe.CHUNK_BYTES;
    const cap = MicAudioPipe.CAPACITY;
    this.intervalId = setInterval(() => {
      if (!(dest as any).writable) return;
      const available = this.writePos - this.readPos;
      const out = Buffer.allocUnsafe(chunkBytes);
      if (available >= chunkBytes) {
        for (let i = 0; i < chunkBytes; i++) {
          out[i] = this.buf[(this.readPos + i) % cap];
        }
        this.readPos += chunkBytes;
      } else {
        out.fill(0); // silence when buffer is empty
      }
      try { (dest as any).write(out); } catch {}
    }, MicAudioPipe.INTERVAL_MS);
  }

  stop() {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
  }
}

// Global mic audio distribution — one MicAudioPipe per active FFmpeg process
const activeMicPipes = new Set<MicAudioPipe>();
export function feedMicAudio(pcm: Buffer): void {
  activeMicPipes.forEach((p) => p.feed(pcm));
}

// ── VolumeControlPipe ──────────────────────────────────────────────────────────
// Maintains a continuous f32le stereo 44100 Hz audio stream to FFmpeg pipe:6.
// All samples equal `gain` (0.0 = silence / muted, 1.0 = full pass-through).
// FFmpeg's `amultiply` filter multiplies source audio sample-by-sample by this
// signal — allowing real-time volume/mute control with ZERO stream reconnection.
class VolumeControlPipe {
  private gain: number;
  private intervalId: NodeJS.Timeout | null = null;

  // 50 ms of stereo f32le at 44100 Hz = 2205 frames × 2 ch × 4 bytes = 17640 bytes
  static readonly INTERVAL_MS = 50;
  static readonly CHUNK_FRAMES = Math.floor(44100 * 0.05);
  static readonly CHUNK_BYTES = VolumeControlPipe.CHUNK_FRAMES * 2 * 4;

  constructor(initialGain: number) {
    this.gain = Math.max(0, Math.min(1, initialGain));
  }

  setGain(g: number) {
    this.gain = Math.max(0, Math.min(1, g));
  }

  startWritingTo(dest: NodeJS.WritableStream) {
    const frames = VolumeControlPipe.CHUNK_FRAMES;
    const chunkBytes = VolumeControlPipe.CHUNK_BYTES;
    this.intervalId = setInterval(() => {
      if (!(dest as any).writable) return;
      const buf = Buffer.allocUnsafe(chunkBytes);
      const g = this.gain;
      for (let i = 0; i < frames * 2; i++) {
        buf.writeFloatLE(g, i * 4);
      }
      try { (dest as any).write(buf); } catch {}
    }, VolumeControlPipe.INTERVAL_MS);
  }

  stop() {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
  }
}

function computeGain(streamMuted: boolean, liveAudioMuted: boolean, vol: number): number {
  if (streamMuted || liveAudioMuted) return 0;
  return Math.max(0, Math.min(1, vol / 100));
}

function updateAllVolumeGains(): void {
  activeStreams.forEach((proc, streamId) => {
    if (!proc.volumePipe) return;
    const stream = storage.getStream(streamId);
    const gain = computeGain(stream?.muted ?? false, currentOverlayState.liveAudioMuted, globalStreamVolume);
    proc.volumePipe.setGain(gain);
  });
}

// Browser camera streams — tracks which streams use __browser__ as camera input
export const browserCameraStreams = new Set<string>();

// Browser camera stdin pipes (streamId → FFmpeg stdin writable stream)
const browserCameraPipes = new Map<string, NodeJS.WritableStream>();
// Pre-start buffer: accumulates WebM chunks (including init segment) before FFmpeg spawns
const browserCameraBuffers = new Map<string, Buffer[]>();
export function writeToBrowserCamera(streamId: string, data: Buffer): boolean {
  const pipe = browserCameraPipes.get(streamId);
  if (!pipe) {
    // FFmpeg not started yet — buffer so the init segment isn't lost
    const arr = browserCameraBuffers.get(streamId) ?? [];
    arr.push(data);
    browserCameraBuffers.set(streamId, arr);
    return false;
  }
  try { (pipe as any).write(data); return true; } catch { return false; }
}

/** Push a JPEG frame from the browser screen-share WS to all active uiRenderers */
export function setScreenShareFrameForAll(jpegBuf: Buffer): void {
  activeStreams.forEach((proc) => {
    proc.uiRenderer?.setScreenShareFrame(jpegBuf);
  });
}

// Global stream source volume (0–100). Controlled live via VolumeControlPipe — no restart.
let globalStreamVolume = 100;
export function updateStreamVolume(vol: number): void {
  globalStreamVolume = Math.max(0, Math.min(100, Math.round(vol)));
  updateAllVolumeGains();
}

interface StreamProcess {
  ffmpegProcess?: ChildProcess;
  bgRenderer?: OverlayRenderer;
  uiRenderer?: OverlayRenderer;
  micPipe?: MicAudioPipe;
  volumePipe?: VolumeControlPipe; // f32le gain signal to FFmpeg pipe:6 (no-restart volume/mute)
  breakDecoder?: ChildProcess;    // secondary lightweight FFmpeg — decodes break video to RGBA frames for pipe:4
  muted: boolean;
  autoRestart: boolean;
  watchdog?: NodeJS.Timeout;
  stallWatchdog?: NodeJS.Timeout;
  statsInterval?: NodeJS.Timeout; // polls CPU+RAM for the FFmpeg PID every 3s
  prefetchTimer?: NodeJS.Timeout;      // fires before URL expires — pre-fetches a fresh URL, then seamlessly restarts
  sessionRefreshTimer?: NodeJS.Timeout; // TikTok/xSpace: forced restart every SESSION_REFRESH_MS to prevent session expiry
  ytSourceProcess?: ChildProcess; // streamlink process piped to FFmpeg stdin for YouTube source
  inputUrl?: string;
  sourceType?: string;
  urlExpired?: boolean;
  lastFrameCount?: number;        // most-recent frame count from FFmpeg -stats output
  streamStartTime?: number;       // unix ms when stream reached "streaming" status
  reconnectCount?: number;        // total pipeline restarts for this stream session
  lastBitrate?: number;           // most recent output bitrate in kbps (from FFmpeg -stats)
  lastFps?: number;               // most recent output fps (from FFmpeg -stats)
}

// ── URL cache: reuse recently resolved URLs to skip 20-35s re-resolution on restart ──
interface CachedUrl {
  url: string;
  sourceType: "tiktok" | "youtube" | "camera";
  resolvedAt: number;
}
// TikTok/YouTube URLs typically last 10-30 min. Cache for 10 min so fast
// restarts reuse the URL while proactive pre-fetch keeps it always fresh.
const URL_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const urlCache = new Map<string, CachedUrl>();

function getCachedUrl(streamId: string): CachedUrl | null {
  const entry = urlCache.get(streamId);
  if (!entry) return null;
  if (Date.now() - entry.resolvedAt > URL_CACHE_TTL_MS) {
    urlCache.delete(streamId);
    return null;
  }
  return entry;
}

const activeStreams = new Map<string, StreamProcess>();

// Tracks streams explicitly stopped by the user. Every auto-restart timer
// checks this before calling startStream so that a pending reconnect timer
// that fires after the user clicked Stop can never leak back to YouTube.
const manuallyStopped = new Set<string>();

// ── Restart-loop protection ───────────────────────────────────────────────────
// restartScheduled: set when ANY restart timer is pending for a stream.
// A second concurrent restart path checks this and bails — prevents the race
// between handleProcessExit and the health-recovery callback both scheduling
// startStream at the same time (the root cause of the rapid-restart + rate-limit loop).
const restartScheduled = new Set<string>();

// Consecutive restart failure count per stream → drives exponential backoff
// so a channel that keeps failing doesn't hammer YouTube and get the server IP blocked.
const restartBackoff = new Map<string, number>();
// Backoff schedule: 5s → 15s → 30s → 60s → 120s → 300s cap for 6+
const BACKOFF_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 300_000];

// ── Resolver circuit breaker ──────────────────────────────────────────────────
// After CB_FAILURE_THRESHOLD resolution failures in CB_WINDOW_MS, the circuit
// opens and blocks further attempts for CB_OPEN_COOLDOWN_MS. After the cooldown
// one probe is allowed; success closes the circuit, failure extends the cooldown.
interface CBState {
  failures: number[];       // unix-ms timestamps of recent failures
  openedAt: number | null;  // when circuit was opened (null = closed)
  probeInFlight: boolean;   // one probe allowed after cooldown
}
const CB_WINDOW_MS        = 5  * 60_000; // 5-minute failure window
const CB_FAILURE_THRESHOLD = 5;           // failures before circuit opens
const CB_OPEN_COOLDOWN_MS = 10 * 60_000; // 10-minute open-circuit cooldown
const resolverCBs = new Map<string, CBState>();

function getCB(streamId: string): CBState {
  if (!resolverCBs.has(streamId)) {
    resolverCBs.set(streamId, { failures: [], openedAt: null, probeInFlight: false });
  }
  return resolverCBs.get(streamId)!;
}

function cbCanAttempt(streamId: string): boolean {
  const cb = getCB(streamId);
  if (!cb.openedAt) return true; // circuit closed
  const now = Date.now();
  if (now - cb.openedAt >= CB_OPEN_COOLDOWN_MS && !cb.probeInFlight) {
    cb.probeInFlight = true; // allow one probe
    return true;
  }
  return false; // circuit open and probe not yet due
}

function cbRecordSuccess(streamId: string): void {
  const cb = getCB(streamId);
  cb.failures = [];
  cb.openedAt = null;
  cb.probeInFlight = false;
}

function cbRecordFailure(streamId: string): void {
  const cb = getCB(streamId);
  const now = Date.now();
  cb.probeInFlight = false;
  cb.failures.push(now);
  cb.failures = cb.failures.filter((t) => now - t < CB_WINDOW_MS);
  if (!cb.openedAt && cb.failures.length >= CB_FAILURE_THRESHOLD) {
    cb.openedAt = now;
    logger.warn({ streamId, failures: cb.failures.length },
      "[circuit-breaker] OPEN — suspending URL resolution for 10 min");
  } else if (cb.openedAt) {
    // probe failed — reset cooldown clock
    cb.openedAt = now;
    logger.warn({ streamId }, "[circuit-breaker] Probe failed — extending cooldown");
  }
}

function getBackoffDelay(streamId: string): number {
  const count = restartBackoff.get(streamId) ?? 0;
  return BACKOFF_DELAYS_MS[Math.min(count, BACKOFF_DELAYS_MS.length - 1)];
}
function bumpBackoff(streamId: string): void {
  restartBackoff.set(streamId, (restartBackoff.get(streamId) ?? 0) + 1);
}
function resetBackoff(streamId: string): void {
  restartBackoff.delete(streamId);
  restartScheduled.delete(streamId);
}

const wsClients = new Set<WebSocket>();

let currentOverlayState: OverlayState = defaultOverlayState();

const cameraLinks = new Map<string, string>();
export function setCameraLink(streamId: string, url: string) { cameraLinks.set(streamId, url); }
export function clearCameraLink(streamId: string) { cameraLinks.delete(streamId); }

export function addWSClient(ws: WebSocket) {
  wsClients.add(ws);
  ws.on("close", () => wsClients.delete(ws));
}

export function broadcastGlobal(type: string, data: any) {
  const json = JSON.stringify({ type, streamId: null, data });
  wsClients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) ws.send(json);
  });
}

export function broadcastStream(streamId: string, type: string, data: any) {
  broadcast({ type, streamId, data });
}

function broadcast(msg: { type: string; streamId: string; data: any }) {
  const json = JSON.stringify(msg);
  wsClients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) ws.send(json);
  });
}

const streamLogBuffers = new Map<string, string[]>();
const LOG_BUFFER_SIZE = 50;

function sendLog(streamId: string, line: string) {
  const timestamp = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const data = `[${timestamp}] ${line}`;
  if (!streamLogBuffers.has(streamId)) streamLogBuffers.set(streamId, []);
  const buf = streamLogBuffers.get(streamId)!;
  buf.push(data);
  if (buf.length > LOG_BUFFER_SIZE) buf.shift();
  broadcast({ type: "log", streamId, data });
}

export function getStreamLogBuffers(): Map<string, string[]> {
  return streamLogBuffers;
}

function sendStatus(streamId: string, status: string) {
  storage.updateStream(streamId, { status: status as any });
  broadcast({ type: "status", streamId, data: status });
}

function isYouTubeUrl(url: string): boolean {
  return /youtube\.com|youtu\.be/.test(url);
}

export function updateStreamOverlays(patch: Partial<OverlayState>) {
  const prevBreakActive = currentOverlayState.breakActive;
  const prevBreakVideoUrl = currentOverlayState.breakVideoUrl ?? "";
  const prevBreakVideoPanX = currentOverlayState.breakVideoPanX ?? 50;
  const prevBreakVideoPanY = currentOverlayState.breakVideoPanY ?? 50;
  const prevBreakVideoMode = currentOverlayState.breakVideoMode ?? "fullscreen";
  const prevLiveAudioMuted = currentOverlayState.liveAudioMuted;

  currentOverlayState = { ...currentOverlayState, ...patch };

  const nowBreakActive = currentOverlayState.breakActive;
  const nowBreakVideoUrl = currentOverlayState.breakVideoUrl ?? "";
  const nowBreakVideoPanX = currentOverlayState.breakVideoPanX ?? 50;
  const nowBreakVideoPanY = currentOverlayState.breakVideoPanY ?? 50;
  const nowBreakVideoMode = currentOverlayState.breakVideoMode ?? "fullscreen";

  // ── Break video decoder — ZERO main-FFmpeg restart ─────────────────────────
  // A lightweight secondary FFmpeg decodes break video frames and writes RGBA to
  // the uiRenderer via setExternalFrame() → pipe:4. The main FFmpeg process keeps
  // streaming to YouTube/Facebook at all times — no RTMP interruption whatsoever.
  const breakJustStarted = nowBreakActive && !prevBreakActive;
  const breakJustEnded   = !nowBreakActive && prevBreakActive;
  const urlChanged = nowBreakActive && nowBreakVideoUrl !== prevBreakVideoUrl;
  const panChanged = nowBreakActive && !!nowBreakVideoUrl && (
    nowBreakVideoPanX !== prevBreakVideoPanX || nowBreakVideoPanY !== prevBreakVideoPanY
  );
  // Changing background mode (fullscreen / live-bg / gradient-bg) while break
  // is active requires a decoder restart because the vf filter string differs.
  const modeChanged = nowBreakActive && !!nowBreakVideoUrl &&
    nowBreakVideoMode !== prevBreakVideoMode;

  const needsDecoderStart =
    (breakJustStarted && !!nowBreakVideoUrl) ||
    (urlChanged && !!nowBreakVideoUrl) ||
    panChanged ||
    modeChanged;

  if (needsDecoderStart) {
    const streamIds = [...activeStreams.keys()];
    const videoUrl = nowBreakVideoUrl;
    const panX = nowBreakVideoPanX;
    const panY = nowBreakVideoPanY;
    const isHTTP = videoUrl.startsWith("http://") || videoUrl.startsWith("https://");

    const startDecoderForAll = (resolvedUrl: string) => {
      if (!currentOverlayState.breakActive || currentOverlayState.breakVideoUrl !== videoUrl) {
        logger.info("Break decoder: ready but break no longer active — skipping");
        return;
      }
      const mode = currentOverlayState.breakVideoMode;
      streamIds.forEach((id) => {
        if (activeStreams.has(id)) startBreakDecoder(id, resolvedUrl, panX, panY, mode);
      });
    };

    // ── Check preload cache — instant start if pre-resolved ──────────────────
    const preloaded = breakVideoPreloadCache.get(videoUrl);
    if (preloaded?.status === "ready" && preloaded.resolvedUrl) {
      streamIds.forEach((id) => sendLog(id, "Break video: using pre-resolved URL — starting immediately ✓"));
      startDecoderForAll(preloaded.resolvedUrl);
    } else if (isHTTP && isYouTubeUrl(videoUrl)) {
      streamIds.forEach((id) => sendLog(id, "Break video: resolving YouTube URL…"));
      getYouTubeStreamUrl(videoUrl)
        .then((streamUrl) => {
          streamIds.forEach((id) => sendLog(id, "Break video: live stream detected — starting"));
          startDecoderForAll(streamUrl);
        })
        .catch(() => {
          streamIds.forEach((id) => sendLog(id, "Break video: fetching direct video URL…"));
          getYouTubeVideoDirectUrl(videoUrl)
            .then((cdnUrl) => {
              streamIds.forEach((id) => sendLog(id, "Break video: URL resolved — starting"));
              startDecoderForAll(cdnUrl);
            })
            .catch((cdnErr) => {
              const msg = cdnErr.message.includes("cookies")
                ? cdnErr.message
                : "downloading video (may take 1–2 min on first load, cached after)…";
              streamIds.forEach((id) => sendLog(id, `Break video: ${msg}`));
              downloadYouTubeVideoToTemp(videoUrl, (m) => {
                streamIds.forEach((id) => sendLog(id, `Break video: ${m}`));
              })
                .then((filePath) => startDecoderForAll(filePath))
                .catch((dlErr) => {
                  streamIds.forEach((id) => sendLog(id, `Break video error: ${dlErr.message}`));
                });
            });
        });
    } else if (isHTTP) {
      startDecoderForAll(videoUrl);
    } else {
      const filename = path.basename(videoUrl.replace(/^\/api\/uploads\//, ""));
      const filePath = path.join(process.cwd(), "uploads", filename);
      if (fs.existsSync(filePath)) {
        startDecoderForAll(filePath);
      } else {
        streamIds.forEach((id) => sendLog(id, `Break video: file not found — ${filename}`));
      }
    }
  } else if (breakJustEnded) {
    // Break ended — stop decoders and let uiRenderer resume normal overlay rendering
    [...activeStreams.keys()].forEach((id) => stopBreakDecoder(id));
    logger.info("Break ended — decoders stopped, live overlays resumed");
  }

  if (currentOverlayState.liveAudioMuted !== prevLiveAudioMuted) {
    updateAllVolumeGains();
  }

  activeStreams.forEach((proc) => {
    proc.bgRenderer?.updateState(currentOverlayState);
    proc.uiRenderer?.updateState(currentOverlayState);
  });
}

function buildFFmpegArgs(
  stream: StreamConfig,
  inputUrl: string,
  outputs: string[],
  sourceType: string,
): string[] {
  const fps = parseInt(stream.fps);
  const isVertical = stream.ratio === "mobile";
  const isHDQuality = stream.quality === "best" || stream.quality === "720p";

  const scaleW = isVertical ? (isHDQuality ? 720 : 480) : (isHDQuality ? 1280 : 854);
  const scaleH = isVertical ? (isHDQuality ? 1280 : 854) : (isHDQuality ? 720 : 480);

  // ── Bitrate ladder ────────────────────────────────────────────────────────
  // YouTube requires a minimum of 2500 kbps for 720p30 to avoid "poor stream"
  // warnings in YouTube Studio. bufsize = 2× bitrate per YouTube's CBR guidance
  // so the encoder can absorb burst complexity without starving the ingest server.
  let bitrate = "2500k";
  let maxrate = "3000k";
  let bufsize = "5000k";

  if (stream.quality === "best") {
    bitrate = "4000k"; maxrate = "4500k"; bufsize = "8000k";
  } else if (stream.quality === "720p") {
    bitrate = "2500k"; maxrate = "3000k"; bufsize = "5000k";
  } else {
    bitrate = "1500k"; maxrate = "1800k"; bufsize = "3000k";
  }

  // Browser camera (__browser__) reads from stdin (pipe:0).
  // ALL non-browser camera sources (local v4l2/avfoundation devices AND RTSP/HTTP
  // cameras) are treated as "no guaranteed audio track".  Using the local-camera
  // audio path (silence fallback + mic only) prevents the FFmpeg filter graph from
  // failing with "Stream specifier 0:a matches no streams" on cameras that have no
  // audio track (which is the majority of IP/RTSP cameras).
  const isBrowserCamera = sourceType === "camera" && inputUrl === "__browser__";
  const isLocalCamera = !isBrowserCamera && sourceType === "camera";
  const isUpload = sourceType === "upload";
  const shouldLoop = isUpload && (stream.uploadedVideoLoop !== false);

  // -stats forces frame=... progress output even with -loglevel warning.
  // FFmpeg 7 silently suppresses progress when loglevel < info unless -stats is explicit.
  const args: string[] = ["-loglevel", "warning", "-stats"];

  // ── Input 0: live source (or browser camera) ──────────────────────────────
  if (isBrowserCamera) {
    // ── Browser camera: read stream from stdin (pipe:0) ──────────────────────
    // MediaRecorder sends binary chunks via WebSocket; the backend pipes them to
    // FFmpeg stdin.  Omit -f so FFmpeg auto-detects the container — this covers
    // both WebM (Chrome/Android) and MP4 (Safari/iOS) without needing to know
    // the client's codec in advance.  Give FFmpeg enough probe budget to parse
    // the container header before it starts decoding.
    args.push(
      "-analyzeduration", "5000000",
      "-probesize", "500000",
      "-thread_queue_size", "4096",
      "-i", "pipe:0",
    );
  } else if (sourceType === "camera") {
    // Detect network/IP cameras by URL scheme — must NOT use -f v4l2 for these
    const isNetworkCamera =
      inputUrl.startsWith("rtsp://") ||
      inputUrl.startsWith("rtsps://") ||
      inputUrl.startsWith("http://") ||
      inputUrl.startsWith("https://") ||
      inputUrl.startsWith("rtp://");
    if (isNetworkCamera) {
      args.push(
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_on_network_error", "1",
        "-reconnect_delay_max", "5",
        "-rw_timeout", "10000000",
        "-thread_queue_size", "4096",
        "-fflags", "+discardcorrupt",
        "-i", inputUrl,
      );
    } else {
      // Local V4L2 / avfoundation / dshow device path
      const isWin = process.platform === "win32";
      const isMac = process.platform === "darwin";
      if (isWin) {
        args.push("-f", "dshow", "-thread_queue_size", "4096", "-i", `video=${inputUrl}`);
      } else if (isMac) {
        args.push("-f", "avfoundation", "-framerate", String(fps), "-thread_queue_size", "4096", "-i", inputUrl);
      } else {
        args.push("-f", "v4l2", "-framerate", String(fps), "-thread_queue_size", "4096", "-i", inputUrl);
      }
    }
  } else if (sourceType === "youtube") {
    // Direct HLS (.m3u8 URL pasted by user) — FFmpeg reads segments directly.
    const cookieHeader = getYouTubeFFmpegCookieHeader();
    const ytHeaders = [
      "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      "Accept: */*",
      "Accept-Language: en-US,en;q=0.9",
      "Referer: https://www.youtube.com/",
      ...(cookieHeader ? [cookieHeader.trimEnd()] : []),
    ].join("\r\n") + "\r\n";
    args.push(
      "-headers", ytHeaders,
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_on_network_error", "1",
      "-reconnect_at_eof", "1",
      "-reconnect_delay_max", "5",
      "-tls_verify", "0",
      "-rw_timeout", "10000000",
      "-thread_queue_size", "4096",
      "-fflags", "+genpts+discardcorrupt",
      "-i", inputUrl,
    );
  } else if (sourceType === "youtube_pipe") {
    // yt-dlp pipe mode: yt-dlp streams MPEG-TS to FFmpeg stdin.
    // yt-dlp handles all HLS segment fetches and POT token rotation internally
    // so YouTube CDN never sees bare unauthenticated requests (no 429).
    args.push(
      "-analyzeduration", "10000000",
      "-probesize", "10000000",
      "-thread_queue_size", "4096",
      "-fflags", "+genpts+discardcorrupt",
      "-i", "pipe:0",
    );
  } else if (sourceType === "xspace") {
    // X Space: yt-dlp extracts the HLS audio URL; FFmpeg reads audio-only.
    // No video track — the filter graph uses lavfi black + gradient as video.
    args.push(
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_on_network_error", "1",
      "-reconnect_delay_max", "5",
      "-rw_timeout", "10000000",
      "-thread_queue_size", "4096",
      "-fflags", "+genpts+discardcorrupt",
      "-i", inputUrl,
    );
  } else if (isUpload) {
    // Uploaded video file — loop indefinitely with -stream_loop -1 for 24/7 play.
    // -re reads at native framerate so FFmpeg doesn't race ahead of real-time.
    const loopArgs = shouldLoop ? ["-stream_loop", "-1"] : [];
    args.push(
      ...loopArgs,
      "-re",
      "-thread_queue_size", "4096",
      "-fflags", "+genpts",
      "-i", inputUrl,
    );
  } else {
    // TikTok HLS — aggressive reconnect so TLS/EOF drops never stop the stream.
    // tls_verify 0: TikTok CDN edge servers often use certificates that don't
    //   match the request hostname; disabling verification prevents the
    //   "Decryption has failed" TLS error that kills the stream after ~10s.
    // reconnect_delay_max 5: recover fast — expired HLS segments need a quick
    //   retry, not a 30s back-off that leaves the stream frozen.
    // rw_timeout 10s: detect dead connections faster so handleProcessExit fires
    //   sooner and a fresh URL is fetched for recovery.
    // multiple_requests 1: reuse the HTTP/TLS connection across HLS segment
    //   requests, reducing per-segment TLS handshake overhead.
    args.push(
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_on_network_error", "1",
      "-reconnect_at_eof", "1",
      "-reconnect_delay_max", "5",
      "-multiple_requests", "1",
      "-tls_verify", "0",
      "-rw_timeout", "10000000",
      "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "-referer", "https://www.tiktok.com/",
      "-thread_queue_size", "8192",
      // genpts: regenerate timestamps on reconnect so PTS discontinuities
      // don't stall the filter graph and cause a visible cut.
      "-fflags", "+genpts+discardcorrupt",
      "-i", inputUrl,
    );
  }

  // ── Input 1: lavfi black video — the "never-dies" fallback ───────────────
  // pixel_format=yuv420p + -color_range 1 (tv): explicit range avoids the
  // "deprecated pixel format used, make sure you did set range correctly" warning.
  args.push(
    "-f", "lavfi",
    "-thread_queue_size", "64",
    "-color_range", "1",
    "-i", `color=c=black:size=${scaleW}x${scaleH}:rate=${fps}`,
  );

  // ── Input 2: lavfi silence — audio fallback ───────────────────────────────
  args.push(
    "-f", "lavfi",
    "-thread_queue_size", "64",
    "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
  );

  // ── Input 3: background gradient raw-RGBA pipe (fd 3) ────────────────────
  // thread_queue_size=8: at 5fps each frame is ~3.7MB; 8 frames = 30MB max queue.
  // 512 (the old value) would allocate ~1.9GB and trigger the OOM killer (SIGKILL).
  args.push(
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-video_size", `${scaleW}x${scaleH}`,
    "-framerate", "5",
    "-thread_queue_size", "8",
    "-i", "pipe:3",
  );

  // ── Input 4: UI overlay raw-RGBA pipe (fd 4) ──────────────────────────────
  args.push(
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-video_size", `${scaleW}x${scaleH}`,
    "-framerate", "5",
    "-thread_queue_size", "8",
    "-i", "pipe:4",
  );

  // ── Input 5: browser mic audio — PCM16 mono 44100 Hz via pipe:5 ──────────
  // MicAudioPipe continuously writes silence (or real PCM16 when the control-room
  // operator has the mic enabled). This input is always present so the filter
  // graph stays consistent and no FFmpeg restart is needed to toggle mic on/off.
  args.push(
    "-f", "s16le",
    "-ar", "44100",
    "-ac", "1",
    "-thread_queue_size", "4096",
    "-i", "pipe:5",
  );

  // ── Input 6: volume control signal — f32le stereo 44100 Hz via pipe:6 ────
  // VolumeControlPipe writes constant-amplitude samples (0.0 = muted, 1.0 = full).
  // amultiply in the filter graph multiplies source audio sample-by-sample by this
  // signal, enabling real-time volume/mute with ZERO stream reconnection.
  args.push(
    "-f", "f32le",
    "-ar", "44100",
    "-ac", "2",
    "-thread_queue_size", "512",
    "-i", "pipe:6",
  );

  // ── Input 7: X Space background media (image URL, local image, or local video) ──
  // Priority: xspaceVideoPath (uploaded local file) > xspaceImageUrl (remote URL).
  // Local image: -loop 1 -framerate 2 keeps a still image looping as video frames.
  // Local video: -stream_loop -1 loops the video file forever (no audio taken from it).
  // Remote image URL: -loop 1 (existing behaviour, kept for backwards compat).
  const xspaceImageUrl = sourceType === "xspace" ? (stream.xspaceImageUrl ?? "").trim() : "";
  const xspaceVideoPath = sourceType === "xspace" ? (stream.xspaceVideoPath ?? "").trim() : "";
  const videoExts = new Set([".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".ts"]);
  const xspaceLocalIsVideo = xspaceVideoPath
    ? videoExts.has(path.extname(xspaceVideoPath).toLowerCase())
    : false;

  if (xspaceVideoPath) {
    if (xspaceLocalIsVideo) {
      // Looped video file as visual background (audio intentionally ignored)
      args.push("-stream_loop", "-1", "-thread_queue_size", "8", "-i", xspaceVideoPath);
    } else {
      // Static image file (jpg/png/webp)
      args.push("-loop", "1", "-framerate", "2", "-thread_queue_size", "8", "-i", xspaceVideoPath);
    }
  } else if (xspaceImageUrl) {
    args.push("-loop", "1", "-thread_queue_size", "8", "-i", xspaceImageUrl);
  }

  // threads=0: auto-detect (all available cores).
  // The filter graph has 7 inputs, 4 overlay operations, scale/pad/crop chains,
  // and an x264 encode — all running in real-time.  Capping at 2 threads on a
  // shared CPU means the encoder falls behind real-time, drops frames, and
  // YouTube sees gaps that trigger "not receiving enough video" warnings.
  // filter_threads=4: the filter graph runs in a separate thread pool from the
  // codec; giving it explicit threads prevents the overlays from starving x264.
  // max_interleave_delta=0: don't buffer A/V waiting to interleave — emit each
  // packet as soon as it's ready so RTMP data flows at a constant rate.
  args.push(
    "-threads", "0",
    "-filter_threads", "4",
    "-filter_complex_threads", "4",
    "-max_muxing_queue_size", "2048",
    "-max_interleave_delta", "0",
  );

  // ── Filter graph ──────────────────────────────────────────────────────────
  //
  // Video chain (non-xspace):
  //   [0:v] live source  → scale (maintain AR, may be smaller than frame)    → [_src]
  //   [1:v] lavfi black  → base; [_src] centred on top                       → [_withvideo]
  //   [3:v] bg gradient  → semi-transparent blobs overlaid OVER video        → [_composed]
  //   [4:v] UI overlay   → chat/news/stats on top                            → [_final]
  //
  // Video chain (xspace — audio-only source, no [0:v]):
  //   [1:v] lavfi black  → base                                              → [_base]
  //   [3:v] bg gradient  → overlaid on top                                   → [_base2]
  //   [4:v] UI overlay   → final output                                      → [_final]
  //
  // Audio chain:
  //   Source volume applied via `volume=X` filter (X from globalStreamVolume).
  //   When muted, source volume = 0 but mic pipe (pipe:5) still contributes.
  //   mic pipe is always present; silence when inactive, real PCM16 when active.
  //   isLocalCamera: source has no audio — silence fallback + mic only.

  const isXSpace = sourceType === "xspace";

  // Mic noise reduction: highpass removes low-frequency rumble, noise gate suppresses
  // background noise between words. Applied before mixing so it doesn't affect source audio.
  const micClean = `[5:a]highpass=f=80,agate=threshold=0.015:ratio=8:attack=0.01:release=0.15[_mic]`;

  // Volume is controlled dynamically via VolumeControlPipe on pipe:6 — no restart needed.
  // [6:a] is a constant-amplitude f32le stereo signal; amultiply scales source audio by it.
  let audioFilter: string;
  if (isLocalCamera) {
    // Local v4l2/avfoundation device has no audio track — silence fallback + mic only.
    audioFilter = [
      `[6:a]aformat=sample_fmts=fltp:channel_layouts=stereo[_vol]`,
      `[2:a][_vol]amultiply[_srcFin]`,
      micClean,
      `[_srcFin][_mic]amix=inputs=2:dropout_transition=2:normalize=0[_rawA]`,
      // async=8000: gentle drift correction — 8000 sample window (≈180ms at 44100Hz)
      // lets audio lag/lead up to that amount before FFmpeg corrects it.  The
      // aggressive async=1000 caused high-frequency corrections that spiked CPU and
      // momentarily stalled the muxer, contributing to YouTube buffering complaints.
      `[_rawA]aresample=async=8000[_audio]`,
    ].join(";");
  } else {
    // Live source (TikTok / YouTube / X Space / RTSP / browser camera) has audio.
    // Blend source + silence fallback, multiply by volume pipe, then mix in cleaned mic.
    audioFilter = [
      // dropout_transition=10: bridge up to 10s of source audio dropout with silence
      // so a brief network hiccup never causes an audible gap in the RTMP output.
      `[2:a][0:a]amix=inputs=2:duration=first:dropout_transition=10:normalize=0[_srcRaw]`,
      `[6:a]aformat=sample_fmts=fltp:channel_layouts=stereo[_vol]`,
      `[_srcRaw][_vol]amultiply[_srcFin]`,
      micClean,
      `[_srcFin][_mic]amix=inputs=2:dropout_transition=10:normalize=0[_rawA]`,
      `[_rawA]aresample=async=8000[_audio]`,
    ].join(";");
  }

  let filterGraph: string;

  if (isXSpace) {
    // X Space is audio-only — no [0:v] exists. Build video from gradient/black only.
    const hasXSpaceBg = !!(xspaceVideoPath || xspaceImageUrl);
    if (hasXSpaceBg) {
      // With a background media (input 7): scale & pad it to fill frame, overlay
      // above the gradient but below the UI overlay so the image/video is visible behind chat.
      // For video loops: eof_action=repeat on the UI overlay keeps rendering if the video
      // file temporarily stalls; the video itself loops via -stream_loop -1.
      filterGraph = [
        `[3:v]format=rgba,scale=${scaleW}:${scaleH}[_bg]`,
        `[1:v][_bg]overlay=0:0:format=auto[_base]`,
        `[7:v]scale=${scaleW}:${scaleH}:force_original_aspect_ratio=decrease,pad=${scaleW}:${scaleH}:(ow-iw)/2:(oh-ih)/2,format=rgba[_img]`,
        `[_base][_img]overlay=0:0:format=auto[_baseImg]`,
        `[4:v]scale=${scaleW}:${scaleH}[_ui]`,
        `[_baseImg][_ui]overlay=0:0:format=auto:eof_action=repeat,format=yuv420p[_final]`,
        audioFilter,
      ].join(";");
    } else {
      filterGraph = [
        `[3:v]format=rgba,scale=${scaleW}:${scaleH}[_bg]`,
        `[1:v][_bg]overlay=0:0:format=auto[_base]`,
        `[4:v]scale=${scaleW}:${scaleH}[_ui]`,
        `[_base][_ui]overlay=0:0:format=auto:eof_action=repeat,format=yuv420p[_final]`,
        audioFilter,
      ].join(";");
    }
  } else {
    // Scale video to fill the OUTPUT WIDTH exactly, then:
    //   • pad top/bottom with transparent pixels when the scaled height < frame height
    //     (e.g. landscape 16:9 source in a portrait 9:16 frame)
    //   • center-crop top/bottom when the scaled height > frame height
    //     (e.g. portrait 9:16 source in a landscape 16:9 frame)
    // Result: left & right edges always touch the frame edge; gradient from
    // pipe:3 shows through the transparent top/bottom bars.
    // IMPORTANT: format=yuva420p must come FIRST so that the pad filter can
    // write alpha=0 (transparent) pixels into the bar areas.  Placing it at
    // the end means pad runs on yuv420p (no alpha) and the filter graph
    // deadlocks — FFmpeg hangs, never exits, and handleProcessExit never fires.
    const videoSrcFilter = [
      `[0:v]format=yuva420p`,
      `scale=${scaleW}:-2`,
      `pad=${scaleW}:'if(lte(ih,${scaleH}),${scaleH},ih)':0:'if(lte(ih,${scaleH}),(${scaleH}-ih)/2,0)':color=black@0`,
      `crop=${scaleW}:${scaleH}:0:'if(gte(ih,${scaleH}),(ih-${scaleH})/2,0)'`,
      `setsar=1[_src]`,
    ].join(",");

    filterGraph = [
      videoSrcFilter,
      // Step 1: gradient pipe scales to fill the frame.
      `[3:v]format=rgba,scale=${scaleW}:${scaleH}[_bg]`,
      // Step 2: black fallback base + gradient on top → solid coloured background.
      `[1:v][_bg]overlay=0:0:format=auto[_base]`,
      // Step 3: video (yuva420p — transparent bars where no video pixels exist)
      // laid on top of the gradient background.
      // • Where the video is opaque → gradient hidden (video covers it completely).
      // • Where bars exist (alpha=0 transparent pixels) → gradient shows through.
      // eof_action=repeat: freeze last video frame during brief reconnect gaps.
      `[_base][_src]overlay=0:0:format=auto:eof_action=repeat[_composed]`,
      `[4:v]scale=${scaleW}:${scaleH}[_ui]`,
      `[_composed][_ui]overlay=0:0:format=auto:eof_action=repeat,format=yuv420p[_final]`,
      audioFilter,
    ].join(";");
  }

  args.push("-filter_complex", filterGraph);
  args.push("-map", "[_final]");
  args.push("-map", "[_audio]");

  args.push(
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-tune", "zerolatency",
    "-b:v", bitrate,
    "-maxrate", maxrate,
    "-bufsize", bufsize,
    "-profile:v", "high",
    "-level", "4.0",
    "-bf", "0",
    "-x264-params", "nal-hrd=cbr:force-cfr=1",
    "-pix_fmt", "yuv420p",
    "-g", String(fps * 2),
    "-keyint_min", String(fps * 2),
    "-sc_threshold", "0",
    "-r", String(fps),
    "-fps_mode", "cfr",
    "-flags", "+global_header",
  );

  args.push(
    "-c:a", "aac",
    "-b:a", "160k",
    "-ar", "44100",
    "-ac", "2",
  );

  // ── RTMP output(s) — always tee for resilience ───────────────────────────
  // rw_timeout=20s: YouTube ingest can be slow to accept connections; 5s was
  // too short and caused outputs to be classified as failed prematurely.
  // onfail=ignore is intentionally NOT used here — once an output is dropped
  // by the tee muxer with onfail=ignore it is permanently gone and never
  // reconnects, causing YouTube "not receiving data" errors. We instead detect
  // the failure via the stderr "Ignoring failure for output" message and do a
  // clean hardKillAndRestart so the full RTMP session is re-established.
  //
  // rtmp_buffer=5000 (5 seconds): a client-side RTMP send buffer between
  // FFmpeg and YouTube's ingest server.  Without it, any encoder pause
  // (HLS segment boundary, CPU burst, brief filter stall) sends nothing to
  // YouTube for that interval, triggering the "not receiving enough video to
  // maintain smooth streaming" warning.  A 5-second buffer absorbs those
  // pauses and keeps data flowing at a constant rate to the ingest server.
  args.push("-avoid_negative_ts", "make_zero");
  const teeOutputs = outputs
    .map((o) => `[f=flv:flvflags=no_duration_filesize:rtmp_live=1:rtmp_buffer=5000:rw_timeout=20000000]${o}`)
    .join("|");
  args.push("-f", "tee", teeOutputs);

  return args;
}

// ── Circuit-breaker-guarded URL resolver ──────────────────────────────────────
// All code paths that need a live URL call this wrapper instead of
// resolveInputUrl directly.  The wrapper enforces the circuit-breaker policy
// so that a storm of resolution failures (e.g. rate-limit cascade) cannot
// spawn unbounded yt-dlp / streamlink processes.
async function resolveInputUrlSafe(
  stream: StreamConfig,
  forceRefresh: boolean,
): Promise<{ url: string; sourceType: "tiktok" | "youtube" | "camera" | "upload" }> {
  const { id: streamId, sourceType } = stream;

  // Camera and upload sources are resolved locally — no external resolver needed
  if (sourceType === "camera" || sourceType === "upload") {
    return resolveInputUrl(stream, forceRefresh);
  }

  if (!cbCanAttempt(streamId)) {
    const cb = getCB(streamId);
    const remainMs = Math.max(0, CB_OPEN_COOLDOWN_MS - (Date.now() - (cb.openedAt ?? 0)));
    const remainMin = Math.ceil(remainMs / 60_000);
    throw new Error(
      `[circuit-breaker] URL resolution suspended — too many failures. Resuming in ~${remainMin} min.`,
    );
  }

  try {
    const result = await resolveInputUrl(stream, forceRefresh);
    cbRecordSuccess(streamId);
    return result;
  } catch (e: any) {
    // Definitive errors (NOT_LIVE, LIVE_ENDED, etc.) are not resolver failures —
    // they indicate the source is genuinely unavailable, not a transient problem.
    // Don't charge them against the circuit breaker.
    const code: string | undefined = e.code;
    const definitiveErrors = new Set([
      "NOT_LIVE", "LIVE_ENDED", "PRIVATE_ACCOUNT", "PRIVATE_VIDEO",
      "REGION_RESTRICTED", "GEO_RESTRICTED", "AGE_RESTRICTED",
      "MEMBERS_ONLY", "SCHEDULED", "UNAVAILABLE",
    ]);
    if (!code || !definitiveErrors.has(code)) {
      cbRecordFailure(streamId);
    }
    throw e;
  }
}

async function resolveInputUrl(
  stream: StreamConfig,
  forceRefresh = false,
): Promise<{ url: string; sourceType: "tiktok" | "youtube" | "camera" | "upload" }> {
  const sourceType = stream.sourceType || "tiktok";

  if (sourceType === "upload") {
    const filePath = stream.uploadedVideoPath || "";
    if (!filePath) throw new Error("No video file uploaded. Please upload a video file first.");
    const fs = await import("fs");
    if (!fs.existsSync(filePath)) throw new Error(`Uploaded video file not found: ${filePath}`);
    return { url: filePath, sourceType: "upload" };
  }

  if (sourceType === "camera") {
    // Browser camera mode — WebSocket sends video data directly to FFmpeg stdin.
    // Treat empty device, __browser__, or the schema placeholder /dev/video0
    // (which doesn't exist in cloud/Replit environments) as __browser__ so that
    // Guest Room mode works without needing to explicitly set the device path.
    const device = stream.cameraDevice || "";
    const isPlaceholder = device === "" || device === "/dev/video0";
    if (browserCameraStreams.has(stream.id) || device === "__browser__" || isPlaceholder) {
      return { url: "__browser__", sourceType: "camera" };
    }
    return { url: device, sourceType: "camera" };
  }

  // Reuse a recently cached URL to skip 20-35s re-resolution on fast restarts
  if (!forceRefresh) {
    const cached = getCachedUrl(stream.id);
    if (cached && cached.sourceType === sourceType) {
      logger.info({ streamId: stream.id, sourceType }, "Reusing cached input URL");
      return { url: cached.url, sourceType: cached.sourceType };
    }
  }

  if (sourceType === "youtube") {
    const input = (stream.youtubeSourceUrl || "").trim();
    if (!input) throw new Error("YouTube source URL or handle is required");

    // If the user pasted a direct HLS .m3u8 URL, pass it to FFmpeg as-is.
    // For all other YouTube URLs (page/channel/handle), use yt-dlp pipe mode:
    // yt-dlp streams MPEG-TS to FFmpeg stdin, keeping all CDN requests (including
    // POT token rotation) inside yt-dlp's session — this avoids the 429 errors
    // that occur when FFmpeg tries to fetch HLS segments directly from YouTube CDN.
    const isDirect = input.includes(".m3u8");
    if (isDirect) {
      urlCache.set(stream.id, { url: input, sourceType: "youtube", resolvedAt: Date.now() });
      return { url: input, sourceType: "youtube" };
    }
    // Return pipe:0 — yt-dlp will be spawned in startStream and piped to FFmpeg stdin.
    return { url: "pipe:0", sourceType: "youtube_pipe" as any };
  }

  if (sourceType === "xspace") {
    const spaceUrl = stream.xspaceUrl || "";
    if (!spaceUrl) throw new Error("X Space URL is required");
    // yt-dlp extracts the HLS audio URL from the X Space link.
    // Cache it — yt-dlp extraction can take 10-20s and the URL is valid for ~10min.
    const audioUrl = await getXSpaceAudioUrl(spaceUrl);
    urlCache.set(stream.id, { url: audioUrl, sourceType: "xspace" as any, resolvedAt: Date.now() });
    return { url: audioUrl, sourceType: "xspace" as any };
  }

  if (!stream.tiktokUsername) throw new Error("TikTok username is required");
  const tiktokResult = await getTikTokStreamUrl(stream.tiktokUsername, stream.quality || "best");
  urlCache.set(stream.id, { url: tiktokResult.url, sourceType, resolvedAt: Date.now() });
  return { url: tiktokResult.url, sourceType: "tiktok" };
}

async function getXSpaceAudioUrl(spaceUrl: string): Promise<string> {
  const xCookiesPath = path.join(process.cwd(), "x-cookies.txt");
  const cookiesArgs = fs.existsSync(xCookiesPath) ? ["--cookies", xCookiesPath] : [];

  const MAX_ATTEMPTS = 4;
  const BACKOFF_MS = [0, 3_000, 9_000, 27_000]; // 0s, 3s, 9s, 27s

  let lastError = "";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const delay = BACKOFF_MS[attempt - 1] ?? 27_000;
    if (delay > 0) {
      logger.info({ spaceUrl, attempt, delayMs: delay }, "[xspace] Waiting before retry...");
      await new Promise<void>((r) => setTimeout(r, delay));
    }

    try {
      const url = await new Promise<string>((resolve, reject) => {
        const ytdlp = spawn(YTDLP_BIN, [
          "-g",
          "--no-playlist",
          "-f", "bestaudio",
          "--no-warnings",
          "--socket-timeout", "20",
          ...cookiesArgs,
          spaceUrl,
        ]);

        let stdout = "";
        let stderr = "";
        ytdlp.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
        ytdlp.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

        const timer = setTimeout(() => {
          try { ytdlp.kill("SIGKILL"); } catch {}
          reject(new Error("yt-dlp timed out after 30s"));
        }, 30_000);

        ytdlp.on("close", (code) => {
          clearTimeout(timer);
          const audioUrl = stdout.trim().split("\n")[0]?.trim();
          if (code === 0 && audioUrl) {
            resolve(audioUrl);
          } else {
            reject(new Error(`yt-dlp failed (code ${code}): ${stderr.slice(0, 300)}`));
          }
        });

        ytdlp.on("error", (err: NodeJS.ErrnoException) => {
          clearTimeout(timer);
          reject(new Error(err.code === "ENOENT" ? "yt-dlp is not installed on the server" : err.message));
        });
      });

      logger.info({ spaceUrl, attempt }, "[xspace] HLS audio URL extracted successfully");
      return url;
    } catch (err: any) {
      lastError = err?.message ?? String(err);
      const isFatal =
        lastError.includes("is not installed") ||
        lastError.includes("Space has ended") ||
        lastError.includes("not found") ||
        lastError.includes("does not exist");

      logger.warn({ spaceUrl, attempt, error: lastError }, `[xspace] Attempt ${attempt}/${MAX_ATTEMPTS} failed`);

      if (isFatal || attempt === MAX_ATTEMPTS) break;
    }
  }

  throw new Error(`Failed to extract X Space audio after ${MAX_ATTEMPTS} attempts. Last error: ${lastError}`);
}

// ── Frame-stall watchdog ──────────────────────────────────────────────────────
// 30 s: tolerant enough to survive HLS segment gaps and brief network hiccups,
// while still fast enough to catch a dead source before the YouTube platform
// buffer fully drains (~60 s).
const STALL_TIMEOUT_MS = 30_000;
const HEALTH_WARN_MS = 15_000; // warn before stall watchdog fires
// TikTok/xSpace streamlink sessions expire after ~3 hours.  Force a proactive
// restart before that so the stream never dies silently from session expiry.
const SESSION_REFRESH_MS = 3 * 60 * 60 * 1000; // 3 hours


function makeStallWatchdog(
  streamId: string,
  getLastFrame: () => number,
  trigger: () => void,
): NodeJS.Timeout {
  let lastSeenFrame = getLastFrame();
  return setInterval(() => {
    const currentFrame = getLastFrame();
    if (currentFrame === lastSeenFrame) {
      logger.warn({ streamId, frame: currentFrame }, "Frame stall detected — triggering restart");
      sendLog(streamId, `Frame stall detected (no new frames for ${STALL_TIMEOUT_MS / 1000}s) — restarting...`);
      trigger();
    } else {
      lastSeenFrame = currentFrame;
    }
  }, STALL_TIMEOUT_MS);
}

function stopBreakDecoder(streamId: string): void {
  const proc = activeStreams.get(streamId);
  if (!proc) return;
  if (proc.breakDecoder) {
    try { proc.breakDecoder.kill("SIGKILL"); } catch {}
    proc.breakDecoder = undefined;
  }
  proc.uiRenderer?.setExternalFrame(null);
}

function startBreakDecoder(
  streamId: string,
  videoUrl: string,
  panX: number,
  panY: number,
  breakVideoMode?: string,
): void {
  const proc = activeStreams.get(streamId);
  if (!proc?.uiRenderer) return;

  const stream = storage.getStream(streamId);
  if (!stream) return;

  // Kill any running decoder for this stream before starting a new one
  if (proc.breakDecoder) {
    try { proc.breakDecoder.kill("SIGKILL"); } catch {}
    proc.breakDecoder = undefined;
  }

  const isVertical = stream.ratio === "mobile";
  const isHDQuality = stream.quality === "best" || stream.quality === "720p";
  const outW = isVertical ? (isHDQuality ? 720 : 480) : (isHDQuality ? 1280 : 854);
  const outH = isVertical ? (isHDQuality ? 1280 : 854) : (isHDQuality ? 720 : 480);

  const panXF = (panX / 100).toFixed(4);
  const panYF = (panY / 100).toFixed(4);

  const mode = breakVideoMode ?? currentOverlayState.breakVideoMode ?? "fullscreen";

  let vf: string;
  if (mode === "live-bg" || mode === "gradient-bg") {
    // Letterbox: preserve video aspect ratio with transparent bars so the BG pipe shows through.
    vf = [
      `scale=${outW}:${outH}:force_original_aspect_ratio=decrease`,
      `pad=${outW}:${outH}:(ow-iw)/2:(oh-ih)/2:color=black@0.0`,
      `format=rgba`,
    ].join(",");
  } else {
    // fullscreen: scale to fill the output frame, then crop with pan offset — no black bars.
    vf = [
      `scale='if(gt(iw/ih,${outW}/${outH}),trunc(oh*(iw/ih)/2)*2,${outW})':'if(gt(iw/ih,${outW}/${outH}),${outH},trunc(ow*(ih/iw)/2)*2)'`,
      `crop=${outW}:${outH}:max(0\\,(iw-${outW})*${panXF}):max(0\\,(ih-${outH})*${panYF})`,
      `format=rgba`,
    ].join(",");
  }

  const isHttp = videoUrl.startsWith("http://") || videoUrl.startsWith("https://");
  const isHttps = videoUrl.startsWith("https://");
  const inputArgs: string[] = isHttp
    ? [
        "-stream_loop", "-1",
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_on_network_error", "1",
        "-reconnect_delay_max", "5",
        "-rw_timeout", "15000000",
        ...(isHttps ? ["-tls_verify", "0"] : []),
      ]
    : ["-stream_loop", "-1"];

  const decoderArgs = [
    "-loglevel", "error",
    "-re",           // real-time rate: prevents reading far ahead of the renderer
    ...inputArgs,
    "-i", videoUrl,
    "-vf", vf,
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-r", "5",
    "pipe:1",
  ];

  sendLog(streamId, "Break video: decoder starting (no stream interruption)…");
  const decoder = spawn("ffmpeg", decoderArgs);
  proc.breakDecoder = decoder;

  const frameSize = outW * outH * 4;
  let accumulated = Buffer.allocUnsafe(0);
  let decoderGotFrames = false;

  decoder.stdout?.on("data", (chunk: Buffer) => {
    if (!decoderGotFrames) {
      decoderGotFrames = true;
      sendLog(streamId, "Break video: playing ✓");
    }
    accumulated = Buffer.concat([accumulated, chunk]);
    while (accumulated.length >= frameSize) {
      const frame = accumulated.subarray(0, frameSize);
      accumulated = accumulated.subarray(frameSize);
      // Discard if too far ahead (>3 frames) to prevent memory growth
      if (accumulated.length < frameSize * 3) {
        const currentProc = activeStreams.get(streamId);
        if (currentProc?.breakDecoder === decoder) {
          currentProc.uiRenderer?.setExternalFrame(Buffer.from(frame));
        }
      }
    }
  });

  // Log decoder errors so the user can see why a URL failed
  let decoderErrBuf = "";
  decoder.stderr?.on("data", (chunk: Buffer) => {
    decoderErrBuf += chunk.toString();
    const lines = decoderErrBuf.split("\n");
    decoderErrBuf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      logger.warn({ streamId, decoder: t }, "Break decoder stderr");
      sendLog(streamId, `Break video error: ${t}`);
    }
  });

  decoder.on("exit", () => {
    const currentProc = activeStreams.get(streamId);
    if (!currentProc || currentProc.breakDecoder !== decoder) return;
    currentProc.breakDecoder = undefined;

    // Auto-restart decoder if break is still active with the same URL
    if (currentOverlayState.breakActive && currentOverlayState.breakVideoUrl === videoUrl) {
      logger.info({ streamId }, "Break decoder exited — restarting");
      setTimeout(() => {
        if (currentOverlayState.breakActive && activeStreams.has(streamId)) {
          startBreakDecoder(streamId, videoUrl, panX, panY, currentOverlayState.breakVideoMode);
        }
      }, 1000);
    } else {
      currentProc.uiRenderer?.setExternalFrame(null);
    }
  });

  decoder.on("error", (err: NodeJS.ErrnoException) => {
    const currentProc = activeStreams.get(streamId);
    if (currentProc?.breakDecoder === decoder) currentProc.breakDecoder = undefined;
    if (err.code === "ENOENT") sendLog(streamId, "Break decoder: ffmpeg not found on system");
  });
}

function purgeUploadsDir(): void {
  const dir = path.join(process.cwd(), "uploads");
  try {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    let count = 0;
    for (const file of files) {
      if (file === ".gitkeep") continue;
      try { fs.unlinkSync(path.join(dir, file)); count++; } catch {}
    }
    if (count > 0) logger.info({ dir, count }, "Uploads purged after last stream stopped");
  } catch (err: any) {
    logger.warn({ err: err.message }, "Failed to purge uploads directory");
  }
}

function startProcStatsPolling(streamId: string, pid: number): NodeJS.Timeout {
  return setInterval(() => {
    exec(`ps -p ${pid} -o %cpu=,rss=`, (err, stdout) => {
      if (err) {
        // Process gone — but only update scorer if the stream is still registered
        // in activeStreams. If handleProcessExit already cleaned up, scorerSetFFmpegAlive
        // would trigger a spurious recompute with no matching proc and no guards set.
        if (activeStreams.has(streamId)) scorerSetFFmpegAlive(streamId, false);
        return; // interval cleared in cleanupStreamProc
      }
      const parts = stdout.trim().split(/\s+/);
      if (parts.length < 2) return;
      const cpu = parseFloat(parts[0]);
      const mem = Math.round(parseInt(parts[1], 10) / 1024); // KB → MB
      if (!isNaN(cpu) && !isNaN(mem)) {
        const proc = activeStreams.get(streamId);
        const frames = proc?.lastFrameCount ?? 0;
        const uptime = proc?.streamStartTime ? Math.floor((Date.now() - proc.streamStartTime) / 1000) : 0;
        const health = getHealthSnapshot(streamId);
        broadcastStream(streamId, "proc_stats", {
          cpu,
          mem,
          frames,
          uptime,
          bitrate: proc?.lastBitrate ?? 0,
          fps: proc?.lastFps ?? 0,
          reconnectCount: proc?.reconnectCount ?? 0,
          healthScore: health?.score ?? 100,
          healthStatus: health?.status ?? "excellent",
        });
        // Mark source stable every polling cycle so failover can auto-reset
        markSourceStable(streamId);
      }
    });
  }, 3000);
}

function cleanupStreamProc(streamId: string, proc: StreamProcess) {
  if (proc.watchdog) clearTimeout(proc.watchdog);
  if (proc.stallWatchdog) clearInterval(proc.stallWatchdog);
  if (proc.statsInterval) clearInterval(proc.statsInterval);
  if (proc.prefetchTimer) clearTimeout(proc.prefetchTimer);
  if (proc.sessionRefreshTimer) clearTimeout(proc.sessionRefreshTimer);
  if (proc.ytSourceProcess) {
    try { proc.ytSourceProcess.kill("SIGKILL"); } catch {}
    proc.ytSourceProcess = undefined;
  }
  proc.bgRenderer?.stop();
  proc.uiRenderer?.stop();
  if (proc.micPipe) {
    proc.micPipe.stop();
    activeMicPipes.delete(proc.micPipe);
  }
  if (proc.volumePipe) proc.volumePipe.stop();
  if (proc.breakDecoder) {
    try { proc.breakDecoder.kill("SIGKILL"); } catch {}
    proc.breakDecoder = undefined;
  }
  browserCameraPipes.delete(streamId);
  browserCameraBuffers.delete(streamId);
  stopHlsEncoder(streamId);
  // Tell health scorer FFmpeg is no longer running (don't remove — keeps history)
  scorerSetFFmpegAlive(streamId, false);
}


export async function startStream(streamId: string, reuseUrl = false, keepStatus = false) {
  // Clear the manual-stop guard so auto-restart timers work again after an
  // explicit restart (API /start or hardKillAndRestart called from the UI).
  manuallyStopped.delete(streamId);

  const stream = storage.getStream(streamId);
  if (!stream) throw new Error("Stream not found");

  const sourceType = stream.sourceType || "tiktok";

  if (sourceType === "tiktok" && !stream.tiktokUsername)
    throw new Error("TikTok username is required");
  if (sourceType === "youtube" && !stream.youtubeSourceUrl)
    throw new Error("YouTube username or URL is required");
  if (sourceType === "camera" && !stream.cameraDevice && !browserCameraStreams.has(streamId))
    throw new Error("Camera device path is required (or use the browser camera link)");
  if (sourceType === "xspace" && !stream.xspaceUrl)
    throw new Error("X Space URL is required");
  if (sourceType === "upload" && !stream.uploadedVideoPath)
    throw new Error("No video file uploaded. Upload a video file before starting the stream.");
  if (!stream.youtubeStreamKey && !stream.facebookRtmpUrl && !stream.instagramStreamKey && !stream.tiktokStreamKey)
    throw new Error("At least one output (YouTube, Facebook, Instagram, or TikTok) is required");

  stopStream(streamId);

  // Register with health scorer — compute target bitrate from quality setting
  const qualityBitrateKbps = stream.quality === "best" ? 4000 : stream.quality === "720p" ? 2500 : 1500;
  scorerRegisterStream(streamId, qualityBitrateKbps);

  sendLog(streamId, `--- Starting stream ---`);
  sendLog(streamId, `Quality: ${stream.quality} | FPS: ${stream.fps} | Layout: ${stream.ratio}`);
  sendLog(streamId, `Audio: ${stream.muted ? "Muted" : "On"} | Auto-restart: ${stream.autoRestart ? "On" : "Off"}`);
  sendLog(streamId, `Overlay: burn-in enabled (canvas → FFmpeg pipe)`);
  if (!keepStatus) sendStatus(streamId, "reconnecting");

  try {
    if (sourceType === "tiktok") {
      sendLog(streamId, `Fetching TikTok live stream for @${stream.tiktokUsername}...`);
    } else if (sourceType === "youtube") {
      sendLog(streamId, `YouTube source: direct HLS — connecting FFmpeg to ${stream.youtubeSourceUrl}...`);
    } else if (sourceType === "xspace") {
      sendLog(streamId, `Extracting X Space audio: ${stream.xspaceUrl}...`);
    } else if (sourceType === "upload") {
      const loopLabel = stream.uploadedVideoLoop !== false ? "looping 24/7" : "single play";
      sendLog(streamId, `Source: Uploaded video (${loopLabel}) → ${path.basename(stream.uploadedVideoPath || "")}`);
    } else if (browserCameraStreams.has(streamId) || stream.cameraDevice === "__browser__") {
      sendLog(streamId, `Source: Browser Camera (waiting for WebSocket stream from guest)`);
    } else {
      sendLog(streamId, `Using camera device: ${stream.cameraDevice}`);
    }

    const resolved = await resolveInputUrlSafe(stream, !reuseUrl);
    const inputUrl = resolved.url;
    const resolvedType = resolved.sourceType as string;

    // Guard: user may have clicked Stop while we were waiting for URL resolution
    // (TikTok/X Space extraction can take 10–35 s). If the stream was deleted from
    // storage in the meantime, abort — otherwise FFmpeg would spawn as an orphan.
    if (!storage.getStream(streamId)) {
      sendLog(streamId, "Stream was stopped during URL resolution — aborting.");
      return;
    }

    if (sourceType === "tiktok") {
      const inputType = inputUrl.includes(".m3u8") ? "HLS" : "FLV";
      sendLog(streamId, `Using ${inputType} stream input`);
    } else if (sourceType === "youtube" || resolvedType === "youtube_pipe") {
      const modeLabel = resolvedType === "youtube_pipe" ? "pipe mode (yt-dlp → stdin)" : "direct HLS";
      sendLog(streamId, `YouTube source ready [${modeLabel}] — launching FFmpeg...`);
    }

    const outputs: string[] = [];
    if (stream.youtubeStreamKey) {
      outputs.push(`rtmp://a.rtmp.youtube.com/live2/${stream.youtubeStreamKey}`);
      sendLog(streamId, `Output: YouTube`);
    }
    if (stream.facebookRtmpUrl) {
      outputs.push(`rtmps://live-api-s.facebook.com:443/rtmp/${stream.facebookRtmpUrl}`);
      sendLog(streamId, `Output: Facebook`);
    }
    if (stream.instagramStreamKey) {
      outputs.push(`rtmps://live-upload.instagram.com:443/live/${stream.instagramStreamKey}`);
      sendLog(streamId, `Output: Instagram`);
    }
    if (stream.tiktokStreamKey) {
      outputs.push(`rtmp://push.tiktokv.com/live/${stream.tiktokStreamKey}`);
      sendLog(streamId, `Output: TikTok`);
    }

    const ffmpegArgs = buildFFmpegArgs(stream, inputUrl, outputs, resolvedType);
    sendLog(streamId, `Launching FFmpeg (1s GOP, 5s RTMP timeout, stall watchdog active)...`);

    // stdio[0] = stdin (pipe:0) — browser camera WebM only
    // stdio[3] = pipe:3 — background gradient RGBA
    // stdio[4] = pipe:4 — UI overlay RGBA
    // stdio[5] = pipe:5 — browser mic PCM16 mono 44100 Hz
    const ffmpegProc = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["pipe", "pipe", "pipe", "pipe", "pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    const isVertical = stream.ratio === "mobile";
    const isHDQuality = stream.quality === "best" || stream.quality === "720p";
    const overlayW = isVertical ? (isHDQuality ? 720 : 480) : (isHDQuality ? 1280 : 854);
    const overlayH = isVertical ? (isHDQuality ? 1280 : 854) : (isHDQuality ? 720 : 480);

    const bgRenderer = new OverlayRenderer(overlayW, overlayH, currentOverlayState, isVertical, "bg");
    const uiRenderer = new OverlayRenderer(overlayW, overlayH, currentOverlayState, isVertical, "ui");
    const stdioArr = ffmpegProc.stdio as (NodeJS.WritableStream | null | undefined)[];
    const bgPipe = stdioArr[3] as NodeJS.WritableStream;
    const uiPipe = stdioArr[4] as NodeJS.WritableStream;
    const micPipe5 = stdioArr[5] as NodeJS.WritableStream;

    bgPipe.on("error", () => {});
    uiPipe.on("error", () => {});
    micPipe5.on("error", () => {});

    // 5fps matches the declared -framerate on pipe:3 and pipe:4.
    // Lower rate prevents OOM: each 1280×720 RGBA frame is ~3.7MB;
    // 5fps × 2 pipes = ~37MB/s vs 10fps × 2 = ~74MB/s through Node.js.
    bgRenderer.startWritingTo(bgPipe, 5);
    uiRenderer.startWritingTo(uiPipe, 5);

    // Mic audio pipe: continuously writes PCM16 silence (or real mic audio) to pipe:5
    const micPipe = new MicAudioPipe();
    activeMicPipes.add(micPipe);
    micPipe.startWritingTo(micPipe5);

    const volPipe6 = stdioArr[6] as NodeJS.WritableStream;
    volPipe6.on("error", () => {});
    const volumePipe = new VolumeControlPipe(computeGain(stream.muted ?? false, currentOverlayState.liveAudioMuted, globalStreamVolume));
    volumePipe.startWritingTo(volPipe6);

    // Browser camera: register stdin as the writable camera pipe
    if (inputUrl === "__browser__") {
      const stdinPipe = ffmpegProc.stdin as NodeJS.WritableStream | null;
      if (stdinPipe) {
        stdinPipe.on("error", () => {});
        browserCameraPipes.set(streamId, stdinPipe);
        // Flush any WebM data (including the init segment) that arrived before FFmpeg started
        const buffered = browserCameraBuffers.get(streamId);
        if (buffered?.length) {
          browserCameraBuffers.delete(streamId);
          buffered.forEach((d) => { try { stdinPipe.write(d); } catch {} });
        }
      }
    }

    // YouTube pipe mode: spawn yt-dlp and pipe its stdout to FFmpeg stdin.
    // yt-dlp handles all HLS segment fetches including POT token rotation,
    // so YouTube CDN never rate-limits the connection (no 429 on segments).
    if (resolvedType === "youtube_pipe") {
      const ytArgs = getYouTubeYtdlpPipeArgs(normaliseYouTubeUrl((stream.youtubeSourceUrl || "").trim()));
      sendLog(streamId, `[yt-dlp] Spawning pipe: ${YTDLP_BIN} ${ytArgs.slice(-2).join(" ")}`);
      const ytProc = spawn(YTDLP_BIN, ytArgs, { stdio: ["ignore", "pipe", "pipe"] });

      const stdinPipe = ffmpegProc.stdin as NodeJS.WritableStream | null;
      if (stdinPipe) {
        stdinPipe.on("error", () => {});
        ytProc.stdout?.pipe(stdinPipe);
      }

      let ytErrBuf = "";
      ytProc.stderr?.on("data", (d: Buffer) => {
        ytErrBuf += d.toString();
        const lines = ytErrBuf.split("\n");
        ytErrBuf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          sendLog(streamId, `[yt-dlp] ${t}`);
          logger.info({ streamId, line: t }, "[youtube-pipe] yt-dlp stderr");
        }
      });

      ytProc.on("error", (err: NodeJS.ErrnoException) => {
        logger.error({ streamId, err: err.message }, "[youtube-pipe] yt-dlp spawn error");
        if (err.code === "ENOENT") {
          sendLog(streamId, "[yt-dlp] Binary not found — check server setup");
        } else {
          sendLog(streamId, `[yt-dlp] Error: ${err.message}`);
        }
      });

      ytProc.on("exit", (code, signal) => {
        logger.info({ streamId, code, signal }, "[youtube-pipe] yt-dlp exited");
        const currentProc = activeStreams.get(streamId);
        if (currentProc) currentProc.ytSourceProcess = undefined;
      });

      // Store so cleanupStreamProc can kill it on stop
      const currentProc = activeStreams.get(streamId);
      if (currentProc) currentProc.ytSourceProcess = ytProc;
    }

    let gotFrames = false;
    let lastProgressLog = 0;
    let lastFrameCount = 0;
    let stallWatchdog: NodeJS.Timeout | null = null;
    let lastOutputAt = Date.now();
    let healthWarned = false;
    let healthMonitor: NodeJS.Timeout | null = null;

    const startHealthMonitor = () => {
      healthMonitor = setInterval(() => {
        const silentMs = Date.now() - lastOutputAt;
        const proc = activeStreams.get(streamId);
        if (!proc || proc.ffmpegProcess !== ffmpegProc) {
          if (healthMonitor) { clearInterval(healthMonitor); healthMonitor = null; }
          return;
        }
        if (silentMs >= HEALTH_WARN_MS && !healthWarned) {
          healthWarned = true;
          broadcastStream(streamId, "stream_health", {
            status: "degraded",
            silentSeconds: Math.round(silentMs / 1000),
            message: `No FFmpeg output for ${Math.round(silentMs / 1000)}s — stream may be stalling`,
          });
        } else if (silentMs < HEALTH_WARN_MS && healthWarned) {
          healthWarned = false;
          broadcastStream(streamId, "stream_health", { status: "healthy" });
        }
      }, 5000);
    };

    ffmpegProc.stderr?.on("data", (errData: Buffer) => {
      lastOutputAt = Date.now();
      const lines = errData.toString().split("\n").filter(Boolean);
      lines.forEach((line) => {
        const trimmed = line.trim();

        if (trimmed.startsWith("frame=") || trimmed.startsWith("size=")) {
          const frameMatch = trimmed.match(/frame=\s*(\d+)/);
          if (frameMatch) {
            lastFrameCount = parseInt(frameMatch[1]);
            const currentProc = activeStreams.get(streamId);
            if (currentProc) currentProc.lastFrameCount = lastFrameCount;
          }

          // ── Parse fps and bitrate from FFmpeg progress line ────────────────
          // Format: frame=  123 fps= 30 q=28.0 size= 1234kB time=00:00:04.10 bitrate=2456.7kbits/s speed=1.00x
          const fpsMatch = trimmed.match(/fps=\s*([\d.]+)/);
          if (fpsMatch) {
            const fps = parseFloat(fpsMatch[1]);
            if (!isNaN(fps) && fps >= 0) {
              const currentProc = activeStreams.get(streamId);
              if (currentProc) currentProc.lastFps = fps;
              scorerRecordFps(streamId, fps);
            }
          }
          const bitrateMatch = trimmed.match(/bitrate=\s*([\d.]+)kbits\/s/);
          if (bitrateMatch) {
            const bitrateKbps = parseFloat(bitrateMatch[1]);
            if (!isNaN(bitrateKbps) && bitrateKbps > 0) {
              const currentProc = activeStreams.get(streamId);
              if (currentProc) currentProc.lastBitrate = bitrateKbps;
              scorerRecordBitrate(streamId, bitrateKbps);
            }
          }

          if (!gotFrames) {
            gotFrames = true;
            logger.info({ streamId }, "FFmpeg producing frames — stream is live");
            sendLog(streamId, `Streaming! Encoding and forwarding frames...`);
            sendStatus(streamId, "streaming");

            const liveProc = activeStreams.get(streamId);
            if (liveProc) liveProc.streamStartTime = Date.now();
            // Mark FFmpeg alive in health scorer now that frames are flowing
            scorerSetFFmpegAlive(streamId, true);
            // Stream is producing frames — reset the restart backoff so the next
            // failure starts the countdown fresh rather than hitting the long delays.
            resetBackoff(streamId);

            // ── HLS encoder (separate FFmpeg process, does not affect RTMP) ──
            if (process.env.HLS_ENABLED === "true") {
              startHlsEncoder(streamId, inputUrl, resolvedType, stream).catch((e: any) => {
                sendLog(streamId, `[hls] Encoder start failed: ${e.message}`);
              });
            }

            // ── Proactive URL pre-fetch for 24/7 TikTok/YouTube streaming ─────
            // Schedule a background URL refresh 8 minutes after going live.
            // The old FFmpeg keeps running uninterrupted while the new URL is
            // fetched (takes 5-35 s). Once in cache, we do a fast restart
            // (~300 ms kill + ~3-5 s FFmpeg startup) — invisible behind the
            // YouTube/Facebook platform buffer (~10-30 s).
            // This eliminates the 50-60 s black-screen gap that used to happen
            // when TikTok URLs expired mid-stream.
            // YouTube HLS CDN URLs (googlevideo.com) can also expire mid-stream
            // (~6 hour TTL, but can be shorter). Include youtube in the proactive
            // pre-fetch so a fresh URL is always cached before expiry.
            if (sourceType !== "camera" && sourceType !== "upload") {
              const schedulePrefetch = (intervalMs: number) => {
                const timer = setTimeout(async () => {
                  const currentProc = activeStreams.get(streamId);
                  if (!currentProc || currentProc.ffmpegProcess !== ffmpegProc) return;

                  sendLog(streamId, `[prefetch] Pre-fetching fresh source URL for 24/7 continuity...`);
                  try {
                    // Force a fresh resolution — bypasses any stale cache entry
                    urlCache.delete(streamId);
                    const resolved = await resolveInputUrlSafe(stream, false);
                    urlCache.set(streamId, {
                      url: resolved.url,
                      sourceType: resolved.sourceType as "tiktok" | "youtube" | "camera",
                      resolvedAt: Date.now(),
                    });
                    sendLog(streamId, `[prefetch] Fresh URL cached — will be used on next manual restart.`);
                  } catch (e: any) {
                    sendLog(streamId, `[prefetch] URL refresh failed (${e.message?.slice(0, 120)})`);
                  }
                }, intervalMs);

                const runningProc = activeStreams.get(streamId);
                if (runningProc) runningProc.prefetchTimer = timer;
              };

              // First refresh at 8 minutes; subsequent ones happen via hardKillAndRestart
              // (which calls cleanupStreamProc → clears timer, then startStream sets a new one)
              schedulePrefetch(8 * 60 * 1000);
            }

            // ── Proactive session refresh for TikTok/xSpace (24/7) ──────────
            // streamlink/yt-dlp sessions for TikTok and X Spaces expire after
            // ~3 hours.  Rather than waiting for a stall, restart proactively
            // just before expiry with a fresh URL so viewers never see a gap.
            if (sourceType === "tiktok" || sourceType === "xspace") {
              const sessionTimer = setTimeout(() => {
                const currentProc = activeStreams.get(streamId);
                if (!currentProc || currentProc.ffmpegProcess !== ffmpegProc) return;
                if (manuallyStopped.has(streamId)) return;
                sendLog(streamId, `[24/7] Session refresh — restarting with fresh source URL for uninterrupted streaming...`);
                urlCache.delete(streamId);
                hardKillAndRestart(streamId, 500, true /* forceNewUrl */);
              }, SESSION_REFRESH_MS);
              const proc24 = activeStreams.get(streamId);
              if (proc24) proc24.sessionRefreshTimer = sessionTimer;
            }

            const camUrl = cameraLinks.get(streamId);
            if (camUrl) broadcastStream(streamId, "camera_link", { url: camUrl });

            stallWatchdog = makeStallWatchdog(
              streamId,
              () => lastFrameCount,
              () => {
                sendLog(streamId, `[watchdog] No new frames detected — reconnecting to recover...`);
                urlCache.delete(streamId);
                const proc = activeStreams.get(streamId);
                if (proc?.ffmpegProcess === ffmpegProc) hardKillAndRestart(streamId, 1000);
              },
            );
            if (liveProc) liveProc.stallWatchdog = stallWatchdog;
            startHealthMonitor();
          }

          const now = Date.now();
          if (now - lastProgressLog > 30000) {
            lastProgressLog = now;
            const sizeMatch = trimmed.match(/size=\s*(\S+)/);
            const timeMatch = trimmed.match(/time=\s*(\S+)/);
            if (frameMatch) {
              sendLog(
                streamId,
                `Progress: ${frameMatch[1]} frames | ${sizeMatch ? sizeMatch[1] : ""} | ${timeMatch ? timeMatch[1] : ""}`,
              );
            }
          }
          return;
        }

        if (
          trimmed.includes("HTTP error 404") ||
          trimmed.includes("HTTP error 403") ||
          trimmed.includes("404 Not Found") ||
          trimmed.includes("403 Forbidden")
        ) {
          // For YouTube: 403/404 means the CDN URL expired or was rejected.
          // With the tv_embedded client the HLS URL has no rqh= token, so the
          // CDN doesn't require cookies — this only fires on genuine URL expiry.
          // Always refresh the URL and restart; never permanently kill the stream.
          urlCache.delete(streamId);
          {
            const proc = activeStreams.get(streamId);
            if (proc && !proc.urlExpired) {
              proc.urlExpired = true;
              sendLog(streamId, `[youtube] CDN URL expired (${trimmed.includes("404") ? "404" : "403"}) — fetching fresh URL and reconnecting...`);
              if (proc.ffmpegProcess === ffmpegProc) hardKillAndRestart(streamId, 300, true);
            }
          }
          return;
        }

        if (trimmed.includes("HTTP error 429") || trimmed.includes("429 Too Many Requests")) {
          urlCache.delete(streamId);
          {
            const proc = activeStreams.get(streamId);
            if (proc && !proc.urlExpired) {
              proc.urlExpired = true;
              sendLog(streamId, `[youtube] Rate-limited (429) — backing off 15s then reconnecting with fresh URL...`);
              sendLog(streamId, `[tip] Try switching to a different YouTube source (channel page vs watch URL) to reduce rate-limiting.`);
              if (proc.ffmpegProcess === ffmpegProc) hardKillAndRestart(streamId, 15_000, true);
            }
          }
          return;
        }

        if (trimmed.includes("Too many failure for output")) {
          sendLog(streamId, `[ffmpeg] RTMP output permanently dropped — reconnecting in 2s...`);
          {
            const proc = activeStreams.get(streamId);
            if (proc?.ffmpegProcess === ffmpegProc) hardKillAndRestart(streamId, 2000);
          }
          return;
        }

        if (
          trimmed.includes("Ignoring failure for output") ||
          trimmed.includes("RTMP_SendPacket") ||
          trimmed.includes("Error writing trailer") ||
          trimmed.includes("Broken pipe")
        ) {
          // An RTMP output has failed. Without onfail=ignore the tee muxer will
          // propagate the error and FFmpeg exits (handled by handleProcessExit).
          // With onfail=ignore the output is permanently dropped — it will never
          // reconnect, causing YouTube "not receiving data" warnings indefinitely.
          // Instead: trigger a clean restart so the full RTMP session is re-established.
          scorerRecordRtmpError(streamId);
          const proc = activeStreams.get(streamId);
          if (proc?.ffmpegProcess === ffmpegProc) {
            sendLog(streamId, `[ffmpeg] RTMP output failed — reconnecting in 2s...`);
            hardKillAndRestart(streamId, 2000);
          }
          return;
        }

        if (
          trimmed.includes("Connection timed out") ||
          trimmed.includes("Operation timed out")
        ) {
          sendLog(streamId, `[ffmpeg] RTMP connection timed out — reconnecting in 3s...`);
          {
            const proc = activeStreams.get(streamId);
            if (proc?.ffmpegProcess === ffmpegProc) hardKillAndRestart(streamId, 3000);
          }
          return;
        }

        if (
          trimmed.includes("Last message repeated") ||
          trimmed.includes("moov atom not found") ||
          // HLS segment-boundary reconnect — FFmpeg fetches the next segment
          // immediately ("in 0 second(s)") and streaming continues uninterrupted.
          // This is normal live-HLS behaviour, not an error.
          trimmed.includes("Will reconnect at") ||
          // Verbose HTTP/HLS operational messages — not actionable for the user
          trimmed.includes("Opening an input url") ||
          trimmed.includes("Opening an output url") ||
          trimmed.includes("Input stream #0") ||
          trimmed.includes("Starting new cluster") ||
          trimmed.includes("No trailing") ||
          trimmed === ""
        ) return;

        // Log FFmpeg warnings/errors to pino so they appear in workflow logs
        logger.warn({ streamId, ffmpeg: trimmed }, "FFmpeg stderr");
        sendLog(streamId, `[ffmpeg] ${trimmed}`);
      });
    });

    ffmpegProc.stdout?.on("data", () => {});

    ffmpegProc.on("error", (err) => {
      if (stallWatchdog) clearInterval(stallWatchdog);
      if (healthMonitor) { clearInterval(healthMonitor); healthMonitor = null; }
      bgRenderer.stop();
      uiRenderer.stop();
      micPipe.stop();
      activeMicPipes.delete(micPipe);
      browserCameraPipes.delete(streamId);
      if (err.message.includes("ENOENT")) {
        sendLog(streamId, `ERROR: ffmpeg not found. Install ffmpeg on your system.`);
      } else {
        sendLog(streamId, `FFmpeg error: ${err.message}`);
      }
      sendStatus(streamId, "error");
      activeStreams.delete(streamId);
    });

    ffmpegProc.on("exit", (code, signal) => {
      if (stallWatchdog) clearInterval(stallWatchdog);
      if (healthMonitor) { clearInterval(healthMonitor); healthMonitor = null; }
      bgRenderer.stop();
      uiRenderer.stop();
      micPipe.stop();
      activeMicPipes.delete(micPipe);
      browserCameraPipes.delete(streamId);
      sendLog(streamId, `FFmpeg exited (code: ${code}, signal: ${signal})`);
      const currentProc = activeStreams.get(streamId);
      if (currentProc?.ffmpegProcess !== ffmpegProc) return;
      handleProcessExit(streamId, code);
    });

    // Startup watchdog: if no frames arrive within the timeout, mark the stream as
    // error so the user knows it failed to start — no auto-restart.
    const startupTimeout = inputUrl === "__browser__" ? 90000 : 60000;
    const watchdog = setTimeout(() => {
      if (!gotFrames) {
        sendLog(streamId, `Timeout: No frames encoded after ${startupTimeout / 1000}s — retrying with fresh URL...`);
        const liveProc = activeStreams.get(streamId);
        if (liveProc?.ffmpegProcess === ffmpegProc) {
          hardKillAndRestart(streamId, 5000, true /* forceNewUrl */);
        }
      }
    }, startupTimeout);

    const statsInterval = ffmpegProc.pid
      ? startProcStatsPolling(streamId, ffmpegProc.pid)
      : undefined;

    activeStreams.set(streamId, {
      ffmpegProcess: ffmpegProc,
      bgRenderer,
      uiRenderer,
      micPipe,
      volumePipe,
      muted: stream.muted,
      autoRestart: stream.autoRestart,
      watchdog,
      statsInterval,
      // prefetchTimer is set later inside the gotFrames block (after ffmpegProc is running)
      ytSourceProcess: undefined,
      inputUrl,
      sourceType,
    });

    logger.info({ streamId }, `Stream started`);
  } catch (err: any) {
    const code: string | undefined = err.code;
    const msg: string = err.message || "Unknown error";

    // ── Failure classification ─────────────────────────────────────────────
    // Definitive failures: source is genuinely offline or inaccessible.
    // Do NOT auto-restart — retrying immediately is pointless and burns rate-limit quota.
    const isDefinitive = code && new Set([
      "NOT_LIVE", "LIVE_ENDED", "PRIVATE_ACCOUNT", "PRIVATE_VIDEO",
      "REGION_RESTRICTED", "GEO_RESTRICTED", "AGE_RESTRICTED",
      "MEMBERS_ONLY", "SCHEDULED", "UNAVAILABLE",
    ]).has(code);

    if (isDefinitive) {
      sendLog(streamId, `[resolve] ${msg}`);
      sendLog(streamId, `[resolve] Stopping auto-restart — source is definitively unavailable (${code})`);
      manuallyStopped.add(streamId); // block all further auto-restart paths
      sendStatus(streamId, "error");
      return;
    }

    // Rate-limited: apply an extra backoff bump so we back off aggressively
    // before the retry timer fires.  The backoff already in restartBackoff applies
    // but we add an extra bump here so RATE_LIMITED → longer pause than a plain crash.
    if (code === "RATE_LIMITED") {
      sendLog(streamId, `[resolve] ${msg}`);
      sendLog(streamId, `[resolve] Rate-limited — applying extended backoff before retry`);
      bumpBackoff(streamId); // extra bump on top of the one in handleProcessExit
      sendStatus(streamId, "error");
      return;
    }

    // Circuit breaker open: don't log the full error, just report the suspension
    if (msg.includes("[circuit-breaker]")) {
      sendLog(streamId, msg);
      sendStatus(streamId, "error");
      return;
    }

    // Generic transient failure
    sendLog(streamId, `Failed: ${msg}`);
    sendStatus(streamId, "error");
  }
}

// ── Immediate hard-kill + scheduled restart ───────────────────────────────────
// forceNewUrl=true  — bypass the URL cache (use when ending a break video so
//                     TikTok/YouTube live URLs are re-fetched).
// keepStatus=true   — do NOT emit "reconnecting"; UI stays as "streaming"
//                     (used for seamless mute/unmute where the gap is ~100 ms
//                      and is invisible to the viewer behind platform buffers).
function hardKillAndRestart(streamId: string, _delayMs: number, forceNewUrl = false, keepStatus = false) {
  const proc = activeStreams.get(streamId);
  if (!proc) return;
  // ── Guard: only one restart timer per stream at a time ───────────────────
  // This must be the FIRST guard check.  Everything after this point runs
  // at most once per stream — no concurrent entry from health-recovery.
  if (restartScheduled.has(streamId)) return;

  // Track reconnect counter on the proc so it persists into the new proc
  proc.reconnectCount = (proc.reconnectCount ?? 0) + 1;

  // ── CRITICAL ORDER ────────────────────────────────────────────────────────
  // 1. Disable auto-restart flag on the proc to prevent re-entry via health-recovery
  // 2. Delete from activeStreams so health-recovery bails at its own guard
  // 3. Set restartScheduled so any late-firing timers bail
  // 4. THEN call scorerRecordReconnect — it triggers recompute() synchronously
  //    which calls the health-recovery callback; both activeStreams and
  //    restartScheduled guards will be in place by that point.
  // This ordering was the root cause of the duplicate-restart death spiral:
  // the old code called scorerRecordReconnect BEFORE activeStreams.delete and
  // restartScheduled.add, allowing health-recovery to re-enter here and
  // schedule a second restart timer concurrently.
  proc.autoRestart = false;
  activeStreams.delete(streamId);    // guard #1: health-recovery bails on !has
  markSourceFailed(streamId);

  // Exponential backoff — grows with each consecutive failure, resets on first frame
  const delay = getBackoffDelay(streamId);
  bumpBackoff(streamId);
  restartScheduled.add(streamId);    // guard #2: any concurrent path bails on has

  // NOW safe to call — recompute() fires here but both guards are already set
  scorerRecordReconnect(streamId);

  cleanupStreamProc(streamId, proc);
  try { proc.ffmpegProcess?.kill("SIGKILL"); } catch {}
  if (!keepStatus) sendStatus(streamId, "reconnecting");

  if (delay > 5_000) sendLog(streamId, `Backing off — retrying in ${delay / 1000}s...`);

  setTimeout(() => {
    restartScheduled.delete(streamId);
    if (manuallyStopped.has(streamId)) return;
    if (storage.getStream(streamId)) {
      startStream(streamId, !forceNewUrl /* reuseUrl */, keepStatus).catch((e: any) => {
        sendLog(streamId, `Restart failed: ${e.message}`);
        sendStatus(streamId, "error");
      });
    }
  }, delay);
}

function handleProcessExit(streamId: string, code: number | null) {
  const proc = activeStreams.get(streamId);
  if (!proc) return;

  // ── Delete from activeStreams FIRST ───────────────────────────────────────
  // cleanupStreamProc calls scorerSetFFmpegAlive(false) which synchronously
  // triggers recompute() → health-recovery callback.  That callback checks
  // activeStreams.has(streamId) before scheduling a restart.  By deleting here
  // first we guarantee the health-recovery path bails out, leaving this
  // function as the sole owner of the restart decision — no duplicate timers.
  activeStreams.delete(streamId);
  cleanupStreamProc(streamId, proc);
  try { proc.ffmpegProcess?.kill("SIGKILL"); } catch {}

  const reason = code !== null ? `exit code ${code}` : "signal";

  if (manuallyStopped.has(streamId)) {
    clearCameraLink(streamId);
    sendStatus(streamId, "idle");
    return;
  }

  // If a restart is already scheduled (e.g. hardKillAndRestart from the watchdog
  // fired a moment before FFmpeg exited), don't double-schedule.
  if (restartScheduled.has(streamId)) return;

  if (storage.getStream(streamId)) {
    scorerRecordReconnect(streamId);
    markSourceFailed(streamId);

    const delay = getBackoffDelay(streamId);
    bumpBackoff(streamId);
    restartScheduled.add(streamId);

    sendLog(streamId, `[ffmpeg] Stream cut (${reason}) — reconnecting in ${delay / 1000}s...`);
    sendStatus(streamId, "reconnecting");

    setTimeout(() => {
      restartScheduled.delete(streamId);
      if (manuallyStopped.has(streamId)) return;
      if (storage.getStream(streamId)) {
        startStream(streamId).catch((e: any) => {
          sendLog(streamId, `[ffmpeg] Reconnect failed: ${e.message}`);
          sendStatus(streamId, "error");
        });
      }
    }, delay);
  } else {
    clearCameraLink(streamId);
    sendLog(streamId, `[ffmpeg] Process ended (${reason}).`);
    sendStatus(streamId, "error");
  }
}

export function stopStream(streamId: string) {
  const proc = activeStreams.get(streamId);
  if (!proc) return;

  sendLog(streamId, "Stopping stream...");
  proc.autoRestart = false;
  // Mark as manually stopped BEFORE any async/timer operations so that any
  // pending hardKillAndRestart or handleProcessExit timers see the flag and
  // abort — this is what prevents YouTube from staying in "preparing stream"
  // after the user clicks Stop.
  manuallyStopped.add(streamId);
  clearCameraLink(streamId);
  cleanupStreamProc(streamId, proc);
  scorerRemoveStream(streamId);
  // Remove from activeStreams NOW so handleProcessExit doesn't fire when FFmpeg
  // finally exits — we don't want it to re-broadcast "deleted" or try to auto-restart.
  activeStreams.delete(streamId);
  // Clean up all per-stream restart/circuit-breaker state so a re-added stream starts fresh
  resolverCBs.delete(streamId);
  restartScheduled.delete(streamId);
  restartBackoff.delete(streamId);

  // SIGKILL immediately — no graceful drain.
  // SIGTERM causes FFmpeg to flush its encoder buffer and send RTMP finalization
  // packets before exiting, meaning data keeps flowing to YouTube for up to ~2 s.
  // SIGKILL stops the process (and all I/O) at the OS level instantly.
  try { proc.ffmpegProcess?.kill("SIGKILL"); } catch {}

  activeStreams.delete(streamId);
  sendStatus(streamId, "idle");
  broadcastStream(streamId, "chat_clear", {});
  sendLog(streamId, "Stream stopped");
  streamLogBuffers.delete(streamId);
  logger.info({ streamId }, `Stream stopped`);

  // Purge uploaded/downloaded break-video files when the last stream stops
  if (activeStreams.size === 0) {
    purgeUploadsDir();
    clearYtDownloadCache();
  }
}

export function restartStream(streamId: string) {
  sendLog(streamId, "Restarting stream (manual)...");
  // Clear the manual-stop guard so the restart is never blocked by a previous Stop.
  manuallyStopped.delete(streamId);
  // hardKillAndRestart handles: cleanup → SIGKILL → "reconnecting" status →
  // delayed startStream with cached URL.  This avoids the old stopStream() path
  // which left the proc in activeStreams, causing handleProcessExit to delete
  // the stream from storage before startStream could run again.
  hardKillAndRestart(streamId, 800, false);
}

export function toggleMute(streamId: string, muted: boolean) {
  storage.updateStream(streamId, { muted });
  const proc = activeStreams.get(streamId);
  if (!proc?.ffmpegProcess) {
    sendLog(streamId, muted ? "Audio muted (takes effect on next start)" : "Audio unmuted (takes effect on next start)");
    return;
  }
  if (proc.volumePipe) {
    // Zero-restart mute — VolumeControlPipe on pipe:6 changes gain in-place.
    // No FFmpeg reconnection, no stream interruption, no platform buffer gap.
    const gain = computeGain(muted, currentOverlayState.liveAudioMuted, globalStreamVolume);
    proc.volumePipe.setGain(gain);
    sendLog(streamId, muted ? "Audio muted (live — no stream interruption)" : "Audio unmuted (live — no stream interruption)");
  } else {
    sendLog(streamId, muted ? "Audio muted (takes effect on next start)" : "Audio unmuted (takes effect on next start)");
  }
}

export function isStreamActive(streamId: string): boolean {
  return activeStreams.has(streamId);
}

// ── Recovery snapshot ─────────────────────────────────────────────────────────
// Returns a complete read-only view of the circuit-breaker, backoff, and
// restart-lock state for a single stream.  Used by the /recovery-status route.

export interface RecoverySnapshot {
  streamId: string;
  timestamp: number;
  circuitBreaker: {
    state: "closed" | "open" | "probing";
    failuresInWindow: number;
    failureThreshold: number;
    windowMs: number;
    openedAt: number | null;
    cooldownMs: number;
    cooldownRemainingMs: number | null;
    probeInFlight: boolean;
  };
  backoff: {
    attemptCount: number;
    nextDelayMs: number;
    schedule: number[];
    maxDelayMs: number;
  };
  restartPending: boolean;
  manuallyStopped: boolean;
  isActive: boolean;
}

export function getRecoverySnapshot(streamId: string): RecoverySnapshot {
  const now = Date.now();
  const cb = resolverCBs.get(streamId) ?? { failures: [], openedAt: null, probeInFlight: false };
  const failuresInWindow = cb.failures.filter((t) => now - t < CB_WINDOW_MS).length;
  const cooldownRemainingMs = cb.openedAt != null
    ? Math.max(0, CB_OPEN_COOLDOWN_MS - (now - cb.openedAt))
    : null;
  const cbState: RecoverySnapshot["circuitBreaker"]["state"] =
    cb.openedAt == null ? "closed"
    : cb.probeInFlight ? "probing"
    : "open";

  const attemptCount = restartBackoff.get(streamId) ?? 0;
  const nextDelayMs = BACKOFF_DELAYS_MS[Math.min(attemptCount, BACKOFF_DELAYS_MS.length - 1)];

  return {
    streamId,
    timestamp: now,
    circuitBreaker: {
      state: cbState,
      failuresInWindow,
      failureThreshold: CB_FAILURE_THRESHOLD,
      windowMs: CB_WINDOW_MS,
      openedAt: cb.openedAt,
      cooldownMs: CB_OPEN_COOLDOWN_MS,
      cooldownRemainingMs,
      probeInFlight: cb.probeInFlight,
    },
    backoff: {
      attemptCount,
      nextDelayMs,
      schedule: BACKOFF_DELAYS_MS,
      maxDelayMs: BACKOFF_DELAYS_MS[BACKOFF_DELAYS_MS.length - 1],
    },
    restartPending: restartScheduled.has(streamId),
    manuallyStopped: manuallyStopped.has(streamId),
    isActive: activeStreams.has(streamId),
  };
}

// ── Control-plane initialisation ──────────────────────────────────────────────
// Call once from the HTTP server init (registerBintunetRoutes) after all
// functions are defined.  Sets up health-scorer callbacks and failover restart.
export function initStreamManager(): void {
  initHealthScorer(
    // Recovery callback — score < 50
    (streamId, score) => {
      if (manuallyStopped.has(streamId)) return;
      if (!activeStreams.has(streamId)) return;   // handleProcessExit already owns it
      if (restartScheduled.has(streamId)) return; // restart already pending

      const stream = storage.getStream(streamId);
      if (!stream) return;

      // Honour the user's auto-restart preference
      if (!stream.autoRestart) {
        sendLog(streamId, `[health] Score ${score}/100 — stream degraded (auto-restart is off; stop and restart manually)`);
        broadcastStream(streamId, "stream_health", { status: "degraded", score,
          message: `Health score ${score}/100 — auto-restart disabled` });
        return;
      }

      sendLog(streamId, `[health] Score ${score}/100 → pipeline recovery triggered`);
      broadcastStream(streamId, "stream_health", {
        status: "recovery",
        score,
        message: `Health score ${score}/100 — restarting pipeline`,
      });
      // Try source failover first; if no chain configured, do a plain restart
      const didFailover = failoverTrigger(streamId, `health score ${score}/100`);
      if (!didFailover) {
        hardKillAndRestart(streamId, 2000, true /* forceNewUrl */);
      }
    },
    // Warning callback — score 50-80
    (streamId, score, snap) => {
      broadcastStream(streamId, "stream_health", {
        status: "degraded",
        score,
        silentSeconds: 0,
        message: `Stream health warning: ${score}/100 — ${snap.status}`,
      });
    },
  );

  initFailover((streamId) => {
    if (manuallyStopped.has(streamId)) return;
    sendLog(streamId, "[failover] Source switched — restarting pipeline");
    hardKillAndRestart(streamId, 1000, true /* forceNewUrl */);
  });

  logger.info("[stream-manager] Health scorer and failover initialised");
}
