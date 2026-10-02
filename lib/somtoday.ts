import http from "node:http";
import https from "node:https";
import { captureAuthorizationCode } from "./browser-sso";
import type {
  GradeInfo,
  SessionInfo,
  SomtodayGrade,
  SomtodayListResponse,
  SomtodaySchooljaar,
  SomtodayStudent,
  StudentInfo,
} from "./types";
import { updateSession, type StoredSession } from "./session";

const CLIENT_ID = "somtoday-leerling-web";
const REDIRECT_URI = "https://leerling.somtoday.nl/oauth/callback";
const USER_FIELD = "usernameFieldPanel:usernameFieldPanel_body:usernameField";
const PASS_FIELD = "passwordFieldPanel:passwordFieldPanel_body:passwordField";
const BROWSER = "Mozilla/5.0";

export type DetectedSignIn = {
  hasPassword: boolean;
  providers: string[];
};

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  somtoday_api_url: string;
  somtoday_tenant?: string;
  expires_in?: number;
};

class CookieJar {
  private cookies = new Map<string, string>();

  absorb(response: Response) {
    const setCookies =
      typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
    for (const raw of setCookies) {
      const pair = raw.split(";")[0];
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

function absolute(location: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(location)) return location;
  return new URL(location, "https://inloggen.somtoday.nl").toString();
}

function locationOf(response: Response) {
  const location = response.headers.get("location");
  return location ? absolute(location) : null;
}

function decodeHtml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function callbackCode(location: string | null) {
  if (!location) return null;
  try {
    return new URL(location).searchParams.get("code");
  } catch {
    const match = location.match(/[?&]code=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}

function isExternalLogin(location: string) {
  try {
    const host = new URL(location).hostname;
    return host !== "inloggen.somtoday.nl" && host !== "leerling.somtoday.nl";
  } catch {
    return false;
  }
}

async function raw(url: string, init: RequestInit, jar: CookieJar) {
  const headers = new Headers(init.headers);
  const cookie = jar.header();
  if (cookie) headers.set("cookie", cookie);
  headers.set("user-agent", BROWSER);
  if (!headers.has("accept")) headers.set("accept", "text/html,application/json");
  const response = await fetch(url, { ...init, headers, redirect: "manual" });
  jar.absorb(response);
  return response;
}

async function postForm(url: string, fields: Record<string, string>, jar: CookieJar) {
  return raw(
    url,
    {
      method: "POST",
      headers: {
        origin: "https://inloggen.somtoday.nl",
        referer: "https://inloggen.somtoday.nl/",
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(fields),
    },
    jar,
  );
}

type LoginPage = {
  url: string;
  action: string;
  hasUsername: boolean;
  hasPassword: boolean;
  providers: string[];
  error: string | null;
};

function parseLoginPage(pageUrl: string, html: string): LoginPage {
  const documentHtml = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  const form = documentHtml.match(/<form[^>]*id="signInForm"[^>]*>/i)?.[0] ?? documentHtml.match(/<form[^>]*>/i)?.[0];
  const actionAttr = form?.match(/action="([^"]+)"/i)?.[1];
  const action = actionAttr ? new URL(decodeHtml(actionAttr), pageUrl).toString() : pageUrl;
  const providers = [
    ...documentHtml.matchAll(/<a[^>]*href="[^"]*ssoLink[^"]*"[^>]*>\s*<span>([^<]+)<\/span>/gi),
  ].map((match) => decodeHtml(match[1]).trim());
  const error = documentHtml.match(/feedbackPanelERROR[\s\S]*?<span>([^<]+)<\/span>/i)?.[1]?.trim() ?? null;
  return {
    url: pageUrl,
    action,
    hasUsername: documentHtml.includes(USER_FIELD),
    hasPassword: documentHtml.includes(PASS_FIELD),
    providers: providers.filter(Boolean),
    error: error ? decodeHtml(error) : null,
  };
}

async function openLogin(tenantUuid: string, jar: CookieJar) {
  const authorize = new URL("https://inloggen.somtoday.nl/oauth2/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", CLIENT_ID);
  authorize.searchParams.set("redirect_uri", REDIRECT_URI);
  authorize.searchParams.set("scope", "openid");
  authorize.searchParams.set("tenant_uuid", tenantUuid);
  authorize.searchParams.set("session", "no_session");
  authorize.searchParams.set("prompt", "login");

  let current = authorize.toString();
  for (let hop = 0; hop < 8; hop += 1) {
    const response = await raw(current, { method: "GET" }, jar);
    const location = locationOf(response);
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    const html = await response.text();
    if (!response.ok) throw new Error("Inlogpagina openen mislukt.");
    return parseLoginPage(current, html);
  }
  throw new Error("Inlogpagina openen mislukt.");
}

async function chase(response: Response, jar: CookieJar, baseUrl: string) {
  let currentResponse = response;
  let currentUrl = baseUrl;
  for (let hop = 0; hop < 8; hop += 1) {
    const location = locationOf(currentResponse);
    if (currentResponse.status >= 300 && currentResponse.status < 400 && location) {
      if (callbackCode(location) || isExternalLogin(location)) {
        return { location, html: null as string | null, url: location };
      }
      currentUrl = new URL(location, currentUrl).toString();
      currentResponse = await raw(currentUrl, { method: "GET" }, jar);
      continue;
    }
    return { location: null as string | null, html: await currentResponse.text(), url: currentUrl };
  }
  return { location: null as string | null, html: null as string | null, url: currentUrl };
}

const detectedCache = new Map<string, { at: number; method: DetectedSignIn }>();

export async function detectSignIn(tenantUuid: string): Promise<DetectedSignIn> {
  const cached = detectedCache.get(tenantUuid);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.method;
  const page = await openLogin(tenantUuid, new CookieJar());
  const method = { hasPassword: page.hasPassword, providers: page.providers };
  detectedCache.set(tenantUuid, { at: Date.now(), method });
  return method;
}

async function exchangeCode(code: string): Promise<TokenResponse> {
  const response = await fetch("https://inloggen.somtoday.nl/oauth2/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
      "user-agent": BROWSER,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    | (TokenResponse & { error?: string; error_description?: string })
    | null;
  if (response.ok && payload?.access_token && payload.refresh_token) return payload;
  throw new Error(payload?.error_description || payload?.error || "Inlogcode geweigerd.");
}

async function loginThroughSchoolProvider(tenantUuid: string, username: string) {
  const code = await captureAuthorizationCode(tenantUuid, username);
  return exchangeCode(code);
}

export async function loginWithPassword(tenantUuid: string, username: string, password: string) {
  const jar = new CookieJar();
  let page = await openLogin(tenantUuid, jar);
  if (!page.hasPassword && page.providers.length > 0) {
    return loginThroughSchoolProvider(tenantUuid, username);
  }
  let sentPassword = false;

  for (let step = 0; step < 4; step += 1) {
    if (page.error) throw new Error(page.error);
    if (!page.hasUsername && !page.hasPassword) {
      throw new Error("Geen inlogformulier gevonden.");
    }

    const fields: Record<string, string> = { loginLink: "x" };
    if (page.hasUsername) fields[USER_FIELD] = username;
    if (page.hasPassword) {
      fields[PASS_FIELD] = password;
      sentPassword = true;
    }

    const posted = await postForm(page.action, fields, jar);
    const next = await chase(posted, jar, page.action);
    const code = callbackCode(next.location);
    if (code) return exchangeCode(code);
    if (next.location && isExternalLogin(next.location)) {
      return loginThroughSchoolProvider(tenantUuid, username);
    }
    if (!next.html) throw new Error("Inloggen mislukt. Controleer gebruikersnaam en wachtwoord.");

    page = parseLoginPage(next.url, next.html);
    if (page.error) throw new Error(page.error);
    if (!page.hasPassword || sentPassword) {
      throw new Error("Inloggen mislukt. Controleer gebruikersnaam en wachtwoord.");
    }
  }

  throw new Error("Inloggen is niet afgerond.");
}

function clientIdFrom(refreshToken: string) {
  try {
    const payload = JSON.parse(Buffer.from(refreshToken.split(".")[1], "base64url").toString()) as {
      client_id?: string;
    };
    return payload.client_id || CLIENT_ID;
  } catch {
    return CLIENT_ID;
  }
}

export async function refreshTokens(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch("https://somtoday.nl/oauth2/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientIdFrom(refreshToken),
      scope: "openid",
    }),
  });
  const payload = (await response.json().catch(() => null)) as TokenResponse | null;
  if (!response.ok || !payload?.access_token || !payload.refresh_token) {
    throw new Error("Je sessie is verlopen. Log opnieuw in.");
  }
  return payload;
}

type RawLink = { id?: number | string; rel?: string; type?: string; href?: string };

const GRADE_QUERY =
  "type=Toetskolom&type=DeeltoetsKolom&type=Werkstukcijferkolom&type=Advieskolom" +
  "&additional=vaknaam&additional=resultaatkolom&additional=naamalternatiefniveau" +
  "&additional=vakuuid&additional=lichtinguuid&sort=desc-geldendResultaatCijferInvoer";

function asText(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/** Display score from a raw Somtoday grade (examen + voortgang shapes). */
export function somtodayGradeResult(grade: SomtodayGrade): string | null {
  return (
    asText(grade.label) ||
    asText(grade.formattedResultaat) ||
    asText(grade.geldendResultaat) ||
    asText(grade.resultaat) ||
    asText(grade.geldendResultaatCijferInvoer) ||
    asText(grade.cijfer)
  );
}

export function somtodayGradeSubject(grade: SomtodayGrade): string {
  const vak = grade.additionalObjects?.vaknaam;
  if (typeof vak === "string" && vak) return vak;
  if (vak && typeof vak === "object") {
    return asText(vak.naam) || asText(vak.afkorting) || "Vak";
  }
  return asText(grade.vak?.naam) || asText(grade.vak?.afkorting) || "Vak";
}

export function somtodayGradeDate(grade: SomtodayGrade): string | null {
  const raw =
    grade.datumInvoer || grade.datumInvoerEerstePoging || grade.datumInvoerTweedePoging || null;
  if (!raw) return null;
  return raw.slice(0, 10);
}

function asNumericId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function resourceId(links: RawLink[] | undefined) {
  const leerlingLink =
    links?.find((link) => (link.href || "").includes("/leerlingen/")) ??
    links?.find((link) => link.rel === "self") ??
    links?.[0];
  const fromId = asNumericId(leerlingLink?.id);
  if (fromId) return fromId;
  const href = leerlingLink?.href ?? "";
  const match = href.match(/\/leerlingen\/(\d+)/);
  return match ? Number(match[1]) : null;
}

function studentHref(links: RawLink[] | undefined) {
  return links?.find((link) => (link.href || "").includes("/leerlingen/"))?.href ?? null;
}

function mapStudent(student: SomtodayStudent): StudentInfo {
  return {
    id: resourceId(student.links) ?? 0,
    uuid: student.UUID || student.uuid || null,
    href: studentHref(student.links),
    name: studentName(student) || "Student",
    studentNumber: student.leerlingnummer == null ? null : String(student.leerlingnummer),
    email: student.email ?? null,
  };
}

async function adoptApiOrigin(session: StoredSession, items: SomtodayStudent[]) {
  for (const student of items) {
    const href = studentHref(student.links);
    if (!href) continue;
    try {
      const origin = new URL(href).origin;
      const current = new URL(session.apiUrl).origin;
      if (origin !== current) {
        session.apiUrl = origin;
        await updateSession(session);
      }
      return;
    } catch {
      continue;
    }
  }
}

function asHeaderRecord(init?: HeadersInit): Record<string, string> {
  const record: Record<string, string> = {};
  if (!init) return record;
  if (init instanceof Headers) {
    init.forEach((value, key) => {
      record[key.toLowerCase()] = value;
    });
    return record;
  }
  if (Array.isArray(init)) {
    for (const [key, value] of init) record[String(key).toLowerCase()] = String(value);
    return record;
  }
  for (const [key, value] of Object.entries(init)) {
    if (value == null) continue;
    record[key.toLowerCase()] = String(value);
  }
  return record;
}

function incomingToHeaders(incoming: http.IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null || key === "transfer-encoding") continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item);
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

function outgoingHeaders(record: Record<string, string>): Record<string, string> {
  const names: Record<string, string> = {
    accept: "Accept",
    authorization: "Authorization",
    range: "Range",
    "user-agent": "User-Agent",
    "content-type": "Content-Type",
    origin: "Origin",
    referer: "Referer",
    host: "Host",
  };
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const lower = key.toLowerCase();
    out[names[lower] || key] = value;
  }
  return out;
}

function nodeFetch(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  redirects = 0,
): Promise<Response> {
  const parsed = new URL(url);
  const lib = parsed.protocol === "http:" ? http : https;
  const method = init.method.toUpperCase();
  const headers = outgoingHeaders({ ...init.headers, host: parsed.host });
  const body = init.body;

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
      },
      (res) => {
        const location = res.headers.location;
        if (
          location &&
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          redirects < 5
        ) {
          res.resume();
          const next = new URL(location, parsed).toString();
          resolve(nodeFetch(next, init, redirects + 1));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer));
        res.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 502,
              statusText: res.statusMessage,
              headers: incomingToHeaders(res.headers),
            }),
          );
        });
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

function studentName(student: SomtodayStudent) {
  return [student.roepnaam, student.tussenvoegsel, student.achternaam].filter(Boolean).join(" ");
}

let refreshChain: Promise<void> = Promise.resolve();

async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = refreshChain.then(fn, fn);
  refreshChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function applyTokens(session: StoredSession, force = false): Promise<void> {
  await withRefreshLock(async () => {
    if (!force && Date.now() <= session.expiresAt - 60_000) return;
    const tokens = await refreshTokens(session.refreshToken);
    session.accessToken = tokens.access_token;
    session.refreshToken = tokens.refresh_token;
    session.apiUrl = tokens.somtoday_api_url || session.apiUrl;
    session.tenant = tokens.somtoday_tenant ?? session.tenant;
    session.expiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1000;
    await updateSession(session);
  });
}

async function ensureFreshSession(session: StoredSession): Promise<StoredSession> {
  if (Date.now() <= session.expiresAt - 60_000) return session;
  await applyTokens(session, false);
  return session;
}

export async function somFetch(
  session: StoredSession,
  path: string,
  init?: RequestInit & { headers?: HeadersInit },
): Promise<Response> {
  await ensureFreshSession(session);
  const method = (init?.method ?? "GET").toUpperCase();
  const headers = asHeaderRecord(init?.headers);
  if (!headers.accept) headers.accept = "application/json";
  if (method === "GET" && !headers.range) headers.range = "items=0-99";
  headers.authorization = `Bearer ${session.accessToken}`;
  headers["user-agent"] = BROWSER;
  if (!headers.origin) headers.origin = "https://leerling.somtoday.nl";
  if (!headers.referer) headers.referer = "https://leerling.somtoday.nl/";

  const body =
    typeof init?.body === "string" ? init.body : init?.body == null ? undefined : String(init.body);
  const url = `${session.apiUrl.replace(/\/$/, "")}${path}`;
  const response = await nodeFetch(url, { method, headers, body });
  if (response.status !== 401) return response;

  await applyTokens(session, true);
  headers.authorization = `Bearer ${session.accessToken}`;
  return nodeFetch(url, { method, headers, body });
}

export type PluginSessionContext = {
  schoolName: string;
  tenant: string | null;
  schoolYear: string | null;
  students: StudentInfo[];
};

export async function loadPluginContext(session: StoredSession): Promise<PluginSessionContext> {
  await ensureFreshSession(session);

  const studentsResponse = await somFetch(session, "/rest/v1/leerlingen");
  if (!studentsResponse.ok) throw new Error("Leerlinggegevens laden mislukt.");
  const studentsPayload = (await studentsResponse.json()) as { items?: SomtodayStudent[] };
  await adoptApiOrigin(session, studentsPayload.items ?? []);
  const students: StudentInfo[] = (studentsPayload.items ?? []).map(mapStudent);

  let schoolYear: string | null = null;
  const yearResponse = await somFetch(session, "/rest/v1/schooljaren/huidig");
  if (yearResponse.ok) {
    const year = (await yearResponse.json()) as SomtodaySchooljaar;
    schoolYear = year.naam ?? null;
  }

  return {
    schoolName: session.schoolName,
    tenant: session.tenant,
    schoolYear,
    students,
  };
}

export async function loadSessionInfo(session: StoredSession): Promise<SessionInfo> {
  await ensureFreshSession(session);

  const studentsResponse = await somFetch(session, "/rest/v1/leerlingen");
  if (!studentsResponse.ok) throw new Error("Leerlinggegevens laden mislukt.");
  const studentsPayload = (await studentsResponse.json()) as { items?: SomtodayStudent[] };
  await adoptApiOrigin(session, studentsPayload.items ?? []);
  const students: StudentInfo[] = (studentsPayload.items ?? []).map(mapStudent);

  let schoolYear: string | null = null;
  const yearResponse = await somFetch(session, "/rest/v1/schooljaren/huidig");
  if (yearResponse.ok) {
    const year = (await yearResponse.json()) as SomtodaySchooljaar;
    schoolYear = year.naam ?? null;
  }

  const grades: GradeInfo[] = [];
  const studentId = students.find((student) => student.id)?.id;
  if (studentId) {
    const dossiers = [
      `/rest/v1/geldendvoortgangsdossierresultaten/leerling/${studentId}?${GRADE_QUERY}`,
      `/rest/v1/geldendexamendossierresultaten/leerling/${studentId}?${GRADE_QUERY}`,
    ];
    const items: SomtodayGrade[] = [];
    for (const path of dossiers) {
      const gradesResponse = await somFetch(session, path);
      if (!gradesResponse.ok) continue;
      const gradesPayload = (await gradesResponse.json()) as SomtodayListResponse<SomtodayGrade>;
      items.push(...(gradesPayload.items ?? []));
    }
    for (const grade of items) {
      const result = somtodayGradeResult(grade);
      if (!result) continue;
      grades.push({
        subject: somtodayGradeSubject(grade),
        result,
        date: somtodayGradeDate(grade),
        description: grade.omschrijving ?? null,
      });
      if (grades.length === 8) break;
    }
  }

  return {
    schoolName: session.schoolName,
    tenant: session.tenant,
    schoolYear,
    students,
    grades,
  };
}

export function sessionFromTokens(tokens: TokenResponse, schoolName: string): StoredSession {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    apiUrl: tokens.somtoday_api_url || "https://api.somtoday.nl",
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    schoolName,
    tenant: tokens.somtoday_tenant ?? null,
  };
}
