import { NextResponse } from "next/server";
import { requireStoredSession } from "@/lib/plugins/auth";
import { getPlugin, readPluginEntryHtml } from "@/lib/plugins/registry";
import { rewritePluginHtml } from "@/lib/plugins/sdk";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await requireStoredSession();
  if (!session) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const { id } = await params;
  const plugin = await getPlugin(id);
  if (!plugin) return NextResponse.json({ error: "Plugin niet gevonden." }, { status: 404 });
  if (!plugin.enabled) return NextResponse.json({ error: "Plugin is uitgeschakeld." }, { status: 403 });

  try {
    const { html, entry } = await readPluginEntryHtml(id);
    const rewritten = rewritePluginHtml(html, id, entry);
    return NextResponse.json({ html: rewritten });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Entry laden mislukt.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}
