import https from "https";
import http from "http";

export interface TikTokStreamInfo {
  roomId: string;
  isLive: boolean;
  title?: string;
  flvUrls: { hd?: string; sd?: string; ld?: string };
  hlsUrl?: string;
}

function httpsGet(url: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const defaultHeaders = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...headers,
    };

    const follow = (targetUrl: string, depth = 0) => {
      if (depth > 5) return reject(new Error("Too many redirects"));
      const parsed = new URL(targetUrl);
      const mod = parsed.protocol === "https:" ? https : http;
      const req = mod.get(targetUrl, { headers: defaultHeaders }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const next = res.headers.location.startsWith("http")
            ? res.headers.location
            : `${parsed.protocol}//${parsed.host}${res.headers.location}`;
          return follow(next, depth + 1);
        }
        let body = "";
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => resolve(body));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.setTimeout(20000, () => { req.destroy(); reject(new Error("Request timeout")); });
    };

    follow(url);
  });
}

function unescapeUrl(s: string): string {
  return s.replace(/\\u0026/g, "&").replace(/\\\//g, "/");
}

async function getRoomIdFromPage(username: string): Promise<string | null> {
  try {
    const html = await httpsGet(`https://www.tiktok.com/@${username}/live`);
    const match = html.match(/"roomId"\s*:\s*"(\d+)"/);
    if (match) return match[1];
    const match2 = html.match(/room_id[=\/](\d+)/);
    if (match2) return match2[1];
  } catch {}
  return null;
}

async function getRoomIdFromApi(username: string): Promise<string | null> {
  try {
    const body = await httpsGet(
      `https://www.tiktok.com/api/live/detail/?uniqueId=${username}`,
      { "Referer": "https://www.tiktok.com/" }
    );
    const match = body.match(/"roomId"\s*:\s*"?(\d+)"?/);
    if (match) return match[1];
    const match2 = body.match(/"room_id"\s*:\s*"?(\d+)"?/);
    if (match2) return match2[1];
  } catch {}
  return null;
}

async function getStreamInfoFromWebcast(roomId: string): Promise<TikTokStreamInfo | null> {
  try {
    const body = await httpsGet(
      `https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id=${roomId}`
    );

    const statusMatch = body.match(/"status"\s*:\s*(\d+)/);
    const alive = body.match(/"alive"\s*:\s*(true|false)/);
    const titleMatch = body.match(/"title"\s*:\s*"([^"]*)"/);

    const isLive = (statusMatch && statusMatch[1] === "2") ||
                   (alive && alive[1] === "true") || false;

    const flvUrls: TikTokStreamInfo["flvUrls"] = {};
    const flvBlock = body.match(/"flv_pull_url"\s*:\s*\{([^}]+)\}/);
    if (flvBlock) {
      const pairs = flvBlock[1].match(/"([^"]+)"\s*:\s*"([^"]+)"/g) || [];
      for (const pair of pairs) {
        const m = pair.match(/"([^"]+)"\s*:\s*"([^"]+)"/);
        if (m) {
          const key = m[1].toLowerCase();
          const val = unescapeUrl(m[2]);
          if (key.includes("hd") || key === "hd1" || key === "full_hd1") flvUrls.hd = val;
          else if (key === "sd1" || (key.includes("sd") && !key.includes("sd2"))) flvUrls.sd = val;
          else if (key.includes("ld") || key === "sd2") flvUrls.ld = val;
        }
      }
    }

    let hlsUrl: string | undefined;
    const hlsMatch = body.match(/"hls_pull_url"\s*:\s*"([^"]+)"/);
    if (hlsMatch) {
      hlsUrl = unescapeUrl(hlsMatch[1]);
    }
    const hlsMapBlock = body.match(/"hls_pull_url_map"\s*:\s*\{([^}]+)\}/);
    if (hlsMapBlock && !hlsUrl) {
      const firstUrl = hlsMapBlock[1].match(/"[^"]+"\s*:\s*"([^"]+)"/);
      if (firstUrl) hlsUrl = unescapeUrl(firstUrl[1]);
    }

    return {
      roomId,
      isLive,
      title: titleMatch ? titleMatch[1] : undefined,
      flvUrls,
      hlsUrl,
    };
  } catch {
    return null;
  }
}

async function getStreamInfoFromAlternateApi(roomId: string): Promise<TikTokStreamInfo | null> {
  try {
    const body = await httpsGet(
      `https://webcast.tiktok.com/webcast/room/info/?aid=1233&room_id=${roomId}`
    );

    const flvUrls: TikTokStreamInfo["flvUrls"] = {};
    const flvBlock = body.match(/"flv_pull_url"\s*:\s*\{([^}]+)\}/);
    if (flvBlock) {
      const pairs = flvBlock[1].match(/"([^"]+)"\s*:\s*"([^"]+)"/g) || [];
      for (const pair of pairs) {
        const m = pair.match(/"([^"]+)"\s*:\s*"([^"]+)"/);
        if (m) {
          const key = m[1].toLowerCase();
          const val = unescapeUrl(m[2]);
          if (key.includes("hd")) flvUrls.hd = val;
          else if (key === "sd1" || (key.includes("sd") && !key.includes("sd2"))) flvUrls.sd = val;
          else flvUrls.ld = val;
        }
      }
    }

    let hlsUrl: string | undefined;
    const hlsMatch = body.match(/"hls_pull_url"\s*:\s*"([^"]+)"/);
    if (hlsMatch) hlsUrl = unescapeUrl(hlsMatch[1]);

    if (!flvUrls.hd && !flvUrls.sd && !flvUrls.ld && !hlsUrl) return null;

    return { roomId, isLive: true, flvUrls, hlsUrl };
  } catch {
    return null;
  }
}

async function getStreamFromPageData(username: string): Promise<TikTokStreamInfo | null> {
  try {
    const html = await httpsGet(`https://www.tiktok.com/@${username}/live`);

    const flvUrls: TikTokStreamInfo["flvUrls"] = {};
    const flvMatches = html.match(/pull-[^"]*\.flv[^"]*/g);
    if (flvMatches) {
      for (const url of flvMatches) {
        const clean = unescapeUrl(url.startsWith("http") ? url : `https://${url}`);
        if (clean.includes("_hd")) flvUrls.hd = clean;
        else if (clean.includes("_sd") || clean.includes("_ld")) flvUrls.sd = clean;
        else flvUrls.ld = clean;
      }
    }

    let hlsUrl: string | undefined;
    const hlsMatch = html.match(/(https?:\/\/pull[^"]*index\.m3u8[^"]*)/);
    if (hlsMatch) hlsUrl = unescapeUrl(hlsMatch[1]);

    const roomMatch = html.match(/"roomId"\s*:\s*"(\d+)"/);

    if (!flvUrls.hd && !flvUrls.sd && !flvUrls.ld && !hlsUrl) return null;

    return {
      roomId: roomMatch ? roomMatch[1] : "unknown",
      isLive: true,
      flvUrls,
      hlsUrl,
    };
  } catch {
    return null;
  }
}

export async function getTikTokStreamInfo(username: string): Promise<TikTokStreamInfo> {
  let roomId = await getRoomIdFromPage(username);
  if (!roomId) {
    roomId = await getRoomIdFromApi(username);
  }

  if (!roomId) {
    throw new Error(`Could not find TikTok live room for @${username}. Make sure the username is correct and the user is currently live.`);
  }

  let info = await getStreamInfoFromWebcast(roomId);

  if (!info || (!info.flvUrls.hd && !info.flvUrls.sd && !info.flvUrls.ld && !info.hlsUrl)) {
    info = await getStreamInfoFromAlternateApi(roomId);
  }

  if (!info || (!info.flvUrls.hd && !info.flvUrls.sd && !info.flvUrls.ld && !info.hlsUrl)) {
    info = await getStreamFromPageData(username);
  }

  if (!info || (!info.flvUrls.hd && !info.flvUrls.sd && !info.flvUrls.ld && !info.hlsUrl)) {
    throw new Error(`@${username} appears to have a room but no stream URLs were found. They may have just ended their live.`);
  }

  return info;
}

export function pickBestUrl(info: TikTokStreamInfo, quality: string): string {
  if (info.hlsUrl) return info.hlsUrl;

  const { flvUrls } = info;
  if (quality === "best" && flvUrls.hd) return flvUrls.hd;
  if (quality === "720p") return flvUrls.sd || flvUrls.hd || flvUrls.ld || "";
  if (quality === "480p") return flvUrls.ld || flvUrls.sd || flvUrls.hd || "";
  return flvUrls.sd || flvUrls.hd || flvUrls.ld || "";
}
