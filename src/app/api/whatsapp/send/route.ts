import { NextRequest, NextResponse } from "next/server";

/**
 * Meta WhatsApp Cloud API sender.
 * Env:
 *   WHATSAPP_TOKEN
 *   WHATSAPP_PHONE_NUMBER_ID
 *   WHATSAPP_API_VERSION (optional, default v21.0)
 *   WHATSAPP_SEND_KEY (optional in dev; REQUIRED in production to prevent
 *     unauthenticated relay abuse — cost/spam risk).
 */
function isAuthorized(req: NextRequest): boolean {
  const required = process.env.WHATSAPP_SEND_KEY;
  if (!required) {
    // Dev-only fallback: block in prod deployments to prevent abuse.
    return process.env.NODE_ENV !== "production";
  }
  const key =
    req.headers.get("x-whatsapp-key") ||
    req.nextUrl.searchParams.get("key") ||
    "";
  return key === required;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";

  if (!token || !phoneNumberId) {
    return NextResponse.json(
      {
        ok: false,
        configured: false,
        error:
          "WhatsApp Cloud API not configured. Set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID.",
      },
      { status: 503 }
    );
  }

  try {
    const body = (await req.json()) as {
      to?: string;
      text?: string;
      previewUrl?: boolean;
    };
    const to = (body.to || "").replace(/\D/g, "");
    const text = (body.text || "").trim();
    if (to.length < 10 || !text) {
      return NextResponse.json(
        { ok: false, error: "Need to (digits) and text" },
        { status: 400 }
      );
    }

    const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          preview_url: body.previewUrl !== false,
          body: text.slice(0, 4096),
        },
      }),
    });

    const data = (await res.json()) as {
      messages?: { id: string }[];
      error?: { message?: string };
    };

    if (!res.ok) {
      // Log full Meta details server-side; return a generic error to caller.
      console.warn("[whatsapp] send failed", res.status, data);
      return NextResponse.json(
        {
          ok: false,
          configured: true,
          error: data.error?.message || `WhatsApp API ${res.status}`,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      configured: true,
      messageId: data.messages?.[0]?.id,
      mode: "cloud_api",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET() {
  const configured = Boolean(
    process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
  );
  return NextResponse.json({
    service: "tt-enterprises-whatsapp",
    configured,
    mode: configured ? "cloud_api" : "wa.me_fallback",
  });
}
