import express from "express";
import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import { WebSocketServer } from "ws";
import session from "express-session";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import multer from "multer";
import { storage } from "./storage";
import { insertStreamSchema } from "./schema";
import {
  startStream,
  stopStream,
  restartStream,
  toggleMute,
  addWSClient,
  broadcastGlobal,
  broadcastStream,
  updateStreamOverlays,
  setCameraLink,
  clearCameraLink,
  feedMicAudio,
  updateStreamVolume,
  writeToBrowserCamera,
  browserCameraStreams,
  getStreamLogBuffers,
  setScreenShareFrameForAll,
  preloadBreakVideo,
  getBreakVideoPreloadStatus,
} from "./stream-manager";
import { getTikTokStreamUrl } from "./tiktok-extractor";
import { startLiveCountPolling, stopLiveCountPolling, getLiveChatId, fetchLiveChat, getLiveStats } from "./youtube-counter";
import type { OverlayPosition } from "./overlay-renderer";
import { registerDonationGateway, setDonationCallback, getGatewayPaymentUrl, getQRScanCount, getGiftQueue } from "./donation-gateway";
import type { GiftQueueItem } from "./gift-system";

interface BroadcastState {
  newsActive: boolean;
  newsText: string;
  newsTitle: string;
  newsBgColor: string;
  newsStyle: string;
  newsAnimation: string;
  newsPosition: OverlayPosition;
  adActive: boolean;
  adText: string;
  adSub: string;
  adStyle: string;
  adPosition: OverlayPosition;
  breakActive: boolean;
  breakText: string;
  breakStyle: string;
  breakVideoUrl: string;
  breakVideoMode: "fullscreen" | "live-bg" | "gradient-bg";
  breakVideoMuted: boolean;
  breakVideoPanX: number;
  breakVideoPanY: number;
  liveAudioMuted: boolean;
  chatStyle: string;
  statsActive: boolean;
  statsPosition: OverlayPosition;
  subsOverlayActive: boolean;
  subsStyle: string;
  subsPosition: OverlayPosition;
  subsGoal: number;
  // Sub sparkline chart
  subChartActive: boolean;
  subChartData: number[];
  subChartPosition: OverlayPosition;
  mobileSubChartPosition: OverlayPosition;
  // Sub milestone alert
  subAlertActive: boolean;
  subAlertMessage: string;
  chatBurnActive: boolean;
  chatBurnStyle: string;
  chatBurnPosition: OverlayPosition;
  // Super chat
  superChatMessages: Array<{ user: string; amount: string; text: string; color: string; ts: number }>;
  // Guest name tag
  guestNameActive: boolean;
  guestName: string;
  guestTitle: string;
  guestStyle: string;
  guestPosition: OverlayPosition;
  mobileGuestPosition: OverlayPosition;
  // Background gradient
  bgGradientActive: boolean;
  bgGradient1: string;
  bgGradient2: string;
  bgGradientOpacity: number;
  // Mobile (portrait) position overrides
  mobileStatsPosition: OverlayPosition;
  mobileSubsPosition: OverlayPosition;
  mobileChatBurnPosition: OverlayPosition;
  mobileNewsPosition: OverlayPosition;
  mobileAdPosition: OverlayPosition;
  // Element scale (50–200, 100 = actual size)
  statsScale: number;
  subsScale: number;
  chatBurnScale: number;
  newsScale: number;
  adScale: number;
  guestScale: number;
  subChartScale: number;
  globalStreamVolume: number;
  // QR code overlay
  qrActive: boolean;
  qrUrl: string;
  qrTitle: string;
  qrSize: number;
  qrPosition: { x: number; y: number };
  qrScanCount: number;
  qrThankYouName: string;
  qrThankYouTs: number;
  // Featured comment (StreamYard-style single highlighted comment)
  featuredComment: { name: string; text: string; color?: string; ts: number } | null;
  // Screen share PIP overlay
  screenShareActive: boolean;
  screenShareMode: "pip" | "presenter" | "fullscreen";
  screenShareX: number;
  screenShareY: number;
  screenShareW: number;
  screenShareRadius: number;
  // Donation gateway
  donationTickerActive: boolean;
  donationAlertActive: boolean;
  donationTicker: Array<{ name: string; amount: string; amountKes: number; color: string; ts: number; giftId?: string }>;
  giftDisplayMode: "auto" | "minimal" | "standard" | "hype";
}

let broadcastState: BroadcastState = {
  newsActive: false,
  newsText: "Welcome to the live stream! Stay tuned for more updates.",
  newsTitle: "",
  newsBgColor: "#cc0001",
  newsStyle: "Ticker",
  newsAnimation: "Fade",
  newsPosition: { x: 0, y: 95 },
  adActive: false,
  adText: "Big Sale — 50% Off Today Only!",
  adSub: "Use code LIVE at checkout.",
  adStyle: "Banner",
  adPosition: { x: 0, y: 0 },
  breakActive: false,
  breakText: "Be right back — taking a short break!",
  breakStyle: "Countdown",
  breakVideoUrl: "",
  breakVideoMode: "live-bg",
  breakVideoMuted: false,
  breakVideoPanX: 50,
  breakVideoPanY: 50,
  liveAudioMuted: false,
  chatStyle: "TV",
  statsActive: true,
  statsPosition: { x: 2, y: 2 },
  subsOverlayActive: false,
  subsStyle: "HUD",
  subsPosition: { x: 72, y: 2 },
  subsGoal: 1000000,
  subChartActive: false,
  subChartData: [],
  subChartPosition: { x: 68, y: 8 },
  mobileSubChartPosition: { x: 5, y: 8 },
  subAlertActive: false,
  subAlertMessage: "",
  chatBurnActive: false,
  chatBurnStyle: "Bubble",
  chatBurnPosition: { x: 2, y: 62 },
  superChatMessages: [],
  guestNameActive: false,
  guestName: "Guest Name",
  guestTitle: "Title / Channel",
  guestStyle: "Classic",
  guestPosition: { x: 2, y: 78 },
  mobileGuestPosition: { x: 2, y: 78 },
  bgGradientActive: false,
  bgGradient1: "#6d28d9",
  bgGradient2: "#0891b2",
  bgGradientOpacity: 0.45,
  mobileStatsPosition: { x: 2, y: 2 },
  mobileSubsPosition: { x: 60, y: 2 },
  mobileChatBurnPosition: { x: 2, y: 55 },
  mobileNewsPosition: { x: 0, y: 92 },
  mobileAdPosition: { x: 0, y: 0 },
  statsScale: 100,
  subsScale: 100,
  chatBurnScale: 100,
  newsScale: 100,
  adScale: 100,
  guestScale: 100,
  subChartScale: 100,
  globalStreamVolume: 100,
  qrActive: false,
  qrUrl: "",
  qrTitle: "",
  qrSize: 160,
  qrPosition: { x: 88, y: 10 },
  qrScanCount: 0,
  qrThankYouName: "",
  qrThankYouTs: 0,
  featuredComment: null,
  screenShareActive: false,
  screenShareMode: "presenter",
  screenShareX: 60,
  screenShareY: 5,
  screenShareW: 38,
  screenShareRadius: 16,
  donationTickerActive: false,
  donationAlertActive: true,
  donationTicker: [],
  giftDisplayMode: "auto",
};

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
// Purge leftover break-video files (prefix "break-") but NOT stream-source videos (prefix "stream-")
try {
  fs.readdirSync(uploadDir).forEach((f) => {
    if (f !== ".gitkeep" && f.startsWith("break-")) {
      try { fs.unlinkSync(path.join(uploadDir, f)); } catch {}
    }
  });
} catch {}

const multerStorage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `break-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage: multerStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v"];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

// Separate multer config for stream-source video uploads (preserved across restarts)
const streamVideoStorage = multer.diskStorage({
  destination: uploadDir,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    cb(null, `stream-${Date.now()}-${safeName}${ext}`);
  },
});
const uploadStreamVideo = multer({
  storage: streamVideoStorage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
  fileFilter: (_req, file, cb) => {
    const allowed = [".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".ts"];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

declare module "express-session" {
  interface SessionData {
    authenticated: boolean;
  }
}

const PASSWORD = process.env.BINTUNET_PASSWORD || "bintunet";

let inviteToken: string = crypto.randomBytes(6).toString("hex");

export async function registerBintunetRoutes(
  httpServer: Server,
  app: Express
): Promise<void> {
  const MemoryStore = (await import("memorystore")).default(session);

  app.use(
    session({
      secret: process.env.SESSION_SECRET || "bintunet-secret-key",
      resave: false,
      saveUninitialized: false,
      store: new MemoryStore({ checkPeriod: 86400000 }),
      cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: false,
        sameSite: "lax",
      },
    })
  );

  function requireAuth(req: Request, res: Response, next: NextFunction): void {
    if (!req.session?.authenticated) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    next();
  }

  function buildInviteUrl(req: Request): string {
    const proto =
      (req.get("x-forwarded-proto") as string | undefined)?.split(",")[0].trim() ||
      req.protocol;
    const host = req.get("x-forwarded-host") || req.get("host");
    return `${proto}://${host}/join?token=${inviteToken}`;
  }

  app.post("/api/auth/login", (req: Request, res: Response): void => {
    const { password } = req.body;
    if (password === PASSWORD) {
      req.session.authenticated = true;
      res.json({ success: true });
      return;
    }
    res.status(401).json({ message: "Invalid password" });
  });

  app.get("/api/auth/check", (req: Request, res: Response): void => {
    if (req.session?.authenticated) {
      res.json({ authenticated: true });
      return;
    }
    res.status(401).json({ authenticated: false });
  });

  app.post("/api/auth/logout", (req: Request, res: Response): void => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.get("/api/invite", requireAuth, (req: Request, res: Response): void => {
    res.json({ token: inviteToken, url: buildInviteUrl(req) });
  });

  app.post(
    "/api/invite/regenerate",
    requireAuth,
    (req: Request, res: Response): void => {
      inviteToken = crypto.randomBytes(6).toString("hex");
      res.json({ token: inviteToken, url: buildInviteUrl(req) });
    }
  );

  app.post("/api/invite/claim", (req: Request, res: Response): void => {
    const { token } = req.body;
    if (!token || token !== inviteToken) {
      res.status(401).json({ message: "Invalid or expired invite link." });
      return;
    }
    req.session.authenticated = true;
    res.json({ success: true });
  });

  // ── Generate a camera-guest token for an invite-authenticated user ─────────
  // Uses the sentinel streamId "__multiview__" — no FFmpeg stream, just WebRTC relay.
  app.post(
    "/api/invite/camera-token",
    requireAuth,
    (req: Request, res: Response): void => {
      const token = crypto.randomBytes(12).toString("hex");
      cameraTokens.set(token, { streamId: "__multiview__", expires: Date.now() + 24 * 60 * 60 * 1000 });
      const proto =
        (req.get("x-forwarded-proto") as string | undefined)?.split(",")[0].trim() ||
        req.protocol;
      const host = req.get("x-forwarded-host") || req.get("host");
      res.json({ token, url: `${proto}://${host}/camera/${token}` });
    }
  );

  app.get("/api/streams", requireAuth, (_req: Request, res: Response): void => {
    res.json(storage.getStreams());
  });

  app.post("/api/streams", requireAuth, (req: Request, res: Response): void => {
    try {
      const data = insertStreamSchema.parse(req.body);
      const stream = storage.createStream(data);
      res.json(stream);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch(
    "/api/streams/:id",
    requireAuth,
    (req: Request, res: Response): void => {
      const stream = storage.updateStream(String(req.params.id), req.body);
      if (!stream) {
        res.status(404).json({ message: "Stream not found" });
        return;
      }
      res.json(stream);
    }
  );

  app.delete(
    "/api/streams/:id",
    requireAuth,
    (req: Request, res: Response): void => {
      const id = String(req.params.id);
      // stopStream removes from activeStreams; safe to call even if not running.
      try { stopStream(id); } catch {}
      const deleted = storage.deleteStream(id);
      if (!deleted) {
        res.status(404).json({ message: "Stream not found" });
        return;
      }
      // Notify all frontends to remove the card and purge local data.
      broadcastStream(id, "deleted", {});
      res.json({ success: true });
    }
  );

  app.post(
    "/api/streams/:id/start",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        await startStream(String(req.params.id));
        res.json({ success: true });
      } catch (e: any) {
        res.status(400).json({ message: e.message });
      }
    }
  );

  app.post(
    "/api/streams/:id/stop",
    requireAuth,
    (req: Request, res: Response): void => {
      try {
        const id = String(req.params.id);
        // stopStream now deletes from activeStreams immediately, so handleProcessExit
        // won't fire and won't double-broadcast "deleted" when FFmpeg finally exits.
        stopStream(id);
        storage.deleteStream(id);
        // Notify all connected frontends to clean up stream state right away
        // (logs, stats, chat) — don't wait for FFmpeg to fully exit.
        broadcastStream(id, "deleted", {});
        res.json({ success: true });
      } catch (e: any) {
        res.status(400).json({ message: e.message });
      }
    }
  );

  app.post(
    "/api/streams/:id/restart",
    requireAuth,
    (req: Request, res: Response): void => {
      try {
        restartStream(String(req.params.id));
        res.json({ success: true });
      } catch (e: any) {
        res.status(400).json({ message: e.message });
      }
    }
  );

  app.post(
    "/api/streams/:id/mute",
    requireAuth,
    (req: Request, res: Response): void => {
      try {
        const { muted } = req.body;
        toggleMute(String(req.params.id), muted);
        res.json({ success: true });
      } catch (e: any) {
        res.status(400).json({ message: e.message });
      }
    }
  );

  // ── Upload a video file as the stream source ──────────────────────────────
  app.post(
    "/api/streams/:id/upload-video",
    requireAuth,
    uploadStreamVideo.single("video"),
    (req: Request, res: Response): void => {
      const id = String(req.params.id);
      const stream = storage.getStream(id);
      if (!stream) {
        res.status(404).json({ message: "Stream not found" });
        return;
      }
      if (!req.file) {
        res.status(400).json({ message: "No video file received or unsupported format (mp4, webm, mov, avi, mkv, m4v, ts)." });
        return;
      }
      // Delete old stream video for this stream if one exists and is different
      if (stream.uploadedVideoPath && stream.uploadedVideoPath !== req.file.path) {
        try { if (fs.existsSync(stream.uploadedVideoPath)) fs.unlinkSync(stream.uploadedVideoPath); } catch {}
      }
      storage.updateStream(id, { uploadedVideoPath: req.file.path });
      res.json({
        success: true,
        path: req.file.path,
        filename: req.file.originalname,
        size: req.file.size,
      });
    }
  );

  // Delete uploaded stream video
  app.delete(
    "/api/streams/:id/upload-video",
    requireAuth,
    (req: Request, res: Response): void => {
      const id = String(req.params.id);
      const stream = storage.getStream(id);
      if (!stream) { res.status(404).json({ message: "Stream not found" }); return; }
      if (stream.uploadedVideoPath) {
        try { if (fs.existsSync(stream.uploadedVideoPath)) fs.unlinkSync(stream.uploadedVideoPath); } catch {}
        storage.updateStream(id, { uploadedVideoPath: "" });
      }
      res.json({ success: true });
    }
  );

  app.get(
    "/api/streams/:id/preview",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const stream = storage.getStream(String(req.params.id));
        if (!stream) {
          res.status(404).json({ message: "Stream not found" });
          return;
        }
        if (!stream.tiktokUsername) {
          res.status(400).json({ message: "No TikTok username set" });
          return;
        }
        const url = await getTikTokStreamUrl(stream.tiktokUsername, stream.quality || "best");
        const isHls = url.includes(".m3u8");
        res.json({
          isLive: true,
          hlsUrl: isHls ? url : null,
          flvUrl: isHls ? null : url,
          title: null,
          roomId: "streamlink",
        });
      } catch (e: any) {
        res.status(400).json({ message: e.message, isLive: false });
      }
    }
  );

  app.get(
    "/api/preview/:username",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const url = await getTikTokStreamUrl(String(req.params.username), "best");
        const isHls = url.includes(".m3u8");
        res.json({
          isLive: true,
          hlsUrl: isHls ? url : null,
          flvUrl: isHls ? null : url,
          title: null,
          roomId: "streamlink",
        });
      } catch (e: any) {
        res.status(400).json({ message: e.message, isLive: false });
      }
    }
  );

  // ── Resolve a preview source (TikTok username → HLS, YouTube URL → embed) ──
  app.post(
    "/api/preview/resolve",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const { type, value } = req.body as { type?: string; value?: string };
      if (!type || !value) { res.status(400).json({ message: "type and value required" }); return; }

      if (type === "tiktok") {
        const username = value.replace(/^@/, "").trim();
        try {
          const url = await getTikTokStreamUrl(username, "best");
          const isHls = url.includes(".m3u8");
          res.json({ type: isHls ? "hls" : "none", url: isHls ? url : null });
        } catch (e: any) {
          res.status(400).json({ message: e.message || "User not live or not found" });
        }
        return;
      }

      if (type === "youtube") {
        const ytMatch = value.match(/(?:v=|youtu\.be\/|\/shorts\/|\/live\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
        const videoId = ytMatch?.[1];
        if (!videoId) { res.status(400).json({ message: "Could not extract YouTube video ID" }); return; }
        res.json({
          type: "youtube-embed",
          url: null,
          embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=1`,
        });
        return;
      }

      if (type === "hls") {
        const url = value.trim();
        if (!url.includes(".m3u8") && !url.startsWith("http")) {
          res.status(400).json({ message: "URL must be a valid HLS .m3u8 link" }); return;
        }
        res.json({ type: "hls", url });
        return;
      }

      res.status(400).json({ message: "Unknown type" });
    }
  );

  // ── Monitor Preview — works for all source types ───────────────────────────
  app.get(
    "/api/streams/:id/monitor-preview",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const stream = storage.getStream(String(req.params.id));
      if (!stream) { res.status(404).json({ type: "none" }); return; }

      if (stream.sourceType === "tiktok" && stream.tiktokUsername) {
        try {
          const url = await getTikTokStreamUrl(stream.tiktokUsername, stream.quality || "best");
          const isHls = url.includes(".m3u8");
          res.json({ type: isHls ? "hls" : "none", url: isHls ? url : null, embedUrl: null });
        } catch {
          res.json({ type: "none", url: null, embedUrl: null });
        }
        return;
      }

      if (stream.sourceType === "youtube" && stream.youtubeSourceUrl) {
        const ytMatch = stream.youtubeSourceUrl.match(/(?:v=|youtu\.be\/|\/shorts\/|\/live\/|\/embed\/)([a-zA-Z0-9_-]{11})/);
        const videoId = ytMatch?.[1];
        if (videoId) {
          res.json({
            type: "youtube-embed",
            url: null,
            embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=1`,
          });
        } else {
          res.json({ type: "none", url: null, embedUrl: null });
        }
        return;
      }

      if (stream.sourceType === "upload" && stream.uploadedVideoPath) {
        const filename = path.basename(stream.uploadedVideoPath);
        res.json({ type: "file", url: `/api/uploads/${filename}`, embedUrl: null });
        return;
      }

      res.json({ type: "none", url: null, embedUrl: null });
    }
  );

  // ── Break Video Preload ─────────────────────────────────────────────────────
  app.post(
    "/api/break-video/preload",
    requireAuth,
    (req: Request, res: Response): void => {
      const { url } = req.body as { url?: string };
      if (!url || typeof url !== "string") {
        res.status(400).json({ message: "url required" });
        return;
      }
      preloadBreakVideo(url.trim());
      res.json({ message: "preload started" });
    }
  );

  app.get(
    "/api/break-video/preload-status",
    requireAuth,
    (req: Request, res: Response): void => {
      const url = String(req.query.url ?? "");
      if (!url) { res.status(400).json({ message: "url required" }); return; }
      const entry = getBreakVideoPreloadStatus(url);
      if (!entry) { res.json({ status: "idle" }); return; }
      res.json({ status: entry.status, error: entry.error });
    }
  );

  const cameraTokens = new Map<string, { streamId: string; expires: number }>();

  app.get(
    "/api/streams/:id/camera-token",
    requireAuth,
    (req: Request, res: Response): void => {
      const streamId = String(req.params.id);
      const stream = storage.getStream(streamId);
      if (!stream) {
        res.status(404).json({ message: "Stream not found" });
        return;
      }
      const token = crypto.randomBytes(12).toString("hex");
      cameraTokens.set(token, { streamId, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 });
      const proto =
        (req.get("x-forwarded-proto") as string | undefined)?.split(",")[0].trim() ||
        req.protocol;
      const host = req.get("x-forwarded-host") || req.get("host");
      const url = `${proto}://${host}/camera/${token}`;
      setCameraLink(streamId, url);
      res.json({ token, url });
    }
  );

  app.get(
    "/api/camera/:token",
    async (req: Request, res: Response): Promise<void> => {
      const entry = cameraTokens.get(String(req.params.token));
      if (!entry || Date.now() > entry.expires) {
        res.status(404).json({ message: "Invalid or expired camera link" });
        return;
      }
      const stream = storage.getStream(entry.streamId);
      if (!stream) {
        res.status(404).json({ message: "Stream not found" });
        return;
      }
      res.json({
        streamId: entry.streamId,
        youtubeChannelId: stream.youtubeChannelId,
        status: stream.status,
        sourceType: stream.sourceType,
      });
    }
  );

  app.get(
    "/api/streams/:id/chat",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
      const streamId = String(req.params.id);
      const chatId = getLiveChatId(streamId);
      if (!chatId) {
        res.json({ messages: [], hasChat: false });
        return;
      }
      try {
        const messages = await fetchLiveChat(streamId, chatId);
        res.json({ messages, hasChat: true });
      } catch (e: any) {
        res.status(400).json({ message: e.message });
      }
    }
  );

  app.get(
    "/api/camera/:token/chat",
    async (req: Request, res: Response): Promise<void> => {
      const entry = cameraTokens.get(String(req.params.token));
      if (!entry || Date.now() > entry.expires) {
        res.status(404).json({ message: "Invalid or expired camera link" });
        return;
      }
      const chatId = getLiveChatId(entry.streamId);
      if (!chatId) {
        res.json({ messages: [], hasChat: false });
        return;
      }
      try {
        const messages = await fetchLiveChat(entry.streamId, chatId);
        res.json({ messages, hasChat: true });
      } catch (e: any) {
        res.status(400).json({ message: e.message });
      }
    }
  );

  app.get(
    "/api/camera/:token/stats",
    async (req: Request, res: Response): Promise<void> => {
      const entry = cameraTokens.get(String(req.params.token));
      if (!entry || Date.now() > entry.expires) {
        res.status(404).json({ message: "Invalid or expired camera link" });
        return;
      }
      const stream = storage.getStream(entry.streamId);
      const { subs, viewers } = getLiveStats(entry.streamId);
      res.json({
        subs,
        viewers,
        status: stream?.status ?? "idle",
      });
    }
  );

  // ── Broadcast state ──────────────────────────────────────────────────────
  app.get("/api/broadcast", (_req: Request, res: Response): void => {
    res.json(broadcastState);
  });

  app.post("/api/broadcast", requireAuth, (req: Request, res: Response): void => {
    broadcastState = { ...broadcastState, ...req.body };
    broadcastGlobal("broadcast", broadcastState);

    // Propagate stream volume immediately (triggers fast FFmpeg restart on all active streams)
    if (req.body.globalStreamVolume !== undefined) {
      updateStreamVolume(broadcastState.globalStreamVolume);
    }

    updateStreamOverlays({
      newsActive:             broadcastState.newsActive,
      newsText:               broadcastState.newsText,
      newsTitle:              broadcastState.newsTitle,
      newsBgColor:            broadcastState.newsBgColor,
      newsStyle:              broadcastState.newsStyle,
      newsAnimation:          broadcastState.newsAnimation,
      newsPosition:           broadcastState.newsPosition,
      adActive:               broadcastState.adActive,
      adText:                 broadcastState.adText,
      adSub:                  broadcastState.adSub,
      adStyle:                broadcastState.adStyle,
      adPosition:             broadcastState.adPosition,
      breakActive:            broadcastState.breakActive,
      breakText:              broadcastState.breakText,
      breakStyle:             broadcastState.breakStyle,
      breakVideoUrl:          broadcastState.breakVideoUrl,
      breakVideoMode:         broadcastState.breakVideoMode,
      breakVideoPanX:         broadcastState.breakVideoPanX,
      breakVideoPanY:         broadcastState.breakVideoPanY,
      liveAudioMuted:         broadcastState.liveAudioMuted,
      breakVideoMuted:        broadcastState.breakVideoMuted,
      statsActive:            broadcastState.statsActive,
      statsPosition:          broadcastState.statsPosition,
      subsOverlayActive:      broadcastState.subsOverlayActive,
      subsStyle:              broadcastState.subsStyle,
      subsPosition:           broadcastState.subsPosition,
      subsGoal:               broadcastState.subsGoal,
      subChartActive:         broadcastState.subChartActive,
      subChartData:           broadcastState.subChartData,
      subChartPosition:       broadcastState.subChartPosition,
      mobileSubChartPosition: broadcastState.mobileSubChartPosition,
      subAlertActive:         broadcastState.subAlertActive,
      subAlertMessage:        broadcastState.subAlertMessage,
      chatBurnActive:         broadcastState.chatBurnActive,
      chatBurnStyle:          broadcastState.chatBurnStyle,
      chatBurnPosition:       broadcastState.chatBurnPosition,
      superChatMessages:      broadcastState.superChatMessages,
      guestNameActive:        broadcastState.guestNameActive,
      guestName:              broadcastState.guestName,
      guestTitle:             broadcastState.guestTitle,
      guestStyle:             broadcastState.guestStyle,
      guestPosition:          broadcastState.guestPosition,
      mobileGuestPosition:    broadcastState.mobileGuestPosition,
      bgGradientActive:       broadcastState.bgGradientActive,
      bgGradient1:            broadcastState.bgGradient1,
      bgGradient2:            broadcastState.bgGradient2,
      bgGradientOpacity:      broadcastState.bgGradientOpacity,
      mobileStatsPosition:    broadcastState.mobileStatsPosition,
      mobileSubsPosition:     broadcastState.mobileSubsPosition,
      mobileChatBurnPosition: broadcastState.mobileChatBurnPosition,
      mobileNewsPosition:     broadcastState.mobileNewsPosition,
      mobileAdPosition:       broadcastState.mobileAdPosition,
      statsScale:             broadcastState.statsScale,
      subsScale:              broadcastState.subsScale,
      chatBurnScale:          broadcastState.chatBurnScale,
      newsScale:              broadcastState.newsScale,
      adScale:                broadcastState.adScale,
      guestScale:             broadcastState.guestScale,
      subChartScale:          broadcastState.subChartScale,
      qrActive:               broadcastState.qrActive,
      qrUrl:                  broadcastState.qrUrl,
      qrTitle:                broadcastState.qrTitle,
      qrSize:                 broadcastState.qrSize,
      qrPosition:             broadcastState.qrPosition,
      qrScanCount:            getQRScanCount(),
      qrThankYouActive:       (Date.now() - broadcastState.qrThankYouTs) < 11_000 && !!broadcastState.qrThankYouName,
      qrThankYouName:         broadcastState.qrThankYouName,
      qrThankYouTs:           broadcastState.qrThankYouTs,
      featuredComment:        broadcastState.featuredComment,
      screenShareActive:      broadcastState.screenShareActive,
      screenShareMode:        broadcastState.screenShareMode,
      screenShareX:           broadcastState.screenShareX,
      screenShareY:           broadcastState.screenShareY,
      screenShareW:           broadcastState.screenShareW,
      screenShareRadius:      broadcastState.screenShareRadius,
      donationTickerActive:   broadcastState.donationTickerActive,
      donationAlertActive:    broadcastState.donationAlertActive,
      donationTicker:         broadcastState.donationTicker,
      giftDisplayMode:        broadcastState.giftDisplayMode,
      giftQueue:              getGiftQueue(),
    });
    res.json(broadcastState);
  });

  // ── Music URL resolve + proxy ─────────────────────────────────────────────
  // Store the original source URL (not the CDN URL) — the CDN URL is session-
  // tied and returns 403 when fetched outside yt-dlp's own session. Instead,
  // re-invoke yt-dlp at proxy time and pipe its stdout straight to the client.
  const musicProxyTokens = new Map<string, { originalUrl: string; title: string }>();

  app.post("/api/music/resolve", requireAuth, async (req: Request, res: Response): Promise<void> => {
    const { url } = req.body as { url?: string };
    if (!url?.trim()) { res.status(400).json({ error: "url is required" }); return; }

    const { spawn } = await import("child_process");
    const { getCookiesArgs } = await import("./youtube-source");
    const cookieArgs = getCookiesArgs();

    // Only fetch the title — no CDN URL needed at resolve time
    const args = [
      "--get-title",
      "--no-playlist",
      "--no-check-certificate",
      "--socket-timeout", "20",
      "--extractor-args", "youtube:player_client=ios,mweb,android;formats=missing_pot",
      ...cookieArgs,
      url.trim(),
    ];

    let stdout = "";
    let stderr = "";

    const proc = spawn("yt-dlp", args);
    proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") { res.status(500).json({ error: "yt-dlp is not installed on the server." }); }
      else { res.status(500).json({ error: err.message }); }
    });

    proc.on("close", (code: number | null) => {
      if (code !== 0) {
        const msg = stderr.includes("Sign in") ? "YouTube requires sign-in. Upload a cookies.txt file in the Cookies tab." :
                    stderr.includes("not a bot") ? "YouTube bot-detection triggered. Try uploading a cookies.txt file." :
                    `yt-dlp exited with code ${code}: ${stderr.slice(0, 300)}`;
        res.status(500).json({ error: msg });
        return;
      }

      const title = stdout.trim() || "Unknown Track";
      const token = crypto.randomUUID();
      musicProxyTokens.set(token, { originalUrl: url.trim(), title });
      // Auto-expire after 24 hours (token points to original URL, always fresh)
      setTimeout(() => musicProxyTokens.delete(token), 24 * 60 * 60 * 1000);

      res.json({ proxyUrl: `/api/music/proxy/${token}`, title });
    });
  });

  // Stream audio by piping yt-dlp stdout directly — avoids the 403 that occurs
  // when Node fetch() tries to use a session-tied CDN URL from a different session.
  // NOTE: no requireAuth here — the UUID token IS the credential. The audio element
  // uses crossOrigin="anonymous" so it sends no cookies; requireAuth would always 401.
  app.get("/api/music/proxy/:token", (req: Request, res: Response): void => {
    const entry = musicProxyTokens.get(String(req.params.token));
    if (!entry) {
      res.status(404).json({ error: "Track not found or session expired. Re-add the track." });
      return;
    }

    import("child_process").then(({ spawn }) => {
      import("./youtube-source").then(({ getCookiesArgs }) => {
        const cookieArgs = getCookiesArgs();
        const args = [
          "--no-playlist",
          "--format", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
          "--no-check-certificate",
          "--socket-timeout", "30",
          "--extractor-args", "youtube:player_client=ios,mweb,android;formats=missing_pot",
          "--output", "-",          // pipe audio bytes to stdout
          "--quiet",                // silence progress to stderr
          ...cookieArgs,
          entry.originalUrl,
        ];

        const ytdlp = spawn("yt-dlp", args);

        // Detect format from first chunk to set Content-Type
        let headersSent = false;
        const setHeaders = (chunk: Buffer) => {
          if (headersSent) return;
          headersSent = true;
          // Sniff magic bytes: ftyp M4A = 0x66747970, WebM = 0x1a45dfa3
          let ct = "audio/mp4";
          if (chunk.length >= 4 && chunk[0] === 0x1a && chunk[1] === 0x45) ct = "audio/webm";
          res.setHeader("Content-Type", ct);
          res.setHeader("Accept-Ranges", "none");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Transfer-Encoding", "chunked");
        };

        ytdlp.stdout.on("data", (chunk: Buffer) => {
          setHeaders(chunk);
          if (!res.writableEnded) res.write(chunk);
        });

        ytdlp.stderr.on("data", (d: Buffer) => {
          const line = d.toString();
          // Only log actual errors, not progress
          if (line.includes("ERROR") || line.includes("error")) {
            console.error("[music-proxy] yt-dlp:", line.trim());
          }
        });

        ytdlp.on("close", (code) => {
          if (!headersSent && !res.headersSent) {
            res.status(502).json({ error: code !== 0 ? "yt-dlp failed to stream audio. Check server logs." : "Empty audio stream." });
          } else if (!res.writableEnded) {
            res.end();
          }
        });

        ytdlp.on("error", (err: NodeJS.ErrnoException) => {
          if (!res.headersSent) {
            res.status(500).json({ error: err.code === "ENOENT" ? "yt-dlp is not installed." : err.message });
          }
        });

        // Kill yt-dlp when client disconnects (e.g. user pauses or closes tab)
        req.on("close", () => {
          if (!ytdlp.killed) ytdlp.kill("SIGTERM");
        });
      });
    });
  });

  // ── Break video upload ────────────────────────────────────────────────────
  app.post(
    "/api/upload/break-video",
    requireAuth,
    upload.single("video"),
    (req: Request, res: Response): void => {
      if (!req.file) {
        res.status(400).json({ message: "No video file provided or unsupported format." });
        return;
      }
      const fileUrl = `/api/uploads/${req.file.filename}`;
      res.json({ url: fileUrl, filename: req.file.filename, size: req.file.size });
    }
  );

  app.get("/api/uploads/:filename", (req: Request, res: Response): void => {
    const filename = path.basename(String(req.params.filename));
    const filePath = path.join(uploadDir, filename);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ message: "File not found" });
      return;
    }
    res.sendFile(filePath);
  });

  // ── YouTube Cookies management ─────────────────────────────────────────────
  // Cookies are stored as cookies.txt (Netscape format) at <cwd>/cookies.txt.
  // They allow yt-dlp to bypass bot detection and age restrictions on YouTube.
  const cookiesUpload = multer({ dest: uploadDir });
  const cookiesPath = path.join(process.cwd(), "cookies.txt");

  app.get("/api/settings/cookies", requireAuth, (_req: Request, res: Response): void => {
    res.json({ configured: fs.existsSync(cookiesPath) });
  });

  app.post(
    "/api/settings/cookies",
    requireAuth,
    cookiesUpload.single("cookies"),
    (req: Request, res: Response): void => {
      if (!req.file) {
        res.status(400).json({ message: "No cookies file provided" });
        return;
      }
      // Move temp upload to the dedicated cookies.txt path
      fs.renameSync(req.file.path, cookiesPath);
      res.json({ ok: true, message: "Cookies saved — YouTube URLs will now use them" });
    }
  );

  app.delete("/api/settings/cookies", requireAuth, (_req: Request, res: Response): void => {
    if (fs.existsSync(cookiesPath)) fs.unlinkSync(cookiesPath);
    res.json({ ok: true, message: "Cookies removed" });
  });

  // ── TikTok Cookies management ──────────────────────────────────────────────
  // Separate cookies.txt for TikTok (tiktok.com domain cookies).
  // Used by streamlink (--http-cookie-jar) and yt-dlp (--cookies).
  const tikTokCookiesUpload = multer({ dest: uploadDir });
  const tikTokCookiesPath = path.join(process.cwd(), "tiktok-cookies.txt");

  app.get("/api/settings/tiktok-cookies", requireAuth, (_req: Request, res: Response): void => {
    res.json({ configured: fs.existsSync(tikTokCookiesPath) });
  });

  app.post(
    "/api/settings/tiktok-cookies",
    requireAuth,
    tikTokCookiesUpload.single("cookies"),
    (req: Request, res: Response): void => {
      if (!req.file) {
        res.status(400).json({ message: "No cookies file provided" });
        return;
      }
      fs.renameSync(req.file.path, tikTokCookiesPath);
      res.json({ ok: true, message: "TikTok cookies saved" });
    }
  );

  app.delete("/api/settings/tiktok-cookies", requireAuth, (_req: Request, res: Response): void => {
    if (fs.existsSync(tikTokCookiesPath)) fs.unlinkSync(tikTokCookiesPath);
    res.json({ ok: true, message: "TikTok cookies removed" });
  });

  // ── Connected camera guests (for WebRTC multi-view relay) ────────────────
  const connectedCamGuests = new Map<string, { ws: any; streamId: string; guestName: string }>();
  // Guests waiting for host approval
  const pendingCamGuests = new Map<string, { ws: any; streamId: string; guestName: string }>();

  app.get("/api/cam-guests", requireAuth, (_req: Request, res: Response): void => {
    const connected = Array.from(connectedCamGuests.entries()).map(([guestId, g]) => ({
      guestId, streamId: g.streamId, guestName: g.guestName, pending: false,
    }));
    const pending = Array.from(pendingCamGuests.entries()).map(([guestId, g]) => ({
      guestId, streamId: g.streamId, guestName: g.guestName, pending: true,
    }));
    res.json([...connected, ...pending]);
  });

  app.post("/api/cam-guests/:guestId/approve", requireAuth, (req: Request, res: Response): void => {
    const guestId = String(req.params.guestId);
    const entry = pendingCamGuests.get(guestId);
    if (!entry) { res.status(404).json({ message: "Guest not found in waiting room" }); return; }
    pendingCamGuests.delete(guestId);
    connectedCamGuests.set(guestId, entry);
    if (entry.ws.readyState === 1) {
      entry.ws.send(JSON.stringify({ type: "cam_approved" }));
    }
    const payload = JSON.stringify({ type: "cam_guest_join", guestId, streamId: entry.streamId, guestName: entry.guestName });
    for (const client of wss.clients) {
      if ((client as any).readyState === 1) (client as any).send(payload);
    }
    res.json({ success: true });
  });

  app.post("/api/cam-guests/:guestId/reject", requireAuth, (req: Request, res: Response): void => {
    const guestId = String(req.params.guestId);
    const entry = pendingCamGuests.get(guestId);
    if (!entry) { res.status(404).json({ message: "Guest not found" }); return; }
    pendingCamGuests.delete(guestId);
    if (entry.ws.readyState === 1) {
      entry.ws.send(JSON.stringify({ type: "cam_rejected", message: "The host declined your request to join." }));
    }
    const payload = JSON.stringify({ type: "cam_guest_leave", guestId });
    for (const client of wss.clients) {
      if ((client as any).readyState === 1) (client as any).send(payload);
    }
    res.json({ success: true });
  });

  // Use noServer:true for all WebSocket servers and route upgrades manually.
  // If multiple WebSocketServer instances share the same httpServer via the
  // `server` option, the ws library calls abortHandshake() when a path
  // doesn't match — destroying the socket before the correct server handles it.
  const wss    = new WebSocketServer({ noServer: true });
  const micWss = new WebSocketServer({ noServer: true });
  const camWss = new WebSocketServer({ noServer: true });
  const screenWss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    const pathname = url.split("?")[0];
    const route = (target: typeof wss) => {
      target.handleUpgrade(req, socket, head, (ws) => target.emit("connection", ws, req));
    };
    if (pathname === "/ws")         return route(wss);
    if (pathname === "/ws-mic")     return route(micWss);
    if (pathname === "/ws-cam")     return route(camWss);
    if (pathname === "/ws-screen")  return route(screenWss);
    socket.destroy();
  });

  wss.on("connection", (ws) => {
    addWSClient(ws);
    if (ws.readyState === ws.OPEN) {
      // Send current broadcast state so stage page syncs instantly
      ws.send(JSON.stringify({ type: "broadcast", streamId: null, data: broadcastState }));
      // Replay buffered logs for all active streams so a page-refresh doesn't lose history
      for (const [streamId, lines] of getStreamLogBuffers()) {
        for (const data of lines) {
          ws.send(JSON.stringify({ type: "log", streamId, data }));
        }
      }
      // Send currently connected guests so multi-view panel can populate immediately
      const guestsList = Array.from(connectedCamGuests.entries()).map(([guestId, g]) => ({
        guestId, streamId: g.streamId, guestName: g.guestName,
      }));
      if (guestsList.length > 0) {
        ws.send(JSON.stringify({ type: "cam_guests_list", guests: guestsList }));
      }
      // Send pending guests (waiting room)
      const pendingList = Array.from(pendingCamGuests.entries()).map(([guestId, g]) => ({
        guestId, streamId: g.streamId, guestName: g.guestName,
      }));
      if (pendingList.length > 0) {
        ws.send(JSON.stringify({ type: "cam_guests_pending_list", guests: pendingList }));
      }
    }

    // Relay admin→guest WebRTC signaling (works for both connected and pending guests)
    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "rtc_offer" && msg.guestId && msg.sdp) {
          const guest = connectedCamGuests.get(msg.guestId) ?? pendingCamGuests.get(msg.guestId);
          if (guest && guest.ws.readyState === 1) {
            guest.ws.send(JSON.stringify({ type: "rtc_offer", sdp: msg.sdp }));
          }
        }
        if (msg.type === "rtc_ice_admin" && msg.guestId && msg.candidate) {
          const guest = connectedCamGuests.get(msg.guestId) ?? pendingCamGuests.get(msg.guestId);
          if (guest && guest.ws.readyState === 1) {
            guest.ws.send(JSON.stringify({ type: "rtc_ice", candidate: msg.candidate }));
          }
        }
      } catch {}
    });
  });

  // ── /ws-mic — browser microphone → FFmpeg pipe:5 (PCM16 mono 44100 Hz) ──
  micWss.on("connection", (ws) => {
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        feedMicAudio(data as Buffer);
      }
    });
  });

  // ── /ws-screen — browser screen-share JPEG frames → uiRenderer PIP ──────
  screenWss.on("connection", (ws) => {
    let authenticated = false;
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        if (authenticated) setScreenShareFrameForAll(data as Buffer);
        return;
      }
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "screen_auth" && msg.sessionId) {
          authenticated = true;
          ws.send(JSON.stringify({ type: "screen_auth_ok" }));
        }
      } catch {}
    });
    ws.on("close", () => { authenticated = false; });
  });

  // ── /ws-cam — browser camera WebM → FFmpeg stdin + WebRTC multi-view ───
  camWss.on("connection", (ws) => {
    let camStreamId: string | null = null;
    let authenticated = false;
    let currentGuestId: string | null = null;

    const broadcastToAdmins = (msg: object) => {
      const payload = JSON.stringify(msg);
      for (const client of wss.clients) {
        if ((client as any).readyState === 1) (client as any).send(payload);
      }
    };

    const isMultiviewGuest = () => camStreamId === "__multiview__";

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        if (authenticated && camStreamId && !isMultiviewGuest()) writeToBrowserCamera(camStreamId, data as Buffer);
        return;
      }
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === "cam_auth") {
          const entry = cameraTokens.get(String(msg.token));
          if (!entry || Date.now() > entry.expires) {
            ws.send(JSON.stringify({ type: "cam_auth_fail", message: "Invalid or expired camera link" }));
            return;
          }
          authenticated = true;
          camStreamId = entry.streamId;
          const stream = storage.getStream(entry.streamId);
          ws.send(JSON.stringify({ type: "cam_auth_ok", streamId: entry.streamId, streamStatus: stream?.status || "idle" }));
          return;
        }

        if (!authenticated || !camStreamId) return;

        // Guest announces they're joining — goes into pending waiting room
        if (msg.type === "cam_join") {
          const guestId = crypto.randomUUID();
          currentGuestId = guestId;
          const guestName = String(msg.guestName || "Guest").slice(0, 50);
          pendingCamGuests.set(guestId, { ws, streamId: camStreamId, guestName });
          broadcastToAdmins({ type: "cam_guest_pending", guestId, streamId: camStreamId, guestName });
          ws.send(JSON.stringify({ type: "cam_pending", guestId }));
          return;
        }

        // Update guest display name after join
        if (msg.type === "cam_guest_name" && currentGuestId) {
          const guestName = String(msg.guestName || "Guest").slice(0, 50);
          const entry = connectedCamGuests.get(currentGuestId);
          if (entry) {
            entry.guestName = guestName;
            broadcastToAdmins({ type: "cam_guest_update", guestId: currentGuestId, guestName });
          }
          return;
        }

        // Relay WebRTC answer from guest → admin dashboards
        if (msg.type === "rtc_answer" && msg.sdp && currentGuestId) {
          broadcastToAdmins({ type: "rtc_answer", guestId: currentGuestId, sdp: msg.sdp });
          return;
        }

        // Relay ICE candidates from guest → admin dashboards
        if (msg.type === "rtc_ice" && msg.candidate && currentGuestId) {
          broadcastToAdmins({ type: "rtc_ice_guest", guestId: currentGuestId, candidate: msg.candidate });
          return;
        }

        if (msg.type === "cam_start") {
          if (!isMultiviewGuest()) {
            browserCameraStreams.add(camStreamId);
            const stream = storage.getStream(camStreamId);
            if (stream) {
              startStream(camStreamId).catch((e: any) => {
                ws.send(JSON.stringify({ type: "cam_error", message: e.message }));
              });
            }
          } else {
            ws.send(JSON.stringify({ type: "cam_auth_ok", streamId: "__multiview__", streamStatus: "idle" }));
          }
        }

        if (msg.type === "cam_stop") {
          if (!isMultiviewGuest()) {
            browserCameraStreams.delete(camStreamId);
            stopStream(camStreamId);
          }
          ws.send(JSON.stringify({ type: "cam_stopped" }));
        }
      } catch {}
    });

    ws.on("close", () => {
      if (currentGuestId) {
        const wasConnected = connectedCamGuests.delete(currentGuestId);
        const wasPending = pendingCamGuests.delete(currentGuestId);
        if (wasConnected || wasPending) {
          broadcastToAdmins({ type: "cam_guest_leave", guestId: currentGuestId });
        }
      }
      if (camStreamId && !isMultiviewGuest()) {
        browserCameraStreams.delete(camStreamId);
        stopStream(camStreamId);
      }
    });
  });

  // ── AI Stream Controller ─────────────────────────────────────────────────
  import("./ai-assistant").then(({ processAIMessage }) => {
    app.post(
      "/api/ai/chat",
      requireAuth,
      async (req: Request, res: Response): Promise<void> => {
        try {
          const { message, history = [] } = req.body as {
            message: string;
            history: { role: "user" | "assistant"; content: string }[];
          };
          if (!message?.trim()) {
            res.status(400).json({ error: "message required" });
            return;
          }
          // Inject current broadcast state as context so AI knows what's active
          const ctx = [
            broadcastState.breakActive ? "break=ON" : "break=OFF",
            broadcastState.newsActive ? `news=ON:"${broadcastState.newsText}"` : "news=OFF",
            broadcastState.adActive ? "ad=ON" : "ad=OFF",
            broadcastState.chatBurnActive ? "chat=ON" : "chat=OFF",
            broadcastState.statsActive ? "stats=ON" : "stats=OFF",
            broadcastState.subsOverlayActive ? "subs=ON" : "subs=OFF",
            broadcastState.liveAudioMuted ? "streamAudio=MUTED" : "streamAudio=ON",
            `vol=${broadcastState.globalStreamVolume ?? 100}`,
          ].join(" | ");

          const streams = storage.getStreams();
          const streamCtx = streams.map((s: import("./schema").StreamConfig, i: number) =>
            `stream${i + 1}:${s.sourceType}/${s.tiktokUsername || s.youtubeSourceUrl || s.cameraDevice || "unnamed"}(${s.status})`
          ).join(", ");

          const enrichedMessage = `${message}\n\n[dashboard: ${ctx}]\n[streams: ${streamCtx || "none"}]`;

          const result = await processAIMessage(enrichedMessage, history);

          // Execute action server-side if present
          if (result.action) {
            const { type, params } = result.action;
            const p = params as Record<string, unknown>;

            const patch: Partial<typeof broadcastState> = {};

            if (type === "go_break") {
              patch.breakActive = true;
            } else if (type === "stop_break") {
              patch.breakActive = false;
            } else if (type === "set_break_text") {
              patch.breakText = String(p.text ?? "");
            } else if (type === "set_break_style") {
              patch.breakStyle = String(p.style ?? "Countdown");
            } else if (type === "enable_news") {
              patch.newsActive = true;
              if (p.text) patch.newsText = String(p.text);
              if (p.style) patch.newsStyle = String(p.style);
            } else if (type === "disable_news") {
              patch.newsActive = false;
            } else if (type === "set_news_text") {
              patch.newsText = String(p.text ?? "");
            } else if (type === "set_news_style") {
              patch.newsStyle = String(p.style ?? "Ticker");
            } else if (type === "set_news_color") {
              patch.newsBgColor = String(p.color ?? "#cc0001");
            } else if (type === "enable_ad") {
              patch.adActive = true;
              if (p.text) patch.adText = String(p.text);
              if (p.sub) patch.adSub = String(p.sub);
            } else if (type === "disable_ad") {
              patch.adActive = false;
            } else if (type === "set_ad_text") {
              patch.adText = String(p.text ?? "");
            } else if (type === "set_ad_sub") {
              patch.adSub = String(p.sub ?? "");
            } else if (type === "enable_stats") {
              patch.statsActive = true;
            } else if (type === "disable_stats") {
              patch.statsActive = false;
            } else if (type === "enable_subs") {
              patch.subsOverlayActive = true;
            } else if (type === "disable_subs") {
              patch.subsOverlayActive = false;
            } else if (type === "set_subs_goal") {
              patch.subsGoal = Number(p.goal ?? 1000000);
            } else if (type === "enable_chat") {
              patch.chatBurnActive = true;
            } else if (type === "disable_chat") {
              patch.chatBurnActive = false;
            } else if (type === "set_chat_style") {
              patch.chatBurnStyle = String(p.style ?? "Bubble");
            } else if (type === "enable_gradient") {
              patch.bgGradientActive = true;
            } else if (type === "disable_gradient") {
              patch.bgGradientActive = false;
            } else if (type === "set_gradient") {
              if (p.color1) patch.bgGradient1 = String(p.color1);
              if (p.color2) patch.bgGradient2 = String(p.color2);
            } else if (type === "mute_stream_audio") {
              patch.liveAudioMuted = true;
            } else if (type === "unmute_stream_audio") {
              patch.liveAudioMuted = false;
            } else if (type === "mute_break_video") {
              patch.breakVideoMuted = true;
            } else if (type === "unmute_break_video") {
              patch.breakVideoMuted = false;
            } else if (type === "set_volume") {
              patch.globalStreamVolume = Math.max(0, Math.min(100, Number(p.volume ?? 100)));
            } else if (type === "start_stream") {
              const target = String(p.target ?? "");
              const allStreams = storage.getStreams();
              if (target === "all") {
                allStreams.forEach((s) => startStream(s.id).catch(() => {}));
              } else {
                const idx = parseInt(target) - 1;
                if (allStreams[idx]) startStream(allStreams[idx].id).catch(() => {});
              }
            } else if (type === "stop_stream") {
              const target = String(p.target ?? "");
              const allStreams = storage.getStreams();
              if (target === "all") {
                allStreams.forEach((s) => stopStream(s.id));
              } else {
                const idx = parseInt(target) - 1;
                if (allStreams[idx]) stopStream(allStreams[idx].id);
              }
            } else if (type === "restart_stream") {
              const target = String(p.target ?? "");
              const allStreams = storage.getStreams();
              const idx = parseInt(target) - 1;
              if (allStreams[idx]) restartStream(allStreams[idx].id);
            }

            if (Object.keys(patch).length > 0) {
              broadcastState = { ...broadcastState, ...patch };
              broadcastGlobal("broadcast", broadcastState);
              updateStreamOverlays({
                newsActive: broadcastState.newsActive,
                newsText: broadcastState.newsText,
                newsTitle: broadcastState.newsTitle,
                newsBgColor: broadcastState.newsBgColor,
                newsStyle: broadcastState.newsStyle,
                newsAnimation: broadcastState.newsAnimation,
                newsPosition: broadcastState.newsPosition,
                adActive: broadcastState.adActive,
                adText: broadcastState.adText,
                adSub: broadcastState.adSub,
                adStyle: broadcastState.adStyle,
                adPosition: broadcastState.adPosition,
                breakActive: broadcastState.breakActive,
                breakText: broadcastState.breakText,
                breakStyle: broadcastState.breakStyle,
                breakVideoUrl: broadcastState.breakVideoUrl,
                breakVideoMode: broadcastState.breakVideoMode,
                breakVideoPanX: broadcastState.breakVideoPanX,
                breakVideoPanY: broadcastState.breakVideoPanY,
                liveAudioMuted: broadcastState.liveAudioMuted,
                breakVideoMuted: broadcastState.breakVideoMuted,
                statsActive: broadcastState.statsActive,
                statsPosition: broadcastState.statsPosition,
                subsOverlayActive: broadcastState.subsOverlayActive,
                subsStyle: broadcastState.subsStyle,
                subsPosition: broadcastState.subsPosition,
                subsGoal: broadcastState.subsGoal,
                subChartActive: broadcastState.subChartActive,
                subChartData: broadcastState.subChartData,
                subChartPosition: broadcastState.subChartPosition,
                mobileSubChartPosition: broadcastState.mobileSubChartPosition,
                subAlertActive: broadcastState.subAlertActive,
                subAlertMessage: broadcastState.subAlertMessage,
                chatBurnActive: broadcastState.chatBurnActive,
                chatBurnStyle: broadcastState.chatBurnStyle,
                chatBurnPosition: broadcastState.chatBurnPosition,
                superChatMessages: broadcastState.superChatMessages,
                guestNameActive: broadcastState.guestNameActive,
                guestName: broadcastState.guestName,
                guestTitle: broadcastState.guestTitle,
                guestStyle: broadcastState.guestStyle,
                guestPosition: broadcastState.guestPosition,
                mobileGuestPosition: broadcastState.mobileGuestPosition,
                bgGradientActive: broadcastState.bgGradientActive,
                bgGradient1: broadcastState.bgGradient1,
                bgGradient2: broadcastState.bgGradient2,
                bgGradientOpacity: broadcastState.bgGradientOpacity,
                mobileStatsPosition: broadcastState.mobileStatsPosition,
                mobileSubsPosition: broadcastState.mobileSubsPosition,
                mobileChatBurnPosition: broadcastState.mobileChatBurnPosition,
                mobileNewsPosition: broadcastState.mobileNewsPosition,
                mobileAdPosition: broadcastState.mobileAdPosition,
                statsScale: broadcastState.statsScale,
                subsScale: broadcastState.subsScale,
                chatBurnScale: broadcastState.chatBurnScale,
                newsScale: broadcastState.newsScale,
                adScale: broadcastState.adScale,
                guestScale: broadcastState.guestScale,
                subChartScale: broadcastState.subChartScale,
                qrActive: broadcastState.qrActive,
                qrUrl: broadcastState.qrUrl,
                qrTitle: broadcastState.qrTitle,
                qrSize: broadcastState.qrSize,
                qrPosition: broadcastState.qrPosition,
                qrScanCount: getQRScanCount(),
                qrThankYouActive: (Date.now() - broadcastState.qrThankYouTs) < 11_000 && !!broadcastState.qrThankYouName,
                qrThankYouName: broadcastState.qrThankYouName,
                qrThankYouTs: broadcastState.qrThankYouTs,
                featuredComment: broadcastState.featuredComment,
                screenShareActive: broadcastState.screenShareActive,
                screenShareMode: broadcastState.screenShareMode,
                screenShareX: broadcastState.screenShareX,
                screenShareY: broadcastState.screenShareY,
                screenShareW: broadcastState.screenShareW,
                screenShareRadius: broadcastState.screenShareRadius,
                donationTickerActive: broadcastState.donationTickerActive,
                donationAlertActive:  broadcastState.donationAlertActive,
                donationTicker:       broadcastState.donationTicker,
                giftDisplayMode:      broadcastState.giftDisplayMode,
                giftQueue:            getGiftQueue(),
              });
              // Broadcast updated state back so frontend syncs
              broadcastGlobal("broadcast", broadcastState);
            }
          }

          res.json(result);
        } catch (e: any) {
          res.status(500).json({ error: e.message ?? "AI error" });
        }
      }
    );
  });

  // ── Donation Gateway ──────────────────────────────────────────────────────
  registerDonationGateway(app);

  // Maintain a queue of active donation alerts to push to overlay renderers
  let donationAlertQueue: Array<{ id: string; name: string; amount: string; amountKes: number; currency: string; message: string; color: string; ts: number }> = [];

  setDonationCallback((donation) => {
    // Trim expired alerts (> 30 s) then append new one
    donationAlertQueue = [
      ...donationAlertQueue.filter(a => Date.now() - a.ts < 30000),
      { id: donation.id, name: donation.name, amount: donation.amount, amountKes: donation.amountKes, currency: donation.currency, message: donation.message, color: donation.color, ts: donation.ts },
    ].slice(-10);

    // Prepend to donation ticker (most recent first), keep last 20
    broadcastState.donationTicker = [
      { name: donation.name, amount: donation.amount, amountKes: donation.amountKes, color: donation.color, ts: donation.ts },
      ...broadcastState.donationTicker,
    ].slice(0, 20);

    // Track QR thank-you state in broadcastState so new streams pick it up
    broadcastState.qrThankYouName = donation.name.split(" ")[0] ?? donation.name;
    broadcastState.qrThankYouTs   = donation.ts;

    // Push directly to all active overlay renderers (no stream restart needed)
    updateStreamOverlays({
      donationAlerts:       donationAlertQueue,
      donationTicker:       broadcastState.donationTicker,
      donationTickerActive: broadcastState.donationTickerActive,
      donationAlertActive:  broadcastState.donationAlertActive,
    });
  });

  // Auto-populate QR code URL with the donation gateway URL on startup
  // (only if the user has not set a custom QR URL yet)
  const gatewayUrl = getGatewayPaymentUrl();
  if (gatewayUrl && !broadcastState.qrUrl) {
    broadcastState.qrUrl   = gatewayUrl;
    broadcastState.qrTitle = "SUPER CHAT";
  }


  // ── Paystack payment QR flow ──────────────────────────────────────────────

  const PAYSTACK_BASE = "https://api.paystack.co";
  const FETCH_TIMEOUT_MS = 12000;

  function paystackHeaders() {
    const key = process.env["PAYSTACK_SECRET_KEY"];
    if (!key) throw new Error("PAYSTACK_SECRET_KEY is not configured.");
    return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  }

  async function fetchWithTimeout(url: string, opts: RequestInit, ms = FETCH_TIMEOUT_MS): Promise<globalThis.Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    try {
      return await globalThis.fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  const paymentSessions = new Map<string, {
    reference: string;
    amount: number;
    currency: string;
    title: string;
    status: "active" | "scanned" | "paid";
    payerName: string | null;
    payerEmail: string | null;
    createdAt: number;
  }>();

  const rateLimitMap = new Map<string, { count: number; windowStart: number }>();
  const RATE_LIMIT_WINDOW = 60_000;
  const RATE_LIMIT_MAX    = 20;

  function checkRateLimit(ip: string): boolean {
    const now = Date.now();
    const entry = rateLimitMap.get(ip);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
      rateLimitMap.set(ip, { count: 1, windowStart: now });
      return true;
    }
    if (entry.count >= RATE_LIMIT_MAX) return false;
    entry.count++;
    return true;
  }

  setInterval(() => {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW * 2;
    for (const [ip, e] of rateLimitMap) { if (e.windowStart < cutoff) rateLimitMap.delete(ip); }
    const sessionCutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [sid, sess] of paymentSessions) { if (sess.createdAt < sessionCutoff) paymentSessions.delete(sid); }
  }, 5 * 60 * 1000);

  app.post("/api/paystack/init", requireAuth, async (req: Request, res: Response): Promise<void> => {
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
    if (!checkRateLimit(ip)) {
      res.status(429).json({ error: "Too many payment requests. Please wait a minute." });
      return;
    }
    const { title, amount, streamId, currency } = req.body as {
      title?: string; amount?: number; streamId?: string; currency?: string;
    };
    if (!amount || !streamId) { res.status(400).json({ error: "amount and streamId required" }); return; }
    if (amount <= 0 || amount > 100_000) { res.status(400).json({ error: "amount must be between 0 and 100,000" }); return; }
    const amountSmallest = Math.round(amount * 100);
    const useCurrency = (currency ?? process.env["PAYSTACK_CURRENCY"] ?? "NGN").toUpperCase();
    const reference = `bnpay_${streamId.slice(0, 8)}_${Date.now()}`;
    const email = `viewer_${Date.now()}@bintupay.live`;
    const host = process.env["REPLIT_DEV_DOMAIN"]
      ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
      : `http://localhost:${process.env["PORT"] || 8080}`;
    const callbackUrl = `${host}/api/paystack/paid?ref=${reference}&sid=${encodeURIComponent(streamId)}`;
    try {
      const txBody: Record<string, unknown> = {
        email,
        amount: amountSmallest,
        reference,
        callback_url: callbackUrl,
        metadata: {
          stream_id: streamId,
          title: title || "Live Stream Payment",
          custom_fields: [
            { display_name: "Stream", variable_name: "stream_id", value: streamId },
            { display_name: "Title",  variable_name: "payment_title", value: title || "Payment" },
          ],
        },
      };
      if (process.env["PAYSTACK_CURRENCY"]) {
        txBody["currency"] = process.env["PAYSTACK_CURRENCY"].toUpperCase();
      }
      const r = await fetchWithTimeout(`${PAYSTACK_BASE}/transaction/initialize`, {
        method: "POST",
        headers: paystackHeaders(),
        body: JSON.stringify(txBody),
      });
      const data = await r.json() as unknown as {
        status: boolean;
        message?: string;
        data?: { authorization_url: string; reference: string };
      };
      if (!data.status || !data.data) {
        res.status(502).json({ error: data.message ?? "Paystack rejected the request", paystackStatus: data.status });
        return;
      }
      paymentSessions.set(streamId, {
        reference, amount: amountSmallest, currency: useCurrency, title: title || "Payment",
        status: "active", payerName: null, payerEmail: null, createdAt: Date.now(),
      });
      const scanUrl = `${host}/api/paystack/scan?ref=${encodeURIComponent(reference)}&sid=${encodeURIComponent(streamId)}&to=${encodeURIComponent(data.data.authorization_url)}`;
      res.json({ reference, currency: useCurrency, checkoutUrl: data.data.authorization_url, scanUrl });
    } catch (e: unknown) {
      if ((e as { name?: string }).name === "AbortError") {
        res.status(504).json({ error: "Paystack API timed out. Try again." });
      } else {
        res.status(500).json({ error: e instanceof Error ? e.message : "Unexpected error" });
      }
    }
  });

  app.get("/api/paystack/scan", (req: Request, res: Response): void => {
    const { ref, sid, to } = req.query as { ref?: string; sid?: string; to?: string };
    if (sid && paymentSessions.has(sid)) {
      const sess = paymentSessions.get(sid)!;
      if (sess.reference === ref && sess.status === "active") {
        sess.status = "scanned";
        broadcastGlobal("paystack_scan", { streamId: sid, reference: ref });
      }
    }
    if (to) { res.redirect(decodeURIComponent(to)); }
    else { res.send("Redirecting to payment…"); }
  });

  app.get("/api/paystack/paid", async (req: Request, res: Response): Promise<void> => {
    const { ref, sid } = req.query as { ref?: string; sid?: string };
    if (!ref || !sid) { res.send("<h2>Payment complete. Return to the stream.</h2>"); return; }
    try {
      const r = await fetchWithTimeout(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(ref)}`, {
        headers: paystackHeaders(),
      });
      const data = await r.json() as unknown as {
        status: boolean;
        data?: { status: string; customer?: { first_name?: string; last_name?: string; email?: string } };
      };
      if (data.status && data.data?.status === "success") {
        const customer = data.data.customer;
        const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") || customer?.email || "Someone";
        const sess = paymentSessions.get(sid);
        if (sess) { sess.status = "paid"; sess.payerName = name; sess.payerEmail = customer?.email || null; }
        broadcastGlobal("paystack_paid", { streamId: sid, reference: ref, payerName: name });
        res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Thank you!</title><style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f0f0f;color:#fff}h1{font-size:2rem;margin-bottom:8px}p{color:rgba(255,255,255,0.6);font-size:1.1rem}</style></head><body><h1>🎉 Thank you, ${name}!</h1><p>Your payment was received. You can close this tab.</p></body></html>`);
      } else {
        res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Payment</title><style>body{font-family:system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f0f0f;color:#fff}</style></head><body><h2>Payment pending or not confirmed yet.</h2><p>Please contact the streamer if you believe this is an error.</p></body></html>`);
      }
    } catch {
      res.send("<h2>Payment verification error. Please contact the streamer.</h2>");
    }
  });

  app.post("/api/paystack/webhook",
    express.raw({ type: "application/json" }),
    (req: Request, res: Response): void => {
      const sig = req.headers["x-paystack-signature"] as string | undefined;
      const key = process.env["PAYSTACK_SECRET_KEY"];
      if (key && sig) {
        const expected = crypto.createHmac("sha512", key).update(req.body as Buffer).digest("hex");
        if (expected !== sig) { res.status(401).send("Bad signature"); return; }
      }
      res.sendStatus(200);
      try {
        const evt = JSON.parse((req.body as Buffer).toString()) as {
          event: string;
          data?: {
            reference?: string;
            status?: string;
            metadata?: { stream_id?: string };
            customer?: { first_name?: string; last_name?: string; email?: string };
          };
        };
        if (evt.event === "charge.success") {
          const sid = evt.data?.metadata?.stream_id;
          const ref = evt.data?.reference;
          const customer = evt.data?.customer;
          const name = [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") || customer?.email || "Someone";
          if (sid) {
            const sess = paymentSessions.get(sid);
            if (sess && ref === sess.reference) { sess.status = "paid"; sess.payerName = name; sess.payerEmail = customer?.email || null; }
            broadcastGlobal("paystack_paid", { streamId: sid, reference: ref, payerName: name });
          }
        }
      } catch {}
    }
  );

  app.get("/api/paystack/status", requireAuth, (req: Request, res: Response): void => {
    const { streamId } = req.query as { streamId?: string };
    if (!streamId || !paymentSessions.has(streamId)) { res.json({ status: "none" }); return; }
    const sess = paymentSessions.get(streamId)!;
    res.json({ status: sess.status, payerName: sess.payerName, reference: sess.reference, title: sess.title, amount: sess.amount, currency: sess.currency });
  });

  app.delete("/api/paystack/reset", requireAuth, (req: Request, res: Response): void => {
    const { streamId } = req.query as { streamId?: string };
    if (streamId) paymentSessions.delete(streamId);
    res.json({ ok: true });
  });

  startLiveCountPolling();
  httpServer.on("close", stopLiveCountPolling);
}
