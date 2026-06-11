import fs from "fs";
import path from "path";
import { storage } from "./storage";

const tmpDir = path.join(process.cwd(), "tmp_overlay");
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const liveCountCache = new Map<string, { subs: string; viewers: string; lastFetch: number }>();
let pollingInterval: NodeJS.Timeout | null = null;

function formatCount(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}

async function fetchYouTubeStats(channelId: string): Promise<{ subs: string | null; viewers: string | null }> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return { subs: null, viewers: null };

  try {
    const chanRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(channelId)}&key=${apiKey}`
    );
    let subs: string | null = null;
    if (chanRes.ok) {
      const data = await chanRes.json() as any;
      const subCount = data.items?.[0]?.statistics?.subscriberCount;
      if (subCount !== undefined) subs = formatCount(parseInt(subCount, 10));
    }

    let viewers: string | null = null;
    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=id&channelId=${encodeURIComponent(channelId)}&eventType=live&type=video&key=${apiKey}`
    );
    if (searchRes.ok) {
      const searchData = await searchRes.json() as any;
      const videoId = searchData.items?.[0]?.id?.videoId;
      if (videoId) {
        const vidRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}&key=${apiKey}`
        );
        if (vidRes.ok) {
          const vidData = await vidRes.json() as any;
          const concurrent = vidData.items?.[0]?.liveStreamingDetails?.concurrentViewers;
          if (concurrent !== undefined) viewers = formatCount(parseInt(concurrent, 10));
        }
      }
    }

    return { subs, viewers };
  } catch {
    return { subs: null, viewers: null };
  }
}

export function getHeadlineTextFilePath(streamId: string): string {
  return path.join(tmpDir, `headline_${streamId}.txt`);
}

export function getTickerTextFilePath(streamId: string): string {
  return path.join(tmpDir, `ticker_${streamId}.txt`);
}

export function getLtNameTextFilePath(streamId: string): string {
  return path.join(tmpDir, `ltname_${streamId}.txt`);
}

export function getLtTitleTextFilePath(streamId: string): string {
  return path.join(tmpDir, `lttitle_${streamId}.txt`);
}

export function getMessageTextFilePath(streamId: string): string {
  return path.join(tmpDir, `message_${streamId}.txt`);
}

export function getSubBoxTextFilePath(streamId: string): string {
  return path.join(tmpDir, `subbox_${streamId}.txt`);
}

export function getViewerBoxTextFilePath(streamId: string): string {
  return path.join(tmpDir, `viewerbox_${streamId}.txt`);
}

export function cleanupOverlayFiles(streamId: string) {
  const paths = [
    getHeadlineTextFilePath(streamId),
    getTickerTextFilePath(streamId),
    getLtNameTextFilePath(streamId),
    getLtTitleTextFilePath(streamId),
    getMessageTextFilePath(streamId),
    getSubBoxTextFilePath(streamId),
    getViewerBoxTextFilePath(streamId),
  ];
  paths.forEach((p) => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
}

export function writeOverlayTextFiles(streamId: string) {
  const stream = storage.getStream(streamId);
  if (!stream) return;

  const cached = liveCountCache.get(streamId);

  let headline = (stream as any).overlayHeadline || "";
  if (stream.overlayLiveCount && cached?.subs) {
    headline = `${cached.subs} Subscribers`;
  }
  safeWrite(getHeadlineTextFilePath(streamId), headline);
  safeWrite(getTickerTextFilePath(streamId), (stream as any).overlayTickerText || "");
  safeWrite(getLtNameTextFilePath(streamId), (stream as any).lowerThirdName || "");
  safeWrite(getLtTitleTextFilePath(streamId), (stream as any).lowerThirdTitle || "");
  safeWrite(getMessageTextFilePath(streamId), (stream as any).messageText || "");

  const subDisplay = cached?.subs
    ? ((stream as any).subBoxShowViewers && cached.viewers
        ? `${cached.subs} SUBS  |  ${cached.viewers} WATCHING`
        : `${cached.subs} SUBSCRIBERS`)
    : "— SUBSCRIBERS";
  safeWrite(getSubBoxTextFilePath(streamId), subDisplay);
  safeWrite(getViewerBoxTextFilePath(streamId), cached?.viewers || "—");
}

function safeWrite(filePath: string, content: string) {
  try { fs.writeFileSync(filePath, content, "utf-8"); } catch {}
}

export function cleanupTextFiles(streamId: string) {
  cleanupOverlayFiles(streamId);
}

async function pollLiveCounts() {
  const streams = storage.getStreams();
  for (const stream of streams) {
    if (
      stream.status === "streaming" &&
      stream.overlayEnabled &&
      stream.youtubeChannelId &&
      (stream.overlayLiveCount || (stream as any).subBoxEnabled)
    ) {
      const cached = liveCountCache.get(stream.id);
      const now = Date.now();
      if (cached && now - cached.lastFetch < 25000) continue;

      const { subs, viewers } = await fetchYouTubeStats(stream.youtubeChannelId);
      if (subs || viewers) {
        liveCountCache.set(stream.id, {
          subs: subs || cached?.subs || "—",
          viewers: viewers || cached?.viewers || "—",
          lastFetch: now,
        });
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
  return liveCountCache.get(streamId)?.subs || null;
}

export function getLiveViewerCount(streamId: string): string | null {
  return liveCountCache.get(streamId)?.viewers || null;
}
