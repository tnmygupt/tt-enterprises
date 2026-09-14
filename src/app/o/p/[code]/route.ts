import { NextRequest, NextResponse } from "next/server";
import { cloudGetAppDb } from "@/lib/server/app-db";
import { publicRedirect } from "@/lib/server/public-origin";
import { readSessionCookie } from "@/lib/server/session";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { findOrderByCode } from "@/lib/wa-format";

function pickLocale(req: NextRequest): "en" | "hi" {
  const cookie = req.cookies.get("NEXT_LOCALE")?.value;
  if (cookie === "hi" || cookie === "en") return cookie;
  const session = readSessionCookie(req);
  if (session?.locale === "hi") return "hi";
  return "en";
}

/** Short packing-slip PDF link: /o/p/TT-104 */
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

  const pdf = (order.packingSlip?.customerPdfUrl || "").trim();
  if (/^https:\/\//i.test(pdf)) {
    return NextResponse.redirect(pdf);
  }
  return publicRedirect(req, `/${locale}/orders/${order.id}`);
}
