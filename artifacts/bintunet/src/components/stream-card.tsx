import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Play, Square, RotateCcw, Trash2,
  Volume2, VolumeX, Monitor, Smartphone, Settings2, Terminal,
  Camera, Youtube, Link2, Copy, Check, BarChart2, Loader2,
  Lock, Unlock, ShieldAlert, Wifi, Usb, Radio, Upload, Film,
  RefreshCw, X as XIcon, RepeatIcon, ChevronDown, ChevronUp, Info, Image,
} from "lucide-react";
import { SiTiktok, SiX } from "react-icons/si";
import type { StreamConfig } from "@/types/schema";
import { LivePreview } from "./live-preview";
import { StatsWidget } from "./stats-widget";
import { StreamRecoveryPanel } from "./stream-recovery-panel";
import { useToast } from "@/hooks/use-toast";
import { getAuthToken } from "@/lib/queryClient";

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

interface StreamCardProps {
  stream: StreamConfig;
  logs: string[];
  stats: { subs: string | null; viewers: string | null; hasChat: boolean } | null;
  procStats?: { cpu: number; mem: number; frames?: number; uptime?: number };
  chatMessages: ChatMessage[];
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, data: Partial<StreamConfig>) => void;
  onToggleMute: (id: string) => void;
  onOpenMonitor?: (url: string, label: string) => void;
  index: number;
  isStarting?: boolean;
}

const STATUS_CONFIG = {
  idle:         { dot: "bg-zinc-500",    label: "Idle",         ring: "ring-zinc-500/20",    badgeCls: "bg-zinc-800 text-zinc-300 border-zinc-700" },
  streaming:    { dot: "bg-emerald-500 animate-pulse", label: "Live", ring: "ring-emerald-500/25", badgeCls: "bg-emerald-950 text-emerald-300 border-emerald-800" },
  error:        { dot: "bg-red-500",     label: "Error",        ring: "ring-red-500/20",     badgeCls: "bg-red-950 text-red-300 border-red-800" },
  reconnecting: { dot: "bg-amber-500 animate-pulse", label: "Reconnecting", ring: "ring-amber-500/20", badgeCls: "bg-amber-950 text-amber-300 border-amber-800" },
} as const;

const SOURCE_CONFIG = {
  tiktok:  { label: "TikTok",    Icon: SiTiktok, color: "text-pink-400",   bg: "bg-pink-500/10 border-pink-500/20" },
  youtube: { label: "YouTube",   Icon: Youtube,  color: "text-red-400",    bg: "bg-red-500/10 border-red-500/20" },
  camera:  { label: "Camera",    Icon: Camera,   color: "text-blue-400",   bg: "bg-blue-500/10 border-blue-500/20" },
  xspace:  { label: "X Space",   Icon: SiX,      color: "text-zinc-300",   bg: "bg-zinc-500/10 border-zinc-500/20" },
  upload:  { label: "Upload",    Icon: Film,     color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20" },
} as const;

type CameraMode = "guestroom" | "local" | "rtsp";

function getSourceDisplay(stream: StreamConfig): string {
  if (stream.sourceType === "youtube") return stream.youtubeSourceUrl || "";
  if (stream.sourceType === "camera") return stream.cameraDevice === "__browser__" ? "Guest Camera" : (stream.cameraDevice || "/dev/video0");
  if (stream.sourceType === "xspace") return stream.xspaceUrl ? "X Space" : "";
  if (stream.sourceType === "upload") return stream.uploadedVideoPath ? stream.uploadedVideoPath.split("/").pop() || "Uploaded" : "";
  return stream.tiktokUsername ? `@${stream.tiktokUsername}` : "";
}

function canStart(stream: StreamConfig): boolean {
  const hasOutput = !!(stream.youtubeStreamKey || stream.facebookRtmpUrl || stream.instagramStreamKey || stream.tiktokStreamKey);
  if (stream.sourceType === "youtube") return !!(stream.youtubeSourceUrl) && hasOutput;
  if (stream.sourceType === "camera") return !!(stream.cameraDevice) && hasOutput;
  if (stream.sourceType === "xspace") return !!(stream.xspaceUrl) && hasOutput;
  if (stream.sourceType === "upload") return !!(stream.uploadedVideoPath) && hasOutput;
  return !!(stream.tiktokUsername) && hasOutput;
}

function CameraLinkButton({ streamId }: { streamId: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const openCamera = async () => {
    setLoading(true);
    try {
      const token = getAuthToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const res = await fetch(`/api/streams/${streamId}/camera-token`, { credentials: "include", headers });
      if (!res.ok) throw new Error("Failed to generate camera link");
      const data = await res.json();
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  };

  return (
    <div>
      <Button
        onClick={openCamera}
        disabled={loading}
        className="w-full gap-2 font-bold tracking-wide uppercase text-xs h-9 bg-red-600 hover:bg-red-700 text-white border-0"
      >
        {loading ? <><Link2 className="w-3.5 h-3.5 animate-pulse" />Opening…</> : <><Radio className="w-3.5 h-3.5" />Open the Camera to Start Live Stream</>}
      </Button>
    </div>
  );
}

export function StreamCard({
  stream, logs, stats, procStats, chatMessages,
  onStart, onStop, onRestart, onDelete, onUpdate, onToggleMute, onOpenMonitor, index,
  isStarting = false,
}: StreamCardProps) {
  const { toast } = useToast();
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [logsOpen, setLogsOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [locked, setLocked] = useState(false);
  const [pendingAction, setPendingAction] = useState<"stop" | "restart" | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>("guestroom");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadFilename, setUploadFilename] = useState<string>("");
  type VerifyState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ok"; channelId: string; title: string | null; thumbnail: string | null }
    | { status: "error"; message: string };
  const [verifyState, setVerifyState] = useState<VerifyState>({ status: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const isActive = stream.status === "streaming" || stream.status === "reconnecting";
  const statusCfg = STATUS_CONFIG[stream.status] ?? STATUS_CONFIG.idle;
  const sourceType = (stream.sourceType || "tiktok") as keyof typeof SOURCE_CONFIG;
  const sourceCfg = SOURCE_CONFIG[sourceType] ?? SOURCE_CONFIG.tiktok;
  const SourceIcon = sourceCfg.Icon;
  const sourceDisplay = getSourceDisplay(stream);
  const hasPreview = sourceType === "tiktok" || sourceType === "youtube";

  const handleVideoUpload = async (file: File) => {
    setUploadProgress(0);
    setUploadFilename(file.name);
    const formData = new FormData();
    formData.append("video", file);
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/streams/${stream.id}/upload-video`);
      xhr.withCredentials = true;
      const token = getAuthToken();
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => {
        setUploadProgress(null);
        if (xhr.status === 200) {
          const data = JSON.parse(xhr.responseText);
          onUpdate(stream.id, { uploadedVideoPath: data.path });
          toast({ title: "Video uploaded", description: `${file.name} is ready to stream.` });
        } else {
          const err = JSON.parse(xhr.responseText);
          toast({ title: "Upload failed", description: err.message, variant: "destructive" });
        }
      };
      xhr.onerror = () => { setUploadProgress(null); toast({ title: "Upload failed", description: "Network error.", variant: "destructive" }); };
      xhr.send(formData);
    } catch (e: any) {
      setUploadProgress(null);
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    }
  };

  const handleRemoveVideo = async () => {
    try {
      const token = getAuthToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      await fetch(`/api/streams/${stream.id}/upload-video`, { method: "DELETE", credentials: "include", headers });
      onUpdate(stream.id, { uploadedVideoPath: "" });
      setUploadFilename("");
      toast({ title: "Video removed" });
    } catch { toast({ title: "Error removing video", variant: "destructive" }); }
  };

  useEffect(() => {
    if (logsOpen && logEndRef.current) logEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [logs, logsOpen]);

  useEffect(() => {
    if (sourceType === "camera" && cameraMode === "guestroom" && stream.cameraDevice !== "__browser__" && !isActive) {
      onUpdate(stream.id, { cameraDevice: "__browser__" });
    }
  }, [cameraMode, sourceType]);

  return (
    <>
      {showStats && (
        <StatsWidget
          streamId={stream.id}
          subs={stats?.subs ?? null}
          viewers={stats?.viewers ?? null}
          hasChat={stats?.hasChat ?? false}
          chatMessages={chatMessages}
          channelId={stream.youtubeChannelId}
        />
      )}

      <div
        className={`relative rounded-2xl border bg-card overflow-hidden transition-all ${statusCfg.ring} ring-1`}
        data-testid={`card-stream-${stream.id}`}
      >
        {/* ── Status accent line ── */}
        <div className={`h-0.5 w-full ${isActive ? (stream.status === "streaming" ? "bg-emerald-500" : "bg-amber-500") : "bg-transparent"}`} />

        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {/* Status dot */}
            <div className={`w-2 h-2 rounded-full shrink-0 ${statusCfg.dot}`} />

            {/* Stream number */}
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider shrink-0">
              Stream {index + 1}
            </span>

            {/* Source badge */}
            <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-xs font-medium shrink-0 ${sourceCfg.bg} ${sourceCfg.color}`}>
              <SourceIcon className="w-3 h-3" />
              {sourceCfg.label}
            </div>

            {/* Source display */}
            {sourceDisplay && (
              <span className="text-xs text-muted-foreground truncate min-w-0">{sourceDisplay}</span>
            )}

            {/* Status badge */}
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border shrink-0 ${statusCfg.badgeCls}`} data-testid={`badge-status-${stream.id}`}>
              {statusCfg.label}
            </span>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1 shrink-0">
            {isActive && procStats && (
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/50 border border-border/60 text-[10px] font-mono">
                <span className={procStats.cpu > 80 ? "text-red-400" : procStats.cpu > 50 ? "text-amber-400" : "text-emerald-400"}>
                  {procStats.cpu.toFixed(0)}%
                </span>
                <span className="text-muted-foreground/40">·</span>
                <span className="text-muted-foreground">{procStats.mem}M</span>
              </div>
            )}
            {isActive && (
              <button
                onClick={() => { setLocked((v) => !v); setPendingAction(null); }}
                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${locked ? "text-amber-400 bg-amber-500/10" : "text-muted-foreground hover:text-amber-400 hover:bg-muted/50"}`}
                title={locked ? "Locked — click to unlock" : "Lock stream"}
                data-testid={`button-lock-${stream.id}`}
              >
                {locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              </button>
            )}
            {stream.youtubeChannelId && (
              <button
                onClick={() => setShowStats((v) => !v)}
                className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${showStats ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                title="Stats widget"
                data-testid={`button-stats-${stream.id}`}
              >
                <BarChart2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={() => onDelete(stream.id)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
              data-testid={`button-delete-${stream.id}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* ── Live Preview (TikTok + YouTube) ── */}
          {hasPreview && (
            <LivePreview
              streamId={stream.id}
              sourceType={sourceType}
              tiktokUsername={stream.tiktokUsername}
              youtubeSourceUrl={stream.youtubeSourceUrl}
              ratio={stream.ratio as "mobile" | "desktop"}
              autoShow={false}
            />
          )}

          {/* ── Lock banner ── */}
          {isActive && locked && pendingAction === null && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-500/30 bg-amber-500/8 text-amber-400 text-xs font-medium">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              Stream locked — click the lock icon to allow stop/restart.
            </div>
          )}

          {/* ── Confirm action ── */}
          {isActive && locked && pendingAction !== null && (
            <div className="flex flex-col gap-2.5 px-3 py-3 rounded-xl border border-red-500/30 bg-red-500/8">
              <div className="flex items-center gap-2 text-red-400 text-xs font-semibold">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                {pendingAction === "stop" ? "Stop the live stream?" : "Restart the stream?"}
              </div>
              <p className="text-xs text-muted-foreground">
                {pendingAction === "stop" ? "Viewers will lose the stream immediately." : "Stream will briefly disconnect to reconnect."}
              </p>
              <div className="flex gap-2">
                <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={() => { if (pendingAction === "stop") onStop(stream.id); else onRestart(stream.id); setPendingAction(null); }}>
                  {pendingAction === "stop" ? "Yes, Stop" : "Yes, Restart"}
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setPendingAction(null)}>Cancel</Button>
              </div>
            </div>
          )}

          {/* ── Main Control Strip ── */}
          <div className="flex items-center gap-2 flex-wrap">
            {!isActive ? (
              sourceType === "camera" && cameraMode === "guestroom" ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-violet-500/20 bg-violet-500/8 text-xs text-muted-foreground flex-1">
                  <Radio className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  Guest starts stream from their camera link.
                </div>
              ) : (
                <Button
                  onClick={() => onStart(stream.id)}
                  disabled={!canStart(stream) || isStarting}
                  className="gap-2 h-9 px-5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white border-0 font-semibold"
                  data-testid={`button-start-${stream.id}`}
                >
                  {isStarting ? <><Loader2 className="w-4 h-4 animate-spin" />Starting…</> : <><Play className="w-4 h-4 fill-current" />Go Live</>}
                </Button>
              )
            ) : (
              <>
                <Button
                  variant="destructive"
                  className="gap-2 h-9 px-4 rounded-xl font-semibold"
                  onClick={() => { if (locked) { setPendingAction("stop"); return; } onStop(stream.id); }}
                  data-testid={`button-stop-${stream.id}`}
                >
                  {locked ? <Lock className="w-4 h-4" /> : <Square className="w-4 h-4 fill-current" />}
                  Stop
                </Button>
                <Button
                  variant="outline"
                  className="gap-2 h-9 px-4 rounded-xl font-medium"
                  onClick={() => { if (locked) { setPendingAction("restart"); return; } onRestart(stream.id); }}
                  data-testid={`button-restart-${stream.id}`}
                >
                  <RotateCcw className="w-4 h-4" />
                  Restart
                </Button>
              </>
            )}

            {/* Mute toggle */}
            <button
              onClick={() => onToggleMute(stream.id)}
              className={`flex items-center gap-1.5 h-9 px-3 rounded-xl border text-xs font-medium transition-colors ${
                stream.muted
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/15"
                  : "border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
              title={stream.muted ? "Unmute" : "Mute source audio"}
              data-testid={`button-mute-${stream.id}`}
            >
              {stream.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              {stream.muted ? "Muted" : "Audio"}
            </button>

            {/* Auto-restart pill */}
            <button
              onClick={() => onUpdate(stream.id, { autoRestart: !stream.autoRestart })}
              className={`flex items-center gap-1.5 h-9 px-3 rounded-xl border text-xs font-medium transition-colors ${
                stream.autoRestart
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15"
                  : "border-border bg-muted/30 text-muted-foreground hover:text-foreground hover:bg-muted/60"
              }`}
              title="Toggle auto-restart for 24/7 streaming"
              data-testid={`switch-autorestart-${stream.id}`}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              24/7
            </button>
          </div>

          {/* ── Configuration (collapsible) ── */}
          <div className="rounded-xl border border-border/60 overflow-hidden">
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
              data-testid={`button-toggle-settings-${stream.id}`}
            >
              <span className="flex items-center gap-2">
                <Settings2 className="w-3.5 h-3.5" />
                Configuration
              </span>
              {settingsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {settingsOpen && (
              <div className="px-3 pb-3 pt-1 space-y-4 border-t border-border/40">

                {/* Source selector */}
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Input Source</Label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(["tiktok", "youtube", "xspace"] as const).map((type) => {
                      const cfg = SOURCE_CONFIG[type];
                      const Icon = cfg.Icon;
                      const sel = sourceType === type;
                      return (
                        <button
                          key={type}
                          onClick={() => !isActive && onUpdate(stream.id, { sourceType: type })}
                          disabled={isActive}
                          data-testid={`button-source-${type}-${stream.id}`}
                          className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-medium transition-all ${
                            sel ? `${cfg.bg} ${cfg.color} border-opacity-60` : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          {cfg.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(["camera", "upload"] as const).map((type) => {
                      const cfg = SOURCE_CONFIG[type];
                      const Icon = cfg.Icon;
                      const sel = sourceType === type;
                      return (
                        <button
                          key={type}
                          onClick={() => !isActive && onUpdate(stream.id, { sourceType: type })}
                          disabled={isActive}
                          data-testid={`button-source-${type}-${stream.id}`}
                          className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-medium transition-all ${
                            sel ? `${cfg.bg} ${cfg.color} border-opacity-60` : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                          } disabled:opacity-40 disabled:cursor-not-allowed`}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          {cfg.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ── TikTok ── */}
                {sourceType === "tiktok" && (
                  <div className="space-y-2">
                    <Label htmlFor={`tiktok-${stream.id}`} className="text-xs flex items-center gap-1.5">
                      <SiTiktok className="w-3 h-3 text-pink-400" /> TikTok Username
                    </Label>
                    <Input
                      id={`tiktok-${stream.id}`}
                      placeholder="username (without @)"
                      value={stream.tiktokUsername}
                      onChange={(e) => onUpdate(stream.id, { tiktokUsername: e.target.value })}
                      disabled={isActive}
                      className="h-8 text-sm"
                      data-testid={`input-tiktok-${stream.id}`}
                    />
                    <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 space-y-2">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Tips for reliable TikTok streaming</p>
                      <ul className="space-y-1.5">
                        {[
                          "Username without @ — account must be live right now",
                          "Uses streamlink + yt-dlp with automatic failover",
                          "Enable 24/7 (Auto-Restart) for reconnect on drops",
                          "Ensure streamlink is installed on the server for best reliability",
                        ].map((tip, i) => (
                          <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
                            <span className="shrink-0 text-pink-400 font-bold">{i + 1}.</span>
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* ── YouTube ── */}
                {sourceType === "youtube" && (
                  <div className="space-y-2">
                    <Label htmlFor={`yt-src-${stream.id}`} className="text-xs flex items-center gap-1.5">
                      <Youtube className="w-3 h-3 text-red-400" /> YouTube Channel or URL
                    </Label>
                    <Input
                      id={`yt-src-${stream.id}`}
                      placeholder="@channelname  or  youtube.com/@channel/live"
                      value={stream.youtubeSourceUrl}
                      onChange={(e) => onUpdate(stream.id, { youtubeSourceUrl: e.target.value })}
                      disabled={isActive}
                      className="h-8 text-sm"
                      data-testid={`input-youtube-source-${stream.id}`}
                    />

                    <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 space-y-2">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">YouTube streaming tips</p>
                      <ul className="space-y-1.5">
                        {[
                          "Channel must be live — uses 4-tier yt-dlp fallback chain",
                          "tv_embedded client avoids bot detection & Proof-of-Origin issues",
                          "No cookies required — works with public live streams",
                          "Enable 24/7 (Auto-Restart) for auto-reconnect when source drops",
                        ].map((tip, i) => (
                          <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
                            <span className="shrink-0 text-red-400 font-bold">{i + 1}.</span>
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {/* ── X Space ── */}
                {sourceType === "xspace" && (
                  <div className="space-y-2">
                    <Label htmlFor={`xspace-${stream.id}`} className="text-xs flex items-center gap-1.5">
                      <SiX className="w-3 h-3" /> X Space URL
                    </Label>
                    <Input
                      id={`xspace-${stream.id}`}
                      placeholder="https://x.com/i/spaces/..."
                      value={stream.xspaceUrl}
                      onChange={(e) => onUpdate(stream.id, { xspaceUrl: e.target.value })}
                      disabled={isActive}
                      className="h-8 text-sm"
                      data-testid={`input-xspace-${stream.id}`}
                    />

                    {/* Background media upload */}
                    <Label className="text-xs flex items-center gap-1.5 pt-1">
                      <Image className="w-3 h-3 text-zinc-400" /> Background Media <span className="text-muted-foreground font-normal">(image or looped video)</span>
                    </Label>
                    {stream.xspaceVideoPath ? (
                      <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-2.5 py-2">
                        <Film className="w-3 h-3 text-zinc-400 shrink-0" />
                        <span className="flex-1 text-xs font-mono text-muted-foreground truncate">{stream.xspaceVideoPath.split("/").pop()}</span>
                        <button
                          disabled={isActive}
                          onClick={async () => {
                            const token = getAuthToken();
                            const headers: Record<string, string> = {};
                            if (token) headers["Authorization"] = `Bearer ${token}`;
                            await fetch(`/api/streams/${stream.id}/upload-xspace-media`, { method: "DELETE", credentials: "include", headers });
                            onUpdate(stream.id, { xspaceVideoPath: "" });
                            toast({ title: "Background media removed" });
                          }}
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                        >
                          <XIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div>
                        <label className={`flex items-center gap-2 rounded-lg border border-dashed border-zinc-600 bg-zinc-900/30 px-3 py-2.5 text-xs text-muted-foreground cursor-pointer hover:border-zinc-400 hover:text-foreground transition-colors ${isActive ? "pointer-events-none opacity-50" : ""}`}>
                          <Upload className="w-3.5 h-3.5 shrink-0" />
                          <span>Upload image or video (mp4, jpg, png…)</span>
                          <input
                            type="file"
                            accept=".mp4,.webm,.mov,.avi,.mkv,.m4v,.jpg,.jpeg,.png,.gif,.webp"
                            className="hidden"
                            disabled={isActive}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const formData = new FormData();
                              formData.append("media", file);
                              const xhr = new XMLHttpRequest();
                              xhr.open("POST", `/api/streams/${stream.id}/upload-xspace-media`);
                              xhr.withCredentials = true;
                              const token = getAuthToken();
                              if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
                              xhr.onload = () => {
                                if (xhr.status === 200) {
                                  const data = JSON.parse(xhr.responseText);
                                  onUpdate(stream.id, { xspaceVideoPath: data.path });
                                  toast({ title: "Background uploaded", description: `${file.name} ready.` });
                                } else {
                                  toast({ title: "Upload failed", description: JSON.parse(xhr.responseText)?.message, variant: "destructive" });
                                }
                              };
                              xhr.onerror = () => toast({ title: "Upload failed", variant: "destructive" });
                              xhr.send(formData);
                            }}
                          />
                        </label>
                      </div>
                    )}

                    {/* Fallback: image URL */}
                    {!stream.xspaceVideoPath && (
                      <>
                        <Label htmlFor={`xspace-img-${stream.id}`} className="text-xs flex items-center gap-1.5">
                          or paste an image URL
                        </Label>
                        <Input
                          id={`xspace-img-${stream.id}`}
                          placeholder="https://… (X logo, profile photo…)"
                          value={stream.xspaceImageUrl ?? ""}
                          onChange={(e) => onUpdate(stream.id, { xspaceImageUrl: e.target.value })}
                          disabled={isActive}
                          className="h-8 text-sm"
                        />
                      </>
                    )}
                    <p className="text-[11px] text-muted-foreground">Audio-only restream. Upload a picture or video (looped, muted) to show on the video background. Space must be live.</p>
                  </div>
                )}

                {/* ── Camera ── */}
                {sourceType === "camera" && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-1.5">
                      {(["guestroom", "local", "rtsp"] as CameraMode[]).map((mode) => {
                        const icons: Record<CameraMode, React.ReactNode> = { guestroom: <Link2 className="w-3 h-3" />, local: <Usb className="w-3 h-3" />, rtsp: <Wifi className="w-3 h-3" /> };
                        const labels: Record<CameraMode, string> = { guestroom: "Guest Room", local: "USB/Local", rtsp: "RTSP/IP" };
                        const sel = cameraMode === mode;
                        return (
                          <button key={mode} onClick={() => setCameraMode(mode)}
                            className={`flex items-center justify-center gap-1 py-2 rounded-lg border text-xs font-medium transition-all ${sel ? "border-violet-500/50 bg-violet-500/10 text-violet-400" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
                          >{icons[mode]} {labels[mode]}</button>
                        );
                      })}
                    </div>
                    {cameraMode === "guestroom" && (
                      <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
                        <p className="text-xs font-semibold text-violet-300 flex items-center gap-1.5"><Camera className="w-3.5 h-3.5" />Guest Camera Room</p>
                        <p className="text-[11px] text-muted-foreground">Generate a link for your guest. They open it in any browser — no app needed.</p>
                        <CameraLinkButton streamId={stream.id} />
                      </div>
                    )}
                    {cameraMode === "local" && (
                      <div className="space-y-1.5">
                        <Label htmlFor={`cam-${stream.id}`} className="text-xs">Device Path</Label>
                        <Input id={`cam-${stream.id}`} placeholder="/dev/video0" value={stream.cameraDevice} onChange={(e) => onUpdate(stream.id, { cameraDevice: e.target.value })} disabled={isActive} className="h-8 text-sm" data-testid={`input-camera-${stream.id}`} />
                        <p className="text-[11px] text-muted-foreground">List devices: <code className="bg-muted px-1 rounded">ls /dev/video*</code></p>
                      </div>
                    )}
                    {cameraMode === "rtsp" && (
                      <div className="space-y-1.5">
                        <Label htmlFor={`cam-rtsp-${stream.id}`} className="text-xs">RTSP / HTTP URL</Label>
                        <Input id={`cam-rtsp-${stream.id}`} placeholder="rtsp://admin:pass@192.168.1.x:554/stream" value={stream.cameraDevice} onChange={(e) => onUpdate(stream.id, { cameraDevice: e.target.value })} disabled={isActive} className="h-8 text-sm" data-testid={`input-camera-${stream.id}`} />
                        <p className="text-[11px] text-muted-foreground">IP/Hikvision/Reolink/DroidCam — server and camera must share the same network.</p>
                      </div>
                    )}
                  </div>
                )}

                {/* ── Upload ── */}
                {sourceType === "upload" && (
                  <div className="space-y-3">
                    <div
                      className={`relative rounded-xl border-2 border-dashed p-4 text-center cursor-pointer transition-all hover:border-violet-500/50 hover:bg-violet-500/5 ${stream.uploadedVideoPath ? "border-violet-500/40 bg-violet-500/5" : "border-border/60"}`}
                      onClick={() => !isActive && fileInputRef.current?.click()}
                    >
                      <input ref={fileInputRef} type="file" accept=".mp4,.webm,.mov,.avi,.mkv,.m4v,.ts" className="hidden"
                        onChange={(e) => { const file = e.target.files?.[0]; if (file) handleVideoUpload(file); e.target.value = ""; }}
                      />
                      {uploadProgress !== null ? (
                        <div className="space-y-2">
                          <Loader2 className="w-7 h-7 text-violet-500 animate-spin mx-auto" />
                          <div className="w-full bg-muted rounded-full h-1.5"><div className="bg-violet-500 h-1.5 rounded-full transition-all" style={{ width: `${uploadProgress}%` }} /></div>
                          <p className="text-xs text-muted-foreground">{uploadProgress}%</p>
                        </div>
                      ) : stream.uploadedVideoPath ? (
                        <div className="space-y-1.5">
                          <Film className="w-6 h-6 text-violet-500 mx-auto" />
                          <p className="text-xs font-medium truncate">{stream.uploadedVideoPath.split("/").pop()}</p>
                          <div className="flex items-center justify-center gap-3">
                            <button onClick={(e) => { e.stopPropagation(); if (!isActive) fileInputRef.current?.click(); }} disabled={isActive} className="text-[11px] text-violet-400 hover:text-violet-300 flex items-center gap-1 disabled:opacity-40"><RefreshCw className="w-3 h-3" />Replace</button>
                            <button onClick={(e) => { e.stopPropagation(); if (!isActive) handleRemoveVideo(); }} disabled={isActive} className="text-[11px] text-red-400 hover:text-red-300 flex items-center gap-1 disabled:opacity-40"><XIcon className="w-3 h-3" />Remove</button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          <Upload className="w-6 h-6 text-muted-foreground mx-auto" />
                          <p className="text-xs font-medium">Click to upload a video</p>
                          <p className="text-[11px] text-muted-foreground">MP4, WebM, MOV, MKV — up to 2 GB</p>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
                      <div className="flex items-center gap-2"><RepeatIcon className="w-3.5 h-3.5 text-violet-400" /><span className="text-xs font-medium">Loop 24/7</span></div>
                      <Switch checked={stream.uploadedVideoLoop !== false} onCheckedChange={(v) => onUpdate(stream.id, { uploadedVideoLoop: v })} disabled={isActive} />
                    </div>
                  </div>
                )}

                {/* ── Output Destinations ── */}
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Output Destinations</Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor={`youtube-key-${stream.id}`} className="text-xs flex items-center gap-1.5"><Youtube className="w-3 h-3 text-red-400" />YouTube Key</Label>
                      <Input id={`youtube-key-${stream.id}`} placeholder="xxxx-xxxx-xxxx" type="password" value={stream.youtubeStreamKey} onChange={(e) => onUpdate(stream.id, { youtubeStreamKey: e.target.value })} disabled={isActive} className="h-8 text-sm" data-testid={`input-youtube-${stream.id}`} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`facebook-${stream.id}`} className="text-xs flex items-center gap-1.5"><span className="text-blue-400 font-bold text-[10px]">fb</span>Facebook Key <span className="text-muted-foreground font-normal text-[10px]">(opt.)</span></Label>
                      <Input id={`facebook-${stream.id}`} placeholder="Optional" type="password" value={stream.facebookRtmpUrl} onChange={(e) => onUpdate(stream.id, { facebookRtmpUrl: e.target.value })} disabled={isActive} className="h-8 text-sm" data-testid={`input-facebook-${stream.id}`} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`instagram-key-${stream.id}`} className="text-xs flex items-center gap-1.5">
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{color:"#E1306C"}}>
                          <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                          <circle cx="12" cy="12" r="4"/>
                          <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" stroke="none"/>
                        </svg>
                        Instagram Key <span className="text-muted-foreground font-normal text-[10px]">(opt.)</span>
                      </Label>
                      <Input id={`instagram-key-${stream.id}`} placeholder="Instagram stream key" type="password" value={stream.instagramStreamKey} onChange={(e) => onUpdate(stream.id, { instagramStreamKey: e.target.value })} disabled={isActive} className="h-8 text-sm" data-testid={`input-instagram-${stream.id}`} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`tiktok-key-${stream.id}`} className="text-xs flex items-center gap-1.5"><SiTiktok className="w-3 h-3 text-pink-400" />TikTok Key <span className="text-muted-foreground font-normal text-[10px]">(opt.)</span></Label>
                      <Input id={`tiktok-key-${stream.id}`} placeholder="TikTok Live Studio stream key" type="password" value={stream.tiktokStreamKey} onChange={(e) => onUpdate(stream.id, { tiktokStreamKey: e.target.value })} disabled={isActive} className="h-8 text-sm" data-testid={`input-tiktok-key-${stream.id}`} />
                    </div>
                  </div>
                </div>

                {/* ── Channel ID ── */}
                <div className="space-y-1">
                  <Label htmlFor={`channel-id-${stream.id}`} className="text-xs flex items-center gap-1.5">
                    <BarChart2 className="w-3 h-3 text-violet-400" />YouTube Channel ID <span className="text-muted-foreground font-normal text-[10px]">(for stats &amp; chat)</span>
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id={`channel-id-${stream.id}`}
                      placeholder="UCxxxxxxxxxxxxxxxxxxxxxxxx  or  @channelname"
                      value={stream.youtubeChannelId}
                      onChange={(e) => {
                        onUpdate(stream.id, { youtubeChannelId: e.target.value });
                        setVerifyState({ status: "idle" });
                      }}
                      className="h-8 text-sm flex-1"
                      data-testid={`input-channel-id-${stream.id}`}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-2.5 text-xs shrink-0"
                      disabled={!stream.youtubeChannelId?.trim() || verifyState.status === "loading"}
                      onClick={async () => {
                        setVerifyState({ status: "loading" });
                        try {
                          const res = await fetch("/api/youtube/verify-channel", {
                            method: "POST",
                            credentials: "include",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ url: stream.youtubeChannelId }),
                          });
                          const data = await res.json();
                          if (!res.ok) {
                            setVerifyState({ status: "error", message: data.message ?? "Verification failed" });
                          } else {
                            setVerifyState({ status: "ok", channelId: data.channelId, title: data.title, thumbnail: data.thumbnail });
                            onUpdate(stream.id, { youtubeChannelId: data.channelId });
                          }
                        } catch (e: any) {
                          setVerifyState({ status: "error", message: e.message ?? "Network error" });
                        }
                      }}
                    >
                      {verifyState.status === "loading"
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Check className="w-3 h-3" />}
                      <span className="ml-1">Verify</span>
                    </Button>
                  </div>
                  {/* Verification result */}
                  {verifyState.status === "ok" && (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-2.5 py-2 mt-1">
                      {verifyState.thumbnail && (
                        <img src={verifyState.thumbnail} alt="" className="w-7 h-7 rounded-full shrink-0 object-cover" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-emerald-300 truncate">{verifyState.title}</p>
                        <p className="text-[10px] text-emerald-400/70 font-mono truncate">{verifyState.channelId}</p>
                      </div>
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    </div>
                  )}
                  {verifyState.status === "error" && (
                    <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-950/30 px-2.5 py-2 mt-1">
                      <XIcon className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <p className="text-xs text-red-300">{verifyState.message}</p>
                    </div>
                  )}
                </div>

                {/* ── Quality Row ── */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Layout</Label>
                    <Select value={stream.ratio} onValueChange={(v) => onUpdate(stream.id, { ratio: v as any })} disabled={isActive}>
                      <SelectTrigger className="h-8 text-xs" data-testid={`select-ratio-${stream.id}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mobile"><span className="flex items-center gap-1.5 text-xs"><Smartphone className="w-3 h-3" />Mobile</span></SelectItem>
                        <SelectItem value="desktop"><span className="flex items-center gap-1.5 text-xs"><Monitor className="w-3 h-3" />Desktop</span></SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Quality</Label>
                    <Select value={stream.quality} onValueChange={(v) => onUpdate(stream.id, { quality: v as any })} disabled={isActive}>
                      <SelectTrigger className="h-8 text-xs" data-testid={`select-quality-${stream.id}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="best">Best</SelectItem>
                        <SelectItem value="720p">720p</SelectItem>
                        <SelectItem value="480p">480p</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">FPS</Label>
                    <Select value={stream.fps} onValueChange={(v) => onUpdate(stream.id, { fps: v as any })} disabled={isActive}>
                      <SelectTrigger className="h-8 text-xs" data-testid={`select-fps-${stream.id}`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="20">20</SelectItem>
                        <SelectItem value="24">24</SelectItem>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="30">30</SelectItem>
                        <SelectItem value="60">60</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Encoder Speed</Label>
                    <Select value={(stream as any).encoderPreset ?? "veryfast"} onValueChange={(v) => onUpdate(stream.id, { encoderPreset: v } as any)} disabled={isActive}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ultrafast">ultrafast (lowest CPU)</SelectItem>
                        <SelectItem value="veryfast">veryfast (recommended)</SelectItem>
                        <SelectItem value="faster">faster (better quality)</SelectItem>
                        <SelectItem value="fast">fast (best quality)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* ── Logs (collapsible) ── */}
          {logs.length > 0 && (
            <div className="rounded-xl border border-border/60 overflow-hidden">
              <button
                onClick={() => setLogsOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                data-testid={`button-toggle-logs-${stream.id}`}
              >
                <span className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5" />
                  Logs
                  <span className="bg-muted rounded-full px-1.5 py-0.5 text-[10px] font-mono">{logs.length}</span>
                </span>
                {logsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {logsOpen && (
                <ScrollArea className="h-40 border-t border-border/40">
                  <div className="p-3 space-y-0.5">
                    {logs.map((line, i) => {
                      const isErr = /error|fail|fatal/i.test(line);
                      const isWarn = /warn/i.test(line);
                      return (
                        <p key={i} className={`text-[10px] font-mono leading-relaxed ${isErr ? "text-red-400" : isWarn ? "text-amber-400" : "text-muted-foreground"}`}>{line}</p>
                      );
                    })}
                    <div ref={logEndRef} />
                  </div>
                </ScrollArea>
              )}
            </div>
          )}

          {/* ── Recovery Status (collapsible) ── */}
          {(isActive || stream.status === "error" || stream.status === "reconnecting") && (
            <div className="rounded-xl border border-border/60 overflow-hidden">
              <button
                onClick={() => setRecoveryOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
                data-testid={`button-toggle-recovery-${stream.id}`}
              >
                <span className="flex items-center gap-2">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Recovery
                </span>
                {recoveryOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {recoveryOpen && (
                <div className="border-t border-border/40">
                  <StreamRecoveryPanel streamId={stream.id} streamStatus={stream.status} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
