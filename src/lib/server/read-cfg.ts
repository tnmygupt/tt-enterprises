import { existsSync, readFileSync } from "fs";
import { join } from "path";

/** KEY=value files used as Hostinger fallbacks when hPanel env is missing. */
export function serverCfgCandidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    join(cwd, "config", "ops.cfg"),
    join(cwd, "config", "tally-wa.cfg"),
    join(cwd, ".env.production"),
    join(cwd, ".env"),
  ];
}

function parseCfg(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && val) out[key] = val;
  }
  return out;
}

let cache: Record<string, string> | null = null;

export function readServerCfg(): Record<string, string> {
  if (cache) return cache;
  const merged: Record<string, string> = {};
  try {
    for (const path of serverCfgCandidatePaths()) {
      if (!existsSync(/* turbopackIgnore: true */ path)) continue;
      Object.assign(
        merged,
        parseCfg(readFileSync(/* turbopackIgnore: true */ path, "utf8"))
      );
    }
  } catch {
    /* ignore */
  }
  cache = merged;
  return merged;
}

export function serverCfgValue(key: string): string {
  const env = (process.env[key] || "").trim();
  if (env) return env;
  return (readServerCfg()[key] || "").trim();
}

export function resetServerCfgCache(): void {
  cache = null;
}
