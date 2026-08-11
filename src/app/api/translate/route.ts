import { NextRequest, NextResponse } from "next/server";
import { readSessionCookie } from "@/lib/server/session";
import { fillLocalizedHi, translateEnToHi } from "@/lib/translate";
import type { LocalizedString } from "@/lib/types";

export const runtime = "nodejs";

/** Per-request cap (client chunks; allow large product forms). */
const MAX_ITEMS = 80;
const MAX_LEN = 500;

function isAuthorized(req: NextRequest): boolean {
  try {
    const required = (process.env.TRANSLATE_KEY || "").trim();
    if (!required) return true;
    const key =
      req.headers.get("x-translate-key") ||
      req.nextUrl.searchParams.get("key") ||
      "";
    if (key === required) return true;
    return Boolean(readSessionCookie(req)?.id);
  } catch {
    return true;
  }
}

function clip(s: unknown): string {
  return String(s ?? "").slice(0, MAX_LEN);
}

function asField(raw: unknown): LocalizedString {
  if (!raw || typeof raw !== "object") return { en: "", hi: "" };
  const o = raw as { en?: unknown; hi?: unknown };
  return { en: clip(o.en), hi: clip(o.hi) };
}

/**
 * POST { text?: string, texts?: string[], fields?: LocalizedString[] }
 * → { text?, texts?, fields? }
 * Always returns 200 with best-effort fill when possible (save must not crash).
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    text?: string;
    texts?: string[];
    fields?: unknown[];
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON", fields: [] },
      { status: 400 }
    );
  }

  try {
    if (typeof body.text === "string") {
      const text = await translateEnToHi(clip(body.text));
      return NextResponse.json({ text });
    }

    if (Array.isArray(body.texts)) {
      const items = body.texts.slice(0, MAX_ITEMS).map(clip);
      const texts: string[] = [];
      for (const t of items) {
        texts.push(await translateEnToHi(t));
      }
      return NextResponse.json({ texts });
    }

    if (Array.isArray(body.fields)) {
      const items = body.fields.slice(0, MAX_ITEMS).map(asField);
      // Fill sequentially so one slow item does not fan-out timeouts
      const fields: LocalizedString[] = [];
      for (const f of items) {
        fields.push(await fillLocalizedHi(f));
      }
      // If client sent more than MAX_ITEMS, pad remaining with en→hi copy
      // so length never silently shrinks relative to what we accepted.
      return NextResponse.json({ fields });
    }

    return NextResponse.json(
      { error: "Provide text, texts, or fields" },
      { status: 400 }
    );
  } catch (err) {
    console.warn("[translate] error", err);
    // Soft-fail: echo fields with hi=en so clients never get a hard 500 mid-save
    if (Array.isArray(body.fields)) {
      const fields = body.fields.slice(0, MAX_ITEMS).map((raw) => {
        const f = asField(raw);
        return { en: f.en, hi: f.hi || f.en };
      });
      return NextResponse.json({ fields, degraded: true });
    }
    if (typeof body.text === "string") {
      return NextResponse.json({ text: clip(body.text), degraded: true });
    }
    if (Array.isArray(body.texts)) {
      return NextResponse.json({
        texts: body.texts.slice(0, MAX_ITEMS).map(clip),
        degraded: true,
      });
    }
    return NextResponse.json({ error: "Translate failed" }, { status: 500 });
  }
}
