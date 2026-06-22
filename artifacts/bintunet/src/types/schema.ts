export type StreamConfig = {
  id: string;
  sourceType: "tiktok" | "youtube" | "camera" | "xspace" | "upload";
  tiktokUsername: string;
  youtubeSourceUrl: string;
  cameraDevice: string;
  xspaceUrl: string;
  uploadedVideoPath: string;
  uploadedVideoLoop: boolean;
  youtubeStreamKey: string;
  facebookRtmpUrl: string;
  tiktokStreamKey: string;
  youtubeChannelId: string;
  ratio: "mobile" | "desktop";
  quality: "best" | "720p" | "480p";
  fps: "20" | "25" | "30";
  muted: boolean;
  autoRestart: boolean;
  status: "idle" | "streaming" | "error" | "reconnecting";
  micDevice: string;
  micEnabled: boolean;
};

export type InsertStream = Omit<StreamConfig, "id" | "status">;
