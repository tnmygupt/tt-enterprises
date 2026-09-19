import { stockAlertsFromDb } from "@/lib/accounting/analysis";
import { orderHasLr } from "@/lib/store/db";
import { pendingOwnerApprovals } from "@/lib/owner-approvals";
import type {
  AppSettings,
  Order,
  OwnerApproval,
  Product,
  PurchaseOrder,
  StockMovement,
  Voucher,
} from "@/lib/types";

export type AdminQueueKey =
  | "need_confirm"
  | "need_bill"
  | "need_verify_payment"
  | "need_lr"
  | "full_truck"
  | "need_voucher"
  | "need_reorder"
  | "need_owner_approval";

export function orderNeedsSaleVoucher(
  order: Order,
  vouchers: Pick<Voucher, "linkedOrderId" | "type" | "voided">[]
): boolean {
  return (
    order.status !== "cancelled" &&
    order.actualBillAmount != null &&
    !vouchers.some(
      (v) => v.linkedOrderId === order.id && v.type === "sale" && !v.voided
    )
  );
}

export function getAdminQueues(
  db:
    | {
        orders?: Order[];
        vouchers?: Pick<Voucher, "linkedOrderId" | "type" | "voided">[];
        products?: Product[];
        stockMovements?: StockMovement[];
        purchaseOrders?: PurchaseOrder[];
        settings?: AppSettings;
        ownerApprovals?: OwnerApproval[];
      }
    | null
    | undefined
): {
  needConfirm: Order[];
  needBill: Order[];
  needVerifyPayment: Order[];
  needLr: Order[];
  fullTruck: Order[];
  needVoucher: Order[];
  reorderCount: number;
  needOwnerApproval: number;
  counts: Record<AdminQueueKey, number>;
} {
  const orders = db?.orders ?? [];
  const vouchers = db?.vouchers ?? [];
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
  const needLr = orders.filter(
    (o) => o.status === "dispatched" && !orderHasLr(o)
  );
  const fullTruck = orders.filter(
    (o) =>
      o.fullTruckRequested &&
      o.status !== "delivered" &&
      o.status !== "cancelled"
  );
  const needVoucher = orders.filter((o) =>
    orderNeedsSaleVoucher(o, vouchers)
  );
  const reorderCount = db?.products
    ? stockAlertsFromDb({
        products: db.products,
        stockMovements: db.stockMovements,
        orders: db.orders,
        purchaseOrders: db.purchaseOrders,
        settings: db.settings,
      }).filter((row) => row.kind === "reorder").length
    : 0;
  const needOwnerApproval = pendingOwnerApprovals(db?.ownerApprovals).length;

  return {
    needConfirm,
    needBill,
    needVerifyPayment,
    needLr,
    fullTruck,
    needVoucher,
    reorderCount,
    needOwnerApproval,
    counts: {
      need_confirm: needConfirm.length,
      need_bill: needBill.length,
      need_verify_payment: needVerifyPayment.length,
      need_lr: needLr.length,
      full_truck: fullTruck.length,
      need_voucher: needVoucher.length,
      need_reorder: reorderCount,
      need_owner_approval: needOwnerApproval,
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
