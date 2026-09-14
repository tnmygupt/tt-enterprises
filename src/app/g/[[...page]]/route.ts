import { NextRequest } from "next/server";
import { openAppOrWebsite } from "@/lib/server/open-app";
import { readSessionCookie } from "@/lib/server/session";

const PAGES: Record<string, string> = {
  "": "/catalog",
  catalog: "/catalog",
  orders: "/orders",
  schemes: "/schemes",
  users: "/admin/users",
  receivables: "/admin/accounts/receivables",
  purchases: "/admin/accounts/purchases",
};

function pickLocale(req: NextRequest): "en" | "hi" {
  const cookie = req.cookies.get("NEXT_LOCALE")?.value;
  if (cookie === "hi" || cookie === "en") return cookie;
  const session = readSessionCookie(req);
  if (session?.locale === "hi") return "hi";
  return "en";
}

/** Short go-links used in WhatsApp: /g , /g/orders */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ page?: string[] }> }
) {
  const { page } = await context.params;
  const key = (page ?? []).join("/");
  const locale = pickLocale(req);
  const dest = PAGES[key] || "/catalog";
  return openAppOrWebsite(req, `/${locale}${dest}`);
}
