import { useState, useEffect, useRef, useCallback } from "react";
import Hls from "hls.js";
import { Tv, Loader2, WifiOff, Eye, EyeOff } from "lucide-react";
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

  const loadPreview = useCallback(async () => {
    if (!tiktokUsername) return;
    setLoading(true);
    setError(null);

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
          style={{
            aspectRatio: "16 / 9",
            background: "linear-gradient(180deg, #1a3a5c 0%, #122840 50%, #0d1f30 100%)",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {/* Single video — object-fit:contain keeps correct ratio, blue bg fills bars */}
          <video
            ref={videoRef}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "contain",
            }}
            muted
            playsInline
            autoPlay
            data-testid={`video-preview-${streamId}`}
          />

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
