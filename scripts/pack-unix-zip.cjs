const fs = require("fs");
const path = require("path");
const JSZip = require(path.join(
  process.env.TEMP || process.env.TMP,
  "tt-zip-tool",
  "node_modules",
  "jszip"
));

const root = path.resolve(__dirname, "..");
const out = path.resolve(root, "..", "tt-enterprises-tanmayphotos-unix.zip");
const excludeDirs = new Set(["node_modules", ".next", ".git", ".cursor"]);

async function main() {
  const zip = new JSZip();
  function walk(dir, rel) {
    for (const name of fs.readdirSync(dir)) {
      if (excludeDirs.has(name)) continue;
      if (name.endsWith(".zip") || name.endsWith(".tar.gz")) continue;
      const full = path.join(dir, name);
      const arc = rel ? rel + "/" + name : name;
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        zip.folder(arc);
        walk(full, arc);
      } else {
        zip.file(arc, fs.readFileSync(full), {
          unixPermissions: 0o644,
          date: st.mtime,
        });
      }
    }
  }
  walk(root, "");
  const buf = await zip.generateAsync({
    type: "nodebuffer",
    platform: "UNIX",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(out, buf);
  console.log("Wrote", out, buf.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
