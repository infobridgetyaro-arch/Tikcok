import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ChevronDown, ChevronUp, Sparkles, Type, Radio,
  AlertCircle, Signal, Layers, Youtube, Zap
} from "lucide-react";
import { SiTiktok } from "react-icons/si";
import type { StreamConfig } from "@shared/schema";

interface OverlayAdminProps {
  streams: StreamConfig[];
  onUpdate: (id: string, data: Partial<StreamConfig>) => void;
}

function EqBars({ color = "currentColor" }: { color?: string }) {
  return (
    <span className="flex items-end gap-0.5 h-7" style={{ color }} aria-hidden>
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

  const activeStreams = streams.filter(
    (s) => s.status === "streaming" || s.status === "reconnecting"
  );
  const isLive = activeStreams.some((s) => s.status === "streaming");

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      {/* ── Professional broadcast-room header ── */}
      <div
        className="relative rounded-xl overflow-hidden border border-slate-700/60"
        style={{
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0c1a2e 100%)",
        }}
      >
        {/* subtle scanline texture */}
        <div className="absolute inset-0 broadcast-scanline" />

        <CollapsibleTrigger asChild>
          <button
            className="relative w-full px-4 py-3.5 flex items-center gap-3 text-left group"
            data-testid="button-overlay-admin-toggle"
          >
            {/* Logo + eq bars */}
            <div className="flex items-center gap-2.5 shrink-0">
              <div
                className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0"
                style={{ background: "rgba(56,189,248,0.15)", border: "1px solid rgba(56,189,248,0.3)" }}
              >
                <Radio className="w-5 h-5" style={{ color: "#38bdf8" }} />
              </div>
              <EqBars color={isLive ? "#34d399" : "#475569"} />
            </div>

            {/* Title block */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white font-bold tracking-wide text-sm">
                  BINTUNET
                </span>
                <span className="text-slate-400 text-xs font-mono tracking-widest">
                  OVERLAY CONTROL
                </span>
                {isLive ? (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-bold text-white animate-on-air"
                    style={{ background: "rgba(239,68,68,0.25)", border: "1px solid rgba(239,68,68,0.5)" }}>
                    <OnAirDot />
                    ON AIR
                  </span>
                ) : activeStreams.length > 0 ? (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold text-amber-300"
                    style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)" }}>
                    <Signal className="w-3 h-3" /> CONNECTING
                  </span>
                ) : (
                  <span className="text-slate-600 text-xs font-mono">STANDBY</span>
                )}
              </div>
              <p className="text-slate-500 text-xs mt-0.5">
                {activeStreams.length === 0
                  ? "No active streams — start a stream to control overlays"
                  : `${activeStreams.length} stream${activeStreams.length !== 1 ? "s" : ""} active · changes apply in real-time`}
              </p>
            </div>

            {/* Right: stream count + chevron */}
            <div className="flex items-center gap-3 shrink-0">
              {streams.length > 0 && (
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-slate-400 text-xs font-mono">{String(activeStreams.length).padStart(2,"0")}/{String(streams.length).padStart(2,"0")}</span>
                  <span className="text-slate-600 text-[10px]">LIVE</span>
                </div>
              )}
              <div className="text-slate-500 group-hover:text-slate-300 transition-colors">
                {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </div>
          </button>
        </CollapsibleTrigger>

        {/* ── Expanded: stream controls ── */}
        <CollapsibleContent>
          <div className="relative border-t border-slate-700/50 px-4 pb-4 pt-3 space-y-3">
            {activeStreams.length === 0 ? (
              <div className="flex items-center gap-3 py-6 justify-center text-slate-500">
                <AlertCircle className="w-4 h-4" />
                <p className="text-sm">Start a stream to see overlay controls here.</p>
              </div>
            ) : (
              activeStreams.map((stream, i) => (
                <AdminStreamOverlay
                  key={stream.id}
                  stream={stream}
                  index={i}
                  onUpdate={onUpdate}
                />
              ))
            )}
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

  const sourceType = stream.sourceType || "tiktok";
  const SourceIcon = SOURCE_ICON[sourceType] || Radio;
  const sourceColor = SOURCE_COLOR[sourceType] || "#38bdf8";

  const sourceLabel =
    sourceType === "youtube" ? (stream.youtubeSourceUrl || "YouTube") :
    sourceType === "camera" ? (stream.cameraDevice || "/dev/video0") :
    stream.tiktokUsername ? `@${stream.tiktokUsername}` : "Stream";

  const isStreaming = stream.status === "streaming";

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: "1px solid rgba(51,65,85,0.8)", background: "rgba(15,23,42,0.7)" }}
    >
      {/* Stream row header — use div to avoid button-in-button with Switch */}
      <div
        className="w-full flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-white/5 transition-colors cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && setExpanded((v) => !v)}
        data-testid={`button-admin-expand-${stream.id}`}
      >
        {/* Status + source icon */}
        <div className="flex items-center gap-2 shrink-0">
          {isStreaming ? <OnAirDot /> : (
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
          )}
          <SourceIcon className="w-3.5 h-3.5" style={{ color: sourceColor }} />
        </div>

        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="text-slate-300 font-semibold text-xs tracking-wide">
            CH {String(index + 1).padStart(2, "0")}
          </span>
          <span className="text-slate-500 text-xs truncate">{sourceLabel}</span>
          {isStreaming && <EqBars color="#34d399" />}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <span className="text-slate-500 text-xs">OVRL</span>
            <Switch
              checked={stream.overlayEnabled}
              onCheckedChange={(v) => onUpdate(stream.id, { overlayEnabled: v })}
              data-testid={`switch-admin-overlay-${stream.id}`}
            />
          </div>
          <span className="text-slate-600">
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </span>
        </div>
      </div>

      {/* Expanded controls */}
      {expanded && stream.overlayEnabled && (
        <div className="border-t border-slate-700/40 px-3 py-3 space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: "#38bdf8" }}>
            <Sparkles className="w-3 h-3" />
            LIVE ADJUST — changes apply instantly
          </div>

          {/* Channel Name & Headline */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-slate-500 uppercase tracking-widest">Channel Name</Label>
              <Input
                className="h-8 text-sm bg-slate-800/60 border-slate-600 text-slate-200 placeholder:text-slate-600 focus:border-sky-500"
                placeholder="BintuNet LIVE"
                value={stream.overlayChannelName}
                onChange={(e) => onUpdate(stream.id, { overlayChannelName: e.target.value })}
                data-testid={`input-admin-channel-${stream.id}`}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-500 uppercase tracking-widest">Headline</Label>
              <Input
                className="h-8 text-sm bg-slate-800/60 border-slate-600 text-slate-200 placeholder:text-slate-600 focus:border-sky-500"
                placeholder="Breaking news or subscriber count"
                value={stream.overlayHeadline}
                onChange={(e) => onUpdate(stream.id, { overlayHeadline: e.target.value })}
                disabled={stream.overlayLiveCount}
                data-testid={`input-admin-headline-${stream.id}`}
              />
            </div>
          </div>

          {/* Ticker */}
          <div className="space-y-1">
            <Label className="text-xs text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
              <Type className="w-3 h-3" /> Ticker
            </Label>
            <Input
              className="h-8 text-sm bg-slate-800/60 border-slate-600 text-slate-200 placeholder:text-slate-600 focus:border-sky-500"
              placeholder="Scrolling ticker text..."
              value={stream.overlayTickerText}
              onChange={(e) => onUpdate(stream.id, { overlayTickerText: e.target.value })}
              data-testid={`input-admin-ticker-${stream.id}`}
            />
          </div>

          {/* Colors + speed */}
          <div className="grid grid-cols-3 gap-2 items-end">
            <div className="space-y-1">
              <Label className="text-xs text-slate-500 uppercase tracking-widest">Banner</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={stream.overlayBannerColor || "#c41e1e"}
                  onChange={(e) => onUpdate(stream.id, { overlayBannerColor: e.target.value })}
                  className="w-8 h-8 rounded cursor-pointer border border-slate-600"
                  data-testid={`input-admin-banner-color-${stream.id}`}
                />
                <span className="text-xs text-slate-500 font-mono">{(stream.overlayBannerColor || "#c41e1e").toUpperCase()}</span>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-500 uppercase tracking-widest">Ticker</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={stream.overlayTickerColor || "#1a1a2e"}
                  onChange={(e) => onUpdate(stream.id, { overlayTickerColor: e.target.value })}
                  className="w-8 h-8 rounded cursor-pointer border border-slate-600"
                  data-testid={`input-admin-ticker-color-${stream.id}`}
                />
                <span className="text-xs text-slate-500 font-mono">{(stream.overlayTickerColor || "#1a1a2e").toUpperCase()}</span>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-500 uppercase tracking-widest">Speed {stream.overlayTickerSpeed || 80}px/s</Label>
              <Slider
                value={[stream.overlayTickerSpeed || 80]}
                min={30}
                max={200}
                step={5}
                onValueChange={([v]) => onUpdate(stream.id, { overlayTickerSpeed: v })}
                data-testid={`slider-admin-speed-${stream.id}`}
              />
            </div>
          </div>

          {/* Logo controls if logo uploaded */}
          {stream.overlayLogoPath && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-slate-500 uppercase tracking-widest">Logo Position</Label>
                <Select
                  value={stream.overlayLogoPosition}
                  onValueChange={(v) => onUpdate(stream.id, { overlayLogoPosition: v as any })}
                >
                  <SelectTrigger className="h-8 text-sm bg-slate-800/60 border-slate-600 text-slate-200" data-testid={`select-admin-logo-pos-${stream.id}`}>
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
                <Label className="text-xs text-slate-500 uppercase tracking-widest">Logo Animation</Label>
                <Select
                  value={stream.overlayLogoAnimation || "none"}
                  onValueChange={(v) => onUpdate(stream.id, { overlayLogoAnimation: v as any })}
                >
                  <SelectTrigger className="h-8 text-sm bg-slate-800/60 border-slate-600 text-slate-200" data-testid={`select-admin-logo-anim-${stream.id}`}>
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
            </div>
          )}

          {/* Mini overlay preview */}
          <div
            className="relative rounded overflow-hidden"
            style={{
              aspectRatio: stream.ratio === "mobile" ? "9/16" : "16/9",
              maxHeight: "110px",
              background: "linear-gradient(160deg, #1a2744 0%, #0f1b30 100%)",
              border: "1px solid rgba(51,65,85,0.8)"
            }}
            data-testid={`admin-overlay-preview-${stream.id}`}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-slate-700 text-[8px] font-mono tracking-widest">PREVIEW</span>
            </div>
            {(stream.overlayChannelName || stream.overlayHeadline) && (
              <div className="absolute bottom-4 left-0 flex items-stretch text-[6px] leading-tight">
                {stream.overlayChannelName && (
                  <div className="px-1.5 py-0.5 text-white font-bold flex items-center"
                    style={{ backgroundColor: stream.overlayBannerColor || "#c41e1e" }}>
                    {stream.overlayChannelName}
                  </div>
                )}
                {stream.overlayHeadline && (
                  <div className="px-1.5 py-0.5 text-white bg-gray-800/90 flex items-center">
                    {stream.overlayHeadline}
                  </div>
                )}
              </div>
            )}
            {stream.overlayTickerText && (
              <div
                className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-[5px] text-white overflow-hidden whitespace-nowrap"
                style={{ backgroundColor: (stream.overlayTickerColor || "#1a1a2e") + "E6" }}
              >
                <span className="inline-block animate-marquee">{stream.overlayTickerText}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {expanded && !stream.overlayEnabled && (
        <div className="border-t border-slate-700/40 px-3 py-2">
          <p className="text-xs text-slate-600">Enable the overlay toggle to show controls.</p>
        </div>
      )}
    </div>
  );
}
