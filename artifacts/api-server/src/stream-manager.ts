import { ChildProcess, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { storage } from "./storage";
import { logger } from "./lib/logger";
import { getTikTokStreamUrl } from "./tiktok-extractor";
import { getYouTubeStreamUrl } from "./youtube-source";
import {
  writeOverlayTextFiles, writeChatTextFiles, cleanupTextFiles,
  getHeadlineTextFilePath, getTickerTextFilePath,
  getLtNameTextFilePath, getLtTitleTextFilePath,
  getMessageTextFilePath, getSubBoxTextFilePath,
  getChatTextFilePath, getChatNameTextFilePath,
  getAdTextFilePath, getAdSubTextFilePath, getAdCtaFilePath,
  startLiveCountPolling,
} from "./youtube-counter";
import type { WebSocket } from "ws";
import type { StreamConfig } from "./schema";

interface StreamProcess {
  ffmpegProcess?: ChildProcess;
  muted: boolean;
  autoRestart: boolean;
  watchdog?: NodeJS.Timeout;
  inputUrl?: string;
  applyDebounce?: NodeJS.Timeout;
  sourceType?: string;
}

const activeStreams = new Map<string, StreamProcess>();
const wsClients = new Set<WebSocket>();

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

function getQrPngPath(streamId: string): string {
  return path.join(uploadDir, `qr_${streamId}.png`);
}

async function generateQrPng(streamId: string, url: string): Promise<boolean> {
  try {
    const QRCode = (await import("qrcode")).default;
    await (QRCode as any).toFile(getQrPngPath(streamId), url, {
      width: 220, margin: 2, color: { dark: "#000000", light: "#ffffff" },
    });
    return true;
  } catch { return false; }
}

export function addWSClient(ws: WebSocket) {
  wsClients.add(ws);
  ws.on("close", () => wsClients.delete(ws));
}

export function broadcastGlobal(type: string, data: any) {
  const json = JSON.stringify({ type, streamId: null, data });
  wsClients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) ws.send(json);
  });
}

export function broadcastStream(streamId: string, type: string, data: any) {
  broadcast({ type, streamId, data });
}

function broadcast(msg: { type: string; streamId: string; data: any }) {
  const json = JSON.stringify(msg);
  wsClients.forEach((ws) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(json);
    }
  });
}

function sendLog(streamId: string, line: string) {
  const timestamp = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  broadcast({ type: "log", streamId, data: `[${timestamp}] ${line}` });
}

function sendStatus(streamId: string, status: string) {
  storage.updateStream(streamId, { status: status as any });
  broadcast({ type: "status", streamId, data: status });
}

/**
 * Builds filter_complex parts that create an animated mesh-gradient background
 * and overlay the source video centred on it — replacing the old pad:color=black approach.
 * Outputs label [base].
 */
function buildMeshGradientBg(scaleW: number, scaleH: number, fps: number, videoInputIdx = 0): string[] {
  const W = scaleW;
  const H = scaleH;
  const parts: string[] = [];

  // Dark violet base canvas
  parts.push(`color=c=0x040010:s=${W}x${H}:r=${fps}[_mgbg0]`);

  // Purple glow — top-left
  const p1x = -Math.round(W * 0.12);
  const p1y = -Math.round(H * 0.12);
  const p1w = Math.round(W * 0.68);
  const p1h = Math.round(H * 0.68);
  parts.push(`[_mgbg0]drawbox=x=${p1x}:y=${p1y}:w=${p1w}:h=${p1h}:color=0x6d28d9@0.55:t=fill[_mgbg1]`);

  // Cyan glow — bottom-right
  const p2x = Math.round(W * 0.42);
  const p2y = Math.round(H * 0.42);
  const p2w = Math.round(W * 0.72);
  const p2h = Math.round(H * 0.72);
  parts.push(`[_mgbg1]drawbox=x=${p2x}:y=${p2y}:w=${p2w}:h=${p2h}:color=0x0891b2@0.45:t=fill[_mgbg2]`);

  // Magenta accent — centre
  const p3x = Math.round(W * 0.26);
  const p3y = Math.round(H * 0.22);
  const p3w = Math.round(W * 0.48);
  const p3h = Math.round(H * 0.56);
  parts.push(`[_mgbg2]drawbox=x=${p3x}:y=${p3y}:w=${p3w}:h=${p3h}:color=0xc026d3@0.28:t=fill[_mgbg3]`);

  // Heavy gaussian blur turns the boxes into smooth gradient blobs
  parts.push(`[_mgbg3]gblur=sigma=60[_mgbgfinal]`);

  // Scale source video to fit frame without letterbox padding
  parts.push(`[${videoInputIdx}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease[_mgvid]`);

  // Overlay video centred on gradient canvas → [base]
  parts.push(`[_mgbgfinal][_mgvid]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2[base]`);

  return parts;
}

function findFont(): string {
  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/data/data/com.termux/files/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
    "/system/fonts/Roboto-Bold.ttf",
    "/system/fonts/DroidSans-Bold.ttf",
    "C:\\Windows\\Fonts\\arial.ttf",
    "C:\\Windows\\Fonts\\segoeui.ttf",
  ];
  for (const f of candidates) {
    try { if (fs.existsSync(f)) return f; } catch {}
  }
  return "sans";
}

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\\\\\")
    .replace(/'/g, "\u2019")
    .replace(/:/g, "\\:")
    .replace(/%/g, "%%")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\n/g, " ")
    .replace(/\r/g, "");
}

function escapeTextfilePath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/** Clamps a box so it always stays fully inside the frame. */
function clampBox(x: number, y: number, w: number, h: number, frameW: number, frameH: number) {
  const cw = Math.min(w, frameW);
  const ch = Math.min(h, frameH);
  return {
    x: Math.max(0, Math.min(x, frameW - cw)),
    y: Math.max(0, Math.min(y, frameH - ch)),
    w: cw,
    h: ch,
  };
}

function hexToFFmpeg(hex: string): string {
  const clean = hex.replace("#", "");
  return `0x${clean}`;
}

function getLogoAlphaExpr(animation: string): string {
  switch (animation) {
    case "pulse":
      return "0.3+0.7*abs(sin(t*1.2))";
    case "breathe":
      return "0.15+0.85*abs(sin(t*0.4))";
    case "fade-in":
      return "min(t/3\\,1)";
    case "flash":
      return "if(gt(mod(t\\,6)\\,5)\\,0.3\\,1)";
    default:
      return "";
  }
}

function buildOverlayFilter(stream: StreamConfig, scaleW: number, scaleH: number, useTextfile: boolean): string {
  const font = findFont();
  const fontEsc = font.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  const parts: string[] = [];

  const bannerH = Math.round(scaleH * 0.08);
  const tickerH = Math.round(scaleH * 0.06);
  const fontSize = Math.max(12, Math.round(bannerH * 0.55));
  const tickerFontSize = Math.max(10, Math.round(tickerH * 0.55));
  const hasTickerText = !!stream.overlayTickerText;
  const effectiveTickerH = hasTickerText ? tickerH : 0;

  const ltStyle = (stream as any).lowerThirdStyle || "none";

  if (ltStyle === "l-cut") {
    const ltNameSize = Math.max(14, Math.round(scaleH * 0.048));
    const ltTitleSize = Math.max(10, Math.round(scaleH * 0.032));
    const ltPadV = Math.round(scaleH * 0.018);
    const ltH = ltNameSize + ltTitleSize + ltPadV * 2 + 8;
    const ltW = Math.round(scaleW * 0.66);
    const ltY = scaleH - ltH - effectiveTickerH - 4;
    const accentColor = hexToFFmpeg((stream as any).lowerThirdAccentColor || "#e53935");

    parts.push(`drawbox=x=0:y=${ltY}:w=${ltW}:h=${ltH}:color=0x0c1524@0.95:t=fill`);
    parts.push(`drawbox=x=0:y=${ltY}:w=6:h=${ltH}:color=${accentColor}@1:t=fill`);

    if (useTextfile) {
      const ltNamePath = escapeTextfilePath(getLtNameTextFilePath(stream.id));
      const ltTitlePath = escapeTextfilePath(getLtTitleTextFilePath(stream.id));
      parts.push(`drawtext=fontfile='${fontEsc}':textfile='${ltNamePath}':reload=1:fontcolor=white:fontsize=${ltNameSize}:x=14:y=${ltY + ltPadV}`);
      parts.push(`drawtext=fontfile='${fontEsc}':textfile='${ltTitlePath}':reload=1:fontcolor=0xBBBBCC:fontsize=${ltTitleSize}:x=14:y=${ltY + ltPadV + ltNameSize + 6}`);
    } else {
      const nameText = escapeDrawtext((stream as any).lowerThirdName || "");
      const titleText = escapeDrawtext((stream as any).lowerThirdTitle || "");
      parts.push(`drawtext=fontfile='${fontEsc}':text='${nameText}':fontcolor=white:fontsize=${ltNameSize}:x=14:y=${ltY + ltPadV}`);
      parts.push(`drawtext=fontfile='${fontEsc}':text='${titleText}':fontcolor=0xBBBBCC:fontsize=${ltTitleSize}:x=14:y=${ltY + ltPadV + ltNameSize + 6}`);
    }
  } else if (ltStyle === "breaking-news") {
    const bnH = Math.round(scaleH * 0.1);
    const bnY = scaleH - bnH - effectiveTickerH - 4;
    const badgeW = Math.round(scaleW * 0.24);
    const bnMainSize = Math.max(12, Math.round(bnH * 0.40));
    const bnSubSize = Math.max(9, Math.round(bnH * 0.28));
    const bnAccent = hexToFFmpeg((stream as any).lowerThirdAccentColor || "#c41e1e");
    const bnTextPad = Math.round(badgeW * 0.08);
    const bnLabelSize = Math.max(9, Math.round(bnH * 0.24));
    const mainY = bnY + Math.round((bnH - bnMainSize - bnSubSize - 6) / 2);

    parts.push(`drawbox=x=0:y=${bnY}:w=${scaleW}:h=${bnH}:color=0x080808@0.96:t=fill`);
    parts.push(`drawbox=x=0:y=${bnY}:w=${badgeW}:h=${bnH}:color=${bnAccent}@1:t=fill`);
    parts.push(`drawtext=fontfile='${fontEsc}':text='BREAKING':fontcolor=white:fontsize=${bnLabelSize}:x=${bnTextPad}:y=${bnY + Math.round((bnH - bnMainSize - bnLabelSize - 4) / 2)}`);
    parts.push(`drawtext=fontfile='${fontEsc}':text='NEWS':fontcolor=white:fontsize=${bnMainSize}:x=${bnTextPad}:y=${bnY + Math.round((bnH - bnMainSize - bnLabelSize - 4) / 2) + bnLabelSize + 4}`);

    const textX = badgeW + 16;
    if (useTextfile) {
      const ltNamePath = escapeTextfilePath(getLtNameTextFilePath(stream.id));
      const ltTitlePath = escapeTextfilePath(getLtTitleTextFilePath(stream.id));
      parts.push(`drawtext=fontfile='${fontEsc}':textfile='${ltNamePath}':reload=1:fontcolor=white:fontsize=${bnMainSize}:x=${textX}:y=${mainY}`);
      parts.push(`drawtext=fontfile='${fontEsc}':textfile='${ltTitlePath}':reload=1:fontcolor=0xFFDD44:fontsize=${bnSubSize}:x=${textX}:y=${mainY + bnMainSize + 6}`);
    } else {
      const nameText = escapeDrawtext((stream as any).lowerThirdName || "");
      const titleText = escapeDrawtext((stream as any).lowerThirdTitle || "");
      parts.push(`drawtext=fontfile='${fontEsc}':text='${nameText}':fontcolor=white:fontsize=${bnMainSize}:x=${textX}:y=${mainY}`);
      parts.push(`drawtext=fontfile='${fontEsc}':text='${titleText}':fontcolor=0xFFDD44:fontsize=${bnSubSize}:x=${textX}:y=${mainY + bnMainSize + 6}`);
    }
  } else if (ltStyle === "ticker-name") {
    const tnH = Math.round(scaleH * 0.09);
    const tnY = scaleH - tnH - effectiveTickerH - 4;
    const tnBadgeW = Math.round(scaleW * 0.30);
    const tnNameSize = Math.max(13, Math.round(tnH * 0.44));
    const tnTitleSize = Math.max(9, Math.round(tnH * 0.30));
    const tnAccent = hexToFFmpeg((stream as any).lowerThirdAccentColor || "#e53935");
    const tnPad = Math.round(tnH * 0.12);
    const tnTextX = tnBadgeW + 16;

    parts.push(`drawbox=x=0:y=${tnY}:w=${scaleW}:h=${tnH}:color=0x0c1524@0.92:t=fill`);
    parts.push(`drawbox=x=0:y=${tnY}:w=${tnBadgeW}:h=${tnH}:color=${tnAccent}@0.96:t=fill`);
    parts.push(`drawbox=x=${tnBadgeW}:y=${tnY}:w=3:h=${tnH}:color=0xFFFFFF@0.18:t=fill`);

    if (useTextfile) {
      const ltNamePath = escapeTextfilePath(getLtNameTextFilePath(stream.id));
      const ltTitlePath = escapeTextfilePath(getLtTitleTextFilePath(stream.id));
      parts.push(`drawtext=fontfile='${fontEsc}':textfile='${ltNamePath}':reload=1:fontcolor=white:fontsize=${tnNameSize}:x=${Math.round(tnBadgeW * 0.07)}:y=${tnY + tnPad}`);
      parts.push(`drawtext=fontfile='${fontEsc}':textfile='${ltTitlePath}':reload=1:fontcolor=0xEEEEEE:fontsize=${tnTitleSize}:x=${tnTextX}:y=${tnY + Math.round((tnH - tnTitleSize) / 2)}`);
    } else {
      const nameText = escapeDrawtext((stream as any).lowerThirdName || "");
      const titleText = escapeDrawtext((stream as any).lowerThirdTitle || "");
      parts.push(`drawtext=fontfile='${fontEsc}':text='${nameText}':fontcolor=white:fontsize=${tnNameSize}:x=${Math.round(tnBadgeW * 0.07)}:y=${tnY + tnPad}`);
      parts.push(`drawtext=fontfile='${fontEsc}':text='${titleText}':fontcolor=0xEEEEEE:fontsize=${tnTitleSize}:x=${tnTextX}:y=${tnY + Math.round((tnH - tnTitleSize) / 2)}`);
    }
  } else if (ltStyle === "side-strip") {
    const ssStripW = Math.round(scaleW * 0.006);
    const ssW = Math.round(scaleW * 0.28);
    const ssNameSize = Math.max(12, Math.round(scaleH * 0.040));
    const ssTitleSize = Math.max(9, Math.round(scaleH * 0.026));
    const ssPad = Math.round(scaleH * 0.018);
    const ssH = ssNameSize + ssTitleSize + ssPad * 2 + 10;
    const ssY = scaleH - ssH - effectiveTickerH - Math.round(scaleH * 0.04);
    const ssAccent = hexToFFmpeg((stream as any).lowerThirdAccentColor || "#e53935");

    parts.push(`drawbox=x=0:y=${ssY - 2}:w=${ssStripW}:h=${ssH + 4}:color=${ssAccent}@1:t=fill`);
    parts.push(`drawbox=x=${ssStripW + 2}:y=${ssY}:w=${ssW}:h=${ssH}:color=0x0a0f1e@0.88:t=fill`);

    const textX = ssStripW + Math.round(ssW * 0.06) + 4;
    if (useTextfile) {
      const ltNamePath = escapeTextfilePath(getLtNameTextFilePath(stream.id));
      const ltTitlePath = escapeTextfilePath(getLtTitleTextFilePath(stream.id));
      parts.push(`drawtext=fontfile='${fontEsc}':textfile='${ltNamePath}':reload=1:fontcolor=white:fontsize=${ssNameSize}:x=${textX}:y=${ssY + ssPad}`);
      parts.push(`drawtext=fontfile='${fontEsc}':textfile='${ltTitlePath}':reload=1:fontcolor=0xAABBCC:fontsize=${ssTitleSize}:x=${textX}:y=${ssY + ssPad + ssNameSize + 6}`);
    } else {
      const nameText = escapeDrawtext((stream as any).lowerThirdName || "");
      const titleText = escapeDrawtext((stream as any).lowerThirdTitle || "");
      parts.push(`drawtext=fontfile='${fontEsc}':text='${nameText}':fontcolor=white:fontsize=${ssNameSize}:x=${textX}:y=${ssY + ssPad}`);
      parts.push(`drawtext=fontfile='${fontEsc}':text='${titleText}':fontcolor=0xAABBCC:fontsize=${ssTitleSize}:x=${textX}:y=${ssY + ssPad + ssNameSize + 6}`);
    }
  } else {
    if (stream.overlayChannelName) {
      const bannerColor = hexToFFmpeg(stream.overlayBannerColor || "#c41e1e");
      const nameText = escapeDrawtext(stream.overlayChannelName);
      const bannerY = scaleH - bannerH - effectiveTickerH - 4;
      parts.push(`drawtext=fontfile='${fontEsc}':text='${nameText}':fontcolor=white:fontsize=${fontSize}:box=1:boxcolor=${bannerColor}@0.85:boxborderw=${Math.round(bannerH * 0.25)}:x=${Math.round(scaleW * 0.02)}:y=${bannerY}`);
    }
    if (stream.overlayHeadline || (stream.overlayLiveCount && stream.youtubeChannelId)) {
      const headlineFontSize = Math.max(10, Math.round(fontSize * 0.75));
      const headlineY = scaleH - bannerH - effectiveTickerH - 4;
      const nameWidth = stream.overlayChannelName
        ? stream.overlayChannelName.length * fontSize * 0.6 + scaleW * 0.04 + fontSize * 0.5
        : scaleW * 0.02;
      if (useTextfile) {
        const textfilePath = escapeTextfilePath(getHeadlineTextFilePath(stream.id));
        parts.push(`drawtext=fontfile='${fontEsc}':textfile='${textfilePath}':reload=1:fontcolor=white:fontsize=${headlineFontSize}:box=1:boxcolor=0x222222@0.85:boxborderw=${Math.round(bannerH * 0.2)}:x=${Math.round(nameWidth)}:y=${headlineY}`);
      } else {
        const headlineText = escapeDrawtext(stream.overlayHeadline || "");
        parts.push(`drawtext=fontfile='${fontEsc}':text='  ${headlineText}  ':fontcolor=white:fontsize=${headlineFontSize}:box=1:boxcolor=0x222222@0.85:boxborderw=${Math.round(bannerH * 0.2)}:x=${Math.round(nameWidth)}:y=${headlineY}`);
      }
    }
  }

  if (stream.overlayTickerText) {
    const speed = stream.overlayTickerSpeed || 80;
    const tickerBg = hexToFFmpeg(stream.overlayTickerColor || "#1a1a2e");
    const tickerY = scaleH - tickerH;
    parts.push(`drawbox=x=0:y=${tickerY}:w=${scaleW}:h=${tickerH}:color=${tickerBg}@0.9:t=fill`);
    if (useTextfile) {
      const tickerFilePath = escapeTextfilePath(getTickerTextFilePath(stream.id));
      parts.push(`drawtext=fontfile='${fontEsc}':textfile='${tickerFilePath}':reload=1:fontcolor=white:fontsize=${tickerFontSize}:x=w-mod(t*${speed}\\,w+tw):y=${tickerY + Math.round(tickerH * 0.2)}`);
    } else {
      const tickerText = escapeDrawtext(stream.overlayTickerText);
      parts.push(`drawtext=fontfile='${fontEsc}':text='${tickerText}':fontcolor=white:fontsize=${tickerFontSize}:x=w-mod(t*${speed}\\,w+tw):y=${tickerY + Math.round(tickerH * 0.2)}`);
    }
  }

  if ((stream as any).messageEnabled && (stream as any).messageText) {
    const msgStyle = (stream as any).messageStyle || "news-classic";
    const msgFontSize = Math.max(12, Math.round(scaleH * 0.042));
    const msgPad = Math.round(msgFontSize * 0.55);
    const msgW = Math.round(scaleW * 0.56);
    const msgH = msgFontSize + msgPad * 2 + 4;
    const margin = Math.round(scaleW * 0.03);
    const pos = (stream as any).messagePosition || "center";
    let msgX = Math.round((scaleW - msgW) / 2);
    let msgY = Math.round((scaleH - msgH) / 2);
    switch (pos) {
      case "top-left": msgX = margin; msgY = margin; break;
      case "top-right": msgX = scaleW - msgW - margin; msgY = margin; break;
      case "center": break;
      case "bottom-left": msgX = margin; msgY = scaleH - msgH - margin - effectiveTickerH; break;
      case "bottom-right": msgX = scaleW - msgW - margin; msgY = scaleH - msgH - margin - effectiveTickerH; break;
      case "bottom-center": msgY = scaleH - msgH - margin - effectiveTickerH; break;
    }
    const bannerClr = hexToFFmpeg(stream.overlayBannerColor || "#c41e1e");
    const accentOffset = ["news-classic", "broadcast-official"].includes(msgStyle) ? 5 : 0;
    const textX = msgX + msgPad + accentOffset;
    const textY = msgY + msgPad;

    switch (msgStyle) {
      case "news-classic":
        parts.push(`drawbox=x=${msgX}:y=${msgY}:w=${msgW}:h=${msgH}:color=0x0d1629@0.94:t=fill`);
        parts.push(`drawbox=x=${msgX}:y=${msgY}:w=5:h=${msgH}:color=${bannerClr}@1:t=fill`);
        break;
      case "breaking-alert":
        parts.push(`drawbox=x=${msgX}:y=${msgY}:w=${msgW}:h=${msgH}:color=0xb71c1c@0.95:t=fill`);
        break;
      case "minimal-clean":
        parts.push(`drawbox=x=${msgX}:y=${msgY}:w=${msgW}:h=${msgH}:color=0x080808@0.72:t=fill`);
        break;
      case "cinema":
        parts.push(`drawbox=x=0:y=${msgY - 3}:w=${scaleW}:h=3:color=0xFFFFFF@0.75:t=fill`);
        parts.push(`drawbox=x=${msgX}:y=${msgY}:w=${msgW}:h=${msgH}:color=0x000000@0.93:t=fill`);
        parts.push(`drawbox=x=0:y=${msgY + msgH}:w=${scaleW}:h=3:color=0xFFFFFF@0.75:t=fill`);
        break;
      case "social-card":
        parts.push(`drawbox=x=${msgX}:y=${msgY}:w=${msgW}:h=${msgH}:color=0x1a1a2e@0.90:t=fill`);
        break;
      case "broadcast-official":
        parts.push(`drawbox=x=${msgX}:y=${msgY}:w=${msgW}:h=${msgH}:color=0x0a1628@0.96:t=fill`);
        parts.push(`drawbox=x=${msgX}:y=${msgY}:w=${msgW}:h=3:color=0xDAA520@1:t=fill`);
        break;
      case "pill":
        parts.push(`drawbox=x=${msgX}:y=${msgY}:w=${msgW}:h=${msgH}:color=0x1a1a2e@0.88:t=fill`);
        parts.push(`drawbox=x=${msgX}:y=${msgY}:w=${msgW}:h=2:color=${hexToFFmpeg(stream.overlayBannerColor || "#c41e1e")}@0.9:t=fill`);
        parts.push(`drawbox=x=${msgX}:y=${msgY + msgH - 2}:w=${msgW}:h=2:color=${hexToFFmpeg(stream.overlayBannerColor || "#c41e1e")}@0.9:t=fill`);
        break;
      case "watermark":
        // no background — translucent text only
        break;
    }
    const textColor = msgStyle === "minimal-clean" ? "0xEEEEEE"
      : msgStyle === "watermark" ? "0xFFFFFF@0.55"
      : "white";
    const xExpr = msgStyle === "cinema" ? "(w-text_w)/2" : String(textX);
    const yExpr = textY + (msgStyle === "broadcast-official" ? 4 : 0);
    if (useTextfile) {
      const msgPath = escapeTextfilePath(getMessageTextFilePath(stream.id));
      parts.push(`drawtext=fontfile='${fontEsc}':textfile='${msgPath}':reload=1:fontcolor=${textColor}:fontsize=${msgFontSize}:x=${xExpr}:y=${yExpr}`);
    } else {
      const msgTextEsc = escapeDrawtext((stream as any).messageText || "");
      parts.push(`drawtext=fontfile='${fontEsc}':text='${msgTextEsc}':fontcolor=${textColor}:fontsize=${msgFontSize}:x=${xExpr}:y=${yExpr}`);
    }
  }

  if ((stream as any).subBoxEnabled) {
    const subStyle = (stream as any).subBoxStyle || "card";
    const margin = Math.round(scaleW * 0.025);
    const sPos = (stream as any).subBoxPosition || "top-right";

    if (subStyle === "recent-activity") {
      // Live chat messages list — 2-line per slot: name (bright) + message (grey)
      const chatMaxMsgs = Math.min((stream as any).chatMaxMessages || 5, 4);
      const msgFont = Math.max(8, Math.round(scaleH * 0.025));
      const nameFont = Math.max(7, Math.round(msgFont * 0.80));
      const dotSize = nameFont + 1;
      const slotH = nameFont + msgFont + 10;
      const headerH = Math.max(18, Math.round(msgFont * 1.5 + 7));
      const chatW = Math.round(scaleW * 0.35);
      const chatH = headerH + slotH * chatMaxMsgs + 8;
      let chatX = scaleW - chatW - margin;
      let chatY = margin;
      switch (sPos) {
        case "top-left": chatX = margin; break;
        case "top-right": break;
        case "center-left": chatX = margin; chatY = Math.round((scaleH - chatH) / 2); break;
        case "center-right": chatY = Math.round((scaleH - chatH) / 2); break;
        case "bottom-left": chatX = margin; chatY = scaleH - chatH - margin; break;
        case "bottom-right": chatY = scaleH - chatH - margin; break;
      }
      parts.push(`drawbox=x=${chatX}:y=${chatY}:w=${chatW}:h=${chatH}:color=0x0d1629@0.93:t=fill`);
      parts.push(`drawbox=x=${chatX}:y=${chatY}:w=${chatW}:h=${headerH}:color=0x38bdf81A@1:t=fill`);
      parts.push(`drawbox=x=${chatX}:y=${chatY + headerH - 1}:w=${chatW}:h=1:color=0x38bdf840@1:t=fill`);
      const hFont = Math.max(7, Math.round(msgFont * 0.82));
      parts.push(`drawtext=fontfile='${fontEsc}':text='⚡ LIVE CHAT':fontcolor=0x38bdf8:fontsize=${hFont}:x=${chatX + 8}:y=${chatY + Math.round((headerH - hFont) / 2)}`);
      if (useTextfile) {
        for (let i = 0; i < chatMaxMsgs; i++) {
          const namePath = escapeTextfilePath(getChatNameTextFilePath(stream.id, i));
          const chatPath = escapeTextfilePath(getChatTextFilePath(stream.id, i));
          const slotY = chatY + headerH + i * slotH + 5;
          // Avatar dot
          parts.push(`drawbox=x=${chatX + 6}:y=${slotY + 1}:w=${dotSize}:h=${dotSize}:color=0x38bdf8@0.85:t=fill`);
          // Author name in bright color
          parts.push(`drawtext=fontfile='${fontEsc}':textfile='${namePath}':reload=1:fontcolor=0x7dd3fc:fontsize=${nameFont}:x=${chatX + dotSize + 13}:y=${slotY}`);
          // Message text in grey below
          parts.push(`drawtext=fontfile='${fontEsc}':textfile='${chatPath}':reload=1:fontcolor=0xCCCCCC:fontsize=${msgFont}:x=${chatX + 8}:y=${slotY + nameFont + 4}`);
        }
      }
    } else {
                              // Subscriber count styles
      const subW = Math.round(scaleW * 0.32);
      // Use frame-width-relative padding so portrait video (large scaleH) doesn't
      // inflate subPad and eat into availableW
      const subPad = Math.max(6, Math.round(scaleW * 0.012));
      const subFontSizeIdeal = Math.max(12, Math.round(scaleH * 0.044));
      const showViewers = !!(stream as any).subBoxShowViewers;
      const availableW = subW - subPad * 2;

      // 0.9 ratio: conservative upper bound for DejaVu Bold uppercase glyphs
      const labelChars = showViewers ? 14 : 11;   // "SUBS / VIEWERS" | "SUBSCRIBERS"
      const maxCountChars = showViewers ? 22 : 15; // "119 SUBS | 1 WATCHING" | "1,234,567,890"
      const labelSizeIdeal = Math.max(8, Math.round(subFontSizeIdeal * 0.60));
      const labelSize = Math.max(8, Math.min(labelSizeIdeal, Math.floor(availableW / (labelChars * 0.9))));
      const subFontSize = Math.max(12, Math.min(subFontSizeIdeal, Math.floor(availableW / (maxCountChars * 0.9))));

      const subH = labelSize + subFontSize + subPad * 2 + 10;
      let subX = scaleW - subW - margin;
      let subY = margin;
      switch (sPos) {
        case "top-left": subX = margin; break;
        case "top-right": break;
        case "center-left": subX = margin; subY = Math.round((scaleH - subH) / 2); break;
        case "center-right": subY = Math.round((scaleH - subH) / 2); break;
        case "bottom-left": subX = margin; subY = scaleH - subH - effectiveTickerH - margin; break;
        case "bottom-right": subY = scaleH - subH - effectiveTickerH - margin; break;
      }
      ({ x: subX, y: subY } = clampBox(subX, subY, subW, subH, scaleW, scaleH));

      const boxRight = subX + subW - subPad;
      const textStartX = subX + subPad;
      const clampedX = `max(${subX}\\,min(${textStartX}\\,${boxRight} - text_w))`;

      switch (subStyle) {
        case "minimal":
          parts.push(`drawbox=x=${subX}:y=${subY}:w=${subW}:h=${subH}:color=0x000000@0.62:t=fill`);
          break;
        case "card":
          parts.push(`drawbox=x=${subX}:y=${subY}:w=${subW}:h=${subH}:color=0x0d1629@0.92:t=fill`);
          parts.push(`drawbox=x=${subX}:y=${subY}:w=${subW}:h=3:color=0xff0000@1:t=fill`);
          break;
        case "broadcast":
          parts.push(`drawbox=x=${subX}:y=${subY}:w=${subW}:h=${subH}:color=0x0a0a1a@0.94:t=fill`);
          parts.push(`drawbox=x=${subX}:y=${subY + subH - 3}:w=${subW}:h=3:color=0xDAA520@1:t=fill`);
          break;
        case "flip-counter": {
          const counterH = subFontSize + Math.round(subFontSize * 0.55);
          parts.push(`drawbox=x=${subX}:y=${subY}:w=${subW}:h=${subH}:color=0x1c1c1c@0.97:t=fill`);
          parts.push(`drawbox=x=${subX + 2}:y=${subY + subPad}:w=${subW - 4}:h=${counterH}:color=0x141414@1:t=fill`);
          parts.push(`drawbox=x=${subX + 2}:y=${subY + subPad + Math.round(counterH / 2) - 1}:w=${subW - 4}:h=2:color=0x2e2e2e@1:t=fill`);
          break;
        }
        case "whatsapp":
          parts.push(`drawbox=x=${subX}:y=${subY}:w=${subW}:h=${subH}:color=0x25D366@0.96:t=fill`);
          parts.push(`drawbox=x=${subX + Math.round(subW * 0.72)}:y=${subY + subH}:w=${Math.round(subW * 0.1)}:h=${Math.round(subFontSize * 0.4)}:color=0x25D366@0.96:t=fill`);
          break;
        case "neon-glow":
          parts.push(`drawbox=x=${subX}:y=${subY}:w=${subW}:h=${subH}:color=0x0d0520@0.95:t=fill`);
          parts.push(`drawbox=x=${subX}:y=${subY}:w=${subW}:h=3:color=0xD400FF@1:t=fill`);
          parts.push(`drawbox=x=${subX}:y=${subY + subH - 3}:w=${subW}:h=3:color=0xD400FF@1:t=fill`);
          break;
        case "glass-card":
          parts.push(`drawbox=x=${subX}:y=${subY}:w=${subW}:h=${subH}:color=0xFFFFFF@0.14:t=fill`);
          parts.push(`drawbox=x=${subX}:y=${subY}:w=${subW}:h=1:color=0xFFFFFF@0.40:t=fill`);
          break;
        case "scoreboard": {
          const sbHdrH = Math.round(subH * 0.36);
          parts.push(`drawbox=x=${subX}:y=${subY}:w=${subW}:h=${subH}:color=0x0a0e22@0.97:t=fill`);
          parts.push(`drawbox=x=${subX}:y=${subY}:w=${subW}:h=${sbHdrH}:color=0x1a56db@1:t=fill`);
          parts.push(`drawtext=fontfile='${fontEsc}':text='SUBSCRIBERS':fontcolor=white:fontsize=${Math.max(7, Math.round(sbHdrH * 0.52))}:x=${clampedX}:y=${subY + Math.round((sbHdrH - Math.max(7, Math.round(sbHdrH * 0.52))) / 2)}`);
          break;
        }
        case "pill-badge":
          parts.push(`drawbox=x=${subX}:y=${subY}:w=${subW}:h=${subH}:color=0xF97316@0.92:t=fill`);
          parts.push(`drawbox=x=${subX}:y=${subY}:w=${subW}:h=2:color=0xFFFFFF@0.30:t=fill`);
          break;
      }

      const labelColor = subStyle === "minimal" ? "0x888888"
        : subStyle === "whatsapp" ? "0xDCF8C6"
        : subStyle === "flip-counter" ? "0x505050"
        : subStyle === "neon-glow" ? "0xCC55FF"
        : subStyle === "glass-card" ? "0xDDEEFF"
        : subStyle === "scoreboard" ? "0x93C5FD"
        : subStyle === "pill-badge" ? "0xFFE0C0"
        : "0x8899AA";
      const countColor = subStyle === "flip-counter" ? "0xFFE000"
        : subStyle === "whatsapp" ? "white"
        : "white";
      const countLabel = showViewers ? "SUBS / VIEWERS" : "SUBSCRIBERS";
      if (subStyle !== "scoreboard") {
        parts.push(`drawtext=fontfile='${fontEsc}':text='${countLabel}':fontcolor=${labelColor}:fontsize=${labelSize}:x=${clampedX}:y=${subY + subPad}`);
      }
      if (useTextfile) {
        const subPath = escapeTextfilePath(getSubBoxTextFilePath(stream.id));
        parts.push(`drawtext=fontfile='${fontEsc}':textfile='${subPath}':reload=1:fontcolor=${countColor}:fontsize=${subFontSize}:x=${clampedX}:y=${subY + subPad + labelSize + 4}`);
      } else {
        parts.push(`drawtext=fontfile='${fontEsc}':text='—':fontcolor=${countColor}:fontsize=${subFontSize}:x=${clampedX}:y=${subY + subPad + labelSize + 4}`);
      }
    }
  }
  // ── Live Chat Overlay ──────────────────────────────────────────────────────
  if ((stream as any).chatEnabled && stream.youtubeChannelId) {
    const chatStyle = (stream as any).chatStyle || "list";
    const chatMaxMsgs = Math.min((stream as any).chatMaxMessages || 5, 8);
    const msgFont = Math.max(8, Math.round(scaleH * 0.025));
    const nameFont2 = Math.max(7, Math.round(msgFont * 0.80));
    const lineH = msgFont + 7;
    const slotH = nameFont2 + lineH + 3;
    const headerH = Math.round(lineH * 1.4);
    const chatW = Math.round(scaleW * 0.34);
    const chatH = headerH + slotH * chatMaxMsgs + 8;
    const margin2 = Math.round(scaleW * 0.02);
    const cPos = (stream as any).chatPosition || "bottom-right";
    let chatX = scaleW - chatW - margin2;
    let chatY = scaleH - chatH - effectiveTickerH - margin2;
    switch (cPos) {
      case "top-left": chatX = margin2; chatY = margin2; break;
      case "top-right": chatX = scaleW - chatW - margin2; chatY = margin2; break;
      case "bottom-left": chatX = margin2; break;
      case "bottom-right": break;
    }

    if (chatStyle === "bubble") {
      parts.push(`drawbox=x=${chatX}:y=${chatY}:w=${chatW}:h=${chatH}:color=0x0a2018@0.94:t=fill`);
      parts.push(`drawbox=x=${chatX}:y=${chatY}:w=${chatW}:h=3:color=0x25D366@1:t=fill`);
      const hFont = Math.max(7, Math.round(msgFont * 0.82));
      parts.push(`drawtext=fontfile='${fontEsc}':text='LIVE CHAT':fontcolor=0x25D366:fontsize=${hFont}:x=${chatX + 8}:y=${chatY + Math.round((headerH - hFont) / 2)}`);
    } else {
      parts.push(`drawbox=x=${chatX}:y=${chatY}:w=${chatW}:h=${chatH}:color=0x0d1629@0.90:t=fill`);
      parts.push(`drawbox=x=${chatX}:y=${chatY}:w=${chatW}:h=${headerH}:color=0x38bdf81A@1:t=fill`);
      parts.push(`drawbox=x=${chatX}:y=${chatY + headerH - 1}:w=${chatW}:h=1:color=0x38bdf840@1:t=fill`);
      const hFont = Math.max(7, Math.round(msgFont * 0.82));
      parts.push(`drawtext=fontfile='${fontEsc}':text='⚡ LIVE CHAT':fontcolor=0x38bdf8:fontsize=${hFont}:x=${chatX + 8}:y=${chatY + Math.round((headerH - hFont) / 2)}`);
    }

    if (useTextfile) {
      // Chat: 2-line per slot — author name (bright) + message (styled)
      const dotSize = nameFont2 + 1;
      const nameColor = chatStyle === "bubble" ? "0xA0E9B5" : "0x7dd3fc";
      const msgColor = chatStyle === "bubble" ? "0xDCF8C6" : "0xCCCCCC";
      for (let i = 0; i < chatMaxMsgs; i++) {
        const namePath = escapeTextfilePath(getChatNameTextFilePath(stream.id, i));
        const chatPath = escapeTextfilePath(getChatTextFilePath(stream.id, i));
        const slotY = chatY + headerH + i * slotH + 4;
        // Avatar dot
        const dotColor = chatStyle === "bubble" ? "0x25D366@0.85" : "0x38bdf8@0.85";
        parts.push(`drawbox=x=${chatX + 6}:y=${slotY + 1}:w=${dotSize}:h=${dotSize}:color=${dotColor}:t=fill`);
        // Author name
        parts.push(`drawtext=fontfile='${fontEsc}':textfile='${namePath}':reload=1:fontcolor=${nameColor}:fontsize=${nameFont2}:x=${chatX + dotSize + 13}:y=${slotY}`);
        // Message text
        parts.push(`drawtext=fontfile='${fontEsc}':textfile='${chatPath}':reload=1:fontcolor=${msgColor}:fontsize=${msgFont}:x=${chatX + 8}:y=${slotY + nameFont2 + 3}`);
      }
    }
  }

  // ── Ad Overlay ────────────────────────────────────────────────────────────
  if ((stream as any).adEnabled && (stream as any).adText) {
    const adStyle = (stream as any).adStyle || "sponsor-banner";
    const adPos = (stream as any).adPosition || "bottom-center";
    const adBg = hexToFFmpeg((stream as any).adBgColor || "#0d1629");
    const adAccent = hexToFFmpeg((stream as any).adAccentColor || "#F97316");
    const margin = Math.round(scaleW * 0.025);

    const adHeadSize = Math.max(11, Math.round(scaleH * 0.038));
    const adSubSize = Math.max(9, Math.round(scaleH * 0.026));
    const adCtaSize = Math.max(9, Math.round(scaleH * 0.028));
    const adPad = Math.round(adHeadSize * 0.5);

    const adTextPath = escapeTextfilePath(getAdTextFilePath(stream.id));
    const adSubPath = escapeTextfilePath(getAdSubTextFilePath(stream.id));
    const adCtaPath = escapeTextfilePath(getAdCtaFilePath(stream.id));

    if (adStyle === "sponsor-banner") {
      const adW = Math.round(scaleW * 0.72);
      const adH = adHeadSize + adSubSize + adPad * 2 + 8;
      let adX = Math.round((scaleW - adW) / 2);
      let adY = scaleH - adH - effectiveTickerH - margin;
      if (adPos === "top-center") adY = margin;
      else if (adPos === "top-right") { adX = scaleW - adW - margin; adY = margin; }
      else if (adPos === "bottom-right") adX = scaleW - adW - margin;
      else if (adPos === "top-left") { adX = margin; adY = margin; }
      else if (adPos === "bottom-left") adX = margin;

      parts.push(`drawbox=x=${adX}:y=${adY}:w=${adW}:h=${adH}:color=${adBg}@0.94:t=fill`);
      parts.push(`drawbox=x=${adX}:y=${adY}:w=${adW}:h=3:color=${adAccent}@1:t=fill`);
      parts.push(`drawbox=x=${adX}:y=${adY}:w=3:h=${adH}:color=${adAccent}@1:t=fill`);
      const adLabelW = Math.round(adCtaSize * 2.0);
      parts.push(`drawbox=x=${adX + adW - adLabelW - 4}:y=${adY + 3}:w=${adLabelW}:h=${Math.round(adCtaSize * 1.4)}:color=${adAccent}@1:t=fill`);
      parts.push(`drawtext=fontfile='${fontEsc}':text='AD':fontcolor=white:fontsize=${Math.max(8, Math.round(adCtaSize * 0.85))}:x=${adX + adW - adLabelW + 2}:y=${adY + 5}`);
      if (useTextfile) {
        parts.push(`drawtext=fontfile='${fontEsc}':textfile='${adTextPath}':reload=1:fontcolor=white:fontsize=${adHeadSize}:x=${adX + adPad + 6}:y=${adY + adPad}`);
        parts.push(`drawtext=fontfile='${fontEsc}':textfile='${adSubPath}':reload=1:fontcolor=0xCCCCCC:fontsize=${adSubSize}:x=${adX + adPad + 6}:y=${adY + adPad + adHeadSize + 4}`);
      }
    } else if (adStyle === "lower-ad") {
      const adH = adHeadSize + adSubSize + adPad * 2 + 4;
      const badgeW = Math.round(scaleW * 0.09);
      let adY = scaleH - adH - effectiveTickerH - 2;
      if (adPos === "top-center" || adPos === "top-left" || adPos === "top-right") adY = 0;
      parts.push(`drawbox=x=0:y=${adY}:w=${scaleW}:h=${adH}:color=${adBg}@0.95:t=fill`);
      parts.push(`drawbox=x=0:y=${adY}:w=${badgeW}:h=${adH}:color=${adAccent}@1:t=fill`);
      parts.push(`drawtext=fontfile='${fontEsc}':text='AD':fontcolor=white:fontsize=${Math.max(9, Math.round(adHeadSize * 0.75))}:x=${Math.round((badgeW - adHeadSize) / 2)}:y=${adY + Math.round((adH - adHeadSize) / 2)}`);
      if (useTextfile) {
        parts.push(`drawtext=fontfile='${fontEsc}':textfile='${adTextPath}':reload=1:fontcolor=white:fontsize=${adHeadSize}:x=${badgeW + adPad}:y=${adY + adPad}`);
        parts.push(`drawtext=fontfile='${fontEsc}':textfile='${adSubPath}':reload=1:fontcolor=0xCCCCCC:fontsize=${adSubSize}:x=${badgeW + adPad}:y=${adY + adPad + adHeadSize + 4}`);
      }
    } else if (adStyle === "corner-bug") {
      const cbW = Math.round(scaleW * 0.22);
      const cbH = adHeadSize + adSubSize + adPad * 2 + 6;
      let cbX = scaleW - cbW - margin;
      let cbY = margin;
      if (adPos === "top-left" || adPos === "bottom-left") cbX = margin;
      if (adPos === "bottom-left" || adPos === "bottom-right" || adPos === "bottom-center") cbY = scaleH - cbH - effectiveTickerH - margin;
      parts.push(`drawbox=x=${cbX}:y=${cbY}:w=${cbW}:h=${cbH}:color=${adBg}@0.93:t=fill`);
      parts.push(`drawbox=x=${cbX}:y=${cbY}:w=${cbW}:h=2:color=${adAccent}@1:t=fill`);
      const badgeSize = Math.max(8, Math.round(adSubSize * 0.9));
      parts.push(`drawbox=x=${cbX}:y=${cbY + 2}:w=${Math.round(badgeSize * 1.8)}:h=${Math.round(badgeSize * 1.4)}:color=${adAccent}@1:t=fill`);
      parts.push(`drawtext=fontfile='${fontEsc}':text='AD':fontcolor=white:fontsize=${badgeSize}:x=${cbX + 2}:y=${cbY + 3}`);
      if (useTextfile) {
        parts.push(`drawtext=fontfile='${fontEsc}':textfile='${adTextPath}':reload=1:fontcolor=white:fontsize=${adHeadSize}:x=${cbX + adPad}:y=${cbY + adPad}`);
        parts.push(`drawtext=fontfile='${fontEsc}':textfile='${adSubPath}':reload=1:fontcolor=0xCCCCCC:fontsize=${adSubSize}:x=${cbX + adPad}:y=${cbY + adPad + adHeadSize + 4}`);
      }
    } else if (adStyle === "countdown-card") {
      const cdW = Math.round(scaleW * 0.22);
      const cdCountSize = Math.max(22, Math.round(scaleH * 0.12));
      const cdH = cdCountSize + adHeadSize + adPad * 2 + 12;
      let cdX = scaleW - cdW - margin;
      let cdY = margin;
      if (adPos === "top-left" || adPos === "bottom-left") cdX = margin;
      if (adPos === "bottom-left" || adPos === "bottom-right" || adPos === "bottom-center") cdY = scaleH - cdH - effectiveTickerH - margin;
      parts.push(`drawbox=x=${cdX}:y=${cdY}:w=${cdW}:h=${cdH}:color=${adBg}@0.96:t=fill`);
      parts.push(`drawbox=x=${cdX}:y=${cdY}:w=4:h=${cdH}:color=${adAccent}@1:t=fill`);
      const countdown = Math.max(0, (stream as any).adCountdown || 0);
      const cdLabel = countdown > 0 ? String(countdown) : "0";
      parts.push(`drawtext=fontfile='${fontEsc}':text='${cdLabel}s':fontcolor=${adAccent}:fontsize=${cdCountSize}:x=${cdX + Math.round((cdW - cdLabel.length * cdCountSize * 0.6) / 2)}:y=${cdY + adPad}`);
      if (useTextfile) {
        parts.push(`drawtext=fontfile='${fontEsc}':textfile='${adTextPath}':reload=1:fontcolor=white:fontsize=${adHeadSize}:x=${cdX + adPad + 4}:y=${cdY + adPad + cdCountSize + 6}`);
      }
    } else if (adStyle === "product-card") {
      const pcW = Math.round(scaleW * 0.26);
      const pcH = adHeadSize + adSubSize + adCtaSize + adPad * 2 + 18;
      let pcX = scaleW - pcW - margin;
      let pcY = margin;
      if (adPos === "top-left" || adPos === "bottom-left") pcX = margin;
      if (adPos === "bottom-left" || adPos === "bottom-right" || adPos === "bottom-center") pcY = scaleH - pcH - effectiveTickerH - margin;
      const hdrH = Math.round(adCtaSize * 1.5);
      parts.push(`drawbox=x=${pcX}:y=${pcY}:w=${pcW}:h=${pcH}:color=${adBg}@0.95:t=fill`);
      parts.push(`drawbox=x=${pcX}:y=${pcY}:w=${pcW}:h=${hdrH}:color=${adAccent}@0.95:t=fill`);
      parts.push(`drawtext=fontfile='${fontEsc}':text='NEW PRODUCT':fontcolor=white:fontsize=${Math.max(7, Math.round(adCtaSize * 0.75))}:x=${pcX + adPad}:y=${pcY + Math.round((hdrH - adCtaSize) / 2)}`);
      if (useTextfile) {
        parts.push(`drawtext=fontfile='${fontEsc}':textfile='${adTextPath}':reload=1:fontcolor=white:fontsize=${adHeadSize}:x=${pcX + adPad}:y=${pcY + hdrH + adPad}`);
        parts.push(`drawtext=fontfile='${fontEsc}':textfile='${adSubPath}':reload=1:fontcolor=0xDDAA44:fontsize=${adSubSize}:x=${pcX + adPad}:y=${pcY + hdrH + adPad + adHeadSize + 4}`);
        parts.push(`drawtext=fontfile='${fontEsc}':textfile='${adCtaPath}':reload=1:fontcolor=${adAccent}:fontsize=${adCtaSize}:x=${pcX + adPad}:y=${pcY + hdrH + adPad + adHeadSize + adSubSize + 10}`);
      }
    } else if (adStyle === "ribbon") {
      const rbSize = Math.round(scaleW * 0.14);
      let rbX = scaleW - rbSize;
      let rbY = 0;
      if (adPos === "top-left" || adPos === "bottom-left") rbX = 0;
      if (adPos === "bottom-left" || adPos === "bottom-right" || adPos === "bottom-center") rbY = scaleH - rbSize - effectiveTickerH;
      parts.push(`drawbox=x=${rbX}:y=${rbY}:w=${rbSize}:h=${rbSize}:color=${adAccent}@0.92:t=fill`);
      const rbFontSize = Math.max(9, Math.round(rbSize * 0.24));
      const rbLabel = useTextfile ? undefined : escapeDrawtext((stream as any).adText || "AD");
      parts.push(`drawtext=fontfile='${fontEsc}':text='${rbLabel || "AD"}':fontcolor=white:fontsize=${rbFontSize}:x=${rbX + Math.round(rbSize * 0.12)}:y=${rbY + Math.round(rbSize * 0.12)}`);
      if (useTextfile) {
        parts.push(`drawtext=fontfile='${fontEsc}':textfile='${adCtaPath}':reload=1:fontcolor=white:fontsize=${rbFontSize}:x=${rbX + Math.round(rbSize * 0.12)}:y=${rbY + Math.round(rbSize * 0.4)}`);
      }
    }
  }

  if ((stream as any).overlayQrEnabled && (stream as any).overlayQrLabel) {
    const qrSizeMap: Record<string, number> = { small: 0.10, medium: 0.14, large: 0.18 };
    const qrFrac = qrSizeMap[(stream as any).overlayQrSize || "medium"] ?? 0.14;
    const qrW = Math.round(scaleW * qrFrac);
    const margin = Math.round(scaleW * 0.025);
    const labelText = escapeDrawtext(((stream as any).overlayQrLabel as string).toUpperCase());
    const labelFontSize = Math.max(9, Math.round(qrW * 0.18));
    const qrPos = (stream as any).overlayQrPosition || "top-right";
    let lx: string, ly: string;
    switch (qrPos) {
      case "top-left": lx = String(margin); ly = String(margin + qrW + 4); break;
      case "bottom-left": lx = String(margin); ly = `h-${margin + labelFontSize + Math.round(labelFontSize * 0.7) + 4}`; break;
      case "bottom-right": lx = `w-text_w-${margin}`; ly = `h-${margin + labelFontSize + Math.round(labelFontSize * 0.7) + 4}`; break;
      default: lx = `w-text_w-${margin}`; ly = String(margin + qrW + 4); break;
    }
    parts.push(`drawtext=fontfile='${fontEsc}':text='${labelText}':fontcolor=white:fontsize=${labelFontSize}:box=1:boxcolor=0xF97316@0.96:boxborderw=${Math.round(labelFontSize * 0.35)}:x=${lx}:y=${ly}`);
  }

  if ((stream as any).overlaySocialEnabled && (stream as any).overlaySocialHandle) {
    const socialH = Math.round(scaleH * 0.055);
    const socialY = scaleH - socialH - effectiveTickerH;
    const socialFontSize = Math.max(10, Math.round(socialH * 0.52));
    const socialText = escapeDrawtext(`FB  IG  TikTok  ${(stream as any).overlaySocialHandle}`);
    parts.push(`drawbox=x=${Math.round(scaleW * 0.12)}:y=${socialY}:w=${Math.round(scaleW * 0.76)}:h=${socialH}:color=0x080a14@0.82:t=fill`);
    parts.push(`drawtext=fontfile='${fontEsc}':text='${socialText}':fontcolor=0xDDDDDD:fontsize=${socialFontSize}:x=(w-text_w)/2:y=${socialY + Math.round(socialH * 0.18)}`);
  }

  return parts.join(",");
}

function buildFFmpegArgs(
  stream: StreamConfig | undefined,
  inputUrl: string,
  outputs: string[],
  sourceType: "tiktok" | "youtube" | "camera" = "tiktok"
) {
  if (!stream) return [];

  const fps = parseInt(stream.fps);
  const isVertical = stream.ratio === "mobile";

  const scaleW = isVertical ? 480 : 854;
  const scaleH = isVertical ? 854 : 480;
  const scale = `${scaleW}:${scaleH}`;

  let bitrate = "1200k";
  let maxrate = "1500k";
  let bufsize = "2000k";

  if (stream.quality === "best") {
    bitrate = "1500k";
    maxrate = "1800k";
    bufsize = "2500k";
  } else if (stream.quality === "720p") {
    bitrate = "1200k";
    maxrate = "1500k";
    bufsize = "2000k";
  } else {
    bitrate = "800k";
    maxrate = "1000k";
    bufsize = "1500k";
  }

  const isHls = inputUrl.includes(".m3u8");

  const args: string[] = [
    "-loglevel", "info",
  ];

  if (sourceType === "camera") {
    const isNetworkUrl = inputUrl.startsWith("rtsp://") || inputUrl.startsWith("rtsps://") ||
      inputUrl.startsWith("http://") || inputUrl.startsWith("https://");

    if (isNetworkUrl) {
      args.push("-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "10");
      args.push("-i", inputUrl);
    } else {
      const isWin = process.platform === "win32";
      const isMac = process.platform === "darwin";
      if (isWin) {
        args.push("-f", "dshow", "-i", `video=${inputUrl}`);
      } else if (isMac) {
        args.push("-f", "avfoundation", "-framerate", String(fps), "-i", inputUrl);
      } else {
        args.push("-f", "v4l2", "-framerate", String(fps), "-i", inputUrl);
      }
    }
  } else if (sourceType === "youtube") {
    if (!isHls) {
      args.push("-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "10");
    }
    args.push("-i", inputUrl);
  } else {
    if (!isHls) {
      args.push("-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "10");
    }
    args.push(
      "-user_agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "-referer", "https://www.tiktok.com/",
      "-i", inputUrl,
    );
  }

  const hasLogo = stream.overlayEnabled && stream.overlayLogoPath && fs.existsSync(stream.overlayLogoPath);
  if (hasLogo) {
    args.push("-i", stream.overlayLogoPath);
  }

  const hasQr = stream.overlayEnabled &&
    !!(stream as any).overlayQrEnabled &&
    !!(stream as any).overlayQrUrl &&
    fs.existsSync(getQrPngPath(stream.id));
  if (hasQr) {
    args.push("-i", getQrPngPath(stream.id));
  }

  args.push("-threads", "2");

  const hasOverlayText = stream.overlayEnabled && (
    stream.overlayChannelName || stream.overlayHeadline || stream.overlayTickerText ||
    (stream.overlayLiveCount && stream.youtubeChannelId) ||
    ((stream as any).overlayQrEnabled && (stream as any).overlayQrLabel) ||
    ((stream as any).overlaySocialEnabled && (stream as any).overlaySocialHandle) ||
    ((stream as any).lowerThirdStyle && (stream as any).lowerThirdStyle !== "none") ||
    ((stream as any).messageEnabled && (stream as any).messageText) ||
    (stream as any).subBoxEnabled ||
    ((stream as any).chatEnabled && stream.youtubeChannelId) ||
    ((stream as any).adEnabled && (stream as any).adText)
  );
  const useTextfile = stream.overlayEnabled && true;

  if (useTextfile) {
    writeOverlayTextFiles(stream.id);
    writeChatTextFiles(stream.id);
  }

  if (hasLogo || hasQr || hasOverlayText) {
    const filterParts: string[] = [];
    filterParts.push(...buildMeshGradientBg(scaleW, scaleH, fps, 0));

    let currentLabel = "base";

    if (hasLogo) {
      const logoScale = stream.overlayLogoScale || 0.15;
      const logoW = Math.round(scaleW * logoScale);
      const pos = stream.overlayLogoPosition || "top-right";
      const margin = Math.round(scaleW * 0.02);
      let ox = "0", oy = "0";
      if (pos === "top-right") { ox = `main_w-overlay_w-${margin}`; oy = String(margin); }
      else if (pos === "top-left") { ox = String(margin); oy = String(margin); }
      else if (pos === "bottom-right") { ox = `main_w-overlay_w-${margin}`; oy = `main_h-overlay_h-${margin}`; }
      else if (pos === "bottom-left") { ox = String(margin); oy = `main_h-overlay_h-${margin}`; }

      const animation = stream.overlayLogoAnimation || "none";
      const alphaExpr = getLogoAlphaExpr(animation);

      const logoInputIdx = 1;
      if (alphaExpr) {
        filterParts.push(`[${logoInputIdx}:v]scale=${logoW}:-1,format=rgba,colorchannelmixer=aa='${alphaExpr}'[logo]`);
      } else {
        filterParts.push(`[${logoInputIdx}:v]scale=${logoW}:-1,format=rgba[logo]`);
      }
      filterParts.push(`[${currentLabel}][logo]overlay=${ox}:${oy}[withlogo]`);
      currentLabel = "withlogo";
    }

    if (hasQr) {
      const qrInputIdx = hasLogo ? 2 : 1;
      const qrSizeMap: Record<string, number> = { small: 0.10, medium: 0.14, large: 0.18 };
      const qrFrac = qrSizeMap[(stream as any).overlayQrSize || "medium"] ?? 0.14;
      const qrW = Math.round(scaleW * qrFrac);
      const qrMargin = Math.round(scaleW * 0.025);
      filterParts.push(`[${qrInputIdx}:v]scale=${qrW}:${qrW},format=rgba[qr]`);
      const qrPos = (stream as any).overlayQrPosition || "top-right";
      let qrOx: string, qrOy: string;
      switch (qrPos) {
        case "top-left": qrOx = String(qrMargin); qrOy = String(qrMargin); break;
        case "bottom-left": qrOx = String(qrMargin); qrOy = `main_h-overlay_h-${qrMargin}`; break;
        case "bottom-right": qrOx = `main_w-overlay_w-${qrMargin}`; qrOy = `main_h-overlay_h-${qrMargin}`; break;
        default: qrOx = `main_w-overlay_w-${qrMargin}`; qrOy = String(qrMargin); break;
      }
      filterParts.push(`[${currentLabel}][qr]overlay=${qrOx}:${qrOy}[withqr]`);
      currentLabel = "withqr";
    }

    if (hasOverlayText) {
      const textFilter = buildOverlayFilter(stream, scaleW, scaleH, useTextfile);
      if (textFilter) {
        filterParts.push(`[${currentLabel}]${textFilter}[final]`);
        currentLabel = "final";
      }
    }

    args.push("-filter_complex", filterParts.join(";"));
    args.push("-map", `[${currentLabel}]`);
    args.push("-map", "0:a?");
  } else {
    const gradParts = buildMeshGradientBg(scaleW, scaleH, fps, 0);
    args.push("-filter_complex", gradParts.join(";"));
    args.push("-map", "[base]");
    args.push("-map", "0:a?");
  }

  args.push(
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "zerolatency",
    "-b:v", bitrate,
    "-maxrate", maxrate,
    "-bufsize", bufsize,
    "-profile:v", "baseline",
    "-level", "3.0",
    "-pix_fmt", "yuv420p",
    "-g", String(fps * 2),
    "-r", String(fps),
    "-flags", "+global_header",
    "-flvflags", "no_duration_filesize"
  );

  args.push(
    "-c:a", "aac",
    "-b:a", "96k",
    "-ar", "44100",
    "-ac", "2",
    "-af", stream.muted
      ? "volume=0,aresample=async=1:first_pts=0"
      : "aresample=async=1:first_pts=0"
  );

  if (outputs.length === 1) {
    args.push("-f", "flv", outputs[0]);
  } else {
    const teeOutputs = outputs.map((o) => `[f=flv]${o}`).join("|");
    args.push(
      "-f", "tee",
      teeOutputs
    );
  }

  return args;
}

async function resolveInputUrl(stream: StreamConfig): Promise<{ url: string; sourceType: "tiktok" | "youtube" | "camera" }> {
  const sourceType = stream.sourceType || "tiktok";

  if (sourceType === "camera") {
    const device = stream.cameraDevice || "/dev/video0";
    return { url: device, sourceType: "camera" };
  }

  if (sourceType === "youtube") {
    const input = stream.youtubeSourceUrl || "";
    if (!input) throw new Error("YouTube username/URL is required");
    const url = await getYouTubeStreamUrl(input);
    return { url, sourceType: "youtube" };
  }

  if (!stream.tiktokUsername) throw new Error("TikTok username is required");
  const url = await getTikTokStreamUrl(stream.tiktokUsername, stream.quality || "best");
  return { url, sourceType: "tiktok" };
}

export async function startStream(streamId: string) {
  const stream = storage.getStream(streamId);
  if (!stream) throw new Error("Stream not found");

  const sourceType = stream.sourceType || "tiktok";

  if (sourceType === "tiktok" && !stream.tiktokUsername) throw new Error("TikTok username is required");
  if (sourceType === "youtube" && !stream.youtubeSourceUrl) throw new Error("YouTube username or URL is required");
  if (sourceType === "camera" && !stream.cameraDevice) throw new Error("Camera device path is required");
  if (!stream.youtubeStreamKey && !stream.facebookRtmpUrl) {
    throw new Error("At least one output (YouTube or Facebook) is required");
  }

  stopStream(streamId);

  const sourceLabel =
    sourceType === "tiktok" ? `TikTok @${stream.tiktokUsername}` :
    sourceType === "youtube" ? `YouTube: ${stream.youtubeSourceUrl}` :
    `Camera: ${stream.cameraDevice}`;

  sendLog(streamId, `--- Starting stream ---`);
  sendLog(streamId, `Source: ${sourceLabel}`);
  sendLog(streamId, `Quality: ${stream.quality} | FPS: ${stream.fps} | Layout: ${stream.ratio}`);
  sendLog(streamId, `Audio: ${stream.muted ? "Muted" : "On"} | Auto-restart: ${stream.autoRestart ? "On" : "Off"}`);
  if (stream.overlayEnabled) {
    const overlayParts: string[] = [];
    if (stream.overlayLogoPath) overlayParts.push(`Logo (${stream.overlayLogoAnimation || "none"})`);
    if (stream.overlayChannelName) overlayParts.push(`Banner: ${stream.overlayChannelName}`);
    if (stream.overlayTickerText) overlayParts.push("Ticker");
    if (stream.overlayLiveCount) overlayParts.push("Live Count");
    sendLog(streamId, `Overlay: ${overlayParts.join(" | ") || "Enabled (no content)"}`);
  }
  sendStatus(streamId, "reconnecting");

  if ((stream.overlayLiveCount || (stream as any).subBoxEnabled || (stream as any).chatEnabled || (stream as any).subBoxStyle === "recent-activity") && stream.youtubeChannelId) {
    startLiveCountPolling();
  }

  try {
    if (sourceType === "tiktok") {
      sendLog(streamId, `Fetching TikTok live stream for @${stream.tiktokUsername}...`);
    } else if (sourceType === "youtube") {
      sendLog(streamId, `Fetching YouTube stream URL for: ${stream.youtubeSourceUrl}...`);
    } else {
      sendLog(streamId, `Using camera device: ${stream.cameraDevice}`);
    }

    const { url: inputUrl, sourceType: resolvedType } = await resolveInputUrl(stream);

    if (sourceType === "tiktok") {
      const inputType = inputUrl.includes(".m3u8") ? "HLS" : "FLV";
      sendLog(streamId, `Using ${inputType} stream input`);
    } else if (sourceType === "youtube") {
      sendLog(streamId, `YouTube stream URL resolved`);
    }

    const outputs: string[] = [];
    if (stream.youtubeStreamKey) {
      outputs.push(`rtmp://a.rtmp.youtube.com/live2/${stream.youtubeStreamKey}`);
      sendLog(streamId, `Output: YouTube`);
    }
    if (stream.facebookRtmpUrl) {
      outputs.push(`rtmps://live-api-s.facebook.com:443/rtmp/${stream.facebookRtmpUrl}`);
      sendLog(streamId, `Output: Facebook`);
    }

    if (stream.overlayEnabled && (stream as any).overlayQrEnabled && (stream as any).overlayQrUrl) {
      sendLog(streamId, "Generating QR PNG for overlay...");
      await generateQrPng(streamId, (stream as any).overlayQrUrl);
    }

    const ffmpegArgs = buildFFmpegArgs(stream, inputUrl, outputs, resolvedType);
    sendLog(streamId, `Launching FFmpeg...`);

    const ffmpegProc = spawn("ffmpeg", ffmpegArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let gotFrames = false;
    let lastProgressLog = 0;

    ffmpegProc.stderr?.on("data", (errData: Buffer) => {
      const lines = errData.toString().split("\n").filter(Boolean);
      lines.forEach((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("frame=") || trimmed.startsWith("size=")) {
          if (!gotFrames) {
            gotFrames = true;
            sendLog(streamId, `Streaming! Encoding and forwarding frames...`);
            sendStatus(streamId, "streaming");
          }
          const now = Date.now();
          if (now - lastProgressLog > 30000) {
            lastProgressLog = now;
            const frameMatch = trimmed.match(/frame=\s*(\d+)/);
            const sizeMatch = trimmed.match(/size=\s*(\S+)/);
            const timeMatch = trimmed.match(/time=\s*(\S+)/);
            if (frameMatch) {
              sendLog(streamId, `Progress: ${frameMatch[1]} frames | ${sizeMatch ? sizeMatch[1] : ""} | ${timeMatch ? timeMatch[1] : ""}`);
            }
          }
          return;
        }
        sendLog(streamId, `[ffmpeg] ${trimmed}`);
      });
    });

    ffmpegProc.stdin?.on("error", () => {});
    ffmpegProc.stdout?.on("data", () => {});

    ffmpegProc.on("error", (err) => {
      if (err.message.includes("ENOENT")) {
        sendLog(streamId, `ERROR: ffmpeg not found. Install ffmpeg on your system.`);
      } else {
        sendLog(streamId, `FFmpeg error: ${err.message}`);
      }
      sendStatus(streamId, "error");
      activeStreams.delete(streamId);
    });

    ffmpegProc.on("exit", (code, signal) => {
      sendLog(streamId, `FFmpeg exited (code: ${code}, signal: ${signal})`);
      handleProcessExit(streamId, code);
    });

    const watchdog = setTimeout(() => {
      if (!gotFrames) {
        sendLog(streamId, `Timeout: No frames encoded after 60 seconds.`);
        stopStream(streamId);
      }
    }, 60000);

    activeStreams.set(streamId, {
      ffmpegProcess: ffmpegProc,
      muted: stream.muted,
      autoRestart: stream.autoRestart,
      watchdog,
      inputUrl,
      sourceType,
    });

    logger.info({ streamId }, `Stream started`);
  } catch (err: any) {
    sendLog(streamId, `Failed: ${err.message}`);
    sendStatus(streamId, "error");

    if (stream.autoRestart) {
      sendLog(streamId, "Auto-restart enabled. Retrying in 15 seconds...");
      sendStatus(streamId, "reconnecting");
      setTimeout(() => {
        if (storage.getStream(streamId)) {
          startStream(streamId).catch((e: any) => {
            sendLog(streamId, `Auto-restart failed: ${e.message}`);
            sendStatus(streamId, "error");
          });
        }
      }, 15000);
    }
  }
}

function handleProcessExit(streamId: string, code: number | null) {
  const proc = activeStreams.get(streamId);
  if (!proc) return;

  if (proc.watchdog) clearTimeout(proc.watchdog);
  activeStreams.delete(streamId);
  try { proc.ffmpegProcess?.kill("SIGKILL"); } catch {}

  if (proc.autoRestart && storage.getStream(streamId)) {
    sendLog(streamId, "Auto-restart enabled. Retrying in 10 seconds...");
    sendStatus(streamId, "reconnecting");
    setTimeout(() => {
      if (storage.getStream(streamId)) {
        startStream(streamId).catch((e: any) => {
          sendLog(streamId, `Auto-restart failed: ${e.message}`);
          sendStatus(streamId, "error");
        });
      }
    }, 10000);
  } else {
    sendStatus(streamId, code === 0 ? "idle" : "error");
  }
}

export function stopStream(streamId: string) {
  const proc = activeStreams.get(streamId);
  if (!proc) return;

  sendLog(streamId, "Stopping stream...");
  proc.autoRestart = false;
  if (proc.watchdog) clearTimeout(proc.watchdog);
  if (proc.applyDebounce) clearTimeout(proc.applyDebounce);

  try {
    if (proc.ffmpegProcess?.stdin?.writable) {
      proc.ffmpegProcess.stdin.write("q");
      proc.ffmpegProcess.stdin.end();
    }
  } catch {}

  setTimeout(() => { try { proc.ffmpegProcess?.kill("SIGTERM"); } catch {} }, 1000);
  setTimeout(() => { try { proc.ffmpegProcess?.kill("SIGKILL"); } catch {} }, 5000);

  activeStreams.delete(streamId);
  cleanupTextFiles(streamId);
  sendStatus(streamId, "idle");
  sendLog(streamId, "Stream stopped");
  logger.info({ streamId }, `Stream stopped`);
}

export function restartStream(streamId: string) {
  sendLog(streamId, "Restarting stream...");
  sendStatus(streamId, "reconnecting");
  stopStream(streamId);
  setTimeout(() => {
    startStream(streamId).catch((e: any) => {
      sendLog(streamId, `Restart failed: ${e.message}`);
      sendStatus(streamId, "error");
    });
  }, 3000);
}

export async function applyOverlayChanges(streamId: string) {
  const proc = activeStreams.get(streamId);
  if (!proc) return;

  const stream = storage.getStream(streamId);
  if (!stream) return;

  if (stream.overlayEnabled && (stream as any).overlayQrEnabled && (stream as any).overlayQrUrl) {
    await generateQrPng(streamId, (stream as any).overlayQrUrl);
  }

  writeOverlayTextFiles(streamId);
  writeChatTextFiles(streamId);

  if (proc.applyDebounce) clearTimeout(proc.applyDebounce);
  proc.applyDebounce = setTimeout(() => {
    sendLog(streamId, "Applying overlay changes (restarting encoder)...");
    const savedAutoRestart = proc.autoRestart;
    proc.autoRestart = false;
    if (proc.watchdog) clearTimeout(proc.watchdog);

    try {
      if (proc.ffmpegProcess?.stdin?.writable) {
        proc.ffmpegProcess.stdin.write("q");
        proc.ffmpegProcess.stdin.end();
      }
    } catch {}

    setTimeout(() => { try { proc.ffmpegProcess?.kill("SIGTERM"); } catch {} }, 1000);
    setTimeout(() => { try { proc.ffmpegProcess?.kill("SIGKILL"); } catch {} }, 3000);

    activeStreams.delete(streamId);

    setTimeout(() => {
      storage.updateStream(streamId, { autoRestart: savedAutoRestart });
      startStream(streamId).catch((e: any) => {
        sendLog(streamId, `Overlay apply failed: ${e.message}`);
        sendStatus(streamId, "error");
      });
    }, 2000);
  }, 1500);
}

export function toggleMute(streamId: string, muted: boolean) {
  storage.updateStream(streamId, { muted });
  const proc = activeStreams.get(streamId);
  if (proc) {
    proc.muted = muted;
    sendLog(streamId, muted ? "Audio muted - restarting stream..." : "Audio unmuted - restarting stream...");
    restartStream(streamId);
  }
}

export function isStreamActive(streamId: string): boolean {
  return activeStreams.has(streamId);
}