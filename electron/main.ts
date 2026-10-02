import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  shell,
} from "electron";
import { autoUpdater, type UpdateDownloadedEvent } from "electron-updater";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { installMacUpdateFromZip, isMacAppSigned } from "./mac-update-install";
import type { CyfersUpdateEvent } from "./preload";
import { captureAuthorizationCode } from "./sso";

const isDev = !app.isPackaged;

/** In-app updates: packaged win/mac always; Linux only when running as AppImage. */
function updatesSupported(): boolean {
  if (isDev) return false;
  if (process.platform === "linux") {
    return Boolean(process.env.APPIMAGE);
  }
  return true;
}

const UPDATES_UNSUPPORTED_REASON =
  "In-app updates zijn alleen beschikbaar voor de AppImage. Installeer updates handmatig via je pakketbeheerder.";

let mainWindow: BrowserWindow | null = null;
let nextProcess: ChildProcess | null = null;
let controlServer: http.Server | null = null;
let appPort = 0;
let isQuitting = false;
let updateDownloaded = false;
/** Absolute path to the zip/AppImage/exe cached by electron-updater. */
let downloadedUpdateFile: string | null = null;

function userDataPath(...parts: string[]) {
  return path.join(app.getPath("userData"), ...parts);
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function readOrCreateSecret(): string {
  const keyPath = userDataPath("session.key");
  ensureDir(userDataPath());
  if (fs.existsSync(keyPath)) {
    const raw = fs.readFileSync(keyPath);
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(raw);
      } catch {
        // fall through to recreate
      }
    } else if (raw.length >= 32) {
      return raw.toString("utf8");
    }
  }
  const secret = crypto.randomBytes(32).toString("hex");
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(keyPath, safeStorage.encryptString(secret));
  } else {
    fs.writeFileSync(keyPath, secret, { mode: 0o600 });
  }
  return secret;
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Kon geen vrije poort vinden."));
        return;
      }
      const { port } = address;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on("error", reject);
  });
}

function waitForUrl(url: string, timeoutMs = 60000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error("Next.js startte niet op tijd."));
          return;
        }
        setTimeout(tick, 250);
      });
    };
    tick();
  });
}

function startControlServer(secret: string, port: number): Promise<http.Server> {
  const server = http.createServer(async (req, res) => {
    const reject = (status: number, message: string) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    };

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method !== "POST" || req.url !== "/sso/capture") {
      reject(404, "Niet gevonden.");
      return;
    }

    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${secret}`) {
      reject(401, "Ongeldige SSO-brug.");
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    let body: { tenantUuid?: string; username?: string };
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        tenantUuid?: string;
        username?: string;
      };
    } catch {
      reject(400, "Ongeldige JSON.");
      return;
    }

    if (!body.tenantUuid) {
      reject(400, "tenantUuid ontbreekt.");
      return;
    }

    try {
      const code = await captureAuthorizationCode(body.tenantUuid, body.username ?? "");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ code }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "SSO mislukt.";
      reject(500, message);
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

function standaloneDir() {
  if (isDev) return path.join(app.getAppPath(), "build", "server");
  return path.join(process.resourcesPath, "standalone");
}

function resolveStandaloneServer(): { root: string; serverJs: string } {
  const root = standaloneDir();
  const candidates = [
    path.join(root, "server.js"),
    path.join(root, "cyfers", "server.js"),
    path.join(root, "somtoday-login", "server.js"),
  ];
  for (const serverJs of candidates) {
    if (fs.existsSync(serverJs)) {
      return { root: path.dirname(serverJs), serverJs };
    }
  }
  throw new Error(`Standalone server ontbreekt onder ${root}`);
}

async function startNextServer(env: NodeJS.ProcessEnv, port: number): Promise<void> {
  if (isDev) {
    nextProcess = spawn("npx", ["next", "dev", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: app.getAppPath(),
      env: { ...process.env, ...env },
      stdio: "inherit",
      shell: process.platform === "win32",
    });
  } else {
    const { root, serverJs } = resolveStandaloneServer();
    nextProcess = spawn(process.execPath, [serverJs], {
      cwd: root,
      env: {
        ...process.env,
        ...env,
        ELECTRON_RUN_AS_NODE: "1",
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
      },
      stdio: "inherit",
    });
  }

  nextProcess.on("exit", (code, signal) => {
    if (!isQuitting) {
      console.error(`Next.js exited (code=${code}, signal=${signal})`);
    }
  });

  await waitForUrl(`http://127.0.0.1:${port}`);
}

function installDevMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "Weergave",
      submenu: [
        { role: "reload", label: "Vernieuwen", accelerator: "CmdOrControl+R" },
        { role: "forceReload", label: "Hard vernieuwen", accelerator: "CmdOrControl+Shift+R" },
        { type: "separator" },
        { role: "toggleDevTools", label: "Developer Tools", accelerator: "F12" },
      ],
    },
  ];
  if (process.platform === "darwin") {
    template.unshift({
      label: app.name,
      submenu: [{ role: "about" }, { type: "separator" }, { role: "quit" }],
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function sendUpdateEvent(payload: CyfersUpdateEvent) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("cyfers:update-event", payload);
}

function setupAutoUpdater() {
  ipcMain.handle("cyfers:get-version", () => app.getVersion());

  ipcMain.handle("cyfers:check-for-updates", async () => {
    if (isDev) return { ok: false, error: "Updates alleen in de verpakte app." };
    if (!updatesSupported()) {
      return { ok: false, error: UPDATES_UNSUPPORTED_REASON };
    }
    try {
      await autoUpdater.checkForUpdates();
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Updatecontrole mislukt.";
      sendUpdateEvent({ type: "error", message });
      return { ok: false, error: message };
    }
  });

  ipcMain.handle("cyfers:install-update", () => {
    if (isDev) return { ok: false, error: "Updates alleen in de verpakte app." };
    if (!updatesSupported()) {
      return { ok: false, error: UPDATES_UNSUPPORTED_REASON };
    }
    if (!updateDownloaded) {
      return { ok: false, error: "Update is nog niet gedownload." };
    }

    // Unsigned macOS builds cannot use Squirrel.Mac (Electron autoUpdater).
    // Install by swapping the .app from the downloaded zip after quit.
    if (process.platform === "darwin" && !isMacAppSigned()) {
      try {
        if (!downloadedUpdateFile || !fs.existsSync(downloadedUpdateFile)) {
          return {
            ok: false,
            error: "Updatebestand ontbreekt. Start Cyfers opnieuw en probeer opnieuw.",
          };
        }
        installMacUpdateFromZip(downloadedUpdateFile);
        return { ok: true };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Installeren van de update mislukt.";
        sendUpdateEvent({ type: "error", message });
        return { ok: false, error: message };
      }
    }

    // User-initiated only — never auto-install on quit.
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Installeren van de update mislukt.";
        sendUpdateEvent({ type: "error", message });
      }
    });
    return { ok: true };
  });

  if (!updatesSupported()) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on("checking-for-update", () => {
    sendUpdateEvent({ type: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    sendUpdateEvent({ type: "available", version: info.version });
  });

  autoUpdater.on("update-not-available", (info) => {
    sendUpdateEvent({ type: "not-available", version: info.version });
  });

  autoUpdater.on("update-downloaded", (info: UpdateDownloadedEvent) => {
    updateDownloaded = true;
    downloadedUpdateFile = info.downloadedFile || null;
    sendUpdateEvent({ type: "downloaded", version: info.version });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendUpdateEvent({ type: "progress", percent: progress.percent });
  });

  autoUpdater.on("error", (error) => {
    const raw = error instanceof Error ? error.message : String(error);
    const message = humanizeUpdateError(raw);
    sendUpdateEvent({ type: "error", message });
  });
}

/** Map common electron-updater / Squirrel errors to short Dutch copy. */
function humanizeUpdateError(raw: string): string {
  const lower = raw.toLowerCase();
  if (
    lower.includes("code signature") ||
    lower.includes("codesign") ||
    lower.includes("not signed") ||
    lower.includes("signature")
  ) {
    return "Automatische update mislukt (app is niet ondertekend). Download de nieuwe versie handmatig vanaf GitHub Releases.";
  }
  if (lower.includes("enospc") || lower.includes("no space")) {
    return "Onvoldoende schijfruimte om de update te downloaden.";
  }
  if (lower.includes("net::") || lower.includes("network") || lower.includes("econn")) {
    return "Update downloaden mislukt. Controleer je internetverbinding.";
  }
  if (raw.trim()) return raw;
  return "Update mislukt.";
}

function createMainWindow(port: number) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Cyfers",
    autoHideMenuBar: !isDev,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(isDev);
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    if (updatesSupported()) {
      // Delay slightly so the UI can subscribe to update events first.
      setTimeout(() => {
        void autoUpdater.checkForUpdates().catch(() => {
          // Errors are forwarded via the autoUpdater "error" event.
        });
      }, 2500);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.loadURL(`http://127.0.0.1:${port}`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function boot() {
  const dataDir = userDataPath("data");
  ensureDir(path.join(dataDir, "plugins"));

  const sessionKey = readOrCreateSecret();
  const ssoSecret = crypto.randomBytes(32).toString("hex");
  const ssoPort = await findFreePort();
  appPort = await findFreePort();

  controlServer = await startControlServer(ssoSecret, ssoPort);

  const env: NodeJS.ProcessEnv = {
    CYFERS_DESKTOP: "1",
    CYFERS_DATA_DIR: dataDir,
    CYFERS_SESSION_KEY: sessionKey,
    CYFERS_SSO_URL: `http://127.0.0.1:${ssoPort}`,
    CYFERS_SSO_SECRET: ssoSecret,
    NODE_ENV: isDev ? "development" : "production",
  };

  await startNextServer(env, appPort);
  createMainWindow(appPort);
}

function shutdown() {
  if (controlServer) {
    controlServer.close();
    controlServer = null;
  }
  if (nextProcess && !nextProcess.killed) {
    nextProcess.kill();
    nextProcess = null;
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    if (isDev) installDevMenu();
    else Menu.setApplicationMenu(null);
    setupAutoUpdater();
    try {
      await boot();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox("Cyfers kon niet starten", message);
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && appPort) {
      createMainWindow(appPort);
    }
  });

  app.on("before-quit", () => {
    isQuitting = true;
    shutdown();
  });
}
