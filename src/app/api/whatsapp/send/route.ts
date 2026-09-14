import { NextRequest, NextResponse } from "next/server";
import { hostPublicBuffer } from "@/lib/server/host-public-file";
import { rateLimit } from "@/lib/server/rate-limit";
import { readSessionCookie } from "@/lib/server/session";
import { publicOrigin } from "@/lib/server/public-origin";
import {
  sendTallyWaDocument,
  sendTallyWaImage,
  sendTallyWaText,
  tallyWaConfigured,
} from "@/lib/server/tally-whatsapp";

/**
 * Silent WhatsApp sender.
 * Prefers TallyWebSolutions QR instance (TALLY_WA_INSTANCE_KEY), then Meta Cloud API.
 *
 * Auth: logged-in session cookie, or WHATSAPP_SEND_KEY header/query.
 */
function isAuthorized(req: NextRequest): boolean {
  const session = readSessionCookie(req);
  if (session && session.role !== "customer") return true;
  const required = process.env.WHATSAPP_SEND_KEY;
  if (!required) return false;
  const key =
    req.headers.get("x-whatsapp-key") ||
    req.nextUrl.searchParams.get("key") ||
    "";
  return key === required;
}

function toHttpsFileUrl(url: string, req: NextRequest): string {
  const raw = (url || "").trim();
  if (/^https:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) {
    const origin = publicOrigin(req);
    if (origin.startsWith("https://")) return `${origin}${raw}`;
  }
  return raw;
}

function sniffImageMime(b64: string): string {
  if (b64.startsWith("/9j/")) return "image/jpeg";
  if (b64.startsWith("R0lGOD")) return "image/gif";
  if (b64.startsWith("UklGR")) return "image/webp";
  return "image/png";
}

function clientLimitKey(req: NextRequest): string {
  const session = readSessionCookie(req);
  if (session?.id) return `wa:${session.id}`;
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0]?.trim() || "unknown";
  return `wa:${ip}`;
}

function configuredMode(): "tally_instance" | "cloud_api" | "wa.me_fallback" {
  if (tallyWaConfigured()) return "tally_instance";
  if (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
    return "cloud_api";
  }
  return "wa.me_fallback";
}

async function sendMetaCloud(
  to: string,
  text: string,
  previewUrl: boolean,
  document?: { url: string; filename: string },
  image?: { url: string; caption?: string },
) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";
  if (!token || !phoneNumberId) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        error:
          "WhatsApp not configured. Set TALLY_WA_INSTANCE_KEY or WHATSAPP_TOKEN.",
      },
      { status: 503 },
    );
  }

  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
  const payload = document
    ? {
        messaging_product: "whatsapp",
        to,
        type: "document",
        document: {
          link: document.url,
          filename: document.filename || "packing-slip.pdf",
          caption: text.slice(0, 1024),
        },
      }
    : image
      ? {
          messaging_product: "whatsapp",
          to,
          type: "image",
          image: {
            link: image.url,
            caption: (image.caption || text).slice(0, 1024),
          },
        }
      : {
          messaging_product: "whatsapp",
          to,
          type: "text",
          text: {
            preview_url: previewUrl,
            body: text.slice(0, 4096),
          },
        };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await res.json()) as {
    messages?: { id: string }[];
    error?: { message?: string };
  };

  if (!res.ok) {
    if (document) {
      console.warn(
        "[whatsapp] cloud document failed, sending text",
        res.status,
      );
      return sendMetaCloud(to, text, previewUrl);
    }
    console.warn("[whatsapp] cloud send failed", res.status);
    return NextResponse.json(
      {
        ok: false,
        configured: true,
        mode: "cloud_api",
        error: data.error?.message || `WhatsApp API ${res.status}`,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    configured: true,
    messageId: data.messages?.[0]?.id,
    mode: "cloud_api",
    attached: !!(document || image),
  });
}

export async function POST(req: NextRequest) {
  const authorized = isAuthorized(req);
  const session = readSessionCookie(req);
  if (!authorized) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const limited = rateLimit(clientLimitKey(req), 40, 15 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `Too many messages. Try again in ${limited.retryAfterSec}s`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  let body: {
    to?: string;
    text?: string;
    previewUrl?: boolean;
    documentUrl?: string;
    filename?: string;
    documentBase64?: string;
    imageUrl?: string;
    imageBase64?: string;
    imageFilename?: string;
    imageCaption?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const to = (body.to || "").replace(/\D/g, "");
  const text = (body.text || "").trim();
  if (to.length < 10 || !text) {
    return NextResponse.json(
      { ok: false, error: "Need to (digits) and text" },
      { status: 400 },
    );
  }

  const filename = (body.filename || "packing-slip.pdf").replace(
    /[^\w.\-]+/g,
    "_",
  );
  let documentUrl = toHttpsFileUrl(body.documentUrl || "", req);
  if (!/^https:\/\//i.test(documentUrl)) {
    const raw = (body.documentBase64 || "").replace(/\s+/g, "");
    if (raw && raw.length < 12_000_000 && /^[A-Za-z0-9+/=]+$/.test(raw)) {
      try {
        const buffer = Buffer.from(raw, "base64");
        if (buffer.length > 0 && buffer.length <= 8 * 1024 * 1024) {
          const hosted = await hostPublicBuffer({
            buffer,
            mime: "application/pdf",
            folder: "bills",
            originalName: filename,
          });
          if (hosted) documentUrl = toHttpsFileUrl(hosted.url, req);
        }
      } catch {
        /* send text without the file */
      }
    }
  }
  const canAttach = /^https:\/\//i.test(documentUrl);

  const imageFilename = (body.imageFilename || "pay-qr.png").replace(
    /[^\w.\-]+/g,
    "_",
  );
  let imageUrl = toHttpsFileUrl(body.imageUrl || "", req);
  if (!/^https:\/\//i.test(imageUrl)) {
    const raw = (body.imageBase64 || "").replace(/\s+/g, "");
    if (raw && raw.length < 12_000_000 && /^[A-Za-z0-9+/=]+$/.test(raw)) {
      try {
        const buffer = Buffer.from(raw, "base64");
        if (buffer.length > 0 && buffer.length <= 8 * 1024 * 1024) {
          const hosted = await hostPublicBuffer({
            buffer,
            mime: sniffImageMime(raw),
            folder: "misc",
            originalName: imageFilename,
          });
          if (hosted) imageUrl = toHttpsFileUrl(hosted.url, req);
        }
      } catch {
        /* skip QR */
      }
    }
  }
  const canImage = /^https:\/\//i.test(imageUrl);
  const imageCaption = (body.imageCaption || "").trim() || text.slice(0, 1000);

  try {
    if (tallyWaConfigured()) {
      let attached = false;
      const imageOnly = canImage && !canAttach;

      if (canAttach) {
        const doc = await sendTallyWaDocument(to, documentUrl, filename, text);
        if (doc.ok) attached = true;
        else console.warn("[whatsapp] tally document failed, sending text");
      }

      if (!attached && !imageOnly) {
        const sent = await sendTallyWaText(to, text);
        if (!sent.ok) {
          return NextResponse.json(
            {
              ok: false,
              configured: true,
              mode: "tally_instance",
              error: sent.error || "WhatsApp gateway failed",
            },
            { status: 502 },
          );
        }
      }

      if (canImage) {
        const img = await sendTallyWaImage(to, imageUrl, imageCaption);
        if (img.ok) attached = true;
        else {
          console.warn("[whatsapp] tally image failed");
          if (imageOnly) {
            const sent = await sendTallyWaText(to, text);
            if (!sent.ok) {
              return NextResponse.json(
                {
                  ok: false,
                  configured: true,
                  mode: "tally_instance",
                  error: sent.error || "WhatsApp gateway failed",
                },
                { status: 502 },
              );
            }
          }
        }
      }

      return NextResponse.json({
        ok: true,
        configured: true,
        mode: "tally_instance",
        attached,
      });
    }

    const meta = await sendMetaCloud(
      to,
      text,
      body.previewUrl !== false,
      canAttach ? { url: documentUrl, filename } : undefined,
      !canAttach && canImage
        ? { url: imageUrl, caption: imageCaption }
        : undefined,
    );
    if (canAttach && canImage) {
      await sendMetaCloud(to, imageCaption, false, undefined, {
        url: imageUrl,
        caption: imageCaption,
      });
    }
    return meta;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  const mode = configuredMode();
  return NextResponse.json({
    service: "tt-enterprises-whatsapp",
    configured: mode !== "wa.me_fallback",
    mode,
  });
}
