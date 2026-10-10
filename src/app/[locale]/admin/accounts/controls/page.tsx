"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
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

export default function ControlsPage() {
  const t = useTranslations();
  const monthName = (m: number) => t(`accounts.month${m}` as "accounts.month1");
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

  if (!session || !checkCapability(session, db, "manage_accounts")) {
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
      setMsg(t("accounts.periodLockedMsg", { date: lockDate }));
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("accounts.backupFailed"));
    }
  };

  const onClearLock = () => {
    if (!isOwner) return;
    setMsg("");
    setError("");
    setPeriodLock(null);
    setMsg(t("accounts.periodUnlockedMsg"));
    refresh();
  };

  const onFyMonth = (m: number) => {
    if (!isOwner) return;
    setFinancialYearStartMonth(m);
    setMsg(t("accounts.fyStartsMsg", { month: monthName(m) }));
    refresh();
  };

  const onBackup = () => {
    if (!isOwner) return;
    setMsg("");
    try {
      const name = downloadBooksBackup();
      setMsg(t("accounts.backupDownloaded", { name }));
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("accounts.backupFailed"));
    }
  };

  return (
    <AccountsShell>
      <AccountsPageHeader
        title={t("accounts.navControls")}
        hint={t("accounts.controlsHint")}
      />

      {msg ? <p className="mt-3 text-sm text-[var(--ok)]">{msg}</p> : null}
      {error ? (
        <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="tt-panel p-5">
          <p className="text-sm font-semibold">{t("accounts.financialYear")}</p>
          <p className="mt-2 tt-display text-3xl text-[var(--brand-deep)]">
            FY {fy.label}
          </p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {fy.from} → {fy.to}
          </p>
          {isOwner ? (
            <div className="mt-4">
              <label className="tt-label">{t("accounts.yearStartsIn")}</label>
              <select
                className="tt-select"
                value={fyMonth}
                onChange={(e) => onFyMonth(Number(e.target.value))}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {monthName(m)}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">
              {t("accounts.fyStarts", { month: monthName(fyMonth) })}
            </p>
          )}
        </div>

        <div className="tt-panel p-5">
          <p className="text-sm font-semibold">{t("accounts.periodLock")}</p>
          {locked ? (
            <p className="mt-2 text-sm text-[var(--danger)]">
              {t("accounts.lockedThrough", { date: locked })}
            </p>
          ) : (
            <p className="mt-2 text-sm text-[var(--ok)]">{t("accounts.noLock")}</p>
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
                {t("accounts.lockThroughDate")}
              </button>
              {locked ? (
                <button
                  type="button"
                  className="tt-btn tt-btn-outline"
                  onClick={onClearLock}
                >
                  {t("accounts.unlock")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="tt-panel p-5">
          <p className="text-sm font-semibold">{t("accounts.booksBackup")}</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            {t("accounts.booksBackupHint")}
          </p>
          {db?.settings.booksBackupAt ? (
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              {t("accounts.lastBackup", {
                at: db.settings.booksBackupAt.slice(0, 19).replace("T", " "),
              })}
            </p>
          ) : null}
          {isOwner ? (
            <button
              type="button"
              className="tt-btn tt-btn-dark mt-4"
              onClick={onBackup}
            >
              {t("accounts.downloadBackup")}
            </button>
          ) : (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">{t("accounts.ownerOnly")}</p>
          )}
        </div>

        <div className="tt-panel space-y-3 p-5">
          <p className="text-sm font-semibold">{t("accounts.controlsMore")}</p>
          <Link
            href="/admin/accounts/controls/audit"
            className="tt-btn tt-btn-outline block text-center"
          >
            {t("accounts.auditTrail")}
          </Link>
          <Link
            href="/admin/accounts/controls/health"
            className="tt-btn tt-btn-outline block text-center"
          >
            {t("accounts.healthCheck")}
          </Link>
          <Link
            href="/admin/owner/monthly-audit"
            className="tt-btn tt-btn-outline block text-center"
          >
            {t("accounts.monthClose")}
          </Link>
          <Link
            href="/admin/accounts/controls/flow-audit"
            className="tt-btn tt-btn-outline block text-center"
          >
            {t("accounts.flowAudit")}
          </Link>
          <Link
            href="/admin/help?tab=books"
            className="tt-btn tt-btn-outline block text-center"
          >
            {t("accounts.helpBooks")}
          </Link>
        </div>
      </div>
    </AccountsShell>
  );
}
