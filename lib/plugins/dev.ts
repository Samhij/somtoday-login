import {promises as fs, watch as fsWatch, type FSWatcher} from "fs";
import path from "path";
import {parseManifest, type PluginManifest} from "./manifest";
import {
  getPlugin,
  installPluginFromDirectory,
  listPlugins,
  type InstalledPlugin,
  type PluginDevLinkMode,
} from "./registry";

export type DevPluginListing = PluginManifest & {
  folder: string;
  sourcePath: string;
  loaded: boolean;
  loadedVersion: string | null;
  linkMode: PluginDevLinkMode | null;
  enabled: boolean | null;
};

function allowSiblingDevDir(): boolean {
  if (process.env.CYFERS_UNPACKAGED === "1") return true;
  // next/electron unpackaged sets NODE_ENV=development; packaged production does not.
  return process.env.NODE_ENV !== "production";
}

/** Absolute path to the unpacked plugins root, or null when preview is unavailable. */
export async function resolvePluginDevRoot(): Promise<string | null> {
  const explicit = process.env.CYFERS_PLUGIN_DEV_DIR?.trim();
  if (explicit) {
    const resolved = path.resolve(explicit);
    try {
      const stat = await fs.stat(resolved);
      if (stat.isDirectory()) return resolved;
    } catch {
      return null;
    }
    return null;
  }

  if (!allowSiblingDevDir()) return null;

  const sibling = path.resolve(
    /*turbopackIgnore: true*/ process.cwd(),
    "..",
    "cyfer-plugins",
    "plugins",
  );
  try {
    const stat = await fs.stat(sibling);
    if (stat.isDirectory()) return sibling;
  } catch {
    // absent
  }
  return null;
}

export async function isPluginDevPreviewAvailable(): Promise<boolean> {
  return (await resolvePluginDevRoot()) !== null;
}

async function readDevManifest(dir: string): Promise<PluginManifest> {
  const raw = await fs.readFile(path.join(dir, "manifest.json"), "utf8");
  return parseManifest(JSON.parse(raw));
}

export async function listDevPlugins(): Promise<{
  root: string | null;
  plugins: DevPluginListing[];
}> {
  const root = await resolvePluginDevRoot();
  if (!root) return {root: null, plugins: []};

  const installed = await listPlugins();
  const byId = new Map(installed.map((plugin) => [plugin.id, plugin]));

  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return {root, plugins: []};
  }

  const plugins: DevPluginListing[] = [];
  for (const folder of entries) {
    if (folder.startsWith(".")) continue;
    const sourcePath = path.join(root, folder);
    let stat;
    try {
      stat = await fs.stat(sourcePath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    try {
      await fs.access(path.join(sourcePath, "manifest.json"));
      await fs.access(path.join(sourcePath, "ui"));
      const manifest = await readDevManifest(sourcePath);
      if (manifest.id !== folder) {
        // Still list it, but load will enforce id === folder name.
      }
      const current = byId.get(manifest.id);
      const resolvedSource = path.resolve(sourcePath);
      const isDevLoaded = Boolean(
        current?.devPreview && current.devSource && path.resolve(current.devSource) === resolvedSource,
      );
      plugins.push({
        ...manifest,
        folder,
        sourcePath,
        loaded: isDevLoaded,
        loadedVersion: isDevLoaded ? current?.version ?? null : null,
        linkMode: isDevLoaded ? current?.devLinkMode ?? null : null,
        enabled: isDevLoaded ? current?.enabled ?? null : null,
      });
    } catch {
      // skip invalid folders
    }
  }

  plugins.sort((a, b) => {
    return a.nav.label.localeCompare(b.nav.label, "nl") || a.id.localeCompare(b.id);
  });

  return {root, plugins};
}

export async function loadDevPlugin(id: string): Promise<InstalledPlugin> {
  const root = await resolvePluginDevRoot();
  if (!root) throw new Error("Geen ontwikkelmap beschikbaar.");

  const sourcePath = path.join(root, id);
  const manifest = await readDevManifest(sourcePath);
  if (manifest.id !== id) {
    throw new Error(`mapnaam “${id}” komt niet overeen met manifest.id “${manifest.id}”.`);
  }

  return installPluginFromDirectory(sourcePath, {devPreview: true});
}

export async function reloadDevPlugin(id: string): Promise<InstalledPlugin> {
  const current = await getPlugin(id);
  if (!current?.devPreview || !current.devSource) {
    // Not yet loaded as preview — treat as load.
    return loadDevPlugin(id);
  }

  const root = await resolvePluginDevRoot();
  if (!root) throw new Error("Geen ontwikkelmap beschikbaar.");

  // Prefer the recorded source; fall back to root/id if it still exists.
  let sourcePath = current.devSource;
  try {
    await fs.access(path.join(sourcePath, "manifest.json"));
  } catch {
    sourcePath = path.join(root, id);
  }

  const manifest = await readDevManifest(sourcePath);
  if (manifest.id !== id) {
    throw new Error(`mapnaam “${id}” komt niet overeen met manifest.id “${manifest.id}”.`);
  }

  return installPluginFromDirectory(sourcePath, {
    devPreview: true,
    preserveEnabled: current.enabled,
  });
}

type WatchListener = (pluginId: string) => void;

const watchers = new Map<string, FSWatcher>();
const watchListeners = new Set<WatchListener>();
let watchDebounce: ReturnType<typeof setTimeout> | null = null;
const pendingIds = new Set<string>();

function emitWatched(pluginId: string) {
  pendingIds.add(pluginId);
  if (watchDebounce) clearTimeout(watchDebounce);
  watchDebounce = setTimeout(() => {
    const ids = [...pendingIds];
    pendingIds.clear();
    for (const id of ids) {
      for (const listener of watchListeners) listener(id);
    }
  }, 200);
}

async function syncWatchers() {
  const installed = await listPlugins();
  const preview = installed.filter((plugin) => plugin.devPreview && plugin.devSource);
  const wanted = new Set(preview.map((plugin) => plugin.id));

  for (const [id, watcher] of watchers) {
    if (!wanted.has(id)) {
      watcher.close();
      watchers.delete(id);
    }
  }

  for (const plugin of preview) {
    if (watchers.has(plugin.id) || !plugin.devSource) continue;
    try {
      const watcher = fsWatch(plugin.devSource, {recursive: true}, () => {
        emitWatched(plugin.id);
      });
      watcher.on("error", () => {
        // Recursive watch is unsupported on some platforms; ignore.
      });
      watchers.set(plugin.id, watcher);
    } catch {
      // Fallback: watch ui/ + manifest only via non-recursive parent.
      try {
        const uiDir = path.join(plugin.devSource, "ui");
        const watcher = fsWatch(uiDir, () => emitWatched(plugin.id));
        watchers.set(plugin.id, watcher);
      } catch {
        // no watch for this plugin
      }
    }
  }
}

export function subscribeDevPluginChanges(listener: WatchListener): () => void {
  watchListeners.add(listener);
  void syncWatchers();
  const interval = setInterval(() => {
    void syncWatchers();
  }, 5000);
  return () => {
    watchListeners.delete(listener);
    clearInterval(interval);
    if (watchListeners.size === 0) {
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    }
  };
}

/** Re-copy / refresh index after a watched change (no-op for symlink beyond manifest). */
export async function refreshDevPluginAfterChange(id: string): Promise<InstalledPlugin | null> {
  const current = await getPlugin(id);
  if (!current?.devPreview) return null;
  try {
    return await reloadDevPlugin(id);
  } catch {
    return null;
  }
}
