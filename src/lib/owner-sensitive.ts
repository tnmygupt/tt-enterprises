/** Purchase-side vouchers whose rupee figures are owner-only (cost / mill bills). */
export function isPurchaseCostVoucherType(type: string): boolean {
  return type === "purchase" || type === "debit_note";
}

/**
 * Staff UI mask for mill-side money. Cash/bank book still shows operational
 * rupees; this only hides purchase bills, debit notes, and mill payments.
 */
export function staffMustHideVoucherRupees(
  type: string,
  canSeeOwnerFinancials: boolean
): boolean {
  if (canSeeOwnerFinancials) return false;
  return isPurchaseCostVoucherType(type) || type === "payment";
}
