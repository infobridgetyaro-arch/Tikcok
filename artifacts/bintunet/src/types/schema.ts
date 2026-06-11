export type OverlayConfig = {
  overlayEnabled: boolean;
  overlayLogoPath: string;
  overlayLogoPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  overlayLogoScale: number;
  overlayLogoAnimation: "none" | "pulse" | "breathe" | "fade-in" | "flash";
  overlayChannelName: string;
  overlayHeadline: string;
  overlayTickerText: string;
  overlayBannerColor: string;
  overlayTickerColor: string;
  overlayTickerSpeed: number;
  overlayLiveCount: boolean;
  youtubeChannelId: string;
  overlayQrEnabled: boolean;
  overlayQrUrl: string;
  overlayQrLabel: string;
  overlaySocialEnabled: boolean;
  overlaySocialHandle: string;
};

export type StreamConfig = OverlayConfig & {
  id: string;
  sourceType: "tiktok" | "youtube" | "camera";
  tiktokUsername: string;
  youtubeSourceUrl: string;
  cameraDevice: string;
  youtubeStreamKey: string;
  facebookRtmpUrl: string;
  ratio: "mobile" | "desktop";
  quality: "best" | "720p" | "480p";
  fps: "20" | "25" | "30";
  muted: boolean;
  autoRestart: boolean;
  status: "idle" | "streaming" | "error" | "reconnecting";
};

export type InsertStream = Omit<StreamConfig, "id" | "status">;
