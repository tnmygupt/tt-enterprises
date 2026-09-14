import { NextRequest } from "next/server";
import { cloudGetAppDb } from "@/lib/server/app-db";
import { openAppOrWebsite } from "@/lib/server/open-app";
import { publicRedirect } from "@/lib/server/public-origin";
import { isStaffRole, readSessionCookie } from "@/lib/server/session";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { findOrderByCode } from "@/lib/wa-format";

function pickLocale(req: NextRequest): "en" | "hi" {
  const cookie = req.cookies.get("NEXT_LOCALE")?.value;
  if (cookie === "hi" || cookie === "en") return cookie;
  const session = readSessionCookie(req);
  if (session?.locale === "hi") return "hi";
  return "en";
}

/** Short WhatsApp link: /o/TT-104 → order page. */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const locale = pickLocale(req);
  const fallback = `/${locale}/orders`;

  if (!isSupabaseConfigured()) {
    return publicRedirect(req, fallback);
  }

  const got = await cloudGetAppDb();
  const order = findOrderByCode(got.db?.orders, code);
  if (!order) return publicRedirect(req, fallback);

  const session = readSessionCookie(req);
  const pay = req.nextUrl.searchParams.get("pay") === "1" ? "?pay=1" : "";
  const path =
    session && isStaffRole(session.role)
      ? `/${locale}/admin/orders/${order.id}${pay}`
      : `/${locale}/orders/${order.id}${pay}`;
  return openAppOrWebsite(req, path, order.orderNumber);
}
