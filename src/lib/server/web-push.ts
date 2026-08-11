import webpush from "web-push";
import type { Capability, UserProfile } from "@/lib/types";
import { userHasCapability } from "@/lib/capabilities";

export type PushSub = NonNullable<UserProfile["pushSubscriptions"]>[number];

export function getVapidPublicKey(): string {
  return (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "").trim();
}

export function vapidConfigured(): boolean {
  return Boolean(
    getVapidPublicKey() &&
      (process.env.VAPID_PRIVATE_KEY || "").trim() &&
      (process.env.VAPID_SUBJECT || "").trim()
  );
}

function configureWebPush(): boolean {
  if (!vapidConfigured()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!.trim(),
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!.trim(),
    process.env.VAPID_PRIVATE_KEY!.trim()
  );
  return true;
}

const MAX_SUBS = 5;

export function mergePushSubscription(
  existing: PushSub[] | undefined,
  next: PushSub
): PushSub[] {
  const list = (existing ?? []).filter((s) => s.endpoint !== next.endpoint);
  list.unshift(next);
  return list.slice(0, MAX_SUBS);
}

export function removePushEndpoint(
  existing: PushSub[] | undefined,
  endpoint: string
): PushSub[] | undefined {
  const next = (existing ?? []).filter((s) => s.endpoint !== endpoint);
  return next.length ? next : undefined;
}

export async function sendWebPushToSubs(
  subs: PushSub[] | undefined,
  payload: { title: string; body: string; url: string }
): Promise<{ sent: number; deadEndpoints: string[] }> {
  if (!configureWebPush() || !subs?.length) {
    return { sent: 0, deadEndpoints: [] };
  }
  const body = JSON.stringify(payload);
  const dead: string[] = [];
  let sent = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            expirationTime: sub.expirationTime ?? undefined,
            keys: sub.keys,
          },
          body,
          { TTL: 60 * 60 * 12, urgency: "high" }
        );
        sent += 1;
      } catch (err: unknown) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode?: number }).statusCode)
            : 0;
        if (status === 404 || status === 410) {
          dead.push(sub.endpoint);
        } else {
          console.warn("[push] send failed", status || err);
        }
      }
    })
  );
  return { sent, deadEndpoints: dead };
}

export function staffWithCapability(
  users: UserProfile[],
  cap: Capability
): UserProfile[] {
  return users.filter(
    (u) =>
      u.active &&
      u.role !== "customer" &&
      userHasCapability(u, cap) &&
      (u.pushSubscriptions?.length ?? 0) > 0
  );
}

export function staffWithManageOrders(users: UserProfile[]): UserProfile[] {
  return staffWithCapability(users, "manage_orders");
}
