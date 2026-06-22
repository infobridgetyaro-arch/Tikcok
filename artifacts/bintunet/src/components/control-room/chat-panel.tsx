import { useState, useEffect, useRef } from "react";
import { MessageSquare } from "lucide-react";

interface ChatMessage {
  id: string;
  authorName: string;
  authorPhoto: string;
  text: string;
  publishedAt: string;
  isMember: boolean;
  isModerator: boolean;
  isOwner: boolean;
  superChatAmount?: string | null;
}

interface QueuedMessage extends ChatMessage {
  priority: number;
  addedAt: number;
  entering: boolean;
}

const MAX_VISIBLE = 6;
const DISPLAY_RATE_MS = 350;

const STYLE_NAMES = ["Queue Feed", "Bubble", "Neon", "Glass", "Toast"] as const;
type ChatStyle = typeof STYLE_NAMES[number];

function getPriority(msg: ChatMessage): number {
  if (msg.superChatAmount) return 3;
  if (msg.isOwner) return 3;
  if (msg.isMember) return 2;
  if (msg.isModerator) return 1;
  return 0;
}

function getBadgeColor(msg: ChatMessage): string {
  if (msg.superChatAmount || msg.isOwner) return "#f59e0b";
  if (msg.isModerator) return "#6366f1";
  if (msg.isMember) return "#10b981";
  return "#4b5563";
}

function getInitials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function Avatar({ msg, size = 32 }: { msg: ChatMessage; size?: number }) {
  const color = getBadgeColor(msg);
  return msg.authorPhoto ? (
    <img
      src={msg.authorPhoto} alt=""
      style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, objectFit: "cover" }}
      onError={(e) => { (e.target as HTMLImageElement).src = ""; }}
    />
  ) : (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: color, display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.35, fontWeight: 800, color: "#fff",
    }}>{getInitials(msg.authorName)}</div>
  );
}

function useMessageQueue(incoming: ChatMessage[]) {
  const queueRef = useRef<QueuedMessage[]>([]);
  const seenRef = useRef<Set<string>>(new Set());
  const [displayed, setDisplayed] = useState<QueuedMessage[]>([]);
  const [queueLen, setQueueLen] = useState(0);

  useEffect(() => {
    const newMsgs = incoming.filter((m) => !seenRef.current.has(m.id));
    if (!newMsgs.length) return;
    newMsgs.forEach((m) => seenRef.current.add(m.id));
    const tagged: QueuedMessage[] = newMsgs.map((m) => ({
      ...m,
      priority: getPriority(m),
      addedAt: Date.now(),
      entering: false,
    }));
    // Super chats & owner messages jump to front of queue
    const vip = tagged.filter((m) => m.priority >= 3);
    const others = tagged.filter((m) => m.priority < 3);
    queueRef.current = [...vip, ...queueRef.current, ...others];
    setQueueLen(queueRef.current.length);
  }, [incoming]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!queueRef.current.length) return;
      const next = queueRef.current.shift()!;
      setQueueLen(queueRef.current.length);
      setDisplayed((prev) => {
        const withNew = [...prev, { ...next, entering: true }];
        const trimmed = withNew.length > MAX_VISIBLE ? withNew.slice(withNew.length - MAX_VISIBLE) : withNew;
        setTimeout(() => {
          setDisplayed((cur) => cur.map((m) => (m.id === next.id ? { ...m, entering: false } : m)));
        }, 450);
        return trimmed;
      });
    }, DISPLAY_RATE_MS);
    return () => clearInterval(interval);
  }, []);

  return { displayed, queueLen };
}

// ── Queue Feed ────────────────────────────────────────────────────────────────
function QueueFeedChat({ messages }: { messages: QueuedMessage[] }) {
  return (
    <div style={{ minHeight: 180, display: "flex", flexDirection: "column" }}>
      {messages.length === 0 && (
        <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 12, textAlign: "center", padding: "50px 0" }}>
          Queue empty — messages appear as they arrive
        </div>
      )}
      {messages.map((msg) => {
        const isSuperChat = !!(msg.superChatAmount || msg.isOwner);
        const color = getBadgeColor(msg);
        return (
          <div key={msg.id} style={{
            display: "flex", gap: 10, alignItems: "flex-start",
            padding: "9px 14px",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
            borderLeft: `3px solid ${isSuperChat ? "#f59e0b" : color}`,
            background: msg.entering
              ? isSuperChat ? "rgba(245,158,11,0.18)" : "rgba(102,126,234,0.1)"
              : isSuperChat ? "rgba(245,158,11,0.06)" : "transparent",
            transition: "background 0.4s ease",
            animation: msg.entering ? "qf-enter 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards" : "none",
          }}>
            <Avatar msg={msg} size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 800, color }}>{msg.authorName}</span>
                {isSuperChat && msg.superChatAmount && (
                  <span style={{ fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 99, background: "rgba(245,158,11,0.2)", border: "1px solid rgba(245,158,11,0.4)", color: "#fcd34d" }}>
                    ★ {msg.superChatAmount}
                  </span>
                )}
                {msg.isMember && !isSuperChat && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 99, background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)", color: "#6ee7b7" }}>Member</span>
                )}
                {msg.isModerator && !msg.isMember && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 99, background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)", color: "#a5b4fc" }}>Mod</span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", wordBreak: "break-word", lineHeight: 1.4 }}>{msg.text}</div>
            </div>
          </div>
        );
      })}
      <style>{`@keyframes qf-enter { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: none; } }`}</style>
    </div>
  );
}

// ── Bubble ────────────────────────────────────────────────────────────────────
function BubbleChat({ messages }: { messages: QueuedMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  return (
    <div style={{ minHeight: 180, maxHeight: 280, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: 9 }}>
      {messages.length === 0 && <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 12, textAlign: "center", padding: "60px 0" }}>No messages yet…</div>}
      {messages.map((msg) => {
        const color = getBadgeColor(msg);
        return (
          <div key={msg.id} style={{ display: "flex", gap: 8, alignItems: "flex-end", animation: msg.entering ? "bubble-in 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards" : "none" }}>
            <Avatar msg={msg} size={28} />
            <div style={{ maxWidth: "78%", display: "flex", flexDirection: "column", gap: 3 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color, paddingLeft: 6 }}>{msg.authorName}</span>
              <div style={{
                background: `linear-gradient(135deg, ${color}22, ${color}11)`,
                border: `1px solid ${color}33`, borderRadius: "16px 16px 16px 4px",
                padding: "8px 12px", fontSize: 12, color: "#e2e8f0", lineHeight: 1.4, wordBreak: "break-word",
              }}>{msg.text}</div>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
      <style>{`@keyframes bubble-in { from{opacity:0;transform:translateY(12px) scale(0.92);} to{opacity:1;transform:none;} }`}</style>
    </div>
  );
}

// ── Neon ──────────────────────────────────────────────────────────────────────
function NeonChat({ messages }: { messages: QueuedMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  return (
    <div style={{ minHeight: 180, maxHeight: 280, overflowY: "auto", padding: "8px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
      {messages.length === 0 && <div style={{ color: "rgba(0,255,240,0.25)", fontSize: 12, textAlign: "center", padding: "60px 0" }}>No messages yet…</div>}
      {messages.map((msg) => {
        const color = getBadgeColor(msg);
        return (
          <div key={msg.id} style={{ display: "flex", gap: 8, alignItems: "baseline", animation: msg.entering ? "neon-in 0.35s ease forwards" : "none" }}>
            <span style={{ fontSize: 11, fontWeight: 800, color, flexShrink: 0, textShadow: `0 0 8px ${color}` }}>{msg.authorName}:</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.8)", wordBreak: "break-word" }}>{msg.text}</span>
          </div>
        );
      })}
      <div ref={endRef} />
      <style>{`@keyframes neon-in { from{opacity:0;filter:blur(4px);} to{opacity:1;filter:none;} }`}</style>
    </div>
  );
}

// ── Glass ─────────────────────────────────────────────────────────────────────
function GlassChat({ messages }: { messages: QueuedMessage[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);
  return (
    <div style={{ minHeight: 180, maxHeight: 280, overflowY: "auto", padding: "10px", display: "flex", flexDirection: "column", gap: 6 }}>
      {messages.length === 0 && <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 12, textAlign: "center", padding: "60px 0" }}>No messages yet…</div>}
      {messages.map((msg) => {
        const color = getBadgeColor(msg);
        return (
          <div key={msg.id} style={{
            display: "flex", gap: 9, alignItems: "flex-start",
            background: "rgba(255,255,255,0.05)", backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, padding: "8px 12px",
            animation: msg.entering ? "glass-in 0.4s ease forwards" : "none",
          }}>
            <Avatar msg={msg} size={26} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color }}>{msg.authorName}</span>
                {msg.superChatAmount && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 99, background: "rgba(245,158,11,0.2)", color: "#fcd34d" }}>★ {msg.superChatAmount}</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", wordBreak: "break-word", lineHeight: 1.4 }}>{msg.text}</div>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
      <style>{`@keyframes glass-in { from{opacity:0;transform:translateY(8px);} to{opacity:1;transform:none;} }`}</style>
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function ToastChat({ messages }: { messages: QueuedMessage[] }) {
  const visible = messages.slice(-5);
  return (
    <div style={{ minHeight: 180, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 5, padding: "10px" }}>
      {messages.length === 0 && <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 12, textAlign: "center", padding: "50px 0" }}>No messages yet…</div>}
      {visible.map((msg, i) => {
        const age = visible.length - 1 - i;
        const color = getBadgeColor(msg);
        return (
          <div key={msg.id} style={{
            background: `rgba(17,17,34,${1 - age * 0.12})`,
            border: "1px solid rgba(255,255,255,0.1)", borderLeft: `3px solid ${color}`,
            borderRadius: 10, padding: "8px 12px", display: "flex", gap: 9, alignItems: "center",
            transform: `translateX(${age * 6}px) scale(${1 - age * 0.02})`,
            opacity: 1 - age * 0.15,
            animation: i === visible.length - 1 ? "toast-in 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards" : "none",
          }}>
            <Avatar msg={msg} size={24} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color, marginBottom: 1 }}>{msg.authorName}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.75)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{msg.text}</div>
            </div>
          </div>
        );
      })}
      <style>{`@keyframes toast-in { from{opacity:0;transform:translateX(30px) scale(0.9);} to{opacity:1;transform:translateX(0) scale(1);} }`}</style>
    </div>
  );
}

interface ChatPanelProps {
  chatMessages: ChatMessage[];
  activeStreamId: string | null;
  activeStreamCount: number;
}

export function ChatPanel({ chatMessages, activeStreamId, activeStreamCount }: ChatPanelProps) {
  const [styleIdx, setStyleIdx] = useState(0);
  const currentStyle: ChatStyle = STYLE_NAMES[styleIdx];
  const { displayed, queueLen } = useMessageQueue(chatMessages);

  const accentColors = ["#a78bfa", "#667eea", "#00fff0", "rgba(255,255,255,0.15)", "#f59e0b"];
  const borderColors = ["rgba(167,139,250,0.2)", "rgba(102,126,234,0.15)", "rgba(0,255,240,0.2)", "rgba(255,255,255,0.08)", "rgba(245,158,11,0.15)"];
  const bgColors = ["transparent", "transparent", "#050510", "transparent", "transparent"];

  const renderChat = () => {
    switch (currentStyle) {
      case "Queue Feed": return <QueueFeedChat messages={displayed} />;
      case "Bubble":     return <BubbleChat messages={displayed} />;
      case "Neon":       return <NeonChat messages={displayed} />;
      case "Glass":      return <GlassChat messages={displayed} />;
      case "Toast":      return <ToastChat messages={displayed} />;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {STYLE_NAMES.map((name, i) => (
            <button
              key={name}
              onClick={() => setStyleIdx(i)}
              style={{
                padding: "4px 11px", borderRadius: 20,
                border: `1px solid ${styleIdx === i ? accentColors[i] : "rgba(255,255,255,0.1)"}`,
                background: styleIdx === i ? `${accentColors[i]}22` : "transparent",
                color: styleIdx === i ? "#fff" : "rgba(255,255,255,0.45)",
                fontSize: 11, fontWeight: 600, cursor: "pointer", transition: "all 0.18s ease",
              }}
            >{name}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {queueLen > 0 && (
            <div style={{
              background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: 99, padding: "2px 9px", color: "#fcd34d", fontSize: 10, fontWeight: 700,
              display: "flex", gap: 4, alignItems: "center",
            }}>
              <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#f59e0b", animation: "pulse 1s infinite" }} />
              {queueLen} queued
            </div>
          )}
          {chatMessages.length > 0 && (
            <div style={{ background: "rgba(102,126,234,0.12)", border: "1px solid rgba(102,126,234,0.25)", borderRadius: 99, padding: "2px 9px", color: "#a5b4fc", fontSize: 10, fontWeight: 700 }}>
              {chatMessages.length} total
            </div>
          )}
        </div>
      </div>

      {activeStreamCount === 0 ? (
        <div style={{ height: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, background: "rgba(255,255,255,0.02)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)" }}>
          <MessageSquare size={20} style={{ color: "rgba(255,255,255,0.2)" }} />
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>Chat appears when a stream is live</span>
        </div>
      ) : (
        <div style={{ borderRadius: 12, border: `1px solid ${borderColors[styleIdx]}`, background: bgColors[styleIdx], overflow: "hidden" }}>
          {renderChat()}
        </div>
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1;} 50%{opacity:0.3;} }`}</style>
    </div>
  );
}
