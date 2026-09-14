import { existsSync, readFileSync } from "fs";
import { join } from "path";

/**
 * TallyWebSolutions QR-instance sender (same panel as the Tally TDL).
 * Confirmed live path: POST/GET {base}/api/sendText?token=&phone=&message=
 * Secrets stay server-only — never NEXT_PUBLIC.
 * Hostinger hPanel env is preferred; config/tally-wa.cfg is the deploy fallback.
 */

export type TallyWaSendResult = {
  ok: boolean;
  status: number;
  error?: string;
};

type TallyWaFile = {
  instance?: string;
  token?: string;
  base?: string;
};

let fileCache: TallyWaFile | null = null;

function parseKeyFile(raw: string): TallyWaFile {
  const out: TallyWaFile = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key === "TALLY_WA_INSTANCE_KEY") out.instance = val;
    if (key === "TALLY_WA_ACCESS_TOKEN") out.token = val;
    if (key === "TALLY_WA_BASE_URL") out.base = val;
  }
  return out;
}

function tallyWaCandidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    join(cwd, "config", "tally-wa.cfg"),
    join(cwd, "tally-wa.cfg"),
    join(cwd, ".env.production"),
    join(cwd, ".env"),
  ];
}

function tallyWaFromFile(): TallyWaFile {
  if (fileCache?.instance) return fileCache;
  try {
    for (const path of tallyWaCandidatePaths()) {
      if (!existsSync(/* turbopackIgnore: true */ path)) continue;
      const parsed = parseKeyFile(
        readFileSync(/* turbopackIgnore: true */ path, "utf8")
      );
      if (parsed.instance) {
        fileCache = parsed;
        return parsed;
      }
    }
  } catch {
    /* ignore missing / unreadable files */
  }
  return {};
}

function tallyWaSecrets(): { instance: string; token: string } | null {
  const fromFile = tallyWaFromFile();
  const instance = (
    process.env.TALLY_WA_INSTANCE_KEY ||
    fromFile.instance ||
    ""
  ).trim();
  if (!instance) return null;
  const token = (
    process.env.TALLY_WA_ACCESS_TOKEN ||
    fromFile.token ||
    instance
  ).trim();
  return { instance, token };
}

export function tallyWaConfigured(): boolean {
  return Boolean(tallyWaSecrets());
}

/** Secrets accepted on the inbound webhook URL / body (never expose to the browser). */
export function tallyWaWebhookSecrets(): string[] {
  const found = new Set<string>();
  const extra = (process.env.WA_WEBHOOK_SECRET || "").trim();
  if (extra) found.add(extra);
  const secrets = tallyWaSecrets();
  if (secrets?.instance) found.add(secrets.instance);
  if (secrets?.token) found.add(secrets.token);
  return [...found];
}

export function tallyWaBaseUrl(): string {
  const fromFile = tallyWaFromFile();
  const raw = (
    process.env.TALLY_WA_BASE_URL ||
    fromFile.base ||
    "https://app.tallywebsolutions.in"
  ).trim();
  return raw.replace(/\/$/, "") || "https://app.tallywebsolutions.in";
}

function tallyWaToken(): string | null {
  return tallyWaSecrets()?.token ?? null;
}

function parseGatewayBody(raw: string): { ok: boolean; error?: string } {
  const text = raw.trim();
  if (!text) return { ok: true };
  try {
    const data = JSON.parse(text) as {
      status?: boolean | string | number;
      success?: boolean;
      error?: boolean | string;
      message?: string;
      msg?: string;
    };
    if (data.error === true) {
      return { ok: false, error: data.message || data.msg || "Gateway error" };
    }
    if (typeof data.error === "string" && data.error) {
      return { ok: false, error: data.error };
    }
    if (data.success === false) {
      return { ok: false, error: data.message || data.msg || "Send failed" };
    }
    if (isGatewayErrorStatus(data.status)) {
      return { ok: false, error: data.message || data.msg || "Send failed" };
    }
    if (data.success === true || isGatewaySuccessStatus(data.status)) {
      return { ok: true };
    }
    return { ok: true };
  } catch {
    const lower = text.toLowerCase();
    if (lower.includes("invalid") || lower.includes("unauthorized")) {
      return { ok: false, error: text.slice(0, 200) };
    }
    if (lower.includes("error") && !lower.includes("false")) {
      return { ok: false, error: text.slice(0, 200) };
    }
    return { ok: true };
  }
}

function isGatewayErrorStatus(status: unknown): boolean {
  if (status === false || status === 0) return true;
  if (typeof status === "number" && status >= 400) return true;
  if (typeof status !== "string") return false;
  const lower = status.toLowerCase();
  if (lower === "error" || lower === "fail" || lower === "failed") return true;
  const n = Number(status);
  return Number.isFinite(n) && n >= 400;
}

function isGatewaySuccessStatus(status: unknown): boolean {
  if (status === true || status === 200) return true;
  if (typeof status !== "string") return false;
  const lower = status.toLowerCase();
  return lower === "success" || lower === "ok" || lower === "200";
}

async function postOrGet(url: string): Promise<{ status: number; raw: string }> {
  let res = await fetch(url, { method: "POST", cache: "no-store" });
  if (res.status === 404 || res.status === 405) {
    res = await fetch(url, { method: "GET", cache: "no-store" });
  }
  return { status: res.status, raw: await res.text() };
}

/** Send text via TallyWebSolutions WASMS-style /api/sendText. */
export async function sendTallyWaText(
  toDigits: string,
  text: string
): Promise<TallyWaSendResult> {
  const token = tallyWaToken();
  if (!token) {
    return { ok: false, status: 503, error: "Tally WhatsApp instance not configured" };
  }
  const base = tallyWaBaseUrl();
  const sendTextParams = new URLSearchParams({
    token,
    phone: toDigits,
    message: text.slice(0, 2000),
  });
  try {
    let { status, raw } = await postOrGet(
      `${base}/api/sendText?${sendTextParams.toString()}`
    );
    if (status === 404) {
      const secrets = tallyWaSecrets();
      const phpParams = new URLSearchParams({
        number: toDigits,
        type: "text",
        message: text.slice(0, 4096),
        instance_id: secrets?.instance || token,
        instance_key: secrets?.instance || token,
        access_token: token,
      });
      ({ status, raw } = await postOrGet(
        `${base}/api/send.php?${phpParams.toString()}`
      ));
    }
    if (status < 200 || status >= 300) {
      console.warn("[whatsapp] tally instance HTTP", status);
      const parsed = parseGatewayBody(raw);
      return {
        ok: false,
        status,
        error: parsed.error || `WhatsApp gateway ${status}`,
      };
    }
    const parsed = parseGatewayBody(raw);
    if (!parsed.ok) {
      console.warn("[whatsapp] tally instance reject");
      return { ok: false, status, error: parsed.error || "Send failed" };
    }
    return { ok: true, status };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    return { ok: false, status: 502, error: message };
  }
}

function isHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** WASMS-style document send: public HTTPS file URL + caption. */
export async function sendTallyWaDocument(
  toDigits: string,
  fileUrl: string,
  filename: string,
  caption: string
): Promise<TallyWaSendResult> {
  const token = tallyWaToken();
  if (!token) {
    return { ok: false, status: 503, error: "Tally WhatsApp instance not configured" };
  }
  if (!isHttpsUrl(fileUrl)) {
    return { ok: false, status: 400, error: "Document URL must be https" };
  }
  const base = tallyWaBaseUrl();
  const captionText = caption.slice(0, 2000);
  const safeName = filename || "packing-slip.pdf";
  const attempts: { path: string; params: Record<string, string> }[] = [
    {
      path: "/api/sendFileWithCaption",
      params: {
        token,
        phone: toDigits,
        link: fileUrl,
        message: captionText,
        filename: safeName,
      },
    },
    {
      path: "/api/sendFile",
      params: {
        token,
        phone: toDigits,
        url: fileUrl,
        link: fileUrl,
        filename: safeName,
        caption: captionText,
        message: captionText,
      },
    },
    {
      path: "/api/sendMedia",
      params: {
        token,
        phone: toDigits,
        url: fileUrl,
        type: "document",
        filename: safeName,
        caption: captionText,
      },
    },
    {
      path: "/api/sendFiles",
      params: { token, phone: toDigits, link: fileUrl, filename: safeName },
    },
  ];
  try {
    for (const attempt of attempts) {
      const qs = new URLSearchParams(attempt.params);
      const { status, raw } = await postOrGet(`${base}${attempt.path}?${qs}`);
      if (status === 404 || status === 405) continue;
      if (status < 200 || status >= 300) {
        console.warn("[whatsapp] tally document HTTP", attempt.path, status);
        continue;
      }
      const parsed = parseGatewayBody(raw);
      if (!parsed.ok) {
        console.warn("[whatsapp] tally document reject", attempt.path);
        continue;
      }
      if (attempt.path === "/api/sendFiles") {
        await sendTallyWaText(toDigits, captionText);
      }
      return { ok: true, status };
    }
    return { ok: false, status: 502, error: "WhatsApp document send failed" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    return { ok: false, status: 502, error: message };
  }
}

/** WASMS-style image send: public HTTPS image URL + caption. */
export async function sendTallyWaImage(
  toDigits: string,
  fileUrl: string,
  caption: string
): Promise<TallyWaSendResult> {
  const token = tallyWaToken();
  if (!token) {
    return { ok: false, status: 503, error: "Tally WhatsApp instance not configured" };
  }
  if (!isHttpsUrl(fileUrl)) {
    return { ok: false, status: 400, error: "Image URL must be https" };
  }
  const base = tallyWaBaseUrl();
  const captionText = caption.slice(0, 1024);
  const attempts: { path: string; params: Record<string, string> }[] = [
    {
      path: "/api/sendMedia",
      params: {
        token,
        phone: toDigits,
        url: fileUrl,
        link: fileUrl,
        type: "image",
        caption: captionText,
        message: captionText,
      },
    },
    {
      path: "/api/sendImage",
      params: {
        token,
        phone: toDigits,
        url: fileUrl,
        link: fileUrl,
        caption: captionText,
        message: captionText,
      },
    },
    {
      path: "/api/sendFileWithCaption",
      params: {
        token,
        phone: toDigits,
        link: fileUrl,
        message: captionText,
        filename: "pay-qr.png",
      },
    },
  ];
  try {
    for (const attempt of attempts) {
      const qs = new URLSearchParams(attempt.params);
      const { status, raw } = await postOrGet(`${base}${attempt.path}?${qs}`);
      if (status === 404 || status === 405) continue;
      if (status < 200 || status >= 300) {
        console.warn("[whatsapp] tally image HTTP", attempt.path, status);
        continue;
      }
      const parsed = parseGatewayBody(raw);
      if (!parsed.ok) {
        console.warn("[whatsapp] tally image reject", attempt.path);
        continue;
      }
      return { ok: true, status };
    }
    return { ok: false, status: 502, error: "WhatsApp image send failed" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    return { ok: false, status: 502, error: message };
  }
}
