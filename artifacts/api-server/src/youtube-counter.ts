import fs from "fs";
import path from "path";
import { storage } from "./storage";

const tmpDir = path.join(process.cwd(), "tmp_overlay");
if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

const liveCountCache = new Map<string, { subs: string; viewers: string; lastFetch: number }>();
const liveChatIdCache = new Map<string, { chatId: string; nextPageToken: string | null; messages: ChatMessage[]; lastFetch: number }>();
let pollingInterval: NodeJS.Timeout | null = null;

export interface ChatMessage {
  id: string;
  authorName: string;
  message: string;
  type: string;
}

function formatCount(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(num);
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

async function fetchYouTubeStats(channelId: string): Promise<{ subs: string | null; viewers: string | null; videoId: string | null }> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return { subs: null, viewers: null, videoId: null };

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
    let videoId: string | null = null;
    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=id&channelId=${encodeURIComponent(channelId)}&eventType=live&type=video&key=${apiKey}`
    );
    if (searchRes.ok) {
      const searchData = await searchRes.json() as any;
      videoId = searchData.items?.[0]?.id?.videoId ?? null;
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

    return { subs, viewers, videoId };
  } catch {
    return { subs: null, viewers: null, videoId: null };
  }
}

async function fetchLiveChatId(videoId: string, apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}&key=${apiKey}`
    );
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data.items?.[0]?.liveStreamingDetails?.activeLiveChatId ?? null;
  } catch {
    return null;
  }
}

async function fetchChatMessages(chatId: string, pageToken: string | null, apiKey: string): Promise<{ messages: ChatMessage[]; nextPageToken: string | null }> {
  try {
    let url = `https://www.googleapis.com/youtube/v3/liveChatMessages?part=snippet,authorDetails&liveChatId=${encodeURIComponent(chatId)}&key=${apiKey}&maxResults=50`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    const res = await fetch(url);
    if (!res.ok) return { messages: [], nextPageToken: null };
    const data = await res.json() as any;
    const messages: ChatMessage[] = (data.items || []).map((item: any) => ({
      id: item.id,
      authorName: truncate(item.authorDetails?.displayName || "Viewer", 20),
      message: truncate(item.snippet?.displayMessage || "", 60),
      type: item.snippet?.type || "textMessageEvent",
    }));
    return { messages, nextPageToken: data.nextPageToken ?? null };
  } catch {
    return { messages: [], nextPageToken: null };
  }
}

// ── Text-file path helpers ──────────────────────────────────────────────────

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
export function getChatTextFilePath(streamId: string, index: number): string {
  return path.join(tmpDir, `chat_${index}_${streamId}.txt`);
}

// ── Write helpers ──────────────────────────────────────────────────────────

function safeWrite(filePath: string, content: string) {
  try { fs.writeFileSync(filePath, content, "utf-8"); } catch {}
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

export function writeChatTextFiles(streamId: string) {
  const stream = storage.getStream(streamId);
  if (!stream) return;
  const chatData = liveChatIdCache.get(streamId);
  const maxMsgs = Math.min((stream as any).chatMaxMessages || 5, 10);
  const messages = chatData?.messages ?? [];

  for (let i = 0; i < maxMsgs; i++) {
    const msg = messages[messages.length - 1 - i];
    const line = msg ? `${msg.authorName}: ${msg.message}` : "";
    safeWrite(getChatTextFilePath(streamId, i), line);
  }
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
  for (let i = 0; i < 10; i++) paths.push(getChatTextFilePath(streamId, i));
  paths.forEach((p) => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {} });
}

export function cleanupTextFiles(streamId: string) {
  cleanupOverlayFiles(streamId);
  liveCountCache.delete(streamId);
  liveChatIdCache.delete(streamId);
}

// ── Live polling ────────────────────────────────────────────────────────────

async function pollOnce(stream: any) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return;

  const needsCount = stream.overlayLiveCount || stream.subBoxEnabled;
  const needsChat = stream.chatEnabled || stream.subBoxStyle === "recent-activity";

  if (needsCount) {
    const cached = liveCountCache.get(stream.id);
    const now = Date.now();
    if (!cached || now - cached.lastFetch >= 28000) {
      const { subs, viewers, videoId } = await fetchYouTubeStats(stream.youtubeChannelId);
      if (subs || viewers) {
        liveCountCache.set(stream.id, {
          subs: subs || cached?.subs || "—",
          viewers: viewers || cached?.viewers || "—",
          lastFetch: now,
        });
        writeOverlayTextFiles(stream.id);
      }

      // Also grab live chat ID using the videoId we just fetched
      if (videoId && needsChat) {
        let chatEntry = liveChatIdCache.get(stream.id);
        if (!chatEntry || !chatEntry.chatId) {
          const chatId = await fetchLiveChatId(videoId, apiKey);
          if (chatId) {
            liveChatIdCache.set(stream.id, {
              chatId,
              nextPageToken: null,
              messages: chatEntry?.messages ?? [],
              lastFetch: 0,
            });
          }
        }
      }
    }
  }

  if (needsChat) {
    const chatEntry = liveChatIdCache.get(stream.id);
    if (!chatEntry?.chatId) return;
    const now = Date.now();
    if (now - (chatEntry.lastFetch || 0) < 8000) return; // poll chat every 8s
    const { messages: newMsgs, nextPageToken } = await fetchChatMessages(chatEntry.chatId, chatEntry.nextPageToken, apiKey);
    const allMessages = [...chatEntry.messages, ...newMsgs].slice(-50);
    liveChatIdCache.set(stream.id, { ...chatEntry, messages: allMessages, nextPageToken, lastFetch: now });
    writeChatTextFiles(stream.id);
  }
}

async function pollLiveCounts() {
  const streams = storage.getStreams();
  for (const stream of streams) {
    if (
      stream.status === "streaming" &&
      stream.overlayEnabled &&
      stream.youtubeChannelId &&
      (stream.overlayLiveCount || (stream as any).subBoxEnabled || (stream as any).chatEnabled || (stream as any).subBoxStyle === "recent-activity")
    ) {
      pollOnce(stream).catch(() => {});
    }
  }
}

export function startLiveCountPolling() {
  if (pollingInterval) return;
  pollingInterval = setInterval(pollLiveCounts, 9000);
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
export function getRecentChatMessages(streamId: string, max = 5): ChatMessage[] {
  const entry = liveChatIdCache.get(streamId);
  if (!entry) return [];
  return entry.messages.slice(-max).reverse();
}
