import { useState, useRef, useEffect, useCallback } from "react";
import { Youtube, GripHorizontal, X, Users } from "lucide-react";
import type { StreamConfig } from "@/types/schema";

interface SubscriberWidgetProps {
  streams: StreamConfig[];
}

export function SubscriberWidget({ streams }: SubscriberWidgetProps) {
  const targetStream = streams.find(
    (s) =>
      (s.status === "streaming" || s.status === "reconnecting") &&
      s.overlayLiveCount &&
      s.youtubeChannelId
  );

  const [count, setCount] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setPos({
      x: Math.max(0, window.innerWidth - 228),
      y: Math.max(0, window.innerHeight - 130),
    });
    setInitialized(true);
  }, []);

  const fetchCount = useCallback(async () => {
    if (!targetStream) return;
    try {
      const res = await fetch(`/api/streams/${targetStream.id}/live-count`, {
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.count) setCount(data.count);
      }
    } catch {}
  }, [targetStream?.id]);

  useEffect(() => {
    if (!targetStream) {
      setCount(null);
      return;
    }
    fetchCount();
    const t = setInterval(fetchCount, 30000);
    return () => clearInterval(t);
  }, [targetStream?.id, fetchCount]);

  useEffect(() => {
    if (targetStream) setVisible(true);
  }, [targetStream?.id]);

  if (!targetStream || !visible || !initialized) return null;

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    dragOffsetRef.current = {
      x: e.clientX - pos.x,
      y: e.clientY - pos.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) return;
    setPos({
      x: Math.max(
        0,
        Math.min(window.innerWidth - 200, e.clientX - dragOffsetRef.current.x)
      ),
      y: Math.max(
        0,
        Math.min(window.innerHeight - 96, e.clientY - dragOffsetRef.current.y)
      ),
    });
  }

  function onPointerUp() {
    draggingRef.current = false;
  }

  return (
    <div
      className="fixed z-50 select-none"
      style={{ left: pos.x, top: pos.y, width: 200 }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background:
            "linear-gradient(145deg, rgba(8,0,0,0.96) 0%, rgba(24,3,3,0.98) 100%)",
          border: "1px solid rgba(255,50,50,0.3)",
          boxShadow:
            "0 0 24px rgba(220,0,0,0.2), 0 0 60px rgba(200,0,0,0.08), 0 12px 40px rgba(0,0,0,0.75)",
        }}
      >
        <div
          className="px-3 pt-2.5 pb-1.5 flex items-center justify-between cursor-grab active:cursor-grabbing"
          onPointerDown={onPointerDown}
          style={{ touchAction: "none" }}
        >
          <div className="flex items-center gap-1.5">
            <span className="relative flex">
              <span
                className="absolute inline-flex w-full h-full rounded-full bg-red-500 opacity-60 animate-ping"
                style={{ animationDuration: "2s" }}
              />
              <span className="relative w-2 h-2 rounded-full bg-red-500" />
            </span>

            <span className="text-[7px] font-bold tracking-[0.25em] text-red-400 uppercase">
              Live
            </span>
          </div>

          <div className="flex items-center gap-2">
            <GripHorizontal className="w-3.5 h-3.5 text-red-900/60" />

            <button
              className="text-red-900/60 hover:text-red-400 transition-colors"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setVisible(false)}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>

        <div className="px-3 pb-3">
          <div className="flex items-center gap-2.5">
            <div
              className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0"
              style={{
                background:
                  "radial-gradient(circle, rgba(255,0,0,0.25) 0%, rgba(120,0,0,0.1) 100%)",
                border: "1px solid rgba(255,0,0,0.35)",
              }}
            >
              <Youtube className="w-5 h-5 text-red-500" />
            </div>

            <div className="flex-1 min-w-0">
              {count ? (
                <>
                  <p
                    className="text-[18px] font-black leading-none tracking-tight text-white"
                    style={{
                      textShadow: "0 0 20px rgba(255,80,80,0.5)",
                    }}
                  >
                    {count}
                  </p>

                  <p className="text-[7px] font-semibold tracking-[0.2em] text-red-400 uppercase mt-0.5">
                    Subscribers
                  </p>
                </>
              ) : (
                <>
                  <div className="h-6 w-14 rounded bg-red-900/30 animate-pulse mb-1" />

                  <p className="text-[7px] text-red-900 tracking-wide uppercase">
                    Fetching…
                  </p>
                </>
              )}
            </div>
          </div>
        </div>

        <div
          className="h-0.5 w-full"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(255,50,50,0.6) 50%, transparent 100%)",
          }}
        />
      </div>
    </div>
  );
}