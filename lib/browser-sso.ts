import puppeteer, { type Browser, type HTTPRequest, type HTTPResponse } from "puppeteer-core";

const CLIENT_ID = "somtoday-leerling-web";
const REDIRECT_URI = "https://leerling.somtoday.nl/oauth/callback";
const CHROMIUM = process.env.CHROMIUM_PATH || "/usr/bin/chromium";

function codeFrom(url: string) {
  try {
    const parsed = new URL(url);
    const code = parsed.searchParams.get("code");
    if (!code) return null;
    const callback =
      parsed.hostname === "leerling.somtoday.nl" ||
      parsed.protocol === "somtoday:" ||
      parsed.protocol === "somtodayleerling:";
    return callback ? code : null;
  } catch {
    return null;
  }
}

export async function captureAuthorizationCode(tenantUuid: string, username: string) {
  let browser: Browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROMIUM,
      headless: false,
      defaultViewport: null,
      ignoreDefaultArgs: ["--enable-automation"],
      args: ["--no-first-run", "--no-default-browser-check", "--disable-blink-features=AutomationControlled"],
    });
  } catch {
    throw new Error("Could not open a browser window for the school sign-in.");
  }

  const page = await browser.newPage();
  let settled = false;
  const code = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("The school sign-in window timed out. Sign in there, then try again."));
    }, 4 * 60 * 1000);

    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const inspect = (url: string) => {
      const found = codeFrom(url);
      if (found) finish(found);
    };

    page.on("request", (request: HTTPRequest) => inspect(request.url()));
    page.on("response", (response: HTTPResponse) => {
      const location = response.headers()["location"];
      if (!location) return;
      try {
        inspect(new URL(location, response.url()).toString());
      } catch {
        inspect(location);
      }
    });
    browser.on("disconnected", () => fail(new Error("The school sign-in window was closed before it finished.")));
  });

  try {
    const authorize = new URL("https://inloggen.somtoday.nl/oauth2/authorize");
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set("client_id", CLIENT_ID);
    authorize.searchParams.set("redirect_uri", REDIRECT_URI);
    authorize.searchParams.set("scope", "openid");
    authorize.searchParams.set("tenant_uuid", tenantUuid);
    authorize.searchParams.set("session", "no_session");
    authorize.searchParams.set("prompt", "login");

    await page.goto(authorize.toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
    const sso = await page.$('a[href*="ssoLink"]');
    if (sso) await sso.click();

    await page.waitForSelector('input[name="loginfmt"]', { timeout: 15000 }).catch(() => null);
    if (username && (await page.$('input[name="loginfmt"]'))) {
      await page.type('input[name="loginfmt"]', username);
      const next = await page.$("#idSIButton9");
      if (next) await next.click();
    }

    const authorizationCode = await code;
    return authorizationCode;
  } finally {
    settled = true;
    await browser.close().catch(() => undefined);
  }
}
