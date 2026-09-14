import os
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
out = root / "tt-enterprises-tanmayphotos.zip"
skip_dirs = {
    ".git",
    "node_modules",
    ".next",
    "out",
    ".cursor",
    ".agents",
    "agent-transcripts",
    "coverage",
    ".vercel",
    "data",
    "tmp",
}
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
    if name.startswith(".env") and name != ".env.example":
        return False
    if name in {"tally-wa.cfg", "ops.cfg"}:
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


def read_env_key(name: str) -> str:
    for fname in (".env.local", ".env.production"):
        p = root / fname
        if not p.is_file():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            trimmed = line.strip()
            if not trimmed or trimmed.startswith("#"):
                continue
            eq = trimmed.find("=")
            if eq < 1:
                continue
            key = trimmed[:eq].strip()
            if key != name:
                continue
            return trimmed[eq + 1 :].strip().strip("'\"")
    return (os.environ.get(name) or "").strip()


def read_cfg_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#"):
            continue
        eq = trimmed.find("=")
        if eq < 1:
            continue
        out[trimmed[:eq].strip()] = trimmed[eq + 1 :].strip().strip("'\"")
    return out


instance = read_env_key("TALLY_WA_INSTANCE_KEY")
base = read_env_key("TALLY_WA_BASE_URL") or "https://app.tallywebsolutions.in"
ops = read_cfg_file(root / "config" / "ops.cfg")
cron = ops.get("CRON_SECRET") or read_env_key("CRON_SECRET")
vapid_pub = ops.get("NEXT_PUBLIC_VAPID_PUBLIC_KEY") or read_env_key(
    "NEXT_PUBLIC_VAPID_PUBLIC_KEY"
)
vapid_priv = ops.get("VAPID_PRIVATE_KEY") or read_env_key("VAPID_PRIVATE_KEY")
vapid_sub = (
    ops.get("VAPID_SUBJECT")
    or read_env_key("VAPID_SUBJECT")
    or "mailto:admin@ttenterprises.shop"
)
print("TALLY_WA_INSTANCE_KEY", "SET" if instance else "MISSING")
print("CRON_SECRET", "SET" if cron else "MISSING")
print("VAPID", "SET" if vapid_pub and vapid_priv else "MISSING")

lines: list[str] = []
if instance:
    lines.append(f"TALLY_WA_INSTANCE_KEY={instance}")
    lines.append(f"TALLY_WA_BASE_URL={base}")
if cron:
    lines.append(f"CRON_SECRET={cron}")
if vapid_pub and vapid_priv:
    lines.append(f"NEXT_PUBLIC_VAPID_PUBLIC_KEY={vapid_pub}")
    lines.append(f"VAPID_PRIVATE_KEY={vapid_priv}")
    lines.append(f"VAPID_SUBJECT={vapid_sub}")
if lines:
    body = "\n".join(lines) + "\n"
    with zipfile.ZipFile(out, "a") as zf:
        dir_info = zipfile.ZipInfo("config/")
        dir_info.create_system = 3
        dir_info.external_attr = DIR_ATTR
        try:
            zf.writestr(dir_info, b"")
        except Exception:
            pass
        for arc in ("config/tally-wa.cfg", "config/ops.cfg", ".env.production"):
            info = zipfile.ZipInfo(arc)
            info.create_system = 3
            info.external_attr = FILE_ATTR
            zf.writestr(info, body)
    print("INJECTED server config (secrets not printed)")
