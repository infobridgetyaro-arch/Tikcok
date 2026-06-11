import fs from "fs";
import path from "path";
import { storage } from "./storage";

const tmpDir = path.join(process.cwd(), "tmp_overlay");
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const liveCountCache = new Map<string, { count: string; lastFetch: number }>();
let pollingInterval: NodeJS.Timeout | null = null;

function formatCount(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}

async function fetchYouTubeSubscriberCount(channelId: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(channelId)}&key=${apiKey}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const subCount = data.items?.[0]?.statistics?.subscriberCount;
    if (subCount !== undefined) {
      return formatCount(parseInt(subCount, 10));
    }
    return null;
  } catch {
    return null;
  }
}

export function getHeadlineTextFilePath(streamId: string): string {
  return path.join(tmpDir, `headline_${streamId}.txt`);
}

export function getTickerTextFilePath(streamId: string): string {
  return path.join(tmpDir, `ticker_${streamId}.txt`);
}

export function cleanupOverlayFiles(streamId: string) {
  const headlinePath = getHeadlineTextFilePath(streamId);
  const tickerPath = getTickerTextFilePath(streamId);
  try { if (fs.existsSync(headlinePath)) fs.unlinkSync(headlinePath); } catch {}
  try { if (fs.existsSync(tickerPath)) fs.unlinkSync(tickerPath); } catch {}
}

export function writeOverlayTextFiles(streamId: string) {
  const stream = storage.getStream(streamId);
  if (!stream) return;

  const headlinePath = getHeadlineTextFilePath(streamId);
  const tickerPath = getTickerTextFilePath(streamId);

  let headline = stream.overlayHeadline || "";
  const cached = liveCountCache.get(streamId);
  if (stream.overlayLiveCount && cached?.count) {
    headline = `${cached.count} Subscribers`;
  }
  fs.writeFileSync(headlinePath, headline, "utf-8");
  fs.writeFileSync(tickerPath, stream.overlayTickerText || "", "utf-8");
}

export function cleanupTextFiles(streamId: string) {
  try { fs.unlinkSync(getHeadlineTextFilePath(streamId)); } catch {}
  try { fs.unlinkSync(getTickerTextFilePath(streamId)); } catch {}
}

async function pollLiveCounts() {
  const streams = storage.getStreams();
  for (const stream of streams) {
    if (
      stream.status === "streaming" &&
      stream.overlayEnabled &&
      stream.overlayLiveCount &&
      stream.youtubeChannelId
    ) {
      const cached = liveCountCache.get(stream.id);
      const now = Date.now();
      if (cached && now - cached.lastFetch < 25000) continue;

      const count = await fetchYouTubeSubscriberCount(stream.youtubeChannelId);
      if (count) {
        liveCountCache.set(stream.id, { count, lastFetch: now });
        writeOverlayTextFiles(stream.id);
      }
    }
  }
}

export function startLiveCountPolling() {
  if (pollingInterval) return;
  pollingInterval = setInterval(pollLiveCounts, 30000);
  pollLiveCounts();
}

export function stopLiveCountPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

export function getLiveCount(streamId: string): string | null {
  return liveCountCache.get(streamId)?.count || null;
}
