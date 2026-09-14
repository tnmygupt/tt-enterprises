import { NextRequest, NextResponse } from "next/server";
import { siteUrl } from "../site";

function firstHeader(req: NextRequest, name: string): string {
  return (req.headers.get(name) || "").split(",")[0].trim();
}

function hostnameOf(host: string): string {
  return host.replace(/^\[|\]$/g, "").replace(/:\d+$/, "").toLowerCase();
}

/** Bind / loopback / raw-IP hosts that browsers cannot open from a phone. */
export function isPrivateHost(host: string): boolean {
  const h = hostnameOf(host);
  if (!h) return true;
  if (h === "localhost" || h === "0.0.0.0" || h === "::1" || h === "[::1]") {
    return true;
  }
  if (h.startsWith("127.")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  return false;
}

/** Public https origin for redirects (never 0.0.0.0 / localhost). */
export function publicOrigin(req: NextRequest): string {
  const candidates = [
    firstHeader(req, "x-forwarded-host"),
    firstHeader(req, "host"),
    req.nextUrl.host,
  ];
  for (const raw of candidates) {
    if (!raw || isPrivateHost(raw)) continue;
    const host = hostnameOf(raw);
    const proto = firstHeader(req, "x-forwarded-proto") || "https";
    return `${proto === "http" ? "http" : "https"}://${host}`;
  }
  return siteUrl().replace(/\/$/, "");
}

export function publicRedirect(
  req: NextRequest,
  path: string,
  status: 307 | 308 = 307
): NextResponse {
  const dest = path.startsWith("/") ? path : `/${path}`;
  const res = NextResponse.redirect(new URL(dest, `${publicOrigin(req)}/`), status);
  res.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, max-age=0, must-revalidate"
  );
  return res;
}
