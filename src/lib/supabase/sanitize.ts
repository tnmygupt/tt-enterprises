import type { AppDatabase } from "@/lib/store/db";

/**
 * Strip plaintext admin-visible passwords + unrehostable blobs before cloud write.
 * Keeps passwordHash so server login / merge still work.
 */
export function sanitizeDbForCloud(db: AppDatabase): AppDatabase {
  const clone = JSON.parse(JSON.stringify(db)) as AppDatabase;

  for (const u of clone.users ?? []) {
    if ("passwordVisible" in u) {
      delete (u as { passwordVisible?: string }).passwordVisible;
    }
  }

  for (const order of clone.orders ?? []) {
    if (order.billFileDataUrl?.startsWith("data:")) {
      order.billFileDataUrl = undefined;
    }
    if (order.lrFileDataUrl?.startsWith("data:")) {
      order.lrFileDataUrl = undefined;
    }
    if (order.paymentProof?.imageDataUrl?.startsWith("data:")) {
      order.paymentProof.imageDataUrl = undefined;
    }
    if (order.paymentProof?.items?.length) {
      order.paymentProof.items = order.paymentProof.items.map((item) =>
        item.url?.startsWith("data:") ? { ...item, url: "" } : item
      );
    }
  }

  for (const v of clone.vouchers ?? []) {
    if (v.packingSlipDataUrl?.startsWith("data:")) {
      v.packingSlipDataUrl = undefined;
    }
  }
  for (const g of clone.goodsReceipts ?? []) {
    if (g.packingSlipDataUrl?.startsWith("data:")) {
      g.packingSlipDataUrl = undefined;
    }
  }

  for (const dep of clone.walletDeposits ?? []) {
    if (dep.proof?.imageDataUrl?.startsWith("data:")) {
      dep.proof.imageDataUrl = undefined;
    }
    if (dep.proof?.items?.length) {
      dep.proof.items = dep.proof.items.map((item) =>
        item.url?.startsWith("data:") ? { ...item, url: "" } : item
      );
    }
  }

  for (const p of clone.products ?? []) {
    if (p.logoUrl?.startsWith("data:")) p.logoUrl = "";
    p.media = (p.media ?? []).filter((m) => !m.url?.startsWith("data:"));
  }

  const settings = clone.settings;
  if (settings?.bankAccounts?.length) {
    for (const a of settings.bankAccounts) {
      if (a.staticQrDataUrl?.startsWith("data:")) {
        if (a.staticQrDataUrl.length > 400_000) {
          a.staticQrDataUrl = undefined;
        }
      }
    }
  }

  return clone;
}

/** Safe for browser clients — never send password hashes. */
export function sanitizeDbForClient(db: AppDatabase): AppDatabase {
  const clone = sanitizeDbForCloud(db);
  for (const u of clone.users ?? []) {
    (u as { passwordHash?: string }).passwordHash = "";
    if ("passwordVisible" in u) {
      delete (u as { passwordVisible?: string }).passwordVisible;
    }
  }
  return clone;
}

/** Preserve existing hashes when client push omitted them (after client sanitize). */
export function mergePasswordHashes(
  incoming: AppDatabase,
  existing: AppDatabase | null
): AppDatabase {
  if (!existing?.users?.length) return incoming;
  const byId = new Map(
    existing.users.map((u) => [u.id, u.passwordHash] as const)
  );
  const byPhone = new Map(
    existing.users.map((u) => [u.phone.replace(/\D/g, ""), u.passwordHash] as const)
  );
  for (const u of incoming.users ?? []) {
    if (u.passwordHash) continue;
    const kept =
      byId.get(u.id) || byPhone.get((u.phone || "").replace(/\D/g, ""));
    if (kept) u.passwordHash = kept;
  }
  return incoming;
}
