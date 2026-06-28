/**
 * SourceRelay — Self-Healing Live Source Pipe Manager
 *
 * Maintains a continuous data pipe from a live page URL (TikTok / YouTube / X Space)
 * to FFmpeg's stdin WITHOUT ever closing the stdin stream.
 *
 * ─── KEY PRINCIPLE ──────────────────────────────────────────────────────────
 * Store only PERMANENT live page URLs — never temporary CDN URLs.
 *   ✓  https://www.tiktok.com/@username/live
 *   ✓  https://www.youtube.com/@channel/live
 *   ✗  https://pull-live-f4.tiktokcdn.com/stream/abc123.flv?auth=...
 *
 * The relay resolves a fresh media stream from the page URL each time it
 * (re)spawns the source process. CDN URL expiry is therefore transparent:
 * streamlink continuously refreshes the HLS playlist and fetches new segments
 * without restarting FFmpeg.
 *
 * ─── LIFECYCLE ──────────────────────────────────────────────────────────────
 *  start()  → spawn source (streamlink/yt-dlp --stdout)
 *           → pipe data to FFmpeg stdin via .on('data') + .write()  ← NEVER .end()
 *           → if source exits → exponential backoff → spawn fresh source
 *  stop()   → kill source process, do NOT touch stdin (caller's responsibility)
 *
 * ─── WHY NOT .pipe() ────────────────────────────────────────────────────────
 * Node's readable.pipe(writable) calls writable.end() when the source stream
 * ends. That closes FFmpeg's stdin → FFmpeg processes EOF → exits → RTMP
 * disconnect → YouTube stream cut. We use manual .write() instead to keep
 * stdin alive across source process restarts.
 *
 * ─── FFMPEG SIDE ────────────────────────────────────────────────────────────
 * FFmpeg reads from pipe:0 (stdin). The brief data pause when the source
 * process restarts (typically 1–5 s) is absorbed by:
 *   • The 5-second RTMP output buffer (rtmp_buffer=5000)
 *   • The dropout_transition=10 audio silence bridge in the filter graph
 *   • YouTube's ~30-second platform-side stream buffer
 *
 * ─── LOGGING ────────────────────────────────────────────────────────────────
 * All events are surfaced via the onEvent callback so the caller can forward
 * them to both the Pino server log and the per-stream WebSocket log buffer.
 */

import { spawn, ChildProcess } from "child_process";
import { logger } from "./lib/logger";
import { YTDLP_BIN } from "./lib/ytdlp";
import fs from "fs";
import path from "path";

// ── Timing constants ──────────────────────────────────────────────────────────

/**
 * Backoff schedule (ms) for consecutive source failures.
 * Grows from 1 s → 60 s to avoid hammering the platform with rapid re-requests.
 */
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000, 60_000];

/**
 * How many consecutive failures trigger a "source may be offline" warning.
 * Below this threshold we treat failures as transient network / CDN issues.
 */
const WARN_AFTER_FAILURES = 5;

/**
 * Startup watchdog timeout (ms). If no bytes arrive within this time after
 * spawning, the source is considered offline and we retry with backoff.
 */
const STARTUP_TIMEOUT_MS = 60_000;

/**
 * Health monitoring interval (ms). Emits a health event so the caller can
 * log throughput and detect silent streams.
 */
const HEALTH_INTERVAL_MS = 10_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export type RelayStatus =
  | "starting"     // waiting for first bytes from source process
  | "running"      // bytes are flowing to FFmpeg stdin
  | "reconnecting" // source died, waiting for backoff before next spawn
  | "stopped";     // stop() was called — relay is permanently inactive

export interface RelayEvent {
  type: "log" | "warn" | "status" | "health";
  message?: string;
  status?: RelayStatus;
  bytesRelayed?: number;
  kbps?: number;
  consecutiveFailures?: number;
  totalRestarts?: number;
}

export interface SourceRelayOptions {
  streamId: string;
  /** "tiktok" | "tiktok_pipe" | "youtube" | "youtube_pipe" | "xspace" */
  sourceType: string;
  /**
   * The PERMANENT live page URL. Never a CDN URL.
   * Examples:
   *   TikTok:  "https://www.tiktok.com/@username/live"
   *   YouTube: "https://www.youtube.com/@channel/live"
   */
  pageUrl: string;
  /** Quality preference: "best" | "720p" | "480p" */
  quality: string;
  /**
   * FFmpeg's stdin WritableStream.
   * The relay writes data here and NEVER calls .end() on it.
   */
  ffmpegStdin: NodeJS.WritableStream;
  /** Callback invoked for every relay event (logs, status changes, health). */
  onEvent: (event: RelayEvent) => void;
}

// ── SourceRelay class ─────────────────────────────────────────────────────────

export class SourceRelay {
  private readonly streamId: string;
  private readonly sourceType: string;
  private readonly pageUrl: string;
  private readonly quality: string;
  private readonly ffmpegStdin: NodeJS.WritableStream;
  private readonly onEvent: (event: RelayEvent) => void;

  private proc: ChildProcess | null = null;
  private stopped = false;
  private consecutiveFailures = 0;
  private totalRestarts = 0;
  private bytesRelayed = 0;
  private lastByteSnapshot = 0;
  private lastHealthAt = Date.now();
  private status: RelayStatus = "starting";
  private retryTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;

  constructor(opts: SourceRelayOptions) {
    this.streamId = opts.streamId;
    this.sourceType = opts.sourceType;
    this.pageUrl = opts.pageUrl;
    this.quality = opts.quality;
    this.ffmpegStdin = opts.ffmpegStdin;
    this.onEvent = opts.onEvent;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Begin the relay. Spawns the source process and starts piping to FFmpeg stdin. */
  start(): void {
    this._log(
      `[relay:${this.sourceType}] Starting — permanent URL: ${this.pageUrl}`,
    );
    this._setStatus("starting");
    this._startHealthMonitor();
    this._spawn();
  }

  /**
   * Permanently stop the relay.
   * Kills the source process. Does NOT close ffmpegStdin — that is the caller's job.
   */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this._log(`[relay:${this.sourceType}] Stopping`);
    this._setStatus("stopped");
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
    this._kill(this.proc);
    this.proc = null;
  }

  getStatus(): RelayStatus { return this.status; }
  getTotalRestarts(): number { return this.totalRestarts; }
  getBytesRelayed(): number { return this.bytesRelayed; }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _setStatus(s: RelayStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.onEvent({
      type: "status",
      status: s,
      totalRestarts: this.totalRestarts,
      consecutiveFailures: this.consecutiveFailures,
    });
  }

  private _log(msg: string): void {
    this.onEvent({ type: "log", message: msg });
    logger.info({ streamId: this.streamId }, msg);
  }

  private _warn(msg: string): void {
    this.onEvent({ type: "warn", message: msg });
    logger.warn({ streamId: this.streamId }, msg);
  }

  private _kill(proc: ChildProcess | null): void {
    if (!proc) return;
    try { proc.kill("SIGKILL"); } catch {}
  }

  // ── Spawn args per source type ─────────────────────────────────────────────

  private _getSpawnArgs(): { cmd: string; args: string[] } | null {
    const st = this.sourceType;
    if (st === "tiktok" || st === "tiktok_pipe") return this._tikTokArgs();
    if (st === "youtube" || st === "youtube_pipe") return this._youTubeArgs();
    if (st === "xspace") return this._xSpaceArgs();
    return null;
  }

  private _tikTokArgs(): { cmd: string; args: string[] } {
    // Extract bare username from the permanent page URL or treat as username directly
    const username = this.pageUrl
      .replace(/.*tiktok\.com\/@?/, "")
      .replace(/\/.*$/, "")
      .replace(/^@/, "");

    const cookiesPath = path.join(process.cwd(), "tiktok-cookies.txt");
    const hasCookies = fs.existsSync(cookiesPath);

    // Map quality preference → streamlink quality selector
    const qualityMap: Record<string, string> = {
      best: "best",
      "720p": "720p,best",
      "480p": "480p,720p,best",
    };
    const qualityArg = qualityMap[this.quality] ?? "best";

    return {
      cmd: "streamlink",
      args: [
        "--stdout",
        "--loglevel", "warning",
        "--http-header",
        "User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "--http-header", "Referer=https://www.tiktok.com/",
        "--http-header", "Accept-Language=en-US,en;q=0.9",
        "--http-timeout", "20",
        // HLS segment / playlist timeouts — allow TikTok CDN to be slow
        "--hls-segment-timeout", "15",
        "--hls-timeout", "60",
        // streamlink built-in reconnect handles transient CDN drops internally.
        // --retry-streams: how many times to retry the stream URL if it goes dead
        // --retry-max:     how many total request retries per segment/manifest
        // --retry-open:    how many times to retry opening the stream
        "--retry-streams", "10",
        "--retry-max", "10",
        "--retry-open", "5",
        // Live edge: start at the latest available segment, not the beginning of DVR
        "--hls-live-edge", "3",
        ...(hasCookies ? ["--http-cookie-jar", cookiesPath] : []),
        `https://www.tiktok.com/@${username}/live`,
        qualityArg,
      ],
    };
  }

  private _youTubeArgs(): { cmd: string; args: string[] } {
    // streamlink is preferred over yt-dlp for YouTube live because:
    // - It uses YouTube's native streaming API (no POT/rqh=1 token issues)
    // - It keeps all segment fetches inside its own session (no 403s on CDN)
    // - It handles playlist refresh and reconnection automatically
    const cookiesPath = path.join(process.cwd(), "cookies.txt");
    const hasCookies = fs.existsSync(cookiesPath);

    return {
      cmd: "streamlink",
      args: [
        "--stdout",
        "--loglevel", "warning",
        "--hls-segment-timeout", "15",
        "--hls-timeout", "60",
        "--retry-streams", "10",
        "--retry-max", "10",
        "--retry-open", "5",
        "--hls-live-edge", "3",
        ...(hasCookies ? ["--http-cookie-jar", cookiesPath] : []),
        this.pageUrl,
        "best/1080p60/1080p/720p60/720p/480p/360p/worst",
      ],
    };
  }

  private _xSpaceArgs(): { cmd: string; args: string[] } {
    const xCookiesPath = path.join(process.cwd(), "x-cookies.txt");
    const hasCookies = fs.existsSync(xCookiesPath);
    return {
      cmd: YTDLP_BIN,
      args: [
        "--no-config",
        "--no-playlist",
        "-f", "bestaudio",
        "--no-warnings",
        "--socket-timeout", "20",
        "-o", "-",
        ...(hasCookies ? ["--cookies", xCookiesPath] : []),
        this.pageUrl,
      ],
    };
  }

  // ── Core spawn / retry loop ────────────────────────────────────────────────

  private _spawn(): void {
    if (this.stopped) return;

    const spawnArgs = this._getSpawnArgs();
    if (!spawnArgs) {
      this._warn(`[relay] Unknown source type "${this.sourceType}" — cannot spawn`);
      return;
    }

    const { cmd, args } = spawnArgs;

    // Log the last 2 args (URL + quality) so the log isn't flooded with all flags
    this._log(`[relay:${this.sourceType}] Spawning: ${cmd} … ${args.slice(-2).join(" ")}`);

    let proc: ChildProcess;
    try {
      proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e: any) {
      this._warn(`[relay] Failed to launch ${cmd}: ${e.message}`);
      this._scheduleRetry();
      return;
    }

    const thisProc = proc;
    this.proc = proc;

    let gotData = false;
    let stderrBuf = "";
    let sessionBytes = 0;
    const spawnedAt = Date.now();

    // ── Startup watchdog ─────────────────────────────────────────────────────
    // If streamlink finds no live stream, it exits immediately with no stdout.
    // If TikTok/YouTube is not live, we'll know within STARTUP_TIMEOUT_MS.
    const startupWatchdog = setTimeout(() => {
      if (!gotData && this.proc === thisProc && !this.stopped) {
        this._warn(
          `[relay] No data received after ${STARTUP_TIMEOUT_MS / 1000}s — ` +
          `source may not be live. Will retry.`,
        );
        this._kill(thisProc);
        this._scheduleRetry();
      }
    }, STARTUP_TIMEOUT_MS);

    // ── stdout: pipe to FFmpeg stdin ──────────────────────────────────────────
    // CRITICAL: We use .write() instead of .pipe() so that when this process
    // exits, we do NOT call .end() on ffmpegStdin. That keeps FFmpeg alive.
    proc.stdout?.on("data", (chunk: Buffer) => {
      if (!gotData) {
        gotData = true;
        clearTimeout(startupWatchdog);
        this.consecutiveFailures = 0;
        this._setStatus("running");
        this._log(
          `[relay:${this.sourceType}] ✓ Source live — piping to FFmpeg stdin ` +
          `(first chunk: ${chunk.length} bytes)`,
        );
      }

      sessionBytes += chunk.length;
      this.bytesRelayed += chunk.length;

      try {
        const stdin = this.ffmpegStdin as any;
        if (stdin && !stdin.destroyed && stdin.writable) {
          stdin.write(chunk);
        }
      } catch {
        // FFmpeg has exited — the relay will be stopped by the stream manager
      }
    });

    // ── stderr: structured logging ────────────────────────────────────────────
    proc.stderr?.on("data", (d: Buffer) => {
      stderrBuf += d.toString();
      const lines = stderrBuf.split("\n");
      stderrBuf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        if (/error|warning|failed|cannot|unable|unavailable|not live|no streams/i.test(t)) {
          this._warn(`[relay:${cmd}] ${t}`);
        } else {
          logger.debug({ streamId: this.streamId, src: cmd }, t);
        }
      }
    });

    // ── process error (e.g. ENOENT) ───────────────────────────────────────────
    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(startupWatchdog);
      if (this.proc !== thisProc || this.stopped) return;
      this.proc = null;

      if (err.code === "ENOENT") {
        this._warn(
          `[relay] "${cmd}" not found. ` +
          `Install with: pip install ${cmd === "streamlink" ? "streamlink" : "yt-dlp"}`,
        );
      } else {
        this._warn(`[relay] Process error: ${err.message}`);
      }
      this._scheduleRetry();
    });

    // ── process exit ──────────────────────────────────────────────────────────
    proc.on("exit", (code, signal) => {
      clearTimeout(startupWatchdog);
      if (this.proc !== thisProc || this.stopped) return;
      this.proc = null;

      const uptimeSec = Math.round((Date.now() - spawnedAt) / 1000);
      const kbRelayed = Math.round(sessionBytes / 1024);

      if (gotData) {
        this._warn(
          `[relay:${this.sourceType}] Source exited after ${uptimeSec}s ` +
          `(${kbRelayed} KB relayed, code=${code}, signal=${signal}) — reconnecting`,
        );
      } else {
        this._warn(
          `[relay:${this.sourceType}] Source exited before sending data ` +
          `(code=${code}, signal=${signal}) — will retry`,
        );
      }

      this._scheduleRetry();
    });
  }

  // ── Retry scheduling ────────────────────────────────────────────────────────

  private _scheduleRetry(): void {
    if (this.stopped) return;

    this.consecutiveFailures++;
    this.totalRestarts++;

    if (this.consecutiveFailures >= WARN_AFTER_FAILURES) {
      this._warn(
        `[relay] ${this.consecutiveFailures} consecutive failures — ` +
        `source may be offline or rate-limited. Continuing to retry.`,
      );
    }

    const backoffIdx = Math.min(this.consecutiveFailures - 1, BACKOFF_MS.length - 1);
    const delayMs = BACKOFF_MS[backoffIdx];

    this._warn(
      `[relay] Retry #${this.totalRestarts} scheduled in ${delayMs / 1000}s ` +
      `(consecutive failures: ${this.consecutiveFailures})`,
    );

    this._setStatus("reconnecting");

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) {
        this._setStatus("starting");
        this._spawn();
      }
    }, delayMs);
  }

  // ── Health monitoring ───────────────────────────────────────────────────────

  private _startHealthMonitor(): void {
    this.healthTimer = setInterval(() => {
      if (this.stopped) return;
      const now = Date.now();
      const elapsedSec = (now - this.lastHealthAt) / 1000;
      const bytesDelta = this.bytesRelayed - this.lastByteSnapshot;
      const kbps = elapsedSec > 0 ? Math.round((bytesDelta * 8) / 1000 / elapsedSec) : 0;

      this.lastByteSnapshot = this.bytesRelayed;
      this.lastHealthAt = now;

      this.onEvent({
        type: "health",
        bytesRelayed: this.bytesRelayed,
        kbps,
        consecutiveFailures: this.consecutiveFailures,
        totalRestarts: this.totalRestarts,
        status: this.status,
      });
    }, HEALTH_INTERVAL_MS);
  }
}
