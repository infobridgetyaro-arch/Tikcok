import type { Express } from "express";
import type { Server } from "http";
import { WebSocketServer } from "ws";
import session from "express-session";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { storage } from "./storage";
import { insertStreamSchema } from "./schema";
import {
  startStream,
  stopStream,
  restartStream,
  toggleMute,
  addWSClient,
  applyOverlayChanges,
  isStreamActive,
  broadcastGlobal,
} from "./stream-manager";
import { getLiveCount, writeOverlayTextFiles as updateOverlayTextFiles, cleanupOverlayFiles } from "./youtube-counter";
import { getTikTokStreamUrl } from "./tiktok-extractor";

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".png";
      cb(null, `logo_${Date.now()}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

declare module "express-session" {
  interface SessionData {
    authenticated: boolean;
  }
}

const PASSWORD = "bintunet";

let inviteToken: string = crypto.randomBytes(6).toString("hex");
let qrScanCount = 0;

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

  function requireAuth(req: any, res: any, next: any) {
    if (!req.session?.authenticated) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    next();
  }

  app.post("/api/auth/login", (req, res) => {
    const { password } = req.body;
    if (password === PASSWORD) {
      req.session.authenticated = true;
      return res.json({ success: true });
    }
    return res.status(401).json({ message: "Invalid password" });
  });

  app.get("/api/auth/check", (req, res) => {
    if (req.session?.authenticated) {
      return res.json({ authenticated: true });
    }
    return res.status(401).json({ authenticated: false });
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  app.get("/api/invite", requireAuth, (req, res) => {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    res.json({ token: inviteToken, url: `${baseUrl}/join?token=${inviteToken}` });
  });

  app.post("/api/invite/regenerate", requireAuth, (req, res) => {
    inviteToken = crypto.randomBytes(6).toString("hex");
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    res.json({ token: inviteToken, url: `${baseUrl}/join?token=${inviteToken}` });
  });

  app.post("/api/invite/claim", (req, res) => {
    const { token } = req.body;
    if (!token || token !== inviteToken) {
      return res.status(401).json({ message: "Invalid or expired invite link." });
    }
    req.session.authenticated = true;
    res.json({ success: true });
  });

  app.get("/api/qr/track", (req, res) => {
    qrScanCount++;
    broadcastGlobal("qr_scan", { count: qrScanCount });
    const cb = (req.query.cb as string) || "/";
    try {
      const target = decodeURIComponent(cb);
      res.redirect(target);
    } catch {
      res.redirect("/");
    }
  });

  app.get("/api/qr/count", requireAuth, (_req, res) => {
    res.json({ count: qrScanCount });
  });

  app.post("/api/qr/reset", requireAuth, (_req, res) => {
    qrScanCount = 0;
    broadcastGlobal("qr_scan", { count: 0 });
    res.json({ success: true });
  });

  app.get("/api/streams", requireAuth, (_req, res) => {
    res.json(storage.getStreams());
  });

  app.post("/api/streams", requireAuth, (req, res) => {
    try {
      const data = insertStreamSchema.parse(req.body);
      const stream = storage.createStream(data);
      res.json(stream);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  const textOnlyFields = [
    "overlayChannelName", "overlayHeadline", "overlayTickerText", "youtubeChannelId",
    "lowerThirdName", "lowerThirdTitle", "messageText",
    "adText", "adSubText", "adCtaLabel",
  ];
  const structuralOverlayFields = [
    "overlayEnabled", "overlayLogoPath", "overlayLogoPosition", "overlayLogoScale",
    "overlayLogoAnimation", "overlayBannerColor", "overlayTickerColor", "overlayTickerSpeed",
    "overlayLiveCount", "overlayQrEnabled", "overlayQrUrl", "overlayQrLabel",
    "overlaySocialEnabled", "overlaySocialHandle",
    "overlayQrPosition", "overlayQrSize",
    "lowerThirdStyle", "lowerThirdAccentColor", "lowerThirdAnimation",
    "tickerStyle",
    "messageEnabled", "messageStyle", "messagePosition",
    "subBoxEnabled", "subBoxStyle", "subBoxPosition", "subBoxShowViewers", "subBoxAnimStyle",
    "chatEnabled", "chatPosition", "chatStyle", "chatMaxMessages",
    "viewerLayout", "viewerScreenScale", "viewerScreenX", "viewerScreenY",
    "adEnabled", "adStyle", "adBgColor", "adAccentColor", "adPosition", "adCountdown",
  ];

  app.patch("/api/streams/:id", requireAuth, (req, res) => {
    const stream = storage.updateStream(req.params.id, req.body);
    if (!stream) return res.status(404).json({ message: "Stream not found" });

    if (isStreamActive(req.params.id)) {
      const changedKeys = Object.keys(req.body);
      const hasStructural = changedKeys.some((k) => structuralOverlayFields.includes(k));
      const hasTextOnly = changedKeys.some((k) => textOnlyFields.includes(k));

      if (hasStructural) {
        applyOverlayChanges(req.params.id);
      } else if (hasTextOnly) {
        updateOverlayTextFiles(req.params.id);
      }
    }

    res.json(stream);
  });

  function cleanupStreamFiles(id: string) {
    const stream = storage.getStream(id);
    if (stream?.overlayLogoPath && fs.existsSync(stream.overlayLogoPath)) {
      try { fs.unlinkSync(stream.overlayLogoPath); } catch {}
    }
    cleanupOverlayFiles(id);
  }

  app.delete("/api/streams/:id", requireAuth, (req, res) => {
    try {
      stopStream(req.params.id);
    } catch {}
    cleanupStreamFiles(req.params.id);
    const deleted = storage.deleteStream(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Stream not found" });
    res.json({ success: true });
  });

  app.post("/api/streams/:id/start", requireAuth, async (req, res) => {
    try {
      await startStream(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/streams/:id/stop", requireAuth, (req, res) => {
    try {
      stopStream(req.params.id);
      cleanupStreamFiles(req.params.id);
      storage.deleteStream(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/streams/:id/restart", requireAuth, (req, res) => {
    try {
      restartStream(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/streams/:id/mute", requireAuth, (req, res) => {
    try {
      const { muted } = req.body;
      toggleMute(req.params.id, muted);
      res.json({ success: true });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.get("/api/streams/:id/preview", requireAuth, async (req, res) => {
    try {
      const stream = storage.getStream(req.params.id);
      if (!stream) return res.status(404).json({ message: "Stream not found" });
      if (!stream.tiktokUsername) return res.status(400).json({ message: "No TikTok username set" });

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
  });

  app.use("/uploads", requireAuth, (req: any, res: any, _next: any) => {
    const filePath = path.join(uploadDir, path.basename(req.path));
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ message: "File not found" });
    }
  });

  app.post("/api/upload/logo", requireAuth, logoUpload.single("logo"), (req: any, res: any) => {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded or invalid format" });
    }
    const filePath = path.join(uploadDir, req.file.filename);
    res.json({ path: filePath, filename: req.file.filename, url: `/uploads/${req.file.filename}` });
  });

  app.get("/api/preview/:username", requireAuth, async (req, res) => {
    try {
      const url = await getTikTokStreamUrl(req.params.username, "best");
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
  });

  app.get("/api/streams/:id/live-count", requireAuth, (req, res) => {
    const count = getLiveCount(req.params.id);
    res.json({ count: count || null });
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  wss.on("connection", (ws) => {
    addWSClient(ws);
  });
}
