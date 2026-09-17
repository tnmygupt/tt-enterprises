import { roundOffRupees } from "./pricing";
import type { AppSettings, BankAccountDetails } from "./types";

/**
 * Default UPI per-transaction cap. Most Indian banks limit UPI to ₹1L per txn
 * (some raise it for verified merchants / education / capital markets but this
 * is the safe universal limit). Admins can override via `settings.upiMaxAmount`.
 */
export const UPI_MAX_AMOUNT_DEFAULT = 100000;

/** Build UPI deep-link with fixed amount (pa = UPI ID, am = amount). */
export function buildUpiPayUrl(opts: {
  upiId: string;
  payeeName: string;
  amount: number;
  note?: string;
}): string | null {
  const pa = opts.upiId.trim();
  if (!pa) return null;
  const am = Math.max(0, Number(opts.amount) || 0);
  if (am <= 0) return null;

  const params = new URLSearchParams({
    pa,
    pn: opts.payeeName.trim() || "T T Enterprises",
    am: am.toFixed(2),
    cu: "INR",
  });
  const tn = opts.note?.trim();
  if (tn) params.set("tn", tn.slice(0, 50));

  return `upi://pay?${params.toString()}`;
}

export function paymentAmountDue(order: {
  actualBillAmount?: number;
  estimatedTotal: number;
  walletUsed?: number;
}): number {
  // estimatedTotal is already net of wallet at checkout — do not subtract again.
  if (!(order.actualBillAmount && order.actualBillAmount > 0)) {
    return Math.max(0, roundOffRupees(order.estimatedTotal));
  }
  // Final bill is typically gross; subtract wallet once for amount still payable.
  const wallet = Math.max(0, order.walletUsed || 0);
  return Math.max(0, roundOffRupees(order.actualBillAmount - wallet));
}

/**
 * Stored payment accounts, or a one-row fallback from the legacy singleton.
 * Pass `{ includeInactive: true }` for the admin editor so deactivated rows
 * are not dropped on the next save.
 */
export function listStoredPayableAccounts(
  settings: AppSettings,
  opts?: { includeInactive?: boolean }
): BankAccountDetails[] {
  const stored = (settings.bankAccounts ?? []).filter(Boolean);
  let rows: BankAccountDetails[];
  if (stored.length) {
    rows = stored.map((a) => hydrateAccount(a, settings));
  } else {
    const legacy = settings.bankAccount;
    if (legacy && (legacy.accountNumber?.trim() || settings.upiId?.trim())) {
      rows = [
        hydrateAccount(
          {
            ...legacy,
            id: legacy.id || "bank_legacy",
            ledgerId: legacy.ledgerId || "acct_bank",
            isDefault: true,
            active: true,
          },
          settings
        ),
      ];
    } else {
      rows = [];
    }
  }
  if (opts?.includeInactive) return rows;
  return rows.filter((a) => a.active !== false);
}

/**
 * Return every payable bank account, migrating the legacy singleton
 * `settings.bankAccount` + `settings.upiId` combo when the multi-account
 * array is empty. Result is always in "preferred first" order (default → rest).
 */
export function listPayableAccounts(settings: AppSettings): BankAccountDetails[] {
  const explicit = listStoredPayableAccounts(settings);
  return [...explicit].sort((a, b) => {
    if (!!b.isDefault !== !!a.isDefault) return b.isDefault ? 1 : -1;
    return 0;
  });
}

function hydrateAccount(
  account: BankAccountDetails,
  settings: AppSettings
): BankAccountDetails {
  return {
    ...account,
    id: account.id || `bank_${account.accountNumber || settings.upiId || "default"}`,
    label:
      account.label?.trim() ||
      account.bankName?.trim() ||
      account.accountName?.trim() ||
      "Account",
    upiId: account.upiId?.trim() || settings.upiId?.trim() || "",
    upiPayeeName:
      account.upiPayeeName?.trim() ||
      settings.upiPayeeName?.trim() ||
      settings.companyName ||
      "",
    active: account.active !== false,
  };
}

export function hasBankDetails(account: BankAccountDetails | null | undefined): boolean {
  if (!account) return false;
  return Boolean(
    account.accountName?.trim() &&
      account.accountNumber?.trim() &&
      account.ifsc?.trim() &&
      account.bankName?.trim()
  );
}

export function hasUpiConfigured(account: BankAccountDetails | null | undefined): boolean {
  return Boolean(account?.upiId?.trim());
}

/**
 * Decide how to show the QR for `amount` on `account`, honouring the UPI
 * per-txn limit (`settings.upiMaxAmount` or the ₹1L default).
 *
 * - `mode: "upi_amount"` → generate an amount-preloaded QR from UPI intent
 * - `mode: "static"` → show the account's uploaded static QR (no amount)
 * - `mode: "none"` → account has no UPI *and* no static QR; render bank details only
 */
export type QrDisplayMode = "upi_amount" | "static" | "none";

export function chooseQrMode(
  account: BankAccountDetails,
  amount: number,
  settings: AppSettings
): { mode: QrDisplayMode; reason?: "over_upi_limit" | "no_upi" | "no_amount" } {
  const cap =
    settings.upiMaxAmount && settings.upiMaxAmount > 0
      ? settings.upiMaxAmount
      : UPI_MAX_AMOUNT_DEFAULT;
  const upi = account.upiId?.trim();
  const staticQr = account.staticQrDataUrl?.trim();

  if (!(amount > 0)) return { mode: "none", reason: "no_amount" };

  if (amount > cap) {
    if (staticQr) return { mode: "static", reason: "over_upi_limit" };
    return { mode: "none", reason: "over_upi_limit" };
  }

  if (upi) return { mode: "upi_amount" };
  if (staticQr) return { mode: "static" };
  return { mode: "none", reason: "no_upi" };
}
