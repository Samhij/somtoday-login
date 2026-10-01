const { cpSync, existsSync, rmSync, mkdirSync, readdirSync, statSync } = require("node:fs");
const path = require("node:path");

function du(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += du(full);
    else total += statSync(full).size;
  }
  return total;
}

exports.default = async function afterPack(context) {
  const src = path.join(context.packager.projectDir, "build", "server");
  // On macOS this is …/Cyfers.app/Contents/Resources; on win/linux …/resources.
  const resourcesDir = context.packager.getResourcesDir(context.appOutDir);
  const dest = path.join(resourcesDir, "standalone");
  if (!existsSync(src)) {
    throw new Error(`Missing ${src}; run build:next first.`);
  }
  if (existsSync(path.join(src, "release"))) {
    throw new Error("build/server contains release/ — refuse to pack nested artifacts.");
  }

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });

  const pluginsSrc = path.join(context.packager.projectDir, "plugins");
  const pluginsDest = path.join(resourcesDir, "plugins");
  if (existsSync(pluginsSrc)) {
    rmSync(pluginsDest, { recursive: true, force: true });
    cpSync(pluginsSrc, pluginsDest, { recursive: true });
  }

  const standaloneMb = du(dest) / (1024 * 1024);
  console.log(`afterPack: standalone ${standaloneMb.toFixed(1)} MB → ${dest}`);
  if (standaloneMb > 150) {
    throw new Error(
      `standalone too large (${standaloneMb.toFixed(1)} MB) — check for nested build artifacts.`,
    );
  }
};
