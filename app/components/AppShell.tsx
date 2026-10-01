"use client";

import type { ReactNode } from "react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { GraduationCap, Puzzle, Settings2 } from "lucide-react";
import { OverviewPage } from "@/app/components/OverviewPage";
import { PluginFrame } from "@/app/components/PluginFrame";
import { resolvePluginIcon } from "@/lib/plugins/icons";
import type { PluginSessionContext } from "@/lib/somtoday";
import type { PluginKind } from "@/lib/plugins/manifest";

export type PluginSummary = {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  enabled: boolean;
  builtin: boolean;
  kind: PluginKind;
  nav: { label: string; icon: string; order: number };
  permissions: { api: string[] };
};

type Props = {
  schoolName: string;
  onSignOut: () => void;
  themeToggle: ReactNode;
};

export function AppShell({ schoolName, onSignOut, themeToggle }: Props) {
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [active, setActive] = useState<string>("__overview__");
  const [context, setContext] = useState<PluginSessionContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const loadPlugins = useCallback(async () => {
    const response = await fetch("/api/plugins");
    const payload = (await response.json()) as { plugins?: PluginSummary[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "Plugins laden mislukt.");
    setPlugins(payload.plugins ?? []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const [pluginsResponse, contextResponse] = await Promise.all([
          fetch("/api/plugins"),
          fetch("/api/plugins/context"),
        ]);
        const pluginsPayload = (await pluginsResponse.json()) as { plugins?: PluginSummary[]; error?: string };
        const contextPayload = (await contextResponse.json()) as {
          context?: PluginSessionContext;
          error?: string;
        };
        if (cancelled) return;
        if (!pluginsResponse.ok) throw new Error(pluginsPayload.error || "Plugins laden mislukt.");
        if (!contextResponse.ok) throw new Error(contextPayload.error || "Context laden mislukt.");
        setPlugins(pluginsPayload.plugins ?? []);
        setContext(contextPayload.context ?? null);
        setActive("__overview__");
      } catch (bootError) {
        if (!cancelled) setError(bootError instanceof Error ? bootError.message : "Laden mislukt.");
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  const pages = useMemo(
    () => plugins.filter((plugin) => plugin.enabled && (plugin.kind ?? "page") === "page"),
    [plugins],
  );
  const widgets = useMemo(
    () => plugins.filter((plugin) => plugin.enabled && plugin.kind === "widget"),
    [plugins],
  );

  async function togglePlugin(id: string, enabledNext: boolean) {
    setError(null);
    const response = await fetch(`/api/plugins/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: enabledNext }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error || "Bijwerken mislukt.");
      return;
    }
    await loadPlugins();
  }

  async function remove(id: string) {
    setError(null);
    const response = await fetch(`/api/plugins/${encodeURIComponent(id)}`, { method: "DELETE" });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error || "Verwijderen mislukt.");
      return;
    }
    if (active === id) setActive("__overview__");
    await loadPlugins();
  }

  async function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const input = form.elements.namedItem("file") as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/plugins", { method: "POST", body });
      const payload = (await response.json()) as { plugin?: PluginSummary; error?: string };
      if (!response.ok) throw new Error(payload.error || "Upload mislukt.");
      form.reset();
      await loadPlugins();
      if (payload.plugin?.kind === "page") setActive(payload.plugin.id);
      else setActive("__overview__");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload mislukt.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="app-shell fade-in">
      <header className="app-top">
        <div>
          <p className="brand brand-sm">Cyfers</p>
          <p className="school-chip">{schoolName}</p>
        </div>
        <div className="app-top-actions">
          {themeToggle}
          <button className="ghost" type="button" onClick={() => void onSignOut()}>
            Uitloggen
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <nav className="sidebar-nav">
            <button
              type="button"
              className={active === "__overview__" ? "nav-item active" : "nav-item"}
              onClick={() => setActive("__overview__")}
            >
              <GraduationCap size={18} strokeWidth={2} aria-hidden />
              <span>Overzicht</span>
            </button>
            {pages.map((plugin) => {
              const Icon = resolvePluginIcon(plugin.nav.icon) || Puzzle;
              return (
                <button
                  key={plugin.id}
                  type="button"
                  className={active === plugin.id ? "nav-item active" : "nav-item"}
                  onClick={() => setActive(plugin.id)}
                >
                  <Icon size={18} strokeWidth={2} aria-hidden />
                  <span>{plugin.nav.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              className={active === "__manage__" ? "nav-item active" : "nav-item"}
              onClick={() => setActive("__manage__")}
            >
              <Settings2 size={18} strokeWidth={2} aria-hidden />
              <span>Plugins</span>
            </button>
          </nav>
        </aside>

        <section className="app-main">
          {error ? <p className="error">{error}</p> : null}

          {active === "__manage__" ? (
            <div className="manage">
              <h1>Plugins</h1>
              <p className="lede">
                Upload een .zip. Pagina-plugins komen in de zijbalk; widgets alleen op Overzicht.
              </p>

              <form className="upload-form" onSubmit={(event) => void onUpload(event)}>
                <label htmlFor="plugin-file">Plugin-zip</label>
                <input id="plugin-file" name="file" type="file" accept=".zip,application/zip" required />
                <button className="primary" type="submit" disabled={uploading}>
                  {uploading ? "Bezig…" : "Installeren"}
                </button>
              </form>

              <ul className="plugin-list">
                {plugins.map((plugin) => (
                  <li key={plugin.id} className="plugin-row">
                    <div>
                      <strong>{plugin.name}</strong>
                      <p className="meta">
                        {(plugin.kind ?? "page") === "widget" ? "Widget" : "Pagina"} · {plugin.nav.label} · v
                        {plugin.version}
                        {plugin.builtin ? " · ingebouwd" : ""}
                        {plugin.author ? ` · ${plugin.author}` : ""}
                      </p>
                      {plugin.description ? <p className="meta">{plugin.description}</p> : null}
                    </div>
                    <div className="plugin-actions">
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={plugin.enabled}
                          onChange={(event) => void togglePlugin(plugin.id, event.target.checked)}
                        />
                        <span>{plugin.enabled ? "Aan" : "Uit"}</span>
                      </label>
                      {!plugin.builtin ? (
                        <button className="ghost" type="button" onClick={() => void remove(plugin.id)}>
                          Verwijderen
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {active === "__overview__" && context ? (
            <OverviewPage context={context} widgets={widgets} />
          ) : null}

          {active !== "__manage__" && active !== "__overview__" ? (
            <PluginFrame key={active} pluginId={active} context={context} />
          ) : null}
        </section>
      </div>
    </div>
  );
}
