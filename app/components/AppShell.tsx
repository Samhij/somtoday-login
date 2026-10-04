"use client";

import type { ReactNode } from "react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
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
  devPreview?: boolean;
  devLinkMode?: "symlink" | "copy" | null;
};

type DevPluginListing = {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  kind: PluginKind;
  nav: { label: string; icon: string; order: number };
  permissions: { api: string[] };
  folder: string;
  loaded: boolean;
  loadedVersion: string | null;
  linkMode: "symlink" | "copy" | null;
  enabled: boolean | null;
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

type DesktopUpdateState = {
  version: string;
  ready: boolean;
  error?: string | null;
  installing?: boolean;
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
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [storeOpen, setStoreOpen] = useState(false);
  const [active, setActive] = useState<string>("__overview__");
  const [context, setContext] = useState<PluginSessionContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [desktopUpdate, setDesktopUpdate] = useState<DesktopUpdateState | null>(null);
  const [desktopUpdateDismissed, setDesktopUpdateDismissed] = useState(false);
  const [devAvailable, setDevAvailable] = useState(false);
  const [devRoot, setDevRoot] = useState<string | null>(null);
  const [devPlugins, setDevPlugins] = useState<DevPluginListing[]>([]);
  const [devLoadingId, setDevLoadingId] = useState<string | null>(null);
  const [reloadTokens, setReloadTokens] = useState<Record<string, number>>({});

  const bumpReload = useCallback((id: string) => {
    setReloadTokens((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  }, []);

  const loadPlugins = useCallback(async () => {
    const response = await fetch("/api/plugins");
    const payload = (await response.json()) as { plugins?: PluginSummary[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "Plugins laden mislukt.");
    setPlugins(payload.plugins ?? []);
  }, []);

  const loadDevPlugins = useCallback(async () => {
    try {
      const response = await fetch("/api/plugins/dev");
      const payload = (await response.json()) as {
        available?: boolean;
        root?: string | null;
        plugins?: DevPluginListing[];
        error?: string;
      };
      if (!response.ok) {
        setDevAvailable(false);
        setDevPlugins([]);
        setDevRoot(null);
        return;
      }
      setDevAvailable(Boolean(payload.available));
      setDevRoot(payload.root ?? null);
      setDevPlugins(payload.plugins ?? []);
    } catch {
      setDevAvailable(false);
      setDevPlugins([]);
      setDevRoot(null);
    }
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
    const bridge = window.cyfersDesktop;
    if (!bridge) return;

    void bridge.getVersion().then((version) => {
      setAppVersion(version);
    });

    const unsubscribe = bridge.onUpdateEvent((event) => {
      if (event.type === "available") {
        setDesktopUpdate((prev) => ({
          version: event.version,
          ready: prev?.version === event.version ? prev.ready : false,
          error: null,
          installing: false,
        }));
        setDesktopUpdateDismissed(false);
      } else if (event.type === "downloaded") {
        setDesktopUpdate({ version: event.version, ready: true, error: null, installing: false });
        setDesktopUpdateDismissed(false);
      } else if (event.type === "error") {
        setDesktopUpdate((prev) =>
          prev
            ? { ...prev, error: event.message, installing: false }
            : { version: "?", ready: false, error: event.message, installing: false },
        );
        setDesktopUpdateDismissed(false);
      } else if (event.type === "progress") {
        setDesktopUpdate((prev) =>
          prev ? { ...prev, ready: false, error: null, installing: false } : prev,
        );
      }
    });

    void bridge.checkForUpdates();
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (active !== "__manage__") setStoreOpen(false);
  }, [active]);

  // Annotate catalog whenever the Plugins screen is shown (not only Marketplace).
  useEffect(() => {
    if (active !== "__manage__") return;
    void loadStore();
    void loadDevPlugins();
  }, [active, loadStore, loadDevPlugins]);

  // Discover preview sources on boot (dev / CYFERS_PLUGIN_DEV_DIR / sibling repo).
  useEffect(() => {
    void loadDevPlugins();
  }, [loadDevPlugins]);

  const hasDevPreview = useMemo(() => plugins.some((plugin) => plugin.devPreview), [plugins]);

  // Hot-reload preview plugins when files under the source folder change.
  useEffect(() => {
    if (!devAvailable) return;
    if (!hasDevPreview && active !== "__manage__") return;

    const source = new EventSource("/api/plugins/dev/events");
    source.addEventListener("change", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data) as { id?: string };
        if (!data.id) return;
        bumpReload(data.id);
        void loadPlugins();
        void loadDevPlugins();
      } catch {
        // ignore malformed events
      }
    });
    return () => {
      source.close();
    };
  }, [devAvailable, hasDevPreview, active, bumpReload, loadPlugins, loadDevPlugins]);

  useEffect(() => {
    if (!storeOpen) return;
    void loadStore();
  }, [storeOpen, loadStore]);

  useEffect(() => {
    if (!storeOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !installingId && !bulkUpdating) setStoreOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [storeOpen, installingId, bulkUpdating]);

  const pages = useMemo(
    () => plugins.filter((plugin) => plugin.enabled && (plugin.kind ?? "page") === "page"),
    [plugins],
  );
  const widgets = useMemo(
    () => plugins.filter((plugin) => plugin.enabled && plugin.kind === "widget"),
    [plugins],
  );

  const storeById = useMemo(
    () => new Map(storePlugins.map((entry) => [entry.id, entry])),
    [storePlugins],
  );

  const outdatedStorePlugins = useMemo(
    () => storePlugins.filter((entry) => entry.updateAvailable),
    [storePlugins],
  );

  const pluginUpdateCount = outdatedStorePlugins.length;

  const marketplaceAvailableCount = useMemo(
    () => storePlugins.filter((entry) => !entry.installed).length,
    [storePlugins],
  );

  const outdatedById = useMemo(
    () => new Set(outdatedStorePlugins.map((entry) => entry.id)),
    [outdatedStorePlugins],
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

  async function loadOrReloadDevPlugin(id: string, mode: "load" | "reload") {
    setDevLoadingId(id);
    setError(null);
    try {
      const response = await fetch(
        mode === "reload" ? "/api/plugins/dev/reload" : "/api/plugins/dev/load",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
        },
      );
      const payload = (await response.json()) as { plugin?: PluginSummary; error?: string };
      if (!response.ok) throw new Error(payload.error || (mode === "reload" ? "Herladen mislukt." : "Laden mislukt."));
      await loadPlugins();
      await loadDevPlugins();
      bumpReload(id);
      if (payload.plugin?.kind === "page") setActive(payload.plugin.id);
      else if (payload.plugin?.kind === "widget") setActive("__overview__");
    } catch (devError) {
      setError(devError instanceof Error ? devError.message : "Ontwikkelplugin laden mislukt.");
    } finally {
      setDevLoadingId(null);
    }
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

  async function postStoreInstall(id: string) {
    const response = await fetch("/api/plugins/store/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const payload = (await response.json()) as { plugin?: PluginSummary; error?: string };
    if (!response.ok) throw new Error(payload.error || "Installeren mislukt.");
  }

  async function installFromStore(entry: StoreListing) {
    if (!confirmStoreInstall(entry)) return;
    setInstallingId(entry.id);
    setStoreError(null);
    setError(null);
    try {
      await postStoreInstall(entry.id);
      await loadPlugins();
      await loadStore();
    } catch (installError) {
      const message = installError instanceof Error ? installError.message : "Installeren mislukt.";
      if (storeOpen) setStoreError(message);
      else setError(message);
    } finally {
      setInstallingId(null);
    }
  }

  async function updateAllPlugins() {
    const outdated = storePlugins.filter((entry) => entry.updateAvailable);
    if (outdated.length < 2) return;
    const names = outdated.map((entry) => `• ${entry.name} (v${entry.version})`).join("\n");
    if (
      !window.confirm(
        `Alle ${outdated.length} plugin-updates installeren?\n\n${names}\n\nBestanden en API-rechten worden vervangen; aan/uit blijft behouden.`,
      )
    ) {
      return;
    }
    setBulkUpdating(true);
    setError(null);
    setStoreError(null);
    try {
      for (const entry of outdated) {
        setInstallingId(entry.id);
        await postStoreInstall(entry.id);
      }
      await loadPlugins();
      await loadStore();
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : "Bijwerken mislukt.");
      await loadPlugins();
      await loadStore();
    } finally {
      setInstallingId(null);
      setBulkUpdating(false);
    }
  }

  function openStore() {
    setStoreError(null);
    setStoreOpen(true);
  }

  function closeStore() {
    if (installingId || bulkUpdating) return;
    setStoreOpen(false);
  }

  async function installDesktopUpdate() {
    const bridge = window.cyfersDesktop;
    if (!bridge || !desktopUpdate?.ready || desktopUpdate.installing) return;
    setDesktopUpdate((prev) => (prev ? { ...prev, installing: true, error: null } : prev));
    try {
      const result = await bridge.installUpdate();
      if (!result.ok) {
        const message = result.error || "Installeren van de update mislukt.";
        setDesktopUpdate((prev) =>
          prev ? { ...prev, installing: false, error: message } : prev,
        );
      }
      // On success the app quits/restarts; keep installing state if still alive briefly.
    } catch (installError) {
      const message =
        installError instanceof Error ? installError.message : "Installeren van de update mislukt.";
      setDesktopUpdate((prev) =>
        prev ? { ...prev, installing: false, error: message } : prev,
      );
    }
  }

  const showDesktopBanner = Boolean(desktopUpdate) && !desktopUpdateDismissed;
  const installBusy = Boolean(installingId) || bulkUpdating;

  return (
    <div className="app-shell fade-in">
      {showDesktopBanner && desktopUpdate ? (
        <div className="update-banner" role="status">
          <div className="update-banner-copy">
            <p className="update-banner-text">
              Nieuwe versie beschikbaar (v{desktopUpdate.version})
            </p>
            {desktopUpdate.error ? (
              <p className="update-banner-error">{desktopUpdate.error}</p>
            ) : null}
          </div>
          <div className="update-banner-actions">
            <button
              className="primary"
              type="button"
              disabled={!desktopUpdate.ready || Boolean(desktopUpdate.installing)}
              onClick={() => void installDesktopUpdate()}
            >
              {desktopUpdate.installing
                ? "Bezig…"
                : desktopUpdate.ready
                  ? "Installeren"
                  : "Downloaden…"}
            </button>
            <button
              className="ghost"
              type="button"
              onClick={() => setDesktopUpdateDismissed(true)}
            >
              Later
            </button>
          </div>
        </div>
      ) : null}

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
              {pluginUpdateCount > 0 ? (
                <span className="nav-badge" aria-label={`${pluginUpdateCount} updates beschikbaar`}>
                  {pluginUpdateCount}
                </span>
              ) : null}
            </button>
          </nav>
        </aside>

        <section className="app-main">
          {error ? <p className="error">{error}</p> : null}

          {active === "__manage__" ? (
            <div className="manage">
              <header className="manage-hero">
                <h1>Plugins</h1>
                <p className="lede">
                  Geïnstalleerde plugins beheren, updates zien, of iets nieuws uit de marketplace
                  installeren. Pagina-plugins komen in de zijbalk; widgets alleen op Overzicht.
                </p>
                {appVersion ? <p className="meta app-version">Cyfers v{appVersion}</p> : null}
              </header>

              <div className="manage-summary">
                <ul className="manage-stats" aria-label="Pluginoverzicht">
                  <li>
                    <strong>{plugins.length}</strong>
                    <span>geïnstalleerd</span>
                  </li>
                  <li className={pluginUpdateCount > 0 ? "manage-stat-alert" : undefined}>
                    <strong>{pluginUpdateCount}</strong>
                    <span>{pluginUpdateCount === 1 ? "update" : "updates"}</span>
                  </li>
                  <li>
                    <strong>{marketplaceAvailableCount}</strong>
                    <span>nieuw in store</span>
                  </li>
                  {devAvailable ? (
                    <li>
                      <strong>{devPlugins.length}</strong>
                      <span>ontwikkeling</span>
                    </li>
                  ) : null}
                </ul>
                <button className="primary" type="button" onClick={openStore}>
                  Marketplace openen
                </button>
              </div>

              {storeError && !storeOpen ? <p className="error">{storeError}</p> : null}

              {pluginUpdateCount > 0 ? (
                <section className="manage-section manage-section-updates" aria-labelledby="updates-heading">
                  <div className="manage-section-head">
                    <div className="manage-section-titles">
                      <h2 id="updates-heading">Updates beschikbaar</h2>
                      <p className="meta">
                        {pluginUpdateCount === 1
                          ? "Er is 1 nieuwere catalogusversie."
                          : `Er zijn ${pluginUpdateCount} nieuwere catalogusversies.`}{" "}
                        Aan/uit blijft behouden bij bijwerken.
                      </p>
                    </div>
                    {pluginUpdateCount > 1 ? (
                      <button
                        className="primary"
                        type="button"
                        disabled={installBusy}
                        onClick={() => void updateAllPlugins()}
                      >
                        {bulkUpdating ? "Bezig…" : "Alles bijwerken"}
                      </button>
                    ) : null}
                  </div>
                  <ul className="plugin-list">
                    {outdatedStorePlugins.map((entry) => {
                      const busy = installingId === entry.id;
                      const Icon = resolvePluginIcon(entry.nav.icon) || Puzzle;
                      return (
                        <li key={entry.id} className="plugin-row">
                          <div className="plugin-main">
                            <div className="plugin-title-row">
                              <Icon size={18} strokeWidth={2} aria-hidden />
                              <strong>{entry.name}</strong>
                            </div>
                            <div className="plugin-status" aria-label="Status">
                              <span className="status-chip">
                                {entry.kind === "widget" ? "Widget" : "Pagina"}
                              </span>
                              <span className="status-chip">
                                v{entry.installedVersion ?? "?"} → v{entry.version}
                              </span>
                              <span className="status-chip status-chip-update">Update</span>
                            </div>
                            {entry.description ? <p className="meta">{entry.description}</p> : null}
                          </div>
                          <div className="plugin-actions">
                            <button
                              className="primary"
                              type="button"
                              disabled={installBusy}
                              onClick={() => void installFromStore(entry)}
                            >
                              {busy ? "Bezig…" : "Bijwerken"}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ) : null}

              <section className="manage-section" aria-labelledby="installed-heading">
                <div className="manage-section-head">
                  <div className="manage-section-titles">
                    <h2 id="installed-heading">Geïnstalleerd</h2>
                    <p className="meta">Zet plugins aan of uit, of verwijder ze. Updates staan hierboven.</p>
                  </div>
                  <span className="manage-count" aria-hidden>
                    {plugins.length}
                  </span>
                </div>

                <details className="upload-details">
                  <summary>Eigen plugin-zip uploaden</summary>
                  <form className="upload-form" onSubmit={(event) => void onUpload(event)}>
                    <label htmlFor="plugin-file">Zip-bestand (max. 2 MB)</label>
                    <input
                      id="plugin-file"
                      name="file"
                      type="file"
                      accept=".zip,application/zip"
                      required
                    />
                    <button className="primary" type="submit" disabled={uploading}>
                      {uploading ? "Bezig…" : "Uploaden"}
                    </button>
                  </form>
                </details>

                {plugins.length === 0 ? (
                  <p className="empty manage-empty">
                    Nog geen plugins geïnstalleerd. Open de marketplace of upload een zip.
                  </p>
                ) : (
                  <ul className="plugin-list">
                    {plugins.map((plugin) => {
                      const listing = storeById.get(plugin.id);
                      const updateAvailable = outdatedById.has(plugin.id);
                      const Icon = resolvePluginIcon(plugin.nav.icon) || Puzzle;
                      return (
                        <li
                          key={plugin.id}
                          className={
                            plugin.enabled ? "plugin-row" : "plugin-row plugin-row-disabled"
                          }
                        >
                          <div className="plugin-main">
                            <div className="plugin-title-row">
                              <Icon size={18} strokeWidth={2} aria-hidden />
                              <strong>{plugin.name}</strong>
                            </div>
                            <div className="plugin-status" aria-label="Status">
                              <span
                                className={
                                  plugin.enabled
                                    ? "status-chip status-chip-on"
                                    : "status-chip status-chip-off"
                                }
                              >
                                {plugin.enabled ? "Aan" : "Uit"}
                              </span>
                              <span className="status-chip">
                                {(plugin.kind ?? "page") === "widget" ? "Widget" : "Pagina"}
                              </span>
                              <span className="status-chip">v{plugin.version}</span>
                              {updateAvailable && listing ? (
                                <span className="status-chip status-chip-update">
                                  Update v{listing.version}
                                </span>
                              ) : null}
                              {plugin.devPreview ? (
                                <span className="status-chip">Voorbeeld</span>
                              ) : null}
                              {plugin.builtin ? (
                                <span className="status-chip">Ingebouwd</span>
                              ) : null}
                              {plugin.author ? (
                                <span className="status-chip status-chip-quiet">{plugin.author}</span>
                              ) : null}
                            </div>
                            {plugin.description ? (
                              <p className="meta">{plugin.description}</p>
                            ) : null}
                          </div>
                          <div className="plugin-actions">
                            <label className="switch">
                              <input
                                type="checkbox"
                                checked={plugin.enabled}
                                onChange={(event) =>
                                  void togglePlugin(plugin.id, event.target.checked)
                                }
                              />
                              <span>{plugin.enabled ? "Aan" : "Uit"}</span>
                            </label>
                            {plugin.devPreview ? (
                              <button
                                className="ghost"
                                type="button"
                                disabled={Boolean(devLoadingId)}
                                onClick={() => void loadOrReloadDevPlugin(plugin.id, "reload")}
                              >
                                {devLoadingId === plugin.id ? "Bezig…" : "Herladen"}
                              </button>
                            ) : null}
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
                      );
                    })}
                  </ul>
                )}
              </section>

              <section className="manage-section manage-section-store" aria-labelledby="store-heading">
                <div className="manage-section-head">
                  <div className="manage-section-titles">
                    <h2 id="store-heading">Marketplace</h2>
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
                  <button className="primary" type="button" onClick={openStore}>
                    Openen
                  </button>
                </div>
                <p className="meta manage-store-summary">
                  {storeLoading && storePlugins.length === 0
                    ? "Catalogus laden…"
                    : storePlugins.length === 0
                      ? "Nog geen plugins in de catalogus."
                      : `${marketplaceAvailableCount} nieuw te installeren · ${storePlugins.length - marketplaceAvailableCount} al geïnstalleerd${
                          pluginUpdateCount > 0
                            ? ` · ${pluginUpdateCount} update${pluginUpdateCount === 1 ? "" : "s"}`
                            : ""
                        }.`}
                </p>
              </section>

              {devAvailable ? (
                <section className="manage-section" aria-labelledby="dev-heading">
                  <div className="manage-section-head">
                    <div className="manage-section-titles">
                      <h2 id="dev-heading">Ontwikkeling</h2>
                      <p className="meta">
                        Unpacked plugins uit <code className="dev-path">{devRoot}</code>. Laden
                        koppelt ze zonder zip; wijzigingen worden herladen (of klik Herladen).
                      </p>
                    </div>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => void loadDevPlugins()}
                      disabled={Boolean(devLoadingId)}
                    >
                      Vernieuwen
                    </button>
                  </div>
                  {devPlugins.length === 0 ? (
                    <p className="meta">Geen geldige pluginmappen gevonden.</p>
                  ) : (
                    <ul className="plugin-list">
                      {devPlugins.map((entry) => {
                        const busy = devLoadingId === entry.id;
                        const Icon = resolvePluginIcon(entry.nav.icon) || Puzzle;
                        return (
                          <li key={entry.id} className="plugin-row">
                            <div className="plugin-main">
                              <div className="plugin-title-row">
                                <Icon size={18} strokeWidth={2} aria-hidden />
                                <strong>{entry.name}</strong>
                              </div>
                              <div className="plugin-status" aria-label="Status">
                                <span
                                  className={
                                    entry.loaded
                                      ? "status-chip status-chip-on"
                                      : "status-chip status-chip-off"
                                  }
                                >
                                  {entry.loaded ? "Geladen" : "Niet geladen"}
                                </span>
                                <span className="status-chip">
                                  {(entry.kind ?? "page") === "widget" ? "Widget" : "Pagina"}
                                </span>
                                <span className="status-chip">v{entry.version}</span>
                                {entry.loaded && entry.linkMode === "symlink" ? (
                                  <span className="status-chip status-chip-quiet">Link</span>
                                ) : null}
                                {entry.loaded && entry.linkMode === "copy" ? (
                                  <span className="status-chip status-chip-quiet">Kopie</span>
                                ) : null}
                                {entry.loaded && entry.enabled === false ? (
                                  <span className="status-chip status-chip-off">Uit</span>
                                ) : null}
                                {entry.author ? (
                                  <span className="status-chip status-chip-quiet">
                                    {entry.author}
                                  </span>
                                ) : null}
                              </div>
                              {entry.description ? (
                                <p className="meta">{entry.description}</p>
                              ) : null}
                            </div>
                            <div className="plugin-actions">
                              {entry.loaded ? (
                                <button
                                  className="ghost"
                                  type="button"
                                  disabled={Boolean(devLoadingId)}
                                  onClick={() => void loadOrReloadDevPlugin(entry.id, "reload")}
                                >
                                  {busy ? "Bezig…" : "Herladen"}
                                </button>
                              ) : (
                                <button
                                  className="primary"
                                  type="button"
                                  disabled={Boolean(devLoadingId)}
                                  onClick={() => void loadOrReloadDevPlugin(entry.id, "load")}
                                >
                                  {busy ? "Bezig…" : "Laden"}
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              ) : null}
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
            <OverviewPage context={context} widgets={widgets} reloadTokens={reloadTokens} />
          ) : null}

          {active !== "__manage__" && active !== "__overview__" ? (
            <PluginFrame
              key={active}
              pluginId={active}
              context={context}
              reloadToken={reloadTokens[active] ?? 0}
            />
          ) : null}
        </section>
      </div>

      {storeOpen
        ? createPortal(
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
                      disabled={storeLoading || installBusy}
                    >
                      {storeLoading ? "Laden…" : "Vernieuwen"}
                    </button>
                    <button
                      className="ghost"
                      type="button"
                      onClick={closeStore}
                      disabled={installBusy}
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
                      const isPrimaryInstall =
                        !entry.installed || Boolean(entry.updateAvailable);
                      let actionLabel = "Installeren";
                      if (entry.updateAvailable) actionLabel = "Bijwerken";
                      else if (entry.installed) actionLabel = "Opnieuw installeren";
                      return (
                        <li key={entry.id} className="plugin-row">
                          <div className="store-plugin-main plugin-main">
                            <div className="store-plugin-title plugin-title-row">
                              <Icon size={18} strokeWidth={2} aria-hidden />
                              <strong>{entry.name}</strong>
                            </div>
                            <div className="plugin-status" aria-label="Status">
                              <span className="status-chip">
                                {entry.kind === "widget" ? "Widget" : "Pagina"}
                              </span>
                              <span className="status-chip">v{entry.version}</span>
                              {entry.installed ? (
                                <span className="status-chip status-chip-on">Geïnstalleerd</span>
                              ) : (
                                <span className="status-chip">Niet geïnstalleerd</span>
                              )}
                              {entry.updateAvailable ? (
                                <span className="status-chip status-chip-update">
                                  Update vanaf v{entry.installedVersion}
                                </span>
                              ) : null}
                              {entry.author ? (
                                <span className="status-chip status-chip-quiet">{entry.author}</span>
                              ) : null}
                            </div>
                            {entry.description ? <p className="meta">{entry.description}</p> : null}
                            {entry.permissions.api.length > 0 ? (
                              <p className="meta store-perms">
                                API: {entry.permissions.api.join(", ")}
                              </p>
                            ) : null}
                          </div>
                          <div className="plugin-actions">
                            <button
                              className={isPrimaryInstall ? "primary" : "ghost"}
                              type="button"
                              disabled={busy || installBusy}
                              onClick={() => void installFromStore(entry)}
                            >
                              {busy ? "Bezig…" : actionLabel}
                            </button>
                            {entry.sourceUrl ? (
                              <button
                                className="ghost"
                                type="button"
                                onClick={() =>
                                  window.open(entry.sourceUrl, "_blank", "noopener,noreferrer")
                                }
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
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
