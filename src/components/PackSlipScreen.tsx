"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { useSession } from "@/lib/hooks";
import { downloadStandalonePackSlipPdf } from "@/lib/pack-slip-pdf";
import {
  addPackItem,
  formatPackKg,
  packSlipAmount,
  packSlipKg,
  packSlipTotalAmount,
  packSlipTotalKg,
  packWhatsappHref,
  removePackItem,
  setPackBundles,
  setPackWeight,
  PACK_MAX_BUNDLES,
  PACK_MAX_ITEMS,
  type PackSlip,
} from "@/lib/pack-slips";

export function PackSlipScreen({ slipId }: { slipId: string }) {
  const locale = useLocale();
  const hi = locale === "hi";
  const router = useRouter();
  const { session, ready } = useSession();
  const [slip, setSlip] = useState<PackSlip | null>(null);
  const [kgText, setKgText] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState(false);
  const [activeCol, setActiveCol] = useState(0);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const apply = () => setPhone(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    if (!ready || !session || session.role === "customer") return;
    let stop = false;
    void (async () => {
      const res = await fetch(`/api/pack/slips/${slipId}`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as { slip?: PackSlip; error?: string };
      if (stop) return;
      if (!res.ok || !data.slip) {
        setError(data.error || (hi ? "स्लिप नहीं मिली।" : "Slip not found."));
        return;
      }
      setSlip(data.slip);
    })();
    return () => {
      stop = true;
    };
  }, [ready, session, slipId, hi]);

  async function persist(next: PackSlip): Promise<PackSlip | null> {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/pack/slips/${next.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = (await res.json().catch(() => ({}))) as { slip?: PackSlip; error?: string };
      if (!res.ok || !data.slip) throw new Error(data.error || "Could not save");
      setSlip(data.slip);
      setKgText({});
      return data.slip;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      return null;
    } finally {
      setBusy(false);
    }
  }

  function printSlip() {
    document.body.classList.add("packing-slip-printing");
    const cleanup = () => {
      document.body.classList.remove("packing-slip-printing");
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  if (!ready) return <main className="px-4 py-16 text-center text-sm">…</main>;
  if (!session || session.role === "customer") {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <Link href="/pack/login" className="tt-btn tt-btn-dark pack-tap min-h-[48px] w-full">
          {hi ? "लॉगिन" : "Sign in"}
        </Link>
      </main>
    );
  }
  if (!slip) {
    return (
      <main className="mx-auto max-w-lg px-4 py-10">
        <p className="text-sm">{error || "…"}</p>
        <Link href="/pack" className="tt-btn pack-tap mt-4 inline-flex min-h-[48px] items-center">
          {hi ? "सूची" : "Back"}
        </Link>
      </main>
    );
  }

  const locked = slip.status === "finalized";
  const cols = slip.items.length;
  const col = Math.min(activeCol, Math.max(0, cols - 1));
  const rows = Math.max(...slip.items.map((item) => item.bundles), 1);
  const wa = packWhatsappHref(slip);
  const amount = packSlipTotalAmount(slip);

  function patch(next: PackSlip) {
    if (locked) return;
    setSlip(next);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-3 py-4 pb-28">
      <div className="print:hidden mb-3 flex items-center justify-between gap-2">
        <Link href="/pack" className="tt-btn pack-tap inline-flex min-h-[48px] items-center px-4">
          {hi ? "सूची" : "Slips"}
        </Link>
        <span className="text-xs uppercase text-[var(--ink-muted)]">
          {locked ? (hi ? "फाइनल" : "Final") : hi ? "ड्राफ्ट" : "Draft"}
        </span>
      </div>
      {error ? <p className="print:hidden mb-3 text-sm text-[var(--brand)]">{error}</p> : null}
      <article className="packing-slip-sheet rounded-2xl border border-[var(--line)] bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-wide">PACKING SLIP</h1>
          <div className="text-right text-sm">
            <div className="font-semibold">{slip.slipNo}</div>
            <input
              type="date"
              className="tt-input mt-1 min-h-[40px]"
              value={slip.date}
              disabled={locked}
              onChange={(e) => patch({ ...slip, date: e.target.value })}
            />
          </div>
        </div>
        <label className="mt-3 block text-sm font-semibold">
          {hi ? "पार्टी" : "Party"}
          <input
            className="tt-input mt-1 pack-tap min-h-[48px] w-full text-base"
            value={slip.partyName}
            disabled={locked}
            onChange={(e) => patch({ ...slip, partyName: e.target.value })}
          />
        </label>
        <label className="mt-2 block text-sm font-semibold">
          {hi ? "फोन" : "Phone"}
          <input
            className="tt-input mt-1 pack-tap min-h-[48px] w-full text-base"
            inputMode="tel"
            value={slip.partyPhone}
            disabled={locked}
            onChange={(e) => patch({ ...slip, partyPhone: e.target.value })}
          />
        </label>
        <label className="mt-2 block text-sm font-semibold">
          {hi ? "पता" : "Address"}
          <textarea
            className="tt-input mt-1 min-h-[72px] w-full text-base"
            value={slip.partyAddress}
            disabled={locked}
            onChange={(e) => patch({ ...slip, partyAddress: e.target.value })}
          />
        </label>
        {phone && cols > 1 ? (
          <div className="print:hidden mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              className="tt-btn pack-tap min-h-[48px] px-4"
              onClick={() => setActiveCol((n) => Math.max(0, n - 1))}
              disabled={col <= 0}
            >
              {hi ? "पिछला" : "Previous"}
            </button>
            <span className="text-sm font-semibold">
              {col + 1} / {cols}
            </span>
            <button
              type="button"
              className="tt-btn pack-tap min-h-[48px] px-4"
              onClick={() => setActiveCol((n) => Math.min(cols - 1, n + 1))}
              disabled={col >= cols - 1}
            >
              {hi ? "अगला" : "Next"}
            </button>
          </div>
        ) : null}
        <div className="mt-3 overflow-x-auto">
          <table className="packing-slip-grid w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="packing-slip-rowlabel w-12 whitespace-nowrap border border-[var(--line)] p-1 text-left">#</th>
                {slip.items.map((item, index) => (
                  <th
                    key={item.id}
                    className={`border border-[var(--line)] p-1 ${phone && index !== col ? "pack-col-off" : ""}`}
                  >
                    <input
                      className="tt-input min-h-[48px] w-full text-base font-semibold"
                      value={item.name}
                      placeholder={hi ? "सामान" : "Item"}
                      disabled={locked}
                      onChange={(e) =>
                        patch({
                          ...slip,
                          items: slip.items.map((row, i) =>
                            i === index ? { ...row, name: e.target.value } : row
                          ),
                        })
                      }
                    />
                    <div className="mt-1 flex items-center gap-1">
                      <button
                        type="button"
                        className="tt-btn pack-tap min-h-[48px] min-w-12"
                        disabled={locked || item.bundles <= 1}
                        onClick={() => patch(setPackBundles(slip, index, item.bundles - 1))}
                      >
                        −
                      </button>
                      <span className="min-w-8 text-center">{item.bundles}</span>
                      <button
                        type="button"
                        className="tt-btn pack-tap min-h-[48px] min-w-12"
                        disabled={locked || item.bundles >= PACK_MAX_BUNDLES}
                        onClick={() => patch(setPackBundles(slip, index, item.bundles + 1))}
                      >
                        +
                      </button>
                      <input
                        className="tt-input min-h-[48px] w-20 text-center"
                        inputMode="decimal"
                        placeholder={hi ? "रेट" : "Rate"}
                        disabled={locked}
                        value={item.rate ? String(item.rate) : ""}
                        onChange={(e) => {
                          const rate = Number(e.target.value);
                          patch({
                            ...slip,
                            items: slip.items.map((row, i) =>
                              i === index
                                ? { ...row, rate: Number.isFinite(rate) && rate > 0 ? rate : 0 }
                                : row
                            ),
                          });
                        }}
                      />
                      {cols > 1 ? (
                        <button
                          type="button"
                          className="tt-btn pack-tap min-h-[48px] px-2"
                          disabled={locked}
                          onClick={() => {
                            patch(removePackItem(slip, index));
                            setActiveCol(0);
                          }}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }, (_, row) => (
                <tr key={row}>
                  <td className="packing-slip-rowlabel w-12 whitespace-nowrap border border-[var(--line)] px-2">{row + 1}</td>
                  {slip.items.map((item, index) => {
                    const key = `${index}:${row}`;
                    const stored = slip.weights[index]?.[row];
                    const shown = key in kgText ? kgText[key] : stored == null ? "" : String(stored);
                    const hidden = row >= item.bundles;
                    return (
                      <td
                        key={item.id}
                        className={`border border-[var(--line)] p-1 ${phone && index !== col ? "pack-col-off" : ""}`}
                      >
                        {hidden ? null : (
                          <input
                            className="tt-input min-h-[48px] w-full text-center text-2xl"
                            inputMode="decimal"
                            disabled={locked}
                            value={shown}
                            aria-label={`${item.name || "Item"} ${row + 1}`}
                            onChange={(e) => {
                              const cleaned = e.target.value.replace(/[^0-9.]/g, "");
                              setKgText((prev) => ({ ...prev, [key]: cleaned }));
                              if (cleaned === "" || cleaned === ".") {
                                patch(setPackWeight(slip, index, row, null));
                                return;
                              }
                              const n = Number(cleaned);
                              if (Number.isFinite(n)) patch(setPackWeight(slip, index, row, n));
                            }}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td className="packing-slip-rowlabel w-12 whitespace-nowrap border border-[var(--line)] px-2 font-semibold">Kg</td>
                {slip.items.map((item, index) => (
                  <td
                    key={item.id}
                    className={`border border-[var(--line)] px-2 text-center font-semibold ${phone && index !== col ? "pack-col-off" : ""}`}
                  >
                    {formatPackKg(packSlipKg(slip, index))}
                    {packSlipAmount(slip, index) > 0 ? (
                      <div className="text-xs font-normal">Rs. {packSlipAmount(slip, index).toFixed(2)}</div>
                    ) : null}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-lg font-semibold">
          {hi ? "कुल" : "Total"} {formatPackKg(packSlipTotalKg(slip))} kg
          {amount > 0 ? ` · Rs. ${amount.toFixed(2)}` : ""}
        </p>
        <label className="mt-2 block text-sm font-semibold">
          {hi ? "नोट" : "Note"}
          <textarea
            className="tt-input mt-1 min-h-[72px] w-full text-base"
            value={slip.note}
            disabled={locked}
            onChange={(e) => patch({ ...slip, note: e.target.value })}
          />
        </label>
        {!locked && slip.items.length < PACK_MAX_ITEMS ? (
          <button
            type="button"
            className="print:hidden tt-btn pack-tap mt-3 min-h-[48px] w-full"
            onClick={() => patch(addPackItem(slip))}
          >
            {hi ? "सामान जोड़ें" : "Add item"}
          </button>
        ) : null}
      </article>
      <div className="print:hidden fixed inset-x-0 bottom-0 z-20 border-t border-[var(--line)] bg-white/95 px-3 py-2 backdrop-blur">
        <div className="mx-auto flex max-w-3xl gap-2 overflow-x-auto pb-[max(0.25rem,env(safe-area-inset-bottom))]">
          {locked ? (
            <button
              type="button"
              className="tt-btn pack-tap min-h-[48px] shrink-0 px-4"
              disabled={busy}
              onClick={() => void persist({ ...slip, status: "draft" })}
            >
              {hi ? "फिर खोलें" : "Reopen"}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="tt-btn pack-tap min-h-[48px] shrink-0 px-4"
                disabled={busy}
                onClick={() => void persist(slip)}
              >
                {hi ? "ड्राफ्ट सहेजें" : "Save draft"}
              </button>
              <button
                type="button"
                className="tt-btn tt-btn-dark pack-tap min-h-[48px] shrink-0 px-4"
                disabled={busy}
                onClick={() => void persist({ ...slip, status: "finalized" })}
              >
                {hi ? "फाइनल" : "Finalize"}
              </button>
            </>
          )}
          <button type="button" className="tt-btn pack-tap min-h-[48px] shrink-0 px-4" onClick={printSlip}>
            {hi ? "प्रिंट" : "Print"}
          </button>
          <button
            type="button"
            className="tt-btn pack-tap min-h-[48px] shrink-0 px-4"
            disabled={busy}
            onClick={() =>
              void (async () => {
                const saved = locked ? slip : await persist(slip);
                if (saved) await downloadStandalonePackSlipPdf(saved);
              })()
            }
          >
            PDF
          </button>
          {wa ? (
            <a className="tt-btn pack-tap inline-flex min-h-[48px] shrink-0 items-center px-4" href={wa} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          ) : null}
          {!locked ? (
            <button
              type="button"
              className="tt-btn pack-tap min-h-[48px] shrink-0 px-4"
              onClick={() => {
                if (!window.confirm(hi ? "यह स्लिप हटाएँ?" : "Delete this slip?")) return;
                void (async () => {
                  const res = await fetch(`/api/pack/slips/${slip.id}`, {
                    method: "DELETE",
                    credentials: "include",
                  });
                  if (res.ok) router.push("/pack");
                  else {
                    const data = (await res.json().catch(() => ({}))) as { error?: string };
                    setError(data.error || "Could not delete");
                  }
                })();
              }}
            >
              {hi ? "हटाएँ" : "Delete"}
            </button>
          ) : null}
        </div>
      </div>
    </main>
  );
}
