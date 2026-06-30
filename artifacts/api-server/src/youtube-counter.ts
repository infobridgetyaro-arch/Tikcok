import { storage } from "./storage";
import { broadcastStream, updateStreamOverlays, getCurrentOverlayState } from "./stream-manager";
import { logger } from "./lib/logger";

// ── Multi-key pool ──────────────────────────────────────────────────────────
// Add keys as Replit Secrets named YOUTUBE_API_KEY1, YOUTUBE_API_KEY2, …
// up to YOUTUBE_API_KEY10.  When one key's daily quota is exhausted the server
// automatically rotates to the next available key — no restart required.
//
// Legacy formats also accepted (merged in, duplicates removed):
//   YOUTUBE_API_KEY      — single key (original format)
//   YOUTUBE_API_KEYS     — comma-separated list
const apiKeys: string[] = (() => {
  const seen = new Set<string>();
  const keys: string[] = [];
  const add = (k: string | undefined) => {
    if (k && k.trim() && !seen.has(k.trim())) {
      seen.add(k.trim());
      keys.push(k.trim());
    }
  };

  // Numbered keys take priority (YOUTUBE_API_KEY1 … YOUTUBE_API_KEY10)
  for (let i = 1; i <= 10; i++) {
    add(process.env[`YOUTUBE_API_KEY${i}`]);
  }

  // Legacy: comma-separated list
  const multi = process.env.YOUTUBE_API_KEYS;
  if (multi) multi.split(",").forEach(add);

  // Legacy: single key
  add(process.env.YOUTUBE_API_KEY);
  add(process.env.GOOGLE_API_KEY);

  return keys;
})();

logger.info(
  { keyCount: apiKeys.length },
  `[youtube] Loaded ${apiKeys.length} API key(s) — will rotate automatically on quota exhaustion`
);

let currentKeyIndex = 0;
// Reset exhaustion at midnight (keys refill daily at midnight Pacific)
const exhaustedUntil = new Map<number, number>(); // index → timestamp when quota resets

function scheduleExhaustionReset() {
  const now = new Date();
  // YouTube quota resets at midnight Pacific (UTC-8 or UTC-7 DST) = 08:00 UTC
  const nextReset = new Date();
  nextReset.setUTCHours(8, 0, 0, 0);
  if (nextReset <= now) nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  const ms = nextReset.getTime() - now.getTime();
  setTimeout(() => {
    exhaustedUntil.clear();
    logger.info("[youtube] Quota reset — all API keys are available again");
    scheduleExhaustionReset();
  }, ms);
}
scheduleExhaustionReset();

function getYouTubeApiKey(): string {
  if (apiKeys.length === 0) return "";
  return apiKeys[currentKeyIndex] ?? "";
}

/**
 * Mark current key as exhausted and rotate to the next available one.
 * Returns true if a fresh key is now active, false if all keys are exhausted.
 */
function rotateApiKey(): boolean {
  exhaustedUntil.set(currentKeyIndex, Date.now());
  logger.warn(
    { exhaustedKey: currentKeyIndex + 1, totalKeys: apiKeys.length },
    `[youtube] API key #${currentKeyIndex + 1} quota exhausted — rotating to next key`
  );
  for (let i = 1; i <= apiKeys.length; i++) {
    const next = (currentKeyIndex + i) % apiKeys.length;
    if (!exhaustedUntil.has(next)) {
      currentKeyIndex = next;
      logger.info(
        { activeKey: next + 1, totalKeys: apiKeys.length },
        `[youtube] Switched to API key #${next + 1} of ${apiKeys.length}`
      );
      return true;
    }
  }
  logger.error(
    { totalKeys: apiKeys.length },
    `[youtube] All ${apiKeys.length} API key(s) exhausted — add more keys (YOUTUBE_API_KEY1, YOUTUBE_API_KEY2 …) or wait for midnight reset`
  );
  return false;
}

function isQuotaExhausted(): boolean {
  return exhaustedUntil.size === apiKeys.length && apiKeys.length > 0;
}

let warnedNoApiKey = false;
function warnMissingApiKeyOnce(): void {
  if (warnedNoApiKey) return;
  warnedNoApiKey = true;
  logger.warn(
    "YOUTUBE_API_KEYS (or YOUTUBE_API_KEY) is not set — live chat, viewer count, and subscriber " +
    "count will not work. Add YOUTUBE_API_KEY to your environment secrets " +
    "(console.cloud.google.com → APIs → YouTube Data API v3)."
  );
}

interface ChannelStats {
  subs: string | null;
  viewers: string | null;
  liveChatId: string | null;
  lastFetch: number;
  error: "quota" | "not_found" | "api_error" | null;
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
// YouTube tells us exactly when to poll next via pollingIntervalMillis.
// We store it per chatId and drive polling with setTimeout (not setInterval).
const chatPollingIntervals = new Map<string, number>();
const DEFAULT_CHAT_POLL_MS = 5_000;
const MIN_CHAT_POLL_MS = 3_000;

const lastSearchAt = new Map<string, number>();
// search.list costs 100 quota units per call — limit to once per 30 min per channel.
// Viewer counts are kept fresh via videos.list (1–2 units) every stats-poll cycle.
const SEARCH_INTERVAL_MS = 30 * 60 * 1000; // 30 min

// Cache videoId per channelId so videos.list can fetch viewers without search.list
const cachedVideoIds = new Map<string, string | null>(); // channelId → videoId

const burnSentMessageIds = new Map<string, Set<string>>();

const subChartData: number[] = [];
const MAX_CHART_SAMPLES = 60;

interface ChatCache { messages: ChatMessage[]; fetchedAt: number }
const chatResultCache = new Map<string, ChatCache>();
const CHAT_CACHE_TTL = 2_500;

let pollingInterval: NodeJS.Timeout | null = null;
let chatInterval: NodeJS.Timeout | null = null;
let chartBroadcastInterval: NodeJS.Timeout | null = null;
let statsPolling = false;

const FETCH_TIMEOUT_MS = 8000;

function formatCount(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

async function fetchWithKeyRotation(
  buildUrl: (key: string) => string,
  label: string
): Promise<{ res: Response; data: any } | null> {
  const triedKeys = new Set<number>();
  while (triedKeys.size < apiKeys.length) {
    const key = getYouTubeApiKey();
    if (!key) return null;
    const url = buildUrl(key);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.status === 403 || res.status === 429) {
        logger.warn({ label, status: res.status, keyIndex: currentKeyIndex }, "[youtube] Quota error — rotating key");
        triedKeys.add(currentKeyIndex);
        const rotated = rotateApiKey();
        if (!rotated) return null; // all exhausted
        continue;
      }
      const data = await res.json();
      return { res, data };
    } catch (e) {
      logger.warn({ label, err: e }, "[youtube] Fetch error");
      return null;
    }
  }
  return null;
}

async function fetchChannelStats(channelId: string): Promise<ChannelStats> {
  const apiKey = getYouTubeApiKey();
  const prev = statsCache.get(channelId);

  if (!apiKey) {
    warnMissingApiKeyOnce();
    return { subs: null, viewers: null, liveChatId: null, lastFetch: Date.now(), error: "api_error" };
  }

  if (isQuotaExhausted()) {
    return {
      subs: prev?.subs ?? null,
      viewers: prev?.viewers ?? null,
      liveChatId: prev?.liveChatId ?? null,
      lastFetch: Date.now(),
      error: "quota",
    };
  }

  let subs: string | null = prev?.subs ?? null;
  let viewers: string | null = prev?.viewers ?? null;
  let liveChatId: string | null = prev?.liveChatId ?? null;
  let error: ChannelStats["error"] = prev?.error ?? null;

  // --- Subscriber count (channels.list = 1 quota unit) — with auto key rotation ---
  const chanResult = await fetchWithKeyRotation(
    (key) => `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(channelId)}&key=${key}`,
    "channels.list"
  );

  if (!chanResult) {
    error = "quota";
  } else if (!chanResult.res.ok) {
    logger.warn({ channelId, status: chanResult.res.status }, "[youtube] Channel stats API error");
    error = "api_error";
  } else {
    const subCount = chanResult.data.items?.[0]?.statistics?.subscriberCount;
    if (subCount !== undefined) {
      subs = formatCount(parseInt(subCount, 10));
      error = null;
      logger.info({ channelId, subs }, "[youtube] Subscriber count fetched");
    } else {
      logger.warn({ channelId }, "[youtube] Channel not found — verify channel ID");
      error = "not_found";
    }
  }

  // --- Live video & viewer count (throttled) ---
  // search.list = 100 quota units → run at most once per SEARCH_INTERVAL_MS
  // videos.list = 1–2 quota units  → run every poll cycle using the cached videoId
  const now = Date.now();
  const lastSearch = lastSearchAt.get(channelId) ?? 0;
  const shouldSearch = now - lastSearch >= SEARCH_INTERVAL_MS;

  if (shouldSearch && !isQuotaExhausted()) {
    lastSearchAt.set(channelId, now);
    try {
      logger.info({ channelId }, "[youtube] Running search.list for live video (100 quota units)");
      const searchResult = await fetchWithKeyRotation(
        (key) => `https://www.googleapis.com/youtube/v3/search?part=id&channelId=${encodeURIComponent(channelId)}&eventType=live&type=video&key=${key}`,
        "search.list"
      );

      if (!searchResult) {
        if (error !== "quota") error = "quota";
      } else if (!searchResult.res.ok) {
        logger.warn({ channelId }, "[youtube] Live search API error");
      } else {
        const videoId: string | null = searchResult.data.items?.[0]?.id?.videoId ?? null;
        cachedVideoIds.set(channelId, videoId);
        if (!videoId) {
          logger.info({ channelId }, "[youtube] No active live video found");
          liveChatId = null;
          viewers = null;
        }
      }
    } catch (e) {
      logger.warn({ channelId, err: e }, "[youtube] search.list failed");
    }
  } else {
    const nextIn = Math.round((SEARCH_INTERVAL_MS - (now - lastSearch)) / 1000);
    logger.debug({ channelId, nextSearchIn: nextIn + "s" }, "[youtube] Skipping search.list — using cached videoId");
  }

  // --- Fresh viewer count via videos.list (1–2 quota units) every poll cycle ---
  const videoId = cachedVideoIds.get(channelId) ?? null;
  if (videoId && !isQuotaExhausted()) {
    try {
      const vidResult = await fetchWithKeyRotation(
        (key) => `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${encodeURIComponent(videoId)}&key=${key}`,
        "videos.list"
      );
      if (vidResult?.res.ok) {
        const details = vidResult.data.items?.[0]?.liveStreamingDetails;
        if (details?.concurrentViewers !== undefined) {
          viewers = formatCount(parseInt(details.concurrentViewers, 10));
        }
        if (details?.activeLiveChatId) {
          liveChatId = details.activeLiveChatId;
        }
      }
    } catch (e) {
      logger.warn({ channelId, err: e }, "[youtube] videos.list viewer fetch failed");
    }
  }

  const result: ChannelStats = { subs, viewers, liveChatId, lastFetch: Date.now(), error };
  statsCache.set(channelId, result);
  return result;
}

export async function fetchLiveChat(streamId: string, chatId: string): Promise<ChatMessage[]> {
  const apiKey = getYouTubeApiKey();
  if (!apiKey) {
    warnMissingApiKeyOnce();
    return [];
  }
  if (isQuotaExhausted()) {
    return chatResultCache.get(chatId)?.messages ?? [];
  }

  const cached = chatResultCache.get(chatId);
  if (cached && Date.now() - cached.fetchedAt < CHAT_CACHE_TTL) {
    return cached.messages;
  }

  const pageToken = chatPageTokens.get(chatId) ?? undefined;

  const result = await fetchWithKeyRotation((key) => {
    const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
    url.searchParams.set("liveChatId", chatId);
    url.searchParams.set("part", "snippet,authorDetails");
    url.searchParams.set("key", key);
    url.searchParams.set("maxResults", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    return url.toString();
  }, "liveChat.messages");

  if (!result || !result.res.ok) {
    return chatResultCache.get(chatId)?.messages ?? [];
  }

  const data = result.data;
  if (data.nextPageToken) {
    chatPageTokens.set(chatId, data.nextPageToken);
  }
  // Honour YouTube's own polling hint — it tells us exactly when new messages
  // will be available, so we use it to drive the next poll via setTimeout.
  if (typeof data.pollingIntervalMillis === "number" && data.pollingIntervalMillis > 0) {
    chatPollingIntervals.set(chatId, Math.max(data.pollingIntervalMillis, MIN_CHAT_POLL_MS));
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

  chatResultCache.set(chatId, { messages, fetchedAt: Date.now() });
  return messages;
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

export function triggerStatsPollNow(): void {
  if (statsPolling) return;
  statsPolling = true;
  const streams = storage.getStreams();
  const seen = new Set<string>();
  const tasks = streams
    .filter((s) => s.youtubeChannelId && !seen.has(s.youtubeChannelId))
    .map(async (stream) => {
      seen.add(stream.youtubeChannelId!);
      try {
        const stats = await fetchChannelStats(stream.youtubeChannelId!);
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
        updateStreamOverlays({ subs: stats.subs, viewers: stats.viewers });
      } catch (e) {
        logger.warn({ channelId: stream.youtubeChannelId, err: e }, "[youtube] Immediate stats poll error");
      }
    });
  Promise.all(tasks).finally(() => { statsPolling = false; });
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
              error: stats.error ?? null,
            });
          }
          if (stats.subs) {
            let rawNum = parseFloat(stats.subs);
            if (stats.subs.endsWith("M")) rawNum *= 1_000_000;
            else if (stats.subs.endsWith("K")) rawNum *= 1_000;
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
  pollingInterval = setInterval(poll, 60_000); // 60 s — channels.list (1 unit) + videos.list (1–2 units) per cycle

  // ── Re-broadcast cached stats every 10 s so the chart animates live ──────
  // No new API calls — just push what we already have so the frontend chart
  // gets a fresh data point and the animated numbers keep moving smoothly.
  chartBroadcastInterval = setInterval(() => {
    const streams = storage.getStreams();
    const seen = new Set<string>();
    for (const stream of streams) {
      if (!stream.youtubeChannelId || seen.has(stream.youtubeChannelId)) continue;
      seen.add(stream.youtubeChannelId);
      const cached = statsCache.get(stream.youtubeChannelId);
      if (!cached) continue;
      const streamsForChannel = storage.getStreams().filter(
        (s) => s.youtubeChannelId === stream.youtubeChannelId
      );
      for (const s of streamsForChannel) {
        broadcastStream(s.id, "stats", {
          subs: cached.subs,
          viewers: cached.viewers,
          hasChat: !!cached.liveChatId,
          error: cached.error ?? null,
        });
      }
    }
    if (subChartData.length > 0) {
      updateStreamOverlays({ subChartData: [...subChartData] });
    }
  }, 10_000);

  // setTimeout-based recursive poller — respects YouTube's pollingIntervalMillis
  // so each chatId is fetched as soon as the API says new messages are available.
  const scheduleChatPoll = (chatId: string, streamId: string, delayMs: number) => {
    if (!chatInterval) return; // stopped
    setTimeout(() => {
      if (!chatInterval) return;
      (async () => {
        try {
          const messages = await fetchLiveChat(streamId, chatId);
          if (messages.length > 0) {
            broadcastStream(streamId, "chat", messages);

            if (!burnSentMessageIds.has(streamId)) burnSentMessageIds.set(streamId, new Set());
            const sentIds = burnSentMessageIds.get(streamId)!;
            const newBurnMsgs = messages.filter((m) => !sentIds.has(m.id));
            if (newBurnMsgs.length > 0) {
              newBurnMsgs.forEach((m) => sentIds.add(m.id));
              if (sentIds.size > 2000) {
                const oldest = Array.from(sentIds).slice(0, 500);
                oldest.forEach((id) => sentIds.delete(id));
              }
              const receiveTs = Date.now();
              const incoming = newBurnMsgs.slice(-10).map((m) => ({
                name: m.authorName,
                text: m.text,
                photo: m.authorPhoto || undefined,
                color: m.isModerator ? "#34d399" : m.isMember ? "#a78bfa" : undefined,
                ts: receiveTs,
              }));
              const CHAT_BURN_MAX = 20;
              const currentMessages = getCurrentOverlayState().chatBurnMessages ?? [];
              const accumulated = [...currentMessages, ...incoming].slice(-CHAT_BURN_MAX);
              const currentState = getCurrentOverlayState();
              if (!currentState.chatBurnActive) {
                logger.info({ streamId, newMessages: incoming.length }, "[chat-burn] New chat messages received but chatBurnActive=false — enable via Chat tab to show overlay");
              } else {
                logger.info({ streamId, newMessages: incoming.length, totalInWindow: accumulated.length }, "[chat-burn] Dispatching chat burn messages to overlay");
              }
              updateStreamOverlays({ chatBurnMessages: accumulated });
            }
          }
        } catch (e) {
          logger.warn({ streamId, err: e }, "Chat poll error");
        }
        // Re-schedule using the interval YouTube told us (or default)
        const next = chatPollingIntervals.get(chatId) ?? DEFAULT_CHAT_POLL_MS;
        scheduleChatPoll(chatId, streamId, next);
      })();
    }, delayMs);
  };

  // Seed: kick off a poll per active stream immediately, then let each reschedule itself
  const seedChatPollers = () => {
    const streams = storage.getStreams();
    for (const stream of streams) {
      if (!stream.youtubeChannelId) continue;
      const chatId = statsCache.get(stream.youtubeChannelId)?.liveChatId;
      if (!chatId) continue;
      scheduleChatPoll(chatId, stream.id, DEFAULT_CHAT_POLL_MS);
    }
  };
  seedChatPollers();

  // Re-seed every 30 s to pick up newly added streams / newly resolved chatIds
  // (each individual chatId is already being polled by its own setTimeout chain above)
  chatInterval = setInterval(seedChatPollers, 30_000);
}

export function stopLiveCountPolling() {
  if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
  if (chatInterval) { clearInterval(chatInterval); chatInterval = null; }
  if (chartBroadcastInterval) { clearInterval(chartBroadcastInterval); chartBroadcastInterval = null; }
}

/** Exposed for the /api/youtube/key-status debug endpoint */
export function getApiKeyStatus(): { total: number; active: number; exhausted: number[]; currentIndex: number } {
  return {
    total: apiKeys.length,
    active: currentKeyIndex,
    exhausted: Array.from(exhaustedUntil.keys()),
    currentIndex: currentKeyIndex,
  };
}

// ── Per-key detailed telemetry ───────────────────────────────────────────────
interface KeyTelemetry {
  totalRequests: number;
  requestTimestamps: number[];  // rolling window for req/min
  errorsTotal: number;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastErrorMsg: string | null;
}
const keyTelemetry: Map<number, KeyTelemetry> = new Map();
const startedAt = Date.now();

const eventLog: Array<{ ts: number; type: "rotate" | "exhaust" | "error" | "success"; keyIndex: number; msg: string }> = [];

function getTelemetry(idx: number): KeyTelemetry {
  if (!keyTelemetry.has(idx)) {
    keyTelemetry.set(idx, {
      totalRequests: 0,
      requestTimestamps: [],
      errorsTotal: 0,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastErrorMsg: null,
    });
  }
  return keyTelemetry.get(idx)!;
}

export function recordApiRequest(success: boolean, errorMsg?: string) {
  const idx = currentKeyIndex;
  const t   = getTelemetry(idx);
  const now = Date.now();
  t.totalRequests++;
  t.requestTimestamps.push(now);
  // Keep only last 2 minutes for rolling window
  const cutoff = now - 120000;
  t.requestTimestamps = t.requestTimestamps.filter((ts) => ts > cutoff);
  if (success) {
    t.lastSuccessAt = now;
    if (t.totalRequests % 50 === 1) {
      eventLog.push({ ts: now, type: "success", keyIndex: idx, msg: `Key #${idx + 1}: ${t.totalRequests} requests served` });
    }
  } else {
    t.errorsTotal++;
    t.lastErrorAt  = now;
    t.lastErrorMsg = errorMsg || "Unknown error";
    eventLog.push({ ts: now, type: "error", keyIndex: idx, msg: `Key #${idx + 1}: ${errorMsg || "error"}` });
  }
  if (eventLog.length > 100) eventLog.splice(0, eventLog.length - 100);
}

export function recordKeyRotation(reason: string) {
  const now = Date.now();
  const idx = currentKeyIndex;
  eventLog.push({ ts: now, type: "rotate", keyIndex: idx, msg: `Rotated to Key #${idx + 1}: ${reason}` });
  if (eventLog.length > 100) eventLog.splice(0, eventLog.length - 100);
}

export function forceRotateToKey(targetIndex: number): boolean {
  if (targetIndex < 0 || targetIndex >= apiKeys.length) return false;
  if (exhaustedUntil.has(targetIndex)) return false;
  currentKeyIndex = targetIndex;
  recordKeyRotation(`Manual switch to Key #${targetIndex + 1}`);
  return true;
}

function computeHealthScore(idx: number): number {
  if (exhaustedUntil.has(idx)) return 0;
  const t = keyTelemetry.get(idx);
  if (!t || t.totalRequests === 0) return 100;
  const errorRate = t.totalRequests > 0 ? t.errorsTotal / t.totalRequests : 0;
  const now = Date.now();
  const recentReqs = t.requestTimestamps.filter((ts) => ts > now - 60000).length;
  const ratePenalty = recentReqs > 45 ? Math.min(30, (recentReqs - 45) * 2) : 0;
  return Math.max(0, Math.round(100 - errorRate * 100 - ratePenalty));
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 6) + "••••••••" + key.slice(-4);
}

export function getDetailedApiStatus() {
  const now = Date.now();
  // Compute quota reset (midnight Pacific = 08:00 UTC)
  const nextReset = new Date();
  nextReset.setUTCHours(8, 0, 0, 0);
  if (nextReset.getTime() <= now) nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  const quotaResetAt = nextReset.getTime();

  const keys = apiKeys.map((_, idx) => {
    const t = keyTelemetry.get(idx);
    const recentReqs = t
      ? t.requestTimestamps.filter((ts) => ts > now - 60000).length
      : 0;
    return {
      index: idx,
      masked: maskApiKey(apiKeys[idx]),
      isActive: idx === currentKeyIndex && !exhaustedUntil.has(idx),
      isExhausted: exhaustedUntil.has(idx),
      totalRequests: t?.totalRequests ?? 0,
      requestsLastMinute: recentReqs,
      errorsTotal: t?.errorsTotal ?? 0,
      lastSuccessAt: t?.lastSuccessAt ?? null,
      lastErrorAt: t?.lastErrorAt ?? null,
      lastErrorMsg: t?.lastErrorMsg ?? null,
      quotaResetAt: exhaustedUntil.has(idx) ? quotaResetAt : null,
      healthScore: computeHealthScore(idx),
    };
  });

  const totalRequests = keys.reduce((s, k) => s + k.totalRequests, 0);
  const totalErrors   = keys.reduce((s, k) => s + k.errorsTotal, 0);

  return {
    totalKeys: apiKeys.length,
    activeKeyIndex: currentKeyIndex,
    allExhausted: exhaustedUntil.size === apiKeys.length && apiKeys.length > 0,
    quotaResetAt,
    keys,
    totalRequestsAllKeys: totalRequests,
    totalErrors,
    uptimeSec: Math.round((now - startedAt) / 1000),
    eventLog: [...eventLog],
  };
}
