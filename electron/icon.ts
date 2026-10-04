import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

/** Window / taskbar icon (Linux/Windows). macOS uses the .app bundle .icns. */
export function resolveWindowIcon(): string | undefined {
  const candidates = [
    path.join(process.resourcesPath, "icon.png"),
    path.join(app.getAppPath(), "electron-assets", "icon.png"),
    path.join(__dirname, "..", "electron-assets", "icon.png"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}
