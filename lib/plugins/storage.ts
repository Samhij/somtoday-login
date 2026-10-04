import { promises as fs } from "fs";
import path from "path";

/** Per-plugin string KV bag on disk under CYFERS_DATA_DIR/plugin-storage/<id>.json */
export type PluginStorageBag = Record<string, string>;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY_RE = /^[A-Za-z0-9_.:@-]{1,256}$/;
const MAX_VALUE_BYTES = 512 * 1024;
const MAX_KEYS = 500;

const writeChains = new Map<string, Promise<unknown>>();

function dataRoot() {
  return process.env.CYFERS_DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), "data");
}

function storageRoot() {
  return path.join(dataRoot(), "plugin-storage");
}

export function pluginStoragePath(pluginId: string) {
  return path.join(storageRoot(), `${pluginId}.json`);
}

export function assertPluginStorageId(pluginId: string): string {
  const id = pluginId.trim();
  if (!ID_RE.test(id)) throw new Error("Ongeldige plugin-id.");
  return id;
}

export function assertStorageKey(key: string): string {
  const k = String(key ?? "");
  if (!KEY_RE.test(k)) throw new Error("Ongeldige storage-sleutel.");
  return k;
}

export function assertStorageValue(value: string): string {
  const v = String(value ?? "");
  if (Buffer.byteLength(v, "utf8") > MAX_VALUE_BYTES) {
    throw new Error("Storage-waarde te groot.");
  }
  return v;
}

async function withPluginLock<T>(pluginId: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(pluginId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  writeChains.set(
    pluginId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

async function readBagUnlocked(pluginId: string): Promise<PluginStorageBag> {
  try {
    const raw = await fs.readFile(pluginStoragePath(pluginId), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: PluginStorageBag = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && KEY_RE.test(key)) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

async function writeBagUnlocked(pluginId: string, bag: PluginStorageBag): Promise<void> {
  await fs.mkdir(storageRoot(), { recursive: true });
  const keys = Object.keys(bag);
  if (keys.length > MAX_KEYS) throw new Error("Te veel storage-sleutels.");
  await fs.writeFile(pluginStoragePath(pluginId), `${JSON.stringify(bag, null, 2)}\n`, "utf8");
}

export async function getPluginStorageValue(pluginId: string, key: string): Promise<string | null> {
  const id = assertPluginStorageId(pluginId);
  const k = assertStorageKey(key);
  return withPluginLock(id, async () => {
    const bag = await readBagUnlocked(id);
    return bag[k] ?? null;
  });
}

export async function setPluginStorageValue(
  pluginId: string,
  key: string,
  value: string,
): Promise<void> {
  const id = assertPluginStorageId(pluginId);
  const k = assertStorageKey(key);
  const v = assertStorageValue(value);
  await withPluginLock(id, async () => {
    const bag = await readBagUnlocked(id);
    bag[k] = v;
    await writeBagUnlocked(id, bag);
  });
}

export async function removePluginStorageValue(pluginId: string, key: string): Promise<void> {
  const id = assertPluginStorageId(pluginId);
  const k = assertStorageKey(key);
  await withPluginLock(id, async () => {
    const bag = await readBagUnlocked(id);
    if (!(k in bag)) return;
    delete bag[k];
    await writeBagUnlocked(id, bag);
  });
}

/**
 * Merge legacy browser localStorage entries into the on-disk bag.
 * Existing file keys win; missing keys are filled from `entries`.
 */
export async function migratePluginStorageEntries(
  pluginId: string,
  entries: Record<string, string>,
): Promise<{ migrated: number }> {
  const id = assertPluginStorageId(pluginId);
  return withPluginLock(id, async () => {
    const bag = await readBagUnlocked(id);
    let migrated = 0;
    for (const [rawKey, rawValue] of Object.entries(entries)) {
      let key: string;
      let value: string;
      try {
        key = assertStorageKey(rawKey);
        value = assertStorageValue(rawValue);
      } catch {
        continue;
      }
      if (key in bag) continue;
      bag[key] = value;
      migrated += 1;
    }
    if (migrated > 0) await writeBagUnlocked(id, bag);
    return { migrated };
  });
}
