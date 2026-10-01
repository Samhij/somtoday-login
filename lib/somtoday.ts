import { captureAuthorizationCode } from "./browser-sso";
import type { GradeInfo, SessionInfo, StudentInfo } from "./types";
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
    if (!response.ok) throw new Error("Somtoday did not open a login page.");
    return parseLoginPage(current, html);
  }
  throw new Error("Somtoday did not open a login page.");
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
  throw new Error(payload?.error_description || payload?.error || "Somtoday rejected the login code.");
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
      throw new Error("Somtoday did not show a sign-in form.");
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
    if (!next.html) throw new Error("Sign-in failed. Check the username and password for this school.");

    page = parseLoginPage(next.url, next.html);
    if (page.error) throw new Error(page.error);
    if (!page.hasPassword || sentPassword) {
      throw new Error("Sign-in failed. Check the username and password for this school.");
    }
  }

  throw new Error("Sign-in did not finish.");
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
    throw new Error("The saved Somtoday session expired. Sign in again.");
  }
  return payload;
}

type RawLink = { id?: number; rel?: string };
type RawStudent = {
  links?: RawLink[];
  roepnaam?: string;
  tussenvoegsel?: string;
  achternaam?: string;
  leerlingnummer?: number | string;
  email?: string;
};
type RawGrade = {
  type?: string;
  resultaat?: string;
  geldendResultaat?: string;
  datumInvoer?: string;
  omschrijving?: string;
  vak?: { naam?: string; afkorting?: string };
};

function resourceId(links: RawLink[] | undefined) {
  const self = links?.find((link) => link.rel === "self") ?? links?.[0];
  return typeof self?.id === "number" ? self.id : null;
}

function studentName(student: RawStudent) {
  return [student.roepnaam, student.tussenvoegsel, student.achternaam].filter(Boolean).join(" ");
}

async function somFetch(session: StoredSession, path: string, headers?: HeadersInit) {
  const response = await fetch(`${session.apiUrl}${path}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${session.accessToken}`,
      ...headers,
    },
  });
  if (response.status !== 401) return response;

  const tokens = await refreshTokens(session.refreshToken);
  const next: StoredSession = {
    ...session,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    apiUrl: tokens.somtoday_api_url || session.apiUrl,
    tenant: tokens.somtoday_tenant ?? session.tenant,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
  };
  await updateSession(next);
  session.accessToken = next.accessToken;
  session.refreshToken = next.refreshToken;
  session.apiUrl = next.apiUrl;

  return fetch(`${session.apiUrl}${path}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${session.accessToken}`,
      ...headers,
    },
  });
}

export async function loadSessionInfo(session: StoredSession): Promise<SessionInfo> {
  if (Date.now() > session.expiresAt - 60_000) {
    const tokens = await refreshTokens(session.refreshToken);
    session.accessToken = tokens.access_token;
    session.refreshToken = tokens.refresh_token;
    session.apiUrl = tokens.somtoday_api_url || session.apiUrl;
    session.tenant = tokens.somtoday_tenant ?? session.tenant;
    session.expiresAt = Date.now() + (tokens.expires_in ?? 3600) * 1000;
    await updateSession(session);
  }

  const studentsResponse = await somFetch(session, "/rest/v1/leerlingen");
  if (!studentsResponse.ok) throw new Error("Could not load student information.");
  const studentsPayload = (await studentsResponse.json()) as { items?: RawStudent[] };
  const students: StudentInfo[] = (studentsPayload.items ?? []).map((student) => ({
    id: resourceId(student.links) ?? 0,
    name: studentName(student) || "Student",
    studentNumber: student.leerlingnummer == null ? null : String(student.leerlingnummer),
    email: student.email ?? null,
  }));

  let schoolYear: string | null = null;
  const yearResponse = await somFetch(session, "/rest/v1/schooljaren/huidig");
  if (yearResponse.ok) {
    const year = (await yearResponse.json()) as { naam?: string };
    schoolYear = year.naam ?? null;
  }

  const grades: GradeInfo[] = [];
  const studentId = students.find((student) => student.id)?.id;
  if (studentId) {
    const gradesResponse = await somFetch(session, `/rest/v1/resultaten/huidigVoorLeerling/${studentId}`, {
      range: "items=0-24",
    });
    if (gradesResponse.ok) {
      const gradesPayload = (await gradesResponse.json()) as { items?: RawGrade[] };
      for (const grade of gradesPayload.items ?? []) {
        if (grade.type && grade.type !== "Toetskolom") continue;
        const result = grade.geldendResultaat || grade.resultaat;
        if (!result) continue;
        grades.push({
          subject: grade.vak?.naam || grade.vak?.afkorting || "Subject",
          result,
          date: grade.datumInvoer ? grade.datumInvoer.slice(0, 10) : null,
          description: grade.omschrijving ?? null,
        });
        if (grades.length === 8) break;
      }
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
