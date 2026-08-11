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

const handleI18nRouting = createMiddleware(routing);

const ADMIN_PATH = /^\/(en|hi)\/admin(?:\/|$)/;

/**
 * Optimistic auth gate for the prerendered /admin pages, which would otherwise
 * be served to anyone. This only reads the signed session cookie — the real
 * authorization still happens in /api/db, which rebinds the role from the cloud
 * on every request. Fails closed: an unreadable cookie sends the user home.
 */
export default function proxy(req: NextRequest) {
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
  matcher: ["/", "/(en|hi)/:path*", "/((?!api|_next|_vercel|.*\\..*).*)"],
};
