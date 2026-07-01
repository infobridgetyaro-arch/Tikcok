export { initNewsOverlay, shutdownNewsOverlay, emitState, getCapabilities } from "./overlay-manager.js";
export { getState, setState } from "./state-manager.js";
export type { NewsOverlayState, ThemeName, AnimationPreset, TickerStyle, WidgetType } from "./types.js";
export { default as newsOverlayRouter } from "./routes.js";
