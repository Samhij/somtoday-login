import { requireStoredSession } from "@/lib/plugins/auth";
import {
  refreshDevPluginAfterChange,
  resolvePluginDevRoot,
  subscribeDevPluginChanges,
} from "@/lib/plugins/dev";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await requireStoredSession();
  if (!session) {
    return new Response(JSON.stringify({ error: "Niet ingelogd." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const root = await resolvePluginDevRoot();
  if (!root) {
    return new Response(JSON.stringify({ error: "Geen ontwikkelmap beschikbaar." }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // stream already closed
        }
      };

      send("ready", { root });

      unsubscribe = subscribeDevPluginChanges((pluginId) => {
        void (async () => {
          await refreshDevPluginAfterChange(pluginId);
          send("change", { id: pluginId, at: new Date().toISOString() });
        })();
      });

      heartbeat = setInterval(() => {
        send("ping", { at: new Date().toISOString() });
      }, 25_000);

      const abort = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // ignore
        }
      };

      request.signal.addEventListener("abort", abort);
    },
    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
