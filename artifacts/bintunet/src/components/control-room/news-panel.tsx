import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Newspaper, Play, Square, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";

const STYLE_NAMES = ["Ticker", "Breaking", "Lower Third", "Spotlight", "Crawl"] as const;
type NewsStyle = typeof STYLE_NAMES[number];

const DEFAULT_HEADLINES = [
  "Welcome to the live stream!",
  "Stay tuned for more updates",
  "Thanks for watching!",
];

function TickerOverlay({ text, active }: { text: string; active: boolean }) {
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: 10,
        background: "linear-gradient(90deg, #1a1a2e 0%, #16213e 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        height: 52,
        display: "flex",
        alignItems: "center",
      }}
    >
      <div
        style={{
          background: "#e53e3e",
          color: "#fff",
          fontWeight: 800,
          fontSize: 11,
          letterSpacing: "0.08em",
          padding: "0 14px",
          height: "100%",
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          textTransform: "uppercase",
          gap: 6,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#fff", display: active ? "block" : "none", animation: active ? "pulse 1.2s infinite" : "none" }} />
        LIVE
      </div>
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {active ? (
          <div
            style={{
              display: "inline-block",
              whiteSpace: "nowrap",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              animation: "ticker-scroll 18s linear infinite",
              paddingLeft: "100%",
            }}
          >
            {text}
            &nbsp;&nbsp;&nbsp;•&nbsp;&nbsp;&nbsp;
            {text}
          </div>
        ) : (
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, padding: "0 16px" }}>Preview — press Play to activate</div>
        )}
      </div>
      <style>{`
        @keyframes ticker-scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
      `}</style>
    </div>
  );
}

function BreakingOverlay({ text, active }: { text: string; active: boolean }) {
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setFlash((v) => !v), 800);
    return () => clearInterval(t);
  }, [active]);

  return (
    <div
      style={{
        borderRadius: 10,
        background: active
          ? `linear-gradient(135deg, ${flash ? "#7c1010" : "#c53030"} 0%, #1a1a2e 100%)`
          : "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
        border: `1px solid ${active ? (flash ? "#fc8181" : "#e53e3e") : "rgba(255,255,255,0.08)"}`,
        padding: "14px 20px",
        transition: "all 0.4s ease",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {active && (
        <div style={{
          position: "absolute", inset: 0, background: "radial-gradient(ellipse at center, rgba(229,62,62,0.15) 0%, transparent 70%)",
          animation: "pulse-bg 1.6s ease-in-out infinite",
        }} />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
        <div style={{
          background: "#e53e3e", color: "#fff", fontSize: 9, fontWeight: 900,
          padding: "3px 8px", borderRadius: 4, letterSpacing: "0.12em", textTransform: "uppercase",
          animation: active ? "breaking-flash 1.6s ease-in-out infinite" : "none",
        }}>
          ⚡ BREAKING
        </div>
        <span style={{ color: active ? "#fff" : "rgba(255,255,255,0.4)", fontSize: 14, fontWeight: 700, flex: 1 }}>
          {active ? text : "Preview — press Play"}
        </span>
      </div>
      <style>{`
        @keyframes breaking-flash { 0%,100%{opacity:1;} 50%{opacity:0.5;} }
        @keyframes pulse-bg { 0%,100%{opacity:0.5;} 50%{opacity:1;} }
      `}</style>
    </div>
  );
}

function LowerThirdOverlay({ text, active }: { text: string; active: boolean }) {
  return (
    <div
      style={{
        borderRadius: 10,
        background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        padding: 16,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8 }}>Lower Third Preview</div>
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          gap: 0,
          overflow: "hidden",
          borderRadius: 6,
          transform: active ? "translateY(0)" : "translateY(16px)",
          opacity: active ? 1 : 0.3,
          transition: "all 0.5s cubic-bezier(0.34,1.56,0.64,1)",
        }}
      >
        <div style={{ width: 5, background: "linear-gradient(180deg, #667eea 0%, #764ba2 100%)", flexShrink: 0 }} />
        <div style={{ background: "rgba(0,0,0,0.85)", padding: "10px 14px", flex: 1 }}>
          <div style={{ color: "#fff", fontSize: 14, fontWeight: 800 }}>{active ? text : "Your headline here"}</div>
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, marginTop: 2 }}>BintuNet Live</div>
        </div>
      </div>
    </div>
  );
}

function SpotlightOverlay({ text, active }: { text: string; active: boolean }) {
  return (
    <div
      style={{
        borderRadius: 10,
        background: "linear-gradient(135deg, #0d0d1a 0%, #1a1a2e 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        padding: 20,
        textAlign: "center",
        position: "relative",
        overflow: "hidden",
        minHeight: 80,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {active && (
        <div style={{
          position: "absolute",
          width: 300, height: 300,
          background: "radial-gradient(circle, rgba(102,126,234,0.25) 0%, transparent 70%)",
          top: "50%", left: "50%",
          transform: "translate(-50%,-50%)",
          animation: "spotlight-pulse 3s ease-in-out infinite",
        }} />
      )}
      <div
        style={{
          position: "relative",
          color: active ? "#fff" : "rgba(255,255,255,0.3)",
          fontSize: 16,
          fontWeight: 800,
          letterSpacing: "0.02em",
          opacity: active ? 1 : 0.4,
          transition: "all 0.6s ease",
          textShadow: active ? "0 0 30px rgba(102,126,234,0.8)" : "none",
          animation: active ? "spotlight-text 3s ease-in-out infinite" : "none",
        }}
      >
        {active ? text : "Preview — press Play"}
      </div>
      <style>{`
        @keyframes spotlight-pulse { 0%,100%{transform:translate(-50%,-50%) scale(1);opacity:0.5;} 50%{transform:translate(-50%,-50%) scale(1.3);opacity:1;} }
        @keyframes spotlight-text { 0%,100%{text-shadow:0 0 20px rgba(102,126,234,0.6);} 50%{text-shadow:0 0 40px rgba(102,126,234,1), 0 0 80px rgba(102,126,234,0.4);} }
      `}</style>
    </div>
  );
}

function CrawlOverlay({ headlines, active }: { headlines: string[]; active: boolean }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setIdx((v) => (v + 1) % headlines.length), 3500);
    return () => clearInterval(t);
  }, [active, headlines.length]);
  return (
    <div
      style={{
        borderRadius: 10,
        background: "linear-gradient(135deg, #0a0a1a 0%, #1a1a2e 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        padding: 16,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 10 }}>News Crawl Preview</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {headlines.map((h, i) => (
          <div
            key={i}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "7px 12px",
              borderRadius: 6,
              background: active && i === idx ? "rgba(102,126,234,0.15)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${active && i === idx ? "rgba(102,126,234,0.4)" : "rgba(255,255,255,0.06)"}`,
              transition: "all 0.4s ease",
              transform: active && i === idx ? "translateX(4px)" : "translateX(0)",
            }}
          >
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: active && i === idx ? "#667eea" : "rgba(255,255,255,0.2)",
              flexShrink: 0,
              transition: "background 0.3s ease",
            }} />
            <span style={{ color: active && i === idx ? "#fff" : "rgba(255,255,255,0.4)", fontSize: 12, fontWeight: active && i === idx ? 600 : 400, transition: "all 0.3s ease" }}>
              {h}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NewsPanel({ activeStreamCount }: { activeStreamCount: number }) {
  const [styleIdx, setStyleIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [headline, setHeadline] = useState("Welcome to the live stream! Stay tuned for amazing content.");
  const [headlines, setHeadlines] = useState<string[]>(DEFAULT_HEADLINES);

  const currentStyle = STYLE_NAMES[styleIdx];

  const renderPreview = () => {
    switch (currentStyle) {
      case "Ticker": return <TickerOverlay text={headline} active={playing} />;
      case "Breaking": return <BreakingOverlay text={headline} active={playing} />;
      case "Lower Third": return <LowerThirdOverlay text={headline} active={playing} />;
      case "Spotlight": return <SpotlightOverlay text={headline} active={playing} />;
      case "Crawl": return <CrawlOverlay headlines={headlines} active={playing} />;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {STYLE_NAMES.map((name, i) => (
            <button
              key={name}
              onClick={() => { setStyleIdx(i); setPlaying(false); }}
              style={{
                padding: "4px 12px",
                borderRadius: 20,
                border: `1px solid ${styleIdx === i ? "#667eea" : "rgba(255,255,255,0.12)"}`,
                background: styleIdx === i ? "rgba(102,126,234,0.2)" : "transparent",
                color: styleIdx === i ? "#a5b4fc" : "rgba(255,255,255,0.5)",
                fontSize: 11,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              {name}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={() => setPlaying((v) => !v)}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "5px 14px", borderRadius: 8,
              border: `1px solid ${playing ? "#e53e3e" : "#48bb78"}`,
              background: playing ? "rgba(229,62,62,0.15)" : "rgba(72,187,120,0.15)",
              color: playing ? "#fc8181" : "#68d391",
              fontSize: 11, fontWeight: 700, cursor: "pointer",
              transition: "all 0.2s ease",
            }}
          >
            {playing ? <><Square size={11} /> Stop</> : <><Play size={11} /> Activate</>}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        {currentStyle !== "Crawl" && (
          <input
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            placeholder="Enter news headline..."
            style={{
              flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8, padding: "7px 12px", color: "#fff", fontSize: 12, outline: "none",
            }}
          />
        )}
        {currentStyle === "Crawl" && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            {headlines.map((h, i) => (
              <input
                key={i}
                value={h}
                onChange={(e) => setHeadlines((prev) => prev.map((x, j) => j === i ? e.target.value : x))}
                style={{
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: 8, padding: "6px 12px", color: "#fff", fontSize: 12, outline: "none",
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div>{renderPreview()}</div>

      {playing && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 8, background: "rgba(72,187,120,0.1)", border: "1px solid rgba(72,187,120,0.25)" }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#68d391", animation: "pulse 1.2s infinite" }} />
          <span style={{ color: "#68d391", fontSize: 11, fontWeight: 600 }}>
            {currentStyle} news overlay is ACTIVE on {activeStreamCount} stream{activeStreamCount !== 1 ? "s" : ""}
          </span>
        </div>
      )}
    </div>
  );
}
