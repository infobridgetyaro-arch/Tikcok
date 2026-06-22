import { ChildProcess, spawn, exec } from "child_process";
import { storage } from "./storage";
import { logger } from "./lib/logger";
import { getTikTokStreamUrl } from "./tiktok-extractor";
import { getYouTubeStreamUrl, getYouTubeVideoDirectUrl, downloadYouTubeVideoToTemp, clearYtDownloadCache, normaliseYouTubeUrl, getYouTubeFFmpegCookieHeader, getCookiesConfigured } from "./youtube-source";
import type { WebSocket } from "ws";
import type { StreamConfig } from "./schema";
import { OverlayRenderer, defaultOverlayState, type OverlayState } from "./overlay-renderer";
import path from "path";
import fs from "fs";
import { startHlsEncoder, stopHlsEncoder } from "./hls-encoder";

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
      // Download is too slow for background preload — mark as error (fallback to download on Go Live)
      const msg = e?.message?.includes("cookies") ? e.message : "Requires download — will start on Go Live (1–2 min first time)";
      breakVideoPreloadCache.set(url, { status: "error", error: msg, startedAt: Date.now() });
      logger.warn(`Break preload: ${msg}`);
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
  prefetchTimer?: NodeJS.Timeout; // fires before URL expires — pre-fetches a fresh URL, then seamlessly restarts
  ytSourceProcess?: ChildProcess; // streamlink process piped to FFmpeg stdin for YouTube source
  inputUrl?: string;
  sourceType?: string;
  urlExpired?: boolean;
  lastFrameCount?: number;        // most-recent frame count from FFmpeg -stats output
  streamStartTime?: number;       // unix ms when stream reached "streaming" status
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
  const prevLiveAudioMuted = currentOverlayState.liveAudioMuted;

  currentOverlayState = { ...currentOverlayState, ...patch };

  const nowBreakActive = currentOverlayState.breakActive;
  const nowBreakVideoUrl = currentOverlayState.breakVideoUrl ?? "";
  const nowBreakVideoPanX = currentOverlayState.breakVideoPanX ?? 50;
  const nowBreakVideoPanY = currentOverlayState.breakVideoPanY ?? 50;

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

  const needsDecoderStart =
    (breakJustStarted && !!nowBreakVideoUrl) ||
    (urlChanged && !!nowBreakVideoUrl) ||
    panChanged;

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
  let bitrate = "1200k";
  let maxrate = "1500k";
  let bufsize = "1200k";

  if (stream.quality === "best") {
    bitrate = "1500k"; maxrate = "1800k"; bufsize = "1500k";
  } else if (stream.quality === "720p") {
    bitrate = "1200k"; maxrate = "1500k"; bufsize = "1200k";
  } else {
    bitrate = "800k"; maxrate = "1000k"; bufsize = "800k";
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
    // HLS URL resolved by yt-dlp (googlevideo.com CDN) — FFmpeg reads directly.
    // YouTube CDN requires a Proof-of-Origin Token (rqh/1) for segment access.
    // Without browser cookies (uploaded via Settings → YouTube Cookies), all
    // segment requests will return 403 regardless of User-Agent or IP address.
    // When cookies ARE provided, yt-dlp embeds a valid POT in the URL parameters
    // and the cookie header is forwarded to the CDN for manifest/playlist requests.
    const cookieHeader = getYouTubeFFmpegCookieHeader();
    const ytHeaderLines = [
      "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/94.0.4606.81 Safari/537.36",
      "Accept: */*",
      "Accept-Language: en-US,en;q=0.9",
      "Referer: https://www.youtube.com/",
      ...(cookieHeader ? [cookieHeader.trimEnd()] : []),
    ];
    args.push(
      "-headers", ytHeaderLines.join("\r\n") + "\r\n",
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_on_network_error", "1",
      "-reconnect_delay_max", "5",
      "-tls_verify", "0",
      "-rw_timeout", "10000000",
      "-thread_queue_size", "4096",
      "-fflags", "+genpts+discardcorrupt",
      "-i", inputUrl,
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
    // TikTok HLS
    args.push(
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_on_network_error", "1",
      "-reconnect_at_eof", "1",
      "-reconnect_delay_max", "5",
      "-rw_timeout", "10000000",
      "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "-referer", "https://www.tiktok.com/",
      "-thread_queue_size", "4096",
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

  args.push(
    "-threads", "2",
    "-max_muxing_queue_size", "1024",
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
      `[_rawA]aresample=async=1000[_audio]`,
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
      `[_rawA]aresample=async=1000[_audio]`,
    ].join(";");
  }

  let filterGraph: string;

  if (isXSpace) {
    // X Space is audio-only — no [0:v] exists. Build video from gradient/black only.
    filterGraph = [
      `[3:v]format=rgba,scale=${scaleW}:${scaleH}[_bg]`,
      `[1:v][_bg]overlay=0:0:format=auto[_base]`,
      `[4:v]scale=${scaleW}:${scaleH}[_ui]`,
      `[_base][_ui]overlay=0:0:format=auto:eof_action=repeat,format=yuv420p[_final]`,
      audioFilter,
    ].join(";");
  } else {
    // Scale video to fill the full output frame (cover mode), cropping any
    // overflow so there are never black bars on any side.
    // force_original_aspect_ratio=increase scales up until the video meets
    // or exceeds both dimensions, then crop trims to the exact target size,
    // centering the frame.  This is equivalent to CSS object-fit:cover.
    // yuva420p keeps the video in YUV colour space (avoids the swscaler
    // "deprecated pixel format / range" warning that rgba triggers on YUV sources).
    const videoSrcFilter = [
      `[0:v]scale=${scaleW}:${scaleH}:force_original_aspect_ratio=increase`,
      `crop=${scaleW}:${scaleH}`,
      `setsar=1`,
      `format=yuva420p[_src]`,
    ].join(",");

    filterGraph = [
      videoSrcFilter,
      // Gradient pipe — sits behind the video as a solid background.
      `[3:v]format=rgba,scale=${scaleW}:${scaleH}[_bg]`,
      // Black base + gradient on top → [_base]
      `[1:v][_bg]overlay=0:0:format=auto[_base]`,
      // Video (full-frame RGBA, transparent bars) over gradient.
      // Transparent bars let the gradient colour show through;
      // opaque video pixels cover the gradient only where the video is.
      // eof_action=repeat: freeze last video frame when source drops (instead of
      // black) — keeps the stream looking alive during brief reconnect gaps.
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
    "-bf", "2",
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
    "-b:a", "128k",
    "-ar", "44100",
    "-ac", "2",
  );

  // ── RTMP output(s) — always tee for resilience ───────────────────────────
  const teeOutputs = outputs
    .map((o) => `[f=flv:flvflags=no_duration_filesize:rtmp_live=1:rw_timeout=5000000:onfail=ignore]${o}`)
    .join("|");
  args.push("-f", "tee", teeOutputs);

  return args;
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
    const input = stream.youtubeSourceUrl || "";
    if (!input) throw new Error("YouTube username/URL is required");
    // Resolve the live HLS URL via yt-dlp (3-tier fallback: streamlink → yt-dlp mweb → ios).
    // Cache the result for 10 min — YouTube CDN URLs are valid ~6 hours; the 404
    // handler in the FFmpeg stderr loop will force a fresh fetch if it expires early.
    const hlsUrl = await getYouTubeStreamUrl(normaliseYouTubeUrl(input));
    urlCache.set(stream.id, { url: hlsUrl, sourceType: "youtube", resolvedAt: Date.now() });
    return { url: hlsUrl, sourceType: "youtube" };
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
  const url = await getTikTokStreamUrl(stream.tiktokUsername, stream.quality || "best");
  urlCache.set(stream.id, { url, sourceType, resolvedAt: Date.now() });
  return { url, sourceType: "tiktok" };
}

async function getXSpaceAudioUrl(spaceUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ytdlp = spawn("yt-dlp", [
      "-g",
      "--no-playlist",
      "-f", "bestaudio",
      "--no-warnings",
      spaceUrl,
    ]);
    let stdout = "";
    let stderr = "";
    ytdlp.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    ytdlp.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    ytdlp.on("close", (code) => {
      const url = stdout.trim().split("\n")[0]?.trim();
      if (code === 0 && url) {
        resolve(url);
      } else {
        reject(new Error(`yt-dlp failed to extract X Space audio (code ${code}): ${stderr.slice(0, 400)}`));
      }
    });
    ytdlp.on("error", (err) => reject(new Error(`yt-dlp not found: ${err.message}`)));
  });
}

// ── Frame-stall watchdog ──────────────────────────────────────────────────────
// 15 s: fast enough to catch a dead TikTok source before the YouTube platform
// buffer drains (~20-30 s), while loose enough to survive brief HLS segment gaps.
const STALL_TIMEOUT_MS = 15_000;

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
      if (err) return; // process gone — interval will be cleared in cleanupStreamProc
      const parts = stdout.trim().split(/\s+/);
      if (parts.length < 2) return;
      const cpu = parseFloat(parts[0]);
      const mem = Math.round(parseInt(parts[1], 10) / 1024); // KB → MB
      if (!isNaN(cpu) && !isNaN(mem)) {
        const proc = activeStreams.get(streamId);
        const frames = proc?.lastFrameCount ?? 0;
        const uptime = proc?.streamStartTime ? Math.floor((Date.now() - proc.streamStartTime) / 1000) : 0;
        broadcastStream(streamId, "proc_stats", { cpu, mem, frames, uptime });
      }
    });
  }, 3000);
}

function cleanupStreamProc(streamId: string, proc: StreamProcess) {
  if (proc.watchdog) clearTimeout(proc.watchdog);
  if (proc.stallWatchdog) clearInterval(proc.stallWatchdog);
  if (proc.statsInterval) clearInterval(proc.statsInterval);
  if (proc.prefetchTimer) clearTimeout(proc.prefetchTimer);
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
}


export async function startStream(streamId: string, reuseUrl = false, keepStatus = false) {
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
  if (!stream.youtubeStreamKey && !stream.facebookRtmpUrl && !stream.tiktokStreamKey)
    throw new Error("At least one output (YouTube, Facebook, or TikTok) is required");

  stopStream(streamId);

  sendLog(streamId, `--- Starting stream ---`);
  sendLog(streamId, `Quality: ${stream.quality} | FPS: ${stream.fps} | Layout: ${stream.ratio}`);
  sendLog(streamId, `Audio: ${stream.muted ? "Muted" : "On"} | Auto-restart: ${stream.autoRestart ? "On" : "Off"}`);
  sendLog(streamId, `Overlay: burn-in enabled (canvas → FFmpeg pipe)`);
  if (!keepStatus) sendStatus(streamId, "reconnecting");

  try {
    if (sourceType === "tiktok") {
      sendLog(streamId, `Fetching TikTok live stream for @${stream.tiktokUsername}...`);
    } else if (sourceType === "youtube") {
      sendLog(streamId, `Resolving YouTube live URL: ${stream.youtubeSourceUrl}...`);
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

    const { url: inputUrl, sourceType: resolvedType } = await resolveInputUrl(stream, !reuseUrl);

    // Guard: user may have clicked Stop while we were waiting for URL resolution
    // (TikTok/YouTube extraction can take 20–35 s). If the stream was deleted from
    // storage in the meantime, abort — otherwise FFmpeg would spawn as an orphan.
    if (!storage.getStream(streamId)) {
      sendLog(streamId, "Stream was stopped during URL resolution — aborting.");
      return;
    }

    if (sourceType === "tiktok") {
      const inputType = inputUrl.includes(".m3u8") ? "HLS" : "FLV";
      sendLog(streamId, `Using ${inputType} stream input`);
    } else if (sourceType === "youtube") {
      sendLog(streamId, `YouTube HLS URL resolved — starting FFmpeg...`);
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

    // YouTube source uses a direct HLS URL (resolved by yt-dlp before FFmpeg starts).
    // No subprocess needed — FFmpeg reads the HLS playlist directly via HTTP.
    const ytSourceProcess: ChildProcess | undefined = undefined;

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

    let gotFrames = false;
    let lastProgressLog = 0;
    let lastFrameCount = 0;
    let stallWatchdog: NodeJS.Timeout | null = null;

    ffmpegProc.stderr?.on("data", (errData: Buffer) => {
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

          if (!gotFrames) {
            gotFrames = true;
            logger.info({ streamId }, "FFmpeg producing frames — stream is live");
            sendLog(streamId, `Streaming! Encoding and forwarding frames...`);
            sendStatus(streamId, "streaming");

            const liveProc = activeStreams.get(streamId);
            if (liveProc) liveProc.streamStartTime = Date.now();

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
            // YouTube uses streamlink pipe — streamlink manages URL rotation
            // internally, so no FFmpeg restart is needed. Only TikTok needs
            // the proactive pre-fetch (its HLS URLs expire after ~10-15 min).
            if (sourceType !== "camera" && sourceType !== "youtube" && sourceType !== "upload") {
              const schedulePrefetch = (intervalMs: number) => {
                const timer = setTimeout(async () => {
                  const currentProc = activeStreams.get(streamId);
                  if (!currentProc || currentProc.ffmpegProcess !== ffmpegProc) return;

                  sendLog(streamId, `[prefetch] Pre-fetching fresh source URL for 24/7 continuity...`);
                  try {
                    // Force a fresh resolution — bypasses any stale cache entry
                    urlCache.delete(streamId);
                    const resolved = await resolveInputUrl(stream, false);
                    urlCache.set(streamId, {
                      url: resolved.url,
                      sourceType: resolved.sourceType as "tiktok" | "youtube" | "camera",
                      resolvedAt: Date.now(),
                    });
                    sendLog(streamId, `[prefetch] Fresh URL ready — performing seamless source refresh...`);

                    const stillRunning = activeStreams.get(streamId);
                    if (stillRunning?.ffmpegProcess === ffmpegProc) {
                      // keepStatus=true: UI stays "streaming" — no flash of "reconnecting"
                      hardKillAndRestart(streamId, 300, false /* use cached URL */, true /* keepStatus */);
                    }
                  } catch (e: any) {
                    sendLog(streamId, `[prefetch] URL refresh failed (${e.message?.slice(0, 120)}) — will retry in 4 min`);
                    // Retry sooner on failure so we don't hit an expired URL cold
                    const retryProc = activeStreams.get(streamId);
                    if (retryProc?.ffmpegProcess === ffmpegProc) {
                      retryProc.prefetchTimer = undefined;
                      schedulePrefetch(4 * 60 * 1000);
                    }
                  }
                }, intervalMs);

                const runningProc = activeStreams.get(streamId);
                if (runningProc) runningProc.prefetchTimer = timer;
              };

              // First refresh at 8 minutes; subsequent ones happen via hardKillAndRestart
              // (which calls cleanupStreamProc → clears timer, then startStream sets a new one)
              schedulePrefetch(8 * 60 * 1000);
            }

            const camUrl = cameraLinks.get(streamId);
            if (camUrl) broadcastStream(streamId, "camera_link", { url: camUrl });

            stallWatchdog = makeStallWatchdog(
              streamId,
              () => lastFrameCount,
              () => {
                urlCache.delete(streamId);
                const proc = activeStreams.get(streamId);
                if (proc?.ffmpegProcess === ffmpegProc) {
                  hardKillAndRestart(streamId, 1000);
                }
              },
            );
            if (liveProc) liveProc.stallWatchdog = stallWatchdog;
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
          const proc = activeStreams.get(streamId);
          if (proc && !proc.urlExpired) {
            proc.urlExpired = true; // debounce — only once per FFmpeg instance
            sendLog(streamId, `[youtube] CDN URL expired (${trimmed.includes("404") ? "404" : "403"}) — fetching fresh URL and restarting…`);
            if (proc.ffmpegProcess === ffmpegProc) {
              hardKillAndRestart(streamId, 300, true /* forceNewUrl */);
            }
          }
          return;
        }

        if (trimmed.includes("HTTP error 429") || trimmed.includes("429 Too Many Requests")) {
          // YouTube CDN is rate-limiting segment requests.
          // Strategy: restart once with a fresh URL + 10 s backoff to let the
          // rate-limit window expire. With cookies.txt the 429 should not recur.
          const proc = activeStreams.get(streamId);
          if (proc && !proc.urlExpired) {
            proc.urlExpired = true; // debounce — only fire once per FFmpeg instance
            urlCache.delete(streamId);
            sendLog(streamId, `[youtube] Rate-limited (429) — backing off 10 s then fetching fresh URL...`);
            sendLog(streamId, `[tip] Upload cookies.txt in Settings → YouTube Cookies to prevent 429s.`);
            if (proc.ffmpegProcess === ffmpegProc) {
              hardKillAndRestart(streamId, 10_000, true /* forceNewUrl */);
            }
          }
          return;
        }

        if (trimmed.includes("Too many failure for output")) {
          // Permanent RTMP failure — tee muxer gave up on the output entirely.
          // FFmpeg keeps running but sends nothing to YouTube/Facebook → black stream.
          // Must restart to re-establish the RTMP connection.
          sendLog(streamId, `[ffmpeg] RTMP output permanently dropped — restarting to reconnect...`);
          const proc = activeStreams.get(streamId);
          if (proc?.ffmpegProcess === ffmpegProc) {
            hardKillAndRestart(streamId, 2000);
          }
          return;
        }

        if (
          trimmed.includes("Ignoring failure for output") ||
          trimmed.includes("RTMP_SendPacket") ||
          trimmed.includes("Error writing trailer") ||
          trimmed.includes("Broken pipe")
        ) {
          // onfail=ignore in the tee muxer handles transient RTMP errors.
          // Logging only — do NOT restart: a restart causes a real RTMP cut,
          // whereas onfail=ignore auto-recovers without breaking the stream.
          sendLog(streamId, `[ffmpeg] RTMP hiccup (auto-recovering via onfail=ignore)...`);
          return;
        }

        if (
          trimmed.includes("Connection timed out") ||
          trimmed.includes("Operation timed out")
        ) {
          // Persistent timeout — RTMP server is unreachable. Restart to reconnect.
          sendLog(streamId, `[ffmpeg] RTMP connection timed out — reconnecting...`);
          const proc = activeStreams.get(streamId);
          if (proc?.ffmpegProcess === ffmpegProc) {
            hardKillAndRestart(streamId, 3000);
          }
          return;
        }

        if (
          trimmed.includes("Last message repeated") ||
          trimmed.includes("moov atom not found") ||
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

    // Startup watchdog: no frames within N seconds → restart.
    // Uses hardKillAndRestart (not stopStream) so auto-restart is honoured — stopStream would
    // set autoRestart=false before exiting, permanently silencing a stream that just had a
    // slow startup (e.g. TikTok URL resolution + FFmpeg init on a busy server).
    //
    // Timeouts by source type:
    //   browser camera: 90s — guest WebSocket connection needs extra time to negotiate
    //   all others: 60s — URL is already resolved before FFmpeg starts (TikTok, YouTube HLS, RTSP).
    const startupTimeout = inputUrl === "__browser__" ? 90000 : 60000;
    const watchdog = setTimeout(() => {
      if (!gotFrames) {
        sendLog(streamId, `Timeout: No frames encoded after ${startupTimeout / 1000}s — restarting...`);
        const liveProc = activeStreams.get(streamId);
        if (liveProc?.ffmpegProcess === ffmpegProc) {
          // Force a fresh URL fetch: the source may have expired during the long wait.
          hardKillAndRestart(streamId, 1000, true /* forceNewUrl */);
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
      // ytSourceProcess is set below for YouTube source
      ytSourceProcess,
      inputUrl,
      sourceType,
    });

    logger.info({ streamId }, `Stream started`);
  } catch (err: any) {
    sendLog(streamId, `Failed: ${err.message}`);
    sendStatus(streamId, "error");

    if (stream.autoRestart) {
      sendLog(streamId, "Auto-restart enabled. Retrying in 15 seconds...");
      sendStatus(streamId, "reconnecting");
      setTimeout(() => {
        if (storage.getStream(streamId)) {
          startStream(streamId).catch((e: any) => {
            sendLog(streamId, `Auto-restart failed: ${e.message}`);
            sendStatus(streamId, "error");
          });
        }
      }, 15000);
    }
  }
}

// ── Immediate hard-kill + fast restart ───────────────────────────────────────
// forceNewUrl=true  — bypass the URL cache (use when ending a break video so
//                     TikTok/YouTube live URLs are re-fetched).
// keepStatus=true   — do NOT emit "reconnecting"; UI stays as "streaming"
//                     (used for seamless mute/unmute where the gap is ~100 ms
//                      and is invisible to the viewer behind platform buffers).
function hardKillAndRestart(streamId: string, delayMs: number, forceNewUrl = false, keepStatus = false) {
  const proc = activeStreams.get(streamId);
  if (!proc) return;

  proc.autoRestart = false;
  cleanupStreamProc(streamId, proc);

  try { proc.ffmpegProcess?.kill("SIGKILL"); } catch {}
  activeStreams.delete(streamId);
  if (!keepStatus) sendStatus(streamId, "reconnecting");

  setTimeout(() => {
    if (storage.getStream(streamId)) {
      startStream(streamId, !forceNewUrl /* reuseUrl */, keepStatus).catch((e: any) => {
        sendLog(streamId, `Fast-restart failed: ${e.message}`);
        sendStatus(streamId, "error");
      });
    }
  }, delayMs);
}

function handleProcessExit(streamId: string, code: number | null) {
  const proc = activeStreams.get(streamId);
  if (!proc) return;

  cleanupStreamProc(streamId, proc);
  activeStreams.delete(streamId);
  try { proc.ffmpegProcess?.kill("SIGKILL"); } catch {}

  if (proc.autoRestart && storage.getStream(streamId)) {
    const delay = proc.urlExpired ? 500 : 1000;
    sendLog(streamId, `Auto-restart enabled. Retrying in ${delay / 1000}s...`);
    sendStatus(streamId, "reconnecting");
    setTimeout(() => {
      if (storage.getStream(streamId)) {
        startStream(streamId, !proc.urlExpired).catch((e: any) => {
          sendLog(streamId, `Auto-restart failed: ${e.message}`);
          sendStatus(streamId, "error");
        });
      }
    }, delay);
  } else {
    // Keep the stream card in the control room with "error" status.
    // The user can see what happened, restart manually, or delete it.
    // (Old behaviour deleted the stream entirely, which wiped the control room card.)
    clearCameraLink(streamId);
    sendStatus(streamId, "error");
    sendLog(streamId, `Stream stopped unexpectedly. Click Restart to try again.`);
  }
}

export function stopStream(streamId: string) {
  const proc = activeStreams.get(streamId);
  if (!proc) return;

  sendLog(streamId, "Stopping stream...");
  proc.autoRestart = false;
  clearCameraLink(streamId);
  cleanupStreamProc(streamId, proc);
  // Remove from activeStreams NOW so handleProcessExit doesn't fire when FFmpeg
  // finally exits — we don't want it to re-broadcast "deleted" or try to auto-restart.
  activeStreams.delete(streamId);

  // Don't send 'q' to FFmpeg stdin when it's used for browser camera video data
  if (proc.inputUrl !== "__browser__") {
    try {
      if (proc.ffmpegProcess?.stdin?.writable) {
        proc.ffmpegProcess.stdin.write("q");
        proc.ffmpegProcess.stdin.end();
      }
    } catch {}
  }

  setTimeout(() => {
    try { proc.ffmpegProcess?.kill("SIGTERM"); } catch {}
  }, 300);
  setTimeout(() => {
    try { proc.ffmpegProcess?.kill("SIGKILL"); } catch {}
  }, 2000);

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
