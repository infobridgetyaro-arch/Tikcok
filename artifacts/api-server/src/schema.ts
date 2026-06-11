import { z } from "zod";

export const overlayConfigSchema = z.object({
  overlayEnabled: z.boolean().default(false),
  overlayLogoPath: z.string().default(""),
  overlayLogoPosition: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).default("bottom-left"),
  overlayLogoScale: z.number().default(0.15),
  overlayLogoAnimation: z.enum(["none", "pulse", "breathe", "fade-in", "flash"]).default("none"),
  overlayChannelName: z.string().default(""),
  overlayHeadline: z.string().default(""),
  overlayTickerText: z.string().default(""),
  overlayBannerColor: z.string().default("#c41e1e"),
  overlayTickerColor: z.string().default("#1a1a2e"),
  overlayTickerSpeed: z.number().default(80),
  overlayLiveCount: z.boolean().default(false),
  youtubeChannelId: z.string().default(""),
  overlayQrEnabled: z.boolean().default(false),
  overlayQrUrl: z.string().default(""),
  overlayQrLabel: z.string().default("BUY ME COFFEE"),
  overlaySocialEnabled: z.boolean().default(false),
  overlaySocialHandle: z.string().default(""),
});

export type OverlayConfig = z.infer<typeof overlayConfigSchema>;

export const streamConfigSchema = z.object({
  id: z.string(),
  sourceType: z.enum(["tiktok", "youtube", "camera"]).default("tiktok"),
  tiktokUsername: z.string().default(""),
  youtubeSourceUrl: z.string().default(""),
  cameraDevice: z.string().default("/dev/video0"),
  youtubeStreamKey: z.string().default(""),
  facebookRtmpUrl: z.string().default(""),
  ratio: z.enum(["mobile", "desktop"]).default("mobile"),
  quality: z.enum(["best", "720p", "480p"]).default("best"),
  fps: z.enum(["20", "25", "30"]).default("30"),
  muted: z.boolean().default(false),
  autoRestart: z.boolean().default(false),
  status: z.enum(["idle", "streaming", "error", "reconnecting"]).default("idle"),
}).merge(overlayConfigSchema);

export const insertStreamSchema = streamConfigSchema.omit({ id: true, status: true });

export type StreamConfig = z.infer<typeof streamConfigSchema>;
export type InsertStream = z.infer<typeof insertStreamSchema>;

export const loginSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;
