import { spawn } from "child_process";
import fs from "fs";
import path from "path";

/** In-process cache: YouTube URL → downloaded temp file path */
const ytDownloadCache = new Map<string, string>();

/** Delete all cached yt-dlp downloads and clear the cache map. */
export function clearYtDownloadCache(): void {
  for (const [, filePath] of ytDownloadCache.entries()) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
  }
  ytDownloadCache.clear();
}

/**
 * Returns yt-dlp --cookies args if a cookies.txt file has been uploaded.
 * The cookies file lives at <cwd>/cookies.txt in Netscape format.
 */
export function getCookiesArgs(): string[] {
  const cookiesPath = path.join(process.cwd(), "cookies.txt");
  return fs.existsSync(cookiesPath) ? ["--cookies", cookiesPath] : [];
}

export function getCookiesConfigured(): boolean {
  return fs.existsSync(path.join(process.cwd(), "cookies.txt"));
}

/**
 * Reads cookies.txt (Netscape format) and returns a Cookie header string
 * suitable for FFmpeg's -headers option.
 * e.g. "Cookie: SID=abc; HSID=xyz\r\n"
 * Returns an empty string when no cookies file exists or it has no YouTube entries.
 */
export function getYouTubeFFmpegCookieHeader(): string {
  const cookiesPath = path.join(process.cwd(), "cookies.txt");
  if (!fs.existsSync(cookiesPath)) return "";

  try {
    const lines = fs.readFileSync(cookiesPath, "utf-8").split("\n");
    const pairs: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const parts = trimmed.split("\t");
      if (parts.length < 7) continue;
      const domain = parts[0];
      const name = parts[5];
      const value = parts[6];
      if (
        name && value &&
        (domain.includes("youtube.com") || domain.includes("google.com"))
      ) {
        pairs.push(`${name}=${value}`);
      }
    }
    return pairs.length > 0 ? `Cookie: ${pairs.join("; ")}\r\n` : "";
  } catch {
    return "";
  }
}

/**
 * Parses yt-dlp stderr and returns a user-friendly error message.
 */
export function humaniseYtdlpError(stderr: string, fallback: string): string {
  const low = stderr.toLowerCase();
  if (
    low.includes("sign in") ||
    low.includes("not a bot") ||
    low.includes("confirm you") ||
    low.includes("bot detection")
  ) {
    return "YouTube is blocking the request. The channel may require sign-in. Try a different channel URL or check the channel is publicly live.";
  }
  if (low.includes("private video") || low.includes("age-restricted") || low.includes("age restricted")) {
    return `This video is private or age-restricted. It cannot be streamed without account access.`;
  }
  if (low.includes("is not currently live") || low.includes("not live") || low.includes("no streams")) {
    return "NOT_LIVE";
  }
  return stderr ? `yt-dlp: ${stderr.slice(0, 300)}` : fallback;
}

/** Normalise any YouTube channel/video input to a full HTTPS URL */
export function normaliseYouTubeUrl(input: string): string {
  const url = input.trim();
  if (url.startsWith("http")) return url;
  if (url.startsWith("@")) return `https://www.youtube.com/${url}/live`;
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return `https://www.youtube.com/watch?v=${url}`;
  return `https://www.youtube.com/@${url}/live`;
}

// ── Internal yt-dlp helpers ───────────────────────────────────────────────────

/**
 * yt-dlp with the tv_embedded player client.
 *
 * The TV embedded client (used by Chromecast, Smart TVs, etc.) does NOT
 * require a Proof-of-Origin Token (rqh parameter). The HLS manifest URL it
 * returns is served by YouTube CDN without any cookie or token validation —
 * making it the best no-auth option for both live streams and VODs.
 *
 * Confirmed working June 2025 for public channels without cookies.
 */
function ytdlpTvEmbedded(pageUrl: string, format: string, getLive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "--no-playlist",
      "-f", format,
      "--get-url",
      "--no-check-certificate",
      "--socket-timeout", "15",
      "--extractor-args", "youtube:player_client=tv_embedded",
      "--add-header", "Accept-Language:en-US,en;q=0.9",
    ];
    if (getLive) args.push("--no-live-from-start");
    args.push(pageUrl);

    const proc = spawn("yt-dlp", args);
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new Error("TIMEOUT"));
    }, 30_000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const lines = stdout.trim().split("\n").filter((l) => l.startsWith("http"));
      if (code === 0 && lines[0]) {
        resolve(lines[0]);
      } else {
        const friendly = humaniseYtdlpError(stderr.trim(), `tv_embedded: no URL (exit ${code})`);
        reject(new Error(friendly));
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new Error(err.code === "ENOENT"
        ? "yt-dlp is not installed. Install with: pip install yt-dlp"
        : `spawn: ${err.message}`
      ));
    });
  });
}

/**
 * yt-dlp with a specific player_client (mweb, ios, android, etc.)
 * Used as fallback after tv_embedded and streamlink.
 */
function ytdlpWithClient(pageUrl: string, playerClient: string, format: string, getLive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "--no-playlist",
      "-f", format,
      "--get-url",
      "--no-check-certificate",
      "--socket-timeout", "15",
      "--extractor-args", `youtube:player_client=${playerClient}`,
      "--add-header", "Accept-Language:en-US,en;q=0.9",
      ...getCookiesArgs(),
    ];
    if (getLive) args.push("--no-live-from-start");
    args.push(pageUrl);

    const proc = spawn("yt-dlp", args);
    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new Error("TIMEOUT"));
    }, 30_000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const lines = stdout.trim().split("\n").filter((l) => l.startsWith("http"));
      if (code === 0 && lines[0]) {
        resolve(lines[0]);
      } else {
        reject(new Error(humaniseYtdlpError(
          stderr.trim(),
          `yt-dlp (${playerClient}): Could not get YouTube stream URL.`,
        )));
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new Error(err.code === "ENOENT"
        ? "yt-dlp is not installed. Install with: pip install yt-dlp"
        : `spawn: ${err.message}`
      ));
    });
  });
}

/**
 * Attempt 1 — streamlink.
 * No bot detection, no PO Token requirement.
 * Confirmed working June 2025 for public YouTube live channels.
 */
function streamlinkGetYouTubeUrl(pageUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("streamlink", [
      "--stream-url",
      "--http-timeout", "20",
      "--http-header", "User-Agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "--http-header", "Accept-Language=en-US,en;q=0.9",
      pageUrl,
      "best",
    ]);

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new Error("TIMEOUT"));
    }, 35_000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const url = stdout.trim().split("\n").find((l) => l.startsWith("http"));
      if (code === 0 && url) {
        resolve(url);
      } else {
        const errText = stderr.trim();
        const lower = errText.toLowerCase();
        if (lower.includes("no playable streams") || lower.includes("no streams") || lower.includes("not currently live")) {
          reject(new Error("NOT_LIVE"));
        } else {
          reject(new Error(errText ? `streamlink: ${errText.slice(0, 300)}` : "STREAMLINK_FAIL"));
        }
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new Error(err.code === "ENOENT" ? "ENOENT_STREAMLINK" : `spawn: ${err.message}`));
    });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Main YouTube live URL resolver — cookie-free by design.
 *
 * 4-tier fallback chain (fastest / most reliable first):
 *   1. streamlink          — no bot detection, no POT requirement
 *   2. yt-dlp tv_embedded  — TV embedded client, no rqh/POT in URL (NEW primary)
 *   3. yt-dlp mweb         — mobile web, works for many channels
 *   4. yt-dlp ios+android  — last resort (may include rqh if channel requires it)
 *
 * The tv_embedded client is the key improvement: it returns an HLS manifest
 * URL without the rqh= Proof-of-Origin Token, so FFmpeg can read segments
 * directly from YouTube CDN without any browser cookies.
 */
export async function getYouTubeStreamUrl(input: string): Promise<string> {
  const pageUrl = normaliseYouTubeUrl(input);

  // ── Attempt 1: streamlink ─────────────────────────────────────────────────
  try {
    const url = await streamlinkGetYouTubeUrl(pageUrl);
    return url;
  } catch (e: any) {
    const msg: string = e.message || "";
    if (msg === "NOT_LIVE") {
      throw new Error("The YouTube channel does not appear to be live right now. Double-check the username/URL and try again.");
    }
    // ENOENT or other failure — fall through silently to yt-dlp
  }

  // ── Attempt 2: yt-dlp tv_embedded (no PO Token required — cookie-free) ───
  try {
    return await ytdlpTvEmbedded(pageUrl, "b[protocol^=m3u8]/b[ext=mp4]/b", true);
  } catch (e: any) {
    const msg: string = e.message || "";
    if (msg === "NOT_LIVE" || msg.includes("not currently live")) {
      throw new Error("The YouTube channel does not appear to be live right now. Double-check the username/URL and try again.");
    }
    if (msg.includes("private") || msg.includes("age-restricted")) {
      throw new Error(msg);
    }
    // other failure — fall through
  }

  // ── Attempt 3: yt-dlp mweb ───────────────────────────────────────────────
  try {
    return await ytdlpWithClient(pageUrl, "mweb", "b[protocol^=m3u8]/b[ext=mp4]/b", true);
  } catch (e: any) {
    const msg: string = e.message || "";
    if (msg.includes("not live") || msg === "NOT_LIVE") {
      throw new Error("The YouTube channel does not appear to be live right now. Double-check the username/URL and try again.");
    }
    // other failure — fall through
  }

  // ── Attempt 4: yt-dlp ios+android (last resort) ──────────────────────────
  const clientList = getCookiesConfigured()
    ? "ios,mweb,web_creator,android,web"
    : "ios,mweb,android";

  try {
    return await ytdlpWithClient(pageUrl, clientList, "b[protocol^=m3u8]/b[ext=mp4]/b", true);
  } catch (e: any) {
    throw new Error(e.message || "Could not get YouTube stream URL. Is the channel live and publicly accessible?");
  }
}

/**
 * Gets the direct CDN video URL for a YouTube VOD (not a live stream).
 * Uses --get-url so there is NO download — the URL is passed straight to FFmpeg.
 *
 * Tries tv_embedded first (no POT, no cookies required).
 * Falls back to mweb/ios if tv_embedded cannot find a single muxed format.
 *
 * We request format "18" first — YouTube's 360p muxed H.264+AAC mp4.
 * For the break video overlay 360p is more than sufficient.
 */
export async function getYouTubeVideoDirectUrl(input: string): Promise<string> {
  const url = input.trim();

  // ── Try tv_embedded first (no cookie / no POT required) ──────────────────
  try {
    return await ytdlpTvEmbedded(
      url,
      "18/b[height<=480][ext=mp4]/b[height<=720][ext=mp4]/worst[ext=mp4]/worst",
      false,
    );
  } catch {
    // fall through to mweb
  }

  // ── Fallback: mweb client ─────────────────────────────────────────────────
  const playerClients = getCookiesConfigured()
    ? "ios,mweb,web_creator,android,web"
    : "mweb,android";

  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", [
      "--no-playlist",
      "-f", "18/b[height<=480][ext=mp4]/worst[ext=mp4]/worst",
      "--get-url",
      "--no-check-certificate",
      "--socket-timeout", "20",
      "--extractor-args", `youtube:player_client=${playerClients}`,
      "--add-header", "Accept-Language:en-US,en;q=0.9",
      ...getCookiesArgs(),
      url,
    ]);

    let stdout = "";
    let stderr = "";
    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new Error("Timeout getting YouTube video URL (20s)."));
    }, 20000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const lines = stdout.trim().split("\n").filter((l) => l.startsWith("http"));
      if (code === 0 && lines.length === 1) {
        resolve(lines[0]);
      } else if (code === 0 && lines.length > 1) {
        reject(new Error("YouTube returned separate DASH streams — falling back to download."));
      } else {
        reject(new Error(humaniseYtdlpError(stderr.trim(), "Could not get direct URL from YouTube.")));
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(err.code === "ENOENT"
        ? new Error("yt-dlp is not installed. Install with: pip install yt-dlp")
        : err
      );
    });
  });
}

/**
 * Downloads a YouTube (or any yt-dlp-supported) video to a local temp mp4.
 * Used as last resort when direct-URL approach fails (DASH streams, etc.).
 * Results are cached per URL (file is re-used on repeated calls).
 */
export async function downloadYouTubeVideoToTemp(
  input: string,
  onProgress?: (msg: string) => void,
): Promise<string> {
  const url = input.trim();

  const cached = ytDownloadCache.get(url);
  if (cached && fs.existsSync(cached)) {
    onProgress?.("Using cached download — starting playback immediately");
    return cached;
  }

  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  const destPath = path.join(uploadsDir, `break_yt_${Date.now()}.mp4`);

  // Try tv_embedded first (no cookies required), fall back to ios/mweb
  const playerClients = getCookiesConfigured()
    ? "tv_embedded,ios,mweb,web_creator,android,web"
    : "tv_embedded,ios,mweb,android";

  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", [
      "--no-playlist",
      "-f", "b[height<=720][ext=mp4]/b[height<=480][ext=mp4]/b[height<=720]/b[height<=480]/b",
      "--merge-output-format", "mp4",
      "--no-check-certificate",
      "--socket-timeout", "30",
      "--extractor-args", `youtube:player_client=${playerClients}`,
      "--add-header", "Accept-Language:en-US,en;q=0.9",
      ...getCookiesArgs(),
      "-o", destPath,
      url,
    ]);

    let stderrBuf = "";
    proc.stderr?.on("data", (d: Buffer) => {
      const line = d.toString();
      stderrBuf += line;
      const trimmed = line.trim();
      if (onProgress && trimmed && (
        trimmed.startsWith("[download]") ||
        trimmed.startsWith("[Merger]") ||
        trimmed.startsWith("[ffmpeg]")
      )) {
        onProgress(trimmed.slice(0, 120));
      }
    });

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      try { fs.unlinkSync(destPath); } catch {}
      reject(new Error("Download timed out after 120 seconds. Try a shorter video or upload the file instead."));
    }, 120000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(destPath)) {
        ytDownloadCache.set(url, destPath);
        resolve(destPath);
      } else {
        try { fs.unlinkSync(destPath); } catch {}
        reject(new Error(humaniseYtdlpError(
          stderrBuf.trim(),
          `yt-dlp could not download the video (exit ${code}). Is the video public?`,
        )));
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new Error("yt-dlp is not installed. Install with: pip install yt-dlp"));
      } else {
        reject(err);
      }
    });
  });
}
