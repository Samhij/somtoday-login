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
    await clearSession();
    const message = error instanceof Error ? error.message : "Log opnieuw in.";
    return NextResponse.json({ session: null, error: message }, { status: 401, headers: NO_STORE });
  }
}
