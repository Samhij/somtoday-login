import { NextResponse } from "next/server";
import { requireStoredSession } from "@/lib/plugins/auth";
import { listDevPlugins } from "@/lib/plugins/dev";

export async function GET() {
  const session = await requireStoredSession();
  if (!session) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  try {
    const { root, plugins } = await listDevPlugins();
    return NextResponse.json({
      available: root !== null,
      root,
      plugins: plugins.map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        author: plugin.author,
        kind: plugin.kind ?? "page",
        nav: plugin.nav,
        permissions: plugin.permissions,
        folder: plugin.folder,
        loaded: plugin.loaded,
        loadedVersion: plugin.loadedVersion,
        linkMode: plugin.linkMode,
        enabled: plugin.enabled,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ontwikkelplugins laden mislukt.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
