import { NextRequest, NextResponse } from "next/server";
import { isStaffRole, readSessionCookie } from "@/lib/server/session";
import { rateLimit } from "@/lib/server/rate-limit";
import {
  createPackSlipRecord,
  listPackSlips,
  packStoreError,
} from "@/lib/server/pack-slip-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function staff(req: NextRequest) {
  const session = readSessionCookie(req);
  if (!session || !isStaffRole(session.role)) return null;
  return session;
}

export async function GET(req: NextRequest) {
  const session = staff(req);
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  try {
    const slips = await listPackSlips();
    return NextResponse.json({ slips });
  } catch (err) {
    const mapped = packStoreError(err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

export async function POST(req: NextRequest) {
  const session = staff(req);
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const limited = rateLimit(`pack-create:${session.id}`, 60, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many slips. Wait a moment." }, { status: 429 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const slip = await createPackSlipRecord(body);
    return NextResponse.json({ slip }, { status: 201 });
  } catch (err) {
    const mapped = packStoreError(err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
