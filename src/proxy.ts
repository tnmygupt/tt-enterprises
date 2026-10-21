// Next.js 16 renamed the middleware file convention to `proxy`.
// See: node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md
import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import {
  SESSION_COOKIE_NAME,
  isStaffRole,
  verifySessionToken,
} from "./lib/server/session";
import { wwwApexRedirect } from "./lib/server/public-origin";

const handleI18nRouting = createMiddleware(routing);

const ADMIN_PATH = /^\/(en|hi)\/admin(?:\/|$)/;
const PACK_HOSTS = new Set(["pack.ttenterprises.shop"]);

function requestHost(req: NextRequest): string {
  return (req.headers.get("x-forwarded-host") || req.headers.get("host") || "")
    .split(",")[0]
    .trim()
    .replace(/:\d+$/, "")
    .toLowerCase();
}

/** pack.ttenterprises.shop is a separate packing book, not the shop orders. */
function packHostRedirect(req: NextRequest): NextResponse | null {
  const host = requestHost(req);
  if (host === "www.pack.ttenterprises.shop") {
    const url = req.nextUrl.clone();
    url.hostname = "pack.ttenterprises.shop";
    url.port = "";
    return NextResponse.redirect(url, 308);
  }
  if (!PACK_HOSTS.has(host)) return null;
  const path = req.nextUrl.pathname;
  if (path.startsWith("/api") || path.startsWith("/_next")) return null;
  const locale = path.startsWith("/hi") ? "hi" : "en";
  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = verifySessionToken(token);
  const staff = !!session && isStaffRole(session.role);
  const onLogin =
    path === "/pack/login" ||
    path === "/en/pack/login" ||
    path === "/hi/pack/login";
  const onPack =
    path === "/pack" ||
    path.startsWith("/pack/") ||
    /^\/(en|hi)\/pack(\/|$)/.test(path);
  const url = req.nextUrl.clone();
  url.search = "";
  if (!staff) {
    if (onLogin) return null;
    url.pathname = `/${locale}/pack/login`;
    return NextResponse.redirect(url);
  }
  if (onLogin || !onPack) {
    url.pathname = `/${locale}/pack`;
    return NextResponse.redirect(url);
  }
  return null;
}

/** Books, HR, production, and audit stay in the repo but are off the working site. */
const RETIRED_ADMIN =
  /^\/(en|hi)\/admin\/(accounts|hr|wallets|owner|audit)(?:\/|$|\?)/;

/**
 * Optimistic auth gate for the prerendered /admin pages, which would otherwise
 * be served to anyone. This only reads the signed session cookie — the real
 * authorization still happens in /api/db, which rebinds the role from the cloud
 * on every request. Fails closed: an unreadable cookie sends the user home.
 */
export default function proxy(req: NextRequest) {
  const apex = wwwApexRedirect(req);
  if (apex) return apex;

  const pack = packHostRedirect(req);
  if (pack) return pack;

  const retired = req.nextUrl.pathname.match(RETIRED_ADMIN);
  if (retired) {
    const url = req.nextUrl.clone();
    url.pathname = `/${retired[1]}/admin`;
    url.search = "";
    return NextResponse.redirect(url);
  }

  const adminMatch = req.nextUrl.pathname.match(ADMIN_PATH);
  if (adminMatch) {
    const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
    const session = verifySessionToken(token);
    if (!session || !isStaffRole(session.role)) {
      const url = req.nextUrl.clone();
      url.pathname = `/${adminMatch[1]}`;
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  // Hostinger CDN pinned bare /en|/hi HTML with s-maxage=1y. Always ensure
  // cache-bust `v=4` on locale home (keeps ?source=pwa and other params).
  const bareLocale = req.nextUrl.pathname.match(/^\/(en|hi)\/?$/);
  if (bareLocale && req.nextUrl.searchParams.get("v") !== "4") {
    const url = req.nextUrl.clone();
    url.pathname = `/${bareLocale[1]}`;
    url.searchParams.set("v", "4");
    const redirect = NextResponse.redirect(url, 307);
    redirect.headers.set(
      "Cache-Control",
      "private, no-cache, no-store, max-age=0, must-revalidate"
    );
    return redirect;
  }

  const res = handleI18nRouting(req);
  // Ensure locale HTML responses are never stored by CDN again
  res.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, max-age=0, must-revalidate"
  );
  res.headers.set("CDN-Cache-Control", "no-store");
  return res;
}

export const config = {
  matcher: [
    "/",
    "/(en|hi)/:path*",
    "/((?!api|_next|_vercel|o(?:/|$)|g(?:/|$)|.*\\..*).*)",
  ],
};
