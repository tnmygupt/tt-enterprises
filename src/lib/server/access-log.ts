import { randomUUID } from "crypto";
import type { AppDatabase } from "@/lib/store/db";
import type { AccessPlace, AccessSource, UserProfile, UserRole } from "@/lib/types";
import {
  clientIpFromRequest,
  deviceFromUa,
  hashIp,
  lookupIpGeo,
} from "@/lib/server/geo-ip";

export const ACCESS_PLACES_CAP = 5000;

export function trimAccessPlaces(
  places: AccessPlace[] | undefined
): AccessPlace[] {
  const list = places ?? [];
  if (list.length <= ACCESS_PLACES_CAP) return list;
  return list.slice(list.length - ACCESS_PLACES_CAP);
}

export async function buildAccessPlace(input: {
  headers: Headers;
  source: AccessSource;
  user?: Pick<UserProfile, "id" | "phone" | "name" | "role"> | null;
  path?: string;
  locale?: string;
}): Promise<AccessPlace> {
  const ip = clientIpFromRequest(input.headers);
  const ua = input.headers.get("user-agent") || "";
  const geo = ip ? await lookupIpGeo(ip) : null;
  return {
    id: randomUUID(),
    userId: input.user?.id,
    phone: input.user?.phone,
    name: input.user?.name,
    role: input.user?.role as UserRole | undefined,
    at: new Date().toISOString(),
    ipHash: hashIp(ip || "unknown"),
    city: geo?.city,
    region: geo?.region,
    country: geo?.country,
    lat: geo?.lat,
    lng: geo?.lng,
    source: input.source,
    path: input.path,
    locale: input.locale,
    device: deviceFromUa(ua),
  };
}

export function appendAccessPlace(
  db: AppDatabase,
  place: AccessPlace
): AppDatabase {
  const next = trimAccessPlaces([...(db.accessPlaces ?? []), place]);
  db.accessPlaces = next;
  return db;
}
