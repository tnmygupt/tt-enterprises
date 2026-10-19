import { stockAlertsFromDb } from "@/lib/accounting/analysis";
import { orderHasLr } from "@/lib/store/db";
import { pendingOwnerApprovals } from "@/lib/owner-approvals";
import { tallyRegistrySummary } from "@/lib/tally-sync";
import type {
  AppSettings,
  Order,
  OwnerApproval,
  Product,
  PurchaseOrder,
  StockMovement,
  TallyItem,
  TallyLedger,
  TallyPost,
  UserProfile,
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
  | "need_owner_approval"
  | "need_tally_link";

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
        users?: UserProfile[];
        tallyItems?: TallyItem[];
        tallyLedgers?: TallyLedger[];
        tallyPosts?: TallyPost[];
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
  needTallyLink: number;
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
  const needTallyLink = db
    ? tallyRegistrySummary({
        products: db.products ?? [],
        orders,
        users: db.users ?? [],
        tallyItems: db.tallyItems,
        tallyLedgers: db.tallyLedgers,
        tallyPosts: db.tallyPosts ?? [],
        settings: db.settings,
      }).needsLink
    : 0;

  return {
    needConfirm,
    needBill,
    needVerifyPayment,
    needLr,
    fullTruck,
    needVoucher,
    reorderCount,
    needOwnerApproval,
    needTallyLink,
    counts: {
      need_confirm: needConfirm.length,
      need_bill: needBill.length,
      need_verify_payment: needVerifyPayment.length,
      need_lr: needLr.length,
      full_truck: fullTruck.length,
      need_voucher: needVoucher.length,
      need_reorder: reorderCount,
      need_owner_approval: needOwnerApproval,
      need_tally_link: needTallyLink,
    },
  };
}

export type OrderNextActionKey =
  | "cancelled"
  | "done"
  | "confirmBill"
  | "uploadBill"
  | "verifyPayment"
  | "dispatchLr"
  | "uploadLr"
  | "markDelivered"
  | "waitProof"
  | "open";

export function orderNextActionKey(order: Order): OrderNextActionKey {
  if (order.status === "cancelled") return "cancelled";
  if (order.status === "delivered") return "done";
  if (order.status === "estimate") return "confirmBill";
  if (order.status === "confirmed" && order.actualBillAmount == null) {
    return "uploadBill";
  }
  if (order.paymentProof && !order.paymentProof.verified) {
    return "verifyPayment";
  }
  if (order.status === "payment_verified") return "dispatchLr";
  if (order.status === "dispatched" && !orderHasLr(order)) return "uploadLr";
  if (order.status === "dispatched") return "markDelivered";
  if (order.status === "payment_pending" && !order.paymentProof) {
    return "waitProof";
  }
  return "open";
}

const NEXT_ACTION_EN: Record<OrderNextActionKey, string> = {
  cancelled: "Cancelled",
  done: "Done",
  confirmBill: "Confirm / upload bill",
  uploadBill: "Upload bill",
  verifyPayment: "Verify payment",
  dispatchLr: "Dispatch or upload LR → delivered",
  uploadLr: "Upload LR → delivered",
  markDelivered: "Mark delivered",
  waitProof: "Waiting for payment proof",
  open: "Open order",
};

const NEXT_ACTION_MSG: Record<OrderNextActionKey, string> = {
  cancelled: "nextActionCancelled",
  done: "nextActionDone",
  confirmBill: "nextActionConfirmBill",
  uploadBill: "nextActionUploadBill",
  verifyPayment: "nextActionVerifyPayment",
  dispatchLr: "nextActionDispatchLr",
  uploadLr: "nextActionUploadLr",
  markDelivered: "nextActionMarkDelivered",
  waitProof: "nextActionWaitProof",
  open: "nextActionOpen",
};

export function orderNextActionLabelKey(order: Order): string {
  return NEXT_ACTION_MSG[orderNextActionKey(order)];
}

/** English fallback for stored tracking rows; UI should prefer `orderNextActionKey`. */
export function orderNextAction(order: Order): string {
  return NEXT_ACTION_EN[orderNextActionKey(order)];
}

/** Where the desk should send staff for the current next action. */
export function orderNextActionHref(order: Pick<Order, "id"> & Order): string {
  const key = orderNextActionKey(order);
  if (key === "confirmBill" || key === "uploadBill") {
    return `/admin/orders/${order.id}/packing-slip`;
  }
  return `/orders/${order.id}`;
}
