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
  overlayQrPosition: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).default("top-right"),
  overlayQrSize: z.enum(["small", "medium", "large"]).default("medium"),
  overlaySocialEnabled: z.boolean().default(false),
  overlaySocialHandle: z.string().default(""),
  lowerThirdStyle: z.enum(["none", "l-cut", "breaking-news", "ticker-name", "side-strip"]).default("none"),
  lowerThirdName: z.string().default(""),
  lowerThirdTitle: z.string().default(""),
  lowerThirdAccentColor: z.string().default("#e53935"),
  lowerThirdAnimation: z.enum(["none", "slide-wipe", "scale-up", "fade", "drop-in"]).default("slide-wipe"),
  tickerStyle: z.enum(["crawl", "flipper", "flash-alert"]).default("crawl"),
  messageEnabled: z.boolean().default(false),
  messageText: z.string().default(""),
  messageStyle: z.enum(["news-classic", "breaking-alert", "minimal-clean", "cinema", "social-card", "broadcast-official", "pill", "watermark"]).default("news-classic"),
  messagePosition: z.enum(["top-left", "top-right", "center", "bottom-left", "bottom-right", "bottom-center"]).default("center"),
  subBoxEnabled: z.boolean().default(false),
  subBoxStyle: z.enum(["minimal", "card", "broadcast", "flip-counter", "whatsapp", "recent-activity", "neon-glow", "glass-card", "scoreboard", "pill-badge"]).default("card"),
  subBoxPosition: z.enum(["top-left", "top-right", "center-left", "center-right", "bottom-left", "bottom-right"]).default("top-right"),
  subBoxShowViewers: z.boolean().default(false),
  subBoxAnimStyle: z.enum(["none", "count-up", "pulse-glow", "slide-in", "celebrate"]).default("none"),
  chatEnabled: z.boolean().default(false),
  chatPosition: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).default("bottom-right"),
  chatStyle: z.enum(["bubble", "list"]).default("list"),
  chatMaxMessages: z.number().default(5),
  viewerLayout: z.enum(["standard", "pip-br", "pip-bl", "pip-tr", "split-v", "split-h", "cinema", "fullscreen", "l-shape"]).default("standard"),
  viewerScreenScale: z.number().default(1.0),
  viewerScreenX: z.number().default(50),
  viewerScreenY: z.number().default(50),
  adEnabled: z.boolean().default(false),
  adStyle: z.enum(["sponsor-banner", "lower-ad", "corner-bug", "countdown-card", "product-card", "ribbon"]).default("sponsor-banner"),
  adText: z.string().default(""),
  adSubText: z.string().default(""),
  adBgColor: z.string().default("#0a0f1e"),
  adAccentColor: z.string().default("#f97316"),
  adPosition: z.enum(["top-left", "top-right", "center", "bottom-left", "bottom-right", "bottom-center"]).default("bottom-center"),
  adCtaLabel: z.string().default("LEARN MORE"),
  adCountdown: z.number().default(0),
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
