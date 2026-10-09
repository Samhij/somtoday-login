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
  nav: { label: string; icon: string; order?: number };
  permissions: { api: string[] };
  downloadUrl?: string;
  sha256?: string;
  sourceUrl?: string;
};

export type PluginCatalog = {
  updatedAt: string;
  plugins: StorePlugin[];
};

/** Canonical marketplace repo (Samhij/cyfer-plugins redirects here). */
const DEFAULT_REPO = "cyfers-somtoday/cyfer-plugins";
const DEFAULT_REF = "main";
const MAX_ZIP_BYTES = 2 * 1024 * 1024;
/** Whole-repo zipball is larger than a single plugin; cap to avoid runaway downloads. */
const MAX_ZIPBALL_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
/** Avoid hammering the GitHub Contents API when the Plugins screen refreshes. */
const CATALOG_CACHE_MS = 45_000;

const ALLOWED_DOWNLOAD_HOSTS = new Set([
  "raw.githubusercontent.com",
  "github.com",
  "objects.githubusercontent.com",
  "codeload.github.com",
  "cdn.jsdelivr.net",
]);

type CatalogCache = { at: number; catalog: PluginCatalog };
let catalogCache: CatalogCache | null = null;

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
  return "Cyfers-Desktop/1.0 (+https://github.com/cyfers-somtoday/somtoday-login)";
}

/** Optional PAT raises API limits above the unauthenticated 60/hr ceiling. */
function githubToken(): string | undefined {
  const token =
    process.env.CYFERS_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim();
  return token || undefined;
}

function githubApiHeaders(extra?: HeadersInit): HeadersInit {
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
  };
  const token = githubToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return { ...headers, ...(extra ?? {}) };
}

function isGithubRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  return response.headers.get("x-ratelimit-remaining") === "0";
}

function rateLimitMessage(response: Response): string {
  const reset = response.headers.get("x-ratelimit-reset");
  if (reset && /^\d+$/.test(reset)) {
    const seconds = Math.max(0, Number(reset) * 1000 - Date.now());
    const minutes = Math.max(1, Math.ceil(seconds / 60_000));
    return `GitHub API-limiet bereikt. Probeer over ±${minutes} min opnieuw.`;
  }
  return `GitHub inhoud laden mislukt (${response.status}).`;
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
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url: string, init?: RequestInit, retries = 1): Promise<Response> {
  let last: Response | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    last = await fetchWithTimeout(url, init);
    if (last.ok) return last;
    const retryable = last.status === 429 || last.status === 502 || last.status === 503;
    if (!retryable || attempt === retries) return last;
    const retryAfter = Number(last.headers.get("retry-after") || "0");
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 750 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return last!;
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

function rememberCatalog(catalog: PluginCatalog): PluginCatalog {
  catalogCache = { at: Date.now(), catalog };
  return catalog;
}

/** Test helper / forced refresh after install. */
export function clearPluginCatalogCache() {
  catalogCache = null;
}

/**
 * Load marketplace catalog.
 *
 * Default: GitHub Contents API (`application/vnd.github.raw`) for
 * `CYFERS_PLUGIN_STORE_REPO` / `CYFERS_PLUGIN_STORE_REF`.
 * raw.githubusercontent.com Fastly ignores query-string cache busters and can
 * serve a stale catalog for up to max-age=300 after a push — so the API is the
 * primary path. On API failure (incl. unauthenticated 60/hr 403), fall back to
 * raw then jsDelivr.
 *
 * Override: `CYFERS_PLUGIN_STORE_URL` still fetches that URL directly (no-store).
 * Optional `CYFERS_GITHUB_TOKEN` / `GITHUB_TOKEN` raises API rate limits.
 */
export async function fetchPluginCatalog(): Promise<PluginCatalog> {
  if (catalogCache && Date.now() - catalogCache.at < CATALOG_CACHE_MS) {
    return catalogCache.catalog;
  }

  const override = process.env.CYFERS_PLUGIN_STORE_URL?.trim();
  if (override) {
    const response = await fetchWithRetry(override);
    if (!response.ok) {
      throw new Error(`Catalogus laden mislukt (${response.status}).`);
    }
    return rememberCatalog(parseCatalog((await response.json()) as unknown));
  }

  const { owner, repo } = storeRepo();
  const ref = storeRef();
  const apiUrl =
    `https://api.github.com/repos/${owner}/${repo}/contents/catalog.json` +
    `?ref=${encodeURIComponent(ref)}`;
  const apiResponse = await fetchWithRetry(apiUrl, {
    headers: githubApiHeaders({ accept: "application/vnd.github.raw" }),
  });
  if (apiResponse.ok) {
    return rememberCatalog(parseCatalog((await apiResponse.json()) as unknown));
  }

  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/catalog.json`;
  const rawResponse = await fetchWithRetry(rawUrl);
  if (rawResponse.ok) {
    return rememberCatalog(parseCatalog((await rawResponse.json()) as unknown));
  }

  const jsdelivrUrl = `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${ref}/catalog.json`;
  const cdnResponse = await fetchWithRetry(jsdelivrUrl);
  if (cdnResponse.ok) {
    return rememberCatalog(parseCatalog((await cdnResponse.json()) as unknown));
  }

  if (isGithubRateLimited(apiResponse)) {
    throw new Error(rateLimitMessage(apiResponse));
  }
  throw new Error(`Catalogus laden mislukt (${apiResponse.status}).`);
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

function zipballUrl(owner: string, repo: string, ref: string): string {
  if (/^[0-9a-f]{40}$/i.test(ref)) {
    return `https://codeload.github.com/${owner}/${repo}/zip/${ref}`;
  }
  if (ref.startsWith("refs/")) {
    return `https://codeload.github.com/${owner}/${repo}/zip/${ref}`;
  }
  return `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${encodeURIComponent(ref)}`;
}

/**
 * Download the marketplace repo as one zipball and extract `plugins/<id>/`.
 * Avoids the unauthenticated Contents API (60 req/hr) that caused intermittent
 * "GitHub inhoud laden mislukt (403)" during install/update.
 */
async function collectPluginFilesFromZipball(
  owner: string,
  repo: string,
  pluginId: string,
  ref: string,
): Promise<Array<{ relative: string; bytes: Buffer }>> {
  const url = zipballUrl(owner, repo, ref);
  assertAllowedDownloadUrl(url);
  const response = await fetchWithRetry(url, {
    headers: { accept: "application/zip, application/octet-stream, */*" },
  });
  if (response.status === 404) {
    throw new Error("Plugin-repo of branch niet gevonden.");
  }
  if (!response.ok) {
    if (isGithubRateLimited(response)) throw new Error(rateLimitMessage(response));
    throw new Error(`GitHub zipball laden mislukt (${response.status}).`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_ZIPBALL_BYTES) {
    throw new Error("Marketplace-zip is te groot.");
  }

  const zip = await JSZip.loadAsync(buffer);
  const rootPrefix = `plugins/${pluginId}/`;
  const files: Array<{ relative: string; bytes: Buffer }> = [];
  let total = 0;

  for (const [entryPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const marker = entryPath.indexOf(rootPrefix);
    if (marker === -1) continue;
    // Require a path segment boundary before plugins/<id>/ (zip root folder).
    if (marker > 0 && entryPath[marker - 1] !== "/") continue;
    const relative = entryPath.slice(marker + rootPrefix.length);
    if (!relative || relative.includes("..")) throw new Error("Ongeldig pad in plugin.");
    if (relative !== "manifest.json" && !relative.startsWith("ui/")) {
      throw new Error(`Bestand buiten ui/ niet toegestaan: ${relative}`);
    }
    const bytes = Buffer.from(await entry.async("uint8array"));
    total += bytes.byteLength;
    if (total > MAX_ZIP_BYTES) throw new Error("Plugin-pakket is groter dan 2 MB.");
    files.push({ relative, bytes });
  }

  if (!files.some((file) => file.relative === "manifest.json")) {
    throw new Error("Plugin niet gevonden in de catalogus-repo.");
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
  const response = await fetchWithRetry(url);
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
    const files = await collectPluginFilesFromZipball(owner, repo, store.id, storeRef());
    // Ensure catalog metadata matches the package we are about to install.
    const manifestFile = files.find((file) => file.relative === "manifest.json");
    if (!manifestFile) throw new Error("manifest.json ontbreekt.");
    const packageManifest = parseManifest(JSON.parse(manifestFile.bytes.toString("utf8")));
    if (packageManifest.id !== store.id) {
      throw new Error("manifest.id komt niet overeen met de catalogus.");
    }
    buffer = await zipPluginFiles(files);
  }

  // Fresh catalog next marketplace open so updateAvailable reflects the install.
  clearPluginCatalogCache();
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
