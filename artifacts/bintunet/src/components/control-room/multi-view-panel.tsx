import { useState, useEffect, useRef, useCallback } from "react";
import Hls from "hls.js";
import {
  Plus, X, Camera, Tv, WifiOff, Loader2, LayoutGrid,
  Maximize2, Minimize2, Radio, RefreshCw, Link2, Copy,
  Check, Users, ChevronDown, ChevronUp, Zap,
} from "lucide-react";

interface GuestInfo {
  guestId: string;
  streamId: string;
  guestName: string;
  pending?: boolean;
}

interface SourceConfig {
  id: string;
  label: string;
  type: "hls" | "youtube-embed" | "file" | "none" | "manual" | "tiktok";
  url?: string;
  embedUrl?: string;
  streamId?: string;
  status?: string;
  sourceType?: string;
}

interface ManualTile {
  id: string;
  label: string;
  sourceKind: "tiktok" | "youtube" | "hls";
  url?: string;
  embedUrl?: string;
}

interface Stream {
  id: string;
  status: string;
  tiktokUsername: string;
  youtubeSourceUrl: string;
  cameraDevice: string;
  sourceType: string;
  uploadedVideoPath?: string;
}

interface ProcStat {
  cpu: number;
  mem: number;
  frames?: number;
  uptime?: number;
}

interface MultiViewPanelProps {
  streams: Stream[];
  procStats?: Record<string, ProcStat>;
}

const LAYOUTS = [
  { id: "solo",  label: "Solo",  cols: 1, rows: 1, max: 1  },
  { id: "duo",   label: "1+1",   cols: 2, rows: 1, max: 2  },
  { id: "trio",  label: "3-Up",  cols: 3, rows: 1, max: 3  },
  { id: "quad",  label: "2×2",   cols: 2, rows: 2, max: 4  },
  { id: "hex",   label: "3×2",   cols: 3, rows: 2, max: 6  },
  { id: "nine",  label: "3×3",   cols: 3, rows: 3, max: 9  },
] as const;

type LayoutId = (typeof LAYOUTS)[number]["id"];

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function sourceLabel(stream: Stream): string {
  if (stream.tiktokUsername) return `@${stream.tiktokUsername}`;
  if (stream.youtubeSourceUrl) {
    try { return new URL(stream.youtubeSourceUrl).hostname.replace("www.", ""); }
    catch { return "YouTube"; }
  }
  if (stream.sourceType === "upload") return "Video File";
  if (stream.sourceType === "camera") return stream.cameraDevice || "Camera";
  return "Stream";
}

function fmtUptime(secs?: number): string {
  if (!secs) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ── Platform badge ────────────────────────────────────────────────────────────
function PlatformBadge({ kind }: { kind: string }) {
  const cfg: Record<string, { icon: string; bg: string; color: string }> = {
    tiktok:  { icon: "🎵", bg: "rgba(0,0,0,0.75)", color: "#fff" },
    youtube: { icon: "▶",  bg: "rgba(255,0,0,0.8)", color: "#fff" },
    camera:  { icon: "📷", bg: "rgba(0,0,0,0.7)",  color: "#fff" },
    upload:  { icon: "🎬", bg: "rgba(0,0,0,0.7)",  color: "#fff" },
    hls:     { icon: "📡", bg: "rgba(0,0,0,0.7)",  color: "#fff" },
    guest:   { icon: "👤", bg: "rgba(37,99,235,0.8)", color: "#fff" },
  };
  const c = cfg[kind] ?? cfg.hls;
  return (
    <div style={{
      position: "absolute", top: 8, left: 8, zIndex: 15,
      background: c.bg, backdropFilter: "blur(6px)",
      borderRadius: 5, padding: "2px 7px", fontSize: 10, fontWeight: 700,
      color: c.color, display: "flex", alignItems: "center", gap: 3,
      letterSpacing: "0.02em",
    }}>
      <span style={{ fontSize: 9 }}>{c.icon}</span>
    </div>
  );
}

// ── Live pulse badge ──────────────────────────────────────────────────────────
function LiveBadge() {
  return (
    <div style={{
      position: "absolute", top: 8, right: 8, zIndex: 15,
      background: "#dc2626", borderRadius: 4, padding: "2px 7px",
      fontSize: 9, fontWeight: 800, color: "#fff",
      display: "flex", alignItems: "center", gap: 3, letterSpacing: "0.05em",
    }}>
      <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#fff", animation: "mv-pulse 1.2s infinite" }} />
      LIVE
    </div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────
function StatsBar({ stats }: { stats?: ProcStat }) {
  if (!stats) return null;
  return (
    <div style={{
      position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 12,
      padding: "8px 8px 6px",
      background: "linear-gradient(to top, rgba(0,0,0,0.88), transparent)",
      display: "flex", gap: 6, alignItems: "center",
    }}>
      {stats.frames !== undefined && stats.frames > 0 && (
        <span style={{ fontSize: 9, color: "#a78bfa", fontFamily: "monospace", background: "rgba(124,58,237,0.2)", padding: "1px 5px", borderRadius: 3 }}>
          {stats.frames.toLocaleString()}f
        </span>
      )}
      {stats.uptime !== undefined && stats.uptime > 0 && (
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", fontFamily: "monospace" }}>
          ⏱ {fmtUptime(stats.uptime)}
        </span>
      )}
      {stats.cpu !== undefined && (
        <span style={{ fontSize: 9, fontFamily: "monospace", marginLeft: "auto",
          color: stats.cpu > 80 ? "#f87171" : stats.cpu > 60 ? "#fb923c" : "rgba(255,255,255,0.35)"
        }}>
          CPU {Math.round(stats.cpu)}%
        </span>
      )}
    </div>
  );
}

// ── Label bar ─────────────────────────────────────────────────────────────────
function LabelBar({ label, pos = "bottom" }: { label: string; pos?: "top" | "bottom" }) {
  return (
    <div style={{
      position: "absolute", [pos]: 8, left: pos === "bottom" ? 8 : 28, right: 36, zIndex: 14,
      background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)",
      borderRadius: 5, padding: "2px 8px", fontSize: 10, fontWeight: 700, color: "#fff",
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      pointerEvents: "none",
    }}>
      {label}
    </div>
  );
}

// ── HLS Tile ─────────────────────────────────────────────────────────────────
function HlsTile({ url, label, stats, platform }: { url: string; label: string; stats?: ProcStat; platform?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const attach = useCallback(() => {
    const video = videoRef.current;
    if (!video || !url) return;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    setLoading(true); setError(null);
    if (Hls.isSupported()) {
      const hls = new Hls({ enableWorker: false, lowLatencyMode: true, maxBufferLength: 6, maxMaxBufferLength: 12, liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 6 });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); setLoading(false); });
      hls.on(Hls.Events.ERROR, (_e, d) => {
        if (d.fatal) { setError("Stream offline or URL expired"); setLoading(false); hls.destroy(); hlsRef.current = null; }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      video.onloadedmetadata = () => { video.play().catch(() => {}); setLoading(false); };
      video.onerror = () => { setError("Playback error"); setLoading(false); };
    } else {
      setError("HLS not supported"); setLoading(false);
    }
  }, [url]);

  useEffect(() => { attach(); return () => { if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; } }; }, [attach]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#080b12" }}>
      <video ref={videoRef} muted autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: loading || error ? "none" : "block" }} />
      {loading && !error && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <Loader2 size={18} style={{ color: "#7c3aed", animation: "mv-spin 1s linear infinite" }} />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>Connecting…</span>
        </div>
      )}
      {error && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <WifiOff size={16} style={{ color: "rgba(255,255,255,0.18)" }} />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", textAlign: "center", padding: "0 12px" }}>{error}</span>
          <button onClick={() => attach()} style={{ padding: "3px 10px", borderRadius: 5, background: "rgba(124,58,237,0.2)", border: "1px solid rgba(124,58,237,0.4)", color: "#c4b5fd", fontSize: 10, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            <RefreshCw size={9} /> Retry
          </button>
        </div>
      )}
      {!loading && !error && <StatsBar stats={stats} />}
      <PlatformBadge kind={platform ?? "hls"} />
      <LabelBar label={label} pos="top" />
    </div>
  );
}

// ── YouTube Embed Tile ────────────────────────────────────────────────────────
function YoutubeTile({ embedUrl, label }: { embedUrl: string; label: string }) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#0d0d0d" }}>
      <iframe src={embedUrl}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen style={{ width: "100%", height: "100%", border: "none", display: "block" }} />
      <PlatformBadge kind="youtube" />
      <LabelBar label={label} pos="top" />
    </div>
  );
}

// ── Video File Tile ───────────────────────────────────────────────────────────
function VideoFileTile({ url, label }: { url: string; label: string }) {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#080b12" }}>
      <video src={url} autoPlay muted loop playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      <PlatformBadge kind="upload" />
      <LabelBar label={label} pos="top" />
    </div>
  );
}

// ── Stats-only Tile (camera/RTSP) ─────────────────────────────────────────────
function StatsTile({ stream, stats }: { stream: Stream; stats?: ProcStat }) {
  const hue = (stream.id.charCodeAt(0) * 37) % 360;
  const icons: Record<string, string> = { tiktok: "🎵", youtube: "▶", camera: "📷", upload: "🎬" };
  return (
    <div style={{ width: "100%", height: "100%", background: `radial-gradient(circle at 30% 30%, hsl(${hue},28%,9%) 0%, #050710 100%)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 12 }}>
      <div style={{ width: 44, height: 44, borderRadius: "50%", background: `hsl(${hue},40%,18%)`, border: `1px solid hsl(${hue},40%,30%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
        {icons[stream.sourceType] ?? "📡"}
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.7)", marginBottom: 3 }}>{sourceLabel(stream)}</div>
        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)" }}>{stream.sourceType === "camera" ? "No browser preview" : "Preview unavailable"}</div>
      </div>
      {stats && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {stats.frames !== undefined && stats.frames > 0 && <span style={{ fontSize: 9, color: "#a78bfa", fontFamily: "monospace", background: "rgba(124,58,237,0.15)", padding: "2px 6px", borderRadius: 3 }}>{stats.frames.toLocaleString()}f</span>}
          {stats.uptime !== undefined && stats.uptime > 0 && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>⏱ {fmtUptime(stats.uptime)}</span>}
        </div>
      )}
    </div>
  );
}

// ── Guest Tile ────────────────────────────────────────────────────────────────
function GuestTile({ guestId, guestName, pcRef }: { guestId: string; guestName: string; pcRef: React.MutableRefObject<Map<string, RTCPeerConnection>> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasStream, setHasStream] = useState(false);
  const initials = guestName.trim().split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const hue = (guestName.charCodeAt(0) || 65) * 37 % 360;

  useEffect(() => {
    const pc = pcRef.current.get(guestId);
    if (!pc) return;
    const attach = (stream: MediaStream) => { if (videoRef.current) { videoRef.current.srcObject = stream; setHasStream(true); } };
    if ((pc as any)._stream) { attach((pc as any)._stream); return; }
    (pc as any)._onstream = attach;
    return () => { (pc as any)._onstream = null; };
  }, [guestId, pcRef]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "#080b12" }}>
      <video ref={videoRef} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "cover", display: hasStream ? "block" : "none" }} />
      {!hasStream && (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
          <div style={{ width: 48, height: 48, borderRadius: "50%", background: `hsl(${hue},50%,22%)`, border: `1px solid hsl(${hue},50%,38%)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, color: "#fff" }}>{initials}</div>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>Connecting…</span>
        </div>
      )}
      <PlatformBadge kind="guest" />
      <LabelBar label={guestName || "Guest"} pos="bottom" />
      {hasStream && <LiveBadge />}
    </div>
  );
}

// ── Pending Guest Row ─────────────────────────────────────────────────────────
function PendingGuestRow({
  guestId, guestName, pcRef, onAdmit, onDecline,
}: {
  guestId: string;
  guestName: string;
  pcRef: React.MutableRefObject<Map<string, RTCPeerConnection>>;
  onAdmit: () => void;
  onDecline: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasStream, setHasStream] = useState(false);
  const initials = guestName.trim().split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  const hue = (guestName.charCodeAt(0) || 65) * 37 % 360;

  useEffect(() => {
    const pc = pcRef.current.get(guestId);
    if (!pc) return;
    const attach = (stream: MediaStream) => { if (videoRef.current) { videoRef.current.srcObject = stream; setHasStream(true); } };
    if ((pc as any)._stream) { attach((pc as any)._stream); return; }
    (pc as any)._onstream = attach;
    return () => { (pc as any)._onstream = null; };
  }, [guestId, pcRef]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 10, background: "rgba(251,191,36,0.04)", border: "1px solid rgba(251,191,36,0.12)" }}>
      <div style={{ width: 64, height: 48, borderRadius: 7, overflow: "hidden", background: "#080b12", flexShrink: 0, position: "relative", border: "1px solid rgba(255,255,255,0.07)" }}>
        <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", display: hasStream ? "block" : "none" }} />
        {!hasStream && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: `hsl(${hue},40%,10%)` }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: `hsl(${hue},60%,70%)` }}>{initials}</span>
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{guestName || "Guest"}</div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", marginTop: 1 }}>Waiting to join</div>
      </div>
      <button onClick={onAdmit} style={{ padding: "5px 13px", borderRadius: 7, background: "rgba(16,185,129,0.18)", border: "1px solid rgba(16,185,129,0.35)", color: "#34d399", fontSize: 10, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
        Admit
      </button>
      <button onClick={onDecline} style={{ padding: "5px 13px", borderRadius: 7, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)", color: "#f87171", fontSize: 10, fontWeight: 700, cursor: "pointer", flexShrink: 0 }}>
        Decline
      </button>
    </div>
  );
}

// ── Placeholder Tile ──────────────────────────────────────────────────────────
function PlaceholderTile({ index }: { index: number }) {
  return (
    <div style={{ width: "100%", height: "100%", background: "rgba(255,255,255,0.010)", border: "1px dashed rgba(255,255,255,0.055)", borderRadius: 10, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
      <Camera size={14} style={{ color: "rgba(255,255,255,0.07)" }} />
      <span style={{ fontSize: 9, color: "rgba(255,255,255,0.12)", fontWeight: 600, letterSpacing: "0.06em" }}>SLOT {index + 1}</span>
    </div>
  );
}

// ── Stream Tile ───────────────────────────────────────────────────────────────
function StreamTile({ stream, stats }: { stream: Stream; stats?: ProcStat }) {
  const [sourceInfo, setSourceInfo] = useState<{ type: string; url?: string; embedUrl?: string } | null>(null);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (stream.status !== "streaming") { setSourceInfo({ type: "none" }); return; }
    setFetching(true);
    fetch(`/api/streams/${stream.id}/monitor-preview`, { credentials: "include" })
      .then(r => r.json()).then(data => { setSourceInfo(data); setFetching(false); })
      .catch(() => { setSourceInfo({ type: "none" }); setFetching(false); });
  }, [stream.id, stream.status]);

  if (stream.status !== "streaming") {
    return (
      <div style={{ width: "100%", height: "100%", background: "#080b12", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>{stream.sourceType === "tiktok" ? "🎵" : stream.sourceType === "youtube" ? "▶" : stream.sourceType === "camera" ? "📷" : "🎬"}</span>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.3)" }}>{sourceLabel(stream)}</div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.15)", marginTop: 2 }}>Idle</div>
        </div>
      </div>
    );
  }

  if (fetching || sourceInfo === null) {
    return <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#080b12" }}><Loader2 size={16} style={{ color: "#7c3aed", animation: "mv-spin 1s linear infinite" }} /></div>;
  }

  const label = sourceLabel(stream);
  if (sourceInfo.type === "hls" && sourceInfo.url) return <HlsTile url={sourceInfo.url} label={label} stats={stats} platform={stream.sourceType} />;
  if (sourceInfo.type === "youtube-embed" && sourceInfo.embedUrl) return <YoutubeTile embedUrl={sourceInfo.embedUrl} label={label} />;
  if (sourceInfo.type === "file" && sourceInfo.url) return <VideoFileTile url={sourceInfo.url} label={label} />;
  return <StatsTile stream={stream} stats={stats} />;
}

// ── Invite Panel ──────────────────────────────────────────────────────────────
function InvitePanel({ guestCount }: { guestCount: number }) {
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const fetchInvite = useCallback(async (regen = false) => {
    setLoading(true);
    try {
      const path = regen ? "/api/invite/regenerate" : "/api/invite";
      const r = await fetch(path, { method: regen ? "POST" : "GET", credentials: "include" });
      const data = await r.json();
      setInviteUrl(data.url);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchInvite(); }, [fetchInvite]);

  const copy = () => {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  };

  return (
    <div style={{
      borderRadius: 10, border: "1px solid rgba(99,102,241,0.2)",
      background: "rgba(99,102,241,0.06)", overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", padding: "9px 12px", background: "none", border: "none", cursor: "pointer",
          display: "flex", alignItems: "center", gap: 8, color: "inherit",
        }}
      >
        <div style={{ width: 26, height: 26, borderRadius: 7, background: "rgba(99,102,241,0.18)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Users size={13} style={{ color: "#818cf8" }} />
        </div>
        <div style={{ flex: 1, textAlign: "left" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>Guest Access Link</div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 1 }}>
            {guestCount > 0 ? `${guestCount} guest${guestCount !== 1 ? "s" : ""} connected` : "Share to invite camera guests"}
          </div>
        </div>
        {guestCount > 0 && (
          <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#10b981", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
            {guestCount}
          </div>
        )}
        <div style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0 }}>
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </div>
      </button>

      {open && (
        <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", lineHeight: 1.6 }}>
            Share this link with guests — they join directly in their browser, no app needed. Their camera appears as a tile automatically.
          </div>

          {/* Link row */}
          <div style={{ display: "flex", gap: 6 }}>
            <div style={{
              flex: 1, background: "rgba(0,0,0,0.4)", borderRadius: 7, border: "1px solid rgba(255,255,255,0.08)",
              padding: "6px 10px", fontSize: 10, color: "#a5b4fc", fontFamily: "monospace",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              display: "flex", alignItems: "center",
            }}>
              {loading ? <span style={{ color: "rgba(255,255,255,0.25)" }}>Loading…</span> : (inviteUrl ?? "—")}
            </div>
            <button
              onClick={copy}
              disabled={!inviteUrl}
              style={{
                padding: "6px 12px", borderRadius: 7, border: "1px solid rgba(99,102,241,0.35)",
                background: copied ? "rgba(16,185,129,0.15)" : "rgba(99,102,241,0.15)",
                color: copied ? "#34d399" : "#818cf8", fontSize: 10, fontWeight: 700,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 4, flexShrink: 0,
                transition: "all 0.2s",
              }}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>

          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => fetchInvite(true)}
              style={{
                flex: 1, padding: "5px 8px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", fontSize: 10,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
              }}
            >
              <RefreshCw size={9} /> Regenerate link
            </button>
            {inviteUrl && (
              <button
                onClick={() => window.open(inviteUrl, "_blank")}
                style={{
                  flex: 1, padding: "5px 8px", borderRadius: 7, border: "1px solid rgba(99,102,241,0.2)",
                  background: "rgba(99,102,241,0.1)", color: "#818cf8", fontSize: 10,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                }}
              >
                <Link2 size={9} /> Preview link
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Add Source Panel ──────────────────────────────────────────────────────────
type AddSourceKind = "tiktok" | "youtube" | "hls";

function AddSourcePanel({ onAdd, onClose }: {
  onAdd: (tile: ManualTile) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<AddSourceKind>("tiktok");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const KINDS: { id: AddSourceKind; icon: string; label: string; placeholder: string; hint: string }[] = [
    { id: "tiktok",  icon: "🎵", label: "TikTok",  placeholder: "@username or username", hint: "Pulls live HLS from TikTok via streamlink" },
    { id: "youtube", icon: "▶",  label: "YouTube", placeholder: "youtube.com/live/…", hint: "Embeds the YouTube live player" },
    { id: "hls",     icon: "📡", label: "HLS URL", placeholder: "https://…/stream.m3u8", hint: "Any raw HLS / .m3u8 stream URL" },
  ];
  const selected = KINDS.find(k => k.id === kind)!;

  const resolve = async () => {
    if (!value.trim()) { setError("Please enter a value"); return; }
    setResolving(true); setError(null);
    try {
      const r = await fetch("/api/preview/resolve", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: kind, value: value.trim() }),
      });
      const data = await r.json();
      if (!r.ok) { setError(data.message ?? "Failed to resolve source"); setResolving(false); return; }
      const tileLabel = label.trim() || (kind === "tiktok" ? `@${value.replace(/^@/, "")}` : kind === "youtube" ? "YouTube" : new URL(value).hostname);
      const tile: ManualTile = {
        id: `manual-${Date.now()}`,
        label: tileLabel,
        sourceKind: kind,
        url: data.url ?? undefined,
        embedUrl: data.embedUrl ?? undefined,
      };
      onAdd(tile);
      setValue(""); setLabel(""); setResolving(false);
    } catch (e: any) {
      setError(e.message ?? "Unknown error");
      setResolving(false);
    }
  };

  return (
    <div style={{
      background: "rgba(10,12,24,0.96)", border: "1px solid rgba(99,102,241,0.25)",
      borderRadius: 12, padding: "14px 14px", display: "flex", flexDirection: "column", gap: 12,
      boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.75)" }}>Add Source</span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", padding: 2, display: "flex" }}>
          <X size={13} />
        </button>
      </div>

      {/* Source type picker */}
      <div style={{ display: "flex", gap: 5 }}>
        {KINDS.map(k => (
          <button key={k.id} onClick={() => { setKind(k.id); setError(null); setValue(""); }}
            style={{
              flex: 1, padding: "8px 4px", borderRadius: 9, fontSize: 10, fontWeight: 700,
              border: `1px solid ${kind === k.id ? "rgba(99,102,241,0.55)" : "rgba(255,255,255,0.07)"}`,
              background: kind === k.id ? "rgba(99,102,241,0.14)" : "rgba(255,255,255,0.02)",
              color: kind === k.id ? "#a5b4fc" : "rgba(255,255,255,0.38)",
              cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              transition: "all 0.15s",
            }}>
            <span style={{ fontSize: 15 }}>{k.icon}</span>
            <span>{k.label}</span>
          </button>
        ))}
      </div>

      {/* Hint */}
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.28)", lineHeight: 1.5, marginTop: -4 }}>
        {selected.hint}
      </div>

      {/* Inputs */}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <input
          value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === "Enter" && resolve()}
          placeholder={selected.placeholder}
          style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.05)", border: `1px solid ${error ? "rgba(248,113,113,0.5)" : "rgba(255,255,255,0.09)"}`, borderRadius: 7, padding: "7px 10px", color: "#fff", fontSize: 11, outline: "none", fontFamily: kind === "tiktok" ? "inherit" : "monospace" }}
        />
        <input
          value={label} onChange={e => setLabel(e.target.value)}
          placeholder="Label (optional)"
          style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 7, padding: "6px 10px", color: "#fff", fontSize: 11, outline: "none" }}
        />
      </div>

      {/* Error */}
      {error && <div style={{ fontSize: 10, color: "#f87171", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 6, padding: "5px 8px" }}>{error}</div>}

      {/* Add button */}
      <button onClick={resolve} disabled={resolving || !value.trim()}
        style={{
          padding: "8px 12px", borderRadius: 8, border: "none",
          background: resolving || !value.trim() ? "rgba(99,102,241,0.3)" : "rgba(99,102,241,0.85)",
          color: resolving || !value.trim() ? "rgba(255,255,255,0.4)" : "#fff",
          fontSize: 11, fontWeight: 700, cursor: resolving || !value.trim() ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          transition: "all 0.2s",
        }}>
        {resolving ? <><Loader2 size={11} style={{ animation: "mv-spin 1s linear infinite" }} /> Resolving…</> : <><Zap size={11} /> Add to Grid</>}
      </button>
    </div>
  );
}

// ── Auto-layout helper ────────────────────────────────────────────────────────
function bestLayout(count: number): LayoutId {
  if (count <= 1) return "solo";
  if (count === 2) return "duo";
  if (count === 3) return "trio";
  if (count === 4) return "quad";
  if (count <= 6) return "hex";
  return "nine";
}

// ── MultiViewPanel ────────────────────────────────────────────────────────────
export function MultiViewPanel({ streams, procStats = {} }: MultiViewPanelProps) {
  const [layout, setLayout] = useState<LayoutId>("quad");
  const [autoLayout, setAutoLayout] = useState(true);
  const [manualTiles, setManualTiles] = useState<ManualTile[]>([]);
  const [addingSource, setAddingSource] = useState(false);
  const [guestTiles, setGuestTiles] = useState<{ guestId: string; guestName: string }[]>([]);
  const [pendingGuests, setPendingGuests] = useState<{ guestId: string; guestName: string }[]>([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [spotlightId, setSpotlightId] = useState<string | null>(null);
  const [newGuestIds, setNewGuestIds] = useState<Set<string>>(new Set());
  const [tileOrder, setTileOrder] = useState<string[]>([]);
  const dragSrcId = useRef<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIce = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const activeStreams = streams.filter(s => s.status === "streaming");

  // ── WebRTC ─────────────────────────────────────────────────────────────────
  const initiateOffer = useCallback(async (guestId: string, ws: WebSocket) => {
    const existing = pcsRef.current.get(guestId);
    if (existing) { existing.close(); pcsRef.current.delete(guestId); }
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcsRef.current.set(guestId, pc);
    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.onicecandidate = e => { if (e.candidate && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "rtc_ice_admin", guestId, candidate: e.candidate.toJSON() })); };
    pc.ontrack = e => {
      if (e.track.kind !== "video") return;
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      (pc as any)._stream = stream;
      const cb = (pc as any)._onstream as ((s: MediaStream) => void) | null;
      if (cb) cb(stream);
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "rtc_offer", guestId, sdp: offer.sdp }));
  }, []);

  const admitGuest = useCallback(async (guestId: string) => {
    try {
      await fetch(`/api/cam-guests/${guestId}/approve`, { method: "POST", credentials: "include" });
    } catch {}
  }, []);

  const declineGuest = useCallback(async (guestId: string) => {
    try {
      await fetch(`/api/cam-guests/${guestId}/reject`, { method: "POST", credentials: "include" });
    } catch {}
  }, []);

  const connectWs = useCallback(() => {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    wsRef.current = ws;
    ws.onopen = () => setWsConnected(true);
    ws.onclose = () => { setWsConnected(false); setTimeout(connectWs, 3000); };
    ws.onerror = () => {};
    ws.onmessage = async e => {
      if (typeof e.data !== "string") return;
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "cam_guest_pending") {
          // Guest arrived in waiting room — show them and initiate WebRTC for camera preview
          setPendingGuests(p => p.some(g => g.guestId === msg.guestId) ? p : [...p, { guestId: msg.guestId, guestName: msg.guestName }]);
          void initiateOffer(msg.guestId, ws);
        }
        if (msg.type === "cam_guests_pending_list") {
          const list = (msg.guests ?? []) as { guestId: string; guestName: string }[];
          setPendingGuests(list);
          for (const g of list) {
            if (!pcsRef.current.has(g.guestId)) void initiateOffer(g.guestId, ws);
          }
        }
        if (msg.type === "cam_guest_join") {
          // Guest was approved — move from pending to live tiles
          setPendingGuests(p => p.filter(g => g.guestId !== msg.guestId));
          setGuestTiles(p => p.some(t => t.guestId === msg.guestId) ? p : [...p, { guestId: msg.guestId, guestName: msg.guestName }]);
          setNewGuestIds(prev => { const next = new Set(prev); next.add(msg.guestId); return next; });
          setTimeout(() => setNewGuestIds(prev => { const next = new Set(prev); next.delete(msg.guestId); return next; }), 4000);
          // Only initiate offer if no existing PC (guest wasn't in pending)
          if (!pcsRef.current.has(msg.guestId)) void initiateOffer(msg.guestId, ws);
        }
        if (msg.type === "cam_guest_leave") {
          setPendingGuests(p => p.filter(g => g.guestId !== msg.guestId));
          setGuestTiles(p => p.filter(t => t.guestId !== msg.guestId));
          const pc = pcsRef.current.get(msg.guestId); if (pc) { pc.close(); pcsRef.current.delete(msg.guestId); }
          setSpotlightId(prev => prev === `guest-${msg.guestId}` ? null : prev);
        }
        if (msg.type === "cam_guest_update") { setGuestTiles(p => p.map(t => t.guestId === msg.guestId ? { ...t, guestName: msg.guestName } : t)); }
        if (msg.type === "rtc_answer" && msg.guestId && msg.sdp) { const pc = pcsRef.current.get(msg.guestId); if (pc?.signalingState === "have-local-offer") { await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp }); for (const c of pendingIce.current.get(msg.guestId) ?? []) await pc.addIceCandidate(c).catch(() => {}); pendingIce.current.delete(msg.guestId); } }
        if (msg.type === "rtc_ice_guest" && msg.guestId && msg.candidate) { const pc = pcsRef.current.get(msg.guestId); if (pc?.remoteDescription) await pc.addIceCandidate(msg.candidate).catch(() => {}); else { const q = pendingIce.current.get(msg.guestId) ?? []; q.push(msg.candidate); pendingIce.current.set(msg.guestId, q); } }
      } catch {}
    };
  }, [initiateOffer]);

  useEffect(() => {
    fetch("/api/cam-guests", { credentials: "include" }).then(r => r.json()).then((guests: GuestInfo[]) => {
      if (guests?.length) {
        setGuestTiles(guests.filter(g => !g.pending).map(g => ({ guestId: g.guestId, guestName: g.guestName })));
        setPendingGuests(guests.filter(g => g.pending).map(g => ({ guestId: g.guestId, guestName: g.guestName })));
      }
    }).catch(() => {});
    connectWs();
    return () => { wsRef.current?.close(); for (const pc of pcsRef.current.values()) pc.close(); pcsRef.current.clear(); };
  }, [connectWs]);

  useEffect(() => {
    if (!wsConnected) return;
    const ws = wsRef.current;
    if (!ws) return;
    for (const tile of guestTiles) { if (!pcsRef.current.has(tile.guestId)) void initiateOffer(tile.guestId, ws); }
  }, [wsConnected, guestTiles, initiateOffer]);

  // ── Auto-layout: pick best grid when source count changes ──────────────────
  const totalSources = activeStreams.length + guestTiles.length + manualTiles.length;
  useEffect(() => {
    if (autoLayout && totalSources > 0) {
      setLayout(bestLayout(totalSources));
    }
  }, [totalSources, autoLayout]);

  // ── Tile assembly with ordering ────────────────────────────────────────────
  const currentLayout = LAYOUTS.find(l => l.id === layout) ?? LAYOUTS[3];
  const totalSlots = currentLayout.max;

  type DisplayItem =
    | { kind: "stream"; stream: Stream }
    | { kind: "guest"; guestId: string; guestName: string }
    | { kind: "manual"; tile: ManualTile };

  const rawItems: DisplayItem[] = [
    ...activeStreams.map(s => ({ kind: "stream" as const, stream: s })),
    ...guestTiles.map(g => ({ kind: "guest" as const, ...g })),
    ...manualTiles.map(t => ({ kind: "manual" as const, tile: t })),
  ];

  // Apply drag-reorder: sort by tileOrder
  const getTileId = (item: DisplayItem) =>
    item.kind === "stream" ? item.stream.id : item.kind === "guest" ? `guest-${item.guestId}` : item.tile.id;

  const items = [...rawItems].sort((a, b) => {
    const ai = tileOrder.indexOf(getTileId(a));
    const bi = tileOrder.indexOf(getTileId(b));
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  }).slice(0, totalSlots);

  const placeholderCount = Math.max(0, totalSlots - items.length);
  const gridHeight = currentLayout.rows === 1 ? 185 : currentLayout.rows === 2 ? 345 : 490;

  // ── Drag handlers ──────────────────────────────────────────────────────────
  const onDragStart = (id: string) => { dragSrcId.current = id; };
  const onDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    if (!dragSrcId.current || dragSrcId.current === id) return;
    setTileOrder(prev => {
      const allIds = items.map(getTileId);
      const order = prev.length ? prev : allIds;
      const from = order.indexOf(dragSrcId.current!);
      const to   = order.indexOf(id);
      if (from === -1 || to === -1) {
        // bootstrap order from current item IDs
        const fresh = [...allIds];
        const fi = fresh.indexOf(dragSrcId.current!);
        const ti = fresh.indexOf(id);
        if (fi !== -1 && ti !== -1) { fresh.splice(ti, 0, fresh.splice(fi, 1)[0]); }
        return fresh;
      }
      const next = [...order];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  };
  const onDragEnd = () => { dragSrcId.current = null; };

  // ── Tile renderer ──────────────────────────────────────────────────────────
  const renderTileContent = (item: DisplayItem, small = false) => {
    if (item.kind === "stream") {
      return (
        <>
          <StreamTile stream={item.stream} stats={small ? undefined : procStats[item.stream.id]} />
          {item.stream.status === "streaming" && <LiveBadge />}
        </>
      );
    }
    if (item.kind === "guest") {
      return <GuestTile guestId={item.guestId} guestName={item.guestName} pcRef={pcsRef} />;
    }
    return (
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        {item.tile.sourceKind === "youtube" && item.tile.embedUrl ? (
          <YoutubeTile embedUrl={item.tile.embedUrl} label={item.tile.label} />
        ) : item.tile.url ? (
          <HlsTile url={item.tile.url} label={item.tile.label} platform={item.tile.sourceKind === "tiktok" ? "tiktok" : "hls"} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <WifiOff size={16} style={{ color: "rgba(255,255,255,0.15)" }} />
          </div>
        )}
        {!small && (
          <button
            onClick={() => setManualTiles(p => p.filter(m => m.id !== item.tile.id))}
            style={{ position: "absolute", top: 8, right: 8, zIndex: 20, width: 22, height: 22, borderRadius: 6, background: "rgba(0,0,0,0.75)", border: "1px solid rgba(255,255,255,0.15)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0, transition: "opacity 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "0")}
          >
            <X size={10} />
          </button>
        )}
      </div>
    );
  };

  const tileBorder = (item: DisplayItem) =>
    item.kind === "stream" && item.stream.status === "streaming" ? "1px solid rgba(124,58,237,0.22)"
    : item.kind === "guest" ? "1px solid rgba(96,165,250,0.2)"
    : item.kind === "manual" ? "1px solid rgba(192,132,252,0.18)"
    : "1px solid rgba(255,255,255,0.04)";

  const spotlightItem = spotlightId ? items.find(i => getTileId(i) === spotlightId) ?? null : null;
  const sidebarItems  = spotlightId ? items.filter(i => getTileId(i) !== spotlightId) : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <LayoutGrid size={12} style={{ color: "#818cf8", flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.72)", letterSpacing: "0.03em" }}>Multi-Screen</span>

        {activeStreams.length > 0 && (
          <div style={{ fontSize: 9, color: "#10b981", background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 4, padding: "1px 6px", fontWeight: 700 }}>
            {activeStreams.length} LIVE
          </div>
        )}
        {guestTiles.length > 0 && (
          <div style={{ fontSize: 9, color: "#60a5fa", background: "rgba(96,165,250,0.1)", border: "1px solid rgba(96,165,250,0.2)", borderRadius: 4, padding: "1px 6px", fontWeight: 700 }}>
            {guestTiles.length} GUEST{guestTiles.length !== 1 ? "S" : ""}
          </div>
        )}
        {manualTiles.length > 0 && (
          <div style={{ fontSize: 9, color: "#c084fc", background: "rgba(192,132,252,0.1)", border: "1px solid rgba(192,132,252,0.2)", borderRadius: 4, padding: "1px 6px", fontWeight: 700 }}>
            {manualTiles.length} CUSTOM
          </div>
        )}
        {spotlightId && (
          <div style={{ fontSize: 9, color: "#fbbf24", background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)", borderRadius: 4, padding: "1px 6px", fontWeight: 700, display: "flex", alignItems: "center", gap: 3 }}>
            ★ SPOTLIGHT
          </div>
        )}

        <div style={{ flex: 1 }} />

        {/* WS dot */}
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: wsConnected ? "#10b981" : "#4b5563", flexShrink: 0 }} title={wsConnected ? "Connected" : "Disconnected"} />

        {/* Add source */}
        <button
          onClick={() => setAddingSource(v => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 4, padding: "4px 9px", borderRadius: 6,
            fontSize: 10, fontWeight: 700, cursor: "pointer",
            border: `1px solid ${addingSource ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.1)"}`,
            background: addingSource ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.03)",
            color: addingSource ? "#a5b4fc" : "rgba(255,255,255,0.45)",
            transition: "all 0.15s",
          }}
        >
          <Plus size={9} /> Add Source
        </button>
      </div>

      {/* ── Invite panel ── */}
      <InvitePanel guestCount={guestTiles.length} />

      {/* ── Waiting room ── */}
      {pendingGuests.length > 0 && (
        <div style={{ borderRadius: 10, border: "1px solid rgba(251,191,36,0.25)", background: "rgba(251,191,36,0.03)", overflow: "hidden" }}>
          <div style={{ padding: "7px 12px", display: "flex", alignItems: "center", gap: 7, borderBottom: "1px solid rgba(251,191,36,0.12)" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#fbbf24", animation: "mv-pulse 1.2s ease-in-out infinite" }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#fbbf24", letterSpacing: "0.03em" }}>Waiting Room</span>
            <span style={{ fontSize: 9, color: "rgba(251,191,36,0.7)", background: "rgba(251,191,36,0.1)", borderRadius: 4, padding: "1px 6px", fontWeight: 700 }}>
              {pendingGuests.length}
            </span>
            <div style={{ flex: 1 }} />
            <button
              onClick={() => pendingGuests.forEach(g => admitGuest(g.guestId))}
              style={{ fontSize: 9, fontWeight: 700, color: "#34d399", background: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.3)", borderRadius: 5, padding: "2px 8px", cursor: "pointer" }}
            >
              Admit all
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 8px" }}>
            {pendingGuests.map(g => (
              <PendingGuestRow
                key={g.guestId}
                guestId={g.guestId}
                guestName={g.guestName}
                pcRef={pcsRef}
                onAdmit={() => admitGuest(g.guestId)}
                onDecline={() => declineGuest(g.guestId)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Add source panel ── */}
      {addingSource && (
        <AddSourcePanel
          onAdd={tile => { setManualTiles(p => [...p, tile]); setAddingSource(false); }}
          onClose={() => setAddingSource(false)}
        />
      )}

      {/* ── Layout toolbar ── */}
      <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
        {/* Auto toggle */}
        <button
          onClick={() => setAutoLayout(v => !v)}
          title={autoLayout ? "Auto-layout ON — click to lock" : "Auto-layout OFF — click to enable"}
          style={{
            padding: "4px 9px", borderRadius: 5, fontSize: 9, fontWeight: 700, cursor: "pointer",
            border: `1px solid ${autoLayout ? "rgba(16,185,129,0.5)" : "rgba(255,255,255,0.08)"}`,
            background: autoLayout ? "rgba(16,185,129,0.14)" : "rgba(255,255,255,0.02)",
            color: autoLayout ? "#34d399" : "rgba(255,255,255,0.3)",
            transition: "all 0.15s", flexShrink: 0,
          }}
        >
          {autoLayout ? "AUTO" : "LOCK"}
        </button>

        {/* Grid layout buttons */}
        {LAYOUTS.map(l => (
          <button key={l.id}
            onClick={() => { setLayout(l.id); setAutoLayout(false); setSpotlightId(null); }}
            style={{
              flex: 1, padding: "4px 2px", borderRadius: 5, fontSize: 9, fontWeight: 700, cursor: "pointer",
              border: `1px solid ${layout === l.id && !spotlightId ? "#7c3aed" : "rgba(255,255,255,0.06)"}`,
              background: layout === l.id && !spotlightId ? "rgba(124,58,237,0.18)" : "rgba(255,255,255,0.02)",
              color: layout === l.id && !spotlightId ? "#c4b5fd" : "rgba(255,255,255,0.3)",
              transition: "all 0.15s",
            }}>
            {l.label}
          </button>
        ))}

        {/* Spotlight clear */}
        {spotlightId && (
          <button
            onClick={() => setSpotlightId(null)}
            style={{ padding: "4px 9px", borderRadius: 5, fontSize: 9, fontWeight: 700, cursor: "pointer", border: "1px solid rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.12)", color: "#fbbf24", flexShrink: 0 }}
          >
            ✕ Spotlight
          </button>
        )}
      </div>

      {/* ── Spotlight layout ── */}
      {spotlightId && spotlightItem ? (
        <div style={{ display: "flex", gap: 6, height: 380 }}>
          {/* Main spotlight tile */}
          <div
            style={{ flex: 1, borderRadius: 10, overflow: "hidden", background: "#080b12", border: "2px solid rgba(251,191,36,0.45)", position: "relative", cursor: "pointer" }}
            onClick={() => setSpotlightId(null)}
          >
            {renderTileContent(spotlightItem)}
            <div style={{ position: "absolute", top: 8, left: 8, zIndex: 30, background: "rgba(251,191,36,0.9)", borderRadius: 5, padding: "2px 8px", fontSize: 9, fontWeight: 800, color: "#000", letterSpacing: "0.05em" }}>
              ★ SPOTLIGHT
            </div>
            <div style={{ position: "absolute", bottom: 8, left: 8, zIndex: 30, fontSize: 10, color: "rgba(255,255,255,0.35)", background: "rgba(0,0,0,0.5)", padding: "2px 7px", borderRadius: 5 }}>
              Click to exit spotlight
            </div>
          </div>

          {/* Sidebar strip */}
          {sidebarItems.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, width: 130, flexShrink: 0 }}>
              {sidebarItems.map(item => {
                const id = getTileId(item);
                return (
                  <div
                    key={id}
                    onClick={() => setSpotlightId(id)}
                    style={{ flex: 1, borderRadius: 8, overflow: "hidden", background: "#080b12", border: tileBorder(item), cursor: "pointer", position: "relative", transition: "border-color 0.2s" }}
                  >
                    {renderTileContent(item, true)}
                    <div style={{ position: "absolute", inset: 0, background: "transparent", transition: "background 0.15s" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "rgba(251,191,36,0.08)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    />
                  </div>
                );
              })}
              {/* Placeholder strips */}
              {Array.from({ length: Math.max(0, 4 - sidebarItems.length) }).map((_, i) => (
                <div key={`sph-${i}`} style={{ flex: 1, borderRadius: 8, overflow: "hidden" }}>
                  <PlaceholderTile index={sidebarItems.length + i} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* ── Normal grid ── */
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${currentLayout.cols}, 1fr)`, gap: 6, height: gridHeight }}>
          {items.map((item) => {
            const tileId = getTileId(item);
            const isFullscreen = fullscreenId === tileId;
            const isNew = item.kind === "guest" && newGuestIds.has(item.guestId);

            return (
              <div
                key={tileId}
                draggable
                onDragStart={() => onDragStart(tileId)}
                onDragOver={e => onDragOver(e, tileId)}
                onDragEnd={onDragEnd}
                style={{
                  position: isFullscreen ? "fixed" : "relative",
                  ...(isFullscreen ? { inset: 0, zIndex: 9999, background: "#000" } : {}),
                  borderRadius: isFullscreen ? 0 : 10,
                  overflow: "hidden",
                  background: "#080b12",
                  border: isNew
                    ? "1px solid rgba(96,165,250,0.7)"
                    : tileBorder(item),
                  transition: "border-color 0.3s, box-shadow 0.3s",
                  boxShadow: isNew ? "0 0 0 2px rgba(96,165,250,0.25)" : "none",
                  animation: isNew ? "mv-slide-in 0.35s ease-out" : "none",
                  cursor: "grab",
                }}
              >
                {/* Guest "JOINED" flash badge */}
                {isNew && (
                  <div style={{ position: "absolute", top: 8, left: 8, zIndex: 30, background: "#3b82f6", borderRadius: 5, padding: "2px 8px", fontSize: 9, fontWeight: 800, color: "#fff", letterSpacing: "0.05em", animation: "mv-pulse 0.9s ease-in-out infinite" }}>
                    JOINED
                  </div>
                )}

                {/* Tile content */}
                {renderTileContent(item)}

                {/* Spotlight button */}
                <button
                  onClick={() => setSpotlightId(tileId)}
                  title="Spotlight this tile"
                  style={{ position: "absolute", top: isNew ? 8 : 8, right: 8, width: 22, height: 22, zIndex: 20, borderRadius: 5, background: "rgba(0,0,0,0.65)", border: "1px solid rgba(251,191,36,0.4)", color: "#fbbf24", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0, transition: "opacity 0.15s", fontSize: 11 }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={e => (e.currentTarget.style.opacity = "0")}
                >
                  ★
                </button>

                {/* Fullscreen toggle */}
                <button
                  onClick={() => setFullscreenId(isFullscreen ? null : tileId)}
                  style={{ position: "absolute", bottom: 8, right: 8, width: 22, height: 22, zIndex: 20, borderRadius: 5, background: "rgba(0,0,0,0.65)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0, transition: "opacity 0.15s" }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={e => (e.currentTarget.style.opacity = "0")}
                >
                  {isFullscreen ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
                </button>
              </div>
            );
          })}

          {Array.from({ length: placeholderCount }).map((_, i) => (
            <div key={`ph-${i}`} style={{ borderRadius: 10, overflow: "hidden" }}>
              <PlaceholderTile index={items.length + i} />
            </div>
          ))}
        </div>
      )}

      {/* ── Empty state ── */}
      {totalSources === 0 && (
        <div style={{ textAlign: "center", padding: "14px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <Tv size={22} style={{ color: "rgba(255,255,255,0.08)" }} />
          <div style={{ color: "rgba(255,255,255,0.22)", fontSize: 11, lineHeight: 1.6 }}>
            No sources yet.<br />
            Start a stream or click <strong style={{ color: "rgba(255,255,255,0.4)" }}>Add Source</strong> to pull in TikTok, YouTube, or HLS.
          </div>
        </div>
      )}

      <style>{`
        @keyframes mv-pulse    { 0%,100%{opacity:1} 50%{opacity:0.35} }
        @keyframes mv-spin     { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes mv-slide-in { from{opacity:0;transform:scale(0.94)} to{opacity:1;transform:scale(1)} }
      `}</style>
    </div>
  );
}
