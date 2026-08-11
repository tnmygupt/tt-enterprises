import { createHash } from "crypto";

export type GeoLookup = {
  city?: string;
  region?: string;
  country?: string;
  lat?: number;
  lng?: number;
};

const geoCache = new Map<string, GeoLookup | null>();

export function clientIpFromRequest(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for") || "";
  const real = headers.get("x-real-ip") || "";
  const ip = (fwd.split(",")[0] || real || "").trim();
  if (!ip || ip === "::1" || ip === "127.0.0.1") return "";
  return ip;
}

export function hashIp(ip: string): string {
  const raw = (ip || "unknown").trim() || "unknown";
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

export function deviceFromUa(ua: string): "mobile" | "desktop" | "unknown" {
  if (!ua) return "unknown";
  if (/Mobile|Android|iPhone|iPad|iPod/i.test(ua)) return "mobile";
  if (/Mozilla|Chrome|Safari|Firefox|Edge/i.test(ua)) return "desktop";
  return "unknown";
}

/** City-level IP geo via ip-api.com (no key; best-effort). */
export async function lookupIpGeo(ip: string): Promise<GeoLookup | null> {
  if (!ip || ip === "unknown") return null;
  if (geoCache.has(ip)) return geoCache.get(ip) ?? null;

  try {
    const ctrl = AbortSignal.timeout(2500);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,city,regionName,country,lat,lon`,
      { signal: ctrl, cache: "no-store" }
    );
    if (!res.ok) {
      geoCache.set(ip, null);
      return null;
    }
    const data = (await res.json()) as {
      status?: string;
      city?: string;
      regionName?: string;
      country?: string;
      lat?: number;
      lon?: number;
    };
    if (data.status !== "success") {
      geoCache.set(ip, null);
      return null;
    }
    const geo: GeoLookup = {
      city: data.city || undefined,
      region: data.regionName || undefined,
      country: data.country || undefined,
      lat: typeof data.lat === "number" ? data.lat : undefined,
      lng: typeof data.lon === "number" ? data.lon : undefined,
    };
    geoCache.set(ip, geo);
    return geo;
  } catch {
    geoCache.set(ip, null);
    return null;
  }
}
