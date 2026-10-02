/** Preload bridge types for the Electron desktop shell (absent in non-Electron contexts). */

export type CyfersUpdateEvent =
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "not-available"; version: string }
  | { type: "downloaded"; version: string }
  | { type: "error"; message: string }
  | { type: "progress"; percent: number };

export type CyfersDesktopBridge = {
  getVersion: () => Promise<string>;
  checkForUpdates: () => Promise<{ ok: boolean; error?: string }>;
  installUpdate: () => Promise<{ ok: boolean; error?: string }>;
  onUpdateEvent: (callback: (event: CyfersUpdateEvent) => void) => () => void;
};

declare global {
  interface Window {
    cyfersDesktop?: CyfersDesktopBridge;
  }
}

export {};
