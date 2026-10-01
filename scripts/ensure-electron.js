const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const electronDir = path.join(__dirname, "..", "node_modules", "electron");
const distElectron = path.join(electronDir, "dist", "electron");
if (fs.existsSync(distElectron)) process.exit(0);
if (!fs.existsSync(path.join(electronDir, "package.json"))) process.exit(0);

const result = spawnSync(process.execPath, [path.join(electronDir, "install.js")], {
  stdio: "inherit",
  env: process.env,
});
if (fs.existsSync(distElectron)) process.exit(result.status ?? 0);

const cacheRoot = path.join(os.homedir(), ".cache", "electron");
if (!fs.existsSync(cacheRoot)) process.exit(result.status ?? 1);

const { version } = require(path.join(electronDir, "package.json"));
const zipName = `electron-v${version}-linux-x64.zip`;
let zipPath = null;
for (const entry of fs.readdirSync(cacheRoot)) {
  const candidate = path.join(cacheRoot, entry, zipName);
  if (fs.existsSync(candidate)) {
    zipPath = candidate;
    break;
  }
}
if (!zipPath) process.exit(result.status ?? 1);

const dist = path.join(electronDir, "dist");
fs.mkdirSync(dist, { recursive: true });
const unzip = spawnSync("unzip", ["-o", zipPath, "-d", dist], { stdio: "inherit" });
if (unzip.status === 0) {
  fs.writeFileSync(path.join(electronDir, "path.txt"), "electron");
  console.log("Electron binary restored via unzip fallback.");
}
process.exit(unzip.status ?? 1);
