import { existsSync } from "fs";

const LOCAL_BIN = "/home/runner/workspace/.local/bin/yt-dlp";

/**
 * Resolved path to the yt-dlp binary.
 * Prefers the pip-installed newer binary in .local/bin if it exists,
 * then falls back to YTDLP_BIN env var, then the system "yt-dlp".
 */
export const YTDLP_BIN: string =
  process.env.YTDLP_BIN ??
  (existsSync(LOCAL_BIN) ? LOCAL_BIN : "yt-dlp");
