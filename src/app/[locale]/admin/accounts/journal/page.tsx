"use client";

import { FormEvent, useMemo, useState } from "react";
import { Link } from "@/i18n/routing";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import { ExportButtons } from "@/components/ExportButtons";
import { NumberField } from "@/components/NumberField";
import { OWNER_SENSITIVE_ACCOUNTS } from "@/lib/accounting";
import { toDateInputValue } from "@/lib/date-range";
import { fileToDataUrl, useDb, useSession } from "@/lib/hooks";
import { formatInr, roundMoney } from "@/lib/pricing";
import {
  canViewFinancials,
  createVoucher,
  checkCapability,
} from "@/lib/store/db";
import type { VoucherLine } from "@/lib/types";

type DraftLine = {
  accountId: string;
  amount: string;
  side: "debit" | "credit";
  note: string;
};

function blankLine(): DraftLine {
  return { accountId: "", amount: "", side: "debit", note: "" };
}

export default function JournalPage() {
  const { session } = useSession();
  const { db, refresh } = useDb();
  const isOwner = session ? canViewFinancials(session.role) : false;
  const today = toDateInputValue();

  const [date, setDate] = useState(today);
  const [narration, setNarration] = useState("");
  const [partyId, setPartyId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    blankLine(),
    { ...blankLine(), side: "credit" },
  ]);
  const [billFile, setBillFile] = useState<File | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const accounts = useMemo(() => {
    if (!db) return [];
    return db.accounts
      .filter((a) => a.active)
      .filter((a) => isOwner || !OWNER_SENSITIVE_ACCOUNTS.has(a.id))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [db, isOwner]);

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const l of lines) {
      const amt = Number(l.amount) || 0;
      if (l.side === "debit") debit += amt;
      else credit += amt;
    }
    return {
      debit: roundMoney(debit),
      credit: roundMoney(credit),
      diff: roundMoney(debit - credit),
    };
  }, [lines]);

  const balanced = Math.abs(totals.diff) < 0.02 && totals.debit > 0;

  const recent = useMemo(
    () =>
      (db?.vouchers ?? [])
        .filter((v) => v.type === "journal" && !v.voided)
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            b.createdAt.localeCompare(a.createdAt)
        )
        .slice(0, 25),
    [db]
  );

  const exportOptions = useMemo(
    () => ({
      title: "Journal",
      filename: `journal-${today}.pdf`,
      columns: ["Date", "Number", "Narration", "Total"],
      rows: recent.map((v) => [
        v.date,
        v.number,
        v.narration || "",
        formatInr(
          v.lines
            .filter((l) => (l.taxPercent ?? 0) >= 0)
            .reduce((s, l) => s + l.amount, 0) || v.total
        ),
      ]),
    }),
    [recent, today]
  );

  if (!session || !checkCapability(session, db?.users, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  // Journal is for accountant — prefer owner, but accounts role can use it
  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setMsg("");
    setError("");
    if (!balanced) {
      setError("Debits and credits must match");
      return;
    }
    try {
      const voucherLines: VoucherLine[] = lines
        .filter((l) => l.accountId && (Number(l.amount) || 0) > 0)
        .map((l) => {
          const amount = roundMoney(Number(l.amount) || 0);
          const acct = accounts.find((a) => a.id === l.accountId);
          return {
            id: `vl_${crypto.randomUUID()}`,
            itemLabel: l.note.trim() || acct?.name.en || "Journal line",
            accountId: l.accountId,
            qty: 1,
            rate: amount,
            amount,
            taxPercent: l.side === "credit" ? -1 : 0,
          };
        });
      if (voucherLines.length < 2) {
        setError("Need at least one debit and one credit line");
        return;
      }

      let packingSlipDataUrl: string | undefined;
      let packingSlipName: string | undefined;
      if (billFile) {
        packingSlipDataUrl = await fileToDataUrl(billFile);
        packingSlipName = billFile.name;
      }

      const v = createVoucher({
        type: "journal",
        date,
        partyId: partyId || undefined,
        narration: narration || undefined,
        packingSlipDataUrl,
        packingSlipName,
        createdBy: session.id,
        skipInventory: true,
        lines: voucherLines,
      });
      setMsg(`Journal ${v.number} posted · Dr/Cr ${formatInr(totals.debit)}`);
      setNarration("");
      setPartyId("");
      setLines([blankLine(), { ...blankLine(), side: "credit" }]);
      setBillFile(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <AccountsShell focusMode>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="tt-display text-2xl sm:text-4xl text-[var(--brand-deep)]">
            Journal
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Double-entry adjustment. Debits must equal credits.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButtons options={exportOptions} disabled={!recent.length} />
          <Link
            href="/admin/accounts/expenses"
            className="tt-btn tt-btn-outline"
          >
            Log expense
          </Link>
        </div>
      </div>

      {msg ? <p className="mt-3 text-sm text-[var(--ok)]">{msg}</p> : null}
      {error ? (
        <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      <form onSubmit={onSave} className="tt-panel mt-5 space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="tt-label">Date</label>
            <input
              type="date"
              className="tt-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="sm:col-span-2">
            <label className="tt-label">Narration</label>
            <input
              className="tt-input"
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              placeholder="Reason for this entry"
            />
          </div>
          <div className="sm:col-span-3">
            <label className="tt-label">Party (optional)</label>
            <select
              className="tt-select max-w-md"
              value={partyId}
              onChange={(e) => setPartyId(e.target.value)}
            >
              <option value="">None</option>
              {(db?.parties ?? [])
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.type})
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="space-y-3">
          {lines.map((line, idx) => (
            <div
              key={idx}
              className="grid gap-2 border-b border-[var(--line)] pb-3 md:grid-cols-12"
            >
              <div className="sm:col-span-5">
                <label className="tt-label">Account</label>
                <select
                  className="tt-select"
                  value={line.accountId}
                  onChange={(e) =>
                    setLines((rows) =>
                      rows.map((r, i) =>
                        i === idx ? { ...r, accountId: e.target.value } : r
                      )
                    )
                  }
                  required
                >
                  <option value="">Select…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name.en}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="tt-label">Side</label>
                <select
                  className="tt-select"
                  value={line.side}
                  onChange={(e) =>
                    setLines((rows) =>
                      rows.map((r, i) =>
                        i === idx
                          ? {
                              ...r,
                              side: e.target.value as "debit" | "credit",
                            }
                          : r
                      )
                    )
                  }
                >
                  <option value="debit">Debit</option>
                  <option value="credit">Credit</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="tt-label">Amount</label>
                <NumberField
                  className="tt-input"
                  emptyAs={null}
                  value={line.amount}
                  onValueChange={(v) =>
                    setLines((rows) =>
                      rows.map((r, i) =>
                        i === idx
                          ? { ...r, amount: v === "" ? "" : String(v) }
                          : r
                      )
                    )
                  }
                  required
                />
              </div>
              <div className="sm:col-span-3">
                <label className="tt-label">Line note</label>
                <input
                  className="tt-input"
                  value={line.note}
                  onChange={(e) =>
                    setLines((rows) =>
                      rows.map((r, i) =>
                        i === idx ? { ...r, note: e.target.value } : r
                      )
                    )
                  }
                />
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className="tt-btn tt-btn-outline"
            onClick={() => setLines((r) => [...r, blankLine()])}
          >
            Add line
          </button>
          <div className="text-sm">
            Dr {formatInr(totals.debit)} · Cr {formatInr(totals.credit)}
            {!balanced ? (
              <span className="ml-2 text-[var(--danger)]">
                Diff {formatInr(totals.diff)}
              </span>
            ) : (
              <span className="ml-2 text-[var(--ok)]">Balanced</span>
            )}
          </div>
        </div>

        <div>
          <label className="tt-label">Attachment (optional)</label>
          <input
            type="file"
            accept="image/*,.pdf"
            className="tt-input"
            onChange={(e) => setBillFile(e.target.files?.[0] || null)}
          />
        </div>

        <button
          type="submit"
          className="tt-btn tt-btn-dark"
          disabled={!balanced}
        >
          Post journal
        </button>
      </form>

      <div className="tt-panel mt-5 overflow-x-auto">
        <p className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">
          Recent journals
        </p>
        <table className="tt-table min-w-[560px]">
          <thead>
            <tr>
              <th>Date</th>
              <th>Number</th>
              <th>Narration</th>
              <th>Lines</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((v) => (
              <tr key={v.id}>
                <td>{v.date}</td>
                <td><VoucherNumberLink id={v.id} number={v.number} /></td>
                <td>{v.narration || "—"}</td>
                <td className="text-sm text-[var(--ink-muted)]">
                  {v.lines
                    .map((l) => {
                      const a = db?.accounts.find((x) => x.id === l.accountId);
                      const side = (l.taxPercent ?? 0) < 0 ? "Cr" : "Dr";
                      return `${side} ${a?.code || "?"} ${formatInr(l.amount)}`;
                    })
                    .join(" · ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!recent.length ? (
          <p className="p-4 text-sm text-[var(--ink-muted)]">
            No journal entries yet.
          </p>
        ) : null}
      </div>
    </AccountsShell>
  );
}
