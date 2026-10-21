import { NextRequest, NextResponse } from "next/server";
import { isStaffRole, readSessionCookie } from "@/lib/server/session";
import { rateLimit } from "@/lib/server/rate-limit";
import {
  deletePackSlipRecord,
  getPackSlip,
  packStoreError,
  updatePackSlipRecord,
} from "@/lib/server/pack-slip-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function staff(req: NextRequest) {
  const session = readSessionCookie(req);
  if (!session || !isStaffRole(session.role)) return null;
  return session;
}

function slipId(id: string): string | null {
  return /^ps_[a-z0-9]{8,40}$/.test(id) ? id : null;
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = staff(req);
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const id = slipId((await context.params).id);
  if (!id) return NextResponse.json({ error: "Slip not found" }, { status: 404 });
  try {
    const slip = await getPackSlip(id);
    if (!slip) return NextResponse.json({ error: "Slip not found" }, { status: 404 });
    return NextResponse.json({ slip });
  } catch (err) {
    const mapped = packStoreError(err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = staff(req);
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const limited = rateLimit(`pack-save:${session.id}`, 180, 60_000);
  if (!limited.ok) {
    return NextResponse.json({ error: "Too many saves. Wait a moment." }, { status: 429 });
  }
  const id = slipId((await context.params).id);
  if (!id) return NextResponse.json({ error: "Slip not found" }, { status: 404 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    const slip = await updatePackSlipRecord(id, body);
    return NextResponse.json({ slip });
  } catch (err) {
    const mapped = packStoreError(err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = staff(req);
  if (!session) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const id = slipId((await context.params).id);
  if (!id) return NextResponse.json({ error: "Slip not found" }, { status: 404 });
  try {
    const removed = await deletePackSlipRecord(id);
    if (!removed) return NextResponse.json({ error: "Slip not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const mapped = packStoreError(err);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
