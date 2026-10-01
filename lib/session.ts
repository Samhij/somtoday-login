import { cookies } from "next/headers";
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

const globalStore = globalThis as typeof globalThis & { __somSessions?: SessionStore };

function store(): SessionStore {
  if (!globalStore.__somSessions) globalStore.__somSessions = new Map();
  return globalStore.__somSessions;
}

const COOKIE = "som_sid";

export async function readSession(): Promise<StoredSession | null> {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (!id) return null;
  return store().get(id) ?? null;
}

export async function writeSession(session: StoredSession): Promise<void> {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  const id = existing && store().has(existing) ? existing : crypto.randomUUID();
  store().set(id, session);
  jar.set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 45,
  });
}

export async function updateSession(session: StoredSession): Promise<void> {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (!id) return;
  store().set(id, session);
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (id) store().delete(id);
  jar.delete(COOKIE);
}

export type { SessionInfo };
