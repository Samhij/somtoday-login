import {promises as fs} from "fs";
import path from "path";
import JSZip from "jszip";
import {parseManifest, type PluginManifest} from "./manifest";

export type PluginDevLinkMode = "symlink" | "copy";

export type InstalledPlugin = PluginManifest & {
    enabled: boolean;
    /** @deprecated No managed builtins remain; kept for index compatibility. */
    builtin?: boolean;
    installedAt: string;
    /** True when loaded from an unpacked devel directory (not zip/store). */
    devPreview?: boolean;
    /** Absolute source directory for a preview plugin. */
    devSource?: string;
    /** How the preview is linked into the registry path. */
    devLinkMode?: PluginDevLinkMode;
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

async function ensureRoot() {
    await fs.mkdir(pluginsRoot(), {recursive: true});
}

async function readIndex(): Promise<PluginIndex> {
    await ensureRoot();
    try {
        const raw = await fs.readFile(indexPath(), "utf8");
        const parsed = JSON.parse(raw) as PluginIndex;
        if (!parsed.plugins || !Array.isArray(parsed.plugins)) return {plugins: []};
        return parsed;
    } catch {
        return {plugins: []};
    }
}

async function writeIndex(index: PluginIndex) {
    await ensureRoot();
    await fs.writeFile(indexPath(), JSON.stringify(index, null, 2));
}

export function pluginDir(id: string) {
    return path.join(pluginsRoot(), id);
}

/** One-shot cleanup: drop legacy host plugins and demote former builtins so they stay installed but removable. */
async function migrateLegacyPluginIndex(): Promise<void> {
    const index = await readIndex();
    let changed = false;

    const withoutLegacy = index.plugins.filter((item) => item.id !== "core-overzicht");
    if (withoutLegacy.length !== index.plugins.length) {
        changed = true;
        await fs.rm(pluginDir("core-overzicht"), {recursive: true, force: true}).catch(() => undefined);
    }

    const plugins = withoutLegacy.map((plugin) => {
        if (!plugin.builtin) return plugin;
        changed = true;
        return {...plugin, builtin: false};
    });

    if (changed) await writeIndex({plugins});
}

export async function listPlugins(): Promise<InstalledPlugin[]> {
    await migrateLegacyPluginIndex();
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

/** @deprecated Builtins were removed; always false. */
export function isManagedBuiltin(_id: string): boolean {
    return false;
}

export async function removePlugin(id: string): Promise<void> {
    const index = await readIndex();
    const plugin = index.plugins.find((item) => item.id === id);
    if (!plugin) throw new Error("Plugin niet gevonden.");
    index.plugins = index.plugins.filter((item) => item.id !== id);
    await writeIndex(index);
    await fs.rm(pluginDir(id), {recursive: true, force: true});
}

function safeJoin(root: string, relative: string) {
    const resolved = path.resolve(root, relative);
    if (!resolved.startsWith(path.resolve(root) + path.sep) && resolved !== path.resolve(root)) {
        throw new Error("Ongeldig pad in plugin-pakket.");
    }
    return resolved;
}

async function listAllowedPluginFiles(sourceRoot: string): Promise<string[]> {
    const files: string[] = ["manifest.json"];
    const uiRoot = path.join(sourceRoot, "ui");
    async function walk(dir: string, prefix: string) {
        let entries;
        try {
            entries = await fs.readdir(dir, {withFileTypes: true});
        } catch {
            throw new Error("ui/ ontbreekt in de pluginmap.");
        }
        for (const entry of entries) {
            const relative = path.posix.join(prefix, entry.name);
            if (entry.isDirectory()) {
                await walk(path.join(dir, entry.name), relative);
            } else if (entry.isFile()) {
                files.push(relative);
            }
        }
    }
    await walk(uiRoot, "ui");
    return files;
}

async function copyPluginDirectory(sourceRoot: string, target: string): Promise<void> {
    const files = await listAllowedPluginFiles(sourceRoot);
    await fs.rm(target, {recursive: true, force: true});
    await fs.mkdir(target, {recursive: true});
    for (const relative of files) {
        if (relative.includes("..")) throw new Error("Ongeldig pad in pluginmap.");
        const dest = safeJoin(target, relative);
        await fs.mkdir(path.dirname(dest), {recursive: true});
        await fs.copyFile(path.join(sourceRoot, relative), dest);
    }
}

async function linkPluginDirectory(sourceRoot: string, target: string): Promise<PluginDevLinkMode> {
    await fs.rm(target, {recursive: true, force: true});
    await fs.mkdir(path.dirname(target), {recursive: true});
    try {
        const linkType = process.platform === "win32" ? "junction" : "dir";
        await fs.symlink(sourceRoot, target, linkType);
        return "symlink";
    } catch {
        await copyPluginDirectory(sourceRoot, target);
        return "copy";
    }
}

export type InstallFromDirectoryOptions = {
    devPreview?: boolean;
    preserveEnabled?: boolean;
};

/** Install or refresh a plugin from an unpacked directory (manifest.json + ui/). */
export async function installPluginFromDirectory(
    sourceRoot: string,
    options: InstallFromDirectoryOptions = {},
): Promise<InstalledPlugin> {
    const resolvedSource = path.resolve(sourceRoot);
    let sourceStat;
    try {
        sourceStat = await fs.stat(resolvedSource);
    } catch {
        throw new Error("Pluginmap niet gevonden.");
    }
    if (!sourceStat.isDirectory()) throw new Error("Pluginpad is geen map.");

    const manifestText = await fs.readFile(path.join(resolvedSource, "manifest.json"), "utf8");
    const manifest = parseManifest(JSON.parse(manifestText));

    const folderName = path.basename(resolvedSource);
    if (folderName !== manifest.id) {
        throw new Error(`mapnaam “${folderName}” moet gelijk zijn aan manifest.id “${manifest.id}”.`);
    }

    const files = await listAllowedPluginFiles(resolvedSource);
    if (!files.includes(manifest.entry.replace(/\\/g, "/"))) {
        throw new Error(`Entry ontbreekt: ${manifest.entry}`);
    }

    const target = pluginDir(manifest.id);
    // Never symlink the registry root onto itself.
    if (path.resolve(target) === resolvedSource) {
        throw new Error("Kan de geïnstalleerde pluginmap niet als bron gebruiken.");
    }

    const linkMode = await linkPluginDirectory(resolvedSource, target);
    const entryPath = safeJoin(target, manifest.entry);
    await fs.access(entryPath);

    const index = await readIndex();
    const existing = index.plugins.find((item) => item.id === manifest.id);
    const enabled =
        typeof options.preserveEnabled === "boolean"
            ? options.preserveEnabled
            : existing
              ? existing.enabled
              : true;

    const installed: InstalledPlugin = {
        ...manifest,
        enabled,
        builtin: false,
        installedAt: existing?.installedAt ?? new Date().toISOString(),
        devPreview: Boolean(options.devPreview),
        devSource: options.devPreview ? resolvedSource : undefined,
        devLinkMode: options.devPreview ? linkMode : undefined,
    };

    if (existing) {
        const idx = index.plugins.findIndex((item) => item.id === manifest.id);
        index.plugins[idx] = installed;
    } else {
        index.plugins.push(installed);
    }
    await writeIndex(index);
    return installed;
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
    await fs.rm(target, {recursive: true, force: true});
    await fs.mkdir(target, {recursive: true});

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
        await fs.mkdir(path.dirname(dest), {recursive: true});
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
        // Zip/store installs clear any prior preview linkage.
        devPreview: false,
        devSource: undefined,
        devLinkMode: undefined,
    };

    const index = await readIndex();
    const existing = index.plugins.findIndex((item) => item.id === manifest.id);
    if (existing >= 0) {
        installed.enabled = index.plugins[existing].enabled;
        installed.installedAt = index.plugins[existing].installedAt;
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
    return {html: buffer.toString("utf8"), entry: plugin.entry};
}
