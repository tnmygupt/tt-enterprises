"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { AdminShell } from "@/components/AdminShell";
import { WhatsAppTemplateEditor } from "@/components/WhatsAppTemplateEditor";
import { toDateInputValue } from "@/lib/date-range";
import { useDb, useSession } from "@/lib/hooks";
import {
  buildOwnerDailySummary,
  listOverdueParties,
  ownerUsers,
} from "@/lib/owner-daily-summary";
import { formatInr } from "@/lib/pricing";
import { checkCapability, isSalesDeskStaff, isStaff, saveSettings } from "@/lib/store/db";
import {
  overdueDealerWhatsAppText,
  overdueStaffWhatsAppText,
  sendWhatsAppMessage,
  whatsappCountryCode,
} from "@/lib/whatsapp";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export default function WhatsAppDeskPage() {
  const t = useTranslations("whatsappPanel");
  const ta = useTranslations("whatsapp");
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const today = toDateInputValue();
  const [waConfigured, setWaConfigured] = useState<boolean | null>(null);
  const [waMode, setWaMode] = useState<string>("");
  const [phone, setPhone] = useState("");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const canOpen =
    !!session &&
    isStaff(session.role) &&
    !isSalesDeskStaff(session, db) &&
    (checkCapability(session, db, "manage_users") ||
      checkCapability(session, db, "manage_accounts") ||
      checkCapability(session, db, "verify_payment") ||
      checkCapability(session, db, "approve_dealers") ||
      checkCapability(session, db, "manage_shipping") ||
      session.role === "super_admin");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/whatsapp/send", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((d: { configured?: boolean; mode?: string }) => {
        if (cancelled) return;
        setWaConfigured(!!d.configured);
        setWaMode(d.mode || "");
      })
      .catch(() => {
        if (!cancelled) setWaConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const country = whatsappCountryCode(db?.settings);
  const overdue = useMemo(
    () => (db ? listOverdueParties(db, today) : []),
    [db, today]
  );
  const overdueTotal = overdue.reduce((s, r) => s + r.total, 0);
  const summary = useMemo(
    () =>
      db
        ? buildOwnerDailySummary({ db, today, locale })
        : {
            text: "",
            overdueTotal: 0,
            payableTotal: 0,
            creditorTotal: 0,
            needVerify: 0,
          },
    [db, today, locale]
  );
  const digest = db?.settings.whatsappDigest;
  const owners = db ? ownerUsers(db.users) : [];

  if (!session || !canOpen) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  if (!db) {
    return (
      <AdminShell>
        <p className="text-sm text-[var(--ink-muted)]">{t("loading")}</p>
      </AdminShell>
    );
  }

  const stamp = (patch: { dailyOn?: string; dueOn?: string }) => {
    saveSettings({
      ...db.settings,
      whatsappDigest: { ...(db.settings.whatsappDigest ?? {}), ...patch },
    });
    refresh();
  };

  const onCompose = async () => {
    setBusy(true);
    setMsg("");
    try {
      const result = await sendWhatsAppMessage(phone, text, country);
      setMsg(
        result.ok
          ? t("sent")
          : result.error || t("sendFailed")
      );
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("sendFailed"));
    } finally {
      setBusy(false);
    }
  };

  const onDaily = async () => {
    if (!owners.length) {
      setMsg(t("noOwners"));
      return;
    }
    setBusy(true);
    setMsg("");
    let sent = 0;
    try {
      for (const u of owners) {
        if (sent > 0) await sleep(400);
        const result = await sendWhatsAppMessage(
          u.phone,
          summary.text,
          country
        );
        if (result.ok) sent += 1;
      }
      if (sent > 0) stamp({ dailyOn: today });
      setMsg(t("dailySent", { n: sent }));
    } finally {
      setBusy(false);
    }
  };

  const onDue = async () => {
    setBusy(true);
    setMsg("");
    const company = db.settings.companyName || "TT Enterprises";
    let dealers = 0;
    try {
      for (const row of overdue) {
        if (!row.phone) continue;
        if (dealers > 0) await sleep(400);
        const linked = db.users.find((u) => u.id === row.party.linkedUserId);
        const result = await sendWhatsAppMessage(
          row.phone,
          overdueDealerWhatsAppText({
            partyName: row.party.name,
            companyName: company,
            locale: linked?.locale === "hi" ? "hi" : "en",
            total: row.total,
            bills: row.bills,
          }),
          country
        );
        if (result.ok) dealers += 1;
      }
      const staffText = overdueStaffWhatsAppText({
        companyName: company,
        locale: "en",
        partyCount: overdue.length,
        total: overdueTotal,
        top: overdue.map((r) => ({ name: r.party.name, amount: r.total })),
      });
      for (const u of owners) {
        await sleep(400);
        await sendWhatsAppMessage(u.phone, staffText, country);
      }
      if (dealers > 0 || overdue.length === 0) stamp({ dueOn: today });
      setMsg(t("dueSent", { n: dealers }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell>
      <AdminPageHeader
        title={t("title")}
        hint={t("hint")}
        extra={
          <StatusBadge tone={waConfigured ? "ok" : "muted"}>
            {waConfigured == null
              ? "…"
              : waConfigured
                ? t("gatewayOn")
                : t("gatewayOff")}
          </StatusBadge>
        }
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="tt-panel p-4 text-sm">
          <p className="text-xs uppercase text-[var(--ink-muted)]">
            {t("gateway")}
          </p>
          <p className="mt-1 font-semibold">
            {waConfigured == null
              ? "…"
              : waConfigured
                ? t("gatewayOn")
                : t("gatewayOff")}
          </p>
          {waMode ? (
            <p className="text-xs text-[var(--ink-muted)]">{waMode}</p>
          ) : null}
        </div>
        <div className="tt-panel p-4 text-sm">
          <p className="text-xs uppercase text-[var(--ink-muted)]">
            {t("notify")}
          </p>
          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={db.settings.whatsappNotifyEnabled !== false}
              onChange={(e) => {
                saveSettings({
                  ...db.settings,
                  whatsappNotifyEnabled: e.target.checked,
                });
                refresh();
              }}
            />
            {ta("enabled")}
          </label>
        </div>
        <div className="tt-panel p-4 text-sm">
          <p className="text-xs uppercase text-[var(--ink-muted)]">
            {t("lastDigest")}
          </p>
          <p className="mt-1 text-xs leading-5">
            Daily: {digest?.dailyOn || "—"}
            <br />
            Due: {digest?.dueOn || digest?.overdueOn || "—"}
            <br />
            Credit: {digest?.creditOn || "—"}
            <br />
            Scheme: {digest?.schemeOn || "—"}
            <br />
            Stale estimates: {digest?.staleOn || "—"}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/admin/accounts/payments" className="tt-btn tt-btn-outline">
          {t("linkPayments")}
        </Link>
        <Link href="/admin/accounts/brs" className="tt-btn tt-btn-outline">
          {t("linkBrs")}
        </Link>
        <Link href="/admin/settings" className="tt-btn tt-btn-outline">
          {t("linkSettings")}
        </Link>
      </div>

      <div className="mt-6 max-w-xl rounded-2xl border border-[var(--line)] bg-white p-5">
        <WhatsAppTemplateEditor
          settings={db.settings}
          locale={locale}
          onSave={(whatsappTemplates) => {
            saveSettings({ ...db.settings, whatsappTemplates });
            refresh();
          }}
        />
      </div>

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {t("compose")}
      </h2>
      <div className="mt-2 max-w-xl space-y-2">
        <input
          className="tt-input"
          placeholder={t("phone")}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <textarea
          className="tt-input min-h-[7rem]"
          placeholder={t("message")}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className="tt-btn tt-btn-dark"
          disabled={busy || !phone.trim() || !text.trim()}
          onClick={() => void onCompose()}
        >
          {t("send")}
        </button>
      </div>

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {t("dailyTitle")}
      </h2>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">{t("dailyHint")}</p>
      <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-3 text-xs">
        {summary.text}
      </pre>
      <button
        type="button"
        className="tt-btn tt-btn-primary mt-2"
        disabled={busy}
        onClick={() => void onDaily()}
      >
        {t("dailySend")}
      </button>

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {t("dueTitle")} · {overdue.length} · {formatInr(overdueTotal, locale)}
      </h2>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">{t("dueHint")}</p>
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {overdue.map((r) => (
          <li key={r.party.id} className="tt-panel p-3 text-sm">
            <p className="font-semibold">{r.party.name}</p>
            <p className="tabular-nums text-[var(--danger)]">
              {formatInr(r.total, locale)}
            </p>
            {r.phone ? null : (
              <p className="text-xs text-[var(--ink-muted)]">{t("noPhone")}</p>
            )}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="tt-btn tt-btn-dark mt-2"
        disabled={busy || overdue.length === 0}
        onClick={() => void onDue()}
      >
        {t("dueSend")}
      </button>

      {msg ? <p className="mt-4 text-sm text-[var(--brand-deep)]">{msg}</p> : null}

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {ta("eventsTitle")}
      </h2>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm text-[var(--ink-muted)]">
        <li>{ta("eventSignup")}</li>
        <li>{ta("eventNewOrder")}</li>
        <li>{ta("eventProof")}</li>
        <li>{ta("eventVerified")}</li>
        <li>{ta("eventOverdue")}</li>
        <li>{t("eventDaily")}</li>
        <li>{ta("eventLowStock")}</li>
      </ul>
    </AdminShell>
  );
}
