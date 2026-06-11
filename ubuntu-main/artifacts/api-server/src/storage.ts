import { randomUUID } from "crypto";
import type { StreamConfig, InsertStream } from "./schema";

export interface IStorage {
  getStreams(): StreamConfig[];
  getStream(id: string): StreamConfig | undefined;
  createStream(data: InsertStream): StreamConfig;
  updateStream(id: string, data: Partial<StreamConfig>): StreamConfig | undefined;
  deleteStream(id: string): boolean;
}

export class MemStorage implements IStorage {
  private streams: Map<string, StreamConfig> = new Map();

  getStreams(): StreamConfig[] {
    return Array.from(this.streams.values());
  }

  getStream(id: string): StreamConfig | undefined {
    return this.streams.get(id);
  }

  createStream(data: InsertStream): StreamConfig {
    const id = randomUUID();
    const stream: StreamConfig = {
      id,
      sourceType: data.sourceType || "tiktok",
      tiktokUsername: (data.tiktokUsername || "").replace(/^@+/, "").trim(),
      youtubeSourceUrl: data.youtubeSourceUrl || "",
      cameraDevice: data.cameraDevice || "/dev/video0",
      youtubeStreamKey: data.youtubeStreamKey || "",
      facebookRtmpUrl: data.facebookRtmpUrl || "",
      ratio: data.ratio || "mobile",
      quality: data.quality || "best",
      fps: data.fps || "30",
      muted: data.muted ?? false,
      autoRestart: data.autoRestart ?? false,
      status: "idle",
      overlayEnabled: data.overlayEnabled ?? false,
      overlayLogoPath: data.overlayLogoPath || "",
      overlayLogoPosition: data.overlayLogoPosition || "top-right",
      overlayLogoScale: data.overlayLogoScale ?? 0.15,
      overlayLogoAnimation: data.overlayLogoAnimation || "none",
      overlayChannelName: data.overlayChannelName || "",
      overlayHeadline: data.overlayHeadline || "",
      overlayTickerText: data.overlayTickerText || "",
      overlayBannerColor: data.overlayBannerColor || "#c41e1e",
      overlayTickerColor: data.overlayTickerColor || "#1a1a2e",
      overlayTickerSpeed: data.overlayTickerSpeed ?? 80,
      overlayLiveCount: data.overlayLiveCount ?? false,
      youtubeChannelId: data.youtubeChannelId || "",
      overlayQrEnabled: data.overlayQrEnabled ?? false,
      overlayQrUrl: data.overlayQrUrl || "",
      overlayQrLabel: data.overlayQrLabel || "BUY ME COFFEE",
      overlaySocialEnabled: data.overlaySocialEnabled ?? false,
      overlaySocialHandle: data.overlaySocialHandle || "",
    };
    this.streams.set(id, stream);
    return stream;
  }

  updateStream(id: string, data: Partial<StreamConfig>): StreamConfig | undefined {
    const stream = this.streams.get(id);
    if (!stream) return undefined;
    const normalized = { ...data };
    if (typeof normalized.tiktokUsername === "string") {
      normalized.tiktokUsername = normalized.tiktokUsername.replace(/^@+/, "").trim();
    }
    const updated = { ...stream, ...normalized, id };
    this.streams.set(id, updated);
    return updated;
  }

  deleteStream(id: string): boolean {
    return this.streams.delete(id);
  }
}

export const storage = new MemStorage();
