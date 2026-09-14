import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { serverCfgValue } from "@/lib/server/read-cfg";
import { tallyWaWebhookSecrets } from "@/lib/server/tally-whatsapp";

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function secretsMatch(provided: string, allowed: string[]): boolean {
  const got = (provided || "").trim();
  if (!got || !allowed.length) return false;
  const hashed = digest(got);
  return allowed.some((a) => {
    const want = (a || "").trim();
    if (!want) return false;
    return timingSafeEqual(hashed, digest(want));
  });
}

export function whatsappWebhookSecrets(): string[] {
  const found = new Set<string>();
  const extra = serverCfgValue("WA_WEBHOOK_SECRET");
  if (extra) found.add(extra);
  for (const s of tallyWaWebhookSecrets()) found.add(s);
  return [...found];
}

function providedWebhookSecret(req: NextRequest): string {
  return (
    req.nextUrl.searchParams.get("secret") ||
    req.nextUrl.searchParams.get("token") ||
    req.nextUrl.searchParams.get("instance") ||
    req.headers.get("x-webhook-secret") ||
    req.headers.get("x-hub-verify-token") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    ""
  ).trim();
}

function bodyInstanceSecrets(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const rec = body as Record<string, unknown>;
  const nested =
    rec.data && typeof rec.data === "object"
      ? (rec.data as Record<string, unknown>)
      : {};
  const vals = [
    rec.instance_id,
    rec.instanceId,
    rec.instance,
    rec.token,
    rec.instance_key,
    nested.instance_id,
    nested.instanceId,
    nested.instance,
    nested.token,
  ];
  return vals.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
}

export function authorizeWhatsAppWebhook(
  req: NextRequest,
  body?: unknown
): boolean {
  const allowed = whatsappWebhookSecrets();
  if (!allowed.length) return false;
  if (secretsMatch(providedWebhookSecret(req), allowed)) return true;
  return bodyInstanceSecrets(body).some((s) => secretsMatch(s, allowed));
}

export function authorizeMetaVerify(req: NextRequest): string | null {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token") || "";
  const challenge = req.nextUrl.searchParams.get("hub.challenge");
  if (mode !== "subscribe" || !challenge) return null;
  const allowed = whatsappWebhookSecrets();
  if (!secretsMatch(token, allowed)) return null;
  return challenge;
}
