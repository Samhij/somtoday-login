import { NextResponse } from "next/server";
import { requireStoredSession } from "@/lib/plugins/auth";
import { rateLimit } from "@/lib/plugins/rate-limit";
import { getPlugin } from "@/lib/plugins/registry";
import {
  getPluginStorageValue,
  migratePluginStorageEntries,
  removePluginStorageValue,
  setPluginStorageValue,
} from "@/lib/plugins/storage";

type StorageBody = {
  pluginId?: string;
  op?: "get" | "set" | "remove" | "migrate";
  key?: string;
  value?: string;
  entries?: Record<string, string>;
};

export async function POST(request: Request) {
  const session = await requireStoredSession();
  if (!session) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  let body: StorageBody;
  try {
    body = (await request.json()) as StorageBody;
  } catch {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const pluginId = body.pluginId?.trim();
  if (!pluginId) return NextResponse.json({ error: "pluginId is verplicht." }, { status: 400 });

  if (!rateLimit(`storage:${session.accessToken.slice(0, 12)}:${pluginId}`, 120, 60_000)) {
    return NextResponse.json({ error: "Te veel verzoeken. Probeer later opnieuw." }, { status: 429 });
  }

  const plugin = await getPlugin(pluginId);
  if (!plugin) return NextResponse.json({ error: "Plugin niet gevonden." }, { status: 404 });
  if (!plugin.enabled) return NextResponse.json({ error: "Plugin is uitgeschakeld." }, { status: 403 });

  const op = body.op;
  try {
    if (op === "get") {
      const value = await getPluginStorageValue(pluginId, String(body.key ?? ""));
      return NextResponse.json({ value });
    }
    if (op === "set") {
      await setPluginStorageValue(pluginId, String(body.key ?? ""), String(body.value ?? ""));
      return NextResponse.json({ ok: true });
    }
    if (op === "remove") {
      await removePluginStorageValue(pluginId, String(body.key ?? ""));
      return NextResponse.json({ ok: true });
    }
    if (op === "migrate") {
      const entries =
        body.entries && typeof body.entries === "object" && !Array.isArray(body.entries)
          ? body.entries
          : {};
      const sanitized: Record<string, string> = {};
      for (const [key, value] of Object.entries(entries)) {
        if (typeof value === "string") sanitized[key] = value;
      }
      const result = await migratePluginStorageEntries(pluginId, sanitized);
      return NextResponse.json({ ok: true, ...result });
    }
    return NextResponse.json({ error: "Onbekende storage-operatie." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Storage mislukt.";
    const status =
      message.includes("Ongeldig") || message.includes("te groot") || message.includes("Te veel")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
