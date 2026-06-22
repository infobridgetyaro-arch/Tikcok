import { useState, useEffect, useCallback, useRef } from "react";
import React from "react";
import {
  Newspaper, Megaphone, Coffee, MessageSquare, BarChart2, Users,
  ChevronDown, ChevronUp, Radio, ExternalLink, Play, Square, Image,
  Monitor, Smartphone, X, Bell, Mic, MicOff, Volume2, Loader2,
  MonitorUp, MoveUpRight, Maximize2,
  Music, SkipForward, SkipBack, Pause, ListMusic, Trash2, Plus, Upload, RefreshCw,
  Radio as RadioIcon, LayoutGrid, Heart,
} from "lucide-react";
import { StatsPanel } from "./stats-panel";
import { MultiViewPanel } from "./multi-view-panel";
import { AIPanel } from "./ai-panel";
import { DonationPanel, type DonationRecord } from "./donation-panel";
import { GiftPopup, type GiftEvent } from "./gift-popup";
import { useWebSocket } from "@/hooks/use-websocket";

interface ChatMessage {
  id: string;
  authorName: string;
  authorPhoto: string;
  text: string;
  publishedAt: string;
  isMember: boolean;
  isModerator: boolean;
  isOwner: boolean;
}

interface StreamStats {
  subs: string | null;
  viewers: string | null;
  hasChat: boolean;
}

interface Stream {
  id: string;
  status: string;
  tiktokUsername: string;
  youtubeChannelId: string;
  youtubeSourceUrl: string;
  cameraDevice: string;
  sourceType: string;
}

interface OverlayPosition {
  x: number;
  y: number;
}

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
  liveAudioMuted: boolean;
  chatStyle: string;
  statsActive: boolean;
  statsPosition: OverlayPosition;
  subsOverlayActive: boolean;
  subsStyle: string;
  subsPosition: OverlayPosition;
  subsGoal: number;
  subChartActive: boolean;
  subChartData: number[];
  subChartPosition: OverlayPosition;
  mobileSubChartPosition: OverlayPosition;
  subAlertActive: boolean;
  subAlertMessage: string;
  chatBurnActive: boolean;
  chatBurnStyle: string;
  chatBurnPosition: OverlayPosition;
  superChatMessages: Array<{ user: string; amount: string; text: string; color: string; ts: number }>;
  guestNameActive: boolean;
  guestName: string;
  guestTitle: string;
  guestStyle: string;
  guestPosition: OverlayPosition;
  mobileGuestPosition: OverlayPosition;
  bgGradientActive: boolean;
  bgGradient1: string;
  bgGradient2: string;
  bgGradientOpacity: number;
  mobileStatsPosition: OverlayPosition;
  mobileSubsPosition: OverlayPosition;
  mobileChatBurnPosition: OverlayPosition;
  mobileNewsPosition: OverlayPosition;
  mobileAdPosition: OverlayPosition;
  statsScale: number;
  subsScale: number;
  chatBurnScale: number;
  newsScale: number;
  adScale: number;
  guestScale: number;
  subChartScale: number;
  globalStreamVolume: number;
  breakVideoPanX: number;
  breakVideoPanY: number;
  qrActive: boolean;
  qrUrl: string;
  qrTitle: string;
  qrSize: number;
  qrPosition: OverlayPosition;
  qrScanCount: number;
  qrThankYouName: string;
  qrThankYouTs: number;
  qrGlowIntensity: number;
  qrBorderStyle: string;
  qrAnimation: string;
  screenShareActive: boolean;
  screenShareMode: "pip" | "presenter" | "fullscreen";
  screenShareX: number;
  screenShareY: number;
  screenShareW: number;
  screenShareRadius: number;
  // Donation gateway
  donationTickerActive: boolean;
  donationAlertActive: boolean;
  donationTicker: Array<{ name: string; amount: string; amountKes: number; color: string; ts: number }>;
}

interface ControlRoomProps {
  streams: Stream[];
  streamStats: Record<string, StreamStats>;
  streamChat: Record<string, ChatMessage[]>;
  streamProcStats?: Record<string, { cpu: number; mem: number; frames?: number; uptime?: number }>;
}

type Tab = "ai" | "news" | "ads" | "break" | "chat" | "stats" | "subs" | "bg" | "alerts" | "mic" | "qr" | "donate" | "screen" | "music" | "stage";
type EditMode = "desktop" | "mobile";

const TABS: { id: Tab; label: string; icon: React.ReactNode; accent: string }[] = [
  { id: "ai",     label: "AI",        icon: <span style={{ fontSize: 12 }}>✦</span>,  accent: "#a78bfa" },
  { id: "stats",  label: "Stats",     icon: <BarChart2 size={13} />,     accent: "#a78bfa" },
  { id: "subs",   label: "Subs",      icon: <Users size={13} />,         accent: "#818cf8" },
  { id: "chat",   label: "Chat",      icon: <MessageSquare size={13} />, accent: "#34d399" },
  { id: "news",   label: "News",      icon: <Newspaper size={13} />,     accent: "#667eea" },
  { id: "alerts", label: "Alerts",    icon: <Bell size={13} />,          accent: "#f97316" },
  { id: "ads",    label: "Ads",       icon: <Megaphone size={13} />,     accent: "#f093fb" },
  { id: "break",  label: "Break",     icon: <Coffee size={13} />,        accent: "#f59e0b" },
  { id: "bg",     label: "BG",        icon: <Image size={13} />,         accent: "#fb7185" },
  { id: "mic",    label: "Mic",       icon: <Mic size={13} />,           accent: "#10b981" },
  { id: "qr",     label: "QR",       icon: <span style={{ fontSize: 11 }}>▣</span>, accent: "#06b6d4" },
  { id: "donate", label: "SuperChat", icon: <Heart size={13} />,                      accent: "#22c55e" },
  { id: "screen", label: "Screen",  icon: <MonitorUp size={13} />,                   accent: "#818cf8" },
  { id: "music",  label: "Music",    icon: <Music size={13} />,                       accent: "#f472b6" },
  { id: "stage",  label: "Stage",    icon: <LayoutGrid size={13} />,                  accent: "#a78bfa" },
];

const NEWS_STYLES       = ["Ticker", "Breaking", "Lower Third", "Spotlight", "Crawl", "Pop-up", "Scroll Banner"] as const;
const NEWS_ANIMATIONS   = ["None", "Fade", "→", "←", "↓", "↙", "↗", "Typewriter", "Pop-in", "Letter Fade", "Bounce", "Reveal"] as const;
const AD_STYLES         = ["Banner", "Card", "Corner Pop", "Fullscreen", "Strip"] as const;
const BREAK_STYLES      = ["Video Play", "Countdown", "Wave", "Glass", "Neon", "Minimal", "Gradient"] as const;
const CHAT_STYLES       = ["TV", "Bubble", "Neon", "Glass", "Compact", "Toast"] as const;
const SUB_STYLES        = ["HUD", "Minimal", "Animated", "Card", "Goal"] as const;
const CHAT_BURN_STYLES  = ["Bubble", "Float", "Sidebar", "Highlight", "Ticker"] as const;
const GUEST_STYLES      = ["Classic", "Neon", "Gradient", "Minimal", "Sports"] as const;

const SUPERCHAT_TIERS = [
  { label: "$1",   min: 1,   max: 2,    color: "#1565C0" },
  { label: "$2",   min: 2,   max: 5,    color: "#006064" },
  { label: "$5",   min: 5,   max: 10,   color: "#00695C" },
  { label: "$10",  min: 10,  max: 20,   color: "#F57F17" },
  { label: "$20",  min: 20,  max: 50,   color: "#E65100" },
  { label: "$50",  min: 50,  max: 100,  color: "#AD1457" },
  { label: "$100", min: 100, max: Infinity, color: "#B71C1C" },
];

function superChatColor(amount: number): string {
  return SUPERCHAT_TIERS.find((t) => amount >= t.min && amount < t.max)?.color ?? "#1565C0";
}

async function pushBroadcast(patch: Partial<BroadcastState>) {
  try {
    await fetch("/api/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(patch),
    });
  } catch {}
}

// ── Shared UI components ────────────────────────────────────────────────────

function StylePills({ styles, current, accent, onSelect }: {
  styles: readonly string[];
  current: string;
  accent: string;
  onSelect: (s: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {styles.map((s) => (
        <button
          key={s}
          onClick={() => onSelect(s)}
          style={{
            padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer",
            border: `1px solid ${current === s ? accent : "rgba(255,255,255,0.1)"}`,
            background: current === s ? `${accent}22` : "transparent",
            color: current === s ? "#fff" : "rgba(255,255,255,0.45)",
            transition: "all 0.18s ease",
          }}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8, padding: "7px 12px", color: "#fff", fontSize: 12,
        outline: "none", fontFamily: "inherit",
      }}
    />
  );
}

function NumberInput({ value, onChange, placeholder }: { value: number; onChange: (v: number) => void; placeholder: string }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      placeholder={placeholder}
      style={{
        flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8, padding: "7px 12px", color: "#fff", fontSize: 12,
        outline: "none", fontFamily: "inherit",
      }}
    />
  );
}

function PositionSliders({ pos, onChange, label, accent }: {
  pos: OverlayPosition;
  onChange: (p: OverlayPosition) => void;
  label?: string;
  accent?: string;
}) {
  const defaultPos = useRef<OverlayPosition>(pos);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        {label || "Position"}
      </div>
      {(["x", "y"] as const).map((axis) => {
        const delta = pos[axis] - defaultPos.current[axis];
        return (
          <div key={axis} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", width: 14, fontWeight: 700 }}>
                {axis.toUpperCase()}
              </span>
              <input
                type="range"
                min={0} max={100} step={1}
                value={pos[axis]}
                onChange={(e) => onChange({ ...pos, [axis]: Number(e.target.value) })}
                style={{ flex: 1, accentColor: accent || "#667eea", cursor: "pointer" }}
              />
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", width: 30, textAlign: "right" }}>
                {pos[axis]}%
              </span>
            </div>
            <div style={{ paddingLeft: 24, minHeight: 16 }}>
              {delta !== 0 && (
                <span style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: "0.04em",
                  color: delta > 0 ? "#34d399" : "#f87171",
                  background: delta > 0 ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)",
                  border: `1px solid ${delta > 0 ? "rgba(52,211,153,0.25)" : "rgba(248,113,113,0.25)"}`,
                  borderRadius: 4, padding: "1px 6px",
                }}>
                  {delta > 0 ? "+" : ""}{delta}%
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EditModeToggle({ mode, onChange }: { mode: EditMode; onChange: (m: EditMode) => void }) {
  return (
    <div style={{ display: "flex", gap: 3, padding: "3px", borderRadius: 9, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
      {(["desktop", "mobile"] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "3px 9px", borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: "pointer",
            border: `1px solid ${mode === m ? "rgba(167,139,250,0.6)" : "transparent"}`,
            background: mode === m ? "rgba(167,139,250,0.18)" : "transparent",
            color: mode === m ? "#d8b4fe" : "rgba(255,255,255,0.35)",
            transition: "all 0.18s ease",
          }}
        >
          {m === "desktop" ? <Monitor size={10} /> : <Smartphone size={10} />}
          {m === "desktop" ? "Desktop" : "Mobile"}
        </button>
      ))}
    </div>
  );
}

/**
 * Go Live button with 3-second countdown.
 * - Activating: shows countdown, then applies.
 * - Deactivating: applies immediately.
 */
function ToggleButton({ active, onActivate, onDeactivate, accent, countdownSecs, onCancel }: {
  active: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  accent: string;
  countdownSecs?: number | null;
  onCancel?: () => void;
}) {
  if (countdownSecs != null && countdownSecs > 0) {
    return (
      <button
        onClick={onCancel}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "5px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
          border: "1px solid rgba(251,191,36,0.55)",
          background: "rgba(251,191,36,0.12)",
          color: "#fbbf24",
          transition: "all 0.2s ease", flexShrink: 0,
          animation: "cr-fade-in 0.2s ease",
        }}
      >
        <X size={10} />
        Going live in {countdownSecs}s — tap to cancel
      </button>
    );
  }
  return (
    <button
      onClick={() => active ? onDeactivate() : onActivate()}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "5px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
        border: `1px solid ${active ? "#e53e3e" : accent}`,
        background: active ? "rgba(229,62,62,0.15)" : `${accent}18`,
        color: active ? "#fc8181" : "#fff",
        transition: "all 0.2s ease", flexShrink: 0,
      }}
    >
      {active ? <><Square size={10} /> Stop</> : <><Play size={10} /> Go Live</>}
    </button>
  );
}

function LiveBadge({ label, active, accent }: { label: string; active: boolean; accent: string }) {
  if (!active) return null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "5px 12px", borderRadius: 8,
      background: `${accent}15`, border: `1px solid ${accent}40`,
      animation: "cr-fade-in 0.3s ease",
    }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: accent, animation: "cr-pulse 1.2s infinite" }} />
      <span style={{ color: accent, fontSize: 11, fontWeight: 700 }}>{label} is LIVE on stage</span>
    </div>
  );
}

function SizeSlider({ value, onChange, accent }: {
  value: number;
  onChange: (v: number) => void;
  accent?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        Size
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", width: 24 }}>50%</span>
        <input
          type="range"
          min={50} max={200} step={5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ flex: 1, accentColor: accent || "#667eea", cursor: "pointer" }}
        />
        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", width: 36, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
          {value}%
        </span>
      </div>
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
      <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
    </div>
  );
}

// ── Break Panel (inline component) ──────────────────────────────────────────

function BreakPanel({
  bs, localUpdate, update, goLive, cancelGoLive, stopOverlay, countdowns, activeStreamCount,
}: {
  bs: BroadcastState;
  localUpdate: (p: Partial<BroadcastState>) => void;
  update: (p: Partial<BroadcastState>) => void;
  goLive: (key: string, patch: Partial<BroadcastState>) => void;
  cancelGoLive: (key: string) => void;
  stopOverlay: (patch: Partial<BroadcastState>) => void;
  countdowns: Record<string, number>;
  activeStreamCount: number;
}) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [preloadStatus, setPreloadStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const preloadPollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const url = (bs.breakVideoUrl ?? "").trim();
    setPreloadStatus("idle");
    if (preloadPollRef.current) { clearInterval(preloadPollRef.current); preloadPollRef.current = null; }
    if (!url || !/youtube\.com|youtu\.be/.test(url)) return;
    setPreloadStatus("loading");
    fetch("/api/break-video/preload", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }).catch(() => {});
    const pollOnce = async () => {
      try {
        const r = await fetch(`/api/break-video/preload-status?url=${encodeURIComponent(url)}`, { credentials: "include" });
        if (!r.ok) return;
        const d = await r.json();
        if (d.status === "ready") { setPreloadStatus("ready"); if (preloadPollRef.current) { clearInterval(preloadPollRef.current); preloadPollRef.current = null; } }
        else if (d.status === "error") { setPreloadStatus("error"); if (preloadPollRef.current) { clearInterval(preloadPollRef.current); preloadPollRef.current = null; } }
      } catch {}
    };
    void pollOnce();
    preloadPollRef.current = setInterval(pollOnce, 2500);
    return () => { if (preloadPollRef.current) clearInterval(preloadPollRef.current); };
  }, [bs.breakVideoUrl]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("video", file);
      const res = await fetch("/api/upload/break-video", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      localUpdate({ breakVideoUrl: data.url });
    } catch {
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <TextInput value={bs.breakText} onChange={(v) => localUpdate({ breakText: v })} placeholder="Break message…" />
      <div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Break Style</div>
        <StylePills styles={BREAK_STYLES} current={bs.breakStyle} accent="#f59e0b" onSelect={(s) => localUpdate({ breakStyle: s })} />
      </div>

      <div>
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Break Video Background Mode</div>
        <div style={{ display: "flex", gap: 6 }}>
          {([
            { mode: "fullscreen" as const, icon: "⬛", label: "Full Screen" },
            { mode: "live-bg" as const, icon: "📹", label: "Live BG" },
            { mode: "gradient-bg" as const, icon: "🎨", label: "Gradient BG" },
          ] as const).map(({ mode, icon, label }) => (
            <button
              key={mode}
              onClick={() => update({ breakVideoMode: mode })}
              style={{
                flex: 1, padding: "9px 6px", borderRadius: 10, fontSize: 10, fontWeight: 700,
                border: `1px solid ${bs.breakVideoMode === mode ? "#f59e0b" : "rgba(255,255,255,0.1)"}`,
                background: bs.breakVideoMode === mode ? "rgba(245,158,11,0.14)" : "rgba(255,255,255,0.04)",
                color: bs.breakVideoMode === mode ? "#fcd34d" : "rgba(255,255,255,0.5)",
                cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                transition: "all 0.18s ease",
              }}
            >
              <span style={{ fontSize: 16 }}>{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div style={{ marginTop: 6, fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
          {bs.breakVideoMode === "fullscreen" && "Break video fills the full screen — live feed not visible."}
          {bs.breakVideoMode === "live-bg" && "Live stream shows through the letterbox bars around the video."}
          {bs.breakVideoMode === "gradient-bg" && "Animated gradient fills the letterbox bars behind the video."}
        </div>

        {/* Gradient color pickers — only shown when gradient-bg is selected */}
        {bs.breakVideoMode === "gradient-bg" && (
          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
            {(["bgGradient1", "bgGradient2"] as const).map((field, i) => (
              <div key={field} style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  BG Colour {i + 1}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="color"
                    value={(bs as any)[field]}
                    onChange={(e) => localUpdate({ [field]: e.target.value } as any)}
                    style={{ width: 36, height: 30, borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", cursor: "pointer", padding: 2 }}
                  />
                  <span style={{ fontSize: 10, fontFamily: "monospace", color: "rgba(255,255,255,0.45)" }}>
                    {(bs as any)[field]}
                  </span>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
              <div style={{
                width: 44, height: 26, borderRadius: 6,
                background: `linear-gradient(135deg, ${bs.bgGradient1}, ${bs.bgGradient2})`,
                border: "1px solid rgba(255,255,255,0.12)",
              }} />
            </div>
          </div>
        )}
      </div>

      {/* XY pan — position the break video within the output frame */}
      {bs.breakVideoUrl && (
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Video Position (Pan)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>Horizontal (X)</span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>{bs.breakVideoPanX ?? 50}%</span>
              </div>
              <input type="range" min="0" max="100" value={bs.breakVideoPanX ?? 50}
                onChange={(e) => update({ breakVideoPanX: Number(e.target.value) })}
                style={{ width: "100%", accentColor: "#f59e0b" }}
              />
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.45)" }}>Vertical (Y)</span>
                <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>{bs.breakVideoPanY ?? 50}%</span>
              </div>
              <input type="range" min="0" max="100" value={bs.breakVideoPanY ?? 50}
                onChange={(e) => update({ breakVideoPanY: Number(e.target.value) })}
                style={{ width: "100%", accentColor: "#f59e0b" }}
              />
            </div>
          </div>
        </div>
      )}

      <SectionDivider label="Break Video (optional)" />
      <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11, lineHeight: 1.5 }}>
        Play a video during the break on this dashboard preview. Paste a public URL or upload a file (MP4, WebM, MOV — up to 500 MB).
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <TextInput
          value={bs.breakVideoUrl}
          onChange={(v) => update({ breakVideoUrl: v })}
          placeholder="https://… or leave empty for no video"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          style={{
            padding: "6px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer",
            border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.1)",
            color: "#fbbf24", whiteSpace: "nowrap", flexShrink: 0, opacity: uploading ? 0.5 : 1,
          }}
        >
          {uploading ? "Uploading…" : "📁 Upload"}
        </button>
      </div>

      {/* ── YouTube preload status indicator ── */}
      {preloadStatus !== "idle" && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, padding: "5px 0" }}>
          {preloadStatus === "loading" && (
            <span style={{ color: "#93c5fd", display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ display: "inline-block", animation: "cr-spin 1s linear infinite", fontSize: 12 }}>⟳</span>
              Pre-resolving YouTube URL in background…
            </span>
          )}
          {preloadStatus === "ready" && (
            <span style={{ color: "#34d399", fontWeight: 600 }}>✓ URL resolved — break will start instantly on Go Live</span>
          )}
          {preloadStatus === "error" && (
            <span style={{ color: "#fbbf24" }}>⚠ Will download on Go Live (1–2 min on first load)</span>
          )}
        </div>
      )}

      {bs.breakVideoUrl && (
        <div style={{ borderRadius: 10, overflow: "hidden", background: "#000", border: "1px solid rgba(245,158,11,0.2)" }}>
          {/youtube\.com|youtu\.be/.test(bs.breakVideoUrl) ? (() => {
            const ytMatch = bs.breakVideoUrl.match(/(?:v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([a-zA-Z0-9_-]{11})/);
            const embedId = ytMatch?.[1];
            if (embedId) {
              return (
                <iframe
                  key={bs.breakVideoUrl}
                  src={`https://www.youtube.com/embed/${embedId}?autoplay=0&controls=1`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  style={{ width: "100%", height: 200, border: "none", display: "block" }}
                />
              );
            }
            return (
              <div style={{ padding: 16, color: "rgba(255,255,255,0.5)", fontSize: 11, textAlign: "center" }}>
                YouTube link saved — will be extracted via yt-dlp when break goes live.
              </div>
            );
          })() : (
            <video
              key={bs.breakVideoUrl}
              src={bs.breakVideoUrl}
              controls
              loop
              style={{ width: "100%", maxHeight: 200, display: "block" }}
            />
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "6px 10px" }}>
            <button
              onClick={() => update({ breakVideoUrl: "" })}
              style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", cursor: "pointer", background: "none", border: "none" }}
            >
              ✕ Remove video
            </button>
          </div>
        </div>
      )}

      {bs.breakStyle === "Video Play" && (
        <div style={{ padding: "8px 12px", borderRadius: 7, background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.30)", fontSize: 11, color: "#fcd34d", lineHeight: 1.5 }}>
          <strong>Video Play</strong> — the break video fills the screen with no overlay text. Paste a URL or upload a video above before going live.
        </div>
      )}
      {bs.breakStyle === "Video Play" && activeStreamCount === 0 && (
        <div style={{ padding: "8px 12px", borderRadius: 7, background: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)", fontSize: 11, color: "#f87171", lineHeight: 1.5 }}>
          ⚠ <strong>No stream is live.</strong> Start a stream first — the break video is composited server-side into the active FFmpeg pipeline and requires a running stream.
        </div>
      )}
      <div style={{ padding: "8px 12px", borderRadius: 7, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.15)", fontSize: 11, color: "rgba(255,255,255,0.38)", lineHeight: 1.5 }}>
        Break style and message are staged — tap <strong style={{ color: "#f59e0b" }}>Go Live</strong> to put the stream on break with a 3-second warning. The live stream is never reconnected — video is composited on top.
      </div>

      {/* Audio mute controls */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={() => update({ breakVideoMuted: !bs.breakVideoMuted })}
          title="Mute / unmute break video audio in the browser display"
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
            border: `1px solid ${bs.breakVideoMuted ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.15)"}`,
            background: bs.breakVideoMuted ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.05)",
            color: bs.breakVideoMuted ? "#f87171" : "rgba(255,255,255,0.6)",
            transition: "all 0.18s ease",
          }}
        >
          {bs.breakVideoMuted ? "🔇" : "🔊"} {bs.breakVideoMuted ? "Video Audio: Muted" : "Video Audio: On"}
        </button>
        <button
          onClick={() => update({ liveAudioMuted: !bs.liveAudioMuted })}
          title="Mute / unmute live stream audio in the RTMP output (triggers fast restart)"
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 14px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
            border: `1px solid ${bs.liveAudioMuted ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.15)"}`,
            background: bs.liveAudioMuted ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.05)",
            color: bs.liveAudioMuted ? "#f87171" : "rgba(255,255,255,0.6)",
            transition: "all 0.18s ease",
          }}
        >
          {bs.liveAudioMuted ? "🔇" : "🔊"} {bs.liveAudioMuted ? "Stream Audio: Muted" : "Stream Audio: On"}
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <ToggleButton
          active={bs.breakActive}
          accent="#f59e0b"
          countdownSecs={countdowns["break"]}
          onCancel={() => cancelGoLive("break")}
          onActivate={() => goLive("break", {
            breakActive: true,
            breakText: bs.breakText,
            breakStyle: bs.breakStyle,
            breakVideoUrl: bs.breakVideoUrl,
            breakVideoMode: bs.breakVideoMode,
            breakVideoMuted: bs.breakVideoMuted,
            breakVideoPanX: bs.breakVideoPanX,
            breakVideoPanY: bs.breakVideoPanY,
            bgGradient1: bs.bgGradient1,
            bgGradient2: bs.bgGradient2,
            bgGradientOpacity: bs.bgGradientOpacity,
          })}
          onDeactivate={() => stopOverlay({ breakActive: false })}
        />
        <LiveBadge label={`${bs.breakStyle} break screen`} active={bs.breakActive} accent="#f59e0b" />
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function ControlRoom({ streams, streamStats, streamChat, streamProcStats = {} }: ControlRoomProps) {
  const [activeTab, setActiveTab] = useState<Tab>("stats");
  const [collapsed, setCollapsed] = useState(false);
  const [editMode, setEditMode] = useState<EditMode>("desktop");

  // Local UI state — changes here are NOT pushed to the server until Go Live is tapped
  const [bs, setBs] = useState<BroadcastState>({
    newsActive: false, newsText: "Welcome to the live stream! Stay tuned for more updates.",
    newsTitle: "", newsBgColor: "#cc0001",
    newsStyle: "Ticker", newsAnimation: "Fade",
    newsPosition: { x: 0, y: 95 },
    adActive: false, adText: "Big Sale — 50% Off Today Only!", adSub: "Use code LIVE at checkout.", adStyle: "Banner",
    adPosition: { x: 0, y: 0 },
    breakActive: false, breakText: "Be right back — taking a short break!", breakStyle: "Countdown", breakVideoUrl: "", breakVideoMode: "live-bg", breakVideoMuted: false, liveAudioMuted: false,
    chatStyle: "TV",
    statsActive: true, statsPosition: { x: 2, y: 2 },
    subsOverlayActive: false, subsStyle: "HUD", subsPosition: { x: 72, y: 2 }, subsGoal: 1000000,
    subChartActive: false, subChartData: [], subChartPosition: { x: 68, y: 8 }, mobileSubChartPosition: { x: 5, y: 8 },
    subAlertActive: false, subAlertMessage: "",
    chatBurnActive: false, chatBurnStyle: "Bubble", chatBurnPosition: { x: 2, y: 62 },
    superChatMessages: [],
    guestNameActive: false, guestName: "Guest Name", guestTitle: "Title / Channel", guestStyle: "Classic",
    guestPosition: { x: 2, y: 78 }, mobileGuestPosition: { x: 2, y: 78 },
    bgGradientActive: false, bgGradient1: "#6d28d9", bgGradient2: "#0891b2", bgGradientOpacity: 0.45,
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
    breakVideoPanX: 50,
    breakVideoPanY: 50,
    qrActive: false,
    qrUrl: "",
    qrTitle: "",
    qrSize: 160,
    qrPosition: { x: 88, y: 10 },
    qrScanCount: 0,
    qrThankYouName: "",
    qrThankYouTs: 0,
    qrGlowIntensity: 60,
    qrBorderStyle: "glow",
    qrAnimation: "pulse",
    screenShareActive: false,
    screenShareMode: "presenter",
    screenShareX: 60,
    screenShareY: 5,
    screenShareW: 38,
    screenShareRadius: 12,
    donationTickerActive: false,
    donationAlertActive: true,
    donationTicker: [],
  });
  const volDebRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrPosDebRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screenDebRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── SuperChat QR overlay state ───────────────────────────────────────────
  const [qrLocked,         setQrLocked]         = useState(false);
  const [qrGatewayUrl,     setQrGatewayUrl]     = useState("");
  const [qrGatewayLoading, setQrGatewayLoading] = useState(false);

  const fetchQrGatewayUrl = useCallback(async () => {
    setQrGatewayLoading(true);
    try {
      const r = await fetch("/api/gateway/url", { credentials: "include" });
      if (r.ok) {
        const d = await r.json() as { gatewayUrl?: string };
        if (d.gatewayUrl) setQrGatewayUrl(d.gatewayUrl);
      }
    } catch {}
    setQrGatewayLoading(false);
  }, []);

  useEffect(() => { void fetchQrGatewayUrl(); }, [fetchQrGatewayUrl]);

  // ── Screen Share WebSocket ───────────────────────────────────────────────
  const [screenActive, setScreenActive] = useState(false);
  const [screenConnecting, setScreenConnecting] = useState(false);
  const [screenReconnecting, setScreenReconnecting] = useState(false);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [screenElapsed, setScreenElapsed] = useState(0);
  const screenWsRef = useRef<WebSocket | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const screenTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const screenElapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const screenStreamAliveRef = useRef(false); // stays true while track is live
  const screenRafRef = useRef<number>(0);
  const [screenPreviewUrl, setScreenPreviewUrl] = useState<string | null>(null);

  const startScreenShare = useCallback(async () => {
    setScreenError(null);
    setScreenConnecting(true);
    try {
      if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
        throw Object.assign(
          new Error("Screen capture is not available here. Open the app in a new browser tab and try again."),
          { name: "NotSupportedError" }
        );
      }
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 } as MediaTrackConstraints,
        audio: false,
        // @ts-ignore — Chrome hint to pre-select Entire Screen
        preferCurrentTab: false,
        selfBrowserSurface: "exclude",
      });

      // ── Verify the user picked "Entire Screen", not a window or tab ─────
      const videoTrack = stream.getVideoTracks()[0];
      const surface = (videoTrack?.getSettings() as any)?.displaySurface;
      if (surface && surface !== "monitor") {
        stream.getTracks().forEach(t => t.stop());
        throw Object.assign(
          new Error(
            `You selected a "${surface}" — please click "Entire Screen" (not a window or tab) in the picker, then try again.`
          ),
          { name: "WrongSurfaceError" }
        );
      }

      screenStreamRef.current = stream;
      screenStreamAliveRef.current = true;

      const canvas = document.createElement("canvas");
      screenCanvasRef.current = canvas;
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      await video.play();

      // ── Elapsed-time counter ─────────────────────────────────────────────
      setScreenElapsed(0);
      if (screenElapsedRef.current) clearInterval(screenElapsedRef.current);
      screenElapsedRef.current = setInterval(() => setScreenElapsed((s) => s + 1), 1000);

      // ── Inner WS connector — called again on every reconnect ─────────────
      let reconnectDelay = 1500;
      const connectScreenWs = () => {
        if (!screenStreamAliveRef.current) return;
        setScreenReconnecting(false);

        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${proto}//${window.location.host}/ws-screen`);
        screenWsRef.current = ws;
        ws.binaryType = "arraybuffer";

        ws.onopen = () => {
          reconnectDelay = 1500; // reset on successful open
          ws.send(JSON.stringify({ type: "screen_auth", sessionId: crypto.randomUUID() }));
        };

        ws.onmessage = (evt) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.type === "screen_auth_ok") {
              setScreenConnecting(false);
              setScreenReconnecting(false);
              setScreenActive(true);
              update({ screenShareActive: true });

              // Initialise canvas once at stream resolution
              const waitForDimensions = () => {
                if (!video.videoWidth || !video.videoHeight) {
                  requestAnimationFrame(waitForDimensions);
                  return;
                }
                // Cap resolution to 1280px wide for smooth delivery
                const MAX_W = 1280;
                const aspect = video.videoWidth / video.videoHeight;
                canvas.width = Math.min(video.videoWidth, MAX_W);
                canvas.height = Math.round(canvas.width / aspect);
                const ctx2d = canvas.getContext("2d", { willReadFrequently: false })!;

                const TARGET_FPS = 15;
                const FRAME_INTERVAL = Math.round(1000 / TARGET_FPS); // ~67 ms
                let encoding = false;

                const captureFrame = () => {
                  if (encoding) return;
                  if (ws.readyState !== WebSocket.OPEN) return;
                  if ((ws as any).bufferedAmount > 128 * 1024) return;

                  encoding = true;
                  ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
                  canvas.toBlob((blob) => {
                    encoding = false;
                    if (!blob || ws.readyState !== WebSocket.OPEN) return;
                    blob.arrayBuffer().then((ab) => {
                      if (ws.readyState === WebSocket.OPEN) ws.send(ab);
                    });
                    const url = URL.createObjectURL(blob);
                    setScreenPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
                  }, "image/jpeg", 0.70);
                };

                screenRafRef.current = window.setInterval(captureFrame, FRAME_INTERVAL);
              };
              waitForDimensions();
            }
          } catch {}
        };

        ws.onerror = () => {
          // Errors always fire before onclose — onclose handles reconnect
        };

        ws.onclose = () => {
          clearInterval(screenRafRef.current);
          screenRafRef.current = 0;

          if (!screenStreamAliveRef.current) {
            // User deliberately stopped — clean up fully
            setScreenActive(false);
            setScreenConnecting(false);
            setScreenReconnecting(false);
            return;
          }

          // Stream is still alive — auto-reconnect with backoff
          setScreenReconnecting(true);
          const delay = Math.min(reconnectDelay, 15000);
          reconnectDelay = Math.min(reconnectDelay * 1.5, 15000);
          setTimeout(connectScreenWs, delay);
        };
      };

      connectScreenWs();

      // Auto-stop when user dismisses share from the browser's native UI
      stream.getVideoTracks()[0].onended = () => stopScreenShare();

    } catch (e: any) {
      const msg =
        e?.name === "NotAllowedError" ? "Permission denied — click Allow when the browser asks." :
        e?.name === "NotSupportedError" ? e.message :
        `Error: ${e?.message ?? e}`;
      setScreenError(msg);
      setScreenConnecting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopScreenShare = useCallback(() => {
    screenStreamAliveRef.current = false;
    clearInterval(screenRafRef.current);
    screenRafRef.current = 0;
    if (screenElapsedRef.current) { clearInterval(screenElapsedRef.current); screenElapsedRef.current = null; }
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    screenWsRef.current?.close();
    screenWsRef.current = null;
    setScreenActive(false);
    setScreenConnecting(false);
    setScreenReconnecting(false);
    setScreenElapsed(0);
    setScreenPreviewUrl(null);
    update({ screenShareActive: false });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Music player ─────────────────────────────────────────────────────────
  interface MusicTrack { id: string; title: string; url: string; isFile?: boolean; originalUrl?: string; }

  const [playlist, setPlaylist] = useState<MusicTrack[]>([]);
  const [currentIdx, setCurrentIdx] = useState<number | null>(null);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicVolume, setMusicVolume] = useState(70);
  const [musicBroadcast, setMusicBroadcast] = useState(false);
  const [musicBroadcastActive, setMusicBroadcastActive] = useState(false);
  const [musicProgress, setMusicProgress] = useState(0); // 0-1
  const [musicDuration, setMusicDuration] = useState(0);
  const [musicCurrentTime, setMusicCurrentTime] = useState(0);
  const [musicAddUrl, setMusicAddUrl] = useState("");
  const [musicAddTitle, setMusicAddTitle] = useState("");
  const [musicError, setMusicError] = useState<string | null>(null);

  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const musicCtxRef = useRef<AudioContext | null>(null);
  const musicSrcNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const musicGainNodeRef = useRef<GainNode | null>(null);
  const musicProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const musicWsRef = useRef<WebSocket | null>(null);
  const musicFileInputRef = useRef<HTMLInputElement | null>(null);
  const musicProgressRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Ensure audio element exists
  const getMusicAudio = useCallback((): HTMLAudioElement => {
    if (!musicAudioRef.current) {
      const el = new Audio();
      el.crossOrigin = "anonymous";
      el.preload = "metadata";
      el.onerror = () => {
        const code = el.error?.code;
        const msg =
          code === 1 ? "Playback aborted." :
          code === 2 ? "Network error — track link may have expired. Try re-adding the track." :
          code === 3 ? "Audio format not supported by your browser. Try a different track." :
          code === 4 ? "Track could not be loaded — the link may have expired. Re-add the track to refresh it." :
          "Unknown playback error.";
        setMusicError(msg);
        setMusicPlaying(false);
      };
      el.onended = () => {
        setMusicPlaying(false);
        // Auto-advance to next track
        setCurrentIdx((prev) => {
          if (prev === null) return null;
          setPlaylist((pl) => {
            const next = (prev + 1) % pl.length;
            if (pl.length > 1) {
              setTimeout(() => {
                el.src = pl[next].url;
                el.play().catch(() => {});
                setMusicPlaying(true);
                setCurrentIdx(next);
              }, 300);
            }
            return pl;
          });
          return prev;
        });
      };
      musicAudioRef.current = el;
    }
    return musicAudioRef.current;
  }, []);

  // Update volume live
  useEffect(() => {
    if (musicGainNodeRef.current) {
      musicGainNodeRef.current.gain.value = musicVolume / 100;
    }
    if (musicAudioRef.current && !musicBroadcastActive) {
      musicAudioRef.current.volume = musicVolume / 100;
    }
  }, [musicVolume, musicBroadcastActive]);

  // Progress ticker
  useEffect(() => {
    if (!musicPlaying) { if (musicProgressRef.current) clearInterval(musicProgressRef.current); return; }
    musicProgressRef.current = setInterval(() => {
      const el = musicAudioRef.current;
      if (!el || !el.duration) return;
      setMusicCurrentTime(el.currentTime);
      setMusicDuration(el.duration);
      setMusicProgress(el.currentTime / el.duration);
    }, 500);
    return () => { if (musicProgressRef.current) clearInterval(musicProgressRef.current); };
  }, [musicPlaying]);

  const playTrack = useCallback((idx: number) => {
    if (idx < 0) return;
    setPlaylist((pl) => {
      if (idx >= pl.length) return pl;
      const track = pl[idx];
      const el = getMusicAudio();
      if (musicBroadcastActive && musicCtxRef.current) {
        // Already broadcasting — just swap src
        el.src = track.url;
        el.volume = 1;
        el.play().catch(() => {});
      } else {
        el.src = track.url;
        el.volume = musicVolume / 100;
        el.play().catch(() => {});
      }
      setMusicPlaying(true);
      setCurrentIdx(idx);
      return pl;
    });
  }, [getMusicAudio, musicVolume, musicBroadcastActive]);

  const pauseTrack = useCallback(() => {
    musicAudioRef.current?.pause();
    setMusicPlaying(false);
  }, []);

  const resumeTrack = useCallback(() => {
    musicAudioRef.current?.play().catch(() => {});
    setMusicPlaying(true);
  }, []);

  const startMusicBroadcast = useCallback(async () => {
    const el = getMusicAudio();
    // Build standalone AudioContext if mic isn't using one, else share
    let ctx = audioCtxRef.current;
    let isShared = true;
    if (!ctx || ctx.state === "closed") {
      ctx = new AudioContext({ sampleRate: 44100 });
      isShared = false;
      musicCtxRef.current = ctx;
    } else {
      musicCtxRef.current = ctx;
    }
    if (ctx.state === "suspended") await ctx.resume();

    // Create media element source (can only be created once per element per context)
    if (!musicSrcNodeRef.current) {
      musicSrcNodeRef.current = ctx.createMediaElementSource(el);
    }
    const gain = ctx.createGain();
    gain.gain.value = musicVolume / 100;
    musicGainNodeRef.current = gain;
    musicSrcNodeRef.current.connect(gain);

    if (!isShared || !processorRef.current) {
      // Create our own processor → ws-mic
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      musicProcessorRef.current = processor;

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${window.location.host}/ws-mic`);
      musicWsRef.current = ws;

      processor.onaudioprocess = (e) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        ws.send(pcm.buffer);
      };

      gain.connect(processor);
      processor.connect(ctx.destination);

      ws.onopen = () => setMusicBroadcastActive(true);
      ws.onclose = () => { setMusicBroadcastActive(false); };
    } else {
      // Mic is active — connect music gain to existing mic ScriptProcessor
      gain.connect(processorRef.current);
      setMusicBroadcastActive(true);
    }

    // When broadcasting, let the AudioContext control volume; mute HTML5 volume
    el.volume = 1;
  }, [getMusicAudio, musicVolume]);

  const stopMusicBroadcast = useCallback(() => {
    musicSrcNodeRef.current?.disconnect();
    musicSrcNodeRef.current = null;
    musicGainNodeRef.current?.disconnect();
    musicGainNodeRef.current = null;
    musicProcessorRef.current?.disconnect();
    musicProcessorRef.current = null;
    musicWsRef.current?.close();
    musicWsRef.current = null;
    if (musicCtxRef.current && musicCtxRef.current !== audioCtxRef.current) {
      musicCtxRef.current.close().catch(() => {});
    }
    musicCtxRef.current = null;
    if (musicAudioRef.current) musicAudioRef.current.volume = musicVolume / 100;
    setMusicBroadcastActive(false);
    setMusicBroadcast(false);
  }, [musicVolume]);

  const [musicResolving, setMusicResolving] = useState(false);

  const isYtUrl = (u: string) =>
    /youtube\.com|youtu\.be|soundcloud\.com|twitch\.tv|vimeo\.com/.test(u);

  const addMusicUrl = useCallback(async () => {
    const url = musicAddUrl.trim();
    if (!url) return;
    setMusicError(null);

    // Direct audio file — add immediately
    if (!isYtUrl(url)) {
      const title = musicAddTitle.trim() || url.split("/").pop() || "Track";
      setPlaylist((prev) => [...prev, { id: crypto.randomUUID(), title, url }]);
      setMusicAddUrl("");
      setMusicAddTitle("");
      return;
    }

    // YouTube / SoundCloud / etc — resolve via backend
    setMusicResolving(true);
    try {
      const res = await fetch("/api/music/resolve", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) { setMusicError(data.error ?? "Could not resolve URL"); return; }
      const title = musicAddTitle.trim() || data.title || "Track";
      setPlaylist((prev) => [...prev, { id: crypto.randomUUID(), title, url: data.proxyUrl, originalUrl: url }]);
      setMusicAddUrl("");
      setMusicAddTitle("");
    } catch (e: any) {
      setMusicError(`Network error: ${e?.message}`);
    } finally {
      setMusicResolving(false);
    }
  }, [musicAddUrl, musicAddTitle]);

  const [refreshingTrackId, setRefreshingTrackId] = useState<string | null>(null);

  const refreshTrack = useCallback(async (trackId: string) => {
    setPlaylist((pl) => {
      const track = pl.find((t) => t.id === trackId);
      if (!track?.originalUrl) return pl;
      setRefreshingTrackId(trackId);
      setMusicError(null);
      fetch("/api/music/resolve", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: track.originalUrl }),
      }).then(async (res) => {
        const data = await res.json();
        if (!res.ok) { setMusicError(data.error ?? "Could not refresh track"); return; }
        setPlaylist((prev) => prev.map((t) => t.id === trackId ? { ...t, url: data.proxyUrl } : t));
        // If this track was playing, restart it with new URL
        setCurrentIdx((ci) => {
          if (ci !== null) {
            setPlaylist((prev) => {
              const idx = prev.findIndex((t) => t.id === trackId);
              if (idx === ci && musicAudioRef.current) {
                musicAudioRef.current.src = data.proxyUrl;
                musicAudioRef.current.play().catch(() => {});
                setMusicPlaying(true);
              }
              return prev;
            });
          }
          return ci;
        });
      }).catch((e: any) => setMusicError(`Refresh failed: ${e?.message}`))
        .finally(() => setRefreshingTrackId(null));
      return pl;
    });
  }, []);

  const removeTrack = useCallback((id: string) => {
    setPlaylist((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      setCurrentIdx((ci) => {
        if (ci === null) return null;
        if (idx === ci) { musicAudioRef.current?.pause(); setMusicPlaying(false); return null; }
        if (idx < ci) return ci - 1;
        return ci;
      });
      return next;
    });
  }, []);

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  // Per-element countdown: key → seconds remaining
  const [countdowns, setCountdowns] = useState<Record<string, number>>({});
  // Per-element patch to push when countdown hits 0
  const pendingPatchRef = useRef<Record<string, Partial<BroadcastState>>>({});
  // Per-element revert patch (to undo optimistic update on cancel)
  const revertPatchRef = useRef<Record<string, Partial<BroadcastState>>>({});

  // Sync state from server on mount
  useEffect(() => {
    fetch("/api/broadcast", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setBs((prev) => ({ ...prev, ...d })))
      .catch(() => {});
  }, []);

  // WebSocket subscriptions: donation alerts + QR scan/thank-you + gift events
  const { subscribe } = useWebSocket();
  const [latestDonation, setLatestDonation] = useState<DonationRecord | null>(null);
  const [latestGift, setLatestGift]         = useState<GiftEvent | null>(null);
  useEffect(() => {
    return subscribe("donation_alert", (msg) => {
      setLatestDonation(msg as unknown as DonationRecord);
    });
  }, [subscribe]);
  useEffect(() => {
    return subscribe("gift_received", (msg) => {
      setLatestGift(msg as unknown as GiftEvent);
    });
  }, [subscribe]);
  useEffect(() => {
    const u1 = subscribe("qr_scan", (msg) => {
      const m = msg as unknown as { count: number };
      setBs(prev => ({ ...prev, qrScanCount: m.count }));
    });
    const u2 = subscribe("qr_thank_you", (msg) => {
      const m = msg as unknown as { name: string; ts: number };
      setBs(prev => ({ ...prev, qrThankYouName: m.name, qrThankYouTs: m.ts }));
    });
    return () => { u1(); u2(); };
  }, [subscribe]);

  // Tick all active countdowns every second
  useEffect(() => {
    const activeKeys = Object.keys(countdowns).filter((k) => countdowns[k] > 0);
    if (activeKeys.length === 0) return;
    const t = setTimeout(() => {
      setCountdowns((prev) => {
        const next = { ...prev };
        for (const k of activeKeys) {
          next[k] = Math.max(0, (prev[k] ?? 0) - 1);
        }
        return next;
      });
    }, 1000);
    return () => clearTimeout(t);
  }, [countdowns]);

  // Fire push when a countdown hits 0
  useEffect(() => {
    const fired = Object.keys(countdowns).filter((k) => countdowns[k] === 0);
    if (fired.length === 0) return;
    for (const k of fired) {
      const patch = pendingPatchRef.current[k];
      if (patch) {
        pushBroadcast(patch);
        delete pendingPatchRef.current[k];
        delete revertPatchRef.current[k];
      }
    }
    setCountdowns((prev) => {
      const next = { ...prev };
      for (const k of fired) delete next[k];
      return next;
    });
  }, [countdowns]);

  /**
   * Start a 3-second countdown for key, then push patch.
   * Also applies patch optimistically to local state.
   */
  const goLive = useCallback((key: string, patch: Partial<BroadcastState>) => {
    // Save revert patch (current values of the keys in patch)
    const revert: Partial<BroadcastState> = {};
    for (const k in patch) {
      (revert as any)[k] = (bs as any)[k];
    }
    revertPatchRef.current[key] = revert;
    pendingPatchRef.current[key] = patch;

    // Optimistically reflect the activation in local state
    setBs((prev) => ({ ...prev, ...patch }));
    setCountdowns((prev) => ({ ...prev, [key]: 3 }));
  }, [bs]);

  /** Cancel a pending countdown and revert the optimistic update */
  const cancelGoLive = useCallback((key: string) => {
    const revert = revertPatchRef.current[key];
    if (revert) setBs((prev) => ({ ...prev, ...revert }));
    delete pendingPatchRef.current[key];
    delete revertPatchRef.current[key];
    setCountdowns((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  /** Immediate push (for deactivation — always instant) */
  const stopOverlay = useCallback((patch: Partial<BroadcastState>) => {
    setBs((prev) => ({ ...prev, ...patch }));
    pushBroadcast(patch);
  }, []);

  /** Local-only state update (no server push — staged for Go Live) */
  const localUpdate = useCallback((patch: Partial<BroadcastState>) => {
    setBs((prev) => ({ ...prev, ...patch }));
  }, []);

  /** Immediate push for non-go-live settings (stage chat style) */
  const update = useCallback((patch: Partial<BroadcastState>) => {
    setBs((prev) => ({ ...prev, ...patch }));
    pushBroadcast(patch);
  }, []);

  // ── Mic WebSocket + Web Audio pipeline ──────────────────────────────────
  const [micActive, setMicActive] = useState(false);
  const [micConnecting, setMicConnecting] = useState(false);
  const [micVolumeDisplay, setMicVolumeDisplay] = useState(100);
  const [micError, setMicError] = useState<string | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const micWsRef = useRef<WebSocket | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const micVolumeValRef = useRef(100);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micAnimRef = useRef<number | null>(null);

  const startMic = useCallback(async () => {
    setMicError(null);
    setMicConnecting(true);
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (e: any) {
        const msg = e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError"
          ? "Microphone permission denied. Allow mic access in your browser settings and try again."
          : `Could not access mic: ${e?.message || e}`;
        setMicError(msg);
        setMicConnecting(false);
        return;
      }
      micStreamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 44100 });
      audioCtxRef.current = ctx;
      // Some browsers (especially Safari) start an AudioContext in "suspended"
      // state even when created inside a user-gesture handler.  Resume explicitly
      // so that onaudioprocess fires and PCM data is actually sent to the server.
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      const src = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = micVolumeValRef.current / 100;
      micGainRef.current = gain;

      // Analyser for VU meter
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const processor = ctx.createScriptProcessor(2048, 1, 1);
      processorRef.current = processor;

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(`${proto}//${window.location.host}/ws-mic`);
      micWsRef.current = ws;
      ws.onopen = () => { setMicActive(true); setMicConnecting(false); };
      ws.onclose = () => { setMicActive(false); setMicConnecting(false); };
      ws.onerror = () => {
        setMicActive(false);
        setMicConnecting(false);
        setMicError("WebSocket connection to /ws-mic failed. Check that the API server is running.");
      };
      processor.onaudioprocess = (e) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        ws.send(pcm.buffer);
      };

      // Audio graph: src → gain → analyser → processor → destination
      src.connect(gain);
      gain.connect(analyser);
      analyser.connect(processor);
      processor.connect(ctx.destination);

      // VU meter animation loop
      const vuData = new Uint8Array(analyser.frequencyBinCount);
      const updateVU = () => {
        analyser.getByteFrequencyData(vuData);
        const avg = vuData.reduce((a, b) => a + b, 0) / vuData.length;
        setMicLevel(avg / 128);
        micAnimRef.current = requestAnimationFrame(updateVU);
      };
      micAnimRef.current = requestAnimationFrame(updateVU);
    } catch (e: any) {
      setMicError(`Mic error: ${e?.message || e}`);
      setMicConnecting(false);
    }
  }, []);

  const stopMic = useCallback(() => {
    if (micAnimRef.current) { cancelAnimationFrame(micAnimRef.current); micAnimRef.current = null; }
    processorRef.current?.disconnect();
    processorRef.current = null;
    analyserRef.current = null;
    micGainRef.current = null;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    micWsRef.current?.close();
    micWsRef.current = null;
    setMicActive(false);
    setMicLevel(0);
  }, []);

  const [superChatForm, setSuperChatForm] = useState({ user: "", amount: "", text: "" });

  const posKey = (base: "statsPosition" | "subsPosition" | "chatBurnPosition" | "newsPosition" | "adPosition" | "guestPosition" | "subChartPosition") => {
    if (editMode === "desktop") return base;
    const capped = base.charAt(0).toUpperCase() + base.slice(1);
    return `mobile${capped}` as keyof BroadcastState;
  };
  const getPos = (base: "statsPosition" | "subsPosition" | "chatBurnPosition" | "newsPosition" | "adPosition" | "guestPosition" | "subChartPosition"): OverlayPosition =>
    (bs as any)[posKey(base)] as OverlayPosition;
  const setPos = (base: "statsPosition" | "subsPosition" | "chatBurnPosition" | "newsPosition" | "adPosition" | "guestPosition" | "subChartPosition") =>
    (p: OverlayPosition) => localUpdate({ [posKey(base)]: p } as any);

  const fireSuperChat = useCallback(() => {
    const amt = parseFloat(superChatForm.amount) || 0;
    const newMsg = {
      user: superChatForm.user || "Viewer",
      amount: superChatForm.amount ? `$${superChatForm.amount}` : "$5",
      text: superChatForm.text,
      color: superChatColor(amt),
      ts: Date.now(),
    };
    const next = [...(bs.superChatMessages || []), newMsg].slice(-20);
    update({ superChatMessages: next });
    setSuperChatForm({ user: "", amount: "", text: "" });
  }, [bs.superChatMessages, superChatForm, update]);

  const activeStreams = streams.filter((s) => s.status === "streaming");
  const activeStreamCount = activeStreams.length;

  if (activeStreamCount === 0) return null;

  const currentTab = TABS.find((t) => t.id === activeTab)!;
  const allChatMessages = activeStreams.flatMap((s) => streamChat[s.id] || [])
    .sort((a, b) => new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime());
  const hasSubs = activeStreams.some((s) => streamStats[s.id]?.subs);
  const stageUrl = `${window.location.origin}/broadcast`;

  const positionTabs: Tab[] = ["stats", "subs", "chat", "news", "ads", "alerts"];

  // ── Pending badge ─────────────────────────────────────────────────────────
  const hasPendingCountdown = Object.keys(countdowns).length > 0;

  return (
    <div style={{
      borderRadius: 16,
      background: "linear-gradient(180deg, rgba(10,10,22,0.98) 0%, rgba(15,15,30,0.98) 100%)",
      border: "1px solid rgba(255,255,255,0.08)",
      overflow: "hidden",
      boxShadow: "0 16px 64px rgba(0,0,0,0.5)",
      marginBottom: 8,
    }}>

      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px",
        borderBottom: collapsed ? "none" : "1px solid rgba(255,255,255,0.06)",
        background: "rgba(255,255,255,0.02)",
        gap: 10, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 9, flexShrink: 0,
            background: "rgba(229,62,62,0.2)", border: "1px solid rgba(229,62,62,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Radio size={14} style={{ color: "#fc8181" }} />
          </div>
          <div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 12 }}>Control Room</div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#e53e3e", animation: "cr-pulse 1.2s infinite" }} />
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>
                {activeStreamCount} stream{activeStreamCount !== 1 ? "s" : ""} live
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setCollapsed(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "4px 9px", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer",
                  border: `1px solid ${activeTab === tab.id ? tab.accent : "rgba(255,255,255,0.07)"}`,
                  background: activeTab === tab.id ? `${tab.accent}20` : "transparent",
                  color: activeTab === tab.id ? "#fff" : "rgba(255,255,255,0.4)",
                  transition: "all 0.18s ease",
                  whiteSpace: "nowrap",
                }}
              >
                <span style={{ color: activeTab === tab.id ? tab.accent : "inherit", display: "flex" }}>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          <a
            href={stageUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "4px 10px", borderRadius: 7, fontSize: 11, fontWeight: 700,
              background: "rgba(229,62,62,0.15)", border: "1px solid rgba(229,62,62,0.35)",
              color: "#fc8181", textDecoration: "none", transition: "all 0.2s ease",
              whiteSpace: "nowrap",
            }}
          >
            <ExternalLink size={11} />
            Open Stage
          </a>

          <button
            onClick={() => setCollapsed((v) => !v)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 26, height: 26, borderRadius: 7,
              border: "1px solid rgba(255,255,255,0.07)",
              background: "rgba(255,255,255,0.03)",
              color: "rgba(255,255,255,0.4)", cursor: "pointer",
            }}
          >
            {collapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>
        </div>
      </div>

      {/* Panel body */}
      {!collapsed && (
        <div style={{ padding: "16px 18px", animation: "cr-slide-down 0.25s ease forwards" }}>

          {/* Staged changes banner */}
          {hasPendingCountdown && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 12,
              padding: "8px 12px", borderRadius: 8,
              background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.2)",
              fontSize: 11, color: "#fbbf24", fontWeight: 600,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fbbf24", animation: "cr-pulse 0.8s infinite" }} />
              Applying to live stream in progress…
            </div>
          )}

          {/* Desktop / Mobile toggle */}
          {positionTabs.includes(activeTab) && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <EditModeToggle mode={editMode} onChange={setEditMode} />
            </div>
          )}

          {/* ── AI CONTROLLER ── */}
          {activeTab === "ai" && (
            <AIPanel activeStreamCount={activeStreamCount} />
          )}

          {/* ── STATS ── */}
          {activeTab === "stats" && (
            <StatsPanel streams={activeStreams} streamStats={streamStats} procStats={streamProcStats} />
          )}

          {/* ── SUBS OVERLAY ── */}
          {activeTab === "subs" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {!hasSubs && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(204,0,1,0.06)", border: "1px solid rgba(204,0,1,0.18)", fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
                  No subscriber count yet. Add a YouTube source stream to pull live sub counts automatically.
                </div>
              )}

              {/* Style picker — 5 YouTube Live display styles */}
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Display Style</div>
                <StylePills styles={SUB_STYLES} current={bs.subsStyle} accent="#cc0001" onSelect={(s) => localUpdate({ subsStyle: s })} />
              </div>

              {/* Style preview description */}
              <div style={{ padding: "8px 12px", borderRadius: 7, background: "rgba(255,255,255,0.04)", fontSize: 11, color: "rgba(255,255,255,0.42)", lineHeight: 1.5 }}>
                {bs.subsStyle === "HUD"      && "Compact dark strip with red accent — minimal screen space, always visible."}
                {bs.subsStyle === "Minimal"  && "Floating white count with drop shadow — no background, blends with any scene."}
                {bs.subsStyle === "Animated" && "Dark card with pulsing red top bar and live dot — eye-catching but not distracting."}
                {bs.subsStyle === "Card"     && "YouTube-style badge with play-button icon — professional channel look."}
                {bs.subsStyle === "Goal"     && "Red progress bar toward your subscriber milestone — great for sub drives."}
              </div>

              {bs.subsStyle === "Goal" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Subscriber Goal</div>
                  <NumberInput
                    value={bs.subsGoal}
                    onChange={(v) => localUpdate({ subsGoal: v })}
                    placeholder="e.g. 1000000"
                  />
                </div>
              )}

              <PositionSliders
                pos={getPos("subsPosition")}
                label={`Position — ${editMode}`}
                accent="#cc0001"
                onChange={setPos("subsPosition")}
              />
              <SizeSlider value={bs.subsScale} onChange={(v) => localUpdate({ subsScale: v })} accent="#cc0001" />

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <ToggleButton
                  active={bs.subsOverlayActive}
                  accent="#cc0001"
                  countdownSecs={countdowns["subs"]}
                  onCancel={() => cancelGoLive("subs")}
                  onActivate={() => goLive("subs", {
                    subsOverlayActive: true,
                    subsStyle: bs.subsStyle,
                    subsPosition: bs.subsPosition,
                    mobileSubsPosition: bs.mobileSubsPosition,
                    subsGoal: bs.subsGoal,
                    subsScale: bs.subsScale,
                  })}
                  onDeactivate={() => stopOverlay({ subsOverlayActive: false })}
                />
                <LiveBadge label={`${bs.subsStyle} sub counter`} active={bs.subsOverlayActive} accent="#cc0001" />
              </div>

              <div style={{ padding: "9px 14px", borderRadius: 8, background: "rgba(204,0,1,0.05)", border: "1px solid rgba(204,0,1,0.12)", fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
                Style changes are staged — tap <strong style={{ color: "#cc0001" }}>Go Live</strong> to apply them with a 3-second countdown.
              </div>
            </div>
          )}

          {/* ── CHAT ── */}
          {activeTab === "chat" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.5 }}>
                Choose how live chat appears on the <strong style={{ color: "#fff" }}>Stage</strong> page (browser source for OBS).
              </div>
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Stage Chat Style</div>
                <StylePills
                  styles={CHAT_STYLES}
                  current={bs.chatStyle}
                  accent="#34d399"
                  onSelect={(s) => localUpdate({ chatStyle: s })}
                />
              </div>
              <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(52,211,153,0.07)", border: "1px solid rgba(52,211,153,0.2)" }}>
                <div style={{ fontSize: 11, color: "#34d399", fontWeight: 700, marginBottom: 4 }}>
                  {bs.chatStyle} — Staged
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", lineHeight: 1.5 }}>
                  {bs.chatStyle === "TV" && "Messages slide in from the right with a professional TV lower-third look."}
                  {bs.chatStyle === "Bubble" && "iMessage-style bubbles with spring animations."}
                  {bs.chatStyle === "Neon" && "Glowing neon-colored names on a dark background."}
                  {bs.chatStyle === "Glass" && "Glassmorphism frosted cards fading in from below."}
                  {bs.chatStyle === "Compact" && "Dense news-feed list, new messages flash on entry."}
                  {bs.chatStyle === "Toast" && "Notification toasts stacking from the right, newest on top."}
                </div>
              </div>
              <button
                onClick={() => update({ chatStyle: bs.chatStyle })}
                style={{
                  alignSelf: "flex-start", padding: "6px 18px", borderRadius: 8, fontSize: 11, fontWeight: 700,
                  cursor: "pointer", border: "1px solid rgba(52,211,153,0.45)",
                  background: "rgba(52,211,153,0.12)", color: "#34d399",
                }}
              >
                Apply Style to Stage
              </button>

              <SectionDivider label="Burn chat into stream" />

              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.5 }}>
                Burn chat messages directly into the video so viewers on <strong style={{ color: "#fff" }}>YouTube &amp; Facebook</strong> see them.
              </div>
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Chat Burn Style
                  {editMode === "mobile" && (
                    <span style={{ marginLeft: 6, color: "#a78bfa", fontWeight: 500 }}>(mobile layout applies)</span>
                  )}
                </div>
                <StylePills styles={CHAT_BURN_STYLES} current={bs.chatBurnStyle} accent="#34d399" onSelect={(s) => localUpdate({ chatBurnStyle: s })} />
              </div>

              <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.14)", fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
                {bs.chatBurnStyle === "Bubble" && (
                  <>Messenger-style bubbles · {editMode === "mobile" ? <strong style={{ color: "#34d399" }}>mobile: full-width bubbles with colour accent bar</strong> : "avatar + name + message · last 4 messages"}</>
                )}
                {bs.chatBurnStyle === "Float" && "TikTok-style · messages float upward and fade out over 5 s"}
                {bs.chatBurnStyle === "Sidebar" && (
                  <>Vertical panel · {editMode === "mobile" ? <strong style={{ color: "#34d399" }}>mobile: wide panel suited for portrait canvas</strong> : "YouTube-style feed · last 8 messages"}</>
                )}
                {bs.chatBurnStyle === "Highlight" && "Large centered popup · shows the latest single message prominently"}
                {bs.chatBurnStyle === "Ticker" && "Horizontal scrolling bar · all recent messages as a news-ticker feed"}
              </div>

              <PositionSliders
                pos={getPos("chatBurnPosition")}
                label={`Chat burn position — ${editMode}`}
                accent="#34d399"
                onChange={setPos("chatBurnPosition")}
              />
              <SizeSlider value={bs.chatBurnScale} onChange={(v) => localUpdate({ chatBurnScale: v })} accent="#34d399" />

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <ToggleButton
                  active={bs.chatBurnActive}
                  accent="#34d399"
                  countdownSecs={countdowns["chat"]}
                  onCancel={() => cancelGoLive("chat")}
                  onActivate={() => goLive("chat", {
                    chatBurnActive: true,
                    chatBurnStyle: bs.chatBurnStyle,
                    chatBurnPosition: bs.chatBurnPosition,
                    mobileChatBurnPosition: bs.mobileChatBurnPosition,
                    chatBurnScale: bs.chatBurnScale,
                  })}
                  onDeactivate={() => stopOverlay({ chatBurnActive: false })}
                />
                <LiveBadge label={`${bs.chatBurnStyle} chat burn`} active={bs.chatBurnActive} accent="#34d399" />
              </div>
            </div>
          )}

          {/* ── NEWS ── */}
          {activeTab === "news" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <TextInput
                value={bs.newsText}
                onChange={(v) => localUpdate({ newsText: v })}
                placeholder="News headline / scrolling text…"
              />
              <TextInput
                value={bs.newsTitle}
                onChange={(v) => localUpdate({ newsTitle: v })}
                placeholder="Title label (e.g. BREAKING, SPORTS, your channel name)…"
              />
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>Accent Color</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="color"
                    value={bs.newsBgColor}
                    onChange={(e) => localUpdate({ newsBgColor: e.target.value })}
                    style={{ width: 34, height: 28, borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", cursor: "pointer", background: "none" }}
                  />
                  <span style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,0.5)" }}>{bs.newsBgColor}</span>
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {["#cc0001","#0057ff","#00a651","#f59e0b","#7c3aed","#000000"].map((c) => (
                    <button key={c} onClick={() => localUpdate({ newsBgColor: c })} style={{
                      width: 18, height: 18, borderRadius: 4, background: c, border: `2px solid ${bs.newsBgColor === c ? "#fff" : "transparent"}`, cursor: "pointer",
                    }} />
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Style</div>
                <StylePills styles={NEWS_STYLES} current={bs.newsStyle} accent="#667eea" onSelect={(s) => localUpdate({ newsStyle: s })} />
              </div>

              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Entry Animation
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {NEWS_ANIMATIONS.map((anim) => {
                    const isCharAnim = ["Typewriter", "Pop-in", "Letter Fade", "Bounce", "Reveal"].includes(anim);
                    const isSlideAnim = ["→", "←", "↓", "↙", "↗"].includes(anim);
                    const accent = isCharAnim ? "#a78bfa" : isSlideAnim ? "#34d399" : "#667eea";
                    const active = bs.newsAnimation === anim;
                    return (
                      <button
                        key={anim}
                        onClick={() => localUpdate({ newsAnimation: anim })}
                        title={isCharAnim ? "Character-level" : isSlideAnim ? "Slide" : "Overlay"}
                        style={{
                          padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer",
                          border: `1px solid ${active ? accent : "rgba(255,255,255,0.1)"}`,
                          background: active ? `${accent}22` : "transparent",
                          color: active ? "#fff" : "rgba(255,255,255,0.45)",
                          transition: "all 0.18s ease", fontFamily: "inherit",
                        }}
                      >
                        {anim}
                      </button>
                    );
                  })}
                </div>
                <div style={{ marginTop: 6, fontSize: 10, color: "rgba(255,255,255,0.25)", lineHeight: 1.5 }}>
                  <span style={{ color: "rgba(52,211,153,0.7)" }}>Arrows</span> = whole-bar slide &nbsp;·&nbsp;
                  <span style={{ color: "rgba(167,139,250,0.7)" }}>Text effects</span> = character-level animation
                </div>
              </div>

              <PositionSliders
                pos={getPos("newsPosition")}
                label={`Position — ${editMode}`}
                accent="#667eea"
                onChange={setPos("newsPosition")}
              />
              <SizeSlider value={bs.newsScale} onChange={(v) => localUpdate({ newsScale: v })} accent="#667eea" />
              <div style={{ padding: "8px 12px", borderRadius: 7, background: "rgba(102,126,234,0.06)", border: "1px solid rgba(102,126,234,0.15)", fontSize: 11, color: "rgba(255,255,255,0.38)", lineHeight: 1.5 }}>
                Text, style, and animation are staged — applied when you tap <strong style={{ color: "#667eea" }}>Go Live</strong>.
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <ToggleButton
                  active={bs.newsActive}
                  accent="#667eea"
                  countdownSecs={countdowns["news"]}
                  onCancel={() => cancelGoLive("news")}
                  onActivate={() => goLive("news", {
                    newsActive: true,
                    newsText: bs.newsText,
                    newsTitle: bs.newsTitle,
                    newsBgColor: bs.newsBgColor,
                    newsStyle: bs.newsStyle,
                    newsAnimation: bs.newsAnimation,
                    newsPosition: bs.newsPosition,
                    mobileNewsPosition: bs.mobileNewsPosition,
                    newsScale: bs.newsScale,
                  })}
                  onDeactivate={() => stopOverlay({ newsActive: false })}
                />
                <LiveBadge label={`${bs.newsStyle} ticker`} active={bs.newsActive} accent="#667eea" />
              </div>
            </div>
          )}

          {/* ── ALERTS ── */}
          {activeTab === "alerts" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

              {/* ── GUEST NAME TAG ── */}
              <SectionDivider label="Guest Name Tag" />
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.5 }}>
                Show a lower-third name tag for a guest speaker or featured viewer.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <TextInput value={bs.guestName} onChange={(v) => localUpdate({ guestName: v })} placeholder="Guest name…" />
                <TextInput value={bs.guestTitle} onChange={(v) => localUpdate({ guestTitle: v })} placeholder="Title / channel…" />
              </div>
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Tag Style</div>
                <StylePills styles={GUEST_STYLES} current={bs.guestStyle} accent="#f97316" onSelect={(s) => localUpdate({ guestStyle: s })} />
              </div>
              <PositionSliders
                pos={getPos("guestPosition")}
                label={`Position — ${editMode}`}
                accent="#f97316"
                onChange={setPos("guestPosition")}
              />
              <SizeSlider value={bs.guestScale} onChange={(v) => localUpdate({ guestScale: v })} accent="#f97316" />
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <ToggleButton
                  active={bs.guestNameActive}
                  accent="#f97316"
                  countdownSecs={countdowns["guest"]}
                  onCancel={() => cancelGoLive("guest")}
                  onActivate={() => goLive("guest", {
                    guestNameActive: true,
                    guestName: bs.guestName,
                    guestTitle: bs.guestTitle,
                    guestStyle: bs.guestStyle,
                    guestPosition: bs.guestPosition,
                    mobileGuestPosition: bs.mobileGuestPosition,
                    guestScale: bs.guestScale,
                  })}
                  onDeactivate={() => stopOverlay({ guestNameActive: false })}
                />
                <LiveBadge label={`${bs.guestStyle} name tag`} active={bs.guestNameActive} accent="#f97316" />
              </div>

              {/* ── SUB MILESTONE ALERT ── */}
              <SectionDivider label="Subscriber Alert" />
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.5 }}>
                Flash a 5-second alert banner on the stream for subscriber milestones.
              </div>
              <TextInput
                value={bs.subAlertMessage}
                onChange={(v) => localUpdate({ subAlertMessage: v })}
                placeholder="🎉 Just hit 100K subscribers!"
              />
              <button
                onClick={() => update({ subAlertActive: true, subAlertMessage: bs.subAlertMessage })}
                disabled={!bs.subAlertMessage.trim()}
                style={{
                  alignSelf: "flex-start", padding: "6px 16px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
                  border: "1px solid #f97316", background: "rgba(249,115,22,0.15)", color: "#fed7aa",
                  opacity: bs.subAlertMessage.trim() ? 1 : 0.4, transition: "all 0.18s ease",
                }}
              >
                🔔 Fire Alert Now
              </button>

              {/* ── SUB CHART SPARKLINE ── */}
              <SectionDivider label="Subscriber Sparkline Chart" />
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.5 }}>
                Show a live sparkline of subscriber count history. Data samples automatically when YouTube stats are available.
              </div>
              <PositionSliders
                pos={getPos("subChartPosition")}
                label={`Position — ${editMode}`}
                accent="#f97316"
                onChange={setPos("subChartPosition")}
              />
              <SizeSlider value={bs.subChartScale} onChange={(v) => localUpdate({ subChartScale: v })} accent="#f97316" />
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <ToggleButton
                  active={bs.subChartActive}
                  accent="#f97316"
                  countdownSecs={countdowns["subChart"]}
                  onCancel={() => cancelGoLive("subChart")}
                  onActivate={() => goLive("subChart", {
                    subChartActive: true,
                    subChartPosition: bs.subChartPosition,
                    mobileSubChartPosition: bs.mobileSubChartPosition,
                    subChartScale: bs.subChartScale,
                  })}
                  onDeactivate={() => stopOverlay({ subChartActive: false })}
                />
                <LiveBadge label="Subscriber sparkline" active={bs.subChartActive} accent="#f97316" />
              </div>

              {/* ── SUPER CHAT ── */}
              <SectionDivider label="Super Chat" />
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.5 }}>
                Manually fire a Super Chat notification or let them appear automatically from YouTube chat. Notifications display for 9 seconds.
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <TextInput value={superChatForm.user} onChange={(v) => setSuperChatForm((p) => ({ ...p, user: v }))} placeholder="Username…" />
                <TextInput value={superChatForm.amount} onChange={(v) => setSuperChatForm((p) => ({ ...p, amount: v }))} placeholder="Amount (e.g. 20)…" />
              </div>
              <TextInput value={superChatForm.text} onChange={(v) => setSuperChatForm((p) => ({ ...p, text: v }))} placeholder="Message (optional)…" />
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {superChatForm.amount && (
                  <div style={{
                    width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
                    background: superChatColor(parseFloat(superChatForm.amount) || 0),
                    border: "1px solid rgba(255,255,255,0.2)",
                  }} />
                )}
                <button
                  onClick={fireSuperChat}
                  disabled={!superChatForm.user.trim()}
                  style={{
                    padding: "6px 16px", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer",
                    border: "1px solid #f97316", background: "rgba(249,115,22,0.15)", color: "#fed7aa",
                    opacity: superChatForm.user.trim() ? 1 : 0.4, transition: "all 0.18s ease",
                  }}
                >
                  💬 Fire Super Chat
                </button>
                {bs.superChatMessages.length > 0 && (
                  <button
                    onClick={() => update({ superChatMessages: [] })}
                    style={{
                      padding: "4px 10px", borderRadius: 8, fontSize: 11, cursor: "pointer",
                      border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(255,255,255,0.4)",
                    }}
                  >
                    Clear all
                  </button>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {SUPERCHAT_TIERS.map((t) => (
                  <div key={t.label} style={{
                    display: "flex", alignItems: "center", gap: 4,
                    padding: "2px 8px", borderRadius: 20, fontSize: 10,
                    background: `${t.color}22`, border: `1px solid ${t.color}66`, color: "#fff", fontWeight: 600,
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: t.color }} />
                    {t.label}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── ADS ── */}
          {activeTab === "ads" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <TextInput value={bs.adText} onChange={(v) => localUpdate({ adText: v })} placeholder="Ad headline…" />
              <TextInput value={bs.adSub} onChange={(v) => localUpdate({ adSub: v })} placeholder="Sub-caption (e.g. use code LIVE)…" />
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em" }}>Style</div>
                <StylePills styles={AD_STYLES} current={bs.adStyle} accent="#f093fb" onSelect={(s) => localUpdate({ adStyle: s })} />
              </div>
              <PositionSliders
                pos={getPos("adPosition")}
                label={`Position — ${editMode}`}
                accent="#f093fb"
                onChange={setPos("adPosition")}
              />
              <SizeSlider value={bs.adScale} onChange={(v) => localUpdate({ adScale: v })} accent="#f093fb" />
              <div style={{ padding: "8px 12px", borderRadius: 7, background: "rgba(240,147,251,0.06)", border: "1px solid rgba(240,147,251,0.15)", fontSize: 11, color: "rgba(255,255,255,0.38)", lineHeight: 1.5 }}>
                Text and style are staged — applied when you tap <strong style={{ color: "#f093fb" }}>Go Live</strong>.
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <ToggleButton
                  active={bs.adActive}
                  accent="#f093fb"
                  countdownSecs={countdowns["ads"]}
                  onCancel={() => cancelGoLive("ads")}
                  onActivate={() => goLive("ads", {
                    adActive: true,
                    adText: bs.adText,
                    adSub: bs.adSub,
                    adStyle: bs.adStyle,
                    adPosition: bs.adPosition,
                    mobileAdPosition: bs.mobileAdPosition,
                    adScale: bs.adScale,
                  })}
                  onDeactivate={() => stopOverlay({ adActive: false })}
                />
                <LiveBadge label={`${bs.adStyle} ad`} active={bs.adActive} accent="#f093fb" />
              </div>
            </div>
          )}

          {/* ── BREAK ── */}
          {activeTab === "break" && (
            <BreakPanel
              bs={bs}
              localUpdate={localUpdate}
              update={update}
              goLive={goLive}
              cancelGoLive={cancelGoLive}
              stopOverlay={stopOverlay}
              countdowns={countdowns}
              activeStreamCount={activeStreamCount}
            />
          )}

          {/* ── BACKGROUND GRADIENT ── */}
          {activeTab === "bg" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 12, lineHeight: 1.6 }}>
                Add a gradient behind the video — visible in the letterbox bars when the source doesn't fill the full frame. Does not affect the video content itself.
              </div>

              {/* Gradient preview swatch */}
              <div style={{
                borderRadius: 12, overflow: "hidden", height: 72, position: "relative",
                background: `linear-gradient(135deg, ${bs.bgGradient1}, ${bs.bgGradient2})`,
                border: `1px solid ${bs.bgGradientActive ? "rgba(251,113,133,0.5)" : "rgba(255,255,255,0.1)"}`,
                transition: "border-color 0.3s ease",
              }}>
                {!bs.bgGradientActive && (
                  <div style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    background: "rgba(0,0,0,0.45)",
                    fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: 600,
                  }}>
                    Preview — tap Go Live to activate
                  </div>
                )}
              </div>

              {/* Color pickers */}
              <div style={{ display: "flex", gap: 10 }}>
                {(["bgGradient1", "bgGradient2"] as const).map((field, i) => (
                  <div key={field} style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                      Colour {i + 1}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input
                        type="color"
                        value={(bs as any)[field]}
                        onChange={(e) => (bs.bgGradientActive ? update : localUpdate)({ [field]: e.target.value } as any)}
                        style={{ width: 36, height: 32, borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)", cursor: "pointer", padding: 2 }}
                      />
                      <span style={{ fontSize: 11, fontFamily: "monospace", color: "rgba(255,255,255,0.5)" }}>
                        {(bs as any)[field]}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Opacity slider */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  Opacity (in bars)
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="range"
                    min={0.1} max={1} step={0.05}
                    value={bs.bgGradientOpacity}
                    onChange={(e) => (bs.bgGradientActive ? update : localUpdate)({ bgGradientOpacity: Number(e.target.value) })}
                    style={{ flex: 1, accentColor: "#fb7185", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", width: 36, textAlign: "right" }}>
                    {Math.round(bs.bgGradientOpacity * 100)}%
                  </span>
                </div>
              </div>

              <SectionDivider label="Quick presets" />

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[
                  { label: "Midnight", c1: "#0f0c29", c2: "#302b63" },
                  { label: "Sunset",   c1: "#f7971e", c2: "#c71d6f" },
                  { label: "Ocean",    c1: "#0f2027", c2: "#2c5364" },
                  { label: "Forest",   c1: "#134e5e", c2: "#71b280" },
                  { label: "Lava",     c1: "#200122", c2: "#6f0000" },
                  { label: "Neon",     c1: "#08004a", c2: "#0057ff" },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => localUpdate({ bgGradient1: preset.c1, bgGradient2: preset.c2 })}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "4px 10px", borderRadius: 20, cursor: "pointer",
                      border: "1px solid rgba(255,255,255,0.1)",
                      background: "transparent",
                      color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 600,
                      transition: "all 0.18s ease",
                    }}
                  >
                    <div style={{
                      width: 12, height: 12, borderRadius: "50%",
                      background: `linear-gradient(135deg, ${preset.c1}, ${preset.c2})`,
                      border: "1px solid rgba(255,255,255,0.2)",
                    }} />
                    {preset.label}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <ToggleButton
                  active={bs.bgGradientActive}
                  accent="#fb7185"
                  countdownSecs={countdowns["bg"]}
                  onCancel={() => cancelGoLive("bg")}
                  onActivate={() => goLive("bg", {
                    bgGradientActive: true,
                    bgGradient1: bs.bgGradient1,
                    bgGradient2: bs.bgGradient2,
                    bgGradientOpacity: bs.bgGradientOpacity,
                  })}
                  onDeactivate={() => stopOverlay({ bgGradientActive: false })}
                />
                <LiveBadge label="Background gradient" active={bs.bgGradientActive} accent="#fb7185" />
              </div>

              <div style={{ padding: "9px 14px", borderRadius: 8, background: "rgba(251,113,133,0.06)", border: "1px solid rgba(251,113,133,0.15)", fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
                The gradient fills the background pipe behind the video. It is visible in letterbox bars (e.g. when a portrait source is streamed to a landscape output). Break screens always cover the entire frame and take precedence.
              </div>
            </div>
          )}

          {/* ── QR / SuperChat Overlay tab ───────────────────────────────── */}
          {activeTab === "qr" && (() => {
            const qrPreviewSrc = qrGatewayUrl
              ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrGatewayUrl)}&margin=1&color=1a1a1a&bgcolor=ffffff&ecc=M`
              : "";
            const toggleOnStream = () => {
              if (!qrGatewayUrl) return;
              if (bs.qrActive) {
                localUpdate({ qrActive: false });
                update({ qrActive: false });
              } else {
                localUpdate({ qrActive: true, qrUrl: qrGatewayUrl });
                update({ qrActive: true, qrUrl: qrGatewayUrl, qrSize: bs.qrSize, qrPosition: bs.qrPosition });
              }
            };
            return (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

              {/* Header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderRadius: 12,
                background: "linear-gradient(135deg, rgba(255,214,0,0.14) 0%, rgba(255,170,0,0.08) 100%)",
                border: "1px solid rgba(255,214,0,0.3)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20 }}>💛</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 900, color: "#ffd600", letterSpacing: "0.03em" }}>SuperChat QR Overlay</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>Viewer scans → pays → gift plays on stream</div>
                  </div>
                </div>
                <button onClick={() => void fetchQrGatewayUrl()} title="Refresh URL" style={{ background: "transparent", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)", padding: 4 }}>
                  <RefreshCw size={12} style={{ animation: qrGatewayLoading ? "cr-spin 1s linear infinite" : "none" }} />
                </button>
              </div>

              {/* Broadcast overlay info box */}
              <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)", fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
                📺 <strong style={{ color: "rgba(255,255,255,0.75)" }}>Viewers see the QR via your broadcast overlay.</strong> In OBS, add a Browser Source pointing to your <code style={{ color: "#a5b4fc" }}>/broadcast</code> URL — the Super Chat card appears automatically when you activate it.
              </div>

              {/* QR preview */}
              {qrGatewayLoading && (
                <div style={{ display: "flex", justifyContent: "center", padding: "24px 0" }}>
                  <RefreshCw size={22} style={{ animation: "cr-spin 1s linear infinite", color: "#ffd600" }} />
                </div>
              )}
              {!qrGatewayLoading && !qrGatewayUrl && (
                <div style={{ padding: "16px", borderRadius: 10, background: "rgba(255,80,80,0.07)", border: "1px solid rgba(255,80,80,0.2)", textAlign: "center", fontSize: 11, color: "rgba(255,120,120,0.8)" }}>
                  ⚠ Gateway URL not configured — check <code style={{ color: "#fca5a5" }}>/api/gateway/url</code>
                </div>
              )}
              {!qrGatewayLoading && qrGatewayUrl && (
                <div style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "14px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  {/* QR thumbnail */}
                  <div style={{ padding: 8, borderRadius: 10, background: "#fff", boxShadow: "0 0 0 3px #ffd600, 0 4px 16px rgba(0,0,0,0.5)", flexShrink: 0 }}>
                    <img
                      src={qrPreviewSrc}
                      alt="SuperChat QR"
                      style={{ width: 96, height: 96, display: "block" }}
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "#ffd600", textTransform: "uppercase", letterSpacing: "0.08em" }}>💛 Super Chat QR</div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", wordBreak: "break-all", lineHeight: 1.4 }}>{qrGatewayUrl}</div>

                    {/* Scan + thank-you badges */}
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 2 }}>
                      {bs.qrScanCount > 0 && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 99, background: "rgba(6,182,212,0.15)", border: "1px solid rgba(6,182,212,0.35)", fontSize: 10, fontWeight: 700, color: "#67e8f9" }}>
                          👁 {bs.qrScanCount} scan{bs.qrScanCount !== 1 ? "s" : ""}
                        </span>
                      )}
                      {bs.qrThankYouName && (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 99, background: "rgba(255,214,0,0.15)", border: "1px solid rgba(255,214,0,0.35)", fontSize: 10, fontWeight: 700, color: "#ffd600" }}>
                          🎉 {bs.qrThankYouName}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Show / Hide on stream */}
              <button
                disabled={!qrGatewayUrl}
                onClick={toggleOnStream}
                style={{
                  width: "100%", padding: "12px", borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: qrGatewayUrl ? "pointer" : "not-allowed",
                  border: `1px solid ${bs.qrActive ? "#ffd600" : "rgba(255,255,255,0.15)"}`,
                  background: bs.qrActive ? "linear-gradient(135deg, rgba(255,214,0,0.25), rgba(255,170,0,0.18))" : "rgba(255,255,255,0.06)",
                  color: bs.qrActive ? "#ffd600" : "rgba(255,255,255,0.55)",
                  transition: "all 0.2s",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  opacity: qrGatewayUrl ? 1 : 0.4,
                }}
              >
                <span style={{ fontSize: 16 }}>📺</span>
                {bs.qrActive ? "Showing on Stream — tap to Hide" : "Show SuperChat QR on Stream"}
              </button>

              {/* Size slider */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.07em" }}>QR Size</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#67e8f9" }}>{bs.qrSize ?? 180}px</div>
                </div>
                <input type="range" min={80} max={400} step={10}
                  value={bs.qrSize ?? 180}
                  disabled={qrLocked}
                  onChange={(e) => {
                    const v = parseInt(e.target.value);
                    localUpdate({ qrSize: v });
                  }}
                  onMouseUp={(e) => {
                    const v = parseInt((e.target as HTMLInputElement).value);
                    update({ qrSize: v, qrUrl: qrGatewayUrl });
                  }}
                  style={{ width: "100%", accentColor: "#06b6d4", cursor: qrLocked ? "not-allowed" : "pointer" }}
                />
              </div>

              {/* Corner presets + lock */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Quick Position</div>
                  <button
                    onClick={() => setQrLocked(l => !l)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: "pointer",
                      border: `1px solid ${qrLocked ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.12)"}`,
                      background: qrLocked ? "rgba(239,68,68,0.12)" : "rgba(255,255,255,0.04)",
                      color: qrLocked ? "#fca5a5" : "rgba(255,255,255,0.4)",
                    }}
                  >
                    {qrLocked ? "🔒 Locked" : "🔓 Lock"}
                  </button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                  {[
                    { label: "↖ Top-Left",    pos: { x: 8,  y: 8  } },
                    { label: "↗ Top-Right",   pos: { x: 88, y: 8  } },
                    { label: "↙ Bot-Left",    pos: { x: 8,  y: 80 } },
                    { label: "↘ Bot-Right",   pos: { x: 88, y: 80 } },
                  ].map(preset => {
                    const isActive = Math.abs((bs.qrPosition?.x ?? 88) - preset.pos.x) < 4 && Math.abs((bs.qrPosition?.y ?? 8) - preset.pos.y) < 4;
                    return (
                      <button
                        key={preset.label}
                        disabled={qrLocked}
                        onClick={() => {
                          localUpdate({ qrPosition: preset.pos });
                          if (qrPosDebRef.current) clearTimeout(qrPosDebRef.current);
                          qrPosDebRef.current = setTimeout(() => update({ qrPosition: preset.pos }), 300);
                        }}
                        style={{
                          padding: "6px 8px", borderRadius: 8, fontSize: 10, fontWeight: 700,
                          cursor: qrLocked ? "not-allowed" : "pointer",
                          border: `1px solid ${isActive ? "#06b6d4" : "rgba(255,255,255,0.10)"}`,
                          background: isActive ? "rgba(6,182,212,0.18)" : "rgba(255,255,255,0.04)",
                          color: isActive ? "#67e8f9" : "rgba(255,255,255,0.4)",
                          transition: "all 0.15s",
                        }}
                      >{preset.label}</button>
                    );
                  })}
                </div>
              </div>

              {/* X / Y fine sliders */}
              {["x", "y"].map(axis => (
                <div key={axis}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Position {axis.toUpperCase()}</div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#67e8f9" }}>{Math.round((bs.qrPosition?.[axis as "x"|"y"] ?? (axis === "x" ? 88 : 8)))}%</div>
                  </div>
                  <input type="range" min={0} max={100} step={1}
                    value={bs.qrPosition?.[axis as "x"|"y"] ?? (axis === "x" ? 88 : 8)}
                    disabled={qrLocked}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      const next = { ...(bs.qrPosition ?? { x: 88, y: 8 }), [axis]: v };
                      localUpdate({ qrPosition: next });
                    }}
                    onMouseUp={(e) => {
                      const v = parseInt((e.target as HTMLInputElement).value);
                      const next = { ...(bs.qrPosition ?? { x: 88, y: 8 }), [axis]: v };
                      if (qrPosDebRef.current) clearTimeout(qrPosDebRef.current);
                      qrPosDebRef.current = setTimeout(() => update({ qrPosition: next }), 200);
                    }}
                    style={{ width: "100%", accentColor: "#06b6d4", cursor: qrLocked ? "not-allowed" : "pointer" }}
                  />
                </div>
              ))}

              {/* Glow intensity */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.07em" }}>✨ Glow Intensity</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#ffd600" }}>{bs.qrGlowIntensity ?? 0}%</div>
                </div>
                <input type="range" min={0} max={100} step={5}
                  value={bs.qrGlowIntensity ?? 0}
                  onChange={(e) => { const v = parseInt(e.target.value); localUpdate({ qrGlowIntensity: v }); }}
                  onMouseUp={(e) => { const v = parseInt((e.target as HTMLInputElement).value); update({ qrGlowIntensity: v }); }}
                  style={{ width: "100%", accentColor: "#ffd600" }}
                />
              </div>

              {/* Border style */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Border Style</div>
                <div style={{ display: "flex", gap: 5 }}>
                  {[
                    { id: "solid",  label: "— Solid"  },
                    { id: "glow",   label: "✦ Glow"   },
                    { id: "dashed", label: "--- Dashed" },
                    { id: "none",   label: "✕ None"   },
                  ].map(b => (
                    <button
                      key={b.id}
                      onClick={() => { localUpdate({ qrBorderStyle: b.id }); update({ qrBorderStyle: b.id }); }}
                      style={{
                        flex: 1, padding: "5px 3px", borderRadius: 7, fontSize: 9, fontWeight: 700, cursor: "pointer",
                        border: `1px solid ${bs.qrBorderStyle === b.id ? "#ffd600" : "rgba(255,255,255,0.10)"}`,
                        background: bs.qrBorderStyle === b.id ? "rgba(255,214,0,0.18)" : "rgba(255,255,255,0.04)",
                        color: bs.qrBorderStyle === b.id ? "#ffd600" : "rgba(255,255,255,0.4)",
                        transition: "all 0.15s",
                      }}
                    >{b.label}</button>
                  ))}
                </div>
              </div>

              {/* Animation style */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Animation</div>
                <div style={{ display: "flex", gap: 5 }}>
                  {[
                    { id: "pulse", label: "💓 Pulse" },
                    { id: "float", label: "🌊 Float" },
                    { id: "none",  label: "⏸ Static" },
                  ].map(anim => (
                    <button
                      key={anim.id}
                      onClick={() => { localUpdate({ qrAnimation: anim.id }); update({ qrAnimation: anim.id }); }}
                      style={{
                        flex: 1, padding: "5px 4px", borderRadius: 7, fontSize: 10, fontWeight: 700, cursor: "pointer",
                        border: `1px solid ${bs.qrAnimation === anim.id ? "#06b6d4" : "rgba(255,255,255,0.10)"}`,
                        background: bs.qrAnimation === anim.id ? "rgba(6,182,212,0.18)" : "rgba(255,255,255,0.04)",
                        color: bs.qrAnimation === anim.id ? "#67e8f9" : "rgba(255,255,255,0.4)",
                        transition: "all 0.15s",
                      }}
                    >{anim.label}</button>
                  ))}
                </div>
              </div>

            </div>
            );
          })()}


          {/* ── Donate tab ───────────────────────────────────────────────── */}
          {activeTab === "donate" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

              {/* Overlay toggles */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(
                  [
                    { label: "⚡ SuperChat Alert Popup", key: "donationAlertActive" as const, hint: "Animated pop-up when a SuperChat arrives" },
                    { label: "📊 SuperChat Ticker Bar",  key: "donationTickerActive" as const, hint: "Scrolling ticker showing latest supporters" },
                  ] as const
                ).map(({ label, key, hint }) => (
                  <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#fff" }}>{label}</div>
                      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{hint}</div>
                    </div>
                    <div
                      onClick={() => {
                        const next = !bs[key];
                        localUpdate({ [key]: next } as Partial<BroadcastState>);
                        update({ [key]: next } as Partial<BroadcastState>);
                      }}
                      style={{
                        width: 38, height: 20, borderRadius: 999, cursor: "pointer", position: "relative", flexShrink: 0,
                        background: bs[key] ? "#22c55e" : "rgba(255,255,255,0.12)",
                        transition: "background 0.2s",
                      }}
                    >
                      <div style={{
                        position: "absolute", top: 2, left: bs[key] ? 20 : 2, width: 16, height: 16,
                        borderRadius: "50%", background: "#fff", transition: "left 0.2s",
                      }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* DonationPanel — live feed + QR + stats */}
              <DonationPanel
                latestDonation={latestDonation}
                donationTickerActive={bs.donationTickerActive}
                donationAlertActive={bs.donationAlertActive}
                onToggleTicker={(active) => { localUpdate({ donationTickerActive: active }); update({ donationTickerActive: active }); }}
                onToggleAlert={(active) => { localUpdate({ donationAlertActive: active }); update({ donationAlertActive: active }); }}
              />

              <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(34,197,94,0.04)", border: "1px solid rgba(34,197,94,0.12)", fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
                SuperChats are collected via the public <strong style={{ color: "#22c55e" }}>/gateway-payment</strong> page. Share the QR code from the QR tab or copy the link directly from the SuperChat panel.
              </div>
            </div>
          )}

          {/* ── Screen Share tab ─────────────────────────────────────── */}
          {activeTab === "screen" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

              {/* Mobile / iframe / no-API guards */}
              {/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", borderRadius: 12, background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.3)" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>📵</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#fde68a", marginBottom: 4 }}>Not supported on mobile</div>
                      <div style={{ fontSize: 12, color: "rgba(253,230,138,0.7)", lineHeight: 1.6 }}>
                        Screen capture requires a desktop browser (Chrome, Firefox, or Edge on Windows/Mac/Linux). Mobile browsers do not support this feature.
                      </div>
                    </div>
                  </div>
                </div>
              ) : typeof navigator.mediaDevices?.getDisplayMedia !== "function" ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", borderRadius: 12, background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.3)" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>⚠️</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#fde68a", marginBottom: 4 }}>Open in a real browser tab</div>
                      <div style={{ fontSize: 12, color: "rgba(253,230,138,0.7)", lineHeight: 1.6 }}>
                        Screen capture is blocked inside embedded frames. Click the button below to open the dashboard in its own tab, then come back to this Screen tab.
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => window.open(window.location.href, "_blank")}
                    style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: 6, padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: "pointer", border: "1px solid rgba(251,191,36,0.5)", background: "rgba(251,191,36,0.15)", color: "#fde68a" }}
                  >
                    <MonitorUp size={14} /> Open app in new tab →
                  </button>
                </div>
              ) : (
                <>
                  {/* Main control card */}
                  <div style={{
                    borderRadius: 14,
                    background: screenActive
                      ? "linear-gradient(135deg, rgba(129,140,248,0.12) 0%, rgba(99,102,241,0.08) 100%)"
                      : "rgba(255,255,255,0.02)",
                    border: `1px solid ${screenActive ? "rgba(129,140,248,0.35)" : "rgba(255,255,255,0.08)"}`,
                    padding: "16px",
                    display: "flex", flexDirection: "column", gap: 12,
                    transition: "all 0.25s ease",
                  }}>
                    {/* Status row */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                          background: screenActive ? "rgba(129,140,248,0.2)" : "rgba(255,255,255,0.05)",
                          border: `1px solid ${screenActive ? "rgba(129,140,248,0.4)" : "rgba(255,255,255,0.1)"}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}>
                          <MonitorUp size={16} color={screenActive ? "#a5b4fc" : "rgba(255,255,255,0.4)"} />
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: screenActive ? "#e0e7ff" : "rgba(255,255,255,0.7)" }}>
                            Screen Share
                          </div>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
                            {screenActive ? "Capturing & compositing at 24 fps" : "Captures your full screen as an overlay"}
                          </div>
                        </div>
                      </div>
                      {screenActive && (
                        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, background: "rgba(129,140,248,0.15)", border: "1px solid rgba(129,140,248,0.4)" }}>
                          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#818cf8", animation: "cr-pulse 1s infinite" }} />
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#a5b4fc", letterSpacing: "0.05em" }}>LIVE</span>
                        </div>
                      )}
                    </div>

                    {/* Live preview thumbnail */}
                    {screenPreviewUrl && (
                      <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid rgba(129,140,248,0.2)", background: "#000", position: "relative" }}>
                        <img src={screenPreviewUrl} alt="Screen preview" style={{ width: "100%", display: "block" }} />
                        <div style={{ position: "absolute", bottom: 6, right: 8, padding: "2px 7px", borderRadius: 5, background: "rgba(0,0,0,0.6)", fontSize: 10, color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>10 fps</div>
                      </div>
                    )}

                    {/* Start / Stop button */}
                    <button
                      onClick={screenActive ? stopScreenShare : startScreenShare}
                      disabled={screenConnecting}
                      style={{
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                        padding: "11px 0", borderRadius: 10, fontSize: 13, fontWeight: 700,
                        cursor: screenConnecting ? "default" : "pointer",
                        border: `1px solid ${screenActive ? "rgba(239,68,68,0.4)" : "rgba(129,140,248,0.5)"}`,
                        background: screenActive ? "rgba(239,68,68,0.1)" : "rgba(129,140,248,0.18)",
                        color: screenActive ? "#fca5a5" : "#a5b4fc",
                        transition: "all 0.2s ease",
                        opacity: screenConnecting ? 0.6 : 1,
                      }}
                    >
                      {screenConnecting
                        ? <><Loader2 size={15} style={{ animation: "cr-spin 1s linear infinite" }} /> Connecting to server…</>
                        : screenActive
                          ? <><MonitorUp size={15} /> Stop Screen Share</>
                          : <><MonitorUp size={15} /> Start Screen Share</>
                      }
                    </button>

                    {screenError && (
                      <div style={{ padding: "9px 12px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 12, color: "#fca5a5", lineHeight: 1.5 }}>
                        {screenError}
                      </div>
                    )}

                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
                      Clicking Start opens the browser's screen picker — select <strong style={{ color: "rgba(255,255,255,0.5)" }}>Entire Screen</strong> then click Share. Screen share automatically appears in your stream and stops when you close the share.
                    </div>
                  </div>

                  {/* Display mode selector */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "14px 16px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Display Mode</div>
                    <div style={{ display: "flex", gap: 6 }}>
                      {([
                        { mode: "presenter" as const, icon: "🖥️", label: "Presenter", desc: "Pro background" },
                        { mode: "fullscreen" as const, icon: "⬛", label: "Fullscreen", desc: "Fill the frame" },
                        { mode: "pip" as const,        icon: "📌", label: "PIP",        desc: "Corner overlay" },
                      ]).map(({ mode, icon, label, desc }) => (
                        <button
                          key={mode}
                          onClick={() => update({ screenShareMode: mode })}
                          style={{
                            flex: 1, padding: "9px 6px", borderRadius: 10, fontSize: 10, fontWeight: 700,
                            border: `1px solid ${bs.screenShareMode === mode ? "#818cf8" : "rgba(255,255,255,0.1)"}`,
                            background: bs.screenShareMode === mode ? "rgba(129,140,248,0.15)" : "rgba(255,255,255,0.03)",
                            color: bs.screenShareMode === mode ? "#a5b4fc" : "rgba(255,255,255,0.45)",
                            cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                            transition: "all 0.18s ease",
                          }}
                        >
                          <span style={{ fontSize: 15 }}>{icon}</span>
                          <span>{label}</span>
                          <span style={{ fontWeight: 400, fontSize: 9, opacity: 0.65 }}>{desc}</span>
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.5 }}>
                      {bs.screenShareMode === "presenter" && "Screen centred on a dark studio background with purple accent glow — great for tech demos and presentations."}
                      {bs.screenShareMode === "fullscreen" && "Screen fills the entire frame edge-to-edge, replacing the live video."}
                      {bs.screenShareMode === "pip" && "Floating picture-in-picture overlay. Drag the sliders below to position it."}
                    </div>
                  </div>

                  {/* PIP position controls — only shown in PIP mode */}
                  {bs.screenShareMode === "pip" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 16px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>PIP Position &amp; Size</div>
                    {[
                      { label: "X Position", key: "screenShareX" as const, min: 0, max: 95, unit: "%" },
                      { label: "Y Position", key: "screenShareY" as const, min: 0, max: 95, unit: "%" },
                      { label: "Width",      key: "screenShareW" as const, min: 5, max: 90, unit: "%" },
                      { label: "Corner Radius", key: "screenShareRadius" as const, min: 0, max: 60, unit: "px" },
                    ].map(({ label, key, min, max, unit }) => (
                      <div key={key}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{label}</span>
                          <span style={{ fontSize: 11, color: "#a5b4fc", fontWeight: 700 }}>{bs[key]}{unit}</span>
                        </div>
                        <input
                          type="range" min={min} max={max} step={1}
                          value={bs[key]}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            localUpdate({ [key]: val });
                            if (screenDebRef.current) clearTimeout(screenDebRef.current);
                            screenDebRef.current = setTimeout(() => update({ [key]: val } as any), 300);
                          }}
                          style={{ width: "100%", accentColor: "#818cf8", cursor: "pointer" }}
                        />
                      </div>
                    ))}
                  </div>
                  )}

                  {/* Corner radius for Presenter mode */}
                  {bs.screenShareMode === "presenter" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "14px 16px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Corner Radius</span>
                      <span style={{ fontSize: 11, color: "#a5b4fc", fontWeight: 700 }}>{bs.screenShareRadius}px</span>
                    </div>
                    <input
                      type="range" min={0} max={40} step={1}
                      value={bs.screenShareRadius}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        localUpdate({ screenShareRadius: val });
                        if (screenDebRef.current) clearTimeout(screenDebRef.current);
                        screenDebRef.current = setTimeout(() => update({ screenShareRadius: val }), 300);
                      }}
                      style={{ width: "100%", accentColor: "#818cf8", cursor: "pointer" }}
                    />
                  </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Music tab ────────────────────────────────────────────── */}
          {activeTab === "music" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

              {/* Hidden file input */}
              <input
                ref={musicFileInputRef}
                type="file"
                accept="audio/*"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  files.forEach((f) => {
                    const url = URL.createObjectURL(f);
                    setPlaylist((prev) => [...prev, { id: crypto.randomUUID(), title: f.name.replace(/\.[^.]+$/, ""), url, isFile: true }]);
                  });
                  e.target.value = "";
                }}
              />

              {/* ── Now Playing ── */}
              <div style={{
                borderRadius: 16,
                background: "linear-gradient(145deg, rgba(20,8,30,0.95) 0%, rgba(30,12,48,0.95) 100%)",
                border: "1px solid rgba(244,114,182,0.2)",
                padding: "16px",
                display: "flex", flexDirection: "column", gap: 12,
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              }}>
                {/* Album art + track info */}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: 12, flexShrink: 0,
                    background: "linear-gradient(135deg, rgba(244,114,182,0.25) 0%, rgba(168,85,247,0.25) 100%)",
                    border: "1px solid rgba(244,114,182,0.25)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    position: "relative", overflow: "hidden",
                  }}>
                    {musicPlaying ? (
                      <div style={{ display: "flex", gap: 2.5, alignItems: "flex-end", paddingBottom: 2 }}>
                        {[12, 20, 14, 22, 10, 18].map((h, i) => (
                          <div key={i} style={{
                            width: 3, borderRadius: 2, background: "#f472b6",
                            height: `${h}px`,
                            animation: `cr-pulse ${0.35 + i * 0.07}s ease-in-out infinite alternate`,
                          }} />
                        ))}
                      </div>
                    ) : (
                      <Music size={22} color="rgba(244,114,182,0.7)" />
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    {currentIdx !== null && playlist[currentIdx] ? (
                      <>
                        <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: -0.3 }}>
                          {playlist[currentIdx].title}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>
                            {playlist[currentIdx].isFile ? "📁 Local file" : "🎵 Stream"}
                          </div>
                          <span style={{ color: "rgba(255,255,255,0.15)", fontSize: 10 }}>·</span>
                          <div style={{ fontSize: 10, color: "rgba(244,114,182,0.7)", fontWeight: 600 }}>
                            {currentIdx + 1} / {playlist.length}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", fontStyle: "italic" }}>
                        No track selected
                      </div>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontVariantNumeric: "tabular-nums", width: 32, textAlign: "right", flexShrink: 0 }}>
                    {fmtTime(musicCurrentTime)}
                  </span>
                  <div
                    style={{ flex: 1, height: 5, borderRadius: 3, background: "rgba(255,255,255,0.08)", cursor: "pointer", position: "relative" }}
                    onClick={(e) => {
                      const el = musicAudioRef.current;
                      if (!el || !el.duration) return;
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                      el.currentTime = pct * el.duration;
                    }}
                  >
                    <div style={{ position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 3, background: "linear-gradient(90deg, #ec4899, #f472b6)", width: `${musicProgress * 100}%`, transition: "width 0.4s linear" }} />
                    {musicProgress > 0 && (
                      <div style={{
                        position: "absolute", top: "50%", left: `${musicProgress * 100}%`,
                        transform: "translate(-50%, -50%)",
                        width: 11, height: 11, borderRadius: "50%", background: "#fff",
                        boxShadow: "0 0 6px rgba(244,114,182,0.8)",
                      }} />
                    )}
                  </div>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontVariantNumeric: "tabular-nums", width: 32, flexShrink: 0 }}>
                    {fmtTime(musicDuration)}
                  </span>
                </div>

                {/* Controls */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16 }}>
                  <button
                    onClick={() => { if (playlist.length === 0) return; const idx = ((currentIdx ?? 0) - 1 + playlist.length) % playlist.length; playTrack(idx); }}
                    style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", cursor: "pointer", display: "flex", padding: 6, borderRadius: 8, transition: "color 0.15s" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#f9a8d4"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.45)"; }}
                  ><SkipBack size={20} /></button>

                  <button
                    onClick={() => {
                      if (currentIdx === null && playlist.length > 0) { playTrack(0); return; }
                      musicPlaying ? pauseTrack() : resumeTrack();
                    }}
                    style={{
                      width: 48, height: 48, borderRadius: "50%", border: "none", cursor: "pointer",
                      background: "linear-gradient(135deg, #ec4899 0%, #f472b6 100%)",
                      color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                      boxShadow: "0 4px 20px rgba(236,72,153,0.5)",
                      transition: "transform 0.15s, box-shadow 0.15s",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "scale(1.06)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "scale(1)"; }}
                  >
                    {musicPlaying ? <Pause size={20} /> : <Play size={20} />}
                  </button>

                  <button
                    onClick={() => { if (playlist.length === 0) return; const idx = ((currentIdx ?? 0) + 1) % playlist.length; playTrack(idx); }}
                    style={{ background: "none", border: "none", color: "rgba(255,255,255,0.45)", cursor: "pointer", display: "flex", padding: 6, borderRadius: 8, transition: "color 0.15s" }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#f9a8d4"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.45)"; }}
                  ><SkipForward size={20} /></button>
                </div>

                {/* Volume */}
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Volume2 size={12} color="rgba(255,255,255,0.3)" />
                  <input
                    type="range" min={0} max={100} step={1} value={musicVolume}
                    onChange={(e) => setMusicVolume(Number(e.target.value))}
                    style={{ flex: 1, accentColor: "#f472b6", cursor: "pointer", height: 4 }}
                  />
                  <span style={{ fontSize: 11, color: "#f472b6", fontWeight: 700, width: 30, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{musicVolume}%</span>
                </div>
              </div>

              {/* ── Mix to broadcast ── */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "11px 14px", borderRadius: 12,
                background: musicBroadcastActive ? "rgba(244,114,182,0.08)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${musicBroadcastActive ? "rgba(244,114,182,0.3)" : "rgba(255,255,255,0.07)"}`,
                transition: "all 0.2s",
              }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", display: "flex", alignItems: "center", gap: 6 }}>
                    <RadioIcon size={13} color="#f472b6" />
                    Mix to broadcast
                    {musicBroadcastActive && (
                      <span style={{ fontSize: 9, background: "#f472b6", color: "#fff", padding: "1px 6px", borderRadius: 99, fontWeight: 800, letterSpacing: 0.5 }}>LIVE</span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                    {musicBroadcastActive ? "Music routing into your RTMP stream" : "Send music audio into your RTMP stream"}
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (musicBroadcastActive) { stopMusicBroadcast(); }
                    else { setMusicBroadcast(true); startMusicBroadcast().catch(() => {}); }
                  }}
                  style={{
                    width: 44, height: 26, borderRadius: 13, cursor: "pointer", position: "relative",
                    background: musicBroadcastActive ? "#f472b6" : "rgba(255,255,255,0.1)",
                    border: "none", transition: "all 0.2s ease", flexShrink: 0,
                  }}
                >
                  <div style={{
                    position: "absolute", top: 3, left: musicBroadcastActive ? 21 : 3,
                    width: 20, height: 20, borderRadius: "50%", background: "#fff",
                    transition: "left 0.2s ease", boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                  }} />
                </button>
              </div>

              {/* ── Error display ── */}
              {musicError && (
                <div style={{
                  padding: "10px 12px", borderRadius: 10,
                  background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)",
                  display: "flex", alignItems: "flex-start", gap: 8,
                }}>
                  <span style={{ fontSize: 14, flexShrink: 0, lineHeight: 1 }}>⚠️</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: "#fca5a5", lineHeight: 1.55 }}>{musicError}</div>
                    {currentIdx !== null && playlist[currentIdx]?.originalUrl && (
                      <button
                        onClick={() => refreshTrack(playlist[currentIdx!].id)}
                        disabled={refreshingTrackId !== null}
                        style={{
                          marginTop: 6, display: "inline-flex", alignItems: "center", gap: 4,
                          fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 6,
                          background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)",
                          color: "#fca5a5", cursor: "pointer",
                        }}
                      >
                        <RefreshCw size={10} style={refreshingTrackId ? { animation: "cr-spin 1s linear infinite" } : {}} />
                        {refreshingTrackId ? "Refreshing…" : "Refresh link"}
                      </button>
                    )}
                  </div>
                  <button onClick={() => setMusicError(null)} style={{ background: "none", border: "none", color: "rgba(252,165,165,0.5)", cursor: "pointer", padding: 2, flexShrink: 0, display: "flex" }}>
                    <X size={13} />
                  </button>
                </div>
              )}

              {/* ── Playlist ── */}
              {playlist.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2, display: "flex", alignItems: "center", gap: 5, padding: "0 2px" }}>
                    <ListMusic size={10} /> Playlist · {playlist.length} track{playlist.length !== 1 ? "s" : ""}
                  </div>
                  {playlist.map((track, idx) => (
                    <div
                      key={track.id}
                      style={{
                        display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", borderRadius: 10,
                        background: currentIdx === idx ? "linear-gradient(135deg, rgba(244,114,182,0.1) 0%, rgba(168,85,247,0.06) 100%)" : "rgba(255,255,255,0.025)",
                        border: `1px solid ${currentIdx === idx ? "rgba(244,114,182,0.22)" : "rgba(255,255,255,0.05)"}`,
                        cursor: "pointer", transition: "all 0.15s ease",
                      }}
                      onClick={() => playTrack(idx)}
                    >
                      {/* Index / playing indicator */}
                      <div style={{
                        width: 26, height: 26, borderRadius: 7, flexShrink: 0,
                        background: currentIdx === idx ? "rgba(244,114,182,0.2)" : "rgba(255,255,255,0.05)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {currentIdx === idx && musicPlaying
                          ? <div style={{ display: "flex", gap: 1.5, alignItems: "flex-end" }}>
                              {[8, 12, 7, 10].map((h, i) => (
                                <div key={i} style={{ width: 2.5, borderRadius: 1.5, background: "#f472b6", height: `${h}px`, animation: `cr-pulse ${0.3 + i * 0.08}s ease-in-out infinite alternate` }} />
                              ))}
                            </div>
                          : <span style={{ fontSize: 9, color: currentIdx === idx ? "#f9a8d4" : "rgba(255,255,255,0.3)", fontWeight: 700 }}>{idx + 1}</span>
                        }
                      </div>

                      {/* Title + source */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: currentIdx === idx ? 700 : 500, color: currentIdx === idx ? "#fce7f3" : "rgba(255,255,255,0.75)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {track.title}
                        </div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 1 }}>
                          {track.isFile ? "Local file" : track.originalUrl ? "YouTube / URL" : "Direct URL"}
                        </div>
                      </div>

                      {/* Refresh (YouTube tracks only) */}
                      {track.originalUrl && (
                        <button
                          onClick={(e) => { e.stopPropagation(); refreshTrack(track.id); }}
                          disabled={refreshingTrackId === track.id}
                          title="Re-resolve link"
                          style={{
                            background: "none", border: "none", cursor: "pointer", display: "flex", padding: 4, borderRadius: 5, flexShrink: 0,
                            color: refreshingTrackId === track.id ? "#f472b6" : "rgba(255,255,255,0.22)",
                            transition: "color 0.15s",
                          }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#f472b6"; }}
                          onMouseLeave={(e) => { if (refreshingTrackId !== track.id) (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.22)"; }}
                        >
                          <RefreshCw size={12} style={refreshingTrackId === track.id ? { animation: "cr-spin 1s linear infinite" } : {}} />
                        </button>
                      )}

                      {/* Delete */}
                      <button
                        onClick={(e) => { e.stopPropagation(); removeTrack(track.id); }}
                        title="Remove"
                        style={{ background: "none", border: "none", color: "rgba(255,255,255,0.18)", cursor: "pointer", display: "flex", padding: 4, borderRadius: 5, flexShrink: 0, transition: "color 0.15s" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "#f87171"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "rgba(255,255,255,0.18)"; }}
                      ><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
              )}

              {playlist.length === 0 && (
                <div style={{ textAlign: "center", padding: "32px 16px", color: "rgba(255,255,255,0.18)", fontSize: 12 }}>
                  <Music size={32} style={{ opacity: 0.18, margin: "0 auto 10px", display: "block" }} />
                  <div style={{ fontWeight: 600 }}>No tracks yet</div>
                  <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>Paste a YouTube link below or upload an audio file</div>
                </div>
              )}

              {/* ── Add track ── */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.08em", display: "flex", alignItems: "center", gap: 5 }}>
                  <Plus size={10} /> Add Track
                </div>
                <input
                  type="text"
                  value={musicAddTitle}
                  onChange={(e) => setMusicAddTitle(e.target.value)}
                  placeholder="Custom title (optional)"
                  style={{ padding: "8px 11px", borderRadius: 8, fontSize: 12, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", color: "#fff", outline: "none" }}
                />
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    type="text"
                    value={musicAddUrl}
                    onChange={(e) => setMusicAddUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") addMusicUrl(); }}
                    placeholder="YouTube or direct audio URL (.mp3, .wav…)"
                    style={{ flex: 1, padding: "8px 11px", borderRadius: 8, fontSize: 12, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", color: "#fff", outline: "none" }}
                  />
                  <button
                    onClick={() => addMusicUrl()}
                    disabled={!musicAddUrl.trim() || musicResolving}
                    style={{
                      display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", borderRadius: 8,
                      fontSize: 12, fontWeight: 700, cursor: (!musicAddUrl.trim() || musicResolving) ? "not-allowed" : "pointer",
                      background: "rgba(244,114,182,0.18)", border: "1px solid rgba(244,114,182,0.28)",
                      color: "#f9a8d4", opacity: (musicAddUrl.trim() && !musicResolving) ? 1 : 0.4, whiteSpace: "nowrap",
                    }}
                  >
                    {musicResolving ? <><Loader2 size={12} style={{ animation: "cr-spin 1s linear infinite" }} /> Resolving…</> : "Add"}
                  </button>
                </div>
                <button
                  onClick={() => musicFileInputRef.current?.click()}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                    cursor: "pointer", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "rgba(255,255,255,0.5)",
                  }}
                >
                  <Upload size={13} /> Upload audio file
                </button>
              </div>
            </div>
          )}

          {/* ── Mic tab ─────────────────────────────────────────────────── */}
          {activeTab === "mic" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "14px 16px" }}>

              {/* Stream volume */}
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em", display: "flex", alignItems: "center", gap: 6 }}>
                  <Volume2 size={11} /> Stream Volume (Source Audio)
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="range"
                    min={0} max={100} step={1}
                    value={bs.globalStreamVolume}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setBs((prev) => ({ ...prev, globalStreamVolume: v }));
                      // No auto-push — avoids restarting the stream while dragging
                    }}
                    style={{ flex: 1, accentColor: "#a78bfa", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", width: 38, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {bs.globalStreamVolume}%
                  </span>
                  <button
                    onClick={() => update({ globalStreamVolume: bs.globalStreamVolume })}
                    title="Apply volume to all active streams (triggers a brief ~200ms fast-restart)"
                    style={{
                      padding: "4px 12px", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer",
                      border: "1px solid rgba(167,139,250,0.4)", background: "rgba(167,139,250,0.12)", color: "#a78bfa",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Apply
                  </button>
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", marginTop: 4, lineHeight: 1.5 }}>
                  Drag to preview level, then tap <strong style={{ color: "rgba(167,139,250,0.7)" }}>Apply</strong> to push to active streams (brief fast-restart).
                </div>
              </div>

              <SectionDivider label="Microphone (Control Room)" />

              {/* Mic volume */}
              <div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.07em", display: "flex", alignItems: "center", gap: 6 }}>
                  <Mic size={11} /> Mic Volume (local gain)
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <input
                    type="range"
                    min={0} max={200} step={1}
                    value={micVolumeDisplay}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      micVolumeValRef.current = v;
                      if (micGainRef.current) micGainRef.current.gain.value = v / 100;
                      setMicVolumeDisplay(v);
                    }}
                    style={{ flex: 1, accentColor: "#10b981", cursor: "pointer" }}
                  />
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", width: 38, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                    {micVolumeDisplay}%
                  </span>
                </div>
              </div>

              {/* Mic toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  onClick={micActive ? stopMic : (micConnecting ? undefined : startMic)}
                  disabled={micConnecting}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 18px", borderRadius: 10, fontSize: 12, fontWeight: 700,
                    cursor: micConnecting ? "wait" : "pointer",
                    border: `1px solid ${micActive ? "#10b981" : micConnecting ? "#f59e0b" : "rgba(255,255,255,0.15)"}`,
                    background: micActive ? "rgba(16,185,129,0.15)" : micConnecting ? "rgba(245,158,11,0.12)" : "rgba(255,255,255,0.05)",
                    color: micActive ? "#6ee7b7" : micConnecting ? "#fcd34d" : "rgba(255,255,255,0.55)",
                    transition: "all 0.2s ease",
                    opacity: micConnecting ? 0.8 : 1,
                  }}
                >
                  {micActive ? <><Mic size={13} /> Mic Active</> : micConnecting ? <>Connecting…</> : <><MicOff size={13} /> Enable Mic</>}
                </button>
                {micActive && (
                  <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 999, background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.25)" }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", animation: "cr-pulse 1s infinite" }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#10b981" }}>LIVE</span>
                  </div>
                )}
              </div>

              {/* VU Meter */}
              {(micActive || micConnecting) && (
                <div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 7, textTransform: "uppercase", letterSpacing: "0.07em", display: "flex", alignItems: "center", gap: 5 }}>
                    <span>VU Meter</span>
                    {micActive && (
                      <span style={{ fontSize: 10, color: micLevel > 0.6 ? "#f87171" : micLevel > 0.25 ? "#fcd34d" : "#6ee7b7", fontWeight: 700, marginLeft: 4 }}>
                        {micLevel > 0.6 ? "HOT" : micLevel > 0.1 ? "SIGNAL" : "QUIET"}
                      </span>
                    )}
                  </div>
                  <div style={{
                    display: "flex", gap: 2, alignItems: "flex-end", height: 36,
                    padding: "4px 8px", borderRadius: 8,
                    background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.08)",
                  }}>
                    {Array.from({ length: 24 }).map((_, i) => {
                      const threshold = i / 24;
                      const active = micLevel > threshold;
                      const isHot = threshold > 0.75;
                      const isWarm = threshold > 0.5;
                      return (
                        <div
                          key={i}
                          style={{
                            flex: 1, borderRadius: 2,
                            height: `${40 + i * 2.5}%`,
                            background: active
                              ? isHot ? "#ef4444" : isWarm ? "#f59e0b" : "#10b981"
                              : "rgba(255,255,255,0.08)",
                            transition: "background 0.05s ease",
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {micError && (
                <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 11, color: "#fca5a5" }}>
                  {micError}
                </div>
              )}

              <div style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.1)", fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
                Your browser mic streams directly into all active broadcasts via WebSocket → PCM16 → FFmpeg. No stream restart needed to toggle on/off.
              </div>

            </div>
          )}

          {/* ── STAGE / MULTI-VIEW ── */}
          {activeTab === "stage" && (
            <MultiViewPanel streams={streams} procStats={streamProcStats} />
          )}

        </div>
      )}

      {/* ── Floating Screen-Share Status Widget ─────────────────────────────── */}
      {(screenActive || screenReconnecting) && (() => {
        const h = Math.floor(screenElapsed / 3600);
        const m = Math.floor((screenElapsed % 3600) / 60);
        const s = screenElapsed % 60;
        const elapsed = h > 0
          ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
          : `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;

        return (
          <div style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            zIndex: 9999,
            width: 280,
            borderRadius: 18,
            background: "rgba(10,10,18,0.92)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            border: screenReconnecting
              ? "1px solid rgba(251,191,36,0.4)"
              : "1px solid rgba(129,140,248,0.35)",
            boxShadow: screenReconnecting
              ? "0 8px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(251,191,36,0.08)"
              : "0 8px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(129,140,248,0.08)",
            overflow: "hidden",
            animation: "ss-slide-up 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards",
            fontFamily: "inherit",
          }}>
            {/* Top bar — status row */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "13px 16px 10px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                {/* Animated record dot */}
                <div style={{
                  width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                  background: screenReconnecting ? "#fbbf24" : "#818cf8",
                  boxShadow: screenReconnecting
                    ? "0 0 0 0 rgba(251,191,36,0.4)"
                    : "0 0 0 0 rgba(129,140,248,0.4)",
                  animation: screenReconnecting ? "ss-blink 0.8s ease-in-out infinite" : "ss-ripple 1.8s ease-out infinite",
                }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: screenReconnecting ? "#fde68a" : "#e0e7ff", letterSpacing: "0.03em" }}>
                    {screenReconnecting ? "RECONNECTING…" : "SCREEN CAPTURING"}
                  </div>
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,0.38)", marginTop: 1 }}>
                    {screenReconnecting ? "Auto-reconnecting to server" : "Streaming to broadcast"}
                  </div>
                </div>
              </div>
              {/* Elapsed timer */}
              <div style={{
                fontVariantNumeric: "tabular-nums",
                fontSize: 15, fontWeight: 800,
                color: screenReconnecting ? "#fde68a" : "#a5b4fc",
                letterSpacing: "0.04em",
                fontFamily: "monospace",
              }}>
                {elapsed}
              </div>
            </div>

            {/* Live preview thumbnail */}
            {screenPreviewUrl && !screenReconnecting && (
              <div style={{ position: "relative", background: "#000" }}>
                <img
                  src={screenPreviewUrl}
                  alt="Screen preview"
                  style={{ width: "100%", display: "block", maxHeight: 130, objectFit: "cover" }}
                />
                {/* Scanline overlay for that professional look */}
                <div style={{
                  position: "absolute", inset: 0,
                  background: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.04) 3px, rgba(0,0,0,0.04) 4px)",
                  pointerEvents: "none",
                }} />
                {/* FPS badge */}
                <div style={{
                  position: "absolute", top: 8, left: 10,
                  padding: "2px 8px", borderRadius: 6,
                  background: "rgba(129,140,248,0.25)", backdropFilter: "blur(8px)",
                  border: "1px solid rgba(129,140,248,0.4)",
                  fontSize: 9, fontWeight: 800, color: "#c7d2fe", letterSpacing: "0.06em",
                }}>
                  20 FPS
                </div>
                <div style={{
                  position: "absolute", top: 8, right: 10,
                  display: "flex", alignItems: "center", gap: 4,
                  padding: "2px 8px", borderRadius: 6,
                  background: "rgba(239,68,68,0.22)", backdropFilter: "blur(8px)",
                  border: "1px solid rgba(239,68,68,0.35)",
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#f87171", animation: "ss-blink 1s infinite" }} />
                  <span style={{ fontSize: 9, fontWeight: 800, color: "#fca5a5", letterSpacing: "0.06em" }}>LIVE</span>
                </div>
              </div>
            )}

            {/* Reconnecting progress bar */}
            {screenReconnecting && (
              <div style={{ height: 2, background: "rgba(251,191,36,0.12)" }}>
                <div style={{ height: "100%", background: "#fbbf24", animation: "ss-progress 1.5s ease-in-out infinite" }} />
              </div>
            )}

            {/* Bottom — stop button */}
            <div style={{ padding: "10px 16px 14px" }}>
              <button
                onClick={stopScreenShare}
                style={{
                  width: "100%", padding: "10px 0",
                  borderRadius: 12, fontSize: 12, fontWeight: 800,
                  cursor: "pointer", border: "1px solid rgba(239,68,68,0.4)",
                  background: "rgba(239,68,68,0.12)",
                  color: "#fca5a5", letterSpacing: "0.04em",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                  transition: "all 0.18s ease",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.22)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.7)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.12)";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.4)";
                }}
              >
                <MonitorUp size={13} />
                Stop Screen Share
              </button>
            </div>
          </div>
        );
      })()}

      <style>{`
        @keyframes cr-pulse { 0%,100%{opacity:1;} 50%{opacity:0.3;} }
        @keyframes cr-fade-in { from{opacity:0;transform:translateY(-4px);} to{opacity:1;transform:translateY(0);} }
        @keyframes cr-slide-down { from{opacity:0;transform:translateY(-6px);} to{opacity:1;transform:translateY(0);} }
        @keyframes cr-spin { from{transform:rotate(0deg);} to{transform:rotate(360deg);} }
        @keyframes ss-slide-up { from{opacity:0;transform:translateY(20px) scale(0.96);} to{opacity:1;transform:translateY(0) scale(1);} }
        @keyframes ss-ripple {
          0%   { box-shadow: 0 0 0 0 rgba(129,140,248,0.55); }
          70%  { box-shadow: 0 0 0 8px rgba(129,140,248,0); }
          100% { box-shadow: 0 0 0 0 rgba(129,140,248,0); }
        }
        @keyframes ss-blink { 0%,100%{opacity:1;} 50%{opacity:0.25;} }
        @keyframes ss-progress { 0%{width:0%;margin-left:0;} 50%{width:60%;margin-left:20%;} 100%{width:0%;margin-left:100%;} }
      `}</style>

      {/* TikTok-style gift popup overlay — rendered above everything else */}
      <GiftPopup event={latestGift} onDismiss={() => setLatestGift(null)} />
    </div>
  );
}

