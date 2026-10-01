import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  safeStorage,
  shell,
} from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { captureAuthorizationCode } from "./sso";

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let nextProcess: ChildProcess | null = null;
let controlServer: http.Server | null = null;
let appPort = 0;
let isQuitting = false;

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

function builtinPluginsDir() {
  if (isDev) return path.join(app.getAppPath(), "plugins");
  return path.join(process.resourcesPath, "plugins");
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

function createMainWindow(port: number) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: "Cyfers",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.once("ready-to-show", () => mainWindow?.show());
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
    CYFERS_BUILTIN_PLUGINS: builtinPluginsDir(),
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
    Menu.setApplicationMenu(null);
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
