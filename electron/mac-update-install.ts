import { app } from "electron";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Absolute path to the running .app bundle (…/Cyfers.app). */
export function macAppBundlePath(): string {
  // process.execPath = …/Cyfers.app/Contents/MacOS/Cyfers
  return path.resolve(process.execPath, "..", "..", "..");
}

/** True when codesign verifies the current bundle (required by Squirrel.Mac). */
export function isMacAppSigned(appBundle = macAppBundlePath()): boolean {
  try {
    execFileSync("codesign", ["--verify", "--verbose=0", appBundle], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install a downloaded universal/x64 zip without Squirrel.Mac.
 * Unsigned builds cannot use Electron's native autoUpdater on macOS;
 * this extracts the new .app and swaps it in after the process exits.
 */
export function installMacUpdateFromZip(zipPath: string): void {
  if (!zipPath || !fs.existsSync(zipPath)) {
    throw new Error("Updatebestand ontbreekt. Start Cyfers opnieuw en probeer opnieuw.");
  }

  const appBundle = macAppBundlePath();
  const appName = path.basename(appBundle);
  if (!appName.endsWith(".app")) {
    throw new Error("Kon de app-locatie niet bepalen voor de update.");
  }

  const parentDir = path.dirname(appBundle);
  try {
    fs.accessSync(parentDir, fs.constants.W_OK);
  } catch {
    throw new Error(
      "Kan Cyfers hier niet bijwerken. Verplaats de app naar Programma's en probeer opnieuw.",
    );
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cyfers-update-"));
  const extractDir = path.join(tempRoot, "extract");
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    execFileSync("unzip", ["-qq", "-o", zipPath, "-d", extractDir], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } catch (error) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Update uitpakken mislukt. ${detail}`);
  }

  const newApp = path.join(extractDir, appName);
  if (!fs.existsSync(newApp) || !fs.statSync(newApp).isDirectory()) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    throw new Error("Updatepakket bevat geen geldige Cyfers.app.");
  }

  const pid = process.pid;
  const scriptPath = path.join(tempRoot, "install.sh");
  // Wait for this process to exit, then replace the bundle and relaunch.
  const script = `#!/bin/bash
set -euo pipefail
while kill -0 ${pid} 2>/dev/null; do sleep 0.2; done
sleep 0.3
ditto ${shellQuote(newApp)} ${shellQuote(appBundle)}
xattr -cr ${shellQuote(appBundle)} 2>/dev/null || true
open ${shellQuote(appBundle)}
rm -rf ${shellQuote(tempRoot)}
`;
  fs.writeFileSync(scriptPath, script, { mode: 0o755 });

  const child = spawn(scriptPath, [], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  // Quit so the swap script can replace the bundle. Force-exit if quit stalls
  // (macOS can keep the process alive after windows close).
  app.quit();
  setTimeout(() => {
    app.exit(0);
  }, 2500);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
