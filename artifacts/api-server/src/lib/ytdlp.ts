import { existsSync, mkdirSync, chmodSync } from "fs";
import { exec } from "child_process";
import { logger } from "./logger";

const LOCAL_BIN = "/home/runner/workspace/.local/bin/yt-dlp";
const REQUIRED_VERSION = "2026.06.09";
const DOWNLOAD_URL = `https://github.com/yt-dlp/yt-dlp/releases/download/${REQUIRED_VERSION}/yt-dlp`;

/**
 * Resolved path to the yt-dlp binary.
 * Prefers the locally managed binary in .local/bin, then YTDLP_BIN env var,
 * then the system yt-dlp as last resort.
 */
export const YTDLP_BIN: string =
  process.env.YTDLP_BIN ??
  (existsSync(LOCAL_BIN) ? LOCAL_BIN : "yt-dlp");

function getVersionString(bin: string): Promise<string> {
  return new Promise((resolve) => {
    exec(`"${bin}" --version`, { timeout: 10_000 }, (_err, stdout) => {
      resolve(stdout.trim());
    });
  });
}

function versionToNumber(v: string): number {
  // "2026.06.09" → 20260609
  return parseInt(v.replace(/\./g, ""), 10) || 0;
}

async function downloadBin(): Promise<void> {
  mkdirSync("/home/runner/workspace/.local/bin", { recursive: true });
  logger.info({ url: DOWNLOAD_URL }, "[ytdlp] Downloading updated binary...");
  await new Promise<void>((resolve, reject) => {
    exec(
      `curl -fsSL "${DOWNLOAD_URL}" -o "${LOCAL_BIN}" && chmod +x "${LOCAL_BIN}"`,
      { timeout: 120_000 },
      (err) => { err ? reject(err) : resolve(); },
    );
  });
  const v = await getVersionString(LOCAL_BIN).catch(() => "?");
  logger.info({ version: v }, "[ytdlp] Binary updated successfully");
}

/**
 * Called once at server startup.
 * Ensures LOCAL_BIN exists and is >= REQUIRED_VERSION.
 * Downloads the required binary if missing or outdated.
 */
export async function ensureYtdlpVersion(): Promise<void> {
  try {
    if (existsSync(LOCAL_BIN)) {
      const current = await getVersionString(LOCAL_BIN);
      if (versionToNumber(current) >= versionToNumber(REQUIRED_VERSION)) {
        logger.info({ version: current, path: LOCAL_BIN }, "[ytdlp] Binary is current — no update needed");
        return;
      }
      logger.warn({ current, required: REQUIRED_VERSION }, "[ytdlp] Binary is outdated — updating");
    } else {
      logger.info({ path: LOCAL_BIN }, "[ytdlp] Binary not found — downloading");
    }
    await downloadBin();
  } catch (err: any) {
    logger.error({ err: err.message }, "[ytdlp] Auto-update failed — falling back to system yt-dlp");
  }
}
