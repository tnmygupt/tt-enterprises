import os
import zipfile
from pathlib import Path

root = Path(r"D:\TT ENTERPRISES NEW WEBSITE\TT ENTERPRISES NEW WEBSITE")
out = Path(r"D:\TT ENTERPRISES NEW WEBSITE\TT ENTERPRISES NEW WEBSITE\tt-enterprises-tanmayphotos.zip")
skip_dirs = {".git", "node_modules", ".next", "out", ".cursor", "agent-transcripts", "coverage", ".vercel", "data", "tmp"}
skip_suffixes = (".zip", ".tar.gz", ".tgz")

if out.exists():
    out.unlink()


def keep(path: Path) -> bool:
    rel = path.relative_to(root)
    if set(rel.parts) & skip_dirs:
        return False
    name = path.name
    if name.startswith("deploy-") and name.endswith((".zip", ".tar.gz")):
        return False
    if name.endswith(skip_suffixes) and path.is_file():
        return False
    if name in {".env", ".env.local"}:
        return False
    if name.endswith(".pem"):
        return False
    return True


FILE_ATTR = 0o100644 << 16
DIR_ATTR = 0o040755 << 16

with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    for dirpath, dirnames, filenames in os.walk(root):
        dpath = Path(dirpath)
        # prune excluded dirs in-place
        dirnames[:] = [d for d in dirnames if d not in skip_dirs]
        rel_dir = dpath.relative_to(root)
        if rel_dir.parts and set(rel_dir.parts) & skip_dirs:
            continue
        if str(rel_dir) != ".":
            info = zipfile.ZipInfo(str(rel_dir).replace("\\", "/") + "/")
            info.create_system = 3  # Unix
            info.external_attr = DIR_ATTR
            zf.writestr(info, b"")
        for name in filenames:
            full = dpath / name
            if not keep(full):
                continue
            arc = str(full.relative_to(root)).replace("\\", "/")
            info = zipfile.ZipInfo.from_file(full, arc)
            info.create_system = 3
            info.external_attr = FILE_ATTR
            with open(full, "rb") as f:
                zf.writestr(info, f.read())

print(f"ZIP={out}")
print(f"SIZE={out.stat().st_size}")
