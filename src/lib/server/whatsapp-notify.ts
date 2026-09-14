import {
  userHasCapability,
  type CapabilityContext,
} from "@/lib/capabilities";
import type {
  AppSettings,
  Capability,
  Locale,
  Order,
  OrderStatus,
  UserProfile,
} from "@/lib/types";
import {
  sendTallyWaImage,
  sendTallyWaText,
  tallyWaConfigured,
} from "@/lib/server/tally-whatsapp";
import { hostPublicBuffer } from "@/lib/server/host-public-file";
import { formatInr } from "@/lib/pricing";
import { siteUrl } from "@/lib/site";
import { dataUrlBase64, resolveOrderPay } from "@/lib/wa-pay";
import {
  dealerApprovedWhatsAppText,
  dealerRejectedWhatsAppText,
  dealerPasswordResetAckWhatsAppText,
  orderUpdateWhatsAppText,
  staffNewOrderWhatsAppText,
  staffPasswordResetWhatsAppText,
  staffSignupWhatsAppText,
  toWhatsAppDigits,
} from "@/lib/whatsapp";

/**
 * One phone, server-side (no session). Skips if Tally instance is off.
 */
export async function sendWhatsAppTextServer(input: {
  phone: string;
  text: string;
  countryCode?: string;
  enabled?: boolean;
}): Promise<boolean> {
  if (input.enabled === false) return false;
  if (!tallyWaConfigured()) return false;
  const country = (input.countryCode || "91").replace(/\D/g, "") || "91";
  const digits = toWhatsAppDigits(input.phone, country);
  if (!digits) return false;
  try {
    const result = await sendTallyWaText(digits, input.text);
    return result.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendOrderPayQrServer(input: {
  phone: string;
  order: Order;
  status: OrderStatus;
  settings: AppSettings;
  locale: Locale;
}): Promise<void> {
  const pay = resolveOrderPay(input.settings, {
    ...input.order,
    status: input.status,
  });
  if (!pay) return;
  const digits = toWhatsAppDigits(
    input.phone,
    input.settings.whatsappCountryCode || "91"
  );
  if (!digits) return;

  let imageUrl = "";
  if (pay.upiUrl) {
    const QRCode = (await import("qrcode")).default;
    const dataUrl = await QRCode.toDataURL(pay.upiUrl, {
      width: 480,
      margin: 2,
      errorCorrectionLevel: "M",
    });
    const raw = dataUrlBase64(dataUrl);
    if (raw) {
      const hosted = await hostPublicBuffer({
        buffer: Buffer.from(raw, "base64"),
        mime: "image/png",
        folder: "misc",
        originalName: `pay-${input.order.orderNumber}.png`,
      });
      imageUrl = hosted?.url || "";
    }
  } else if (pay.staticQrDataUrl) {
    const staticQr = pay.staticQrDataUrl.trim();
    if (staticQr.startsWith("data:")) {
      const raw = dataUrlBase64(staticQr);
      if (raw) {
        const mime = /^data:([^;]+);/i.exec(staticQr)?.[1] || "image/png";
        const hosted = await hostPublicBuffer({
          buffer: Buffer.from(raw, "base64"),
          mime,
          folder: "misc",
          originalName: `pay-${input.order.orderNumber}.png`,
        });
        imageUrl = hosted?.url || "";
      }
    } else if (/^https:\/\//i.test(staticQr)) {
      imageUrl = staticQr;
    }
  }
  if (imageUrl.startsWith("/")) imageUrl = `${siteUrl()}${imageUrl}`;
  if (!/^https:\/\//i.test(imageUrl)) return;
  const caption =
    input.locale === "hi"
      ? `स्कैन करें — पेमेंट ${formatInr(pay.amount, input.locale)} · UPI नोट ${pay.payRef}`
      : `Scan to pay ${formatInr(pay.amount, input.locale)} · UPI note ${pay.payRef}`;
  await sendTallyWaImage(digits, imageUrl, caption);
}

/**
 * Server-side staff WhatsApp (no session). Used when nobody is logged in
 * (dealer signup). Skips if the Tally instance is not configured.
 * Do not log instance keys. Sends to every active staff unless capability set.
 */
export async function notifyStaffWhatsAppServer(input: {
  users: UserProfile[];
  capability?: Capability;
  capabilityContext?: CapabilityContext | null;
  text: string;
  countryCode?: string;
  skipUserIds?: string[];
  enabled?: boolean;
}): Promise<number> {
  if (input.enabled === false) return 0;
  if (!tallyWaConfigured()) return 0;
  const country = (input.countryCode || "91").replace(/\D/g, "") || "91";
  const skip = new Set(input.skipUserIds ?? []);
  const seen = new Set<string>();
  let sent = 0;
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
    if (sent > 0) await sleep(400);
    try {
      const result = await sendTallyWaText(digits, input.text);
      if (result.ok) sent += 1;
    } catch {
      /* best-effort */
    }
  }
  return sent;
}

export async function notifyStaffDealerSignup(input: {
  users: UserProfile[];
  dealer: UserProfile;
  companyName?: string;
  locale: Locale;
  countryCode?: string;
  enabled?: boolean;
}): Promise<number> {
  const text = staffSignupWhatsAppText({
    dealer: input.dealer,
    companyName: input.companyName || "TT Enterprises",
    locale: input.locale,
  });
  return notifyStaffWhatsAppServer({
    users: input.users,
    text,
    countryCode: input.countryCode,
    skipUserIds: [input.dealer.id],
    enabled: input.enabled,
  });
}

export async function notifyStaffNewEstimateServer(input: {
  users: UserProfile[];
  order: Order;
  companyName?: string;
  locale?: Locale;
  countryCode?: string;
  enabled?: boolean;
  skipUserIds?: string[];
  settings?: AppSettings | null;
}): Promise<number> {
  const text = staffNewOrderWhatsAppText({
    order: input.order,
    companyName: input.companyName || "TT Enterprises",
    locale: input.locale === "hi" ? "hi" : "en",
    settings: input.settings ?? undefined,
  });
  const skip = [input.order.userId, ...(input.skipUserIds ?? [])];
  return notifyStaffWhatsAppServer({
    users: input.users,
    text,
    countryCode: input.countryCode,
    skipUserIds: skip,
    enabled: input.enabled,
  });
}

/** Customer WhatsApp after dealer approve/reject — does not need the admin browser. */
export async function notifyDealerReviewServer(input: {
  user: UserProfile;
  action: "approve" | "reject";
  settings?: AppSettings | null;
}): Promise<boolean> {
  const settings = input.settings;
  const locale = input.user.locale === "hi" ? "hi" : "en";
  const text =
    input.action === "approve"
      ? dealerApprovedWhatsAppText({
          user: input.user,
          companyName: settings?.companyName || "TT Enterprises",
          locale,
        })
      : dealerRejectedWhatsAppText({
          user: input.user,
          companyName: settings?.companyName || "TT Enterprises",
          officePhone: settings?.phone,
          locale,
        });
  const sent = await sendWhatsAppTextServer({
    phone: input.user.phone || "",
    text,
    countryCode: settings?.whatsappCountryCode,
    enabled: settings?.whatsappNotifyEnabled,
  });
  return sent;
}

/** Customer WhatsApp after place / status change — does not need the browser. */
export async function notifyCustomerOrderUpdateServer(input: {
  order: Order;
  status: OrderStatus;
  settings?: AppSettings | null;
  locale?: Locale;
  extraNote?: string;
}): Promise<boolean> {
  const locale = input.locale === "hi" ? "hi" : "en";
  const settings = input.settings;
  const phone = (input.order.phone || "").trim();
  const text = orderUpdateWhatsAppText({
    order: input.order,
    status: input.status,
    companyName: settings?.companyName || "TT Enterprises",
    locale,
    extraNote: input.extraNote,
    settings: settings ?? undefined,
  });
  const sent = await sendWhatsAppTextServer({
    phone,
    text,
    countryCode: settings?.whatsappCountryCode,
    enabled: settings?.whatsappNotifyEnabled,
  });
  if (sent && settings) {
    try {
      await sendOrderPayQrServer({
        phone,
        order: input.order,
        status: input.status,
        settings,
        locale,
      });
    } catch {
      /* QR is extra — text already sent */
    }
  }
  return sent;
}

export async function notifyStaffPasswordResetRequest(input: {
  users: UserProfile[];
  requester: UserProfile;
  companyName?: string;
  locale: Locale;
  countryCode?: string;
  enabled?: boolean;
  capabilityContext?: CapabilityContext | null;
}): Promise<number> {
  const text = staffPasswordResetWhatsAppText({
    user: input.requester,
    companyName: input.companyName || "TT Enterprises",
    locale: input.locale,
  });
  return notifyStaffWhatsAppServer({
    users: input.users,
    capability: "manage_users",
    capabilityContext: input.capabilityContext,
    text,
    countryCode: input.countryCode,
    skipUserIds: [input.requester.id],
    enabled: input.enabled,
  });
}

export async function notifyUserPasswordResetAck(input: {
  user: UserProfile;
  settings?: AppSettings | null;
}): Promise<boolean> {
  const settings = input.settings;
  const locale = input.user.locale === "hi" ? "hi" : "en";
  const text = dealerPasswordResetAckWhatsAppText({
    name: input.user.name,
    companyName: settings?.companyName || "TT Enterprises",
    locale,
    officePhone: settings?.phone,
  });
  return sendWhatsAppTextServer({
    phone: input.user.phone || "",
    text,
    countryCode: settings?.whatsappCountryCode,
    enabled: settings?.whatsappNotifyEnabled,
  });
}
