import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * Server-only DB gate / RPC secret.
 * Must NEVER equal NEXT_PUBLIC_DB_API_KEY (that key only authorizes /api/db).
 */
export function getAppDbGateSecret(): string {
  const secret = (
    process.env.TT_APP_DB_GATE ||
    process.env.DB_GATE_SECRET ||
    ""
  ).trim();
  if (secret) {
    const pub = (process.env.NEXT_PUBLIC_DB_API_KEY || "").trim();
    if (pub && secret === pub) {
      throw new Error(
        "TT_APP_DB_GATE must differ from NEXT_PUBLIC_DB_API_KEY"
      );
    }
    return secret;
  }
  // Legacy fallback: DB_API_KEY only when it is not the public twin
  const dbKey = (process.env.DB_API_KEY || "").trim();
  const pub = (process.env.NEXT_PUBLIC_DB_API_KEY || "").trim();
  if (dbKey && dbKey !== pub) return dbKey;

  if (process.env.NODE_ENV === "production") {
    // Prefer service-role direct table access; gate secret unused then.
    // Still require an explicit server gate when RPCs would be needed.
    if (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY) {
      return "unused-with-service-role";
    }
    throw new Error(
      "TT_APP_DB_GATE is required in production when service role is missing"
    );
  }
  return "dev-only-tt-gate-not-for-production";
}

/**
 * Server-only session HMAC secret — must NOT equal NEXT_PUBLIC_DB_API_KEY.
 * Hostinger often has DB_API_KEY === NEXT_PUBLIC_DB_API_KEY and no SESSION_SECRET;
 * skip public twins and derive from a remaining server-only value.
 */
export function sessionSecretDiagnostics() {
  const pub = (process.env.NEXT_PUBLIC_DB_API_KEY || "").trim();
  const sess = (process.env.SESSION_SECRET || "").trim();
  const gate = (
    process.env.TT_APP_DB_GATE ||
    process.env.DB_GATE_SECRET ||
    ""
  ).trim();
  const dbKey = (process.env.DB_API_KEY || "").trim();
  const sr = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    ""
  ).trim();
  const api = (process.env.SUPABASE_API_KEY || "").trim();
  return {
    nodeEnv: process.env.NODE_ENV || "",
    hasSession: Boolean(sess),
    sessionEqPublic: Boolean(sess && pub && sess === pub),
    hasGate: Boolean(gate),
    gateEqPublic: Boolean(gate && pub && gate === pub),
    hasDbKey: Boolean(dbKey),
    dbEqPublic: Boolean(dbKey && pub && dbKey === pub),
    hasServiceRole: Boolean(sr),
    hasSupabaseApiKey: Boolean(api),
  };
}

export function getSessionSecret(): string {
  const pub = (process.env.NEXT_PUBLIC_DB_API_KEY || "").trim();
  const preferred = [
    process.env.SESSION_SECRET,
    process.env.TT_APP_DB_GATE,
    process.env.DB_GATE_SECRET,
    process.env.DB_API_KEY,
  ];
  for (const raw of preferred) {
    const secret = (raw || "").trim();
    if (secret && secret !== pub) return secret;
  }
  const supabaseMaterial = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_API_KEY ||
    ""
  ).trim();
  if (supabaseMaterial && supabaseMaterial !== pub) {
    return createHmac("sha256", "tt-enterprises-session-v1")
      .update(supabaseMaterial)
      .digest("base64url");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is required in production");
  }
  return "dev-only-tt-session-not-for-production";
}

export type ServerSession = {
  id: string;
  phone: string;
  email?: string;
  name: string;
  role: string;
  locale: "en" | "hi";
  exp: number;
};

const COOKIE = "tt_sid";
/** Shorter TTL so demoted staff lose cookie-gated admin access sooner. */
const MAX_AGE_SEC = 60 * 60 * 24 * 2; // 2 days

function sign(payload: string): string {
  return createHmac("sha256", getSessionSecret())
    .update(payload)
    .digest("base64url");
}

export function createSessionToken(session: Omit<ServerSession, "exp">): string {
  const body: ServerSession = {
    ...session,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC,
  };
  const payload = Buffer.from(JSON.stringify(body), "utf8").toString(
    "base64url"
  );
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(
  token: string | undefined | null
): ServerSession | null {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  let expected: string;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const body = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as ServerSession;
    if (!body?.id || !body.role || !body.exp) return null;
    if (body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

export function sessionCookieOptions(token: string) {
  return {
    name: COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE_SEC,
  };
}

export function clearSessionCookieOptions() {
  return {
    name: COOKIE,
    value: "",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0,
  };
}

export function readSessionCookie(req: Request): ServerSession | null {
  const raw = req.headers.get("cookie") || "";
  const match = raw.match(/(?:^|;\s*)tt_sid=([^;]+)/);
  return verifySessionToken(match?.[1] ? decodeURIComponent(match[1]) : null);
}

export function isStaffRole(role: string): boolean {
  return role !== "customer";
}

/** scrypt password hash (server). Legacy demo_* still verifies. */
export function hashPasswordSecure(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 32, {
    N: 16384,
    r: 8,
    p: 1,
  }).toString("base64url");
  return `scrypt$${salt}$${hash}`;
}

/** Legacy browser/demo hash — kept for offline client + migration. */
export function hashPasswordLegacy(password: string): string {
  let h = 0;
  for (let i = 0; i < password.length; i++) {
    h = (h << 5) - h + password.charCodeAt(i);
    h |= 0;
  }
  return `demo_${h}_${password.length}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored) return false;
  if (stored.startsWith("scrypt$")) {
    const parts = stored.split("$");
    if (parts.length !== 3) return false;
    const [, salt, expect] = parts;
    const actual = scryptSync(password, salt, 32, {
      N: 16384,
      r: 8,
      p: 1,
    }).toString("base64url");
    try {
      const a = Buffer.from(actual);
      const b = Buffer.from(expect);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
  if (stored.startsWith("demo_")) {
    return hashPasswordLegacy(password) === stored;
  }
  return false;
}

export function needsPasswordUpgrade(stored: string): boolean {
  return !stored.startsWith("scrypt$");
}

export { COOKIE as SESSION_COOKIE_NAME, MAX_AGE_SEC as SESSION_MAX_AGE_SEC };
