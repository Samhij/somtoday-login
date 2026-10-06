import { promises as fs } from "node:fs";
import path from "node:path";
import { dataDir } from "@/lib/data-dir";

/** Non-secret last-login hints under CYFERS_DATA_DIR (never passwords). */
export type LoginPrefs = {
  schoolUuid: string;
  schoolName: string;
  schoolPlace: string;
  username: string;
  /** Hint from method detection: SSO-only schools vs password form. */
  method: "sso" | "password";
  updatedAt: number;
};

const globalPrefs = globalThis as typeof globalThis & {
  __cyfersLoginPrefs?: LoginPrefs | null;
  __cyfersLoginPrefsLoad?: Promise<void>;
  __cyfersLoginPrefsWrite?: Promise<void>;
};

function prefsPath() {
  return path.join(dataDir(), "login-prefs.json");
}

/** Possible leftover path when CYFERS_DATA_DIR was missing (inside .app / cwd). */
function orphanPrefsPath() {
  return path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "login-prefs.json");
}

function isMethod(value: unknown): value is "sso" | "password" {
  return value === "sso" || value === "password";
}

function parsePrefs(raw: unknown): LoginPrefs | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const schoolUuid = typeof obj.schoolUuid === "string" ? obj.schoolUuid.trim() : "";
  const schoolName = typeof obj.schoolName === "string" ? obj.schoolName.trim() : "";
  const username = typeof obj.username === "string" ? obj.username.trim() : "";
  if (!schoolUuid || !schoolName || !username || !isMethod(obj.method)) return null;
  return {
    schoolUuid,
    schoolName,
    schoolPlace: typeof obj.schoolPlace === "string" ? obj.schoolPlace : "-",
    username,
    method: obj.method,
    updatedAt: typeof obj.updatedAt === "number" ? obj.updatedAt : Date.now(),
  };
}

async function readPrefsFile(filePath: string): Promise<LoginPrefs | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return parsePrefs(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function loadFromDisk(): Promise<LoginPrefs | null> {
  const primary = await readPrefsFile(prefsPath());
  if (primary) return primary;

  // Migrate prefs written under cwd/data (bundle/standalone) into userData.
  const orphanPath = orphanPrefsPath();
  if (path.resolve(orphanPath) === path.resolve(prefsPath())) return null;
  const orphan = await readPrefsFile(orphanPath);
  if (!orphan) return null;
  try {
    await fs.mkdir(dataDir(), { recursive: true });
    await fs.writeFile(prefsPath(), `${JSON.stringify(orphan, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.unlink(orphanPath).catch(() => undefined);
  } catch (error) {
    console.error("Loginvoorkeuren migreren mislukt:", error);
  }
  return orphan;
}

function ensureLoaded(): Promise<void> {
  if (!globalPrefs.__cyfersLoginPrefsLoad) {
    globalPrefs.__cyfersLoginPrefsLoad = loadFromDisk()
      .then((prefs) => {
        globalPrefs.__cyfersLoginPrefs = prefs;
      })
      .catch((error) => {
        console.error("Loginvoorkeuren laden mislukt:", error);
        globalPrefs.__cyfersLoginPrefs = null;
      });
  }
  return globalPrefs.__cyfersLoginPrefsLoad;
}

async function persist(prefs: LoginPrefs | null) {
  await fs.mkdir(dataDir(), { recursive: true });
  if (!prefs) {
    try {
      await fs.unlink(prefsPath());
    } catch {
      // missing is fine
    }
    return;
  }
  await fs.writeFile(prefsPath(), `${JSON.stringify(prefs, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

function queuePersist(prefs: LoginPrefs | null) {
  const prev = globalPrefs.__cyfersLoginPrefsWrite ?? Promise.resolve();
  globalPrefs.__cyfersLoginPrefsWrite = prev
    .then(() => persist(prefs))
    .catch((error) => {
      console.error("Loginvoorkeuren opslaan mislukt:", error);
    });
  return globalPrefs.__cyfersLoginPrefsWrite;
}

export async function readLoginPrefs(): Promise<LoginPrefs | null> {
  await ensureLoaded();
  return globalPrefs.__cyfersLoginPrefs ?? null;
}

export async function writeLoginPrefs(input: {
  schoolUuid: string;
  schoolName: string;
  schoolPlace?: string;
  username: string;
  method: "sso" | "password";
}): Promise<LoginPrefs> {
  await ensureLoaded();
  const prefs: LoginPrefs = {
    schoolUuid: input.schoolUuid.trim(),
    schoolName: input.schoolName.trim(),
    schoolPlace: (input.schoolPlace ?? "-").trim() || "-",
    username: input.username.trim(),
    method: input.method,
    updatedAt: Date.now(),
  };
  if (!prefs.schoolUuid || !prefs.schoolName || !prefs.username) {
    throw new Error("School en gebruikersnaam zijn verplicht.");
  }
  globalPrefs.__cyfersLoginPrefs = prefs;
  await queuePersist(prefs);
  return prefs;
}

export async function clearLoginPrefs(): Promise<void> {
  await ensureLoaded();
  globalPrefs.__cyfersLoginPrefs = null;
  await queuePersist(null);
}
