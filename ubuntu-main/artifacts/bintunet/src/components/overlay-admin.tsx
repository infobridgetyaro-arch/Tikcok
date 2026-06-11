import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QRCodeSVG } from "qrcode.react";
import {
  ChevronDown, ChevronUp, Sparkles, Type, Radio,
  AlertCircle, Signal, Youtube, Shield, QrCode,
  RotateCcw, Users, Check, AlertTriangle, AtSign,
  Share2
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
  overlaySocialEnabled: boolean;
  overlaySocialHandle: string;
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
    overlaySocialEnabled: s.overlaySocialEnabled,
    overlaySocialHandle: s.overlaySocialHandle,
  };
}

function hasDraftChanges(draft: OverlayDraft, stream: StreamConfig): boolean {
  return (Object.keys(draft) as (keyof OverlayDraft)[]).some(
    (k) => (draft[k] as any) !== (stream as any)[k]
  );
}

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

const SOURCE_ICON: Record<string, any> = {
  tiktok: SiTiktok,
  youtube: Youtube,
  camera: Radio,
};
const SOURCE_COLOR: Record<string, string> = {
  tiktok: "#ff2d55",
  youtube: "#ff0000",
  camera: "#38bdf8",
};

export function OverlayAdmin({ streams, onUpdate }: OverlayAdminProps) {
  const [open, setOpen] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [qrTrackUrl, setQrTrackUrl] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [scanFlash, setScanFlash] = useState<number | null>(null);
  const { subscribe } = useWebSocket();

  const activeStreams = streams.filter(
    (s) => s.status === "streaming" || s.status === "reconnecting"
  );
  const isLive = activeStreams.some((s) => s.status === "streaming");

  const fetchInvite = useCallback(async () => {
    try {
      const res = await fetch("/api/invite", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setInviteUrl(data.url);
        const trackUrl = `${window.location.origin}/api/qr/track?cb=${encodeURIComponent(data.url)}`;
        setQrTrackUrl(trackUrl);
      }
    } catch {}
  }, []);

  const fetchQrCount = useCallback(async () => {
    try {
      const res = await fetch("/api/qr/count", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setScanCount(data.count || 0);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchInvite();
    fetchQrCount();
  }, [fetchInvite, fetchQrCount]);

  useEffect(() => {
    const unsub = subscribe("qr_scan", (msg) => {
      const count = msg.data?.count ?? 0;
      setScanCount(count);
      setScanFlash(count);
      const t = setTimeout(() => setScanFlash(null), 4000);
      return () => clearTimeout(t);
    });
    return unsub;
  }, [subscribe]);

  const resetScans = async () => {
    try {
      await fetch("/api/qr/reset", { method: "POST", credentials: "include" });
    } catch {}
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className="relative rounded-xl overflow-hidden border border-slate-700/60"
        style={{ background: "linear-gradient(160deg, #080d18 0%, #0d1525 40%, #060e1c 100%)" }}
      >
        <div className="absolute inset-0 broadcast-scanline pointer-events-none" />

        <CollapsibleTrigger asChild>
          <button
            className="relative w-full px-4 py-3 flex items-center gap-3 text-left group"
            data-testid="button-overlay-admin-toggle"
          >
            <div className="flex items-center gap-2.5 shrink-0">
              <div
                className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0"
                style={{ background: "rgba(56,189,248,0.12)", border: "1px solid rgba(56,189,248,0.25)" }}
              >
                <Radio className="w-4.5 h-4.5" style={{ color: "#38bdf8" }} />
              </div>
              <EqBars color={isLive ? "#34d399" : "#334155"} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white font-bold tracking-wider text-sm">CONTROL ROOM</span>
                <span className="text-slate-600 text-[10px] font-mono tracking-widest hidden sm:inline">BINTUNET</span>
                {isLive ? (
                  <span
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold text-white"
                    style={{ background: "rgba(239,68,68,0.22)", border: "1px solid rgba(239,68,68,0.45)" }}
                  >
                    <OnAirDot />ON AIR
                  </span>
                ) : activeStreams.length > 0 ? (
                  <span
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold text-amber-300"
                    style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)" }}
                  >
                    <Signal className="w-3 h-3" />CONNECTING
                  </span>
                ) : (
                  <span className="text-slate-700 text-xs font-mono">STANDBY</span>
                )}
                <span
                  className="hidden sm:flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold"
                  style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)", color: "#34d399" }}
                >
                  <Shield className="w-2.5 h-2.5" />SAFE ROOM
                </span>
              </div>
              <p className="text-slate-600 text-xs mt-0.5">
                {activeStreams.length === 0
                  ? "No active streams — start a stream to access the control room"
                  : `${activeStreams.length} active · edit in safe room, tap Apply to go live`}
              </p>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {streams.length > 0 && (
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-slate-500 text-xs font-mono">
                    {String(activeStreams.length).padStart(2, "0")}/{String(streams.length).padStart(2, "0")}
                  </span>
                  <span className="text-slate-700 text-[10px]">LIVE</span>
                </div>
              )}
              <div className="text-slate-600 group-hover:text-slate-400 transition-colors">
                {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
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

            {/* Invite QR — for dashboard access */}
            <div
              className="rounded-xl overflow-hidden mt-2"
              style={{
                background: "linear-gradient(135deg, rgba(10,14,28,0.9) 0%, rgba(5,10,22,0.95) 100%)",
                border: "1px solid rgba(51,65,85,0.7)",
              }}
            >
              <div className="px-4 py-3 flex items-center justify-between border-b border-slate-800/50">
                <div className="flex items-center gap-2">
                  <div
                    className="flex items-center justify-center w-7 h-7 rounded-lg"
                    style={{ background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)" }}
                  >
                    <QrCode className="w-3.5 h-3.5 text-sky-400" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-200 tracking-wide">INVITE QR CODE</p>
                    <p className="text-[10px] text-slate-600">Scan to join the dashboard</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {scanCount > 0 && (
                    <div className="flex items-center gap-1">
                      <Users className="w-3 h-3 text-sky-400" />
                      <span className="text-xs font-bold text-sky-300">{scanCount}</span>
                      <span className="text-[10px] text-slate-500">scanned</span>
                    </div>
                  )}
                  {scanCount > 0 && (
                    <button onClick={resetScans} className="text-slate-700 hover:text-slate-400 transition-colors" title="Reset scan count">
                      <RotateCcw className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
              <div className="p-4 flex gap-4 items-start">
                {qrTrackUrl ? (
                  <div
                    className="rounded-xl p-2 shrink-0 relative"
                    style={{ background: "#ffffff", border: "2px solid rgba(56,189,248,0.3)" }}
                  >
                    <QRCodeSVG value={qrTrackUrl} size={80} bgColor="#ffffff" fgColor="#0a0a1a" level="M" />
                    {scanFlash !== null && (
                      <div
                        className="absolute inset-0 rounded-xl flex items-center justify-center"
                        style={{ background: "rgba(56,189,248,0.9)", animation: "qr-flash 4s ease-out forwards" }}
                      >
                        <div className="text-center">
                          <p className="text-2xl font-black text-white leading-none">{scanFlash}</p>
                          <p className="text-[9px] font-bold text-sky-100 tracking-wider uppercase mt-0.5">scanned</p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-20 h-20 rounded-xl bg-slate-800/60 animate-pulse shrink-0" />
                )}
                <div className="flex-1 min-w-0 space-y-1.5 pt-1">
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Show this on stream to invite viewers to join your dashboard. When scanned, the counter updates instantly.
                  </p>
                  {inviteUrl && (
                    <p className="text-[9px] font-mono text-slate-700 break-all">
                      {inviteUrl.length > 50 ? inviteUrl.slice(0, 50) + "…" : inviteUrl}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function AdminStreamOverlay({
  stream,
  index,
  onUpdate,
}: {
  stream: StreamConfig;
  index: number;
  onUpdate: (id: string, data: Partial<StreamConfig>) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [draft, setDraft] = useState<OverlayDraft>(() => buildDraft(stream));
  const [applying, setApplying] = useState(false);
  const [justApplied, setJustApplied] = useState(false);

  const pending = hasDraftChanges(draft, stream);

  const set = <K extends keyof OverlayDraft>(field: K, value: OverlayDraft[K]) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  };

  const apply = () => {
    setApplying(true);
    onUpdate(stream.id, draft);
    setTimeout(() => {
      setApplying(false);
      setJustApplied(true);
      setTimeout(() => setJustApplied(false), 2500);
    }, 1800);
  };

  const discard = () => {
    setDraft(buildDraft(stream));
  };

  const sourceType = stream.sourceType || "tiktok";
  const SourceIcon = SOURCE_ICON[sourceType] || Radio;
  const sourceColor = SOURCE_COLOR[sourceType] || "#38bdf8";
  const sourceLabel =
    sourceType === "youtube"
      ? stream.youtubeSourceUrl || "YouTube"
      : sourceType === "camera"
      ? stream.cameraDevice || "/dev/video0"
      : stream.tiktokUsername
      ? `@${stream.tiktokUsername}`
      : "Stream";

  const isStreaming = stream.status === "streaming";

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: "1px solid rgba(30,41,59,0.9)", background: "rgba(8,12,24,0.7)" }}
    >
      {/* Channel header */}
      <div
        className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-white/[0.03] transition-colors cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setExpanded((v) => !v)}
        data-testid={`button-admin-expand-${stream.id}`}
      >
        <div className="flex items-center gap-2 shrink-0">
          {isStreaming ? (
            <span className="relative flex w-2.5 h-2.5">
              <span className="absolute inline-flex w-full h-full rounded-full bg-red-500 animate-signal-ping" />
              <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-red-500" />
            </span>
          ) : (
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400/80" />
          )}
          <SourceIcon className="w-3.5 h-3.5" style={{ color: sourceColor }} />
        </div>

        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-slate-300 font-bold text-xs tracking-wider">
            CH {String(index + 1).padStart(2, "0")}
          </span>
          <span className="text-slate-600 text-xs truncate">{sourceLabel}</span>
          {isStreaming && <EqBars color="#34d399" />}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {pending && (
            <span
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-amber-300"
              style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)" }}
            >
              <AlertTriangle className="w-2.5 h-2.5" />DRAFT
            </span>
          )}
          {justApplied && !pending && (
            <span
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold text-emerald-300"
              style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)" }}
            >
              <Check className="w-2.5 h-2.5" />APPLIED
            </span>
          )}
          <span className="text-slate-700">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-800/50 px-3 py-3 space-y-4">
          {/* Safe room label */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest" style={{ color: "#34d399" }}>
              <Shield className="w-3 h-3" />
              SAFE ROOM — edit freely, tap Apply to go live
            </div>
            <div className="flex items-center gap-1.5">
              <Switch
                checked={draft.overlayEnabled}
                onCheckedChange={(v) => set("overlayEnabled", v)}
                data-testid={`switch-admin-overlay-${stream.id}`}
              />
              <span className="text-slate-500 text-[10px] font-mono">OVERLAY</span>
            </div>
          </div>

          {draft.overlayEnabled && (
            <>
              {/* ── Channel Name + Headline ── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Channel Name</Label>
                  <Input
                    className="h-8 text-sm bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700 focus:border-sky-500/70"
                    placeholder="BintuNet LIVE"
                    value={draft.overlayChannelName}
                    onChange={(e) => set("overlayChannelName", e.target.value)}
                    data-testid={`input-admin-channel-${stream.id}`}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Headline</Label>
                  <Input
                    className="h-8 text-sm bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700 focus:border-sky-500/70"
                    placeholder="Breaking news or tag line"
                    value={draft.overlayHeadline}
                    onChange={(e) => set("overlayHeadline", e.target.value)}
                    disabled={draft.overlayLiveCount}
                    data-testid={`input-admin-headline-${stream.id}`}
                  />
                </div>
              </div>

              {/* ── Banner colour ── */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draft.overlayBannerColor || "#c41e1e"}
                    onChange={(e) => set("overlayBannerColor", e.target.value)}
                    className="w-7 h-7 rounded cursor-pointer border border-slate-700"
                    title="Banner colour"
                  />
                  <span className="text-[10px] text-slate-500 font-mono">BANNER</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={draft.overlayTickerColor || "#1a1a2e"}
                    onChange={(e) => set("overlayTickerColor", e.target.value)}
                    className="w-7 h-7 rounded cursor-pointer border border-slate-700"
                    title="Ticker colour"
                  />
                  <span className="text-[10px] text-slate-500 font-mono">TICKER</span>
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-[10px] text-slate-600 uppercase tracking-widest">
                    Ticker Speed {draft.overlayTickerSpeed}
                  </Label>
                  <Slider
                    value={[draft.overlayTickerSpeed]}
                    min={30} max={200} step={5}
                    onValueChange={([v]) => set("overlayTickerSpeed", v)}
                  />
                </div>
              </div>

              {/* ── Ticker text ── */}
              <div className="space-y-1">
                <Label className="text-[10px] text-slate-600 uppercase tracking-widest flex items-center gap-1.5">
                  <Type className="w-3 h-3" />Ticker Text
                </Label>
                <Input
                  className="h-8 text-sm bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700 focus:border-sky-500/70"
                  placeholder="Scrolling ticker text..."
                  value={draft.overlayTickerText}
                  onChange={(e) => set("overlayTickerText", e.target.value)}
                  data-testid={`input-admin-ticker-${stream.id}`}
                />
              </div>

              {/* ── Logo settings (only if logo uploaded) ── */}
              {stream.overlayLogoPath && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Logo Position</Label>
                    <Select
                      value={draft.overlayLogoPosition}
                      onValueChange={(v) => set("overlayLogoPosition", v as any)}
                    >
                      <SelectTrigger className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="top-left">Top Left</SelectItem>
                        <SelectItem value="top-right">Top Right</SelectItem>
                        <SelectItem value="bottom-left">Bottom Left</SelectItem>
                        <SelectItem value="bottom-right">Bottom Right</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Logo Animation</Label>
                    <Select
                      value={draft.overlayLogoAnimation}
                      onValueChange={(v) => set("overlayLogoAnimation", v as any)}
                    >
                      <SelectTrigger className="h-8 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200">
                        <SelectValue />
                      </SelectTrigger>
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
                    <Label className="text-[10px] text-slate-600 uppercase tracking-widest">
                      Logo Size {Math.round((draft.overlayLogoScale || 0.15) * 100)}%
                    </Label>
                    <Slider
                      value={[draft.overlayLogoScale || 0.15]}
                      min={0.05} max={0.35} step={0.01}
                      onValueChange={([v]) => set("overlayLogoScale", v)}
                    />
                  </div>
                </div>
              )}

              {/* ── YouTube subscriber count ── */}
              <div
                className="rounded-lg p-3 space-y-2"
                style={{ background: "rgba(255,0,0,0.06)", border: "1px solid rgba(255,0,0,0.15)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Youtube className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-[11px] font-semibold text-slate-300">Live Subscriber Count</span>
                  </div>
                  <Switch
                    checked={draft.overlayLiveCount}
                    onCheckedChange={(v) => set("overlayLiveCount", v)}
                    data-testid={`switch-admin-livecount-${stream.id}`}
                  />
                </div>
                {draft.overlayLiveCount && (
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-600 uppercase tracking-widest">YouTube Channel ID</Label>
                    <Input
                      className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700 font-mono"
                      placeholder="UCxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      value={draft.youtubeChannelId}
                      onChange={(e) => set("youtubeChannelId", e.target.value)}
                      data-testid={`input-admin-channelid-${stream.id}`}
                    />
                    <p className="text-[9px] text-slate-700">
                      Requires GOOGLE_API_KEY secret. Updates every 30s on stream.
                    </p>
                  </div>
                )}
              </div>

              {/* ── QR Code on stream ── */}
              <div
                className="rounded-lg p-3 space-y-2"
                style={{ background: "rgba(249,115,22,0.07)", border: "1px solid rgba(249,115,22,0.2)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <QrCode className="w-3.5 h-3.5 text-orange-400" />
                    <span className="text-[11px] font-semibold text-slate-300">QR on Stream</span>
                    <span className="text-[9px] text-orange-500 font-mono">TOP-RIGHT</span>
                  </div>
                  <Switch
                    checked={draft.overlayQrEnabled}
                    onCheckedChange={(v) => set("overlayQrEnabled", v)}
                    data-testid={`switch-admin-qr-${stream.id}`}
                  />
                </div>
                {draft.overlayQrEnabled && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Support URL</Label>
                        <Input
                          className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                          placeholder="https://buymeacoffee.com/..."
                          value={draft.overlayQrUrl}
                          onChange={(e) => set("overlayQrUrl", e.target.value)}
                          data-testid={`input-admin-qrurl-${stream.id}`}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-slate-600 uppercase tracking-widest">Label</Label>
                        <Input
                          className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                          placeholder="BUY ME COFFEE"
                          value={draft.overlayQrLabel}
                          onChange={(e) => set("overlayQrLabel", e.target.value)}
                          data-testid={`input-admin-qrlabel-${stream.id}`}
                        />
                      </div>
                    </div>
                    {draft.overlayQrUrl && (
                      <div className="flex items-center gap-3">
                        <div className="bg-white rounded-lg p-1.5 shrink-0">
                          <QRCodeSVG value={draft.overlayQrUrl} size={56} level="L" />
                        </div>
                        <div>
                          <div
                            className="px-2 py-1 rounded text-xs font-black text-white tracking-wider"
                            style={{ background: "#F97316" }}
                          >
                            {draft.overlayQrLabel || "BUY ME COFFEE"}
                          </div>
                          <p className="text-[9px] text-slate-600 mt-1">Preview of top-right overlay</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ── Social bar ── */}
              <div
                className="rounded-lg p-3 space-y-2"
                style={{ background: "rgba(56,189,248,0.06)", border: "1px solid rgba(56,189,248,0.15)" }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Share2 className="w-3.5 h-3.5 text-sky-400" />
                    <span className="text-[11px] font-semibold text-slate-300">Social Handle Bar</span>
                    <span className="text-[9px] text-sky-500 font-mono">BOTTOM CENTER</span>
                  </div>
                  <Switch
                    checked={draft.overlaySocialEnabled}
                    onCheckedChange={(v) => set("overlaySocialEnabled", v)}
                    data-testid={`switch-admin-social-${stream.id}`}
                  />
                </div>
                {draft.overlaySocialEnabled && (
                  <div className="space-y-1">
                    <Label className="text-[10px] text-slate-600 uppercase tracking-widest flex items-center gap-1">
                      <AtSign className="w-3 h-3" />Handle
                    </Label>
                    <Input
                      className="h-7 text-xs bg-slate-900/60 border-slate-700/60 text-slate-200 placeholder:text-slate-700"
                      placeholder="@yourhandle"
                      value={draft.overlaySocialHandle}
                      onChange={(e) => set("overlaySocialHandle", e.target.value)}
                      data-testid={`input-admin-social-${stream.id}`}
                    />
                    <p className="text-[9px] text-slate-700">Shows FB · IG · TikTok · @handle at bottom center of stream</p>
                  </div>
                )}
              </div>

              {/* ── Mini live preview (draft values) ── */}
              <div
                className="relative rounded-lg overflow-hidden"
                style={{
                  aspectRatio: stream.ratio === "mobile" ? "9/16" : "16/9",
                  maxHeight: "110px",
                  background: "linear-gradient(160deg, #0d1629 0%, #080e1c 100%)",
                  border: "1px solid rgba(30,41,59,0.8)",
                }}
                data-testid={`admin-overlay-preview-${stream.id}`}
              >
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-slate-800 text-[7px] font-mono tracking-[0.3em]">DRAFT PREVIEW</span>
                </div>

                {/* QR preview top-right */}
                {draft.overlayQrEnabled && draft.overlayQrUrl && (
                  <div className="absolute top-1 right-1 flex flex-col items-center gap-0.5">
                    <div className="bg-white rounded p-0.5">
                      <QRCodeSVG value={draft.overlayQrUrl} size={22} level="L" />
                    </div>
                    <div
                      className="text-white text-[5px] font-black px-0.5 py-0.5 rounded leading-tight text-center max-w-[36px] break-words"
                      style={{ background: "#F97316" }}
                    >
                      {(draft.overlayQrLabel || "BUY ME COFFEE").slice(0, 14)}
                    </div>
                  </div>
                )}

                {/* Channel name + headline lower-third */}
                {(draft.overlayChannelName || (draft.overlayLiveCount && draft.youtubeChannelId)) && (
                  <div className="absolute bottom-5 left-0 flex items-stretch text-[7px] leading-tight">
                    {draft.overlayChannelName && (
                      <div
                        className="px-1.5 py-0.5 text-white font-bold flex items-center"
                        style={{ backgroundColor: draft.overlayBannerColor || "#c41e1e" }}
                      >
                        {draft.overlayChannelName}
                      </div>
                    )}
                    {draft.overlayLiveCount && (
                      <div className="px-1.5 py-0.5 text-white bg-black/80 flex items-center gap-1">
                        <Youtube className="w-2 h-2 text-red-500 shrink-0" />
                        <span>Sub Count</span>
                      </div>
                    )}
                    {draft.overlayHeadline && !draft.overlayLiveCount && (
                      <div className="px-1.5 py-0.5 text-white bg-gray-800/90 flex items-center">
                        {draft.overlayHeadline}
                      </div>
                    )}
                  </div>
                )}

                {/* Social bar */}
                {draft.overlaySocialEnabled && draft.overlaySocialHandle && (
                  <div className="absolute bottom-4 left-[15%] right-[15%] flex items-center justify-center">
                    <div className="bg-black/80 px-1.5 py-0.5 rounded text-[5px] text-slate-300 font-mono">
                      FB · IG · TikTok · {draft.overlaySocialHandle}
                    </div>
                  </div>
                )}

                {/* Ticker */}
                {draft.overlayTickerText && (
                  <div
                    className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[6px] text-white overflow-hidden whitespace-nowrap"
                    style={{ backgroundColor: (draft.overlayTickerColor || "#1a1a2e") + "E6" }}
                  >
                    <span className="inline-block animate-marquee">{draft.overlayTickerText}</span>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── Apply / Discard buttons ── */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              className="flex-1 gap-2 font-bold text-sm h-9"
              disabled={!pending || applying}
              onClick={apply}
              style={pending
                ? { background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)", border: "none" }
                : {}}
              data-testid={`button-admin-apply-${stream.id}`}
            >
              {applying ? (
                <><Sparkles className="w-4 h-4 animate-spin" />Applying…</>
              ) : justApplied ? (
                <><Check className="w-4 h-4" />Applied!</>
              ) : (
                <><Sparkles className="w-4 h-4" />{pending ? "Apply to Live" : "Up to Date"}</>
              )}
            </Button>
            {pending && (
              <Button
                variant="ghost"
                size="sm"
                onClick={discard}
                className="text-slate-500 hover:text-slate-300 h-9"
                data-testid={`button-admin-discard-${stream.id}`}
              >
                Discard
              </Button>
            )}
          </div>

          {pending && (
            <p className="text-[10px] text-amber-600 text-center -mt-1">
              Changes are staged in safe room — not live yet
            </p>
          )}
        </div>
      )}
    </div>
  );
}
