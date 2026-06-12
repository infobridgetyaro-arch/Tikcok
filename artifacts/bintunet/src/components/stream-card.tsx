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
import { Slider } from "@/components/ui/slider";
import {
  Play, Square, RotateCcw, Trash2, ChevronDown, ChevronUp,
  Volume2, VolumeX, Monitor, Smartphone, Settings2, Terminal,
  Layers, Upload, Image, Type, X, Sparkles, Eye, Youtube,
  Video, Camera, Radio, Info, Wifi, Usb, HelpCircle
} from "lucide-react";
import { SiTiktok } from "react-icons/si";
import { QRCodeSVG } from "qrcode.react";
import type { StreamConfig } from "@/types/schema";
import { LivePreview } from "./live-preview";

interface StreamCardProps {
  stream: StreamConfig;
  logs: string[];
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onRestart: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, data: Partial<StreamConfig>) => void;
  onToggleMute: (id: string) => void;
  index: number;
}

const statusConfig = {
  idle: { color: "bg-gray-400 dark:bg-gray-500", label: "Idle", badgeVariant: "secondary" as const },
  streaming: { color: "bg-emerald-500", label: "Live", badgeVariant: "default" as const },
  error: { color: "bg-red-500", label: "Error", badgeVariant: "destructive" as const },
  reconnecting: { color: "bg-amber-500", label: "Reconnecting", badgeVariant: "secondary" as const },
};

const logoAnimationClass: Record<string, string> = {
  none: "",
  pulse: "animate-logo-pulse",
  breathe: "animate-logo-breathe",
  "fade-in": "animate-logo-fadein",
  flash: "animate-logo-flash",
};

const sourceTypeConfig = {
  tiktok: { label: "TikTok", icon: SiTiktok, color: "text-pink-500" },
  youtube: { label: "YouTube", icon: Youtube, color: "text-red-500" },
  camera: { label: "Camera", icon: Camera, color: "text-blue-500" },
};

function CameraGuide() {
  const [open, setOpen] = useState(false);

  const methods = [
    {
      icon: Usb,
      color: "text-blue-500",
      title: "USB Webcam",
      value: "/dev/video0",
      steps: [
        "Plug your USB webcam into the server",
        "Check available devices: ls /dev/video*",
        "Use /dev/video0 (or video1, video2…)",
      ],
    },
    {
      icon: Smartphone,
      color: "text-pink-500",
      title: "Android Phone (DroidCam)",
      value: "rtsp://192.168.x.x:4747/video",
      steps: [
        "Install DroidCam on your Android phone",
        "Install DroidCam client on the server (optional)",
        "Or just copy the RTSP URL shown in the app and paste it here",
        "Default URL: rtsp://PHONE_IP:4747/video",
      ],
    },
    {
      icon: Smartphone,
      color: "text-gray-400",
      title: "iPhone / iPad (EpocCam)",
      value: "rtsp://192.168.x.x:4747/video",
      steps: [
        "Install EpocCam app on your iPhone",
        "Install EpocCam driver on the computer",
        "Phone appears as virtual camera: use /dev/video0",
        "Or use the RTSP URL shown in the EpocCam app",
      ],
    },
    {
      icon: Wifi,
      color: "text-emerald-500",
      title: "IP / Network Camera (RTSP)",
      value: "rtsp://admin:password@192.168.1.100:554/stream",
      steps: [
        "Find your camera's RTSP URL in its settings or manual",
        "Common format: rtsp://USER:PASS@IP:554/stream",
        "IP Webcam (Android) app → use the URL it displays",
        "Paste the full RTSP URL into the device field above",
      ],
    },
    {
      icon: Video,
      color: "text-orange-500",
      title: "OBS Virtual Camera",
      value: "/dev/video0",
      steps: [
        "In OBS: Tools → Start Virtual Camera",
        "OBS will appear as a V4L2 device on Linux",
        "Use /dev/video0 (or check with ls /dev/video*)",
        "Install v4l2loopback if needed: sudo apt install v4l2loopback-dkms",
      ],
    },
  ];

  return (
    <div className="rounded-lg border border-dashed border-border">
      <button
        className="w-full flex items-center justify-between px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen((v) => !v)}
        data-testid="button-camera-guide"
      >
        <span className="flex items-center gap-2">
          <HelpCircle className="w-3.5 h-3.5" />
          How to connect a camera
        </span>
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {open && (
        <div className="border-t border-border px-3 pb-3 pt-2 space-y-3">
          <p className="text-xs text-muted-foreground">
            Enter a device path like <code className="bg-muted px-1 rounded">/dev/video0</code> for local cameras,
            or an RTSP/HTTP URL for remote cameras. All methods supported.
          </p>
          <div className="space-y-2">
            {methods.map((method) => {
              const Icon = method.icon;
              return (
                <div key={method.title} className="rounded-md bg-muted/40 p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="flex items-center gap-1.5 font-medium text-xs">
                      <Icon className={`w-3.5 h-3.5 ${method.color}`} />
                      {method.title}
                    </span>
                    <code className="text-[10px] bg-background border rounded px-1.5 py-0.5 text-muted-foreground font-mono select-all">
                      {method.value}
                    </code>
                  </div>
                  <ul className="space-y-0.5">
                    {method.steps.map((step, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                        <span className="shrink-0 text-primary font-bold">{i + 1}.</span>
                        {step}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            <Info className="w-3 h-3 inline mr-1" />
            Make sure your server and camera are on the same network for RTSP streams.
          </p>
        </div>
      )}
    </div>
  );
}

function getSourceDisplay(stream: StreamConfig): string {
  if (stream.sourceType === "youtube") return stream.youtubeSourceUrl || "";
  if (stream.sourceType === "camera") return stream.cameraDevice || "/dev/video0";
  return stream.tiktokUsername ? `@${stream.tiktokUsername}` : "";
}

function canStart(stream: StreamConfig): boolean {
  const hasOutput = !!(stream.youtubeStreamKey || stream.facebookRtmpUrl);
  if (stream.sourceType === "youtube") return !!(stream.youtubeSourceUrl) && hasOutput;
  if (stream.sourceType === "camera") return !!(stream.cameraDevice) && hasOutput;
  return !!(stream.tiktokUsername) && hasOutput;
}

export function StreamCard({ stream, logs, onStart, onStop, onRestart, onDelete, onUpdate, onToggleMute, index }: StreamCardProps) {
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [liveCount, setLiveCount] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isActive = stream.status === "streaming" || stream.status === "reconnecting";
  const config = statusConfig[stream.status];
  const sourceType = stream.sourceType || "tiktok";
  const SourceIcon = sourceTypeConfig[sourceType].icon;

  useEffect(() => {
    if (!stream.overlayLiveCount || !stream.youtubeChannelId) {
      setLiveCount(null);
      return;
    }
    const fetchCount = async () => {
      try {
        const res = await fetch(`/api/streams/${stream.id}/live-count`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (data.count) setLiveCount(data.count);
        }
      } catch {}
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, [stream.id, stream.overlayLiveCount, stream.youtubeChannelId]);

  useEffect(() => {
    if (logsOpen && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs, logsOpen]);

  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string>("");

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("logo", file);
      const res = await fetch("/api/upload/logo", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      onUpdate(stream.id, { overlayLogoPath: data.path });
      setLogoPreviewUrl(data.url);
    } catch (err) {
      console.error("Logo upload failed:", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeLogo() {
    onUpdate(stream.id, { overlayLogoPath: "" });
    setLogoPreviewUrl("");
  }

  const overlayPreviewStyle = {
    bannerColor: stream.overlayBannerColor || "#c41e1e",
    tickerColor: stream.overlayTickerColor || "#1a1a2e",
  };

  const currentAnimation = stream.overlayLogoAnimation || "none";
  const previewAnimClass = logoAnimationClass[currentAnimation] || "";
  const sourceDisplay = getSourceDisplay(stream);

  return (
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
        <Button
          size="icon"
          variant="ghost"
          onClick={() => onDelete(stream.id)}
          className="shrink-0 text-muted-foreground"
          data-testid={`button-delete-${stream.id}`}
        >
          <Trash2 className="w-4 h-4" />
        </Button>
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

            <div className="space-y-2">
              <Label className="text-sm">Input Source</Label>
              <div className="grid grid-cols-3 gap-2">
                {(["tiktok", "youtube", "camera"] as const).map((type) => {
                  const cfg = sourceTypeConfig[type];
                  const Icon = cfg.icon;
                  const selected = sourceType === type;
                  return (
                    <button
                      key={type}
                      onClick={() => !isActive && onUpdate(stream.id, { sourceType: type })}
                      disabled={isActive}
                      data-testid={`button-source-${type}-${stream.id}`}
                      className={`flex flex-col items-center gap-1.5 p-2.5 rounded-lg border text-xs font-medium transition-all ${
                        selected
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <Icon className={`w-4 h-4 ${selected ? "text-primary" : cfg.color}`} />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

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
                  Requires <code className="bg-muted px-1 rounded">yt-dlp</code> installed on the server. Channel must be live.
                </p>
              </div>
            )}

            {sourceType === "camera" && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={`cam-${stream.id}`} className="text-sm flex items-center gap-1.5">
                    <Camera className="w-3.5 h-3.5 text-blue-500" /> Camera Device or RTSP URL
                  </Label>
                  <Input
                    id={`cam-${stream.id}`}
                    placeholder="/dev/video0  or  rtsp://192.168.1.x:8080/video"
                    value={stream.cameraDevice}
                    onChange={(e) => onUpdate(stream.id, { cameraDevice: e.target.value })}
                    disabled={isActive}
                    data-testid={`input-camera-${stream.id}`}
                  />
                  <p className="text-xs text-muted-foreground">
                    Enter a local device path or any RTSP/HTTP stream URL
                  </p>
                </div>
                <CameraGuide />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <Label htmlFor={`facebook-${stream.id}`} className="text-sm">
                  Facebook Stream Key <span className="text-muted-foreground font-normal">(optional)</span>
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
                      <span className="flex items-center gap-2"><Smartphone className="w-3 h-3" /> Mobile</span>
                    </SelectItem>
                    <SelectItem value="desktop">
                      <span className="flex items-center gap-2"><Monitor className="w-3 h-3" /> Desktop</span>
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

        {/* Overlay Section */}
        <Collapsible open={overlayOpen} onOpenChange={setOverlayOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between text-muted-foreground" data-testid={`button-toggle-overlay-${stream.id}`}>
              <span className="flex items-center gap-2">
                <Layers className="w-4 h-4" />
                Broadcast Overlay
                {stream.overlayEnabled && (
                  <Badge variant="default" className="text-xs">ON</Badge>
                )}
              </span>
              {overlayOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Switch
                  checked={stream.overlayEnabled}
                  onCheckedChange={(v) => onUpdate(stream.id, { overlayEnabled: v })}
                  data-testid={`switch-overlay-${stream.id}`}
                />
                <Label className="text-sm">Enable Overlay</Label>
              </div>
              {isActive && stream.overlayEnabled && (
                <Badge variant="secondary" className="text-xs gap-1">
                  <Sparkles className="w-3 h-3" />
                  Live Adjust
                </Badge>
              )}
            </div>

            {stream.overlayEnabled && (
              <>
                {isActive && (
                  <p className="text-xs text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                    Changes apply automatically while streaming. A brief encoder restart (~2s) will occur for structural changes.
                  </p>
                )}

                {/* Overlay Preview */}
                <div
                  className="relative rounded-lg overflow-hidden border"
                  style={{ aspectRatio: stream.ratio === "mobile" ? "9/16" : "16/9", maxHeight: "200px" }}
                  data-testid={`overlay-preview-${stream.id}`}
                >
                  {/* Animated gradient video area */}
                  <div className={`absolute inset-0 overflow-hidden ${isActive ? "preview-bg-live" : "preview-bg"}`}>
                    <div className="preview-orb-a absolute -top-[20%] -left-[10%] w-[65%] h-[65%] rounded-full"
                      style={{ background: isActive ? "radial-gradient(circle, #ff3d00 0%, transparent 70%)" : "radial-gradient(circle, #667eea 0%, transparent 70%)" }} />
                    <div className="preview-orb-b absolute -bottom-[15%] -right-[5%] w-[55%] h-[55%] rounded-full"
                      style={{ background: isActive ? "radial-gradient(circle, #ff0057 0%, transparent 70%)" : "radial-gradient(circle, #f857a6 0%, transparent 70%)" }} />
                    <div className="preview-orb-c absolute top-[25%] right-[15%] w-[40%] h-[40%] rounded-full"
                      style={{ background: isActive ? "radial-gradient(circle, #ff6600 0%, transparent 70%)" : "radial-gradient(circle, #4facfe 0%, transparent 70%)" }} />
                    <div className="absolute inset-0 opacity-[0.04]"
                      style={{
                        backgroundImage: "linear-gradient(rgba(255,255,255,.8) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.8) 1px, transparent 1px)",
                        backgroundSize: "24px 24px"
                      }} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-white/15 text-[10px] font-mono tracking-[0.3em] select-none">VIDEO</span>
                    </div>
                  </div>

                  {stream.overlayLogoPath && (
                    <div className={`absolute ${
                      stream.overlayLogoPosition === "top-left" ? "top-2 left-2" :
                      stream.overlayLogoPosition === "top-right" ? "top-2 right-12" :
                      stream.overlayLogoPosition === "bottom-left" ? "bottom-16 left-2" :
                      "bottom-16 right-12"
                    }`}>
                      {logoPreviewUrl ? (
                        <img src={logoPreviewUrl} alt="Logo" className={`w-8 h-8 object-contain rounded ${previewAnimClass}`} />
                      ) : (
                        <div className={`w-8 h-8 bg-white/20 rounded flex items-center justify-center ${previewAnimClass}`}>
                          <Image className="w-4 h-4 text-white/60" />
                        </div>
                      )}
                    </div>
                  )}

                  {/* QR code overlay — top-right (like screenshot) */}
                  {stream.overlayQrEnabled && stream.overlayQrUrl && (
                    <div className="absolute top-1.5 right-1.5 flex flex-col items-center gap-0.5">
                      <div className="bg-white rounded p-1 shadow-lg">
                        <QRCodeSVG value={stream.overlayQrUrl} size={32} level="L" bgColor="#ffffff" fgColor="#000000" />
                      </div>
                      {stream.overlayQrLabel && (
                        <div
                          className="text-white text-[5px] font-black px-1 py-0.5 rounded text-center leading-tight w-full"
                          style={{ background: "#F97316" }}
                        >
                          {stream.overlayQrLabel}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Lower-third: channel name + sub count / headline */}
                  {(stream.overlayChannelName || stream.overlayHeadline || stream.overlayLiveCount) && (
                    <div className="absolute bottom-6 left-0 flex items-stretch text-[8px] leading-tight">
                      {stream.overlayChannelName && (
                        <div
                          className="px-2 py-1 text-white font-bold flex items-center"
                          style={{ backgroundColor: overlayPreviewStyle.bannerColor }}
                        >
                          {stream.overlayChannelName}
                        </div>
                      )}
                      {stream.overlayLiveCount && liveCount ? (
                        <div className="px-2 py-0.5 text-white bg-red-700/90 flex items-center gap-1 font-bold">
                          <Youtube className="w-2 h-2 text-white shrink-0" />
                          {liveCount} Subs
                        </div>
                      ) : stream.overlayHeadline ? (
                        <div className="px-2 py-1 text-white bg-gray-800/90 flex items-center">
                          {stream.overlayHeadline}
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* Social handle bar — bottom centre */}
                  {stream.overlaySocialEnabled && stream.overlaySocialHandle && (
                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
                      <div className="flex items-center gap-1 bg-black/80 px-2 py-0.5 rounded text-[6px] text-slate-300 whitespace-nowrap">
                        <span className="text-blue-400">FB</span>
                        <span>·</span>
                        <span className="text-pink-400">IG</span>
                        <span>·</span>
                        <SiTiktok className="w-2 h-2" />
                        <span>·</span>
                        <span className="text-white font-semibold">{stream.overlaySocialHandle}</span>
                      </div>
                    </div>
                  )}

                  {stream.overlayTickerText && (
                    <div
                      className="absolute bottom-0 left-0 right-0 px-2 py-0.5 text-[7px] text-white overflow-hidden whitespace-nowrap"
                      style={{ backgroundColor: overlayPreviewStyle.tickerColor + "E6" }}
                    >
                      <span className="inline-block animate-marquee">
                        {stream.overlayTickerText}
                      </span>
                    </div>
                  )}
                </div>

                {/* Logo Upload */}
                <div className="space-y-2">
                  <Label className="text-sm flex items-center gap-2">
                    <Image className="w-3.5 h-3.5" />
                    Channel Logo
                  </Label>
                  <div className="flex items-center gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      className="hidden"
                      onChange={handleLogoUpload}
                      data-testid={`input-logo-file-${stream.id}`}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      data-testid={`button-upload-logo-${stream.id}`}
                    >
                      <Upload className="w-3.5 h-3.5 mr-2" />
                      {uploading ? "Uploading..." : stream.overlayLogoPath ? "Change Logo" : "Upload Logo"}
                    </Button>
                    {stream.overlayLogoPath && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={removeLogo}
                        data-testid={`button-remove-logo-${stream.id}`}
                      >
                        <X className="w-3.5 h-3.5 mr-1" />
                        Remove
                      </Button>
                    )}
                  </div>
                  {stream.overlayLogoPath && (
                    <p className="text-xs text-muted-foreground">Logo uploaded and ready</p>
                  )}
                </div>

                {/* Logo Position, Size & Animation */}
                {stream.overlayLogoPath && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-2">
                      <Label className="text-sm">Position</Label>
                      <Select
                        value={stream.overlayLogoPosition}
                        onValueChange={(v) => onUpdate(stream.id, { overlayLogoPosition: v as any })}
                      >
                        <SelectTrigger data-testid={`select-logo-pos-${stream.id}`}>
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
                    <div className="space-y-2">
                      <Label className="text-sm">Animation</Label>
                      <Select
                        value={currentAnimation}
                        onValueChange={(v) => onUpdate(stream.id, { overlayLogoAnimation: v as any })}
                      >
                        <SelectTrigger data-testid={`select-logo-anim-${stream.id}`}>
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
                    <div className="space-y-2">
                      <Label className="text-sm">Size: {Math.round((stream.overlayLogoScale || 0.15) * 100)}%</Label>
                      <Slider
                        value={[stream.overlayLogoScale || 0.15]}
                        min={0.05}
                        max={0.35}
                        step={0.01}
                        onValueChange={([v]) => onUpdate(stream.id, { overlayLogoScale: v })}
                        data-testid={`slider-logo-scale-${stream.id}`}
                      />
                    </div>
                  </div>
                )}

                {/* Lower Third */}
                <div className="space-y-3">
                  <Label className="text-sm flex items-center gap-2">
                    <Type className="w-3.5 h-3.5" />
                    Lower Third Banner
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Channel Name</Label>
                      <Input
                        placeholder="e.g. BintuNet LIVE"
                        value={stream.overlayChannelName}
                        onChange={(e) => onUpdate(stream.id, { overlayChannelName: e.target.value })}
                        data-testid={`input-channel-name-${stream.id}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Headline / Subs Count</Label>
                      <Input
                        placeholder="e.g. 10K Subscribers | LIVE NOW"
                        value={stream.overlayHeadline}
                        onChange={(e) => onUpdate(stream.id, { overlayHeadline: e.target.value })}
                        disabled={stream.overlayLiveCount}
                        data-testid={`input-headline-${stream.id}`}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Banner Color</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={stream.overlayBannerColor || "#c41e1e"}
                          onChange={(e) => onUpdate(stream.id, { overlayBannerColor: e.target.value })}
                          className="w-8 h-8 rounded cursor-pointer border"
                          data-testid={`input-banner-color-${stream.id}`}
                        />
                        <span className="text-xs text-muted-foreground">{stream.overlayBannerColor || "#c41e1e"}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* YouTube Live Count */}
                <div className="space-y-3">
                  <Label className="text-sm flex items-center gap-2">
                    <Youtube className="w-3.5 h-3.5 text-red-500" />
                    YouTube Live Count
                  </Label>
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={stream.overlayLiveCount}
                      onCheckedChange={(v) => onUpdate(stream.id, { overlayLiveCount: v })}
                      data-testid={`switch-livecount-${stream.id}`}
                    />
                    <Label className="text-xs text-muted-foreground">
                      Auto-show real viewer/subscriber count
                    </Label>
                  </div>

                  {stream.overlayLiveCount && (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">YouTube Channel ID</Label>
                        <Input
                          placeholder="e.g. UCxxxxxxxxxxxxx"
                          value={stream.youtubeChannelId}
                          onChange={(e) => onUpdate(stream.id, { youtubeChannelId: e.target.value })}
                          data-testid={`input-yt-channel-${stream.id}`}
                        />
                        <p className="text-xs text-muted-foreground">
                          Updates every 30s via YouTube Data API v3.
                        </p>
                      </div>

                      {/* Live count display */}
                      {stream.youtubeChannelId && (
                        <div
                          className="yt-count-badge rounded-xl overflow-hidden"
                          style={{ background: "linear-gradient(135deg, #1a0000 0%, #2d0000 100%)", border: "1px solid rgba(255,0,0,0.35)" }}
                          data-testid={`yt-count-display-${stream.id}`}
                        >
                          <div className="px-4 py-3 flex items-center gap-3">
                            <div
                              className="flex items-center justify-center w-10 h-10 rounded-lg shrink-0"
                              style={{ background: "rgba(255,0,0,0.2)", border: "1px solid rgba(255,0,0,0.4)" }}
                            >
                              <Youtube className="w-5 h-5 text-red-500" />
                            </div>
                            <div className="flex-1 min-w-0">
                              {liveCount ? (
                                <>
                                  <p
                                    className="text-xl font-bold leading-none tracking-tight"
                                    style={{ color: "#fff" }}
                                  >
                                    {liveCount}
                                  </p>
                                  <p className="text-xs mt-0.5" style={{ color: "rgba(255,120,120,0.8)" }}>
                                    Live on YouTube · auto-refreshes every 30s
                                  </p>
                                </>
                              ) : (
                                <>
                                  <p className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.5)" }}>
                                    Fetching count…
                                  </p>
                                  <p className="text-xs" style={{ color: "rgba(255,120,120,0.5)" }}>
                                    Check your Channel ID and API key
                                  </p>
                                </>
                              )}
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <span className="flex items-center gap-1.5">
                                <span
                                  className="w-2 h-2 rounded-full animate-pulse"
                                  style={{ backgroundColor: liveCount ? "#ff3333" : "#555" }}
                                />
                                <span className="text-[10px] font-mono" style={{ color: liveCount ? "#ff6666" : "#555" }}>
                                  {liveCount ? "LIVE" : "WAIT"}
                                </span>
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Scrolling Ticker */}
                <div className="space-y-3">
                  <Label className="text-sm flex items-center gap-2">
                    <Type className="w-3.5 h-3.5" />
                    Scrolling Ticker
                  </Label>
                  <Input
                    placeholder="Breaking news text that scrolls at the bottom..."
                    value={stream.overlayTickerText}
                    onChange={(e) => onUpdate(stream.id, { overlayTickerText: e.target.value })}
                    data-testid={`input-ticker-text-${stream.id}`}
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Ticker Color</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={stream.overlayTickerColor || "#1a1a2e"}
                          onChange={(e) => onUpdate(stream.id, { overlayTickerColor: e.target.value })}
                          className="w-8 h-8 rounded cursor-pointer border"
                          data-testid={`input-ticker-color-${stream.id}`}
                        />
                        <span className="text-xs text-muted-foreground">{stream.overlayTickerColor || "#1a1a2e"}</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Scroll Speed: {stream.overlayTickerSpeed || 80}px/s</Label>
                      <Slider
                        value={[stream.overlayTickerSpeed || 80]}
                        min={30}
                        max={200}
                        step={5}
                        onValueChange={([v]) => onUpdate(stream.id, { overlayTickerSpeed: v })}
                        data-testid={`slider-ticker-speed-${stream.id}`}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
          </CollapsibleContent>
        </Collapsible>

        <div className="flex flex-wrap items-center gap-2">
          {!isActive ? (
            <Button
              onClick={() => onStart(stream.id)}
              disabled={!canStart(stream)}
              data-testid={`button-start-${stream.id}`}
            >
              <Play className="w-4 h-4 mr-2" />
              Start
            </Button>
          ) : (
            <>
              <Button
                variant="destructive"
                onClick={() => onStop(stream.id)}
                data-testid={`button-stop-${stream.id}`}
              >
                <Square className="w-4 h-4 mr-2" />
                Stop
              </Button>
              <Button
                variant="secondary"
                onClick={() => onRestart(stream.id)}
                data-testid={`button-restart-${stream.id}`}
              >
                <RotateCcw className="w-4 h-4 mr-2" />
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
  );
}
