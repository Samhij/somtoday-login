import { BrowserWindow, session as electronSession } from "electron";

const CLIENT_ID = "somtoday-leerling-web";
const REDIRECT_URI = "https://leerling.somtoday.nl/oauth/callback";
const TIMEOUT_MS = 4 * 60 * 1000;

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

const PREFILL_SCRIPT = `
(function(username) {
  if (!username) return false;
  const input =
    document.querySelector('input[name="loginfmt"]') ||
    document.querySelector('input[type="email"]') ||
    document.querySelector('#i0116');
  if (!input) return false;
  const current = (input.value || "").trim();
  if (current && current.toLowerCase() === username.toLowerCase()) return true;
  const nativeSet = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value"
  )?.set;
  nativeSet?.call(input, username);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  const next =
    document.querySelector("#idSIButton9") ||
    document.querySelector('input[type="submit"]') ||
    document.querySelector('button[type="submit"]');
  if (next) next.click();
  return true;
})
`;

let active: BrowserWindow | null = null;

export async function captureAuthorizationCode(tenantUuid: string, username: string): Promise<string> {
  if (active && !active.isDestroyed()) {
    active.focus();
    throw new Error("Er is al een school-inlogvenster open.");
  }

  const partition = `cyfers-sso-${Date.now()}`;
  const ses = electronSession.fromPartition(partition, { cache: false });

  const win = new BrowserWindow({
    width: 980,
    height: 760,
    show: true,
    autoHideMenuBar: true,
    title: "School inloggen",
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  active = win;

  let settled = false;

  const code = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Inloggen duurde te lang. Probeer het opnieuw."));
    }, TIMEOUT_MS);

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

    // Defer off webRequest/navigation stacks to avoid Electron deadlocks.
    const finishLater = (value: string) => {
      setImmediate(() => finish(value));
    };

    const inspect = (url: string, event?: { preventDefault: () => void }) => {
      const found = codeFrom(url);
      if (!found) return false;
      event?.preventDefault();
      finishLater(found);
      return true;
    };

    const tryPrefill = () => {
      if (!username || settled || win.isDestroyed()) return;
      void win.webContents
        .executeJavaScript(`(${PREFILL_SCRIPT})(${JSON.stringify(username)})`)
        .catch(() => undefined);
    };

    const clickSsoIfPresent = () => {
      if (settled || win.isDestroyed()) return;
      void win.webContents
        .executeJavaScript(`
          (() => {
            const sso = document.querySelector('a[href*="ssoLink"]');
            if (sso) { sso.click(); return true; }
            return false;
          })()
        `)
        .catch(() => undefined);
    };

    // HTTP redirects are GET — safe to inspect / capture code here.
    win.webContents.on("will-redirect", (event, url) => {
      inspect(url, event);
    });

    // Form POSTs also fire will-navigate. Only cancel Somtoday callback GETs;
    // never rewrite/loadURL Microsoft URLs here (that causes AADSTS900561).
    win.webContents.on("will-navigate", (event, url) => {
      inspect(url, event);
    });

    win.webContents.on("did-navigate", (_event, url) => {
      inspect(url);
    });

    win.webContents.on("did-navigate-in-page", (_event, url) => {
      inspect(url);
    });

    win.webContents.on("dom-ready", () => {
      clickSsoIfPresent();
      tryPrefill();
    });

    win.webContents.on("did-finish-load", () => {
      clickSsoIfPresent();
      tryPrefill();
      setTimeout(tryPrefill, 400);
      setTimeout(tryPrefill, 1200);
    });

    ses.webRequest.onBeforeRequest({ urls: ["*://leerling.somtoday.nl/*"] }, (details, callback) => {
      const found = codeFrom(details.url);
      if (found) {
        callback({ cancel: true });
        finishLater(found);
        return;
      }
      callback({});
    });

    win.on("closed", () => {
      if (active === win) active = null;
      fail(new Error("Het inlogvenster is gesloten."));
    });
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

    await win.loadURL(authorize.toString());
    return await code;
  } finally {
    settled = true;
    setImmediate(() => {
      if (!win.isDestroyed()) win.destroy();
      if (active === win) active = null;
      void ses.clearStorageData().catch(() => undefined);
    });
  }
}
