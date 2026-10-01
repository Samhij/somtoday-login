import type { LucideIcon } from "lucide-react";
import * as LucideIcons from "lucide-react";
import { Puzzle } from "lucide-react";

export function resolvePluginIcon(name: string): LucideIcon {
  const value = (LucideIcons as Record<string, unknown>)[name];
  if (typeof value === "object" || typeof value === "function") {
    return value as LucideIcon;
  }
  return Puzzle;
}
