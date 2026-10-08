import * as LucideIcons from "lucide-react";
import type { PluginKind, PluginManifest, PluginNav } from "@/lib/types";

export type { PluginKind, PluginManifest, PluginNav };

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isLucideIconName(name: string): boolean {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) return false;
  const value = (LucideIcons as Record<string, unknown>)[name];
  return typeof value === "object" || typeof value === "function";
}

export function parseManifest(raw: unknown): PluginManifest {
  if (!raw || typeof raw !== "object") throw new Error("manifest.json ontbreekt of is ongeldig.");
  const data = raw as Record<string, unknown>;

  const id = String(data.id ?? "").trim();
  if (!ID_RE.test(id)) throw new Error("manifest.id moet kebab-case zijn (bijv. mijn-plugin).");

  const name = String(data.name ?? "").trim();
  if (!name) throw new Error("manifest.name is verplicht.");

  const version = String(data.version ?? "1.0.0").trim() || "1.0.0";
  const description = String(data.description ?? "").trim();
  const author = String(data.author ?? "").trim();

  const kindRaw = String(data.kind ?? "page").trim().toLowerCase();
  if (kindRaw !== "page" && kindRaw !== "widget") {
    throw new Error('manifest.kind moet "page" of "widget" zijn.');
  }
  const kind = kindRaw as PluginKind;

  const entry = String(data.entry ?? "ui/index.html").trim().replace(/^\/+/, "");
  if (!entry.startsWith("ui/") || entry.includes("..")) {
    throw new Error("manifest.entry moet onder ui/ liggen.");
  }

  const navRaw = data.nav;
  if (!navRaw || typeof navRaw !== "object") throw new Error("manifest.nav is verplicht.");
  const navObj = navRaw as Record<string, unknown>;
  const label = String(navObj.label ?? name).trim() || name;
  let icon = String(navObj.icon ?? "Puzzle").trim() || "Puzzle";
  if (!isLucideIconName(icon)) icon = "Puzzle";
  // Legacy optional field — user order prefs in the host override this.
  const order = Number.isFinite(Number(navObj.order)) ? Number(navObj.order) : 100;

  const permissions = data.permissions;
  if (!permissions || typeof permissions !== "object") {
    throw new Error("manifest.permissions is verplicht.");
  }
  const apiRaw = (permissions as { api?: unknown }).api;
  if (!Array.isArray(apiRaw)) throw new Error("manifest.permissions.api moet een lijst zijn.");
  const api = apiRaw.map((item) => String(item).trim()).filter(Boolean);
  for (const pattern of api) {
    if (!pattern.startsWith("/rest/") || pattern.includes("..")) {
      throw new Error(`Ongeldig API-pad in permissions: ${pattern}`);
    }
  }

  return {
    id,
    name,
    version,
    description,
    author,
    kind,
    entry,
    nav: { label, icon, order },
    permissions: { api },
  };
}
