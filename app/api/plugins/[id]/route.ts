import { NextResponse } from "next/server";
import { requireStoredSession } from "@/lib/plugins/auth";
import { setPluginOrder } from "@/lib/plugin-order-prefs";
import { getPlugin, removePlugin, setPluginEnabled } from "@/lib/plugins/registry";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const session = await requireStoredSession();
  if (!session) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const { id } = await params;
  const plugin = await getPlugin(id);
  if (!plugin) return NextResponse.json({ error: "Plugin niet gevonden." }, { status: 404 });
  return NextResponse.json({ plugin });
}

export async function PATCH(request: Request, { params }: Params) {
  const session = await requireStoredSession();
  if (!session) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const { id } = await params;
  let body: { enabled?: boolean; order?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const hasEnabled = typeof body.enabled === "boolean";
  const hasOrder = typeof body.order === "number" && Number.isFinite(body.order);
  if (!hasEnabled && !hasOrder) {
    return NextResponse.json(
      { error: "enabled (boolean) en/of order (number) is verplicht." },
      { status: 400 },
    );
  }

  try {
    const existing = await getPlugin(id);
    if (!existing) {
      return NextResponse.json({ error: "Plugin niet gevonden." }, { status: 404 });
    }

    if (hasEnabled) {
      await setPluginEnabled(id, body.enabled!);
    }
    if (hasOrder) {
      await setPluginOrder(id, body.order!);
    }

    const plugin = await getPlugin(id);
    return NextResponse.json({ plugin });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bijwerken mislukt.";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const session = await requireStoredSession();
  if (!session) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  const { id } = await params;
  try {
    await removePlugin(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Verwijderen mislukt.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
