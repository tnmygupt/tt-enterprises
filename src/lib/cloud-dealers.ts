"use client";

import { mergeCloudCustomerDirectory } from "@/lib/store/db";

export async function refreshCloudDealerDirectory(): Promise<{
  pending: number;
  dealers: number;
  changed: boolean;
} | null> {
  const res = await fetch("/api/account/pending-dealers", {
    credentials: "include",
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    users?: unknown[];
    dealers?: Array<{
      id: string;
      name: string;
      phone: string;
      company?: string;
      address?: string;
      pincode?: string;
      locale?: "en" | "hi";
      createdAt: string;
      approved: boolean;
      active: boolean;
      walletBalance?: number;
      liftingProgressKg?: number;
    }>;
  };
  const changed = mergeCloudCustomerDirectory(data.dealers ?? []);
  return {
    pending: Array.isArray(data.users) ? data.users.length : 0,
    dealers: Array.isArray(data.dealers) ? data.dealers.length : 0,
    changed,
  };
}
