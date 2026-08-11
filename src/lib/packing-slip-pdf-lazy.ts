"use client";

type PackingSlipPdfModule = typeof import("./packing-slip-pdf");

let cached: Promise<PackingSlipPdfModule> | null = null;

/**
 * jsPDF + autotable are only needed when someone saves a slip. Keeping the
 * promise cached lets a pointerdown warm the chunk so the later click still
 * counts as a user gesture on iOS Safari.
 */
export function loadPackingSlipPdf(): Promise<PackingSlipPdfModule> {
  if (!cached) cached = import("./packing-slip-pdf");
  return cached;
}
