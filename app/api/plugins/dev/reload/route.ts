import { NextResponse } from "next/server";
import { requireStoredSession } from "@/lib/plugins/auth";
import { reloadDevPlugin } from "@/lib/plugins/dev";

export async function POST(request: Request) {
  const session = await requireStoredSession();
  if (!session) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const id = String(body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "id is verplicht." }, { status: 400 });

  try {
    const plugin = await reloadDevPlugin(id);
    return NextResponse.json({ plugin });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Herladen mislukt.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
