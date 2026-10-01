import { NextResponse } from "next/server";
import { clearSession, readSession } from "@/lib/session";
import { loadSessionInfo } from "@/lib/somtoday";

export async function GET() {
  const session = await readSession();
  if (!session) return NextResponse.json({ session: null });

  try {
    const info = await loadSessionInfo(session);
    return NextResponse.json({ session: info });
  } catch (error) {
    await clearSession();
    const message = error instanceof Error ? error.message : "Log opnieuw in.";
    return NextResponse.json({ session: null, error: message }, { status: 401 });
  }
}
