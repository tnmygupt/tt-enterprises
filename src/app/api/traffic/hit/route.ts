import { NextRequest, NextResponse } from "next/server";
import {
  cloudGetAppDb,
  cloudPutAppDb,
  createServerSupabase,
} from "@/lib/server/app-db";
import {
  appendAccessPlace,
  buildAccessPlace,
} from "@/lib/server/access-log";
import { clientIpFromRequest } from "@/lib/server/geo-ip";
import { rateLimit } from "@/lib/server/rate-limit";
import { readSessionCookie } from "@/lib/server/session";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";

const MAX_PATH = 200;

/** Same visitor + page inside this window is one pageview, not many writes. */
const DEDUPE_MS = 10 * 60_000;
/** Pageviews are buffered so bursts share one cloud read/write. */
const FLUSH_AFTER_MS = 15_000;
const FLUSH_AT_COUNT = 20;

const recentHits = new Map<string, number>();
let pending: import("@/lib/types").AccessPlace[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function seenRecently(key: string): boolean {
  const now = Date.now();
  const at = recentHits.get(key);
  if (at && now - at < DEDUPE_MS) return true;
  recentHits.set(key, now);
  if (recentHits.size > 5000) {
    for (const [k, t] of recentHits) {
      if (now - t > DEDUPE_MS) recentHits.delete(k);
    }
  }
  return false;
}

async function flushPending(): Promise<void> {
  if (flushing || !pending.length) return;
  flushing = true;
  const batch = pending;
  pending = [];
  try {
    const supabase = createServerSupabase();
    if (!supabase) return;
    const { db, updatedAt, error } = await cloudGetAppDb(supabase);
    if (error || !db) return;
    for (const place of batch) appendAccessPlace(db, place);
    await cloudPutAppDb(supabase, sanitizeDbForCloud(db), updatedAt ?? null);
  } catch {
    /* analytics is best-effort */
  } finally {
    flushing = false;
  }
}

function queuePlace(place: import("@/lib/types").AccessPlace): void {
  pending.push(place);
  if (pending.length >= FLUSH_AT_COUNT) {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    void flushPending();
    return;
  }
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPending();
  }, FLUSH_AFTER_MS);
}

function normalizePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let p = raw.trim().slice(0, MAX_PATH);
  if (!p.startsWith("/")) p = `/${p}`;
  // Drop query/hash noise for aggregation
  p = p.split("?")[0]?.split("#")[0] || "/";
  if (p.length < 1) return null;
  // Ignore noisy assets
  if (
    p.startsWith("/_next") ||
    p.startsWith("/api/") ||
    p.includes(".") // static files
  ) {
    return null;
  }
  return p;
}

/** Lightweight pageview beacon — rate limited, best-effort geo. */
export async function POST(req: NextRequest) {
  let body: { path?: string; locale?: string };
  try {
    body = (await req.json()) as { path?: string; locale?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const path = normalizePath(body.path);
  if (!path) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const ip = clientIpFromRequest(req.headers) || "unknown";
  const limited = rateLimit(`traffic:${ip}`, 40, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many hits" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }

  if (seenRecently(`${ip}|${path}`)) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  try {
    // The session cookie already carries who this is, so a pageview never
    // needs to read the whole cloud DB — only the batched flush does.
    const session = readSessionCookie(req);
    const place = await buildAccessPlace({
      headers: req.headers,
      source: "page",
      user: session
        ? {
            id: session.id,
            phone: session.phone,
            name: session.name,
            role: session.role as import("@/lib/types").UserRole,
          }
        : null,
      path,
      locale:
        body.locale === "hi" || body.locale === "en" ? body.locale : undefined,
    });
    queuePlace(place);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true, skipped: true });
  }
}
