"use client";

import { useEffect, useRef, useState } from "react";
import { applyPluginTheme } from "@/lib/plugins/sdk";
import type { PluginSessionContext } from "@/lib/somtoday";

type Props = {
  pluginId: string;
  context: PluginSessionContext | null;
  variant?: "page" | "widget";
  /** Bump to force re-fetch of entry HTML (dev preview hot reload). */
  reloadToken?: number;
};

type HostMessage = {
  source: "cyfers-plugin";
  pluginId: string;
  id: string;
  type: "getContext" | "fetch" | "storageGet" | "storageSet" | "storageRemove";
  payload: unknown;
};

const legacyMigrated = new Set<string>();

function legacyStoragePrefix(pluginId: string) {
  return `cyfers:plugin:${pluginId}:`;
}

/** One-shot: copy legacy browser localStorage keys into the file-backed store. */
async function migrateLegacyLocalStorage(pluginId: string): Promise<void> {
  if (legacyMigrated.has(pluginId)) return;
  legacyMigrated.add(pluginId);

  const prefix = legacyStoragePrefix(pluginId);
  const entries: Record<string, string> = {};
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const full = localStorage.key(i);
    if (!full || !full.startsWith(prefix)) continue;
    const key = full.slice(prefix.length);
    if (!key) continue;
    const value = localStorage.getItem(full);
    if (value == null) continue;
    entries[key] = value;
    keysToRemove.push(full);
  }

  if (keysToRemove.length === 0) return;

  const response = await fetch("/api/plugins/storage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pluginId, op: "migrate", entries }),
  });
  if (!response.ok) {
    // Allow retry on a later storage call.
    legacyMigrated.delete(pluginId);
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || "Storage-migratie mislukt.");
  }

  for (const full of keysToRemove) localStorage.removeItem(full);
}

async function callPluginStorage(
  pluginId: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  await migrateLegacyLocalStorage(pluginId);
  const response = await fetch("/api/plugins/storage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pluginId, ...body }),
  });
  const payload = (await response.json()) as {
    value?: string | null;
    ok?: boolean;
    error?: string;
  };
  if (!response.ok) throw new Error(payload.error || "Storage mislukt.");
  return payload;
}

function readHostTheme(): "light" | "dark" {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "dark" ? "dark" : "light";
}

export function PluginFrame({ pluginId, context, variant = "page", reloadToken = 0 }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [srcdoc, setSrcdoc] = useState("");
  const [error, setError] = useState<string | null>(null);
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError(null);
      try {
        // Best-effort: move legacy localStorage keys before the iframe talks to storage.
        await migrateLegacyLocalStorage(pluginId).catch(() => undefined);
        const response = await fetch(`/api/plugins/${encodeURIComponent(pluginId)}/entry`);
        const payload = (await response.json()) as { html?: string; error?: string };
        if (!response.ok || !payload.html) throw new Error(payload.error || "Plugin laden mislukt.");
        if (!cancelled) setSrcdoc(applyPluginTheme(payload.html, readHostTheme()));
      } catch (loadError) {
        if (!cancelled) {
          setSrcdoc("");
          setError(loadError instanceof Error ? loadError.message : "Plugin laden mislukt.");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [pluginId, reloadToken]);

  useEffect(() => {
    function pushTheme() {
      const theme = readHostTheme();
      iframeRef.current?.contentWindow?.postMessage(
        { source: "cyfers-host", type: "setTheme", theme },
        "*",
      );
    }

    const observer = new MutationObserver(pushTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [pluginId, srcdoc]);

  useEffect(() => {
    async function onMessage(event: MessageEvent) {
      const data = event.data as HostMessage;
      if (!data || data.source !== "cyfers-plugin" || data.pluginId !== pluginId) return;
      if (event.source !== iframeRef.current?.contentWindow) return;

      const reply = (result: unknown, error?: string) => {
        event.source?.postMessage(
          { source: "cyfers-host", pluginId, id: data.id, result, error },
          { targetOrigin: "*" },
        );
      };

      try {
        if (data.type === "getContext") {
          if (contextRef.current) {
            reply(contextRef.current);
            return;
          }
          const response = await fetch("/api/plugins/context");
          const payload = (await response.json()) as {
            context?: PluginSessionContext;
            error?: string;
          };
          if (!response.ok || !payload.context) {
            reply(null, payload.error || "Context laden mislukt.");
            return;
          }
          contextRef.current = payload.context;
          reply(payload.context);
          return;
        }
        if (data.type === "storageGet") {
          const key = String((data.payload as { key?: string })?.key ?? "");
          const payload = (await callPluginStorage(pluginId, { op: "get", key })) as {
            value?: string | null;
          };
          reply(payload.value ?? null);
          return;
        }
        if (data.type === "storageSet") {
          const payload = data.payload as { key?: string; value?: string };
          await callPluginStorage(pluginId, {
            op: "set",
            key: String(payload.key ?? ""),
            value: String(payload.value ?? ""),
          });
          reply(true);
          return;
        }
        if (data.type === "storageRemove") {
          const key = String((data.payload as { key?: string })?.key ?? "");
          await callPluginStorage(pluginId, { op: "remove", key });
          reply(true);
          return;
        }
        if (data.type === "fetch") {
          const payload = data.payload as {
            path?: string;
            method?: string;
            headers?: Record<string, string>;
            body?: unknown;
          };
          const response = await fetch("/api/plugins/proxy", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              pluginId,
              path: payload.path,
              method: payload.method,
              headers: payload.headers,
              body: payload.body,
            }),
          });
          const json = (await response.json()) as {
            ok?: boolean;
            status?: number;
            data?: unknown;
            error?: string;
          };
          if (!response.ok) {
            reply({ ok: false, status: response.status, error: json.error || "Proxy mislukt." });
            return;
          }
          reply(json);
          return;
        }
        reply(null, "Onbekend verzoek.");
      } catch (bridgeError) {
        reply(null, bridgeError instanceof Error ? bridgeError.message : "Bridge mislukt.");
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [pluginId]);

  // Wait for shell context when possible so the first paint is not empty.
  if (!context) return <p className="lede">Plugin laden…</p>;
  if (error) return <p className="error">{error}</p>;
  if (!srcdoc) return <p className="lede">Plugin laden…</p>;

  return (
    <iframe
      ref={iframeRef}
      className={variant === "widget" ? "plugin-frame plugin-frame-widget" : "plugin-frame"}
      title={pluginId}
      sandbox="allow-scripts allow-forms"
      srcDoc={srcdoc}
      onLoad={() => {
        iframeRef.current?.contentWindow?.postMessage(
          { source: "cyfers-host", type: "setTheme", theme: readHostTheme() },
          "*",
        );
      }}
    />
  );
}
