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
  Signal, Youtube, Shield, QrCode, RotateCcw, Users,
  Check, AlertTriangle, AtSign, Share2, MessageSquare,
  AlignLeft, Layers, TrendingUp, MessageCircle, Tv,
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
  lowerThirdStyle: "none" | "l-cut" | "breaking-news";
  lowerThirdName: string;
  lowerThirdTitle: string;
  lowerThirdAccentColor: string;
  lowerThirdAnimation: "none" | "slide-wipe" | "scale-up";
  tickerStyle: "crawl" | "flipper";
  messageEnabled: boolean;
  messageText: string;
  messageStyle: "news-classic" | "breaking-alert" | "minimal-clean" | "cinema" | "social-card" | "broadcast-official";
  messagePosition: "top-left" | "top-right" | "center" | "bottom-left" | "bottom-right" | "bottom-center";
  subBoxEnabled: boolean;
  subBoxStyle: "minimal" | "card" | "broadcast" | "flip-counter" | "whatsapp" | "recent-activity";
  subBoxPosition: "top-left" | "top-right" | "center-left" | "center-right" | "bottom-left" | "bottom-right";
  subBoxShowViewers: boolean;
  chatEnabled: boolean;
  chatPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  chatStyle: "bubble" | "list";
  chatMaxMessages: number;
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
    chatEnabled: s.chatEnabled ?? false,
    chatPosition: s.chatPosition ?? "bottom-right",
    chatStyle: s.chatStyle ?? "list",
    chatMaxMessages: s.chatMaxMessages ?? 5,
  };
}

function hasDraftChanges(draft: OverlayDraft, stream: StreamConfig): boolean {
  return (Object.keys(draft) as (keyof OverlayDraft)[]).some(
    (k) => (draft[k] as any) !== ((stream as any)[k] ?? (buildDraft(stream) as any)[k])
  );
}

// ── Small shared UI ──────────────────────────────────────────────────────────

function EqBars({ color = "currentColor" }: { color?: string }) {
  return (
    <span className="flex items-end gap-0.5 h-6" style={{ color }} aria-hidden>
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

function SectionHeader({ icon: Icon, label, color = "#38bdf8" }: { icon: any; label: string; color?: string }) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <div className="flex items-center justify-center w-5 h-5 rounded shrink-0"
        style={{ background: `${color}18`, border: `1px solid ${color}30` }}>
        <Icon className="w-3 h-3" style={{ color }} />
      </div>
      <span className="text-[10px] font-bold tracking-widest uppercase" style={{ color }}>{label}</span>
      <div className="flex-1 h-px" style={{ background: `${color}20` }} />
    </div>
  );
}

function PositionPicker({ value, onChange, options, cols = 3 }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; cols?: number;
}) {
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {options.map((opt) => (
        <button key={opt.value} onClick={() => onChange(opt.value)}
          className="py-1 px-1 rounded text-[9px] font-bold transition-all"
          style={{
            border: `1px solid ${value === opt.value ? "rgba(56,189,248,0.8)" : "rgba(51,65,85,0.6)"}`,
            background: value === opt.value ? "rgba(56,189,248,0.15)" : "rgba(8,12,24,0.5)",
            color: value === opt.value ? "#38bdf8" : "#64748b",
          }}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Flip-counter component (CSS split-flap animation) ───────────────────────
function FlipPanel({ ch }: { ch: string }) {
  const [cur, setCur] = useState(ch);
  const [next, setNext] = useState(ch);
  const [phase, setPhase] = useState<"idle" | "top" | "bottom">("idle");

  useEffect(() => {
    if (ch === cur) return;
    setNext(ch);
    setPhase("top");
    const t1 = setTimeout(() => setPhase("bottom"), 160);
    const t2 = setTimeout(() => { setCur(ch); setPhase("idle"); }, 320);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [ch]);

  return (
    <div style={{ display: "inline-flex", flexDirection: "column", width: "18px", height: "28px",
      background: "#141414", borderRadius: "2px", overflow: "hidden", position: "relative",
      border: "1px solid #2a2a2a", margin: "0 1px" }}>
      {/* Top half */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "50%",
        background: "#1e1e1e", display: "flex", alignItems: "flex-end", justifyContent: "center",
        paddingBottom: "0px", borderBottom: "1px solid #111",
        transformOrigin: "bottom center", perspective: "80px",
        transform: phase === "top" ? "rotateX(-90deg)" : "rotateX(0deg)",
        transition: phase === "top" ? "transform 0.16s ease-in" : "none" }}>
        <span style={{ color: "#FFE000", fontWeight: 900, fontSize: "13px", lineHeight: 1 }}>{phase === "bottom" ? next : cur}</span>
      </div>
      {/* Bottom half */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "50%",
        background: "#141414", display: "flex", alignItems: "flex-start", justifyContent: "center",
        paddingTop: "0px",
        transformOrigin: "top center", perspective: "80px",
        transform: phase === "bottom" ? "rotateX(0deg)" : "rotateX(90deg)",
        transition: phase === "bottom" ? "transform 0.16s ease-out" : "none" }}>
        <span style={{ color: "#FFE000", fontWeight: 900, fontSize: "13px", lineHeight: 1 }}>{next}</span>
      </div>
    </div>
  );
}

function FlipCounter({ value }: { value: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "1px", padding: "4px 6px",
      background: "#1c1c1c", borderRadius: "4px", border: "1px solid #2a2a2a" }}>
      {value.split("").map((ch, i) => <FlipPanel key={i} ch={ch} />)}
    </div>
  );
}

// ── Lower third style cards ─────────────────────────────────────────────────
const LT_STYLE_CARDS = [
  {
    value: "none",
    label: "Simple Banner",
    preview: (color: string) => (
      <div className="relative w-full h-full flex items-end pb-1 px-1">
        <div className="h-2.5 w-[65%] flex items-center px-1 text-[5px] text-white font-bold"
          style={{ background: color || "#c41e1e" }}>CHANNEL</div>
      </div>
    ),
  },
  {
    value: "l-cut",
    label: "L-Cut",
    preview: (color: string) => (
      <div className="relative w-full h-full flex items-end pb-1 px-1">
        <div className="relative h-[26px] w-[70%] flex flex-col justify-center pl-1.5"
          style={{ background: "rgba(12,21,36,0.95)" }}>
          <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: color || "#e53935" }} />
          <div className="text-[4.5px] text-white font-bold leading-tight">PERSON NAME</div>
          <div className="text-[3.5px] leading-tight" style={{ color: "#BBBBCC" }}>Reporter · Live</div>
        </div>
      </div>
    ),
  },
  {
    value: "breaking-news",
    label: "Breaking",
    preview: (color: string) => (
      <div className="relative w-full h-full flex items-end pb-1">
        <div className="w-full flex" style={{ height: "22px", background: "rgba(8,8,8,0.96)" }}>
          <div className="flex flex-col justify-center px-1 shrink-0" style={{ background: color || "#c41e1e", width: "28%" }}>
            <div className="text-[3px] text-white font-black">BREAKING</div>
            <div className="text-[4.5px] text-white font-black">NEWS</div>
          </div>
          <div className="flex flex-col justify-center px-1">
            <div className="text-[4px] text-white font-bold">HEADLINE TEXT</div>
            <div className="text-[3px]" style={{ color: "#FFDD44" }}>Sub-headline</div>
          </div>
        </div>
      </div>
    ),
  },
];

// ── Message box style data ──────────────────────────────────────────────────
const MSG_STYLES = [
  { value: "news-classic", label: "News Classic", bg: "rgba(13,22,41,0.94)", strip: "left" as const, text: "white" },
  { value: "breaking-alert", label: "Breaking Alert", bg: "rgba(183,28,28,0.95)", strip: null, text: "white" },
  { value: "minimal-clean", label: "Minimal Clean", bg: "rgba(8,8,8,0.72)", strip: null, text: "#EEE" },
  { value: "cinema", label: "Cinema", bg: "rgba(0,0,0,0.93)", strip: "lines" as const, text: "white" },
  { value: "social-card", label: "Social Card", bg: "rgba(26,26,46,0.90)", strip: null, text: "#F0F0F0" },
  { value: "broadcast-official", label: "Official", bg: "rgba(10,22,40,0.96)", strip: "top" as const, text: "white" },
];

// ── Sub-box style data (6 styles) ───────────────────────────────────────────
const SUB_STYLES = [
  {
    value: "minimal",
    label: "Minimal",
    preview: () => (
      <div className="flex flex-col justify-center px-1.5 py-1 h-full"
        style={{ background: "rgba(0,0,0,0.62)" }}>
        <div className="text-[4px] text-slate-500 font-bold mb-0.5">SUBSCRIBERS</div>
        <div className="text-[9px] text-white font-bold">12.5K</div>
      </div>
    ),
  },
  {
    value: "card",
    label: "Card",
    preview: () => (
      <div className="relative flex flex-col justify-center px-1.5 py-1 h-full"
        style={{ background: "rgba(13,22,41,0.92)" }}>
        <div className="absolute top-0 left-0 right-0 h-px bg-red-500" />
        <div className="text-[4px] font-bold mb-0.5" style={{ color: "#8899AA" }}>SUBSCRIBERS</div>
        <div className="text-[9px] text-white font-bold">12.5K</div>
      </div>
    ),
  },
  {
    value: "broadcast",
    label: "Broadcast",
    preview: () => (
      <div className="relative flex flex-col justify-center px-1.5 py-1 h-full"
        style={{ background: "rgba(10,10,26,0.94)" }}>
        <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: "#DAA520" }} />
        <div className="text-[4px] font-bold mb-0.5" style={{ color: "#8899AA" }}>SUBSCRIBERS</div>
        <div className="text-[9px] text-white font-bold">12.5K</div>
      </div>
    ),
  },
  {
    value: "flip-counter",
    label: "Flip Counter",
    preview: () => (
      <div className="flex flex-col items-center justify-center h-full gap-0.5"
        style={{ background: "#1c1c1c" }}>
        <div className="flex gap-0.5">
          {["1","2",".","5","K"].map((ch, i) => (
            <div key={i} style={{ width: "8px", height: "13px", background: "#141414",
              border: "1px solid #2a2a2a", borderRadius: "1px", display: "flex", alignItems: "center",
              justifyContent: "center", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: "50%",
                background: "#1e1e1e", borderBottom: "1px solid #111" }} />
              <span style={{ color: "#FFE000", fontSize: "7px", fontWeight: 900, zIndex: 1, position: "relative" }}>{ch}</span>
            </div>
          ))}
        </div>
        <div className="text-[3.5px]" style={{ color: "#505050" }}>SUBSCRIBERS</div>
      </div>
    ),
  },
  {
    value: "whatsapp",
    label: "WhatsApp",
    preview: () => (
      <div className="relative flex flex-col justify-center px-1.5 py-1 h-full"
        style={{ background: "#25D366" }}>
        <div className="text-[4px] font-bold mb-0.5" style={{ color: "#DCF8C6" }}>SUBSCRIBERS</div>
        <div className="text-[9px] text-white font-bold">12.5K</div>
        <div style={{ position: "absolute", bottom: -3, right: 5, width: 0, height: 0,
          borderLeft: "4px solid transparent",
          borderRight: "0 solid transparent",
          borderTop: "4px solid #25D366" }} />
      </div>
    ),
  },
  {
    value: "recent-activity",
    label: "Live Chat",
    preview: () => (
      <div className="relative flex flex-col h-full" style={{ background: "rgba(13,22,41,0.93)" }}>
        <div className="px-1 py-0.5 flex items-center gap-0.5"
          style={{ background: "rgba(56,189,248,0.12)", borderBottom: "1px solid rgba(56,189,248,0.2)" }}>
          <span className="text-[4px] font-bold" style={{ color: "#38bdf8" }}>⚡ LIVE CHAT</span>
        </div>
        {["Sarah: Great stream!", "John: 🔥🔥🔥", "Maria: Hello!"].map((m, i) => (
          <div key={i} className="px-1 py-0.5 text-[3.5px] border-b border-slate-800/40"
            style={{ color: "#CCCCCC" }}>{m}</div>
        ))}
      </div>
    ),
  },
];

const MSG_POSITIONS = [
  { value: "top-left", label: "↖ Top L" },
  { value: "top-right", label: "↗ Top R" },
  { value: "center", label: "⊕ Center" },
  { value: "bottom-left", label: "↙ Bot L" },
  { value: "bottom-center", label: "↓ Bot C" },
  { value: "bottom-right", label: "↘ Bot R" },
];

const QR_POSITIONS = [
  { value: "top-left", label: "↖ TL" },
  { value: "top-right", label: "↗ TR" },
  { value: "bottom-left", label: "↙ BL" },
  { value: "bottom-right", label: "↘ BR" },
];

const SUB_POSITIONS = [
  { value: "top-left", label: "↖ TL" },
  { value: "top-right", label: "↗ TR" },
  { value: "center-left", label: "← CL" },
  { value: "center-right", label: "→ CR" },
  { value: "bottom-left", label: "↙ BL" },
  { value: "bottom-right", label: "↘ BR" },
];

const CHAT_POSITIONS = [
  { value: "top-left", label: "↖ TL" },
  { value: "top-right", label: "↗ TR" },
  { value: "bottom-left", label: "↙ BL" },
  { value: "bottom-right", label: "↘ BR" },
];

// ── Main OverlayAdmin panel ─────────────────────────────────────────────────
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
                <Radio className="w-4.5 h-4.5" style={{ color: "#38bdf8" }} />
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
              </div>
              <p className="text-slate-600 text-xs mt-0.5">
                {activeStreams.length === 0 ? "No active streams — start a stream to access the control room"
                  : `${activeStreams.length} active · edit in safe room, tap Apply to go live`}
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
              <div className="flex items-center gap-3 py-8 justify-center text-slate-600">
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
                    <span className="text-xs font-bold text-sky-300">{scanCount} scanned</span>
                    <button onClick={async () => { try { await fetch("/api/qr/reset", { method: "POST", credentials: "include" }); } catch {} }}
                      className="text-slate-700 hover:text-slate-400 transition-colors" title="Reset">
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
              <div className="p-4 flex gap-4 items-start">
                {qrTrackUrl ? (
                  <div className="rounded-xl p-2 shrink-0 relative"
                    style={{ background: "#ffffff", border: "2px solid rgba(56,189,248,0.3)" }}>
                    <QRCodeSVG value={qrTrackUrl} size={80} bgColor="#ffffff" fgColor="#0a0a1a" level="M" />
                    {scanFlash !== null && (
                      <div className="absolute inset-0 rounded-xl flex items-center justify-center"
                        style={{ background: "rgba(56,189,248,0.9)" }}>
                        <div className="text-center">
                          <p className="text-2xl font-black text-white">{scanFlash}</p>
                          <p className="text-[9px] font-bold text-sky-100 uppercase tracking-wider">scanned</p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : <div className="w-20 h-20 rounded-xl bg-slate-800/60 animate-pulse shrink-0" />}
                <p className="text-xs text-slate-400 leading-relaxed pt-1">
                  Show this on stream to invite viewers. When scanned, the counter updates instantly via WebSocket.
                </p>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// ── Per-stream admin overlay ────────────────────────────────────────────────
function AdminStreamOverlay({ stream, index, onUpdate }: {
  stream: StreamConfig; index: number;
  onUpdate: (id: string, data: Partial<StreamConfig>) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [draft, setDraft] = useState<OverlayDraft>(() => buildDraft(stream));
  const [applying, setApplying] = useState(false);
  const [justApplied, setJustApplied] = useState(false);

  const pending = hasDraftChanges(draft, stream);
  const set = <K extends keyof OverlayDraft>(field: K, value: OverlayDraft[K]) =>
    setDraft((p) => ({ ...p, [field]: value }));

  const apply = () => {
    setApplying(true);
    onUpdate(stream.id, draft as any);
    setTimeout(() => { setApplying(false); setJustApplied(true); setTimeout(() => setJustApplied(false), 2500); }, 1800);
  };

  const SourceIcon = SOURCE_ICON[stream.sourceType] || Radio;
  const sourceColor = SOURCE_COLOR[stream.sourceType] || "#38bdf8";
  const sourceLabel = stream.sourceType === "youtube" ? stream.youtubeSourceUrl || "YouTube"
    : stream.sourceType === "camera" ? stream.cameraDevice || "/dev/video0"
    : stream.tiktokUsername ? `@${stream.tiktokUsername}` : "Stream";
  const isStreaming = stream.status === "streaming";

  const needsYtKey = draft.subBoxEnabled || draft.chatEnabled || draft.overlayLiveCount;

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ border: "1px solid rgba(30,41,59,0.9)", background: "rgba(8,12,24,0.7)" }}>

      {/* Header row */}
      <div className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-white/[0.03] transition-colors cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)} role="button" tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setExpanded((v) => !v)}>
        <div className="flex items-center gap-2 shrink-0">
          {isStreaming
            ? <span className="relative flex w-2.5 h-2.5"><span className="absolute w-full h-full rounded-full bg-red-500 animate-signal-ping" /><span className="relative w-2.5 h-2.5 rounded-full bg-red-500" /></span>
            : <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />}
          <SourceIcon className="w-3.5 h-3.5" style={{ color: sourceColor }} />
        </div>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-slate-300 font-bold text-xs tracking-wider">CH {String(index + 1).padStart(2, "0")}</span>
          <span className="text-slate-600 text-xs truncate">{sourceLabel}</span>
          {isStreaming && <EqBars color="#34d399" />}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pending && <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-amber-300"
            style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)" }}>
            <AlertTriangle className="w-2.5 h-2.5" />DRAFT</span>}
          {justApplied && !pending && <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-emerald-300"
            style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)" }}>
            <Check className="w-2.5 h-2.5" />APPLIED</span>}
          <span className="text-slate-700">{expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-800/50 px-3 py-3 space-y-4">

          {/* Safe room header + Overlay toggle */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest" style={{ color: "#34d399" }}>
              <Shield className="w-3 h-3" />SAFE ROOM — edit freely, Apply to go live
            </div>
            <div className="flex items-center gap-1.5">
              <Switch checked={draft.overlayEnabled} onCheckedChange={(v) => set("overlayEnabled", v)} />
              <span className="text-slate-500 text-[10px] font-mono">OVERLAY</span>
            </div>
          </div>

          {draft.overlayEnabled && (<>

            {/* ── LOWER THIRDS ── */}
            <div className="space-y-2.5">
              <SectionHeader icon={Layers} label="Lower Thirds" color="#38bdf8" />
              <div className="grid grid-cols-3 gap-1.5">
                {LT_STYLE_CARDS.map((card) => (
                  <button key={card.value} onClick={() => set("lowerThirdStyle", card.value as any)}
                    className="relative rounded-lg overflow-hidden transition-all"
                    style={{ aspectRatio: "16/6",
                      border: `1.5px solid ${draft.lowerThirdStyle === card.value ? "rgba(56,189,248,0.9)" : "rgba(30,41,59,0.8)"}`,
                      background: "#070c18",
                      boxShadow: draft.lowerThirdStyle === card.value ? "0 0 8px rgba(56,189,248,0.25)" : "none" }}>
                    {card.preview(draft.lowerThirdAccentColor || "#e53935")}
                    <div className="absolute bottom-0 left-0 right-0 text-[5px] font-bold text-center py-0.5"
                      style={{ background: draft.lowerThirdStyle === card.value ? "rgba(56,189,248,0.2)" : "rgba(0,0,0,0.5)",
                        color: draft.lowerThirdStyle === card.value ? "#38bdf8" : "#64748b" }}>
                      {card.label.toUpperCase()}
                    </div>
                  </button>
                ))}
              </div>

              {draft.lowerThirdStyle !== "none" ? (
                <div className="space-y-2 rounded-lg p-2.5" style={{ background: "rgba(8,12,24,0.6)", border: "1px solid rgba(30,41,59,0.7)" }}>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-600 uppercase tracking-widest">{draft.lowerThirdStyle === "breaking-news" ? "Headline" : "Name"}</Label>
                      <Input className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                        placeholder={draft.lowerThirdStyle === "breaking-news" ? "Breaking headline..." : "Person's full name"}
                        value={draft.lowerThirdName} onChange={(e) => set("lowerThirdName", e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-600 uppercase tracking-widest">{draft.lowerThirdStyle === "breaking-news" ? "Sub-headline" : "Title"}</Label>
                      <Input className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                        placeholder={draft.lowerThirdStyle === "breaking-news" ? "Location..." : "Reporter · Live"}
                        value={draft.lowerThirdTitle} onChange={(e) => set("lowerThirdTitle", e.target.value)} />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Accent Color</Label>
                      <div className="flex items-center gap-1.5">
                        <input type="color" value={draft.lowerThirdAccentColor || "#e53935"}
                          onChange={(e) => set("lowerThirdAccentColor", e.target.value)}
                          className="w-7 h-7 rounded cursor-pointer border border-slate-700" />
                        <span className="text-[9px] font-mono text-slate-500">{draft.lowerThirdAccentColor}</span>
                      </div>
                    </div>
                    <div className="flex-1 space-y-1">
                      <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Animation</Label>
                      <Select value={draft.lowerThirdAnimation} onValueChange={(v) => set("lowerThirdAnimation", v as any)}>
                        <SelectTrigger className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="slide-wipe">Slide & Wipe ◀</SelectItem>
                          <SelectItem value="scale-up">Scale Up ↑</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Channel Name</Label>
                      <Input className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                        placeholder="BintuNet LIVE" value={draft.overlayChannelName} onChange={(e) => set("overlayChannelName", e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Headline</Label>
                      <Input className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                        placeholder="Tag line" value={draft.overlayHeadline} onChange={(e) => set("overlayHeadline", e.target.value)}
                        disabled={draft.overlayLiveCount} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="color" value={draft.overlayBannerColor || "#c41e1e"}
                      onChange={(e) => set("overlayBannerColor", e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer border border-slate-700" title="Banner colour" />
                    <span className="text-[10px] text-slate-500 font-mono">BANNER COLOR</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── NEWS TICKER ── */}
            <div className="space-y-2.5">
              <SectionHeader icon={AlignLeft} label="News Ticker" color="#a78bfa" />
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] text-slate-500 font-mono">STYLE</span>
                {(["crawl", "flipper"] as const).map((s) => (
                  <button key={s} onClick={() => set("tickerStyle", s)}
                    className="px-2.5 py-1 rounded text-[10px] font-bold transition-all"
                    style={{ border: `1px solid ${draft.tickerStyle === s ? "rgba(167,139,250,0.8)" : "rgba(51,65,85,0.6)"}`,
                      background: draft.tickerStyle === s ? "rgba(167,139,250,0.15)" : "rgba(8,12,24,0.5)",
                      color: draft.tickerStyle === s ? "#a78bfa" : "#64748b" }}>
                    {s === "crawl" ? "⟶ Crawl" : "⇅ Flipper"}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                <Input className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                  placeholder="Scrolling ticker headlines…" value={draft.overlayTickerText}
                  onChange={(e) => set("overlayTickerText", e.target.value)} />
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <input type="color" value={draft.overlayTickerColor || "#1a1a2e"}
                      onChange={(e) => set("overlayTickerColor", e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer border border-slate-700" />
                    <span className="text-[10px] text-slate-500 font-mono">BG</span>
                  </div>
                  <div className="flex-1 space-y-0.5">
                    <span className="text-[10px] text-slate-600">Speed: {draft.overlayTickerSpeed}</span>
                    <Slider value={[draft.overlayTickerSpeed]} min={30} max={200} step={5}
                      onValueChange={([v]) => set("overlayTickerSpeed", v)} />
                  </div>
                </div>
              </div>
            </div>

            {/* ── MESSAGE BOX ── */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <SectionHeader icon={MessageSquare} label="Message Box" color="#f59e0b" />
                <Switch checked={draft.messageEnabled} onCheckedChange={(v) => set("messageEnabled", v)} />
              </div>
              {draft.messageEnabled && (
                <div className="space-y-2.5 rounded-lg p-2.5" style={{ background: "rgba(8,12,24,0.6)", border: "1px solid rgba(30,41,59,0.7)" }}>
                  <div className="grid grid-cols-3 gap-1.5">
                    {MSG_STYLES.map((style) => (
                      <button key={style.value} onClick={() => set("messageStyle", style.value as any)}
                        className="relative rounded overflow-hidden transition-all"
                        style={{ border: `1.5px solid ${draft.messageStyle === style.value ? "rgba(245,158,11,0.9)" : "rgba(30,41,59,0.7)"}`, aspectRatio: "3/1" }}>
                        <div className="absolute inset-0 flex items-center" style={{ background: style.bg }}>
                          {style.strip === "left" && <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: draft.overlayBannerColor || "#c41e1e" }} />}
                          {style.strip === "top" && <div className="absolute top-0 left-0 right-0 h-px bg-yellow-500" />}
                          {style.strip === "lines" && <><div className="absolute top-0.5 left-0 right-0 h-px bg-white/50" /><div className="absolute bottom-0.5 left-0 right-0 h-px bg-white/50" /></>}
                          <span className="text-[5px] font-bold px-1 truncate" style={{ color: style.text }}>{style.label}</span>
                        </div>
                        {draft.messageStyle === style.value && <div className="absolute top-0.5 right-0.5"><Check className="w-2 h-2 text-amber-400" /></div>}
                      </button>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Message Text</Label>
                    <textarea rows={2} className="w-full resize-none rounded-md px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-700 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                      style={{ background: "rgba(15,23,42,0.9)", border: "1px solid rgba(51,65,85,0.6)" }}
                      placeholder="Type your message here…"
                      value={draft.messageText} onChange={(e) => set("messageText", e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Position</Label>
                    <PositionPicker value={draft.messagePosition} onChange={(v) => set("messagePosition", v as any)} options={MSG_POSITIONS} cols={3} />
                  </div>
                </div>
              )}
            </div>

            {/* ── SUBSCRIPTION BOX ── */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <SectionHeader icon={TrendingUp} label="Subscriber Counter" color="#34d399" />
                <Switch checked={draft.subBoxEnabled} onCheckedChange={(v) => set("subBoxEnabled", v)} />
              </div>
              {draft.subBoxEnabled && (
                <div className="space-y-2.5 rounded-lg p-2.5" style={{ background: "rgba(8,12,24,0.6)", border: "1px solid rgba(30,41,59,0.7)" }}>

                  {/* 6 style cards */}
                  <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Display Style</Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {SUB_STYLES.map((style) => (
                      <button key={style.value} onClick={() => set("subBoxStyle", style.value as any)}
                        className="relative rounded overflow-hidden transition-all"
                        style={{ height: "52px", border: `1.5px solid ${draft.subBoxStyle === style.value ? "rgba(52,211,153,0.9)" : "rgba(30,41,59,0.7)"}` }}>
                        {style.preview()}
                        <div className="absolute bottom-0 left-0 right-0 text-[4.5px] font-bold text-center py-0.5"
                          style={{ background: "rgba(0,0,0,0.7)", color: draft.subBoxStyle === style.value ? "#34d399" : "#64748b" }}>
                          {style.label.toUpperCase()}
                        </div>
                        {draft.subBoxStyle === style.value && <div className="absolute top-0.5 right-0.5"><Check className="w-2.5 h-2.5 text-emerald-400" /></div>}
                      </button>
                    ))}
                  </div>

                  {/* Flip counter live demo */}
                  {draft.subBoxStyle === "flip-counter" && (
                    <div className="rounded-lg p-3 flex flex-col items-center gap-2"
                      style={{ background: "#111111", border: "1px solid #2a2a2a" }}>
                      <p className="text-[9px] text-slate-600 font-mono tracking-widest">LIVE PREVIEW</p>
                      <FlipCounter value="12.5K" />
                      <p className="text-[8px]" style={{ color: "#505050" }}>SUBSCRIBERS</p>
                      <p className="text-[8px] text-slate-700 text-center">Digits animate when subscriber count updates from YouTube API</p>
                    </div>
                  )}

                  {/* WhatsApp preview */}
                  {draft.subBoxStyle === "whatsapp" && (
                    <div className="rounded-lg p-3 flex items-start gap-3"
                      style={{ background: "rgba(8,12,24,0.8)", border: "1px solid rgba(37,211,102,0.2)" }}>
                      <div className="relative rounded-xl px-3 py-2 shrink-0"
                        style={{ background: "#25D366", boxShadow: "0 2px 8px rgba(37,211,102,0.3)" }}>
                        <p className="text-[9px] font-bold" style={{ color: "#DCF8C6" }}>SUBSCRIBERS</p>
                        <p className="text-lg font-black text-white leading-none">12.5K</p>
                        <div style={{ position: "absolute", bottom: -6, right: 10, width: 0, height: 0,
                          borderLeft: "6px solid transparent", borderRight: "0 solid transparent",
                          borderTop: "6px solid #25D366" }} />
                      </div>
                      <p className="text-[9px] text-slate-500 pt-1">Green bubble with sub count. Updates every 30s via YouTube API.</p>
                    </div>
                  )}

                  {/* Recent activity preview */}
                  {draft.subBoxStyle === "recent-activity" && (
                    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid rgba(56,189,248,0.2)" }}>
                      <div className="px-2 py-1 flex items-center gap-1.5"
                        style={{ background: "rgba(56,189,248,0.1)", borderBottom: "1px solid rgba(56,189,248,0.15)" }}>
                        <MessageCircle className="w-3 h-3 text-sky-400" />
                        <span className="text-[9px] font-bold text-sky-400 tracking-wider">⚡ LIVE CHAT MESSAGES</span>
                      </div>
                      {["Sarah K: Great stream! 🔥", "John D: Hello from Dubai!", "Maria L: Amazing content"].map((m, i) => (
                        <div key={i} className="px-2 py-1 text-[9px] text-slate-400 border-b border-slate-800/40"
                          style={{ background: "rgba(13,22,41,0.8)" }}>{m}</div>
                      ))}
                      <p className="text-[8px] text-slate-700 px-2 py-1">Pulls from YouTube Live Chat API (requires GOOGLE_API_KEY)</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Position</Label>
                      <PositionPicker value={draft.subBoxPosition} onChange={(v) => set("subBoxPosition", v as any)} options={SUB_POSITIONS} cols={2} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Options</Label>
                      <div className="space-y-1.5">
                        {draft.subBoxStyle !== "recent-activity" && (
                          <label className="flex items-center gap-2 cursor-pointer">
                            <Switch checked={draft.subBoxShowViewers} onCheckedChange={(v) => set("subBoxShowViewers", v)} />
                            <span className="text-[10px] text-slate-500">Show viewers</span>
                          </label>
                        )}
                        {draft.subBoxStyle === "recent-activity" && (
                          <div className="space-y-1">
                            <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Max Messages</Label>
                            <Select value={String(draft.chatMaxMessages)} onValueChange={(v) => set("chatMaxMessages", parseInt(v))}>
                              <SelectTrigger className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {[3,4,5,6,7,8].map(n => <SelectItem key={n} value={String(n)}>{n} messages</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {(draft.subBoxStyle !== "recent-activity") && !draft.youtubeChannelId && (
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-600 uppercase tracking-widest">YouTube Channel ID</Label>
                      <Input className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700 font-mono"
                        placeholder="UCxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        value={draft.youtubeChannelId} onChange={(e) => set("youtubeChannelId", e.target.value)} />
                      <p className="text-[9px] text-slate-700">Requires GOOGLE_API_KEY secret. Go to Settings → Secrets to add it.</p>
                    </div>
                  )}
                  {draft.youtubeChannelId && (
                    <p className="text-[9px] text-slate-600">Using channel: <span className="font-mono text-slate-500">{draft.youtubeChannelId.slice(0, 14)}…</span></p>
                  )}
                </div>
              )}
            </div>

            {/* ── LIVE CHAT OVERLAY ── */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <SectionHeader icon={MessageCircle} label="Live Chat Overlay" color="#22d3ee" />
                <Switch checked={draft.chatEnabled} onCheckedChange={(v) => set("chatEnabled", v)} />
              </div>
              {draft.chatEnabled && (
                <div className="space-y-2.5 rounded-lg p-2.5" style={{ background: "rgba(8,12,24,0.6)", border: "1px solid rgba(34,211,238,0.2)" }}>
                  <p className="text-[9px] text-slate-500 leading-relaxed">
                    Shows a floating box of live YouTube chat messages on screen. Updates every 8 seconds using YouTube Live Chat API.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Style</Label>
                      <div className="flex gap-1">
                        {(["list", "bubble"] as const).map((s) => (
                          <button key={s} onClick={() => set("chatStyle", s)}
                            className="flex-1 py-1.5 rounded text-[10px] font-bold transition-all"
                            style={{ border: `1px solid ${draft.chatStyle === s ? "rgba(34,211,238,0.8)" : "rgba(51,65,85,0.6)"}`,
                              background: draft.chatStyle === s ? "rgba(34,211,238,0.12)" : "rgba(8,12,24,0.5)",
                              color: draft.chatStyle === s ? "#22d3ee" : "#64748b" }}>
                            {s === "list" ? "📋 List" : "💬 Bubble"}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Messages</Label>
                      <Select value={String(draft.chatMaxMessages)} onValueChange={(v) => set("chatMaxMessages", parseInt(v))}>
                        <SelectTrigger className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[3,4,5,6,7,8,9,10].map(n => <SelectItem key={n} value={String(n)}>{n} messages</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Position</Label>
                    <PositionPicker value={draft.chatPosition} onChange={(v) => set("chatPosition", v as any)} options={CHAT_POSITIONS} cols={4} />
                  </div>
                  {!draft.youtubeChannelId && (
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-600 uppercase tracking-widest">YouTube Channel ID</Label>
                      <Input className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700 font-mono"
                        placeholder="UCxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        value={draft.youtubeChannelId} onChange={(e) => set("youtubeChannelId", e.target.value)} />
                    </div>
                  )}
                  {/* Chat style preview */}
                  <div className="rounded-lg overflow-hidden text-[9px]"
                    style={{ border: `1px solid ${draft.chatStyle === "bubble" ? "rgba(37,211,102,0.25)" : "rgba(56,189,248,0.2)"}` }}>
                    <div className="px-2 py-1 flex items-center gap-1"
                      style={{ background: draft.chatStyle === "bubble" ? "rgba(37,211,102,0.1)" : "rgba(56,189,248,0.08)",
                        borderBottom: `1px solid ${draft.chatStyle === "bubble" ? "rgba(37,211,102,0.2)" : "rgba(56,189,248,0.15)"}` }}>
                      <span style={{ color: draft.chatStyle === "bubble" ? "#25D366" : "#38bdf8" }}>
                        {draft.chatStyle === "bubble" ? "💬" : "⚡"} LIVE CHAT
                      </span>
                    </div>
                    {["Sarah: Great stream! 🔥", "John: Hello!", "Maria: Amazing"].slice(0, Math.min(draft.chatMaxMessages, 3)).map((m, i) => (
                      <div key={i} className="px-2 py-0.5 border-b border-slate-800/30 text-slate-400"
                        style={{ background: draft.chatStyle === "bubble" ? "rgba(10,32,24,0.9)" : "rgba(13,22,41,0.85)" }}>
                        {m}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* ── QR CODE ── */}
            <div className="rounded-lg p-3 space-y-2"
              style={{ background: "rgba(249,115,22,0.07)", border: "1px solid rgba(249,115,22,0.2)" }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <QrCode className="w-3.5 h-3.5 text-orange-400" />
                  <span className="text-[11px] font-semibold text-slate-300">QR Code on Stream</span>
                </div>
                <Switch checked={draft.overlayQrEnabled} onCheckedChange={(v) => set("overlayQrEnabled", v)} />
              </div>
              {draft.overlayQrEnabled && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-600 uppercase tracking-widest">URL</Label>
                      <Input className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                        placeholder="https://..." value={draft.overlayQrUrl} onChange={(e) => set("overlayQrUrl", e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Label</Label>
                      <Input className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                        placeholder="BUY ME COFFEE" value={draft.overlayQrLabel} onChange={(e) => set("overlayQrLabel", e.target.value)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Position</Label>
                      <PositionPicker value={draft.overlayQrPosition} onChange={(v) => set("overlayQrPosition", v as any)} options={QR_POSITIONS} cols={2} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Size</Label>
                      <div className="flex gap-1">
                        {(["small", "medium", "large"] as const).map((sz) => (
                          <button key={sz} onClick={() => set("overlayQrSize", sz)}
                            className="flex-1 py-1 rounded text-[9px] font-bold transition-all"
                            style={{ border: `1px solid ${draft.overlayQrSize === sz ? "rgba(249,115,22,0.8)" : "rgba(51,65,85,0.6)"}`,
                              background: draft.overlayQrSize === sz ? "rgba(249,115,22,0.15)" : "rgba(8,12,24,0.5)",
                              color: draft.overlayQrSize === sz ? "#f97316" : "#64748b" }}>
                            {sz === "small" ? "S" : sz === "medium" ? "M" : "L"}
                          </button>
                        ))}
                      </div>
                      <p className="text-[8px] text-slate-700">S=10% · M=14% · L=18% width</p>
                    </div>
                  </div>
                  {draft.overlayQrUrl && (
                    <div className="flex items-center gap-3 pt-1">
                      <div className="bg-white rounded-lg p-1.5 shrink-0">
                        <QRCodeSVG value={draft.overlayQrUrl} size={56} level="L" />
                      </div>
                      <div>
                        <div className="px-2 py-1 rounded text-xs font-black text-white tracking-wider"
                          style={{ background: "#F97316" }}>{draft.overlayQrLabel || "BUY ME COFFEE"}</div>
                        <p className="text-[9px] text-slate-600 mt-1">{draft.overlayQrPosition.replace("-", " ").toUpperCase()} · {draft.overlayQrSize.toUpperCase()}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── YOUTUBE LIVE COUNT ── */}
            {draft.lowerThirdStyle === "none" && (
              <div className="rounded-lg p-3 space-y-2" style={{ background: "rgba(255,0,0,0.06)", border: "1px solid rgba(255,0,0,0.15)" }}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Youtube className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-[11px] font-semibold text-slate-300">Live Sub Count in Headline</span>
                  </div>
                  <Switch checked={draft.overlayLiveCount} onCheckedChange={(v) => set("overlayLiveCount", v)} />
                </div>
                {draft.overlayLiveCount && (
                  <Input className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700 font-mono"
                    placeholder="UCxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    value={draft.youtubeChannelId} onChange={(e) => set("youtubeChannelId", e.target.value)} />
                )}
              </div>
            )}

            {/* YouTube Channel ID shared notice */}
            {needsYtKey && draft.youtubeChannelId && (
              <div className="rounded-lg px-3 py-2 flex items-center gap-2"
                style={{ background: "rgba(52,211,153,0.07)", border: "1px solid rgba(52,211,153,0.2)" }}>
                <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                <p className="text-[9px] text-emerald-600">
                  Channel ID set · GOOGLE_API_KEY needed in Secrets for live data. Add via <span className="font-mono">Settings → Secrets → GOOGLE_API_KEY</span>.
                </p>
              </div>
            )}

            {/* Logo settings */}
            {stream.overlayLogoPath && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Logo Position</Label>
                  <Select value={draft.overlayLogoPosition} onValueChange={(v) => set("overlayLogoPosition", v as any)}>
                    <SelectTrigger className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="top-left">Top Left</SelectItem>
                      <SelectItem value="top-right">Top Right</SelectItem>
                      <SelectItem value="bottom-left">Bottom Left</SelectItem>
                      <SelectItem value="bottom-right">Bottom Right</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Animation</Label>
                  <Select value={draft.overlayLogoAnimation} onValueChange={(v) => set("overlayLogoAnimation", v as any)}>
                    <SelectTrigger className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="pulse">Pulse</SelectItem>
                      <SelectItem value="breathe">Breathe</SelectItem>
                      <SelectItem value="fade-in">Fade In</SelectItem>
                      <SelectItem value="flash">Flash</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 col-span-2 sm:col-span-1">
                  <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Size {Math.round((draft.overlayLogoScale || 0.15) * 100)}%</Label>
                  <Slider value={[draft.overlayLogoScale || 0.15]} min={0.05} max={0.35} step={0.01}
                    onValueChange={([v]) => set("overlayLogoScale", v)} />
                </div>
              </div>
            )}

            {/* Social handle */}
            <div className="rounded-lg p-3 space-y-2" style={{ background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.15)" }}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Share2 className="w-3.5 h-3.5 text-sky-400" />
                  <span className="text-[11px] font-semibold text-slate-300">Social Handle Bar</span>
                </div>
                <Switch checked={draft.overlaySocialEnabled} onCheckedChange={(v) => set("overlaySocialEnabled", v)} />
              </div>
              {draft.overlaySocialEnabled && (
                <Input className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                  placeholder="@yourhandle" value={draft.overlaySocialHandle} onChange={(e) => set("overlaySocialHandle", e.target.value)} />
              )}
            </div>

            {/* Mini preview */}
            <LivePreviewMini draft={draft} stream={stream} />
          </>)}

          {/* Apply / Discard */}
          <div className="flex items-center gap-2 pt-1">
            <Button className="flex-1 gap-2 font-bold text-sm h-9" disabled={!pending || applying} onClick={apply}
              style={pending ? { background: "linear-gradient(135deg, #16a34a, #15803d)", border: "none" } : {}}>
              {applying ? <><Sparkles className="w-4 h-4 animate-spin" />Applying…</>
                : justApplied ? <><Check className="w-4 h-4" />Applied!</>
                : <><Sparkles className="w-4 h-4" />{pending ? "Apply to Live" : "Up to Date"}</>}
            </Button>
            {pending && (
              <Button variant="ghost" size="sm" onClick={() => setDraft(buildDraft(stream))}
                className="text-slate-500 hover:text-slate-300 h-9">Discard</Button>
            )}
          </div>
          {pending && (
            <p className="text-[10px] text-amber-600 text-center -mt-1">
              Staged in safe room — stream reconnects briefly when applied (~3s gap)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Mini live preview ───────────────────────────────────────────────────────
function LivePreviewMini({ draft, stream }: { draft: OverlayDraft; stream: StreamConfig }) {
  const isVertical = stream.ratio === "mobile";
  const msgStyle = MSG_STYLES.find((s) => s.value === draft.messageStyle) || MSG_STYLES[0];

  const msgPosStyle = (pos: string): React.CSSProperties => {
    const base: React.CSSProperties = { position: "absolute" };
    if (pos === "top-left") return { ...base, top: 2, left: 2 };
    if (pos === "top-right") return { ...base, top: 2, right: 2 };
    if (pos === "center") return { ...base, top: "50%", left: "50%", transform: "translate(-50%,-50%)" };
    if (pos === "bottom-left") return { ...base, bottom: 10, left: 2 };
    if (pos === "bottom-right") return { ...base, bottom: 10, right: 2 };
    return { ...base, bottom: 10, left: "50%", transform: "translateX(-50%)" };
  };

  const subPosStyle = (pos: string): React.CSSProperties => {
    const base: React.CSSProperties = { position: "absolute" };
    if (pos === "top-left") return { ...base, top: 2, left: 2 };
    if (pos === "top-right") return { ...base, top: 2, right: 2 };
    if (pos === "center-left") return { ...base, top: "42%", left: 2 };
    if (pos === "center-right") return { ...base, top: "42%", right: 2 };
    if (pos === "bottom-left") return { ...base, bottom: 2, left: 2 };
    return { ...base, bottom: 2, right: 2 };
  };

  const qrPosStyle = (pos: string): React.CSSProperties => {
    const base: React.CSSProperties = { position: "absolute" };
    if (pos === "top-left") return { ...base, top: 2, left: 2 };
    if (pos === "bottom-left") return { ...base, bottom: 2, left: 2 };
    if (pos === "bottom-right") return { ...base, bottom: 2, right: 2 };
    return { ...base, top: 2, right: 2 };
  };

  const chatPosStyle = (pos: string): React.CSSProperties => {
    const base: React.CSSProperties = { position: "absolute" };
    if (pos === "top-left") return { ...base, top: 2, left: 2 };
    if (pos === "top-right") return { ...base, top: 2, right: 2 };
    if (pos === "bottom-left") return { ...base, bottom: 10, left: 2 };
    return { ...base, bottom: 10, right: 2 };
  };

  return (
    <div className="relative rounded-lg overflow-hidden"
      style={{ aspectRatio: isVertical ? "9/16" : "16/9", maxHeight: "140px",
        background: "linear-gradient(160deg, #0d1629, #080e1c)",
        border: "1px solid rgba(30,41,59,0.8)" }}>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-slate-800 text-[7px] font-mono tracking-[0.3em]">DRAFT PREVIEW</span>
      </div>

      {/* QR */}
      {draft.overlayQrEnabled && draft.overlayQrUrl && (
        <div style={qrPosStyle(draft.overlayQrPosition)} className="flex flex-col items-center gap-0.5">
          <div className="bg-white rounded p-0.5"><QRCodeSVG value={draft.overlayQrUrl} size={18} level="L" /></div>
          <div className="text-white text-[4px] font-black px-0.5 py-0.5 rounded text-center"
            style={{ background: "#F97316", maxWidth: "36px" }}>
            {(draft.overlayQrLabel || "QR").slice(0, 10)}
          </div>
        </div>
      )}

      {/* Message Box */}
      {draft.messageEnabled && draft.messageText && (
        <div style={{ ...msgPosStyle(draft.messagePosition), background: msgStyle.bg,
          padding: "2px 5px", borderRadius: "2px", maxWidth: "52%" }}>
          {msgStyle.strip === "left" && <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: draft.overlayBannerColor || "#c41e1e" }} />}
          {msgStyle.strip === "top" && <div className="absolute top-0 left-0 right-0 h-px bg-yellow-500" />}
          <span className="text-[5px] font-bold leading-tight block" style={{ color: msgStyle.text }}>
            {draft.messageText.slice(0, 36)}
          </span>
        </div>
      )}

      {/* Sub Box */}
      {draft.subBoxEnabled && (
        <div style={subPosStyle(draft.subBoxPosition)}>
          {draft.subBoxStyle === "flip-counter" ? (
            <div style={{ background: "#1c1c1c", padding: "2px 4px", borderRadius: "2px" }}>
              <div className="text-[3.5px] font-bold mb-0.5" style={{ color: "#505050" }}>SUBS</div>
              <div className="flex gap-0.5">
                {"12.5K".split("").map((ch, i) => (
                  <div key={i} style={{ width: "7px", height: "11px", background: "#141414",
                    border: "1px solid #2a2a2a", borderRadius: "1px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ color: "#FFE000", fontSize: "6px", fontWeight: 900 }}>{ch}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : draft.subBoxStyle === "whatsapp" ? (
            <div style={{ background: "#25D366", padding: "2px 5px", borderRadius: "4px", position: "relative" }}>
              <div className="text-[3.5px] font-bold" style={{ color: "#DCF8C6" }}>SUBS</div>
              <div className="text-[7px] text-white font-bold">—</div>
              <div style={{ position: "absolute", bottom: -3, right: 4, width: 0, height: 0,
                borderLeft: "3px solid transparent", borderTop: "3px solid #25D366" }} />
            </div>
          ) : draft.subBoxStyle === "recent-activity" ? (
            <div style={{ background: "rgba(13,22,41,0.93)", width: "55px", borderRadius: "2px",
              border: "1px solid rgba(56,189,248,0.2)", overflow: "hidden" }}>
              <div className="text-[3.5px] px-1 py-0.5 font-bold" style={{ color: "#38bdf8", background: "rgba(56,189,248,0.1)" }}>⚡ LIVE CHAT</div>
              {["Sarah: Great!", "John: 🔥", "Maria: Hi"].map((m, i) => (
                <div key={i} className="text-[3px] px-1 py-px border-b border-slate-800/30" style={{ color: "#CCC" }}>{m}</div>
              ))}
            </div>
          ) : (
            <div style={{ background: draft.subBoxStyle === "minimal" ? "rgba(0,0,0,0.62)"
              : "rgba(13,22,41,0.92)", padding: "2px 4px", borderRadius: "2px" }}>
              {draft.subBoxStyle === "card" && <div className="absolute top-0 left-0 right-0 h-px bg-red-500" />}
              <div className="text-[3.5px] font-bold mb-0.5" style={{ color: "#8899AA" }}>SUBS</div>
              <div className="text-[7px] text-white font-bold">—</div>
            </div>
          )}
        </div>
      )}

      {/* Chat overlay */}
      {draft.chatEnabled && !draft.subBoxEnabled && (
        <div style={{ ...chatPosStyle(draft.chatPosition), background: "rgba(13,22,41,0.90)",
          width: "60px", borderRadius: "2px", border: "1px solid rgba(56,189,248,0.2)", overflow: "hidden" }}>
          <div className="text-[3.5px] px-1 py-0.5 font-bold" style={{ color: "#38bdf8" }}>⚡ LIVE CHAT</div>
          <div className="text-[3px] px-1 py-px" style={{ color: "#CCC" }}>Sarah: Great stream!</div>
          <div className="text-[3px] px-1 py-px" style={{ color: "#CCC" }}>John: Hello!</div>
        </div>
      )}

      {/* Lower Third */}
      {draft.lowerThirdStyle === "l-cut" && (draft.lowerThirdName || draft.lowerThirdTitle) && (
        <div className="absolute left-0 flex flex-col justify-center pl-1.5"
          style={{ bottom: draft.overlayTickerText ? "9px" : "2px", width: "65%", height: "22px", background: "rgba(12,21,36,0.95)" }}>
          <div className="absolute left-0 top-0 bottom-0 w-0.5" style={{ background: draft.lowerThirdAccentColor || "#e53935" }} />
          {draft.lowerThirdName && <div className="text-[5px] text-white font-bold leading-tight truncate">{draft.lowerThirdName}</div>}
          {draft.lowerThirdTitle && <div className="text-[3.5px] leading-tight truncate" style={{ color: "#BBBBCC" }}>{draft.lowerThirdTitle}</div>}
        </div>
      )}
      {draft.lowerThirdStyle === "breaking-news" && (draft.lowerThirdName || draft.lowerThirdTitle) && (
        <div className="absolute left-0 right-0 flex"
          style={{ bottom: draft.overlayTickerText ? "9px" : "2px", height: "20px", background: "rgba(8,8,8,0.96)" }}>
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
      {draft.lowerThirdStyle === "none" && draft.overlayChannelName && (
        <div className="absolute flex items-stretch text-[7px] leading-tight"
          style={{ bottom: draft.overlayTickerText ? "9px" : "2px", left: 0 }}>
          <div className="px-1.5 py-0.5 text-white font-bold flex items-center"
            style={{ backgroundColor: draft.overlayBannerColor || "#c41e1e" }}>
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
    </div>
  );
}
