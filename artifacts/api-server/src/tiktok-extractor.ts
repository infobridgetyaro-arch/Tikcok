import { spawn } from "child_process";

export interface TikTokStreamInfo {
  roomId: string;
  isLive: boolean;
  title?: string;
  flvUrls: { hd?: string; sd?: string; ld?: string };
  hlsUrl?: string;
}

function qualityArg(quality: string): string {
  if (quality === "720p") return "720p,best";
  if (quality === "480p") return "480p,best";
  return "best";
}

function streamlinkGetUrl(username: string, quality: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("streamlink", [
      "--stream-url",
      `https://www.tiktok.com/@${username}/live`,
      qualityArg(quality),
    ]);

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
      reject(new Error("Timeout fetching TikTok stream (30s). Is the user currently live?"));
    }, 30000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const url = stdout.trim().split("\n").find((l) => l.startsWith("http"));
      if (code === 0 && url) {
        resolve(url);
      } else {
        const errText = stderr.trim();
        if (errText.includes("No playable streams") || errText.includes("No streams found")) {
          reject(new Error(`@${username} is not live right now, or the username is incorrect.`));
        } else {
          reject(new Error(
            errText
              ? `streamlink: ${errText.slice(0, 300)}`
              : `Could not find TikTok live stream for @${username}. Make sure the username is correct and the user is currently live.`
          ));
        }
      }
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new Error("streamlink is not installed. Run: pip install streamlink"));
      } else {
        reject(err);
      }
    });
  });
}

export async function getTikTokStreamInfo(rawUsername: string): Promise<TikTokStreamInfo> {
  const username = rawUsername.replace(/^@+/, "").trim();

  const url = await streamlinkGetUrl(username, "best");

  const isHls = url.includes(".m3u8");
  return {
    roomId: "streamlink",
    isLive: true,
    flvUrls: isHls ? {} : { hd: url },
    hlsUrl: isHls ? url : undefined,
  };
}

export async function getTikTokStreamUrl(rawUsername: string, quality: string): Promise<string> {
  const username = rawUsername.replace(/^@+/, "").trim();
  return streamlinkGetUrl(username, quality);
}

export function pickBestUrl(info: TikTokStreamInfo, _quality: string): string {
  if (info.hlsUrl) return info.hlsUrl;
  const { flvUrls } = info;
  return flvUrls.hd || flvUrls.sd || flvUrls.ld || "";
}
