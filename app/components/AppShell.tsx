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
  removable: boolean;
  kind: PluginKind;
  nav: { label: string; icon: string; order: number };
  permissions: { api: string[] };
};

type StoreListing = {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  kind: PluginKind;
  nav: { label: string; icon: string; order: number };
  permissions: { api: string[] };
  sourceUrl?: string;
  installed: boolean;
  installedVersion: string | null;
  updateAvailable: boolean;
};

type Props = {
  schoolName: string;
  onSignOut: () => void;
  themeToggle: ReactNode;
};

export function AppShell({ schoolName, onSignOut, themeToggle }: Props) {
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  const [storePlugins, setStorePlugins] = useState<StoreListing[]>([]);
  const [storeUpdatedAt, setStoreUpdatedAt] = useState<string | null>(null);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [storeOpen, setStoreOpen] = useState(false);
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

  const loadStore = useCallback(async () => {
    setStoreLoading(true);
    setStoreError(null);
    try {
      const response = await fetch("/api/plugins/store");
      const payload = (await response.json()) as {
        plugins?: StoreListing[];
        updatedAt?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "Marketplace laden mislukt.");
      setStorePlugins(payload.plugins ?? []);
      setStoreUpdatedAt(payload.updatedAt ?? null);
    } catch (storeLoadError) {
      setStoreError(storeLoadError instanceof Error ? storeLoadError.message : "Marketplace laden mislukt.");
      setStorePlugins([]);
    } finally {
      setStoreLoading(false);
    }
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

  useEffect(() => {
    if (active !== "__manage__") setStoreOpen(false);
  }, [active]);

  useEffect(() => {
    if (!storeOpen) return;
    void loadStore();
  }, [storeOpen, loadStore]);

  useEffect(() => {
    if (!storeOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !installingId) setStoreOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [storeOpen, installingId]);

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

  async function remove(id: string, name: string) {
    if (!window.confirm(`Plugin “${name}” verwijderen? Dit kan niet ongedaan worden gemaakt.`)) {
      return;
    }
    setError(null);
    const response = await fetch(`/api/plugins/${encodeURIComponent(id)}`, { method: "DELETE" });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(payload.error || "Verwijderen mislukt.");
      return;
    }
    if (active === id) setActive("__overview__");
    await loadPlugins();
    await loadStore();
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
      await loadStore();
      if (payload.plugin?.kind === "page") setActive(payload.plugin.id);
      else setActive("__overview__");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload mislukt.");
    } finally {
      setUploading(false);
    }
  }

  function confirmStoreInstall(entry: StoreListing): boolean {
    const action = entry.updateAvailable ? "bijwerken" : "installeren";
    const apis =
      entry.permissions.api.length > 0
        ? entry.permissions.api.map((path) => `• ${path}`).join("\n")
        : "• (geen API-rechten)";
    return window.confirm(
      `Plugin “${entry.name}” ${action}?\n\nDeze plugin mag de volgende Somtoday-paden gebruiken:\n${apis}`,
    );
  }

  async function installFromStore(entry: StoreListing) {
    if (!confirmStoreInstall(entry)) return;
    setInstallingId(entry.id);
    setStoreError(null);
    try {
      const response = await fetch("/api/plugins/store/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: entry.id }),
      });
      const payload = (await response.json()) as { plugin?: PluginSummary; error?: string };
      if (!response.ok) throw new Error(payload.error || "Installeren mislukt.");
      await loadPlugins();
      await loadStore();
    } catch (installError) {
      setStoreError(installError instanceof Error ? installError.message : "Installeren mislukt.");
    } finally {
      setInstallingId(null);
    }
  }

  function openStore() {
    setStoreError(null);
    setStoreOpen(true);
  }

  function closeStore() {
    if (installingId) return;
    setStoreOpen(false);
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
                Beheer je geïnstalleerde plugins of open de marketplace. Pagina-plugins komen in de
                zijbalk; widgets alleen op Overzicht.
              </p>

              <div className="manage-toolbar">
                <button className="primary" type="button" onClick={openStore}>
                  Marketplace openen
                </button>
              </div>

              <section className="manage-section">
                <h2>Geïnstalleerd</h2>
                <p className="meta">
                  Geüploade plugins kun je verwijderen; ingebouwde plugins alleen uitzetten.
                </p>

                <form className="upload-form" onSubmit={(event) => void onUpload(event)}>
                  <label htmlFor="plugin-file">Eigen plugin-zip</label>
                  <input id="plugin-file" name="file" type="file" accept=".zip,application/zip" required />
                  <button className="primary" type="submit" disabled={uploading}>
                    {uploading ? "Bezig…" : "Uploaden"}
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
                        {plugin.removable ? (
                          <button
                            className="ghost"
                            type="button"
                            onClick={() => void remove(plugin.id, plugin.name)}
                          >
                            Verwijderen
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          ) : null}

          {active === "__overview__" && !context && !error ? (
            <div className="overview">
              <header className="overview-head">
                <h1>Even geduld</h1>
                <p className="lede">Gegevens laden…</p>
              </header>
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

      {storeOpen ? (
        <div className="modal-root" role="presentation">
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Marketplace sluiten"
            onClick={closeStore}
          />
          <div
            className="modal-panel marketplace-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="marketplace-title"
          >
            <div className="modal-head">
              <div>
                <h2 id="marketplace-title">Marketplace</h2>
                <p className="meta">
                  Community-plugins van{" "}
                  <a
                    href="https://github.com/Samhij/cyfer-plugins"
                    target="_blank"
                    rel="noreferrer"
                  >
                    cyfer-plugins
                  </a>
                  {storeUpdatedAt
                    ? ` · catalogus ${new Date(storeUpdatedAt).toLocaleDateString("nl-NL")}`
                    : ""}
                  .
                </p>
              </div>
              <div className="modal-head-actions">
                <button
                  className="ghost"
                  type="button"
                  onClick={() => void loadStore()}
                  disabled={storeLoading || Boolean(installingId)}
                >
                  {storeLoading ? "Laden…" : "Vernieuwen"}
                </button>
                <button
                  className="ghost"
                  type="button"
                  onClick={closeStore}
                  disabled={Boolean(installingId)}
                >
                  Sluiten
                </button>
              </div>
            </div>

            <div className="modal-body">
              {storeError ? <p className="error">{storeError}</p> : null}
              {storeLoading && storePlugins.length === 0 ? (
                <p className="meta">Catalogus laden…</p>
              ) : null}
              {!storeLoading && !storeError && storePlugins.length === 0 ? (
                <p className="meta">Nog geen plugins in de catalogus.</p>
              ) : null}
              <ul className="plugin-list">
                {storePlugins.map((entry) => {
                  const Icon = resolvePluginIcon(entry.nav.icon) || Puzzle;
                  const busy = installingId === entry.id;
                  let actionLabel = "Installeren";
                  if (entry.updateAvailable) actionLabel = "Bijwerken";
                  else if (entry.installed) actionLabel = "Opnieuw installeren";
                  return (
                    <li key={entry.id} className="plugin-row">
                      <div className="store-plugin-main">
                        <div className="store-plugin-title">
                          <Icon size={18} strokeWidth={2} aria-hidden />
                          <strong>{entry.name}</strong>
                        </div>
                        <p className="meta">
                          {entry.kind === "widget" ? "Widget" : "Pagina"} · v{entry.version}
                          {entry.author ? ` · ${entry.author}` : ""}
                          {entry.installed
                            ? entry.updateAvailable
                              ? ` · geïnstalleerd v${entry.installedVersion}`
                              : " · geïnstalleerd"
                            : ""}
                        </p>
                        {entry.description ? <p className="meta">{entry.description}</p> : null}
                        {entry.permissions.api.length > 0 ? (
                          <p className="meta store-perms">API: {entry.permissions.api.join(", ")}</p>
                        ) : null}
                      </div>
                      <div className="plugin-actions">
                        <button
                          className="primary"
                          type="button"
                          disabled={busy || Boolean(installingId)}
                          onClick={() => void installFromStore(entry)}
                        >
                          {busy ? "Bezig…" : actionLabel}
                        </button>
                        {entry.sourceUrl ? (
                          <button
                            className="ghost"
                            type="button"
                            onClick={() => window.open(entry.sourceUrl, "_blank", "noopener,noreferrer")}
                          >
                            Bron
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
