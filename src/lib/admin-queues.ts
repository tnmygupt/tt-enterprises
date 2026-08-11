import type { Order } from "@/lib/types";
import type { AppDatabase } from "@/lib/store/db";
import { orderHasLr } from "@/lib/store/db";

export type AdminQueueKey =
  | "need_confirm"
  | "need_bill"
  | "need_verify_payment"
  | "need_lr"
  | "full_truck";

export function getAdminQueues(db: AppDatabase | null | undefined): {
  needConfirm: Order[];
  needBill: Order[];
  needVerifyPayment: Order[];
  needLr: Order[];
  fullTruck: Order[];
  counts: Record<AdminQueueKey, number>;
} {
  const orders = db?.orders ?? [];
  const needConfirm = orders.filter((o) => o.status === "estimate");
  const needBill = orders.filter(
    (o) =>
      (o.status === "estimate" || o.status === "confirmed") &&
      o.actualBillAmount == null
  );
  const needVerifyPayment = orders.filter(
    (o) =>
      o.paymentProof &&
      !o.paymentProof.verified &&
      o.status !== "cancelled"
  );
  // After dispatch, LR is a separate pending step
  const needLr = orders.filter(
    (o) => o.status === "dispatched" && !orderHasLr(o)
  );
  const fullTruck = orders.filter(
    (o) =>
      o.fullTruckRequested &&
      o.status !== "delivered" &&
      o.status !== "cancelled"
  );

  return {
    needConfirm,
    needBill,
    needVerifyPayment,
    needLr,
    fullTruck,
    counts: {
      need_confirm: needConfirm.length,
      need_bill: needBill.length,
      need_verify_payment: needVerifyPayment.length,
      need_lr: needLr.length,
      full_truck: fullTruck.length,
    },
  };
}

export function orderNextAction(order: Order): string {
  if (order.status === "cancelled") return "Cancelled";
  if (order.status === "delivered") return "Done";
  if (order.status === "estimate") return "Confirm / upload bill";
  if (order.status === "confirmed" && order.actualBillAmount == null) {
    return "Upload bill";
  }
  if (order.paymentProof && !order.paymentProof.verified) {
    return "Verify payment";
  }
  if (order.status === "payment_verified") {
    return "Dispatch or upload LR → delivered";
  }
  if (order.status === "dispatched" && !orderHasLr(order)) {
    return "Upload LR → delivered";
  }
  if (order.status === "dispatched") return "Mark delivered";
  if (order.status === "payment_pending" && !order.paymentProof) {
    return "Waiting for payment proof";
  }
  return "Open order";
}
