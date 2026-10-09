import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { dataDir } from "@/lib/data-dir";
import type { SessionInfo } from "./types";

export type StoredSession = {
  accessToken: string;
  refreshToken: string;
  apiUrl: string;
  expiresAt: number;
  schoolName: string;
  tenant: string | null;
};

type SessionStore = Map<string, StoredSession>;

const globalStore = globalThis as typeof globalThis & {
  __somSessions?: SessionStore;
  __somSessionsLoadPromise?: Promise<void>;
  __somSessionsWrite?: Promise<void>;
};

function sessionsPath() {
  return path.join(dataDir(), "sessions.enc");
}

function deriveKey() {
  const raw = process.env.CYFERS_SESSION_KEY;
  if (!raw) return null;
  return createHash("sha256").update(raw).digest();
}

function encrypt(plaintext: string): Buffer {
  const key = deriveKey();
  if (!key) return Buffer.from(plaintext, "utf8");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("v1"), iv, tag, encrypted]);
}

function decrypt(payload: Buffer): string {
  const key = deriveKey();
  if (!key) return payload.toString("utf8");
  if (payload.length < 3 + 12 + 16 || payload.subarray(0, 2).toString("utf8") !== "v1") {
    throw new Error("Ongeldig sessiebestand.");
  }
  const iv = payload.subarray(2, 14);
  const tag = payload.subarray(14, 30);
  const encrypted = payload.subarray(30);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

async function persist() {
  const entries = [...store().entries()];
  await fs.mkdir(dataDir(), { recursive: true });
  const json = JSON.stringify(Object.fromEntries(entries));
  await fs.writeFile(sessionsPath(), encrypt(json), { mode: 0o600 });
}

function queuePersist() {
  const prev = globalStore.__somSessionsWrite ?? Promise.resolve();
  globalStore.__somSessionsWrite = prev
    .then(() => persist())
    .catch((error) => {
      console.error("Sessie opslaan mislukt:", error);
    });
  return globalStore.__somSessionsWrite;
}

async function loadFromDisk() {
  if (!globalStore.__somSessions) globalStore.__somSessions = new Map();
  try {
    const raw = await fs.readFile(sessionsPath());
    const parsed = JSON.parse(decrypt(raw)) as Record<string, StoredSession>;
    for (const [id, session] of Object.entries(parsed)) {
      if (session?.accessToken && session?.refreshToken) {
        // Prefer in-memory tokens when already present (may be newer than disk).
        if (!globalStore.__somSessions.has(id)) {
          globalStore.__somSessions.set(id, session);
        }
      }
    }
  } catch {
    // missing or corrupt file — start empty
  }
}

async function ensureLoaded() {
  if (!globalStore.__somSessionsLoadPromise) {
    globalStore.__somSessionsLoadPromise = loadFromDisk();
  }
  await globalStore.__somSessionsLoadPromise;
}

/**
 * Cookie id present but missing from the in-memory map (e.g. after a partial
 * clear or a failed first-load race). Re-read disk once so Ctrl+R / plugin
 * fetches can recover without a full app restart.
 */
async function rehydrateMissing(id: string): Promise<StoredSession | null> {
  if (store().has(id)) return store().get(id) ?? null;
  try {
    const raw = await fs.readFile(sessionsPath());
    const parsed = JSON.parse(decrypt(raw)) as Record<string, StoredSession>;
    const session = parsed[id];
    if (session?.accessToken && session?.refreshToken) {
      store().set(id, session);
      return session;
    }
  } catch {
    // ignore
  }
  return null;
}

function store(): SessionStore {
  if (!globalStore.__somSessions) globalStore.__somSessions = new Map();
  return globalStore.__somSessions;
}

const COOKIE = "som_sid";

function cookieSecure() {
  if (process.env.CYFERS_DESKTOP === "1") return false;
  return process.env.NODE_ENV === "production";
}

export async function readSession(): Promise<StoredSession | null> {
  await ensureLoaded();
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (!id) return null;
  return store().get(id) ?? (await rehydrateMissing(id));
}

export async function writeSession(session: StoredSession): Promise<void> {
  await ensureLoaded();
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  const id = existing && store().has(existing) ? existing : crypto.randomUUID();
  store().set(id, session);
  jar.set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: cookieSecure(),
    maxAge: 60 * 60 * 24 * 45,
  });
  await queuePersist();
}

export async function updateSession(session: StoredSession): Promise<void> {
  await ensureLoaded();
  const jar = await cookies();
  let id = jar.get(COOKIE)?.value;
  // After long async work (token refresh), cookies() can occasionally lack the
  // request jar. Fall back to the map entry that already holds this object.
  if (!id) {
    for (const [key, value] of store().entries()) {
      if (value === session) {
        id = key;
        break;
      }
    }
  }
  if (!id) return;
  store().set(id, session);
  await queuePersist();
}

export async function clearSession(): Promise<void> {
  await ensureLoaded();
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (id) store().delete(id);
  jar.delete(COOKIE);
  await queuePersist();
}

export type { SessionInfo };
