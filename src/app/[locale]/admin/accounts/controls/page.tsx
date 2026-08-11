"use client";

import { useEffect, useMemo, useState } from "react";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import { fyBounds } from "@/lib/accounting";
import { toDateInputValue } from "@/lib/date-range";
import { useDb, useSession } from "@/lib/hooks";
import {
  canViewFinancials,
  downloadBooksBackup,
  checkCapability,
  setFinancialYearStartMonth,
  setPeriodLock,
} from "@/lib/store/db";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export default function ControlsPage() {
  const { session } = useSession();
  const { db, refresh } = useDb();
  const isOwner = session ? canViewFinancials(session.role) : false;
  const today = toDateInputValue();

  const fyMonth = db?.settings.financialYearStartMonth ?? 4;
  const fy = useMemo(() => fyBounds(today, fyMonth), [today, fyMonth]);
  const [lockDate, setLockDate] = useState(today);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (db?.settings.lockedThroughDate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLockDate(db.settings.lockedThroughDate);
    }
  }, [db?.settings.lockedThroughDate]);

  if (!session || !checkCapability(session, db?.users, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  const locked = db?.settings.lockedThroughDate;

  const onSetLock = () => {
    if (!isOwner) return;
    setMsg("");
    setError("");
    try {
      setPeriodLock(lockDate);
      setMsg(`Period locked through ${lockDate}`);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  };

  const onClearLock = () => {
    if (!isOwner) return;
    setMsg("");
    setError("");
    setPeriodLock(null);
    setMsg("Period unlocked");
    refresh();
  };

  const onFyMonth = (m: number) => {
    if (!isOwner) return;
    setFinancialYearStartMonth(m);
    setMsg(`Financial year starts in ${MONTHS[m - 1]}`);
    refresh();
  };

  const onBackup = () => {
    if (!isOwner) return;
    setMsg("");
    try {
      const name = downloadBooksBackup();
      setMsg(`Downloaded ${name}`);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Backup failed");
    }
  };

  return (
    <AccountsShell>
      <h1 className="tt-display text-2xl sm:text-4xl text-[var(--brand-deep)]">
        Controls
      </h1>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        Financial year, period lock, backup and books health.
      </p>

      {msg ? <p className="mt-3 text-sm text-[var(--ok)]">{msg}</p> : null}
      {error ? (
        <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="tt-panel p-5">
          <p className="text-sm font-semibold">Financial year</p>
          <p className="mt-2 tt-display text-3xl text-[var(--brand-deep)]">
            FY {fy.label}
          </p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {fy.from} → {fy.to}
          </p>
          {isOwner ? (
            <div className="mt-4">
              <label className="tt-label">Year starts in</label>
              <select
                className="tt-select"
                value={fyMonth}
                onChange={(e) => onFyMonth(Number(e.target.value))}
              >
                {MONTHS.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">
              Starts {MONTHS[fyMonth - 1]} (owner can change)
            </p>
          )}
        </div>

        <div className="tt-panel p-5">
          <p className="text-sm font-semibold">Period lock</p>
          {locked ? (
            <p className="mt-2 text-sm text-[var(--danger)]">
              Locked through <strong>{locked}</strong> — no posts or voids on or
              before this date.
            </p>
          ) : (
            <p className="mt-2 text-sm text-[var(--ok)]">No lock — books open.</p>
          )}
          {isOwner ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <input
                type="date"
                className="tt-input"
                value={lockDate}
                onChange={(e) => setLockDate(e.target.value)}
              />
              <button
                type="button"
                className="tt-btn tt-btn-dark"
                onClick={onSetLock}
              >
                Lock through date
              </button>
              {locked ? (
                <button
                  type="button"
                  className="tt-btn tt-btn-outline"
                  onClick={onClearLock}
                >
                  Unlock
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="tt-panel p-5">
          <p className="text-sm font-semibold">Books backup</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            Download accounts, vouchers, ledgers, stock layers and movements as
            JSON.
          </p>
          {db?.settings.booksBackupAt ? (
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Last backup {db.settings.booksBackupAt.slice(0, 19).replace("T", " ")}
            </p>
          ) : null}
          {isOwner ? (
            <button
              type="button"
              className="tt-btn tt-btn-dark mt-4"
              onClick={onBackup}
            >
              Download backup
            </button>
          ) : (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">Owner only</p>
          )}
        </div>

        <div className="tt-panel space-y-3 p-5">
          <p className="text-sm font-semibold">More</p>
          <Link
            href="/admin/accounts/controls/audit"
            className="tt-btn tt-btn-outline block text-center"
          >
            Audit trail
          </Link>
          <Link
            href="/admin/accounts/controls/health"
            className="tt-btn tt-btn-outline block text-center"
          >
            Health check
          </Link>
          <Link
            href="/admin/accounts/controls/flow-audit"
            className="tt-btn tt-btn-outline block text-center"
          >
            Flow audit
          </Link>
          <Link
            href="/admin/help"
            className="tt-btn tt-btn-outline block text-center"
          >
            Help · Books
          </Link>
        </div>
      </div>
    </AccountsShell>
  );
}
