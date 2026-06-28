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
      this._spawn().catch((err) => {
        this._warn(`[relay] Unexpected spawn error: ${err?.message ?? err}`);
        this._scheduleRetry();
      });
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

  // ── Stream quality resolution ──────────────────────────────────────────────

  /**
   * Query streamlink for available stream names on the given URL, then pick
   * the most appropriate quality.
   *
   * Selection priority:
   *   1. "best"  — if present in the stream list (streamlink alias)
   *   2. User's requested quality — if it exists in the list
   *   3. Highest available stream — last entry after filtering out "worst"/"best"/"audio_only"
   *
   * Returns the chosen quality string, or null if the channel is offline /
   * no streams are available.
   */
  private async _resolveStreamlinkQuality(
    url: string,
    extraArgs: string[] = [],
  ): Promise<string | null> {
    this._log(`[relay] Querying available streams for: ${url}`);

    let stdout = "";
    let stderr = "";
    try {
      const result = await execAsync(
        `streamlink --json ${extraArgs.join(" ")} ${url}`,
        { timeout: 30_000 },
      );
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (e: any) {
      stdout = e.stdout ?? "";
      stderr = e.stderr ?? e.message ?? String(e);
    }

    // Try to parse JSON regardless of exit code — streamlink sometimes exits 1
    // but still emits valid JSON with an "error" field when the channel is offline.
    let parsed: { streams?: Record<string, unknown>; error?: string } | null = null;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      // Not JSON — fall through to stderr analysis
    }

    // Explicit offline/unavailable report from JSON
    if (parsed?.error) {
      this._warn(`[relay] Streamlink reported: ${parsed.error}`);
      return null;
    }

    const streams = parsed?.streams ?? {};
    const names = Object.keys(streams);

    if (names.length === 0) {
      // No JSON streams — analyse stderr to give a clear reason
      const offlinePatterns =
        /no playable streams|channel.*offline|not live|unavailable|no streams found|could not find/i;
      if (offlinePatterns.test(stderr)) {
        this._warn(
          `[relay] Channel is offline or unavailable. ` +
          `Streamlink said: ${stderr.trim().split("\n").slice(-3).join(" | ")}`,
        );
      } else if (stderr.trim()) {
        this._warn(`[relay] No streams returned. Stderr: ${stderr.trim().slice(0, 300)}`);
      } else {
        this._warn(`[relay] No streams returned (empty response). Channel may be offline.`);
      }
      return null;
    }

    // Log all available names so operators can diagnose quality issues
    this._log(`[relay] Available streams: ${names.join(", ")}`);

    // 1. "best" alias — always prefer it when present
    if (names.includes("best")) {
      this._log(`[relay] Selected quality: best`);
      return "best";
    }

    // 2. User's requested quality — exact match
    if (this.quality && names.includes(this.quality)) {
      this._log(`[relay] Selected quality: ${this.quality} (user preference)`);
      return this.quality;
    }

    // 3. Fallback: highest real quality (exclude aliases like "worst"/"audio_only")
    const aliases = new Set(["worst", "best", "audio_only"]);
    const realStreams = names.filter((n) => !aliases.has(n));
    const chosen = realStreams.length > 0
      ? realStreams[realStreams.length - 1]   // last is typically highest quality
      : names[names.length - 1];

    if (this.quality && !names.includes(this.quality)) {
      this._warn(
        `[relay] Requested quality "${this.quality}" not available. ` +
        `Falling back to "${chosen}". Available: ${names.join(", ")}`,
      );
    } else {
      this._log(`[relay] Selected quality: ${chosen}`);
    }
    return chosen;
  }

  // ── Spawn args per source type ─────────────────────────────────────────────

  private _getSpawnArgs(resolvedQuality: string): { cmd: string; args: string[] } | null {
    const st = this.sourceType;
    if (st === "tiktok" || st === "tiktok_pipe") return this._tikTokArgs(resolvedQuality);
    if (st === "youtube" || st === "youtube_pipe") return this._youTubeArgs(resolvedQuality);
    if (st === "xspace") return this._xSpaceArgs();
    return null;
  }

  private _tikTokArgs(resolvedQuality: string): { cmd: string; args: string[] } {
    // Extract bare username from the permanent page URL
    const username = this.pageUrl
      .replace(/.*tiktok\.com\/@?/, "")
      .replace(/\/.*$/, "")
      .replace(/^@/, "");

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
        "--stream-segment-timeout", "15",
        "--stream-timeout", "60",
        "--retry-streams", "10",
        "--retry-max", "10",
        "--retry-open", "5",
        "--hls-live-edge", "3",
        `https://www.tiktok.com/@${username}/live`,
        resolvedQuality,
      ],
    };
  }

  private _youTubeArgs(formatSelector: string): { cmd: string; args: string[] } {
    // yt-dlp is used for YouTube live instead of streamlink because:
    //
    //  1. YouTube rate-limits rapid manifest requests (403/429). Our two-step
    //     streamlink flow (quality probe → playback spawn) makes two manifest
    //     requests in quick succession, reliably triggering rate limits.
    //
    //  2. Streamlink's YouTube plugin does not attach Referer/Origin headers
    //     when fetching individual HLS segments, causing 403s on segment CDN
    //     requests even when the playlist URL itself resolves fine.
    //
    //  3. yt-dlp handles rqh token rotation, segment-level auth headers, and
    //     the signed-URL expiry cycle internally in a single session — no
    //     separate quality-probe request is needed.
    //
    // --extractor-args "youtube:player_client=web" forces the web player path
    // which returns HLS (m3u8_native) streams. The default android-vr client
    // returns DASH streams that cannot be piped to a single stdout cleanly.
    //
    // --hls-use-mpegts writes an MPEG-TS container to stdout, which FFmpeg
    // can read from stdin as a continuous stream across HLS segment boundaries.
    return {
      cmd: YTDLP_BIN,
      args: [
        "--no-config",
        "--no-playlist",
        "--no-warnings",
        "--extractor-args", "youtube:player_client=web",
        "-f", formatSelector,
        "--hls-use-mpegts",
        "--socket-timeout", "20",
        "-o", "-",
        this.pageUrl,
      ],
    };
  }

  /**
   * Derive a yt-dlp format selector string from the user's quality preference.
   *
   * We do NOT pre-query yt-dlp to discover available formats (that would make
   * two requests → rate limiting). Instead, we build a cascading format selector
   * that tries the user's preferred height first, then falls back gracefully.
   *
   * All selectors prefer m3u8_native (HLS) over other protocols so the output
   * is a single MPEG-TS stream suitable for piping to FFmpeg stdin.
   */
  private _youTubeFormatSelector(): string {
    const qualityMap: Record<string, string> = {
      best:  "best[protocol=m3u8_native]/best",
      "720p": "best[height<=720][protocol=m3u8_native]/best[height<=720]/best",
      "480p": "best[height<=480][protocol=m3u8_native]/best[height<=480]/best",
      "360p": "best[height<=360][protocol=m3u8_native]/best[height<=360]/best",
      "240p": "best[height<=240][protocol=m3u8_native]/best[height<=240]/best",
    };
    const sel = qualityMap[this.quality] ?? qualityMap["best"];
    this._log(`[relay] YouTube format selector: ${sel}`);
    return sel;
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

  private async _spawn(): Promise<void> {
    if (this.stopped || this.permanentlyFailed) return;

    // ── Quality / format-selector resolution ──────────────────────────────────
    //
    //  TikTok  → streamlink: query `streamlink --json` to discover available
    //            stream names at runtime, then spawn with the resolved name.
    //            This avoids passing invalid quality strings.
    //
    //  YouTube → yt-dlp: derive a cascading yt-dlp format selector directly
    //            from the user's quality preference WITHOUT a pre-query.
    //            A separate "probe then play" flow triggers YouTube rate limits
    //            (429) because two manifest requests arrive from the same IP in
    //            rapid succession. yt-dlp resolves and streams in one session.
    //
    //  xspace / other → no quality resolution needed; yt-dlp handles it.
    //
    let resolvedQuality = "best";
    const st = this.sourceType;
    const isTikTokSource = st === "tiktok" || st === "tiktok_pipe";
    const isYouTubeSource = st === "youtube" || st === "youtube_pipe";

    if (isTikTokSource) {
      const username = this.pageUrl
        .replace(/.*tiktok\.com\/@?/, "")
        .replace(/\/.*$/, "")
        .replace(/^@/, "");
      const queryUrl = `https://www.tiktok.com/@${username}/live`;

      const extraArgs = [
        "--http-header",
        "User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "--http-header", "Referer=https://www.tiktok.com/",
      ];

      const quality = await this._resolveStreamlinkQuality(queryUrl, extraArgs);
      if (this.stopped || this.permanentlyFailed) return;

      if (quality === null) {
        // Channel offline / no streams — retry with backoff, not permanent fail
        this._scheduleRetry();
        return;
      }
      resolvedQuality = quality;

    } else if (isYouTubeSource) {
      // Build yt-dlp format selector from user preference — no pre-query.
      resolvedQuality = this._youTubeFormatSelector();
    }

    const spawnArgs = this._getSpawnArgs(resolvedQuality);
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

      // Stream stderr lines to the log in real time, filtered by relevance.
      // Patterns cover both streamlink and yt-dlp output styles.
      const lines = text.split("\n");
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        const isSignificant =
          // General error/warning indicators
          /error|warning|failed|cannot|unable|unavailable/i.test(t) ||
          // Streamlink-specific offline/stream signals
          /not live|no streams|no playable streams/i.test(t) ||
          // yt-dlp YouTube-specific signals
          /no video formats found|this (video|channel) is (unavailable|not available)|private video|members.only|geo.?restrict|sign in to confirm|HTTP Error 40[0-9]/i.test(t);

        if (isSignificant) {
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
        this._spawn().catch((err) => {
          this._warn(`[relay] Unexpected spawn error: ${err?.message ?? err}`);
          this._scheduleRetry();
        });
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
