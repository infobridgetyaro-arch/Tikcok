import { logger } from "../lib/logger.js";
import {
  getState, setState, loadPersistedState, buildDefaultState,
} from "./state-manager.js";
import {
  addTickerMessage, removeTickerMessage, clearTickerMessages,
  getTickerMessages, addBreakingNewsMessage, pruneExpired,
} from "./ticker-manager.js";
import {
  createWidget, listWidgetTypes, startClockWidgets, stopClockWidgets,
} from "./widget-manager.js";
import { installBuiltinPresets } from "./preset-manager.js";
import { getTheme, listThemes } from "./theme-manager.js";
import { listAnimationPresets } from "./animation-manager.js";
import type {
  NewsOverlayState, ThemeName, AnimationPreset, WidgetType,
  TickerConfig, BreakingNewsConfig, LiveBadgeConfig, HeadlineConfig,
} from "./types.js";

type BroadcastFn = (type: string, payload: unknown) => void;

let _broadcast: BroadcastFn | null = null;
let _headlineTimer: ReturnType<typeof setTimeout> | null = null;
let _pruneTimer: ReturnType<typeof setInterval> | null = null;

// ── Initialise ─────────────────────────────────────────────────────────────────

export function initNewsOverlay(broadcast: BroadcastFn): void {
  _broadcast = broadcast;
  loadPersistedState();
  installBuiltinPresets();

  // Prune expired ticker messages every 30 s
  _pruneTimer = setInterval(() => {
    pruneExpired();
    if (getState().active) emitState();
  }, 30_000);

  // Start clock widgets if any enabled
  const { widgets } = getState();
  startClockWidgets(widgets);

  logger.info("[news-overlay] Initialised");
}

export function shutdownNewsOverlay(): void {
  stopClockWidgets();
  if (_pruneTimer) { clearInterval(_pruneTimer); _pruneTimer = null; }
  if (_headlineTimer) { clearTimeout(_headlineTimer); _headlineTimer = null; }
}

// ── Emit state to all WebSocket clients ───────────────────────────────────────

export function emitState(): void {
  if (!_broadcast) return;
  _broadcast("news-overlay", getState());
}

// ── High-level actions ─────────────────────────────────────────────────────────

export function activate(): NewsOverlayState {
  const s = setState({ active: true });
  emitState();
  startHeadlineRotation();
  return s;
}

export function deactivate(): NewsOverlayState {
  const s = setState({ active: false });
  stopHeadlineRotation();
  emitState();
  return s;
}

export function toggle(): NewsOverlayState {
  const { active } = getState();
  return active ? deactivate() : activate();
}

export function updateOverlay(patch: Partial<NewsOverlayState>): NewsOverlayState {
  const s = setState(patch);
  emitState();
  // Restart clock widgets if widgets changed
  if (patch.widgets) startClockWidgets(s.widgets);
  // Restart headline rotation if headline config changed
  if (patch.headline) {
    stopHeadlineRotation();
    if (s.active) startHeadlineRotation();
  }
  return s;
}

export function applyThemeFull(themeName: ThemeName): NewsOverlayState {
  const theme = getTheme(themeName);
  const current = getState();
  const s = setState({
    theme: themeName,
    customColors: theme.colors,
    customFont: theme.font,
    customBorder: theme.border,
    customShadow: theme.shadow,
    opacity: theme.opacity,
    ticker: { ...current.ticker, style: theme.tickerStyle },
    liveBadge: { ...current.liveBadge, color: theme.colors.badge, label: theme.badgeLabel },
  });
  emitState();
  return s;
}

// ── Ticker ─────────────────────────────────────────────────────────────────────

export function addMessage(text: string, priority = 0, expiresInMs?: number) {
  const msg = addTickerMessage(text, priority, expiresInMs);
  emitTickerEvent();
  return msg;
}

export function removeMessage(id: string): boolean {
  const ok = removeTickerMessage(id);
  if (ok) emitTickerEvent();
  return ok;
}

export function clearMessages(): void {
  clearTickerMessages();
  emitTickerEvent();
}

export function addBreaking(text: string) {
  setState({ breakingNews: { ...getState().breakingNews, active: true, text } });
  const msg = addBreakingNewsMessage(text);
  emitState();
  return msg;
}

export function clearBreaking(): void {
  setState({ breakingNews: { ...getState().breakingNews, active: false, text: "" } });
  emitState();
}

export function updateTickerConfig(cfg: Partial<TickerConfig>): NewsOverlayState {
  const s = setState({ ticker: { ...getState().ticker, ...cfg } });
  emitState();
  return s;
}

// ── Headline rotation ─────────────────────────────────────────────────────────

function startHeadlineRotation(): void {
  stopHeadlineRotation();
  const { headline } = getState();
  if (!headline.autoRotate || headline.headlines.length <= 1) return;
  scheduleNextHeadline();
}

function scheduleNextHeadline(): void {
  const { headline } = getState();
  if (!headline.autoRotate) return;
  _headlineTimer = setTimeout(() => {
    const { headline: h, active } = getState();
    if (!active || !h.autoRotate) return;
    const nextIndex = (h.currentIndex + 1) % h.headlines.length;
    setState({
      headline: {
        ...h,
        currentIndex: nextIndex,
        text: h.headlines[nextIndex],
      },
    });
    emitState();
    scheduleNextHeadline();
  }, headline.durationMs);
}

function stopHeadlineRotation(): void {
  if (_headlineTimer) { clearTimeout(_headlineTimer); _headlineTimer = null; }
}

// ── Ticker WebSocket event ─────────────────────────────────────────────────────

function emitTickerEvent(): void {
  if (!_broadcast) return;
  const { ticker } = getState();
  _broadcast("news-overlay-ticker", { messages: getTickerMessages(), config: ticker });
}

// ── Introspection ──────────────────────────────────────────────────────────────

export function getCapabilities() {
  return {
    themes: listThemes(),
    animations: listAnimationPresets(),
    widgetTypes: listWidgetTypes(),
    tickerStyles: [
      "CNN", "BBC", "Bloomberg", "Fox", "Sky News", "CNBC",
      "Al Jazeera", "Modern", "Minimal", "Glass", "Election",
    ],
    tickerDirections: ["left", "right"],
  };
}
