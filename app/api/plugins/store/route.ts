import { NextResponse } from "next/server";
import { requireStoredSession } from "@/lib/plugins/auth";
import { listPlugins } from "@/lib/plugins/registry";
import { annotateCatalog, fetchPluginCatalog } from "@/lib/plugins/store";

export async function GET() {
  const session = await requireStoredSession();
  if (!session) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  try {
    const [catalog, installed] = await Promise.all([fetchPluginCatalog(), listPlugins()]);
    const listing = annotateCatalog(catalog, installed);
    return NextResponse.json(listing);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Marketplace laden mislukt.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
