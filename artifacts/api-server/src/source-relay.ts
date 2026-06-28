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
 * ─── LIFECYCLE ──────────────────────────────────────────────────────────────
 *  start()  → detect streamlink version → spawn streamlink --stdout
 *           → pipe data to FFmpeg stdin via .on('data') + .write()  ← NEVER .end()
 *           → NETWORK/SOURCE failure → exponential backoff → respawn
 *           → CONFIG error (bad flags, missing binary) → fail permanently, do NOT retry
 *  stop()   → kill source process, do NOT touch stdin (caller's responsibility)
 *
 * ─── WHY NOT .pipe() ────────────────────────────────────────────────────────
 * Node's readable.pipe(writable) calls writable.end() when the source stream
 * ends. That closes FFmpeg's stdin → FFmpeg processes EOF → exits → RTMP
 * disconnect. We use manual .write() instead to keep stdin alive across
 * source process restarts.
 *
 * ─── STREAMLINK VERSION COMPATIBILITY ───────────────────────────────────────
 * Streamlink 7.x renamed several flags:
 *   OLD (≤5.x)              NEW (7.x+)
 *   --hls-segment-timeout   --stream-segment-timeout
 *   --hls-timeout           --stream-timeout
 *   --http-cookie-jar       (removed — pass --http-cookie KEY=VALUE individually)
 *
 * The relay detects the installed version at startup and logs it.
 * On exit code 2 ("unrecognized arguments"), it fails permanently instead of
 * retrying — this is a configuration error, not a network failure.
 */

import { spawn, exec, ChildProcess } from "child_process";
import { logger } from "./lib/logger";
import { YTDLP_BIN } from "./lib/ytdlp";
import { promisify } from "util";

const execAsync = promisify(exec);

// ── Timing constants ──────────────────────────────────────────────────────────

/**
 * Backoff schedule (ms) for consecutive NETWORK / SOURCE failures.
 * Config errors (bad flags, ENOENT) do NOT use this — they fail permanently.
 */
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000, 60_000];

/**
 * How many consecutive failures trigger a "source may be offline" warning.
 */
const WARN_AFTER_FAILURES = 5;

/**
 * Startup watchdog (ms): if no bytes arrive after spawning, treat as offline.
 */
const STARTUP_TIMEOUT_MS = 60_000;

/**
 * Health monitoring interval (ms).
 */
const HEALTH_INTERVAL_MS = 10_000;

// ── Version detection ─────────────────────────────────────────────────────────

interface StreamlinkInfo {
  version: string;
  major: number;
}

let cachedStreamlinkInfo: StreamlinkInfo | null = null;

/**
 * Detect installed streamlink version (cached after first call).
 * Returns null if streamlink is not installed or version cannot be determined.
 */
async function detectStreamlink(): Promise<StreamlinkInfo | null> {
  if (cachedStreamlinkInfo) return cachedStreamlinkInfo;
  try {
    const { stdout } = await execAsync("streamlink --version", { timeout: 8_000 });
    // Output: "streamlink 7.1.3" or similar
    const match = stdout.trim().match(/streamlink\s+(\d+)\.(\d+)/i);
    if (!match) return null;
    const info: StreamlinkInfo = {
      version: match[0].replace(/^streamlink\s+/i, ""),
      major: parseInt(match[1], 10),
    };
    cachedStreamlinkInfo = info;
    return info;
  } catch {
    return null;
  }
}

// ── Config-error detection ────────────────────────────────────────────────────

/**
 * Returns true if the process exit looks like a configuration error
 * (bad flags, binary not found) rather than a network/source failure.
 * Configuration errors should NOT be retried.
 */
function isConfigError(exitCode: number | null, stderr: string): boolean {
  if (exitCode === 2) return true; // argparse exit code for unrecognized arguments
  if (/unrecognized argument|invalid choice|error: argument/i.test(stderr)) return true;
  return false;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type RelayStatus =
  | "starting"      // waiting for first bytes from source process
  | "running"       // bytes are flowing to FFmpeg stdin
  | "reconnecting"  // source died (network/source), waiting before next spawn
  | "failed"        // permanent failure — config error or binary not found
  | "stopped";      // stop() was called

export interface RelayEvent {
  type: "log" | "warn" | "status" | "health" | "fatal";
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
  /** Called for every relay event (logs, status changes, health). */
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
  private permanentlyFailed = false;
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

  /** Begin the relay. Detects streamlink version then spawns the source process. */
  start(): void {
    this._log(`[relay:${this.sourceType}] Starting — URL: ${this.pageUrl}`);
    this._setStatus("starting");
    this._startHealthMonitor();
    // Detect streamlink version first, then spawn
    detectStreamlink().then((info) => {
      if (this.stopped) return;
      if (info) {
        this._log(`[relay] streamlink ${info.version} detected`);
      } else {
        this._log(`[relay] streamlink not found or version unknown — attempting spawn anyway`);
      }
      this._spawn();
    });
  }

  /**
   * Permanently stop the relay.
   * Kills the source process. Does NOT close ffmpegStdin.
   */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
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

  private _fatal(msg: string): void {
    this.permanentlyFailed = true;
    this._setStatus("failed");
    this.onEvent({ type: "fatal", message: msg });
    logger.error({ streamId: this.streamId }, msg);
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
    // Extract bare username from the permanent page URL
    const username = this.pageUrl
      .replace(/.*tiktok\.com\/@?/, "")
      .replace(/\/.*$/, "")
      .replace(/^@/, "");

    // Quality selector: streamlink tries each in order, picks first available
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
        // streamlink 7.x flag names (renamed from --hls-* in older versions):
        //   --stream-segment-timeout: max time to wait for each segment to start
        //   --stream-timeout:          max time to wait for stream data overall
        "--http-timeout", "20",
        "--stream-segment-timeout", "15",
        "--stream-timeout", "60",
        // Built-in reconnect — streamlink handles transient CDN drops internally
        "--retry-streams", "10",
        "--retry-max", "10",
        "--retry-open", "5",
        // Start at the latest live segment (low-latency edge)
        "--hls-live-edge", "3",
        `https://www.tiktok.com/@${username}/live`,
        qualityArg,
      ],
    };
  }

  private _youTubeArgs(): { cmd: string; args: string[] } {
    // streamlink is preferred for YouTube live — uses the native YouTube plugin
    // which handles POT/rqh token rotation and HLS playlist refresh internally.
    return {
      cmd: "streamlink",
      args: [
        "--stdout",
        "--loglevel", "warning",
        "--stream-segment-timeout", "15",
        "--stream-timeout", "60",
        "--retry-streams", "10",
        "--retry-max", "10",
        "--retry-open", "5",
        "--hls-live-edge", "3",
        this.pageUrl,
        "best/1080p60/1080p/720p60/720p/480p/360p/worst",
      ],
    };
  }

  private _xSpaceArgs(): { cmd: string; args: string[] } {
    return {
      cmd: YTDLP_BIN,
      args: [
        "--no-config",
        "--no-playlist",
        "-f", "bestaudio",
        "--no-warnings",
        "--socket-timeout", "20",
        "-o", "-",
        this.pageUrl,
      ],
    };
  }

  // ── Core spawn / retry loop ────────────────────────────────────────────────

  private _spawn(): void {
    if (this.stopped || this.permanentlyFailed) return;

    const spawnArgs = this._getSpawnArgs();
    if (!spawnArgs) {
      this._fatal(`[relay] Unknown source type "${this.sourceType}" — cannot spawn`);
      return;
    }

    const { cmd, args } = spawnArgs;

    // Log the full command so the user can diagnose flag issues
    this._log(`[relay:${this.sourceType}] $ ${cmd} ${args.join(" ")}`);

    let proc: ChildProcess;
    try {
      proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e: any) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        this._fatal(
          `[relay] "${cmd}" not found. ` +
          `Install with: pip install ${cmd === "streamlink" ? "streamlink" : "yt-dlp"}`,
        );
      } else {
        this._warn(`[relay] Failed to launch ${cmd}: ${e.message}`);
        this._scheduleRetry();
      }
      return;
    }

    const thisProc = proc;
    this.proc = proc;

    let gotData = false;
    // Accumulate full stderr so we can classify the error on exit
    let stderrFull = "";
    let sessionBytes = 0;
    const spawnedAt = Date.now();

    // ── Startup watchdog ─────────────────────────────────────────────────────
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

    // ── stdout → FFmpeg stdin ─────────────────────────────────────────────────
    // CRITICAL: .write() not .pipe() — keeps stdin open across source restarts.
    proc.stdout?.on("data", (chunk: Buffer) => {
      if (!gotData) {
        gotData = true;
        clearTimeout(startupWatchdog);
        this.consecutiveFailures = 0;
        this._setStatus("running");
        this._log(
          `[relay:${this.sourceType}] ✓ Source connected — piping to FFmpeg stdin ` +
          `(first chunk: ${chunk.length} B)`,
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
        // FFmpeg exited — stream manager will call stop() shortly
      }
    });

    // ── stderr collection ─────────────────────────────────────────────────────
    proc.stderr?.on("data", (d: Buffer) => {
      const text = d.toString();
      stderrFull += text;

      // Stream stderr lines to the log in real time, filtered by relevance
      const lines = text.split("\n");
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

    // ── process error (e.g. ENOENT after spawn) ───────────────────────────────
    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(startupWatchdog);
      if (this.proc !== thisProc || this.stopped) return;
      this.proc = null;

      if (err.code === "ENOENT") {
        this._fatal(
          `[relay] "${cmd}" not found. ` +
          `Install with: pip install ${cmd === "streamlink" ? "streamlink" : "yt-dlp"}`,
        );
      } else {
        this._warn(`[relay] Process error: ${err.message}`);
        this._scheduleRetry();
      }
    });

    // ── process exit ──────────────────────────────────────────────────────────
    proc.on("exit", (code, signal) => {
      clearTimeout(startupWatchdog);
      if (this.proc !== thisProc || this.stopped) return;
      this.proc = null;

      const uptimeSec = Math.round((Date.now() - spawnedAt) / 1000);
      const kbRelayed = Math.round(sessionBytes / 1024);

      // ── Config error detection: fail permanently, do NOT retry ────────────
      // Exit code 2 is argparse's standard exit for unrecognized arguments.
      // Retrying an invalid command is pointless and wastes the retry budget.
      if (isConfigError(code, stderrFull)) {
        // Find the most useful error line from stderr
        const errorLine = stderrFull
          .split("\n")
          .map((l) => l.trim())
          .find((l) => /error|unrecognized/i.test(l)) ?? stderrFull.trim().slice(0, 200);
        this._fatal(
          `[relay] Configuration error (exit ${code}) — stopping retries.\n` +
          `  Command: ${cmd} ${args.join(" ")}\n` +
          `  Error: ${errorLine}\n` +
          `  Fix: check that the flags above are valid for your installed streamlink version.`,
        );
        return;
      }

      // ── Network / source failure: retry with backoff ───────────────────────
      if (gotData) {
        this._warn(
          `[relay:${this.sourceType}] Source exited after ${uptimeSec}s ` +
          `(${kbRelayed} KB relayed, code=${code}, signal=${signal}) — reconnecting`,
        );
      } else {
        this._warn(
          `[relay:${this.sourceType}] Source exited before sending data ` +
          `(code=${code}, signal=${signal}, uptime=${uptimeSec}s) — will retry`,
        );
      }

      this._scheduleRetry();
    });
  }

  // ── Retry scheduling (network/source failures only) ────────────────────────

  private _scheduleRetry(): void {
    if (this.stopped || this.permanentlyFailed) return;

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
      `[relay] Retry #${this.totalRestarts} in ${delayMs / 1000}s ` +
      `(consecutive failures: ${this.consecutiveFailures})`,
    );

    this._setStatus("reconnecting");

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped && !this.permanentlyFailed) {
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
