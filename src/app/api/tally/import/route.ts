import { NextRequest, NextResponse } from "next/server";
import { capabilityContextFrom, userHasCapability } from "@/lib/capabilities";
import { resolveCloudActor } from "@/lib/server/authorize-db";
import { isStaffRole, readSessionCookie } from "@/lib/server/session";
import { withTallyDb } from "@/lib/server/tally-store";
import {
  namesFromCsv,
  namesFromXlsx,
  registryFromNames,
} from "@/lib/tally-import";
import { tallyRegistrySummary, upsertTallyRegistry } from "@/lib/tally-sync";

/**
 * One-time upload of a Tally "List of Accounts" export.
 * Writes raw item or ledger names only. Never creates products or dealers.
 */
export async function POST(req: NextRequest) {
  const session = readSessionCookie(req);
  if (!session || !isStaffRole(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload" }, { status: 400 });
  }
  const kind = form.get("kind") === "ledgers" ? "ledgers" : "items";
  const file = form.get("file");
  if (!(file instanceof File) || file.size <= 0) {
    return NextResponse.json({ error: "Choose a CSV or Excel file" }, { status: 400 });
  }
  if (file.size > 8_000_000) {
    return NextResponse.json({ error: "File is larger than 8 MB" }, { status: 400 });
  }

  const lower = file.name.toLowerCase();
  let names: string[] = [];
  try {
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      names = await namesFromXlsx(await file.arrayBuffer());
    } else {
      names = namesFromCsv(await file.text());
    }
  } catch {
    return NextResponse.json({ error: "Could not read that file" }, { status: 400 });
  }
  if (!names.length) {
    return NextResponse.json(
      { error: "No names found. Export List of Accounts with a Name column." },
      { status: 400 }
    );
  }

  const written = await withTallyDb((db) => {
    const actor = resolveCloudActor(db, session);
    if (
      !isStaffRole(actor.role) ||
      !userHasCapability(actor.actor, "manage_products", capabilityContextFrom(db))
    ) {
      throw new Error("You cannot import Tally masters");
    }
    const result = upsertTallyRegistry(db, {
      ...registryFromNames(kind, names),
      full: false,
      source: "import",
    });
    return { result, summary: tallyRegistrySummary(db), names: names.length };
  });
  if (!written.ok) {
    const status = written.error === "You cannot import Tally masters" ? 403 : written.status;
    return NextResponse.json({ error: written.error }, { status });
  }

  const counts = kind === "ledgers" ? written.value.result.ledgers : written.value.result.items;
  return NextResponse.json({
    ok: true,
    kind,
    received: written.value.names,
    created: counts.created,
    updated: counts.updated,
    summary: written.value.summary,
  });
}
