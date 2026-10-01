"use client";

import { useEffect, useRef, useState } from "react";
import { applyPluginTheme } from "@/lib/plugins/sdk";
import type { PluginSessionContext } from "@/lib/somtoday";

type Props = {
  pluginId: string;
  context: PluginSessionContext | null;
  variant?: "page" | "widget";
};

type HostMessage = {
  source: "cyfers-plugin";
  pluginId: string;
  id: string;
  type: "getContext" | "fetch" | "storageGet" | "storageSet" | "storageRemove";
  payload: unknown;
};

function storageKey(pluginId: string, key: string) {
  return `cyfers:plugin:${pluginId}:${key}`;
}

function readHostTheme(): "light" | "dark" {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "dark" ? "dark" : "light";
}

export function PluginFrame({ pluginId, context, variant = "page" }: Props) {
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
  }, [pluginId]);

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
          reply(localStorage.getItem(storageKey(pluginId, key)));
          return;
        }
        if (data.type === "storageSet") {
          const payload = data.payload as { key?: string; value?: string };
          localStorage.setItem(storageKey(pluginId, String(payload.key ?? "")), String(payload.value ?? ""));
          reply(true);
          return;
        }
        if (data.type === "storageRemove") {
          const key = String((data.payload as { key?: string })?.key ?? "");
          localStorage.removeItem(storageKey(pluginId, key));
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
