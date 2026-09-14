import { nextPayRefFromItems } from "./pay-ref";
import { formatInr, roundMoney } from "./pricing";
import { getProofItems, proofPaidTotal, proofRemaining } from "./proofs";
import type {
  AppSettings,
  Locale,
  Order,
  OrderLine,
  OrderStatus,
  WhatsAppTemplateKey,
} from "./types";
import { resolveOrderPay } from "./wa-pay";

export const WA_TEMPLATE_KEYS: WhatsAppTemplateKey[] = [
  "order",
  "packing",
  "lr",
  "staffOrder",
];

export const WA_TEMPLATE_TOKENS = [
  "company",
  "name",
  "dealer",
  "phone",
  "order",
  "status",
  "items",
  "qty",
  "kg",
  "bill",
  "amount",
  "discount",
  "payment",
  "paid",
  "due",
  "shipping",
  "wallet",
  "lr",
  "transport",
  "note",
  "pdf",
  "pay",
  "link",
] as const;

const DEFAULTS: Record<WhatsAppTemplateKey, { en: string; hi: string }> = {
  order: {
    en: `*{company}*
*{order}*
{status}

{items}

{qty}
{kg}
Bill {bill}
{discount}
{payment}
{pay}

{lr}
{note}

{link}`,
    hi: `*{company}*
*{order}*
{status}

{items}

{qty}
{kg}
बिल {bill}
{discount}
{payment}
{pay}

{lr}
{note}

{link}`,
  },
  packing: {
    en: `*{company}*
Packing slip + bill
*{order}*
{status}

{items}

{qty}
{kg}
Bill {bill}
{discount}
{payment}
{pay}

{pdf}

{link}`,
    hi: `*{company}*
पैकिंग स्लिप + बिल
*{order}*
{status}

{items}

{qty}
{kg}
बिल {bill}
{discount}
{payment}
{pay}

{pdf}

{link}`,
  },
  lr: {
    en: `*{company}*
*{order}*
{status}

{lr}
{transport}

LR copy is attached in this chat.

{link}`,
    hi: `*{company}*
*{order}*
{status}

{lr}
{transport}

LR कॉपी इस चैट में अटैच है।

{link}`,
  },
  staffOrder: {
    en: `*{company}* — new estimate
*{order}* · {dealer}
{phone}

{items}

{qty}
{kg}
Amount {bill}
{payment}

{link}`,
    hi: `*{company}* — नया अनुमान
*{order}* · {dealer}
{phone}

{items}

{qty}
{kg}
राशि {bill}
{payment}

{link}`,
  },
};

export function defaultWaTemplate(
  key: WhatsAppTemplateKey,
  locale: Locale
): string {
  return DEFAULTS[key][locale];
}

export function resolveWaTemplate(
  key: WhatsAppTemplateKey,
  locale: Locale,
  settings?: AppSettings | null
): string {
  const custom = settings?.whatsappTemplates?.[key]?.[locale]?.trim();
  return custom || defaultWaTemplate(key, locale);
}

export function applyWaTemplate(
  template: string,
  vars: Record<string, string>
): string {
  let out = template.replace(/\{([a-z]+)\}/gi, (_, raw: string) => {
    const key = raw.toLowerCase();
    return vars[key] ?? "";
  });
  const leftoverLabel = /^(bill|बिल|amount|राशि)$/i;
  out = out
    .split("\n")
    .map((line) =>
      line
        .replace(/\s*·\s*$/g, "")
        .replace(/^\s*·\s*/g, "")
        .replace(/\s{2,}/g, " ")
        .trimEnd()
    )
    .filter((line) => !leftoverLabel.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out
    .split("\n")
    .filter((line, i, arr) => {
      if (line.trim()) return true;
      const prev = arr[i - 1]?.trim();
      const next = arr.slice(i + 1).find((l) => l.trim());
      return Boolean(prev && next);
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function siteBaseUrlForWa(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/$/, "");
  }
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    "https://tanmayphotos.space";
  return raw.replace(/\/+$/, "");
}

export function shortOrderUrl(orderNumber?: string, orderId?: string): string {
  const base = siteBaseUrlForWa();
  const code = (orderNumber || orderId || "").trim();
  if (!code) return `${base}/g/orders`;
  return `${base}/o/${encodeURIComponent(code)}`;
}

export function shortPackingPdfUrl(
  orderNumber?: string,
  fallbackHttps?: string
): string {
  const code = (orderNumber || "").trim();
  if (code) return `${siteBaseUrlForWa()}/o/p/${encodeURIComponent(code)}`;
  return fallbackHttps || "";
}

export function shortGoUrl(page = ""): string {
  const base = siteBaseUrlForWa();
  const p = page.replace(/^\//, "").replace(/^g\//, "");
  return p ? `${base}/g/${p}` : `${base}/g`;
}

export function shortCatalogUrl(): string {
  return shortGoUrl();
}

export function statusLabelWa(status: OrderStatus, locale: Locale): string {
  const en: Record<OrderStatus, string> = {
    estimate: "Status: Estimate received — office will confirm",
    confirmed: "Status: Confirmed — packing / weighment next",
    payment_pending: "Status: Bill ready — please pay now",
    payment_verified: "Status: Payment received — dispatch next",
    dispatched: "Status: Dispatched — LR coming",
    delivered: "Status: Delivered",
    cancelled: "Status: Cancelled",
  };
  const hi: Record<OrderStatus, string> = {
    estimate: "स्टेटस: अनुमान मिला — ऑफिस कन्फर्म करेगा",
    confirmed: "स्टेटस: कन्फर्म — पैकिंग / वजन अगला कदम",
    payment_pending: "स्टेटस: बिल तैयार — अभी पेमेंट करें",
    payment_verified: "स्टेटस: पेमेंट मिल गया — डिस्पैच अगला कदम",
    dispatched: "स्टेटस: डिस्पैच — LR आएगा",
    delivered: "स्टेटस: डिलीवर हो गया",
    cancelled: "स्टेटस: रद्द",
  };
  return (locale === "hi" ? hi : en)[status];
}

function loc(
  v: { en?: string; hi?: string } | undefined,
  locale: Locale
): string {
  return (v?.[locale] || v?.en || "").trim();
}

function lineItemLabel(line: OrderLine, locale: Locale): string {
  const name = loc(line.productName, locale) || line.productCode || "Item";
  const size = loc(line.size, locale) || loc(line.variationLabel, locale);
  const color = loc(line.colorName, locale);
  return [name, size, color].filter(Boolean).join(" ");
}

export function orderQtyTotal(order: Pick<Order, "lines">): number {
  return (order.lines ?? []).reduce((s, l) => s + (Number(l.quantity) || 0), 0);
}

export function orderKgTotal(order: Order): number {
  if (order.actualWeightKg != null && order.actualWeightKg > 0) {
    return roundMoney(order.actualWeightKg);
  }
  if (order.estimatedWeightKg != null && order.estimatedWeightKg > 0) {
    return roundMoney(order.estimatedWeightKg);
  }
  return roundMoney(
    (order.lines ?? []).reduce((s, l) => {
      const kg =
        l.actualWeightKg != null && l.actualWeightKg > 0
          ? l.actualWeightKg
          : l.weightKg || l.estimatedWeightKg || 0;
      return s + (Number(kg) || 0);
    }, 0)
  );
}

export function orderBillAmount(order: Order): number {
  if (order.actualBillAmount != null && order.actualBillAmount > 0) {
    return order.actualBillAmount;
  }
  return Number(order.estimatedTotal) || 0;
}

function itemsBlock(order: Pick<Order, "lines">, locale: Locale): string {
  const lines = order.lines ?? [];
  const rows = lines.slice(0, 6).map((line) => {
    const qty = Number(line.quantity) || 0;
    return `• ${lineItemLabel(line, locale)} × ${qty}`;
  });
  if (lines.length > 6) {
    rows.push(
      locale === "hi"
        ? `• +${lines.length - 6} और आइटम`
        : `• +${lines.length - 6} more`
    );
  }
  return rows.join("\n");
}

function paymentBlock(order: Order, locale: Locale): string {
  const bill = orderBillAmount(order);
  const paid = proofPaidTotal(order.paymentProof);
  const wallet = Number(order.walletUsed) || 0;
  const due = proofRemaining(order.paymentProof, Math.max(0, bill - wallet));
  const verified = !!order.paymentProof?.verified;
  if (order.status === "cancelled") return "";
  if (verified || order.status === "payment_verified") {
    return locale === "hi"
      ? `पेमेंट: मिल गया${paid > 0 ? ` (${formatInr(paid, locale)})` : ""}`
      : `Payment: received${paid > 0 ? ` (${formatInr(paid, locale)})` : ""}`;
  }
  if (order.status === "payment_pending" || due > 0 && bill > 0) {
    const items = getProofItems(order.paymentProof);
    const note = nextPayRefFromItems(order.orderNumber, items);
    if (paid > 0 && due > 0) {
      return locale === "hi"
        ? `पेमेंट: ${formatInr(paid, locale)} मिला · बाकी ${formatInr(due, locale)} · UPI नोट ${note}`
        : `Payment: ${formatInr(paid, locale)} in · due ${formatInr(due, locale)} · UPI note ${note}`;
    }
    if (due > 0) {
      return locale === "hi"
        ? `पेमेंट बाकी: ${formatInr(due, locale)} · UPI नोट ${note}`
        : `Payment due: ${formatInr(due, locale)} · UPI note ${note}`;
    }
  }
  if (order.status === "estimate" || order.status === "confirmed") {
    return locale === "hi"
      ? "पेमेंट: बिल के बाद"
      : "Payment: after final bill";
  }
  return "";
}

export function waVarsFromOrder(input: {
  order?: Order | null;
  locale: Locale;
  companyName?: string;
  name?: string;
  status?: OrderStatus;
  extraNote?: string;
  pdfUrl?: string;
  audience?: "customer" | "staff";
  settings?: AppSettings | null;
}): Record<string, string> {
  const locale = input.locale;
  const order = input.order;
  const company = (input.companyName || "T T Enterprises").trim();
  const name =
    input.name ||
    order?.checkoutName ||
    order?.userName ||
    (locale === "hi" ? "डीलर" : "Dealer");
  const status = input.status || order?.status || "estimate";
  const qty = order ? orderQtyTotal(order) : 0;
  const kg = order ? orderKgTotal(order) : 0;
  const bill = order ? orderBillAmount(order) : 0;
  const paid = order ? proofPaidTotal(order.paymentProof) : 0;
  const wallet = Number(order?.walletUsed) || 0;
  const due = order
    ? proofRemaining(order.paymentProof, Math.max(0, bill - wallet))
    : 0;
  const discount = Number(order?.schemeDiscount) || 0;
  const shipping = Number(order?.shippingAmount) || 0;
  const orderNo = order?.orderNumber || "";
  const hasPackingPdf = Boolean(
    input.pdfUrl || order?.packingSlip?.customerPdfUrl
  );
  const pay = order ? resolveOrderPay(input.settings, order) : null;
  const orderUrl = shortOrderUrl(orderNo, order?.id);
  const linkUrl =
    pay && input.audience !== "staff" ? `${orderUrl}?pay=1` : orderUrl;
  return {
    company,
    name,
    dealer: name,
    phone: (order?.phone || "").trim(),
    order: orderNo,
    status: statusLabelWa(status, locale),
    items: order ? itemsBlock(order, locale) : "",
    qty:
      qty > 0
        ? locale === "hi"
          ? `मात्रा: ${qty} बंडल`
          : `Qty: ${qty} bundles`
        : "",
    kg: kg > 0 ? `${kg} kg` : "",
    bill: bill > 0 ? formatInr(bill, locale) : "",
    amount: bill > 0 ? formatInr(bill, locale) : "",
    discount:
      discount > 0
        ? locale === "hi"
          ? `छूट: ${formatInr(discount, locale)}${order?.schemeDiscountLabel ? ` (${order.schemeDiscountLabel})` : ""}`
          : `Discount: ${formatInr(discount, locale)}${order?.schemeDiscountLabel ? ` (${order.schemeDiscountLabel})` : ""}`
        : "",
    payment: order ? paymentBlock(order, locale) : "",
    paid: paid > 0 ? formatInr(paid, locale) : "",
    due: due > 0 ? formatInr(due, locale) : "",
    shipping: shipping > 0 ? formatInr(shipping, locale) : "",
    wallet: wallet > 0 ? formatInr(wallet, locale) : "",
    lr: order?.lrNumber
      ? locale === "hi"
        ? `LR नंबर: ${order.lrNumber}`
        : `LR number: ${order.lrNumber}`
      : "",
    transport: (order?.transport || "").trim(),
    note: (input.extraNote || "").trim(),
    pdf: hasPackingPdf
      ? locale === "hi"
        ? "पैकिंग स्लिप PDF इस चैट में अटैच है।"
        : "Packing slip PDF is attached in this chat."
      : "",
    pay: pay?.upiUrl
      ? locale === "hi"
        ? `UPI ऐप खोलें (GPay / PhonePe / Paytm):\n${pay.upiUrl}`
        : `Open UPI app (GPay / PhonePe / Paytm):\n${pay.upiUrl}`
      : "",
    link:
      input.audience === "staff"
        ? locale === "hi"
          ? `ऑर्डर खोलें:\n${linkUrl}`
          : `Open order:\n${linkUrl}`
        : locale === "hi"
          ? `ऑर्डर खोलें (स्टेटस / पेमेंट / स्लिप):\n${linkUrl}`
          : `Open your order (status / pay / slip):\n${linkUrl}`,
  };
}

export function findOrderByCode(
  orders: Order[] | undefined,
  code: string
): Order | undefined {
  const q = decodeURIComponent(code || "").trim().toLowerCase();
  if (!q) return undefined;
  const list = orders ?? [];
  const exact = list.find(
    (o) =>
      o.orderNumber.toLowerCase() === q || o.id.toLowerCase() === q
  );
  if (exact) return exact;
  if (q.length >= 8) {
    return list.find((o) => o.id.toLowerCase().endsWith(q));
  }
  return undefined;
}

export function renderWaTemplate(
  key: WhatsAppTemplateKey,
  locale: Locale,
  vars: Record<string, string>,
  settings?: AppSettings | null
): string {
  return applyWaTemplate(resolveWaTemplate(key, locale, settings), vars);
}
