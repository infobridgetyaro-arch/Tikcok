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

async function fetchYouTubeLiveCount(channelId: string): Promise<string | null> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;

  try {
    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&type=video&eventType=live&key=${apiKey}`
    );
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();

    if (!searchData.items || searchData.items.length === 0) {
      const channelRes = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(channelId)}&key=${apiKey}`
      );
      if (!channelRes.ok) return null;
      const channelData = await channelRes.json();
      if (channelData.items?.[0]?.statistics?.subscriberCount) {
        const subCount = parseInt(channelData.items[0].statistics.subscriberCount);
        return `${formatCount(subCount)} Subscribers`;
      }
      return null;
    }

    const videoId = searchData.items[0].id.videoId;
    const videoRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails,statistics&id=${videoId}&key=${apiKey}`
    );
    if (!videoRes.ok) return null;
    const videoData = await videoRes.json();

    const item = videoData.items?.[0];
    if (item?.liveStreamingDetails?.concurrentViewers) {
      const viewers = parseInt(item.liveStreamingDetails.concurrentViewers);
      return `${formatCount(viewers)} watching`;
    }
    if (item?.statistics?.viewCount) {
      const views = parseInt(item.statistics.viewCount);
      return `${formatCount(views)} views`;
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
    headline = cached.count;
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

      const count = await fetchYouTubeLiveCount(stream.youtubeChannelId);
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
