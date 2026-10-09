import { promises as fs } from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/data-dir";

/**
 * Per-plugin sort keys under CYFERS_DATA_DIR (shared map; pages and widgets
 * are ordered independently in the UI / sidebar vs Overview).
 * Overrides legacy manifest `nav.order` when set.
 */
export type PluginOrderPrefs = {
  /** Lower numbers appear first. */
  orders: Record<string, number>;
  updatedAt: number;
};

const globalOrders = globalThis as typeof globalThis & {
  __cyfersPluginOrderPrefs?: PluginOrderPrefs;
  __cyfersPluginOrderPrefsLoad?: Promise<void>;
  __cyfersPluginOrderPrefsWrite?: Promise<void>;
};

function prefsPath() {
  return path.join(dataDir(), "plugin-order.json");
}

function emptyPrefs(): PluginOrderPrefs {
  return { orders: {}, updatedAt: Date.now() };
}

function parsePrefs(raw: unknown): PluginOrderPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyPrefs();
  const obj = raw as Record<string, unknown>;
  const ordersRaw = obj.orders;
  const orders: Record<string, number> = {};
  if (ordersRaw && typeof ordersRaw === "object" && !Array.isArray(ordersRaw)) {
    for (const [id, value] of Object.entries(ordersRaw as Record<string, unknown>)) {
      const key = id.trim();
      if (!key) continue;
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      orders[key] = Math.trunc(n);
    }
  }
  return {
    orders,
    updatedAt: typeof obj.updatedAt === "number" ? obj.updatedAt : Date.now(),
  };
}

async function loadFromDisk(): Promise<PluginOrderPrefs> {
  try {
    const raw = await fs.readFile(prefsPath(), "utf8");
    return parsePrefs(JSON.parse(raw));
  } catch {
    return emptyPrefs();
  }
}

function ensureLoaded(): Promise<void> {
  if (!globalOrders.__cyfersPluginOrderPrefsLoad) {
    globalOrders.__cyfersPluginOrderPrefsLoad = loadFromDisk()
      .then((prefs) => {
        globalOrders.__cyfersPluginOrderPrefs = prefs;
      })
      .catch((error) => {
        console.error("Pluginvolgorde laden mislukt:", error);
        globalOrders.__cyfersPluginOrderPrefs = emptyPrefs();
      });
  }
  return globalOrders.__cyfersPluginOrderPrefsLoad;
}

async function persist(prefs: PluginOrderPrefs) {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(prefsPath(), `${JSON.stringify(prefs, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function queuePersist(prefs: PluginOrderPrefs) {
  const prev = globalOrders.__cyfersPluginOrderPrefsWrite ?? Promise.resolve();
  globalOrders.__cyfersPluginOrderPrefsWrite = prev
    .then(() => persist(prefs))
    .catch((error) => {
      console.error("Pluginvolgorde opslaan mislukt:", error);
    });
  return globalOrders.__cyfersPluginOrderPrefsWrite;
}

export async function readPluginOrderPrefs(): Promise<PluginOrderPrefs> {
  await ensureLoaded();
  return globalOrders.__cyfersPluginOrderPrefs ?? emptyPrefs();
}

export async function getPluginOrderMap(): Promise<Record<string, number>> {
  const prefs = await readPluginOrderPrefs();
  return { ...prefs.orders };
}

export async function setPluginOrder(id: string, order: number): Promise<PluginOrderPrefs> {
  return setPluginOrders({ [id]: order });
}

/** Atomically merge several id → order updates (e.g. after drag-reorder). */
export async function setPluginOrders(
  updates: Record<string, number>,
): Promise<PluginOrderPrefs> {
  const entries = Object.entries(updates);
  if (entries.length === 0) {
    await ensureLoaded();
    return globalOrders.__cyfersPluginOrderPrefs ?? emptyPrefs();
  }

  await ensureLoaded();
  const current = globalOrders.__cyfersPluginOrderPrefs ?? emptyPrefs();
  const orders = { ...current.orders };
  for (const [id, order] of entries) {
    const key = id.trim();
    if (!key) throw new Error("Plugin-id ontbreekt.");
    if (!Number.isFinite(order)) throw new Error("Volgorde moet een getal zijn.");
    orders[key] = Math.trunc(order);
  }
  const prefs: PluginOrderPrefs = { orders, updatedAt: Date.now() };
  globalOrders.__cyfersPluginOrderPrefs = prefs;
  await queuePersist(prefs);
  return prefs;
}

/**
 * Assign sequential sort keys (0…n-1) for the given ids.
 * Other plugins keep their saved orders unchanged.
 */
export async function applyPluginOrderSequence(orderedIds: string[]): Promise<PluginOrderPrefs> {
  const updates: Record<string, number> = {};
  orderedIds.forEach((id, index) => {
    const key = id.trim();
    if (!key) throw new Error("Plugin-id ontbreekt.");
    updates[key] = index;
  });
  return setPluginOrders(updates);
}

/** Drop a plugin’s saved order (e.g. after uninstall). */
export async function clearPluginOrder(id: string): Promise<PluginOrderPrefs> {
  const key = id.trim();
  await ensureLoaded();
  const current = globalOrders.__cyfersPluginOrderPrefs ?? emptyPrefs();
  if (!(key in current.orders)) return current;
  const orders = { ...current.orders };
  delete orders[key];
  const prefs: PluginOrderPrefs = { orders, updatedAt: Date.now() };
  globalOrders.__cyfersPluginOrderPrefs = prefs;
  await queuePersist(prefs);
  return prefs;
}

/** Effective sort key: user preference, else legacy manifest order (default 100). */
export function resolvePluginOrder(
  id: string,
  manifestOrder: number | undefined,
  userOrders: Record<string, number>,
): number {
  if (Object.prototype.hasOwnProperty.call(userOrders, id)) {
    return userOrders[id];
  }
  return Number.isFinite(manifestOrder) ? Number(manifestOrder) : 100;
}
