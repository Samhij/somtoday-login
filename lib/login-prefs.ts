import { promises as fs } from "node:fs";
import path from "node:path";

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
  __cyfersLoginPrefsLoaded?: boolean;
  __cyfersLoginPrefsWrite?: Promise<void>;
};

function dataDir() {
  return process.env.CYFERS_DATA_DIR || path.join(process.cwd(), "data");
}

function prefsPath() {
  return path.join(dataDir(), "login-prefs.json");
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

async function ensureLoaded() {
  if (globalPrefs.__cyfersLoginPrefsLoaded) return;
  globalPrefs.__cyfersLoginPrefsLoaded = true;
  try {
    const raw = await fs.readFile(prefsPath(), "utf8");
    globalPrefs.__cyfersLoginPrefs = parsePrefs(JSON.parse(raw));
  } catch {
    globalPrefs.__cyfersLoginPrefs = null;
  }
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
