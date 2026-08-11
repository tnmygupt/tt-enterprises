import { NextRequest, NextResponse } from "next/server";
import { getVapidPublicKey, vapidConfigured } from "@/lib/server/web-push";

export async function GET() {
  const publicKey = getVapidPublicKey();
  return NextResponse.json({
    configured: vapidConfigured(),
    publicKey: publicKey || null,
  });
}
