export function normalizeApiPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  if (trimmed.includes("\\") || trimmed.includes("..")) return null;

  let pathOnly = trimmed;
  try {
    if (trimmed.startsWith("//")) return null;
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return null;
    const fake = new URL(trimmed, "https://cyfers.local");
    if (fake.hostname !== "cyfers.local") return null;
    pathOnly = fake.pathname + fake.search;
  } catch {
    return null;
  }

  if (!pathOnly.startsWith("/rest/")) return null;
  return pathOnly;
}

export function pathMatchesAllowlist(path: string, patterns: string[]): boolean {
  const normalized = normalizeApiPath(path);
  if (!normalized) return false;
  const pathname = normalized.split("?")[0];

  return patterns.some((pattern) => {
    const cleaned = pattern.trim();
    if (!cleaned.startsWith("/rest/")) return false;
    if (cleaned.includes("..")) return false;
    const regex = globToRegExp(cleaned);
    return regex.test(pathname);
  });
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    if ("\\.[]{}()+-^$|".includes(char)) {
      source += `\\${char}`;
      continue;
    }
    source += char;
  }
  source += "$";
  return new RegExp(source);
}
