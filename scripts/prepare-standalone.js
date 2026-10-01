const fs = require("node:fs");
const path = require("node:path");
const { cpSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } = fs;

function copyDir(src, dest) {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

const IGNORE = new Set([
  "release",
  "build",
  "electron",
  "dist-electron",
  "electron-assets",
  "docs",
  "data",
  ".git",
  ".github",
  ".idea",
  "node_modules",
  ".next",
]);

const standaloneRoot = path.join(".next", "standalone");
if (!existsSync(standaloneRoot)) {
  console.error("Missing .next/standalone — run next build first.");
  process.exit(1);
}

const serverCandidates = [
  path.join(standaloneRoot, "server.js"),
  path.join(standaloneRoot, "cyfers", "server.js"),
  path.join(standaloneRoot, "somtoday-login", "server.js"),
];

const serverJs = serverCandidates.find((candidate) => existsSync(candidate));
if (!serverJs) {
  console.error("No server.js found under .next/standalone");
  process.exit(1);
}

const serverDir = path.dirname(serverJs);
copyDir(path.join(".next", "static"), path.join(serverDir, ".next", "static"));
copyDir("public", path.join(serverDir, "public"));

const outDir = path.join("build", "server");
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Only ship the runtime pieces — never nested previous pack outputs.
const keepFiles = ["server.js", "package.json"];
for (const name of keepFiles) {
  const from = path.join(serverDir, name);
  if (existsSync(from)) fs.copyFileSync(from, path.join(outDir, name));
}

const keepDirs = ["node_modules", ".next", "public"];
for (const name of keepDirs) {
  const from = path.join(serverDir, name);
  if (existsSync(from)) copyDir(from, path.join(outDir, name));
}

// Drop anything else Next traced into standalone (app sources, release/, etc.)
for (const entry of readdirSync(serverDir)) {
  if (keepFiles.includes(entry) || keepDirs.includes(entry)) continue;
  if (IGNORE.has(entry)) continue;
}

const size = du(outDir);
console.log(`Prepared standalone at ${outDir} (${formatBytes(size)})`);

function du(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += du(full);
    else total += statSync(full).size;
  }
  return total;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
