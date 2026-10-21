"use client";

import { useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/routing";
import { useDb, useSession } from "@/lib/hooks";
import { checkCapability, logout } from "@/lib/store/db";

export default function PackHomePage() {
  const locale = useLocale();
  const hi = locale === "hi";
  const { session } = useSession();
  const { db } = useDb();
  const [query, setQuery] = useState("");

  const orders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (db?.orders ?? [])
      .filter(
        (order) => order.status === "estimate" || order.status === "confirmed"
      )
      .filter((order) => {
        if (!q) return true;
        const party = `${order.checkoutName || ""} ${order.userName || ""}`.toLowerCase();
        return (
          order.orderNumber.toLowerCase().includes(q) ||
          party.includes(q) ||
          (order.phone || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }, [db, query]);

  if (!session || !db || !checkCapability(session, db, "manage_orders")) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">{hi ? "पैकिंग" : "Packing"}</h1>
        <Link href="/pack/login" className="tt-btn tt-btn-dark mt-6 pack-tap min-h-[48px] w-full">
          {hi ? "लॉगिन" : "Sign in"}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-lg px-3 py-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{hi ? "पैकिंग" : "Packing"}</h1>
        <button type="button" className="tt-btn pack-tap min-h-[48px]" onClick={() => logout()}>
          {hi ? "लॉगआउट" : "Log out"}
        </button>
      </div>
      <input
        className="tt-input mt-4 pack-tap min-h-[48px] w-full text-base"
        value={query}
        placeholder={hi ? "ऑर्डर, पार्टी या फोन" : "Order, party or phone"}
        onChange={(e) => setQuery(e.target.value)}
      />
      <ul className="mt-4 space-y-2">
        {orders.length ? (
          orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/pack/${order.id}`}
                className="flex min-h-16 flex-col justify-center rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
              >
                <span className="font-semibold">{order.orderNumber}</span>
                <span className="text-sm text-[var(--ink-muted)]">
                  {order.checkoutName || order.userName}
                  {order.phone ? ` · ${order.phone}` : ""}
                </span>
                <span className="text-xs uppercase text-[var(--ink-muted)]">
                  {order.packingSlip?.status || order.status}
                </span>
              </Link>
            </li>
          ))
        ) : (
          <li className="text-sm text-[var(--ink-muted)]">
            {hi ? "कोई खुला ऑर्डर नहीं।" : "No open orders."}
          </li>
        )}
      </ul>
    </main>
  );
}
