import { readSession, type StoredSession } from "@/lib/session";

export async function requireStoredSession(): Promise<StoredSession | null> {
  return readSession();
}
