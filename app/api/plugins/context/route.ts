import { NextResponse } from "next/server";
import { requireStoredSession } from "@/lib/plugins/auth";
import { loadPluginContext } from "@/lib/somtoday";

export async function GET() {
  const session = await requireStoredSession();
  if (!session) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  try {
    const context = await loadPluginContext(session);
    return NextResponse.json({ context });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Context laden mislukt.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
