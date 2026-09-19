import type {
  AppSettings,
  Capability,
  Locale,
  Order,
  OrderStatus,
  UserProfile,
} from "./types";
import { userHasCapability, type CapabilityContext } from "./capabilities";
import { formatInr } from "./pricing";
import { normalizePhone } from "./phone";
import { siteUrl } from "./site";
import {
  renderWaTemplate,
  shortCatalogUrl,
  shortGoUrl,
  shortOrderUrl,
  waVarsFromOrder,
} from "./wa-format";
import { dataUrlBase64, resolveOrderPay } from "./wa-pay";

export function whatsappCountryCode(settings?: AppSettings): string {
  const code = (settings?.whatsappCountryCode || "91").replace(/\D/g, "");
  return code || "91";
}

export function toWhatsAppDigits(
  phone: string,
  countryCode = "91"
): string | null {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length >= 11 && digits.startsWith(countryCode)) return digits;
  const local = normalizePhone(phone);
  if (local.length < 8) return null;
  return `${countryCode}${local}`;
}

export function resolveOrderPhone(
  order: Order,
  users?: UserProfile[]
): string | undefined {
  if (order.phone?.trim()) return order.phone.trim();
  const user = users?.find((u) => u.id === order.userId);
  return user?.phone?.trim() || undefined;
}

/** Public site origin for deep links in WhatsApp texts. */
export function siteBaseUrl(): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/$/, "");
  }
  return siteUrl();
}

export function appPageUrl(path: string, locale: Locale = "en"): string {
  const base = siteBaseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}/${locale}${p}`;
}

function openLinkLine(url: string, locale: Locale): string {
  return locale === "hi" ? `खोलें: ${url}` : `Open: ${url}`;
}

export function buildWhatsAppUrl(
  phone: string,
  text: string,
  countryCode = "91"
): string | null {
  const digits = toWhatsAppDigits(phone, countryCode);
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Opens WhatsApp Web/App with a prefilled message. Returns false if phone invalid. */
export function openWhatsApp(
  phone: string,
  text: string,
  countryCode = "91"
): boolean {
  const url = buildWhatsAppUrl(phone, text, countryCode);
  if (!url || typeof window === "undefined") return false;
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

export type WhatsAppSendResult = {
  ok: boolean;
  mode: "tally_instance" | "cloud_api" | "wa.me" | "off";
  error?: string;
  attached?: boolean;
};

export function isSilentWhatsAppMode(
  mode: WhatsAppSendResult["mode"]
): boolean {
  return mode === "tally_instance" || mode === "cloud_api";
}

async function enqueueOutbox(input: {
  phone: string;
  text: string;
  label?: string;
}): Promise<void> {
  const { enqueueWaOutbox } = await import("@/lib/wa-outbox");
  enqueueWaOutbox(input);
}

/** Send via Tally instance / Meta Cloud API when configured; otherwise open wa.me. */
export async function sendWhatsAppMessage(
  phone: string,
  text: string,
  countryCode = "91",
  options?: {
    preferWaMe?: boolean;
    outboxLabel?: string;
    enqueueOnly?: boolean;
    documentUrl?: string;
    filename?: string;
    documentBase64?: string;
    imageUrl?: string;
    imageBase64?: string;
    imageFilename?: string;
    imageCaption?: string;
  }
): Promise<WhatsAppSendResult> {
  const digits = toWhatsAppDigits(phone, countryCode);
  if (!digits) return { ok: false, mode: "off", error: "Invalid phone" };
  if (typeof window === "undefined") {
    return { ok: false, mode: "off", error: "Client only" };
  }

  let silentConfigured = false;
  let silentMode: "tally_instance" | "cloud_api" = "cloud_api";

  if (!options?.preferWaMe && !options?.enqueueOnly) {
    try {
      const statusRes = await fetch("/api/whatsapp/send", {
        credentials: "include",
        cache: "no-store",
      });
      const statusData = (await statusRes.json()) as {
        configured?: boolean;
        mode?: string;
      };
      if (statusData.configured) {
        silentConfigured = true;
        if (
          statusData.mode === "tally_instance" ||
          statusData.mode === "cloud_api"
        ) {
          silentMode = statusData.mode;
        }
      }
    } catch {
      /* probe failed — POST may still work */
    }

    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: digits,
          text,
          documentUrl: options?.documentUrl,
          filename: options?.filename,
          documentBase64: options?.documentBase64,
          imageUrl: options?.imageUrl,
          imageBase64: options?.imageBase64,
          imageFilename: options?.imageFilename,
          imageCaption: options?.imageCaption,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        configured?: boolean;
        mode?: WhatsAppSendResult["mode"];
        error?: string;
        attached?: boolean;
      };
      if (res.ok && data.ok) {
        const mode =
          data.mode === "tally_instance" || data.mode === "cloud_api"
            ? data.mode
            : silentMode;
        return { ok: true, mode, attached: !!data.attached };
      }
      if (data.configured || silentConfigured) {
        console.warn("[whatsapp] silent send failed:", data.error);
        await enqueueOutbox({
          phone,
          text,
          label: options?.outboxLabel,
        });
        return {
          ok: false,
          mode:
            data.mode === "tally_instance" || data.mode === "cloud_api"
              ? data.mode
              : silentMode,
          error: data.error || "WhatsApp send failed",
        };
      }
      if (res.status !== 503) {
        console.warn("[whatsapp] send failed:", data.error);
      }
    } catch (err) {
      console.warn("[whatsapp] send unreachable", err);
      if (silentConfigured) {
        await enqueueOutbox({
          phone,
          text,
          label: options?.outboxLabel,
        });
        return {
          ok: false,
          mode: silentMode,
          error: "WhatsApp send failed",
        };
      }
    }
  }

  if (silentConfigured) {
    await enqueueOutbox({
      phone,
      text,
      label: options?.outboxLabel,
    });
    return { ok: false, mode: silentMode, error: "WhatsApp send failed" };
  }

  if (options?.enqueueOnly) {
    await enqueueOutbox({
      phone,
      text,
      label: options.outboxLabel,
    });
    return { ok: true, mode: "wa.me" };
  }

  const opened = openWhatsApp(phone, text, countryCode);
  if (!opened) {
    await enqueueOutbox({
      phone,
      text,
      label: options?.outboxLabel,
    });
    return { ok: false, mode: "wa.me", error: "Could not open WhatsApp" };
  }
  return { ok: true, mode: "wa.me" };
}

async function payQrForWhatsApp(
  order: Order | undefined,
  settings: AppSettings,
  locale: Locale
): Promise<{
  imageUrl?: string;
  imageBase64?: string;
  imageFilename: string;
  imageCaption: string;
} | undefined> {
  const pay = resolveOrderPay(settings, order);
  if (!pay) return undefined;
  const caption =
    locale === "hi"
      ? `स्कैन करें — पेमेंट ${formatInr(pay.amount, locale)} · UPI नोट ${pay.payRef}`
      : `Scan to pay ${formatInr(pay.amount, locale)} · UPI note ${pay.payRef}`;
  const filename = `pay-${(order?.orderNumber || "order").replace(/[^\w.-]+/g, "_")}.png`;
  if (pay.upiUrl) {
    try {
      const QRCode = (await import("qrcode")).default;
      const dataUrl = await QRCode.toDataURL(pay.upiUrl, {
        width: 480,
        margin: 2,
        errorCorrectionLevel: "M",
      });
      const imageBase64 = dataUrlBase64(dataUrl);
      if (imageBase64) {
        return { imageBase64, imageFilename: filename, imageCaption: caption };
      }
    } catch {
      /* fall through to static QR */
    }
  }
  const staticQr = pay.staticQrDataUrl || "";
  if (staticQr.startsWith("data:")) {
    const imageBase64 = dataUrlBase64(staticQr);
    if (imageBase64) {
      return { imageBase64, imageFilename: filename, imageCaption: caption };
    }
  }
  const hosted = publicHttpsUrl(staticQr);
  if (hosted) {
    return { imageUrl: hosted, imageFilename: filename, imageCaption: caption };
  }
  return undefined;
}

function publicHttpsUrl(url?: string): string | undefined {
  const raw = (url || "").trim();
  if (/^https:\/\//i.test(raw)) return raw;
  if (
    raw.startsWith("/") &&
    typeof window !== "undefined" &&
    window.location?.origin.startsWith("https://")
  ) {
    return `${window.location.origin}${raw}`;
  }
  return undefined;
}

function dataUrlToPdfBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) return null;
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1] || "application/pdf" });
  } catch {
    return null;
  }
}

export function downloadDataUrl(dataUrl: string, fileName: string): void {
  if (typeof window === "undefined") return;
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = fileName || "file";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function orderUpdateWhatsAppText(input: {
  order: Order;
  status: OrderStatus;
  companyName: string;
  locale: Locale;
  extraNote?: string;
  settings?: AppSettings;
}): string {
  return renderWaTemplate(
    "order",
    input.locale,
    waVarsFromOrder({
      order: input.order,
      locale: input.locale,
      companyName: input.companyName,
      status: input.status,
      extraNote: input.extraNote,
      settings: input.settings,
    }),
    input.settings
  );
}

export function packingSlipWhatsAppText(input: {
  partyName: string;
  voucherNumber: string;
  companyName: string;
  locale: Locale;
  orderNumber?: string;
  orderId?: string;
  packingSlipName?: string;
  /** Public https PDF — attached as a WhatsApp file; text uses one order link only */
  pdfUrl?: string;
  /** customer = dealer order page; staff = admin packing slip */
  audience?: "customer" | "staff";
  discountAmount?: number;
  discountLabel?: string;
  billAmount?: number;
  order?: Order;
  settings?: AppSettings;
}): string {
  const locale = input.locale;
  const stub: Order | undefined = input.order
    ? input.order
    : ({
        orderNumber: input.orderNumber || input.voucherNumber,
        id: input.orderId || "",
        checkoutName: input.partyName,
        userName: input.partyName,
        actualBillAmount: input.billAmount,
        schemeDiscount: input.discountAmount,
        schemeDiscountLabel: input.discountLabel,
        status: "payment_pending",
        lines: [],
      } as unknown as Order);
  const vars = waVarsFromOrder({
    order: stub,
    locale,
    companyName: input.companyName,
    name: input.partyName,
    status: stub.status || "payment_pending",
    pdfUrl: input.pdfUrl,
    audience: input.audience,
    settings: input.settings,
  });
  if (!vars.order) vars.order = input.voucherNumber;
  return renderWaTemplate("packing", locale, vars, input.settings);
}

export function partyStatementWhatsAppText(input: {
  partyName: string;
  companyName: string;
  locale: Locale;
  from: string;
  to: string;
  balance: number;
  outstandingLines?: { number: string; due: string; amount: number }[];
  partyId?: string;
  /** customer gets orders/wallet; staff gets admin statement */
  audience?: "customer" | "staff";
}): string {
  const bal = formatInr(input.balance, input.locale);
  const bills = (input.outstandingLines ?? [])
    .slice(0, 8)
    .map(
      (b) =>
        `• ${b.number} · due ${b.due} · ${formatInr(b.amount, input.locale)}`
    )
    .join("\n");
  const audience = input.audience ?? "customer";
  const link =
    audience === "staff" && input.partyId
      ? appPageUrl(
          `/admin/accounts/party-statement?party=${encodeURIComponent(input.partyId)}&type=customer`,
          input.locale
        )
      : shortGoUrl("orders");
  if (input.locale === "hi") {
    return [
      `नमस्ते ${input.partyName},`,
      "",
      `${input.companyName} — खाता स्टेटमेंट`,
      `अवधि: ${input.from} से ${input.to}`,
      `बकाया शेष: ${bal}`,
      bills ? `\nखुले बिल:\n${bills}` : "",
      "",
      openLinkLine(link, input.locale),
      "धन्यवाद!",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `Hello ${input.partyName},`,
    "",
    `${input.companyName} — Account statement`,
    `Period: ${input.from} to ${input.to}`,
    `Balance: ${bal}`,
    bills ? `\nOpen bills:\n${bills}` : "",
    "",
    openLinkLine(link, input.locale),
    "Thank you!",
  ]
    .filter(Boolean)
    .join("\n");
}

export function staffNewOrderWhatsAppText(input: {
  order: Order;
  companyName: string;
  locale: Locale;
  settings?: AppSettings;
}): string {
  return renderWaTemplate(
    "staffOrder",
    input.locale,
    waVarsFromOrder({
      order: input.order,
      locale: input.locale,
      companyName: input.companyName,
      status: "estimate",
      audience: "staff",
    }),
    input.settings
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Silent WhatsApp to every active staff account. Optional capability
 * narrows the list. Skips customers and duplicate phones. Best-effort.
 */
export async function notifyStaffWhatsApp(input: {
  settings: AppSettings;
  users: UserProfile[];
  capability?: Capability;
  capabilityContext?: CapabilityContext | null;
  text: string;
  skipUserIds?: string[];
}): Promise<number> {
  if (input.settings.whatsappNotifyEnabled === false) return 0;
  try {
    const res = await fetch("/api/whatsapp/notify-staff", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: input.text,
        skipUserIds: input.skipUserIds,
        capability: input.capability,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { sent?: number };
      if (typeof data.sent === "number") return data.sent;
    }
  } catch {
    /* fall through to per-phone send */
  }
  const country = whatsappCountryCode(input.settings);
  const skip = new Set(input.skipUserIds ?? []);
  const seen = new Set<string>();
  let sent = 0;
  let openedWaMe = false;
  for (const u of input.users) {
    if (!u.active || u.role === "customer") continue;
    if (skip.has(u.id)) continue;
    if (
      input.capability &&
      !userHasCapability(u, input.capability, input.capabilityContext)
    )
      continue;
    const phone = u.phone?.trim();
    if (!phone) continue;
    const digits = toWhatsAppDigits(phone, country);
    if (!digits || seen.has(digits)) continue;
    seen.add(digits);
    if (sent + (openedWaMe ? 1 : 0) > 0) await sleep(400);
    const result = await sendWhatsAppMessage(phone, input.text, country, {
      outboxLabel: u.name,
      enqueueOnly: openedWaMe,
    });
    if (result.ok && isSilentWhatsAppMode(result.mode)) {
      sent += 1;
      continue;
    }
    if (result.ok && result.mode === "wa.me") {
      openedWaMe = true;
      sent += 1;
    }
  }
  return sent;
}

export function dealerApprovedWhatsAppText(input: {
  user: UserProfile;
  companyName: string;
  locale: Locale;
}): string {
  const locale = input.user.locale === "hi" || input.locale === "hi" ? "hi" : "en";
  const name = input.user.name || (locale === "hi" ? "डीलर" : "Dealer");
  const company = input.companyName || "TT Enterprises";
  const link = shortCatalogUrl();
  if (locale === "hi") {
    return [
      `*${company}*`,
      `नमस्ते ${name}, अकाउंट मंज़ूर हो गया।`,
      "लॉगिन करके ऑर्डर करें।",
      "",
      link,
    ].join("\n");
  }
  return [
    `*${company}*`,
    `Hello ${name}, your account is approved.`,
    "Log in and place an order.",
    "",
    link,
  ].join("\n");
}

export function dealerRejectedWhatsAppText(input: {
  user: UserProfile;
  companyName: string;
  officePhone?: string;
  locale: Locale;
}): string {
  const locale = input.user.locale === "hi" || input.locale === "hi" ? "hi" : "en";
  const name = input.user.name || (locale === "hi" ? "डीलर" : "Dealer");
  const company = input.companyName || "TT Enterprises";
  const phone = (input.officePhone || "").trim();
  if (locale === "hi") {
    return [
      `नमस्ते ${name},`,
      "",
      `${company} — रजिस्ट्रेशन मंज़ूर नहीं हुई।`,
      phone ? `ऑफिस से संपर्क करें: ${phone}` : "ऑफिस से संपर्क करें।",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `Hello ${name},`,
    "",
    `${company} — your registration was not approved.`,
    phone ? `Please call the office: ${phone}` : "Please call the office.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function staffSignupWhatsAppText(input: {
  dealer: Pick<UserProfile, "name" | "phone" | "company">;
  companyName: string;
  locale: Locale;
}): string {
  const where = input.dealer.company?.trim() || input.dealer.phone;
  const link = shortGoUrl("users");
  if (input.locale === "hi") {
    return [
      `${input.companyName} — नया डीलर, मंज़ूरी बाकी`,
      `${input.dealer.name} · ${where}`,
      input.dealer.phone ? `फोन: ${input.dealer.phone}` : "",
      "",
      openLinkLine(link, input.locale),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `${input.companyName} — New dealer, approval pending`,
    `${input.dealer.name} · ${where}`,
    input.dealer.phone ? `Phone: ${input.dealer.phone}` : "",
    "",
    openLinkLine(link, input.locale),
  ]
    .filter(Boolean)
    .join("\n");
}

export function staffPasswordResetWhatsAppText(input: {
  user: Pick<UserProfile, "name" | "phone" | "company" | "role">;
  companyName: string;
  locale: Locale;
}): string {
  const who = input.user.company?.trim() || input.user.phone;
  const kind =
    input.user.role === "customer"
      ? input.locale === "hi"
        ? "डीलर"
        : "Dealer"
      : input.locale === "hi"
        ? "स्टाफ"
        : "Staff";
  const link = shortGoUrl("users");
  if (input.locale === "hi") {
    return [
      `${input.companyName} — पासवर्ड रीसेट अनुरोध`,
      `${kind}: ${input.user.name} · ${who}`,
      input.user.phone ? `फोन: ${input.user.phone}` : "",
      "People में नया पासवर्ड सेट करें।",
      "",
      openLinkLine(link, input.locale),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `${input.companyName} — Password reset request`,
    `${kind}: ${input.user.name} · ${who}`,
    input.user.phone ? `Phone: ${input.user.phone}` : "",
    "Set a new password on People.",
    "",
    openLinkLine(link, input.locale),
  ]
    .filter(Boolean)
    .join("\n");
}

export function dealerPasswordResetAckWhatsAppText(input: {
  name: string;
  companyName: string;
  locale: Locale;
  officePhone?: string;
}): string {
  const office = input.officePhone?.trim();
  if (input.locale === "hi") {
    return [
      `नमस्ते ${input.name},`,
      "",
      `${input.companyName} — पासवर्ड रीसेट का अनुरोध मिल गया।`,
      "ऑफिस नया पासवर्ड सेट करके बताएगा।",
      office ? `फोन: ${office}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `Hello ${input.name},`,
    "",
    `${input.companyName} received your password reset request.`,
    "The office will set a new password and share it with you.",
    office ? `Phone: ${office}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function staffPaymentProofWhatsAppText(input: {
  order: Order;
  amount: number;
  companyName: string;
  locale: Locale;
  payRef?: string;
  remaining?: number;
}): string {
  const dealer = input.order.checkoutName || input.order.userName;
  const money = formatInr(input.amount, input.locale);
  const link = shortOrderUrl(input.order.orderNumber, input.order.id);
  const ref = input.payRef?.trim();
  const left =
    input.remaining != null && input.remaining > 0.05
      ? formatInr(input.remaining, input.locale)
      : "";
  if (input.locale === "hi") {
    return [
      `${input.companyName} — पेमेंट प्रूफ आया`,
      `ऑर्डर: ${input.order.orderNumber}`,
      `डीलर: ${dealer}`,
      `राशि: ${money}`,
      ref ? `UPI नोट: ${ref}` : "",
      left ? `बाकी: ${left}` : "",
      "वेरिफाई करें।",
      "",
      openLinkLine(link, input.locale),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `${input.companyName} — Payment proof uploaded`,
    `Order: ${input.order.orderNumber}`,
    `Dealer: ${dealer}`,
    `Amount: ${money}`,
    ref ? `UPI note: ${ref}` : "",
    left ? `Still left: ${left}` : "",
    "Please verify payment.",
    "",
    openLinkLine(link, input.locale),
  ]
    .filter(Boolean)
    .join("\n");
}

export function overdueDealerWhatsAppText(input: {
  partyName: string;
  companyName: string;
  locale: Locale;
  total: number;
  bills: { number: string; due: string; amount: number; daysOverdue: number }[];
}): string {
  const money = formatInr(input.total, input.locale);
  const lines = input.bills.slice(0, 8).map((b) =>
    input.locale === "hi"
      ? `• ${b.number} · देय ${b.due} · ${formatInr(b.amount, input.locale)} · ${b.daysOverdue} दिन`
      : `• ${b.number} · due ${b.due} · ${formatInr(b.amount, input.locale)} · ${b.daysOverdue}d overdue`
  );
  const more =
    input.bills.length > 8
      ? input.locale === "hi"
        ? `+${input.bills.length - 8} और बिल`
        : `+${input.bills.length - 8} more bills`
      : "";
  const link = shortGoUrl("orders");
  if (input.locale === "hi") {
    return [
      `नमस्ते ${input.partyName},`,
      "",
      `${input.companyName} — बकाया भुगतान`,
      `कुल बकाया: ${money}`,
      ...lines,
      more,
      "कृपया जल्द भुगतान करें।",
      "",
      openLinkLine(link, input.locale),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `Hello ${input.partyName},`,
    "",
    `${input.companyName} — overdue payment`,
    `Total overdue: ${money}`,
    ...lines,
    more,
    "Please clear dues at the earliest.",
    "",
    openLinkLine(link, input.locale),
  ]
    .filter(Boolean)
    .join("\n");
}

export function overdueStaffWhatsAppText(input: {
  companyName: string;
  locale: Locale;
  partyCount: number;
  total: number;
  top: { name: string; amount: number }[];
}): string {
  const money = formatInr(input.total, input.locale);
  const link = shortGoUrl("receivables");
  const top = input.top
    .slice(0, 5)
    .map((p) => `• ${p.name} · ${formatInr(p.amount, input.locale)}`)
    .join("\n");
  if (input.locale === "hi") {
    return [
      `${input.companyName} — बकाया उधार`,
      `${input.partyCount} पार्टी · ${money}`,
      top,
      "",
      openLinkLine(link, input.locale),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `${input.companyName} — overdue receivables`,
    `${input.partyCount} parties · ${money}`,
    top,
    "",
    openLinkLine(link, input.locale),
  ]
    .filter(Boolean)
    .join("\n");
}

export function creditLimitDealerWhatsAppText(input: {
  partyName: string;
  companyName: string;
  locale: Locale;
  receivable: number;
  creditLimit: number;
  overBy: number;
}): string {
  const link = shortGoUrl("orders");
  if (input.locale === "hi") {
    return [
      `नमस्ते ${input.partyName},`,
      "",
      `${input.companyName} — क्रेडिट लिमिट पार`,
      `बकाया: ${formatInr(input.receivable, input.locale)}`,
      `लिमिट: ${formatInr(input.creditLimit, input.locale)}`,
      `अधिक: ${formatInr(input.overBy, input.locale)}`,
      "आगे माल के लिए बकाया चुकाएँ।",
      "",
      openLinkLine(link, input.locale),
    ].join("\n");
  }
  return [
    `Hello ${input.partyName},`,
    "",
    `${input.companyName} — credit limit exceeded`,
    `Outstanding: ${formatInr(input.receivable, input.locale)}`,
    `Limit: ${formatInr(input.creditLimit, input.locale)}`,
    `Over by: ${formatInr(input.overBy, input.locale)}`,
    "Please clear dues so we can continue supply.",
    "",
    openLinkLine(link, input.locale),
  ].join("\n");
}

export function creditLimitStaffWhatsAppText(input: {
  companyName: string;
  locale: Locale;
  rows: {
    name: string;
    receivable: number;
    creditLimit: number;
    overBy: number;
    orderNumber?: string;
  }[];
}): string {
  const link = shortGoUrl("receivables");
  const lines = input.rows.slice(0, 8).map((r) => {
    const extra = r.orderNumber ? ` · ${r.orderNumber}` : "";
    return `• ${r.name}${extra} · ${formatInr(r.receivable, input.locale)} / ${formatInr(r.creditLimit, input.locale)} (+${formatInr(r.overBy, input.locale)})`;
  });
  const more =
    input.rows.length > 8
      ? input.locale === "hi"
        ? `+${input.rows.length - 8} और`
        : `+${input.rows.length - 8} more`
      : "";
  if (input.locale === "hi") {
    return [
      `${input.companyName} — क्रेडिट लिमिट`,
      `${input.rows.length} पार्टी लिमिट के ऊपर`,
      ...lines,
      more,
      "",
      openLinkLine(link, input.locale),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `${input.companyName} — credit limit`,
    `${input.rows.length} parties over limit`,
    ...lines,
    more,
    "",
    openLinkLine(link, input.locale),
  ]
    .filter(Boolean)
    .join("\n");
}

export function schemeEndingDealerWhatsAppText(input: {
  dealerName: string;
  companyName: string;
  locale: Locale;
  schemes: { name: string; daysLeft: number }[];
}): string {
  const link = shortGoUrl("schemes");
  const lines = input.schemes.map((s) =>
    input.locale === "hi"
      ? `• ${s.name} — ${s.daysLeft} दिन बाकी`
      : `• ${s.name} — ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left`
  );
  if (input.locale === "hi") {
    return [
      `नमस्ते ${input.dealerName},`,
      "",
      `${input.companyName} — स्कीम इस हफ्ते खत्म`,
      ...lines,
      "लक्ष्य पूरा करने का मौका है।",
      "",
      openLinkLine(link, input.locale),
    ].join("\n");
  }
  return [
    `Hello ${input.dealerName},`,
    "",
    `${input.companyName} — scheme ending this week`,
    ...lines,
    "Lift now to reach the target.",
    "",
    openLinkLine(link, input.locale),
  ].join("\n");
}

export function schemeEndingStaffWhatsAppText(input: {
  companyName: string;
  locale: Locale;
  schemes: { name: string; daysLeft: number; dealerCount: number }[];
}): string {
  const link = shortGoUrl("schemes");
  const lines = input.schemes.map((s) =>
    input.locale === "hi"
      ? `• ${s.name} — ${s.daysLeft} दिन · ${s.dealerCount} डीलर`
      : `• ${s.name} — ${s.daysLeft}d · ${s.dealerCount} dealers`
  );
  if (input.locale === "hi") {
    return [
      `${input.companyName} — स्कीम इस हफ्ते खत्म`,
      ...lines,
      "",
      openLinkLine(link, input.locale),
    ].join("\n");
  }
  return [
    `${input.companyName} — schemes ending this week`,
    ...lines,
    "",
    openLinkLine(link, input.locale),
  ].join("\n");
}

export function supplierPoWhatsAppText(input: {
  po: {
    number: string;
    date: string;
    lines: { itemLabel: string; qty: number }[];
  };
  companyName: string;
  locale: Locale;
}): string {
  const lines = input.po.lines
    .map((l) => `• ${l.itemLabel} × ${l.qty}`)
    .join("\n");
  if (input.locale === "hi") {
    return [
      `${input.companyName} — खरीद आदेश ${input.po.number}`,
      `तारीख: ${input.po.date}`,
      lines,
      "",
      "कृपया कन्फर्म करें।",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `${input.companyName} — purchase order ${input.po.number}`,
    `Date: ${input.po.date}`,
    lines,
    "",
    "Please confirm.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function lowStockStaffWhatsAppText(input: {
  companyName: string;
  locale: Locale;
  poCount: number;
  numbers: string[];
  alertCount: number;
}): string {
  const link = shortGoUrl("purchases");
  const list = input.numbers.slice(0, 8).join(", ");
  const more =
    input.numbers.length > 8 ? ` +${input.numbers.length - 8}` : "";
  if (input.locale === "hi") {
    return [
      `${input.companyName} — लो स्टॉक / ड्राफ्ट PO`,
      `${input.poCount} ड्राफ्ट PO · ${input.alertCount} रीऑर्डर अलर्ट`,
      list ? `${list}${more}` : "",
      "",
      openLinkLine(link, input.locale),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `${input.companyName} — low stock / draft POs`,
    `${input.poCount} draft PO(s) · ${input.alertCount} reorder alert(s)`,
    list ? `${list}${more}` : "",
    "",
    openLinkLine(link, input.locale),
  ]
    .filter(Boolean)
    .join("\n");
}

export function staleEstimateDealerWhatsAppText(input: {
  dealerName: string;
  companyName: string;
  locale: Locale;
  orders: { orderNumber: string; daysOpen: number }[];
}): string {
  const link = shortGoUrl("orders");
  const lines = input.orders.slice(0, 8).map((o) =>
    input.locale === "hi"
      ? `• ${o.orderNumber} · ${o.daysOpen} दिन`
      : `• ${o.orderNumber} · ${o.daysOpen} days`
  );
  const more =
    input.orders.length > 8
      ? input.locale === "hi"
        ? `+${input.orders.length - 8} और`
        : `+${input.orders.length - 8} more`
      : "";
  if (input.locale === "hi") {
    return [
      `नमस्ते ${input.dealerName},`,
      "",
      `${input.companyName} — पुराना अनुमान`,
      "स्टॉक अभी आरक्षित है। कन्फर्म करें या दफ्तर से रद्द करवाएँ — अपने आप रद्द नहीं होगा।",
      ...lines,
      more,
      "",
      openLinkLine(link, input.locale),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `Hello ${input.dealerName},`,
    "",
    `${input.companyName} — open estimate`,
    "Stock is still reserved. Please confirm the order or ask the office to cancel — we will not auto-cancel.",
    ...lines,
    more,
    "",
    openLinkLine(link, input.locale),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function notifyDealerApproved(input: {
  user: UserProfile;
  settings: AppSettings;
}): Promise<WhatsAppSendResult> {
  if (input.settings.whatsappNotifyEnabled === false) {
    return { ok: false, mode: "off" };
  }
  const phone = input.user.phone?.trim();
  if (!phone) return { ok: false, mode: "off", error: "Invalid phone" };
  const locale: Locale = input.user.locale === "hi" ? "hi" : "en";
  const text = dealerApprovedWhatsAppText({
    user: input.user,
    companyName: input.settings.companyName || "TT Enterprises",
    locale,
  });
  const result = await sendWhatsAppMessage(
    phone,
    text,
    whatsappCountryCode(input.settings),
    { outboxLabel: input.user.name || phone }
  );
  return result;
}

export async function notifyDealerRejected(input: {
  user: UserProfile;
  settings: AppSettings;
}): Promise<WhatsAppSendResult> {
  if (input.settings.whatsappNotifyEnabled === false) {
    return { ok: false, mode: "off" };
  }
  const phone = input.user.phone?.trim();
  if (!phone) return { ok: false, mode: "off", error: "Invalid phone" };
  const locale: Locale = input.user.locale === "hi" ? "hi" : "en";
  const text = dealerRejectedWhatsAppText({
    user: input.user,
    companyName: input.settings.companyName || "TT Enterprises",
    officePhone: input.settings.phone,
    locale,
  });
  return sendWhatsAppMessage(
    phone,
    text,
    whatsappCountryCode(input.settings),
    { outboxLabel: input.user.name || phone }
  );
}

export async function notifyStaffPaymentProof(input: {
  order: Order;
  settings: AppSettings;
  users: UserProfile[];
  locale: Locale;
  amount: number;
  payRef?: string;
  remaining?: number;
  skipUserIds?: string[];
}): Promise<number> {
  try {
    const { notifyStaffPush } = await import("@/lib/push-client");
    await notifyStaffPush({
      title:
        input.locale === "hi" ? "पेमेंट प्रूफ" : "Payment proof",
      body: `${input.order.orderNumber} · ${input.order.userName || "Dealer"}`,
      url: "/en/admin/orders?filter=need_verify",
    });
  } catch {
    /* best-effort */
  }
  const text = staffPaymentProofWhatsAppText({
    order: input.order,
    amount: input.amount,
    companyName: input.settings.companyName || "TT Enterprises",
    locale: input.locale,
    payRef: input.payRef,
    remaining: input.remaining,
  });
  return notifyStaffWhatsApp({
    settings: input.settings,
    users: input.users,
    text,
    skipUserIds: input.skipUserIds,
  });
}

/**
 * Notify all active staff when a new estimate is placed.
 * Silent no-op when WhatsApp is disabled or no staff phones.
 */
export async function notifyStaffNewOrder(input: {
  order: Order;
  settings: AppSettings;
  users: UserProfile[];
  locale: Locale;
  skipUserIds?: string[];
}): Promise<number> {
  const text = staffNewOrderWhatsAppText({
    order: input.order,
    companyName: input.settings.companyName || "TT Enterprises",
    locale: input.locale,
    settings: input.settings,
  });
  const skip = [input.order.userId, ...(input.skipUserIds ?? [])];
  const sent = await notifyStaffWhatsApp({
    settings: input.settings,
    users: input.users,
    text,
    skipUserIds: skip,
  });
  try {
    const { notifyStaffPush } = await import("@/lib/push-client");
    await notifyStaffPush({
      title:
        input.locale === "hi" ? "नया अनुमान" : "New estimate",
      body: `${input.order.orderNumber} · ${input.order.userName || "Dealer"}`,
      url: `/en/admin/orders?filter=estimate`,
    });
  } catch {
    /* best-effort */
  }
  return sent;
}

/** Staff with manage_accounts when a party is over credit limit. */
export async function notifyStaffCreditLimit(input: {
  settings: AppSettings;
  users: UserProfile[];
  locale: Locale;
  partyName: string;
  creditLimit: number;
  receivable: number;
  overBy: number;
  orderNumber?: string;
  skipUserIds?: string[];
}): Promise<number> {
  const text = creditLimitStaffWhatsAppText({
    companyName: input.settings.companyName || "TT Enterprises",
    locale: input.locale,
    rows: [
      {
        name: input.partyName,
        receivable: input.receivable,
        creditLimit: input.creditLimit,
        overBy: input.overBy,
        orderNumber: input.orderNumber,
      },
    ],
  });
  return notifyStaffWhatsApp({
    settings: input.settings,
    users: input.users,
    text,
    skipUserIds: input.skipUserIds,
  });
}

export function whatsappResultCopy(
  result: WhatsAppSendResult,
  copy: { sent: string; opened: string; fail: string; noPhone?: string }
): string {
  if (!result.ok) {
    if (result.mode === "off") return copy.noPhone || copy.fail;
    return copy.fail;
  }
  if (result.mode === "wa.me") return copy.opened;
  return copy.sent;
}

export async function notifyPartyStatementWhatsApp(input: {
  phone: string;
  partyName: string;
  companyName: string;
  locale: Locale;
  from: string;
  to: string;
  balance: number;
  countryCode?: string;
  outstandingLines?: { number: string; due: string; amount: number }[];
  partyId?: string;
  audience?: "customer" | "staff";
}): Promise<WhatsAppSendResult> {
  const text = partyStatementWhatsAppText(input);
  return sendWhatsAppMessage(
    input.phone,
    text,
    input.countryCode || "91"
  );
}

/**
 * Browser push to the dealer who owns the order. WhatsApp may still be off.
 */
function pingCustomerOrderPush(
  order: Pick<Order, "id" | "userId" | "orderNumber">,
  locale: Locale,
  body: string
): void {
  void import("@/lib/push-client")
    .then(({ notifyUserPush }) =>
      notifyUserPush({
        userId: order.userId,
        title: locale === "hi" ? "ऑर्डर अपडेट" : "Order update",
        body,
        url: `/${locale}/orders/${order.id}`,
      })
    )
    .catch(() => {
      /* best-effort */
    });
}

/**
 * Notify customer of an order update via WhatsApp.
 * Silent when Tally instance / Cloud API is configured; otherwise opens wa.me.
 */
export async function notifyOrderWhatsApp(input: {
  order: Order;
  status: OrderStatus;
  settings: AppSettings;
  users?: UserProfile[];
  locale: Locale;
  extraNote?: string;
}): Promise<WhatsAppSendResult> {
  const locale = input.locale;
  pingCustomerOrderPush(
    input.order,
    locale,
    `${input.order.orderNumber} · ${input.status}`
  );

  if (input.settings.whatsappNotifyEnabled === false) {
    return { ok: false, mode: "off" };
  }

  try {
    const res = await fetch("/api/whatsapp/notify-order", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId: input.order.id,
        status: input.status,
        extraNote: input.extraNote,
        locale,
      }),
    });
    const data = (await res.json()) as { ok?: boolean; sent?: boolean };
    if (res.ok && data.sent) {
      return { ok: true, mode: "tally_instance" };
    }
  } catch {
    /* fall through to client send */
  }

  const phone = resolveOrderPhone(input.order, input.users);
  if (!phone) return { ok: false, mode: "off", error: "Invalid phone" };
  const text = orderUpdateWhatsAppText({
    order: input.order,
    status: input.status,
    companyName: input.settings.companyName,
    locale: input.locale,
    extraNote: input.extraNote,
    settings: input.settings,
  });
  return sendWhatsAppMessage(
    phone,
    text,
    whatsappCountryCode(input.settings),
    { outboxLabel: input.order.userName || phone }
  );
}

/** Packing slip: download file + send WhatsApp (instance / Cloud API or wa.me). */
export async function notifyPackingSlipWhatsApp(input: {
  phone: string;
  partyName: string;
  voucherNumber: string;
  settings: AppSettings;
  locale: Locale;
  orderNumber?: string;
  orderId?: string;
  packingSlipDataUrl?: string;
  packingSlipName?: string;
  audience?: "customer" | "staff";
  discountAmount?: number;
  discountLabel?: string;
  billAmount?: number;
  order?: Order;
}): Promise<WhatsAppSendResult> {
  if (input.order && input.audience !== "staff") {
    pingCustomerOrderPush(
      input.order,
      input.locale,
      input.locale === "hi"
        ? `${input.order.orderNumber} · पैकिंग स्लिप / बिल`
        : `${input.order.orderNumber} · packing slip / bill`
    );
  }
  if (input.settings.whatsappNotifyEnabled === false) {
    return { ok: false, mode: "off" };
  }
  let hosted = publicHttpsUrl(input.packingSlipDataUrl);
  const localDataUrl = input.packingSlipDataUrl?.startsWith("data:")
    ? input.packingSlipDataUrl
    : undefined;
  if (!hosted && localDataUrl && typeof window !== "undefined") {
    try {
      const { uploadMediaFile } = await import("@/lib/upload-media");
      const blob = dataUrlToPdfBlob(localDataUrl);
      if (blob) {
        const file = new File(
          [blob],
          input.packingSlipName || "packing-slip.pdf",
          { type: "application/pdf" }
        );
        const uploaded = await uploadMediaFile(file, "bills");
        hosted = publicHttpsUrl(uploaded.url);
      }
    } catch {
      /* still send the caption */
    }
  }
  const text = packingSlipWhatsAppText({
    partyName: input.partyName,
    voucherNumber: input.voucherNumber,
    companyName: input.settings.companyName,
    locale: input.locale,
    orderNumber: input.orderNumber,
    orderId: input.orderId,
    packingSlipName: input.packingSlipName,
    pdfUrl: hosted,
    audience: input.audience ?? "customer",
    settings: input.settings,
    order: input.order,
    discountAmount: input.discountAmount,
    discountLabel: input.discountLabel,
    billAmount: input.billAmount,
  });
  const documentBase64 =
    !hosted && localDataUrl
      ? /^data:[^;]+;base64,(.+)$/i.exec(localDataUrl)?.[1]
      : undefined;
  const qr =
    input.audience === "staff"
      ? undefined
      : await payQrForWhatsApp(input.order, input.settings, input.locale);
  const sent = await sendWhatsAppMessage(
    input.phone,
    text,
    whatsappCountryCode(input.settings),
    hosted || documentBase64 || qr
      ? {
          documentUrl: hosted,
          filename: input.packingSlipName || "packing-slip.pdf",
          documentBase64,
          imageUrl: qr?.imageUrl,
          imageBase64: qr?.imageBase64,
          imageFilename: qr?.imageFilename,
          imageCaption: qr?.imageCaption,
        }
      : undefined
  );
  if (!sent.attached) {
    const downloadSrc = localDataUrl || hosted;
    if (downloadSrc) {
      downloadDataUrl(
        downloadSrc,
        input.packingSlipName || "packing-slip"
      );
    }
  }
  return sent;
}

function isPdfAttachment(url?: string, name?: string): boolean {
  const blob = `${url || ""} ${name || ""}`.toLowerCase();
  return blob.includes("application/pdf") || /\.pdf(\?|$)/i.test(blob);
}

/** LR copy: attach photo/PDF + one order link, same pattern as packing slip. */
export async function notifyLrWhatsApp(input: {
  order: Order;
  settings: AppSettings;
  users?: UserProfile[];
  locale: Locale;
  lrFileUrl?: string;
}): Promise<WhatsAppSendResult> {
  pingCustomerOrderPush(
    input.order,
    input.locale,
    input.locale === "hi"
      ? `${input.order.orderNumber} · LR / डिलीवर`
      : `${input.order.orderNumber} · LR / delivered`
  );
  if (input.settings.whatsappNotifyEnabled === false) {
    return { ok: false, mode: "off" };
  }
  const phone = resolveOrderPhone(input.order, input.users);
  if (!phone) return { ok: false, mode: "off", error: "Invalid phone" };
  const text = renderWaTemplate(
    "lr",
    input.locale,
    waVarsFromOrder({
      order: input.order,
      locale: input.locale,
      companyName: input.settings.companyName,
      status: "delivered",
      settings: input.settings,
    }),
    input.settings
  );
  let hosted = publicHttpsUrl(input.lrFileUrl || input.order.lrFileDataUrl);
  const rawFile = input.lrFileUrl || input.order.lrFileDataUrl || "";
  const localDataUrl = rawFile.startsWith("data:") ? rawFile : undefined;
  if (!hosted && localDataUrl && typeof window !== "undefined") {
    try {
      const { uploadMediaFile } = await import("@/lib/upload-media");
      const match = /^data:([^;]+);base64,(.+)$/i.exec(localDataUrl);
      if (match) {
        const binary = atob(match[2]);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const mime = match[1] || "image/jpeg";
        const ext = mime.includes("pdf") ? "pdf" : "jpg";
        const file = new File(
          [bytes],
          `${input.order.orderNumber}-LR.${ext}`,
          { type: mime }
        );
        const uploaded = await uploadMediaFile(file, "lr");
        hosted = publicHttpsUrl(uploaded.url);
      }
    } catch {
      /* still send the caption */
    }
  }
  const filename =
    input.order.lrNumber?.trim()
      ? `LR-${input.order.lrNumber.replace(/[^\w.-]+/g, "_")}`
      : `${input.order.orderNumber}-LR`;
  const pdf = isPdfAttachment(hosted || localDataUrl, filename);
  const documentBase64 =
    !hosted && localDataUrl && pdf
      ? /^data:[^;]+;base64,(.+)$/i.exec(localDataUrl)?.[1]
      : undefined;
  const imageBase64 =
    !hosted && localDataUrl && !pdf
      ? /^data:[^;]+;base64,(.+)$/i.exec(localDataUrl)?.[1]
      : undefined;
  const withExt = pdf ? `${filename}.pdf` : `${filename}.jpg`;
  const sent = await sendWhatsAppMessage(
    phone,
    text,
    whatsappCountryCode(input.settings),
    hosted || documentBase64 || imageBase64
      ? pdf
        ? {
            documentUrl: hosted,
            filename: withExt,
            documentBase64,
          }
        : {
            imageUrl: hosted,
            imageBase64,
            imageFilename: withExt,
            imageCaption: text.slice(0, 1000),
          }
      : undefined
  );
  if (!sent.attached) {
    const downloadSrc = localDataUrl || hosted;
    if (downloadSrc) downloadDataUrl(downloadSrc, withExt);
  }
  return sent;
}

/** After packing slip finalize: download PDF + dealer WhatsApp (slip + bill ready). */
export async function notifyPackingSlipFinalizedWhatsApp(input: {
  order: Order;
  settings: AppSettings;
  users: UserProfile[];
  locale: Locale;
}): Promise<WhatsAppSendResult> {
  const phone = resolveOrderPhone(input.order, input.users);
  if (!phone) return { ok: false, mode: "off", error: "Invalid phone" };
  const pdf = input.order.packingSlip?.customerPdfUrl;
  const slip = await notifyPackingSlipWhatsApp({
    phone,
    partyName: input.order.checkoutName || input.order.userName || "Dealer",
    voucherNumber: input.order.orderNumber,
    settings: input.settings,
    locale: input.locale,
    orderNumber: input.order.orderNumber,
    orderId: input.order.id,
    packingSlipDataUrl: pdf,
    packingSlipName: `${input.order.orderNumber}-packing-slip.pdf`,
    audience: "customer",
    discountAmount: input.order.schemeDiscount,
    discountLabel: input.order.schemeDiscountLabel,
    billAmount: input.order.actualBillAmount,
    order: input.order,
  });
  return slip;
}

/** Short browser chime for staff when a new estimate arrives. */
export function playStaffNewOrderChime(): void {
  if (typeof window === "undefined") return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const beep = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.18, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    };
    beep(880, 0, 0.12);
    beep(1174, 0.14, 0.16);
    void ctx.resume();
    window.setTimeout(() => {
      void ctx.close();
    }, 800);
  } catch {
    /* autoplay blocked until user gesture */
  }
}
