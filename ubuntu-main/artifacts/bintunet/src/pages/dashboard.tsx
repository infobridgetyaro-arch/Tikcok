import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { useWebSocket } from "@/hooks/use-websocket";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { StreamCard } from "@/components/stream-card";
import { OverlayAdmin } from "@/components/overlay-admin";
import { SubscriberWidget } from "@/components/subscriber-widget";
import { Plus, Radio, LogOut, Wifi, WifiOff, Link, Copy, RefreshCw, X, Tv2 } from "lucide-react";
import type { StreamConfig } from "@/types/schema";

function InviteModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [inviteUrl, setInviteUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const fetchInvite = useCallback(async () => {
    try {
      const res = await fetch("/api/invite", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setInviteUrl(data.url);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { fetchInvite(); }, [fetchInvite]);

  const copy = () => {
    navigator.clipboard.writeText(inviteUrl);
    toast({ title: "Invite link copied!" });
  };

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const res = await apiRequest("POST", "/api/invite/regenerate");
      const data = await res.json();
      setInviteUrl(data.url);
      toast({ title: "Invite link regenerated", description: "Previous link is now invalid." });
    } catch {}
    setRegenerating(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border bg-card shadow-2xl p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Link className="w-5 h-5 text-primary" />
              Invite to Dashboard
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Share this link to give others access. Anyone with the link can log in.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-invite">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {loading ? (
          <div className="h-10 rounded-md bg-muted animate-pulse" />
        ) : (
          <div className="flex gap-2">
            <Input
              readOnly
              value={inviteUrl}
              className="text-xs font-mono flex-1 bg-muted/50"
              data-testid="input-invite-url"
            />
            <Button size="icon" variant="outline" onClick={copy} data-testid="button-copy-invite">
              <Copy className="w-4 h-4" />
            </Button>
          </div>
        )}

        <div className="flex items-center gap-3 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={regenerate}
            disabled={regenerating}
            className="gap-2"
            data-testid="button-regenerate-invite"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${regenerating ? "animate-spin" : ""}`} />
            Regenerate
          </Button>
          <p className="text-xs text-muted-foreground flex-1">
            Regenerating revokes the current link for everyone.
          </p>
        </div>

        <div className="rounded-xl border bg-muted/30 p-3 space-y-1">
          <p className="text-xs font-semibold">How it works</p>
          <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
            <li>Send the link to anyone you want to invite</li>
            <li>They click the link — no password needed</li>
            <li>They get full dashboard access</li>
            <li>Regenerate to revoke all existing invite links</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { logout } = useAuth();
  const { toast } = useToast();
  const { isConnected, subscribe } = useWebSocket();
  const [streams, setStreams] = useState<StreamConfig[]>([]);
  const [streamLogs, setStreamLogs] = useState<Record<string, string[]>>({});
  const [showInvite, setShowInvite] = useState(false);

  const fetchStreams = useCallback(async () => {
    try {
      const res = await fetch("/api/streams", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setStreams(data);
      }
    } catch {}
  }, []);

  useEffect(() => { fetchStreams(); }, [fetchStreams]);

  useEffect(() => {
    const unsubLog = subscribe("log", (msg) => {
      if (msg.streamId && msg.data) {
        setStreamLogs((prev) => ({
          ...prev,
          [msg.streamId!]: [...(prev[msg.streamId!] || []), msg.data].slice(-200),
        }));
      }
    });
    const unsubStatus = subscribe("status", (msg) => {
      if (msg.streamId && msg.data) {
        setStreams((prev) =>
          prev.map((s) => (s.id === msg.streamId ? { ...s, status: msg.data } : s))
        );
      }
    });
    return () => { unsubLog(); unsubStatus(); };
  }, [subscribe]);

  const addStream = async () => {
    try {
      const res = await apiRequest("POST", "/api/streams", {
        sourceType: "tiktok",
        tiktokUsername: "",
        youtubeSourceUrl: "",
        cameraDevice: "/dev/video0",
        youtubeStreamKey: "",
        facebookRtmpUrl: "",
        ratio: "mobile",
        quality: "best",
        fps: "30",
        muted: false,
        autoRestart: false,
      });
      const newStream = await res.json();
      setStreams((prev) => [...prev, newStream]);
      toast({ title: "Stream added", description: "Configure and start your new stream." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const debounceTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const overlayTextFields = ["overlayChannelName", "overlayHeadline", "overlayTickerText", "youtubeChannelId"];

  const updateStream = async (id: string, data: Partial<StreamConfig>) => {
    setStreams((prev) => prev.map((s) => (s.id === id ? { ...s, ...data } : s)));

    const isOverlayText = Object.keys(data).some((k) => overlayTextFields.includes(k));
    const stream = streams.find((s) => s.id === id);
    const isLive = stream?.status === "streaming" || stream?.status === "reconnecting";

    if (isOverlayText && isLive) {
      const key = `${id}-overlay`;
      if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key]);
      debounceTimers.current[key] = setTimeout(async () => {
        try { await apiRequest("PATCH", `/api/streams/${id}`, data); } catch {}
      }, 1500);
    } else {
      try { await apiRequest("PATCH", `/api/streams/${id}`, data); } catch {}
    }
  };

  const startStream = async (id: string) => {
    try {
      await apiRequest("POST", `/api/streams/${id}/start`);
      setStreams((prev) => prev.map((s) => (s.id === id ? { ...s, status: "streaming" } : s)));
      toast({ title: "Stream started" });
    } catch (e: any) {
      toast({ title: "Error starting stream", description: e.message, variant: "destructive" });
    }
  };

  const stopStream = async (id: string) => {
    try {
      await apiRequest("POST", `/api/streams/${id}/stop`);
      setStreams((prev) => prev.filter((s) => s.id !== id));
      toast({ title: "Stream stopped and removed" });
    } catch (e: any) {
      toast({ title: "Error stopping stream", description: e.message, variant: "destructive" });
    }
  };

  const restartStream = async (id: string) => {
    try {
      await apiRequest("POST", `/api/streams/${id}/restart`);
      setStreams((prev) => prev.map((s) => (s.id === id ? { ...s, status: "reconnecting" } : s)));
      toast({ title: "Stream restarting" });
    } catch (e: any) {
      toast({ title: "Error restarting stream", description: e.message, variant: "destructive" });
    }
  };

  const deleteStream = async (id: string) => {
    try {
      await apiRequest("DELETE", `/api/streams/${id}`);
      setStreams((prev) => prev.filter((s) => s.id !== id));
      setStreamLogs((prev) => { const n = { ...prev }; delete n[id]; return n; });
      toast({ title: "Stream removed" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const toggleMute = async (id: string) => {
    const stream = streams.find((s) => s.id === id);
    if (!stream) return;
    const newMuted = !stream.muted;
    setStreams((prev) => prev.map((s) => (s.id === id ? { ...s, muted: newMuted } : s)));
    try { await apiRequest("POST", `/api/streams/${id}/mute`, { muted: newMuted }); } catch {}
  };

  const activeCount = streams.filter((s) => s.status === "streaming").length;

  return (
    <div className="min-h-screen bg-background">
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}

      {/* Draggable floating subscriber count widget */}
      <SubscriberWidget streams={streams} />

      <header className="sticky top-0 z-40 border-b bg-card/90 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 py-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div
              className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0"
              style={{
                background: "linear-gradient(135deg, rgba(var(--primary)/0.2) 0%, rgba(var(--primary)/0.08) 100%)",
                border: "1px solid rgba(var(--primary)/0.25)",
              }}
            >
              <Tv2 className="w-4 h-4 text-primary" />
            </div>
            <div className="leading-none">
              <h1 className="text-base font-black tracking-tight text-foreground">BintuNet</h1>
              <p className="text-[10px] text-muted-foreground font-medium tracking-widest uppercase leading-tight mt-px">
                Control Room
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {activeCount > 0 && (
              <Badge
                variant="default"
                className="text-xs gap-1 font-bold"
                data-testid="badge-active-count"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                {activeCount} Live
              </Badge>
            )}
            <Badge
              variant="secondary"
              className="text-xs gap-1"
              data-testid="badge-ws-status"
            >
              {isConnected ? (
                <><Wifi className="w-3 h-3 text-emerald-500" /><span className="hidden sm:inline">Online</span></>
              ) : (
                <><WifiOff className="w-3 h-3 text-muted-foreground" /><span className="hidden sm:inline">Offline</span></>
              )}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowInvite(true)}
              className="gap-1.5 hidden sm:flex text-xs h-7 px-2.5"
              data-testid="button-invite"
            >
              <Link className="w-3 h-3" />
              Invite
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowInvite(true)}
              className="sm:hidden w-7 h-7"
              data-testid="button-invite-mobile"
            >
              <Link className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => logout()}
              className="w-7 h-7"
              data-testid="button-logout"
            >
              <LogOut className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <OverlayAdmin streams={streams} onUpdate={updateStream} />

        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">Streams</h2>
            <p className="text-sm text-muted-foreground">
              {streams.length === 0
                ? "No streams configured yet"
                : `${streams.length} stream${streams.length !== 1 ? "s" : ""} configured`}
            </p>
          </div>
          <Button onClick={addStream} data-testid="button-add-stream">
            <Plus className="w-4 h-4 mr-2" />
            Add Stream
          </Button>
        </div>

        {streams.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Radio className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-2">No streams yet</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              Add a stream to start broadcasting. Capture from TikTok, YouTube live, or any camera — and restream to YouTube and Facebook simultaneously.
            </p>
            <Button onClick={addStream} data-testid="button-add-first-stream">
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Stream
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {streams.map((stream, i) => (
              <StreamCard
                key={stream.id}
                stream={stream}
                logs={streamLogs[stream.id] || []}
                onStart={startStream}
                onStop={stopStream}
                onRestart={restartStream}
                onDelete={deleteStream}
                onUpdate={updateStream}
                onToggleMute={toggleMute}
                index={i}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
