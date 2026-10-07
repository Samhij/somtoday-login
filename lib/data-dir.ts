import path from "node:path";

/**
 * Resolved app data root (sessions, login-prefs, plugins, plugin-storage).
 * Prefer bracket env access so Next never inlines a build-time empty value.
 * Electron main sets CYFERS_DATA_DIR to userData/data (or data-dev when unpackaged).
 */
export function dataDir(): string {
  const fromEnv = process.env["CYFERS_DATA_DIR"]?.trim();
  if (fromEnv) return fromEnv;
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
}
