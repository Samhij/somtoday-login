#!/usr/bin/env node
/**
 * Copy plugin-facing types from cyfer-plugins (source of truth) into
 * vendor/cyfer-plugin-types/.
 *
 * Resolution order:
 * 1. CYFER_PLUGINS_DIR env
 * 2. Sibling checkout ../cyfer-plugins
 * 3. Fetch raw files from GitHub (main)
 */
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const ROOT = path.resolve(__dirname, "..");
const DEST = path.join(ROOT, "vendor", "cyfer-plugin-types");
const FILES = ["api.ts", "globals.d.ts", "README.md"];
const RAW_BASE =
  "https://raw.githubusercontent.com/Samhij/cyfer-plugins/main/types";

function copyFromDir(srcDir) {
  fs.mkdirSync(DEST, { recursive: true });
  for (const file of FILES) {
    const from = path.join(srcDir, file);
    if (!fs.existsSync(from)) {
      throw new Error(`Missing ${from}`);
    }
    fs.copyFileSync(from, path.join(DEST, file));
    console.log(`copied ${file} <- ${from}`);
  }
}

function fetchText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          fetchText(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} -> ${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      })
      .on("error", reject);
  });
}

async function fetchFromGitHub() {
  fs.mkdirSync(DEST, { recursive: true });
  for (const file of FILES) {
    const url = `${RAW_BASE}/${file}`;
    const body = await fetchText(url);
    fs.writeFileSync(path.join(DEST, file), body);
    console.log(`fetched ${file} <- ${url}`);
  }
}

async function main() {
  const envDir = process.env.CYFER_PLUGINS_DIR
    ? path.resolve(process.env.CYFER_PLUGINS_DIR)
    : null;
  const sibling = path.resolve(ROOT, "..", "cyfer-plugins", "types");
  const candidates = [envDir ? path.join(envDir, "types") : null, sibling].filter(
    Boolean,
  );

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "api.ts"))) {
      copyFromDir(dir);
      console.log("sync-plugin-types: done (local)");
      return;
    }
  }

  console.log("No local cyfer-plugins/types found; fetching from GitHub…");
  await fetchFromGitHub();
  console.log("sync-plugin-types: done (remote)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
