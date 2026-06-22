import { z } from "zod";

export const streamConfigSchema = z.object({
  id: z.string(),
  sourceType: z.enum(["tiktok", "youtube", "camera", "xspace", "upload"]).default("tiktok"),
  tiktokUsername: z.string().default(""),
  youtubeSourceUrl: z.string().default(""),
  cameraDevice: z.string().default("/dev/video0"),
  xspaceUrl: z.string().default(""),
  uploadedVideoPath: z.string().default(""),
  uploadedVideoLoop: z.boolean().default(true),
  youtubeStreamKey: z.string().default(""),
  facebookRtmpUrl: z.string().default(""),
  tiktokStreamKey: z.string().default(""),
  youtubeChannelId: z.string().default(""),
  ratio: z.enum(["mobile", "desktop"]).default("mobile"),
  quality: z.enum(["best", "720p", "480p"]).default("best"),
  fps: z.enum(["20", "25", "30"]).default("30"),
  muted: z.boolean().default(false),
  autoRestart: z.boolean().default(false),
  status: z.enum(["idle", "streaming", "error", "reconnecting"]).default("idle"),
  micDevice: z.string().default(""),
  micEnabled: z.boolean().default(false),
});

export const insertStreamSchema = streamConfigSchema.omit({ id: true, status: true });

export type StreamConfig = z.infer<typeof streamConfigSchema>;
export type InsertStream = z.infer<typeof insertStreamSchema>;

export const loginSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

export type LoginInput = z.infer<typeof loginSchema>;
