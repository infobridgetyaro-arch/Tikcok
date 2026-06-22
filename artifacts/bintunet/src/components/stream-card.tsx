import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Play, Square, RotateCcw, Trash2, ChevronDown, ChevronUp,
  Volume2, VolumeX, Monitor, Smartphone, Settings2, Terminal,
  Camera, Info, Wifi, Youtube,
  Link2, Copy, Check, BarChart2, Loader2, Lock, Unlock, ShieldAlert, Tv,
  Usb, Radio, Upload, Film, RefreshCw, X as XIcon, RepeatIcon,
} from "lucide-react";
import { SiTiktok, SiX } from "react-icons/si";
import type { StreamConfig } from "@/types/schema";
import { LivePreview } from "./live-preview";
import { StatsWidget } from "./stats-widget";
import { useToast } from "@/hooks/use-toast";

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

const statusConfig = {
  idle: { color: "bg-gray-400 dark:bg-gray-500", label: "Idle", badgeVariant: "secondary" as const },
  streaming: { color: "bg-emerald-500", label: "Live", badgeVariant: "default" as const },
  error: { color: "bg-red-500", label: "Error", badgeVariant: "destructive" as const },
  reconnecting: { color: "bg-amber-500", label: "Reconnecting", badgeVariant: "secondary" as const },
};

const sourceTypeConfig = {
  tiktok: { label: "TikTok", icon: SiTiktok, color: "text-pink-500" },
  youtube: { label: "YouTube", icon: Youtube, color: "text-red-500" },
  camera: { label: "Camera", icon: Camera, color: "text-blue-500" },
  xspace: { label: "X Space", icon: SiX, color: "text-foreground" },
  upload: { label: "Upload", icon: Film, color: "text-violet-500" },
};

type CameraMode = "guestroom" | "local" | "rtsp";

function CameraLinkButton({ streamId }: { streamId: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [cameraUrl, setCameraUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/streams/${streamId}/camera-token`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to generate link");
      const data = await res.json();
      setCameraUrl(data.url);
      await navigator.clipboard.writeText(data.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
      toast({ title: "Camera link ready!", description: "Copied to clipboard. Open on your phone when streaming starts." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
    setLoading(false);
  };

  const copyUrl = async () => {
    if (!cameraUrl) return;
    await navigator.clipboard.writeText(cameraUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Generate a phone-friendly monitoring link for chat and status.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={generate}
          disabled={loading}
          className="gap-1.5 text-xs h-8 shrink-0"
        >
          {loading ? (
            <><Link2 className="w-3.5 h-3.5 animate-pulse" /> Generating…</>
          ) : (
            <><Link2 className="w-3.5 h-3.5" /> Generate Link</>
          )}
        </Button>
      </div>
      {cameraUrl && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <span className="flex-1 text-xs font-mono text-muted-foreground truncate" title={cameraUrl}>{cameraUrl}</span>
          <Button variant="ghost" size="icon" className="w-6 h-6 shrink-0" onClick={copyUrl} title="Copy link">
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
          </Button>
          <a href={cameraUrl} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="icon" className="w-6 h-6 shrink-0">
              <Link2 className="w-3 h-3" />
            </Button>
          </a>
        </div>
      )}
    </div>
  );
}

function getSourceDisplay(stream: StreamConfig): string {
  if (stream.sourceType === "youtube") return stream.youtubeSourceUrl || "";
  if (stream.sourceType === "camera") return stream.cameraDevice === "__browser__" ? "Guest Camera" : (stream.cameraDevice || "/dev/video0");
  if (stream.sourceType === "xspace") return stream.xspaceUrl ? "X Space" : "";
  if (stream.sourceType === "upload") return stream.uploadedVideoPath ? stream.uploadedVideoPath.split("/").pop() || "Uploaded Video" : "";
  return stream.tiktokUsername ? `@${stream.tiktokUsername}` : "";
}

function canStart(stream: StreamConfig): boolean {
  const hasOutput = !!(stream.youtubeStreamKey || stream.facebookRtmpUrl || stream.tiktokStreamKey);
  if (stream.sourceType === "youtube") return !!(stream.youtubeSourceUrl) && hasOutput;
  if (stream.sourceType === "camera") return !!(stream.cameraDevice) && hasOutput;
  if (stream.sourceType === "xspace") return !!(stream.xspaceUrl) && hasOutput;
  if (stream.sourceType === "upload") return !!(stream.uploadedVideoPath) && hasOutput;
  return !!(stream.tiktokUsername) && hasOutput;
}

export function StreamCard({
  stream, logs, stats, procStats, chatMessages,
  onStart, onStop, onRestart, onDelete, onUpdate, onToggleMute, onOpenMonitor, index,
  isStarting = false,
}: StreamCardProps) {
  const { toast } = useToast();
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [logsOpen, setLogsOpen] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [locked, setLocked] = useState(false);
  const [pendingAction, setPendingAction] = useState<"stop" | "restart" | null>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>("guestroom");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadFilename, setUploadFilename] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const isActive = stream.status === "streaming" || stream.status === "reconnecting";
  const config = statusConfig[stream.status];
  const sourceType = (stream.sourceType || "tiktok") as keyof typeof sourceTypeConfig;
  const SourceIcon = sourceTypeConfig[sourceType]?.icon ?? Film;

  const handleVideoUpload = async (file: File) => {
    setUploadProgress(0);
    setUploadFilename(file.name);
    const formData = new FormData();
    formData.append("video", file);
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/streams/${stream.id}/upload-video`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
      };
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
      xhr.onerror = () => {
        setUploadProgress(null);
        toast({ title: "Upload failed", description: "Network error during upload.", variant: "destructive" });
      };
      xhr.send(formData);
    } catch (e: any) {
      setUploadProgress(null);
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    }
  };

  const handleRemoveVideo = async () => {
    try {
      await fetch(`/api/streams/${stream.id}/upload-video`, { method: "DELETE", credentials: "include" });
      onUpdate(stream.id, { uploadedVideoPath: "" });
      setUploadFilename("");
      toast({ title: "Video removed" });
    } catch {
      toast({ title: "Error removing video", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (logsOpen && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, logsOpen]);

  // Auto-set cameraDevice to __browser__ when guestroom tab is active
  useEffect(() => {
    if (sourceType === "camera" && cameraMode === "guestroom" && stream.cameraDevice !== "__browser__" && !isActive) {
      onUpdate(stream.id, { cameraDevice: "__browser__" });
    }
  }, [cameraMode, sourceType]);

  const sourceDisplay = getSourceDisplay(stream);

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

      <Card className="relative" data-testid={`card-stream-${stream.id}`}>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${config.color} ${isActive ? "animate-pulse" : ""}`} />
              <CardTitle className="text-base truncate">
                Stream {index + 1}
                {sourceDisplay && (
                  <span className="text-muted-foreground font-normal text-sm ml-2 flex items-center gap-1 inline-flex">
                    <SourceIcon className={`w-3 h-3 ${sourceTypeConfig[sourceType].color}`} />
                    {sourceDisplay}
                  </span>
                )}
              </CardTitle>
            </div>
            <Badge variant={config.badgeVariant} className="text-xs shrink-0" data-testid={`badge-status-${stream.id}`}>
              {config.label}
            </Badge>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {isActive && procStats && (
              <div
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold border"
                style={{
                  background: "rgba(var(--muted)/0.4)",
                  borderColor: "rgba(var(--border)/0.6)",
                }}
                title="FFmpeg CPU & RAM usage"
              >
                <span className={procStats.cpu > 80 ? "text-red-500" : procStats.cpu > 50 ? "text-amber-500" : "text-emerald-500"}>
                  {procStats.cpu.toFixed(1)}%
                </span>
                <span className="text-muted-foreground/60">·</span>
                <span className="text-muted-foreground">{procStats.mem}MB</span>
              </div>
            )}
            {isActive && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => { setLocked((v) => !v); setPendingAction(null); }}
                className={`w-7 h-7 transition-colors ${locked ? "text-amber-500 hover:text-amber-400" : "text-muted-foreground hover:text-amber-500"}`}
                title={locked ? "Stream locked — click to unlock" : "Lock stream (prevents accidental stop/restart)"}
                data-testid={`button-lock-${stream.id}`}
              >
                {locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
              </Button>
            )}
            {stream.youtubeChannelId && (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setShowStats((v) => !v)}
                className={`w-7 h-7 ${showStats ? "text-primary" : "text-muted-foreground"}`}
                title="Toggle stats widget"
                data-testid={`button-stats-${stream.id}`}
              >
                <BarChart2 className="w-4 h-4" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              onClick={() => onDelete(stream.id)}
              className="w-7 h-7 text-muted-foreground"
              data-testid={`button-delete-${stream.id}`}
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground" data-testid={`button-toggle-settings-${stream.id}`}>
                <span className="flex items-center gap-2">
                  <Settings2 className="w-4 h-4" />
                  Configuration
                </span>
                {settingsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3 space-y-4">

              {/* ── Input source selector (3+2 grid) ── */}
              <div className="space-y-2">
                <Label className="text-sm">Input Source</Label>
                <div className="grid grid-cols-3 gap-2">
                  {(["tiktok", "youtube", "xspace"] as const).map((type) => {
                    const cfg = sourceTypeConfig[type];
                    const Icon = cfg.icon;
                    const selected = sourceType === type;
                    return (
                      <button
                        key={type}
                        onClick={() => !isActive && onUpdate(stream.id, { sourceType: type })}
                        disabled={isActive}
                        data-testid={`button-source-${type}-${stream.id}`}
                        className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs font-medium transition-all ${
                          selected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${selected ? "text-primary" : cfg.color}`} />
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(["camera", "upload"] as const).map((type) => {
                    const cfg = sourceTypeConfig[type];
                    const Icon = cfg.icon;
                    const selected = sourceType === type;
                    return (
                      <button
                        key={type}
                        onClick={() => !isActive && onUpdate(stream.id, { sourceType: type })}
                        disabled={isActive}
                        data-testid={`button-source-${type}-${stream.id}`}
                        className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs font-medium transition-all ${
                          selected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
                        } disabled:opacity-50 disabled:cursor-not-allowed`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${selected ? "text-primary" : cfg.color}`} />
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── TikTok source ── */}
              {sourceType === "tiktok" && (
                <div className="space-y-2">
                  <Label htmlFor={`tiktok-${stream.id}`} className="text-sm flex items-center gap-1.5">
                    <SiTiktok className="w-3.5 h-3.5 text-pink-500" /> TikTok Username
                  </Label>
                  <Input
                    id={`tiktok-${stream.id}`}
                    placeholder="username (without @)"
                    value={stream.tiktokUsername}
                    onChange={(e) => onUpdate(stream.id, { tiktokUsername: e.target.value })}
                    disabled={isActive}
                    data-testid={`input-tiktok-${stream.id}`}
                  />
                </div>
              )}

              {/* ── YouTube source ── */}
              {sourceType === "youtube" && (
                <div className="space-y-2">
                  <Label htmlFor={`yt-src-${stream.id}`} className="text-sm flex items-center gap-1.5">
                    <Youtube className="w-3.5 h-3.5 text-red-500" /> YouTube Username or URL
                  </Label>
                  <Input
                    id={`yt-src-${stream.id}`}
                    placeholder="@channelname  or  youtube.com/watch?v=..."
                    value={stream.youtubeSourceUrl}
                    onChange={(e) => onUpdate(stream.id, { youtubeSourceUrl: e.target.value })}
                    disabled={isActive}
                    data-testid={`input-youtube-source-${stream.id}`}
                  />
                  <p className="text-xs text-muted-foreground">
                    Uses <code className="bg-muted px-1 rounded">streamlink</code> — channel must be live.
                  </p>
                </div>
              )}

              {/* ── X Space source ── */}
              {sourceType === "xspace" && (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor={`xspace-${stream.id}`} className="text-sm flex items-center gap-1.5">
                      <SiX className="w-3.5 h-3.5" /> X Space URL
                    </Label>
                    <Input
                      id={`xspace-${stream.id}`}
                      placeholder="https://x.com/i/spaces/..."
                      value={stream.xspaceUrl}
                      onChange={(e) => onUpdate(stream.id, { xspaceUrl: e.target.value })}
                      disabled={isActive}
                      data-testid={`input-xspace-${stream.id}`}
                    />
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 space-y-1.5">
                      <p className="text-xs font-medium flex items-center gap-1.5">
                        <Radio className="w-3 h-3 text-sky-500" /> Audio-only restream
                      </p>
                      <ul className="space-y-1">
                        {[
                          "Paste the full X Space URL (https://x.com/i/spaces/…)",
                          "Space must be live when you press Start",
                          "Audio is pulled via yt-dlp — video output uses a gradient background",
                          "yt-dlp must be installed on the server",
                        ].map((tip, i) => (
                          <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                            <span className="shrink-0 text-primary font-bold">{i + 1}.</span>
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Camera source — sub-tabs ── */}
              {sourceType === "camera" && (
                <div className="space-y-3">
                  {/* Camera mode sub-tabs */}
                  <div className="grid grid-cols-3 gap-1.5">
                    {(["guestroom", "local", "rtsp"] as CameraMode[]).map((mode) => {
                      const icons: Record<CameraMode, React.ReactNode> = {
                        guestroom: <Link2 className="w-3.5 h-3.5" />,
                        local: <Usb className="w-3.5 h-3.5" />,
                        rtsp: <Wifi className="w-3.5 h-3.5" />,
                      };
                      const labels: Record<CameraMode, string> = {
                        guestroom: "Guest Room",
                        local: "USB / Local",
                        rtsp: "RTSP / IP",
                      };
                      const selected = cameraMode === mode;
                      return (
                        <button
                          key={mode}
                          onClick={() => setCameraMode(mode)}
                          className={`flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-medium transition-all ${
                            selected
                              ? mode === "guestroom"
                                ? "border-violet-500/70 bg-violet-500/10 text-violet-400"
                                : "border-blue-500/70 bg-blue-500/10 text-blue-400"
                              : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                          }`}
                        >
                          {icons[mode]}
                          {labels[mode]}
                        </button>
                      );
                    })}
                  </div>

                  {/* ── Guest Room ── */}
                  {cameraMode === "guestroom" && (
                    <div className="space-y-3">
                      {/* Invite card */}
                      <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-3">
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center shrink-0">
                            <Camera className="w-4 h-4 text-violet-400" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-foreground">Guest Camera Room</p>
                            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                              Generate a link and share it with your guest. They open it in any browser — no app needed. Their camera streams directly into this broadcast.
                            </p>
                          </div>
                        </div>
                        <CameraLinkButton streamId={stream.id} />
                      </div>

                      {/* Guest experience callouts */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {[
                          { icon: <Smartphone className="w-3.5 h-3.5 text-violet-400" />, title: "Any Device", desc: "Phone, tablet, or laptop browser" },
                          { icon: <Radio className="w-3.5 h-3.5 text-emerald-400" />, title: "Sees Chat", desc: "Live YouTube chat shown to guest" },
                          { icon: <Check className="w-3.5 h-3.5 text-blue-400" />, title: "No Install", desc: "Works with camera permission only" },
                        ].map((item) => (
                          <div key={item.title} className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-1">
                            <div className="flex items-center gap-1.5 font-medium text-xs">{item.icon}{item.title}</div>
                            <p className="text-[11px] text-muted-foreground">{item.desc}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── USB / Local ── */}
                  {cameraMode === "local" && (
                    <div className="space-y-2">
                      <Label htmlFor={`cam-${stream.id}`} className="text-sm flex items-center gap-1.5">
                        <Usb className="w-3.5 h-3.5 text-blue-500" /> Device Path
                      </Label>
                      <Input
                        id={`cam-${stream.id}`}
                        placeholder="/dev/video0"
                        value={stream.cameraDevice}
                        onChange={(e) => onUpdate(stream.id, { cameraDevice: e.target.value })}
                        disabled={isActive}
                        data-testid={`input-camera-${stream.id}`}
                      />
                      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 space-y-1">
                        <p className="text-xs font-medium flex items-center gap-1.5">
                          <Info className="w-3 h-3 text-blue-400" /> USB Webcam / V4L2
                        </p>
                        <ul className="space-y-0.5">
                          <li className="text-xs text-muted-foreground">Plug webcam into the server via USB</li>
                          <li className="text-xs text-muted-foreground">
                            List devices: <code className="bg-background border rounded px-1">ls /dev/video*</code>
                          </li>
                          <li className="text-xs text-muted-foreground">Typically <code className="bg-background border rounded px-1">/dev/video0</code>, <code className="bg-background border rounded px-1">/dev/video2</code>, etc.</li>
                        </ul>
                      </div>
                    </div>
                  )}

                  {/* ── RTSP / IP Camera ── */}
                  {cameraMode === "rtsp" && (
                    <div className="space-y-2">
                      <Label htmlFor={`cam-rtsp-${stream.id}`} className="text-sm flex items-center gap-1.5">
                        <Wifi className="w-3.5 h-3.5 text-emerald-500" /> RTSP / HTTP URL
                      </Label>
                      <Input
                        id={`cam-rtsp-${stream.id}`}
                        placeholder="rtsp://admin:password@192.168.1.x:554/stream"
                        value={stream.cameraDevice}
                        onChange={(e) => onUpdate(stream.id, { cameraDevice: e.target.value })}
                        disabled={isActive}
                        data-testid={`input-camera-${stream.id}`}
                      />
                      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 space-y-1.5">
                        <p className="text-xs font-medium flex items-center gap-1.5">
                          <Info className="w-3 h-3 text-emerald-400" /> IP / Network Camera
                        </p>
                        <ul className="space-y-0.5">
                          {[
                            <>Hikvision / Dahua: <code className="bg-background border rounded px-1 text-[10px]">rtsp://admin:pass@IP:554/Streaming/Channels/1</code></>,
                            <>Reolink: <code className="bg-background border rounded px-1 text-[10px]">rtsp://admin:pass@IP:554/h264Preview_01_main</code></>,
                            <>DroidCam (Android): <code className="bg-background border rounded px-1 text-[10px]">rtsp://PHONE_IP:4747/video</code></>,
                            "Camera and server must be on the same network",
                          ].map((tip, i) => (
                            <li key={i} className="text-xs text-muted-foreground">{tip}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Upload Video source ── */}
              {sourceType === "upload" && (
                <div className="space-y-3">
                  <Label className="text-sm flex items-center gap-1.5">
                    <Film className="w-3.5 h-3.5 text-violet-500" /> Video File Source
                  </Label>

                  {/* Drop zone / file picker */}
                  <div
                    className={`relative rounded-xl border-2 border-dashed p-5 text-center transition-all cursor-pointer hover:border-violet-500/60 hover:bg-violet-500/5 ${
                      stream.uploadedVideoPath ? "border-violet-500/40 bg-violet-500/5" : "border-border"
                    }`}
                    onClick={() => !isActive && fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".mp4,.webm,.mov,.avi,.mkv,.m4v,.ts"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleVideoUpload(file);
                        e.target.value = "";
                      }}
                    />

                    {uploadProgress !== null ? (
                      <div className="space-y-2">
                        <Loader2 className="w-8 h-8 text-violet-500 animate-spin mx-auto" />
                        <p className="text-sm font-medium">{uploadFilename}</p>
                        <div className="w-full bg-muted rounded-full h-2">
                          <div
                            className="bg-violet-500 h-2 rounded-full transition-all"
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">{uploadProgress}% uploaded</p>
                      </div>
                    ) : stream.uploadedVideoPath ? (
                      <div className="space-y-2">
                        <Film className="w-8 h-8 text-violet-500 mx-auto" />
                        <p className="text-sm font-medium text-foreground truncate max-w-full px-2">
                          {stream.uploadedVideoPath.split("/").pop()}
                        </p>
                        <div className="flex items-center justify-center gap-2 mt-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); if (!isActive) fileInputRef.current?.click(); }}
                            disabled={isActive}
                            className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 disabled:opacity-40"
                          >
                            <RefreshCw className="w-3 h-3" /> Replace
                          </button>
                          <span className="text-muted-foreground text-xs">·</span>
                          <button
                            onClick={(e) => { e.stopPropagation(); if (!isActive) handleRemoveVideo(); }}
                            disabled={isActive}
                            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 disabled:opacity-40"
                          >
                            <XIcon className="w-3 h-3" /> Remove
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Upload className="w-8 h-8 text-muted-foreground mx-auto" />
                        <p className="text-sm font-medium">Click to upload a video</p>
                        <p className="text-xs text-muted-foreground">MP4, WebM, MOV, MKV — up to 2 GB</p>
                      </div>
                    )}
                  </div>

                  {/* 24/7 Loop toggle */}
                  <div className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <RepeatIcon className="w-4 h-4 text-violet-400" />
                      <div>
                        <p className="text-xs font-medium">Loop 24/7</p>
                        <p className="text-[11px] text-muted-foreground">Repeat the video indefinitely</p>
                      </div>
                    </div>
                    <Switch
                      checked={stream.uploadedVideoLoop !== false}
                      onCheckedChange={(v) => onUpdate(stream.id, { uploadedVideoLoop: v })}
                      disabled={isActive}
                    />
                  </div>

                  {!stream.uploadedVideoPath && (
                    <p className="text-xs text-amber-400 flex items-center gap-1">
                      <Info className="w-3 h-3" /> Upload a video file before starting the stream.
                    </p>
                  )}
                </div>
              )}

              {/* ── Output destinations ── */}
              <div className="space-y-3">
                <Label className="text-sm text-muted-foreground uppercase tracking-wide text-[10px]">Output Destinations</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor={`youtube-key-${stream.id}`} className="text-sm flex items-center gap-1.5">
                      <Youtube className="w-3.5 h-3.5 text-red-500" /> YouTube Stream Key
                    </Label>
                    <Input
                      id={`youtube-key-${stream.id}`}
                      placeholder="xxxx-xxxx-xxxx-xxxx"
                      type="password"
                      value={stream.youtubeStreamKey}
                      onChange={(e) => onUpdate(stream.id, { youtubeStreamKey: e.target.value })}
                      disabled={isActive}
                      data-testid={`input-youtube-${stream.id}`}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`facebook-${stream.id}`} className="text-sm flex items-center gap-1.5">
                      <span className="text-blue-500 font-bold text-xs">fb</span> Facebook Stream Key
                      <span className="text-muted-foreground font-normal text-xs">(optional)</span>
                    </Label>
                    <Input
                      id={`facebook-${stream.id}`}
                      placeholder="Leave empty if not needed"
                      type="password"
                      value={stream.facebookRtmpUrl}
                      onChange={(e) => onUpdate(stream.id, { facebookRtmpUrl: e.target.value })}
                      disabled={isActive}
                      data-testid={`input-facebook-${stream.id}`}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`tiktok-key-${stream.id}`} className="text-sm flex items-center gap-1.5">
                    <SiTiktok className="w-3.5 h-3.5 text-pink-500" /> TikTok Stream Key
                    <span className="text-muted-foreground font-normal text-xs">(optional)</span>
                  </Label>
                  <Input
                    id={`tiktok-key-${stream.id}`}
                    placeholder="TikTok Live Studio stream key"
                    type="password"
                    value={stream.tiktokStreamKey}
                    onChange={(e) => onUpdate(stream.id, { tiktokStreamKey: e.target.value })}
                    disabled={isActive}
                    data-testid={`input-tiktok-key-${stream.id}`}
                  />
                  <p className="text-xs text-muted-foreground">
                    Get your key from <strong>TikTok Live Studio</strong> → Settings → Stream Key.
                    Pushes to <code className="bg-muted px-1 rounded">rtmp://push.tiktokv.com/live/</code>
                  </p>
                </div>
              </div>

              {/* YouTube Channel ID for stats */}
              <div className="space-y-2">
                <Label htmlFor={`channel-id-${stream.id}`} className="text-sm flex items-center gap-1.5">
                  <BarChart2 className="w-3.5 h-3.5 text-violet-500" /> YouTube Channel ID
                  <span className="text-muted-foreground font-normal text-xs">(for live stats &amp; chat)</span>
                </Label>
                <Input
                  id={`channel-id-${stream.id}`}
                  placeholder="UCxxxxxxxxxxxxxxxxxxxxxxxx"
                  value={stream.youtubeChannelId}
                  onChange={(e) => onUpdate(stream.id, { youtubeChannelId: e.target.value })}
                  data-testid={`input-channel-id-${stream.id}`}
                />
                <p className="text-xs text-muted-foreground">
                  Find it at <code className="bg-muted px-1 rounded">youtube.com/@channel → About → Share → Copy channel ID</code>.
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-2">
                  <Label className="text-sm">Layout</Label>
                  <Select
                    value={stream.ratio}
                    onValueChange={(v) => onUpdate(stream.id, { ratio: v as "mobile" | "desktop" })}
                    disabled={isActive}
                  >
                    <SelectTrigger data-testid={`select-ratio-${stream.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mobile">
                        <span className="flex items-center gap-2"><Smartphone className="w-3 h-3" /> Mobile <span className="text-muted-foreground text-xs">480×854</span></span>
                      </SelectItem>
                      <SelectItem value="desktop">
                        <span className="flex items-center gap-2"><Monitor className="w-3 h-3" /> Desktop <span className="text-muted-foreground text-xs">854×480</span></span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Quality</Label>
                  <Select
                    value={stream.quality}
                    onValueChange={(v) => onUpdate(stream.id, { quality: v as any })}
                    disabled={isActive}
                  >
                    <SelectTrigger data-testid={`select-quality-${stream.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="best">Best</SelectItem>
                      <SelectItem value="720p">720p</SelectItem>
                      <SelectItem value="480p">480p</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">FPS</Label>
                  <Select
                    value={stream.fps}
                    onValueChange={(v) => onUpdate(stream.id, { fps: v as any })}
                    disabled={isActive}
                  >
                    <SelectTrigger data-testid={`select-fps-${stream.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="20">20 FPS</SelectItem>
                      <SelectItem value="25">25 FPS</SelectItem>
                      <SelectItem value="30">30 FPS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm">Auto-Restart</Label>
                  <div className="flex items-center gap-2 h-9">
                    <Switch
                      checked={stream.autoRestart}
                      onCheckedChange={(v) => onUpdate(stream.id, { autoRestart: v })}
                      data-testid={`switch-autorestart-${stream.id}`}
                    />
                    <span className="text-xs text-muted-foreground">{stream.autoRestart ? "On" : "Off"}</span>
                  </div>
                </div>
              </div>

            </CollapsibleContent>
          </Collapsible>

          {/* Stream lock banner */}
          {isActive && locked && pendingAction === null && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-400 text-xs font-semibold">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              Stream locked — stop/restart blocked. Click the lock icon to unlock.
            </div>
          )}

          {/* Confirmation prompt when locked and action pending */}
          {isActive && locked && pendingAction !== null && (
            <div className="flex flex-col gap-2 px-3 py-3 rounded-lg border border-red-500/40 bg-red-500/8 text-sm">
              <div className="flex items-center gap-2 text-red-400 font-semibold">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                {pendingAction === "stop" ? "Stop the live stream?" : "Restart the live stream?"}
              </div>
              <p className="text-xs text-muted-foreground">
                {pendingAction === "stop"
                  ? "This will end the RTMP output. Viewers will lose the stream."
                  : "This will briefly interrupt the RTMP output to reconnect."}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (pendingAction === "stop") onStop(stream.id);
                    else onRestart(stream.id);
                    setPendingAction(null);
                  }}
                >
                  {pendingAction === "stop" ? "Yes, stop it" : "Yes, restart"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setPendingAction(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {!isActive ? (
              sourceType === "camera" && cameraMode === "guestroom" ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-violet-500/25 bg-violet-500/8 text-xs text-muted-foreground w-full">
                  <Radio className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                  Guest starts the stream from their camera link — share it above.
                </div>
              ) : (
                <Button
                  onClick={() => onStart(stream.id)}
                  disabled={!canStart(stream) || isStarting}
                  data-testid={`button-start-${stream.id}`}
                >
                  {isStarting ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Starting…</>
                  ) : (
                    <><Play className="w-4 h-4 mr-2" />Start</>
                  )}
                </Button>
              )
            ) : (
              <>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (locked) { setPendingAction("stop"); return; }
                    onStop(stream.id);
                  }}
                  data-testid={`button-stop-${stream.id}`}
                >
                  {locked ? <Lock className="w-4 h-4 mr-2" /> : <Square className="w-4 h-4 mr-2" />}
                  Stop
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (locked) { setPendingAction("restart"); return; }
                    onRestart(stream.id);
                  }}
                  data-testid={`button-restart-${stream.id}`}
                >
                  {locked ? <Lock className="w-4 h-4 mr-2" /> : <RotateCcw className="w-4 h-4 mr-2" />}
                  Restart
                </Button>
              </>
            )}
            <Button
              variant="secondary"
              onClick={() => onToggleMute(stream.id)}
              data-testid={`button-mute-${stream.id}`}
            >
              {stream.muted ? (
                <><VolumeX className="w-4 h-4 mr-2" /> Muted</>
              ) : (
                <><Volume2 className="w-4 h-4 mr-2" /> Audio On</>
              )}
            </Button>
          </div>

          {sourceType === "tiktok" && (
            <LivePreview streamId={stream.id} tiktokUsername={stream.tiktokUsername} ratio={stream.ratio} />
          )}

          {sourceType === "youtube" && stream.youtubeSourceUrl && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-between text-muted-foreground"
              onClick={() => onOpenMonitor?.(stream.youtubeSourceUrl, `Stream ${index + 1}`)}
              data-testid={`button-youtube-monitor-${stream.id}`}
            >
              <span className="flex items-center gap-2">
                <Tv className="w-4 h-4" />
                YouTube Monitor
                <span className="w-2 h-2 rounded-full inline-block bg-red-500" />
              </span>
              <Youtube className="w-4 h-4 text-red-500" />
            </Button>
          )}

          <Collapsible open={logsOpen} onOpenChange={setLogsOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground" data-testid={`button-toggle-logs-${stream.id}`}>
                <span className="flex items-center gap-2">
                  <Terminal className="w-4 h-4" />
                  Logs
                  {logs.length > 0 && (
                    <Badge variant="secondary" className="text-xs">{logs.length}</Badge>
                  )}
                </span>
                {logsOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <ScrollArea className="h-48 rounded-md bg-background border p-3 font-mono text-xs" data-testid={`log-area-${stream.id}`}>
                {logs.length === 0 ? (
                  <p className="text-muted-foreground">No logs yet. Start the stream to see output.</p>
                ) : (
                  logs.map((line, i) => (
                    <div key={i} className={`py-0.5 leading-relaxed ${line.includes("ERROR") || line.includes("error") ? "text-red-400" : line.includes("WARN") || line.includes("warning") ? "text-amber-400" : "text-muted-foreground"}`}>
                      {line}
                    </div>
                  ))
                )}
                <div ref={logEndRef} />
              </ScrollArea>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
    </>
  );
}
