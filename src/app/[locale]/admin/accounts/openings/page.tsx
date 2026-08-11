"use client";

import { FormEvent, useMemo, useState } from "react";
import { Link } from "@/i18n/routing";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import { ExportButtons } from "@/components/ExportButtons";
import { NumberField } from "@/components/NumberField";
import {
  inventoryOpeningGap,
  partyBalance,
  trialBalance,
} from "@/lib/accounting";
import { toDateInputValue } from "@/lib/date-range";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr, roundMoney } from "@/lib/pricing";
import {
  canViewFinancials,
  importOpeningStock,
  importOpeningStockFromCsv,
  importOutstandingBill,
  importOutstandingBillsFromCsv,
  importPartiesFromCsv,
  setPartyOpeningBalance,
} from "@/lib/store/db";

type Tab = "stock" | "parties" | "bills" | "csv";

type StockLine = {
  productId: string;
  variationId: string;
  qty: string;
  secondaryQty: string;
  rate: string;
};

function blankStock(): StockLine {
  return {
    productId: "",
    variationId: "",
    qty: "",
    secondaryQty: "",
    rate: "",
  };
}

export default function OpeningsPage() {
  const { session } = useSession();
  const { db, refresh } = useDb();
  const today = toDateInputValue();
  const [tab, setTab] = useState<Tab>("stock");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  // Stock
  const [stockDate, setStockDate] = useState(today);
  const [stockLines, setStockLines] = useState<StockLine[]>([blankStock()]);

  // Parties
  const [partyEdits, setPartyEdits] = useState<Record<string, string>>({});
  const [partyQ, setPartyQ] = useState("");

  // Bills
  const [billPartyId, setBillPartyId] = useState("");
  const [billType, setBillType] = useState<"sale" | "purchase">("sale");
  const [billDate, setBillDate] = useState(today);
  const [billDue, setBillDue] = useState(today);
  const [billAmount, setBillAmount] = useState("");
  const [billNumber, setBillNumber] = useState("");
  const [billNote, setBillNote] = useState("");

  // CSV
  const [csvKind, setCsvKind] = useState<"parties" | "stock" | "bills">(
    "parties"
  );
  const [csvText, setCsvText] = useState("");
  const [csvDate, setCsvDate] = useState(today);

  const products = useMemo(
    () =>
      (db?.products ?? [])
        .filter((p) => p.active)
        .sort((a, b) => a.name.en.localeCompare(b.name.en)),
    [db]
  );

  const parties = useMemo(() => {
    if (!db) return [];
    const q = partyQ.trim().toLowerCase();
    return db.parties
      .filter((p) => p.active)
      .filter((p) => {
        if (!q) return true;
        return `${p.name} ${p.phone}`.toLowerCase().includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [db, partyQ]);

  const health = useMemo(() => {
    if (!db) return null;
    const tb = trialBalance(db.accounts, db.ledgerEntries, today);
    const inv = inventoryOpeningGap(db, today);
    return {
      tbDiff: roundMoney(tb.totalDebit - tb.totalCredit),
      inv,
    };
  }, [db, today]);

  const openingBills = useMemo(
    () =>
      (db?.vouchers ?? [])
        .filter((v) => v.isOpening && !v.voided)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 40),
    [db]
  );

  const exportOptions = useMemo(() => {
    if (!db) {
      return {
        title: "Opening balances",
        filename: "openings.pdf",
        columns: ["Kind", "Name", "Amount"],
        rows: [] as string[][],
      };
    }
    const partyRows = db.parties
      .filter((p) => p.active && (p.openingBalance || 0) > 0)
      .map((p) => [
        p.type,
        p.name,
        formatInr(p.openingBalance),
      ]);
    const billRows = openingBills.map((v) => {
      const party = db.parties.find((p) => p.id === v.partyId);
      return [
        v.isOpening ? `Opening ${v.type}` : v.type,
        `${party?.name || "—"} · ${v.number}`,
        formatInr(v.outstanding ?? v.total),
      ];
    });
    return {
      title: "Opening balances",
      subtitle: `As of ${today}`,
      filename: `openings-${today}.pdf`,
      columns: ["Kind", "Name", "Amount"],
      rows: [...partyRows, ...billRows],
    };
  }, [db, openingBills, today]);

  if (!session || !canViewFinancials(session.role)) {
    return (
      <AccountsShell>
        <AdminAccessDenied title="Owner only — opening balances" />
      </AccountsShell>
    );
  }

  const clearFlash = () => {
    setMsg("");
    setError("");
  };

  const onSaveStock = (e: FormEvent) => {
    e.preventDefault();
    clearFlash();
    try {
      const lines = stockLines
        .filter((l) => l.productId)
        .map((l) => ({
          productId: l.productId,
          variationId: l.variationId || undefined,
          qty: Number(l.qty) || 0,
          secondaryQty: l.secondaryQty
            ? Number(l.secondaryQty) || undefined
            : undefined,
          rate: Number(l.rate) || 0,
        }));
      const result = importOpeningStock({
        date: stockDate,
        lines,
        createdBy: session.id,
      });
      setMsg(
        `Opening stock saved · ${result.batchCount} items · ${formatInr(result.totalValue)}${result.voucher.number !== "—" ? ` · ${result.voucher.number}` : ""}`
      );
      setStockLines([blankStock()]);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  };

  const onSavePartyOpenings = () => {
    clearFlash();
    try {
      let n = 0;
      for (const [id, raw] of Object.entries(partyEdits)) {
        if (raw === "") continue;
        setPartyOpeningBalance(id, Number(raw) || 0);
        n++;
      }
      if (!n) {
        setError("Change at least one opening balance");
        return;
      }
      setMsg(`Updated ${n} party opening balance${n === 1 ? "" : "s"}`);
      setPartyEdits({});
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  };

  const onSaveBill = (e: FormEvent) => {
    e.preventDefault();
    clearFlash();
    try {
      const v = importOutstandingBill({
        partyId: billPartyId,
        type: billType,
        date: billDate,
        dueDate: billDue,
        amount: Number(billAmount) || 0,
        number: billNumber || undefined,
        narration: billNote || undefined,
        createdBy: session.id,
      });
      setMsg(`Opening bill ${v.number} posted · ${formatInr(v.total)}`);
      setBillAmount("");
      setBillNumber("");
      setBillNote("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  };

  const onImportCsv = () => {
    clearFlash();
    try {
      if (csvKind === "parties") {
        const r = importPartiesFromCsv(csvText, session.id);
        setMsg(`Parties: ${r.created} created, ${r.updated} updated`);
      } else if (csvKind === "stock") {
        const r = importOpeningStockFromCsv(csvText, csvDate, session.id);
        setMsg(
          `Stock: ${r.batchCount} layers · ${formatInr(r.totalValue)}${r.unmatched.length ? ` · unmatched ${r.unmatched.length}` : ""}`
        );
      } else {
        const r = importOutstandingBillsFromCsv(csvText, session.id);
        setMsg(
          `Bills: ${r.posted} posted${r.unmatched.length ? ` · unmatched ${r.unmatched.length}` : ""}`
        );
      }
      setCsvText("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: "stock", label: "Opening stock" },
    { id: "parties", label: "Party openings" },
    { id: "bills", label: "Outstanding bills" },
    { id: "csv", label: "CSV import" },
  ];

  const sampleCsv =
    csvKind === "parties"
      ? "name,type,phone,gstin,opening\nAcme Traders,customer,9876543210,,15000\nSteel Mills,supplier,9123456780,,42000"
      : csvKind === "stock"
        ? "product,variation,qty,secondaryQty,rate\nHDPE Tarpaulin,12x18,10,500,45"
        : "party,type,number,date,dueDate,amount,note\nAcme Traders,customer,INV-OLD-1,2025-03-01,2025-03-31,15000,Brought forward";

  return (
    <AccountsShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="tt-display text-2xl sm:text-4xl text-[var(--brand-deep)]">
            Opening balances
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Bring stock, party balances and old unpaid bills from Tally into
            these books. Owner only.
          </p>
        </div>
        <ExportButtons options={exportOptions} />
      </div>

      {health ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="tt-panel p-4">
            <p className="text-xs text-[var(--ink-muted)]">Trial balance gap</p>
            <p
              className={`tt-display text-2xl ${
                Math.abs(health.tbDiff) < 0.02
                  ? "text-[var(--ok)]"
                  : "text-[var(--danger)]"
              }`}
            >
              {formatInr(health.tbDiff)}
            </p>
          </div>
          <div className="tt-panel p-4">
            <p className="text-xs text-[var(--ink-muted)]">FIFO stock value</p>
            <p className="tt-display text-2xl text-[var(--brand-deep)]">
              {formatInr(health.inv.layers)}
            </p>
          </div>
          <div className="tt-panel p-4">
            <p className="text-xs text-[var(--ink-muted)]">
              Inventory ledger vs layers
            </p>
            <p
              className={`tt-display text-2xl ${
                Math.abs(health.inv.gap) < 0.02
                  ? "text-[var(--ok)]"
                  : "text-[var(--danger)]"
              }`}
            >
              {formatInr(health.inv.gap)}
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`tt-btn ${tab === t.id ? "tt-btn-dark" : "tt-btn-outline"}`}
            onClick={() => {
              setTab(t.id);
              clearFlash();
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {msg ? <p className="mt-3 text-sm text-[var(--ok)]">{msg}</p> : null}
      {error ? (
        <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      {tab === "stock" ? (
        <form onSubmit={onSaveStock} className="tt-panel mt-5 space-y-4 p-5">
          <p className="text-sm text-[var(--ink-muted)]">
            Enter quantity and cost per kg/pcs. Creates FIFO layers and posts
            Inventory / Capital. Sets on-hand stock to these quantities.
          </p>
          <div className="max-w-xs">
            <label className="tt-label">As of date</label>
            <input
              type="date"
              className="tt-input"
              value={stockDate}
              onChange={(e) => setStockDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-3">
            {stockLines.map((line, idx) => {
              const product = products.find((p) => p.id === line.productId);
              return (
                <div
                  key={idx}
                  className="grid gap-2 border-b border-[var(--line)] pb-3 md:grid-cols-5"
                >
                  <div className="sm:col-span-2">
                    <label className="tt-label">Product</label>
                    <select
                      className="tt-select"
                      value={line.productId}
                      onChange={(e) => {
                        const productId = e.target.value;
                        const p = products.find((x) => x.id === productId);
                        setStockLines((rows) =>
                          rows.map((r, i) =>
                            i === idx
                              ? {
                                  ...r,
                                  productId,
                                  variationId: p?.variations[0]?.id || "",
                                }
                              : r
                          )
                        );
                      }}
                      required={idx === 0}
                    >
                      <option value="">Select…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name.en}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="tt-label">Size</label>
                    <select
                      className="tt-select"
                      value={line.variationId}
                      onChange={(e) =>
                        setStockLines((rows) =>
                          rows.map((r, i) =>
                            i === idx
                              ? { ...r, variationId: e.target.value }
                              : r
                          )
                        )
                      }
                      disabled={!product?.variations.length}
                    >
                      <option value="">—</option>
                      {(product?.variations ?? []).map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label.en}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="tt-label">Bundles</label>
                    <NumberField
                      className="tt-input"
                      integer
                      emptyAs={null}
                      value={line.qty}
                      onValueChange={(v) =>
                        setStockLines((rows) =>
                          rows.map((r, i) =>
                            i === idx
                              ? { ...r, qty: v === "" ? "" : String(v) }
                              : r
                          )
                        )
                      }
                    />
                  </div>
                  <div>
                    <label className="tt-label">
                      Qty ({product?.unit || "kg"})
                    </label>
                    <NumberField
                      className="tt-input"
                      emptyAs={null}
                      placeholder="optional"
                      value={line.secondaryQty}
                      onValueChange={(v) =>
                        setStockLines((rows) =>
                          rows.map((r, i) =>
                            i === idx
                              ? {
                                  ...r,
                                  secondaryQty: v === "" ? "" : String(v),
                                }
                              : r
                          )
                        )
                      }
                    />
                  </div>
                  <div className="sm:col-span-5 sm:max-w-xs">
                    <label className="tt-label">Cost rate</label>
                    <NumberField
                      className="tt-input"
                      emptyAs={null}
                      value={line.rate}
                      onValueChange={(v) =>
                        setStockLines((rows) =>
                          rows.map((r, i) =>
                            i === idx
                              ? { ...r, rate: v === "" ? "" : String(v) }
                              : r
                          )
                        )
                      }
                      required={!!line.productId}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              onClick={() => setStockLines((r) => [...r, blankStock()])}
            >
              Add line
            </button>
            <button type="submit" className="tt-btn tt-btn-dark">
              Save opening stock
            </button>
            <Link
              href="/admin/accounts/reports/stock-valuation"
              className="tt-btn tt-btn-outline"
            >
              Stock valuation
            </Link>
          </div>
        </form>
      ) : null}

      {tab === "parties" ? (
        <div className="tt-panel mt-5 p-5">
          <p className="text-sm text-[var(--ink-muted)]">
            Lump-sum opening when you know the balance but not each old bill.
            Prefer Outstanding bills when you have invoice detail (do not enter
            both for the same amount).
          </p>
          <input
            className="tt-input mt-3 max-w-xs"
            placeholder="Search party…"
            value={partyQ}
            onChange={(e) => setPartyQ(e.target.value)}
          />
          <div className="mt-4 overflow-x-auto">
            <table className="tt-table min-w-[720px]">
              <thead>
                <tr>
                  <th>Party</th>
                  <th>Type</th>
                  <th>Current balance</th>
                  <th>Opening (edit)</th>
                </tr>
              </thead>
              <tbody>
                {parties.map((p) => {
                  const bal = partyBalance(p, db?.ledgerEntries ?? []);
                  const draft =
                    partyEdits[p.id] ??
                    (p.openingBalance ? String(p.openingBalance) : "");
                  return (
                    <tr key={p.id}>
                      <td>
                        {p.name}
                        <span className="block text-xs text-[var(--ink-muted)]">
                          {p.phone}
                        </span>
                      </td>
                      <td>{p.type}</td>
                      <td>{formatInr(bal)}</td>
                      <td>
                        <NumberField
                          className="tt-input w-32"
                          emptyAs={null}
                          value={draft}
                          onValueChange={(v) =>
                            setPartyEdits((m) => ({
                              ...m,
                              [p.id]: v === "" ? "" : String(v),
                            }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="tt-btn tt-btn-dark mt-4"
            onClick={onSavePartyOpenings}
          >
            Save party openings
          </button>
        </div>
      ) : null}

      {tab === "bills" ? (
        <div className="mt-5 space-y-5">
          <form onSubmit={onSaveBill} className="tt-panel space-y-3 p-5">
            <p className="text-sm text-[var(--ink-muted)]">
              Old unpaid invoices so aging stays correct. Posts to Capital — not
              sales or purchase — and does not move stock.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="tt-label">Kind</label>
                <select
                  className="tt-select"
                  value={billType}
                  onChange={(e) => {
                    const t = e.target.value as "sale" | "purchase";
                    setBillType(t);
                    setBillPartyId("");
                  }}
                >
                  <option value="sale">Customer owes us</option>
                  <option value="purchase">We owe supplier</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="tt-label">Party</label>
                <select
                  className="tt-select"
                  value={billPartyId}
                  onChange={(e) => setBillPartyId(e.target.value)}
                  required
                >
                  <option value="">Select…</option>
                  {(db?.parties ?? [])
                    .filter(
                      (p) =>
                        p.active &&
                        p.type ===
                          (billType === "sale" ? "customer" : "supplier")
                    )
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="tt-label">Bill date</label>
                <input
                  type="date"
                  className="tt-input"
                  value={billDate}
                  onChange={(e) => setBillDate(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="tt-label">Due date</label>
                <input
                  type="date"
                  className="tt-input"
                  value={billDue}
                  onChange={(e) => setBillDue(e.target.value)}
                />
              </div>
              <div>
                <label className="tt-label">Their bill #</label>
                <input
                  className="tt-input"
                  value={billNumber}
                  onChange={(e) => setBillNumber(e.target.value)}
                />
              </div>
              <div>
                <label className="tt-label">Outstanding amount</label>
                <NumberField
                  className="tt-input"
                  emptyAs={null}
                  value={billAmount}
                  onValueChange={(v) =>
                    setBillAmount(v === "" ? "" : String(v))
                  }
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <label className="tt-label">Note</label>
                <input
                  className="tt-input"
                  value={billNote}
                  onChange={(e) => setBillNote(e.target.value)}
                />
              </div>
            </div>
            <button type="submit" className="tt-btn tt-btn-dark">
              Post opening bill
            </button>
          </form>

          <div className="tt-panel overflow-x-auto">
            <p className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">
              Recent opening bills
            </p>
            <table className="tt-table min-w-[640px]">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Number</th>
                  <th>Party</th>
                  <th>Type</th>
                  <th>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {openingBills.map((v) => {
                  const party = db?.parties.find((p) => p.id === v.partyId);
                  return (
                    <tr key={v.id}>
                      <td>{v.date}</td>
                      <td><VoucherNumberLink id={v.id} number={v.number} /></td>
                      <td>{party?.name || "—"}</td>
                      <td>{v.type}</td>
                      <td>{formatInr(v.outstanding ?? v.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!openingBills.length ? (
              <p className="p-4 text-sm text-[var(--ink-muted)]">
                No opening bills yet.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "csv" ? (
        <div className="tt-panel mt-5 space-y-4 p-5">
          <p className="text-sm text-[var(--ink-muted)]">
            Paste a CSV exported from Tally or Excel. First row must be headers.
          </p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["parties", "Parties"],
                ["stock", "Opening stock"],
                ["bills", "Outstanding bills"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`tt-btn ${csvKind === id ? "tt-btn-dark" : "tt-btn-outline"}`}
                onClick={() => setCsvKind(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {csvKind === "stock" ? (
            <div className="max-w-xs">
              <label className="tt-label">Stock as of</label>
              <input
                type="date"
                className="tt-input"
                value={csvDate}
                onChange={(e) => setCsvDate(e.target.value)}
              />
            </div>
          ) : null}
          <pre className="overflow-x-auto rounded-lg bg-[var(--brand-soft)] p-3 text-xs text-[var(--brand-deep)]">
            {sampleCsv}
          </pre>
          <textarea
            className="tt-input min-h-[180px] font-mono text-sm"
            placeholder="Paste CSV here…"
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
          />
          <button
            type="button"
            className="tt-btn tt-btn-dark"
            disabled={!csvText.trim()}
            onClick={onImportCsv}
          >
            Import CSV
          </button>
        </div>
      ) : null}
    </AccountsShell>
  );
}
