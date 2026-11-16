const TELEGRAM_RTMP_HOST = /(^|\.)rtmp\.t\.me$/i;
const TELEGRAM_STREAM_KEY = /^[A-Za-z0-9:_-]{1,512}$/;

/**
 * Builds a Telegram RTMPS destination from the server URL and stream key
 * shown in Telegram's channel streaming settings.
 *
 * Telegram stream keys are credentials: callers must not log the returned URL.
 */
export function buildTelegramRtmpUrl(
  serverUrl: string | null | undefined,
  streamKey: string | null | undefined,
): string | null {
  const rawServerUrl = (serverUrl ?? "").trim();
  const key = (streamKey ?? "").trim();

  if (!rawServerUrl && !key) return null;
  if (!rawServerUrl || !key) {
    throw new Error("Telegram needs both the RTMPS server URL and stream key.");
  }
  if (!TELEGRAM_STREAM_KEY.test(key)) {
    throw new Error("Telegram stream key contains unsupported characters.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawServerUrl);
  } catch {
    throw new Error("Enter a valid Telegram RTMPS server URL.");
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  const isTelegramHost =
    parsed.hostname === "rtmp.t.me" || TELEGRAM_RTMP_HOST.test(parsed.hostname);
  if (
    parsed.protocol !== "rtmps:" ||
    !isTelegramHost ||
    (parsed.port !== "" && parsed.port !== "443") ||
    path !== "/s"
  ) {
    throw new Error(
      "Use the RTMPS server URL from Telegram channel streaming settings.",
    );
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Telegram server URL must not contain credentials or query parameters.");
  }

  return `${parsed.protocol}//${parsed.host}/s/${key}`;
}
