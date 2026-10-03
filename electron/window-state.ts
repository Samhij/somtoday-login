import { screen, type BrowserWindow, type Rectangle } from "electron";
import fs from "node:fs";
import path from "node:path";

export type SavedWindowState = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
  isFullScreen?: boolean;
};

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 840;
const SAVE_DEBOUNCE_MS = 400;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function windowWithinBounds(bounds: Rectangle, displayBounds: Rectangle): boolean {
  return (
    bounds.x >= displayBounds.x &&
    bounds.y >= displayBounds.y &&
    bounds.x + bounds.width <= displayBounds.x + displayBounds.width &&
    bounds.y + bounds.height <= displayBounds.y + displayBounds.height
  );
}

/** Keep restored size; drop x/y when no display still contains the frame. */
export function clampWindowState(state: SavedWindowState): SavedWindowState {
  const width = Math.max(1, Math.round(state.width));
  const height = Math.max(1, Math.round(state.height));
  const hasPosition = isFiniteNumber(state.x) && isFiniteNumber(state.y);
  if (!hasPosition) {
    return {
      width,
      height,
      isMaximized: Boolean(state.isMaximized),
      isFullScreen: Boolean(state.isFullScreen),
    };
  }

  const bounds: Rectangle = {
    x: Math.round(state.x!),
    y: Math.round(state.y!),
    width,
    height,
  };
  const visible = screen
    .getAllDisplays()
    .some((display) => windowWithinBounds(bounds, display.bounds));

  if (!visible) {
    return {
      width,
      height,
      isMaximized: Boolean(state.isMaximized),
      isFullScreen: Boolean(state.isFullScreen),
    };
  }

  return {
    ...bounds,
    isMaximized: Boolean(state.isMaximized),
    isFullScreen: Boolean(state.isFullScreen),
  };
}

export function loadWindowState(filePath: string): SavedWindowState {
  const fallback: SavedWindowState = {
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<SavedWindowState>;
    if (!isFiniteNumber(raw.width) || !isFiniteNumber(raw.height)) return fallback;
    return clampWindowState({
      width: raw.width,
      height: raw.height,
      x: isFiniteNumber(raw.x) ? raw.x : undefined,
      y: isFiniteNumber(raw.y) ? raw.y : undefined,
      isMaximized: Boolean(raw.isMaximized),
      isFullScreen: Boolean(raw.isFullScreen),
    });
  } catch {
    return fallback;
  }
}

function captureWindowState(win: BrowserWindow): SavedWindowState {
  // Maximized/fullscreen getBounds() is the filled display; keep the normal frame.
  const bounds =
    win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds();
  return {
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    isMaximized: win.isMaximized(),
    isFullScreen: win.isFullScreen(),
  };
}

export function saveWindowState(filePath: string, win: BrowserWindow): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const state = captureWindowState(win);
    fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {
    // Best-effort; never block quit/resize on disk errors.
  }
}

/** Wire resize/move/maximize listeners; returns a flush() for quit. */
export function trackWindowState(win: BrowserWindow, filePath: string): () => void {
  let timer: NodeJS.Timeout | null = null;

  const scheduleSave = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (!win.isDestroyed()) saveWindowState(filePath, win);
    }, SAVE_DEBOUNCE_MS);
  };

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!win.isDestroyed()) saveWindowState(filePath, win);
  };

  win.on("resize", scheduleSave);
  win.on("move", scheduleSave);
  win.on("maximize", scheduleSave);
  win.on("unmaximize", scheduleSave);
  win.on("enter-full-screen", scheduleSave);
  win.on("leave-full-screen", scheduleSave);
  win.on("close", flush);

  return flush;
}
