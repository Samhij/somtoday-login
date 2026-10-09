import { NextResponse } from "next/server";
import { applyPluginOrderSequence } from "@/lib/plugin-order-prefs";
import { requireStoredSession } from "@/lib/plugins/auth";
import { listPlugins } from "@/lib/plugins/registry";

/**
 * Persist a drag-reorder within one kind (pages or widgets).
 * Body: `{ orderedIds: string[] }` — order index = array index.
 */
export async function PUT(request: Request) {
  const session = await requireStoredSession();
  if (!session) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  let body: { orderedIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  if (!Array.isArray(body.orderedIds) || body.orderedIds.length === 0) {
    return NextResponse.json({ error: "orderedIds (niet-lege array) is verplicht." }, { status: 400 });
  }

  const orderedIds: string[] = [];
  for (const value of body.orderedIds) {
    if (typeof value !== "string" || !value.trim()) {
      return NextResponse.json({ error: "orderedIds mag alleen plugin-id’s bevatten." }, { status: 400 });
    }
    orderedIds.push(value.trim());
  }

  if (new Set(orderedIds).size !== orderedIds.length) {
    return NextResponse.json({ error: "orderedIds bevat dubbele id’s." }, { status: 400 });
  }

  try {
    const installed = await listPlugins();
    const known = new Set(installed.map((plugin) => plugin.id));
    for (const id of orderedIds) {
      if (!known.has(id)) {
        return NextResponse.json({ error: `Plugin niet gevonden: ${id}` }, { status: 404 });
      }
    }

    await applyPluginOrderSequence(orderedIds);
    const plugins = await listPlugins();
    return NextResponse.json({ plugins });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Volgorde opslaan mislukt.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
