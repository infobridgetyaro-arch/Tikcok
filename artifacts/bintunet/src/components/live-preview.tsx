import { useState, useEffect, useRef, useCallback } from "react";
import Hls from "hls.js";
import { Tv, Loader2, WifiOff, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LivePreviewProps {
  streamId: string;
  tiktokUsername: string;
  ratio: "mobile" | "desktop";
}

export function LivePreview({ streamId, tiktokUsername, ratio }: LivePreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState<boolean | null>(null);

  const loadPreview = useCallback(async () => {
    if (!tiktokUsername) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/streams/${streamId}/preview`, { credentials: "include" });
      const data = await res.json();

      if (!res.ok) {
        setError(data.message || "Failed to load preview");
        setIsLive(false);
        setLoading(false);
        return;
      }

      setIsLive(data.isLive);

      if (!data.hlsUrl) {
        setError("No preview URL available");
        setLoading(false);
        return;
      }

      const video = videoRef.current;
      if (!video) { setLoading(false); return; }

      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: false,
          lowLatencyMode: true,
          maxBufferLength: 5,
          maxMaxBufferLength: 10,
          maxBufferSize: 2 * 1024 * 1024,
          liveSyncDurationCount: 2,
          liveMaxLatencyDurationCount: 5,
        });
        hlsRef.current = hls;
        hls.loadSource(data.hlsUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch(() => {}); setLoading(false); });
        hls.on(Hls.Events.ERROR, (_e, d) => {
          if (d.fatal) { setError("Stream ended or unavailable"); setLoading(false); hls.destroy(); hlsRef.current = null; }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = data.hlsUrl;
        video.onloadedmetadata = () => { video.play().catch(() => {}); setLoading(false); };
        video.onerror = () => { setError("Stream ended or unavailable"); setLoading(false); };
      } else {
        setError("Browser does not support HLS playback");
        setLoading(false);
      }
    } catch (e: any) {
      setError(e.message || "Network error");
      setLoading(false);
    }
  }, [streamId, tiktokUsername]);

  useEffect(() => {
    if (showPreview && tiktokUsername) loadPreview();
    return () => { if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; } };
  }, [showPreview, tiktokUsername, loadPreview]);

  if (!tiktokUsername) return null;

  return (
    <div className="space-y-2">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowPreview(!showPreview)}
        className="w-full justify-between text-muted-foreground"
        data-testid={`button-toggle-preview-${streamId}`}
      >
        <span className="flex items-center gap-2">
          <Tv className="w-4 h-4" />
          Live Preview
          {isLive !== null && (
            <span className={`w-2 h-2 rounded-full inline-block ${isLive ? "bg-emerald-500 animate-pulse" : "bg-gray-400"}`} />
          )}
        </span>
        {showPreview ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </Button>

      {showPreview && (
        /*
         * Outer: blue gradient stage, full card width.
         * Inner: aspect-ratio-locked box, centred horizontally.
         *   mobile → 9/16 portrait box, capped at 300px tall
         *   desktop → 16/9 landscape box, full width
         * Video: absolutely fills inner box, object-fit:contain ensures
         *   no stretch and no crop regardless of stream resolution.
         * Single <video> element — never conditionally swapped — so HLS stays attached.
         */
        <div
          className="aurora-preview-bg"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 12,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            ...(ratio === "mobile" ? { height: 300 } : {}),
          }}
          data-testid={`preview-container-${streamId}`}
        >
          {/* Aurora orbs rendered behind everything */}
          <div className="aurora-orb aurora-orb-1" />
          <div className="aurora-orb aurora-orb-2" />
          <div className="aurora-orb aurora-orb-3" />
          <div className="aurora-noise" />

          <div
            style={{
              position: "relative",
              zIndex: 1,
              ...(ratio === "mobile"
                ? { height: "100%", aspectRatio: "9/16" }
                : { width: "100%", aspectRatio: "16/9" }
              ),
            }}
          >
            {/* Single video element — never unmounted while preview is open */}
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", display: "block" }}
              data-testid={`video-preview-${streamId}`}
            />

            {loading && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.8)", gap: 8, zIndex: 10 }}>
                <Loader2 className="w-6 h-6 animate-spin text-white/70" />
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>Loading preview...</span>
              </div>
            )}

            {error && !loading && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.9)", gap: 8, zIndex: 10, padding: "0 16px", textAlign: "center" }}>
                <WifiOff className="w-8 h-8" style={{ color: "rgba(255,255,255,0.5)" }} />
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{error}</span>
                <Button variant="secondary" size="sm" onClick={loadPreview} style={{ fontSize: 12, height: 28, marginTop: 4 }} data-testid={`button-retry-preview-${streamId}`}>Retry</Button>
              </div>
            )}

            {isLive && !loading && !error && (
              <div style={{ position: "absolute", top: 8, left: 8, zIndex: 20, background: "#dc2626", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />
                LIVE
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
