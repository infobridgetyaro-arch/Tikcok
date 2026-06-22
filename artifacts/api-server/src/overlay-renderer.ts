import { createCanvas, loadImage } from "@napi-rs/canvas";
import { Readable } from "stream";
import QRCode from "qrcode";
import type { GiftDef, GiftQueueItem } from "./gift-system";

export interface OverlayPosition {
  x: number; // 0–100 % from left
  y: number; // 0–100 % from top
}

export interface ChatBurnMessage {
  name: string;
  text: string;
  color?: string;
  ts: number;
}

export interface SuperChatMessage {
  user: string;
  amount: string;
  text: string;
  color: string; // hex tier color
  ts: number;    // Date.now() when received
}

export interface OverlayState {
  // ── News ticker ──────────────────────────────────────────────────────────
  newsActive: boolean;
  newsText: string;
  newsTitle: string;     // optional header/title (shown in Lower Third, Breaking, etc.)
  newsBgColor: string;   // background/accent color for news bar (default "#cc0001")
  newsStyle: string;     // "Ticker" | "Breaking" | "Lower Third" | "Spotlight" | "Crawl" | "Pop-up" | "Scroll Banner"
  newsAnimation: string; // "None" | "Fade" | "→" | "←" | "↓" | "↙" | "↗" | "Typewriter" | "Pop-in" | "Letter Fade" | "Bounce" | "Reveal"
  newsPosition: OverlayPosition;

  // ── Ads ──────────────────────────────────────────────────────────────────
  adActive: boolean;
  adText: string;
  adSub: string;
  adStyle: string;
  adPosition: OverlayPosition;

  // ── Break screen ─────────────────────────────────────────────────────────
  breakActive: boolean;
  breakText: string;
  breakStyle: string;

  // ── Live stats bar ───────────────────────────────────────────────────────
  statsActive: boolean;
  statsPosition: OverlayPosition;
  subs: string | null;
  viewers: string | null;

  // ── Subscriber count overlay ─────────────────────────────────────────────
  subsOverlayActive: boolean;
  subsStyle: string;
  subsPosition: OverlayPosition;
  subsGoal: number;

  // ── Subscriber sparkline chart ───────────────────────────────────────────
  subChartActive: boolean;
  subChartData: number[];          // raw subscriber counts (last N samples)
  subChartPosition: OverlayPosition;
  mobileSubChartPosition: OverlayPosition;

  // ── Subscriber milestone alert ───────────────────────────────────────────
  subAlertActive: boolean;
  subAlertMessage: string;

  // ── Chat burn-in ─────────────────────────────────────────────────────────
  chatBurnActive: boolean;
  chatBurnStyle: string;
  chatBurnPosition: OverlayPosition;
  chatBurnMessages: ChatBurnMessage[];

  // ── Super Chat notifications ──────────────────────────────────────────────
  superChatMessages: SuperChatMessage[];

  // ── Guest name tag ────────────────────────────────────────────────────────
  guestNameActive: boolean;
  guestName: string;
  guestTitle: string;
  guestStyle: string;   // "Classic" | "Neon" | "Gradient" | "Minimal" | "Sports"
  guestPosition: OverlayPosition;
  mobileGuestPosition: OverlayPosition;

  // ── Background gradient (bg pipe — behind video) ──────────────────────────
  bgGradientActive: boolean;
  bgGradient1: string;
  bgGradient2: string;
  bgGradientOpacity: number;

  // ── Mobile (portrait) position overrides ─────────────────────────────────
  mobileStatsPosition: OverlayPosition;
  mobileSubsPosition: OverlayPosition;
  mobileChatBurnPosition: OverlayPosition;
  mobileNewsPosition: OverlayPosition;
  mobileAdPosition: OverlayPosition;

  // ── Element scale (50–200, 100 = actual size) ─────────────────────────────
  statsScale: number;
  subsScale: number;
  chatBurnScale: number;
  newsScale: number;
  adScale: number;
  guestScale: number;
  subChartScale: number;

  // ── Break video ──────────────────────────────────────────────────────────
  breakVideoUrl: string;
  breakVideoMode: "fullscreen" | "live-bg" | "gradient-bg";
  breakVideoPanX: number;   // 0–100; 50 = centred horizontally
  breakVideoPanY: number;   // 0–100; 50 = centred vertically

  // ── QR code overlay ───────────────────────────────────────────────────────
  qrActive: boolean;
  qrUrl: string;
  qrTitle: string;
  qrSize: number;
  qrPosition: OverlayPosition;
  qrScanCount: number;
  qrThankYouActive: boolean;
  qrThankYouName: string;
  qrThankYouTs: number;

  // ── Audio mute controls ───────────────────────────────────────────────────
  liveAudioMuted: boolean;   // mute the live source audio in the RTMP stream
  breakVideoMuted: boolean;  // mute the break video audio in the browser display

  // ── Featured comment (StreamYard-style single comment highlight) ───────────
  featuredComment: { name: string; text: string; color?: string; ts: number } | null;

  // ── Screen Share PIP overlay ──────────────────────────────────────────────
  screenShareActive: boolean;
  screenShareMode: "pip" | "presenter" | "fullscreen";
  screenShareX: number;       // 0–100 % from left (pip only)
  screenShareY: number;       // 0–100 % from top  (pip only)
  screenShareW: number;       // width as % of video width (pip only)
  screenShareRadius: number;  // corner radius px (0–80)

  // ── Donation alert overlay ────────────────────────────────────────────────
  donationAlertActive: boolean;
  donationAlerts: Array<{ id: string; name: string; amount: string; amountKes: number; currency: string; message: string; color: string; ts: number }>;
  // Donation ticker (scrolling bar at bottom of frame)
  donationTickerActive: boolean;
  donationTicker: Array<{ name: string; amount: string; amountKes: number; color: string; ts: number; giftId?: string }>;
  // Gift economy system (TikTok-style)
  giftQueue: GiftQueueItem[];
  giftDisplayMode: "auto" | "minimal" | "standard" | "hype";
}

export function defaultOverlayState(): OverlayState {
  return {
    newsActive: false,
    newsText: "Welcome to the live stream! Stay tuned for more updates.",
    newsTitle: "",
    newsBgColor: "#cc0001",
    newsStyle: "Ticker",
    newsAnimation: "Fade",
    newsPosition: { x: 0, y: 95 },
    adActive: false,
    adText: "Big Sale — 50% Off Today Only!",
    adSub: "Use code LIVE at checkout.",
    adStyle: "Banner",
    adPosition: { x: 0, y: 0 },
    breakActive: false,
    breakText: "Be right back — taking a short break!",
    breakStyle: "Countdown",
    statsActive: true,
    statsPosition: { x: 2, y: 2 },
    subs: null,
    viewers: null,
    subsOverlayActive: false,
    subsStyle: "HUD",
    subsPosition: { x: 72, y: 2 },
    subsGoal: 1000000,
    subChartActive: false,
    subChartData: [],
    subChartPosition: { x: 68, y: 8 },
    mobileSubChartPosition: { x: 5, y: 8 },
    subAlertActive: false,
    subAlertMessage: "",
    chatBurnActive: false,
    chatBurnStyle: "Bubble",
    chatBurnPosition: { x: 2, y: 62 },
    chatBurnMessages: [],
    superChatMessages: [],
    guestNameActive: false,
    guestName: "Guest Name",
    guestTitle: "Title / Channel",
    guestStyle: "Classic",
    guestPosition: { x: 2, y: 78 },
    mobileGuestPosition: { x: 2, y: 78 },
    bgGradientActive: false,
    bgGradient1: "#0f0c29",
    bgGradient2: "#302b63",
    bgGradientOpacity: 1.0,
    mobileStatsPosition: { x: 2, y: 2 },
    mobileSubsPosition: { x: 60, y: 2 },
    mobileChatBurnPosition: { x: 2, y: 55 },
    mobileNewsPosition: { x: 0, y: 92 },
    mobileAdPosition: { x: 0, y: 0 },
    statsScale: 100,
    subsScale: 100,
    chatBurnScale: 100,
    newsScale: 100,
    adScale: 100,
    guestScale: 100,
    subChartScale: 100,
    liveAudioMuted: false,
    featuredComment: null,
    breakVideoMuted: false,
    breakVideoUrl: "",
    breakVideoMode: "live-bg",
    breakVideoPanX: 50,
    breakVideoPanY: 50,
    qrActive: false,
    qrUrl: "",
    qrTitle: "",
    qrSize: 160,
    qrPosition: { x: 88, y: 10 },
    qrScanCount: 0,
    qrThankYouActive: false,
    qrThankYouName: "",
    qrThankYouTs: 0,
    screenShareActive: false,
    screenShareMode: "presenter",
    screenShareX: 60,
    screenShareY: 5,
    screenShareW: 38,
    screenShareRadius: 16,
    donationAlertActive: true,
    donationAlerts: [],
    donationTickerActive: false,
    donationTicker: [],
    giftQueue: [],
    giftDisplayMode: "auto",
  };
}

/**
 * renderMode:
 *   'bg'  — background pipe: only renders the gradient fill (behind video).
 *   'ui'  — UI pipe: all overlays on transparent background.
 */
export type RendererMode = "bg" | "ui";

/** Duration (seconds) for the news text entry animation */
const ANIM_DUR = 0.75;
/** How long a super chat notification is displayed (seconds) */
const SUPERCHAT_TTL = 9;
/** How long the sub alert displays (seconds after activation) */
const SUBALERT_TTL = 5;

export class OverlayRenderer {
  private canvas: ReturnType<typeof createCanvas>;
  private ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>;
  private W: number;
  private H: number;
  private state: OverlayState;
  private readable: Readable;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private t0 = 0;
  private readonly isVertical: boolean;
  private readonly renderMode: RendererMode;

  private readonly FADE_SPEED = 0.18;

  // Per-element fade alphas
  private alphas = {
    news:           0,
    ad:             0,
    break:          0,
    stats:          0,
    subs:           0,
    chatBurn:       0,
    guestName:      0,
    superChat:      0,
    subAlert:       0,
    subChart:       0,
    bgGrad:         0,
    qr:             0,
    featured:       0,
    donationAlert:  0,
    donationTicker: 0,
    giftAlert:      0,
  };

  private donationTickerOffset = 0;
  private donationTickerLastT  = 0;

  // External frame: when set, replaces canvas rendering (used for break video decoder)
  private externalFrame: Buffer | null = null;

  // QR code matrix cache
  private qrMatrix: boolean[][] | null = null;
  private cachedQrUrl = "";

  // Screen share PIP: last decoded JPEG frame
  private screenShareImg: import("@napi-rs/canvas").Image | null = null;
  private screenShareDecoding = false;

  private _panelAlpha = 1;

  // News animation tracking
  private newsAnimStartT = -100; // default → animProg = 1 (no animation on boot)
  private _newsAnimProg = 1;

  // Sub alert tracking (elapsed time since alert became active)
  private subAlertStartT = -100;

  constructor(
    w: number, h: number,
    state: OverlayState,
    isVertical = false,
    renderMode: RendererMode = "ui",
  ) {
    this.W = w;
    this.H = h;
    this.state = { ...state };
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — @napi-rs/canvas types conflate Canvas and SvgCanvas; runtime is correct
    this.canvas = createCanvas(w, h);
    this.ctx = this.canvas.getContext("2d");
    // highWaterMark = 2 raw RGBA frames so the pipe always has a frame queued
    // and FFmpeg never blocks waiting for the next one.
    this.readable = new Readable({ read() {}, highWaterMark: w * h * 4 * 2 });
    this.isVertical = isVertical;
    this.renderMode = renderMode;
  }

  updateState(patch: Partial<OverlayState>) {
    // Restart news animation when text or active state changes
    if (
      (patch.newsText !== undefined && patch.newsText !== this.state.newsText) ||
      (patch.newsActive === true && !this.state.newsActive) ||
      (patch.newsAnimation !== undefined && patch.newsAnimation !== this.state.newsAnimation)
    ) {
      this.newsAnimStartT = this.elapsed();
    }
    // Restart sub alert timer when newly activated
    if (patch.subAlertActive === true && !this.state.subAlertActive) {
      this.subAlertStartT = this.elapsed();
    }
    Object.assign(this.state, patch);
  }

  getStream(): Readable {
    return this.readable;
  }

  /**
   * Legacy start — pushes frames into the internal Readable so callers can
   * pipe() it. Kept for backward compatibility; prefer startWritingTo().
   */
  start(fps = 10) {
    this.running = true;
    this.t0 = Date.now();
    const intervalMs = 1000 / fps;

    const tick = () => {
      if (!this.running) return;
      const tickStart = Date.now();
      try {
        const buf = this.renderFrame();
        if (!this.readable.push(buf)) {
          // Backpressure — wait. Use removeAllListeners so stale listeners
          // never accumulate if tick() is somehow called twice.
          this.readable.removeAllListeners("resume");
          this.readable.once("resume", () => {
            if (this.running) this.timer = setTimeout(tick, intervalMs);
          });
          return;
        }
      } catch {
        // keep going on render errors
      }
      const elapsed = Date.now() - tickStart;
      this.timer = setTimeout(tick, Math.max(0, intervalMs - elapsed));
    };
    tick();
  }

  /**
   * Preferred entry-point for stream-manager: writes raw RGBA frames directly
   * to the FFmpeg pipe fd (dest = ffmpegProc.stdio[3] or [4]).
   *
   * Writing directly to the Writable eliminates the Readable → pipe() layer
   * that caused MaxListenersExceededWarning and stream death:
   *   - No intermediate Readable buffer
   *   - No fallback setTimeout racing against once("resume")
   *   - Single "drain" listener per backpressure event (self-removing via once)
   */
  startWritingTo(dest: NodeJS.WritableStream, fps = 10): void {
    this.running = true;
    this.t0 = Date.now();
    const intervalMs = 1000 / fps;
    // Maximum time to wait for a drain event before giving up and resuming.
    // Without this timeout, a stalled or slow FFmpeg pipe blocks the renderer
    // indefinitely → no new frames → stall watchdog fires → hard kill.
    const drainTimeoutMs = intervalMs * 4;

    const tick = () => {
      if (!this.running) return;
      const tickStart = Date.now();
      try {
        // Use external frame (break video) when available; otherwise render canvas.
        const buf = this.externalFrame !== null ? this.externalFrame : this.renderFrame();
        // write() returns false when the OS pipe buffer to FFmpeg is full (backpressure).
        // We wait for drain but with a hard timeout: if drain hasn't fired within
        // drainTimeoutMs we drop this frame and resume — keeping the stall watchdog fed.
        if (!dest.write(buf)) {
          let drained = false;
          const drainTimeout = setTimeout(() => {
            if (!drained && this.running) {
              dest.removeAllListeners("drain");
              this.timer = setTimeout(tick, intervalMs);
            }
          }, drainTimeoutMs);
          dest.once("drain", () => {
            drained = true;
            clearTimeout(drainTimeout);
            if (this.running) this.timer = setTimeout(tick, intervalMs);
          });
          return;
        }
      } catch {
        // swallow render errors — keep the pipe alive
      }
      const elapsed = Date.now() - tickStart;
      this.timer = setTimeout(tick, Math.max(0, intervalMs - elapsed));
    };
    tick();
  }

  /**
   * Set an external RGBA frame buffer to forward directly to FFmpeg instead of
   * rendering canvas. Used by the break-video decoder to overlay video frames
   * on pipe:4 without restarting the main FFmpeg process.
   * Pass null to resume normal canvas rendering.
   */
  setExternalFrame(frame: Buffer | null): void {
    this.externalFrame = frame;
  }

  /**
   * Accept a JPEG buffer from the browser screen-share WebSocket and decode it
   * asynchronously. The most recently decoded Image is composited by renderFrame()
   * as a PIP overlay when state.screenShareActive is true.
   */
  setScreenShareFrame(jpegBuf: Buffer): void {
    if (this.screenShareDecoding) return; // skip if still decoding previous frame
    this.screenShareDecoding = true;
    // loadImage is imported from @napi-rs/canvas at module top
    (loadImage as (src: Buffer) => Promise<import("@napi-rs/canvas").Image>)(jpegBuf)
      .then((img) => { this.screenShareImg = img; })
      .catch(() => {})
      .finally(() => { this.screenShareDecoding = false; });
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    try { this.readable.destroy(); } catch {}
  }

  private elapsed(): number {
    return (Date.now() - this.t0) / 1000;
  }

  private px(pct: number, dim: number): number {
    return Math.round((pct / 100) * dim);
  }

  private pos(desktopPos: OverlayPosition, mobilePos: OverlayPosition): OverlayPosition {
    return this.isVertical ? mobilePos : desktopPos;
  }

  private stepAlpha(cur: number, target: number): number {
    if (cur < target) return Math.min(target, cur + this.FADE_SPEED);
    if (cur > target) return Math.max(0, cur - this.FADE_SPEED);
    return cur;
  }

  private withPanelAlpha(alpha: number, fn: () => void): void {
    if (alpha < 0.01) return;
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    this._panelAlpha = alpha;
    fn();
    ctx.restore();
    this._panelAlpha = 1;
  }

  private withScaleAt(pos: OverlayPosition, mobilePos: OverlayPosition, scalePct: number, fn: () => void): void {
    if (!scalePct || scalePct === 100) { fn(); return; }
    const { ctx, W, H } = this;
    const effPos = this.pos(pos, mobilePos);
    const ax = this.px(effPos.x, W);
    const ay = this.px(effPos.y, H);
    const s = scalePct / 100;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.scale(s, s);
    ctx.translate(-ax, -ay);
    fn();
    ctx.restore();
  }

  // ── Easing helpers ─────────────────────────────────────────────────────────

  private easeInOut(t: number): number {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  private easeElastic(t: number): number {
    if (t === 0) return 0;
    if (t === 1) return 1;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI) / 3) + 1;
  }

  private easeBounce(t: number): number {
    if (t < 1 / 2.75) return 7.5625 * t * t;
    if (t < 2 / 2.75) { t -= 1.5 / 2.75; return 7.5625 * t * t + 0.75; }
    if (t < 2.5 / 2.75) { t -= 2.25 / 2.75; return 7.5625 * t * t + 0.9375; }
    t -= 2.625 / 2.75;
    return 7.5625 * t * t + 0.984375;
  }

  // ── Animated text helper ──────────────────────────────────────────────────

  /**
   * Draws text with a character-level entry animation.
   * For whole-overlay animations (Fade, Slide etc.) the caller handles the ctx transform.
   * This method handles: Typewriter, Pop-in, Letter Fade, Bounce, Reveal.
   * For other animations or progress >= 1, draws normally.
   */
  private drawAnimText(
    text: string, x: number, y: number,
    font: string, color: string,
    anim: string, progress: number,
  ) {
    const { ctx } = this;
    const CHAR_ANIMS = ["Typewriter", "Pop-in", "Letter Fade", "Bounce", "Reveal"];

    if (!CHAR_ANIMS.includes(anim) || progress >= 1) {
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      return;
    }

    ctx.font = font;

    if (anim === "Typewriter") {
      const vis = Math.floor(this.easeInOut(progress) * text.length);
      ctx.fillStyle = color;
      ctx.fillText(text.slice(0, vis), x, y);
      // blinking cursor
      const cursorX = x + ctx.measureText(text.slice(0, vis)).width + 2;
      const blink = (Math.floor(Date.now() / 400) % 2 === 0) ? 0.9 : 0;
      const fs = parseFloat(font) || 14;
      ctx.save();
      ctx.globalAlpha = blink * this._panelAlpha;
      ctx.fillStyle = color;
      ctx.fillRect(cursorX, y - fs * 0.8, 2, fs);
      ctx.restore();
      return;
    }

    if (anim === "Reveal") {
      const totalW = ctx.measureText(text).width;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y - 200, totalW * this.easeInOut(progress) + 1, 400);
      ctx.clip();
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
      ctx.restore();
      return;
    }

    // Pop-in, Letter Fade, Bounce — char-by-char with stagger
    const chars = text.split("");
    let cx = x;

    chars.forEach((ch, i) => {
      ctx.font = font;
      const cw = ctx.measureText(ch).width;
      const t_char = Math.max(0, Math.min(1, (progress * chars.length - i)));

      ctx.save();
      switch (anim) {
        case "Pop-in": {
          const scale = this.easeElastic(t_char);
          ctx.translate(cx + cw / 2, y);
          ctx.scale(scale, scale);
          ctx.globalAlpha = t_char > 0.05 ? this._panelAlpha : 0;
          ctx.fillStyle = color;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(ch, 0, 0);
          break;
        }
        case "Letter Fade": {
          ctx.globalAlpha = this.easeInOut(t_char) * this._panelAlpha;
          ctx.fillStyle = color;
          ctx.fillText(ch, cx, y);
          break;
        }
        case "Bounce": {
          const yOff = (1 - this.easeBounce(Math.min(1, t_char))) * (-32);
          ctx.globalAlpha = t_char > 0.05 ? this._panelAlpha : 0;
          ctx.fillStyle = color;
          ctx.fillText(ch, cx, y + yOff);
          break;
        }
      }
      ctx.restore();
      cx += cw;
    });
  }

  // ── Main render frame ──────────────────────────────────────────────────────

  private renderFrame(): Buffer {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    // ── BACKGROUND PIPE ──
    if (this.renderMode === "bg") {
      if (this.state.breakActive) {
        const mode = this.state.breakVideoMode ?? "live-bg";
        if (mode === "fullscreen") {
          this.ctx.fillStyle = "#000";
          this.ctx.fillRect(0, 0, this.W, this.H);
          return this.toRawRGBA();
        }
        if (mode === "gradient-bg") {
          this.withPanelAlpha(1, () => this.drawBackground());
          return this.toRawRGBA();
        }
        // "live-bg": transparent — live stream visible in letterbox bars
        return this.toRawRGBA();
      }
      const target = this.state.bgGradientActive ? (this.state.bgGradientOpacity ?? 1) : 0;
      this.alphas.bgGrad = this.stepAlpha(this.alphas.bgGrad, target);
      this.withPanelAlpha(this.alphas.bgGrad, () => this.drawBackground());
      return this.toRawRGBA();
    }

    // ── UI PIPE ──
    const t = this.elapsed();
    const wantBreak = this.state.breakActive ? 1 : 0;
    const nonBreak = 1 - this.alphas.break;

    // Determine if sub alert should fade out after TTL
    const subAlertAge = t - this.subAlertStartT;
    const subAlertWant = this.state.subAlertActive && subAlertAge < SUBALERT_TTL ? 1 : 0;
    // Auto-clear if TTL passed
    if (this.state.subAlertActive && subAlertAge >= SUBALERT_TTL + 0.5) {
      this.state.subAlertActive = false;
    }

    // Active super chat: most recent within TTL
    const now = Date.now();
    const activeSuperChat = [...this.state.superChatMessages]
      .filter((m) => (now - m.ts) / 1000 < SUPERCHAT_TTL)
      .sort((a, b) => b.ts - a.ts)[0] ?? null;

    this.alphas.news      = this.stepAlpha(this.alphas.news,      this.state.newsActive && !this.state.breakActive ? 1 : 0);
    this.alphas.ad        = this.stepAlpha(this.alphas.ad,        this.state.adActive && !this.state.breakActive ? 1 : 0);
    this.alphas.subs      = this.stepAlpha(this.alphas.subs,      this.state.subsOverlayActive && !!this.state.subs && !this.state.breakActive ? 1 : 0);
    this.alphas.chatBurn  = this.stepAlpha(this.alphas.chatBurn,  this.state.chatBurnActive && this.state.chatBurnMessages.length > 0 && !this.state.breakActive ? 1 : 0);
    this.alphas.stats     = this.stepAlpha(this.alphas.stats,     !!(this.state.subs || this.state.viewers) && this.state.statsActive && !this.state.breakActive ? 1 : 0);
    this.alphas.guestName = this.stepAlpha(this.alphas.guestName, this.state.guestNameActive && !this.state.breakActive ? 1 : 0);
    this.alphas.superChat = this.stepAlpha(this.alphas.superChat, activeSuperChat ? 1 : 0);
    this.alphas.subAlert  = this.stepAlpha(this.alphas.subAlert,  subAlertWant);
    this.alphas.subChart  = this.stepAlpha(this.alphas.subChart,  this.state.subChartActive && this.state.subChartData.length >= 2 && !!this.state.subs && !this.state.breakActive ? 1 : 0);
    this.alphas.break     = this.stepAlpha(this.alphas.break,     wantBreak);
    this.alphas.qr        = this.stepAlpha(this.alphas.qr,        this.state.qrActive && !!this.state.qrUrl ? 1 : 0);
    // Gift economy system + legacy donation alerts
    const now2 = Date.now();
    const activeGift = (this.state.giftQueue ?? []).find(
      (g) => now2 >= g.displayTs && now2 < g.displayTs + g.gift.durationMs,
    ) ?? null;
    const DONATION_ALERT_TTL_MS = 8_000;
    const activeDonationAlert = activeGift ? null : (this.state.donationAlerts ?? [])
      .filter((a) => (now2 - a.ts) < DONATION_ALERT_TTL_MS)
      .sort((a, b) => b.ts - a.ts)[0] ?? null;
    this.alphas.giftAlert      = this.stepAlpha(this.alphas.giftAlert,      !!(this.state.donationAlertActive && activeGift) ? 1 : 0);
    this.alphas.donationAlert  = this.stepAlpha(this.alphas.donationAlert,  !!(this.state.donationAlertActive && activeDonationAlert) ? 1 : 0);
    this.alphas.donationTicker = this.stepAlpha(this.alphas.donationTicker, !!(this.state.donationTickerActive && this.state.donationTicker && this.state.donationTicker.length > 0) ? 1 : 0);
    const FEATURED_TTL_MS = 12_000;
    const featuredAge = this.state.featuredComment ? now - this.state.featuredComment.ts : Infinity;
    this.alphas.featured  = this.stepAlpha(this.alphas.featured,  this.state.featuredComment !== null && featuredAge < FEATURED_TTL_MS && !this.state.breakActive ? 1 : 0);
    if (this.state.featuredComment && featuredAge > FEATURED_TTL_MS + 500) {
      this.state.featuredComment = null;
    }

    const { state } = this;
    this.withPanelAlpha(this.alphas.ad        * nonBreak, () => this.withScaleAt(state.adPosition, state.mobileAdPosition, state.adScale ?? 100, () => this.drawAd()));
    this.withPanelAlpha(this.alphas.news      * nonBreak, () => this.withScaleAt(state.newsPosition, state.mobileNewsPosition, state.newsScale ?? 100, () => this.drawNews(t)));
    this.withPanelAlpha(this.alphas.subs      * nonBreak, () => this.withScaleAt(state.subsPosition, state.mobileSubsPosition, state.subsScale ?? 100, () => this.drawSubsOverlay(t)));
    this.withPanelAlpha(this.alphas.chatBurn  * nonBreak, () => this.withScaleAt(state.chatBurnPosition, state.mobileChatBurnPosition, state.chatBurnScale ?? 100, () => this.drawChatBurn(t)));
    this.withPanelAlpha(this.alphas.stats     * nonBreak, () => this.withScaleAt(state.statsPosition, state.mobileStatsPosition, state.statsScale ?? 100, () => this.drawStats()));
    this.withPanelAlpha(this.alphas.subChart  * nonBreak, () => this.withScaleAt(state.subChartPosition, state.mobileSubChartPosition, state.subChartScale ?? 100, () => this.drawSubChart()));
    this.withPanelAlpha(this.alphas.guestName * nonBreak, () => this.withScaleAt(state.guestPosition, state.mobileGuestPosition, state.guestScale ?? 100, () => this.drawGuestNameTag()));
    this.withPanelAlpha(this.alphas.superChat,            () => this.drawSuperChatNotification(activeSuperChat!, t));
    this.withPanelAlpha(this.alphas.subAlert,             () => this.drawSubAlert(t));
    this.withPanelAlpha(this.alphas.break,                () => this.drawBreak(t));
    this.withPanelAlpha(this.alphas.qr,                   () => this.drawQR());
    this.withPanelAlpha(this.alphas.featured * nonBreak,  () => this.drawFeaturedComment());
    this.withPanelAlpha(this.alphas.giftAlert,                 () => { if (activeGift) this.drawGiftAlert(activeGift); });
    this.withPanelAlpha(this.alphas.donationAlert,             () => { if (activeDonationAlert) this.drawDonationAlert(activeDonationAlert, t); });
    this.withPanelAlpha(this.alphas.donationTicker * nonBreak, () => this.drawDonationTicker(t));

    // ── Screen share overlay (PIP / Presenter / Fullscreen) ──────────────────
    if (state.screenShareActive && this.screenShareImg) {
      const img = this.screenShareImg;
      const { ctx } = this;
      const mode = state.screenShareMode ?? "pip";

      if (mode === "fullscreen") {
        // ── Fullscreen: scale-to-fill entire canvas (cover), centred crop ────
        const scale = Math.max(W / img.width, H / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        const dx = (W - dw) / 2;
        const dy = (H - dh) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, H);
        ctx.clip();
        // @ts-ignore
        ctx.drawImage(img, dx, dy, dw, dh);
        ctx.restore();

      } else if (mode === "presenter") {
        // ── Presenter: professional dark background + centred large screen ────
        ctx.save();

        // 1. Deep studio background gradient (charcoal → navy)
        const bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, "rgba(10,12,24,0.96)");
        bg.addColorStop(1, "rgba(14,18,38,0.96)");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);

        // 2. Subtle dot-grid pattern for depth
        const dot = 2;
        const gap = 28;
        ctx.fillStyle = "rgba(255,255,255,0.045)";
        for (let gx = gap / 2; gx < W; gx += gap) {
          for (let gy = gap / 2; gy < H; gy += gap) {
            ctx.beginPath();
            ctx.arc(gx, gy, dot / 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // 3. Accent glow orbs (top-left purple, bottom-right cyan)
        const orb1 = ctx.createRadialGradient(W * 0.1, H * 0.1, 0, W * 0.1, H * 0.1, W * 0.42);
        orb1.addColorStop(0, "rgba(99,102,241,0.28)");
        orb1.addColorStop(1, "rgba(99,102,241,0)");
        ctx.fillStyle = orb1;
        ctx.fillRect(0, 0, W, H);

        const orb2 = ctx.createRadialGradient(W * 0.9, H * 0.9, 0, W * 0.9, H * 0.9, W * 0.45);
        orb2.addColorStop(0, "rgba(6,182,212,0.22)");
        orb2.addColorStop(1, "rgba(6,182,212,0)");
        ctx.fillStyle = orb2;
        ctx.fillRect(0, 0, W, H);

        // 4. Screen area — 88% width, centred, maintain aspect ratio
        const maxW = Math.round(W * 0.88);
        const maxH = Math.round(H * 0.82);
        const scaleF = Math.min(maxW / img.width, maxH / img.height);
        const sw = Math.round(img.width * scaleF);
        const sh = Math.round(img.height * scaleF);
        const sx = Math.round((W - sw) / 2);
        const sy = Math.round((H - sh) / 2);
        const r = state.screenShareRadius ?? 12;

        // 4a. Shadow behind screen
        ctx.shadowColor = "rgba(0,0,0,0.75)";
        ctx.shadowBlur = 40;
        ctx.shadowOffsetY = 12;
        ctx.fillStyle = "#000";
        ctx.beginPath();
        ctx.moveTo(sx + r, sy);
        ctx.lineTo(sx + sw - r, sy);
        ctx.arcTo(sx + sw, sy,      sx + sw, sy + r,      r);
        ctx.lineTo(sx + sw, sy + sh - r);
        ctx.arcTo(sx + sw, sy + sh, sx + sw - r, sy + sh, r);
        ctx.lineTo(sx + r,  sy + sh);
        ctx.arcTo(sx,       sy + sh, sx,       sy + sh - r, r);
        ctx.lineTo(sx,      sy + r);
        ctx.arcTo(sx,       sy,      sx + r,   sy,           r);
        ctx.closePath();
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        // 4b. Clip & draw screen
        ctx.beginPath();
        ctx.moveTo(sx + r, sy);
        ctx.lineTo(sx + sw - r, sy);
        ctx.arcTo(sx + sw, sy,      sx + sw, sy + r,      r);
        ctx.lineTo(sx + sw, sy + sh - r);
        ctx.arcTo(sx + sw, sy + sh, sx + sw - r, sy + sh, r);
        ctx.lineTo(sx + r,  sy + sh);
        ctx.arcTo(sx,       sy + sh, sx,       sy + sh - r, r);
        ctx.lineTo(sx,      sy + r);
        ctx.arcTo(sx,       sy,      sx + r,   sy,           r);
        ctx.closePath();
        ctx.clip();
        // @ts-ignore
        ctx.drawImage(img, sx, sy, sw, sh);

        // 4c. Inner highlight border (glass edge)
        ctx.strokeStyle = "rgba(255,255,255,0.14)";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.restore();

        // 4d. Outer accent glow ring (drawn outside clip)
        ctx.save();
        ctx.strokeStyle = "rgba(99,102,241,0.5)";
        ctx.lineWidth = 2;
        ctx.shadowColor = "rgba(99,102,241,0.6)";
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.moveTo(sx + r, sy);
        ctx.lineTo(sx + sw - r, sy);
        ctx.arcTo(sx + sw, sy,      sx + sw, sy + r,      r);
        ctx.lineTo(sx + sw, sy + sh - r);
        ctx.arcTo(sx + sw, sy + sh, sx + sw - r, sy + sh, r);
        ctx.lineTo(sx + r,  sy + sh);
        ctx.arcTo(sx,       sy + sh, sx,       sy + sh - r, r);
        ctx.lineTo(sx,      sy + r);
        ctx.arcTo(sx,       sy,      sx + r,   sy,           r);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();

      } else {
        // ── PIP: original small positioned overlay ────────────────────────────
        const x = this.px(state.screenShareX, W);
        const y = this.px(state.screenShareY, H);
        const w = this.px(state.screenShareW, W);
        const h = Math.round(w * (img.height / img.width));
        const r = Math.max(0, Math.min(state.screenShareRadius ?? 16, Math.min(w, h) / 2));
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y,     x + w, y + r,     r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x,      y + h, x,      y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y,         x + r,  y,          r);
        ctx.closePath();
        ctx.clip();
        // @ts-ignore
        ctx.drawImage(img, x, y, w, h);
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }
    }

    return this.toRawRGBA();
  }

  // ── Raw RGBA export ─────────────────────────────────────────────────────────
  // Returns uncompressed RGBA pixel data (~0.3ms) instead of PNG (~30-80ms).
  // This eliminates the frame-pipe stall that was the root cause of sub-cuts:
  // PNG Deflate compression is variable-time and made the pipe run dry every
  // few frames, blocking FFmpeg's filter_complex and causing video PTS drift.
  private toRawRGBA(): Buffer {
    const imageData = this.ctx.getImageData(0, 0, this.W, this.H);
    // imageData.data is Uint8ClampedArray of RGBA pixels (W*H*4 bytes).
    // Buffer.from(ArrayBuffer, offset, length) creates a Buffer that shares
    // the same memory — no copy, true zero overhead.
    return Buffer.from(
      imageData.data.buffer,
      imageData.data.byteOffset,
      imageData.data.byteLength,
    );
  }

  // ── BACKGROUND GRADIENT ─────────────────────────────────────────────────────

  private drawBackground() {
    const { ctx, W, H, state } = this;

    const hexToRgb = (hex: string): [number, number, number] => {
      const h = (hex.startsWith("#") ? hex.slice(1) : hex).padEnd(6, "0");
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    };

    const c1 = state.bgGradient1 || "#6d28d9";
    const c2 = state.bgGradient2 || "#0891b2";
    const [r1, g1, b1] = hexToRgb(c1);
    const [r2, g2, b2] = hexToRgb(c2);
    // Accent: midpoint blend of the two colours
    const rA = Math.round((r1 + r2) / 2);
    const gA = Math.round((g1 + g2) / 2);
    const bA = Math.round((b1 + b2) / 2);

    // No opaque base fill — gradient is composited ON TOP of the live video
    // as a semi-transparent atmosphere layer.  Blobs fade from the centre
    // outward so the video content remains legible underneath.

    // ── Primary colour blob — top-left (matches purple glow drawbox + gblur) ─
    const grad1 = ctx.createRadialGradient(
      W * 0.18, H * 0.18, 0,
      W * 0.18, H * 0.18, W * 0.55,
    );
    grad1.addColorStop(0, `rgba(${r1},${g1},${b1},0.72)`);
    grad1.addColorStop(0.45, `rgba(${r1},${g1},${b1},0.38)`);
    grad1.addColorStop(1, `rgba(${r1},${g1},${b1},0)`);
    ctx.fillStyle = grad1;
    ctx.fillRect(0, 0, W, H);

    // ── Secondary colour blob — bottom-right (matches cyan glow drawbox) ────
    const grad2 = ctx.createRadialGradient(
      W * 0.82, H * 0.82, 0,
      W * 0.82, H * 0.82, W * 0.6,
    );
    grad2.addColorStop(0, `rgba(${r2},${g2},${b2},0.6)`);
    grad2.addColorStop(0.45, `rgba(${r2},${g2},${b2},0.28)`);
    grad2.addColorStop(1, `rgba(${r2},${g2},${b2},0)`);
    ctx.fillStyle = grad2;
    ctx.fillRect(0, 0, W, H);

    // ── Accent blob — centre (matches magenta centre drawbox) ───────────────
    const grad3 = ctx.createRadialGradient(
      W * 0.5, H * 0.5, 0,
      W * 0.5, H * 0.5, W * 0.38,
    );
    grad3.addColorStop(0, `rgba(${rA},${gA},${bA},0.32)`);
    grad3.addColorStop(0.5, `rgba(${rA},${gA},${bA},0.14)`);
    grad3.addColorStop(1, `rgba(${rA},${gA},${bA},0)`);
    ctx.fillStyle = grad3;
    ctx.fillRect(0, 0, W, H);
  }

  // ── STATS BAR ──────────────────────────────────────────────────────────────

  private drawStats() {
    const { ctx, W, H, state } = this;
    if (!state.subs && !state.viewers) return;

    const effPos = this.pos(state.statsPosition, state.mobileStatsPosition);
    const x = this.px(effPos.x, W) || 14;
    const y = this.px(effPos.y, H) || 14;
    const bh = Math.max(22, Math.round(H * 0.038));
    const liveWFrac = this.isVertical ? 0.13 : 0.085;
    const statWFrac = this.isVertical ? 0.16 : 0.115;
    let cx = x;

    const liveW = Math.round(W * liveWFrac);
    ctx.fillStyle = "rgba(0,0,0,0.82)";
    ctx.fillRect(cx, y, liveW, bh);
    ctx.fillStyle = "#e53e3e";
    ctx.beginPath();
    ctx.arc(cx + bh * 0.42, y + bh / 2, bh * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(bh * 0.5)}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("LIVE", cx + bh * 0.82, y + bh / 2);
    cx += liveW + 4;

    const statBadge = (val: string, label: string, color: string) => {
      const bw = Math.round(W * statWFrac);
      ctx.fillStyle = "rgba(0,0,0,0.82)";
      ctx.fillRect(cx, y, bw, bh);
      ctx.fillStyle = color;
      ctx.font = `bold ${Math.round(bh * 0.52)}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(val, cx + 6, y + bh / 2);
      const tw = ctx.measureText(val).width + 10;
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = `${Math.round(bh * 0.38)}px sans-serif`;
      ctx.fillText(label, cx + 6 + tw, y + bh / 2);
      cx += bw + 4;
    };

    if (state.subs) statBadge(state.subs, "subs", "#a78bfa");
    if (state.viewers) statBadge(state.viewers, "viewers", "#34d399");
  }

  // ── SUBSCRIBER COUNT OVERLAY ───────────────────────────────────────────────

  // ── Rounded-rect primitives ────────────────────────────────────────────────
  /** Fill a rounded rectangle with the current fillStyle. */
  private fillRR(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fill();
  }
  /** Stroke a rounded rectangle with the current strokeStyle. */
  private strokeRR(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.stroke();
  }
  /** Clip to a rounded rectangle — caller must ctx.save() before and ctx.restore() after. */
  private clipRR(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.clip();
  }
  // ── END rounded-rect primitives ────────────────────────────────────────────

  private drawSubsOverlay(t: number) {
    switch (this.state.subsStyle) {
      case "Minimal":  return this.drawMinimalCounter();
      case "Animated": return this.drawAnimatedCounter(t);
      case "Card":     return this.drawCardBadge();
      case "Goal":     return this.drawGoalBar();
      case "HUD":
      default:         return this.drawHUDCounter();
    }
  }

  private drawMinimalCounter() {
    const { ctx, W, H, state } = this;
    const effPos = this.pos(state.subsPosition, state.mobileSubsPosition);
    const x = this.px(effPos.x, W);
    const y = this.px(effPos.y, H);
    const fs = Math.round(Math.min(W, H) * (this.isVertical ? 0.07 : 0.055));
    const labelFs = Math.round(fs * 0.33);
    // Measure for pill sizing
    ctx.font = `bold ${fs}px sans-serif`;
    const numW = ctx.measureText(state.subs!).width;
    ctx.font = `bold ${labelFs}px sans-serif`;
    const lblW = ctx.measureText("SUBSCRIBERS").width;
    const padX = Math.round(fs * 0.4);
    const padY = Math.round(fs * 0.22);
    const pillW = Math.max(numW, lblW) + padX * 2;
    const pillH = fs + labelFs + Math.round(fs * 0.45) + padY * 2;
    const radius = Math.round(pillH * 0.16);
    // Frosted dark pill background
    ctx.fillStyle = "rgba(6,8,20,0.82)";
    this.fillRR(x - padX, y - padY, pillW, pillH, radius);
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = 1;
    this.strokeRR(x - padX, y - padY, pillW, pillH, radius);
    // Subscriber count
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.fillText(state.subs!, x, y);
    // Label
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = `bold ${labelFs}px sans-serif`;
    ctx.fillText("SUBSCRIBERS", x, y + fs + Math.round(fs * 0.14));
    ctx.textBaseline = "alphabetic";
  }

  private drawAnimatedCounter(t: number) {
    const { ctx, W, H, state } = this;
    const effPos = this.pos(state.subsPosition, state.mobileSubsPosition);
    const x = this.px(effPos.x, W);
    const y = this.px(effPos.y, H);
    const bw = Math.round(W * (this.isVertical ? 0.42 : 0.22));
    const bh = Math.round(H * (this.isVertical ? 0.1 : 0.1));
    const radius = Math.round(bh * 0.22);
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.2);
    // Rounded dark card background
    const bgGrad = ctx.createLinearGradient(x, y, x, y + bh);
    bgGrad.addColorStop(0, "rgba(14,14,22,0.97)");
    bgGrad.addColorStop(1, "rgba(8,8,14,0.95)");
    ctx.fillStyle = bgGrad;
    this.fillRR(x, y, bw, bh, radius);
    // Pulsing colored border
    ctx.strokeStyle = `rgba(204,0,1,${0.28 + pulse * 0.42})`;
    ctx.lineWidth = 2;
    this.strokeRR(x, y, bw, bh, radius);
    // Top accent stripe (clipped to card shape)
    ctx.save();
    this.clipRR(x, y, bw, bh, radius);
    const topGrad = ctx.createLinearGradient(x, y, x + bw, y);
    topGrad.addColorStop(0, `rgba(204,0,1,${0.75 + pulse * 0.25})`);
    topGrad.addColorStop(1, `rgba(160,0,0,${0.55 + pulse * 0.2})`);
    ctx.fillStyle = topGrad;
    ctx.fillRect(x, y, bw, 4);
    ctx.restore();
    // Subscriber count with soft white glow on pulse
    const fs = Math.round(bh * 0.42);
    ctx.shadowColor = `rgba(255,255,255,${pulse * 0.12})`;
    ctx.shadowBlur = pulse * 7;
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.subs!, x + bw / 2, y + bh * 0.44);
    ctx.shadowBlur = 0;
    // Pulsing red dot + SUBSCRIBERS label
    const labelFs = Math.round(bh * 0.2);
    ctx.font = `bold ${labelFs}px sans-serif`;
    const labelW = ctx.measureText("SUBSCRIBERS").width;
    const dotR = Math.round(labelFs * 0.38);
    const totalW = dotR * 2 + 6 + labelW;
    const lx = x + bw / 2 - totalW / 2;
    const ly = y + bh * 0.8;
    ctx.fillStyle = `rgba(204,0,1,${0.75 + pulse * 0.25})`;
    ctx.beginPath();
    ctx.arc(lx + dotR, ly, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("SUBSCRIBERS", lx + dotR * 2 + 6, ly);
    ctx.textBaseline = "alphabetic";
  }

  private drawCardBadge() {
    const { ctx, W, H, state } = this;
    const effPos = this.pos(state.subsPosition, state.mobileSubsPosition);
    const x = this.px(effPos.x, W);
    const y = this.px(effPos.y, H);
    const bw = Math.round(W * (this.isVertical ? 0.52 : 0.28));
    const bh = Math.round(H * (this.isVertical ? 0.1 : 0.11));
    const pad = Math.round(bh * 0.15);
    const iconD = Math.round(bh * 0.62);
    const radius = Math.round(bh * 0.22);
    // Rounded dark card with gradient
    const bgGrad = ctx.createLinearGradient(x, y, x, y + bh);
    bgGrad.addColorStop(0, "rgba(14,14,22,0.97)");
    bgGrad.addColorStop(1, "rgba(8,8,14,0.95)");
    ctx.fillStyle = bgGrad;
    this.fillRR(x, y, bw, bh, radius);
    // Card border
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    this.strokeRR(x, y, bw, bh, radius);
    // Bottom accent gradient stripe (clipped to card)
    ctx.save();
    this.clipRR(x, y, bw, bh, radius);
    const bottomGrad = ctx.createLinearGradient(x, y, x + bw, y);
    bottomGrad.addColorStop(0, "rgba(204,0,1,0.9)");
    bottomGrad.addColorStop(1, "rgba(150,0,0,0.5)");
    ctx.fillStyle = bottomGrad;
    ctx.fillRect(x, y + bh - 3, bw, 3);
    ctx.restore();
    // Red circular play-button icon with glow
    const cx2 = x + pad + iconD / 2;
    const cy2 = y + bh / 2;
    ctx.fillStyle = "#cc0001";
    ctx.beginPath();
    ctx.arc(cx2, cy2, iconD / 2, 0, Math.PI * 2);
    ctx.fill();
    // Subtle inner shine on icon
    const iconShine = ctx.createRadialGradient(cx2 - iconD * 0.15, cy2 - iconD * 0.18, 0, cx2, cy2, iconD / 2);
    iconShine.addColorStop(0, "rgba(255,255,255,0.18)");
    iconShine.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = iconShine;
    ctx.beginPath();
    ctx.arc(cx2, cy2, iconD / 2, 0, Math.PI * 2);
    ctx.fill();
    // Triangle play mark
    const tw = Math.round(iconD * 0.38);
    const th = Math.round(iconD * 0.44);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(cx2 - tw * 0.35 + 2, cy2 - th / 2);
    ctx.lineTo(cx2 - tw * 0.35 + 2 + tw, cy2);
    ctx.lineTo(cx2 - tw * 0.35 + 2, cy2 + th / 2);
    ctx.closePath();
    ctx.fill();
    // Text area
    const tx = x + pad + iconD + Math.round(bh * 0.12);
    const labelFs = Math.round(bh * 0.2);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = `bold ${labelFs}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("SUBSCRIBERS", tx, y + bh * 0.13);
    const numFs = Math.round(bh * 0.42);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${numFs}px sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(state.subs!, tx, y + bh * 0.62);
    ctx.textBaseline = "alphabetic";
  }

  private drawHUDCounter() {
    const { ctx, W, H, state } = this;
    const effPos = this.pos(state.subsPosition, state.mobileSubsPosition);
    const x = this.px(effPos.x, W);
    const y = this.px(effPos.y, H);
    const bh = Math.max(24, Math.round(H * (this.isVertical ? 0.045 : 0.038)));
    const radius = Math.round(bh / 2); // Full pill shape
    const numFs = Math.round(bh * 0.46);
    const labelFs = Math.round(bh * 0.27);
    ctx.font = `bold ${numFs}px sans-serif`;
    const numW = ctx.measureText(state.subs!).width;
    ctx.font = `bold ${labelFs}px sans-serif`;
    const labelW = ctx.measureText("SUBS").width;
    const innerPad = Math.round(bh * 0.55);
    const dividerX = numW + innerPad * 1.8; // where red section ends
    const bw = dividerX + labelW + innerPad;
    // Pill background (dark right section)
    ctx.fillStyle = "rgba(8,8,14,0.93)";
    this.fillRR(x, y, bw, bh, radius);
    // Left red section (clipped to pill)
    ctx.save();
    this.clipRR(x, y, bw, bh, radius);
    const redGrad = ctx.createLinearGradient(x, y, x + dividerX, y);
    redGrad.addColorStop(0, "rgba(200,0,0,0.92)");
    redGrad.addColorStop(1, "rgba(160,0,0,0.78)");
    ctx.fillStyle = redGrad;
    ctx.fillRect(x, y, dividerX, bh);
    // Thin vertical divider
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(x + dividerX, y + bh * 0.18, 1, bh * 0.64);
    ctx.restore();
    // Pill border
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    this.strokeRR(x, y, bw, bh, radius);
    // Count (in red section)
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${numFs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.subs!, x + dividerX / 2, y + bh / 2);
    // "SUBS" label (in dark section)
    ctx.fillStyle = "rgba(255,255,255,0.52)";
    ctx.font = `bold ${labelFs}px sans-serif`;
    ctx.fillText("SUBS", x + dividerX + (bw - dividerX) / 2, y + bh / 2);
    ctx.textBaseline = "alphabetic";
  }

  private drawGoalBar() {
    const { ctx, W, H, state } = this;
    const effPos = this.pos(state.subsPosition, state.mobileSubsPosition);
    const x = this.px(effPos.x, W);
    const y = this.px(effPos.y, H);
    const bw = Math.round(W * (this.isVertical ? 0.55 : 0.3));
    const bh = Math.round(H * (this.isVertical ? 0.085 : 0.075));
    const rawSubs = state.subs || "0";
    let currentNum = parseFloat(rawSubs);
    if (rawSubs.endsWith("M")) currentNum *= 1_000_000;
    else if (rawSubs.endsWith("K")) currentNum *= 1_000;
    const progress = Math.min(1, currentNum / Math.max(1, state.subsGoal));
    const pct = Math.round(progress * 100);
    const goalFmt = this.formatGoal(state.subsGoal);
    const pad = Math.round(bh * 0.18);
    const radius = Math.round(bh * 0.22);
    // Rounded dark card with gradient background
    const bgGrad = ctx.createLinearGradient(x, y, x, y + bh);
    bgGrad.addColorStop(0, "rgba(14,14,22,0.97)");
    bgGrad.addColorStop(1, "rgba(8,8,14,0.95)");
    ctx.fillStyle = bgGrad;
    this.fillRR(x, y, bw, bh, radius);
    // Card border
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    this.strokeRR(x, y, bw, bh, radius);
    // Top accent stripe (clipped to rounded card)
    ctx.save();
    this.clipRR(x, y, bw, bh, radius);
    const topGrad = ctx.createLinearGradient(x, y, x + bw, y);
    topGrad.addColorStop(0, "rgba(204,0,1,0.92)");
    topGrad.addColorStop(1, "rgba(150,0,0,0.55)");
    ctx.fillStyle = topGrad;
    ctx.fillRect(x, y, bw, 3);
    ctx.restore();
    // Top row: count + goal + percentage
    const fs = Math.round(bh * 0.3);
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#fff";
    ctx.fillText(rawSubs, x + pad, y + bh * 0.1);
    const numW = ctx.measureText(rawSubs).width;
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = `${Math.round(fs * 0.78)}px sans-serif`;
    ctx.fillText(` / ${goalFmt} goal`, x + pad + numW, y + bh * 0.13);
    ctx.fillStyle = "#ff4444";
    ctx.font = `bold ${Math.round(fs * 0.75)}px sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(`${pct}%`, x + bw - pad, y + bh * 0.1);
    // Progress bar — rounded track + rounded fill
    const barY = Math.round(y + bh * 0.58);
    const barH = Math.max(4, Math.round(bh * 0.18));
    const barX = x + pad;
    const barW = bw - pad * 2;
    const barR = Math.round(barH / 2);
    // Track (rounded pill)
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    this.fillRR(barX, barY, barW, barH, barR);
    // Fill (gradient rounded pill)
    if (progress > 0) {
      const fillW = Math.max(barH, Math.round(barW * progress));
      const fg = ctx.createLinearGradient(barX, barY, barX + fillW, barY);
      fg.addColorStop(0, "#cc0001");
      fg.addColorStop(1, "#ff4444");
      ctx.fillStyle = fg;
      this.fillRR(barX, barY, fillW, barH, barR);
    }
    // SUBSCRIBERS label
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = `bold ${Math.round(fs * 0.62)}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("SUBSCRIBERS", x + pad, y + bh - Math.round(bh * 0.06));
    ctx.textBaseline = "alphabetic";
  }

  private formatGoal(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1)}K`;
    return String(n);
  }

  // ── SUB CHART (sparkline) ──────────────────────────────────────────────────

  private drawSubChart() {
    const { ctx, W, H, state } = this;
    const data = state.subChartData;
    if (data.length < 2) return;

    const effPos = this.pos(state.subChartPosition, state.mobileSubChartPosition);
    const bx = this.px(effPos.x, W);
    const by = this.px(effPos.y, H);
    const bw = Math.round(W * (this.isVertical ? 0.38 : 0.22));
    const bh = Math.round(H * (this.isVertical ? 0.12 : 0.1));

    // Background
    const bg = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
    bg.addColorStop(0, "rgba(15,12,41,0.9)");
    bg.addColorStop(1, "rgba(48,43,99,0.85)");
    ctx.fillStyle = bg;
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = "rgba(167,139,250,0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);

    // Label row
    const labelH = Math.round(bh * 0.28);
    const labelFs = Math.round(labelH * 0.55);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = `${labelFs}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("SUBSCRIBERS", bx + 6, by + labelH / 2);
    ctx.fillStyle = "#a78bfa";
    ctx.font = `bold ${Math.round(labelFs * 1.1)}px sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText(state.subs!, bx + bw - 6, by + labelH / 2);

    // Sparkline
    const chartY = by + labelH + 2;
    const chartH = bh - labelH - 6;
    const chartW = bw - 8;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const ptX = (i: number) => bx + 4 + (i / (data.length - 1)) * chartW;
    const ptY = (v: number) => chartY + chartH - ((v - min) / range) * chartH * 0.85;

    // Gradient fill under line
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(ptX(0), chartY + chartH);
    data.forEach((v, i) => ctx.lineTo(ptX(i), ptY(v)));
    ctx.lineTo(ptX(data.length - 1), chartY + chartH);
    ctx.closePath();
    const fillG = ctx.createLinearGradient(0, chartY, 0, chartY + chartH);
    fillG.addColorStop(0, "rgba(167,139,250,0.35)");
    fillG.addColorStop(1, "rgba(167,139,250,0.0)");
    ctx.fillStyle = fillG;
    ctx.fill();

    // Line
    ctx.beginPath();
    data.forEach((v, i) => i === 0 ? ctx.moveTo(ptX(i), ptY(v)) : ctx.lineTo(ptX(i), ptY(v)));
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = Math.max(1.5, Math.round(bh * 0.025));
    ctx.lineJoin = "round";
    ctx.stroke();

    // End dot
    const lastX = ptX(data.length - 1);
    const lastY = ptY(data[data.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, Math.round(bh * 0.06), 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.restore();
  }

  // ── SUB ALERT ──────────────────────────────────────────────────────────────

  private drawSubAlert(t: number) {
    const { ctx, W, H, state } = this;
    if (!state.subAlertMessage) return;

    const age = t - this.subAlertStartT;
    const fadeIn  = Math.min(1, age / 0.4);
    const fadeOut = age > SUBALERT_TTL - 0.6 ? Math.max(0, 1 - (age - (SUBALERT_TTL - 0.6)) / 0.5) : 1;
    const alpha   = fadeIn * fadeOut;
    const scale   = 0.85 + 0.15 * this.easeElastic(Math.min(1, age / 0.4));

    const bw = Math.round(W * (this.isVertical ? 0.88 : 0.55));
    const bh = Math.round(H * 0.1);
    const bx = (W - bw) / 2;
    const by = Math.round(H * 0.38);

    ctx.save();
    ctx.globalAlpha = alpha * this._panelAlpha;
    ctx.translate(bx + bw / 2, by + bh / 2);
    ctx.scale(scale, scale);
    ctx.translate(-(bw / 2), -(bh / 2));

    // Box
    const g = ctx.createLinearGradient(0, 0, bw, bh);
    g.addColorStop(0, "rgba(255,177,0,0.95)");
    g.addColorStop(1, "rgba(255,100,0,0.9)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, bw, bh);

    // Bell emoji-replacement: yellow circle
    const bellSz = Math.round(bh * 0.55);
    const bellX = Math.round(bh * 0.3);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.arc(bellX, bh / 2, bellSz / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(bellSz * 0.6)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("🔔", bellX, bh / 2);

    // Message
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(bh * 0.33)}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const msgX = bh * 0.7;
    let msg = state.subAlertMessage;
    while (msg.length > 4 && ctx.measureText(msg).width > bw - msgX - 12)
      msg = msg.slice(0, -4) + "…";
    ctx.fillText(msg, msgX, bh / 2);
    ctx.restore();
  }

  // ── SUPER CHAT NOTIFICATION ────────────────────────────────────────────────

  private drawSuperChatNotification(sc: SuperChatMessage, t: number) {
    if (!sc) return;
    const { ctx, W, H } = this;
    const ageMs = Date.now() - sc.ts;
    const ageSec = ageMs / 1000;

    const fadeIn  = Math.min(1, ageSec / 0.4);
    const fadeOut = ageSec > SUPERCHAT_TTL - 0.8 ? Math.max(0, 1 - (ageSec - (SUPERCHAT_TTL - 0.8)) / 0.7) : 1;
    const alpha   = fadeIn * fadeOut;
    const scale   = 0.85 + 0.15 * this.easeElastic(Math.min(1, ageSec / 0.35));

    const bw = Math.round(W * (this.isVertical ? 0.88 : 0.5));
    const bh = Math.round(H * (this.isVertical ? 0.16 : 0.14));
    const bx = (W - bw) / 2;
    const by = Math.round(H * 0.5);

    ctx.save();
    ctx.globalAlpha = alpha * this._panelAlpha;
    ctx.translate(bx + bw / 2, by + bh / 2);
    ctx.scale(scale, scale);
    ctx.translate(-(bw / 2), -(bh / 2));

    // Header band (tier color)
    ctx.fillStyle = sc.color || "#1565C0";
    ctx.fillRect(0, 0, bw, Math.round(bh * 0.38));

    // Body (darker tint)
    ctx.fillStyle = "rgba(10,10,25,0.94)";
    ctx.fillRect(0, Math.round(bh * 0.38), bw, bh - Math.round(bh * 0.38));

    // Left accent stripe
    ctx.fillStyle = sc.color || "#1565C0";
    ctx.fillRect(0, 0, 4, bh);

    // Amount badge
    const fs1 = Math.round(bh * 0.22);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${fs1}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(sc.amount, 12, bh * 0.19);

    // "Super Chat" label
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = `${Math.round(fs1 * 0.75)}px sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText("Super Chat", bw - 10, bh * 0.19);

    // User name
    const fs2 = Math.round(bh * 0.22);
    ctx.fillStyle = sc.color || "#81b0ff";
    ctx.font = `bold ${fs2}px sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(sc.user, 12, bh * 0.56);

    // Message
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = `${Math.round(fs2 * 0.85)}px sans-serif`;
    let msg = sc.text || "";
    while (msg.length > 4 && ctx.measureText(msg).width > bw - 22) msg = msg.slice(0, -4) + "…";
    ctx.fillText(msg, 12, bh * 0.8);

    ctx.restore();
  }

  // ── GUEST NAME TAG ─────────────────────────────────────────────────────────

  private drawGuestNameTag() {
    const { ctx, W, H, state } = this;
    const effPos = this.pos(state.guestPosition, state.mobileGuestPosition);
    const bx = this.px(effPos.x, W);
    const by = this.px(effPos.y, H);
    const bw = Math.round(W * (this.isVertical ? 0.82 : 0.42));
    const bh = Math.round(H * 0.1);
    const nameFs = Math.round(bh * 0.38);
    const titleFs = Math.round(bh * 0.24);

    switch (state.guestStyle) {
      case "Neon": {
        ctx.fillStyle = "rgba(4,4,20,0.9)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = "#00fff0";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, by, bw, bh);
        ctx.shadowColor = "#00fff0";
        ctx.shadowBlur = 10;
        ctx.fillStyle = "#00fff0";
        ctx.font = `bold ${nameFs}px sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(state.guestName, bx + 14, by + bh * 0.12);
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(0,255,240,0.55)";
        ctx.font = `${titleFs}px sans-serif`;
        ctx.fillText(state.guestTitle, bx + 14, by + bh * 0.58);
        break;
      }
      case "Gradient": {
        const g = ctx.createLinearGradient(bx, by, bx + bw, by);
        g.addColorStop(0, "rgba(102,126,234,0.93)");
        g.addColorStop(1, "rgba(118,75,162,0.88)");
        ctx.fillStyle = g;
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${nameFs}px sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(state.guestName, bx + 14, by + bh * 0.1);
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = `${titleFs}px sans-serif`;
        ctx.fillText(state.guestTitle, bx + 14, by + bh * 0.56);
        break;
      }
      case "Minimal": {
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${nameFs}px sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.shadowColor = "rgba(0,0,0,0.95)";
        ctx.shadowBlur = 12;
        ctx.fillText(state.guestName, bx, by);
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.font = `${titleFs}px sans-serif`;
        ctx.shadowColor = "rgba(0,0,0,0.95)";
        ctx.shadowBlur = 8;
        ctx.fillText(state.guestTitle, bx, by + nameFs + 4);
        ctx.shadowBlur = 0;
        break;
      }
      case "Sports": {
        const accentH = Math.round(bh * 0.45);
        ctx.fillStyle = "#e53e3e";
        ctx.fillRect(bx, by, bw, accentH);
        ctx.fillStyle = "rgba(0,0,0,0.92)";
        ctx.fillRect(bx, by + accentH, bw, bh - accentH);
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${Math.round(accentH * 0.7)}px sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(state.guestName.toUpperCase(), bx + 12, by + accentH / 2);
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.font = `bold ${Math.round((bh - accentH) * 0.55)}px sans-serif`;
        ctx.fillText(state.guestTitle.toUpperCase(), bx + 12, by + accentH + (bh - accentH) / 2);
        break;
      }
      case "Classic":
      default: {
        // Dark bar with left red stripe
        ctx.fillStyle = "rgba(0,0,0,0.88)";
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = "#cc0001";
        ctx.fillRect(bx, by, 5, bh);
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${nameFs}px sans-serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(state.guestName, bx + 16, by + bh * 0.1);
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.font = `${titleFs}px sans-serif`;
        ctx.fillText(state.guestTitle, bx + 16, by + bh * 0.57);
        break;
      }
    }
  }

  // ── CHAT BURN-IN ───────────────────────────────────────────────────────────

  private drawChatBurn(t: number) {
    const style = this.state.chatBurnStyle;
    if (this.isVertical) {
      switch (style) {
        case "Float":     return this.drawFloatChat();
        case "Sidebar":   return this.drawSidebarChatMobile();
        case "Highlight": return this.drawHighlightChat();
        case "Ticker":    return this.drawTickerChat(t);
        case "Bubble":
        default:          return this.drawBubbleChatMobile();
      }
    }
    switch (style) {
      case "Float":     return this.drawFloatChat();
      case "Sidebar":   return this.drawSidebarChat();
      case "Highlight": return this.drawHighlightChat();
      case "Ticker":    return this.drawTickerChat(t);
      case "Bubble":
      default:          return this.drawBubbleChat();
    }
  }

  private drawBubbleChat() {
    const { ctx, W, H, state } = this;
    const msgs = state.chatBurnMessages.slice(-4);
    if (!msgs.length) return;
    const effPos = this.pos(state.chatBurnPosition, state.mobileChatBurnPosition);
    const bx = this.px(effPos.x, W);
    const by = this.px(effPos.y, H);
    const rowH = Math.round(H * 0.062);
    const gap = Math.round(H * 0.01);
    const cardW = Math.round(W * 0.46);
    const radius = Math.round(rowH * 0.38);
    const avatarR = Math.round(rowH * 0.29);
    const padH = Math.round(rowH * 0.2);
    const avatarX = bx + padH + avatarR;
    const textX = avatarX + avatarR + Math.round(rowH * 0.15);
    const fontSize = Math.round(rowH * 0.31);
    const nameFontSize = Math.round(rowH * 0.27);
    ctx.textBaseline = "middle";
    msgs.forEach((msg, i) => {
      const my = by + i * (rowH + gap);
      if (my + rowH > H) return;
      const avatarColor = msg.color || "#cc0001";
      const cy = my + rowH / 2;
      // Rounded card background
      ctx.fillStyle = "rgba(8,10,22,0.88)";
      this.fillRR(bx, my, cardW, rowH, radius);
      // Card border
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 1;
      this.strokeRR(bx, my, cardW, rowH, radius);
      // Avatar circle
      ctx.fillStyle = avatarColor;
      ctx.beginPath();
      ctx.arc(avatarX, cy, avatarR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.round(avatarR * 0.95)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText((msg.name[0] || "?").toUpperCase(), avatarX, cy);
      // Username
      ctx.font = `bold ${nameFontSize}px sans-serif`;
      ctx.textAlign = "left";
      ctx.fillStyle = avatarColor;
      const displayName = msg.name.length > 14 ? msg.name.slice(0, 13) + "…" : msg.name;
      ctx.fillText(displayName, textX, my + rowH * 0.31);
      // Message text
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillStyle = "rgba(232,232,238,0.95)";
      const available = cardW - (textX - bx) - padH;
      let txt = msg.text;
      while (txt.length > 3 && ctx.measureText(txt).width > available) txt = txt.slice(0, -4) + "…";
      ctx.fillText(txt, textX, my + rowH * 0.69);
    });
    ctx.textBaseline = "alphabetic";
  }

  private drawBubbleChatMobile() {
    const { ctx, W, H, state } = this;
    const msgs = state.chatBurnMessages.slice(-5);
    if (!msgs.length) return;
    const effPos = this.pos(state.chatBurnPosition, state.mobileChatBurnPosition);
    const bx = this.px(effPos.x, W);
    const by = this.px(effPos.y, H);
    const cardW = Math.round(W * 0.88);
    const rowH = Math.round(H * 0.043);
    const gap = Math.round(H * 0.007);
    const radius = Math.round(rowH * 0.4);
    const fontSize = Math.round(rowH * 0.36);
    const padX = Math.round(rowH * 0.35);
    ctx.textBaseline = "middle";
    msgs.forEach((msg, i) => {
      const my = by + i * (rowH + gap);
      if (my + rowH > H) return;
      const avatarColor = msg.color || "#e8b4b8";
      const cy = my + rowH / 2;
      // Rounded card
      ctx.fillStyle = "rgba(8,10,22,0.88)";
      this.fillRR(bx, my, cardW, rowH, radius);
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 1;
      this.strokeRR(bx, my, cardW, rowH, radius);
      // Username + message inline
      const nameStr = msg.name + ": ";
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = "left";
      ctx.fillStyle = avatarColor;
      ctx.fillText(nameStr, bx + padX, cy);
      const nameW = ctx.measureText(nameStr).width;
      ctx.fillStyle = "rgba(232,232,238,0.95)";
      ctx.font = `${Math.round(fontSize * 0.93)}px sans-serif`;
      const available = cardW - nameW - padX * 2;
      let txt = msg.text;
      while (txt.length > 3 && ctx.measureText(txt).width > available) txt = txt.slice(0, -4) + "…";
      ctx.fillText(txt, bx + padX + nameW, cy);
    });
    ctx.textBaseline = "alphabetic";
  }

  private drawFloatChat() {
    const { ctx, W, H, state } = this;
    const now = Date.now();
    const effPos = this.pos(state.chatBurnPosition, state.mobileChatBurnPosition);
    const baseX = this.px(effPos.x, W);
    const baseY = this.px(effPos.y, H);
    const lifetimeSec = 5;
    const fontSize = Math.round(H * 0.038);
    const padX = Math.round(fontSize * 0.5);
    const padY = Math.round(fontSize * 0.32);
    const cardH = fontSize + padY * 2;
    const radius = Math.round(cardH * 0.42);
    for (const msg of state.chatBurnMessages) {
      const ageSec = (now - msg.ts) / 1000;
      if (ageSec > lifetimeSec) continue;
      const hash = [...msg.name].reduce((acc, c) => acc + c.charCodeAt(0), 0);
      const spread = (hash % 11) / 10;
      const mx = baseX + Math.round(spread * Math.min(W * 0.4, W - baseX - fontSize * 8));
      const my = baseY - Math.round((ageSec / lifetimeSec) * H * 0.25);
      const alpha = ageSec > lifetimeSec * 0.7
        ? 1 - (ageSec - lifetimeSec * 0.7) / (lifetimeSec * 0.3)
        : 1;
      if (alpha <= 0) continue;
      ctx.globalAlpha = this._panelAlpha * alpha;
      ctx.font = `bold ${fontSize}px sans-serif`;
      const nameLabel = `${msg.name}: `;
      const nameLabelW = ctx.measureText(nameLabel).width;
      ctx.font = `${fontSize}px sans-serif`;
      const msgW = ctx.measureText(msg.text).width;
      const cardW = nameLabelW + msgW + padX * 2;
      const cardTop = my - Math.round(cardH / 2);
      // Rounded frosted card
      ctx.fillStyle = "rgba(8,10,22,0.82)";
      this.fillRR(mx - padX, cardTop, cardW, cardH, radius);
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.lineWidth = 1;
      this.strokeRR(mx - padX, cardTop, cardW, cardH, radius);
      // Username in user color
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = msg.color || "#a78bfa";
      ctx.fillText(nameLabel, mx, my);
      // Message text
      ctx.font = `${fontSize}px sans-serif`;
      ctx.fillStyle = "#fff";
      ctx.fillText(msg.text, mx + nameLabelW, my);
      ctx.globalAlpha = 1;
    }
    ctx.textBaseline = "alphabetic";
  }

  private drawSidebarChat() {
    const { ctx, W, H, state } = this;
    const msgs = state.chatBurnMessages.slice(-8);
    if (!msgs.length) return;
    const effPos = this.pos(state.chatBurnPosition, state.mobileChatBurnPosition);
    const panelW = Math.round(W * 0.3);
    const px2 = this.px(effPos.x, W);
    const py2 = this.px(effPos.y, H);
    const headerH = Math.round(H * 0.033);
    const lineH = Math.round(H * 0.055);
    const panelH = Math.min(H - py2 - 8, headerH + msgs.length * lineH + 14);
    const fontSize = Math.round(lineH * 0.38);
    const radius = Math.round(panelH * 0.04);
    // Rounded panel background
    ctx.fillStyle = "rgba(6,8,20,0.90)";
    this.fillRR(px2, py2, panelW, panelH, radius);
    // Header row (clipped accent gradient)
    ctx.save();
    this.clipRR(px2, py2, panelW, panelH, radius);
    const hGrad = ctx.createLinearGradient(px2, py2, px2 + panelW, py2);
    hGrad.addColorStop(0, "rgba(170,0,0,0.88)");
    hGrad.addColorStop(1, "rgba(120,0,0,0.70)");
    ctx.fillStyle = hGrad;
    ctx.fillRect(px2, py2, panelW, headerH);
    ctx.restore();
    // Panel border
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = 1;
    this.strokeRR(px2, py2, panelW, panelH, radius);
    // Header label
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(headerH * 0.5)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("● LIVE CHAT", px2 + panelW / 2, py2 + headerH / 2);
    // Messages
    msgs.forEach((msg, i) => {
      const my = py2 + headerH + 7 + i * lineH;
      if (my + lineH > py2 + panelH - 4) return;
      if (i > 0) {
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(px2 + 8, my - 1, panelW - 16, 1);
      }
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = msg.color || "#a78bfa";
      const nameStr = msg.name + ": ";
      ctx.fillText(nameStr, px2 + 10, my);
      const nameW = ctx.measureText(nameStr).width;
      ctx.fillStyle = "rgba(232,232,238,0.85)";
      ctx.font = `${Math.round(fontSize * 0.92)}px sans-serif`;
      const available = panelW - 16 - nameW;
      let txt = msg.text;
      while (txt.length > 3 && ctx.measureText(txt).width > available) txt = txt.slice(0, -4) + "…";
      ctx.fillText(txt, px2 + 10 + nameW, my);
    });
    ctx.textBaseline = "alphabetic";
  }

  private drawSidebarChatMobile() {
    const { ctx, W, H, state } = this;
    const msgs = state.chatBurnMessages.slice(-6);
    if (!msgs.length) return;
    const effPos = this.pos(state.chatBurnPosition, state.mobileChatBurnPosition);
    const panelW = Math.round(W * 0.88);
    const px2 = this.px(effPos.x, W);
    const py2 = this.px(effPos.y, H);
    const headerH = Math.round(H * 0.028);
    const lineH = Math.round(H * 0.04);
    const panelH = headerH + msgs.length * (lineH + 4) + 10;
    const fontSize = Math.round(lineH * 0.38);
    const radius = 10;
    // Rounded panel
    ctx.fillStyle = "rgba(6,8,20,0.90)";
    this.fillRR(px2, py2, panelW, panelH, radius);
    // Header gradient
    ctx.save();
    this.clipRR(px2, py2, panelW, panelH, radius);
    const hg = ctx.createLinearGradient(px2, py2, px2 + panelW, py2);
    hg.addColorStop(0, "rgba(170,0,0,0.88)");
    hg.addColorStop(1, "rgba(120,0,0,0.70)");
    ctx.fillStyle = hg;
    ctx.fillRect(px2, py2, panelW, headerH);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = 1;
    this.strokeRR(px2, py2, panelW, panelH, radius);
    // Header label
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(headerH * 0.5)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("● LIVE CHAT", px2 + panelW / 2, py2 + headerH / 2);
    msgs.forEach((msg, i) => {
      const my = py2 + headerH + 5 + i * (lineH + 4);
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillStyle = msg.color || "#a78bfa";
      const nameStr = msg.name + ": ";
      ctx.fillText(nameStr, px2 + 8, my);
      const nameW = ctx.measureText(nameStr).width;
      ctx.fillStyle = "rgba(232,232,238,0.85)";
      ctx.font = `${Math.round(fontSize * 0.92)}px sans-serif`;
      const available = panelW - 16 - nameW;
      let txt = msg.text;
      while (txt.length > 3 && ctx.measureText(txt).width > available) txt = txt.slice(0, -4) + "…";
      ctx.fillText(txt, px2 + 8 + nameW, my);
    });
    ctx.textBaseline = "alphabetic";
  }

  private drawHighlightChat() {
    const { ctx, W, H, state } = this;
    const msgs = state.chatBurnMessages;
    if (!msgs.length) return;
    const msg = msgs[msgs.length - 1];
    const effPos = this.pos(state.chatBurnPosition, state.mobileChatBurnPosition);
    const bw = this.isVertical ? Math.round(W * 0.88) : Math.round(W * 0.58);
    const bh = Math.round(H * 0.13);
    const bx = this.px(effPos.x, W);
    const by = this.px(effPos.y, H);
    const radius = Math.round(bh * 0.13);
    const avatarColor = msg.color || "#cc0001";
    // Rounded card — dark gradient background
    const bgGrad = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
    bgGrad.addColorStop(0, "rgba(10,10,22,0.96)");
    bgGrad.addColorStop(1, "rgba(8,8,16,0.93)");
    ctx.fillStyle = bgGrad;
    this.fillRR(bx, by, bw, bh, radius);
    // Left accent stripe + top gradient line (clipped to card)
    ctx.save();
    this.clipRR(bx, by, bw, bh, radius);
    ctx.fillStyle = avatarColor;
    ctx.fillRect(bx, by, 5, bh);
    const topLineGrad = ctx.createLinearGradient(bx, by, bx + bw, by);
    topLineGrad.addColorStop(0, `${avatarColor}cc`);
    topLineGrad.addColorStop(0.55, `${avatarColor}44`);
    topLineGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = topLineGrad;
    ctx.fillRect(bx, by, bw, 2);
    ctx.restore();
    // Card border
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    this.strokeRR(bx, by, bw, bh, radius);
    // "NEW MESSAGE" label at top
    const badgeLabelFs = Math.round(bh * 0.13);
    ctx.fillStyle = avatarColor;
    ctx.font = `bold ${badgeLabelFs}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("● NEW MESSAGE", bx + 16, by + bh * 0.08);
    // Avatar circle with ring
    const avatarR = Math.round(bh * 0.23);
    const avatarCX = bx + avatarR + 14;
    const avatarCY = by + bh * 0.58;
    ctx.fillStyle = avatarColor;
    ctx.beginPath();
    ctx.arc(avatarCX, avatarCY, avatarR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(avatarCX, avatarCY, avatarR + 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(avatarR * 0.9)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((msg.name[0] || "?").toUpperCase(), avatarCX, avatarCY);
    // Username
    const textX = bx + avatarR * 2 + 24;
    const fs1 = Math.round(bh * 0.2);
    ctx.font = `bold ${fs1}px sans-serif`;
    ctx.textAlign = "left";
    ctx.fillStyle = avatarColor;
    ctx.textBaseline = "middle";
    ctx.fillText(msg.name, textX, by + bh * 0.44);
    // Message text
    const fs2 = Math.round(bh * 0.27);
    ctx.font = `${fs2}px sans-serif`;
    ctx.fillStyle = "rgba(235,235,240,0.96)";
    ctx.textBaseline = "top";
    let txt = msg.text;
    while (txt.length > 3 && ctx.measureText(txt).width > bw - (textX - bx) - 14) txt = txt.slice(0, -4) + "…";
    ctx.fillText(txt, textX, by + bh * 0.58);
    ctx.textBaseline = "alphabetic";
  }

  private drawTickerChat(t: number) {
    const { ctx, W, H, state } = this;
    const msgs = state.chatBurnMessages.slice(-12);
    if (!msgs.length) return;
    const effPos = this.pos(state.chatBurnPosition, state.mobileChatBurnPosition);
    const bh = Math.max(30, Math.round(H * 0.052));
    const by2 = this.px(effPos.y, H);
    const y = by2 > 0 ? Math.min(H - bh, by2) : H - bh;
    const badgeW = Math.round(W * (this.isVertical ? 0.21 : 0.1));
    // Full-width dark bar
    ctx.fillStyle = "rgba(8,10,18,0.96)";
    ctx.fillRect(0, y, W, bh);
    // Top accent gradient line
    const topLineGrad = ctx.createLinearGradient(0, y, W, y);
    topLineGrad.addColorStop(0, "rgba(204,0,1,0.92)");
    topLineGrad.addColorStop(0.5, "rgba(204,0,1,0.45)");
    topLineGrad.addColorStop(1, "rgba(204,0,1,0)");
    ctx.fillStyle = topLineGrad;
    ctx.fillRect(0, y, W, 2);
    // Rounded CHAT pill badge (inside bar, vertically centered)
    const badgePad = Math.round(bh * 0.14);
    const pillH = Math.round(bh * 0.66);
    const pillY = y + Math.round((bh - pillH) / 2);
    const pillW = badgeW - badgePad * 2;
    const pillR = Math.round(pillH * 0.38);
    const badgeGrad = ctx.createLinearGradient(badgePad, pillY, badgePad + pillW, pillY);
    badgeGrad.addColorStop(0, "rgba(204,0,1,1)");
    badgeGrad.addColorStop(1, "rgba(155,0,0,0.88)");
    ctx.fillStyle = badgeGrad;
    this.fillRR(badgePad, pillY, pillW, pillH, pillR);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(bh * 0.3)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("● CHAT", badgePad + pillW / 2, y + bh / 2 + 1);
    // Thin vertical separator
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(badgeW, y + bh * 0.18, 1, bh * 0.64);
    // Scrolling chat messages
    const full = msgs.map((m) => `${m.name}: ${m.text}`).join("     ·     ") + "     ·     ";
    const scrollFontSize = Math.round(bh * 0.31);
    ctx.font = `${scrollFontSize}px sans-serif`;
    const tw = ctx.measureText(full).width;
    const area = W - badgeW - 10;
    const speed = W * 0.065;
    const offset = (t * speed) % (tw || 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(badgeW + 10, y, area, bh);
    ctx.clip();
    ctx.fillStyle = "rgba(235,235,235,0.92)";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let i = 0; i < 3; i++) ctx.fillText(full, badgeW + 10 - offset + i * (tw + 20), y + bh / 2 + 1);
    ctx.restore();
  }

  // ── NEWS ───────────────────────────────────────────────────────────────────

  private drawNews(t: number) {
    const { state } = this;
    const animProg = Math.min(1, (t - this.newsAnimStartT) / ANIM_DUR);
    this._newsAnimProg = animProg;
    const anim = state.newsAnimation || "Fade";
    const CHAR_ANIMS = ["Typewriter", "Pop-in", "Letter Fade", "Bounce", "Reveal"];
    const isCharAnim = CHAR_ANIMS.includes(anim);

    const effPos = this.pos(state.newsPosition, state.mobileNewsPosition);
    const xBase = this.px(effPos.x, this.W);
    const yBase = this.px(effPos.y, this.H);

    const { ctx, W } = this;
    ctx.save();

    // Apply whole-overlay animations (not for char-level anims)
    if (animProg < 1 && !isCharAnim) {
      const ep = this.easeInOut(animProg);
      switch (anim) {
        case "Fade": ctx.globalAlpha *= ep; break;
        case "→":   ctx.translate(-(1 - ep) * W * 0.5, 0); break;
        case "←":   ctx.translate( (1 - ep) * W * 0.5, 0); break;
        case "↓":   ctx.translate(0, -(1 - ep) * 80); break;
        case "↙":   ctx.translate( (1 - ep) * W * 0.3, -(1 - ep) * 50); break;
        case "↗":   ctx.translate(-(1 - ep) * W * 0.3,  (1 - ep) * 50); break;
      }
    }

    switch (state.newsStyle) {
      case "Breaking":      this.drawBreaking(yBase); break;
      case "Lower Third":   this.drawLowerThird(xBase, yBase); break;
      case "Spotlight":     this.drawSpotlight(); break;
      case "Pop-up":        this.drawNewsPopup(); break;
      case "Scroll Banner": this.drawScrollBanner(t, yBase); break;
      case "Crawl":
      case "Ticker":
      default:              this.drawTicker(t, yBase); break;
    }

    ctx.restore();
  }

  private drawTicker(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh = Math.max(34, Math.round(H * 0.058));
    const badgeW = Math.round(W * (this.isVertical ? 0.22 : 0.12));
    const y = yBase > 0 ? Math.min(H - bh, yBase) : H - bh;
    const accentColor = state.newsBgColor || "#cc0001";
    // Dark background bar
    ctx.fillStyle = "rgba(8,8,10,0.96)";
    ctx.fillRect(0, y, W, bh);
    // Top edge accent line
    ctx.fillStyle = accentColor;
    ctx.fillRect(0, y, W, 2);
    // LIVE badge (red block)
    ctx.fillStyle = accentColor;
    ctx.fillRect(0, y + 2, badgeW, bh - 2);
    // Badge text
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(bh * 0.31)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("● LIVE", badgeW / 2, y + bh / 2 + 1);
    // Thin separator
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(badgeW, y + bh * 0.12, 1, bh * 0.76);
    // Scrolling news text
    const scrollFont = `${Math.round(bh * 0.3)}px sans-serif`;
    ctx.font = scrollFont;
    const sep = "     ◆     ";
    const full = state.newsText + sep + state.newsText;
    const tw = ctx.measureText(full).width;
    const area = W - badgeW - 12;
    const speed = W * 0.075;
    const offset = (t * speed) % (tw || 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(badgeW + 12, y + 2, area, bh - 2);
    ctx.clip();
    ctx.fillStyle = "rgba(238,238,238,0.96)";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let i = 0; i < 3; i++) ctx.fillText(full, badgeW + 12 - offset + i * (tw + 20), y + bh / 2 + 1);
    ctx.restore();
  }

  private drawBreaking(yBase: number) {
    const { ctx, W, H, state } = this;
    const bh = Math.max(48, Math.round(H * 0.072));
    const y = yBase > 0 ? Math.min(H - bh, yBase) : H - bh;
    const accentColor = state.newsBgColor || "#cc0001";
    // Full-width dark bar
    ctx.fillStyle = "rgba(8,8,10,0.97)";
    ctx.fillRect(0, y, W, bh);
    // Top red stripe
    ctx.fillStyle = accentColor;
    ctx.fillRect(0, y, W, 3);
    // BREAKING badge — red block on the left
    const badgeW = Math.round(W * (this.isVertical ? 0.28 : 0.14));
    ctx.fillStyle = accentColor;
    ctx.fillRect(0, y + 3, badgeW, bh - 3);
    // Badge label
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(bh * 0.28)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const badgeLabel = (state.newsTitle || "BREAKING NEWS").toUpperCase().slice(0, 14);
    ctx.fillText(badgeLabel, badgeW / 2, y + bh / 2 + 1);
    // Main news text
    const font = `bold ${Math.round(bh * 0.33)}px sans-serif`;
    ctx.textAlign = "left";
    const maxW = W - badgeW - 24;
    let txt = state.newsText;
    ctx.font = font;
    while (txt.length > 4 && ctx.measureText(txt).width > maxW) txt = txt.slice(0, -4) + "…";
    this.drawAnimText(txt, badgeW + 16, y + bh / 2, font, "#fff", state.newsAnimation, this._newsAnimProg);
  }

  private drawLowerThird(xBase: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const accentColor = state.newsBgColor || "#cc0001";
    const bw = Math.round(W * (this.isVertical ? 0.88 : 0.60));
    // Lower third has two rows: title bar (red) + main text bar (dark)
    const titleH = Math.round(H * 0.038);
    const mainH = Math.round(H * 0.058);
    const totalH = titleH + mainH;
    const x = xBase || 0;
    const y = yBase > 0 ? Math.min(H - totalH - 2, yBase) : H - totalH - Math.round(H * 0.05);
    // Red title bar (top row)
    ctx.fillStyle = accentColor;
    ctx.fillRect(x, y, bw, titleH);
    // Title text (e.g. "BREAKING NEWS", custom label, or channel name)
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(titleH * 0.52)}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const titleStr = (state.newsTitle || "LIVE UPDATE").toUpperCase();
    ctx.fillText(titleStr, x + 10, y + titleH / 2);
    // Dark main bar (bottom row)
    ctx.fillStyle = "rgba(10,10,14,0.95)";
    ctx.fillRect(x, y + titleH, bw, mainH);
    // Left accent stripe on main bar
    ctx.fillStyle = accentColor;
    ctx.fillRect(x, y + titleH, 4, mainH);
    // Main news text
    const mainFont = `bold ${Math.round(mainH * 0.38)}px sans-serif`;
    ctx.textBaseline = "middle";
    this.drawAnimText(state.newsText, x + 14, y + titleH + mainH / 2, mainFont, "#fff", state.newsAnimation, this._newsAnimProg);
    ctx.textBaseline = "alphabetic";
  }

  private drawSpotlight() {
    const { ctx, W, H, state } = this;
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.65);
    g.addColorStop(0, "rgba(0,0,0,0.35)");
    g.addColorStop(1, "rgba(0,0,0,0.82)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const fs = Math.round(Math.min(W, H) * 0.052);
    const font = `bold ${fs}px sans-serif`;
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const words = state.newsText.split(" ");
    const maxW = W * 0.72;
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (cur && ctx.measureText(test).width > maxW) { lines.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) lines.push(cur);
    const lh = fs * 1.35;
    const startY = H / 2 - (lines.length - 1) * lh / 2;
    lines.forEach((l, i) => {
      this.drawAnimText(l, W / 2, startY + i * lh, font, "#fff", state.newsAnimation, this._newsAnimProg);
    });
    ctx.fillStyle = "#cc0001";
    ctx.fillRect(W / 2 - 30, H / 2 + lines.length * lh / 2 + 8, 60, 3);
  }

  /** New: centered pop-up card */
  private drawNewsPopup() {
    const { ctx, W, H, state } = this;
    const bw = Math.round(W * (this.isVertical ? 0.88 : 0.65));
    const bh = Math.round(H * 0.12);
    const bx = (W - bw) / 2;
    const by = Math.round(H * 0.42);
    const g = ctx.createLinearGradient(bx, by, bx, by + bh);
    g.addColorStop(0, "rgba(15,12,41,0.97)");
    g.addColorStop(1, "rgba(48,43,99,0.94)");
    ctx.fillStyle = g;
    ctx.fillRect(bx, by, bw, bh);
    // Top accent line
    const accentG = ctx.createLinearGradient(bx, by, bx + bw, by);
    accentG.addColorStop(0, "#667eea"); accentG.addColorStop(1, "#a78bfa");
    ctx.fillStyle = accentG;
    ctx.fillRect(bx, by, bw, 3);
    const font = `bold ${Math.round(bh * 0.35)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.drawAnimText(state.newsText, bx + bw / 2, by + bh / 2, font, "#fff", state.newsAnimation, this._newsAnimProg);
  }

  /** New: gradient ticker banner */
  private drawScrollBanner(t: number, yBase: number) {
    const { ctx, W, H, state } = this;
    const bh = Math.max(34, Math.round(H * 0.058));
    const y = yBase > 0 ? Math.min(H - bh, yBase) : H - bh;
    const g = ctx.createLinearGradient(0, y, W, y + bh);
    g.addColorStop(0, "rgba(102,126,234,0.95)");
    g.addColorStop(0.5, "rgba(118,75,162,0.9)");
    g.addColorStop(1, "rgba(200,80,192,0.88)");
    ctx.fillStyle = g;
    ctx.fillRect(0, y, W, bh);
    const area = W;
    ctx.font = `bold ${Math.round(bh * 0.38)}px sans-serif`;
    const full = state.newsText + "          ✦          " + state.newsText;
    const tw = ctx.measureText(full).width;
    const speed = W * 0.09;
    const offset = (t * speed) % (tw + area);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, W, bh);
    ctx.clip();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let i = 0; i < 3; i++) ctx.fillText(full, -offset + i * (tw + 20), y + bh / 2);
    ctx.restore();
  }

  // ── ADS ────────────────────────────────────────────────────────────────────

  private drawAd() {
    const { state } = this;
    const effPos = this.pos(state.adPosition, state.mobileAdPosition);
    const y = this.px(effPos.y, this.H);
    const bh = Math.max(44, Math.round(this.H * 0.068));
    switch (state.adStyle) {
      case "Corner Pop":  return this.drawCornerAd();
      case "Fullscreen":
      case "Card":        return this.drawFullscreenAd();
      case "Strip":       return this.drawStripAd(y, bh);
      default:            return this.drawBannerAd(y, bh);
    }
  }

  private drawBannerAd(y: number, bh: number) {
    const { ctx, W, state } = this;
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "#667eea"); g.addColorStop(0.5, "#764ba2"); g.addColorStop(1, "#c850c0");
    ctx.fillStyle = g;
    ctx.fillRect(0, y, W, bh);
    const bw = Math.round(W * 0.09);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.fillRect(10, y + bh * 0.2, bw, bh * 0.6);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(bh * 0.27)}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("SPONSORED", 14, y + bh / 2);
    ctx.font = `bold ${Math.round(bh * 0.33)}px sans-serif`;
    ctx.fillText(state.adText, bw + 24, y + bh * 0.36);
    ctx.font = `${Math.round(bh * 0.24)}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(state.adSub, bw + 24, y + bh * 0.66);
  }

  private drawStripAd(y: number, bh: number) {
    const { ctx, W, state } = this;
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "#38ef7d"); g.addColorStop(1, "#11998e");
    ctx.fillStyle = g;
    ctx.fillRect(0, y, W, bh);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(bh * 0.35)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.adText, W / 2, y + bh / 2);
  }

  private drawCornerAd() {
    const { ctx, W, H, state } = this;
    const effPos = this.pos(state.adPosition, state.mobileAdPosition);
    const bw = Math.round(W * 0.24);
    const bh = Math.round(bw * 0.55);
    const x = this.px(effPos.x, W) || (W - bw - 16);
    const y = this.px(effPos.y, H) || 70;
    ctx.fillStyle = "rgba(246,211,101,0.93)";
    ctx.fillRect(x, y, bw, bh);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(bh * 0.3)}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(state.adText, x + 10, y + 8);
    ctx.font = `${Math.round(bh * 0.22)}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("Limited time only", x + 10, y + bh * 0.5);
  }

  private drawFullscreenAd() {
    const { ctx, W, H, state } = this;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#0f0c29"); g.addColorStop(0.5, "#302b63"); g.addColorStop(1, "#24243e");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const fs = Math.round(Math.min(W, H) * 0.052);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(state.adText, W / 2, H * 0.44);
    ctx.font = `${Math.round(fs * 0.65)}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillText(state.adSub, W / 2, H * 0.57);
  }

  // ── BREAK SCREEN ───────────────────────────────────────────────────────────

  private drawBreak(t: number) {
    switch (this.state.breakStyle) {
      case "Video":
      case "Video Play": return; // fully transparent — break video shows through
      case "Neon":     return this.drawNeonBreak(t);
      case "Glass":    return this.drawGlassBreak(t);
      case "Wave":     return this.drawWaveBreak(t);
      case "Minimal":  return this.drawMinimalBreak(t);
      case "Gradient": return this.drawGradientBreak(t);
      default:         return this.drawCountdownBreak(t);
    }
  }

  private countdown(t: number): string {
    const s = Math.max(0, 300 - Math.floor(t));
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  }

  private drawCountdownBreak(t: number) {
    const { ctx, W, H, state } = this;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#0f0c29"); g.addColorStop(1, "#302b63");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const fs = Math.round(Math.min(W, H) * 0.1);
    ctx.fillStyle = "#fff"; ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(this.countdown(t), W / 2, H * 0.45);
    ctx.font = `${Math.round(fs * 0.24)}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText(state.breakText, W / 2, H * 0.59);
    const bw = W * 0.5, bx = (W - bw) / 2, by = H * 0.7;
    ctx.fillStyle = "rgba(255,255,255,0.12)"; ctx.fillRect(bx, by, bw, 4);
    const g2 = ctx.createLinearGradient(bx, by, bx + bw, by);
    g2.addColorStop(0, "#667eea"); g2.addColorStop(1, "#a78bfa");
    ctx.fillStyle = g2;
    ctx.fillRect(bx, by, bw * Math.max(0, 300 - Math.floor(t)) / 300, 4);
  }

  private drawNeonBreak(t: number) {
    const { ctx, W, H, state } = this;
    ctx.fillStyle = "#04040c"; ctx.fillRect(0, 0, W, H);
    const fs = Math.round(Math.min(W, H) * 0.1);
    ctx.fillStyle = "#00fff0"; ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.shadowColor = "#00fff0"; ctx.shadowBlur = 20;
    ctx.fillText(this.countdown(t), W / 2, H * 0.45);
    ctx.shadowBlur = 0;
    ctx.font = `${Math.round(fs * 0.22)}px sans-serif`;
    ctx.fillStyle = "rgba(0,255,240,0.65)";
    ctx.fillText(state.breakText, W / 2, H * 0.59);
  }

  private drawGlassBreak(t: number) {
    const { ctx, W, H, state } = this;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, "#4158d0"); g.addColorStop(0.46, "#c850c0"); g.addColorStop(1, "#ffcc70");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const bw = W * 0.55, bh = H * 0.38, bx = (W - bw) / 2, by = (H - bh) / 2;
    ctx.fillStyle = "rgba(0,0,0,0.52)"; ctx.fillRect(bx, by, bw, bh);
    const fs = Math.round(Math.min(W, H) * 0.09);
    ctx.fillStyle = "#fff"; ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(this.countdown(t), W / 2, H * 0.45);
    ctx.font = `${Math.round(fs * 0.27)}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(state.breakText, W / 2, H * 0.59);
  }

  private drawWaveBreak(t: number) {
    const { ctx, W, H, state } = this;
    ctx.fillStyle = "#0f2027"; ctx.fillRect(0, 0, W, H);
    const fs = Math.round(Math.min(W, H) * 0.1);
    ctx.fillStyle = "#fff"; ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(this.countdown(t), W / 2, H * 0.45);
    ctx.font = `${Math.round(fs * 0.23)}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText(state.breakText, W / 2, H * 0.59);
  }

  private drawMinimalBreak(t: number) {
    const { ctx, W, H, state } = this;
    ctx.fillStyle = "#0a0a12"; ctx.fillRect(0, 0, W, H);
    const fs = Math.round(Math.min(W, H) * 0.1);
    ctx.fillStyle = "#fff"; ctx.font = `bold ${fs}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(this.countdown(t), W / 2, H / 2);
    ctx.font = `${Math.round(fs * 0.23)}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText(state.breakText, W / 2, H / 2 + fs * 0.85);
  }

  private drawGradientBreak(t: number) {
    const { ctx, W, H, state } = this;
    // Animated gradient: shift hue over time
    const cycle = (Math.sin(t * 0.4) + 1) / 2; // 0-1 oscillating
    const r1 = Math.round(102 + cycle * 80),  g1 = 126,  b1 = Math.round(234 - cycle * 60);
    const r2 = Math.round(240 - cycle * 80), g2 = Math.round(147 + cycle * 40), b2 = 251;
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, `rgb(${r1},${g1},${b1})`);
    grad.addColorStop(0.5, `rgb(${Math.round((r1+r2)/2)},${Math.round((g1+g2)/2)},${Math.round((b1+b2)/2)})`);
    grad.addColorStop(1, `rgb(${r2},${g2},${b2})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Rotating light sweep
    const sweep = ctx.createRadialGradient(
      W * (0.3 + 0.4 * Math.cos(t * 0.3)), H * 0.4, 0,
      W * (0.3 + 0.4 * Math.cos(t * 0.3)), H * 0.4, W * 0.7,
    );
    sweep.addColorStop(0, "rgba(255,255,255,0.18)");
    sweep.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sweep;
    ctx.fillRect(0, 0, W, H);

    // Text
    const fs = Math.round(Math.min(W, H) * 0.092);
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 16;
    ctx.fillStyle = "#fff"; ctx.font = `900 ${fs}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(this.countdown(t), W / 2, H * 0.44);
    ctx.shadowBlur = 0;

    ctx.font = `${Math.round(fs * 0.26)}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText(state.breakText, W / 2, H * 0.59);

    // Pill badge
    const bw = Math.min(W * 0.4, 260), bh = fs * 0.55, bx = (W - bw) / 2, by = H * 0.70;
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    const r = bh / 2;
    ctx.beginPath();
    ctx.moveTo(bx + r, by); ctx.lineTo(bx + bw - r, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
    ctx.lineTo(bx + bw - r, by + bh); ctx.lineTo(bx + r, by + bh);
    ctx.arcTo(bx, by + bh, bx, by, r);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = `700 ${Math.round(fs * 0.22)}px sans-serif`;
    ctx.fillText("Be right back!", W / 2, by + bh / 2);
  }

  // ── QR Code overlay ──────────────────────────────────────────────────────

  private getQrMatrix(url: string): boolean[][] | null {
    if (!url) return null;
    if (url === this.cachedQrUrl && this.qrMatrix) return this.qrMatrix;
    try {
      const data = QRCode.create(url, { errorCorrectionLevel: "M" });
      const size = data.modules.size;
      const matrix: boolean[][] = [];
      for (let r = 0; r < size; r++) {
        const row: boolean[] = [];
        for (let c = 0; c < size; c++) {
          row.push(!!data.modules.get(r, c));
        }
        matrix.push(row);
      }
      this.cachedQrUrl = url;
      this.qrMatrix = matrix;
      return matrix;
    } catch {
      return null;
    }
  }

  private strokeRoundRect(
    x: number, y: number, w: number, h: number, r: number,
    color: string, lineWidth: number,
  ): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth   = lineWidth;
    ctx.stroke();
  }

  private fillRoundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fill();
  }

  private fillTopRoundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.fill();
  }

  private fillBottomRoundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fill();
  }

  private drawQR(): void {
    const { ctx, W, H, state } = this;
    if (!state.qrUrl) return;

    const t      = this.elapsed();
    const size   = state.qrSize ?? 160;
    const pos    = state.qrPosition ?? { x: 88, y: 10 };
    const cx     = this.px(pos.x, W);
    const cy     = this.px(pos.y, H);
    const bob    = Math.sin(t * 1.1) * 2.5;

    // ── Thank-you mode: donor just paid — show for 10 s ─────────────────────
    const THANK_DUR_MS = 10_000;
    const thankAge = (state.qrThankYouActive && state.qrThankYouTs)
      ? (Date.now() - state.qrThankYouTs) : Infinity;
    if (thankAge < THANK_DUR_MS && state.qrThankYouName) {
      this.drawQRThankYou(cx, cy + bob, size, state.qrThankYouName, thankAge, THANK_DUR_MS);
      return;
    }

    // ── Normal QR mode ────────────────────────────────────────────────────────
    const matrix = this.getQrMatrix(state.qrUrl);
    if (!matrix) return;

    const n        = matrix.length;
    const cellSize = size / n;
    const pad      = Math.max(8, Math.round(size * 0.055));
    const labelH   = Math.round(size * 0.24);
    const footerH  = Math.round(size * 0.18);  // scan-count footer
    const cornerR  = Math.round(size * 0.09);
    const totalW   = size + pad * 2;
    const totalH   = labelH + size + pad * 2 + footerH;

    ctx.save();
    ctx.translate(cx, cy + bob);

    const left = -Math.round(totalW / 2);
    const top  = -Math.round(totalH / 2);

    // Drop shadow
    ctx.shadowColor   = "rgba(0,0,0,0.45)";
    ctx.shadowBlur    = 18;
    ctx.shadowOffsetY = 5;

    // Orange card (full background)
    ctx.fillStyle = "#FF813F";
    this.fillRoundRect(left, top, totalW, totalH, cornerR);

    ctx.shadowColor   = "transparent";
    ctx.shadowBlur    = 0;
    ctx.shadowOffsetY = 0;

    // Header tint
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    this.fillTopRoundRect(left, top, totalW, labelH, cornerR);

    // Header text
    const labelText = (state.qrTitle && state.qrTitle.trim())
      ? state.qrTitle.trim() : "SUPER CHAT";
    const labelFS = Math.max(11, Math.round(labelH * 0.33));
    ctx.fillStyle    = "#fff";
    ctx.font         = `800 ${labelFS}px sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(labelText, 0, top + Math.round(labelH / 2));

    // White QR panel (plain rect between header and footer)
    const qrPanelTop = top + labelH;
    const qrPanelH   = size + pad * 2;
    ctx.fillStyle = "#fff";
    ctx.fillRect(left + 2, qrPanelTop, totalW - 4, qrPanelH);

    // QR cells
    ctx.fillStyle = "#1a1a1a";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (matrix[r][c]) {
          const cellX = left + 2 + pad + Math.round(c * cellSize);
          const cellY = qrPanelTop + pad + Math.round(r * cellSize);
          const cs    = Math.max(1, Math.ceil(cellSize));
          ctx.fillRect(cellX, cellY, cs, cs);
        }
      }
    }

    // Subtle divider above footer
    const footerTop = qrPanelTop + qrPanelH;
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillRect(left + pad, footerTop, totalW - pad * 2, 1);

    // Scan count footer (on orange background from fillRoundRect)
    const scanCount = state.qrScanCount ?? 0;
    const scanLabel = scanCount === 0
      ? "Scan to donate"
      : scanCount === 1 ? "1 Scan \u2713" : `${scanCount.toLocaleString()} Scans \u2713`;
    const footerFS  = Math.max(9, Math.round(footerH * 0.42));
    ctx.fillStyle   = "#fff";
    ctx.font        = `700 ${footerFS}px sans-serif`;
    ctx.textAlign   = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(scanLabel, 0, footerTop + footerH / 2);

    ctx.restore();
  }

  private drawQRThankYou(
    cx: number, cy: number, size: number,
    name: string, ageMs: number, durMs: number,
  ): void {
    const { ctx } = this;

    // Smooth fade-in then fade-out at the end
    const FADE_IN_MS  = 350;
    const FADE_OUT_MS = 800;
    const fadeIn  = Math.min(1, ageMs / FADE_IN_MS);
    const fadeOut = ageMs > durMs - FADE_OUT_MS
      ? Math.max(0, 1 - (ageMs - (durMs - FADE_OUT_MS)) / FADE_OUT_MS) : 1;
    const alpha  = fadeIn * fadeOut;
    const scaleV = 0.82 + 0.18 * this.easeElastic(Math.min(1, ageMs / 420));

    const cardW   = Math.round(size * 1.5);
    const cardH   = Math.round(size * 0.90);
    const cornerR = Math.round(cardH * 0.09);

    ctx.save();
    ctx.globalAlpha = alpha * this._panelAlpha;
    ctx.translate(cx, cy);
    ctx.scale(scaleV, scaleV);

    const left = -Math.round(cardW / 2);
    const top  = -Math.round(cardH / 2);

    // Shadow
    ctx.shadowColor   = "rgba(0,0,0,0.55)";
    ctx.shadowBlur    = 28;
    ctx.shadowOffsetY = 10;

    // Deep green card
    ctx.fillStyle = "#021a07";
    this.fillRoundRect(left, top, cardW, cardH, cornerR);

    ctx.shadowColor = "transparent";
    ctx.shadowBlur  = 0;
    ctx.shadowOffsetY = 0;

    // Green top accent stripe
    const stripeH = Math.round(cardH * 0.055);
    ctx.fillStyle = "#22c55e";
    this.fillTopRoundRect(left, top, cardW, stripeH, cornerR);

    // Checkmark circle
    const circleR = Math.round(cardH * 0.17);
    const circleY = top + Math.round(cardH * 0.30);
    ctx.beginPath();
    ctx.arc(0, circleY, circleR, 0, Math.PI * 2);
    ctx.fillStyle = "#22c55e";
    ctx.fill();

    // Checkmark stroke
    const ck = circleR * 0.48;
    ctx.strokeStyle  = "#fff";
    ctx.lineWidth    = Math.max(2, circleR * 0.18);
    ctx.lineCap      = "round";
    ctx.lineJoin     = "round";
    ctx.beginPath();
    ctx.moveTo(-ck * 0.55, circleY);
    ctx.lineTo(-ck * 0.08, circleY + ck * 0.58);
    ctx.lineTo(ck * 0.62,  circleY - ck * 0.52);
    ctx.stroke();

    // "Payment Received!" label
    const subFS = Math.round(cardH * 0.11);
    ctx.fillStyle    = "#22c55e";
    ctx.font         = `700 ${subFS}px sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Payment Received!", 0, top + Math.round(cardH * 0.60));

    // "Thank you, [Name]!" — main text
    const nameFS = Math.round(cardH * 0.16);
    ctx.fillStyle = "#fff";
    ctx.font      = `800 ${nameFS}px sans-serif`;
    let displayName = name;
    while (displayName.length > 4
      && ctx.measureText(`Thank you, ${displayName}!`).width > cardW - 28) {
      displayName = displayName.slice(0, -3) + "\u2026";
    }
    ctx.fillText(`Thank you, ${displayName}!`, 0, top + Math.round(cardH * 0.77));

    // Heart pulse emoji
    const heartFS = Math.round(nameFS * 0.8);
    ctx.font      = `${heartFS}px sans-serif`;
    ctx.fillText("\u{1F49A}", 0, top + Math.round(cardH * 0.91));

    ctx.restore();
  }

  private drawFeaturedComment() {
    const { ctx, W, H, state } = this;
    if (!state.featuredComment) return;
    const msg = state.featuredComment;

    const isV = H > W;
    const cardW  = Math.round(W * (isV ? 0.90 : 0.60));
    const baseFS = Math.round(H * (isV ? 0.030 : 0.038));
    const nameFS = Math.round(baseFS * 0.80);
    const tagFS  = Math.round(baseFS * 0.62);
    const padH   = Math.round(baseFS * 1.1);
    const padV   = Math.round(baseFS * 0.7);
    const accentW = Math.round(baseFS * 0.28);
    const labelH  = Math.round(tagFS * 1.6);
    const contentH = padV + nameFS + Math.round(baseFS * 0.2) + baseFS + padV;
    const cardH    = labelH + contentH;

    const x = Math.round(W * (isV ? 0.05 : 0.03));
    const y = Math.round(H * (isV ? 0.72 : 0.75));

    const accentColor = msg.color || "#ff2244";

    ctx.save();

    // Drop shadow
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;

    // Main card background
    ctx.fillStyle = "rgba(8, 8, 18, 0.92)";
    const r = Math.round(baseFS * 0.55);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + cardW - r, y);
    ctx.quadraticCurveTo(x + cardW, y, x + cardW, y + r);
    ctx.lineTo(x + cardW, y + cardH - r);
    ctx.quadraticCurveTo(x + cardW, y + cardH, x + cardW - r, y + cardH);
    ctx.lineTo(x + r, y + cardH);
    ctx.quadraticCurveTo(x, y + cardH, x, y + cardH - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();

    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;

    // Top label bar
    ctx.fillStyle = accentColor;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + cardW - r, y);
    ctx.quadraticCurveTo(x + cardW, y, x + cardW, y + r);
    ctx.lineTo(x + cardW, y + labelH);
    ctx.lineTo(x, y + labelH);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();

    // Label text: "💬 Featured Comment"
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${tagFS}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("💬  Featured Comment", x + padH, y + labelH / 2);

    // Left accent bar (content area)
    ctx.fillStyle = accentColor;
    ctx.fillRect(x, y + labelH, accentW, contentH);

    // Author name
    ctx.font = `bold ${nameFS}px sans-serif`;
    ctx.fillStyle = accentColor;
    ctx.textBaseline = "top";
    ctx.fillText(msg.name, x + accentW + padH, y + labelH + padV);

    // Message text — wrap to card width
    const maxTW = cardW - accentW - padH * 2;
    ctx.font = `${baseFS}px sans-serif`;
    ctx.fillStyle = "#f0f0f0";
    let txt = msg.text;
    while (txt.length > 4 && ctx.measureText(txt).width > maxTW) {
      txt = txt.slice(0, -4) + "…";
    }
    ctx.fillText(txt, x + accentW + padH, y + labelH + padV + nameFS + Math.round(baseFS * 0.2));

    ctx.restore();
  }

  // ── GIFT ALERT SYSTEM (TikTok-style) ────────────────────────────────────────

  private drawGiftAlert(item: GiftQueueItem): void {
    const ageMs = Date.now() - item.displayTs;
    const dur   = item.gift.durationMs;
    const FADE_IN  = 380;
    const FADE_OUT = 650;
    const fadeIn  = Math.min(1, ageMs / FADE_IN);
    const fadeOut = ageMs > dur - FADE_OUT
      ? Math.max(0, 1 - (ageMs - (dur - FADE_OUT)) / FADE_OUT) : 1;
    const alpha = fadeIn * fadeOut * this._panelAlpha;
    if (alpha < 0.01) return;
    const mode = this.state.giftDisplayMode === "auto"
      ? item.gift.displayMode : this.state.giftDisplayMode;
    switch (mode) {
      case "minimal":  this.drawGiftMinimal(item, ageMs, alpha);  break;
      case "standard": this.drawGiftStandard(item, ageMs, alpha); break;
      case "hype":     this.drawGiftHype(item, ageMs, alpha);     break;
    }
  }

  private drawGiftParticles(
    cx: number, cy: number,
    gift: GiftDef, ageMs: number, durMs: number, maxRadius: number,
  ): void {
    const { ctx } = this;
    const progress = Math.min(1, ageMs / durMs);
    const FADE_START = 0.52;
    ctx.save();
    for (let i = 0; i < gift.particleCount; i++) {
      const phase  = i / gift.particleCount;
      const orbit  = ageMs * 0.0015 * (i % 2 === 0 ? 1 : -1.3);
      const angle  = phase * Math.PI * 2 + orbit;
      const spread = maxRadius * Math.pow(Math.min(1, progress * 1.7), 0.52);
      const wobble = Math.sin(ageMs * 0.004 + i * 2.3) * spread * 0.11;
      const px     = cx + Math.cos(angle) * (spread + wobble);
      const py     = cy + Math.sin(angle) * (spread + wobble) * 0.72;
      const fade   = progress > FADE_START
        ? Math.max(0, 1 - (progress - FADE_START) / (1 - FADE_START)) : 1;
      const size   = Math.max(1.5, (2.5 + Math.sin(i * 1.7 + ageMs * 0.006) * 1.5) * fade);
      const color  = i % 3 === 0 ? gift.primaryColor : (i % 3 === 1 ? gift.accentColor : gift.glowColor);
      ctx.globalAlpha = fade * 0.82;
      ctx.fillStyle   = color;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawGiftMinimal(item: GiftQueueItem, ageMs: number, alpha: number): void {
    const { ctx, W, H } = this;
    const { gift } = item;
    const cardW   = Math.round(W * (this.isVertical ? 0.62 : 0.27));
    const cardH   = Math.round(H * 0.095);
    const cornerR = Math.round(cardH * 0.22);
    const slideP  = this.easeElastic(Math.min(1, ageMs / 420));
    const cardX   = W - cardW - Math.round(W * 0.018) - (1 - slideP) * (cardW + 10);
    const cardY   = Math.round(H * 0.055);
    const cy      = cardY + cardH / 2;

    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.shadowColor   = gift.glowColor;
    ctx.shadowBlur    = 20;
    ctx.fillStyle     = "rgba(4, 6, 24, 0.93)";
    this.fillRoundRect(cardX, cardY, cardW, cardH, cornerR);
    ctx.shadowBlur    = 0;
    ctx.shadowColor   = "transparent";

    this.strokeRoundRect(cardX, cardY, cardW, cardH, cornerR, gift.primaryColor, 2);

    ctx.fillStyle = gift.primaryColor;
    this.fillRoundRect(cardX, cardY, 4, cardH, 2);

    const iconFS = Math.round(cardH * 0.52);
    ctx.font         = `${iconFS}px sans-serif`;
    ctx.textAlign    = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(gift.icon, cardX + 10, cy);

    const nameFS = Math.round(cardH * 0.20);
    ctx.fillStyle = gift.accentColor;
    ctx.font      = `700 ${nameFS}px sans-serif`;
    ctx.fillText(gift.name, cardX + 10 + iconFS + 6, cy - cardH * 0.14);

    ctx.fillStyle = "#ffffff";
    ctx.font      = `${nameFS}px sans-serif`;
    ctx.fillText((item.donorName.split(" ")[0] ?? item.donorName), cardX + 10 + iconFS + 6, cy + cardH * 0.13);

    ctx.fillStyle    = gift.primaryColor;
    ctx.font         = `700 ${nameFS}px sans-serif`;
    ctx.textAlign    = "right";
    ctx.fillText(item.amount, cardX + cardW - 8, cy);

    if (item.comboCount > 1) {
      const comboFS = Math.round(cardH * 0.19);
      ctx.fillStyle   = "#ff6b35";
      ctx.font        = `800 ${comboFS}px sans-serif`;
      ctx.shadowColor = "#ff6b35";
      ctx.shadowBlur  = 10;
      ctx.fillText(`\uD83D\uDD25${item.comboCount}x`, cardX + cardW - 8, cy + cardH * 0.32);
      ctx.shadowBlur  = 0;
      ctx.shadowColor = "transparent";
    }

    this.drawGiftParticles(cardX + cardW, cy, gift, ageMs, item.gift.durationMs, cardH * 0.9);
    ctx.restore();
  }

  private drawGiftStandard(item: GiftQueueItem, ageMs: number, alpha: number): void {
    const { ctx, W, H } = this;
    const { gift } = item;
    const cardW   = Math.round(W * (this.isVertical ? 0.88 : 0.54));
    const cardH   = Math.round(H * 0.14);
    const cornerR = Math.round(cardH * 0.17);
    const scaleP  = this.easeElastic(Math.min(1, ageMs / 420));
    const scale   = 0.82 + 0.18 * scaleP;
    const cardCX  = W / 2;
    const cardCY  = H * (this.isVertical ? 0.60 : 0.65);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cardCX, cardCY);
    ctx.scale(scale, scale);
    ctx.translate(-cardCX, -cardCY);

    const cardX = cardCX - cardW / 2;
    const cardY = cardCY - cardH / 2;

    ctx.shadowColor   = gift.glowColor;
    ctx.shadowBlur    = 32;
    ctx.fillStyle     = "rgba(3, 5, 20, 0.93)";
    this.fillRoundRect(cardX, cardY, cardW, cardH, cornerR);
    ctx.shadowBlur    = 0;
    ctx.shadowColor   = "transparent";

    this.strokeRoundRect(cardX, cardY, cardW, cardH, cornerR, gift.primaryColor, 2.5);

    const stripH = Math.round(cardH * 0.07);
    ctx.fillStyle = gift.primaryColor;
    this.fillTopRoundRect(cardX, cardY, cardW, stripH, cornerR);

    const tierLabel = gift.tier === "university" ? "\uD83C\uDF93 UNIVERSITY" : gift.tier === "gold" ? "\uD83E\uDD47 GOLD" : "\uD83E\uDD48 SILVER";
    const tierFS    = Math.round(cardH * 0.11);
    ctx.fillStyle   = gift.accentColor;
    ctx.font        = `700 ${tierFS}px sans-serif`;
    ctx.textAlign   = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(tierLabel, cardX + cardW - 10, cardY + stripH / 2);

    const iconFS = Math.round(cardH * 0.58);
    const iconX  = cardX + Math.round(cardH * 0.48);
    const iconCY = cardY + cardH * 0.55;
    ctx.shadowColor = gift.glowColor;
    ctx.shadowBlur  = 28;
    ctx.font         = `${iconFS}px sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(gift.icon, iconX, iconCY);
    ctx.fillText(gift.icon, iconX, iconCY);
    ctx.shadowBlur  = 0;
    ctx.shadowColor = "transparent";

    const textX  = iconX + iconFS * 0.68;
    const nameFS = Math.round(cardH * 0.18);
    ctx.shadowColor = gift.glowColor;
    ctx.shadowBlur  = 6;
    ctx.fillStyle   = gift.primaryColor;
    ctx.font        = `800 ${nameFS}px sans-serif`;
    ctx.textAlign   = "left";
    ctx.fillText(gift.name, textX, cardY + cardH * 0.33);
    ctx.shadowBlur  = 0;
    ctx.shadowColor = "transparent";

    const donorFS = Math.round(cardH * 0.22);
    let donor = item.donorName;
    ctx.font = `700 ${donorFS}px sans-serif`;
    while (donor.length > 3 && ctx.measureText(donor).width > cardX + cardW - textX - 20) {
      donor = donor.slice(0, -4) + "\u2026";
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillText(donor, textX, cardY + cardH * 0.57);

    ctx.fillStyle = gift.accentColor;
    ctx.font      = `700 ${Math.round(cardH * 0.18)}px sans-serif`;
    ctx.fillText(item.amount, textX, cardY + cardH * 0.78);

    if (item.comboCount > 1) {
      ctx.fillStyle   = "#ff6b35";
      ctx.font        = `800 ${Math.round(cardH * 0.19)}px sans-serif`;
      ctx.textAlign   = "right";
      ctx.shadowColor = "#ff6b35";
      ctx.shadowBlur  = 14;
      ctx.fillText(`\uD83D\uDD25 ${item.comboCount}x`, cardX + cardW - 10, cardY + cardH * 0.72);
      ctx.shadowBlur  = 0;
      ctx.shadowColor = "transparent";
    }

    ctx.restore();
    ctx.save();
    ctx.globalAlpha = alpha;
    this.drawGiftParticles(cardCX, cardCY, gift, ageMs, item.gift.durationMs, cardH * 1.3);
    ctx.restore();
  }

  private drawGiftHype(item: GiftQueueItem, ageMs: number, alpha: number): void {
    const { ctx, W, H } = this;
    const { gift } = item;
    const cx = W / 2;
    const cy = H * (this.isVertical ? 0.40 : 0.42);

    ctx.save();
    ctx.globalAlpha = alpha;

    // Dark vignette
    const vigGrad = ctx.createRadialGradient(cx, H * 0.5, 0, cx, H * 0.5, Math.max(W, H) * 0.75);
    vigGrad.addColorStop(0, "rgba(0,0,0,0.0)");
    vigGrad.addColorStop(0.45, "rgba(0,0,0,0.55)");
    vigGrad.addColorStop(1, "rgba(0,0,0,0.88)");
    ctx.fillStyle = vigGrad;
    ctx.fillRect(0, 0, W, H);

    // Glow rings
    for (let i = 0; i < 3; i++) {
      const phase  = ((i / 3) + ageMs * 0.00042) % 1;
      const ringR  = Math.min(W, H) * 0.42 * phase;
      const rAlpha = (1 - phase) * 0.40;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0, ringR), 0, Math.PI * 2);
      ctx.strokeStyle = gift.primaryColor;
      ctx.lineWidth   = Math.max(1, 4.5 * (1 - phase));
      ctx.globalAlpha = alpha * rAlpha;
      ctx.stroke();
    }
    ctx.globalAlpha = alpha;

    // Large icon (elastic pop-in)
    const iconP     = this.easeElastic(Math.min(1, ageMs / 520));
    const iconScale = 0.55 + 0.45 * iconP;
    const iconFS    = Math.round(Math.min(W, H) * (this.isVertical ? 0.24 : 0.21));

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(iconScale, iconScale);
    ctx.shadowColor = gift.glowColor;
    ctx.shadowBlur  = 70;
    ctx.font         = `${iconFS}px sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(gift.icon, 0, 0);
    ctx.fillText(gift.icon, 0, 0);
    ctx.shadowBlur  = 0;
    ctx.shadowColor = "transparent";
    ctx.restore();

    // Text animates in with short delay
    const textFade = Math.min(1, Math.max(0, ageMs - 220) / 280);
    ctx.globalAlpha = alpha * textFade;

    const labelFS = Math.round(H * (this.isVertical ? 0.038 : 0.042));
    ctx.fillStyle    = gift.primaryColor;
    ctx.font         = `800 ${labelFS}px sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor  = gift.glowColor;
    ctx.shadowBlur   = 24;
    ctx.fillText(`${gift.icon} ${gift.name.toUpperCase()} ${gift.icon}`, cx, cy - iconFS * 0.62);
    ctx.shadowBlur  = 0;
    ctx.shadowColor = "transparent";

    const donorFS = Math.round(H * (this.isVertical ? 0.048 : 0.052));
    ctx.fillStyle    = "#ffffff";
    ctx.font         = `800 ${donorFS}px sans-serif`;
    ctx.shadowColor  = "rgba(0,0,0,0.85)";
    ctx.shadowBlur   = 12;
    ctx.fillText(item.donorName, cx, cy + iconFS * 0.60);
    ctx.shadowBlur  = 0;
    ctx.shadowColor = "transparent";

    const amountFS = Math.round(H * (this.isVertical ? 0.034 : 0.038));
    ctx.font        = `700 ${amountFS}px sans-serif`;
    const amountW   = ctx.measureText(item.amount).width;
    const pillW     = amountW + 40;
    const pillH     = amountFS * 1.6;
    const pillY     = cy + iconFS * 0.60 + donorFS * 0.72;
    ctx.fillStyle   = gift.primaryColor;
    ctx.shadowColor = gift.glowColor;
    ctx.shadowBlur  = 18;
    this.fillRoundRect(cx - pillW / 2, pillY - pillH / 2, pillW, pillH, pillH / 2);
    ctx.shadowBlur  = 0;
    ctx.shadowColor = "transparent";
    ctx.fillStyle   = "#ffffff";
    ctx.fillText(item.amount, cx, pillY);

    if (item.comboCount > 1) {
      const comboFS = Math.round(H * 0.046);
      ctx.fillStyle   = "#ff6b35";
      ctx.font        = `800 ${comboFS}px sans-serif`;
      ctx.shadowColor = "#ff6b35";
      ctx.shadowBlur  = 24;
      ctx.fillText(`\uD83D\uDD25 ${item.comboCount}x COMBO!`, cx, pillY + pillH * 0.9);
      ctx.shadowBlur  = 0;
      ctx.shadowColor = "transparent";
    }

    ctx.globalAlpha = alpha;
    this.drawGiftParticles(cx, cy, gift, ageMs, item.gift.durationMs, Math.min(W, H) * 0.44);
    ctx.restore();
  }

  // ── DONATION ALERT (legacy fallback) ─────────────────────────────────────────

  private drawDonationAlert(
    d: { name: string; amount: string; amountKes: number; color: string; message: string; ts: number },
    _t: number,
  ) {
    const { ctx, W, H } = this;
    const ageSec = (Date.now() - d.ts) / 1000;
    const ALERT_TTL = 8;
    const fadeIn  = Math.min(1, ageSec / 0.4);
    const fadeOut = ageSec > ALERT_TTL - 0.8 ? Math.max(0, 1 - (ageSec - (ALERT_TTL - 0.8)) / 0.7) : 1;
    const alpha   = fadeIn * fadeOut;
    const scale   = 0.85 + 0.15 * this.easeElastic(Math.min(1, ageSec / 0.35));

    const bw = Math.round(W * (this.isVertical ? 0.88 : 0.52));
    const bh = Math.round(H * (this.isVertical ? 0.15 : 0.13));
    const bx = (W - bw) / 2;
    const by = Math.round(H * 0.35);

    ctx.save();
    ctx.globalAlpha = alpha * this._panelAlpha;
    ctx.translate(bx + bw / 2, by + bh / 2);
    ctx.scale(scale, scale);
    ctx.translate(-(bw / 2), -(bh / 2));

    const accentColor = d.color || "#22c55e";

    // Header band
    ctx.fillStyle = accentColor;
    ctx.fillRect(0, 0, bw, Math.round(bh * 0.38));

    // Body
    ctx.fillStyle = "rgba(5,30,10,0.94)";
    ctx.fillRect(0, Math.round(bh * 0.38), bw, bh - Math.round(bh * 0.38));

    // Left accent stripe
    ctx.fillStyle = accentColor;
    ctx.fillRect(0, 0, 4, bh);

    // Amount
    const fs1 = Math.round(bh * 0.22);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${fs1}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(d.amount, 12, bh * 0.19);

    // Label
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `${Math.round(fs1 * 0.7)}px sans-serif`;
    ctx.textAlign = "right";
    ctx.fillText("\u{1F49A}  Donation", bw - 10, bh * 0.19);

    // Donor name
    const fs2 = Math.round(bh * 0.22);
    ctx.fillStyle = accentColor;
    ctx.font = `bold ${fs2}px sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(d.name, 12, bh * 0.56);

    // Message
    if (d.message) {
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.font = `${Math.round(fs2 * 0.82)}px sans-serif`;
      let msg = d.message;
      while (msg.length > 4 && ctx.measureText(msg).width > bw - 22) msg = msg.slice(0, -4) + "\u2026";
      ctx.fillText(msg, 12, bh * 0.8);
    }

    ctx.restore();
  }

  // ── DONATION TICKER ─────────────────────────────────────────────────────────

  private drawDonationTicker(_t: number) {
    const { ctx, W, H, state } = this;
    if (!state.donationTicker || state.donationTicker.length === 0) return;

    const tickerH  = Math.round(H * 0.038);
    const tickerY  = Math.round(H * (this.isVertical ? 0.88 : 0.90));
    const fontSize = Math.round(tickerH * 0.55);
    const PX       = 28;
    const SPEED    = 80; // px/s

    ctx.save();
    ctx.fillStyle = "rgba(5,30,10,0.88)";
    ctx.fillRect(0, tickerY, W, tickerH);

    const badgeW = Math.round(W * 0.14);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(0, tickerY, badgeW, tickerH);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("\u{1F49A} DONATIONS", badgeW / 2, tickerY + tickerH / 2);

    const items = state.donationTicker.slice(0, 10).map(d => `${d.name}  ${d.amount}`);
    const fullText = items.join("   \u00B7   ") + "      ";

    ctx.font = `${fontSize}px sans-serif`;
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const textW = ctx.measureText(fullText).width;

    const elapsed = this.elapsed();
    const dt = this.donationTickerLastT > 0 ? elapsed - this.donationTickerLastT : 0;
    this.donationTickerOffset = (this.donationTickerOffset + SPEED * dt) % (textW + PX);
    this.donationTickerLastT = elapsed;

    ctx.save();
    ctx.beginPath();
    ctx.rect(badgeW, tickerY, W - badgeW, tickerH);
    ctx.clip();
    const x = badgeW + PX - this.donationTickerOffset;
    ctx.fillText(fullText, x, tickerY + tickerH / 2);
    ctx.fillText(fullText, x + textW + PX, tickerY + tickerH / 2);
    ctx.restore();

    ctx.restore();
  }
}
