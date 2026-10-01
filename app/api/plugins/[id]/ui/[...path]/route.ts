import { NextResponse } from "next/server";
import path from "path";
import { getPlugin, readPluginFile } from "@/lib/plugins/registry";

type Params = { params: Promise<{ id: string; path: string[] }> };

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function GET(_request: Request, { params }: Params) {
  const { id, path: segments } = await params;
  const plugin = await getPlugin(id);
  if (!plugin) return NextResponse.json({ error: "Plugin niet gevonden." }, { status: 404 });

  const relative = path.posix.join("ui", ...segments);
  try {
    const data = await readPluginFile(id, relative);
    const ext = path.extname(relative).toLowerCase();
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "content-type": TYPES[ext] || "application/octet-stream",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Bestand niet gevonden." }, { status: 404 });
  }
}
