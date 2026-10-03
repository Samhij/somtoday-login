#!/usr/bin/env node
/**
 * Copy plugin base CSS from cyfer-plugins (authoring source of truth) into
 * vendor/cyfer-plugin-styles/ and embed it in lib/plugins/base-styles.ts for
 * runtime iframe injection (keeps packaging self-contained).
 *
 * Resolution order:
 * 1. CYFER_PLUGINS_DIR env
 * 2. Sibling checkout ../cyfer-plugins
 * 3. Fetch raw file from GitHub (main)
 */
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");

const ROOT = path.resolve(__dirname, "..");
const DEST_DIR = path.join(ROOT, "vendor", "cyfer-plugin-styles");
const DEST_CSS = path.join(DEST_DIR, "plugin-base.css");
const BASE_STYLES_TS = path.join(ROOT, "lib", "plugins", "base-styles.ts");
const CSS_NAME = "plugin-base.css";
const RAW_URL =
  "https://raw.githubusercontent.com/Samhij/cyfer-plugins/main/styles/plugin-base.css";

const FONT_LINKS = `
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Syne:wght@700&display=swap" rel="stylesheet" />
`.trim();

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

function stripBom(text) {
  return text.replace(/^\uFEFF/, "");
}

function writeVendor(css) {
  fs.mkdirSync(DEST_DIR, { recursive: true });
  fs.writeFileSync(DEST_CSS, css.endsWith("\n") ? css : `${css}\n`);
  console.log(`wrote ${path.relative(ROOT, DEST_CSS)}`);
}

function embedInBaseStyles(css) {
  const body = css.trim();
  const out = `/** Shared look for every plugin iframe — injected by rewritePluginHtml.
 *
 * Authoring source of truth: cyfer-plugins/styles/plugin-base.css
 * Refresh with: npm run sync:plugin-styles
 *
 * Font <link> tags stay here (HTML, not CSS). The CSS body is vendored under
 * vendor/cyfer-plugin-styles/ and embedded below so standalone builds need no
 * extra runtime file reads.
 */
export const CYFERS_PLUGIN_FONT_LINKS = \`
${FONT_LINKS}
\`.trim();

export const CYFERS_PLUGIN_BASE_CSS = \`
${body}
\`.trim();
`;
  fs.writeFileSync(BASE_STYLES_TS, out);
  console.log(`wrote ${path.relative(ROOT, BASE_STYLES_TS)}`);
}

function applyCss(css, sourceLabel) {
  const normalized = stripBom(css);
  if (!normalized.includes("--ink") || !normalized.includes(".lede")) {
    throw new Error(`CSS from ${sourceLabel} does not look like plugin-base.css`);
  }
  writeVendor(normalized);
  embedInBaseStyles(normalized);
}

async function main() {
  const envDir = process.env.CYFER_PLUGINS_DIR
    ? path.resolve(process.env.CYFER_PLUGINS_DIR)
    : null;
  const sibling = path.resolve(ROOT, "..", "cyfer-plugins", "styles", CSS_NAME);
  const candidates = [
    envDir ? path.join(envDir, "styles", CSS_NAME) : null,
    sibling,
  ].filter(Boolean);

  for (const file of candidates) {
    if (fs.existsSync(file)) {
      applyCss(fs.readFileSync(file, "utf8"), file);
      console.log("sync-plugin-styles: done (local)");
      return;
    }
  }

  console.log("No local cyfer-plugins/styles found; fetching from GitHub…");
  const body = await fetchText(RAW_URL);
  applyCss(body, RAW_URL);
  console.log("sync-plugin-styles: done (remote)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
