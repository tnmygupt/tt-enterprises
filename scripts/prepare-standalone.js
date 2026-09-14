/**
 * Copies public + static assets into the standalone folder after `next build`.
 * Required for Hostinger / VPS `node .next/standalone/server.js`.
 */
const fs = require("fs");
const path = require("path");

function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(from, to);
    else fs.copyFileSync(from, to);
  }
}

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

if (!fs.existsSync(standalone)) {
  console.log("No standalone output — skip prepare-standalone");
  process.exit(0);
}

copyDir(path.join(root, "public"), path.join(standalone, "public"));
copyDir(
  path.join(root, ".next", "static"),
  path.join(standalone, ".next", "static")
);

// Ensure server-only env reaches Hostinger standalone runtime
for (const name of [".env.production", ".env"]) {
  const from = path.join(root, name);
  if (!fs.existsSync(from)) continue;
  fs.copyFileSync(from, path.join(standalone, name));
  // Also at cwd parents Hostinger may use
  try {
    fs.copyFileSync(from, path.join(standalone, "..", "..", name));
  } catch {
    /* ignore */
  }
}

const configDir = path.join(standalone, "config");
fs.mkdirSync(configDir, { recursive: true });
for (const name of ["tally-wa.cfg", "ops.cfg"]) {
  const from = path.join(root, "config", name);
  if (!fs.existsSync(from)) continue;
  fs.copyFileSync(from, path.join(configDir, name));
  if (name === "tally-wa.cfg") {
    fs.copyFileSync(from, path.join(standalone, "tally-wa.cfg"));
  }
}

console.log("Standalone package ready (.next/standalone)");
