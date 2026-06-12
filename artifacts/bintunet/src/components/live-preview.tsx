import { useState, useEffect, useRef, useCallback } from "react";
import Hls from "hls.js";
import { Tv, Loader2, WifiOff, Eye, EyeOff, Signal } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LivePreviewProps {
  streamId: string;
  tiktokUsername: string;
}

export function LivePreview({ streamId, tiktokUsername }: LivePreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState<boolean | null>(null);
  const [isPortrait, setIsPortrait] = useState(false);

  const loadPreview = useCallback(async () => {
    if (!tiktokUsername) return;
    setLoading(true);
    setError(null);
    setIsPortrait(false);

    try {
      const res = await fetch(`/api/streams/${streamId}/preview`, {
        credentials: "include",
      });
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

      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      const detectOrientation = () => {
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          setIsPortrait(video.videoHeight > video.videoWidth);
        }
      };

      video.addEventListener("loadedmetadata", detectOrientation, { once: true });

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
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
          setLoading(false);
        });
        hls.on(Hls.Events.ERROR, (_event, errData) => {
          if (errData.fatal) {
            setError("Stream ended or unavailable");
            setLoading(false);
            hls.destroy();
            hlsRef.current = null;
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = data.hlsUrl;
        video.addEventListener("loadedmetadata", () => {
          video.play().catch(() => {});
          setLoading(false);
        });
        video.addEventListener("error", () => {
          setError("Stream ended or unavailable");
          setLoading(false);
        });
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
    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    };
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
        <div
          className="relative rounded-xl overflow-hidden"
          data-testid={`preview-container-${streamId}`}
          style={isPortrait ? {
            background: "linear-gradient(160deg, #04050f 0%, #080d1c 30%, #060a18 60%, #0a0520 100%)",
            border: "1px solid rgba(56,189,248,0.18)",
            boxShadow: "0 0 40px rgba(56,189,248,0.06), 0 8px 32px rgba(0,0,0,0.7)",
            padding: "20px 0",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 380,
          } : {
            aspectRatio: "16/9",
            background: "linear-gradient(135deg, #020b18 0%, #0a1628 20%, #0d0a2e 40%, #060d1f 55%, #0a1a2e 70%, #12082a 85%, #030c1a 100%)",
            border: "1px solid rgba(56,189,248,0.12)",
            boxShadow: "inset 0 0 80px rgba(56,189,248,0.06), inset 0 0 40px rgba(139,92,246,0.05)",
            position: "relative",
          }}
        >
          {/* Landscape: aurora gradient glow blobs */}
          {!isPortrait && !loading && !error && (
            <>
              <div className="absolute pointer-events-none" style={{
                top: "-10%", left: "10%", width: "40%", height: "60%",
                background: "radial-gradient(ellipse, rgba(56,189,248,0.18) 0%, transparent 70%)",
                filter: "blur(30px)",
              }} />
              <div className="absolute pointer-events-none" style={{
                bottom: "-10%", right: "10%", width: "45%", height: "60%",
                background: "radial-gradient(ellipse, rgba(139,92,246,0.15) 0%, transparent 70%)",
                filter: "blur(30px)",
              }} />
              <div className="absolute pointer-events-none" style={{
                top: "20%", right: "5%", width: "30%", height: "40%",
                background: "radial-gradient(ellipse, rgba(16,185,129,0.08) 0%, transparent 70%)",
                filter: "blur(24px)",
              }} />
            </>
          )}

          {/* Portrait: studio broadcast background */}
          {isPortrait && !loading && !error && (
            <>
              {/* Horizontal scan lines */}
              <div className="absolute inset-0 pointer-events-none opacity-[0.035]" style={{
                backgroundImage: "repeating-linear-gradient(0deg, rgba(255,255,255,0.6) 0px, rgba(255,255,255,0.6) 1px, transparent 1px, transparent 5px)",
              }} />
              {/* Top edge glow */}
              <div className="absolute top-0 left-0 right-0 h-px" style={{
                background: "linear-gradient(90deg, transparent 0%, rgba(56,189,248,0.5) 50%, transparent 100%)",
              }} />
              {/* Bottom edge glow */}
              <div className="absolute bottom-0 left-0 right-0 h-px" style={{
                background: "linear-gradient(90deg, transparent 0%, rgba(56,189,248,0.5) 50%, transparent 100%)",
              }} />
              {/* Left pillar */}
              <div className="absolute top-0 bottom-0 left-0 flex flex-col items-center justify-center gap-3 px-2" style={{ width: 40 }}>
                <div className="w-px flex-1" style={{ background: "linear-gradient(180deg, transparent 0%, rgba(56,189,248,0.25) 50%, transparent 100%)" }} />
                <Signal className="w-3.5 h-3.5 text-sky-400/50 rotate-90" />
                <div className="w-px flex-1" style={{ background: "linear-gradient(180deg, transparent 0%, rgba(56,189,248,0.25) 50%, transparent 100%)" }} />
              </div>
              {/* Right pillar */}
              <div className="absolute top-0 bottom-0 right-0 flex flex-col items-center justify-center gap-3 px-2" style={{ width: 40 }}>
                <div className="w-px flex-1" style={{ background: "linear-gradient(180deg, transparent 0%, rgba(56,189,248,0.25) 50%, transparent 100%)" }} />
                <Signal className="w-3.5 h-3.5 text-sky-400/50 rotate-90" />
                <div className="w-px flex-1" style={{ background: "linear-gradient(180deg, transparent 0%, rgba(56,189,248,0.25) 50%, transparent 100%)" }} />
              </div>
              {/* Corner accents TL */}
              <div className="absolute top-4 left-4 w-6 h-6 border-t border-l border-sky-400/40" />
              <div className="absolute top-4 right-4 w-6 h-6 border-t border-r border-sky-400/40" />
              <div className="absolute bottom-4 left-4 w-6 h-6 border-b border-l border-sky-400/40" />
              <div className="absolute bottom-4 right-4 w-6 h-6 border-b border-r border-sky-400/40" />
              {/* Bottom center info strip */}
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
                <span className="text-[9px] font-mono text-sky-400/60 tracking-widest uppercase">@{tiktokUsername}</span>
              </div>
            </>
          )}

          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
              <div className="flex flex-col items-center gap-2 text-white/70">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span className="text-xs">Loading preview...</span>
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/90 z-10">
              <div className="flex flex-col items-center gap-2 text-white/50 text-center px-4">
                <WifiOff className="w-8 h-8" />
                <span className="text-xs">{error}</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={loadPreview}
                  className="mt-1 text-xs h-7"
                  data-testid={`button-retry-preview-${streamId}`}
                >
                  Retry
                </Button>
              </div>
            </div>
          )}

          <video
            ref={videoRef}
            className={isPortrait
              ? "relative z-10 block"
              : "absolute inset-0 w-full h-full object-contain"
            }
            style={isPortrait ? {
              height: "100%",
              maxHeight: 460,
              width: "auto",
              borderRadius: 8,
              boxShadow: "0 0 60px rgba(0,0,0,0.9), 0 0 20px rgba(56,189,248,0.12)",
            } : undefined}
            muted
            playsInline
            autoPlay
            data-testid={`video-preview-${streamId}`}
          />

          {isLive && !loading && !error && (
            <div className="absolute top-2 left-2 z-20 bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              LIVE
            </div>
          )}
        </div>
      )}
    </div>
  );
}
