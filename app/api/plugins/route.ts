import { NextResponse } from "next/server";
import { requireStoredSession } from "@/lib/plugins/auth";
import { installPluginZip, isManagedBuiltin, listPlugins } from "@/lib/plugins/registry";

export async function GET() {
  const session = await requireStoredSession();
  if (!session) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  try {
    const plugins = await listPlugins();
    return NextResponse.json({
      plugins: plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        author: plugin.author,
        enabled: plugin.enabled,
        builtin: Boolean(plugin.builtin),
        removable: !isManagedBuiltin(plugin.id),
        kind: plugin.kind ?? "page",
        nav: plugin.nav,
        permissions: plugin.permissions,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Plugins laden mislukt.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await requireStoredSession();
  if (!session) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Upload een .zip-bestand." }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".zip")) {
      return NextResponse.json({ error: "Alleen .zip-bestanden zijn toegestaan." }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const plugin = await installPluginZip(buffer);
    return NextResponse.json({ plugin });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Installeren mislukt.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
