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

// ── spawnCollect ──────────────────────────────────────────────────────────────

/**
 * Run a command via spawn (NO shell — args are passed as an array, never
 * concatenated into a shell string). Collects all stdout + stderr and resolves
 * when the process exits or the timeout fires.
 *
 * Use this instead of execAsync / exec whenever args may contain characters
 * that are special in sh (parentheses, quotes, dollar signs, etc.).
 * Most notably: User-Agent strings such as
 *   "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
 * contain "(" which sh parses as a subshell — causing the error
 *   /bin/sh: Syntax error: "(" unexpected
 * when passed through exec/execAsync.
 */
function spawnCollect(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    let proc: ChildProcess;
    try {
      proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (e: any) {
      return reject(e);
    }

    let stdout = "";
    let stderr = "";
    // settled guards against the race where timeout fires and then "exit" fires
    // (or vice-versa), which would call resolve/reject twice on the same Promise.
    let settled = false;
    const settle = (value: { stdout: string; stderr: string; exitCode: number | null }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      settle({ stdout, stderr, exitCode: null });
    }, timeoutMs);

    proc.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      settle({ stdout, stderr, exitCode: code });
    });
  });
}

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

/**
 * Sentinel returned by _resolveStreamlinkQuality when streamlink itself is
 * broken/misconfigured (bad flags, binary not installed). The caller must
 * call _fatal() and NOT fall back to yt-dlp — retrying a bad command or
 * a missing binary forever would waste the retry budget.
 *
 * Distinct from `null` (channel offline / no streams), where yt-dlp fallback
 * is the appropriate next step.
 */
const STREAMLINK_CONFIG_ERROR: unique symbol = Symbol("streamlink_config_error");

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
   * Return values:
   *   string                  — a valid quality name; proceed with streamlink
   *   null                    — channel offline / no streams; yt-dlp fallback is appropriate
   *   STREAMLINK_CONFIG_ERROR — bad flags or binary not installed; caller must _fatal(),
   *                            NOT fall back to yt-dlp (retrying a broken command is useless)
   */
  private async _resolveStreamlinkQuality(
    url: string,
    extraArgs: string[] = [],
  ): Promise<string | null | typeof STREAMLINK_CONFIG_ERROR> {
    this._log(`[relay] Querying available streams for: ${url}`);

    // IMPORTANT: use spawnCollect (array args, NO shell) — NOT execAsync.
    // execAsync runs via `sh -c` and concatenates args into a shell string.
    // User-Agent values contain "(" which sh parses as a subshell, causing:
    //   /bin/sh: Syntax error: "(" unexpected
    // spawnCollect passes each arg as a separate array element, bypassing sh.
    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;
    try {
      const result = await spawnCollect(
        "streamlink",
        ["--json", ...extraArgs, url],
        30_000,
      );
      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = result.exitCode;
    } catch (e: any) {
      // ENOENT → streamlink is not installed; treat as permanent config error.
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        this._warn(`[relay] streamlink binary not found — cannot probe TikTok streams`);
        return STREAMLINK_CONFIG_ERROR;
      }
      stdout = "";
      stderr = e.message ?? String(e);
    }

    // ── Detect configuration / installation errors early ─────────────────────
    // Exit code 2 = argparse "unrecognized arguments"; stderr patterns also
    // cover older streamlink versions that don't use exit code 2 consistently.
    // These must NOT fall back to yt-dlp — the command itself is broken.
    if (isConfigError(exitCode, stderr)) {
      const errorLine = stderr
        .split("\n")
        .map((l) => l.trim())
        .find((l) => /error|unrecognized/i.test(l)) ?? stderr.trim().slice(0, 200);
      this._warn(
        `[relay] Streamlink configuration error (exit ${exitCode}): ${errorLine}`,
      );
      return STREAMLINK_CONFIG_ERROR;
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

  /** Sentinel value used when streamlink returns no streams and we fall back to yt-dlp. */
  private static readonly YTDLP_TIKTOK_FALLBACK = "__ytdlp_tiktok_fallback__";

  private _tikTokArgs(resolvedQuality: string): { cmd: string; args: string[] } {
    // When streamlink's quality probe returned no streams, _spawn sets this
    // sentinel and we transparently switch to yt-dlp for the same TikTok URL.
    if (resolvedQuality === SourceRelay.YTDLP_TIKTOK_FALLBACK) {
      return this._tikTokYtdlpArgs();
    }

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

  /**
   * yt-dlp fallback args for TikTok live.
   *
   * Used when streamlink's quality probe returns no streams — either because
   * the TikTok plugin is incompatible with the installed streamlink version,
   * or because the live feed URL format changed.
   *
   * yt-dlp supports TikTok live via its own extractor and does not require
   * a separate quality-probe step: `best` resolves internally in one session.
   *
   * --hls-use-mpegts  — write MPEG-TS to stdout so FFmpeg receives a
   *                     continuous seekable byte-stream across HLS segments.
   * --no-progress     — suppress the progress bar but keep WARNING/ERROR lines
   *                     visible in stderr for the relay's log handler.
   */
  private _tikTokYtdlpArgs(): { cmd: string; args: string[] } {
    const username = this.pageUrl
      .replace(/.*tiktok\.com\/@?/, "")
      .replace(/\/.*$/, "")
      .replace(/^@/, "");
    const url = `https://www.tiktok.com/@${username}/live`;

    const qualityMap: Record<string, string> = {
      best:   "best[protocol^=m3u8]/best",
      "720p": "best[height<=720][protocol^=m3u8]/best[height<=720]/best",
      "480p": "best[height<=480][protocol^=m3u8]/best[height<=480]/best",
      "360p": "best[height<=360][protocol^=m3u8]/best[height<=360]/best",
      "240p": "best[height<=240][protocol^=m3u8]/best[height<=240]/best",
    };
    const formatSelector = qualityMap[this.quality] ?? qualityMap["best"];

    return {
      cmd: YTDLP_BIN,
      args: [
        "--no-config",
        "--no-playlist",
        "--no-progress",
        "--extractor-retries", "5",
        "--retry-sleep", "extractor:exp=1:10",
        "-f", formatSelector,
        "--hls-use-mpegts",
        "--socket-timeout", "30",
        "-o", "-",
        url,
      ],
    };
  }

  private _youTubeArgs(formatSelector: string): { cmd: string; args: string[] } {
    // yt-dlp is used for YouTube live instead of streamlink because:
    //
    //  1. YouTube rate-limits rapid manifest requests (403/429). The previous
    //     streamlink two-step flow (quality probe → playback spawn) made two
    //     manifest requests in quick succession, reliably triggering rate limits.
    //     yt-dlp resolves and streams in one session, eliminating that problem.
    //
    //  2. Streamlink's YouTube plugin does not attach Referer/Origin headers
    //     when fetching HLS segments, causing 403s on segment CDN requests.
    //     yt-dlp handles segment-level auth headers internally.
    //
    //  3. yt-dlp handles rqh token rotation and the signed-URL expiry cycle
    //     internally — no separate quality-probe request is needed.
    //
    // ── Flag rationale ───────────────────────────────────────────────────────
    //
    // --no-progress          — suppresses the download progress bar but keeps
    //                          all WARNING and ERROR lines visible in stderr so
    //                          the relay's stderr handler can log 429s, format
    //                          errors, and offline signals. (--no-warnings would
    //                          hide the "HTTP 429" warning that explains WHY
    //                          "No video formats found!" happens.)
    //
    // --extractor-retries 5  — retry the m3u8 manifest fetch up to 5× when it
    //                          returns 429/503. Without this, a single transient
    //                          rate-limit response immediately causes "No video
    //                          formats found!" and the relay must restart.
    //
    // --retry-sleep          — exponential backoff between extractor retries:
    //   extractor:exp=1:10     1 s → 2 s → 4 s → 8 s → 10 s cap.
    //
    // --hls-use-mpegts       — write an MPEG-TS container to stdout so FFmpeg
    //                          receives a single seekable byte-stream across
    //                          HLS segment boundaries (no atom-level rewrite).
    //
    // NOTE: --extractor-args "youtube:player_client=web" was deliberately
    // removed. It requires a JS runtime (node/deno/quickjs) for nsig solving,
    // none of which are configured here. The default android-VR client returns
    // both DASH and HLS (m3u8) formats; the format selector below picks HLS.
    return {
      cmd: YTDLP_BIN,
      args: [
        "--no-config",
        "--no-playlist",
        "--no-progress",
        "--extractor-retries", "5",
        "--retry-sleep", "extractor:exp=1:10",
        "-f", formatSelector,
        "--hls-use-mpegts",
        "--socket-timeout", "30",
        "-o", "-",
        this.pageUrl,
      ],
    };
  }

  /**
   * Derive a yt-dlp format selector from the user's quality preference.
   *
   * We do NOT pre-query yt-dlp (that would make a second manifest request,
   * risking a 429 rate limit). Instead we build a cascading selector that
   * the single streaming invocation resolves internally.
   *
   * Protocol selector uses `^=m3u8` ("starts with m3u8") rather than
   * `=m3u8_native` (exact match) so it also accepts the plain `m3u8` protocol
   * variant. If no m3u8 stream passes the height filter, the `/best` fallback
   * picks whatever yt-dlp considers best — combined with `--hls-use-mpegts`
   * this is still piped as MPEG-TS even when it's an HLS stream.
   */
  private _youTubeFormatSelector(): string {
    const qualityMap: Record<string, string> = {
      best:   "best[protocol^=m3u8]/best",
      "720p": "best[height<=720][protocol^=m3u8]/best[height<=720]/best",
      "480p": "best[height<=480][protocol^=m3u8]/best[height<=480]/best",
      "360p": "best[height<=360][protocol^=m3u8]/best[height<=360]/best",
      "240p": "best[height<=240][protocol^=m3u8]/best[height<=240]/best",
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

      if (quality === STREAMLINK_CONFIG_ERROR) {
        // Bad flags or streamlink not installed — permanent failure, do NOT retry.
        // Falling back to yt-dlp here would mask the misconfiguration and waste
        // the retry budget on a fundamentally broken command.
        this._fatal(
          `[relay] Streamlink is misconfigured or not installed. ` +
          `Fix the streamlink installation/flags, then restart the stream.`,
        );
        return;
      } else if (quality === null) {
        // Streamlink returned no streams (channel offline or plugin mismatch) —
        // fall back to yt-dlp which has its own TikTok extractor. If the channel
        // is truly offline, yt-dlp also fails fast and the exit handler retries.
        this._log(`[relay] Streamlink no streams — switching to yt-dlp fallback for TikTok`);
        resolvedQuality = SourceRelay.YTDLP_TIKTOK_FALLBACK;
      } else {
        resolvedQuality = quality;
      }

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
