import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QRCodeSVG } from "qrcode.react";
import {
  ChevronDown, ChevronUp, Sparkles, Radio, AlertCircle,
  Signal, Youtube, Shield, QrCode, Users,
  Check, AtSign, Share2, MessageSquare,
  Layers, TrendingUp, Tv, Layout, Megaphone,
  MonitorPlay, Maximize2, Film, PictureInPicture2,
  LayoutGrid, Columns, Rows, Minimize2, Star,
  Tag, Timer, Zap, Palette, Move,
} from "lucide-react";
import { SiTiktok } from "react-icons/si";
import type { StreamConfig } from "@/types/schema";
import { useWebSocket } from "@/hooks/use-websocket";

interface OverlayAdminProps {
  streams: StreamConfig[];
  onUpdate: (id: string, data: Partial<StreamConfig>) => void;
}

type OverlayDraft = {
  overlayEnabled: boolean;
  overlayChannelName: string;
  overlayHeadline: string;
  overlayTickerText: string;
  overlayBannerColor: string;
  overlayTickerColor: string;
  overlayTickerSpeed: number;
  overlayLiveCount: boolean;
  youtubeChannelId: string;
  overlayLogoPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  overlayLogoAnimation: "none" | "pulse" | "breathe" | "fade-in" | "flash";
  overlayLogoScale: number;
  overlayQrEnabled: boolean;
  overlayQrUrl: string;
  overlayQrLabel: string;
  overlayQrPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  overlayQrSize: "small" | "medium" | "large";
  overlaySocialEnabled: boolean;
  overlaySocialHandle: string;
  lowerThirdStyle: "none" | "l-cut" | "breaking-news" | "ticker-name" | "side-strip";
  lowerThirdName: string;
  lowerThirdTitle: string;
  lowerThirdAccentColor: string;
  lowerThirdAnimation: "none" | "slide-wipe" | "scale-up" | "fade" | "drop-in";
  tickerStyle: "crawl" | "flipper" | "flash-alert";
  messageEnabled: boolean;
  messageText: string;
  messageStyle: "news-classic" | "breaking-alert" | "minimal-clean" | "cinema" | "social-card" | "broadcast-official" | "pill" | "watermark";
  messagePosition: "top-left" | "top-right" | "center" | "bottom-left" | "bottom-right" | "bottom-center";
  subBoxEnabled: boolean;
  subBoxStyle: "minimal" | "card" | "broadcast" | "flip-counter" | "whatsapp" | "recent-activity" | "neon-glow" | "glass-card" | "scoreboard" | "pill-badge";
  subBoxPosition: "top-left" | "top-right" | "center-left" | "center-right" | "bottom-left" | "bottom-right";
  subBoxShowViewers: boolean;
  subBoxAnimStyle: "none" | "count-up" | "pulse-glow" | "slide-in" | "celebrate";
  chatEnabled: boolean;
  chatPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  chatStyle: "bubble" | "list";
  chatMaxMessages: number;
  viewerLayout: "standard" | "pip-br" | "pip-bl" | "pip-tr" | "split-v" | "split-h" | "cinema" | "fullscreen" | "l-shape";
  viewerScreenScale: number;
  viewerScreenX: number;
  viewerScreenY: number;
  adEnabled: boolean;
  adStyle: "sponsor-banner" | "lower-ad" | "corner-bug" | "countdown-card" | "product-card" | "ribbon";
  adText: string;
  adSubText: string;
  adBgColor: string;
  adAccentColor: string;
  adPosition: "top-left" | "top-right" | "center" | "bottom-left" | "bottom-right" | "bottom-center";
  adCtaLabel: string;
  adCountdown: number;
};

function buildDraft(s: StreamConfig): OverlayDraft {
  return {
    overlayEnabled: s.overlayEnabled,
    overlayChannelName: s.overlayChannelName,
    overlayHeadline: s.overlayHeadline,
    overlayTickerText: s.overlayTickerText,
    overlayBannerColor: s.overlayBannerColor,
    overlayTickerColor: s.overlayTickerColor,
    overlayTickerSpeed: s.overlayTickerSpeed,
    overlayLiveCount: s.overlayLiveCount,
    youtubeChannelId: s.youtubeChannelId,
    overlayLogoPosition: s.overlayLogoPosition,
    overlayLogoAnimation: s.overlayLogoAnimation,
    overlayLogoScale: s.overlayLogoScale,
    overlayQrEnabled: s.overlayQrEnabled,
    overlayQrUrl: s.overlayQrUrl,
    overlayQrLabel: s.overlayQrLabel,
    overlayQrPosition: s.overlayQrPosition ?? "top-right",
    overlayQrSize: s.overlayQrSize ?? "medium",
    overlaySocialEnabled: s.overlaySocialEnabled,
    overlaySocialHandle: s.overlaySocialHandle,
    lowerThirdStyle: s.lowerThirdStyle ?? "none",
    lowerThirdName: s.lowerThirdName ?? "",
    lowerThirdTitle: s.lowerThirdTitle ?? "",
    lowerThirdAccentColor: s.lowerThirdAccentColor ?? "#e53935",
    lowerThirdAnimation: s.lowerThirdAnimation ?? "slide-wipe",
    tickerStyle: s.tickerStyle ?? "crawl",
    messageEnabled: s.messageEnabled ?? false,
    messageText: s.messageText ?? "",
    messageStyle: s.messageStyle ?? "news-classic",
    messagePosition: s.messagePosition ?? "center",
    subBoxEnabled: s.subBoxEnabled ?? false,
    subBoxStyle: s.subBoxStyle ?? "card",
    subBoxPosition: s.subBoxPosition ?? "top-right",
    subBoxShowViewers: s.subBoxShowViewers ?? false,
    subBoxAnimStyle: s.subBoxAnimStyle ?? "none",
    chatEnabled: s.chatEnabled ?? false,
    chatPosition: s.chatPosition ?? "bottom-right",
    chatStyle: s.chatStyle ?? "list",
    chatMaxMessages: s.chatMaxMessages ?? 5,
    viewerLayout: s.viewerLayout ?? "standard",
    viewerScreenScale: s.viewerScreenScale ?? 1.0,
    viewerScreenX: s.viewerScreenX ?? 50,
    viewerScreenY: s.viewerScreenY ?? 50,
    adEnabled: s.adEnabled ?? false,
    adStyle: s.adStyle ?? "sponsor-banner",
    adText: s.adText ?? "",
    adSubText: s.adSubText ?? "",
    adBgColor: s.adBgColor ?? "#0a0f1e",
    adAccentColor: s.adAccentColor ?? "#f97316",
    adPosition: s.adPosition ?? "bottom-center",
    adCtaLabel: s.adCtaLabel ?? "LEARN MORE",
    adCountdown: s.adCountdown ?? 0,
  };
}

function hasDraftChanges(draft: OverlayDraft, stream: StreamConfig): boolean {
  return (Object.keys(draft) as (keyof OverlayDraft)[]).some(
    (k) => (draft[k] as any) !== ((stream as any)[k] ?? (buildDraft(stream) as any)[k])
  );
}

// ── Tiny shared UI ────────────────────────────────────────────────────────────
function EqBars({ color = "currentColor" }: { color?: string }) {
  return (
    <span className="flex items-end gap-0.5 h-5" style={{ color }} aria-hidden>
      <span className="eq-bar eq-bar-1" style={{ background: color }} />
      <span className="eq-bar eq-bar-2" style={{ background: color }} />
      <span className="eq-bar eq-bar-3" style={{ background: color }} />
      <span className="eq-bar eq-bar-4" style={{ background: color }} />
      <span className="eq-bar eq-bar-5" style={{ background: color }} />
    </span>
  );
}

function OnAirDot() {
  return (
    <span className="relative flex items-center justify-center w-4 h-4">
      <span className="absolute inline-flex w-full h-full rounded-full bg-red-500 animate-signal-ping" />
      <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-red-500 animate-on-air" />
    </span>
  );
}

const SOURCE_ICON: Record<string, any> = { tiktok: SiTiktok, youtube: Youtube, camera: Radio };
const SOURCE_COLOR: Record<string, string> = { tiktok: "#ff2d55", youtube: "#ff0000", camera: "#38bdf8" };

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">{label}</Label>
      {children}
    </div>
  );
}

function PillToggle({ value, onChange, options }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string; color?: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => (
        <button key={opt.value} onClick={() => onChange(opt.value)}
          className="px-2.5 py-1 rounded-full text-[10px] font-bold transition-all"
          style={{
            border: `1px solid ${value === opt.value ? (opt.color || "rgba(56,189,248,0.8)") : "rgba(51,65,85,0.5)"}`,
            background: value === opt.value ? `${opt.color || "rgba(56,189,248,1)"}18` : "rgba(8,12,24,0.5)",
            color: value === opt.value ? (opt.color || "#38bdf8") : "#475569",
          }}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function GridPicker({ value, onChange, options, cols = 3 }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string; preview: React.ReactNode }[]; cols?: number;
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {options.map((opt) => (
        <button key={opt.value} onClick={() => onChange(opt.value)}
          className="relative rounded-lg overflow-hidden transition-all"
          style={{
            aspectRatio: "16/9",
            border: `1.5px solid ${value === opt.value ? "rgba(56,189,248,0.8)" : "rgba(51,65,85,0.4)"}`,
            background: value === opt.value ? "rgba(56,189,248,0.06)" : "rgba(8,12,24,0.4)",
            boxShadow: value === opt.value ? "0 0 12px rgba(56,189,248,0.15)" : "none",
          }}>
          {opt.preview}
          <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-center"
            style={{ background: "rgba(0,0,0,0.7)" }}>
            <span className="text-[8px] font-bold" style={{ color: value === opt.value ? "#38bdf8" : "#64748b" }}>{opt.label}</span>
          </div>
          {value === opt.value && (
            <div className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center"
              style={{ background: "#38bdf8" }}>
              <Check className="w-2 h-2 text-black" />
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

function PositionGrid({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const positions = [
    ["top-left", "top-center", "top-right"],
    ["center-left", "center", "center-right"],
    ["bottom-left", "bottom-center", "bottom-right"],
  ];
  const aliases: Record<string, string> = {
    "top-center": "top-center", "center-left": "center-left",
    "center-right": "center-right", "bottom-center": "bottom-center",
  };
  return (
    <div className="grid grid-cols-3 gap-1 w-28">
      {positions.flat().map((pos) => {
        const active = value === pos || (pos === "center-left" && value === "center-left") || (pos === "center-right" && value === "center-right");
        return (
          <button key={pos} onClick={() => onChange(pos)}
            className="w-8 h-8 rounded flex items-center justify-center transition-all"
            style={{
              border: `1px solid ${active ? "rgba(56,189,248,0.8)" : "rgba(51,65,85,0.4)"}`,
              background: active ? "rgba(56,189,248,0.15)" : "rgba(8,12,24,0.4)",
            }}>
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: active ? "#38bdf8" : "#334155" }} />
          </button>
        );
      })}
    </div>
  );
}

// ── Layout thumbnails ─────────────────────────────────────────────────────────
const C = { bg: "#0f172a", screen: "#1e293b", accent: "#38bdf8", dim: "#334155" };
const S = { background: C.bg, width: "100%", height: "100%", position: "relative" as const, display: "flex" as const, alignItems: "center" as const, justifyContent: "center" as const };

const LAYOUT_OPTIONS = [
  {
    value: "standard", label: "Standard",
    preview: (
      <div style={S}>
        <div style={{ width: "72%", height: "70%", background: C.screen, borderRadius: 2, border: `1px solid ${C.dim}` }} />
      </div>
    ),
  },
  {
    value: "fullscreen", label: "Fullscreen",
    preview: (
      <div style={S}>
        <div style={{ position: "absolute", inset: 3, background: C.screen, borderRadius: 2, border: `1px solid ${C.dim}` }} />
      </div>
    ),
  },
  {
    value: "cinema", label: "Cinema",
    preview: (
      <div style={S}>
        <div style={{ width: "90%", height: "60%", background: C.screen, borderRadius: 2, border: `1px solid ${C.dim}` }} />
        <div style={{ position: "absolute", bottom: 4, left: 4, right: 4, height: 4, background: "#111" }} />
        <div style={{ position: "absolute", top: 4, left: 4, right: 4, height: 4, background: "#111" }} />
      </div>
    ),
  },
  {
    value: "pip-br", label: "PiP Bot-R",
    preview: (
      <div style={S}>
        <div style={{ position: "absolute", inset: 3, background: C.screen, borderRadius: 2, opacity: 0.4 }} />
        <div style={{ position: "absolute", bottom: 5, right: 5, width: "34%", height: "36%", background: C.accent, borderRadius: 2, opacity: 0.7 }} />
      </div>
    ),
  },
  {
    value: "pip-bl", label: "PiP Bot-L",
    preview: (
      <div style={S}>
        <div style={{ position: "absolute", inset: 3, background: C.screen, borderRadius: 2, opacity: 0.4 }} />
        <div style={{ position: "absolute", bottom: 5, left: 5, width: "34%", height: "36%", background: C.accent, borderRadius: 2, opacity: 0.7 }} />
      </div>
    ),
  },
  {
    value: "pip-tr", label: "PiP Top-R",
    preview: (
      <div style={S}>
        <div style={{ position: "absolute", inset: 3, background: C.screen, borderRadius: 2, opacity: 0.4 }} />
        <div style={{ position: "absolute", top: 5, right: 5, width: "34%", height: "36%", background: C.accent, borderRadius: 2, opacity: 0.7 }} />
      </div>
    ),
  },
  {
    value: "split-v", label: "Split V",
    preview: (
      <div style={{ ...S, gap: 2, padding: 4 }}>
        <div style={{ flex: 1, height: "70%", background: C.screen, borderRadius: 2, border: `1px solid ${C.dim}` }} />
        <div style={{ flex: 1, height: "70%", background: C.dim, borderRadius: 2, border: `1px solid ${C.dim}` }} />
      </div>
    ),
  },
  {
    value: "split-h", label: "Split H",
    preview: (
      <div style={{ ...S, flexDirection: "column" as const, gap: 2, padding: 4 }}>
        <div style={{ width: "80%", flex: 1, background: C.screen, borderRadius: 2, border: `1px solid ${C.dim}` }} />
        <div style={{ width: "80%", flex: 1, background: C.dim, borderRadius: 2, border: `1px solid ${C.dim}` }} />
      </div>
    ),
  },
  {
    value: "l-shape", label: "L-Shape",
    preview: (
      <div style={S}>
        <div style={{ position: "absolute", top: 4, left: 4, right: 4, bottom: 16, background: C.screen, borderRadius: 2, opacity: 0.6 }} />
        <div style={{ position: "absolute", bottom: 4, left: 4, right: 4, height: 10, background: C.accent, borderRadius: 2, opacity: 0.5 }} />
      </div>
    ),
  },
];

// ── Sub-box style previews ────────────────────────────────────────────────────
const SUB_STYLES = [
  {
    value: "minimal", label: "Minimal",
    preview: () => (
      <div className="flex flex-col justify-center px-1.5 py-1 h-full" style={{ background: "rgba(0,0,0,0.62)" }}>
        <div className="text-[4px] text-slate-500 font-bold mb-0.5">SUBSCRIBERS</div>
        <div className="text-[9px] text-white font-bold">12.5K</div>
      </div>
    ),
  },
  {
    value: "card", label: "Card",
    preview: () => (
      <div className="relative flex flex-col justify-center px-1.5 py-1 h-full" style={{ background: "rgba(13,22,41,0.92)" }}>
        <div className="absolute top-0 left-0 right-0 h-px bg-red-500" />
        <div className="text-[4px] font-bold mb-0.5" style={{ color: "#8899AA" }}>SUBSCRIBERS</div>
        <div className="text-[9px] text-white font-bold">12.5K</div>
      </div>
    ),
  },
  {
    value: "broadcast", label: "Broadcast",
    preview: () => (
      <div className="relative flex flex-col justify-center px-1.5 py-1 h-full" style={{ background: "rgba(10,10,26,0.94)" }}>
        <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: "#DAA520" }} />
        <div className="text-[4px] font-bold mb-0.5" style={{ color: "#8899AA" }}>SUBSCRIBERS</div>
        <div className="text-[9px] text-white font-bold">12.5K</div>
      </div>
    ),
  },
  {
    value: "flip-counter", label: "Flip Counter",
    preview: () => (
      <div className="flex flex-col items-center justify-center h-full gap-0.5" style={{ background: "#1c1c1c" }}>
        <div className="flex gap-0.5">
          {["1","2",".","5","K"].map((ch, i) => (
            <div key={i} style={{ width: "8px", height: "13px", background: "#141414", border: "1px solid #2a2a2a", borderRadius: "1px",
              display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: "50%", background: "#1e1e1e", borderBottom: "1px solid #111" }} />
              <span style={{ color: "#FFE000", fontSize: "7px", fontWeight: 900, zIndex: 1, position: "relative" }}>{ch}</span>
            </div>
          ))}
        </div>
        <div className="text-[3.5px]" style={{ color: "#505050" }}>SUBSCRIBERS</div>
      </div>
    ),
  },
  {
    value: "neon-glow", label: "Neon Glow",
    preview: () => (
      <div className="flex flex-col justify-center px-1.5 py-1 h-full" style={{ background: "rgba(5,0,20,0.95)" }}>
        <div className="text-[4px] font-bold mb-0.5" style={{ color: "#a855f7" }}>SUBSCRIBERS</div>
        <div className="text-[9px] font-bold" style={{ color: "#e879f9", textShadow: "0 0 6px #d946ef" }}>12.5K</div>
      </div>
    ),
  },
  {
    value: "glass-card", label: "Glass Card",
    preview: () => (
      <div className="flex flex-col justify-center px-1.5 py-1 h-full" style={{ background: "rgba(255,255,255,0.08)", backdropFilter: "blur(4px)", border: "1px solid rgba(255,255,255,0.15)" }}>
        <div className="text-[4px] font-bold mb-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>SUBSCRIBERS</div>
        <div className="text-[9px] font-bold text-white">12.5K</div>
      </div>
    ),
  },
  {
    value: "scoreboard", label: "Scoreboard",
    preview: () => (
      <div className="flex flex-col h-full" style={{ background: "#0f172a", border: "1px solid #1e3a5f" }}>
        <div className="px-1 py-0.5 text-[3.5px] font-bold text-center" style={{ background: "#1e3a8a", color: "#93c5fd" }}>LIVE SUBS</div>
        <div className="flex-1 flex items-center justify-center text-[9px] font-black text-white">12.5K</div>
      </div>
    ),
  },
  {
    value: "pill-badge", label: "Pill Badge",
    preview: () => (
      <div className="flex items-center justify-center h-full" style={{ background: "transparent" }}>
        <div className="px-2 py-0.5 rounded-full text-[7px] font-bold" style={{ background: "linear-gradient(90deg,#ef4444,#dc2626)", color: "white", border: "1px solid rgba(255,100,100,0.4)" }}>
          ♥ 12.5K SUBS
        </div>
      </div>
    ),
  },
  {
    value: "whatsapp", label: "WhatsApp",
    preview: () => (
      <div className="relative flex flex-col justify-center px-1.5 py-1 h-full" style={{ background: "#25D366" }}>
        <div className="text-[4px] font-bold mb-0.5" style={{ color: "#DCF8C6" }}>SUBSCRIBERS</div>
        <div className="text-[9px] text-white font-bold">12.5K</div>
        <div style={{ position: "absolute", bottom: -3, right: 5, width: 0, height: 0, borderLeft: "4px solid transparent", borderTop: "4px solid #25D366" }} />
      </div>
    ),
  },
  {
    value: "recent-activity", label: "Live Chat",
    preview: () => (
      <div className="relative flex flex-col h-full" style={{ background: "rgba(13,22,41,0.93)" }}>
        <div className="px-1 py-0.5 flex items-center gap-0.5" style={{ background: "rgba(56,189,248,0.12)", borderBottom: "1px solid rgba(56,189,248,0.2)" }}>
          <span className="text-[4px] font-bold" style={{ color: "#38bdf8" }}>⚡ LIVE CHAT</span>
        </div>
        {["Sarah: Great stream!", "John: 🔥🔥🔥", "Maria: Hello!"].map((m, i) => (
          <div key={i} className="px-1 py-0.5 text-[3.5px] border-b border-slate-800/40" style={{ color: "#CCCCCC" }}>{m}</div>
        ))}
      </div>
    ),
  },
];

// ── Ad style previews ─────────────────────────────────────────────────────────
const AD_STYLES = [
  {
    value: "sponsor-banner", label: "Sponsor Banner",
    preview: (accent: string) => (
      <div className="flex items-center justify-between px-2 h-full" style={{ background: `linear-gradient(90deg,rgba(0,0,0,0.9),rgba(0,0,0,0.85))`, borderTop: `2px solid ${accent}` }}>
        <div>
          <div className="text-[4px] font-bold" style={{ color: accent }}>SPONSORED</div>
          <div className="text-[6px] text-white font-bold">Brand Name</div>
        </div>
        <div className="px-1.5 py-0.5 rounded text-[5px] font-bold" style={{ background: accent, color: "#000" }}>VISIT</div>
      </div>
    ),
  },
  {
    value: "lower-ad", label: "Lower Ad",
    preview: (accent: string) => (
      <div className="flex items-center gap-1 px-1.5 h-full" style={{ background: "rgba(10,15,30,0.96)" }}>
        <div className="w-5 h-5 rounded flex items-center justify-center shrink-0" style={{ background: accent + "30", border: `1px solid ${accent}50` }}>
          <Star className="w-2.5 h-2.5" style={{ color: accent }} />
        </div>
        <div>
          <div className="text-[5px] text-white font-bold leading-tight">Ad Headline</div>
          <div className="text-[3.5px]" style={{ color: "#64748b" }}>Sponsored content</div>
        </div>
        <div className="ml-auto px-1.5 py-0.5 rounded-full text-[4px] font-bold" style={{ background: accent, color: "#000" }}>CTA</div>
      </div>
    ),
  },
  {
    value: "corner-bug", label: "Corner Bug",
    preview: (accent: string) => (
      <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded" style={{ background: "rgba(0,0,0,0.85)", border: `1px solid ${accent}50` }}>
        <div className="text-[4px] font-bold" style={{ color: accent }}>AD</div>
        <div className="text-[5px] text-white font-bold">Brand</div>
      </div>
    ),
  },
  {
    value: "countdown-card", label: "Countdown",
    preview: (accent: string) => (
      <div className="flex items-center gap-1.5 px-2 h-full" style={{ background: "rgba(0,0,0,0.9)", borderLeft: `3px solid ${accent}` }}>
        <div className="text-[14px] font-black" style={{ color: accent, fontVariantNumeric: "tabular-nums" }}>15</div>
        <div>
          <div className="text-[5px] text-white font-bold">Ad Break</div>
          <div className="text-[3.5px]" style={{ color: "#64748b" }}>seconds remaining</div>
        </div>
      </div>
    ),
  },
  {
    value: "product-card", label: "Product Card",
    preview: (accent: string) => (
      <div className="flex items-center gap-1.5 px-2 h-full" style={{ background: "rgba(10,15,30,0.94)", border: `1px solid ${accent}25` }}>
        <div className="w-7 h-7 rounded" style={{ background: accent + "20", border: `1px solid ${accent}40` }} />
        <div className="flex-1">
          <div className="text-[4px] font-bold" style={{ color: accent }}>NEW PRODUCT</div>
          <div className="text-[5.5px] text-white font-bold">Product Name</div>
          <div className="text-[4px]" style={{ color: "#64748b" }}>$99.99</div>
        </div>
        <div className="px-1.5 py-0.5 rounded text-[4px] font-bold" style={{ background: accent, color: "#000" }}>BUY</div>
      </div>
    ),
  },
  {
    value: "ribbon", label: "Ribbon",
    preview: (accent: string) => (
      <div className="absolute top-0 right-0">
        <div style={{ width: 0, height: 0, borderTop: `28px solid ${accent}`, borderLeft: "28px solid transparent" }} />
        <div className="absolute top-0.5 right-0.5 text-[4px] font-black" style={{ color: "#000", transform: "rotate(45deg)", transformOrigin: "center" }}>AD</div>
      </div>
    ),
  },
];

// ── Lower-third style cards ───────────────────────────────────────────────────
const LT_STYLES = [
  {
    value: "none", label: "Banner",
    preview: (color: string) => (
      <div className="relative w-full h-full flex items-end pb-1 px-1">
        <div className="h-3 w-[65%] flex items-center px-1 text-[5px] text-white font-bold" style={{ background: color || "#c41e1e" }}>CHANNEL</div>
      </div>
    ),
  },
  {
    value: "l-cut", label: "L-Cut",
    preview: (color: string) => (
      <div className="relative w-full h-full flex items-end pb-1 px-1">
        <div className="relative h-[28px] w-[72%] flex flex-col justify-center pl-2" style={{ background: "rgba(12,21,36,0.95)" }}>
          <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: color || "#e53935" }} />
          <div className="text-[5px] text-white font-bold leading-tight">PERSON NAME</div>
          <div className="text-[3.5px] leading-tight" style={{ color: "#BBBBCC" }}>Reporter · Live</div>
        </div>
      </div>
    ),
  },
  {
    value: "breaking-news", label: "Breaking",
    preview: (color: string) => (
      <div className="relative w-full h-full flex items-end pb-1">
        <div className="w-full flex" style={{ height: "24px", background: "rgba(8,8,8,0.96)" }}>
          <div className="flex flex-col justify-center px-1 shrink-0" style={{ background: color || "#c41e1e", width: "28%" }}>
            <div className="text-[3px] text-white font-black">BREAKING</div>
            <div className="text-[5px] text-white font-black">NEWS</div>
          </div>
          <div className="flex flex-col justify-center px-1">
            <div className="text-[4.5px] text-white font-bold">HEADLINE</div>
            <div className="text-[3px]" style={{ color: "#FFDD44" }}>Sub-headline</div>
          </div>
        </div>
      </div>
    ),
  },
  {
    value: "ticker-name", label: "Ticker Name",
    preview: (color: string) => (
      <div className="relative w-full h-full flex items-end pb-1 px-1">
        <div className="flex items-center gap-0.5 w-full">
          <div className="px-1 py-0.5 text-[4.5px] font-black text-white" style={{ background: color || "#e53935" }}>NAME</div>
          <div className="flex-1 px-1 py-0.5 text-[4px] text-white bg-black/70 overflow-hidden">TITLE / ROLE</div>
        </div>
      </div>
    ),
  },
  {
    value: "side-strip", label: "Side Strip",
    preview: (color: string) => (
      <div className="relative w-full h-full flex items-center pl-1">
        <div className="flex items-center gap-1">
          <div className="w-1 h-10" style={{ background: color || "#e53935", borderRadius: 1 }} />
          <div>
            <div className="text-[4.5px] text-white font-bold">NAME</div>
            <div className="text-[3.5px]" style={{ color: "#aaa" }}>Title</div>
          </div>
        </div>
      </div>
    ),
  },
];

// ── Flip Panel (split-flap animation) ─────────────────────────────────────────
function FlipPanel({ ch }: { ch: string }) {
  const [cur, setCur] = useState(ch);
  const [next, setNext] = useState(ch);
  const [phase, setPhase] = useState<"idle" | "top" | "bottom">("idle");
  useEffect(() => {
    if (ch === cur) return;
    setNext(ch); setPhase("top");
    const t1 = setTimeout(() => setPhase("bottom"), 160);
    const t2 = setTimeout(() => { setCur(ch); setPhase("idle"); }, 320);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [ch]);
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", width: "18px", height: "28px",
      background: "#141414", borderRadius: "2px", overflow: "hidden", position: "relative", border: "1px solid #2a2a2a", margin: "0 1px" }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "50%",
        background: "#1e1e1e", display: "flex", alignItems: "flex-end", justifyContent: "center",
        borderBottom: "1px solid #111", transformOrigin: "bottom center", perspective: "80px",
        transform: phase === "top" ? "rotateX(-90deg)" : "rotateX(0deg)",
        transition: phase === "top" ? "transform 0.16s ease-in" : "none" }}>
        <span style={{ color: "#FFE000", fontWeight: 900, fontSize: "13px", lineHeight: 1 }}>{phase === "bottom" ? next : cur}</span>
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "50%",
        background: "#141414", display: "flex", alignItems: "flex-start", justifyContent: "center",
        transformOrigin: "top center", perspective: "80px",
        transform: phase === "bottom" ? "rotateX(0deg)" : "rotateX(90deg)",
        transition: phase === "bottom" ? "transform 0.16s ease-out" : "none" }}>
        <span style={{ color: "#FFE000", fontWeight: 900, fontSize: "13px", lineHeight: 1 }}>{next}</span>
      </div>
    </div>
  );
}

// ── Section chip ──────────────────────────────────────────────────────────────
function SectionChip({ icon: Icon, label, color = "#38bdf8" }: { icon: any; label: string; color?: string }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="flex items-center justify-center w-5 h-5 rounded shrink-0"
        style={{ background: `${color}18`, border: `1px solid ${color}30` }}>
        <Icon className="w-3 h-3" style={{ color }} />
      </div>
      <span className="text-[10px] font-black tracking-widest uppercase" style={{ color }}>{label}</span>
      <div className="flex-1 h-px" style={{ background: `${color}20` }} />
    </div>
  );
}

// ── Tab definition ────────────────────────────────────────────────────────────
type Tab = "layout" | "overlay" | "subs" | "ads" | "brand";
const TABS: { id: Tab; label: string; icon: any; color: string }[] = [
  { id: "layout",  label: "Layout",  icon: LayoutGrid,     color: "#38bdf8" },
  { id: "overlay", label: "Overlay", icon: Layers,         color: "#a78bfa" },
  { id: "subs",    label: "Subs",    icon: Users,          color: "#34d399" },
  { id: "ads",     label: "Ads",     icon: Megaphone,      color: "#f97316" },
  { id: "brand",   label: "Brand",   icon: Palette,        color: "#f472b6" },
];

// ── Per-stream panel ──────────────────────────────────────────────────────────
function AdminStreamOverlay({ stream, index, onUpdate }: {
  stream: StreamConfig; index: number; onUpdate: (id: string, data: Partial<StreamConfig>) => void;
}) {
  const [tab, setTab] = useState<Tab>("layout");
  const [draft, setDraft] = useState<OverlayDraft>(() => buildDraft(stream));
  const [applying, setApplying] = useState(false);
  const [justApplied, setJustApplied] = useState(false);

  const pending = hasDraftChanges(draft, stream);

  const set = <K extends keyof OverlayDraft>(k: K, v: OverlayDraft[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  const apply = () => {
    const diff: Partial<StreamConfig> = {};
    (Object.keys(draft) as (keyof OverlayDraft)[]).forEach((k) => {
      const draftVal = draft[k];
      const streamVal = (stream as any)[k] ?? (buildDraft(stream) as any)[k];
      if (draftVal !== streamVal) (diff as any)[k] = draftVal;
    });
    if (Object.keys(diff).length === 0) return;
    setApplying(true);
    onUpdate(stream.id, diff);
    setTimeout(() => { setApplying(false); setJustApplied(true); }, 800);
    setTimeout(() => setJustApplied(false), 3000);
  };

  useEffect(() => { setDraft(buildDraft(stream)); }, [stream.id]);

  const SourceIcon = SOURCE_ICON[stream.sourceType] || Radio;
  const srcColor = SOURCE_COLOR[stream.sourceType] || "#38bdf8";
  const isLive = stream.status === "streaming";
  const needsYtKey = draft.overlayLiveCount || draft.subBoxEnabled;
  const tabColor = TABS.find((t) => t.id === tab)?.color ?? "#38bdf8";

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: "rgba(6,10,20,0.6)", border: `1px solid ${isLive ? "rgba(239,68,68,0.2)" : "rgba(51,65,85,0.4)"}` }}>

      {/* Stream header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-800/50">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
          style={{ background: `${srcColor}15`, border: `1px solid ${srcColor}30` }}>
          <SourceIcon className="w-3.5 h-3.5" style={{ color: srcColor }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white truncate">
              {stream.sourceType === "tiktok" ? `@${stream.tiktokUsername || "—"}` :
               stream.sourceType === "youtube" ? (stream.youtubeSourceUrl || "YouTube Live") :
               (stream.cameraDevice || "Camera")}
            </span>
            {isLive && <OnAirDot />}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-600">Stream {index + 1}</span>
            {pending && <span className="text-[10px] text-amber-400 font-bold">● Unsaved changes</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded"
            style={{ background: isLive ? "rgba(239,68,68,0.12)" : "rgba(51,65,85,0.3)", color: isLive ? "#ef4444" : "#475569" }}>
            {isLive ? "LIVE" : stream.status.toUpperCase()}
          </span>
          <Switch checked={draft.overlayEnabled} onCheckedChange={(v) => set("overlayEnabled", v)} />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-800/50 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="flex items-center gap-1.5 px-3 py-2 text-[10px] font-bold tracking-wider uppercase whitespace-nowrap transition-all shrink-0"
            style={{
              color: tab === t.id ? t.color : "#475569",
              borderBottom: `2px solid ${tab === t.id ? t.color : "transparent"}`,
              background: tab === t.id ? `${t.color}08` : "transparent",
            }}>
            <t.icon className="w-3 h-3" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="px-4 py-3 space-y-4 min-h-[320px]">

        {/* ═══════════ LAYOUT TAB ═══════════ */}
        {tab === "layout" && (
          <>
            <SectionChip icon={LayoutGrid} label="Stream Layout" color="#38bdf8" />
            <GridPicker value={draft.viewerLayout} onChange={(v) => set("viewerLayout", v as any)} options={LAYOUT_OPTIONS} cols={3} />

            <SectionChip icon={Move} label="Screen Position & Size" color="#38bdf8" />
            <div className="grid grid-cols-2 gap-4">
              <FieldRow label={`Size  ${Math.round(draft.viewerScreenScale * 100)}%`}>
                <Slider value={[draft.viewerScreenScale]} min={0.5} max={1.5} step={0.05}
                  onValueChange={([v]) => set("viewerScreenScale", v)} />
                <div className="flex justify-between text-[9px] text-slate-700">
                  <span>50%</span><span>100%</span><span>150%</span>
                </div>
              </FieldRow>
              <div className="space-y-3">
                <FieldRow label={`X Position  ${draft.viewerScreenX}%`}>
                  <Slider value={[draft.viewerScreenX]} min={0} max={100} step={1}
                    onValueChange={([v]) => set("viewerScreenX", v)} />
                </FieldRow>
                <FieldRow label={`Y Position  ${draft.viewerScreenY}%`}>
                  <Slider value={[draft.viewerScreenY]} min={0} max={100} step={1}
                    onValueChange={([v]) => set("viewerScreenY", v)} />
                </FieldRow>
              </div>
            </div>

            {/* Screen position visual picker */}
            <div className="flex gap-4 items-start">
              <div>
                <Label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block mb-1.5">Snap Position</Label>
                <PositionGrid value={
                  draft.viewerScreenX < 20 && draft.viewerScreenY < 20 ? "top-left" :
                  draft.viewerScreenX > 80 && draft.viewerScreenY < 20 ? "top-right" :
                  draft.viewerScreenX < 20 && draft.viewerScreenY > 80 ? "bottom-left" :
                  draft.viewerScreenX > 80 && draft.viewerScreenY > 80 ? "bottom-right" :
                  draft.viewerScreenX < 20 ? "center-left" :
                  draft.viewerScreenX > 80 ? "center-right" :
                  draft.viewerScreenY < 20 ? "top-center" :
                  draft.viewerScreenY > 80 ? "bottom-center" : "center"
                } onChange={(pos) => {
                  const map: Record<string, [number, number]> = {
                    "top-left": [10, 10], "top-center": [50, 10], "top-right": [90, 10],
                    "center-left": [10, 50], "center": [50, 50], "center-right": [90, 50],
                    "bottom-left": [10, 90], "bottom-center": [50, 90], "bottom-right": [90, 90],
                  };
                  const [x, y] = map[pos] || [50, 50];
                  set("viewerScreenX", x); set("viewerScreenY", y);
                }} />
              </div>
              <div className="flex-1">
                <Label className="text-[10px] text-slate-500 uppercase tracking-widest font-bold block mb-1.5">Preview</Label>
                <div className="relative rounded-lg overflow-hidden"
                  style={{ aspectRatio: "16/9", background: "#0a0f1e", border: "1px solid rgba(30,41,59,0.8)" }}>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-slate-800 text-[6px] font-mono tracking-widest">CANVAS</span>
                  </div>
                  <div className="absolute" style={{
                    left: `${Math.max(5, Math.min(85, draft.viewerScreenX))}%`,
                    top: `${Math.max(5, Math.min(85, draft.viewerScreenY))}%`,
                    transform: `translate(-50%, -50%) scale(${draft.viewerScreenScale})`,
                    width: draft.viewerLayout.startsWith("split") ? "80%" : draft.viewerLayout === "fullscreen" ? "90%" : "50%",
                    aspectRatio: stream.ratio === "mobile" ? "9/16" : "16/9",
                    background: "#1e293b",
                    border: "1px solid rgba(56,189,248,0.4)",
                    borderRadius: 2,
                  }} />
                </div>
              </div>
            </div>
          </>
        )}

        {/* ═══════════ OVERLAY TAB ═══════════ */}
        {tab === "overlay" && (
          <>
            <SectionChip icon={Film} label="Lower Third" color="#a78bfa" />
            <GridPicker value={draft.lowerThirdStyle} onChange={(v) => set("lowerThirdStyle", v as any)}
              options={LT_STYLES.map((s) => ({ ...s, preview: s.preview(draft.lowerThirdAccentColor) }))} cols={3} />
            {draft.lowerThirdStyle !== "none" && (
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Name / Headline">
                  <Input className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                    placeholder="John Smith" value={draft.lowerThirdName} onChange={(e) => set("lowerThirdName", e.target.value)} />
                </FieldRow>
                <FieldRow label="Title / Role">
                  <Input className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                    placeholder="Reporter · Live" value={draft.lowerThirdTitle} onChange={(e) => set("lowerThirdTitle", e.target.value)} />
                </FieldRow>
                <FieldRow label="Accent Color">
                  <div className="flex gap-2 items-center">
                    <input type="color" value={draft.lowerThirdAccentColor}
                      onChange={(e) => set("lowerThirdAccentColor", e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer border border-slate-700/60 bg-transparent" />
                    <Input className="flex-1 h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 font-mono"
                      value={draft.lowerThirdAccentColor} onChange={(e) => set("lowerThirdAccentColor", e.target.value)} />
                  </div>
                </FieldRow>
                <FieldRow label="Animation">
                  <Select value={draft.lowerThirdAnimation} onValueChange={(v) => set("lowerThirdAnimation", v as any)}>
                    <SelectTrigger className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["none","slide-wipe","scale-up","fade","drop-in"].map((v) => (
                        <SelectItem key={v} value={v}>{v.replace("-"," ").replace(/\b\w/g,(c)=>c.toUpperCase())}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldRow>
              </div>
            )}

            <SectionChip icon={TrendingUp} label="Ticker" color="#a78bfa" />
            <FieldRow label="Ticker Text">
              <Input className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                placeholder="Scrolling news ticker · type your message here…"
                value={draft.overlayTickerText} onChange={(e) => set("overlayTickerText", e.target.value)} />
            </FieldRow>
            {draft.overlayTickerText && (
              <div className="grid grid-cols-3 gap-3">
                <FieldRow label="Style">
                  <PillToggle value={draft.tickerStyle} onChange={(v) => set("tickerStyle", v as any)}
                    options={[{ value:"crawl",label:"Crawl"},{value:"flipper",label:"Flipper"},{value:"flash-alert",label:"Alert"}]} />
                </FieldRow>
                <FieldRow label="Speed">
                  <div className="flex items-center gap-2">
                    <Slider value={[draft.overlayTickerSpeed]} min={20} max={200} step={5}
                      onValueChange={([v]) => set("overlayTickerSpeed", v)} />
                    <span className="text-[10px] text-slate-500 w-7 shrink-0">{draft.overlayTickerSpeed}</span>
                  </div>
                </FieldRow>
                <FieldRow label="Color">
                  <div className="flex gap-1.5 items-center">
                    <input type="color" value={draft.overlayTickerColor}
                      onChange={(e) => set("overlayTickerColor", e.target.value)}
                      className="w-8 h-8 rounded cursor-pointer border border-slate-700/60 bg-transparent" />
                    <span className="text-[10px] font-mono text-slate-500">{draft.overlayTickerColor}</span>
                  </div>
                </FieldRow>
              </div>
            )}

            <SectionChip icon={MessageSquare} label="Message Box" color="#a78bfa" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">Show message overlay</span>
              <Switch checked={draft.messageEnabled} onCheckedChange={(v) => set("messageEnabled", v)} />
            </div>
            {draft.messageEnabled && (
              <>
                <FieldRow label="Message Text">
                  <Input className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                    placeholder="Your message…" value={draft.messageText} onChange={(e) => set("messageText", e.target.value)} />
                </FieldRow>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value:"news-classic",label:"News"},{ value:"breaking-alert",label:"Break"},
                    { value:"minimal-clean",label:"Clean"},{ value:"cinema",label:"Cinema"},
                    { value:"social-card",label:"Social"},{ value:"broadcast-official",label:"Offcl"},
                    { value:"pill",label:"Pill"},{ value:"watermark",label:"Mark"},
                  ].map((s) => (
                    <button key={s.value} onClick={() => set("messageStyle", s.value as any)}
                      className="py-1.5 rounded text-[9px] font-bold transition-all"
                      style={{ border: `1px solid ${draft.messageStyle===s.value?"rgba(167,139,250,0.8)":"rgba(51,65,85,0.5)"}`,
                        background: draft.messageStyle===s.value?"rgba(167,139,250,0.12)":"rgba(8,12,24,0.4)",
                        color: draft.messageStyle===s.value?"#a78bfa":"#475569" }}>
                      {s.label}
                    </button>
                  ))}
                </div>
                <FieldRow label="Position">
                  <PillToggle value={draft.messagePosition} onChange={(v) => set("messagePosition", v as any)}
                    options={[
                      {value:"top-left",label:"↖ TL"},{value:"top-right",label:"↗ TR"},
                      {value:"center",label:"⊕ Ctr"},{value:"bottom-left",label:"↙ BL"},
                      {value:"bottom-center",label:"↓ BC"},{value:"bottom-right",label:"↘ BR"},
                    ]} />
                </FieldRow>
              </>
            )}
          </>
        )}

        {/* ═══════════ SUBS TAB ═══════════ */}
        {tab === "subs" && (
          <>
            <SectionChip icon={Users} label="Subscriber Counter" color="#34d399" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">Show subscriber box</span>
              <Switch checked={draft.subBoxEnabled} onCheckedChange={(v) => { set("subBoxEnabled", v); if (v) set("overlayLiveCount", false); }} />
            </div>
            {draft.subBoxEnabled && (
              <>
                <FieldRow label="Style">
                  <div className="grid grid-cols-5 gap-1.5">
                    {SUB_STYLES.map((s) => (
                      <button key={s.value} onClick={() => set("subBoxStyle", s.value as any)}
                        className="relative rounded overflow-hidden transition-all"
                        style={{ aspectRatio: "4/3",
                          border: `1.5px solid ${draft.subBoxStyle===s.value?"rgba(52,211,153,0.8)":"rgba(51,65,85,0.4)"}`,
                          boxShadow: draft.subBoxStyle===s.value?"0 0 8px rgba(52,211,153,0.2)":"none" }}>
                        {s.preview()}
                        <div className="absolute bottom-0 left-0 right-0 text-center py-0.5"
                          style={{ background: "rgba(0,0,0,0.75)" }}>
                          <span className="text-[7px] font-bold" style={{ color: draft.subBoxStyle===s.value?"#34d399":"#64748b" }}>{s.label}</span>
                        </div>
                        {draft.subBoxStyle===s.value && (
                          <div className="absolute top-0.5 right-0.5 w-3 h-3 rounded-full flex items-center justify-center" style={{ background:"#34d399" }}>
                            <Check className="w-1.5 h-1.5 text-black" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </FieldRow>

                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label="Position">
                    <PillToggle value={draft.subBoxPosition} onChange={(v) => set("subBoxPosition", v as any)}
                      options={[
                        {value:"top-left",label:"↖ TL"},{value:"top-right",label:"↗ TR"},
                        {value:"center-left",label:"← CL"},{value:"center-right",label:"→ CR"},
                        {value:"bottom-left",label:"↙ BL"},{value:"bottom-right",label:"↘ BR"},
                      ]} />
                  </FieldRow>
                  <FieldRow label="Appear Animation">
                    <PillToggle value={draft.subBoxAnimStyle} onChange={(v) => set("subBoxAnimStyle", v as any)}
                      options={[
                        {value:"none",label:"None"},{value:"count-up",label:"Count Up"},
                        {value:"pulse-glow",label:"Pulse"},{value:"slide-in",label:"Slide"},
                        {value:"celebrate",label:"🎉 Pop"},
                      ]} />
                  </FieldRow>
                </div>

                <div className="flex items-center justify-between rounded-lg px-3 py-2"
                  style={{ background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.15)" }}>
                  <span className="text-xs text-slate-400">Show viewer count</span>
                  <Switch checked={draft.subBoxShowViewers} onCheckedChange={(v) => set("subBoxShowViewers", v)} />
                </div>
              </>
            )}

            <SectionChip icon={Youtube} label="YouTube Live Count" color="#34d399" />
            <div className="rounded-lg p-3 space-y-2" style={{ background: "rgba(255,0,0,0.06)", border: "1px solid rgba(255,0,0,0.15)" }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Youtube className="w-3.5 h-3.5 text-red-500" />
                  <span className="text-[11px] font-semibold text-slate-300">Embed live count in headline</span>
                </div>
                <Switch checked={draft.overlayLiveCount} onCheckedChange={(v) => { set("overlayLiveCount", v); if (v) set("subBoxEnabled", false); }} />
              </div>
              {draft.overlayLiveCount && (
                <Input className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700 font-mono"
                  placeholder="UCxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={draft.youtubeChannelId} onChange={(e) => set("youtubeChannelId", e.target.value)} />
              )}
            </div>

            <SectionChip icon={MessageSquare} label="Live Chat Overlay" color="#34d399" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">Show chat overlay</span>
              <Switch checked={draft.chatEnabled} onCheckedChange={(v) => set("chatEnabled", v)} />
            </div>
            {draft.chatEnabled && (
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Style">
                  <PillToggle value={draft.chatStyle} onChange={(v) => set("chatStyle", v as any)}
                    options={[{value:"list",label:"List"},{value:"bubble",label:"Bubble"}]} />
                </FieldRow>
                <FieldRow label="Position">
                  <PillToggle value={draft.chatPosition} onChange={(v) => set("chatPosition", v as any)}
                    options={[{value:"top-left",label:"↖ TL"},{value:"top-right",label:"↗ TR"},{value:"bottom-left",label:"↙ BL"},{value:"bottom-right",label:"↘ BR"}]} />
                </FieldRow>
                <FieldRow label={`Max messages: ${draft.chatMaxMessages}`}>
                  <Slider value={[draft.chatMaxMessages]} min={2} max={10} step={1}
                    onValueChange={([v]) => set("chatMaxMessages", v)} />
                </FieldRow>
              </div>
            )}

            {needsYtKey && draft.youtubeChannelId && (
              <div className="rounded-lg px-3 py-2 flex items-center gap-2"
                style={{ background: "rgba(52,211,153,0.07)", border: "1px solid rgba(52,211,153,0.2)" }}>
                <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                <p className="text-[9px] text-emerald-600">
                  Channel ID set · add <span className="font-mono">GOOGLE_API_KEY</span> in Secrets for live data.
                </p>
              </div>
            )}
          </>
        )}

        {/* ═══════════ ADS TAB ═══════════ */}
        {tab === "ads" && (
          <>
            <SectionChip icon={Megaphone} label="Ad Overlay" color="#f97316" />
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-300 font-semibold">Enable Ad Overlay</span>
                <p className="text-[10px] text-slate-600 mt-0.5">Overlay ads hot-swap — no stream interruption</p>
              </div>
              <Switch checked={draft.adEnabled} onCheckedChange={(v) => set("adEnabled", v)} />
            </div>

            {draft.adEnabled && (
              <>
                <FieldRow label="Ad Style">
                  <div className="grid grid-cols-3 gap-2">
                    {AD_STYLES.map((s) => (
                      <button key={s.value} onClick={() => set("adStyle", s.value as any)}
                        className="relative rounded-lg overflow-hidden transition-all"
                        style={{ height: "50px",
                          border: `1.5px solid ${draft.adStyle===s.value?"rgba(249,115,22,0.8)":"rgba(51,65,85,0.4)"}`,
                          background: draft.adStyle===s.value?"rgba(249,115,22,0.06)":"rgba(8,12,24,0.4)",
                          boxShadow: draft.adStyle===s.value?"0 0 10px rgba(249,115,22,0.2)":"none",
                        }}>
                        {s.preview(draft.adAccentColor || "#f97316")}
                        <div className="absolute bottom-0 left-0 right-0 text-center"
                          style={{ background: "rgba(0,0,0,0.7)", padding: "1px 0" }}>
                          <span className="text-[8px] font-bold" style={{ color: draft.adStyle===s.value?"#f97316":"#64748b" }}>{s.label}</span>
                        </div>
                        {draft.adStyle===s.value && (
                          <div className="absolute top-0.5 right-0.5 w-3 h-3 rounded-full flex items-center justify-center" style={{ background:"#f97316" }}>
                            <Check className="w-1.5 h-1.5 text-black" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </FieldRow>

                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label="Ad Headline">
                    <Input className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                      placeholder="Brand Name" value={draft.adText} onChange={(e) => set("adText", e.target.value)} />
                  </FieldRow>
                  <FieldRow label="Sub Text">
                    <Input className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                      placeholder="Tagline or URL" value={draft.adSubText} onChange={(e) => set("adSubText", e.target.value)} />
                  </FieldRow>
                  <FieldRow label="CTA Button">
                    <Input className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                      placeholder="LEARN MORE" value={draft.adCtaLabel} onChange={(e) => set("adCtaLabel", e.target.value)} />
                  </FieldRow>
                  <FieldRow label={`Countdown  ${draft.adCountdown === 0 ? "Off" : `${draft.adCountdown}s`}`}>
                    <Slider value={[draft.adCountdown]} min={0} max={60} step={5}
                      onValueChange={([v]) => set("adCountdown", v)} />
                    <div className="flex justify-between text-[9px] text-slate-700"><span>Off</span><span>60s</span></div>
                  </FieldRow>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label="Background Color">
                    <div className="flex gap-2 items-center">
                      <input type="color" value={draft.adBgColor}
                        onChange={(e) => set("adBgColor", e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border border-slate-700/60 bg-transparent" />
                      <Input className="flex-1 h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 font-mono"
                        value={draft.adBgColor} onChange={(e) => set("adBgColor", e.target.value)} />
                    </div>
                  </FieldRow>
                  <FieldRow label="Accent Color">
                    <div className="flex gap-2 items-center">
                      <input type="color" value={draft.adAccentColor}
                        onChange={(e) => set("adAccentColor", e.target.value)}
                        className="w-8 h-8 rounded cursor-pointer border border-slate-700/60 bg-transparent" />
                      <Input className="flex-1 h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 font-mono"
                        value={draft.adAccentColor} onChange={(e) => set("adAccentColor", e.target.value)} />
                    </div>
                  </FieldRow>
                </div>

                <FieldRow label="Ad Position">
                  <PillToggle value={draft.adPosition} onChange={(v) => set("adPosition", v as any)}
                    options={[
                      {value:"top-left",label:"↖ TL"},{value:"top-right",label:"↗ TR"},
                      {value:"center",label:"⊕ Ctr"},{value:"bottom-left",label:"↙ BL"},
                      {value:"bottom-center",label:"↓ BC"},{value:"bottom-right",label:"↘ BR"},
                    ]} />
                </FieldRow>

                {/* Ad live preview strip */}
                <div className="rounded-lg overflow-hidden" style={{ height: "52px", position: "relative",
                  background: "#000", border: "1px solid rgba(249,115,22,0.2)" }}>
                  {AD_STYLES.find((s) => s.value === draft.adStyle)?.preview(draft.adAccentColor || "#f97316")}
                </div>
              </>
            )}
          </>
        )}

        {/* ═══════════ BRAND TAB ═══════════ */}
        {tab === "brand" && (
          <>
            <SectionChip icon={Tv} label="Channel Identity" color="#f472b6" />
            <div className="grid grid-cols-2 gap-3">
              <FieldRow label="Channel Name">
                <Input className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                  placeholder="Your Channel" value={draft.overlayChannelName} onChange={(e) => set("overlayChannelName", e.target.value)} />
              </FieldRow>
              <FieldRow label="Headline">
                <Input className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                  placeholder="Breaking: …" value={draft.overlayHeadline} onChange={(e) => set("overlayHeadline", e.target.value)} />
              </FieldRow>
              <FieldRow label="Banner Color">
                <div className="flex gap-2 items-center">
                  <input type="color" value={draft.overlayBannerColor}
                    onChange={(e) => set("overlayBannerColor", e.target.value)}
                    className="w-8 h-8 rounded cursor-pointer border border-slate-700/60 bg-transparent" />
                  <Input className="flex-1 h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 font-mono"
                    value={draft.overlayBannerColor} onChange={(e) => set("overlayBannerColor", e.target.value)} />
                </div>
              </FieldRow>
            </div>

            {stream.overlayLogoPath && (
              <>
                <SectionChip icon={Star} label="Logo" color="#f472b6" />
                <div className="grid grid-cols-3 gap-3">
                  <FieldRow label="Position">
                    <Select value={draft.overlayLogoPosition} onValueChange={(v) => set("overlayLogoPosition", v as any)}>
                      <SelectTrigger className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="top-left">Top Left</SelectItem>
                        <SelectItem value="top-right">Top Right</SelectItem>
                        <SelectItem value="bottom-left">Bottom Left</SelectItem>
                        <SelectItem value="bottom-right">Bottom Right</SelectItem>
                      </SelectContent>
                    </Select>
                  </FieldRow>
                  <FieldRow label="Animation">
                    <Select value={draft.overlayLogoAnimation} onValueChange={(v) => set("overlayLogoAnimation", v as any)}>
                      <SelectTrigger className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["none","pulse","breathe","fade-in","flash"].map((v) => (
                          <SelectItem key={v} value={v}>{v.replace("-"," ").replace(/\b\w/g,(c)=>c.toUpperCase())}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FieldRow>
                  <FieldRow label={`Size  ${Math.round((draft.overlayLogoScale || 0.15) * 100)}%`}>
                    <Slider value={[draft.overlayLogoScale || 0.15]} min={0.05} max={0.35} step={0.01}
                      onValueChange={([v]) => set("overlayLogoScale", v)} />
                  </FieldRow>
                </div>
              </>
            )}

            <SectionChip icon={AtSign} label="Social Handle Bar" color="#f472b6" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">Show social handle slide-in</span>
              <Switch checked={draft.overlaySocialEnabled} onCheckedChange={(v) => set("overlaySocialEnabled", v)} />
            </div>
            {draft.overlaySocialEnabled && (
              <Input className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                placeholder="@yourhandle" value={draft.overlaySocialHandle} onChange={(e) => set("overlaySocialHandle", e.target.value)} />
            )}

            <SectionChip icon={QrCode} label="QR Code Overlay" color="#f472b6" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-400">Show QR code on stream</span>
              <Switch checked={draft.overlayQrEnabled} onCheckedChange={(v) => set("overlayQrEnabled", v)} />
            </div>
            {draft.overlayQrEnabled && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label="URL">
                    <Input className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                      placeholder="https://…" value={draft.overlayQrUrl} onChange={(e) => set("overlayQrUrl", e.target.value)} />
                  </FieldRow>
                  <FieldRow label="Label">
                    <Input className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                      placeholder="BUY ME COFFEE" value={draft.overlayQrLabel} onChange={(e) => set("overlayQrLabel", e.target.value)} />
                  </FieldRow>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <FieldRow label="Position">
                    <PillToggle value={draft.overlayQrPosition} onChange={(v) => set("overlayQrPosition", v as any)}
                      options={[{value:"top-left",label:"↖"},{value:"top-right",label:"↗"},{value:"bottom-left",label:"↙"},{value:"bottom-right",label:"↘"}]} />
                  </FieldRow>
                  <FieldRow label="Size">
                    <PillToggle value={draft.overlayQrSize} onChange={(v) => set("overlayQrSize", v as any)}
                      options={[{value:"small",label:"S"},{value:"medium",label:"M"},{value:"large",label:"L"}]} />
                  </FieldRow>
                </div>
                {draft.overlayQrUrl && (
                  <div className="flex items-center gap-3">
                    <div className="bg-white rounded-lg p-1.5 shrink-0">
                      <QRCodeSVG value={draft.overlayQrUrl} size={52} level="L" />
                    </div>
                    <div>
                      <div className="px-2 py-1 rounded text-xs font-black text-white tracking-wider inline-block"
                        style={{ background: "#F97316" }}>{draft.overlayQrLabel || "QR CODE"}</div>
                      <p className="text-[9px] text-slate-600 mt-1">{draft.overlayQrPosition.replace("-"," ").toUpperCase()} · {draft.overlayQrSize.toUpperCase()}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Mini preview + Apply ── */}
      <div className="border-t border-slate-800/50 px-4 py-3 space-y-3">
        <LivePreviewMini draft={draft} stream={stream} />

        <div className="flex items-center gap-2">
          <Button className="flex-1 gap-2 font-bold text-sm h-9" disabled={!pending || applying} onClick={apply}
            style={pending ? { background: "linear-gradient(135deg, #16a34a, #15803d)", border: "none" } : {}}>
            {applying ? <><Sparkles className="w-4 h-4 animate-spin" />Applying…</>
              : justApplied ? <><Check className="w-4 h-4" />Applied!</>
              : <><Sparkles className="w-4 h-4" />{pending ? "Apply to Live" : "Up to Date"}</>}
          </Button>
          {pending && (
            <Button variant="ghost" size="sm" onClick={() => setDraft(buildDraft(stream))}
              className="text-slate-500 hover:text-slate-300 h-9 px-3">Discard</Button>
          )}
        </div>
        {pending && (
          <p className="text-[10px] text-amber-600 text-center -mt-1">
            Safe room · tap Apply to push live without interrupting the stream
          </p>
        )}
      </div>
    </div>
  );
}

// ── Mini live preview ─────────────────────────────────────────────────────────
function LivePreviewMini({ draft, stream }: { draft: OverlayDraft; stream: StreamConfig }) {
  const isVertical = stream.ratio === "mobile";

  const posStyle = (pos: string, offset = 0): React.CSSProperties => {
    const b: React.CSSProperties = { position: "absolute" };
    if (pos === "top-left") return { ...b, top: 3 + offset, left: 3 };
    if (pos === "top-right") return { ...b, top: 3 + offset, right: 3 };
    if (pos === "center") return { ...b, top: "50%", left: "50%", transform: "translate(-50%,-50%)" };
    if (pos === "bottom-left") return { ...b, bottom: 12 + offset, left: 3 };
    if (pos === "bottom-right") return { ...b, bottom: 12 + offset, right: 3 };
    if (pos === "center-left") return { ...b, top: "42%", left: 3 };
    if (pos === "center-right") return { ...b, top: "42%", right: 3 };
    return { ...b, bottom: 12 + offset, left: "50%", transform: "translateX(-50%)" };
  };

  return (
    <div>
      <Label className="text-[10px] text-slate-600 uppercase tracking-widest font-bold block mb-1.5">Draft Preview</Label>
      <div className="relative rounded-lg overflow-hidden mx-auto"
        style={{
          aspectRatio: isVertical ? "9/16" : "16/9",
          maxHeight: isVertical ? "220px" : "160px",
          maxWidth: isVertical ? "124px" : "100%",
          background: "linear-gradient(160deg, #0d1629, #080e1c)",
          border: "1px solid rgba(30,41,59,0.8)",
        }}>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-slate-800 text-[6px] font-mono tracking-[0.3em]">DRAFT PREVIEW</span>
        </div>

        {/* QR */}
        {draft.overlayQrEnabled && draft.overlayQrUrl && (
          <div style={posStyle(draft.overlayQrPosition)} className="flex flex-col items-center gap-0.5">
            <div className="bg-white rounded p-0.5"><QRCodeSVG value={draft.overlayQrUrl} size={16} level="L" /></div>
            <div className="text-white text-[3.5px] font-black px-0.5 rounded" style={{ background: "#F97316", maxWidth: "32px" }}>
              {(draft.overlayQrLabel || "QR").slice(0, 10)}
            </div>
          </div>
        )}

        {/* Message Box */}
        {draft.messageEnabled && draft.messageText && (() => {
          const bg: Record<string,string> = {
            "news-classic":"rgba(13,22,41,0.94)","breaking-alert":"rgba(183,28,28,0.95)",
            "minimal-clean":"rgba(8,8,8,0.72)","cinema":"rgba(0,0,0,0.93)",
            "social-card":"rgba(26,26,46,0.90)","broadcast-official":"rgba(10,22,40,0.96)",
            "pill":"rgba(56,189,248,0.9)","watermark":"rgba(0,0,0,0.35)",
          };
          return (
            <div style={{ ...posStyle(draft.messagePosition), background: bg[draft.messageStyle]||bg["news-classic"],
              padding: "2px 5px", borderRadius: draft.messageStyle==="pill"?"8px":"2px", maxWidth: "52%" }}>
              <span className="text-[4.5px] font-bold leading-tight block text-white">
                {draft.messageText.slice(0, 36)}
              </span>
            </div>
          );
        })()}

        {/* Sub Box */}
        {draft.subBoxEnabled && (() => {
          const p = draft.subBoxPosition;
          const b: React.CSSProperties = { position: "absolute" };
          const s: React.CSSProperties =
            p === "top-left" ? { ...b, top: 3, left: 3 } :
            p === "top-right" ? { ...b, top: 3, right: 3 } :
            p === "center-left" ? { ...b, top: "42%", left: 3 } :
            p === "center-right" ? { ...b, top: "42%", right: 3 } :
            p === "bottom-left" ? { ...b, bottom: 3, left: 3 } :
            { ...b, bottom: 3, right: 3 };
          return (
            <div style={{ ...s, width: draft.subBoxStyle === "pill-badge" ? "auto" : "55px", height: draft.subBoxStyle === "pill-badge" ? "auto" : "30px", overflow: "hidden", borderRadius: 3 }}>
              {SUB_STYLES.find(st => st.value === draft.subBoxStyle)?.preview()}
            </div>
          );
        })()}

        {/* Chat */}
        {draft.chatEnabled && !draft.subBoxEnabled && (
          <div style={{ ...posStyle(draft.chatPosition), background: "rgba(13,22,41,0.90)",
            width: "58px", borderRadius: "2px", border: "1px solid rgba(56,189,248,0.2)", overflow: "hidden" }}>
            <div className="text-[3.5px] px-1 py-0.5 font-bold" style={{ color: "#38bdf8" }}>⚡ LIVE CHAT</div>
            <div className="text-[3px] px-1 py-px" style={{ color: "#CCC" }}>Sarah: Great stream!</div>
            <div className="text-[3px] px-1 py-px" style={{ color: "#CCC" }}>John: Hello! 🔥</div>
          </div>
        )}

        {/* Ad */}
        {draft.adEnabled && draft.adText && (() => {
          const adPos = draft.adPosition;
          const adStyle: React.CSSProperties = { position: "absolute" };
          if (adPos === "top-left") Object.assign(adStyle, { top: 3, left: 3 });
          else if (adPos === "top-right") Object.assign(adStyle, { top: 3, right: 3 });
          else if (adPos === "bottom-left") Object.assign(adStyle, { bottom: 12, left: 3 });
          else if (adPos === "bottom-right") Object.assign(adStyle, { bottom: 12, right: 3 });
          else if (adPos === "center") Object.assign(adStyle, { top: "50%", left: "50%", transform: "translate(-50%,-50%)" });
          else Object.assign(adStyle, { bottom: 12, left: "50%", transform: "translateX(-50%)" });
          return (
            <div style={{ ...adStyle, background: draft.adBgColor, borderTop: `1px solid ${draft.adAccentColor}`,
              padding: "1.5px 4px", borderRadius: 2, maxWidth: "65%", display: "flex", alignItems: "center", gap: 2 }}>
              <span className="text-[4px] text-white font-bold">{draft.adText.slice(0, 20)}</span>
              {draft.adCtaLabel && <span className="text-[3.5px] font-black px-1 rounded" style={{ background: draft.adAccentColor, color: "#000" }}>{draft.adCtaLabel.slice(0,8)}</span>}
            </div>
          );
        })()}

        {/* Lower Third */}
        {draft.lowerThirdStyle === "l-cut" && (draft.lowerThirdName || draft.lowerThirdTitle) && (
          <div className="absolute left-0 flex flex-col justify-center pl-1.5"
            style={{ bottom: draft.overlayTickerText ? "10px" : "2px", width: "65%", height: "22px", background: "rgba(12,21,36,0.95)" }}>
            <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: draft.lowerThirdAccentColor || "#e53935" }} />
            {draft.lowerThirdName && <div className="text-[5px] text-white font-bold leading-tight truncate">{draft.lowerThirdName}</div>}
            {draft.lowerThirdTitle && <div className="text-[3.5px] leading-tight truncate" style={{ color: "#BBBBCC" }}>{draft.lowerThirdTitle}</div>}
          </div>
        )}
        {draft.lowerThirdStyle === "breaking-news" && (draft.lowerThirdName || draft.lowerThirdTitle) && (
          <div className="absolute left-0 right-0 flex"
            style={{ bottom: draft.overlayTickerText ? "10px" : "2px", height: "20px", background: "rgba(8,8,8,0.96)" }}>
            <div className="flex flex-col justify-center px-1 shrink-0"
              style={{ background: draft.lowerThirdAccentColor || "#c41e1e", width: "24%" }}>
              <div className="text-[3px] text-white font-black">BREAKING</div>
              <div className="text-[4px] text-white font-black">NEWS</div>
            </div>
            <div className="flex flex-col justify-center px-1 overflow-hidden">
              {draft.lowerThirdName && <div className="text-[5px] text-white font-bold leading-tight truncate">{draft.lowerThirdName}</div>}
              {draft.lowerThirdTitle && <div className="text-[3.5px] leading-tight truncate" style={{ color: "#FFDD44" }}>{draft.lowerThirdTitle}</div>}
            </div>
          </div>
        )}
        {draft.lowerThirdStyle === "ticker-name" && draft.lowerThirdName && (
          <div className="absolute left-0 right-0 flex items-center"
            style={{ bottom: draft.overlayTickerText ? "10px" : "2px", height: "14px" }}>
            <div className="px-1 py-px text-[4.5px] font-black text-white shrink-0" style={{ background: draft.lowerThirdAccentColor }}>{draft.lowerThirdName.slice(0,12)}</div>
            {draft.lowerThirdTitle && <div className="flex-1 px-1 py-px text-[4px] text-white bg-black/70 truncate">{draft.lowerThirdTitle}</div>}
          </div>
        )}
        {draft.lowerThirdStyle === "side-strip" && draft.lowerThirdName && (
          <div className="absolute left-0 flex items-center gap-1 pl-1"
            style={{ top: "30%", height: "22px" }}>
            <div className="w-0.5 h-full rounded" style={{ background: draft.lowerThirdAccentColor }} />
            <div>
              <div className="text-[4.5px] text-white font-bold">{draft.lowerThirdName.slice(0,12)}</div>
              {draft.lowerThirdTitle && <div className="text-[3.5px] text-slate-400">{draft.lowerThirdTitle.slice(0,12)}</div>}
            </div>
          </div>
        )}
        {draft.lowerThirdStyle === "none" && draft.overlayChannelName && (
          <div className="absolute flex items-stretch text-[7px] leading-tight"
            style={{ bottom: draft.overlayTickerText ? "10px" : "2px", left: 0 }}>
            <div className="px-1.5 py-0.5 text-white font-bold flex items-center" style={{ backgroundColor: draft.overlayBannerColor || "#c41e1e" }}>
              {draft.overlayChannelName}
            </div>
            {draft.overlayHeadline && (
              <div className="px-1.5 py-0.5 text-white bg-gray-800/90 flex items-center">
                {draft.overlayHeadline.slice(0, 16)}
              </div>
            )}
          </div>
        )}

        {/* Ticker */}
        {draft.overlayTickerText && (
          <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[6px] text-white overflow-hidden whitespace-nowrap"
            style={{ backgroundColor: (draft.overlayTickerColor || "#1a1a2e") + "E6" }}>
            <span className="inline-block animate-marquee">{draft.overlayTickerText}</span>
          </div>
        )}

        {/* Active overlays indicator */}
        <div className="absolute top-1.5 left-1.5 flex gap-0.5 flex-wrap max-w-[60%]">
          {draft.overlayEnabled && <span className="text-[5px] px-0.5 rounded font-bold" style={{ background: "rgba(239,68,68,0.8)", color: "#fff" }}>ON</span>}
          {draft.adEnabled && <span className="text-[5px] px-0.5 rounded font-bold" style={{ background: "rgba(249,115,22,0.8)", color: "#fff" }}>AD</span>}
          {draft.subBoxEnabled && <span className="text-[5px] px-0.5 rounded font-bold" style={{ background: "rgba(52,211,153,0.8)", color: "#000" }}>SUB</span>}
          {draft.chatEnabled && <span className="text-[5px] px-0.5 rounded font-bold" style={{ background: "rgba(56,189,248,0.8)", color: "#000" }}>CHAT</span>}
        </div>
      </div>
    </div>
  );
}

// ── Main OverlayAdmin panel ───────────────────────────────────────────────────
export function OverlayAdmin({ streams, onUpdate }: OverlayAdminProps) {
  const [open, setOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [qrTrackUrl, setQrTrackUrl] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [scanFlash, setScanFlash] = useState<number | null>(null);
  const { subscribe } = useWebSocket();

  const activeStreams = streams.filter((s) => s.status === "streaming" || s.status === "reconnecting");
  const isLive = activeStreams.some((s) => s.status === "streaming");

  const fetchInvite = useCallback(async () => {
    try {
      const res = await fetch("/api/invite", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setInviteUrl(data.url);
        setQrTrackUrl(`${window.location.origin}/api/qr/track?cb=${encodeURIComponent(data.url)}`);
      }
    } catch {}
  }, []);

  const fetchQrCount = useCallback(async () => {
    try {
      const res = await fetch("/api/qr/count", { credentials: "include" });
      if (res.ok) { const d = await res.json(); setScanCount(d.count || 0); }
    } catch {}
  }, []);

  useEffect(() => { fetchInvite(); fetchQrCount(); }, [fetchInvite, fetchQrCount]);

  useEffect(() => {
    return subscribe("qr_scan", (msg) => {
      const count = msg.data?.count ?? 0;
      setScanCount(count); setScanFlash(count);
      const t = setTimeout(() => setScanFlash(null), 4000);
      return () => clearTimeout(t);
    });
  }, [subscribe]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="relative rounded-xl overflow-hidden border border-slate-700/60"
        style={{ background: "linear-gradient(160deg, #080d18 0%, #0d1525 40%, #060e1c 100%)" }}>
        <div className="absolute inset-0 broadcast-scanline pointer-events-none" />

        <CollapsibleTrigger asChild>
          <button className="relative w-full px-4 py-3 flex items-center gap-3 text-left group"
            data-testid="button-overlay-admin-toggle">
            <div className="flex items-center gap-2.5 shrink-0">
              <div className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
                style={{ background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.25)" }}>
                <MonitorPlay className="w-4.5 h-4.5" style={{ color: "#38bdf8" }} />
              </div>
              <EqBars color={isLive ? "#34d399" : "#334155"} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white font-bold tracking-wider text-sm">CONTROL ROOM</span>
                {isLive ? (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold text-white"
                    style={{ background: "rgba(239,68,68,0.22)", border: "1px solid rgba(239,68,68,0.45)" }}>
                    <OnAirDot />ON AIR</span>
                ) : activeStreams.length > 0 ? (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold text-amber-300"
                    style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)" }}>
                    <Signal className="w-3 h-3" />CONNECTING</span>
                ) : <span className="text-slate-700 text-xs font-mono">STANDBY</span>}
                {activeStreams.length > 0 && (
                  <span className="text-[10px] text-slate-600 font-mono">
                    {activeStreams.length} stream{activeStreams.length > 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <p className="text-slate-600 text-xs mt-0.5">
                {activeStreams.length === 0
                  ? "No active streams — start a stream to access the control room"
                  : "Layout · Overlay · Subs · Ads · Brand — apply live without restarting"}
              </p>
            </div>
            <div className="text-slate-600 group-hover:text-slate-400 transition-colors">
              {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="relative border-t border-slate-800/60 px-4 pb-5 pt-3 space-y-4">
            {activeStreams.length === 0 ? (
              <div className="flex items-center gap-3 py-10 justify-center text-slate-600">
                <AlertCircle className="w-4 h-4" />
                <p className="text-sm">Start a stream to access the control room.</p>
              </div>
            ) : (
              activeStreams.map((stream, i) => (
                <AdminStreamOverlay key={stream.id} stream={stream} index={i} onUpdate={onUpdate} />
              ))
            )}

            {/* Invite QR */}
            <div className="rounded-xl overflow-hidden mt-2"
              style={{ background: "linear-gradient(135deg, rgba(10,14,28,0.9),rgba(5,10,22,0.95))", border: "1px solid rgba(51,65,85,0.7)" }}>
              <div className="px-4 py-3 flex items-center justify-between border-b border-slate-800/50">
                <div className="flex items-center gap-2">
                  <div className="flex items-center justify-center w-7 h-7 rounded-lg"
                    style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)" }}>
                    <QrCode className="w-3.5 h-3.5 text-sky-400" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-200 tracking-wide">INVITE QR CODE</p>
                    <p className="text-[10px] text-slate-600">Scan to join the dashboard</p>
                  </div>
                </div>
                {scanCount > 0 && (
                  <div className="flex items-center gap-2">
                    <Users className="w-3 h-3 text-sky-400" />
                    <span className={`text-xs font-bold transition-colors ${scanFlash ? "text-emerald-400" : "text-sky-400"}`}>
                      {scanCount} scan{scanCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                )}
              </div>
              {inviteUrl && (
                <div className="px-4 py-3 flex items-center gap-4">
                  {qrTrackUrl && (
                    <div className="bg-white rounded-xl p-2 shrink-0">
                      <QRCodeSVG value={qrTrackUrl} size={72} level="L" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-[10px] text-slate-600 font-mono break-all">{inviteUrl}</p>
                    <div className="flex items-center gap-2">
                      <Shield className="w-3 h-3 text-slate-600" />
                      <span className="text-[9px] text-slate-700">Single-use invite token · expires in 24h</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
