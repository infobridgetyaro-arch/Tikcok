import { storage } from "./storage";
import { broadcastStream, updateStreamOverlays } from "./stream-manager";
import { logger } from "./lib/logger";

interface ChannelStats {
  subs: string | null;
  viewers: string | null;
  liveChatId: string | null;
  lastFetch: number;
}

interface ChatMessage {
  id: string;
  authorName: string;
  authorPhoto: string;
  text: string;
  publishedAt: string;
  isMember: boolean;
  isModerator: boolean;
  isOwner: boolean;
  superChatAmount: string | null;
}

const statsCache = new Map<string, ChannelStats>();
const chatPageTokens = new Map<string, string | null>();

// Rolling sub chart data: up to 60 samples (1 per minute poll)
const subChartData: number[] = [];
const MAX_CHART_SAMPLES = 60;

// Chat result cache — prevents rapid API calls from hanging when the control
// room chat panel and the polling interval overlap.
interface ChatCache { messages: ChatMessage[]; fetchedAt: number }
const chatResultCache = new Map<string, ChatCache>();
const CHAT_CACHE_TTL = 12_000; // return cached results for 12 s

let pollingInterval: NodeJS.Timeout | null = null;
let chatInterval: NodeJS.Timeout | null = null;
let statsPolling = false;
let chatPolling = false;

const FETCH_TIMEOUT_MS = 8000;

function formatCount(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

async function fetchChannelStats(channelId: string): Promise<ChannelStats> {
  const apiKey = process.env.GOOGLE_API_KEY;
  const prev = statsCache.get(channelId);

  if (!apiKey) return { subs: null, viewers: null, liveChatId: null, lastFetch: Date.now() };

  let subs: string | null = prev?.subs ?? null;
  let viewers: string | null = prev?.viewers ?? null;
  let liveChatId: string | null = prev?.liveChatId ?? null;

  try {
    const chanRes = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(channelId)}&key=${apiKey}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    if (chanRes.ok) {
      const data = await chanRes.json() as any;
      const subCount = data.items?.[0]?.statistics?.subscriberCount;
      if (subCount !== undefined) subs = formatCount(parseInt(subCount, 10));
    }
  } catch (e) {
    logger.warn({ channelId, err: e }, "Failed to fetch subscriber count");
  }

  try {
    const searchRes = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=id&channelId=${encodeURIComponent(channelId)}&eventType=live&type=video&key=${apiKey}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    if (searchRes.ok) {
      const searchData = await searchRes.json() as any;
      const videoId = searchData.items?.[0]?.id?.videoId ?? null;
      if (videoId) {
        const vidRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}&key=${apiKey}`,
          { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
        );
        if (vidRes.ok) {
          const vidData = await vidRes.json() as any;
          const details = vidData.items?.[0]?.liveStreamingDetails;
          if (details?.concurrentViewers !== undefined) {
            viewers = formatCount(parseInt(details.concurrentViewers, 10));
          }
          if (details?.activeLiveChatId) {
            liveChatId = details.activeLiveChatId;
          }
        }
      } else {
        liveChatId = null;
        viewers = null;
      }
    }
  } catch (e) {
    logger.warn({ channelId, err: e }, "Failed to fetch live viewer count");
  }

  const result: ChannelStats = { subs, viewers, liveChatId, lastFetch: Date.now() };
  statsCache.set(channelId, result);
  return result;
}

export async function fetchLiveChat(streamId: string, chatId: string): Promise<ChatMessage[]> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return [];

  // Return cached result if fresh enough — avoids pile-up when the control
  // room panel and the polling interval fire close together.
  const cached = chatResultCache.get(chatId);
  if (cached && Date.now() - cached.fetchedAt < CHAT_CACHE_TTL) {
    return cached.messages;
  }

  const pageToken = chatPageTokens.get(chatId) ?? undefined;
  const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
  url.searchParams.set("liveChatId", chatId);
  url.searchParams.set("part", "snippet,authorDetails");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("maxResults", "50");
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  try {
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return [];
    const data = await res.json() as any;

    if (data.nextPageToken) {
      chatPageTokens.set(chatId, data.nextPageToken);
    }

    const messages: ChatMessage[] = (data.items ?? []).map((item: any) => ({
      id: item.id,
      authorName: item.authorDetails?.displayName ?? "Unknown",
      authorPhoto: item.authorDetails?.profileImageUrl ?? "",
      text: item.snippet?.displayMessage ?? "",
      publishedAt: item.snippet?.publishedAt ?? new Date().toISOString(),
      isMember: item.authorDetails?.isChatSponsor ?? false,
      isModerator: item.authorDetails?.isChatModerator ?? false,
      isOwner: item.authorDetails?.isChatOwner ?? false,
      superChatAmount: item.snippet?.superChatDetails?.amountDisplayString ?? null,
    }));

    // Cache the result so rapid/overlapping calls return instantly
    chatResultCache.set(chatId, { messages, fetchedAt: Date.now() });
    return messages;
  } catch (e) {
    logger.warn({ streamId, chatId, err: e }, "Failed to fetch live chat");
    // Return stale cache on error rather than empty, if we have one
    return chatResultCache.get(chatId)?.messages ?? [];
  }
}

export function getLiveStats(streamId: string): { subs: string | null; viewers: string | null } {
  const stream = storage.getStream(streamId);
  if (!stream?.youtubeChannelId) return { subs: null, viewers: null };
  const cached = statsCache.get(stream.youtubeChannelId);
  return { subs: cached?.subs ?? null, viewers: cached?.viewers ?? null };
}

export function getLiveChatId(streamId: string): string | null {
  const stream = storage.getStream(streamId);
  if (!stream?.youtubeChannelId) return null;
  return statsCache.get(stream.youtubeChannelId)?.liveChatId ?? null;
}

export function startLiveCountPolling() {
  if (pollingInterval) return;

  const poll = async () => {
    if (statsPolling) return;
    statsPolling = true;
    try {
      const streams = storage.getStreams();
      const seen = new Set<string>();

      for (const stream of streams) {
        if (!stream.youtubeChannelId || seen.has(stream.youtubeChannelId)) continue;
        seen.add(stream.youtubeChannelId);

        try {
          const stats = await fetchChannelStats(stream.youtubeChannelId);
          const streamsForChannel = storage.getStreams().filter(
            (s) => s.youtubeChannelId === stream.youtubeChannelId
          );
          for (const s of streamsForChannel) {
            broadcastStream(s.id, "stats", {
              subs: stats.subs,
              viewers: stats.viewers,
              hasChat: !!stats.liveChatId,
            });
          }
          // Sample raw subscriber count for the sparkline chart
          if (stats.subs) {
            const rawStr = stats.subs;
            let rawNum = parseFloat(rawStr);
            if (rawStr.endsWith("M")) rawNum *= 1_000_000;
            else if (rawStr.endsWith("K")) rawNum *= 1_000;
            if (!isNaN(rawNum)) {
              subChartData.push(rawNum);
              if (subChartData.length > MAX_CHART_SAMPLES)
                subChartData.splice(0, subChartData.length - MAX_CHART_SAMPLES);
            }
          }
          updateStreamOverlays({ subs: stats.subs, viewers: stats.viewers, subChartData: [...subChartData] });
        } catch (e) {
          logger.warn({ channelId: stream.youtubeChannelId, err: e }, "Stats poll error");
        }
      }
    } finally {
      statsPolling = false;
    }
  };

  poll();
  pollingInterval = setInterval(poll, 60_000);

  const pollChat = async () => {
    if (chatPolling) return;
    chatPolling = true;
    try {
      const streams = storage.getStreams();
      for (const stream of streams) {
        if (!stream.youtubeChannelId) continue;
        const chatId = statsCache.get(stream.youtubeChannelId)?.liveChatId;
        if (!chatId) continue;

        try {
          const messages = await fetchLiveChat(stream.id, chatId);
          if (messages.length > 0) {
            broadcastStream(stream.id, "chat", messages);
            updateStreamOverlays({
              chatBurnMessages: messages.slice(-10).map((m) => ({
                name: m.authorName,
                text: m.text,
                color: m.isModerator ? "#34d399" : m.isMember ? "#a78bfa" : undefined,
                ts: new Date(m.publishedAt).getTime(),
              })),
            });
          }
        } catch (e) {
          logger.warn({ streamId: stream.id, err: e }, "Chat poll error");
        }
      }
    } finally {
      chatPolling = false;
    }
  };

  chatInterval = setInterval(pollChat, 15_000);
}

export function stopLiveCountPolling() {
  if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
  if (chatInterval) { clearInterval(chatInterval); chatInterval = null; }
}
