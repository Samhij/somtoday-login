import { NextResponse } from "next/server";
import { requireStoredSession } from "@/lib/plugins/auth";
import { normalizeApiPath, pathMatchesAllowlist } from "@/lib/plugins/match";
import { rateLimit } from "@/lib/plugins/rate-limit";
import { getPlugin } from "@/lib/plugins/registry";
import { somFetch } from "@/lib/somtoday";

const MAX_BODY = 256 * 1024;
const MAX_RESPONSE = 2 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await requireStoredSession();
  if (!session) return NextResponse.json({ error: "Niet ingelogd." }, { status: 401 });

  let body: {
    pluginId?: string;
    path?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const pluginId = body.pluginId?.trim();
  if (!pluginId) return NextResponse.json({ error: "pluginId is verplicht." }, { status: 400 });

  if (!rateLimit(`proxy:${session.accessToken.slice(0, 12)}:${pluginId}`, 60, 60_000)) {
    return NextResponse.json({ error: "Te veel verzoeken. Probeer later opnieuw." }, { status: 429 });
  }

  const plugin = await getPlugin(pluginId);
  if (!plugin) return NextResponse.json({ error: "Plugin niet gevonden." }, { status: 404 });
  if (!plugin.enabled) return NextResponse.json({ error: "Plugin is uitgeschakeld." }, { status: 403 });

  const apiPath = normalizeApiPath(body.path ?? "");
  if (!apiPath) return NextResponse.json({ error: "Ongeldig API-pad." }, { status: 400 });
  if (!pathMatchesAllowlist(apiPath, plugin.permissions.api)) {
    return NextResponse.json({ error: "Dit API-pad is niet toegestaan voor deze plugin." }, { status: 403 });
  }

  const method = (body.method ?? "GET").toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return NextResponse.json({ error: "Methode niet toegestaan." }, { status: 400 });
  }

  const headers: Record<string, string> = {};
  if (body.headers) {
    for (const [key, value] of Object.entries(body.headers)) {
      const lower = key.toLowerCase();
      if (lower === "authorization" || lower === "cookie" || lower === "host") continue;
      headers[lower] = value;
    }
  }
  if (method === "GET" && !headers.range) headers.range = "items=0-99";

  let payload: string | undefined;
  if (body.body !== undefined && method !== "GET") {
    payload = typeof body.body === "string" ? body.body : JSON.stringify(body.body);
    if (payload.length > MAX_BODY) {
      return NextResponse.json({ error: "Request body te groot." }, { status: 413 });
    }
    if (!headers["content-type"]) headers["content-type"] = "application/json";
  }

  try {
    const response = await somFetch(session, apiPath, { method, headers, body: payload });
    const text = await response.text();
    if (text.length > MAX_RESPONSE) {
      return NextResponse.json({ error: "Response te groot." }, { status: 502 });
    }

    const contentType = response.headers.get("content-type") || "";
    let data: unknown = text;
    if (!text) {
      data = null;
    } else if (contentType.includes("json") || text.startsWith("{") || text.startsWith("[")) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proxy mislukt.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
