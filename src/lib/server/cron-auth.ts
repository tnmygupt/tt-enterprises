import { NextRequest } from "next/server";
import { readServerCfg, serverCfgValue } from "@/lib/server/read-cfg";

/** Hostinger cron: Authorization Bearer CRON_SECRET, or ?secret= for simple curl. */
export function cronSecrets(): string[] {
  const found = new Set<string>();
  const env = (process.env.CRON_SECRET || "").trim();
  if (env) found.add(env);
  const file = (readServerCfg().CRON_SECRET || "").trim();
  if (file) found.add(file);
  const cfg = serverCfgValue("CRON_SECRET");
  if (cfg) found.add(cfg);
  return [...found];
}

export function authorizeCron(req: NextRequest): boolean {
  const allowed = cronSecrets();
  if (!allowed.length) return false;
  const header = req.headers.get("authorization") || "";
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const query = req.nextUrl.searchParams.get("secret")?.trim();
  const provided = bearer || query || "";
  return !!provided && allowed.includes(provided);
}
