import { spawn } from "child_process";
import { logger } from "./lib/logger";
import fs from "fs";
import path from "path";

export interface TikTokStreamInfo {
  roomId: string;
  isLive: boolean;
  title?: string;
  flvUrls: { hd?: string; sd?: string; ld?: string };
  hlsUrl?: string;
}

const TIKTOK_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Returns --cookies args for yt-dlp if a tiktok-cookies.txt has been uploaded */
function getTikTokYtdlpCookiesArgs(): string[] {
  const p = path.join(process.cwd(), "tiktok-cookies.txt");
  return fs.existsSync(p) ? ["--cookies", p] : [];
}

/** Returns --http-cookie-jar arg for streamlink if a tiktok-cookies.txt has been uploaded */
function getTikTokStreamlinkCookiesArgs(): string[] {
  const p = path.join(process.cwd(), "tiktok-cookies.txt");
  return fs.existsSync(p) ? ["--http-cookie-jar", p] : [];
}

export function getTikTokCookiesConfigured(): boolean {
  return fs.existsSync(path.join(process.cwd(), "tiktok-cookies.txt"));
}

function qualityArg(quality: string): string {
  if (quality === "720p") return "720p,best";
  if (quality === "480p") return "480p,best";
  return "best";
}

function streamlinkGetUrl(username: string, quality: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("streamlink", [
      "--stream-url",
      "--http-header", `User-Agent=${TIKTOK_UA}`,
      "--http-header", "Referer=https://www.tiktok.com/",
      "--http-header", "Accept-Language=en-US,en;q=0.9",
      "--http-timeout", "20",
      ...getTikTokStreamlinkCookiesArgs(),
      `https://www.tiktok.com/@${username}/live`,
      qualityArg(quality),
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
        // NOTE: "No playable streams found" from streamlink is NOT a reliable
        // NOT_LIVE signal for TikTok — TikTok's bot protection fires this same
        // error even when the user IS live. Fall through to yt-dlp in all cases.
        reject(new Error(errText ? `streamlink: ${errText.slice(0, 300)}` : "STREAMLINK_FAIL"));
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new Error(err.code === "ENOENT" ? "ENOENT_STREAMLINK" : `spawn: ${err.message}`));
    });
  });
}

function ytdlpGetUrl(username: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", [
      "--get-url",
      "--no-check-certificates",
      "--no-playlist",
      "--no-warnings",
      "--quiet",
      "-f", "best",
      ...getTikTokYtdlpCookiesArgs(),
      `https://www.tiktok.com/@${username}/live`,
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
        // Covers all known yt-dlp TikTok "not live" phrasings:
        //   "The channel is not currently live"  (tiktok:live extractor)
        //   "is not live" / "not currently live" / "not live streaming"
        const isNotLive =
          lower.includes("is not live") ||
          lower.includes("not currently live") ||
          lower.includes("not live streaming") ||
          lower.includes("not currently streaming") ||
          lower.includes("live stream has ended") ||
          lower.includes("channel is not currently");
        if (isNotLive) {
          reject(new Error("NOT_LIVE"));
        } else {
          reject(new Error(errText ? `yt-dlp: ${errText.slice(0, 300)}` : "YTDLP_FAIL"));
        }
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(new Error(err.code === "ENOENT" ? "ENOENT_YTDLP" : `spawn: ${err.message}`));
    });
  });
}

export async function getTikTokStreamUrl(rawUsername: string, quality: string): Promise<string> {
  const username = rawUsername.replace(/^@+/, "").trim();

  let streamlinkError: string | null = null;

  // ── Attempt 1: streamlink ─────────────────────────────────────────────────
  try {
    const url = await streamlinkGetUrl(username, quality);
    logger.info({ username }, "TikTok URL resolved via streamlink");
    return url;
  } catch (e: any) {
    const msg: string = e.message || "";

    if (msg === "NOT_LIVE") {
      throw new Error(`@${username} does not appear to be live right now. Double-check the username and try again.`);
    }

    if (msg === "ENOENT_STREAMLINK") {
      streamlinkError = "streamlink not installed";
    } else {
      streamlinkError = msg;
      logger.warn({ username, err: msg }, "streamlink failed — falling back to yt-dlp");
    }
  }

  // ── Attempt 2: yt-dlp fallback ────────────────────────────────────────────
  try {
    const url = await ytdlpGetUrl(username);
    logger.info({ username }, "TikTok URL resolved via yt-dlp (fallback)");
    return url;
  } catch (e: any) {
    const msg: string = e.message || "";

    if (msg === "NOT_LIVE") {
      throw new Error(`@${username} does not appear to be live right now. Double-check the username and try again.`);
    }

    if (msg === "ENOENT_YTDLP") {
      if (streamlinkError === "streamlink not installed") {
        throw new Error(
          "Neither streamlink nor yt-dlp is installed. Install one with: pip install streamlink  or  pip install yt-dlp"
        );
      }
      // streamlink was installed but failed; yt-dlp not available
      throw new Error(
        `Could not get stream for @${username} (streamlink failed: ${streamlinkError?.slice(0, 150)}). ` +
        `Install yt-dlp as a fallback: pip install yt-dlp`
      );
    }

    logger.warn({ username, ytdlpErr: msg, streamlinkErr: streamlinkError }, "Both extractors failed");
    throw new Error(
      `Could not get TikTok stream for @${username}. Make sure the account is currently live. ` +
      `(streamlink: ${streamlinkError?.slice(0, 100) ?? "not tried"} | yt-dlp: ${msg.slice(0, 100)})`
    );
  }
}

export async function getTikTokStreamInfo(rawUsername: string): Promise<TikTokStreamInfo> {
  const url = await getTikTokStreamUrl(rawUsername, "best");
  const isHls = url.includes(".m3u8");
  return {
    roomId: "streamlink",
    isLive: true,
    flvUrls: isHls ? {} : { hd: url },
    hlsUrl: isHls ? url : undefined,
  };
}

export function pickBestUrl(info: TikTokStreamInfo, _quality: string): string {
  if (info.hlsUrl) return info.hlsUrl;
  const { flvUrls } = info;
  return flvUrls.hd || flvUrls.sd || flvUrls.ld || "";
}
