import type { School, SsoProvider } from "./types";

type RawProvider = {
  omschrijving?: string;
  url?: string;
};

type RawSchool = {
  uuid?: string;
  naam?: string;
  plaats?: string;
  oidcurls?: RawProvider[];
};

let cached: { at: number; schools: School[] } | null = null;

function providersFrom(raw: RawProvider[] | undefined): SsoProvider[] {
  if (!raw) return [];
  return raw
    .filter((item) => item.url)
    .map((item) => ({
      name: item.omschrijving?.trim() || "School login",
      issuer: item.url as string,
    }));
}

function schoolsFrom(data: unknown): School[] {
  const list = unwrap(data);
  return list
    .filter((school) => school.uuid && school.naam)
    .map((school) => ({
      uuid: school.uuid as string,
      naam: school.naam as string,
      plaats: school.plaats?.trim() || "",
      providers: providersFrom(school.oidcurls),
    }))
    .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
}

function unwrap(data: unknown): RawSchool[] {
  if (Array.isArray(data)) {
    const first = data[0] as { instellingen?: RawSchool[] } | RawSchool | undefined;
    if (first && "instellingen" in first && Array.isArray(first.instellingen)) {
      return first.instellingen;
    }
    return data as RawSchool[];
  }
  if (data && typeof data === "object" && "instellingen" in data) {
    const instellingen = (data as { instellingen?: RawSchool[] }).instellingen;
    if (Array.isArray(instellingen)) return instellingen;
  }
  return [];
}

export async function loadSchools(): Promise<School[]> {
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.schools;

  const response = await fetch(
    "https://raw.githubusercontent.com/NONtoday/organisaties.json/main/organisaties.json",
    {
      headers: { Accept: "application/json", "user-agent": "Mozilla/5.0" },
      next: { revalidate: 3600 },
    },
  );
  if (!response.ok) {
    throw new Error("Could not load the Somtoday school list.");
  }
  const schools = schoolsFrom(await response.json());
  cached = { at: Date.now(), schools };
  return schools;
}
