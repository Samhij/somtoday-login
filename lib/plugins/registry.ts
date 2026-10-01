import { promises as fs } from "fs";
import path from "path";
import JSZip from "jszip";
import { parseManifest, type PluginManifest } from "./manifest";

export type InstalledPlugin = PluginManifest & {
  enabled: boolean;
  builtin?: boolean;
  installedAt: string;
};

type PluginIndex = {
  plugins: InstalledPlugin[];
};

const MAX_ZIP_BYTES = 2 * 1024 * 1024;

function dataRoot() {
  return process.env.CYFERS_DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
}

function pluginsRoot() {
  return path.join(dataRoot(), "plugins");
}

function indexPath() {
  return path.join(pluginsRoot(), "index.json");
}

function builtinRoot() {
  return process.env.CYFERS_BUILTIN_PLUGINS || path.join(/*turbopackIgnore: true*/ process.cwd(), "plugins");
}

async function ensureRoot() {
  await fs.mkdir(pluginsRoot(), { recursive: true });
}

async function readIndex(): Promise<PluginIndex> {
  await ensureRoot();
  try {
    const raw = await fs.readFile(indexPath(), "utf8");
    const parsed = JSON.parse(raw) as PluginIndex;
    if (!parsed.plugins || !Array.isArray(parsed.plugins)) return { plugins: [] };
    return parsed;
  } catch {
    return { plugins: [] };
  }
}

async function writeIndex(index: PluginIndex) {
  await ensureRoot();
  await fs.writeFile(indexPath(), JSON.stringify(index, null, 2));
}

export function pluginDir(id: string) {
  return path.join(pluginsRoot(), id);
}

export async function listPlugins(): Promise<InstalledPlugin[]> {
  await ensureBuiltinPlugins();
  const index = await readIndex();
  return [...index.plugins].sort((a, b) => {
    const order = a.nav.order - b.nav.order;
    if (order !== 0) return order;
    return a.nav.label.localeCompare(b.nav.label, "nl");
  });
}

export async function getPlugin(id: string): Promise<InstalledPlugin | null> {
  const plugins = await listPlugins();
  return plugins.find((plugin) => plugin.id === id) ?? null;
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<InstalledPlugin> {
  const index = await readIndex();
  const plugin = index.plugins.find((item) => item.id === id);
  if (!plugin) throw new Error("Plugin niet gevonden.");
  plugin.enabled = enabled;
  await writeIndex(index);
  return plugin;
}

export async function removePlugin(id: string): Promise<void> {
  const index = await readIndex();
  const plugin = index.plugins.find((item) => item.id === id);
  if (!plugin) throw new Error("Plugin niet gevonden.");
  if (plugin.builtin) throw new Error("Ingebouwde plugins kun je niet verwijderen.");
  index.plugins = index.plugins.filter((item) => item.id !== id);
  await writeIndex(index);
  await fs.rm(pluginDir(id), { recursive: true, force: true });
}

function safeJoin(root: string, relative: string) {
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) {
    throw new Error("Ongeldig pad in plugin-pakket.");
  }
  return resolved;
}

async function copyDir(src: string, dest: string) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(from, to);
    else await fs.copyFile(from, to);
  }
}

async function installFromDirectory(
  sourceDir: string,
  options: { builtin?: boolean; enabled?: boolean } = {},
): Promise<InstalledPlugin> {
  const manifestRaw = JSON.parse(await fs.readFile(path.join(sourceDir, "manifest.json"), "utf8"));
  const manifest = parseManifest(manifestRaw);
  const target = pluginDir(manifest.id);
  await fs.rm(target, { recursive: true, force: true });
  await copyDir(sourceDir, target);

  const entryPath = safeJoin(target, manifest.entry);
  await fs.access(entryPath);

  const installed: InstalledPlugin = {
    ...manifest,
    enabled: options.enabled ?? true,
    builtin: options.builtin ?? false,
    installedAt: new Date().toISOString(),
  };

  const index = await readIndex();
  const existing = index.plugins.findIndex((item) => item.id === manifest.id);
  if (existing >= 0) {
    installed.enabled = index.plugins[existing].enabled;
    installed.builtin = options.builtin ?? index.plugins[existing].builtin;
    index.plugins[existing] = installed;
  } else {
    index.plugins.push(installed);
  }
  await writeIndex(index);
  return installed;
}

export async function ensureBuiltinPlugins() {
  const index = await readIndex();
  const legacy = index.plugins.find((item) => item.id === "core-overzicht");
  if (legacy) {
    index.plugins = index.plugins.filter((item) => item.id !== "core-overzicht");
    await writeIndex(index);
    await fs.rm(pluginDir("core-overzicht"), { recursive: true, force: true });
  }

  const builtins = ["widget-cijfers"];
  for (const id of builtins) {
    const source = path.join(/*turbopackIgnore: true*/ builtinRoot(), id);
    try {
      await fs.access(path.join(source, "manifest.json"));
    } catch {
      continue;
    }
    await installFromDirectory(source, { builtin: true, enabled: true });
  }
}

export async function installPluginZip(buffer: Buffer): Promise<InstalledPlugin> {
  if (buffer.byteLength > MAX_ZIP_BYTES) {
    throw new Error("Plugin-zip is groter dan 2 MB.");
  }

  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files);
  if (names.length === 0) throw new Error("Lege zip.");

  const manifestName = names.find((name) => name === "manifest.json" || name.endsWith("/manifest.json"));
  if (!manifestName) throw new Error("manifest.json ontbreekt in de zip.");

  const rootPrefix = manifestName.includes("/")
    ? manifestName.slice(0, manifestName.lastIndexOf("/") + 1)
    : "";

  const manifestText = await zip.file(manifestName)!.async("string");
  const manifest = parseManifest(JSON.parse(manifestText));

  const target = pluginDir(manifest.id);
  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(target, { recursive: true });

  for (const name of names) {
    const file = zip.files[name];
    if (!file || file.dir) continue;
    if (rootPrefix && !name.startsWith(rootPrefix)) continue;
    const relative = rootPrefix ? name.slice(rootPrefix.length) : name;
    if (!relative || relative.includes("..")) throw new Error("Ongeldig pad in zip.");
    if (relative !== "manifest.json" && !relative.startsWith("ui/")) {
      throw new Error(`Bestand buiten ui/ niet toegestaan: ${relative}`);
    }
    const dest = safeJoin(target, relative);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const content = await file.async("nodebuffer");
    await fs.writeFile(dest, content);
  }

  const entryPath = safeJoin(target, manifest.entry);
  await fs.access(entryPath);

  const installed: InstalledPlugin = {
    ...manifest,
    enabled: true,
    builtin: false,
    installedAt: new Date().toISOString(),
  };

  const index = await readIndex();
  const existing = index.plugins.findIndex((item) => item.id === manifest.id);
  if (existing >= 0) {
    if (index.plugins[existing].builtin) {
      throw new Error("Kan een ingebouwde plugin niet overschrijven.");
    }
    installed.enabled = index.plugins[existing].enabled;
    index.plugins[existing] = installed;
  } else {
    index.plugins.push(installed);
  }
  await writeIndex(index);
  return installed;
}

export async function readPluginFile(id: string, relativePath: string): Promise<Buffer> {
  const cleaned = relativePath.replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("..")) throw new Error("Ongeldig bestandspad.");
  if (cleaned !== "manifest.json" && !cleaned.startsWith("ui/")) {
    throw new Error("Alleen ui/-bestanden zijn leesbaar.");
  }
  const full = safeJoin(pluginDir(id), cleaned);
  return fs.readFile(full);
}

export async function readPluginEntryHtml(id: string): Promise<{ html: string; entry: string }> {
  const plugin = await getPlugin(id);
  if (!plugin) throw new Error("Plugin niet gevonden.");
  const buffer = await readPluginFile(id, plugin.entry);
  return { html: buffer.toString("utf8"), entry: plugin.entry };
}
