import JSZip from "jszip";
import { createHash } from "node:crypto";
import { parseManifest, type PluginKind, type PluginManifest } from "./manifest";
import { installPluginZip, type InstalledPlugin } from "./registry";

export type StorePlugin = {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  kind: PluginKind;
  nav: { label: string; icon: string; order: number };
  permissions: { api: string[] };
  downloadUrl?: string;
  sha256?: string;
  sourceUrl?: string;
};

export type PluginCatalog = {
  updatedAt: string;
  plugins: StorePlugin[];
};

const DEFAULT_CATALOG_URL =
  "https://raw.githubusercontent.com/Samhij/cyfer-plugins/main/catalog.json";
const DEFAULT_REPO = "Samhij/cyfer-plugins";
const DEFAULT_REF = "main";
const MAX_ZIP_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "raw.githubusercontent.com",
  "github.com",
  "objects.githubusercontent.com",
  "codeload.github.com",
]);

function catalogUrl() {
  return process.env.CYFERS_PLUGIN_STORE_URL?.trim() || DEFAULT_CATALOG_URL;
}

function storeRepo() {
  const raw = process.env.CYFERS_PLUGIN_STORE_REPO?.trim() || DEFAULT_REPO;
  const [owner, repo] = raw.split("/");
  if (!owner || !repo) throw new Error("CYFERS_PLUGIN_STORE_REPO is ongeldig.");
  return { owner, repo };
}

function storeRef() {
  return process.env.CYFERS_PLUGIN_STORE_REF?.trim() || DEFAULT_REF;
}

function userAgent() {
  return "Cyfers-Desktop/1.0 (+https://github.com/Samhij/somtoday-login)";
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "user-agent": userAgent(),
        accept: "application/vnd.github+json, application/json, */*",
        // Avoid Fastly serving a stale gzip variant while identity is fresh.
        "accept-encoding": "identity",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
  } finally {
    clearTimeout(timer);
  }
}

function assertAllowedDownloadUrl(urlString: string) {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Ongeldige download-URL in catalogus.");
  }
  if (url.protocol !== "https:") throw new Error("Download-URL moet HTTPS gebruiken.");
  const host = url.hostname.toLowerCase();
  if (ALLOWED_DOWNLOAD_HOSTS.has(host) || host.endsWith(".github.io")) return;
  throw new Error(`Download-host niet toegestaan: ${host}`);
}

function parseCatalog(raw: unknown): PluginCatalog {
  if (!raw || typeof raw !== "object") throw new Error("Catalogus is ongeldig.");
  const data = raw as Record<string, unknown>;
  const pluginsRaw = data.plugins;
  if (!Array.isArray(pluginsRaw)) throw new Error("Catalogus mist plugins.");

  const plugins: StorePlugin[] = [];
  for (const item of pluginsRaw) {
    if (!item || typeof item !== "object") continue;
    try {
      const manifest = parseManifest(item);
      const row = item as Record<string, unknown>;
      const downloadUrl = String(row.downloadUrl ?? "").trim();
      const sha256 = String(row.sha256 ?? "").trim();
      const sourceUrl = String(row.sourceUrl ?? "").trim();
      plugins.push({
        ...manifest,
        ...(downloadUrl ? { downloadUrl } : {}),
        ...(sha256 ? { sha256 } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
      });
    } catch {
      // Skip broken catalog entries rather than failing the whole store.
    }
  }

  return {
    updatedAt: String(data.updatedAt ?? "").trim() || new Date().toISOString(),
    plugins,
  };
}

export async function fetchPluginCatalog(): Promise<PluginCatalog> {
  // Bust raw.githubusercontent.com CDN (max-age=300); gzip/identity can diverge after push.
  const url = new URL(catalogUrl());
  url.searchParams.set("_", String(Math.floor(Date.now() / 60_000)));
  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    throw new Error(`Catalogus laden mislukt (${response.status}).`);
  }
  const json = (await response.json()) as unknown;
  return parseCatalog(json);
}

export function findStorePlugin(catalog: PluginCatalog, id: string): StorePlugin | null {
  return catalog.plugins.find((plugin) => plugin.id === id) ?? null;
}

/** Compare dotted version strings; true when remote is newer than local. */
export function isVersionNewer(remote: string, local: string): boolean {
  const parse = (value: string) =>
    value
      .trim()
      .replace(/^v/i, "")
      .split(/[.+-]/)
      .map((part) => {
        const n = Number(part);
        return Number.isFinite(n) ? n : part;
      });
  const a = parse(remote);
  const b = parse(local);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (typeof left === "number" && typeof right === "number") {
      if (left > right) return true;
      if (left < right) return false;
      continue;
    }
    const leftStr = String(left);
    const rightStr = String(right);
    if (leftStr > rightStr) return true;
    if (leftStr < rightStr) return false;
  }
  return false;
}

type GitHubContentItem = {
  name: string;
  path: string;
  type: "file" | "dir" | string;
  download_url: string | null;
  size?: number;
};

async function listGithubDir(owner: string, repo: string, dirPath: string, ref: string): Promise<GitHubContentItem[]> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${dirPath}?ref=${encodeURIComponent(ref)}`;
  const response = await fetchWithTimeout(url);
  if (response.status === 404) throw new Error("Plugin niet gevonden in de catalogus-repo.");
  if (!response.ok) throw new Error(`GitHub inhoud laden mislukt (${response.status}).`);
  const json = (await response.json()) as unknown;
  if (!Array.isArray(json)) throw new Error("Onverwacht GitHub-antwoord.");
  return json as GitHubContentItem[];
}

async function collectPluginFiles(
  owner: string,
  repo: string,
  pluginId: string,
  ref: string,
): Promise<Array<{ relative: string; bytes: Buffer }>> {
  const root = `plugins/${pluginId}`;
  const files: Array<{ relative: string; bytes: Buffer }> = [];
  let total = 0;

  async function walk(dirPath: string) {
    const entries = await listGithubDir(owner, repo, dirPath, ref);
    for (const entry of entries) {
      if (entry.type === "dir") {
        await walk(entry.path);
        continue;
      }
      if (entry.type !== "file" || !entry.download_url) continue;
      const relative = entry.path.slice(root.length + 1);
      if (!relative || relative.includes("..")) throw new Error("Ongeldig pad in plugin.");
      if (relative !== "manifest.json" && !relative.startsWith("ui/")) {
        throw new Error(`Bestand buiten ui/ niet toegestaan: ${relative}`);
      }
      const size = Number(entry.size ?? 0);
      if (size > MAX_ZIP_BYTES || total + size > MAX_ZIP_BYTES) {
        throw new Error("Plugin-pakket is groter dan 2 MB.");
      }
      const fileRes = await fetchWithTimeout(entry.download_url);
      if (!fileRes.ok) throw new Error(`Kon ${relative} niet downloaden.`);
      const bytes = Buffer.from(await fileRes.arrayBuffer());
      total += bytes.byteLength;
      if (total > MAX_ZIP_BYTES) throw new Error("Plugin-pakket is groter dan 2 MB.");
      files.push({ relative, bytes });
    }
  }

  await walk(root);
  if (!files.some((file) => file.relative === "manifest.json")) {
    throw new Error("manifest.json ontbreekt in de plugin.");
  }
  return files;
}

async function zipPluginFiles(files: Array<{ relative: string; bytes: Buffer }>): Promise<Buffer> {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.relative, file.bytes);
  }
  const out = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  if (out.byteLength > MAX_ZIP_BYTES) throw new Error("Plugin-zip is groter dan 2 MB.");
  return out;
}

async function downloadZip(url: string, expectedSha256?: string): Promise<Buffer> {
  assertAllowedDownloadUrl(url);
  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`Download mislukt (${response.status}).`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_ZIP_BYTES) throw new Error("Plugin-zip is groter dan 2 MB.");
  if (expectedSha256) {
    const hash = createHash("sha256").update(buffer).digest("hex");
    if (hash.toLowerCase() !== expectedSha256.toLowerCase()) {
      throw new Error("SHA-256 van de download komt niet overeen.");
    }
  }
  return buffer;
}

export async function installFromStore(id: string): Promise<{
  plugin: InstalledPlugin;
  store: StorePlugin;
}> {
  const catalog = await fetchPluginCatalog();
  const store = findStorePlugin(catalog, id);
  if (!store) throw new Error("Plugin staat niet in de catalogus.");

  let buffer: Buffer;
  if (store.downloadUrl) {
    buffer = await downloadZip(store.downloadUrl, store.sha256);
  } else {
    const { owner, repo } = storeRepo();
    const files = await collectPluginFiles(owner, repo, store.id, storeRef());
    // Ensure catalog metadata matches the package we are about to install.
    const manifestFile = files.find((file) => file.relative === "manifest.json");
    if (!manifestFile) throw new Error("manifest.json ontbreekt.");
    const packageManifest = parseManifest(JSON.parse(manifestFile.bytes.toString("utf8")));
    if (packageManifest.id !== store.id) {
      throw new Error("manifest.id komt niet overeen met de catalogus.");
    }
    buffer = await zipPluginFiles(files);
  }

  const plugin = await installPluginZip(buffer);
  return { plugin, store };
}

export type StoreListing = StorePlugin & {
  installed: boolean;
  installedVersion: string | null;
  updateAvailable: boolean;
};

export function annotateCatalog(
  catalog: PluginCatalog,
  installed: PluginManifest[],
): { updatedAt: string; plugins: StoreListing[] } {
  const byId = new Map(installed.map((plugin) => [plugin.id, plugin]));
  return {
    updatedAt: catalog.updatedAt,
    plugins: catalog.plugins.map((entry) => {
      const local = byId.get(entry.id);
      return {
        ...entry,
        installed: Boolean(local),
        installedVersion: local?.version ?? null,
        updateAvailable: local ? isVersionNewer(entry.version, local.version) : false,
      };
    }),
  };
}
