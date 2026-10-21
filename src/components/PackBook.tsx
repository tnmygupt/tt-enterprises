"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { useSession } from "@/lib/hooks";
import {
  formatPackKg,
  packSlipTotalKg,
  type PackSlip,
} from "@/lib/pack-slips";
import { logout } from "@/lib/store/db";

type ItemDraft = { name: string; bundles: string; rate: string };

const emptyItem = (): ItemDraft => ({ name: "", bundles: "1", rate: "" });

export function PackBook() {
  const locale = useLocale();
  const hi = locale === "hi";
  const router = useRouter();
  const { session, ready } = useSession();
  const [slips, setSlips] = useState<PackSlip[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [partyName, setPartyName] = useState("");
  const [partyPhone, setPartyPhone] = useState("");
  const [partyAddress, setPartyAddress] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready || !session || session.role === "customer") return;
    let stop = false;
    void (async () => {
      try {
        const res = await fetch("/api/pack/slips", { credentials: "include", cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { slips?: PackSlip[]; error?: string };
        if (stop) return;
        if (!res.ok) throw new Error(data.error || "Could not load slips");
        setSlips(data.slips || []);
      } catch (err) {
        if (!stop) setError(err instanceof Error ? err.message : "Could not load slips");
      }
    })();
    return () => {
      stop = true;
    };
  }, [ready, session]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (slips || []).filter((slip) => {
      if (!q) return true;
      const hay = [
        slip.slipNo,
        slip.partyName,
        slip.partyPhone,
        ...slip.items.map((item) => item.name),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [slips, query]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/pack/slips", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partyName,
          partyPhone,
          partyAddress,
          items: items
            .filter((item) => item.name.trim())
            .map((item) => ({
              name: item.name,
              bundles: Number(item.bundles) || 1,
              rate: Number(item.rate) || 0,
            })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { slip?: PackSlip; error?: string };
      if (!res.ok || !data.slip) throw new Error(data.error || "Could not create the slip");
      router.push(`/pack/${data.slip.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the slip");
      setBusy(false);
    }
  }

  async function onDelete(slip: PackSlip) {
    if (slip.status === "finalized") return;
    if (!window.confirm(hi ? "यह स्लिप हटाएँ?" : "Delete this slip?")) return;
    setError("");
    const res = await fetch(`/api/pack/slips/${slip.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setError(data.error || "Could not delete");
      return;
    }
    setSlips((list) => (list || []).filter((row) => row.id !== slip.id));
  }

  if (!ready) {
    return <main className="mx-auto max-w-lg px-4 py-16 text-center text-sm">…</main>;
  }
  if (!session || session.role === "customer") {
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
    <main className="mx-auto w-full max-w-lg px-3 py-4 pb-10">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{hi ? "पैकिंग स्लिप" : "Packing slips"}</h1>
        <button type="button" className="tt-btn pack-tap min-h-[48px]" onClick={() => logout()}>
          {hi ? "लॉगआउट" : "Log out"}
        </button>
      </div>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        {hi
          ? "किसी भी पार्टी और किसी भी सामान की स्लिप बनाएँ।"
          : "Make a slip for any party and any goods."}
      </p>
      <button
        type="button"
        className="tt-btn tt-btn-dark pack-tap mt-4 min-h-[48px] w-full text-base"
        onClick={() => setCreating((open) => !open)}
      >
        {creating ? (hi ? "बंद करें" : "Close") : hi ? "नई स्लिप" : "New slip"}
      </button>
      {creating ? (
        <form onSubmit={onCreate} className="mt-3 space-y-3 rounded-2xl border border-[var(--line)] bg-white p-3">
          <label className="block text-sm font-semibold">
            {hi ? "पार्टी" : "Party"}
            <input
              className="tt-input mt-1 pack-tap min-h-[48px] w-full text-base"
              value={partyName}
              onChange={(e) => setPartyName(e.target.value)}
              required
            />
          </label>
          <label className="block text-sm font-semibold">
            {hi ? "फोन" : "Phone"}
            <input
              className="tt-input mt-1 pack-tap min-h-[48px] w-full text-base"
              inputMode="tel"
              value={partyPhone}
              onChange={(e) => setPartyPhone(e.target.value)}
            />
          </label>
          <label className="block text-sm font-semibold">
            {hi ? "पता" : "Address"}
            <textarea
              className="tt-input mt-1 min-h-[72px] w-full text-base"
              value={partyAddress}
              onChange={(e) => setPartyAddress(e.target.value)}
            />
          </label>
          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={index} className="grid grid-cols-[1fr_4.5rem_5rem] gap-2">
                <input
                  className="tt-input pack-tap min-h-[48px] text-base"
                  placeholder={hi ? "सामान" : "Item"}
                  value={item.name}
                  onChange={(e) =>
                    setItems((rows) =>
                      rows.map((row, i) => (i === index ? { ...row, name: e.target.value } : row))
                    )
                  }
                  required={index === 0}
                />
                <input
                  className="tt-input pack-tap min-h-[48px] text-center text-base"
                  inputMode="numeric"
                  aria-label={hi ? "बंडल" : "Bundles"}
                  value={item.bundles}
                  onChange={(e) =>
                    setItems((rows) =>
                      rows.map((row, i) => (i === index ? { ...row, bundles: e.target.value } : row))
                    )
                  }
                />
                <input
                  className="tt-input pack-tap min-h-[48px] text-center text-base"
                  inputMode="decimal"
                  placeholder={hi ? "रेट" : "Rate"}
                  value={item.rate}
                  onChange={(e) =>
                    setItems((rows) =>
                      rows.map((row, i) => (i === index ? { ...row, rate: e.target.value } : row))
                    )
                  }
                />
              </div>
            ))}
          </div>
          <button
            type="button"
            className="tt-btn pack-tap min-h-[48px] w-full"
            onClick={() => setItems((rows) => (rows.length >= 8 ? rows : [...rows, emptyItem()]))}
          >
            {hi ? "सामान जोड़ें" : "Add item"}
          </button>
          <button type="submit" className="tt-btn tt-btn-dark pack-tap min-h-[48px] w-full" disabled={busy}>
            {busy ? "…" : hi ? "स्लिप खोलें" : "Open slip"}
          </button>
        </form>
      ) : null}
      <input
        className="tt-input mt-4 pack-tap min-h-[48px] w-full text-base"
        value={query}
        placeholder={hi ? "स्लिप, पार्टी, फोन या सामान" : "Slip, party, phone or item"}
        onChange={(e) => setQuery(e.target.value)}
      />
      {error ? <p className="mt-3 text-sm text-[var(--brand)]">{error}</p> : null}
      <ul className="mt-4 space-y-2">
        {slips === null ? (
          <li className="text-sm text-[var(--ink-muted)]">…</li>
        ) : visible.length ? (
          visible.map((slip) => (
            <li key={slip.id} className="flex items-stretch gap-2">
              <Link
                href={`/pack/${slip.id}`}
                className="flex min-h-16 flex-1 flex-col justify-center rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
              >
                <span className="font-semibold">{slip.slipNo}</span>
                <span className="text-sm text-[var(--ink-muted)]">
                  {slip.partyName}
                  {slip.partyPhone ? ` · ${slip.partyPhone}` : ""}
                </span>
                <span className="text-xs text-[var(--ink-muted)]">
                  {formatPackKg(packSlipTotalKg(slip))} kg · {slip.status === "finalized" ? (hi ? "फाइनल" : "Final") : hi ? "ड्राफ्ट" : "Draft"}
                </span>
              </Link>
              {slip.status === "draft" ? (
                <button
                  type="button"
                  className="tt-btn pack-tap min-h-[48px] px-3"
                  onClick={() => void onDelete(slip)}
                >
                  {hi ? "हटाएँ" : "Delete"}
                </button>
              ) : null}
            </li>
          ))
        ) : (
          <li className="text-sm text-[var(--ink-muted)]">
            {hi ? "अभी कोई स्लिप नहीं।" : "No slips yet."}
          </li>
        )}
      </ul>
    </main>
  );
}
