import { NextResponse } from "next/server";
import { clearSession, readSession } from "@/lib/session";
import { loadSessionInfo } from "@/lib/somtoday";

export const dynamic = "force-dynamic";

const NO_STORE = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
};

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ session: null }, { headers: NO_STORE });

  try {
    const info = await loadSessionInfo(session);
    return NextResponse.json({ session: info }, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Log opnieuw in.";
    // Only wipe the stored session on definitive auth failure. Transient
    // network / API blips must not force a re-login (and Ctrl+R used to make
    // that worse by clearing a still-recoverable session).
    const expired = /sessie is verlopen|opnieuw in/i.test(message);
    if (expired) await clearSession();
    return NextResponse.json({ session: null, error: message }, { status: 401, headers: NO_STORE });
  }
}
