import { NextResponse } from "next/server";
import { requireStoredSession } from "@/lib/plugins/auth";
import { isManagedBuiltin } from "@/lib/plugins/registry";
import { installFromStore } from "@/lib/plugins/store";

export async function POST(request: Request) {
  const session = await requireStoredSession();
  if (!session) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  try {
    const body = (await request.json()) as { id?: unknown };
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id is verplicht." }, { status: 400 });
    if (isManagedBuiltin(id)) {
      return NextResponse.json(
        { error: "Ingebouwde plugins kun je niet via de marketplace overschrijven." },
        { status: 400 },
      );
    }

    const { plugin, store } = await installFromStore(id);
    return NextResponse.json({
      plugin: {
        id: plugin.id,
        name: plugin.name,
        version: plugin.version,
        description: plugin.description,
        author: plugin.author,
        enabled: plugin.enabled,
        builtin: Boolean(plugin.builtin),
        removable: true,
        kind: plugin.kind ?? "page",
        nav: plugin.nav,
        permissions: plugin.permissions,
      },
      store,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Installeren mislukt.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
