import { nextPayRefFromItems } from "./pay-ref";
import { getProofItems, proofRemaining } from "./proofs";
import type { AppSettings, Order } from "./types";
import {
  buildUpiPayUrl,
  chooseQrMode,
  listPayableAccounts,
  paymentAmountDue,
  type QrDisplayMode,
} from "./upi";

export type OrderPayIntent = {
  amount: number;
  payRef: string;
  upiUrl: string | null;
  staticQrDataUrl: string | null;
  mode: QrDisplayMode;
};

/** Remaining amount the dealer still has to pay, with UPI intent / static QR. */
export function resolveOrderPay(
  settings: AppSettings | null | undefined,
  order: Order | null | undefined
): OrderPayIntent | null {
  if (!settings || !order) return null;
  if (order.status === "cancelled" || order.status === "payment_verified") {
    return null;
  }
  if (
    order.status !== "payment_pending" &&
    order.packingSlip?.status !== "finalized"
  ) {
    return null;
  }
  const due = paymentAmountDue(order);
  const amount = proofRemaining(order.paymentProof, due);
  if (!(amount > 0)) return null;
  const accounts = listPayableAccounts(settings);
  const account = accounts[0];
  if (!account) return null;
  const payRef = nextPayRefFromItems(
    order.orderNumber,
    getProofItems(order.paymentProof)
  );
  const decision = chooseQrMode(account, amount, settings);
  const upiUrl =
    decision.mode === "upi_amount"
      ? buildUpiPayUrl({
          upiId: account.upiId || "",
          payeeName:
            account.upiPayeeName || settings.upiPayeeName || settings.companyName,
          amount,
          note: payRef.slice(0, 50),
        })
      : null;
  const staticQrDataUrl =
    decision.mode === "static" ? account.staticQrDataUrl?.trim() || null : null;
  return {
    amount,
    payRef,
    upiUrl,
    staticQrDataUrl,
    mode: decision.mode,
  };
}

export function dataUrlBase64(dataUrl: string): string | undefined {
  const m = /^data:[^;]+;base64,(.+)$/i.exec(dataUrl.trim());
  return m?.[1];
}
