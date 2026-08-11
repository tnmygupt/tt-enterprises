import type { PaymentProof, PaymentProofItem } from "./types";

/**
 * Normalized list of proof items. Handles legacy rows where only the singular
 * `imageDataUrl` / `note` was written (no `items` array). Returns the array in
 * upload order, oldest first.
 */
export function getProofItems(proof: PaymentProof | undefined): PaymentProofItem[] {
  if (!proof) return [];
  const modern = proof.items ?? [];
  if (modern.length) return modern;
  if (proof.imageDataUrl) {
    const isPdf =
      /^data:application\/pdf/i.test(proof.imageDataUrl) ||
      /\.pdf(\?|$)/i.test(proof.imageDataUrl);
    return [
      {
        id: "legacy",
        url: proof.imageDataUrl,
        type: isPdf ? "pdf" : "image",
        note: proof.note,
        uploadedAt: proof.uploadedAt,
      },
    ];
  }
  return [];
}

/** Total money submitted across every uploaded proof item. */
export function proofPaidTotal(proof: PaymentProof | undefined): number {
  const items = getProofItems(proof);
  let total = 0;
  for (const item of items) {
    if (typeof item.amount === "number" && Number.isFinite(item.amount)) {
      total += Math.max(0, item.amount);
    }
  }
  return Math.round(total * 100) / 100;
}

/** How much is still owed after all uploaded proofs (never negative). */
export function proofRemaining(
  proof: PaymentProof | undefined,
  amountDue: number
): number {
  return Math.max(0, Math.round((amountDue - proofPaidTotal(proof)) * 100) / 100);
}
