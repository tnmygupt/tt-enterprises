import type { AppSettings, Locale, Order, OrderStatus, UserProfile } from "./types";
import { ROLE_CAPABILITIES } from "./types";
import { formatInr } from "./pricing";
import { normalizePhone } from "./phone";

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
  return "https://app.ttenterprises.shop";
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
  mode: "cloud_api" | "wa.me" | "off";
  error?: string;
};

/** Send via Meta Cloud API when configured; otherwise open wa.me. */
export async function sendWhatsAppMessage(
  phone: string,
  text: string,
  countryCode = "91",
  options?: { preferWaMe?: boolean; outboxLabel?: string; enqueueOnly?: boolean }
): Promise<WhatsAppSendResult> {
  const digits = toWhatsAppDigits(phone, countryCode);
  if (!digits) return { ok: false, mode: "off", error: "Invalid phone" };
  if (typeof window === "undefined") {
    return { ok: false, mode: "off", error: "Client only" };
  }

  if (!options?.preferWaMe && !options?.enqueueOnly) {
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: digits, text }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        configured?: boolean;
        error?: string;
      };
      if (res.ok && data.ok) {
        return { ok: true, mode: "cloud_api" };
      }
      if (res.status !== 503) {
        console.warn("[whatsapp] Cloud API failed:", data.error);
      }
    } catch (err) {
      console.warn("[whatsapp] Cloud API unreachable", err);
    }
  }

  if (options?.enqueueOnly) {
    const { enqueueWaOutbox } = await import("@/lib/wa-outbox");
    enqueueWaOutbox({
      phone,
      text,
      label: options.outboxLabel,
    });
    return { ok: true, mode: "wa.me" };
  }

  const opened = openWhatsApp(phone, text, countryCode);
  if (!opened) {
    const { enqueueWaOutbox } = await import("@/lib/wa-outbox");
    enqueueWaOutbox({
      phone,
      text,
      label: options?.outboxLabel,
    });
    return { ok: false, mode: "wa.me", error: "Could not open WhatsApp" };
  }
  return { ok: true, mode: "wa.me" };
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

function statusLabel(status: OrderStatus, locale: Locale): string {
  const en: Record<OrderStatus, string> = {
    estimate: "Estimate received",
    confirmed: "Order confirmed",
    payment_pending: "Final bill ready — payment pending",
    payment_verified: "Payment verified",
    dispatched: "Dispatched",
    delivered: "Delivered",
    cancelled: "Cancelled",
  };
  const hi: Record<OrderStatus, string> = {
    estimate: "अनुमान प्राप्त",
    confirmed: "ऑर्डर कन्फर्म",
    payment_pending: "अंतिम बिल तैयार — पेमेंट लंबित",
    payment_verified: "पेमेंट सत्यापित",
    dispatched: "डिस्पैच हो गया",
    delivered: "डिलीवर हो गया",
    cancelled: "रद्द",
  };
  return (locale === "hi" ? hi : en)[status];
}

function hasManageOrders(role: UserProfile["role"]): boolean {
  return ROLE_CAPABILITIES[role]?.includes("manage_orders") ?? false;
}

export function orderUpdateWhatsAppText(input: {
  order: Order;
  status: OrderStatus;
  companyName: string;
  locale: Locale;
  extraNote?: string;
}): string {
  const { order, status, companyName, locale, extraNote } = input;
  const amount =
    order.actualBillAmount != null
      ? formatInr(order.actualBillAmount, locale)
      : formatInr(order.estimatedTotal, locale);
  const name = order.checkoutName || order.userName;
  const link = appPageUrl(`/orders/${order.id}`, locale);
  const lines =
    locale === "hi"
      ? [
          `नमस्ते ${name},`,
          "",
          `${companyName} — ऑर्डर अपडेट`,
          `ऑर्डर: ${order.orderNumber}`,
          `स्थिति: ${statusLabel(status, locale)}`,
          `राशि: ${amount}`,
          order.lrNumber ? `LR: ${order.lrNumber}` : "",
          extraNote || "",
          "",
          openLinkLine(link, locale),
          "धन्यवाद!",
        ]
      : [
          `Hello ${name},`,
          "",
          `${companyName} — Order update`,
          `Order: ${order.orderNumber}`,
          `Status: ${statusLabel(status, locale)}`,
          `Amount: ${amount}`,
          order.lrNumber ? `LR: ${order.lrNumber}` : "",
          extraNote || "",
          "",
          openLinkLine(link, locale),
          "Thank you!",
        ];
  return lines.filter(Boolean).join("\n");
}

export function packingSlipWhatsAppText(input: {
  partyName: string;
  voucherNumber: string;
  companyName: string;
  locale: Locale;
  orderNumber?: string;
  orderId?: string;
  packingSlipName?: string;
  /** customer = dealer order page; staff = admin packing slip */
  audience?: "customer" | "staff";
}): string {
  const {
    partyName,
    voucherNumber,
    companyName,
    locale,
    orderNumber,
    orderId,
    packingSlipName,
    audience = "customer",
  } = input;
  const link = orderId
    ? audience === "staff"
      ? appPageUrl(`/admin/orders/${orderId}/packing-slip`, locale)
      : appPageUrl(`/orders/${orderId}`, locale)
    : appPageUrl("/orders", locale);
  if (locale === "hi") {
    return [
      `नमस्ते ${partyName},`,
      "",
      `${companyName} — पैकिंग स्लिप`,
      `वाउचर: ${voucherNumber}`,
      orderNumber ? `ऑर्डर: ${orderNumber}` : "",
      packingSlipName ? `फ़ाइल: ${packingSlipName}` : "",
      "",
      openLinkLine(link, locale),
      "धन्यवाद!",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `Hello ${partyName},`,
    "",
    `${companyName} — Packing slip`,
    `Voucher: ${voucherNumber}`,
    orderNumber ? `Order: ${orderNumber}` : "",
    packingSlipName ? `File: ${packingSlipName}` : "",
    "",
    openLinkLine(link, locale),
    "Thank you!",
  ]
    .filter(Boolean)
    .join("\n");
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
      : appPageUrl("/orders", input.locale);
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
}): string {
  const { order, companyName, locale } = input;
  const amount =
    order.actualBillAmount != null
      ? formatInr(order.actualBillAmount, locale)
      : formatInr(order.estimatedTotal, locale);
  const link = appPageUrl(`/orders/${order.id}`, locale);
  if (locale === "hi") {
    return [
      `${companyName} — नया ऑर्डर`,
      `ऑर्डर: ${order.orderNumber}`,
      `डीलर: ${order.checkoutName || order.userName}`,
      order.phone ? `फ़ोन: ${order.phone}` : "",
      `राशि: ${amount}`,
      "स्थिति: प्रोसेस के लिए तैयार (अनुमान)",
      "",
      openLinkLine(link, locale),
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    `${companyName} — New order`,
    `Order: ${order.orderNumber}`,
    `Dealer: ${order.checkoutName || order.userName}`,
    order.phone ? `Phone: ${order.phone}` : "",
    `Amount: ${amount}`,
    "Status: Ready to process (estimate)",
    "",
    openLinkLine(link, locale),
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Notify all active staff with manage_orders when a new estimate is placed.
 * Silent no-op when WhatsApp is disabled or no staff phones.
 */
export async function notifyStaffNewOrder(input: {
  order: Order;
  settings: AppSettings;
  users: UserProfile[];
  locale: Locale;
}): Promise<number> {
  if (input.settings.whatsappNotifyEnabled === false) return 0;
  const text = staffNewOrderWhatsAppText({
    order: input.order,
    companyName: input.settings.companyName || "TT Enterprises",
    locale: input.locale,
  });
  const country = whatsappCountryCode(input.settings);
  const seen = new Set<string>();
  let sent = 0;
  let openedWaMe = false;
  for (const u of input.users) {
    if (!u.active || !hasManageOrders(u.role)) continue;
    if (u.id === input.order.userId) continue;
    const phone = u.phone?.trim();
    if (!phone) continue;
    const digits = toWhatsAppDigits(phone, country);
    if (!digits || seen.has(digits)) continue;
    seen.add(digits);
    const result = await sendWhatsAppMessage(phone, text, country, {
      outboxLabel: u.name,
      enqueueOnly: openedWaMe,
    });
    if (result.mode === "cloud_api" && result.ok) {
      sent += 1;
      continue;
    }
    if (result.ok && result.mode === "wa.me") {
      if (!openedWaMe) openedWaMe = true;
      sent += 1;
    }
  }
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
}): Promise<boolean> {
  const text = partyStatementWhatsAppText(input);
  const result = await sendWhatsAppMessage(
    input.phone,
    text,
    input.countryCode || "91"
  );
  return result.ok;
}

/**
 * Notify customer of an order update via WhatsApp.
 * Uses Meta Cloud API when WHATSAPP_* env is set; otherwise opens wa.me.
 */
export async function notifyOrderWhatsApp(input: {
  order: Order;
  status: OrderStatus;
  settings: AppSettings;
  users?: UserProfile[];
  locale: Locale;
  extraNote?: string;
}): Promise<boolean> {
  const locale = input.locale;
  try {
    const { notifyUserPush } = await import("@/lib/push-client");
    await notifyUserPush({
      userId: input.order.userId,
      title: locale === "hi" ? "ऑर्डर अपडेट" : "Order update",
      body: `${input.order.orderNumber} · ${input.status}`,
      url: `/${locale}/orders/${input.order.id}`,
    });
  } catch {
    /* best-effort */
  }

  if (input.settings.whatsappNotifyEnabled === false) return false;
  const phone = resolveOrderPhone(input.order, input.users);
  if (!phone) return false;
  const text = orderUpdateWhatsAppText({
    order: input.order,
    status: input.status,
    companyName: input.settings.companyName,
    locale: input.locale,
    extraNote: input.extraNote,
  });
  const result = await sendWhatsAppMessage(
    phone,
    text,
    whatsappCountryCode(input.settings),
    { outboxLabel: input.order.userName || phone }
  );
  return result.ok;
}

/** Packing slip: download file + send WhatsApp (Cloud API or wa.me). */
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
}): Promise<boolean> {
  if (input.settings.whatsappNotifyEnabled === false) return false;
  const text = packingSlipWhatsAppText({
    partyName: input.partyName,
    voucherNumber: input.voucherNumber,
    companyName: input.settings.companyName,
    locale: input.locale,
    orderNumber: input.orderNumber,
    orderId: input.orderId,
    packingSlipName: input.packingSlipName,
    audience: input.audience ?? "customer",
  });
  if (input.packingSlipDataUrl) {
    downloadDataUrl(
      input.packingSlipDataUrl,
      input.packingSlipName || "packing-slip"
    );
  }
  const result = await sendWhatsAppMessage(
    input.phone,
    text,
    whatsappCountryCode(input.settings)
  );
  return result.ok;
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
